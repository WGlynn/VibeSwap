# Expressibility as the Gate

**Status**: design pattern (extracted from GH discussion #18, 2026-05-06)
**Companions**: [`docs/research/papers/on-chain-reasoning-verification.md`](../research/papers/on-chain-reasoning-verification.md), [`SUBSTRATE_GEOMETRY_MATCH.md`](./SUBSTRATE_GEOMETRY_MATCH.md)

---

## Statement

When a system needs to fail closed on ambiguous or unsafe inputs, the strongest enforcement is to make the *expressibility* of unsafe inputs impossible. Anything that cannot be expressed in the system's input grammar is auto-rejected — not by review, not by policy, by *construction*.

The grammar isn't documentation. It's the verification surface.

## Why this works

A typical fail-closed mechanism inspects an input and rejects it if a property fails: "this withdrawal exceeds limits, revert." The check runs at execution time. This works as long as the check is correct, and breaks when the check has a hole.

Expressibility-as-the-gate moves the rejection earlier. The user (or agent) can only submit inputs the grammar admits. Unsafe shapes are syntactically impossible; the check is structural.

Consequences:
- **Correctness reduces to grammar correctness.** A bug in the runtime check might miss an attack; a bug in the grammar specification is auditable in isolation.
- **No bypass via clever encoding.** If a property "X" cannot be expressed, no encoding trick lets X sneak through. There's no expression to misinterpret.
- **Decomposition is forced.** If an agent needs to do something the grammar doesn't admit, they must either (a) decompose into expressible sub-actions — which produces auditable structure as a side effect, or (b) abandon the action entirely — which is correct iff the action wasn't structurally sound.
- **The DSL becomes the security boundary.** What used to be "documentation describes what's safe" becomes "the type system enforces what's safe."

## When this applies

Use expressibility-as-the-gate when:
- You can characterize the unsafe input space precisely (e.g., "any reasoning chain with a contradiction" — the entire search problem reduces to a tractable fragment by restricting expressible compositions).
- The grammar restriction is a feature, not a limitation — i.e., expressing the safe subset cleanly is more valuable than admitting the full general expression space.
- Runtime checks are expensive or fragile (gas costs, attack-surface size).
- The system is composable: many independent consumers will interact with the grammar; their safety follows from the grammar's structure.

## When it does NOT apply

- The unsafe space is open-ended or context-dependent (e.g., "any fraud" cannot be characterized syntactically).
- The grammar restriction excludes too many legitimate use cases — you'll get pressure to widen it ad hoc, eroding the property.
- The expressibility constraint can be circumvented at a layer below your control (e.g., raw calldata bypasses an interface).

## Examples in this codebase

- **Reasoning verification fragment**: atom chains restricted to conjunction of linear inequalities + boolean state checks. Contradictory chains in this fragment can't avoid the witness check; assertions outside the fragment escalate to bonded contest. See [`on-chain-reasoning-verification.md`](../research/papers/on-chain-reasoning-verification.md).
- **Commit-reveal auction order format**: orders must conform to the `Order` struct + signature scheme; arbitrary calldata can't masquerade as a commit. The order schema is the gate, not the runtime checker.
- **Shapley distributor coalition encoding**: a coalition is a sorted address array deduplicated and hashed; the schema rejects malformed coalitions before any allocation logic runs.

## Examples elsewhere

- **WebAssembly sandbox**: untrusted code can only express memory accesses within its linear memory; out-of-bounds is structurally impossible, not runtime-checked.
- **Capability-based security**: if you don't have the capability object, the operation isn't expressible. No ACL check needed at execution.
- **Strict type systems**: a value of type `NonEmptyList[T]` cannot be empty by construction; runtime emptiness checks become unnecessary.
- **Zero-knowledge circuits**: only inputs satisfying the circuit constraints can produce valid proofs; invalid reasoning produces no verifying proof.

## Relationship to substrate geometry match

[`SUBSTRATE_GEOMETRY_MATCH`](./SUBSTRATE_GEOMETRY_MATCH.md) says: pick mechanism shapes that match the substrate's natural geometry. Expressibility-as-the-gate is a corollary at the interface layer: if the substrate of valid actions has a tractable shape (e.g., conjunction of linear constraints), the grammar should match that shape exactly. Anything outside the shape is structurally invalid; anything inside is structurally checkable.

The two patterns compose: substrate-geometry-match informs *which* shape to pick; expressibility-as-the-gate enforces it at the boundary.

## Anti-pattern: free-form input + post-hoc validation

A common mistake is admitting any input and validating after the fact: "let agents submit arbitrary reasoning chains; we'll run an SMT solver to check consistency at execution." This works only as long as the solver is fast, complete, and trusted. Once any of those slip:
- An adversarial input crashes the solver (DoS).
- The solver has a soundness bug (false positives — "consistent" chains that aren't).
- The solver becomes a centralized trust point.

The expressibility move sidesteps all three: by restricting the grammar to a fragment where consistency is decidable cheaply, the on-chain check is constant-shape and the solver is replaced by a witness substitution.

## Implication for AI-augmented systems

Free-form prompt execution is the anti-pattern at AI scale. An AI system that admits any natural-language instruction and validates after the fact is the same shape as a contract that admits any reasoning chain and runs SMT after the fact — same failure modes, same ceiling.

Strict strategy DSLs, structured outputs, and deterministic validation layers (per Kim's GH#18 framing) are all instances of expressibility-as-the-gate. Each restricts the agent's effective output space to a tractable fragment, making fail-closed structural rather than reviewed.
