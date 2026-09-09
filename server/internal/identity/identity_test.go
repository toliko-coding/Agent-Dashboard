package identity

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// git runs a git command in dir, failing the test on error. Signing and author
// identity are forced per-invocation so the suite does not depend on — or
// disturb — the developer's global git config.
func git(t *testing.T, dir string, args ...string) string {
	t.Helper()
	argv := append([]string{
		"-C", dir,
		"-c", "commit.gpgsign=false",
		"-c", "user.email=test@example.invalid",
		"-c", "user.name=Identity Test",
		"-c", "protocol.file.allow=always",
	}, args...)
	out, err := exec.Command("git", argv...).CombinedOutput()
	if err != nil {
		t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, out)
	}
	return strings.TrimSpace(string(out))
}

// newRepo creates an initialised repository with one commit and returns its
// canonical root. Canonical, not the raw path: on macOS t.TempDir() lives under
// /var/folders, and /var is a symlink to /private/var, so the raw path and the
// path git reports differ. Every expectation in this file is stated in the
// canonical form deliberately — that difference is the thing being tested.
func newRepo(t *testing.T, dir string) string {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	git(t, dir, "init", "-q")
	if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte("x\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	git(t, dir, "add", "-A")
	git(t, dir, "commit", "-qm", "init")
	c, err := Canonical(dir)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func resolve(t *testing.T, dir string) *Workspace {
	t.Helper()
	ws, err := Resolve(context.Background(), dir)
	if err != nil {
		t.Fatalf("Resolve(%s): %v", dir, err)
	}
	return ws
}

// --- Canonical / normalization -------------------------------------------

func TestCanonical_NormalizesAndResolvesSymlinks(t *testing.T) {
	base := t.TempDir()
	real := filepath.Join(base, "real")
	if err := os.MkdirAll(filepath.Join(real, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(base, "link")
	if err := os.Symlink(real, link); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}

	viaReal, err := Canonical(filepath.Join(real, "sub"))
	if err != nil {
		t.Fatal(err)
	}
	viaLink, err := Canonical(filepath.Join(link, "sub"))
	if err != nil {
		t.Fatal(err)
	}
	if viaReal != viaLink {
		t.Fatalf("symlinked path must canonicalise to the real one:\n  real: %s\n  link: %s", viaReal, viaLink)
	}

	// Cleaning: traversal and redundant separators collapse.
	messy, err := Canonical(filepath.Join(real, "sub", "..", ".", "sub"))
	if err != nil {
		t.Fatal(err)
	}
	if messy != viaReal {
		t.Fatalf("Clean not applied: got %s want %s", messy, viaReal)
	}
}

func TestCanonical_RejectsRelative(t *testing.T) {
	for _, p := range []string{"", "relative/path", "./x", ".."} {
		if _, err := Canonical(p); err == nil {
			t.Errorf("Canonical(%q) must fail: a relative path has no meaning without a cwd", p)
		}
	}
}

func TestCanonical_MissingPathKeepsResolvedAncestor(t *testing.T) {
	base := t.TempDir()
	real := filepath.Join(base, "real")
	if err := os.MkdirAll(real, 0o755); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(base, "link")
	if err := os.Symlink(real, link); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}

	// The leaf does not exist; the symlinked ancestor still must resolve, or a
	// deleted workspace would stop comparing equal to its own siblings.
	got, err := Canonical(filepath.Join(link, "gone", "deeper"))
	if err != nil {
		t.Fatal(err)
	}
	realCanonical, err := Canonical(real)
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(realCanonical, "gone", "deeper")
	if got != want {
		t.Fatalf("missing leaf: got %s want %s", got, want)
	}
}

// --- IsUnder --------------------------------------------------------------

func TestIsUnder(t *testing.T) {
	cases := []struct {
		child, parent string
		want          bool
		why           string
	}{
		{"/a/b", "/a/b", true, "a path contains itself"},
		{"/a/b/c", "/a/b", true, "direct child"},
		{"/a/b/c/d/e", "/a/b", true, "deep descendant"},
		{"/a/bc", "/a/b", false, "SIBLING FALSE POSITIVE: /a/bc is not under /a/b"},
		{"/a/b-2", "/a/b", false, "sibling with a suffix"},
		{"/a/webapp", "/a/web", false, "the canonical prefix-matching bug"},
		{"/a", "/a/b", false, "parent is not under its child"},
		{"/a/b/", "/a/b", true, "trailing separator is not a difference"},
		{"/a//b", "/a/b", true, "duplicate separators are not a difference"},
		{"/a/b/../b/c", "/a/b", true, "traversal is cleaned before comparing"},
		{"/a/b", "/", true, "everything is under the root"},
		{"", "/a", false, "empty child is never contained"},
		{"/a", "", false, "empty parent never contains"},
	}
	for _, c := range cases {
		if got := IsUnder(c.child, c.parent); got != c.want {
			t.Errorf("IsUnder(%q, %q) = %v, want %v — %s", c.child, c.parent, got, c.want, c.why)
		}
	}
}

// --- Repository / workspace resolution ------------------------------------

func TestResolve_NormalRepository(t *testing.T) {
	root := newRepo(t, filepath.Join(t.TempDir(), "repo"))
	ws := resolve(t, root)

	if ws.Kind != KindGitMain {
		t.Errorf("Kind = %q, want %q", ws.Kind, KindGitMain)
	}
	if ws.Key != root {
		t.Errorf("Key = %q, want %q", ws.Key, root)
	}
	if !ws.InRepository() {
		t.Fatal("a git checkout must have a repository")
	}
	if ws.Repo.Root != root {
		t.Errorf("Repo.Root = %q, want %q", ws.Repo.Root, root)
	}
	if ws.Repo.Key != filepath.Join(root, ".git") {
		t.Errorf("Repo.Key = %q, want %q", ws.Repo.Key, filepath.Join(root, ".git"))
	}
	if ws.Detached {
		t.Error("a fresh checkout is not detached")
	}
	if ws.Branch == "" {
		t.Error("a fresh checkout must report a branch")
	}
}

func TestResolve_NestedPathResolvesToWorkspaceRoot(t *testing.T) {
	root := newRepo(t, filepath.Join(t.TempDir(), "repo"))
	nested := filepath.Join(root, "a", "b", "c")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	ws := resolve(t, nested)
	if ws.Key != root {
		t.Fatalf("a nested path must resolve to its workspace root: got %s want %s", ws.Key, root)
	}
}

func TestResolve_MonorepoPackageIsNotItsOwnWorkspace(t *testing.T) {
	/*
	 * The finding this test pins: a monorepo package is a sub-path of one
	 * workspace, not a workspace of its own. Two packages in the same repo
	 * resolve to the SAME workspace key, so any future per-package grouping
	 * must be a third concept layered on top — it cannot be derived from git.
	 */
	root := newRepo(t, filepath.Join(t.TempDir(), "mono"))
	pkgA := filepath.Join(root, "packages", "a")
	pkgB := filepath.Join(root, "packages", "b")
	for _, p := range []string{pkgA, pkgB} {
		if err := os.MkdirAll(p, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(p, "package.json"), []byte("{}\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	a, b := resolve(t, pkgA), resolve(t, pkgB)

	if !SameWorkspace(a, b) {
		t.Error("two packages in one repo are the same workspace")
	}
	if a.Key != root {
		t.Errorf("package resolved to %s, want the repo root %s", a.Key, root)
	}
}

func TestResolve_NonGitFolder(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "plain", "nested")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	canonical, err := Canonical(dir)
	if err != nil {
		t.Fatal(err)
	}
	ws := resolve(t, dir)

	if ws.Kind != KindPlain {
		t.Errorf("Kind = %q, want %q", ws.Kind, KindPlain)
	}
	if ws.InRepository() {
		t.Error("a non-git folder has no repository")
	}
	// The directory itself is the workspace: it is where an agent would run.
	if ws.Key != canonical {
		t.Errorf("Key = %q, want %q", ws.Key, canonical)
	}
}

func TestResolve_MissingFolder(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "does", "not", "exist")
	ws, err := Resolve(context.Background(), missing)
	if err != nil {
		t.Fatalf("a missing directory must resolve, not error: %v", err)
	}
	if ws.Kind != KindPlain {
		t.Errorf("Kind = %q, want %q", ws.Kind, KindPlain)
	}
	if ws.Key == "" {
		t.Error("a missing directory still needs a stable key")
	}
}

func TestResolve_SymlinkedRepositoryIsTheSameWorkspace(t *testing.T) {
	base := t.TempDir()
	root := newRepo(t, filepath.Join(base, "repo"))
	link := filepath.Join(base, "link-to-repo")
	if err := os.Symlink(root, link); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}

	direct := resolve(t, root)
	viaLink := resolve(t, link)

	if !SameWorkspace(direct, viaLink) {
		t.Fatalf("a symlinked path is the same workspace:\n  direct: %s\n  link:   %s", direct.Key, viaLink.Key)
	}
	if !SameRepository(direct, viaLink) {
		t.Fatal("a symlinked path is the same repository")
	}
}

// --- Worktrees: the core product rule -------------------------------------

func TestResolve_WorktreeIsSameRepositoryDifferentWorkspace(t *testing.T) {
	base := t.TempDir()
	root := newRepo(t, filepath.Join(base, "repo"))
	wtPath := filepath.Join(base, "wt")
	git(t, root, "worktree", "add", "-q", "-b", "feature", wtPath)

	main := resolve(t, root)
	wt := resolve(t, wtPath)

	// The rule, stated directly.
	if !SameRepository(main, wt) {
		t.Errorf("a worktree belongs to the same repository:\n  main: %s\n  wt:   %s", main.Repo.Key, wt.Repo.Key)
	}
	if SameWorkspace(main, wt) {
		t.Error("a worktree is a DIFFERENT workspace")
	}
	if main.Kind != KindGitMain {
		t.Errorf("main Kind = %q, want %q", main.Kind, KindGitMain)
	}
	if wt.Kind != KindGitWorktree {
		t.Errorf("worktree Kind = %q, want %q", wt.Kind, KindGitWorktree)
	}
	// Independent branches are the reason they are separate workspaces.
	if wt.Branch != "feature" {
		t.Errorf("worktree branch = %q, want %q", wt.Branch, "feature")
	}
	if main.Branch == wt.Branch {
		t.Error("the two workspaces must hold different branches")
	}
	// Both report the same primary working tree.
	if wt.Repo.Root != root {
		t.Errorf("worktree Repo.Root = %q, want %q", wt.Repo.Root, root)
	}
}

func TestResolve_WorktreeNestedPath(t *testing.T) {
	base := t.TempDir()
	root := newRepo(t, filepath.Join(base, "repo"))
	wtPath := filepath.Join(base, "wt")
	git(t, root, "worktree", "add", "-q", "-b", "feature", wtPath)

	nested := filepath.Join(wtPath, "deep", "inside")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	ws := resolve(t, nested)
	wtCanonical, err := Canonical(wtPath)
	if err != nil {
		t.Fatal(err)
	}
	if ws.Key != wtCanonical {
		t.Fatalf("a path inside a worktree belongs to that worktree: got %s want %s", ws.Key, wtCanonical)
	}
	if ws.Kind != KindGitWorktree {
		t.Errorf("Kind = %q, want %q", ws.Kind, KindGitWorktree)
	}
}

func TestResolve_MovedWorktreeStillResolvesFromTheDirectory(t *testing.T) {
	/*
	 * `git worktree list` reports a moved worktree at its OLD path, marked
	 * prunable. This is why identity is resolved bottom-up from the directory
	 * in hand and never read from that list.
	 */
	base := t.TempDir()
	root := newRepo(t, filepath.Join(base, "repo"))
	original := filepath.Join(base, "wt")
	git(t, root, "worktree", "add", "-q", "--detach", original)

	moved := filepath.Join(base, "wt-moved")
	if err := os.Rename(original, moved); err != nil {
		t.Fatal(err)
	}

	ws := resolve(t, moved)
	movedCanonical, err := Canonical(moved)
	if err != nil {
		t.Fatal(err)
	}
	if ws.Key != movedCanonical {
		t.Errorf("moved worktree Key = %q, want its current location %q", ws.Key, movedCanonical)
	}
	if !SameRepository(ws, resolve(t, root)) {
		t.Error("moving a worktree does not change which repository it belongs to")
	}
	if !ws.Detached {
		t.Error("a --detach worktree must report Detached, not an empty branch")
	}
}

func TestResolve_TwoWorktreesAreSeparateWorkspaces(t *testing.T) {
	base := t.TempDir()
	root := newRepo(t, filepath.Join(base, "repo"))
	a := filepath.Join(base, "wt-a")
	b := filepath.Join(base, "wt-b")
	git(t, root, "worktree", "add", "-q", "-b", "branch-a", a)
	git(t, root, "worktree", "add", "-q", "-b", "branch-b", b)

	wsA, wsB, main := resolve(t, a), resolve(t, b), resolve(t, root)

	if SameWorkspace(wsA, wsB) {
		t.Error("two worktrees are two workspaces")
	}
	if !SameRepository(wsA, wsB) || !SameRepository(wsA, main) {
		t.Error("all three workspaces share one repository")
	}
	if wsA.Branch == wsB.Branch {
		t.Errorf("worktrees must report their own branches, both said %q", wsA.Branch)
	}
}

// --- Clones, forks, remotes ------------------------------------------------

func TestResolve_SeparateCloneIsADifferentRepository(t *testing.T) {
	/*
	 * A clone shares its root commit with its origin, which is exactly why the
	 * root commit is not used as identity: it would merge every checkout on the
	 * machine. Locally these are two repositories with independent files,
	 * branches and dirty state, and the dashboard observes local things.
	 */
	base := t.TempDir()
	root := newRepo(t, filepath.Join(base, "origin"))
	clone := filepath.Join(base, "clone")
	if out, err := exec.Command("git", "clone", "-q", "--no-hardlinks", root, clone).CombinedOutput(); err != nil {
		t.Fatalf("clone: %v\n%s", err, out)
	}

	origin := resolve(t, root)
	copyOf := resolve(t, clone)

	if SameRepository(origin, copyOf) {
		t.Error("two clones on disk are two local repositories")
	}
	if SameWorkspace(origin, copyOf) {
		t.Error("two clones are two workspaces")
	}

	// Same history, different identity — the property that makes root-commit
	// identity wrong.
	originRoot := git(t, root, "rev-list", "--max-parents=0", "HEAD")
	cloneRoot := git(t, clone, "rev-list", "--max-parents=0", "HEAD")
	if originRoot != cloneRoot {
		t.Fatal("precondition: a clone shares the origin's root commit")
	}
}

func TestResolve_RepositoryWithoutRemote(t *testing.T) {
	root := newRepo(t, filepath.Join(t.TempDir(), "local-only"))
	ws := resolve(t, root)
	if !ws.InRepository() {
		t.Error("a repository without a remote is still a repository")
	}
	if ws.Kind != KindGitMain {
		t.Errorf("Kind = %q, want %q", ws.Kind, KindGitMain)
	}
}

func TestResolve_SubmoduleIsItsOwnRepositoryWithASuperproject(t *testing.T) {
	base := t.TempDir()
	child := newRepo(t, filepath.Join(base, "child"))
	super := newRepo(t, filepath.Join(base, "super"))
	git(t, super, "submodule", "add", "-q", child, "sub")
	git(t, super, "commit", "-qm", "add submodule")

	subWs := resolve(t, filepath.Join(super, "sub"))
	superWs := resolve(t, super)

	if SameRepository(subWs, superWs) {
		t.Error("a submodule is its own repository, not the superproject's")
	}
	if subWs.Repo.Superproject != super {
		t.Errorf("Superproject = %q, want %q", subWs.Repo.Superproject, super)
	}
	// The common dir is .git/modules/<name>, whose parent is not a checkout.
	if subWs.Repo.Root != "" {
		t.Errorf("a submodule's common dir has no working-tree parent, got Root = %q", subWs.Repo.Root)
	}
}

// --- Remote redaction ------------------------------------------------------

func TestRedactRemote(t *testing.T) {
	cases := []struct{ in, want, why string }{
		{
			"https://user:ghp_secrettoken@github.com/org/repo.git",
			"https://redacted@github.com/org/repo.git",
			"a token in userinfo is a live credential",
		},
		{
			"https://github.com/org/repo.git",
			"https://github.com/org/repo.git",
			"a clean URL is unchanged",
		},
		{
			"git@github.com:org/repo.git",
			"git@github.com:org/repo.git",
			"scp-style carries no password field",
		},
		{"", "", "empty stays empty"},
		{"   ", "", "whitespace is empty"},
	}
	for _, c := range cases {
		if got := RedactRemote(c.in); got != c.want {
			t.Errorf("RedactRemote(%q) = %q, want %q — %s", c.in, got, c.want, c.why)
		}
	}

	// Nothing that looks like a secret may survive, whatever the shape.
	for _, in := range []string{
		"https://user:ghp_secrettoken@github.com/org/repo.git",
		"https://x-access-token:ghs_anothersecret@github.com/o/r.git",
	} {
		out := RedactRemote(in)
		for _, secret := range []string{"ghp_secrettoken", "ghs_anothersecret"} {
			if strings.Contains(out, secret) {
				t.Errorf("RedactRemote(%q) leaked a credential: %q", in, out)
			}
		}
	}
}

// --- Relation helpers on absent input --------------------------------------

func TestRelations_NilAndPlainAreNeverTheSameRepository(t *testing.T) {
	base := t.TempDir()
	p1 := filepath.Join(base, "one")
	p2 := filepath.Join(base, "two")
	for _, p := range []string{p1, p2} {
		if err := os.MkdirAll(p, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	a, b := resolve(t, p1), resolve(t, p2)

	if SameRepository(a, b) {
		t.Error("two plain directories share no repository — adjacency is not evidence")
	}
	if SameRepository(nil, a) || SameWorkspace(nil, a) || SameWorkspace(a, nil) {
		t.Error("nil is never the same as anything")
	}
	if SameWorkspace(a, a) != true {
		t.Error("a workspace is itself")
	}
}
