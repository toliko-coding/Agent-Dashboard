package managedagent

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/lx-wnk/agent-dashboard/server/internal/db/repo"
)

type memRepo struct {
	rows map[string]repo.ManagedAgentRow
}

func (m *memRepo) Upsert(_ context.Context, row repo.ManagedAgentRow) error {
	m.rows[row.SessionID] = row
	return nil
}

func (m *memRepo) List(context.Context) ([]repo.ManagedAgentRow, error) {
	out := make([]repo.ManagedAgentRow, 0, len(m.rows))
	for _, r := range m.rows {
		out = append(out, r)
	}
	return out, nil
}

func (m *memRepo) Delete(_ context.Context, id string) error {
	delete(m.rows, id)
	return nil
}

func newStore(t *testing.T) (*Store, *memRepo) {
	t.Helper()
	m := &memRepo{rows: map[string]repo.ManagedAgentRow{}}
	s := New(m)
	require.NoError(t, s.Load(context.Background()))
	return s, m
}

// F: ownership needs the session the dashboard launched AND the PID it launched.
func TestOwns_NeedsSessionAndPID(t *testing.T) {
	s, _ := newStore(t)
	require.NoError(t, s.Record(context.Background(), Record{SessionID: "sess-a", PID: 4242, Cwd: "/work"}))

	require.True(t, s.Owns(4242, "sess-a"))
	require.False(t, s.Owns(5151, "sess-a"), "the same session resumed from a terminal is a process the dashboard did not launch")
	require.False(t, s.Owns(4242, "sess-other"), "a reused PID belongs to another session")
	require.False(t, s.Owns(0, "sess-a"))
	require.False(t, s.Owns(4242, ""))
}

func TestRecord_RefusesIncompleteAndKeepsProvenanceOnResume(t *testing.T) {
	s, _ := newStore(t)
	ctx := context.Background()
	require.ErrorIs(t, s.Record(ctx, Record{SessionID: "", PID: 1}), ErrIncomplete)
	require.ErrorIs(t, s.Record(ctx, Record{SessionID: "x", PID: 0}), ErrIncomplete)

	require.NoError(t, s.Record(ctx, Record{SessionID: "sess-p", PID: 10, Cwd: "/root/Resume-Editor", WorkspaceCreated: true, AllowedFolder: "/root/Resume-Editor"}))
	// Resumed by the dashboard under a new PID: still the dashboard's workspace.
	require.NoError(t, s.Record(ctx, Record{SessionID: "sess-p", PID: 11, Cwd: "/root/Resume-Editor"}))
	got, ok := s.Get("sess-p")
	require.True(t, ok)
	require.Equal(t, 11, got.PID)
	require.True(t, got.WorkspaceCreated)
	require.Equal(t, "/root/Resume-Editor", got.AllowedFolder)
}

func TestLoad_SurvivesRestartAndForget(t *testing.T) {
	ctx := context.Background()
	s, m := newStore(t)
	require.NoError(t, s.Record(ctx, Record{SessionID: "sess-r", PID: 77, Cwd: "/w"}))

	restarted := New(m)
	require.False(t, restarted.Owns(77, "sess-r"), "nothing is known before Load")
	require.NoError(t, restarted.Load(ctx))
	require.True(t, restarted.Owns(77, "sess-r"))

	require.NoError(t, restarted.Forget(ctx, "sess-r"))
	require.False(t, restarted.Owns(77, "sess-r"))
	require.Empty(t, m.rows)
}

// J: a folder another owned agent runs in is still in use.
func TestOthersUsing(t *testing.T) {
	s, _ := newStore(t)
	ctx := context.Background()
	dir := t.TempDir()
	require.NoError(t, s.Record(ctx, Record{SessionID: "one", PID: 1, Cwd: dir, WorkspaceCreated: true, AllowedFolder: dir}))
	require.False(t, s.OthersUsing(dir, "one"), "the agent being deleted does not count")

	require.NoError(t, s.Record(ctx, Record{SessionID: "two", PID: 2, Cwd: dir + "/"}))
	require.True(t, s.OthersUsing(dir, "one"))
	require.False(t, s.OthersUsing(t.TempDir(), "one"), "a different folder, however named, is not in use")
}
