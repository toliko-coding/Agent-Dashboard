package agents

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/lx-wnk/agent-dashboard/sdk"
	"github.com/lx-wnk/agent-dashboard/server/internal/apierr"
	"github.com/lx-wnk/agent-dashboard/server/internal/askq"
)

// Decisions the dashboard can take on a terminal permission prompt. Nothing
// broader ("don't ask again", "auto mode") is offered: those options stay in
// the terminal, for a person who chose to open it.
const (
	DecisionApproveOnce = "approve_once"
	DecisionDeny        = "deny"
)

// A decided prompt ID is refused again for a while: answeredPromptTTL when the
// prompt was not seen to close, answeredPromptGrace once it was — long enough
// to absorb a double click or a second tab, short enough that a later, identical
// prompt (the same command asked again) can still be answered.
const (
	answeredPromptTTL   = 2 * time.Minute
	answeredPromptGrace = 3 * time.Second
)

// promptClearedWait bounds how long a decision waits to see its prompt close.
var promptClearedWait = 2 * time.Second

// ScreenReaderFn reads a session's visible terminal rows without writing to it.
type ScreenReaderFn func(ctx context.Context, pid int) ([]string, error)

// KeySenderFn delivers raw keystroke tokens to a session's terminal.
type KeySenderFn func(ctx context.Context, pid int, tokens []string) (string, error)

// TerminalPermissionHandler answers a Claude Code tool permission prompt on the
// user's click: Approve once or Deny, for the one prompt the user was shown.
//
// Every decision is re-derived on the server from the session's live screen:
// the session must be one the dashboard launched, a recognised prompt must be
// open, its ID must equal the one the user acted on, and the decision must map
// to that prompt's own options. Only then is a single option digit sent.
type TerminalPermissionHandler struct {
	getAgents  GetAgentsFn
	readScreen ScreenReaderFn
	sendKeys   KeySenderFn
	// forget drops a cached prompt after a decision (merger.ForgetPermissionPrompt).
	forget func(pid int)

	mu       sync.Mutex
	inFlight map[int]bool
	answered map[string]time.Time
}

// NewTerminalPermissionHandler creates a TerminalPermissionHandler.
func NewTerminalPermissionHandler(getAgents GetAgentsFn, readScreen ScreenReaderFn, sendKeys KeySenderFn, forget func(pid int)) *TerminalPermissionHandler {
	return &TerminalPermissionHandler{
		getAgents: getAgents, readScreen: readScreen, sendKeys: sendKeys, forget: forget,
		inFlight: map[int]bool{}, answered: map[string]time.Time{},
	}
}

type permissionDecisionBody struct {
	PromptID string `json:"promptId"`
	Decision string `json:"decision"`
}

// permissionRefusal is a 409 body: why the decision was not applied, and the
// prompt open now (nil when none), so the client can show the current state.
type permissionRefusal struct {
	Error   string                        `json:"error"`
	Reason  string                        `json:"reason"`
	Current *sdk.TerminalPermissionPrompt `json:"current"`
}

// Decide handles POST /api/agents/{pid}/terminal-permission.
func (h *TerminalPermissionHandler) Decide(w http.ResponseWriter, r *http.Request) {
	pid, err := strconv.Atoi(r.PathValue("pid"))
	if err != nil || pid <= 0 {
		apierr.JSONError(w, http.StatusBadRequest, "invalid pid")
		return
	}
	var body permissionDecisionBody
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body); err != nil {
		apierr.JSONError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if body.Decision != DecisionApproveOnce && body.Decision != DecisionDeny {
		apierr.JSONError(w, http.StatusBadRequest, "decision must be approve_once or deny")
		return
	}
	if body.PromptID == "" {
		apierr.JSONError(w, http.StatusBadRequest, "promptId is required")
		return
	}

	agents, err := h.getAgents(r.Context())
	if err != nil {
		apierr.JSONError(w, http.StatusInternalServerError, "failed to look up agent")
		return
	}
	var agent *sdk.Agent
	for i := range agents {
		if agents[i].PID == pid {
			agent = &agents[i]
			break
		}
	}
	if agent == nil {
		apierr.JSONError(w, http.StatusNotFound, "no agent with that pid")
		return
	}
	// The same boundary as the terminal: only a session the dashboard launched.
	if !TerminalAttachable(*agent) {
		apierr.JSONError(w, http.StatusForbidden, "this session was not started by Agent Dashboard; answer it in the terminal or app that started it")
		return
	}

	if !h.begin(pid) {
		h.refuse(w, "another decision for this agent is being applied", "in_progress", nil)
		return
	}
	defer h.end(pid)
	if h.wasAnswered(body.PromptID) {
		h.refuse(w, "this prompt has already been answered", "answered", nil)
		return
	}

	current, parsed := h.readPrompt(r.Context(), *agent)
	switch {
	case current == nil:
		h.refuse(w, "no permission prompt is open in this session", "no_prompt", nil)
		return
	case current.ID != body.PromptID:
		h.refuse(w, "the permission prompt has changed; review the current one", "stale", current)
		return
	case !current.Decidable:
		h.refuse(w, "this prompt can only be answered in the terminal", "terminal_only", current)
		return
	}

	option := parsed.Deny
	if body.Decision == DecisionApproveOnce {
		option = parsed.ApproveOnce
	}
	transport, err := h.sendKeys(r.Context(), pid, []string{strconv.Itoa(option)})
	if err != nil {
		apierr.JSONError(w, http.StatusBadGateway, "could not deliver the decision to the session")
		return
	}
	h.markAnswered(body.PromptID, answeredPromptTTL)
	if h.forget != nil {
		h.forget(pid)
	}
	slog.Info("terminal permission decided", "pid", pid, "tool", current.Tool, "decision", body.Decision, "transport", transport)

	cleared := h.waitCleared(r.Context(), *agent, body.PromptID)
	if cleared {
		h.markAnswered(body.PromptID, answeredPromptGrace)
	}
	apierr.WriteJSON(w, http.StatusOK, map[string]any{
		"ok":            true,
		"decision":      body.Decision,
		"promptCleared": cleared,
	})
}

// readPrompt reads the prompt open on the agent's screen now. The screen is the
// source of truth; the transcript's tool call, when present, only cross-checks.
func (h *TerminalPermissionHandler) readPrompt(ctx context.Context, agent sdk.Agent) (*sdk.TerminalPermissionPrompt, *askq.PermissionPrompt) {
	rows, err := h.readScreen(ctx, agent.PID)
	if err != nil {
		return nil, nil
	}
	parsed := askq.ParsePermissionPrompt(rows)
	if parsed == nil {
		return nil, nil
	}
	return askq.BuildTerminalPermission(agent.SessionID, agent.PID, agent.PendingToolUse, parsed), parsed
}

// waitCleared reports whether the answered prompt left the screen shortly after.
func (h *TerminalPermissionHandler) waitCleared(ctx context.Context, agent sdk.Agent, promptID string) bool {
	deadline := time.Now().Add(promptClearedWait)
	for {
		if p, _ := h.readPrompt(ctx, agent); p == nil || p.ID != promptID {
			return true
		}
		if time.Now().After(deadline) {
			return false
		}
		select {
		case <-ctx.Done():
			return false
		case <-time.After(200 * time.Millisecond):
		}
	}
}

func (h *TerminalPermissionHandler) refuse(w http.ResponseWriter, msg, reason string, current *sdk.TerminalPermissionPrompt) {
	apierr.WriteJSON(w, http.StatusConflict, permissionRefusal{Error: msg, Reason: reason, Current: current})
}

func (h *TerminalPermissionHandler) begin(pid int) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.inFlight[pid] {
		return false
	}
	h.inFlight[pid] = true
	return true
}

func (h *TerminalPermissionHandler) end(pid int) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.inFlight, pid)
}

func (h *TerminalPermissionHandler) wasAnswered(id string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	now := time.Now()
	for k, until := range h.answered {
		if now.After(until) {
			delete(h.answered, k)
		}
	}
	_, ok := h.answered[id]
	return ok
}

// markAnswered refuses id again until ttl from now.
func (h *TerminalPermissionHandler) markAnswered(id string, ttl time.Duration) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.answered[id] = time.Now().Add(ttl)
}
