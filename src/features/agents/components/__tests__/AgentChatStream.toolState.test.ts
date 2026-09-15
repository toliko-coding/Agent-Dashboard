import type { Agent, OutputMessage } from '@/types'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AgentChatStream from '../AgentChatStream.vue'

// Phase 4.1.1: a tool call without a result says whether it is waiting for
// permission, still running, or finished without output — never an empty row.

vi.mock('@/composables/useToast', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }))

function stubOutput(messages: OutputMessage[]) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true,
    json: async () => (url.includes('/replies') ? { replies: [] } : { messages }),
  })))
}

const bashCall: OutputMessage = { role: 'tool_call', content: 'Bash', toolName: 'Bash', detail: 'Fingerprint the sample', timestamp: '2026-09-16T10:00:00Z' }
const result: OutputMessage = { role: 'tool_result', content: 'abc123  notes/sample.txt', timestamp: '2026-09-16T10:00:05Z' }

function agent(o: Partial<Agent>): Agent {
  return { pid: 1, sessionId: 's1', status: 'idle', working: false, ...o } as Agent
}

async function mountStream(messages: OutputMessage[], a: Agent) {
  stubOutput(messages)
  const w = mount(AgentChatStream, { props: { agent: a, refreshIntervalMs: 60_000 } })
  await flushPromises()
  await w.get('details summary').trigger('click')
  return w
}

describe('agentChatStream tool call state', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('says a call is waiting for permission in the terminal, with its target', async () => {
    const w = await mountStream([bashCall], agent({ pendingToolUse: { id: 'tu_1', tool: 'Bash', pattern: 'shasum' } as Agent['pendingToolUse'], awaitingTerminalPermission: true }))
    expect(w.find('[data-testid="tool-call-state-permission"]').exists()).toBe(true)
    expect(w.text()).toContain('Fingerprint the sample')
    expect(w.text()).not.toContain('no target')
    expect(w.text()).toContain('Answer the prompt in the agent\'s terminal')
  })

  it('says an open call has no result yet when no prompt is on screen', async () => {
    const w = await mountStream([bashCall], agent({ pendingToolUse: { id: 'tu_1', tool: 'Bash', pattern: 'sleep' } as Agent['pendingToolUse'] }))
    expect(w.find('[data-testid="tool-call-state-running"]').exists()).toBe(true)
  })

  it('reports a finished call without output as such, and a call with output as such', async () => {
    const none = await mountStream([bashCall], agent({}))
    expect(none.find('[data-testid="tool-call-state-none"]').exists()).toBe(true)
    expect(none.text()).toContain('Finished without output.')
    const withOutput = await mountStream([bashCall, result], agent({}))
    expect(withOutput.find('[data-testid="tool-call-state-output"]').exists()).toBe(true)
  })
})
