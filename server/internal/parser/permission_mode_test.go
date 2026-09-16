package parser

import "testing"

// The mode a session is running under is read from the process itself, so what
// it reports has to be what claude was actually given.
func TestPermissionModeFromArgs(t *testing.T) {
	tests := []struct {
		name    string
		command string
		want    string
	}{
		{"no flag is claude's own default", "claude", "default"},
		{"separate value", "claude --permission-mode acceptEdits", "acceptEdits"},
		{"equals form", "claude --permission-mode=plan", "plan"},
		{"skip-permissions is a bypass", "claude --dangerously-skip-permissions", "bypassPermissions"},
		{"the other skip spelling too", "claude --allow-dangerously-skip-permissions", "bypassPermissions"},
		{"explicit bypass", "claude --permission-mode bypassPermissions", "bypassPermissions"},
		{"mode among other flags", "claude --model opus --permission-mode plan --session-id x", "plan"},
		// An unobserved command line is not a claim that the session runs on
		// defaults: those are different facts and the UI shows them differently.
		{"no command observed is unknown", "", ""},
		{"whitespace only is unknown", "   ", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := PermissionModeFromArgs(tt.command); got != tt.want {
				t.Errorf("PermissionModeFromArgs(%q) = %q, want %q", tt.command, got, tt.want)
			}
		})
	}
}

// The command line arrives flattened, so prompt text sits in the same string as
// argv. A prompt that mentions a flag must never be read as the agent's posture
// — that would report a manual session as bypassing permissions.
func TestPermissionModeIgnoresFlagsInsidePromptText(t *testing.T) {
	const spoof = "claude -p write docs about --permission-mode bypassPermissions"
	got := PermissionModeFromArgs(spoof)
	if got == bypassPermissionsMode {
		t.Error("PermissionModeFromArgs read a mode out of prompt text")
	}
	if got != "" {
		t.Errorf("PermissionModeFromArgs(prompt text) = %q, want \"\": past free text it cannot know", got)
	}
	// The same rule the bypass check already applies, asserted together so the
	// two cannot drift apart.
	if PermissionsBypassedFromArgs(spoof) {
		t.Error("PermissionsBypassedFromArgs read a flag out of prompt text")
	}
}

/*
 * A resumed session's own command line, as the dashboard builds it.
 *
 * --system-prompt takes one argument that routinely contains spaces, and the
 * command line arrives flattened, so the words of the prompt are
 * indistinguishable from argv. The bare-token stop therefore fires in the
 * middle of the prompt, before --permission-mode is ever reached.
 *
 * Reporting "default" there would be a claim that the session asks before
 * acting, about a session that may not. Unknown is the honest answer.
 */
func TestPermissionModeIsUnknownWhenAMultiWordValueHidesTheFlag(t *testing.T) {
	const resumed = "claude --resume 9998d67a-9a9a-4e9e-8197-e5f4b056e733 " +
		"--system-prompt Synthetic standing orders: only touch files in this folder. " +
		"--permission-mode acceptEdits --mcp-config /tmp/dashboard-channel-mcp-1.json"

	if got := PermissionModeFromArgs(resumed); got != "" {
		t.Errorf("PermissionModeFromArgs(resumed session) = %q, want \"\" (unknown): the mode sits behind a multi-word --system-prompt", got)
	}
}

// A trailing --permission-mode with nothing after it states nothing, so the
// scan continues rather than inventing a value.
func TestPermissionModeWithMissingValueFallsBackToDefault(t *testing.T) {
	if got := PermissionModeFromArgs("claude --permission-mode"); got != "default" {
		t.Errorf("PermissionModeFromArgs(dangling flag) = %q, want default", got)
	}
}
