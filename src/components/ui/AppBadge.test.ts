import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AppBadge from './AppBadge.vue'

type Variant = 'active' | 'working' | 'waiting' | 'idle' | 'finished' | 'completed' | 'error' | 'info'

const ALL: Variant[] = ['active', 'working', 'waiting', 'idle', 'finished', 'completed', 'error', 'info']

/** The states where the system is genuinely doing something right now. */
const MOVING: Variant[] = ['working']

function dot(variant: Variant) {
  return mount(AppBadge, { props: { variant } }).get('[data-testid="state-dot"]')
}

describe('appBadge semantic state', () => {
  /*
   * Queried rather than read off the wrapper root: the template opens with an
   * HTML comment, which makes the component a fragment, so `wrapper.attributes()`
   * describes the mount container and not the badge.
   */
  it('exposes the state as data, so it is assertable without reading classes', () => {
    for (const variant of ALL) {
      const badge = mount(AppBadge, { props: { variant } }).get('[data-state]')
      expect(badge.attributes('data-state')).toBe(variant)
    }
  })

  /*
   * ANIMATION = INFORMATION. A badge moves only while something is happening;
   * every resting state must be visually still. Without this, motion stops
   * being a signal and becomes texture.
   */
  it('animates only the states that are actually doing something', () => {
    for (const variant of ALL) {
      const classes = dot(variant).classes()
      const moves = classes.some(c => c.startsWith('motion-'))
      expect(moves, `${variant} motion`).toBe(MOVING.includes(variant))
    }
  })

  it('never uses the generic pulse for state', () => {
    // animate-pulse throbs identically regardless of what is happening, which
    // is what the semantic motion classes exist to replace.
    for (const variant of ALL)
      expect(dot(variant).classes()).not.toContain('animate-pulse')
  })

  it('uses the semantic state colour tokens rather than raw palette steps', () => {
    for (const variant of ALL) {
      const classes = dot(variant).classes().join(' ')
      expect(classes, `${variant} dot colour`).toMatch(/bg-state-/)
    }
  })

  it('gives working its own state colour, distinct from a resting badge', () => {
    expect(dot('working').classes()).toContain('bg-state-working')
    expect(dot('idle').classes()).toContain('bg-state-idle')
    expect(dot('error').classes()).toContain('bg-state-error')
    expect(dot('waiting').classes()).toContain('bg-state-waiting')
  })

  /*
   * Motion and colour are both emphasis. The state itself has to survive
   * without either — a reduced-motion viewer, a greyscale screenshot, or a
   * screen reader must all still get it.
   */
  it('carries the state as text as well as colour, for AT and reduced motion', () => {
    const wrapper = mount(AppBadge, { props: { variant: 'error' } })
    expect(wrapper.text()).toContain('Error')
    expect(wrapper.get('.sr-only').text()).toBe('Error')
  })

  it('renders the decorative dot as aria-hidden so it is not announced twice', () => {
    expect(dot('working').attributes('aria-hidden')).toBe('true')
  })

  it('honours an explicit label but keeps it in both encodings', () => {
    const wrapper = mount(AppBadge, { props: { variant: 'working', label: 'Compiling' } })
    expect(wrapper.get('.sr-only').text()).toBe('Compiling')
    expect(wrapper.text()).toContain('Compiling')
  })

  it('falls back to the shared status vocabulary', () => {
    // 'waiting' is deliberately shown as "Quiet"; the label authority is
    // statusColors.ts, not this component.
    expect(mount(AppBadge, { props: { variant: 'waiting' } }).get('.sr-only').text()).toBe('Quiet')
  })
})
