import type { Agent } from '@/types'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import AgentModal from './AgentModal.vue'

const baseAgent: Agent = {
  pid: 1234,
  sessionId: 'sess-1',
  provider: 'claude',
  projectPath: '/home/user/my-project',
  projectName: 'my-project',
  cwd: '/home/user/my-project',
  entrypoint: 'cli',
  status: 'active',
  uptime: 60,
  lastActivity: '2026-01-01T00:00:00Z',
  lastTools: [{ name: 'Read', detail: 'src/main.ts' }],
  tasks: [],
  subagents: [],
  tokenUsage: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
  costEstimate: 0,
  cacheCreationCostEstimate: 0,
  cacheReadCostEstimate: 0,
  healthScore: 80,
  conversationTurns: 0,
  toolCounts: {},
  channelAvailable: false,
  working: false,
  permissionsBypassed: false,
  convergenceAlert: false,
  meta: null,
  workspace: null,
}

const stubs = {
  AppModal: { template: '<div><slot /></div>' },
  AgentChatStream: true,
  CrossLinkBanner: true,
  MachineBadge: true,
  PromptInput: true,
  SubAgentList: true,
  TaskList: true,
  ToolTimeline: true,
  AppBadge: true,
  AgentTerminal: true,
}

function mountModal(agent: Agent = baseAgent) {
  return mount(AgentModal, { props: { agent }, global: { stubs } })
}

describe('agentModal subagent transcript', () => {
  const subagent = {
    id: '33333333-3333-3333-3333-333333333333',
    type: 'subagent',
    status: 'completed',
    currentAction: '',
    sessionFile: '/tmp/x.jsonl',
    tokensUsed: 0,
    durationSeconds: 0,
    latestOutput: '',
  }

  function mountWithSubagent() {
    return mount(AgentModal, {
      props: { agent: { ...baseAgent, subagents: [subagent] } as Agent },
      global: { stubs: { ...stubs, SubAgentList: false, PromptInput: { template: '<div />', methods: { focus() {} } } } },
    })
  }

  it('opens the subagent transcript in place of the session transcript', async () => {
    const w = mountWithSubagent()
    expect(w.find('[data-testid="subagent-transcript"]').exists()).toBe(false)

    await w.get('[data-testid="subagent-open"]').trigger('click')
    expect(w.get('[data-testid="subagent-transcript"]').attributes('sessionid')).toBe(subagent.id)
  })

  it('returns to the session transcript', async () => {
    const w = mountWithSubagent()
    await w.get('[data-testid="subagent-open"]').trigger('click')
    await w.get('[data-testid="subagent-back"]').trigger('click')
    expect(w.find('[data-testid="subagent-transcript"]').exists()).toBe(false)
  })

  // The modal is reused across agents; a stale subagent would open on the wrong session.
  it('drops the open subagent when the modal switches agents', async () => {
    const w = mountWithSubagent()
    await w.get('[data-testid="subagent-open"]').trigger('click')

    await w.setProps({ agent: { ...baseAgent, sessionId: 'other-session', subagents: [] } as Agent })
    expect(w.find('[data-testid="subagent-transcript"]').exists()).toBe(false)
  })
})

describe('agentModal session context', () => {
  const withContext = {
    ...baseAgent,
    tasks: [{ subject: 'Ship it', status: 'in_progress' }],
    subagents: [],
  } as unknown as Agent

  // The bottom drawer is gone: what you read while reading the transcript sits
  // beside it, and the modal keeps no tab bar at its foot.
  it('renders session context beside the transcript, not in a drawer', () => {
    const w = mount(AgentModal, { props: { agent: withContext }, global: { stubs: { ...stubs, TaskList: false } } })
    expect(w.find('[data-testid="agent-context"]').exists()).toBe(true)
    expect(w.find('details').exists()).toBe(false)
  })

  it('omits the context block when the agent has none', () => {
    const w = mountModal({ ...baseAgent, lastTools: [], tasks: [], subagents: [], recentHookEvents: [] } as unknown as Agent)
    expect(w.find('[data-testid="agent-context"]').exists()).toBe(false)
  })

  it('offers the token breakdown from the header instead of a token table', async () => {
    const w = mountModal()
    expect(w.findComponent({ name: 'MetricsPopover' }).exists()).toBe(false)
    await w.get('[data-testid="agent-modal-metrics"]').trigger('click')
    expect(w.findComponent({ name: 'MetricsPopover' }).exists()).toBe(true)
  })

  // The terminal moved to the card; mounting xterm from the modal would defeat that.
  it('mounts no terminal', () => {
    const w = mountModal({ ...baseAgent, liveInjectable: true })
    expect(w.html()).not.toContain('agent-terminal')
  })
})

/*
 * Agent workspace behaviour (Phase 5). The drawer's Overview/Transcript tabs
 * are gone — intelligence sits beside the conversation now — but the honesty
 * cases they guarded still matter: the reference design showed Pause / Stop and
 * a "Phase N/7", none of which the backend can support for a spawned agent.
 */
describe('agentModal — workspace', () => {
  function workspace(agent: Agent = baseAgent) {
    return mount(AgentModal, {
      props: { agent },
      global: { stubs: { ...stubs, AgentIntelligencePanel: true } },
    })
  }

  // 3N.2: a large centred workspace, not a drawer that leaves the page beside it unused.
  it('renders a large centred workspace with the conversation as the main surface', () => {
    const w = workspace()
    const box = w.get('[data-testid="agent-workspace"]')
    const classes = box.classes().join(' ')
    expect(box.attributes('data-layout')).toBe('workspace')
    expect(classes).toContain('min-[1024px]:w-[min(1480px,calc(100vw-4rem))]')
    expect(classes).toContain('min-[1024px]:h-[min(940px,calc(100dvh-3rem))]')
    expect(classes).not.toContain('min-[1440px]:w-[min(1180px,78vw)]')
    const grid = box.get('.grid')
    expect(grid.classes().join(' ')).toContain('lg:grid-cols-[minmax(0,1fr)_minmax(19rem,24rem)]')
    expect(box.get('[aria-label="Conversation"]').classes()).toContain('lg:col-start-1')
    expect(w.find('[data-testid="agent-details-panel"]').exists()).toBe(false)
  })

  it('names the agent in its header with state, handle and topic, and offers Stop and Delete through the shared confirmation', async () => {
    const { useAgentLifecycle } = await import('@/composables/useAgentLifecycle')
    const w = workspace({ ...baseAgent, status: 'active', dashboardOwned: true, displayName: 'Portfolio', title: 'Refactoring responsive navigation' } as Agent)
    expect(w.get('[data-testid="agent-modal-title"]').text()).toBe('Portfolio')
    expect(w.get('[data-testid="agent-modal-technical"]').text()).toMatch(/^Claude · /)
    expect(w.get('[data-testid="agent-modal-topic"]').text()).toBe('Refactoring responsive navigation')
    await w.get('[data-testid="agent-modal-stop"]').trigger('click')
    expect(useAgentLifecycle().pending.value).toMatchObject({ action: 'stop' })
    await w.get('[data-testid="agent-modal-delete"]').trigger('click')
    expect(useAgentLifecycle().pending.value).toMatchObject({ action: 'delete' })
    useAgentLifecycle().cancel()
  })

  // 3N.2.1 C/D/E: a session the dashboard did not launch is observed, and says where to stop it.
  it('offers no Stop or Delete for an external session, and says where it can be stopped', () => {
    const w = workspace({ ...baseAgent, status: 'active', liveInjectable: true } as Agent)
    expect(w.find('[data-testid="agent-modal-stop"]').exists()).toBe(false)
    expect(w.find('[data-testid="agent-modal-delete"]').exists()).toBe(false)
    expect(w.get('[data-testid="agent-modal-observe-only"]').text()).toBe('External session — stop it from the terminal or application that started it.')
    expect(w.find('[data-testid="agent-modal-remove-profile"]').exists()).toBe(false)
  })

  // 3N.2.2 F/G: the name and icon are edited in the shared Edit agent dialog, for any session.
  it('opens Edit agent from the header', async () => {
    const { useAgentProfileEditor } = await import('@/composables/useAgentLifecycle')
    const w = workspace({ ...baseAgent, status: 'active' } as Agent)
    const edit = w.get('[data-testid="agent-modal-edit"]')
    expect(edit.attributes('aria-label')).toBe('Edit name and icon')
    await edit.trigger('click')
    expect(useAgentProfileEditor().editing.value?.pid).toBe(1234)
    useAgentProfileEditor().cancelEdit()
  })

  // 3N.2.2 D: a legacy or observed session is offered Resume under Dashboard only
  // when the server says so, and an owned agent never asks.
  it('offers Resume under Dashboard only when the server says the session can be resumed', async () => {
    const { flushPromises } = await import('@vue/test-utils')
    const { useAgentLifecycle } = await import('@/composables/useAgentLifecycle')
    let available = true
    const fetchSpy = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => url.endsWith('/control') ? { owned: false, resume: { available, endsRunningSession: true, reason: available ? undefined : 'External session' } } : {},
    }))
    vi.stubGlobal('fetch', fetchSpy)

    const hosted = workspace({ ...baseAgent, status: 'active', liveInjectable: true, displayName: 'Timer' } as Agent)
    await flushPromises()
    expect(fetchSpy.mock.calls.filter(([u]) => String(u).endsWith('/control'))).toHaveLength(1)
    await hosted.get('[data-testid="agent-modal-resume"]').trigger('click')
    expect(useAgentLifecycle().pending.value).toMatchObject({ action: 'resume', endsRunningSession: true, agent: { pid: 1234 } })
    useAgentLifecycle().cancel()
    hosted.unmount()

    available = false
    const refused = workspace({ ...baseAgent, status: 'active' } as Agent)
    await flushPromises()
    expect(refused.find('[data-testid="agent-modal-resume"]').exists()).toBe(false)
    expect(refused.get('[data-testid="agent-modal-observe-only"]').text()).toContain('External session')
    refused.unmount()

    fetchSpy.mockClear()
    const owned = workspace({ ...baseAgent, status: 'active', dashboardOwned: true } as Agent)
    await flushPromises()
    expect(fetchSpy.mock.calls.filter(([u]) => String(u).endsWith('/control'))).toHaveLength(0)
    expect(owned.find('[data-testid="agent-modal-resume"]').exists()).toBe(false)
    vi.unstubAllGlobals()
  })

  // 3N.2.3: the lifecycle strip says what the dashboard can do, and the composer what sending does.
  it('explains a finished unmanaged session and what resuming does', async () => {
    const { flushPromises } = await import('@vue/test-utils')
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true,
      json: async () => String(url).endsWith('/control') ? { owned: false, resume: { available: true, endsRunningSession: false } } : {},
    })))
    const w = workspace({ ...baseAgent, status: 'finished', displayName: 'LocalScope Agent' } as Agent)
    await flushPromises()
    const strip = w.get('[data-testid="agent-modal-lifecycle"]')
    expect(strip.attributes('data-kind')).toBe('ended-unmanaged')
    expect(w.get('[data-testid="agent-modal-lifecycle-badge"]').text()).toBe('Not managed')
    expect(w.get('[data-testid="agent-modal-observe-only"]').text()).toContain('has ended')
    expect(w.get('[data-testid="agent-modal-resume-help"]').text()).toBe('Resume this Claude conversation as a new Dashboard-managed process.')
    expect(strip.find('[data-testid="agent-modal-resume"]').exists()).toBe(true)
    expect(w.find('[data-testid="agent-modal-stop"]').exists()).toBe(false)
    const note = w.find('[data-testid="agent-resume-note"]')
    if (note.exists()) {
      expect(note.text()).toContain('This session has ended')
      expect(note.text()).not.toContain('running one')
    }
    vi.unstubAllGlobals()
  })

  it('shows no lifecycle strip for an owned running agent, which has Stop and Delete', () => {
    const w = workspace({ ...baseAgent, status: 'active', dashboardOwned: true } as Agent)
    expect(w.find('[data-testid="agent-modal-lifecycle"]').exists()).toBe(false)
    expect(w.find('[data-testid="agent-modal-stop"]').exists()).toBe(true)
    expect(w.find('[data-testid="agent-modal-delete"]').exists()).toBe(true)
  })

  it('says a pipeline agent is stopped through its task', () => {
    const w = workspace({ ...baseAgent, status: 'active', dashboardOwned: true, pipelineTaskId: 't-1' } as Agent)
    expect(w.find('[data-testid="agent-modal-stop"]').exists()).toBe(false)
    expect(w.get('[data-testid="agent-modal-observe-only"]').text()).toContain('pipeline task')
  })

  it('gives the conversation its own labelled region', () => {
    const w = workspace()
    expect(w.find('section[aria-label="Conversation"]').exists()).toBe(true)
  })

  // Stop exists now (3N.2) — through the shared confirmation; Pause still does not.
  it('exposes no pause action, and Stop only through the confirmation', async () => {
    const w = workspace()
    expect(w.text().toLowerCase()).not.toContain('pause')
    const stop = w.find('[data-testid="agent-modal-stop"]')
    if (stop.exists()) {
      const { useAgentLifecycle } = await import('@/composables/useAgentLifecycle')
      await stop.trigger('click')
      expect(useAgentLifecycle().pending.value?.action).toBe('stop')
      useAgentLifecycle().cancel()
    }
  })

  // A "Phase 3/7" for a plain agent would be invented; only pipeline-linked
  // agents have a real stage. TodoWrite items are shown as tasks instead.
  it('omits task counts entirely when the session wrote no TodoWrite items', () => {
    const w = workspace()
    expect(w.find('[data-testid="header-tasks"]').exists()).toBe(false)
    expect(w.text().toLowerCase()).not.toContain('phase')
  })

  it('shows task progress as a completed ratio, never as a phase', () => {
    const w = workspace({
      ...baseAgent,
      tasks: [
        { id: '1', subject: 'a', status: 'completed' },
        { id: '2', subject: 'b', status: 'completed' },
        { id: '3', subject: 'c', status: 'in_progress' },
      ],
    } as Agent)
    const tasks = w.get('[data-testid="header-tasks"]')
    expect(tasks.text()).toContain('2 / 3')
    expect(tasks.text().toLowerCase()).not.toContain('phase')
  })

  it('warns that a session started outside the dashboard resumes rather than injects', () => {
    const w = workspace({ ...baseAgent, liveInjectable: false } as Agent)
    expect(w.find('[data-testid="agent-resume-note"]').exists()).toBe(true)
  })

  it('says a remote session cannot be messaged, and offers no prompt box', () => {
    const w = workspace({ ...baseAgent, machine: 'build-box' } as Agent)
    expect(w.get('[data-testid="agent-unreachable-note"]').text()).toContain('build-box')
    expect(w.findComponent({ name: 'PromptInput' }).exists()).toBe(false)
  })

  it('shows a Started time derived from uptime, not an invented estimate', () => {
    const w = workspace()
    expect(w.text()).toContain('Started')
    expect(w.text().toLowerCase()).not.toContain('est.')
    expect(w.text().toLowerCase()).not.toContain('remaining')
  })
})

describe('agentModal — right-side detail panel (3H)', () => {
  // The real AppModal this time: focus handling is its job and the point of the check.
  const { AppModal: _stubbedModal, ...childStubs } = stubs
  // PromptInput exposes focus(); the panel calls it once open, so the stub must too.
  const panelStubs = { ...childStubs, AgentIntelligencePanel: true, PromptInput: { template: '<div />', methods: { focus() {} } } }

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('opens centred through AppModal\'s centre placement', async () => {
    const w = mount(AgentModal, { props: { agent: baseAgent }, global: { stubs: panelStubs }, attachTo: document.body })
    await nextTick()
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.className).toContain('justify-center')
    expect(dialog.className).not.toContain('justify-end')
    expect(dialog.getAttribute('aria-labelledby')).toBe(`agent-modal-title-${baseAgent.pid}`)
    w.unmount()
  })

  it('moves focus into the panel, closes on Escape, and returns focus to what opened it', async () => {
    const trigger = document.createElement('button')
    trigger.textContent = 'open'
    document.body.appendChild(trigger)
    trigger.focus()

    const w = mount(AgentModal, { props: { agent: null }, global: { stubs: panelStubs }, attachTo: document.body })
    await w.setProps({ agent: baseAgent })
    await nextTick()
    await nextTick()
    const panel = document.querySelector('.base-modal-box')!
    expect(panel.contains(document.activeElement)).toBe(true)

    document.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(w.emitted('close')).toHaveLength(1)

    await w.setProps({ agent: null })
    await nextTick()
    expect(document.activeElement).toBe(trigger)
    w.unmount()
  })
})

describe('agentModal — name and diagnostics (3I)', () => {
  it('titles the panel with the canonical agent name, the same one the card shows', async () => {
    const { agentTitle } = await import('@/utils/agentLabels')
    const { default: AgentCard } = await import('./AgentCard.vue')
    const modal = mountModal()
    const card = mount(AgentCard, { props: { agent: baseAgent }, global: { stubs: { MachineBadge: true, ProviderBadge: true, PromptInput: true } } })
    const title = modal.get('[data-testid="agent-modal-title"]').text()
    expect(title).toBe(agentTitle(baseAgent))
    expect(title).toBe(card.get('[data-testid="agent-card-title"]').text())
  })

  it('does not use the folder name as the title', () => {
    const title = mountModal({ ...baseAgent, projectName: 'my-project' }).get('[data-testid="agent-modal-title"]').text()
    expect(title).not.toContain('my-project')
  })

  // D: an explicit details surface may show where the session runs.
  it('still shows the working folder and its path as a diagnostic', () => {
    const folder = mountModal().get('[data-testid="intelligence-working-folder"]')
    expect(folder.text()).toContain('Working folder')
    expect(folder.text()).toContain('/home/user/my-project')
    expect(folder.text()).not.toContain('Project')
  })

  it('closes only the metrics popover on Escape, not the panel around it', async () => {
    const w = mountModal()
    const wrap = w.get('[data-testid="agent-modal-metrics-wrap"]')
    await wrap.trigger('focusin')
    expect(w.find('[data-testid="metrics-popover"]').exists()).toBe(true)
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    const bubbled = vi.fn()
    w.element.addEventListener('keydown', bubbled)
    wrap.element.dispatchEvent(event)
    await nextTick()
    expect(w.find('[data-testid="metrics-popover"]').exists()).toBe(false)
    expect(bubbled).not.toHaveBeenCalled()
  })
})
