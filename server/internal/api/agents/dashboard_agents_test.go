package agents

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/lx-wnk/agent-dashboard/sdk"
	"github.com/lx-wnk/agent-dashboard/server/internal/agentconfig"
	"github.com/lx-wnk/agent-dashboard/server/internal/services"
)

/*
 * The agents this dashboard keeps, addressed by agent id.
 *
 * A finished agent used to disappear from the Agents page whenever the server
 * restarted, because the only record of it was the merger's in-process registry
 * of recently-finished cards. These routes are the durable half, so the tests
 * here are mostly about what must NOT happen: the main agent is never deleted,
 * a record is never removed from under a running session, and deleting an agent
 * never reaches anything but the dashboard's own record of it.
 */

type fakeDashboardAgents struct {
	rows    map[string]agentconfig.Config
	deleted []string
}

func newFakeDashboardAgents(cfgs ...agentconfig.Config) *fakeDashboardAgents {
	f := &fakeDashboardAgents{rows: map[string]agentconfig.Config{}}
	for _, c := range cfgs {
		f.rows[c.AgentID] = c
	}
	return f
}

func (f *fakeDashboardAgents) List() []agentconfig.Config {
	out := make([]agentconfig.Config, 0, len(f.rows))
	for _, c := range f.rows {
		out = append(out, c)
	}
	return out
}

func (f *fakeDashboardAgents) ByID(id string) (agentconfig.Config, bool) {
	c, ok := f.rows[id]
	return c, ok
}

func (f *fakeDashboardAgents) SaveByID(_ context.Context, id string, patch agentconfig.Patch) (agentconfig.Config, error) {
	c, ok := f.rows[id]
	if !ok {
		return agentconfig.Config{}, agentconfig.ErrNotFound
	}
	if patch.DisplayName != nil {
		c.DisplayName = *patch.DisplayName
	}
	if patch.PermissionMode != nil {
		c.PermissionMode = *patch.PermissionMode
	}
	if patch.Instructions != nil {
		c.Instructions = *patch.Instructions
	}
	f.rows[id] = c
	return c, nil
}

// The same fake answers the session-keyed interface, so a delete through an
// agent's card and a delete through its stored record act on one store.
func (f *fakeDashboardAgents) Lookup(sessionID string) (agentconfig.Config, bool) {
	for _, c := range f.rows {
		if c.SessionID != "" && c.SessionID == sessionID {
			return c, true
		}
	}
	return agentconfig.Config{}, false
}

func (f *fakeDashboardAgents) SaveForSession(_ context.Context, sessionID string, patch agentconfig.Patch) (agentconfig.Config, error) {
	c, ok := f.Lookup(sessionID)
	if !ok {
		// First save for a session creates the agent, as the real store does.
		c = agentconfig.Config{AgentID: "generated-" + sessionID, SessionID: sessionID}
		f.rows[c.AgentID] = c
	}
	return f.SaveByID(context.Background(), c.AgentID, patch)
}

func (f *fakeDashboardAgents) BindSession(_ context.Context, agentID, sessionID string) (agentconfig.Config, error) {
	c, ok := f.rows[agentID]
	if !ok {
		return agentconfig.Config{}, agentconfig.ErrNotFound
	}
	c.SessionID = sessionID
	f.rows[agentID] = c
	return c, nil
}

func (f *fakeDashboardAgents) DeleteForSession(ctx context.Context, sessionID string) (bool, error) {
	c, ok := f.Lookup(sessionID)
	if !ok {
		return false, nil
	}
	return f.DeleteByID(ctx, c.AgentID)
}

func (f *fakeDashboardAgents) DeleteByID(_ context.Context, id string) (bool, error) {
	c, ok := f.rows[id]
	if !ok {
		return false, nil
	}
	if c.IsMain() {
		return false, agentconfig.ErrMainAgentPermanent
	}
	delete(f.rows, id)
	f.deleted = append(f.deleted, id)
	return true, nil
}

func dashboardHandler(store DashboardAgentStore, live ...string) *SpawnHandler {
	h := &SpawnHandler{}
	h.SetDashboardAgents(store)
	h.SetLiveSessionLookup(func(sessionID string) bool {
		for _, s := range live {
			if s == sessionID {
				return true
			}
		}
		return false
	})
	return h
}

func callByID(t *testing.T, h func(http.ResponseWriter, *http.Request), method, id, body string) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	r := httptest.NewRequest(method, "/api/dashboard-agents/"+id, strings.NewReader(body))
	r.SetPathValue("id", id)
	rr := httptest.NewRecorder()
	h(rr, r)
	out := map[string]any{}
	_ = json.Unmarshal(rr.Body.Bytes(), &out)
	return rr, out
}

var (
	mainCfg      = agentconfig.Config{AgentID: agentconfig.MainAgentID, DisplayName: "Agent Dashboard Manager", Role: agentconfig.RoleMain, SessionID: "sess-main", Cwd: "/repo/agent-dashboard"}
	resumeCfg    = agentconfig.Config{AgentID: "a-resume", DisplayName: "Resume Editor", Category: "document", SessionID: "sess-resume", Cwd: "/work/Resume-Editor", PermissionMode: "acceptEdits", Instructions: "Only the tailored folder."}
	portfolioCfg = agentconfig.Config{AgentID: "a-portfolio", DisplayName: "Portfolio Developer", Category: "web", SessionID: "sess-portfolio", Cwd: "/work/portfolio"}
)

// The list is the durable half of the roster, so it holds an agent whose
// session is long gone - which is the whole reason it exists.
func TestListDashboardAgents_HoldsAgentsWithNoSessionRunning(t *testing.T) {
	h := dashboardHandler(newFakeDashboardAgents(mainCfg, resumeCfg, portfolioCfg))
	r := httptest.NewRequest(http.MethodGet, "/api/dashboard-agents", nil)
	rr := httptest.NewRecorder()
	h.ListDashboardAgents(rr, r)
	require.Equal(t, http.StatusOK, rr.Code)

	var got []sdk.DashboardAgentDTO
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &got))
	require.Len(t, got, 3)
	// The main agent first, then by name: a stable order, so the list does not
	// shuffle between reads.
	require.Equal(t, agentconfig.MainAgentID, got[0].AgentID)
	require.Equal(t, "Portfolio Developer", got[1].DisplayName)
	require.Equal(t, "Resume Editor", got[2].DisplayName)

	// Instructions can run to thousands of characters and nothing in a list
	// shows them; whether any exist is the fact a list needs.
	require.True(t, got[2].HasInstructions)
	require.Equal(t, "acceptEdits", got[2].PermissionMode)
	require.NotContains(t, rr.Body.String(), "Only the tailored folder.")
}

func TestDeleteDashboardAgent_RemovesOnlyTheDashboardsRecord(t *testing.T) {
	store := newFakeDashboardAgents(mainCfg, resumeCfg)
	h := dashboardHandler(store)

	rr, body := callByID(t, h.DeleteDashboardAgent, http.MethodDelete, "a-resume", "")
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	require.Equal(t, true, body["deleted"])
	require.Equal(t, []string{"a-resume"}, store.deleted)
	_, ok := store.ByID("a-resume")
	require.False(t, ok)
}

/*
 * The main agent is permanent, and says so whether or not it is running.
 *
 * Its session is normally alive - it maintains this dashboard - so answering
 * "stop it and try again" would point at something that will never be allowed.
 */
func TestDeleteDashboardAgent_RefusesTheMainAgent(t *testing.T) {
	for _, live := range []bool{false, true} {
		store := newFakeDashboardAgents(mainCfg)
		h := dashboardHandler(store)
		if live {
			h = dashboardHandler(store, "sess-main")
		}
		rr, body := callByID(t, h.DeleteDashboardAgent, http.MethodDelete, agentconfig.MainAgentID, "")
		require.Equal(t, http.StatusForbidden, rr.Code, "live=%v: %s", live, rr.Body.String())
		require.Equal(t, true, body["main"])
		require.Contains(t, body["error"], "cannot be deleted")
		_, ok := store.ByID(agentconfig.MainAgentID)
		require.True(t, ok, "the main agent was deleted")
	}
}

// A record is never removed from under a running process: that would leave the
// process running and the dashboard unable to name it.
func TestDeleteDashboardAgent_RefusesWhileItsSessionRuns(t *testing.T) {
	store := newFakeDashboardAgents(portfolioCfg)
	h := dashboardHandler(store, "sess-portfolio")

	rr, body := callByID(t, h.DeleteDashboardAgent, http.MethodDelete, "a-portfolio", "")
	require.Equal(t, http.StatusConflict, rr.Code, rr.Body.String())
	require.Equal(t, true, body["running"])
	_, ok := store.ByID("a-portfolio")
	require.True(t, ok)
}

func TestDeleteDashboardAgent_UnknownAgent(t *testing.T) {
	h := dashboardHandler(newFakeDashboardAgents(resumeCfg))
	rr, _ := callByID(t, h.DeleteDashboardAgent, http.MethodDelete, "a-nothing", "")
	require.Equal(t, http.StatusNotFound, rr.Code)
}

func TestUpdateDashboardAgent_SavesWhatTheNextSessionStartsWith(t *testing.T) {
	store := newFakeDashboardAgents(portfolioCfg)
	h := dashboardHandler(store)

	rr, _ := callByID(t, h.UpdateDashboardAgent, http.MethodPut, "a-portfolio",
		`{"permissionMode":"acceptEdits","instructions":"Keep to the portfolio repository."}`)
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())

	got, _ := store.ByID("a-portfolio")
	require.Equal(t, "acceptEdits", got.PermissionMode)
	require.Equal(t, "Keep to the portfolio repository.", got.Instructions)
}

// A server that stores no agents says so, rather than answering with an empty
// list that would read as "this dashboard keeps none".
func TestDashboardAgents_WithoutAStoreAnswer503(t *testing.T) {
	h := &SpawnHandler{}
	rr := httptest.NewRecorder()
	h.ListDashboardAgents(rr, httptest.NewRequest(http.MethodGet, "/api/dashboard-agents", nil))
	require.Equal(t, http.StatusServiceUnavailable, rr.Code)

	rr2, _ := callByID(t, h.DeleteDashboardAgent, http.MethodDelete, "a-resume", "")
	require.Equal(t, http.StatusServiceUnavailable, rr2.Code)
}

/*
 * Deleting an agent from its own card removes the durable record too.
 *
 * Before this, Delete stopped the process and dropped the card, and the agent
 * came back on the next read from storage - the user had deleted an agent that
 * was still there. What must NOT follow is equally specific: the folder and the
 * repository are the user's work, and nothing here touches them.
 */
func TestDeleteAgent_RemovesTheDurableAgentRecord(t *testing.T) {
	work := t.TempDir()
	agent := sdk.Agent{PID: 5919, SessionID: "sess-resume", Status: sdk.AgentStatusFinished, CWD: work, ProjectPath: work}
	f := newLifecycleFixture(t, agent)
	f.ownAgent(t, agent)
	store := newFakeDashboardAgents(mainCfg, agentconfig.Config{AgentID: "a-resume", DisplayName: "Resume Editor", SessionID: "sess-resume", Cwd: work})
	f.h.SetAgentConfigs(store)

	rr, _ := f.do(http.MethodDelete, "/api/agents/5919", 5919, f.h.DeleteAgent)
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())

	_, ok := store.ByID("a-resume")
	require.False(t, ok, "the agent came back from storage after being deleted")
	require.DirExists(t, work, "deleting an agent deleted its working folder")
}

// The main agent is permanent through this route as well: one rule, whichever
// way the user arrives at it.
func TestDeleteAgent_RefusesTheMainAgent(t *testing.T) {
	work := t.TempDir()
	agent := sdk.Agent{PID: 79189, SessionID: "sess-main", Status: sdk.AgentStatusFinished, CWD: work, ProjectPath: work}
	f := newLifecycleFixture(t, agent)
	f.ownAgent(t, agent)
	store := newFakeDashboardAgents(mainCfg)
	f.h.SetAgentConfigs(store)

	rr, body := f.do(http.MethodDelete, "/api/agents/79189", 79189, f.h.DeleteAgent)
	require.Equal(t, http.StatusForbidden, rr.Code, rr.Body.String())
	require.Equal(t, true, body["main"])
	_, ok := store.ByID(agentconfig.MainAgentID)
	require.True(t, ok, "the main agent was deleted through its card")
	require.Empty(t, f.killed, "a refused delete stopped the process anyway")
}

// An external session is observed, not managed: its record is not the
// dashboard's to remove, and the refusal must come before anything is changed.
func TestDeleteAgent_LeavesAnExternalAgentsRecordAlone(t *testing.T) {
	work := t.TempDir()
	agent := sdk.Agent{PID: 4242, SessionID: "sess-external", Status: sdk.AgentStatusActive, CWD: work, ProjectPath: work}
	f := newLifecycleFixture(t, agent)
	store := newFakeDashboardAgents(agentconfig.Config{AgentID: "a-external", DisplayName: "Someone else's session", SessionID: "sess-external", Cwd: work})
	f.h.SetAgentConfigs(store)

	rr, _ := f.do(http.MethodDelete, "/api/agents/4242", 4242, f.h.DeleteAgent)
	require.Equal(t, http.StatusForbidden, rr.Code, rr.Body.String())
	_, ok := store.ByID("a-external")
	require.True(t, ok, "an external session's record was deleted")
	require.Empty(t, store.deleted)
}

/*
 * Start or resume is derived from what is on disk, never from the id alone.
 *
 * A durable agent outlives its sessions, so a stored session id proves nothing:
 * the transcript may have been pruned. Resuming one Claude cannot open would
 * start an empty session while telling the user it was continuing theirs.
 */
func TestDashboardAgentConfig_SaysWhetherTheLastSessionCanBeResumed(t *testing.T) {
	store := newFakeDashboardAgents(resumeCfg)

	h := dashboardHandler(store)
	h.SetResumableLookup(func(sessionID string) bool { return sessionID == "sess-resume" })
	rr, body := callByID(t, h.DashboardAgentConfig, http.MethodGet, "a-resume", "")
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	require.Equal(t, true, body["resumable"])
	// This is the surface that shows them, so this is where instructions are read.
	require.Equal(t, "Only the tailored folder.", body["instructions"])
	require.Equal(t, "/work/Resume-Editor", body["cwd"])

	gone := dashboardHandler(store)
	gone.SetResumableLookup(func(string) bool { return false })
	_, body2 := callByID(t, gone.DashboardAgentConfig, http.MethodGet, "a-resume", "")
	require.Equal(t, false, body2["resumable"])

	// With no lookup wired at all, an agent reports as not resumable: the
	// surface then offers to start one rather than promise a conversation.
	bare := dashboardHandler(store)
	_, body3 := callByID(t, bare.DashboardAgentConfig, http.MethodGet, "a-resume", "")
	require.Equal(t, false, body3["resumable"])

	rr4, _ := callByID(t, h.DashboardAgentConfig, http.MethodGet, "a-nothing", "")
	require.Equal(t, http.StatusNotFound, rr4.Code)
}

/*
 * Starting an agent that already exists keeps that agent.
 *
 * The new session has a session id nothing has seen before, so saving the
 * configuration against it would create a second durable agent - same name,
 * same folder, different id. The record is pointed at the new session instead.
 */
func TestSaveAgentConfig_StartingAnExistingAgentCreatesNoSecondOne(t *testing.T) {
	store := newFakeDashboardAgents(portfolioCfg)
	m := NewSpawnManager(5, 60000, 30, 60000, nil, services.NewSpawnPolicy(nil))
	m.SetAgentConfigs(store)

	m.saveAgentConfig(&spawnRequest{
		agentID:        "a-portfolio",
		sessionID:      "a-brand-new-session",
		cwd:            "/work/portfolio",
		systemPrompt:   "Keep to the portfolio repository.",
		permissionMode: "acceptEdits",
	})

	require.Len(t, store.rows, 1, "a second durable agent was created for the same agent")
	got, ok := store.ByID("a-portfolio")
	require.True(t, ok)
	require.Equal(t, "a-brand-new-session", got.SessionID, "the agent was not pointed at its new session")
	require.Equal(t, "Keep to the portfolio repository.", got.Instructions)
	require.Equal(t, "acceptEdits", got.PermissionMode)
	require.Equal(t, "Portfolio Developer", got.DisplayName, "starting an agent renamed it")
}

// A spawn that names no agent still creates one, as it always has.
func TestSaveAgentConfig_ANewAgentIsStillCreated(t *testing.T) {
	store := newFakeDashboardAgents()
	m := NewSpawnManager(5, 60000, 30, 60000, nil, services.NewSpawnPolicy(nil))
	m.SetAgentConfigs(store)

	m.saveAgentConfig(&spawnRequest{sessionID: "sess-fresh", cwd: "/work/new"})
	require.Len(t, store.rows, 1)
}

/*
 * Stopping a session is not deleting an agent.
 *
 * The process ends; the agent stays, with its name, its folder, its
 * instructions and its saved permission mode, ready to be started again. This
 * is the distinction the durable record exists to make, and the one a user
 * relies on every time they stop something.
 */
func TestStopAgent_LeavesTheDurableAgent(t *testing.T) {
	work := t.TempDir()
	agent := sdk.Agent{PID: 51, SessionID: "sess-portfolio", Status: sdk.AgentStatusActive, CWD: work, ProjectPath: work}
	f := newLifecycleFixture(t, agent)
	f.ownAgent(t, agent)
	f.alive[51] = true
	store := newFakeDashboardAgents(agentconfig.Config{
		AgentID:        "a-portfolio",
		DisplayName:    "Portfolio Developer",
		SessionID:      "sess-portfolio",
		Cwd:            work,
		Instructions:   "Keep to the portfolio repository.",
		PermissionMode: "acceptEdits",
	})
	f.h.SetAgentConfigs(store)

	rr, _ := f.do(http.MethodPost, "/api/agents/51/stop", 51, f.h.StopAgent)
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	require.Equal(t, []int{51}, f.killed, "the process was not stopped")

	got, ok := store.ByID("a-portfolio")
	require.True(t, ok, "stopping a session deleted the agent")
	require.Empty(t, store.deleted)
	require.Equal(t, "Keep to the portfolio repository.", got.Instructions, "stopping lost the agent's configuration")
	require.Equal(t, "acceptEdits", got.PermissionMode)
	require.Equal(t, "sess-portfolio", got.SessionID, "stopping unlinked the agent from its session")
}
