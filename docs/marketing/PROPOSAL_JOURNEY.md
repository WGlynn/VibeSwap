# VibeSwap Proposal Journey

*A synopsis of community feedback and how it shaped the design.*

---

## Overview

This document captures the evolution of the VibeSwap proposal through community engagement on the Nervos forum. Key contributors: Matt (Nervos CEO), Phroi (community member).

---

## Phase 1: Initial Skepticism (Matt)

**The concern:** The proposal reads like AI-generated content. How do we know the author actually understands it versus just prompting an LLM?

**Matt's challenge:**
> "The cognitive work of deeply understanding something... cannot be shortcut by AI. The person proposing must embody the ideas—be able to defend, extend, and adapt them under pressure."

**Our response:** Rather than defend, we did the work. A stress-test session covering:
- Why batch auctions solve UTXO contention
- How commit-reveal prevents MEV
- L1/L2 architecture split (passive verification vs active coordination)
- Self-describing cells with embedded timing
- Adaptor signatures for cross-chain swaps

**The outcome:** Demonstrated understanding through explanation, not assertion. The proposal author can now articulate these concepts in their own words, with both intuitive explanations and technical vocabulary.

**Key insight:** "AI-assisted" doesn't mean "AI-understood." The human must still do the cognitive work. AI accelerates expression, not comprehension.

---

## Phase 2: Technical Deep-Dive (Phroi)

Phroi engaged with genuine technical curiosity. His questions improved the design.

### Question 1: How does price discovery work?

**Phroi:** "Is it LOB-based or something different?"

**Our explanation:** Uniform price clearing, not LOB.
- Sort buys high→low, sells low→high
- Clearing price = highest P where Demand ≥ Supply
- Everyone in the batch gets the same price

**Example provided:** Alice, Bob (buyers) vs Carol, Dave (sellers) → clearing price 0.011, 1400 CKB trades.

### Question 2: What about persistent order books?

**Phroi:** "Orders need to be re-broadcasted every batch—that's a feature less than LOB, not an advantage."

**Fair critique.** This led us to design the L3 layer:

- **L1 (CKB):** Settlement, verification
- **L2 (Stateless):** Batch matching, commit-reveal
- **L3 (Stateful):** Persistent order book, delegated reveals

**Key insight:** Order management and settlement can be separate. L2 stays simple; L3 handles persistence and reliability.

### Question 3: Liquidity dependence?

**Phroi:** "Seems dependent on market makers. What if supply and demand don't meet at the same time?"

**Our clarification:** VibeSwap has an AMM (x*y=k) underneath the batch auction.

Orders can:
1. Match with each other (coincidence of wants)
2. Trade against AMM liquidity (backstop)

No counterparty? AMM provides liquidity. Counterparty exists? Direct matching, less slippage. Fair price either way.

### Question 4: What if user misses reveal due to bad internet?

**Phroi:** "Fast batches + unreliable connections = unfair slashing."

**Our solution:** Delegated reveals via L3.
- User authorizes L3 to reveal on their behalf
- User's internet drops, L3 still reveals
- User expresses intent, L3 executes reliably

**Key insight:** L3 isn't just for convenience—it's for reliability.

---

## Design Evolution Summary

| Before Community Feedback | After Community Feedback |
|---------------------------|--------------------------|
| L1 + L2 architecture | L1 + L2 + L3 (future) |
| Implicit AMM role | Explicit: AMM as liquidity backstop |
| Persistence not addressed | L3 for persistent orders |
| Reliability not addressed | Delegated reveals solve bad-connection problem |
| "Fair price" framing | "Accurate price" framing (noise vs signal) |

---

## Key Narratives That Emerged

### 1. Noise vs Signal

Manipulated prices are noise. Fair price discovery is signal. MEV-resistant batch auctions remove the noise—producing more *accurate* prices, not just fairer ones.

**Tagline:** 0% noise. 100% signal.

### 2. Trustless > Convenient

For privacy coin swaps, every "convenient" solution (bridges, federations, wrapped tokens) requires trust. Pairwise atomic swaps are less convenient but actually trustless. We choose trustless and mitigate the inconvenience with bonded market makers.

### 3. Economic Security

We don't trust market makers to be honest—we make dishonesty expensive. Bonded collateral + slashing = economic alignment. Same security model as proof-of-stake.

---

## Open Threads

1. **L3 implementation:** Documented as future consideration. Priority is proving L1/L2 first.

2. **Clearing price edge cases:** Phroi stress-tested with large orders (6M CKB). System handles gracefully—orders that can't match simply don't fill.

3. **ZK verification costs:** For shielded Zcash support, need to benchmark SNARK verification on CKB-VM.

---

## Participants

- **Matt (Nervos CEO):** Pushed for embodiment over assertion. Made the proposal stronger by demanding the author demonstrate understanding.

- **Phroi:** Technical deep-dive on price discovery, order book design, liquidity. Questions directly improved the architecture (L3 layer emerged from his feedback).

- **Author + Claude:** Collaborative iteration. Claude accelerates expression; author does cognitive work. The stress-test proved the author can defend and extend the ideas independently.

---

*This document will be updated as the conversation continues.*
