package localscope

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/lx-wnk/agent-dashboard/sdk"
	"github.com/lx-wnk/agent-dashboard/server/internal/identity"
)

/*
 * Normalized service and process lists.
 *
 * These are the dashboard's shapes, not LocalScope's. Field for field they
 * carry the same facts — everything here is something the collector actually
 * reports, and nothing is invented — but the envelope, the freshness model and
 * the names belong to this repository, so a Vue component never learns that a
 * separate collector process exists.
 *
 * Why separate endpoints rather than more fields on /api/localscope/snapshot:
 * the snapshot backs the Overview and the System Map, which are always mounted
 * and poll every 5s, and it is six integers. The process list on this machine
 * is 38 records; folding it in would multiply the cost of the cheapest, most
 * frequent read by the size of the largest one, for surfaces that only ever
 * show counts. The lists are polled only while a view that displays them is
 * open. Same normalization, same state machine, separate cost.
 */

// DiscoveredProject is a project LocalScope inferred from a process working
// directory.
//
// Named to keep it distinct from a project the user registered in this
// dashboard. They answer different questions — "which manifest root does this
// cwd sit under" versus "which project did you tell me about" — and they
// disagree in practice on monorepos. Reconciling them is deliberately not done
// here; until it is, nothing may treat this as a dashboard project id.
type DiscoveredProject struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// PackageName is the manifest's own name, which is often unrelated to the
	// folder ("claude-agent-overview" for Agent-Dashboard). Kept separate for
	// exactly that reason.
	PackageName *string `json:"packageName"`
	RootPath    string  `json:"rootPath"`
	/* DisplayPath is rootPath with $HOME collapsed to ~. */
	DisplayPath string  `json:"displayPath"`
	Manifest    *string `json:"manifest"`
	Git         GitInfo `json:"git"`
	// Repo is the enclosing repository when the project root is not itself the
	// repo root — how a monorepo package points back at the repository the
	// developer thinks in. Null when they are the same.
	Repo       *RepoRef `json:"repo"`
	Frameworks []string `json:"frameworks"`
}

// GitInfo is what LocalScope could read about the project's repository.
type GitInfo struct {
	IsRepo bool `json:"isRepo"`
	// Branch is null when detached, unreadable, or not a repo.
	Branch *string `json:"branch"`
}

// RepoRef names an enclosing repository.
type RepoRef struct {
	Name     string `json:"name"`
	RootPath string `json:"rootPath"`
}

// Service is a listening port, in developer terms.
type Service struct {
	// ID is LocalScope's `${pid}:${port}` — stable while the listener lives,
	// and preserved verbatim so it can key a UI list and later a correlation.
	ID       string `json:"id"`
	PID      int    `json:"pid"`
	Port     int    `json:"port"`
	Address  string `json:"address"`
	Protocol string `json:"protocol"`
	// BindScope is loopback, all or specific — the difference between a server
	// only this machine can reach and one the local network can.
	BindScope   string `json:"bindScope"`
	IPVersion   string `json:"ipVersion"`
	ProcessName string `json:"processName"`
	// Command is LocalScope's sanitized argv. It is passed through as given and
	// never reconstructed here: the collector owns secret-stripping, and a
	// second implementation would be a second thing to get wrong.
	Command string  `json:"command"`
	Cwd     *string `json:"cwd"`
	Runtime string  `json:"runtime"`
	// Kind and Label are the classification: 'vite', "Vite Development Server".
	Kind  string  `json:"kind"`
	Label string  `json:"label"`
	URL   *string `json:"url"`
	// DiscoveredProject is LocalScope's attribution, null when the cwd resolved
	// to no project.
	DiscoveredProject *DiscoveredProject `json:"discoveredProject"`
	// Confidence qualifies Kind, Label and DiscoveredProject — never Port or
	// PID, which are observed rather than inferred.
	Confidence string  `json:"confidence"`
	StartedAt  *string `json:"startedAt"`
	// Workspace is the checkout this service runs in, resolved from Cwd alone.
	// Null when Cwd is absent or unresolvable — see workspaceFromCwd for why no
	// other field is used as evidence. Correlation is id equality against an
	// agent's workspace, so null here means the service stays unattributed.
	Workspace *sdk.WorkspaceRef `json:"workspace"`
}

// Process is a development process LocalScope considered relevant.
type Process struct {
	// ID is the pid as a string, which is LocalScope's own stable key.
	ID   string `json:"id"`
	PID  int    `json:"pid"`
	PPID int    `json:"ppid"`
	Name string `json:"name"`
	// Command is the sanitized argv, passed through unchanged. See Service.
	Command string  `json:"command"`
	Cwd     *string `json:"cwd"`
	Runtime string  `json:"runtime"`
	// CPUPercent and MemoryBytes are null when ps did not report them; a
	// pointer keeps "not reported" from arriving as 0.
	CPUPercent      *float64 `json:"cpuPercent"`
	MemoryBytes     *int64   `json:"memoryBytes"`
	ElapsedSeconds  *int64   `json:"elapsedSeconds"`
	StartedAt       *string  `json:"startedAt"`
	Ports           []int    `json:"ports"`
	RelevanceReason []string `json:"relevanceReasons"`
	// DiscoveredProject is LocalScope's attribution. See the type's own note on
	// why it is not a dashboard project.
	DiscoveredProject *DiscoveredProject `json:"discoveredProject"`
	// Workspace is the checkout this process runs in, resolved from Cwd alone.
	// Same rule and same reasons as Service.Workspace.
	Workspace *sdk.WorkspaceRef `json:"workspace"`
}

// ServicesResponse is GET /api/localscope/services.
//
// Items is null when the list is not known and [] when the collector looked and
// found none — the distinction the whole model exists to keep.
type ServicesResponse struct {
	Freshness
	Items []Service `json:"items"`
}

// ProcessesResponse is GET /api/localscope/processes.
//
// Total is every process on the machine, relevant or not, so a surface can say
// "38 of 818" rather than presenting a filtered list as the whole truth. Null
// when unknown, for the same reason every other count is nullable.
type ProcessesResponse struct {
	Freshness
	Items []Process `json:"items"`
	Total *int      `json:"total"`
}

/*
 * The upstream shapes, decoded only far enough to normalize.
 *
 * Pointers throughout for the same reason as the summary: a type mismatch must
 * fail the decode rather than yield a zero, so a renamed or retyped field
 * surfaces as "unavailable" instead of as a quiet lie.
 */
type rawProjectRef struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	PackageName *string `json:"packageName"`
	RootPath    string  `json:"rootPath"`
	DisplayPath string  `json:"displayPath"`
	Manifest    *string `json:"manifest"`
	Git         struct {
		IsRepo bool    `json:"isRepo"`
		Branch *string `json:"branch"`
	} `json:"git"`
	Repo *struct {
		Name     string `json:"name"`
		RootPath string `json:"rootPath"`
	} `json:"repo"`
	Frameworks []string `json:"frameworks"`
}

type rawService struct {
	ID          string         `json:"id"`
	Port        int            `json:"port"`
	Address     string         `json:"address"`
	BindScope   string         `json:"bindScope"`
	Protocol    string         `json:"protocol"`
	IPVersion   string         `json:"ipVersion"`
	PID         int            `json:"pid"`
	ProcessName string         `json:"processName"`
	Command     string         `json:"command"`
	Cwd         *string        `json:"cwd"`
	Runtime     string         `json:"runtime"`
	Kind        string         `json:"kind"`
	Label       string         `json:"label"`
	URL         *string        `json:"url"`
	Project     *rawProjectRef `json:"project"`
	Confidence  string         `json:"confidence"`
	StartedAt   *string        `json:"startedAt"`
}

type rawProcess struct {
	ID               string         `json:"id"`
	PID              int            `json:"pid"`
	PPID             int            `json:"ppid"`
	Name             string         `json:"name"`
	Command          string         `json:"command"`
	Cwd              *string        `json:"cwd"`
	Runtime          string         `json:"runtime"`
	CPUPercent       *float64       `json:"cpuPercent"`
	MemoryBytes      *int64         `json:"memoryBytes"`
	ElapsedSeconds   *int64         `json:"elapsedSeconds"`
	StartedAt        *string        `json:"startedAt"`
	Project          *rawProjectRef `json:"project"`
	Ports            []int          `json:"ports"`
	Relevant         bool           `json:"relevant"`
	RelevanceReasons []string       `json:"relevanceReasons"`
}

// processSnapshot is LocalScope's processes payload: the list plus the
// machine-wide denominator.
type processSnapshot struct {
	Processes []rawProcess `json:"processes"`
	Total     *int         `json:"total"`
}

func projectFrom(p *rawProjectRef) *DiscoveredProject {
	if p == nil {
		return nil
	}
	out := &DiscoveredProject{
		ID: p.ID, Name: p.Name, PackageName: p.PackageName,
		RootPath: p.RootPath, DisplayPath: p.DisplayPath, Manifest: p.Manifest,
		Git:        GitInfo{IsRepo: p.Git.IsRepo, Branch: p.Git.Branch},
		Frameworks: p.Frameworks,
	}
	if out.Frameworks == nil {
		out.Frameworks = []string{}
	}
	if p.Repo != nil {
		out.Repo = &RepoRef{Name: p.Repo.Name, RootPath: p.Repo.RootPath}
	}
	return out
}

/*
 * workspaceFromCwd resolves an observation's workspace from its cwd, and from
 * nothing else.
 *
 * cwd is the only evidence used, which was settled against the contract and the
 * live collector rather than assumed:
 *
 *   - LocalScope derives DiscoveredProject FROM the cwd ("null when the cwd
 *     resolved to no project"), so rootPath cannot rescue a missing cwd. On
 *     this machine that holds exactly: of 8 services and 45 processes, zero had
 *     a rootPath without a cwd. A rootPath fallback would never once have run.
 *   - `Confidence` is a single joint qualifier over Kind, Label AND
 *     DiscoveredProject, with no per-field granularity. A live service sits at
 *     confidence 'low' — the port-only guess behind "Unidentified Service" —
 *     while carrying a perfectly good observed cwd, so applying label-confidence
 *     to path evidence would discard good evidence; trusting rootPath at that
 *     same confidence would accept a guess. Neither is defensible.
 *   - Process carries DiscoveredProject with NO Confidence field at all, so the
 *     fallback would be strictly unqualifiable there. Services and processes
 *     must share one rule.
 *
 * cwd is observed (lsof/ps), which is the same class of evidence as an agent's
 * own cwd — the two sides of the correlation are therefore derived alike.
 */
func workspaceFromCwd(ctx context.Context, r *identity.Resolver, cwd *string) *sdk.WorkspaceRef {
	if cwd == nil || *cwd == "" {
		return nil
	}
	return r.RefFor(ctx, *cwd)
}

func servicesFrom(ctx context.Context, r *identity.Resolver, raw []rawService) []Service {
	out := make([]Service, 0, len(raw))
	for _, s := range raw {
		out = append(out, Service{
			Workspace: workspaceFromCwd(ctx, r, s.Cwd),
			ID:        s.ID, PID: s.PID, Port: s.Port, Address: s.Address,
			Protocol: s.Protocol, BindScope: s.BindScope, IPVersion: s.IPVersion,
			ProcessName: s.ProcessName, Command: s.Command, Cwd: s.Cwd,
			Runtime: s.Runtime, Kind: s.Kind, Label: s.Label, URL: s.URL,
			DiscoveredProject: projectFrom(s.Project),
			Confidence:        s.Confidence, StartedAt: s.StartedAt,
		})
	}
	return out
}

func processesFrom(ctx context.Context, r *identity.Resolver, raw []rawProcess) []Process {
	out := make([]Process, 0, len(raw))
	for _, p := range raw {
		ports := p.Ports
		if ports == nil {
			// A process with no listeners reports none, which is a fact; null
			// here would read as "unknown ports" instead.
			ports = []int{}
		}
		reasons := p.RelevanceReasons
		if reasons == nil {
			reasons = []string{}
		}
		out = append(out, Process{
			Workspace: workspaceFromCwd(ctx, r, p.Cwd),
			ID:        p.ID, PID: p.PID, PPID: p.PPID, Name: p.Name,
			Command: p.Command, Cwd: p.Cwd, Runtime: p.Runtime,
			CPUPercent: p.CPUPercent, MemoryBytes: p.MemoryBytes,
			ElapsedSeconds: p.ElapsedSeconds, StartedAt: p.StartedAt,
			Ports: ports, RelevanceReason: reasons,
			DiscoveredProject: projectFrom(p.Project),
		})
	}
	return out
}

/*
 * services handles GET /api/localscope/services.
 *
 * Reads /api/system/ports with no query string. `all=true` would bypass
 * LocalScope's relevance filter AND its cache, turning every request into an
 * uncached full lsof; the filtered list is what this product shows, so the flag
 * is simply never built here.
 */
func (h *Handler) services(w http.ResponseWriter, r *http.Request) {
	items, fresh := serveList[rawService, Service](
		&h.lastServices,
		func(raw []rawService) []Service { return servicesFrom(r.Context(), h.workspaces, raw) },
		func() ([]byte, error) { return h.fetchUpstream(r.Context(), "/api/system/ports") },
	)
	writeNormalized(w, ServicesResponse{Freshness: fresh, Items: items})
}

// processes handles GET /api/localscope/processes.
//
// Reads the default, relevance-filtered list. The unfiltered variant is 818
// records of mostly OS internals on this machine and is not what any surface
// here displays.
func (h *Handler) processes(w http.ResponseWriter, r *http.Request) {
	body, err := h.fetchUpstream(r.Context(), "/api/system/processes")
	if err != nil {
		writeNormalized(w, h.staleProcesses())
		return
	}

	// The processes payload is an object rather than an array, so it does not
	// go through decodeList — but it fails in exactly the same way.
	var env struct {
		Data        *processSnapshot `json:"data"`
		Degraded    []Degradation    `json:"degraded"`
		CollectedAt string           `json:"collectedAt"`
	}
	if jsonErr := json.Unmarshal(body, &env); jsonErr != nil || env.Data == nil {
		writeNormalized(w, h.staleProcesses())
		return
	}
	at, timeErr := time.Parse(time.RFC3339, env.CollectedAt)
	if timeErr != nil {
		writeNormalized(w, h.staleProcesses())
		return
	}
	if env.Degraded == nil {
		env.Degraded = []Degradation{}
	}

	items := processesFrom(r.Context(), h.workspaces, env.Data.Processes)
	h.lastProcesses.store(items, env.Degraded, at, env.CollectedAt)
	h.lastProcessTotal.store(env.Data.Total, env.Degraded, at, env.CollectedAt)

	writeNormalized(w, ProcessesResponse{
		Freshness: freshFrom(at, env.CollectedAt, env.Degraded),
		Items:     items,
		Total:     env.Data.Total,
	})
}

// staleProcesses is the previous process list marked stale, or nothing known.
func (h *Handler) staleProcesses() ProcessesResponse {
	items, fresh, _ := h.lastProcesses.staleOrUnknown()
	total, _, haveTotal := h.lastProcessTotal.staleOrUnknown()
	resp := ProcessesResponse{Freshness: fresh, Items: items}
	if haveTotal {
		resp.Total = total
	}
	return resp
}

func writeNormalized(w http.ResponseWriter, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	// Always 200: an absent collector is a state to render, not a failure of
	// this endpoint.
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(body)
}
