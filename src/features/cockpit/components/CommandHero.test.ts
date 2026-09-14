import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { axe } from '@/utils/testA11y'
import CommandHero from './CommandHero.vue'

// 3N.2.3: Command's identity band — a fixed command network driven only by real state.

type Props = InstanceType<typeof CommandHero>['$props']
const hero = (props: Partial<Props> = {}) => mount(CommandHero, { props: { live: true, working: 0, needsYou: 0, runtime: 'ok', ...props } as Props })
const motif = (w: ReturnType<typeof hero>) => w.get('[data-testid="command-hero-motif"]')
const node = (w: ReturnType<typeof hero>, key: string) => w.get(`[data-node="${key}"]`).attributes('data-state')
const signals = (w: ReturnType<typeof hero>) => w.findAll('[data-signal]').map(s => s.attributes('data-signal'))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('commandHero', () => {
  it('names the page and says what it is', () => {
    const w = hero()
    // The topbar already carries the page's h1; this is its section heading.
    expect(w.get('h2').text()).toBe('Command Center')
    expect(w.text()).toContain('Your AI agents. One control center.')
  })

  it('draws the same five nodes whatever the state: no random or per-item topology', () => {
    const quiet = hero()
    const busy = hero({ working: 7, needsYou: 3, runtime: 'degraded' })
    const keys = (w: ReturnType<typeof hero>) => w.findAll('[data-node]').map(n => n.attributes('data-node'))
    expect(keys(quiet)).toEqual(['dashboard', 'agents', 'runtime', 'workspaces', 'needs'])
    expect(keys(busy)).toEqual(keys(quiet))
    const geometry = (w: ReturnType<typeof hero>) => w.findAll('.cc-net-line, circle').map(e => `${e.attributes('d')}${e.attributes('cx')}${e.attributes('cy')}`)
    expect(geometry(busy)).toEqual(geometry(quiet).concat(geometry(busy).slice(geometry(quiet).length)))
    expect(hero().html()).toBe(hero().html())
    // No numbers, charts or counts: the network never prints a value.
    expect(motif(busy).text()).not.toMatch(/\d/)
    expect(motif(busy).attributes('aria-hidden')).toBe('true')
  })

  it('live updates: a slow signal to Agents and to a fresh Runtime; reconnecting stops every signal and dims', () => {
    const live = hero()
    expect(signals(live)).toEqual(['agents', 'runtime'])
    expect(node(live, 'dashboard')).toBe('active')
    expect(live.get('[data-testid="command-hero-live"]').text()).toBe('Agent updates live')

    const down = hero({ live: false })
    expect(signals(down)).toEqual([])
    expect(motif(down).attributes('data-live')).toBe('false')
    expect(node(down, 'dashboard')).toBe('attention')
    expect(down.get('[data-testid="command-hero-live"]').text()).toBe('Agent updates reconnecting')
  })

  it('a working agent lights Agents and Workspaces and adds a signal toward Workspaces', () => {
    const w = hero({ working: 2 })
    expect(node(w, 'agents')).toBe('active')
    expect(node(w, 'workspaces')).toBe('active')
    expect(signals(w)).toContain('workspaces')
    expect(node(hero({ working: 0 }), 'agents')).toBe('idle')
    expect(node(hero({ working: null }), 'agents')).toBe('dim')
  })

  it('needs you turns one node amber; an unknown queue stays dim, never zero', () => {
    expect(node(hero({ needsYou: 1 }), 'needs')).toBe('attention')
    expect(hero({ needsYou: 1 }).find('.cc-net-halo').exists()).toBe(true)
    expect(node(hero({ needsYou: 0 }), 'needs')).toBe('idle')
    expect(node(hero({ needsYou: null }), 'needs')).toBe('dim')
  })

  it('localScope stale or unavailable dims the Runtime branch and stops its signal', () => {
    for (const runtime of ['stale', 'unavailable', null] as const) {
      const w = hero({ runtime })
      expect(node(w, 'runtime')).toBe('dim')
      expect(w.get('[data-testid="command-hero-runtime-link"]').attributes('data-dim')).toBe('true')
      expect(signals(w)).not.toContain('runtime')
    }
    expect(signals(hero({ runtime: 'degraded' }))).toContain('runtime')
  })

  it('reduced motion draws no moving signal or halo at all', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), addEventListener() {}, removeEventListener() {} }))
    const w = hero({ working: 2, needsYou: 1 })
    await w.vm.$nextTick()
    expect(signals(w)).toEqual([])
    expect(w.find('.cc-net-halo').exists()).toBe(false)
    expect(node(w, 'needs')).toBe('attention')
  })

  it('pauses while the tab is hidden', async () => {
    const w = hero()
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    await w.vm.$nextTick()
    expect(motif(w).attributes('data-paused')).toBe('true')
  })

  it('fetches nothing of its own', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    hero({ working: 1, needsYou: 1 })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('has no axe violations', async () => {
    const w = mount(CommandHero, { props: { live: true, working: 1, needsYou: 1, runtime: 'ok' }, attachTo: document.body })
    expect(await axe(w.element as Element)).toHaveNoViolations()
    w.unmount()
  })
})
