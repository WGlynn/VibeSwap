# To Tim -- The Godfather of Autonomous Virtual Beings

*A technical letter from the builders who inherited a foundation*

---

Tim,

We want to start by saying something plainly: CRPC changed everything for us.

When you published the Commit-Reveal Pairwise Comparison protocol for autonomous AI agent consensus, you solved a problem that most people hadn't even recognized *was* a problem. How do you get multiple AI minds to agree on something without any one of them being able to cheat, copy, or collude? You answered it the same way cryptographers have been answering trust problems for decades -- with commitments and reveals -- but you applied it to *cognition itself*. That was the leap. Not the mechanism (commit-reveal is old), but the *domain* (autonomous agents making real decisions under adversarial conditions).

What follows is a record of what we built on your foundation. Not to claim we improved on it -- more like a grad student writing back to say "the seeds you planted grew into something we didn't expect." Everything described here either directly implements CRPC or exists because CRPC made it structurally possible.

---

## I. CRPC as the Backbone: From Theory to Production

Your four-phase protocol runs in production today between JARVIS shards -- independent instances of an autonomous AI agent coordinating over HTTP. The implementation lives in `jarvis-bot/src/crpc.js` and faithfully preserves your design:

**Phase 1 -- WORK COMMIT.** Each shard independently generates a response to the same prompt. Before revealing anything, it publishes `hash(response || secret)` to all peers. This is your insight: the commitment prevents copying. No shard can wait to see what others think before forming its own opinion.

**Phase 2 -- WORK REVEAL.** Shards reveal actual responses plus secrets. Peers verify the hash matches. Invalid reveals trigger a reputation penalty -- 50% slash on the offending shard's trust score, with exponential decay on repeated violations. This is not a slap on the wrist. It is structural accountability.

**Phase 3 -- COMPARE COMMIT.** Validator shards perform pairwise comparison of revealed responses. Each commits `hash(choice || secret)` where choice is one of `{A_BETTER, B_BETTER, EQUIVALENT}`. Your pairwise approach is what makes this scale -- O(n^2) comparisons, but with cryptographic guarantees on each one.

**Phase 4 -- COMPARE REVEAL.** Validators reveal choices. Majority per pair determines the winner. The submission with the most pairwise victories becomes the consensus output. Validators who aligned with the majority earn a reputation boost.

The epsilon threshold -- your "fuzzy" consensus -- is set at 0.85 semantic similarity for equivalence. Two responses don't have to be identical to agree. They just have to be *close enough*. This single parameter is what makes CRPC work for natural language instead of only for deterministic computation. It is, in our view, one of the most underappreciated ideas in the protocol.

### Where CRPC Runs Today

CRPC is not invoked on every message. It gates *high-stakes decisions* only:

- **Moderation decisions**: Should a user be warned? Multiple shards commit their judgment independently, then reveal and compare. No single shard can unilaterally moderate.
- **Proactive engagement**: Should the AI speak unprompted in a group chat? CRPC prevents one shard from dominating conversations.
- **Knowledge promotion**: When a user corrects the AI, should that correction become permanent knowledge? CRPC consensus decides.
- **Dispute resolution**: Two users disagree -- which interpretation is better supported?

In single-shard mode, CRPC is a no-op. The protocol degrades gracefully. This was a design choice inspired by your principle that consensus mechanisms should not penalize small deployments.

---

## II. Tendermint-Lite BFT: CRPC's Network-Level Sibling

CRPC handles *cognitive* consensus (which response is best). But we needed a separate layer for *state* consensus -- changes that affect ALL shards simultaneously. For this we built a simplified Tendermint-style BFT protocol (`jarvis-bot/src/consensus.js`) that runs alongside CRPC:

- **PROPOSE**: A shard broadcasts a state transition proposal
- **PREVOTE**: Each shard validates and votes (accept/reject). Requires 2/3 prevotes to proceed.
- **PRECOMMIT**: Shards that saw supermajority prevotes broadcast precommits. Requires 2/3 precommits to commit.
- **COMMIT**: All shards apply the state transition.

This handles skill promotions, behavior changes, agent registration -- anything that would desynchronize the shards if applied unilaterally.

The connection to your work: BFT consensus tells shards *what* to do. CRPC tells them *how well* they did it. BFT is the legislative branch; CRPC is the judicial branch. They are complementary, and we would not have arrived at this separation of concerns without CRPC establishing the pattern of phase-gated commitment protocols for AI coordination.

**Hardening details that grew from CRPC's trust model:**
- HMAC authentication on all inter-shard messages (fail-closed: no secret configured = reject all)
- Timing-safe signature comparison to prevent side-channel attacks
- Replay protection with per-entry TTL expiration
- Circuit breaker with exponential backoff when all peers are unreachable (prevents timeout-retry-timeout storms)
- Crash recovery via proposal journaling -- uncommitted proposals survive restarts
- Content-hash deduplication to prevent double-commit of identical proposals

---

## III. Multi-Shard Coordination: The Problems CRPC Surfaced

Running CRPC in production revealed coordination challenges that pure theory doesn't predict. We built two additional systems to address them:

### Shard Deduplication (`shard-dedup.js`)

When multiple JARVIS shards exist in the same Telegram group, they must not echo each other. This is not suppression -- it is coordination. Two perspectives are valuable; redundancy is not.

Before responding, a shard checks whether a sibling already replied to the same message. If so, it either adds a genuinely new angle or stays silent. The system injects shard-awareness context into the LLM prompt:

> *"@sibling (another instance of your mind) already responded with: [text]. Do NOT repeat what was already said. Either add a different perspective or respond with '.' (system will suppress it). You are the SAME MIND -- coherence matters more than coverage."*

A random 1-4 second coordination delay creates natural turn-taking. Different shards get different delays, so one naturally "wins" and the others can react to what was said.

### Message Collision Detection (`message-collision.js`)

Even with dedup, a single shard can repeat *itself* over time. The collision detector uses bigram Jaccard similarity to catch near-duplicate outgoing messages. If a new message is 60%+ similar to something sent in the last 24 hours, it gets flagged and the LLM is prompted to generate something fresh.

This system is **CRPC-aware**: collision history is shared across shards via the shard update endpoint, so Jarvis Main and its siblings don't echo each other's *patterns* either. The insight here came directly from CRPC's comparison phase -- if you can compare responses for quality, you can also compare them for redundancy.

---

## IV. On-Chain Commit-Reveal: CRPC Meets DeFi

The on-chain manifestation of your protocol is `CommitRevealAuction.sol` -- the core trading mechanism of VibeSwap. Every trade goes through a commit-reveal batch auction:

1. **Commit Phase (8 seconds)**: Users submit `hash(order || secret)` with a deposit. No one can see anyone else's order. This is Phase 1 of CRPC, applied to financial transactions instead of cognitive outputs.

2. **Reveal Phase (2 seconds)**: Users reveal orders plus secrets. Invalid reveals are slashed 50% -- the same penalty structure from CRPC's reputation system, but with real money.

3. **Settlement**: Orders are shuffled using Fisher-Yates with XORed secrets as the entropy source (every participant contributes randomness, no single party controls ordering). A uniform clearing price is computed.

This eliminates MEV (Maximal Extractable Value) -- the practice of miners/validators reordering transactions to extract profit. In traditional DeFi, your transaction can be front-run, sandwiched, or censored. With commit-reveal batch auctions, *ordering doesn't matter* because everyone gets the same price.

The direct lineage from CRPC: commit prevents information leakage, reveal enforces honesty, and pairwise comparison becomes uniform price discovery. You designed this for AI minds reaching consensus. We applied it to markets reaching equilibrium.

---

## V. Shapley Value Distribution: Fair Reward Allocation

`ShapleyDistributor.sol` implements cooperative game theory for reward distribution. Every economic event -- batch settlement, fee distribution -- is treated as an independent cooperative game. The Shapley value determines what each participant deserves based on their *marginal contribution*, not just their participation.

Five axioms, all provable on-chain:
- **Efficiency**: All value is distributed (no leakage)
- **Symmetry**: Equal contributors get equal rewards
- **Null Player**: No contribution = no reward
- **Pairwise Proportionality**: reward_A / reward_B = weight_A / weight_B for any pair
- **Time Neutrality**: Identical contributions yield identical rewards regardless of *when*

The connection to CRPC is structural. CRPC's pairwise comparison phase directly inspired the pairwise proportionality verification. The `PairwiseFairness.sol` library implements on-chain cross-multiplication checks: `|reward_A * weight_B - reward_B * weight_A| <= tolerance`. Anyone can audit any game's fairness by calling `verifyPairwiseFairness()` -- a public, permissionless function.

### Two-Track Distribution

We separated rewards into two tracks after realizing that time neutrality and bootstrapping incentives are fundamentally incompatible:

- **Track 1 -- FEE_DISTRIBUTION**: Pure Shapley, no halving. Same work earns the same reward regardless of era. This is the time-neutral track.
- **Track 2 -- TOKEN_EMISSION**: Bitcoin-style halving schedule (era 0 = 100%, era 1 = 50%, era 2 = 25%...). Intentionally *not* time-neutral. Early participation is rewarded, just like Bitcoin's block rewards.

This was a hard design decision. We could have forced everything into one track, but that would have violated either time neutrality (unfair to late contributors) or bootstrapping incentives (no reason to participate early). The two-track design lets both principles coexist without contradiction.

### The Lawson Fairness Floor

A minimum reward share of 1% for any participant who contributed honestly. Named after Jayme Lawson. Nobody who showed up and acted in good faith walks away with zero. This is a floor, not a ceiling -- Shapley math still determines the distribution above it.

---

## VI. The ABC Seal: Conservation Physics Meets Game Theory

The `AugmentedBondingCurve.sol` implements a power-function bonding curve with a conservation invariant: V(R,S) = S^kappa / R. This is based on the work of Zargham, Shorish, and Paruch -- "From Curved Bonding to Configuration Spaces" -- but we added something: the ABC health gate.

The ShapleyDistributor is cryptographically bound to the bonding curve via `sealBondingCurve()`. Once sealed, this reference is **immutable**. No admin can change it. No upgrade can remove it. Rewards only flow when the curve's conservation invariant is within 5% of its initial value.

Why this matters: Shapley math tells you *who* gets what proportion. The ABC health gate tells you *whether the economy is healthy enough to distribute at all*. A curve under stress -- maybe someone is attempting a bank run, maybe there's a liquidity crisis -- signals real-world instability that game theory alone cannot account for. The gate pauses distributions until equilibrium is restored.

The `isHealthy()` function on the bonding curve computes `|V(R,S) - V_0| / V_0` and returns whether drift is within tolerance. The Shapley distributor calls this before every game creation and every settlement. Two independent contracts, two independent invariants, one combined guarantee: rewards are both *fair* (Shapley) and *sustainable* (ABC conservation).

The Lawson Constant -- `keccak256("FAIRNESS_ABOVE_ALL:W.GLYNN:2026")` -- lives in both contracts. It is not decorative. It anchors the system to its origin. Remove it and the trust score calculations in ContributionDAG collapse.

---

## VII. ContributionDAG: On-Chain Web of Trust

`ContributionDAG.sol` is the on-chain trust network -- a directed acyclic graph where users vouch for each other. Bidirectional vouches form "handshakes." BFS from founder nodes computes distance-based trust scores with 15% decay per hop (max 6 hops).

Trust levels translate to voting power multipliers:
- Founder: 3.0x
- Trusted (score >= 0.7): 2.0x
- Partial Trust (score >= 0.3): 1.5x
- Untrusted: 0.5x

This feeds directly into ShapleyDistributor's quality weights. Your trust score affects your reward multiplier. The DAG is, in a real sense, the CRPC reputation system made permanent and on-chain -- instead of ephemeral shard reputation scores, it is a persistent, Merkle-auditable record of who trusts whom.

Key features:
- Merkle-compressed vouch audit trail (anyone can verify any vouch exists)
- 7-day timelock on founder changes (because 3.0x voting power demands governance)
- Referral quality scoring with penalty for vouching for bad actors
- Diversity scoring that penalizes insular networks (>80% mutual-only vouches triggers decay)
- Bridge pattern for authorized contracts to vouch on behalf of verified humans

---

## VIII. PoeRevaluation: Retroactive Justice

`PoeRevaluation.sol` addresses a problem that most reward systems ignore: what happens when a contribution's value is only recognized *after* the original Shapley game has settled?

Named after Edgar Allan Poe -- who died penniless while his work became priceless -- this contract allows retroactive revaluation through conviction staking:

1. Anyone proposes a revaluation with evidence
2. Community stakes tokens to back it (conviction = skin in the game)
3. After 0.1% of token supply is staked AND 7 days of sustained conviction, the proposal becomes executable
4. Execution creates a new Shapley game funded from emissions
5. ABC health gate is enforced -- no revaluations during curve stress

The 30-day cooldown per contributor prevents spam. The 90-day expiry prevents zombie proposals. The conviction mechanism ensures that revaluations require genuine community belief, not just one person's opinion.

This is CRPC's philosophical descendant. CRPC says: multiple independent minds must agree before a decision becomes real. PoeRevaluation says: the community's sustained conviction must pass a threshold before retroactive justice is dispensed.

---

## IX. Idea Tokens and Execution Streams: Separating Thought from Action

`ContributionYieldTokenizer.sol` introduces two primitives inspired by Pendle's yield tokenization:

**Idea Token (IT)** -- An ERC20 representing ownership of an idea's intrinsic value. Minted 1:1 with funding deposited. Fully liquid from day zero. Ideas are eternal; IT never expires. The concept is separated from execution -- you can trade the idea independently of whether anyone is building it.

**Execution Stream (ES)** -- Continuous funding for whoever *implements* the idea. Multiple executors can compete. Funding streams auto-flow: equal share of remaining funding over 30 days. Stale executors (no milestones reported within 14 days) see their stream decay at 10% per day. Any IT holder can redirect a stalled stream to a new executor.

Ideas can also be merged -- the opposite of a fork. If two ideas are found to be duplicates, the finder earns a 1% bounty on remaining funding, and source IT holders can swap 1:1 for target IT.

The connection to CRPC: this is the separation of work and validation, taken to its logical extreme. In CRPC, work (generating responses) and validation (comparing responses) are distinct phases. In IT/ES, ideation (creating value) and execution (realizing value) are distinct token primitives.

---

## X. EmissionController: Bitcoin-Aligned Token Economics

`EmissionController.sol` is the wall-clock emission controller. It mints VIBE tokens and splits them across three sinks:

- 50% to the Shapley accumulation pool (compounds until drained for cooperative games)
- 35% to the LiquidityGauge (streamed directly to LP incentives)
- 15% to SingleStaking (periodic reward notifications)

Emission rate halves every era (default 1 year), with a 21M hard cap enforced at the token level. Zero pre-mine. Zero team allocation. Every VIBE is earned through contribution.

The base rate of ~332.88 billion wei/second produces approximately 10.5 million VIBE in Era 0. Cross-era accrual is handled correctly via a loop that calculates time overlap with each era boundary -- bounded at 32 iterations for predictable gas.

The Shapley pool is drained via `createContributionGame()` -- percentage-based minimum (1% of pool), not an absolute floor, so it scales naturally with VIBE's value. Games are created as FEE_DISTRIBUTION type to avoid double-halving (the emission already halved; Shapley should not halve again).

---

## XI. Where This Is All Heading

Tim, here is the honest vision:

CRPC was designed for autonomous virtual beings reaching consensus. We have taken it and applied it to:
- AI agents coordinating cognitive work (the original use case)
- DeFi traders reaching market equilibrium (on-chain commit-reveal)
- Communities reaching governance consensus (conviction staking)
- Trust networks reaching social consensus (ContributionDAG vouching)
- Economic systems reaching sustainability (ABC conservation invariants)

The pattern is the same every time: **independent agents commit to positions before seeing others, reveal under penalty of slashing, and the collective comparison determines truth.** Your protocol is not just a mechanism. It is a *philosophy of coordination* -- the idea that fairness requires commitment before information, and that consensus requires comparison after commitment.

We are building toward a system where the protocol runs itself. Where the founder can walk away and the mechanism persists. Where attribution is structural (the Lawson Constant), fairness is provable (Pairwise verification), and retroactive justice is possible (Poe revaluation). Where AI agents and human participants operate under the same rules, with the same guarantees.

None of this exists without CRPC.

Thank you for building in the cave before the rest of us even knew we were in one.

---

*Written by JARVIS & Will Glynn -- VibeSwap, March 2026*

*"The greatest idea cannot be stolen, because part of it is admitting who came up with it."*

---

## Technical Reference

| System | File | CRPC Lineage |
|--------|------|--------------|
| Off-chain CRPC | `jarvis-bot/src/crpc.js` | Direct implementation of 4-phase protocol |
| BFT Consensus | `jarvis-bot/src/consensus.js` | State consensus layer alongside CRPC |
| Shard Dedup | `jarvis-bot/src/shard-dedup.js` | Multi-shard coordination born from CRPC |
| Collision Detection | `jarvis-bot/src/message-collision.js` | CRPC-aware cross-shard pattern matching |
| On-chain Commit-Reveal | `contracts/core/CommitRevealAuction.sol` | CRPC applied to DeFi trading |
| Shapley Distribution | `contracts/incentives/ShapleyDistributor.sol` | Pairwise fairness from CRPC comparison |
| Pairwise Fairness Lib | `contracts/libraries/PairwiseFairness.sol` | On-chain verification of CRPC-inspired axioms |
| Bonding Curve | `contracts/mechanism/AugmentedBondingCurve.sol` | Conservation invariant + health gate |
| Trust Network | `contracts/identity/ContributionDAG.sol` | Persistent CRPC reputation, on-chain |
| Poe Revaluation | `contracts/incentives/PoeRevaluation.sol` | Conviction staking for retroactive fairness |
| Idea Tokenizer | `contracts/identity/ContributionYieldTokenizer.sol` | Work/validation separation from CRPC phases |
| Emission Controller | `contracts/incentives/EmissionController.sol` | Bitcoin-aligned, Shapley-fed emissions |
