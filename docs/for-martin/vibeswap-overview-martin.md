# VibeSwap — Overview for Martin Grabowski

*From Will Glynn — March 25, 2026*

Martin — great connecting today. As promised, here's a breakdown of the core ideas we discussed, plus the pieces I stumbled over on the call. This doc is your starting point. I've included links to deeper reading at the end.

---

## The Forgiveness Layer

You asked about governance, and this is where VibeSwap breaks from every other protocol in the space.

The blockchain ethos has always been: "Not your keys, not your crypto." Immutability is sacred. Code is law.

But people make mistakes. You know this firsthand — sending USDC to a wrong address and being told it's "gone" is not a feature. It's a failure of imagination.

VibeSwap builds a **forgiveness layer** on top of immutability. We don't break immutability — we add structured, governed exceptions for when humans are human.

### Five-Tier Governance Architecture

Think of it as a constitutional system, not a corporate one:

**Tier 1: Physics (Cannot Be Overridden)**
Shapley value math enforces fairness at the protocol level. If an action extracts value without contributing, the math blocks it — not a vote, not a committee. Math. This is our P-001 invariant: *No Extraction Ever.*

**Tier 2: Constitution (P-000: Fairness Above All)**
The human-readable layer. Amendable, but only if the math (Tier 1) agrees. You can't vote away fairness — the Shapley check gates every governance proposal.

**Tier 3: Governance (DAO)**
Free to operate within the bounds of Tiers 1 and 2. Parameter changes, fee routing adjustments, treasury allocation — all governed democratically, but mathematically constrained. Governance capture is structurally impossible because the math has veto power.

**Tier 4: Dispute Resolution & Recovery**
This is the forgiveness layer in action:
- **Clawback Registry**: If funds are stolen or sent to a compromised address, a federated consensus process (combining on-chain jurors with off-chain legal authorities) can trace, flag, and recover funds
- **Taint Propagation**: Stolen funds that move to new wallets are tracked. Recipients of tainted funds are flagged, creating a deterrent that makes laundering economically irrational
- **Guardian Recovery**: 3-of-5 trusted contacts can recover your wallet with a 24-hour cancellation window
- **Dead Man's Switch**: Pre-configured beneficiary inherits after extended inactivity — with 30/7/1-day warnings before activation

The key insight: **recovery doesn't break immutability**. Every clawback is itself an on-chain transaction — auditable, governed, and constrained by the same fairness math as everything else.

**Tier 5: Autonomous Protocol (The Endgame)**
Governance is designed to sunset itself. Voting weight decays exponentially (half-life: 365 days). After 4-8 years, the protocol runs on pure mechanism design — no human governance needed. We call this the Cincinnatus Protocol: build it, prove it works, walk away.

### Why This Matters for Tokenization

Every tokenized asset — whether it's real estate, carbon credits, or digital securities — eventually faces the same problem: what happens when someone makes a mistake? Traditional blockchain says "too bad." Traditional finance says "call your bank."

VibeSwap's answer: structured forgiveness with mathematical guardrails. Recovery is possible. Extraction is not.

---

## How MEV Elimination Actually Works

On the call I fumbled the technical explanation, so let me lay this out clearly. There are **three distinct components**, each solving a different attack vector. All three are required — remove any one and MEV comes back.

### The Problem

When you trade on Uniswap or any standard DEX, your pending transaction sits in the mempool visible to everyone. Bots see your trade, place a buy order right before yours (pushing the price up), then sell right after (pocketing the difference). This is called a sandwich attack. Over $1 billion per year is extracted from regular users this way.

This isn't a bug in any particular DEX. It's a structural consequence of three things: **visible orders**, **sequential execution**, and **manipulable ordering**. VibeSwap eliminates all three.

### Component 1: Commit-Reveal (Kills Visibility)

**The problem it solves:** Frontrunning — bots can see your order before it executes.

**How it works:** Instead of broadcasting your trade, you submit a cryptographic hash — a one-way fingerprint of your order. Nobody can reverse-engineer what you're buying, how much, or at what price. Your order is hidden in plain sight.

After the commit window closes (8 seconds), you reveal the actual order. The contract verifies it matches your hash. By the time anyone sees your real order, it's too late to react.

**The game theory:** If you commit but don't reveal (griefing), you lose 50% of your deposit. This makes spam and manipulation self-defeating.

**What's left standing:** Even with hidden orders, if trades execute sequentially, an attacker could still manipulate the *execution order*. That's where component two comes in.

### Component 2: Uniform Clearing Price (Kills Sandwich Attacks)

**The problem it solves:** Price manipulation through sequential execution.

**How it works:** Think of it as **supply and demand convergence**. Instead of executing trades one by one (where each trade moves the price for the next), VibeSwap collects ALL orders in a batch and finds the single price where supply meets demand.

The protocol aggregates:
- All buy orders willing to pay at or above a candidate price
- All sell orders willing to accept at or below that price
- Binary search finds the equilibrium — the one price where buyers and sellers match

**Every trade in the batch executes at this one price. Simultaneously.**

A sandwich attack requires buying low and selling high *within the same batch*. But when there's only one price, there is no "low" and "high." The attack isn't just unprofitable — it's structurally impossible.

A user buying 100 tokens and a user buying 100,000 tokens pay the same price per token. No individual price impact. No slippage advantage for size. This is true price discovery through supply and demand convergence.

**What's left standing:** Orders are hidden and price is uniform — but if someone could control the *execution order*, they might still gain an edge in edge cases. Component three closes this last gap.

### Component 3: Fisher-Yates Shuffle (Kills Ordering Manipulation)

**The problem it solves:** Time-priority and positional advantage.

**How it works:** After reveals close, the execution order is randomized using a process that no single participant can control:

1. Every participant contributed a secret during the commit phase. These secrets are XORed together — meaning everyone contributes to the randomness, and no single person controls it.
2. A future block hash (from a block produced *after* reveals close) is mixed in. Even the last person to reveal can't predict this value.
3. This combined seed drives a Fisher-Yates shuffle — a mathematically proven uniform random permutation.

The result: execution order is deterministic (verifiable after the fact) but unpredictable (nobody can game it in advance). Being first to commit gives you zero advantage. Being last gives you zero advantage.

### The Three Components Together

| Attack | Which Component Stops It | Why |
|--------|--------------------------|-----|
| Frontrunning | Commit-Reveal | Can't see orders to front-run |
| Sandwich | Uniform Clearing Price | One price for all — no spread to capture |
| Time-priority gaming | Fisher-Yates Shuffle | Random order, unpredictable seed |
| JIT Liquidity | Uniform Clearing Price | Price from aggregate supply/demand, not pool manipulation |
| Flash loans | Same-block guard | Can't commit + reveal + repay in one transaction |

**The key insight:** MEV is not inevitable. It's a consequence of three specific design choices (visible orders, sequential execution, manipulable ordering) that most DEXs inherited from centralized exchange models without questioning whether they fit a transparent blockchain. VibeSwap removes all three.

Every other approach in the industry — Flashbots, MEV-Share, threshold encryption — *redistributes* MEV or *delays* it. VibeSwap *eliminates* it. The difference is structural, not incremental.

---

## Three-Token Economy

Most protocols try to make one token do everything: governance, gas, staking, payments. This forces impossible trade-offs. A token can't be scarce (good for governance) AND elastic (good for payments) AND utility-priced (good for resource allocation) simultaneously. That's the monetary policy trilemma.

VibeSwap uses three tokens, each with exactly one job:

### VIBE — Store of Value & Governance
- **Hard cap: 21 million lifetime.** Burns are permanent — they never create room for new minting. If 1 million VIBE are burned, only 20 million can ever exist. Bitcoin logic.
- Zero pre-mine. Zero team allocation. Distributed exclusively through Shapley value rewards — you earn VIBE by contributing to the protocol, proportional to your actual marginal contribution.
- Governance weight. VIBE holders vote on protocol parameters within the constitutional constraints described above.
- 32-era halving schedule. Emission starts at ~10.5M VIBE in Era 0 and halves each era.

### JUL — Medium of Exchange
- **Fully elastic supply.** PI controller + rebase mechanism keeps JUL stable and usable regardless of market conditions.
- This is what people actually transact with. Designed for velocity, not scarcity.
- No cap — supply expands and contracts based on demand.

### CKB — Pure Utility
- **State occupation = rent.** If your data lives on-chain, you pay for the space. Not speculative, not governance — pure resource pricing.
- Based on Nervos Network's RFC-0015 economic model, which has been live and tested.
- Disinflationary: perpetual funding without unbounded inflation.

### Revenue Model
- **100% of swap fees go to liquidity providers.** Not 80%. Not 95%. All of it. The protocol does not extract from its users.
- **0% bridge fees.** Always. Gas pass-through only.
- Treasury revenue comes from optional premium features: priority bids (pay for execution preference within a batch), penalty redistributions (50% of slashed deposits), and service marketplace fees.

The principle: the protocol makes money from *value-added services*, not from taxing basic usage.

---

## The Shapley Values Post (Context)

The LinkedIn post you may have seen today explains the reward distribution mechanism. The core idea:

Traditional DeFi distributes rewards pro-rata — own 10% of the pool, get 10% of fees. This treats a dollar that arrived five minutes ago the same as a dollar that survived three market crashes.

Shapley values (Nobel Prize, 1953) compute the average marginal contribution of each participant across all possible orderings. The result is the only mathematically consistent definition of "fair."

In VibeSwap, each batch settlement creates an independent cooperative game. LP rewards come from four weighted components:
- **Direct Contribution (40%)** — raw liquidity provided
- **Enabling Contribution (30%)** — time in the pool
- **Scarcity Contribution (20%)** — providing liquidity on the side the market needs
- **Stability Contribution (10%)** — staying during volatility

This transforms DeFi from a Prisoner's Dilemma (rational to defect) into an Assurance Game (rational to cooperate). The math makes cooperation the selfish choice.

---

## What's Next

The contracts are built. The frontend is deployed. The emission model is finalized and chain-portable. We're not rushing to mainnet — we're looking for the right people to build this with.

If any of this resonates or if you see connections in your network, I'd love to continue the conversation.

— Will

---

## Further Reading

I've organized these by depth. Start with the first tier and go as deep as you'd like.

### Tier 1: Overview (30 min)
- `docs/explainers/vibeswap-whitepaper-simple.md` — ELI5 of the full system
- `DOCUMENTATION/INVESTOR_SUMMARY.md` — Executive summary with metrics
- `docs/explainers/how-vibeswap-works.md` — Step-by-step walkthrough

### Tier 2: Philosophy & Design (1-2 hours)
- `DOCUMENTATION/COOPERATIVE_MARKETS_PHILOSOPHY.md` — Why cooperative markets outperform extractive ones
- `docs/papers/cooperative-capitalism.md` — Mutualized risk + free market competition
- `DOCUMENTATION/INTRINSIC_ALTRUISM_WHITEPAPER.md` — Aligning incentives with human values
- `blog/01_commit_reveal_mev.md` — Blog post on MEV elimination
- `blog/02_shapley_values_defi.md` — Blog post on fair rewards

### Tier 3: Deep Tokenomics & Governance (2-3 hours)
- `DOCUMENTATION/VIBESWAP_WHITEPAPER.md` — Full technical whitepaper
- `docs/papers/shapley-value-distribution.md` — Shapley value distribution paper
- `DOCUMENTATION/TIME_NEUTRAL_TOKENOMICS.md` — Time-neutral reward design
- `docs/ethresearch/three-token-economy.md` — Three-token architecture (published on ethresear.ch)
- `DOCUMENTATION/SEC_WHITEPAPER_VIBESWAP.md` — Regulatory compliance framework

### Tier 4: Mechanism Design & Security (3-4 hours)
- `docs/papers/commit-reveal-batch-auctions.md` — Full academic paper on the auction mechanism
- `DOCUMENTATION/SECURITY_MECHANISM_DESIGN.md` — Six-layer defense architecture
- `docs/papers/agi-resistant-recovery.md` — Recovery system designed to resist AGI-scale attacks
- `DOCUMENTATION/FORMAL_FAIRNESS_PROOFS.md` — Mathematical proofs of fairness guarantees
- `docs/papers/contribution-dag-lawson-constant.md` — Proof-of-contribution system

### Tier 5: Vision & Future
- `docs/papers/ai-agents-defi-citizens.md` — AI agents as economic participants
- `docs/papers/the-cave-methodology.md` — Building under constraints
- `DOCUMENTATION/SOCIAL_SCALABILITY_VIBESWAP.md` — How fairness enables social scalability
