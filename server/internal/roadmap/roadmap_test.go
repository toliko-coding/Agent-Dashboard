package roadmap_test

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/lx-wnk/agent-dashboard/server/internal/db"
	"github.com/lx-wnk/agent-dashboard/server/internal/db/ent"
	"github.com/lx-wnk/agent-dashboard/server/internal/roadmap"
)

func openDB(t *testing.T) *ent.Client {
	t.Helper()
	bundle, err := db.Open(":memory:")
	require.NoError(t, err)
	t.Cleanup(func() { _ = bundle.Client.Close() })
	return bundle.Client
}

func newProject(t *testing.T, c *ent.Client, name string) string {
	t.Helper()
	id := uuid.NewString()
	require.NoError(t, c.Project.Create().SetID(id).SetSlug(name).SetName(name).Exec(context.Background()))
	return id
}

func newTask(t *testing.T, c *ent.Client, projectID, stage string) string {
	t.Helper()
	id := uuid.NewString()
	require.NoError(t, c.Task.Create().SetID(id).SetSlug("t-"+id[:8]).SetTitle("Task "+stage).SetCwd("/tmp").
		SetProjectID(projectID).SetCurrentStage(stage).Exec(context.Background()))
	return id
}

func isInvalid(err error) bool {
	var ie *roadmap.InvalidError
	return errors.As(err, &ie)
}

func ptr[T any](v T) *T { return &v }

func TestPhases_OrderEditAndDelete(t *testing.T) {
	ctx := context.Background()
	c := openDB(t)
	s := roadmap.New(c)
	p := newProject(t, c, "agent-dashboard")

	a, err := s.AddPhase(ctx, p, roadmap.PhaseInput{Title: "  Communication   reliability ", Status: roadmap.StatusCompleted})
	require.NoError(t, err)
	b, err := s.AddPhase(ctx, p, roadmap.PhaseInput{Title: "LocalScope integration"})
	require.NoError(t, err)
	cc, err := s.AddPhase(ctx, p, roadmap.PhaseInput{Title: "Project Intelligence", Status: roadmap.StatusActive})
	require.NoError(t, err)

	rm, err := s.Get(ctx, p)
	require.NoError(t, err)
	require.Equal(t, []string{"Communication reliability", "LocalScope integration", "Project Intelligence"}, titles(rm))
	require.Equal(t, roadmap.StatusPlanned, rm.Phases[1].Status, "a phase without a status is planned")

	require.NoError(t, s.MovePhase(ctx, p, cc, -1))
	require.NoError(t, s.MovePhase(ctx, p, a, -1), "moving the first phase up is a no-op")
	rm, _ = s.Get(ctx, p)
	require.Equal(t, []string{"Communication reliability", "Project Intelligence", "LocalScope integration"}, titles(rm))

	require.NoError(t, s.UpdatePhase(ctx, p, b, roadmap.PhasePatch{Status: ptr(roadmap.StatusBlocked), BlockedReason: ptr("waiting on LocalScope contract"), DependsOn: &[]string{a}}))
	rm, _ = s.Get(ctx, p)
	require.Equal(t, 1, rm.Summary.Blocked)
	require.Equal(t, 1, rm.Summary.Completed)
	require.Equal(t, 1, rm.Summary.Active)

	require.NoError(t, s.DeletePhase(ctx, p, a))
	rm, _ = s.Get(ctx, p)
	require.Len(t, rm.Phases, 2)
	for _, ph := range rm.Phases {
		require.NotContains(t, ph.DependsOn, a, "a deleted phase is no longer a dependency")
	}

	for _, bad := range []roadmap.PhaseInput{{Title: ""}, {Title: "x", Status: "in-progress"}} {
		_, err := s.AddPhase(ctx, p, bad)
		require.True(t, isInvalid(err), "%+v", bad)
	}
	require.True(t, isInvalid(s.UpdatePhase(ctx, p, b, roadmap.PhasePatch{DependsOn: &[]string{b}})), "no self dependency")
}

func TestCurrentPhase_IsExplicitAndSingle(t *testing.T) {
	ctx := context.Background()
	c := openDB(t)
	s := roadmap.New(c)
	p := newProject(t, c, "p")
	a, _ := s.AddPhase(ctx, p, roadmap.PhaseInput{Title: "Done", Status: roadmap.StatusCompleted})
	b, _ := s.AddPhase(ctx, p, roadmap.PhaseInput{Title: "Next"})
	_, _ = s.AddPhase(ctx, p, roadmap.PhaseInput{Title: "Later"})

	rm, _ := s.Get(ctx, p)
	require.Nil(t, rm.CurrentPhaseID, "the first incomplete phase is not assumed current")

	require.NoError(t, s.SetCurrent(ctx, p, b))
	require.NoError(t, s.SetCurrent(ctx, p, a))
	rm, _ = s.Get(ctx, p)
	current := 0
	for _, ph := range rm.Phases {
		if ph.Current {
			current++
		}
	}
	require.Equal(t, 1, current)
	require.Equal(t, a, *rm.CurrentPhaseID)

	require.NoError(t, s.SetCurrent(ctx, p, ""))
	rm, _ = s.Get(ctx, p)
	require.Nil(t, rm.CurrentPhaseID)
}

// 39: a roadmap of Project A can never be read or changed through Project B.
func TestProjectIsolation(t *testing.T) {
	ctx := context.Background()
	c := openDB(t)
	s := roadmap.New(c)
	projA := newProject(t, c, "a")
	projB := newProject(t, c, "b")
	phaseA, _ := s.AddPhase(ctx, projA, roadmap.PhaseInput{Title: "A1"})
	phaseB, _ := s.AddPhase(ctx, projB, roadmap.PhaseInput{Title: "B1"})
	itemA, err := s.AddItem(ctx, projA, phaseA, roadmap.ItemInput{Title: "a item"})
	require.NoError(t, err)

	notFound := func(err error) { require.ErrorIs(t, err, roadmap.ErrNotFound) }
	notFound(s.UpdatePhase(ctx, projB, phaseA, roadmap.PhasePatch{Title: ptr("hijacked")}))
	notFound(s.DeletePhase(ctx, projB, phaseA))
	notFound(s.MovePhase(ctx, projB, phaseA, 1))
	notFound(s.SetCurrent(ctx, projB, phaseA))
	_, err = s.AddItem(ctx, projB, phaseA, roadmap.ItemInput{Title: "x"})
	notFound(err)
	notFound(s.UpdateItem(ctx, projB, itemA, roadmap.ItemPatch{Status: ptr(roadmap.StatusCompleted)}))
	notFound(s.DeleteItem(ctx, projB, itemA))
	notFound(s.MoveItem(ctx, projB, itemA, 1))
	require.True(t, isInvalid(s.UpdatePhase(ctx, projB, phaseB, roadmap.PhasePatch{DependsOn: &[]string{phaseA}})))

	rmA, _ := s.Get(ctx, projA)
	require.Equal(t, "A1", rmA.Phases[0].Title)
	require.Nil(t, rmA.CurrentPhaseID)
	require.Len(t, rmA.Phases[0].Items, 1)
	rmB, _ := s.Get(ctx, projB)
	require.Equal(t, []string{"B1"}, titles(rmB))

	_, err = s.Get(ctx, uuid.NewString())
	notFound(err)
}

// Provenance is the server's: user for edits, verified only through a linked
// task of the same project, suggested only through an accepted proposal.
func TestProvenanceAndVerifiedItems(t *testing.T) {
	ctx := context.Background()
	c := openDB(t)
	s := roadmap.New(c)
	p := newProject(t, c, "p")
	other := newProject(t, c, "other")
	phase, _ := s.AddPhase(ctx, p, roadmap.PhaseInput{Title: "Build"})
	done := newTask(t, c, p, "done")
	running := newTask(t, c, p, "implementation")
	foreign := newTask(t, c, other, "done")

	_, err := s.AddItem(ctx, p, phase, roadmap.ItemInput{Title: "Linked done", Status: roadmap.StatusPlanned, TaskID: done})
	require.NoError(t, err)
	_, err = s.AddItem(ctx, p, phase, roadmap.ItemInput{Title: "Linked running", TaskID: running})
	require.NoError(t, err)
	_, err = s.AddItem(ctx, p, phase, roadmap.ItemInput{Title: "Manual", Status: roadmap.StatusCompleted})
	require.NoError(t, err)
	_, err = s.AddItem(ctx, p, phase, roadmap.ItemInput{Title: "Skipped", Status: roadmap.StatusSkipped})
	require.NoError(t, err)
	_, err = s.AddItem(ctx, p, phase, roadmap.ItemInput{Title: "Foreign", TaskID: foreign})
	require.True(t, isInvalid(err), "a task of another project cannot be linked")

	rm, _ := s.Get(ctx, p)
	items := rm.Phases[0].Items
	require.Equal(t, roadmap.StatusCompleted, items[0].Status, "a linked item's status comes from its task")
	require.Equal(t, roadmap.ProvenanceVerified, items[0].Provenance)
	require.Equal(t, roadmap.StatusActive, items[1].Status)
	require.Equal(t, roadmap.ProvenanceVerified, items[1].Provenance)
	require.Equal(t, roadmap.ProvenanceUser, items[2].Provenance, "a person saying it is done is not verification")
	require.Equal(t, &roadmap.Progress{Completed: 2, Total: 3}, rm.Phases[0].Progress, "skipped items do not count")
	require.Equal(t, roadmap.ProvenanceUser, rm.Phases[0].Provenance)

	empty, _ := s.AddPhase(ctx, p, roadmap.PhaseInput{Title: "No items"})
	rm, _ = s.Get(ctx, p)
	for _, ph := range rm.Phases {
		if ph.ID == empty {
			require.Nil(t, ph.Progress, "no items, no percentage")
		}
	}
}

func proposal(phases ...map[string]any) map[string]any {
	list := make([]any, len(phases))
	for i, p := range phases {
		list[i] = p
	}
	return map[string]any{"objective": "Monitor and orchestrate local Claude agents", "summary": "From README and git history", "phases": list}
}

func TestValidateProposal(t *testing.T) {
	_, err := roadmap.ValidateProposal(nil)
	require.True(t, isInvalid(err))
	_, err = roadmap.ValidateProposal(proposal())
	require.True(t, isInvalid(err), "no phases")
	_, err = roadmap.ValidateProposal(proposal(map[string]any{"title": "A", "current": true}, map[string]any{"title": "B", "current": true}))
	require.True(t, isInvalid(err), "two current phases")
	_, err = roadmap.ValidateProposal(proposal(map[string]any{"title": "A", "status": "wip"}))
	require.True(t, isInvalid(err), "unknown status")
	_, err = roadmap.ValidateProposal(proposal(map[string]any{"title": "A", "items": []any{map[string]any{"title": ""}}}))
	require.True(t, isInvalid(err), "empty item")

	wrapped, err := roadmap.ValidateProposal(map[string]any{"roadmapProposal": proposal(map[string]any{"title": " A ", "evidence": []any{"README.md"}})})
	require.NoError(t, err)
	require.Equal(t, "A", wrapped.Phases[0].Title)
	require.Equal(t, roadmap.StatusPlanned, wrapped.Phases[0].Status)
}

// A proposal changes nothing until a person accepts it, and what it applies is suggested.
func TestProposals_ReviewThenApply(t *testing.T) {
	ctx := context.Background()
	c := openDB(t)
	s := roadmap.New(c)
	p := newProject(t, c, "p")
	existing, _ := s.AddPhase(ctx, p, roadmap.PhaseInput{Title: "Mine", Status: roadmap.StatusCompleted})

	payload, err := roadmap.ValidateProposal(proposal(
		map[string]any{"title": "Foundation", "status": "completed", "items": []any{map[string]any{"title": "Parser", "status": "completed"}}},
		map[string]any{"title": "Now", "status": "active", "current": true},
	))
	require.NoError(t, err)
	created, err := s.CreateProposal(ctx, p, payload, "sess-1")
	require.NoError(t, err)
	require.Equal(t, roadmap.ProposalPending, created.Status)

	rm, _ := s.Get(ctx, p)
	require.Equal(t, []string{"Mine"}, titles(rm), "a pending proposal changes nothing")
	require.Equal(t, "", rm.Objective)
	require.Equal(t, 1, rm.PendingProposals)

	require.True(t, isInvalid(s.AcceptProposal(ctx, p, created.ID, "merge")))
	require.NoError(t, s.AcceptProposal(ctx, p, created.ID, roadmap.AcceptAppend))
	rm, _ = s.Get(ctx, p)
	require.Equal(t, []string{"Mine", "Foundation", "Now"}, titles(rm))
	require.Equal(t, roadmap.ProvenanceUser, rm.Phases[0].Provenance)
	require.Equal(t, roadmap.ProvenanceSuggested, rm.Phases[1].Provenance)
	require.Equal(t, roadmap.ProvenanceSuggested, rm.Phases[1].Items[0].Provenance, "an accepted guess is never verified")
	require.True(t, rm.Phases[2].Current, "the proposal's current phase is taken when none is set")
	require.Equal(t, "Monitor and orchestrate local Claude agents", rm.Objective)
	require.Equal(t, 0, rm.PendingProposals)
	require.True(t, isInvalid(s.AcceptProposal(ctx, p, created.ID, roadmap.AcceptAppend)), "a proposal is applied once")

	// Editing a suggested phase makes it the user's.
	require.NoError(t, s.UpdatePhase(ctx, p, rm.Phases[1].ID, roadmap.PhasePatch{Description: ptr("checked")}))
	rm, _ = s.Get(ctx, p)
	require.Equal(t, roadmap.ProvenanceUser, rm.Phases[1].Provenance)

	second, _ := s.CreateProposal(ctx, p, payload, "")
	require.NoError(t, s.RejectProposal(ctx, p, second.ID))
	rm, _ = s.Get(ctx, p)
	require.Len(t, rm.Phases, 3, "rejecting changes nothing")

	third, _ := s.CreateProposal(ctx, p, payload, "")
	require.NoError(t, s.AcceptProposal(ctx, p, third.ID, roadmap.AcceptReplace))
	rm, _ = s.Get(ctx, p)
	require.Equal(t, []string{"Foundation", "Now"}, titles(rm))
	for _, ph := range rm.Phases {
		require.NotEqual(t, existing, ph.ID)
	}

	otherProject := newProject(t, c, "q")
	fourth, _ := s.CreateProposal(ctx, p, payload, "")
	require.ErrorIs(t, s.AcceptProposal(ctx, otherProject, fourth.ID, roadmap.AcceptAppend), roadmap.ErrNotFound)
	list, err := s.ListProposals(ctx, p)
	require.NoError(t, err)
	require.Len(t, list, 4)
}

func TestSummaries(t *testing.T) {
	ctx := context.Background()
	c := openDB(t)
	s := roadmap.New(c)
	p := newProject(t, c, "agent-dashboard")
	_ = newProject(t, c, "no-roadmap")
	_, _ = s.AddPhase(ctx, p, roadmap.PhaseInput{Title: "UI", Status: roadmap.StatusCompleted})
	cur, _ := s.AddPhase(ctx, p, roadmap.PhaseInput{Title: "Project Intelligence", Status: roadmap.StatusActive})
	require.NoError(t, s.SetCurrent(ctx, p, cur))

	sums, err := s.Summaries(ctx)
	require.NoError(t, err)
	require.Len(t, sums, 1, "only projects with a roadmap")
	require.Equal(t, "Project Intelligence", *sums[0].CurrentPhase)
	require.Equal(t, roadmap.StatusActive, *sums[0].CurrentStatus)
	require.Equal(t, 2, sums[0].Summary.Phases)
}

func titles(rm roadmap.Roadmap) []string {
	out := make([]string, len(rm.Phases))
	for i, p := range rm.Phases {
		out[i] = p.Title
	}
	return out
}

// Phase 4.1: Add imports only the phases the roadmap does not have; a changed or
// unchanged phase is never duplicated, and a proposal with nothing new is refused.
func TestAcceptAppendAddsOnlyNewPhases(t *testing.T) {
	ctx := t.Context()
	c := openDB(t)
	s := roadmap.New(c)
	p := newProject(t, c, "p")
	mine, _ := s.AddPhase(ctx, p, roadmap.PhaseInput{Title: "Project Intelligence", Status: roadmap.StatusActive})

	payload, err := roadmap.ValidateProposal(proposal(
		map[string]any{"title": "  project   INTELLIGENCE ", "status": "completed"},
		map[string]any{"title": "Orchestration", "status": "active", "current": true},
	))
	require.NoError(t, err)
	created, err := s.CreateProposal(ctx, p, payload, "sess-1")
	require.NoError(t, err)
	require.NoError(t, s.AcceptProposal(ctx, p, created.ID, roadmap.AcceptAppend))

	rm, _ := s.Get(ctx, p)
	require.Equal(t, []string{"Project Intelligence", "Orchestration"}, titles(rm))
	require.Equal(t, mine, rm.Phases[0].ID)
	require.Equal(t, roadmap.StatusActive, rm.Phases[0].Status, "a proposed change to an existing phase is not applied by Add")
	require.Equal(t, roadmap.ProvenanceUser, rm.Phases[0].Provenance)
	require.Equal(t, roadmap.ProvenanceSuggested, rm.Phases[1].Provenance)

	nothingNew, _ := s.CreateProposal(ctx, p, payload, "sess-1")
	require.True(t, isInvalid(s.AcceptProposal(ctx, p, nothingNew.ID, roadmap.AcceptAppend)), "nothing new to add")
	rm, _ = s.Get(ctx, p)
	require.Len(t, rm.Phases, 2)
	require.Equal(t, 1, rm.PendingProposals, "a refused Add leaves the proposal pending")
}
