package agents

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sort"

	"github.com/lx-wnk/agent-dashboard/sdk"
	"github.com/lx-wnk/agent-dashboard/server/internal/agentconfig"
)

/*
 * The agents this dashboard keeps, as opposed to the processes running now.
 *
 * The roster is built from live processes plus an in-process registry of
 * recently-finished ones, so it is emptied of finished agents whenever the
 * server restarts. That is what took Resume Editor and Portfolio Developer off
 * the Agents page: nothing had been deleted, the only record of them was in
 * memory. These routes read the durable half from storage, so an agent stays
 * until someone deletes it.
 *
 * Addressed by agent id rather than pid on purpose. An agent with no session has
 * no pid, and a remembered one is worse than none: pids are reused, so acting on
 * a stale one would eventually act on a stranger's process.
 *
 * Liveness is deliberately absent from the payload. Whether a session is running
 * is a fact about the roster the client already holds; a stored record claiming
 * it would be wrong the moment the process exited.
 */

// DashboardAgentStore is the durable agent list these routes read and write.
type DashboardAgentStore interface {
	List() []agentconfig.Config
	ByID(agentID string) (agentconfig.Config, bool)
	SaveByID(ctx context.Context, agentID string, patch agentconfig.Patch) (agentconfig.Config, error)
	DeleteByID(ctx context.Context, agentID string) (bool, error)
}

// SetDashboardAgents wires the durable agent list. Unset, the routes answer 503.
func (h *SpawnHandler) SetDashboardAgents(s DashboardAgentStore) { h.dashboardAgents = s }

// SetLiveSessionLookup wires the "is this session running" question, so a
// record is never removed from under a live process.
func (h *SpawnHandler) SetLiveSessionLookup(fn func(sessionID string) bool) { h.liveSessions = fn }

/*
 * SetResumableLookup wires the "can this session still be resumed" question.
 *
 * A seam rather than a direct read, because it is the one fact here that comes
 * from the filesystem: whether Claude still holds the session's transcript.
 * Unset, an agent reports as not resumable, so the surface offers to start one
 * rather than promise a conversation it cannot prove exists.
 */
func (h *SpawnHandler) SetResumableLookup(fn func(sessionID string) bool) { h.resumableSessions = fn }

/*
 * DashboardAgentConfig handles GET /api/dashboard-agents/{id}/config.
 *
 * The agent in full, for the surface that opens one with no session running:
 * identity, folder, Project, saved instructions and saved permission mode, plus
 * whether its last session can still be resumed. The list route deliberately
 * omits instructions, which run to thousands of characters; this is where they
 * are read, when something actually shows them.
 */
func (h *SpawnHandler) DashboardAgentConfig(w http.ResponseWriter, r *http.Request) {
	if h.dashboardAgents == nil {
		lifecycleJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "this server stores no agents"})
		return
	}
	id := r.PathValue("id")
	cfg, found := h.dashboardAgents.ByID(id)
	if !found {
		lifecycleJSON(w, http.StatusNotFound, map[string]string{"error": "no such agent"})
		return
	}
	resumable := false
	if cfg.SessionID != "" && h.resumableSessions != nil {
		resumable = h.resumableSessions(cfg.SessionID)
	}
	lifecycleJSON(w, http.StatusOK, sdk.DashboardAgentConfigDTO{
		AgentID:        cfg.AgentID,
		DisplayName:    cfg.DisplayName,
		Category:       cfg.Category,
		Cwd:            cfg.Cwd,
		ProjectID:      cfg.ProjectID,
		Instructions:   cfg.Instructions,
		PermissionMode: cfg.PermissionMode,
		Role:           cfg.Role,
		SessionID:      cfg.SessionID,
		Resumable:      resumable,
	})
}

// ListDashboardAgents handles GET /api/dashboard-agents.
func (h *SpawnHandler) ListDashboardAgents(w http.ResponseWriter, r *http.Request) {
	if h.dashboardAgents == nil {
		lifecycleJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "this server stores no agents"})
		return
	}
	rows := h.dashboardAgents.List()
	out := make([]sdk.DashboardAgentDTO, 0, len(rows))
	for _, cfg := range rows {
		out = append(out, dashboardAgentDTO(cfg, h.resumable(cfg)))
	}
	// A stable order, so the list does not shuffle between reads.
	sort.Slice(out, func(i, j int) bool {
		if out[i].Role != out[j].Role {
			return out[i].Role == agentconfig.RoleMain
		}
		if out[i].DisplayName != out[j].DisplayName {
			return out[i].DisplayName < out[j].DisplayName
		}
		return out[i].AgentID < out[j].AgentID
	})
	lifecycleJSON(w, http.StatusOK, out)
}

// UpdateDashboardAgent handles PUT /api/dashboard-agents/{id}: the same
// configuration the pid route writes, for an agent with no session running.
func (h *SpawnHandler) UpdateDashboardAgent(w http.ResponseWriter, r *http.Request) {
	if h.dashboardAgents == nil {
		lifecycleJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "this server stores no agents"})
		return
	}
	id := r.PathValue("id")
	if id == "" {
		lifecycleJSON(w, http.StatusBadRequest, map[string]string{"error": "missing agent id"})
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
	cfg, err := h.dashboardAgents.SaveByID(r.Context(), id, agentconfig.Patch{
		DisplayName:    body.DisplayName,
		Category:       body.Category,
		Instructions:   body.Instructions,
		PermissionMode: body.PermissionMode,
	})
	switch {
	case errors.Is(err, agentconfig.ErrNotFound):
		lifecycleJSON(w, http.StatusNotFound, map[string]string{"error": "no such agent"})
		return
	case err != nil:
		lifecycleJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	h.audit(r, "dashboard_agent_update", 0, map[string]any{
		"agentId": cfg.AgentID, "permissionMode": cfg.PermissionMode, "hasInstructions": cfg.Instructions != "",
	})
	lifecycleJSON(w, http.StatusOK, dashboardAgentDTO(cfg, h.resumable(cfg)))
}

/*
 * DeleteDashboardAgent handles DELETE /api/dashboard-agents/{id}.
 *
 * This removes the dashboard's record of an agent and nothing else. The working
 * folder, the repository and the session transcript stay exactly where they
 * are — deleting an agent has never meant deleting anyone's work, and it does
 * not start meaning that because the record moved.
 *
 * The main agent is refused: it is seeded and permanent.
 */
func (h *SpawnHandler) DeleteDashboardAgent(w http.ResponseWriter, r *http.Request) {
	if h.dashboardAgents == nil {
		lifecycleJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "this server stores no agents"})
		return
	}
	id := r.PathValue("id")
	if id == "" {
		lifecycleJSON(w, http.StatusBadRequest, map[string]string{"error": "missing agent id"})
		return
	}
	cfg, found := h.dashboardAgents.ByID(id)
	if !found {
		lifecycleJSON(w, http.StatusNotFound, map[string]string{"error": "no such agent"})
		return
	}
	/*
	 * The main agent is permanent, and says so before anything else.
	 *
	 * Its session is usually running - it maintains this dashboard - so a
	 * liveness check first would answer "stop it and try again", which is advice
	 * towards something that will never be allowed. The reason it cannot be
	 * deleted has nothing to do with whether it is running.
	 */
	if cfg.IsMain() {
		lifecycleJSON(w, http.StatusForbidden, map[string]any{
			"error": "This is the main agent, which maintains Agent Dashboard. It cannot be deleted.",
			"main":  true,
		})
		return
	}
	/*
	 * An agent whose session is running now is deleted through its own card,
	 * where stopping it is an explicit, confirmed step. Removing the record from
	 * underneath a live process would leave the process running and unnamed.
	 */
	if cfg.SessionID != "" && h.liveSessions != nil && h.liveSessions(cfg.SessionID) {
		lifecycleJSON(w, http.StatusConflict, map[string]any{
			"error":   "This agent has a session running. Stop it from the agent's card first.",
			"running": true,
		})
		return
	}
	removed, err := h.dashboardAgents.DeleteByID(r.Context(), id)
	switch {
	case errors.Is(err, agentconfig.ErrMainAgentPermanent):
		lifecycleJSON(w, http.StatusForbidden, map[string]any{
			"error": "This is the main agent, which maintains Agent Dashboard. It cannot be deleted.",
			"main":  true,
		})
		return
	case err != nil:
		lifecycleJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	h.audit(r, "dashboard_agent_delete", 0, map[string]any{"agentId": id, "sessionId": cfg.SessionID})
	lifecycleJSON(w, http.StatusOK, map[string]any{"deleted": removed, "agentId": id})
}

// resumable reports whether this agent's last session can still be reopened.
func (h *SpawnHandler) resumable(cfg agentconfig.Config) bool {
	return cfg.SessionID != "" && h.resumableSessions != nil && h.resumableSessions(cfg.SessionID)
}

func dashboardAgentDTO(cfg agentconfig.Config, resumable bool) sdk.DashboardAgentDTO {
	return sdk.DashboardAgentDTO{
		AgentID:         cfg.AgentID,
		DisplayName:     cfg.DisplayName,
		Category:        cfg.Category,
		PermissionMode:  cfg.PermissionMode,
		HasInstructions: cfg.Instructions != "",
		Cwd:             cfg.Cwd,
		ProjectID:       cfg.ProjectID,
		Role:            cfg.Role,
		SessionID:       cfg.SessionID,
		Resumable:       resumable,
	}
}
