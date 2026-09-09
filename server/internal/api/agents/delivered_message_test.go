package agents

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/lx-wnk/agent-dashboard/server/internal/channelconfig"
)

/*
 * The delivered-text contract.
 *
 * Sanitization changes the message — newlines are stripped before it reaches
 * the agent — so there are two candidate strings for "the user's message": what
 * was typed and what was sent. Only the second is real. SendMessageToChannel
 * owns the transformation and therefore reports it, so the audit log, the
 * transport and the HTTP response all describe the same bytes and no caller has
 * to derive a second normalization of its own.
 */

// ptyChannel wires a fake pty broker for pid and returns what it received.
func ptyChannel(t *testing.T, pid int) *string {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	dir := filepath.Join(home, channelconfig.DiscoveryDir)
	require.NoError(t, os.MkdirAll(dir, 0o700))

	received := new(string)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Message string `json:"message"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		*received = body.Message
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `{"ok":true}`)
	}))
	t.Cleanup(srv.Close)

	port := srv.Listener.Addr().(*net.TCPAddr).Port
	writeDiscoveryFile(t, dir, fmt.Sprintf("%d.pty.json", pid), map[string]any{
		"port":      port,
		"token":     "pty-secret",
		"ptyInject": true,
	})
	return received
}

// The core claim: what the caller is told was delivered is byte-for-byte what
// the transport received, and byte-for-byte sanitizeInjectMessage's output.
func TestSendMessageToChannel_DeliveredMatchesSanitizedAndTransport(t *testing.T) {
	cases := []struct {
		name  string
		input string
	}{
		{"single line", "hello world"},
		{"multi line", "START-AAAA\nMIDDLE-BBBB\nEND-CCCC"},
		{"blank lines", "START-AAAA\n\n\nEND-CCCC"},
		{"crlf", "START-AAAA\r\nEND-CCCC"},
		{"tab preserved", "START-AAAA\tEND-CCCC"},
		{"control chars", "START-AAAA\x01\x02\x7fEND-CCCC"},
		{"unchanged by sanitization", "nothing to strip here"},
		{"multibyte", "héllo — ünïcode ✓\nsecond line"},
	}
	for i, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			pid := 33000 + i
			received := ptyChannel(t, pid)

			transport, delivered, err := (&SpawnManager{}).SendMessageToChannel(
				context.Background(), pid, c.input)
			require.NoError(t, err)
			require.Equal(t, "pty", transport)

			require.Equal(t, sanitizeInjectMessage(c.input), delivered,
				"delivered must be exactly sanitizeInjectMessage's output")
			require.Equal(t, delivered, *received,
				"delivered must be exactly what the transport received")
		})
	}
}

// Sanitizing an already-sanitized message must be a no-op. The handler passes
// the raw body straight through now, but the property is what makes it safe
// for any caller to sanitize before calling — and it is what would silently
// break if the function ever started, say, collapsing runs of spaces.
func TestSanitizeInjectMessage_IsIdempotent(t *testing.T) {
	for _, in := range []string{
		"hello world",
		"START-AAAA\nMIDDLE-BBBB\nEND-CCCC",
		"a\r\n\r\nb",
		"tab\there",
		"héllo ✓\nünïcode",
		"",
	} {
		once := sanitizeInjectMessage(in)
		require.Equal(t, once, sanitizeInjectMessage(once), "input %q", in)
	}
}

// Newline stripping is the transformation that made the client's own echo
// diverge; pin it so a change has to be deliberate.
func TestSanitizeInjectMessage_StripsNewlinesAndKeepsTabs(t *testing.T) {
	require.Equal(t, "START-AAAAMIDDLE-BBBBEND-CCCC",
		sanitizeInjectMessage("START-AAAA\n\nMIDDLE-BBBB\nEND-CCCC"))
	require.Equal(t, "a\tb", sanitizeInjectMessage("a\tb"))
}

// Two genuinely different prompts must not sanitize to the same string —
// otherwise content-keyed deduplication downstream would merge them.
func TestSanitizeInjectMessage_KeepsDistinctMessagesDistinct(t *testing.T) {
	a := sanitizeInjectMessage("first prompt\nsecond line")
	b := sanitizeInjectMessage("first prompt\nthird line")
	require.NotEqual(t, a, b)
}

// delivered is reported even when there is no channel, so a failed send can
// still be audited against the text that was attempted.
func TestSendMessageToChannel_ReportsDeliveredEvenOnFailure(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	_, delivered, err := (&SpawnManager{}).SendMessageToChannel(
		context.Background(), 987654, "START-AAAA\nEND-CCCC")
	require.Error(t, err)
	require.Equal(t, "START-AAAAEND-CCCC", delivered)
}
