package localscope

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"
)

/*
 * The property under test throughout: a list the collector did not produce must
 * never arrive as [], because "looked and found none" is a claim only the
 * collector may make.
 */

func getServices(t *testing.T, r *chi.Mux) ServicesResponse {
	t.Helper()
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/localscope/services", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	var out ServicesResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out), "body: %s", rec.Body.String())
	return out
}

func getProcesses(t *testing.T, r *chi.Mux) ProcessesResponse {
	t.Helper()
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/localscope/processes", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	var out ProcessesResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out), "body: %s", rec.Body.String())
	return out
}

// rawItemsNull reports whether the wire form carried `"items": null` rather
// than `[]` — the distinction the whole model protects.
func rawItemsNull(t *testing.T, r *chi.Mux, path string) bool {
	t.Helper()
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	var probe struct {
		Items *json.RawMessage `json:"items"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &probe))
	return probe.Items == nil || string(*probe.Items) == "null"
}

const oneService = `[{
	"id":"87234:5173","port":5173,"address":"127.0.0.1","bindScope":"loopback",
	"protocol":"tcp","ipVersion":"ipv4","pid":87234,"processName":"node",
	"command":"node vite.js --port 5173","cwd":"/gh/Agent-Dashboard","runtime":"node",
	"kind":"vite","label":"Vite Development Server","url":"http://localhost:5173",
	"project":{"id":"p1","name":"Agent-Dashboard","rootPath":"/gh/Agent-Dashboard","manifest":"package.json"},
	"confidence":"high","startedAt":"2026-01-01T00:00:00Z"
}]`

const oneProcess = `{"processes":[{
	"id":"87234","pid":87234,"ppid":1,"name":"node",
	"command":"node vite.js --port 5173","cwd":"/gh/Agent-Dashboard","runtime":"node",
	"cpuPercent":12.5,"memoryBytes":104857600,"elapsedSeconds":3600,
	"startedAt":"2026-01-01T00:00:00Z",
	"project":{"id":"p1","name":"Agent-Dashboard","rootPath":"/gh/Agent-Dashboard","manifest":"package.json"},
	"ports":[5173],"relevant":true,"relevanceReasons":["runtime-match","listening"]
}],"total":818}`

func listBody(data, collectedAt, degraded string) string {
	if degraded == "" {
		degraded = "[]"
	}
	return `{"data":` + data + `,"degraded":` + degraded + `,"collectedAt":"` + collectedAt + `","durationMs":12}`
}

// --- services ---

func TestServices_HealthyNonEmpty(t *testing.T) {
	u := newUpstream(t)
	u.body = listBody(oneService, nowISO(), "")
	_, r := snapshotHandlerFor(t, u)

	got := getServices(t, r)
	require.Equal(t, SourceOK, got.Source)
	require.Len(t, got.Items, 1)
	s := got.Items[0]
	require.Equal(t, "87234:5173", s.ID, "LocalScope's stable id is preserved verbatim")
	require.Equal(t, 87234, s.PID)
	require.Equal(t, 5173, s.Port)
	require.Equal(t, "loopback", s.BindScope)
	require.Equal(t, "vite", s.Kind)
	require.Equal(t, "Vite Development Server", s.Label)
	require.Equal(t, "node vite.js --port 5173", s.Command, "the collector's sanitized command passes through")
	require.Equal(t, "high", s.Confidence)
	require.NotNil(t, s.URL)
	require.NotNil(t, s.StartedAt)
	require.NotNil(t, s.DiscoveredProject)
	require.Equal(t, "/gh/Agent-Dashboard", s.DiscoveredProject.RootPath)
	require.Equal(t, "Agent-Dashboard", s.DiscoveredProject.Name)
}

func TestServices_HealthyEmptyIsAnAnswer(t *testing.T) {
	u := newUpstream(t)
	u.body = listBody(`[]`, nowISO(), "")
	_, r := snapshotHandlerFor(t, u)

	got := getServices(t, r)
	require.Equal(t, SourceOK, got.Source)
	require.NotNil(t, got.Items)
	require.Empty(t, got.Items)
	require.False(t, rawItemsNull(t, r, "/api/localscope/services"),
		"a collected empty list must be [] on the wire, never null")
}

func TestServices_Degraded(t *testing.T) {
	u := newUpstream(t)
	u.body = listBody(oneService, nowISO(),
		`[{"source":"lsof:listen","reason":"insufficient permission for some sockets","kind":"partial"}]`)
	_, r := snapshotHandlerFor(t, u)

	got := getServices(t, r)
	require.Equal(t, SourceDegraded, got.Source)
	require.Len(t, got.Degraded, 1)
	require.Equal(t, "lsof:listen", got.Degraded[0].Source)
	require.Len(t, got.Items, 1, "a degraded run still reports what it found")
}

func TestServices_UnreachableWithNoHistory(t *testing.T) {
	_, r := snapshotDeadHandler(t)

	got := getServices(t, r)
	require.Equal(t, SourceUnavailable, got.Source)
	require.Nil(t, got.Items, "unknown is not empty")
	require.True(t, rawItemsNull(t, r, "/api/localscope/services"))
	require.Nil(t, got.CollectedAt)
	require.NotNil(t, got.Degraded)
}

func TestServices_GoodThenUnreachableIsStale(t *testing.T) {
	u := newUpstream(t)
	u.body = listBody(oneService, nowISO(), "")
	_, r := snapshotHandlerFor(t, u)
	require.Equal(t, SourceOK, getServices(t, r).Source)

	u.srv.Close()

	got := getServices(t, r)
	require.Equal(t, SourceStale, got.Source)
	require.Len(t, got.Items, 1, "the last observed list is kept")
	require.Equal(t, "87234:5173", got.Items[0].ID)
	require.NotNil(t, got.AgeMs, "stale must say how stale")
}

func TestServices_MalformedNeverBecomesEmpty(t *testing.T) {
	cases := map[string]string{
		"invalid json":      `<html>boom</html>`,
		"missing data":      `{"degraded":[],"collectedAt":"2026-01-01T00:00:00Z"}`,
		"data null":         `{"data":null,"degraded":[],"collectedAt":"2026-01-01T00:00:00Z"}`,
		"data is object":    `{"data":{},"degraded":[],"collectedAt":"2026-01-01T00:00:00Z"}`,
		"wrong field type":  `{"data":[{"id":"x","port":"not-a-number"}],"degraded":[],"collectedAt":"2026-01-01T00:00:00Z"}`,
		"bad collectedAt":   listBody(oneService, "yesterday", ""),
		"empty collectedAt": listBody(oneService, "", ""),
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			u := newUpstream(t)
			u.body = body
			_, r := snapshotHandlerFor(t, u)

			got := getServices(t, r)
			require.Equal(t, SourceUnavailable, got.Source)
			require.Nil(t, got.Items, "a response we could not read is not an empty machine")
		})
	}
}

func TestServices_UpstreamNon200(t *testing.T) {
	u := newUpstream(t)
	u.status = http.StatusInternalServerError
	u.body = `{"error":"internal"}`
	_, r := snapshotHandlerFor(t, u)

	got := getServices(t, r)
	require.Equal(t, SourceUnavailable, got.Source)
	require.Nil(t, got.Items)
}

func TestServices_MalformedAfterGoodIsStale(t *testing.T) {
	u := newUpstream(t)
	u.body = listBody(oneService, nowISO(), "")
	_, r := snapshotHandlerFor(t, u)
	require.Equal(t, SourceOK, getServices(t, r).Source)

	u.body = `{"totally":"different"}`
	got := getServices(t, r)
	require.Equal(t, SourceStale, got.Source)
	require.Len(t, got.Items, 1)
}

// --- processes ---

func TestProcesses_HealthyNonEmpty(t *testing.T) {
	u := newUpstream(t)
	u.body = listBody(oneProcess, nowISO(), "")
	_, r := snapshotHandlerFor(t, u)

	got := getProcesses(t, r)
	require.Equal(t, SourceOK, got.Source)
	require.Len(t, got.Items, 1)
	p := got.Items[0]
	require.Equal(t, "87234", p.ID)
	require.Equal(t, 87234, p.PID)
	require.Equal(t, 1, p.PPID)
	require.Equal(t, "node", p.Name)
	require.Equal(t, "node vite.js --port 5173", p.Command)
	require.Equal(t, []int{5173}, p.Ports)
	require.Equal(t, []string{"runtime-match", "listening"}, p.RelevanceReason)
	require.NotNil(t, p.CPUPercent)
	require.InDelta(t, 12.5, *p.CPUPercent, 0.001)
	require.NotNil(t, p.MemoryBytes)
	require.Equal(t, int64(104857600), *p.MemoryBytes)
	require.NotNil(t, p.DiscoveredProject)
	require.Equal(t, "/gh/Agent-Dashboard", p.DiscoveredProject.RootPath)
	require.NotNil(t, got.Total)
	require.Equal(t, 818, *got.Total, "the denominator makes the filtering legible")
}

// A process whose figures ps did not report keeps them null rather than 0.
func TestProcesses_NullableFieldsStayNull(t *testing.T) {
	u := newUpstream(t)
	u.body = listBody(`{"processes":[{
		"id":"5","pid":5,"ppid":1,"name":"node","command":"node x.js",
		"cwd":null,"runtime":"node","cpuPercent":null,"memoryBytes":null,
		"elapsedSeconds":null,"startedAt":null,"project":null,
		"ports":[],"relevant":true,"relevanceReasons":[]
	}],"total":null}`, nowISO(), "")
	_, r := snapshotHandlerFor(t, u)

	got := getProcesses(t, r)
	p := got.Items[0]
	require.Nil(t, p.CPUPercent, "not reported is not 0%")
	require.Nil(t, p.MemoryBytes)
	require.Nil(t, p.ElapsedSeconds)
	require.Nil(t, p.StartedAt)
	require.Nil(t, p.Cwd)
	require.Nil(t, p.DiscoveredProject)
	require.NotNil(t, p.Ports, "no listeners is a fact: [] not null")
	require.Empty(t, p.Ports)
	require.Nil(t, got.Total, "an unknown denominator stays unknown")
}

func TestProcesses_HealthyEmptyIsAnAnswer(t *testing.T) {
	u := newUpstream(t)
	u.body = listBody(`{"processes":[],"total":818}`, nowISO(), "")
	_, r := snapshotHandlerFor(t, u)

	got := getProcesses(t, r)
	require.Equal(t, SourceOK, got.Source)
	require.NotNil(t, got.Items)
	require.Empty(t, got.Items)
	require.False(t, rawItemsNull(t, r, "/api/localscope/processes"))
	require.Equal(t, 818, *got.Total)
}

func TestProcesses_Degraded(t *testing.T) {
	u := newUpstream(t)
	u.body = listBody(oneProcess, nowISO(),
		`[{"source":"ps","reason":"cwd unreadable for some pids","kind":"partial"}]`)
	_, r := snapshotHandlerFor(t, u)

	got := getProcesses(t, r)
	require.Equal(t, SourceDegraded, got.Source)
	require.Len(t, got.Degraded, 1)
	require.Len(t, got.Items, 1)
}

func TestProcesses_UnreachableWithNoHistory(t *testing.T) {
	_, r := snapshotDeadHandler(t)

	got := getProcesses(t, r)
	require.Equal(t, SourceUnavailable, got.Source)
	require.Nil(t, got.Items)
	require.Nil(t, got.Total)
	require.True(t, rawItemsNull(t, r, "/api/localscope/processes"))
}

func TestProcesses_GoodThenUnreachableIsStale(t *testing.T) {
	u := newUpstream(t)
	u.body = listBody(oneProcess, nowISO(), "")
	_, r := snapshotHandlerFor(t, u)
	require.Equal(t, SourceOK, getProcesses(t, r).Source)

	u.srv.Close()

	got := getProcesses(t, r)
	require.Equal(t, SourceStale, got.Source)
	require.Len(t, got.Items, 1)
	require.Equal(t, "87234", got.Items[0].ID)
	require.NotNil(t, got.Total, "the denominator is retained with the list")
	require.NotNil(t, got.AgeMs)
}

func TestProcesses_MalformedNeverBecomesEmpty(t *testing.T) {
	cases := map[string]string{
		"invalid json":     `not json at all`,
		"missing data":     `{"degraded":[],"collectedAt":"2026-01-01T00:00:00Z"}`,
		"data null":        `{"data":null,"degraded":[],"collectedAt":"2026-01-01T00:00:00Z"}`,
		"wrong field type": listBody(`{"processes":[{"pid":"eighty-seven"}],"total":1}`, nowISO(), ""),
		"bad collectedAt":  listBody(oneProcess, "not-a-date", ""),
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			u := newUpstream(t)
			u.body = body
			_, r := snapshotHandlerFor(t, u)

			got := getProcesses(t, r)
			require.Equal(t, SourceUnavailable, got.Source)
			require.Nil(t, got.Items)
		})
	}
}

// --- shared behaviour ---

// A sample older than the window is stale even though the collector answered,
// exactly as it is for the summary. One state machine, three endpoints.
func TestLists_OldSampleIsStaleEvenWhenReachable(t *testing.T) {
	old := time.Now().Add(-2 * staleAfter).UTC().Format(time.RFC3339)

	u := newUpstream(t)
	u.body = listBody(oneService, old, "")
	_, r := snapshotHandlerFor(t, u)
	require.Equal(t, SourceStale, getServices(t, r).Source)

	u2 := newUpstream(t)
	u2.body = listBody(oneProcess, old, "")
	_, r2 := snapshotHandlerFor(t, u2)
	require.Equal(t, SourceStale, getProcesses(t, r2).Source)
}

// Neither list endpoint builds a query string, so `all=true` — which bypasses
// LocalScope's relevance filter AND its cache — is not reachable through them.
func TestLists_UpstreamRequestIsCleanAndFiltered(t *testing.T) {
	for path, want := range map[string]string{
		"/api/localscope/services":  "/api/system/ports",
		"/api/localscope/processes": "/api/system/processes",
	} {
		t.Run(path, func(t *testing.T) {
			u := newUpstream(t)
			u.body = listBody(oneService, nowISO(), "")
			if want == "/api/system/processes" {
				u.body = listBody(oneProcess, nowISO(), "")
			}
			_, r := snapshotHandlerFor(t, u)

			req := httptest.NewRequest(http.MethodGet, path+"?all=true&evil=1", nil)
			req.Header.Set("Cookie", "auth_token=secret")
			req.Header.Set("Authorization", "Bearer secret")
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, req)
			require.Equal(t, http.StatusOK, rec.Code)

			require.Equal(t, want, u.lastPath)
			require.Empty(t, u.lastQury, "all=true must not reach the collector")
			require.Empty(t, u.lastHdrs.Get("Cookie"))
			require.Empty(t, u.lastHdrs.Get("Authorization"))
		})
	}
}

// The three endpoints answer with one vocabulary, so no surface has to
// translate between them.
func TestLists_ShareTheSummaryStateVocabulary(t *testing.T) {
	_, r := snapshotDeadHandler(t)
	require.Equal(t, SourceUnavailable, getSnapshot(t, r).Source)
	require.Equal(t, SourceUnavailable, getServices(t, r).Source)
	require.Equal(t, SourceUnavailable, getProcesses(t, r).Source)
}

// Disabled collector: no list routes either.
func TestLists_NotMountedWhenPortIsZero(t *testing.T) {
	r := chi.NewRouter()
	New("127.0.0.1", 0).Mount(r)
	for _, path := range []string{"/api/localscope/services", "/api/localscope/processes"} {
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		require.Equal(t, http.StatusNotFound, rec.Code)
	}
}
