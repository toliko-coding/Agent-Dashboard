import type { StageRun } from '@/types'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { axe } from '@/utils/testA11y'
import RunTimeline from '../RunTimeline.vue'

// Phase 4D: a task's run as a timeline, from persisted task + stage_run state only.

function run(o: Partial<StageRun>): StageRun {
  return { id: 'r', taskId: 't', stage: 'implementation', sessionId: null, sessionName: null, pid: null, status: 'running', startedAt: '2026-09-15T10:00:00Z', endedAt: null, iteration: 0, output: null, tokensUsed: 0, costCents: 0, lastGrantAt: null, ...o }
}

describe('runTimeline component', () => {
  it('shows the developer running with a live marker and the canonical run state', () => {
    const w = mount(RunTimeline, { props: { task: { currentStage: 'implementation', latestStageRunStatus: 'running' }, stageRuns: [run({})] } })
    expect(w.get('[data-testid="run-state"]').text()).toBe('Running')
    const dev = w.get('[data-testid="run-step-implementation"]')
    expect(dev.attributes('data-state')).toBe('current')
    expect(dev.text()).toContain('Developer')
    expect(dev.find('[aria-current="step"]').exists()).toBe(true)
    expect(dev.find('.motion-working').exists()).toBe(true)
    expect(w.get('[data-testid="run-step-result"]').attributes('data-state')).toBe('pending')
  })

  it('never marks a step done without a done run, and succeeds only when the task is done', () => {
    const w = mount(RunTimeline, { props: { task: { currentStage: 'self_review', latestStageRunStatus: 'pending' }, stageRuns: [run({ status: 'done' })] } })
    expect(w.get('[data-testid="run-state"]').text()).toBe('Preparing')
    expect(w.get('[data-testid="run-step-implementation"]').attributes('data-state')).toBe('done')
    expect(w.get('[data-testid="run-step-self_review"]').attributes('data-state')).toBe('pending')
    expect(w.get('[data-testid="run-step-result"]').attributes('data-state')).toBe('pending')
    const done = mount(RunTimeline, { props: { task: { currentStage: 'done', latestStageRunStatus: 'done' }, stageRuns: [run({ status: 'done' })] } })
    expect(done.get('[data-testid="run-state"]').text()).toBe('Succeeded')
    expect(done.get('[data-testid="run-step-result"]').attributes('data-state')).toBe('done')
  })

  it('says failure and waiting in words, not colour alone', () => {
    const failed = mount(RunTimeline, { props: { task: { currentStage: 'implementation', latestStageRunStatus: 'failed' }, stageRuns: [run({ status: 'failed' })] } })
    expect(failed.get('[data-testid="run-state"]').text()).toBe('Failed')
    expect(failed.get('[data-testid="run-step-implementation"]').text()).toContain('Failed')
    const waiting = mount(RunTimeline, { props: { task: { currentStage: 'implementation', latestStageRunStatus: 'awaiting_user' }, stageRuns: [run({ status: 'awaiting_user' })] } })
    expect(waiting.get('[data-testid="run-state"]').text()).toBe('Waiting for you')
    expect(waiting.get('[data-testid="run-step-implementation"]').text()).toContain('Waiting for you')
  })

  it('names the persisted failure category and keeps the human reason beside it (Phase 4.1)', () => {
    const w = mount(RunTimeline, { props: { task: { currentStage: 'implementation', latestStageRunStatus: 'failed' }, stageRuns: [run({ status: 'failed', failureCategory: 'invalid_result', output: { error: 'missing required field: changedFiles (array of strings)' } })] } })
    expect(w.get('[data-testid="run-step-category-implementation"]').text()).toContain('Invalid result')
    const failure = w.get('[data-testid="run-failure"]')
    expect(failure.attributes('data-category')).toBe('invalid_result')
    expect(failure.text()).toContain('Developer: Invalid result')
    expect(failure.text()).toContain('missing required field: changedFiles')
  })

  it('never infers a category from the reason text', () => {
    const w = mount(RunTimeline, { props: { task: { currentStage: 'implementation', latestStageRunStatus: 'failed' }, stageRuns: [run({ status: 'failed', output: { error: 'stage timeout: ran 900s (limit 600s)' } })] } })
    expect(w.find('[data-testid="run-step-category-implementation"]').exists()).toBe(false)
    expect(w.get('[data-testid="run-failure"]').attributes('data-category')).toBe('unclassified')
    expect(w.get('[data-testid="run-failure"]').text()).toContain('failed (unclassified)')
  })

  it('has no axe violations', async () => {
    const w = mount(RunTimeline, { props: { task: { currentStage: 'implementation', latestStageRunStatus: 'running' }, stageRuns: [run({})] }, attachTo: document.body })
    expect(await axe(w.element as Element)).toHaveNoViolations()
    w.unmount()
  })
})
