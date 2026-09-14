import type { UsageData } from '@/composables/useUsage'
import type { Agent } from '@/types'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { axe } from '@/utils/testA11y'

const data = ref<UsageData | null>(null)
const error = ref<string | null>(null)
const start = vi.fn()

vi.mock('@/composables/useUsage', () => ({
  useUsage: () => ({ data, error, start, stop: vi.fn(), refresh: vi.fn() }),
}))

const NO_BUDGET: UsageData = {
  windows: [
    { key: '5h', tokens: 2_140_000, costCents: 431, budgetTokens: null, pct: null },
    { key: '7d', tokens: 14_000_000, costCents: 2900, budgetTokens: null, pct: null },
  ],
  accounts: [],
}

const session = (o: Partial<Agent>) => ({ sessionId: 's', costEstimate: 0, costUnknown: false, ...o }) as Agent

async function render(sessions: Agent[] | null = [], attach = false) {
  const { default: ClaudeUsagePanel } = await import('./ClaudeUsagePanel.vue')
  return mount(ClaudeUsagePanel, { props: { sessions }, attachTo: attach ? document.body : undefined })
}

describe('claudeUsagePanel', () => {
  it('says it is loading before the first reading, not that usage is zero', async () => {
    data.value = null
    error.value = null
    const w = await render()
    expect(w.find('[data-testid="cockpit-usage-loading"]').exists()).toBe(true)
    expect(w.text()).not.toMatch(/\b0 tokens\b/)
  })

  it('says the read failed when there is no reading to show', async () => {
    data.value = null
    error.value = 'Usage could not be read (500)'
    const w = await render()
    expect(w.get('[data-testid="cockpit-usage-failed"]').text()).toBe('Usage could not be read (500)')
  })

  it('shows both rolling windows as tokens and an estimated cost, and says when there is no budget', async () => {
    data.value = NO_BUDGET
    error.value = null
    const w = await render()
    const fiveHours = w.get('[data-testid="usage-window-5h"]')
    expect(fiveHours.text()).toContain('Last 5 hours')
    expect(fiveHours.get('[data-testid="usage-tokens"]').text()).toBe('2.1M')
    expect(fiveHours.get('[data-testid="usage-cost"]').text()).toContain('$4.31')
    expect(fiveHours.get('[data-testid="usage-no-budget"]').text()).toBe('No budget set')
    expect(w.get('[data-testid="usage-window-7d"]').text()).toContain('Last 7 days')
    expect(w.find('[data-testid="usage-budget"]').exists()).toBe(false)
  })

  it('shows a configured budget share with its level in words', async () => {
    data.value = { windows: [{ key: '5h', tokens: 8_000_000, costCents: 100, budgetTokens: 10_000_000, pct: 0.8 }, { key: '7d', tokens: 1000, costCents: 0, budgetTokens: 10_000_000, pct: 0.0001 }], accounts: [] }
    const w = await render()
    const budget = w.get('[data-testid="usage-window-5h"] [data-testid="usage-budget"]')
    expect(budget.attributes('data-level')).toBe('high')
    expect(budget.text()).toContain('80% of budget · High')
    expect(w.get('[data-testid="usage-window-7d"] [data-testid="usage-cost"]').text()).toContain('$0.00')
  })

  it('sums the running sessions\' estimates and names the ones without pricing', async () => {
    data.value = NO_BUDGET
    const w = await render([session({ costEstimate: 1.5 }), session({ costEstimate: 2.25 }), session({ costUnknown: true, costEstimate: 0 })])
    const running = w.get('[data-testid="usage-running"]').text()
    expect(running).toContain('3 sessions')
    expect(running).toContain('$3.75')
    expect(running).toContain('1 without pricing')
    // O: a lifetime total is labelled as one and kept out of the window grid.
    expect(w.get('[data-testid="usage-running-label"]').text()).toBe('Active sessions · lifetime')
    expect(w.get('[data-testid="usage-running-note"]').text()).toContain('not a 5-hour or 7-day figure')
    expect(w.get('[data-testid="usage-windows"]').find('[data-testid="usage-running"]').exists()).toBe(false)
  })

  it('does not report running sessions before agents are observed', async () => {
    data.value = NO_BUDGET
    const w = await render(null)
    expect(w.find('[data-testid="usage-running"]').exists()).toBe(false)
  })

  it('names its source and does not claim the plan\'s limits or a day', async () => {
    data.value = NO_BUDGET
    const w = await render()
    const source = w.get('[data-testid="usage-source"]').text()
    expect(source).toContain('not an Anthropic bill')
    expect(source).toContain('not your plan\'s usage limits')
    // Q: nothing about subscription quota is claimed.
    expect(w.text()).not.toMatch(/\btoday\b|remaining|quota|resets?\b|\bMax\b|\bPro\b|% (?:of|left)/i)
  })

  it('o: states the span of each window for assistive technology', async () => {
    data.value = NO_BUDGET
    const w = await render()
    expect(w.get('[data-testid="usage-window-5h"] [data-testid="usage-cost"] .sr-only').text()).toContain('the last 5 hours')
    expect(w.get('[data-testid="usage-window-7d"] [data-testid="usage-cost"] .sr-only').text()).toContain('the last 7 days')
  })

  it('reads the shared usage response and starts no poll of its own', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/features/cockpit/components/ClaudeUsagePanel.vue'), 'utf8')
    expect(source).not.toMatch(/fetch\(|setInterval|\.start\(\)/)
    expect(start).not.toHaveBeenCalled()
  })

  it('has no axe violations', async () => {
    data.value = { ...NO_BUDGET, accounts: [{ label: 'work', w5h: { tokens: 1, costCents: 1 }, w7d: { tokens: 2, costCents: 2 } }, { label: 'personal', w5h: { tokens: 3, costCents: 3 }, w7d: { tokens: 4, costCents: 4 } }] }
    const w = await render([session({ costEstimate: 1 })], true)
    expect(await axe(w.element as Element)).toHaveNoViolations()
    w.unmount()
  })
})
