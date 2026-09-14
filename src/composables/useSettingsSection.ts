import type { SettingsSection } from '../utils/settingsSections'
import { ref, watch } from 'vue'
import { DEFAULT_SETTINGS_SECTION, isSettingsSection } from '../utils/settingsSections'
import { useViewState } from './useViewState'

/*
 * Which Settings section is open, remembered across visits, and a way for any
 * surface to open Settings at a particular section ("Settings → Projects").
 *
 * Module-level, like useViewState, so the page, the topbar and a link on
 * another view all read and write the same section. There is no router: the
 * section is addressed through this state, persisted like the active view.
 */
const STORAGE_KEY = 'settings-active-section'

function readStored(): SettingsSection {
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
    return isSettingsSection(stored) ? stored : DEFAULT_SETTINGS_SECTION
  }
  catch {
    return DEFAULT_SETTINGS_SECTION
  }
}

const activeSection = ref<SettingsSection>(readStored())

watch(activeSection, (section) => {
  try {
    if (typeof localStorage !== 'undefined')
      localStorage.setItem(STORAGE_KEY, section)
  }
  catch { /* storage unavailable: the page still works, it just won't remember */ }
}, { flush: 'sync' })

export function useSettingsSection() {
  const { activeView } = useViewState()

  /** Go to the Settings page, at `section` when given, otherwise where the user left it. */
  function openSettings(section?: SettingsSection): void {
    if (section)
      activeSection.value = section
    activeView.value = 'settings'
  }

  return { activeSection, openSettings }
}
