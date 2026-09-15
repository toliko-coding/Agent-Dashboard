package askq

import (
	"testing"

	"github.com/lx-wnk/agent-dashboard/sdk"
)

// Phase 4 final permission UX: only a prompt whose Approve once and Deny map to
// its own options, and whose heading is about the open tool call, is decidable.

func bashPromptRows(noLabel string) []string {
	return []string{
		" Bash command",
		"",
		"   shasum -a 256 notes/sample.txt",
		"   Fingerprint the sample",
		"",
		" This command requires approval",
		" Do you want to proceed?",
		" ❯ 1. Yes",
		"   2. Yes, and don't ask again for shasum commands in /tmp/sample",
		"   3. Yes, and switch to auto mode · auto mode handles these prompts for you",
		"   4. " + noLabel,
		"",
		" Esc to cancel · Tab to amend",
	}
}

func TestParsePermissionPrompt_BashDecidable(t *testing.T) {
	p := ParsePermissionPrompt(bashPromptRows("No"))
	if p == nil || p.Header != "Bash command" || p.ApproveOnce != 1 || p.Deny != 4 {
		t.Fatalf("got %+v", p)
	}
	bash := &sdk.PendingToolUse{ID: "tu1", Tool: "Bash", PatternDisplay: "shasum -a 256 notes/sample.txt"}
	dto := BuildTerminalPermission("s1", 7, bash, p)
	if !dto.Decidable || dto.Tool != "Bash" || dto.Detail != "shasum -a 256 notes/sample.txt" || len(dto.ID) != 24 {
		t.Fatalf("got %+v", dto)
	}
	if other := BuildTerminalPermission("s1", 7, &sdk.PendingToolUse{ID: "tu1", Tool: "Write"}, p); other.Decidable {
		t.Fatal("a Bash heading must not be decidable for a Write tool call")
	}
	if BuildTerminalPermission("s1", 7, &sdk.PendingToolUse{ID: "tu2", Tool: "Bash"}, p).ID != dto.ID {
		t.Fatal("the transcript catching up with the same prompt must not change its ID")
	}
	otherCommand := bashPromptRows("No")
	otherCommand[2] = "   shasum -a 512 notes/sample.txt"
	if BuildTerminalPermission("s1", 7, bash, ParsePermissionPrompt(otherCommand)).ID == dto.ID {
		t.Fatal("a different command on screen must be a different prompt ID")
	}
	// Claude Code can show the prompt before the tool call reaches the transcript.
	screenOnly := BuildTerminalPermission("s1", 7, nil, p)
	if !screenOnly.Decidable || screenOnly.Tool != "Bash" || screenOnly.Detail != "shasum -a 256 notes/sample.txt · Fingerprint the sample" || screenOnly.ID != dto.ID {
		t.Fatalf("a prompt on screen with no transcript tool call: %+v", screenOnly)
	}
	if BuildTerminalPermission("s1", 7, bash, ParsePermissionPrompt(bashPromptRows("No, and tell Claude what to do differently (esc)"))).ID == dto.ID {
		t.Fatal("different option labels must be a different prompt ID")
	}
}

func TestParsePermissionPrompt_EditWithSessionAllow(t *testing.T) {
	rows := []string{
		"╭────────────────────────────────╮",
		"│ Edit file                      │",
		"│ notes/sample.md                │",
		"│ - old line                     │",
		"│ + new line                     │",
		"│ Do you want to make this edit to sample.md? │",
		"│ ❯ 1. Yes                       │",
		"│   2. Yes, allow all edits during this session (shift+tab) │",
		"│   3. No, and tell Claude what to do differently (esc) │",
		"╰────────────────────────────────╯",
	}
	p := ParsePermissionPrompt(rows)
	if p == nil || p.Header != "Edit file" || p.ApproveOnce != 1 || p.Deny != 3 {
		t.Fatalf("got %+v", p)
	}
	if !BuildTerminalPermission("s", 1, &sdk.PendingToolUse{ID: "e", Tool: "Edit"}, p).Decidable {
		t.Fatal("an Edit prompt for an Edit call must be decidable")
	}
	if p.Detail != "sample.md" {
		t.Fatalf("an Edit prompt's detail is the file name, never the previewed lines, got %q", p.Detail)
	}
	write := ParsePermissionPrompt([]string{
		" Create file",
		" notes/created.txt",
		" private line one",
		" Do you want to create created.txt?",
		" ❯ 1. Yes",
		"   2. Yes, allow all edits during this session (shift+tab)",
		"   3. No",
		" Esc to cancel",
	})
	dto := BuildTerminalPermission("s", 1, nil, write)
	if dto == nil || !dto.Decidable || dto.Tool != "Write" || dto.Detail != "created.txt" {
		t.Fatalf("a Write prompt with no transcript tool call: %+v", dto)
	}
}

func TestParsePermissionPrompt_NotDecidable(t *testing.T) {
	unknownMiddle := bashPromptRows("No")
	unknownMiddle[9] = "   3. Maybe later"
	notExactYes := bashPromptRows("No")
	notExactYes[7] = " ❯ 1. Yes, proceed"
	unknownHeading := bashPromptRows("No")
	unknownHeading[0] = " Fetch"
	cases := map[string][]string{
		"an option that is neither yes nor no": unknownMiddle,
		"option 1 is not a plain Yes":          notExactYes,
		"a heading the dashboard does not map": unknownHeading,
	}
	for name, rows := range cases {
		p := ParsePermissionPrompt(rows)
		if p == nil {
			t.Fatalf("%s: still a permission prompt, just not decidable", name)
		}
		if BuildTerminalPermission("s", 1, &sdk.PendingToolUse{ID: "t", Tool: "Bash"}, p).Decidable {
			t.Errorf("%s: must fall back to the terminal", name)
		}
	}
}
