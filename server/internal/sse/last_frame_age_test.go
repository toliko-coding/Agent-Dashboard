package sse

import (
	"testing"
	"time"
)

// A frame is only worth serving while it still describes the present, and the
// only thing that distinguishes "from this tick" from "left over from an hour
// ago" is its age. Frames stop being produced entirely when nothing is
// subscribed, so this is not a theoretical staleness.
func TestLastFrameAge(t *testing.T) {
	b := NewBroadcaster()

	if _, ok := b.LastFrameAge(); ok {
		t.Error("LastFrameAge reported a frame before anything was broadcast")
	}

	b.Broadcast([]byte(`{"agents":[]}`))

	age, ok := b.LastFrameAge()
	if !ok {
		t.Fatal("LastFrameAge reported no frame after Broadcast")
	}
	if age > time.Second {
		t.Errorf("age = %v, want a fresh frame", age)
	}
}

// Heartbeats keep idle connections open; they are not state, so they must not
// make a stale roster look fresh.
func TestCommentFrameDoesNotRefreshAge(t *testing.T) {
	b := NewBroadcaster()
	b.Broadcast([]byte(`{"agents":[]}`))
	first, _ := b.LastFrameAge()

	time.Sleep(5 * time.Millisecond)
	b.BroadcastComment([]byte("keepalive"))

	after, ok := b.LastFrameAge()
	if !ok {
		t.Fatal("frame disappeared after a comment frame")
	}
	if after < first {
		t.Error("a comment frame reset the data frame's age")
	}
}

// The payload itself is unchanged by carrying a timestamp.
func TestLastFrameStillReturnsPayload(t *testing.T) {
	b := NewBroadcaster()
	b.Broadcast([]byte(`{"agents":[{"pid":1}]}`))
	if got := string(b.LastFrame()); got != `{"agents":[{"pid":1}]}` {
		t.Errorf("LastFrame() = %q", got)
	}
}
