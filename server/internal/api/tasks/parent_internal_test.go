package tasks

import (
	"context"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/lx-wnk/agent-dashboard/server/internal/apierr"
	"github.com/lx-wnk/agent-dashboard/server/internal/db"
	"github.com/lx-wnk/agent-dashboard/server/internal/db/ent"
	"github.com/lx-wnk/agent-dashboard/server/internal/db/repo"
)

// Covers validateParentTask directly, including the branches the HTTP create
// route cannot reach: a child id exists only once a task has been persisted, so
// the self-parent guard is unreachable from POST /api/tasks and has to be
// exercised here.
func newParentValidator(t *testing.T, bypassAuth bool) (*Handler, repo.TaskRepo) {
	t.Helper()
	bundle, err := db.Open(":memory:")
	require.NoError(t, err)
	t.Cleanup(func() { _ = bundle.Client.Close() })

	taskRepo := repo.NewTaskRepo(bundle.Client)
	return NewHandler(Deps{TaskRepo: taskRepo, BypassAuth: bypassAuth}), taskRepo
}

func seedOwned(t *testing.T, r repo.TaskRepo, slug string, owner *string) *ent.Task {
	t.Helper()
	task, err := r.Create(context.Background(), repo.CreateTaskInput{
		Slug: slug, Title: slug, Cwd: "/tmp",
		CurrentStage: "backlog", Priority: "medium",
		MaxIterations: 20, StageTimeoutSeconds: 1800,
		UserID: owner,
	})
	require.NoError(t, err)
	return task
}

func statusOf(t *testing.T, err error) int {
	t.Helper()
	require.Error(t, err)
	appErr, ok := err.(*apierr.AppError)
	require.True(t, ok, "expected an AppError, got %T: %v", err, err)
	return appErr.Status
}

func TestValidateParentTask_EmptyParentIsAllowed(t *testing.T) {
	h, _ := newParentValidator(t, false)
	user := "user-1"
	require.NoError(t, h.validateParentTask(context.Background(), "", "", &user))
}

// The guard the create route cannot reach: a task must never be its own parent.
func TestValidateParentTask_SelfParentIsRejected(t *testing.T) {
	h, _ := newParentValidator(t, false)
	user := "user-1"
	err := h.validateParentTask(context.Background(), "task-a", "task-a", &user)
	require.Equal(t, http.StatusBadRequest, statusOf(t, err))
	require.Contains(t, err.Error(), "own parent")
}

// The self-parent check runs before the lookup, so it does not depend on the
// task existing — a caller cannot turn it into an existence oracle.
func TestValidateParentTask_SelfParentCheckPrecedesLookup(t *testing.T) {
	h, _ := newParentValidator(t, false)
	user := "user-1"
	err := h.validateParentTask(context.Background(), "never-persisted", "never-persisted", &user)
	require.Equal(t, http.StatusBadRequest, statusOf(t, err))
}

func TestValidateParentTask_OwnParentIsVisible(t *testing.T) {
	h, r := newParentValidator(t, false)
	user := "user-1"
	parent := seedOwned(t, r, "mine", &user)
	require.NoError(t, h.validateParentTask(context.Background(), parent.ID, "child", &user))
}

func TestValidateParentTask_ForeignParentIs404(t *testing.T) {
	h, r := newParentValidator(t, false)
	owner := "user-2"
	parent := seedOwned(t, r, "theirs", &owner)

	caller := "user-1"
	err := h.validateParentTask(context.Background(), parent.ID, "child", &caller)
	require.Equal(t, http.StatusNotFound, statusOf(t, err))
}

func TestValidateParentTask_MissingParentIs404(t *testing.T) {
	h, _ := newParentValidator(t, false)
	caller := "user-1"
	err := h.validateParentTask(context.Background(), "gone", "child", &caller)
	require.Equal(t, http.StatusNotFound, statusOf(t, err))
}

// An anonymous caller in scoped mode owns nothing, so it can link to nothing.
func TestValidateParentTask_NilUserSeesNothingWhenScoped(t *testing.T) {
	h, r := newParentValidator(t, false)
	owner := "user-1"
	parent := seedOwned(t, r, "mine", &owner)

	err := h.validateParentTask(context.Background(), parent.ID, "child", nil)
	require.Equal(t, http.StatusNotFound, statusOf(t, err))
}

// Loopback single-user mode has one implicit user, so every task is that
// user's — the same widening ListForUser already applies there, and no other.
func TestValidateParentTask_BypassAuthSeesEveryTask(t *testing.T) {
	h, r := newParentValidator(t, true)
	owner := "someone-else"
	parent := seedOwned(t, r, "theirs", &owner)

	require.NoError(t, h.validateParentTask(context.Background(), parent.ID, "child", nil))
}

// Even in bypass mode a nonexistent parent is still a 404: the mode widens who
// counts as visible, not what counts as existing.
func TestValidateParentTask_BypassAuthStillRequiresExistence(t *testing.T) {
	h, _ := newParentValidator(t, true)
	err := h.validateParentTask(context.Background(), "gone", "child", nil)
	require.Equal(t, http.StatusNotFound, statusOf(t, err))
}
