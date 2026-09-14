import { computed, ref } from 'vue'
import { SPAWN_STATUS_POLL_MS } from '../utils/sse'

/*
 * What the New Agent dialog shows about a spawn it just started, and the
 * user's answers to Claude's folder trust question (3M, 3M.1).
 *
 * Whether Claude is waiting at its trust question is NOT decided here. The
 * server derives it on every scan and sends it to every browser in the agents
 * stream (useAgents().pendingFolderTrust), so it survives a reload, reaches a
 * second tab, and outlives this module. This module only:
 *
 *   - reads a spawn's status for a bounded number of attempts after Start, to
 *     report a failed launch or an exit — the poll the dialog always had;
 *   - sends a trust answer the user chose, and keeps that request's
 *     in-flight state and error for the decision surface.
 */

export interface WatchedSpawn {
  pid: number
  cwd: string
  status: 'starting' | 'running' | 'exited' | 'error'
  error: string | null
}

export interface TrustAnswerState {
  answering: boolean
  error: string | null
}

interface SpawnStatusBody {
  status?: string
  exitCode?: number | null
  stderr?: string
}

/** Status reads after Start (or after an answer) before a spawn stops being watched. */
const MAX_ATTEMPTS = 15
const IDLE_ANSWER: TrustAnswerState = { answering: false, error: null }

const spawns = ref(new Map<number, WatchedSpawn>())
const answers = ref(new Map<number, TrustAnswerState>())
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

function setAnswer(pid: number, state: TrustAnswerState): void {
  const next = new Map(answers.value)
  next.set(pid, state)
  answers.value = next
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
  if (!spawns.value.has(pid))
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

  if (body?.status === 'exited' || body?.status === 'error') {
    // Interactive sessions yield no exit code; only a non-zero code is a failure.
    const failed = body.status === 'error' || (body.exitCode != null && body.exitCode !== 0)
    const stderr = body.stderr?.trim()
    update(pid, {
      status: body.status === 'error' ? 'error' : 'exited',
      error: failed ? (stderr ? stderr.slice(-300) : `Agent exited with code ${body.exitCode ?? 'unknown'}`) : null,
    })
    stop(pid)
    return
  }
  if (body?.status === 'running')
    update(pid, { status: 'running' })
  if (n < MAX_ATTEMPTS)
    schedule(pid)
  else
    stop(pid)
}

function restart(pid: number): void {
  if (!spawns.value.has(pid))
    return
  attempts.set(pid, 0)
  schedule(pid)
}

/** Starts watching a spawn the dialog just started. */
export function watchSpawn(pid: number, cwd: string): void {
  const next = new Map(spawns.value)
  next.set(pid, { pid, cwd, status: 'starting', error: null })
  spawns.value = next
  attempts.set(pid, 0)
  void poll(pid)
}

/** Forgets a spawn. */
export function forgetSpawn(pid: number): void {
  stop(pid)
  attempts.delete(pid)
  const next = new Map(spawns.value)
  next.delete(pid)
  spawns.value = next
  if (focusedTrustPid.value === pid)
    focusedTrustPid.value = null
}

/**
 * Sends the user's answer to Claude's trust question. Never called without a
 * user action. The pending question disappears when the server's next scan no
 * longer finds it — not because this request succeeded.
 */
export async function answerFolderTrust(pid: number, decision: 'trust' | 'exit'): Promise<void> {
  setAnswer(pid, { answering: true, error: null })
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
    setAnswer(pid, IDLE_ANSWER)
    // Report what Claude does next (continues, or exits on "No, exit").
    restart(pid)
  }
  catch (e) {
    setAnswer(pid, { answering: false, error: e instanceof Error ? e.message : String(e) })
  }
}

export function openFolderTrust(pid: number): void {
  focusedTrustPid.value = pid
}

export function closeFolderTrust(): void {
  focusedTrustPid.value = null
}

export function useSpawnWatch() {
  return {
    spawns: computed(() => [...spawns.value.values()]),
    focusedTrustPid: computed(() => focusedTrustPid.value),
    answerStateFor: (pid: number): TrustAnswerState => answers.value.get(pid) ?? IDLE_ANSWER,
  }
}

/** Test seam. */
export function __resetSpawnWatch(): void {
  for (const pid of timers.keys())
    stop(pid)
  attempts.clear()
  spawns.value = new Map()
  answers.value = new Map()
  focusedTrustPid.value = null
}
