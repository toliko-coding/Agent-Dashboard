import type { Agent, WorkspaceRef } from '@/types'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { axe } from '@/utils/testA11y'
import RuntimeTopology from '../RuntimeTopology.vue'
import RuntimeTopologyTree from '../RuntimeTopologyTree.vue'

let servicesState: any
let processesState: any
let servicesCalls = 0

vi.mock('@/features/localscope', async () => ({
  useMachineServices: () => {
    servicesCalls++
    return { data: { value: servicesState }, loaded: { value: true }, refetch: async () => {} }
  },
  useMachineProcesses: () => ({ data: { value: processesState }, loaded: { value: true }, refetch: async () => {} }),
  // The real indicator, so freshness assertions check what actually renders.
  DataFreshnessIndicator: (await import('@/features/localscope/components/DataFreshnessIndicator.vue')).default,
}))

function memoryStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size },
  }
}

function list(items: any[] | null, over: Record<string, unknown> = {}) {
  return { source: items === null ? 'unavailable' : 'ok', collectedAt: null, ageMs: null, degraded: [], items, total: null, ...over }
}

function ws(id: string, over: Partial<WorkspaceRef> = {}): WorkspaceRef {
  return {
    id,
    name: 'Agent-Dashboard',
    kind: 'git-main',
    branch: 'feat/localscope-integration',
    repository: { id: 'repo_ad', name: 'Agent-Dashboard' },
    ...over,
  } as WorkspaceRef
}

let nextPid = 500
function agent(workspace: WorkspaceRef | null, projectName = 'Agent-Dashboard'): Agent {
  nextPid++
  return { pid: nextPid, sessionId: `s${nextPid}`, projectName, status: 'active', working: false, model: 'claude-opus-5', workspace } as unknown as Agent
}
function svc(workspace: WorkspaceRef | null, port: number) {
  return { id: `svc-${port}`, port, cwd: '/Users/x/secret-path', label: 'Server', workspace }
}
function proc(workspace: WorkspaceRef | null, name: string) {
  nextPid++
  return { id: `p${nextPid}`, pid: nextPid, name, cwd: '/Users/x/secret-path', workspace }
}

const MAIN = ws('ws_main')
const WT = ws('ws_wt', { kind: 'git-worktree', branch: 'tmp/2dg-verify', name: 'wt-2dg' })
const LS = ws('ws_ls', { name: 'LocalScope', branch: 'feat/development-sessions', repository: { id: 'repo_ls', name: 'LocalScope' } })
const PLAIN = ws('ws_plain', { kind: 'plain', branch: '', name: 'plain-2dg', repository: null })

function scenario() {
  servicesState = list([svc(MAIN, 5173), svc(MAIN, 13120), svc(WT, 5195), svc(LS, 7317), svc(PLAIN, 5194), svc(null, 9999)])
  processesState = list([proc(MAIN, 'node'), proc(MAIN, 'pnpm'), proc(WT, 'Python'), proc(PLAIN, 'Python'), proc(null, 'adb'), proc(null, 'qemu')])
  return [agent(MAIN), agent(LS, 'LocalScope'), agent(null, 'Agent-Dashboard')]
}

const mountTree = (agents: Agent[]) => mount(RuntimeTopologyTree, { props: { agents } })

function workspaceNode(w: ReturnType<typeof mountTree>, id: string) {
  return w.get(`[data-testid="topology-workspace"][data-workspace-id="${id}"]`)
}

beforeEach(() => {
  servicesCalls = 0
  vi.stubGlobal('localStorage', memoryStorage())
})
afterEach(() => vi.unstubAllGlobals())

describe('runtimeTopologyTree', () => {
  it('shows one Agent-Dashboard repository with two workspaces', () => {
    const w = mountTree(scenario())
    const repos = w.findAll('[data-testid="topology-repository"]')
    expect(repos.map(r => r.attributes('data-repository-id'))).toEqual(['repo_ad', 'repo_ls'])

    const ad = repos[0]
    expect(ad.findAll('[data-testid="topology-workspace"]').map(n => n.attributes('data-workspace-id'))).toEqual(['ws_main', 'ws_wt'])
    expect(ad.get('[data-testid="topology-workspace-count"]').text()).toBe('2 workspaces')
  })

  it('keeps a single-workspace repository compact but still shows its workspace', () => {
    const w = mountTree(scenario())
    const ls = w.findAll('[data-testid="topology-repository"]')[1]
    expect(ls.find('[data-testid="topology-workspace-count"]').exists()).toBe(false)
    expect(ls.findAll('[data-testid="topology-workspace"]')).toHaveLength(1)
  })

  it('never leaks services or processes across workspaces of one repository', () => {
    const w = mountTree(scenario())
    const mainNode = workspaceNode(w, 'ws_main')
    const wtNode = workspaceNode(w, 'ws_wt')

    expect(mainNode.get('[data-testid="topology-services"]').text()).toContain(':5173 :13120')
    expect(mainNode.text()).not.toContain(':5195')
    expect(mainNode.get('[data-testid="topology-processes"]').text()).toContain('2 — node, pnpm')

    expect(wtNode.get('[data-testid="topology-services"]').text()).toContain(':5195')
    expect(wtNode.text()).not.toContain(':5173')
    expect(wtNode.get('[data-testid="topology-processes"]').text()).toContain('1 — Python')
    expect(wtNode.find('[data-testid="topology-no-agents"]').exists()).toBe(true)
  })

  it('describes a worktree in words, with its directory name', () => {
    const header = workspaceNode(mountTree(scenario()), 'ws_wt').get('p').text()
    expect(header).toContain('Workspace')
    expect(header).toContain('tmp/2dg-verify')
    expect(header).toContain('worktree')
    expect(header).toContain('wt-2dg')
  })

  it('says Detached HEAD and Branch unknown rather than showing a missing branch', () => {
    servicesState = list([])
    processesState = list([])
    const w = mountTree([
      agent(ws('ws_det', { kind: 'git-worktree', branch: '', detached: true, name: 'probe' })),
      agent(ws('ws_unk', { branch: '' })),
    ])
    expect(workspaceNode(w, 'ws_det').text()).toContain('Detached HEAD')
    expect(workspaceNode(w, 'ws_unk').text()).toContain('Branch unknown')
  })

  it('shows a plain workspace under Local workspaces, not as a repository', () => {
    const w = mountTree(scenario())
    const local = w.get('[data-testid="topology-local"]')
    expect(local.text()).toContain('not in a Git repository')
    const node = local.get('[data-testid="topology-workspace"]')
    expect(node.attributes('data-workspace-kind')).toBe('plain')
    expect(node.text()).toContain('Local workspace')
    expect(node.text()).toContain('plain-2dg')
    expect(node.text()).toContain(':5194')
    expect(w.findAll('[data-testid="topology-repository"]').map(r => r.attributes('data-repository-id'))).not.toContain(undefined)
  })

  it('lists unresolved agents and counts unattributed observations, neutrally', () => {
    const w = mountTree(scenario())
    const unresolved = w.get('[data-testid="topology-unresolved"]')
    expect(unresolved.text()).toContain('Workspace unknown')
    expect(unresolved.findAll('[data-testid="topology-unresolved-agent"]')).toHaveLength(1)
    expect(unresolved.get('[data-testid="topology-unresolved-processes"]').text()).toContain('2 processes could not be attributed')
    expect(unresolved.get('[data-testid="topology-unresolved-services"]').text()).toContain('1 service could not be attributed')
    expect(unresolved.html()).not.toMatch(/danger|state-error/)
    // The unresolved agent shares a repository's name and is still not in it.
    expect(w.findAll('[data-testid="topology-repository"]')[0].findAll('[data-testid="topology-agent"]')).toHaveLength(1)
  })

  it('names every node type in words, not colour', () => {
    const text = mountTree(scenario()).text()
    for (const word of ['Repository', 'Workspace', 'Agent', 'Processes', 'Services', 'Local workspace', 'Workspace unknown'])
      expect(text).toContain(word)
  })

  it('shows no filesystem path', () => {
    const html = mountTree(scenario()).html()
    expect(html).not.toContain('/Users/x')
    expect(html).not.toContain('.git')
  })

  it('does not present unreported lists as empty ones', () => {
    servicesState = list(null)
    processesState = list(null)
    const w = mountTree([agent(MAIN)])
    expect(w.find('[data-testid="topology-services-unavailable"]').exists()).toBe(true)
    expect(w.find('[data-testid="topology-processes-unavailable"]').exists()).toBe(true)
    const node = workspaceNode(w, 'ws_main')
    expect(node.find('[data-testid="topology-services"]').exists()).toBe(false)
    expect(node.find('[data-testid="topology-processes"]').exists()).toBe(false)
    expect(w.find('[data-testid="topology-unresolved"]').exists()).toBe(false)
    // Agents are still placed — their identity does not depend on LocalScope.
    expect(node.findAll('[data-testid="topology-agent"]')).toHaveLength(1)
  })

  it('shows a stale service list as stale', () => {
    servicesState = list([svc(MAIN, 5173)], { source: 'stale', ageMs: 180_000 })
    processesState = list([])
    const w = mountTree([agent(MAIN)])
    expect(w.get('[data-testid="topology-services-freshness"]').text()).toContain('stale · 3m ago')
  })

  it('says nothing was observed rather than drawing an empty frame', () => {
    servicesState = list([])
    processesState = list([])
    expect(mountTree([]).find('[data-testid="topology-empty"]').exists()).toBe(true)
  })

  it('has no axe violations', async () => {
    const w = mount(RuntimeTopologyTree, { props: { agents: scenario() }, attachTo: document.body })
    expect(await axe(w.element as Element)).toHaveNoViolations()
    w.unmount()
  })
})

describe('runtimeTopology — the collapsible section', () => {
  it('does not poll the lists while collapsed, and remembers the choice', async () => {
    localStorage.setItem('system-map-topology-expanded', 'false')
    scenario()
    const w = mount(RuntimeTopology, { props: { agents: [] } })
    const toggle = w.get('[data-testid="runtime-topology-toggle"]')

    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(w.find('[data-testid="runtime-topology-tree"]').exists()).toBe(false)
    expect(servicesCalls).toBe(0)

    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(w.find('[data-testid="runtime-topology-tree"]').exists()).toBe(true)
    expect(servicesCalls).toBe(1)
    expect(localStorage.getItem('system-map-topology-expanded')).toBe('true')
  })

  it('is collapsed on first use, mounts no list consumer, and labels its toggle as a heading', () => {
    scenario()
    const w = mount(RuntimeTopology, { props: { agents: [] } })
    expect(w.get('[data-testid="runtime-topology-toggle"]').attributes('aria-expanded')).toBe('false')
    expect(w.find('[data-testid="runtime-topology-tree"]').exists()).toBe(false)
    expect(servicesCalls).toBe(0)
    expect(w.get('h3').text()).toContain('Runtime topology')
    // Reading the preference never writes one.
    expect(localStorage.getItem('system-map-topology-expanded')).toBeNull()
  })

  /*
   * Membership is unchanged by the default: once expanded, the map still shows
   * the whole observed machine — including repositories with no agent at all,
   * plain workspaces and unresolved observations.
   */
  it('opens from a stored expanded preference with every observed workspace present', () => {
    localStorage.setItem('system-map-topology-expanded', 'true')
    const agents = scenario()
    const orphanWs = ws('ws_orphan', { name: 'NOBI', branch: 'main', repository: { id: 'repo_orphan', name: 'NOBI' } })
    servicesState = list([...servicesState.items, svc(orphanWs, 5183)])

    const w = mount(RuntimeTopology, { props: { agents } })
    expect(w.get('[data-testid="runtime-topology-toggle"]').attributes('aria-expanded')).toBe('true')

    const orphan = w.findAll('[data-testid="topology-repository"]')
      .find(r => r.attributes('data-repository-id') === 'repo_orphan')
    expect(orphan).toBeTruthy()
    expect(orphan!.find('[data-testid="topology-no-agents"]').exists()).toBe(true)
    expect(orphan!.text()).toContain(':5183')
    expect(w.find('[data-testid="topology-local"]').exists()).toBe(true)
    expect(w.find('[data-testid="topology-unresolved"]').exists()).toBe(true)
    // The stored choice is read, not rewritten.
    expect(localStorage.getItem('system-map-topology-expanded')).toBe('true')
  })
})

describe('runtime topology — agent names (3I)', () => {
  it('names agents canonically, never by folder name', () => {
    const named = { ...agent({ id: 'ws_n', name: 'n', kind: 'git-main', branch: 'main', repository: { id: 'repo_n', name: 'repo-n' } }, 'secret-folder'), provider: 'claude', sessionId: '3f2a1b9c-0000' } as Agent
    const orphan = { ...agent(null, 'other-secret-folder'), provider: 'codex', sessionId: '9c01d2e4-0000' } as Agent
    const w = mountTree([named, orphan])
    expect(w.get('[data-testid="topology-agent"]').text()).toContain('Claude session 3f2a1b9c')
    expect(w.get('[data-testid="topology-unresolved-agent"]').text()).toContain('Codex session 9c01d2e4')
    expect(w.html()).not.toMatch(/secret[- ]folder/i)
  })
})

describe('runtimeTopologyTree — visualization (3N)', () => {
  it('summarises what the tree holds, by identity', () => {
    const w = mountTree(scenario())
    expect(w.get('[data-testid="topology-summary"]').text()).toBe('2 repositories · 4 workspaces · 3 agents · 6 processes · 6 services')
  })

  it('never sums an unreported list as zero', () => {
    const agents = scenario()
    servicesState = list(null)
    processesState = list(null)
    const text = mountTree(agents).get('[data-testid="topology-summary"]').text()
    expect(text).toBe('2 repositories · 2 workspaces · 3 agents')
    expect(text).not.toMatch(/process|service/)
  })

  it('marks agents with their category glyph, and draws node types with their own marks', () => {
    const w = mountTree(scenario())
    const node = workspaceNode(w, 'ws_main')
    expect(node.get('[data-testid="topology-agent"] [data-testid="agent-glyph"]').attributes('aria-label')).toBe('General agent')
    expect(node.get('[data-testid="topology-processes"] svg').attributes('aria-hidden')).toBe('true')
    expect(node.get('[data-testid="topology-services"] svg').attributes('aria-hidden')).toBe('true')
  })

  it('is still while agent updates are not live, even with working agents', () => {
    const agents = scenario().map(a => ({ ...a, working: true }) as Agent)
    expect(mountTree(agents).html()).not.toMatch(/motion-|animate-/)
  })

  // 3N.2: flow only where real work is happening, and only on current evidence.
  it('flows only along a workspace with a working agent while updates are live and LocalScope is current', () => {
    const [main, ls, unresolved] = scenario()
    const w = mount(RuntimeTopologyTree, { props: { agents: [{ ...main, working: true } as Agent, ls, unresolved], live: true } })
    expect(workspaceNode(w, 'ws_main').get('ul').attributes('data-flowing')).toBe('true')
    expect(workspaceNode(w, 'ws_main').get('ul').classes()).toContain('motion-rail')
    expect(workspaceNode(w, 'ws_ls').get('ul').classes()).not.toContain('motion-rail')
    expect(workspaceNode(w, 'ws_wt').get('ul').classes()).not.toContain('motion-rail')
  })

  it('stops flowing when LocalScope\'s reading is stale', () => {
    const [main] = scenario()
    servicesState = list([svc(MAIN, 5173)], { source: 'stale', ageMs: 180_000 })
    const w = mount(RuntimeTopologyTree, { props: { agents: [{ ...main, working: true } as Agent], live: true } })
    expect(w.html()).not.toMatch(/motion-/)
  })
})
