# Architect readiness (pre-Architect assessment, 2026-09-16)

> Written during pre-Architect hardening. **No Architect or Project Manager role exists or is being built.** This
> records what the roadmap model already guarantees and what is missing before one could be introduced safely.

## The intended flow

```
owner → agreed roadmap → Architect → tasks → Developer → Reviewer → QA → verified result → roadmap proposal
```

The roadmap is the agreement between the owner and the Architect. An Architect may **propose** roadmap changes; it
must not rewrite the owner's agreed roadmap.

## What holds today (verified by reading the code, 2026-09-16)

| Guarantee | Where | Status |
| --- | --- | --- |
| Provenance is assigned by the server, never accepted from a request | `server/internal/roadmap/roadmap.go` (`ProvenanceUser` on every create/edit path) | VERIFIED |
| An imported proposal is always `suggested` — never `user`, never `verified` | `server/internal/roadmap/proposals.go` | VERIFIED |
| `verified` is computed, not stored as a claim: only an item linked to a pipeline task **of the same project**, whose status is read from that task | `roadmap.go` (`ProvenanceVerified` assigned while building the view) | VERIFIED |
| An agent cannot self-declare `verified` | no write path sets it; tests pin "an accepted guess is never verified" (`roadmap_test.go`) | VERIFIED |
| A proposal may only be imported from a dashboard-owned agent running inside the project's folders | `api/roadmap/handler.go` | VERIFIED |
| Nothing changes until the owner chooses Add / Replace / Reject | proposal review UI + import endpoints | VERIFIED |

**Do not change this invariant.** It is the whole basis on which a future Architect can be trusted with the roadmap:
the Architect can propose, and only the owner's action or a real pipeline task can move an item beyond "suggested".

## Missing prerequisites before an Architect could be introduced

1. **No agent identity for a role.** Agents are identified by session id plus presentation metadata (name, icon).
   There is no persisted "this agent acts as Architect" concept, and the main-agent designation added tonight
   (`agents.mainSessionId`) deliberately grants nothing — it is a label, not a role with authority.
2. **No saved agent configuration.** Permission mode and system prompt are launch-time arguments that nothing
   persists, so a role cannot yet carry its own standing instructions or posture across sessions. See
   `AD-2026-09-16-saved-agent-configuration` — this is an open owner decision, not a gap to be closed unilaterally.
3. **No proposal provenance per author.** A roadmap proposal records that it came from a dashboard-owned agent in the
   project, but not *which role* produced it. Architect proposals and Project Intelligence proposals would be
   indistinguishable in the review UI.
4. **No acceptance record on the roadmap itself.** "Agreed with the owner" is implicit in provenance `user`. A future
   Architect flow needs an explicit, auditable "the owner agreed to this phase, on this date" if the Architect is to
   reason about what it may and may not revisit.
5. **Task creation is manual.** Nothing links a roadmap item to "create the pipeline task for this", which is the
   step an Architect would own. The link exists in the other direction only (a task makes an item `verified`).

## What must not happen

- No autonomous roadmap mutation. A proposal is data until the owner acts on it.
- No widening of `verified`. It stays computed from a linked task of the same project.
- Main-agent or Architect status must never become a permission, an ownership bypass, or authority over other agents.
