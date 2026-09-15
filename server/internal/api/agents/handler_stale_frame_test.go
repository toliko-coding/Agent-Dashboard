package agents

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/lx-wnk/agent-dashboard/sdk"
	"github.com/lx-wnk/agent-dashboard/server/internal/sse"
)

/*
 * A cached roster must not outlive the thing it describes.
 *
 * The broadcaster's frames are produced for subscribers, so with no browser
 * open none are produced at all and the last one ages indefinitely. Serving it
 * regardless reported an agent that had already exited as running, injectable
 * and dashboard-owned - while every per-pid route answered 404 for the same
 * pid, because those read the live scan. Observed on a real dashboard: a
 * finished agent's card was still listed half an hour after its process died,
 * and disappeared the moment one subscriber connected.
 */

func staleFrameHandler(t *testing.T, scanned []sdk.Agent) (*Handler, *int) {
	t.Helper()
	calls := 0
	b := sse.NewBroadcaster()
	h := NewHandler(func(context.Context) ([]sdk.Agent, error) {
		calls++
		return scanned, nil
	}, b)
	// A frame exists, but from long ago as far as this handler is concerned.
	b.Broadcast([]byte(`{"agents":[{"pid":51838,"sessionId":"gone"}],"trend":[]}`))
	h.maxFrameAge = time.Nanosecond
	time.Sleep(time.Millisecond)
	return h, &calls
}

func TestList_ScansAgain_WhenTheCachedFrameHasAgedOut(t *testing.T) {
	h, calls := staleFrameHandler(t, []sdk.Agent{{PID: 4242, SessionID: "live"}})

	rec := httptest.NewRecorder()
	if err := h.List(rec, httptest.NewRequest(http.MethodGet, "/api/agents", nil)); err != nil {
		t.Fatalf("List: %v", err)
	}

	var got []sdk.Agent
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if *calls != 1 {
		t.Errorf("scan calls = %d, want 1: a stale frame must not be served", *calls)
	}
	if len(got) != 1 || got[0].PID != 4242 {
		t.Errorf("List returned %+v, want the freshly scanned agent", got)
	}
}

// The same rule on the stream's opening frame: a subscriber arriving after a
// quiet period would otherwise be painted the roster from whenever the last
// browser closed, complete with controls for agents that have since exited.
func TestStream_InitialSend_ScansAgain_WhenTheCachedFrameHasAgedOut(t *testing.T) {
	h, calls := staleFrameHandler(t, []sdk.Agent{{PID: 4242, SessionID: "live"}})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/agents/stream", nil)
	ctx, cancel := context.WithCancel(req.Context())
	req = req.WithContext(ctx)
	go func() {
		time.Sleep(60 * time.Millisecond)
		cancel()
	}()
	h.Stream(rec, req)

	body := rec.Body.String()
	if *calls != 1 {
		t.Errorf("scan calls = %d, want 1: the opening frame must not be stale", *calls)
	}
	if strings.Contains(body, "51838") {
		t.Error("the stream opened with the stale roster")
	}
	if !strings.Contains(body, "4242") {
		t.Errorf("the stream did not open with the fresh roster: %q", body)
	}
}

// The cache still does its job: a frame from this tick is served without a scan.
func TestList_ServesAFreshFrameWithoutScanning(t *testing.T) {
	calls := 0
	b := sse.NewBroadcaster()
	h := NewHandler(func(context.Context) ([]sdk.Agent, error) {
		calls++
		return nil, nil
	}, b)
	b.Broadcast([]byte(`{"agents":[{"pid":7,"sessionId":"s"}],"trend":[]}`))

	rec := httptest.NewRecorder()
	if err := h.List(rec, httptest.NewRequest(http.MethodGet, "/api/agents", nil)); err != nil {
		t.Fatalf("List: %v", err)
	}
	if calls != 0 {
		t.Errorf("scan calls = %d, want 0: a recent frame is what the cache is for", calls)
	}
	if !strings.Contains(rec.Body.String(), `"pid":7`) {
		t.Errorf("List did not serve the cached frame: %s", rec.Body.String())
	}
}
