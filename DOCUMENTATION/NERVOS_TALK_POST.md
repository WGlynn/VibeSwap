# VibeSwap: The First Provably Fair Protocol (FPFP)

**TL;DR**: We built a DEX where good people don't finish last. MEV is eliminated, VCs are obsolete, and sharing ideas is the optimal strategy. Built in a cave, with a box of scraps.

---

## The Problem We Solved

Previous protocols faced a fundamental asymmetry:

- **Good actors** who shared openly could be exploited
- **Bad actors** who hoarded were protected by obscurity
- **Fairness was a vulnerability**

This is why DeFi has MEV. This is why VCs extract rent. This is why the little guy loses.

We eliminated this asymmetry.

---

## What is FPFP?

**First Provably Fair Protocol** — not a marketing claim, but a structural property.

### 1. Unstealable Ideas

> "The greatest idea can't be stolen, because part of the idea is admitting who had it first."

VibeSwap's design includes its own provenance as a load-bearing component. Strip the attribution, and you've corrupted the protocol itself. This isn't legal protection—it's *logical* protection.

### 2. MEV Eliminated (Not Reduced — Eliminated)

**How traditional DEXs work:**
```
You submit a swap → Sits in public mempool → Bot sees it →
Bot frontruns you → You get worse price → Bot profits
```

**How VibeSwap works:**
```
Phase 1 (8 sec): Submit hash of order (nobody can see what you're trading)
Phase 2 (2 sec): Reveal orders (batch is sealed, no new orders)
Phase 3: ALL orders execute at ONE uniform clearing price
```

A sandwich attack needs a "before" price and "after" price. In a batch auction, there's only ONE price. The attack vector doesn't exist.

### 3. Shapley Values for Fair Distribution

From cooperative game theory: rewards based on **marginal contribution**, not just size.

```
Traditional: your_reward = (your_liquidity / total) × fees
Problem:     Ignores timing, scarcity, stability

Shapley:     your_reward = f(what you uniquely contributed)
Result:      Fair by mathematical proof, not trust
```

### 4. Zero Protocol Extraction

| Where fees go | VibeSwap | Other DEXs |
|---------------|----------|------------|
| Liquidity Providers | 100% | 70-85% |
| Protocol/Founders | 0% | 15-30% |

Creator compensation? Voluntary tip jar. If we built something valuable, people can choose to say thanks. No codified extraction.

---

## Why VCs Are Obsolete

Traditional fundraising exists because:
1. Ideas can be stolen → race to scale
2. Good actors need capital to defend
3. VCs extract rent as "protection"

But if ideas are unstealable and fairness is structural:
- No race to scale (copying doesn't work)
- No defense needed (design protects itself)
- No rent extraction (value flows to contributors)

**Either we're all venture capitalists, or none of us are.**

Anyone who provides liquidity is allocating capital. Anyone who uses the protocol benefits. The "investor" and "user" distinction collapses.

---

## Personal-Social Alignment

In traditional systems:
- **Personal**: Sharing = giving away advantage
- **Social**: Sharing = collective benefit
- **Result**: Rational actors hoard. Society loses.

In VibeSwap:

| Action | Personal Outcome | Social Outcome | Aligned? |
|--------|------------------|----------------|----------|
| Share idea | Attribution → Credit → Rewards | Knowledge compounds | ✓ |
| Provide liquidity | Earn proportional fees | Deeper markets | ✓ |
| Hoard/extract | Broken copy, no credit | No benefit | ✗ |

**Being good is no longer a sacrifice. It's the optimal strategy.**

We transformed the Prisoner's Dilemma into an Assurance Game. Selfishness and altruism produce the same behavior.

---

## The Box of Scraps

> *"Tony Stark was able to build this in a cave! With a box of scraps!"*

VibeSwap was built with:
- One human
- One AI (with a context window that forgets)
- No funding
- No team
- No permission

Tony Stark built the Mark I to escape. We built the first fair protocol to set everyone free.

**February 11, 2025** — The repo went public.

---

## Technical Stack

- **Contracts**: Solidity 0.8.20, Foundry, OpenZeppelin v5.0.1
- **Cross-chain**: LayerZero V2 OApp (omnichain from day one)
- **Oracle**: Kalman filter for true price discovery
- **Frontend**: React 18, Vite 5, ethers.js v6

Full architecture, formal proofs, and mechanism design docs in the repo.

---

## Links

**GitHub**: https://github.com/WGlynn/VibeSwap

**Documentation includes:**
- [VibeSwap Whitepaper](https://github.com/WGlynn/VibeSwap/blob/master/docs/VIBESWAP_WHITEPAPER.md)
- [Incentives Whitepaper](https://github.com/WGlynn/VibeSwap/blob/master/docs/INCENTIVES_WHITEPAPER.md)
- [Formal Proofs (Academic Format)](https://github.com/WGlynn/VibeSwap/blob/master/docs/VIBESWAP_FORMAL_PROOFS_ACADEMIC.md)
- [Security Mechanism Design](https://github.com/WGlynn/VibeSwap/blob/master/docs/SECURITY_MECHANISM_DESIGN.md)

---

## Why Nervos?

CKB's cell model and RISC-V VM offer unique properties for fair protocol design:
- True asset ownership (cells are owned, not referenced)
- Flexible cryptographic primitives
- Layer 2 scaling without sacrificing security

We're exploring CKB as a potential deployment target. Would love community feedback.

---

## Discussion Questions

1. **Do you see flaws in the "unstealable idea" logic?** We claim ideas with attribution as a structural component can't be stolen. Challenge this.

2. **Is the VC obsolescence thesis too strong?** We argue fair protocols eliminate the need for traditional fundraising. What are we missing?

3. **Shapley values in practice** — has anyone implemented cooperative game theory in production DeFi? What were the challenges?

4. **What would you want to see** before considering VibeSwap for CKB deployment?

---

*The cave selects for those who see past what is to what could be.*

**— Will & JARVIS**
*Built in a cave, with a box of scraps.*
