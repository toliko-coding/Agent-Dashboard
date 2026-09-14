package merger

import (
	"testing"
	"time"

	"github.com/lx-wnk/agent-dashboard/sdk"
)

func TestFormatActivity(t *testing.T) {
	if got := formatActivity(time.Time{}); got != "" {
		t.Errorf("unknown activity must be empty, got %q", got)
	}
	plus3 := time.FixedZone("+03", 3*3600)
	got := formatActivity(time.Date(2026, 9, 14, 0, 0, 5, 0, plus3))
	if got != "2026-09-13T21:00:05Z" {
		t.Errorf("got %q, want UTC RFC 3339 with its zone", got)
	}
}

func TestCalculateStatus_UnknownActivityIsIdle(t *testing.T) {
	if got := CalculateStatus(time.Time{}); got != sdk.AgentStatusIdle {
		t.Errorf("got %s", got)
	}
	if got := CalculateStatus(time.Now().Add(-2 * time.Second)); got != sdk.AgentStatusActive {
		t.Errorf("a two-second-old activity is active, got %s", got)
	}
}
