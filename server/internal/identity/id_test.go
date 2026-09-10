package identity

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// fixedNow keeps cache-expiry arithmetic explicit rather than wall-clock bound.
var fixedNow = time.Date(2026, 9, 10, 12, 0, 0, 0, time.UTC)

func TestIDs_AreStableAndDistinctByKind(t *testing.T) {
	a := WorkspaceID("/x/repo")
	if a != WorkspaceID("/x/repo") {
		t.Error("the same canonical key must always give the same id")
	}
	if a == WorkspaceID("/x/other") {
		t.Error("different keys must give different ids")
	}
	// A workspace id and a repository id are the same shape; without the tag a
	// mixed-up pair is indistinguishable in a payload or a test failure.
	if strings.TrimPrefix(a, "ws_") == strings.TrimPrefix(RepositoryID("/x/repo"), "repo_") {
		t.Error("the type tag must be the only thing making these comparable")
	}
	if !strings.HasPrefix(a, "ws_") || !strings.HasPrefix(RepositoryID("/x/.git"), "repo_") {
		t.Error("ids must carry their type tag")
	}
}

func TestIDs_EmptyKeyYieldsEmptyID(t *testing.T) {
	// An id built from nothing would be a real-looking hash of the empty string,
	// and every unresolved thing would then share it.
	if WorkspaceID("") != "" || RepositoryID("") != "" {
		t.Error("an empty key must not produce an id")
	}
}

func TestIDs_DoNotLeakThePath(t *testing.T) {
	secretish := "/Users/someone/Documents/GitHub/Private-Thing"
	id := WorkspaceID(secretish)
	for _, fragment := range []string{"Users", "someone", "Private-Thing", "Documents"} {
		if strings.Contains(id, fragment) {
			t.Errorf("id %q contains path fragment %q", id, fragment)
		}
	}
	// Not base64/hex of the path either: a fixed-width digest cannot be one.
	if len(id) != len("ws_")+idLen {
		t.Errorf("id length %d is not the fixed digest width", len(id))
	}
}

// --- Resolver -------------------------------------------------------------

func TestResolver_CachesSoAScanDoesNotShellOutPerTick(t *testing.T) {
	calls := 0
	r := &Resolver{
		cache: map[string]cacheEntry{},
		ttl:   resolveTTL,
		now:   func() time.Time { return fixedNow },
		resolve: func(_ context.Context, dir string) (*Workspace, error) {
			calls++
			return &Workspace{Key: dir, Kind: KindPlain}, nil
		},
	}
	for range 10 {
		if ws := r.Get(context.Background(), "/x"); ws == nil {
			t.Fatal("expected a workspace")
		}
	}
	if calls != 1 {
		t.Fatalf("resolved %d times; the merger rebuilds every agent every tick, so this must be 1", calls)
	}
}

func TestResolver_ReResolvesAfterTTL(t *testing.T) {
	calls := 0
	now := fixedNow
	r := &Resolver{
		cache: map[string]cacheEntry{},
		ttl:   resolveTTL,
		now:   func() time.Time { return now },
		resolve: func(_ context.Context, dir string) (*Workspace, error) {
			calls++
			return &Workspace{Key: dir, Kind: KindGitMain, Branch: "b"}, nil
		},
	}
	r.Get(context.Background(), "/x")
	now = now.Add(resolveTTL + time.Second)
	r.Get(context.Background(), "/x")
	if calls != 2 {
		t.Fatalf("calls = %d, want 2 — a branch switch must become visible", calls)
	}
}

func TestResolver_CachesFailuresToo(t *testing.T) {
	// A cwd that is not a repository costs a failed git call to discover and is
	// not going to become one between ticks. Without this, the non-git case is
	// the most expensive one.
	calls := 0
	r := &Resolver{
		cache: map[string]cacheEntry{},
		ttl:   resolveTTL,
		now:   func() time.Time { return fixedNow },
		resolve: func(_ context.Context, _ string) (*Workspace, error) {
			calls++
			return nil, os.ErrNotExist
		},
	}
	for range 5 {
		if ws := r.Get(context.Background(), "/nope"); ws != nil {
			t.Fatal("a failed resolution must yield nil, never a guess")
		}
	}
	if calls != 1 {
		t.Fatalf("failures resolved %d times, want 1", calls)
	}
}

func TestResolver_SeparateDirectoriesDoNotShareAnEntry(t *testing.T) {
	r := &Resolver{
		cache: map[string]cacheEntry{},
		ttl:   resolveTTL,
		now:   func() time.Time { return fixedNow },
		resolve: func(_ context.Context, dir string) (*Workspace, error) {
			return &Workspace{Key: dir, Kind: KindGitMain}, nil
		},
	}
	if r.Get(context.Background(), "/a").Key == r.Get(context.Background(), "/b").Key {
		t.Fatal("the cache must be keyed per directory")
	}
}

func TestResolver_NilAndEmptyAreSafe(t *testing.T) {
	var nilResolver *Resolver
	if nilResolver.Get(context.Background(), "/x") != nil {
		t.Error("a nil resolver must yield nil, not panic")
	}
	if NewResolver().Get(context.Background(), "") != nil {
		t.Error("an empty cwd must yield nil")
	}
}

func TestResolver_RealRepositoryEndToEnd(t *testing.T) {
	base := t.TempDir()
	root := newRepo(t, filepath.Join(base, "repo"))
	r := NewResolver()

	ws := r.Get(context.Background(), root)
	if ws == nil {
		t.Fatal("a real repository must resolve through the resolver")
	}
	if ws.Key != root || ws.Kind != KindGitMain {
		t.Fatalf("got Key=%q Kind=%q", ws.Key, ws.Kind)
	}
	// Same answer from cache.
	if again := r.Get(context.Background(), root); again.Key != ws.Key {
		t.Error("cached answer disagrees with the first")
	}
}
