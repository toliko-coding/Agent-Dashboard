import type { MachineService } from '@/features/localscope'
import type { RuntimeSelf } from '@/sdk.generated'

/*
 * What authority the dashboard has over a service it can see.
 *
 * Runtime lists every listening port on the machine. Seeing a pid is not owning
 * a process, so this answers a narrower question than "can it be stopped": it
 * says what the dashboard actually knows about who a service belongs to, and
 * marks the ones that must never be offered as stoppable.
 *
 * WHAT OWNERSHIP WOULD REQUIRE, and why no tier here claims it. The dashboard
 * proves it owns an *agent* with a managed_agent row: this server launched that
 * process, and the row carries the session id it pinned and the pid it started
 * (a reused pid or a session later resumed elsewhere therefore does not match).
 * No equivalent record exists for a service, because nothing links a listening
 * port back to the agent that started it — a service's pid is the listening
 * process, an agent's is the CLI, and the link between them is not reported by
 * anything the dashboard reads. `agent-workspace` below is therefore
 * ATTRIBUTION (this service runs in the same checkout as an owned agent), which
 * is a useful thing to show and NOT a basis for controlling the process.
 *
 * So no tier is controllable today, and `controllable` is a literal false
 * rather than a field someone can flip per row: a Stop button needs a resource
 * identity the server can re-verify at the moment of the click, which is
 * exactly what does not exist yet.
 *
 * The two protected tiers are protected for different reasons, and both are
 * facts rather than labels:
 *   dashboard-server  the service's pid IS the server's pid
 *   dashboard-ui      it is the origin serving the page being viewed, or a dev
 *                     server in the server's own working directory
 * Stopping either kills the dashboard you are reading, so they are marked
 * before any control exists, not after.
 */

export type ServiceAuthority
  /** This process is the Agent Dashboard server. */
  = | 'dashboard-server'
    /** The dashboard's own user interface (the dev server serving this page). */
    | 'dashboard-ui'
    /** Runs in the same workspace as an agent the dashboard started. */
    | 'agent-workspace'
    /** Observed on this machine, with nothing tying it to the dashboard. */
    | 'external'

/** How good the evidence is. Never upgraded by a label or a port number. */
export type AuthorityEvidence = 'verified' | 'attributed' | 'none'

export interface ServiceClassification {
  authority: ServiceAuthority
  /** Short badge text. Empty for `external`, which needs no badge. */
  badge: string
  /** Stopping this would break the dashboard itself. */
  isProtected: boolean
  /**
   * Always false. No service has an ownership record the server could
   * re-verify, so nothing here may be offered as controllable.
   */
  controllable: false
  evidence: AuthorityEvidence
  /** One sentence for the details panel, in the user's terms. */
  reason: string
}

export interface AuthorityContext {
  /** The server's own identity, or null while it has not been read. */
  self: RuntimeSelf | null
  /** Workspace ids of agents this dashboard started. */
  ownedWorkspaceIds: ReadonlySet<string>
  /**
   * The port this page is being served from, when it is a loopback origin —
   * a service on it is what is serving the page, which the browser knows for
   * certain. Null when the page is not on a port (default 80/443) or unknown.
   */
  viewingPort: number | null
}

export function classifyService(
  service: MachineService,
  ctx: AuthorityContext,
): ServiceClassification {
  if (ctx.self && service.pid === ctx.self.pid) {
    return {
      authority: 'dashboard-server',
      badge: 'System · protected',
      isProtected: true,
      controllable: false,
      evidence: 'verified',
      reason: 'This is the Agent Dashboard server itself — the process answering this page.',
    }
  }

  if (ctx.viewingPort !== null && service.port === ctx.viewingPort) {
    return {
      authority: 'dashboard-ui',
      badge: 'System · protected',
      isProtected: true,
      controllable: false,
      evidence: 'verified',
      reason: 'This is the server delivering the page you are looking at.',
    }
  }

  // A development server in the dashboard's own working directory is the
  // dashboard's UI. Weaker than a pid match — another process could run there —
  // so it is marked protected but reported as inferred, never as verified.
  if (ctx.self?.cwd && service.cwd && service.cwd === ctx.self.cwd) {
    return {
      authority: 'dashboard-ui',
      badge: 'System · protected',
      isProtected: true,
      controllable: false,
      evidence: 'attributed',
      reason: 'Runs in the Agent Dashboard server\'s own working directory, so it is treated as part of the dashboard.',
    }
  }

  if (service.workspace && ctx.ownedWorkspaceIds.has(service.workspace.id)) {
    return {
      authority: 'agent-workspace',
      badge: 'Agent workspace',
      isProtected: false,
      controllable: false,
      evidence: 'attributed',
      reason: 'Runs in the same workspace as an agent Agent Dashboard started. That places it, but does not prove the dashboard started this service.',
    }
  }

  return {
    authority: 'external',
    badge: '',
    isProtected: false,
    controllable: false,
    evidence: 'none',
    reason: 'Observed on this machine. Nothing connects it to Agent Dashboard, so it is shown and not acted on.',
  }
}

/**
 * The page's own port, when it has one. `location.port` is empty on the default
 * port for the scheme, which is not a port this list would ever match.
 */
export function viewingPortOf(location: { port: string }): number | null {
  const port = Number.parseInt(location.port, 10)
  return Number.isInteger(port) && port > 0 ? port : null
}
