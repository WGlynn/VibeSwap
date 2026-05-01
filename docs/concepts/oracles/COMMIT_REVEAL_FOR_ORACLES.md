# Commit-Reveal for Oracles

> *A judge announces the sentencing formula AFTER seeing the defendant. That's not justice, that's post-hoc rationalization. The fix: announce the formula BEFORE any defendant appears, and bind yourself to it.*

This doc extracts a primitive from the similarity-keeper design: **any oracle whose output depends on a function choice MUST commit the function publicly before computing any output**. Commit-reveal transforms the function from a trust-me-I-computed-it black box into a verifiable-before-the-fact specification.

## The problem

Oracles are trusted third parties that provide data to smart contracts. Classic cases:
- Price oracles (Chainlink): "what's the ETH price?"
- Random oracles: "what's a random number?"
- Scoring oracles: "what's this contribution's similarity to prior state?"

If the oracle's output is a NUMBER (ETH price at time t), the only trust question is "did you measure it correctly?" The number is exogenous.

If the oracle's output is the RESULT OF A FUNCTION the oracle chose (similarity score, novelty multiplier), there are TWO trust questions:
1. Did you measure correctly?
2. Did you use the right function?

Question 2 is where retroactive tuning lives. An adversarial oracle could:
- See the contributions coming in.
- Choose a similarity function that happens to favor specific contributors.
- Claim "this is my similarity function."

Post-hoc, it's impossible to distinguish "this function was the oracle's genuine choice" from "this function was selected to game the outcome."

Commit-reveal closes this gap. The oracle publicly commits to the function BEFORE seeing any contributions. After that, no retroactive tuning is possible — the function is locked.

## The primitive, stated precisely

**Commit-Reveal for Oracles** is the rule that:

- **Before any oracle output is consumed by the protocol, the oracle must publicly commit to the function producing the output.**
- **Commitment is a hash-binding**: `commitment = keccak256(functionSpec || salt)` where salt is random.
- **Reveal is deferred**: after a governance-set wait period, the oracle reveals `functionSpec` and `salt`. Verifiers check `keccak256(functionSpec || salt) == commitment`.
- **Outputs reference the reveal**: every subsequent output includes proof-of-reveal (e.g., commitment hash + attestation that the output was computed using the revealed function).
- **Function upgrades require new commit-reveal cycles**: the oracle cannot silently change functions.

## Structure of the protocol

### Phase 1: Commitment

Oracle generates random `salt`, computes:
```
commitment = keccak256(functionSpec || salt)
```
Publishes `commitment` on-chain.

`functionSpec` is a structured string:
```
{
  "version": "1.0",
  "type": "similarity",
  "model": "sentence-transformers/all-mpnet-base-v2",
  "metric": "cosine",
  "embeddingDim": 768,
  "normalization": "L2",
  "notes": "https://ipfs.io/ipfs/...notes"
}
```

### Phase 2: Wait period

Governance-set duration, typically 7-14 days. During this period:
- The function is committed but not yet revealed.
- The oracle CANNOT submit outputs yet.
- Community can challenge the commitment (e.g., "we think this function has bias, please don't reveal").

If a challenge has merit, governance can prevent reveal (requires majority vote). Otherwise, the reveal proceeds.

### Phase 3: Reveal

Oracle publishes `functionSpec` and `salt` on-chain. Anyone verifies:
```
keccak256(functionSpec || salt) == commitment
```
If valid, the oracle is now "active" — it can submit outputs.

### Phase 4: Active operation

For each output, the oracle submits:
```
(outputData, referenceCommitment, proof)
```
where `referenceCommitment` is the active function's commitment hash, and `proof` is function-specific (e.g., a hash of intermediate values).

The oracle contract verifies:
- `referenceCommitment` corresponds to an active, revealed function.
- The oracle submitting is the authorized one.
- Proof format is well-formed (function-specific).

### Phase 5: Function upgrade

If the oracle wants to change the function:
- Submit a NEW commitment.
- Go through wait + reveal for the new commitment.
- Old commitment deprecates; new commitment becomes active.
- Outputs under the old commitment remain valid; new outputs use the new function.

Old and new commitments can coexist during a transition window.

## What retroactive tuning looks like (without commit-reveal)

Imagine a similarity oracle without commit-reveal:

1. Alice submits contribution C_A.
2. Oracle observes C_A.
3. Oracle picks similarity function F1 that returns 0.05 for (C_A, {}).
4. Output: "Alice similarity = 0.05, high novelty."
5. Bob submits contribution C_B, similar to Alice's.
6. Oracle observes C_B, which would normally return 0.85 for (C_B, {C_A}).
7. Oracle decides "Bob is my friend, let me pick a function F2 that gives 0.2 instead."
8. Output: "Bob similarity = 0.2, moderate novelty."

Bob was credited for novelty he didn't actually have. This is possible because the oracle chose F1 and F2 INDEPENDENTLY, after observing the inputs.

Commit-reveal prevents this:
- Oracle commits to F1 at time T1.
- Alice submits at T2 > T1. Oracle uses F1 to compute similarity.
- Bob submits at T3 > T2. Oracle uses F1 (same commitment) to compute similarity.
- Oracle CANNOT switch to F2 mid-stream without starting a new commit-reveal cycle, which takes 7+ days.

The oracle's function choice is locked in BEFORE it sees any of the inputs the function will be applied to.

## Why the salt matters

The commitment is `keccak256(functionSpec || salt)`, not `keccak256(functionSpec)`.

Without salt:
- `commitment = keccak256(functionSpec)` uniquely determines `functionSpec`.
- Anyone observing `commitment` can brute-force to discover `functionSpec` (since function specs are enumerable).
- The "commitment" reveals nothing — it's the hash of the spec itself.

With salt:
- `commitment = keccak256(functionSpec || salt)` where salt is a random 32-byte value.
- Even if `functionSpec` is enumerable, brute-forcing requires guessing the salt — infeasible.
- The commitment reveals nothing about the spec until the reveal phase.

This matters because during the wait period, you don't want anyone to know what function will be revealed. Knowing the function enables:
- Gaming the system (preparing inputs that will be favorable under the coming function).
- Colluding with the oracle (offering side-payments for favorable functions).

Salt makes the commitment opaque until reveal.

## Applications in VibeSwap

### Similarity oracle (primary use case)

Gap #2 C42 ships a similarity oracle with commit-reveal. See [`SIMILARITY_KEEPER_DESIGN.md`](./SIMILARITY_KEEPER_DESIGN.md) for details.

### True Price Oracle

Currently, TruePrice uses a Kalman filter with fixed parameters. If those parameters ever became tunable, commit-reveal would apply. See [`TRUE_PRICE_ORACLE_DEEP_DIVE.md`](./TRUE_PRICE_ORACLE_DEEP_DIVE.md).

### Price manipulation detection

If VibeSwap adds a "manipulation detector" (something that flags suspicious price activity), its detection function must be committed to prevent retroactive tuning.

### Fairness scoring

Any future fairness-scoring oracle (e.g., "what's this user's fairness score?") must commit its function.

### Rating oracles in general

Any oracle that scores arbitrary inputs via a function must commit the function. Exceptions: oracles that return EXOGENOUS data (ETH price, VWAP from exchanges) don't need commit-reveal because they don't choose a function — they just measure.

## Attack: commitment-hash enumeration

Even with salt, if `functionSpec` has low entropy, someone could:
1. Enumerate plausible function specs.
2. For each spec, try many salt values.
3. Check if any match the committed hash.

Defense: use high-entropy salt (full 32 bytes) and ensure `functionSpec` includes unique identifiers (timestamps, oracle-specific IDs) that make it unique.

## Attack: governance-side collusion

If the oracle and governance collude:
- Oracle commits to biased function.
- Governance does nothing during challenge period.
- Function reveals. Oracle operates.

Defense: transparency. Every commitment + reveal is on-chain. Any user can fork the protocol or exit if they don't trust the governance-oracle combo.

## Attack: pre-revelation leak

What if the oracle tells someone the function before revealing?

Technically this is possible but hard to prove. Defense: track oracle behavior over time. If an oracle consistently produces favorable outputs for specific parties, investigate.

Long-term, multi-keeper consensus (see [`SIMILARITY_KEEPER_DESIGN.md`](./SIMILARITY_KEEPER_DESIGN.md)) defends against this by requiring M-of-N oracles to agree.

## Why not zero-knowledge proofs?

An alternative to commit-reveal: the oracle proves cryptographically that it applied the committed function correctly, without revealing intermediate data.

Pros:
- Intermediate data (e.g., embeddings) stays private.
- Mathematical rather than procedural trust.

Cons:
- ZK circuits for ML models (similarity via neural embeddings) are cutting-edge research, not production.
- Generation time and proof size often exceed tolerable limits.
- Complexity increases audit surface.

For now, use commit-reveal. Revisit ZK once the technology matures.

## Student exercises

1. **Compute a commitment.** Given `functionSpec = "cosine_mpnet"` and `salt = 0x01...` (32 bytes), compute the commitment via keccak256 concatenation.

2. **Challenge-response scenario.** Write a scenario where a commitment is challenged. What criteria should governance use to reject?

3. **Adversarial audit.** You're investigating an oracle. What evidence would prove retroactive tuning? What evidence is circumstantial but not proof?

4. **Function upgrade dance.** Walk through the steps of upgrading an oracle's function: from old active commitment to new active commitment. Specify state transitions.

5. **Compare to Chainlink.** Chainlink doesn't use commit-reveal for its price feeds. Why? What makes price feeds different from similarity/scoring oracles?

## Governance of commit-reveal

Governance controls:
- Approved function families (e.g., "you can commit to a sentence-transformers model but not to a closed-source LLM").
- Wait-period duration.
- Challenge mechanism (how can a commitment be challenged?).
- Oracle certification (who can submit commitments).

These are settable via governance votes. Default values from launch:
- Approved families: similarity (list of models), TruePrice (Kalman with public params), attestor-scoring (specific methodology).
- Wait period: 7 days.
- Challenge: any address with 100+ governance tokens can challenge; majority of voters decides.
- Oracle certification: initially founder-curated, migrating to bid-based.

## Integration with admin observability

Every commitment, reveal, challenge, and function-activation must emit an event per [ADMIN_EVENT_OBSERVABILITY](./ADMIN_EVENT_OBSERVABILITY.md):

- `event FunctionCommitted(bytes32 indexed commitment, address indexed oracle, uint256 timestamp)`
- `event FunctionRevealed(bytes32 indexed commitment, string functionSpec, uint256 timestamp)`
- `event FunctionChallenged(bytes32 indexed commitment, address indexed challenger, string reason)`
- `event FunctionActivated(bytes32 indexed commitment, address indexed oracle, uint256 timestamp)`
- `event FunctionDeprecated(bytes32 indexed commitment, address indexed oracle, uint256 timestamp)`

Events enable off-chain monitoring + governance dashboards.

## Future work — concrete code cycles this primitive surfaces

### Queued for C42

- **CommitRevealOracle base contract** — abstract contract for any commit-reveal oracle. File: `contracts/oracle/CommitRevealOracle.sol`.
- **SimilarityOracle** — inherits CommitRevealOracle, adds similarity-specific logic. File: `contracts/incentives/SimilarityOracle.sol`.

### Queued for un-scheduled cycles

- **Governance-side challenge interface** — UI/CLI for community to submit challenges. Low priority post-launch.
- **Multi-keeper M-of-N** — require multiple keepers to agree on outputs.
- **ZK-proof variant** — once ZK-ML tech matures.

### Primitive extraction

If 3+ oracle use cases adopt this pattern, extract to `memory/primitive_commit-reveal-oracle.md` as a general design rule: any function-choice oracle MUST use commit-reveal.

## Relationship to other primitives

- **Similarity Keeper Design** (see [`SIMILARITY_KEEPER_DESIGN.md`](./SIMILARITY_KEEPER_DESIGN.md)) — primary use case.
- **Time-Indexed Marginal Credit** (see [`TIME_INDEXED_MARGINAL_CREDIT.md`](./TIME_INDEXED_MARGINAL_CREDIT.md)) — depends on similarity oracle.
- **Augmented Governance** (see [`AUGMENTED_GOVERNANCE.md`](./AUGMENTED_GOVERNANCE.md)) — commit-reveal is a math-enforced invariant layered on top of governance discretion.
- **Admin Event Observability** — event emission requirements.
- **True Price Oracle** — similar trust-boundary concern, different mechanism (Kalman filter with public parameters).

## How this doc feeds the Code↔Text Inspiration Loop

This doc:
1. Names the primitive (Commit-Reveal for Oracles).
2. Specifies the protocol in five phases.
3. Queues C42-relevant code cycles (CommitRevealOracle.sol, SimilarityOracle.sol).
4. Opens research directions (ZK-ML, multi-keeper consensus).

When C42 ships, this doc gets a "shipped" section with commit pointers + first committed function specs.

## One-line summary

*Commit-Reveal for Oracles is the rule that any oracle choosing a function for its output must publicly commit the function BEFORE computing any outputs, preventing retroactive tuning. Five phases: commit, wait, reveal, active operation, upgrade. Ships in C42 via CommitRevealOracle + SimilarityOracle. Applies to similarity/scoring oracles; not to exogenous-data oracles.*
