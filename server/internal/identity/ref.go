package identity

import (
	"context"
	"path/filepath"

	"github.com/lx-wnk/agent-dashboard/sdk"
)

/*
The one place a resolved workspace becomes a wire type.

Agents, LocalScope services and LocalScope processes all need to say which
checkout they belong to, and all three must say it the same way — correlation
is id equality, so two mappings that disagreed about how an id is built would
silently stop matching. There is deliberately no ServiceWorkspaceRef or
ProcessWorkspaceRef: one contract, one builder, one set of rules.

This function is also the boundary that decides what identity information
leaves the server, and it is narrow on purpose. A repository's key is its
--git-common-dir — a .git internal path, and for a submodule
<super>/.git/modules/<name> — which nothing in a UI can act on. Only its hash
travels. The workspace root is withheld for a different reason: it is an
ancestor of paths some payloads already carry, so publishing it would add
exposure to buy nothing Name does not already give.
*/

// Ref maps a resolved workspace onto the read-only wire type.
//
// Returns nil for a nil or keyless workspace. Nothing here invents a fallback:
// a ref built from a basename would make two unrelated checkouts that happen to
// share a folder name compare equal, which — now that correlation is id
// equality — would attach one project's services to another project's agent.
func Ref(ws *Workspace) *sdk.WorkspaceRef {
	if ws == nil || ws.Key == "" {
		return nil
	}
	ref := &sdk.WorkspaceRef{
		ID:       WorkspaceID(ws.Key),
		Name:     filepath.Base(ws.Key),
		Kind:     sdk.WorkspaceKind(ws.Kind),
		Branch:   ws.Branch,
		Detached: ws.Detached,
	}
	if ws.InRepository() {
		repoName := ""
		// Root is empty for a bare repository and for a submodule, whose object
		// store has no working-tree parent. An empty name is honest there; a
		// name taken from the .git path would describe git's internals.
		if ws.Repo.Root != "" {
			repoName = filepath.Base(ws.Repo.Root)
		}
		ref.Repository = &sdk.RepositoryRef{
			ID:   RepositoryID(ws.Repo.Key),
			Name: repoName,
		}
	}
	return ref
}

// RefFor resolves dir through the cache and maps the result in one step.
//
// The shape every caller actually wants. nil means "not known" — an empty dir,
// a resolver failure, a deleted directory, the budget expiring — and never "no
// workspace"; an unattributed observation is the correct outcome, because a
// false attribution puts another workspace's process on the wrong agent.
func (r *Resolver) RefFor(ctx context.Context, dir string) *sdk.WorkspaceRef {
	if r == nil || dir == "" {
		return nil
	}
	return Ref(r.Get(ctx, dir))
}
