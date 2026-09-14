package repo_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/lx-wnk/agent-dashboard/server/internal/agentprofile"
	"github.com/lx-wnk/agent-dashboard/server/internal/db/repo"
)

func TestAgentProfileRepo_UpsertCreatesThenReplaces(t *testing.T) {
	ctx := context.Background()
	r := repo.NewAgentProfileRepo(openTestDB(t))

	require.NoError(t, r.Upsert(ctx, repo.AgentProfileRow{SessionID: "sess-1", DisplayName: "Resume Editor", Category: "document"}))
	require.NoError(t, r.Upsert(ctx, repo.AgentProfileRow{SessionID: "sess-1", DisplayName: "CV Editor", Category: "document"}))
	require.NoError(t, r.Upsert(ctx, repo.AgentProfileRow{SessionID: "sess-2", DisplayName: "", Category: "research"}))

	rows, err := r.List(ctx)
	require.NoError(t, err)
	require.ElementsMatch(t, []repo.AgentProfileRow{
		{SessionID: "sess-1", DisplayName: "CV Editor", Category: "document"},
		{SessionID: "sess-2", DisplayName: "", Category: "research"},
	}, rows)
}

// A profile saved by one server run is there for the next: a new store over the
// same database — what a dashboard restart builds — finds it.
func TestAgentProfileStore_SurvivesRestart(t *testing.T) {
	ctx := context.Background()
	client := openTestDB(t)

	first := agentprofile.New(repo.NewAgentProfileRepo(client))
	require.NoError(t, first.Load(ctx))
	require.NoError(t, first.Save(ctx, "sess-restart", agentprofile.Profile{DisplayName: "Resume Editor", Category: "document"}))

	second := agentprofile.New(repo.NewAgentProfileRepo(client))
	_, before := second.Lookup("sess-restart")
	require.False(t, before, "nothing is known before Load")
	require.NoError(t, second.Load(ctx))
	got, ok := second.Lookup("sess-restart")
	require.True(t, ok)
	require.Equal(t, agentprofile.Profile{DisplayName: "Resume Editor", Category: "document"}, got)
}
