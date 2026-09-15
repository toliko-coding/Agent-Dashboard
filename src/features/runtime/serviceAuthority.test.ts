import type { MachineService } from '@/features/localscope'
import type { RuntimeSelf } from '@/sdk.generated'
import { describe, expect, it } from 'vitest'
import { classifyService, viewingPortOf } from './serviceAuthority'

const self: RuntimeSelf = { pid: 34752, host: '127.0.0.1', port: 13120, cwd: '/repo/agent-dashboard' }

function service(over: Partial<MachineService> = {}): MachineService {
  return {
    id: '1:3001',
    pid: 1,
    port: 3001,
    address: '127.0.0.1',
    protocol: 'tcp',
    bindScope: 'loopback',
    ipVersion: 'ipv4',
    processName: 'node',
    command: 'node server.js',
    cwd: null,
    runtime: 'node',
    kind: 'unknown',
    label: '',
    url: null,
    discoveredProject: null,
    confidence: 'high',
    startedAt: null,
    workspace: null,
    ...over,
  }
}

const noContext = { self: null, ownedWorkspaceIds: new Set<string>(), viewingPort: null }

describe('service authority', () => {
  it('recognises the dashboard server by pid, not by port', () => {
    const c = classifyService(service({ pid: 34752, port: 55555 }), { ...noContext, self })
    expect(c.authority).toBe('dashboard-server')
    expect(c.isProtected).toBe(true)
    expect(c.evidence).toBe('verified')
  })

  // A port number is not an identity: anything can listen on 13120.
  it('does not call another process the dashboard just because it uses the dashboard port', () => {
    const c = classifyService(service({ pid: 999, port: 13120 }), { ...noContext, self })
    expect(c.authority).toBe('external')
    expect(c.isProtected).toBe(false)
  })

  it('protects the server delivering the page being viewed', () => {
    const c = classifyService(service({ pid: 84451, port: 5173 }), { ...noContext, self, viewingPort: 5173 })
    expect(c.authority).toBe('dashboard-ui')
    expect(c.isProtected).toBe(true)
    expect(c.evidence).toBe('verified')
  })

  it('treats a service in the server own working directory as the dashboard, but marks it inferred', () => {
    const c = classifyService(service({ pid: 84451, cwd: '/repo/agent-dashboard' }), { ...noContext, self })
    expect(c.authority).toBe('dashboard-ui')
    expect(c.isProtected).toBe(true)
    expect(c.evidence).toBe('attributed')
  })

  it('attributes a service to an owned agent workspace without claiming ownership', () => {
    const c = classifyService(
      service({ workspace: { id: 'ws-1', name: 'portfolio', kind: 'git-main', repository: null } }),
      { ...noContext, self, ownedWorkspaceIds: new Set(['ws-1']) },
    )
    expect(c.authority).toBe('agent-workspace')
    expect(c.evidence).toBe('attributed')
    expect(c.isProtected).toBe(false)
    expect(c.reason).toContain('does not prove')
  })

  it('leaves an unattributed service external', () => {
    const c = classifyService(service(), { ...noContext, self })
    expect(c.authority).toBe('external')
    expect(c.evidence).toBe('none')
    expect(c.badge).toBe('')
  })

  // Nothing is controllable until a service has an ownership record the server
  // can re-verify. This asserts the whole slice, tier by tier.
  it('never reports any tier as controllable', () => {
    const rows = [
      classifyService(service({ pid: 34752 }), { ...noContext, self }),
      classifyService(service({ port: 5173 }), { ...noContext, self, viewingPort: 5173 }),
      classifyService(service({ cwd: '/repo/agent-dashboard' }), { ...noContext, self }),
      classifyService(service(), { ...noContext, self }),
    ]
    expect(rows.every(r => r.controllable === false)).toBe(true)
  })

  it('falls back to observation when the server identity has not been read', () => {
    const c = classifyService(service({ pid: 34752 }), noContext)
    expect(c.authority).toBe('external')
  })

  it('reads the page port, and reports none for a default-port origin', () => {
    expect(viewingPortOf({ port: '5173' })).toBe(5173)
    expect(viewingPortOf({ port: '' })).toBeNull()
  })
})
