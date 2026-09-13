import type { AttentionQueue } from '@/features/attention'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { axe } from '@/utils/testA11y'
import CommandStatusStrip from './CommandStatusStrip.vue'

const snapshot = ref<any>({ source: 'ok', collectedAt: null, ageMs: null, degraded: [], counts: { services: 7, processesRelevant: 40, processesTotal: 700, devices: 0, network: 30, projects: null } })
const loaded = ref(true)

vi.mock('@/features/localscope', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/features/localscope')>()
  return { ...real, useLocalMachine: () => ({ snapshot, loaded, refetch: vi.fn() }) }
})

function queue(n: number, status: AttentionQueue['status'] = 'ready'): AttentionQueue {
  return {
    status,
    stale: false,
    items: Array.from({ length: n }, (_, i) => ({ id: `agent:${i}`, level: 'blocking', kind: 'question', subject: { type: 'agent', sessionId: String(i) }, agentSessionId: String(i), workspace: null, repository: null, title: '', reason: '', since: null, lastActivity: null })),
  }
}

function render(o: Partial<{ attention: AttentionQueue, working: number | null, footprint: any, live: boolean }> = {}) {
  return mount(CommandStatusStrip, {
    props: { attention: queue(2), working: 3, footprint: { repositories: 2, workspaces: 3, unresolved: 0 }, live: true, ...o },
    attachTo: document.body,
  })
}

describe('commandStatusStrip', () => {
  it('reads needs you, working, where agents are, and the local runtime as one line', () => {
    const w = render()
    expect(w.get('[data-testid="status-needs-you"] dd').text()).toBe('2')
    expect(w.get('[data-testid="status-working"] dd').text()).toBe('3')
    expect(w.get('[data-testid="status-footprint"] dd').text()).toBe('2 repositories · 3 workspaces')
    expect(w.get('[data-testid="status-local-runtime"] dd').text()).toContain('7 services listening')
    expect(w.findAll('dl')).toHaveLength(1)
    w.unmount()
  })

  it('does not claim zero before agents or attention are known', () => {
    const w = render({ attention: queue(0, 'loading'), working: null, footprint: null })
    expect(w.get('[data-testid="status-needs-you"] dd').text()).toBe('…')
    expect(w.get('[data-testid="status-working"] dd').text()).toBe('…')
    expect(w.find('[data-testid="status-footprint"]').exists()).toBe(false)
    w.unmount()
  })

  // Truthful connection status: silent while live (the topbar says so), explicit when not.
  it('mentions the agent connection only when updates are not arriving, and never as system health', () => {
    const live = render()
    expect(live.find('[data-testid="status-connection"]').exists()).toBe(false)
    live.unmount()
    const down = render({ live: false })
    expect(down.get('[data-testid="status-connection"] dd').text()).toBe('Agent updates reconnecting · last known state')
    expect(down.text()).not.toMatch(/online|healthy|all systems|normal/i)
    down.unmount()
  })

  it('says LocalScope is not connected instead of reporting zero services', () => {
    snapshot.value = { ...snapshot.value, source: 'unavailable', counts: { services: null } }
    const w = render()
    expect(w.get('[data-testid="status-local-runtime"]').attributes('data-state')).toBe('unavailable')
    expect(w.get('[data-testid="status-local-runtime"] dd').text()).toContain('not connected')
    expect(w.text()).not.toMatch(/\b0 services\b/)
    w.unmount()
    snapshot.value = { ...snapshot.value, source: 'ok', counts: { services: 7 } }
  })

  it('opens no request of its own: it reads the shared snapshot and props only', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const source = readFileSync(resolve(process.cwd(), 'src/features/cockpit/components/CommandStatusStrip.vue'), 'utf8')
    expect(source).not.toMatch(/fetch\(|setInterval|useMachineServices|useMachineProcesses|useSystemResources/)
  })

  it('has no axe violations', async () => {
    const w = render({ live: false })
    expect(await axe(w.element as Element)).toHaveNoViolations()
    w.unmount()
  })
})
