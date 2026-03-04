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
Effective Pool = Base Pool + (Daily JUL Burned × 1000)
```

- **Base Pool** (500,000 tokens/day) — Will's subsidy. The floor that exists no matter what. His contribution to the cooperative.
- **JUL Bonus** — community-generated expansion. 1 JUL burned = 1,000 extra API tokens available to everyone.

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
- **No speculation.** JUL has no market price. It has a burn rate — 1 JUL = 1,000 API tokens, always.
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

## The Numbers

| Parameter | Value | Why |
|-----------|-------|-----|
| Base pool | 500,000 tokens/day | Will's baseline subsidy |
| Burn ratio | 1 JUL = 1,000 API tokens | Matches mining reward ratio |
| Mining reward | 1 JUL base (doubles per difficulty bit) | Harder work = more tokens |
| Auto-burn rate | 1 JUL = 1,000 tokens | Same ratio — no premium for generosity |

The ratio is intentionally symmetric. Tipping (expanding the pool for everyone) and auto-burning (buying extra for yourself) use the same rate. There's no penalty for being generous.

---

## Commands

| Command | What It Does |
|---------|-------------|
| `/mining` | Start mining JUL |
| `/balance` | Your JUL balance + pool contribution stats + effective pool size |
| `/tip <amount>` | Burn JUL to expand the compute pool for everyone |
| `/tip` | View balance, tip history, and how the loop works |
| `/economy` | Network-wide compute economics, JUL burn metrics, effective pool |

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
