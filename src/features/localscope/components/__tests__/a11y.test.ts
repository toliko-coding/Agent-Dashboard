import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { axe } from '@/utils/testA11y'
import ServiceCard from '../ServiceCard.vue'

vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn() } })

const service = {
  id: 'p1:5173',
  port: 5173,
  address: '127.0.0.1',
  bindScope: 'loopback',
  protocol: 'tcp',
  ipVersion: 'ipv4',
  pid: 29717,
  processName: 'node',
  command: 'node vite.js',
  cwd: '/gh/Agent-Dashboard',
  runtime: 'node',
  kind: 'vite',
  label: 'Vite Development Server',
  url: 'http://localhost:5173',
  project: {
    id: 'p',
    name: 'Agent-Dashboard',
    packageName: null,
    rootPath: '/gh/Agent-Dashboard',
    displayPath: '~/gh/Agent-Dashboard',
    manifest: 'package.json',
    git: { isRepo: true, branch: 'main' },
    frameworks: ['vite'],
  },
  confidence: 'high',
  startedAt: null,
} as any

describe('localScope accessibility', () => {
  it('service card has no axe violations', async () => {
    const w = mount(ServiceCard, { props: { service }, attachTo: document.body })
    expect(await axe(w.element as Element)).toHaveNoViolations()
    w.unmount()
  })

  // A low-confidence classification must be marked, not presented as observed.
  it('marks an inferred classification as a guess', () => {
    const w = mount(ServiceCard, { props: { service: { ...service, confidence: 'low' } } })
    expect(w.text()).toContain('guess')
  })

  // Bound to all interfaces means reachable from the local network — that is a
  // security-relevant fact and must not read the same as loopback.
  it('warns when a service is bound to all interfaces', () => {
    const w = mount(ServiceCard, { props: { service: { ...service, bindScope: 'all' } } })
    const scope = w.findAll('dd').find(d => d.text() === 'all')
    expect(scope?.classes()).toContain('text-warning-text')
  })
})
