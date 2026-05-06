# On-Chain Reasoning Verification

**Status**: research / proposal
**Origin**: GitHub discussion [WGlynn/VibeSwap#18](https://github.com/WGlynn/VibeSwap/discussions/18) — "What Should the Anti-Hallucination Protocol Look Like On-Chain?"
**Connects to**: [airgap-problem-onepager.md](./airgap-problem-onepager.md), [augmented-mechanism-design-usd8.md](./augmented-mechanism-design-usd8.md), [`bonded-permissionless-contest`](../../concepts/primitives/bonded-permissionless-contest.md)

---

## Problem statement

Smart contracts verify state — balances, signatures, deadlines. They do not verify reasoning. As AI agents become economic actors (executing trades, managing liquidity, voting in governance), the question of "is this agent reasoning correctly?" stops being a research curiosity and becomes a financial one. An agent that hallucinates a trading strategy loses money. An agent that hallucinates a governance rationale damages the protocol.

The same gap appears for human-governed DAOs: a governance proposal with no causal chain ("we should change the fee BECAUSE...") is structurally indistinguishable from a hallucinated one. The signers being human does not make the reasoning auditable.

This document specifies a three-tier on-chain reasoning verification architecture, plus a ZK gate-pass extension and a high-assurance attestation tier. None of the components require new cryptography. The contribution is a standardization layer — an EIP specifying assertion grammar and witness format — that lets these primitives compose.

## Three reasoning gates (off-chain semantics)

The architecture starts from three verification gates already used informally in AI-augmented development workflows. They generalize cleanly to on-chain analogues.

### BECAUSE — causal chain
Every claim must have a causal chain. `"This withdrawal is safe"` is not acceptable; `"This withdrawal is safe BECAUSE amount ≤ maxWithdraw AND user has balance AND not in cooldown AND circuit breaker not tripped"` is acceptable. If the agent (or proposer) cannot produce the BECAUSE chain, the assertion is suspect.

### DIRECTION — metric monotonicity
Does the proposed change move the right metric in the right direction? A claim that a code change "improves security" must reduce attack surface, add validation, or remove trust assumptions. If the direction is ambiguous or the metric is wrong, the reasoning has hallucinated a benefit.

### REMOVAL — counterfactual consequence
If you remove the proposed code, does the system break in the way the code claims to prevent? If you remove a "security check" and nothing changes, the check was either redundant or the threat model was hallucinated. Every guard should have a removal consequence.

These three gates are not new tests. They are the structure that distinguishes load-bearing reasoning from rationalization. The architecture below makes them executable on-chain.

---

## Tier 1 — Restrict the assertion grammar to a tractable fragment

Define a fragment of first-order logic over named state variables for which internal consistency is decidable in polynomial time off-chain and admits a witness-based on-chain check.

**Grammar (proposed)**:
- atoms: `var <op> const`, `var <op> var`, `bool_var`
- ops: `==`, `!=`, `<=`, `<`, `>=`, `>`
- composition: conjunction only (`AND`)
- forbidden: disjunction, negation of compound, existential/universal quantifiers, recursion

In this fragment:
- atoms are linear inequalities or boolean state checks
- consistency reduces to feasibility of a system of linear constraints (linear programming, polynomial off-chain)
- on-chain verification reduces to substituting a witness assignment and checking each atom — `O(n)` in atom count

Most DeFi safety reasoning fits this fragment cleanly. What does not fit is usually a sign the assertion is doing too much work and should be decomposed (e.g., an OR clause encoding two distinct branches that should be separate proposals, or a quantifier over actors that should be expanded into bounded membership checks).

The fragment is a feature, not a limitation: it forces explicit decomposition of multi-branch reasoning, which is the same hygiene that makes off-chain BECAUSE chains auditable.

## Tier 2 — Witness-based verification (the core primitive)

The prover (agent or proposer) runs an SMT solver (Z3, CVC5, Halmos's underlying SMT layer) off-chain over the assertion set. The solver either:

- returns a satisfying assignment (the witness) — proving consistency by exhibition, or
- returns UNSAT with an unsat-core — proving contradiction.

If satisfiable, the prover submits the witness alongside the transaction. The contract substitutes the witness into each assertion and confirms all evaluate to true. Cost is `O(n)` in assertion count — same shape as a `require` chain, just with the witness as input rather than implicit.

```solidity
struct Atom {
    bytes32 lhsVarKey;
    Op op;                 // EQ, NEQ, LEQ, LT, GEQ, GT, BOOL
    bool isRhsVar;
    bytes32 rhsVarKey;     // valid if isRhsVar
    int256 rhsConst;       // valid if !isRhsVar
}

struct Witness {
    bytes32[] varKeys;
    int256[] varValues;    // for boolean vars: 0 or 1
}

interface IReasoningVerifier {
    /// @notice Verify that `atoms` are jointly satisfiable by exhibition.
    /// @dev Verifier substitutes witness into each atom; reverts on failure.
    function verifyConsistency(
        Atom[] calldata atoms,
        Witness calldata witness
    ) external view returns (bool);

    /// @notice Verify atoms hold against ACTUAL chain state (truth check).
    /// @dev Witness is unused; verifier reads varKeys from a state oracle.
    function verifyTruth(
        Atom[] calldata atoms,
        IStateOracle oracle
    ) external view returns (bool);
}
```

**Why witness-by-exhibition is sufficient for consistency**: if a single assignment makes every atom in the set simultaneously true, no two atoms in that set are direct logical contradictions. Consistency-by-exhibition is strictly weaker than consistency-by-deduction (it does not catch reasoning chains that are unsat in ways the SMT solver missed), but the cost asymmetry is large: prover runs SMT once off-chain, verifier runs `O(n)` substitution on-chain.

**Two distinct checks**:
- *Consistency check*: do the atoms form a satisfiable set? (witness-based, this tier)
- *Truth check*: does each atom hold against actual chain state? (state oracle, separate)

A reasoning chain is valid only if both checks pass. The witness validates the *internal* shape of the claim; the state oracle validates that the claim is *grounded*. Without both, you have either a coherent fiction or a broken assertion.

## Tier 3 — Optimistic + fraud proof for anything outside the fragment

Some reasoning chains genuinely require the full power of first-order logic — quantifiers over actors, disjunction over execution branches, counterfactual reasoning. For these, the witness primitive cannot be applied directly. Use bonded permissionless contest:

1. Agent posts a bond and submits the assertion chain plus a "no contradiction" claim.
2. The transaction executes optimistically.
3. A challenge window opens.
4. Anyone may post a fraud proof — two atoms in the chain plus a derivation showing they jointly entail false. The derivation is verified on-chain (rules of inference for the relevant fragment).
5. If the fraud proof is valid, the bond slashes to the challenger and the transaction reverts. If the window expires without challenge, the action finalizes.

This is structurally identical to VibeSwap's existing [Bonded Permissionless Contest](../../concepts/primitives/bonded-permissionless-contest.md) primitive (cycle C47) — applied to reasoning rather than value flow. The primitive's three properties (skin-in-the-game gates noise, deadline forces engagement, default-on-expiry encodes burden of proof) carry over without modification.

The cost asymmetry: most reasoning chains use the fragment and pay the cheap `O(n)` witness check. Only the chains that genuinely escape the fragment pay the contest-window latency.

---

## Contracts for cognition — ZK gate-pass extension

The three reasoning gates (BECAUSE / DIRECTION / REMOVAL) can be evaluated inside a zero-knowledge circuit off-chain, with a succinct proof submitted on-chain. The contract verifies the proof in roughly constant gas.

```solidity
interface IReasoningGateProof {
    /// @notice Verify a ZK proof attesting the reasoning chain passed BECAUSE/DIRECTION/REMOVAL.
    /// @param publicInputs hash(reasoning_chain), hash(proposed_action), gate_pass_bitmap
    /// @param proof Groth16 / PLONK / STARK proof
    function verifyGatePass(
        bytes calldata publicInputs,
        bytes calldata proof
    ) external view returns (bool);
}
```

**What this buys over Tier 2 alone**:

- *Privacy*: the reasoning chain itself stays confidential. Proprietary trading strategies, model state, or deliberation details remain off-chain; only the gate-pass commitment is public. For institutional agents (funds, custodians, compliance bots) this is the difference between operating on-chain at all versus reverting to fully off-chain trust.
- *Composability*: multiple gates collapse into a single verification step. A 3-gate chain (BECAUSE + DIRECTION + REMOVAL) pays one proof verification, not three.
- *Cognitive-cost amortization*: the prover pays once to convince the chain that *all three gates ran correctly*, regardless of how expensive the gates themselves are off-chain.

**What this does not weaken**: the fail-closed property is preserved. A reasoning chain that fails any gate cannot produce a valid proof. Fabricated reasoning becomes structurally non-executable, not merely discouraged.

**Where it slots**: ZK gate-pass attestation is *orthogonal* to Tier 2 consistency-by-witness. A complete submission may include both — the witness proves the assertion set is internally consistent, the ZK proof attests the agent's gates passed against that set. They verify different properties: one is about the assertions' coherence, the other is about the agent's claim that it actually applied the gates honestly.

---

## High-assurance tier — Halmos-style proofs as commitments

For the highest-assurance contracts, formal verification tools (Halmos, Certora, CBMC's symbolic execution) can produce proof certificates that an entire assertion set is internally consistent, or that a specific implementation satisfies a specification. These certificates can be committed on-chain as attestations:

- A Certora proof "no reentrancy is possible in this contract bytecode" becomes an on-chain attestation tied to the bytecode hash.
- If the contract is upgraded, the attestation is invalidated until re-verified against the new bytecode.
- Users (and other contracts) can check `hasFormalAttestation(bytecodeHash)` at runtime.

This turns formal verification from a one-time pre-deploy audit into a living, on-chain property. It is not a prerequisite for the other tiers — the witness check and bonded contest are sufficient for the common case — but it provides a strict-superset guarantee for protocol-critical paths (oracles, settlement, governance execution).

---

## Standardization path

None of the four tiers (grammar restriction, witness-based verification, optimistic contest, ZK gate-pass) require new cryptography. Witness-based verification mirrors the prover/verifier asymmetry rollups already use. Bonded contest is the optimistic-rollup pattern. ZK gate-pass uses standard SNARK/STARK verifiers. Halmos-style attestation uses existing formal-verification tooling.

The missing piece is the standardization layer:

1. **EIP for assertion grammar**: define `Atom`, `Witness`, the small set of comparison ops, and the canonical encoding. Without this, every protocol invents its own assertion format and the primitives do not compose across contracts.
2. **EIP for witness format**: pin down the variable-key namespace (state-variable identifier scheme), value encoding, and the verification function ABI.
3. **EIP for fraud-proof rules**: specify which inference rules are admissible in a contest, how derivations are encoded, and how the verifier checks a derivation.
4. **EIP for gate-pass public inputs**: standardize what `(reasoning_chain_hash, action_hash, gate_pass_bitmap)` looks like so verifiers compose across circuits.

This is design work, not research. The cryptographic primitives exist. The discipline of writing the EIPs is the next move, and nothing about the substrate prevents it.

---

## Connections to existing VibeSwap primitives

The architecture is not a greenfield design — it composes patterns already shipped in this codebase, applied to a different substrate (reasoning rather than value flow):

| VibeSwap primitive (shipped) | On-chain reasoning analogue |
|------------------------------|------------------------------|
| [Bonded Permissionless Contest](../../concepts/primitives/bonded-permissionless-contest.md) (C47) | Tier 3 — fraud proof on assertion contradiction |
| [Self-Funding Bug-Bounty Pool](../../concepts/primitives/self-funding-bug-bounty-pool.md) (C47) | Forfeited contest bonds bootstrap rewards for future fraud-proof submitters |
| [Dual-Path Adjudication](../../concepts/primitives/dual-path-adjudication-preserving-existing-oracle.md) (C47) | Witness check (default path) + fraud proof (escalation path) gate the same assertion |
| [Fail-Closed on Upgrade](../../concepts/primitives/fail-closed-on-upgrade.md) (C39/C45/C47) | Reasoning verifier defaults to "no claim is valid" until grammar/oracle wiring is initialized |
| [Generation-Isolated Commit-Reveal](../../concepts/primitives/generation-isolated-commit-reveal.md) (C42) | Reasoning chains tagged with epoch; revealed witness must match committed assertion-set hash from same epoch |

The shape carries over. What changes is the type of the asserted property.

---

## Connection to the airgap thesis

Standard chains are airgapped from the cognition that produced a transaction. They verify *what was submitted*, not *whether the submitter reasoned correctly*. The four-tier architecture closes this gap by making the reasoning a first-class on-chain object: subject to consistency checks, truth checks against state, fraud proofs, and gate-pass attestations.

This is structurally the same move as the [airgap-problem-onepager](./airgap-problem-onepager.md): the chain absorbs a property that previously lived only off-chain (cognition, in this case; identity-economics in the original). Once absorbed, the property becomes math-enforceable rather than reputation-enforceable.

A reasoning-verifying chain does not require trusting the agent's intentions, the proposer's good faith, or the model's calibration. It requires only that fabricated reasoning fail the gates — which, given the witness primitive, it provably does.

---

## Open extensions

- **Assertion grammar v2**: extend the tractable fragment to bounded existentials over fixed-size sets (e.g., "for each of the 10 LP positions, ..."). Bounded existentials still admit witness-by-exhibition with linear blowup.
- **Cross-domain witness sharing**: if a proposal cites assertions from another contract, can the witness be reused? Specifying witness scope and aliasing is non-trivial.
- **Reasoning chain replay**: when a contract is upgraded, are past reasoning attestations still valid against the new bytecode? Likely no without rerun, but the attestation structure should make this explicit rather than ambient.
- **Adversarial witness search**: a malicious prover could produce a witness that satisfies the assertion set but disagrees with actual chain state. The truth check (Tier 2, separate verifier path) prevents this, but the interaction between consistency and truth requires careful spec to avoid edge cases.

These are design questions, not blockers. The architecture is buildable today.
