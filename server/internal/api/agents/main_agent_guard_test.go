package agents

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/lx-wnk/agent-dashboard/sdk"
	"github.com/lx-wnk/agent-dashboard/server/internal/agentconfig"
	"github.com/lx-wnk/agent-dashboard/server/internal/services"
)

/*
 * Never a second main agent.
 *
 * The main agent maintains this dashboard, and its session is normally the
 * Claude running in the user's own editor - observed here, owned there. Both
 * routes that can start a session for an existing session id refuse while one
 * is already running it, so no surface can produce two Managers by accident.
 *
 * This is not a permission level. The main agent is a role: it gains nothing
 * and is refused here exactly as any other agent would be.
 */

const mainSession = "5d0ab190-599e-41ea-ac37-9fa9d739019a"

func mainAgentStore(cwd string) *fakeDashboardAgents {
	return newFakeDashboardAgents(agentconfig.Config{
		AgentID:     agentconfig.MainAgentID,
		DisplayName: "Agent Dashboard Manager",
		Role:        agentconfig.RoleMain,
		SessionID:   mainSession,
		Cwd:         cwd,
	})
}

func spawnManagerFor(store AgentConfigStore, liveSessions ...string) *SpawnManager {
	m := NewSpawnManager(5, 60000, 30, 60000, nil, services.NewSpawnPolicy(nil))
	m.SetAgentConfigs(store)
	m.SetLiveSessionLookup(func(sessionID string) bool {
		for _, s := range liveSessions {
			if s == sessionID {
				return true
			}
		}
		return false
	})
	return m
}

func TestSpawn_RefusesToResumeTheMainAgentWhileItIsRunning(t *testing.T) {
	cwd := t.TempDir()
	m := spawnManagerFor(mainAgentStore(cwd), mainSession)

	_, err := m.enforceSpawnPolicyFor(map[string]any{
		"prompt":          "carry on",
		"cwd":             cwd,
		"resumeSessionId": mainSession,
	}, true)

	require.ErrorIs(t, err, errMainAgentAlreadyRunning)
}

// With no session running it, starting the main agent is ordinary and allowed:
// the guard is about a second process, not about the agent.
func TestSpawn_ResumesTheMainAgentWhenNoSessionIsRunningIt(t *testing.T) {
	cwd := t.TempDir()
	m := spawnManagerFor(mainAgentStore(cwd))

	req, err := m.enforceSpawnPolicyFor(map[string]any{
		"prompt":          "carry on",
		"cwd":             cwd,
		"resumeSessionId": mainSession,
	}, true)

	require.NoError(t, err)
	require.Equal(t, mainSession, req.resumeSessionID)
}

// Any other agent resumes while running, as it always has.
func TestSpawn_LeavesOrdinaryAgentsAlone(t *testing.T) {
	cwd := t.TempDir()
	store := newFakeDashboardAgents(agentconfig.Config{AgentID: "a-portfolio", DisplayName: "Portfolio Developer", SessionID: "f7e1bb35-f803-4df1-959e-5c373798c352", Cwd: cwd})
	m := spawnManagerFor(store, "f7e1bb35-f803-4df1-959e-5c373798c352")

	_, err := m.enforceSpawnPolicyFor(map[string]any{
		"prompt":          "carry on",
		"cwd":             cwd,
		"resumeSessionId": "f7e1bb35-f803-4df1-959e-5c373798c352",
	}, true)

	require.NoError(t, err)
}

/*
 * The stale-card case: a card says finished for a session that is in fact
 * alive. Resuming it here would leave two processes maintaining this dashboard,
 * so the route refuses rather than trusting the card.
 */
func TestResumeUnderDashboard_RefusesASecondMainAgent(t *testing.T) {
	cwd := t.TempDir()
	agent := sdk.Agent{PID: 79189, SessionID: mainSession, Status: sdk.AgentStatusFinished, CWD: cwd, Provider: sdk.ProviderClaude}
	f := newLifecycleFixture(t, agent)
	f.ownAgent(t, agent)
	f.h.SetAgentConfigs(mainAgentStore(cwd))
	f.h.SetLiveSessionLookup(func(sessionID string) bool { return sessionID == mainSession })
	f.h.resumeSpawn = func(string, map[string]any) (SpawnOutcome, error) {
		t.Fatal("a second main agent was started")
		return SpawnOutcome{}, nil
	}

	rr, body := f.do(http.MethodPost, "/api/agents/79189/resume-under-dashboard", 79189, f.h.ResumeUnderDashboard)

	require.Equal(t, http.StatusConflict, rr.Code, rr.Body.String())
	require.Equal(t, true, body["main"])
	require.Empty(t, f.killed, "a refused resume ended a process anyway")
}
