# Citation-Weighted Bonding Curves for Knowledge Asset Pricing

*ethresear.ch*
*March 2026*

---

## Abstract

Information markets typically price assets by prediction accuracy (Augur, Polymarket) or by staking weight (Numerai). Neither captures the value that foundational work contributes to derivative work — the academic citation problem applied to on-chain knowledge. We present a citation-weighted bonding curve mechanism where the price of a knowledge asset is a function of how many subsequent assets cite it, with revenue attribution via Shapley values ensuring that foundational contributors earn indefinitely as derivatives build on their work. We describe the on-chain pricing formula, the citation graph structure, the Shapley revenue split, the epoch anchoring system, and the Poe revaluation mechanism for retroactive justice — all implemented in approximately 950 lines of Solidity across three composable contracts.

---

## 1. The Problem: Knowledge Has No Market Price

Academic publishing is a $30B annual industry built on a paradox: the people who produce the knowledge (researchers) receive none of the revenue from its distribution, while the people who distribute it (publishers) capture all of it. Peer review is unpaid labor. Citation counts determine careers but generate zero economic value for the cited author. A paper cited 10,000 times earns its author exactly as much as a paper cited zero times — nothing.

DeFi has solved analogous problems for financial assets. Uniswap prices tokens via constant-product bonding curves. Aave prices credit risk via utilization curves. Compound prices time-value via interest rate models. But none of these mechanisms address **knowledge as an asset class** — information whose value is a function of how much subsequent work builds on it.

The existing approaches to on-chain knowledge markets each miss something fundamental:

**Prediction markets** (Augur, Polymarket) price beliefs about future events. They work well for binary outcomes (will X happen?) but cannot price the value of a research paper, a dataset, or an AI model — assets whose value is determined by downstream utility, not binary resolution.

**Staking-weighted markets** (Numerai) let participants stake tokens to signal confidence in their predictions. The market rewards accuracy. But accuracy is only one dimension of knowledge value — a foundational insight that enables 100 derivative works may itself have low "accuracy" in the prediction sense while having enormous structural value.

**Data marketplaces** (Ocean Protocol, OriginTrail) price data by owner-set access fees. This is the knowledge equivalent of a fixed-price listing — the owner guesses what their data is worth, and the market either pays or doesn't. There is no mechanism for price discovery, no way for the market to signal that a dataset has become more valuable because 50 AI models now depend on it.

What is missing is a pricing mechanism that treats knowledge like what it is: a public good with positive externalities, whose value increases as more people build on it.

---

## 2. Citation-Weighted Bonding Curves

We introduce a bonding curve whose independent variable is not supply (as in standard curves) but **citation count** — the number of subsequent knowledge assets that formally cite this one.

### The Pricing Formula

```
price(n) = BASE * (1 + n * 0.15)^1.5
```

Where:
- `n` is the citation count (number of assets that cite this asset)
- `BASE` is the minimum access price (0.001 ETH in our implementation)
- `0.15` is the citation factor (each citation increases the linear component by 15%)
- `1.5` is the superlinear exponent

The exponent 1.5 creates superlinear growth — highly-cited foundational work becomes disproportionately more valuable than lightly-cited work. This matches empirical citation distributions. Lotka's law observes that the number of authors making n contributions follows a power law with exponent approximately 2. De Solla Price's cumulative advantage model shows that citation accrual is self-reinforcing: papers that are already cited attract more citations. A superlinear bonding curve encodes this empirical reality into the pricing mechanism.

### On-Chain Implementation

Full exponentiation (x^1.5) is expensive in the EVM. We decompose it:

```
x^1.5 = x * x^0.5 = x * sqrt(x)
```

The Solidity implementation computes the linear component and then applies a square root multiplier:

```solidity
function _calculateBondingPrice(uint256 citations_) internal pure returns (uint256) {
    // Linear component: (1 + citations * 0.15) = (10000 + citations * 1500) / 10000
    uint256 linearFactor = BPS + (citations_ * BONDING_CITATION_FACTOR);

    // Base price scaled by linear factor
    uint256 linearPrice = (BONDING_BASE_PRICE * linearFactor) / BPS;

    // Apply sqrt multiplier for ^1.5 effect
    uint256 sqrtFactor = _sqrt(linearFactor * PRECISION) * BPS / _sqrt(BPS * PRECISION);

    return (linearPrice * sqrtFactor) / BPS;
}
```

The Babylonian square root (_sqrt) converges in O(log n) iterations. For citation counts below 1,000 (covering >99.9% of academic work by Lotka's law), the gas cost of the full price calculation is under 5,000 gas — negligible compared to the storage operations in the access purchase flow.

### Price Behavior

| Citations | Linear Factor | Price (ETH) | Multiple of BASE |
|-----------|--------------|-------------|-------------------|
| 0 | 1.00 | 0.001 | 1.0x |
| 1 | 1.15 | 0.00123 | 1.23x |
| 5 | 1.75 | 0.00231 | 2.31x |
| 10 | 2.50 | 0.00395 | 3.95x |
| 50 | 8.50 | 0.0248 | 24.8x |
| 100 | 16.0 | 0.0640 | 64.0x |

A paper cited 100 times costs 64x more to access than an uncited paper. This is not punitive — it reflects the empirical reality that highly-cited work provides disproportionately more value. The 64x factor is comparable to the price difference between a niche journal article and a foundational textbook in traditional publishing — except here, the revenue flows to the author, not the publisher.

---

## 3. Revenue Attribution via Shapley Values

When a knowledge asset A is accessed, the purchase price is not paid entirely to A's contributor. A portion is attributed to the assets that A cites — the foundational work that made A possible.

### The Split

```
contributor_share = price * 70%
citation_pool     = price * 30%
```

The citation pool is distributed proportionally among all assets cited by A. If A cites three prior works B, C, and D, each receives 10% of the access price (30% / 3). This is a simplified proportional split used for gas-efficient on-chain settlement.

### Why 70/30?

The split is a design parameter, not an axiom. The reasoning: 70% rewards the direct contributor for the work of synthesis, analysis, and presentation. 30% acknowledges that all knowledge is derivative — every paper stands on the shoulders of prior work, and the pricing mechanism should reflect this structural dependency. The 30% figure is inspired by the Shapley value literature on "enabling contributions" — in cooperative games, the marginal contribution of enabling inputs (foundational work that makes new work possible) is typically 20-40% of total coalition value.

### True-Up via Full Shapley

The 70/30 proportional split is an approximation. The true Shapley value of each contributor — accounting for the full citation graph, transitive dependencies, and coalition structure — is computationally expensive (O(2^n) in the general case). We handle this through periodic "true-up" rounds:

1. Off-chain computation runs the full Shapley algorithm over the citation graph
2. Results are submitted as a Merkle root via the SIEShapleyAdapter
3. The on-chain verifier checks four axioms: efficiency (total distributed equals total pool), sanity (no individual allocation exceeds the pool), the Lawson Floor (minimum 1% of average reward for any non-zero contributor), and Merkle proof validity
4. The difference between the simplified split and the true Shapley allocation is distributed

This is the execution/settlement separation pattern: simplified splits run on every access (cheap, immediate), full Shapley runs periodically (expensive, accurate), and the true-up distributes the delta.

### Four Weight Factors

The SIEShapleyAdapter computes contribution weights along four dimensions, mirroring the liquidity provider weight system used in the batch auction mechanism:

| Factor | Weight | Measures |
|--------|--------|----------|
| Originality | 40% | How novel is this contribution relative to the existing graph |
| Citation Impact | 30% | How many subsequent works build on this one |
| Scarcity | 20% | Uniqueness — does this fill a gap in the knowledge graph |
| Consistency | 10% | Sustained contribution over time, not one-shot |

These weights produce a composite score that feeds into the Shapley value calculation. The 40/30/20/10 split reflects the protocol's values: originality is the most important property of knowledge (you cannot cite what does not exist), but enabling others (citation impact) is nearly as valuable as creating something new.

---

## 4. The Citation Graph: Anti-Sybil Properties

On-chain citations create a directed acyclic graph (DAG) where edges represent intellectual dependency. This graph must resist manipulation.

### Self-Citation Prevention

Self-citation is prohibited at the contract level:

```solidity
error SelfCitation();
// In submitIntelligence():
if (citedAssets[i] == assetId) revert SelfCitation();
```

An author cannot cite their own work to inflate their bonding curve price. This is enforced at the asset level (same content hash), not the address level — an author can cite a genuinely different piece of their own prior work from a different submission, which is legitimate academic practice.

### Citation Ring Detection

Citation rings (A cites B, B cites C, C cites A) are detectable via cycle detection on the DAG. The on-chain contract does not perform cycle detection (O(V+E) is too expensive for large graphs), but the off-chain Shapley computation does. Citations that form cycles are excluded from the Shapley calculation, reducing the effective citation count for bonding curve pricing in the next true-up round.

The key insight: cycle detection does not need to be real-time. A citation ring temporarily inflates the bonding curve price, but the periodic Shapley true-up corrects the attribution. The ring participants gain a short-term price advantage but earn no long-term Shapley revenue from the manipulation — because the Shapley value of a circular citation chain is zero (no net marginal contribution to the coalition).

### Duplicate Citation Prevention

The same asset cannot be cited twice by the same citing work:

```solidity
error DuplicateCitation();
```

This prevents a trivial inflation attack where an author repeatedly cites the same foundational work to pump its bonding price.

---

## 5. Knowledge Epoch Anchoring

The full knowledge graph lives off-chain (IPFS for content, a shard network for evaluation). On-chain, we store only Merkle roots — compact commitments to the off-chain state.

### Epoch Structure

```solidity
struct KnowledgeEpoch {
    uint256 epochId;
    bytes32 merkleRoot;     // Root of the knowledge Merkle tree
    uint256 assetCount;     // Total assets in this epoch
    uint256 totalValue;     // Cumulative value of all assets
    uint256 timestamp;
    address submitter;      // Authorized epoch submitter (Jarvis shard)
}
```

Epochs are anchored approximately every 5 minutes by authorized submitters. Each epoch captures a snapshot of the knowledge graph — which assets exist, their citation counts, their accumulated revenue, and their Shapley attributions.

### Chain Selection for Knowledge Forks

When two shards disagree on the state of the knowledge graph (a "knowledge fork"), the chain with higher **aggregate value density** wins. Value density replaces hash rate as the selection criterion — this is Nakamoto consensus with cognitive work replacing computational work. The fork with more high-quality, high-citation assets is selected, not the fork with more compute behind it.

This is meaningful because knowledge forks are substantively different from blockchain forks. In Bitcoin, a fork means two miners found a block simultaneously — the "correct" chain is arbitrary (longest wins). In a knowledge graph, a fork means two evaluator groups disagree about whether a contribution is valid. The "correct" fork is the one containing higher-quality knowledge, which value density approximates.

### Verifiability Without Replication

On-chain epoch anchoring means any participant can verify the off-chain knowledge state without replicating the full graph. Given an asset ID and a Merkle proof, the on-chain contract can confirm: this asset exists, it has N citations, and its Shapley attribution is X — all without storing the content or the graph on-chain.

This is the same design pattern used by Ethereum's beacon chain for validator attestations: the full state lives off-chain, Merkle roots anchor it on-chain, and proofs bridge the gap.

---

## 6. Poe Revaluation: Retroactive Justice

Not all contributions reveal their worth immediately. A dataset might be ignored for months before an AI model trained on it produces a breakthrough. A research paper might be ahead of its time. In traditional academia, this is the "sleeping beauty" problem — papers that receive zero citations for years and then suddenly become foundational.

We address this with the PoeRevaluation contract, named after Edgar Allan Poe, who died penniless while his work became among the most influential in literary history. The protocol must account for late-discovered value.

### Mechanism

1. **Propose**: Anyone can propose a Poe revaluation for a previously settled contribution, submitting an evidence hash (IPFS CID of an evidence document explaining why the contribution deserves revaluation)

2. **Conviction Staking**: Community members stake tokens to back the proposal. The proposal becomes executable after reaching a conviction threshold — 0.1% of total staking token supply, sustained for a minimum of 7 days

3. **Execution**: Once executable, the revaluation creates a new Shapley game funded from protocol emissions. The revalued contributor receives a retroactive allocation proportional to their newly-recognized marginal contribution

4. **Safeguards**:
   - Minimum 7-day conviction period prevents impulsive claims
   - Maximum 10% of Shapley pool per proposal prevents drain attacks
   - 30-day cooldown per contributor prevents spam
   - Bonding curve health gate blocks revaluations during market stress

### Why This Matters

Retroactive public goods funding (Optimism's RPGF, Gitcoin) addresses a similar problem but relies on committee votes — subjective, slow, and capture-prone. Conviction staking is permissionless and continuous: any community member can signal belief, and the 7-day sustained threshold filters out noise without requiring a committee.

The Poe mechanism transforms the knowledge market from a spot market (you earn only at time of access) into a market with retroactive repricing (you earn when the market eventually recognizes your contribution's value). This is closer to how knowledge actually works — Einstein's 1905 papers were not immediately recognized as revolutionary, but their value compounded for a century.

---

## 7. Composability with Existing Infrastructure

The citation-weighted bonding curve composes with the existing commit-reveal batch auction and Shapley distribution infrastructure:

### Submission Flow (Isomorphic to Swap Flow)

| Liquidity Swap | Intelligence Exchange |
|---|---|
| Commit order (hash + deposit) | Submit knowledge (content hash + stake) |
| Reveal order | CRPC evaluation |
| Batch settle (uniform price) | Bonding curve price |
| Shapley distribute | Shapley attribute (citations) |

The structural isomorphism is deliberate. The same ShapleyDistributor contract (62 tests passing, 500-game adversarial verification) distributes rewards for both liquidity provision and knowledge contribution. The same PairwiseFairness library verifies proportionality in both contexts. The same Lawson Floor (1% minimum guarantee for non-zero contributors) applies to both.

### CRPC Evaluation

Before a knowledge asset is priced and traded, it must be verified. We use Commit-Reveal Pairwise Comparison (CRPC) — the same information-hiding mechanism used for trade settlement, applied to peer review:

1. Evaluators commit hash(evaluation || secret)
2. Evaluators reveal their assessment
3. Pairwise agreement is computed using the same Fisher-Yates shuffle + XOR entropy mechanism
4. Consensus emerges from independent, hidden evaluations

This eliminates the "reviewer bias" problem in traditional peer review — evaluators cannot see each other's assessments before committing their own, preventing herding behavior and strategic agreement.

### Zero Extraction

The intelligence exchange enforces P-001 at the contract level:

```solidity
uint256 public constant PROTOCOL_FEE_BPS = 0;
```

100% of access revenue flows to contributors and their cited sources. The protocol takes nothing. Revenue for protocol operations comes from priority bids (users who want guaranteed evaluation ordering) and from penalties (slashed stakes for invalid submissions) — never from the knowledge itself.

---

## 8. Relation to Existing Work

**OriginTrail (DKG)**: Decentralized knowledge graph with on-chain anchoring. OriginTrail's knowledge assets use fixed pricing set by the asset creator. Our contribution: dynamic pricing via citation-weighted bonding curves, where the market determines value through usage patterns rather than creator assertion.

**Ocean Protocol**: Data marketplace with compute-to-data. Ocean prices datasets via creator-set access fees, similar to OriginTrail. Our contribution: Shapley-attributed revenue sharing across the citation graph, so foundational datasets earn revenue when derivative work is accessed.

**Augmented Bonding Curves (Commons Stack)**: Power-function bonding curves with dual reserve/funding pools and entry/exit tributes. We use their mathematical framework (Zargham, Shorish, Paruch 2020) for the broader protocol economy but replace supply-based pricing with citation-based pricing for knowledge assets specifically. The key difference: in a standard bonding curve, price is a function of tokens minted. In a citation-weighted curve, price is a function of downstream utility.

**Retroactive Public Goods Funding (Optimism RPGF)**: Committee-based retroactive funding for public goods. Our Poe mechanism replaces committee votes with conviction staking — permissionless, continuous, and resistant to the committee capture that has been documented in early RPGF rounds.

**Lotka's Law / De Solla Price**: Empirical power-law distributions in academic citation. Our 1.5 exponent is calibrated to match these distributions, creating a pricing mechanism that reflects the natural structure of knowledge production.

**Shapley (1953)**: The theoretical foundation. Shapley values satisfy efficiency, symmetry, null player, and additivity — the same axioms we verify on-chain via the PairwiseFairness library. The citation-weighted bonding curve is, in effect, a Shapley value approximation where citations serve as a proxy for marginal contribution to the knowledge coalition.

---

## 9. Open Questions

**Optimal bonding curve exponent.** We use 1.5 based on Lotka's law, but the optimal value may depend on the knowledge domain. Empirical citation distributions in mathematics follow a steeper power law than those in biology. Should the exponent be domain-specific, or does a universal exponent create beneficial cross-domain incentive alignment? If domain-specific, how should the protocol determine which domain an asset belongs to?

**Citation lag and price accuracy.** The bonding curve price reflects current citation count, but citations accrue over time. A paper published today has zero citations and minimum price, even if it is obviously foundational. The Poe revaluation mechanism partially addresses this, but there may be a more elegant solution: a predictive citation model that estimates future citations based on early signals (topic, author history, evaluator scores). How much prediction accuracy is needed before speculative pricing outperforms reactive pricing?

**Cross-chain citation graphs.** Knowledge assets may live on different chains (Ethereum L2s, alternative L1s). Cross-chain citations require atomic verification: if A on Base cites B on another chain, the citation must be validated on both chains. We use LayerZero V2 for message passing, but the liveness assumptions of bridge-based settlement are weaker than native on-chain atomicity. Is there a way to make cross-chain citations as trustworthy as same-chain citations?

**Sybil resistance at the content level.** Address-level sybil resistance is well-studied. Content-level sybil resistance — preventing an author from publishing the same insight under ten slightly different phrasings to collect ten minimum-price access fees — is harder. Semantic similarity detection is an off-chain problem. How should the on-chain mechanism respond to off-chain sybil signals?

**Bonding curve reflexivity.** A highly-cited asset has a high access price. A high access price discourages new citations (because derivative work must cite expensive sources). This creates a potential ceiling effect where the most foundational work becomes inaccessible. Is there a bonding curve shape that rewards citation without creating access barriers? One candidate: a curve that increases price superlinearly but donates a fraction of each purchase to a "public access fund" that subsidizes access to high-citation assets.

---

## 10. Implementation

The implementation spans three composable UUPS-upgradeable contracts:

| Contract | Lines | Role |
|----------|-------|------|
| `IntelligenceExchange.sol` | ~600 | Orchestrator: submission, citation, access, epochs |
| `SIEShapleyAdapter.sol` | ~200 | Bridge: simplified split to full Shapley true-up |
| `PoeRevaluation.sol` | ~350 | Retroactive: conviction-staked revaluation |

All three compose with existing infrastructure: `ShapleyDistributor.sol` for reward distribution, `PairwiseFairness.sol` for axiom verification, `CognitiveConsensusMarket.sol` for CRPC evaluation, and `VibeCheckpointRegistry.sol` for epoch anchoring.

The full implementation is MIT-licensed.

- [IntelligenceExchange.sol](https://github.com/WGlynn/VibeSwap/blob/master/contracts/mechanism/IntelligenceExchange.sol)
- [SIEShapleyAdapter.sol](https://github.com/WGlynn/VibeSwap/blob/master/contracts/mechanism/SIEShapleyAdapter.sol)
- [PoeRevaluation.sol](https://github.com/WGlynn/VibeSwap/blob/master/contracts/incentives/PoeRevaluation.sol)
- [ShapleyDistributor.sol](https://github.com/WGlynn/VibeSwap/blob/master/contracts/incentives/ShapleyDistributor.sol)
- [PairwiseFairness.sol](https://github.com/WGlynn/VibeSwap/blob/master/contracts/libraries/PairwiseFairness.sol)

---

*Built on Ethereum. Verified by Shapley. Priced by citation. Revenue to the mind, not the middleman.*
