import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CopyButton from './CopyButton.vue'

describe('copyButton', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('copies the value and confirms', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    const w = mount(CopyButton, { props: { value: '/gh/project', label: 'project path' } })
    expect(w.get('button').attributes('aria-label')).toBe('Copy project path')

    await w.get('button').trigger('click')
    await Promise.resolve()
    expect(writeText).toHaveBeenCalledWith('/gh/project')
    expect(w.get('button').attributes('aria-label')).toBe('Copied project path')
  })

  // A blocked clipboard (insecure context, permission denied) must not throw or
  // shout: the text stays selectable, so an error toast would be noise.
  it('fails silently when the clipboard is unavailable', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    const w = mount(CopyButton, { props: { value: 'x' } })
    await w.get('button').trigger('click')
    await Promise.resolve()
    expect(w.get('button').attributes('aria-label')).toBe('Copy value')
  })

  // It sits inside clickable cards; a copy must not also open the card.
  it('stops the click from reaching a parent', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
    const onParent = vi.fn()
    const w = mount({
      components: { CopyButton },
      setup: () => ({ onParent }),
      template: '<div @click="onParent"><CopyButton value="v" /></div>',
    })
    await w.get('[data-testid="copy-button"]').trigger('click')
    expect(onParent).not.toHaveBeenCalled()
  })
})
