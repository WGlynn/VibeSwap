# ZK Attribution — Proving Work Without Revealing Content

**Status**: Research direction + design sketch.
**Depth**: Pedagogical. Assumes first-encounter with zero-knowledge proofs; builds to concrete VibeSwap application.
**Related**: [Contribution Traceability](./CONTRIBUTION_TRACEABILITY.md), [ContributionAttestor Explainer](./CONTRIBUTION_ATTESTOR_EXPLAINER.md), [The Attribution Problem](../../research/essays/THE_ATTRIBUTION_PROBLEM.md).

---

## The problem we're trying to solve

Every contribution the DAG records carries an evidence hash pointing to some off-chain artifact. For most contributions this is fine — the artifact is meant to be public. A public commit, a published paper, a public Telegram message.

But some valuable contributions have private content:

- An audit for an NDA-protected client. The audit report must remain private; the auditor still deserves DAG credit.
- A design memo drafted inside a private conversation. The participants don't want the draft public; but the framing it produced deserves credit.
- A strategy document shared with investors under confidentiality. The document can't go public; the strategist should still be creditable.
- Insights surfaced in counseling, mentorship, or therapeutic settings. Attribution matters; content must stay private.

The question: can we give DAG credit to contributions whose content is private?

Naively: no. On-chain records are public; committing a hash that points to private content makes the hash public but the content still private — no one can verify the content matches the claim.

Zero-knowledge proofs (ZK proofs) change this answer. Let's build the concept from scratch.

## What a ZK proof is

Imagine you know the solution to a puzzle. You want to prove to me that you know the solution, but without showing me the solution itself.

**Example:** You're color-blind and need to be convinced that two balls (red and green, indistinguishable to you) are actually different colors. Without showing you the colors, I can prove they're different.

How: I show you both balls in my hands. You put them behind your back, maybe swap them or not, then show them to me again. I tell you whether I swapped them. If you didn't swap and I say "different" — or you did swap and I say "same" — I'm right. After 20 rounds, if I'm right every time, the chance I'm guessing is 1-in-a-million. You're convinced the balls differ in some way I can see and you can't.

I proved the balls differ without showing you the difference. That's a zero-knowledge proof.

Cryptographic ZK proofs do this mathematically. They produce a proof (a short string of data) that convinces any verifier that a statement is true, without revealing why it's true or what the underlying data is.

## The specific proofs that matter for attribution

Three kinds of statements are useful to prove in zero-knowledge:

### Statement 1 — "I wrote content with hash H"

Prove: I possess content C such that `hash(C) == H` (publicly committed hash).

Why this matters: if I commit H to the blockchain, I claim to have written C. A ZK proof lets me demonstrate I actually hold C without revealing C.

### Statement 2 — "Content C (hashed to H) has property P"

Prove: I possess content C with `hash(C) == H`, and C satisfies some property P (e.g., "is a well-formed audit report", "contains N words", "is dated before X").

Why this matters: commitments can be verified for quality/type without revealing content.

### Statement 3 — "Contributors X, Y, Z collaborated on content with hash H"

Prove: the content was produced via collaboration of specific identifiable parties, without revealing what they produced.

Why this matters: multi-party contributions can be attributed without exposing the joint work.

All three are practically implementable with modern ZK frameworks (SNARKs, STARKs, etc.).

## How ZK attribution would work in VibeSwap

1. A contributor creates private content C.
2. They compute `hash(C) == H` and commit H to `ContributionAttestor.submitClaim` along with their chain-address and type.
3. They generate a ZK proof that demonstrates "I, contributor_addr, produced content with hash H" without revealing C.
4. The proof is verified on-chain or by a designated verifier (trusted or not). If verification passes, the claim is valid.
5. Attestors can verify the proof is well-formed without needing access to C.
6. DAG credit is assigned based on the claim's type and attested weight.

The content C stays private. The chain records: contributor address, type, timestamp, hash H, and the verified proof's metadata. Auditors can re-verify the proof anytime without needing C.

## What this enables

### Application 1 — NDA-compliant audits

A security audit done for a client under NDA: the audit report can't be public. With ZK attribution, the auditor proves "I wrote a security report of type X, with coverage level Y, for the project deployed at address Z, dated D" without the report itself being published.

The project can verify the audit happened. The auditor gets DAG credit. Non-party observers learn nothing about the report.

### Application 2 — Private dialogue credit

Telegram conversations, video calls, written correspondence that shaped design decisions: participants prove their roles without broadcasting content.

### Application 3 — Investor communications

Strategic docs shared with investors under confidentiality can be attributed to their writers without content disclosure.

### Application 4 — Credential-bound identities

A contributor claims a professional credential ("licensed lawyer", "PhD in cryptography") without exposing which institution / identity. ZK attribution verifies the credential's existence without specificity.

## The on-chain cost

ZK proofs are cryptographically expensive. Current state:

- **SNARKs**: proof size ~200 bytes, verification cost ~200K gas. Feasible for occasional attribution.
- **STARKs**: proof size ~100 KB, verification cost higher but transparent (no trusted setup). Feasible for critical attributions.
- **Recursive proofs**: batch many attributions together, amortize cost. Hot area.

Rough cost per ZK attestation on Ethereum L1 at 2024 prices: $2-$10 per attestation. Too expensive for every claim.

Design response: ZK attribution is OPTIONAL, used when content-privacy matters. Default attribution uses public evidenceHash (cheap); ZK attribution is a privacy-preserving alternative (expensive) for specific use cases.

## The trusted-setup question

SNARKs need a "trusted setup" — a ceremony where randomness is generated and then destroyed. If the randomness leaks, false proofs become possible.

Large ZK-proof protocols (Ethereum's KZG ceremony, for example) distribute the setup so no single party's compromise breaks security. Still, the trust-minimization angle is: STARKs avoid trusted setup entirely; use STARKs where setup-trust is unacceptable.

For VibeSwap, both are options. STARKs are more Rosetta-covenant-preserving (no trust required); SNARKs are cheaper. Different use cases may choose differently.

## The UX challenge

Users generating ZK proofs need:
- A trusted prover (local tool or trusted service).
- Enough computational resources (proofs take seconds to minutes to generate on a laptop).
- A well-defined claim statement (type-safe).

None of these is casual. ZK attribution is not a mass-market UX yet; it's for users who value privacy enough to invest in the workflow.

Migration path: start with web-assembly local prover for desktop users; mobile prover as hardware accelerates; eventually cloud-prover-with-trust assumption for casual users.

## The verifier's burden

Anyone who wants to verify a ZK attestation needs:
- The on-chain proof data.
- The prover's claimed statement.
- The ZK verification key (public).
- Verification software (open source).

Verification is cheap once the proof is produced — milliseconds per proof. But verifying requires running the software; not automatic like on-chain verification.

Design response: on-chain verification for economic actions (attestations that affect Shapley or voting power). Off-chain verification for audit-time review. Provides accountability without requiring 100% on-chain verification.

## The cryptographic assumption

ZK proofs' soundness depends on specific cryptographic assumptions:
- Certain problems are computationally hard (elliptic curve discrete log, factoring).
- Certain cryptographic primitives behave pseudo-randomly.
- Hashes don't have known collisions.

If any of these assumptions is broken (e.g., a quantum computer breaks elliptic curves), existing ZK proofs become forgeable. Migration to post-quantum-secure ZK proofs is ongoing research.

For VibeSwap's roadmap: implement ZK attribution with existing SNARKs/STARKs. Plan for migration when post-quantum ZK becomes practical (likely 5-10 years).

## Integration with Contribution Traceability

[Chat-to-DAG Traceability](./CONTRIBUTION_TRACEABILITY.md) currently uses evidence-hash commitments. The ZK upgrade adds an optional proof field:

```
submitClaim(
    contributor,
    contribType,
    evidenceHash,   // unchanged
    description,    // unchanged
    value,          // unchanged
    zkProof         // NEW: optional, verifiable cryptographic proof
)
```

Claims without `zkProof` behave as today. Claims with `zkProof` are verified; verification-failed claims are rejected.

Tribunals and attestors can weigh ZK-verified claims more heavily than unverified ones (higher verification = higher trust).

## Education

For students new to ZK: build understanding through:
1. Interactive proof demos (e.g., Sudoku ZK, graph coloring ZK).
2. SNARK circuits for simple arithmetic.
3. Attribution circuits for the specific VibeSwap use case.

A future Eridu Labs course on "Cryptographic Attribution" could use VibeSwap's ZK attribution as a concrete running example. From simple interactive proofs to production-ready on-chain ZK attestations — a 6-week course structure.

## Open questions

1. **Which ZK proving framework** for production? Circom+SNARK? Noir+proving? Cairo+STARK?
2. **Proof aggregation strategy** — batch many small attestations into one proof for gas efficiency?
3. **Privacy-vs-audit tradeoff** — how do we give auditors enough verification power without leaking content?
4. **Governance of the circuit** — who approves updates to the ZK circuit? Who audits the circuit itself?

Each is part of the ZK attribution research direction.

## One-line summary

*Zero-knowledge proofs let contributors prove they produced content (or collaborated, or satisfy properties) without revealing what — enabling NDA-protected audits, private dialogue credit, confidential strategic work to earn DAG attribution without exposing content. Optional, expensive, valuable when privacy matters.*
