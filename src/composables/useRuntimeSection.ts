import type { RuntimeSection } from '../utils/runtimeSections'
import { ref, watch } from 'vue'
import { DEFAULT_RUNTIME_SECTION, isRuntimeSection, RUNTIME_SECTION_STORAGE_KEY } from '../utils/runtimeSections'
import { useViewState } from './useViewState'

/*
 * Which Runtime section is open, remembered across visits — the same
 * arrangement as useSettingsSection. Module-level, so the page and the topbar
 * read one value; there is no router.
 *
 * The section decides which list pollers run: each list is fetched by the
 * section that shows it, and only while that section is open.
 */
function readStored(): RuntimeSection {
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(RUNTIME_SECTION_STORAGE_KEY) : null
    return isRuntimeSection(stored) ? stored : DEFAULT_RUNTIME_SECTION
  }
  catch {
    return DEFAULT_RUNTIME_SECTION
  }
}

const activeSection = ref<RuntimeSection>(readStored())

watch(activeSection, (section) => {
  try {
    if (typeof localStorage !== 'undefined')
      localStorage.setItem(RUNTIME_SECTION_STORAGE_KEY, section)
  }
  catch { /* storage unavailable: the page still works, it just won't remember */ }
}, { flush: 'sync' })

export function useRuntimeSection() {
  const { activeView } = useViewState()

  /** Go to the Runtime page, at `section` when given, otherwise where the user left it. */
  function openRuntime(section?: RuntimeSection): void {
    if (section)
      activeSection.value = section
    activeView.value = 'localscope'
  }

  return { activeSection, openRuntime }
}
