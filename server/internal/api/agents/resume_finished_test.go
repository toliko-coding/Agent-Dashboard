package agents

import (
	"context"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/lx-wnk/agent-dashboard/sdk"
	"github.com/lx-wnk/agent-dashboard/server/internal/agentconfig"
	"github.com/lx-wnk/agent-dashboard/server/internal/db/repo"
	"github.com/lx-wnk/agent-dashboard/server/internal/managedagent"
)

/*
 * Resuming an agent this dashboard already owns, once its session has ended.
 *
 * Sending such an agent a message also resumes it, but silently and with none
 * of its configuration. Resume is the path that shows what the next session
 * will start with and asks first, so it has to be available for an owned agent
 * that has finished - there is no running session to take over, and the agent
 * already belongs here, so nothing about ownership changes either way.
 *
 * While a process is still running, resume stays refused: that case is about
 * taking over a session, not starting one.
 */

func ownedFinished(t *testing.T) (*lifecycleFixture, *resumeSeams, *agentconfig.Store) {
	t.Helper()
	agent := legacyAgent(5919, sdk.AgentStatusFinished)
	f := newLifecycleFixture(t, agent)
	seams := f.withResumeSeams(false)
	f.own(t, managedagent.Record{SessionID: legacySession, PID: 5919, Cwd: agent.CWD})

	store := agentconfig.New(&memConfigRepo{rows: map[string]repo.DashboardAgentRow{}})
	require.NoError(t, store.Load(context.Background()))
	f.h.SetAgentConfigs(store)
	return f, seams, store
}

func TestControl_OwnedFinishedAgentCanBeResumed(t *testing.T) {
	f, _, _ := ownedFinished(t)

	rr, body := f.do(http.MethodGet, "/api/agents/5919/control", 5919, f.h.GetAgentControl)

	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	require.Equal(t, true, body["owned"], "it is still an agent this dashboard owns")
	resume, _ := body["resume"].(map[string]any)
	require.Equal(t, true, resume["available"], "its session has ended, so the next one can be started here")
	require.Equal(t, false, resume["endsRunningSession"], "there is nothing running to end")
}

// A running owned agent is a different case: there the session would have to be
// taken over, and Stop is the honest action instead.
func TestControl_OwnedRunningAgentIsStillNotResumable(t *testing.T) {
	agent := legacyAgent(5919, sdk.AgentStatusActive)
	f := newLifecycleFixture(t, agent)
	f.alive[5919] = true
	f.own(t, managedagent.Record{SessionID: legacySession, PID: 5919, Cwd: agent.CWD})

	rr, body := f.do(http.MethodGet, "/api/agents/5919/control", 5919, f.h.GetAgentControl)

	require.Equal(t, http.StatusOK, rr.Code)
	resume, _ := body["resume"].(map[string]any)
	require.Equal(t, false, resume["available"])
	require.Contains(t, resume["reason"], "Already managed")
}

func TestResume_OwnedFinishedAgentStartsWithItsConfirmedConfiguration(t *testing.T) {
	f, seams, store := ownedFinished(t)
	_, err := store.SaveForSession(context.Background(), legacySession, agentconfig.Patch{
		Instructions:   str("Only touch the portfolio repository."),
		PermissionMode: str("acceptEdits"),
	})
	require.NoError(t, err)

	rr, _ := resumeWith(t, f, map[string]any{
		"confirmed":               true,
		"permissionMode":          "acceptEdits",
		"instructionsFingerprint": InstructionsFingerprint("Only touch the portfolio repository."),
	})

	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	require.Len(t, seams.spawns, 1)
	require.Equal(t, "acceptEdits", seams.spawns[0]["permissionMode"])
	require.Equal(t, "Only touch the portfolio repository.", seams.spawns[0]["systemPrompt"])
	require.Equal(t, legacySession, seams.spawns[0]["resumeSessionId"], "the same conversation continues")
	require.Empty(t, seams.exits, "nothing had to be ended: the session was already over")
}

func TestResume_OwnedRunningAgentIsStillRefused(t *testing.T) {
	agent := legacyAgent(5919, sdk.AgentStatusActive)
	f := newLifecycleFixture(t, agent)
	f.alive[5919] = true
	seams := f.withResumeSeams(false)
	f.own(t, managedagent.Record{SessionID: legacySession, PID: 5919, Cwd: agent.CWD})

	rr, body := resumeWith(t, f, map[string]any{"confirmed": true, "permissionMode": "default"})

	require.Equal(t, http.StatusConflict, rr.Code)
	require.Equal(t, true, body["owned"])
	require.Empty(t, seams.spawns)
	require.Empty(t, seams.exits)
}

// The confirmation is checked for an owned agent exactly as for any other.
func TestResume_OwnedFinishedAgentRefusesAStaleConfirmation(t *testing.T) {
	f, seams, store := ownedFinished(t)
	_, err := store.SaveForSession(context.Background(), legacySession, agentconfig.Patch{PermissionMode: str("plan")})
	require.NoError(t, err)

	rr, body := resumeWith(t, f, map[string]any{"confirmed": true, "permissionMode": "bypassPermissions"})

	require.Equal(t, http.StatusConflict, rr.Code)
	require.Equal(t, "stale_configuration", body["reason"])
	require.Empty(t, seams.spawns, "nothing started on a mode the user never saw")
}
