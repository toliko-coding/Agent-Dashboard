import type { Agent } from '@/types'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { agentActivity } from '@/utils/agentLabels'

/*
 * Guards for the Phase 3L convergence: the old generation of the UI must not
 * come back through a side door.
 *
 * Source scans, deliberately narrow: templates only (comments stripped), and
 * only for claims that are wrong wherever they appear.
 */

const ROOT = process.cwd()
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')

function template(src: string): string {
  const start = src.indexOf('<template>')
  const end = src.lastIndexOf('</template>')
  return start === -1 ? '' : src.slice(start, end).replace(/<!--[\s\S]*?-->/g, '')
}

const TAG_RE = /<[^>]*>/g
const MUSTACHE_RE = /\{\{[\s\S]*?\}\}/g

/** What a template can put on screen as literal copy: no tags, attributes or expressions. */
function visibleCopy(src: string): string {
  return template(src).replace(TAG_RE, ' ').replace(MUSTACHE_RE, ' ')
}

function vueFiles(dir: string): string[] {
  return (readdirSync(resolve(ROOT, dir), { recursive: true }) as string[])
    .filter(f => f.endsWith('.vue'))
    .map(f => join(dir, f))
}

// A
describe('agent identity — one name on every surface that shows an agent', () => {
  const SURFACES = [
    'src/features/agents/components/AgentCard.vue',
    'src/features/agents/components/AgentRow.vue',
    'src/features/agents/components/AgentModal.vue',
    'src/features/cockpit/components/ActiveWorkRow.vue',
    'src/features/cockpit/components/TopologyWorkspaceNode.vue',
    'src/features/cockpit/components/RuntimeTopologyTree.vue',
    'src/features/pipeline/components/TaskCard.vue',
    'src/components/SpotlightSearch.vue',
    'src/features/terminal/components/TerminalView.vue',
  ]

  it.each(SURFACES)('%s names agents with agentTitle, never the folder name', (file) => {
    const src = read(file)
    expect(src).toContain('agentTitle')
    expect(template(src)).not.toMatch(/projectName/)
  })

  it('the details diagram keeps the working directory path out of its accessible name', () => {
    const src = template(read('src/features/agents/components/AgentDiagram.vue'))
    expect(src).toContain('agentTitle(agent)')
    expect(src).not.toMatch(/aria-label="[^"]*agent\.cwd/)
  })
})

describe('agentActivity — the card and the row share one rule', () => {
  const agent = (over: Partial<Agent>) => ({ status: 'active', working: false, lastTools: [], currentAction: null, ...over }) as unknown as Agent

  it('states finished, working, the tool in use, and the last tool — names only', () => {
    expect(agentActivity(agent({ status: 'finished' }))).toBe('Finished')
    expect(agentActivity(agent({ working: true }))).toBe('Working')
    expect(agentActivity(agent({ working: true, pendingToolUse: { id: 't', tool: 'Bash' } } as Partial<Agent>))).toBe('Using Bash')
    expect(agentActivity(agent({ lastTools: [{ name: 'Read' }] } as Partial<Agent>))).toBe('Last tool Read')
    expect(agentActivity(agent({}))).toBe('No tool used yet')
  })

  it('is what both the card and the row render', () => {
    expect(read('src/features/agents/components/AgentCard.vue')).toContain('agentActivity(props.agent)')
    expect(read('src/features/agents/components/AgentRow.vue')).toContain('agentActivity(props.agent)')
  })
})

// E + F
describe('status wording — deprecated claims do not return', () => {
  const files = vueFiles('src').filter(f => !f.includes('features/design/'))

  it('no template claims global health, stalls or inferred inactivity', () => {
    const offenders = files.filter(f => /System Online|all systems normal|\bstalled\b|No activity/i.test(visibleCopy(read(f))))
    expect(offenders).toEqual([])
  })

  it('no template labels UTC-day spend as "today"', () => {
    const offenders = files.filter(f => /\bTODAY\b|Today's spend/.test(visibleCopy(read(f))))
    expect(offenders).toEqual([])
  })
})

// I
describe('cleaned-up surfaces start no observation of their own', () => {
  it.each([
    'src/components/SpotlightSearch.vue',
    'src/features/terminal/components/TerminalView.vue',
    'src/features/projects/components/ProjectsView.vue',
    'src/components/SchedulesView.vue',
    'src/features/agents/components/AgentRow.vue',
    'src/features/pipeline/components/PipelineBoard.vue',
    'src/features/workflows/components/WorkflowsView.vue',
    'src/features/analytics/components/EvalView.vue',
  ])('%s reads no runtime poller and sets no interval', (file) => {
    expect(read(file)).not.toMatch(/useLocalMachine|useMachine(?:Services|Processes|Devices)|useSystemResources|setInterval\(/)
  })
})

// G (scale): the Settings migration stays migrated.
describe('settings form scale', () => {
  it('no Settings section uses sub-scale (9/10px) or the old 17px heading', () => {
    const offenders = vueFiles('src/features/settings/components').filter(f => /text-\[(?:9|10|17)px\]/.test(read(f)))
    expect(offenders).toEqual([])
  })
})
