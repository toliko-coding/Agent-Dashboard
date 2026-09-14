import { describe, expect, it } from 'vitest'
import { barWidth, RESOURCE_LEVEL_BAR, RESOURCE_LEVEL_WORD, resourceLevel } from './resourceLevel'

describe('resourceLevel', () => {
  it('is normal below 75%, high from 75% and critical from 90%', () => {
    expect(resourceLevel(0)).toBe('normal')
    expect(resourceLevel(74.9)).toBe('normal')
    expect(resourceLevel(75)).toBe('high')
    expect(resourceLevel(89.9)).toBe('high')
    expect(resourceLevel(90)).toBe('critical')
    expect(resourceLevel(140)).toBe('critical')
  })

  it('never draws a normal reading green — measured is not healthy', () => {
    expect(RESOURCE_LEVEL_BAR.normal).not.toMatch(/success|green/)
  })

  it('states high and critical in words, not only colour', () => {
    expect(RESOURCE_LEVEL_WORD.high).toBe('High')
    expect(RESOURCE_LEVEL_WORD.critical).toBe('Critical')
  })

  it('clamps only the drawn bar', () => {
    expect(barWidth(-5)).toBe('0%')
    expect(barWidth(42)).toBe('42%')
    expect(barWidth(130)).toBe('100%')
  })
})
