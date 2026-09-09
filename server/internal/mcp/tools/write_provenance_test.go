package tools

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	mcp "github.com/lx-wnk/agent-dashboard/server/internal/mcp"
)

// createTaskID runs create_task with the given context and returns the new id.
func createTaskID(t *testing.T, ctx context.Context, registry mcp.ToolRegistry, args map[string]any) string {
	t.Helper()
	tool, ok := registry["create_task"]
	require.True(t, ok, "create_task not registered")
	result, err := tool.Handler(ctx, args)
	require.NoError(t, err)
	taskMap, _ := toolResultJSON(t, result)["task"].(map[string]any)
	require.NotNil(t, taskMap)
	id, _ := taskMap["id"].(string)
	require.NotEmpty(t, id)
	return id
}

// A task created by a user key carries no provenance. Null is the honest
// value: nobody delegated this work, and inventing an agent for it would make
// the orchestration view claim a collaboration that never happened.
func TestCreateTask_UserKeyLeavesProvenanceNull(t *testing.T) {
	deps := newWriteDepsForTest(t)
	registry := mcp.ToolRegistry{}
	RegisterWriteTools(registry, deps)

	ctx := mcp.ContextWithAuth(context.Background(), &mcp.MCPAuthInfo{KeyID: "key-user"})
	id := createTaskID(t, ctx, registry, map[string]any{
		"slug":  "prov-user-key",
		"title": "User key task",
		"cwd":   "/tmp/prov-user-key",
	})

	task, err := deps.TaskRepo.GetByID(context.Background(), id)
	require.NoError(t, err)
	require.Nil(t, task.DelegatedByStageRunID)
}

// Provenance comes from the caller's own stage-run credential.
func TestCreateTask_StageRunKeyRecordsItsOwnRun(t *testing.T) {
	deps := newWriteDepsForTest(t)
	registry := mcp.ToolRegistry{}
	RegisterWriteTools(registry, deps)

	ctx := mcp.ContextWithAuth(context.Background(), &mcp.MCPAuthInfo{
		KeyID:      "key-stage",
		StageRunID: "run-7",
	})
	id := createTaskID(t, ctx, registry, map[string]any{
		"slug":  "prov-stage-key",
		"title": "Stage run task",
		"cwd":   "/tmp/prov-stage-key",
	})

	task, err := deps.TaskRepo.GetByID(context.Background(), id)
	require.NoError(t, err)
	require.NotNil(t, task.DelegatedByStageRunID)
	require.Equal(t, "run-7", *task.DelegatedByStageRunID)
}

// The request body cannot claim provenance. If it could, any caller could
// attribute its work to another agent's run and the audit trail would be
// worthless — so the argument is ignored entirely, not merely validated.
func TestCreateTask_IgnoresProvenanceFromArgs(t *testing.T) {
	deps := newWriteDepsForTest(t)
	registry := mcp.ToolRegistry{}
	RegisterWriteTools(registry, deps)

	ctx := mcp.ContextWithAuth(context.Background(), &mcp.MCPAuthInfo{KeyID: "key-user"})
	id := createTaskID(t, ctx, registry, map[string]any{
		"slug":                      "prov-spoof",
		"title":                     "Spoof attempt",
		"cwd":                       "/tmp/prov-spoof",
		"delegatedByStageRunId":     "run-someone-else",
		"delegated_by_stage_run_id": "run-someone-else",
	})

	task, err := deps.TaskRepo.GetByID(context.Background(), id)
	require.NoError(t, err)
	require.Nil(t, task.DelegatedByStageRunID,
		"provenance must come from the credential, never from arguments")
}

// A stage-run caller cannot overwrite its own attribution either: the context
// wins over anything the arguments say.
func TestCreateTask_ArgsCannotOverrideStageRunProvenance(t *testing.T) {
	deps := newWriteDepsForTest(t)
	registry := mcp.ToolRegistry{}
	RegisterWriteTools(registry, deps)

	ctx := mcp.ContextWithAuth(context.Background(), &mcp.MCPAuthInfo{
		KeyID:      "key-stage",
		StageRunID: "run-real",
	})
	id := createTaskID(t, ctx, registry, map[string]any{
		"slug":                  "prov-override",
		"title":                 "Override attempt",
		"cwd":                   "/tmp/prov-override",
		"delegatedByStageRunId": "run-claimed",
	})

	task, err := deps.TaskRepo.GetByID(context.Background(), id)
	require.NoError(t, err)
	require.NotNil(t, task.DelegatedByStageRunID)
	require.Equal(t, "run-real", *task.DelegatedByStageRunID)
}

// An unauthenticated call (no MCP auth in context) must not panic or invent a
// run id. Provenance stays null.
func TestCreateTask_NoAuthContextLeavesProvenanceNull(t *testing.T) {
	deps := newWriteDepsForTest(t)
	registry := mcp.ToolRegistry{}
	RegisterWriteTools(registry, deps)

	id := createTaskID(t, context.Background(), registry, map[string]any{
		"slug":  "prov-no-auth",
		"title": "No auth",
		"cwd":   "/tmp/prov-no-auth",
	})

	task, err := deps.TaskRepo.GetByID(context.Background(), id)
	require.NoError(t, err)
	require.Nil(t, task.DelegatedByStageRunID)
}
