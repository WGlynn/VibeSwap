# Augmented Mechanism Design: Why Pure Mechanisms Break and How CKB Fixes It

*Nervos Talks Post — Faraday1*
*March 2026*

---

## TL;DR

Every great economic mechanism — bonding curves, Harberger taxes, continuous auctions — has a fatal flaw when deployed in the wild. Not because the math is wrong, but because real adversaries exploit what the math ignores. We've developed a design pattern called **Augmented Mechanism Design (AMD)** that systematically fixes these mechanisms without replacing them. And CKB's cell model turns out to be the most natural substrate for implementing it.

---

## The Pattern

Here's something we kept discovering while building VibeSwap (1,612+ commits, 60 contracts, $0 funding):

**Pure mechanisms are beautiful. They also get exploited immediately.**

| Mechanism | Core Principle | What Goes Wrong |
|---|---|---|
| Bonding Curves | Deterministic price from supply | Pump-and-dump, front-running |
| Harberger Taxes | Assets flow to highest-valued user | Whales force-buy everything |
| Continuous Auctions | Best price, minimal latency | MEV extraction ($1.38B+ on Ethereum) |

The standard industry response is to either (a) accept the exploitation as "cost of doing business" or (b) throw out the mechanism entirely. Both are wrong.

**The right answer is augmentation.** Keep the core. Add armor.

---

## Three Case Studies

### 1. Augmented Bonding Curves (ABC)

Pure bonding curve: `V(R,S) = S^κ / R = constant`. Beautiful conservation law. Early buyers dump and crash it.

**Augmentation**: Exit tributes (sellers pay a friction fee that funds the commons), hatch vesting (early holders' tokens vest only through governance participation, not time), and batched/commit-reveal execution (can't front-run what you can't see).

The curve equation is **unchanged**. The social outcome is radically different.

### 2. Augmented Harberger Taxes (AHT)

Pure Harberger: self-assess your asset's value, pay tax on it, anyone can force-buy at your price. Elegant anti-squatting mechanism. Problem: a whale can systematically force-buy everything from legitimate owners who can't afford to self-assess defensively.

**Augmentation** (5 layers, all live in our `VibeNames.sol`):
- **Loyalty multiplier**: Tenure × active usage → 1x to 3x defense over 5 years. Only accrues if you're actually using the name (resolver is active). Squatters get 1x forever.
- **Grace period**: 72-hour right of first refusal. Force-buy is a negotiation, not a seizure.
- **Progressive portfolio tax**: 1 name = 1x tax. 2 names = 1.5x each. 6+ names = 3x each. Domain baroning becomes economically irrational.
- **Acquisition premium**: Buyer pays 20% above effective price, premium goes to displaced owner. Hostile takeover has a cost.
- **Reputation shield**: Active resolver usage is publicly verifiable — long-tenured active names signal legitimacy without oracles.

The Harberger tension (high assessment = high tax, low assessment = easy acquisition) is **preserved**. What changes is that legitimate owners have a smooth defensive gradient instead of a binary cliff.

### 3. Commit-Reveal Batch Auctions (CRBA)

Pure continuous auction: orders execute immediately at best price. MEV bots observe your order, front-run it, sandwich you, extract value.

**Augmentation**:
- **Commit phase (8s)**: Submit `keccak256(order || secret)`. Nobody can see your order.
- **Reveal phase (2s)**: Show your cards. Don't reveal? 50% deposit slashed.
- **Fisher-Yates shuffle**: Execution order determined by XOR of all revealed secrets. No single participant controls ordering.
- **Uniform clearing price**: Everyone in the batch gets the same price. No discrimination.

MEV is eliminated by construction. Not mitigated, not reduced — **eliminated**.

---

## The Formal Pattern

We call the transformation **A(M) → M'**:

1. Start with pure mechanism M (core property π preserved)
2. Identify vulnerability set V = {v₁, ..., vₖ}
3. For each vᵢ, design augmentation Aᵢ that targets vᵢ without modifying π
4. Compose: M' = Aₖ(...A₁(M)...)
5. Verify: π(M') ⟹ π(M) and V(M') ⊂ V(M)

Five augmentation classes emerge:
- **Temporal**: delays/windows (grace periods, commit phases, vesting)
- **Cryptographic**: information hiding (commitments, hash locks)
- **Accumulative**: history-dependent (loyalty, conviction, reputation)
- **Progressive**: scale-dependent (portfolio tax, rate limits)
- **Compensatory**: externality pricing (acquisition premiums, exit tributes)

---

## Why CKB Is the Right Substrate

This is the part I'm most excited to discuss here.

On Ethereum, all augmentation state lives in one contract's storage slots. Loyalty multipliers, portfolio counts, pending acquisitions, grace periods — all coupled together. Upgrading one augmentation risks all others.

**CKB's cell model is architecturally different.** Each piece of augmentation state is an independent cell with its own lock script and type script.

| AMD Concept | Ethereum | CKB |
|---|---|---|
| Mechanism state | Contract storage slots | Cell data fields |
| Augmentation logic | `require()` + modifiers | Type scripts (composable) |
| Temporal constraints | `block.timestamp` checks | Since (timelock in lock script) |
| Progressive scaling | Storage mapping iteration O(n) | UTXO set indexed query O(1) |
| Compositional safety | Multi-call / delegatecall | Transaction-level cell composition |

The key insight: **CKB cells make augmentations composable by default.** Each augmentation is an independent verifiable script. They compose at the transaction level through cell consumption and production. You don't need proxy patterns or delegatecall — the substrate handles it.

Portfolio tax on CKB? Count cells with the VibeNames type script. O(1) via indexer.

Grace period? The pending acquisition is a cell with a timelock lock script. Can't be consumed until 72 hours pass. The temporal augmentation is *structural*, not conditional.

Loyalty multiplier? Cell data includes `registeredAt` and `resolverActive`. The type script validates loyalty calculations directly from cell state.

**CKB doesn't just accommodate augmented mechanisms — it encourages them.** The cell model's explicit state ownership and composable verification semantics are exactly what AMD needs.

---

## What This Means for Nervos

VibeSwap is building this on EVM chains first (where the users are). But the architecture analysis is clear: CKB is the better substrate for augmented mechanisms. We're actively working on CKB integration (see our [CKB architecture doc](https://github.com/wglynn/vibeswap)).

If the Nervos community is interested, we'd like to:
1. **Port VibeNames AHT to CKB** as a reference implementation — demonstrating augmented Harberger taxes with native cell composition
2. **Publish the full AMD paper** with rigorous CKB substrate analysis (already drafted)
3. **Explore what AMD patterns look like** when the substrate natively supports them — we suspect there are augmentation types that are only practical on CKB

The formal paper is available in our repo: `docs/papers/augmented-mechanism-design.md`

---

## Discussion

Some questions for the community:

1. **What other pure mechanisms need augmentation?** We've done bonding curves, Harberger taxes, and continuous auctions. What else is mathematically elegant but socially broken?

2. **Are there CKB-native augmentation patterns** that don't have EVM equivalents? The Since timelock is one example. What else?

3. **How should augmentation parameters be governed?** We argue for fixed parameters (anti-pattern: using augmentation params as governance levers). The community may disagree.

4. **Can AMD be formalized further?** We have informal proofs of compositional augmentation. Is there a connection to existing work in economic theory?

Looking forward to the discussion.

---

*"Fairness Above All."*
*— P-000, VibeSwap Protocol*

*Full paper: [augmented-mechanism-design.md](https://github.com/wglynn/vibeswap/blob/master/docs/papers/augmented-mechanism-design.md)*
*Code: [github.com/wglynn/vibeswap](https://github.com/wglynn/vibeswap)*
