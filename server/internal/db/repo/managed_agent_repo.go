package repo

import (
	"context"
	"fmt"

	"github.com/lx-wnk/agent-dashboard/server/internal/db/ent"
	"github.com/lx-wnk/agent-dashboard/server/internal/db/ent/managedagent"
)

// ManagedAgentRow is one dashboard-launched agent, keyed by session id.
type ManagedAgentRow struct {
	SessionID        string
	PID              int
	Cwd              string
	WorkspaceCreated bool
	AllowedFolder    string
}

// ManagedAgentRepo reads and writes the managed_agent table.
type ManagedAgentRepo interface {
	Upsert(ctx context.Context, row ManagedAgentRow) error
	List(ctx context.Context) ([]ManagedAgentRow, error)
	// Delete removes a session's record; a missing one is not an error.
	Delete(ctx context.Context, sessionID string) error
}

type entManagedAgentRepo struct{ client *ent.Client }

// NewManagedAgentRepo creates a ManagedAgentRepo backed by the given ent client.
func NewManagedAgentRepo(client *ent.Client) ManagedAgentRepo {
	return &entManagedAgentRepo{client: client}
}

func (r *entManagedAgentRepo) Upsert(ctx context.Context, row ManagedAgentRow) error {
	err := r.client.ManagedAgent.Create().
		SetID(row.SessionID).
		SetPid(row.PID).
		SetCwd(row.Cwd).
		SetWorkspaceCreated(row.WorkspaceCreated).
		SetAllowedFolder(row.AllowedFolder).
		OnConflictColumns(managedagent.FieldID).
		UpdatePid().
		UpdateCwd().
		UpdateWorkspaceCreated().
		UpdateAllowedFolder().
		UpdateUpdatedAt().
		Exec(ctx)
	if err != nil {
		return fmt.Errorf("managedagent.Upsert: %w", err)
	}
	return nil
}

func (r *entManagedAgentRepo) List(ctx context.Context) ([]ManagedAgentRow, error) {
	rows, err := r.client.ManagedAgent.Query().All(ctx)
	if err != nil {
		return nil, fmt.Errorf("managedagent.List: %w", err)
	}
	out := make([]ManagedAgentRow, 0, len(rows))
	for _, m := range rows {
		out = append(out, ManagedAgentRow{SessionID: m.ID, PID: m.Pid, Cwd: m.Cwd, WorkspaceCreated: m.WorkspaceCreated, AllowedFolder: m.AllowedFolder})
	}
	return out, nil
}

func (r *entManagedAgentRepo) Delete(ctx context.Context, sessionID string) error {
	if err := r.client.ManagedAgent.DeleteOneID(sessionID).Exec(ctx); err != nil && !ent.IsNotFound(err) {
		return fmt.Errorf("managedagent.Delete: %w", err)
	}
	return nil
}
