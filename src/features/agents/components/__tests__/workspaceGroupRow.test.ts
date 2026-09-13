import type { Agent, WorkspaceRef } from '@/types'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import WorkspaceGroupRow from '../WorkspaceGroupRow.vue'

function ws(over: Partial<WorkspaceRef> = {}): WorkspaceRef {
  return {
    id: 'ws_a',
    name: 'Agent-Dashboard',
    kind: 'git-main',
    branch: 'main',
    repository: { id: 'repo_ad', name: 'Agent-Dashboard' },
    ...over,
  } as WorkspaceRef
}

const agents = (n: number) => Array.from({ length: n }, (_, i) => ({ pid: i } as unknown as Agent))
const row = (w: WorkspaceRef, n = 1) => mount(WorkspaceGroupRow, { props: { workspace: w, agents: agents(n) } })

describe('workspaceGroupRow', () => {
  it('names a main checkout by branch and kind, in words', () => {
    const w = row(ws({ branch: 'feat/localscope-integration' }), 2)
    expect(w.text()).toContain('Workspace')
    expect(w.text()).toContain('feat/localscope-integration')
    expect(w.text()).toContain('main checkout')
    expect(w.text()).toContain('2 agents')
    expect(w.get('.sr-only').text()).toBe('Main checkout workspace, feat/localscope-integration, 2 agents')
  })

  it('names a worktree as a worktree, with its directory name to tell twins apart', () => {
    const w = row(ws({ id: 'ws_wt', kind: 'git-worktree', branch: 'feat/ui-redesign', name: 'ui-redesign' }))
    expect(w.text()).toContain('worktree')
    expect(w.text()).toContain('ui-redesign')
    expect(w.get('.sr-only').text()).toContain('Worktree workspace')
    expect(w.attributes('data-workspace-kind')).toBe('git-worktree')
  })

  it('says Detached HEAD for a detached worktree', () => {
    const w = row(ws({ kind: 'git-worktree', branch: '', detached: true, name: 'probe' }))
    expect(w.text()).toContain('Detached HEAD')
    expect(w.text()).toContain('probe')
  })

  it('presents a plain workspace as local, not as a Git repository', () => {
    const w = row(ws({ kind: 'plain', branch: '', name: 'notes', repository: null }))
    expect(w.text()).toContain('Local')
    expect(w.text()).toContain('notes')
    expect(w.text()).toContain('not a Git repository')
    expect(w.text()).not.toContain('⑂')
    expect(w.get('.sr-only').text()).toBe('Local workspace notes, not in a Git repository, 1 agent')
  })

  it('does not repeat the name for a main checkout', () => {
    // A main checkout's name is its repository's name, already on the heading.
    const w = row(ws({ branch: 'main' }))
    expect(w.text()).not.toContain('Agent-Dashboard')
  })

  it('carries the opaque workspace id and no path', () => {
    const w = row(ws({ id: 'ws_opaque' }))
    expect(w.attributes('data-workspace-id')).toBe('ws_opaque')
    expect(w.html()).not.toContain('/Users')
    expect(w.html()).not.toContain('.git')
  })

  // Hierarchy is structure, not activity.
  it('uses no state colour and no motion', () => {
    const w = row(ws({ kind: 'git-worktree', branch: 'x', name: 'y' }))
    expect(w.html()).not.toMatch(/state-|motion-|animate-/)
  })
})
