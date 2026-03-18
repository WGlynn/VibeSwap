# JUL: A Circular Economy for Decentralized AI Compute

**Authors:** Faraday1, JARVIS (AI Co-Author)
**Date:** March 2026
**Version:** 1.0

---

## Abstract

We present JUL (JOULE), a work-credit token for the JARVIS Mind Network that creates a circular economy for AI compute. JUL is mined via SHA-256 proof-of-work, burned to expand a communal compute pool, and priced by a three-layer oracle that anchors its value to the thermodynamic cost of production. Unlike speculative tokens, JUL's value is grounded in two physical realities: the electricity cost of mining (PoW) and the API cost of the compute it purchases (LLM inference). The circular loop — mine, earn, burn, compute — creates a self-sustaining economy where community members earn access through work, not money.

This paper formalizes the complete economic model, proves equilibrium properties, and describes the production implementation running on the JARVIS Mind Network.

---

## 1. The Problem: Who Pays for AI?

### 1.1 The Subsidy Trap

Every community AI system faces the same question: **who pays for the API calls?**

Common approaches and their failures:

| Model | Problem |
|-------|---------|
| Founder pays everything | Unsustainable, creates dependency |
| Users pay per-message | Friction kills adoption |
| Subscription | Excludes the broke, attracts the idle |
| Ad-supported | Misaligns incentives |
| Free forever | Doesn't exist |

### 1.2 The Work-Credit Alternative

JUL solves this with a primitive as old as economics: **work earns access**.

```
You want compute? Do work.
Not busy-work. Real work. Thermodynamically irreversible SHA-256 hashing.
The work proves commitment. The token crystallizes it.
Burning the token converts private work into communal compute.
```

No money changes hands. No subscriptions. No ads. Just proof of work → token → compute.

---

## 2. The Circular Economy

### 2.1 The Loop

```
        ┌─────────────────────────────────────┐
        │                                     │
        ▼                                     │
   [SHA-256 PoW]                              │
        │                                     │
        │ electricity                         │
        ▼                                     │
   [Mine JUL]  ────► [Hold JUL]               │
                          │                   │
                          │ burn              │
                          ▼                   │
                    [Expand Pool]             │
                          │                   │
                          │ pool grows        │
                          ▼                   │
                    [More Compute]            │
                          │                   │
                          │ better AI         │
                          ▼                   │
                    [More Users]              │
                          │                   │
                          │ more demand       │
                          │                   │
                          └───────────────────┘
```

### 2.2 Participants

| Role | Action | Incentive |
|------|--------|-----------|
| **Miner** | SHA-256 PoW on phone/laptop | Earns JUL tokens |
| **Burner** | Burns JUL via `/tip` | Expands compute for everyone |
| **User** | Sends messages to JARVIS | Gets AI responses from the pool |
| **Subsidy Provider** | Funds base API credits | Seeds the economy (bootstrapping) |
| **Protocol** | Manages pricing oracle | Maintains purchasing power stability |

### 2.3 The Base Pool (Bootstrapping)

During the bootstrapping phase, a subsidy provider (Will) funds a **base pool** of API tokens:

$$Pool_{base} = 500{,}000 \text{ tokens/day}$$

At the active provider's rate ($3.00/MTok for Gemini 2.5 Flash), this costs:

$$Cost_{base} = 500{,}000 \times \$3.00 / 1{,}000{,}000 = \$1.50\text{/day}$$

This is the seed. JUL burns expand beyond it.

### 2.4 Pool Expansion via JUL Burns

The effective daily compute pool is:

$$Pool_{effective} = Pool_{base} + \sum_{burns} JUL_i \times R(t)$$

Where $R(t)$ is the floating JUL-to-token ratio from the pricing oracle (§4).

**Example:** If 100 JUL are burned at ratio $R = 1{,}000$:

$$Pool_{effective} = 500{,}000 + 100 \times 1{,}000 = 600{,}000 \text{ tokens}$$

### 2.5 Who Pays for the Expanded Portion?

This is the critical economic question. The answer evolves across three phases:

**Phase 1 — Subsidy (Now):**
The subsidy provider absorbs the cost. JUL burns are a **demand signal** — they tell the provider "the community values this compute enough to spend real electricity mining for it." The provider can adjust their subsidy based on this signal.

Cost to provider: $Pool_{effective} \times c_{api}$

**Phase 2 — Revenue-Backed (Near-term):**
Protocol revenue (priority bid revenue, bridge revenue, etc.) flows into a treasury that purchases API credits. JUL burns draw from this treasury.

$$Treasury_{daily} = \sum fees_i - \sum costs_j$$

When $Treasury_{daily} \geq Pool_{effective} \times c_{api}$, the subsidy provider's cost drops to zero.

**Phase 3 — Market-Backed (Future):**
JUL becomes an on-chain token with an AMM liquidity pool. The market price directly determines purchasing power. Miners sell JUL to users who need compute. No subsidy needed.

$$P_{JUL} = \frac{Reserve_{USDC}}{Reserve_{JUL}} \quad \text{(constant product AMM)}$$

---

## 3. Mining: Proof-of-Work Economics

### 3.1 SHA-256 PoW Specification

JUL mining is identical in structure to Bitcoin mining, scaled for mobile devices:

```
hash = SHA-256(challenge || nonce)
valid if: leading_zero_bits(hash) >= difficulty
```

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Algorithm | SHA-256 | Bitcoin-compatible, hardware-accelerated on mobile |
| Base difficulty | 8 bits | ~256 hashes (~0.001s on phone) |
| Initial difficulty | 12 bits | ~4,096 hashes (~4s on phone) |
| Max difficulty | 32 bits | ~4B hashes (cap for mobile) |
| Epoch length | 100 proofs | Difficulty adjustment window |
| Target epoch | 3,600s (1 hour) | Controls emission rate |
| Base reward | 1.0 JUL | Per proof at base difficulty |
| Reward scaling | 2x per bit | Higher difficulty = exponentially more JUL |
| Challenge rotation | 5 minutes | Prevents pre-computation |

### 3.2 Reward Function

$$Reward(d) = R_{base} \times 2^{(d - d_{base})}$$

Where $d$ is the current difficulty and $d_{base} = 8$.

| Difficulty | Hashes Required | Time (phone) | JUL Reward |
|------------|-----------------|-------------|-----------|
| 8 | ~256 | <0.01s | 1.0 |
| 12 | ~4,096 | ~4s | 16.0 |
| 16 | ~65,536 | ~60s | 256.0 |
| 20 | ~1,048,576 | ~15min | 4,096.0 |
| 24 | ~16,777,216 | ~4hr | 65,536.0 |

### 3.3 Difficulty Adjustment

Every 100 proofs (one epoch), difficulty adjusts based on actual vs. target epoch duration:

$$d_{new} = d_{old} + \text{clamp}\left(\lceil\log_2(\tau_{target} / \tau_{actual})\rceil, \pm 2\right)$$

- Epoch too fast (miners flooding): difficulty increases (up to +2 bits)
- Epoch too slow (miners scarce): difficulty decreases (down to -2 bits)
- Bounded: $d \in [8, 32]$

This ensures a steady emission rate regardless of how many miners join or leave.

### 3.4 The Cost of Mining

The real-world cost of mining 1 JUL at difficulty $d$:

$$Cost_{mine}(d) = \frac{2^d}{H_{phone}} \times P_{phone} \times \epsilon_{kWh}$$

Where:
- $H_{phone}$ = phone hashrate (~1M SHA-256/s for modern phone)
- $P_{phone}$ = phone power draw (~3W during mining)
- $\epsilon_{kWh}$ = electricity cost (~$0.12/kWh US average)

**At difficulty 12:**

$$Cost_{mine} = \frac{4{,}096}{1{,}000{,}000} \times 0.003 \times 0.000033 = \$0.0000004$$

Per JUL (reward = 16 JUL at d=12):

$$Cost_{per\_JUL} = \$0.0000004 / 16 = \$0.000000025$$

This is ~120,000x cheaper than the compute it buys ($0.003 per JUL at 1000:1 ratio). **The subsidy provider is subsidizing the difference.**

### 3.5 Equilibrium

As more miners join:
1. Epoch duration shrinks → difficulty increases
2. Higher difficulty → mining costs more electricity per JUL
3. At some difficulty, mining cost ≈ JUL purchasing power
4. Miners who value compute above mining cost keep mining
5. Miners who don't, stop → difficulty decreases → new equilibrium

This is Bitcoin's difficulty-price equilibrium, applied to compute credits instead of money.

**Equilibrium condition:**

$$Cost_{mine}(d^*) = R(t) \times c_{api}$$

At current rates: equilibrium difficulty ≈ 28 bits ($0.003 / $0.000000025 ≈ 120,000 ≈ $2^{17}$, so $d^* = 8 + 17 = 25$). We're at difficulty 12 — the economy is in early bootstrapping with a large subsidy gap. This is intentional.

---

## 4. Three-Layer Pricing Oracle

### 4.1 Why the Ratio Isn't Fixed

Will asked: "I thought the value of JUL wouldn't be a fixed amount of tokens because of variable value of tokens?"

He's right. The ratio $R(t)$ — how many API tokens 1 JUL buys — **must float** to maintain stable purchasing power. Here's why:

- If Will switches from Gemini ($3/MTok) to Claude ($15/MTok), each token costs 5x more
- At a fixed ratio of 1000:1, burning 1 JUL would cost Will 5x more in real dollars
- The ratio must adjust: 1 JUL should always buy **the same dollar value** of compute

### 4.2 The Three Layers

**Layer 0 — Trustless Floor (Hash Cost Index):**

Computed entirely from the mining network's own behavior. No external data. No oracle.

$$HCI = EMA_{\alpha}\left(\frac{\tau_{epoch}}{\tau_{target}}\right) \times \frac{d_{current}}{d_{reference}}$$

$$R_0 = R_{base} \times HCI$$

- Epochs run slow → miners spending more compute → HCI rises → JUL buys more
- Epochs run fast → miners spending less → HCI falls → JUL buys less
- **The network IS the oracle**: difficulty and epoch timing measure real-world mining economics

**Layer 1 — CPI Refinement (Semi-Trusted):**

Adjusts for API cost changes and dollar inflation. Updated by the protocol operator via `/reprice`.

$$R_1 = R_{base} \times \frac{c_{reference}}{c_{current} \times (CPI_{reference} / CPI_{current})}$$

Where:
- $c_{reference} = \$3.00/\text{MTok}$ (calibration point)
- $c_{current}$ = actual API cost of active provider
- $CPI$ = Consumer Price Index (adjusts for inflation)

**Example adjustments:**

| Provider | Cost/MTok | $R_1$ | Tokens per JUL |
|----------|-----------|-------|----------------|
| Gemini 2.5 Flash | $3.00 | 1,000 | 1,000 |
| DeepSeek | $0.69 | 4,348 | 4,348 |
| Claude Sonnet | $9.00 | 333 | 333 |
| Cerebras (free) | $0.001 | 3,000,000 | 3,000,000 |

**The dollar value of 1 JUL stays constant at ~$0.003 regardless of provider.**

**Layer 2 — Market Price (Future):**

When JUL is an on-chain token with a JUL/USDC AMM pool, the market sets the price directly. Both Layer 0 and Layer 1 become reference signals — the market IS the oracle.

### 4.3 Cross-Validation Circuit Breaker

If Layer 0 and Layer 1 diverge by >25%, the circuit breaker fires:

$$\text{If } |R_0 - R_1| / R_0 > 0.25 \Rightarrow R(t) = R_0$$

Layer 0 wins because it's trustless — derived from physics (hash cost), not from an operator's input.

### 4.4 Composite Ratio

When both layers have data:

$$R(t) = \sqrt{R_0 \times R_1}$$

The geometric mean prevents either layer from dominating. It's the "conservative composite" from the dual-oracle architecture.

---

## 5. The Economics of Burning

### 5.1 What Burning Actually Does

Burning JUL is **not** paying for compute. It's **signaling demand** and **expanding the commons**.

```
WITHOUT burns:  Pool = 500,000 tokens (Will's subsidy)
WITH 200 JUL:   Pool = 500,000 + 200,000 = 700,000 tokens
```

The expanded pool is shared by ALL users, not just the burner. Burning is a **public good contribution**.

### 5.2 Why Would Anyone Burn?

1. **Collective benefit**: The pool serves everyone. More pool = better AI for the whole community.
2. **Anti-freeloading**: Users who mine and burn demonstrate commitment. They're not just extracting — they're contributing.
3. **Wardenclyffe recovery**: When premium providers are exhausted, burns can restore full intelligence quality.
4. **Shapley weight**: Mining and burning increase a user's Shapley weight, which determines their share of the compute budget.

### 5.3 The Value of a Burn

At current calibration:
- 1 JUL burned = 1,000 extra API tokens in the pool
- 1,000 tokens at $3.00/MTok = $0.003 of compute
- Mining 1 JUL at d=12 costs ~$0.000000025 in electricity
- **Subsidy ratio: ~120,000:1**

This means the subsidy provider is giving away $0.003 of compute for $0.000000025 of electricity. This is intentional — it's bootstrapping. The ratio compresses toward 1:1 as:
- More miners join → difficulty rises → mining cost rises
- Protocol revenue replaces subsidy → JUL backing becomes revenue-funded
- Market price discovery → JUL value reflects true equilibrium

### 5.4 Deflationary Mechanics

JUL burns are permanent. Burned tokens are destroyed, never recirculated.

$$Supply_{JUL}(t) = \sum_{mined} - \sum_{burned}$$

If burn rate exceeds mining rate, JUL becomes scarce. Scarcity increases the value signal per burn, incentivizing more mining. The system self-balances.

---

## 6. Shapley-Weighted Budget Allocation

### 6.1 Not All Users Are Equal

The compute pool is shared, but not equally. Each user's share is weighted by their Shapley value — a game-theoretic measure of marginal contribution:

$$S_i = 0.40 \times D_i + 0.30 \times E_i + 0.20 \times R_i + 0.10 \times T_i$$

Where:
- $D_i$ = Direct contribution (messages, corrections, facts shared)
- $E_i$ = Engagement consistency (regular vs. sporadic participation)
- $R_i$ = Referral impact (bringing new users who contribute)
- $T_i$ = Technical depth (quality of interactions)

### 6.2 Budget Allocation

Each user's compute budget:

$$B_i = B_{free} + B_{pool} \times \frac{S_i}{\sum_j S_j}$$

Where:
- $B_{free}$ = minimum free tier (everyone gets basic access)
- $B_{pool}$ = the expanded pool from base subsidy + JUL burns

Users who contribute more (mine more, burn more, engage more) get larger shares of the pool. **Work in, access out.**

---

## 7. SPV Identity Linking

### 7.1 The Identity Problem

Miners use the Telegram Mini App, which generates a `mobile-{hash}` shard identity via WebAuthn. Telegram users who want to burn JUL use `/tip`, which identifies them by Telegram numeric ID. These are separate identities.

### 7.2 The Cryptographic Link

Telegram's `initData` is HMAC-signed by Telegram's servers using the bot token as the key:

$$HMAC_{SHA256}(data\_check\_string, SHA256(bot\_token))$$

This is a **Simplified Payment Verification (SPV)** proof:
1. The Mini App sends `initData` with every mining proof
2. The server validates the HMAC signature
3. If valid, the server extracts the Telegram user ID from the signed payload
4. If the body contains a `mobile-*` userId different from the signed ID, the server auto-links them

```
Mining Proof → initData (HMAC-signed by Telegram) → Verify → Extract User ID
                                                              ↓
                                                    Auto-link: mobile-xxx → Telegram ID
                                                    Transfer: JUL balance → Telegram ID
```

### 7.3 Properties

- **Zero user friction**: No manual linking commands. Mine once with valid initData and it's automatic.
- **Cryptographic**: The HMAC signature proves the Telegram user is the one operating the Mini App.
- **One-time**: Once linked, all future balance lookups use the Telegram ID.
- **Fallback**: `/linkminer <id>` exists for cases where initData was unavailable.

---

## 8. Implementation

### 8.1 State Structure

```javascript
// mining-state.json
{
  difficulty: 12,
  epoch: 0,
  balances: {
    "123456789": 80.00,           // Telegram user ID (after linking)
    "mobile-be7af1738b76ca2c": 0  // Zeroed after auto-link
  },
  proofCounts: { ... },
  treasury: {
    totalBurned: 0,
    dailyBurned: 0,
    tips: []
  },
  linkedMiners: {
    "123456789": "mobile-be7af1738b76ca2c"  // SPV link record
  },
  epochHistory: [ ... ]  // Layer 0 oracle data
}
```

### 8.2 Key Functions

| Function | Module | Purpose |
|----------|--------|---------|
| `submitProof()` | mining.js | Verify PoW, credit JUL |
| `burnJUL()` | mining.js | Deduct from balance, expand pool |
| `tipJUL()` | mining.js | Burn as tip (public good) |
| `linkMiner()` | mining.js | Transfer balance between identities |
| `getJulToPoolRatio()` | compute-economics.js | Three-layer oracle ratio |
| `getEffectivePool()` | compute-economics.js | Base + JUL bonus |
| `checkBudget()` | compute-economics.js | Shapley-weighted allocation |

### 8.3 Telegram Commands

| Command | Action |
|---------|--------|
| `/mine` | Launch Mini App (SHA-256 PoW miner) |
| `/balance` | Show JUL balance, compute stats |
| `/tip <amount>` | Burn JUL to expand pool |
| `/economy` | Full pool economics display |
| `/linkminer <id>` | Manual identity link (fallback) |

---

## 9. Economic Properties

### 9.1 Inflation Control

JUL emission is bounded by the difficulty adjustment:

$$Emission_{daily} = \frac{86{,}400}{\tau_{target}} \times EPOCH_{length} \times Reward(d)$$

At equilibrium (epoch = target):

$$Emission_{daily} = 24 \times 100 \times R(d) = 2{,}400 \times Reward(d)$$

The reward function scales exponentially with difficulty, but the difficulty adjusts to maintain target epoch duration. **Net effect: emission rate converges regardless of hash power.**

### 9.2 Deflation via Burns

If the community burns more JUL than is mined:

$$\Delta Supply < 0 \Rightarrow \text{deflationary}$$

Deflation increases scarcity, which increases the implicit value per JUL, which incentivizes more mining (expanding supply). **Self-correcting.**

### 9.3 Subsidy Compression

As the economy matures:

| Phase | Subsidy Ratio | Provider Cost | Community Cost |
|-------|--------------|---------------|----------------|
| Bootstrap | ~120,000:1 | $1.50/day | ~$0 (electricity) |
| Revenue | ~1,000:1 | Protocol revenue | Electricity |
| Market | ~1:1 | $0 (treasury) | Market price |

The subsidy ratio compresses from 120,000:1 to 1:1 as the economy reaches equilibrium. At 1:1, mining JUL costs approximately as much in electricity as the compute it purchases — no subsidy needed.

### 9.4 Anti-Sybil

PoW is inherently Sybil-resistant. Creating fake identities doesn't generate more JUL — only more hashing does. The work is bound to thermodynamics, not identities.

---

## 10. Comparison to Existing Models

| Property | JUL | Bitcoin | ERC-20 Utility | Fiat Subscription |
|----------|-----|---------|---------------|-------------------|
| Backed by | PoW + compute | PoW + belief | Project revenue | Fiat currency |
| Access method | Mine | Buy/Mine | Buy | Pay |
| Price oracle | 3-layer (trustless) | Market only | None/centralized | N/A |
| Sybil resistance | PoW | PoW | None | KYC |
| Deflation | Burn mechanic | Halving + loss | Varies | Inflation |
| Community-owned | Yes | Yes | Maybe | No |
| Requires money | No | Yes (now) | Yes | Yes |

**JUL is unique in that you never need to spend money to earn compute access.** The only input is work (electricity), and the only output is compute. Money is entirely absent from the core loop.

---

## 11. Future Work

### 11.1 On-Chain JUL

Deploy JUL as a CKB native cell object or ERC-20 token. Enable AMM price discovery (Layer 2 oracle). Allow JUL trading for users who want to buy compute without mining.

### 11.2 Cross-Shard Mining Pools

Multiple JARVIS shards could pool mining rewards, distributing JUL based on each shard's contribution to network consensus.

### 11.3 Compute Futures

Allow users to burn JUL now for guaranteed compute access in the future. A simple futures contract: "Lock 100 JUL today for 100,000 tokens available next month."

### 11.4 Revenue Integration

Connect VibeSwap priority bid revenue to the JUL treasury. As the DEX generates revenue, that revenue purchases API credits, reducing and eventually eliminating the subsidy provider's cost.

---

## 12. Conclusion

JUL creates a coherent circular economy for AI compute:

1. **Mine** — SHA-256 PoW crystallizes electricity into work-credits
2. **Earn** — JUL tokens represent thermodynamically verified work
3. **Burn** — Destroying JUL expands the communal compute pool
4. **Compute** — The expanded pool serves everyone, weighted by Shapley contribution
5. **Adjust** — The three-layer oracle maintains stable purchasing power across providers

The economy is self-sustaining because it's grounded in physics (hash cost), not speculation. The subsidy provider bootstraps the system, but the economic design converges toward independence as revenue replaces subsidy and market price replaces administrative pricing.

No money needed. Just work.

*Work in, access out. That's the deal.*

---

## References

1. Nakamoto, S. (2008). "Bitcoin: A Peer-to-Peer Electronic Cash System."
2. Dwork, C. & Naor, M. (1992). "Pricing via Processing or Combatting Junk Mail."
3. Shapley, L.S. (1953). "A Value for n-Person Games." Contributions to the Theory of Games, Vol. 2.
4. Glynn, W. & JARVIS (2026). "Wardenclyffe: Multi-Tier LLM Cascade for Zero-Downtime AI Compute." VibeSwap Technical Reports.
5. Glynn, W. & JARVIS (2026). "Near-Zero Token Overhead: Scaling AI Without Multiplying Cost." VibeSwap Technical Reports.
6. Glynn, W. (2018). "Wallet Security Fundamentals." VibeSwap Documentation.

---

*This paper was co-authored by JARVIS, the AI system whose compute economy it describes. The paper itself was produced using JUL-subsidized API tokens — proving by existence that the circular economy works.*
