package askq

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

/*
 * perm-bash.txt, perm-fetch.txt and perm-resolved.txt are real screens captured
 * from a live Claude Code session through the pty broker's own renderer, not
 * hand-written approximations. The two dialogs differ in prompt wording and in
 * every option label, which is why the detector matches shape rather than text.
 */

func TestDetectPermissionPrompt_BashDialog(t *testing.T) {
	p := DetectPermissionPrompt(loadFixture(t, "perm-bash.txt"))
	require.NotNil(t, p)
	require.Equal(t, "Do you want to proceed?", p.Question)
	require.Len(t, p.Options, 3)
	require.Equal(t, "Yes", p.Options[0].Label)
	require.Equal(t, "No", p.Options[2].Label)
	require.Equal(t, 1, p.Options[0].Index)
}

// Different tool, different wording, different labels — same shape.
func TestDetectPermissionPrompt_FetchDialog(t *testing.T) {
	p := DetectPermissionPrompt(loadFixture(t, "perm-fetch.txt"))
	require.NotNil(t, p)
	require.Equal(t, "Do you want to allow Claude to fetch this content?", p.Question)
	require.Len(t, p.Options, 3)
	require.True(t, strings.HasPrefix(p.Options[2].Label, "No,"),
		"the refusing option carries a tail in this variant: %q", p.Options[2].Label)
}

// The signal must vanish the moment the dialog does — this fixture is the same
// session one keystroke later.
func TestDetectPermissionPrompt_ResolvedScreenIsNotADialog(t *testing.T) {
	require.Nil(t, DetectPermissionPrompt(loadFixture(t, "perm-resolved.txt")))
}

func rows(lines ...string) []string { return lines }

// The two-option form, for tools that offer no "don't ask again".
func TestDetectPermissionPrompt_TwoOptionForm(t *testing.T) {
	p := DetectPermissionPrompt(rows(
		" Bash command",
		"",
		" Do you want to proceed?",
		" ❯ 1. Yes",
		"   2. No",
	))
	require.NotNil(t, p)
	require.Len(t, p.Options, 2)
}

// A project-scoped allow adds a fourth choice.
func TestDetectPermissionPrompt_FourOptionProjectScopedForm(t *testing.T) {
	p := DetectPermissionPrompt(rows(
		" Edit file",
		"",
		" Do you want to make this edit to config.ts?",
		" ❯ 1. Yes",
		"   2. Yes, allow all edits during this session",
		"   3. Yes, and don't ask again for this project",
		"   4. No, and tell Claude what to do differently (esc)",
	))
	require.NotNil(t, p)
	require.Len(t, p.Options, 4)
}

// A wrapped long command pushes the dialog body over several rows without
// touching the option block.
func TestDetectPermissionPrompt_WrappedCommandBody(t *testing.T) {
	p := DetectPermissionPrompt(rows(
		" Bash command",
		"",
		"   curl -s https://example.com/a/very/long/path/that/wraps/across/lines/and",
		"   /keeps/going/for/quite/a/while/before/it/ends",
		"   Fetch a long URL",
		"",
		" This command requires approval",
		"",
		" Do you want to proceed?",
		" ❯ 1. Yes",
		"   2. No",
		"",
		" Esc to cancel · Tab to amend",
	))
	require.NotNil(t, p)
	require.Equal(t, "Do you want to proceed?", p.Question)
}

// "Tab to amend" is optional and must not be required.
func TestDetectPermissionPrompt_WithoutTabToAmend(t *testing.T) {
	p := DetectPermissionPrompt(rows(
		" Do you want to proceed?",
		" ❯ 1. Yes",
		"   2. No",
	))
	require.NotNil(t, p)
}

// The false positive the brief names explicitly: assistant prose that merely
// talks about permissions. No option block, so no dialog.
func TestDetectPermissionPrompt_ProseIsNotADialog(t *testing.T) {
	require.Nil(t, DetectPermissionPrompt(rows(
		"⏺ When you run that, Claude will ask \"Allow this bash command?\" and you",
		"  should answer Yes.",
		"",
		"  Do you want to proceed?",
	)))
}

// Prose plus an unrelated numbered list is the harder version of the same case:
// the list is not Yes/No, so it is still not a dialog.
func TestDetectPermissionPrompt_ProseWithNumberedListIsNotADialog(t *testing.T) {
	require.Nil(t, DetectPermissionPrompt(rows(
		" Do you want to proceed?",
		" 1. First install the dependencies",
		" 2. Then run the migration",
		" 3. Finally restart the server",
	)))
}

// A tool that is actually executing renders no dialog at all.
func TestDetectPermissionPrompt_RunningToolIsNotADialog(t *testing.T) {
	require.Nil(t, DetectPermissionPrompt(rows(
		"⏺ Bash(curl -s https://example.com)",
		"  ⎿  Running…",
		"",
		"✻ Brewed for 3s",
	)))
}

// An idle prompt is not a dialog.
func TestDetectPermissionPrompt_IdlePromptIsNotADialog(t *testing.T) {
	require.Nil(t, DetectPermissionPrompt(rows(
		"❯ ",
		"  ⏸ manual mode on · ? for shortcuts",
	)))
}

// The question must be adjacent to the option block: a Yes/No list far below an
// unrelated question is not this dialog.
func TestDetectPermissionPrompt_QuestionMustBeAdjacentToOptions(t *testing.T) {
	require.Nil(t, DetectPermissionPrompt(rows(
		" Do you want to proceed?",
		" Some unrelated output line in between",
		" ❯ 1. Yes",
		"   2. No",
	)))
}

// Options must start at 1 and run consecutively.
func TestDetectPermissionPrompt_NonContiguousOptionsRejected(t *testing.T) {
	require.Nil(t, DetectPermissionPrompt(rows(
		" Do you want to proceed?",
		" ❯ 2. Yes",
		"   3. No",
	)))
}

// A block that is not Yes-first / No-last is some other list.
func TestDetectPermissionPrompt_NonYesNoBlockRejected(t *testing.T) {
	require.Nil(t, DetectPermissionPrompt(rows(
		" Do you want to proceed?",
		" ❯ 1. Maybe",
		"   2. Later",
	)))
}

// Too many options is not this dialog.
func TestDetectPermissionPrompt_TooManyOptionsRejected(t *testing.T) {
	require.Nil(t, DetectPermissionPrompt(rows(
		" Do you want to proceed?",
		" ❯ 1. Yes",
		"   2. Yes, always",
		"   3. Yes, for this project",
		"   4. Yes, for this session",
		"   5. No",
	)))
}

// --- coexistence with the AskUserQuestion detectors ---

// An AskUserQuestion modal must not be reported as a permission request: the
// two need different controls.
func TestDetectPermissionPrompt_AskUserQuestionModalIsNotAPermission(t *testing.T) {
	for _, f := range []string{"askq-single.txt", "askq-multi.txt", "askq-v2_1_205.txt"} {
		t.Run(f, func(t *testing.T) {
			require.Nil(t, DetectPermissionPrompt(loadFixture(t, f)))
		})
	}
}

func TestDetectPermissionPrompt_ConfirmScreenIsNotAPermission(t *testing.T) {
	require.Nil(t, DetectPermissionPrompt(loadFixture(t, "askq-confirm.txt")))
}

// AskUserQuestion detection must be unchanged by the new detector.
func TestDetectScreen_QuestionStillWins(t *testing.T) {
	s := DetectScreen(loadFixture(t, "askq-single.txt"))
	require.NotNil(t, s)
	require.NotNil(t, s.Question)
	require.Nil(t, s.Permission)
}

func TestDetectScreen_ConfirmStillWins(t *testing.T) {
	s := DetectScreen(loadFixture(t, "askq-confirm.txt"))
	require.NotNil(t, s)
	require.NotNil(t, s.Confirm)
	require.Nil(t, s.Permission)
}

func TestDetectScreen_ReportsPermission(t *testing.T) {
	s := DetectScreen(loadFixture(t, "perm-bash.txt"))
	require.NotNil(t, s)
	require.NotNil(t, s.Permission)
	require.Nil(t, s.Question)
	require.Nil(t, s.Confirm)
}

func TestDetectScreen_NothingOpen(t *testing.T) {
	require.Nil(t, DetectScreen(loadFixture(t, "perm-resolved.txt")))
}
