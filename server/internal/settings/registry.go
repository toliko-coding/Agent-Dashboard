// Package settings defines the DB-backed configuration registry (the single
// source of truth for non-bootstrap settings) and a service to read/write them.
package settings

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strconv"
)

// Type is the value type of a setting; the stored value is always a string.
type Type string

const (
	TypeBool        Type = "bool"
	TypeInt         Type = "int"
	TypeFloat       Type = "float"
	TypeString      Type = "string"
	TypeStringSlice Type = "stringSlice" // comma-joined in storage
	TypeEnum        Type = "enum"
)

// Apply describes when a change takes effect.
type Apply string

const (
	ApplyLive    Apply = "live"
	ApplyRestart Apply = "restart"
)

// Definition declares one setting. Default is the string form of the value.
type Definition struct {
	Key      string
	Type     Type
	Default  string
	Apply    Apply
	Category string
	Enum     []string // for TypeEnum
	// Secret routes the value through secretbox on write and masks it on
	// every read that is not Service.Secret. A secret definition must not
	// carry a Default: a default would be returned in clear by the
	// registry-fallback path before anything was ever stored.
	Secret   bool
	validate func(raw string) error // extra constraint beyond type parsing
}

// Validate checks raw against the type, enum, and any extra constraint.
func (d Definition) Validate(raw string) error {
	switch d.Type {
	case TypeBool:
		if _, err := strconv.ParseBool(raw); err != nil {
			return fmt.Errorf("%s: must be a boolean", d.Key)
		}
	case TypeInt:
		if _, err := strconv.Atoi(raw); err != nil {
			return fmt.Errorf("%s: must be an integer", d.Key)
		}
	case TypeFloat:
		if _, err := strconv.ParseFloat(raw, 64); err != nil {
			return fmt.Errorf("%s: must be a number", d.Key)
		}
	case TypeEnum:
		for _, e := range d.Enum {
			if raw == e {
				if d.validate != nil {
					return d.validate(raw)
				}
				return nil
			}
		}
		return fmt.Errorf("%s: must be one of %v", d.Key, d.Enum)
	case TypeString, TypeStringSlice:
		// any string accepted
	}
	if d.validate != nil {
		return d.validate(raw)
	}
	return nil
}

// SpawnWorkingFoldersKey holds the folders a user explicitly allowed agents to
// be started in, apart from any Dashboard Project: a JSON array of clean
// absolute paths. JSON rather than a stringSlice, whose comma-joined storage
// would split a path that contains a comma. Read by services.WorkingFolders.
const SpawnWorkingFoldersKey = "spawn.workingFolders"

// ProjectlessRootKey holds the folder the dashboard creates projectless agent
// workspaces in (3N.2): a clean absolute path, or "" for the default
// ~/Documents/AI-Agents. Sensitive locations are refused by the service that
// writes it (services.SetProjectlessRoot), which this package cannot import.
const ProjectlessRootKey = "agents.projectlessRoot"

// optionalAbsolutePath accepts "" or a clean absolute path.
func optionalAbsolutePath(key string) func(string) error {
	return func(raw string) error {
		if raw == "" {
			return nil
		}
		if !filepath.IsAbs(raw) || filepath.Clean(raw) != raw {
			return fmt.Errorf("%s: must be a clean absolute path", key)
		}
		return nil
	}
}

// absolutePathList accepts a JSON array of clean absolute paths.
func absolutePathList(key string) func(string) error {
	return func(raw string) error {
		var paths []string
		if err := json.Unmarshal([]byte(raw), &paths); err != nil {
			return fmt.Errorf("%s: must be a JSON array of absolute paths", key)
		}
		for _, p := range paths {
			if !filepath.IsAbs(p) || filepath.Clean(p) != p {
				return fmt.Errorf("%s: %q is not a clean absolute path", key, p)
			}
		}
		return nil
	}
}

func positiveInt(key string) func(string) error {
	return func(raw string) error {
		n, err := strconv.Atoi(raw)
		if err != nil || n <= 0 {
			return fmt.Errorf("%s: must be a positive integer", key)
		}
		return nil
	}
}

func nonNegativeInt(key string) func(string) error {
	return func(raw string) error {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 0 {
			return fmt.Errorf("%s: must be >= 0", key)
		}
		return nil
	}
}

func nonNegativeFloat(key string) func(string) error {
	return func(raw string) error {
		f, err := strconv.ParseFloat(raw, 64)
		if err != nil || f < 0 {
			return fmt.Errorf("%s: must be >= 0", key)
		}
		return nil
	}
}

// definitions is the SSOT for every DB-backed setting.
var definitions = func() map[string]Definition {
	list := []Definition{
		{Key: "auth.mode", Type: TypeEnum, Enum: []string{"none", "plugin"}, Default: "none", Apply: ApplyRestart, Category: "auth"},
		{Key: "git.allowPush", Type: TypeBool, Default: "false", Apply: ApplyRestart, Category: "git"},
		{Key: "git.allowPull", Type: TypeBool, Default: "false", Apply: ApplyRestart, Category: "git"},
		{Key: "worktree.force", Type: TypeBool, Default: "true", Apply: ApplyRestart, Category: "worktree"},
		{Key: "sse.intervalMs", Type: TypeInt, Default: "3000", Apply: ApplyRestart, Category: "sse", validate: positiveInt("sse.intervalMs")},
		{Key: "shutdown.timeoutSeconds", Type: TypeInt, Default: "10", Apply: ApplyRestart, Category: "server", validate: positiveInt("shutdown.timeoutSeconds")},
		{Key: "hooks.debounceMs", Type: TypeInt, Default: "100", Apply: ApplyRestart, Category: "hooks", validate: positiveInt("hooks.debounceMs")},
		{Key: "hooks.eventsPerSession", Type: TypeInt, Default: "50", Apply: ApplyRestart, Category: "hooks", validate: positiveInt("hooks.eventsPerSession")},
		{Key: "spawn.rateLimit", Type: TypeInt, Default: "5", Apply: ApplyRestart, Category: "spawn"},
		{Key: "spawn.allowedCommands", Type: TypeStringSlice, Default: "", Apply: ApplyRestart, Category: "spawn"},
		// Folders a user explicitly allowed agents to start in, apart from any Project.
		{Key: SpawnWorkingFoldersKey, Type: TypeString, Default: "[]", Apply: ApplyLive, Category: "spawn", validate: absolutePathList(SpawnWorkingFoldersKey)},
		// Where the dashboard creates workspaces for agents that have no repository (3N.2).
		{Key: ProjectlessRootKey, Type: TypeString, Default: "", Apply: ApplyLive, Category: "spawn", validate: optionalAbsolutePath(ProjectlessRootKey)},
		{Key: "spawn.rateWindowMs", Type: TypeInt, Default: "60000", Apply: ApplyRestart, Category: "spawn", validate: positiveInt("spawn.rateWindowMs")},
		{Key: "inject.rateLimit", Type: TypeInt, Default: "30", Apply: ApplyRestart, Category: "inject"},
		{Key: "inject.rateWindowMs", Type: TypeInt, Default: "60000", Apply: ApplyRestart, Category: "inject", validate: positiveInt("inject.rateWindowMs")},
		{Key: "cost.scanIntervalMs", Type: TypeInt, Default: "300000", Apply: ApplyRestart, Category: "cost", validate: positiveInt("cost.scanIntervalMs")},
		{Key: "eval.scanIntervalMs", Type: TypeInt, Default: "3600000", Apply: ApplyRestart, Category: "eval", validate: positiveInt("eval.scanIntervalMs")},
		{Key: "eval.windowHours", Type: TypeInt, Default: "168", Apply: ApplyRestart, Category: "eval", validate: positiveInt("eval.windowHours")},
		{Key: "eval.minSamples", Type: TypeInt, Default: "20", Apply: ApplyRestart, Category: "eval", validate: nonNegativeInt("eval.minSamples")},
		{Key: "eval.rateDropPP", Type: TypeFloat, Default: "15", Apply: ApplyRestart, Category: "eval", validate: nonNegativeFloat("eval.rateDropPP")},
		{Key: "eval.stddevK", Type: TypeFloat, Default: "3", Apply: ApplyRestart, Category: "eval", validate: nonNegativeFloat("eval.stddevK")},
		{Key: "usage.budget.session", Type: TypeInt, Default: "0", Apply: ApplyLive, Category: "usage", validate: nonNegativeInt("usage.budget.session")},
		{Key: "usage.budget.weekly", Type: TypeInt, Default: "0", Apply: ApplyLive, Category: "usage", validate: nonNegativeInt("usage.budget.weekly")},
		// The agent that maintains Agent Dashboard itself. One key, so there is
		// exactly one main agent by construction rather than by convention. It is
		// a designation and nothing more: it grants no permission, bypasses no
		// ownership check, and gives the agent no authority over other agents.
		{Key: MainAgentSessionKey, Type: TypeString, Default: "", Apply: ApplyLive, Category: "agents", validate: optionalSessionID(MainAgentSessionKey)},
		{Key: "onboarding.completed", Type: TypeBool, Default: "false", Apply: ApplyLive, Category: "onboarding"},
		{Key: "obsidian.apiKey", Type: TypeString, Secret: true, Apply: ApplyRestart, Category: "obsidian"},
		{Key: "obsidian.baseURL", Type: TypeString, Default: "", Apply: ApplyRestart, Category: "obsidian"},
		{Key: "obsidian.vaultRoot", Type: TypeString, Default: "", Apply: ApplyRestart, Category: "obsidian"},
		{Key: "obsidian.tlsMode", Type: TypeEnum, Enum: []string{"verify", "pinned", "insecure-loopback"}, Default: "verify", Apply: ApplyRestart, Category: "obsidian"},
		// github.token is the fine-grained PAT the GitHub Application
		// authenticates with. Secret, so it is encrypted at rest and masked on
		// every read except Service.Secret — and therefore carries no Default,
		// which Definition's own doc comment forbids for a secret.
		//
		// github.token and github.repos are a required PAIR:
		// serverapp.buildGitHubClient refuses to boot when exactly one is set.
		// github.baseURL is deliberately NOT part of that pair — it has a
		// Default, so it is never unset and cannot be a missing half of
		// anything.
		{Key: "github.token", Type: TypeString, Secret: true, Apply: ApplyRestart, Category: "github"},
		{Key: "github.repos", Type: TypeString, Default: "", Apply: ApplyRestart, Category: "github"},
		{Key: "github.baseURL", Type: TypeString, Default: "https://api.github.com", Apply: ApplyRestart, Category: "github"},
	}
	m := make(map[string]Definition, len(list))
	for _, d := range list {
		m[d.Key] = d
	}
	if err := validateDefinitions(m); err != nil {
		panic(err)
	}
	return m
}()

// validateDefinitions checks registry-wide invariants across every
// definition. A secret definition must not carry a Default: the
// registry-fallback path in Service.raw would return it in clear before
// anything was ever stored. Called once at package init (a mis-registered
// definition is a programming error, not a runtime condition), and exposed
// separately so the invariant itself is unit-testable without a
// registration API.
func validateDefinitions(defs map[string]Definition) error {
	for _, d := range defs {
		if d.Secret && d.Default != "" {
			return fmt.Errorf("settings: %s: secret settings must not have a Default", d.Key)
		}
	}
	return nil
}

// Lookup returns the definition for key.
func Lookup(key string) (Definition, bool) { d, ok := definitions[key]; return d, ok }

// All returns every definition (unordered).
func All() []Definition {
	out := make([]Definition, 0, len(definitions))
	for _, d := range definitions {
		out = append(out, d)
	}
	return out
}

// MainAgentSessionKey holds the Claude session id of the agent that maintains
// Agent Dashboard itself. Empty means none is designated.
const MainAgentSessionKey = "agents.mainSessionId"

/*
 * optionalSessionID accepts an empty value or a Claude session id.
 *
 * The format check is all this layer can do: whether that session exists, and
 * whether the dashboard started it, are facts about a running roster rather
 * than about a stored string. Callers that show the designation check those
 * separately, so a stale or foreign id is simply never matched.
 */
func optionalSessionID(key string) func(raw string) error {
	return func(raw string) error {
		if raw == "" {
			return nil
		}
		const uuidLen = 36
		if len(raw) != uuidLen {
			return fmt.Errorf("%s must be a session id (UUID) or empty", key)
		}
		for i, r := range raw {
			if i == 8 || i == 13 || i == 18 || i == 23 {
				if r != '-' {
					return fmt.Errorf("%s must be a session id (UUID) or empty", key)
				}
				continue
			}
			isHex := (r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F')
			if !isHex {
				return fmt.Errorf("%s must be a session id (UUID) or empty", key)
			}
		}
		return nil
	}
}
