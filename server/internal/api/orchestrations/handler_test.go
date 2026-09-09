package orchestrations_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/lx-wnk/agent-dashboard/server/internal/api/orchestrations"
	"github.com/lx-wnk/agent-dashboard/server/internal/auth"
	"github.com/lx-wnk/agent-dashboard/server/internal/db"
	"github.com/lx-wnk/agent-dashboard/server/internal/db/repo"
	"github.com/lx-wnk/agent-dashboard/server/internal/orchestration"
)

const testJWTSecret = "test-secret-for-orchestrations"

type fixture struct {
	router *chi.Mux
	tasks  repo.TaskRepo
	deps   repo.DependencyRepo
}

// newFixture mounts the handler over an in-memory database with auth enforced,
// so the tests exercise the same scoping path production uses.
func newFixture(t *testing.T) *fixture {
	t.Helper()
	bundle, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { _ = bundle.Client.Close() })

	taskRepo := repo.NewTaskRepo(bundle.Client)
	depRepo := repo.NewDependencyRepo(bundle.Client)

	r := chi.NewRouter()
	r.Use(auth.RequireAuth(testJWTSecret))
	// bypassAuth=false so every test states which user it is asking as.
	orchestrations.New(taskRepo, depRepo, false).Mount(r)

	return &fixture{router: r, tasks: taskRepo, deps: depRepo}
}

func ptr(s string) *string { return &s }

// seed creates a task owned by userID.
func (f *fixture) seed(t *testing.T, id, userID string, parent *string, mut ...func(*repo.CreateTaskInput)) {
	t.Helper()
	in := repo.CreateTaskInput{
		ID:           id,
		Slug:         id,
		Title:        id,
		Cwd:          "/tmp",
		ParentTaskID: parent,
		UserID:       &userID,
		Priority:     "medium",
		CurrentStage: "backlog",
	}
	for _, m := range mut {
		m(&in)
	}
	if _, err := f.tasks.Create(context.Background(), in); err != nil {
		t.Fatalf("seed %s: %v", id, err)
	}
}

func (f *fixture) get(t *testing.T, path, userID string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	token, err := auth.SignJWT(auth.JWTPayload{Sub: userID, Login: userID}, testJWTSecret, 3600)
	if err != nil {
		t.Fatalf("sign jwt: %v", err)
	}
	req.AddCookie(&http.Cookie{Name: "auth_token", Value: token})
	rr := httptest.NewRecorder()
	f.router.ServeHTTP(rr, req)
	return rr
}

func decodeList(t *testing.T, rr *httptest.ResponseRecorder) []orchestration.Summary {
	t.Helper()
	var out []orchestration.Summary
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode list: %v (%s)", err, rr.Body.String())
	}
	return out
}

func decodeDetail(t *testing.T, rr *httptest.ResponseRecorder) orchestration.Detail {
	t.Helper()
	var out orchestration.Detail
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode detail: %v (%s)", err, rr.Body.String())
	}
	return out
}

// A standalone task is a root, but listing every one of them would turn this
// endpoint into a second task list. Get still serves it.
func TestList_OmitsSingletonRoots(t *testing.T) {
	f := newFixture(t)
	f.seed(t, "solo", "user-1", nil)

	rr := f.get(t, "/api/orchestrations", "user-1")
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rr.Code, rr.Body.String())
	}
	if got := decodeList(t, rr); len(got) != 0 {
		t.Fatalf("expected no rows, got %+v", got)
	}
}

func TestList_IncludesRootWithChildren(t *testing.T) {
	f := newFixture(t)
	f.seed(t, "root", "user-1", nil)
	f.seed(t, "child", "user-1", ptr("root"))

	rows := decodeList(t, f.get(t, "/api/orchestrations", "user-1"))
	if len(rows) != 1 {
		t.Fatalf("expected 1 row, got %d", len(rows))
	}
	if rows[0].RootTaskID != "root" {
		t.Fatalf("rootTaskId = %q, want root", rows[0].RootTaskID)
	}
	if rows[0].Counts.Total != 2 {
		t.Fatalf("total = %d, want 2", rows[0].Counts.Total)
	}
}

// Project isolation: one user's orchestration must not appear for another, and
// must not be assemblable by id either.
func TestScoping_OtherUsersOrchestrationIsInvisible(t *testing.T) {
	f := newFixture(t)
	f.seed(t, "root", "user-1", nil)
	f.seed(t, "child", "user-1", ptr("root"))

	if rows := decodeList(t, f.get(t, "/api/orchestrations", "user-2")); len(rows) != 0 {
		t.Fatalf("user-2 sees %+v, want nothing", rows)
	}
	// 404, not 403: an orchestration a caller cannot see must not be
	// distinguishable from one that does not exist.
	if rr := f.get(t, "/api/orchestrations/root", "user-2"); rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404: %s", rr.Code, rr.Body.String())
	}
}

// A child of another user's root is not pulled into the tree.
func TestGet_TreeStopsAtVisibilityBoundary(t *testing.T) {
	f := newFixture(t)
	f.seed(t, "root", "user-1", nil)
	f.seed(t, "mine", "user-1", ptr("root"))
	f.seed(t, "theirs", "user-2", ptr("root"))

	d := decodeDetail(t, f.get(t, "/api/orchestrations/root", "user-1"))
	for _, n := range d.Tasks {
		if n.ID == "theirs" {
			t.Fatal("another user's task leaked into the tree")
		}
	}
	if len(d.Tasks) != 2 {
		t.Fatalf("tasks = %d, want 2", len(d.Tasks))
	}
}

func TestGet_SingletonRootIsServed(t *testing.T) {
	f := newFixture(t)
	f.seed(t, "solo", "user-1", nil)

	rr := f.get(t, "/api/orchestrations/solo", "user-1")
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rr.Code, rr.Body.String())
	}
	d := decodeDetail(t, rr)
	if len(d.Tasks) != 1 || d.Tasks[0].ID != "solo" {
		t.Fatalf("tasks = %+v, want just solo", d.Tasks)
	}
	if d.Dependencies == nil {
		t.Fatal("dependencies should be [] not null")
	}
}

func TestGet_UnknownIDIs404(t *testing.T) {
	f := newFixture(t)
	if rr := f.get(t, "/api/orchestrations/nope", "user-1"); rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rr.Code)
	}
}

// A descendant id is refused rather than silently resolved: the URL would
// otherwise lie about what it addresses. The message names the real root.
func TestGet_NonRootIDIsRejectedAndNamesTheRoot(t *testing.T) {
	f := newFixture(t)
	f.seed(t, "root", "user-1", nil)
	f.seed(t, "child", "user-1", ptr("root"))

	rr := f.get(t, "/api/orchestrations/child", "user-1")
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400: %s", rr.Code, rr.Body.String())
	}
	if body := rr.Body.String(); !strings.Contains(body, "root") {
		t.Fatalf("error should name the root, got %s", body)
	}
}

// Stored dependencies inside a tree are reported; one leaving it is not.
func TestGet_ReportsDependenciesWithinTheTreeOnly(t *testing.T) {
	f := newFixture(t)
	f.seed(t, "root", "user-1", nil)
	f.seed(t, "a", "user-1", ptr("root"))
	f.seed(t, "b", "user-1", ptr("root"))
	f.seed(t, "outside", "user-1", nil)

	ctx := context.Background()
	if _, err := f.deps.Add(ctx, "b", "a", "done", "cancel"); err != nil {
		t.Fatalf("add sibling dependency: %v", err)
	}
	if _, err := f.deps.Add(ctx, "a", "outside", "done", "cancel"); err != nil {
		t.Fatalf("add external dependency: %v", err)
	}

	d := decodeDetail(t, f.get(t, "/api/orchestrations/root", "user-1"))
	if len(d.Dependencies) != 1 {
		t.Fatalf("dependencies = %+v, want only the sibling edge", d.Dependencies)
	}
	if d.Dependencies[0].TaskID != "b" || d.Dependencies[0].DependsOnID != "a" {
		t.Fatalf("edge = %+v, want b→a", d.Dependencies[0])
	}
}

// A hierarchy created before provenance existed reads back with a null
// delegatedByStageRunId — null is the honest value for human-created work, not
// a placeholder agent.
func TestGet_ExistingTasksReportNullProvenance(t *testing.T) {
	f := newFixture(t)
	f.seed(t, "root", "user-1", nil)
	f.seed(t, "child", "user-1", ptr("root"))

	rr := f.get(t, "/api/orchestrations/root", "user-1")
	var raw struct {
		Delegated int `json:"delegated"`
		Tasks     []struct {
			ID                    string  `json:"id"`
			DelegatedByStageRunID *string `json:"delegatedByStageRunId"`
			SpawnerID             *string `json:"spawnerId"`
		} `json:"tasks"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &raw); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if raw.Delegated != 0 {
		t.Fatalf("delegated = %d, want 0", raw.Delegated)
	}
	for _, n := range raw.Tasks {
		if n.DelegatedByStageRunID != nil {
			t.Fatalf("%s: provenance = %q, want null", n.ID, *n.DelegatedByStageRunID)
		}
		// No agent identity is invented from a running process either.
		if n.SpawnerID != nil {
			t.Fatalf("%s: spawnerId = %q, want null", n.ID, *n.SpawnerID)
		}
	}
}

// Provenance set at creation survives the round trip and is counted.
func TestGet_ReportsStoredProvenance(t *testing.T) {
	f := newFixture(t)
	f.seed(t, "root", "user-1", nil)
	f.seed(t, "child", "user-1", ptr("root"), func(in *repo.CreateTaskInput) {
		in.DelegatedByStageRunID = ptr("run-42")
	})

	d := decodeDetail(t, f.get(t, "/api/orchestrations/root", "user-1"))
	if d.Delegated != 1 {
		t.Fatalf("delegated = %d, want 1", d.Delegated)
	}
	var found bool
	for _, n := range d.Tasks {
		if n.ID == "child" {
			if n.DelegatedByStageRunID == nil || *n.DelegatedByStageRunID != "run-42" {
				t.Fatalf("child provenance = %v, want run-42", n.DelegatedByStageRunID)
			}
			found = true
		}
	}
	if !found {
		t.Fatal("child missing from tree")
	}
}

// The endpoint is read-only by construction: no mutating verb is registered.
func TestRoutes_AreReadOnly(t *testing.T) {
	f := newFixture(t)
	f.seed(t, "root", "user-1", nil)

	token, err := auth.SignJWT(auth.JWTPayload{Sub: "user-1", Login: "user-1"}, testJWTSecret, 3600)
	if err != nil {
		t.Fatalf("sign jwt: %v", err)
	}
	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
		req := httptest.NewRequest(method, "/api/orchestrations/root", nil)
		req.AddCookie(&http.Cookie{Name: "auth_token", Value: token})
		rr := httptest.NewRecorder()
		f.router.ServeHTTP(rr, req)
		if rr.Code != http.StatusMethodNotAllowed && rr.Code != http.StatusNotFound {
			t.Fatalf("%s returned %d, want 404/405", method, rr.Code)
		}
	}
}

// Unauthenticated callers get nothing: the routes sit inside the protected
// group, exactly like the task list they scope against.
func TestRoutes_RequireAuth(t *testing.T) {
	f := newFixture(t)
	req := httptest.NewRequest(http.MethodGet, "/api/orchestrations", nil)
	rr := httptest.NewRecorder()
	f.router.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rr.Code)
	}
}
