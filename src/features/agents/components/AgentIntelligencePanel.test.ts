import type { Agent } from '@/types'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/features/localscope', () => ({
  useLocalScopeServices: () => ({
    data: { value: [] },
    error: { value: null },
    reachable: { value: false },
    loaded: { value: true },
    refetch: async () => {},
  }),
}))

const base = {
  projectName: 'LocalScope',
  projectPath: '/gh/LocalScope',
  cwd: '/gh/LocalScope',
  status: 'active',
  working: false,
  uptime: 120,
  lastActivity: new Date().toISOString(),
  tasks: [],
  subagents: [],
  lastTools: [],
  healthScore: 90,
} as unknown as Agent

async function mountPanel(over: Partial<Agent> = {}) {
  const C = (await import('./AgentIntelligencePanel.vue')).default
  return mount(C, { props: { agent: { ...base, ...over } as Agent }, global: { stubs: { AppBadge: true } } })
}

describe('agentIntelligencePanel', () => {
  it('always shows state and project — both real fields', async () => {
    const w = await mountPanel()
    expect(w.text()).toContain('Agent state')
    expect(w.text()).toContain('LocalScope')
    expect(w.text()).toContain('/gh/LocalScope')
  })

  // Progress must be earned by TodoWrite items, and never called a phase.
  it('omits task progress when the session wrote no items', async () => {
    const w = await mountPanel()
    expect(w.find('[data-testid="intelligence-tasks"]').exists()).toBe(false)
    expect(w.text().toLowerCase()).not.toContain('phase')
  })

  it('shows a completed ratio when items exist', async () => {
    const w = await mountPanel({
      tasks: [
        { id: '1', subject: 'a', status: 'completed' },
        { id: '2', subject: 'b', status: 'in_progress' },
        { id: '3', subject: 'c', status: 'pending' },
      ] as Agent['tasks'],
    })
    expect(w.get('[data-testid="intelligence-tasks"]').text()).toContain('1 / 3 complete')
  })

  it('surfaces the in-progress item as the current task', async () => {
    const w = await mountPanel({
      tasks: [
        { id: '1', subject: 'Implement Android adapter', status: 'in_progress' },
      ] as Agent['tasks'],
    })
    expect(w.get('[data-testid="intelligence-current-task"]').text()).toContain('Implement Android adapter')
  })

  it('says so when there is no recorded tool activity', async () => {
    const w = await mountPanel()
    expect(w.text()).toContain('No recorded tool activity yet.')
  })

  it('lists recent tools when they exist', async () => {
    const w = await mountPanel({
      lastTools: [{ name: 'Edit', detail: 'src/main.ts' }] as Agent['lastTools'],
    })
    expect(w.text()).toContain('Edit')
    expect(w.text()).toContain('src/main.ts')
  })
})
