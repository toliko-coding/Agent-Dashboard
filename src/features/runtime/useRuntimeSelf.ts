import type { RuntimeSelf } from '@/sdk.generated'
import { onMounted, readonly, ref } from 'vue'

/*
 * The dashboard server's own identity, read once.
 *
 * It cannot change while the server runs — a pid and a bound address are fixed
 * for the life of the process — so this is a one-shot read shared by every
 * caller, not another poller on a page that already has three. A server restart
 * gives the browser a new page load anyway.
 *
 * Null means "not known yet, or could not be read". Callers must treat that as
 * an absence of evidence: with no identity, no service can be recognised as the
 * dashboard's own, which leaves rows unlabelled rather than mislabelled.
 */

const self = ref<RuntimeSelf | null>(null)
let inFlight: Promise<void> | null = null

async function load(): Promise<void> {
  if (self.value || inFlight)
    return inFlight ?? undefined
  inFlight = (async () => {
    try {
      const res = await fetch('/api/system/self', { credentials: 'same-origin' })
      if (res.ok)
        self.value = await res.json() as RuntimeSelf
    }
    catch {
      // Leave it null: an unknown identity classifies nothing.
    }
    finally {
      inFlight = null
    }
  })()
  return inFlight
}

export function useRuntimeSelf(): { self: Readonly<typeof self> } {
  onMounted(() => {
    void load()
  })
  return { self: readonly(self) as Readonly<typeof self> }
}

/** Test seam: drops the cached identity so a test can control the read. */
export function resetRuntimeSelfForTest(): void {
  self.value = null
  inFlight = null
}
