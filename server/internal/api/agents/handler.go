// Package agents provides HTTP handlers for the agent monitoring API.
package agents

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/lx-wnk/agent-dashboard/sdk"
	"github.com/lx-wnk/agent-dashboard/server/internal/sse"
)

// Frames received from the broadcaster are fully-formed SSE frames
// (produced by Broadcaster.Broadcast / BroadcastComment).
// Handlers must write them raw — no additional "data: " prefix.

// GetAgentsFn is the function signature for retrieving the current agent list.
// Defined as a named type to allow substitution in tests.
type GetAgentsFn func(ctx context.Context) ([]sdk.Agent, error)

/*
 * maxFrameAge bounds how old the broadcaster's cached frame may be before a
 * read scans again.
 *
 * The cache exists so a burst of requests costs one scan per broadcast tick
 * rather than one per request, and the loop ticks every few seconds — but only
 * while something is subscribed. With no browser open no frames are produced at
 * all, and the last one simply ages: an agent that has since exited was served
 * as running, injectable and owned long after its process was gone, while every
 * per-pid route correctly answered 404 for it.
 *
 * Ten seconds is comfortably above the default tick (3s) so the cache still
 * absorbs bursts, and short enough that a stale roster cannot outlive the thing
 * it describes.
 */
const maxFrameAge = 10 * time.Second

// Handler handles /api/agents HTTP requests.
type Handler struct {
	getAgents   GetAgentsFn
	broadcaster *sse.Broadcaster
	// maxFrameAge is maxFrameAge; a field so tests can age a frame out.
	maxFrameAge time.Duration
}

// NewHandler creates a Handler with the given dependencies.
func NewHandler(getAgents GetAgentsFn, broadcaster *sse.Broadcaster) *Handler {
	return &Handler{getAgents: getAgents, broadcaster: broadcaster, maxFrameAge: maxFrameAge}
}

// List handles GET /api/agents — returns the current agent list as JSON.
// A nil slice is normalized to an empty slice so the frontend always receives [].
// Serves the broadcaster's last frame (PERF-LOW2) instead of a fresh scan when
// one is available AND recent, so a burst of requests costs one scan per
// broadcast tick rather than one per request. Falls back to a scan before the
// loop's first tick, and whenever the cached frame has aged past maxFrameAge —
// which it does whenever nothing is subscribed, since frames are only produced
// for subscribers.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) error {
	agents, ok := h.agentsFromLastFrame()
	if !ok {
		var err error
		agents, err = h.getAgents(r.Context())
		if err != nil {
			return fmt.Errorf("get agents: %w", err)
		}
	}
	if agents == nil {
		agents = []sdk.Agent{}
	}
	w.Header().Set("Content-Type", "application/json")
	return json.NewEncoder(w).Encode(agents)
}

// agentsFromLastFrame extracts the agent list from the broadcaster's last
// frame. Returns ok=false when no frame has been broadcast yet, when the frame
// is older than maxFrameAge, or when it cannot be decoded — each signalling the
// caller to fall back to a fresh scan.
func (h *Handler) agentsFromLastFrame() ([]sdk.Agent, bool) {
	frame := h.freshFrame()
	if frame == nil {
		return nil, false
	}
	var envelope struct {
		Agents []sdk.Agent `json:"agents"`
	}
	if err := json.Unmarshal(frame, &envelope); err != nil {
		return nil, false
	}
	return envelope.Agents, true
}

// freshFrame returns the broadcaster's last frame while it is recent enough to
// still describe the present, and nil otherwise — including when no frame has
// ever been broadcast. Both readers go through it so "recent enough" is one
// rule rather than two that can drift.
func (h *Handler) freshFrame() []byte {
	age, ok := h.broadcaster.LastFrameAge()
	if !ok || age > h.maxFrameAge {
		return nil
	}
	return h.broadcaster.LastFrame()
}

// Stream handles GET /api/agents/stream — SSE endpoint.
// Sends the current agent list immediately, then on every broadcaster tick.
func (h *Handler) Stream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "SSE not supported", http.StatusInternalServerError)
		return
	}

	sse.WriteHeaders(w)

	// Send current state immediately so client doesn't wait for first tick.
	// PERF-LOW2: reuse the broadcaster's last frame — already {agents, trend}
	// shaped — instead of a fresh scan. Falls back to a scan before the first
	// tick, and when the cached frame has aged out: a subscriber arriving after
	// a quiet period would otherwise be painted a roster from whenever the last
	// browser closed, showing exited agents as running until the next tick.
	if frame := h.freshFrame(); frame != nil {
		fmt.Fprintf(w, "data: %s\n\n", frame)
		flusher.Flush()
	} else if agents, err := h.getAgents(r.Context()); err == nil {
		if data, err := json.Marshal(map[string]any{"agents": agents, "trend": []any{}}); err == nil {
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		}
	}

	sub := h.broadcaster.Subscribe()
	defer h.broadcaster.Unsubscribe(sub)

	for {
		select {
		case data, ok := <-sub:
			if !ok {
				return
			}
			// data is a fully-formed SSE frame from the broadcaster — write raw.
			w.Write(data) //nolint:errcheck
			flusher.Flush()
		case <-r.Context().Done():
			return
		}
	}
}
