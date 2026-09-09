package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

/*
 * The browser-facing group and the abuse-facing endpoints must not share one
 * budget.
 *
 * Measured before this split: opening the dashboard issued ~18 requests within
 * 30ms, which spent almost the whole burst of 20, and the remainder — including
 * all four SSE streams — was refused with 429. Because useSseResource treats a
 * closed stream as a fallback to polling for SSE_RETRY_DELAY_MS (30s), every
 * cold load degraded live updates to polling for half a minute.
 *
 * These tests pin the two halves of the fix: a real mount-sized burst passes on
 * the browser limiter, and the strict limiter keeps its original ceiling for the
 * endpoints its docstring names (auth, MCP, agent-ingress).
 */

// mountBurst is the measured cold-load request count, doubled for a second
// browser tab — both tabs share one per-IP bucket on a loopback dashboard.
const mountBurst = 36

func limiterRouter(t *testing.T, cfg IPRateLimiterConfig) chi.Router {
	t.Helper()
	r := chi.NewRouter()
	r.Use(NewIPRateLimiter(t.Context(), cfg))
	r.Get("/probe", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	return r
}

// countStatuses fires n requests from one IP and reports how many were refused.
func countStatuses(r chi.Router, n int) (ok, limited int) {
	for i := 0; i < n; i++ {
		req := httptest.NewRequest(http.MethodGet, "/probe", nil)
		req.RemoteAddr = "127.0.0.1:54321"
		rr := httptest.NewRecorder()
		r.ServeHTTP(rr, req)
		if rr.Code == http.StatusTooManyRequests {
			limited++
		} else {
			ok++
		}
	}
	return ok, limited
}

func TestBrowseRateLimiter_AllowsARealMountBurst(t *testing.T) {
	// The defaults the router applies to the browser group.
	r := limiterRouter(t, IPRateLimiterConfig{Rate: 60, Burst: 120})

	ok, limited := countStatuses(r, mountBurst)

	if limited != 0 {
		t.Fatalf("a %d-request mount burst was rate limited (%d refused); the browser group must absorb a cold load", mountBurst, limited)
	}
	if ok != mountBurst {
		t.Fatalf("ok = %d, want %d", ok, mountBurst)
	}
}

// The regression itself: the strict configuration cannot carry a page load.
// If this ever stops failing, the strict limiter has been widened and the two
// budgets have quietly merged again.
func TestStrictRateLimiter_CannotCarryAMountBurst(t *testing.T) {
	r := limiterRouter(t, IPRateLimiterConfig{Rate: 10, Burst: 20})

	_, limited := countStatuses(r, mountBurst)

	if limited == 0 {
		t.Fatal("the strict 10/20 limiter absorbed a full mount burst; it is no longer strict, so the split has lost its purpose")
	}
}

func TestStrictRateLimiter_KeepsItsCeilingForAbuseSurfaces(t *testing.T) {
	r := limiterRouter(t, IPRateLimiterConfig{Rate: 10, Burst: 20})

	ok, limited := countStatuses(r, 200)

	// Well under the flood: auth probing and MCP key lookups stay bounded.
	if ok > 40 {
		t.Fatalf("strict limiter allowed %d of 200 rapid requests; expected it to cap near its burst of 20", ok)
	}
	if limited == 0 {
		t.Fatal("strict limiter refused nothing across 200 rapid requests")
	}
}

// A refused request must say when to come back, so a client can back off
// instead of retrying immediately and rebuilding the burst.
func TestRateLimiter_SetsRetryAfterOnRefusal(t *testing.T) {
	r := limiterRouter(t, IPRateLimiterConfig{Rate: 1, Burst: 1})

	for i := 0; i < 3; i++ {
		req := httptest.NewRequest(http.MethodGet, "/probe", nil)
		req.RemoteAddr = "127.0.0.1:54321"
		rr := httptest.NewRecorder()
		r.ServeHTTP(rr, req)
		if rr.Code == http.StatusTooManyRequests {
			if rr.Header().Get("Retry-After") == "" {
				t.Fatal("429 carried no Retry-After header")
			}
			return
		}
	}
	t.Fatal("expected a 429 within three requests at rate 1 burst 1")
}

// Separate IPs keep separate budgets, so one busy client cannot lock out another.
func TestRateLimiter_IsPerIP(t *testing.T) {
	r := limiterRouter(t, IPRateLimiterConfig{Rate: 1, Burst: 2})

	drain := func(ip string) (limited int) {
		for i := 0; i < 6; i++ {
			req := httptest.NewRequest(http.MethodGet, "/probe", nil)
			req.RemoteAddr = ip + ":1111"
			rr := httptest.NewRecorder()
			r.ServeHTTP(rr, req)
			if rr.Code == http.StatusTooManyRequests {
				limited++
			}
		}
		return limited
	}

	if drain("10.0.0.1") == 0 {
		t.Fatal("expected the first IP to be limited after exhausting its burst")
	}
	// A second IP starts with a full bucket.
	second := 0
	req := httptest.NewRequest(http.MethodGet, "/probe", nil)
	req.RemoteAddr = "10.0.0.2:2222"
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code == http.StatusTooManyRequests {
		second++
	}
	if second != 0 {
		t.Fatal("a second IP was refused on its first request; buckets are not per-IP")
	}
}
