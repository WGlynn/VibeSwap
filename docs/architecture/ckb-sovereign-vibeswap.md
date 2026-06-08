# CKB-Sovereign VibeSwap

**Status**: Living architectural statement. Active iteration target. Solidity-as-spec, sovereign L1 modeled on Nervos CKB as deployment. Iterate component-by-component, no rewrite. No timeline.

---

## What this is, plainly

VibeSwap is building its own sovereign L1, modeled on Nervos CKB, augmented to meet VibeSwap-specific protocol requirements. This is not "VibeSwap deploys to CKB mainnet." It is "VibeSwap is a Nervos-CKB-derived chain whose substrate is co-designed with the protocol that runs on it."

This is a serious undertaking. Building an L1 is fundamentally different from writing smart contracts. The discipline that keeps this from being reckless is upstream-fidelity: clone Nervos CKB source code, augment minimally where VibeSwap's requirements diverge, and never reinvent consensus, networking, storage, or VM layers that Nervos already shipped, audited, and battle-tested. PULL > AUGMENT > NEVER REINVENT.

Will-frame 2026-06-07: *"as long as it's just following nervos ckb code but augmented to meet vibeswap specifications, i think we can do it."* The conditional matters. The iteration proceeds only as long as we stay close to upstream.

## Why this document exists

A reader who picks up `vibeswap/` today and tries to understand the protocol top-down hits a wall. The Solidity contracts are the most mature artifact, so they look like the protocol. They are not. They are the *spec*. The protocol is whatever runs on the sovereign chain where the protocol's invariants are actually structural, not enforced by application-layer contract logic on someone else's L1.

The sovereign chain is a VibeSwap-augmented fork of Nervos CKB. This document explains what that means, why CKB is the substrate model, what augmentation surface we need, what shape each existing mechanism takes when it lives natively in cells, and what discipline keeps the iteration honest.

This is the doc to read first if you want to understand where VibeSwap is going. Everything else, including the Solidity contracts and the EVM deployment, is downstream.

## The two layers and the substrate

There are two artifacts plus the substrate they run on.

**Solidity-as-spec.** The contracts under `contracts/` formalize what each mechanism does. Commit-reveal batch auctions, constant-product AMM, Shapley distribution, canonical burn-and-mint messaging, NCI consensus weighting, Lawson constants registry, slash router. These are documented in TRP audit cycles, anchored in formal proofs (Bernhard-grade composition theorem, OPH joint paper), and reviewed by external partners. They are not the deployment target. They are the formal artifact of intent.

**Sovereign chain as deployment.** The VibeSwap chain is a fork of Nervos CKB augmented for VibeSwap requirements. The cells, lock-scripts, and type-scripts under `contracts-ckb/` are the protocol. They run on a substrate where the structural-property doing the work is enforced by consensus, storage, and VM layers we inherit from CKB, with only the minimum set of augmentations VibeSwap requires. State-rent is real. The UTXO/cell model means no global mutable state. Lock-scripts and type-scripts are the authorization and validation primitives. Signed-intent is first-class. Nothing has to defend against reentrancy, because cells are consumed once.

**Substrate as upstream.** Consensus (NC-Max PoW or VibeSwap-NCI variant), networking, transaction pool, block validation, cell storage and indexing, RPC, wallet tooling, and the CKB-VM (RISC-V) all come from Nervos upstream. The augmentation surface is small and explicit, documented at `contracts-ckb/AUGMENTATION_SURFACE.md`. Everything not on that surface uses upstream code unmodified.

The pivot is from "VibeSwap is a smart-contract suite on EVM" to "VibeSwap is a sovereign chain modeled on Nervos CKB whose intent is also specified in Solidity."

## Why CKB

Nervos CKB is the best-engineered blockchain on the substrate-fit axis for what VibeSwap is actually building. The short version: CKB is essentially a Bitcoin version of Ethereum. UTXO-shaped state (Bitcoin lineage, capacity-priced storage, no global mutable state) plus general computation via a RISC-V VM running arbitrary lock-scripts and type-scripts (Ethereum lineage, full programmability). Best of both worlds. The cryptoeconomics are first-class. There is no other blockchain design worth following.

Will-conviction lock 2026-06-07: this substrate choice is not re-evaluated against Solana, Cosmos, Move-VM ecosystems, or any other L1 candidate. When the port runs into friction, the resolution is to reinterpret the mechanism, not to change substrates.

The reasons this is the right substrate, in short:

State-rent is physics. Every cell pays for the storage it occupies, in CKB capacity locked at cell-creation. This dissolves a class of attacks and bad incentives that EVM cannot dissolve at the substrate layer because EVM storage is unpriced past gas-at-write. State-rent is the kind of structural property [P·structure-does-the-work] talks about: the substrate forces honesty about the cost of persistence, no governance pass required.

Cell model dissolves the airgap further. A cell is a self-contained piece of state with its own lock and type validation. Multi-cell composition is explicit at transaction-construction time. There is no implicit global state to corrupt. Settlement is the consumption of specific input cells and the creation of specific output cells, with both witnesses and scripts verifying the transition. This is closer to "structure does the work" than any account-model substrate can get.

Signed intent is first-class. CKB lock-scripts validate based on witnesses that prove an intent was authorized, with arbitrary cryptographic shape. ECDSA, ed25519, SPHINCS+, BLS12-381 threshold signatures, multi-signer aggregation, time-locked authorization. The substrate does not impose a single signature scheme. Mechanism-specific authorization shapes are expressed where they belong: in lock-scripts that the substrate verifies.

No reentrancy class. Cells are consumed exactly once per transaction. The class of vulnerability that has dominated EVM audit work for a decade does not exist. The audit attention freed up goes to the parts of the protocol that actually need it.

Open source upstream. Most of what VibeSwap needs at the substrate layer is already shipped and audited in Nervos upstream code: ckb-std, ckb-script-templates, sUDT and xUDT token standards, common lock-scripts (omnilock, anyone-can-pay, secp256k1), ckb-system-scripts, ckb-merkle-mountain-range, ckb-sdk-rs. The pivot pulls from these, it does not reinvent.

## The augmentation surface

Building an L1 from scratch is reckless. Forking an L1 and augmenting it minimally is tractable. The discipline that makes this honest is naming the augmentation surface explicitly, keeping it as small as possible, and treating everything outside that surface as inherited code that we do not modify.

**Inherited from Nervos CKB upstream, unmodified:**

- CKB-VM (RISC-V 64-bit execution environment for lock-scripts and type-scripts)
- P2P networking, peer discovery, gossip protocol
- Transaction pool, mempool dynamics
- Block validation, header verification, cell-dep resolution
- Cell storage, indexer, RocksDB-backed state
- RPC framework and JSON-RPC API surface
- Wallet protocols, ckb-cli, ckb-sdk-rs
- Common system scripts (secp256k1, omnilock, anyone-can-pay)
- sUDT and xUDT token standards
- Merkle-mountain-range commitment primitives
- ckb-debugger and ckb-script-templates tooling

**Likely augmentation surface, explicit and small:**

- Genesis configuration (network ID, initial cell allocation, native token launch)
- Native token model: VibeSwap's three-token consensus separation (JUL as money / VIBE as governance / CKB-native as state-rent capital) implemented at the chain level rather than only as wrapped tokens
- Consensus weighting if NCI replaces or composes with NC-Max PoW (three-token consensus per the existing NCI design). This is the largest potential augmentation; if NCI lives as application-layer cells consuming PoW outputs, this surface shrinks to zero
- System scripts that VibeSwap requires as substrate-level primitives rather than user-deployable scripts (probably zero; aim is to keep everything as user-deployable scripts)
- Network-level parameters (block time, capacity per block, dust threshold) tuned for VibeSwap's mechanism timing requirements (commit-reveal 10-second batches)

**Discipline rules:**

Anything not on the augmentation surface uses upstream code unmodified. We track upstream Nervos CKB releases and merge them into our fork on a regular cadence. Every augmentation gets justified in this document with the VibeSwap requirement it serves. If a proposed augmentation can be expressed as a user-space cell instead of a substrate change, it goes to user-space. Forking the substrate is the last resort, not the first move.

The augmentation surface is the load-bearing document. It lives at `contracts-ckb/AUGMENTATION_SURFACE.md` and gets updated whenever we propose touching upstream code.

## What exists today on the CKB side

The existing `contracts-ckb/` workspace was shipped 2026-05-24 as the "deep-canonical track" by Cycle 4 RSAW dispatch. It covers the PsiNet primitive economy:

| Crate | Purpose | Status |
|---|---|---|
| `primitive-cell-type-script` | Structural invariants on PrimitiveCell | Scaffold, 3 tests |
| `primitive-cell-lock-script` | SPHINCS+ post-quantum authorship | Scaffold, PQ verify pending |
| `datatoken-cell-type-script` | UDT conservation + genesis split | Scaffold |
| `lineage-vault-cell-type-script` | Royalty accumulator | Scaffold, CRPC witness pending |
| `escrow-vault-cell-type-script` | JUL bond + slash on CRPC dispute | Scaffold, CRPC witness pending |
| `proof-of-mind-lock-script` | Cognitive-work attestation, ed25519 | Code shipped, toolchain blocker |

This work is real and stays. The gap that the sovereign pivot closes is the DEX core: the commit-reveal batch auctions, the constant-product AMM, the Shapley distributor, the canonical burn-and-mint messaging hub, and the NCI three-token consensus weighting. These live as Solidity contracts today. They need CKB-native cell specs, then implementations.

## Component port classification

Every mechanism in the protocol gets classified per [P·substrate-port-pattern]:

**DIRECT-PORT** means the mechanism is already substrate-native or trivially so. ProofOfMind is already a CKB lock-script. MindMesh attestation logs are already append-only cell-shaped. DeterministicShuffle is a pure deterministic library that runs anywhere. Lawson constants are governance-tunable values that map cleanly to cell-data with type-script validation. These need spec docs that confirm the mapping but no architectural reinterpretation.

**REINTERPRET** means the mechanism preserves intent but the substrate shape changes. CommitRevealAuction becomes commit-cells and reveal-cells with batch-settlement consuming all of them in a single transaction. VibeAMM becomes a pool-cell whose type-script enforces the x·y=k invariant, with LP-shares as ownership-cells. ShapleyDistributor becomes event-cells carrying contribution records, with Shapley computation in lock-scripts per the 5-axiom set. MessagingHub becomes burn-receipt-cells and mint-claim-cells with bonded-validator attestations verifying BLS12-381 threshold signatures in lock-scripts. Circuit breakers, Fibonacci rate limits, TWAP oracles all get the same treatment. These need full spec docs because the mechanism's shape changes, even though the intent does not.

**DROP** means the mechanism is an EVM artifact, not needed when the substrate already provides what it was working around. UUPS upgrade proxies: CKB has script upgrades via cell-dep references, so application-layer proxy logic disappears. `nonReentrant` guards: there is no reentrancy on CKB, the modifier vanishes. ERC20 wrappers: CKB has sUDT and xUDT as native token standards, no wrapper needed. Solidity stack-too-deep workarounds: not applicable in RISC-V. The audit surface shrinks because the substrate already covers the concerns.

**UNRESOLVED** are the genuinely hard questions. VibeSwapCore is an orchestrator pattern that has no clean CKB equivalent. Either the logic distributes across per-cell type-scripts, or we accept some coordination shape outside the protocol. NCI three-token consensus weighting (60 PoM / 30 PoS / 10 PoW) might survive the substrate port intact, or it might reinterpret into a substrate-native NCI that uses CKB's existing consensus shape directly. TWAP oracles need a substrate-native time-window primitive, probably via cell-rotation or external attestation. Cross-chain messaging validator registry needs decisions about whether the bonded validator set lives on CKB-native cells or on a federated side-set. These get separate decision documents as they come up.

## Pull from upstream, do not reinvent

Will-rule 2026-06-07: "nervos ckb code is open source so whatever doesn't need to be reinvented can just be pulled from them." Before any component starts as new code, the upstream survey runs. If sUDT covers the token-conservation pattern, use sUDT. If omnilock covers the authorization shape, use omnilock. If ckb-merkle-mountain-range covers the commitment-log primitive, use it.

Every per-component spec opens with two explicit sections: PULL FROM UPSTREAM lists the upstream artifacts the mechanism consumes, and BUILD NEW lists the parts that have no upstream analog and need to be written. The smaller the BUILD NEW list, the smaller the surface to audit, the faster the iteration.

Upstream survey deliverable lives at `contracts-ckb/UPSTREAM.md` (pending) and gets updated as components are specced.

## Iteration discipline

The pivot is not a rewrite. It is component-by-component iteration per [P·incremental-progressive-manifestation]. The Solidity contracts continue to exist as the spec layer. Each component that gets ported gets its sovereign-pivot spec written, then implemented incrementally. Existing TRP audit work, Bernhard-grade composition proofs, the OPH joint paper, and external partner relationships all anchor against the spec layer and are not invalidated by the pivot.

Every commit that touches contracts notes whether it touches the spec stack or the sovereign stack. Specs land in `contracts-ckb/specs/`. Implementations land in `contracts-ckb/<crate-name>/`. Progress is legible from `git log --oneline`.

What does not change: the protocol aims (omnichain DEX, MEV-resistance, coordination-primitive-not-casino), the Solidity spec layer (it stays as the formal artifact), the TRP audit history (anchored against spec), the partner relationships (Pragma OPH convergence, USD8, Bernhard joint papers, Pragma Coherence POC), the JARVIS substrate (already state-rent-shaped in spirit).

## North-star criterion

The pivot is realized when an external reader who finds this repository can read `vibeswap/docs/architecture/ckb-sovereign-vibeswap.md`, then walk into `contracts-ckb/specs/` and follow the per-component specs to a complete understanding of why each cell exists, what each lock-script and type-script validates, and how the cells compose into the mechanisms that compose into the protocol. The Solidity contracts then read as the formal spec layer that any auditor or partner can cross-reference.

Until then, this document evolves with the iteration.

## Match-or-Beat-CoW extensions (2026-06-08)

A near-term VibeSwap-DEX cut ("VibeSwap Lite" per Krakovia's framing) only justifies its existence if it is structurally equal-or-better than CoW Protocol on every mechanism axis. Four extensions, specced in `contracts-ckb/specs/`, close or invert each CoW advantage:

- **Extension 1** — Batch cycle resolver: deterministic N-cycle CoW netting via Tarjan's SCC + DFS. Beats CoW's solver-found 2-cycle pattern. Zero solver fees on cycle surplus.
- **Extension 2** — ZK router verifier: solvers compete to route through external DEX liquidity, but with attached ZK proofs of correctness + bounded search-completeness. Replaces CoW's solver-honesty assumption with structural verification.
- **Extension 3** — Composable resolution paths: per-trader Pareto-best selection across pure-netting / internal-multi-hop / ZK-external. Generalizes CoW's Fair Combinatorial Auction over a strict superset of strategies. Trader controls trust-vs-execution trade-off explicitly.
- **Extension 4** — Substrate-deep liquidity: multi-curve AMM (constant product + concentrated + StableSwap), cross-pool LP portfolios with basket-stability Shapley weighting, thin-pool fee subsidy from emissions. CoW has no first-party liquidity; ours is structurally deeper and Shapley-incentivized for stickiness.

Plan doc: `Desktop/vibeswap-match-or-beat-cow-mechanism-plan-2026-06-08.md`. Spec index: `contracts-ckb/specs/INDEX.md`. Sequencing: Ext 1 + 4 ship in parallel (independent tracks, biggest wins) → Ext 3 (builds on 1+4) → Ext 2 last (heaviest unknown is ZK proving infra fit within CKB-VM cycle budget).

Net result: every mechanism axis where CoW currently beats us flips to equal-or-better, by construction. What remains in CoW's column after this work is maturity (4 years live, multi-chain deployment, ecosystem recognition) — time-and-execution problems, not mechanism problems.

## Living references

- `vibeswap/contracts-ckb/specs/` — per-component CKB specs + match-or-beat extensions
- `vibeswap/contracts-ckb/specs/INDEX.md` — catalog of all specs including extensions
- `vibeswap/contracts-ckb/UPSTREAM.md` — survey of Nervos upstream artifacts we pull from
- `vibeswap/contracts-ckb/AUGMENTATION_SURFACE.md` — explicit set of changes vs upstream Nervos CKB
- `vibeswap/contracts-ckb/FORK_PLAN.md` — operational plan for forking + augmenting
- `vibeswap/contracts-ckb/README.md` — workspace status and toolchain notes
- `vibeswap/docs/research/papers/psinet-ckb-cell-model-canonical-spec.md` — existing PsiNet cell-model spec
- `vibeswap/docs/architecture/ckb/integration/ckb-integration.md` — earlier integration notes (now subsidiary to this doc)
- Memory: `[J·vibeswap-ckb-sovereign-pivot]` in `~/.claude/projects/C--Users-Will/memory/`
