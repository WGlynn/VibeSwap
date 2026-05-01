# How VIBE Emission Works — Simple Explainer

**For community members, contributors, and anyone curious about how VIBE tokens come into existence.**

---

## The Basics

VIBE is the governance and reward token of VibeSwap. There will only ever be **21 million VIBE** — same as Bitcoin's 21 million BTC. No more can ever be created.

**Nobody starts with any VIBE.** There is no pre-mine. No team allocation. No investor deal. Every single VIBE is earned through contributing to the protocol.

---

## How New VIBE Is Created

New VIBE is minted by a smart contract called the **EmissionController**. It works like a faucet that drips VIBE at a predictable rate, slowing down over time.

### The Emission Rate

- **Year 1:** ~10.5 million VIBE (half the supply)
- **Year 2:** ~5.25 million VIBE (rate halves)
- **Year 3:** ~2.625 million VIBE (halves again)
- **Year 4:** ~1.3 million VIBE
- **Year 5+:** Keeps halving every year until practically zero

This is the same halving concept as Bitcoin. Early participants earn more. The schedule is transparent, immutable, and verifiable on-chain.

### Anyone Can Drip

The `drip()` function can be called by **anyone**. You don't need permission. When you call it, any VIBE that has accrued since the last drip gets minted and distributed. If nobody calls drip for a week, the next person who calls it gets a week's worth of emissions minted and distributed.

---

## Where New VIBE Goes

Every VIBE minted gets split three ways:

### 1. Contribution Rewards (50%)

Half of all emissions go into a **Shapley Accumulation Pool**. This pool grows over time and gets drained when contribution games are created. A contribution game rewards people based on what they actually contributed — not just how long they were around.

**How it works:**
- VIBE accumulates in the pool
- An authorized game creator drains a portion (max 50% per game)
- Contributors earn based on their Shapley value (a game theory concept that measures marginal contribution)
- Rewards are immediately claimable

**The longer between games, the bigger the pool, the bigger the rewards.** This creates natural incentive waves — build, contribute, then claim.

### 2. Liquidity Mining (35%)

35% goes directly to the **Liquidity Gauge** — a contract that rewards people for providing liquidity to VibeSwap's trading pools. If you provide liquidity (help the DEX have enough tokens for traders), you earn VIBE.

Governance decides which pools get what share of these rewards by voting on gauge weights.

### 3. Governance Staking (15%)

15% goes to **governance stakers** — people who lock their VIBE tokens to participate in protocol governance. Stake VIBE, earn more VIBE. This creates a flywheel: contribute to earn VIBE, stake VIBE to govern, govern to improve the protocol, earn more VIBE.

---

## Why No Team Allocation?

Bitcoin didn't have team allocations. Satoshi mined like everyone else. We follow the same principle.

When teams have pre-mined tokens, their incentive is to pump the price and sell. When teams earn by contributing, their incentive is to build. We want builders, not dumpers.

The founding team earns VIBE through the same Shapley games as everyone else. Same rules. Same mechanism. No special treatment.

---

## The Drain Minimum — Scaling With Price

The minimum amount that can be drained from the pool is set as a **percentage** (default 1%), not a fixed number. Here's why:

If VIBE is worth $1 and the minimum is 100 VIBE ($100) — that's fine. But if VIBE goes to $10,000 per token, 100 VIBE = $1,000,000 minimum — way too high.

By using a percentage, the minimum scales automatically:
- Pool of 10,000 VIBE → min drain is 100 VIBE
- Pool of 100 VIBE → min drain is 1 VIBE

No matter what VIBE is worth, the minimum is always 1% of the pool. No oracle needed. No trusted third party. Just math.

---

## Timeline

```
Genesis  ─────── Year 1 ─────── Year 2 ─────── Year 3 ─────── Year 4 ───── ...
         10.5M VIBE      5.25M VIBE     2.625M VIBE    1.3M VIBE

         ████████████████ ████████ ████ ██
         50% of supply    25%      12.5% 6.25%          ... → 21M total
```

By year 4, almost 94% of all VIBE will have been emitted. By year 10, over 99.9%. The protocol's incentive structure front-loads rewards for early contributors while maintaining a long tail for sustainability.

---

## Summary

| Feature | Detail |
|---------|--------|
| Max Supply | 21,000,000 VIBE |
| Pre-mine | Zero |
| Team Allocation | Zero |
| Halving Period | Every year (365.25 days) |
| Year 1 Emission | ~10.5 million VIBE |
| Distribution | 50% contribution / 35% LP / 15% staking |
| Who Can Mint | EmissionController only (permissionless drip) |
| Drain Minimum | 1% of pool (scales with price) |

---

*VIBE: every token earned, never given.*
