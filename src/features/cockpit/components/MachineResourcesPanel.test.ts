import type { SystemInfo } from '@/composables/useSystemResources'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { axe } from '@/utils/testA11y'

const info = ref<SystemInfo | null>(null)
const error = ref<string | null>(null)

vi.mock('@/composables/useSystemResources', () => ({
  useSystemResources: () => ({ info, error, refetch: vi.fn() }),
}))

const GIB = 1024 ** 3
const READING: SystemInfo = {
  cpu: { usage: 42.4, cores: 10, model: 'Apple M3 Pro' },
  memory: { total: 36 * GIB, used: 28 * GIB, available: 8 * GIB, usagePercent: 78 },
  disk: { total: 1000 * GIB, used: 930 * GIB, available: 70 * GIB, usagePercent: 93, mount: '/Users/someone' },
  loadAvg: [2.1, 1.8, 1.5],
  uptime: 3600,
}

async function render(attach = false) {
  const { default: MachineResourcesPanel } = await import('./MachineResourcesPanel.vue')
  return mount(MachineResourcesPanel, { attachTo: attach ? document.body : undefined })
}

describe('machineResourcesPanel', () => {
  it('says it is loading, then the error, before any reading', async () => {
    info.value = null
    error.value = null
    expect((await render()).find('[data-testid="cockpit-machine-loading"]').exists()).toBe(true)
    error.value = 'Failed to load system info (500)'
    expect((await render()).get('[data-testid="cockpit-machine-failed"]').text()).toBe('Failed to load system info (500)')
  })

  it('shows CPU, memory and disk with their level in words as well as colour', async () => {
    info.value = READING
    error.value = null
    const w = await render()
    expect(w.get('[data-testid="machine-cpu"]').attributes('data-level')).toBe('normal')
    expect(w.get('[data-testid="machine-cpu"]').text()).toContain('42%')
    expect(w.get('[data-testid="machine-memory"]').attributes('data-level')).toBe('high')
    expect(w.get('[data-testid="machine-memory"]').text()).toContain('High')
    expect(w.get('[data-testid="machine-disk"]').attributes('data-level')).toBe('critical')
    expect(w.get('[data-testid="machine-disk"]').text()).toContain('Critical')
    expect(w.get('[data-testid="machine-memory"]').text()).toContain('28.0 GiB of 36.0 GiB')
  })

  it('never colours a normal reading green', async () => {
    info.value = READING
    const w = await render()
    expect(w.get('[data-testid="machine-cpu"]').html()).not.toMatch(/success|green/)
  })

  it('keeps the previous reading when an update fails, and says so', async () => {
    info.value = READING
    error.value = 'Network error loading system info.'
    const w = await render()
    expect(w.find('[data-testid="machine-cpu"]').exists()).toBe(true)
    expect(w.get('[data-testid="machine-retained"]').text()).toContain('previous reading')
    error.value = null
  })

  it('is attributed to the dashboard server and shows no mount path', async () => {
    info.value = READING
    const w = await render()
    expect(w.text()).toContain('Measured by the dashboard server')
    expect(w.text()).not.toContain('/Users/someone')
  })

  it('opens Runtime for the full reading', async () => {
    info.value = READING
    const w = await render()
    await w.get('[data-testid="machine-open-runtime"]').trigger('click')
    expect(w.emitted('openRuntime')).toHaveLength(1)
  })

  it('reads the shared poller and opens no request of its own', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/features/cockpit/components/MachineResourcesPanel.vue'), 'utf8')
    expect(source).not.toMatch(/fetch\(|setInterval/)
  })

  it('has no axe violations', async () => {
    info.value = READING
    const w = await render(true)
    expect(await axe(w.element as Element)).toHaveNoViolations()
    w.unmount()
  })
})
