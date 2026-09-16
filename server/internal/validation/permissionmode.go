package validation

// Claude's permission modes, as the dashboard is allowed to pass them.
//
// These strings are the contract with claude's --permission-mode flag. They are
// checked when an agent is started, when a saved configuration is written, and
// again before a saved configuration is applied to a new session, so the list
// lives here rather than in whichever package happened to need it first.
//
// The client keeps its own copy in src/utils/permissionModes.ts: Go cannot be
// imported from TypeScript, so the two are kept in parity by hand, the same way
// the slug rules above are.
const (
	PermissionModeDefault     = "default"
	PermissionModePlan        = "plan"
	PermissionModeAcceptEdits = "acceptEdits"
	PermissionModeAuto        = "auto"
	PermissionModeBypass      = "bypassPermissions"
	PermissionModeDontAsk     = "dontAsk"
)

// PermissionModes lists every accepted mode, in the order the UI offers them.
func PermissionModes() []string {
	return []string{
		PermissionModeDefault,
		PermissionModePlan,
		PermissionModeAcceptEdits,
		PermissionModeAuto,
		PermissionModeBypass,
		PermissionModeDontAsk,
	}
}

// IsPermissionMode reports whether mode is one the dashboard may pass on.
// An empty string is not a mode: callers decide whether absent means "default"
// (starting a session) or "nothing saved" (a stored configuration), and those
// are different facts.
func IsPermissionMode(mode string) bool {
	switch mode {
	case PermissionModeDefault, PermissionModePlan, PermissionModeAcceptEdits,
		PermissionModeAuto, PermissionModeBypass, PermissionModeDontAsk:
		return true
	}
	return false
}

// IsDangerousPermissionMode reports whether a mode skips every confirmation
// prompt. `auto` and `plan` are not dangerous: auto still asks for what it
// cannot approve, and plan cannot change anything.
func IsDangerousPermissionMode(mode string) bool {
	return mode == PermissionModeBypass || mode == PermissionModeDontAsk
}
