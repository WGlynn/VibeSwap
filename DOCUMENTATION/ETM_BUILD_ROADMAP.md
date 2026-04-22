# ETM Build Roadmap

**Status**: Step 2 of 4 in the ETM Build Plan (Step 1 = [`ETM_ALIGNMENT_AUDIT.md`](./ETM_ALIGNMENT_AUDIT.md), complete).
**Primitive**: [`memory/primitive_economic-theory-of-mind.md`](../memory/primitive_economic-theory-of-mind.md)
**Directive**: Will, 2026-04-21 — *"we want to build toward this as a reality. asap."*

---

## Purpose

This roadmap translates the prioritized gap list from [`ETM_ALIGNMENT_AUDIT.md`](./ETM_ALIGNMENT_AUDIT.md) into concrete engineering cycles. Each row maps a cognitive-economy property from the [Economic Theory of Mind](./ECONOMIC_THEORY_OF_MIND.md) to a specific contract change, new primitive, test, or documentation artifact.

The audit returned:
- **16 MIRRORS** — mechanisms that already reflect cognitive-economic structure faithfully.
- **3 PARTIALLY MIRRORS** — mechanisms that reflect with distortion; candidates for refinement.
- **0 FAILS TO MIRROR** — no full-redesign gaps found.

This roadmap addresses the 3 partially-mirroring mechanisms and adds new work that strengthens already-mirroring ones.

---

## Framing

VibeSwap's thesis: the mind functions as an economy, and blockchain is the legible externalization of that pattern. For the externalization to be faithful, every mechanism must correspond to a cognitive-economic property. When correspondence is imperfect, either the mechanism refines or the theory does — but the divergence is load-bearing: it's where the design is wrong.

Roadmap prioritization:

1. **Closest-to-correspondence fixes first.** A mechanism that already mirrors 80% of the cognitive property is cheaper to bring to 95% than a mechanism at 40% is to bring to 80%. Concentrate on the narrowing gap.
2. **Substrate before ornament.** Fixes that land on the substrate layer (CKB state-rent, consensus weight function, Shapley distribution) propagate upward. Fixes on the ornament layer (UI, documentation, integrations) don't.
3. **Test-before-ship, always.** Every cycle ships with regression tests proving the mirror property. The test itself becomes the ETM-correspondence assertion in executable form.

---

## Priority queue — the 3 PARTIAL gaps

### Gap #1 — NCI weight function retention-cost asymmetry

**Audit classification**: PARTIALLY MIRRORS. The NCI weight function captures most of the cognitive retention-economy (contributions weighted by recency × attestation × liveness), but the retention-cost curve is linear where ETM predicts a convex (state-rent-like) shape.

**ETM source property**: CKB state-rent pays the cost of *keeping* a memory alive in proportion to how much attention-surface it currently occupies. Linear retention cost = flat utility curve; convex retention cost = attention-scarcity-matched.

**Fix**:
- Replace `NCI.retentionWeight(t) = base - k*t` with a convex function `base * (1 - (t/T)^alpha)` where `alpha > 1` (empirically tuned; paper §6.4 suggests α=1.6).
- Or: layer a second multiplicative term that scales with the contributor's currently-active-weight sum, so retention cost compounds when attention-surface is large.

**Deliverables**:
- `contracts/consensus/NakamotoConsensusInfinity.sol` — replace `retentionWeight` function + update the fee schedule.
- Regression tests — prove convexity + monotonic decay + alpha-sensitivity.
- `memory/primitive_convex-retention-cost.md` — extract as durable primitive.

**Estimated cycle**: 1 standard RSI cycle. Target: C40.

**Risk**: the alpha parameter is a tuning choice. Lean on [Augmented Mechanism Design](./AUGMENTED_MECHANISM_DESIGN.md) paper §6.4 values before asking Will.

---

### Gap #2 — Shapley distribution's time-indexed marginal

**Audit classification**: PARTIALLY MIRRORS. Shapley distributes batch surplus proportional to marginal contribution — the cognitive parallel is that insight is valued by its novelty (marginal increase in the knowledge set). The current implementation computes marginal purely within the batch; it doesn't weight by *time-indexed marginality* (was this insight novel to the ecosystem as a whole when it arrived, or was it already derivable?).

**ETM source property**: In cognition, an idea that arrives early has higher marginal value than the same idea arriving later — the second speaker gets less credit because the first already shifted the knowledge set. Batch-local Shapley loses this axis.

**Fix**:
- Extend `ShapleyDistributor.computeShare` with a `timeIndex` modifier that consults a snapshot of the knowledge-set's prior state at `sourceTimestamp`.
- Practically: weight by `(1 + earlinessBonus)` where `earlinessBonus = max(0, 1 - cumulativeSimilarContributions / saturationConstant)`.
- Similarity is computed off-chain and committed on-chain via the same evidence-hash pattern used in [Contribution Traceability](./CONTRIBUTION_TRACEABILITY.md).

**Deliverables**:
- `contracts/incentives/ShapleyDistributor.sol` — extend signature to accept time-indexed priors.
- `contracts/identity/ContributionAttestor.sol` — expose `getClaimsByContributorSince(contributor, since)` for the earliness computation.
- Off-chain component: a "similarity keeper" that commits hashes periodically. (This is the tool form of the Chat-to-DAG Traceability sweep; reuse the CI hook.)
- Regression tests — prove earliness monotonically reduces as similar contributions accumulate.
- `memory/primitive_time-indexed-marginal.md` — extract as durable primitive.

**Estimated cycle**: 2 RSI cycles (contract changes + off-chain keeper). Target: C41–C42.

**Risk**: off-chain similarity computation has trust boundary. Mitigate via commit-reveal of the similarity function itself, so the keeper can't retroactively tune to favor a contributor.

---

### Gap #3 — Circuit breaker / PoM feedback asymmetry

**Audit classification**: PARTIALLY MIRRORS. Circuit breakers trip on extreme volume/price/withdrawal — the cognitive parallel is the "flinch" response: when the system detects a signal exceeding normal bounds, it pauses to prevent runaway. The current implementation lacks a symmetric resume condition tied to PoM (Proof-of-Mind) re-certification.

**ETM source property**: After a flinch, cognition doesn't resume because time passed — it resumes because the observer re-evaluates and re-certifies safety. The current circuit-breaker auto-resumes after a cooldown window, which is a weaker version.

**Fix**:
- Add `CircuitBreaker.requireResumeAttestation(bytes32 claimId)` — resuming after a trip requires a PoM-weighted attestation from M-of-N governance-certified attestors.
- The cooldown window still exists as a floor (no resume before X seconds), but no ceiling — trip stays in place until attestation accumulates.
- Aligns circuit-breaker resume with [Augmented Governance](./AUGMENTED_GOVERNANCE.md)'s Physics > Constitution > Governance hierarchy: the Physics layer (breaker trip threshold) fires independent of governance; the resume step is a governance action gated by attestation weight.

**Deliverables**:
- `contracts/core/CircuitBreaker.sol` — add `requireResumeAttestation` path + tests.
- `memory/primitive_attested-resume.md` — extract.
- Documentation update to `CIRCUIT_BREAKER_DESIGN.md`.

**Estimated cycle**: 1 RSI cycle. Target: C43.

**Risk**: adds friction to incident recovery. Mitigate by setting the attestation threshold low (1-of-3 certified attestors) for first deployment, raising over time as attestor network matures.

---

## Strengthening already-mirroring mechanisms

These don't fix gaps — they deepen the correspondence where it already exists. Schedule interleaved with the priority-queue cycles.

### Strengthen #1 — Commit-Reveal Auction: add explicit "attention window" accounting

The 8-second commit + 2-second reveal window IS the attention span of the batch. Surface this as a named constant (`ATTENTION_WINDOW_COMMIT`, `ATTENTION_WINDOW_REVEAL`) tied to the ETM-framing, so future tunings are anchored to cognitive load data, not arbitrary numbers.

### Strengthen #2 — SoulboundIdentity: bind to PoM source-lineage

Issue on identity mint: the minted identity's metadata currently captures (address, mint timestamp). Add (source-lineage-hash) derived from the first attested contribution, so identity roots link into the ContributionDAG by design.

### Strengthen #3 — ContributionDAG bidirectional vouch → attention trade-off

The 1-day handshake cooldown models attention-rarity. Document this correspondence in `ContributionDAG.sol` NatSpec. Quantify via a short audit: what % of handshakes hit the cooldown floor? Data informs whether cooldown should be raised (more attention-scarce) or lowered (less).

---

## New primitive candidates

During audit writeup, three primitive candidates surfaced that don't yet exist in `memory/`:

1. **Attention-surface scaling** — mechanisms that scale rent/cost with how much shared-state they occupy. Generalizes the NCI fix.
2. **Time-indexed marginal credit** — generalizes the Shapley fix beyond economics into any credit-assignment setting.
3. **Attested resume** — any paused-state system that resumes via attestation-weight threshold rather than wall-clock timeout.

Extract these to `memory/primitive_*.md` as the respective cycles ship.

---

## Cycle budget and sequencing

| Cycle | Target | Scope | Expected ship |
|---|---|---|---|
| C40 | Gap #1 | Convex retention cost in NCI | 2026-04-23 |
| C41 | Gap #2a | Shapley signature extension + ContributionAttestor query | 2026-04-25 |
| C42 | Gap #2b | Off-chain similarity keeper + commit-reveal of function | 2026-04-28 |
| C43 | Gap #3 | Attested circuit-breaker resume | 2026-04-30 |
| C44 | Strengthen #1 | CRA attention-window NatSpec + tuning anchor | 2026-05-01 |
| C45+ | Strengthen #2, #3 | As bandwidth allows | ongoing |

This cadence assumes continued All-Out Mode. If funding event slots in before C42, C42 slips; the off-chain keeper is deferrable.

---

## Step 3 and Step 4 references

**Step 3** (Positioning rewrite) — addressed in the whitepaper + investor-summary refresh cycle, scheduled parallel to C40–C43. See `VIBESWAP_WHITEPAPER.md` and `INVESTOR_SUMMARY.md`.

**Step 4** (First concrete alignment fix) — Gap #1 (NCI convex retention) IS the first concrete fix. C40 is Step 4.

---

## How to use this document

- **If you're an engineer starting a cycle**: read the gap section → check the primitive cross-references → implement the deliverables in order → write the regression test that proves the mirror property → ship.
- **If you're reviewing**: the mirror property is the correctness criterion, not "it compiles". An implementation that compiles and tests green but doesn't prove the ETM correspondence is not done.
- **If you're external**: this is the transparent, read-anytime form of the engineering plan. It's intentionally specific so external contributors can pick up cycles. See [`CONTRIBUTION_TRACEABILITY.md`](./CONTRIBUTION_TRACEABILITY.md) for how external contributions earn DAG credit.

---

## One-line summary

*Translate the ETM alignment audit's 3 PARTIAL gaps into 4 concrete RSI cycles (C40–C43) that deepen the cognitive-economy → on-chain correspondence, shipping substrate-layer fixes before ornament-layer ones.*
