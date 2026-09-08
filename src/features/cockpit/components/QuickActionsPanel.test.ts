import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { ACTIVE_VIEWS } from '@/composables/useViewState'
import QuickActionsPanel from './QuickActionsPanel.vue'

const stubs = { CockpitPanel: { template: '<div><slot name="action" /><slot /></div>' } }

function mountPanel() {
  return mount(QuickActionsPanel, { global: { stubs } })
}

describe('quickActionsPanel', () => {
  it('routes each navigating action to a view that actually exists', async () => {
    const w = mountPanel()
    const buttons = w.findAll('[data-testid^="quick-action-"]')
    expect(buttons.length).toBeGreaterThan(0)

    for (const b of buttons)
      await b.trigger('click')

    const navigated = (w.emitted('navigate') ?? []).map(args => args[0])
    // Every emitted destination must be a real ActiveView, so no button can
    // point at a view that was renamed or never existed.
    for (const view of navigated)
      expect(ACTIVE_VIEWS).toContain(view)
  })

  it('emits newAgent rather than navigating, since the dialog lives in App.vue', async () => {
    const w = mountPanel()
    await w.get('[data-testid="quick-action-new-agent"]').trigger('click')
    expect(w.emitted('newAgent')).toHaveLength(1)
    expect(w.emitted('navigate')).toBeUndefined()
  })

  it('every action does something — none is decorative', async () => {
    const w = mountPanel()
    const buttons = w.findAll('[data-testid^="quick-action-"]')
    for (const b of buttons)
      await b.trigger('click')
    const total = (w.emitted('navigate')?.length ?? 0) + (w.emitted('newAgent')?.length ?? 0)
    expect(total).toBe(buttons.length)
  })
})
