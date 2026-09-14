package agents

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/lx-wnk/agent-dashboard/sdk"
	"github.com/lx-wnk/agent-dashboard/server/internal/channelconfig"
	"github.com/lx-wnk/agent-dashboard/server/internal/db/repo"
	"github.com/lx-wnk/agent-dashboard/server/internal/managedagent"
	"github.com/lx-wnk/agent-dashboard/server/internal/services"
)

// 3N.2: stop and delete an agent without touching its work or its history.
// 3N.2.1: only an agent the dashboard launched; an external session is observed.

type fakeAgentLookup map[int]sdk.Agent

func (f fakeAgentLookup) AgentByPID(pid int) (sdk.Agent, bool) {
	a, ok := f[pid]
	return a, ok
}

type recordingForgetter struct {
	pid       int
	sessionID string
	calls     int
}

func (r *recordingForgetter) ForgetAgent(pid int, sessionID string) {
	r.pid, r.sessionID = pid, sessionID
	r.calls++
}

type recordingProfileDeleter struct{ deleted []string }

func (r *recordingProfileDeleter) Delete(_ context.Context, sessionID string) error {
	r.deleted = append(r.deleted, sessionID)
	return nil
}

type memManagedRepo struct {
	rows map[string]repo.ManagedAgentRow
}

func (m *memManagedRepo) Upsert(_ context.Context, row repo.ManagedAgentRow) error {
	m.rows[row.SessionID] = row
	return nil
}

func (m *memManagedRepo) List(context.Context) ([]repo.ManagedAgentRow, error) {
	out := make([]repo.ManagedAgentRow, 0, len(m.rows))
	for _, r := range m.rows {
		out = append(out, r)
	}
	return out, nil
}

func (m *memManagedRepo) Delete(_ context.Context, id string) error {
	delete(m.rows, id)
	return nil
}

type folderSettings struct{ values map[string]string }

func (s *folderSettings) String(key string) string { return s.values[key] }

func (s *folderSettings) Set(_ context.Context, key, value string) error {
	s.values[key] = value
	return nil
}

type lifecycleFixture struct {
	h         *SpawnHandler
	forgetter *recordingForgetter
	profiles  *recordingProfileDeleter
	managed   *managedagent.Store
	folders   *folderSettings
	killed    []int
	alive     map[int]bool
	home      string
}

func newLifecycleFixture(t *testing.T, agents ...sdk.Agent) *lifecycleFixture {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	f := &lifecycleFixture{
		forgetter: &recordingForgetter{},
		profiles:  &recordingProfileDeleter{},
		managed:   managedagent.New(&memManagedRepo{rows: map[string]repo.ManagedAgentRow{}}),
		folders:   &folderSettings{values: map[string]string{}},
		alive:     map[int]bool{},
		home:      home,
	}
	lookup := fakeAgentLookup{}
	for _, a := range agents {
		lookup[a.PID] = a
	}
	f.h = NewSpawnHandler(NewSpawnManager(5, 60000, 30, 60000, nil, nil))
	f.h.SetAgentLookup(lookup)
	f.h.SetAgentForgetter(f.forgetter)
	f.h.SetProfileDeleter(f.profiles)
	f.h.SetManagedAgents(f.managed)
	f.h.SetWorkingFolderSettings(f.folders)
	f.h.alive = func(pid int) bool { return f.alive[pid] }
	f.h.terminate = func(pid int) error {
		f.killed = append(f.killed, pid)
		f.alive[pid] = false
		return nil
	}
	return f
}

// own records a as launched by this server, the way SpawnManager does.
func (f *lifecycleFixture) own(t *testing.T, rec managedagent.Record) {
	t.Helper()
	require.NoError(t, f.managed.Record(context.Background(), rec))
}

func (f *lifecycleFixture) ownAgent(t *testing.T, a sdk.Agent) {
	f.own(t, managedagent.Record{SessionID: a.SessionID, PID: a.PID, Cwd: a.CWD})
}

func (f *lifecycleFixture) do(method, path string, pid int, handler func(http.ResponseWriter, *http.Request)) (*httptest.ResponseRecorder, map[string]any) {
	req := httptest.NewRequest(method, path, nil)
	req.SetPathValue("pid", strconv.Itoa(pid))
	rr := httptest.NewRecorder()
	handler(rr, req)
	var body map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &body)
	return rr, body
}

func runningAgent(pid int, cwd string) sdk.Agent {
	return sdk.Agent{PID: pid, SessionID: "sess-" + strconv.Itoa(pid), Status: sdk.AgentStatusActive, CWD: cwd, ProjectPath: cwd}
}

func TestDeleteAgent_RefusesAPidTheScanDoesNotKnow(t *testing.T) {
	f := newLifecycleFixture(t)
	f.alive[4242] = true
	f.own(t, managedagent.Record{SessionID: "sess-4242", PID: 4242})
	rr, _ := f.do(http.MethodDelete, "/api/agents/4242?stop=true", 4242, f.h.DeleteAgent)
	require.Equal(t, http.StatusNotFound, rr.Code)
	require.Empty(t, f.killed, "never an arbitrary process")
}

func TestDeleteAgent_RefusesInternalAndRemoteAgents(t *testing.T) {
	internal := runningAgent(11, "/tmp")
	internal.InternalProcess = true
	remote := runningAgent(12, "/tmp")
	remote.Machine = "studio"
	f := newLifecycleFixture(t, internal, remote)
	for _, a := range []sdk.Agent{internal, remote} {
		f.ownAgent(t, a)
		f.alive[a.PID] = true
		rr, _ := f.do(http.MethodDelete, "/api/agents/x?stop=true", a.PID, f.h.DeleteAgent)
		require.Equal(t, http.StatusForbidden, rr.Code)
	}
	require.Empty(t, f.killed)
}

func TestDeleteAgent_RunningNeedsExplicitConfirmation(t *testing.T) {
	a := runningAgent(21, "/tmp")
	f := newLifecycleFixture(t, a)
	f.ownAgent(t, a)
	f.alive[21] = true
	rr, body := f.do(http.MethodDelete, "/api/agents/21", 21, f.h.DeleteAgent)
	require.Equal(t, http.StatusConflict, rr.Code)
	require.Equal(t, true, body["running"])
	require.Empty(t, f.killed)
	require.Zero(t, f.forgetter.calls)
	require.Empty(t, f.profiles.deleted)
}

// B, G, H: an owned agent is deleted; its folder, Git repository and transcript stay.
func TestDeleteAgent_StopsCleansUpAndKeepsTheWorkAndHistory(t *testing.T) {
	cwd := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(cwd, ".git", "refs"), 0o755))
	head := filepath.Join(cwd, ".git", "HEAD")
	require.NoError(t, os.WriteFile(head, []byte("ref: refs/heads/main\n"), 0o600))
	source := filepath.Join(cwd, "resume.tex")
	require.NoError(t, os.WriteFile(source, []byte("\\documentclass{article}"), 0o600))

	a := runningAgent(31, cwd)
	f := newLifecycleFixture(t, a)
	f.ownAgent(t, a)
	f.alive[31] = true
	transcript := filepath.Join(f.home, ".claude", "projects", "-scratch", "sess-31.jsonl")
	require.NoError(t, os.MkdirAll(filepath.Dir(transcript), 0o755))
	require.NoError(t, os.WriteFile(transcript, []byte("{}\n"), 0o600))
	discovery := channelconfig.DiscoveryFile(f.home, 31)
	require.NoError(t, os.MkdirAll(filepath.Dir(discovery), 0o755))
	require.NoError(t, os.WriteFile(discovery, []byte("{}"), 0o600))

	rr, body := f.do(http.MethodDelete, "/api/agents/31?stop=true", 31, f.h.DeleteAgent)
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	require.Equal(t, true, body["deleted"])
	require.Equal(t, true, body["stopped"])

	require.Equal(t, []int{31}, f.killed, "the running process is stopped first")
	require.Equal(t, 1, f.forgetter.calls)
	require.Equal(t, "sess-31", f.forgetter.sessionID)
	require.Equal(t, []string{"sess-31"}, f.profiles.deleted, "the saved name and icon go with it")
	_, err := os.Stat(discovery)
	require.True(t, os.IsNotExist(err), "the dashboard's discovery file is removed")
	_, owned := f.managed.Get("sess-31")
	require.False(t, owned, "the ownership record goes with it")

	for _, kept := range []string{cwd, source, filepath.Join(cwd, ".git"), head, transcript} {
		_, err := os.Stat(kept)
		require.NoError(t, err, "%s must survive deleting the agent", kept)
	}
}

func TestDeleteAgent_FinishedAgentIsNotStopped(t *testing.T) {
	finished := runningAgent(41, "/tmp")
	finished.Status = sdk.AgentStatusFinished
	f := newLifecycleFixture(t, finished)
	f.ownAgent(t, finished)
	rr, body := f.do(http.MethodDelete, "/api/agents/41", 41, f.h.DeleteAgent)
	require.Equal(t, http.StatusOK, rr.Code)
	require.Equal(t, false, body["stopped"])
	require.Empty(t, f.killed)
	require.Equal(t, 1, f.forgetter.calls)
}

// A: an owned agent can be stopped.
func TestStopAgent(t *testing.T) {
	a, b := runningAgent(51, "/tmp"), runningAgent(52, "/tmp")
	f := newLifecycleFixture(t, a, b)
	f.ownAgent(t, a)
	f.ownAgent(t, b)
	f.alive[51] = true
	rr, _ := f.do(http.MethodPost, "/api/agents/51/stop", 51, f.h.StopAgent)
	require.Equal(t, http.StatusOK, rr.Code)
	require.Equal(t, []int{51}, f.killed)
	require.Zero(t, f.forgetter.calls, "stopping is not deleting")
	require.Empty(t, f.profiles.deleted)

	rr, _ = f.do(http.MethodPost, "/api/agents/52/stop", 52, f.h.StopAgent)
	require.Equal(t, http.StatusConflict, rr.Code, "an agent that is not running is not stopped again")
}

// C, D, E: a session started in a terminal or in VS Code is never stopped or
// deleted, and nothing about it changes — the refusal says so plainly.
func TestExternalSessions_AreNeverStoppedOrDeleted(t *testing.T) {
	cwd := t.TempDir()
	terminal := runningAgent(61, cwd)
	terminal.Entrypoint = sdk.EntrypointCLI
	vscode := runningAgent(62, cwd)
	vscode.Entrypoint = "claude-vscode"
	vscode.LiveInjectable = true // a channel or live terminal is not ownership
	f := newLifecycleFixture(t, terminal, vscode)

	for _, a := range []sdk.Agent{terminal, vscode} {
		f.alive[a.PID] = true
		discovery := channelconfig.DiscoveryFile(f.home, a.PID)
		require.NoError(t, os.MkdirAll(filepath.Dir(discovery), 0o755))
		require.NoError(t, os.WriteFile(discovery, []byte("{}"), 0o600))

		rr, body := f.do(http.MethodPost, "/api/agents/x/stop", a.PID, f.h.StopAgent)
		require.Equal(t, http.StatusForbidden, rr.Code)
		require.Equal(t, true, body["external"])
		require.Equal(t, ExternalSessionMessage, body["error"])

		for _, path := range []string{"/api/agents/x?stop=true", "/api/agents/x"} {
			rr, body = f.do(http.MethodDelete, path, a.PID, f.h.DeleteAgent)
			require.Equal(t, http.StatusForbidden, rr.Code)
			require.Equal(t, true, body["external"])
			require.Nil(t, body["deleted"], "no pretended success")
		}
		_, err := os.Stat(discovery)
		require.NoError(t, err, "an external session's files are left alone")
	}
	require.Empty(t, f.killed, "no signal is ever sent to an external session")
	require.Zero(t, f.forgetter.calls)
	require.Empty(t, f.profiles.deleted)
}

// F: ownership is the record of what this server launched — never the PID being
// scanned, a Claude process, a shared workspace, the provider, or the session id
// alone (a dashboard session later resumed from a terminal is a new process).
func TestOwnership_IsNotInferred(t *testing.T) {
	cwd := t.TempDir()
	mine := runningAgent(71, cwd)
	sameWorkspace := runningAgent(72, cwd)
	sameWorkspace.Provider = mine.Provider
	resumedElsewhere := sdk.Agent{PID: 73, SessionID: mine.SessionID, Status: sdk.AgentStatusActive, CWD: cwd}
	reusedPID := sdk.Agent{PID: 74, SessionID: "sess-other", Status: sdk.AgentStatusActive, CWD: cwd}
	f := newLifecycleFixture(t, mine, sameWorkspace, reusedPID)
	f.ownAgent(t, mine)
	f.own(t, managedagent.Record{SessionID: "sess-earlier", PID: 74})

	for _, a := range []sdk.Agent{sameWorkspace, reusedPID} {
		f.alive[a.PID] = true
		rr, body := f.do(http.MethodPost, "/api/agents/x/stop", a.PID, f.h.StopAgent)
		require.Equal(t, http.StatusForbidden, rr.Code, "pid %d", a.PID)
		require.Equal(t, true, body["external"])
	}
	require.Empty(t, f.killed)

	lookup := fakeAgentLookup{73: resumedElsewhere}
	f.h.SetAgentLookup(lookup)
	f.alive[73] = true
	rr, _ := f.do(http.MethodPost, "/api/agents/73/stop", 73, f.h.StopAgent)
	require.Equal(t, http.StatusForbidden, rr.Code, "the session id alone is not ownership")
	require.Empty(t, f.killed)

	o := NewOwnership(f.managed, nil)
	require.True(t, o.Owns(71, mine.SessionID))
	require.False(t, o.Owns(72, sameWorkspace.SessionID))
	require.False(t, o.Owns(73, mine.SessionID))
	require.False(t, o.Owns(74, "sess-other"))
	require.False(t, (*Ownership)(nil).Owns(71, mine.SessionID))
}

func TestPipelineAgents_BelongToTheirTask(t *testing.T) {
	a := runningAgent(81, "/tmp")
	a.PipelineTaskID = "task-1"
	f := newLifecycleFixture(t, a)
	f.ownAgent(t, a)
	f.alive[81] = true
	rr, body := f.do(http.MethodPost, "/api/agents/81/stop", 81, f.h.StopAgent)
	require.Equal(t, http.StatusForbidden, rr.Code)
	require.Equal(t, "pipeline", body["managedBy"])
	require.Empty(t, f.killed)
}

func projectlessWorkspace(t *testing.T, f *lifecycleFixture, name string) string {
	t.Helper()
	root := filepath.Join(t.TempDir(), "AI-Agents")
	require.NoError(t, services.SetProjectlessRoot(context.Background(), f.folders, root))
	ws, err := services.CreateProjectlessWorkspace(context.Background(), f.folders, name)
	require.NoError(t, err)
	return ws.Path
}

// I, K, L: deleting the agent a projectless workspace was created for removes the
// allowed-folder entry the dashboard added, keeps the folder and every other
// entry, and never touches Claude Code's own ~/.claude.json.
func TestDeleteAgent_RemovesTheAllowedFolderItAddedForAProjectlessWorkspace(t *testing.T) {
	f := newLifecycleFixture(t)
	unrelated, err := filepath.EvalSymlinks(t.TempDir())
	require.NoError(t, err)
	_, err = services.AddWorkingFolder(context.Background(), f.folders, unrelated)
	require.NoError(t, err)
	path := projectlessWorkspace(t, f, "Resume Editor")
	require.NoError(t, os.WriteFile(filepath.Join(path, "notes.md"), []byte("kept"), 0o600))
	require.Contains(t, services.WorkingFolders(f.folders), path)

	claudeJSON := filepath.Join(f.home, ".claude.json")
	trust := []byte(`{"projects":{"` + path + `":{"hasTrustDialogAccepted":true}}}`)
	require.NoError(t, os.WriteFile(claudeJSON, trust, 0o600))

	a := runningAgent(91, path)
	a.Status = sdk.AgentStatusFinished
	f.h.SetAgentLookup(fakeAgentLookup{91: a})
	f.own(t, managedagent.Record{SessionID: a.SessionID, PID: 91, Cwd: path, WorkspaceCreated: true, AllowedFolder: path})

	rr, body := f.do(http.MethodDelete, "/api/agents/91", 91, f.h.DeleteAgent)
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	require.Equal(t, true, body["allowedFolderRemoved"])

	folders := services.WorkingFolders(f.folders)
	require.NotContains(t, folders, path)
	require.Contains(t, folders, unrelated, "an entry the dashboard did not add for this agent stays")
	_, err = os.Stat(filepath.Join(path, "notes.md"))
	require.NoError(t, err, "the workspace folder and its files stay on disk")
	after, err := os.ReadFile(claudeJSON)
	require.NoError(t, err)
	require.Equal(t, trust, after, "Claude Code's trust state is not the dashboard's to change")
}

// J: the entry stays while another owned agent still runs in that workspace, and
// for an agent whose workspace the dashboard did not create.
func TestDeleteAgent_KeepsAnAllowedFolderStillInUseOrNotAddedByIt(t *testing.T) {
	f := newLifecycleFixture(t)
	path := projectlessWorkspace(t, f, "Shared")

	first := runningAgent(101, path)
	first.Status = sdk.AgentStatusFinished
	second := runningAgent(102, path)
	f.h.SetAgentLookup(fakeAgentLookup{101: first, 102: second})
	f.own(t, managedagent.Record{SessionID: first.SessionID, PID: 101, Cwd: path, WorkspaceCreated: true, AllowedFolder: path})
	f.ownAgent(t, second)

	rr, body := f.do(http.MethodDelete, "/api/agents/101", 101, f.h.DeleteAgent)
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	require.Equal(t, false, body["allowedFolderRemoved"])
	require.Contains(t, services.WorkingFolders(f.folders), path, "another dashboard agent still relies on it")

	// The user's own allowed folder, used by an owned agent the dashboard did not
	// create a workspace for, is never removed.
	own, err := filepath.EvalSymlinks(t.TempDir())
	require.NoError(t, err)
	_, err = services.AddWorkingFolder(context.Background(), f.folders, own)
	require.NoError(t, err)
	third := runningAgent(103, own)
	third.Status = sdk.AgentStatusFinished
	f.h.SetAgentLookup(fakeAgentLookup{103: third})
	f.ownAgent(t, third)
	rr, body = f.do(http.MethodDelete, "/api/agents/103", 103, f.h.DeleteAgent)
	require.Equal(t, http.StatusOK, rr.Code)
	require.Equal(t, false, body["allowedFolderRemoved"])
	require.Contains(t, services.WorkingFolders(f.folders), own)
}

func TestRemoveAgentProfile_TouchesOnlyPresentation(t *testing.T) {
	a := runningAgent(111, "/tmp")
	f := newLifecycleFixture(t, a)
	f.alive[111] = true
	rr, body := f.do(http.MethodDelete, "/api/agents/111/profile", 111, f.h.RemoveAgentProfile)
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	require.Equal(t, true, body["profileRemoved"])
	require.Equal(t, []string{"sess-111"}, f.profiles.deleted)
	require.Empty(t, f.killed, "removing a name never stops a process")
	require.Zero(t, f.forgetter.calls)
}

func TestLifecycle_WithoutAScanAnswers503(t *testing.T) {
	h := NewSpawnHandler(NewSpawnManager(5, 60000, 30, 60000, nil, nil))
	req := httptest.NewRequest(http.MethodDelete, "/api/agents/7", nil)
	req.SetPathValue("pid", "7")
	rr := httptest.NewRecorder()
	h.DeleteAgent(rr, req)
	require.Equal(t, http.StatusServiceUnavailable, rr.Code)
}
