import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AppShell from './AppShell.vue'

describe('appShell', () => {
  it('renders all four slots', () => {
    const w = mount(AppShell, {
      slots: {
        sidebar: '<div>SIDEBAR</div>',
        topbar: '<div>TOPBAR</div>',
        default: '<div>CONTENT</div>',
        statusbar: '<div>STATUS</div>',
      },
    })
    const t = w.text()
    expect(t).toContain('SIDEBAR')
    expect(t).toContain('TOPBAR')
    expect(t).toContain('CONTENT')
    expect(t).toContain('STATUS')
  })

  it('has a skip-to-content link targeting #main-content', () => {
    const w = mount(AppShell)
    const link = w.find('a[href="#main-content"]')
    expect(link.exists()).toBe(true)
  })

  it('main region is focusable (tabindex -1) with id main-content', () => {
    const w = mount(AppShell)
    const main = w.get('#main-content')
    expect(main.attributes('tabindex')).toBe('-1')
  })
})

// K: every view scrolls inside #main-content and nowhere else.
describe('appShell — scroll containment (3B)', () => {
  it('makes the scroll container the containing block for positioned descendants', () => {
    const main = mount(AppShell).get('#main-content')
    // `relative` is the fix: without it an absolutely positioned descendant with
    // no positioned ancestor (sr-only) is placed against the document instead,
    // and a long view stretches the page past the shell.
    expect(main.classes()).toEqual(expect.arrayContaining(['relative', 'overflow-y-auto', 'min-h-0', 'flex-1']))
  })

  it('keeps the shell viewport-bound, so only the content region scrolls', () => {
    const w = mount(AppShell)
    expect(w.classes()).toEqual(expect.arrayContaining(['h-screen', 'flex', 'flex-col']))
  })
})
