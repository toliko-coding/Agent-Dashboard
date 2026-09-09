package hooks

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

/*
 * Clearing a terminal-prompt notice.
 *
 * The Notification hook fires when a prompt OPENS and never when it is
 * answered — measured, not assumed: three prompts on a real external session
 * produced three notifications and none on resolution. So the notice cannot
 * wait to be told; it watches the transcript call the prompt is about.
 *
 * What answering does write, in every case measured, is a tool_result for that
 * exact call: 0.4s after approving, 0.008s after rejecting, 0.058s after
 * answering an AskUserQuestion. That is the signal these tests pin.
 */

func newTestEnforcer(now *time.Time) *HookEnforcer {
	b := NewHookEnforcer(func() {})
	b.nowFn = func() time.Time { return *now }
	return b
}

func atTerminal(t *testing.T, b *HookEnforcer, sid string) bool {
	t.Helper()
	_, at, _, _ := b.StateForSession(sid)
	return at
}

func TestTerminalNotice_ClearsWhenTheBlockingCallIsResolved(t *testing.T) {
	now := time.Now()
	b := newTestEnforcer(&now)

	b.noteTerminalPrompt("s1")
	require.True(t, atTerminal(t, b, "s1"), "a notice must show immediately")

	// First tick sees the call the prompt is about.
	b.ReconcileTerminalNotice("s1", "toolu_A")
	require.True(t, atTerminal(t, b, "s1"), "still waiting on the same call")

	// Same call, still pending: nothing changes.
	b.ReconcileTerminalNotice("s1", "toolu_A")
	require.True(t, atTerminal(t, b, "s1"))

	// Answered: the transcript resolves that call, so nothing is pending.
	b.ReconcileTerminalNotice("s1", "")
	require.False(t, atTerminal(t, b, "s1"), "an answered prompt must clear promptly")
}

// Claude commonly issues the next tool_use immediately after a decision, so
// "some call is pending" would keep a stale notice alive indefinitely.
func TestTerminalNotice_ClearsWhenADifferentCallBecomesPending(t *testing.T) {
	now := time.Now()
	b := newTestEnforcer(&now)

	b.noteTerminalPrompt("s1")
	b.ReconcileTerminalNotice("s1", "toolu_A")
	require.True(t, atTerminal(t, b, "s1"))

	b.ReconcileTerminalNotice("s1", "toolu_B")
	require.False(t, atTerminal(t, b, "s1"), "a different pending call means the old prompt is gone")
}

// The notice arrives a few seconds after the tool_use is written (measured:
// 6.6s), so a tick that sees nothing pending yet must not be read as
// "already resolved".
func TestTerminalNotice_DoesNotClearBeforeItHasLatched(t *testing.T) {
	now := time.Now()
	b := newTestEnforcer(&now)

	b.noteTerminalPrompt("s1")
	b.ReconcileTerminalNotice("s1", "")
	b.ReconcileTerminalNotice("s1", "")
	require.True(t, atTerminal(t, b, "s1"), "an unlatched notice must survive until it sees a call")

	b.ReconcileTerminalNotice("s1", "toolu_A")
	require.True(t, atTerminal(t, b, "s1"))
	b.ReconcileTerminalNotice("s1", "")
	require.False(t, atTerminal(t, b, "s1"))
}

func TestTerminalNotice_ReconcileIsHarmlessWithoutANotice(t *testing.T) {
	now := time.Now()
	b := newTestEnforcer(&now)
	b.ReconcileTerminalNotice("s1", "toolu_A")
	b.ReconcileTerminalNotice("s1", "")
	require.False(t, atTerminal(t, b, "s1"))
}

// One session answering must not clear another's prompt.
func TestTerminalNotice_IsPerSession(t *testing.T) {
	now := time.Now()
	b := newTestEnforcer(&now)

	b.noteTerminalPrompt("s1")
	b.noteTerminalPrompt("s2")
	b.ReconcileTerminalNotice("s1", "toolu_A")
	b.ReconcileTerminalNotice("s2", "toolu_B")

	b.ReconcileTerminalNotice("s1", "")
	require.False(t, atTerminal(t, b, "s1"))
	require.True(t, atTerminal(t, b, "s2"), "another session's prompt is untouched")
}

// The TTL remains as a backstop for a notice that never latched, but it is no
// longer how a normal prompt clears.
func TestTerminalNotice_TTLStillExpiresAnUnlatchedNotice(t *testing.T) {
	now := time.Now()
	b := newTestEnforcer(&now)

	b.noteTerminalPrompt("s1")
	require.True(t, atTerminal(t, b, "s1"))

	now = now.Add(permissionNoticeTTL + time.Second)
	require.False(t, atTerminal(t, b, "s1"), "the backstop still applies")
	b.SweepExpired()
	require.False(t, atTerminal(t, b, "s1"))
}

// A resolved prompt clears in one tick, far inside the TTL — the behaviour the
// TTL alone could not give.
func TestTerminalNotice_ClearsLongBeforeTheTTL(t *testing.T) {
	now := time.Now()
	b := newTestEnforcer(&now)

	b.noteTerminalPrompt("s1")
	b.ReconcileTerminalNotice("s1", "toolu_A")
	now = now.Add(3 * time.Second)
	b.ReconcileTerminalNotice("s1", "")

	require.False(t, atTerminal(t, b, "s1"))
	require.Less(t, 3*time.Second, permissionNoticeTTL)
}

/*
 * The notification receiver is observe-only. These pin that it cannot be turned
 * into a decision: it answers 204 with no body, so there is nothing Claude Code
 * could read as an allow.
 */

func TestPermissionNotify_IgnoresANonPermissionNotificationType(t *testing.T) {
	now := time.Now()
	b := newTestEnforcer(&now)
	// Only "permission_prompt" records a notice; every other type is inert.
	b.noteTerminalPromptIfPermission("s1", "idle")
	require.False(t, atTerminal(t, b, "s1"))
	b.noteTerminalPromptIfPermission("s1", permissionPromptNotification)
	require.True(t, atTerminal(t, b, "s1"))
}

func TestPermissionNotify_IgnoresAnEmptySessionID(t *testing.T) {
	now := time.Now()
	b := newTestEnforcer(&now)
	b.noteTerminalPromptIfPermission("", permissionPromptNotification)
	require.False(t, atTerminal(t, b, ""))
}
