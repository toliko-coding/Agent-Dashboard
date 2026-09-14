import type { Agent } from '@/types'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { axe } from '@/utils/testA11y'
import AgentGlyph from './AgentGlyph.vue'

const agent = (o: Partial<Agent> = {}) => ({ entrypoint: 'cli', liveInjectable: false, internalProcess: false, projectPath: '/Users/me/secret-client', ...o }) as Agent

describe('agentGlyph', () => {
  it('names its category for assistive technology and in a tooltip', () => {
    const glyph = mount(AgentGlyph, { props: { agent: agent({ pipelineTaskId: 't1' }) } }).get('[data-testid="agent-glyph"]')
    expect(glyph.attributes('role')).toBe('img')
    expect(glyph.attributes('aria-label')).toBe('Pipeline task agent')
    expect(glyph.attributes('title')).toBe('Pipeline task agent')
    expect(glyph.attributes('data-category')).toBe('task')
  })

  it('draws a different glyph per category', () => {
    const drawn = (o: Partial<Agent>) => mount(AgentGlyph, { props: { agent: agent(o) } }).get('svg').html()
    const all = [drawn({}), drawn({ liveInjectable: true }), drawn({ entrypoint: 'desktop' }), drawn({ pipelineTaskId: 't' }), drawn({ internalProcess: true })]
    expect(new Set(all).size).toBe(all.length)
  })

  it('is structure, not state: no state colour, no motion, no folder', () => {
    const html = mount(AgentGlyph, { props: { agent: agent({ liveInjectable: true }) } }).html()
    expect(html).not.toMatch(/state-|motion-|animate-|success|warning|danger/)
    expect(html).not.toContain('secret-client')
  })

  it('has no axe violations', async () => {
    const w = mount(AgentGlyph, { props: { agent: agent() }, attachTo: document.body })
    expect(await axe(w.element as HTMLElement)).toHaveNoViolations()
    w.unmount()
  })
})
