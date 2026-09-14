package agents

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/lx-wnk/agent-dashboard/server/internal/agentprofile"
	"github.com/lx-wnk/agent-dashboard/server/internal/services"
)

// 3N.1: an optional display name and icon category given at spawn.

type recordingSaver struct {
	sessionID string
	profile   agentprofile.Profile
	err       error
}

func (r *recordingSaver) Save(_ context.Context, sessionID string, p agentprofile.Profile) error {
	r.sessionID, r.profile = sessionID, p
	return r.err
}

func profilePolicyManager(t *testing.T) (*SpawnManager, string, string) {
	t.Helper()
	tmp := t.TempDir()
	home := filepath.Join(tmp, "home")
	allowed := filepath.Join(tmp, "allowed", "scratch-folder")
	outside := filepath.Join(tmp, "outside")
	for _, d := range []string{home, allowed, outside} {
		require.NoError(t, os.MkdirAll(d, 0o755))
	}
	t.Setenv("HOME", home)
	policy := services.NewSpawnPolicy(func(context.Context) ([]string, error) { return []string{filepath.Dir(allowed)}, nil })
	return NewSpawnManager(5, 60000, 30, 60000, nil, policy), allowed, outside
}

func TestSpawnProfile_ProjectlessNameAndCategoryAreCarried(t *testing.T) {
	m, allowed, _ := profilePolicyManager(t)
	req, err := m.enforceSpawnPolicy(map[string]any{"prompt": "p", "cwd": allowed, "displayName": "  Resume  Editor ", "category": "document"})
	require.NoError(t, err)
	require.Equal(t, agentprofile.Profile{DisplayName: "Resume Editor", Category: "document"}, req.profile)
	require.Empty(t, req.projectID, "no Project is needed for a name")
}

func TestSpawnProfile_FolderAndProjectNeverBecomeTheName(t *testing.T) {
	m, allowed, _ := profilePolicyManager(t)
	req, err := m.enforceSpawnPolicy(map[string]any{"prompt": "p", "cwd": allowed, "projectId": "prj_portfolio"})
	require.NoError(t, err)
	require.True(t, req.profile.Empty(), "no name given means no name — not %q, not the project", filepath.Base(allowed))
	require.Equal(t, "", m.saveProfile(req))
}

func TestSpawnProfile_InvalidInputIsRefused(t *testing.T) {
	m, allowed, _ := profilePolicyManager(t)
	_, err := m.enforceSpawnPolicy(map[string]any{"prompt": "p", "cwd": allowed, "category": "admin"})
	require.ErrorContains(t, err, "unknown agent category")
	_, err = m.enforceSpawnPolicy(map[string]any{"prompt": "p", "cwd": allowed, "displayName": strings.Repeat("n", 61)})
	require.ErrorContains(t, err, "at most 60")
}

// A category or a name never makes a folder allowed and never changes the command.
func TestSpawnProfile_HasNoAuthorizationEffect(t *testing.T) {
	m, allowed, outside := profilePolicyManager(t)

	for _, category := range []string{"runtime", "development", "general"} {
		body, _ := json.Marshal(map[string]any{"prompt": "p", "cwd": outside, "enableChannel": false, "displayName": "Admin", "category": category})
		rr := httptest.NewRecorder()
		NewSpawnHandler(m).Spawn(rr, httptest.NewRequest(http.MethodPost, "/api/agents/spawn", bytes.NewReader(body)))
		require.Equal(t, http.StatusForbidden, rr.Code, "category %s must not open a disallowed folder", category)
	}

	plain, err := m.enforceSpawnPolicy(map[string]any{"prompt": "p", "cwd": allowed})
	require.NoError(t, err)
	named, err := m.enforceSpawnPolicy(map[string]any{"prompt": "p", "cwd": allowed, "displayName": "Research", "category": "research"})
	require.NoError(t, err)
	_, plainArgs, err := m.buildSpawnArgs(plain, nil)
	require.NoError(t, err)
	_, namedArgs, err := m.buildSpawnArgs(named, nil)
	require.NoError(t, err)
	strip := func(args []string) []string { // the pinned session id differs per spawn
		out := append([]string(nil), args...)
		for i := range out {
			if i > 0 && out[i-1] == "--session-id" {
				out[i] = "<id>"
			}
		}
		return out
	}
	require.Equal(t, strip(plainArgs), strip(namedArgs))
	require.NotContains(t, strings.Join(namedArgs, " "), "Research")
}

func TestSpawnProfile_SavedUnderThePinnedSessionID(t *testing.T) {
	m, allowed, _ := profilePolicyManager(t)
	saver := &recordingSaver{}
	m.SetAgentProfiles(saver)

	req, err := m.enforceSpawnPolicy(map[string]any{"prompt": "p", "cwd": allowed, "displayName": "Resume Editor", "category": "document"})
	require.NoError(t, err)
	_, args, err := m.buildSpawnArgs(req, nil)
	require.NoError(t, err)
	pinned := ""
	for i, a := range args {
		if a == "--session-id" {
			pinned = args[i+1]
		}
	}
	require.NotEmpty(t, pinned)
	require.Equal(t, ProfileSaved, m.saveProfile(req))
	require.Equal(t, pinned, saver.sessionID)
	require.Equal(t, "Resume Editor", saver.profile.DisplayName)
}

func TestSpawnProfile_ResumeKeepsItsSession(t *testing.T) {
	m, allowed, _ := profilePolicyManager(t)
	saver := &recordingSaver{}
	m.SetAgentProfiles(saver)
	req, err := m.enforceSpawnPolicy(map[string]any{"prompt": "p", "cwd": allowed, "resumeSessionId": "3f2a1b9c-0000-4000-8000-000000000000", "displayName": "Portfolio"})
	require.NoError(t, err)
	_, _, err = m.buildSpawnArgs(req, nil)
	require.NoError(t, err)
	require.Equal(t, ProfileSaved, m.saveProfile(req))
	require.Equal(t, "3f2a1b9c-0000-4000-8000-000000000000", saver.sessionID)
}

func TestSpawnProfile_ReportsWhatHappened(t *testing.T) {
	m, allowed, _ := profilePolicyManager(t)
	req, err := m.enforceSpawnPolicy(map[string]any{"prompt": "p", "cwd": allowed, "displayName": "Research"})
	require.NoError(t, err)

	// No store, or no session id to key by: said, not silently dropped.
	require.Equal(t, ProfileUnsupported, m.saveProfile(req))
	m.SetAgentProfiles(&recordingSaver{})
	require.Equal(t, ProfileUnsupported, m.saveProfile(req), "buildSpawnArgs has not pinned a session")

	m.SetAgentProfiles(&recordingSaver{err: errors.New("disk full")})
	req.sessionID = "sess"
	require.Equal(t, ProfileFailed, m.saveProfile(req))
}
