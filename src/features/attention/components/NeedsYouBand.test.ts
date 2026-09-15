import type { AttentionItem, AttentionQueue } from '../queue'
import type { Agent } from '@/types'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { axe } from '@/utils/testA11y'
import { buildAttentionQueue } from '../queue'
import NeedsYouBand from './NeedsYouBand.vue'

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

function item(o: Partial<AttentionItem> & Pick<AttentionItem, 'id' | 'level' | 'kind'>): AttentionItem {
  return {
    subject: { type: 'agent', sessionId: o.id },
    agentSessionId: o.id,
    workspace: { id: 'ws', name: 'Agent-Dashboard', kind: 'git-worktree', branch: 'feat/command-center-ui', repository: { id: 'r', name: 'Agent-Dashboard' } },
    repository: { id: 'r', name: 'Agent-Dashboard' },
    title: `Claude session ${o.id}`,
    reason: 'Permission request waiting',
    since: ago(4.5),
    lastActivity: ago(1.5),
    ...o,
  }
}

const BLOCKING = item({ id: 'blocked', level: 'blocking', kind: 'permission', detail: 'Bash' })
const FAILED = item({ id: 'failed', level: 'failed', kind: 'api-error', reason: 'Rate limited', since: null })
const READY: AttentionItem = {
  ...item({ id: 'task:review', level: 'ready', kind: 'task-waiting', reason: 'Pipeline task waiting for you', since: null, lastActivity: null }),
  subject: { type: 'task', taskId: 'review' },
  agentSessionId: null,
  workspace: null,
  repository: null,
  title: 'Refactor billing',
}

const ready = (items: AttentionItem[], stale = false): AttentionQueue => ({ status: 'ready', stale, items })

let wrappers: { unmount: () => void }[] = []
function render(queue: AttentionQueue) {
  const w = mount(NeedsYouBand, { props: { queue }, attachTo: document.body })
  wrappers.push(w)
  return w
}
afterEach(() => {
  wrappers.forEach(w => w.unmount())
  wrappers = []
})

describe('needsYouBand — populated', () => {
  it('has a real heading and states the count in text', () => {
    const w = render(ready([BLOCKING, FAILED]))
    expect(w.get('h2').text()).toBe('Needs you')
    expect(w.get('[data-testid="needs-you-count"]').text()).toBe('2 waiting')
    expect(w.get('section').attributes('aria-labelledby')).toBe('needs-you-heading')
  })

  it('renders items in queue order, each with its level as a word', () => {
    const w = render(ready([BLOCKING, FAILED, READY]))
    expect(w.findAll('[data-testid="needs-you-level"]').map(l => l.text())).toEqual(['Blocking', 'Failed', 'Ready'])
  })

  it('answers who, why, where and how long', () => {
    const row = render(ready([BLOCKING])).get('[data-testid="needs-you-item"]')
    expect(row.get('[data-testid="needs-you-title"]').text()).toBe('Claude session blocked')
    expect(row.get('[data-testid="needs-you-reason"]').text()).toBe('Permission request waiting')
    expect(row.get('[data-testid="needs-you-where"]').text()).toBe('Agent-Dashboard · feat/command-center-ui · worktree')
    expect(row.get('[data-testid="needs-you-when"]').text()).toBe('requested 4m ago')
  })

  // H (UI)
  it('says the workspace is unknown instead of guessing one', () => {
    const w = render(ready([{ ...BLOCKING, workspace: null, repository: null }]))
    expect(w.get('[data-testid="needs-you-where"]').text()).toBe('Workspace unknown')
  })

  it('labels last activity as last activity when the request carries no time', () => {
    const w = render(ready([FAILED]))
    expect(w.get('[data-testid="needs-you-when"]').text()).toBe('last activity 1m ago')
  })

  it('uses amber for blocking and red for failed, and never the live or success colour', () => {
    const w = render(ready([BLOCKING, FAILED, READY]))
    const [blocking, failed] = w.findAll('[data-testid="needs-you-level"]')
    expect(blocking.classes()).toContain('text-warning-text')
    expect(failed.classes()).toContain('text-danger-text')
    expect(w.html()).not.toMatch(/\b(bg|text|border)-(live|success)/)
    expect(w.get('section').classes()).toContain('bg-warning-soft')
  })

  // The 11px level word failed contrast on the soft red fill in the light theme (axe, 3.9:1).
  it('sets every level word on the card surface, not on a soft tint', () => {
    const chips = render(ready([BLOCKING, FAILED, READY])).findAll('[data-testid="needs-you-level"]')
    for (const chip of chips) {
      expect(chip.classes()).toContain('bg-card')
      expect(chip.classes().join(' ')).not.toMatch(/-soft\b/)
    }
  })

  // O (band)
  it('emits the selected item on click', async () => {
    const w = render(ready([BLOCKING, READY]))
    await w.findAll('[data-testid="needs-you-item"]')[1].trigger('click')
    expect(w.emitted('select')).toEqual([[READY]])
  })

  it('makes every item a real button with an accessible name carrying the state in words', () => {
    const buttons = render(ready([BLOCKING, FAILED])).findAll('button[data-testid="needs-you-item"]')
    expect(buttons).toHaveLength(2)
    expect(buttons[0].attributes('aria-label')).toMatch(/^Blocking, Claude session blocked, Permission request waiting/)
  })

  it('keeps last-known items and says so while agent updates reconnect', () => {
    const w = render(ready([BLOCKING], true))
    expect(w.findAll('[data-testid="needs-you-item"]')).toHaveLength(1)
    expect(w.get('[data-testid="needs-you-stale"]').text()).toContain('reconnecting')
  })
})

describe('needsYouBand — motion', () => {
  it('gives only blocking items the one-shot arrival ring, and nothing loops', () => {
    const rows = render(ready([BLOCKING, FAILED, READY])).findAll('[data-testid="needs-you-item"]')
    expect(rows.map(r => r.classes().includes('motion-arrive-attention'))).toEqual([true, false, false])
    for (const row of rows)
      expect(row.classes().join(' ')).not.toMatch(/animate-pulse|motion-waiting|motion-working/)
  })
})

describe('needsYouBand — quiet, loading, unavailable', () => {
  // L
  it('shows one compact, honest line when nothing is waiting', () => {
    const w = render(ready([]))
    expect(w.find('[data-testid="needs-you-list"]').exists()).toBe(false)
    expect(w.get('[data-testid="needs-you-quiet"]').text()).toBe('Nothing is waiting on your decision.')
    expect(w.text()).not.toMatch(/healthy|normal|all systems|nothing is wrong/i)
    expect(w.get('h2').classes()).toContain('text-ui')
  })

  it('does not claim the present when quiet but reconnecting', () => {
    const w = render(ready([], true))
    expect(w.get('[data-testid="needs-you-quiet"]').text()).toContain('at the last update')
  })

  // M
  it('does not show a quiet or zero state before the queue is known', () => {
    const w = render({ status: 'loading', stale: false, items: [] })
    expect(w.find('[data-testid="needs-you-loading"]').exists()).toBe(true)
    expect(w.find('[data-testid="needs-you-quiet"]').exists()).toBe(false)
    expect(w.get('section').attributes('data-count')).toBeUndefined()
    expect(w.text()).not.toMatch(/\b0\b/)
  })

  it('says the queue is unknown when agent updates never loaded', () => {
    const w = render({ status: 'unavailable', stale: false, items: [] })
    expect(w.get('[data-testid="needs-you-unavailable"]').text()).toContain('Unknown')
  })
})

describe('needsYouBand — announcements', () => {
  const announcement = (w: ReturnType<typeof render>) => w.get('[data-testid="needs-you-announcement"]').text()

  it('does not announce what was already there when the page arrived', () => {
    expect(announcement(render(ready([BLOCKING])))).toBe('')
  })

  it('announces a newly arriving blocking item once, politely', async () => {
    const w = render(ready([FAILED]))
    const region = w.get('[data-testid="needs-you-announcement"]')
    expect(region.attributes('aria-live')).toBe('polite')
    await w.setProps({ queue: ready([BLOCKING, FAILED]) })
    await nextTick()
    expect(announcement(w)).toBe('Needs you: Claude session blocked, Permission request waiting')
    // A re-render with the same blocking set does not re-announce something new.
    await w.setProps({ queue: ready([BLOCKING, FAILED, READY]) })
    await nextTick()
    expect(announcement(w)).toBe('Needs you: Claude session blocked, Permission request waiting')
  })

  it('does not announce a new failed or ready item', async () => {
    const w = render(ready([]))
    await w.setProps({ queue: ready([FAILED, READY]) })
    await nextTick()
    expect(announcement(w)).toBe('')
  })
})

describe('needsYouBand — privacy', () => {
  // P (rendered)
  it('renders no path, command, question text or transcript from the agent', () => {
    const agent = {
      sessionId: 'leaky-0001',
      provider: 'claude',
      status: 'active',
      working: false,
      cwd: '/Users/someone/secret-client/repo',
      projectPath: '/Users/someone/secret-client/repo',
      projectName: 'secret-client',
      lastActivity: ago(2),
      lastOutput: 'transcript: the deploy key is abc123',
      workspace: null,
      pendingQuestion: { header: 'h', question: 'Paste the production token?', multiSelect: false, options: [], typeSomethingIndex: 1, chatAboutIndex: 2 },
      pendingToolUse: { id: 'tu', tool: 'Bash', pattern: 'cat ~/.ssh/id_rsa', patternDisplay: 'cat ~/.ssh/id_rsa' },
    } as unknown as Agent
    const items = buildAttentionQueue({ agents: [agent], permissionItems: [], capabilityDecisions: [], tasks: [] })
    const w = render(ready(items))
    const rendered = w.html()
    for (const secret of ['/Users/', 'secret-client', 'transcript', 'production token', 'id_rsa'])
      expect(rendered).not.toContain(secret)
  })
})

describe('needsYouBand — accessibility', () => {
  it('has no axe violations when populated', async () => {
    const w = render(ready([BLOCKING, FAILED, READY]))
    expect(await axe(w.element as Element)).toHaveNoViolations()
  })

  it('has no axe violations when quiet or loading', async () => {
    expect(await axe(render(ready([])).element as Element)).toHaveNoViolations()
    expect(await axe(render({ status: 'loading', stale: false, items: [] }).element as Element)).toHaveNoViolations()
  })
})

vi.mock('@/composables/useToast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

describe('needsYouBand — terminal permission decisions (Phase 4)', () => {
  const perm = (id: string, o: Partial<NonNullable<AttentionItem['permission']>> = {}) => item({
    id,
    level: 'blocking',
    kind: 'terminal-permission',
    reason: 'Wants permission',
    since: null,
    agentPid: 4242,
    permission: { id: `prompt-${id}`, tool: 'Bash', detail: 'shasum -a 256 notes/sample.txt', question: 'Do you want to proceed?', decidable: true, attachable: true, ...o },
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows what is asked and decides it once, for an agent Agent Dashboard started', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }))
    vi.stubGlobal('fetch', fetchMock)
    const w = render(ready([perm('a')]))
    const row = w.get('[data-testid="needs-you-permission"]')
    expect(row.attributes('data-decidable')).toBe('true')
    expect(row.get('[data-testid="needs-you-permission-tool"]').text()).toBe('Bash')
    expect(row.get('[data-testid="needs-you-permission-detail"]').text()).toBe('shasum -a 256 notes/sample.txt')
    expect(row.get('[data-testid="needs-you-permission-terminal"]').text()).toBe('Open terminal →')
    await row.get('[data-testid="needs-you-permission-approve"]').trigger('click')
    await nextTick()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/agents/4242/terminal-permission')
    expect(JSON.parse(String(init.body))).toEqual({ promptId: 'prompt-a', decision: 'approve_once' })
    expect(row.get('[data-testid="needs-you-permission-approve"]').attributes('disabled')).toBeDefined()
    expect(row.get('[data-testid="needs-you-permission-deny"]').attributes('disabled')).toBeDefined()
    await row.get('[data-testid="needs-you-permission-deny"]').trigger('click')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('offers only the terminal for a prompt it cannot decide', () => {
    const row = render(ready([perm('b', { decidable: false })])).get('[data-testid="needs-you-permission"]')
    expect(row.find('[data-testid="needs-you-permission-approve"]').exists()).toBe(false)
    expect(row.get('[data-testid="needs-you-permission-terminal"]').text()).toBe('Respond in terminal →')
  })

  it('offers no action for a session Agent Dashboard did not start', () => {
    const row = render(ready([perm('c', { attachable: false })])).get('[data-testid="needs-you-permission"]')
    expect(row.find('[data-testid="needs-you-permission-approve"]').exists()).toBe(false)
    expect(row.find('[data-testid="needs-you-permission-terminal"]').exists()).toBe(false)
    expect(row.get('[data-testid="needs-you-permission-elsewhere"]').text()).toContain('terminal that started it')
  })

  it('asks for the terminal without selecting the row', async () => {
    const w = render(ready([perm('d')]))
    await w.get('[data-testid="needs-you-permission-terminal"]').trigger('click')
    expect(w.emitted('openTerminal')).toHaveLength(1)
    expect(w.emitted('select')).toBeUndefined()
  })

  it('has no axe violations with a decision row', async () => {
    const w = render(ready([perm('e'), BLOCKING]))
    expect(await axe(w.element as Element)).toHaveNoViolations()
  })
})
