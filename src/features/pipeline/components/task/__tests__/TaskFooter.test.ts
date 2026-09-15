import type { PipelineTask } from '@/types'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import TaskFooter from '../TaskFooter.vue'

// Phase 4.1.1: a finished task lists every action disabled ("task is terminal");
// the footer must not offer Analyze Failure or a Retry/Resume prompt for it.

const taskRef = ref<PipelineTask | null>(null)

vi.mock('@/features/pipeline/composables/taskModalContext', () => ({
  useInjectedTask: () => taskRef,
  useInjectedTaskDetails: () => ({ isActing: ref(false), actionError: ref(''), actionSuccess: ref(''), handleAction: vi.fn() }),
  useInjectedTaskActions: () => ({ additionalPrompt: ref(''), analysisInfo: ref(null), cancelConfirm: ref(false), slashCommands: ref([]), onCancelClick: vi.fn(), onAnalyze: vi.fn(), onSlashSelect: vi.fn() }),
}))

function task(stage: string, enabled: boolean): PipelineTask {
  const reason = enabled ? '' : 'task is terminal'
  return {
    id: 't1',
    currentStage: stage,
    availableActions: ['advance', 'retry', 'resume', 'cancel', 'approve_all_pending'].map(action => ({ action, enabled, reason, primary: false })),
  } as unknown as PipelineTask
}

describe('taskFooter', () => {
  it('offers no Analyze Failure or retry prompt for a done task', () => {
    taskRef.value = task('done', false)
    const w = mount(TaskFooter)
    expect(w.text()).not.toContain('Analyze Failure')
    expect(w.find('textarea').exists()).toBe(false)
    expect(w.findAll('button').filter(b => b.text() && b.text() !== 'Analyze Failure').every(b => b.attributes('disabled') !== undefined)).toBe(true)
  })

  it('offers Analyze Failure and the prompt when a retry can run', () => {
    taskRef.value = task('implementation', true)
    const w = mount(TaskFooter)
    expect(w.text()).toContain('Analyze Failure')
    expect(w.find('textarea').exists()).toBe(true)
  })
})
