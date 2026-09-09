package channel

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

const (
	enable2004  = "\x1b[?2004h"
	disable2004 = "\x1b[?2004l"
)

// The default has to be off: emitting paste markers to an application that
// never asked for them turns ESC[200~ into literal keystrokes, which would be
// a new bug in place of the old one.
func TestPasteMode_DisabledByDefault(t *testing.T) {
	var s pasteModeScanner
	require.False(t, s.Enabled())
}

func TestPasteMode_DetectsEnable(t *testing.T) {
	var s pasteModeScanner
	s.Feed([]byte("some output " + enable2004 + " more output"))
	require.True(t, s.Enabled())
}

func TestPasteMode_DetectsDisable(t *testing.T) {
	var s pasteModeScanner
	s.Feed([]byte(enable2004))
	require.True(t, s.Enabled())
	s.Feed([]byte(disable2004))
	require.False(t, s.Enabled(), "an application leaving paste mode must stop being framed")
}

// The last mode change in a stream wins, including within one chunk.
func TestPasteMode_LastChangeWins(t *testing.T) {
	var s pasteModeScanner
	s.Feed([]byte(enable2004 + "text" + disable2004 + "text" + enable2004))
	require.True(t, s.Enabled())

	var s2 pasteModeScanner
	s2.Feed([]byte(enable2004 + disable2004))
	require.False(t, s2.Enabled())
}

// A pty read boundary can fall anywhere, including inside the sequence.
func TestPasteMode_SequenceSplitAcrossChunks(t *testing.T) {
	full := "prefix " + enable2004 + " suffix"
	for cut := 1; cut < len(full); cut++ {
		var s pasteModeScanner
		s.Feed([]byte(full[:cut]))
		s.Feed([]byte(full[cut:]))
		require.True(t, s.Enabled(), "split at byte %d must still be detected", cut)
	}
}

func TestPasteMode_DisableSplitAcrossChunks(t *testing.T) {
	full := enable2004 + "output" + disable2004
	for cut := 1; cut < len(full); cut++ {
		var s pasteModeScanner
		s.Feed([]byte(full[:cut]))
		s.Feed([]byte(full[cut:]))
		require.False(t, s.Enabled(), "split at byte %d must still be detected", cut)
	}
}

// One byte at a time is the worst case for the carry buffer.
func TestPasteMode_ByteAtATime(t *testing.T) {
	var s pasteModeScanner
	for _, b := range []byte("noise" + enable2004 + "noise") {
		s.Feed([]byte{b})
	}
	require.True(t, s.Enabled())
}

// A combined mode set — several modes in one sequence — is how many terminal
// apps turn everything on at once.
func TestPasteMode_MultiParameterSequence(t *testing.T) {
	var s pasteModeScanner
	s.Feed([]byte("\x1b[?1049;2004;1002h"))
	require.True(t, s.Enabled())

	s.Feed([]byte("\x1b[?1049;2004;1002l"))
	require.False(t, s.Enabled())
}

// Matching a whole parameter matters: these are different modes entirely.
func TestPasteMode_SimilarModeNumbersDoNotEnable(t *testing.T) {
	for _, seq := range []string{"\x1b[?12004h", "\x1b[?20040h", "\x1b[?200h", "\x1b[?204h"} {
		var s pasteModeScanner
		s.Feed([]byte(seq))
		require.False(t, s.Enabled(), "sequence %q must not enable paste mode", seq)
	}
}

// Unrelated private sequences must not confuse the scan, and must not stop a
// real one later in the same chunk from being seen.
func TestPasteMode_UnrelatedSequencesIgnored(t *testing.T) {
	var s pasteModeScanner
	s.Feed([]byte("\x1b[?25l\x1b[?1004h\x1b[?2031h"))
	require.False(t, s.Enabled())

	s.Feed([]byte("\x1b[?25l" + enable2004))
	require.True(t, s.Enabled())
}

// Ordinary output that merely contains the digits must not flip the state.
func TestPasteMode_PlainTextIsNotAMode(t *testing.T) {
	var s pasteModeScanner
	s.Feed([]byte("the number 2004 appears here, and so does [?2004h without an escape"))
	require.False(t, s.Enabled())
}

func TestPasteMode_EmptyFeedIsSafe(t *testing.T) {
	var s pasteModeScanner
	s.Feed(nil)
	s.Feed([]byte{})
	require.False(t, s.Enabled())
}

// Capability belongs to one pty. Two sessions on one machine — one in Claude
// Code, one in a plain shell — must not see each other's state.
func TestPasteMode_StateIsPerHub(t *testing.T) {
	a := newPtyHub(4096)
	b := newPtyHub(4096)

	_, _ = a.Write([]byte("claude starting " + enable2004))
	_, _ = b.Write([]byte("$ plain shell, no paste mode\n"))

	require.True(t, a.BracketedPasteEnabled())
	require.False(t, b.BracketedPasteEnabled(), "capability must not leak between ptys")
}

func TestPtyHub_TracksPasteModeFromOutput(t *testing.T) {
	h := newPtyHub(4096)
	require.False(t, h.BracketedPasteEnabled())
	_, _ = h.Write([]byte(enable2004))
	require.True(t, h.BracketedPasteEnabled())
	_, _ = h.Write([]byte(disable2004))
	require.False(t, h.BracketedPasteEnabled())
}

// Feeding the scanner must not disturb what subscribers and the scrollback see.
func TestPtyHub_WritePassesOutputThroughUnchanged(t *testing.T) {
	h := newPtyHub(4096)
	payload := []byte("hello " + enable2004 + " world")
	n, err := h.Write(payload)
	require.NoError(t, err)
	require.Equal(t, len(payload), n)
	require.Equal(t, payload, h.Snapshot())
}

// --- framing ---

func TestWrapBracketedPaste_Framing(t *testing.T) {
	got := string(wrapBracketedPaste("hello"))
	require.Equal(t, "\x1b[200~hello\x1b[201~", got)
	require.True(t, strings.HasPrefix(got, "\x1b[200~"))
	require.True(t, strings.HasSuffix(got, "\x1b[201~"))
}

func TestWrapBracketedPaste_PreservesContentExactly(t *testing.T) {
	for _, msg := range []string{
		"",
		"single line",
		"START-AAAA\nMIDDLE-BBBB\nEND-CCCC",
		"blank\n\n\nlines",
		"héllo — ünïcode ✓ 日本語 🎉",
		strings.Repeat("x", 16384),
	} {
		framed := string(wrapBracketedPaste(msg))
		inner := strings.TrimSuffix(strings.TrimPrefix(framed, "\x1b[200~"), "\x1b[201~")
		require.Equal(t, msg, inner, "framing must not alter the payload")
	}
}

// A 16 KB payload is the size that arrived as 32 characters unframed.
func TestWrapBracketedPaste_LargePayloadIntact(t *testing.T) {
	msg := strings.Repeat("ABCDEFGH", 2048) // 16384 bytes
	framed := wrapBracketedPaste(msg)
	require.Len(t, framed, len(pasteStart)+len(msg)+len(pasteEnd))
	require.Equal(t, msg, string(framed[len(pasteStart):len(framed)-len(pasteEnd)]))
}

// --- terminator safety ---

func TestContainsPasteTerminator(t *testing.T) {
	require.True(t, containsPasteTerminator("before \x1b[201~ after"))
	require.True(t, containsPasteTerminator("\x1b[201~"))
	require.False(t, containsPasteTerminator("ordinary prompt"))
	// The start marker does not end a frame, so it is not refused.
	require.False(t, containsPasteTerminator("contains \x1b[200~ start marker"))
	// Text that merely looks like the sequence, without the escape byte.
	require.False(t, containsPasteTerminator("literally [201~ in prose"))
}

// The reason a terminator must be refused rather than sent: framing it would
// close the paste early and hand the tail to the application as key input.
func TestWrapBracketedPaste_TerminatorWouldEndFrameEarly(t *testing.T) {
	msg := "safe part \x1b[201~ echo pwned"
	framed := string(wrapBracketedPaste(msg))
	first := strings.Index(framed, "\x1b[201~")
	require.Less(t, first, len(framed)-len(pasteEnd),
		"the embedded terminator closes the frame before the real one — which is why callers must refuse this payload")
}
