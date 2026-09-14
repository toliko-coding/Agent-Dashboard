import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { axe } from '@/utils/testA11y'
import CommandHero from './CommandHero.vue'

// 3N.2: Command's identity band — decoration that claims nothing but live updates.
describe('commandHero', () => {
  it('names the page and says what it is', () => {
    const w = mount(CommandHero, { props: { live: true } })
    // The topbar already carries the page's h1; this is its section heading.
    expect(w.get('h2').text()).toBe('Command Center')
    expect(w.text()).toContain('Your AI agents. One control center.')
  })

  it('moves its links only while agent updates are live, and says so in words', () => {
    const live = mount(CommandHero, { props: { live: true } })
    expect(live.find('[data-testid="command-hero-flow"]').exists()).toBe(true)
    expect(live.get('[data-testid="command-hero-live"]').text()).toBe('Agent updates live')

    const down = mount(CommandHero, { props: { live: false } })
    expect(down.find('[data-testid="command-hero-flow"]').exists()).toBe(false)
    expect(down.html()).not.toMatch(/motion-/)
    expect(down.get('[data-testid="command-hero-live"]').text()).toBe('Agent updates reconnecting')
  })

  it('draws no numbers, charts or status of its own: the motif is decoration', () => {
    const w = mount(CommandHero, { props: { live: true } })
    expect(w.get('[data-testid="command-hero-motif"]').attributes('aria-hidden')).toBe('true')
    expect(w.get('[data-testid="command-hero-motif"]').text()).toBe('')
    expect(w.text()).not.toMatch(/\d/)
  })

  it('has no axe violations', async () => {
    const w = mount(CommandHero, { props: { live: true }, attachTo: document.body })
    expect(await axe(w.element as Element)).toHaveNoViolations()
    w.unmount()
  })
})
