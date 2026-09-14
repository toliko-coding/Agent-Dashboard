package repo

import (
	"context"
	"fmt"

	"github.com/lx-wnk/agent-dashboard/server/internal/db/ent"
	"github.com/lx-wnk/agent-dashboard/server/internal/db/ent/agentprofile"
)

// AgentProfileRow is one agent's presentation metadata, keyed by session id.
type AgentProfileRow struct {
	SessionID   string
	DisplayName string
	Category    string
}

// AgentProfileRepo reads and writes the agent_profile table.
type AgentProfileRepo interface {
	// Upsert creates or replaces the profile for a session.
	Upsert(ctx context.Context, row AgentProfileRow) error
	// List returns every stored profile.
	List(ctx context.Context) ([]AgentProfileRow, error)
	// Delete removes a session's profile; a missing one is not an error.
	Delete(ctx context.Context, sessionID string) error
}

type entAgentProfileRepo struct{ client *ent.Client }

// NewAgentProfileRepo creates an AgentProfileRepo backed by the given ent client.
func NewAgentProfileRepo(client *ent.Client) AgentProfileRepo {
	return &entAgentProfileRepo{client: client}
}

func (r *entAgentProfileRepo) Upsert(ctx context.Context, row AgentProfileRow) error {
	err := r.client.AgentProfile.Create().
		SetID(row.SessionID).
		SetDisplayName(row.DisplayName).
		SetCategory(row.Category).
		OnConflictColumns(agentprofile.FieldID).
		UpdateDisplayName().
		UpdateCategory().
		UpdateUpdatedAt().
		Exec(ctx)
	if err != nil {
		return fmt.Errorf("agentprofile.Upsert: %w", err)
	}
	return nil
}

func (r *entAgentProfileRepo) List(ctx context.Context) ([]AgentProfileRow, error) {
	rows, err := r.client.AgentProfile.Query().All(ctx)
	if err != nil {
		return nil, fmt.Errorf("agentprofile.List: %w", err)
	}
	out := make([]AgentProfileRow, 0, len(rows))
	for _, p := range rows {
		out = append(out, AgentProfileRow{SessionID: p.ID, DisplayName: p.DisplayName, Category: p.Category})
	}
	return out, nil
}

func (r *entAgentProfileRepo) Delete(ctx context.Context, sessionID string) error {
	if err := r.client.AgentProfile.DeleteOneID(sessionID).Exec(ctx); err != nil && !ent.IsNotFound(err) {
		return fmt.Errorf("agentprofile.Delete: %w", err)
	}
	return nil
}
