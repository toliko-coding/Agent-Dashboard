import type { Agent, WorkspaceRef } from '@/types'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'

/*
 * Correlation between an agent and the services LocalScope observed.
 *
 * The rule under test is workspace-identity equality and nothing else. These
 * were the tests that pinned the old path-containment behaviour as a known
 * defect; they are now the acceptance tests for the fix, so the scenarios that
 * previously asserted a false match assert its absence.
 */

let state: { reachable: boolean | null, error: string | null, data: any[] | null }
const resourceCalls = { count: 0 }

vi.mock('@/features/localscope', () => ({
  useMachineServices: () => {
    resourceCalls.count++
    const known = state.reachable === true && state.error === null && state.data !== null
    return {
      data: {
        value: {
          source: known ? 'ok' : 'unavailable',
          collectedAt: null,
          ageMs: null,
          degraded: [],
          items: known ? state.data : null,
        },
      },
      loaded: { value: state.reachable !== null },
      refetch: async () => {},
    }
  },
}))

/** A workspace ref. `repo` defaults to a shared repository on purpose. */
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

function svc(over: Record<string, unknown>) {
  return {
    id: 's',
    port: 5173,
    label: 'Vite Development Server',
    cwd: null,
    discoveredProject: null,
    workspace: null,
    ...over,
  }
}

function agentIn(workspace: WorkspaceRef | null, cwd = '/somewhere'): Agent {
  return { cwd, projectName: 'Repo', sessionId: cwd, workspace } as Agent
}

async function correlate(
  agent: Agent,
  opts: { reachable?: boolean | null, error?: string | null, data?: any[] | null } = {},
) {
  state = {
    reachable: opts.reachable === undefined ? true : opts.reachable,
    error: opts.error ?? null,
    data: opts.data === undefined ? [] : opts.data,
  }
  vi.resetModules()
  const { useAgentServices } = await import('../useAgentServices')
  let result!: ReturnType<typeof useAgentServices>
  const C = defineComponent({
    setup() {
      result = useAgentServices(() => agent)
      return () => null
    },
  })
  const w = mount(C)
  return { result, w }
}

describe('useAgentServices — workspace identity', () => {
  // C. Same workspace on both sides is the only thing that correlates.
  it('correlates services in the same workspace', async () => {
    const { result, w } = await correlate(agentIn(ws('ws_a')), {
      data: [
        svc({ id: 'a', port: 5173, workspace: ws('ws_a') }),
        svc({ id: 'b', port: 7317, workspace: ws('ws_a') }),
        svc({ id: 'other', port: 3000, workspace: ws('ws_z') }),
      ],
    })
    expect(result.available.value).toBe(true)
    expect(result.services.value.map(s => s.id)).toEqual(['a', 'b'])
    w.unmount()
  })

  it('correlates nothing when the workspace runs no service', async () => {
    const { result, w } = await correlate(agentIn(ws('ws_quiet')), {
      data: [svc({ id: 'a', workspace: ws('ws_elsewhere') })],
    })
    expect(result.available.value).toBe(true)
    expect(result.services.value).toEqual([])
    w.unmount()
  })

  /*
   * A. and B. — the defect this checkpoint exists to remove, in both
   * directions. Same repository, nested on disk, different workspaces.
   */
  it('does not attach a nested worktree service to a main-checkout agent', async () => {
    const main = ws('ws_main', { kind: 'git-main', branch: 'main' })
    const worktree = ws('ws_wt', { kind: 'git-worktree', branch: 'feat/y' })
    const { result, w } = await correlate(agentIn(main, '/Users/x/Repo'), {
      data: [svc({
        id: 'wt-server',
        cwd: '/Users/x/Repo/dashboard-worktrees/feat-y',
        workspace: worktree,
      })],
    })
    expect(result.services.value).toEqual([])
    w.unmount()
  })

  it('does not attach a main-checkout service to a nested worktree agent', async () => {
    const main = ws('ws_main')
    const worktree = ws('ws_wt', { kind: 'git-worktree', branch: 'feat/y' })
    const { result, w } = await correlate(agentIn(worktree, '/Users/x/Repo/dashboard-worktrees/feat-y'), {
      data: [svc({ id: 'main-server', cwd: '/Users/x/Repo', workspace: main })],
    })
    expect(result.services.value).toEqual([])
    w.unmount()
  })

  /*
   * D. and the §8 invariant, stated directly: a shared repository id is NOT
   * evidence of a shared workspace, and must not attribute anything. This is
   * the property Mission Control will rest on.
   */
  it('never correlates on repository id — two worktrees of one repository stay apart', async () => {
    const a = ws('ws_a', { kind: 'git-worktree', branch: 'feat/a' })
    const b = ws('ws_b', { kind: 'git-worktree', branch: 'feat/b' })
    expect(a.repository!.id).toBe(b.repository!.id) // precondition: same repo

    const { result, w } = await correlate(agentIn(a), {
      data: [svc({ id: 'b-server', workspace: b })],
    })
    expect(result.services.value).toEqual([])
    w.unmount()
  })

  // E. and F. — a plain directory gets a real identity and the same rule.
  it('correlates a plain non-git workspace with itself', async () => {
    const plain = ws('ws_plain', { kind: 'plain', branch: '', repository: null })
    const { result, w } = await correlate(agentIn(plain, '/Users/x/notes'), {
      data: [svc({ id: 'p', workspace: { ...plain } })],
    })
    expect(result.services.value.map(s => s.id)).toEqual(['p'])
    w.unmount()
  })

  it('keeps two different plain workspaces apart', async () => {
    const a = ws('ws_plain_a', { kind: 'plain', branch: '', repository: null })
    const b = ws('ws_plain_b', { kind: 'plain', branch: '', repository: null })
    const { result, w } = await correlate(agentIn(a), { data: [svc({ id: 'b', workspace: b })] })
    expect(result.services.value).toEqual([])
    w.unmount()
  })

  // G. and H. — unknown stays unknown, on either side.
  it('matches nothing when the agent has no resolved workspace', async () => {
    const { result, w } = await correlate(agentIn(null, '/Users/x/Repo'), {
      data: [svc({ id: 'a', cwd: '/Users/x/Repo', workspace: ws('ws_a') })],
    })
    // The cwd is identical — the old rule would have matched on it.
    expect(result.services.value).toEqual([])
    w.unmount()
  })

  it('matches nothing when the service has no resolved workspace', async () => {
    const { result, w } = await correlate(agentIn(ws('ws_a'), '/Users/x/Repo'), {
      data: [svc({ id: 'a', cwd: '/Users/x/Repo', workspace: null })],
    })
    expect(result.services.value).toEqual([])
    w.unmount()
  })

  /*
   * No containment fallback survives. A service whose cwd sits inside the
   * agent's, and one that contains it, both fail without matching identity —
   * the two shapes the old rule accepted.
   */
  it('has no path-containment fallback in either direction', async () => {
    const { result, w } = await correlate(agentIn(ws('ws_a'), '/Users/x/Repo'), {
      data: [
        svc({ id: 'below', cwd: '/Users/x/Repo/packages/api', workspace: ws('ws_other') }),
        svc({ id: 'above', cwd: '/Users/x', workspace: ws('ws_other2') }),
        svc({ id: 'exact', cwd: '/Users/x/Repo', workspace: ws('ws_other3') }),
      ],
    })
    expect(result.services.value).toEqual([])
    w.unmount()
  })

  it('does not correlate on port, label or project name', async () => {
    const { result, w } = await correlate(agentIn(ws('ws_a'), '/Users/x/Repo'), {
      data: [svc({
        id: 'decoy',
        port: 5173,
        label: 'Vite Development Server',
        cwd: '/Users/x/Repo',
        discoveredProject: { rootPath: '/Users/x/Repo', name: 'Repo' },
        workspace: ws('ws_different'),
      })],
    })
    expect(result.services.value).toEqual([])
    w.unmount()
  })
})

describe('useAgentServices — availability semantics (unchanged)', () => {
  // An absent collector must not become an error on every card.
  it('reports unavailable — not an error, not zero — when LocalScope is down', async () => {
    const { result, w } = await correlate(agentIn(ws('ws_a')), { reachable: false, data: null })
    expect(result.available.value).toBe(false)
    expect(result.services.value).toEqual([])
    w.unmount()
  })

  it('reports unavailable while nothing has been collected yet', async () => {
    const { result, w } = await correlate(agentIn(ws('ws_a')), { reachable: null, data: null })
    expect(result.available.value).toBe(false)
    w.unmount()
  })

  it('treats a malformed list as not known rather than as data', async () => {
    const { result, w } = await correlate(agentIn(ws('ws_a')), { data: 'nonsense' as any })
    expect(result.available.value).toBe(false)
    expect(result.services.value).toEqual([])
    w.unmount()
  })

  it('shares one resource across many cards rather than fetching per card', async () => {
    resourceCalls.count = 0
    const { w } = await correlate(agentIn(ws('ws_a')), { data: [] })
    expect(resourceCalls.count).toBe(1)
    w.unmount()
  })
})
