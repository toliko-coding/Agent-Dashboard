/*
Package identity resolves a filesystem path to the repository and workspace it
belongs to.

It answers one question the dashboard currently answers in four different ways:
given an absolute path — an agent's cwd, a task's working directory, a service's
project root — what is this, and what else is it the same thing as?

# The model

	Repository            one local .git object store
	  ├── Workspace A     the primary working tree
	  └── Workspace B     a linked worktree: same repository, different workspace

A workspace is where work happens: it has its own branch, its own dirty state,
its own checked-out files, and therefore its own agents, processes and services.
A repository is the history those workspaces share.

Both keys come from git itself rather than from anything inferred:

	Repository key = realpath(git rev-parse --git-common-dir)
	Workspace key  = realpath(git rev-parse --show-toplevel)

`--git-common-dir` is the same value from inside a linked worktree as from the
primary working tree, which is exactly the "same repository" relation. It also
differs between two clones of the same upstream, which is the right answer for
this application: the dashboard observes local processes, local files and local
dirty state, and two clones on disk share none of those.

# What is deliberately NOT identity

  - The root commit. A clone and a fork share it with their origin, so it would
    merge every checkout on the machine into one entity. Verified, not assumed.
  - The remote URL. Two clones of one upstream share it; a fork does not share
    it with its origin despite identical history.
  - The directory basename, or any display name. Two unrelated checkouts named
    "web" collide, and a rename would change identity.
  - Claude Code's encoded project directory. Its encoding maps '/', '.' and '_'
    all onto '-', so /a/my_app, /a/my.app and /a/my/app produce one identical
    directory name. It is a lossy many-to-one digest and cannot be inverted.

# Resolution direction

Identity is always resolved bottom-up, by asking git about the directory in
hand. It is never read from `git worktree list`, because that list is
registration metadata rather than observation: move a worktree on disk and the
list still reports the old path, marked prunable, while the directory itself
still answers correctly.

# Status

This package is an engine, not yet a wiring. Nothing in the dashboard consumes
it, no persisted identifier is derived from it, and no existing attribution is
changed by it. It is written and tested first so that the semantics can be
reviewed before anything depends on them.
*/
package identity

import (
	"context"
	"errors"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// gitTimeout bounds each git invocation so a hung or network-backed repository
// cannot stall a caller. Matches the budget cost_project_resolver.go already
// applies to the same kind of lookup.
const gitTimeout = 3 * time.Second

// ErrNotAbsolute is returned for a path that is not absolute. Every entry point
// requires one: a relative path is meaningless without a working directory, and
// silently resolving it against the server's own cwd would invent an answer.
var ErrNotAbsolute = errors.New("identity: path must be absolute")

// Kind describes what a workspace is, which is what decides how it relates to
// other workspaces rather than being merely descriptive.
type Kind string

const (
	// KindGitMain is a repository's primary working tree.
	KindGitMain Kind = "git-main"
	// KindGitWorktree is a linked worktree: the same repository as its main
	// working tree, a different workspace.
	KindGitWorktree Kind = "git-worktree"
	// KindPlain is a directory that is not inside any git repository. It is
	// still a workspace — agents run in such directories — but it has no
	// repository, and two of them are never "the same project".
	KindPlain Kind = "plain"
)

// Repository is one local git object store, shared by every workspace checked
// out from it.
type Repository struct {
	// Key is the canonical --git-common-dir. Two workspaces are in the same
	// repository if and only if their keys are equal.
	Key string
	// Root is the primary working tree when one can be derived, otherwise
	// empty. A bare repository and a submodule have a Key with no Root, which
	// is why this is reported separately rather than assumed to be Key's parent.
	Root string
	// Superproject is the working tree containing this repository as a
	// submodule, when it is one. Empty otherwise.
	Superproject string
}

// Workspace is one checked-out working tree — where work actually happens.
type Workspace struct {
	// Key is the canonical working-tree root, or the canonical directory
	// itself when the path is not in a repository.
	Key string
	// Kind decides the relation rules; see Kind.
	Kind Kind
	// Repo is nil exactly when Kind is KindPlain.
	Repo *Repository
	// Branch is the checked-out branch, empty when detached or absent.
	Branch string
	// Detached reports a detached HEAD, which is a normal state for a worktree
	// created to inspect a commit and must not be mistaken for "no branch yet".
	Detached bool
}

// InRepository reports whether the workspace has a repository at all.
func (w *Workspace) InRepository() bool {
	return w != nil && w.Repo != nil && w.Repo.Key != ""
}

// SameWorkspace reports whether two resolutions describe one working tree.
func SameWorkspace(a, b *Workspace) bool {
	if a == nil || b == nil || a.Key == "" || b.Key == "" {
		return false
	}
	return a.Key == b.Key
}

// SameRepository reports whether two workspaces share a repository.
//
// False for two plain directories even when they sit side by side: without a
// repository there is no evidence they are related, and adjacency is not
// evidence. This is the relation that makes a worktree "the same project" as
// its main checkout while remaining a different workspace.
func SameRepository(a, b *Workspace) bool {
	if !a.InRepository() || !b.InRepository() {
		return false
	}
	return a.Repo.Key == b.Repo.Key
}

/*
Canonical returns the absolute, symlink-resolved, cleaned form of path.

This is the only form two paths may be compared in. On macOS it is load-bearing
rather than cosmetic: /tmp is a symlink to /private/tmp and /var to /private/var,
so a process started in /tmp/x reports its cwd as /private/tmp/x while a path a
user typed stays /tmp/x. Comparing the two unresolved says they are different
places.

A path that does not exist cannot be symlink-resolved. Rather than failing —
a workspace can legitimately be deleted while a record of it survives — the
longest existing ancestor is resolved and the missing remainder appended, so a
vanished directory under a symlinked root still canonicalises consistently with
its siblings.
*/
func Canonical(path string) (string, error) {
	if path == "" {
		return "", ErrNotAbsolute
	}
	// Expanded before the absolute check so a stored "~/src" is usable.
	if path == "~" || strings.HasPrefix(path, "~/") {
		if home, err := os.UserHomeDir(); err == nil && home != "" {
			if path == "~" {
				path = home
			} else {
				path = filepath.Join(home, path[2:])
			}
		}
	}
	if !filepath.IsAbs(path) {
		return "", ErrNotAbsolute
	}

	clean := filepath.Clean(path)
	if resolved, err := filepath.EvalSymlinks(clean); err == nil {
		return resolved, nil
	}

	// Walk up to the deepest ancestor that exists, resolve that, and re-attach
	// the part that does not. filepath.Join cleans the result.
	missing := []string{}
	cur := clean
	for {
		parent := filepath.Dir(cur)
		if parent == cur {
			// Reached the root without finding anything resolvable.
			return clean, nil
		}
		missing = append([]string{filepath.Base(cur)}, missing...)
		if resolved, err := filepath.EvalSymlinks(parent); err == nil {
			return filepath.Join(append([]string{resolved}, missing...)...), nil
		}
		cur = parent
	}
}

/*
IsUnder reports whether child is parent itself or sits beneath it.

Comparison is on segment boundaries, so /home/u/webapp is NOT under /home/u/web.
A plain prefix test says it is, and that single mistake is enough to attribute
one project's agents, services and cost to another.

Both arguments are cleaned but NOT symlink-resolved: containment is a question
about two paths that are already in the same form. Callers comparing paths from
different sources must pass both through Canonical first.
*/
func IsUnder(child, parent string) bool {
	if child == "" || parent == "" {
		return false
	}
	c := filepath.Clean(child)
	p := filepath.Clean(parent)
	if c == p {
		return true
	}
	// Clean leaves a lone separator on the root, where p+separator would be "//".
	if p == string(filepath.Separator) {
		return strings.HasPrefix(c, p)
	}
	return strings.HasPrefix(c, p+string(filepath.Separator))
}

/*
Resolve determines the workspace containing dir.

dir must be absolute; it need not be a workspace root, and need not exist —
a path whose directory is gone resolves to a plain workspace rather than an
error, because the caller's alternative is to drop the record entirely.

Every git invocation is a fixed argument vector run without a shell, with dir
passed only as the operand of -C. This is the same mechanism, and the same
timeout, that cost_project_resolver.go already uses for the identical lookup.
*/
func Resolve(ctx context.Context, dir string) (*Workspace, error) {
	canonical, err := Canonical(dir)
	if err != nil {
		return nil, err
	}

	// A path that is not a directory is resolved as its containing directory:
	// a caller holding a file path is still asking which workspace it is in.
	if fi, statErr := os.Stat(canonical); statErr == nil && !fi.IsDir() {
		canonical = filepath.Dir(canonical)
	}

	top, ok := gitField(ctx, canonical, "--show-toplevel")
	if !ok || top == "" {
		return &Workspace{Key: canonical, Kind: KindPlain}, nil
	}
	workspaceKey, err := Canonical(top)
	if err != nil {
		workspaceKey = filepath.Clean(top)
	}

	commonDir, ok := gitField(ctx, canonical, "--path-format=absolute", "--git-common-dir")
	if !ok || commonDir == "" {
		// Inside a working tree but unable to name the object store. Reporting
		// a workspace with no repository is honest; inventing a key would make
		// two unrelated directories compare equal.
		return &Workspace{Key: workspaceKey, Kind: KindPlain}, nil
	}
	repoKey, err := Canonical(commonDir)
	if err != nil {
		repoKey = filepath.Clean(commonDir)
	}

	repo := &Repository{Key: repoKey}

	/*
	 * The primary working tree is the parent of the common dir only when the
	 * common dir is literally named ".git". That excludes a bare repository
	 * (…/repo.git) and a submodule (…/.git/modules/<name>), where the parent is
	 * an internal directory and not a checkout at all — deriving a Root there
	 * would name a path no work happens in.
	 */
	if filepath.Base(repoKey) == ".git" {
		repo.Root = filepath.Dir(repoKey)
	}
	if super, ok := gitField(ctx, canonical, "--show-superproject-working-tree"); ok && super != "" {
		if c, err := Canonical(super); err == nil {
			repo.Superproject = c
		}
	}

	/*
	 * Main vs linked worktree.
	 *
	 * A linked worktree's --git-dir is .git/worktrees/<name> while its
	 * --git-common-dir is the shared .git; in the primary working tree the two
	 * are equal. Comparing them is what git itself distinguishes on, and unlike
	 * a path-shape heuristic it survives a worktree being moved on disk.
	 */
	kind := KindGitMain
	if gitDir, ok := gitField(ctx, canonical, "--path-format=absolute", "--git-dir"); ok && gitDir != "" {
		if c, err := Canonical(gitDir); err == nil {
			gitDir = c
		}
		if gitDir != repoKey {
			kind = KindGitWorktree
		}
	}

	ws := &Workspace{Key: workspaceKey, Kind: kind, Repo: repo}

	if branch, ok := gitField(ctx, canonical, "--abbrev-ref", "HEAD"); ok {
		if branch == "HEAD" {
			ws.Detached = true
		} else {
			ws.Branch = branch
		}
	}
	return ws, nil
}

// gitField runs one `git -C dir rev-parse <args...>` and returns its single
// trimmed line. Any failure — git absent, not a repository, timeout — is
// reported as not-ok rather than as an empty value, so a caller can tell "git
// said nothing" from "git said the empty string".
func gitField(ctx context.Context, dir string, args ...string) (string, bool) {
	ctx, cancel := context.WithTimeout(ctx, gitTimeout)
	defer cancel()

	argv := append([]string{"-C", dir, "rev-parse"}, args...)
	out, err := exec.CommandContext(ctx, "git", argv...).Output()
	if err != nil {
		return "", false
	}
	v := strings.TrimSpace(string(out))
	if v == "" {
		return "", false
	}
	return v, true
}

/*
RedactRemote removes credentials from a remote URL.

A remote can carry a token or password in its userinfo
(https://user:token@host/org/repo.git). That value is a live credential, so it
must never reach a log line, an API response or a UI label. The host and path
are preserved because they are what makes the URL useful to a human.

Not identity, and deliberately kept away from it — see the package comment.
This exists so that if a remote is ever displayed, there is one already-correct
way to display it.
*/
func RedactRemote(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	// scp-style (git@host:org/repo.git) carries no password field and parses as
	// a relative URL, so it is returned as-is rather than mangled.
	if !strings.Contains(trimmed, "://") {
		return trimmed
	}
	u, err := url.Parse(trimmed)
	if err != nil {
		// Unparseable and possibly credential-bearing: withhold it entirely
		// rather than pass through something unexamined.
		return ""
	}
	if u.User != nil {
		if _, hasPassword := u.User.Password(); hasPassword {
			// "redacted" rather than a symbolic placeholder: url.String()
			// percent-encodes userinfo, so "***" would surface as "%2A%2A%2A"
			// and read as data rather than as a redaction.
			u.User = url.User("redacted")
		}
	}
	return u.String()
}
