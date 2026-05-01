# Similarity Keeper Design

> *Two students submit nearly identical essays a month apart. The DAO needs to compute the similarity between them to apply novelty-weighted credit. But computing text similarity requires large models — neural embeddings, vector distances — which don't fit on-chain. Enter the keeper: an off-chain service that does the math and commits the results on-chain via commit-reveal.*

This doc designs the off-chain similarity keeper that supports Gap #2 (Time-Indexed Marginal Credit, C41-C42). The keeper computes embedding-based similarity between contributions and publishes results via a commit-reveal protocol that prevents retroactive tuning.

## The problem

Gap #2's mechanism requires a similarity function `sim(C, S)` where C is a contribution and S is the ecosystem state at arrival time. This similarity is used to compute novelty multipliers for Shapley rewards.

On-chain similarity computation is infeasible:
- Neural embeddings require model weights (10s of MBs).
- Vector distance over high-dim spaces is gas-prohibitive.
- On-chain ML is an active research area but not production-ready.

Off-chain similarity computation is feasible but introduces a trust boundary: what if the keeper computes similarities dishonestly?

The fix: the keeper publishes results via commit-reveal. Before computing any similarity score, the keeper commits the similarity function (as a signed, versioned hash). Subsequent score publications include a proof that they used the committed function. This prevents retroactive tuning — the keeper can't change the similarity function to favor specific contributors.

## Architecture

```
┌─────────────────────────────┐
│  Contribution lands on-chain │
│   (via ContributionAttestor) │
└──────────────┬──────────────┘
               │
               ▼  keeper observes
┌─────────────────────────────┐
│    Similarity Keeper         │
│                              │
│  1. Fetch contribution data  │
│  2. Fetch ecosystem state S  │
│     at arrival time          │
│  3. Compute embedding(C)     │
│  4. Compute sim(C, S)        │
│  5. Submit to on-chain store │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ SimilarityOracle (on-chain)  │
│                              │
│  Stores:                     │
│   (claimId, sim_score, proof)│
│                              │
│  Verifies:                   │
│   - signature from keeper    │
│   - proof references         │
│     committed function       │
└──────────────┬──────────────┘
               │
               ▼  consumed by
┌─────────────────────────────┐
│    ShapleyDistributor        │
│                              │
│  Reads similarity score,     │
│  computes novelty multiplier,│
│  distributes rewards         │
└─────────────────────────────┘
```

The keeper is a Python service running on a regular server (not a blockchain). It's permissioned — only governance-certified keepers can submit scores.

## The commit-reveal lifecycle

Before the keeper can submit similarity scores, it must commit its similarity function:

1. **Function definition**: the keeper publishes a function spec (e.g., "cosine similarity over 768-dim embeddings from model sentence-transformers/all-mpnet-base-v2").
2. **Salt + hash**: the keeper generates a random salt, computes `commitment = keccak256(functionSpec || salt)`, publishes `commitment` on-chain.
3. **Wait period**: a governance-set wait period (e.g., 7 days) elapses. During this window, anyone can challenge the commitment (e.g., "this embedding model has known biases").
4. **Reveal**: after the wait, the keeper reveals `functionSpec` and `salt`. Anyone can verify `keccak256(functionSpec || salt) == commitment`.
5. **Active**: the keeper can now submit similarity scores. Each score references the active commitment.

If the keeper wants to upgrade the similarity function, it starts a new commit-reveal cycle. Old scores remain valid under the old function; new scores use the new function.

**Governance controls**: the list of approved similarity functions. A keeper can only commit to a function that governance has whitelisted. This prevents a keeper from committing to an obviously broken function.

## On-chain interface

```solidity
interface ISimilarityOracle {
    function commitFunction(bytes32 commitment) external;
    function revealFunction(string calldata spec, bytes32 salt) external;
    function submitScore(
        bytes32 claimId,
        bytes32 stateHash,
        uint256 similarityScaled,  // 0 to 1e18
        bytes calldata proof
    ) external;
    function getScore(bytes32 claimId) external view returns (uint256);
}
```

`similarityScaled` is the similarity value × 1e18 (e.g., 0.75 similarity = 750000000000000000).

`proof` includes the active commitment ID + any function-specific proof (e.g., hash of embedding, chain of reasoning).

## The trust boundary

Who trusts whom, and for what?

- **VibeSwap trusts the keeper** to compute similarities correctly (given the committed function).
- **The keeper trusts VibeSwap** to accept valid proofs and reject invalid ones.
- **Governance trusts** neither — governance sets the rules and can slash keepers for misbehavior.

The keeper is a limited-trust entity. It's not "oracle" in the sense of Chainlink — it's not pulling prices from exchanges. It's computing a function (similarity) over publicly-available data (contributions). Anyone can recompute and verify.

**Verification**: any third party can, at any time:
1. Fetch claim data (public on-chain).
2. Fetch ecosystem state data at time of arrival (public on-chain).
3. Apply the committed similarity function.
4. Compare to the keeper's submitted score.
5. Slash the keeper if results differ (governance vote).

This is the "lazy verification" pattern — nobody is forced to verify every score, but anyone CAN verify any score. Economic rationality drives audits.

## Keeper implementation

Python service, runs continuously:

```python
import asyncio
from web3 import Web3
from sentence_transformers import SentenceTransformer

MODEL = SentenceTransformer('sentence-transformers/all-mpnet-base-v2')

async def process_claim(claim_id: str, contribution_text: str, state_texts: list):
    # Compute embeddings
    c_emb = MODEL.encode(contribution_text)
    s_embs = [MODEL.encode(t) for t in state_texts]

    # Compute max similarity to any prior state
    max_sim = max(cosine_similarity(c_emb, s_emb) for s_emb in s_embs)

    # Scale and submit
    similarity_scaled = int(max_sim * 1e18)
    proof = build_proof(claim_id, c_emb)

    tx = contract.functions.submitScore(
        claim_id,
        compute_state_hash(state_texts),
        similarity_scaled,
        proof
    ).build_transaction(...)
    send_tx(tx)

async def event_loop():
    async for event in listen_for_new_claims():
        claim = fetch_claim(event.claim_id)
        state = fetch_ecosystem_state_at_time(event.arrival_time)
        await process_claim(event.claim_id, claim.text, state.texts)

asyncio.run(event_loop())
```

Actual implementation more complex (rate limiting, error handling, retry logic, embedding caching) but this is the sketch.

## Embedding model choice

Why `all-mpnet-base-v2`?

- **Quality**: strong performance on semantic similarity benchmarks (STS-b, Quora duplicate detection).
- **Size**: 420M parameters — runs on a modest GPU or CPU in tolerable time.
- **Open-source**: can be audited.
- **Multilingual variants** exist for future expansion.

Alternatives considered:
- **OpenAI text-embedding-3-large**: better quality but proprietary and API-gated. Trust boundary extends to OpenAI.
- **sentence-transformers/all-MiniLM-L6-v2**: smaller (22M params), faster, but lower quality.
- **Custom-trained model**: possible but requires training data + compute.

For launch, use `all-mpnet-base-v2`. Post-mainnet, re-evaluate based on observed performance.

## Governance of keeper selection

The initial keeper is... TBD. Options:

1. **Founder-operated**: VibeSwap team runs the keeper. Simple but centralized.
2. **Grant-funded third party**: an ecosystem grant funds a trusted third-party operator. More decentralized but still permissioned.
3. **Bidding mechanism**: prospective keepers bid for the role. Most decentralized but introduces auction design complexity.

For launch: option 1 with documented plan to migrate to option 3 within 6 months of mainnet.

Governance-controlled rotation: the active keeper can be rotated by a governance vote. A rotation triggers:
- Current keeper's commitment expires at a grace period (e.g., 30 days).
- New keeper publishes their commitment.
- During handoff, both keepers may submit (for redundancy).

## Multi-keeper consensus (future)

Post-launch, require M-of-N keepers to agree on scores before they're accepted. Pros:
- Reduces single-point-of-failure trust.
- Catches individual keeper bugs (if 2 of 3 agree and one disagrees, investigate).

Cons:
- Coordination overhead.
- Possible liveness issues (if M-1 keepers are down, scores stall).

Not in C41/C42 scope. Queued as future work when keeper economy matures.

## Student exercises

1. **Compute similarity by hand.** Given two short texts, compute bag-of-words cosine similarity. Compare to what an embedding model would produce. Discuss the difference.

2. **Design the proof format.** What data should the `proof` field contain? Write a spec.

3. **Adversarial keeper.** Suppose a keeper wants to favor contributor Alice. What attacks can they run? Which are prevented by commit-reveal? Which aren't?

4. **Keeper outage.** Suppose the keeper goes down for 24 hours. New claims land but no similarity scores. Design a recovery protocol.

5. **Alternative architecture.** Design a zero-knowledge proof of similarity — the keeper proves correctness without revealing the embedding. Discuss feasibility.

## Security considerations

- **Reentrancy**: scores are write-once per claimId. No reentrancy risk.
- **Denial-of-service**: keeper submits scores at its own pace. No on-chain DoS.
- **Front-running**: score submissions can be front-run, but keeper's signature anchors them to a specific submitter. Only the designated keeper can submit for a given claim.
- **Griefing**: if governance rotates keepers rapidly, scores could stall. Mitigation: governance votes on rotation require minimum quorum + waiting period.
- **Data availability**: if off-chain data (contribution texts) becomes unavailable, scores can't be recomputed for verification. Mitigation: store content hashes on-chain via IPFS/Arweave.

## Gas costs

Per score submission:
- Call keeper contract: ~5000 gas overhead
- Storage write (score): ~20000 gas (SSTORE)
- Event emission: ~2500 gas
- Signature verification: ~3000 gas
- Total: ~30000 gas

At gas price 20 gwei and ETH $3000, cost per score ≈ $1.80. At 1000 scores/day, keeper cost ≈ $1800/day in gas, plus infrastructure. Substantial — may require subsidization initially.

## Future work — concrete code cycles

### Queued for C42

- **SimilarityOracle contract** — implement ISimilarityOracle interface. File: `contracts/incentives/SimilarityOracle.sol`.
- **Keeper service** — Python with sentence-transformers + web3 integration. File: `scripts/similarity-keeper.py`.
- **Integration test** — simulate 10 contributions over 1 week, assert Shapley rewards reflect similarities. File: `test/integration/SimilarityIntegrationTest.t.sol`.

### Queued for un-scheduled cycles

- **Multi-keeper consensus** — add M-of-N agreement requirement.
- **ZK-proof variant** — keeper proves correctness without revealing embedding.
- **Alternative embedding evaluation** — A/B test different models, publish comparison.

### Primitive extraction

If commit-reveal oracle patterns recur (beyond similarity), extract to `memory/primitive_commit-reveal-oracle.md`.

## Relationship to other primitives

- **Time-Indexed Marginal Credit** (see [`TIME_INDEXED_MARGINAL_CREDIT.md`](../concepts/monetary/TIME_INDEXED_MARGINAL_CREDIT.md)) — the primitive this keeper supports.
- **ContributionAttestor** — provides claim data to the keeper.
- **ShapleyDistributor** — consumes similarity scores.
- **Augmented Governance** (see [`AUGMENTED_GOVERNANCE.md`](./AUGMENTED_GOVERNANCE.md)) — keeper is permissioned-but-bounded, matching the augmented governance pattern.

## How this doc feeds the Code↔Text Inspiration Loop

This doc specifies:
- The on-chain interface (SimilarityOracle.sol).
- The off-chain service (similarity-keeper.py).
- The commit-reveal protocol.
- The keeper economy (gas costs, governance).

Each of these is a concrete code-hook. C42 cycle consumes them. Post-launch learnings feed back into this doc as a "shipped" section.

## One-line summary

*Similarity Keeper is the off-chain service computing embedding-based contribution similarity for Gap #2 TIMC. Runs sentence-transformers model, submits scores via commit-reveal-protected SimilarityOracle contract. Trust bounded by committed-function invariant + lazy-verifiable scores + governance rotation. ~30000 gas per score. Ships in C42 (target 2026-04-28).*
