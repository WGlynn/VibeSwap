# Reasoning Verification Subsystem — Architecture Overview

**Status**: research-stage scaffolding (all components shipped 2026-05-06)
**Spec**: [`docs/research/papers/on-chain-reasoning-verification.md`](../research/papers/on-chain-reasoning-verification.md)
**Standard draft**: [`docs/research/papers/eip-draft-reasoning-grammar.md`](../research/papers/eip-draft-reasoning-grammar.md)
**Origin**: [GitHub discussion #18](https://github.com/WGlynn/VibeSwap/discussions/18)

---

## Purpose

Smart contracts verify *state* — balances, signatures, deadlines. They do not verify *reasoning*. As AI agents become economic actors and human DAOs grow, the question "did this transaction come from sound reasoning?" becomes financially load-bearing. The reasoning verification subsystem makes BECAUSE / DIRECTION / REMOVAL gates executable on-chain, by making the assertion chain a first-class object alongside the action it justifies.

The subsystem is forward-looking: nothing in production VibeSwap currently consumes it. It is included in the codebase as a reference scaffold for the four-EIP standardization effort and for protocols (USD8, AI agents, governance modules) that want to integrate reasoning verification.

## Component map

```
┌─────────────────────────────────────────────────────────────┐
│ Tier 1: assertion grammar (off-chain)                       │
│   Atom { lhsVar, op, isRhsVar, rhsVar | rhsConst }          │
│   chain = ordered conjunction of atoms                       │
│   tractable fragment: linear inequalities + boolean state    │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ Tier 2: witness-based verification (on-chain, default path) │
│                                                              │
│   IReasoningVerifier ─┬─ verifyConsistency(atoms, witness)  │
│                       │   pure: substitutes witness, evals   │
│                       │                                      │
│                       ├─ verifyTruth(atoms, oracle)          │
│                       │   reads state via IStateOracle       │
│                       │                                      │
│                       └─ verifyChain(atoms, witness, oracle) │
│                           consistency + truth in one pass    │
│                                                              │
│   ReasoningVerifier (impl, stateless)                        │
│   StateOracle (impl, keyed resolver registry)                │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ Tier 3: optimistic + fraud proof (on-chain, escalation)     │
│                                                              │
│   IReasoningContest ──┬─ submitClaim(atoms, actionHash)     │
│                       │   pulls bond, opens window           │
│                       │                                      │
│                       ├─ challengeContradiction(...)         │
│                       │   walks derivation; CONTRADICTION_*  │
│                       │   slashes bond to challenger         │
│                       │                                      │
│                       └─ finalizeUnchallenged(chainHash)     │
│                           permissionless after deadline      │
│                                                              │
│   ReasoningContest (impl, UUPS upgradeable)                  │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ Tier 4 (orthogonal): ZK gate-pass attestation                │
│                                                              │
│   IReasoningGateProof ─ verifyGatePass(proofSystem, ...)    │
│                          PRIVACY: chain stays confidential   │
│                          COMPOSABILITY: N gates → 1 proof    │
└─────────────────────────────────────────────────────────────┘
```

## File layout

```
contracts/governance/
├── interfaces/
│   ├── IReasoningVerifier.sol      ← Atom, Witness, Op, IStateOracle
│   ├── IReasoningContest.sol       ← Claim, DerivationStep, InferenceRule
│   └── IReasoningGateProof.sol     ← Gate, ProofSystem, public-input layout
├── ReasoningVerifier.sol           ← Tier 2 reference impl (stateless, pure)
├── ReasoningContest.sol            ← Tier 3 reference impl (UUPS, bonded contest)
└── StateOracle.sol                 ← keyed resolver registry (UUPS)

test/
├── ReasoningVerifier.t.sol         ← 13 tests (consistency, truth, ops, hashing)
├── ReasoningContest.t.sol          ← 8 tests (submit, challenge, finalize)
└── StateOracle.t.sol               ← 10 tests (register, read, revoke, auth)
```

## Composition rules

The four tiers are **orthogonal**, not alternative. A single submission may combine any subset:

| Combination | Use case |
|-------------|----------|
| Tier 1 alone | Internal-only reasoning trace; no on-chain enforcement |
| Tier 1 + 2 (consistency only) | Agent attests internal coherence; truth deferred |
| Tier 1 + 2 (truth only) | Atoms are about chain state; consistency assumed by structure |
| Tier 1 + 2 (chain) | Default path — full witness + truth check, cheap O(n) |
| Tier 1 + 3 | Reasoning escapes the tractable fragment; bonded fraud-proof gate |
| Tier 1 + 2 + 4 | Privacy-preserving: chain stays confidential, only gate-pass on-chain |
| Tier 1 + 2 + 3 + 4 + Halmos | Maximum-assurance, every property proven |

A protocol picks the combination it needs. There is no replacement; only addition. Failing any required tier reverts the action.

## Connection to existing VibeSwap primitives

The architecture composes patterns the codebase already ships, applied to a new substrate:

| Reasoning primitive | Sourced from VibeSwap primitive |
|---------------------|-------------------------------|
| Tier 3 bonded contest | [`bonded-permissionless-contest`](../concepts/primitives/bonded-permissionless-contest.md) (C47) |
| Slashed-bond reward pool | [`self-funding-bug-bounty-pool`](../concepts/primitives/self-funding-bug-bounty-pool.md) (C47) |
| Tier 2 (witness) + Tier 3 (contest) | [`dual-path-adjudication`](../concepts/primitives/dual-path-adjudication-preserving-existing-oracle.md) (C47) |
| Verifier defaults to "no claim valid until grammar wired" | [`fail-closed-on-upgrade`](../concepts/primitives/fail-closed-on-upgrade.md) (C39, C45, C47) |
| Witness commitment per epoch | [`generation-isolated-commit-reveal`](../concepts/primitives/generation-isolated-commit-reveal.md) (C42) |

The shape carries over. What changes is the type of asserted property — value-flow becomes reasoning.

## Connection to the airgap thesis

Standard chains are airgapped from the cognition that produced a transaction. They verify *what was submitted*, not *whether the submitter reasoned correctly*. This subsystem closes that gap by making reasoning a first-class on-chain object: subject to consistency checks, truth checks, fraud proofs, and gate-pass attestations.

This is structurally the same move as the [airgap-problem-onepager](../research/papers/airgap-problem-onepager.md): the chain absorbs a property that previously lived only off-chain (cognition, in this case; identity-economics in the original). Once absorbed, the property becomes math-enforceable rather than reputation-enforceable.

## Operational workflow (illustrative, AI agent)

1. **Off-chain reasoning**: agent constructs a BECAUSE chain for an intended action, e.g., a withdrawal:
   - `amount LEQ maxWithdraw`
   - `balance GEQ amount`
   - `notFrozen BOOL_TRUE`
2. **Witness generation**: agent runs an SMT solver (Z3 / CVC5) over the atom set; solver returns a satisfying assignment.
3. **Submission**: agent calls the consuming contract with `(atoms, witness, action)`. The contract calls `ReasoningVerifier.verifyChain` which checks both consistency (witness-by-exhibition) and truth (oracle reads).
4. **Optional ZK wrap**: for privacy-sensitive agents, the chain itself stays off-chain; only `IReasoningGateProof.verifyGatePass(...)` runs on-chain with a succinct proof attesting "BECAUSE / DIRECTION / REMOVAL gates passed against this chain hash."
5. **Optional contest tier**: for chains escaping the tractable fragment, agent posts to `ReasoningContest.submitClaim` with bond; action executes optimistically; challenge window opens; permissionless `challengeContradiction` allows fraud proofs.
6. **Finalization**: clean execution either passes the verifier (Tier 2) or survives the challenge window (Tier 3). Bond returns. Action commits.

## Open extensions

- **Bounded existentials in the grammar fragment**: extend Tier 1 to bounded quantification over fixed-size sets. Witness-by-exhibition still works with linear blowup.
- **Cross-domain witness sharing**: a witness produced under one protocol's var-key namespace, reused as evidence in another. Requires aliasing semantics in EIP-A.
- **Distributed reasoner markets**: multiple agents submit competing chains for the same action; Shapley-style value function picks the dominant verifiable claim. Composes cleanly with ShapleyDistributor — orthogonal properties (structural vs competitive).
- **Halmos-style attestation registry**: contract bytecode hash → "this set of invariants was formally verified" attestation, invalidated on upgrade.
- **Reasoning chain replay across upgrades**: explicit invalidation semantics so prior attestations don't carry to new bytecode without rerun.

## Status

- All interfaces, reference implementations, and test suites land 2026-05-06.
- Tests pass: 13 verifier + 8 contest + 10 oracle = 31 tests, exit 0.
- No production VibeSwap path consumes this subsystem yet; integration is downstream of EIP-A standardization or a partnering protocol opting in.
