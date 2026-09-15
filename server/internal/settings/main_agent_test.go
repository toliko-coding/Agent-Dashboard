package settings

import "testing"

// The main-agent designation stores a session id, so the registry accepts one
// or nothing at all. It deliberately does not check that the session exists:
// that is a fact about a running roster, not about a stored string, and the
// surfaces that show the designation check it separately.
func TestMainAgentSessionIDValidation(t *testing.T) {
	validate := optionalSessionID(MainAgentSessionKey)

	t.Run("empty means no main agent", func(t *testing.T) {
		if err := validate(""); err != nil {
			t.Errorf("empty value rejected: %v", err)
		}
	})

	t.Run("a session id is accepted", func(t *testing.T) {
		for _, id := range []string{
			"cdc9e4c8-1111-4222-8333-444455556666",
			"CDC9E4C8-AAAA-4BBB-8CCC-DDDDEEEEFFFF",
		} {
			if err := validate(id); err != nil {
				t.Errorf("validate(%q) = %v, want accepted", id, err)
			}
		}
	})

	t.Run("anything that is not a session id is refused", func(t *testing.T) {
		for _, bad := range []string{
			"main",
			"cdc9e4c8111142228333444455556666",      // no dashes
			"cdc9e4c8-1111-4222-8333-44445555666g",  // not hex
			"cdc9e4c8-1111-4222-8333-4444555566661", // too long
			"cdc9e4c8-1111-4222-8333",               // too short
			"../../etc/passwd",
		} {
			if err := validate(bad); err == nil {
				t.Errorf("validate(%q) accepted a value that is not a session id", bad)
			}
		}
	})
}

// The key is one value, which is what makes "at most one main agent" structural
// rather than a rule someone has to remember to enforce.
func TestMainAgentKeyIsASingleValue(t *testing.T) {
	if MainAgentSessionKey == "" {
		t.Fatal("MainAgentSessionKey is empty")
	}
	seen := 0
	for _, d := range All() {
		if d.Key == MainAgentSessionKey {
			seen++
			if d.Apply != ApplyLive {
				t.Errorf("Apply = %q, want live: a designation needs no restart", d.Apply)
			}
			if d.Default != "" {
				t.Errorf("Default = %q, want empty: no agent is main until one is chosen", d.Default)
			}
		}
	}
	if seen != 1 {
		t.Errorf("found %d definitions for %s, want exactly 1", seen, MainAgentSessionKey)
	}
}
