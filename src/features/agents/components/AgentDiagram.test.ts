import type { Agent } from '@/types'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

let servicesData: any[] = []
vi.mock('@/features/localscope', () => ({
  useLocalScopeServices: () => ({
    data: { value: servicesData },
    error: { value: null },
    reachable: { value: true },
    loaded: { value: true },
    refetch: async () => {},
  }),
}))

async function mountDiagram(agent: Partial<Agent>, services: any[] = []) {
  servicesData = services
  const AgentDiagram = (await import('./AgentDiagram.vue')).default
  return mount(AgentDiagram, {
    props: {
      agent: {
        projectName: 'LocalScope',
        cwd: '/gh/LocalScope',
        model: 'claude-sonnet-5',
        tasks: [],
        subagents: [],
        lastTools: [],
        ...agent,
      } as Agent,
    },
  })
}

describe('agentDiagram', () => {
  it('always shows the agent and its working directory — both real', async () => {
    const w = await mountDiagram({})
    expect(w.text()).toContain('CLAUDE AGENT')
    expect(w.text()).toContain('LocalScope')
  })

  // Branches must be earned by data, not drawn for decoration.
  it('draws no branches for an agent with no tasks, subagents or terminal', async () => {
    const w = await mountDiagram({})
    expect(w.findAll('[data-testid^="diagram-leaf-"]')).toHaveLength(0)
  })

  it('draws a tasks branch with the real completed ratio', async () => {
    const w = await mountDiagram({
      tasks: [
        { id: '1', subject: 'a', status: 'completed' },
        { id: '2', subject: 'b', status: 'pending' },
      ] as Agent['tasks'],
    })
    const leaf = w.get('[data-testid="diagram-leaf-tasks"]')
    expect(leaf.text()).toContain('1/2 done')
  })

  it('draws a terminal branch only when the session is attachable', async () => {
    const without = await mountDiagram({})
    expect(without.find('[data-testid="diagram-leaf-terminal"]').exists()).toBe(false)

    const with_ = await mountDiagram({ liveInjectable: true })
    expect(with_.find('[data-testid="diagram-leaf-terminal"]').exists()).toBe(true)
  })

  /*
   * The cross-system join: a LocalScope service whose project root is inside
   * this agent's working directory really is a server running in the project
   * the agent is editing.
   */
  it('links a LocalScope service running in the agent\'s project', async () => {
    const w = await mountDiagram({}, [
      { id: 's1', label: 'Vite Development Server', port: 5173, cwd: '/gh/LocalScope', project: { rootPath: '/gh/LocalScope' } },
    ])
    const leaf = w.get('[data-testid="diagram-leaf-svc-s1"]')
    expect(leaf.text()).toContain(':5173')
  })

  it('does not link a service from an unrelated project', async () => {
    const w = await mountDiagram({}, [
      { id: 's2', label: 'Other Server', port: 3000, cwd: '/gh/Something-Else', project: { rootPath: '/gh/Something-Else' } },
    ])
    expect(w.find('[data-testid="diagram-leaf-svc-s2"]').exists()).toBe(false)
  })

  it('describes itself for assistive tech', async () => {
    const w = await mountDiagram({ liveInjectable: true })
    const label = w.get('svg').attributes('aria-label')
    expect(label).toContain('LocalScope')
    expect(label).toContain('Terminal')
  })
})
