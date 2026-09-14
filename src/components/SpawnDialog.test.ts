import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openListboxDom as openListbox, selectByLabel, selectOptionsById } from '@/utils/testSelect'
import SpawnDialog from './SpawnDialog.vue'

// jsdom quirks worked around in this file:
//   1. AppModal teleports to <body>, so tests use document.querySelector
//      rather than wrapper.find for elements inside the modal.
//   2. AppInput uses useId() for the real <input>/<textarea> id; the
//      `id` attribute passed in falls through to the wrapper <div>.
//      Tests target [data-testid="…-wrap"] input/textarea to reach the
//      real form element.
//   3. EventSource is stubbed because useProjects()/useSpawners() open
//      SSE on mount and jsdom has no built-in EventSource.
//   4. The project/folder/spawner/permission-mode fields are AppSelect, a
//      custom listbox, not a native <select> — its panel teleports to
//      <body> while open, so selections go through the trigger button +
//      the teleported [role="option"] elements via the shared
//      openListboxDom()/optionByLabel()/selectByLabel() helpers (see
//      testSelect.ts) rather than select.setValue(). Raw option `value`s
//      (not just visible labels) are inspected via selectOptionsById()
//      where a test doesn't drive a selection.

const sampleProject = {
  id: 'prj_a',
  slug: 'alpha',
  name: 'Alpha',
  defaultSpawnerId: 'spwn_a',
  folders: [{ id: 'fld_a', projectId: 'prj_a', path: '/home/u/alpha', isDefault: true, createdAt: '' }],
  createdAt: '',
  updatedAt: '',
}

const sampleSpawner = {
  id: 'spwn_a',
  name: 'Claude (Opus)',
  slug: 'claude-opus',
  command: 'claude',
  args: [],
  env: {},
  adapterType: 'claude' as const,
  adapterConfig: {},
  modelOverride: 'claude-opus-4-6',
  builtIn: false,
  createdAt: '',
  updatedAt: '',
}

/*
 * 3M: the dialog checks the working folder against the server before Start.
 * Every folder is allowed unless a test says otherwise; its identity comes from
 * the folder, never from a Project.
 */
let preflight: (path: string) => Record<string, unknown>
const PLAIN_WS = { id: 'ws_plain', name: 'plain', kind: 'plain', branch: '', repository: null }

function folderRoutes(url: string, init?: RequestInit): Promise<unknown> {
  if (url === '/api/agents/spawn/preflight') {
    const { path } = JSON.parse(String(init?.body ?? '{}')) as { path: string }
    return Promise.resolve({ ok: true, json: async () => preflight(path) })
  }
  if (url === '/api/agents/working-folders' && (init?.method ?? 'GET') === 'GET')
    return Promise.resolve({ ok: true, json: async () => ({ folders: [] }) })
  return Promise.resolve({ ok: true, json: async () => [] })
}

/** Lets the folder check's debounce run and its response land. */
async function waitForFolderCheck() {
  await flushPromises()
  await new Promise(resolve => setTimeout(resolve, 350))
  await flushPromises()
}

function setInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

beforeEach(() => {
  preflight = path => ({ path, allowed: true, canAllow: false, workspace: PLAIN_WS })
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/projects')
      return Promise.resolve({ ok: true, json: async () => [sampleProject] })
    if (url === '/api/spawners')
      return Promise.resolve({ ok: true, json: async () => [sampleSpawner] })
    if (url === '/api/agents/spawn') {
      return Promise.resolve({
        ok: true,
        json: async () => ({ ok: true, pid: 12345 }),
      })
    }
    if (url.startsWith('/api/agents/spawn/12345/status'))
      return Promise.resolve({ ok: true, json: async () => ({ pid: 12345, status: 'running' }) })
    return folderRoutes(url, init)
  }))
  vi.stubGlobal('EventSource', class {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSED = 2
    onmessage: ((e: MessageEvent) => void) | null = null
    onerror: ((e: Event) => void) | null = null
    readyState = 0
    close() {}
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  // AppSelect teleports its open panel to <body>; a test that throws before
  // wrapper.unmount() (or leaves a panel open) would otherwise leak stale
  // nodes that corrupt every document.querySelector() in later tests.
  document.body.innerHTML = ''
})

describe('spawnDialog', () => {
  // 3M: Project is optional; None is a real choice.
  it('offers Project = None first, and no longer requires a project', async () => {
    const wrapper = mount(SpawnDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()
    const options = selectOptionsById(wrapper, 'spawn-project')
    expect(options[0]).toMatchObject({ value: '', label: 'None' })
    wrapper.unmount()
  })

  // A + B
  it('starts an agent with Project = None in a typed folder, sending no projectId and creating no project', async () => {
    const wrapper = mount(SpawnDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    setInputValue(document.querySelector('[data-testid="spawn-folder-input-wrap"]') as HTMLInputElement, '/Users/me/scratch/plain')
    setInputValue(document.querySelector('[data-testid="spawn-prompt-wrap"]') as HTMLTextAreaElement, 'look around')
    await waitForFolderCheck()

    const spawnBtn = document.querySelector('[data-testid="spawn-btn"]') as HTMLButtonElement
    expect(spawnBtn.textContent).toContain('Start Agent')
    expect(spawnBtn.disabled).toBe(false)
    spawnBtn.click()
    await flushPromises()

    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls
    const body = JSON.parse(calls.find(c => c[0] === '/api/agents/spawn')![1].body as string)
    expect(body.cwd).toBe('/Users/me/scratch/plain')
    expect(body).not.toHaveProperty('projectId')
    expect(calls.some(c => c[0] === '/api/projects' && c[1]?.method === 'POST')).toBe(false)
    wrapper.unmount()
  })

  // D: a plain folder states that it has no repository.
  it('describes a plain folder as having no repository, from the folder itself', async () => {
    const wrapper = mount(SpawnDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()
    setInputValue(document.querySelector('[data-testid="spawn-folder-input-wrap"]') as HTMLInputElement, '/Users/me/scratch/plain')
    await waitForFolderCheck()
    expect(document.querySelector('[data-testid="spawn-folder-identity"]')?.textContent).toContain('plain · not a Git repository · no repository')
    wrapper.unmount()
  })

  // E: a local repository without GitHub is a repository.
  it('describes a local Git repository by repository, branch and kind — no remote needed', async () => {
    preflight = path => ({ path, allowed: true, canAllow: false, workspace: { id: 'ws_r', name: 'local-repo', kind: 'git-main', branch: 'main', repository: { id: 'repo_r', name: 'local-repo' } } })
    const wrapper = mount(SpawnDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()
    setInputValue(document.querySelector('[data-testid="spawn-folder-input-wrap"]') as HTMLInputElement, '/Users/me/code/local-repo')
    await waitForFolderCheck()
    expect(document.querySelector('[data-testid="spawn-folder-identity"]')?.textContent).toContain('Repository local-repo · main · main checkout')
    wrapper.unmount()
  })

  it('keeps Start disabled for a folder outside the allowed folders until the user explicitly allows it', async () => {
    let allowed = false
    preflight = path => allowed
      ? { path, allowed: true, canAllow: false, workspace: PLAIN_WS }
      : { path, allowed: false, reason: 'outside-allowed-folders', canAllow: true, workspace: PLAIN_WS }
    const base = globalThis.fetch as unknown as (url: string, init?: RequestInit) => Promise<unknown>
    const allowCalls: string[] = []
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/agents/working-folders' && init?.method === 'POST') {
        allowCalls.push(String(init.body))
        allowed = true
        return Promise.resolve({ ok: true, json: async () => ({ folders: ['/Users/me/scratch/plain'], check: preflight('/Users/me/scratch/plain') }) })
      }
      return base(url, init)
    }))

    const wrapper = mount(SpawnDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()
    setInputValue(document.querySelector('[data-testid="spawn-folder-input-wrap"]') as HTMLInputElement, '/Users/me/scratch/plain')
    setInputValue(document.querySelector('[data-testid="spawn-prompt-wrap"]') as HTMLTextAreaElement, 'look around')
    await waitForFolderCheck()

    const spawnBtn = document.querySelector('[data-testid="spawn-btn"]') as HTMLButtonElement
    expect(spawnBtn.disabled).toBe(true)
    expect(document.querySelector('[data-testid="spawn-folder-not-allowed"]')).not.toBeNull()
    expect(allowCalls).toEqual([])

    ;(document.querySelector('[data-testid="spawn-allow-folder"]') as HTMLButtonElement).click()
    await flushPromises()
    expect(allowCalls).toEqual([JSON.stringify({ path: '/Users/me/scratch/plain' })])
    expect(spawnBtn.disabled).toBe(false)
    wrapper.unmount()
  })

  // N: Claude's trust question appears at the top of the dialog, above the form, and nothing answers it.
  it('shows Claude\'s folder trust question first, and sends no answer by itself', async () => {
    const wrapper = mount(SpawnDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()
    setInputValue(document.querySelector('[data-testid="spawn-folder-input-wrap"]') as HTMLInputElement, '/Users/me/scratch/plain')
    setInputValue(document.querySelector('[data-testid="spawn-prompt-wrap"]') as HTMLTextAreaElement, 'look around')
    await waitForFolderCheck()
    ;(document.querySelector('[data-testid="spawn-btn"]') as HTMLButtonElement).click()
    await flushPromises()
    // 3M.1: the question arrives from the server in the agents stream, not from this dialog's own poll.
    const { useAgents } = await import('@/features/agents')
    useAgents({ autoStart: false }).pendingFolderTrust.value = [{ pid: 12345, path: '/Users/me/scratch/plain', since: '2026-09-14T10:00:00Z' }]
    await flushPromises()

    const decision = document.querySelector('[data-testid="folder-trust-decision"]')
    const folderSection = document.querySelector('[data-testid="spawn-folder-section"]')
    expect(decision?.querySelector('[data-testid="folder-trust-path"]')?.textContent).toBe('/Users/me/scratch/plain')
    expect(decision!.compareDocumentPosition(folderSection!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls
    expect(calls.some(c => String(c[0]).endsWith('/folder-trust'))).toBe(false)
    useAgents({ autoStart: false }).pendingFolderTrust.value = []
    wrapper.unmount()
  })

  // I + C: a Project is an association — it suggests its folder only when none is chosen, and never rewrites one.
  it('fills an empty folder from the chosen project, but never overwrites a folder the user typed', async () => {
    const wrapper = mount(SpawnDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()
    const folder = () => (document.querySelector('[data-testid="spawn-folder-input-wrap"]') as HTMLInputElement).value

    const projectTrigger = document.querySelector('#spawn-project') as HTMLElement
    await selectByLabel(projectTrigger, 'Alpha')
    await waitForFolderCheck()
    expect(folder()).toBe('/home/u/alpha')

    await selectByLabel(projectTrigger, 'None')
    await flushPromises()
    expect(folder()).toBe('/home/u/alpha')

    setInputValue(document.querySelector('[data-testid="spawn-folder-input-wrap"]') as HTMLInputElement, '/Users/me/elsewhere')
    await selectByLabel(projectTrigger, 'Alpha')
    await waitForFolderCheck()
    expect(folder()).toBe('/Users/me/elsewhere')
    wrapper.unmount()
  })

  it('spawner select is present and hydrates from project default', async () => {
    const wrapper = mount(SpawnDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    const spawnerTrigger = document.querySelector('[data-testid="spawn-spawner"]') as HTMLElement
    expect(spawnerTrigger).not.toBeNull()

    // Before project selection, the trigger shows the empty-value option's label.
    expect(spawnerTrigger.textContent).toContain('Claude default')
    const panelBefore = await openListbox(spawnerTrigger)
    expect(panelBefore.querySelectorAll('[role="option"]')[0].textContent?.trim()).toContain('Claude default')
    // Close it — leaving it open would make the next trigger click toggle it closed instead of open.
    spawnerTrigger.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()

    // Select a project — spawner should be hydrated from project.defaultSpawnerId
    const projectTrigger = document.querySelector('#spawn-project') as HTMLElement
    await selectByLabel(projectTrigger, 'Alpha')
    await waitForFolderCheck()

    expect(spawnerTrigger.textContent).toContain('Claude (Opus)')
    // First option label changes to "Project default" when a project is chosen
    const panelAfter = await openListbox(spawnerTrigger)
    expect(panelAfter.querySelectorAll('[role="option"]')[0].textContent?.trim()).toContain('Project default')

    wrapper.unmount()
  })

  it('spawner select lists loaded spawners with built-in indicator', async () => {
    const wrapper = mount(SpawnDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    const spawnerTrigger = document.querySelector('[data-testid="spawn-spawner"]') as HTMLElement
    expect(spawnerTrigger).not.toBeNull()
    const panel = await openListbox(spawnerTrigger)
    const optionTexts = Array.from(panel.querySelectorAll('[role="option"]')).map(el => el.textContent?.trim())
    // sampleSpawner.builtIn = false, so no "(built-in)" suffix
    expect(optionTexts.some(t => t?.includes('Claude (Opus)'))).toBe(true)
    expect(optionTexts.every(t => !t?.includes('(built-in)'))).toBe(true)

    wrapper.unmount()
  })

  it('there is no model select', async () => {
    const wrapper = mount(SpawnDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    const modelSelect = document.querySelector('#spawn-model')
    expect(modelSelect).toBeNull()

    wrapper.unmount()
  })

  it('there is no channel checkbox', async () => {
    const wrapper = mount(SpawnDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    const channelCheckbox = document.querySelector('#spawn-channel')
    expect(channelCheckbox).toBeNull()

    wrapper.unmount()
  })

  it('permission-mode select offers all claude CLI modes', async () => {
    const wrapper = mount(SpawnDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    const permTrigger = document.querySelector('[data-testid="spawn-permission-mode"]') as HTMLElement
    expect(permTrigger).not.toBeNull()

    const values = selectOptionsById(wrapper, 'spawn-permission-mode').map(o => o.value)
    for (const mode of ['default', 'plan', 'acceptEdits', 'auto', 'bypassPermissions', 'dontAsk'])
      expect(values).toContain(mode)
    expect(permTrigger.textContent).toContain('Ask for permission (default)')

    wrapper.unmount()
  })

  it('dontAsk also shows the dangerous-mode warning banner', async () => {
    const wrapper = mount(SpawnDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    const permTrigger = document.querySelector('[data-testid="spawn-permission-mode"]') as HTMLElement
    await selectByLabel(permTrigger, 'Never ask (dangerous)')
    expect(document.querySelector('[data-testid="bypass-warning"]')).not.toBeNull()

    // A non-dangerous mode (auto) must NOT show the warning.
    await selectByLabel(permTrigger, 'Auto (smart approvals)')
    expect(document.querySelector('[data-testid="bypass-warning"]')).toBeNull()

    wrapper.unmount()
  })

  it('bypass warning banner is shown only when bypassPermissions is selected', async () => {
    const wrapper = mount(SpawnDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    // Initially no warning
    const warningBefore = document.querySelector('.bg-yellow-50\\/50, .dark\\:bg-yellow-950\\/20')
    expect(warningBefore).toBeNull()

    const permTrigger = document.querySelector('[data-testid="spawn-permission-mode"]') as HTMLElement
    await selectByLabel(permTrigger, 'Bypass all permissions (dangerous)')

    // Warning banner should appear
    const warning = document.querySelector('[data-testid="bypass-warning"]')
    expect(warning).not.toBeNull()

    wrapper.unmount()
  })

  it('bypass confirm gate: first click sets confirmed flag, second proceeds', async () => {
    const wrapper = mount(SpawnDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    // Select a project to enable spawn
    const projectTrigger = document.querySelector('#spawn-project') as HTMLElement
    await selectByLabel(projectTrigger, 'Alpha')
    await waitForFolderCheck()

    const promptInput = document.querySelector('[data-testid="spawn-prompt-wrap"]') as HTMLTextAreaElement
    setInputValue(promptInput, 'do something dangerous')
    await flushPromises()

    // Select bypassPermissions mode
    const permTrigger = document.querySelector('[data-testid="spawn-permission-mode"]') as HTMLElement
    await selectByLabel(permTrigger, 'Bypass all permissions (dangerous)')

    const spawnBtn = document.querySelector('[data-testid="spawn-btn"]') as HTMLButtonElement

    // First click — should NOT call spawn, should show confirm message
    spawnBtn.click()
    await flushPromises()

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    const spawnCallsBefore = fetchMock.mock.calls.filter(c => c[0] === '/api/agents/spawn')
    expect(spawnCallsBefore).toHaveLength(0)

    const confirmMsg = document.querySelector('[data-testid="bypass-confirm-msg"]')
    expect(confirmMsg).not.toBeNull()

    // Second click — should proceed
    spawnBtn.click()
    await flushPromises()

    const spawnCallsAfter = fetchMock.mock.calls.filter(c => c[0] === '/api/agents/spawn')
    expect(spawnCallsAfter).toHaveLength(1)

    wrapper.unmount()
  })

  it('bypass confirm gate resets when permission mode changes', async () => {
    const wrapper = mount(SpawnDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    const projectTrigger = document.querySelector('#spawn-project') as HTMLElement
    await selectByLabel(projectTrigger, 'Alpha')
    await waitForFolderCheck()

    const promptInput = document.querySelector('[data-testid="spawn-prompt-wrap"]') as HTMLTextAreaElement
    setInputValue(promptInput, 'risky task')
    await flushPromises()

    const permTrigger = document.querySelector('[data-testid="spawn-permission-mode"]') as HTMLElement
    await selectByLabel(permTrigger, 'Bypass all permissions (dangerous)')

    // First click — triggers confirm
    const spawnBtn = document.querySelector('[data-testid="spawn-btn"]') as HTMLButtonElement
    spawnBtn.click()
    await flushPromises()

    const confirmMsgBefore = document.querySelector('[data-testid="bypass-confirm-msg"]')
    expect(confirmMsgBefore).not.toBeNull()

    // Change mode — confirm state should reset
    await selectByLabel(permTrigger, 'Ask for permission (default)')

    const confirmMsgAfter = document.querySelector('[data-testid="bypass-confirm-msg"]')
    expect(confirmMsgAfter).toBeNull()

    wrapper.unmount()
  })

  it('sends spawnerId, projectId, cwd, enableChannel:true, permissionMode, and NO model key in the spawn payload', async () => {
    const wrapper = mount(SpawnDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    const projectTrigger = document.querySelector('#spawn-project') as HTMLElement
    await selectByLabel(projectTrigger, 'Alpha')
    await waitForFolderCheck()

    const promptInput = document.querySelector('[data-testid="spawn-prompt-wrap"]') as HTMLTextAreaElement
    expect(promptInput).not.toBeNull()
    setInputValue(promptInput, 'do a thing')
    await flushPromises()

    const spawnBtn = document.querySelector('[data-testid="spawn-btn"]') as HTMLButtonElement
    expect(spawnBtn).not.toBeNull()
    spawnBtn.click()
    await flushPromises()

    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls
    const spawnCall = calls.find(c => c[0] === '/api/agents/spawn')
    expect(spawnCall).toBeTruthy()
    const body = JSON.parse(spawnCall![1].body as string)
    expect(body).toMatchObject({
      prompt: 'do a thing',
      cwd: '/home/u/alpha',
      spawnerId: 'spwn_a',
      projectId: 'prj_a',
      enableChannel: true,
      permissionMode: 'default',
    })
    // model key must NOT be present
    expect(Object.keys(body)).not.toContain('model')

    wrapper.unmount()
  })

  it('does not show an error when an interactive session exits with a null exit code', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/projects')
        return Promise.resolve({ ok: true, json: async () => [sampleProject] })
      if (url === '/api/spawners')
        return Promise.resolve({ ok: true, json: async () => [sampleSpawner] })
      if (url === '/api/agents/spawn')
        return Promise.resolve({ ok: true, json: async () => ({ ok: true, pid: 12345 }) })
      if (url.startsWith('/api/agents/spawn/12345/status'))
        return Promise.resolve({ ok: true, json: async () => ({ pid: 12345, status: 'exited', exitCode: null }) })
      return folderRoutes(url, init)
    }))

    const wrapper = mount(SpawnDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    const projectTrigger = document.querySelector('#spawn-project') as HTMLElement
    await selectByLabel(projectTrigger, 'Alpha')
    await waitForFolderCheck()

    const promptInput = document.querySelector('[data-testid="spawn-prompt-wrap"]') as HTMLTextAreaElement
    setInputValue(promptInput, 'do a thing')
    await flushPromises()

    const spawnBtn = document.querySelector('[data-testid="spawn-btn"]') as HTMLButtonElement
    spawnBtn.click()
    await flushPromises()
    await flushPromises()

    // A clean interactive-session end (null exitCode) must not surface an error.
    expect(document.body.textContent).not.toContain('exited with code')

    wrapper.unmount()
  })

  it('sends permissionMode:acceptEdits without confirm gate', async () => {
    const wrapper = mount(SpawnDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    const projectTrigger = document.querySelector('#spawn-project') as HTMLElement
    await selectByLabel(projectTrigger, 'Alpha')
    await waitForFolderCheck()

    const promptInput = document.querySelector('[data-testid="spawn-prompt-wrap"]') as HTMLTextAreaElement
    setInputValue(promptInput, 'edit files')
    await flushPromises()

    const permTrigger = document.querySelector('[data-testid="spawn-permission-mode"]') as HTMLElement
    await selectByLabel(permTrigger, 'Auto-accept edits')

    const spawnBtn = document.querySelector('[data-testid="spawn-btn"]') as HTMLButtonElement
    spawnBtn.click()
    await flushPromises()

    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls
    const spawnCall = calls.find(c => c[0] === '/api/agents/spawn')
    expect(spawnCall).toBeTruthy()
    const body = JSON.parse(spawnCall![1].body as string)
    expect(body.permissionMode).toBe('acceptEdits')
    expect(Object.keys(body)).not.toContain('model')

    wrapper.unmount()
  })
})

describe('spawnDialog — agent name and icon (3N.1)', () => {
  async function fill(o: { name?: string } = {}) {
    const wrapper = mount(SpawnDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()
    if (o.name !== undefined)
      setInputValue(document.querySelector('[data-testid="spawn-name-wrap"]') as HTMLInputElement, o.name)
    setInputValue(document.querySelector('[data-testid="spawn-folder-input-wrap"]') as HTMLInputElement, '/Users/me/scratch/resume')
    setInputValue(document.querySelector('[data-testid="spawn-prompt-wrap"]') as HTMLTextAreaElement, 'tidy my CV')
    await waitForFolderCheck()
    return wrapper
  }
  const spawnBodies = () => (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(c => c[0] === '/api/agents/spawn').map(c => JSON.parse(c[1].body as string) as Record<string, unknown>)

  it('e, H: sends a name and icon for a Project = None agent, and creates no project', async () => {
    const wrapper = await fill({ name: '  Resume Editor ' })
    await selectByLabel(document.querySelector('#spawn-category button, [data-testid="spawn-category"]')!, 'Documents')
    expect(document.querySelector('[data-testid="spawn-identity-section"] [data-testid="agent-glyph"]')!.getAttribute('data-category')).toBe('document')
    ;(document.querySelector('[data-testid="spawn-btn"]') as HTMLButtonElement).click()
    await flushPromises()

    const [body] = spawnBodies()
    expect(body.displayName).toBe('Resume Editor')
    expect(body.category).toBe('document')
    expect(body).not.toHaveProperty('projectId')
    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls
    expect(calls.some(c => c[0] === '/api/projects' && c[1]?.method === 'POST')).toBe(false)
    wrapper.unmount()
  })

  it('g, I: sends no name or icon when none were given — never the folder name', async () => {
    const wrapper = await fill()
    expect(document.querySelector('[data-testid="spawn-identity-section"] [data-testid="agent-glyph"]')!.getAttribute('data-category')).toBe('general')
    ;(document.querySelector('[data-testid="spawn-btn"]') as HTMLButtonElement).click()
    await flushPromises()
    const [body] = spawnBodies()
    expect(body).not.toHaveProperty('displayName')
    expect(body).not.toHaveProperty('category')
    expect(JSON.stringify(body)).not.toContain('"resume"')
    wrapper.unmount()
  })

  it('keeps Start disabled for a name longer than 60 characters, and says why', async () => {
    const wrapper = await fill({ name: 'n'.repeat(61) })
    expect((document.querySelector('[data-testid="spawn-btn"]') as HTMLButtonElement).disabled).toBe(true)
    expect(document.querySelector('[data-testid="spawn-name-too-long"]')!.textContent).toContain('at most 60')
    wrapper.unmount()
  })

  it('says when the spawner could not keep the name, instead of dropping it silently', async () => {
    const base = globalThis.fetch as unknown as (url: string, init?: RequestInit) => Promise<unknown>
    const toastError = vi.spyOn((await import('../composables/useToast')).toast, 'error')
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => url === '/api/agents/spawn'
      ? Promise.resolve({ ok: true, json: async () => ({ ok: true, pid: 12345, profile: 'unsupported' }) })
      : base(url, init)))
    const wrapper = await fill({ name: 'Research' })
    ;(document.querySelector('[data-testid="spawn-btn"]') as HTMLButtonElement).click()
    await flushPromises()
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('cannot keep a name or icon'))
    toastError.mockRestore()
    wrapper.unmount()
  })
})

describe('spawnDialog — new projectless workspace (3N.2)', () => {
  let created: string[]
  let existing: Set<string>
  let createStatus: number
  const ROOT = '/Users/me/Documents/AI-Agents'

  beforeEach(() => {
    created = []
    existing = new Set()
    createStatus = 201
    const base = globalThis.fetch as unknown as (url: string, init?: RequestInit) => Promise<unknown>
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const folderOf = () => (JSON.parse(String(init?.body ?? '{}')) as { name: string }).name.replace(/[^A-Z0-9]+/gi, '-')
      if (url === '/api/agents/projectless/preview') {
        const folder = folderOf()
        return Promise.resolve({ ok: true, json: async () => ({ root: ROOT, folder, path: `${ROOT}/${folder}`, exists: existing.has(folder) }) })
      }
      // 3N.2.1: the server creates the workspace inside the spawn, so it can
      // record that it made the folder and its allowed-folder entry.
      const spawnBody = url === '/api/agents/spawn' ? JSON.parse(String(init?.body ?? '{}')) as { projectless?: boolean, displayName?: string } : null
      if (spawnBody?.projectless) {
        const folder = String(spawnBody.displayName).replace(/[^A-Z0-9]+/gi, '-')
        if (createStatus !== 201)
          return Promise.resolve({ ok: false, status: createStatus, json: async () => ({ error: 'a folder with that name already exists in the projectless agents folder; choose another name' }) })
        created.push(folder)
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, pid: 4321, workspace: { root: ROOT, folder, path: `${ROOT}/${folder}`, exists: false } }) })
      }
      return base(url, init)
    }))
  })

  async function openNewWorkspace(name: string) {
    const wrapper = mount(SpawnDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()
    ;(document.querySelector('[data-testid="spawn-mode-new"]') as HTMLInputElement).click()
    await flushPromises()
    if (name)
      setInputValue(document.querySelector('[data-testid="spawn-name-wrap"]') as HTMLInputElement, name)
    setInputValue(document.querySelector('[data-testid="spawn-prompt-wrap"]') as HTMLTextAreaElement, 'tidy my CV')
    await flushPromises()
    await new Promise(resolve => setTimeout(resolve, 350))
    await flushPromises()
    return wrapper
  }
  const calls = () => (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls

  it('hides the folder and Project fields, and needs a name to name the folder', async () => {
    const wrapper = await openNewWorkspace('')
    expect(document.querySelector('[data-testid="spawn-folder-section"]')).toBeNull()
    expect(document.querySelector('#spawn-project')).toBeNull()
    expect(document.querySelector('[data-testid="spawn-new-workspace-needs-name"]')).not.toBeNull()
    expect((document.querySelector('[data-testid="spawn-btn"]') as HTMLButtonElement).disabled).toBe(true)
    wrapper.unmount()
  })

  it('21–25: creates <root>/<folder> and starts the agent there — Project None, no Git, GitHub or repository step, trust left to the user', async () => {
    const wrapper = await openNewWorkspace('Resume Editor')
    expect(document.querySelector('[data-testid="spawn-new-workspace-folder"]')!.textContent).toBe('Resume-Editor')
    expect(document.querySelector('[data-testid="spawn-new-workspace-path"]')!.textContent!.trim()).toBe(`${ROOT}/Resume-Editor`)
    const start = document.querySelector('[data-testid="spawn-btn"]') as HTMLButtonElement
    expect(start.disabled).toBe(false)
    start.click()
    await flushPromises()

    expect(created).toEqual(['Resume-Editor'])
    const spawn = calls().find(c => c[0] === '/api/agents/spawn')!
    const body = JSON.parse(spawn[1].body as string)
    expect(body.projectless).toBe(true)
    // The client never names the folder, nor claims the server made it.
    expect(body).not.toHaveProperty('cwd')
    expect(body).not.toHaveProperty('workspaceCreated')
    expect(body).not.toHaveProperty('allowedFolder')
    expect(body.displayName).toBe('Resume Editor')
    expect(body).not.toHaveProperty('projectId')
    const urls = calls().map(c => String(c[0]))
    expect(urls.some(u => u.includes('github') || u.includes('/api/repositories'))).toBe(false)
    expect(calls().some(c => c[0] === '/api/projects' && c[1]?.method === 'POST')).toBe(false)
    expect(urls.some(u => u.includes('/folder-trust'))).toBe(false)
    // One request creates the workspace and starts the agent; there is no separate create call.
    expect(urls).not.toContain('/api/agents/projectless/workspaces')
    wrapper.unmount()
  })

  it('20: never reuses an existing folder', async () => {
    existing.add('Portfolio')
    const wrapper = await openNewWorkspace('Portfolio')
    expect(document.querySelector('[data-testid="spawn-new-workspace-exists"]')).not.toBeNull()
    expect((document.querySelector('[data-testid="spawn-btn"]') as HTMLButtonElement).disabled).toBe(true)
    wrapper.unmount()
  })

  it('shows why the folder could not be created, and does not start the agent', async () => {
    createStatus = 409
    const wrapper = await openNewWorkspace('Research')
    ;(document.querySelector('[data-testid="spawn-btn"]') as HTMLButtonElement).click()
    await flushPromises()
    expect(document.querySelector('[data-testid="spawn-error"]')!.textContent).toContain('already exists')
    expect(created).toEqual([])
    wrapper.unmount()
  })
})
