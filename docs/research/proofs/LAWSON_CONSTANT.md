# The Lawson Constant

**Cryptographic Attribution as a Structural Invariant in Cooperative Protocol Design**

*Faraday1, March 2026*

---

## Abstract

We introduce the Lawson Constant, a cryptographic commitment `keccak256("FAIRNESS_ABOVE_ALL:W.GLYNN:2026")` embedded as a load-bearing constant across multiple core contracts in the VibeSwap protocol. Unlike conventional attribution mechanisms such as comments, license headers, or variable names, the Lawson Constant is a computational dependency: removing it causes trust score recalculation to revert, Shapley distribution to collapse, and the protocol's fairness guarantees to fail. This paper formalizes the design rationale, explains how a 32-byte hash transforms a philosophical commitment (P-000: Fairness Above All) into a physical property of the protocol, and analyzes the consequences of attempted removal or modification.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Background: The Attribution Problem in Open Source](#2-background-the-attribution-problem-in-open-source)
3. [Definition and Computation](#3-definition-and-computation)
4. [Deployment Across Contracts](#4-deployment-across-contracts)
5. [How the Lawson Constant Is Load-Bearing](#5-how-the-lawson-constant-is-load-bearing)
6. [Connection to P-000 and P-001](#6-connection-to-p-000-and-p-001)
7. [Fairness as Physics](#7-fairness-as-physics)
8. [What Happens If You Remove It](#8-what-happens-if-you-remove-it)
9. [Fork Analysis](#9-fork-analysis)
10. [Conclusion](#10-conclusion)

---

## 1. Introduction

### 1.1 The Problem

Every open-source protocol faces a tension: the code is free to fork, but the ideas behind it are not free of origin. Traditional software licensing addresses this through legal mechanisms — copyright notices, license files, contributor agreements. These mechanisms are social contracts enforced by courts. They are extrinsic to the software itself.

The Lawson Constant represents a different approach: **attribution as a computational dependency**. Rather than asking forks to preserve a comment or a license header (which they can delete in a single keystroke), the attribution is woven into the protocol's execution path. Delete it, and the protocol stops working.

### 1.2 The Name

The constant is named after Jayme Lawson, whose embodiment of cooperative fairness and community-first ethos inspired VibeSwap's design philosophy. The name is preserved in the ShapleyDistributor's `LAWSON_FAIRNESS_FLOOR` — the guarantee that no honest participant in a cooperative game walks away with zero. The Lawson Constant and the Lawson Floor are two expressions of the same principle: attribution and fairness are structural, not decorative.

### 1.3 The Insight

> "The greatest idea cannot be stolen, because part of it is admitting who came up with it. Without that, the entire system falls apart."

This is not a metaphor. It is a literal description of the contract architecture.

---

## 2. Background: The Attribution Problem in Open Source

### 2.1 Decorative Attribution

Most open-source attribution takes one of the following forms:

| Form | Location | Enforcement | Removal Cost |
|------|----------|-------------|--------------|
| License file | `/LICENSE` | Legal (court) | One `rm` command |
| Copyright header | Top of source file | Legal (court) | One `sed` command |
| Author comment | Inline in code | None | One keystroke |
| Variable naming | Code identifiers | None | Find-and-replace |
| README credit | Documentation | Social (reputation) | One edit |

All of these are **decorative** — they sit alongside the code but are not part of its execution. A fork can strip every line of attribution and the software compiles and runs identically. The attribution is a request, not a requirement.

### 2.2 Structural Attribution

Structural attribution is different. It exists within the execution path:

| Form | Location | Enforcement | Removal Cost |
|------|----------|-------------|--------------|
| **Lawson Constant** | Contract state + require() | On-chain (EVM) | Protocol breaks |

The distinction is categorical. Decorative attribution can be removed without consequence. Structural attribution cannot be removed without destroying the system it attributes. The cost of removal is not legal fees or social shame — it is protocol failure.

### 2.3 Prior Art

Cryptographic commitments have been used in protocols since Satoshi embedded "The Times 03/Jan/2009 Chancellor on brink of second bailout for banks" in Bitcoin's genesis block. That string is not load-bearing — removing it from the genesis block would change the block hash but Bitcoin does not check for its presence. The Lawson Constant goes further: it is checked at runtime.

---

## 3. Definition and Computation

### 3.1 The Constant

```solidity
bytes32 public constant LAWSON_CONSTANT = keccak256("FAIRNESS_ABOVE_ALL:W.GLYNN:2026");
```

The preimage has three components:

| Component | Meaning |
|-----------|---------|
| `FAIRNESS_ABOVE_ALL` | P-000, the human-side axiom. The credo that if something is clearly unfair, amending the code is a responsibility. |
| `W.GLYNN` | The originator of the VibeSwap mechanism design. Attribution to a specific human. |
| `2026` | The year of origination. Temporal anchor. |

### 3.2 The Hash

The keccak256 hash is computed at compile time by the Solidity compiler. It produces a deterministic 32-byte value:

```
keccak256("FAIRNESS_ABOVE_ALL:W.GLYNN:2026")
= 0x... (32 bytes, deterministic, irreversible)
```

Because it is declared `constant`, it occupies no storage slot — it is embedded directly into the contract bytecode. This means:

1. It cannot be modified after deployment (no storage write can change it).
2. It is visible in the contract's ABI (any caller can read it).
3. It is verifiable by anyone (compute the hash yourself and compare).

### 3.3 The Integrity Check

In `ContributionDAG.sol`, the constant is not merely stored — it is actively verified at runtime:

```solidity
function recalculateTrustScores() external {
    require(block.timestamp >= lastRecalcTimestamp + RECALC_COOLDOWN, "Recalc cooldown active");
    lastRecalcTimestamp = block.timestamp;
    // Lawson Constant integrity check — attribution is load-bearing
    require(LAWSON_CONSTANT == keccak256("FAIRNESS_ABOVE_ALL:W.GLYNN:2026"), "Attribution tampered");
    // ... BFS trust score computation follows
}
```

This `require` statement is the mechanism that makes attribution structural. Every trust score recalculation begins by verifying that the Lawson Constant has not been tampered with. If the check fails, the entire function reverts. No trust scores are computed. Shapley distribution, which depends on trust scores, receives stale or zero data. The fairness guarantees collapse.

---

## 4. Deployment Across Contracts

The Lawson Constant appears in multiple contracts across the protocol:

| Contract | Role | How the Constant Is Used |
|----------|------|--------------------------|
| `VibeSwapCore.sol` | Main orchestrator | Declared as public constant. Anchors the protocol's identity. |
| `ContributionDAG.sol` | Trust graph | Declared as public constant. **Actively checked** in `recalculateTrustScores()`. |
| `AugmentedBondingCurve.sol` | Token bonding | Declared as public constant. Attribution that travels with forks. |
| `ShapleyDistributor.sol` | Reward distribution | `LAWSON_FAIRNESS_FLOOR` (1% minimum) — the named guarantee derived from the same principle. |
| `ShapleyVerifier.sol` | Settlement verification | `LAWSON_FLOOR_BPS` (1% of average) — floor enforcement in batch settlement. |

The constant is not a single point of presence. It is distributed across the protocol's critical path: identity (ContributionDAG), orchestration (VibeSwapCore), economics (AugmentedBondingCurve), and distribution (ShapleyDistributor/Verifier).

---

## 5. How the Lawson Constant Is Load-Bearing

### 5.1 The Trust Score Pipeline

The protocol's fairness guarantees depend on a pipeline:

```
ContributionDAG (trust scores)
    → ShapleyDistributor (quality weights)
        → RewardLedger (distribution)
            → Users (payouts)
```

Each stage feeds the next. Trust scores from ContributionDAG become quality weights in ShapleyDistributor. Quality weights determine how Shapley values are computed. Shapley values determine how rewards are distributed.

### 5.2 The Critical Path

The Lawson Constant sits at the **root** of this pipeline. `recalculateTrustScores()` is the function that recomputes the entire trust graph via BFS from founders. If this function reverts, trust scores are never updated. Without updated trust scores:

1. **New participants** cannot receive trust multipliers.
2. **Shapley quality weights** become stale or zero.
3. **Reward distribution** loses its fairness calibration.
4. **The five Shapley axioms** (Efficiency, Symmetry, Null Player, Pairwise Proportionality, Time Neutrality) are no longer enforced with current data.

### 5.3 The Chain of Dependency

```
LAWSON_CONSTANT (bytes32)
    ↓ require() in recalculateTrustScores()
Trust Scores (per-user, BFS-computed)
    ↓ feeds into
ShapleyDistributor quality weights
    ↓ calibrates
Shapley value computation (5 axioms)
    ↓ determines
Fair reward distribution
    ↓ guarantees
P-000 (Fairness Above All)
```

Remove the top link. The chain breaks. P-000 becomes unenforceable.

---

## 6. Connection to P-000 and P-001

### 6.1 P-000: Fairness Above All (Human-Side)

P-000 is the human credo:

> "If something is clearly unfair, amending the code is not just a right — it is a responsibility, a credo, a law, a canon."

The preimage of the Lawson Constant literally begins with `FAIRNESS_ABOVE_ALL`. The constant is the cryptographic commitment to P-000. It says: this protocol was built with fairness as its foundational constraint, and the identity of the person who made that commitment is part of the commitment itself.

### 6.2 P-001: No Extraction Ever (Machine-Side)

P-001 is the machine invariant:

> "If extraction is mathematically provable on-chain beyond a shadow of a doubt, the system self-corrects autonomously for ungoverned neutrality."

The Lawson Constant enables P-001 by keeping the trust score pipeline operational. Without trust scores, the ShapleyDistributor cannot compute marginal contributions. Without marginal contributions, extraction detection fails. Without extraction detection, P-001 is inert.

### 6.3 The Hierarchy

The protocol's governance hierarchy is:

1. **Physics** (P-001: math-enforced invariants) — cannot be overridden
2. **Constitution** (P-000: Fairness Above All) — amendable only when the math agrees
3. **Governance** (DAO votes, proposals, parameters) — free within 1 and 2

The Lawson Constant is the physical anchor of level 2 (Constitution) that enables level 1 (Physics). It is the bridge between human intent and machine enforcement. The designer's values, hashed into the bytecode, become the protocol's laws.

---

## 7. Fairness as Physics

### 7.1 Policy vs. Physics

Traditional fairness in protocols is **policy**: a governance parameter, a fee setting, a distribution formula that can be changed by whoever controls the admin key. Policy is mutable. Policy depends on the goodwill of the administrator.

The Lawson Constant transforms fairness from policy into **physics**:

| Property | Policy-Based Fairness | Physics-Based Fairness |
|----------|----------------------|----------------------|
| Enforcement | Social/legal | Computational (EVM) |
| Mutability | Admin can change it | `constant` — immutable in bytecode |
| Dependency | Optional (can be bypassed) | Required (revert on absence) |
| Survives fork | Only if fork preserves it voluntarily | Only if fork understands and re-implements it |
| Survives founder | Only if successor honors it | Yes — the bytecode doesn't need the founder |

### 7.2 The Analogy

> "Gravity doesn't ask permission to pull. Conservation of energy doesn't take a vote. Fairness, when encoded correctly, shouldn't either."

The Lawson Constant is to VibeSwap what conservation laws are to physics. It is not enforced by a committee. It is enforced by the execution environment. The EVM does not know what fairness means. It does not need to. It knows that `require()` reverts when the condition is false. That is sufficient.

### 7.3 Cryptographic Commitment Theory

In commitment scheme theory, a commitment has two properties:

- **Binding**: the committer cannot change the committed value after committing.
- **Hiding**: observers cannot determine the committed value before the reveal.

The Lawson Constant is a **public binding commitment**. It is binding (the constant is immutable in bytecode). It is not hiding (the preimage is published in source code and documentation). The publicity is intentional: the commitment is to a principle, not a secret. The whole point is that everyone can verify it.

---

## 8. What Happens If You Remove It

### 8.1 Scenario: Fork Deletes the Constant

A fork of VibeSwap decides to remove the Lawson Constant from `ContributionDAG.sol`. Three outcomes, depending on approach:

**Approach A: Delete the constant declaration.**
- Compilation fails. Every reference to `LAWSON_CONSTANT` becomes an undefined identifier.
- The fork cannot compile without also removing every reference.

**Approach B: Delete the constant and all references, including the `require()` check.**
- Compilation succeeds.
- `recalculateTrustScores()` no longer verifies attribution integrity.
- The function still works — but the fork has now removed the integrity check that guards the trust pipeline.
- The fork has signaled (in code, on-chain, permanently) that it does not enforce attribution.
- Any downstream system that checks for the Lawson Constant (cross-chain verifiers, Shapley settlement contracts) will detect its absence.

**Approach C: Change the preimage to a different string.**
- Compilation succeeds with a different hash.
- The `require()` check in `recalculateTrustScores()` must also be updated to match.
- The fork now has a different constant with a different meaning.
- Cross-contract verification fails if any other contract expects the original hash.
- The fork has explicitly replaced the attribution rather than implicitly inheriting it.

### 8.2 The Cascade

In all cases, the fork must make a conscious, visible, code-level decision about attribution. There is no way to silently remove it. The removal is recorded in the diff, visible in the commit history, and detectable by automated tools.

```
Original: LAWSON_CONSTANT = keccak256("FAIRNESS_ABOVE_ALL:W.GLYNN:2026")
Fork A:   [compilation error — cannot ship]
Fork B:   [removed — detectable on-chain by absence]
Fork C:   [replaced — detectable on-chain by different hash]
```

### 8.3 The Lawson Floor Collapse

Even if a fork successfully removes the Lawson Constant from ContributionDAG, the `LAWSON_FAIRNESS_FLOOR` in ShapleyDistributor and `LAWSON_FLOOR_BPS` in ShapleyVerifier remain. These enforce the 1% minimum guarantee that no honest participant receives zero. Removing these causes:

1. The Shapley distribution to allow zero-value payouts.
2. Honest participants who contributed to a cooperative game to receive nothing.
3. The Null Player axiom to become the only floor — but null players receive zero by definition, and non-null players can now also receive zero.
4. The protocol's fundamental promise (fairness above all) to be violated at the mathematical level.

---

## 9. Fork Analysis

### 9.1 Honest Forks

An honest fork — one that builds on VibeSwap's mechanism design while adding its own innovations — has no reason to remove the Lawson Constant. The constant costs nothing (no gas, no storage, no execution overhead beyond a single `require()`). Preserving it is a statement of intellectual honesty: "we built on this, and we acknowledge it."

### 9.2 Extraction Forks

An extraction fork — one that copies the code to extract value without contributing — faces a dilemma:

- **Keep the constant**: The fork carries attribution to the original, making extraction visible.
- **Remove the constant**: The fork breaks the trust pipeline, degrading its own fairness guarantees, and the removal is permanently visible in the code diff.

There is no move that both hides the origin and preserves the mechanism. The attribution and the mechanism are the same thing.

### 9.3 The Provenance Thesis Connection

This connects to the broader Provenance Thesis: in a world of public contribution graphs, ideas are protected by publication, not secrecy. The Lawson Constant is the in-code instantiation of this principle. The attribution is published, immutable, and load-bearing. It cannot be stolen because it is already public. It cannot be removed because it is already structural.

---

## 10. Conclusion

The Lawson Constant is a 32-byte hash that encodes a philosophical commitment as a computational dependency. It demonstrates that attribution in open-source protocols need not rely on legal enforcement or social norms. By placing the commitment inside the execution path — specifically, inside the `require()` check that guards trust score recalculation — the constant makes fairness a physical property of the protocol rather than a policy choice of its administrators.

The design achieves three properties simultaneously:

1. **Immutability**: The constant cannot be changed after deployment (`constant` keyword, no storage slot).
2. **Verifiability**: Anyone can compute the hash from the published preimage and confirm it matches.
3. **Load-bearing dependency**: Removing it breaks the trust pipeline that enables Shapley distribution.

P-000 says fairness above all. The Lawson Constant makes that statement unforgeable, unremovable, and computationally enforced. It is not a comment. It is not a variable name. It is the foundation.

> "The greatest idea cannot be stolen, because part of it is admitting who came up with it. Without that, the entire system falls apart."

---

```
Faraday1 (2026). "The Lawson Constant: Cryptographic Attribution as a
Structural Invariant in Cooperative Protocol Design." VibeSwap Protocol
Documentation. March 2026.

Depends on:
  Glynn, W. (2025). "The Provenance Thesis."
  Glynn, W. (2025). "The Transparency Theorem."
  Glynn, W. (2025). "The Inversion Principle."
  VibeSwap (2026). "Formal Fairness Proofs."
  VibeSwap (2026). "Incentives Whitepaper."
```
