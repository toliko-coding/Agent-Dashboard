import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { axe } from '@/utils/testA11y'
import EmptyAgentState from './EmptyAgentState.vue'

// 3L: an empty roster states what is absent and the next step — no decorative hero.
describe('emptyAgentState', () => {
  it('says no agents are running and how to start one', () => {
    const w = mount(EmptyAgentState, { props: { searchQuery: '' } })
    expect(w.text()).toContain('No agents are currently running.')
    expect(w.text()).toContain('+ New Agent')
    expect(w.text()).not.toMatch(/healthy|all good|nothing to worry/i)
    expect(w.text()).not.toContain('🤖')
  })

  it('distinguishes a search with no matches from an empty roster', () => {
    const w = mount(EmptyAgentState, { props: { searchQuery: 'foo' } })
    expect(w.text()).toContain('No agents match your search.')
    expect(w.text()).not.toContain('currently running')
  })

  it('has no axe violations', async () => {
    const w = mount(EmptyAgentState, { props: { searchQuery: '' }, attachTo: document.body })
    expect(await axe(w.element as Element)).toHaveNoViolations()
    w.unmount()
  })
})
