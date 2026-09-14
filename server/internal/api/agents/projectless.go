package agents

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"

	"github.com/lx-wnk/agent-dashboard/server/internal/services"
)

/*
 * Projectless agent workspaces over HTTP (3N.2). The rules live in
 * services/projectless.go; these handlers only translate them.
 *
 *   GET  /api/agents/projectless              the root, and whether it is the default
 *   PUT  /api/agents/projectless              set the root ("" restores the default)
 *   POST /api/agents/projectless/preview      where a workspace for a name would go
 *   POST /api/agents/projectless/workspaces   create it, allowing exactly that folder
 *
 * All four need the working-folder settings; without them they answer 404,
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

// CreateProjectlessWorkspace handles POST /api/agents/projectless/workspaces.
func (h *SpawnHandler) CreateProjectlessWorkspace(w http.ResponseWriter, r *http.Request) {
	if h.workingFolders == nil {
		http.NotFound(w, r)
		return
	}
	name, ok := decodeAgentName(w, r)
	if !ok {
		return
	}
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
		return
	}
	if h.auditRepo != nil {
		_ = h.auditRepo.RecordAudit(r.Context(), nil, "projectless_workspace_create", "folder:"+ws.Folder, nil)
	}
	writeFolderJSON(w, http.StatusCreated, ws)
}
