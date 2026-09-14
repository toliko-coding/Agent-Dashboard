/*
 * How loaded a measured machine resource is, in one place, for every surface
 * that shows CPU, memory, disk or a usage budget as a share of 100%.
 *
 * Normal is neutral, never green: a machine at 40% CPU is not "healthy", it is
 * just measured. High and critical are stated in words as well as colour.
 */
export type ResourceLevel = 'normal' | 'high' | 'critical'

export const RESOURCE_HIGH_PCT = 75
export const RESOURCE_CRITICAL_PCT = 90

export function resourceLevel(pct: number): ResourceLevel {
  if (pct >= RESOURCE_CRITICAL_PCT)
    return 'critical'
  return pct >= RESOURCE_HIGH_PCT ? 'high' : 'normal'
}

export const RESOURCE_LEVEL_TEXT: Readonly<Record<ResourceLevel, string>> = {
  normal: 'text-fg',
  high: 'text-warning-text',
  critical: 'text-danger-text',
}

export const RESOURCE_LEVEL_BAR: Readonly<Record<ResourceLevel, string>> = {
  normal: 'bg-fg-mute',
  high: 'bg-warning',
  critical: 'bg-danger',
}

export const RESOURCE_LEVEL_WORD: Readonly<Record<ResourceLevel, string>> = {
  normal: '',
  high: 'High',
  critical: 'Critical',
}

/** A percentage clamped for drawing a bar; the number shown beside it stays the reported one. */
export function barWidth(pct: number): string {
  return `${Math.min(100, Math.max(0, pct))}%`
}
