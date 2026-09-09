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
  useLocalScopeServices: () => {
    resourceCalls.count++
    return {
      data: { value: state.data },
      error: { value: state.error },
      reachable: { value: state.reachable },
      loaded: { value: state.reachable !== null },
      refetch: async () => {},
    }
  },
}))

function svc(over: Record<string, unknown>) {
  return { id: 's', port: 5173, label: 'Vite Development Server', cwd: null, project: null, ...over }
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
        svc({ id: 'a', port: 5173, project: { rootPath: '/gh/LocalScope' } }),
        svc({ id: 'b', port: 7317, project: { rootPath: '/gh/LocalScope/packages/collector' } }),
      ],
    })
    expect(result.available.value).toBe(true)
    expect(result.services.value.map(s => s.port)).toEqual([5173, 7317])
    w.unmount()
  })

  it('correlates nothing when the project runs no service', async () => {
    const { result, w } = await correlate('/gh/Quiet', {
      data: [svc({ id: 'a', project: { rootPath: '/gh/Other' } })],
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
      data: [svc({ id: 'x', port: 3000, project: { rootPath: '/gh/WalletRadar_web' } })],
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
      data: [svc({ id: 'y', project: { rootPath: '/gh/LocalScope-docs' } })],
    })
    expect(result.services.value).toEqual([])
    w.unmount()
  })

  it('correlates upward too — agent in a subdirectory of the service project', async () => {
    const { result, w } = await correlate('/gh/LocalScope/packages/web', {
      data: [svc({ id: 'z', project: { rootPath: '/gh/LocalScope' } })],
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
      data: [svc({ id: 'shared', project: { rootPath: '/gh/LocalScope' } })],
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
