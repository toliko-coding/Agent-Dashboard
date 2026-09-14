package merger

import (
	"testing"

	"github.com/lx-wnk/agent-dashboard/sdk"
	"github.com/lx-wnk/agent-dashboard/server/internal/agentprofile"
)

type fakeProfiles map[string]agentprofile.Profile

func (f fakeProfiles) Lookup(id string) (agentprofile.Profile, bool) {
	p, ok := f[id]
	return p, ok
}

// 3N.1: a profile is attached by session id on every scan, so a rebuilt agent
// (a rescan, a restart) carries it again; nothing else about the agent changes.
func TestApplyProfiles_BySessionIDOnEveryScan(t *testing.T) {
	m := New()
	m.SetAgentProfiles(fakeProfiles{"sess-named": {DisplayName: "Resume Editor", Category: sdk.AgentCategoryDocument}})

	for range 2 {
		agents := []sdk.Agent{
			{SessionID: "sess-named", ProjectName: "scratch-folder", Title: "Tidy the CV layout"},
			{SessionID: "sess-plain", ProjectName: "WalletRadar_web", Title: "Build dashboard"},
		}
		m.applyProfiles(agents)

		if agents[0].DisplayName != "Resume Editor" || agents[0].Category != sdk.AgentCategoryDocument {
			t.Fatalf("named agent: got %q/%q", agents[0].DisplayName, agents[0].Category)
		}
		if agents[0].Title != "Tidy the CV layout" {
			t.Fatalf("the session title stays its own field, got %q", agents[0].Title)
		}
		// No profile: no name and no category — never the folder name.
		if agents[1].DisplayName != "" || agents[1].Category != "" {
			t.Fatalf("unnamed agent must not borrow an identity, got %q/%q", agents[1].DisplayName, agents[1].Category)
		}
	}
}

func TestApplyProfiles_NoStoreIsANoOp(t *testing.T) {
	agents := []sdk.Agent{{SessionID: "s"}}
	New().applyProfiles(agents)
	if agents[0].DisplayName != "" {
		t.Fatal("no store, no name")
	}
}
