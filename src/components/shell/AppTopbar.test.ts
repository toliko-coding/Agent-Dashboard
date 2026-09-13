import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AppTopbar from './AppTopbar.vue'

describe('appTopbar', () => {
  it('renders the view title', () => {
    const w = mount(AppTopbar, { props: { activeView: 'cost' } })
    expect(w.text()).toContain('Cost')
  })

  it('renders the cta slot', () => {
    const w = mount(AppTopbar, {
      props: { activeView: 'dashboard' },
      slots: { cta: '<button>+ New Agent</button>' },
    })
    expect(w.text()).toContain('+ New Agent')
  })

  // Search narrows the agent roster only, so it lives in the roster toolbar; on
  // every other view the topbar field promised a filter that never ran.
  it('carries no search field', () => {
    const w = mount(AppTopbar, { props: { activeView: 'pipeline' } })
    expect(w.find('input').exists()).toBe(false)
  })

  it('carries no settings button — it sits with the other global actions in the sidebar', () => {
    const w = mount(AppTopbar, { props: { activeView: 'dashboard' } })
    expect(w.find('button[aria-label="Settings"]').exists()).toBe(false)
  })
})

describe('appTopbar — 3B truth fixes', () => {
  // E: a connected stream is a steady state, not ongoing activity.
  it('shows a static live-coloured dot while connected', () => {
    const w = mount(AppTopbar, { props: { activeView: 'dashboard', live: true } })
    const dot = w.get('[role="status"] span')
    expect(dot.classes().join(' ')).not.toMatch(/animate-|motion-/)
    expect(dot.classes()).toContain('bg-live-dot')
    // The state is still a word, never colour alone.
    expect(w.get('[role="status"]').text()).toContain('System Online')
  })

  it('shows a static warning dot while reconnecting', () => {
    const w = mount(AppTopbar, { props: { activeView: 'dashboard', live: false } })
    const dot = w.get('[role="status"] span')
    expect(dot.classes()).toContain('bg-warning')
    expect(dot.classes().join(' ')).not.toMatch(/animate-/)
  })

  // J: the trigger names only what the palette searches.
  it('describes only the search that exists: tasks and agents', () => {
    const w = mount(AppTopbar, { props: { activeView: 'dashboard' } })
    const trigger = w.get('[data-testid="topbar-search"]')
    expect(trigger.text()).toContain('Search tasks and agents')
    expect(trigger.attributes('aria-label')).toBe('Search tasks and agents')
    expect(trigger.text()).not.toMatch(/projects|commands/i)
    expect(trigger.attributes('aria-label')).not.toMatch(/projects|commands/i)
    // Keyboard access is unchanged.
    expect(trigger.attributes('aria-keyshortcuts')).toBe('Meta+K Control+K')
  })

  it('matches the palette it opens', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const palette = readFileSync(resolve(process.cwd(), 'src/components/SpotlightSearch.vue'), 'utf8')
    expect(palette).toContain('placeholder="Search tasks and agents…"')
  })
})
