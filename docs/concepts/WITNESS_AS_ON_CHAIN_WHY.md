# Witness as On-Chain "Why"

**Status**: design pattern (extracted from GH discussion #18, 2026-05-06)
**Companions**: [`on-chain-reasoning-verification.md`](../research/papers/on-chain-reasoning-verification.md), [`AIRGAP_PROBLEM_ONEPAGER.md`](../research/papers/airgap-problem-onepager.md)

---

## Statement

Standard chains verify *what was submitted*. They do not verify *why it was submitted*. State checks pass while the reasoning underneath the action is fabricated, and the chain has no mechanism to interrogate the gap.

A witness-based reasoning verifier closes that gap by making the "why" a first-class on-chain object. The action no longer travels alone; its justification — the assertion chain plus the witness that proves the chain coherent and grounded — travels with it, subject to the same fail-closed gates.

## Why this matters

Two failure modes that look identical to standard chains:

| Mode | What the chain sees | What's actually happening |
|------|---------------------|---------------------------|
| Honest reasoning | `withdraw(100)` succeeds, all `require()` pass | Agent reasoned: balance ≥ amount, not in cooldown, not frozen — submitted action |
| Hallucinated reasoning | `withdraw(100)` succeeds, all `require()` pass | Agent confabulated a strategy unrelated to actual safety, output happened to satisfy require chain |

Standard contracts cannot distinguish these. The state-level checks fire identically; the actions execute identically; the on-chain trace is identical. The only difference is what was happening in the agent's reasoning before the call — which is off-chain, opaque, and unverifiable.

Witness-as-on-chain-why eliminates the second mode by structural means: an agent that didn't actually reason cannot produce a witness that makes the assertion chain coherent. Confabulated strategies fail the witness check; their actions revert before execution.

## How the pattern works

1. **Agent reasons off-chain**, producing a chain of atomic assertions justifying an intended action: e.g., `amount LEQ maxWithdraw`, `balance GEQ amount`, `notFrozen BOOL_TRUE`.
2. **Agent runs an SMT solver** over the chain, obtaining a satisfying assignment (the witness) — or proof that the chain is unsatisfiable.
3. **Agent submits** `(chain, witness, action)` to the consuming contract.
4. **Contract substitutes** the witness into each atom and checks evaluation; if any atom fails, the entire transaction reverts.
5. **Contract reads chain state** for the same atoms (truth check) and confirms each holds; mismatch reverts.
6. **Action executes** only if both consistency (witness) and truth (state) succeed.

The witness is the "why," made structural. It's not a signature ("I claim I reasoned"); it's a satisfying assignment ("here is a world where my reasoning is internally coherent — substitute it and check"). The latter is verifiable; the former is reputation.

## Connection to the airgap thesis

The [airgap problem](../research/papers/airgap-problem-onepager.md) frames the gap between chain state and the cognition that produced a transaction. Witness-as-on-chain-why is the closure mechanism for the cognitive direction of the airgap, exactly as commit-reveal closes the order-disclosure direction and Shapley distribution closes the contribution-attribution direction.

The pattern across all three:

| Airgap direction | What was off-chain | Closure mechanism |
|------------------|--------------------|-------------------|
| Order disclosure | Agent's intent before submission | Commit-reveal — intent commits structurally |
| Contribution attribution | Who contributed what value | Shapley distribution — math-enforced fairness |
| Cognitive justification | Why the action was correct | Witness-as-on-chain-why — reasoning structural |

Each direction makes a previously-off-chain property a first-class on-chain object, subject to the same math-enforcement that secures the rest of the protocol.

## Anti-pattern: attestation theater

A signed statement saying "I reasoned correctly" with no deterministic consequence attached to contradiction detection is, structurally, just reputation signaling. It does not close the airgap.

Attestation theater fails because:
- The signature attests *that the agent claims to have reasoned*; it does not attest *what the reasoning was*, or *that the reasoning was sound*.
- Detecting fabricated reasoning requires off-chain investigation, the very thing reasoning verification was supposed to make on-chain.
- Slashing or reputation downgrades after the fact restore expected loss but don't prevent the bad action — the chain already accepted it.

The witness mechanism avoids these by making fabrication structurally fail to verify, not merely punishable post-hoc.

## When this pattern applies

- The action's correctness depends on properties the chain cannot directly observe (e.g., "this trade is consistent with a published strategy," "this governance proposal serves stated objectives").
- The reasoning behind the action can be expressed in the tractable assertion grammar.
- The cost asymmetry is favorable: prover runs SMT off-chain (one solve per transaction), verifier runs `O(n)` substitution on-chain (cheap).
- The protocol can revert actions whose justification fails — i.e., the action is not a forced operation that must succeed.

## When it does NOT apply

- The action's correctness depends on properties outside any tractable grammar (e.g., human intent, off-chain context). Use a bonded contest tier or a trusted-oracle pattern instead.
- The action must succeed regardless of justification (e.g., emergency liquidation triggered by external trigger). Witness verification is for actions where reasoning is itself the gating constraint.
- The off-chain reasoning is too dynamic to express in advance (e.g., real-time strategy adaptation). The grammar restriction may force decomposition into sub-actions, which may or may not be acceptable for the use case.

## Sample integration

```solidity
function withdrawWithReasoning(
    uint256 amount,
    IReasoningVerifier.Atom[] calldata reasoning,
    IReasoningVerifier.Witness calldata witness
) external {
    // Check that the witness/reasoning is internally coherent and grounded.
    bytes32 chainHash = reasoner.verifyChain(reasoning, witness, oracle);

    // Bind the chain hash to this withdrawal so the justification is
    // tied to this specific action.
    require(_actionMatchesReasoning(amount, msg.sender, reasoning), "ChainMismatch");

    // Audit anchor.
    emit WithdrawalReasoned(msg.sender, amount, chainHash);

    // Execute.
    _withdraw(msg.sender, amount);
}
```

The `_actionMatchesReasoning` step is the integration boundary: it ensures the reasoning chain literally addresses *this* action (not some prior action whose witness gets reused). Reasoning + action must be bound at the contract layer; the witness alone proves coherence, not relevance.

## Implication for protocol design

Once witness-as-on-chain-why is available, protocols can choose to require justification for *any* action whose correctness is structural rather than incidental. This shifts the design surface:

- "Should this action be permissioned?" becomes "What reasoning must justify it?"
- "Should this require multisig?" becomes "What invariants must the proposer prove they considered?"
- "Should this have a timelock?" becomes "Should the timelock be a contest window during which the reasoning can be challenged?"

Each translation moves enforcement from social or temporal mechanisms to structural ones. The chain becomes more legible: every load-bearing action has a witness explaining itself.
