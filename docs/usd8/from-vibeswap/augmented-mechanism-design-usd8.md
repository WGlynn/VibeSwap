# Augmented Mechanism Design — for USD8

**Status**: methodology supplement. Adapted for USD8 from the VibeSwap canonical treatment at `DOCUMENTATION/AUGMENTED_MECHANISM_DESIGN.md`.
**Audience**: USD8 protocol team. First-encounter OK. Concrete USD8 examples; no AMM background assumed.
**Purpose**: name the design philosophy underneath USD8's existing copy, map it to four specific invariant types with USD8 examples, and give the team a checklist for designing future mechanisms in the same register.

---

## A small thought experiment

Imagine two approaches to an unfair coverage payout.

**Approach A — Replacement**: "We'll prevent unfair payouts by appointing a claims committee that decides who deserves what. No one can be unfairly paid because the committee adjudicates."

**Approach B — Augmentation**: "We'll prevent unfair payouts by computing each claimant's share from a published Cover Score formula that anyone can verify. Mathematically, no one can receive a different share than the formula assigns."

Approach A solves the problem but introduces a committee. The committee is now a trust-point, a potential attack surface, and a centralization risk. Compromise the committee, capture the protocol.

Approach B solves the problem without introducing a new trust-point. The math does the work; no committee required. There is no actor whose capture would compromise the result.

Both "work." But they're fundamentally different philosophies. Approach A is replacement — substitute a process (peer-to-peer claim resolution) with an intermediary (committee). Approach B is augmentation — add a constraint to the process that makes unfair payouts impossible by construction.

Augmented Mechanism Design is the school of thought that consistently picks Approach B. USD8's existing architecture already operates from this stance — the Cover Score is computed, not adjudicated; coverage is permissionless, not approved; the Cover Pool is a market, not a charity. This document names the methodology so it can be applied deliberately to future design choices.

---

## The methodology, stated

Don't replace markets or governance. Augment them with math-enforced invariants that make fairness structural rather than discretionary.

- The market still functions — participants still act self-interestedly.
- The invariants are mathematical constraints — they can't be circumvented by operator discretion.
- Fairness emerges from the shape of the constraint, not from anyone being virtuous.

For an insurance protocol, this is the load-bearing distinction between USD8 and the legacy insurance industry. Legacy insurance is replacement: the underwriter decides what to cover, the adjuster decides what to pay, the regulator decides who can sell policies. Each of these intermediaries is a trust-point and a capture surface. USD8 is augmentation, with role boundaries between three distinct actors: **governance** (Layer 3) decides what's covered (the partner-protocol whitelist) bounded by Layer 2 (Constitution) solvency invariants; the **formula** (Layer 1, Physics) decides what each affected holder is paid (by Cover Score); the **chain** decides who can participate (by the absence of any permissioning surface — holders are admitted automatically by holding USD8). The market still functions — capital still flows to whoever provides the most useful coverage; claims still settle to whoever is most provably entitled — but the unfair-rent extraction the legacy industry depends on is mathematically impossible.

---

## Why this is different from "just add a rule"

The difference is where the enforcement lives.

**Rule-based enforcement**: "Bad behavior X is forbidden. Violators punished." Requires detection, judgment, and punishment. All discretionary.

**Invariant-based enforcement**: "Bad behavior X is mathematically impossible within the mechanism." Requires no detection; the math self-verifies.

Example. Suppose you want to prevent a holder from claiming the same loss twice.

Rule-based: "If a holder claims a loss twice, the team detects it via off-chain monitoring and reverses the payout."

Invariant-based: "Each covered LP token can only be transferred to the Cover Pool once; after transfer, it is held by the protocol and cannot be re-tendered."

The invariant-based version doesn't need monitoring. It doesn't need detection. Double-claiming is mathematically impossible because the mechanism's state doesn't allow it.

USD8's existing copy already gestures at this — the Cover Pool "accepts the specified LP token for claims at any time, permissionlessly." The reason that sentence is defensible is that the underlying state machine makes the permissionless acceptance safe. The invariant is doing the work; the prose just describes the consequence.

---

## Four specific invariant types (with USD8 examples)

Different mechanism problems need different invariant types. The four below are the standard taxonomy. Most substantive USD8 mechanisms combine two to four of them.

### Type 1 — Structural Invariants

**What they are**: properties that hold by the construction of the mechanism.

**USD8 example 1 — Uniform Cover Score formula across claimants**:
- Every claimant's payout fraction is computed from the same Cover Score formula applied to the same Cover Pool composition.
- Mathematical consequence: two claimants with identical usage histories receive identical payouts. There is no way for the protocol to favor one over the other; the formula does not include any field that distinguishes between them.
- Front-running via claim ordering is structurally impossible — the formula doesn't read claim ordering.

**USD8 example 2 — Pro-rata payout from Cover Pool composition**:
- Claimants receive a proportional mix of assets matching the Cover Pool's composition.
- Mathematical consequence: there is no choice about which assets a claimant receives; the choice is removed from the protocol entirely.
- Privileged access to the most desirable assets in the pool is structurally impossible — the protocol cannot favor anyone.

### Type 2 — Economic Invariants

**What they are**: properties held by cost asymmetries — breaking them is possible but unprofitable.

**USD8 example 1 — Cover Pool 14-day withdrawal cooldown**:
- LPs can deposit at any time but must wait 14 days to withdraw.
- Mathematical consequence: capital intended to game a single claim event must commit two weeks of opportunity cost. For most strategies, this is unprofitable.
- The cooldown is not a discretionary policy — it is a parameter of the contract; no actor can waive it.

**USD8 example 2 — Brevis attestor stake** (proposed in companion specs):
- The off-chain attestor that computes Cover Scores must post a stake. False or biased computation results in stake forfeiture.
- Mathematical consequence: the value of corrupt scoring must exceed the staked capital for corruption to be profitable. Stake-sizing per the augmented mechanism design parameter discipline ensures this asymmetry holds.

### Type 3 — Temporal Invariants

**What they are**: properties held by time-lock constraints.

**USD8 example 1 — 10-day claim window**:
- Once the first claim against a covered protocol's exploit is filed, a 10-day window opens during which other affected holders can join. After 10 days, no new claims accepted.
- Mathematical consequence: claimants cannot strategically time their submission to exclude others or to extract a disproportionate share of the pool. The window equalizes opportunity to claim.

**USD8 example 2 — 14-day Cover Pool withdrawal delay**:
- LPs requesting withdrawal must wait 14 days before funds are accessible.
- Mathematical consequence: LPs cannot withdraw immediately upon detecting a forthcoming claim. The 14-day delay covers most realistic scenarios where an LP would otherwise exit specifically to avoid contributing to a payout.

**USD8 example 3 — Cover Score epoch boundaries**:
- The Cover Score is computed against a snapshot of holder state at well-defined intervals (per the companion history-compression spec).
- Mathematical consequence: holders cannot game the score by transient balance manipulation just before a claim — only their state as of the snapshot matters.

### Type 4 — Verification Invariants

**What they are**: properties held by cryptographic attestation.

**USD8 example 1 — EIP-712 signature on Cover Score attestations**:
- The off-chain Cover Score computation is signed with EIP-712, domain-separated by chain ID.
- Mathematical consequence: a signature valid on one chain is invalid on another. Cross-chain replay is structurally impossible.

**USD8 example 2 — Merkle proof of holder history** (per companion compression spec):
- Each holder's usage event is committed into an incremental Merkle tree on-chain. Brevis (or any third party) generates inclusion proofs against historical roots.
- Mathematical consequence: any later verifier can re-verify the claimed history without trusting USD8's frontend or backend.

**USD8 example 3 — ZK proof of Cover Score computation** (proposed):
- Brevis ProverNet generates a cryptographic proof that the Cover Score was computed correctly against the on-chain history.
- Mathematical consequence: the on-chain contract verifies the proof in constant time. The score is correct *because the math says so*, not because USD8's team says so.

---

## Real USD8 mechanisms combine invariant types

Most substantive mechanisms compose two to four invariant types. Examples from USD8's planned architecture:

### Cover Score attestation flow

Combines:
- **Verification**: Brevis ZK proof of correct computation.
- **Temporal**: snapshot-bounded inputs (the proof is against a daily-pinned root, not the live root).
- **Structural**: the formula itself, applied uniformly.

Three invariant types working together. Removing any one weakens the mechanism. Without verification, the off-chain computation is unauditable. Without temporal binding, the proof is invalidated by every new event. Without structural uniformity, the formula could be tilted on a per-claimant basis.

### Cover Pool LP rewards (per companion Shapley spec)

Combines:
- **Structural**: closed-form Shapley distribution.
- **Economic**: capital-weighted contribution requires capital to participate.
- **Temporal**: tenure-weighted contribution rewards capital that stays.

Three invariant types underwriting a fair distribution. The math has the property that no LP can be discriminated against by the protocol; no LP can game the formula by short-term capital strategies; no LP can extract permanent rent from early arrival.

### Claim adjudication tribunal (proposed)

Combines:
- **Structural**: Bradley-Terry pairwise aggregation produces a unique ranking.
- **Economic**: tribunal participation requires bonded capital that loses value if rulings are later overturned.
- **Temporal**: contest window before final settlement.
- **Verification**: cryptographic commitment to tribunal-vote ballots before reveal.

Four invariant types underwriting a fair adjudication. The most defended single mechanism in the planned architecture, because adjudication is the substrate where pure observable measurement falls short and human judgment must enter — exactly the place where the most defense-in-depth is warranted.

---

## The methodology applied

When designing a new mechanism for USD8:

### Step 1 — State the property you want

Concrete: "Prevent a holder from extracting more than their fair share of a multi-claimant payout."

### Step 2 — Identify which invariant types enforce it

- Is it structural (holds by construction)? Yes — the Cover Score formula is symmetric in claimants.
- Is it economic (cost asymmetry)? Yes — gaming the score requires sustained holding cost.
- Is it temporal (time-lock)? Yes — the 10-day claim window equalizes opportunity.
- Is it verification (cryptographic)? Yes — Brevis proofs validate the score computation.

### Step 3 — Compose

Combine the relevant invariant types for defense-in-depth. The tribunal example above shows what combining all four looks like.

### Step 4 — Size the parameters

For numerical parameters (cooldown windows, stake amounts, threshold values), derive from cost-asymmetry analysis: the cost of breaking the invariant must exceed the maximum extractable value. Avoid invented numbers.

### Step 5 — Triad-check

Run the design against three checks before committing:

- **Substrate match**: does the mechanism's geometry match the substrate it operates on? (Linear damping on a power-law substrate fails this check.)
- **Augmentation, not replacement**: are we adding constraints to a market, or substituting an actor for the market?
- **Hierarchy preserved**: does the mechanism respect the Physics > Constitution > Governance authority hierarchy described in the companion Augmented Governance supplement?

If any check fails, the design is not yet substrate-matched. Iterate before shipping.

### Step 6 — Ship with regression tests

Each invariant gets a test asserting it holds. The test is the executable form of the fairness claim. Tests that pass confirm the math is intact. Tests that fail under future refactors signal that the invariant has been quietly broken — exactly the failure mode that augmented mechanism design aims to prevent.

---

## The deeper philosophy

Augmented Mechanism Design stakes a position: markets and governance are valuable; don't replace them. Add constraints that make them fair.

This contrasts with a common pattern in stablecoin design: when the market misbehaves, replace it with a centralized actor. When governance misbehaves, replace it with an admin. When anything misbehaves, replace it with a protocol-controlled trust-point. The replace-with-trust-point approach usually produces:

- New operators that become trust-points.
- New failure modes where the operator fails.
- New governance captures where operators influence the protocol.
- New regulatory surface where operators become licensable.

USD8's existing architecture avoids these because the market continues to function. The added invariants are constraints, not substitutions. The Cover Pool operates as a market; the Cover Score operates as a published formula; coverage is permissionless and verifiable. Actors still exist — holders, pool capital, governance, operator — but each actor's discretion is **bounded by math-enforced invariants** at the layers above it (Layer 1 Physics, Layer 2 Constitution). No single actor can compromise the protocol because no actor's discretion can override the layers above it. The architecture is not "no discretion"; it is "discretion structurally bounded so capture cannot extract."

This is the philosophical foundation that makes USD8 distinguishable from every prior decentralized stablecoin attempt that ended up importing a centralized actor under a token wrapper. Augmented Mechanism Design is what keeps USD8 from drifting back into that mode as the protocol matures.

---

## One-line summary

*Augment markets with math-enforced invariants (structural, economic, temporal, verification) that make fairness structural rather than discretionary — never replace them with operators. Four invariant types, combined two-to-four at a time, sized from cost-asymmetry analysis. Real USD8 mechanisms (Cover Score attestation, Cover Pool LP rewards, claims tribunal) compose multiple types.*

---

*Adapted for USD8 from the VibeSwap canonical treatment. The longer methodological treatment, with VibeSwap-specific examples and the parameter-source paper authority discipline, is at `DOCUMENTATION/AUGMENTED_MECHANISM_DESIGN.md` in the VibeSwap repository. This supplement is offered as a USD8-specific application of the same methodology — the philosophy is identical; only the examples differ.*
