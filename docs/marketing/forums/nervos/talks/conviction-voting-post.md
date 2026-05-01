# Conviction Voting: Governance Where Time Is the Franchise

*Nervos Talks Post -- Faraday1*
*March 2026*

---

## TL;DR

Flash loans broke DeFi governance. Borrow a million tokens, vote, return them in the same block -- governance captured in 12 seconds. Our `ConvictionGovernance.sol` makes this structurally impossible by defining conviction as **stake multiplied by duration**. Your vote weight grows the longer you hold your position. 100 JUL staked for 30 days generates more conviction than 100,000 JUL staked for 1 minute. Dynamic thresholds scale with the size of the funding request -- asking for more from the treasury requires proportionally more conviction. CKB's cell model makes conviction accumulation a natural property of cell state evolution, and `Since`-based temporal enforcement makes the time component unforgeable.

---

## The Flash Loan Governance Attack

Here's how you capture a DAO in one block on Ethereum:

1. Flash-borrow 10M governance tokens from Aave
2. Delegate to yourself
3. Create and vote on a proposal to drain the treasury
4. Execute the proposal (if no timelock) or set up a future execution
5. Return the flash loan
6. Total cost: gas fees (~$50). Total extracted: the entire treasury.

This is not theoretical. Beanstalk lost $182M in April 2022 to exactly this pattern. The attacker borrowed enough STALK tokens via flash loan to achieve a governance supermajority, passed a malicious BIP, and drained the protocol.

The root cause is simple: **vote weight depends only on token balance at the moment of voting**. Time is not a factor. Duration of commitment is irrelevant.

Conviction voting fixes this by making time the primary input.

---

## How Conviction Works

### The Core Formula

Our `ConvictionGovernance.sol` computes conviction using an O(1) pattern borrowed from our `VibeStream` contract:

```
conviction(T) = effectiveT * totalStake - stakeTimeProd
```

Where:
- `effectiveT` = current timestamp (capped at proposal deadline)
- `totalStake` = sum of all staked amounts for this proposal
- `stakeTimeProd` = sum of (amount * signalTime) for each staker

This is mathematically equivalent to summing `(amount_i * duration_i)` for every staker, but computed in O(1) by maintaining running aggregates rather than iterating over staker positions.

**Example**: Alice stakes 100 JUL at time T=0. Bob stakes 50 JUL at T=10.

At T=20:
- totalStake = 150
- stakeTimeProd = (100 * 0) + (50 * 10) = 500
- conviction = 20 * 150 - 500 = 2500

Which matches: Alice's conviction (100 * 20 = 2000) + Bob's conviction (50 * 10 = 500) = 2500.

### Dynamic Thresholds

Not all proposals are equal. Asking for 100 JUL from the treasury is different from asking for 100,000 JUL. The threshold scales:

```
threshold = baseThreshold + (requestedAmount * multiplierBps) / 10000
```

Defaults: baseThreshold = 1000 JUL-seconds, multiplierBps = 100 (1%).

A proposal requesting 10,000 JUL needs: 1000 + (10000 * 100 / 10000) = 1100 JUL-seconds of conviction.

A proposal requesting 1,000,000 JUL needs: 1000 + (1000000 * 100 / 10000) = 11,000 JUL-seconds.

Bigger asks require proportionally more conviction. This is a natural defense against treasury raids -- you can't drain the treasury with a quick proposal because the threshold scales with the request size.

### Flash Loan Immunity

Why can't the attacker from the Beanstalk scenario attack conviction voting?

Flash-borrowed tokens can be staked. But conviction = stake * duration. If you stake 10M tokens for one block (~12 seconds):

```
conviction = 10,000,000 * 12 = 120,000,000 JUL-seconds
```

Meanwhile, 1000 genuine holders staking 100 JUL each for 30 days:

```
conviction = 1000 * 100 * 2,592,000 = 259,200,000,000 JUL-seconds
```

The flash loan generates 0.046% of the community's conviction. The attack is not "expensive" -- it's **structurally negligible**.

---

## The Contract Lifecycle

### 1. Create Proposal

```
createProposal(description, ipfsHash, requestedAmount)
  -> Requires: SoulboundIdentity (Sybil check)
  -> Requires: ReputationOracle tier >= minProposerTier
  -> Requires: requestedAmount > 0
  -> Creates: proposal with ACTIVE state, 30-day default duration
```

Proposals specify how much funding they're requesting from the treasury. The dynamic threshold is computed from this amount.

### 2. Signal Conviction

```
signalConviction(proposalId, amount)
  -> Requires: SoulboundIdentity, proposal ACTIVE, before deadline
  -> Transfers: JUL from staker to contract (actual token lock)
  -> Updates: totalStake, stakeTimeProd (O(1) aggregates)
  -> Records: StakerPosition { amount, signalTime }
```

Tokens are actually transferred into the contract -- not just "delegated." This means the staker gives up liquidity for the duration of their signal. Skin in the game.

One position per staker per proposal (enforced by `AlreadyStaking` check). No position splitting to game the time calculation.

### 3. Remove Signal

```
removeSignal(proposalId)
  -> Updates: totalStake, stakeTimeProd (subtract position)
  -> Returns: staked JUL to sender
  -> Deletes: StakerPosition
```

Stakers can exit at any time, but removing your signal also removes your accumulated conviction from the proposal. There's no "conviction lock" -- you're free to leave, but the proposal loses your support retroactively in the aggregate calculation.

### 4. Trigger Pass

```
triggerPass(proposalId)
  -> Computes: current conviction vs. threshold
  -> If conviction >= threshold: state = PASSED
  -> Permissionless: anyone can call this
```

Any observer can trigger a pass check. If conviction has crossed the threshold, the proposal moves to PASSED state. This is permissionless -- the proposer doesn't need to be the one to notice.

### 5. Execute

```
executeProposal(proposalId)
  -> Requires: state = PASSED, caller is resolver or owner
  -> If bondingCurve is set: allocateWithRebond(requestedAmount, beneficiary)
  -> State: EXECUTED
```

Execution optionally integrates with the Augmented Bonding Curve -- funding comes from the ABC's funding pool, and new tokens are minted for the beneficiary via `allocateWithRebond`. This closes the loop between conviction governance and the protocol's economic engine.

### 6. Expiry

```
expireProposal(proposalId)
  -> Requires: block.timestamp >= startTime + maxDuration
  -> State: EXPIRED
```

Proposals that don't accumulate enough conviction within the max duration (default: 30 days, max: 90 days) expire. Stakers can then reclaim their tokens.

---

## Integration With the Augmented Bonding Curve

This is where conviction voting connects to the broader VibeSwap economic architecture.

When a proposal passes and is executed, funding doesn't come from a static treasury wallet. It comes from the ABC's `fundingPool` -- a reserve generated by exit tributes and minting fees on the bonding curve.

The `allocateWithRebond` function:
1. Takes `requestedAmount` from the funding pool
2. Mints new tokens for the beneficiary along the bonding curve
3. The minting increases the token's reserve, maintaining the curve invariant

This means conviction governance decisions are economically integrated with the protocol's token economics. Funded proposals add value to the bonding curve. The community's conviction literally shapes the protocol's economic trajectory.

---

## Why CKB Is the Right Substrate

### Conviction as Cell State Evolution

On CKB, a staker's conviction position is a cell:

```
Cell {
  data: { amount: 100, signalTime: 1710000000 }
  lock: staker's address
  type: ConvictionGovernance type script
}
```

Conviction accumulates passively as time passes. The cell doesn't need to be "updated" for conviction to grow -- the type script computes conviction from `(currentTime - signalTime) * amount` at verification time. The cell's data is immutable; the passage of time is the only input that changes conviction.

This is fundamentally different from Ethereum, where computing conviction requires reading storage slots and doing arithmetic against `block.timestamp`. On CKB, time is a first-class input to cell verification via the `Since` field and header dependencies.

### Since-Based Temporal Enforcement

CKB's `Since` field provides native guarantees that conviction voting needs:

- **Minimum stake duration**: A conviction cell's lock script can require `Since` >= minimum_duration before the cell can be consumed (signal removed). This prevents staking and immediately unstaking to game the time calculation.
- **Proposal deadlines**: The type script can enforce that no new conviction cells are created after the proposal's deadline, using absolute `Since` values tied to block headers.
- **Expiry enforcement**: After maxDuration, the proposal cell becomes consumable by anyone calling `expireProposal`.

These aren't runtime checks -- they're structural constraints validated at the consensus layer.

### O(1) Conviction via Cell Aggregation

The aggregation pattern (`totalStake`, `stakeTimeProd`) maps to a summary cell that is updated atomically when staker cells are created or consumed. The transaction that creates a new staker cell must also update the summary cell, and the type script validates the aggregate math. All O(1), all verified at the cell level.

| Conviction Concept | Ethereum | CKB |
|---|---|---|
| Stake position | Storage mapping entry | Independent cell |
| Time tracking | `block.timestamp` read | Cell `signalTime` + header deps |
| Conviction computation | View function arithmetic | Type script verification |
| Temporal enforcement | `require()` checks | `Since` constraints (structural) |
| Aggregate state | Contract storage | Summary cell (atomic updates) |

---

## Discussion

Some questions for the community:

1. **Should conviction decay over very long periods?** Our current implementation uses linear accumulation (conviction grows forever while staked). Some conviction voting designs use exponential decay with a half-life. Is indefinite growth a feature (rewards extreme patience) or a bug (entrenches early stakers)?

2. **How should the dynamic threshold be calibrated?** The multiplier determines how much harder it is to pass expensive proposals. Too low and the treasury is vulnerable. Too high and nothing ambitious ever passes. What's the right calibration strategy?

3. **Can CKB header dependencies enable conviction computation without on-chain state updates?** If the type script can read block headers to determine elapsed time, could conviction be computed entirely at verification time without any intermediate state updates?

4. **Is ABC integration the right funding model for conviction governance?** Funding via the bonding curve ties governance outcomes to token economics. Is this alignment beneficial or does it create conflicts of interest?

5. **What happens when conviction voting meets CKB's UTXO concurrency model?** Multiple stakers signaling conviction on the same proposal need to update the same summary cell. How should CKB dApps handle this contention?

---

*"Fairness Above All."*
*-- P-000, VibeSwap Protocol*

*Contract: [ConvictionGovernance.sol](https://github.com/wglynn/vibeswap/blob/master/contracts/mechanism/ConvictionGovernance.sol)*
*Code: [github.com/wglynn/vibeswap](https://github.com/wglynn/vibeswap)*
