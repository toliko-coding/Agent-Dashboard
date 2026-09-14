import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useViewState } from '@/composables/useViewState'
import { axe } from '@/utils/testA11y'
import ProjectsView from './ProjectsView.vue'

const projects = ref<any[]>([])

vi.mock('@/composables/useProjects', () => ({
  useProjects: () => ({ projects, isLoading: ref(false), error: ref(null) }),
}))

describe('projectsView (3L)', () => {
  it('lists Dashboard Projects with folder names, never absolute paths', () => {
    projects.value = [{
      id: 'p1',
      name: 'Alpha',
      description: 'The alpha product',
      color: '#f97316',
      folders: [{ id: 'f1', path: '/Users/x/code/alpha-web' }, { id: 'f2', path: '/Users/x/code/alpha-api/' }],
    }]
    const w = mount(ProjectsView)
    const row = w.get('[data-testid="project-row"]')
    expect(row.text()).toContain('Alpha')
    expect(row.text()).toContain('2 folders')
    expect(row.get('[data-testid="project-folders"]').text()).toContain('alpha-web')
    expect(row.get('[data-testid="project-folders"]').text()).toContain('alpha-api')
    expect(w.html()).not.toContain('/Users/x')
  })

  it('keeps Project terminology — not repository or workspace', () => {
    projects.value = [{ id: 'p1', name: 'Alpha', folders: [] }]
    expect(mount(ProjectsView).text()).not.toMatch(/repositor|workspace/i)
  })

  it('empty, it states what is absent and links to where projects are added', async () => {
    projects.value = []
    const w = mount(ProjectsView)
    expect(w.get('[data-testid="projects-empty"]').text()).toContain('No projects registered yet')
    await w.get('[data-testid="projects-open-settings"]').trigger('click')
    expect(useViewState().activeView.value).toBe('settings')
  })

  it('has no axe violations', async () => {
    projects.value = [{ id: 'p1', name: 'Alpha', description: 'x', folders: [{ id: 'f1', path: '/a/b' }] }]
    const w = mount(ProjectsView, { attachTo: document.body })
    expect(await axe(w.element as Element)).toHaveNoViolations()
    w.unmount()
  })
})
