package system

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/lx-wnk/agent-dashboard/sdk"
)

func decodeSelf(t *testing.T, h *SelfHandler) sdk.RuntimeSelf {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/system/self", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var got sdk.RuntimeSelf
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return got
}

// The pid is the whole point: a client uses it to recognise the dashboard's own
// service by equality, so it must be this process and not a configured value.
func TestSelfReportsThisProcessAndBoundAddress(t *testing.T) {
	h := NewSelfHandler("127.0.0.1", 13120)
	h.getwd = func() (string, error) { return "/repo/agent-dashboard", nil }

	got := decodeSelf(t, h)

	if got.PID != os.Getpid() {
		t.Errorf("PID = %d, want this process %d", got.PID, os.Getpid())
	}
	if got.Host != "127.0.0.1" || got.Port != 13120 {
		t.Errorf("address = %s:%d, want 127.0.0.1:13120", got.Host, got.Port)
	}
	if got.Cwd != "/repo/agent-dashboard" {
		t.Errorf("Cwd = %q, want the server's working directory", got.Cwd)
	}
}

// An unreadable working directory is reported as absent. Empty matches no
// service, so the classification simply falls through to weaker evidence;
// inventing a path would attach the dashboard's identity to someone else's row.
func TestSelfReportsUnreadableCwdAsEmpty(t *testing.T) {
	h := NewSelfHandler("127.0.0.1", 13120)
	h.getwd = func() (string, error) { return "", errors.New("getwd: no such file or directory") }

	if got := decodeSelf(t, h); got.Cwd != "" {
		t.Errorf("Cwd = %q, want empty when it cannot be read", got.Cwd)
	}
}
