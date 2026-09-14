import { describe, expect, it } from 'vitest'
import { isValidPort, localServiceUrl } from './localServiceUrl'

// 3N.2.2 P25–P30: a Runtime port opens localhost, built only from a validated port.
describe('localServiceUrl', () => {
  const vite = { port: 5173, protocol: 'tcp', bindScope: 'loopback', address: '127.0.0.1', url: 'http://localhost:5173' }

  it('26: 5173 opens http://localhost:5173', () => {
    expect(localServiceUrl(vite)).toBe('http://localhost:5173')
  })

  it('27/28: a service bound to every interface, or to ::, still opens localhost — never the bind address', () => {
    for (const address of ['0.0.0.0', '*', '::', '[::]']) {
      const url = localServiceUrl({ port: 3000, protocol: 'tcp', bindScope: 'all', address })
      expect(url).toBe('http://localhost:3000')
    }
    expect(localServiceUrl({ port: 5183, protocol: 'tcp', bindScope: 'loopback', address: '::1' })).toBe('http://localhost:5183')
    expect(localServiceUrl({ port: 8080, protocol: 'tcp', address: '0.0.0.0' })).toBe('http://localhost:8080')
  })

  it('29: an invalid port gets no link', () => {
    for (const port of [0, -1, 65536, 80.5, Number.NaN, '5173', null, undefined, 1e10])
      expect(localServiceUrl({ ...vite, port })).toBeNull()
    expect(isValidPort(1)).toBe(true)
    expect(isValidPort(65535)).toBe(true)
  })

  it('30: no hostname, path or scheme from the service reaches the URL', () => {
    const hostile = [
      'http://evil.example:5173/steal',
      'javascript:alert(1)',
      'https://evil.example',
      'http://localhost:5173@evil.example/',
      'https://127.0.0.1.evil.example/',
    ]
    for (const url of hostile)
      expect(localServiceUrl({ ...vite, url })).toBe('http://localhost:5173')
    expect(localServiceUrl({ ...vite, address: 'evil.example' })).toBe('http://localhost:5173')
  })

  it('uses https only when LocalScope classified the loopback service as https', () => {
    expect(localServiceUrl({ ...vite, url: 'https://localhost:5173' })).toBe('https://localhost:5173')
    expect(localServiceUrl({ ...vite, url: 'https://127.0.0.1:5173/' })).toBe('https://localhost:5173')
  })

  it('gives no link to UDP, or to a listener bound only to a specific non-loopback address', () => {
    expect(localServiceUrl({ ...vite, protocol: 'udp' })).toBeNull()
    expect(localServiceUrl({ port: 5432, protocol: 'tcp', bindScope: 'specific', address: '192.168.1.20' })).toBeNull()
    expect(localServiceUrl({ port: 5432, protocol: 'tcp', address: '192.168.1.20' })).toBeNull()
  })
})
