import type { Agent } from '../types'
import { describe, expect, it } from 'vitest'
import { AGENT_PURPOSE_PATHS, AGENT_PURPOSES, agentPurpose, agentPurposeLabel, DEFAULT_AGENT_PURPOSE, isAgentPurpose } from './agentPurpose'

const agent = (o: Partial<Agent> = {}) => ({ projectName: 'WalletRadar_web', projectPath: '/Users/me/WalletRadar_web', ...o }) as Agent

describe('agentPurpose', () => {
  it('uses the category the user chose', () => {
    expect(agentPurpose(agent({ category: 'document' }))).toBe('document')
    expect(agentPurpose(agent({ category: 'data' }))).toBe('data')
  })

  // I: no choice → the same neutral glyph for everyone, never a guess.
  it('falls back to the neutral general icon, never inferring from the folder or repository', () => {
    expect(DEFAULT_AGENT_PURPOSE).toBe('general')
    expect(agentPurpose(agent())).toBe('general')
    expect(agentPurpose(agent({ category: '' }))).toBe('general')
    expect(agentPurpose(agent({ projectName: 'web-portfolio', workspace: { id: 'w', name: 'docs', kind: 'plain' } as Agent['workspace'] }))).toBe('general')
  })

  it('does not trust an unknown category from the wire', () => {
    expect(isAgentPurpose('admin')).toBe(false)
    expect(agentPurpose(agent({ category: 'admin' }))).toBe('general')
  })

  it('names every category in words and draws each one differently', () => {
    expect(AGENT_PURPOSES.map(p => p.value)).toEqual(['general', 'development', 'web', 'document', 'research', 'runtime', 'data'])
    expect(agentPurposeLabel('runtime')).toBe('Runtime & systems')
    const drawings = AGENT_PURPOSES.map(p => AGENT_PURPOSE_PATHS[p.value].join(' '))
    expect(new Set(drawings).size).toBe(drawings.length)
  })
})
