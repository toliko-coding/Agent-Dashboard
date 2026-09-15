package agents

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"

	"github.com/lx-wnk/agent-dashboard/sdk"
	"github.com/lx-wnk/agent-dashboard/server/internal/askq"
)

func permRows(noLabel string) []string {
	return []string{
		" Bash command",
		"   shasum -a 256 notes/sample.txt",
		" Do you want to proceed?",
		" ❯ 1. Yes",
		"   2. Yes, and don't ask again for shasum commands",
		"   3. " + noLabel,
		" Esc to cancel · Tab to amend",
	}
}

type fakeSession struct {
	mu    sync.Mutex
	rows  []string
	sent  [][]string
	reads int
	delay time.Duration
}

func (f *fakeSession) read(context.Context, int) ([]string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.reads++
	return append([]string(nil), f.rows...), nil
}

func (f *fakeSession) send(_ context.Context, _ int, tokens []string) (string, error) {
	time.Sleep(f.delay)
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sent = append(f.sent, tokens)
	f.rows = []string{"● Running…"} // the prompt closes once answered
	return "pty", nil
}

func ownedAgent() sdk.Agent {
	return sdk.Agent{PID: 7, SessionID: "s1", LiveInjectable: true, DashboardOwned: true,
		PendingToolUse: &sdk.PendingToolUse{ID: "tu1", Tool: "Bash", PatternDisplay: "shasum -a 256 notes/sample.txt"}}
}

func promptIDFor(agent sdk.Agent, rows []string) string {
	return askq.BuildTerminalPermission(agent.SessionID, agent.PID, agent.PendingToolUse, askq.ParsePermissionPrompt(rows)).ID
}

func decide(t *testing.T, srv *httptest.Server, body map[string]any) (int, map[string]any) {
	t.Helper()
	b, _ := json.Marshal(body)
	resp, err := http.Post(srv.URL+"/api/agents/7/terminal-permission", "application/json", bytes.NewReader(b))
	require.NoError(t, err)
	defer resp.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out
}

func permServer(agent sdk.Agent, s *fakeSession) *httptest.Server {
	h := NewTerminalPermissionHandler(func(context.Context) ([]sdk.Agent, error) { return []sdk.Agent{agent}, nil }, s.read, s.send, nil)
	r := chi.NewRouter()
	r.Post("/api/agents/{pid}/terminal-permission", h.Decide)
	return httptest.NewServer(r)
}

func init() { promptClearedWait = 300 * time.Millisecond }

func TestTerminalPermission_ApproveOnceSendsOnlyTheYesOption(t *testing.T) {
	s := &fakeSession{rows: permRows("No")}
	srv := permServer(ownedAgent(), s)
	defer srv.Close()
	code, out := decide(t, srv, map[string]any{"promptId": promptIDFor(ownedAgent(), s.rows), "decision": "approve_once"})
	require.Equal(t, http.StatusOK, code, out)
	require.Equal(t, [][]string{{"1"}}, s.sent, "approve once is option 1 only — never don't-ask-again or auto mode")
	require.Equal(t, true, out["promptCleared"])
}

func TestTerminalPermission_DenySendsTheNoOption(t *testing.T) {
	s := &fakeSession{rows: permRows("No, and tell Claude what to do differently (esc)")}
	srv := permServer(ownedAgent(), s)
	defer srv.Close()
	code, _ := decide(t, srv, map[string]any{"promptId": promptIDFor(ownedAgent(), s.rows), "decision": "deny"})
	require.Equal(t, http.StatusOK, code)
	require.Equal(t, [][]string{{"3"}}, s.sent)
}

func TestTerminalPermission_Refusals(t *testing.T) {
	rows := permRows("No")
	id := promptIDFor(ownedAgent(), rows)
	unknownOption := permRows("No")
	unknownOption[4] = "   2. Maybe later"

	cases := []struct {
		name   string
		agent  sdk.Agent
		rows   []string
		body   map[string]any
		status int
		reason string
		read   bool
	}{
		{"external session", func() sdk.Agent { a := ownedAgent(); a.DashboardOwned = false; return a }(), rows, map[string]any{"promptId": id, "decision": "approve_once"}, http.StatusForbidden, "", false},
		{"remote agent", func() sdk.Agent { a := ownedAgent(); a.Machine = "other"; return a }(), rows, map[string]any{"promptId": id, "decision": "approve_once"}, http.StatusForbidden, "", false},
		{"internal process", func() sdk.Agent { a := ownedAgent(); a.InternalProcess = true; return a }(), rows, map[string]any{"promptId": id, "decision": "approve_once"}, http.StatusForbidden, "", false},
		{"stale prompt id", ownedAgent(), rows, map[string]any{"promptId": "0123456789abcdef01234567", "decision": "approve_once"}, http.StatusConflict, "stale", true},
		{"prompt already gone", ownedAgent(), []string{"● Done."}, map[string]any{"promptId": id, "decision": "approve_once"}, http.StatusConflict, "no_prompt", true},
		{"unknown prompt shape", ownedAgent(), unknownOption, map[string]any{"promptId": promptIDFor(ownedAgent(), unknownOption), "decision": "approve_once"}, http.StatusConflict, "terminal_only", true},
		{"unsupported decision", ownedAgent(), rows, map[string]any{"promptId": id, "decision": "always_allow"}, http.StatusBadRequest, "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := &fakeSession{rows: tc.rows}
			srv := permServer(tc.agent, s)
			defer srv.Close()
			code, out := decide(t, srv, tc.body)
			require.Equal(t, tc.status, code, out)
			if tc.reason != "" {
				require.Equal(t, tc.reason, out["reason"])
			}
			require.Empty(t, s.sent, "a refused decision must send nothing")
			if !tc.read {
				require.Zero(t, s.reads, "a refused session's screen must not be read")
			}
		})
	}
}

func TestTerminalPermission_AnsweredOnceOnly(t *testing.T) {
	s := &fakeSession{rows: permRows("No")}
	id := promptIDFor(ownedAgent(), s.rows)
	srv := permServer(ownedAgent(), s)
	defer srv.Close()
	code, _ := decide(t, srv, map[string]any{"promptId": id, "decision": "approve_once"})
	require.Equal(t, http.StatusOK, code)
	// The same prompt reappearing on screen (a lagging redraw) is still not answered twice.
	s.mu.Lock()
	s.rows = permRows("No")
	s.mu.Unlock()
	code, out := decide(t, srv, map[string]any{"promptId": id, "decision": "approve_once"})
	require.Equal(t, http.StatusConflict, code)
	require.Equal(t, "answered", out["reason"])
	require.Len(t, s.sent, 1)
}

func TestTerminalPermission_ConcurrentClicksApplyOneDecision(t *testing.T) {
	s := &fakeSession{rows: permRows("No"), delay: 150 * time.Millisecond}
	id := promptIDFor(ownedAgent(), s.rows)
	srv := permServer(ownedAgent(), s)
	defer srv.Close()
	var wg sync.WaitGroup
	codes := make([]int, 4)
	for i := range codes {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			codes[i], _ = decide(t, srv, map[string]any{"promptId": id, "decision": "approve_once"})
		}(i)
	}
	wg.Wait()
	ok := 0
	for _, c := range codes {
		if c == http.StatusOK {
			ok++
		} else {
			require.Equal(t, http.StatusConflict, c)
		}
	}
	require.Equal(t, 1, ok, "exactly one click is applied")
	require.Len(t, s.sent, 1)
}

// Claude Code can show the prompt before the tool call reaches the transcript:
// the decision is made from the screen alone.
func TestTerminalPermission_PromptBeforeTranscriptToolCall(t *testing.T) {
	agent := ownedAgent()
	agent.PendingToolUse = nil
	s := &fakeSession{rows: permRows("No")}
	srv := permServer(agent, s)
	defer srv.Close()
	code, out := decide(t, srv, map[string]any{"promptId": promptIDFor(agent, s.rows), "decision": "approve_once"})
	require.Equal(t, http.StatusOK, code, out)
	require.Equal(t, [][]string{{"1"}}, s.sent)
}

// A later, identical prompt (the same command asked again) can be answered once
// the first one was seen to close.
func TestTerminalPermission_IdenticalPromptLaterIsAnswerable(t *testing.T) {
	s := &fakeSession{rows: permRows("No")}
	id := promptIDFor(ownedAgent(), s.rows)
	srv := permServer(ownedAgent(), s)
	defer srv.Close()
	code, _ := decide(t, srv, map[string]any{"promptId": id, "decision": "approve_once"})
	require.Equal(t, http.StatusOK, code)
	time.Sleep(answeredPromptGrace + 200*time.Millisecond)
	s.mu.Lock()
	s.rows = permRows("No")
	s.mu.Unlock()
	code, out := decide(t, srv, map[string]any{"promptId": id, "decision": "approve_once"})
	require.Equal(t, http.StatusOK, code, out)
	require.Len(t, s.sent, 2)
}
