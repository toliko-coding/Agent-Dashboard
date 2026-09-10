import type { Agent } from '@/types'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'

/*
 * Correlation between an agent and the services LocalScope observed.
 *
 * The rule under test is segment-safe path containment and nothing else — no
 * project-name matching, no port heuristics, no process-name matching — plus
 * the availability semantics that keep an absent collector from putting an
 * error or a zero on every card.
 */

let state: { reachable: boolean | null, error: string | null, data: any[] | null }
const resourceCalls = { count: 0 }

vi.mock('@/features/localscope', () => ({
  useMachineServices: () => {
    resourceCalls.count++
    // A list is known only when the collector actually reported one; the old
    // reachable/error pair collapses into items being null.
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

function svc(over: Record<string, unknown>) {
  return { id: 's', port: 5173, label: 'Vite Development Server', cwd: null, discoveredProject: null, ...over }
}

function agentAt(cwd: string): Agent {
  return { cwd, projectName: cwd.split('/').pop(), sessionId: cwd } as Agent
}

async function correlate(agentCwd: string, opts: { reachable?: boolean | null, error?: string | null, data?: any[] | null } = {}) {
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
      result = useAgentServices(() => agentAt(agentCwd))
      return () => null
    },
  })
  const w = mount(C)
  return { result, w }
}

describe('useAgentServices', () => {
  it('correlates two services running in the agent project', async () => {
    const { result, w } = await correlate('/gh/LocalScope', {
      data: [
        svc({ id: 'a', port: 5173, discoveredProject: { rootPath: '/gh/LocalScope' } }),
        svc({ id: 'b', port: 7317, discoveredProject: { rootPath: '/gh/LocalScope/packages/collector' } }),
      ],
    })
    expect(result.available.value).toBe(true)
    expect(result.services.value.map(s => s.port)).toEqual([5173, 7317])
    w.unmount()
  })

  it('correlates nothing when the project runs no service', async () => {
    const { result, w } = await correlate('/gh/Quiet', {
      data: [svc({ id: 'a', discoveredProject: { rootPath: '/gh/Other' } })],
    })
    expect(result.available.value).toBe(true)
    expect(result.services.value).toEqual([])
    w.unmount()
  })

  // An absent collector must not become an error on every card.
  it('reports unavailable — not an error, not zero — when LocalScope is down', async () => {
    const { result, w } = await correlate('/gh/LocalScope', { reachable: false, data: null })
    expect(result.available.value).toBe(false)
    expect(result.services.value).toEqual([])
    w.unmount()
  })

  it('reports unavailable while the collector is still loading', async () => {
    const { result, w } = await correlate('/gh/LocalScope', { reachable: null, data: null })
    expect(result.available.value).toBe(false)
    w.unmount()
  })

  it('reports unavailable when the collector errored', async () => {
    const { result, w } = await correlate('/gh/LocalScope', { error: 'LocalScope responded 500', data: [] })
    expect(result.available.value).toBe(false)
    w.unmount()
  })

  it('ignores a service from an unrelated project', async () => {
    const { result, w } = await correlate('/gh/LocalScope', {
      data: [svc({ id: 'x', port: 3000, discoveredProject: { rootPath: '/gh/WalletRadar_web' } })],
    })
    expect(result.services.value).toEqual([])
    w.unmount()
  })

  /*
   * The false positive a plain startsWith would produce: /gh/LocalScope-docs
   * shares a prefix with /gh/LocalScope but is a different project.
   */
  it('does not correlate a sibling directory sharing a prefix', async () => {
    const { result, w } = await correlate('/gh/LocalScope', {
      data: [svc({ id: 'y', discoveredProject: { rootPath: '/gh/LocalScope-docs' } })],
    })
    expect(result.services.value).toEqual([])
    w.unmount()
  })

  it('correlates upward too — agent in a subdirectory of the service project', async () => {
    const { result, w } = await correlate('/gh/LocalScope/packages/web', {
      data: [svc({ id: 'z', discoveredProject: { rootPath: '/gh/LocalScope' } })],
    })
    expect(result.services.value.map(s => s.id)).toEqual(['z'])
    w.unmount()
  })

  it('falls back to the service cwd when it has no resolved project', async () => {
    const { result, w } = await correlate('/gh/LocalScope', {
      data: [svc({ id: 'c', cwd: '/gh/LocalScope', project: null })],
    })
    expect(result.services.value.map(s => s.id)).toEqual(['c'])
    w.unmount()
  })

  it('gives two agents in the same project the same services', async () => {
    state = {
      reachable: true,
      error: null,
      data: [svc({ id: 'shared', discoveredProject: { rootPath: '/gh/LocalScope' } })],
    }
    vi.resetModules()
    const { useAgentServices } = await import('../useAgentServices')
    let a!: any, b!: any
    const C = defineComponent({
      setup() {
        a = useAgentServices(() => agentAt('/gh/LocalScope'))
        b = useAgentServices(() => agentAt('/gh/LocalScope/packages/collector'))
        return () => null
      },
    })
    const w = mount(C)
    expect(a.services.value.map((s: any) => s.id)).toEqual(['shared'])
    expect(b.services.value.map((s: any) => s.id)).toEqual(['shared'])
    w.unmount()
  })

  it('never attributes a machine-wide service to an agent it does not belong to', async () => {
    const { result, w } = await correlate('/gh/LocalScope', {
      // A listener with no project and no cwd cannot be attributed to anyone.
      data: [svc({ id: 'orphan', port: 631, project: null, cwd: null })],
    })
    expect(result.services.value).toEqual([])
    w.unmount()
  })
})

/*
 * ===========================================================================
 * KNOWN ARCHITECTURE HAZARD — pinned, not fixed. Scheduled for Phase 2D-D.
 * ===========================================================================
 *
 * Correlation is bidirectional segment-safe path containment: a service belongs
 * to an agent when either root contains the other. That was the best rule
 * available before workspace identity existed, and it is correct for the case
 * it was written for — an agent at a repo root, a dev server in a package below
 * it.
 *
 * It has no concept of a workspace boundary, so it cannot see that a linked
 * worktree is a DIFFERENT workspace. When worktrees live inside the repository
 * — not the default ($HOME/dashboard-worktrees) but a supported layout, and one
 * .gitignore already anticipates with `dashboard-worktrees/`, `.worktrees/` and
 * `.claude/worktrees/` — a worktree's root sits under the main checkout's root
 * and containment reports a match.
 *
 * The consequence is a cross-workspace false positive: an agent working in the
 * main checkout is shown a dev server that belongs to a different branch's
 * worktree. Both directions of the rule are affected.
 *
 * These tests assert the CURRENT behaviour on purpose. They document the defect
 * rather than hiding it, and they will fail loudly when 2D-D moves correlation
 * onto WorkspaceRef.id — which is the point: the fix must be deliberate, and it
 * must come with this expectation being rewritten.
 */
describe('useAgentServices — cross-workspace hazard (pinned for 2D-D)', () => {
  const MAIN = '/Users/x/Repo'
  const NESTED_WORKTREE = '/Users/x/Repo/dashboard-worktrees/feat-y'

  it('cURRENTLY correlates a nested worktree service to the main-checkout agent', async () => {
    const { result, w } = await correlate(MAIN, {
      data: [svc({ id: 'wt-server', cwd: NESTED_WORKTREE, discoveredProject: { rootPath: NESTED_WORKTREE } })],
    })
    // Wrong, and known to be wrong: that server belongs to another workspace,
    // on another branch, with its own agents.
    expect(result.services.value.map(s => s.id)).toEqual(['wt-server'])
    w.unmount()
  })

  it('cURRENTLY correlates a main-checkout service to a nested-worktree agent', async () => {
    const { result, w } = await correlate(NESTED_WORKTREE, {
      data: [svc({ id: 'main-server', cwd: MAIN, discoveredProject: { rootPath: MAIN } })],
    })
    expect(result.services.value.map(s => s.id)).toEqual(['main-server'])
    w.unmount()
  })

  it('is correct when worktrees sit outside the repository, which is the default', async () => {
    // Same two workspaces, laid out the way DefaultRoot lays them out. Nothing
    // contains anything, so containment happens to give the right answer —
    // which is exactly why the defect above stayed invisible.
    const { result, w } = await correlate('/Users/x/Repo', {
      data: [svc({ id: 'wt-server', cwd: '/Users/x/dashboard-worktrees/feat-y', discoveredProject: { rootPath: '/Users/x/dashboard-worktrees/feat-y' } })],
    })
    expect(result.services.value).toEqual([])
    w.unmount()
  })
})
