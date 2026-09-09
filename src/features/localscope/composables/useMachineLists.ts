import type { MachineProcesses, MachineServices } from '../snapshot'
import { EMPTY_PROCESSES, EMPTY_SERVICES } from '../snapshot'
import { createMachineResource } from './useMachineResource'

/*
 * The normalized service and process lists.
 *
 * Polled only while a view that shows them is mounted — that is the reason they
 * are separate endpoints from the snapshot rather than fields on it. The
 * snapshot is six integers and backs surfaces that are always open; these are
 * dozens of records and back one page.
 *
 * Services refresh a little faster than processes because a dev server
 * appearing is what a developer is usually waiting to see, and because
 * LocalScope caches both for 2s anyway. Both sit well inside the 30s window
 * past which a reading is called stale.
 */

export const useMachineServices = createMachineResource<MachineServices>(
  '/api/localscope/services',
  EMPTY_SERVICES,
  5000,
)

export const useMachineProcesses = createMachineResource<MachineProcesses>(
  '/api/localscope/processes',
  EMPTY_PROCESSES,
  8000,
)
