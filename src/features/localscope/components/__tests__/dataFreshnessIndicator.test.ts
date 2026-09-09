import type { Freshness } from '../../snapshot'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import DataFreshnessIndicator from '../DataFreshnessIndicator.vue'

function reading(over: Partial<Freshness> = {}): Freshness {
  return { source: 'ready', collectedAt: null, ageMs: null, degraded: [], ...over } as Freshness
}

const mountIt = (r: Freshness) => mount(DataFreshnessIndicator, { props: { reading: r } })

describe('dataFreshnessIndicator', () => {
  it('renders nothing for a current, complete reading', () => {
    // A badge on every healthy section is noise that hides the ones that matter.
    expect(mountIt(reading()).html()).toBe('<!--v-if-->')
  })

  it('renders nothing for an empty reading that is simply not collected yet', () => {
    expect(mountIt(reading({ source: 'unavailable' })).html()).toBe('<!--v-if-->')
  })

  it('reports a stale reading with its age', () => {
    const w = mountIt(reading({ source: 'stale', ageMs: 180_000 }))
    expect(w.text()).toContain('stale')
    expect(w.text()).toContain('3m ago')
  })

  it('reports a stale reading with no age rather than inventing one', () => {
    const w = mountIt(reading({ source: 'stale', ageMs: null }))
    expect(w.text()).toContain('stale')
    expect(w.text()).not.toContain('·')
  })

  it('names the degraded sources', () => {
    const w = mountIt(reading({ degraded: [{ source: 'simctl', reason: 'x', kind: 'partial' }] }))
    expect(w.text()).toContain('partial · simctl')
  })

  /*
   * The distinction this component exists for. Stale ("may no longer describe
   * the machine") and degraded ("current, one source had trouble") are
   * different claims and must not share an appearance.
   */
  it('distinguishes stale from degraded as separate states', () => {
    const stale = mountIt(reading({ source: 'stale', ageMs: 1000 }))
    const degraded = mountIt(reading({ degraded: [{ source: 'ps', reason: 'x', kind: 'partial' }] }))

    expect(stale.get('[data-freshness]').attributes('data-freshness')).toBe('stale')
    expect(degraded.get('[data-freshness]').attributes('data-freshness')).toBe('degraded')
    expect(stale.get('[data-freshness]').classes()).not.toEqual(degraded.get('[data-freshness]').classes())
  })

  it('gives staleness the warning weight and degradation a muted one', () => {
    // Staleness outranks degradation; spending the alarm colour on the smaller
    // problem is what made the two indistinguishable before.
    expect(mountIt(reading({ source: 'stale', ageMs: 1000 })).get('span').classes()).toContain('text-state-waiting')
    expect(mountIt(reading({ degraded: [{ source: 'ps', reason: 'x', kind: 'partial' }] })).get('span').classes())
      .toContain('text-fg-faint')
  })

  it('outranks degradation when a reading is both stale and degraded', () => {
    const w = mountIt(reading({
      source: 'stale',
      ageMs: 60_000,
      degraded: [{ source: 'simctl', reason: 'x', kind: 'partial' }],
    }))
    expect(w.get('[data-freshness]').attributes('data-freshness')).toBe('stale')
    expect(w.text()).not.toContain('partial')
  })

  it('speaks a sentence to assistive technology, not the compact label', () => {
    const w = mountIt(reading({ source: 'stale', ageMs: 180_000 }))
    const spoken = w.get('.sr-only').text()
    expect(spoken).toContain('3m ago')
    expect(spoken).toContain('out of date')
    // The compact form is decorative and must not be announced twice.
    expect(w.get('[aria-hidden="true"]').text()).toBe('stale · 3m ago')
  })

  it('forwards a test hook so each section keeps a stable handle', () => {
    const w = mount(DataFreshnessIndicator, {
      props: { reading: reading({ source: 'stale', ageMs: 1000 }), testid: 'devices-freshness' },
    })
    expect(w.find('[data-testid="devices-freshness"]').exists()).toBe(true)
  })
})
