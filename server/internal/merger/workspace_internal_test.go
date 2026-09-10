package merger

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/lx-wnk/agent-dashboard/sdk"
	"github.com/lx-wnk/agent-dashboard/server/internal/identity"
	"github.com/lx-wnk/agent-dashboard/server/internal/parser"
	"github.com/lx-wnk/agent-dashboard/server/internal/scanner"
)

// stubResolver builds a Resolver backed by a fixed table, so these tests assert
// the MAPPING and never depend on a real repository being present.
func stubResolver(t *testing.T, table map[string]*identity.Workspace) *identity.Resolver {
	t.Helper()
	return identity.NewResolverForTest(func(_ context.Context, dir string) (*identity.Workspace, error) {
		return table[dir], nil
	})
}

func agentFor(t *testing.T, cwd string, r *identity.Resolver) sdk.Agent {
	t.Helper()
	m := New(WithWorkspaceResolver(r))
	return m.buildAgent(context.Background(), scanner.ProcessInfo{
		PID: 1, CWD: cwd, Provider: sdk.ProviderClaude,
	}, &parser.SessionData{SessionID: "s"}, resolveExtra{}, 0)
}

func TestAgent_ValidCwdGetsAWorkspaceRef(t *testing.T) {
	root := "/w/repo"
	r := stubResolver(t, map[string]*identity.Workspace{
		root: {
			Key:    root,
			Kind:   identity.KindGitMain,
			Branch: "main",
			Repo:   &identity.Repository{Key: "/w/repo/.git", Root: root},
		},
	})
	a := agentFor(t, root, r)

	if a.Workspace == nil {
		t.Fatal("a resolvable cwd must carry a workspace")
	}
	if a.Workspace.ID != identity.WorkspaceID(root) {
		t.Errorf("ID = %q", a.Workspace.ID)
	}
	if a.Workspace.Name != "repo" || a.Workspace.Branch != "main" {
		t.Errorf("Name/Branch = %q/%q", a.Workspace.Name, a.Workspace.Branch)
	}
	if a.Workspace.Kind != sdk.WorkspaceKindGitMain {
		t.Errorf("Kind = %q", a.Workspace.Kind)
	}
	if a.Workspace.Repository == nil || a.Workspace.Repository.ID != identity.RepositoryID("/w/repo/.git") {
		t.Error("a git checkout must carry a repository ref")
	}
	if a.Workspace.Repository.Name != "repo" {
		t.Errorf("Repository.Name = %q", a.Workspace.Repository.Name)
	}
}

func TestAgent_UnresolvableCwdGetsNilNeverAGuess(t *testing.T) {
	// The failure that matters: falling back to basename(cwd) would merge two
	// unrelated checkouts that happen to share a folder name.
	r := stubResolver(t, map[string]*identity.Workspace{})
	a := agentFor(t, "/somewhere/web", r)

	if a.Workspace != nil {
		t.Fatalf("unresolvable cwd must give nil, got %+v", a.Workspace)
	}
	// The pre-existing fields are untouched, so nothing regressed by omission.
	if a.ProjectName != "web" || a.CWD != "/somewhere/web" {
		t.Errorf("existing identity fields changed: %q / %q", a.ProjectName, a.CWD)
	}
}

func TestAgent_MissingCwdGetsNil(t *testing.T) {
	a := agentFor(t, "", stubResolver(t, map[string]*identity.Workspace{}))
	if a.Workspace != nil {
		t.Fatal("no cwd means no workspace")
	}
}

func TestAgent_NilResolverDisablesEnrichmentCleanly(t *testing.T) {
	m := New(WithWorkspaceResolver(nil))
	a := m.buildAgent(context.Background(), scanner.ProcessInfo{PID: 1, CWD: "/w/repo", Provider: sdk.ProviderClaude},
		&parser.SessionData{SessionID: "s"}, resolveExtra{}, 0)
	if a.Workspace != nil {
		t.Fatal("a disabled resolver must not synthesise a workspace")
	}
}

func TestAgent_WorktreesShareRepositoryAndDifferInWorkspace(t *testing.T) {
	/*
	 * The product rule, asserted on the payload a client actually receives.
	 * Before this field, these two agents were indistinguishable: both reported
	 * projectName "repo", and nothing else in the payload separated them.
	 */
	main, wt := "/w/repo", "/w/wt"
	commonDir := "/w/repo/.git"
	r := stubResolver(t, map[string]*identity.Workspace{
		main: {Key: main, Kind: identity.KindGitMain, Branch: "main",
			Repo: &identity.Repository{Key: commonDir, Root: main}},
		wt: {Key: wt, Kind: identity.KindGitWorktree, Branch: "feat/x",
			Repo: &identity.Repository{Key: commonDir, Root: main}},
	})
	a, b := agentFor(t, main, r), agentFor(t, wt, r)

	if a.Workspace.Repository.ID != b.Workspace.Repository.ID {
		t.Error("a worktree belongs to the same repository as its main checkout")
	}
	if a.Workspace.ID == b.Workspace.ID {
		t.Error("a worktree is a DIFFERENT workspace")
	}
	if a.Workspace.Branch == b.Workspace.Branch {
		t.Error("the two workspaces must report their own branches")
	}
	if b.Workspace.Kind != sdk.WorkspaceKindGitWorktree {
		t.Errorf("worktree Kind = %q", b.Workspace.Kind)
	}
	// Both name the same primary working tree, which is what makes them
	// recognisable as one project in the UI.
	if a.Workspace.Repository.Name != b.Workspace.Repository.Name {
		t.Error("both must name the same repository")
	}
}

func TestAgent_PlainDirectoryHasNoRepository(t *testing.T) {
	dir := "/w/notes"
	r := stubResolver(t, map[string]*identity.Workspace{
		dir: {Key: dir, Kind: identity.KindPlain},
	})
	a := agentFor(t, dir, r)

	if a.Workspace == nil {
		t.Fatal("a non-git directory is still a workspace — an agent runs in it")
	}
	if a.Workspace.Repository != nil {
		t.Error("a plain workspace has no repository")
	}
	if a.Workspace.Kind != sdk.WorkspaceKindPlain || a.Workspace.Branch != "" {
		t.Errorf("Kind/Branch = %q/%q", a.Workspace.Kind, a.Workspace.Branch)
	}
}

func TestAgent_DetachedHeadIsReportedAsSuchNotAsAMissingBranch(t *testing.T) {
	dir := "/w/wt"
	r := stubResolver(t, map[string]*identity.Workspace{
		dir: {Key: dir, Kind: identity.KindGitWorktree, Detached: true,
			Repo: &identity.Repository{Key: "/w/repo/.git", Root: "/w/repo"}},
	})
	a := agentFor(t, dir, r)
	if !a.Workspace.Detached {
		t.Error("detached must be distinguishable from a branch that could not be read")
	}
	if a.Workspace.Branch != "" {
		t.Errorf("a detached workspace has no branch, got %q", a.Workspace.Branch)
	}
}

func TestWorkspaceRef_CarriesNoFilesystemPath(t *testing.T) {
	/*
	 * The privacy rule for this payload. The repository key is a .git internal
	 * path; the workspace root is an ancestor of cwd. Neither may travel — only
	 * an opaque id and a display name.
	 */
	root := "/Users/someone/Documents/GitHub/Thing"
	commonDir := filepath.Join(root, ".git")
	r := stubResolver(t, map[string]*identity.Workspace{
		root: {Key: root, Kind: identity.KindGitMain, Branch: "main",
			Repo: &identity.Repository{Key: commonDir, Root: root}},
	})
	ws := agentFor(t, root, r).Workspace

	for _, field := range []string{ws.ID, ws.Name, ws.Repository.ID, ws.Repository.Name} {
		for _, leak := range []string{"/Users", "Documents", ".git", commonDir, root} {
			if field == leak || (len(field) > 3 && filepath.IsAbs(field)) {
				t.Errorf("field %q exposes path material (%q)", field, leak)
			}
		}
	}
	if ws.Name != "Thing" || ws.Repository.Name != "Thing" {
		t.Errorf("display names should be bare basenames, got %q / %q", ws.Name, ws.Repository.Name)
	}
}

func TestRepositoryRef_BareOrSubmoduleHasNoName(t *testing.T) {
	// A submodule's common dir is <super>/.git/modules/<name>; its parent is an
	// internal directory, not a checkout. An empty name is honest; a name taken
	// from that path would describe git's internals.
	dir := "/w/super/sub"
	r := stubResolver(t, map[string]*identity.Workspace{
		dir: {Key: dir, Kind: identity.KindGitMain,
			Repo: &identity.Repository{Key: "/w/super/.git/modules/sub", Root: ""}},
	})
	ws := agentFor(t, dir, r).Workspace
	if ws.Repository == nil {
		t.Fatal("a submodule is still in a repository")
	}
	if ws.Repository.Name != "" {
		t.Errorf("Repository.Name = %q, want empty", ws.Repository.Name)
	}
	if ws.Repository.ID == "" {
		t.Error("it must still have an id — grouping works without a display name")
	}
}
