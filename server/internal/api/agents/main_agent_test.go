package agents

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/lx-wnk/agent-dashboard/sdk"
	"github.com/lx-wnk/agent-dashboard/server/internal/agentconfig"
	"github.com/lx-wnk/agent-dashboard/server/internal/db/repo"
)

/*
 * The main agent is seeded, never handed out.
 *
 * There is no route that promotes an ordinary agent, which is what makes
 * "exactly one main agent" true by construction rather than by a rule someone
 * has to enforce. The only thing that can be set is which session is running
 * it, and doing so grants that session nothing: ownership still decides Stop,
 * Delete and terminal attach.
 */

func mainAgentHandler(t *testing.T, seed bool, agents ...sdk.Agent) (*SpawnHandler, *agentconfig.Store) {
	t.Helper()
	store := agentconfig.New(&memConfigRepo{rows: map[string]repo.DashboardAgentRow{}})
	require.NoError(t, store.Load(context.Background()))
	if seed {
		_, err := store.EnsureMain(context.Background(), "/repo/agent-dashboard")
		require.NoError(t, err)
	}
	lookup := fakeAgentLookup{}
	for _, a := range agents {
		lookup[a.PID] = a
	}
	h := NewSpawnHandler(NewSpawnManager(5, 60000, 30, 60000, nil, nil))
	h.SetAgentLookup(lookup)
	h.SetMainAgents(store)
	return h, store
}

func getMain(t *testing.T, h *SpawnHandler) (*httptest.ResponseRecorder, sdk.MainAgentDTO) {
	t.Helper()
	rec := httptest.NewRecorder()
	h.MainAgent(rec, httptest.NewRequest(http.MethodGet, "/api/main-agent", nil))
	var dto sdk.MainAgentDTO
	if rec.Code == http.StatusOK {
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &dto))
	}
	return rec, dto
}

func linkMain(t *testing.T, h *SpawnHandler, pid int) *httptest.ResponseRecorder {
	t.Helper()
	raw, err := json.Marshal(map[string]any{"pid": pid})
	require.NoError(t, err)
	rec := httptest.NewRecorder()
	h.LinkMainAgentSession(rec, httptest.NewRequest(http.MethodPost, "/api/main-agent/session", bytes.NewReader(raw)))
	return rec
}

func TestMainAgent_ReportsTheSeededRecord(t *testing.T) {
	h, _ := mainAgentHandler(t, true)

	rec, dto := getMain(t, h)

	require.Equal(t, http.StatusOK, rec.Code)
	require.Equal(t, agentconfig.MainAgentID, dto.AgentID, "a fixed id, so it is the same record across restarts")
	require.Equal(t, agentconfig.MainAgentDefaultName, dto.DisplayName)
	require.Equal(t, "/repo/agent-dashboard", dto.Cwd)
	require.Empty(t, dto.SessionID, "no session is linked until someone says which one")
}

func TestMainAgent_IsAbsentUntilSeeded(t *testing.T) {
	h, _ := mainAgentHandler(t, false)
	rec, _ := getMain(t, h)
	require.Equal(t, http.StatusNotFound, rec.Code)
}

/*
 * The agent maintaining this dashboard is usually a session started from an
 * editor, which the dashboard did not launch. Linking it records which process
 * is running the main agent right now; it does not make that session owned, and
 * every control keeps asking ownership, not role.
 */
func TestMainAgent_LinksAnExternalSessionWithoutGrantingAnything(t *testing.T) {
	external := sdk.Agent{PID: 79189, SessionID: "sess-manager", Status: sdk.AgentStatusActive, CWD: "/repo/agent-dashboard"}
	h, store := mainAgentHandler(t, true, external)

	rec := linkMain(t, h, 79189)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	main, ok := store.Main()
	require.True(t, ok)
	require.Equal(t, "sess-manager", main.SessionID)
	require.True(t, main.IsMain())
	require.Len(t, store.List(), 1, "linking creates no second agent")
	require.False(t, external.DashboardOwned, "the session is untouched: still not owned")
}

func TestMainAgent_LinkRefusesWhatIsNotASessionOnThisMachine(t *testing.T) {
	internal := sdk.Agent{PID: 11, SessionID: "sess-daemon", InternalProcess: true}
	remote := sdk.Agent{PID: 12, SessionID: "sess-remote", Machine: "other-mac"}
	noSession := sdk.Agent{PID: 13}
	h, store := mainAgentHandler(t, true, internal, remote, noSession)

	require.Equal(t, http.StatusForbidden, linkMain(t, h, 11).Code)
	require.Equal(t, http.StatusForbidden, linkMain(t, h, 12).Code)
	require.Equal(t, http.StatusConflict, linkMain(t, h, 13).Code)
	require.Equal(t, http.StatusNotFound, linkMain(t, h, 9999).Code)

	main, _ := store.Main()
	require.Empty(t, main.SessionID, "nothing was linked")
}

func TestMainAgent_LinkingPidZeroClearsTheSession(t *testing.T) {
	external := sdk.Agent{PID: 79189, SessionID: "sess-manager", Status: sdk.AgentStatusActive}
	h, store := mainAgentHandler(t, true, external)
	require.Equal(t, http.StatusOK, linkMain(t, h, 79189).Code)

	require.Equal(t, http.StatusOK, linkMain(t, h, 0).Code)

	main, _ := store.Main()
	require.Empty(t, main.SessionID)
	require.True(t, main.IsMain(), "clearing the session does not remove the role")
}

// Re-linking follows the session without changing which agent is main.
func TestMainAgent_RelinkingKeepsOneMainAgent(t *testing.T) {
	first := sdk.Agent{PID: 100, SessionID: "sess-one", Status: sdk.AgentStatusActive}
	second := sdk.Agent{PID: 200, SessionID: "sess-two", Status: sdk.AgentStatusActive}
	h, store := mainAgentHandler(t, true, first, second)

	require.Equal(t, http.StatusOK, linkMain(t, h, 100).Code)
	require.Equal(t, http.StatusOK, linkMain(t, h, 200).Code)

	main, _ := store.Main()
	require.Equal(t, "sess-two", main.SessionID)
	require.Equal(t, agentconfig.MainAgentID, main.AgentID)
	mains := 0
	for _, cfg := range store.List() {
		if cfg.IsMain() {
			mains++
		}
	}
	require.Equal(t, 1, mains)
}

// An agent configured through the ordinary route never acquires the role: the
// patch has no field for it, so there is nothing to send.
func TestMainAgent_OrdinaryConfigurationCannotSetTheRole(t *testing.T) {
	ordinary := configAgent()
	store := agentconfig.New(&memConfigRepo{rows: map[string]repo.DashboardAgentRow{}})
	require.NoError(t, store.Load(context.Background()))
	_, err := store.EnsureMain(context.Background(), "/repo/agent-dashboard")
	require.NoError(t, err)
	h := NewSpawnHandler(NewSpawnManager(5, 60000, 30, 60000, nil, nil))
	h.SetAgentLookup(fakeAgentLookup{ordinary.PID: ordinary})
	h.SetAgentConfigs(store)
	h.SetMainAgents(store)

	rec := putConfig(t, h, ordinary.PID, map[string]any{
		"displayName": "Project Intelligence", "role": "main", "instructions": "analyse only",
	})
	require.Equal(t, http.StatusOK, rec.Code)

	saved, ok := store.Lookup(ordinary.SessionID)
	require.True(t, ok)
	require.False(t, saved.IsMain(), "an ordinary agent cannot become main")
	main, _ := store.Main()
	require.Equal(t, agentconfig.MainAgentID, main.AgentID, "the main agent did not move")
}
