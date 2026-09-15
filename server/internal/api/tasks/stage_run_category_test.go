package tasks_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/lx-wnk/agent-dashboard/server/internal/db/repo"
)

// Phase 4.1: the stage-run API carries the server's persisted failure category
// beside the human reason, and null when a run is unclassified.
func TestListStageRuns_ExposesFailureCategory(t *testing.T) {
	client, r := newTestHandlerWithRepos(t)
	ctx := context.Background()

	b, _ := json.Marshal(map[string]any{"slug": "cat-api", "title": "Category API", "cwd": "/tmp/cat"})
	req := withAuth(t, httptest.NewRequest(http.MethodPost, "/api/tasks", bytes.NewReader(b)))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", rr.Code, rr.Body.String())
	}
	var created map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &created)
	taskID := created["id"].(string)

	srRepo := repo.NewStageRunRepo(client)
	classified, err := srRepo.Create(ctx, repo.CreateStageRunInput{TaskID: taskID, Stage: "implementation"})
	if err != nil {
		t.Fatal(err)
	}
	failed, category := "failed", "invalid_result"
	if _, err := srRepo.Update(ctx, classified.ID, repo.UpdateStageRunInput{Status: &failed, FailureCategory: &category, Output: map[string]any{"error": "missing required field: nextAction (string)"}}); err != nil {
		t.Fatal(err)
	}
	unclassified, err := srRepo.Create(ctx, repo.CreateStageRunInput{TaskID: taskID, Stage: "implementation", Iteration: 1})
	if err != nil {
		t.Fatal(err)
	}

	rr = httptest.NewRecorder()
	r.ServeHTTP(rr, withAuth(t, httptest.NewRequest(http.MethodGet, "/api/tasks/"+taskID+"/stage-runs", nil)))
	if rr.Code != http.StatusOK {
		t.Fatalf("list: %d %s", rr.Code, rr.Body.String())
	}
	var runs []map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &runs); err != nil {
		t.Fatal(err)
	}
	byID := map[string]map[string]any{}
	for _, run := range runs {
		byID[run["id"].(string)] = run
	}
	if got := byID[classified.ID]["failureCategory"]; got != "invalid_result" {
		t.Fatalf("failureCategory = %v, want invalid_result", got)
	}
	if got := byID[classified.ID]["output"].(map[string]any)["error"]; got != "missing required field: nextAction (string)" {
		t.Fatalf("human reason = %v", got)
	}
	if v, present := byID[unclassified.ID]["failureCategory"]; !present || v != nil {
		t.Fatalf("an unclassified run must report failureCategory: null, got %v (present=%v)", v, present)
	}
}
