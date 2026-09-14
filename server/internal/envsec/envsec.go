// Package envsec holds the canonical set of server-secret environment
// variable names that must never be forwarded to a spawned Claude agent or
// plugin process. Consumed by the interactive spawner, the pipeline
// spawner, and the plugin registry so the deny-set is declared once.
package envsec

// DeniedSecretEnvKeys are pure server secrets — consumed only by
// secretbox.go (plugin master key), the JWT signer, config.go's auth
// bypass, and the hooks HMAC. No spawned agent or plugin has any
// legitimate use for them.
var DeniedSecretEnvKeys = map[string]struct{}{
	"DASHBOARD_SECRET_KEY":         {},
	"DASHBOARD_JWT_SECRET":         {},
	"DASHBOARD_AUTH_PLUGIN_SECRET": {},
	"DASHBOARD_HOOKS_SECRET":       {},
}

// InheritedSessionMarkerKeys are variables Claude Code sets in the processes it
// starts to mark them as nested child sessions. A Claude process that finds one
// in its environment turns transcript saving off ("Transcript saving is off —
// inherited CLAUDE_CODE_CHILD_SESSION marker"), so it writes no session log.
//
// The dashboard never starts a Claude process as a child of another Claude
// session: every agent it launches — New Agent, a pipeline stage, a refinement
// turn — is a top-level session from its point of view. The marker only reaches
// those processes when the dashboard server itself happened to be launched from
// inside Claude Code, and then no session log is written, the roster never
// matches the process, and the agent is invisible. So spawn boundaries drop it
// from the INHERITED environment. It is not removed from the server's own
// environment, and a spawner row that declares it explicitly keeps it.
//
// Only this marker has evidence behind it. Other CLAUDE_* variables are left
// exactly as they were.
var InheritedSessionMarkerKeys = map[string]struct{}{
	"CLAUDE_CODE_CHILD_SESSION": {},
}

// IsInheritedSessionMarker reports whether key must not be inherited by a
// top-level Claude session the dashboard starts.
func IsInheritedSessionMarker(key string) bool {
	_, ok := InheritedSessionMarkerKeys[key]
	return ok
}

