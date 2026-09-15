import type { StageRun } from '@/types'
import { describe, expect, it } from 'vitest'
import { failureCategoryOf, runStateOf, runTimeline, stageRole } from './runState'

// ADR-0014: the canonical run view over task + stage_run, from persisted state only.

function run(o: Partial<StageRun>): StageRun {
  return {
    id: 'r',
    taskId: 't',
    stage: 'implementation',
    sessionId: null,
    sessionName: null,
    pid: null,
    status: 'running',
    startedAt: '2026-09-15T10:00:00Z',
    endedAt: null,
    iteration: 0,
    output: null,
    tokensUsed: 0,
    costCents: 0,
    lastGrantAt: null,
    ...o,
  }
}

describe('runStateOf', () => {
  it('maps task stage and latest stage-run status to the seven canonical states', () => {
    expect(runStateOf({ currentStage: 'backlog', latestStageRunStatus: null })).toBe('queued')
    expect(runStateOf({ currentStage: 'ready', latestStageRunStatus: null })).toBe('queued')
    expect(runStateOf({ currentStage: 'implementation', latestStageRunStatus: 'pending' })).toBe('preparing')
    expect(runStateOf({ currentStage: 'implementation', latestStageRunStatus: 'requeued' })).toBe('preparing')
    expect(runStateOf({ currentStage: 'implementation', latestStageRunStatus: 'running' })).toBe('running')
    expect(runStateOf({ currentStage: 'plan_review', latestStageRunStatus: 'awaiting_user' })).toBe('waiting_user')
    expect(runStateOf({ currentStage: 'implementation', latestStageRunStatus: 'failed' })).toBe('failed')
    expect(runStateOf({ currentStage: 'done', latestStageRunStatus: 'done' })).toBe('succeeded')
    expect(runStateOf({ currentStage: 'cancelled', latestStageRunStatus: 'running' })).toBe('cancelled')
  })

  it('never reports success because a stage ended: only a done task succeeds', () => {
    expect(runStateOf({ currentStage: 'implementation', latestStageRunStatus: 'done' })).toBe('preparing')
    expect(runStateOf({ currentStage: 'finalization', latestStageRunStatus: 'done' })).toBe('preparing')
  })

  it('a task parked on pending permission requests waits for the user', () => {
    expect(runStateOf({ currentStage: 'implementation', latestStageRunStatus: 'failed', blockedByPendingPermissions: true })).toBe('waiting_user')
  })
})

describe('failureCategoryOf', () => {
  it('reports only the categories persisted state proves', () => {
    expect(failureCategoryOf({ currentStage: 'cancelled', latestStageRunStatus: null })).toBe('cancelled')
    expect(failureCategoryOf({ currentStage: 'implementation', latestStageRunStatus: 'failed', blockedByPendingPermissions: true })).toBe('permission_required')
    expect(failureCategoryOf({ currentStage: 'implementation', latestStageRunStatus: 'failed' })).toBe('agent_failed')
    expect(failureCategoryOf({ currentStage: 'implementation', latestStageRunStatus: 'running' })).toBeNull()
  })
})

describe('runTimeline', () => {
  it('shows queued before anything runs', () => {
    const steps = runTimeline({ currentStage: 'backlog', latestStageRunStatus: null }, [])
    expect(steps.map(s => [s.key, s.state])).toEqual([
      ['queued', 'current'],
      ['preparing', 'pending'],
      ['implementation', 'pending'],
      ['self_review', 'pending'],
      ['finalization', 'pending'],
      ['result', 'pending'],
    ])
  })

  it('marks the developer current while its run is running, with its role', () => {
    const steps = runTimeline({ currentStage: 'implementation', latestStageRunStatus: 'running' }, [run({ status: 'running' })])
    const dev = steps.find(s => s.key === 'implementation')!
    expect(dev.state).toBe('current')
    expect(dev.role).toBe('developer')
    expect(steps.find(s => s.key === 'result')!.state).toBe('pending')
  })

  it('uses the latest iteration of a stage and shows a review loop back to the developer', () => {
    const runs = [
      run({ id: 'a', stage: 'implementation', status: 'done', iteration: 0 }),
      run({ id: 'b', stage: 'self_review', status: 'done', iteration: 0 }),
      run({ id: 'c', stage: 'implementation', status: 'running', iteration: 1, startedAt: '2026-09-15T11:00:00Z' }),
    ]
    const steps = runTimeline({ currentStage: 'implementation', latestStageRunStatus: 'running' }, runs)
    expect(steps.find(s => s.key === 'implementation')!.run!.id).toBe('c')
    expect(steps.find(s => s.key === 'implementation')!.state).toBe('current')
  })

  it('a failed run fails its step and the result; success needs a done task', () => {
    const failed = runTimeline({ currentStage: 'implementation', latestStageRunStatus: 'failed' }, [run({ status: 'failed' })])
    expect(failed.find(s => s.key === 'implementation')!.state).toBe('failed')
    expect(failed.find(s => s.key === 'result')!.state).toBe('failed')
    const done = runTimeline({ currentStage: 'done', latestStageRunStatus: 'done' }, [run({ status: 'done' }), run({ id: 'f', stage: 'finalization', status: 'done' })])
    expect(done.find(s => s.key === 'result')!.state).toBe('done')
    expect(done.find(s => s.key === 'self_review')!.state).toBe('skipped')
  })

  it('names roles for agent stages only', () => {
    expect(stageRole('implementation')).toBe('developer')
    expect(stageRole('self_review')).toBe('reviewer')
    expect(stageRole('done')).toBeNull()
  })
})
