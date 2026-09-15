import { onBeforeUnmount, onMounted } from 'vue'

/*
 * Keeps data that changes rarely fresh without polling (Phase 4.1): run
 * `refresh` when the page becomes visible again or the window regains focus,
 * at most once per `minIntervalMs`. No timer is ever scheduled. `skip` lets a
 * caller hold off while its own change is in flight.
 */
export function useRefreshWhenShown(refresh: () => void, options: { minIntervalMs?: number, skip?: () => boolean } = {}): void {
  const minIntervalMs = options.minIntervalMs ?? 5_000
  let last = Date.now()
  function onShown() {
    if (document.visibilityState !== 'visible' || options.skip?.() || Date.now() - last < minIntervalMs)
      return
    last = Date.now()
    refresh()
  }
  onMounted(() => {
    window.addEventListener('focus', onShown)
    document.addEventListener('visibilitychange', onShown)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('focus', onShown)
    document.removeEventListener('visibilitychange', onShown)
  })
}
