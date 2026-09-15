# ADR-0014: Orchestration Run Model

**Status:** Accepted
**Date:** 2026-09-15
**Relates to:** [ADR-0001](0001-sqlite-for-task-pipeline.md), [ADR-0002](0002-runner-slot-priority-model.md), [ADR-0003](0003-pluggable-spawners.md), [ADR-0009](0009-proc-leaf.md), `.agent-context/task-pipeline.md`

## Context

Phase 4 asks for an orchestration foundation — runs, stages, roles, handoffs, results, human
attention, failure, bounded retry and review loops, and recovery — leading eventually to
User → Project Manager → Developer → Reviewer → QA → READY.

An audit before designing anything new found that the task pipeline already is that substrate,
persisted and restart-safe:

| Phase 4 concept | Existing, persisted | Where |
|---|---|---|
| Run | `task` (objective, project, cwd/worktree, spawner, budgets, autonomy) | `ent/schema/task.go` |
| Execution / stage | `stage_run` (one row per stage attempt: pid, session, status, iteration, output, tokens, cost, timestamps) | `ent/schema/stage_run.go` |
| Role | the stage (`backlog`/`plan_review` plan, `implementation` develops, `self_review` reviews, `finalization` finalizes) | `pipeline/stage_handlers.go`, `stage_prompts.go` |
| Handoff | the stage's JSON output, fed into the next stage's prompt; schema-validated for `self_review` and `finalization` | `completion_detector.go::ValidateStageOutput`, `stage_prompts.go` |
| Artifact / result | `stage_run.output` (structured), worktree branch, commits | `session_reader.go`, `worktree.go` |
| Attention | `awaiting_user` runs, `permission_request` rows, capability decisions → the canonical Needs you queue | `sweeps.go`, `api/tasks/permission_request_routes.go`, `src/features/attention/queue.ts` |
| Failure | `stage_run.status = failed` with a server-written reason; infra vs schema vs budget classes | `transitions.go`, auto-requeue |
| Retry / review loop | `IterateTransition` (schema/feedback loop, bounded by `max_iterations`), `requeued` (infra, bounded by `maxAutoRetries`), plan loop bounded by `DefaultPlanIterationCap` | `types.go`, `orchestrator.go` |
| Concurrency bound | `maxParallelOrchestrators` runner slots, one running stage_run per task (DB partial unique index) | `scheduler.go`, V7 migration |
| Recovery | startup `recoverRunningStageRuns` + per-tick awaiting-user, orphan and requeue sweeps; `DecideRecovery` resumes by session or fails | `sweeps.go`, `orchestrator.go` |

Adding a parallel `run` / `execution` model would duplicate every row above and fork the
invariants that already hold (single writer, one running run per task, credential release on
terminal status). This ADR therefore records the Phase 4 run model **as a view over the task
pipeline**, the invariants it relies on, and the gaps later checkpoints close.

## Decision

### 1. Source of truth

Orchestration state is the dashboard-owned `task` + `stage_run` rows. It is never inferred from a
Claude transcript. The transcript is conversation evidence; the one sanctioned read of it is the
**final structured JSON block** of a finished stage, validated against that stage's schema before
the orchestrator acts on it. Prose is never parsed for state.

### 2. Canonical run states

Clients present one small vocabulary, derived from persisted fields only
(`src/utils/runState.ts`):

| Run state | Derived from |
|---|---|
| `queued` | task in `backlog`/`ready` with no open stage run |
| `preparing` | latest run `pending`, or `requeued` (waiting out a retry cooldown), or the previous stage `done` and the next not yet created |
| `running` | latest run `running` |
| `waiting_user` | latest run `awaiting_user` or `on_hold`, or the task is parked on pending permission requests |
| `succeeded` | task `done` |
| `failed` | latest run `failed` (the task stays on its stage; Retry is a user action) |
| `cancelled` | task `cancelled` |

A run never becomes `succeeded` because a process disappeared: a dead PID is routed through
`DecideRecovery` (resume by session id, or fail), and completion requires a validated stage output.

### 3. Roles and the review loop

Roles are stages. The first executable slice is the existing `implementation` stage (Developer)
with its structured result; `self_review` is the Reviewer and `finalization` the QA/finalizer. The
review loop (Reviewer requests changes → Developer) is the existing `IterateTransition`, bounded by
`task.max_iterations` (default 20) and, for plans, `DefaultPlanIterationCap` (3). Infra retries
are bounded by `maxAutoRetries` (3) and rate-limit retries by `maxRateLimitRetries`. Concurrency is
bounded by `maxParallelOrchestrators` (3). There is no unbounded loop anywhere in the model.

### 4. Structured handoff

A handoff is a stage's structured output, not a forwarded transcript. Today
`ValidateStageOutput` enforces fields for two stages only — `self_review` (`passed`, `findings`,
`summary`) and `finalization` (`summary`, `insights`, `openTodos`, `testPlan`); other stages'
outputs are accepted as returned. The target contract every agent-driven stage converges on is:

```
objective        the task title/description the stage was given
projectId        task.project_id (optional — a run may be projectless)
workspace        task.worktree_path ?? task.cwd
role             the stage
summary          what the stage concluded
completedWork    what it did (implementation: changes; review: findings)
changedFiles     files touched, when the stage changes files
validation       tests/checks run and their results
risks, blockers  explicit lists
nextAction       the transition the orchestrator takes (next / iterate / wait_user / fail)
```

Context stays bounded: the next stage receives the previous stage's output plus the task, never
the prior conversation.

### 5. Human control

Everything that needs a person goes through the existing Needs you queue: permission requests,
capability decisions, `awaiting_user` runs (plan approval, escalations), folder trust for new
spawns. The pipeline never passes `--dangerously-skip-permissions`; `autonomy` only decides which
permission requests are auto-approved inside Claude Code's own permission system, and workspace
trust stays Claude's.

### 6. Ownership

Pipeline agents are launched by the dashboard for their stage run. The Phase 3 lifecycle routes
refuse them (`managedBy: pipeline` — stop or cancel the task instead), so a run's process is only
ever ended through its task. An external Claude session can never become a worker: the pipeline
only acts on PIDs it spawned and recorded on its own `stage_run`, and there is no route that
attaches an existing session to a task.

### 7. Failure categories

The canonical categories are `spawn_failed`, `permission_required`, `agent_failed`,
`agent_disappeared`, `workspace_unavailable`, `cancelled`, `timeout`, `invalid_result`. Today the
server persists the facts for `cancelled` (task stage), `permission_required` (awaiting_user /
pending requests), `invalid_result` (schema iteration → wait_user), `timeout` and
`agent_disappeared` (sweep reasons), but stores them as a free-text `output.error` reason. Clients
must not classify that text. Until a structured `failure_category` is persisted on `stage_run`,
the client reports `cancelled`, `permission_required` and a generic `agent_failed` only.

### 8. Observability

What is running, why, for which project, in which workspace, by which agent, at what stage, for how
long and at what cost is already answerable from `task` + `stage_run` (tokens, cost, timestamps,
pid/session) and the agents stream (`Agent.pipelineTaskId` links a live agent to its task).
Surfaces reuse Pipeline, Command's Active work and the agent workspace rather than adding a new
monitor.

## Consequences

- Phase 4B (Project Intelligence) and 4C (Resume Editor) need no orchestration changes.
- Phase 4D's smallest slice is a real task through the existing pipeline in a scratch workspace,
  presented with the canonical run states, not a new executor.
- Gaps recorded for later work: schema validation for the `backlog`, `plan_review` and
  `implementation` outputs; a persisted `failure_category` on `stage_run`; a Project Manager
  role above the task (decomposition into child tasks already has `parent_task_id`); an explicit
  handoff schema shared across stages rather than per-stage validators.
- Any future orchestration feature that is tempted to add a new run table must first show why a
  `task` + `stage_run` view cannot express it.
