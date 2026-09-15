package pipeline

// Failure categories (Phase 4.1, ADR-0014 §7) persisted on stage_run.failure_category.
// Each is set where the failure is known — a producer in the orchestrator,
// sweeps, progress guards or completion detector — never inferred from error
// text afterwards. output.error keeps the human-readable reason. A failure no
// producer classifies (a budget or iteration limit) stays unclassified.
const (
	FailureSpawnFailed          = "spawn_failed"
	FailurePermissionRequired   = "permission_required"
	FailureAgentFailed          = "agent_failed"
	FailureAgentDisappeared     = "agent_disappeared"
	FailureWorkspaceUnavailable = "workspace_unavailable"
	FailureTimeout              = "timeout"
	FailureInvalidResult        = "invalid_result"
	FailureCancelled            = "cancelled"
)

// resultCategory is the category of a failed completion, agent_failed when the
// detector did not name one.
func resultCategory(r CompletionResult) string {
	if r.Category != "" {
		return r.Category
	}
	return FailureAgentFailed
}
