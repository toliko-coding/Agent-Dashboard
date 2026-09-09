// Package localscope proxies the LocalScope collector so the SPA can reach it
// from the dashboard's own origin.
//
// LocalScope is a separate, optional, read-only collector that binds 127.0.0.1
// and answers with `Access-Control-Allow-Origin: null` plus a Host-header guard
// (its own DNS-rebinding protection). A browser therefore cannot call it
// directly; in development Vite proxies `/localscope/*`, and this handler does
// the same job for the embedded/production build so the UI behaves identically
// in both.
//
// This is deliberately NOT a general reverse proxy:
//   - the upstream host and port are fixed at construction from server config,
//     never taken from the request;
//   - only an explicit allowlist of collector paths is forwarded;
//   - only GET is accepted, because every LocalScope route is a read;
//   - no client headers are copied upstream, so no cookie, Authorization or
//     other credential can leak to the collector;
//   - the upstream Host header names the loopback address, preserving the
//     collector's rebinding guard rather than weakening it.
package localscope

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"time"

	"github.com/go-chi/chi/v5"
)

// allowedPaths is the exact set of collector routes the dashboard consumes.
// A path outside this set is refused here and never reaches the collector, so
// this handler cannot be used to probe arbitrary loopback URLs.
var allowedPaths = map[string]bool{
	"/api/health":           true,
	"/api/system/summary":   true,
	"/api/system/ports":     true,
	"/api/system/processes": true,
	"/api/system/devices":   true,
	"/api/system/network":   true,
}

// allowedQuery lists query parameters forwarded upstream. LocalScope's list
// endpoints take `all=true` to bypass their relevance filter; everything else
// is dropped rather than passed through blindly.
var allowedQuery = map[string]bool{"all": true}

// requestTimeout bounds a single collector call. LocalScope shells out to lsof,
// ps and adb, so it is not instant — but a hung collector must not hold a
// dashboard connection open indefinitely.
const requestTimeout = 8 * time.Second

// maxResponseBytes caps what is copied back. A process list on a busy machine
// is large but bounded; this stops a misbehaving upstream exhausting memory.
const maxResponseBytes = 8 << 20 // 8 MiB

// Handler proxies a fixed set of LocalScope reads.
type Handler struct {
	baseURL string
	client  *http.Client
	// last is the most recent successful snapshot, so an unreachable collector
	// can be reported as stale rather than as a machine with nothing on it.
	last lastGood
}

// New builds a Handler for the collector at host:port (expected to be
// loopback). Passing an empty host disables the proxy: Mount then registers
// nothing and the UI sees the same "not connected" state as a stopped
// collector.
func New(host string, port int) *Handler {
	if host == "" || port <= 0 {
		return nil
	}
	return &Handler{
		baseURL: fmt.Sprintf("http://%s", net.JoinHostPort(host, fmt.Sprintf("%d", port))),
		client: &http.Client{
			Timeout: requestTimeout,
			// No redirect following: the collector never redirects, and doing so
			// would let an upstream response steer this proxy at another address.
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}
}

// Mount registers the proxy under /localscope, mirroring the dev-server prefix
// so the client uses one URL shape in both environments.
func (h *Handler) Mount(r chi.Router) {
	if h == nil {
		return
	}
	r.Get("/localscope/*", h.proxy)
	// The dashboard's own normalized view. Separate from the proxy on purpose:
	// the proxy forwards LocalScope's contract, this speaks the dashboard's.
	r.Get("/api/localscope/snapshot", h.snapshot)
}

func (h *Handler) proxy(w http.ResponseWriter, r *http.Request) {
	// chi gives us everything after /localscope, which is the collector path.
	upstreamPath := "/" + chi.URLParam(r, "*")
	if !allowedPaths[upstreamPath] {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "unknown localscope path"})
		return
	}

	target := h.baseURL + upstreamPath
	if q := filterQuery(r.URL.Query()); q != "" {
		target += "?" + q
	}

	ctx, cancel := context.WithTimeout(r.Context(), requestTimeout)
	defer cancel()

	// A fresh request with no inherited headers: nothing from the browser —
	// cookies, Authorization, custom headers — is forwarded to the collector.
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "bad upstream request"})
		return
	}
	req.Header.Set("Accept", "application/json")

	resp, err := h.client.Do(req)
	if err != nil {
		// "Not running" and "timed out" are both unavailability, not failure of
		// the collector's logic — the UI shows "LocalScope not connected" for
		// 503 and treats other statuses as real errors.
		status := http.StatusServiceUnavailable
		msg := "localscope unreachable"
		if errors.Is(err, context.DeadlineExceeded) {
			status = http.StatusGatewayTimeout
			msg = "localscope timed out"
		}
		writeJSON(w, status, map[string]string{"error": msg})
		return
	}
	defer func() { _ = resp.Body.Close() }()

	// Pass the collector's own status through, so a genuine collector-side
	// error stays distinguishable from the collector being absent.
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, io.LimitReader(resp.Body, maxResponseBytes))
}

// filterQuery re-encodes only the allowlisted parameters.
func filterQuery(in url.Values) string {
	out := url.Values{}
	for key, values := range in {
		if allowedQuery[key] && len(values) > 0 {
			out.Set(key, values[0])
		}
	}
	return out.Encode()
}

func writeJSON(w http.ResponseWriter, status int, body map[string]string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	payload := `{"error":"` + body["error"] + `"}`
	_, _ = io.WriteString(w, payload)
}
