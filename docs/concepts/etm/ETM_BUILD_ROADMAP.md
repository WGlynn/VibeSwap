# ETM Build Roadmap

**Status**: Step 2 of 4 in the ETM Build Plan. Step 1 ([`ETM_ALIGNMENT_AUDIT.md`](./ETM_ALIGNMENT_AUDIT.md)) complete.
**Audience**: First-encounter OK. Each gap-fix walked end-to-end with before/during/after states.
**Directive**: Will, 2026-04-21 — *"we want to build toward this as a reality. asap."*

---

## Why a roadmap exists

Step 1 of the ETM plan audited VibeSwap's mechanisms against ETM. Each mechanism got classified: MIRRORS (faithful), PARTIALLY MIRRORS (distorted), or FAILS TO MIRROR (misaligned).

Initial audit results:
- **16 MIRRORS** — mechanisms that already reflect cognitive-economic structure faithfully. No action needed.
- **3 PARTIALLY MIRRORS** — mechanisms that reflect with distortion. Refinement needed.
- **0 FAILS TO MIRROR** — no full-redesign gaps.

Original 3 PARTIAL gaps (NCI retention, Shapley time-indexed marginal, attested circuit-breaker resume) are addressed by C40-C43 below.

**Reconciliation note (2026-04-30)**: the audit was reconciled against shipped contract state and Section 7 was rewritten as a 6-item prioritized forward-gap list. Two new gaps (Gap 5 — Clawback bonded contest; Gap 6 — C43 default-on flip) were surfaced. The Audit-Section-7 ↔ Cycle cross-reference appears under the Cycle Budget table below.

This doc is the roadmap for: (1) the original 3 PARTIAL gaps, (2) the strengthening track on already-mirroring mechanisms, and (3) the new audit-Section-7 forward queue.

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

**Cycle C41-C42 (C41 shipped 2026-04-23, C42 shipped 2026-05-01)**:

- **Before**: `ShapleyDistributor.computeShare()` uses permutation-averaged Shapley only.
- **Shipped (C41, 2026-04-23)**: novelty multiplier primitive — per-game, per-participant, BPS-scaled, applied at `computeShapleyValues` weight step. Owner-setter for similarity scores at this stage (placeholder for keeper).
- **Shipped (C42, 2026-05-01)**: similarity keeper commit-reveal — replaces owner-setter with attested-keeper commit-reveal flow. Keeper commits `hash(scores || salt)`, reveals after delay, then writes scores. Same primitive shape as CRA (4th invocation of commit-reveal pattern in the codebase).
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

**Shipped (C45, 2026-05-01)**: source-lineage hash captured at mint, exposed via getter, immutable after mint. Mint surface now requires lineage-hash input from the caller (typically the first attested-contribution claim id). Identity roots are structurally bound to the DAG from genesis.

### Strengthen #3 — ContributionDAG Handshake Cooldown Audit

The 1-day handshake cooldown models attention-rarity. Worth auditing: what percentage of handshakes hit the cooldown floor? Data informs whether cooldown should be raised (more rare) or lowered (less rare).

## New primitive candidates

Five primitive candidates have surfaced across the original audit and the 2026-04-30 reconciliation:

1. **Attention-surface scaling** — mechanisms that scale rent/cost with shared-state occupancy. Generalizes the NCI fix and the audit-Gap-1 LP-rent direction.
2. **Time-indexed marginal credit** — generalizes the Shapley fix beyond economics into any credit-assignment setting.
3. **Attested resume** — paused-state systems that resume via attestation-weight, not wall-clock timeout. Maturing toward load-bearing via C39 default-on flip.
4. **Bonded permissionless contest** *(new, from audit Gap 5)* — adversarial on-chain challenge geometry where any party can post a bond to contest an authority decision within a fixed window before execution; mirrors OCR V2a permissionless-challenge geometry, applied here to the value-clawback domain. Generalizable to any authority-vote-then-execute pipeline.
5. **Default-on structural augmentation** *(new, from audit Gap 6)* — pattern where a structural-augmentation mechanism is shipped as opt-in for backwards-compat, then promoted to default-on after attestor/keeper bootstrapping. Surfaces the "augmentation is dormant until default-on" failure mode as a checklist item for any future opt-in augmentation.

Extract to `memory/primitive_*.md` as respective cycles ship.

## Cycle budget and sequencing

| Cycle | Status | Scope |
|---|---|---|
| C40a | SHIPPED 2026-04-23 | Roadmap Gap #1 — Pure `calculateRetentionWeight` primitive on NCI (α=1.6) |
| C40b | SHIPPED 2026-04-23 | Roadmap Gap #1 — Retention wired into `vote()` weight accumulation (PoW+PoM decays, PoS untouched; single call site; threshold unchanged) |
| C40c | PENDING | Roadmap Gap #1 — Governance-tunable α in [1.2, 1.8] (ships when a real tuning need appears) |
| C41 | SHIPPED 2026-04-23 | Roadmap Gap #2a — Shapley novelty multiplier primitive (per-game, per-participant, BPS-scaled; applied at computeShapleyValues weight step) |
| C42 | SHIPPED 2026-05-01 | Roadmap Gap #2b — Similarity keeper + commit-reveal (replaces owner setter with attested keeper). 4th invocation of commit-reveal pattern. |
| C43 | SHIPPED 2026-04-23 | Roadmap Gap #3 — Attested circuit-breaker resume (opt-in per-breaker; cooldown floor + M-of-N attestor gate) |
| C44 | SHIPPED 2026-04-23 | Strengthen #1 — CRA attention-window NatSpec + alias constants + tripwire test |
| C45 | SHIPPED 2026-05-01 | Strengthen #2 — SoulboundIdentity source-lineage binding (lineage-hash at mint, immutable, exposed via getter; ties identity roots to ContributionDAG) |
| C39 | PENDING | Audit-Section-7 Gap 6 — C43 attested-resume **default-on flip** for high-stake breakers (`LOSS_BREAKER`, `TRUE_PRICE_BREAKER`) + initial certified attestor bootstrap (M=2). Cost: **S** (1 cycle). Activates structural augmentation currently dormant in production. *Being shipped in parallel by another agent.* |
| C46+ | PENDING | Audit-Section-7 Gap 5 — Clawback Cascade **bonded contest path**. Permissionless `contest(caseId, wallet, evidence, bond)` on `ClawbackRegistry`; bond at-risk during fixed contest window before `executeClawback` may fire; FederatedConsensus remains dispute-resolution oracle but must engage with on-chain evidence on math-enforced timeline. Mirrors OCR V2a permissionless-challenge geometry. Cost: **M** (2 cycles). |
| Strengthen track | rolling | Strengthen #3 (handshake-cooldown audit) + primitive extractions (`primitive_attested-resume.md`, `primitive_attention-surface-scaling.md`, `primitive_time-indexed-marginal-credit.md`) — interleaved with cycle work above |

Estimated total: gaps + strengthens currently in flight (C39, C46+, Strengthen track) ship in ~1.5 weeks. Audit-Section-7 forward-queue (Gaps 1/2/3, plus Gap 4 conditional) adds 8-11 cycles (~3-4 weeks) per the audit's recommended `Gap 6 → Gap 2 → Gap 1` sequence; Gaps 3 and 4 sequence behind based on mainnet runtime data.

### Gap List Sync — Audit Section 7 ↔ Build Roadmap Cycles

The audit's Section 7 prioritized gap list (post-reconciliation, 2026-04-30) sequences six forward gaps. Two of them (Gap 5, Gap 6) are NEW — surfaced during reconciliation and not present in the original 3-PARTIAL-gap audit. Cross-reference with cycles below. Note: the build roadmap's original "Gap #1 / #2 / #3" labels predate the reconciled audit. To avoid confusion this section uses the audit's Section 7 numbering.

| Audit S7 Gap | Leverage | Cost | Build Roadmap Cycle | Status |
|---|---|---|---|---|
| 1 — VibeAMM LP positions rent-free | HIGH | M (2-3) | (forward queue, audit recommends after Gap 2) | PENDING — not yet slotted into cycle ledger |
| 2 — TPO 5% deviation gate | MED-HIGH | S-M (1-2) | (forward queue, audit recommends after Gap 6) | PENDING — not yet slotted into cycle ledger |
| 3 — Circuit breakers / TWAP policy thresholds | MED | M (2-3) | (forward queue, mainnet-data-conditional) | PENDING — not yet slotted into cycle ledger |
| 4 — IL Protection Vault re-eval | LOW-MED | S-M (conditional) | (deferred, depends on Gap 1 + mainnet IL-claim data) | DEFER |
| 5 — Clawback Cascade bonded contest | MED | M (2) | **C46+** | PENDING |
| 6 — C43 attested-resume default-on for high-stake breakers | LOW-MED | S (1) | **C39** | PENDING (parallel) |

Mapping note for the **roadmap's** original PARTIAL gaps (now reconciled-as-shipped):
- Roadmap Gap #1 (NCI convex retention) → C40a/b SHIPPED, C40c PENDING
- Roadmap Gap #2 (Shapley time-indexed marginal) → C41/C42 SHIPPED
- Roadmap Gap #3 (attested circuit-breaker resume) → C43 SHIPPED *(opt-in only — Audit Gap 6 / C39 closes the default-on residual)*

C39 is the audit-recommended Step-4 opener (cheap + activates dormant augmentation). The audit-recommended sequence after C39 is `Gap 2 → Gap 1`, which translates to additional new cycles to be slotted as those gaps reach the head of the queue.

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

*Step 2 of 4 in ETM Build Plan — original 3 PARTIAL gaps addressed (convex NCI retention C40 SHIPPED, time-indexed Shapley C41/C42 SHIPPED, attested circuit-breaker resume C43 SHIPPED, Strengthen #1 C44 + #2 C45 SHIPPED). 2026-04-30 audit reconciliation surfaced 6-item forward gap-list (Section 7); C39 (Gap 6 default-on flip, S) and C46+ (Gap 5 Clawback bonded contest, M) now in queue. Each cycle walked before/during/after with concrete numbers and mechanism references. First concrete alignment fix was C40 — deployed convex retention matches cognitive substrate's α=1.6.*
