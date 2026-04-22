# Augmented Mechanism Design

**Status**: Methodology. Design philosophy + concrete examples.
**Audience**: First-encounter OK. Real VibeSwap instances with specific numbers.
**Primitive**: [`memory/feedback_augmented-mechanism-design-paper.md`](../memory/feedback_augmented-mechanism-design-paper.md)

---

## A small thought experiment

Imagine two approaches to front-running:

**Approach A — Replacement**: "We'll prevent front-running by having an admin decide the order of transactions. No one can front-run because the admin picks the order."

**Approach B — Augmentation**: "We'll prevent front-running by requiring all bids in a batch to clear at the same price. Mathematically, no one can front-run because everyone in the batch gets the same outcome."

Approach A solves the problem but introduces an admin. The admin is now a trust-point, a potential attack surface, and a centralization risk.

Approach B solves the problem without introducing a new trust-point. The math does the work; no admin required.

Both "work". But they're fundamentally different philosophies. Approach A is replacement — substitute a process (free-market ordering) with an intermediary (admin). Approach B is augmentation — add a constraint to free-market ordering that makes front-running impossible by construction.

Augmented Mechanism Design is the school of thought that consistently picks Approach B.

## The methodology, stated

Don't replace markets or governance. Augment them with math-enforced invariants that make fairness structural rather than discretionary.

- The market still functions — participants still act self-interestedly.
- The invariants are mathematical constraints — they can't be circumvented by operator discretion.
- Fairness emerges from the shape of the constraint, not from anyone being virtuous.

## Why this is different from "just add a rule"

The difference is where the enforcement lives:

**Rule-based enforcement**: "Bad behavior X is forbidden. Violators punished." Requires detection, judgment, and punishment. All discretionary.

**Invariant-based enforcement**: "Bad behavior X is mathematically impossible within the mechanism." Requires no detection; the math self-verifies.

Example. Suppose you want to prevent double-spending.

Rule-based: "If anyone double-spends, the admin catches them and slashes their stake."
Invariant-based: "Transactions must reference unspent outputs; spent outputs are removed from the set."

The invariant-based version doesn't need an admin. It doesn't need detection. Double-spending is mathematically impossible because the mechanism's state doesn't allow it.

Bitcoin implements the invariant-based version (UTXO). Some older financial systems implement the rule-based version (centralized ledger with fraud-detection). Bitcoin's invariant-based approach is substantially more trust-minimized.

## Four specific invariant types (with real examples)

Different mechanism problems need different invariant types.

### Type 1 — Structural Invariants

**What they are**: Properties that hold by the construction of the mechanism.

**VibeSwap example 1 — Uniform clearing price in batch auctions**:
- Every trade within a single batch executes at the same price.
- Mathematical consequence: if you're Alice in this batch, and Bob is in the same batch, neither of you can pay a different price than the other.
- Front-running via ordering is mathematically impossible within a batch.
- Implementation: `contracts/core/CommitRevealAuction.sol`.

**VibeSwap example 2 — Fisher-Yates shuffle of XORed secrets**:
- After all reveals, the batch ordering is determined by XOR of all users' secrets.
- Mathematical consequence: no one can predict the ordering before all reveals are in.
- No one can manipulate the ordering after reveal (it's deterministic from the combined secrets).

**Numerical cost**: adding these invariants costs roughly 30% more gas per swap vs. a naive DEX. Users pay slightly more for structural fairness.

### Type 2 — Economic Invariants

**What they are**: Properties held by cost asymmetries — breaking them is possible but unprofitable.

**VibeSwap example 1 — OperatorCellRegistry bond**:
- Each operator cell requires a 10e18 CKB bond.
- Claim N cells → stake N × 10e18 CKB.
- Mathematical consequence: Sybil-inflating cells-served-count requires proportional capital commitment.
- Bond sized (per `memory/feedback_augmented-mechanism-design-paper.md` §6.2) so sybil cost > sybil benefit.

**VibeSwap example 2 — Slashable stake for equivocation**:
- Validator equivocation → 50% of stake slashed + 75% of mind-score reset.
- Numerical example: validator with 100 VIBE stake + 1000 mind-score. Equivocate → lose 50 VIBE + 750 mind-score.
- Mathematical consequence: equivocation loses more than it could ever gain.

**Numerical sizing discipline**: all bond/slash ratios come from `memory/feedback_augmented-mechanism-design-paper.md` paper sections, not from tuning. Paper §6.1 = Temporal, §6.5 = Compensatory.

### Type 3 — Temporal Invariants

**What they are**: Properties held by time-lock constraints.

**VibeSwap example 1 — Commit-reveal window**:
- Commit phase: 8 seconds. Reveal phase: 2 seconds.
- Mathematical consequence: commitments bind before anyone can see any reveals. Can't strategically position commitments against revealed data.

**VibeSwap example 2 — Unbonding delay**:
- 7-day unbonding period for staked VIBE.
- Mathematical consequence: validators can't withdraw stake immediately before misbehavior. Withdrawal request triggers a slashable-window that covers the unbonding period.

**VibeSwap example 3 — Challenge window**:
- Claims in ContributionAttestor are `Pending` for 1 day (default TTL).
- Contested claims escalate; un-contested claims auto-accept after TTL.
- Mathematical consequence: permissionless detection with time-bounded adjudication.

### Type 4 — Verification Invariants

**What they are**: Properties held by cryptographic attestation.

**VibeSwap example 1 — EIP-712 signature binding**:
- Oracle messages signed with EIP-712, domain-separated by chain ID.
- Mathematical consequence: a signature valid on Ethereum is invalid on another chain (replay protection via fork-aware domain separator).
- Implementation: `TruePriceOracle.sol` post-C37.

**VibeSwap example 2 — Merkle proof of commitment**:
- When committing content (e.g., audit evidence), produce a Merkle proof.
- Mathematical consequence: any later verifier can re-verify the proof without trusting the committer.
- Used in: `IncrementalMerkleTree` for DAG vouch audit trail.

**VibeSwap example 3 — ZK-proof of computation** (V2+):
- Prove an off-chain computation is correct without re-executing on-chain.
- Mathematical consequence: trust-minimized delegation of expensive computation.
- Planned for: ZK-verified Shapley distribution (see [`ZK_ATTRIBUTION.md`](./ZK_ATTRIBUTION.md)).

## Real mechanisms combine invariant types

Most substantive mechanisms combine 2-4 invariant types. Examples:

### Commit-Reveal Batch Auction

Combines:
- **Structural**: uniform clearing price.
- **Temporal**: commit-before-reveal.
- **Verification**: signature-bound commitments.

Three invariant types working together. Removing any one weakens the mechanism.

### OperatorCellRegistry

Combines:
- **Economic**: 10e18 CKB bond per cell.
- **Temporal**: 30-minute response window for availability challenges.
- **Verification**: Merkle-proof of content availability (V2b).

Three invariant types protecting the cell registry from inflation attacks.

### ClawbackCascade

Combines:
- **Structural**: topological propagation of taint.
- **Economic**: stake bond for flagging (anti-spam).
- **Temporal**: 7-day contest window.
- **Verification**: evidence-hash commitments.

Four invariant types providing property-graph-propagation semantics.

## The paper as parameter authority

For every concrete parameter, the paper at `memory/feedback_augmented-mechanism-design-paper.md` is the source. Do NOT invent numbers; look them up.

| Parameter | Paper section | VibeSwap value |
|---|---|---|
| Operator cell bond | §6.1 (Temporal) | 10e18 CKB |
| Response window | §6.1 | 30 min |
| Challenge cooldown | §6.1 | 24 hr |
| Slash / slashPool split | §6.5 (Compensatory) | 50 / 50 |
| Challenger payout | §6.5 | 50% of slashed |
| Min bond per cell | §6.2 | 1e18 CKB |
| Unbonding delay | §7.3 | 7 days |
| Contest window | §7.4 | 7 days |
| Claim TTL | §5.2 | 1 day |

If a parameter isn't in the paper, derive it from first principles (cost-asymmetry sizing) before inventing.

## The approach, applied

When designing a new mechanism:

### Step 1 — State the property you want

Concrete: "Prevent validators from claiming more cells than they can actually serve."

### Step 2 — Identify which invariant types enforce it

- Is it structural (holds by the construction of the mechanism)? No — validators could in principle claim whatever they want.
- Is it economic (cost asymmetry)? Yes — charge a bond per claim.
- Is it temporal (time-lock)? Somewhat — response window after claim.
- Is it verification (cryptographic)? Yes — Merkle-proof of content availability.

### Step 3 — Compose

Combine 2+ invariant types for defense-in-depth:
- Economic bond prices-out pure Sybil attacks.
- Temporal challenge window gives attesters time to verify.
- Verification Merkle-proofs ensure the attester can prove their claim when challenged.

Result: `OperatorCellRegistry` with cells + bonds + challenges + Merkle proofs.

### Step 4 — Size the parameters

Use paper values for bond (10e18 CKB), challenge window (30 min), etc. Don't invent.

### Step 5 — Triad-check

Run [`CORRESPONDENCE_TRIAD.md`](./CORRESPONDENCE_TRIAD.md) on the resulting design.

### Step 6 — Ship with regression tests

Each invariant gets a test asserting it holds. The test is the executable form of the fairness claim.

## The deeper philosophy

Augmented Mechanism Design stakes a position: markets and governance are valuable; don't replace them. Add constraints that make them fair.

This contrasts with a common crypto pattern: when the market misbehaves, replace it with a protocol. When governance misbehaves, replace it with a protocol. When anything misbehaves, replace it with a protocol.

The replace-with-protocol approach usually produces:
- New operators that become trust-points.
- New failure modes where the operator fails.
- New governance captures where operators influence the protocol.
- New attack surfaces.

Augmentation avoids these because the market/governance continues to function. The added invariants are constraints, not substitutions.

## The relationship to ETM

Under [Economic Theory of Mind](./ECONOMIC_THEORY_OF_MIND.md), the cognitive economy runs without needing administrators. Ideas compete; good ones accumulate credit; bad ones get discounted. No one decides centrally which ideas win — the cognitive substrate's invariants decide.

Augmented Mechanism Design applies this same pattern to on-chain systems. The market is the cognitive-economic process. Invariants are the structural properties that keep it honest. No administrator needed.

## For students

Exercise: pick a common problem in DeFi (impermanent loss, slippage on large trades, oracle manipulation, governance capture). Design an augmentation for it:

1. State the property you want to preserve.
2. Identify the invariant types.
3. Combine 2+ types.
4. Check with the Correspondence Triad.

Compare your design to VibeSwap's approach. Where does yours differ? Why?

This exercise, applied to real problems, teaches the methodology.

## One-line summary

*Augment markets and governance with math-enforced invariants (structural, economic, temporal, verification) that make fairness structural rather than discretionary — never replace them with operators. Four invariant types, combined 2-4 at a time, sized from the paper's canonical values. Real mechanisms (commit-reveal auction, OperatorCellRegistry, ClawbackCascade) compose multiple types.*
