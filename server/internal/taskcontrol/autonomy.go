package taskcontrol

// IsAllowAll reports whether the given autonomy level enables the allow-all
// permission gate: every permission request is auto-approved and the stage
// agent's allow-list pre-approves every tool, blanket Bash included (only
// git push stays denied unless allowed). "spec_gated" and "full" are identical
// here — no spec approval gates the permissions.
//
// Empty-string autonomy intentionally maps to false: rows that pre-date the
// field (migrated without a value) keep the gated behaviour. New tasks default
// to "manual" (schema default, db.DefaultAutonomy), so allow-all is always an
// explicit choice.
func IsAllowAll(autonomy string) bool {
	return autonomy == "spec_gated" || autonomy == "full"
}

// ValidAutonomyValues is the canonical set of accepted autonomy strings.
// Callers must reject any value not in this set.
var ValidAutonomyValues = map[string]struct{}{
	"manual":     {},
	"spec_gated": {},
	"full":       {},
}

// PermissiveAllowList returns the --allowedTools slice for allow-all tasks.
// The operator has opted into unrestricted tool access, so the safe-list check
// for Bash patterns is bypassed and blanket Bash is included.
//
// Git push is still gated when allowGitPush is false: the spawner writes a
// settings deny entry for Bash(git push:*) so Claude honours the restriction
// at the CLI level even on the allow-all path.
func PermissiveAllowList(allowGitPush bool) []string {
	_ = allowGitPush // containment is handled via BuildDenyList / settings deny
	return []string{
		"Read",
		"Write",
		"Edit",
		"MultiEdit",
		"Glob",
		"Grep",
		"LS",
		"Agent",
		"WebFetch",
		"WebSearch",
		"Task",
		"TodoRead",
		"TodoWrite",
		"NotebookRead",
		"NotebookEdit",
		// Blanket Bash: allow-all explicitly bypasses the safe-list since the
		// operator has opted into unattended operation.
		"Bash",
	}
}
