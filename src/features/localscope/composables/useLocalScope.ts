import { localScopeClient } from '../client'
import { createLocalScopeResource } from './useLocalScopeResource'

/*
 * The dashboard's LocalScope resources.
 *
 * One shared instance per endpoint. Summary is polled most often because it
 * backs the Overview cards; the heavier lists refresh more slowly, and devices
 * slowest of all — LocalScope itself caches devices 3x longer because an adb
 * round-trip is comparatively slow and hardware does not come and go on a
 * two-second cadence.
 */

export const useLocalScopeSummary = createLocalScopeResource(
  signal => localScopeClient.summary(signal),
  5000,
)

export const useLocalScopeServices = createLocalScopeResource(
  signal => localScopeClient.services(false, signal),
  5000,
)

export const useLocalScopeProcesses = createLocalScopeResource(
  signal => localScopeClient.processes(false, signal),
  8000,
)

export const useLocalScopeDevices = createLocalScopeResource(
  signal => localScopeClient.devices(signal),
  15000,
)
