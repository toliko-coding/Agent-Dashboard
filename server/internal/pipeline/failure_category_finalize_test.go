package pipeline_test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/lx-wnk/agent-dashboard/server/internal/db/ent"
	"github.com/lx-wnk/agent-dashboard/server/internal/db/repo"
	"github.com/lx-wnk/agent-dashboard/server/internal/pipeline"
)

// Phase 4.1: categories are set by the orchestrator where the failure is known;
// an invalid result gets exactly one retry, then waits for the user — never success.

func detectorReturning(res pipeline.CompletionResult) func(*ent.StageRun, string, pipeline.CompletionDeps) (pipeline.CompletionResult, error) {
	return func(*ent.StageRun, string, pipeline.CompletionDeps) (pipeline.CompletionResult, error) {
		return res, nil
	}
}

func categoryOf(t *testing.T, srRepo repo.StageRunRepo, id string) (string, string) {
	t.Helper()
	run, err := srRepo.GetByID(context.Background(), id)
	require.NoError(t, err)
	if run.FailureCategory == nil {
		return run.Status, ""
	}
	return run.Status, *run.FailureCategory
}

func TestFinalize_InvalidResult_BoundedRetryThenWaitsForUser(t *testing.T) {
	ctx := context.Background()
	orch, taskRepo, srRepo := makeOrchestratorWithSRRepo(t)
	task, first := makeRunningStageRunAtStage(t, ctx, taskRepo, srRepo, "invalid-result", "implementation")
	invalid := pipeline.CompletionResult{Kind: "failed", Retryable: true, Category: pipeline.FailureInvalidResult,
		Error: "agent did not produce a stage output block: it called neither set_stage_output nor emitted a ```json fence"}
	orch.SetCompletionDetector(detectorReturning(invalid))

	require.NoError(t, orch.FinalizeCompletedAsyncRunsForTest(ctx, []*ent.StageRun{first}))
	runs, err := srRepo.ListForTask(ctx, task.ID)
	require.NoError(t, err)
	require.Len(t, runs, 2, "the first invalid result is retried once, with the error quoted back")
	firstStatus, firstCategory := categoryOf(t, srRepo, first.ID)
	require.Equal(t, "done", firstStatus, "the iterated run is closed so its retry can start")
	require.Equal(t, pipeline.FailureInvalidResult, firstCategory, "a rejected output is never recorded as a plain success")

	var retry *ent.StageRun
	for _, r := range runs {
		if r.Iteration == 1 {
			retry = r
		}
	}
	require.NotNil(t, retry)
	deadPID, now := -1, time.Now()
	retry, err = srRepo.Update(ctx, retry.ID, repo.UpdateStageRunInput{Status: strPtr("running"), PID: &deadPID, StartedAt: &now})
	require.NoError(t, err)

	require.NoError(t, orch.FinalizeCompletedAsyncRunsForTest(ctx, []*ent.StageRun{retry}))
	status, category := categoryOf(t, srRepo, retry.ID)
	require.Equal(t, "awaiting_user", status, "the second invalid result goes to the user, not a third blind retry")
	require.Equal(t, pipeline.FailureInvalidResult, category)
	updated, err := taskRepo.GetByID(ctx, task.ID)
	require.NoError(t, err)
	require.Equal(t, "implementation", updated.CurrentStage, "an invalid result never advances the task")
}

func TestFinalize_CategoriesAtProducers(t *testing.T) {
	ctx := context.Background()

	t.Run("hard failure without a detector category is agent_failed", func(t *testing.T) {
		orch, taskRepo, srRepo := makeOrchestratorWithSRRepo(t)
		_, run := makeRunningStageRunAtStage(t, ctx, taskRepo, srRepo, "hard-fail", "implementation")
		orch.SetCompletionDetector(detectorReturning(pipeline.CompletionResult{Kind: "failed", Error: "boom"}))
		require.NoError(t, orch.FinalizeCompletedAsyncRunsForTest(ctx, []*ent.StageRun{run}))
		status, category := categoryOf(t, srRepo, run.ID)
		require.Equal(t, "failed", status)
		require.Equal(t, pipeline.FailureAgentFailed, category)
	})

	t.Run("a detector category is kept", func(t *testing.T) {
		orch, taskRepo, srRepo := makeOrchestratorWithSRRepo(t)
		_, run := makeRunningStageRunAtStage(t, ctx, taskRepo, srRepo, "spawn-fail", "implementation")
		orch.SetCompletionDetector(detectorReturning(pipeline.CompletionResult{Kind: "failed", Error: "never started", Category: pipeline.FailureSpawnFailed}))
		require.NoError(t, orch.FinalizeCompletedAsyncRunsForTest(ctx, []*ent.StageRun{run}))
		_, category := categoryOf(t, srRepo, run.ID)
		require.Equal(t, pipeline.FailureSpawnFailed, category)
	})

	t.Run("stage timeout", func(t *testing.T) {
		orch, taskRepo, srRepo := makeOrchestratorWithSRRepo(t)
		_, run := makeRunningStageRunAtStage(t, ctx, taskRepo, srRepo, "timeout-cat", "implementation")
		longAgo := time.Now().Add(-2 * time.Hour)
		run, err := srRepo.Update(ctx, run.ID, repo.UpdateStageRunInput{StartedAt: &longAgo})
		require.NoError(t, err)
		orch.SetCompletionDetector(detectorReturning(pipeline.CompletionResult{Kind: "still_running"}))
		require.NoError(t, orch.FinalizeCompletedAsyncRunsForTest(ctx, []*ent.StageRun{run}))
		status, category := categoryOf(t, srRepo, run.ID)
		require.Equal(t, "failed", status)
		require.Equal(t, pipeline.FailureTimeout, category)
	})

	t.Run("external cancel", func(t *testing.T) {
		orch, taskRepo, srRepo := makeOrchestratorWithSRRepo(t)
		_, run := makeRunningStageRunAtStage(t, ctx, taskRepo, srRepo, "cancel-cat", "cancelled")
		orch.SetCompletionDetector(detectorReturning(pipeline.CompletionResult{}))
		require.NoError(t, orch.FinalizeCompletedAsyncRunsForTest(ctx, []*ent.StageRun{run}))
		_, category := categoryOf(t, srRepo, run.ID)
		require.Equal(t, pipeline.FailureCancelled, category)
	})
}
