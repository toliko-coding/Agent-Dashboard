// Package agentconfig holds an agent as a durable dashboard entity: what the
// user called it, how it should work, and what it may do without asking.
//
// The distinction this package exists to keep is between an AGENT and a
// SESSION. A session is one Claude process; it ends, and the machine reuses its
// pid. An agent outlives every session that runs it, which is why a finished
// agent still has a name, still has instructions, and can still be resumed into
// a new session with the configuration its owner saved.
//
// Nothing here changes a running process. Claude reads its permission mode and
// system prompt once, at startup, so a saved configuration describes the NEXT
// session and never the one already running. Code that shows both must say
// which is which.
//
// Role is identity, not authority. The main agent is the one that maintains
// Agent Dashboard itself; no permission, ownership check or control path
// anywhere consults it.
package agentconfig

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/lx-wnk/agent-dashboard/server/internal/agentprofile"
	"github.com/lx-wnk/agent-dashboard/server/internal/db/repo"
	"github.com/lx-wnk/agent-dashboard/server/internal/validation"
)

const (
	// MainAgentID is the fixed id of the one agent that maintains Agent
	// Dashboard. Fixed rather than generated so the main agent is the same row
	// across restarts, reinstalls of the schema, and any session it may run in.
	MainAgentID = "main"
	// RoleMain marks that row. Every other agent's role is "".
	RoleMain = "main"
	// MainAgentDefaultName is used when the row is first seeded.
	MainAgentDefaultName = "Agent Dashboard Manager"
	// MaxInstructionRunes bounds saved instructions. It matches the cap the
	// spawn path applies to a system prompt, because that is where these end up.
	MaxInstructionRunes = 10000
)

// ErrNotFound is returned when no agent matches.
var ErrNotFound = errors.New("no such agent")

// ErrMainAgentPermanent is returned when something tries to delete the agent
// that maintains Agent Dashboard. It is seeded, so it is never removed.
var ErrMainAgentPermanent = errors.New("the main agent is permanent and cannot be deleted")

// Config is one durable agent.
type Config struct {
	AgentID        string
	DisplayName    string
	Category       string
	Instructions   string
	PermissionMode string
	Cwd            string
	ProjectID      string
	Role           string
	// SessionID is the Claude session currently realising this agent, or "".
	// A pointer to a runtime instance, never the agent's identity.
	SessionID string
}

// IsMain reports whether this is the main agent.
func (c Config) IsMain() bool { return c.Role == RoleMain }

// Patch is a partial update. A nil field is "leave as it is", which keeps
// saving a name from silently clearing instructions.
type Patch struct {
	DisplayName    *string
	Category       *string
	Instructions   *string
	PermissionMode *string
	Cwd            *string
	ProjectID      *string
}

// Store caches durable agents over a DashboardAgentRepo.
type Store struct {
	repo repo.DashboardAgentRepo

	mu     sync.RWMutex
	byID   map[string]Config
	bySess map[string]string // session id -> agent id
}

// New creates a Store. Call Load before serving.
func New(r repo.DashboardAgentRepo) *Store {
	return &Store{repo: r, byID: make(map[string]Config), bySess: make(map[string]string)}
}

// Load reads every stored agent into the cache.
func (s *Store) Load(ctx context.Context) error {
	rows, err := s.repo.List(ctx)
	if err != nil {
		return err
	}
	byID := make(map[string]Config, len(rows))
	bySess := make(map[string]string, len(rows))
	for _, row := range rows {
		cfg := fromRow(row)
		byID[cfg.AgentID] = cfg
		if cfg.SessionID != "" {
			bySess[cfg.SessionID] = cfg.AgentID
		}
	}
	s.mu.Lock()
	s.byID, s.bySess = byID, bySess
	s.mu.Unlock()
	return nil
}

// Lookup returns the agent currently realised by a session, when there is one.
func (s *Store) Lookup(sessionID string) (Config, bool) {
	if sessionID == "" {
		return Config{}, false
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	id, ok := s.bySess[sessionID]
	if !ok {
		return Config{}, false
	}
	cfg, ok := s.byID[id]
	return cfg, ok
}

// ByID returns one agent.
func (s *Store) ByID(agentID string) (Config, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	cfg, ok := s.byID[agentID]
	return cfg, ok
}

// Main returns the main agent, when it has been seeded.
func (s *Store) Main() (Config, bool) { return s.ByID(MainAgentID) }

// List returns every durable agent, for surfaces that show agents which have no
// session running.
func (s *Store) List() []Config {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Config, 0, len(s.byID))
	for _, cfg := range s.byID {
		out = append(out, cfg)
	}
	return out
}

/*
 * EnsureMain seeds the one main agent if it is missing.
 *
 * It is created, not designated: there is no API that promotes an ordinary
 * agent, so "exactly one main agent" holds by construction rather than by a
 * rule someone has to enforce on every write. Seeding never overwrites a name
 * the user has since given it, and only fills cwd when nothing is recorded.
 */
func (s *Store) EnsureMain(ctx context.Context, cwd string) (Config, error) {
	if existing, ok := s.Main(); ok {
		if existing.Cwd != "" || cwd == "" {
			return existing, nil
		}
		existing.Cwd = cwd
		return existing, s.put(ctx, existing)
	}
	cfg := Config{
		AgentID:     MainAgentID,
		DisplayName: MainAgentDefaultName,
		Category:    "development",
		Role:        RoleMain,
		Cwd:         cwd,
		// No permission mode and no instructions are invented for it: an empty
		// saved mode means a session starts the way it always did.
	}
	return cfg, s.put(ctx, cfg)
}

// BindMainSession points the main agent at the session currently running it.
// The agent is the durable thing; this only records which process is realising
// it now, and grants that process nothing.
func (s *Store) BindMainSession(ctx context.Context, sessionID string) (Config, error) {
	cfg, ok := s.Main()
	if !ok {
		return Config{}, ErrNotFound
	}
	cfg.SessionID = strings.TrimSpace(sessionID)
	return cfg, s.put(ctx, cfg)
}

/*
 * SaveForSession writes configuration for the agent a session is running,
 * creating the durable row on first save.
 *
 * Keyed through the session because that is what the caller has in hand (a pid
 * resolves to a session, not to an agent id), but stored against an agent id,
 * so the configuration survives the session ending.
 */
func (s *Store) SaveForSession(ctx context.Context, sessionID string, patch Patch) (Config, error) {
	if strings.TrimSpace(sessionID) == "" {
		return Config{}, errors.New("a session id is required to save an agent's configuration")
	}
	cfg, ok := s.Lookup(sessionID)
	if !ok {
		cfg = Config{AgentID: uuid.NewString(), SessionID: sessionID}
	}
	next, err := apply(cfg, patch)
	if err != nil {
		return Config{}, err
	}
	return next, s.put(ctx, next)
}

/*
 * DeleteForSession removes the durable agent a session belongs to.
 *
 * Called when an agent is deleted: the record is the agent, so leaving it
 * behind would mean a deleted agent still had a name, standing instructions and
 * a saved permission mode waiting for a session id that will never return.
 *
 * The main agent is refused. It is seeded and permanent, so there is no path -
 * here or anywhere - that removes it; deleting the session it happens to be
 * running must not delete the agent that owns this dashboard.
 */
func (s *Store) DeleteForSession(ctx context.Context, sessionID string) (bool, error) {
	cfg, ok := s.Lookup(sessionID)
	if !ok {
		return false, nil
	}
	if cfg.IsMain() {
		return false, ErrMainAgentPermanent
	}
	return true, s.remove(ctx, cfg)
}

// DeleteByID removes one durable agent, for a record whose session is long
// gone. The main agent is refused for the same reason.
func (s *Store) DeleteByID(ctx context.Context, agentID string) (bool, error) {
	cfg, ok := s.ByID(agentID)
	if !ok {
		return false, nil
	}
	if cfg.IsMain() {
		return false, ErrMainAgentPermanent
	}
	return true, s.remove(ctx, cfg)
}

// remove deletes one row and drops both cache entries pointing at it.
func (s *Store) remove(ctx context.Context, cfg Config) error {
	if err := s.repo.Delete(ctx, cfg.AgentID); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.byID, cfg.AgentID)
	for sess, id := range s.bySess {
		if id == cfg.AgentID {
			delete(s.bySess, sess)
		}
	}
	return nil
}

/*
 * Recover rebuilds durable records for agents that predate them.
 *
 * Deliberately narrow, so it can only ever restore an agent that demonstrably
 * existed: this server must still hold the ownership record proving it launched
 * the session, the session must still have a saved name, and its working folder
 * must still be on disk. An agent that was deleted fails the first test - delete
 * forgets the ownership record - so nothing deleted can come back.
 *
 * Nothing is invented. Instructions and permission mode stay empty, because
 * they were never recorded for these agents; the behaviour rules those agents
 * were given live in their workspace, not here.
 *
 * Idempotent: a session that already has a record is skipped, so this runs on
 * every start without creating a second anything.
 */
func (s *Store) Recover(ctx context.Context, candidates []Recoverable) ([]Config, error) {
	var restored []Config
	for _, c := range candidates {
		if c.SessionID == "" || c.DisplayName == "" || c.Cwd == "" {
			continue
		}
		if _, exists := s.Lookup(c.SessionID); exists {
			continue
		}
		cfg := Config{
			AgentID:     uuid.NewString(),
			DisplayName: c.DisplayName,
			Category:    c.Category,
			Cwd:         c.Cwd,
			SessionID:   c.SessionID,
		}
		if err := s.put(ctx, cfg); err != nil {
			return restored, err
		}
		restored = append(restored, cfg)
	}
	return restored, nil
}

// Recoverable is one agent this server can prove it created: its ownership
// record, the name it was given, and the folder it ran in.
type Recoverable struct {
	SessionID   string
	DisplayName string
	Category    string
	Cwd         string
}

// SaveByID writes configuration for an agent that may have no session running.
func (s *Store) SaveByID(ctx context.Context, agentID string, patch Patch) (Config, error) {
	cfg, ok := s.ByID(agentID)
	if !ok {
		return Config{}, ErrNotFound
	}
	next, err := apply(cfg, patch)
	if err != nil {
		return Config{}, err
	}
	return next, s.put(ctx, next)
}

// apply validates a patch onto a config without touching the store.
func apply(cfg Config, patch Patch) (Config, error) {
	if patch.DisplayName != nil || patch.Category != nil {
		name := cfg.DisplayName
		if patch.DisplayName != nil {
			name = *patch.DisplayName
		}
		category := cfg.Category
		if patch.Category != nil {
			category = *patch.Category
		}
		// One validator for a name and an icon, shared with the spawn path.
		profile, err := agentprofile.Normalize(name, category)
		if err != nil {
			return Config{}, err
		}
		cfg.DisplayName, cfg.Category = profile.DisplayName, profile.Category
	}
	if patch.Instructions != nil {
		text := strings.TrimSpace(*patch.Instructions)
		if utf8.RuneCountInString(text) > MaxInstructionRunes {
			return Config{}, fmt.Errorf("instructions are %d characters; at most %d are allowed", utf8.RuneCountInString(text), MaxInstructionRunes)
		}
		cfg.Instructions = text
	}
	if patch.PermissionMode != nil {
		mode := strings.TrimSpace(*patch.PermissionMode)
		// "" is allowed and means "nothing saved": a session then starts the way
		// it would have without a saved configuration at all.
		if mode != "" && !validation.IsPermissionMode(mode) {
			return Config{}, fmt.Errorf("unknown permission mode %q", mode)
		}
		cfg.PermissionMode = mode
	}
	if patch.Cwd != nil {
		cfg.Cwd = *patch.Cwd
	}
	if patch.ProjectID != nil {
		cfg.ProjectID = *patch.ProjectID
	}
	return cfg, nil
}

// put writes one config through the repo and updates the cache.
func (s *Store) put(ctx context.Context, cfg Config) error {
	if err := s.repo.Upsert(ctx, toRow(cfg)); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	// Drop any stale session pointer this agent used to hold.
	for sess, id := range s.bySess {
		if id == cfg.AgentID && sess != cfg.SessionID {
			delete(s.bySess, sess)
		}
	}
	s.byID[cfg.AgentID] = cfg
	if cfg.SessionID != "" {
		s.bySess[cfg.SessionID] = cfg.AgentID
	}
	return nil
}

func fromRow(row repo.DashboardAgentRow) Config {
	return Config{
		AgentID:        row.ID,
		DisplayName:    row.DisplayName,
		Category:       row.Category,
		Instructions:   row.Instructions,
		PermissionMode: row.PermissionMode,
		Cwd:            row.Cwd,
		ProjectID:      row.ProjectID,
		Role:           row.Role,
		SessionID:      row.SessionID,
	}
}

func toRow(cfg Config) repo.DashboardAgentRow {
	return repo.DashboardAgentRow{
		ID:             cfg.AgentID,
		DisplayName:    cfg.DisplayName,
		Category:       cfg.Category,
		Instructions:   cfg.Instructions,
		PermissionMode: cfg.PermissionMode,
		Cwd:            cfg.Cwd,
		ProjectID:      cfg.ProjectID,
		Role:           cfg.Role,
		SessionID:      cfg.SessionID,
	}
}
