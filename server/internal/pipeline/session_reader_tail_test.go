package pipeline_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/lx-wnk/agent-dashboard/server/internal/pipeline"
)

// Phase 4.1 regression: Claude Code writes large attachment records after a
// reply. The structured result must still be found — a fixed 32 KB tail read it
// as "no structured output", misreporting a valid result as invalid.
func TestReadLastStageJsonOutput_ReplyFollowedByLargeAttachment(t *testing.T) {
	path := filepath.Join(t.TempDir(), "session.jsonl")
	reply := "```json\n" + `{"roadmapProposal":{"objective":"o","phases":[{"title":"A","status":"planned"}]}}` + "\n```"
	line := func(v any) string { b, _ := json.Marshal(v); return string(b) + "\n" }
	content := line(map[string]any{"type": "user", "message": map[string]any{"role": "user", "content": "go"}}) +
		line(map[string]any{"type": "assistant", "message": map[string]any{"role": "assistant", "content": []any{map[string]any{"type": "text", "text": reply}}}}) +
		line(map[string]any{"type": "attachment", "attachment": strings.Repeat("x", 122_000)}) +
		line(map[string]any{"type": "system", "subtype": "turn_duration"})
	require.NoError(t, os.WriteFile(path, []byte(content), 0o600))

	read, err := pipeline.ReadLastStageJsonOutputFromFile(path)
	require.NoError(t, err)
	require.NotNil(t, read.Output, "the reply before a 122 KB attachment must still be read")
	require.Contains(t, read.Output, "roadmapProposal")
}
