package agents

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"syscall"
	"time"

	"github.com/lx-wnk/agent-dashboard/sdk"
	"github.com/lx-wnk/agent-dashboard/server/internal/channelconfig"
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
 * Both act only on a PID the dashboard's own scan currently knows as an agent,
 * so they can never be pointed at an arbitrary process. Claude Code's internal
 * daemons and sessions on a remote machine are refused.
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

// knownAgent validates the path PID against the latest scan and the rules both
// routes share. ok=false means a response has already been written.
func (h *SpawnHandler) knownAgent(w http.ResponseWriter, r *http.Request) (sdk.Agent, bool) {
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
	h.audit(r, "agent_delete", agent.PID, map[string]any{"sessionId": agent.SessionID, "stopped": running})
	lifecycleJSON(w, http.StatusOK, map[string]any{"deleted": true, "stopped": running, "profileRemoved": profileRemoved})
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
