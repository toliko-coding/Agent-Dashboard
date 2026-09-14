import { computed, ref } from 'vue'
import { SPAWN_STATUS_POLL_MS } from '../utils/sse'

/*
 * Agents started from New Agent, until each is either a session or gone (3M).
 *
 * This is the spawn-status poll the New Agent dialog always ran after Start,
 * moved out of the dialog so it survives the dialog closing. It exists only
 * while a spawn is being watched, runs at the same cadence, and stops the
 * moment the spawn exits, errors, or runs out of attempts — except that it
 * keeps watching while Claude is waiting at its folder trust question, because
 * that question is only visible here: before the user trusts the folder there
 * is no session file, so the process is not an agent anywhere else.
 *
 * The dashboard never answers that question itself. answerFolderTrust sends
 * the user's decision, and the server delivers it only while the question is
 * open and names the folder the agent was started in.
 */

export interface FolderTrustQuestion {
  /** The folder Claude names — shown in full on the decision surface only. */
  path: string
  selected: 'exit' | 'trust'
}

export interface WatchedSpawn {
  pid: number
  cwd: string
  status: 'starting' | 'running' | 'exited' | 'error'
  folderTrust: FolderTrustQuestion | null
  /** When Claude's trust question was first seen, in this browser's clock. */
  trustSince: string | null
  error: string | null
  answering: boolean
}

interface SpawnStatusBody {
  status?: string
  exitCode?: number | null
  stderr?: string
  awaitingFolderTrust?: FolderTrustQuestion | null
}

/** Status reads after Start before a quiet spawn stops being watched. */
const MAX_ATTEMPTS = 15

const spawns = ref(new Map<number, WatchedSpawn>())
const timers = new Map<number, ReturnType<typeof setTimeout>>()
const attempts = new Map<number, number>()
const focusedTrustPid = ref<number | null>(null)

function update(pid: number, patch: Partial<WatchedSpawn>): void {
  const current = spawns.value.get(pid)
  if (!current)
    return
  const next = new Map(spawns.value)
  next.set(pid, { ...current, ...patch })
  spawns.value = next
}

function stop(pid: number): void {
  const t = timers.get(pid)
  if (t)
    clearTimeout(t)
  timers.delete(pid)
}

function schedule(pid: number): void {
  stop(pid)
  timers.set(pid, setTimeout(() => void poll(pid), SPAWN_STATUS_POLL_MS))
}

async function poll(pid: number): Promise<void> {
  const spawn = spawns.value.get(pid)
  if (!spawn)
    return
  const n = (attempts.get(pid) ?? 0) + 1
  attempts.set(pid, n)
  let body: SpawnStatusBody | null = null
  try {
    const res = await fetch(`/api/agents/spawn/${pid}/status`)
    body = res.ok ? await res.json() as SpawnStatusBody : null
  }
  catch {
    body = null
  }

  if (body?.status === 'running') {
    const trust = body.awaitingFolderTrust ?? null
    update(pid, {
      status: 'running',
      folderTrust: trust,
      trustSince: trust ? (spawns.value.get(pid)?.trustSince ?? new Date().toISOString()) : null,
    })
    // Keep watching while Claude waits for the user; otherwise stop after the usual attempts.
    if (trust || n < MAX_ATTEMPTS)
      schedule(pid)
    else
      stop(pid)
    return
  }
  if (body?.status === 'exited' || body?.status === 'error') {
    // Interactive sessions yield no exit code; only a non-zero code is a failure.
    const failed = body.status === 'error' || (body.exitCode != null && body.exitCode !== 0)
    const stderr = body.stderr?.trim()
    update(pid, {
      status: body.status === 'error' ? 'error' : 'exited',
      folderTrust: null,
      trustSince: null,
      error: failed ? (stderr ? stderr.slice(-300) : `Agent exited with code ${body.exitCode ?? 'unknown'}`) : null,
    })
    stop(pid)
    return
  }
  // No answer this time: try again within the attempt budget.
  if (n < MAX_ATTEMPTS || spawn.folderTrust)
    schedule(pid)
  else
    stop(pid)
}

/** Starts watching a spawn the dialog just started. */
export function watchSpawn(pid: number, cwd: string): void {
  const next = new Map(spawns.value)
  next.set(pid, { pid, cwd, status: 'starting', folderTrust: null, trustSince: null, error: null, answering: false })
  spawns.value = next
  attempts.set(pid, 0)
  void poll(pid)
}

/** Forgets a spawn (its session has appeared, or the user dismissed it). */
export function forgetSpawn(pid: number): void {
  stop(pid)
  attempts.delete(pid)
  const next = new Map(spawns.value)
  next.delete(pid)
  spawns.value = next
  if (focusedTrustPid.value === pid)
    focusedTrustPid.value = null
}

/** Sends the user's answer to Claude's trust question. Never called without a user action. */
export async function answerFolderTrust(pid: number, decision: 'trust' | 'exit'): Promise<void> {
  update(pid, { answering: true, error: null })
  try {
    const res = await fetch(`/api/agents/spawn/${pid}/folder-trust`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => null) as { error?: string } | null
      throw new Error(body?.error ?? `HTTP ${res.status}`)
    }
    update(pid, { folderTrust: null, trustSince: null })
    attempts.set(pid, 0)
    schedule(pid)
  }
  catch (e) {
    update(pid, { error: e instanceof Error ? e.message : String(e) })
  }
  finally {
    update(pid, { answering: false })
  }
}

export function openFolderTrust(pid: number): void {
  focusedTrustPid.value = pid
}

export function closeFolderTrust(): void {
  focusedTrustPid.value = null
}

export function useSpawnWatch() {
  const list = computed(() => [...spawns.value.values()])
  return {
    spawns: list,
    awaitingTrust: computed(() => list.value.filter(s => s.folderTrust !== null)),
    focusedTrust: computed(() => focusedTrustPid.value === null ? null : spawns.value.get(focusedTrustPid.value) ?? null),
  }
}

/** Test seam. */
export function __resetSpawnWatch(): void {
  for (const pid of timers.keys())
    stop(pid)
  attempts.clear()
  spawns.value = new Map()
  focusedTrustPid.value = null
}
