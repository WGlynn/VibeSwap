# Disintermediation Grades — 2026-04 Update

**Status**: Monthly reassessment.
**Audience**: First-encounter OK. Parent context provided.
**Parent doc**: [Disintermediation Grades](./DISINTERMEDIATION_GRADES.md) (Faraday1, March 2026).

---

## What this doc is doing

Disintermediation Grades (parent doc, March 2026) established a 6-grade scale measuring protocol sovereignty — from Grade 0 (fully intermediated) to Grade 5 (pure peer-to-peer).

Grades aren't static. They change as mechanisms ship, audits complete, invariants harden. A snapshot in March describes March; current state may differ.

This doc captures the deltas from March → April 2026. Monthly cadence is the plan going forward.

**Why monthly?** Keeps the Cincinnatus Test ("if Will disappeared tomorrow, does this still work?") quantitative rather than aspirational. Surfaces regressions (mechanism changes that inadvertently add intermediation). Provides accountability to external reviewers.

Too frequent = measurement overhead. Too rare = slow drifts accumulate.

## The 6-grade scale (reminder)

- **Grade 0**: Fully intermediated. Every interaction requires trusted third party.
- **Grade 1**: Mostly intermediated. Some peer paths exist but default is intermediated.
- **Grade 2**: Partially intermediated. Mixed paths; intermediaries optional.
- **Grade 3**: Mostly peer-to-peer. Intermediaries rare, serve specific functions.
- **Grade 4**: Almost pure P2P. Intermediaries for unusual edge cases or off-chain bridges only.
- **Grade 5**: Pure peer-to-peer. No intermediation point exists.

Target: all VibeSwap interactions at Grade 4 or higher.

## Changes since March 2026

Five specific changes affected grades.

### Change 1 — ETM Alignment Audit Step 1 (2026-04-21)

Audited 19 mechanisms against Economic Theory of Mind. Result: 16 MIRRORS / 3 PARTIALLY MIRRORS / 0 FAILS.

**Grade impact**: neutral. Audit increases legibility without changing underlying intermediation.

**Monitoring item from this**: Gap #3 from the audit (circuit-breaker resume attestation) — must be designed with permissionless attestor selection to preserve Grade 4.

### Change 2 — C39 FAT-AUDIT-2 Oracle Aggregation (2026-04-21)

New `OracleAggregationCRA.sol` + TPO integration. Replaces TPO's 5% deviation gate with commit-reveal aggregation.

**Grade impact**: **POSITIVE**. Oracle feed moved from Grade 3 (single oracle with deviation-gate intermediator) to Grade 4 (commit-reveal aggregation from multiple sources).

**Residual**: aggregator committee still finite. Pure Grade 5 would be permissionless oracle-participation. Queued for future.

### Change 3 — Chat-to-DAG Traceability (2026-04-22)

`DOCUMENTATION/CONTRIBUTION_TRACEABILITY.md` + `.github/ISSUE_TEMPLATE/*` + `scripts/mint-attestation.sh` + `.github/workflows/dag-attribution-sweep.yml`.

**Grade impact**: **NEUTRAL-TO-POSITIVE**. Infrastructure itself is process (off-chain tooling). On-chain impact was already possible; Traceability formalizes and systematizes.

**Positive effect**: with canonical Source fields, external-contributor attribution becomes routable on-chain. Previously external contributors were de facto intermediated through the core team. Now attribution via canonical loop; core-team gatekeeping reduces.

External-attribution grade: **Grade 2-3 → 3-4** (core-team gatekept → canonical loop, partially automated).

### Change 4 — Admin Event Observability Sweep

~22 contracts, ~50 setters now emit `XUpdated(prev, next)` events.

**Grade impact**: **POSITIVE**. Admin intermediation (parameter changes affecting user flows) becomes immediately legible off-chain. Dashboard watchers alert on any change; users can set trigger-conditions reacting to admin changes before their next transaction.

Admin-parameter state: **Grade 3 (admin-trusted) → Grade 4 (admin-auditable-in-real-time)**.

Not yet Grade 5 — governance still holds setter-keys; full permissionless governance of setters is future.

### Change 5 — 30 new foundational docs (2026-04-22)

Set of docs this file is part of. Not a mechanism change; a legibility improvement.

**Grade impact**: **NEUTRAL**. Docs make existing intermediation patterns inspectable. Don't create or remove intermediation — do make visible for audit.

## Cumulative April 2026 delta

Summary table:

| Mechanism / Interaction | March Grade | April Grade | Change |
|---|---|---|---|
| Oracle feed (via OracleAggregationCRA) | 3 | 4 | +1 |
| External attribution (via Traceability) | 2-3 | 3-4 | +0.5 avg |
| Admin-setter observability | 3 | 4 | +1 |
| Core ETM-compliant mechanisms | 4 | 4 | — |
| Cincinnatus-test-critical mechanisms | various | various | net +0.5 |

**Overall: average grade moved up ~+0.5 across the measurable surface.** Not a phase transition but continuous progress.

## What blocks movement to Grade 5

Four specific blocks remain:

### Block 1 — Contract upgrade authority

Most VibeSwap contracts UUPS-upgradeable. Upgrade authority typically `owner()` → specific admin address.

Full Grade 5 requires:
- Permissionless governance of upgrades.
- Time-locked execution.
- Constitutional axioms non-upgradeable.

Current: governance-gated proposals but admin-keyed execution. Target: timelock + governance-approval-required + constitutional-axiom protection.

### Block 2 — Oracle operator set

`OracleAggregationCRA` relies on finite aggregator set. Grade 5 allows any staker to participate.

Current: whitelisted. Target: permissionless with stake-and-slash.

### Block 3 — Chat-to-DAG minting key

`scripts/mint-attestation.sh` requires `MINTER_PRIVATE_KEY`. Currently single key held by core team.

Grade 5: permissionless minting by contributor themselves (with appropriate stake) OR automated minting via CI (no human key).

### Block 4 — Frontend access

Users reach VibeSwap via `frontend-jade-five-87.vercel.app`. Vercel is single hosting intermediary.

Grade 5: IPFS-hosted frontend, or fully-on-chain frontend. Deferred — deployment architecture choice, not mechanism issue.

## The Cincinnatus Test update

"If Will disappeared tomorrow, does this still work?"

**March 2026**: partial. Core contracts functioning; governance could continue with some drift risk. Oracle + admin concerns.

**April 2026**: stronger partial. Oracle improved. Admin setters auditable. External attribution routable without core-team gatekeeping. Still imperfect; moving in right direction.

**Projected endpoint**: full pass by end of Q4 2026 if 1-2 Grade-increasing changes per month maintained.

## Next-month targets

For May 2026 update:

1. **Ship ETM Build Roadmap Gap #1** (NCI convex retention) — no grade impact but improves mechanism quality.
2. **Ship Gap #3** (attested circuit-breaker resume) WITH permissionless attestor selection — moves circuit breaker from Grade 3 to Grade 4.
3. **Start frontend IPFS experiment** — proof-of-concept for Grade 5 frontend.
4. **Permissionless oracle aggregator expansion** — allow any validator with sufficient stake to aggregate.

Cumulative effect: another +0.5 average by May 2026.

## Why monthly cadence matters

Protocol intermediation state changes slowly but measurably. Monthly updates:

- Keep Cincinnatus Test quantitative.
- Surface regressions (mechanism changes inadvertently adding intermediation).
- Provide accountability to external reviewers.

A regression would look like: "Change 5 moved X from Grade 4 to Grade 3." Monthly cadence catches this promptly.

## Relationship to external audits

Third-party security auditors typically don't measure disintermediation (they focus on code correctness). Separate disintermediation-focused audit would be useful — quarterly cadence, external reviewer.

Queued as: Q3 2026 external review of disintermediation state against the Grading scale.

## For students / reviewers

Exercise: apply the Grading scale to a DeFi protocol you know.

1. Pick a protocol.
2. Identify its main interactions (trading, lending, governance).
3. For each, assess: what grade?
4. What would move it +1 grade?
5. What blocks Grade 5?

Compare to VibeSwap's April 2026 table.

## One-line summary

*April 2026 update to Faraday1's March 2026 DISINTERMEDIATION_GRADES.md. Average grade +~0.5 across measurable surface: FAT-AUDIT-2 oracle work moved feed 3→4, admin-event sweep moved state 3→4, Chat-to-DAG moved external attribution 2-3→3-4. Four blocks remaining before Grade 5: upgrade authority, oracle operators, minting key, frontend hosting. Cincinnatus Test trajectory: full pass projected Q4 2026.*
