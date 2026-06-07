# CAT Protocol — Technical Integration Notes

*Companion to cat-protocol-substrate-analysis.md · 2026-05-06*

---

The substrate analysis covers what CAT closes structurally. This note integrates the implementation-level patterns from the protocol's specification and SDK — what's worth borrowing for protocol design generally, beyond the substrate framing.

## Recursive covenants as state-machine primitive

CAT's core mechanism: *recursive covenants* enforce that a token's defining script propagates from parent UTXOs to the current spending transaction, and on to children. Each token UTXO carries `(addr, amt)` plus a `tokenId` (the genesis outpoint, `txid_vout`), and the script enforces:

1. Owner authorization (signature check on `addr`).
2. Script propagation parent → child (recursion preservation).
3. `tokenId` propagation (color preservation).
4. Sum preservation (input amount = output amount).
5. `tokenId` faithfulness — when grandparent script ≠ token script, `tokenId` must equal grandparent's genesis outpoint.

The fifth condition is the inductive proof: a transaction proves valid lineage from genesis by including data from its parent and grandparent. This is the *contract ID* property the protocol calls out as generalizable beyond CAT — an uncopyable unique ID derived from a UTXO/outpoint that any covenant-using protocol can use.

The pattern: a recursive covenant is a state-machine primitive on UTXO chains. State = the data the covenant carries; transition = the constraint the covenant enforces; identity = the inductive proof from genesis. This is a complete enough primitive to express "fungible token + uniqueness + balance-preservation" without an account model.

**Cross-substrate observation**: VibeSwap's [Bonded Permissionless Contest](../../concepts/primitives/bonded-permissionless-contest.md) primitive uses a similar shape on EVM — a state machine (OPEN → VOTING → APPROVED → ...) with required-data-from-prior-state propagation. CAT's recursive covenant is the UTXO-substrate version of the same pattern.

## Guard contracts as separated verification

CAT separates *token transfer logic* from *amount-check logic*. The `xferGuard` is a separate contract checked alongside the token contract in a transfer transaction:

```
transfer transaction inputs:
  - token UTXO 1
  - token UTXO 2
  - guard input (xferGuard contract verifying balance preservation)

transfer transaction outputs:
  - token UTXO (combined)
  - guard output (refreshed for next transfer)
```

The token contract validates ownership and script propagation; the guard validates balance preservation. Burning is the same shape with a `burnGuard` that requires no token outputs.

Why separate? Because the rules can vary. A different transfer policy — e.g., a token with a transfer cap, or a token that locks some balance until block height N — uses a different guard contract without redefining the token. The token's identity is preserved across multiple guard policies.

**Cross-substrate observation**: This is the same shape as VibeSwap's V4-style hooks. Pool stays unchanged; hooks attached to the pool implement extension. CAT's tokens stay unchanged; guards attached to the token implement extension. The shape: factor the unchanging core from the variable policy; let policy compose without modifying core.

## Minter as state machine

CAT20's `OpenMinterV2` example exposes the minter contract's state shape:

```
minter state = (
  tokenScript,           // locking script of the token Taproot output
  isPremined,            // bool — has premine been processed?
  remainingSupplyCount   // int — supply still mintable from this UTXO
)
```

A minter UTXO is spent to produce:
1. New minter UTXOs (continuing the minting capability).
2. New token UTXOs (newly minted supply).

The mint logic:
- Pre-states validation + back-to-genesis validation (anchors the minter to its genesis transaction).
- Premine handling (if `isPremined == false` AND token metadata says `premine == true`, mint premine; flip flag).
- State transition (split out new minter UTXOs with reduced `remainingSupplyCount`; build token UTXOs).

Limited supply emerges as a degenerate case: the last mint transaction creates no new minter UTXOs. Minting ability terminates; supply is provably finite from on-chain inspection.

**Cross-substrate observation**: This is the [generation-isolated commit-reveal](../../concepts/primitives/generation-isolated-commit-reveal.md) pattern in different clothes. State carries forward; identity is preserved; supply / generation tracking is structural rather than indexer-tracked. EVM's storage-as-implicit-state contrasts with CAT's UTXO-as-explicit-state — different substrates, same property.

## Parallel mint via N-ary tree

The natural failure mode of UTXO-based minting: only one user can spend a given minter UTXO. Open mints with a single minter UTXO produce serial contention; only one transaction per block succeeds.

CAT's mitigation: each mint can produce N new minter UTXOs (parameter chosen at deploy). The minter set grows as a tree — generation 1 has 1 minter, generation 2 has N, generation k has N^(k-1). Contention drops exponentially.

For NFTs (CAT721) that need unique localIds within a collection, the BFS (level-order) numbering scheme assigns IDs deterministically across the tree:
- Reveal transaction = node 0 (the tree root).
- Generation 1 minters = nodes 1, 2, ..., N.
- Generation 2 = nodes 1+N, 2+N, ..., 2N.
- And so on.

A minter at tree position `k` produces NFTs with `localId = k`. Parallel minting still produces non-conflicting IDs because the tree position is structural, not race-determined.

**Cross-substrate observation**: This is structurally identical to the [Fibonacci Scaling](../../../contracts/libraries/FibonacciScaling.sol) pattern — graceful saturation under contention through structured branching. Different math (golden-ratio damping vs N-ary tree growth), same property: contention dissolves through branching rather than by limiting access.

## Contract-owned tokens via Taproot script path

The most architecturally interesting CAT extension: tokens can be sent to *contract addresses* (not key-controlled addresses) via Taproot's script-spend path.

A token UTXO has two spend paths:
- **Key path**: signature from the owner's private key (standard).
- **Script/contract path**: a public key derived from a contract via Taproot, with key-spend disabled. Tokens at this address are controlled by the contract's logic, not by any key.

When tokens at a contract address are transferred, the token contract requires a *neighboring input* in the same transaction that spends a UTXO at the owner contract address. The contract that controls the tokens runs its own logic (covenant inspection of the transaction); the token contract enforces ownership-by-contract via the neighboring input requirement.

This makes CAT tokens infinitely composable: any contract can hold tokens; any contract can be deployed independently; CAT tokens can flow into AMMs, lending pools, escrow, atomic swaps, sell orders — without protocol-level changes.

**Cross-substrate observation**: This is what makes CAT *modular* in the same sense as ERC-20 + EVM. EVM contracts can hold ERC-20 tokens trivially because ERC-20's `transferFrom` uses contract-callable approvals. CAT achieves the same composability through a different substrate property — Taproot key derivation from contract scripts. Both reach modularity; the path is substrate-specific.

## Sell-order pattern as concrete demonstration

CAT's example sell-order contract demonstrates contract-owned tokens in practice:

```
sell contract guarantees:
  - buyer gets tokens she pays for
  - seller gets paid at specified price × quantity
  - remaining tokens return to the same sell contract (recursive covenant)
```

Partial fills work because the recursion creates a new sell-contract output for the remainder. The order can be filled across many transactions; everything is miner-validated; no off-chain order book required.

**Cross-substrate observation**: This is the [commit-reveal auction](../../architecture/RECURSIVE_BATCH_AUCTIONS.md) pattern's UTXO cousin. Both achieve order-book liveness without an off-chain matching engine. Different mechanism (commit-reveal batching vs covenant-recursive partial fills), same structural property: liveness without trusted intermediary.

## The SDK posture

CAT's SDK (`@cat-protocol/cat-sdk`) is structured around the UTXO-first design principle:

> *"Design your application's logic from the very beginning based on the UTXO model. The primary function of the layer-1 smart contract is verification, not computation."*

Two implications worth noting:

**1. Verification-not-computation as design principle.** L1 smart contracts on UTXO substrates are constraint validators, not state-machine engines. The contract checks that a transaction is valid; it does not run general-purpose logic. This matches the substrate's geometry (UTXO + Script + miner validation) and produces predictable gas / Script-budget consumption.

VibeSwap's reasoning verifier follows the *same* principle on EVM: `verifyConsistency` substitutes a witness and checks each atom; it does not solve for the witness. The verifier is verification-not-computation, just on EVM substrate.

**2. SDK as PSBT builder.** The CAT SDK constructs Partially Signed Bitcoin Transactions (PSBTs) with covenant outputs. The user (or downstream tool) signs and broadcasts. State transitions are off-chain reasoning that produces on-chain-verifiable transactions.

This is the same shape as the witness in VibeSwap's reasoning verification: prover (off-chain) constructs a satisfying assignment; verifier (on-chain) confirms. The SDK is the prover-side tooling.

## What's worth borrowing across substrates

For protocol designers working on EVM, on Solana, on a custom chain — the patterns CAT operationalizes have substrate-independent forms:

| CAT pattern | Substrate-independent form |
|-------------|---------------------------|
| Recursive covenants | State-machine primitive with required-data-propagation |
| `tokenId` from genesis outpoint | Structural identity via inductive proof from creation event |
| Guard contract separation | Factor variable policy from unchanging core (token, pool, claim, etc.) |
| Parallel mint via N-ary tree | Branching to dissolve contention rather than serializing access |
| Contract-owned tokens (Taproot script path) | Letting contracts hold assets through substrate-native ownership semantics |
| Sell-order recursion | Liveness without off-chain matching via covenant-driven partial fills |
| UTXO-first design principle | Match application architecture to substrate geometry |
| SDK as PSBT builder | Off-chain prover, on-chain verifier asymmetry |

VibeSwap already implements several of these on EVM (V4 hooks, bonded contests, Fibonacci scaling, witness verification). CAT implements them on Bitcoin Script. The cross-pollination is the protocol-design alphabet: same letters, different language.

## Architecture recommendation when integrating CAT-style thinking on other substrates

1. **Start with state shape, not call shape.** What state propagates? Where does identity come from? What's the inductive base?
2. **Factor verification from execution.** Make L1 contracts validators, not engines. Keep computation off-chain.
3. **Separate policy from primitive.** Token + guard, pool + hook, claim + contest — all instances of the same factoring.
4. **Branch instead of serialize.** Where contention is structural, design for parallel paths from the beginning.
5. **Match SDK posture to substrate.** Provers construct, verifiers check. The split should be visible in how the SDK is shaped.

These five recommendations apply whether the substrate is Bitcoin Script, EVM, Solana programs, or a custom chain. CAT's value isn't its specific Bitcoin implementation; it's the demonstrated re-derivation of the architectural alphabet on a substrate where many designers assume "general computation isn't possible, so token protocols need indexers." CAT's existence falsifies the assumption. The same falsification likely exists for other off-chain dependencies on other substrates.

## Source references

- **CAT Protocol implementation**: [github.com/CATProtocol/cat-token-box](https://github.com/CATProtocol/cat-token-box) — canonical reference implementation, contracts, SDK, CLI tools.
- **CAT Protocol website**: [catprotocol.org](https://catprotocol.org) — protocol documentation, CAT20 / CAT721 specifications, SDK reference.
- **CAT SDK**: `npm i @cat-protocol/cat-sdk` — JavaScript SDK for building CAT-protocol applications.
- **Sibling analysis paper**: [`cat-protocol-substrate-analysis.md`](./cat-protocol-substrate-analysis.md) — substrate-level reading through JARVIS lenses (airgap closure, substrate-geometry-match, expressibility-as-the-gate, modularity, SPV preservation).
