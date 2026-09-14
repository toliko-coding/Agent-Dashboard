package parser_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/lx-wnk/agent-dashboard/server/internal/parser"
)

/*
 * Last activity (3N.0). A brand-new Claude Code 2.1.270 session showed
 * "23h 59m ago": a 131 KB attachment record after the conversation pushed every
 * user and assistant entry out of the 32 KB tail, and LastActivity fell back to
 * a made-up now-24h.
 */

func line(t *testing.T, v map[string]any) string {
	t.Helper()
	b, err := json.Marshal(v)
	require.NoError(t, err)
	return string(b)
}

func userEntry(t *testing.T, ts string) string {
	return line(t, map[string]any{"type": "user", "timestamp": ts, "message": map[string]any{"role": "user", "content": "do the thing"}})
}

func assistantEntry(t *testing.T, ts string) string {
	return line(t, map[string]any{"type": "assistant", "timestamp": ts, "message": map[string]any{
		"role": "assistant", "model": "claude-opus-5",
		"content": []map[string]any{{"type": "text", "text": "ok"}},
	}})
}

func attachmentEntry(t *testing.T, ts string, size int) string {
	return line(t, map[string]any{"type": "attachment", "timestamp": ts, "attachment": map[string]any{"content": strings.Repeat("x", size)}})
}

func metadataEntries(t *testing.T) []string {
	return []string{
		line(t, map[string]any{"type": "last-prompt", "lastPrompt": "do the thing"}),
		line(t, map[string]any{"type": "mode", "mode": "default"}),
		line(t, map[string]any{"type": "cost-state", "totalCostUSD": 0.08}),
	}
}

func writeLog(t *testing.T, lines ...string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "00000000-0000-0000-0000-000000000abc.jsonl")
	require.NoError(t, os.WriteFile(p, []byte(strings.Join(lines, "\n")+"\n"), 0o600))
	return p
}

func iso(tm time.Time) string { return tm.UTC().Format(time.RFC3339Nano) }

func TestLastActivity_NewSessionBeforeFirstReply(t *testing.T) {
	started := time.Now().Add(-3 * time.Second)
	p := writeLog(t, append([]string{userEntry(t, iso(started)), attachmentEntry(t, iso(started), 140_000)}, metadataEntries(t)...)...)

	data, err := parser.ParseSessionFile(p)
	require.NoError(t, err)
	assert.WithinDuration(t, started, data.LastActivity, time.Millisecond, "the prompt that started the session is its last activity")
	assert.Less(t, time.Since(data.LastActivity), time.Minute)
}

func TestLastActivity_ConversationBehindALargeTrailingRecord(t *testing.T) {
	reply := time.Now().Add(-8 * time.Second)
	p := writeLog(t, append([]string{
		userEntry(t, iso(reply.Add(-2*time.Second))),
		assistantEntry(t, iso(reply)),
		attachmentEntry(t, iso(reply), 131_000),
	}, metadataEntries(t)...)...)

	data, err := parser.ParseSessionFile(p)
	require.NoError(t, err)
	assert.WithinDuration(t, reply, data.LastActivity, time.Millisecond)
	assert.Equal(t, "claude-opus-5", data.Model, "the rest of the tail parse reaches the conversation too")
	assert.Equal(t, 1, data.ConversationTurns)
}

func TestLastActivity_UnknownWithoutConversationEntries(t *testing.T) {
	p := writeLog(t, append([]string{attachmentEntry(t, iso(time.Now()), 1000)}, metadataEntries(t)...)...)
	data, err := parser.ParseSessionFile(p)
	require.NoError(t, err)
	assert.True(t, data.LastActivity.IsZero(), "no conversation entry means unknown, never a placeholder time")
}

func TestLastActivity_ExplicitOffsetIsTheSameInstant(t *testing.T) {
	p := writeLog(t, assistantEntry(t, "2026-09-14T00:00:05+03:00"))
	data, err := parser.ParseSessionFile(p)
	require.NoError(t, err)
	assert.True(t, data.LastActivity.Equal(time.Date(2026, 9, 13, 21, 0, 5, 0, time.UTC)), "got %s", data.LastActivity)
}

func TestLastActivity_AcrossUTCMidnight(t *testing.T) {
	p := writeLog(t, userEntry(t, "2026-09-13T23:59:58.100Z"), assistantEntry(t, "2026-09-14T00:00:03.250Z"))
	data, err := parser.ParseSessionFile(p)
	require.NoError(t, err)
	assert.True(t, data.LastActivity.Equal(time.Date(2026, 9, 14, 0, 0, 3, 250_000_000, time.UTC)), "got %s", data.LastActivity)
}

// Claude writes a zone on every timestamp; a zoneless one is ignored, not read as local time.
func TestLastActivity_ZonelessTimestampIsIgnored(t *testing.T) {
	p := writeLog(t, userEntry(t, "2026-09-14T16:34:57.000Z"), assistantEntry(t, "2026-09-14T16:40:00.000"))
	data, err := parser.ParseSessionFile(p)
	require.NoError(t, err)
	assert.True(t, data.LastActivity.Equal(time.Date(2026, 9, 14, 16, 34, 57, 0, time.UTC)), "got %s", data.LastActivity)
}

func TestLastActivity_GenuinelyOldSession(t *testing.T) {
	old := time.Now().Add(-72 * time.Hour)
	p := writeLog(t, userEntry(t, iso(old.Add(-time.Minute))), assistantEntry(t, iso(old)))
	data, err := parser.ParseSessionFile(p)
	require.NoError(t, err)
	assert.InDelta(t, 72*time.Hour, time.Since(data.LastActivity), float64(5*time.Second))
}

// The window grows to reach the conversation, but not without bound.
func TestLastActivity_TailWindowIsBounded(t *testing.T) {
	p := writeLog(t, assistantEntry(t, iso(time.Now())), attachmentEntry(t, iso(time.Now()), 3<<20))
	data, err := parser.ParseSessionFile(p)
	require.NoError(t, err)
	assert.True(t, data.LastActivity.IsZero(), "a conversation more than 2 MiB back is unknown, not guessed")
}
