package localscope

import (
	"context"
	"sync/atomic"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"

	"github.com/lx-wnk/agent-dashboard/server/internal/identity"
)

/*
 * Workspace identity on the normalized service and process payloads.
 *
 * Resolution is stubbed so these assert the MAPPING and the EVIDENCE RULE, not
 * git's behaviour — that is covered against real repositories in the identity
 * package's own suite.
 */

// stubWorkspaces installs a resolver backed by a fixed table and returns a
// counter of how many times the underlying resolution actually ran.
func stubWorkspaces(t *testing.T, h *Handler, table map[string]*identity.Workspace) *atomic.Int32 {
	t.Helper()
	var calls atomic.Int32
	h.workspaces = identity.NewResolverForTest(func(_ context.Context, dir string) (*identity.Workspace, error) {
		calls.Add(1)
		return table[dir], nil
	})
	return &calls
}

func gitWorkspace(root, commonDir, branch string, kind identity.Kind) *identity.Workspace {
	return &identity.Workspace{
		Key: root, Kind: kind, Branch: branch,
		Repo: &identity.Repository{Key: commonDir, Root: "/gh/Agent-Dashboard"},
	}
}

func serveOnce(t *testing.T, u *upstream, body string) (*Handler, *chi.Mux) {
	t.Helper()
	u.body = body
	return snapshotHandlerFor(t, u)
}

func TestServiceWorkspace_ResolvedFromCwd(t *testing.T) {
	u := newUpstream(t)
	h, r := serveOnce(t, u, listBody(oneService, nowISO(), ""))
	stubWorkspaces(t, h, map[string]*identity.Workspace{
		"/gh/Agent-Dashboard": gitWorkspace("/gh/Agent-Dashboard", "/gh/Agent-Dashboard/.git", "main", identity.KindGitMain),
	})

	s := getServices(t, r).Items[0]
	require.NotNil(t, s.Workspace, "a service with a resolvable cwd carries a workspace")
	require.Equal(t, identity.WorkspaceID("/gh/Agent-Dashboard"), s.Workspace.ID)
	require.Equal(t, "Agent-Dashboard", s.Workspace.Name)
	require.Equal(t, "main", s.Workspace.Branch)
	require.NotNil(t, s.Workspace.Repository)
	require.Equal(t, identity.RepositoryID("/gh/Agent-Dashboard/.git"), s.Workspace.Repository.ID)
}

func TestProcessWorkspace_ResolvedFromCwd(t *testing.T) {
	u := newUpstream(t)
	h, r := serveOnce(t, u, listBody(oneProcess, nowISO(), ""))
	stubWorkspaces(t, h, map[string]*identity.Workspace{
		"/gh/Agent-Dashboard": gitWorkspace("/gh/Agent-Dashboard", "/gh/Agent-Dashboard/.git", "main", identity.KindGitMain),
	})

	p := getProcesses(t, r).Items[0]
	require.NotNil(t, p.Workspace)
	require.Equal(t, identity.WorkspaceID("/gh/Agent-Dashboard"), p.Workspace.ID)
	require.Equal(t, "main", p.Workspace.Branch)
}

func TestWorkspace_WorktreeIsDistinctButSharesTheRepository(t *testing.T) {
	/*
	 * The invariant the whole checkpoint rests on: same repository id, different
	 * workspace id. Correlation compares the workspace, so these must not be
	 * equal even though the repository is.
	 */
	main := gitWorkspace("/gh/Agent-Dashboard", "/gh/Agent-Dashboard/.git", "main", identity.KindGitMain)
	wt := gitWorkspace("/gh/wt", "/gh/Agent-Dashboard/.git", "feat/x", identity.KindGitWorktree)

	u := newUpstream(t)
	h, r := serveOnce(t, u, listBody(twoServicesDifferentCwd, nowISO(), ""))
	stubWorkspaces(t, h, map[string]*identity.Workspace{
		"/gh/Agent-Dashboard": main,
		"/gh/wt":              wt,
	})

	items := getServices(t, r).Items
	require.Len(t, items, 2)
	a, b := items[0].Workspace, items[1].Workspace
	require.NotNil(t, a)
	require.NotNil(t, b)

	require.Equal(t, a.Repository.ID, b.Repository.ID, "a worktree shares its main checkout's repository")
	require.NotEqual(t, a.ID, b.ID, "a worktree is a DIFFERENT workspace")
	require.NotEqual(t, a.Branch, b.Branch)
	require.Equal(t, "git-worktree", string(b.Kind))
}

func TestWorkspace_PlainDirectoryStillGetsAnIdentity(t *testing.T) {
	// A non-git cwd is not "unknown": it is a plain workspace with a real id, so
	// it participates in the same equality rule rather than a softer one.
	u := newUpstream(t)
	h, r := serveOnce(t, u, listBody(oneService, nowISO(), ""))
	stubWorkspaces(t, h, map[string]*identity.Workspace{
		"/gh/Agent-Dashboard": {Key: "/gh/Agent-Dashboard", Kind: identity.KindPlain},
	})

	s := getServices(t, r).Items[0]
	require.NotNil(t, s.Workspace)
	require.Equal(t, "plain", string(s.Workspace.Kind))
	require.Nil(t, s.Workspace.Repository, "a plain workspace has no repository")
	require.Empty(t, s.Workspace.Branch)
}

func TestWorkspace_UnresolvableCwdIsNullNotAGuess(t *testing.T) {
	u := newUpstream(t)
	h, r := serveOnce(t, u, listBody(oneService, nowISO(), ""))
	stubWorkspaces(t, h, map[string]*identity.Workspace{}) // resolves nothing

	s := getServices(t, r).Items[0]
	require.Nil(t, s.Workspace, "an unresolvable cwd leaves the service unattributed")
	// The evidence that was NOT used is still on the record, unchanged.
	require.NotNil(t, s.DiscoveredProject, "LocalScope's own attribution is still passed through")
	require.Equal(t, "/gh/Agent-Dashboard", s.DiscoveredProject.RootPath)
}

func TestWorkspace_ProjectRootPathIsNotUsedAsEvidence(t *testing.T) {
	/*
	 * The precedence decision, asserted rather than described. This service has
	 * NO cwd but a perfectly good discoveredProject.rootPath. It stays
	 * unattributed, because rootPath's trust is expressed by a single joint
	 * `confidence` that also covers kind and label, and because Process carries
	 * the same field with no confidence at all — one rule for both.
	 */
	u := newUpstream(t)
	h, r := serveOnce(t, u, listBody(serviceNoCwdWithProject, nowISO(), ""))
	stubWorkspaces(t, h, map[string]*identity.Workspace{
		"/gh/Agent-Dashboard": gitWorkspace("/gh/Agent-Dashboard", "/gh/Agent-Dashboard/.git", "main", identity.KindGitMain),
	})

	s := getServices(t, r).Items[0]
	require.Nil(t, s.Cwd)
	require.NotNil(t, s.DiscoveredProject, "the rootPath is present…")
	require.Nil(t, s.Workspace, "…and is deliberately not used to resolve identity")
}

func TestWorkspace_RepeatedCwdUsesTheCache(t *testing.T) {
	/*
	 * Measured live: 42 processes with a cwd across 9 distinct paths, one of
	 * them 15 times. Per-record resolution would shell out to git for each.
	 */
	u := newUpstream(t)
	h, r := serveOnce(t, u, listBody(threeProcessesSameCwd, nowISO(), ""))
	calls := stubWorkspaces(t, h, map[string]*identity.Workspace{
		"/gh/Agent-Dashboard": gitWorkspace("/gh/Agent-Dashboard", "/gh/Agent-Dashboard/.git", "main", identity.KindGitMain),
	})

	items := getProcesses(t, r).Items
	require.Len(t, items, 3)
	for _, p := range items {
		require.NotNil(t, p.Workspace)
	}
	require.Equal(t, int32(1), calls.Load(), "three records sharing one cwd must resolve once")
}

func TestWorkspace_StaleRetainsTheIdentityOfTheObservationItCameFrom(t *testing.T) {
	/*
	 * A stale record is a remembered reading, not a fresh assertion. Its
	 * workspace must be the one resolved when it was observed — re-resolving on
	 * the stale path would attach today's branch to yesterday's data.
	 */
	u := newUpstream(t)
	h, r := serveOnce(t, u, listBody(oneService, nowISO(), ""))
	calls := stubWorkspaces(t, h, map[string]*identity.Workspace{
		"/gh/Agent-Dashboard": gitWorkspace("/gh/Agent-Dashboard", "/gh/Agent-Dashboard/.git", "main", identity.KindGitMain),
	})

	fresh := getServices(t, r).Items[0]
	require.NotNil(t, fresh.Workspace)
	before := calls.Load()

	// The collector goes away; the retained reading is served stale.
	u.srv.Close()
	stale := getServices(t, r)
	require.Equal(t, SourceStale, stale.Source)
	require.Len(t, stale.Items, 1)
	require.NotNil(t, stale.Items[0].Workspace, "a stale record keeps the workspace it was observed with")
	require.Equal(t, fresh.Workspace.ID, stale.Items[0].Workspace.ID)
	require.Equal(t, fresh.Workspace.Branch, stale.Items[0].Workspace.Branch)
	require.Equal(t, before, calls.Load(), "the stale path must not re-resolve identity")
}

func TestWorkspace_StaleProcessesRetainIdentityToo(t *testing.T) {
	u := newUpstream(t)
	h, r := serveOnce(t, u, listBody(oneProcess, nowISO(), ""))
	stubWorkspaces(t, h, map[string]*identity.Workspace{
		"/gh/Agent-Dashboard": gitWorkspace("/gh/Agent-Dashboard", "/gh/Agent-Dashboard/.git", "main", identity.KindGitMain),
	})

	fresh := getProcesses(t, r).Items[0]
	require.NotNil(t, fresh.Workspace)

	u.srv.Close()
	stale := getProcesses(t, r)
	require.Equal(t, SourceStale, stale.Source)
	require.Equal(t, fresh.Workspace.ID, stale.Items[0].Workspace.ID)
}

func TestWorkspace_CarriesNoPathOrGitInternals(t *testing.T) {
	u := newUpstream(t)
	h, r := serveOnce(t, u, listBody(oneService, nowISO(), ""))
	stubWorkspaces(t, h, map[string]*identity.Workspace{
		"/gh/Agent-Dashboard": gitWorkspace("/gh/Agent-Dashboard", "/gh/Agent-Dashboard/.git", "main", identity.KindGitMain),
	})

	ws := getServices(t, r).Items[0].Workspace
	require.NotNil(t, ws)
	for _, field := range []string{ws.ID, ws.Name, ws.Branch, ws.Repository.ID, ws.Repository.Name} {
		require.NotContains(t, field, "/", "no field may carry a path: %q", field)
		require.NotContains(t, field, ".git", "no field may name git internals: %q", field)
	}
}

// --- fixtures -------------------------------------------------------------

// Two services in the same repository but different checkouts.
const twoServicesDifferentCwd = `[
{"id":"1:5173","port":5173,"address":"127.0.0.1","bindScope":"loopback","protocol":"tcp","ipVersion":"ipv4",
 "pid":1,"processName":"node","command":"vite","cwd":"/gh/Agent-Dashboard","runtime":"node",
 "kind":"vite","label":"Vite Development Server","url":null,"project":null,"confidence":"high","startedAt":null},
{"id":"2:5174","port":5174,"address":"127.0.0.1","bindScope":"loopback","protocol":"tcp","ipVersion":"ipv4",
 "pid":2,"processName":"node","command":"vite","cwd":"/gh/wt","runtime":"node",
 "kind":"vite","label":"Vite Development Server","url":null,"project":null,"confidence":"high","startedAt":null}
]`

// A service with NO cwd but a fully populated discoveredProject.
const serviceNoCwdWithProject = `[{
 "id":"9:9999","port":9999,"address":"127.0.0.1","bindScope":"loopback","protocol":"tcp","ipVersion":"ipv4",
 "pid":9,"processName":"node","command":"node server.js","cwd":null,"runtime":"node",
 "kind":"node","label":"Node Server","url":null,
 "project":{"id":"p1","name":"Agent-Dashboard","rootPath":"/gh/Agent-Dashboard","manifest":"package.json"},
 "confidence":"high","startedAt":null
}]`

// Three processes sharing one cwd — the repetition the cache exists for.
const threeProcessesSameCwd = `{"processes":[
{"id":"1","pid":1,"ppid":0,"name":"node","command":"a","cwd":"/gh/Agent-Dashboard","runtime":"node",
 "cpuPercent":null,"memoryBytes":null,"elapsedSeconds":null,"startedAt":null,
 "project":null,"ports":[],"relevant":true,"relevanceReasons":[]},
{"id":"2","pid":2,"ppid":1,"name":"node","command":"b","cwd":"/gh/Agent-Dashboard","runtime":"node",
 "cpuPercent":null,"memoryBytes":null,"elapsedSeconds":null,"startedAt":null,
 "project":null,"ports":[],"relevant":true,"relevanceReasons":[]},
{"id":"3","pid":3,"ppid":1,"name":"node","command":"c","cwd":"/gh/Agent-Dashboard","runtime":"node",
 "cpuPercent":null,"memoryBytes":null,"elapsedSeconds":null,"startedAt":null,
 "project":null,"ports":[],"relevant":true,"relevanceReasons":[]}
],"total":818}`
