package askq

import "testing"

// Phase 4.1.1: Claude Code's tool permission prompt, read from synthetic screens.

func TestDetectToolPermission_BashPromptWithWrappedOption(t *testing.T) {
	rows := []string{
		"● I'll check the target folder first.",
		"",
		" Bash command",
		"",
		"   shasum -a 256 \"notes/sample.md\" && ls -la tailored/",
		"   Fingerprint sample, check target folder",
		"",
		" This command requires approval",
		" Do you want to proceed?",
		" ❯ 1. Yes",
		"   2. Yes, and don't ask again for \"shasum -a 256 \\\"notes/sample.md\\\" &&",
		"   ls -la tailored/\" commands in /tmp/sample",
		"   3. Yes, and switch to auto mode · auto mode handles these prompts for you",
		"   4. No",
		"",
		" Esc to cancel · Tab to amend",
	}
	p := DetectToolPermission(rows)
	if p == nil {
		t.Fatal("expected the permission prompt to be detected")
	}
	if p.Question != "Do you want to proceed?" || p.OptionCount != 4 {
		t.Fatalf("got %+v", p)
	}
	s := DetectScreen(rows)
	if s == nil || s.Permission == nil || s.Question != nil || s.Confirm != nil || s.FolderTrust != nil {
		t.Fatalf("DetectScreen must report only the permission prompt, got %+v", s)
	}
}

func TestDetectToolPermission_EditPrompt(t *testing.T) {
	rows := []string{
		"╭──────────────────────────────╮",
		"│ Edit file                    │",
		"│ Do you want to make this edit to sample.md? │",
		"│ ❯ 1. Yes                     │",
		"│   2. Yes, allow all edits during this session │",
		"│   3. No, and tell Claude what to do differently │",
		"╰──────────────────────────────╯",
	}
	if p := DetectToolPermission(rows); p == nil || p.OptionCount != 3 {
		t.Fatalf("expected an Edit permission prompt, got %+v", p)
	}
}

func TestDetectToolPermission_NotOtherScreens(t *testing.T) {
	cases := map[string][]string{
		"AskUserQuestion with Yes/No options is a question": {
			"Should I continue?",
			"❯ 1. Yes",
			"  2. No",
			"  3. Type something.",
			"  4. Chat about this",
		},
		"answered prompt still in scrollback": {
			"Do you want to proceed?",
			"❯ 1. Yes",
			"  2. No",
			"● Ran the command.",
			"  Done.",
		},
		"numbered output without a question": {
			"Steps:",
			"1. Yes, install dependencies",
			"2. No network access needed",
		},
		"not starting at Yes": {
			"Do you want to proceed?",
			"❯ 1. Submit answers",
			"  2. Cancel",
		},
	}
	for name, rows := range cases {
		if p := DetectToolPermission(rows); p != nil {
			t.Errorf("%s: must not be a permission prompt, got %+v", name, p)
		}
	}
	question := cases["AskUserQuestion with Yes/No options is a question"]
	if s := DetectScreen(question); s == nil || s.Question == nil || s.Permission != nil {
		t.Fatalf("a question modal must stay a question, got %+v", s)
	}
}
