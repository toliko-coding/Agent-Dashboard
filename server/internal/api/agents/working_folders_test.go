package agents

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/lx-wnk/agent-dashboard/sdk"
	"github.com/lx-wnk/agent-dashboard/server/internal/channelconfig"
	"github.com/lx-wnk/agent-dashboard/server/internal/services"
	"github.com/lx-wnk/agent-dashboard/server/internal/settings"
)

// memSettings validates writes through the real registry definition.
type memSettings struct {
	mu     sync.Mutex
	values map[string]string
}

func (m *memSettings) String(key string) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	if v, ok := m.values[key]; ok {
		return v
	}
	return "[]"
}

func (m *memSettings) Set(_ context.Context, key, value string) error {
	if def, ok := settings.Lookup(key); ok {
		if err := def.Validate(value); err != nil {
			return err
		}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.values[key] = value
	return nil
}

// folderEnv is a HOME with a project root registered and a spawn manager whose
// allow-list is Project roots plus working folders — the production wiring.
type folderEnv struct {
	home     string
	project  string
	settings *memSettings
	manager  *SpawnManager
	handler  *SpawnHandler
}

func newFolderEnv(t *testing.T) *folderEnv {
	t.Helper()
	home, _ := filepath.EvalSymlinks(t.TempDir())
	t.Setenv("HOME", home)
	project := filepath.Join(home, "projects", "alpha")
	require.NoError(t, os.MkdirAll(project, 0o755))
	s := &memSettings{values: map[string]string{}}
	policy := services.NewSpawnPolicy(services.CombineRootsProviders(
		func(context.Context) ([]string, error) { return []string{project}, nil },
		services.WorkingFolderRootsProvider(s),
	))
	m := NewSpawnManager(5, 60000, 30, 60000, nil, policy)
	h := NewSpawnHandler(m)
	h.SetWorkingFolderSettings(s)
	return &folderEnv{home: home, project: project, settings: s, manager: m, handler: h}
}

func postPath(t *testing.T, handler http.HandlerFunc, url, path string) *httptest.ResponseRecorder {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"path": path})
	rec := httptest.NewRecorder()
	handler(rec, httptest.NewRequest(http.MethodPost, url, bytes.NewReader(body)))
	return rec
}

func decodeCheck(t *testing.T, rec *httptest.ResponseRecorder) FolderCheck {
	t.Helper()
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var check FolderCheck
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&check))
	return check
}

func TestPreflight_StatesWhyAFolderCannotBeUsed(t *testing.T) {
	env := newFolderEnv(t)
	file := filepath.Join(env.home, "notes.txt")
	require.NoError(t, os.WriteFile(file, []byte("x"), 0o600))
	ssh := filepath.Join(env.home, ".ssh")
	require.NoError(t, os.MkdirAll(ssh, 0o700))

	for path, reason := range map[string]string{
		"relative/folder":                  "not-absolute",
		"/a/../b":                          "not-absolute",
		filepath.Join(env.home, "missing"): "not-found",
		file:                               "not-directory",
		ssh:                                "blacklisted",
	} {
		check := decodeCheck(t, postPath(t, env.handler.Preflight, "/api/agents/spawn/preflight", path))
		assert.False(t, check.Allowed, path)
		assert.Equal(t, reason, check.Reason, path)
		assert.False(t, check.CanAllow, "%s must not be offered for allowing", path)
		if reason == "blacklisted" {
			assert.Nil(t, check.Workspace, "git must not run in a sensitive directory")
		}
	}
}

// A: an agent needs no Project — a plain folder outside every Project is
// refused only until the user explicitly allows it (D, plain non-Git folder).
func TestWorkingFolders_AllowAPlainFolderWithoutAProject(t *testing.T) {
	env := newFolderEnv(t)
	plain := filepath.Join(env.home, "scratch", "plain")
	require.NoError(t, os.MkdirAll(plain, 0o755))

	before := decodeCheck(t, postPath(t, env.handler.Preflight, "/api/agents/spawn/preflight", plain))
	assert.False(t, before.Allowed)
	assert.Equal(t, "outside-allowed-folders", before.Reason)
	assert.True(t, before.CanAllow)
	require.NotNil(t, before.Workspace)
	assert.Equal(t, sdk.WorkspaceKind("plain"), before.Workspace.Kind)
	assert.Nil(t, before.Workspace.Repository, "a plain folder has no repository, and none is invented")

	rec := postPath(t, env.handler.AddWorkingFolder, "/api/agents/working-folders", plain)
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())

	after := decodeCheck(t, postPath(t, env.handler.Preflight, "/api/agents/spawn/preflight", plain))
	assert.True(t, after.Allowed)
	assert.Empty(t, after.Reason)
	assert.Equal(t, []string{plain}, services.WorkingFolders(env.settings))

	// The allow-list is still a control: an unlisted sibling is refused.
	other := filepath.Join(env.home, "scratch", "other")
	require.NoError(t, os.MkdirAll(other, 0o755))
	assert.False(t, decodeCheck(t, postPath(t, env.handler.Preflight, "/api/agents/spawn/preflight", other)).Allowed)
}

// E: a local Git repository with no remote at all is a repository — no GitHub needed.
func TestPreflight_LocalGitRepositoryWithoutRemote(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not available")
	}
	env := newFolderEnv(t)
	repo := filepath.Join(env.project, "repo")
	require.NoError(t, os.MkdirAll(repo, 0o755))
	for _, args := range [][]string{
		{"init", "-q", "-b", "main", repo},
		{"-C", repo, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "--allow-empty", "-m", "init"},
	} {
		cmd := exec.Command("git", args...)
		cmd.Env = append(os.Environ(), "HOME="+env.home)
		require.NoError(t, cmd.Run())
	}

	check := decodeCheck(t, postPath(t, env.handler.Preflight, "/api/agents/spawn/preflight", repo))
	assert.True(t, check.Allowed)
	require.NotNil(t, check.Workspace)
	assert.Equal(t, sdk.WorkspaceKind("git-main"), check.Workspace.Kind)
	assert.NotNil(t, check.Workspace.Repository)
	assert.Equal(t, "main", check.Workspace.Branch)
}

func TestWorkingFolders_RefusesWhatCannotBeAWorkingFolder(t *testing.T) {
	env := newFolderEnv(t)
	ssh := filepath.Join(env.home, ".aws")
	require.NoError(t, os.MkdirAll(ssh, 0o700))

	assert.Equal(t, http.StatusForbidden, postPath(t, env.handler.AddWorkingFolder, "/", ssh).Code)
	assert.Equal(t, http.StatusBadRequest, postPath(t, env.handler.AddWorkingFolder, "/", "relative").Code)
	assert.Equal(t, http.StatusBadRequest, postPath(t, env.handler.AddWorkingFolder, "/", filepath.Join(env.home, "missing")).Code)
	assert.Empty(t, services.WorkingFolders(env.settings))
}

func TestFolderTrustKeys(t *testing.T) {
	for _, tc := range []struct {
		decision, selected string
		want               []string
	}{
		{"trust", "exit", []string{keyDown, keyEnter}},
		{"trust", "trust", []string{keyEnter}},
		{"exit", "exit", []string{keyEnter}},
		{"exit", "trust", []string{keyUp, keyEnter}},
	} {
		got, err := FolderTrustKeys(tc.decision, tc.selected)
		require.NoError(t, err)
		assert.Equal(t, tc.want, got, "%s with %s selected", tc.decision, tc.selected)
	}
	_, err := FolderTrustKeys("always", "exit")
	assert.Error(t, err)
}

// trustEnv is a spawned, running session with a pty broker recording every
// keystroke write, and a probe that reports whatever screen the test sets.
type trustEnv struct {
	*folderEnv
	pid    int
	cwd    string
	keys   *[]string
	screen *sdk.PendingScreen
}

func newTrustEnv(t *testing.T) *trustEnv {
	t.Helper()
	env := newFolderEnv(t)
	cwd := filepath.Join(env.home, "scratch", "untrusted")
	require.NoError(t, os.MkdirAll(cwd, 0o755))

	var mu sync.Mutex
	keys := []string{}
	broker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/keys" {
			http.NotFound(w, r)
			return
		}
		buf := new(bytes.Buffer)
		_, _ = buf.ReadFrom(r.Body)
		mu.Lock()
		keys = append(keys, buf.String())
		mu.Unlock()
		_, _ = fmt.Fprint(w, `{"ok":true}`)
	}))
	t.Cleanup(broker.Close)

	pid := 44201
	dir := filepath.Join(env.home, channelconfig.DiscoveryDir)
	require.NoError(t, os.MkdirAll(dir, 0o700))
	disc, _ := json.Marshal(map[string]any{"port": broker.Listener.Addr().(*net.TCPAddr).Port, "token": "t"})
	require.NoError(t, os.WriteFile(channelconfig.DiscoveryPtyFile(env.home, pid), disc, 0o600))

	te := &trustEnv{folderEnv: env, pid: pid, cwd: cwd, keys: &keys}
	env.manager.SetScreenProbe(func(p int) *sdk.PendingScreen {
		if p != pid {
			return nil
		}
		return te.screen
	})
	env.manager.mu.Lock()
	env.manager.spawnStore[pid] = &SpawnStatus{PID: pid, Status: "running", Cwd: cwd}
	env.manager.mu.Unlock()

	prevGap := folderTrustKeyGap
	folderTrustKeyGap = 0
	t.Cleanup(func() { folderTrustKeyGap = prevGap })
	return te
}

func (te *trustEnv) answer(t *testing.T, pid, decision string) *httptest.ResponseRecorder {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"decision": decision})
	req := httptest.NewRequest(http.MethodPost, "/api/agents/spawn/"+pid+"/folder-trust", bytes.NewReader(body))
	req.SetPathValue("pid", pid)
	rec := httptest.NewRecorder()
	te.handler.FolderTrust(rec, req)
	return rec
}

func (te *trustEnv) status(t *testing.T) map[string]any {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/agents/spawn/%d/status", te.pid), nil)
	req.SetPathValue("pid", fmt.Sprint(te.pid))
	rec := httptest.NewRecorder()
	te.handler.Status(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)
	var out map[string]any
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&out))
	return out
}

// N + M: the question reaches the spawn status, and reading it answers nothing.
func TestSpawnStatus_ReportsFolderTrustAndNeverAnswersIt(t *testing.T) {
	te := newTrustEnv(t)
	assert.NotContains(t, te.status(t), "awaitingFolderTrust")

	te.screen = &sdk.PendingScreen{FolderTrust: &sdk.DetectedFolderTrust{Path: te.cwd, Selected: "exit"}}
	for range 3 {
		got := te.status(t)
		require.Contains(t, got, "awaitingFolderTrust")
		assert.Equal(t, te.cwd, got["awaitingFolderTrust"].(map[string]any)["path"])
	}
	assert.Empty(t, *te.keys, "detecting the question must never send a keystroke")

	te.manager.markExited(te.pid, "")
	assert.NotContains(t, te.status(t), "awaitingFolderTrust", "an exited spawn is not waiting")
}

func TestFolderTrust_DeliversOnlyAnExplicitDecisionForTheSameFolder(t *testing.T) {
	te := newTrustEnv(t)
	pid := fmt.Sprint(te.pid)

	assert.Equal(t, http.StatusNotFound, te.answer(t, "99999", "trust").Code)
	assert.Equal(t, http.StatusBadRequest, te.answer(t, pid, "yes-to-everything").Code)
	assert.Equal(t, http.StatusConflict, te.answer(t, pid, "trust").Code, "no question open")

	te.screen = &sdk.PendingScreen{FolderTrust: &sdk.DetectedFolderTrust{Path: filepath.Join(te.home, "somewhere-else"), Selected: "exit"}}
	assert.Equal(t, http.StatusConflict, te.answer(t, pid, "trust").Code, "a question about another folder")
	assert.Empty(t, *te.keys)

	te.screen = &sdk.PendingScreen{FolderTrust: &sdk.DetectedFolderTrust{Path: te.cwd, Selected: "exit"}}
	rec := te.answer(t, pid, "trust")
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Equal(t, []string{keyDown, keyEnter}, *te.keys, "move to Yes, then confirm — as separate writes")
}

// O: declining sends Claude's own "No, exit", so the agent stops rather than continuing.
func TestFolderTrust_DeclineSelectsExit(t *testing.T) {
	te := newTrustEnv(t)
	te.screen = &sdk.PendingScreen{FolderTrust: &sdk.DetectedFolderTrust{Path: te.cwd, Selected: "trust"}}
	rec := te.answer(t, fmt.Sprint(te.pid), "exit")
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Equal(t, []string{keyUp, keyEnter}, *te.keys)

	te.manager.markExited(te.pid, "")
	assert.Equal(t, http.StatusConflict, te.answer(t, fmt.Sprint(te.pid), "trust").Code, "a stopped agent cannot be answered")
}

type fakePendingTrust map[int]string

func (f fakePendingTrust) PendingFolderTrustCwd(pid int) (string, bool) {
	cwd, ok := f[pid]
	return cwd, ok
}

// 3M.1 (server restart): a pending question the server rediscovered by scanning —
// with no in-memory spawn record — can be answered, against the process's own cwd.
func TestFolderTrust_AnswersARediscoveredSpawn(t *testing.T) {
	te := newTrustEnv(t)
	te.manager.mu.Lock()
	delete(te.manager.spawnStore, te.pid)
	te.manager.mu.Unlock()
	pid := fmt.Sprint(te.pid)
	te.screen = &sdk.PendingScreen{FolderTrust: &sdk.DetectedFolderTrust{Path: te.cwd, Selected: "exit"}}

	assert.Equal(t, http.StatusNotFound, te.answer(t, pid, "trust").Code, "unknown to both the spawn store and the scan")

	te.handler.SetPendingFolderTrustSource(fakePendingTrust{te.pid: filepath.Join(te.home, "elsewhere")})
	assert.Equal(t, http.StatusConflict, te.answer(t, pid, "trust").Code, "the process works in another folder than Claude names")
	assert.Empty(t, *te.keys)

	te.handler.SetPendingFolderTrustSource(fakePendingTrust{te.pid: te.cwd})
	rec := te.answer(t, pid, "trust")
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Equal(t, []string{keyDown, keyEnter}, *te.keys)
}

// J: two browsers answering the same question — only the first is delivered.
func TestFolderTrust_OnlyOneAnswerWins(t *testing.T) {
	te := newTrustEnv(t)
	pid := fmt.Sprint(te.pid)
	te.screen = &sdk.PendingScreen{FolderTrust: &sdk.DetectedFolderTrust{Path: te.cwd, Selected: "exit"}}

	require.Equal(t, http.StatusOK, te.answer(t, pid, "trust").Code)
	second := te.answer(t, pid, "exit")
	assert.Equal(t, http.StatusConflict, second.Code)
	assert.Contains(t, second.Body.String(), "already answered")
	assert.Equal(t, []string{keyDown, keyEnter}, *te.keys, "the second decision sent nothing")
}

// A refused attempt does not use up the answer.
func TestFolderTrust_RefusedAttemptDoesNotConsumeTheAnswer(t *testing.T) {
	te := newTrustEnv(t)
	pid := fmt.Sprint(te.pid)
	assert.Equal(t, http.StatusConflict, te.answer(t, pid, "trust").Code, "no question on screen yet")
	te.screen = &sdk.PendingScreen{FolderTrust: &sdk.DetectedFolderTrust{Path: te.cwd, Selected: "exit"}}
	assert.Equal(t, http.StatusOK, te.answer(t, pid, "trust").Code)
}
