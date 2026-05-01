# True Price Oracle — Deep Dive

**Status**: Pedagogical implementation deep-dive.
**Audience**: Engineers, auditors, curious students. First-encounter with oracle design is OK.
**Related**: [Kalman Filter Oracle](./KALMAN_FILTER_ORACLE.md), [True Price Oracle](./TRUE_PRICE_ORACLE.md), [GEV Resistance](./GEV_RESISTANCE.md).

---

## The problem an oracle solves

An AMM (automated market maker) needs to know prices. The simple approach: let trades set the price. When someone buys ETH for USDC, the price goes up; when someone sells, it goes down. Simple.

But there's a problem: what if there's only one trader? They could buy a tiny bit, set a silly price, then exploit the silly price. This is price manipulation.

**Concrete example**: Alice notices the pool has low liquidity. She deposits $100,000 of USDC and withdraws ETH at current price of $2000. She then executes a large trade that pushes the price to $3000. She sells her ETH back at $3000 and withdraws $150,000 — $50k profit from price manipulation.

This is an attack. An oracle is the defense: instead of trusting immediate price, the AMM consults an external price feed that reflects broader market reality.

## What a "true price" is

In crypto, "true price" means the actual market-clearing price across many exchanges and trading venues, weighted by their liquidity and reliability. If ETH trades at $2,000 on Coinbase, $1,995 on Binance, $2,010 on Kraken, the "true price" is somewhere around $2,002 (liquidity-weighted average).

Not a single exchange's price. Not a recent trade. The consensus price.

VibeSwap's True Price Oracle (TPO) aggregates these sources and maintains a continuously-updated "true price" that contracts can query.

## The old design — centralized oracle + deviation gate

Original TPO design (pre-C39):

1. A trusted operator pulls prices from N exchanges.
2. Operator computes the consensus (Kalman-filtered average).
3. Operator signs the result with their cryptographic key.
4. Smart contracts verify the signature and use the price.

To prevent operator misbehavior, a "deviation gate" was added: if the new price differs from the previous by more than 5%, the update is rejected. Operator can't push wildly-different prices without challenge.

**Concrete attack scenario this blocks**: if the operator is compromised and tries to push a $50,000 ETH price (vs. real $2,000), the deviation gate rejects the $50k price because it's >5% off from the previous. Manipulation blocked.

**What the deviation gate doesn't block**: slow drift. If the operator pushes 4% deviations repeatedly (within the gate), they can drift the price over time. Not a sharp manipulation but still a problem.

## The new design — commit-reveal oracle aggregation (C39 FAT-AUDIT-2)

The C39 redesign replaces the deviation gate with a structurally-stronger mechanism: commit-reveal aggregation across multiple operators.

How it works:

1. **Commitment phase**: Operators submit `hash(price || secret)` to the aggregator. The actual price is hidden but committed.
2. **Reveal phase**: Operators submit `(price, secret)` matching their commitments. Contract verifies `hash(price || secret) == stored_commitment`.
3. **Aggregation**: After reveal window closes, contract computes the aggregate price from all revealed values (median, weighted average, etc.).
4. **Publication**: The aggregate price is published; AMM contracts use it.

**Why this is better**:

- **No single operator can bias the outcome**. Operators' prices are committed before they see others'; they can't strategically match to manipulate.
- **Collusion resistance**: for operators to coordinate, they'd need to pre-coordinate both their commitments AND their reveals — expensive coordination required.
- **Structural fairness**: the aggregation math is public and deterministic; any observer can verify the published price matches the reveals.
- **No deviation gate needed**: the structural design prevents manipulation without arbitrary percentage limits.

## Walking through a concrete scenario

Let's trace what happens when VibeSwap needs to know ETH's price.

### Step 1 — Operators watch exchanges

Alice, Bob, and Carol are operators. Each watches Binance, Coinbase, Kraken, and other exchanges. At time T, all three see ETH trading around $2,000.

### Step 2 — Commitment phase

Each operator computes their "best estimate" of ETH price:
- Alice: $2,001 (she weights her sources slightly differently).
- Bob: $1,999.
- Carol: $2,002.

Each chooses a random secret (let's say 10-byte random number each).

Each submits `hash(price || secret)`:
- Alice submits `hash(2001 || aliceSecret) = 0x123abc...`
- Bob submits `hash(1999 || bobSecret) = 0x456def...`
- Carol submits `hash(2002 || carolSecret) = 0x789ghi...`

The chain records these commitments. Anyone can see the hashes, but nobody can figure out the prices from hashes alone.

### Step 3 — Reveal phase

After the commitment window closes (let's say 10 minutes later), the reveal window opens:

Alice reveals: `(2001, aliceSecret)`. Contract verifies hash matches. ✓
Bob reveals: `(1999, bobSecret)`. Contract verifies. ✓
Carol reveals: `(2002, carolSecret)`. Contract verifies. ✓

All three prices are now public and cryptographically anchored to their commitments.

### Step 4 — Aggregation

The contract computes the aggregate:
- Median: 2001 (middle of 1999, 2001, 2002).
- Mean: (2001 + 1999 + 2002) / 3 = 2000.67.
- Weighted mean (if operators have different weights): similar but adjusted.

VibeSwap uses median by default (robust to outliers).

### Step 5 — Publication

The aggregate price ($2001) is published. AMM contracts can now query `TPO.getPrice()` and get $2001.

## Why this defeats manipulation

**Single-operator manipulation**: impossible. Alice alone can't change the aggregate; her reveal is one of three.

**Coordinated manipulation**: requires pre-coordination before the commitment phase, which is costly and detectable. Operators who repeatedly collude face slashing.

**Last-mover advantage**: removed. Without commit-reveal, a operator seeing others' prices could strategically set theirs to bias the aggregate. With commit-reveal, their commitment is locked before they see others.

**Operator corruption**: bounded. A compromised operator can only bias their single vote; the aggregate absorbs it via median/average.

## What could still go wrong

Honest enumeration:

### Problem 1 — All operators are corrupted

If every operator is compromised, they can coordinate to push whatever price they want. Defense: diverse operator set (different jurisdictions, different organizations, different incentive structures), stake-and-slash, rotating operator selection.

### Problem 2 — Operator attrition

If too many operators become unavailable (crash, leave), the reveal phase can't complete. Defense: require minimum reveal threshold (e.g., at least 2 of 3); graceful degradation to fewer operators for one round.

### Problem 3 — Slow price movements

Prices change over time. A 10-minute commitment+reveal cycle means the published price is always 10+ minutes behind the actual market. This is the oracle-lag problem, unavoidable with any oracle.

Defense: use TWAP (time-weighted average price) over the lag window to reduce manipulation-via-lag; accept some price-update latency.

### Problem 4 — Oracle frontrunning

An attacker sees the new price coming (via mempool monitoring) and front-runs trades in the AMM before the price update lands. This is mitigated by the AMM's own commit-reveal batch auction ([`CommitRevealAuction.sol`](../contracts/core/CommitRevealAuction.sol)).

## The interaction with other mechanisms

TPO feeds into:
- **VibeAMM**: uses TPO price to validate trades aren't too far from true price.
- **TWAP validation**: AMM compares TPO price to recent trade prices; large deviations trigger circuit breakers.
- **Circuit breakers**: if TPO reports wildly inconsistent prices, trading pauses.

TPO reads from:
- **External exchange APIs**: Binance, Coinbase, Kraken, etc. Each operator aggregates their own.
- **Backup feeds**: Chainlink, Pyth, etc. as failsafe.

## Gas optimization

On-chain commit-reveal costs gas:
- Commitment: 1 storage slot per operator, ~20K gas each.
- Reveal: verification + storage update, ~40K gas each.
- Aggregation: median or average computation, ~10K gas.

Per price update: ~150K gas for 3 operators. At $20/M gas, that's ~$3/update. Tolerable for frequent updates.

Batch updates: aggregate multiple price feeds in a single commit-reveal cycle. Amortizes gas across assets.

## Why the C39 design is an ETM-alignment win

The original deviation gate used a fixed percentage (5%) which is a arbitrary number. Arbitrary numbers rarely match substrate geometry ([Substrate-Geometry Match](./SUBSTRATE_GEOMETRY_MATCH.md) principle).

The commit-reveal design has no arbitrary numbers. Manipulation resistance comes from the protocol structure itself — operators can't bias because the protocol structurally prevents bias. Cleaner, more defensible, matches the substrate's geometry (markets are commitment-based, commit-reveal mirrors that).

Classified as ETM MIRRORS in the [ETM Alignment Audit](./ETM_ALIGNMENT_AUDIT.md).

## How to read the actual code

For engineers who want to inspect:

- **`contracts/oracle/OracleAggregationCRA.sol`** — the new commit-reveal aggregator.
- **`contracts/oracle/interfaces/IOracleAggregationCRA.sol`** — the interface.
- **`contracts/oracle/TruePriceOracle.sol`** — existing TPO with `pullFromAggregator` wired in.
- **`test/oracles/OracleAggregationCRA.t.sol`** — 17 tests covering the commit-reveal flow, aggregation, failure modes.

Reading order for study:
1. Start with the interface (`IOracleAggregationCRA.sol`) to see the public API.
2. Read the struct definitions in the interface.
3. Read the implementation; trace `commitPrice` → `revealPrice` → `aggregate` → `publish`.
4. Run the tests (`forge test --match-contract OracleAggregationCRA`) to verify behavior.

## For students

Suggested exercise: design a commit-reveal mechanism for a different domain (e.g., predicting election outcomes, rating restaurants, evaluating pull requests). Apply the same principles:
- Commitment phase hides the claim.
- Reveal phase verifies the commitment.
- Aggregation is structural, not discretionary.
- No arbitrary thresholds.

Compare your design to VibeSwap's TPO. Where does yours differ? What tradeoffs did you make?

## The bigger lesson

Oracle design has general lessons for any system that aggregates multiple sources:

1. **Don't trust one source.** Aggregate multiple.
2. **Don't let sources see each others' inputs before committing.** Commit-reveal.
3. **Don't add arbitrary thresholds.** Structural design.
4. **Don't assume honest operators.** Design for cartel-resistance.

These lessons apply to voting, attestation, data integrity, audit — anywhere you need trustworthy aggregation. The oracle is one concrete instance.

## One-line summary

*True Price Oracle post-C39 uses commit-reveal aggregation across multiple operators — no single operator can manipulate because commitments are locked before any reveal. Replaces the arbitrary 5% deviation gate with structural fairness. Pedagogical walk-through: Alice/Bob/Carol example shows how commitment-hashing and reveal-verification compose to prevent last-mover advantage.*
