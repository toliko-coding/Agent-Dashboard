package envsec

import "testing"

func TestIsInheritedSessionMarker(t *testing.T) {
	if !IsInheritedSessionMarker("CLAUDE_CODE_CHILD_SESSION") {
		t.Fatal("the child-session marker must be recognised")
	}
	for _, keep := range []string{"CLAUDE_CONFIG_DIR", "CLAUDE_CODE_ENTRYPOINT", "CLAUDECODE", "PATH", "HOME"} {
		if IsInheritedSessionMarker(keep) {
			t.Errorf("%s must not be treated as a session marker", keep)
		}
	}
}
