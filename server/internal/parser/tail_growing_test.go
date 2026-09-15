package parser

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestTailReadGrowing_GrowsUntilDoneAndStaysBounded(t *testing.T) {
	path := filepath.Join(t.TempDir(), "s.jsonl")
	body := "MARKER\n" + strings.Repeat("y", 100_000) + "\n"
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := TailReadGrowing(path, func(c string) bool { return strings.Contains(c, "MARKER") })
	if err != nil || !strings.Contains(got, "MARKER") {
		t.Fatalf("expected the window to grow to the marker, err=%v len=%d", err, len(got))
	}
	calls := 0
	got, err = TailReadGrowing(path, func(string) bool { calls++; return false })
	if err != nil || int64(len(got)) != int64(len(body)) {
		t.Fatalf("never-done must stop at the whole file, err=%v len=%d", err, len(got))
	}
	if calls > 3 {
		t.Fatalf("growth must double, not creep: %d checks for a 100 KB file", calls)
	}
}
