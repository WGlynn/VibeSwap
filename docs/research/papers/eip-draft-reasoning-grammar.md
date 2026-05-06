# EIP Draft: Standard Assertion Grammar for On-Chain Reasoning Chains

**Status**: draft (vibeswap-internal, pre-EIP)
**Companion**: [on-chain-reasoning-verification.md](./on-chain-reasoning-verification.md)
**Origin**: GitHub discussion [WGlynn/VibeSwap#18](https://github.com/WGlynn/VibeSwap/discussions/18)

---

## Abstract

This document drafts a four-EIP standardization stack for on-chain reasoning verification. The stack defines: (1) a canonical assertion grammar, (2) a witness format for consistency proofs, (3) inference rules for fraud proofs, and (4) public-input layout for ZK gate-pass attestations. With these standardized, multiple protocols can verify reasoning interoperably, agents can submit chains across contracts, and tooling (SMT exporters, ZK circuit compilers, fraud-proof builders) can target a single specification.

## Motivation

`require()` chains in Solidity verify *state*, not *reasoning*. As AI agents become economic actors and human DAOs grow, the question "did this transaction come from sound reasoning?" becomes financially load-bearing. Off-chain reasoning checks (BECAUSE / DIRECTION / REMOVAL) work informally; without a standard format, they cannot compose on-chain.

Each protocol that wants reasoning verification today must invent its own atom format, its own witness encoding, its own fraud-proof schema. This is a Schelling-point problem, not a research problem — what is needed is a shared grammar.

## EIP-A: Atomic Assertion Grammar

### Definitions

An **atom** is a single propositional assertion of the form:

```
atom ::= var COMP const
       | var COMP var
       | bool_var
       | NOT bool_var
```

Where:
- `var` is a `bytes32` variable identifier in a domain-namespaced encoding (see §"Var-key namespace")
- `const` is a signed 256-bit integer
- `bool_var` resolves to 0 or 1
- `COMP` ∈ {`EQ`, `NEQ`, `LEQ`, `LT`, `GEQ`, `GT`}

A **chain** is an ordered sequence of atoms, semantically interpreted as their conjunction. Order is significant for hashing but not for logical interpretation.

Forbidden constructs (deliberately, to keep consistency-checking tractable):
- disjunction (OR)
- negation of compound expressions (only `bool_var` admits direct negation via `NOT`)
- existential or universal quantifiers
- recursion or self-reference
- arithmetic operations beyond constant folding (no `var + var`; use intermediate vars)

### Solidity Encoding

```solidity
enum Op { EQ, NEQ, LEQ, LT, GEQ, GT, BOOL_TRUE, BOOL_FALSE }

struct Atom {
    bytes32 lhsVarKey;
    Op op;
    bool isRhsVar;
    bytes32 rhsVarKey;
    int256 rhsConst;
}
```

Boolean atoms set `op = BOOL_TRUE` or `op = BOOL_FALSE`; `lhsVarKey` is the boolean var; `isRhsVar`, `rhsVarKey`, and `rhsConst` are unused (zeroed canonically).

### Var-key namespace

`bytes32` var-keys SHOULD be derived from a canonical encoding:

```
varKey = keccak256(abi.encode(domain, contract, selector, params))
```

Where:
- `domain` ∈ `{"vibeswap", "usd8", "lido", ...}` — protocol identifier
- `contract` is the contract address
- `selector` is a 4-byte selector or named constant identifying the variable
- `params` is an optional ABI-encoded tuple parameterizing the variable (e.g., a token address or user address)

This scheme avoids collisions across protocols and admits per-domain registries that resolve var-keys to documentation, units, and bounds.

### Chain Hash

```
chainHash = keccak256(abi.encode(atoms))
```

Order-sensitive. Reordering produces a distinct chain.

## EIP-B: Witness Format for Consistency Proofs

### Definitions

A **witness** is an assignment from var-keys to integer values, intended to demonstrate that an atom chain is internally satisfiable.

```solidity
struct Witness {
    bytes32[] varKeys;
    int256[] varValues;
}
```

The witness MUST cover every var-key referenced by any atom in the chain (LHS or RHS). Verifiers MUST revert with `WitnessVarMissing(bytes32)` if a referenced var-key is absent.

### Verification Procedure

```
for each atom in chain:
    lhs = lookup(atom.lhsVarKey, witness)
    rhs = atom.isRhsVar ? lookup(atom.rhsVarKey, witness) : atom.rhsConst
    if not eval(atom.op, lhs, rhs):
        revert AtomFailed(atomIndex)
```

Bool atoms additionally require the looked-up value to be exactly 0 or 1. Other values revert `InvalidBoolValue`.

### Witness Origination

Provers SHOULD obtain witnesses from an SMT solver run over the atom chain. Reference exporters target Z3 SMT-LIB:

```
(declare-const amount Int)
(declare-const balance Int)
(declare-const max_withdraw Int)
(declare-const not_frozen Bool)
(assert (<= amount max_withdraw))
(assert (>= balance amount))
(assert not_frozen)
(check-sat)
(get-model)
```

The model returned (if SAT) is the witness. UNSAT chains cannot be on-chain submitted under this EIP — they should be decomposed or escalated to the fraud-proof tier (EIP-C).

## EIP-C: Inference Rules for Fraud Proofs

### Definitions

A **fraud proof** is a derivation showing that two atoms in a submitted chain jointly entail false. Derivations are sequences of inference-rule applications, terminating at a contradiction rule.

```solidity
enum InferenceRule {
    MODUS_PONENS,           // A, A→B ⊢ B
    MODUS_TOLLENS,          // ¬B, A→B ⊢ ¬A
    AND_ELIM_LEFT,          // A∧B ⊢ A
    AND_ELIM_RIGHT,         // A∧B ⊢ B
    CONTRADICTION_DIRECT,   // A, ¬A ⊢ ⊥
    CONTRADICTION_NUMERIC,  // x ≤ c, x > c ⊢ ⊥
    CONTRADICTION_BOOL      // bool_var=true, bool_var=false ⊢ ⊥
}

struct DerivationStep {
    InferenceRule rule;
    uint256[] premiseIndices;
    Atom conclusion;
}
```

Premise indices reference earlier atoms in the chain or earlier derivation steps. The verifier walks the derivation step-by-step:

1. For each step, fetch the premises (from chain or prior steps).
2. Check that the rule's input pattern matches the premises.
3. Check that the rule's output pattern matches `conclusion`.
4. If all steps validate AND the final step's rule is `CONTRADICTION_*`, the proof is upheld.

### Numeric Contradiction (worked example)

Given chain atoms:
- A1: `amount LEQ 100`
- A2: `amount GT 100`

Derivation:
- step 0: `CONTRADICTION_NUMERIC`, premises `[A1, A2]`, conclusion `⊥`

Verifier check:
- premise 0 = chain[0] = `(amount LEQ 100)` → ok, matches `x ≤ c` form
- premise 1 = chain[1] = `(amount GT 100)` → ok, matches `x > c` form
- same `var` (`amount`) on both → ok
- same `c` (100) → ok
- rule output is `⊥` → terminates derivation → upheld

### Boolean Contradiction (worked example)

Chain atoms:
- A1: `notFrozen BOOL_TRUE`
- A2: `notFrozen BOOL_FALSE`

Derivation:
- step 0: `CONTRADICTION_BOOL`, premises `[A1, A2]`, conclusion `⊥`

Verifier checks both atoms refer to the same var, both have BOOL ops with opposite polarity → upheld.

## EIP-D: ZK Gate-Pass Public Input Layout

### Definitions

A **gate-pass proof** is a succinct ZK proof attesting that an off-chain agent ran the BECAUSE / DIRECTION / REMOVAL gates against its declared reasoning chain and all required gates passed.

```solidity
struct GatePassPublicInputs {
    bytes32 reasoningChainHash;
    bytes32 actionHash;
    uint8 gatePassBitmap;
    bytes32 contextHash;
}
```

Bit layout for `gatePassBitmap`:
- bit 0: BECAUSE gate passed
- bit 1: DIRECTION gate passed
- bit 2: REMOVAL gate passed
- bits 3-7: reserved for future gates

`contextHash` is a domain separator preventing replay across (chain id, contract, epoch). Recommended encoding:

```
contextHash = keccak256(abi.encode(
    block.chainid,
    address(this),
    epoch
))
```

### Encoding for Circuit Hashing

The public-input hash a circuit binds to is:

```
publicInputHash = keccak256(abi.encode(
    inputs.reasoningChainHash,
    inputs.actionHash,
    inputs.gatePassBitmap,
    inputs.contextHash
))
```

Circuits MUST commit to this hash as their sole public input. Verifier-key registries are keyed by `(proofSystem, circuitId)`; circuit-id is the hash of the circuit's compiled artifact.

## Composition Across Tiers

A complete reasoning submission may include any combination:

| Tier | Requires | Provides |
|------|----------|----------|
| 1 | atom chain (grammar fragment) | tractable consistency-checking |
| 2 | witness | proof that the chain is satisfiable |
| 2-truth | state oracle | proof that atoms hold against current state |
| 3 | bond + chain hash | optimistic execution + fraud-proof gate |
| 4 (ZK) | proof + public inputs | privacy-preserving gate-pass attestation |
| 5 (formal) | bytecode hash + Halmos cert | high-assurance attestation |

A cautious protocol may require Tiers 1+2-truth (consistency + grounded). A privacy-sensitive agent may add Tier 4 (gate-pass under encryption). A high-stakes governance system may layer Tier 5 (formal attestation) on top.

The tiers are orthogonal: failing any one tier the protocol requires causes the action to revert. There is no replacement; only addition.

## Reference Implementation

VibeSwap reference implementation:
- [`contracts/governance/interfaces/IReasoningVerifier.sol`](../../../contracts/governance/interfaces/IReasoningVerifier.sol) — Tiers 1-2
- [`contracts/governance/interfaces/IReasoningContest.sol`](../../../contracts/governance/interfaces/IReasoningContest.sol) — Tier 3
- [`contracts/governance/interfaces/IReasoningGateProof.sol`](../../../contracts/governance/interfaces/IReasoningGateProof.sol) — Tier 4
- [`contracts/governance/ReasoningVerifier.sol`](../../../contracts/governance/ReasoningVerifier.sol) — concrete verifier
- [`test/ReasoningVerifier.t.sol`](../../../test/ReasoningVerifier.t.sol) — invariant tests

## Security Considerations

- **Witness honesty**: a malicious prover may submit a witness that satisfies the chain but disagrees with actual chain state. The truth check (Tier 2 oracle path) prevents this. Protocols MUST run both checks if the chain's truth-validity matters.
- **Var-key collision**: poorly chosen var-key derivation can collide across protocols. The recommended `keccak256(abi.encode(domain, contract, selector, params))` scheme avoids this.
- **Replay across contexts**: gate-pass proofs without a `contextHash` domain separator can be replayed across chains, contracts, or epochs. Verifiers MUST bind to context.
- **Inference-rule completeness**: the EIP-C ruleset is intentionally minimal. Protocols requiring richer reasoning (existentials, induction) should NOT extend the rule set ad hoc; they should fall back to off-chain verification + ZK proof (Tier 4).

## Open Questions

1. Should `int256` be the universal value type, or should `uint256` be permitted with an explicit domain marker? Mixing risks subtle sign-extension bugs.
2. Should witness arrays be length-prefix-sorted (binary search) or unsorted (linear)? Trade-off: prover-side sort cost vs. on-chain lookup cost.
3. Should atoms admit references to time-windowed state (e.g., "balance at block N") or only current state? Time-windowed extends usefulness but complicates the oracle interface.
4. Should the inference-rule set be versioned per chain so existing fraud proofs remain valid after future extensions?
