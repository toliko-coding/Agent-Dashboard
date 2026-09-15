// Package roadmap is Project Intelligence's roadmap (Phase 4B): the phases and
// items of a Dashboard Project, where it currently is, and agent proposals a
// person reviews.
//
// Invariants this package owns:
//
//   - Scope. Every read and write is addressed by (project, phase|item|proposal)
//     and matches only rows of that project, so a request naming Project A can
//     never read or change Project B's roadmap.
//   - Status. One small vocabulary for phases and items: planned, ready, active,
//     blocked, completed, skipped.
//   - Current position. At most one phase per project is current ("you are
//     here"). It is explicit — never "the first incomplete phase" — and setting
//     one clears the others in the same transaction. Several phases may be
//     active at once (parallel work); only one is current.
//   - Provenance. "user" for anything a person entered or edited; "suggested"
//     for what was accepted from an agent proposal and not edited since;
//     "verified" only for an item linked to a pipeline task of the same project,
//     whose status is then read from that task. The server assigns provenance;
//     a request cannot set it.
//   - Progress. A phase's progress is completed items over items that are not
//     skipped — only when it has items. Without items there is no percentage.
//   - Proposals. An agent's proposal is stored as pending and changes nothing
//     until a person accepts it.
package roadmap

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/lx-wnk/agent-dashboard/server/internal/db/ent"
	"github.com/lx-wnk/agent-dashboard/server/internal/db/ent/project"
	"github.com/lx-wnk/agent-dashboard/server/internal/db/ent/roadmapitem"
	"github.com/lx-wnk/agent-dashboard/server/internal/db/ent/roadmapphase"
	"github.com/lx-wnk/agent-dashboard/server/internal/db/ent/roadmapproposal"
	"github.com/lx-wnk/agent-dashboard/server/internal/db/ent/task"
)

// Statuses shared by phases and items.
const (
	StatusPlanned   = "planned"
	StatusReady     = "ready"
	StatusActive    = "active"
	StatusBlocked   = "blocked"
	StatusCompleted = "completed"
	StatusSkipped   = "skipped"
)

// Provenance values.
const (
	ProvenanceUser      = "user"
	ProvenanceSuggested = "suggested"
	ProvenanceVerified  = "verified"
)

// Proposal statuses.
const (
	ProposalPending  = "pending"
	ProposalAccepted = "accepted"
	ProposalRejected = "rejected"
)

// Limits.
const (
	MaxTitleRunes       = 120
	MaxItemTitleRunes   = 200
	MaxDescriptionRunes = 2000
	MaxReasonRunes      = 500
	MaxDecisionsRunes   = 4000
	MaxObjectiveRunes   = 1000
	MaxPhases           = 40
	MaxItemsPerPhase    = 60
)

var statuses = []string{StatusPlanned, StatusReady, StatusActive, StatusBlocked, StatusCompleted, StatusSkipped}

// IsStatus reports whether s is one of the roadmap statuses.
func IsStatus(s string) bool { return slices.Contains(statuses, s) }

// ErrNotFound is returned for a project, phase, item or proposal that does not
// exist in the named project.
var ErrNotFound = errors.New("not found")

// InvalidError is a request the roadmap rules refuse; its message is safe to show.
type InvalidError struct{ Msg string }

func (e *InvalidError) Error() string { return e.Msg }

func invalid(format string, args ...any) error {
	return &InvalidError{Msg: fmt.Sprintf(format, args...)}
}

// Progress is completed over counted (non-skipped) items.
type Progress struct {
	Completed int `json:"completed"`
	Total     int `json:"total"`
}

// TaskRef is the pipeline task an item is linked to.
type TaskRef struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Stage string `json:"stage"`
}

// Item is a roadmap item as read.
type Item struct {
	ID            string    `json:"id"`
	Title         string    `json:"title"`
	Status        string    `json:"status"`
	Provenance    string    `json:"provenance"`
	BlockedReason string    `json:"blockedReason,omitempty"`
	Position      int       `json:"position"`
	Task          *TaskRef  `json:"task,omitempty"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

// Phase is a roadmap phase as read.
type Phase struct {
	ID            string    `json:"id"`
	Title         string    `json:"title"`
	Description   string    `json:"description"`
	Status        string    `json:"status"`
	Provenance    string    `json:"provenance"`
	BlockedReason string    `json:"blockedReason,omitempty"`
	Decisions     string    `json:"decisions,omitempty"`
	DependsOn     []string  `json:"dependsOn"`
	Position      int       `json:"position"`
	Current       bool      `json:"current"`
	Progress      *Progress `json:"progress"`
	Items         []Item    `json:"items"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

// Summary counts a roadmap's phases by what they mean.
type Summary struct {
	Phases    int `json:"phases"`
	Completed int `json:"completed"`
	Active    int `json:"active"`
	Blocked   int `json:"blocked"`
}

// Roadmap is a project's roadmap as read.
type Roadmap struct {
	ProjectID        string    `json:"projectId"`
	Objective        string    `json:"objective"`
	Phases           []Phase   `json:"phases"`
	CurrentPhaseID   *string   `json:"currentPhaseId"`
	Summary          Summary   `json:"summary"`
	PendingProposals int       `json:"pendingProposals"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

// Service reads and writes roadmaps.
type Service struct {
	client *ent.Client
	now    func() time.Time
}

// New creates a Service.
func New(client *ent.Client) *Service {
	return &Service{client: client, now: time.Now}
}

func runes(s string) int { return len([]rune(s)) }

func cleanLine(s string) string { return strings.Join(strings.Fields(s), " ") }

func (s *Service) projectExists(ctx context.Context, projectID string) error {
	ok, err := s.client.Project.Query().Where(project.ID(projectID)).Exist(ctx)
	if err != nil {
		return err
	}
	if !ok {
		return ErrNotFound
	}
	return nil
}

func (s *Service) phaseOf(ctx context.Context, projectID, phaseID string) (*ent.RoadmapPhase, error) {
	p, err := s.client.RoadmapPhase.Query().
		Where(roadmapphase.ID(phaseID), roadmapphase.HasProjectWith(project.ID(projectID))).
		Only(ctx)
	if ent.IsNotFound(err) {
		return nil, ErrNotFound
	}
	return p, err
}

func (s *Service) itemOf(ctx context.Context, projectID, itemID string) (*ent.RoadmapItem, error) {
	it, err := s.client.RoadmapItem.Query().
		Where(roadmapitem.ID(itemID), roadmapitem.HasPhaseWith(roadmapphase.HasProjectWith(project.ID(projectID)))).
		Only(ctx)
	if ent.IsNotFound(err) {
		return nil, ErrNotFound
	}
	return it, err
}

// taskStatus maps a linked pipeline task's stage to a roadmap status.
func taskStatus(stage string) string {
	switch stage {
	case "done":
		return StatusCompleted
	case "cancelled":
		return StatusSkipped
	case "backlog", "ready":
		return StatusPlanned
	case "on_hold":
		return StatusBlocked
	default:
		return StatusActive
	}
}

// Get reads a project's roadmap.
func (s *Service) Get(ctx context.Context, projectID string) (Roadmap, error) {
	proj, err := s.client.Project.Get(ctx, projectID)
	if ent.IsNotFound(err) {
		return Roadmap{}, ErrNotFound
	}
	if err != nil {
		return Roadmap{}, err
	}
	rows, err := s.client.RoadmapPhase.Query().
		Where(roadmapphase.HasProjectWith(project.ID(projectID))).
		Order(ent.Asc(roadmapphase.FieldPosition), ent.Asc(roadmapphase.FieldCreatedAt)).
		WithItems(func(q *ent.RoadmapItemQuery) {
			q.Order(ent.Asc(roadmapitem.FieldPosition), ent.Asc(roadmapitem.FieldCreatedAt))
		}).
		All(ctx)
	if err != nil {
		return Roadmap{}, err
	}

	var taskIDs []string
	for _, p := range rows {
		for _, it := range p.Edges.Items {
			if it.TaskID != nil {
				taskIDs = append(taskIDs, *it.TaskID)
			}
		}
	}
	tasks := map[string]*ent.Task{}
	if len(taskIDs) > 0 {
		found, terr := s.client.Task.Query().Where(task.IDIn(taskIDs...), task.ProjectID(projectID)).All(ctx)
		if terr != nil {
			return Roadmap{}, terr
		}
		for _, t := range found {
			tasks[t.ID] = t
		}
	}

	out := Roadmap{ProjectID: projectID, Phases: []Phase{}, UpdatedAt: proj.UpdatedAt}
	if proj.Objective != nil {
		out.Objective = *proj.Objective
	}
	for _, p := range rows {
		ph := Phase{
			ID: p.ID, Title: p.Title, Description: p.Description, Status: p.Status, Provenance: p.Provenance,
			BlockedReason: p.BlockedReason, Decisions: p.Decisions, DependsOn: p.DependsOn, Position: p.Position,
			Current: p.IsCurrent, Items: []Item{}, UpdatedAt: p.UpdatedAt,
		}
		if ph.DependsOn == nil {
			ph.DependsOn = []string{}
		}
		if p.UpdatedAt.After(out.UpdatedAt) {
			out.UpdatedAt = p.UpdatedAt
		}
		var prog Progress
		for _, it := range p.Edges.Items {
			item := Item{
				ID: it.ID, Title: it.Title, Status: it.Status, Provenance: it.Provenance,
				BlockedReason: it.BlockedReason, Position: it.Position, UpdatedAt: it.UpdatedAt,
			}
			if it.TaskID != nil {
				if t, ok := tasks[*it.TaskID]; ok {
					item.Task = &TaskRef{ID: t.ID, Title: t.Title, Stage: t.CurrentStage}
					item.Status = taskStatus(t.CurrentStage)
					item.Provenance = ProvenanceVerified
				}
			}
			if item.Status != StatusSkipped {
				prog.Total++
				if item.Status == StatusCompleted {
					prog.Completed++
				}
			}
			ph.Items = append(ph.Items, item)
		}
		if prog.Total > 0 {
			ph.Progress = &prog
		}
		if ph.Current {
			id := ph.ID
			out.CurrentPhaseID = &id
		}
		out.Summary.Phases++
		switch ph.Status {
		case StatusCompleted:
			out.Summary.Completed++
		case StatusActive:
			out.Summary.Active++
		case StatusBlocked:
			out.Summary.Blocked++
		}
		out.Phases = append(out.Phases, ph)
	}
	pending, err := s.client.RoadmapProposal.Query().
		Where(roadmapproposal.HasProjectWith(project.ID(projectID)), roadmapproposal.Status(ProposalPending)).
		Count(ctx)
	if err != nil {
		return Roadmap{}, err
	}
	out.PendingProposals = pending
	return out, nil
}

// SetObjective replaces the project's objective ("" clears it).
func (s *Service) SetObjective(ctx context.Context, projectID, objective string) error {
	objective = strings.TrimSpace(objective)
	if runes(objective) > MaxObjectiveRunes {
		return invalid("the objective can be at most %d characters", MaxObjectiveRunes)
	}
	if err := s.projectExists(ctx, projectID); err != nil {
		return err
	}
	upd := s.client.Project.UpdateOneID(projectID)
	if objective == "" {
		upd.ClearObjective()
	} else {
		upd.SetObjective(objective)
	}
	return upd.Exec(ctx)
}

// PhaseInput is a new phase.
type PhaseInput struct {
	Title       string
	Description string
	Status      string
}

// PhasePatch changes a phase; nil leaves a field as it is.
type PhasePatch struct {
	Title         *string
	Description   *string
	Status        *string
	BlockedReason *string
	Decisions     *string
	DependsOn     *[]string
}

func validPhaseTitle(t string) (string, error) {
	t = cleanLine(t)
	if t == "" {
		return "", invalid("a phase needs a name")
	}
	if runes(t) > MaxTitleRunes {
		return "", invalid("a phase name can be at most %d characters", MaxTitleRunes)
	}
	return t, nil
}

func validStatus(st string) (string, error) {
	if st == "" {
		return StatusPlanned, nil
	}
	if !IsStatus(st) {
		return "", invalid("unknown status %q", st)
	}
	return st, nil
}

func (s *Service) nextPhasePosition(ctx context.Context, projectID string) (int, error) {
	last, err := s.client.RoadmapPhase.Query().
		Where(roadmapphase.HasProjectWith(project.ID(projectID))).
		Order(ent.Desc(roadmapphase.FieldPosition)).
		First(ctx)
	if ent.IsNotFound(err) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	return last.Position + 1, nil
}

// AddPhase appends a phase entered by a person.
func (s *Service) AddPhase(ctx context.Context, projectID string, in PhaseInput) (string, error) {
	title, err := validPhaseTitle(in.Title)
	if err != nil {
		return "", err
	}
	st, err := validStatus(in.Status)
	if err != nil {
		return "", err
	}
	desc := strings.TrimSpace(in.Description)
	if runes(desc) > MaxDescriptionRunes {
		return "", invalid("a description can be at most %d characters", MaxDescriptionRunes)
	}
	if err := s.projectExists(ctx, projectID); err != nil {
		return "", err
	}
	count, err := s.client.RoadmapPhase.Query().Where(roadmapphase.HasProjectWith(project.ID(projectID))).Count(ctx)
	if err != nil {
		return "", err
	}
	if count >= MaxPhases {
		return "", invalid("a roadmap can have at most %d phases", MaxPhases)
	}
	pos, err := s.nextPhasePosition(ctx, projectID)
	if err != nil {
		return "", err
	}
	id := uuid.NewString()
	err = s.client.RoadmapPhase.Create().SetID(id).SetProjectID(projectID).
		SetTitle(title).SetDescription(desc).SetStatus(st).SetPosition(pos).
		SetProvenance(ProvenanceUser).SetDependsOn([]string{}).Exec(ctx)
	return id, err
}

// UpdatePhase applies a person's edit. Editing makes the phase the user's.
func (s *Service) UpdatePhase(ctx context.Context, projectID, phaseID string, in PhasePatch) error {
	ph, err := s.phaseOf(ctx, projectID, phaseID)
	if err != nil {
		return err
	}
	upd := ph.Update().SetProvenance(ProvenanceUser)
	if in.Title != nil {
		t, terr := validPhaseTitle(*in.Title)
		if terr != nil {
			return terr
		}
		upd.SetTitle(t)
	}
	if in.Description != nil {
		d := strings.TrimSpace(*in.Description)
		if runes(d) > MaxDescriptionRunes {
			return invalid("a description can be at most %d characters", MaxDescriptionRunes)
		}
		upd.SetDescription(d)
	}
	if in.Status != nil {
		if !IsStatus(*in.Status) {
			return invalid("unknown status %q", *in.Status)
		}
		upd.SetStatus(*in.Status)
	}
	if in.BlockedReason != nil {
		r := strings.TrimSpace(*in.BlockedReason)
		if runes(r) > MaxReasonRunes {
			return invalid("a blocker can be at most %d characters", MaxReasonRunes)
		}
		upd.SetBlockedReason(r)
	}
	if in.Decisions != nil {
		d := strings.TrimSpace(*in.Decisions)
		if runes(d) > MaxDecisionsRunes {
			return invalid("decisions can be at most %d characters", MaxDecisionsRunes)
		}
		upd.SetDecisions(d)
	}
	if in.DependsOn != nil {
		deps := []string{}
		for _, id := range *in.DependsOn {
			if id == phaseID {
				return invalid("a phase cannot depend on itself")
			}
			if _, derr := s.phaseOf(ctx, projectID, id); derr != nil {
				if errors.Is(derr, ErrNotFound) {
					return invalid("a phase can only depend on phases of the same roadmap")
				}
				return derr
			}
			if !slices.Contains(deps, id) {
				deps = append(deps, id)
			}
		}
		upd.SetDependsOn(deps)
	}
	return upd.Exec(ctx)
}

// DeletePhase removes a phase and its items. Other phases that depended on it
// no longer do.
func (s *Service) DeletePhase(ctx context.Context, projectID, phaseID string) error {
	if _, err := s.phaseOf(ctx, projectID, phaseID); err != nil {
		return err
	}
	return s.withTx(ctx, func(tx *ent.Tx) error {
		if _, err := tx.RoadmapItem.Delete().Where(roadmapitem.HasPhaseWith(roadmapphase.ID(phaseID))).Exec(ctx); err != nil {
			return err
		}
		if err := tx.RoadmapPhase.DeleteOneID(phaseID).Exec(ctx); err != nil {
			return err
		}
		others, err := tx.RoadmapPhase.Query().Where(roadmapphase.HasProjectWith(project.ID(projectID))).All(ctx)
		if err != nil {
			return err
		}
		for _, o := range others {
			if slices.Contains(o.DependsOn, phaseID) {
				kept := slices.DeleteFunc(slices.Clone(o.DependsOn), func(id string) bool { return id == phaseID })
				if err := o.Update().SetDependsOn(kept).Exec(ctx); err != nil {
					return err
				}
			}
		}
		return nil
	})
}

// MovePhase swaps a phase with its neighbour: direction -1 up, +1 down.
func (s *Service) MovePhase(ctx context.Context, projectID, phaseID string, direction int) error {
	if _, err := s.phaseOf(ctx, projectID, phaseID); err != nil {
		return err
	}
	return s.withTx(ctx, func(tx *ent.Tx) error {
		rows, err := tx.RoadmapPhase.Query().
			Where(roadmapphase.HasProjectWith(project.ID(projectID))).
			Order(ent.Asc(roadmapphase.FieldPosition), ent.Asc(roadmapphase.FieldCreatedAt)).
			All(ctx)
		if err != nil {
			return err
		}
		ids := make([]string, len(rows))
		for i, r := range rows {
			ids[i] = r.ID
		}
		if err := reorder(ids, phaseID, direction); err != nil {
			return err
		}
		for i, id := range ids {
			if err := tx.RoadmapPhase.UpdateOneID(id).SetPosition(i).Exec(ctx); err != nil {
				return err
			}
		}
		return nil
	})
}

func reorder(ids []string, id string, direction int) error {
	if direction != -1 && direction != 1 {
		return invalid("direction must be up or down")
	}
	i := slices.Index(ids, id)
	j := i + direction
	if i < 0 || j < 0 || j >= len(ids) {
		return nil // already at the edge: nothing to move
	}
	ids[i], ids[j] = ids[j], ids[i]
	return nil
}

// SetCurrent makes phaseID the project's one current phase; "" clears it.
func (s *Service) SetCurrent(ctx context.Context, projectID, phaseID string) error {
	if phaseID != "" {
		if _, err := s.phaseOf(ctx, projectID, phaseID); err != nil {
			return err
		}
	} else if err := s.projectExists(ctx, projectID); err != nil {
		return err
	}
	return s.withTx(ctx, func(tx *ent.Tx) error {
		if _, err := tx.RoadmapPhase.Update().
			Where(roadmapphase.HasProjectWith(project.ID(projectID)), roadmapphase.IsCurrent(true)).
			SetIsCurrent(false).Save(ctx); err != nil {
			return err
		}
		if phaseID == "" {
			return nil
		}
		return tx.RoadmapPhase.UpdateOneID(phaseID).SetIsCurrent(true).Exec(ctx)
	})
}

// ItemInput is a new item.
type ItemInput struct {
	Title  string
	Status string
	TaskID string
}

// ItemPatch changes an item; nil leaves a field as it is. An empty TaskID
// unlinks the task.
type ItemPatch struct {
	Title         *string
	Status        *string
	BlockedReason *string
	TaskID        *string
}

func validItemTitle(t string) (string, error) {
	t = cleanLine(t)
	if t == "" {
		return "", invalid("an item needs a name")
	}
	if runes(t) > MaxItemTitleRunes {
		return "", invalid("an item name can be at most %d characters", MaxItemTitleRunes)
	}
	return t, nil
}

// linkableTask checks that taskID is a pipeline task of the same project.
func (s *Service) linkableTask(ctx context.Context, projectID, taskID string) error {
	ok, err := s.client.Task.Query().Where(task.ID(taskID), task.ProjectID(projectID)).Exist(ctx)
	if err != nil {
		return err
	}
	if !ok {
		return invalid("an item can only link a task of the same project")
	}
	return nil
}

// AddItem appends an item a person entered to a phase.
func (s *Service) AddItem(ctx context.Context, projectID, phaseID string, in ItemInput) (string, error) {
	title, err := validItemTitle(in.Title)
	if err != nil {
		return "", err
	}
	st, err := validStatus(in.Status)
	if err != nil {
		return "", err
	}
	if _, err := s.phaseOf(ctx, projectID, phaseID); err != nil {
		return "", err
	}
	if in.TaskID != "" {
		if err := s.linkableTask(ctx, projectID, in.TaskID); err != nil {
			return "", err
		}
	}
	items, err := s.client.RoadmapItem.Query().Where(roadmapitem.HasPhaseWith(roadmapphase.ID(phaseID))).
		Order(ent.Desc(roadmapitem.FieldPosition)).All(ctx)
	if err != nil {
		return "", err
	}
	if len(items) >= MaxItemsPerPhase {
		return "", invalid("a phase can have at most %d items", MaxItemsPerPhase)
	}
	pos := 0
	if len(items) > 0 {
		pos = items[0].Position + 1
	}
	id := uuid.NewString()
	create := s.client.RoadmapItem.Create().SetID(id).SetPhaseID(phaseID).
		SetTitle(title).SetStatus(st).SetPosition(pos).SetProvenance(ProvenanceUser)
	if in.TaskID != "" {
		create.SetTaskID(in.TaskID)
	}
	return id, create.Exec(ctx)
}

// UpdateItem applies a person's edit to an item. Editing makes it the user's.
func (s *Service) UpdateItem(ctx context.Context, projectID, itemID string, in ItemPatch) error {
	it, err := s.itemOf(ctx, projectID, itemID)
	if err != nil {
		return err
	}
	upd := it.Update().SetProvenance(ProvenanceUser)
	if in.Title != nil {
		t, terr := validItemTitle(*in.Title)
		if terr != nil {
			return terr
		}
		upd.SetTitle(t)
	}
	if in.Status != nil {
		if !IsStatus(*in.Status) {
			return invalid("unknown status %q", *in.Status)
		}
		upd.SetStatus(*in.Status)
	}
	if in.BlockedReason != nil {
		r := strings.TrimSpace(*in.BlockedReason)
		if runes(r) > MaxReasonRunes {
			return invalid("a blocker can be at most %d characters", MaxReasonRunes)
		}
		upd.SetBlockedReason(r)
	}
	if in.TaskID != nil {
		if *in.TaskID == "" {
			upd.ClearTaskID()
		} else {
			if err := s.linkableTask(ctx, projectID, *in.TaskID); err != nil {
				return err
			}
			upd.SetTaskID(*in.TaskID)
		}
	}
	return upd.Exec(ctx)
}

// DeleteItem removes an item.
func (s *Service) DeleteItem(ctx context.Context, projectID, itemID string) error {
	if _, err := s.itemOf(ctx, projectID, itemID); err != nil {
		return err
	}
	return s.client.RoadmapItem.DeleteOneID(itemID).Exec(ctx)
}

// MoveItem swaps an item with its neighbour in its phase.
func (s *Service) MoveItem(ctx context.Context, projectID, itemID string, direction int) error {
	it, err := s.itemOf(ctx, projectID, itemID)
	if err != nil {
		return err
	}
	phaseID, err := it.QueryPhase().OnlyID(ctx)
	if err != nil {
		return err
	}
	return s.withTx(ctx, func(tx *ent.Tx) error {
		rows, err := tx.RoadmapItem.Query().Where(roadmapitem.HasPhaseWith(roadmapphase.ID(phaseID))).
			Order(ent.Asc(roadmapitem.FieldPosition), ent.Asc(roadmapitem.FieldCreatedAt)).All(ctx)
		if err != nil {
			return err
		}
		ids := make([]string, len(rows))
		for i, r := range rows {
			ids[i] = r.ID
		}
		if err := reorder(ids, itemID, direction); err != nil {
			return err
		}
		for i, id := range ids {
			if err := tx.RoadmapItem.UpdateOneID(id).SetPosition(i).Exec(ctx); err != nil {
				return err
			}
		}
		return nil
	})
}

// ProjectSummary is one project's roadmap position, for Command.
type ProjectSummary struct {
	ProjectID        string  `json:"projectId"`
	Name             string  `json:"name"`
	CurrentPhase     *string `json:"currentPhase"`
	CurrentStatus    *string `json:"currentStatus"`
	Summary          Summary `json:"summary"`
	PendingProposals int     `json:"pendingProposals"`
}

// Summaries reads every project that has a roadmap.
func (s *Service) Summaries(ctx context.Context) ([]ProjectSummary, error) {
	projects, err := s.client.Project.Query().
		Where(project.HasRoadmapPhases()).
		Order(ent.Asc(project.FieldName)).
		All(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]ProjectSummary, 0, len(projects))
	for _, p := range projects {
		rm, gerr := s.Get(ctx, p.ID)
		if gerr != nil {
			return nil, gerr
		}
		ps := ProjectSummary{ProjectID: p.ID, Name: p.Name, Summary: rm.Summary, PendingProposals: rm.PendingProposals}
		for _, ph := range rm.Phases {
			if ph.Current {
				title, status := ph.Title, ph.Status
				ps.CurrentPhase, ps.CurrentStatus = &title, &status
			}
		}
		out = append(out, ps)
	}
	return out, nil
}

func (s *Service) withTx(ctx context.Context, fn func(tx *ent.Tx) error) error {
	tx, err := s.client.Tx(ctx)
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}
