package localscope

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

// router mounts the proxy the same way the real router does.
func router(h *Handler) chi.Router {
	r := chi.NewRouter()
	h.Mount(r)
	return r
}

// handlerFor points a proxy at a test upstream.
func handlerFor(t *testing.T, upstream *httptest.Server) *Handler {
	t.Helper()
	u, err := url.Parse(upstream.URL)
	if err != nil {
		t.Fatalf("parse upstream: %v", err)
	}
	port, err := strconv.Atoi(u.Port())
	if err != nil {
		t.Fatalf("parse port: %v", err)
	}
	return New(u.Hostname(), port)
}

func get(t *testing.T, r chi.Router, path string) *httptest.ResponseRecorder {
	t.Helper()
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, path, nil))
	return rr
}

func TestProxy_ForwardsWhenCollectorAvailable(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/system/summary" {
			t.Errorf("upstream path = %q, want /api/system/summary", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"data":{"services":{"running":4}}}`))
	}))
	defer upstream.Close()

	rr := get(t, router(handlerFor(t, upstream)), "/localscope/api/system/summary")

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	if !strings.Contains(rr.Body.String(), `"running":4`) {
		t.Fatalf("body = %q, want the collector payload passed through", rr.Body.String())
	}
}

// "Not running" must be distinguishable from "broken": the UI renders 503 as
// "LocalScope not connected", which is an expected state for an optional
// collector, and anything else as a real error.
func TestProxy_UnreachableCollectorIs503(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	h := handlerFor(t, upstream)
	upstream.Close() // nothing is listening any more

	rr := get(t, router(h), "/localscope/api/system/summary")

	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rr.Code)
	}
	if !strings.Contains(rr.Body.String(), "unreachable") {
		t.Fatalf("body = %q, want an unreachable marker", rr.Body.String())
	}
}

// A collector that answers with its own failure keeps that status, so a real
// fault is not disguised as absence.
func TestProxy_CollectorErrorStatusIsPreserved(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"internal error"}`))
	}))
	defer upstream.Close()

	rr := get(t, router(handlerFor(t, upstream)), "/localscope/api/system/summary")

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want the upstream 500 preserved", rr.Code)
	}
}

// The allowlist is what stops this being a general reverse proxy into loopback.
func TestProxy_UnknownPathIsRefusedWithoutContactingUpstream(t *testing.T) {
	contacted := false
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		contacted = true
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()

	r := router(handlerFor(t, upstream))
	for _, path := range []string{
		"/localscope/api/secrets",
		"/localscope/api/system/../../etc/passwd",
		"/localscope/",
	} {
		rr := get(t, r, path)
		if rr.Code != http.StatusNotFound {
			t.Errorf("%s: status = %d, want 404", path, rr.Code)
		}
	}
	if contacted {
		t.Fatal("upstream was contacted for a non-allowlisted path")
	}
}

func TestProxy_OnlyGETIsRouted(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Error("upstream must not be reached by a non-GET request")
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()

	rr := httptest.NewRecorder()
	router(handlerFor(t, upstream)).ServeHTTP(rr,
		httptest.NewRequest(http.MethodPost, "/localscope/api/system/summary", nil))

	if rr.Code == http.StatusOK {
		t.Fatalf("POST returned 200; only GET should be routed")
	}
}

// Only `all` is forwarded, and no browser header reaches the collector.
func TestProxy_FiltersQueryAndDropsClientHeaders(t *testing.T) {
	var gotQuery string
	var gotCookie, gotAuth string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.RawQuery
		gotCookie = r.Header.Get("Cookie")
		gotAuth = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()

	req := httptest.NewRequest(http.MethodGet, "/localscope/api/system/processes?all=true&evil=1", nil)
	req.Header.Set("Cookie", "auth_token=secret")
	req.Header.Set("Authorization", "Bearer secret")
	rr := httptest.NewRecorder()
	router(handlerFor(t, upstream)).ServeHTTP(rr, req)

	if gotQuery != "all=true" {
		t.Fatalf("upstream query = %q, want only all=true", gotQuery)
	}
	if gotCookie != "" || gotAuth != "" {
		t.Fatalf("credentials leaked upstream: cookie=%q auth=%q", gotCookie, gotAuth)
	}
}

// The upstream Host names the loopback address, so LocalScope's own
// DNS-rebinding guard still passes rather than being bypassed or weakened.
func TestProxy_UpstreamHostIsLoopback(t *testing.T) {
	var gotHost string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotHost = r.Host
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()

	get(t, router(handlerFor(t, upstream)), "/localscope/api/health")

	if !strings.HasPrefix(gotHost, "127.0.0.1:") {
		t.Fatalf("upstream Host = %q, want a 127.0.0.1 host so the rebinding guard passes", gotHost)
	}
}

// A port of 0 disables the feature; Mount must then register nothing, and the
// UI falls back to the same "not connected" state as a stopped collector.
func TestNew_DisabledWhenPortZero(t *testing.T) {
	if New("127.0.0.1", 0) != nil {
		t.Fatal("New with port 0 should return nil")
	}
	if New("", 7317) != nil {
		t.Fatal("New with empty host should return nil")
	}

	r := chi.NewRouter()
	var h *Handler
	h.Mount(r) // must not panic

	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/localscope/api/health", nil))
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 when the proxy is disabled", rr.Code)
	}
}
