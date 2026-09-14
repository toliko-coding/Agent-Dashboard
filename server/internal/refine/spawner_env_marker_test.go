package refine

import (
	"strings"
	"testing"
)

func TestMergeEnv_DropsInheritedChildSessionMarker(t *testing.T) {
	t.Setenv("CLAUDE_CODE_CHILD_SESSION", "1")
	t.Setenv("CLAUDE_CODE_ENTRYPOINT", "cli")
	var sawMarker, sawEntrypoint bool
	for _, kv := range mergeEnv(nil) {
		if strings.HasPrefix(kv, "CLAUDE_CODE_CHILD_SESSION=") {
			sawMarker = true
		}
		if kv == "CLAUDE_CODE_ENTRYPOINT=cli" {
			sawEntrypoint = true
		}
	}
	if sawMarker {
		t.Error("a refinement turn must not inherit the child-session marker")
	}
	if !sawEntrypoint {
		t.Error("unrelated CLAUDE_ variables must be kept")
	}
}
