# Disintermediation Grades — 2026-04 Update

**Status**: Monthly reassessment of protocol disintermediation state.
**Parent doc**: [Disintermediation Grades](./DISINTERMEDIATION_GRADES.md) (Faraday1, March 2026).
**This document**: Updates the grades to reflect state as of 2026-04-22, after ETM Alignment Audit Step 1, C39 FAT-AUDIT-2 oracle work, and Chat-to-DAG Traceability infrastructure.

---

## Why a monthly update

Disintermediation Grades are time-varying. Protocol state changes as mechanisms ship, audits complete, and invariants harden. A snapshot in March 2026 describes March's state; the current state may be meaningfully different.

The Cincinnatus Test — "if Will disappeared tomorrow, does this still work?" — is the endpoint. Every cycle should move grades upward, not sideways.

This update measures the deltas from March → April 2026.

## Reminder — the 6-grade scale

- **Grade 0** — Fully intermediated. Every interaction requires a trusted third party.
- **Grade 1** — Mostly intermediated. Some peer-to-peer paths exist but the default is intermediated.
- **Grade 2** — Partially intermediated. Mixed paths; intermediaries are optional.
- **Grade 3** — Mostly peer-to-peer. Intermediaries are rare, serve specific functions.
- **Grade 4** — Almost pure P2P. Intermediaries exist only for unusual edge cases or off-chain bridges.
- **Grade 5** — Pure peer-to-peer. No intermediation point exists.

Target: all VibeSwap interactions at Grade 4 or higher. Grade 5 wherever achievable.

## Changes since March 2026

### Change 1 — ETM Alignment Audit Step 1 (2026-04-21)

Audited 19 mechanisms against Economic Theory of Mind. Result: 16 MIRRORS / 3 PARTIALLY MIRRORS / 0 FAILS.

**Grade impact**: neutral. Audit documentation increases legibility but doesn't change the underlying intermediation state. However, the 3 PARTIALLY-MIRRORS findings ([ETM Build Roadmap](./ETM_BUILD_ROADMAP.md) Gaps 1-3) identify mechanisms where intermediation subtly persists:
- Gap #1 — NCI retention weight is linear (should be convex) — no intermediation impact per se but concentration risk.
- Gap #2 — Shapley time-indexed marginal missing — does not affect intermediation directly.
- Gap #3 — Circuit breaker resume uses time cooldown (should use attestation-weight resume) — ADDS intermediation if the resume attestation goes through governance-gated attestors. Monitor.

**New monitoring item**: if Gap #3 is fixed by adding an attestation requirement that must be signed by a small set of gated attestors, that's new intermediation. Must design for Grade-4-compatible resume (permissionless attestor selection).

### Change 2 — C39 FAT-AUDIT-2 Oracle Aggregation (2026-04-21)

New `OracleAggregationCRA.sol` + TPO integration. Replaces TPO's 5% deviation gate with commit-reveal aggregation.

**Grade impact**: POSITIVE. Moves oracle feed from Grade 3 (single oracle with deviation-gate intermediator) to Grade 4 (commit-reveal aggregation from multiple sources, no single operator required).

Residual: the aggregator committee is still a finite set of operators. Pure Grade 5 would be permissionless oracle-participation. Queued for future cycle.

### Change 3 — Chat-to-DAG Traceability Infrastructure (2026-04-22)

`DOCUMENTATION/CONTRIBUTION_TRACEABILITY.md` + `.github/ISSUE_TEMPLATE/*` + `scripts/mint-attestation.sh` + `.github/workflows/dag-attribution-sweep.yml`.

**Grade impact**: NEUTRAL-TO-POSITIVE. The infrastructure itself is process (off-chain tooling). The on-chain impact — claims entering `ContributionAttestor` — was already possible; Traceability formalizes and systematizes it.

Positive effect: with canonical Source fields, attribution from external sources (dialogue, non-code) becomes routable on-chain. Previously external contributors were de facto intermediated through the core team (who decided whose contributions counted). Now attribution happens via the canonical loop; core-team's intermediation role reduces.

From Grade 2-3 (core-team gatekept external attribution) → Grade 3-4 (canonical loop, partially automated).

### Change 4 — Admin Event Observability Sweep

~22 contracts, ~50 setters now emit `XUpdated(prev, next)` events.

**Grade impact**: POSITIVE. Admin intermediation (parameter changes that could affect user flows) becomes immediately legible off-chain. Dashboard watchers can alert on any change; users can set trigger-conditions that react to admin changes before their next transaction.

Moves admin-parameter state from "admin-trusted" (Grade 3) to "admin-auditable-in-real-time" (Grade 4). Not yet Grade 5 because governance still holds the setter-keys; full permissionless governance of setters is a future cycle.

### Change 5 — 30 new foundational docs (2026-04-22)

The set of docs this file is part of. Not a mechanism change; a legibility improvement.

**Grade impact**: NEUTRAL. Docs make existing intermediation patterns inspectable. Don't create or remove intermediation — do make it visible for audit.

## Cumulative April 2026 delta

| Mechanism / Interaction | March Grade | April Grade | Change |
|---|---|---|---|
| Oracle feed (via OracleAggregationCRA) | 3 | 4 | +1 |
| External attribution (via Traceability) | 2-3 | 3-4 | +0.5 avg |
| Admin-setter observability | 3 | 4 | +1 |
| Core ETM-compliant mechanisms | 4 | 4 | — |
| Cincinnatus-test-critical mechanisms | various | various | net +0.5 |

Overall: average grade moved up roughly +0.5 points across the measurable surface. Not a phase transition but continuous progress.

## What blocks movement to Grade 5

### Block 1 — Contract upgrade authority

Most VibeSwap contracts are UUPS-upgradeable. Upgrade authority is typically `owner()` → a specific admin address.

Full Grade 5 requires:
- Permissionless governance of upgrades (any token-holder can propose).
- Time-locked execution (upgrades don't fire immediately).
- Constitutional axioms that are NOT upgradeable (P-000, P-001).

Current state: governance-gated upgrade proposals but still with admin-keyed execution. Move toward: timelock + governance-approval-required + constitutional axiom protection.

### Block 2 — Oracle operator set

OracleAggregationCRA still relies on a finite aggregator set. Fully Grade 5 would allow any staker to participate as aggregator.

Current: whitelisted aggregators. Target: permissionless with stake-and-slash (any validator can aggregate; misbehavior slashed).

### Block 3 — Chat-to-DAG minting key

`scripts/mint-attestation.sh` requires a `MINTER_PRIVATE_KEY` for the on-chain mint. Currently a single key held by core team.

Grade 5 would have: permissionless minting by the contributor themselves (with appropriate stake) OR automated minting via CI post-merge (no human key required). Queued for V2.

### Block 4 — Front-end access

Users currently reach VibeSwap via `frontend-jade-five-87.vercel.app`. Vercel is a single hosting intermediary.

Grade 5: IPFS-hosted frontend, or fully-on-chain frontend (e.g., via Optimistic-zk-frontend). Deferred — not a mechanism-design issue, a deployment architecture choice.

## The Cincinnatus Test update

"If Will disappeared tomorrow, does this still work?"

March 2026 answer: **partial**. Core contracts functioning; governance could continue but with some drift risk. Oracle and admin-setter concerns.

April 2026 answer: **stronger partial**. Oracle improved (FAT-AUDIT-2), admin setters auditable. External attribution routable via Traceability without core-team gatekeeping. Still imperfect but moving in the right direction.

Projected endpoint: **full pass by end of Q4 2026** if continued cadence of 1-2 Grade-increasing changes per month.

## Next-month targets

For May 2026 update:
1. **Ship ETM Build Roadmap Gap #1** (NCI convex retention) — no grade impact but improves mechanism quality.
2. **Ship Gap #3** (attested circuit-breaker resume) WITH permissionless attestor selection — moves circuit breaker from Grade 3 to Grade 4.
3. **Start frontend IPFS experiment** — proof-of-concept for Grade 5 frontend.
4. **Permissionless oracle aggregator expansion** — allow any validator with sufficient stake to become aggregator.

Each advances specific interactions' grades. Cumulative effect: another +0.5 average by May 2026.

## Why monthly cadence

Protocol intermediation state changes slowly but measurably. Monthly updates:
- Keep the Cincinnatus Test quantitative (not aspirational).
- Surface regressions (a mechanism change that inadvertently added intermediation).
- Provide accountability to external reviewers.

Too frequent → measurement overhead exceeds value. Too rare → slow changes accumulate to regressions before noticed.

## Relationship to external audits

Third-party security auditors typically don't measure disintermediation grades (they focus on code correctness). A separate disintermediation-focused audit would be useful — quarterly cadence, external reviewer.

Queued as: Q3 2026 external review of disintermediation state against the Grading scale.

## One-line summary

*April 2026 update: average disintermediation grade moved up ~+0.5 since March, driven by FAT-AUDIT-2 oracle work + admin-event observability sweep + Chat-to-DAG Traceability. Four specific blocks remain on the path to Grade 5 (upgrade authority, oracle operators, minting key, frontend hosting); Cincinnatus Test trajectory toward full pass by Q4 2026.*
