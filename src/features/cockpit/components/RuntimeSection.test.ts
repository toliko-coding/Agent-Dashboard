import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { axe } from '@/utils/testA11y'
import RuntimeSection from './RuntimeSection.vue'

const snapshot = ref<any>({ source: 'ok', collectedAt: null, ageMs: null, degraded: [], counts: { services: 7, processesRelevant: 40, processesTotal: 700, devices: 0, network: null, projects: null } })
const loaded = ref(true)

vi.mock('@/features/localscope', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/features/localscope')>()
  return { ...real, useLocalMachine: () => ({ snapshot, loaded, refetch: vi.fn() }) }
})
// The topology is covered by its own UI and polling tests; here it only has to be present.
vi.mock('./RuntimeTopology.vue', () => ({ default: { name: 'RuntimeTopology', props: ['agents'], template: '<div data-testid="runtime-topology" />' } }))

const render = () => mount(RuntimeSection, { props: { agents: [], liveAgentCount: 4 }, attachTo: document.body })

describe('runtimeSection', () => {
  it('summarises the machine from the snapshot, with a measured zero and an unknown kept apart', () => {
    const w = render()
    expect(w.get('[data-testid="runtime-summary-agents"] dd').text()).toBe('4 running')
    expect(w.get('[data-testid="runtime-summary-services"] dd').text()).toBe('7 listening')
    expect(w.get('[data-testid="runtime-summary-processes"] dd').text()).toBe('40 of 700')
    expect(w.get('[data-testid="runtime-summary-devices"]').attributes('data-state')).toBe('measured')
    expect(w.get('[data-testid="runtime-summary-devices"] dd').text()).toBe('0 connected')
    expect(w.get('[data-testid="runtime-summary-network"]').attributes('data-state')).toBe('unknown')
    expect(w.get('[data-testid="runtime-summary-network"] dd').text()).toBe('Not collected')
    w.unmount()
  })

  it('does not turn an absent collector into zero machine counts', () => {
    snapshot.value = { ...snapshot.value, source: 'unavailable' }
    const w = render()
    expect(w.find('[data-testid="runtime-summary-services"]').exists()).toBe(false)
    expect(w.get('[data-testid="runtime-summary-unavailable"]').text()).toContain('unknown — not zero')
    w.unmount()
    snapshot.value = { ...snapshot.value, source: 'ok' }
  })

  it('keeps the runtime topology beneath the summary', () => {
    const w = render()
    expect(w.find('[data-testid="runtime-topology"]').exists()).toBe(true)
    w.unmount()
  })

  // The summary must not be the thing that starts the list pollers the collapsed topology keeps off.
  it('reads counts only, never the service or process lists', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/features/cockpit/components/RuntimeSection.vue'), 'utf8')
    expect(source).not.toMatch(/useMachineServices|useMachineProcesses|useMachineDevices|fetch\(|setInterval/)
  })

  it('has no axe violations', async () => {
    const w = render()
    expect(await axe(w.element as Element)).toHaveNoViolations()
    w.unmount()
  })
})
