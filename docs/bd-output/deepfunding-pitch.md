# Deepfunding x VibeSwap — Convergence Meeting

**Prepared for**: Will Glynn (Faraday1)
**Date**: March 2026
**Type**: Partnership conversation guide (not a cold pitch)

---

## Framing

This is not a pitch. You inspired their Shapley adoption. They inspired your ContributionDAG. You are meeting someone who already built half of what you need, and you built the other half. Say that.

---

## 1. "We Already Built Each Other's Missing Piece"

- **Deepfunding solved WHO** — dependency graph maps which repos Ethereum depends on, via Open Source Observer
- **VibeSwap solved HOW MUCH** — Shapley values compute each node's marginal contribution to the whole
- Neither is complete alone: a graph without fair distribution is just a map; fair distribution without a graph has nothing to distribute over
- Together: contribution evidence (their graph) feeds into fair reward computation (our engine) = complete pipeline
- This isn't a partnership of convenience — we literally built toward each other from opposite directions

## 2. The Generalization

- **Their model**: GitHub repos -> dependency graph -> human jurors (Pairwise) spot-check -> allocator models weight nodes -> Drips distributes
- **Our model**: ANY contribution -> weighted DAG (vouch/handshake trust network) -> Shapley value computation -> on-chain distribution
- We didn't fork their idea — we generalized it:
  - From software dependencies to cooperative game theory
  - From GitHub repos to any contributor (LPs, traders, developers, community)
  - From off-chain models to on-chain autonomous settlement
- Their 3 levels (Fund the Farm/Farm to Forest/Fund the Forest) map directly to our BFS trust hops: founders -> trusted -> partial trust -> low trust

## 3. What We Built (Numbers)

**ContributionDAG.sol** (`contracts/identity/ContributionDAG.sol`)
- Vouch/handshake trust network — bidirectional vouches form handshakes
- BFS from founders computes distance-based trust scores, 15% decay per hop, max 6 hops
- Trust levels: FOUNDER (3x), TRUSTED (2x), PARTIAL (1.5x), LOW (1x), UNTRUSTED (0.5x)
- Merkle-compressed vouch audit trail — any vouch is cryptographically verifiable
- 7-day timelock on founder changes (founders get 3x voting power)
- 52 unit tests + 9 fuzz tests + invariant tests

**ShapleyDistributor.sol** (`contracts/incentives/ShapleyDistributor.sol`)
- 5 axioms enforced on-chain: Efficiency, Symmetry, Null Player, Pairwise Proportionality, Time Neutrality
- Two-track distribution: fee distribution (time-neutral, pure Shapley) + token emission (Bitcoin-style halving)
- 4-component weighted contribution: Direct (40%), Enabling/time (30%), Scarcity (20%), Stability (10%)
- Lawson Fairness Floor: 1% minimum for any honest contributor
- Pioneer bonus: up to 2x for first-to-publish (PriorityRegistry integration)
- 62 unit tests, 1,267 lines of test coverage

**ExtractionDetection.t.sol** (`test/simulation/ExtractionDetection.t.sol`)
- 9 scenarios proving extraction is mathematically detectable on-chain
- Protocol fee skimming, whale overallocation, admin extraction, null player, symmetry, efficiency conservation
- 2 fuzz tests: random extraction ALWAYS detected, self-correction ALWAYS conserves value
- Quote: "If extraction is mathematically provable on-chain, the system self-corrects autonomously for ungoverned neutrality."

**VIBEToken.sol** (`contracts/monetary/VIBEToken.sol`)
- 21M lifetime cap (Bitcoin-aligned), zero initial supply
- Minted exclusively through Shapley distribution — never pre-mined, never airdropped
- ERC20Votes for on-chain governance delegation

**Full project**: 351 contracts, 15K+ tests, 1,835+ commits, $0 funding, 0% pre-mine

## 4. The Lawson Fairness Floor (Demo Piece)

This is the thing to walk them through concretely:

- **Problem**: Pure Shapley can allocate near-zero to small contributors (mathematically correct but socially destructive)
- **Solution**: 1% minimum of total game value for ANY participant with non-zero contribution
- **Mechanism**: Deficit redistribution — the floor amount is funded by proportional deductions from above-floor participants
- **Null players still get zero** — the floor only activates for honest contributors (preserves Null Player axiom)
- **Named after Jayme Lawson** — community-first ethos as a design constant, not a marketing slogan
- **Code reference**: `ShapleyDistributor.sol` lines 529-557 — the enforcement loop is ~30 lines of Solidity, readable in a meeting

Why this matters for Deepfunding: their Level 3 has 5,000+ child nodes. Without a fairness floor, small but real dependencies get rounded to dust. The Lawson Floor ensures the long tail of open source gets something.

## 5. Integration Possibilities

- **Data flow**: Deepfunding's Open Source Observer dependency data -> feeds ContributionDAG as contribution evidence (vouches become dependency edges)
- **Computation**: ShapleyDistributor computes marginal contribution over the enriched graph -> distributes funds fairly
- **Cross-ecosystem bridge**: A contribution proven in Deepfunding's graph earns trust score in VibeSwap's economy (and vice versa)
- **Their allocator models could run on-chain**: AgentRegistry + PairwiseVerifier (commit-reveal) = MEV-resistant model competition
- **Tooling is general-purpose**: Any project can plug in their own contribution data — Deepfunding's dependency graph is just one input source
- **Shared infrastructure**: Their Pairwise spot-checking maps to our ReputationOracle for juror trust scoring

## 6. The Ask

1. **Integration partnership** — their dependency data + our distribution engine, starting with a shared pilot (pick one seed node, run both systems, compare results)
2. **Grant for ContributionDAG + Shapley tooling** — everything is open source, benefits the entire ecosystem, not just VibeSwap
3. **Co-publication** — the generalization from software dependencies to cooperative game theory is a paper worth writing together
4. **Jury participation** — Will as a Pairwise spot-checker (puts skin in their game, builds mutual credibility)

## 7. Why Now

- ShapleyDistributor just hardened — 4 critical fixes including Lawson Floor enforcement, pioneer bonus capping, pairwise verification
- Extraction detection simulation is complete and passing — 9 scenarios + 2 fuzz tests prove the math works
- ContributionDAG is battle-tested: 52 unit tests, fuzz tests, invariant tests, Merkle audit trail
- Augmented Governance paper written — broader implications for DAO coordination
- Three-token economy provides the reward token: VIBE (governance, Shapley-distributed) + JUL (stable liquidity) + stablecoins (bridge asset)
- $0 funding means $0 strings — partnership is purely alignment-based, not financially motivated

---

## Key Links (Have These Ready)

| Resource | Location |
|----------|----------|
| ContributionDAG.sol | `contracts/identity/ContributionDAG.sol` |
| ShapleyDistributor.sol | `contracts/incentives/ShapleyDistributor.sol` |
| ExtractionDetection.t.sol | `test/simulation/ExtractionDetection.t.sol` |
| VIBEToken.sol | `contracts/monetary/VIBEToken.sol` |
| GitHub | https://github.com/WGlynn/VibeSwap |
| Frontend | https://frontend-jade-five-87.vercel.app |
| Deepfunding protocol notes | `jarvis-bot/memory/deepfunding-protocol.md` |

---

## Closing Line

"You built the graph. I built the math. Neither works without the other. Let's finish what we started separately."
