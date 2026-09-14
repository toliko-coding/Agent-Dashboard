package agents

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"slices"
	"strconv"
	"syscall"
	"time"

	"github.com/lx-wnk/agent-dashboard/sdk"
	"github.com/lx-wnk/agent-dashboard/server/internal/channelconfig"
	"github.com/lx-wnk/agent-dashboard/server/internal/managedagent"
	"github.com/lx-wnk/agent-dashboard/server/internal/services"
)

/*
 * Stopping and deleting an agent (3N.2).
 *
 * What an agent is, to the dashboard: a Claude process (when it is running), its
 * session transcript under ~/.claude, the channel discovery files the dashboard
 * reads for it, a finished card the merger keeps after it exits, and an optional
 * agent_profile row (name and icon). Its working folder is the user's.
 *
 * Stop   ends the running process: SIGTERM, then SIGKILL if it has not exited.
 * Delete removes the agent from the dashboard: it stops the process first when
 *        it is running — only when the request says so (?stop=true), which the
 *        confirmation dialog sends after telling the user — then forgets the
 *        finished card, removes the discovery files and the profile row.
 *
 * Neither ever touches the working folder, the repository, Git, a Dashboard
 * Project or the Claude transcript: deleting an agent is not deleting its work
 * or its history.
 *
 * Both act only on a PID the dashboard's own scan currently knows as an agent
 * AND that this server launched (3N.2.1: a managed-agent record for that session
 * with that PID, or a spawn this run is tracking). An external session — started
 * in a terminal, VS Code or anything else — is observed, never stopped or
 * deleted: the answer is 403 and no signal is sent. Pipeline agents belong to
 * their task. Claude Code's internal daemons and remote sessions are refused.
 */

// AgentLookup finds an agent in the dashboard's most recent scan.
type AgentLookup interface {
	AgentByPID(pid int) (sdk.Agent, bool)
}

// AgentForgetter removes an agent's finished card and keeps it from returning.
type AgentForgetter interface {
	ForgetAgent(pid int, sessionID string)
}

// ProfileDeleter removes an agent's saved name and icon.
type ProfileDeleter interface {
	Delete(ctx context.Context, sessionID string) error
}

// SetAgentLookup wires the scan the stop and delete routes validate PIDs against.
// Unset, both routes answer 503.
func (h *SpawnHandler) SetAgentLookup(l AgentLookup) { h.agentLookup = l }

// SetAgentForgetter wires the finished-card tracker delete clears.
func (h *SpawnHandler) SetAgentForgetter(f AgentForgetter) { h.forgetter = f }

// SetProfileDeleter wires the profile store delete clears.
func (h *SpawnHandler) SetProfileDeleter(d ProfileDeleter) { h.profileDeleter = d }

// ManagedAgents is the ownership record the lifecycle routes read and clear.
type ManagedAgents interface {
	Owns(pid int, sessionID string) bool
	Get(sessionID string) (managedagent.Record, bool)
	Forget(ctx context.Context, sessionID string) error
	OthersUsing(path, exceptSession string) bool
}

// SetManagedAgents wires the ownership record. Unset, only this server run's
// own spawns are owned.
func (h *SpawnHandler) SetManagedAgents(m ManagedAgents) { h.managed = m }

// ExternalSessionMessage is what the dashboard says about a session it did not launch.
const ExternalSessionMessage = "External session — stop it from the terminal or application that started it."

// Ownership combines the persisted record with this server run's spawn tracker.
type Ownership struct {
	managed *managedagent.Store
	manager *SpawnManager
}

// NewOwnership builds the ownership check the merger attaches to every agent.
func NewOwnership(managed *managedagent.Store, manager *SpawnManager) *Ownership {
	return &Ownership{managed: managed, manager: manager}
}

// Owns reports whether this server launched the process pid for sessionID.
func (o *Ownership) Owns(pid int, sessionID string) bool {
	if o == nil {
		return false
	}
	if o.managed != nil && o.managed.Owns(pid, sessionID) {
		return true
	}
	return o.manager != nil && o.manager.SpawnedAndRunning(pid)
}

const (
	stopGrace    = 5 * time.Second
	killGrace    = 2 * time.Second
	stopPollStep = 100 * time.Millisecond
)

// terminateProcess sends SIGTERM and waits; SIGKILL follows when the process
// has not exited within stopGrace.
func terminateProcess(pid int) error {
	if err := syscall.Kill(pid, syscall.SIGTERM); err != nil {
		if errors.Is(err, syscall.ESRCH) {
			return nil
		}
		return fmt.Errorf("stop agent: %w", err)
	}
	if waitExit(pid, stopGrace) {
		return nil
	}
	if err := syscall.Kill(pid, syscall.SIGKILL); err != nil && !errors.Is(err, syscall.ESRCH) {
		return fmt.Errorf("stop agent: %w", err)
	}
	if waitExit(pid, killGrace) {
		return nil
	}
	return errors.New("stop agent: the process did not exit")
}

func waitExit(pid int, within time.Duration) bool {
	deadline := time.Now().Add(within)
	for time.Now().Before(deadline) {
		if !processAlive(pid) {
			return true
		}
		time.Sleep(stopPollStep)
	}
	return !processAlive(pid)
}

func lifecycleJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// owns is the lifecycle ownership rule, evaluated at request time.
func (h *SpawnHandler) owns(agent sdk.Agent) bool {
	if h.managed != nil && h.managed.Owns(agent.PID, agent.SessionID) {
		return true
	}
	return h.manager != nil && h.manager.SpawnedAndRunning(agent.PID)
}

// knownAgent is scannedAgent for a session this server owns: only an agent the
// dashboard launched can be stopped or deleted. Nothing else proves ownership —
// not being in the scan, the provider, the workspace, a channel or a terminal.
func (h *SpawnHandler) knownAgent(w http.ResponseWriter, r *http.Request) (sdk.Agent, bool) {
	agent, ok := h.scannedAgent(w, r)
	if !ok {
		return sdk.Agent{}, false
	}
	if agent.PipelineTaskID != "" {
		lifecycleJSON(w, http.StatusForbidden, map[string]any{"error": "This agent runs a pipeline task; stop or cancel the task instead.", "managedBy": "pipeline"})
		return sdk.Agent{}, false
	}
	if !h.owns(agent) {
		lifecycleJSON(w, http.StatusForbidden, map[string]any{"error": ExternalSessionMessage, "external": true})
		return sdk.Agent{}, false
	}
	return agent, true
}

// scannedAgent validates the path PID against the latest scan and the rules every
// agent route shares. ok=false means a response has already been written.
func (h *SpawnHandler) scannedAgent(w http.ResponseWriter, r *http.Request) (sdk.Agent, bool) {
	pid, err := strconv.Atoi(r.PathValue("pid"))
	if err != nil || pid <= 0 {
		lifecycleJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid pid"})
		return sdk.Agent{}, false
	}
	if h.agentLookup == nil {
		lifecycleJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "agent scan unavailable"})
		return sdk.Agent{}, false
	}
	agent, found := h.agentLookup.AgentByPID(pid)
	if !found {
		lifecycleJSON(w, http.StatusNotFound, map[string]string{"error": "no agent with that pid"})
		return sdk.Agent{}, false
	}
	if agent.InternalProcess {
		lifecycleJSON(w, http.StatusForbidden, map[string]string{"error": "Claude Code's internal processes are not agents and cannot be stopped or deleted here"})
		return sdk.Agent{}, false
	}
	if agent.Machine != "" {
		lifecycleJSON(w, http.StatusForbidden, map[string]string{"error": "agents on another machine cannot be stopped or deleted here"})
		return sdk.Agent{}, false
	}
	return agent, true
}

func (h *SpawnHandler) running(agent sdk.Agent) bool {
	alive := h.alive
	if alive == nil {
		alive = processAlive
	}
	return agent.Status != sdk.AgentStatusFinished && alive(agent.PID)
}

func (h *SpawnHandler) stop(pid int) error {
	if h.terminate != nil {
		return h.terminate(pid)
	}
	return terminateProcess(pid)
}

func (h *SpawnHandler) audit(r *http.Request, action string, pid int, meta map[string]any) {
	if h.auditRepo == nil {
		return
	}
	if err := h.auditRepo.RecordAudit(r.Context(), nil, action, fmt.Sprintf("pid:%d", pid), meta); err != nil {
		slog.Warn("agent lifecycle: audit write failed", "action", action, "err", err)
	}
}

// StopAgent handles POST /api/agents/{pid}/stop.
func (h *SpawnHandler) StopAgent(w http.ResponseWriter, r *http.Request) {
	agent, ok := h.knownAgent(w, r)
	if !ok {
		return
	}
	if !h.running(agent) {
		lifecycleJSON(w, http.StatusConflict, map[string]string{"error": "agent is not running"})
		return
	}
	if err := h.stop(agent.PID); err != nil {
		lifecycleJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	h.audit(r, "agent_stop", agent.PID, map[string]any{"sessionId": agent.SessionID})
	lifecycleJSON(w, http.StatusOK, map[string]any{"stopped": true})
}

// DeleteAgent handles DELETE /api/agents/{pid}. A running agent is stopped only
// with ?stop=true; without it the answer is 409 and nothing changes.
func (h *SpawnHandler) DeleteAgent(w http.ResponseWriter, r *http.Request) {
	agent, ok := h.knownAgent(w, r)
	if !ok {
		return
	}
	running := h.running(agent)
	if running && r.URL.Query().Get("stop") != "true" {
		lifecycleJSON(w, http.StatusConflict, map[string]any{"error": "agent is running; confirm stopping it to delete it", "running": true})
		return
	}
	if running {
		if err := h.stop(agent.PID); err != nil {
			lifecycleJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
	}

	if h.forgetter != nil {
		h.forgetter.ForgetAgent(agent.PID, agent.SessionID)
	} else if h.dismisser != nil {
		h.dismisser.DismissAgent(agent.PID)
	}
	if err := removeDiscoveryFiles(agent.PID); err != nil {
		lifecycleJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	profileRemoved := false
	if h.profileDeleter != nil && agent.SessionID != "" {
		if err := h.profileDeleter.Delete(r.Context(), agent.SessionID); err != nil {
			slog.Warn("agent delete: profile not removed", "err", err)
		} else {
			profileRemoved = true
		}
	}
	allowedFolderRemoved := h.releaseCreatedWorkspace(r.Context(), agent.SessionID)
	h.audit(r, "agent_delete", agent.PID, map[string]any{"sessionId": agent.SessionID, "stopped": running, "allowedFolderRemoved": allowedFolderRemoved})
	lifecycleJSON(w, http.StatusOK, map[string]any{"deleted": true, "stopped": running, "profileRemoved": profileRemoved, "allowedFolderRemoved": allowedFolderRemoved})
}

/*
 * releaseCreatedWorkspace removes the allowed-folder entry the dashboard added
 * for a projectless workspace it created for this agent, then forgets the
 * ownership record. The folder itself always stays on disk.
 *
 * The entry goes only when all of these hold, and otherwise stays (fail closed):
 * the record says the server created the workspace and names the exact entry it
 * added; no other owned agent's record runs in or added that folder; and the
 * entry is still on the list. Folder names are never compared, and no other
 * entry is touched. Claude Code's own trust state (~/.claude.json) is not the
 * dashboard's and is never read or written.
 */
func (h *SpawnHandler) releaseCreatedWorkspace(ctx context.Context, sessionID string) bool {
	if h.managed == nil || sessionID == "" {
		return false
	}
	rec, ok := h.managed.Get(sessionID)
	if !ok {
		return false
	}
	removed := false
	if rec.WorkspaceCreated && rec.AllowedFolder != "" && h.workingFolders != nil && !h.managed.OthersUsing(rec.AllowedFolder, sessionID) &&
		slices.Contains(services.WorkingFolders(h.workingFolders), rec.AllowedFolder) {
		if _, err := services.RemoveWorkingFolder(ctx, h.workingFolders, rec.AllowedFolder); err != nil {
			slog.Warn("agent delete: allowed folder not removed", "err", err)
		} else {
			removed = true
		}
	}
	if err := h.managed.Forget(ctx, sessionID); err != nil {
		slog.Warn("agent delete: ownership record not removed", "err", err)
	}
	return removed
}

// RemoveAgentProfile handles DELETE /api/agents/{pid}/profile: it removes the
// name and icon the dashboard stored for a session — presentation metadata the
// dashboard owns — without touching the process, whoever started it.
func (h *SpawnHandler) RemoveAgentProfile(w http.ResponseWriter, r *http.Request) {
	agent, ok := h.scannedAgent(w, r)
	if !ok {
		return
	}
	if h.profileDeleter == nil || agent.SessionID == "" {
		lifecycleJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "agent names are not stored on this server"})
		return
	}
	if err := h.profileDeleter.Delete(r.Context(), agent.SessionID); err != nil {
		lifecycleJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	h.audit(r, "agent_profile_remove", agent.PID, map[string]any{"sessionId": agent.SessionID})
	lifecycleJSON(w, http.StatusOK, map[string]any{"profileRemoved": true})
}

// removeDiscoveryFiles removes the channel discovery files the dashboard reads
// for pid. Missing files are fine.
func removeDiscoveryFiles(pid int) error {
	home, err := os.UserHomeDir()
	if err != nil {
		return errors.New("cannot resolve home")
	}
	for _, path := range []string{channelconfig.DiscoveryFile(home, pid), channelconfig.DiscoveryPtyFile(home, pid)} {
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return errors.New("failed to remove discovery file")
		}
	}
	return nil
}
