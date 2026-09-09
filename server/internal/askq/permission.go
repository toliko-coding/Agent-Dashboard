package askq

import (
	"strings"

	sdk "github.com/lx-wnk/agent-dashboard/sdk"
)

/*
 * Claude Code's permission dialog, detected from the same rendered rows the
 * AskUserQuestion detectors already consume.
 *
 * Why this exists: a tool blocked on approval and a tool merely still running
 * leave the identical trace in the transcript — an unresolved tool_use — so the
 * dashboard could only infer "waiting" from silence, which took 180 seconds and
 * then reported it as "No activity". The screen is the one place the difference
 * is stated outright, and the broker already renders it.
 *
 * Two real dialogs, captured from a live session:
 *
 *   Bash command                        Fetch
 *   ...                                 ...
 *   This command requires approval      Claude wants to fetch content from example.com
 *
 *   Do you want to proceed?             Do you want to allow Claude to fetch this content?
 *   ❯ 1. Yes                            ❯ 1. Yes
 *     2. Yes, and don't ask again…        2. Yes, and don't ask again for example.com
 *     3. No                               3. No, and tell Claude what to do differently (esc)
 *
 *   Esc to cancel · Tab to amend
 *
 * The wording of the prompt, the option labels and the option count all vary,
 * so none of them is matched whole. What holds across both — and is what the
 * detector requires — is the SHAPE: a "Do you want …?" line immediately above a
 * contiguous 1..n option block whose first option is Yes and whose last is No.
 */

const (
	// minPermissionOptions covers the plain two-option form (Yes / No); three
	// is the common case, and a fourth appears where a scope-widening choice is
	// offered alongside "don't ask again".
	minPermissionOptions = 2
	maxPermissionOptions = 4
)

// permissionPromptPrefix anchors the question line. Every observed variant —
// "Do you want to proceed?", "Do you want to allow Claude to fetch this
// content?" — starts this way, while the remainder is tool-specific.
const permissionPromptPrefix = "do you want"

// DetectPermissionPrompt reports the permission dialog currently on screen, or
// nil when there is none.
//
// Prose cannot trigger it: an assistant message containing the words "Allow
// this bash command?" produces no numbered Yes/No option block, and the block
// is required. Nor can a tool that is actually executing — it renders no dialog
// at all, which is exactly the distinction the transcript could not make.
func DetectPermissionPrompt(rows []string) *sdk.DetectedPermission {
	contentLines := parseRows(rows)
	numbered := numberedEntries(contentLines)
	if len(numbered) < minPermissionOptions {
		return nil
	}

	// An AskUserQuestion modal also renders numbered options. Its meta-rows are
	// what tell the two apart, and it has its own detector — yielding here
	// keeps a question from being reported as a permission request, which would
	// offer the wrong control.
	for _, e := range numbered {
		if metaLabelMatches(e.row.label, typeSomethingLabel) || metaLabelMatches(e.row.label, chatAboutLabel) {
			return nil
		}
	}

	block := trailingOptionBlock(numbered)
	if block == nil {
		return nil
	}
	if !isYesLabel(block[0].row.label) || !isNoLabel(block[len(block)-1].row.label) {
		return nil
	}

	prompt, ok := promptAbove(contentLines, block[0].idx)
	if !ok {
		return nil
	}

	options := make([]sdk.DetectedOption, 0, len(block))
	for _, e := range block {
		options = append(options, sdk.DetectedOption{Index: e.row.num, Label: e.row.label})
	}

	return &sdk.DetectedPermission{Question: prompt, Options: options}
}

// trailingOptionBlock returns the LAST run of numbered rows that is contiguous
// on screen and numbered 1..n.
//
// The last run rather than the whole screen: unrelated numbered output can sit
// in the scrollback above the dialog, and a trailing line — "Esc to cancel ·
// Tab to amend" — may follow it, so neither end can be pinned to the edge of
// the content.
func trailingOptionBlock(numbered []numberedEntry) []numberedEntry {
	end := len(numbered) - 1
	start := end
	for start > 0 {
		prev := numbered[start-1]
		cur := numbered[start]
		// Adjacent on screen and consecutively numbered.
		if cur.idx != prev.idx+1 || cur.row.num != prev.row.num+1 {
			break
		}
		start--
	}
	block := numbered[start : end+1]
	if len(block) < minPermissionOptions || len(block) > maxPermissionOptions {
		return nil
	}
	if block[0].row.num != 1 {
		return nil
	}
	return block
}

// promptAbove finds the "Do you want …?" line above the option block.
//
// It scans upward past blank rows only: requiring the question to be the
// nearest content line keeps an unrelated sentence further up the transcript
// from lending its wording to an unrelated numbered list.
func promptAbove(lines []parsedRow, blockStart int) (string, bool) {
	for i := blockStart - 1; i >= 0; i-- {
		text := strings.TrimSpace(lines[i].text)
		if text == "" {
			continue
		}
		lowered := strings.ToLower(text)
		if strings.HasPrefix(lowered, permissionPromptPrefix) && strings.HasSuffix(text, "?") {
			return text, true
		}
		// The first non-blank line above the block is not the prompt: stop
		// rather than searching the whole screen.
		return "", false
	}
	return "", false
}

// isYesLabel matches the affirmative option. "Yes", "Yes, and don't ask again
// for: curl *" and "Yes, allow all edits this session" all begin the same way.
func isYesLabel(label string) bool {
	return strings.HasPrefix(normalizeLabel(label), "yes")
}

// isNoLabel matches the refusing option, which carries a tail in some dialogs
// ("No, and tell Claude what to do differently (esc)").
func isNoLabel(label string) bool {
	return strings.HasPrefix(normalizeLabel(label), "no")
}
