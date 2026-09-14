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
)

// 3N.2: stop and delete an agent without touching its work or its history.

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

type lifecycleFixture struct {
	h         *SpawnHandler
	forgetter *recordingForgetter
	profiles  *recordingProfileDeleter
	killed    []int
	alive     map[int]bool
	home      string
}

func newLifecycleFixture(t *testing.T, agents ...sdk.Agent) *lifecycleFixture {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	f := &lifecycleFixture{forgetter: &recordingForgetter{}, profiles: &recordingProfileDeleter{}, alive: map[int]bool{}, home: home}
	lookup := fakeAgentLookup{}
	for _, a := range agents {
		lookup[a.PID] = a
	}
	f.h = NewSpawnHandler(NewSpawnManager(5, 60000, 30, 60000, nil, nil))
	f.h.SetAgentLookup(lookup)
	f.h.SetAgentForgetter(f.forgetter)
	f.h.SetProfileDeleter(f.profiles)
	f.h.alive = func(pid int) bool { return f.alive[pid] }
	f.h.terminate = func(pid int) error {
		f.killed = append(f.killed, pid)
		f.alive[pid] = false
		return nil
	}
	return f
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
	for _, pid := range []int{11, 12} {
		f.alive[pid] = true
		rr, _ := f.do(http.MethodDelete, "/api/agents/x?stop=true", pid, f.h.DeleteAgent)
		require.Equal(t, http.StatusForbidden, rr.Code)
	}
	require.Empty(t, f.killed)
}

func TestDeleteAgent_RunningNeedsExplicitConfirmation(t *testing.T) {
	f := newLifecycleFixture(t, runningAgent(21, "/tmp"))
	f.alive[21] = true
	rr, body := f.do(http.MethodDelete, "/api/agents/21", 21, f.h.DeleteAgent)
	require.Equal(t, http.StatusConflict, rr.Code)
	require.Equal(t, true, body["running"])
	require.Empty(t, f.killed)
	require.Zero(t, f.forgetter.calls)
	require.Empty(t, f.profiles.deleted)
}

func TestDeleteAgent_StopsCleansUpAndKeepsTheWorkAndHistory(t *testing.T) {
	cwd := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(cwd, ".git"), 0o755))
	source := filepath.Join(cwd, "resume.tex")
	require.NoError(t, os.WriteFile(source, []byte("\\documentclass{article}"), 0o600))

	f := newLifecycleFixture(t, runningAgent(31, cwd))
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

	for _, kept := range []string{cwd, source, filepath.Join(cwd, ".git"), transcript} {
		_, err := os.Stat(kept)
		require.NoError(t, err, "%s must survive deleting the agent", kept)
	}
}

func TestDeleteAgent_FinishedAgentIsNotStopped(t *testing.T) {
	finished := runningAgent(41, "/tmp")
	finished.Status = sdk.AgentStatusFinished
	f := newLifecycleFixture(t, finished)
	rr, body := f.do(http.MethodDelete, "/api/agents/41", 41, f.h.DeleteAgent)
	require.Equal(t, http.StatusOK, rr.Code)
	require.Equal(t, false, body["stopped"])
	require.Empty(t, f.killed)
	require.Equal(t, 1, f.forgetter.calls)
}

func TestStopAgent(t *testing.T) {
	f := newLifecycleFixture(t, runningAgent(51, "/tmp"), runningAgent(52, "/tmp"))
	f.alive[51] = true
	rr, _ := f.do(http.MethodPost, "/api/agents/51/stop", 51, f.h.StopAgent)
	require.Equal(t, http.StatusOK, rr.Code)
	require.Equal(t, []int{51}, f.killed)
	require.Zero(t, f.forgetter.calls, "stopping is not deleting")
	require.Empty(t, f.profiles.deleted)

	rr, _ = f.do(http.MethodPost, "/api/agents/52/stop", 52, f.h.StopAgent)
	require.Equal(t, http.StatusConflict, rr.Code, "an agent that is not running is not stopped again")
}

func TestLifecycle_WithoutAScanAnswers503(t *testing.T) {
	h := NewSpawnHandler(NewSpawnManager(5, 60000, 30, 60000, nil, nil))
	req := httptest.NewRequest(http.MethodDelete, "/api/agents/7", nil)
	req.SetPathValue("pid", "7")
	rr := httptest.NewRecorder()
	h.DeleteAgent(rr, req)
	require.Equal(t, http.StatusServiceUnavailable, rr.Code)
}
