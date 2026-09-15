import type { ProjectRoadmapSummary, Roadmap, RoadmapProposal, RoadmapStatus } from './roadmapModel'
import { ref, shallowRef } from 'vue'
import { errorMessage } from '@/utils/errorMessage'

/*
 * One project's roadmap, over /api/projects/{id}/roadmap (Phase 4B).
 *
 * Every mutation answers with the whole roadmap, which replaces local state:
 * there is no optimistic copy to drift and nothing is polled. The roadmap is
 * read when the view opens and after each change the user makes.
 */

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => null) as { error?: string } | null
    throw new Error(data?.error || `Request failed (${res.status})`)
  }
  return await res.json() as T
}

export interface PhaseChanges {
  title?: string
  description?: string
  status?: RoadmapStatus
  blockedReason?: string
  decisions?: string
  dependsOn?: string[]
}

export interface ItemChanges {
  title?: string
  status?: RoadmapStatus
  blockedReason?: string
  taskId?: string
}

export function fetchRoadmapSummaries(): Promise<ProjectRoadmapSummary[]> {
  return request<ProjectRoadmapSummary[]>('GET', '/api/roadmaps/summary')
}

export function useRoadmap(projectId: () => string) {
  const roadmap = shallowRef<Roadmap | null>(null)
  const proposals = shallowRef<RoadmapProposal[]>([])
  const loading = ref(false)
  const busy = ref(false)
  const error = ref('')

  const base = () => `/api/projects/${encodeURIComponent(projectId())}/roadmap`

  async function load(): Promise<void> {
    loading.value = true
    error.value = ''
    try {
      roadmap.value = await request<Roadmap>('GET', base())
    }
    catch (e) {
      error.value = errorMessage(e)
    }
    finally {
      loading.value = false
    }
  }

  /** Runs a change; the server's roadmap replaces ours. Errors are shown, then rethrown. */
  async function change(method: string, path: string, body?: unknown): Promise<Roadmap | null> {
    busy.value = true
    error.value = ''
    try {
      const next = await request<Roadmap>(method, `${base()}${path}`, body)
      roadmap.value = next
      return next
    }
    catch (e) {
      error.value = errorMessage(e)
      throw e
    }
    finally {
      busy.value = false
    }
  }

  const id = encodeURIComponent

  async function loadProposals(): Promise<void> {
    try {
      proposals.value = await request<RoadmapProposal[]>('GET', `${base()}/proposals`)
    }
    catch (e) {
      error.value = errorMessage(e)
    }
  }

  return {
    roadmap,
    proposals,
    loading,
    busy,
    error,
    load,
    loadProposals,
    setObjective: (objective: string) => change('PUT', '/objective', { objective }),
    addPhase: (title: string, status: RoadmapStatus = 'planned', description = '') => change('POST', '/phases', { title, status, description }),
    updatePhase: (phaseId: string, changes: PhaseChanges) => change('PATCH', `/phases/${id(phaseId)}`, changes),
    deletePhase: (phaseId: string) => change('DELETE', `/phases/${id(phaseId)}`),
    movePhase: (phaseId: string, direction: 'up' | 'down') => change('POST', `/phases/${id(phaseId)}/move`, { direction }),
    setCurrent: (phaseId: string | null) => change('PUT', '/current', { phaseId: phaseId ?? '' }),
    addItem: (phaseId: string, title: string, status: RoadmapStatus = 'planned') => change('POST', `/phases/${id(phaseId)}/items`, { title, status }),
    updateItem: (itemId: string, changes: ItemChanges) => change('PATCH', `/items/${id(itemId)}`, changes),
    deleteItem: (itemId: string) => change('DELETE', `/items/${id(itemId)}`),
    moveItem: (itemId: string, direction: 'up' | 'down') => change('POST', `/items/${id(itemId)}/move`, { direction }),
    async acceptProposal(proposalId: string, mode: 'append' | 'replace') {
      const next = await change('POST', `/proposals/${id(proposalId)}/accept`, { mode })
      await loadProposals()
      return next
    },
    async rejectProposal(proposalId: string) {
      const next = await change('POST', `/proposals/${id(proposalId)}/reject`)
      await loadProposals()
      return next
    },
    async importProposal(pid: number) {
      busy.value = true
      error.value = ''
      try {
        const created = await request<RoadmapProposal>('POST', `${base()}/proposals/from-agent`, { pid })
        await Promise.all([loadProposals(), load()])
        return created
      }
      catch (e) {
        error.value = errorMessage(e)
        throw e
      }
      finally {
        busy.value = false
      }
    },
    async analyze(): Promise<number> {
      busy.value = true
      error.value = ''
      try {
        const { pid } = await request<{ pid: number }>('POST', `${base()}/analyze`)
        return pid
      }
      catch (e) {
        error.value = errorMessage(e)
        throw e
      }
      finally {
        busy.value = false
      }
    },
  }
}

/** The project the Projects view has open; Command sets it to open a roadmap. */
export const selectedProjectId = ref<string | null>(null)
