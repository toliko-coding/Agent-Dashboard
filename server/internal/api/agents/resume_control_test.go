package agents

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"slices"
	"strconv"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/lx-wnk/agent-dashboard/sdk"
	"github.com/lx-wnk/agent-dashboard/server/internal/agentprofile"
	"github.com/lx-wnk/agent-dashboard/server/internal/db/repo"
	"github.com/lx-wnk/agent-dashboard/server/internal/managedagent"
	"github.com/lx-wnk/agent-dashboard/server/internal/services"
)

// 3N.2.2: ownership recovery never infers ownership; icon edits change nothing else.

const legacySession = "9998d67a-9a9a-4e9e-8197-e5f4b056e733"

type recordingProfileSaver struct {
	saved map[string]agentprofile.Profile
}

func (r *recordingProfileSaver) Save(_ context.Context, sessionID string, p agentprofile.Profile) error {
	r.saved[sessionID] = p
	return nil
}

type resumeSeams struct {
	exits   []int
	spawns  []map[string]any
	nextPID int
}

func (f *lifecycleFixture) withResumeSeams(hosted bool) *resumeSeams {
	s := &resumeSeams{nextPID: 9001}
	f.h.hosted = func(int) bool { return hosted }
	f.h.requestExit = func(_ context.Context, pid int) error {
		s.exits = append(s.exits, pid)
		f.alive[pid] = false // Claude ends when it reads /exit
		return nil
	}
	f.h.resumeSpawn = func(_ string, body map[string]any) (SpawnOutcome, error) {
		s.spawns = append(s.spawns, body)
		return SpawnOutcome{PID: s.nextPID}, nil
	}
	f.h.exitWait = 200_000_000 // 200ms
	return s
}

func legacyAgent(pid int, status sdk.AgentStatus) sdk.Agent {
	return sdk.Agent{PID: pid, SessionID: legacySession, Status: status, CWD: "/work/Claude Agents", DisplayName: "Timer", Provider: sdk.ProviderClaude}
}

// 9: a finished legacy session is resumed through a real dashboard launch, and
// only that new launch is owned. No process is touched.
func TestResume_FinishedLegacySession_BecomesOwnedByTheNewLaunch(t *testing.T) {
	old := legacyAgent(5919, sdk.AgentStatusFinished)
	old.CWD = t.TempDir()
	f := newLifecycleFixture(t, old)
	m := NewSpawnManager(5, 60000, 30, 60000, nil, services.NewSpawnPolicy(nil))
	m.SetManagedAgents(f.managed)
	f.h.manager = m
	f.h.hosted = func(int) bool { t.Fatal("a finished session needs no host check"); return false }
	f.h.requestExit = func(context.Context, int) error { t.Fatal("a finished session is not asked to exit"); return nil }

	var args []string
	orig := execStart
	execStart = func(cmd *exec.Cmd) error {
		args = slices.Clone(cmd.Args)
		cmd.Path = "/bin/sh"
		cmd.Args = []string{"/bin/sh", "-c", "echo 424242"}
		cmd.Err = nil
		return cmd.Start()
	}
	t.Cleanup(func() { execStart = orig })

	rr, body := f.do(http.MethodPost, "/api/agents/5919/resume-under-dashboard", 5919, f.h.ResumeUnderDashboard)
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	require.EqualValues(t, 424242, body["pid"])
	require.Equal(t, false, body["endedRunningSession"])

	require.Contains(t, args, "--resume")
	require.Equal(t, legacySession, args[slices.Index(args, "--resume")+1])
	require.Equal(t, "default", args[slices.Index(args, "--permission-mode")+1])
	require.True(t, f.managed.Owns(424242, legacySession), "the process the dashboard launched is owned")
	require.False(t, f.managed.Owns(5919, legacySession), "the old process never is")
	require.Empty(t, f.killed)
}

// 9, 10, 11: a running session hosted by this dashboard's own pty broker is asked
// to /exit (never signalled), then resumed; the resumed agent can Stop and Delete.
func TestResume_RunningDashboardHostedSession_ExitsThenResumes_ThenStopAndDeleteWork(t *testing.T) {
	old := legacyAgent(5919, sdk.AgentStatusWaiting)
	old.LiveInjectable = true
	f := newLifecycleFixture(t, old)
	f.alive[5919] = true
	s := f.withResumeSeams(true)

	rr, _ := f.do(http.MethodGet, "/api/agents/5919/control", 5919, f.h.GetAgentControl)
	require.Equal(t, http.StatusOK, rr.Code)
	require.JSONEq(t, `{"owned":false,"resume":{"available":true,"endsRunningSession":true}}`, rr.Body.String())

	rr, body := f.do(http.MethodPost, "/api/agents/5919/resume-under-dashboard", 5919, f.h.ResumeUnderDashboard)
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	require.Equal(t, true, body["endedRunningSession"])
	require.Equal(t, []int{5919}, s.exits)
	require.Empty(t, f.killed, "Claude is asked to /exit; no signal is sent")
	require.Len(t, s.spawns, 1)
	require.Equal(t, map[string]any{"cwd": "/work/Claude Agents", "resumeSessionId": legacySession, "enableChannel": true, "permissionMode": "default"}, s.spawns[0])

	// SpawnManager records the new launch (stubbed here), after which it is owned.
	f.own(t, managedagent.Record{SessionID: legacySession, PID: 9001, Cwd: "/work/Claude Agents"})
	resumed := legacyAgent(9001, sdk.AgentStatusActive)
	f.h.SetAgentLookup(fakeAgentLookup{9001: resumed})
	f.alive[9001] = true
	rr, _ = f.do(http.MethodPost, "/api/agents/9001/stop", 9001, f.h.StopAgent)
	require.Equal(t, http.StatusOK, rr.Code)
	require.Equal(t, []int{9001}, f.killed)
	resumed.Status = sdk.AgentStatusFinished
	f.h.SetAgentLookup(fakeAgentLookup{9001: resumed})
	rr, body = f.do(http.MethodDelete, "/api/agents/9001", 9001, f.h.DeleteAgent)
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	require.Equal(t, true, body["deleted"])
}

// 3, 4, 12, 13: a running terminal, VS Code or `agent-dashboard live` session is
// not resumed, not asked to exit, not signalled.
func TestResume_RunningExternalSessions_AreRefusedAndUntouched(t *testing.T) {
	terminal := legacyAgent(61, sdk.AgentStatusActive)
	terminal.SessionID = "11111111-1111-4111-8111-111111111111"
	vscode := legacyAgent(62, sdk.AgentStatusActive)
	vscode.SessionID = "22222222-2222-4222-8222-222222222222"
	vscode.Entrypoint = "claude-vscode"
	live := legacyAgent(63, sdk.AgentStatusActive)
	live.SessionID = "33333333-3333-4333-8333-333333333333"
	live.LiveInjectable = true // injectable, but not hosted by this dashboard
	f := newLifecycleFixture(t, terminal, vscode, live)
	s := f.withResumeSeams(false)

	for _, a := range []sdk.Agent{terminal, vscode, live} {
		f.alive[a.PID] = true
		rr, body := f.do(http.MethodPost, "/x", a.PID, f.h.ResumeUnderDashboard)
		require.Equal(t, http.StatusForbidden, rr.Code, "pid %d", a.PID)
		require.Equal(t, true, body["external"])
		require.Equal(t, resumeExternalRunning, body["error"])
		for _, route := range []func(http.ResponseWriter, *http.Request){f.h.StopAgent, f.h.DeleteAgent} {
			rr, body = f.do(http.MethodPost, "/x?stop=true", a.PID, route)
			require.Equal(t, http.StatusForbidden, rr.Code)
			require.Equal(t, true, body["external"])
		}
	}
	require.Empty(t, s.exits)
	require.Empty(t, s.spawns)
	require.Empty(t, f.killed)
}

func TestResume_ASessionThatDoesNotExit_IsNotResumed(t *testing.T) {
	old := legacyAgent(5919, sdk.AgentStatusActive)
	old.LiveInjectable = true
	f := newLifecycleFixture(t, old)
	f.alive[5919] = true
	s := f.withResumeSeams(true)
	f.h.requestExit = func(context.Context, int) error { return nil } // Claude ignores it

	rr, _ := f.do(http.MethodPost, "/x", 5919, f.h.ResumeUnderDashboard)
	require.Equal(t, http.StatusGatewayTimeout, rr.Code)
	require.Empty(t, s.spawns)
	require.Empty(t, f.killed)
}

/*
 * A running owned agent is not resumed, and a pipeline agent never is.
 *
 * This used to refuse an owned agent whatever state it was in, on the grounds
 * that it was "already managed". That is right while a process is running -
 * there the session would have to be taken over, and Stop is the honest action
 * - but wrong once it has ended: an owned agent that has finished is resumed
 * here precisely so its saved configuration is shown and confirmed before the
 * next session starts (see TestResume_OwnedFinishedAgentStartsWithItsConfirmedConfiguration).
 * A pipeline agent stays forbidden in both states: its task owns its lifecycle.
 */
func TestResume_RefusesRunningOwnedAndPipelineAgents(t *testing.T) {
	owned := legacyAgent(71, sdk.AgentStatusActive)
	pipeline := legacyAgent(72, sdk.AgentStatusFinished)
	pipeline.SessionID = "44444444-4444-4444-8444-444444444444"
	pipeline.PipelineTaskID = "task-1"
	f := newLifecycleFixture(t, owned, pipeline)
	f.alive[71] = true
	f.ownAgent(t, owned)
	s := f.withResumeSeams(true)

	rr, _ := f.do(http.MethodPost, "/x", 71, f.h.ResumeUnderDashboard)
	require.Equal(t, http.StatusConflict, rr.Code, "a running owned session is not taken over")
	rr, _ = f.do(http.MethodPost, "/x", 72, f.h.ResumeUnderDashboard)
	require.Equal(t, http.StatusForbidden, rr.Code, "a pipeline agent is stopped or cancelled through its task")
	require.Empty(t, s.spawns, "neither refusal started anything")
}

// 2: ownership survives a server restart when the recorded provenance still matches.
func TestOwnership_SurvivesAServerRestart(t *testing.T) {
	a := runningAgent(81, "/tmp")
	shared := &memManagedRepo{rows: map[string]repo.ManagedAgentRow{}}
	before := managedagent.New(shared)
	require.NoError(t, before.Record(context.Background(), managedagent.Record{SessionID: a.SessionID, PID: 81, Cwd: "/tmp"}))

	f := newLifecycleFixture(t, a)
	restarted := managedagent.New(shared)
	require.NoError(t, restarted.Load(context.Background()))
	f.h.SetManagedAgents(restarted)
	f.alive[81] = true
	rr, _ := f.do(http.MethodPost, "/x", 81, f.h.StopAgent)
	require.Equal(t, http.StatusOK, rr.Code)
	require.Equal(t, []int{81}, f.killed)
}

// 5–8: a profile row, a session id, a workspace or a PID alone is never ownership.
func TestOwnership_NoSingleFactClaimsIt(t *testing.T) {
	named := legacyAgent(91, sdk.AgentStatusActive) // has a name and icon (profile row)
	named.Category = "document"
	sameSession := legacyAgent(92, sdk.AgentStatusActive)
	sameSession.SessionID = "55555555-5555-4555-8555-555555555555"
	sameWorkspace := runningAgent(93, "/work/owned")
	samePID := runningAgent(94, "/tmp")
	f := newLifecycleFixture(t, named, sameSession, sameWorkspace, samePID)
	f.own(t, managedagent.Record{SessionID: sameSession.SessionID, PID: 1234, Cwd: "/work/owned"}) // same session, other PID
	f.own(t, managedagent.Record{SessionID: "66666666-6666-4666-8666-666666666666", PID: 94})      // same PID, other session

	for _, a := range []sdk.Agent{named, sameSession, sameWorkspace, samePID} {
		f.alive[a.PID] = true
		rr, body := f.do(http.MethodPost, "/x", a.PID, f.h.StopAgent)
		require.Equal(t, http.StatusForbidden, rr.Code, "pid %d", a.PID)
		require.Equal(t, true, body["external"])
	}
	require.Empty(t, f.killed)
}

// 15, 16, 20, 21, 22: editing the name and icon saves presentation metadata only.
func TestUpdateAgentProfile_ChangesPresentationOnly(t *testing.T) {
	owned := runningAgent(101, "/tmp")
	external := legacyAgent(102, sdk.AgentStatusActive)
	f := newLifecycleFixture(t, owned, external)
	f.ownAgent(t, owned)
	saver := &recordingProfileSaver{saved: map[string]agentprofile.Profile{}}
	f.h.SetProfileSaver(saver)
	_, err := services.AddWorkingFolder(context.Background(), f.folders, t.TempDir())
	require.NoError(t, err)
	foldersBefore := services.WorkingFolders(f.folders)

	put := func(pid int, json string) (*httptest.ResponseRecorder, map[string]any) {
		req := httptest.NewRequest(http.MethodPut, "/api/agents/x/profile", bytes.NewBufferString(json))
		req.SetPathValue("pid", strconv.Itoa(pid))
		rr := httptest.NewRecorder()
		f.h.UpdateAgentProfile(rr, req)
		return rr, nil
	}

	rr, _ := put(101, `{"displayName":"  Timer  ","category":"document"}`)
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	require.JSONEq(t, `{"displayName":"Timer","category":"document"}`, rr.Body.String())
	require.Equal(t, agentprofile.Profile{DisplayName: "Timer", Category: "document"}, saver.saved[owned.SessionID])

	rr, _ = put(102, `{"displayName":"Timer","category":"general"}`)
	require.Equal(t, http.StatusOK, rr.Code, "an observed session's name and icon are the dashboard's own data")
	require.False(t, f.managed.Owns(102, external.SessionID), "editing never grants ownership")
	require.True(t, f.managed.Owns(101, owned.SessionID), "or removes it")

	rr, _ = put(101, `{"displayName":"x","category":"admin"}`)
	require.Equal(t, http.StatusBadRequest, rr.Code, "unknown categories are refused server-side")
	require.Equal(t, "document", saver.saved[owned.SessionID].Category)

	rr, _ = put(101, `{"displayName":"","category":""}`)
	require.Equal(t, http.StatusOK, rr.Code)
	require.Contains(t, f.profiles.deleted, owned.SessionID, "clearing both removes the profile")

	require.Equal(t, foldersBefore, services.WorkingFolders(f.folders))
	require.Empty(t, f.killed)
	require.Zero(t, f.forgetter.calls)
}

func TestDashboardHostedProcess_IsFalseForAProcessNotUnderItsPtyBroker(t *testing.T) {
	cmd := exec.Command("sleep", "5")
	require.NoError(t, cmd.Start())
	t.Cleanup(func() { _ = cmd.Process.Kill(); _, _ = cmd.Process.Wait() })
	require.False(t, dashboardHostedProcess(cmd.Process.Pid), "its parent is the test binary, not `<server> pty-host`")
	require.False(t, dashboardHostedProcess(1))
	require.False(t, dashboardHostedProcess(999_999_999))
}
