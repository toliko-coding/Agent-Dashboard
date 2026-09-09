package channel

import "sync"

// ptyHub tees pty output into a scrollback buffer and to all live subscribers.
// A subscriber that cannot keep up is dropped (its channel closed) rather than
// stalling the pty read loop.
type ptyHub struct {
	mu   sync.Mutex
	sb   *scrollback
	subs map[chan []byte]struct{}
	// paste tracks whether the application has enabled bracketed paste. It
	// lives here because this is already the one place every byte of pty
	// output passes through, so no second parser and no second tap on the
	// stream is needed — and because a hub belongs to exactly one pty, which
	// is what keeps the capability from leaking between agents.
	paste pasteModeScanner
}

func newPtyHub(scrollbackBytes int) *ptyHub {
	return &ptyHub{sb: newScrollback(scrollbackBytes), subs: map[chan []byte]struct{}{}}
}

// Write is io.Writer: called from the pty read loop.
func (h *ptyHub) Write(p []byte) (int, error) {
	h.paste.Feed(p)
	_, _ = h.sb.Write(p)
	h.mu.Lock()
	for ch := range h.subs {
		b := append([]byte(nil), p...)
		select {
		case ch <- b:
		default: // slow subscriber: drop it
			close(ch)
			delete(h.subs, ch)
		}
	}
	h.mu.Unlock()
	return len(p), nil
}

// BracketedPasteEnabled reports whether the application on this pty has turned
// on bracketed paste, and therefore whether a message may be delivered as a
// paste rather than as raw keystrokes.
func (h *ptyHub) BracketedPasteEnabled() bool {
	return h.paste.Enabled()
}

// Snapshot returns the current scrollback bytes, so callers (e.g. the
// /question handler) don't need to reach into the hub's internal scrollback.
func (h *ptyHub) Snapshot() []byte {
	return h.sb.Snapshot()
}

// Subscribe returns the current scrollback plus a channel of subsequent frames.
func (h *ptyHub) Subscribe() (replay []byte, frames chan []byte, cancel func()) {
	ch := make(chan []byte, 256)
	h.mu.Lock()
	replay = h.sb.Snapshot()
	h.subs[ch] = struct{}{}
	h.mu.Unlock()
	cancel = func() {
		h.mu.Lock()
		if _, ok := h.subs[ch]; ok {
			close(ch)
			delete(h.subs, ch)
		}
		h.mu.Unlock()
	}
	return replay, ch, cancel
}
