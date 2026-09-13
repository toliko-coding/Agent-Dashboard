import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import LivePulse from './LivePulse.vue'

describe('livePulse', () => {
  it('shows Live when connected', () => {
    const w = mount(LivePulse, { props: { live: true } })
    expect(w.text()).toContain('Live')
  })

  it('shows Reconnecting when not live', () => {
    const w = mount(LivePulse, { props: { live: false } })
    expect(w.text()).toContain('Reconnecting')
  })

  // A steady connection is not ongoing activity, so the dot must not pulse.
  it('does not pulse, and shows the live colour rather than success', () => {
    const dot = mount(LivePulse, { props: { live: true } }).get('[data-dot]')
    expect(dot.classes().join(' ')).not.toMatch(/animate-|motion-/)
    expect(dot.classes()).toContain('bg-live-dot')
    expect(dot.classes().join(' ')).not.toMatch(/green|success/)
  })

  it('exposes a status role for screen readers', () => {
    const w = mount(LivePulse, { props: { live: true } })
    expect(w.find('[role="status"]').exists()).toBe(true)
  })
})
