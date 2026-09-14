import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { localServiceUrl } from '@/utils/localServiceUrl'
import { axe } from '@/utils/testA11y'
import LocalServicePort from '../LocalServicePort.vue'

// 3N.2.3: the one port pill every Runtime surface draws, on the canonical URL helper.
describe('localServicePort', () => {
  const vite = { port: 5173, protocol: 'tcp', bindScope: 'loopback', address: '127.0.0.1', url: 'http://localhost:5173' }

  it('links a loopback TCP service to localhost in a new tab, with its own name', () => {
    const w = mount(LocalServicePort, { props: { service: vite } })
    const a = w.get('a')
    expect(a.attributes('href')).toBe('http://localhost:5173')
    expect(a.attributes('href')).toBe(localServiceUrl(vite))
    expect(a.attributes('target')).toBe('_blank')
    expect(a.attributes('rel')).toBe('noopener noreferrer')
    expect(a.attributes('aria-label')).toBe('Open localhost port 5173')
    expect(a.attributes('title')).toBe('Open localhost:5173')
    expect(a.text()).toBe(':5173')
  })

  it('opens localhost for 0.0.0.0 and :: binds, never the bind address', () => {
    for (const address of ['0.0.0.0', '::']) {
      const href = mount(LocalServicePort, { props: { service: { port: 3000, protocol: 'tcp', bindScope: 'all', address } } }).get('a').attributes('href')
      expect(href).toBe('http://localhost:3000')
    }
  })

  it('keeps UDP, invalid and non-local ports as plain text', () => {
    for (const service of [
      { ...vite, protocol: 'udp' },
      { ...vite, port: 70000 },
      { port: 5432, protocol: 'tcp', bindScope: 'specific', address: '192.168.1.20' },
    ]) {
      const w = mount(LocalServicePort, { props: { service } })
      expect(w.find('a').exists()).toBe(false)
      expect(w.get('span').text()).toBe(`:${service.port}`)
    }
  })

  it('is a native, focusable link and passes axe', async () => {
    const w = mount(LocalServicePort, { props: { service: vite, size: 'sm', testid: 'topology-port' }, attachTo: document.body })
    const a = w.get('[data-testid="topology-port"]').element as HTMLAnchorElement
    a.focus()
    expect(document.activeElement).toBe(a)
    expect(await axe(w.element.parentElement as Element)).toHaveNoViolations()
    w.unmount()
  })
})
