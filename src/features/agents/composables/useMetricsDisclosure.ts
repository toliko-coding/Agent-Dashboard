import { ref } from 'vue'

/*
 * The ⓘ metrics popover's open state, shared by the agent card and the agent
 * details panel so both behave the same way.
 *
 * It opened on hover and on focus, and a click toggled the same flag — so the
 * click that a pointer user makes while hovering closed what the hover had just
 * opened. Two pieces of state keep the gestures from fighting:
 *
 *   hover / focus   preview: open, and closed again when the pointer or focus leaves
 *   click / Enter   pin: stays open when the pointer leaves; a second press closes
 *   Escape          closes, and is consumed only when it closed something, so it
 *                   does not also dismiss the panel the popover sits in
 *   focus leaving   closes and unpins: clicking or tabbing elsewhere dismisses it
 */
export function useMetricsDisclosure() {
  const open = ref(false)
  const pinned = ref(false)

  function close(): void {
    open.value = false
    pinned.value = false
  }

  function onPointerEnter(): void {
    open.value = true
  }

  function onPointerLeave(): void {
    if (!pinned.value)
      open.value = false
  }

  function onFocusIn(): void {
    open.value = true
  }

  function onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null
    if (next && (event.currentTarget as HTMLElement | null)?.contains(next))
      return
    close()
  }

  function toggle(): void {
    if (pinned.value) {
      close()
      return
    }
    pinned.value = true
    open.value = true
  }

  function onEscape(event: KeyboardEvent): void {
    if (!open.value)
      return
    event.stopPropagation()
    close()
  }

  return { open, pinned, onPointerEnter, onPointerLeave, onFocusIn, onFocusOut, toggle, onEscape }
}
