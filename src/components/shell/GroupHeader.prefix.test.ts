import type { Agent } from '../../types'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import GroupHeader from './GroupHeader.vue'

const agents = [{ pid: 1, costEstimate: 0 }, { pid: 2, costEstimate: 0 }] as unknown as Agent[]

describe('groupHeader — prefix and detail', () => {
  it('states a structural prefix as text and in the accessible name', () => {
    const w = mount(GroupHeader, { props: { label: 'Agent-Dashboard', agents, prefix: 'Repository' } })
    expect(w.get('[data-testid="group-header-prefix"]').text()).toBe('Repository')
    expect(w.attributes('aria-label')).toBe('Toggle Repository Agent-Dashboard group')
  })

  it('renders a detail count beside the agent count', () => {
    const w = mount(GroupHeader, { props: { label: 'X', agents, detail: '2 workspaces' } })
    expect(w.get('[data-testid="group-header-detail"]').text()).toBe('2 workspaces')
    expect(w.text()).toContain('2 agents')
  })

  // Existing modes must announce exactly as they did.
  it('keeps the original accessible name when no prefix is given', () => {
    const w = mount(GroupHeader, { props: { label: 'Active', agents } })
    expect(w.attributes('aria-label')).toBe('Toggle Active group')
    expect(w.find('[data-testid="group-header-prefix"]').exists()).toBe(false)
    expect(w.find('[data-testid="group-header-detail"]').exists()).toBe(false)
  })

  it('keeps the derived-from suffix alongside a prefix', () => {
    const w = mount(GroupHeader, { props: { label: 'L', agents, prefix: 'Repository', derivedFrom: 'why' } })
    expect(w.attributes('aria-label')).toBe('Toggle Repository L group — why')
  })
})
