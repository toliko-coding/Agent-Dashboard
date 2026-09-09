// Package orchestration derives collaboration structure from data the
// pipeline already stores. It owns no table.
//
// An "orchestration" is a root task plus its descendant tree and the
// dependencies among those descendants. That is a VIEW: every field below is
// read from tasks, task_dependencies and stage runs, so there is nothing to
// keep in sync and nothing to migrate. A task created before this package
// existed is a valid orchestration of one.
//
// Nothing here infers collaboration. Two agents working in the same project,
// or on the same machine, are not an orchestration; only an explicit
// parent/child link or a stored dependency puts two tasks in the same graph.
package orchestration

import (
	"sort"

	"github.com/lx-wnk/agent-dashboard/server/internal/db/ent"
)

/*
 * maxDepth bounds traversal.
 *
 * parent_task_id is write-once in practice (the repo sets it only in Create),
 * but the schema does not declare it Immutable and nothing in the codebase
 * guards against a cycle. A derived view must therefore not assume the parent
 * chain terminates: a cycle introduced by a future update path, a bad import
 * or a hand-edited row would otherwise hang whichever request walked it.
 *
 * Both traversals below also carry a visited set, which is the real guard;
 * this is the second one, bounding pathological depth even in a valid tree.
 */
const maxDepth = 64

// TaskNode is one task in an orchestration tree.
type TaskNode struct {
	ID       string `json:"id"`
	Slug     string `json:"slug"`
	Title    string `json:"title"`
	Stage    string `json:"stage"`
	Priority string `json:"priority"`
	// ParentTaskID is nil for the root.
	ParentTaskID *string `json:"parentTaskId"`
	// DelegatedByStageRunID names the agent run that created this task, when
	// one did. Null is the honest value for a human-created task.
	DelegatedByStageRunID *string `json:"delegatedByStageRunId"`
	// SpawnerID is the role assigned to run this task; nil when unassigned.
	// This is NOT an agent identity — no agent identity is derived from a pid.
	SpawnerID *string `json:"spawnerId"`
	ProjectID *string `json:"projectId"`
	// Depth is derived from the parent chain, not stored. Root is 0.
	Depth int `json:"depth"`
}

// DependencyEdge is a stored task_dependency, reported only when BOTH ends are
// inside this orchestration — a dependency on an unrelated task is real, but it
// is not part of this graph and drawing it would imply a collaboration that was
// never expressed.
type DependencyEdge struct {
	ID            string `json:"id"`
	TaskID        string `json:"taskId"`
	DependsOnID   string `json:"dependsOnId"`
	RequiredStage string `json:"requiredStage"`
}

// Counts are computed from stored stage values only. There is no synthetic
// "healthy"/"at risk" verdict: the pipeline has no such concept.
type Counts struct {
	Total int `json:"total"`
	// Done counts tasks whose current stage is terminal-complete.
	Done int `json:"done"`
	// Cancelled is tracked apart from Done: both are terminal, but a cancelled
	// task did not deliver, and folding them together would overstate progress.
	Cancelled int `json:"cancelled"`
	// Blocked counts tasks on hold. Whether a hold came from an unmet
	// dependency is not stored, so this is not reported as "blocked by".
	Blocked int `json:"blocked"`
	// Active is everything not terminal and not on hold.
	Active int `json:"active"`
}

// Summary is one row of GET /api/orchestrations.
type Summary struct {
	RootTaskID string  `json:"rootTaskId"`
	Title      string  `json:"title"`
	Slug       string  `json:"slug"`
	ProjectID  *string `json:"projectId"`
	Counts     Counts  `json:"counts"`
	// SpawnerIDs are the distinct roles assigned across the tree, sorted.
	// Empty when no task in the tree names one.
	SpawnerIDs []string `json:"spawnerIds"`
	// Delegated is the number of tasks carrying provenance. Zero today for
	// every orchestration, because no caller can yet set it.
	Delegated int    `json:"delegated"`
	UpdatedAt string `json:"updatedAt"`
}

// Detail is GET /api/orchestrations/{rootTaskId}.
type Detail struct {
	Summary
	Tasks        []TaskNode       `json:"tasks"`
	Dependencies []DependencyEdge `json:"dependencies"`
}

// Terminal and hold stages, matching pipeline.StageOrder's endpoints. Kept as
// a small local set rather than importing the pipeline package, which would
// pull the orchestrator into every consumer of this view.
const (
	stageDone      = "done"
	stageCancelled = "cancelled"
	stageOnHold    = "on_hold"
)

// IsRoot reports whether a task starts an orchestration: it has no parent.
func IsRoot(t *ent.Task) bool {
	return t.ParentTaskID == nil || *t.ParentTaskID == ""
}

// childIndex groups tasks by parent id.
func childIndex(tasks []*ent.Task) map[string][]*ent.Task {
	out := make(map[string][]*ent.Task, len(tasks))
	for _, t := range tasks {
		if t.ParentTaskID == nil || *t.ParentTaskID == "" {
			continue
		}
		out[*t.ParentTaskID] = append(out[*t.ParentTaskID], t)
	}
	return out
}

// Tree returns the root and every descendant, each with its derived depth,
// ordered parent-before-child then by creation time.
//
// A task is visited at most once: with a visited set, a cycle yields a
// truncated tree instead of an unbounded walk. Truncating is the right failure
// here — a view that hangs is worse than one that shows less.
func Tree(root *ent.Task, all []*ent.Task) []TaskNode {
	byParent := childIndex(all)
	visited := make(map[string]bool, len(all))
	out := make([]TaskNode, 0, 8)

	var walk func(t *ent.Task, depth int)
	walk = func(t *ent.Task, depth int) {
		if t == nil || visited[t.ID] || depth > maxDepth {
			return
		}
		visited[t.ID] = true
		out = append(out, node(t, depth))

		kids := byParent[t.ID]
		sort.SliceStable(kids, func(i, j int) bool {
			return kids[i].CreatedAt.Before(kids[j].CreatedAt)
		})
		for _, k := range kids {
			walk(k, depth+1)
		}
	}
	walk(root, 0)
	return out
}

func node(t *ent.Task, depth int) TaskNode {
	return TaskNode{
		ID:                    t.ID,
		Slug:                  t.Slug,
		Title:                 t.Title,
		Stage:                 t.CurrentStage,
		Priority:              t.Priority,
		ParentTaskID:          t.ParentTaskID,
		DelegatedByStageRunID: t.DelegatedByStageRunID,
		SpawnerID:             t.SpawnerID,
		ProjectID:             t.ProjectID,
		Depth:                 depth,
	}
}

// RootIDOf walks up to the orchestration root a task belongs to.
//
// Returns the task's own id when it has no parent. A cycle or a parent that no
// longer exists resolves to the last task actually reached, so the caller
// always gets a usable root rather than an error or a hang.
func RootIDOf(t *ent.Task, byID map[string]*ent.Task) string {
	visited := make(map[string]bool, 8)
	cur := t
	for i := 0; i < maxDepth; i++ {
		if cur == nil || visited[cur.ID] {
			break
		}
		visited[cur.ID] = true
		if cur.ParentTaskID == nil || *cur.ParentTaskID == "" {
			return cur.ID
		}
		next, ok := byID[*cur.ParentTaskID]
		if !ok {
			// Parent deleted: this task is the highest reachable point, so it
			// is the root of what remains rather than a dangling reference.
			return cur.ID
		}
		cur = next
	}
	if cur != nil {
		return cur.ID
	}
	return t.ID
}

// CountsOf tallies stored stages. Nothing is inferred.
func CountsOf(nodes []TaskNode) Counts {
	c := Counts{Total: len(nodes)}
	for _, n := range nodes {
		switch n.Stage {
		case stageDone:
			c.Done++
		case stageCancelled:
			c.Cancelled++
		case stageOnHold:
			c.Blocked++
		default:
			c.Active++
		}
	}
	return c
}

// EdgesWithin keeps only dependencies whose BOTH ends are in the tree.
func EdgesWithin(nodes []TaskNode, deps []*ent.TaskDependency) []DependencyEdge {
	inTree := make(map[string]bool, len(nodes))
	for _, n := range nodes {
		inTree[n.ID] = true
	}
	out := make([]DependencyEdge, 0, len(deps))
	for _, d := range deps {
		if inTree[d.TaskID] && inTree[d.DependsOnID] {
			out = append(out, DependencyEdge{
				ID:            d.ID,
				TaskID:        d.TaskID,
				DependsOnID:   d.DependsOnID,
				RequiredStage: d.RequiredStage,
			})
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// SummaryOf builds the list row for a root and its tree.
func SummaryOf(root *ent.Task, nodes []TaskNode) Summary {
	spawners := map[string]bool{}
	delegated := 0
	for _, n := range nodes {
		if n.SpawnerID != nil && *n.SpawnerID != "" {
			spawners[*n.SpawnerID] = true
		}
		if n.DelegatedByStageRunID != nil && *n.DelegatedByStageRunID != "" {
			delegated++
		}
	}
	ids := make([]string, 0, len(spawners))
	for id := range spawners {
		ids = append(ids, id)
	}
	sort.Strings(ids)

	return Summary{
		RootTaskID: root.ID,
		Title:      root.Title,
		Slug:       root.Slug,
		ProjectID:  root.ProjectID,
		Counts:     CountsOf(nodes),
		SpawnerIDs: ids,
		Delegated:  delegated,
		UpdatedAt:  root.UpdatedAt.UTC().Format("2006-01-02T15:04:05Z"),
	}
}
