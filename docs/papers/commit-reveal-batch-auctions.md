# Commit-Reveal Batch Auctions: Eliminating MEV Through Temporal Decoupling

**W. Glynn, JARVIS | March 2026 | VibeSwap Research**

---

## Abstract

Maximal Extractable Value (MEV) drains billions of dollars annually from decentralized finance users. The problem is structural: continuous order flow in a transparent mempool gives informed actors the ability to observe, reorder, and exploit pending transactions. Existing mitigations -- Flashbots, MEV-Share, threshold encryption -- reduce visibility or redistribute extracted value, but none eliminate the extraction itself. They treat symptoms while the disease persists.

This paper presents a mechanism that eliminates MEV at its root. VibeSwap's commit-reveal batch auction processes trades in discrete 10-second windows: an 8-second commit phase where users submit cryptographic hashes of their orders, followed by a 2-second reveal phase where orders are disclosed and verified. Settlement executes all orders in a batch at a single uniform clearing price, in a random execution order determined by a Fisher-Yates shuffle seeded with XORed user secrets and post-reveal block entropy. Frontrunning is impossible because orders are invisible during commitment. Sandwich attacks are impossible because every participant receives the same price. Time-priority manipulation is impossible because execution order is random. The dominant strategy for every participant is honest submission of their true order.

We formalize the mechanism, analyze its game-theoretic properties, and compare it against existing MEV mitigation approaches. The core insight generalizes: any system where ordering confers advantage can use temporal decoupling of intent from execution to neutralize that advantage.

---

## 1. The MEV Problem

### 1.1 What MEV Is

Maximal Extractable Value is the profit available to any actor who can influence the ordering, inclusion, or censorship of transactions within a block. Originally termed "Miner Extractable Value" when Proof-of-Work miners controlled block construction, the concept persists under Proof-of-Stake with validators and the MEV supply chain of searchers, builders, and relayers.

MEV is not a bug. It is a consequence of two properties that every major blockchain shares: transparent mempools and sequential transaction execution. When pending transactions are visible and their ordering determines outcomes, any actor with the ability to observe and reorder can extract value from other participants.

### 1.2 Attack Taxonomy

**Frontrunning.** A searcher observes a large pending buy order for token X. They insert their own buy order before it, purchasing X at the current price. The victim's order executes next, pushing the price up. The searcher sells into the higher price. The victim receives fewer tokens. The searcher profits the difference minus gas costs.

**Sandwich attacks.** A refinement of frontrunning. The attacker places a buy order before the victim's transaction and a sell order after it, capturing the price impact on both sides. The victim's trade is the bread; the attacker's trades are the sandwich. The victim pays a worse price than they would have in the attacker's absence, and every cent of that difference flows to the attacker.

**Back-running.** An attacker observes a transaction that will create an arbitrage opportunity (a large trade that moves a pool's price away from the global market price) and places their own transaction immediately after to capture the rebalancing profit. Less harmful to the original trader, but still extracts value that could otherwise accrue to the protocol or liquidity providers.

**Just-in-time (JIT) liquidity.** A searcher observes a large pending swap, adds concentrated liquidity to the relevant price range just before the swap executes, earns fees from the swap, and removes the liquidity immediately after. This extracts fee revenue from passive liquidity providers who committed capital for longer durations.

### 1.3 The Root Cause

These attacks share a common structure: an observer sees a pending action, predicts its impact, and positions themselves to profit from that impact. The root cause is not greed, sophistication, or insufficient regulation. It is the combination of two architectural choices:

1. **Transparent order flow.** Pending transactions are visible to all network participants before execution.
2. **Continuous sequential processing.** Transactions execute one at a time in an order that can be influenced.

Any system built on these two properties will produce MEV. Mitigations that preserve both properties can reduce MEV or redistribute it, but cannot eliminate it. Elimination requires removing at least one of the two preconditions.

---

## 2. The Mechanism

VibeSwap removes both preconditions simultaneously. Orders are hidden during submission (removing transparency) and executed as a batch at uniform price in random order (removing sequential advantage). The mechanism operates in fixed 10-second windows with three phases.

### 2.1 Commit Phase (8 seconds)

During the commit phase, a user constructs their order -- specifying the input token, output token, amount, minimum acceptable output, and a randomly generated secret -- then submits only a cryptographic hash:

```
commitHash = keccak256(trader, tokenIn, tokenOut, amountIn, minAmountOut, secret)
```

The hash is a one-way function. No observer can determine the order's contents from the hash. The user also submits a deposit (minimum 0.001 ETH or 5% of estimated trade value, whichever is greater) as collateral against failure to reveal.

At this point, the contract knows that *someone* intends to trade *something*, but nothing more. The token pair, direction, and size are all concealed. There is nothing to frontrun because there is nothing to see.

**Flash loan protection.** The contract enforces that each address can only interact once per block (`lastInteractionBlock[msg.sender] == block.number` reverts). This prevents flash loan attacks where an attacker borrows capital, commits, reveals, and repays within a single transaction. Only externally owned accounts (EOAs) making genuine commitments across multiple blocks can participate.

### 2.2 Reveal Phase (2 seconds)

When the commit phase ends, the reveal phase begins. Users broadcast their original order parameters and their secret. The contract reconstructs the hash and verifies it matches the stored commitment:

```
expectedHash = keccak256(msg.sender, tokenIn, tokenOut, amountIn, minAmountOut, secret)
require(expectedHash == commitment.commitHash)
```

If the hash does not match -- the user changed their order, submitted garbage data, or attempted any form of manipulation -- the commitment is slashed. Fifty percent of the deposit is sent to the DAO treasury. This is not a fee. It is a penalty that makes griefing, spam, and strategic non-revelation economically self-defeating.

During the reveal phase, users may also submit a priority bid: an additional ETH payment (or proof-of-work equivalent) that grants earlier execution within the batch. Priority orders execute before regular orders, sorted by bid amount descending. This is the mechanism's controlled valve for remaining MEV: rather than allowing opaque extraction, the protocol channels urgency premiums into transparent, protocol-owned revenue.

Each revealed order's secret is stored. These secrets will seed the execution order randomization.

### 2.3 Settlement

After the reveal phase closes, the batch enters settlement. Three operations occur:

**Uniform clearing price.** The protocol aggregates all revealed buy and sell orders, constructs supply and demand curves, and computes a single price at which the batch clears. Every order in the batch that is fillable at this price executes at this price. There is no individual price impact. A user buying 100 tokens and a user buying 100,000 tokens pay the same price per token. This is the property that makes sandwich attacks structurally impossible: there is no price differential between "before" and "after" a target transaction because there is no sequential ordering of prices within a batch.

**Deterministic random shuffle.** The execution order of non-priority orders is determined by a Fisher-Yates shuffle. The shuffle seed is generated in two stages:

1. XOR all revealed user secrets: `seed = secret_1 XOR secret_2 XOR ... XOR secret_n`
2. Mix in unpredictable block entropy: `finalSeed = keccak256(seed, blockhash(revealEndBlock), batchId, n)`

The XOR of secrets ensures every participant contributes to the randomness. The block entropy (from a block produced *after* the reveal phase ends) ensures that even the last revealer cannot predict the final seed, because `blockhash(revealEndBlock)` is unknown during the reveal phase. The Fisher-Yates algorithm then produces a uniformly random permutation of order indices, guaranteeing no positional advantage.

**TWAP validation.** The clearing price is checked against the time-weighted average price (TWAP) oracle. If the clearing price deviates more than 5% from the TWAP, the batch is flagged for review or rejected. This prevents oracle manipulation and stale-price exploitation.

### 2.4 Why Each Attack Vector Fails

| Attack | Why it fails |
|--------|-------------|
| **Frontrunning** | Orders are invisible during the commit phase. The attacker sees only a hash, which reveals nothing about token pair, direction, or size. There is nothing to front-run. |
| **Sandwich attack** | All orders execute at a uniform clearing price. There is no price movement between individual trades within a batch, so there is no spread to capture. |
| **Time-priority manipulation** | Execution order is randomized via Fisher-Yates shuffle with a seed that is unknowable until after all reveals are complete. Submitting first or last confers no advantage. |
| **JIT liquidity** | The clearing price is computed from aggregate supply and demand, not from individual pool interactions. Concentrated liquidity positioning around a single trade's impact is not applicable. |
| **Flash loan attacks** | The same-block interaction check (`lastInteractionBlock`) prevents any address from committing and acting within a single transaction. |

---

## 3. Game-Theoretic Analysis

### 3.1 Honest Participation as Dominant Strategy

A strategy is dominant if it produces the best outcome regardless of what other participants do. In VibeSwap's mechanism, honest participation -- submitting a truthful order during commit, revealing it faithfully during reveal -- is the dominant strategy.

**Why deviate?** A rational actor might consider:

- **Not revealing** (strategic withdrawal after seeing other reveals). Cost: 50% deposit slashed. Benefit: avoiding a trade that looks unfavorable after partial information is visible. But the reveal phase is 2 seconds, and partial reveals provide limited signal. The expected loss from slashing exceeds the expected benefit of selective withdrawal in all but extreme edge cases, and rate limiting prevents repeated attempts.

- **Submitting a false commitment** (committing one order, attempting to reveal a different one). Cost: hash mismatch triggers automatic 50% slashing. Benefit: none; the contract enforces cryptographic binding between commit and reveal.

- **Flooding with fake commits** (submitting many commitments to manipulate the batch). Cost: each commitment requires a deposit. Unrevealed commitments are slashed 50%. The attacker pays `n * deposit * 0.5` for `n` fake commits. Benefit: negligible, because the uniform clearing price is computed only from *revealed* orders, and the shuffle only includes *revealed* orders.

The deposit-and-slash mechanism creates a credible commitment device. Participation is costly to fake and cheap to do honestly.

### 3.2 The Slashing Equilibrium

The 50% slash rate is not arbitrary. It must satisfy two constraints:

1. **High enough to deter griefing.** If slashing is too low (say 1%), an attacker could submit many fake commitments at low cost to pollute batches or probe for information.
2. **Low enough to not deter honest participation.** If slashing is too high (say 99%), users would fear losing their deposit due to network latency or client bugs during the reveal phase, and would avoid the protocol entirely.

At 50%, the expected cost of a single griefing attempt is half the deposit, which scales linearly with the number of attempts. An attacker who submits 100 fake commitments at the minimum deposit of 0.001 ETH loses 0.05 ETH per batch. Sustained griefing becomes expensive quickly, while honest users who reveal correctly lose nothing.

### 3.3 Priority Auctions: Cooperative MEV Capture

Some MEV is not adversarial. Arbitrageurs who correct price discrepancies between venues perform a useful function: they keep prices accurate. Liquidators who close undercollateralized positions protect protocol solvency. These actors have a legitimate need for execution priority.

VibeSwap accommodates this through priority bidding. During the reveal phase, any user can attach an additional ETH payment (or submit a proof-of-work solution with equivalent value) to their order. Priority orders execute before regular orders, sorted by bid descending. The bid revenue flows to the DAO treasury.

This is cooperative MEV capture. The value that would otherwise be extracted by opaque, adversarial actors is instead channeled through a transparent auction into protocol-owned revenue. The protocol captures MEV; participants are not exploited by it.

The key distinction: priority bidding does not reintroduce the MEV problem because it operates *within* the batch auction framework. Priority orders still execute at the uniform clearing price. They gain execution order advantage, not price advantage. The only benefit of priority is execution certainty in cases where batch capacity is limited or where order of fills matters for cross-protocol strategies.

### 3.4 Collusion Resistance

Could a group of participants collude to manipulate the clearing price? They would need to:

1. Coordinate their committed orders (impossible -- orders are hidden during commit).
2. Strategically reveal or withhold reveals (costly -- non-reveals are slashed 50%).
3. Control the shuffle seed (impossible -- block entropy from a future block is included in the seed).

Collusion requires coordination, and the commit phase prevents coordination on order contents. A colluding group that agrees in advance to submit specific orders gains no advantage over independent actors submitting the same orders, because the clearing price is determined by aggregate supply and demand regardless of who submitted the orders.

---

## 4. Implementation Details

### 4.1 Batch Lifecycle

```
t=0s ────── t=8s ────── t=10s
│  COMMIT   │  REVEAL   │  SETTLE → next batch
│  phase    │  phase    │
```

Batches are indexed by a monotonically increasing `batchId` (uint64). The contract tracks the current batch's start timestamp and uses arithmetic to determine the current phase:

- `t < batchStart + 8`: Commit phase
- `t < batchStart + 10`: Reveal phase
- `t >= batchStart + 10`: Settlement eligible

These durations are protocol constants, not per-pool parameters. Every pool on every chain uses the same 8/2 timing. This is a deliberate design choice: the fairness guarantees depend on uniform rules. If pools could customize their timing, some would choose parameters that weakened MEV protection.

### 4.2 The Shuffle Algorithm

The `DeterministicShuffle` library implements Fisher-Yates (Knuth) shuffle, the standard algorithm for generating uniformly random permutations:

```
for i from n-1 down to 1:
    j = random(0, i)    // uniform random in [0, i]
    swap(array[i], array[j])
```

Randomness is derived by iteratively hashing the seed:

```
currentSeed = keccak256(seed, i)
j = uint256(currentSeed) % (i + 1)
```

This produces a deterministic permutation for any given seed, which means the shuffle is verifiable: anyone can recompute it from the seed and confirm the execution order was correct.

For batches with priority orders, the library uses `partitionAndShuffle`: priority orders occupy the first positions (sorted by bid), and only the remaining regular orders are shuffled.

### 4.3 Seed Security

The naive approach -- XOR all user secrets -- has a vulnerability: the last user to reveal can compute the XOR of all previous secrets (which are public by that point) and choose their own secret to produce a favorable shuffle. VibeSwap addresses this by mixing in `blockhash(revealEndBlock)`, the hash of the block at which the reveal phase ended. This value is unknown during the reveal phase (it comes from a block produced after reveals close), so the last revealer cannot predict the final seed.

This is defense in depth. The 2-second reveal window already limits the last-revealer's ability to compute and submit a favorable secret in time. The block entropy makes the attack impossible even with infinite computation speed.

### 4.4 Circuit Breakers and Rate Limits

The batch auction mechanism is embedded within a broader safety system:

- **TWAP validation**: clearing prices that deviate more than 5% from the time-weighted average are rejected.
- **Rate limiting**: individual users are capped at 1 million tokens per hour, preventing batch domination.
- **Circuit breakers**: trading halts automatically if volume, price deviation, or withdrawal rates exceed configurable thresholds.
- **Trade size caps**: no single order can exceed 10% of pool reserves (`MAX_TRADE_SIZE_BPS = 1000`).

These are protocol constants, not pool parameters. They cannot be weakened by pool creators.

---

## 5. Comparison with Existing Approaches

| Property | VibeSwap | Flashbots Protect | MEV-Share | CowSwap | Threshold Encryption |
|----------|----------|-------------------|-----------|---------|---------------------|
| **Order visibility** | Hidden (hash only) | Hidden (private relay) | Hidden (private relay) | Hidden (off-chain solver) | Hidden (encrypted) |
| **Execution model** | Batch (uniform price) | Sequential | Sequential | Batch (solver-optimized) | Sequential |
| **MEV eliminated?** | Yes | No (redistributed) | No (shared with user) | Partially (solver dependent) | No (deferred to decryption) |
| **Trust assumption** | None (trustless on-chain) | Trust relay/builder | Trust relay/builder | Trust solver network | Trust threshold committee |
| **Randomized order** | Yes (Fisher-Yates) | No | No | No (solver-determined) | No |
| **Uniform pricing** | Yes | No | No | Yes (within CoW) | No |
| **Frontrunning protection** | Cryptographic | Relay privacy | Relay privacy | Off-chain matching | Encryption |
| **Sandwich protection** | Structural (uniform price) | None | Partial (rebates) | Partial (batch when CoW exists) | None after decryption |
| **Decentralization** | Fully on-chain | Centralized relay | Centralized relay | Semi-centralized solvers | Committee-dependent |

**Flashbots Protect** routes transactions through a private relay to avoid the public mempool. This hides orders from opportunistic searchers but does not prevent the relay operator or connected builders from extracting MEV. The trust model shifts from "anyone can extract" to "the relay chooses who extracts." MEV is redistributed, not eliminated.

**MEV-Share** extends Flashbots by allowing users to share a portion of the MEV their transaction generates, receiving a rebate. This improves outcomes for users relative to unprotected submission, but explicitly preserves MEV as a revenue stream. The mechanism's goal is fair sharing of extraction, not its elimination.

**CowSwap** uses an off-chain solver network to find Coincidences of Wants (CoWs) -- pairs of orders that can be matched directly without touching an AMM. When CoWs exist, both parties receive better prices and MEV is avoided for those specific trades. When CoWs do not exist, orders are routed to on-chain AMMs and are subject to standard MEV risks. Protection is conditional, not structural.

**Threshold encryption** schemes (e.g., Shutter Network) encrypt transactions so their contents are hidden until a threshold of key holders collaboratively decrypts them. This prevents frontrunning during the encrypted period but reintroduces MEV at the moment of decryption: once orders are decrypted, they are processed sequentially, and any actor who can influence ordering at that stage can extract value. The trust model depends on the threshold committee's honesty and the decryption protocol's timing guarantees.

VibeSwap's approach is distinct because it combines information hiding (commit-reveal) with execution uniformity (batch clearing at a single price in random order). Neither property alone is sufficient. Hiding orders without uniform pricing delays MEV but does not prevent it. Uniform pricing without hiding orders allows strategic order construction. The combination eliminates MEV structurally.

---

## 6. The Knowledge Primitive

The generalizable insight from this mechanism is:

> **MEV elimination requires temporal decoupling of intent from execution.**

Intent expression (what you want to do) and execution (when and how it happens) must occur in separate, non-overlapping time windows. During the intent window, the system collects commitments without revealing their contents. During the execution window, the system processes all commitments simultaneously under uniform rules that remove ordering advantage.

This primitive applies beyond decentralized exchanges:

- **Auctions.** Sealed-bid auctions are a classical application of commit-reveal. VibeSwap extends this to continuous trading by running sequential batches.
- **Governance voting.** Commit-reveal voting prevents vote-buying and last-minute strategic voting. If votes are hidden until the reveal phase, voters cannot coordinate in real time.
- **Resource allocation.** Any system where participants compete for limited resources (block space, network bandwidth, compute slots) and where ordering determines who wins can use temporal decoupling to ensure fairness.
- **Cross-chain coordination.** VibeSwap's mechanism extends natively across chains via LayerZero V2 messaging. Users on different chains commit to the same batch, and cross-chain orders are settled alongside local orders at the same uniform clearing price.

The primitive is simple. Its power comes from its generality. Wherever ordering confers advantage, temporal decoupling neutralizes that advantage. The mechanism does not require participants to trust each other, trust a relay, or trust a committee. It requires only that the hash function is one-way and that the block entropy is unpredictable -- properties that are foundational assumptions of every major blockchain.

---

## 7. Limitations and Future Work

**Latency.** The 10-second batch window introduces latency relative to continuous AMMs where swaps execute in the next block (~12 seconds on Ethereum, but immediately confirmed). Users who need sub-second execution will find this mechanism unsuitable. This is an intentional tradeoff: the latency is the cost of fairness.

**Thin batches.** When a batch contains very few orders, the uniform clearing price may not reflect true market conditions, and the shuffle provides limited anonymity. The protocol mitigates this through TWAP validation (rejecting clearing prices that deviate significantly from the oracle) and by the fact that single-order batches execute at the AMM's spot price, which is the same outcome as a standard swap.

**Last-revealer residual advantage.** Although block entropy eliminates the last revealer's ability to manipulate the shuffle seed, the last revealer can still choose *whether* to reveal based on the orders already revealed by others. The 50% slashing penalty makes this strategy unprofitable in expectation, but does not make it impossible. Future work could explore commit-reveal schemes with mandatory revelation (e.g., time-locked encryption where reveals happen automatically).

**Gas costs.** The commit-reveal mechanism requires two transactions per order (commit and reveal) versus one for a standard swap. On high-gas chains, this doubles the user's gas expenditure. On L2s and alt-L1s where gas is cheap, this cost is negligible. Cross-chain deployments on low-cost chains are the natural habitat for this mechanism.

---

## 8. Conclusion

MEV is not an externality to be managed. It is a structural consequence of continuous, transparent order processing. Flashbots, MEV-Share, and threshold encryption accept this structure and attempt to make the best of it -- hiding orders from some extractors, sharing proceeds with victims, or deferring extraction to a later moment. These are pragmatic engineering responses to a problem they cannot solve.

Commit-reveal batch auctions solve the problem. By separating intent expression from execution across non-overlapping time windows, the mechanism removes both preconditions for MEV: order visibility during commitment and sequential price impact during execution. The result is a system where the dominant strategy is honest participation, where every trade in a batch receives the same price, and where execution order is provably random.

The implementation is live. The code is the proof. The contracts are open source, upgradeable via UUPS proxy, and deployed with the full suite of safety mechanisms -- circuit breakers, TWAP validation, rate limits, flash loan protection -- that a production DEX requires.

MEV elimination is not a theoretical possibility. It is a deployed mechanism. The only question is adoption.

---

## References

1. Daian, P., Goldfeder, S., Kell, T., et al. "Flash Boys 2.0: Frontrunning in Decentralized Exchanges, Miner Extractable Value, and Consensus Instability." IEEE S&P, 2020.
2. Flashbots. "MEV-Explore: Quantifying Extracted Value." https://explore.flashbots.net
3. CowSwap. "Coincidence of Wants Protocol." https://docs.cow.fi
4. Breidenbach, L., Daian, P., Juels, A., et al. "Chainlink Fair Sequencing Services." 2021.
5. Buterin, V. "On Proposer-Builder Separation." Ethereum Research, 2021.
6. Knuth, D. "The Art of Computer Programming, Vol. 2: Seminumerical Algorithms." Section 3.4.2: Random Sampling and Shuffling.

---

*VibeSwap is open source. The contracts referenced in this paper are available at [github.com/wglynn/vibeswap](https://github.com/wglynn/vibeswap).*

*The mechanism described here implements the philosophy of Cooperative Capitalism: mutualized risk through uniform clearing prices and insurance pools, combined with free-market competition through transparent priority auctions. MEV is not destroyed -- it is cooperatively captured and returned to the protocol's participants.*
