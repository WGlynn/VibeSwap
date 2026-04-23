# ETM Build Roadmap

**Status**: Step 2 of 4 in the ETM Build Plan. Step 1 ([`ETM_ALIGNMENT_AUDIT.md`](./ETM_ALIGNMENT_AUDIT.md)) complete.
**Audience**: First-encounter OK. Each gap-fix walked end-to-end with before/during/after states.
**Directive**: Will, 2026-04-21 — *"we want to build toward this as a reality. asap."*

---

## Why a roadmap exists

Step 1 of the ETM plan audited VibeSwap's mechanisms against ETM. Each mechanism got classified: MIRRORS (faithful), PARTIALLY MIRRORS (distorted), or FAILS TO MIRROR (misaligned).

Results:
- **16 MIRRORS** — mechanisms that already reflect cognitive-economic structure faithfully. No action needed.
- **3 PARTIALLY MIRRORS** — mechanisms that reflect with distortion. Refinement needed.
- **0 FAILS TO MIRROR** — no full-redesign gaps.

This doc is the roadmap for addressing those 3 PARTIAL gaps + strengthening already-mirroring mechanisms.

## What makes a gap worth fixing

A PARTIAL gap means a mechanism is "mostly right, slightly wrong." Fixing it brings it closer to the cognitive-economic property it's supposed to mirror. The protocol becomes more ETM-aligned.

Small gaps are real. A mechanism that 90% mirrors the correct property can still cause 10% distortion — which compounds over time across many users. Fixing even small gaps is worth cycles.

## Gap #1 — NCI Convex Retention

### What the gap IS (reconciled 2026-04-23)

**Reconciliation note**: earlier drafts asserted NCI currently uses LINEAR decay `base - k × t`. Verification against `contracts/consensus/NakamotoConsensusInfinity.sol` shows no time-decay is implemented — `cumulativePoW` is monotone-cumulative, `mindScore` is refresh-on-demand. The real gap is: retention is ABSENT on the work-and-mind pillars.

Cognitive retention decays CONVEXLY:

```
retentionWeight(t) = base × (1 - (t/T)^α)
```

with α ≈ 1.6 (Ebbinghaus + modern replications).

Retention applies to PoW and PoM only. PoS stake is present-tense locked capital, not historical record, so no decay.

### Why this matters

**Before (linear)**:
- Contributor's mindScore decays at fixed rate.
- No phase transition ("knee") where decay accelerates.
- Medium-term contributions over-preserved; long-term contributions decay too slowly.

**Concrete numeric impact** (per [`COGNITIVE_RENT_ECONOMICS.md`](./COGNITIVE_RENT_ECONOMICS.md)):
- Day 1: 1000 × (1 - 1/365) ≈ 997.3
- Day 30: 1000 × (1 - 30/365) ≈ 917.8
- Day 180: 1000 × (1 - 180/365) ≈ 506.8
- Day 365: 0

**After (convex, α=1.6)**:
- Day 1: 1000 × (1 - (1/365)^1.6) ≈ 999.98
- Day 30: 1000 × (1 - (30/365)^1.6) ≈ 986
- Day 180: 1000 × (1 - (180/365)^1.6) ≈ 662
- Day 365: 0

Convex is more lenient to recent contributions (986 vs 918 at day 30; 662 vs 507 at day 180) and more decisive at end (both hit 0 by day 365 but convex accelerates toward the end).

### The cycle

**Cycle C40 (shipped 2026-04-23)**:

- **Before**: no retention primitive on NCI. Zero time-decay applied to PoW or PoM.
- **Shipped (C40a)**: pure function `calculateRetentionWeight(elapsedSec, horizonSec) → weightBps` on NCI, α=1.6 hardcoded via cubic polynomial approximation `0.1744·x + 1.116·x² − 0.2904·x³`. Max error ~3% vs exact `x^1.6` on [0, 1]. +8 regression tests covering endpoint behavior, monotonicity, convexity, and the four doc-specified reference points (day 1 / 30 / 180 / 365).
- **Deferred (C40b)**: wiring into `_recalculateWeights`. Six design decisions blocking integration — decay anchor, per-pillar timestamp storage, query-time vs persisted, horizon T, `totalActiveWeight` O(1) interaction, validator migration path.
- **Deferred (C40c)**: governance-tunable α in [1.2, 1.8]. Ships when a real tuning need appears; polynomial is swapped for general-α formulation.

**Actual effort**: 1 session for C40a. C40b estimated 1-2 sessions once design decisions are taken.

### Risk

α = 1.6 is paper-§6.4-sourced. Deviation risks:
- α < 1 (concave): decays too slowly initially, too fast later. Wrong shape.
- α > 2: decays too slowly — contributions persist longer than they should.

Governance can tune α, but within bounded ranges [1.2, 1.8]. No arbitrary values allowed.

## Gap #2 — Shapley Time-Indexed Marginal

### What the gap IS

[Shapley distribution](./SHAPLEY_REWARD_SYSTEM.md) computes marginal contribution purely within each batch. Doesn't weight by *time-indexed marginality* (was this insight novel to the ecosystem when it arrived, or already derivable from priors?).

### Why this matters

Per [`THE_NOVELTY_BONUS_THEOREM.md`](./THE_NOVELTY_BONUS_THEOREM.md): plain Shapley is permutation-symmetric and provably under-rewards novelty.

**Before (plain Shapley)**:
- Alice publishes first. Bob publishes 6 months later with similar content.
- Plain Shapley gives them equal credit.
- Alice's priority is uncompensated.

**After (Novelty Bonus)**:
- Alice: 2.0x multiplier for high novelty.
- Bob: 1.3x multiplier for moderate novelty.
- Carol (replicates 2 years later): 0.7x multiplier for low novelty.

Rewards shift toward originators. Replications still credited (Lawson Floor) but less.

### The cycle

**Cycle C41-C42 (target 2026-04-25 to 04-28)**:

- **Before**: `ShapleyDistributor.computeShare()` uses permutation-averaged Shapley only.
- **During (C41)**: extend signature to accept `priorContext: bytes32` representing the knowledge-set at the contribution's time. Modify Shapley to weight by similarity to prior-state.
- **During (C42)**: implement off-chain similarity-keeper. Commits similarity scores on-chain via commit-reveal.
- **After**: Shapley rewards incorporate novelty multipliers. Similarity function is commit-reveal-protected from retroactive tuning.

**Deliverables**:
- `contracts/incentives/ShapleyDistributor.sol` — extended signature.
- `contracts/identity/ContributionAttestor.sol` — expose `getClaimsByContributorSince(contributor, since)` for similarity computation.
- Off-chain keeper in `scripts/similarity-keeper.py`.
- Regression tests proving novelty-correlation holds.

**Estimated effort**: 2 RSI cycles.

### Risk

Off-chain similarity computation has trust boundary. Mitigation: commit-reveal of the similarity function itself, so the keeper can't retroactively tune to favor specific contributors.

Residual risk: similarity function itself could have biases not detected by commit-reveal. Monitor.

## Gap #3 — Attested Circuit-Breaker Resume

### What the gap IS

Circuit breakers trip on extreme volume/price/withdrawal. The cognitive parallel is the flinch response. Current implementation lacks a symmetric resume condition tied to PoM re-certification.

### Why this matters

**Before**:
- Circuit breaker trips.
- Fixed cooldown period (e.g., 1 hour) passes.
- Trading auto-resumes.

After cooldown, trading resumes even if underlying condition hasn't changed. Trips can recur in rapid succession if system remains stressed.

**After**:
- Circuit breaker trips.
- Cooldown floor (minimum 1 hour) passes — no resume before this.
- BUT no automatic resume either.
- Resuming requires M-of-N attestation from governance-certified attestors.
- Attestors evaluate whether the stress condition is actually resolved.

Cognitive parallel: after a "flinch," you don't auto-relax at a timer. You re-evaluate: "is the situation safe now?" Only on safety-confirmation do you relax.

### The cycle

**Cycle C43 (target 2026-04-30)**:

- **Before**: `CircuitBreaker` auto-resumes after cooldown.
- **During**: add `requireResumeAttestation(bytes32 claimId)` path. Resume requires a valid claim with attestation weight from M-of-N certified attestors. Cooldown floor unchanged; ceiling removed.
- **After**: automatic cooldown is a floor; attestation is the resume gate.

**Deliverables**:
- `contracts/core/CircuitBreaker.sol` — `requireResumeAttestation` function + tests.
- Primitive extracted: `memory/primitive_attested-resume.md`.
- Documentation update to `CIRCUIT_BREAKER_DESIGN.md`.

**Estimated effort**: 1 RSI cycle.

### Risk

Attestors could be slow to respond, extending resume latency. Mitigation: attestation threshold is low (1-of-3 certified attestors) for first deployment. Can raise over time as attestor pool matures.

## Strengthening already-mirroring mechanisms

These aren't fixes; they deepen alignment where it already exists.

### Strengthen #1 — CRA Attention-Window Naming

[Commit-reveal auction](./TRUE_PRICE_ORACLE_DEEP_DIVE.md) uses 8-second commit + 2-second reveal = 10 seconds. Why 10 and not 15 or 5? Because the human+bot substrate has a ~10-second characteristic attention-time.

Action: surface this via `ATTENTION_WINDOW_COMMIT = 8` + `ATTENTION_WINDOW_REVEAL = 2` constants in the contract. NatSpec documents the cognitive-economic rationale.

Benefit: future engineers tuning these constants see the rationale, reject arbitrary changes.

### Strengthen #2 — SoulboundIdentity Source-Lineage Binding

Identity mint currently captures (address, mint timestamp). Add (source-lineage-hash) — derived from the first attested contribution. This ties identity roots into the ContributionDAG by design.

### Strengthen #3 — ContributionDAG Handshake Cooldown Audit

The 1-day handshake cooldown models attention-rarity. Worth auditing: what percentage of handshakes hit the cooldown floor? Data informs whether cooldown should be raised (more rare) or lowered (less rare).

## New primitive candidates

Three primitive candidates surfaced during audit:

1. **Attention-surface scaling** — mechanisms that scale rent/cost with shared-state occupancy. Generalizes the NCI fix.
2. **Time-indexed marginal credit** — generalizes the Shapley fix beyond economics into any credit-assignment setting.
3. **Attested resume** — paused-state systems that resume via attestation-weight, not wall-clock timeout.

Extract to `memory/primitive_*.md` as respective cycles ship.

## Cycle budget and sequencing

| Cycle | Status | Scope |
|---|---|---|
| C40a | SHIPPED 2026-04-23 | Gap #1 — Pure `calculateRetentionWeight` primitive on NCI (α=1.6) |
| C40b | SHIPPED 2026-04-23 | Gap #1 — Retention wired into `vote()` weight accumulation (PoW+PoM decays, PoS untouched; single call site; threshold unchanged) |
| C40c | PENDING | Gap #1 — Governance-tunable α in [1.2, 1.8] (ships when a real tuning need appears) |
| C41 | SHIPPED 2026-04-23 | Gap #2a — Shapley novelty multiplier primitive (per-game, per-participant, BPS-scaled; applied at computeShapleyValues weight step) |
| C42 | PENDING | Gap #2b — Similarity keeper + commit-reveal (replaces owner setter with attested keeper) |
| C43 | SHIPPED 2026-04-23 | Gap #3 — Attested circuit-breaker resume (opt-in per-breaker; cooldown floor + M-of-N attestor gate) |
| C44 | 2026-05-01 | Strengthen #1 — CRA attention-window NatSpec |
| C45+ | ongoing | Strengthen #2, #3 + primitive extractions |

Estimated total: 1 week for gaps, 2 weeks with strengthens.

## Step 3 and Step 4 references

The original ETM plan had 4 steps:

- **Step 1**: ETM Alignment Audit (complete — [`ETM_ALIGNMENT_AUDIT.md`](./ETM_ALIGNMENT_AUDIT.md)).
- **Step 2**: Build Roadmap (this doc).
- **Step 3**: Positioning rewrite — update whitepaper + investor summary to reframe from "DEX + AI" to "cognitive economy externalized." Parallel to C40-C43.
- **Step 4**: First concrete alignment fix — Gap #1 (NCI convex retention) IS this. C40.

## What this document is for

It's a work plan. Specific deliverables mapped to specific cycles with specific dates.

It's NOT a vision doc (that's [`THE_COGNITIVE_ECONOMY_THESIS.md`](./THE_COGNITIVE_ECONOMY_THESIS.md) and [`ECONOMIC_THEORY_OF_MIND.md`](./ECONOMIC_THEORY_OF_MIND.md)).

When you're ready to ship, look here for the next target. When you want to understand WHY we ship, look at the vision docs.

## For engineers

If you're starting a cycle:

1. Read the gap section for the relevant gap.
2. Check primitive cross-references.
3. Implement the deliverables.
4. Write the regression test that proves the ETM mirror property.
5. Ship.

The mirror property is the correctness criterion, not just "it compiles." A test that asserts "α=1.6 convex retention produces the expected curve" is the correctness proof.

## For external contributors

If you're external, these cycles are plausibly-accessible. The Gap #1 fix is ~50 LOC change + tests. A contributor with Solidity experience could ship it.

See [`CONTRIBUTION_TRACEABILITY.md`](./CONTRIBUTION_TRACEABILITY.md) for how external contributions earn DAG credit.

## Relationship to other primitives

- **Feeds into**: [`ETM_ALIGNMENT_AUDIT.md`](./ETM_ALIGNMENT_AUDIT.md) — Step 1.
- **Feeds from**: [`COGNITIVE_RENT_ECONOMICS.md`](./COGNITIVE_RENT_ECONOMICS.md) (Gap #1), [`THE_NOVELTY_BONUS_THEOREM.md`](./THE_NOVELTY_BONUS_THEOREM.md) (Gap #2).
- **Delivers to**: production codebase (contracts/consensus/, contracts/core/, contracts/incentives/).

## One-line summary

*Step 2 of 4 in ETM Build Plan — addresses 3 PARTIAL gaps found in Step 1 audit (convex NCI retention C40, time-indexed Shapley C41-C42, attested circuit-breaker resume C43). Each cycle walked before/during/after with concrete numbers and mechanism references. Budget ~1 week for gaps + 2 weeks with strengthens. First concrete alignment fix is C40 — deployed convex retention function matches cognitive substrate's α=1.6.*
