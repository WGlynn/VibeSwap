# Mechanism Insulation: Why Fees and Governance Must Be Separate

## Executive Summary

VibeSwap separates exchange fees (100% to LPs) from governance/arbitration rewards (token emissions). This document explains why these mechanisms must remain insulated to prevent game-breaking exploits.

---

## The Two Mechanisms

### Exchange Fees → LPs (100%)
- **Direct incentive**: provide liquidity, earn proportional to volume
- Simple, measurable, predictable returns
- LPs can calculate expected yield and commit capital accordingly

### Token Rewards → Governance/Arbitration
- Shapley value distribution rewards contribution to protocol health
- Arbitrators, sybil hunters, governance participants earn tokens
- Token value depends on long-term protocol success, not short-term volume

---

## Game-Breaking Scenarios If Combined

### 1. Conflict of Interest

If arbitrators were paid from trading fees:
- Incentive to rule in favor of high-volume traders (they generate more fees)
- Incentive to maximize disputes (more work = more pay from pool)
- Incentive to *not* ban bad actors if they trade a lot

### 2. Capture Attack

```
Attacker strategy:
1. Become large LP (earn fees)
2. Become arbitrator (paid from same pool you contribute to)
3. Rule in your own favor in disputes
4. You're paying yourself with other LPs' money
```

### 3. Liquidity Death Spiral

- Legal costs spike (market crash → more disputes)
- Fees get diverted to lawyers
- LP yields drop unpredictably
- LPs withdraw → less liquidity → worse prices → less volume → less fees → can't pay lawyers

### 4. Fee Manipulation

If governance is funded by fees, controlling fees = controlling governance:
- Whale does massive wash trading
- Generates huge fees
- Uses fee-funded governance to vote themselves more power
- Circular extraction loop

---

## The Insulation Principle

```
┌─────────────────┐     ┌─────────────────┐
│   TRADING FEES  │     │  TOKEN REWARDS  │
│                 │     │                 │
│  100% → LPs     │     │  → Arbitrators  │
│                 │     │  → Governance   │
│  Incentive:     │     │  → Sybil hunters│
│  Provide        │     │                 │
│  liquidity      │     │  Incentive:     │
│                 │     │  Protocol health│
└─────────────────┘     └─────────────────┘
        │                       │
        │    INSULATED          │
        │    No cross-flow      │
        └───────────────────────┘
```

**LPs are mercenary** — they go where yield is. Predictable fees keep them.

**Governance must be incorruptible** — token rewards align with long-term protocol value, not short-term extraction.

---

## Why This Matters

If you let fee-funded lawyers into the LP pool, you've created a mechanism where:
- Short-term extraction (legal fees) competes with long-term alignment (LP incentives)
- Legal costs become an attack surface
- The people ruling on disputes have financial interest in dispute outcomes

This is similar to why in traditional systems:
- Judges aren't paid based on case outcomes
- Court funding is separate from the parties involved

---

## TL;DR

Fees reward capital providers. Tokens reward protocol stewards.

Mixing them creates circular incentives where the people judging disputes profit from the disputes themselves. That's how you get regulatory capture, not decentralized justice.

---

*Document generated from VibeSwap Protocol Documentation*
*https://frontend-jade-five-87.vercel.app/docs*
