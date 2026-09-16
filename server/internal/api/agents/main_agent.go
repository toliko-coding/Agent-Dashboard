package agents

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/lx-wnk/agent-dashboard/sdk"
	"github.com/lx-wnk/agent-dashboard/server/internal/agentconfig"
)

/*
 * The main agent: the one that maintains Agent Dashboard itself.
 *
 * It is a seeded record with a fixed id, not a designation anyone can hand out.
 * There is deliberately no route that promotes an ordinary agent, so "exactly
 * one main agent" holds by construction — Project Intelligence, a Portfolio
 * Developer or a Resume Editor cannot become main by any request this server
 * accepts.
 *
 * What CAN be set is which session is currently running it, and only that. The
 * agent that maintains this dashboard is typically a Claude session started
 * from an editor, which the dashboard did not launch and therefore does not
 * own. Linking it changes nothing about that: ownership still decides Stop,
 * Delete and terminal attach, an external session stays observe-only, and the
 * role grants no permission of any kind. It is a label on a durable record, and
 * the link is a pointer from that record to a process.
 */

// MainAgentStore is the durable main-agent record this handler reads and binds.
type MainAgentStore interface {
	Main() (agentconfig.Config, bool)
	BindMainSession(ctx context.Context, sessionID string) (agentconfig.Config, error)
}

// SetMainAgents wires the main-agent record. Unset, the routes answer 503.
func (h *SpawnHandler) SetMainAgents(s MainAgentStore) { h.mainAgents = s }

// MainAgent handles GET /api/main-agent.
func (h *SpawnHandler) MainAgent(w http.ResponseWriter, r *http.Request) {
	if h.mainAgents == nil {
		lifecycleJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "this server stores no main agent"})
		return
	}
	cfg, ok := h.mainAgents.Main()
	if !ok {
		lifecycleJSON(w, http.StatusNotFound, map[string]string{"error": "no main agent has been seeded"})
		return
	}
	lifecycleJSON(w, http.StatusOK, h.mainAgentDTO(cfg))
}

// LinkMainAgentSession handles POST /api/main-agent/session: says which running
// session is the main agent right now, or clears it with pid 0.
func (h *SpawnHandler) LinkMainAgentSession(w http.ResponseWriter, r *http.Request) {
	if h.mainAgents == nil {
		lifecycleJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "this server stores no main agent"})
		return
	}
	var body struct {
		PID int `json:"pid"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		lifecycleJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}

	sessionID := ""
	if body.PID != 0 {
		if h.agentLookup == nil {
			lifecycleJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "agent scan unavailable"})
			return
		}
		agent, found := h.agentLookup.AgentByPID(body.PID)
		if !found {
			lifecycleJSON(w, http.StatusNotFound, map[string]string{"error": "no agent with that pid"})
			return
		}
		// A daemon is not a session someone maintains this dashboard in, and a
		// session on another machine is not this dashboard's to point at.
		if agent.InternalProcess || agent.Machine != "" {
			lifecycleJSON(w, http.StatusForbidden, map[string]string{"error": "Only a Claude session on this machine can be the main agent's session."})
			return
		}
		if agent.SessionID == "" {
			lifecycleJSON(w, http.StatusConflict, map[string]string{"error": "This session has no session id to link."})
			return
		}
		sessionID = agent.SessionID
	}

	cfg, err := h.mainAgents.BindMainSession(r.Context(), sessionID)
	if err != nil {
		lifecycleJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	h.audit(r, "main_agent_session_linked", body.PID, map[string]any{"sessionId": sessionID, "cleared": sessionID == ""})
	lifecycleJSON(w, http.StatusOK, h.mainAgentDTO(cfg))
}

/*
 * mainAgentDTO reports the record itself.
 *
 * It carries no liveness: a bound session id is a pointer, and whether that
 * process is still running is a fact about the roster the client already has.
 * Answering it here would bake a claim into a record that could be stale the
 * moment it was written, so the client matches the session id instead.
 */
func (h *SpawnHandler) mainAgentDTO(cfg agentconfig.Config) sdk.MainAgentDTO {
	return sdk.MainAgentDTO{
		AgentID:        cfg.AgentID,
		DisplayName:    cfg.DisplayName,
		Category:       cfg.Category,
		Instructions:   cfg.Instructions,
		PermissionMode: cfg.PermissionMode,
		Cwd:            cfg.Cwd,
		SessionID:      cfg.SessionID,
	}
}
