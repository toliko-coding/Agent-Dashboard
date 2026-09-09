import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

const stubs = { CockpitPanel: { template: '<div><slot name="action" /><slot /></div>' } }

async function mountPanel(opts: {
  projects?: any[]
  agents?: any[]
  loading?: boolean
  error?: string | null
}) {
  vi.resetModules()
  vi.doMock('@/composables/useProjects', () => ({
    useProjects: () => ({
      projects: { value: opts.projects ?? [] },
      isLoading: { value: opts.loading ?? false },
      error: { value: opts.error ?? null },
    }),
  }))
  vi.doMock('@/features/agents', () => ({
    useAgents: () => ({ agents: { value: opts.agents ?? [] } }),
  }))
  const C = (await import('./ProjectsSummaryPanel.vue')).default
  return mount(C, { global: { stubs } })
}

const withFolder = {
  id: 'p1',
  name: 'Agent-Dashboard',
  folders: [{ id: 'f1', path: '/gh/Agent-Dashboard' }],
}
const withoutFolder = { id: 'p2', name: 'No Folder', folders: [] }

describe('projectsSummaryPanel', () => {
  it('counts agents by path containment, not by name', async () => {
    const w = await mountPanel({
      projects: [withFolder],
      agents: [
        { cwd: '/gh/Agent-Dashboard', status: 'active' },
        { cwd: '/gh/Agent-Dashboard/sub', status: 'idle' },
        // Same basename, different location — must NOT be attributed.
        { cwd: '/elsewhere/Agent-Dashboard', projectName: 'Agent-Dashboard', status: 'active' },
      ],
    })
    expect(w.get('[data-testid="project-agents-p1"]').text()).toBe('1/2 active')
  })

  // The distinction the whole phase turns on.
  it('shows a dash, not 0, when the project has no folder to match against', async () => {
    const w = await mountPanel({
      projects: [withoutFolder],
      agents: [{ cwd: '/gh/whatever', status: 'active' }],
    })
    const cell = w.get('[data-testid="project-agents-unknown-p2"]')
    expect(cell.text()).toContain('—')
    expect(cell.text()).not.toContain('0')
    expect(w.find('[data-testid="project-agents-p2"]').exists()).toBe(false)
  })

  it('shows a genuine 0 when folders exist but nothing is running there', async () => {
    const w = await mountPanel({ projects: [withFolder], agents: [{ cwd: '/other', status: 'active' }] })
    expect(w.get('[data-testid="project-agents-p1"]').text()).toBe('0/0 active')
  })

  it('emits navigate from the Open action', async () => {
    const w = await mountPanel({ projects: [withFolder] })
    await w.get('[data-testid="projects-open-all"]').trigger('click')
    expect(w.emitted('navigate')).toHaveLength(1)
  })

  it('renders no repository, port or runtime — the entity carries none', async () => {
    const w = await mountPanel({ projects: [withFolder], agents: [] })
    const text = w.text().toLowerCase()
    expect(text).not.toContain('github.com')
    expect(text).not.toContain('localhost:')
    expect(text).not.toContain('node.js')
  })
})
