package system

import (
	"encoding/json"
	"net/http"
	"os"

	"github.com/lx-wnk/agent-dashboard/sdk"
)

/*
 * The dashboard's own runtime identity.
 *
 * Runtime's service list is observation: every listening port on the machine,
 * whoever started it. Classifying one of those rows as "this is the dashboard"
 * needs evidence, and the only evidence that cannot be wrong is the server's
 * own pid — which only the server knows.
 *
 * It is deliberately not a port constant. 13120 and 5173 are defaults, not
 * identities: either can be reconfigured, and any process can listen on them.
 * A classification built on a port number would mislabel someone else's server
 * as the dashboard, which is exactly the mistake that must not be made on a
 * surface that will one day offer to stop things.
 *
 * Authenticated, alongside /api/system/config: it reports a pid and a path.
 */

// SelfHandler answers GET /api/system/self with this server's identity.
type SelfHandler struct {
	host string
	port int
	// getwd is os.Getwd, injectable for tests.
	getwd func() (string, error)
}

// NewSelfHandler builds the handler for the address this server bound.
func NewSelfHandler(host string, port int) *SelfHandler {
	return &SelfHandler{host: host, port: port, getwd: os.Getwd}
}

func (h *SelfHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// An unreadable cwd is reported as empty rather than as a guess: a client
	// compares it for equality, and "" matches nothing.
	cwd, err := h.getwd()
	if err != nil {
		cwd = ""
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(sdk.RuntimeSelf{
		PID:  os.Getpid(),
		Host: h.host,
		Port: h.port,
		Cwd:  cwd,
	})
}
