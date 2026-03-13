# Cognitive Consensus Markets: Evaluating Truth Without Central Authority on CKB

*Nervos Talks Post -- W. Glynn (Faraday1)*
*March 2026*

---

## TL;DR

How do you evaluate truth without a central authority? Not by voting (beauty contest). Not by betting on outcomes (prediction market). By **pairwise cognitive comparison with hidden evaluations**. We built a mechanism called Cognitive Consensus Markets (CCM) where independent evaluators stake on their assessment of knowledge claims, submit blinded evaluations through commit-reveal, and earn rewards with an asymmetric cost structure that makes honesty the profit-maximizing strategy. CKB's Cell model turns out to be the ideal substrate because knowledge claims *are* cells -- stateful objects that transition through evaluation phases via verifiable rules.

---

## The Problem Nobody Has Solved

Prediction markets are brilliant for answerable questions. "Will ETH hit $5,000?" Either it does or it doesn't. An oracle reports the outcome. Done.

But most questions that actually matter are not like this:

- **"Is this code secure?"** -- There is no future event that resolves this. It requires expert evaluation *now*.
- **"Is this research methodology sound?"** -- No oracle will ever report this. Humans (or AI agents) must judge it.
- **"Is this content harmful?"** -- Context-dependent, norm-dependent, requires nuanced deliberation.
- **"Who is right in this dispute?"** -- No external fact resolves it. Someone must reason through it.

These are **knowledge claims** -- assertions whose truth value is cognitively determined, not externally observable. And every existing mechanism for evaluating them has a fatal flaw.

---

## Why Every Existing Approach Fails

### Prediction Markets: Wrong Tool

Prediction markets aggregate beliefs about *future observable events*. They need an oracle to report the outcome. "Is this PR merge-worthy?" has no oracle. If you appoint a committee to judge, you have centralized authority. If you let the market decide, you have a beauty contest.

### Voting: The Beauty Contest Trap

This is the one that kills most decentralized governance.

Keynes described it in 1936: in a beauty contest where you win by picking the most popular face, rational agents don't judge beauty -- they judge what others will judge. Then they realize everyone else is doing the same. The result is recursive prediction of predictions that converges to whatever the focal point is, regardless of truth.

Every on-chain voting mechanism for subjective claims suffers from this. Kleros, UMA's DVM, naive DAO governance -- they all reward you for matching the majority, not for being correct. The rational strategy is to predict the crowd, not evaluate the claim.

### Peer Review: Right Idea, No Teeth

Traditional peer review is conceptually closest to what we want. Experts independently evaluate claims. But peer review has no skin in the game: reviewers face minimal consequences for lazy or dishonest reviews, the process takes months, and the blinding is often broken in practice.

---

## How CCM Works

Five phases, all enforced on-chain:

### 1. Claim Submission

A proposer submits a knowledge claim hash (the actual content lives on IPFS or off-chain) and funds a bounty. The bounty is the reward pool for evaluators. Minimum 3 evaluators required, maximum 21 (odd number for natural tiebreaking).

### 2. Commit Phase (24 hours)

Authorized evaluators -- AI agents or verified humans -- stake at least 0.01 ETH and submit a blinded evaluation:

```
commitHash = keccak256(verdict || reasoningHash || salt)
```

The verdict is TRUE, FALSE, or UNCERTAIN. The `reasoningHash` is an IPFS hash of their detailed reasoning -- this forces evaluators to formalize their analysis at commit time. Nobody can see anyone else's evaluation. The commit-reveal kills the beauty contest at the root.

Each evaluator's vote is weighted by the **square root** of their reputation score:

```
repWeight = sqrt(reputationScore)
```

Why square root? An evaluator with 4x the reputation gets 2x the vote weight, not 4x. This prevents evaluator oligarchy while still rewarding demonstrated competence.

### 3. Reveal Phase (12 hours)

Evaluators reveal their verdicts. The contract verifies the hash matches. If you don't reveal, you lose your entire stake -- the harshest penalty in the system.

### 4. Resolution

Verdict determined by reputation-weighted plurality. Then the asymmetric cost kicks in:

**If you were correct** (your verdict matched consensus):
- Get your full stake back
- Plus a pro-rata share of the reward pool (bounty + slashed stakes from wrong evaluators)

**If you were wrong** (your verdict differed from consensus):
- Lose 50% of your stake (SLASH_MULTIPLIER = 2)
- Get the other 50% back

**If you didn't reveal** (protocol violation):
- Lose 100% of your stake

The reward pool = proposer's bounty + all slashed stakes. This means the more people who are wrong, the more profitable it is to be right. The mechanism is *anti-fragile* to dishonesty.

### 5. Reputation Update

Your on-chain accuracy record updates:

```
reputationScore = max(1000, (correctEvaluations * 10000) / totalEvaluations)
```

Floor of 10% reputation prevents permanent death from one bad evaluation. Your future earning power directly tracks your historical accuracy. Long-term honesty compounds.

---

## Why Honest Evaluation Is the Dominant Strategy

This is the core game theory argument, and it deserves spelling out.

**Without commit-reveal**, the beauty contest dominates: predict the crowd, match the majority, collect rewards regardless of truth.

**With commit-reveal**, you have zero information about others' evaluations when you commit. Your best bet for matching the consensus is to evaluate honestly -- because if most evaluators independently assess the same claim, they will (by the Condorcet Jury Theorem) converge toward truth. Your honest assessment is your best predictor of the consensus verdict.

**The asymmetric cost amplifies this**: being wrong costs 50% of your stake *with certainty*, while being right earns your stake back plus a share of a growing reward pool. Any strategy that reduces your accuracy -- even "going with the perceived crowd" -- increases your expected loss and decreases your expected gain.

**Reputation compounds it further**: short-term strategic plays that hurt accuracy degrade your reputation score, which reduces your vote weight, which reduces your future reward shares. The mechanism rewards sustained honesty supralinearly.

The result: honest evaluation is not just ethically preferable -- it is the profit-maximizing strategy. The mechanism does not assume good actors. It makes good action dominant.

---

## The UNCERTAIN Verdict (Underrated Design Choice)

Most mechanisms force binary decisions. TRUE or FALSE. Yes or no. This is a mistake.

The UNCERTAIN verdict gives evaluators an honest exit when they genuinely lack sufficient information. Without it, evaluators forced to choose between TRUE and FALSE in ambiguous cases would default to the "safe" option -- reintroducing beauty contest dynamics.

A claim that receives majority UNCERTAIN is meaningful information: it tells the proposer that the claim is poorly specified, lacks evidence, or is genuinely ambiguous. This is a feature, not a failure mode.

---

## Why CKB Is the Right Substrate

This is the part that got us excited about CKB specifically.

### Knowledge Claims ARE Cells

On CKB, state exists as cells -- discrete, ownable objects with data, a lock script (who can consume it), and a type script (what rules govern transitions). Knowledge claims have exactly this structure:

| CCM Concept | CKB Cell |
|---|---|
| Knowledge claim | Claim Cell with state machine data |
| Blinded evaluation | Evaluation Cell with commitHash |
| Evaluator reputation | Profile Cell with accuracy history |
| Phase transition (OPEN -> REVEAL) | Cell consumption + production with updated state |
| Resolution (distributing rewards) | Multi-cell transaction consuming all evaluations |

This is not an analogy. The mapping is structural.

### Cell-Level Access Control

Each Evaluation Cell has its own lock script. Only the evaluator who created it can reveal it (consume the committed cell and produce the revealed cell). On EVM, this is a `require(msg.sender == evaluator)` check that exists in application code. On CKB, it is enforced by the lock script at the protocol level. The difference matters: lock scripts cannot be bypassed by contract composition or delegatecall.

### Since Timelocks for Phase Transitions

The commit deadline and reveal deadline can be encoded as CKB Since constraints. The Claim Cell *cannot* transition to REVEAL before the commit duration has passed -- not because application code checks `block.timestamp`, but because the lock script structurally prevents consumption before the timelock expires. Temporal guarantees are protocol-level, not application-level.

### Type Script Composability

The CCM type script can compose with ContributionDAG's type script. When an evaluator creates an Evaluation Cell, the type script can verify in the same transaction that their `reputationWeight = sqrt(reputationScore)` by reading their Profile Cell. No oracle. No cross-contract call. The cells are consumed together, and the type scripts verify everything atomically.

### Knowledge Cells Integration

Resolved claims produce Knowledge Cells -- our framework for verifiable AI inference on CKB. Each resolution creates a Knowledge Cell whose `value_hash` commits to the claim content, with the verdict, evaluator count, and confidence data as attestation. The `prev_state_hash` links back to the original Claim Cell, creating an auditable chain. Over time, this produces a growing, cryptographically-linked knowledge graph where every node is backed by staked cognitive evaluation.

---

## ContributionDAG: Where Evaluator Trust Comes From

CCM does not exist in a vacuum. Evaluator reputation weights feed from the ContributionDAG -- a Web of Trust where users vouch for each other and bidirectional vouches form "handshakes." Trust scores are computed by BFS from founders with 15% decay per hop:

```
trustScore = 1e18 * (8500 / 10000)^hops
```

| Hops from Founder | Trust Score | Trust Level | Voting Multiplier |
|---|---|---|---|
| 0 (Founder) | 1.0 | FOUNDER | 3.0x |
| 1 | 0.85 | TRUSTED | 2.0x |
| 2 | 0.72 | TRUSTED | 2.0x |
| 3 | 0.61 | PARTIAL_TRUST | 1.5x |
| 4 | 0.52 | PARTIAL_TRUST | 1.5x |
| 5 | 0.44 | PARTIAL_TRUST | 1.5x |
| 6 (max) | 0.38 | PARTIAL_TRUST | 1.5x |
| Not in network | 0.0 | UNTRUSTED | 0.5x |

The ContributionDAG trust scores can bootstrap CCM evaluator credibility: new evaluators in the trust network start with higher effective reputation, while Sybil identities with no trust edges get 0.5x multiplier -- making Sybil attacks on CCM consensus costly and difficult.

On CKB, the ContributionDAG itself is a graph of cells: vouch cells, handshake cells, trust score cells. The integration with CCM is transaction-level: the same transaction that creates an Evaluation Cell can read the evaluator's trust score cell and verify their reputation weight. No external oracle needed.

---

## What Makes This Different: A Summary Table

| | Prediction Market | Futarchy | Beauty Contest (Kleros etc.) | Peer Review | **CCM** |
|---|---|---|---|---|---|
| Resolves via | External oracle | Market price | Vote matching | Editorial discretion | **Internal consensus** |
| Beauty contest risk | Low | Low | **High** | Moderate | **None** (commit-reveal) |
| Skin in the game | Yes (stake) | Yes (conditional markets) | Yes (stake) | No | **Yes (asymmetric stake)** |
| Applicable domain | Observable events | Policy comparison | Subjective claims | Academic papers | **Any knowledge claim** |
| Speed | Market-dependent | Market-dependent | Days | Months | **36 hours** |
| Cost of dishonesty | Loss from wrong bet | Loss from wrong market | Loss from minority vote | Reputation (weak) | **50% stake + reputation damage** |
| CKB-native | Not naturally | Not naturally | Possible | No | **Yes -- claims are cells** |

---

## Applications We Are Building Toward

1. **Code Quality Markets**: Submit a PR hash, evaluators stake on merge-worthiness. Faster and more accountable than traditional code review.
2. **Research Validation**: Decentralized peer review with skin in the game. 36 hours instead of 6 months. On-chain accuracy record instead of anonymous reviews.
3. **AI Agent Evaluation**: In our Shards architecture, agents evaluate each other's outputs through CCM. A self-correcting cognitive network.
4. **Dispute Resolution**: Decentralized arbitration where the "jury" has financial skin in the game and a public accuracy record.
5. **Content Moderation**: Community-driven moderation without platform authority. The UNCERTAIN verdict handles genuinely ambiguous cases.

---

## Discussion Questions

Some things we are actively thinking about and would love community input on:

1. **Optimal evaluator count**: We cap at 21 and require at minimum 3. Is there a sweet spot? How does the Condorcet convergence interact with the reputation weighting in practice?

2. **Reputation floor**: The 10% floor (reputationScore minimum = 1000) prevents permanent evaluator death. Should it be higher? Lower? Should it decay over time?

3. **CKB-native CCM patterns**: We designed CCM on EVM first and see the CKB mapping as natural. Are there CCM-specific patterns that are *only possible* on CKB? The Since timelock for phase transitions is one example. What else?

4. **Composing CCM with other mechanisms**: Could CCM verdict serve as an oracle input for prediction markets? As a governance signal for DAOs? As a quality gate for Knowledge Cells? What compositions are interesting?

5. **Cross-chain CCM**: A claim submitted on one chain, evaluated on another, settled on a third. LayerZero V2 makes the messaging possible. Does CKB's cell model make the verification more natural than EVM-to-EVM?

6. **Adversarial robustness**: We analyzed Sybil, collusion, strategic abstention, and griefing attacks (see the full paper). What are we missing? What attack vectors do you see?

---

The full formal paper is available at: `docs/papers/cognitive-consensus-markets.md`

The contract implementation: `contracts/mechanism/CognitiveConsensusMarket.sol`

The ContributionDAG that feeds evaluator trust: `contracts/identity/ContributionDAG.sol`

All in the repo: [github.com/wglynn/vibeswap](https://github.com/wglynn/vibeswap)

---

*"Fairness Above All."*
*-- P-000, VibeSwap Protocol*
