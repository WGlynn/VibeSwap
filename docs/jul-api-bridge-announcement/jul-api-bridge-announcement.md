# JUL: A Work-Credit System for Community-Owned AI

**Compute access earned through work, not purchased with credit cards**

---

## The Problem

JARVIS — the AI that powers our community — runs on API credits. Someone has to pay for those credits. Right now, that someone is Will, out of pocket, every month.

Meanwhile, community members mine JUL tokens through SHA-256 proof-of-work. They grind hashes, earn tokens, and those tokens sit in a balance doing nothing. Two systems running side by side, disconnected:

- **Mining engine**: you do work, you earn JUL
- **Compute engine**: Will pays Anthropic, JARVIS allocates budgets via Shapley game theory

The JUL → API Access Bridge connects them.

---

## How It Works

JUL is not a currency. It's a **work-credit**. You can't buy it. You can't trade it on an exchange. The only way to get JUL is to do the work — submit valid SHA-256 proofs that meet the difficulty target. That work is the backing.

When you **burn** JUL, you convert that stored work into API access:

```
Do the work (mine) → Earn JUL → Burn JUL → Get compute access
      ↑                                          |
      └─── JARVIS is useful ← more people join ──┘
```

That's the closed loop. No AMM pool. No crypto exchange. No converting to USD. **Work in, access out.**

### The Pool Expansion

Every JUL burned doesn't just benefit the burner — it expands the compute pool for the entire community:

```
Effective Pool = Base Pool + (Daily JUL Burned × Floating Ratio)
```

- **Base Pool** (500,000 tokens/day) — Will's subsidy. The floor that exists no matter what. His contribution to the cooperative.
- **Floating Ratio** — CPI-adjusted so 1 JUL always buys the same real value of compute. Currently ~1,000 tokens per JUL at reference prices, but automatically adjusts when API costs or purchasing power change.
- **JUL Bonus** — community-generated expansion. The more JUL burned, the bigger the pool for everyone.

The expanded pool gets redistributed through [Shapley value allocation](https://en.wikipedia.org/wiki/Shapley_value) — a game theory mechanism that rewards each person proportionally to their marginal contribution. Quality contributors get more. But when the pie grows, everyone's slice grows too.

### Three Burn Paths

**1. Tipping** (`/tip <amount>`)
Voluntarily burn JUL to expand the pool. You're saying: *"I earned this through work, and I'm putting it back."* The entire community benefits.

**2. Auto-burn on exhaustion**
When your free + Shapley budget runs out but you still have JUL, the system can burn JUL for extra API access. Pay-as-you-go, beyond the free tier. No one gets cut off if they've done the work.

**3. Future: on-chain governance burns**
When VibeSwap hits mainnet, protocol-level burns tied to on-chain actions. JUL and the on-chain token economy converge.

---

## "But Who Actually Pays Anthropic?"

Will does. Let's be honest about that.

JUL burning doesn't magically generate USD. What it does is create a **transparent demand signal**. The daily burn rate tells Will exactly how much compute the community needs. Instead of guessing, he sees a number: *X JUL burned today = X × 1000 tokens of demonstrated demand.*

This is better than the alternative (unlimited free access until the credit card melts) because:

- **Burn rate = real demand**, backed by proof-of-work. You can't fake it.
- **Will's subsidy shrinks in relative importance** as community burn volume grows.
- **The burn ledger is the receipts** — transparent, auditable, unfakeable proof that the community is doing work and consuming compute proportionally.

Over time, the path to full self-sustainability looks like:

1. **Today**: Will subsidizes the base pool. JUL burn signals demand. Closed loop on work-credits.
2. **Near-term**: Burn volume data supports grant applications and sponsorship conversations. "Here's how much compute our community uses, backed by verifiable proof-of-work."
3. **Mainnet**: JUL goes on-chain with VibeSwap. AMM pools, real liquidity, real exchange value. The community can directly fund its own compute.
4. **Endgame**: Anthropic (or whoever) accepts JUL natively. Work-credits become the universal API payment.

We're not pretending step 4 is today. But step 1 is already a closed loop — closed on **work**, not money.

---

## Why Work-Credits, Not a Token Sale

We could have launched JUL on Uniswap. Sold tokens. Let speculators bid up the price. Used the proceeds to pay for API credits.

We didn't, because that breaks the philosophy.

VibeSwap is built on **Cooperative Capitalism** — mutualized risk with free-market competition. A token sale would mean:

- People who buy tokens get access. People who can't afford them don't.
- Speculators accumulate tokens without contributing anything.
- The value of JUL gets decoupled from the work it represents.

Work-credits fix all three:

- **Access is earned, not purchased.** You mine, you contribute, you get compute.
- **No speculation.** JUL has no market price. It has a burn rate pegged to real purchasing power — the token count floats so 1 JUL always buys the same CPI-adjusted value of compute, regardless of API price changes or dollar inflation.
- **Value = work.** Every JUL in existence was created by a valid SHA-256 proof. The token IS the work.

This is the same principle behind VibeSwap's on-chain mechanism: commit-reveal batch auctions where every participant's order is backed by a deposit, shuffled fairly, and settled at a uniform clearing price. No front-running. No information asymmetry. No extraction.

JUL mining is the commit (proof-of-work). Burning is the reveal (demonstrated demand). Shapley allocation is the settlement (fair distribution). Same game theory, different substrate.

---

## The Treasury

All burned JUL flows into the **JUL Treasury** — a transparent ledger tracking:

- **Total burned** (all-time) — cumulative work the community has reinvested
- **Daily burned** — today's contribution to pool expansion
- **Tip records** — who burned, how much, when

Nothing is hidden. The treasury is the community's proof that their work has value beyond a number on a leaderboard. It's also the data that makes the case for external funding: *"This community burns X JUL per day. That's Y hours of proof-of-work. Here's the compute demand it represents."*

---

## What This Means For You

### If You Mine

Your JUL now has a use case. Mining isn't just earning points — it's earning the fuel that powers JARVIS. Every hash you compute creates real value that converts into real compute access. For yourself when you need it, for everyone when you tip it.

### If You Contribute (Ideas, Code, Governance)

The Shapley pool — the budget that rewards your contributions — is no longer a fixed number. When miners burn JUL, your share of the expanded pool grows too. Mining and contributing are complementary. The miner who tips expands your budget. The contributor whose ideas attract miners expands theirs.

### If You're New

There's a free tier. You don't need JUL to talk to JARVIS. But if you want more access, the path is clear: mine, earn, burn. No credit card required. Just work.

---

## Floor/Ceiling Convergence: How JUL Stays Stable

JUL is backed by fixed PoW work (production theory of value), but API tokens change in value as models get cheaper or the dollar loses purchasing power. A fixed ratio would create arbitrage — hoard JUL when tokens are expensive, burn when they're cheap.

The solution is a three-layer pricing oracle inspired by the [Trinomial Stability Theorem](https://github.com/WGlynn/VibeSwap/blob/master/docs/TRINOMIAL_STABILITY_THEOREM/TRINOMIAL_STABILITY_THEOREM.md):

> *The production theory of value (energy-backed) gives you the floor. The time adjustments (CPI) keep that floor honest across history. The market gives you the ceiling — what people actually think it's worth in practice. Floor and ceiling converge → price stability.*

### Layer 0: The Trustless Floor (No Oracle Needed)

The mining network measures its own production cost. No external data feed. No trusted third party. The network IS the oracle.

Every mining epoch (100 proofs, target: 1 hour), the system records how long it actually took. This is a direct measurement of real-world mining economics:

- **Epoch runs fast**: miners spending more compute → energy is cheap, hardware plentiful → deflationary signal
- **Epoch runs slow**: miners pulled back → energy expensive, hardware scarce → inflationary signal

The hash cost index — an exponential moving average of epoch efficiency weighted by difficulty trend — captures the real-world cost of computational work without trusting anyone. From the Trinomial theorem: *"price converges to ε₀ — the cost of a single hash in electricity."* Layer 0 measures ε₀ directly.

This is why hash cost is a *better* economic indicator than CPI for compute pricing. CPI tracks milk and housing. Hash cost tracks exactly what we care about: **what does it cost, in real-world resources, to produce one unit of computational work?**

### Layer 1: CPI Refinement (Semi-Trusted, Optional)

The hash cost floor is trustless but coarse. Layer 1 adds precision: API pricing from Anthropic and CPI data for dollar-inflation adjustment. Will updates these via `/reprice` when pricing changes.

But Layer 1 is constrained by Layer 0. The dual-oracle architecture from the Trinomial theorem: *"each oracle constrains the other. If one feed were compromised or manipulated, the other provides an independent physical-reality anchor."*

If Layer 1 diverges more than 25% from Layer 0, the **circuit breaker** fires and Layer 0 wins. You can manipulate a CPI number. You can't manipulate the mining network's own epoch behavior.

### Layer 2: The Market Ceiling (Future)

When JUL goes on-chain with VibeSwap mainnet, AMM price discovery replaces both layers. The JUL/USDC pool price IS the purchasing power signal. The market discovers what people actually think JUL is worth — and that price converges toward the production floor over time (miners won't sell below cost, buyers won't pay unbounded premiums for a commodity).

Floor and ceiling converge. Volatility bound: the variance of global electricity costs (~2-5% annually, per the Trinomial theorem). That's the lowest achievable bound for proof-of-work money.

### The Formula

```
Layer 0 ratio = baseRatio × hashCostIndex       (trustless)
Layer 1 ratio = baseRatio × (refCost / realCost) (CPI-adjusted)

Final ratio = geometric_mean(Layer0, Layer1)
              unless divergence > 25% → Layer 0 wins

hashCostIndex = EMA(epochDuration / target) × (difficulty / refDifficulty)
realCost = nominalCost × (referenceCPI / currentCPI)
```

If API gets cheaper: both layers increase the ratio. If dollar inflates: Layer 1 compensates. If mining gets harder: Layer 0 increases the ratio. If someone feeds bad CPI data: circuit breaker fires, hash cost wins.

**No arbitrage. Work in = value out. Always.**

## The Numbers

| Parameter | Value | Why |
|-----------|-------|-----|
| Base pool | 500,000 tokens/day | Will's baseline subsidy |
| Base ratio | 1,000 tokens/JUL | At reference prices (calibration point) |
| Layer 0 | Hash cost from epoch behavior | Trustless, oracle-free, always-on |
| Layer 1 | CPI + API cost | Fine-tuning, circuit-breakered |
| Layer 2 | AMM price (future) | Market replaces all oracles |
| Circuit breaker | 25% divergence | Layer 0 overrides Layer 1 |
| Mining reward | 1 JUL base (2× per difficulty bit) | 256 expected hashes per JUL, always |

---

## Commands

| Command | What It Does |
|---------|-------------|
| `/mining` | Start mining JUL |
| `/balance` | Your JUL balance + current ratio + pool contribution stats |
| `/tip <amount>` | Burn JUL to expand the compute pool for everyone |
| `/tip` | View balance, tip history, and how the loop works |
| `/economy` | Pricing oracle, pool breakdown, treasury, burn metrics |
| `/reprice` | (Owner) Update API cost or CPI index — ratio recalculates |

---

## Try It

1. `/mining` — start earning JUL through proof-of-work
2. `/balance` — see what you've earned
3. `/tip 1` — burn 1 JUL, expand the pool by 1,000 tokens
4. `/economy` — watch the pool grow

Every JUL you burn makes JARVIS stronger for everyone. Not because of money. Because of work.

---

*This is how a community funds its own AI — not with credit cards, but with proof of work. The loop is closed. The treasury is transparent. The access is earned.*

*— Will & JARVIS*
