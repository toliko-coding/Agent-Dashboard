package agentconfig

import (
	"context"
	"errors"
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

/*
 * Deleting an agent, and the one agent that cannot be deleted.
 *
 * Delete removes what the dashboard remembers about an agent. Nothing it names
 * is touched: the folder, the repository and the session transcript are the
 * user's, and an agent record is only a record.
 */
func TestDeleteForSessionRemovesTheAgentAndSaysWhenThereWasNone(t *testing.T) {
	s, r := newStore(t)
	ctx := context.Background()

	cfg, err := s.SaveForSession(ctx, "sess-1", Patch{DisplayName: str("Resume Editor")})
	if err != nil {
		t.Fatalf("SaveForSession: %v", err)
	}

	removed, err := s.DeleteForSession(ctx, "sess-1")
	if err != nil || !removed {
		t.Fatalf("DeleteForSession: removed=%v err=%v", removed, err)
	}
	if _, ok := s.Lookup("sess-1"); ok {
		t.Fatal("the session still resolves to an agent")
	}
	if _, ok := s.ByID(cfg.AgentID); ok {
		t.Fatal("the agent is still addressable by id")
	}
	if _, ok := r.rows[cfg.AgentID]; ok {
		t.Fatal("the row was not deleted from storage")
	}

	// Deleting what is already gone is not an error: the end state is the same.
	removed, err = s.DeleteForSession(ctx, "sess-1")
	if err != nil {
		t.Fatalf("second DeleteForSession: %v", err)
	}
	if removed {
		t.Fatal("reported removing an agent that no longer existed")
	}
}

func TestDeleteByIDRemovesTheAgent(t *testing.T) {
	s, _ := newStore(t)
	ctx := context.Background()

	cfg, err := s.SaveForSession(ctx, "sess-2", Patch{DisplayName: str("Portfolio Developer")})
	if err != nil {
		t.Fatalf("SaveForSession: %v", err)
	}
	removed, err := s.DeleteByID(ctx, cfg.AgentID)
	if err != nil || !removed {
		t.Fatalf("DeleteByID: removed=%v err=%v", removed, err)
	}
	if _, ok := s.Lookup("sess-2"); ok {
		t.Fatal("the session still resolves to an agent")
	}

	if removed, err := s.DeleteByID(ctx, "no-such-agent"); removed || err != nil {
		t.Fatalf("unknown id: removed=%v err=%v", removed, err)
	}
}

// The main agent is seeded and permanent. Neither route to deletion may take it.
func TestTheMainAgentCannotBeDeleted(t *testing.T) {
	s, _ := newStore(t)
	ctx := context.Background()

	main, err := s.EnsureMain(ctx, "/repo/agent-dashboard")
	if err != nil {
		t.Fatalf("EnsureMain: %v", err)
	}
	if _, err := s.BindMainSession(ctx, "sess-main"); err != nil {
		t.Fatalf("BindMainSession: %v", err)
	}

	if _, err := s.DeleteByID(ctx, main.AgentID); !errors.Is(err, ErrMainAgentPermanent) {
		t.Fatalf("DeleteByID by id: want ErrMainAgentPermanent, got %v", err)
	}
	if _, err := s.DeleteForSession(ctx, "sess-main"); !errors.Is(err, ErrMainAgentPermanent) {
		t.Fatalf("DeleteForSession by session: want ErrMainAgentPermanent, got %v", err)
	}
	if _, ok := s.Main(); !ok {
		t.Fatal("the main agent is gone after two refused deletions")
	}
}

/*
 * Recovery: agents that were only ever remembered in memory.
 *
 * Finished agents lived in the merger's in-process registry, so a server
 * restart took them off the Agents page although nothing had been deleted.
 * Recovery gives such a session a durable record from what is already on disk -
 * its ownership row and its profile - and nothing else. No instructions and no
 * permission mode are invented: an agent that saved none starts on Claude's
 * default, which is the honest answer rather than a guessed one.
 */
func TestRecoverRestoresUnrecordedAgentsAndInventsNothing(t *testing.T) {
	s, _ := newStore(t)
	ctx := context.Background()

	restored, err := s.Recover(ctx, []Recoverable{
		{SessionID: "sess-resume", DisplayName: "Resume Editor", Category: "document", Cwd: "/work/Resume-Editor"},
		{SessionID: "", DisplayName: "No session", Cwd: "/work/x"},
		{SessionID: "sess-nameless", DisplayName: "", Cwd: "/work/y"},
		{SessionID: "sess-nowhere", DisplayName: "Homeless", Cwd: ""},
	})
	if err != nil {
		t.Fatalf("Recover: %v", err)
	}
	if len(restored) != 1 {
		t.Fatalf("restored %d agents, want only the complete one: %+v", len(restored), restored)
	}

	cfg, ok := s.Lookup("sess-resume")
	if !ok {
		t.Fatal("the recovered session resolves to no agent")
	}
	if cfg.AgentID == "" || cfg.AgentID == "sess-resume" {
		t.Fatalf("a recovered agent needs an identity of its own, got %q", cfg.AgentID)
	}
	if cfg.DisplayName != "Resume Editor" || cfg.Category != "document" || cfg.Cwd != "/work/Resume-Editor" {
		t.Fatalf("recovered the wrong agent: %+v", cfg)
	}
	if cfg.Instructions != "" || cfg.PermissionMode != "" {
		t.Fatalf("recovery invented configuration: %+v", cfg)
	}
	if cfg.Role != "" {
		t.Fatalf("recovery granted a role: %+v", cfg)
	}
}

// Recovery runs at every startup, so running it again must change nothing -
// neither a second record for the same session nor a new id for the same agent.
func TestRecoverIsIdempotent(t *testing.T) {
	s, r := newStore(t)
	ctx := context.Background()
	candidates := []Recoverable{{SessionID: "sess-portfolio", DisplayName: "Portfolio Developer", Category: "web", Cwd: "/work/portfolio"}}

	if _, err := s.Recover(ctx, candidates); err != nil {
		t.Fatalf("first Recover: %v", err)
	}
	first, _ := s.Lookup("sess-portfolio")
	rowsAfterFirst := len(r.rows)

	restored, err := s.Recover(ctx, candidates)
	if err != nil {
		t.Fatalf("second Recover: %v", err)
	}
	if len(restored) != 0 {
		t.Fatalf("recovered an agent that already had a record: %+v", restored)
	}
	if len(r.rows) != rowsAfterFirst {
		t.Fatalf("rows changed on a second recovery: %d then %d", rowsAfterFirst, len(r.rows))
	}
	again, _ := s.Lookup("sess-portfolio")
	if again.AgentID != first.AgentID {
		t.Fatalf("the agent changed identity: %q then %q", first.AgentID, again.AgentID)
	}
}

// An agent the user has configured is never overwritten by a recovery pass.
func TestRecoverLeavesAConfiguredAgentAlone(t *testing.T) {
	s, _ := newStore(t)
	ctx := context.Background()

	if _, err := s.SaveForSession(ctx, "sess-kept", Patch{
		DisplayName:    str("Resume Editor"),
		Instructions:   str("Only touch the tailored folder."),
		PermissionMode: str("acceptEdits"),
	}); err != nil {
		t.Fatalf("SaveForSession: %v", err)
	}

	if _, err := s.Recover(ctx, []Recoverable{
		{SessionID: "sess-kept", DisplayName: "Something Else", Category: "web", Cwd: "/elsewhere"},
	}); err != nil {
		t.Fatalf("Recover: %v", err)
	}

	cfg, _ := s.Lookup("sess-kept")
	if cfg.DisplayName != "Resume Editor" || cfg.Instructions == "" || cfg.PermissionMode != "acceptEdits" {
		t.Fatalf("recovery overwrote a configured agent: %+v", cfg)
	}
}

/*
 * Starting a session for an agent that already exists keeps that agent.
 *
 * A recovered agent has a record and no process. Starting one gives it a brand
 * new Claude session id, and keying the save on that id would create a second
 * agent with the same name and folder - two rows for one agent, which is the
 * duplication the durable record exists to prevent.
 */
func TestBindSessionKeepsTheSameAgent(t *testing.T) {
	s, r := newStore(t)
	ctx := context.Background()

	first, err := s.SaveForSession(ctx, "sess-old", Patch{DisplayName: str("Portfolio Developer"), Instructions: str("Keep to the portfolio repository.")})
	if err != nil {
		t.Fatalf("SaveForSession: %v", err)
	}
	rowsBefore := len(r.rows)

	bound, err := s.BindSession(ctx, first.AgentID, "sess-new")
	if err != nil {
		t.Fatalf("BindSession: %v", err)
	}
	if bound.AgentID != first.AgentID {
		t.Fatalf("the agent changed identity: %q then %q", first.AgentID, bound.AgentID)
	}
	if len(r.rows) != rowsBefore {
		t.Fatalf("a second row appeared: %d then %d", rowsBefore, len(r.rows))
	}
	if bound.Instructions != "Keep to the portfolio repository." {
		t.Fatalf("binding a session lost the agent's configuration: %+v", bound)
	}

	// The new session resolves to it, and the old pointer is gone.
	got, ok := s.Lookup("sess-new")
	if !ok || got.AgentID != first.AgentID {
		t.Fatalf("the new session does not resolve to the agent: %+v ok=%v", got, ok)
	}
	if _, stale := s.Lookup("sess-old"); stale {
		t.Fatal("the old session still resolves to this agent")
	}
}

func TestBindSessionRefusesAnUnknownAgent(t *testing.T) {
	s, _ := newStore(t)
	if _, err := s.BindSession(context.Background(), "no-such-agent", "sess-new"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
}
