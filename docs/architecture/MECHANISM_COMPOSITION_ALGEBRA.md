# Mechanism Composition Algebra

**Status**: Design principle with concrete contract-pair examples.
**Audience**: First-encounter OK. Cases A-D walked through with real VibeSwap combinations.

---

## Start with a painful failure pattern

Your DeFi protocol has three security mechanisms:

1. A rate limiter preventing too many swaps per minute.
2. An oracle feed verifying prices are reasonable.
3. A circuit breaker pausing trading during extreme moves.

Each works fine in isolation. You combine them. A user tries to trade. The rate limiter allows it. The oracle feed confirms reasonable price. The circuit breaker checks aggregate volume — sees a spike, trips.

The trade reverts. The user is annoyed but safety held.

Now imagine a subtle variant. The oracle feed UPDATES the price. The price update triggers the circuit breaker (because price-change exceeded threshold). But the rate limiter was about to allow a trade that would have HELPED stabilize. The circuit breaker traps the trade that could have saved the system.

Three mechanisms, each correct individually. Combined, they created a failure. That's the composition problem.

## The core question

When you combine mechanisms, do their invariants compose, or do they interfere? Real protocols combine 10-50 mechanisms. If composition wasn't tractable, every protocol would be an unpredictable mess. It IS tractable — but requires deliberate attention.

This doc is the framework.

## Four cases of composition

Every pair of mechanisms falls into one of four composition cases.

### Case A — Orthogonal

**Definition**: The mechanisms act on DISJOINT state. They don't share state variables; they don't affect each other's computations.

**Consequence**: Composition is free. Either mechanism can be added/removed without affecting the other.

**VibeSwap example**: `AdminEventObservability` (emits events on setter calls) composed with `CircuitBreaker` (pauses on threshold).

- Event emission doesn't modify CircuitBreaker state.
- CircuitBreaker pauses don't change which events get emitted (events still fire for unsuccessful trades too).
- They operate on different state entirely.

Compose freely. Any order of add/remove.

### Case B — Serially Composable

**Definition**: The mechanisms act on the SAME state but in a well-ordered dependency. Running mechanism M1 first produces an invariant that M2 preserves.

**Consequence**: Composition holds, but ORDER MATTERS. Running them out of order breaks the invariant chain.

**VibeSwap example**: `CommitRevealAuction` composed with `VibeAMM`.

- CRA determines the uniform clearing price for a batch.
- VibeAMM executes the swap using that clearing price, preserving k-invariant (x*y=k).

The order:
1. CRA runs first, computes clearing price π.
2. VibeAMM executes swap at π, which is already validated against pool reserves.
3. k-invariant is preserved because π is within bounds.

If you reversed the order (AMM first, then CRA), you'd break k-invariant: the AMM would swap at a different price than CRA later produces.

Serial composition with correct order = safe. Correct order is load-bearing.

### Case C — Compatible Under Specific Conditions

**Definition**: Mechanisms interact, but the interaction preserves both invariants IF specific conditions hold.

**Consequence**: Composition holds only under the specific conditions. Conditions should be documented and verified.

**VibeSwap example**: `ShapleyDistributor` composed with `ContributionDAG`.

- ShapleyDistributor uses trust-weights from ContributionDAG for quality multipliers.
- ContributionDAG's vouching rules don't directly interfere with Shapley.
- BUT both depend on `SoulboundIdentity.hasIdentity()` being stable.

If an identity is revoked mid-Shapley-round:
- The revocation affects ContributionDAG trust.
- Trust-change affects Shapley quality.
- Shapley's computation could produce different values pre/post-revocation.

So they're compatible, CONDITIONAL on identity-stability across the round.

Document this condition. Verify in tests. Monitor in production.

### Case D — Interfering

**Definition**: Mechanisms act on the same state AND violate each other's invariants.

**Consequence**: Composition breaks. Must redesign.

**VibeSwap example** (hypothetical — this is what would be WRONG):

Two oracle mechanisms both writing to the same price slot:
- `TruePriceOracle` has 5% deviation gate + EIP-712 validation.
- A hypothetical `ExternalOracleAdapter` reads from an off-chain feed and writes directly.

Both try to update `tpoPrice`. If the adapter pushes prices that violate TPO's 5% gate, TPO's invariant is broken. The adapter is not TPO's friend; it's its attacker.

This is interfering. Must redesign: one mechanism owns the state slot. If adaptation is needed, the adapter writes through the owner (which enforces the invariant).

The correct pattern is what C39's `OracleAggregationCRA` does: commit-reveal aggregation produces a final price; TPO's `pullFromAggregator` reads from the aggregator, preserving TPO's ownership of the price slot.

## The composition-verification procedure

Before adding a new mechanism to an existing stack:

### Step 1 — Enumerate existing invariants

For each mechanism currently deployed, list its invariants. Example for CRA:
- `I1`: uniform clearing price within batch.
- `I2`: Fisher-Yates shuffle determinism.
- `I3`: commit-reveal window respected.

### Step 2 — Identify touched state

Which state variables does the new mechanism read/write? Precise list required.

### Step 3 — Verify each existing invariant still holds

For each touched state variable, check: can the new mechanism's action break the corresponding invariant?

If yes, don't ship until you redesign.

### Step 4 — Identify new invariants introduced

What invariants does the new mechanism add?

### Step 5 — Verify new invariants compose with existing

Do the new invariants contradict anything existing? Do they require specific conditions?

### Step 6 — Classify the composition (Case A, B, C, or D)

Write this down in the design memo. Review with team.

### Step 7 — Ship regression tests

Each invariant gets a test asserting it holds. The test IS the invariant in executable form.

If any step fails, iterate. Don't ship broken compositions.

## The rebase-drop example revisited

Recall the NDA-protected commit in [Path Commitment Protocol](./PATH_COMMITMENT_PROTOCOL.md). Two options:

**Option 1 — Rebase-drop**: Remove the interfering commit from git history.

**Option 2 — Add redaction commit**: Keep the commit, add a later commit that redacts.

Through composition-algebra lens:

**Option 1**: Rebase-drop removes the interfering mechanism (the leaked content). Invariant set (NDA-cleanness) restored. Composition: Case A (orthogonal with existing commits).

**Option 2**: Add-redaction-commit adds a new mechanism to the existing chain. But the interfering content remains in git history. The invariant set (NDA-cleanness) is NOT fully restored. Composition: Case D (interfering).

Option 1 wins because it preserves the invariant set. Option 2 "works" in a narrow sense but violates the composition rule.

This is the lens: before choosing an action, ask "which composition case is this?"

## The compositionality architecture goal

VibeSwap aims for maximal compositionality. New mechanisms should slot into:
- **Case A (orthogonal)** when possible — simplest.
- **Case B (serially composable)** with documented order.
- **Case C (conditionally compatible)** with documented conditions.
- **Case D (interfering)** — REJECTED. Redesign.

The architectural choices that support this:
- **UUPS storage-slot discipline** — `__gap` pattern means storage layouts don't collide.
- **Contract-per-concern separation** — each mechanism owns its state.
- **Explicit interfaces** — interactions happen through well-defined APIs.

These aren't arbitrary. They're what makes compositionality tractable.

## Real mechanism pairs and their cases

| Mechanism A | Mechanism B | Case | Notes |
|---|---|---|---|
| CRA | VibeAMM | B | CRA first, AMM uses clearing price |
| ShapleyDistributor | ContributionDAG | C | Conditional on identity stability |
| AdminEventObservability | CircuitBreaker | A | Disjoint state |
| TWAPValidator | VibeAMM | B | Validator first, AMM gates on validation |
| OperatorCellRegistry | AvailabilityChallenge | B | Registration first, challenge second |
| ClawbackCascade | SirenProtocol | A | Different attack surfaces |
| ContributionAttestor | NCI weight function | C | Conditional on claim-status stability |
| Fibonacci rate limiter | Circuit breaker | A | Per-user vs system-wide |

Each pair has been analyzed and documented.

## The invariant-type composition rules

Per [`AUGMENTED_MECHANISM_DESIGN.md`](./AUGMENTED_MECHANISM_DESIGN.md), four invariant types:

| Types composed | Composition rule |
|---|---|
| Structural + Structural (orthogonal state) | Free |
| Structural + Structural (shared state) | Must verify serialization |
| Economic + Economic | Budget-additivity — costs sum |
| Economic + Structural | Compose freely (different enforcement layers) |
| Temporal + Temporal | Interval-union — effective lock = union |
| Verification + Verification | AND — all signatures must pass |
| Temporal + Structural | Serial (temporal first) |

Understanding invariant types helps diagnose compositions.

## Cycling through the ETM gaps

The [ETM Build Roadmap](./ETM_BUILD_ROADMAP.md) Gap #1 (NCI convex retention) and Gap #2 (time-indexed Shapley) are non-interfering changes:

- Gap #1: NCI's retentionWeight(t) changes shape. Doesn't affect other mechanisms that read cumulative weight.
- Gap #2: Shapley's value(i) gets novelty modifier. Doesn't affect other mechanisms reading Shapley output.

Both are Case A (orthogonal) or Case B (serial). Cheap to ship.

Gap #3 (attested circuit-breaker resume) is more complex:

- Adds a dependency on ContributionAttestor for the resume gate.
- Must verify: if attestation is unavailable during a chain-stress event, does circuit-breaker recovery brick?

Case C (conditional compatibility) requiring attestation-availability condition.

This is why Gap #3 is slightly more cautious than Gaps #1 and #2.

## For students

Exercise: pick two VibeSwap mechanisms. Classify their composition (A, B, C, or D):

Pairs to try:
- TruePriceOracle + CommitRevealAuction.
- OperatorCellRegistry + ContentMerkleRegistry.
- ShapleyDistributor + ContributionDAG + ContributionAttestor (triple!).
- Circuit Breaker + Fibonacci Scaling.

Write the analysis step-by-step:
1. State the invariants of each mechanism.
2. Identify shared state.
3. Classify the composition.
4. Identify specific conditions for Case C cases.

Compare your analysis to this doc's claims.

## One-line summary

*Every pair of mechanisms composes in one of four cases: Case A (orthogonal, free), B (serially composable, order-dependent), C (conditionally compatible, documented conditions), D (interfering, redesign). Real VibeSwap pairs walked through. Invariant-type composition rules tabulated. The discipline is non-negotiable: ship Case D and you ship broken protocol.*
