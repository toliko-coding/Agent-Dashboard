import type { Agent } from '@/types'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { AGENT_PURPOSES } from '@/utils/agentPurpose'
import { axe } from '@/utils/testA11y'
import AgentGlyph from './AgentGlyph.vue'

const agent = (o: Partial<Agent> = {}) => ({ projectPath: '/Users/me/secret-client', projectName: 'WalletRadar_web', liveInjectable: true, ...o }) as Agent

describe('agentGlyph — purpose icon (3N.1)', () => {
  it('h: draws the category the user chose, named for assistive technology and in a tooltip', () => {
    const glyph = mount(AgentGlyph, { props: { agent: agent({ category: 'document' }) } }).get('[data-testid="agent-glyph"]')
    expect(glyph.attributes('role')).toBe('img')
    expect(glyph.attributes('aria-label')).toBe('Documents agent')
    expect(glyph.attributes('title')).toBe('Documents agent')
    expect(glyph.attributes('data-category')).toBe('document')
  })

  it('i: draws the same neutral general icon when nothing was chosen, whatever the folder or launch', () => {
    for (const o of [{}, { liveInjectable: false, entrypoint: 'desktop' }, { pipelineTaskId: 't1', projectName: 'Portfolio' }] as Partial<Agent>[]) {
      const glyph = mount(AgentGlyph, { props: { agent: agent(o) } }).get('[data-testid="agent-glyph"]')
      expect(glyph.attributes('data-category')).toBe('general')
      expect(glyph.attributes('aria-label')).toBe('General agent')
    }
  })

  it('previews a category that is not yet an agent\'s', () => {
    expect(mount(AgentGlyph, { props: { purpose: 'data' } }).get('[data-testid="agent-glyph"]').attributes('aria-label')).toBe('Data & trading agent')
  })

  it('draws a different glyph for every category', () => {
    const drawn = AGENT_PURPOSES.map(p => mount(AgentGlyph, { props: { purpose: p.value } }).get('svg').html())
    expect(new Set(drawn).size).toBe(AGENT_PURPOSES.length)
  })

  it('is presentation, not state: no state colour, no motion, no folder', () => {
    const html = mount(AgentGlyph, { props: { agent: agent({ category: 'runtime' }) } }).html()
    expect(html).not.toMatch(/state-|motion-|animate-|success|warning|danger/)
    expect(html).not.toContain('secret-client')
  })

  it('has no axe violations', async () => {
    const w = mount(AgentGlyph, { props: { agent: agent({ category: 'web' }) }, attachTo: document.body })
    expect(await axe(w.element as HTMLElement)).toHaveNoViolations()
    w.unmount()
  })
})
