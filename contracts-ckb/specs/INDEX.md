# CKB-Sovereign VibeSwap — Specs Index

Per-component cell specs for the sovereign-pivot. Each spec maps a Solidity-as-spec mechanism to its substrate-native cell architecture. Iterate component-by-component.

Read [`../../docs/architecture/ckb-sovereign-vibeswap.md`](../../docs/architecture/ckb-sovereign-vibeswap.md) first if you haven't.

---

## Spec catalog

| Spec | Solidity source | Port class | Status | Cycle/build complexity |
|---|---|---|---|---|
| [commit-reveal-auction.md](commit-reveal-auction.md) | `contracts/core/CommitRevealAuction.sol` | REINTERPRET | Draft | High (Fisher-Yates settlement) |
| [vibe-amm.md](vibe-amm.md) | `contracts/amm/VibeAMM.sol` + `VibeLP.sol` | REINTERPRET | Draft | High (x·y=k + TWAP + breakers) |
| [shapley-distributor.md](shapley-distributor.md) | `contracts/incentives/ShapleyDistributor.sol` | REINTERPRET | Draft | High (5-axiom verification, O(N²) pairwise) |
| [messaging-hub.md](messaging-hub.md) | `contracts/messaging/` (full directory) | REINTERPRET | Draft | Very high (BLS12-381 in no_std CKB-VM) |
| [nci-consensus.md](nci-consensus.md) | `contracts/consensus/` + `docs/architecture/CONSENSUS_MASTER_DOCUMENT.md` | REINTERPRET (user-space default) | Draft | Medium |
| [lawson-constants.md](lawson-constants.md) | `contracts/governance/LawsonConstantsRegistry.sol` | DIRECT-PORT | Draft | Low |
| [circuit-breaker.md](circuit-breaker.md) | `contracts/core/CircuitBreaker.sol` | REINTERPRET | Draft | Medium (attestation + cooldown) |
| [slash-router.md](slash-router.md) | `contracts/consensus/SlashRouter.sol` | REINTERPRET | Draft | Medium |
| [pairwise-verifier.md](pairwise-verifier.md) | `contracts/consensus/PairwiseVerifier.sol` | REINTERPRET | Draft (2026-06-08) | Medium-High (O(N²) tally → cell-dep enumeration; cycle-budget spike pending) |

## Match-or-Beat-CoW extensions (2026-06-08)

These specs extend the base DEX mechanisms to make VibeSwap structurally equal-or-better than CoW Protocol on every mechanism axis. They are the load-bearing justification for VibeSwap-DEX existing alongside CoW (per Krakovia's "VibeSwap Lite" framing). Without these, VibeSwap-DEX is "CoW but worse-deployed." With these, every CoW advantage flips to equal-or-better, by construction.

Plan doc: [`vibeswap-match-or-beat-cow-mechanism-plan-2026-06-08.md`](https://github.com/wglynn/vibeswap/blob/master/Desktop/) (internal at `Desktop/`).

| Extension | Spec | Beats CoW on | Status | Sequencing |
|---|---|---|---|---|
| Ext 1 — Cycle resolver | [batch-cycle-resolver.md](batch-cycle-resolver.md) | Coincidence-of-wants: N-cycle algorithmic detection vs CoW's solver-found 2-cycles | Draft | Ship first (self-contained) |
| Ext 4a — Multi-curve AMM | [multi-curve-amm.md](multi-curve-amm.md) | External liquidity depth: native concentrated + StableSwap curves vs routing through UniV3/Curve | Draft | Ship in parallel with Ext 1 |
| Ext 4b — Cross-pool LP | [cross-pool-lp.md](cross-pool-lp.md) | First-party liquidity identity: portfolio-level Shapley recognition CoW can't have | Draft | Ship in parallel with Ext 1 |
| Ext 4c — Thin-pool subsidy | [thin-pool-fee-subsidy.md](thin-pool-fee-subsidy.md) | Depth bootstrap: structural emission redirect CoW can't do (no first-party pools) | Draft | Ship in parallel with Ext 1 |
| Ext 3 — Composable paths | [composable-resolution-paths.md](composable-resolution-paths.md) | Surplus capture: generalizes CoW's Fair Combinatorial Auction over strict superset of strategies | Draft | Ship after Ext 1 + 4 |
| Ext 2 — ZK router verifier | [zk-router-verifier.md](zk-router-verifier.md) | Solver-honesty assumption: replaced with ZK-verified proof | Draft (heaviest unknown: ZK proving infra) | Ship last; Path C falls back to Path B until ready |

## Pending specs (not yet started)

| Mechanism | Solidity source | Notes |
|---|---|---|
| VibeSwapCore | `contracts/core/VibeSwapCore.sol` | UNRESOLVED port classification. The orchestrator pattern has no clean CKB equivalent; logic distributes across per-cell type-scripts. Design-exploration agent IN-FLIGHT 2026-06-08. |
| MetaTx / AccountAbstraction | `contracts/AgentRegistry/...` | Account abstraction on CKB is largely solved by Omnilock; spec to formalize integration. |
| Compliance / Tier registry | `contracts/identity/` | Pool access control on CKB. Cell-based per-user tier tracking. |
| Reputation Oracle | `contracts/oracle/` | Used by CommitRevealAuction for tier fallback. |
| Emission Controller | `contracts/incentives/` | Halving schedule integration; partially covered in `shapley-distributor.md` (EmissionScheduleCell). |
| TWAP / VWAP libraries | `contracts/libraries/TWAPOracle.sol`, `VWAPOracle.sol` | Shared math library; partially covered in `vibe-amm.md`. |
| Fibonacci Scaling | `contracts/libraries/FibonacciScaling.sol` | Per-user damping; partially covered in `vibe-amm.md`. |
| DAO Treasury | `contracts/governance/DAOTreasury.sol` | Treasury cells consuming Shapley distributions. |
| Identity / DID | `contracts/identity/` | Cell-based DID; existing partial work in `docs/architecture/ckb/did-cell-mapping/`. |

## Existing CKB scaffolds (already in `../`)

The PsiNet primitive economy was shipped 2026-05-24 as the deep-canonical track. These are DIRECT-PORT or already-CKB-native and don't need full specs:

- `primitive-cell-type-script/` — Structural invariants on PrimitiveCell
- `primitive-cell-lock-script/` — SPHINCS+ post-quantum authorship (CYCLE5 verify)
- `datatoken-cell-type-script/` — UDT conservation + genesis split
- `lineage-vault-cell-type-script/` — Royalty accumulator (CRPC witness pending)
- `escrow-vault-cell-type-script/` — JUL bond + slash on CRPC dispute (CRPC witness pending)
- `proof-of-mind-lock-script/` — Cognitive-work attestation, ed25519

See `../README.md` for status.

## Dependency map

How specs reference each other:

- **commit-reveal-auction** → vibe-amm (settles into pool), messaging-hub (cross-chain recipient routing)
- **vibe-amm** → circuit-breaker (breaker state), lawson-constants (fee rates, thresholds)
- **shapley-distributor** → commit-reveal-auction (fee event source), vibe-amm (fee event source)
- **messaging-hub** → nci-consensus (shares BLS validator set + registry pattern)
- **nci-consensus** → messaging-hub (shared validator set), lawson-constants (pillar weights), proof-of-mind-lock-script (PoM signal)
- **circuit-breaker** → vibe-amm (primary consumer), lawson-constants (thresholds), messaging-hub (BLS + operator set)
- **slash-router** → messaging-hub (BLS + BondCell pattern), lawson-constants (losing_share_bps bounds), nci-consensus (PoS pillar consumes bonded stake)
- **lawson-constants** → nci-consensus (provides ProtocolDecisionCell for updates), all other specs (constants are read via cell-dep)

The dependency graph is acyclic at the spec-text level. Implementation will share concrete code via Rust crates (BLS verification, sUDT conservation, hashing helpers).

## Shared code surface

Identified during specs review, these warrant dedicated Rust crates in `contracts-ckb/` even though no single spec owns them:

- **`vibeswap-ckb-bls`** — BLS12-381 verification wrapper, `no_std` for CKB-VM. Used by MessagingHub, NCI, CircuitBreaker, SlashRouter.
- **`vibeswap-ckb-sudt-ext`** — sUDT extensions for mint-from-attestation and burn-to-receipt patterns. Used by MessagingHub and any cell that mints/burns.
- **`vibeswap-ckb-shapley-axioms`** — The five axiom checks as a reusable library. Used by ShapleyDistributor and potentially future cooperative-game mechanisms.
- **`vibeswap-ckb-fixed-point`** — Fixed-point math for AMM (since CKB-VM has no native floating point and AMM needs careful integer arithmetic). Used by VibeAMM, NCI normalization.

## Status legend

- **Draft**: Spec doc complete, no implementation, open questions flagged.
- **In progress**: Implementation crate has stub code, tests pending.
- **Shipped**: Implementation tested against ckb-testtool, parse-clean.
- **Deployed**: Code-cells exist on a live network.

All current specs are Draft. Implementation work is gated on the Nervos fork plan (`../FORK_PLAN.md`, pending) and the BLS12-381 cycle-budget spike.

## How to add a new spec

1. Identify the Solidity mechanism that needs porting
2. Run the port-classification: DIRECT-PORT / REINTERPRET / DROP / UNRESOLVED
3. Create `contracts-ckb/specs/<mechanism-name>.md` from the template structure used by existing specs:
   - What this mechanism does
   - Cell architecture
   - Per-cell specifications (data layout, lock-script, type-script invariants)
   - Transaction shapes
   - Property preservation
   - Upstream pulls (PULL-FROM-UPSTREAM rule)
   - Build new (minimize this)
   - Open questions
   - Cross-references
4. Add a row to this index
5. Update the AUGMENTATION_SURFACE.md if the spec proposes substrate-level changes
6. Update the UPSTREAM.md if the spec consumes a new upstream artifact
7. Commit + push
