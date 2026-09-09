import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MetricCard from './MetricCard.vue'

/*
 * The rule this component exists to enforce: a metric with no collector must
 * never render 0. "0" asserts the system measured and found none; an
 * unavailable metric measured nothing at all.
 */
describe('metricCard', () => {
  it('renders the value when ready', () => {
    const w = mount(MetricCard, { props: { label: 'Active Agents', state: 'ready', value: 5 } })
    expect(w.text()).toContain('5')
    expect(w.attributes('data-state')).toBe('ready')
  })

  it('renders a real 0 for empty — measured, found none', () => {
    const w = mount(MetricCard, { props: { label: 'Projects', state: 'empty' } })
    expect(w.text()).toContain('0')
    expect(w.attributes('data-state')).toBe('empty')
  })

  it('never renders 0 when unavailable — it renders a dash and a reason', () => {
    const w = mount(MetricCard, {
      props: { label: 'Network', state: 'notAsked', message: 'Not collected yet' },
    })
    expect(w.text()).not.toContain('0')
    expect(w.text()).toContain('—')
    expect(w.text()).toContain('Not collected yet')
  })

  it('ignores a value passed with an unavailable state', () => {
    const w = mount(MetricCard, {
      props: { label: 'Emulators', state: 'notAsked', value: 7, message: 'Not collected yet' },
    })
    expect(w.text()).not.toContain('7')
  })

  it('announces the unavailable state to assistive tech', () => {
    const w = mount(MetricCard, { props: { label: 'Network', state: 'notAsked' } })
    expect(w.find('.sr-only').text()).toContain('not collected yet')
  })

  it('shows an error distinctly from unavailable', () => {
    const w = mount(MetricCard, {
      props: { label: 'Projects', state: 'failed', message: 'Request failed' },
    })
    expect(w.get('[role="alert"]').text()).toContain('Request failed')
    // The value slot shows a dash, not a count — asserted on the value element
    // rather than the whole card, so an error message containing a digit
    // (e.g. "HTTP 500") cannot make this pass or fail by accident.
    expect(w.get('[aria-hidden="true"].text-danger-text').text()).toBe('—')
  })

  it('marks loading busy and shows no number', () => {
    const w = mount(MetricCard, { props: { label: 'Projects', state: 'loading' } })
    expect(w.attributes('aria-busy')).toBe('true')
    expect(w.text()).not.toContain('0')
  })
})
