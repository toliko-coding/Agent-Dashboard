import type { Agent } from '@/types'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AgentCard from '../AgentCard.vue'
import AgentRow from '../AgentRow.vue'

// L (3N.1): Grid and List name an agent the same way, and keep what it is doing apart.
const agent = {
  pid: 4242,
  sessionId: '3f2a1b9c-0000-4000-8000-000000000000',
  provider: 'claude',
  projectPath: '/Users/me/scratch/resume',
  projectName: 'resume',
  cwd: '/Users/me/scratch/resume',
  entrypoint: 'cli',
  status: 'active',
  uptime: 60,
  lastActivity: new Date().toISOString(),
  lastTools: [],
  tasks: [],
  subagents: [],
  tokenUsage: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
  costEstimate: 0.5,
  healthScore: 90,
  working: false,
  workspace: null,
  displayName: 'Resume Editor',
  category: 'document',
  title: 'Tidy the CV layout',
} as unknown as Agent

const stubs = { MachineBadge: true, ProviderBadge: true, PromptInput: true, AgentServiceChips: true }

describe('agent identity — grid and list agree', () => {
  it('shows the same name, icon, topic and technical handle in both layouts', () => {
    const card = mount(AgentCard, { props: { agent }, global: { stubs } })
    const row = mount(AgentRow, { props: { agent }, global: { stubs } })

    expect(card.get('[data-testid="agent-card-title"]').text()).toBe('Resume Editor')
    expect(row.get('[data-testid="agent-row-name"]').text()).toBe('Resume Editor')

    expect(card.get('[data-testid="agent-glyph"]').attributes('aria-label')).toBe('Documents agent')
    expect(row.get('[data-testid="agent-glyph"]').attributes('aria-label')).toBe('Documents agent')

    expect(card.get('[data-testid="agent-card-topic"]').text()).toContain('Tidy the CV layout')
    expect(row.get('[data-testid="agent-row-topic"]').text()).toContain('Tidy the CV layout')

    expect(card.get('[data-testid="agent-card-technical"]').text()).toBe('Claude · 3f2a1b9c')
    expect(row.get('[data-testid="agent-row-name"]').attributes('title')).toBe('Resume Editor · Claude · 3f2a1b9c')

    for (const html of [card.html(), row.html()]) {
      expect(html).not.toContain('/Users/me')
      expect(html).not.toContain('4242')
    }
  })
})
