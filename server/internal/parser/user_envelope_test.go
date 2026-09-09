package parser

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
)

/*
 * System envelopes in user-role JSONL entries.
 *
 * handleUserMessage emits one human message per text block, so an unfiltered
 * envelope does not merely add noise — it renders as an extra chat bubble that
 * looks like a message the user never sent. These tests pin which envelopes are
 * suppressed and, just as importantly, that ordinary prompts are not.
 */

// buildUserLine renders one type=="user" JSONL line whose content is the given
// block array.
func buildUserLine(t *testing.T, blocks []map[string]any) string {
	t.Helper()
	b, err := json.Marshal(map[string]any{
		"type":      "user",
		"timestamp": "2026-01-01T00:00:00Z",
		"message":   map[string]any{"role": "user", "content": blocks},
	})
	require.NoError(t, err)
	return string(b)
}

// buildUserStringLine renders a type=="user" line whose content is a bare
// string, which is how a plain typed prompt is usually recorded.
func buildUserStringLine(t *testing.T, text string) string {
	t.Helper()
	b, err := json.Marshal(map[string]any{
		"type":      "user",
		"timestamp": "2026-01-01T00:00:00Z",
		"message":   map[string]any{"role": "user", "content": text},
	})
	require.NoError(t, err)
	return string(b)
}

func humanMessages(msgs []OutputMessage) []OutputMessage {
	out := make([]OutputMessage, 0, len(msgs))
	for _, m := range msgs {
		if m.Role == "human" {
			out = append(out, m)
		}
	}
	return out
}

// The reported shape: Claude records the IDE context notice and the real prompt
// as two text blocks of ONE user turn. Only the prompt is the user's message.
func TestParseOutputMessages_IDEOpenedFileEnvelopeIsNotAHumanMessage(t *testing.T) {
	line := buildUserLine(t, []map[string]any{
		{"type": "text", "text": "<ide_opened_file>The user opened the file /tmp/x.go in the IDE.</ide_opened_file>"},
		{"type": "text", "text": "write 150 char describe about the project"},
	})

	humans := humanMessages(parseOutputMessages(line, false))

	require.Len(t, humans, 1, "one user turn must render as one human message")
	require.Equal(t, "write 150 char describe about the project", humans[0].Content)
}

// A notification with no accompanying prompt is not a message from anyone.
func TestParseOutputMessages_TaskNotificationAloneYieldsNoHumanMessage(t *testing.T) {
	line := buildUserLine(t, []map[string]any{
		{"type": "text", "text": "<task-notification>Background task b0rbdg8d9 completed.</task-notification>"},
	})

	require.Empty(t, humanMessages(parseOutputMessages(line, false)))
}

func TestParseOutputMessages_TaskNotificationBeforePromptIsDropped(t *testing.T) {
	line := buildUserLine(t, []map[string]any{
		{"type": "text", "text": "<task-notification>Background task completed.</task-notification>"},
		{"type": "text", "text": "now summarise the result"},
	})

	humans := humanMessages(parseOutputMessages(line, false))
	require.Len(t, humans, 1)
	require.Equal(t, "now summarise the result", humans[0].Content)
}

// The envelopes that were already filtered must stay filtered.
func TestParseOutputMessages_PreexistingEnvelopesStayFiltered(t *testing.T) {
	for _, envelope := range []string{
		"<command-name>/compact</command-name>",
		"<local-command-caveat>Local commands are not visible</local-command-caveat>",
		"<command-message>compacting…</command-message>",
		"<function_calls>…</function_calls>",
	} {
		t.Run(envelope[:14], func(t *testing.T) {
			line := buildUserLine(t, []map[string]any{{"type": "text", "text": envelope}})
			require.Empty(t, humanMessages(parseOutputMessages(line, false)))
		})
	}
}

// The regression this whole change exists to prevent: ordinary prompts must
// still render, in both recorded shapes, and exactly once.
func TestParseOutputMessages_OrdinaryPromptIsUnaffected(t *testing.T) {
	t.Run("string content", func(t *testing.T) {
		humans := humanMessages(parseOutputMessages(buildUserStringLine(t, "hello world"), false))
		require.Len(t, humans, 1)
		require.Equal(t, "hello world", humans[0].Content)
	})

	t.Run("single text block", func(t *testing.T) {
		line := buildUserLine(t, []map[string]any{{"type": "text", "text": "hello world"}})
		humans := humanMessages(parseOutputMessages(line, false))
		require.Len(t, humans, 1)
		require.Equal(t, "hello world", humans[0].Content)
	})
}

// A prompt that merely mentions an envelope name is not an envelope. Only a
// leading tag suppresses, which is why the filter is a prefix list of known
// tags rather than a "contains markup" guess.
func TestParseOutputMessages_PromptMentioningAnEnvelopeStillRenders(t *testing.T) {
	text := "why does <ide_opened_file> show up in my chat?"
	humans := humanMessages(parseOutputMessages(buildUserStringLine(t, text), false))
	require.Len(t, humans, 1)
	require.Equal(t, text, humans[0].Content)
}

// Two genuine prompts in one turn remain two messages: the filter removes
// envelopes, not multiplicity.
func TestParseOutputMessages_TwoGenuineTextBlocksRemainTwoMessages(t *testing.T) {
	line := buildUserLine(t, []map[string]any{
		{"type": "text", "text": "first"},
		{"type": "text", "text": "second"},
	})
	require.Len(t, humanMessages(parseOutputMessages(line, false)), 2)
}
