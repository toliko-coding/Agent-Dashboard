package merger

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/lx-wnk/agent-dashboard/server/internal/channel"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/lx-wnk/agent-dashboard/sdk"
	"github.com/lx-wnk/agent-dashboard/server/internal/askq"
	"github.com/lx-wnk/agent-dashboard/server/internal/channelconfig"
)

// questionProbeTimeout bounds the loopback HTTP round-trip so a slow or wedged
// pty broker never stalls a scan tick.
const questionProbeTimeout = 250 * time.Millisecond

// captureTmuxPane is a seam so tests can supply rendered pane rows without a
// real tmux. It returns the visible pane content (already rendered by tmux, so
// no VT emulation is needed) split into rows. The exec is bounded by
// questionProbeTimeout so a wedged tmux never stalls the scan hot path.
var captureTmuxPane = func(socket, pane string) ([]string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), questionProbeTimeout)
	defer cancel()
	args := []string{}
	if socket != "" {
		args = append(args, "-S", socket)
	}
	args = append(args, "capture-pane", "-p", "-t", pane)
	out, err := exec.CommandContext(ctx, "tmux", args...).Output()
	if err != nil {
		return nil, err
	}
	return strings.Split(string(out), "\n"), nil
}

// RealScreenProbe is the production ScreenProbeFn. It detects whichever
// AskUserQuestion screen — the modal itself or its review/submit screen — is
// currently open for pid, over whichever injection path the session uses: the
// pty broker's HTTP endpoints, or, for tmux sessions, a `tmux capture-pane`
// snapshot run through the same detectors. Fail-soft by design: any missing
// file, unreachable broker, or decode error yields nil rather than an error,
// since this runs on the hot scan path and must never fail agent building.
func RealScreenProbe(pid int) *sdk.PendingScreen {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}
	// Match SendAnswerKeys' transport precedence (tmux before pty) so, in the
	// rare case a session exposes both discovery files, detection and delivery
	// target the same channel.
	if s := probeTmuxScreen(home, pid); s != nil {
		return s
	}
	return probePtyScreen(home, pid)
}

// probePtyScreen queries the pty broker for pid's open screen, or nil.
//
// It prefers GET /screen (modal + review/submit screen) and falls back to the
// older GET /question (modal only) when the broker 404s it — a broker process
// spawned before /screen existed outlives a server upgrade, and losing modal
// detection for those sessions would be a regression.
func probePtyScreen(home string, pid int) *sdk.PendingScreen {
	data, err := os.ReadFile(channelconfig.DiscoveryPtyFile(home, pid))
	if err != nil {
		return nil
	}
	var disc struct {
		Port  int    `json:"port"`
		Token string `json:"token"`
	}
	if json.Unmarshal(data, &disc) != nil || disc.Port == 0 || disc.Token == "" {
		return nil
	}

	var screen sdk.PendingScreen
	status, ok := getBrokerJSON(disc.Port, disc.Token, "/screen", &screen)
	if ok {
		return &screen
	}
	if status != http.StatusNotFound {
		return nil
	}

	var q sdk.DetectedQuestion
	if _, ok := getBrokerJSON(disc.Port, disc.Token, "/question", &q); !ok {
		return nil
	}
	return &sdk.PendingScreen{Question: &q}
}

// getBrokerJSON performs one authorized loopback GET against the broker and
// decodes a 200 body into out. It reports the HTTP status (0 when the request
// never completed) and whether out was populated — 204 (no screen open) is a
// successful request but not a populated result.
func getBrokerJSON(port int, token, path string, out any) (int, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), questionProbeTimeout)
	defer cancel()
	url := fmt.Sprintf("http://127.0.0.1:%d%s", port, path)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return 0, false
	}
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, resp.Body)
		return resp.StatusCode, false
	}
	if json.NewDecoder(resp.Body).Decode(out) != nil {
		return resp.StatusCode, false
	}
	return resp.StatusCode, true
}

// probeTmuxScreen detects an open screen from a tmux session's rendered pane,
// or nil. tmux already renders the pane, so the rows go straight to the
// detectors without VT emulation — and one capture serves both.
func probeTmuxScreen(home string, pid int) *sdk.PendingScreen {
	data, err := os.ReadFile(channelconfig.DiscoveryFile(home, pid))
	if err != nil {
		return nil
	}
	var disc struct {
		TmuxPane   string `json:"tmuxPane"`
		TmuxSocket string `json:"tmuxSocket"`
	}
	if json.Unmarshal(data, &disc) != nil || disc.TmuxPane == "" {
		return nil
	}
	rows, err := captureTmuxPane(disc.TmuxSocket, disc.TmuxPane)
	if err != nil {
		return nil
	}
	return askq.DetectScreen(rows)
}

// errNoScreen reports a session with neither a tmux pane nor a pty broker.
var errNoScreen = errors.New("session has no readable screen")

// ReadSessionScreen returns the visible rows of pid's terminal: a tmux pane
// capture, or the pty broker's replay rendered on the server. It never writes
// to the session.
func ReadSessionScreen(ctx context.Context, pid int) ([]string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	if data, rerr := os.ReadFile(channelconfig.DiscoveryFile(home, pid)); rerr == nil {
		var disc struct {
			TmuxPane   string `json:"tmuxPane"`
			TmuxSocket string `json:"tmuxSocket"`
		}
		if json.Unmarshal(data, &disc) == nil && disc.TmuxPane != "" {
			return captureTmuxPane(disc.TmuxSocket, disc.TmuxPane)
		}
	}
	data, err := os.ReadFile(channelconfig.DiscoveryPtyFile(home, pid))
	if err != nil {
		return nil, errNoScreen
	}
	var disc struct {
		Port  int    `json:"port"`
		Token string `json:"token"`
	}
	if json.Unmarshal(data, &disc) != nil || disc.Port == 0 {
		return nil, errNoScreen
	}
	return channel.ReadBrokerScreen(ctx, disc.Port, disc.Token)
}

// permissionPromptCacheTTL keeps a session from being re-read on every scan
// tick; a decision drops the entry (ForgetPermissionPrompt) so it shows at once.
const permissionPromptCacheTTL = 3 * time.Second

type permissionPromptEntry struct {
	at     time.Time
	prompt *sdk.TerminalPermissionPrompt
}

var permissionPromptCache = struct {
	sync.Mutex
	m map[string]permissionPromptEntry
}{m: map[string]permissionPromptEntry{}}

// RealPermissionPrompt is the production PermissionPromptFn: it reads pid's
// screen and describes the tool permission prompt open on it, or nil.
func RealPermissionPrompt(ctx context.Context, pid int, sessionID string, pending *sdk.PendingToolUse) *sdk.TerminalPermissionPrompt {
	key := fmt.Sprintf("%d|%s", pid, sessionID)
	now := time.Now()
	permissionPromptCache.Lock()
	if e, ok := permissionPromptCache.m[key]; ok && now.Sub(e.at) < permissionPromptCacheTTL {
		permissionPromptCache.Unlock()
		return e.prompt
	}
	permissionPromptCache.Unlock()

	var prompt *sdk.TerminalPermissionPrompt
	if rows, err := ReadSessionScreen(ctx, pid); err == nil {
		prompt = askq.BuildTerminalPermission(sessionID, pid, pending, askq.ParsePermissionPrompt(rows))
	}

	permissionPromptCache.Lock()
	for k, e := range permissionPromptCache.m {
		if now.Sub(e.at) > time.Minute {
			delete(permissionPromptCache.m, k)
		}
	}
	permissionPromptCache.m[key] = permissionPromptEntry{at: now, prompt: prompt}
	permissionPromptCache.Unlock()
	return prompt
}

// ForgetPermissionPrompt drops pid's cached prompt after a decision, so the
// next scan reads the screen again instead of showing the answered prompt.
func ForgetPermissionPrompt(pid int) {
	prefix := fmt.Sprintf("%d|", pid)
	permissionPromptCache.Lock()
	defer permissionPromptCache.Unlock()
	for k := range permissionPromptCache.m {
		if strings.HasPrefix(k, prefix) {
			delete(permissionPromptCache.m, k)
		}
	}
}
