package merger

import (
	"context"

	"github.com/lx-wnk/agent-dashboard/sdk"
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
// The mapping itself lives in identity.Ref, shared with the LocalScope service
// and process payloads. Correlation is workspace-id equality, so a second
// mapping that built an id even slightly differently would stop agents matching
// their own services — one builder is a correctness requirement, not tidiness.
//
// nil means "not known", never "no workspace". Nothing falls back to a
// basename: that would merge two unrelated checkouts sharing a folder name.
func (m *Merger) workspaceRef(ctx context.Context, cwd string) *sdk.WorkspaceRef {
	if m == nil {
		return nil
	}
	return m.workspaces.RefFor(ctx, cwd)
}
