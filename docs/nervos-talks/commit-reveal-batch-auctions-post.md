# Commit-Reveal Batch Auctions: How VibeSwap Eliminates $1.38B in MEV Extraction

*Nervos Talks Post — W. Glynn (Faraday1)*
*March 2026*

---

## TL;DR

MEV (Maximal Extractable Value) has extracted over $1.38 billion from Ethereum users through frontrunning, sandwich attacks, and transaction reordering. The entire industry treats this as a cost of doing business — Flashbots redistributes it, MEV-Share gives you a rebate, CowSwap avoids it sometimes. Nobody eliminates it. VibeSwap does. Our commit-reveal batch auction mechanism makes MEV **structurally impossible** — not mitigated, not reduced, not redistributed. Eliminated. And CKB's cell model turns out to be the ideal substrate for it, because the batch design produces zero cell contention during the commit phase — a property that solves the fundamental throughput constraint of UTXO-based DEXs.

---

## The Problem Nobody Is Solving

Here is the uncomfortable truth about every DEX you have ever used:

**Someone saw your trade before it executed and profited from it.**

This is not a conspiracy theory. It is basic blockchain architecture. Two properties that every major chain shares make it inevitable:

1. **Transparent mempools.** Your pending transaction is visible to every participant before it executes.
2. **Sequential execution.** Transactions process one at a time, and the order determines who profits.

When these two properties coexist, MEV is not a bug — it is a mathematical certainty. Every trade you submit is a signal. Every signal is an opportunity. Every opportunity is extracted.

| Attack | How It Works | Who Profits |
|---|---|---|
| **Frontrunning** | Bot sees your buy, buys first, sells to you at a higher price | MEV searcher |
| **Sandwich** | Bot buys before you AND sells after you, capturing both sides | MEV searcher |
| **Back-running** | Bot places trade immediately after yours to capture the price correction | MEV searcher |
| **JIT Liquidity** | Bot adds concentrated liquidity right before your swap, earns fees, removes it after | MEV searcher |

The common thread: **an observer sees your intent, predicts its impact, and positions themselves to profit from it.**

$1.38 billion. That is not protocol revenue. That is not gas fees. That is pure extraction from ordinary users into the pockets of sophisticated bots. Every cent of it came from someone who got a worse price than they should have.

---

## The Industry's Non-Solutions

The DeFi industry has responded to MEV with a series of approaches that all share one feature: they accept that MEV exists and try to make the best of it.

**Flashbots Protect** routes your transaction through a private relay so searchers in the public mempool cannot see it. Problem: the relay operator and connected builders can still extract MEV. You have traded one set of extractors for another. The trust model shifted from "anyone can exploit you" to "the relay chooses who exploits you." MEV is redistributed, not eliminated.

**MEV-Share** goes further — it lets you share in the MEV your transaction generates. You get a rebate. This is an improvement, but read that sentence again: *you share in the MEV your transaction generates.* The mechanism explicitly preserves extraction as a revenue stream. You are being compensated for being exploited. This is a bandage, not a cure.

**CowSwap** finds Coincidences of Wants — pairs of orders that can be matched directly without hitting an AMM. When CoWs exist, both parties get better prices and MEV is avoided. When they do not exist (which is most of the time), orders route to on-chain AMMs with standard MEV exposure. Protection is conditional, not structural.

**Threshold Encryption** (Shutter Network and others) encrypts transactions until a committee decrypts them. This hides orders temporarily, but the moment decryption occurs, orders are processed sequentially. MEV is deferred, not eliminated. And you now trust a committee.

Every one of these approaches preserves at least one of the two root causes: visible order flow or sequential execution. As long as either survives, MEV survives.

---

## The Mechanism: Temporal Decoupling

VibeSwap removes both root causes simultaneously.

Orders are **hidden** during submission (removing transparency). Orders are **batched** at a uniform clearing price in random execution order (removing sequential advantage). The mechanism runs in fixed 10-second windows.

### Phase 1: Commit (8 seconds)

You construct your order — token pair, amount, minimum output, and a randomly generated secret. You submit only a cryptographic hash:

```
commitHash = keccak256(trader, tokenIn, tokenOut, amountIn, minAmountOut, secret)
```

This hash is a one-way function. No observer — no bot, no validator, no relay — can determine what you are trading, how much, or in which direction. You also submit a deposit (minimum 0.001 ETH or 5% of estimated trade value) as collateral.

The contract knows that *someone* intends to trade *something*. Nothing more. There is nothing to frontrun because there is nothing to see.

**Flash loan protection**: Each address can interact only once per block. This prevents flash loan attacks where an attacker borrows capital, commits, reveals, and repays atomically. Only genuine participants across multiple blocks can trade.

### Phase 2: Reveal (2 seconds)

The commit phase ends. You broadcast your original order parameters and secret. The contract reconstructs the hash and verifies it matches:

```
require(keccak256(msg.sender, tokenIn, tokenOut, amountIn, minAmountOut, secret) == commitment.commitHash)
```

If the hash does not match — you changed your order, submitted garbage, attempted any manipulation — **50% of your deposit is slashed** and sent to the DAO treasury. This is not a fee. It is a penalty that makes griefing economically self-defeating.

During reveal, you may also submit a **priority bid**: additional ETH that grants earlier execution within the batch. Priority revenue flows to the DAO treasury. This is cooperative MEV capture — urgency premiums channeled transparently into protocol-owned revenue rather than extracted opaquely by bots.

### Phase 3: Settlement

Three operations execute:

**Uniform clearing price.** All revealed buy and sell orders are aggregated. Supply and demand curves are constructed. A single clearing price is computed. Every order in the batch that is fillable at this price executes at this price. A user buying 100 tokens and a user buying 100,000 tokens pay the same price per token. There is no individual price impact. Sandwich attacks are structurally impossible — there is no price differential between "before" and "after" because there is no before and after within a batch.

**Fisher-Yates shuffle.** Execution order for non-priority orders is determined by a deterministic random shuffle:

1. XOR all revealed user secrets: `seed = secret_1 XOR secret_2 XOR ... XOR secret_n`
2. Mix in post-reveal block entropy: `finalSeed = keccak256(seed, blockhash(revealEndBlock), batchId, n)`

Every participant contributes to the randomness via their secret. The block hash comes from a block produced *after* reveals close, so even the last revealer cannot predict the final seed. The Fisher-Yates algorithm produces a uniformly random permutation. No positional advantage is possible.

**TWAP validation.** The clearing price is checked against the time-weighted average price oracle. Deviations greater than 5% trigger rejection. This prevents oracle manipulation and stale-price exploitation.

### Why Every Attack Vector Fails

| Attack | Why It Fails |
|---|---|
| **Frontrunning** | Orders invisible during commit. Nothing to frontrun. |
| **Sandwich** | Uniform clearing price. No price movement between trades. No spread to capture. |
| **Time-priority** | Fisher-Yates shuffle with unknowable seed. First or last confers zero advantage. |
| **JIT Liquidity** | Clearing price from aggregate supply/demand, not individual pool interactions. |
| **Flash loans** | Same-block interaction check. Cannot commit and act atomically. |
| **Collusion** | Orders hidden during commit prevents coordination. Non-reveals slashed 50%. Block entropy prevents seed manipulation. |

---

## Why CKB Is the Right Substrate

This is where it gets interesting for Nervos.

### The UTXO DEX Problem

Every UTXO-based DEX has the same fundamental constraint: **cell contention**. A liquidity pool is a cell. Only one transaction can consume that cell per block. If 100 users want to swap in the same block, 99 of them fail. This is why account-model chains dominate DeFi — Ethereum's shared state allows concurrent pool access.

The standard UTXO workaround is cell splitting (fragment the pool into many cells) or off-chain aggregation (batch orders off-chain, settle on-chain). Both introduce complexity and trust assumptions.

**VibeSwap's batch auction solves this natively.**

During the 8-second commit phase, users are submitting hashes — not consuming the pool cell. Each commit is an independent cell creation. Zero contention. One hundred users can commit in the same block because they are not competing for the same cell.

During settlement, *one* transaction consumes the pool cell, processes the entire batch, and produces the updated pool cell. One cell consumption per batch, regardless of batch size. The contention bottleneck is eliminated by design.

```
COMMIT PHASE (8s):
User A → creates Commit Cell A    ← independent
User B → creates Commit Cell B    ← independent
User C → creates Commit Cell C    ← independent
  (zero contention — all cells independent)

SETTLEMENT (single tx):
  Consume: Pool Cell + Commit Cells A,B,C
  Produce: Updated Pool Cell + Output Cells A,B,C
  (one pool cell consumption per batch)
```

### Cell Model Advantages

| Concept | Ethereum | CKB |
|---|---|---|
| Commit storage | Contract storage slot (shared state) | Independent commit cells (no contention) |
| Hash verification | `require()` in contract | Type script validation (composable) |
| Temporal enforcement | `block.timestamp` check | Since field in lock script (structural) |
| Batch settlement | Sequential storage updates | Single tx consuming/producing cells |
| Deposit collateral | Token transfer to contract | Lock script with timelock |
| Slashing | Contract calls `transfer()` | Type script enforces cell destruction rules |

The key insight: **CKB's cell model makes the commit phase contention-free by default.** On Ethereum, even the commit phase involves writing to shared contract storage, which means state contention under high load. On CKB, each commit is a new cell with its own lock and type scripts. They exist independently until settlement gathers them.

The temporal enforcement is especially elegant. The reveal deadline is not a `block.timestamp` check in application logic — it is a `Since` constraint in the cell's lock script. The commitment *structurally cannot* be consumed before the reveal phase begins. The temporal guarantee is at the substrate level, not the application level.

### TWAP on CKB

TWAP validation benefits from CKB's explicit state model. Each price observation is a cell with a timestamp and price. The TWAP is computed by reading the last N observation cells. No storage slot iteration. No `mapping` traversal. The indexer provides O(1) access to cells by type script, making TWAP queries efficient regardless of history depth.

---

## The Game Theory

### Honest Participation Is Dominant

A dominant strategy produces the best outcome regardless of what others do. In VibeSwap:

- **Not revealing** (strategic withdrawal): 50% deposit slashed. The 2-second reveal window limits information gain. Expected loss from slashing exceeds expected benefit of selective withdrawal.
- **False commitment** (commit one order, reveal another): Hash mismatch triggers automatic 50% slashing. Benefit: none.
- **Flooding with fake commits**: Each requires a deposit. Unrevealed commits slashed 50%. Attacker pays `n * deposit * 0.5`. Clearing price computed only from revealed orders. Negligible influence.

The deposit-and-slash mechanism is a credible commitment device. Faking is expensive. Honesty is free.

### The 50% Slash Rate

Not arbitrary. It satisfies two constraints:
1. **High enough to deter griefing.** At 1% slashing, an attacker could spam fake commits cheaply.
2. **Low enough to not deter honest users.** At 99% slashing, users would fear losing deposits to network latency during reveal.

At 50%, sustained griefing scales linearly in cost. Honest users who reveal correctly lose nothing.

### Priority Auctions: The Cooperative Valve

Some MEV is not adversarial. Arbitrageurs who correct price discrepancies perform a public service. Liquidators who close undercollateralized positions protect protocol solvency. These actors need execution priority.

Priority bidding accommodates this transparently. The bid revenue flows to the DAO treasury. The critical distinction: priority orders still execute at the uniform clearing price. They gain execution *order* advantage, not *price* advantage. MEV is cooperatively captured, not adversarially extracted.

---

## The Knowledge Primitive

The generalizable insight:

> **MEV elimination requires temporal decoupling of intent from execution.**

Intent expression (what you want to do) and execution (when and how it happens) must occur in separate, non-overlapping time windows. During the intent window, collect commitments without revealing contents. During the execution window, process all commitments simultaneously under uniform rules.

This primitive extends beyond DEXs:

- **Governance voting.** Commit-reveal voting prevents vote-buying and last-minute strategic voting.
- **Resource allocation.** Any system where ordering determines who wins can use temporal decoupling.
- **Cross-chain coordination.** Users on different chains commit to the same batch via LayerZero V2. Cross-chain orders settle alongside local orders at the same uniform clearing price.

Wherever ordering confers advantage, temporal decoupling neutralizes it.

---

## What This Means for Nervos

CKB is not just compatible with commit-reveal batch auctions — it is arguably the *best* substrate for them. The cell model's independent state ownership eliminates the contention problem that plagues every other UTXO DEX. The `Since` field provides structural temporal enforcement. The type script system enables composable verification logic for commit hashing, reveal validation, and settlement execution.

We are building on EVM chains first (where the users are), but the architecture analysis keeps pointing to CKB as the superior substrate. If the Nervos community is interested:

1. **Prototype the commit phase on CKB** — demonstrate zero-contention batch commits using independent cells with type script hash validation
2. **Benchmark cell-model settlement** against EVM storage-model settlement for batches of 10, 100, and 1000 orders
3. **Explore CKB-native optimizations** that are impossible on EVM — such as using the `Since` field for trustless temporal enforcement without any application-layer timestamp checks

The full paper is available: `docs/papers/commit-reveal-batch-auctions.md`

---

## Discussion

Some questions for the community:

1. **Cell contention is the elephant in the room for UTXO DEXs.** Does the batch auction model — where the commit phase produces independent cells and settlement is a single transaction — solve this sufficiently? Are there edge cases we are missing?

2. **The `Since` field for temporal enforcement is elegant but has granularity constraints.** What is the practical minimum batch window on CKB given current block times? Could the 8/2 second split be adapted to CKB's rhythm?

3. **TWAP validation requires price observation cells.** What is the most efficient way to manage a rolling TWAP on CKB — fixed-size observation cell ring buffer, or a different pattern?

4. **Priority bidding creates protocol revenue.** On CKB, how should this revenue flow into the NervosDAO or protocol treasury? Is there a natural integration with CKB's existing economic model?

5. **Cross-chain batches via LayerZero mean CKB users could participate in the same batch as Ethereum users.** What are the practical challenges of cross-chain commit-reveal with CKB's different block time and finality model?

6. **The 50% slashing rate is calibrated for Ethereum gas costs.** Should this parameter differ on CKB where transaction costs are structured differently (state rent vs. gas)?

Looking forward to the discussion.

---

*"Fairness Above All."*
*— P-000, VibeSwap Protocol*

*Full paper: [commit-reveal-batch-auctions.md](https://github.com/wglynn/vibeswap/blob/master/docs/papers/commit-reveal-batch-auctions.md)*
*Code: [github.com/wglynn/vibeswap](https://github.com/wglynn/vibeswap)*
