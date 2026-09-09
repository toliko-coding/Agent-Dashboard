package localscope

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"
)

/*
 * The property under test throughout: a count the collector did not produce
 * must never arrive as zero, and a collector that cannot be reached must never
 * look like a machine with nothing running on it.
 */

// upstream stands in for the LocalScope collector and records what it was sent,
// so the tests can assert on the request as well as the response.
type upstream struct {
	srv      *httptest.Server
	status   int
	body     string
	lastPath string
	lastQury string
	lastHdrs http.Header
	calls    int
}

func newUpstream(t *testing.T) *upstream {
	t.Helper()
	u := &upstream{status: http.StatusOK}
	u.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u.calls++
		u.lastPath = r.URL.Path
		u.lastQury = r.URL.RawQuery
		u.lastHdrs = r.Header.Clone()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(u.status)
		_, _ = w.Write([]byte(u.body))
	}))
	t.Cleanup(u.srv.Close)
	return u
}

// snapshotHandlerFor points a Handler at the fake collector and mounts it.
// Named apart from handler_test.go's handlerFor, which builds a proxy without
// a router.
func snapshotHandlerFor(t *testing.T, u *upstream) (*Handler, *chi.Mux) {
	t.Helper()
	host, port, err := net.SplitHostPort(strings.TrimPrefix(u.srv.URL, "http://"))
	require.NoError(t, err)
	var p int
	_, err = fmt.Sscanf(port, "%d", &p)
	require.NoError(t, err)

	h := New(host, p)
	require.NotNil(t, h)
	r := chi.NewRouter()
	h.Mount(r)
	return h, r
}

// deadHandler points at a port with nothing listening.
func snapshotDeadHandler(t *testing.T) (*Handler, *chi.Mux) {
	t.Helper()
	// Port 1 is privileged and unbound in test environments; any connection
	// attempt fails immediately rather than hanging.
	h := New("127.0.0.1", 1)
	require.NotNil(t, h)
	r := chi.NewRouter()
	h.Mount(r)
	return h, r
}

func getSnapshot(t *testing.T, r *chi.Mux) Snapshot {
	t.Helper()
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/localscope/snapshot", nil))
	require.Equal(t, http.StatusOK, rec.Code,
		"an unreachable collector is an answer, not an error of this endpoint")
	var s Snapshot
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &s), "body: %s", rec.Body.String())
	return s
}

func summaryBody(collectedAt string, services, relevant, total, devices, network, projects string, degraded string) string {
	if degraded == "" {
		degraded = "[]"
	}
	return fmt.Sprintf(`{
		"data": {
			"services": {"running": %s},
			"processes": {"relevant": %s, "total": %s},
			"devices": {"connected": %s},
			"network": {"active": %s},
			"projects": {"active": %s}
		},
		"degraded": %s,
		"collectedAt": %q,
		"durationMs": 42
	}`, services, relevant, total, devices, network, projects, degraded, collectedAt)
}

func nowISO() string { return time.Now().UTC().Format(time.RFC3339) }

// A. Healthy summary.
func TestSnapshot_HealthySummary(t *testing.T) {
	u := newUpstream(t)
	u.body = summaryBody(nowISO(), "4", "13", "782", "1", "22", "3", "")
	_, r := snapshotHandlerFor(t, u)

	s := getSnapshot(t, r)
	require.Equal(t, SourceOK, s.Source)
	require.NotNil(t, s.CollectedAt)
	require.NotNil(t, s.AgeMs)
	require.Empty(t, s.Degraded)
	require.Equal(t, 4, *s.Counts.Services)
	require.Equal(t, 13, *s.Counts.ProcessesRelevant)
	require.Equal(t, 782, *s.Counts.ProcessesTotal)
	require.Equal(t, 1, *s.Counts.Devices)
	require.Equal(t, 3, *s.Counts.Projects)
}

// B. A measured zero is a real answer and must survive as 0.
func TestSnapshot_ZeroCountsArePreserved(t *testing.T) {
	u := newUpstream(t)
	u.body = summaryBody(nowISO(), "0", "0", "0", "0", "0", "0", "")
	_, r := snapshotHandlerFor(t, u)

	s := getSnapshot(t, r)
	require.Equal(t, SourceOK, s.Source)
	require.NotNil(t, s.Counts.Services)
	require.Equal(t, 0, *s.Counts.Services)
	require.NotNil(t, s.Counts.Devices)
	require.Equal(t, 0, *s.Counts.Devices)
}

// C. An uncollected count stays unknown. This is the case that would be
// destroyed by a non-pointer field.
func TestSnapshot_NullCountsStayNull(t *testing.T) {
	u := newUpstream(t)
	u.body = summaryBody(nowISO(), "4", "13", "782", "null", "null", "3", "")
	_, r := snapshotHandlerFor(t, u)

	s := getSnapshot(t, r)
	require.Nil(t, s.Counts.Devices, "no adapter ran: unknown, not zero")
	require.Nil(t, s.Counts.Network)
	require.NotNil(t, s.Counts.Services)
	require.Equal(t, 4, *s.Counts.Services)
}

// D. Degraded: the counts that were gathered are still real.
func TestSnapshot_DegradedSourcePassesThrough(t *testing.T) {
	u := newUpstream(t)
	u.body = summaryBody(nowISO(), "4", "13", "782", "null", "22", "3",
		`[{"source":"adb","reason":"adb is not installed","kind":"missing"}]`)
	_, r := snapshotHandlerFor(t, u)

	s := getSnapshot(t, r)
	require.Equal(t, SourceDegraded, s.Source)
	require.Len(t, s.Degraded, 1)
	require.Equal(t, "adb", s.Degraded[0].Source)
	require.Equal(t, "missing", s.Degraded[0].Kind)
	require.Equal(t, 4, *s.Counts.Services, "a degraded run still reports what it measured")
}

// E. Unreachable with nothing previously observed.
func TestSnapshot_UnreachableWithNoHistory(t *testing.T) {
	_, r := snapshotDeadHandler(t)

	s := getSnapshot(t, r)
	require.Equal(t, SourceUnavailable, s.Source)
	require.Nil(t, s.CollectedAt)
	require.Nil(t, s.AgeMs)
	require.NotNil(t, s.Degraded, "degraded is a list, never null")
	require.Empty(t, s.Degraded)
	// The whole point: nothing is claimed about the machine.
	require.Nil(t, s.Counts.Services)
	require.Nil(t, s.Counts.ProcessesRelevant)
	require.Nil(t, s.Counts.ProcessesTotal)
	require.Nil(t, s.Counts.Devices)
	require.Nil(t, s.Counts.Network)
	require.Nil(t, s.Counts.Projects)
}

// F. Good sample, then the collector goes away: the last reading is retained
// and labelled stale rather than being replaced by an empty machine.
func TestSnapshot_GoodThenUnreachableBecomesStale(t *testing.T) {
	u := newUpstream(t)
	u.body = summaryBody(nowISO(), "4", "13", "782", "1", "22", "3", "")
	h, r := snapshotHandlerFor(t, u)

	first := getSnapshot(t, r)
	require.Equal(t, SourceOK, first.Source)

	// Collector stops answering.
	u.srv.Close()

	second := getSnapshot(t, r)
	require.Equal(t, SourceStale, second.Source)
	require.NotNil(t, second.Counts.Services)
	require.Equal(t, 4, *second.Counts.Services, "the last true reading is kept")
	require.NotNil(t, second.AgeMs, "stale must say how stale")
	require.NotNil(t, second.CollectedAt)
	_ = h
}

// A sample the collector itself reports as older than the window is stale even
// though the collector answered.
func TestSnapshot_OldSampleIsStaleEvenWhenReachable(t *testing.T) {
	u := newUpstream(t)
	old := time.Now().Add(-2 * staleAfter).UTC().Format(time.RFC3339)
	u.body = summaryBody(old, "4", "13", "782", "1", "22", "3", "")
	_, r := snapshotHandlerFor(t, u)

	s := getSnapshot(t, r)
	require.Equal(t, SourceStale, s.Source)
	require.Equal(t, 4, *s.Counts.Services)
	require.Greater(t, *s.AgeMs, staleAfter.Milliseconds())
}

// G. A response that is not the contract must not decode into zeros.
func TestSnapshot_MalformedResponses(t *testing.T) {
	cases := map[string]string{
		"not json":             `<html>collector crashed</html>`,
		"empty body":           ``,
		"data is null":         `{"data":null,"degraded":[],"collectedAt":"2026-01-01T00:00:00Z"}`,
		"data missing":         `{"degraded":[],"collectedAt":"2026-01-01T00:00:00Z"}`,
		"count is a string":    `{"data":{"services":{"running":"four"}},"degraded":[],"collectedAt":"2026-01-01T00:00:00Z"}`,
		"data is an array":     `{"data":[],"degraded":[],"collectedAt":"2026-01-01T00:00:00Z"}`,
		"whole body is a list": `[]`,
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			u := newUpstream(t)
			u.body = body
			_, r := snapshotHandlerFor(t, u)

			s := getSnapshot(t, r)
			require.Equal(t, SourceUnavailable, s.Source,
				"an unrecognisable contract must not be reported as a healthy machine")
			require.Nil(t, s.Counts.Services)
			require.Nil(t, s.Counts.Devices)
		})
	}
}

// A non-200 from the collector is unavailability, not data.
func TestSnapshot_UpstreamErrorStatus(t *testing.T) {
	u := newUpstream(t)
	u.status = http.StatusInternalServerError
	u.body = `{"error":"internal error"}`
	_, r := snapshotHandlerFor(t, u)

	s := getSnapshot(t, r)
	require.Equal(t, SourceUnavailable, s.Source)
	require.Nil(t, s.Counts.Services)
}

// H. Without a usable timestamp there is no way to say whether the counts are
// current, so they are not presented as if they were.
func TestSnapshot_InvalidOrMissingCollectedAt(t *testing.T) {
	for name, ts := range map[string]string{
		"empty":       "",
		"not a date":  "yesterday",
		"wrong shape": "2026/01/01 10:00",
	} {
		t.Run(name, func(t *testing.T) {
			u := newUpstream(t)
			u.body = summaryBody(ts, "4", "13", "782", "1", "22", "3", "")
			_, r := snapshotHandlerFor(t, u)

			s := getSnapshot(t, r)
			require.Equal(t, SourceUnavailable, s.Source)
			require.Nil(t, s.Counts.Services)
		})
	}
}

// A malformed response after a good one falls back to stale, not to zeros.
func TestSnapshot_MalformedAfterGoodIsStale(t *testing.T) {
	u := newUpstream(t)
	u.body = summaryBody(nowISO(), "7", "13", "782", "1", "22", "3", "")
	_, r := snapshotHandlerFor(t, u)
	require.Equal(t, SourceOK, getSnapshot(t, r).Source)

	u.body = `{"totally":"different"}`
	s := getSnapshot(t, r)
	require.Equal(t, SourceStale, s.Source)
	require.Equal(t, 7, *s.Counts.Services)
}

// I. network.active comes from the summary, mapped onto counts.network.
func TestSnapshot_NetworkCountIsMapped(t *testing.T) {
	u := newUpstream(t)
	u.body = summaryBody(nowISO(), "4", "13", "782", "1", "22", "3", "")
	_, r := snapshotHandlerFor(t, u)

	s := getSnapshot(t, r)
	require.NotNil(t, s.Counts.Network)
	require.Equal(t, 22, *s.Counts.Network)
}

// J. One upstream call, one path, no query string, and none of the caller's
// headers. `all=true` is not reachable through this endpoint at all.
func TestSnapshot_UpstreamRequestIsMinimalAndClean(t *testing.T) {
	u := newUpstream(t)
	u.body = summaryBody(nowISO(), "4", "13", "782", "1", "22", "3", "")
	_, r := snapshotHandlerFor(t, u)

	req := httptest.NewRequest(http.MethodGet, "/api/localscope/snapshot?all=true&evil=1", nil)
	req.Header.Set("Cookie", "auth_token=secret")
	req.Header.Set("Authorization", "Bearer secret")
	req.Header.Set("X-Custom", "leak-me")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)

	require.Equal(t, 1, u.calls, "one coherent sample, not one call per field")
	require.Equal(t, "/api/system/summary", u.lastPath, "health adds nothing this model reports")
	require.Empty(t, u.lastQury, "no query is ever forwarded, so all=true cannot amplify here")
	require.Empty(t, u.lastHdrs.Get("Cookie"))
	require.Empty(t, u.lastHdrs.Get("Authorization"))
	require.Empty(t, u.lastHdrs.Get("X-Custom"))
}

// The endpoint answers 200 with a state rather than an HTTP error, so a client
// always has something to render.
func TestSnapshot_AlwaysAnswers200(t *testing.T) {
	_, r := snapshotDeadHandler(t)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/localscope/snapshot", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	require.Equal(t, "no-store", rec.Header().Get("Cache-Control"))
	require.Equal(t, "nosniff", rec.Header().Get("X-Content-Type-Options"))
}

// A disabled collector registers no routes at all, snapshot included.
func TestSnapshot_NotMountedWhenPortIsZero(t *testing.T) {
	require.Nil(t, New("127.0.0.1", 0))
	r := chi.NewRouter()
	New("127.0.0.1", 0).Mount(r)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/localscope/snapshot", nil))
	require.Equal(t, http.StatusNotFound, rec.Code)
}

// The existing proxy allow-list is unchanged by this work.
func TestSnapshot_ProxyAllowListUnchanged(t *testing.T) {
	require.Equal(t, map[string]bool{
		"/api/health":           true,
		"/api/system/summary":   true,
		"/api/system/ports":     true,
		"/api/system/processes": true,
		"/api/system/devices":   true,
		"/api/system/network":   true,
	}, allowedPaths)
	require.Equal(t, map[string]bool{"all": true}, allowedQuery)
	require.Equal(t, "all=true", filterQuery(url.Values{"all": {"true"}, "drop": {"me"}}))
}
