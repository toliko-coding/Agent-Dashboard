import type { Agent } from '../types'
import { describe, expect, it } from 'vitest'
import { agentTitle, workActivity } from './agentLabels'

const agent = (o: Partial<Agent>) => ({ sessionId: '3f2a1b9c-0000-4000-8000-000000000000', provider: 'claude', projectName: 'my-folder', ...o }) as Agent

describe('agentTitle', () => {
  it('uses the pipeline task title when there is one', () => {
    expect(agentTitle(agent({ pipelineTaskTitle: 'Fix login' }))).toBe('Fix login')
  })

  it('otherwise names the provider and a short session id, never the folder', () => {
    expect(agentTitle(agent({}))).toBe('Claude session 3f2a1b9c')
    expect(agentTitle(agent({ provider: 'codex' }))).toBe('Codex session 3f2a1b9c')
    expect(agentTitle(agent({}))).not.toContain('my-folder')
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
