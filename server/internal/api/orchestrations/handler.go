// Package orchestrations serves the derived orchestration view.
//
// Read-only by construction: there are two GETs and no mutating verb. An
// orchestration owns no table — it is a root task plus its descendants and the
// dependencies among them, all read from data the pipeline already stores.
//
// Visibility reuses the task list's own scoping (repo.ListForUser), so this
// endpoint can never widen what a caller may see: an orchestration is only ever
// assembled from tasks that caller could already read one by one.
package orchestrations

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/lx-wnk/agent-dashboard/server/internal/apierr"
	"github.com/lx-wnk/agent-dashboard/server/internal/auth"
	"github.com/lx-wnk/agent-dashboard/server/internal/db/ent"
	"github.com/lx-wnk/agent-dashboard/server/internal/db/repo"
	"github.com/lx-wnk/agent-dashboard/server/internal/orchestration"
)

// TaskLister is the subset of repo.TaskRepo this handler reads.
type TaskLister interface {
	ListForUser(ctx context.Context, userID string, unscoped bool) ([]*ent.Task, error)
}

// DependencyLister is the subset of repo.DependencyRepo this handler reads.
type DependencyLister interface {
	ListForTasks(ctx context.Context, ids []string) ([]*ent.TaskDependency, error)
}

// Handler serves the orchestration reads.
type Handler struct {
	tasks      TaskLister
	deps       DependencyLister
	bypassAuth bool
}

// New builds the handler. bypassAuth mirrors the loopback single-user mode in
// which every request is already the local admin, matching how the task routes
// resolve their own scope.
func New(tasks repo.TaskRepo, deps repo.DependencyRepo, bypassAuth bool) *Handler {
	return &Handler{tasks: tasks, deps: deps, bypassAuth: bypassAuth}
}

// Mount registers the routes. Caller places r inside the protected group.
func (h *Handler) Mount(r chi.Router) {
	r.Get("/api/orchestrations", apierr.ErrorMiddleware(h.List))
	r.Get("/api/orchestrations/{rootTaskId}", apierr.ErrorMiddleware(h.Get))
}

// scopedTasks returns the tasks this caller may see, using the same rule the
// task list uses.
func (h *Handler) scopedTasks(r *http.Request) ([]*ent.Task, error) {
	userID := ""
	if payload, ok := auth.PayloadFromContext(r.Context()); ok {
		userID = payload.Sub
	}
	return h.tasks.ListForUser(r.Context(), userID, h.bypassAuth)
}

// List returns one row per orchestration.
//
// A root with no descendants is deliberately omitted: every standalone task is
// technically a root, so including them would make this endpoint a second, less
// useful task list. Such a task is still a valid orchestration of one and Get
// serves it — the filter is about what is worth listing, not what exists.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) error {
	tasks, err := h.scopedTasks(r)
	if err != nil {
		return err
	}

	out := make([]orchestration.Summary, 0)
	for _, t := range tasks {
		if !orchestration.IsRoot(t) {
			continue
		}
		nodes := orchestration.Tree(t, tasks)
		if len(nodes) < 2 {
			continue
		}
		out = append(out, orchestration.SummaryOf(t, nodes))
	}
	apierr.WriteJSON(w, http.StatusOK, out)
	return nil
}

// Get returns one orchestration by its ROOT task id.
//
// A descendant id is refused rather than silently resolved to its root: the two
// are different questions, and answering the wrong one would make the URL lie
// about what it addresses. The error names the root so the caller can follow it.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) error {
	rootID := chi.URLParam(r, "rootTaskId")
	if rootID == "" {
		return apierr.NewAppError(http.StatusBadRequest, "rootTaskId is required")
	}

	tasks, err := h.scopedTasks(r)
	if err != nil {
		return err
	}

	byID := make(map[string]*ent.Task, len(tasks))
	for _, t := range tasks {
		byID[t.ID] = t
	}

	root, ok := byID[rootID]
	if !ok {
		// Also the answer when the task exists but belongs to another user: an
		// orchestration a caller cannot see must not be distinguishable from
		// one that does not exist.
		return apierr.NewAppError(http.StatusNotFound, "orchestration not found")
	}

	if !orchestration.IsRoot(root) {
		actualRoot := orchestration.RootIDOf(root, byID)
		return apierr.NewAppError(http.StatusBadRequest,
			"not an orchestration root; its root is "+actualRoot)
	}

	nodes := orchestration.Tree(root, tasks)

	ids := make([]string, 0, len(nodes))
	for _, n := range nodes {
		ids = append(ids, n.ID)
	}
	rows, err := h.deps.ListForTasks(r.Context(), ids)
	if err != nil {
		return err
	}

	apierr.WriteJSON(w, http.StatusOK, orchestration.Detail{
		Summary:      orchestration.SummaryOf(root, nodes),
		Tasks:        nodes,
		Dependencies: orchestration.EdgesWithin(nodes, rows),
	})
	return nil
}
