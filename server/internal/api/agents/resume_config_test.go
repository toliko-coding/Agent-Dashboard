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
 * Resuming an agent with the configuration its owner saved.
 *
 * The rule: a saved configuration may be applied on resume, but only after the
 * user has seen it and confirmed it. Confirmation is therefore not a flag the
 * client sets — it carries back the values it displayed, and they must still be
 * the saved ones. Anything else is refused, and refused BEFORE the running
 * session is touched, because a resume that is going to fail must not first
 * stop the agent it was about to resume.
 *
 * Without a confirmation the resume behaves exactly as it did before saved
 * configuration existed. That direction is the safe one: a saved
 * "bypassPermissions" cannot be applied by a client that never asked about it.
 */

func resumeFixture(t *testing.T, saved *agentconfig.Patch) (*lifecycleFixture, *resumeSeams, *agentconfig.Store) {
	t.Helper()
	agent := legacyAgent(5919, sdk.AgentStatusFinished)
	f := newLifecycleFixture(t, agent)
	seams := f.withResumeSeams(false)

	store := agentconfig.New(&memConfigRepo{rows: map[string]repo.DashboardAgentRow{}})
	require.NoError(t, store.Load(context.Background()))
	if saved != nil {
		_, err := store.SaveForSession(context.Background(), legacySession, *saved)
		require.NoError(t, err)
	}
	f.h.SetAgentConfigs(store)
	return f, seams, store
}

func resumeWith(t *testing.T, f *lifecycleFixture, body map[string]any) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	raw, err := json.Marshal(body)
	require.NoError(t, err)
	req := httptest.NewRequest(http.MethodPost, "/api/agents/5919/resume-under-dashboard", bytes.NewReader(raw))
	req.SetPathValue("pid", strconv.Itoa(5919))
	rr := httptest.NewRecorder()
	f.h.ResumeUnderDashboard(rr, req)
	var decoded map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &decoded)
	return rr, decoded
}

func str(s string) *string { return &s }

func TestResumeConfig_ConfirmedAppliesTheSavedModeAndInstructions(t *testing.T) {
	f, seams, _ := resumeFixture(t, &agentconfig.Patch{
		Instructions:   str("standing orders"),
		PermissionMode: str("acceptEdits"),
	})

	rr, _ := resumeWith(t, f, map[string]any{
		"confirmed":               true,
		"permissionMode":          "acceptEdits",
		"instructionsFingerprint": InstructionsFingerprint("standing orders"),
	})

	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	require.Len(t, seams.spawns, 1)
	require.Equal(t, "acceptEdits", seams.spawns[0]["permissionMode"])
	require.Equal(t, "standing orders", seams.spawns[0]["systemPrompt"])
	require.Equal(t, legacySession, seams.spawns[0]["resumeSessionId"], "the same conversation")
}

// The confirmation is checked, not trusted: if the saved configuration changed
// after the dialog read it, the user would be launching something they never
// saw.
func TestResumeConfig_AModeTheUserDidNotSeeIsRefusedAndNothingStarts(t *testing.T) {
	f, seams, _ := resumeFixture(t, &agentconfig.Patch{PermissionMode: str("acceptEdits")})

	rr, body := resumeWith(t, f, map[string]any{"confirmed": true, "permissionMode": "default"})

	require.Equal(t, http.StatusConflict, rr.Code)
	require.Equal(t, "stale_configuration", body["reason"])
	require.Empty(t, seams.spawns, "nothing was started")
	require.Empty(t, seams.exits, "and the session was not ended first")
	require.NotNil(t, body["config"], "the current configuration comes back so the user can look again")
}

func TestResumeConfig_InstructionsChangedSinceTheyWereShownIsRefused(t *testing.T) {
	f, seams, _ := resumeFixture(t, &agentconfig.Patch{
		Instructions:   str("the current orders"),
		PermissionMode: str("plan"),
	})

	rr, body := resumeWith(t, f, map[string]any{
		"confirmed":               true,
		"permissionMode":          "plan",
		"instructionsFingerprint": InstructionsFingerprint("what the dialog showed earlier"),
	})

	require.Equal(t, http.StatusConflict, rr.Code)
	require.Equal(t, "stale_configuration", body["reason"])
	require.Empty(t, seams.spawns)
	require.Empty(t, seams.exits)
}

/*
 * No confirmation, no application — even when something dangerous is saved.
 *
 * This is the invariant that keeps a saved mode from becoming a silent
 * escalation path: a client that does not ask gets claude's default, which is
 * exactly what resume did before configurations existed.
 */
func TestResumeConfig_WithoutConfirmationTheSavedModeIsNotApplied(t *testing.T) {
	f, seams, _ := resumeFixture(t, &agentconfig.Patch{
		Instructions:   str("standing orders"),
		PermissionMode: str("bypassPermissions"),
	})

	rr, _ := resumeWith(t, f, map[string]any{})

	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	require.Len(t, seams.spawns, 1)
	require.Equal(t, "default", seams.spawns[0]["permissionMode"])
	require.NotContains(t, seams.spawns[0], "systemPrompt", "standing instructions are not applied unconfirmed either")
}

func TestResumeConfig_ConfirmedWithNothingSavedStartsOnTheDefault(t *testing.T) {
	f, seams, _ := resumeFixture(t, nil)

	rr, _ := resumeWith(t, f, map[string]any{"confirmed": true, "permissionMode": "default"})

	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	require.Len(t, seams.spawns, 1)
	require.Equal(t, "default", seams.spawns[0]["permissionMode"])
	require.NotContains(t, seams.spawns[0], "systemPrompt")
}

// An agent with instructions but no saved mode resumes on the default mode,
// with its instructions: "nothing saved" is not "bypass".
func TestResumeConfig_InstructionsWithoutASavedModeUseTheDefaultMode(t *testing.T) {
	f, seams, _ := resumeFixture(t, &agentconfig.Patch{Instructions: str("only the docs folder")})

	rr, _ := resumeWith(t, f, map[string]any{
		"confirmed":               true,
		"permissionMode":          "default",
		"instructionsFingerprint": InstructionsFingerprint("only the docs folder"),
	})

	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	require.Equal(t, "default", seams.spawns[0]["permissionMode"])
	require.Equal(t, "only the docs folder", seams.spawns[0]["systemPrompt"])
}
