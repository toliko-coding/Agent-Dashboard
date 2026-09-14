// Package agentprofile holds the presentation metadata a user gives an agent
// when starting it from the dashboard: an optional display name and an
// optional icon category.
//
// A profile is keyed by the Claude session id the dashboard pinned (--session-id)
// or resumed (--resume) for that agent — the identity the agent stream already
// carries — and persisted in the agent_profile table, so it survives browser
// reloads, dashboard restarts and session rescans. It is loaded once at
// startup and cached; every scan tick only reads the cache.
//
// Presentation only. A profile never grants, scopes or authorizes anything,
// and it is not a Project, Repository, Workspace or folder name.
package agentprofile

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"unicode"

	"github.com/lx-wnk/agent-dashboard/sdk"
	"github.com/lx-wnk/agent-dashboard/server/internal/db/repo"
)

// MaxNameRunes bounds a display name. It is a short label, not a description.
const MaxNameRunes = 60

// Profile is one agent's presentation metadata. Empty fields mean "not given".
type Profile struct {
	DisplayName string
	Category    string
}

// Empty reports whether nothing was given.
func (p Profile) Empty() bool { return p.DisplayName == "" && p.Category == "" }

// Normalize cleans a user-given name and checks a category. Whitespace is
// collapsed and control characters dropped; an over-long name or an unknown
// category is an error rather than silently cut or replaced.
func Normalize(name, category string) (Profile, error) {
	fields := strings.FieldsFunc(name, func(r rune) bool { return unicode.IsSpace(r) || unicode.IsControl(r) })
	clean := strings.Join(fields, " ")
	if n := len([]rune(clean)); n > MaxNameRunes {
		return Profile{}, fmt.Errorf("agent name is %d characters; at most %d are allowed", n, MaxNameRunes)
	}
	category = strings.TrimSpace(category)
	if category != "" && !sdk.IsAgentCategory(category) {
		return Profile{}, fmt.Errorf("unknown agent category %q", category)
	}
	return Profile{DisplayName: clean, Category: category}, nil
}

// Store caches profiles by session id over an AgentProfileRepo.
type Store struct {
	repo repo.AgentProfileRepo

	mu   sync.RWMutex
	byID map[string]Profile
}

// New creates a Store. Call Load before serving.
func New(r repo.AgentProfileRepo) *Store {
	return &Store{repo: r, byID: make(map[string]Profile)}
}

// Load reads every stored profile into the cache.
func (s *Store) Load(ctx context.Context) error {
	rows, err := s.repo.List(ctx)
	if err != nil {
		return err
	}
	next := make(map[string]Profile, len(rows))
	for _, row := range rows {
		next[row.SessionID] = Profile{DisplayName: row.DisplayName, Category: row.Category}
	}
	s.mu.Lock()
	s.byID = next
	s.mu.Unlock()
	return nil
}

// Lookup returns the profile for a session, when one was saved.
func (s *Store) Lookup(sessionID string) (Profile, bool) {
	if sessionID == "" {
		return Profile{}, false
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	p, ok := s.byID[sessionID]
	return p, ok
}

// ErrNoSession is returned when a profile has no session id to belong to.
var ErrNoSession = errors.New("agent profile needs a session id")

// Save persists and caches a profile for a session. The profile must already be
// normalized. An empty profile is a no-op: it never erases a saved one.
func (s *Store) Save(ctx context.Context, sessionID string, p Profile) error {
	if p.Empty() {
		return nil
	}
	if sessionID == "" {
		return ErrNoSession
	}
	if err := s.repo.Upsert(ctx, repo.AgentProfileRow{SessionID: sessionID, DisplayName: p.DisplayName, Category: p.Category}); err != nil {
		return err
	}
	s.mu.Lock()
	s.byID[sessionID] = p
	s.mu.Unlock()
	return nil
}
