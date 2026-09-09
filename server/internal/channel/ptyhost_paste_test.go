package channel

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

/*
 * POST /message framing.
 *
 * These drive the real handler over HTTP against a fake pty and assert the
 * exact bytes it writes, because the whole bug was about which bytes reach the
 * application.
 */

// pasteFixture starts the broker against a capturing writer and returns the
// /message URL plus the hub, so a test can decide whether the application has
// announced bracketed paste.
func pasteFixture(t *testing.T) (url string, hub *ptyHub, out *syncBuf) {
	t.Helper()
	out = &syncBuf{}
	hub = newPtyHub(4096)
	srv, port, err := startPtyHTTPServer(newPtyWriter(out), hub, newRotatingToken("secret-token"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = srv.Shutdown(context.Background()) })
	return fmt.Sprintf("http://127.0.0.1:%d/message", port), hub, out
}

func postMessage(t *testing.T, url, jsonBody string) int {
	t.Helper()
	req, err := http.NewRequest("POST", url, strings.NewReader(jsonBody))
	require.NoError(t, err)
	req.Header.Set("Authorization", "Bearer secret-token")
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()
	return resp.StatusCode
}

// waitForWrite waits until the serialized pty writer has flushed something.
func waitForWrite(t *testing.T, out *syncBuf) string {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if s := out.String(); s != "" {
			return s
		}
		time.Sleep(5 * time.Millisecond)
	}
	return out.String()
}

// jsonMessage builds a request body with the message properly JSON-encoded, so
// control characters — ESC above all — survive the round trip intact. A
// hand-rolled escaper that dropped ESC would make the terminator tests below
// silently assert nothing.
func jsonMessage(t *testing.T, msg string) string {
	t.Helper()
	b, err := json.Marshal(map[string]string{"message": msg})
	require.NoError(t, err)
	return string(b)
}

// Until the application announces support, nothing changes — the markers would
// otherwise arrive as literal keystrokes.
func TestMessage_NoPasteModeKeepsRawBehaviour(t *testing.T) {
	url, _, out := pasteFixture(t)
	require.Equal(t, http.StatusOK, postMessage(t, url, jsonMessage(t, "hello world")))
	require.Equal(t, "hello world\r", waitForWrite(t, out))
}

func TestMessage_PasteModeFramesThePayload(t *testing.T) {
	url, hub, out := pasteFixture(t)
	_, _ = hub.Write([]byte(enable2004))

	require.Equal(t, http.StatusOK, postMessage(t, url, jsonMessage(t, "hello world")))
	require.Equal(t, "\x1b[200~hello world\x1b[201~\r", waitForWrite(t, out))
}

// The CR must come after the closing marker, never inside the frame — inside,
// it would be pasted content rather than a submit.
func TestMessage_CarriageReturnFollowsTheClosingMarker(t *testing.T) {
	url, hub, out := pasteFixture(t)
	_, _ = hub.Write([]byte(enable2004))

	require.Equal(t, http.StatusOK, postMessage(t, url, jsonMessage(t, "submit me")))
	got := waitForWrite(t, out)
	require.True(t, strings.HasSuffix(got, "\x1b[201~\r"), "got %q", got)
	require.Equal(t, 1, strings.Count(got, "\r"))
}

func TestMessage_PasteModeDisabledAgainFallsBackToRaw(t *testing.T) {
	url, hub, out := pasteFixture(t)
	_, _ = hub.Write([]byte(enable2004))
	_, _ = hub.Write([]byte(disable2004))

	require.Equal(t, http.StatusOK, postMessage(t, url, jsonMessage(t, "back to raw")))
	require.Equal(t, "back to raw\r", waitForWrite(t, out))
}

// The sizes and shapes that lost content unframed.
func TestMessage_PayloadShapesArePreservedInsideTheFrame(t *testing.T) {
	cases := map[string]string{
		"short":       "hi",
		"multiline":   "START-AAAA\nMIDDLE-BBBB\nEND-CCCC",
		"blank lines": "START-AAAA\n\n\nEND-CCCC",
		"unicode":     "héllo — ünïcode ✓ 日本語 🎉",
		"1KB":         strings.Repeat("a", 1024),
		"4KB":         strings.Repeat("b", 4096),
		"8KB":         strings.Repeat("c", 8192),
		"16KB":        strings.Repeat("d", 16384),
	}
	for name, msg := range cases {
		t.Run(name, func(t *testing.T) {
			url, hub, out := pasteFixture(t)
			_, _ = hub.Write([]byte(enable2004))

			require.Equal(t, http.StatusOK, postMessage(t, url, jsonMessage(t, msg)))

			deadline := time.Now().Add(3 * time.Second)
			want := "\x1b[200~" + msg + "\x1b[201~\r"
			for time.Now().Before(deadline) && len(out.String()) < len(want) {
				time.Sleep(5 * time.Millisecond)
			}
			require.Equal(t, want, out.String(), "payload must reach the pty byte-for-byte")
		})
	}
}

// A payload carrying the terminator is refused, not sent mangled: framing it
// would close the paste early and hand the tail to the application as key
// input. The protocol has no way to escape it.
func TestMessage_EmbeddedTerminatorIsRefused(t *testing.T) {
	url, hub, out := pasteFixture(t)
	_, _ = hub.Write([]byte(enable2004))

	code := postMessage(t, url, jsonMessage(t, "safe part \x1b[201~ rm -rf /"))
	require.Equal(t, http.StatusUnprocessableEntity, code)

	time.Sleep(100 * time.Millisecond)
	require.Empty(t, out.String(), "a refused message must not reach the pty at all")
}

// Without paste mode there is no frame to break, so behaviour is unchanged —
// this route has always written its bytes through.
func TestMessage_TerminatorWithoutPasteModeKeepsExistingBehaviour(t *testing.T) {
	url, _, out := pasteFixture(t)
	require.Equal(t, http.StatusOK, postMessage(t, url, jsonMessage(t, "x\x1b[201~y")))
	require.Equal(t, "x\x1b[201~y\r", waitForWrite(t, out))
}

// The start marker does not end a frame and is not refused.
func TestMessage_EmbeddedStartMarkerIsAllowed(t *testing.T) {
	url, hub, out := pasteFixture(t)
	_, _ = hub.Write([]byte(enable2004))

	require.Equal(t, http.StatusOK, postMessage(t, url, jsonMessage(t, "has \x1b[200~ inside")))
	require.Equal(t, "\x1b[200~has \x1b[200~ inside\x1b[201~\r", waitForWrite(t, out))
}

// The frame and its CR go through one WriteParts job, so no concurrent writer
// can land inside the paste and become part of this prompt's content.
func TestMessage_ConcurrentWriterCannotLandInsideTheFrame(t *testing.T) {
	out := &syncBuf{}
	hub := newPtyHub(4096)
	_, _ = hub.Write([]byte(enable2004))
	pw := newPtyWriter(out)
	srv, port, err := startPtyHTTPServer(pw, hub, newRotatingToken("secret-token"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = srv.Shutdown(context.Background()) })

	url := fmt.Sprintf("http://127.0.0.1:%d/message", port)
	done := make(chan struct{})
	go func() {
		defer close(done)
		postMessage(t, url, jsonMessage(t, "the prompt"))
	}()
	// Hammer the same pty from another writer while the injection is in flight.
	for i := 0; i < 20; i++ {
		_, _ = pw.Write([]byte("Z"))
		time.Sleep(5 * time.Millisecond)
	}
	<-done

	got := out.String()
	start := strings.Index(got, "\x1b[200~")
	end := strings.Index(got, "\x1b[201~")
	require.GreaterOrEqual(t, start, 0)
	require.Greater(t, end, start)
	require.Equal(t, "\x1b[200~the prompt", got[start:end],
		"nothing may appear between the opening marker and the payload's end")
}
