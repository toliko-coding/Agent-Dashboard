package services

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/lx-wnk/agent-dashboard/server/internal/settings"
)

/*
 * Projectless agent workspaces (3N.2).
 *
 * An agent that is not about an existing repository still needs a folder to
 * run in. The dashboard can create one: <projectless root>/<folder name>, a
 * plain directory — no Git repository, no GitHub, no Dashboard Project.
 *
 * The chain of permissions is unchanged:
 *
 *   create the folder        an explicit user action; the name is reduced to a
 *                            safe single path element and the result must sit
 *                            directly under the root; an existing folder is
 *                            never reused or overwritten
 *   allow the folder         exactly that folder joins the working folders — the
 *                            root itself is never allowed, so nothing else under
 *                            it becomes a spawn directory
 *   Claude's folder trust    untouched: Claude Code still asks, and only the user
 *                            answers (Needs you)
 *
 * The root is a setting. Changing it moves nothing: folders already created
 * stay where they are, and agents in them keep working.
 */

// ProjectlessRootKey is the setting holding the projectless agents folder.
const ProjectlessRootKey = settings.ProjectlessRootKey

var (
	// ErrAgentFolderName is returned when a name has nothing usable as a folder name.
	ErrAgentFolderName = errors.New("the agent name needs letters or digits to name its workspace folder")
	// ErrWorkspaceExists is returned when the workspace folder already exists.
	ErrWorkspaceExists = errors.New("a folder with that name already exists in the projectless agents folder; choose another name")
	// ErrProjectlessRoot is returned for an unusable projectless agents folder.
	ErrProjectlessRoot = errors.New("the projectless agents folder must be an absolute path to a directory (or one that can be created), not the filesystem root or your home folder itself")
)

// maxFolderName bounds a generated folder name; names are ASCII after reduction.
const maxFolderName = 64

// Names Windows reserves for devices. Refused so a workspace folder can always
// be copied or synced elsewhere.
var reservedFolderNames = func() map[string]bool {
	m := map[string]bool{"con": true, "prn": true, "aux": true, "nul": true}
	for i := 1; i <= 9; i++ {
		m[fmt.Sprintf("com%d", i)] = true
		m[fmt.Sprintf("lpt%d", i)] = true
	}
	return m
}()

// ProjectlessFolderName reduces an agent name to one safe folder name: ASCII
// letters, digits, '_' and '.', with every other run of characters (spaces,
// slashes, backslashes, "..", control characters) becoming a single '-'.
// Leading and trailing separators are trimmed, so the result can never be
// ".", "..", absolute, hidden, or contain a path separator.
func ProjectlessFolderName(name string) (string, error) {
	var b strings.Builder
	pendingDash := false
	for _, r := range name {
		keep := (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '.'
		if !keep {
			pendingDash = b.Len() > 0
			continue
		}
		if pendingDash {
			b.WriteByte('-')
			pendingDash = false
		}
		b.WriteRune(r)
	}
	folder := strings.Trim(b.String(), "-._")
	if len(folder) > maxFolderName {
		folder = strings.TrimRight(folder[:maxFolderName], "-._")
	}
	for strings.Contains(folder, "..") {
		folder = strings.ReplaceAll(folder, "..", ".")
	}
	if folder == "" || reservedFolderNames[strings.ToLower(strings.SplitN(folder, ".", 2)[0])] {
		return "", ErrAgentFolderName
	}
	return folder, nil
}

// EffectiveProjectlessRoot returns the configured root, or the default
// ~/Documents/AI-Agents when none is set.
func EffectiveProjectlessRoot(s WorkingFolderSettings) (root string, isDefault bool, err error) {
	if s != nil {
		if raw := strings.TrimSpace(s.String(ProjectlessRootKey)); raw != "" {
			return raw, false, nil
		}
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", true, fmt.Errorf("projectless root: %w", err)
	}
	return filepath.Join(home, "Documents", "AI-Agents"), true, nil
}

// ValidateProjectlessRoot checks a candidate root: absolute and clean, not the
// filesystem root or the home folder itself, outside every sensitive directory,
// and either an existing directory or creatable inside an existing one.
func ValidateProjectlessRoot(path string) error {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path || path == string(filepath.Separator) {
		return ErrProjectlessRoot
	}
	canonical, err := canonicalize(path)
	if err != nil {
		return ErrProjectlessRoot
	}
	if home, herr := os.UserHomeDir(); herr == nil {
		if homeReal, rerr := canonicalize(home); rerr == nil && canonical == homeReal {
			return ErrProjectlessRoot
		}
	}
	if err := checkBlacklist(canonical); err != nil {
		return err
	}
	info, err := os.Stat(canonical)
	switch {
	case err == nil && !info.IsDir():
		return ErrProjectlessRoot
	case err == nil:
		return nil
	case !errors.Is(err, os.ErrNotExist):
		return ErrProjectlessRoot
	}
	// Not there yet: it is created on first use, so the nearest existing ancestor
	// must be a directory (a path under a regular file can never be created).
	for dir := filepath.Dir(canonical); ; dir = filepath.Dir(dir) {
		info, statErr := os.Stat(dir)
		if statErr == nil {
			if !info.IsDir() {
				return ErrProjectlessRoot
			}
			return nil
		}
		if !errors.Is(statErr, os.ErrNotExist) || dir == filepath.Dir(dir) {
			return ErrProjectlessRoot
		}
	}
}

// SetProjectlessRoot validates and stores a root; "" restores the default.
// Nothing on disk is moved.
func SetProjectlessRoot(ctx context.Context, s WorkingFolderSettings, path string) error {
	path = strings.TrimSpace(path)
	if path != "" {
		if err := ValidateProjectlessRoot(path); err != nil {
			return err
		}
	}
	return s.Set(ctx, ProjectlessRootKey, path)
}

// ProjectlessWorkspace is a workspace folder under the projectless root.
type ProjectlessWorkspace struct {
	Root   string `json:"root"`
	Folder string `json:"folder"`
	Path   string `json:"path"`
	Exists bool   `json:"exists"`
}

// PreviewProjectlessWorkspace reports where a workspace for name would be
// created, without creating anything.
func PreviewProjectlessWorkspace(s WorkingFolderSettings, name string) (ProjectlessWorkspace, error) {
	root, _, err := EffectiveProjectlessRoot(s)
	if err != nil {
		return ProjectlessWorkspace{}, err
	}
	folder, err := ProjectlessFolderName(name)
	if err != nil {
		return ProjectlessWorkspace{}, err
	}
	ws := ProjectlessWorkspace{Root: root, Folder: folder, Path: filepath.Join(root, folder)}
	if _, statErr := os.Lstat(ws.Path); statErr == nil {
		ws.Exists = true
	}
	return ws, nil
}

// CreateProjectlessWorkspace creates <root>/<folder name> for name and allows
// exactly that folder for agents. It never reuses or overwrites an existing
// folder, and removes the folder again if allowing it fails.
func CreateProjectlessWorkspace(ctx context.Context, s WorkingFolderSettings, name string) (ProjectlessWorkspace, error) {
	root, _, err := EffectiveProjectlessRoot(s)
	if err != nil {
		return ProjectlessWorkspace{}, err
	}
	if err := ValidateProjectlessRoot(root); err != nil {
		return ProjectlessWorkspace{}, err
	}
	folder, err := ProjectlessFolderName(name)
	if err != nil {
		return ProjectlessWorkspace{}, err
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return ProjectlessWorkspace{}, fmt.Errorf("create projectless agents folder: %w", err)
	}
	rootReal, err := filepath.EvalSymlinks(root)
	if err != nil {
		return ProjectlessWorkspace{}, fmt.Errorf("resolve projectless agents folder: %w", err)
	}
	// The root may resolve somewhere else through a symlink; check where it lands.
	if err := checkBlacklist(rootReal); err != nil {
		return ProjectlessWorkspace{}, err
	}
	target := filepath.Join(rootReal, folder)
	if filepath.Dir(target) != rootReal {
		return ProjectlessWorkspace{}, ErrAgentFolderName
	}
	// Mkdir, not MkdirAll: it fails on an existing folder instead of adopting it.
	if err := os.Mkdir(target, 0o755); err != nil {
		if errors.Is(err, os.ErrExist) {
			return ProjectlessWorkspace{}, ErrWorkspaceExists
		}
		return ProjectlessWorkspace{}, fmt.Errorf("create workspace folder: %w", err)
	}
	if _, err := AddWorkingFolder(ctx, s, target); err != nil {
		_ = os.Remove(target) // empty, and just created by this call
		return ProjectlessWorkspace{}, err
	}
	return ProjectlessWorkspace{Root: root, Folder: folder, Path: target}, nil
}
