package repo

import (
	"context"
	"fmt"

	"github.com/lx-wnk/agent-dashboard/server/internal/db/ent"
	"github.com/lx-wnk/agent-dashboard/server/internal/db/ent/dashboardagent"
)

// DashboardAgentRow is one durable agent: what the user configured, keyed by an
// id of its own rather than by the session currently running it.
type DashboardAgentRow struct {
	ID             string
	DisplayName    string
	Category       string
	Instructions   string
	PermissionMode string
	Cwd            string
	ProjectID      string
	Role           string
	SessionID      string
}

// DashboardAgentRepo reads and writes the dashboard_agent table.
type DashboardAgentRepo interface {
	// Upsert creates or replaces one agent row.
	Upsert(ctx context.Context, row DashboardAgentRow) error
	// List returns every stored agent.
	List(ctx context.Context) ([]DashboardAgentRow, error)
	// Delete removes an agent row; a missing one is not an error.
	Delete(ctx context.Context, id string) error
}

type entDashboardAgentRepo struct{ client *ent.Client }

// NewDashboardAgentRepo creates a DashboardAgentRepo over the given ent client.
func NewDashboardAgentRepo(client *ent.Client) DashboardAgentRepo {
	return &entDashboardAgentRepo{client: client}
}

func (r *entDashboardAgentRepo) Upsert(ctx context.Context, row DashboardAgentRow) error {
	err := r.client.DashboardAgent.Create().
		SetID(row.ID).
		SetDisplayName(row.DisplayName).
		SetCategory(row.Category).
		SetInstructions(row.Instructions).
		SetPermissionMode(row.PermissionMode).
		SetCwd(row.Cwd).
		SetProjectID(row.ProjectID).
		SetRole(row.Role).
		SetSessionID(row.SessionID).
		OnConflictColumns(dashboardagent.FieldID).
		UpdateDisplayName().
		UpdateCategory().
		UpdateInstructions().
		UpdatePermissionMode().
		UpdateCwd().
		UpdateProjectID().
		UpdateRole().
		UpdateSessionID().
		UpdateUpdatedAt().
		Exec(ctx)
	if err != nil {
		return fmt.Errorf("dashboardagent.Upsert: %w", err)
	}
	return nil
}

func (r *entDashboardAgentRepo) List(ctx context.Context) ([]DashboardAgentRow, error) {
	rows, err := r.client.DashboardAgent.Query().All(ctx)
	if err != nil {
		return nil, fmt.Errorf("dashboardagent.List: %w", err)
	}
	out := make([]DashboardAgentRow, 0, len(rows))
	for _, a := range rows {
		out = append(out, DashboardAgentRow{
			ID:             a.ID,
			DisplayName:    a.DisplayName,
			Category:       a.Category,
			Instructions:   a.Instructions,
			PermissionMode: a.PermissionMode,
			Cwd:            a.Cwd,
			ProjectID:      a.ProjectID,
			Role:           a.Role,
			SessionID:      a.SessionID,
		})
	}
	return out, nil
}

func (r *entDashboardAgentRepo) Delete(ctx context.Context, id string) error {
	if err := r.client.DashboardAgent.DeleteOneID(id).Exec(ctx); err != nil && !ent.IsNotFound(err) {
		return fmt.Errorf("dashboardagent.Delete: %w", err)
	}
	return nil
}
