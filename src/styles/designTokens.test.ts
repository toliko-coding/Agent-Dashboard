import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * The Phase 3B visual foundation, asserted against main.css itself.
 *
 * Tokens are plain CSS, so the reliable test is the stylesheet: what is defined,
 * what each role aliases, and whether the contrast the design depends on holds
 * in both themes.
 */

const CSS_PATH = resolve(process.cwd(), 'src/styles/main.css')
const css = readFileSync(CSS_PATH, 'utf8')

/** The block (without braces) that contains `marker`, found by walking out to its braces. */
function blockContaining(marker: string, opener: string): string {
  const at = css.indexOf(marker)
  expect(at, `marker ${marker}`).toBeGreaterThan(-1)
  const start = css.lastIndexOf(opener, at)
  const end = css.indexOf('\n}', at)
  return css.slice(start, end)
}

const lightRoot = blockContaining('--card-hover-shadow: 0 4px 12px', ':root {')
const darkRoot = blockContaining('--card-hover-shadow: 0 2px 12px', '.dark {')
const themeInline = blockContaining('--color-app: var(--app);', '@theme inline {')
const themeStatic = blockContaining('--ease-standard:', '@theme {')

function token(block: string, name: string): string {
  const m = block.match(new RegExp(`${name}:\\s*([^;]+);`))
  return m ? m[1].trim() : ''
}

// Tailwind palette steps referenced by var() in the tokens this test reads.
const TAILWIND: Record<string, string> = {
  'var(--color-slate-400)': '#94a3b8',
}

function hex(value: string): string {
  const v = TAILWIND[value] ?? value
  expect(v, `expected a hex colour, got ${value}`).toMatch(/^#[0-9a-f]{6}$/i)
  return v
}

function luminance(color: string): number {
  const n = [1, 3, 5].map(i => Number.parseInt(color.slice(i, i + 2), 16) / 255)
  const [r, g, b] = n.map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(hex(a)), luminance(hex(b))].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

function hue(color: string): number {
  const [r, g, b] = [1, 3, 5].map(i => Number.parseInt(hex(color).slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max === min)
    return 0
  const d = max - min
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return (h * 60 + 360) % 360
}

describe('design tokens — live is its own role (A, B)', () => {
  it('defines a complete live family in both themes', () => {
    for (const block of [lightRoot, darkRoot]) {
      for (const name of ['--live', '--live-soft', '--live-text', '--live-dot', '--live-line'])
        expect(token(block, name), name).not.toBe('')
    }
  })

  it('registers live as colours, so it generates utilities', () => {
    for (const name of ['live', 'live-soft', 'live-text', 'live-dot', 'live-line'])
      expect(token(themeInline, `--color-${name}`)).toBe(`var(--${name})`)
  })

  it('points the live state at the live family, never at success', () => {
    for (const block of [lightRoot, darkRoot]) {
      expect(token(block, '--state-live')).toBe('var(--live-dot)')
      expect(token(block, '--state-live')).not.toContain('success')
    }
  })

  it('keeps success green and unchanged', () => {
    expect(token(lightRoot, '--state-success')).toBe('var(--success-text)')
    expect(token(lightRoot, '--success-text')).toContain('green')
    expect(token(darkRoot, '--success-text')).toContain('green')
  })

  it('is a cyan hue, distinct from the green success family', () => {
    for (const block of [lightRoot, darkRoot]) {
      const h = hue(token(block, '--live-text'))
      expect(h, 'live text hue').toBeGreaterThanOrEqual(175)
      expect(h, 'live text hue').toBeLessThanOrEqual(200)
      expect(token(block, '--live-dot')).not.toBe(token(block, '--success-dot'))
    }
  })
})

describe('design tokens — contrast in both themes', () => {
  it('keeps live text readable on panels (AA 4.5:1)', () => {
    expect(contrast(token(lightRoot, '--live-text'), token(lightRoot, '--card'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(token(darkRoot, '--live-text'), token(darkRoot, '--card'))).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps the live dot visible as a graphic (3:1)', () => {
    expect(contrast(token(lightRoot, '--live-dot'), token(lightRoot, '--card'))).toBeGreaterThanOrEqual(3)
    expect(contrast(token(darkRoot, '--live-dot'), token(darkRoot, '--card'))).toBeGreaterThanOrEqual(3)
  })

  it('keeps even the faintest text readable on the recessed surface', () => {
    expect(contrast(token(lightRoot, '--fg-faint'), token(lightRoot, '--recessed'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(token(darkRoot, '--fg-faint'), token(darkRoot, '--recessed'))).toBeGreaterThanOrEqual(4.5)
  })

  it('defines a recessed surface in both themes and registers it', () => {
    expect(token(lightRoot, '--recessed')).toMatch(/^#/)
    expect(token(darkRoot, '--recessed')).toMatch(/^#/)
    expect(token(themeInline, '--color-recessed')).toBe('var(--recessed)')
  })
})

describe('design tokens — type scale and radius', () => {
  it('defines the approved type scale', () => {
    expect(token(themeStatic, '--text-title-lg')).toBe('22px')
    expect(token(themeStatic, '--text-title')).toBe('18px')
    expect(token(themeStatic, '--text-body')).toBe('15px')
    expect(token(themeStatic, '--text-ui')).toBe('13px')
    expect(token(themeStatic, '--text-ui-sm')).toBe('12px')
    expect(token(themeStatic, '--text-label')).toBe('11px')
  })

  it('defines two radius roles', () => {
    expect(token(themeStatic, '--radius-control')).toBe('4px')
    expect(token(themeStatic, '--radius-panel')).toBe('8px')
  })
})

describe('fonts — Fira Code is self-hosted', () => {
  it('makes no request to the old CDN', () => {
    expect(css).not.toContain('cdn.jsdelivr.net')
    expect(css).not.toMatch(/@font-face[^}]*https?:\/\//)
  })

  it('points every @font-face at a vendored file that exists', () => {
    const urls = [...css.matchAll(/url\('([^']+\.woff2)'\)/g)].map(m => m[1])
    expect(urls).toHaveLength(4)
    for (const url of urls)
      expect(existsSync(resolve(dirname(CSS_PATH), url)), url).toBe(true)
  })

  it('ships the font licence beside the font files', () => {
    const licence = readFileSync(resolve(process.cwd(), 'src/assets/fonts/fira-code/OFL.txt'), 'utf8')
    expect(licence).toContain('SIL Open Font License')
  })

  it('keeps monospace a technical font, not the interface font', () => {
    expect(token(themeStatic, '--font-mono')).toContain('Fira Code')
    expect(css).not.toMatch(/--font-sans:[^;]*Fira/)
  })
})

describe('motion — legitimate state motion remains (F)', () => {
  it('keeps every semantic motion class and the reduced-motion override', () => {
    for (const cls of ['.motion-working', '.motion-tool', '.motion-waiting', '.motion-flow', '.motion-success'])
      expect(css).toContain(cls)
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
  })
})
