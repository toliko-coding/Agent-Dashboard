package agentbroadcast

import (
	"context"
	"testing"

	sdk "github.com/lx-wnk/agent-dashboard/sdk"
)

type noticeBridge struct{ atTerminal bool }

func (b noticeBridge) StateForSession(string) ([]sdk.PendingPermission, bool, string, bool) {
	return nil, b.atTerminal, "", false
}
func (noticeBridge) SweepExpired() {}

// Phase 4.1.1: the hook bridge adds evidence of a terminal prompt; it must not
// erase a prompt the merger read off the session's own screen.
func TestPermissionBridgeEnricher_KeepsScreenDetectedPrompt(t *testing.T) {
	agents := []sdk.Agent{
		{SessionID: "screen", AwaitingTerminalPermission: true},
		{SessionID: "quiet"},
	}
	NewPermissionBridgeEnricher(noticeBridge{atTerminal: false})(context.Background(), agents)
	if !agents[0].AwaitingTerminalPermission {
		t.Fatal("a screen-detected prompt was cleared by the bridge")
	}
	if agents[1].AwaitingTerminalPermission {
		t.Fatal("no evidence must stay no evidence")
	}
	NewPermissionBridgeEnricher(noticeBridge{atTerminal: true})(context.Background(), agents[1:])
	if !agents[1].AwaitingTerminalPermission {
		t.Fatal("the bridge's own notice must still set the flag")
	}
}
