package tasks

import (
	"context"
	"fmt"
	"net/http"

	"github.com/lx-wnk/agent-dashboard/server/internal/apierr"
	"github.com/lx-wnk/agent-dashboard/server/internal/db/ent"
)

/*
 * Parent-link validation for task creation.
 *
 * A parent link is caller-supplied: deciding that one task sits under another
 * is a person's call, and the API should let them make it. What the caller must
 * NOT be able to do is reach a task they cannot otherwise see, so the rule here
 * is exactly the rule the task list already applies — no wider, no narrower.
 *
 * Nothing is inferred. A parent is never derived from the project, the spawner,
 * the working directory or which agent happens to be running: an unstated
 * hierarchy is a hierarchy nobody asked for, and it would show up in the
 * orchestration view as a collaboration that never happened.
 */

// parentVisibleTo reports whether userID may see the given task under the same
// rule TaskRepo.ListForUser applies: own tasks only, unless the server runs in
// loopback single-user mode (bypassAuth), where there is one implicit user.
//
// A task with no owner is visible to nobody in scoped mode — matching
// ListForUser, whose `user_id = ?` predicate never matches NULL. Reproducing
// that here rather than treating an ownerless task as public is the point: the
// two must not disagree, or a parent link becomes a way to read around the list.
func (h *Handler) parentVisibleTo(task *ent.Task, userID *string) bool {
	if h.bypassAuth {
		return true
	}
	if userID == nil || *userID == "" || task.UserID == nil {
		return false
	}
	return *task.UserID == *userID
}

// validateParentTask checks a caller-supplied parent link.
//
// childID is the id of the task being linked, when it already has one. It is
// empty on the create path, where the child's id does not exist yet — which is
// also why a self-parent cannot occur there: a brand-new id is not any existing
// task. The guard is kept anyway so a future update path that reuses this
// function cannot introduce a one-node cycle by omission.
//
// A parent that does not exist and a parent the caller cannot see both answer
// 404. They are deliberately indistinguishable: a 403 for the second would
// confirm that a given task id exists, which is precisely what a caller who
// cannot see it must not learn.
func (h *Handler) validateParentTask(ctx context.Context, parentID, childID string, userID *string) error {
	if parentID == "" {
		return nil
	}
	if childID != "" && parentID == childID {
		return apierr.NewAppError(http.StatusBadRequest, "a task cannot be its own parent")
	}

	parent, err := h.taskRepo.GetByID(ctx, parentID)
	if err != nil {
		if ent.IsNotFound(err) {
			return apierr.NewAppError(http.StatusNotFound, "parent task not found")
		}
		return fmt.Errorf("tasks.create.parentLookup: %w", err)
	}
	if !h.parentVisibleTo(parent, userID) {
		return apierr.NewAppError(http.StatusNotFound, "parent task not found")
	}
	return nil
}
