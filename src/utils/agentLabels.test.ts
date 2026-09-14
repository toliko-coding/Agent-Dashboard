import type { Agent } from '../types'
import { describe, expect, it } from 'vitest'
import { agentSessionLabel, agentTechnical, agentTitle, agentTopic, workActivity } from './agentLabels'

const agent = (o: Partial<Agent>) => ({ sessionId: '3f2a1b9c-0000-4000-8000-000000000000', provider: 'claude', projectName: 'my-folder', ...o }) as Agent

describe('agentTitle', () => {
  it('uses the pipeline task title when there is one', () => {
    expect(agentTitle(agent({ pipelineTaskTitle: 'Fix login' }))).toBe('Fix login')
  })

  // 3N: the session's own name, as Claude Code shows it.
  it('uses the session title after a pipeline task, never over it', () => {
    expect(agentTitle(agent({ title: 'Fix login redirect', titleSource: 'ai' }))).toBe('Fix login redirect')
    expect(agentTitle(agent({ title: 'Billing export', pipelineTaskTitle: 'Task title' }))).toBe('Task title')
  })

  it('ignores a blank title', () => {
    expect(agentTitle(agent({ title: '   ' }))).toBe('Claude session 3f2a1b9c')
  })

  it('keeps the session handle available beside a human name', () => {
    expect(agentSessionLabel(agent({ title: 'Fix login redirect' }))).toBe('Claude session 3f2a1b9c')
  })

  it('otherwise names the provider and a short session id, never the folder', () => {
    expect(agentTitle(agent({}))).toBe('Claude session 3f2a1b9c')
    expect(agentTitle(agent({ provider: 'codex' }))).toBe('Codex session 3f2a1b9c')
    expect(agentTitle(agent({}))).not.toContain('my-folder')
  })
})

// 3N.1: who (a persistent name) is not what (the session's title).
describe('agent identity hierarchy', () => {
  it('a: an explicit display name wins over the session title, a task and the session id', () => {
    expect(agentTitle(agent({ displayName: 'Resume Editor', title: 'Tidy the CV layout', pipelineTaskTitle: 'Task' }))).toBe('Resume Editor')
  })

  it('b: without a name, the Claude session title is the name', () => {
    expect(agentTitle(agent({ displayName: '', title: 'Fix responsive navbar spacing' }))).toBe('Fix responsive navbar spacing')
  })

  it('c: without either, the provider and short session id', () => {
    expect(agentTitle(agent({ displayName: '  ' }))).toBe('Claude session 3f2a1b9c')
  })

  it('f, G: neither the Project nor the folder name ever becomes the name', () => {
    const named = agentTitle(agent({ projectName: 'Portfolio', projectPath: '/Users/me/Portfolio', cwd: '/Users/me/Portfolio' }))
    expect(named).toBe('Claude session 3f2a1b9c')
    expect(named).not.toContain('Portfolio')
  })

  it('n: a named agent keeps the session title as its topic, and an unnamed one never repeats it', () => {
    expect(agentTopic(agent({ displayName: 'Portfolio', title: 'Refactoring responsive navigation' }))).toBe('Refactoring responsive navigation')
    expect(agentTopic(agent({ title: 'Refactoring responsive navigation' }))).toBeNull()
    expect(agentTopic(agent({ displayName: 'Portfolio' }))).toBeNull()
  })

  it('gives a named agent a technical handle, and none when the name already is the handle', () => {
    expect(agentTechnical(agent({ displayName: 'Portfolio' }))).toBe('Claude · 3f2a1b9c')
    expect(agentTechnical(agent({ title: 'Some title', provider: 'codex' }))).toBe('Codex · 3f2a1b9c')
    expect(agentTechnical(agent({}))).toBeNull()
  })
})

describe('agentTitle — incomplete payloads', () => {
  it('still names an agent whose payload carries no session id', () => {
    expect(agentTitle({ provider: 'claude' } as Agent)).toBe('Claude session')
    expect(agentTitle({} as Agent)).toBe('Agent session')
  })
})

describe('workActivity', () => {
  it('names an open tool call by its tool only', () => {
    expect(workActivity(agent({ pendingToolUse: { id: 't', tool: 'Bash', pattern: 'rm -rf /', patternDisplay: 'rm -rf /' } }))).toEqual({ state: 'tool', label: 'Using Bash' })
  })

  it('does not call an unanswered question a tool at work', () => {
    expect(workActivity(agent({ pendingToolUse: { id: 't', tool: 'AskUserQuestion', pattern: '', patternDisplay: '' } }))).toEqual({ state: 'working', label: 'Working' })
  })
})
