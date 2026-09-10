import type { WorkspaceRef } from '@/types'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import WorkspaceBadge from './WorkspaceBadge.vue'

function ws(over: Partial<WorkspaceRef> = {}): WorkspaceRef {
  return {
    id: 'ws_aaa',
    name: 'Agent-Dashboard',
    kind: 'git-main',
    branch: 'main',
    repository: { id: 'repo_xxx', name: 'Agent-Dashboard' },
    ...over,
  } as WorkspaceRef
}

const render = (w: WorkspaceRef | null) => mount(WorkspaceBadge, { props: { workspace: w } })

describe('workspaceBadge', () => {
  it('shows the branch', () => {
    expect(render(ws({ branch: 'feat/localscope-integration' })).text()).toContain('feat/localscope-integration')
  })

  /*
   * The case this component exists for: two agents in two worktrees of one
   * repository. Before it, both cards read "Agent-Dashboard" and nothing else
   * separated them.
   */
  it('makes two worktrees of one repository distinguishable', () => {
    const a = render(ws({ id: 'ws_a', branch: 'feat/localscope-integration' }))
    const b = render(ws({ id: 'ws_b', kind: 'git-worktree', branch: 'feat/ui-redesign' }))

    expect(a.text()).not.toBe(b.text())
    expect(a.get('[data-workspace-id]').attributes('data-workspace-id'))
      .not
      .toBe(b.get('[data-workspace-id]').attributes('data-workspace-id'))
  })

  it('marks a linked worktree as such, in words and not only in colour', () => {
    const w = render(ws({ kind: 'git-worktree', branch: 'feat/x' }))
    expect(w.text()).toContain('worktree')
    expect(w.find('[data-testid="workspace-branch-worktree"]').exists()).toBe(true)
  })

  it('does not mark the main checkout as a worktree', () => {
    const w = render(ws())
    expect(w.find('[data-testid="workspace-branch"]').exists()).toBe(true)
    expect(w.text()).not.toContain('worktree')
  })

  it('reports a detached HEAD rather than an empty branch', () => {
    expect(render(ws({ branch: '', detached: true })).text()).toContain('detached')
  })

  // Unknown is not a state to illustrate, and a folder name is not an identity.
  it('renders nothing when identity could not be resolved', () => {
    expect(render(null).html()).toBe('<!--v-if-->')
  })

  it('renders nothing for a directory that is not a checkout', () => {
    expect(render(ws({ kind: 'plain', branch: '', repository: null })).html()).toBe('<!--v-if-->')
  })

  it('renders nothing when no branch was observed', () => {
    expect(render(ws({ branch: '' })).html()).toBe('<!--v-if-->')
  })

  it('never displays a filesystem path', () => {
    const w = render(ws({ name: 'Agent-Dashboard', branch: 'main' }))
    expect(w.text()).not.toMatch(/\//)
    expect(w.html()).not.toContain('/Users')
    expect(w.html()).not.toContain('.git')
  })

  it('states the checkout kind to assistive technology', () => {
    expect(render(ws({ kind: 'git-worktree', branch: 'feat/x' })).get('.sr-only').text())
      .toContain('linked worktree')
    expect(render(ws()).get('.sr-only').text()).toContain('main checkout')
  })
})
