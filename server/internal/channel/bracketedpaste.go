package channel

import (
	"bytes"
	"sync"
)

/*
 * Bracketed-paste capability tracking.
 *
 * A terminal application that wants to receive pasted text as DATA rather than
 * as keystrokes turns on DEC private mode 2004 (CSI ? 2004 h) and turns it off
 * again with CSI ? 2004 l. Claude Code turns it on.
 *
 * That matters because injecting a large prompt as raw keystrokes loses almost
 * all of it: measured against a real session, a 16 KB message reached the
 * transcript as 32 characters, and 1 KB as 2 — an exact suffix in 7 of 8 sizes,
 * with the surviving length equal to bytes/512. Framing the same payload as a
 * paste delivered all 16384 bytes intact. So the mode the application announces
 * is not cosmetic; it is the difference between the message arriving and not.
 *
 * The state is observed, never assumed: emitting paste markers to an
 * application that never asked for them would make ESC[200~ arrive as literal
 * keystrokes, which is a new bug in place of the old one. Default is therefore
 * off, and only CSI ? 2004 h turns it on.
 *
 * There is no second terminal parser here. This scans the one byte stream the
 * broker already tees through ptyHub.Write, looking only for this one mode.
 */

// pasteModeScanner tracks whether the application on a pty has enabled
// bracketed paste. It is fed the pty's output stream.
//
// State belongs to one pty because one broker process hosts one session and
// owns one hub; nothing here is global, so two agents cannot see each other's
// capability.
type pasteModeScanner struct {
	mu      sync.Mutex
	enabled bool
	// carry holds the tail of the previous chunk so a mode sequence split
	// across two reads is still recognised. A pty read boundary can fall
	// anywhere, including in the middle of "\x1b[?2004h".
	carry []byte
}

/*
 * maxModeSeqLen bounds the carry-over.
 *
 * A DEC private mode sequence is CSI ? <params> h|l, and params may be a
 * semicolon-separated list — "\x1b[?1049;2004;1002h" is one sequence that
 * enables three modes at once. 64 bytes covers any realistic list while keeping
 * the retained tail small; a sequence longer than this is not tracked, which
 * costs a missed detection (falling back to today's behaviour) rather than a
 * wrong one.
 */
const maxModeSeqLen = 64

// csiPrivatePrefix is the start of a DEC private mode sequence: ESC [ ?
var csiPrivatePrefix = []byte{0x1b, '[', '?'}

// Feed consumes a chunk of pty output and updates the tracked state.
//
// The LAST mode change in the stream wins, so an application that enables
// bracketed paste and later disables it (leaving its editor, exiting to a
// plain shell) is correctly reported as no longer supporting it.
func (s *pasteModeScanner) Feed(chunk []byte) {
	if len(chunk) == 0 {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	buf := chunk
	if len(s.carry) > 0 {
		buf = append(append(make([]byte, 0, len(s.carry)+len(chunk)), s.carry...), chunk...)
	}

	for i := 0; i+len(csiPrivatePrefix) <= len(buf); {
		idx := bytes.Index(buf[i:], csiPrivatePrefix)
		if idx < 0 {
			break
		}
		start := i + idx
		params, final, end, ok := scanPrivateMode(buf[start:])
		if !ok {
			// Either malformed or truncated by the chunk boundary. Leaving i
			// here would loop forever, so step past this prefix; the carry
			// below re-presents a truncated sequence with the next chunk.
			break
		}
		if hasMode2004(params) {
			s.enabled = final == 'h'
		}
		i = start + end
	}

	// Retain a bounded tail so a sequence straddling this boundary is seen
	// once the rest arrives.
	if len(buf) > maxModeSeqLen {
		buf = buf[len(buf)-maxModeSeqLen:]
	}
	s.carry = append(s.carry[:0], buf...)
}

// Enabled reports whether the application has bracketed paste turned on.
func (s *pasteModeScanner) Enabled() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.enabled
}

// scanPrivateMode parses "ESC [ ? <params> <final>" at the start of b.
//
// Returns the raw parameter bytes, the final byte ('h' or 'l'), and how many
// bytes the sequence occupied. ok is false when the sequence is incomplete
// (the chunk ended mid-sequence) or is not a mode set/reset.
func scanPrivateMode(b []byte) (params []byte, final byte, size int, ok bool) {
	i := len(csiPrivatePrefix)
	for i < len(b) && i <= maxModeSeqLen {
		c := b[i]
		if (c >= '0' && c <= '9') || c == ';' {
			i++
			continue
		}
		if c == 'h' || c == 'l' {
			return b[len(csiPrivatePrefix):i], c, i + 1, true
		}
		// Some other final byte: a private sequence this tracker does not
		// care about (cursor style, DECRQM reports, …).
		return nil, 0, i + 1, false
	}
	return nil, 0, 0, false
}

// hasMode2004 reports whether 2004 appears in a semicolon-separated parameter
// list. Matching the whole parameter matters: "12004" and "20040" are different
// modes and must not turn paste handling on.
func hasMode2004(params []byte) bool {
	for _, p := range bytes.Split(params, []byte{';'}) {
		if bytes.Equal(p, []byte("2004")) {
			return true
		}
	}
	return false
}

// Bracketed-paste framing. The application receives everything between the
// markers as literal data rather than as key input.
var (
	pasteStart = []byte("\x1b[200~")
	pasteEnd   = []byte("\x1b[201~")
)

// containsPasteTerminator reports whether a payload carries the sequence that
// ends a paste frame.
//
// This is unescapable, not merely awkward: the protocol defines no way to
// represent a literal ESC[201~ inside a paste, so a payload containing one
// would close the frame early and hand everything after it to the application
// as keystrokes — the user's own text acting as terminal commands. Callers must
// refuse such a message rather than send it framed.
//
// An embedded ESC[200~ is not checked: it does not end the frame, and the
// receiving application sees it as literal text exactly as it would any other
// content.
func containsPasteTerminator(msg string) bool {
	return bytes.Contains([]byte(msg), pasteEnd)
}

// wrapBracketedPaste frames a message for delivery as a paste.
func wrapBracketedPaste(msg string) []byte {
	out := make([]byte, 0, len(pasteStart)+len(msg)+len(pasteEnd))
	out = append(out, pasteStart...)
	out = append(out, msg...)
	out = append(out, pasteEnd...)
	return out
}
