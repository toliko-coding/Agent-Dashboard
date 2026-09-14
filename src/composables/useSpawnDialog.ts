import type { Project, ProjectFolder, Spawner } from '../types'
import { ref, shallowRef } from 'vue'

export interface UseSpawnDialogDeps {
  /** Returns the project's folder list. Caller decides whether to embed or fetch. */
  fetchFolders: (projectId: string) => Promise<ProjectFolder[]>
  /** Looks up a spawner by id from a local cache (e.g. useSpawners()). */
  lookupSpawner: (spawnerId: string) => Spawner | undefined
}

/**
 * State + actions for the working folder, optional Project and spawner inside
 * the New Agent dialog. Decoupled from the SFC so it can be unit-tested
 * without rendering Vue.
 *
 * The working folder is primary and independent (3M). A Project is an optional
 * organisational association: choosing one suggests its default folder only
 * when no folder is chosen yet, and changing or clearing it never rewrites the
 * folder the user picked.
 */
export function useSpawnDialog(deps: UseSpawnDialogDeps) {
  const project = shallowRef<Project | null>(null)
  const folders = shallowRef<ProjectFolder[]>([])
  const selectedFolderId = ref<string | null>(null)
  const cwd = ref('')
  const spawnerId = ref<string | null>(null)

  async function selectProject(p: Project): Promise<void> {
    project.value = p
    const list = p.folders ?? await deps.fetchFolders(p.id)
    folders.value = list

    const defaultFolder = list.find(f => f.isDefault) ?? list[0] ?? null
    selectedFolderId.value = defaultFolder?.id ?? null
    if (!cwd.value.trim())
      cwd.value = defaultFolder?.path ?? ''

    if (p.defaultSpawnerId) {
      const sp = deps.lookupSpawner(p.defaultSpawnerId)
      spawnerId.value = sp?.id ?? null
    }
    else {
      spawnerId.value = null
    }
  }

  function selectFolder(folderId: string): void {
    const f = folders.value.find(x => x.id === folderId)
    if (!f)
      return
    selectedFolderId.value = folderId
    cwd.value = f.path
  }

  /** Removes the Project association; the chosen working folder stays. */
  function clearProject(): void {
    project.value = null
    folders.value = []
    selectedFolderId.value = null
    spawnerId.value = null
  }

  /** Clears everything, for a closed dialog. */
  function reset(): void {
    clearProject()
    cwd.value = ''
  }

  return {
    project,
    folders,
    selectedFolderId,
    cwd,
    spawnerId,
    selectProject,
    selectFolder,
    clearProject,
    reset,
  }
}
