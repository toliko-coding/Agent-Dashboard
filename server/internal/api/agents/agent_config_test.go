package agents

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/lx-wnk/agent-dashboard/sdk"
	"github.com/lx-wnk/agent-dashboard/server/internal/agentconfig"
	"github.com/lx-wnk/agent-dashboard/server/internal/db/repo"
)

/*
 * An agent's saved configuration, and the line between an agent and a session.
 *
 * The rule under test throughout: a name and an icon are presentation and stay
 * editable for anything the dashboard can see, while instructions and a
 * permission mode are applied when the dashboard starts a session and so are
 * only accepted for an agent it started.
 */

type memConfigRepo struct {
	rows map[string]repo.DashboardAgentRow
}

func (m *memConfigRepo) Upsert(_ context.Context, row repo.DashboardAgentRow) error {
	m.rows[row.ID] = row
	return nil
}

func (m *memConfigRepo) List(_ context.Context) ([]repo.DashboardAgentRow, error) {
	out := make([]repo.DashboardAgentRow, 0, len(m.rows))
	for _, r := range m.rows {
		out = append(out, r)
	}
	return out, nil
}

func (m *memConfigRepo) Delete(_ context.Context, id string) error {
	delete(m.rows, id)
	return nil
}

func configHandler(t *testing.T, agent sdk.Agent) (*SpawnHandler, *agentconfig.Store) {
	t.Helper()
	store := agentconfig.New(&memConfigRepo{rows: map[string]repo.DashboardAgentRow{}})
	require.NoError(t, store.Load(context.Background()))
	h := NewSpawnHandler(NewSpawnManager(5, 60000, 30, 60000, nil, nil))
	h.SetAgentLookup(fakeAgentLookup{agent.PID: agent})
	h.SetAgentConfigs(store)
	return h, store
}

func configAgent() sdk.Agent {
	return sdk.Agent{
		PID: 4242, SessionID: "sess-owned", DashboardOwned: true,
		Status: sdk.AgentStatusActive, CWD: "/repo/portfolio",
		SessionPermissionMode: "default", DisplayName: "Portfolio Developer",
	}
}

func putConfig(t *testing.T, h *SpawnHandler, pid int, body map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	raw, err := json.Marshal(body)
	require.NoError(t, err)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/api/agents/x/config", bytes.NewReader(raw))
	req.SetPathValue("pid", strconv.Itoa(pid))
	h.UpdateAgentConfig(rec, req)
	return rec
}

func getConfig(t *testing.T, h *SpawnHandler, pid int) (*httptest.ResponseRecorder, sdk.AgentConfigDTO) {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/agents/x/config", nil)
	req.SetPathValue("pid", strconv.Itoa(pid))
	h.AgentConfig(rec, req)
	var dto sdk.AgentConfigDTO
	if rec.Code == http.StatusOK {
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &dto))
	}
	return rec, dto
}

func TestAgentConfig_SavesInstructionsAndModeForAnOwnedAgent(t *testing.T) {
	h, store := configHandler(t, configAgent())

	rec := putConfig(t, h, 4242, map[string]any{
		"displayName":    "Portfolio Developer",
		"instructions":   "Only touch the portfolio repository.",
		"permissionMode": "acceptEdits",
	})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	saved, ok := store.Lookup("sess-owned")
	require.True(t, ok)
	require.Equal(t, "Only touch the portfolio repository.", saved.Instructions)
	require.Equal(t, "acceptEdits", saved.PermissionMode)
	require.NotEmpty(t, saved.AgentID, "the agent gets an identity of its own")
}

// The saved mode describes the next session; the running one keeps what it was
// started with, and the payload has to show both so a UI can say so.
func TestAgentConfig_ReportsSavedAndRunningSeparately(t *testing.T) {
	h, _ := configHandler(t, configAgent())
	require.Equal(t, http.StatusOK, putConfig(t, h, 4242, map[string]any{"permissionMode": "plan"}).Code)

	rec, dto := getConfig(t, h, 4242)
	require.Equal(t, http.StatusOK, rec.Code)
	require.Equal(t, "plan", dto.PermissionMode, "saved, for the next session")
	require.Equal(t, "default", dto.SessionPermissionMode, "what the running process was started with")
	require.True(t, dto.DiffersFromSession)
	require.True(t, dto.ConfigurableHere)
	require.True(t, dto.SessionRunning)
}

func TestAgentConfig_NothingSavedIsNotADifference(t *testing.T) {
	h, _ := configHandler(t, configAgent())
	_, dto := getConfig(t, h, 4242)
	require.False(t, dto.DiffersFromSession)
	require.Equal(t, "Portfolio Developer", dto.DisplayName, "falls back to what the roster shows")
}

// A finished agent is the whole point of a durable record.
func TestAgentConfig_SurvivesTheSessionEnding(t *testing.T) {
	running := configAgent()
	h, store := configHandler(t, running)
	require.Equal(t, http.StatusOK, putConfig(t, h, 4242, map[string]any{
		"instructions": "standing orders", "permissionMode": "acceptEdits",
	}).Code)

	// The same agent, after its process exited: same session id, finished card.
	finished := running
	finished.Status = sdk.AgentStatusFinished
	finished.SessionPermissionMode = ""
	h2 := NewSpawnHandler(NewSpawnManager(5, 60000, 30, 60000, nil, nil))
	h2.SetAgentLookup(fakeAgentLookup{finished.PID: finished})
	h2.SetAgentConfigs(store)

	_, dto := getConfig(t, h2, 4242)
	require.Equal(t, "standing orders", dto.Instructions)
	require.Equal(t, "acceptEdits", dto.PermissionMode)
	require.False(t, dto.SessionRunning)
	require.False(t, dto.DiffersFromSession, "a session that is not running cannot disagree")
}

/*
 * An external session gains nothing.
 *
 * It can still be labelled — that was true before this endpoint existed and
 * narrowing it would be a regression — but instructions and a permission mode
 * are applied when the dashboard starts a session, so they are refused for a
 * session it did not start.
 */
func TestAgentConfig_ExternalSessionCannotBeConfigured(t *testing.T) {
	external := configAgent()
	external.DashboardOwned = false
	external.SessionID = "sess-external"
	h, store := configHandler(t, external)

	for _, field := range []map[string]any{
		{"instructions": "do as I say"},
		{"permissionMode": "bypassPermissions"},
	} {
		rec := putConfig(t, h, 4242, field)
		require.Equal(t, http.StatusForbidden, rec.Code, "%v", field)
		require.Contains(t, rec.Body.String(), "observed, not configured")
	}
	_, saved := store.Lookup("sess-external")
	require.False(t, saved, "nothing was written for an external session")

	rec := putConfig(t, h, 4242, map[string]any{"displayName": "Someone else's session"})
	require.Equal(t, http.StatusOK, rec.Code, "a name is presentation and stays editable")
}

func TestAgentConfig_RefusesAnUnknownPermissionMode(t *testing.T) {
	h, store := configHandler(t, configAgent())
	rec := putConfig(t, h, 4242, map[string]any{"permissionMode": "yolo"})
	require.Equal(t, http.StatusBadRequest, rec.Code)
	require.Contains(t, rec.Body.String(), "unknown permission mode")
	_, saved := store.Lookup("sess-owned")
	require.False(t, saved)
}

func TestAgentConfig_RefusesWhenThereIsNoSessionToKeyItBy(t *testing.T) {
	agent := configAgent()
	agent.SessionID = ""
	h, _ := configHandler(t, agent)
	rec := putConfig(t, h, 4242, map[string]any{"displayName": "x"})
	require.Equal(t, http.StatusConflict, rec.Code)
}

func TestAgentConfig_UnknownPidIs404(t *testing.T) {
	h, _ := configHandler(t, configAgent())
	rec, _ := getConfig(t, h, 9999)
	require.Equal(t, http.StatusNotFound, rec.Code)
}

func TestInstructionsFingerprintDistinguishesText(t *testing.T) {
	require.Equal(t, InstructionsFingerprint("a"), InstructionsFingerprint("a"))
	require.NotEqual(t, InstructionsFingerprint("a"), InstructionsFingerprint("b"))
	require.NotEmpty(t, InstructionsFingerprint(""), "empty instructions still have a fingerprint to compare")
}
