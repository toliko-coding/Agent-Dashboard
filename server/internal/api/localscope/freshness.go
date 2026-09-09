package localscope

import (
	"encoding/json"
	"sync"
	"time"
)

/*
 * The state machine every normalized LocalScope read shares.
 *
 * Summary, services and processes answer the same four questions — is this
 * current, was a source degraded, how old is it, and do we know anything at
 * all — so they answer them with one implementation. Three endpoints each
 * deciding "stale" for themselves is how two surfaces come to disagree about
 * whether the collector is up.
 */

// Freshness is embedded in every normalized response, so `source`, `collectedAt`,
// `ageMs` and `degraded` mean exactly the same thing on all of them.
type Freshness struct {
	Source SnapshotSource `json:"source"`
	// CollectedAt is when the data was true, from the collector's own clock.
	// Null when nothing has ever been collected.
	CollectedAt *string `json:"collectedAt"`
	// AgeMs is how old that is as of this response — what lets a surface say
	// how stale "stale" actually is.
	AgeMs *int64 `json:"ageMs"`
	// Degraded is never null; empty means every contributing source succeeded.
	Degraded []Degradation `json:"degraded"`
}

// classify decides the source state for a reading that was successfully
// collected at the given time.
//
// Staleness outranks degradation on purpose: degraded says one collector had
// trouble, stale says the whole reading may no longer describe the machine, and
// the weaker claim must not mask the stronger one. Nothing is lost either way —
// Degraded is populated regardless.
func classify(collectedAt time.Time, degraded []Degradation) SnapshotSource {
	if time.Since(collectedAt) > staleAfter {
		return SourceStale
	}
	if len(degraded) > 0 {
		return SourceDegraded
	}
	return SourceOK
}

// freshFrom builds the envelope for a reading collected just now.
func freshFrom(collectedAt time.Time, raw string, degraded []Degradation) Freshness {
	return Freshness{
		Source:      classify(collectedAt, degraded),
		CollectedAt: &raw,
		AgeMs:       msPtr(time.Since(collectedAt)),
		Degraded:    degraded,
	}
}

/*
 * lastReading remembers the most recent successful collection of one kind of
 * data, so a collector that has gone away can be reported as stale rather than
 * as a machine with nothing on it.
 *
 * Memory only, and per kind: the summary, the service list and the process list
 * are collected separately and can each go stale on their own schedule.
 */
type lastReading[T any] struct {
	mu          sync.Mutex
	have        bool
	value       T
	degraded    []Degradation
	collectedAt time.Time
	raw         string
}

func (l *lastReading[T]) store(v T, degraded []Degradation, at time.Time, raw string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.have, l.value, l.degraded, l.collectedAt, l.raw = true, v, degraded, at, raw
}

// staleOrUnknown is the answer whenever a read could not produce a current
// reading: the previous one marked stale, or nothing at all.
//
// The second return is false when there is no history, which is what lets a
// caller leave a list nil — "we do not know the list" — instead of returning an
// empty one, which would claim the collector looked and found none.
func (l *lastReading[T]) staleOrUnknown() (T, Freshness, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if !l.have {
		var zero T
		return zero, Freshness{Source: SourceUnavailable, Degraded: []Degradation{}}, false
	}
	return l.value, Freshness{
		Source:      SourceStale,
		CollectedAt: &l.raw,
		AgeMs:       msPtr(time.Since(l.collectedAt)),
		Degraded:    l.degraded,
	}, true
}

// listEnvelope is the shape LocalScope returns for its list endpoints. Decoded
// with json.RawMessage so the freshness fields can be validated before the
// items are parsed — a bad timestamp makes the items unusable regardless of
// whether they would have decoded.
type listEnvelope struct {
	Data        json.RawMessage `json:"data"`
	Degraded    []Degradation   `json:"degraded"`
	CollectedAt string          `json:"collectedAt"`
}

/*
 * decodeList parses one LocalScope list response into items plus a validated
 * collection time.
 *
 * Every failure path returns an error rather than a partial result. A response
 * that is not the contract must not decode into an empty list: "the collector
 * looked and found nothing" and "we could not read the answer" are different
 * claims, and only the collector may make the first one.
 */
func decodeList[T any](body []byte) (items []T, degraded []Degradation, at time.Time, raw string, err error) {
	var env listEnvelope
	if err = json.Unmarshal(body, &env); err != nil {
		return nil, nil, time.Time{}, "", err
	}
	if len(env.Data) == 0 || string(env.Data) == "null" {
		return nil, nil, time.Time{}, "", errNoData
	}
	at, err = time.Parse(time.RFC3339, env.CollectedAt)
	if err != nil {
		// Without a trustworthy timestamp there is no way to say whether these
		// entries are current, and "unknown age" is not a state this model has.
		return nil, nil, time.Time{}, "", err
	}
	if err = json.Unmarshal(env.Data, &items); err != nil {
		return nil, nil, time.Time{}, "", err
	}
	if items == nil {
		// A JSON `[]` decodes to a non-nil empty slice; reaching here means the
		// payload was something else that happened to unmarshal. Treat it as
		// unusable rather than as an empty machine.
		return nil, nil, time.Time{}, "", errNoData
	}
	if env.Degraded == nil {
		env.Degraded = []Degradation{}
	}
	return items, env.Degraded, at, env.CollectedAt, nil
}

/*
 * serveList is the whole read-normalize-classify-or-fall-back cycle, written
 * once.
 *
 * `items` is nil in the response when nothing is known, and a non-nil empty
 * slice when the collector genuinely found none — the distinction survives all
 * the way to JSON as `null` versus `[]`.
 */
func serveList[Raw any, Out any](
	last *lastReading[[]Out],
	convert func([]Raw) []Out,
	fetch func() (body []byte, err error),
) ([]Out, Freshness) {
	body, err := fetch()
	if err != nil {
		items, fresh, _ := last.staleOrUnknown()
		return items, fresh
	}

	rawItems, degraded, at, rawTime, decErr := decodeList[Raw](body)
	if decErr != nil {
		items, fresh, _ := last.staleOrUnknown()
		return items, fresh
	}

	out := convert(rawItems)
	if out == nil {
		// convert must preserve emptiness: a collector that found nothing
		// returns [], never null.
		out = []Out{}
	}
	last.store(out, degraded, at, rawTime)
	return out, freshFrom(at, rawTime, degraded)
}
