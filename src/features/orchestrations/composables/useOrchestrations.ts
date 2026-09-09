import type { Ref } from 'vue'
import type { OrchestrationDetail, OrchestrationSummary } from '../types'
import { onUnmounted, ref, shallowRef, watch } from 'vue'
import { useVisibilityPolling } from '@/composables/useVisibilityPolling'
import { errorMessage } from '@/utils/errorMessage'
import { fetchOrchestration, fetchOrchestrations } from '../client'

/*
 * There is no SSE stream for orchestrations, so this polls — at 15s, through
 * useVisibilityPolling, which stops entirely while the tab is hidden.
 *
 * List state is module-level so two consumers share one request rather than
 * each opening their own. That is the lesson from the /api/resources 429: a
 * composable that allocates a poller per caller multiplies requests by the
 * number of mounted components and trips the rate limiter.
 */
const POLL_MS = 15_000

const orchestrations = shallowRef<OrchestrationSummary[]>([])
const listError = ref<string | null>(null)
/** True once a response has been seen, so "empty" can be told from "not yet". */
const listLoaded = ref(false)

async function loadList(): Promise<void> {
  try {
    orchestrations.value = await fetchOrchestrations()
    listError.value = null
    listLoaded.value = true
  }
  catch (err) {
    listError.value = errorMessage(err)
  }
}

export function useOrchestrationList() {
  useVisibilityPolling(loadList, POLL_MS)
  return { orchestrations, error: listError, loaded: listLoaded, refetch: loadList }
}

export interface OrchestrationDetailState {
  detail: Ref<OrchestrationDetail | null>
  error: Ref<string | null>
  loading: Ref<boolean>
  refetch: () => Promise<void>
}

/**
 * Detail state is per-caller, not module-level: it is keyed by whichever root
 * the component is showing, and a second component showing a different root
 * would otherwise overwrite the first one's data.
 */
export function useOrchestrationDetail(rootTaskId: Ref<string | null>): OrchestrationDetailState {
  const detail = shallowRef<OrchestrationDetail | null>(null)
  const error = ref<string | null>(null)
  const loading = ref(false)

  async function load(): Promise<void> {
    const id = rootTaskId.value
    if (!id) {
      detail.value = null
      error.value = null
      return
    }
    loading.value = true
    try {
      const result = await fetchOrchestration(id)
      // The selection may have moved on while this request was in flight;
      // applying a stale response would show the wrong graph.
      if (rootTaskId.value !== id)
        return
      detail.value = result
      error.value = null
    }
    catch (err) {
      if (rootTaskId.value !== id)
        return
      error.value = errorMessage(err)
      detail.value = null
    }
    finally {
      if (rootTaskId.value === id)
        loading.value = false
    }
  }

  watch(rootTaskId, () => {
    detail.value = null
    void load()
  }, { immediate: true })

  const handle = setInterval(() => {
    if (!document.hidden && rootTaskId.value)
      void load()
  }, POLL_MS)
  onUnmounted(() => clearInterval(handle))

  return { detail, error, loading, refetch: load }
}
