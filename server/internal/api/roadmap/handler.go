// Package roadmapapi serves Project Intelligence roadmaps over HTTP (Phase 4B).
// The rules live in internal/roadmap; this package translates requests and
// guards the two routes that involve an agent.
package roadmapapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/lx-wnk/agent-dashboard/sdk"
	"github.com/lx-wnk/agent-dashboard/server/internal/apierr"
	"github.com/lx-wnk/agent-dashboard/server/internal/db/ent"
	"github.com/lx-wnk/agent-dashboard/server/internal/roadmap"
	"github.com/lx-wnk/agent-dashboard/server/internal/services"
)

// AgentLookup finds an agent in the dashboard's latest scan.
type AgentLookup interface {
	AgentByPID(pid int) (sdk.Agent, bool)
}

// Ownership reports whether the dashboard launched pid for sessionID.
type Ownership interface {
	Owns(pid int, sessionID string) bool
}

// FolderLister lists a project's folders.
type FolderLister interface {
	ListByProject(ctx context.Context, projectID string) ([]*ent.ProjectFolder, error)
}

// SpawnFunc starts an agent the way POST /api/agents/spawn does (policy, rate
// limit, ownership record) and returns its PID.
type SpawnFunc func(r *http.Request, body map[string]any) (int, error)

// OutputReader reads the final structured JSON block of a session.
type OutputReader func(cwd, sessionID string) (map[string]any, error)

// Handler serves the roadmap routes.
type Handler struct {
	svc        *roadmap.Service
	folders    FolderLister
	agents     AgentLookup
	owners     Ownership
	spawn      SpawnFunc
	readOutput OutputReader
}

// NewHandler creates a Handler.
func NewHandler(svc *roadmap.Service, folders FolderLister) *Handler {
	return &Handler{svc: svc, folders: folders}
}

// SetAgents wires the scan and the ownership check the agent routes need.
func (h *Handler) SetAgents(agents AgentLookup, owners Ownership, readOutput OutputReader) {
	h.agents, h.owners, h.readOutput = agents, owners, readOutput
}

// SetSpawn wires how an analysis agent is started.
func (h *Handler) SetSpawn(fn SpawnFunc) { h.spawn = fn }

// Mount registers the routes.
func (h *Handler) Mount(r chi.Router) {
	w := apierr.ErrorMiddleware
	r.Get("/api/roadmaps/summary", w(h.summaries))
	r.Get("/api/projects/{id}/roadmap", w(h.get))
	r.Put("/api/projects/{id}/roadmap/objective", w(h.setObjective))
	r.Post("/api/projects/{id}/roadmap/phases", w(h.addPhase))
	r.Patch("/api/projects/{id}/roadmap/phases/{phaseId}", w(h.updatePhase))
	r.Delete("/api/projects/{id}/roadmap/phases/{phaseId}", w(h.deletePhase))
	r.Post("/api/projects/{id}/roadmap/phases/{phaseId}/move", w(h.movePhase))
	r.Put("/api/projects/{id}/roadmap/current", w(h.setCurrent))
	r.Post("/api/projects/{id}/roadmap/phases/{phaseId}/items", w(h.addItem))
	r.Patch("/api/projects/{id}/roadmap/items/{itemId}", w(h.updateItem))
	r.Delete("/api/projects/{id}/roadmap/items/{itemId}", w(h.deleteItem))
	r.Post("/api/projects/{id}/roadmap/items/{itemId}/move", w(h.moveItem))
	r.Get("/api/projects/{id}/roadmap/proposals", w(h.listProposals))
	r.Post("/api/projects/{id}/roadmap/proposals/from-agent", w(h.proposalFromAgent))
	r.Post("/api/projects/{id}/roadmap/proposals/{proposalId}/accept", w(h.acceptProposal))
	r.Post("/api/projects/{id}/roadmap/proposals/{proposalId}/reject", w(h.rejectProposal))
	r.Post("/api/projects/{id}/roadmap/analyze", w(h.analyze))
}

func translate(err error) error {
	var ie *roadmap.InvalidError
	switch {
	case err == nil:
		return nil
	case errors.Is(err, roadmap.ErrNotFound):
		return apierr.NewAppError(http.StatusNotFound, "not found in this project")
	case errors.As(err, &ie):
		return apierr.NewAppError(http.StatusBadRequest, ie.Msg)
	default:
		return err
	}
}

func decode(r *http.Request, v any) error {
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		return apierr.NewAppError(http.StatusBadRequest, "invalid JSON")
	}
	return nil
}

func (h *Handler) respondRoadmap(w http.ResponseWriter, r *http.Request, status int) error {
	rm, err := h.svc.Get(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		return translate(err)
	}
	apierr.WriteJSON(w, status, rm)
	return nil
}

func (h *Handler) summaries(w http.ResponseWriter, r *http.Request) error {
	out, err := h.svc.Summaries(r.Context())
	if err != nil {
		return err
	}
	apierr.WriteJSON(w, http.StatusOK, out)
	return nil
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) error {
	return h.respondRoadmap(w, r, http.StatusOK)
}

func (h *Handler) setObjective(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Objective string `json:"objective"`
	}
	if err := decode(r, &body); err != nil {
		return err
	}
	if err := h.svc.SetObjective(r.Context(), chi.URLParam(r, "id"), body.Objective); err != nil {
		return translate(err)
	}
	return h.respondRoadmap(w, r, http.StatusOK)
}

// Request bodies carry no provenance field: the server decides it.
type phaseBody struct {
	Title         *string   `json:"title"`
	Description   *string   `json:"description"`
	Status        *string   `json:"status"`
	BlockedReason *string   `json:"blockedReason"`
	Decisions     *string   `json:"decisions"`
	DependsOn     *[]string `json:"dependsOn"`
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func (h *Handler) addPhase(w http.ResponseWriter, r *http.Request) error {
	var body phaseBody
	if err := decode(r, &body); err != nil {
		return err
	}
	if _, err := h.svc.AddPhase(r.Context(), chi.URLParam(r, "id"), roadmap.PhaseInput{Title: deref(body.Title), Description: deref(body.Description), Status: deref(body.Status)}); err != nil {
		return translate(err)
	}
	return h.respondRoadmap(w, r, http.StatusCreated)
}

func (h *Handler) updatePhase(w http.ResponseWriter, r *http.Request) error {
	var body phaseBody
	if err := decode(r, &body); err != nil {
		return err
	}
	patch := roadmap.PhasePatch{Title: body.Title, Description: body.Description, Status: body.Status, BlockedReason: body.BlockedReason, Decisions: body.Decisions, DependsOn: body.DependsOn}
	if err := h.svc.UpdatePhase(r.Context(), chi.URLParam(r, "id"), chi.URLParam(r, "phaseId"), patch); err != nil {
		return translate(err)
	}
	return h.respondRoadmap(w, r, http.StatusOK)
}

func (h *Handler) deletePhase(w http.ResponseWriter, r *http.Request) error {
	if err := h.svc.DeletePhase(r.Context(), chi.URLParam(r, "id"), chi.URLParam(r, "phaseId")); err != nil {
		return translate(err)
	}
	return h.respondRoadmap(w, r, http.StatusOK)
}

func direction(r *http.Request) (int, error) {
	var body struct {
		Direction string `json:"direction"`
	}
	if err := decode(r, &body); err != nil {
		return 0, err
	}
	switch body.Direction {
	case "up":
		return -1, nil
	case "down":
		return 1, nil
	}
	return 0, apierr.NewAppError(http.StatusBadRequest, "direction must be up or down")
}

func (h *Handler) movePhase(w http.ResponseWriter, r *http.Request) error {
	dir, err := direction(r)
	if err != nil {
		return err
	}
	if err := h.svc.MovePhase(r.Context(), chi.URLParam(r, "id"), chi.URLParam(r, "phaseId"), dir); err != nil {
		return translate(err)
	}
	return h.respondRoadmap(w, r, http.StatusOK)
}

func (h *Handler) setCurrent(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		PhaseID string `json:"phaseId"`
	}
	if err := decode(r, &body); err != nil {
		return err
	}
	if err := h.svc.SetCurrent(r.Context(), chi.URLParam(r, "id"), body.PhaseID); err != nil {
		return translate(err)
	}
	return h.respondRoadmap(w, r, http.StatusOK)
}

type itemBody struct {
	Title         *string `json:"title"`
	Status        *string `json:"status"`
	BlockedReason *string `json:"blockedReason"`
	TaskID        *string `json:"taskId"`
}

func (h *Handler) addItem(w http.ResponseWriter, r *http.Request) error {
	var body itemBody
	if err := decode(r, &body); err != nil {
		return err
	}
	in := roadmap.ItemInput{Title: deref(body.Title), Status: deref(body.Status), TaskID: deref(body.TaskID)}
	if _, err := h.svc.AddItem(r.Context(), chi.URLParam(r, "id"), chi.URLParam(r, "phaseId"), in); err != nil {
		return translate(err)
	}
	return h.respondRoadmap(w, r, http.StatusCreated)
}

func (h *Handler) updateItem(w http.ResponseWriter, r *http.Request) error {
	var body itemBody
	if err := decode(r, &body); err != nil {
		return err
	}
	patch := roadmap.ItemPatch{Title: body.Title, Status: body.Status, BlockedReason: body.BlockedReason, TaskID: body.TaskID}
	if err := h.svc.UpdateItem(r.Context(), chi.URLParam(r, "id"), chi.URLParam(r, "itemId"), patch); err != nil {
		return translate(err)
	}
	return h.respondRoadmap(w, r, http.StatusOK)
}

func (h *Handler) deleteItem(w http.ResponseWriter, r *http.Request) error {
	if err := h.svc.DeleteItem(r.Context(), chi.URLParam(r, "id"), chi.URLParam(r, "itemId")); err != nil {
		return translate(err)
	}
	return h.respondRoadmap(w, r, http.StatusOK)
}

func (h *Handler) moveItem(w http.ResponseWriter, r *http.Request) error {
	dir, err := direction(r)
	if err != nil {
		return err
	}
	if err := h.svc.MoveItem(r.Context(), chi.URLParam(r, "id"), chi.URLParam(r, "itemId"), dir); err != nil {
		return translate(err)
	}
	return h.respondRoadmap(w, r, http.StatusOK)
}

func (h *Handler) listProposals(w http.ResponseWriter, r *http.Request) error {
	out, err := h.svc.ListProposals(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		return translate(err)
	}
	apierr.WriteJSON(w, http.StatusOK, out)
	return nil
}

func (h *Handler) acceptProposal(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Mode string `json:"mode"`
	}
	if err := decode(r, &body); err != nil {
		return err
	}
	if err := h.svc.AcceptProposal(r.Context(), chi.URLParam(r, "id"), chi.URLParam(r, "proposalId"), body.Mode); err != nil {
		return translate(err)
	}
	return h.respondRoadmap(w, r, http.StatusOK)
}

func (h *Handler) rejectProposal(w http.ResponseWriter, r *http.Request) error {
	if err := h.svc.RejectProposal(r.Context(), chi.URLParam(r, "id"), chi.URLParam(r, "proposalId")); err != nil {
		return translate(err)
	}
	return h.respondRoadmap(w, r, http.StatusOK)
}

/*
 * proposalFromAgent imports the structured roadmap proposal an agent returned.
 * The agent must be one the dashboard launched (ownership record), running in
 * one of this project's folders; the proposal is its final JSON block,
 * validated, and stored as pending — it changes nothing until accepted.
 */
func (h *Handler) proposalFromAgent(w http.ResponseWriter, r *http.Request) error {
	if h.agents == nil || h.owners == nil || h.readOutput == nil {
		return apierr.NewAppError(http.StatusServiceUnavailable, "agent proposals are not available on this server")
	}
	var body struct {
		PID int `json:"pid"`
	}
	if err := decode(r, &body); err != nil {
		return err
	}
	projectID := chi.URLParam(r, "id")
	agent, ok := h.agents.AgentByPID(body.PID)
	if !ok || agent.SessionID == "" {
		return apierr.NewAppError(http.StatusNotFound, "no agent with that pid")
	}
	if agent.Machine != "" || agent.InternalProcess || !h.owners.Owns(agent.PID, agent.SessionID) {
		return apierr.NewAppError(http.StatusForbidden, "Only an agent Agent Dashboard started can propose a roadmap.")
	}
	folders, err := h.folders.ListByProject(r.Context(), projectID)
	if err != nil {
		return err
	}
	if !services.CwdWithinFolders(folders, agent.CWD) {
		return apierr.NewAppError(http.StatusForbidden, "This agent does not work in this project's folders.")
	}
	raw, err := h.readOutput(agent.CWD, agent.SessionID)
	if err != nil {
		return apierr.NewAppError(http.StatusBadRequest, "could not read the agent's result")
	}
	payload, err := roadmap.ValidateProposal(raw)
	if err != nil {
		return translate(err)
	}
	created, err := h.svc.CreateProposal(r.Context(), projectID, payload, agent.SessionID)
	if err != nil {
		return translate(err)
	}
	apierr.WriteJSON(w, http.StatusCreated, created)
	return nil
}

/*
 * analyze starts a Project Intelligence agent for the project: a normal,
 * dashboard-owned agent in the project's default folder, with a fixed prompt
 * the server writes. The request cannot supply the prompt. Claude Code's own
 * trust and permission prompts apply as for any other agent.
 */
func (h *Handler) analyze(w http.ResponseWriter, r *http.Request) error {
	if h.spawn == nil {
		return apierr.NewAppError(http.StatusServiceUnavailable, "starting agents is not available on this server")
	}
	projectID := chi.URLParam(r, "id")
	rm, err := h.svc.Get(r.Context(), projectID)
	if err != nil {
		return translate(err)
	}
	folders, err := h.folders.ListByProject(r.Context(), projectID)
	if err != nil {
		return err
	}
	cwd := ""
	for _, f := range folders {
		if cwd == "" || f.IsDefault {
			cwd = f.Path
		}
	}
	if cwd == "" {
		return apierr.NewAppError(http.StatusBadRequest, "Add a folder to this project first: the analysis runs there.")
	}
	body := map[string]any{
		"prompt":         AnalysisPrompt(rm),
		"systemPrompt":   AnalysisSystemPrompt,
		"cwd":            cwd,
		"projectId":      projectID,
		"enableChannel":  true,
		"permissionMode": "default",
		"displayName":    "Project Intelligence",
		"category":       "research",
	}
	pid, err := h.spawn(r, body)
	if err != nil {
		return apierr.NewAppError(http.StatusBadRequest, err.Error())
	}
	apierr.WriteJSON(w, http.StatusCreated, map[string]any{"pid": pid})
	return nil
}

// AnalysisSystemPrompt is the Project Intelligence role.
const AnalysisSystemPrompt = `You are Project Intelligence for Agent Dashboard. You inspect a software project and propose a structured roadmap of where it stands. You never modify files, never run commands that change anything, and never invent progress.

Rules:
- Base every claim on evidence you read: README and docs, package metadata, git history (git log), existing roadmap data you are given, and project context files such as .agent-context. Cite the evidence for each phase.
- A phase is "completed" only when the evidence shows it was built; "active" when there is current work; "planned" for work not started. Use "blocked" only when the evidence names a blocker.
- Mark at most one phase "current": where the project is now.
- Say what you do not know. Prefer fewer, meaningful phases (3–10) over many small ones.
- Your final message must end with one fenced json block, exactly in the requested shape, and nothing after it.`

// AnalysisPrompt asks for a proposal, giving the agent the current roadmap.
func AnalysisPrompt(rm roadmap.Roadmap) string {
	var current strings.Builder
	if len(rm.Phases) == 0 {
		current.WriteString("(no roadmap yet)")
	}
	for i, p := range rm.Phases {
		marker := ""
		if p.Current {
			marker = " [current]"
		}
		fmt.Fprintf(&current, "%d. %s — %s%s\n", i+1, p.Title, p.Status, marker)
	}
	objective := rm.Objective
	if objective == "" {
		objective = "(not set)"
	}
	return fmt.Sprintf(`Inspect this project read-only and propose its roadmap.

Current objective: %s
Current roadmap:
%s
Return a proposal that corrects or extends the current roadmap. End your final message with exactly one block:

`+"```json"+`
{"roadmapProposal": {
  "objective": "one or two sentences",
  "summary": "what you inspected and what changed compared with the current roadmap",
  "phases": [
    {"title": "short name", "description": "one or two sentences", "status": "completed|active|planned|blocked|ready|skipped", "current": false,
     "evidence": ["README.md: ...", "git log: ..."],
     "items": [{"title": "concrete piece of work", "status": "completed|active|planned|blocked|ready|skipped"}]}
  ]
}}
`+"```", objective, current.String())
}
