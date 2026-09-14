<script setup lang="ts">
import type { FolderCheck } from '../composables/useAgentFolders'
import type { ProjectlessWorkspace } from '../composables/useAgentLifecycle'
import type { Project } from '../types'
import type { AgentPurpose } from '../utils/agentPurpose'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { allowWorkingFolder, checkFolder, listWorkingFolders } from '../composables/useAgentFolders'
import { previewProjectlessWorkspace } from '../composables/useAgentLifecycle'
import { fetchProjectFolders } from '../composables/useProjectFolders'
import { useProjects } from '../composables/useProjects'
import { useSpawnDialog } from '../composables/useSpawnDialog'
import { useSpawners } from '../composables/useSpawners'
import { useSpawnWatch, watchSpawn } from '../composables/useSpawnWatch'
import { toast } from '../composables/useToast'
import { useAgents } from '../features/agents'
import { workspaceDisplay } from '../utils/agentGroup'
import { DEFAULT_AGENT_PURPOSE } from '../utils/agentPurpose'
import { errorMessage } from '../utils/errorMessage'
import { SPAWN_AUTOCLOSE_MS } from '../utils/timing'
import FolderTrustDecision from './FolderTrustDecision.vue'
import QuickCreateProjectPanel from './QuickCreateProjectPanel.vue'
import AgentPurposeField from './ui/AgentPurposeField.vue'
import AppButton from './ui/AppButton.vue'
import AppFieldLabel from './ui/AppFieldLabel.vue'
import AppInput from './ui/AppInput.vue'
import AppModal from './ui/AppModal.vue'
import AppModalHeader from './ui/AppModalHeader.vue'
import AppSelect from './ui/AppSelect.vue'

/*
 * New Agent, around how an agent actually runs (3M):
 *
 *   Name, Icon      optional — who the agent is, shown instead of its session
 *                   title; presentation only, saved by session id (3N.1)
 *   Workspace       an existing folder, or a new projectless workspace the
 *                   dashboard creates under Settings → Agent folders (3N.2)
 *   Working folder  required for an existing folder — where Claude executes
 *   Project         optional — Dashboard organisation only (None is valid)
 *   Spawner, Prompt, System prompt, Permissions — unchanged
 *
 * Two separate permissions, never merged:
 *
 *   The dashboard starts agents only in folders the user allowed — Project
 *   folders or working folders. "Allow this folder" is an explicit act here.
 *
 *   Claude Code asks, the first time it starts in a folder, whether to trust
 *   it. That question is shown on its own decision surface below; the dashboard
 *   never answers it for the user and never skips it.
 *
 * A Project never supplies Repository or Workspace identity: the folder check
 * resolves that from the folder itself, and a plain folder has no repository.
 */
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [], spawned: [pid: number] }>()

const { projects, isLoading: projectsLoading } = useProjects()
const { spawners } = useSpawners()
const { spawns } = useSpawnWatch()
// Server-owned: whether Claude is waiting at its folder trust question (3M.1).
const { pendingFolderTrust } = useAgents({ autoStart: false })

const sortedProjects = computed(() =>
  projects.value.slice().sort((a, b) => a.name.localeCompare(b.name)),
)

const dlg = useSpawnDialog({
  fetchFolders: fetchProjectFolders,
  lookupSpawner: id => spawners.value.find(s => s.id === id),
})

const projectChoice = ref<string>('')
const showQuickCreate = ref(false)
const prompt = ref('')
const systemPrompt = ref('')
// Who the agent is (3N.1). Optional; never taken from the folder or the Project.
const NAME_MAX = 60
const displayName = ref('')
const category = ref<AgentPurpose>(DEFAULT_AGENT_PURPOSE)
const nameTooLong = computed(() => [...displayName.value.trim()].length > NAME_MAX)
/*
 * Where it runs (3N.2): an existing folder, or a new plain folder created under
 * the projectless agents folder and named after the agent. A new workspace has
 * no Project, repository or GitHub step; the server allows exactly that folder
 * and Claude Code still asks whether to trust it.
 */
type WorkspaceMode = 'existing' | 'new'
const workspaceMode = ref<WorkspaceMode>('existing')
const newWorkspace = ref<ProjectlessWorkspace | null>(null)
const newWorkspaceError = ref('')
let previewTimer: ReturnType<typeof setTimeout> | null = null
let previewAbort: AbortController | null = null
watch([workspaceMode, displayName], ([mode, name]) => {
  if (previewTimer)
    clearTimeout(previewTimer)
  previewAbort?.abort()
  newWorkspace.value = null
  newWorkspaceError.value = ''
  if (mode !== 'new' || !name.trim())
    return
  previewTimer = setTimeout(async () => {
    previewAbort = new AbortController()
    try {
      newWorkspace.value = await previewProjectlessWorkspace(name.trim(), previewAbort.signal)
    }
    catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError'))
        newWorkspaceError.value = errorMessage(e, 'Could not name the workspace folder')
    }
  }, 300)
})
// A projectless workspace belongs to no Project.
watch(workspaceMode, (mode) => {
  if (mode === 'new')
    projectChoice.value = ''
})
const newWorkspaceReady = computed(() => !!displayName.value.trim() && !!newWorkspace.value && !newWorkspace.value.exists)

type PermissionMode = 'default' | 'plan' | 'acceptEdits' | 'auto' | 'bypassPermissions' | 'dontAsk'
const permissionMode = ref<PermissionMode>('default')
const bypassConfirmed = ref(false)
const isSpawning = ref(false)
const errorMsg = ref('')
const spawnedPid = ref<number | null>(null)

const workingFolders = ref<string[]>([])
const knownFolder = ref('')
const check = ref<FolderCheck | null>(null)
const checkError = ref('')
const allowing = ref(false)

let checkTimer: ReturnType<typeof setTimeout> | null = null
let checkAbort: AbortController | null = null
let autoCloseTimer: ReturnType<typeof setTimeout> | null = null

const spawned = computed(() => spawnedPid.value === null ? null : spawns.value.find(s => s.pid === spawnedPid.value) ?? null)
const pendingTrust = computed(() => spawnedPid.value === null ? null : pendingFolderTrust.value.find(t => t.pid === spawnedPid.value) ?? null)

const formEl = ref<HTMLFormElement | null>(null)
// Bring the question into view the moment Claude asks it.
watch(() => Boolean(pendingTrust.value), (asking) => {
  if (asking && formEl.value)
    formEl.value.scrollTop = 0
})

/*
 * Folders the user has already named somewhere: every Project folder and every
 * allowed working folder. A shortcut only — any absolute path can be typed.
 */
const knownFolderOptions = computed(() => {
  const labels = new Map<string, string>()
  for (const p of sortedProjects.value) {
    for (const f of p.folders ?? []) {
      if (!labels.has(f.path))
        labels.set(f.path, `${f.path} · ${p.name}`)
    }
  }
  for (const path of workingFolders.value) {
    if (!labels.has(path))
      labels.set(path, `${path} · allowed folder`)
  }
  return [
    { value: '', label: labels.size ? 'Choose a known folder…' : 'No known folders yet' },
    ...[...labels].map(([value, label]) => ({ value, label })),
  ]
})

watch(knownFolder, (path) => {
  if (!path)
    return
  dlg.cwd.value = path
  knownFolder.value = ''
})

// While projects load, `projects` is empty for the same reason it would be with
// none at all, so loading is its own option rather than an empty list.
const projectOptions = computed(() => projectsLoading.value
  ? [{ value: '', label: 'Loading projects…', disabled: true }]
  : [
      { value: '', label: 'None' },
      ...sortedProjects.value.map(p => ({ value: p.id, label: p.name })),
      { value: '__create__', label: '+ Create new project…' },
    ])

const spawnerOptions = computed(() => [
  { value: '', label: dlg.project.value ? 'Project default' : 'Claude default' },
  ...spawners.value.map(s => ({ value: s.id, label: `${s.name}${s.builtIn ? ' (built-in)' : ''}` })),
])

const permissionModeOptions: Array<{ value: PermissionMode, label: string }> = [
  { value: 'default', label: 'Ask for permission (default)' },
  { value: 'plan', label: 'Plan mode (read-only)' },
  { value: 'acceptEdits', label: 'Auto-accept edits' },
  { value: 'auto', label: 'Auto (smart approvals)' },
  { value: 'bypassPermissions', label: 'Bypass all permissions (dangerous)' },
  { value: 'dontAsk', label: 'Never ask (dangerous)' },
]

// Modes that skip every confirmation prompt are gated behind a click-again
// confirmation. 'auto' and 'plan' are not dangerous and need no gate.
const dangerousMode = computed(() =>
  permissionMode.value === 'bypassPermissions' || permissionMode.value === 'dontAsk')

/* ── Working folder ─────────────────────────────────────────────── */

async function runCheck(path: string): Promise<void> {
  checkAbort?.abort()
  checkAbort = new AbortController()
  checkError.value = ''
  try {
    check.value = await checkFolder(path, checkAbort.signal)
  }
  catch (e) {
    if (e instanceof Error && e.name === 'AbortError')
      return
    check.value = null
    checkError.value = errorMessage(e, 'Could not check this folder')
  }
}

watch(() => dlg.cwd.value, (value) => {
  if (checkTimer)
    clearTimeout(checkTimer)
  check.value = null
  checkError.value = ''
  const path = value.trim()
  if (!path)
    return
  checkTimer = setTimeout(() => void runCheck(path), 300)
})

const folderPending = computed(() => dlg.cwd.value.trim() !== '' && check.value === null && checkError.value === '')

const FOLDER_PROBLEMS: Record<string, string> = {
  'not-absolute': 'Enter an absolute path, starting with /.',
  'not-found': 'No folder exists at this path.',
  'not-directory': 'This path is a file, not a folder.',
  'blacklisted': 'This folder holds credentials or configuration, so agents can never start in it.',
}

const folderProblem = computed(() => check.value?.reason ? FOLDER_PROBLEMS[check.value.reason] ?? null : null)

/** Repository, workspace and branch as resolved from the folder itself — never from the Project. */
const folderIdentity = computed(() => {
  const ws = check.value?.workspace
  if (!check.value || folderProblem.value)
    return null
  if (!ws)
    return 'Workspace not resolved'
  const { title, kind } = workspaceDisplay(ws)
  if (ws.kind === 'plain')
    return `${ws.name} · not a Git repository · no repository`
  return `Repository ${ws.repository?.name || 'unknown'} · ${title} · ${kind}`
})

async function allowFolder(): Promise<void> {
  if (!check.value)
    return
  allowing.value = true
  checkError.value = ''
  try {
    const result = await allowWorkingFolder(check.value.path)
    workingFolders.value = result.folders
    check.value = result.check
  }
  catch (e) {
    checkError.value = errorMessage(e, 'Could not allow this folder')
  }
  finally {
    allowing.value = false
  }
}

/* ── Project (optional) ─────────────────────────────────────────── */

watch(projectChoice, async (v) => {
  if (v === '__create__') {
    showQuickCreate.value = true
    return
  }
  showQuickCreate.value = false
  if (!v) {
    dlg.clearProject()
    return
  }
  const proj = projects.value.find(p => p.id === v)
  if (proj)
    await dlg.selectProject(proj)
})

watch(permissionMode, () => {
  bypassConfirmed.value = false
})

function onProjectCreated(p: Project) {
  showQuickCreate.value = false
  projectChoice.value = p.id
}

function onQuickCreateCancel() {
  showQuickCreate.value = false
  projectChoice.value = ''
}

/* ── Start ──────────────────────────────────────────────────────── */

const canStart = computed(() =>
  !isSpawning.value
  && spawnedPid.value === null
  && prompt.value.trim() !== ''
  && !nameTooLong.value
  && (workspaceMode.value === 'new'
    ? newWorkspaceReady.value
    : dlg.cwd.value.trim() !== '' && check.value?.allowed === true))

function resetForm() {
  prompt.value = ''
  systemPrompt.value = ''
  displayName.value = ''
  category.value = DEFAULT_AGENT_PURPOSE
  workspaceMode.value = 'existing'
  permissionMode.value = 'default'
  bypassConfirmed.value = false
  isSpawning.value = false
  errorMsg.value = ''
  spawnedPid.value = null
  projectChoice.value = ''
  showQuickCreate.value = false
  check.value = null
  checkError.value = ''
  dlg.reset()
  if (autoCloseTimer) {
    clearTimeout(autoCloseTimer)
    autoCloseTimer = null
  }
}

async function handleSpawn() {
  if (!canStart.value)
    return

  if (dangerousMode.value && !bypassConfirmed.value) {
    bypassConfirmed.value = true
    return
  }

  isSpawning.value = true
  errorMsg.value = ''

  const newWorkspace = workspaceMode.value === 'new'
  const cwd = newWorkspace ? '' : dlg.cwd.value.trim()
  const body: Record<string, unknown> = {
    prompt: prompt.value.trim(),
    enableChannel: true,
    permissionMode: permissionMode.value,
  }
  // A new workspace is created by the server as part of this spawn, so it can
  // record that it made the folder and the allowed-folder entry (3N.2.1).
  if (newWorkspace)
    body.projectless = true
  else
    body.cwd = cwd
  if (systemPrompt.value.trim())
    body.systemPrompt = systemPrompt.value.trim()
  // Presentation only: sent when given, never derived from the folder or Project.
  if (displayName.value.trim())
    body.displayName = displayName.value.trim()
  if (category.value !== DEFAULT_AGENT_PURPOSE)
    body.category = category.value
  if (dlg.spawnerId.value)
    body.spawnerId = dlg.spawnerId.value
  // Organisational only: omitted entirely for Project = None.
  if (workspaceMode.value === 'existing' && dlg.project.value?.id)
    body.projectId = dlg.project.value.id

  try {
    const res = await fetch('/api/agents/spawn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error(data?.error || `Server responded with ${res.status}`)
    }
    const data = await res.json()
    const pid = data.pid as number
    // The name and icon are saved by session id; say so when that could not happen.
    if (data.profile === 'unsupported')
      toast.error('The agent started, but this spawner cannot keep a name or icon. It will show its session title.')
    else if (data.profile === 'failed')
      toast.error('The agent started, but its name and icon could not be saved.')
    spawnedPid.value = pid
    const startedIn = newWorkspace ? String(data.workspace?.path ?? '') : cwd
    if (newWorkspace)
      dlg.cwd.value = startedIn
    watchSpawn(pid, startedIn)
    emit('spawned', pid)
    // Closes on its own once the agent is simply starting — never while Claude
    // is waiting at its trust question or after a failure, which need the user.
    autoCloseTimer = setTimeout(() => {
      const s = spawned.value
      // Closing while Claude waits is safe: the question stays in Needs you.
      if (s && !pendingTrust.value && !s.error) {
        resetForm()
        emit('close')
      }
    }, SPAWN_AUTOCLOSE_MS)
  }
  catch (err: unknown) {
    errorMsg.value = errorMessage(err, 'Failed to start the agent')
  }
  finally {
    isSpawning.value = false
  }
}

const spawnStatusText = computed(() => {
  const s = spawned.value
  if (!s || pendingTrust.value || s.error)
    return ''
  if (s.status === 'exited')
    return 'The agent stopped.'
  return 'Starting the agent…'
})

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    errorMsg.value = ''
    void listWorkingFolders().then((folders) => {
      workingFolders.value = folders
    })
  }
  else if (spawnedPid.value !== null) {
    // A started agent stays watched after the dialog closes; the form starts fresh next time.
    resetForm()
  }
})

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.open)
    emit('close')
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  checkAbort?.abort()
  previewAbort?.abort()
  if (previewTimer)
    clearTimeout(previewTimer)
  if (checkTimer)
    clearTimeout(checkTimer)
  if (autoCloseTimer)
    clearTimeout(autoCloseTimer)
})
</script>

<template>
  <AppModal :open="open" width="600px" labelled-by="spawn-title" @close="emit('close')">
    <AppModalHeader id="spawn-title" title="New Agent" @close="emit('close')" />

    <form ref="formEl" class="flex-1 min-h-0 overflow-y-auto p-5 flex flex-col gap-4" @submit.prevent>
      <!--
        What happened after Start, first: Claude's trust question must not sit
        below the fold of a long form while the agent waits for it.
      -->
      <FolderTrustDecision v-if="pendingTrust" :trust="pendingTrust" />

      <p v-if="spawnStatusText" class="m-0 text-ui-sm text-fg-mute" data-testid="spawn-status">
        {{ spawnStatusText }}
      </p>
      <p
        v-if="errorMsg || spawned?.error"
        class="m-0 text-ui-sm text-danger-text leading-snug whitespace-pre-wrap break-words max-h-[120px] overflow-y-auto"
        role="alert"
        data-testid="spawn-error"
      >
        {{ errorMsg || spawned?.error }}
      </p>

      <!-- Who the agent is: optional, presentation only — never Project, folder or permission. -->
      <section class="flex flex-col gap-1.5" data-testid="spawn-identity-section">
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_13rem]">
          <div class="flex min-w-0 flex-col gap-1.5">
            <AppFieldLabel for="spawn-name">
              Name (optional)
            </AppFieldLabel>
            <AppInput
              id="spawn-name"
              v-model="displayName"
              placeholder="e.g. Resume Editor"
              data-testid="spawn-name-wrap"
            />
          </div>
          <div class="flex min-w-0 flex-col gap-1.5">
            <AppFieldLabel for="spawn-category">
              Icon
            </AppFieldLabel>
            <AgentPurposeField id="spawn-category" v-model="category" testid="spawn-category" />
          </div>
        </div>
        <p v-if="nameTooLong" class="m-0 text-ui-sm text-danger-text" role="alert" data-testid="spawn-name-too-long">
          A name can be at most {{ NAME_MAX }} characters.
        </p>
        <p v-else class="m-0 text-ui-sm text-fg-mute">
          Without a name the agent shows its Claude session title.
        </p>
      </section>

      <!-- Where it runs: a folder you have, or a new plain workspace named after the agent (3N.2). -->
      <fieldset class="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0" data-testid="spawn-workspace-mode">
        <legend class="field-label mb-1.5">
          Workspace
        </legend>
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label
            class="flex cursor-pointer flex-col gap-0.5 rounded-lg border px-3 py-2 transition-colors duration-[var(--duration-fast)] ease-standard focus-within:ring-[3px] focus-within:ring-accent"
            :class="workspaceMode === 'existing' ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong'"
          >
            <span class="flex items-center gap-2">
              <input v-model="workspaceMode" type="radio" name="spawn-workspace-mode" value="existing" class="accent-[var(--accent)]" data-testid="spawn-mode-existing">
              <span class="text-ui font-medium text-fg">Existing folder</span>
            </span>
            <span class="text-ui-sm text-fg-mute">A repository, worktree or folder you already have</span>
          </label>
          <label
            class="flex cursor-pointer flex-col gap-0.5 rounded-lg border px-3 py-2 transition-colors duration-[var(--duration-fast)] ease-standard focus-within:ring-[3px] focus-within:ring-accent"
            :class="workspaceMode === 'new' ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong'"
          >
            <span class="flex items-center gap-2">
              <input v-model="workspaceMode" type="radio" name="spawn-workspace-mode" value="new" class="accent-[var(--accent)]" data-testid="spawn-mode-new">
              <span class="text-ui font-medium text-fg">New projectless workspace</span>
            </span>
            <span class="text-ui-sm text-fg-mute">A new plain folder named after the agent — no Git or Project needed</span>
          </label>
        </div>
      </fieldset>

      <section v-if="workspaceMode === 'new'" class="flex flex-col gap-1.5 rounded-lg border border-line bg-raised/40 px-3 py-2.5" aria-live="polite" data-testid="spawn-new-workspace">
        <p v-if="!displayName.trim()" class="m-0 text-ui-sm text-fg-mute" data-testid="spawn-new-workspace-needs-name">
          Give the agent a name above: its workspace folder is named after it.
        </p>
        <p v-else-if="newWorkspaceError" class="m-0 text-ui-sm text-danger-text" role="alert" data-testid="spawn-new-workspace-error">
          {{ newWorkspaceError }}
        </p>
        <template v-else-if="newWorkspace">
          <p class="m-0 text-ui-sm text-fg-soft">
            Workspace folder <span class="font-mono text-fg" data-testid="spawn-new-workspace-folder">{{ newWorkspace.folder }}</span>
          </p>
          <p class="m-0 break-all font-mono text-label text-fg-faint" data-testid="spawn-new-workspace-path">
            {{ newWorkspace.path }}
          </p>
          <p v-if="newWorkspace.exists" class="m-0 text-ui-sm text-danger-text" role="alert" data-testid="spawn-new-workspace-exists">
            A folder with this name already exists. Choose another agent name — an existing folder is never reused.
          </p>
          <p v-else class="m-0 text-ui-sm text-fg-mute">
            Created when you start the agent: a plain folder, with no Git repository, GitHub or Project. Claude Code will still ask whether to trust it.
          </p>
        </template>
        <p v-else class="m-0 text-ui-sm text-fg-mute">
          Naming the workspace folder…
        </p>
        <p class="m-0 text-label text-fg-faint">
          Change where these folders go in Settings → Agent folders.
        </p>
      </section>

      <!-- Working folder: required, and the one input that decides where Claude runs. -->
      <section v-if="workspaceMode === 'existing'" class="flex flex-col gap-1.5" data-testid="spawn-folder-section">
        <AppFieldLabel for="spawn-folder-input">
          Working folder
        </AppFieldLabel>
        <AppInput
          id="spawn-folder-input"
          v-model="dlg.cwd.value"
          placeholder="/path/to/the/folder/Claude/works/in"
          spellcheck="false"
          autocomplete="off"
          data-testid="spawn-folder-input-wrap"
          aria-describedby="spawn-folder-status"
        />
        <AppSelect
          id="spawn-known-folder"
          v-model="knownFolder"
          :options="knownFolderOptions"
          :disabled="knownFolderOptions.length === 1"
          aria-label="Choose a known folder"
          size="compact"
          class="w-full"
          data-testid="spawn-known-folder"
        />
        <div id="spawn-folder-status" class="flex flex-col gap-1.5 text-ui-sm" aria-live="polite" data-testid="spawn-folder-status">
          <p v-if="!dlg.cwd.value.trim()" class="m-0 field-help">
            Any local folder: a repository checkout, a worktree, or a plain folder. It does not need a Project or GitHub.
          </p>
          <p v-else-if="folderPending" class="m-0 text-fg-mute">
            Checking this folder…
          </p>
          <p v-else-if="checkError" class="m-0 text-danger-text" role="alert">
            {{ checkError }}
          </p>
          <p v-else-if="folderProblem" class="m-0 text-danger-text" data-testid="spawn-folder-problem">
            {{ folderProblem }}
          </p>
          <template v-else-if="check">
            <p class="m-0 text-fg-soft" data-testid="spawn-folder-identity">
              {{ folderIdentity }}
            </p>
            <div
              v-if="check.reason === 'outside-allowed-folders'"
              class="flex flex-col gap-2 rounded-control border border-line bg-recessed px-3 py-2"
              data-testid="spawn-folder-not-allowed"
            >
              <p class="m-0 text-fg-soft">
                The dashboard starts agents only in folders you have allowed or that belong to a Project.
              </p>
              <div v-if="check.canAllow" class="flex flex-wrap items-center gap-2">
                <AppButton
                  variant="outline"
                  size="sm"
                  :disabled="allowing"
                  data-testid="spawn-allow-folder"
                  @click="allowFolder"
                >
                  {{ allowing ? 'Allowing…' : 'Allow this folder for agents' }}
                </AppButton>
                <span class="text-fg-mute">Claude will still ask whether to trust it.</span>
              </div>
            </div>
          </template>
        </div>
      </section>

      <!-- Project: optional organisation. None is a real choice, not a gap. A new projectless workspace has none. -->
      <section v-if="workspaceMode === 'existing'" class="flex flex-col gap-1.5">
        <AppFieldLabel for="spawn-project">
          Project (optional)
        </AppFieldLabel>
        <AppSelect
          id="spawn-project"
          v-model="projectChoice"
          :options="projectOptions"
          :disabled="projectsLoading"
          class="w-full"
        />
        <p class="m-0 field-help">
          For organisation only. It does not change the folder or the repository.
        </p>
      </section>

      <QuickCreateProjectPanel
        v-if="showQuickCreate && workspaceMode === 'existing'"
        :spawners="spawners"
        @created="onProjectCreated"
        @cancel="onQuickCreateCancel"
      />

      <section class="flex flex-col gap-1.5">
        <AppFieldLabel for="spawn-spawner">
          Spawner
        </AppFieldLabel>
        <AppSelect
          id="spawn-spawner"
          :model-value="dlg.spawnerId.value ?? ''"
          :options="spawnerOptions"
          data-testid="spawn-spawner"
          class="w-full"
          @update:model-value="dlg.spawnerId.value = $event"
        />
      </section>

      <section class="flex flex-col gap-1.5">
        <AppFieldLabel for="spawn-prompt">
          Prompt
        </AppFieldLabel>
        <AppInput
          id="spawn-prompt"
          v-model="prompt"
          type="textarea"
          :rows="4"
          required
          placeholder="What should the agent do?"
          data-testid="spawn-prompt-wrap"
        />
      </section>

      <section class="flex flex-col gap-1.5">
        <AppFieldLabel for="spawn-system">
          System prompt
        </AppFieldLabel>
        <AppInput
          id="spawn-system"
          v-model="systemPrompt"
          type="textarea"
          :rows="2"
          placeholder="Custom system instructions (optional)"
        />
      </section>

      <section class="flex flex-col gap-1.5">
        <AppFieldLabel for="spawn-permission-mode">
          Permissions
        </AppFieldLabel>
        <AppSelect
          id="spawn-permission-mode"
          v-model="permissionMode"
          :options="permissionModeOptions"
          data-testid="spawn-permission-mode"
          class="w-full"
        />
      </section>

      <div
        v-if="dangerousMode"
        data-testid="bypass-warning"
        class="rounded-control border border-warning-line bg-card px-3 py-2 text-ui-sm leading-relaxed text-warning-text"
      >
        The agent will execute all tool calls without asking for confirmation. This includes file writes, deletions, git operations, and shell commands. Only use this in isolated environments or with trusted prompts.
      </div>

      <div v-if="bypassConfirmed" role="alert" data-testid="bypass-confirm-msg" class="text-ui-sm text-danger-text font-semibold">
        Click "Start Agent" again to confirm.
      </div>
    </form>

    <footer class="shrink-0 flex justify-end gap-2 px-5 py-3 border-t border-line">
      <AppButton variant="secondary" @click="emit('close')">
        {{ spawnedPid !== null ? 'Close' : 'Cancel' }}
      </AppButton>
      <AppButton
        data-testid="spawn-btn"
        :variant="dangerousMode && bypassConfirmed ? 'danger' : 'primary'"
        :disabled="!canStart"
        @click="handleSpawn"
      >
        {{ isSpawning ? 'Starting…' : (dangerousMode && bypassConfirmed ? 'Confirm Start' : 'Start Agent') }}
      </AppButton>
    </footer>
  </AppModal>
</template>
