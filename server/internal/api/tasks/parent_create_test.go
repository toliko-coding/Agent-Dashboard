package tasks_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/lx-wnk/agent-dashboard/server/internal/api/tasks"
	"github.com/lx-wnk/agent-dashboard/server/internal/auth"
	"github.com/lx-wnk/agent-dashboard/server/internal/db"
	"github.com/lx-wnk/agent-dashboard/server/internal/db/ent"
	rawrepo "github.com/lx-wnk/agent-dashboard/server/internal/db/rawrepo"
	"github.com/lx-wnk/agent-dashboard/server/internal/db/repo"
	mcp "github.com/lx-wnk/agent-dashboard/server/internal/mcp"
	mcptools "github.com/lx-wnk/agent-dashboard/server/internal/mcp/tools"
	"github.com/lx-wnk/agent-dashboard/server/internal/sse"
)

/*
 * POST /api/tasks with parentTaskId.
 *
 * The security property under test is a split: a person may say where a task
 * sits in a hierarchy (parentTaskId is caller-supplied), but nobody may say
 * which agent run created it (delegated_by_stage_run_id is credential-derived
 * or nil). Every test below asserts one half of that.
 */

type parentFixture struct {
	router   *chi.Mux
	taskRepo repo.TaskRepo
	client   *ent.Client
}

func newParentFixture(t *testing.T) *parentFixture {
	t.Helper()
	bundle, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { _ = bundle.Client.Close() })

	taskRepo := repo.NewTaskRepo(bundle.Client)
	h := tasks.NewHandler(tasks.Deps{
		Client:       bundle.Client,
		TaskRepo:     taskRepo,
		SRBulkRepo:   rawrepo.NewStageRunBulkRepo(bundle.DB),
		SRRepo:       repo.NewStageRunRepo(bundle.Client),
		PermRepo:     repo.NewPermissionRepo(bundle.Client),
		AuditRepo:    repo.NewAuditEventRepo(bundle.Client),
		CfgRepo:      repo.NewPipelineConfigRepo(bundle.Client),
		Orchestrator: &noopOrchestrator{},
		Broadcaster:  sse.NewTaskBroadcaster(sse.NewBroadcaster()),
		// Scoped mode, so "visible to the caller" is a real constraint rather
		// than something loopback single-user mode waves through.
		BypassAuth: false,
	})
	r := chi.NewRouter()
	r.Use(auth.RequireAuth(testJWTSecret))
	h.Mount(r)

	return &parentFixture{router: r, taskRepo: taskRepo, client: bundle.Client}
}

// seedTask inserts a task owned by userID, bypassing the API.
func (f *parentFixture) seedTask(t *testing.T, slug, userID string) *ent.Task {
	t.Helper()
	uid := userID
	task, err := f.taskRepo.Create(context.Background(), repo.CreateTaskInput{
		Slug: slug, Title: slug, Cwd: "/tmp",
		CurrentStage: "backlog", Priority: "medium",
		MaxIterations: 20, StageTimeoutSeconds: 1800,
		UserID: &uid,
	})
	if err != nil {
		t.Fatalf("seed %s: %v", slug, err)
	}
	return task
}

func (f *parentFixture) post(t *testing.T, userID string, body map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	b, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/tasks", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	token, err := auth.SignJWT(auth.JWTPayload{Sub: userID, Login: userID}, testJWTSecret, 3600)
	if err != nil {
		t.Fatalf("sign jwt: %v", err)
	}
	req.AddCookie(&http.Cookie{Name: "auth_token", Value: token})
	rr := httptest.NewRecorder()
	f.router.ServeHTTP(rr, req)
	return rr
}

// createdTask reads the task back from the database, which is where the
// security claim actually has to hold — not merely in the response body.
func (f *parentFixture) createdTask(t *testing.T, rr *httptest.ResponseRecorder) *ent.Task {
	t.Helper()
	var out struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode create response: %v (%s)", err, rr.Body.String())
	}
	if out.ID == "" {
		t.Fatalf("no id in create response: %s", rr.Body.String())
	}
	task, err := f.taskRepo.GetByID(context.Background(), out.ID)
	if err != nil {
		t.Fatalf("read back %s: %v", out.ID, err)
	}
	return task
}

func baseBody(slug string) map[string]any {
	return map[string]any{"slug": slug, "title": slug, "cwd": "/tmp/" + slug}
}

// 1. A root task: no parent, and no agent claimed to have created it.
func TestCreate_HumanRootTask(t *testing.T) {
	f := newParentFixture(t)
	rr := f.post(t, "user-1", baseBody("root-task"))
	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d: %s", rr.Code, rr.Body.String())
	}
	task := f.createdTask(t, rr)
	if task.ParentTaskID != nil {
		t.Fatalf("parentTaskId = %q, want nil", *task.ParentTaskID)
	}
	if task.DelegatedByStageRunID != nil {
		t.Fatalf("delegatedByStageRunId = %q, want nil", *task.DelegatedByStageRunID)
	}
}

// 2. A child task created by a person: the link is stored, and provenance
// stays null — a person made this, and the record says so.
func TestCreate_HumanChildTask(t *testing.T) {
	f := newParentFixture(t)
	parent := f.seedTask(t, "parent", "user-1")

	body := baseBody("child-task")
	body["parentTaskId"] = parent.ID
	rr := f.post(t, "user-1", body)
	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d: %s", rr.Code, rr.Body.String())
	}

	task := f.createdTask(t, rr)
	if task.ParentTaskID == nil || *task.ParentTaskID != parent.ID {
		t.Fatalf("parentTaskId = %v, want %s", task.ParentTaskID, parent.ID)
	}
	if task.DelegatedByStageRunID != nil {
		t.Fatalf("delegatedByStageRunId = %q, want nil for a human-created child",
			*task.DelegatedByStageRunID)
	}
}

// 3. The spoof. A body naming a stage run must not be able to forge
// attribution — the field is not part of the contract and nothing reads it.
func TestCreate_IgnoresDelegatedByStageRunIDInBody(t *testing.T) {
	f := newParentFixture(t)
	parent := f.seedTask(t, "parent", "user-1")

	body := baseBody("spoofed-child")
	body["parentTaskId"] = parent.ID
	body["delegatedByStageRunId"] = "run-someone-else"
	body["delegated_by_stage_run_id"] = "run-someone-else"

	rr := f.post(t, "user-1", body)
	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d: %s", rr.Code, rr.Body.String())
	}
	task := f.createdTask(t, rr)
	if task.DelegatedByStageRunID != nil {
		t.Fatalf("delegatedByStageRunId = %q — the body must never set provenance",
			*task.DelegatedByStageRunID)
	}
}

// 4. A parent that does not exist.
func TestCreate_UnknownParentIs404(t *testing.T) {
	f := newParentFixture(t)
	body := baseBody("orphan")
	body["parentTaskId"] = "no-such-task"

	rr := f.post(t, "user-1", body)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404: %s", rr.Code, rr.Body.String())
	}
}

// 5. A parent that exists but belongs to someone else. The answer must be
// identical to the unknown-parent case: a different status would confirm the
// id exists, which is exactly what a caller who cannot see it must not learn.
func TestCreate_InvisibleParentIsIndistinguishableFrom404(t *testing.T) {
	f := newParentFixture(t)
	foreign := f.seedTask(t, "foreign-parent", "user-2")

	body := baseBody("trespassing-child")
	body["parentTaskId"] = foreign.ID
	rr := f.post(t, "user-1", body)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404: %s", rr.Code, rr.Body.String())
	}

	unknown := baseBody("other-child")
	unknown["parentTaskId"] = "no-such-task"
	rrUnknown := f.post(t, "user-1", unknown)
	if rrUnknown.Body.String() != rr.Body.String() {
		t.Fatalf("invisible parent (%s) must answer exactly like an unknown one (%s)",
			rr.Body.String(), rrUnknown.Body.String())
	}
}

// And the task must genuinely not exist afterwards — a rejected parent must
// not leave a half-created root behind.
func TestCreate_RejectedParentCreatesNothing(t *testing.T) {
	f := newParentFixture(t)
	body := baseBody("should-not-exist")
	body["parentTaskId"] = "no-such-task"
	f.post(t, "user-1", body)

	if _, err := f.taskRepo.GetBySlug(context.Background(), "should-not-exist"); err == nil {
		t.Fatal("a create rejected for its parent must not persist the task")
	}
}

// 6. An ownerless task is visible to nobody in scoped mode, matching
// ListForUser's `user_id = ?` predicate, which never matches NULL. If the two
// disagreed, a parent link would become a way to read around the task list.
func TestCreate_OwnerlessParentIsNotVisible(t *testing.T) {
	f := newParentFixture(t)
	orphanParent, err := f.taskRepo.Create(context.Background(), repo.CreateTaskInput{
		Slug: "ownerless", Title: "ownerless", Cwd: "/tmp",
		CurrentStage: "backlog", Priority: "medium",
		MaxIterations: 20, StageTimeoutSeconds: 1800,
	})
	if err != nil {
		t.Fatalf("seed ownerless: %v", err)
	}

	body := baseBody("child-of-ownerless")
	body["parentTaskId"] = orphanParent.ID
	if rr := f.post(t, "user-1", body); rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404: %s", rr.Code, rr.Body.String())
	}
}

// 7. Self-parent. On create the child's id does not exist yet, so naming
// "itself" degenerates to naming a task that is not there — which is refused
// the same way any unknown parent is. The explicit guard in
// validateParentTask covers the case for any future caller that supplies an
// id; it cannot be reached from this route.
func TestCreate_SelfParentAttemptIsRejected(t *testing.T) {
	f := newParentFixture(t)
	body := baseBody("self-parent")
	// The most direct expression a caller has: point at the identity it is
	// trying to create.
	body["parentTaskId"] = "self-parent"

	rr := f.post(t, "user-1", body)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404: %s", rr.Code, rr.Body.String())
	}
	if _, err := f.taskRepo.GetBySlug(context.Background(), "self-parent"); err == nil {
		t.Fatal("self-parent attempt must not create the task")
	}
}

// A task cannot be reparented onto itself later either, because PATCH does not
// accept parentTaskId at all — the link is write-once. Asserted so a future
// change that adds it has to confront this test.
func TestUpdate_DoesNotAcceptParentTaskID(t *testing.T) {
	f := newParentFixture(t)
	parent := f.seedTask(t, "parent", "user-1")
	child := f.seedTask(t, "child", "user-1")

	b, _ := json.Marshal(map[string]any{"parentTaskId": parent.ID})
	req := httptest.NewRequest(http.MethodPatch, "/api/tasks/"+child.ID, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req = withAuth(t, req)
	rr := httptest.NewRecorder()
	f.router.ServeHTTP(rr, req)

	reread, err := f.taskRepo.GetByID(context.Background(), child.ID)
	if err != nil {
		t.Fatalf("reread: %v", err)
	}
	if reread.ParentTaskID != nil {
		t.Fatalf("PATCH set parentTaskId to %q — reparenting is not part of the contract",
			*reread.ParentTaskID)
	}
}

// 8. The agent path keeps its authenticated provenance. Same shape of request,
// different credential: a stage-run key records its own run id and nothing
// else can put a value there.
func TestAgentCreatedChildKeepsServerDerivedProvenance(t *testing.T) {
	bundle, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { _ = bundle.Client.Close() })

	taskRepo := repo.NewTaskRepo(bundle.Client)
	parent, err := taskRepo.Create(context.Background(), repo.CreateTaskInput{
		Slug: "agent-parent", Title: "agent-parent", Cwd: "/tmp",
		CurrentStage: "backlog", Priority: "medium",
		MaxIterations: 20, StageTimeoutSeconds: 1800,
	})
	if err != nil {
		t.Fatalf("seed parent: %v", err)
	}

	registry := mcp.ToolRegistry{}
	mcptools.RegisterWriteTools(registry, mcptools.WriteDeps{
		TaskRepo:    taskRepo,
		PermRepo:    repo.NewPermissionRepo(bundle.Client),
		AuditRepo:   repo.NewAuditEventRepo(bundle.Client),
		ProjectRepo: repo.NewProjectRepo(bundle.Client),
		SpawnerRepo: repo.NewSpawnerRepo(bundle.Client),
	})

	ctx := mcp.ContextWithAuth(context.Background(), &mcp.MCPAuthInfo{
		KeyID:      "key-stage",
		StageRunID: "run-authentic",
	})
	result, err := registry["create_task"].Handler(ctx, map[string]any{
		"slug":         "agent-child",
		"title":        "Agent child",
		"cwd":          "/tmp/agent-child",
		"parentTaskId": parent.ID,
		// Ignored: provenance comes from the credential above, not from here.
		"delegatedByStageRunId": "run-claimed",
	})
	if err != nil {
		t.Fatalf("create_task: %v", err)
	}
	_ = result

	child, err := taskRepo.GetBySlug(context.Background(), "agent-child")
	if err != nil {
		t.Fatalf("read back child: %v", err)
	}
	if child.ParentTaskID == nil || *child.ParentTaskID != parent.ID {
		t.Fatalf("parentTaskId = %v, want %s", child.ParentTaskID, parent.ID)
	}
	if child.DelegatedByStageRunID == nil || *child.DelegatedByStageRunID != "run-authentic" {
		t.Fatalf("delegatedByStageRunId = %v, want run-authentic", child.DelegatedByStageRunID)
	}
}
