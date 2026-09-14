package agentbroadcast

import (
	"encoding/json"
	"testing"

	sdk "github.com/lx-wnk/agent-dashboard/sdk"
)

// 3M.1: every frame carries the server-owned pending folder trust list, "[]" when none.
func TestMarshalFrame_CarriesPendingFolderTrust(t *testing.T) {
	var empty map[string]json.RawMessage
	data, err := MarshalFrame(nil, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &empty); err != nil {
		t.Fatal(err)
	}
	if string(empty["pendingFolderTrust"]) != "[]" {
		t.Fatalf("pendingFolderTrust = %s, want []", empty["pendingFolderTrust"])
	}

	data, err = MarshalFrame(nil, nil, []sdk.PendingFolderTrust{{PID: 7, Path: "/tmp/x", Since: "2026-09-14T10:00:00Z"}})
	if err != nil {
		t.Fatal(err)
	}
	var frame struct {
		PendingFolderTrust []sdk.PendingFolderTrust `json:"pendingFolderTrust"`
	}
	if err := json.Unmarshal(data, &frame); err != nil {
		t.Fatal(err)
	}
	if len(frame.PendingFolderTrust) != 1 || frame.PendingFolderTrust[0].PID != 7 || frame.PendingFolderTrust[0].Path != "/tmp/x" {
		t.Fatalf("got %+v", frame.PendingFolderTrust)
	}
}
