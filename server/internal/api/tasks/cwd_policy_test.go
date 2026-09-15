package tasks_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/lx-wnk/agent-dashboard/server/internal/api/tasks"
	"github.com/lx-wnk/agent-dashboard/server/internal/auth"
	"github.com/lx-wnk/agent-dashboard/server/internal/db"
	"github.com/lx-wnk/agent-dashboard/server/internal/db/repo"
	"github.com/lx-wnk/agent-dashboard/server/internal/services"
	"github.com/lx-wnk/agent-dashboard/server/internal/sse"
)

// Phase 4.1: a task's working folder passes the same spawn policy as New Agent
// (allowed folders + sensitive-directory blocklist), whatever its autonomy.

func newPolicyHandler(t *testing.T, policy tasks.CwdPolicy) *chi.Mux {
	t.Helper()
	bundle, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	client := bundle.Client
	t.Cleanup(func() { _ = client.Close() })
	h := tasks.NewHandler(tasks.Deps{
		TaskRepo:     repo.NewTaskRepo(client),
		SRRepo:       repo.NewStageRunRepo(client),
		PermRepo:     repo.NewPermissionRepo(client),
		AuditRepo:    repo.NewAuditEventRepo(client),
		CfgRepo:      repo.NewPipelineConfigRepo(client),
		Orchestrator: &noopOrchestrator{},
		Broadcaster:  sse.NewTaskBroadcaster(sse.NewBroadcaster()),
		CwdPolicy:    policy,
	})
	r := chi.NewRouter()
	r.Use(auth.RequireAuth(testJWTSecret))
	h.Mount(r)
	return r
}

func send(t *testing.T, r http.Handler, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	b, _ := json.Marshal(body)
	req := withAuth(t, httptest.NewRequest(method, path, bytes.NewReader(b)))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	return rr
}

// sensitiveHome points HOME at a temp dir with a real .ssh inside, and returns
// an allowed root plus the sensitive folder.
func sensitiveHome(t *testing.T) (allowed, sensitive string) {
	t.Helper()
	home, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", home)
	allowed = filepath.Join(home, "code", "app")
	sensitive = filepath.Join(home, ".ssh")
	for _, d := range []string{allowed, sensitive} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	return allowed, sensitive
}

func realPolicy(roots ...string) tasks.CwdPolicy {
	return services.NewSpawnPolicy(func(context.Context) ([]string, error) { return roots, nil })
}

func TestCreateTask_RefusesSensitiveFolder(t *testing.T) {
	allowed, sensitive := sensitiveHome(t)
	// Even with the whole home allowed, ~/.ssh stays refused — for every autonomy level.
	r := newPolicyHandler(t, realPolicy(filepath.Dir(filepath.Dir(allowed))))
	for _, autonomy := range []string{"manual", "spec_gated", "full"} {
		rr := send(t, r, http.MethodPost, "/api/tasks", map[string]any{"slug": "ssh-" + strings.ReplaceAll(autonomy, "_", "-"), "title": "x", "cwd": sensitive, "autonomy": autonomy})
		if rr.Code != http.StatusForbidden || !strings.Contains(rr.Body.String(), "sensitive") {
			t.Fatalf("%s: expected 403 sensitive, got %d: %s", autonomy, rr.Code, rr.Body.String())
		}
	}
}

func TestCreateTask_RefusesFolderOutsideAllowList(t *testing.T) {
	allowed, _ := sensitiveHome(t)
	outside := filepath.Join(filepath.Dir(allowed), "other")
	if err := os.MkdirAll(outside, 0o755); err != nil {
		t.Fatal(err)
	}
	r := newPolicyHandler(t, realPolicy(allowed))
	rr := send(t, r, http.MethodPost, "/api/tasks", map[string]any{"slug": "outside", "title": "x", "cwd": outside, "autonomy": "full"})
	if rr.Code != http.StatusForbidden || !strings.Contains(rr.Body.String(), "not allowed") {
		t.Fatalf("expected 403 not allowed, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestCreateTask_AllowedFolderDefaultsToManual(t *testing.T) {
	allowed, _ := sensitiveHome(t)
	r := newPolicyHandler(t, realPolicy(allowed))
	rr := send(t, r, http.MethodPost, "/api/tasks", map[string]any{"slug": "ok", "title": "x", "cwd": allowed})
	if rr.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rr.Code, rr.Body.String())
	}
	var got map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &got)
	if got["autonomy"] != "manual" {
		t.Fatalf("a new task must default to manual autonomy, got %v", got["autonomy"])
	}
}

func TestUpdateTask_RefusesMovingIntoSensitiveFolder(t *testing.T) {
	allowed, sensitive := sensitiveHome(t)
	r := newPolicyHandler(t, realPolicy(filepath.Dir(filepath.Dir(allowed))))
	rr := send(t, r, http.MethodPost, "/api/tasks", map[string]any{"slug": "move", "title": "x", "cwd": allowed})
	if rr.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", rr.Code, rr.Body.String())
	}
	var created map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &created)
	rr = send(t, r, http.MethodPatch, "/api/tasks/"+created["id"].(string), map[string]any{"cwd": sensitive})
	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected 403 moving a task into ~/.ssh, got %d: %s", rr.Code, rr.Body.String())
	}
}
