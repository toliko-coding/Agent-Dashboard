package parser

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/lx-wnk/agent-dashboard/sdk"
	"github.com/stretchr/testify/require"
)

// Session titles (3N): Claude Code writes "ai-title" and "custom-title" records
// anywhere in the log, each "last wins", and shows customTitle ?? aiTitle.

const titleUserLine = `{"type":"user","timestamp":"2026-09-14T10:00:00.000Z","message":{"role":"user","content":"do the thing"}}`

func titleLine(kind, value string) string {
	if kind == "custom-title" {
		return `{"type":"custom-title","customTitle":"` + value + `","sessionId":"s"}`
	}
	return `{"type":"ai-title","aiTitle":"` + value + `","sessionId":"s"}`
}

func writeTitleLog(t *testing.T, lines ...string) string {
	t.Helper()
	resetTokenOffsetCache(t)
	path := filepath.Join(t.TempDir(), "00000000-0000-0000-0000-00000000cafe.jsonl")
	require.NoError(t, os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"), 0o600))
	return path
}

func TestSessionTitle_GeneratedTitleFarBeforeTheTail(t *testing.T) {
	filler := `{"type":"attachment","attachment":{"content":"` + strings.Repeat("x", 200_000) + `"}}`
	path := writeTitleLog(t, titleUserLine, titleLine("ai-title", "Fix login redirect"), filler, titleUserLine)

	data, err := ParseSessionFile(path)
	require.NoError(t, err)
	require.Equal(t, "Fix login redirect", data.Title)
	require.Equal(t, sdk.AgentTitleAI, data.TitleSource)
}

func TestSessionTitle_RenameWinsOverALaterGeneratedTitle(t *testing.T) {
	path := writeTitleLog(t, titleLine("ai-title", "First guess"), titleLine("custom-title", "Billing export"), titleUserLine, titleLine("ai-title", "Second guess"))
	data, err := ParseSessionFile(path)
	require.NoError(t, err)
	require.Equal(t, "Billing export", data.Title)
	require.Equal(t, sdk.AgentTitleCustom, data.TitleSource)
}

func TestSessionTitle_LastGeneratedTitleWins(t *testing.T) {
	path := writeTitleLog(t, titleLine("ai-title", "Old"), titleUserLine, titleLine("ai-title", "New"))
	data, err := ParseSessionFile(path)
	require.NoError(t, err)
	require.Equal(t, "New", data.Title)
}

func TestSessionTitle_AppendedTitleIsPickedUpIncrementally(t *testing.T) {
	path := writeTitleLog(t, titleUserLine, titleLine("ai-title", "Before"))
	first, err := ParseSessionFile(path)
	require.NoError(t, err)
	require.Equal(t, "Before", first.Title)

	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o600)
	require.NoError(t, err)
	_, err = f.WriteString(titleLine("custom-title", "Renamed") + "\n")
	require.NoError(t, err)
	require.NoError(t, f.Close())

	second, err := ParseSessionFile(path)
	require.NoError(t, err)
	require.Equal(t, "Renamed", second.Title)
	require.Equal(t, sdk.AgentTitleCustom, second.TitleSource)
}

func TestSessionTitle_NoTitleRecord(t *testing.T) {
	data, err := ParseSessionFile(writeTitleLog(t, titleUserLine))
	require.NoError(t, err)
	require.Empty(t, data.Title)
	require.Empty(t, data.TitleSource)
}

func TestSessionTitle_IsANameNotText(t *testing.T) {
	title, source := sessionTitle("  Multi\n\tline  name  ", "")
	require.Equal(t, "Multi line name", title)
	require.Equal(t, sdk.AgentTitleCustom, source)

	long, _ := sessionTitle("", strings.Repeat("word ", 40))
	require.LessOrEqual(t, len([]rune(long)), maxTitleRunes)
	require.True(t, strings.HasSuffix(long, "…"))

	blank, blankSource := sessionTitle("   ", "\n")
	require.Empty(t, blank)
	require.Empty(t, blankSource)
}
