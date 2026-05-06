# Distributed Reasoner Markets

**Status**: open mechanism design (extracted from GH discussion #18, 2026-05-06)
**Companions**: [`on-chain-reasoning-verification.md`](../research/papers/on-chain-reasoning-verification.md), [`AUGMENTED_MECHANISM_DESIGN.md`](../architecture/AUGMENTED_MECHANISM_DESIGN.md), `ShapleyDistributor.sol`

---

## Statement

Verifying a single agent's reasoning is the weak version of the on-chain reasoning verification problem. The strong version: multiple agents submit *competing* assertion chains for the same action; the chain whose witness verifies AND whose action profile dominates on cooperative-game-theoretic grounds gets execution authority.

The system stops trusting individual agents and starts trusting the verification machinery a market of competing reasoners must clear.

## Why this is interesting

A single-agent reasoning verifier proves: *this agent's reasoning is internally coherent*. It does not prove: *this agent's reasoning is the best available reasoning*. A market structure adds the second property by composition:

| Property | Mechanism |
|----------|-----------|
| Internal coherence | Witness-based verification (Tier 2) |
| Grounded in state | State oracle truth check (Tier 2) |
| Adversarially robust | Bonded fraud-proof contest (Tier 3) |
| Privacy-preserving | ZK gate-pass attestation (Tier 4) |
| **Competitively dominant** | **Distributed reasoner market** (this layer) |

Reasoning verification and cooperative game theory verify *orthogonal* properties: one is structural (is this chain coherent?), one is competitive (which coherent chain dominates?). Both fail-closed cleanly: a chain that fails coherence never enters the market; a market entrant that doesn't dominate doesn't get execution authority.

## The core mechanism

Multiple agents observe the same chain state and the same proposed action. Each independently constructs an assertion chain justifying a different parameterization of the action (e.g., for a withdrawal: different amount, different routing, different fee tier). All chains pass through the verifier:

```
agent_1 ──→ chain_1 ──→ verifier OK ──→ market entrant
agent_2 ──→ chain_2 ──→ verifier OK ──→ market entrant
agent_3 ──→ chain_3 ──→ verifier FAIL ──→ rejected
agent_4 ──→ chain_4 ──→ verifier OK ──→ market entrant
```

Among the market entrants, a Shapley-style value function (or Pareto-dominance check, or auction) picks the dominant entry. That entry's chain becomes the on-chain justification; the action executes with its parameterization.

The losing entrants are not slashed — they entered the market in good faith; their reasoning was coherent; they simply didn't dominate. They may receive a participation reward funded by a tiny tax on the winning entry, à la `ShapleyDistributor.sol`.

## What changes vs single-agent verification

- **Trust shifts from individual agents to the market clearing mechanism.** No single agent has to be reliable; the market just has to be liquid.
- **Sybil resistance becomes load-bearing.** A single agent operating N pseudonymous identities can pack the market with self-favoring entries. Mitigations: identity-staked entry (each agent stakes per slot), entry fee non-refundable on losing entries, or rate-limiting via `FibonacciScaling`.
- **Strategy composition becomes a first-class research target.** Agents may study other agents' historical chains and adapt — the market becomes a learning system. The grammar restriction (Tier 1) bounds the expressible strategies, keeping the analysis tractable.
- **The verification layer must be cheap.** If verifying each entry's chain costs `k` gas, the market clearing scales as `k * n_entrants`. Witness-based verification's `O(n)` cost (linear in atom count, not entrants) is what makes this viable.

## Connection to existing primitives

- **Shapley distribution** (`ShapleyDistributor.sol`): the value function picking the dominant entry can be a Shapley computation over the entrants' coalitional contribution. Closes the loop with VibeSwap's existing fairness machinery.
- **Bonded permissionless contest** (C47): if an entrant claims its chain is coherent and dominates, but the dominance claim is wrong, that's a fraud-proof candidate. Same shape as the Tier 3 escalation, applied to the market layer.
- **Commit-reveal auction**: market entries can use the existing commit-reveal pattern to prevent late-binding strategy adaptation (i.e., don't see other entrants' chains before committing).

## Open questions

1. **Does the market converge?** Multi-agent reasoning markets are dynamic systems; analysis of equilibrium behavior requires a specific value function and a model of agent strategy adaptation. Probably best studied via simulation before on-chain deployment.
2. **What's the right value function for "dominance"?** Pareto, Shapley, leximin, weighted sum — different choices favor different agent strategies. This is mechanism-design territory, not just engineering.
3. **How does the market interact with Tier 3 contest?** If a winning entry's chain is later contested and reverted, what happens to the action? Likely: the next-ranked entrant's chain is promoted, with bond forfeited from the original winner. Spec-level detail not yet drafted.
4. **Cross-chain reasoner markets**: agents on different chains can submit entries to a market that resolves on a hub chain. Combines reasoning verification with cross-chain identity. Open.
5. **Adversarial markets**: an attacker submits a coherent chain that dominates honest entrants by exploiting a value-function blind spot. The grammar restriction limits expressible strategies, but the value function still has to be incentive-compatible. Mechanism-design audit needed.

## Why this matters for AI-as-economic-actor

The single-agent reasoning verification proves an agent reasoned correctly. A market structure proves an agent reasoned *better than the alternatives the market saw*. This is the on-chain analogue of what works in human governance: not "trust this proposer" but "trust the deliberative process that selected this proposal."

For AI agents managing capital, this is the difference between "the model is honest" (uncheckable) and "the model dominated other independently-reasoning models on a verifiable scoring rule" (checkable on-chain). The latter is much stronger.

Distributed reasoner markets are not in scope for the initial reasoning-verification subsystem ship. They are listed here as the next mechanism-design layer, downstream of the EIP-A standardization and the Shapley-distributor hookup.
