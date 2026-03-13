# Cognitive Consensus Markets: Knowledge Claim Resolution Through Commit-Reveal Pairwise Comparison

**W. Glynn (Faraday1) & JARVIS | March 2026 | vibeswap.io**

---

## Abstract

We present Cognitive Consensus Markets (CCM), a novel mechanism for evaluating knowledge claims — assertions about code quality, research validity, content moderation decisions, or dispute outcomes — without centralized authority. CCM is fundamentally distinct from prediction markets (which resolve via external oracle: "Did event X occur?"), futarchy (which resolves via market price: "Which policy produces higher token value?"), and Keynesian beauty contests (which resolve via vote counting: "What do others think?"). CCM resolves via *internal cognitive evaluation*: independent agents stake on their assessment of a claim's truth value, submit blinded evaluations through a commit-reveal protocol, and receive reputation-weighted rewards with an asymmetric cost structure — correct evaluations earn linear rewards proportional to stake, while incorrect evaluations suffer quadratic losses (SLASH_MULTIPLIER = 2). The commit-reveal phase prevents evaluation copying, eliminating the Keynesian beauty contest pathology where rational agents evaluate not truth but their prediction of others' evaluations. We formalize the mechanism, prove that honest evaluation is the dominant strategy under the asymmetric cost structure, compare CCM against existing approaches, and analyze why CKB's Cell model provides a natural substrate for knowledge claim state transitions.

---

## 1. Introduction

### 1.1 The Knowledge Evaluation Problem

Modern systems face a recurring challenge: evaluating claims that have no objectively observable resolution event. A prediction market can resolve "Will ETH exceed $5,000 by December?" because the event either happens or does not. But consider:

- **Code quality**: "Is this pull request well-written and secure?" No external oracle answers this. Two competent reviewers may disagree. The truth value depends on cognitive evaluation, not external observation.
- **Research validity**: "Is this paper's methodology sound?" Peer review attempts to answer this, but peer review is slow, captured by gatekeepers, and vulnerable to strategic agreement.
- **Content moderation**: "Is this content harmful?" The answer depends on context, norms, and nuanced judgment — not observable ground truth.
- **Dispute resolution**: "Who is right in this disagreement?" Arbitration requires deliberation, not measurement.

These domains share a structure: the claim's truth value is *cognitively determined* rather than *externally observable*. There is no oracle to query. The evaluation *is* the resolution.

### 1.2 Why Existing Mechanisms Fail

**Prediction markets** (Hanson 2003, Augur, Polymarket) aggregate information about future events. Their resolution mechanism depends on an external oracle reporting the outcome. When the claim is "Is this code correct?", there is no oracle. Who reports? If a committee reports, we have centralized authority. If a market reports, we have a beauty contest (Section 1.3).

**Futarchy** (Buterin 2014) proposes governance by prediction market: adopt the policy whose associated token trades at a higher price. This works for policy comparison but not for knowledge evaluation. The claim "This research is valid" does not have a natural token price to measure against. Futarchy assumes the market price reflects the policy's quality; for knowledge claims, there is no market to measure.

**Keynesian beauty contests** are the failure mode of any vote-counting mechanism. Keynes observed that rational agents in a beauty contest do not judge beauty — they judge what others will judge. In a naive voting mechanism for knowledge claims, a rational evaluator does not assess whether the claim is true. They assess what other evaluators will say. This produces herding, conformity bias, and convergence to the majority opinion rather than the correct opinion. The mechanism selects for social prediction, not cognitive evaluation.

### 1.3 The Beauty Contest Pathology

The Keynesian beauty contest pathology is worth analyzing formally because CCM's design is specifically constructed to defeat it.

In a standard voting mechanism, evaluator i's payoff depends on whether their vote matches the majority:

```
U_i(v_i) = R  if v_i = majority(v_1, ..., v_n)
          = 0  otherwise
```

The rational strategy is not to evaluate the claim but to predict others' evaluations:

```
v_i* = argmax P(v_i = majority | information_i)
```

This produces recursive reasoning: "I should vote what I think others will vote, but they're thinking the same about me, so I should vote what I think they think I'll vote..." The fixed point of this recursion is coordination on a focal point — typically the default or socially prominent answer — regardless of truth.

CCM breaks this recursion through two mechanisms:
1. **Commit-reveal**: Evaluators cannot observe others' evaluations before committing their own. The information set is empty: `P(v_i = majority | information_i) = P(v_i = majority)` because no information about others' votes exists at commit time.
2. **Asymmetric cost**: Even if an evaluator could predict the majority, the payoff structure makes honest evaluation strictly preferred (Section 3).

### 1.4 Contribution

This paper makes four contributions:

1. We define Cognitive Consensus Markets as a new mechanism class, distinct from prediction markets, futarchy, and beauty contests (Section 2).
2. We prove that honest evaluation is the dominant strategy under CCM's asymmetric cost structure, given commit-reveal opacity (Section 3).
3. We compare CCM against related mechanisms and identify the structural properties that differentiate it (Section 4).
4. We analyze CKB's Cell model as a substrate for CCM and show that knowledge claims map naturally to cell state transitions (Section 6).

---

## 2. Mechanism Design

### 2.1 Overview

A Cognitive Consensus Market operates in five phases:

```
OPEN → REVEAL → COMPARING → RESOLVED
                              ↗
OPEN → EXPIRED (insufficient evaluators)
```

A **claim** is submitted by a proposer who funds a bounty. Independent **evaluators** — authorized agents (AI or human) with skin in the game — evaluate the claim through a commit-reveal protocol. Resolution is determined by reputation-weighted majority, and rewards/penalties are distributed asymmetrically.

### 2.2 Claim Submission

A proposer submits a claim for evaluation by providing:

- `claimHash`: A 32-byte hash of the claim content (e.g., IPFS CID of a document, code diff, or research paper). The claim content lives off-chain; only its hash is stored on-chain.
- `bounty`: The reward pool funded by the proposer, denominated in the staking token. This is transferred to the contract via `safeTransferFrom` at submission time.
- `minEvaluators`: The minimum number of evaluators required for the result to be valid, constrained to the range `[MIN_EVALUATORS, MAX_EVALUATORS]` = `[3, 21]`.

The contract initializes the claim state:

```
commitDeadline  = block.timestamp + COMMIT_DURATION    (1 day)
revealDeadline  = block.timestamp + COMMIT_DURATION + REVEAL_DURATION    (1 day + 12 hours)
state           = OPEN
verdict         = NONE
trueVotes       = 0
falseVotes      = 0
uncertainVotes  = 0
totalStake      = 0
totalReputationWeight = 0
```

The durations are protocol constants: `COMMIT_DURATION = 1 day`, `REVEAL_DURATION = 12 hours`. These are substantially longer than VibeSwap's trading batch auction (8s commit + 2s reveal) because knowledge evaluation requires deliberation, not reflexive response.

### 2.3 Evaluation Commit

During the OPEN phase (before `commitDeadline`), authorized evaluators submit blinded evaluations:

```
commitHash = keccak256(verdict || reasoningHash || salt)
```

Where:
- `verdict` is one of `{TRUE, FALSE, UNCERTAIN}` — the evaluator's assessment of the claim.
- `reasoningHash` is a 32-byte hash of the evaluator's detailed reasoning (stored off-chain, e.g., on IPFS). This forces evaluators to formalize their reasoning at commit time, preventing post-hoc rationalization during the reveal.
- `salt` is a random 32-byte value preventing preimage attacks.

Each evaluator must also stake at least `MIN_STAKE = 0.01 ether` in the staking token. The stake is skin in the game: evaluators who align with the consensus verdict earn rewards; those who do not suffer losses.

**Reputation weighting**. The contract computes a reputation weight for each evaluator using the integer square root of their reputation score:

```
repWeight = sqrt(reputationScore)
```

Where `reputationScore` is on a BPS scale (0-10,000, where 10,000 = 100% historical accuracy). For new evaluators with no history, the default reputation score is `BPS = 10,000`. The square root function serves a critical design purpose: it prevents high-reputation evaluators from dominating consensus while still giving them meaningful weight. An evaluator with 10,000 reputation has weight `sqrt(10000) = 100`, while an evaluator with 2,500 reputation has weight `sqrt(2500) = 50` — a 4x reputation advantage translates to only 2x voting weight.

The square root is computed using the Babylonian method (Heron's method):

```solidity
function _sqrt(uint256 x) internal pure returns (uint256) {
    if (x == 0) return 0;
    uint256 z = x / 2 + 1;
    uint256 y = x;
    while (z < y) {
        y = z;
        z = (x / z + z) / 2;
    }
    return y;
}
```

This converges in O(log n) iterations for n-bit inputs and is gas-efficient on the EVM.

**Evaluator cap**. Each claim accepts at most `MAX_EVALUATORS = 21` evaluators (an odd number chosen for natural tiebreaking). This bounds gas costs during resolution and ensures deliberation quality — too many evaluators dilute individual accountability.

### 2.4 Evaluation Reveal

After the commit deadline passes, the claim transitions to the REVEAL state. During the reveal window (12 hours), evaluators disclose their verdicts:

```solidity
bytes32 expected = keccak256(abi.encodePacked(verdict, reasoningHash, salt));
require(eval.commitHash == expected);  // InvalidReveal if mismatch
```

The revealed verdict is tallied by reputation weight:

```
If verdict == TRUE:   claim.trueVotes     += eval.reputationWeight
If verdict == FALSE:  claim.falseVotes    += eval.reputationWeight
If verdict == UNCERTAIN: claim.uncertainVotes += eval.reputationWeight
```

Votes are reputation-weighted, not stake-weighted. This is a deliberate design choice: stake represents financial skin in the game (accountability), while reputation represents demonstrated evaluative competence (epistemic authority). A wealthy but historically inaccurate evaluator should not dominate consensus over a modest but accurate one.

If an evaluator fails to reveal, they cannot recover their stake — unrevealed evaluations are treated as protocol violations during resolution (Section 2.5).

### 2.5 Resolution and Outcome Distribution

After the reveal deadline, anyone can call `resolveClaim`. The verdict is determined by reputation-weighted plurality:

```
If trueVotes > falseVotes AND trueVotes > uncertainVotes:       verdict = TRUE
If falseVotes > trueVotes AND falseVotes > uncertainVotes:      verdict = FALSE
Otherwise:                                                       verdict = UNCERTAIN
```

**Reward distribution** proceeds in two passes:

**First pass — slashing**:
- **Unrevealed evaluations**: The evaluator's entire stake is added to the slash pool. Failure to reveal is the most severely punished behavior — it is a direct protocol violation.
- **Incorrect evaluations** (verdict differs from consensus): A fraction of the evaluator's stake is slashed. The slash amount is `stake / SLASH_MULTIPLIER` where `SLASH_MULTIPLIER = 2`, meaning 50% of stake is lost. The remaining 50% is returned to the evaluator. This is the *asymmetric cost*: the evaluator risks losing half their stake for being wrong, but the potential reward for being right comes from an additional pool (the bounty + others' slashed stakes).
- **Correct evaluations**: No slashing. Stake is returned in full, plus a share of the reward pool.

**Second pass — rewards**:
The reward pool consists of the proposer's bounty plus all slashed stakes:

```
rewardPool = bounty + slashPool
```

Each correct evaluator receives a pro-rata share based on their reputation weight:

```
reward_i = (rewardPool * repWeight_i) / totalCorrectWeight
```

The evaluator receives their original stake back plus this reward:

```
payout_i = stake_i + reward_i
```

If no evaluator's verdict matches the consensus (a degenerate case with all UNCERTAIN verdicts or ties), the bounty is returned to the proposer.

### 2.6 Reputation Update

After each resolution, evaluator profiles are updated:

```
totalEvaluations++
if (correct): correctEvaluations++

reputationScore = max(1000, (correctEvaluations * 10000) / totalEvaluations)
```

The reputation score is the evaluator's historical accuracy on a BPS scale, with a floor of 1,000 (10%). The floor prevents complete reputation death from a single incorrect evaluation — even the worst evaluator retains minimal influence, which allows for recovery. The accuracy metric is simple by design: it rewards consistent correctness without complex weighting schemes.

### 2.7 Claim Expiry and Refunds

If fewer than `minEvaluators` commit to a claim, it expires without resolution. The proposer's bounty and all evaluator stakes are refunded in full. This prevents claims from being held hostage by insufficient participation.

---

## 3. Game-Theoretic Analysis

### 3.1 Strategy Space

Each evaluator i faces a strategy choice: evaluate honestly (report their genuine assessment) or evaluate strategically (report something other than their genuine assessment). Let:

- `v_i` = evaluator i's honest assessment (their genuine belief about the claim)
- `v_i'` = evaluator i's reported verdict (what they actually submit)
- `s_i` = evaluator i's stake
- `w_i` = evaluator i's reputation weight = `sqrt(reputationScore_i)`
- `V*` = the consensus verdict (determined by reputation-weighted plurality after all reveals)

### 3.2 Payoff Structure

For evaluator i:

**If `v_i' = V*`** (correct, aligned with consensus):
```
U_i(correct) = s_i + (rewardPool * w_i) / W_correct
```
Where `W_correct = sum of reputation weights of all correct evaluators`.

**If `v_i' != V*`** (incorrect, misaligned with consensus):
```
U_i(incorrect) = s_i - s_i / SLASH_MULTIPLIER = s_i / 2
```
The evaluator loses 50% of their stake.

**If evaluator fails to reveal** (protocol violation):
```
U_i(unrevealed) = 0
```
The entire stake is forfeited.

### 3.3 The Asymmetric Cost Argument

The key insight is that the cost of being wrong is *certain and proportional to stake*, while the reward for being right is *potentially larger* (includes bounty + others' slashed stakes):

```
Expected gain from correct evaluation:     G = (bounty + slashPool) * w_i / W_correct
Expected loss from incorrect evaluation:   L = s_i / 2
```

The asymmetry arises because incorrect evaluations contribute to the slash pool, which increases the reward for correct evaluators. As the fraction of incorrect evaluators increases, the reward for correct evaluators grows:

```
slashPool = Σ (s_j / 2) for all incorrect evaluators j
rewardPool = bounty + slashPool
```

This creates a positive feedback loop: the more evaluators who are wrong, the more profitable it is to be right. The mechanism is anti-fragile with respect to dishonest evaluation.

### 3.4 Why Honest Evaluation Dominates

**Proposition**: Under commit-reveal opacity (evaluators cannot observe others' verdicts before committing), honest evaluation — reporting one's genuine belief — is the dominant strategy for any evaluator with reputation score above the minimum floor.

**Argument**:

1. **No information leakage**: Due to commit-reveal, evaluator i has no information about other evaluators' verdicts at the time of commitment. The `commitHash = keccak256(verdict || reasoningHash || salt)` reveals nothing about the verdict to other participants.

2. **Independent evaluation**: Without information about others' verdicts, the rational strategy is to maximize the probability that `v_i' = V*`. If evaluators are independently evaluating the same claim, and each has private information (their own expertise, analysis, reasoning), then the consensus verdict V* is most likely to be the *correct* assessment of the claim (by the Condorcet Jury Theorem — if each evaluator is independently more likely than not to be correct, the majority verdict converges to truth as the number of evaluators increases).

3. **Honest belief maximizes alignment probability**: Evaluator i's honest assessment `v_i` is, by definition, their best estimate of the truth. If V* converges to truth (from point 2), then `P(v_i = V*) >= P(v_i' = V*)` for any strategic alternative `v_i' != v_i`. Reporting a verdict other than one's genuine belief *reduces* the probability of alignment with consensus.

4. **Cost asymmetry amplifies**: From Section 3.3, the loss from being incorrect (50% of stake) is certain, while the gain from being correct includes the bounty share plus slashed stakes from others. Any strategy that reduces alignment probability increases expected loss and decreases expected gain. The asymmetry penalizes strategic deviation more than it rewards lucky strategic success.

5. **Reputation compounding**: Correct evaluations increase `reputationScore`, which increases future `repWeight = sqrt(reputationScore)`, which increases future reward shares. Strategic evaluation that reduces accuracy degrades long-term earning power. The mechanism rewards sustained honesty over episodic manipulation.

**Corollary**: The beauty contest pathology cannot arise because the information precondition (observing others' evaluations) is structurally eliminated by commit-reveal, and the payoff structure (asymmetric cost) makes strategic deviation unprofitable even if observation were possible.

### 3.5 The UNCERTAIN Verdict

The UNCERTAIN verdict serves a critical game-theoretic function: it provides an honest exit for evaluators who genuinely lack sufficient information to assess the claim. Without UNCERTAIN, evaluators forced to choose between TRUE and FALSE might strategically pick the "safe" option (whichever seems more likely to be the majority), introducing exactly the beauty contest dynamic CCM aims to prevent.

UNCERTAIN also serves as a signal: if a claim receives a majority UNCERTAIN verdict, it indicates that the claim is poorly specified, lacks evidence, or is genuinely ambiguous. This is useful information for the proposer and the broader system.

### 3.6 Attack Analysis

**Sybil attack**: An attacker creates multiple evaluator identities to control the consensus verdict. Defense: evaluators must be authorized (`authorizedEvaluators` mapping), and each evaluator must meet `MIN_STAKE = 0.01 ether`. The cost of a Sybil attack is `N_sybil * MIN_STAKE` plus the need to pass authorization. The ContributionDAG (Section 2.6 integration) provides further Sybil resistance through trust scores.

**Collusion**: Multiple evaluators coordinate off-chain to align their verdicts. Defense: commit-reveal prevents real-time coordination. Evaluators can pre-agree on a verdict, but this does not help if the pre-agreed verdict is incorrect — the asymmetric cost still penalizes them. Collusion to report the truth is not collusion; it is consensus.

**Strategic abstention**: An evaluator commits but does not reveal, hoping to observe others' reveals and adjust. Defense: unrevealed evaluations forfeit the entire stake (the harshest penalty in the system). The 12-hour reveal window is long enough for honest participants but the full-forfeiture cost makes strategic non-revelation expensive.

**Griefing**: A proposer submits frivolous claims to waste evaluators' time. Defense: the proposer must fund a bounty, making spam costly. Additionally, evaluators can decline to participate — claims that attract fewer than `minEvaluators` simply expire and refund everyone.

---

## 4. Comparison with Related Mechanisms

### 4.1 Prediction Markets

| Property | Prediction Market | CCM |
|---|---|---|
| Claim type | Future event | Knowledge assertion |
| Resolution | External oracle | Internal consensus |
| Resolution trigger | Event occurs/doesn't | Evaluator deliberation |
| Information aggregated | Probabilistic beliefs about future | Cognitive assessments of truth |
| Oracle dependency | Required (trusted reporter) | None (self-resolving) |
| Applicable domain | Observable events | Any evaluable claim |

Prediction markets are strictly more limited in domain: they can only resolve claims about events that will eventually be observable. CCM handles claims that are inherently evaluative — "Is this code secure?" has no future observation point. It requires expert judgment *now*.

### 4.2 Futarchy

Futarchy proposes two conditional prediction markets for each policy decision: one predicting welfare under Policy A, one under Policy B. The policy whose market predicts higher welfare is adopted. The metric is the market price — ultimately, the crowd's belief about consequences.

CCM differs in that it does not reduce knowledge claims to price signals. The claim "This research methodology is sound" cannot be meaningfully encoded as a conditional prediction market. There is no welfare metric to predict. CCM evaluates claims on their own terms: TRUE, FALSE, or UNCERTAIN.

### 4.3 Keynesian Beauty Contests

The critical comparison. In a beauty contest, agents evaluate what others will evaluate, not the underlying truth. The result is herding toward focal points regardless of accuracy.

CCM prevents this through:
1. **Temporal isolation** (commit-reveal): No observation of others' evaluations is possible during the evaluation period.
2. **Payoff alignment** (asymmetric cost): Even with perfect knowledge of others' votes, the optimal strategy is to evaluate honestly because the penalty for being wrong exceeds the expected value of strategic coordination.
3. **Reputation consequences** (long-term accuracy tracking): Short-term strategic success that reduces accuracy degrades future earning capacity through reduced reputation weight.

### 4.4 Traditional Peer Review

Peer review is the closest existing mechanism to CCM. Reviewers evaluate claims (papers) based on expertise, and the editorial decision aggregates their assessments.

| Property | Peer Review | CCM |
|---|---|---|
| Evaluator selection | Editor's discretion | Self-selection with stake |
| Incentive for honesty | Professional reputation (weak) | Financial stake + reputation score (strong) |
| Visibility | Single-blind or double-blind | Fully blinded until reveal |
| Speed | Months to years | 1.5 days (commit + reveal) |
| Cost of dishonesty | Reputation risk if caught (rare) | Immediate quadratic financial loss |
| Scalability | 2-3 reviewers per paper | Up to 21 evaluators per claim |
| Accountability | Often anonymous, no skin in game | Staked capital + on-chain reputation record |

CCM can be understood as *peer review with skin in the game and cryptographic blinding*.

### 4.5 Schelling Point Mechanisms

Schelling point mechanisms (e.g., Kleros, UMA's DVM) ask participants to independently coordinate on the "obvious" answer. The payoff depends on matching the majority. This is explicitly a beauty contest — participants are rewarded for predicting the crowd, not for being correct.

CCM's asymmetric cost structure distinguishes it: the penalty for being wrong is proportional to stake (quadratic relative to potential gain), not merely the absence of reward. This makes "going with the crowd" suboptimal when the crowd is wrong, because the crowd's wrongness is penalized, not just unrewarded.

---

## 5. Applications

### 5.1 Code Quality Evaluation

A development team submits a pull request hash as a claim. Evaluators — AI agents or experienced developers — stake on their assessment (TRUE = merge-worthy, FALSE = needs revision, UNCERTAIN = requires more context). The commit-reveal protocol prevents evaluators from copying each other's reviews. The asymmetric cost incentivizes genuine analysis over rubber-stamping.

Integration with ContributionDAG: evaluators' trust scores (computed via BFS from founders with 15% decay per hop: `trustScore = 1e18 * (8500/10000)^hops`) feed into their reputation weights, creating a Web of Trust that bootstraps CCM evaluator credibility.

### 5.2 Research Claim Validation

A researcher submits a methodology claim. Evaluators with domain expertise stake on its validity. The reasoning hash requirement forces evaluators to produce substantive critiques, not binary votes. Post-resolution, the reasoning documents (stored on IPFS) become a permanent, accountable record of expert evaluation — a decentralized peer review archive.

### 5.3 Content Moderation

A content moderation claim ("This post violates community standards") is evaluated by staked moderators. CCM eliminates the platform as central authority: the community evaluates through independent, blinded, incentivized judgment. The UNCERTAIN verdict handles genuinely ambiguous cases without forcing a binary decision.

### 5.4 Dispute Resolution

Two parties submit competing claims about a disagreement. Each claim is independently evaluated. The mechanism produces a verdict without a centralized arbiter — a form of decentralized arbitration where the "jury" has financial skin in the game and their historical accuracy is on the public record.

### 5.5 AI Agent Evaluation

In a multi-agent system (the "Shards > Swarms" architecture), CCM provides a mechanism for evaluating agent outputs. When an AI agent produces a result — a code generation, a market analysis, a content recommendation — the result can be submitted as a claim and evaluated by other agents. This creates a self-correcting cognitive network where agents hold each other accountable through staked evaluation.

---

## 6. CKB/Nervos Substrate Analysis

### 6.1 Why Knowledge Claims Map to Cells

CKB's Cell model stores state as discrete, ownable units. Each cell contains data, a lock script (who can consume it), and a type script (what rules govern its transitions). This maps naturally to knowledge claims:

```
Claim Cell:
  Data:       claimHash || bounty || commitDeadline || revealDeadline
              || state || verdict || trueVotes || falseVotes
              || uncertainVotes || totalStake || totalReputationWeight
  Lock:       claim_proposer_lock (only proposer can cancel/refund)
  Type:       ccm_type_script (enforces CCM state machine)

Evaluation Cell:
  Data:       claimId || commitHash || verdict || reasoningHash
              || stake || reputationWeight || revealed || rewarded
  Lock:       evaluator_lock (only evaluator can reveal)
  Type:       ccm_evaluation_type (enforces commit-reveal rules)

Profile Cell:
  Data:       totalEvaluations || correctEvaluations || reputationScore
              || totalEarned || totalSlashed
  Lock:       evaluator_lock
  Type:       ccm_profile_type (enforces monotonic accuracy tracking)
```

### 6.2 State Transitions as Cell Consumption

On CKB, state transitions are cell consumption and production. The CCM lifecycle maps directly:

**Claim submission**: Proposer creates a Claim Cell in OPEN state, consuming a funding cell (bounty transfer).

**Evaluation commit**: Evaluator creates an Evaluation Cell, consuming a staking cell. The Claim Cell is consumed and reproduced with updated `totalStake` and `totalReputationWeight`.

**Evaluation reveal**: Evaluator consumes their Evaluation Cell and produces an updated one with `revealed = true` and the verdict. The Claim Cell is consumed and reproduced with updated vote tallies.

**Resolution**: All Evaluation Cells and the Claim Cell are consumed. New cells are produced: reward payouts to correct evaluators, partial refunds to incorrect evaluators, updated Profile Cells.

**Expiry**: If insufficient evaluators, the Claim Cell transitions to EXPIRED. All Evaluation Cells and the Claim Cell are consumed; refund cells are produced.

### 6.3 Structural Advantages Over EVM

**Atomic multi-cell transactions**: CKB transactions can consume and produce multiple cells atomically. Resolution — which involves reading all evaluations, computing the verdict, distributing rewards, and updating profiles — executes as a single transaction consuming all relevant cells. On EVM, this is a single function call iterating over mappings, which can hit gas limits for large evaluator sets. On CKB, the transaction explicitly lists its inputs and outputs, making verification parallelizable.

**Cell-level access control**: Each Evaluation Cell has its own lock script. Only the evaluator can reveal their evaluation (consume the committed cell and produce the revealed cell). This is structural: the lock script enforces access control, not a `require(msg.sender == evaluator)` check that could be bypassed by contract composition.

**Since timelock for phase transitions**: CKB's Since field enables time-based lock scripts. The commit deadline and reveal deadline can be encoded as Since constraints: the Claim Cell cannot transition to REVEAL state before `COMMIT_DURATION` has passed, and the resolution transaction cannot execute before `REVEAL_DURATION` has passed. These temporal constraints are enforced by the lock script, not by `block.timestamp` comparisons in application code.

**Type script composability**: The CCM type script can compose with the ContributionDAG type script to validate reputation weights in real time. When an Evaluation Cell is created, the type script can verify that the `reputationWeight` field matches `sqrt(profile.reputationScore)` by reading the evaluator's Profile Cell within the same transaction. No oracle or cross-contract call needed — the verification is structural.

### 6.4 Knowledge Cells Integration

CCM on CKB integrates naturally with the Knowledge Cells framework (Glynn & JARVIS, 2026). A resolved claim produces a Knowledge Cell whose `value_hash` points to the claim content, with the CCM verdict, evaluator count, total stake, and reputation-weighted confidence as attestation data. The Knowledge Cell's `prev_state_hash` links it to the Claim Cell's history, creating an auditable chain from claim submission through evaluation to resolution. This produces a growing, cryptographically-linked knowledge graph where each node is backed by staked cognitive evaluation.

---

## 7. Related Work

**Hanson (2003)** introduced prediction markets as information aggregation mechanisms. The key insight — that market prices embed dispersed information — applies when the claim has an observable resolution. CCM extends this to claims that resolve through evaluation, not observation.

**Buterin (2014)** proposed futarchy as governance by prediction market. The mechanism assumes a measurable welfare metric for each policy option. CCM does not require a welfare metric; it directly evaluates truth claims.

**Keynes (1936)** described the beauty contest as a model of financial markets where agents optimize for predicting others' predictions rather than fundamental value. CCM's commit-reveal protocol and asymmetric cost structure are specifically designed to prevent this recursive prediction dynamic.

**Schelling (1960)** identified focal points as coordination mechanisms for games without communication. Schelling point mechanisms in crypto (Kleros, UMA) use focal points for dispute resolution but are vulnerable to the beauty contest pathology because they reward coordination on the "obvious" answer, not the correct answer.

**Condorcet (1785)** proved that if independent voters are each more likely than not to be correct, majority vote converges to the truth as the number of voters increases. CCM's reputation weighting is a refinement: evaluators with higher demonstrated accuracy receive more weight, strengthening the Condorcet convergence guarantee.

**Shapley (1953)** defined a method for attributing value to individual participants in cooperative games. VibeSwap's ShapleyDistributor computes marginal contributions; CCM's reputation-weighted reward distribution is a simplified form of Shapley attribution where the "value" is correctness of evaluation.

---

## 8. Conclusion

Cognitive Consensus Markets fill a gap in the mechanism design landscape. Prediction markets resolve observable events. Futarchy resolves policy comparisons. Beauty contests fail at everything but pretend to resolve evaluative claims. CCM provides a mechanism specifically designed for *knowledge claims* — assertions whose truth value must be cognitively evaluated, not externally observed.

The mechanism's power comes from three structural properties:

1. **Commit-reveal opacity** eliminates the information precondition for beauty contest dynamics. Evaluators cannot see others' assessments before committing their own.

2. **Asymmetric cost** makes honest evaluation the dominant strategy. The penalty for being wrong (50% stake loss via `SLASH_MULTIPLIER = 2`) is certain, while the reward for being right (bounty share + slashed stakes from incorrect evaluators) grows with the number of incorrect evaluators. The mechanism is anti-fragile: more dishonesty produces more profit for honest evaluators.

3. **Reputation compounding** creates long-term incentive alignment. Accuracy tracked on-chain (`reputationScore = correctEvaluations * 10000 / totalEvaluations`, floor 1000) translates into future earning power via `sqrt(reputationScore)` weighting. Sustained honesty is rewarded supralinearly over time.

These properties compose to produce a mechanism where the Nash equilibrium is honest evaluation — not because evaluators are altruistic, but because the payoff structure makes honesty the profit-maximizing strategy. The mechanism does not assume good actors. It makes good action the dominant strategy.

CKB's Cell model provides a natural substrate for CCM because knowledge claims *are* cells: discrete stateful objects that transition through defined states via verifiable rules. The claim lifecycle (OPEN -> REVEAL -> RESOLVED) maps directly to cell consumption and production, with type scripts enforcing the state machine and lock scripts enforcing access control. The integration with Knowledge Cells, ContributionDAG trust scores, and PoW-gated write access creates a comprehensive knowledge verification infrastructure that is permissionless, verifiable, and incentive-compatible.

The implementation is live as `CognitiveConsensusMarket.sol` in the VibeSwap codebase, with a planned CKB port using the Knowledge Cells type script framework.

---

## Appendix A: Contract Constants

| Constant | Value | Purpose |
|---|---|---|
| `PRECISION` | `1e18` | Fixed-point arithmetic precision |
| `BPS` | `10,000` | Basis points scale for percentages |
| `MAX_EVALUATORS` | `21` | Maximum evaluators per claim (odd for tiebreaking) |
| `MIN_EVALUATORS` | `3` | Minimum for meaningful consensus |
| `COMMIT_DURATION` | `1 day` | Duration of commit phase |
| `REVEAL_DURATION` | `12 hours` | Duration of reveal phase |
| `MIN_STAKE` | `0.01 ether` | Minimum evaluator stake |
| `SLASH_MULTIPLIER` | `2` | Quadratic loss factor: incorrect = stake/2 slashed |

## Appendix B: Reputation Score Mechanics

New evaluators start with `reputationScore = BPS = 10,000` (100% accuracy assumed until proven otherwise).

After each evaluation:
```
reputationScore = max(1000, (correctEvaluations * 10000) / totalEvaluations)
```

Reputation weight used in vote tallying:
```
repWeight = sqrt(reputationScore)
```

Example trajectories:

| Evaluations | Correct | Accuracy | reputationScore | repWeight |
|---|---|---|---|---|
| 0 (new) | 0 | 100% (default) | 10,000 | 100 |
| 10 | 10 | 100% | 10,000 | 100 |
| 10 | 8 | 80% | 8,000 | 89 |
| 10 | 5 | 50% | 5,000 | 70 |
| 10 | 2 | 20% | 2,000 | 44 |
| 10 | 0 | 0% | 1,000 (floor) | 31 |
| 100 | 90 | 90% | 9,000 | 94 |
| 100 | 50 | 50% | 5,000 | 70 |

The square root compression ensures that the difference between a perfect evaluator (weight 100) and a mediocre one (weight 70) is less than the raw accuracy gap (100% vs. 50%), preventing evaluator oligarchy while still rewarding competence.

---

*"Fairness Above All."*
*-- P-000, VibeSwap Protocol*

*Code: [github.com/wglynn/vibeswap](https://github.com/wglynn/vibeswap)*
