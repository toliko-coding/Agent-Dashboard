package orchestration_test

import (
	"testing"
	"time"

	"github.com/lx-wnk/agent-dashboard/server/internal/db/ent"
	"github.com/lx-wnk/agent-dashboard/server/internal/orchestration"
)

var base = time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

// task builds an ent.Task struct directly. These tests exercise pure derivation
// over in-memory rows, so no database is involved — the handler tests below
// cover the query path.
func task(id string, parent *string, opts ...func(*ent.Task)) *ent.Task {
	t := &ent.Task{
		ID:           id,
		Slug:         id,
		Title:        id,
		CurrentStage: "backlog",
		Priority:     "medium",
		ParentTaskID: parent,
		CreatedAt:    base,
		UpdatedAt:    base,
	}
	for _, o := range opts {
		o(t)
	}
	return t
}

func ptr(s string) *string { return &s }

func createdAt(offset time.Duration) func(*ent.Task) {
	return func(t *ent.Task) { t.CreatedAt = base.Add(offset) }
}

func stage(s string) func(*ent.Task) {
	return func(t *ent.Task) { t.CurrentStage = s }
}

func ids(nodes []orchestration.TaskNode) []string {
	out := make([]string, 0, len(nodes))
	for _, n := range nodes {
		out = append(out, n.ID)
	}
	return out
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// 1. A root with no children is still a valid orchestration — of exactly one
// node. The list endpoint hides it; the derivation must not.
func TestTree_RootWithoutChildren(t *testing.T) {
	root := task("root", nil)
	nodes := orchestration.Tree(root, []*ent.Task{root})
	if len(nodes) != 1 {
		t.Fatalf("expected 1 node, got %d", len(nodes))
	}
	if nodes[0].Depth != 0 {
		t.Fatalf("root depth = %d, want 0", nodes[0].Depth)
	}
	if nodes[0].ParentTaskID != nil {
		t.Fatalf("root parentTaskId = %v, want nil", *nodes[0].ParentTaskID)
	}
}

// 2. Children come back after their parent, oldest first.
func TestTree_MultipleChildrenOrderedByCreation(t *testing.T) {
	root := task("root", nil)
	// Deliberately supplied newest-first so a passing result cannot come from
	// the input order.
	b := task("b", ptr("root"), createdAt(2*time.Minute))
	a := task("a", ptr("root"), createdAt(time.Minute))
	nodes := orchestration.Tree(root, []*ent.Task{root, b, a})

	if got := ids(nodes); !equal(got, []string{"root", "a", "b"}) {
		t.Fatalf("order = %v, want [root a b]", got)
	}
	for _, n := range nodes[1:] {
		if n.Depth != 1 {
			t.Fatalf("%s depth = %d, want 1", n.ID, n.Depth)
		}
	}
}

// 3. Depth is derived from the parent chain, not stored.
func TestTree_GrandchildDepth(t *testing.T) {
	root := task("root", nil)
	child := task("child", ptr("root"))
	grand := task("grand", ptr("child"))
	nodes := orchestration.Tree(root, []*ent.Task{root, child, grand})

	if got := ids(nodes); !equal(got, []string{"root", "child", "grand"}) {
		t.Fatalf("order = %v, want parent before child", got)
	}
	if nodes[2].Depth != 2 {
		t.Fatalf("grandchild depth = %d, want 2", nodes[2].Depth)
	}
}

// 4. A hierarchy that predates this package reads correctly: nothing about a
// task needs to be written for it to belong to an orchestration.
func TestTree_ExistingHierarchyWithoutProvenance(t *testing.T) {
	root := task("root", nil)
	child := task("child", ptr("root"))
	nodes := orchestration.Tree(root, []*ent.Task{root, child})

	for _, n := range nodes {
		if n.DelegatedByStageRunID != nil {
			t.Fatalf("%s: expected nil provenance, got %q", n.ID, *n.DelegatedByStageRunID)
		}
	}
	if orchestration.SummaryOf(root, nodes).Delegated != 0 {
		t.Fatal("delegated count should be 0 when no task carries provenance")
	}
}

// 5. Provenance is reported when present and counted in the summary.
func TestSummary_CountsDelegatedTasks(t *testing.T) {
	root := task("root", nil)
	child := task("child", ptr("root"), func(x *ent.Task) {
		x.DelegatedByStageRunID = ptr("run-1")
	})
	nodes := orchestration.Tree(root, []*ent.Task{root, child})

	if nodes[1].DelegatedByStageRunID == nil || *nodes[1].DelegatedByStageRunID != "run-1" {
		t.Fatalf("child provenance = %v, want run-1", nodes[1].DelegatedByStageRunID)
	}
	if got := orchestration.SummaryOf(root, nodes).Delegated; got != 1 {
		t.Fatalf("delegated = %d, want 1", got)
	}
}

// A cycle must truncate rather than hang. parent_task_id has no cycle guard in
// the schema, so a derived view cannot assume the chain terminates.
func TestTree_CycleTerminates(t *testing.T) {
	a := task("a", ptr("b"))
	b := task("b", ptr("a"))
	nodes := orchestration.Tree(a, []*ent.Task{a, b})
	if len(nodes) != 2 {
		t.Fatalf("expected the cycle to be visited once each, got %d nodes", len(nodes))
	}
}

func TestRootIDOf(t *testing.T) {
	root := task("root", nil)
	child := task("child", ptr("root"))
	grand := task("grand", ptr("child"))
	byID := map[string]*ent.Task{"root": root, "child": child, "grand": grand}

	if got := orchestration.RootIDOf(grand, byID); got != "root" {
		t.Fatalf("RootIDOf(grand) = %q, want root", got)
	}
	if got := orchestration.RootIDOf(root, byID); got != "root" {
		t.Fatalf("RootIDOf(root) = %q, want root", got)
	}

	// A parent that no longer exists resolves to the highest task actually
	// reached, so the caller still gets a usable id.
	orphan := task("orphan", ptr("gone"))
	if got := orchestration.RootIDOf(orphan, map[string]*ent.Task{"orphan": orphan}); got != "orphan" {
		t.Fatalf("RootIDOf(orphan) = %q, want orphan", got)
	}
}

func TestCountsOf_UsesStoredStagesOnly(t *testing.T) {
	root := task("root", nil)
	all := []*ent.Task{
		root,
		task("d", ptr("root"), stage("done"), createdAt(time.Minute)),
		task("c", ptr("root"), stage("cancelled"), createdAt(2*time.Minute)),
		task("h", ptr("root"), stage("on_hold"), createdAt(3*time.Minute)),
		task("a", ptr("root"), stage("ready"), createdAt(4*time.Minute)),
	}
	c := orchestration.CountsOf(orchestration.Tree(root, all))

	// Cancelled is counted apart from done: both are terminal, but folding them
	// together would report work as delivered that never was.
	want := orchestration.Counts{Total: 5, Done: 1, Cancelled: 1, Blocked: 1, Active: 2}
	if c != want {
		t.Fatalf("counts = %+v, want %+v", c, want)
	}
}

// 6. Sibling dependencies inside one orchestration are reported.
func TestEdgesWithin_KeepsSiblingDependency(t *testing.T) {
	nodes := orchestration.Tree(task("root", nil), []*ent.Task{
		task("root", nil),
		task("a", ptr("root")),
		task("b", ptr("root"), createdAt(time.Minute)),
	})
	deps := []*ent.TaskDependency{
		{ID: "d1", TaskID: "b", DependsOnID: "a", RequiredStage: "done"},
	}
	edges := orchestration.EdgesWithin(nodes, deps)
	if len(edges) != 1 || edges[0].TaskID != "b" || edges[0].DependsOnID != "a" {
		t.Fatalf("edges = %+v, want one b→a edge", edges)
	}
}

// 7. A dependency on a task outside the tree is real, but it is not part of
// this graph — drawing it would imply a collaboration nobody expressed.
func TestEdgesWithin_DropsDependencyLeavingTheTree(t *testing.T) {
	nodes := orchestration.Tree(task("root", nil), []*ent.Task{
		task("root", nil),
		task("a", ptr("root")),
	})
	deps := []*ent.TaskDependency{
		{ID: "d1", TaskID: "a", DependsOnID: "stranger", RequiredStage: "done"},
	}
	if got := orchestration.EdgesWithin(nodes, deps); len(got) != 0 {
		t.Fatalf("edges = %+v, want none", got)
	}
}

// Nested dependencies (across depths within one tree) are kept.
func TestEdgesWithin_KeepsNestedDependency(t *testing.T) {
	nodes := orchestration.Tree(task("root", nil), []*ent.Task{
		task("root", nil),
		task("child", ptr("root")),
		task("grand", ptr("child")),
	})
	deps := []*ent.TaskDependency{
		{ID: "d1", TaskID: "grand", DependsOnID: "root", RequiredStage: "done"},
	}
	if got := orchestration.EdgesWithin(nodes, deps); len(got) != 1 {
		t.Fatalf("edges = %+v, want the grand→root edge", got)
	}
}

// SpawnerID is a configured role, not an agent identity: nothing here is
// derived from a process id.
func TestSummary_SpawnerIDsAreDistinctAndSorted(t *testing.T) {
	root := task("root", nil, func(x *ent.Task) { x.SpawnerID = ptr("reviewer") })
	all := []*ent.Task{
		root,
		task("a", ptr("root"), func(x *ent.Task) { x.SpawnerID = ptr("coder") }),
		task("b", ptr("root"), createdAt(time.Minute), func(x *ent.Task) { x.SpawnerID = ptr("coder") }),
		task("c", ptr("root"), createdAt(2*time.Minute)),
	}
	s := orchestration.SummaryOf(root, orchestration.Tree(root, all))
	if !equal(s.SpawnerIDs, []string{"coder", "reviewer"}) {
		t.Fatalf("spawnerIds = %v, want [coder reviewer]", s.SpawnerIDs)
	}
}

func TestIsRoot(t *testing.T) {
	if !orchestration.IsRoot(task("a", nil)) {
		t.Fatal("nil parent should be a root")
	}
	// An empty string is stored by some paths where nil is meant; treat it the
	// same rather than producing an orchestration whose root has a parent.
	if !orchestration.IsRoot(task("a", ptr(""))) {
		t.Fatal("empty parent should be a root")
	}
	if orchestration.IsRoot(task("a", ptr("b"))) {
		t.Fatal("task with a parent is not a root")
	}
}
