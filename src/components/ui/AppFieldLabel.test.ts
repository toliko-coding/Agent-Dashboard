import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AppFieldLabel from './AppFieldLabel.vue'

// G: the shared label moved to the named form vocabulary; its association is unchanged.
describe('appFieldLabel', () => {
  it('labels its control and uses the shared field-label style', () => {
    const w = mount(AppFieldLabel, { props: { for: 'name-input' }, slots: { default: 'Name' } })
    const label = w.get('label')
    expect(label.attributes('for')).toBe('name-input')
    expect(label.text()).toBe('Name')
    expect(label.classes()).toContain('field-label')
  })
})
