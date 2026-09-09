package localscope

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"sync"
	"time"
)

/*
 * The dashboard's own view of the local machine.
 *
 * LocalScope's wire shape — CollectorResult<SystemSummary> — is its contract,
 * not ours. Translating it here means UI components never learn the collector's
 * envelope, and a change on that side lands in one file instead of every card.
 *
 * The distinction this model exists to protect is that a count of zero and an
 * absent count are different claims. LocalScope already makes it: a device
 * count is null when no adapter ran, and 0 only when one ran and found none.
 * Collapsing that into 0 would report "no emulators" for a machine with no
 * Android SDK installed. The same holds one level up: a collector that cannot
 * be reached is not a machine with nothing on it.
 */

// SnapshotSource is how much the reported counts can be trusted.
type SnapshotSource string

const (
	// SourceOK — collected just now, every contributing source healthy.
	SourceOK SnapshotSource = "ok"
	// SourceDegraded — collected just now, but at least one source reported a
	// problem. The counts that were gathered are still real.
	SourceDegraded SnapshotSource = "degraded"
	// SourceStale — these counts were true at collectedAt, and are not known to
	// be true now: either the collector has since become unreachable, or the
	// sample it returned is older than the freshness window.
	SourceStale SnapshotSource = "stale"
	// SourceUnavailable — nothing usable. No counts, and none are invented.
	SourceUnavailable SnapshotSource = "unavailable"
)

/*
 * staleAfter is how old a sample may be before it stops counting as current.
 *
 * Sized from the cadence it has to sit above: LocalScope caches a summary for
 * 2s, the dashboard polls every 5s, and a single collector call is allowed 8s
 * before it times out. Thirty seconds is about six poll cycles — long enough
 * that an ordinary slow scan or a missed tick is not announced as staleness,
 * short enough that a collector which died is not still being quoted as
 * current a minute later.
 */
const staleAfter = 30 * time.Second

// Degradation is one collector that could not run, or ran with reduced
// fidelity. Passed through from LocalScope rather than re-worded: it is the
// collector's own account of what it could not do.
type Degradation struct {
	Source string `json:"source"`
	Reason string `json:"reason"`
	// Kind is LocalScope's classification: missing, unavailable, timeout,
	// partial or failed.
	Kind string `json:"kind"`
}

/*
 * Counts are nullable on purpose, all the way through.
 *
 * A pointer here is the difference between "measured, and it was none" and
 * "not measured". Every consumer has to handle nil, which is the point — a
 * plain int would let a missing value read as zero at every call site.
 */
type Counts struct {
	Services          *int `json:"services"`
	ProcessesRelevant *int `json:"processesRelevant"`
	ProcessesTotal    *int `json:"processesTotal"`
	Devices           *int `json:"devices"`
	Network           *int `json:"network"`
	Projects          *int `json:"projects"`
}

// Snapshot is what GET /api/localscope/snapshot returns.
type Snapshot struct {
	Source SnapshotSource `json:"source"`
	// CollectedAt is when the counts were true, from the collector's own clock.
	// Null when there has never been a successful collection.
	CollectedAt *string `json:"collectedAt"`
	// AgeMs is how old those counts are as of this response. Null alongside
	// CollectedAt; it is what lets a surface say how stale "stale" is.
	AgeMs *int64 `json:"ageMs"`
	// Degraded is never null — an empty list means every source succeeded.
	Degraded []Degradation `json:"degraded"`
	Counts   Counts        `json:"counts"`
}

/*
 * summaryEnvelope is the subset of LocalScope's response this endpoint reads.
 *
 * Decoded into pointers so a type mismatch is an error rather than a zero: if
 * the collector ever sent a string where a count belongs, encoding/json fails
 * the whole decode and this endpoint reports unavailable. That is the intended
 * behaviour — the one outcome that must never happen is a contract change
 * silently arriving as "0 services".
 */
type summaryEnvelope struct {
	Data *struct {
		Services  *struct{ Running *int } `json:"services"`
		Processes *struct {
			Relevant *int `json:"relevant"`
			Total    *int `json:"total"`
		} `json:"processes"`
		Devices  *struct{ Connected *int } `json:"devices"`
		Network  *struct{ Active *int }    `json:"network"`
		Projects *struct{ Active *int }    `json:"projects"`
	} `json:"data"`
	Degraded    []Degradation `json:"degraded"`
	CollectedAt string        `json:"collectedAt"`
}

// lastGood remembers the most recent successful collection so an unreachable
// collector can be reported as stale rather than as an empty machine.
//
// Memory only, and deliberately: this is a freshness hint, not a record. A
// restarted dashboard has simply never observed the collector yet, which is
// exactly what "unavailable" already means.
type lastGood struct {
	mu          sync.Mutex
	have        bool
	counts      Counts
	degraded    []Degradation
	collectedAt time.Time
	raw         string
}

func (l *lastGood) store(counts Counts, degraded []Degradation, at time.Time, raw string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.have, l.counts, l.degraded, l.collectedAt, l.raw = true, counts, degraded, at, raw
}

func (l *lastGood) load() (Counts, []Degradation, time.Time, string, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.counts, l.degraded, l.collectedAt, l.raw, l.have
}

// snapshot handles GET /api/localscope/snapshot.
//
// It reads ONE upstream endpoint. /api/system/summary already carries every
// count, the degraded list and the collection timestamp, so calling /api/health
// as well would add a platform string nothing here reports — and would compose
// one snapshot from two samples taken at different moments, which is precisely
// the incoherence this model exists to avoid.
func (h *Handler) snapshot(w http.ResponseWriter, r *http.Request) {
	body, err := h.fetchUpstream(r.Context(), "/api/system/summary")
	if err != nil {
		writeSnapshot(w, h.staleOrUnavailable())
		return
	}

	env, parseErr := parseSummary(body)
	if parseErr != nil {
		// A response that does not match the contract is treated exactly like
		// an unreachable collector. Guessing at a partial decode is how a
		// renamed field becomes a machine with nothing running on it.
		writeSnapshot(w, h.staleOrUnavailable())
		return
	}

	collectedAt, timeErr := time.Parse(time.RFC3339, env.CollectedAt)
	if timeErr != nil {
		// Without a trustworthy timestamp there is no way to say whether these
		// counts are current, and "unknown age" is not a state this model has.
		writeSnapshot(w, h.staleOrUnavailable())
		return
	}

	counts := countsFrom(env)
	degraded := env.Degraded
	if degraded == nil {
		degraded = []Degradation{}
	}
	h.last.store(counts, degraded, collectedAt, env.CollectedAt)

	age := time.Since(collectedAt)
	source := SourceOK
	switch {
	case age > staleAfter:
		// Reachable, but quoting a sample too old to call current.
		source = SourceStale
	case len(degraded) > 0:
		source = SourceDegraded
	}

	writeSnapshot(w, Snapshot{
		Source:      source,
		CollectedAt: &env.CollectedAt,
		AgeMs:       msPtr(age),
		Degraded:    degraded,
		Counts:      counts,
	})
}

// staleOrUnavailable is the answer whenever this call could not produce a
// current reading: the previous one if there was one, and nothing otherwise.
func (h *Handler) staleOrUnavailable() Snapshot {
	counts, degraded, at, raw, have := h.last.load()
	if !have {
		// Never observed. Every count stays nil — an unreachable collector says
		// nothing about the machine, least of all that it is empty.
		return Snapshot{Source: SourceUnavailable, Degraded: []Degradation{}}
	}
	return Snapshot{
		Source:      SourceStale,
		CollectedAt: &raw,
		AgeMs:       msPtr(time.Since(at)),
		Degraded:    degraded,
		Counts:      counts,
	}
}

func countsFrom(env summaryEnvelope) Counts {
	var c Counts
	d := env.Data
	if d == nil {
		return c
	}
	if d.Services != nil {
		c.Services = d.Services.Running
	}
	if d.Processes != nil {
		c.ProcessesRelevant = d.Processes.Relevant
		c.ProcessesTotal = d.Processes.Total
	}
	if d.Devices != nil {
		c.Devices = d.Devices.Connected
	}
	if d.Network != nil {
		c.Network = d.Network.Active
	}
	if d.Projects != nil {
		c.Projects = d.Projects.Active
	}
	return c
}

// parseSummary decodes the envelope and rejects anything that is not
// recognisably one.
func parseSummary(body []byte) (summaryEnvelope, error) {
	var env summaryEnvelope
	if err := json.Unmarshal(body, &env); err != nil {
		return env, err
	}
	if env.Data == nil {
		// Present-and-null is as unusable as absent: there are no counts to
		// report either way, and reporting zeros would be a lie.
		return env, errNoData
	}
	return env, nil
}

var errNoData = &contractError{"localscope summary carried no data"}

type contractError struct{ msg string }

func (e *contractError) Error() string { return e.msg }

func msPtr(d time.Duration) *int64 {
	ms := d.Milliseconds()
	if ms < 0 {
		ms = 0
	}
	return &ms
}

// fetchUpstream performs one collector read through the same hardened path the
// proxy uses: fixed loopback base URL, a fresh request carrying none of the
// caller's headers, a bounded deadline and a bounded body.
//
// No query string is ever built here. This endpoint has no use for `all=true` —
// a summary is a summary — so the amplification that flag allows is simply not
// reachable through it.
func (h *Handler) fetchUpstream(ctx context.Context, path string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, requestTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, h.baseURL+path, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")

	resp, err := h.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return nil, &contractError{"localscope returned " + resp.Status}
	}
	return io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
}

func writeSnapshot(w http.ResponseWriter, s Snapshot) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	// Always 200: "the collector is not running" is an answer, not a failure of
	// this endpoint. The state is in the body, where a client can act on it.
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(s)
}
