import type { Agent } from '../types'
import { describe, expect, it } from 'vitest'
import { agentCategory, agentKind } from './agentCategory'

const agent = (o: Partial<Agent> = {}) => ({ entrypoint: 'cli', liveInjectable: false, internalProcess: false, projectPath: '/Users/me/secret', ...o }) as Agent

describe('agentCategory — from stated facts only', () => {
  it('a pipeline task outranks every other fact', () => {
    expect(agentCategory(agent({ pipelineTaskId: 't1', liveInjectable: true, entrypoint: 'desktop' }))).toBe('task')
  })

  it('names Claude Code internal processes', () => {
    expect(agentCategory(agent({ internalProcess: true, liveInjectable: true }))).toBe('internal')
  })

  it('names desktop sessions by their entrypoint', () => {
    expect(agentCategory(agent({ entrypoint: 'desktop' }))).toBe('desktop')
  })

  it('names a session the dashboard can attach to as a terminal session', () => {
    expect(agentCategory(agent({ liveInjectable: true }))).toBe('terminal')
  })

  it('falls back to a command-line session, whatever the folder', () => {
    expect(agentCategory(agent())).toBe('cli')
    expect(agentCategory(agent({ entrypoint: 'unknown', projectPath: '/elsewhere' }))).toBe('cli')
  })

  it('gives every category words, so it never depends on the glyph', () => {
    expect(agentKind(agent({ pipelineTaskId: 't' })).label).toBe('Pipeline task agent')
    expect(agentKind(agent()).label).toBe('Command-line session')
  })
})
