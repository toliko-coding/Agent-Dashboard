package askq

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"slices"
	"strings"

	"github.com/lx-wnk/agent-dashboard/sdk"
)

// PermissionOption is one numbered choice of a tool permission prompt.
type PermissionOption struct {
	Num   int
	Label string
}

// PermissionPrompt is Claude Code's tool permission prompt as read off a
// screen, with enough structure to answer it safely. Server-side only: an
// option label can repeat the command or path the prompt is about.
type PermissionPrompt struct {
	// Header is the tool heading above the question ("Bash command", "Edit
	// file", "Create file"), empty when none is recognised.
	Header   string
	Question string
	Options  []PermissionOption
	// ApproveOnce is the number of the plain "Yes" option (one-time approval),
	// 0 when the prompt does not have exactly that shape.
	ApproveOnce int
	// Deny is the number of the trailing "No…" option, 0 when absent.
	Deny int
	// Detail is what the prompt is about, read from the screen: the command for
	// Bash, the file name for Write and Edit. Never a file's contents: a Write or
	// Edit prompt previews them, and they can be private.
	Detail string
}

// permissionDetailMaxRunes bounds the screen-read detail.
const permissionDetailMaxRunes = 300

// permissionFilePrefixes are the Write/Edit questions whose remainder names the file.
var permissionFilePrefixes = []string{
	"do you want to create ",
	"do you want to make this edit to ",
	"do you want to overwrite ",
	"do you want to write to ",
}

// permissionHeaderTools maps a recognised prompt heading to the tools it can
// be about. A heading not listed here makes the prompt terminal-only.
var permissionHeaderTools = map[string][]string{
	"bash command":   {"Bash"},
	"edit file":      {"Edit", "MultiEdit"},
	"create file":    {"Write"},
	"write file":     {"Write"},
	"overwrite file": {"Write"},
}

const permissionHeaderMaxRowsAbove = 40

// ParsePermissionPrompt reports Claude Code's own tool permission prompt:
//
//	Bash command
//	  <command>
//	Do you want to proceed?
//	❯ 1. Yes
//	  2. Yes, and don't ask again for …
//	  3. No
//	Esc to cancel · Tab to amend
//
// Gate: the last numbered block is 1..N with option 1 starting "Yes" and the
// last option starting "No"; a "Do you want to …" line sits above it (Bash
// "proceed?", Edit "make this edit to …?", Write "create …?"); no
// AskUserQuestion meta-row is on screen; and nothing but the "Esc to …" footer
// follows the options, so an answered prompt still in scrollback does not count.
func ParsePermissionPrompt(rows []string) *PermissionPrompt {
	contentLines := parseRows(rows)
	numbered := numberedEntries(contentLines)
	if len(numbered) < 2 {
		return nil
	}
	for _, e := range numbered {
		if metaLabelMatches(e.row.label, typeSomethingLabel) || metaLabelMatches(e.row.label, chatAboutLabel) {
			return nil
		}
	}

	end := len(numbered) - 1
	start := end
	for start > 0 {
		prev, cur := numbered[start-1], numbered[start]
		if prev.row.num != cur.row.num-1 || cur.idx-prev.idx > permissionOptionMaxGap {
			break
		}
		start--
	}
	first, last := numbered[start], numbered[end]
	if first.row.num != 1 || end-start < 1 {
		return nil
	}
	if !strings.HasPrefix(normalizeLabel(first.row.label), "yes") || !strings.HasPrefix(normalizeLabel(last.row.label), "no") {
		return nil
	}

	for _, l := range contentLines[last.idx+1:] {
		if !strings.HasPrefix(strings.ToLower(l.text), permissionFooterPrefix) {
			return nil
		}
	}

	questionIdx := -1
	for i := first.idx - 1; i >= 0 && i >= first.idx-4; i-- {
		if strings.HasPrefix(strings.ToLower(contentLines[i].text), permissionQuestionPrefix) {
			questionIdx = i
			break
		}
	}
	if questionIdx == -1 {
		return nil
	}

	p := &PermissionPrompt{Question: contentLines[questionIdx].text}
	for _, e := range numbered[start : end+1] {
		p.Options = append(p.Options, PermissionOption{Num: e.row.num, Label: e.row.label})
	}
	// The heading is the nearest recognised one above the question, never past
	// an earlier numbered row (a previous prompt's options).
	headerIdx := -1
	for i := questionIdx - 1; i >= 0 && i >= questionIdx-permissionHeaderMaxRowsAbove; i-- {
		if contentLines[i].hasNum {
			break
		}
		if _, ok := permissionHeaderTools[strings.ToLower(contentLines[i].text)]; ok {
			p.Header = contentLines[i].text
			headerIdx = i
			break
		}
	}
	p.Detail = permissionDetail(contentLines, headerIdx, questionIdx, p)

	// Approve once is the plain "Yes" as option 1; deny is the trailing "No…".
	// Anything between them must be a broader yes ("don't ask again", "allow
	// all edits", "auto mode") — never sent — or the shape is unknown.
	if normalizeLabel(first.row.label) == "yes" {
		p.ApproveOnce = first.row.num
	}
	p.Deny = last.row.num
	for _, o := range p.Options[1 : len(p.Options)-1] {
		if !strings.HasPrefix(normalizeLabel(o.Label), "yes") {
			p.ApproveOnce, p.Deny = 0, 0
		}
	}
	return p
}

// permissionDetail reads what the prompt is about. Bash: the lines between the
// heading and the question, without Claude's own tips. Write/Edit: the file name
// the question names — the preview of the contents is deliberately skipped.
func permissionDetail(contentLines []parsedRow, headerIdx, questionIdx int, p *PermissionPrompt) string {
	tools := p.HeaderTools()
	if slices.Contains(tools, "Bash") && headerIdx >= 0 {
		var parts []string
		for _, l := range contentLines[headerIdx+1 : questionIdx] {
			low := strings.ToLower(l.text)
			if strings.HasPrefix(low, "tip:") || low == "below" || strings.Contains(low, "auto mode") || strings.HasPrefix(low, "this command requires approval") {
				continue
			}
			parts = append(parts, l.text)
		}
		return capRunes(strings.Join(parts, " · "), permissionDetailMaxRunes)
	}
	if len(tools) > 0 {
		low := strings.ToLower(p.Question)
		for _, prefix := range permissionFilePrefixes {
			if strings.HasPrefix(low, prefix) {
				return capRunes(strings.TrimSuffix(strings.TrimSpace(p.Question[len(prefix):]), "?"), permissionDetailMaxRunes)
			}
		}
	}
	return ""
}

func capRunes(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n]) + "…"
	}
	return s
}

// HeaderTools is the set of tools the prompt's heading can be about.
func (p *PermissionPrompt) HeaderTools() []string {
	return permissionHeaderTools[strings.ToLower(strings.TrimSpace(p.Header))]
}

// BuildTerminalPermission describes the prompt for the dashboard. The screen is
// the source of truth: Claude Code can show a permission prompt before the tool
// call reaches the transcript, so pending may be nil. When the transcript does
// have an open tool call it must be the tool the heading names, and its display
// detail is preferred; a different tool makes the prompt terminal-only.
//
// The ID binds the session, process and the exact prompt on screen (heading,
// question, what it is about, options), so a decision is refused once the
// prompt changes. It does not include the transcript's tool call, which can
// appear while the same prompt stays open.
func BuildTerminalPermission(sessionID string, pid int, pending *sdk.PendingToolUse, p *PermissionPrompt) *sdk.TerminalPermissionPrompt {
	if p == nil {
		return nil
	}
	h := sha256.New()
	fmt.Fprintf(h, "%s\x00%d\x00%s\x00%s\x00%s", sessionID, pid, p.Header, p.Question, p.Detail)
	for _, o := range p.Options {
		fmt.Fprintf(h, "\x00%d:%s", o.Num, o.Label)
	}

	tools := p.HeaderTools()
	tool, detail, matches := "", p.Detail, len(tools) > 0
	if len(tools) > 0 {
		tool = tools[0]
	}
	if pending != nil && pending.Tool != "AskUserQuestion" {
		if slices.Contains(tools, pending.Tool) {
			tool = pending.Tool
			if pending.PatternDisplay != "" {
				detail = pending.PatternDisplay
			}
		} else {
			matches = false
		}
	}
	return &sdk.TerminalPermissionPrompt{
		ID:        hex.EncodeToString(h.Sum(nil))[:24],
		Tool:      tool,
		Detail:    detail,
		Question:  p.Question,
		Decidable: p.ApproveOnce == 1 && p.Deny > 1 && matches,
	}
}
