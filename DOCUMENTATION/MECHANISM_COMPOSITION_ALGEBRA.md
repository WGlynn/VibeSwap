# Mechanism Composition Algebra

**Status**: Design principle. When two augmented mechanisms compose correctly; when they interfere.

---

## The problem

Real protocols aren't single mechanisms. VibeSwap composes: commit-reveal + Shapley + batch auction + TWAP validation + circuit breakers + fibonacci scaling + ContributionDAG + ContributionAttestor + ... Each mechanism has its own invariants. When they're combined, two outcomes are possible:

1. **Compose correctly** — each mechanism's invariants remain intact in the composition.
2. **Interfere** — one mechanism's invariant is violated because another mechanism acts on the same state.

Composition is not free. Building a protocol = verifying that the composition preserves the invariant set.

## The algebra

Treat each mechanism as a function that acts on state, subject to a set of invariants it preserves:

```
M_i: State → State, with invariant set I_i
```

Composition `M_2 ∘ M_1`: apply M_1, then M_2. For the composition to preserve both invariant sets, we need:

```
∀ s ∈ State: I_1(s) ∧ I_2(s) ⟹ I_1(M_2(M_1(s))) ∧ I_2(M_2(M_1(s)))
```

This is an invariant-preservation condition. Not all mechanisms compose this way.

## Four cases

### Case A — Orthogonal

Mechanisms act on disjoint state. `I_1` and `I_2` don't reference the same state variables. Composition is free — no interference possible.

Example: `AdminEventObservability` (emits events on setter calls) and `CircuitBreaker` (pauses on threshold). Event emission doesn't affect breaker state; breaker pause doesn't change which events fire. Compose freely.

### Case B — Serially composable

Mechanisms act on same state but in well-ordered dependency. Running M_1 first establishes a condition that M_2 preserves.

Example: `CommitRevealAuction` establishes the batch's uniform clearing price; `VibeAMM` executes the swap at that price. AMM's k-invariant is preserved because CRA's clearing price is already validated against the AMM's reserves. Order matters; out-of-order (AMM first, then CRA) breaks the k-invariant.

### Case C — Compatible under specific invariants

Mechanisms interact but the interaction preserves both invariant sets, requiring a specific condition.

Example: `ShapleyDistributor` (distributes surplus) and `ContributionDAG` (vouching graph). Shapley weights come from DAG; DAG's vouching rules don't interfere with Shapley computation. But both rely on `SoulboundIdentity.hasIdentity()` — if the identity check breaks (e.g., an identity is revoked), Shapley's per-contributor calculations could be affected. The compatibility is conditional on identity-stability.

### Case D — Interfering

Mechanisms act on same state and violate each other's invariants.

Example (hypothetical bad design): two oracle mechanisms writing the same price slot. `TruePriceOracle` (with TWAP validation) + `ExternalOracleAdapter` (with no validation). If both write, the adapter can push prices that violate TPO's 5% deviation gate. Interfering.

Correct solution: one mechanism owns the slot. If adaptation is needed, the adapter writes through the owner. The new oracle `OracleAggregationCRA` (C39 FAT-AUDIT-2) is the correct approach — commit-reveal aggregation that feeds TPO, with TPO retaining ownership of the price slot.

## The composition-verification step

Before adding a new mechanism to an existing stack:

1. **Enumerate the existing invariant set** across all mechanisms currently deployed.
2. **Identify the state the new mechanism touches.** Which existing state variables does it read/write?
3. **For each touched state variable, verify each existing invariant still holds after the new mechanism acts.**
4. **Identify any new invariants the mechanism introduces.** Verify they compose with existing ones (not in conflict).
5. **Write regression tests that assert each invariant remains satisfied** after full-stack interactions.

If any verification step fails, redesign. Don't ship a composition that breaks known invariants. [Correspondence Triad Check 3](./CORRESPONDENCE_TRIAD.md) catches this at design time.

## Why rebase-drop was correct for the NDA incident

The NDA gate caught a commit with protected content. Two options: rebase-drop vs add-redaction-commit.

Through composition-algebra lens:

- **Rebase-drop**: removes the interfering mechanism (the leaked content) from git-history. Invariant set (NDA-cleanness) restored without modifying any other mechanism.
- **Add-redaction-commit**: adds a new mechanism (redaction) that composes with the existing commit. But the interfering content remains in git history; future queries against the repo could still surface it. Invariant set (NDA-cleanness) NOT fully restored.

Rebase-drop is the only composition that preserves the full invariant set. See [Path Commitment Protocol](./PATH_COMMITMENT_PROTOCOL.md) — the "middle path" (keep the commit, add a redaction comment) preserves neither the clean-history invariant nor the preserved-history invariant fully.

## Compositionality as an architectural goal

VibeSwap's architecture aims for maximal compositionality. New mechanisms should slot into Case A (orthogonal) or Case B (serially composable) whenever possible. Case C (compatible-under-conditions) is acceptable with explicit documentation. Case D (interfering) is rejected.

The `__gap` storage-slot convention, the UUPS-upgradeability pattern, and the contract-per-concern separation all serve compositionality. Each mechanism owns a separate storage slice; interactions happen through explicit interfaces.

## Relationship to Augmented Mechanism Design

[Augmented Mechanism Design](./AUGMENTED_MECHANISM_DESIGN.md)'s four invariant types (structural, economic, temporal, verification) each have different composition rules:

- **Structural invariants** compose freely when they act on different state.
- **Economic invariants** compose under budget-additivity: the total Sybil-cost of multiple economic gates is the sum of individual costs (not the minimum).
- **Temporal invariants** compose via interval-overlap: the effective lock window is the union of individual locks.
- **Verification invariants** compose via AND: all signature checks must pass.

Knowing which invariant type each mechanism uses determines the composition rule for that pair.

## Relationship to the 3 PARTIAL gaps in ETM Alignment Audit

[ETM Build Roadmap](./ETM_BUILD_ROADMAP.md) Gap #1 (convex retention) and Gap #2 (time-indexed Shapley) are non-interfering changes to existing mechanisms. Each can be applied without breaking other parts of the stack. This compositionality is why they're cheap cycles — they're Case A (orthogonal) or Case B (serially composable) with the existing mechanisms.

Gap #3 (attested circuit-breaker resume) is Case C (compatible-under-conditions) — it adds a dependency on [ContributionAttestor](./CONTRIBUTION_ATTESTOR_EXPLAINER.md) for the resume gate. Need to verify that attestation-unavailability doesn't brick circuit-breaker recovery during a chain-stress event.

## One-line summary

*Composition of mechanisms isn't free — identify orthogonal (Case A), serially composable (Case B), conditionally compatible (Case C), interfering (Case D). Reject D; document C; prefer A and B.*
