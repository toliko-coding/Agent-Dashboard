package pipeline_test

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/lx-wnk/agent-dashboard/server/internal/db/ent"
	"github.com/lx-wnk/agent-dashboard/server/internal/pipeline"
	"github.com/lx-wnk/agent-dashboard/server/internal/services"
)

// Phase 4.1: whatever a task row says (rows can predate the create-time check),
// a stage agent never starts in a sensitive folder — for every autonomy level.
func TestSpawnStageAgent_RefusesSensitiveFolder(t *testing.T) {
	home, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", home)
	ssh := filepath.Join(home, ".ssh")
	if err := os.MkdirAll(ssh, 0o700); err != nil {
		t.Fatal(err)
	}
	for _, autonomy := range []string{"manual", "spec_gated", "full"} {
		_, err := pipeline.SpawnStageAgent(pipeline.SpawnAgentOptions{
			Task:     &ent.Task{ID: "t", Cwd: ssh, Autonomy: autonomy},
			StageRun: &ent.StageRun{ID: "sr"},
		})
		if !errors.Is(err, services.ErrCwdBlacklisted) {
			t.Fatalf("%s: expected ErrCwdBlacklisted, got %v", autonomy, err)
		}
		if _, statErr := os.Stat(filepath.Join(ssh, ".claude")); statErr == nil {
			t.Fatalf("%s: nothing may be written into the sensitive folder", autonomy)
		}
	}
}
