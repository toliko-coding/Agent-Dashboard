package merger_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/lx-wnk/agent-dashboard/sdk"
	"github.com/lx-wnk/agent-dashboard/server/internal/merger"
	"github.com/lx-wnk/agent-dashboard/server/internal/scanner"
)

/*
 * 3M.1 D + I: pending folder trust is derived by the server from its own scan —
 * a Claude process with no session that shows Claude Code's trust question —
 * and disappears as soon as the process or the question is gone.
 */
func TestPendingFolderTrust_DerivedFromTheScan(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("CLAUDE_CONFIG_DIR", "")

	procs := []scanner.ProcessInfo{
		{PID: 5101, CWD: "/work/untrusted", Uptime: 3, Provider: sdk.ProviderClaude},
		{PID: 5102, CWD: "/work/other", Uptime: 3, Provider: sdk.ProviderClaude},
		{PID: 5103, CWD: "/work/daemon", Uptime: 3, Provider: sdk.ProviderClaude, InternalProcess: true},
	}
	screens := map[int]*sdk.PendingScreen{
		5101: {FolderTrust: &sdk.DetectedFolderTrust{Path: "/work/untrusted", Selected: "exit"}},
		5103: {FolderTrust: &sdk.DetectedFolderTrust{Path: "/work/daemon", Selected: "exit"}},
	}
	probed := map[int]int{}
	m := merger.New(
		merger.WithScanFn(func(context.Context) ([]scanner.ProcessInfo, error) { return procs, nil }),
		merger.WithScreenProbe(func(pid int) *sdk.PendingScreen { probed[pid]++; return screens[pid] }),
	)

	agents, err := m.GetAgents(context.Background(), merger.GetAgentsOpts{})
	require.NoError(t, err)
	assert.Empty(t, agents, "no session yet, so not an agent")

	pending := m.PendingFolderTrust()
	require.Len(t, pending, 1)
	assert.Equal(t, 5101, pending[0].PID)
	assert.Equal(t, "/work/untrusted", pending[0].Path)
	assert.NotEmpty(t, pending[0].Since)
	cwd, ok := m.PendingFolderTrustCwd(5101)
	assert.True(t, ok)
	assert.Equal(t, "/work/untrusted", cwd)
	assert.Zero(t, probed[5103], "Claude's internal daemons are never probed")

	firstSince := pending[0].Since
	_, err = m.GetAgents(context.Background(), merger.GetAgentsOpts{})
	require.NoError(t, err)
	assert.Equal(t, firstSince, m.PendingFolderTrust()[0].Since, "the wait keeps its first-seen time across scans")

	// The question is answered: the screen is gone.
	screens[5101] = nil
	_, err = m.GetAgents(context.Background(), merger.GetAgentsOpts{})
	require.NoError(t, err)
	assert.Empty(t, m.PendingFolderTrust())

	// The process exits while waiting.
	screens[5101] = &sdk.PendingScreen{FolderTrust: &sdk.DetectedFolderTrust{Path: "/work/untrusted", Selected: "exit"}}
	_, _ = m.GetAgents(context.Background(), merger.GetAgentsOpts{})
	require.Len(t, m.PendingFolderTrust(), 1)
	procs = procs[1:]
	_, err = m.GetAgents(context.Background(), merger.GetAgentsOpts{})
	require.NoError(t, err)
	assert.Empty(t, m.PendingFolderTrust())
	_, ok = m.PendingFolderTrustCwd(5101)
	assert.False(t, ok)
}

func TestPendingFolderTrust_NoProbeMeansNothingPending(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	m := merger.New(merger.WithScanFn(func(context.Context) ([]scanner.ProcessInfo, error) {
		return []scanner.ProcessInfo{{PID: 1, CWD: "/w", Provider: sdk.ProviderClaude}}, nil
	}))
	_, err := m.GetAgents(context.Background(), merger.GetAgentsOpts{})
	require.NoError(t, err)
	assert.Empty(t, m.PendingFolderTrust())
}
