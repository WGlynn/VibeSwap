# Clearing Price Convergence: A Formal Proof That Batch Auctions Find the True Price

*Nervos Talks Post — W. Glynn (Faraday1)*
*March 2026*

---

## TL;DR

When people hear "batch auction," the first question is: "How do you know the clearing price is correct?" Fair question. If you are batching all orders and settling them at a single uniform price, you need mathematical certainty that (a) a clearing price always exists, (b) it is unique, (c) the algorithm converges to it, and (d) the error is negligible. We proved all four. The clearing price exists for all valid inputs (intermediate value theorem on monotone step functions). It is unique up to order-price granularity (monotone crossing property). Binary search converges in 41 iterations for typical parameters (logarithmic convergence). The error is less than 10^-12 relative to spot price (effectively zero). And the uniform pricing property — where every order in the batch executes at the same price — makes MEV extraction yield exactly zero expected profit. No approximation. No heuristic. Mathematical proof.

---

## Why This Proof Matters

Batch auctions are the core mechanism behind VibeSwap's MEV elimination. Instead of processing orders sequentially (where ordering determines who profits), we collect all orders during a commit phase, reveal them, and settle the entire batch at a single uniform clearing price.

The mechanism only works if the clearing price is mathematically sound. Three failure modes would break it:

1. **No clearing price exists.** The algorithm fails to find a price. Orders cannot settle. The batch is stuck.
2. **Multiple clearing prices exist.** The algorithm picks one arbitrarily. Different implementations pick different prices. Non-determinism breaks consensus.
3. **The algorithm does not converge.** Iterations run forever or oscillate. The batch times out. Settlement fails.

We need to prove that none of these can happen. Not "probably will not happen." Not "has not happened in testing." Formally proven to be impossible.

---

## The Setup: What Are We Computing?

### Orders

A batch contains buy orders and sell orders:

- **Buy order** (a_i, p_i): "I will pay up to p_i per token for a_i tokens worth"
- **Sell order** (a_j, p_j): "I will sell a_j tokens if the price is at least p_j"

### Demand and Supply

At any candidate price P, we can compute:

**Aggregate demand** — total token1 offered by buyers willing to pay at least P:
```
D(P) = sum of a_i for all buyers where p_i >= P
```

As P increases, fewer buyers are willing to pay. D(P) is a **non-increasing step function** — it goes down (or stays flat) as price goes up.

**Aggregate supply** — total token0 offered by sellers willing to accept at most P:
```
S(P) = sum of a_j for all sellers where p_j <= P
```

As P increases, more sellers are willing to sell. S(P) is a **non-decreasing step function** — it goes up (or stays flat) as price goes up.

Here is an example with 5 buy orders and 4 sell orders:

```
Price    Demand D(P)    Supply S(P)    Net N(P)
$90      500            100            +400  (excess demand)
$95      400            100            +300
$100     300            200            +100
$105     200            350            -150  (excess supply)
$110     100            400            -300
$115     50             400            -350
```

The clearing price is somewhere between $100 and $105 — where net demand transitions from positive to negative.

### AMM Capacity Constraint

There is one additional constraint: the AMM's liquidity limits how much can execute at any price. Given reserves (R0, R1) with constant product k = R0 * R1, the AMM capacity is:

```
C(P) = sqrt(R0 * R1) / (10 * rho(P))
```

where rho(P) = max(P/P_spot, P_spot/P). As price deviates from spot, capacity decreases — the AMM can absorb less volume at extreme prices. This prevents trades from depleting reserves.

### Net Demand

The effective net demand at price P is:

```
N(P) = min(D(P), C(P)) - min(S(P), C(P))
```

The clearing price P* satisfies N(P*) = 0 — demand exactly equals supply, subject to AMM capacity.

---

## Theorem 1: A Clearing Price Always Exists

**Statement:** For any non-empty order sets with positive reserves, there exists a price P* where |N(P*)| is within any desired tolerance.

**Why it is true:**

The argument uses the intermediate value property. Look at the boundary behavior:

- At the **lowest possible price** (P_min = P_spot/2): Demand is maximized (every buyer qualifies) and supply is minimized (fewest sellers qualify). Net demand is positive or zero: N(P_min) >= 0.

- At the **highest possible price** (P_max = 2*P_spot): Demand is minimized (fewest buyers qualify) and supply is maximized (every seller qualifies). Net demand is negative or zero: N(P_max) <= 0.

N starts non-negative and ends non-positive. Since N is a step function that only changes value at the limit prices of individual orders, there must be some interval where N transitions from positive to negative. The clearing price lives in that interval.

The formal proof is more rigorous (handling the step function discontinuities, AMM capacity interactions, and edge cases), but the intuition is straightforward: **demand starts high and supply starts low. As price increases, demand falls and supply rises. They must cross.**

This is true regardless of order composition. Even if all orders are buys (one-sided market), the algorithm converges to P_max and applies Fibonacci-weighted blending with spot price. Even if the batch is empty, the clearing price defaults to spot: P_spot = R1/R0.

---

## Theorem 2: The Clearing Price Is Unique

**Statement:** The clearing price is unique up to an interval of width at most delta, where delta is the minimum distance between any two distinct order limit prices.

**Why it is true:**

Between any two consecutive limit prices, the net demand function N is constant (no orders activate or deactivate in that interval). So:

- If N changes sign between two consecutive prices p_k and p_{k+1}, the clearing price is somewhere in [p_k, p_{k+1}]. Every price in this interval produces the same set of executable orders, so the choice does not matter economically.

- If N passes through zero at exactly one limit price, that price is the unique clearing price.

- If N equals zero on a wider interval, any price in that interval is valid. The binary search deterministically selects the midpoint.

In all cases, the clearing price is determined either exactly or within a narrow interval where the choice is economically irrelevant (same orders execute regardless).

**Why uniqueness matters for CKB:** On CKB, every validator independently verifies the settlement transaction. If the clearing price were ambiguous — if different validators could compute different valid prices — consensus would break. Uniqueness (up to deterministic tie-breaking) ensures that every validator arrives at the same result.

---

## Theorem 3: Binary Search Converges in 41 Iterations

**Statement:** The algorithm converges to within tolerance epsilon in at most ceil(log2((P_max - P_min) / epsilon)) iterations.

**The algorithm:**

```
low = P_min = P_spot / 2
high = P_max = 2 * P_spot
for i in 1..MAX_ITERATIONS:
    mid = (low + high) / 2
    net = compute_net_demand(mid)
    if net > 0:
        low = mid      // excess demand, price must increase
    else:
        high = mid     // excess supply, price must decrease
    if high - low <= CONVERGENCE_THRESHOLD:
        break
return (low + high) / 2
```

Each iteration halves the search interval. The interval width after k iterations is:

```
|I_k| = (P_max - P_min) / 2^k
```

**Invariant:** The true clearing price P* is always inside the current interval. This holds because:
- If N(mid) > 0 (excess demand), the price must increase to balance, so P* is in the upper half
- If N(mid) <= 0 (excess supply), the price must decrease, so P* is in the lower half

For the implementation parameters (P_spot = 10^18 in wei representation, CONVERGENCE_THRESHOLD = 10^6):

```
K = ceil(log2(1.5 * 10^18 / 10^6))
  = ceil(log2(1.5 * 10^12))
  = 41 iterations
```

Well within the MAX_ITERATIONS = 100 bound. The algorithm terminates quickly with room to spare.

**Why 41 iterations matters:** Each iteration evaluates the net demand function once. On-chain, this means iterating over the order arrays once per iteration. For a batch of 100 orders, that is approximately 4,100 order evaluations total. Computationally inexpensive by any standard — and it guarantees convergence to the correct price.

---

## Theorem 4: The Error Is Effectively Zero

**Statement:** The returned clearing price satisfies |P_returned - P*| < 10^-12 relative to P_spot.

In the worst case (100 iterations without convergence threshold):

```
|I_100| = 1.5 * P_spot / 2^100
        = 1.5 * 10^18 / (1.27 * 10^30)
        = 1.18 * 10^-12
```

This is 12 orders of magnitude below the smallest meaningful price unit (1 wei = 10^-18). The error is not just small — it is smaller than the granularity of the number system. For all practical purposes, the clearing price is exact.

Even at 41 iterations (typical convergence), the error is:

```
|I_41| = 1.5 * 10^18 / 2^41 = 682 wei
```

682 wei is approximately $0.000000000000000682 at any sane token price. The price is correct to within a fraction of a fraction of a cent.

---

## Theorem 5: Uniform Pricing Makes MEV Zero

**Statement:** Under commit-reveal batch auction with uniform clearing price, no participant can extract value by observing or reordering other participants' orders.

This is the theorem that ties the math to the mechanism design. We prove it by showing that every MEV strategy yields zero or negative expected profit:

### Sandwich Attack

A sandwich requires: (1) observe a pending order, (2) execute before and after the victim, (3) profit from price difference.

- Condition 1 violated: Orders are committed as hashes. SHA-256 preimage resistance means no participant can determine another's order from the commitment.
- Condition 2 violated: Execution order is determined by Fisher-Yates shuffle seeded by XOR of all user secrets. No participant can predict or control the permutation.
- Condition 3 violated: **All orders execute at the same price.** There is no "before" price and "after" price. There is one price.

Any one of these violations is sufficient. All three are enforced simultaneously.

### Price Manipulation (Round-Trip)

An attacker submits a large buy to inflate the clearing price, then sells at the inflated price.

Under uniform pricing, both the buy and the sell execute at P*. The net profit is:

```
profit = a_sell * P* - a_buy * P* = (a_sell - a_buy) * P*
```

If a_sell = a_buy (round-trip), profit is exactly zero. The attacker bought and sold at the same price. There is no spread to capture because there is no spread — everyone gets P*.

If a_sell != a_buy, the attacker has net directional exposure. That is speculation, not MEV. They are betting on price direction, which is risk-bearing, not extraction.

### Front-Running

Front-running requires knowing what another participant is trading. During commit phase, orders are hidden behind SHA-256 hashes. During reveal, orders are already irrevocably committed — you cannot modify your order after seeing reveals. The information asymmetry that front-running requires does not exist at any point in the protocol's timeline.

---

## Edge Cases: What About Weird Markets?

### One-Sided Market (All Buys, No Sells)

The clearing price converges to P_max. The implementation applies Fibonacci-weighted blending with the spot price at 60% confidence, producing a bounded result that reflects the directional pressure without allowing unlimited price deviation.

### Empty Batch

If no orders exist, the clearing price is simply the spot price: P* = R1/R0. The batch is a no-op. No computation needed.

### AMM Capacity Exhaustion

The capacity constraint ensures reserves are never depleted:

```
C(P_spot) = sqrt(R0 * R1) / 10
```

Maximum executable volume at spot is 10% of the geometric mean of reserves. As price deviates from spot, capacity decreases further. After any batch execution, both reserves remain positive. The AMM cannot be drained by a single batch — not even by a maximally adversarial batch.

Under the TWAP deviation constraint of 5%, the capacity bound further tightens, ensuring reserves stay well within safe ranges.

---

## Summary of Guarantees

| Property | Guarantee | How |
|---|---|---|
| **Existence** | Clearing price always exists | Intermediate value theorem on step functions |
| **Uniqueness** | Unique up to order-price granularity | Monotone demand/supply crossing |
| **Convergence** | 41 iterations typical, 100 max | Binary search with halving intervals |
| **Error bound** | < 10^-12 relative error | 2^-100 interval reduction |
| **MEV resistance** | Zero extractable value | Commit-reveal + uniform pricing |
| **Reserve safety** | No AMM depletion | Capacity constraint via geometric mean |
| **Liveness** | Always terminates | Bounded iterations + convergence threshold |

Every property is mathematically proven, not empirically tested. The clearing price mechanism is correct by construction.

---

## CKB Substrate Analysis

### Deterministic Verification

The clearing price algorithm is pure computation: given a set of orders and AMM reserves, produce a clearing price. No external state reads. No oracle calls. No randomness (the shuffle uses XORed user secrets, but the clearing price computation itself is deterministic given revealed orders).

This is a natural fit for CKB's verification model. The settlement type script does not compute the clearing price — it **verifies** that the claimed clearing price is correct. The settler (miner or aggregator) computes the price off-chain and submits it as witness data. The type script runs the binary search independently and confirms the result matches.

```
Settlement Transaction:
  Inputs:   Auction Cell (with revealed orders), Commit Cells
  Outputs:  Updated Pool Cell, Distribution Cells
  Witness:  claimed_clearing_price, claimed_fills

Type Script Verification:
  1. Reconstruct order sets from input cell data
  2. Run binary search on order sets + current reserves
  3. Verify claimed_clearing_price matches computed price
  4. Verify all fills use the clearing price
  5. Verify reserve updates maintain k = R0 * R1
```

The verification cost (41 iterations of order array scanning) is modest in CKB-VM cycles. For a batch of 100 orders, each iteration scans 100 entries — approximately 4,100 comparisons. Well within CKB-VM's cycle budget for a single transaction.

### Integer Arithmetic Precision

CKB-VM runs on RISC-V with no native floating point. The clearing price computation uses integer arithmetic throughout — prices are represented as fixed-point values with 18 decimal places (matching ERC-20 convention).

The convergence threshold (10^6 = 1,000,000 wei) is chosen specifically for integer arithmetic: it is large enough to avoid rounding artifacts in integer division but small enough to be economically meaningless (far below 1 cent at any sane token price).

Binary search with integer arithmetic requires careful handling of the midpoint computation to avoid overflow:

```
mid = low + (high - low) / 2    // safe: no overflow
// NOT: mid = (low + high) / 2  // unsafe: may overflow
```

This is a well-known pattern, and the implementation handles it correctly. The formal proof accounts for integer truncation in division and shows that the convergence guarantee holds under integer arithmetic — the error may be 1 wei larger than the continuous-math bound, which is negligible.

### Parallel Verification Across Validators

Every CKB validator independently runs the type script verification. Because the binary search is deterministic and uses integer arithmetic, every validator arrives at the same result — bit-for-bit identical. There is no floating-point non-determinism. There is no undefined behavior. Consensus on the clearing price is guaranteed by the determinism of the algorithm and the precision of integer arithmetic.

This is a stronger guarantee than EVM provides. On Ethereum, the clearing price is computed during execution (not verified post-computation), and gas limits may constrain the number of binary search iterations. On CKB, the settler has unlimited off-chain computation budget. The type script only needs to verify, not compute. The verification is bounded (41 iterations), deterministic, and cheap.

### Batch Size Scaling

The binary search evaluates net demand at each iteration, which scans all orders. For a batch of N orders:

- Per-iteration cost: O(N) comparisons
- Total iterations: O(log(P_range/epsilon)) = ~41
- Total cost: O(41N)

For N = 1,000 orders: ~41,000 comparisons. For N = 10,000 orders: ~410,000 comparisons. Both are feasible in CKB-VM. The algorithm scales linearly with batch size and logarithmically with price precision — exactly the scaling profile you want for on-chain verification.

---

## Discussion

Questions for the community:

1. **Binary search on-chain versus off-chain computation with on-chain verification.** The CKB model (verify, do not compute) is natural for batch auction settlement. Has the community explored other algorithms where expensive computation happens off-chain and CKB-VM only verifies the result? This is a general pattern with wide applicability.

2. **Integer arithmetic precision in CKB-VM.** The clearing price uses 18-decimal fixed-point. Has anyone benchmarked 256-bit multiplication and division in CKB-VM? Are there optimized RISC-V libraries for wide integer arithmetic that CKB developers use?

3. **The convergence threshold (10^6 wei) balances precision against gas/cycle cost.** On CKB, cycle costs are different from EVM gas. Should the threshold be tuned differently for CKB-VM? What is the marginal cycle cost of additional binary search iterations?

4. **AMM capacity constraint uses sqrt(R0 * R1).** Integer square root on large values (10^36+) in CKB-VM — what is the best approach? Newton's method? Lookup tables? Has anyone optimized integer sqrt for RISC-V?

5. **The proof assumes orders are correctly revealed (hash matches commitment).** On CKB, the reveal verification happens in the commit-type script. The clearing price computation happens in the settlement-type script. How should these two type scripts interact? Cell deps? Shared data in witness?

6. **Formal verification of the binary search implementation.** The proof is hand-written mathematical proof. Has the CKB community explored formal verification tools (Coq, Lean, etc.) for type script correctness? Formally verifying the clearing price algorithm would provide the strongest possible guarantee.

The full paper with complete proofs, lemmas, and edge case analysis: `docs/papers/clearing-price-convergence-proof.md`

---

*"Fairness Above All."*
*— P-000, VibeSwap Protocol*

*Full paper: [clearing-price-convergence-proof.md](https://github.com/wglynn/vibeswap/blob/master/docs/papers/clearing-price-convergence-proof.md)*
*Code: [github.com/wglynn/vibeswap](https://github.com/wglynn/vibeswap)*
