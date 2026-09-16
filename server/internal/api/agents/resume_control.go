package agents

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
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
	"github.com/lx-wnk/agent-dashboard/server/internal/validation"
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

	// What this resume will start the session with, decided before the running
	// session is touched: a refusal must not leave the agent stopped.
	resumeMode, resumeInstructions, ok := h.confirmedResumeConfig(w, r, agent)
	if !ok {
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
		"permissionMode":  resumeMode,
	}
	if resumeInstructions != "" {
		body["systemPrompt"] = resumeInstructions
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

/*
 * confirmedResumeConfig decides what a resume starts the new session with.
 *
 * The rule the owner asked for: a saved configuration may apply on resume, but
 * only after the user has seen it and confirmed it. So confirmation is not a
 * formality the client can skip - it carries back the exact values it displayed,
 * and they must still be the saved ones. If the configuration changed between
 * the dialog opening and the click (another tab, another window), the resume is
 * refused and the user is shown the current values rather than launching with
 * something they never saw.
 *
 * Without a confirmation the resume behaves exactly as it did before saved
 * configuration existed: claude's default mode and no standing instructions.
 * That is the non-escalating direction, which is why it is the fallback - a
 * saved "bypassPermissions" can never be applied by a client that simply did
 * not ask about it.
 */
func (h *SpawnHandler) confirmedResumeConfig(w http.ResponseWriter, r *http.Request, agent sdk.Agent) (mode string, instructions string, ok bool) {
	const defaultMode = validation.PermissionModeDefault
	var body struct {
		Confirmed *bool `json:"confirmed"`
		// PermissionMode and InstructionsFingerprint are what the confirmation
		// dialog showed. They are checked, never trusted: the values applied
		// come from the saved record.
		PermissionMode          *string `json:"permissionMode"`
		InstructionsFingerprint *string `json:"instructionsFingerprint"`
	}
	if r.Body != nil {
		// An absent or empty body is a resume with no confirmation, which is
		// allowed and simply applies nothing.
		_ = json.NewDecoder(r.Body).Decode(&body)
	}
	if body.Confirmed == nil || !*body.Confirmed {
		return defaultMode, "", true
	}
	if h.agentConfigs == nil {
		return defaultMode, "", true
	}
	cfg, found := h.agentConfigs.Lookup(agent.SessionID)
	if !found {
		// Nothing is saved, so there was nothing to confirm; starting with the
		// default is what the user was shown.
		return defaultMode, "", true
	}

	savedMode := cfg.PermissionMode
	if savedMode == "" {
		savedMode = defaultMode
	}
	shown := defaultMode
	if body.PermissionMode != nil {
		shown = *body.PermissionMode
	}
	if shown != savedMode {
		lifecycleJSON(w, http.StatusConflict, map[string]any{
			"error":  "This agent's saved configuration changed since it was shown. Check it and confirm again.",
			"reason": "stale_configuration",
			"config": agentConfigDTO(agent, cfg),
		})
		return "", "", false
	}
	if body.InstructionsFingerprint != nil && *body.InstructionsFingerprint != InstructionsFingerprint(cfg.Instructions) {
		lifecycleJSON(w, http.StatusConflict, map[string]any{
			"error":  "This agent's saved instructions changed since they were shown. Check them and confirm again.",
			"reason": "stale_configuration",
			"config": agentConfigDTO(agent, cfg),
		})
		return "", "", false
	}
	if !validation.IsPermissionMode(savedMode) {
		lifecycleJSON(w, http.StatusConflict, map[string]string{"error": "This agent's saved permission mode is not one this dashboard can use."})
		return "", "", false
	}
	return savedMode, cfg.Instructions, true
}

// InstructionsFingerprint identifies a body of instructions without carrying it.
// The confirmation dialog sends back the fingerprint of what it displayed, so a
// text edited in another tab is caught before a session starts on it.
func InstructionsFingerprint(instructions string) string {
	sum := sha256.Sum256([]byte(instructions))
	return hex.EncodeToString(sum[:])[:16]
}
