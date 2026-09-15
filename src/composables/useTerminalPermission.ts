import { ref } from 'vue'
import { toast } from '@/composables/useToast'

/*
 * Approve once / Deny on Claude Code's own terminal permission prompt (Phase 4).
 *
 * The server re-reads the session's screen and refuses unless the prompt the
 * user saw is still the one open (promptId), the session is one Agent Dashboard
 * started, and the decision maps to that prompt's own options. Approve once is
 * only that request: never "don't ask again", never auto mode.
 */
export type PermissionDecision = 'approve_once' | 'deny'

const REFUSALS: Record<string, string> = {
  stale: 'The permission prompt changed. Review the current one.',
  answered: 'That permission prompt was already answered.',
  no_prompt: 'No permission prompt is open any more.',
  terminal_only: 'This prompt can only be answered in the terminal.',
  in_progress: 'A decision for this agent is already being applied.',
}

// How long an answered prompt stays disabled on this client.
const SETTLE_MS = 10_000

// One record for the whole tab: Needs you and the agent workspace show the same
// prompt, and a decision taken in one disables both.
const decided = ref<Record<string, PermissionDecision>>({})

function forget(promptId: string): void {
  const next = { ...decided.value }
  delete next[promptId]
  decided.value = next
}

export function useTerminalPermissionDecision() {
  function decisionFor(promptId: string | null | undefined): PermissionDecision | null {
    return promptId ? decided.value[promptId] ?? null : null
  }

  async function decide(pid: number, promptId: string, decision: PermissionDecision): Promise<boolean> {
    if (decided.value[promptId])
      return false
    decided.value = { ...decided.value, [promptId]: decision }
    try {
      const res = await fetch(`/api/agents/${pid}/terminal-permission`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promptId, decision }),
      })
      const body = await res.json().catch(() => ({})) as { error?: string, reason?: string }
      if (res.ok) {
        toast.success(decision === 'approve_once' ? 'Approved once' : 'Denied')
        // The answered prompt leaves the stream within a scan; after that the
        // same command asked again is a new decision.
        setTimeout(forget, SETTLE_MS, promptId)
        return true
      }
      // An answered prompt stays disabled; anything else can be looked at again.
      if (body.reason !== 'answered')
        forget(promptId)
      toast.error(REFUSALS[body.reason ?? ''] ?? body.error ?? `Could not apply the decision (HTTP ${res.status})`)
      return false
    }
    catch (e) {
      forget(promptId)
      toast.error(`Could not apply the decision: ${e instanceof Error ? e.message : String(e)}`)
      return false
    }
  }

  return { decide, decisionFor }
}
