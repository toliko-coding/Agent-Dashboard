package identity

import (
	"context"
	"sync"
	"time"
)

/*
A caching front door for Resolve.

Resolve shells out to git up to four times. The agent merger rebuilds every
agent on every SSE tick — 3000ms by default (settings key sse.intervalMs) — so
calling it directly would spawn a dozen git processes per agent per tick, for an
answer that changes when someone switches branch and never otherwise.

The cache is keyed on the directory as given. Several agents running in the same
checkout, and the same agent across ticks, therefore share one resolution.

Failures are cached too, and deliberately. A cwd that is not a repository costs
a failed git call to discover, and it is not going to become one between ticks;
without negative caching, the non-git case would be the *most* expensive one.
*/

// resolveTTL bounds how stale a cached answer may be.
//
// The keys in a Workspace are immutable for the life of a path; only Branch and
// Detached move, and only when a person switches branch. Fifteen seconds keeps
// that visible within a few ticks while removing roughly four fifths of the git
// invocations at the default interval.
const resolveTTL = 15 * time.Second

// resolveBudget caps one whole resolution, across every git call it makes.
//
// gitTimeout bounds a single invocation; four of them in series could otherwise
// out-live several scan ticks and hold the merger open. On expiry the caller
// gets no workspace, which is the same answer as any other failure — never a
// guess.
const resolveBudget = 2 * time.Second

// Resolver caches workspace resolution. The zero value is not usable; call
// NewResolver.
type Resolver struct {
	mu    sync.Mutex
	cache map[string]cacheEntry
	ttl   time.Duration
	now   func() time.Time
	// resolve is the underlying lookup, swappable so tests can count calls and
	// avoid touching a real filesystem.
	resolve func(context.Context, string) (*Workspace, error)
}

type cacheEntry struct {
	ws *Workspace
	at time.Time
}

// NewResolver returns a Resolver backed by the real git-based Resolve.
func NewResolver() *Resolver {
	return &Resolver{
		cache:   map[string]cacheEntry{},
		ttl:     resolveTTL,
		now:     time.Now,
		resolve: Resolve,
	}
}

// NewResolverForTest returns a Resolver backed by fn instead of git.
//
// Exported so packages that consume identity — the agent merger above all — can
// assert their MAPPING without a real repository on disk, and without their
// test suite depending on git's behaviour, which this package's own tests
// already cover against real repositories.
func NewResolverForTest(fn func(context.Context, string) (*Workspace, error)) *Resolver {
	return &Resolver{
		cache:   map[string]cacheEntry{},
		ttl:     resolveTTL,
		now:     time.Now,
		resolve: fn,
	}
}

/*
Get returns the workspace containing dir, or nil.

nil means "not resolved", and every path to it is a real failure: an empty dir,
a resolver error, or the budget expiring. A caller must render nil as unknown
and never substitute a guess — a basename is not an identity, and a workspace
invented from one would silently merge two unrelated checkouts that happen to
share a folder name.
*/
func (r *Resolver) Get(ctx context.Context, dir string) *Workspace {
	if r == nil || dir == "" {
		return nil
	}

	now := r.now()
	r.mu.Lock()
	if e, ok := r.cache[dir]; ok && now.Sub(e.at) < r.ttl {
		r.mu.Unlock()
		return e.ws
	}
	r.mu.Unlock()

	/*
	 * Resolved outside the lock on purpose. Holding it across four git
	 * invocations would serialise every agent in the scan behind the slowest
	 * repository on the machine. The cost is that concurrent callers for a cold
	 * directory may each resolve it once; they then agree, because the answer
	 * is a pure function of the path.
	 */
	ctx, cancel := context.WithTimeout(ctx, resolveBudget)
	defer cancel()

	ws, err := r.resolve(ctx, dir)
	if err != nil {
		ws = nil
	}

	r.mu.Lock()
	r.cache[dir] = cacheEntry{ws: ws, at: r.now()}
	r.mu.Unlock()
	return ws
}
