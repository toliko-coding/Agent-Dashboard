import type { Agent, WorkspaceRef } from '@/types'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'

/*
 * Process attribution. The rule is identical to services by design — a reader
 * should not have to learn that "none" means something different one section
 * further down the panel.
 */

let state: { source: string, items: any[] | null, ageMs?: number | null, degraded?: any[] }

vi.mock('@/features/localscope', () => ({
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
}))

function ws(id: string, over: Partial<WorkspaceRef> = {}): WorkspaceRef {
  return {
    id,
    name: 'Repo',
    kind: 'git-main',
    branch: 'main',
    repository: { id: 'repo_shared', name: 'Repo' },
    ...over,
  } as WorkspaceRef
}

function proc(over: Record<string, unknown> = {}) {
  return {
    id: '1',
    pid: 1,
    ppid: 0,
    name: 'node',
    command: 'node index.js',
    cwd: null,
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

function agentIn(workspace: WorkspaceRef | null): Agent {
  return { cwd: '/x', sessionId: 's', projectName: 'Repo', workspace } as Agent
}

async function attribute(agent: Agent, s: typeof state) {
  state = s
  vi.resetModules()
  const { useAgentProcesses } = await import('../useAgentProcesses')
  let result!: ReturnType<typeof useAgentProcesses>
  const C = defineComponent({
    setup() {
      result = useAgentProcesses(() => agent)
      return () => null
    },
  })
  const w = mount(C)
  return { result, w }
}

const ok = (items: any[] | null) => ({ source: 'ok', items })

describe('useAgentProcesses', () => {
  it('matches processes in the same workspace', async () => {
    const { result, w } = await attribute(agentIn(ws('ws_a')), ok([
      proc({ id: '1', pid: 1, workspace: ws('ws_a') }),
      proc({ id: '2', pid: 2, workspace: ws('ws_a') }),
      proc({ id: '3', pid: 3, workspace: ws('ws_b') }),
    ]))
    expect(result.attribution.value).toBe('resolved')
    expect(result.processes.value.map(p => p.pid)).toEqual([1, 2])
    w.unmount()
  })

  it('does not match a different workspace', async () => {
    const { result, w } = await attribute(agentIn(ws('ws_a')), ok([proc({ workspace: ws('ws_b') })]))
    expect(result.processes.value).toEqual([])
    w.unmount()
  })

  // Two worktrees share a repository; that must not attribute anything.
  it('does not match on repository id', async () => {
    const a = ws('ws_a', { kind: 'git-worktree', branch: 'feat/a' })
    const b = ws('ws_b', { kind: 'git-worktree', branch: 'feat/b' })
    expect(a.repository!.id).toBe(b.repository!.id)
    const { result, w } = await attribute(agentIn(a), ok([proc({ workspace: b })]))
    expect(result.processes.value).toEqual([])
    w.unmount()
  })

  it('does not attach an unresolved process, and counts it instead', async () => {
    const { result, w } = await attribute(agentIn(ws('ws_a')), ok([
      proc({ id: '1', pid: 1, workspace: ws('ws_a') }),
      proc({ id: '2', pid: 2, cwd: null, workspace: null }),
    ]))
    expect(result.processes.value.map(p => p.pid)).toEqual([1])
    expect(result.unresolvedCount.value).toBe(1)
    w.unmount()
  })

  it('reports agent-unresolved when the agent has no identity', async () => {
    const { result, w } = await attribute(agentIn(null), ok([proc({ workspace: ws('ws_a') })]))
    expect(result.attribution.value).toBe('agent-unresolved')
    expect(result.processes.value).toEqual([])
    w.unmount()
  })

  it('never matches on cwd containment', async () => {
    const { result, w } = await attribute(agentIn(ws('ws_a')), ok([
      proc({ cwd: '/x/nested/deeper', workspace: ws('ws_other') }),
    ]))
    expect(result.processes.value).toEqual([])
    w.unmount()
  })

  // --- freshness passes through untouched ---

  it('keeps a stale list, and reports it as stale', async () => {
    const { result, w } = await attribute(agentIn(ws('ws_a')), {
      source: 'stale',
      ageMs: 180_000,
      items: [proc({ workspace: ws('ws_a') })],
    })
    expect(result.attribution.value).toBe('resolved')
    expect(result.processes.value).toHaveLength(1)
    expect(result.reading.value.source).toBe('stale')
    expect(result.reading.value.ageMs).toBe(180_000)
    w.unmount()
  })

  it('does not present an unavailable list as an empty one', async () => {
    const { result, w } = await attribute(agentIn(ws('ws_a')), { source: 'unavailable', items: null })
    expect(result.attribution.value).toBe('source-unavailable')
    expect(result.reading.value.items).toBeNull()
    w.unmount()
  })

  it('passes degradation through without reinterpreting it', async () => {
    const degraded = [{ source: 'ps', reason: 'x', kind: 'partial' }]
    const { result, w } = await attribute(agentIn(ws('ws_a')), {
      source: 'degraded',
      items: [proc({ workspace: ws('ws_a') })],
      degraded,
    })
    expect(result.reading.value.degraded).toEqual(degraded)
    expect(result.processes.value).toHaveLength(1)
    w.unmount()
  })

  it('treats a malformed list as not known rather than as data', async () => {
    const { result, w } = await attribute(agentIn(ws('ws_a')), { source: 'ok', items: 'nonsense' as any })
    expect(result.attribution.value).toBe('source-unavailable')
    w.unmount()
  })

  // --- nullable fields survive the pipeline ---

  it('preserves nullable cpu and memory rather than defaulting them to zero', async () => {
    const { result, w } = await attribute(agentIn(ws('ws_a')), ok([
      proc({ id: '1', pid: 1, cpuPercent: null, memoryBytes: null, workspace: ws('ws_a') }),
      proc({ id: '2', pid: 2, cpuPercent: 12.5, memoryBytes: 104857600, workspace: ws('ws_a') }),
    ]))
    const [a, b] = result.processes.value
    expect(a.cpuPercent).toBeNull()
    expect(a.memoryBytes).toBeNull()
    expect(b.cpuPercent).toBe(12.5)
    expect(b.memoryBytes).toBe(104857600)
    w.unmount()
  })

  it('preserves ports', async () => {
    const { result, w } = await attribute(agentIn(ws('ws_a')), ok([
      proc({ ports: [5173, 24678], workspace: ws('ws_a') }),
    ]))
    expect(result.processes.value[0].ports).toEqual([5173, 24678])
    w.unmount()
  })
})
