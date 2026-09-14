import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useServerConfig } from '../../composables/useServerConfig'

import ChannelScriptCallout from './ChannelScriptCallout.vue'

vi.mock('../../composables/useServerConfig', () => ({
  useServerConfig: vi.fn(),
}))

function mountWithScriptPath(path: string, props: { showFullPath?: boolean } = {}) {
  vi.mocked(useServerConfig).mockReturnValue({
    scriptPath: ref(path),
    mcpServerName: ref(''),
    mcpEndpoint: ref(''),
    homedir: ref(''),
    loaded: ref(true),
    loadServerConfig: vi.fn().mockResolvedValue(undefined),
  })
  return mount(ChannelScriptCallout, { props })
}

describe('channelScriptCallout', () => {
  // C: a default surface names the command; the path on this machine is not shown.
  it('shows the command by name, without the absolute path', async () => {
    const w = mountWithScriptPath('/Users/someone/Documents/GitHub/Agent-Dashboard/.air-tmp/agent-dashboard live')
    await flushPromises()
    const btn = w.get('[data-testid="channel-script-path"]')
    expect(btn.text()).toBe('agent-dashboard live')
    expect(w.html()).not.toContain('/Users/someone')
    expect(btn.attributes('aria-label')).toBe('Copy channel command agent-dashboard live')
  })

  it('names a bare script by its file name', async () => {
    const w = mountWithScriptPath('/home/u/.claude/channel.mjs')
    await flushPromises()
    expect(w.get('[data-testid="channel-script-path"]').text()).toBe('channel.mjs')
    expect(w.text()).not.toContain('/home/u')
  })

  it('renders nothing when scriptPath is absent', async () => {
    const w = mountWithScriptPath('')
    await flushPromises()
    expect(w.text()).not.toContain('Channel command')
  })

  it('still copies the full command, which the action needs', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const w = mountWithScriptPath('/p/agent-dashboard live')
    await flushPromises()
    await w.get('button[data-testid="channel-script-path"]').trigger('click')
    expect(writeText).toHaveBeenCalledWith('/p/agent-dashboard live')
  })

  it('shows the full path on an explicit setup surface that asks for it', async () => {
    const w = mountWithScriptPath('/q/channel.mjs', { showFullPath: true })
    await flushPromises()
    expect(w.get('[data-testid="channel-script-path"]').text()).toBe('/q/channel.mjs')
  })

  it('is only shown full-path in onboarding, not on the Agents view', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const read = (f: string) => readFileSync(resolve(process.cwd(), f), 'utf8')
    expect(read('src/components/onboarding/OnboardingFlow.vue')).toContain('<ChannelScriptCallout show-full-path />')
    expect(read('src/features/cockpit/components/DashboardView.vue')).toMatch(/<ChannelScriptCallout\s*\/>/)
  })
})
