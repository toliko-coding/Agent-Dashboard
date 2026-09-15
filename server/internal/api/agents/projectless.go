package agents

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"

	"github.com/lx-wnk/agent-dashboard/server/internal/agentprofile"
	"github.com/lx-wnk/agent-dashboard/server/internal/services"
)

/*
 * Projectless agent workspaces over HTTP (3N.2). The rules live in
 * services/projectless.go; these handlers only translate them.
 *
 *   GET  /api/agents/projectless              the root, and whether it is the default
 *   PUT  /api/agents/projectless              set the root ("" restores the default)
 *   POST /api/agents/projectless/preview      where a workspace for a name would go
 *
 * Creating one happens only inside POST /api/agents/spawn ("projectless": true),
 * so the server records that it created the folder (createProjectlessForSpawn).
 *
 * All three need the working-folder settings; without them they answer 404,
 * like the working-folder routes.
 */

type projectlessRootResponse struct {
	Root      string `json:"root"`
	IsDefault bool   `json:"isDefault"`
	Exists    bool   `json:"exists"`
}

func (h *SpawnHandler) projectlessRoot(w http.ResponseWriter) (projectlessRootResponse, bool) {
	root, isDefault, err := services.EffectiveProjectlessRoot(h.workingFolders)
	if err != nil {
		writeFolderJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return projectlessRootResponse{}, false
	}
	resp := projectlessRootResponse{Root: root, IsDefault: isDefault}
	if info, statErr := os.Stat(root); statErr == nil && info.IsDir() {
		resp.Exists = true
	}
	return resp, true
}

// GetProjectlessRoot handles GET /api/agents/projectless.
func (h *SpawnHandler) GetProjectlessRoot(w http.ResponseWriter, _ *http.Request) {
	if h.workingFolders == nil {
		http.NotFound(w, nil)
		return
	}
	if resp, ok := h.projectlessRoot(w); ok {
		writeFolderJSON(w, http.StatusOK, resp)
	}
}

// SetProjectlessRoot handles PUT /api/agents/projectless.
func (h *SpawnHandler) SetProjectlessRoot(w http.ResponseWriter, r *http.Request) {
	if h.workingFolders == nil {
		http.NotFound(w, r)
		return
	}
	var body struct {
		Root string `json:"root"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeFolderJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	if err := services.SetProjectlessRoot(r.Context(), h.workingFolders, body.Root); err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, services.ErrCwdBlacklisted) {
			status = http.StatusForbidden
		}
		writeFolderJSON(w, status, map[string]string{"error": err.Error()})
		return
	}
	if resp, ok := h.projectlessRoot(w); ok {
		writeFolderJSON(w, http.StatusOK, resp)
	}
}

func decodeAgentName(w http.ResponseWriter, r *http.Request) (string, bool) {
	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeFolderJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return "", false
	}
	return body.Name, true
}

// PreviewProjectlessWorkspace handles POST /api/agents/projectless/preview.
func (h *SpawnHandler) PreviewProjectlessWorkspace(w http.ResponseWriter, r *http.Request) {
	if h.workingFolders == nil {
		http.NotFound(w, r)
		return
	}
	name, ok := decodeAgentName(w, r)
	if !ok {
		return
	}
	ws, err := services.PreviewProjectlessWorkspace(h.workingFolders, name)
	if err != nil {
		writeFolderJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeFolderJSON(w, http.StatusOK, ws)
}

/*
 * createProjectlessForSpawn is the only way a projectless workspace is created
 * (3N.2.1): inside POST /api/agents/spawn with "projectless": true, so the folder
 * the server creates, the one allowed-folder entry it adds and the agent it then
 * launches are recorded together — the provenance delete later relies on to
 * remove that entry. The request can never claim that provenance for a folder
 * the server did not create.
 */
func (h *SpawnHandler) createProjectlessForSpawn(w http.ResponseWriter, r *http.Request, body map[string]any) (services.ProjectlessWorkspace, spawnProvenance, bool) {
	if h.workingFolders == nil {
		writeFolderJSON(w, http.StatusBadRequest, map[string]string{"error": "projectless workspaces are not available on this server"})
		return services.ProjectlessWorkspace{}, spawnProvenance{}, false
	}
	name, _ := body["displayName"].(string)
	category, _ := body["category"].(string)
	if _, err := agentprofile.Normalize(name, category); err != nil {
		writeFolderJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return services.ProjectlessWorkspace{}, spawnProvenance{}, false
	}
	if prompt, _ := body["prompt"].(string); prompt == "" {
		writeFolderJSON(w, http.StatusBadRequest, map[string]string{"error": "missing or invalid prompt"})
		return services.ProjectlessWorkspace{}, spawnProvenance{}, false
	}
	templateID, _ := body["template"].(string)
	var tmpl services.ProjectlessTemplate
	if templateID != "" {
		t, terr := services.LookupProjectlessTemplate(templateID)
		if terr != nil {
			writeFolderJSON(w, http.StatusBadRequest, map[string]string{"error": terr.Error()})
			return services.ProjectlessWorkspace{}, spawnProvenance{}, false
		}
		tmpl = t
	}
	delete(body, "template")
	ws, err := services.CreateProjectlessWorkspace(r.Context(), h.workingFolders, name)
	if err != nil {
		status := http.StatusBadRequest
		switch {
		case errors.Is(err, services.ErrWorkspaceExists):
			status = http.StatusConflict
		case errors.Is(err, services.ErrCwdBlacklisted):
			status = http.StatusForbidden
		}
		writeFolderJSON(w, status, map[string]string{"error": err.Error()})
		return services.ProjectlessWorkspace{}, spawnProvenance{}, false
	}
	// A specialist template goes only into the folder this request just created.
	if templateID != "" {
		if terr := services.ApplyProjectlessTemplate(ws.Path, tmpl); terr != nil {
			h.undoProjectlessWorkspace(r.Context(), ws, templateID)
			writeFolderJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not prepare the workspace"})
			return services.ProjectlessWorkspace{}, spawnProvenance{}, false
		}
	}
	// A projectless workspace belongs to no Project and resumes nothing.
	body["cwd"] = ws.Path
	delete(body, "projectId")
	delete(body, "resumeSessionId")
	if h.auditRepo != nil {
		_ = h.auditRepo.RecordAudit(r.Context(), nil, "projectless_workspace_create", "folder:"+ws.Folder, nil)
	}
	return ws, spawnProvenance{workspaceCreated: true, allowedFolder: ws.Path, template: templateID}, true
}

// undoProjectlessWorkspace reverts a workspace whose agent failed to start: its
// allowed-folder entry goes, the template scaffold it wrote goes, and the folder
// is removed only if then empty.
func (h *SpawnHandler) undoProjectlessWorkspace(ctx context.Context, ws services.ProjectlessWorkspace, templateID string) {
	if t, err := services.LookupProjectlessTemplate(templateID); err == nil {
		services.RemoveProjectlessTemplate(ws.Path, t)
	}
	if _, err := services.RemoveWorkingFolder(ctx, h.workingFolders, ws.Path); err != nil {
		slog.Warn("projectless: allowed folder not removed after a failed spawn", "err", err)
	}
	_ = os.Remove(ws.Path) // fails, harmlessly, on a non-empty folder
}
