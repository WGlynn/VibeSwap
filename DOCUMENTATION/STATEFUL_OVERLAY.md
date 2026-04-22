# Stateful Overlay

**Status**: Architectural pattern. Umbrella for externalized idempotent state.
**Primitive**: [`memory/primitive_stateful-overlay.md`](../memory/primitive_stateful-overlay.md)
**Related instances**: [API Death Shield](./API_DEATH_SHIELD.md), [Session State Commit Gate](./SESSION_STATE_COMMIT_GATE.md) (workflow), SHIELD-PERSIST-LEAK (privacy boundary).

---

## The pattern

Every substrate has gaps. Each gap admits an externalized idempotent overlay that closes the gap without modifying the substrate.

- **Substrate**: the system with the gap. Could be an LLM, a web application, a smart contract, a workflow.
- **Gap**: a property the substrate doesn't provide natively — persistence across failure, atomic commit, crash recovery, privacy enforcement, attribution.
- **Overlay**: a layer that adds the missing property by externalizing state and applying it idempotently.
- **Idempotent**: running the overlay twice produces the same result as running it once. Required because the overlay must survive partial failure, retry, and repeated application.

## Why externalized

The overlay can't be part of the substrate because the substrate is the thing with the gap. If it could fix itself, the gap wouldn't exist. The overlay lives outside the substrate and uses the substrate's normal inputs/outputs to close the gap.

Examples:
- **LLM substrate has no persistent memory** → externalize memory to a file system, apply idempotently on each prompt.
- **LLM API can die mid-session** → externalize state checkpoints; on reconnect, the overlay restores from checkpoint. See [`API_DEATH_SHIELD.md`](./API_DEATH_SHIELD.md).
- **LLM may push work-in-progress to a git remote with sensitive content** → externalize a pre-commit scanner that idempotently redacts. SHIELD-PERSIST-LEAK.
- **LLM's working context is small** → externalize a protocol chain (CLAUDE.md → SESSION_STATE.md → WAL.md) that reloads the relevant context on each session.
- **Smart-contract storage lacks natural timestamping** → externalize a timestamp commitment via evidence-hash construction. See [`CONTRIBUTION_TRACEABILITY.md`](./CONTRIBUTION_TRACEABILITY.md).
- **Admin parameter changes are invisible off-chain** → externalize via `XUpdated(prev, next)` events. See [`ADMIN_EVENT_OBSERVABILITY.md`](./ADMIN_EVENT_OBSERVABILITY.md).

## Structural properties

An overlay is an overlay (as opposed to a wrapper or a middleware) iff it satisfies:

1. **External state**: the state the overlay depends on lives outside the substrate. A file, a separate contract, a different process.
2. **Idempotent application**: applying it N times = applying it once. Crash-safe.
3. **Read-through, write-through**: the substrate sees the overlay's effects but doesn't know about the overlay. The overlay intercepts at a boundary (pre-tool, post-tool, pre-commit, on-read) and does its work without changing the substrate's internal logic.
4. **Failure-independent**: if the overlay breaks, the substrate still functions (possibly with degraded guarantees). If the substrate breaks, the overlay can be re-applied on a fresh substrate instance.

Patterns that satisfy all 4 are overlays. Patterns that don't are wrappers, middlewares, or alternative substrates.

## The meta-principle

The existence of a gap in a substrate *implies* the existence of an overlay pattern that can close it. Finding the overlay is a matter of:

1. Naming the gap precisely.
2. Identifying where in the substrate's input/output boundary the gap surfaces.
3. Designing the smallest externalized state that, applied idempotently at that boundary, closes the gap.

Most overlays are small. The API Death Shield is a few hundred lines. The admin-event observability sweep adds one event per setter. The SHIELD-PERSIST-LEAK root-fix is a 2-layer defense where each layer is ~50 LOC. Complexity comes from *identifying* the right gap, not from the overlay itself.

## VibeSwap overlay catalog

| Gap | Substrate | Overlay |
|---|---|---|
| LLM session can die from API error mid-work | Claude API | API Death Shield — client-side state hook persists to disk before every API call |
| Content dumps of conversation state can leak into git | Claude workflow | SHIELD-PERSIST-LEAK — pre-commit NDA scanner |
| Session state doesn't survive reboot | Claude context | SESSION_STATE.md + WAL.md write-through protocol |
| Admin parameter changes are invisible | Smart contracts | `XUpdated(prev, next)` events on every setter |
| Oracle manipulation possible via price-staleness | TWAP oracle | Commit-reveal oracle aggregation (C39 FAT-AUDIT-2) |
| Contributions outside git are invisible to the DAG | GitHub + chain | Chat-to-DAG Traceability loop |
| Phone ping when run finishes | Claude Code | PostToolUse hook → Google Calendar event |
| Mind state not decentralized | Home machine | Tier 1-5 persistence stack |

Every row is a gap + overlay pair. Each overlay is small. The architectural choice — to overlay rather than modify — is what makes the collection tractable.

## Relationship to other primitives

- **Parent**: [Universal-Coverage → Hook (Density Principle)](../memory/primitive_universal-coverage-hook.md) — any rule requiring universal firing maps to the hook layer. Hooks are a specific overlay mechanism (at the tool-call boundary).
- **Example instances**: [API Death Shield](./API_DEATH_SHIELD.md), [Admin Event Observability](./ADMIN_EVENT_OBSERVABILITY.md), [Contribution Traceability](./CONTRIBUTION_TRACEABILITY.md).
- **Meta**: [Economic Theory of Mind](./ECONOMIC_THEORY_OF_MIND.md) — ETM's on-chain externalization is itself an overlay pattern applied to cognition. The chain is external, idempotent, intercepts at the action boundary. It's the grandest overlay in the stack.

## How to apply

When you hit a gap:

1. Name it precisely. ("LLM may lose context on compression" — not "LLM is flaky.")
2. Find the substrate boundary where it surfaces. (Token-count threshold.)
3. Design the smallest externalized state that closes it. (Pre-compression, write SESSION_STATE block with current work.)
4. Make it idempotent. (Writing the same block twice = writing once.)
5. Wire at the boundary with a hook. ([Always = Gate](../memory/primitive_always-equals-gate.md) — "always X" → hook.)

Don't modify the substrate. That path rarely works in LLM work and rarely wants to work at the smart-contract layer either (upgrades are costly; new deployments are cleaner).

## One-line summary

*Every substrate-level gap admits an externalized, idempotent overlay that closes it without modifying the substrate — find the overlay, don't fight the substrate.*
