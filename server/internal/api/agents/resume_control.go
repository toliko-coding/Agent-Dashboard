package agents

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"github.com/lx-wnk/agent-dashboard/sdk"
	"github.com/lx-wnk/agent-dashboard/server/internal/agentprofile"
	"github.com/lx-wnk/agent-dashboard/server/internal/channelconfig"
	"github.com/lx-wnk/agent-dashboard/server/internal/services"
)

/*
 * Resume under Dashboard control (3N.2.2).
 *
 * Ownership stays what 3N.2.1 made it: the dashboard launched this process for
 * this session (managed_agent). Nothing here infers or grants ownership of a
 * process the dashboard did not launch. An agent the dashboard started before
 * that record existed — or any session the user wants the dashboard to manage —
 * gets there only through an explicit, confirmed action: the dashboard resumes
 * the same Claude conversation (--resume) as a NEW process it launches, and
 * that new process is recorded as owned in the ordinary way.
 *
 * - A finished session is simply resumed: no process is touched.
 * - A running session must end first. The dashboard never signals it. It is
 *   offered only when the running process is hosted by this dashboard's own
 *   headless pty broker (its parent is `<this server's binary> pty-host`) and
 *   is live-injectable; the dashboard then types Claude's own /exit into it,
 *   waits for it to end, and resumes. A session running in a terminal, VS Code
 *   or `agent-dashboard live` is refused: stop it where it runs, then resume.
 *   The host check only decides whether the action is offered; the ownership
 *   still comes from the new launch alone.
 *
 * The resumed session keeps its transcript, name and icon (keyed by session
 * id), and runs in the folder it ran in with the default permission mode.
 */

const (
	resumeExternalRunning = "External session — stop it from the terminal or application that started it, then resume it here."
	resumeExitWait        = 20 * time.Second
	resumeExitPoll        = 250 * time.Millisecond
)

// ResumeAvailability says whether an agent can be resumed under the dashboard.
type ResumeAvailability struct {
	Available bool `json:"available"`
	// EndsRunningSession: the running session is asked to /exit first.
	EndsRunningSession bool   `json:"endsRunningSession"`
	Reason             string `json:"reason,omitempty"`
}

// AgentControl is what the dashboard may do with an agent.
type AgentControl struct {
	Owned     bool               `json:"owned"`
	ManagedBy string             `json:"managedBy,omitempty"`
	Resume    ResumeAvailability `json:"resume"`
}

// SetProfileSaver wires the store name and icon edits are saved to.
func (h *SpawnHandler) SetProfileSaver(s ProfileSaver) { h.profileSaver = s }

func (h *SpawnHandler) hostedByDashboard(pid int) bool {
	if h.hosted != nil {
		return h.hosted(pid)
	}
	return dashboardHostedProcess(pid)
}

// dashboardHostedProcess reports whether pid's parent is this server binary's
// headless pty broker. Read with ps (argv only, no shell).
func dashboardHostedProcess(pid int) bool {
	self, err := channelconfig.SelfBinaryPath()
	if err != nil {
		return false
	}
	// #nosec G204 -- literal "ps", numeric pid argument.
	out, err := exec.Command("ps", "-o", "ppid=", "-p", strconv.Itoa(pid)).Output()
	if err != nil {
		return false
	}
	ppid, err := strconv.Atoi(strings.TrimSpace(string(out)))
	if err != nil || ppid <= 1 {
		return false
	}
	// #nosec G204 -- literal "ps", numeric pid argument.
	out, err = exec.Command("ps", "-ww", "-o", "command=", "-p", strconv.Itoa(ppid)).Output()
	if err != nil {
		return false
	}
	return strings.HasPrefix(strings.TrimSpace(string(out)), self+" "+channelconfig.SubcommandPtyHost+" ")
}

func (h *SpawnHandler) resumeAvailability(agent sdk.Agent) ResumeAvailability {
	switch {
	case agent.PipelineTaskID != "":
		return ResumeAvailability{Reason: "This agent runs a pipeline task; stop or cancel the task instead."}
	case agent.Provider != "" && agent.Provider != sdk.ProviderClaude:
		return ResumeAvailability{Reason: "Only Claude sessions can be resumed under Agent Dashboard."}
	case !uuidRE.MatchString(agent.SessionID):
		return ResumeAvailability{Reason: "This session has no Claude session id to resume."}
	case agent.CWD == "":
		return ResumeAvailability{Reason: "This session's working folder is unknown."}
	}
	if !h.running(agent) {
		return ResumeAvailability{Available: true}
	}
	if agent.LiveInjectable && h.hostedByDashboard(agent.PID) {
		return ResumeAvailability{Available: true, EndsRunningSession: true}
	}
	return ResumeAvailability{Reason: resumeExternalRunning}
}

// GetAgentControl handles GET /api/agents/{pid}/control. Asked on demand (the
// agent workspace opening), never polled.
func (h *SpawnHandler) GetAgentControl(w http.ResponseWriter, r *http.Request) {
	agent, ok := h.scannedAgent(w, r)
	if !ok {
		return
	}
	control := AgentControl{}
	switch {
	case agent.PipelineTaskID != "":
		control.ManagedBy = "pipeline"
		control.Resume = ResumeAvailability{Reason: "This agent runs a pipeline task; stop or cancel the task instead."}
	case h.owns(agent):
		control.Owned = true
		control.Resume = ResumeAvailability{Reason: "Already managed by Agent Dashboard."}
	default:
		control.Resume = h.resumeAvailability(agent)
	}
	lifecycleJSON(w, http.StatusOK, control)
}

// ResumeUnderDashboard handles POST /api/agents/{pid}/resume-under-dashboard.
func (h *SpawnHandler) ResumeUnderDashboard(w http.ResponseWriter, r *http.Request) {
	agent, ok := h.scannedAgent(w, r)
	if !ok {
		return
	}
	if agent.PipelineTaskID == "" && h.owns(agent) {
		lifecycleJSON(w, http.StatusConflict, map[string]any{"error": "Already managed by Agent Dashboard.", "owned": true})
		return
	}
	avail := h.resumeAvailability(agent)
	if !avail.Available {
		lifecycleJSON(w, http.StatusForbidden, map[string]any{"error": avail.Reason, "external": true})
		return
	}
	sub := requestSub(r)
	if !h.manager.IsSpawnAllowed(sub) {
		lifecycleJSON(w, http.StatusTooManyRequests, map[string]string{"error": "Too many spawn requests; try again shortly."})
		return
	}

	if avail.EndsRunningSession {
		if err := h.exitSession(r.Context(), agent.PID); err != nil {
			lifecycleJSON(w, http.StatusBadGateway, map[string]string{"error": "Could not ask the session to exit: " + err.Error()})
			return
		}
		if !h.waitForExit(agent.PID) {
			lifecycleJSON(w, http.StatusGatewayTimeout, map[string]string{"error": "The session did not exit, so it was not resumed. Nothing else was changed."})
			return
		}
	}

	// The old process is gone: its card goes (by PID — the resumed session keeps
	// its session id) along with the discovery files it left.
	if h.dismisser != nil {
		h.dismisser.DismissAgent(agent.PID)
	}
	if err := removeDiscoveryFiles(agent.PID); err != nil {
		slog.Warn("resume under dashboard: discovery files not removed", "err", err)
	}

	body := map[string]any{
		"cwd":             agent.CWD,
		"resumeSessionId": agent.SessionID,
		"enableChannel":   true,
		"permissionMode":  "default",
	}
	outcome, err := h.startResume(sub, body)
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, services.ErrCwdBlacklisted) || errors.Is(err, services.ErrCwdNotAllowed) {
			status = http.StatusForbidden
		}
		msg := err.Error()
		if avail.EndsRunningSession {
			msg = "The session ended but could not be resumed: " + msg + ". Its conversation is kept; resume it by sending it a message."
		}
		lifecycleJSON(w, status, map[string]string{"error": msg})
		return
	}
	h.audit(r, "agent_resume_under_dashboard", outcome.PID, map[string]any{
		"sessionId": agent.SessionID, "previousPid": agent.PID, "endedRunningSession": avail.EndsRunningSession,
	})
	lifecycleJSON(w, http.StatusOK, map[string]any{
		"ok": true, "pid": outcome.PID, "previousPid": agent.PID, "endedRunningSession": avail.EndsRunningSession,
	})
}

func (h *SpawnHandler) exitSession(ctx context.Context, pid int) error {
	if h.requestExit != nil {
		return h.requestExit(ctx, pid)
	}
	_, err := h.manager.SendMessageToChannel(ctx, pid, "/exit")
	return err
}

func (h *SpawnHandler) waitForExit(pid int) bool {
	wait := h.exitWait
	if wait <= 0 {
		wait = resumeExitWait
	}
	alive := h.alive
	if alive == nil {
		alive = processAlive
	}
	deadline := time.Now().Add(wait)
	for time.Now().Before(deadline) {
		if !alive(pid) {
			return true
		}
		time.Sleep(min(resumeExitPoll, wait))
	}
	return !alive(pid)
}

func (h *SpawnHandler) startResume(sub string, body map[string]any) (SpawnOutcome, error) {
	if h.resumeSpawn != nil {
		return h.resumeSpawn(sub, body)
	}
	return h.manager.spawn(sub, body, spawnProvenance{resumeWithoutPrompt: true})
}

// UpdateAgentProfile handles PUT /api/agents/{pid}/profile: the agent's name and
// icon, presentation metadata keyed by session id. It changes nothing else — not
// ownership, the process, the workspace, a Project, permissions or trust.
func (h *SpawnHandler) UpdateAgentProfile(w http.ResponseWriter, r *http.Request) {
	agent, ok := h.scannedAgent(w, r)
	if !ok {
		return
	}
	if h.profileSaver == nil || h.profileDeleter == nil {
		lifecycleJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "agent names are not stored on this server"})
		return
	}
	if agent.SessionID == "" {
		lifecycleJSON(w, http.StatusConflict, map[string]string{"error": "This agent has no session id to keep a name and icon for."})
		return
	}
	var body struct {
		DisplayName string `json:"displayName"`
		Category    string `json:"category"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		lifecycleJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	profile, err := agentprofile.Normalize(body.DisplayName, body.Category)
	if err != nil {
		lifecycleJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if profile.Empty() {
		err = h.profileDeleter.Delete(r.Context(), agent.SessionID)
	} else {
		err = h.profileSaver.Save(r.Context(), agent.SessionID, profile)
	}
	if err != nil {
		lifecycleJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	h.audit(r, "agent_profile_update", agent.PID, map[string]any{"sessionId": agent.SessionID, "category": profile.Category, "named": profile.DisplayName != ""})
	lifecycleJSON(w, http.StatusOK, map[string]string{"displayName": profile.DisplayName, "category": profile.Category})
}
