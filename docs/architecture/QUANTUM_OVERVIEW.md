# Quantum-Resistant Subsystem — Architecture Overview

**Status**: shipped (opt-in security layer)
**Subsystem**: `contracts/quantum/`
**Companions**: [`SECURITY_MECHANISM_DESIGN.md`](./SECURITY_MECHANISM_DESIGN.md), [`ASYMMETRIC_COST_CONSENSUS.md`](./ASYMMETRIC_COST_CONSENSUS.md)

---

## What this subsystem does

Adds optional post-quantum cryptographic primitives to VibeSwap. Hash-based signatures and key agreement that remain secure under Shor's algorithm — i.e., when sufficiently powerful quantum computers can break ECDSA and RSA.

The design is **opt-in, not protocol-wide-mandatory**. Users who want quantum-hardening for high-value operations register quantum keys; standard ECDSA flows continue working for everyone else. The two security levels coexist; high-value ops can require both.

This is structurally important: forcing every user into Lamport-style signatures (which are large) would balloon gas costs for the entire network. Opt-in keeps the cost on the users who need the property.

## File map

```
contracts/quantum/
├── LamportLib.sol          ← library: Lamport one-time signature verification
├── PostQuantumShield.sol   ← protocol-wide PQ key agreement + authentication primitives
├── QuantumGuard.sol        ← inheritable mixin: add PQ authorization to any contract
└── QuantumVault.sol        ← Lamport+Merkle key management with on-chain root
```

## Per-component role

### LamportLib — the primitive

Pure-hash quantum-resistant signatures. The math:

- Key generation (off-chain): 256 pairs of random 256-bit secrets `(sk[i][0], sk[i][1])`. Public key `pk[i][j] = SHA256(sk[i][j])`. Public key hash `H(pk) = keccak256(pk[0][0] || pk[0][1] || ...)`.
- Signing (off-chain): hash message, reveal `sk[i][0]` or `sk[i][1]` per bit `i` of the hash.
- Verifying (on-chain): hash each revealed `sk[i]` to derive `pk[i]`, reconstruct `H(pk)`, compare to registered root.

Each keypair is **one-time-use**: signing reveals exactly half the secret, halving the security margin. A second signing would reveal the rest.

The library exposes `verifyLamport(message, signature, publicKeyRoot) → bool`. No state; pure verification.

### QuantumVault — Merkle-managed key sets

Lamport keys are one-time. A user needs many. `QuantumVault` solves the key-management problem:

1. User generates N Lamport keypairs off-chain (e.g., 256).
2. User builds a Merkle tree of the public-key hashes; registers only the root on-chain.
3. For each quantum-signed operation, user provides:
   - the Lamport signature (revealed sk halves)
   - a Merkle proof that this key is part of the registered set
4. Contract verifies both; marks the key as used (one-time only).

Storage cost is one Merkle root per user, not N public keys. Security property: even with a quantum computer, an attacker cannot derive unused private keys from the Merkle root (the leaves are hashes, the tree is a hash tree, no algebraic structure to exploit).

Key replenishment: when N keys are exhausted, the user registers a new Merkle root signed by the prior root's last key. Continuity without re-onboarding.

### QuantumGuard — inheritable mixin

`QuantumGuard` is the integration surface. Any contract that wants opt-in quantum hardening:

```solidity
contract MyContract is QuantumGuard, ... {
    function init() external initializer {
        _initQuantumGuard();
        ...
    }

    function highValueOp() external _requireQuantumAuth {
        ...
    }
}
```

Users register quantum keys via `registerQuantumKey(merkleRoot)`; contract operations gated by `_requireQuantumAuth` require a Lamport+Merkle proof bundle in addition to standard signatures.

The mixin handles all the bookkeeping: key registration, used-key tracking (so one-time guarantee holds), root rotation. The inheriting contract just decorates its sensitive entry-points.

### PostQuantumShield — protocol-wide layer

`PostQuantumShield` is the wider primitive set, beyond simple signatures:

| Primitive | Purpose |
|-----------|---------|
| Lamport OTS | one-time signatures for high-value transactions |
| Merkle Signature Scheme (MSS) | many signatures from one key tree (the QuantumVault scheme generalized) |
| Hash-based key agreement | quantum-safe key exchange (replaces Diffie-Hellman) |
| SPHINCS+-style stateless signatures | repeated signing without key exhaustion |
| Quantum-safe commit-reveal binding | binding step in `CommitRevealAuction` survives PQ attacks |

Integration anchors:
- `TrinityGuardian` (consensus): node identity verified with quantum keys.
- `ProofOfMind` (legitimacy): consensus votes can be quantum-signed.
- `VibeBridge` (cross-chain): cross-chain messages can require quantum authentication.

These are *integration points*, not mandatory. Each subsystem decides whether quantum hardening is required for which operations. The cost-benefit is local.

## Why opt-in beats mandatory

A protocol-wide mandatory PQ regime is tempting in theory and broken in practice:

- **Gas cost**: a Lamport signature is ~16KB (256 hashes × 2 halves). Forcing this on every transaction explodes every gas budget.
- **Migration cost**: existing wallets, infrastructure, and tooling assume ECDSA. A hard switchover breaks the existing world.
- **Threat-model premature**: quantum computers capable of breaking 256-bit ECC are not currently extant. Optimizing for a threat model that may be a decade out, at the cost of present usability, is bad engineering.

Opt-in inverts the trade: users who hold genuinely high-value positions or who want long-horizon security register quantum keys and pay the gas. Users with rotational, low-stakes positions stay on ECDSA. The protocol bridges both — high-value contract operations require quantum auth via `QuantumGuard`; everything else uses standard signatures.

When quantum computers materialize, the migration path is straightforward: contracts that currently make quantum auth optional flip a switch to make it required, and the existing infrastructure already supports it. No protocol redesign needed.

## Composition with broader stack

| Quantum primitive | Used by | For |
|-------------------|---------|-----|
| `QuantumGuard` mixin | any high-value contract | optional quantum auth on sensitive ops |
| `QuantumVault` | high-value individual users | personal long-horizon security |
| `LamportLib` | both above | underlying signature math |
| `PostQuantumShield` | TrinityGuardian, ProofOfMind, VibeBridge | protocol-layer PQ primitives |

The pattern: the library is the primitive, the vault is the user-facing key manager, the guard is the inheritable integration surface, and the shield is the protocol-wide layer. Each layer has a single concern.

## Configurability

| Variable | Default | Notes |
|----------|---------|-------|
| Lamport key bit size | 256 | hard-coded; matches SHA-256 output |
| Merkle tree depth | configurable per-user | trade-off: deeper tree = more keys per registration |
| key replenishment policy | per-application | some apps require ahead-of-time replenishment; others lazy-replenish |
| quantum-auth requirement | per-contract | each `QuantumGuard`-inheriting contract decides which ops require it |

## Threat-model notes

The quantum subsystem assumes:
- Hash functions remain quantum-resistant (currently true for SHA-256 / Keccak under Grover's algorithm at 128-bit security).
- The user keeps Lamport secret keys offline / in a hardware module — the same posture as cold-wallet storage today.
- Used keys are tracked correctly on-chain (the contract enforces one-time-use; replay is structurally prevented).

The subsystem does NOT assume:
- That users will adopt quantum hardening preemptively. Most won't, until they need to.
- That the entire network upgrades simultaneously. The opt-in design works under partial adoption.
- That ECDSA is broken today. ECDSA continues to work; quantum is additive.

## Related

- [`SECURITY_MECHANISM_DESIGN.md`](./SECURITY_MECHANISM_DESIGN.md) — broader protocol security framing.
- [`ASYMMETRIC_COST_CONSENSUS.md`](./ASYMMETRIC_COST_CONSENSUS.md) — sibling: making attacks asymmetrically expensive.
- `contracts/identity/AGIResistantRecovery.sol` — sibling: recovery primitives resistant to AI-scale attack vectors.
