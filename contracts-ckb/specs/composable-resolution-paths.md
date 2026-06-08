# Composable Resolution Paths — CKB Cell Spec

**Spec layer**: extends `contracts/core/CommitRevealAuction.sol` settlement logic
**Port classification**: BUILD-NEW
**Status**: Spec draft. Extension 3 of the match-or-beat-CoW plan. Depends on Extensions 1 and 4.
**Substrate**: VibeSwap-augmented Nervos CKB

---

## What this mechanism does

The settlement transaction doesn't pick ONE resolution strategy and apply it to every order in the batch. It computes multiple resolution outcomes per trader and routes each trader to whichever produces the Pareto-best output for their order, given their acceptable-paths preferences.

Three resolution paths:

- **Path A — Pure netting**: cycle decomposition only (per `batch-cycle-resolver.md`). Maximum trust-minimization. No external state read. The trader's outcome is determined entirely by other traders' opposite intents in the batch.
- **Path B — Internal multi-hop**: Path A plus multi-hop routing through VibeSwap's own pools across different curve kinds (per `multi-curve-amm.md`). Captures more depth without expanding trust assumptions beyond our own substrate.
- **Path C — ZK-routed external**: Path B plus ZK-verified routing through external DEXes (per `zk-router-verifier.md`, Extension 2). Best execution available. Marginal trust assumption: the solver's search-completeness up to a relaxation parameter.

Each trader specifies their acceptable-paths in their order's reveal data. The settler computes outcomes under each acceptable path and routes the trader to the dominating one.

This generalizes CoW Protocol's Fair Combinatorial Auction. CoW's FCA merges solver-produced solutions into a super-settlement. Our path composition merges resolution-strategy outcomes, which is a strictly larger search space because it includes non-solver strategies (cycle decomposition is not a solver output, it's an algorithm).

## Cell architecture

The composable-paths mechanism extends BatchSettlementCell. No new cell types.

**RevealCell** gains a new field: `acceptable_paths: PathSet`, encoding which of {A, B, C} the trader will accept. Default (omitted) = {A, B, C} (any).

**BatchSettlementCell** gains:
- `per_trader_path_chosen: Vec<(reveal_outpoint, PathChoice)>` — which path each trader was routed to
- `per_path_residual: PerPathState` — internal state for verification

## Path selection logic

For each RevealCell in the batch:
1. Compute the trader's outcome under Path A: cycle netting only. Returns (output_amount, output_token, executed_or_failed).
2. If Path B is acceptable: compute the trader's outcome under Path B: cycle netting + multi-hop through internal pools.
3. If Path C is acceptable: compute the trader's outcome under Path C: cycle netting + internal + ZK-verified external routing.
4. Among the acceptable outcomes that executed, pick the one with the highest output_amount.
5. Bind the trader to that path; their settlement uses that path's outcome.

The "highest output" criterion is the obvious Pareto-best for a trader who wants to maximize their swap output. For traders with more complex preferences (e.g., minimize gas, prefer trust-minimization), they can pre-select a single path via `acceptable_paths`.

## Per-cell specifications

### RevealCell (extended)

In addition to the fields from `commit-reveal-auction.md`:

- `acceptable_paths: u8` (bitmask: bit 0 = Path A, bit 1 = Path B, bit 2 = Path C)
- `path_preference_kind: u8` (0 = any, 1 = pin to single path, 2 = lexicographic preference)
- `lexicographic_order: Vec<u8>` (if path_preference_kind == 2; the trader's ranked order)

**Type-script invariants** (additions):
- `acceptable_paths` is nonzero (must accept at least one path)
- If `path_preference_kind == 1`: exactly one bit set in `acceptable_paths`
- If `path_preference_kind == 2`: `lexicographic_order` lists each accepted path exactly once

### BatchSettlementCell (extended)

In addition to the fields from `commit-reveal-auction.md` and `batch-cycle-resolver.md`:

- `per_trader_path_chosen: Vec<(OutPoint, PathChoice)>` — for each consumed RevealCell, which path the settler chose
- `path_outcomes_witness: PathOutcomesWitness` — the per-trader per-path computed outcomes

**Type-script invariants** (additions):
- For each RevealCell consumed, the chosen path is in the trader's `acceptable_paths`
- For each RevealCell consumed, the chosen path dominates all other acceptable paths per the trader's `path_preference_kind`
- The per-trader output amount matches the chosen path's computed outcome
- Total token conservation across all paths combined

### PathOutcomesWitness

A compact witness submitted with the settlement transaction, containing per-trader per-acceptable-path outcomes for verification.

For each (reveal_outpoint, path_choice):
- `computed_output_amount: u128`
- `proof_blob: Vec<u8>` (path-specific; for Path A this is the cycle-witness, for Path B this is the multi-hop route, for Path C this is the ZK proof reference)

The settlement type-script verifies the witness's claims:
- Path A outcome: matches the cycle resolver's deterministic output for this trader
- Path B outcome: matches the multi-hop route's computation against the affected PoolCells
- Path C outcome: matches the ZK proof's claimed output, verified via the ZK verifier

## Composition with other mechanisms

**Batch cycle resolver (Extension 1)**: Path A is exactly the cycle resolver's output. Path B includes the cycle resolver as a sub-step. Path C includes both as sub-steps.

**Multi-curve AMM (Extension 4a)**: Path B's multi-hop routing uses each pool's specific curve formula. A multi-hop through a constant-product pool then a StableSwap pool combines both invariants correctly.

**Cross-pool LP (Extension 4b)**: cross-pool LPs earn fees from any path that consumes liquidity from their pools, including Path B and Path C.

**Thin-pool fee subsidy (Extension 4c)**: subsidies attach to LP earnings regardless of which path consumed the pool. A subsidized pool participating in Path B gets the multiplier applied to its earned fees.

**ZK router verifier (Extension 2)**: Path C requires Extension 2 to ship. Until then, Path C falls back to Path B (settlement type-script treats Path C as equivalent to Path B if no ZK proof is available).

## Property preservation

**Trader sovereignty over trust assumptions**: traders explicitly opt into the trust level they're comfortable with. A trader who wants pure trust-minimization can pin to Path A. A trader who wants best execution can accept all paths.

**Pareto-best output**: by construction, no trader is worse off under composable paths than they would be under any single-path resolution. The settler picks the trader's best acceptable outcome.

**Deterministic settlement**: the composition is deterministic. The settler computes outcomes, picks the Pareto-best, and the type-script verifies. Multiple parties constructing the settlement transaction produce the same result.

**Permissionless verification**: anyone can construct the settlement transaction. The type-script verifies each path's outcome was correctly computed and the trader's path-selection rules were followed.

**No silent path switching**: if a trader's order falls back to a less-preferred path (e.g., Path C unavailable due to ZK infra not ready), the settlement transaction records this explicitly. The trader can observe which path their order was settled on.

## Beats CoW's Fair Combinatorial Auction

CoW's FCA: merges multiple solver-produced solutions into one super-settlement to capture more surplus.

VibeSwap's composable paths: merges resolution-strategy outcomes, a strict superset:
- Cycle decomposition (no equivalent in CoW; their solvers find 2-cycles, our algorithm finds N-cycles)
- Internal multi-hop with multi-curve pools (CoW has no first-party pools)
- ZK-verified external routing (CoW's external routing trusts the solver; ours verifies the proof)

The trader's path-selection rules give them explicit control over trust-vs-execution trade-off, which CoW doesn't expose at all.

## Transaction shapes

**Settlement transaction (extended)**: per the original CommitRevealAuction shape.

- Inputs: all consumed RevealCells, relevant PoolCells (those touched by any Path B routing), optional ZK-routing-attestation cells (for Path C)
- Outputs: BatchSettlementCell with all per-trader path choices, per-order trade-output cells, updated PoolCells
- Cell-deps: Lawson constants registry, multi-curve curve formulas, ZK verifier code-cell

The transaction is more computationally expensive than single-path settlement because it computes per-path outcomes for each trader. Cycle-budget impact:

- Path A: O(V + E + C) for cycle decomposition (already required regardless)
- Path B: O(N · H) where N = trader count and H = max hops per route
- Path C: O(N) ZK proof verifications plus the proof generation cost off-chain

For typical batch sizes (10-100 reveals), the combined cost is within CKB-VM budget. For very large batches, the settler may decline to compute Path C for low-value orders.

## Upstream pulls

**From `batch-cycle-resolver.md`**: cycle resolver as Path A.

**From `multi-curve-amm.md`**: per-pool curve formulas for Path B routing.

**From `zk-router-verifier.md`** (Extension 2 when shipped): ZK verifier for Path C.

**From `ckb-std`**: standard syscalls.

## Build new

**`vibeswap-ckb-path-composer`**: Rust crate. Computes per-trader per-path outcomes given the batch's reveals and the relevant pool/router state.

**Extension to BatchSettlementTypeScript**: path-selection rule verification, dominance check, witness verification.

## Open questions

- **Pareto-best criterion under different preference kinds**: highest-output is the natural default. Lexicographic preference handles "I want Path A unless its output is much worse." Need to define the "much worse" threshold; trader-specified parameter or Lawson constant?
- **Cycle budget management**: if computing all three paths for every trader exceeds the cycle budget, what's the priority order? Likely highest-value orders first; smaller orders may get pinned to Path A.
- **Path C unavailable behavior**: silent fallback to Path B is risky (trader thinks they got best execution but didn't). Make it explicit in the BatchSettlementCell so the trader can see what happened.
- **Off-chain solver coordination for Path C**: solvers need to know which batches they should produce ZK proofs for. Off-chain protocol question.

## Cross-references

- Parent spec: `vibeswap/contracts-ckb/specs/commit-reveal-auction.md`
- Depends on: `batch-cycle-resolver.md`, `multi-curve-amm.md`, `zk-router-verifier.md`
- Plan doc: `Desktop/vibeswap-match-or-beat-cow-mechanism-plan-2026-06-08.md` (Extension 3)
- Mechanism primitives: `[P·structure-does-the-work]`, `[P·complete-as-ready-for-critique]` (multiple paths = multiple ready-for-critique resolutions), `[F·dont-default-concede-verify-first]` (the composition is structural superiority over CoW's FCA)
