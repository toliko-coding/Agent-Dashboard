package agents

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/lx-wnk/agent-dashboard/sdk"
	"github.com/lx-wnk/agent-dashboard/server/internal/api/projects"
	"github.com/lx-wnk/agent-dashboard/server/internal/identity"
	"github.com/lx-wnk/agent-dashboard/server/internal/services"
)

/*
 * Starting an agent without a Dashboard Project (3M).
 *
 *   POST   /api/agents/spawn/preflight         what the dashboard knows about a folder
 *   GET    /api/agents/working-folders         the explicitly allowed working folders
 *   POST   /api/agents/working-folders         allow a folder (explicit, audited)
 *   DELETE /api/agents/working-folders         stop allowing a folder
 *   POST   /api/agents/spawn/{pid}/folder-trust answer Claude's own trust question
 *
 * Two different permissions, deliberately kept apart:
 *
 *   The dashboard's spawn allow-list decides where the dashboard may START an
 *   agent. It is fed by Project folders and working folders, both added by the
 *   user. A Project is never required and never grants anything by being named.
 *
 *   Claude Code's trust question decides whether Claude will WORK in a folder.
 *   The dashboard never writes Claude's trust, never passes a flag to skip it,
 *   and answers it only when the user decides, on the exact folder Claude named.
 */

// FolderCheck is what the New Agent dialog learns about a folder before an
// agent is started there.
type FolderCheck struct {
	// Path is canonical when the folder exists, otherwise as given.
	Path    string `json:"path"`
	Allowed bool   `json:"allowed"`
	// Reason is empty when allowed: not-absolute, not-found, not-directory,
	// blacklisted, or outside-allowed-folders.
	Reason string `json:"reason,omitempty"`
	// CanAllow reports that adding the folder to the working folders would admit it.
	CanAllow bool `json:"canAllow"`
	// Workspace is the resolved checkout: repository, branch and kind, or a plain
	// folder with no repository. Null when not resolved.
	Workspace *sdk.WorkspaceRef `json:"workspace"`
}

const folderResolveTimeout = 3 * time.Second

// CheckFolder validates path against the spawn policy and resolves its
// workspace identity. A sensitive directory is refused before git ever runs in it.
func (m *SpawnManager) CheckFolder(ctx context.Context, path string) FolderCheck {
	out := FolderCheck{Path: path}
	if !projects.ValidateAbsolutePath(path) {
		out.Reason = "not-absolute"
		return out
	}
	info, err := os.Stat(path)
	if err != nil {
		out.Reason = "not-found"
		return out
	}
	if !info.IsDir() {
		out.Reason = "not-directory"
		return out
	}
	if canonical, cerr := identity.Canonical(path); cerr == nil {
		out.Path = canonical
	}
	if perr := m.spawnPolicy.Allow(ctx, out.Path); perr != nil {
		if errors.Is(perr, services.ErrCwdBlacklisted) {
			out.Reason = "blacklisted"
			return out
		}
		out.Reason = "outside-allowed-folders"
		out.CanAllow = true
	} else {
		out.Allowed = true
	}
	rctx, cancel := context.WithTimeout(ctx, folderResolveTimeout)
	defer cancel()
	if ws, rerr := identity.Resolve(rctx, out.Path); rerr == nil {
		out.Workspace = identity.Ref(ws)
	}
	return out
}

func writeFolderJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func decodeFolderPath(w http.ResponseWriter, r *http.Request) (string, bool) {
	var body struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 16*1024)).Decode(&body); err != nil || strings.TrimSpace(body.Path) == "" {
		writeJSONError(w, http.StatusBadRequest, "path is required")
		return "", false
	}
	return strings.TrimSpace(body.Path), true
}

// SetWorkingFolderSettings enables the working-folder routes.
func (h *SpawnHandler) SetWorkingFolderSettings(s services.WorkingFolderSettings) {
	h.workingFolders = s
}

// Preflight handles POST /api/agents/spawn/preflight.
func (h *SpawnHandler) Preflight(w http.ResponseWriter, r *http.Request) {
	path, ok := decodeFolderPath(w, r)
	if !ok {
		return
	}
	check := h.manager.CheckFolder(r.Context(), path)
	check.CanAllow = check.CanAllow && h.workingFolders != nil
	writeFolderJSON(w, http.StatusOK, check)
}

// ListWorkingFolders handles GET /api/agents/working-folders.
func (h *SpawnHandler) ListWorkingFolders(w http.ResponseWriter, _ *http.Request) {
	folders := services.WorkingFolders(h.workingFolders)
	if folders == nil {
		folders = []string{}
	}
	writeFolderJSON(w, http.StatusOK, map[string]any{"folders": folders})
}

// AddWorkingFolder handles POST /api/agents/working-folders.
func (h *SpawnHandler) AddWorkingFolder(w http.ResponseWriter, r *http.Request) {
	if h.workingFolders == nil {
		writeJSONError(w, http.StatusNotFound, "working folders are not available")
		return
	}
	path, ok := decodeFolderPath(w, r)
	if !ok {
		return
	}
	check := h.manager.CheckFolder(r.Context(), path)
	switch check.Reason {
	case "not-absolute":
		writeJSONError(w, http.StatusBadRequest, "path must be absolute and contain no '..' segment")
		return
	case "not-found", "not-directory":
		writeJSONError(w, http.StatusBadRequest, "path is not an existing folder")
		return
	case "blacklisted":
		writeJSONError(w, http.StatusForbidden, services.ErrCwdBlacklisted.Error())
		return
	}
	folders, err := services.AddWorkingFolder(r.Context(), h.workingFolders, check.Path)
	if err != nil {
		code := http.StatusInternalServerError
		if errors.Is(err, services.ErrCwdBlacklisted) {
			code = http.StatusForbidden
		}
		writeJSONError(w, code, err.Error())
		return
	}
	h.recordAudit(r.Context(), requestSub(r), "working_folder_allow", check.Path, nil)
	after := h.manager.CheckFolder(r.Context(), check.Path)
	writeFolderJSON(w, http.StatusCreated, map[string]any{"folders": folders, "check": after})
}

// RemoveWorkingFolder handles DELETE /api/agents/working-folders.
func (h *SpawnHandler) RemoveWorkingFolder(w http.ResponseWriter, r *http.Request) {
	if h.workingFolders == nil {
		writeJSONError(w, http.StatusNotFound, "working folders are not available")
		return
	}
	path, ok := decodeFolderPath(w, r)
	if !ok {
		return
	}
	folders, err := services.RemoveWorkingFolder(r.Context(), h.workingFolders, path)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.recordAudit(r.Context(), requestSub(r), "working_folder_remove", path, nil)
	if folders == nil {
		folders = []string{}
	}
	writeFolderJSON(w, http.StatusOK, map[string]any{"folders": folders})
}

// PendingFolderTrustSource reports processes the last server scan saw waiting
// at Claude's trust question, with the working directory read from the process.
// It lets an answer reach an agent this server instance did not start (for
// example after a restart), without trusting anything a client sends.
type PendingFolderTrustSource interface {
	PendingFolderTrustCwd(pid int) (string, bool)
}

// SetPendingFolderTrustSource installs the server-side pending trust state.
func (h *SpawnHandler) SetPendingFolderTrustSource(s PendingFolderTrustSource) {
	h.pendingTrust = s
}

// folderTrustAnswerHold is how long an answered question refuses another
// answer: long enough for Claude to leave the screen and the next scan to drop
// the pending item, so a second browser's click cannot land on what comes next.
var folderTrustAnswerHold = 30 * time.Second

// claimFolderTrustAnswer reserves the single answer for pid, or reports that
// one was already given.
func (m *SpawnManager) claimFolderTrustAnswer(pid int) bool {
	m.trustAnswerMu.Lock()
	defer m.trustAnswerMu.Unlock()
	if at, ok := m.trustAnswered[pid]; ok && time.Since(at) < folderTrustAnswerHold {
		return false
	}
	if m.trustAnswered == nil {
		m.trustAnswered = make(map[int]time.Time)
	}
	m.trustAnswered[pid] = time.Now()
	return true
}

func (m *SpawnManager) releaseFolderTrustAnswer(pid int) {
	m.trustAnswerMu.Lock()
	defer m.trustAnswerMu.Unlock()
	delete(m.trustAnswered, pid)
}

// Terminal key sequences for Claude's two-option trust selector.
const (
	keyUp    = "\x1b[A"
	keyDown  = "\x1b[B"
	keyEnter = "\r"
)

// folderTrustKeyGap separates a selector move from its confirm: a TUI can read
// an arrow and a carriage return that arrive in one write as one sequence.
var folderTrustKeyGap = 150 * time.Millisecond

// FolderTrustKeys is the keystroke sequence that answers Claude's trust
// question with decision ("trust" or "exit"), given which option is highlighted.
func FolderTrustKeys(decision, selected string) ([]string, error) {
	switch decision {
	case "trust":
		if selected == "trust" {
			return []string{keyEnter}, nil
		}
		return []string{keyDown, keyEnter}, nil
	case "exit":
		if selected == "exit" {
			return []string{keyEnter}, nil
		}
		return []string{keyUp, keyEnter}, nil
	}
	return nil, fmt.Errorf("decision must be trust or exit")
}

// sameFolder compares two folder paths canonically; "~/" is the home directory.
func sameFolder(a, b string) bool {
	expand := func(p string) string {
		if strings.HasPrefix(p, "~/") {
			if home, err := os.UserHomeDir(); err == nil {
				return filepath.Join(home, p[2:])
			}
		}
		return p
	}
	ca, errA := identity.Canonical(expand(a))
	cb, errB := identity.Canonical(expand(b))
	return errA == nil && errB == nil && ca == cb
}

// FolderTrust handles POST /api/agents/spawn/{pid}/folder-trust.
//
// The only way the dashboard answers Claude's trust question: an explicit user
// decision, for a spawn this server started, delivered only while the question
// is open and names exactly the folder the agent was started in.
func (h *SpawnHandler) FolderTrust(w http.ResponseWriter, r *http.Request) {
	pid, err := strconv.Atoi(r.PathValue("pid"))
	if err != nil || pid <= 0 {
		writeJSONError(w, http.StatusBadRequest, "invalid pid")
		return
	}
	// The folder the answer must match: the one this server started the agent in,
	// or — for a spawn it no longer remembers — the process's own working
	// directory from the last scan. Never a path from the request.
	status := h.manager.GetStatus(pid)
	cwd := ""
	if status != nil && status.Status == "running" {
		cwd = status.Cwd
	} else if h.pendingTrust != nil {
		if scanned, ok := h.pendingTrust.PendingFolderTrustCwd(pid); ok {
			cwd = scanned
		}
	}
	if status == nil && cwd == "" {
		writeJSONError(w, http.StatusNotFound, "unknown spawn PID")
		return
	}
	var body struct {
		Decision string `json:"decision"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1024)).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if _, err := FolderTrustKeys(body.Decision, ""); err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}
	if cwd == "" {
		writeJSONError(w, http.StatusConflict, "this agent is no longer running")
		return
	}
	// One answer per question: a second browser's click is refused rather than
	// sent to whatever Claude shows next.
	if !h.manager.claimFolderTrustAnswer(pid) {
		writeJSONError(w, http.StatusConflict, "This folder trust question was already answered")
		return
	}
	delivered := false
	defer func() {
		if !delivered {
			h.manager.releaseFolderTrustAnswer(pid)
		}
	}()
	screen := h.manager.probeScreen(pid)
	if screen == nil || screen.FolderTrust == nil {
		writeJSONError(w, http.StatusConflict, "Claude is not asking to trust a folder right now")
		return
	}
	if !sameFolder(screen.FolderTrust.Path, cwd) {
		writeJSONError(w, http.StatusConflict, "Claude is asking about a different folder than this agent was started in")
		return
	}
	tokens, _ := FolderTrustKeys(body.Decision, screen.FolderTrust.Selected)
	transport := ""
	for i, token := range tokens {
		if i > 0 {
			time.Sleep(folderTrustKeyGap)
		}
		transport, err = h.manager.SendAnswerKeys(r.Context(), pid, []string{token})
		if err != nil {
			code := http.StatusBadGateway
			if errors.Is(err, ErrNoAnswerChannel) {
				code = http.StatusConflict
			}
			writeJSONError(w, code, err.Error())
			return
		}
	}
	delivered = true
	h.recordAudit(r.Context(), requestSub(r), "folder_trust", cwd, map[string]any{"decision": body.Decision, "transport": transport})
	writeFolderJSON(w, http.StatusOK, map[string]any{"ok": true, "decision": body.Decision})
}
