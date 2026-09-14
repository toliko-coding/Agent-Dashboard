import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import DesignSandbox from './DesignSandbox.vue'

// The Command samples read the shared LocalScope snapshot; the sandbox test has no collector.
vi.mock('@/features/localscope', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/features/localscope')>()
  return { ...real, useLocalMachine: () => ({ snapshot: ref(real.EMPTY_SNAPSHOT), loaded: ref(true), refetch: vi.fn() }) }
})

/*
 * C: the development-only Design Sandbox shows the Phase 3B foundation.
 * D: it can never become a production surface.
 */

const w = () => mount(DesignSandbox)

describe('designSandbox — 3E command', () => {
  it('renders the production Command components busy, quiet and reconnecting', () => {
    const section = w().get('[data-testid="sandbox-command"]')
    const busy = section.get('[data-testid="sandbox-command-busy"]')
    expect(busy.find('[data-testid="command-status"]').exists()).toBe(true)
    expect(busy.findAll('[data-testid="active-work-agent"]')).toHaveLength(5)
    expect(busy.findAll('[data-testid="active-work-group"][data-kind="repository"]')).toHaveLength(2)
    expect(busy.find('[data-testid="active-work-group"][data-kind="unknown"]').exists()).toBe(true)
    expect(section.find('[data-testid="sandbox-command-quiet"] [data-testid="active-work-empty"]').exists()).toBe(true)
    expect(section.find('[data-testid="sandbox-command-reconnecting"] [data-testid="active-work-stale"]').exists()).toBe(true)
  })
})

describe('designSandbox — 3C attention states', () => {
  it('renders the production Needs you band in every supported state', () => {
    const section = w().get('[data-testid="sandbox-attention"]')
    for (const id of ['ready-4', 'ready-1', 'ready-0', 'loading-0', 'unavailable-0'])
      expect(section.find(`[data-testid="sandbox-attention-${id}"] [data-testid="needs-you"]`).exists(), id).toBe(true)
    const levels = section.findAll('[data-testid="needs-you-level"]').map(l => l.text())
    expect(levels).toEqual(expect.arrayContaining(['Blocking', 'Failed', 'Ready']))
    expect(levels).not.toContain('Stalled')
    expect(section.find('[data-testid="needs-you-quiet"]').exists()).toBe(true)
  })
})

describe('designSandbox — 3B foundation (C)', () => {
  it('shows the full type scale, each row using its own utility', () => {
    const scale = w().get('[data-testid="sandbox-type-scale"]')
    for (const cls of ['text-title-lg', 'text-title', 'text-body', 'text-ui', 'text-ui-sm', 'text-label']) {
      const rowEl = scale.get(`[data-testid="sandbox-type-${cls}"]`)
      expect(rowEl.find(`.${cls}`).exists(), cls).toBe(true)
    }
  })

  it('shows both radius roles', () => {
    const radius = w().get('[data-testid="sandbox-radius"]')
    expect(radius.get('[data-testid="sandbox-radius-rounded-control"]').classes()).toContain('rounded-control')
    expect(radius.get('[data-testid="sandbox-radius-rounded-panel"]').classes()).toContain('rounded-panel')
  })

  it('shows every surface level, including recessed', () => {
    const surfaces = w().get('[data-testid="sandbox-surfaces"]')
    for (const token of ['app', 'card', 'raised', 'recessed'])
      expect(surfaces.find(`[data-testid="sandbox-surface-${token}"]`).exists(), token).toBe(true)
    expect(surfaces.get('[data-testid="sandbox-surface-recessed"]').classes()).toContain('bg-recessed')
  })

  it('shows the semantic state colours, each with its word', () => {
    const states = w().get('[data-testid="sandbox-state-colors"]')
    for (const [key, word] of [['working', 'Working'], ['waiting', 'Needs you'], ['error', 'Error'], ['success', 'Completed'], ['live', 'Live'], ['idle', 'Idle']]) {
      const swatch = states.get(`[data-testid="sandbox-state-${key}"]`)
      expect(swatch.text(), key).toContain(word)
    }
  })

  it('draws live and success as two different things', () => {
    const cmp = w().get('[data-testid="sandbox-live-vs-success"]')
    const live = cmp.get('[data-testid="sandbox-live-example"]')
    const success = cmp.get('[data-testid="sandbox-success-example"]')
    expect(live.classes()).toContain('bg-live-soft')
    expect(live.html()).toContain('text-live-text')
    expect(live.html()).not.toMatch(/success/)
    expect(success.classes()).toContain('bg-success-soft')
    expect(success.html()).not.toMatch(/live/)
  })

  it('includes live data flow in the motion vocabulary, drawn on an edge', () => {
    const motion = w().get('[data-testid="sandbox-motion"]')
    expect(motion.get('[data-testid="sandbox-motion-flow"] line').classes()).toContain('motion-flow')
  })
})

describe('designSandbox — never a production surface (D)', () => {
  const app = readFileSync(resolve(process.cwd(), 'src/App.vue'), 'utf8')

  // 3N: agent categories and the tool sweep are part of the documented vocabulary.
  it('shows every agent category with its glyph and the rule that decides it', () => {
    const section = w().get('[data-testid="sandbox-agent-categories"]')
    const glyphs = section.findAll('[data-testid="agent-glyph"]').map(g => g.attributes('data-category'))
    expect(glyphs).toEqual(['task', 'internal', 'desktop', 'terminal', 'cli'])
    expect(section.text()).toContain('Pipeline task agent')
  })

  it('includes the tool sweep in the motion vocabulary, drawn on an edge', () => {
    const sweep = w().get('[data-testid="sandbox-motion-sweep"]')
    expect(sweep.find('.motion-sweep').exists()).toBe(true)
  })

  it('is imported only inside a compile-time development branch', () => {
    // Vite replaces import.meta.env.DEV with a literal false in production, so
    // the dynamic import sits in dead code and no chunk is emitted.
    expect(app).toMatch(/import\.meta\.env\.DEV\s*\?\s*defineAsyncComponent\(\(\) => import\('@\/features\/design\/DesignSandbox\.vue'\)\)\s*:\s*undefined/)
  })

  it('has no navigation entry and opens only on its explicit hash', async () => {
    const nav = readFileSync(resolve(process.cwd(), 'src/utils/navConfig.ts'), 'utf8')
    expect(nav).not.toMatch(/sandbox|design/i)
    expect(app).toContain('#design-sandbox')
  })
})
