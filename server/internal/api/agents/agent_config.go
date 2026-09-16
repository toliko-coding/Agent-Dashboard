package agents

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/lx-wnk/agent-dashboard/sdk"
	"github.com/lx-wnk/agent-dashboard/server/internal/agentconfig"
)

/*
 * An agent's saved configuration: what it is called, how it should work, and
 * what it may do without asking.
 *
 * The distinction this endpoint exists to make visible is agent vs session. A
 * session is one Claude process, and claude reads its permission mode and
 * system prompt once, at startup. So nothing written here changes the process
 * in front of you: it describes the NEXT session, and the payload carries both
 * values so a surface can say which is which instead of implying they are one.
 *
 * WHO MAY WRITE WHAT. A name and an icon are presentation and stay editable for
 * any session the dashboard can see, exactly as they were before this endpoint
 * existed. Instructions and permission mode are not presentation: they are
 * applied when the dashboard starts a session for this agent, so they require
 * an agent the dashboard actually started. A Terminal or VS Code session can be
 * labelled; it cannot be configured, and nothing here gives it authority it did
 * not have.
 */

// AgentConfigStore is the durable agent record this handler reads and writes.
type AgentConfigStore interface {
	Lookup(sessionID string) (agentconfig.Config, bool)
	SaveForSession(ctx context.Context, sessionID string, patch agentconfig.Patch) (agentconfig.Config, error)
	// DeleteForSession removes the durable agent behind a session. It refuses
	// the main agent, which is seeded and permanent.
	DeleteForSession(ctx context.Context, sessionID string) (bool, error)
	// BindSession points an existing agent at the session now running it, so
	// starting one never produces a second agent for the same identity.
	BindSession(ctx context.Context, agentID, sessionID string) (agentconfig.Config, error)
	SaveByID(ctx context.Context, agentID string, patch agentconfig.Patch) (agentconfig.Config, error)
}

// SetAgentConfigs wires the durable agent records. Unset, the routes answer 503.
func (h *SpawnHandler) SetAgentConfigs(s AgentConfigStore) { h.agentConfigs = s }

// AgentConfig handles GET /api/agents/{pid}/config.
func (h *SpawnHandler) AgentConfig(w http.ResponseWriter, r *http.Request) {
	agent, ok := h.scannedAgent(w, r)
	if !ok {
		return
	}
	if h.agentConfigs == nil {
		lifecycleJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "agent configuration is not stored on this server"})
		return
	}
	cfg, _ := h.agentConfigs.Lookup(agent.SessionID)
	lifecycleJSON(w, http.StatusOK, agentConfigDTO(agent, cfg))
}

// UpdateAgentConfig handles PUT /api/agents/{pid}/config.
func (h *SpawnHandler) UpdateAgentConfig(w http.ResponseWriter, r *http.Request) {
	agent, ok := h.scannedAgent(w, r)
	if !ok {
		return
	}
	if h.agentConfigs == nil {
		lifecycleJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "agent configuration is not stored on this server"})
		return
	}
	var body struct {
		DisplayName    *string `json:"displayName"`
		Category       *string `json:"category"`
		Instructions   *string `json:"instructions"`
		PermissionMode *string `json:"permissionMode"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		lifecycleJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	// Instructions and a permission mode are applied when the dashboard starts
	// a session for this agent, so they are only accepted for an agent it
	// started. Presentation stays open, as it already was.
	if (body.Instructions != nil || body.PermissionMode != nil) && !agent.DashboardOwned {
		lifecycleJSON(w, http.StatusForbidden, map[string]string{
			"error": "Instructions and permission mode can only be saved for an agent Agent Dashboard started. This session was started elsewhere, so it is observed, not configured.",
		})
		return
	}
	if agent.SessionID == "" {
		lifecycleJSON(w, http.StatusConflict, map[string]string{"error": "This agent has no session id to save a configuration for."})
		return
	}

	cfg, err := h.agentConfigs.SaveForSession(r.Context(), agent.SessionID, agentconfig.Patch{
		DisplayName:    body.DisplayName,
		Category:       body.Category,
		Instructions:   body.Instructions,
		PermissionMode: body.PermissionMode,
	})
	if err != nil {
		lifecycleJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	h.audit(r, "agent_config_update", agent.PID, map[string]any{
		"sessionId":       agent.SessionID,
		"agentId":         cfg.AgentID,
		"permissionMode":  cfg.PermissionMode,
		"hasInstructions": cfg.Instructions != "",
	})
	lifecycleJSON(w, http.StatusOK, agentConfigDTO(agent, cfg))
}

// agentConfigDTO answers with both halves: what is saved for the next session,
// and what the session in front of the user is actually running under.
func agentConfigDTO(agent sdk.Agent, cfg agentconfig.Config) sdk.AgentConfigDTO {
	dto := sdk.AgentConfigDTO{
		AgentID:               cfg.AgentID,
		DisplayName:           cfg.DisplayName,
		Category:              cfg.Category,
		Instructions:          cfg.Instructions,
		PermissionMode:        cfg.PermissionMode,
		Cwd:                   cfg.Cwd,
		ProjectID:             cfg.ProjectID,
		Role:                  cfg.Role,
		SessionPermissionMode: agent.SessionPermissionMode,
		SessionRunning:        agent.Status != sdk.AgentStatusFinished,
		ConfigurableHere:      agent.DashboardOwned,
	}
	// Fall back to what the roster already shows, so an agent with nothing
	// saved yet opens on its current name rather than on blanks.
	if dto.DisplayName == "" {
		dto.DisplayName = agent.DisplayName
	}
	if dto.Category == "" {
		dto.Category = agent.Category
	}
	if dto.Cwd == "" {
		dto.Cwd = agent.CWD
	}
	// Only a real disagreement counts: "nothing saved" is not a difference, and
	// neither is a session whose command line was never observed.
	dto.DiffersFromSession = cfg.PermissionMode != "" &&
		agent.SessionPermissionMode != "" &&
		cfg.PermissionMode != agent.SessionPermissionMode
	return dto
}
