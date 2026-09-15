package roadmapapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/lx-wnk/agent-dashboard/sdk"
	roadmapapi "github.com/lx-wnk/agent-dashboard/server/internal/api/roadmap"
	"github.com/lx-wnk/agent-dashboard/server/internal/db"
	"github.com/lx-wnk/agent-dashboard/server/internal/db/ent"
	"github.com/lx-wnk/agent-dashboard/server/internal/roadmap"
)

type folders map[string][]string

func (f folders) ListByProject(_ context.Context, projectID string) ([]*ent.ProjectFolder, error) {
	var out []*ent.ProjectFolder
	for i, p := range f[projectID] {
		out = append(out, &ent.ProjectFolder{Path: p, IsDefault: i == 0})
	}
	return out, nil
}

type scan map[int]sdk.Agent

func (s scan) AgentByPID(pid int) (sdk.Agent, bool) {
	a, ok := s[pid]
	return a, ok
}

type owners map[int]string

func (o owners) Owns(pid int, sessionID string) bool { return o[pid] == sessionID && sessionID != "" }

type fixture struct {
	router   http.Handler
	svc      *roadmap.Service
	projA    string
	projB    string
	dirA     string
	spawned  []map[string]any
	output   map[string]any
	scan     scan
	owners   owners
	folders  folders
	spawnErr error
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	bundle, err := db.Open(":memory:")
	require.NoError(t, err)
	t.Cleanup(func() { _ = bundle.Client.Close() })
	c := bundle.Client
	ctx := context.Background()
	f := &fixture{svc: roadmap.New(c), projA: uuid.NewString(), projB: uuid.NewString(), scan: scan{}, owners: owners{}}
	require.NoError(t, c.Project.Create().SetID(f.projA).SetSlug("a").SetName("A").Exec(ctx))
	require.NoError(t, c.Project.Create().SetID(f.projB).SetSlug("b").SetName("B").Exec(ctx))
	f.dirA, err = filepath.EvalSymlinks(t.TempDir())
	require.NoError(t, err)
	f.folders = folders{f.projA: {f.dirA}}

	h := roadmapapi.NewHandler(f.svc, f.folders)
	h.SetAgents(f.scan, f.owners, func(string, string) (map[string]any, error) { return f.output, nil })
	h.SetSpawn(func(_ *http.Request, body map[string]any) (int, error) {
		f.spawned = append(f.spawned, body)
		return 4242, f.spawnErr
	})
	r := chi.NewRouter()
	h.Mount(r)
	f.router = r
	return f
}

func (f *fixture) do(t *testing.T, method, path string, body any) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		require.NoError(t, json.NewEncoder(&buf).Encode(body))
	}
	rr := httptest.NewRecorder()
	f.router.ServeHTTP(rr, httptest.NewRequest(method, path, &buf))
	var out map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &out)
	return rr, out
}

func phases(out map[string]any) []map[string]any {
	list, _ := out["phases"].([]any)
	res := make([]map[string]any, len(list))
	for i, p := range list {
		res[i] = p.(map[string]any)
	}
	return res
}

// 39: Project A's roadmap cannot be changed through Project B's routes, and a
// client cannot claim provenance.
func TestRoutes_ProjectIsolationAndServerProvenance(t *testing.T) {
	f := newFixture(t)
	base := "/api/projects/" + f.projA + "/roadmap"
	rr, out := f.do(t, http.MethodPost, base+"/phases", map[string]any{"title": "Foundation", "status": "completed", "provenance": "verified"})
	require.Equal(t, http.StatusCreated, rr.Code, rr.Body.String())
	ph := phases(out)[0]
	require.Equal(t, "user", ph["provenance"], "the client cannot claim verified")
	phaseID := ph["id"].(string)

	other := "/api/projects/" + f.projB + "/roadmap"
	for _, tc := range []struct{ method, path string }{
		{http.MethodPatch, other + "/phases/" + phaseID},
		{http.MethodDelete, other + "/phases/" + phaseID},
		{http.MethodPost, other + "/phases/" + phaseID + "/move"},
		{http.MethodPost, other + "/phases/" + phaseID + "/items"},
	} {
		rr, _ := f.do(t, tc.method, tc.path, map[string]any{"title": "hijack", "direction": "up"})
		require.Equal(t, http.StatusNotFound, rr.Code, "%s %s", tc.method, tc.path)
	}
	rr, _ = f.do(t, http.MethodPut, other+"/current", map[string]any{"phaseId": phaseID})
	require.Equal(t, http.StatusNotFound, rr.Code)

	_, out = f.do(t, http.MethodGet, base, nil)
	require.Equal(t, "Foundation", phases(out)[0]["title"])
	require.Nil(t, out["currentPhaseId"])

	rr, _ = f.do(t, http.MethodPost, base+"/phases", map[string]any{"title": "x", "status": "wip"})
	require.Equal(t, http.StatusBadRequest, rr.Code)
	rr, _ = f.do(t, http.MethodGet, "/api/projects/"+uuid.NewString()+"/roadmap", nil)
	require.Equal(t, http.StatusNotFound, rr.Code)
}

func validProposal() map[string]any {
	return map[string]any{"roadmapProposal": map[string]any{
		"objective": "Monitor agents",
		"summary":   "README + git log",
		"phases":    []any{map[string]any{"title": "Foundation", "status": "completed", "evidence": []any{"README.md"}}, map[string]any{"title": "Now", "status": "active", "current": true}},
	}}
}

// A proposal is imported only from an agent the dashboard launched in this
// project's folders, and is stored as pending.
func TestProposalFromAgent_OnlyOwnedAgentsInTheProject(t *testing.T) {
	f := newFixture(t)
	f.output = validProposal()
	path := "/api/projects/" + f.projA + "/roadmap/proposals/from-agent"

	f.scan[10] = sdk.Agent{PID: 10, SessionID: "external", CWD: f.dirA}
	rr, _ := f.do(t, http.MethodPost, path, map[string]any{"pid": 10})
	require.Equal(t, http.StatusForbidden, rr.Code, "an external session cannot propose")

	elsewhere := t.TempDir()
	f.scan[11] = sdk.Agent{PID: 11, SessionID: "owned-elsewhere", CWD: elsewhere}
	f.owners[11] = "owned-elsewhere"
	rr, _ = f.do(t, http.MethodPost, path, map[string]any{"pid": 11})
	require.Equal(t, http.StatusForbidden, rr.Code, "an owned agent outside the project's folders cannot propose")

	f.scan[12] = sdk.Agent{PID: 12, SessionID: "owned", CWD: filepath.Join(f.dirA)}
	f.owners[12] = "owned"
	rr, _ = f.do(t, http.MethodPost, "/api/projects/"+f.projB+"/roadmap/proposals/from-agent", map[string]any{"pid": 12})
	require.Equal(t, http.StatusForbidden, rr.Code, "project B has no folder the agent runs in")

	f.output = map[string]any{"roadmapProposal": map[string]any{"phases": []any{}}}
	rr, _ = f.do(t, http.MethodPost, path, map[string]any{"pid": 12})
	require.Equal(t, http.StatusBadRequest, rr.Code, "an invalid proposal is refused")

	f.output = validProposal()
	rr, out := f.do(t, http.MethodPost, path, map[string]any{"pid": 12})
	require.Equal(t, http.StatusCreated, rr.Code, rr.Body.String())
	require.Equal(t, "pending", out["status"])

	_, rm := f.do(t, http.MethodGet, "/api/projects/"+f.projA+"/roadmap", nil)
	require.Empty(t, phases(rm), "nothing changes until a person accepts")
	require.EqualValues(t, 1, rm["pendingProposals"])

	rr, rm = f.do(t, http.MethodPost, "/api/projects/"+f.projA+"/roadmap/proposals/"+out["id"].(string)+"/accept", map[string]any{"mode": "append"})
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	require.Equal(t, "suggested", phases(rm)[0]["provenance"])
	require.NotNil(t, rm["currentPhaseId"])
}

func TestAnalyze_StartsAServerDefinedAgentInTheProjectFolder(t *testing.T) {
	f := newFixture(t)
	rr, out := f.do(t, http.MethodPost, "/api/projects/"+f.projA+"/roadmap/analyze", map[string]any{"prompt": "rm -rf /", "cwd": "/etc"})
	require.Equal(t, http.StatusCreated, rr.Code, rr.Body.String())
	require.EqualValues(t, 4242, out["pid"])
	require.Len(t, f.spawned, 1)
	body := f.spawned[0]
	require.Equal(t, f.dirA, body["cwd"], "the project's folder, never a client path")
	require.Equal(t, f.projA, body["projectId"])
	require.Equal(t, roadmapapi.AnalysisSystemPrompt, body["systemPrompt"])
	require.NotContains(t, body["prompt"], "rm -rf")
	require.Equal(t, "default", body["permissionMode"])

	rr, _ = f.do(t, http.MethodPost, "/api/projects/"+f.projB+"/roadmap/analyze", nil)
	require.Equal(t, http.StatusBadRequest, rr.Code, "a project without a folder has nowhere to run")

	f.spawnErr = errors.New("cwd not allowed")
	rr, _ = f.do(t, http.MethodPost, "/api/projects/"+f.projA+"/roadmap/analyze", nil)
	require.Equal(t, http.StatusBadRequest, rr.Code)
}
