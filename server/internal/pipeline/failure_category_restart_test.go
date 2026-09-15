package pipeline_test

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/lx-wnk/agent-dashboard/server/internal/db"
	"github.com/lx-wnk/agent-dashboard/server/internal/db/ent"
	"github.com/lx-wnk/agent-dashboard/server/internal/db/repo"
	"github.com/lx-wnk/agent-dashboard/server/internal/pipeline"
)

// Phase 4.1: a failure category is persisted with the run, and a restart (a new
// process over the same database) neither loses it nor turns the stage into a
// success.
func TestFailureCategory_PersistsAcrossRestart(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "tasks.db")

	open := func() (*pipeline.PipelineOrchestrator, *ent.Client) {
		bundle, err := db.Open(path)
		require.NoError(t, err)
		c := bundle.Client
		orch, err := pipeline.NewOrchestrator(pipeline.OrchestratorOptions{
			TaskRepo: repo.NewTaskRepo(c), StageRunRepo: repo.NewStageRunRepo(c), PermissionRepo: repo.NewPermissionRepo(c),
			AuditRepo: repo.NewAuditEventRepo(c), ConfigRepo: repo.NewPipelineConfigRepo(c),
		})
		require.NoError(t, err)
		return orch, c
	}

	orch, c1 := open()
	taskRepo := repo.NewTaskRepo(c1)
	orch.SetHandlerOverride("implementation", &stubStageHandler{
		stage:      "implementation",
		transition: pipeline.FailTransition{Reason: "workspace refused: sensitive folder", Category: pipeline.FailureWorkspaceUnavailable},
	})
	task, err := taskRepo.Create(ctx, repo.CreateTaskInput{
		Slug: "restart-cat", Title: "Restart", Cwd: "/tmp", CurrentStage: "implementation",
		Priority: "medium", MaxIterations: 3, StageTimeoutSeconds: 1800,
	})
	require.NoError(t, err)
	sr, err := orch.ProgressTask(ctx, task.ID, nil)
	require.NoError(t, err)
	require.Equal(t, "failed", sr.Status)
	_ = c1.Close()

	_, c2 := open()
	defer func() { _ = c2.Close() }()
	taskRepo2 := repo.NewTaskRepo(c2)
	srRepo2 := repo.NewStageRunRepo(c2)
	again, err := srRepo2.GetByID(ctx, sr.ID)
	require.NoError(t, err)
	require.Equal(t, "failed", again.Status)
	require.NotNil(t, again.FailureCategory)
	require.Equal(t, pipeline.FailureWorkspaceUnavailable, *again.FailureCategory)
	require.Equal(t, "workspace refused: sensitive folder", again.Output["error"], "the human reason is kept separately")
	reloaded, err := taskRepo2.GetByID(ctx, task.ID)
	require.NoError(t, err)
	require.Equal(t, "implementation", reloaded.CurrentStage, "a restart never advances a failed stage")
}
