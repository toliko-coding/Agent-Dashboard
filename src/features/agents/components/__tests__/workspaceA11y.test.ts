import type { Agent } from '@/types'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { axe } from '@/utils/testA11y'

vi.mock('@/features/localscope', () => ({
  // Collector absent: the list is unknown, which is items: null — not [].
  useMachineServices: () => ({
    data: {
      value: { source: 'unavailable', collectedAt: null, ageMs: null, degraded: [], items: null },
    },
    loaded: { value: true },
    refetch: async () => {},
  }),
}))

const agent = {
  pid: 1,
  sessionId: 's',
  projectName: 'LocalScope',
  projectPath: '/gh/LocalScope',
  cwd: '/gh/LocalScope',
  status: 'active',
  working: false,
  uptime: 300,
  lastActivity: new Date().toISOString(),
  model: 'claude-sonnet-5',
  tasks: [
    { id: '1', subject: 'Implement adapter', status: 'in_progress' },
    { id: '2', subject: 'Write tests', status: 'completed' },
  ],
  subagents: [],
  lastTools: [{ name: 'Edit', detail: 'src/main.ts' }],
  healthScore: 90,
} as unknown as Agent

describe('agent workspace accessibility', () => {
  it('intelligence panel has no axe violations', async () => {
    const C = (await import('../AgentIntelligencePanel.vue')).default
    const w = mount(C, { props: { agent }, attachTo: document.body })
    expect(await axe(w.element as Element)).toHaveNoViolations()
    w.unmount()
  })

  it('the intelligence column is a labelled landmark', async () => {
    const C = (await import('../AgentIntelligencePanel.vue')).default
    const w = mount(C, { props: { agent } })
    expect(w.get('aside').attributes('aria-label')).toBe('Agent intelligence')
  })

  // The diagram is meaningful content, so it needs a text alternative rather
  // than being exposed as an unlabelled graphic.
  it('diagram has no axe violations and carries a description', async () => {
    const C = (await import('../AgentDiagram.vue')).default
    const w = mount(C, { props: { agent }, attachTo: document.body })
    const svg = w.get('svg')
    expect(svg.attributes('role')).toBe('img')
    expect(svg.attributes('aria-label')).toContain('LocalScope')
    expect(await axe(w.element as Element)).toHaveNoViolations()
    w.unmount()
  })
})
