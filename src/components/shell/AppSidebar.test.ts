import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Provide a minimal localStorage stub (jsdom not active at this test path level).
const store: Record<string, string> = {}
globalThis.localStorage = {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v },
  removeItem: (k: string) => { delete store[k] },
  clear: () => { Object.keys(store).forEach(k => delete store[k]) },
  length: 0,
  key: () => null,
}

async function load() {
  vi.resetModules()
  localStorage.clear()
  const mod = await import('./AppSidebar.vue')
  const { useViewState } = await import('../../composables/useViewState')
  const { useSidebar } = await import('../../composables/useSidebar')
  return { AppSidebar: mod.default, useViewState, useSidebar }
}

const props = {
  agentCount: 12,
  attentionCount: 0,
  taskCount: 5,
  live: true,
  theme: 'dark' as const,
  canInstall: false,
}

describe('appSidebar', () => {
  beforeEach(() => localStorage.clear())

  it('renders group headers when expanded (pinned)', async () => {
    const { AppSidebar, useSidebar } = await load()
    useSidebar().togglePinned()
    const w = mount(AppSidebar, { props })
    // Captions name only the destinations made of several views.
    expect(w.text()).toContain('Runtime')
    expect(w.text()).toContain('Work')
    expect(w.text()).toContain('Insights')
    for (const retired of ['Main', 'Automation', 'Tools'])
      expect(w.text()).not.toContain(retired)
  })

  // Settings opens a modal, so it is not a view — it must emit rather than
  // setting activeView, and there must be exactly one of it in the rail.
  it('emits openSettings from the trailing Settings entry without changing the view', async () => {
    const { AppSidebar, useViewState, useSidebar } = await load()
    useSidebar().togglePinned()
    const w = mount(AppSidebar, { props })
    const before = useViewState().activeView.value
    const settings = w.findAll('button').filter(b => b.text().includes('Settings'))
    expect(settings).toHaveLength(1)
    await settings[0].trigger('click')
    expect(w.emitted('openSettings')).toHaveLength(1)
    expect(useViewState().activeView.value).toBe(before)
  })

  it('clicking a nav item sets activeView', async () => {
    const { AppSidebar, useViewState } = await load()
    const w = mount(AppSidebar, { props })
    const pipelineBtn = w.findAll('button').find(b => b.text().includes('Pipeline'))!
    await pipelineBtn.trigger('click')
    expect(useViewState().activeView.value).toBe('pipeline')
  })

  it('pin toggle button flips aria-expanded', async () => {
    const { AppSidebar } = await load()
    const w = mount(AppSidebar, { props })
    const toggle = w.get('[data-testid="sidebar-pin"]')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('true')
  })

  it('shows agent count badge on Dashboard', async () => {
    const { AppSidebar, useSidebar } = await load()
    useSidebar().togglePinned()
    const w = mount(AppSidebar, { props })
    expect(w.text()).toContain('12')
  })

  it('shows task count badge on Pipeline', async () => {
    const { AppSidebar, useSidebar } = await load()
    useSidebar().togglePinned()
    const w = mount(AppSidebar, { props })
    expect(w.text()).toContain('5')
  })

  it('shows the live status line under the brand when expanded', async () => {
    const { AppSidebar, useSidebar } = await load()
    useSidebar().togglePinned()
    const w = mount(AppSidebar, { props })
    expect(w.text()).toContain('Agent updates live')
  })

  it('shows a reconnecting state when not live', async () => {
    const { AppSidebar, useSidebar } = await load()
    useSidebar().togglePinned()
    const w = mount(AppSidebar, { props: { ...props, live: false } })
    expect(w.text()).toContain('Reconnecting')
  })

  it('separates the nav groups with a rule when collapsed', async () => {
    const { AppSidebar } = await load()
    const w = mount(AppSidebar, { props })
    // Breaks before Runtime, Work, Projects (after the Work group) and Insights,
    // plus the one before Settings. Command and Agents run together.
    expect(w.findAll('[data-testid="nav-group-divider"]')).toHaveLength(5)
    expect(w.text()).not.toContain('Runtime')
  })

  it('keeps rules only where no caption separates the next destination', async () => {
    const { AppSidebar, useSidebar } = await load()
    useSidebar().togglePinned()
    const w = mount(AppSidebar, { props })
    // Captions carry Runtime, Work and Insights; Projects and Settings keep a rule.
    expect(w.findAll('[data-testid="nav-group-divider"]')).toHaveLength(2)
    expect(w.find('[data-testid="nav-section-projects"] [data-testid="nav-group-divider"]').exists()).toBe(true)
  })

  it('keeps the rail at icon width while the hovered nav floats over the content', async () => {
    const { AppSidebar } = await load()
    const w = mount(AppSidebar, { props })
    const rail = w.get('[data-testid="sidebar-rail"]')
    const nav = w.get('nav')
    expect(rail.classes()).toContain('w-[56px]')
    expect(nav.classes()).toContain('absolute')

    await nav.trigger('mouseenter')
    expect(nav.classes()).toContain('w-[220px]')
    // Rail unchanged → the content behind it never reflows.
    expect(rail.classes()).toContain('w-[56px]')
    expect(nav.classes()).toContain('shadow-[4px_0_16px_rgba(0,0,0,0.18)]')
  })

  it('widens the rail instead of floating once pinned', async () => {
    const { AppSidebar, useSidebar } = await load()
    useSidebar().togglePinned()
    const w = mount(AppSidebar, { props })
    expect(w.get('[data-testid="sidebar-rail"]').classes()).toContain('w-[220px]')
    expect(w.get('nav').classes()).not.toContain('shadow-[4px_0_16px_rgba(0,0,0,0.18)]')
  })

  it('expands on keyboard focus and collapses when focus leaves the nav', async () => {
    const { AppSidebar } = await load()
    const w = mount(AppSidebar, { props })
    const nav = w.get('nav')
    await nav.trigger('focusin')
    expect(nav.classes()).toContain('w-[220px]')

    await nav.trigger('focusout', { relatedTarget: document.createElement('button') })
    expect(nav.classes()).toContain('w-[56px]')
  })

  // The floating nav covers the left 220px of the view it just navigated to, so
  // a nav pick with the pointer still on it would swallow the next click there.
  it('collapses after a nav pick while the pointer is still on it', async () => {
    const { AppSidebar } = await load()
    const w = mount(AppSidebar, { props })
    const nav = w.get('nav')
    await nav.trigger('mouseenter')
    expect(nav.classes()).toContain('w-[220px]')

    await w.findAll('button').find(b => b.text().includes('Pipeline'))!.trigger('click')
    expect(nav.classes()).toContain('w-[56px]')
  })

  // A browser focuses the button as part of the click, which `trigger('click')`
  // alone does not reproduce. Re-picking the active view is the case with no
  // safety net: App.vue only moves focus to #main-content when activeView
  // actually changes, so nothing else would ever collapse the nav again.
  it('collapses after a nav pick that also focuses the item', async () => {
    const { AppSidebar } = await load()
    const w = mount(AppSidebar, { props, attachTo: document.body })
    const nav = w.get('nav')
    await nav.trigger('mouseenter')

    const dashboard = w.findAll('button').find(b => b.text().includes('Agents'))!
    await dashboard.trigger('focusin')
    await dashboard.trigger('click')

    expect(nav.classes()).toContain('w-[56px]')
    await nav.trigger('mouseleave')
    expect(nav.classes()).toContain('w-[56px]')
  })

  it('expands again once the pointer has left and comes back', async () => {
    const { AppSidebar } = await load()
    const w = mount(AppSidebar, { props })
    const nav = w.get('nav')
    await nav.trigger('mouseenter')
    await w.findAll('button').find(b => b.text().includes('Pipeline'))!.trigger('click')

    await nav.trigger('mouseleave')
    await nav.trigger('mouseenter')
    expect(nav.classes()).toContain('w-[220px]')
  })

  it('leaves keyboard expansion untouched by a pointer suppression', async () => {
    const { AppSidebar } = await load()
    const w = mount(AppSidebar, { props })
    const nav = w.get('nav')
    await nav.trigger('mouseenter')
    await w.findAll('button').find(b => b.text().includes('Pipeline'))!.trigger('click')
    expect(nav.classes()).toContain('w-[56px]')

    await nav.trigger('focusin')
    expect(nav.classes()).toContain('w-[220px]')
  })

  it('keeps the nav open while focus moves between its own items', async () => {
    const { AppSidebar } = await load()
    const w = mount(AppSidebar, { props })
    const nav = w.get('nav')
    await nav.trigger('focusin')
    await nav.trigger('focusout', { relatedTarget: nav.element.querySelector('button') })
    expect(nav.classes()).toContain('w-[220px]')
  })
})

describe('appSidebar — 3B', () => {
  // L: canonical product name.
  it('names the product Agent Dashboard', async () => {
    const { AppSidebar, useSidebar } = await load()
    useSidebar().togglePinned()
    const w = mount(AppSidebar, { props })
    expect(w.text()).toContain('Agent Dashboard')
    expect(w.text()).not.toContain('Agent Overview')
  })

  // E: the permanent pulse identified by the 3A audit is gone.
  it('shows the live connection as a static live-coloured dot', async () => {
    const { AppSidebar, useSidebar } = await load()
    useSidebar().togglePinned()
    const w = mount(AppSidebar, { props })
    const dot = w.get('[role="status"] span')
    expect(dot.classes().join(' ')).not.toMatch(/animate-|motion-/)
    expect(dot.classes()).toContain('bg-live-dot')
  })
})

describe('appSidebar — 3B.1 status truth', () => {
  // Comments stripped: the status line's own comment names useAgents to say
  // where the prop comes from, which is not the sidebar calling it.
  const sidebarSource = readFileSync(resolve(process.cwd(), 'src/components/shell/AppSidebar.vue'), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  const appSource = readFileSync(resolve(process.cwd(), 'src/App.vue'), 'utf8')

  // A: nothing measures global health, so nothing may claim it.
  it('makes no global health claim, connected or not', async () => {
    const { AppSidebar, useSidebar } = await load()
    useSidebar().togglePinned()
    for (const live of [true, false]) {
      const text = mount(AppSidebar, { props: { ...props, live } }).get('[data-testid="sidebar-live-status"]').text()
      expect(text).not.toMatch(/all systems|normal|healthy|no (failures|errors)/i)
    }
  })

  // B: the wording names the one thing the signal measures.
  it('words the status after its only source, the agents feed', async () => {
    // The prop is the agents feed's own live flag (proven in useAgents.test.ts),
    // not a flag App.vue assembles from other state.
    expect(appSource).toMatch(/const\s*\{[^}]*\blive\b[^}]*\}\s*=\s*useAgents\(/)
    expect(appSource).not.toMatch(/const live\s*=/)
    const { AppSidebar, useSidebar } = await load()
    useSidebar().togglePinned()
    const status = mount(AppSidebar, { props }).get('[data-testid="sidebar-live-status"]')
    expect(status.text()).toBe('Agent updates live')
    expect(status.text()).not.toMatch(/runtime|system|machine|localscope/i)
    expect(status.get('span').classes()).toContain('bg-live-dot')
  })

  // E: the line is a pure function of a prop — no request or timer of its own.
  it('opens no request and starts no timer for the status line', () => {
    expect(sidebarSource).not.toMatch(/setInterval|useIntervalFn|useTimeoutPoll|fetch\(|EventSource|useLocalMachine|useAgents/)
  })
})

const sidebarSource = readFileSync(resolve(process.cwd(), 'src/components/shell/AppSidebar.vue'), 'utf8')

describe('appSidebar — 3F navigation', () => {
  it('lists the destinations in order, with Terminal no longer among them', async () => {
    const { AppSidebar, useSidebar } = await load()
    useSidebar().togglePinned()
    const w = mount(AppSidebar, { props })
    const order = ['Command', 'Agents', 'LocalScope', 'System', 'Pipeline', 'Schedules', 'Workflows', 'Projects', 'Cost', 'Eval', 'Settings']
    // Each nav button also carries its icon glyph and any badge, so match by the label it contains.
    const labels = w.findAll('nav button')
      .map(b => [...order, 'Terminal', 'Overview'].find(label => b.text().includes(label)))
      .filter((label): label is string => Boolean(label))
    expect(labels).toEqual(order)
  })

  it('opens Command from its entry', async () => {
    const { AppSidebar, useViewState } = await load()
    useViewState().activeView.value = 'pipeline'
    const w = mount(AppSidebar, { props })
    await w.findAll('button').find(b => b.text().includes('Command'))!.trigger('click')
    expect(useViewState().activeView.value).toBe('cockpit')
  })

  it('states working agents and the Needs you count in one line when both are known', async () => {
    const { AppSidebar, useSidebar } = await load()
    useSidebar().togglePinned()
    const w = mount(AppSidebar, { props: { ...props, workingCount: 3, attentionCount: 1 } })
    expect(w.get('[data-testid="sidebar-environment"]').text()).toBe('3 working · 1 needs you')
  })

  it('omits the environment line before agents are observed rather than claiming zero', async () => {
    const { AppSidebar, useSidebar } = await load()
    useSidebar().togglePinned()
    const w = mount(AppSidebar, { props: { ...props, workingCount: null } })
    expect(w.find('[data-testid="sidebar-environment"]').exists()).toBe(false)
  })

  it('reads no LocalScope snapshot, so it starts no poller on every page', () => {
    expect(sidebarSource).not.toMatch(/useLocalMachine|features\/localscope/)
  })
})
