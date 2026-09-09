package agentbroadcast

import (
	"context"
	"time"

	sdk "github.com/lx-wnk/agent-dashboard/sdk"
	"github.com/lx-wnk/agent-dashboard/server/internal/merger"
)

// PermissionBridgeReader is the read side of the hook permission bridge.
type PermissionBridgeReader interface {
	StateForSession(sessionID string) (held []sdk.PendingPermission, atTerminal bool, terminalToolUseID string, armed bool)
	// SweepExpired drops armed marks and notices that have aged out. Expiry is
	// driven from this tick rather than from the read, so it does not depend on
	// someone happening to look at a session.
	SweepExpired()
	// ReconcileTerminalNotice clears a terminal-prompt notice once the session
	// has answered it. The notification hook fires when a prompt opens and
	// never when it closes, so the transcript is what reports the decision.
	ReconcileTerminalNotice(sessionID, currentToolUseID string, lastActivity time.Time)
}

// NewPermissionBridgeEnricher annotates each agent with the permission prompts
// the bridge knows about.
//
// Unlike the pipeline enricher next to it, this is positive evidence rather than
// inference: the request came from the session itself, through its PreToolUse
// hook, carrying the tool and the exact argument it is asking about. Nothing is
// reconstructed from the transcript, where a tool call blocked on approval and
// one merely still running leave the same trace.
//
// A nil reader returns a nil enricher, which merger.ChainEnrichers skips.
func NewPermissionBridgeEnricher(bridge PermissionBridgeReader) merger.Enricher {
	if bridge == nil {
		return nil
	}
	return func(_ context.Context, agents []sdk.Agent) {
		bridge.SweepExpired()
		for i := range agents {
			sid := agents[i].SessionID
			if sid == "" {
				continue
			}
			/*
			 * Reconcile before reading. The agent's own unresolved tool_use is
			 * the session reporting whether its prompt is still open: answering
			 * one writes a tool_result for that exact call within a second
			 * (measured: 0.4s approving, 0.008s rejecting). Doing this here is
			 * what keeps the notice from outliving the prompt — the hook itself
			 * only ever says a prompt OPENED.
			 */
			pending := ""
			if agents[i].PendingToolUse != nil {
				pending = agents[i].PendingToolUse.ID
			}
			// LastActivity is the fallback signal for the common case where the
			// pending call is not visible: the parser reads only a tail window,
			// so a tool_use that has scrolled out of it leaves PendingToolUse
			// nil while the call is genuinely still pending.
			lastActivity, _ := time.Parse(time.RFC3339, agents[i].LastActivity)
			bridge.ReconcileTerminalNotice(sid, pending, lastActivity)

			held, atTerminal, terminalToolUseID, armed := bridge.StateForSession(sid)
			// A held hook call goes in its own field, never into
			// PendingPermissions: that one carries pipeline stage-run rows,
			// which are database-backed and resolve through a different
			// endpoint. Sharing the slice let a hook UUID ride along in the
			// pipeline's bulk-resolve payload.
			agents[i].HeldPermissions = held
			agents[i].AwaitingTerminalPermission = atTerminal
			agents[i].TerminalPermissionToolUseID = terminalToolUseID
			agents[i].PermissionBridgeArmed = armed
		}
	}
}
