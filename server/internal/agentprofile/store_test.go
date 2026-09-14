package agentprofile

import (
	"context"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/lx-wnk/agent-dashboard/server/internal/db/repo"
)

type memRepo struct {
	rows  map[string]repo.AgentProfileRow
	calls int
}

func (m *memRepo) Upsert(_ context.Context, row repo.AgentProfileRow) error {
	m.calls++
	m.rows[row.SessionID] = row
	return nil
}

func (m *memRepo) Delete(_ context.Context, id string) error {
	delete(m.rows, id)
	return nil
}

func (m *memRepo) List(context.Context) ([]repo.AgentProfileRow, error) {
	out := make([]repo.AgentProfileRow, 0, len(m.rows))
	for _, r := range m.rows {
		out = append(out, r)
	}
	return out, nil
}

func TestNormalize(t *testing.T) {
	p, err := Normalize("  Resume\n\tEditor  ", "document")
	require.NoError(t, err)
	require.Equal(t, Profile{DisplayName: "Resume Editor", Category: "document"}, p)

	p, err = Normalize("", "")
	require.NoError(t, err)
	require.True(t, p.Empty())

	_, err = Normalize("x", "wallpaper")
	require.ErrorContains(t, err, "unknown agent category")

	_, err = Normalize(strings.Repeat("a", MaxNameRunes+1), "")
	require.ErrorContains(t, err, "at most 60")
}

func TestStore_SaveLookupAndRescan(t *testing.T) {
	ctx := context.Background()
	m := &memRepo{rows: map[string]repo.AgentProfileRow{}}
	s := New(m)
	require.NoError(t, s.Load(ctx))

	require.NoError(t, s.Save(ctx, "sess-a", Profile{DisplayName: "Portfolio", Category: "web"}))
	for range 3 { // every scan tick reads the cache, never the database
		got, ok := s.Lookup("sess-a")
		require.True(t, ok)
		require.Equal(t, "Portfolio", got.DisplayName)
	}
	require.Equal(t, 1, m.calls)

	_, ok := s.Lookup("sess-unknown")
	require.False(t, ok)
	_, ok = s.Lookup("")
	require.False(t, ok)
}

func TestStore_EmptyProfileNeverErasesAndNeedsNoSession(t *testing.T) {
	ctx := context.Background()
	m := &memRepo{rows: map[string]repo.AgentProfileRow{}}
	s := New(m)
	require.NoError(t, s.Save(ctx, "sess-a", Profile{DisplayName: "Research"}))
	require.NoError(t, s.Save(ctx, "sess-a", Profile{}))
	got, _ := s.Lookup("sess-a")
	require.Equal(t, "Research", got.DisplayName)

	require.ErrorIs(t, s.Save(ctx, "", Profile{DisplayName: "Orphan"}), ErrNoSession)
}

func TestStore_DeleteForgetsTheProfile(t *testing.T) {
	ctx := context.Background()
	m := &memRepo{rows: map[string]repo.AgentProfileRow{}}
	s := New(m)
	require.NoError(t, s.Save(ctx, "sess-a", Profile{DisplayName: "Portfolio"}))
	require.NoError(t, s.Delete(ctx, "sess-a"))
	_, ok := s.Lookup("sess-a")
	require.False(t, ok)
	require.Empty(t, m.rows)
	require.NoError(t, s.Delete(ctx, "sess-never-saved"))
	require.ErrorIs(t, s.Delete(ctx, ""), ErrNoSession)
}
