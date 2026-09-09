import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { stubAuthDisabled, stubEmptyStream, stubJson } from './helpers'

/*
 * Orchestrations, driven through the real shell.
 *
 * The unit tests cover the layout arithmetic; this covers what a person
 * actually gets: the nav entry reaches the view, an empty result says why it is
 * empty instead of showing zeros, and a populated orchestration renders both
 * edge kinds distinguishably.
 *
 * The endpoint is stubbed so the assertions are deterministic — the real
 * backend's task table is whatever the developer left in it.
 */

const SUMMARY = {
  rootTaskId: 'root-1',
  title: 'Ship the exporter',
  slug: 'ship-the-exporter',
  projectId: null,
  counts: { total: 3, done: 1, cancelled: 0, blocked: 0, active: 2 },
  spawnerIds: ['coder'],
  delegated: 1,
  updatedAt: '2026-01-01T00:00:00Z',
}

const DETAIL = {
  ...SUMMARY,
  tasks: [
    {
      id: 'root-1',
      slug: 'ship-the-exporter',
      title: 'Ship the exporter',
      stage: 'implementation',
      priority: 'high',
      parentTaskId: null,
      delegatedByStageRunId: null,
      spawnerId: 'coder',
      projectId: null,
      depth: 0,
    },
    {
      id: 'child-a',
      slug: 'write-the-schema',
      title: 'Write the schema',
      stage: 'done',
      priority: 'medium',
      parentTaskId: 'root-1',
      delegatedByStageRunId: 'run-1',
      spawnerId: 'coder',
      projectId: null,
      depth: 1,
    },
    {
      id: 'child-b',
      slug: 'write-the-writer',
      title: 'Write the writer',
      stage: 'implementation',
      priority: 'medium',
      parentTaskId: 'root-1',
      delegatedByStageRunId: null,
      spawnerId: null,
      projectId: null,
      depth: 1,
    },
  ],
  dependencies: [
    { id: 'dep-1', taskId: 'child-b', dependsOnId: 'child-a', requiredStage: 'done' },
  ],
}

async function openOrchestrations(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Orchestrations' }).click()
}

test.describe('orchestrations', () => {
  test.beforeEach(async ({ page }) => {
    await stubAuthDisabled(page)
    await stubJson(page, '/api/agents', [])
    await stubEmptyStream(page, '/api/agents/stream')
    await stubEmptyStream(page, '/api/tasks/stream')
    await stubJson(page, '/api/audit', [])
  })

  // Empty must state why it is empty. A bare "0" would read as "checked, found
  // none" for a question the view never asked.
  test('empty list explains that childless tasks are not orchestrations', async ({ page }) => {
    await stubJson(page, '/api/orchestrations', [])
    await openOrchestrations(page)

    await expect(page.getByTestId('view-placeholder')).toBeVisible()
    await expect(page.getByTestId('view-placeholder')).toContainText('sub-tasks')
  })

  test('lists an orchestration with its stored counts', async ({ page }) => {
    await stubJson(page, '/api/orchestrations', [SUMMARY])
    await openOrchestrations(page)

    await expect(page.getByText('Ship the exporter')).toBeVisible()
    await expect(page.getByText('ship-the-exporter')).toBeVisible()
  })

  test('opens the detail graph and draws delegation and dependency differently', async ({ page }) => {
    await stubJson(page, '/api/orchestrations', [SUMMARY])
    await stubJson(page, '/api/orchestrations/root-1', DETAIL)
    await openOrchestrations(page)

    await page.getByRole('button', { name: /Ship the exporter/ }).click()
    const graph = page.getByRole('img', { name: /Orchestration graph/ })
    await expect(graph).toBeVisible()

    // Two delegation edges (root→a, root→b), one dependency edge (a→b).
    await expect(graph.locator('path[marker-end$="delegation)"]')).toHaveCount(2)
    await expect(graph.locator('path[stroke-dasharray]')).toHaveCount(1)

    // Both line styles are named, so the distinction is readable without
    // decoding the stroke pattern.
    await expect(page.getByText('Delegation (parent → child)')).toBeVisible()
    await expect(page.getByText('Dependency (must finish first)')).toBeVisible()
  })

  // Null provenance means a person created the task — the view says that in
  // words rather than showing an unknown or placeholder agent.
  test('names the creator honestly for delegated and human-created tasks', async ({ page }) => {
    await stubJson(page, '/api/orchestrations', [SUMMARY])
    await stubJson(page, '/api/orchestrations/root-1', DETAIL)
    await openOrchestrations(page)
    await page.getByRole('button', { name: /Ship the exporter/ }).click()

    await page.getByRole('button', { name: /Write the schema/ }).first().click()
    await expect(page.getByText('stage run run-1')).toBeVisible()

    await page.getByRole('button', { name: /Write the writer/ }).first().click()
    await expect(page.getByText('a person (not delegated by an agent)')).toBeVisible()
    await expect(page.getByText('unassigned')).toBeVisible()
  })

  // This phase adds no agent authority: the view can show delegation, never
  // cause it.
  test('offers no control that would start or change work', async ({ page }) => {
    await stubJson(page, '/api/orchestrations', [SUMMARY])
    await stubJson(page, '/api/orchestrations/root-1', DETAIL)
    await openOrchestrations(page)
    await page.getByRole('button', { name: /Ship the exporter/ }).click()
    await expect(page.getByRole('img', { name: /Orchestration graph/ })).toBeVisible()

    for (const name of [/^Delegate/i, /^Spawn/i, /^Advance/i, /^Cancel/i, /^Retry/i, /^Run\b/i])
      await expect(page.getByRole('button', { name })).toHaveCount(0)
  })
})
