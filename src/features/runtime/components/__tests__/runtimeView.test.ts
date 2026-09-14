import type { Agent, WorkspaceRef } from '@/types'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { useRuntimeSection } from '@/composables/useRuntimeSection'
import { RUNTIME_SECTIONS } from '@/utils/runtimeSections'
import { axe } from '@/utils/testA11y'
import RuntimeView from '../RuntimeView.vue'

/*
 * The Runtime page (3K): one destination replacing LocalScope and System, with
 * local section navigation, a source line that claims nothing beyond
 * LocalScope's own reading, and the topology as its Workspaces section.
 */

vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn() } })

const state = vi.hoisted(() => ({
  snapshot: null as any,
  loaded: true,
  services: null as any,
  processes: null as any,
  devices: null as any,
  agents: [] as any[],
}))

vi.mock('@/features/localscope', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/features/localscope')>()
  const { ref } = await import('vue')
  return {
    ...real,
    useLocalMachine: () => ({ snapshot: ref(state.snapshot), loaded: ref(state.loaded), refetch: async () => {} }),
    useMachineServices: () => ({ data: ref(state.services), loaded: ref(true), refetch: async () => {} }),
    useMachineProcesses: () => ({ data: ref(state.processes), loaded: ref(true), refetch: async () => {} }),
    useMachineDevices: () => ({ data: ref(state.devices), loaded: ref(true), refetch: async () => {} }),
    scanAllProcesses: vi.fn(),
  }
})
vi.mock('@/composables/useSystemResources', async () => {
  const { ref } = await import('vue')
  return {
    useSystemResources: () => ({
      info: ref({ cpu: { usage: 10, cores: 8, model: 'M1' }, memory: { usagePercent: 40, used: 1, total: 2, available: 1 }, disk: { usagePercent: 40, used: 1, total: 2, available: 1, mount: '/' }, loadAvg: [1], uptime: 60 }),
      error: ref(null),
      refetch: async () => {},
    }),
  }
})
vi.mock('@/composables/useBuildVersion', async () => {
  const { ref } = await import('vue')
  return { useBuildVersion: () => ({ version: ref('dev') }) }
})
vi.mock('@/features/agents', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>()
  const { ref } = await import('vue')
  return { ...real, useAgents: () => ({ agents: ref(state.agents), lastUpdatedAt: ref(1) }) }
})

const SECRET = '/Users/x/secret-path'
const COUNTS = { services: 3, processesRelevant: 2, processesTotal: 800, devices: 0, network: 12, projects: 2 }

function reading(over: Record<string, unknown> = {}) {
  return { source: 'ok', collectedAt: '2026-09-14T00:00:00Z', ageMs: 900, degraded: [], ...over }
}

function ws(id: string, repoId: string, over: Partial<WorkspaceRef> = {}): WorkspaceRef {
  return { id, name: 'app', kind: 'git-main', branch: 'main', repository: { id: repoId, name: 'app' }, ...over } as WorkspaceRef
}

// Two repositories that share the name "app", and a worktree of the first.
const A_MAIN = ws('ws_a_main', 'repo_a')
const A_WT = ws('ws_a_wt', 'repo_a', { kind: 'git-worktree', branch: 'fix/x', name: 'app-wt' })
const B_MAIN = ws('ws_b_main', 'repo_b')

function svc(workspace: WorkspaceRef | null, port: number) {
  return { id: `svc-${port}`, pid: port, port, address: '127.0.0.1', protocol: 'tcp', bindScope: 'loopback', ipVersion: 'ipv4', processName: 'node', command: `node server.js --port ${port}`, cwd: SECRET, runtime: 'node', kind: 'http', label: 'Server', url: null, discoveredProject: null, confidence: 'high', startedAt: null, workspace }
}
function proc(workspace: WorkspaceRef | null, id: string, name: string) {
  return { id, pid: 1, ppid: 1, name, command: `${name} --flag`, cwd: SECRET, runtime: 'node', cpuPercent: null, memoryBytes: null, elapsedSeconds: null, startedAt: null, ports: [], relevanceReasons: [], discoveredProject: null, workspace }
}
function agent(sessionId: string, workspace: WorkspaceRef | null): Agent {
  return { sessionId, pid: 7, status: 'active', working: false, model: 'claude-opus-5', projectName: 'app', cwd: SECRET, workspace } as unknown as Agent
}

beforeEach(() => {
  state.snapshot = reading({ counts: COUNTS })
  state.loaded = true
  state.services = reading({ items: [svc(A_MAIN, 5173), svc(A_WT, 5195), svc(B_MAIN, 3000), svc(null, 9999)] })
  state.processes = reading({ items: [proc(A_MAIN, 'p1', 'vite'), proc(null, 'p2', 'adb')], total: 800 })
  state.devices = reading({ items: [], connected: 0 })
  state.agents = [agent('s-a', A_MAIN), agent('s-b', B_MAIN), agent('s-u', null)]
  useRuntimeSection().activeSection.value = 'overview'
})

afterEach(() => {
  document.body.innerHTML = ''
})

const source = (w: ReturnType<typeof mount>) => w.get('[data-testid="runtime-source"]')

describe('runtime page — local navigation', () => {
  it('offers the five sections, one of them current, and no LocalScope or System tab', () => {
    const w = mount(RuntimeView)
    const nav = w.get('nav[aria-label="Runtime sections"]')
    const buttons = nav.findAll('button')
    expect(buttons.map(b => b.text())).toEqual(['Overview', 'Workspaces', 'Services', 'Processes', 'Devices'])
    expect(buttons.filter(b => b.attributes('aria-current') === 'page').map(b => b.text())).toEqual(['Overview'])
    expect(nav.text()).not.toMatch(/LocalScope|System|Network/)
  })

  it('switches section on click, and remembers it', async () => {
    const w = mount(RuntimeView)
    await w.get('[data-testid="runtime-nav-services"]').trigger('click')
    expect(w.get('[data-testid="runtime-content"]').attributes('data-section')).toBe('services')
    expect(w.find('[data-testid="runtime-services"]').exists()).toBe(true)
    expect(w.find('[data-testid="runtime-overview"]').exists()).toBe(false)
    expect(w.get('[data-testid="runtime-nav-services"]').attributes('aria-current')).toBe('page')
    expect(localStorage.getItem('runtime-active-section')).toBe('services')
  })

  it('moves between sections with the arrow keys, Home and End', async () => {
    const w = mount(RuntimeView, { attachTo: document.body })
    const list = w.get('nav ul')
    const button = (id: string) => w.get(`[data-testid="runtime-nav-${id}"]`).element as HTMLButtonElement
    button('overview').focus()
    await list.trigger('keydown', { key: 'ArrowRight' })
    expect(document.activeElement).toBe(button('workspaces'))
    await list.trigger('keydown', { key: 'End' })
    expect(document.activeElement).toBe(button('devices'))
    await list.trigger('keydown', { key: 'ArrowRight' })
    expect(document.activeElement).toBe(button('overview'))
    await list.trigger('keydown', { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(button('devices'))
    await list.trigger('keydown', { key: 'Home' })
    expect(document.activeElement).toBe(button('overview'))
    w.unmount()
  })

  it('gives every section exactly one h2, and leaves the h1 to the topbar', async () => {
    const w = mount(RuntimeView)
    for (const s of RUNTIME_SECTIONS) {
      useRuntimeSection().activeSection.value = s.id
      await nextTick()
      const content = w.get('[data-testid="runtime-content"]')
      expect(content.findAll('h2'), s.id).toHaveLength(1)
      expect(w.findAll('h1'), s.id).toHaveLength(0)
    }
  })

  // Q: a narrow window scrolls the section tabs inside themselves, never the page.
  it('contains its own overflow', () => {
    const w = mount(RuntimeView)
    expect(w.get('[data-testid="runtime-page"]').classes()).toContain('min-w-0')
    expect(w.get('[data-testid="runtime-nav"]').classes()).toEqual(expect.arrayContaining(['overflow-x-auto', 'min-w-0', 'max-w-full']))
  })
})

describe('runtime page — LocalScope source line', () => {
  it('is connecting before the first answer', () => {
    state.loaded = false
    state.snapshot = reading({ source: 'unavailable' })
    expect(source(mount(RuntimeView)).attributes('data-state')).toBe('connecting')
  })

  it('is live, in the live colour, for a current reading', () => {
    const s = source(mount(RuntimeView))
    expect(s.attributes('data-state')).toBe('live')
    expect(s.text()).toContain('LocalScope live')
    expect(s.find('.bg-live-dot').exists()).toBe(true)
    expect(s.find('[data-testid="runtime-source-freshness"]').exists()).toBe(false)
  })

  it('is live but partial when a source had trouble, and names it', () => {
    state.snapshot = reading({ source: 'degraded', degraded: [{ source: 'adb', reason: 'x', kind: 'missing' }], counts: COUNTS })
    const s = source(mount(RuntimeView))
    expect(s.attributes('data-state')).toBe('live')
    expect(s.get('[data-testid="runtime-source-freshness"]').text()).toContain('partial · adb')
  })

  it('is stale, with the reading\'s age and no live colour', () => {
    state.snapshot = reading({ source: 'stale', ageMs: 185_000, counts: COUNTS })
    const s = source(mount(RuntimeView))
    expect(s.attributes('data-state')).toBe('stale')
    expect(s.text()).toContain('not responding')
    expect(s.text()).toContain('3m ago')
    expect(s.find('.bg-live-dot').exists()).toBe(false)
  })

  it('is not connected when nothing was observed', () => {
    state.snapshot = reading({ source: 'unavailable', collectedAt: null, ageMs: null })
    const s = source(mount(RuntimeView))
    expect(s.attributes('data-state')).toBe('unavailable')
    expect(s.text()).toContain('LocalScope not connected')
    expect(s.find('.bg-live-dot').exists()).toBe(false)
  })

  it('never claims anything about the machine\'s health', () => {
    for (const snap of [reading({ counts: COUNTS }), reading({ source: 'stale', ageMs: 5000, counts: COUNTS }), reading({ source: 'unavailable', counts: COUNTS })]) {
      state.snapshot = snap
      expect(source(mount(RuntimeView)).text()).not.toMatch(/healthy|all systems|system online|no issues/i)
    }
  })
})

describe('runtime page — Workspaces section, identity only', () => {
  beforeEach(() => {
    useRuntimeSection().activeSection.value = 'workspaces'
  })

  // D + E
  it('draws two same-name repositories as two repositories, by opaque id', () => {
    const w = mount(RuntimeView)
    const repos = w.findAll('[data-testid="topology-repository"]')
    expect(repos.map(r => r.attributes('data-repository-id')).sort()).toEqual(['repo_a', 'repo_b'])
    const b = repos.find(r => r.attributes('data-repository-id') === 'repo_b')!
    expect(b.findAll('[data-testid="topology-workspace"]').map(n => n.attributes('data-workspace-id'))).toEqual(['ws_b_main'])
    expect(b.text()).toContain(':3000')
    expect(b.text()).not.toContain(':5173')
  })

  // F
  it('keeps a worktree its own workspace, with its own services', () => {
    const w = mount(RuntimeView)
    const a = w.findAll('[data-testid="topology-repository"]').find(r => r.attributes('data-repository-id') === 'repo_a')!
    const nodes = a.findAll('[data-testid="topology-workspace"]')
    expect(nodes.map(n => n.attributes('data-workspace-id'))).toEqual(['ws_a_main', 'ws_a_wt'])
    expect(nodes[0].text()).toContain(':5173')
    expect(nodes[0].text()).not.toContain(':5195')
    expect(nodes[1].text()).toContain(':5195')
    expect(nodes[1].text()).toContain('worktree')
  })

  // G
  it('lists what has no workspace identity as Workspace unknown, attached nowhere', () => {
    const w = mount(RuntimeView)
    const unresolved = w.get('[data-testid="topology-unresolved"]')
    expect(unresolved.text()).toContain('Workspace unknown')
    expect(unresolved.get('[data-testid="topology-unresolved-services"]').text()).toContain('1 service')
    expect(unresolved.get('[data-testid="topology-unresolved-processes"]').text()).toContain('1 process')
    expect(unresolved.findAll('[data-testid="topology-unresolved-agent"]')).toHaveLength(1)
    expect(w.text()).not.toContain(':9999')
  })

  it('draws ports as pills and agents with a still state dot', () => {
    const w = mount(RuntimeView)
    expect(w.findAll('[data-testid="topology-port"]').map(p => p.text()).sort()).toEqual([':3000', ':5173', ':5195'])
    const agentItem = w.findAll('[data-testid="topology-agent"]')[0]
    const dot = agentItem.get('[aria-hidden="true"].rounded-full')
    expect(dot.classes()).toContain('bg-state-success')
    expect(dot.classes().some(c => c.startsWith('motion-'))).toBe(false)
  })
})

describe('runtime page — privacy and accessibility', () => {
  // H: across every section, nothing path- or command-shaped by default.
  it('shows no cwd or command line on any section by default', async () => {
    const w = mount(RuntimeView)
    for (const s of RUNTIME_SECTIONS) {
      useRuntimeSection().activeSection.value = s.id
      await nextTick()
      const html = w.html()
      expect(html, s.id).not.toContain(SECRET)
      expect(html, s.id).not.toContain('--flag')
      expect(html, s.id).not.toContain('server.js')
    }
  })

  // R
  it('has no axe violations on any section', async () => {
    const w = mount(RuntimeView, { attachTo: document.body })
    for (const s of RUNTIME_SECTIONS) {
      useRuntimeSection().activeSection.value = s.id
      await nextTick()
      expect(await axe(w.element as Element), s.id).toHaveNoViolations()
    }
    w.unmount()
  })
})
