package merger

import (
	"context"
	"path/filepath"

	"github.com/lx-wnk/agent-dashboard/sdk"
	"github.com/lx-wnk/agent-dashboard/server/internal/identity"
)

/*
Mapping a resolved workspace onto the wire.

This function is the boundary that decides what identity information leaves the
server, and it is deliberately narrow: an opaque id and a display name for each
of the two levels, plus the branch. No filesystem path crosses it.

Two omissions are the point rather than an oversight.

The repository key is a `--git-common-dir` — a `.git` internal path, and for a
submodule `<super>/.git/modules/<name>`. Nothing in the UI can act on it, and
publishing it would describe the machine's git layout to every caller. Only its
hash travels.

The workspace root is not published either. It is an ancestor of the `cwd` the
agent already reports, so it is close to free to expose, which is exactly why it
should not be: it buys the UI nothing that Name does not, and this checkpoint is
supposed to add identity without adding path exposure.
*/

// workspaceRef resolves cwd and maps it onto the read-only wire type.
//
// Returns nil for every failure, and nil means "not known" — never "no
// workspace". Nothing here falls back to a basename: a workspace synthesised
// from a folder name would silently merge two unrelated checkouts that happen
// to share one, which is the class of mistake this model exists to end.
func (m *Merger) workspaceRef(ctx context.Context, cwd string) *sdk.WorkspaceRef {
	if m == nil || m.workspaces == nil || cwd == "" {
		return nil
	}
	ws := m.workspaces.Get(ctx, cwd)
	if ws == nil || ws.Key == "" {
		return nil
	}

	ref := &sdk.WorkspaceRef{
		ID:       identity.WorkspaceID(ws.Key),
		Name:     filepath.Base(ws.Key),
		Kind:     sdk.WorkspaceKind(ws.Kind),
		Branch:   ws.Branch,
		Detached: ws.Detached,
	}

	if ws.InRepository() {
		repoName := ""
		// Root is empty for a bare repository and for a submodule, whose object
		// store has no working-tree parent. An empty name is honest there; a
		// name derived from the .git path would describe git's internals.
		if ws.Repo.Root != "" {
			repoName = filepath.Base(ws.Repo.Root)
		}
		ref.Repository = &sdk.RepositoryRef{
			ID:   identity.RepositoryID(ws.Repo.Key),
			Name: repoName,
		}
	}
	return ref
}
