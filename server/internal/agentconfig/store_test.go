package agentconfig

import (
	"context"
	"strings"
	"testing"

	"github.com/lx-wnk/agent-dashboard/server/internal/db/repo"
)

// fakeRepo is the dashboard_agent table, in memory.
type fakeRepo struct {
	rows map[string]repo.DashboardAgentRow
	// writes counts Upsert calls, so a test can tell "saved" from "unchanged".
	writes int
}

func newFakeRepo() *fakeRepo { return &fakeRepo{rows: map[string]repo.DashboardAgentRow{}} }

func (f *fakeRepo) Upsert(_ context.Context, row repo.DashboardAgentRow) error {
	f.rows[row.ID] = row
	f.writes++
	return nil
}

func (f *fakeRepo) List(_ context.Context) ([]repo.DashboardAgentRow, error) {
	out := make([]repo.DashboardAgentRow, 0, len(f.rows))
	for _, r := range f.rows {
		out = append(out, r)
	}
	return out, nil
}

func (f *fakeRepo) Delete(_ context.Context, id string) error {
	delete(f.rows, id)
	return nil
}

func newStore(t *testing.T) (*Store, *fakeRepo) {
	t.Helper()
	r := newFakeRepo()
	s := New(r)
	if err := s.Load(context.Background()); err != nil {
		t.Fatalf("Load: %v", err)
	}
	return s, r
}

func str(s string) *string { return &s }

// Configuration belongs to the agent, not to the process running it: saving it
// through a session must produce a row with an identity of its own.
func TestSaveForSessionCreatesADurableAgent(t *testing.T) {
	s, r := newStore(t)
	ctx := context.Background()

	cfg, err := s.SaveForSession(ctx, "sess-1", Patch{
		DisplayName:    str("Portfolio Developer"),
		Instructions:   str("Work only in the portfolio repository."),
		PermissionMode: str("acceptEdits"),
	})
	if err != nil {
		t.Fatalf("SaveForSession: %v", err)
	}
	if cfg.AgentID == "" || cfg.AgentID == "sess-1" {
		t.Errorf("AgentID = %q, want an id of the agent's own", cfg.AgentID)
	}
	got, ok := s.Lookup("sess-1")
	if !ok {
		t.Fatal("the saved agent is not found by its session")
	}
	if got.DisplayName != "Portfolio Developer" || got.Instructions != "Work only in the portfolio repository." || got.PermissionMode != "acceptEdits" {
		t.Errorf("stored config = %+v", got)
	}
	if _, ok := r.rows[cfg.AgentID]; !ok {
		t.Error("nothing reached the repo")
	}
}

// A second save must not create a second agent for the same session, and must
// not clear the fields it does not mention.
func TestSaveForSessionUpdatesInPlaceAndLeavesUnmentionedFields(t *testing.T) {
	s, _ := newStore(t)
	ctx := context.Background()
	first, err := s.SaveForSession(ctx, "sess-1", Patch{DisplayName: str("Dev"), Instructions: str("keep me"), PermissionMode: str("plan")})
	if err != nil {
		t.Fatalf("first save: %v", err)
	}

	second, err := s.SaveForSession(ctx, "sess-1", Patch{DisplayName: str("Renamed")})
	if err != nil {
		t.Fatalf("second save: %v", err)
	}
	if second.AgentID != first.AgentID {
		t.Errorf("AgentID changed on update: %q -> %q", first.AgentID, second.AgentID)
	}
	if second.Instructions != "keep me" || second.PermissionMode != "plan" {
		t.Errorf("a rename cleared other configuration: %+v", second)
	}
	if len(s.List()) != 1 {
		t.Errorf("agents = %d, want 1", len(s.List()))
	}
}

// The point of the durable row: a session ending changes nothing about it. The
// store has no notion of liveness, which is what makes a finished agent still
// answer with its name, instructions and saved mode.
func TestConfigurationOutlivesItsSession(t *testing.T) {
	s, _ := newStore(t)
	ctx := context.Background()
	saved, err := s.SaveForSession(ctx, "sess-finished", Patch{DisplayName: str("Portfolio Developer"), Instructions: str("standing orders"), PermissionMode: str("default")})
	if err != nil {
		t.Fatalf("save: %v", err)
	}

	// Reload from storage, as a restart would.
	reloaded := New(&fakeRepo{rows: map[string]repo.DashboardAgentRow{saved.AgentID: toRow(saved)}})
	if err := reloaded.Load(ctx); err != nil {
		t.Fatalf("Load: %v", err)
	}
	got, ok := reloaded.ByID(saved.AgentID)
	if !ok {
		t.Fatal("the agent did not survive a reload")
	}
	if got.Instructions != "standing orders" || got.PermissionMode != "default" {
		t.Errorf("configuration after reload = %+v", got)
	}
}

func TestPermissionModeIsValidated(t *testing.T) {
	s, _ := newStore(t)
	ctx := context.Background()

	for _, mode := range []string{"default", "plan", "acceptEdits", "auto", "bypassPermissions", "dontAsk", ""} {
		if _, err := s.SaveForSession(ctx, "sess-modes", Patch{PermissionMode: str(mode)}); err != nil {
			t.Errorf("SaveForSession(%q) = %v, want accepted", mode, err)
		}
	}
	if _, err := s.SaveForSession(ctx, "sess-modes", Patch{PermissionMode: str("yolo")}); err == nil {
		t.Error("an unknown permission mode was accepted")
	}
	// The refusal must not have written anything.
	if got, _ := s.Lookup("sess-modes"); got.PermissionMode != "" {
		t.Errorf("PermissionMode = %q, want the last valid value", got.PermissionMode)
	}
}

func TestInstructionsAreBoundedAndTrimmed(t *testing.T) {
	s, _ := newStore(t)
	ctx := context.Background()

	cfg, err := s.SaveForSession(ctx, "sess-i", Patch{Instructions: str("  do the thing  ")})
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	if cfg.Instructions != "do the thing" {
		t.Errorf("Instructions = %q, want trimmed", cfg.Instructions)
	}
	if _, err := s.SaveForSession(ctx, "sess-i", Patch{Instructions: str(strings.Repeat("x", MaxInstructionRunes+1))}); err == nil {
		t.Error("over-long instructions were accepted")
	}
}

// Exactly one main agent, and it is seeded rather than designated.
func TestEnsureMainIsIdempotentAndUnique(t *testing.T) {
	s, _ := newStore(t)
	ctx := context.Background()

	first, err := s.EnsureMain(ctx, "/repo/agent-dashboard")
	if err != nil {
		t.Fatalf("EnsureMain: %v", err)
	}
	second, err := s.EnsureMain(ctx, "/somewhere/else")
	if err != nil {
		t.Fatalf("EnsureMain again: %v", err)
	}
	if first.AgentID != MainAgentID || second.AgentID != MainAgentID {
		t.Errorf("main agent ids = %q, %q, want the fixed %q", first.AgentID, second.AgentID, MainAgentID)
	}
	if second.Cwd != "/repo/agent-dashboard" {
		t.Errorf("Cwd = %q; re-seeding must not move the main agent", second.Cwd)
	}
	mains := 0
	for _, cfg := range s.List() {
		if cfg.IsMain() {
			mains++
		}
	}
	if mains != 1 {
		t.Errorf("main agents = %d, want exactly 1", mains)
	}
}

/*
 * An ordinary agent cannot become main.
 *
 * This is structural rather than a check: Patch carries no role, so no write
 * path — not the API, not a future caller — can promote an agent by passing a
 * field. The test pins that the door stays shut.
 */
func TestAnOrdinaryAgentCannotBecomeMain(t *testing.T) {
	s, _ := newStore(t)
	ctx := context.Background()
	if _, err := s.EnsureMain(ctx, "/repo/agent-dashboard"); err != nil {
		t.Fatalf("EnsureMain: %v", err)
	}
	ordinary, err := s.SaveForSession(ctx, "sess-pi", Patch{DisplayName: str("Project Intelligence")})
	if err != nil {
		t.Fatalf("save: %v", err)
	}

	updated, err := s.SaveByID(ctx, ordinary.AgentID, Patch{DisplayName: str("Project Intelligence"), Instructions: str("analyse only")})
	if err != nil {
		t.Fatalf("SaveByID: %v", err)
	}
	if updated.Role != "" || updated.IsMain() {
		t.Errorf("an ordinary agent gained role %q", updated.Role)
	}
	if main, _ := s.Main(); main.AgentID != MainAgentID {
		t.Error("the main agent moved")
	}
}

// The main agent's identity is the row, not the session: rebinding follows the
// process without changing who the agent is, and drops the stale pointer.
func TestBindMainSessionRepointsWithoutChangingIdentity(t *testing.T) {
	s, _ := newStore(t)
	ctx := context.Background()
	if _, err := s.EnsureMain(ctx, "/repo/agent-dashboard"); err != nil {
		t.Fatalf("EnsureMain: %v", err)
	}

	if _, err := s.BindMainSession(ctx, "session-one"); err != nil {
		t.Fatalf("BindMainSession: %v", err)
	}
	if cfg, ok := s.Lookup("session-one"); !ok || !cfg.IsMain() {
		t.Fatal("the main agent is not found by its bound session")
	}

	if _, err := s.BindMainSession(ctx, "session-two"); err != nil {
		t.Fatalf("rebind: %v", err)
	}
	if _, ok := s.Lookup("session-one"); ok {
		t.Error("the old session still resolves to the main agent")
	}
	cfg, ok := s.Lookup("session-two")
	if !ok || cfg.AgentID != MainAgentID {
		t.Error("the new session does not resolve to the main agent")
	}
	if len(s.List()) != 1 {
		t.Errorf("agents = %d, want 1: rebinding must not create another", len(s.List()))
	}
}

func TestSaveForSessionRequiresASession(t *testing.T) {
	s, _ := newStore(t)
	if _, err := s.SaveForSession(context.Background(), "  ", Patch{DisplayName: str("x")}); err == nil {
		t.Error("a configuration was saved with no session to key it by")
	}
}
