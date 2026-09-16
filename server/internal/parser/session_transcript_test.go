package parser

import (
	"os"
	"path/filepath"
	"testing"
)

/*
 * Whether a stored session can still be resumed.
 *
 * A durable agent outlives its sessions, so a saved session id proves nothing
 * on its own - the transcript may have been pruned, or the agent may never have
 * run one. Resuming a session Claude cannot find would start an empty one while
 * telling the user their conversation was being continued.
 */
func TestSessionTranscriptExists(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("CLAUDE_CONFIG_DIR", "")

	projects := filepath.Join(home, ".claude", "projects", "-work-portfolio")
	if err := os.MkdirAll(projects, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	const kept = "f7e1bb35-f803-4df1-959e-5c373798c352"
	if err := os.WriteFile(filepath.Join(projects, kept+".jsonl"), []byte("{}\n"), 0o600); err != nil {
		t.Fatalf("write transcript: %v", err)
	}

	if !SessionTranscriptExists(kept) {
		t.Fatal("a session with a transcript reads as not resumable")
	}
	if SessionTranscriptExists("cdc9e4c8-066e-410d-af10-d90143666fe8") {
		t.Fatal("a session with no transcript reads as resumable")
	}
	// An agent that has never run a session has no id at all, and must not be
	// offered a resume on the strength of an empty string.
	if SessionTranscriptExists("") {
		t.Fatal("an empty session id reads as resumable")
	}
}
