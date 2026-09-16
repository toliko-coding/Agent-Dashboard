import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import DashboardView from './DashboardView.vue'

// The roster reads the module-level singletons in useAgents/useViewState, so a
// test drives it by stubbing those modules rather than by passing props. Only
// the two genuinely per-caller values (permissionItems, focusedSessionId) are
// props — see usePendingPermissions, which is not a singleton.
vi.mock('@/features/agents', async () => {
  const { ref, shallowRef, computed } = await import('vue')
  const agents = shallowRef<any[]>([])
  return {
    useAgents: () => ({
      agents,
      filteredAgents: computed(() => agents.value),
      pendingCapabilityDecisions: ref([]),
      searchQuery: ref(''),
      selectAgent: vi.fn(),
      dismissAgent: vi.fn(),
    }),
    AgentCardGrid: { name: 'AgentCardGrid', template: '<div data-testid="agent-card-grid" />' },
    AgentStatusFilterBar: { name: 'AgentStatusFilterBar', template: '<div data-testid="agent-status-filters" />' },
    AgentTable: { name: 'AgentTable', template: '<div data-testid="agent-table" />' },
    AgentTriageBand: { name: 'AgentTriageBand', template: '<div data-testid="triage-band" />' },
    EmptyAgentState: { name: 'EmptyAgentState', template: '<div data-testid="empty-state" />' },
    MainAgentPanel: { name: 'MainAgentPanel', template: '<div data-testid="main-agent-panel" />' },
    PersistentAgents: { name: 'PersistentAgents', template: '<div data-testid="persistent-agents" />' },
    // The real rule, not a stub: the roster filters the main agent's running
    // session out so it is not listed twice, and a stub returning nothing would
    // hide a mistake in that filter.
    isMainAgent: (agent: { role?: string } | null | undefined) => agent?.role === 'main',
  }
})

describe('dashboardView', () => {
  it('renders the toolbar, the triage band and the empty state when no agent is live', () => {
    const wrapper = mount(DashboardView, {
      attachTo: document.body,
      props: { attention: { status: 'ready', stale: false, items: [] }, permissionItems: [], focusedSessionId: null },
      global: {
        stubs: {
          AutoApprovingStrip: { template: '<div data-testid="auto-approving-strip" />' },
          DashboardToolbar: { template: '<div data-testid="dashboard-toolbar" />' },
          ChannelScriptCallout: { template: '<div data-testid="channel-script-callout" />' },
        },
      },
    })

    expect(wrapper.find('[data-testid="triage-band"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="dashboard-toolbar"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="empty-state"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="agent-card-grid"]').exists()).toBe(false)
  })

  /*
   * Agents with no session running are kept, not active.
   *
   * Nothing in that section is waiting on the user, so it belongs below every
   * group that describes something happening now - it should not be the first
   * thing seen on opening Agents.
   */
  it('puts the kept agents below the main agent and below the roster', () => {
    const wrapper = mount(DashboardView, {
      attachTo: document.body,
      props: { attention: { status: 'ready', stale: false, items: [] }, permissionItems: [], focusedSessionId: null },
      global: {
        stubs: {
          AutoApprovingStrip: { template: '<div data-testid="auto-approving-strip" />' },
          DashboardToolbar: { template: '<div data-testid="dashboard-toolbar" />' },
          ChannelScriptCallout: { template: '<div data-testid="channel-script-callout" />' },
        },
      },
    })

    const kept = wrapper.find('[data-testid="persistent-agents"]').element
    const main = wrapper.find('[data-testid="main-agent-panel"]').element
    const roster = wrapper.find('[data-testid="empty-state"]').element

    // DOCUMENT_POSITION_FOLLOWING (4) means the kept section comes after.
    expect(main.compareDocumentPosition(kept) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(roster.compareDocumentPosition(kept) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
