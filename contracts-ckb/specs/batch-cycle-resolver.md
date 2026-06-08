# Batch Cycle Resolver — CKB Cell Spec

**Spec layer**: extends `contracts/core/CommitRevealAuction.sol` settlement logic
**Port classification**: BUILD-NEW (no Solidity precedent yet; CKB-native mechanism)
**Status**: Spec draft. Extension 1 of the match-or-beat-CoW plan.
**Substrate**: VibeSwap-augmented Nervos CKB

---

## What this mechanism does

Before the batch settlement transaction commits any swap to the AMM, run a deterministic cycle-decomposition over the batch's intent graph and net out all peer-to-peer matches. Only the residual after netting hits the pool.

CoW Protocol calls the 2-cycle case "Coincidence of Wants" and relies on off-chain solvers to detect it. We generalize to N-cycles and detect them algorithmically on-chain. A batch with Alice selling A→B, Bob selling B→C, Charlie selling C→A nets all three at zero pool-impact if the amounts cycle-balance. No solver needed; no solver fee paid; no trust assumption.

The structural property is that surplus from peer-to-peer matching is captured deterministically and distributed to the participating traders, with zero leakage to a solver role or extractor.

## Cell architecture

The cycle resolver extends the existing BatchSettlementCell mechanism without adding new cells. Cycle decomposition runs inside the BatchSettlementTypeScript as part of settlement verification. The settlement transaction's witness includes the cycle decomposition output, and the type-script verifies it.

**No new cells.** What changes:

- BatchSettlementCell gains new fields: `cycle_resolutions: Vec<CycleResolution>` and `residual_after_cycles: Vec<TokenFlow>`.
- The settlement transaction's witness includes the cycle decomposition.
- Per-order trade-output cells route directly from cycle resolutions for the participating orders (no pool interaction for those).
- The PoolCell only sees the residual.

## Cycle-decomposition algorithm

The algorithm is deterministic and runs in O(V + E + C) where V is the number of unique tokens, E is the number of orders, and C is the total length of detected cycles.

**Step 1 — Build the intent graph.**

After collecting all RevealCells for the batch, construct a directed multigraph G = (V, E):
- V = the set of unique tokens referenced in the batch.
- E = the set of intents. For each RevealCell selling x of token A for B at limit price p, add an edge A→B with weight (x, p, owner_lock_hash, reveal_outpoint).

Edges are kept distinct (multigraph, not simple graph) because two traders can sell the same A→B and we need to track them separately for output routing.

**Step 2 — Strongly connected components (Tarjan's).**

Run Tarjan's SCC algorithm to identify strongly connected components in G. An SCC is a maximal subgraph where every node is reachable from every other node. Trivially, any cycle is contained in some SCC.

Tarjan's is O(V + E), linear, and well-defined for deterministic execution.

**Step 3 — Cycle enumeration per SCC.**

For each non-trivial SCC (size > 1), enumerate cycles via DFS with backtracking, bounded by a configured MAX_CYCLE_LENGTH (default 8). Enumerate in canonical lexicographic order (nodes ordered by hash) so the result is deterministic.

For each cycle (v₀, v₁, ..., v_{k-1}, v₀):
- For each step i, select the edge i → i+1 with the highest remaining capacity that is acceptable to the trader's limit price.
- The cycle's flow is bottlenecked by min(weights along the cycle).
- Subtract the bottleneck flow from each participating edge.

After each cycle is processed, edges with zero remaining weight are removed.

**Step 4 — Residual computation.**

After cycle enumeration completes, the remaining edges in G are the residual. These are the flows that couldn't be net peer-to-peer and must hit the AMM.

The settlement transaction's output cells route:
- For each cycle: the participating traders receive their requested output token directly from the cycle.
- For each residual edge: the trader's order is settled via the AMM at the uniform clearing price computed over the residual.

## Per-order outcome semantics

The trader's outcome under cycle netting is mathematically equivalent to "swap A for B at the limit price implied by the cycle's other participants." Specifically:

- A cycle (A→B→C→A) at bottleneck flow w means: Alice gives w of A, receives w·(B/A) of B; Bob gives w·(B/A) of B, receives w·(C/B)·(B/A) = w·(C/A) of C; Charlie gives w·(C/A) of C, receives w of A. The cycle balances.
- The implied prices along the cycle are determined by the edge weights (which encode the traders' limit prices).
- The cycle is only resolved if every edge's implied price is within the corresponding trader's limit-price constraint.

The trader's RevealCell contains the limit price; the resolver enforces it during edge selection.

## Type-script invariants (extends BatchSettlementCell)

In addition to the invariants in `commit-reveal-auction.md`, the cycle-extended BatchSettlementCell type-script verifies:

- `cycle_resolutions` is a list of valid cycles, each described by participating reveal-outpoints and bottleneck flow
- For each cycle: the listed edges form a valid cycle in the intent graph
- For each cycle: every participating trader's limit price is satisfied by the cycle's implied prices
- For each cycle: the bottleneck flow is correctly computed as `min` of edge weights
- The `residual_after_cycles` matches the intent graph minus the consumed cycle flows
- Each trader's output amount is computed correctly across (cycle outputs + residual outputs)
- Total token conservation: `Σ inputs == Σ outputs` per token across the batch
- The cycle decomposition is in canonical order (so a different ordering can't produce a different settlement)

## Witness format

The settlement transaction's witness for the cycle-extended path includes:

```
CycleResolverWitness {
  cycles: Vec<Cycle>,
  cycle_validation_proof: CanonicalOrderProof,
}

Cycle {
  participating_reveals: Vec<OutPoint>,
  edges: Vec<EdgeRef>,       // (from_token, to_token, weight_used, reveal_outpoint)
  bottleneck_flow: u128,
  implied_prices: Vec<u128>, // one per edge, for limit-price verification
}
```

The CanonicalOrderProof attests that the enumeration order matches the canonical lex-order over node-hash-tuples. This is a small Merkle-style argument; computing it during settlement is part of the type-script verification.

## Property preservation

**Determinism**: The algorithm is fully deterministic. Same input batch produces the same cycle decomposition. Multiple parties constructing the settlement transaction produce the same witness.

**Verifiability**: The type-script verifies each cycle is well-formed, well-priced, and well-conserved. An incorrect cycle decomposition fails the type-script.

**Limit-price honoring**: Every trader's specified limit price is enforced during cycle resolution. A cycle that would violate any participant's limit is rejected; the algorithm tries the next cycle in canonical order.

**Beats CoW on coverage**: CoW solvers find 2-cycles reliably and 3-cycles inconsistently (depends on the solver's optimization). Our algorithm finds all cycles up to MAX_CYCLE_LENGTH by construction.

**Beats CoW on surplus capture**: CoW's CoW surplus is split between trader and solver (via solver fee). Our cycle surplus goes entirely to the traders. Zero leakage.

**Beats CoW on trust**: Our cycle decomposition has no trusted solver. CoW assumes the winning solver searched honestly. We verify the algorithm executed correctly.

## Cycle length bounds and cycle budget

Cycle enumeration is bounded by `MAX_CYCLE_LENGTH`. Default 8. Reasoning:

- 2-cycles are the most common and capture the bulk of CoW-style matches.
- 3-cycles are common in triangular markets (ETH/USDC/BTC type triangles).
- 4-7 cycles are rare but real (e.g., correlated-asset chains).
- 8+ cycles are vanishingly rare and the search cost scales factorially.

`MAX_CYCLE_LENGTH` is a Lawson-constants-registry parameter, governance-tunable within bounds [2, 16]. Default 8.

Cycle enumeration is also bounded by a per-batch `MAX_CYCLES_ENUMERATED` (default 64) to cap settlement transaction cost. If more cycles exist than the cap, the algorithm processes the highest-flow cycles first (greedy) and routes the rest through residual.

Both bounds are configured per `lawson-constants.md`.

## Upstream pulls

**From `ckb-std`**: Standard syscalls, hashing for canonical-order proof construction.

**From `ckb-merkle-mountain-range`**: If the cycle-resolutions list is large, MMR commitment of the cycle witness.

**From the existing CommitRevealAuction spec**: BatchSettlementCell base, RevealCell consumption, per-order routing.

## Build new

**`vibeswap-ckb-cycle-resolver`**: Rust crate in `contracts-ckb/`. Implements:
- Intent graph construction from a slice of revealed orders
- Tarjan's SCC algorithm (no_std-friendly)
- DFS cycle enumeration with canonical ordering
- Per-cycle flow bottleneck computation
- Limit-price verification per cycle

Used by: extended BatchSettlementTypeScript.

**Cycle witness verifier**: extension to BatchSettlementTypeScript. Verifies the witness's cycle decomposition is canonical and correct.

## Open questions

- **Cycle-length cap calibration**: Default 8 is a guess. Need empirical data once we have batch traffic. Likely tune downward (5-6) if cycle-length-7 cycles never produce material surplus, or upward if they do.

- **Greedy vs optimal cycle selection**: When MAX_CYCLES_ENUMERATED bounds the search, processing highest-flow cycles first is greedy. A different order might capture more total surplus in some pathological cases. Greedy is deterministic and simple; consider this only if data shows material missed surplus.

- **Limit-price conflict resolution**: If two cycles share an edge and the edge's capacity isn't sufficient for both, the canonical order determines which cycle wins. This is fair-by-construction (deterministic, no human choice) but may not be optimal. Document explicitly so traders understand.

- **Cycle reordering as a manipulation vector**: A malicious miner could try to influence canonical order by manipulating cell ordering. The canonical-order proof requires the order to be determined by deterministic node-hashes, so miner reordering cannot affect outcome. Verify in implementation.

## Cross-references

- Parent spec: `vibeswap/contracts-ckb/specs/commit-reveal-auction.md`
- Composes with: `vibeswap/contracts-ckb/specs/composable-resolution-paths.md` (when written) — Path A is pure cycle-only resolution
- Plan doc: `Desktop/vibeswap-match-or-beat-cow-mechanism-plan-2026-06-08.md` (Extension 1)
- Mechanism primitives: `[P·structure-does-the-work]`, `[P·dissolve-attack-surface]` (dissolves solver-trust attack surface), `[P·dont-default-concede-verify-first]` (cycle decomposition is structural superiority over CoW's solver pattern, not parity)
- Lawson constants: `MAX_CYCLE_LENGTH`, `MAX_CYCLES_ENUMERATED`
