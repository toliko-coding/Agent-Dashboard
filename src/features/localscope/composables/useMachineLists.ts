import type { MachineDevices, MachineProcesses, MachineServices } from '../snapshot'
import { EMPTY_DEVICES, EMPTY_PROCESSES, EMPTY_SERVICES } from '../snapshot'
import { createMachineResource } from './useMachineResource'

/*
 * The normalized service, process and device lists.
 *
 * Polled only while a view that shows them is mounted — that is the reason they
 * are separate endpoints from the snapshot rather than fields on it. The
 * snapshot is six integers and backs surfaces that are always open; these are
 * dozens of records and back one page.
 *
 * Services refresh a little faster than processes because a dev server
 * appearing is what a developer is usually waiting to see, and because
 * LocalScope caches both for 2s anyway. Devices are slowest: LocalScope caches
 * them three times longer, an adb round-trip is comparatively expensive, and
 * hardware does not come and go on a two-second cadence. All three sit inside
 * the 30s window past which a reading is called stale.
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

export const useMachineDevices = createMachineResource<MachineDevices>(
  '/api/localscope/devices',
  EMPTY_DEVICES,
  15000,
)
