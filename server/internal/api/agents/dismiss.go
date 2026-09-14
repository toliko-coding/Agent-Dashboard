package agents

import (
	"fmt"
	"net/http"
	"strconv"
	"syscall"
)

// DismissChannel handles DELETE /api/agents/{pid}/channel. It forgets a FINISHED
// agent in the in-memory tracker so its card stops appearing, then removes any
// leftover dashboard-channel discovery files (best-effort orphan cleanup for a
// SIGKILLed bridge that never ran its own removal). It refuses a live PID (only
// finished agents are dismissable) and is idempotent when the files are gone.
func (h *SpawnHandler) DismissChannel(w http.ResponseWriter, r *http.Request) {
	pid, err := strconv.Atoi(r.PathValue("pid"))
	if err != nil || pid <= 0 {
		http.Error(w, `{"error":"invalid pid"}`, http.StatusBadRequest)
		return
	}

	if processAlive(pid) {
		http.Error(w, `{"error":"agent is still running"}`, http.StatusConflict)
		return
	}

	if h.dismisser != nil {
		h.dismisser.DismissAgent(pid)
	}

	if err := removeDiscoveryFiles(pid); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":%q}`, err.Error()), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// processAlive reports whether a process with the given pid currently exists.
// signal 0 performs no delivery but runs the kernel's existence/permission
// check: nil means alive, ESRCH means gone.
func processAlive(pid int) bool {
	return syscall.Kill(pid, 0) == nil
}
