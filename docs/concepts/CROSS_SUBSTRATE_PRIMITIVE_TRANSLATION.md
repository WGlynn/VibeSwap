# Cross-Substrate Primitive Translation

**Status**: meta-pattern (extracted across substrate analyses, 2026-05-06)
**Companions**: [`SUBSTRATE_GEOMETRY_MATCH`](./SUBSTRATE_GEOMETRY_MATCH.md), [`OFF_CHAIN_COMPUTE_ON_CHAIN_VERIFY`](./OFF_CHAIN_COMPUTE_ON_CHAIN_VERIFY.md), [`AUGMENTED_MECHANISM_DESIGN`](../architecture/AUGMENTED_MECHANISM_DESIGN.md)

---

## Statement

A primitive defined on one substrate (EVM, Bitcoin Script, Solana, custom VM) can usually be re-derived on another substrate IF the underlying property is preserved by the substrate's geometry. The translation is not a port — it's a re-derivation.

The implication: protocol designers should reason about *primitives* (which are substrate-independent), not implementations (which are substrate-specific). When migrating across substrates, ask "what property does this primitive enforce?" and re-derive an instance whose substrate-geometry matches the new chain.

## Three worked examples

### Bonded permissionless contest

| Substrate | Instance | Geometry-match |
|-----------|----------|---------------|
| EVM (VibeSwap) | `ClawbackRegistry.openContest` / `OperatorCellRegistry.challengeAssignment` | account-model, storage-as-state, time via `block.timestamp` |
| Bitcoin Script (CAT) | recursive covenant with bonded UTXO + deadline encoded in script | UTXO-model, script-as-state-transition, time via OP_CHECKLOCKTIMEVERIFY |

The property preserved: bond + window + permissionless default-on-expiry. The implementations differ because the substrates differ. EVM uses a `Claim` struct in storage; Bitcoin Script uses recursive covenants over UTXOs. Both enforce the same structural property.

### Witness-based verification

| Substrate | Instance | Geometry-match |
|-----------|----------|---------------|
| EVM (VibeSwap) | `ReasoningVerifier.verifyConsistency(atoms, witness)` | calldata witness, O(n) substitution loop, `revert` on failure |
| Bitcoin Script (CAT) | covenant validates witness data appended to spending transaction | witness in unlock script, OP_VERIFY on each check |

Property preserved: prover (off-chain) supplies a satisfying assignment; verifier (on-chain) substitutes and checks. Cost asymmetry is structural.

### Token state machines

| Substrate | Instance | Geometry-match |
|-----------|----------|---------------|
| EVM (VibeSwap) | ERC-20 with state in mappings (`balanceOf`, `allowance`) | account-model, mappings, `transfer` modifies storage |
| Bitcoin Script (CAT) | recursive covenant carrying `(addr, amt, tokenId)` in UTXO | UTXO-model, state in output, transfer = spend + new outputs |

Property preserved: fungible-token semantics (balance preservation, ownership-by-key, transferability). Account-vs-UTXO is a substrate property; the token's external behavior is the same.

## What translates and what doesn't

Translates cleanly:
- **Properties** (bonded contest, witness verification, ownership, balance preservation, attestation registry).
- **Game-theoretic shapes** (skin-in-the-game, deadline forcing engagement, default-on-expiry encoding burden of proof).
- **Economic mechanisms** (Shapley distribution, commit-reveal, bonded fraud-proof).
- **Cost asymmetries** (prover/verifier asymmetry, off-chain compute / on-chain verify).

Translates with friction:
- **Cryptographic primitives** that aren't available on the target substrate (e.g., BLS aggregation requires precompile or library; pairing-based ZK requires specific curves).
- **Latency-sensitive interactions** when block times differ (Bitcoin's 10-minute blocks vs Ethereum's 12-second blocks).
- **Storage-heavy designs** when the substrate prices storage differently (EVM's state-rent vs Bitcoin's UTXO-set commitment).

Does not translate:
- **Implementation details** that exploit substrate-specific features (EVM-specific gas optimization, Solana's parallelism via account locks, Bitcoin's specific OP codes).
- **Trust assumptions** that don't carry across (a multisig on EVM is not a multisig on Bitcoin without different mechanism).
- **Programming-model affordances** (account-vs-UTXO, mutable-vs-immutable storage, synchronous-vs-async dispatch).

The discipline: identify the property to preserve, re-derive on the new substrate with appropriate primitives, accept that the implementation will look different.

## Why this matters

Three protocol-design implications:

**1. Protocol design is substrate-pluggable.** If the property is what matters, the same protocol can ship on multiple substrates with appropriate re-derivation. VibeSwap's commit-reveal auction could ship on Bitcoin Script (via covenants) or on Solana (via accounts). The design work is in the property; the implementation work is in the substrate.

**2. Borrowing patterns from other substrates is high-value.** When a Bitcoin protocol like CAT achieves modularity through Taproot script paths, EVM protocols can ask "what's the EVM equivalent that preserves the same property?" The answer (V4-style hooks attached to pools) is a different mechanism, same property.

**3. Substrate-specific innovation is often re-derivation.** A new pattern named on Substrate A is frequently the substrate-specific instance of a property that already exists in substrate-independent form. The contribution is the re-derivation, not the property. Recognizing this saves time when designing for a third substrate later.

## The translation discipline

When porting a primitive across substrates, the steps are:

1. **State the property** in substrate-independent terms. Not "EVM's `transferFrom` with allowance-based delegation" — instead "delegate the right to move N units of an asset from A to B without revealing A's private key."
2. **Identify the substrate's geometry** for the new chain. UTXO vs account, mutable storage vs immutable, sync vs async, what cryptographic primitives are available.
3. **Re-derive an instance** that uses the new substrate's geometry to enforce the property. Don't translate the implementation — translate the property.
4. **Verify the re-derivation** preserves the property under the new substrate's adversary model. EVM's reentrancy concerns may not apply on UTXO; UTXO's chain-of-custody concerns may not apply on EVM. Check the security argument from scratch.
5. **Document the cross-substrate observation.** Saying "this is the EVM-side cousin of CAT's recursive covenants" makes the relationship visible to future readers.

## Composition with substrate-geometry-match

[Substrate-geometry-match](./SUBSTRATE_GEOMETRY_MATCH.md) says: pick mechanism shapes that match the substrate's natural geometry. Cross-substrate primitive translation says: when moving a primitive across substrates, re-derive to preserve the geometry-match.

The two compose: substrate-geometry-match selects the shape on each substrate; primitive translation preserves the property across substrates while letting the shape adapt. Same property, geometrically appropriate instances.

## Cross-substrate observations from the VibeSwap codebase

| VibeSwap primitive | Cross-substrate analog |
|--------------------|----------------------|
| `bonded-permissionless-contest` | CAT's recursive-covenant + bond + deadline pattern |
| `verify-by-witness-not-by-execution` | CAT's PSBT-construct-off-chain + Script-verify-on-chain |
| `dual-path-adjudication-preserving-existing-oracle` | Bitcoin's pre/post-OP_CAT progression (pre = indexer + chain; post = covenant + chain) |
| Hooks layer (V4-style) | CAT's Taproot script-path for contract-owned tokens |
| Shapley distribution | Cooperative-game distribution on any substrate that supports `external` calls |
| Commit-reveal auction | CAT's commit + reveal scheme using Taproot |

Each is the same property, instantiated differently to match the substrate's geometry.

## Origin

Pattern named 2026-05-06 after analyzing the CAT Protocol's Bitcoin-Script implementation through the lens of VibeSwap's EVM primitives. The translation work was visible because both protocols are publicly documented; the unification was visible because both follow substrate-geometry-match discipline.

Future application: when VibeSwap considers expanding to another substrate (Solana, custom rollup, hybrid chain), the translation discipline tells what's preserved structurally and what needs re-derivation.
