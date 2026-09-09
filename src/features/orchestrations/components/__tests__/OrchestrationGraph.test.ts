import type { OrchestrationDependencyEdge, OrchestrationTaskNode } from '../../types'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import OrchestrationGraph from '../OrchestrationGraph.vue'

function node(
  id: string,
  depth: number,
  parentTaskId: string | null,
  extra: Partial<OrchestrationTaskNode> = {},
): OrchestrationTaskNode {
  return {
    id,
    slug: id,
    title: id,
    stage: 'backlog',
    priority: 'medium',
    parentTaskId,
    delegatedByStageRunId: null,
    spawnerId: null,
    projectId: null,
    depth,
    ...extra,
  }
}

const tasks = [node('root', 0, null), node('a', 1, 'root'), node('b', 1, 'root')]
const dependencies: OrchestrationDependencyEdge[] = [
  { id: 'd1', taskId: 'b', dependsOnId: 'a', requiredStage: 'done' },
]

function paths(w: ReturnType<typeof mount>) {
  return w.findAll('svg > path')
}

describe('orchestrationGraph', () => {
  // The point of the graph: delegation and dependency are different
  // relationships and must not render alike.
  it('draws delegation solid and dependency dashed', () => {
    const w = mount(OrchestrationGraph, { props: { tasks, dependencies } })
    const all = paths(w)

    const solid = all.filter(p => !p.attributes('stroke-dasharray'))
    const dashed = all.filter(p => p.attributes('stroke-dasharray'))

    expect(solid).toHaveLength(2) // root→a, root→b
    expect(dashed).toHaveLength(1) // a→b dependency
  })

  it('gives the two edge kinds different stroke colours as well as patterns', () => {
    const w = mount(OrchestrationGraph, { props: { tasks, dependencies } })
    const all = paths(w)
    const solidClass = all.find(p => !p.attributes('stroke-dasharray'))!.classes()
    const dashedClass = all.find(p => p.attributes('stroke-dasharray'))!.classes()
    expect(solidClass).toContain('stroke-line-strong')
    expect(dashedClass).toContain('stroke-info-text')
  })

  it('renders one node group per task', () => {
    const w = mount(OrchestrationGraph, { props: { tasks, dependencies } })
    expect(w.findAll('g[role="button"]')).toHaveLength(3)
  })

  it('emits the task id when a node is activated', async () => {
    const w = mount(OrchestrationGraph, { props: { tasks, dependencies } })
    await w.findAll('g[role="button"]')[1].trigger('click')
    expect(w.emitted('select')?.[0]).toEqual(['a'])
  })

  // Null provenance means a person created the task. Marking every node would
  // claim a delegation that never happened.
  it('marks only tasks that carry delegation provenance', () => {
    const w = mount(OrchestrationGraph, {
      props: {
        tasks: [
          node('root', 0, null),
          node('a', 1, 'root', { delegatedByStageRunId: 'run-1' }),
          node('b', 1, 'root'),
        ],
        dependencies: [],
      },
    })
    expect(w.findAll('text').filter(t => t.text() === 'delegated')).toHaveLength(1)
  })

  it('says nothing to draw rather than rendering an empty canvas', () => {
    const w = mount(OrchestrationGraph, { props: { tasks: [], dependencies: [] } })
    expect(w.find('svg[role="img"]').exists()).toBe(false)
    expect(w.text()).toContain('Nothing to draw')
  })

  it('always shows the legend so the two line styles are readable', () => {
    const w = mount(OrchestrationGraph, { props: { tasks, dependencies } })
    expect(w.text()).toContain('Delegation')
    expect(w.text()).toContain('Dependency')
  })

  it('highlights the selected node', () => {
    const w = mount(OrchestrationGraph, { props: { tasks, dependencies, selectedId: 'a' } })
    const highlighted = w.findAll('rect').filter(r => r.classes().includes('stroke-accent'))
    expect(highlighted).toHaveLength(1)
  })
})
