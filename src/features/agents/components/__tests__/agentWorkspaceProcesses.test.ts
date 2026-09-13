import type { Agent, WorkspaceRef } from '@/types'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

let state: { source: string, items: any[] | null, ageMs?: number | null, degraded?: any[] }

function ws(id: string, over: Partial<WorkspaceRef> = {}): WorkspaceRef {
  return { id, name: 'Repo', kind: 'git-main', branch: 'main', repository: { id: 'repo_x', name: 'Repo' }, ...over } as WorkspaceRef
}

function proc(over: Record<string, unknown> = {}) {
  return {
    id: '1',
    pid: 1,
    ppid: 0,
    name: 'node',
    command: 'node index.js --token=SECRETVALUE',
    cwd: '/Users/someone/Documents/GitHub/Repo',
    runtime: 'node',
    cpuPercent: null,
    memoryBytes: null,
    elapsedSeconds: null,
    startedAt: null,
    ports: [],
    relevanceReasons: [],
    discoveredProject: null,
    workspace: null,
    ...over,
  }
}

async function mountSection(agent: Agent, s: typeof state) {
  state = s
  vi.resetModules()
  vi.doMock('@/features/localscope', async () => {
    // The real indicator: the point of the freshness row is what it renders.
    const DataFreshnessIndicator = (await import('@/features/localscope/components/DataFreshnessIndicator.vue')).default
    return {
      DataFreshnessIndicator,
      EMPTY_PROCESSES: { source: 'unavailable', collectedAt: null, ageMs: null, degraded: [], items: null, total: null },
      useMachineProcesses: () => ({
        data: {
          value: {
            source: state.source,
            collectedAt: null,
            ageMs: state.ageMs ?? null,
            degraded: state.degraded ?? [],
            items: state.items,
            total: null,
          },
        },
        loaded: { value: true },
        refetch: async () => {},
      }),
    }
  })
  const C = (await import('../AgentWorkspaceProcesses.vue')).default
  return mount(C, { props: { agent } })
}

function agentIn(w: WorkspaceRef | null): Agent {
  return { cwd: '/x', sessionId: 's', projectName: 'Repo', workspace: w } as Agent
}

describe('agentWorkspaceProcesses', () => {
  it('lists the processes in this workspace', async () => {
    const w = await mountSection(agentIn(ws('ws_a')), {
      source: 'ok',
      items: [
        proc({ id: '1', pid: 4242, name: 'vite', workspace: ws('ws_a') }),
        proc({ id: '2', pid: 9999, name: 'other', workspace: ws('ws_b') }),
      ],
    })
    expect(w.find('[data-testid="workspace-process-4242"]').exists()).toBe(true)
    expect(w.find('[data-testid="workspace-process-9999"]').exists()).toBe(false)
    expect(w.text()).toContain('vite')
  })

  it('shows metrics only when ps reported them', async () => {
    const w = await mountSection(agentIn(ws('ws_a')), {
      source: 'ok',
      items: [
        proc({ id: '1', pid: 1, cpuPercent: 12.4, memoryBytes: 104857600, ports: [5173], workspace: ws('ws_a') }),
        proc({ id: '2', pid: 2, cpuPercent: null, memoryBytes: null, workspace: ws('ws_a') }),
      ],
    })
    const first = w.get('[data-testid="workspace-process-1"]').text()
    expect(first).toContain('12% cpu')
    expect(first).toContain('100 MB')
    expect(first).toContain(':5173')
    // Absent metrics are omitted, never rendered as 0.
    const second = w.get('[data-testid="workspace-process-2"]').text()
    expect(second).not.toContain('cpu')
    expect(second).not.toContain('MB')
    expect(second).not.toContain('0%')
  })

  /* Zero, unknown and unavailable are three different sentences. */
  it('states a genuine zero', async () => {
    const w = await mountSection(agentIn(ws('ws_a')), { source: 'ok', items: [proc({ workspace: ws('ws_b') })] })
    expect(w.find('[data-testid="workspace-processes-none"]').exists()).toBe(true)
    expect(w.text()).toContain('No developer processes observed in this workspace')
  })

  it('says identity is unavailable rather than implying none', async () => {
    const w = await mountSection(agentIn(null), { source: 'ok', items: [proc({ workspace: ws('ws_a') })] })
    expect(w.find('[data-testid="workspace-processes-identity-unknown"]').exists()).toBe(true)
    expect(w.find('[data-testid="workspace-processes-none"]').exists()).toBe(false)
    expect(w.text()).toContain('Workspace identity unavailable')
  })

  it('does not present an unavailable list as an empty one', async () => {
    const w = await mountSection(agentIn(ws('ws_a')), { source: 'unavailable', items: null })
    expect(w.find('[data-testid="workspace-processes-unavailable"]').exists()).toBe(true)
    expect(w.find('[data-testid="workspace-processes-none"]').exists()).toBe(false)
    expect(w.text()).not.toContain('No developer processes')
  })

  it('keeps a stale list and shows it as stale', async () => {
    const w = await mountSection(agentIn(ws('ws_a')), {
      source: 'stale',
      ageMs: 180_000,
      items: [proc({ pid: 7, workspace: ws('ws_a') })],
    })
    expect(w.find('[data-testid="workspace-process-7"]').exists()).toBe(true)
    const fresh = w.get('[data-testid="workspace-processes-freshness"]')
    expect(fresh.text()).toContain('stale')
    expect(fresh.text()).toContain('3m ago')
  })

  it('shows machine degradation without reinterpreting it', async () => {
    const w = await mountSection(agentIn(ws('ws_a')), {
      source: 'degraded',
      items: [proc({ workspace: ws('ws_a') })],
      degraded: [{ source: 'ps', reason: 'x', kind: 'partial' }],
    })
    expect(w.get('[data-testid="workspace-processes-freshness"]').text()).toContain('partial · ps')
  })

  it('notes observations nothing could attribute, without attaching them', async () => {
    const w = await mountSection(agentIn(ws('ws_a')), {
      source: 'ok',
      items: [
        proc({ id: '1', pid: 1, workspace: ws('ws_a') }),
        proc({ id: '2', pid: 2, cwd: null, workspace: null }),
      ],
    })
    expect(w.find('[data-testid="workspace-process-2"]').exists()).toBe(false)
    expect(w.get('[data-testid="workspace-processes-unattributed"]').text()).toContain('1 observed process')
  })

  /*
   * The privacy rule for this section: the workspace is already established by
   * being here, so no path is repeated per row, and the command — the field
   * most likely to carry a token — is not rendered at all.
   */
  it('exposes no path and no command line', async () => {
    const w = await mountSection(agentIn(ws('ws_a')), {
      source: 'ok',
      items: [proc({ pid: 1, workspace: ws('ws_a') })],
    })
    const html = w.html()
    expect(html).not.toContain('/Users/someone')
    expect(html).not.toContain('SECRETVALUE')
    expect(html).not.toContain('node index.js')
  })
})
