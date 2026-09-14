import type { Agent, WorkspaceRef } from '../../types'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AGENT_GROUP_OPTIONS, groupAgents, resolveGroup } from '../agentGroup'

/*
 * "Folder", not "Project". The roster's projectName grouping and filter were
 * labelled "Project", which let a folder name pose as the persisted Dashboard
 * Project. The copy is corrected; the behaviour and the stored identifiers are
 * deliberately NOT changed.
 */

const src = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')

function agent(projectName: string, workspace: WorkspaceRef | null): Agent {
  return { pid: Math.random(), sessionId: projectName, projectName, costEstimate: 0, workspace } as unknown as Agent
}

describe('folder terminology — behaviour unchanged', () => {
  it('labels the projectName grouping Folder while keeping its stored value', () => {
    const option = AGENT_GROUP_OPTIONS.find(o => o.value === 'project')
    expect(option?.label).toBe('Folder')
  })

  it('still resolves a saved `project` grouping, so no stored selection is invalidated', () => {
    expect(resolveGroup('project', 'all')).toBe('project')
    expect(resolveGroup('project', 'some-spawner')).toBe('project')
  })

  it('still groups by projectName exactly as before — not by identity', () => {
    const a = agent('web', { id: 'ws_1', name: 'web', kind: 'git-main', branch: 'main', repository: { id: 'repo_1', name: 'web' } } as WorkspaceRef)
    const b = agent('web', { id: 'ws_2', name: 'web', kind: 'git-main', branch: 'main', repository: { id: 'repo_2', name: 'web' } } as WorkspaceRef)
    const groups = groupAgents([a, b], 'project')
    // Two different repositories, one folder name: this mode merges them, by design.
    expect(groups).toHaveLength(1)
    expect(groups[0].key).toBe('web')
  })

  it('leaves the repository & workspace grouping unchanged', () => {
    expect(AGENT_GROUP_OPTIONS.find(o => o.value === 'workspace')?.label).toBe('Repository & workspace')
  })
})

describe('folder terminology — copy', () => {
  it('says folders in the roster filter and its chip', () => {
    const view = src('src/features/cockpit/components/DashboardView.vue')
    expect(view).toContain(`label: 'All folders'`)
    expect(view).not.toContain('All projects')

    const toolbar = src('src/components/shell/DashboardToolbar.vue')
    // The chip's template literal, matched without writing a template expression in a string.
    expect(toolbar).toContain('label: `Folder: ')
    expect(toolbar).not.toContain('label: `Project: ')
    expect(toolbar).toContain('aria-label="Filter by folder"')
    // The internal identifiers stay, so saved filter state is untouched.
    expect(toolbar).toContain('data-testid="select-project"')
    expect(toolbar).toContain(`'update:project'`)
  })

  /* The persisted Dashboard Project is a real entity and keeps its name. */
  it('still calls the persisted Dashboard Project "Projects" everywhere it appears', () => {
    expect(src('src/features/cockpit/components/ProjectsSummaryPanel.vue')).toContain('title="Projects"')
    expect(src('src/utils/settingsSections.ts')).toContain(`label: 'Projects'`)
    expect(src('src/features/projects/components/ProjectsView.vue')).toContain('Settings → Projects')
  })
})
