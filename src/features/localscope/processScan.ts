import type { MachineProcess } from './snapshot'
import type { DevProcess } from './types'
import { localScopeClient } from './client'

/*
 * The explicit, one-off "every process on this machine" diagnostic.
 *
 * The unfiltered list is still fetched through the raw client with `all=true`.
 * That flag bypasses LocalScope's relevance filter and its cache, so it is kept
 * off the normalized endpoints entirely and remains what it always was: an
 * on-demand request made when a person asks for it — never on mount, never on
 * an interval.
 */
export interface ProcessScan {
  items: MachineProcess[]
  /** Every process the collector counted, including any it did not list. */
  total: number
  /** When the scan answered, in this browser's clock. It is not refreshed. */
  takenAt: number
}

/**
 * Adapts a raw collector row to the normalized shape so a list renders one
 * type. Only this escape hatch needs it — everything polled arrives normalized
 * from the dashboard's own endpoint.
 */
function fromRaw(p: DevProcess): MachineProcess {
  return {
    /*
     * Always null, and correctly so: workspace identity is resolved on the
     * server as part of the normalized endpoints, and this row came straight
     * from the collector. Resolving a checkout means asking git, so an
     * unattributed row is the honest outcome rather than a guess from its cwd.
     */
    workspace: null,
    id: p.id,
    pid: p.pid,
    ppid: p.ppid,
    name: p.name,
    command: p.command,
    cwd: p.cwd,
    runtime: p.runtime,
    cpuPercent: p.cpuPercent,
    memoryBytes: p.memoryBytes,
    elapsedSeconds: p.elapsedSeconds,
    startedAt: p.startedAt,
    ports: p.ports,
    relevanceReasons: p.relevanceReasons,
    // The raw client's mirrored ProjectRef predates LocalScope's `repo` field.
    discoveredProject: p.project === null ? null : { ...p.project, repo: null },
  }
}

/** Runs the scan once. Rejects when the collector cannot answer. */
export async function scanAllProcesses(): Promise<ProcessScan> {
  const { data } = await localScopeClient.allProcesses()
  return { items: data.processes.map(fromRaw), total: data.total, takenAt: Date.now() }
}
