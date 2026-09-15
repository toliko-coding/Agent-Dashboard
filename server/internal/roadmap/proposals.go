package roadmap

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/lx-wnk/agent-dashboard/server/internal/db/ent"
	"github.com/lx-wnk/agent-dashboard/server/internal/db/ent/project"
	"github.com/lx-wnk/agent-dashboard/server/internal/db/ent/roadmapitem"
	"github.com/lx-wnk/agent-dashboard/server/internal/db/ent/roadmapphase"
	"github.com/lx-wnk/agent-dashboard/server/internal/db/ent/roadmapproposal"
)

/*
 * Roadmap proposals (Phase 4B): a structured roadmap an agent returned for a
 * project, stored as pending for a person to review. Nothing here changes the
 * roadmap except AcceptProposal, which a person calls, and what it applies is
 * marked "suggested" — never "user" or "verified".
 */

// Accept modes.
const (
	AcceptAppend  = "append"
	AcceptReplace = "replace"
)

// Proposal limits.
const (
	MaxProposalPhases   = 30
	MaxProposalItems    = 40
	MaxProposalEvidence = 12
	MaxEvidenceRunes    = 240
)

// ProposedItem is one item of a proposed phase.
type ProposedItem struct {
	Title  string `json:"title"`
	Status string `json:"status"`
}

// ProposedPhase is one phase of a proposal.
type ProposedPhase struct {
	Title       string         `json:"title"`
	Description string         `json:"description"`
	Status      string         `json:"status"`
	Current     bool           `json:"current"`
	Evidence    []string       `json:"evidence"`
	Items       []ProposedItem `json:"items"`
}

// ProposalPayload is a validated proposal.
type ProposalPayload struct {
	Objective string          `json:"objective"`
	Summary   string          `json:"summary"`
	Phases    []ProposedPhase `json:"phases"`
}

// Proposal is a stored proposal as read.
type Proposal struct {
	ID        string          `json:"id"`
	Status    string          `json:"status"`
	Source    string          `json:"source"`
	Summary   string          `json:"summary"`
	Payload   ProposalPayload `json:"payload"`
	CreatedAt time.Time       `json:"createdAt"`
	DecidedAt *time.Time      `json:"decidedAt,omitempty"`
}

// ValidateProposal turns a structured block an agent returned into a proposal,
// or explains what is wrong with it. It accepts only the documented shape.
func ValidateProposal(raw map[string]any) (ProposalPayload, error) {
	if raw == nil {
		return ProposalPayload{}, invalid("no structured roadmap proposal was found")
	}
	// A proposal may be the object itself or wrapped as {"roadmapProposal": {...}}.
	if inner, ok := raw["roadmapProposal"].(map[string]any); ok {
		raw = inner
	}
	data, err := json.Marshal(raw)
	if err != nil {
		return ProposalPayload{}, invalid("the proposal is not valid JSON")
	}
	var p ProposalPayload
	if err := json.Unmarshal(data, &p); err != nil {
		return ProposalPayload{}, invalid("the proposal does not have the expected shape: %v", err)
	}
	p.Objective = strings.TrimSpace(p.Objective)
	p.Summary = strings.TrimSpace(p.Summary)
	if runes(p.Objective) > MaxObjectiveRunes {
		return ProposalPayload{}, invalid("the proposed objective is too long")
	}
	if runes(p.Summary) > MaxDescriptionRunes {
		return ProposalPayload{}, invalid("the proposal summary is too long")
	}
	if len(p.Phases) == 0 {
		return ProposalPayload{}, invalid("the proposal has no phases")
	}
	if len(p.Phases) > MaxProposalPhases {
		return ProposalPayload{}, invalid("the proposal has more than %d phases", MaxProposalPhases)
	}
	current := 0
	for i := range p.Phases {
		ph := &p.Phases[i]
		title, terr := validPhaseTitle(ph.Title)
		if terr != nil {
			return ProposalPayload{}, invalid("phase %d: %s", i+1, terr.Error())
		}
		ph.Title = title
		ph.Description = strings.TrimSpace(ph.Description)
		if runes(ph.Description) > MaxDescriptionRunes {
			return ProposalPayload{}, invalid("phase %d: the description is too long", i+1)
		}
		st, serr := validStatus(ph.Status)
		if serr != nil {
			return ProposalPayload{}, invalid("phase %d: %s", i+1, serr.Error())
		}
		ph.Status = st
		if ph.Current {
			current++
		}
		if len(ph.Evidence) > MaxProposalEvidence {
			ph.Evidence = ph.Evidence[:MaxProposalEvidence]
		}
		for j, ev := range ph.Evidence {
			ev = cleanLine(ev)
			if runes(ev) > MaxEvidenceRunes {
				ev = string([]rune(ev)[:MaxEvidenceRunes])
			}
			ph.Evidence[j] = ev
		}
		if len(ph.Items) > MaxProposalItems {
			return ProposalPayload{}, invalid("phase %d has more than %d items", i+1, MaxProposalItems)
		}
		for j := range ph.Items {
			it := &ph.Items[j]
			t, ierr := validItemTitle(it.Title)
			if ierr != nil {
				return ProposalPayload{}, invalid("phase %d, item %d: %s", i+1, j+1, ierr.Error())
			}
			it.Title = t
			ist, iserr := validStatus(it.Status)
			if iserr != nil {
				return ProposalPayload{}, invalid("phase %d, item %d: %s", i+1, j+1, iserr.Error())
			}
			it.Status = ist
		}
	}
	if current > 1 {
		return ProposalPayload{}, invalid("a proposal can mark at most one phase as current")
	}
	return p, nil
}

func payloadMap(p ProposalPayload) map[string]any {
	data, _ := json.Marshal(p)
	var m map[string]any
	_ = json.Unmarshal(data, &m)
	return m
}

func toProposal(row *ent.RoadmapProposal) Proposal {
	var payload ProposalPayload
	if data, err := json.Marshal(row.Payload); err == nil {
		_ = json.Unmarshal(data, &payload)
	}
	return Proposal{ID: row.ID, Status: row.Status, Source: row.Source, Summary: row.Summary, Payload: payload, CreatedAt: row.CreatedAt, DecidedAt: row.DecidedAt}
}

// CreateProposal stores a validated proposal as pending.
func (s *Service) CreateProposal(ctx context.Context, projectID string, p ProposalPayload, agentSessionID string) (Proposal, error) {
	if err := s.projectExists(ctx, projectID); err != nil {
		return Proposal{}, err
	}
	create := s.client.RoadmapProposal.Create().SetID(uuid.NewString()).SetProjectID(projectID).
		SetStatus(ProposalPending).SetSource("agent").SetSummary(p.Summary).SetPayload(payloadMap(p))
	if agentSessionID != "" {
		create.SetAgentSessionID(agentSessionID)
	}
	row, err := create.Save(ctx)
	if err != nil {
		return Proposal{}, err
	}
	return toProposal(row), nil
}

// ListProposals reads a project's proposals, newest first.
func (s *Service) ListProposals(ctx context.Context, projectID string) ([]Proposal, error) {
	if err := s.projectExists(ctx, projectID); err != nil {
		return nil, err
	}
	rows, err := s.client.RoadmapProposal.Query().
		Where(roadmapproposal.HasProjectWith(project.ID(projectID))).
		Order(ent.Desc(roadmapproposal.FieldCreatedAt)).
		Limit(20).
		All(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]Proposal, 0, len(rows))
	for _, r := range rows {
		out = append(out, toProposal(r))
	}
	return out, nil
}

func (s *Service) pendingProposalOf(ctx context.Context, projectID, proposalID string) (*ent.RoadmapProposal, error) {
	row, err := s.client.RoadmapProposal.Query().
		Where(roadmapproposal.ID(proposalID), roadmapproposal.HasProjectWith(project.ID(projectID))).
		Only(ctx)
	if ent.IsNotFound(err) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if row.Status != ProposalPending {
		return nil, invalid("this proposal was already %s", row.Status)
	}
	return row, nil
}

// RejectProposal marks a pending proposal rejected; the roadmap is unchanged.
func (s *Service) RejectProposal(ctx context.Context, projectID, proposalID string) error {
	row, err := s.pendingProposalOf(ctx, projectID, proposalID)
	if err != nil {
		return err
	}
	return row.Update().SetStatus(ProposalRejected).SetDecidedAt(s.now()).Exec(ctx)
}

// AcceptProposal applies a pending proposal a person accepted.
//
//	append   adds the proposed phases after the existing ones; the proposal's
//	         current phase becomes current only when none is set; the objective
//	         is taken only when the project has none.
//	replace  removes the existing phases first, then applies the proposal,
//	         objective and current phase included.
//
// Everything applied is "suggested".
func (s *Service) AcceptProposal(ctx context.Context, projectID, proposalID, mode string) error {
	if mode != AcceptAppend && mode != AcceptReplace {
		return invalid("mode must be append or replace")
	}
	row, err := s.pendingProposalOf(ctx, projectID, proposalID)
	if err != nil {
		return err
	}
	proposal := toProposal(row).Payload
	payload, err := ValidateProposal(payloadMap(proposal))
	if err != nil {
		return err
	}
	return s.withTx(ctx, func(tx *ent.Tx) error {
		proj, err := tx.Project.Get(ctx, projectID)
		if err != nil {
			return err
		}
		pos := 0
		hasCurrent := false
		if mode == AcceptReplace {
			if _, err := tx.RoadmapItem.Delete().Where(roadmapitem.HasPhaseWith(roadmapphase.HasProjectWith(project.ID(projectID)))).Exec(ctx); err != nil {
				return err
			}
			if _, err := tx.RoadmapPhase.Delete().Where(roadmapphase.HasProjectWith(project.ID(projectID))).Exec(ctx); err != nil {
				return err
			}
		} else {
			existing, err := tx.RoadmapPhase.Query().Where(roadmapphase.HasProjectWith(project.ID(projectID))).All(ctx)
			if err != nil {
				return err
			}
			// Append adds only the phases the roadmap does not already have (by
			// normalized title). A proposed change to an existing phase is shown
			// in review but never applied by Add — that takes Replace or an edit.
			known := make(map[string]bool, len(existing))
			for _, e := range existing {
				pos = max(pos, e.Position+1)
				hasCurrent = hasCurrent || e.IsCurrent
				known[NormalizeTitle(e.Title)] = true
			}
			additions := payload.Phases[:0:0]
			for _, ph := range payload.Phases {
				if !known[NormalizeTitle(ph.Title)] {
					additions = append(additions, ph)
					known[NormalizeTitle(ph.Title)] = true
				}
			}
			if len(additions) == 0 {
				return invalid("the proposal has no new phases to add; replace instead, or reject it")
			}
			if len(existing)+len(additions) > MaxPhases {
				return invalid("accepting would exceed %d phases; replace instead", MaxPhases)
			}
			payload.Phases = additions
		}
		for i, ph := range payload.Phases {
			phaseID := uuid.NewString()
			if err := tx.RoadmapPhase.Create().SetID(phaseID).SetProjectID(projectID).
				SetTitle(ph.Title).SetDescription(ph.Description).SetStatus(ph.Status).
				SetPosition(pos + i).SetIsCurrent(ph.Current && !hasCurrent).
				SetProvenance(ProvenanceSuggested).SetDependsOn([]string{}).Exec(ctx); err != nil {
				return err
			}
			for j, it := range ph.Items {
				if err := tx.RoadmapItem.Create().SetID(uuid.NewString()).SetPhaseID(phaseID).
					SetTitle(it.Title).SetStatus(it.Status).SetPosition(j).
					SetProvenance(ProvenanceSuggested).Exec(ctx); err != nil {
					return err
				}
			}
		}
		if payload.Objective != "" && (mode == AcceptReplace || proj.Objective == nil || *proj.Objective == "") {
			if err := tx.Project.UpdateOneID(projectID).SetObjective(payload.Objective).Exec(ctx); err != nil {
				return err
			}
		}
		return tx.RoadmapProposal.UpdateOneID(proposalID).SetStatus(ProposalAccepted).SetDecidedAt(s.now()).Exec(ctx)
	})
}

// NormalizeTitle is how a proposed phase is matched to an existing one:
// case-insensitive, with surrounding and repeated whitespace ignored. The
// review screen (src/features/projects/roadmap/roadmapModel.ts proposalDiff)
// matches the same way.
func NormalizeTitle(title string) string {
	return strings.ToLower(strings.Join(strings.Fields(title), " "))
}
