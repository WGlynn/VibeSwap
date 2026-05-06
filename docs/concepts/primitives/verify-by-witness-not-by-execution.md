# Verify by Witness, Not by Execution

**Status**: shipped (2026-05-06, reasoning verification subsystem)
**First instance**: `ReasoningVerifier.verifyConsistency` (witness-by-exhibition for atom-chain satisfiability)
**Companions**: [`bonded-permissionless-contest`](./bonded-permissionless-contest.md), [`dual-path-adjudication-preserving-existing-oracle`](./dual-path-adjudication-preserving-existing-oracle.md)

---

## The pattern

When a contract needs to verify a property that would otherwise require expensive computation (SMT solving, symbolic execution, dynamic search), shift the cost asymmetrically: have the prover (off-chain) do the work and submit a **witness**; have the verifier (on-chain) do constant-time substitution and check that the witness satisfies the property.

The verifier never solves the problem. It checks an answer.

```solidity
// Naive: contract solves the problem (expensive)
function verifyConsistent(Assertion[] calldata atoms) external view returns (bool) {
    return _runSMTSolver(atoms);  // gas-prohibitive
}

// Witness-based: prover solves; contract checks (cheap)
function verifyConsistent(
    Assertion[] calldata atoms,
    Witness calldata witness  // <-- prover's claim of a satisfying assignment
) external view returns (bool) {
    for (uint i = 0; i < atoms.length; i++) {
        if (!_evaluateAtom(atoms[i], witness)) revert();
    }
    return true;
}
```

The verifier's gas is `O(n)` in atom count regardless of how hard the original problem was.

## Why it works

Three properties combine.

**Cost asymmetry between prover and verifier.** Many problems have the structure: hard to solve, easy to check (NP-style). Witness-based verification is the standard tool for shifting work to the side that can absorb it. The chain is the wrong place to run an SMT solver, but it's the right place to substitute and compare.

**Non-existence is provable by adversary.** If the prover claims "this set is satisfiable" and submits a witness, the verifier confirms. If the prover claims "this set is satisfiable" but no satisfying assignment exists, the prover cannot produce a valid witness; submission fails. The structural property is fail-closed: a false claim cannot be supported by a witness, so the chain never accepts the false claim.

**No on-chain solver dependency.** The contract has no SMT solver, no symbolic executor, no search algorithm. It has only a substitution function and a comparison function. Bytecode footprint stays minimal; gas cost stays linear; upgrade surface stays small. The chain commits to nothing about *how* satisfiability is determined; it only commits to *what counts as a valid witness*.

## When to use

- The property to verify has the form "there exists an assignment / configuration / proof such that ...".
- Solving for the existential off-chain is feasible (SMT, integer LP, satisfaction in restricted logic).
- The verifier check is structurally `O(n)` in input size — substitution + atomic evaluation, no nested search.
- Failure to produce a witness is acceptable as a rejection of the action (i.e., the protocol can revert).

## When NOT to use

- The property requires *non-existence proof* (e.g., "there is no contradiction in this reasoning chain"). Witness-by-exhibition only proves existence; for non-existence, escalate to bonded contest (anyone can submit a counter-example as a fraud proof) or formal verification.
- The witness is large enough to dominate gas costs (multi-MB witnesses). Use ZK-SNARK compression if the property allows.
- The verifier check itself depends on dynamic state that may change between prover and verifier — race conditions on witness staleness. Bind witnesses to a block hash or commit-reveal epoch.

## Concrete example: reasoning-chain consistency

The `ReasoningVerifier` (governance/ subsystem) verifies that a chain of atomic assertions is internally consistent — i.e., they can all be simultaneously true. The naive approach is to run an SMT solver inside the contract. This is gas-prohibitive and locks the contract to a particular solver implementation.

The witness-based approach: the prover runs an SMT solver off-chain over the atom set, obtains a satisfying assignment if one exists, and submits the assignment alongside the atom chain. The contract:

```solidity
function verifyConsistency(
    Atom[] calldata atoms,
    Witness calldata witness
) external view returns (bytes32 chainHash) {
    for (uint256 i = 0; i < atoms.length; i++) {
        Atom calldata a = atoms[i];
        int256 lhs = _readWitness(a.lhsVarKey, witness);
        int256 rhs = a.isRhsVar ? _readWitness(a.rhsVarKey, witness) : a.rhsConst;
        if (!_evalAtom(a, lhs, rhs)) revert AtomFailed(i);
    }
    return _hashChain(atoms);
}
```

Cost: O(n) in atom count. No solver inside the contract. If a satisfying assignment exists, the prover submits it and verification succeeds; if none exists (chain is contradictory), no valid witness exists and verification fails by construction.

## Concrete example: arbitrage opportunity

Consider a DEX that wants to verify "this trade improves the price for Token X across pool Y vs an external benchmark." Solving for whether such an improving trade exists requires search. Verifying that a *specific* trade improves the price is direct comparison.

Submit the candidate trade as the witness. The contract substitutes: post-trade price vs benchmark. O(1) check. The arbitrageur did the search; the contract just validates the answer.

## Composition with bonded contest

Witness verification proves *existence*. To prove *non-existence* (e.g., "this chain has no contradiction") you need a different tool. The standard composition: witness path is the default (cheap, tractable cases) and bonded contest handles claims outside the witnessable fragment.

| Claim shape | Verification |
|-------------|--------------|
| "X is satisfiable" | Witness — prover exhibits assignment |
| "X is consistent" (no contradiction) | Bonded contest — anyone can submit fraud proof of contradiction |
| "X is uniquely determined" | Either, depending on whether uniqueness is provable cheaply |

The two primitives compose without overlap. Witness handles the existence direction; contest handles the non-existence direction.

## Anti-pattern: contract runs the solver

The wrong move is admitting any input and running the solver inside the contract. Three failure modes:

- **Gas DoS**: an adversarial input crashes the solver under the gas budget; the action that depended on the solver halts.
- **Soundness coupling**: a bug in the solver becomes a bug in the contract's verification; upgrading the solver requires redeploying the verifier.
- **Centralization**: the solver becomes part of the chain's trusted compute base; agreement on solver behavior becomes consensus-critical.

Witness-based verification sidesteps all three. The contract has no opinion on which solver produced the witness, only on whether the witness substitutes correctly. Upgrade the solver freely; the verifier doesn't change.

## Related primitives

- [`bonded-permissionless-contest`](./bonded-permissionless-contest.md) — the dual; handles non-existence claims via fraud proofs
- [`dual-path-adjudication-preserving-existing-oracle`](./dual-path-adjudication-preserving-existing-oracle.md) — meta-pattern for "default cheap path + escalation path"
- [`fail-closed-on-upgrade`](./fail-closed-on-upgrade.md) — verifier defaults to "no claim is accepted" until grammar / oracle wired
