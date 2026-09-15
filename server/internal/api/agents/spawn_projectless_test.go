package agents

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/lx-wnk/agent-dashboard/server/internal/services"
)

// 3N.2.1: a projectless workspace is created only inside the spawn request, and
// a spawn that fails leaves neither its allowed-folder entry nor an empty folder.

func projectlessSpawn(t *testing.T, body map[string]any) (*SpawnHandler, *folderSettings, string, *httptest.ResponseRecorder) {
	t.Helper()
	t.Setenv("HOME", t.TempDir())
	root, err := filepath.EvalSymlinks(t.TempDir())
	require.NoError(t, err)
	folders := &folderSettings{values: map[string]string{}}
	require.NoError(t, services.SetProjectlessRoot(context.Background(), folders, root))
	h := NewSpawnHandler(NewSpawnManager(5, 60000, 30, 60000, nil, nil))
	h.SetWorkingFolderSettings(folders)

	raw, err := json.Marshal(body)
	require.NoError(t, err)
	rr := httptest.NewRecorder()
	h.Spawn(rr, httptest.NewRequest(http.MethodPost, "/api/agents/spawn", bytes.NewReader(raw)))
	return h, folders, root, rr
}

func TestProjectlessSpawn_FailedStartRollsBackTheWorkspace(t *testing.T) {
	_, folders, root, rr := projectlessSpawn(t, map[string]any{
		"projectless":    true,
		"displayName":    "Rollback Check",
		"prompt":         "hello",
		"permissionMode": "not-a-mode", // fails after the workspace is created
		// Provenance is never taken from the client, and neither is the folder.
		"cwd":              "/etc",
		"workspaceCreated": true,
		"allowedFolder":    "/etc",
	})
	require.Equal(t, http.StatusBadRequest, rr.Code, rr.Body.String())
	require.Empty(t, services.WorkingFolders(folders), "the entry added for the workspace is removed again")
	_, err := os.Stat(filepath.Join(root, "Rollback-Check"))
	require.True(t, os.IsNotExist(err), "the still-empty folder is removed")
}

func TestProjectlessSpawn_NeedsANameAndAPromptBeforeCreatingAnything(t *testing.T) {
	for _, body := range []map[string]any{
		{"projectless": true, "prompt": "hello"},
		{"projectless": true, "displayName": "No Prompt"},
	} {
		_, folders, root, rr := projectlessSpawn(t, body)
		require.Equal(t, http.StatusBadRequest, rr.Code, rr.Body.String())
		require.Empty(t, services.WorkingFolders(folders))
		entries, err := os.ReadDir(root)
		require.NoError(t, err)
		require.Empty(t, entries)
	}
}

func TestProjectlessSpawn_NeverReusesAnExistingFolder(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	root, err := filepath.EvalSymlinks(t.TempDir())
	require.NoError(t, err)
	existing := filepath.Join(root, "Portfolio")
	require.NoError(t, os.Mkdir(existing, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(existing, "index.html"), []byte("mine"), 0o600))
	folders := &folderSettings{values: map[string]string{}}
	require.NoError(t, services.SetProjectlessRoot(context.Background(), folders, root))
	h := NewSpawnHandler(NewSpawnManager(5, 60000, 30, 60000, nil, nil))
	h.SetWorkingFolderSettings(folders)

	raw, _ := json.Marshal(map[string]any{"projectless": true, "displayName": "Portfolio", "prompt": "hello"})
	rr := httptest.NewRecorder()
	h.Spawn(rr, httptest.NewRequest(http.MethodPost, "/api/agents/spawn", bytes.NewReader(raw)))
	require.Equal(t, http.StatusConflict, rr.Code, rr.Body.String())
	require.Empty(t, services.WorkingFolders(folders), "an existing folder is not allowed on its behalf")
	content, err := os.ReadFile(filepath.Join(existing, "index.html"))
	require.NoError(t, err)
	require.Equal(t, "mine", string(content))
}

// 4C: a specialist template is written only into the folder the request created,
// an unknown template creates nothing, and a failed spawn leaves nothing behind.
func TestProjectlessSpawn_TemplateScaffoldAndRollback(t *testing.T) {
	_, folders, root, rr := projectlessSpawn(t, map[string]any{
		"projectless": true, "displayName": "Resume Editor", "prompt": "hello", "template": "no-such-template",
	})
	require.Equal(t, http.StatusBadRequest, rr.Code, rr.Body.String())
	entries, err := os.ReadDir(root)
	require.NoError(t, err)
	require.Empty(t, entries, "an unknown template creates no folder")
	require.Empty(t, services.WorkingFolders(folders))

	_, folders, root, rr = projectlessSpawn(t, map[string]any{
		"projectless": true, "displayName": "Resume Editor", "prompt": "hello", "template": services.TemplateResumeEditor,
		"permissionMode": "not-a-mode", // the spawn fails after the scaffold is written
	})
	require.Equal(t, http.StatusBadRequest, rr.Code, rr.Body.String())
	_, err = os.Stat(filepath.Join(root, "Resume-Editor"))
	require.True(t, os.IsNotExist(err), "the scaffold and the folder are rolled back")
	require.Empty(t, services.WorkingFolders(folders))
}
