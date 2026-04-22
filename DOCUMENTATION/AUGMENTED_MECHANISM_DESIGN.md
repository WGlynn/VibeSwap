# Augmented Mechanism Design

**Status**: Methodology. Public-doc form of the paper-primitive.
**Primitive**: [`memory/feedback_augmented-mechanism-design-paper.md`](../memory/feedback_augmented-mechanism-design-paper.md)
**Sibling principles**: [Substrate-Geometry Match](./SUBSTRATE_GEOMETRY_MATCH.md), [Augmented Governance](./AUGMENTED_GOVERNANCE.md), [Correspondence Triad](./CORRESPONDENCE_TRIAD.md).

---

## The methodology

Don't replace markets or governance. Augment them with math-enforced invariants that make fairness structural rather than discretionary. The market still functions — participants still act self-interestedly — but the shape of the constraint makes extractive outcomes either impossible or prohibitively costly.

Augmentation ≠ restriction. A well-augmented market is strictly more efficient than its unaugmented counterpart because agents don't have to price-in the trust-cost of a human intermediary — the invariant is the trust anchor.

## Contrast with replacement

Traditional mechanism design often replaces the market with a protocol:

- *Traders behave badly → a DAO votes on trade ordering.* (Replacement — DAO is now the market.)
- *Front-running is a problem → a permissioned orderflow auction.* (Replacement — the auctioneer is now the market.)
- *Trust is expensive → mint an NFT for every interaction.* (Replacement — NFT issuance is now the trust layer.)

Augmented mechanism design instead adds an invariant:

- *Traders behave badly → commit-reveal + uniform clearing price + Fisher-Yates shuffle on XORed secrets.* The market still matches orders; the invariant eliminates ordering-advantage.
- *Front-running is a problem → batch auctions with uniform clearing price.* Orders within a batch clear at the same price; within-batch front-running is mathematically impossible.
- *Trust is expensive → Shapley distribution over verifiable contributions.* Every contribution earns credit proportional to its marginal value; no NFT mint, just a deterministic computation over a cooperative game.

The replacement pattern shifts trust from one intermediary to another. The augmentation pattern removes the trust-intermediary entirely.

## Four invariant types

### 1. Structural invariants

Properties that hold by construction. Examples:
- **Uniform clearing price** in a batch auction — impossible to get a better price than another trader in the same batch.
- **Fisher-Yates shuffle** on XORed secrets — batch ordering is deterministic from inputs but unpredictable before reveal.
- **Merkle-chunked content availability** — claims about operator-held data are verifiable by any third party.

Structural invariants fire at every interaction and cannot be bypassed without changing the contract code (at which point it's a different system).

### 2. Economic invariants

Properties held by cost asymmetries.
- **Sybil-resistant bonding** — N fake identities cost N × bondAmount.
- **Slashable stakes** — misbehavior destroys more value than it can extract.
- **Challenge-response games** — stake at risk from liars > stake at risk from truth-tellers.

Economic invariants admit "break at sufficient expense" — rational actors won't break them but an irrational attacker might. Sizing the bond correctly is load-bearing. Paper §6.x has the canonical table (Temporal §6.1, Compensatory §6.5).

### 3. Temporal invariants

Properties held by time-lock constraints.
- **Commit-reveal** — commitments bind before reveals.
- **Unbonding delay** — exit takes N days; slashing window overlaps.
- **Challenge window** — claims are provisional until window closes without dispute.

Temporal invariants are the VibeSwap default for any mechanism with a "claim now, verify later" pattern — it's what makes optimistic execution safe.

### 4. Verification invariants

Properties held by cryptographic attestation.
- **EIP-712 signature binding** to a specific chain's domain separator.
- **Merkle proof** against a committed root.
- **ZK-proof** of a computation's correctness.

Verification invariants turn claims about off-chain state into first-class on-chain facts.

## The paper as canonical parameter source

For any parameter question (bond sizes, challenge windows, slash splits, voting thresholds, decay rates), the [`memory/feedback_augmented-mechanism-design-paper.md`](../memory/feedback_augmented-mechanism-design-paper.md) paper is the authoritative source. Do not ask Will for values that the paper has already derived. Example lookups:

| Parameter | Paper section | Default |
|---|---|---|
| Operator cell bond | §6.1 Temporal | 10e18 CKB |
| Assignment-challenge response window | §6.1 | 30 min |
| Challenge-challenge cooldown | §6.1 | 24 hr |
| Slash / slashPool split | §6.5 Compensatory | 50 / 50 |
| Challenger payout | §6.5 | 50% of slashed |
| Min bond per cell | §6.2 | 1e18 CKB |

If a parameter is needed that the paper doesn't cover, derive it from the paper's first principles (substrate geometry + cost-asymmetry sizing) before inventing.

## When to use which invariant type

Rule of thumb:

- If the property should hold for *every interaction* → structural invariant.
- If the property depends on *who benefits from breaking it* → economic invariant.
- If the property depends on *time ordering* → temporal invariant.
- If the property is a *claim about computation* → verification invariant.

Most real mechanisms combine 2-4 types. The commit-reveal auction combines structural (uniform price), temporal (commit-reveal window), and verification (XOR-secret shuffle as verification-of-fairness).

## How augmentation interacts with governance

See [`AUGMENTED_GOVERNANCE.md`](./AUGMENTED_GOVERNANCE.md). The invariants are Physics; governance operates freely within the Physics bounds. Governance cannot vote Physics away because Physics is the code; it could fork the protocol to remove Physics, at which point the new fork is a different system (and loses the network effect of the original).

This is why P-000 (Fairness Above All) is a constitutional axiom, not a governance parameter — constitutional axioms are Physics, hardened against vote-capture.

## How to apply — designing a new mechanism

1. **State the property you want.** "Operators can't inflate their claimed cellsServed count."
2. **Identify which invariant type(s) enforce it.**
   - Structural? Hashes commit, reveals prove. (Merkle-chunk PAS.)
   - Economic? Bond per cell scales Sybil cost linearly. (`OperatorCellRegistry.bondPerCell`.)
   - Temporal? Challenge window after claim. (Permissionless availability challenge.)
   - Verification? Merkle proofs of chunk possession. (Content Merkle Registry.)
3. **Combine.** Real mechanisms use 2-4 invariants in composition.
4. **Size parameters from the paper.** Don't invent; look up.
5. **Triad-check** (see [`CORRESPONDENCE_TRIAD.md`](./CORRESPONDENCE_TRIAD.md)). Substrate-geometry match, augmentation-not-replacement, Physics > Constitution > Governance.
6. **Ship with regression tests** that prove each invariant. The test IS the invariant assertion in executable form.

## Relationship to ETM

Augmented Mechanism Design is the methodology layer of [Economic Theory of Mind](./ECONOMIC_THEORY_OF_MIND.md). ETM says "the chain mirrors the cognitive economy"; this methodology says "and the mirror is implemented by layering invariants that capture structural, economic, temporal, and verification properties."

Without augmented design, the mirror has no structure — mechanisms become ad-hoc and distort the reflection. With it, every mechanism is decomposable into a short list of invariants, each with a correctness criterion.

## One-line summary

*Augment markets and governance with structural / economic / temporal / verification invariants that make fairness structural — never replace them with an intermediary.*
