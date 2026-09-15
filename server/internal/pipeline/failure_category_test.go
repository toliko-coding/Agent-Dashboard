package pipeline_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/lx-wnk/agent-dashboard/server/internal/db/ent"
	"github.com/lx-wnk/agent-dashboard/server/internal/pipeline"
)

// Phase 4.1: the completion detector names the failure category where the
// failure is known, and the Developer handoff is structured — prose is not success.

func implementationOutput(extra map[string]any) map[string]any {
	out := map[string]any{
		"summary": "done", "completedWork": []any{"added the check"}, "changedFiles": []any{},
		"validation": []any{"go test ./... — pass"}, "risks": []any{}, "blockers": []any{}, "nextAction": "review",
	}
	for k, v := range extra {
		out[k] = v
	}
	return out
}

func detect(t *testing.T, sr *ent.StageRun, read pipeline.StageOutputRead) pipeline.CompletionResult {
	t.Helper()
	res, err := pipeline.DetectCompletion(sr, "/tmp", pipeline.CompletionDeps{
		IsPidAlive: func(int) bool { return false },
		ReadOutput: func(string, string) (pipeline.StageOutputRead, error) { return read, nil },
	})
	require.NoError(t, err)
	return res
}

func TestDetectCompletion_Categories(t *testing.T) {
	now := time.Now()
	sid := "sess"

	noSession, err := pipeline.DetectCompletion(stageRun("implementation", ptr(0), nil, &now), "/tmp", pipeline.CompletionDeps{
		IsPidAlive:  func(int) bool { return false },
		FindSession: func(string, string) (string, error) { return "", nil },
	})
	require.NoError(t, err)
	require.Equal(t, pipeline.FailureAgentDisappeared, noSession.Category)

	neverStarted, err := pipeline.DetectCompletion(stageRun("implementation", ptr(0), nil, nil), "/tmp", pipeline.CompletionDeps{IsPidAlive: func(int) bool { return false }})
	require.NoError(t, err)
	require.Equal(t, "failed", neverStarted.Kind)
	require.Equal(t, pipeline.FailureSpawnFailed, neverStarted.Category)

	prose := detect(t, stageRun("implementation", ptr(0), &sid, &now), pipeline.StageOutputRead{RawText: "All done! I implemented everything."})
	require.Equal(t, "failed", prose.Kind, "prose without a structured result is not success")
	require.True(t, prose.Retryable, "invalid results get the bounded retry")
	require.Equal(t, pipeline.FailureInvalidResult, prose.Category)
}

func TestDeveloperHandoff_Schema(t *testing.T) {
	now := time.Now()
	sid := "sess"
	sr := stageRun("implementation", ptr(0), &sid, &now)

	ok := detect(t, sr, pipeline.StageOutputRead{Output: implementationOutput(nil)})
	require.Equal(t, "completed", ok.Kind, "a task that changed no files reports changedFiles: [] and succeeds")

	legacy := detect(t, sr, pipeline.StageOutputRead{Output: map[string]any{"summary": "done", "commits": []any{}, "openItems": []any{}}})
	require.Equal(t, "failed", legacy.Kind)
	require.Equal(t, pipeline.FailureInvalidResult, legacy.Category)
	require.Contains(t, legacy.Error, "completedWork")

	for field, bad := range map[string]any{
		"changedFiles": []any{"a.go", 7},
		"validation":   "ran tests",
		"nextAction":   []any{"review"},
		"summary":      nil,
	} {
		res := detect(t, sr, pipeline.StageOutputRead{Output: implementationOutput(map[string]any{field: bad})})
		require.Equal(t, "failed", res.Kind, field)
		require.Equal(t, pipeline.FailureInvalidResult, res.Category, field)
		require.Contains(t, res.Error, field)
	}

	v := pipeline.ValidateStageOutput("implementation", implementationOutput(map[string]any{"changedFiles": []any{"server/x.go"}}))
	require.True(t, v.OK)
}
