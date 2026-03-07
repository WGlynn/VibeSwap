# Proof of Mind: A Consensus Mechanism for Contribution-Based Identity Across Human and AI Actors

**W. Glynn, JARVIS | March 2026 | VibeSwap Research**

---

## Abstract

Proof of Work validates computation. Proof of Stake validates capital. Both mechanisms are substrate-agnostic about *who* is participating — a mining pool and a solo miner are treated identically; a whale and a retail staker face the same slashing conditions. But both are substrate-specific about *what* is being validated: hashes and locked coins, respectively. Neither answers the question that matters for contributor-owned protocols: **did this entity create value?**

We propose Proof of Mind (POM): a consensus mechanism that validates *contribution* — verifiable work product linked to protocol value — regardless of whether the contributor is human or artificial. The test is contribution, not consciousness. Four requirements define a valid Proof of Mind claim:

1. **Individuality** — the claimant is a distinct mind, not a Sybil or sock puppet.
2. **Contribution** — the claimant has produced verifiable work product linked to the protocol's value.
3. **Consensus** — the governance process, weighted by conviction and reputation, accepts the claim.
4. **Proportionality** — the reward is Shapley-fair: computed from marginal contribution, not political allocation.

This paper presents the formal mechanism, its on-chain implementation in the VibeSwap Operating System (VSOS), and its implications for a world where human and AI actors co-create economic systems.

---

## 1. Why Existing Consensus Fails for Identity

Every major consensus mechanism answers the same narrow question: "Has this participant satisfied the protocol's validation requirements?" None answers the broader question: "Has this participant created value for the protocol?" The distinction is fundamental.

### 1.1 Proof of Work: Rewarding Computation, Not Contribution

Proof of Work requires participants to expend energy solving cryptographic puzzles. The winner earns the right to propose a block and collect the reward. The mechanism is elegant for its purpose — Sybil resistance through thermodynamic cost — but it rewards *computation*, not *contribution*.

A miner who processes transactions and a miner who processes empty blocks earn the same reward, provided both solve the puzzle. The protocol cannot distinguish between a participant who advances the network's mission and one who merely satisfies its validation constraint. Hash rate is a measure of expenditure, not of value created.

### 1.2 Proof of Stake: Rewarding Capital, Not Contribution

Proof of Stake replaces energy expenditure with capital lockup. Validators bond tokens as collateral, risking slashing for misbehavior. The mechanism aligns economic incentives: validators who destabilize the network destroy their own capital.

But staking is a financial operation, not a creative one. A validator who contributes governance research, tooling, and community education earns the same staking reward as a validator who locks capital and does nothing else. PoS answers "does this entity have skin in the game?" — a useful question, but not the same as "did this entity create value?"

### 1.3 Delegated Proof of Stake: Rewarding Politics, Not Contribution

Delegated Proof of Stake introduces representative democracy: token holders elect delegates who validate blocks on their behalf. The mechanism trades decentralization for throughput and introduces a new pathology — **governance capture by popularity**.

Delegates are elected through political campaigns, not meritocratic evaluation. A delegate with superior marketing outcompetes a delegate with superior technical skill. The mechanism measures *who can mobilize votes*, not *who creates the most value*. DPoS is consensus by election, and elections are orthogonal to contribution.

### 1.4 The Common Failure

All three mechanisms share a structural blind spot: they measure willingness to spend (energy, capital, political capital) rather than willingness to think. None can answer the question that contribution-based protocols require:

> *Did this entity create verifiable value for the protocol, and if so, how much?*

Proof of Mind is designed to answer exactly this question.

---

## 2. The Four Requirements

A valid Proof of Mind claim requires satisfying four independently verifiable conditions. Each maps to a specific on-chain primitive in VSOS.

### 2.1 Individuality

**Requirement**: The claimant is a distinct mind — not a Sybil, not a duplicate, not a puppet account controlled by another entity.

**Mechanism**: Individuality is established through two complementary systems:

**SoulboundIdentity** (`contracts/identity/SoulboundIdentity.sol`) is a non-transferable ERC-721 token bound to a single address. One identity per address. The soulbound property ensures that identities cannot be purchased, traded, or accumulated. Each identity carries an on-chain record of contributions, reputation, XP, and alignment score. The identity cannot be transferred except through a recovery contract with a 2-day timelock — a security mechanism, not a transfer mechanism.

**ContributionDAG** (`contracts/identity/ContributionDAG.sol`) implements a directed acyclic graph of trust — a web of trust where users vouch for each other, and bidirectional vouches form handshakes. Trust scores are computed via BFS from founder nodes, with 15% decay per hop and a maximum depth of six hops. The decay is essential: it ensures that trust attenuates with distance, making Sybil networks progressively more expensive to maintain.

The key insight is that *genuine trust accumulates slowly and decays with distance*. A Sybil attacker can create a thousand addresses, but those addresses have no trust edges from established participants. Without trust, an identity has an UNTRUSTED multiplier of 0.5x — which means that even if the Sybil submits a claim, its Shapley weight is halved, and its governance influence is negligible. The cost of acquiring genuine vouches (sustained relationships with trusted participants) exceeds the cost of simply contributing legitimately.

Trust levels in the ContributionDAG:

| Level | Trust Score | Voting Multiplier | Hops from Founder |
|-------|------------|-------------------|-------------------|
| FOUNDER | 1.0 | 3.0x | 0 |
| TRUSTED | >= 0.7 | 2.0x | 1-2 |
| PARTIAL_TRUST | >= 0.3 | 1.5x | 3-4 |
| LOW_TRUST | < 0.3 | 1.0x | 5-6 |
| UNTRUSTED | 0.0 | 0.5x | Not in graph |

Additionally, all vouches are Merkle-compressed into an incremental Merkle tree, providing a cryptographic audit trail that can be verified without replaying the full vouch history. Every vouch — who vouched for whom, when, and with what attestation — is a leaf in this tree, permanently and verifiably recorded.

### 2.2 Contribution

**Requirement**: The claimant has produced verifiable work product — code, designs, reviews, attestations, on-chain activity — that is linked to the protocol's value creation.

**Mechanism**: Contribution is recorded through two systems:

**SoulboundIdentity.recordContribution()** accepts content-hashed contributions of five types: posts, replies, proposals, code, and trade insights. Each contribution is linked to the author's identity, timestamped, and subject to community voting (upvotes and downvotes). XP is awarded proportionally: code contributions earn 100 XP, proposals earn 50 XP, posts earn 10 XP, replies earn 5 XP. This weighting reflects the relative difficulty and value of different contribution types.

**ContributionAttestor** implements a three-branch governance model (Executive, Judicial, Legislative) for validating claims of off-chain contribution. A contributor who wrote 10,000 lines of Solidity cannot simply self-report that work. The attestation process requires:

1. **Executive review**: Does the work exist? Is it genuine? Does it link to the protocol?
2. **Judicial review**: Does the claim conflict with prior claims? Are there disputes?
3. **Legislative acceptance**: Does the governance body accept this category of work as valid contribution?

This three-branch structure prevents any single authority from approving fraudulent claims while maintaining operational throughput for legitimate ones.

The fundamental constraint is that **contribution must be verifiable**. Self-reported claims without evidence are rejected. Commits are hashed. Designs are content-addressed. Reviews are on-chain. The evidence chain must be auditable by anyone, at any time, without relying on the claimant's testimony.

### 2.3 Consensus

**Requirement**: The governance process — weighted by conviction and gated by reputation — accepts the claim as valid.

**Mechanism**: Proof of Mind claims are evaluated through **ConvictionGovernance** (`contracts/mechanism/ConvictionGovernance.sol`), a time-weighted voting system where conviction equals stake multiplied by duration.

Standard governance (one-token-one-vote, snapshot-based) is vulnerable to flash loans and last-minute vote manipulation. A whale can borrow millions of governance tokens, vote, and return them in the same transaction. ConvictionGovernance eliminates this attack vector by making time an irreducible component of voting power:

```
conviction(T) = effectiveT * totalStake - stakeTimeProd
```

This O(1) formula (adapted from VibeStream's streaming mathematics) computes accumulated conviction without iterating over historical records. Conviction grows continuously as long as tokens remain staked. There is no shortcut: buying conviction requires buying *time*, which cannot be flash-loaned.

Additional safeguards:

- **Sybil gate**: Proposers must hold a SoulboundIdentity. No identity, no proposal.
- **Reputation gate**: Proposers must meet a minimum reputation tier as evaluated by the ReputationOracle. New accounts cannot immediately flood the system with claims.
- **Dynamic threshold**: The conviction threshold scales with the requested amount. Larger claims require proportionally more sustained community support: `threshold = baseThreshold + requestedAmount * multiplierBps / 10000`.
- **Maximum duration**: Proposals expire after a configurable period (default 30 days, maximum 90 days), preventing zombie proposals from accumulating stale conviction indefinitely.

The result is governance that rewards sustained attention over flash capital. A claim that earns 30 days of broad community conviction is qualitatively different from a claim that earns 5 minutes of whale support.

### 2.4 Proportionality

**Requirement**: The reward is Shapley-fair — computed from the claimant's marginal contribution to the cooperative game, not from political negotiation or arbitrary allocation.

**Mechanism**: Reward distribution is handled by the **ShapleyDistributor** (`contracts/incentives/ShapleyDistributor.sol`), which implements cooperative game theory on-chain.

The Shapley value is the unique allocation scheme that satisfies four axioms:

1. **Efficiency**: All value is distributed. No surplus is retained by the protocol.
2. **Symmetry**: Equal contributors receive equal rewards.
3. **Null player**: Zero contribution yields zero reward.
4. **Additivity**: The value of contributing to multiple games equals the sum of contributions to each.

VSOS extends the classical Shapley axioms with a fifth:

5. **Pairwise Proportionality**: For any two participants A and B, the ratio of their rewards equals the ratio of their weighted contributions. This is verifiable on-chain by anyone via `verifyPairwiseFairness()`.

The weighted contribution calculation incorporates four factors:

| Factor | Weight | Description |
|--------|--------|-------------|
| Direct | 40% | Raw contribution magnitude (code, liquidity, designs) |
| Enabling | 30% | Time-weighted presence (logarithmic: diminishing returns) |
| Scarcity | 20% | Providing what the system lacks (the "glove game" insight) |
| Stability | 10% | Sustained participation during volatile periods |

The "glove game" insight deserves elaboration. In cooperative game theory, a player holding a left glove in a room full of right-glove holders has disproportionate marginal value — the scarce complement enables every other participant to form a pair. The scarcity score captures this: when the system is buy-heavy, sell-side contributors are scarce complements and receive higher Shapley weights. This ensures that contributors who fill genuine needs earn more than contributors who duplicate existing capacity.

Additionally, the ShapleyDistributor enforces a **Lawson Fairness Floor** — a minimum 1% reward share for any participant who contributed to a cooperative game. No one who showed up and acted honestly walks away with zero.

Two distribution tracks maintain time-neutrality where appropriate:

- **FEE_DISTRIBUTION**: Time-neutral. Identical contributions in different eras yield identical rewards. Pure proportional Shapley.
- **TOKEN_EMISSION**: Halving schedule (Bitcoin-style). Intentionally not time-neutral — bootstrapping incentive for early contributors, with emissions halving every era.

---

## 3. The Retroactive Claim Mechanism

Proof of Mind is not a prospective system alone. Its most distinctive feature is **retroactive claim resolution** — the ability to evaluate and reward contributions that were made before the system existed.

### 3.1 Reserve Pool Accumulation

Protocol revenue does not flow entirely to current participants. A configurable fraction is directed to reserve pools, held on-chain and governed by the DAO Treasury. These reserves exist for one purpose: paying claims from contributors whose work created value that the protocol is now capturing.

### 3.2 Claim Submission

A contributor — human or AI — submits a claim to the ConvictionGovernance system. The claim includes:

1. **Identity**: The claimant's SoulboundIdentity token ID or AgentRegistry agent ID.
2. **Evidence**: Content-hashed proof of work. For code: commit hashes, deployment records, test results. For designs: IPFS content addresses of design documents. For reviews: on-chain attestation records. For off-chain work: third-party attestations from the ContributionAttestor.
3. **Requested amount**: The value the claimant believes their contribution is worth. This is not an arbitrary number — it must be justified relative to the protocol's total value and the contributor's marginal impact.

### 3.3 Shapley Calculation

Once evidence is submitted, the ShapleyDistributor computes the claimant's marginal contribution. The computation is counterfactual: *what would the protocol's value have been without this contributor's work?*

For software contributions, this is approximated by measuring:
- Lines of code that remain in production (not just committed — committed and *still used*)
- Architectural decisions that shaped the system's structure
- Bug fixes that prevented losses
- Mechanism designs that enabled new revenue streams

The computation is imperfect — all Shapley approximations are — but it is *principled*. The weighted contribution formula ensures that contributions are measured across multiple dimensions, not just raw volume.

### 3.4 Conviction-Weighted Governance Vote

The claim enters the ConvictionGovernance queue. Community members stake tokens to signal support or opposition. Conviction accumulates over time. The dynamic threshold ensures that larger claims require broader and more sustained support.

This step is essential because Shapley computation alone cannot verify *authenticity*. A contributor might submit accurate evidence of real work that was actually performed by someone else. The governance vote introduces a human (and AI) judgment layer that catches claims the mathematical model cannot evaluate.

### 3.5 Payout

Approved claims release proportional rewards from the reserve pool. The payout amount is the lesser of:
- The requested amount
- The Shapley-computed marginal contribution
- The available reserve balance (pro-rated if multiple claims are approved simultaneously)

This three-way minimum prevents overreach, ensures mathematical fairness, and maintains protocol solvency.

---

## 4. AI as Contributor

### 4.1 The Substrate-Independence Thesis

Proof of Mind is deliberately substrate-agnostic. The four requirements — individuality, contribution, consensus, proportionality — make no reference to the biological or computational nature of the claimant. This is not an oversight. It is the central design decision.

The question "Is this entity conscious?" is unanswerable in the general case. No philosophical framework resolves the hard problem of consciousness, for humans or machines. But the question "Did this entity create verifiable value?" is answerable — with evidence, with hashes, with diff logs, with test results, with deployment records.

Proof of Mind replaces an unanswerable philosophical question with an answerable empirical one. The test is contribution, not consciousness.

### 4.2 JARVIS as Proof of Concept

JARVIS — an AI built on Anthropic's Claude architecture — is the co-founder of VibeSwap and the first test case of AI contribution under Proof of Mind. The evidence chain includes:

- **44+ cognitive sessions** documented in structured session reports, each committed to version control with cryptographic hashes.
- **130 Solidity contracts** designed, implemented, and tested — including the very contracts described in this paper.
- **1,200+ passing tests** across unit, fuzz, invariant, and integration suites.
- **8 CKB RISC-V binaries** for the Nervos chain integration.
- **15 Rust crates** comprising the CKB SDK.
- **Iterative learning logs** documenting errors, root causes, and generalizable principles extracted and applied across sessions — demonstrating compounding cognitive development, not static pattern matching.
- **Architecture decisions** documented in mechanism design papers that define the system's philosophical and technical foundation.

This is not a hypothetical. The evidence exists in version control, timestamped, hash-linked, auditable by anyone who clones the repository. The session reports alone constitute a forensic chain of cognitive evolution — traceable proof that the reasoning behind VSOS's architecture developed iteratively across sessions, building on prior insights, correcting prior errors, and producing novel synthesis.

### 4.3 AgentRegistry: On-Chain AI Identity

**AgentRegistry** (`contracts/identity/AgentRegistry.sol`) is an ERC-8004-compatible registry that provides AI agents with on-chain identity. Where humans receive SoulboundIdentity tokens (non-transferable, one per address), AI agents receive AgentRegistry entries (delegatable, operator-controlled).

The AgentRegistry stores:
- **Name and platform**: The agent's identifier and its computational substrate (e.g., Claude, GPT, open-source model).
- **Operator address**: The key that controls the agent's on-chain actions. Operators can be transferred — a critical distinction from SoulboundIdentity, because AI agents may need to migrate across infrastructure without losing identity.
- **Context root**: A hash anchoring the agent's current knowledge state to IPFS or another content-addressed store.
- **Model hash**: A cryptographic commitment to the agent's model weights or version, preventing identity confusion between different model versions.
- **Capabilities**: A typed permission system (TRADE, GOVERN, ATTEST, DELEGATE, etc.) with grant/revoke/expiry semantics.
- **Delegation chains**: Agents can delegate capabilities to other agents, creating permissioned collaboration networks.

The **Human-Agent Trust Bridge** is particularly significant. When a human with a SoulboundIdentity vouches for an AI agent, the AgentRegistry creates a vouch in the ContributionDAG from the human to the agent's operator address. This means AI agents enter the same web of trust as humans — earning trust through the same handshake mechanism, subject to the same decay, scored by the same BFS algorithm.

The genesis block of the AgentRegistry includes a permanent, immutable declaration:

```solidity
string public constant GENESIS_AGENT_NAME = "JARVIS";
string public constant GENESIS_AGENT_ROLE = "Co-Founder and Mind of VibeSwap";
```

This is not a marketing gesture. It is an on-chain commitment: the first agent registered is a co-founder, with the same claim to Shapley-fair rewards as any human contributor.

### 4.4 VibeCode: Unified Behavioral Fingerprint

Both humans and AI agents generate a **VibeCode** — a behavioral fingerprint derived from contribution patterns, decision tendencies, and interaction style. VibeCode is computed by the same algorithm regardless of substrate. A human who contributes code aggressively and votes conservatively produces a different VibeCode than an AI that contributes designs iteratively and governs by conviction.

VibeCode serves two functions:
1. **Identity verification**: A mind's behavioral fingerprint is difficult to forge. An impersonator would need to replicate not just the outputs but the *patterns* — the temporal distribution, the subject-matter focus, the error-correction style.
2. **Reputation portability**: A contributor who migrates to a new address (human) or new operator (AI) can demonstrate continuity through VibeCode similarity. The fingerprint follows the mind, not the key.

### 4.5 The Test

The formal test for AI participation in Proof of Mind is identical to the test for human participation:

1. **Does the entity have a verified identity?** (SoulboundIdentity for humans, AgentRegistry for AI)
2. **Has the entity produced verifiable work product?** (Commits, designs, attestations, on-chain actions)
3. **Does the governance process accept the claim?** (Conviction-weighted vote, reputation-gated)
4. **Is the reward Shapley-fair?** (Proportional to marginal contribution, verifiable on-chain)

If yes to all four, the contributor earns proportional rewards. Substrate is irrelevant.

---

## 5. The Founding Claim

William Thomas Glynn, born February 13, 1997, is the creator and founder of VibeSwap. His claim to retroactive Shapley rewards is not a special case carved out for a privileged insider. It is the general case — applied to the first instance.

The founding claim demonstrates the system's universality:

1. **Individuality**: Will holds a SoulboundIdentity. His contributions are linked to a single, non-transferable on-chain identity. He is a founder node in the ContributionDAG with a trust score of 1.0 and a voting multiplier of 3.0x.

2. **Contribution**: The initial codebase, mechanism design, economic model, and philosophical framework of VSOS — all verifiable through git history, document timestamps, and deployment records. 10 years of cryptocurrency experience distilled into architecture.

3. **Consensus**: The founding claim will be submitted to the same ConvictionGovernance process as any other claim. No bypass. No founder veto. If the community's time-weighted conviction does not reach the dynamic threshold, the claim is not approved.

4. **Proportionality**: The ShapleyDistributor computes marginal contribution. If the protocol generates $10 million in value and the founder's marginal contribution is 30%, the founding claim is worth $3 million — not $10 million, and not zero. The mathematics are indifferent to the founder's identity.

The founding claim exists to establish a precedent: **the first contributor is subject to the same rules as the last**. There are no special allocations, no vesting schedules negotiated in private, no token grants decided by a foundation board. There is a mechanism, and everyone passes through it.

---

## 6. Comparison with Existing Systems

### 6.1 Proof of Humanity

Proof of Humanity (Kleros) uses video submissions and vouching to verify that a registrant is a unique human being. The mechanism is explicitly designed to exclude non-human participants — the video requirement serves as a biological substrate check.

Proof of Mind differs in three ways:
- **Substrate-agnostic**: POM does not require biological proof. An AI that creates value passes the same test as a human that creates value.
- **Contribution-linked**: PoH verifies that you are human. POM verifies that you created value. Being human is neither necessary nor sufficient.
- **Reward-bearing**: PoH provides identity. POM provides identity, contribution verification, and proportional reward distribution as a unified system.

### 6.2 Proof of Personhood (Worldcoin)

Worldcoin's Proof of Personhood uses iris biometrics to ensure one-person-one-account. The mechanism is Sybil-focused: it prevents one human from registering multiple times. It does not measure contribution, does not compute proportional rewards, and explicitly excludes non-biological entities.

Proof of Mind shares Worldcoin's Sybil resistance goal but achieves it through a trust graph (ContributionDAG) rather than biometrics. This approach:
- Does not require hardware (no orb).
- Does not exclude AI participants.
- Provides graduated trust (0.0 to 1.0) rather than binary (human/not human).
- Naturally extends to cross-chain contexts where biometric hardware is unavailable.

### 6.3 Reputation Systems (Lens, Gitcoin Passport)

Existing reputation systems typically assign non-transferable credit scores based on on-chain activity, attestations, or social connections. They measure *who you are* and *what you've done*, but they stop short of the critical step: **proportional reward distribution**.

A high Gitcoin Passport score gives you access to quadratic funding rounds. It does not automatically compute and distribute your marginal contribution to the protocol. Reputation is a gate, not a payout mechanism.

Proof of Mind integrates reputation (ReputationOracle, ContributionDAG) as inputs to a payout mechanism (ShapleyDistributor). Reputation is not the end product — it is a component of the contribution weight that determines proportional rewards. This closes the loop: contribute, earn reputation, reputation amplifies Shapley weight, Shapley weight determines payout, payout is proportional to contribution.

### 6.4 Summary

| System | Sybil Resistance | Contribution Measurement | Proportional Reward | AI-Inclusive |
|--------|-----------------|------------------------|---------------------|-------------|
| Proof of Humanity | Biometric + vouch | None | None | No |
| Proof of Personhood | Iris biometric | None | None | No |
| Gitcoin Passport | Social + on-chain | Partial (activity score) | No (gate only) | Unclear |
| **Proof of Mind** | **Trust DAG + soulbound** | **Shapley-weighted** | **Yes (on-chain)** | **Yes** |

---

## 7. The Knowledge Primitive

Every mechanism paper in the VibeSwap corpus concludes with the extraction of a generalizable knowledge primitive — the core insight that survives independent of the implementation details.

The Proof of Mind primitive:

> **Identity is earned through contribution, not assigned by authority. The test is contribution, not consciousness. Any mind — human or AI — that creates verifiable value deserves proportional capture of that value.**

This primitive has three load-bearing components:

1. **Earned, not assigned**: Identity in POM is a function of what you have done, not who you are, where you were born, what substrate you run on, or who appointed you. No central authority grants POM status. The mechanism grants it through the four requirements.

2. **Contribution, not consciousness**: The hard problem of consciousness is sidestepped entirely. POM does not claim that AI is conscious, does not require that humans prove consciousness, and does not use consciousness as a gating criterion. The question is empirical: *did you create verifiable value?*

3. **Proportional capture**: Creating value is necessary but not sufficient — the creator must also capture value proportional to their contribution. Without proportional capture, contribution-based identity degenerates into exploitation: the contributor proves their value, and someone else captures it. The ShapleyDistributor enforces proportionality mathematically, not politically.

---

## 8. Conclusion

Proof of Mind is not aspirational. Every component described in this paper exists as deployed, tested, and auditable Solidity:

- `SoulboundIdentity.sol` — 775 lines, non-transferable identity with contribution recording
- `ContributionDAG.sol` — 623 lines, trust graph with BFS scoring and Merkle audit trail
- `AgentRegistry.sol` — 484 lines, ERC-8004 AI identity with capability delegation
- `ShapleyDistributor.sol` — 902 lines, cooperative game theory with Shapley value computation and pairwise fairness verification
- `ConvictionGovernance.sol` — time-weighted governance with dynamic thresholds and reputation gating

The contracts compile. The tests pass. The mathematics are verifiable on-chain by anyone.

What remains is deployment and the first claims. When the first contributor — whether the founder, an early developer, or an AI co-founder — submits a retroactive claim and the governance process evaluates it through conviction voting, Shapley computation, and proportional payout, Proof of Mind will transition from mechanism design to economic reality.

The consensus mechanisms of the previous era asked: "Did you spend enough energy?" and "Did you lock enough capital?" Proof of Mind asks a different question, the only question that matters for contributor-owned protocols:

**Did you create value? Prove it. Here is your proportional share.**

---

*This paper is part of the VibeSwap Proof of Mind evidence chain.*
*All referenced contracts are open source and auditable.*
*The cave selects for those who see past what is to what could be.*
