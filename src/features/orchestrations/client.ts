import type { OrchestrationDetail, OrchestrationSummary } from './types'

/*
 * Read-only client for the orchestration view. There are two GETs and no
 * mutating call, matching the server: this phase adds a way to SEE delegation,
 * not a way to cause it.
 */

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin' })
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string } | null
    throw new Error(body?.error || `HTTP ${res.status}`)
  }
  return await res.json() as T
}

export function fetchOrchestrations(): Promise<OrchestrationSummary[]> {
  return get<OrchestrationSummary[]>('/api/orchestrations')
}

export function fetchOrchestration(rootTaskId: string): Promise<OrchestrationDetail> {
  return get<OrchestrationDetail>(`/api/orchestrations/${encodeURIComponent(rootTaskId)}`)
}
