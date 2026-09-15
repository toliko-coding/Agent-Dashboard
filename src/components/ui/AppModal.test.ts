import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AppModal from './AppModal.vue'

// Phase 4: Escape closes a dialog even when focus has fallen back to <body> —
// a control removed by its own action (answering a permission prompt) leaves
// focus nowhere, and the dialog used to become unclosable from the keyboard.

function escape() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
}

describe('appModal escape', () => {
  it('closes on Escape when focus is on the body', async () => {
    const w = mount(AppModal, { props: { open: true }, slots: { default: '<button>inside</button>' }, attachTo: document.body })
    document.body.focus()
    escape()
    expect(w.emitted('close')).toHaveLength(1)
    w.unmount()
  })

  it('ignores Escape once closed', async () => {
    const w = mount(AppModal, { props: { open: true }, attachTo: document.body })
    await w.setProps({ open: false })
    escape()
    expect(w.emitted('close')).toBeUndefined()
    w.unmount()
  })

  it('closes only the top-most dialog', async () => {
    const outer = mount(AppModal, { props: { open: true }, attachTo: document.body })
    const inner = mount(AppModal, { props: { open: true }, attachTo: document.body })
    escape()
    expect(inner.emitted('close')).toHaveLength(1)
    expect(outer.emitted('close')).toBeUndefined()
    await inner.setProps({ open: false })
    escape()
    expect(outer.emitted('close')).toHaveLength(1)
    inner.unmount()
    outer.unmount()
  })

  it('stops listening after unmount', () => {
    const w = mount(AppModal, { props: { open: true }, attachTo: document.body })
    w.unmount()
    escape()
    expect(w.emitted('close')).toBeUndefined()
  })
})
