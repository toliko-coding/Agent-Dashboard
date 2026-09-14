// Package managedagent is the dashboard's record of the agents it launched
// itself (3N.2.1) — the only basis for lifecycle ownership.
//
// An agent is owned when a record exists for its session id AND the record's
// PID is the agent's PID. Neither alone is enough: a session the dashboard
// started and the user later resumed from a terminal has the same session id
// but a process the dashboard did not launch; a reused PID belongs to a
// different session. Nothing else — being in the scan, being a Claude process,
// sharing a workspace, a provider, a channel or a terminal transport — creates
// ownership.
//
// A record also carries the allowed-folder entry the dashboard added when it
// created a projectless workspace for the agent, so deleting the agent can
// remove exactly that entry when no other owned agent still uses the folder.
package managedagent

import (
	"context"
	"errors"
	"path/filepath"
	"sync"

	"github.com/lx-wnk/agent-dashboard/server/internal/db/repo"
)

// Record is one dashboard-launched agent.
type Record struct {
	SessionID string
	PID       int
	Cwd       string
	// WorkspaceCreated is true when the dashboard created the working folder
	// (New projectless workspace) for this agent.
	WorkspaceCreated bool
	// AllowedFolder is the working-folder entry the dashboard added for that
	// workspace; "" when it added none.
	AllowedFolder string
}

// ErrIncomplete is returned for a record without a session id or PID.
var ErrIncomplete = errors.New("managed agent record needs a session id and a pid")

// Store caches records by session id over a ManagedAgentRepo.
type Store struct {
	repo repo.ManagedAgentRepo

	mu        sync.RWMutex
	bySession map[string]Record
}

// New creates a Store. Call Load before serving.
func New(r repo.ManagedAgentRepo) *Store {
	return &Store{repo: r, bySession: make(map[string]Record)}
}

// Load reads every record into the cache.
func (s *Store) Load(ctx context.Context) error {
	rows, err := s.repo.List(ctx)
	if err != nil {
		return err
	}
	next := make(map[string]Record, len(rows))
	for _, row := range rows {
		next[row.SessionID] = Record{SessionID: row.SessionID, PID: row.PID, Cwd: row.Cwd, WorkspaceCreated: row.WorkspaceCreated, AllowedFolder: row.AllowedFolder}
	}
	s.mu.Lock()
	s.bySession = next
	s.mu.Unlock()
	return nil
}

// Record stores the agent the dashboard just launched. For a session it already
// owned (a resume), the workspace provenance is kept: resuming does not make a
// dashboard-created workspace anyone else's.
func (s *Store) Record(ctx context.Context, rec Record) error {
	if rec.SessionID == "" || rec.PID <= 0 {
		return ErrIncomplete
	}
	if prev, ok := s.Get(rec.SessionID); ok {
		rec.WorkspaceCreated = rec.WorkspaceCreated || prev.WorkspaceCreated
		if rec.AllowedFolder == "" {
			rec.AllowedFolder = prev.AllowedFolder
		}
	}
	if err := s.repo.Upsert(ctx, repo.ManagedAgentRow{SessionID: rec.SessionID, PID: rec.PID, Cwd: rec.Cwd, WorkspaceCreated: rec.WorkspaceCreated, AllowedFolder: rec.AllowedFolder}); err != nil {
		return err
	}
	s.mu.Lock()
	s.bySession[rec.SessionID] = rec
	s.mu.Unlock()
	return nil
}

// Get returns a session's record.
func (s *Store) Get(sessionID string) (Record, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	r, ok := s.bySession[sessionID]
	return r, ok
}

// Owns reports whether the dashboard launched the process pid for sessionID.
func (s *Store) Owns(pid int, sessionID string) bool {
	if pid <= 0 || sessionID == "" {
		return false
	}
	r, ok := s.Get(sessionID)
	return ok && r.PID == pid
}

// Forget removes a session's record.
func (s *Store) Forget(ctx context.Context, sessionID string) error {
	if err := s.repo.Delete(ctx, sessionID); err != nil {
		return err
	}
	s.mu.Lock()
	delete(s.bySession, sessionID)
	s.mu.Unlock()
	return nil
}

// OthersUsing reports whether any record other than exceptSession runs in the
// folder path (compared canonically).
func (s *Store) OthersUsing(path, exceptSession string) bool {
	target := canonical(path)
	s.mu.RLock()
	defer s.mu.RUnlock()
	for id, r := range s.bySession {
		if id == exceptSession {
			continue
		}
		if canonical(r.Cwd) == target || (r.AllowedFolder != "" && canonical(r.AllowedFolder) == target) {
			return true
		}
	}
	return false
}

func canonical(p string) string {
	if p == "" {
		return ""
	}
	abs, err := filepath.Abs(p)
	if err != nil {
		return filepath.Clean(p)
	}
	if real, err := filepath.EvalSymlinks(abs); err == nil {
		return real
	}
	return abs
}
