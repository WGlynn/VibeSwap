# Three Tokens, Three Jobs: Why We Decomposed Money

*Nervos Talks Post — Faraday1*
*March 2026*

---

## TL;DR

Money has three classical functions: store of value, medium of exchange, and unit of account. Every protocol that forces one token to do all three is making the same mistake that fiat makes — optimizing for one function at the expense of the others. We split VibeSwap's economy into three tokens, each with a monetary policy designed specifically for its job. VIBE is the hard-capped governance token. JUL (Joule) is the energy-pegged stable. And a CKB-native asset powers the knowledge economy using Nervos' own disinflationary model as a blueprint.

---

## The Problem: One Token, Three Jobs

Bitcoin is an incredible store of value. It's a terrible medium of exchange. The volatility that makes it attractive to hold makes it impractical to spend.

Stablecoins are useful for exchange. They're worthless as a store of value — holding USDC is holding a depreciating fiat proxy with counterparty risk.

Governance tokens are supposed to align incentives. Most of them do neither — they're not stable enough to spend and not scarce enough to hold. They exist in an uncomfortable middle ground where everyone knows the "utility" is a regulatory fiction.

The reason is simple: store of value requires scarcity and permanence. Medium of exchange requires stability and liquidity. Utility requires elasticity and responsiveness. No single monetary policy can optimize for all three simultaneously. Asking one token to be Bitcoin, a stablecoin, and a governance mechanism is asking a hammer to also be a saw and a level.

---

## Three Tokens, Three Policies

### VIBE — Store of Value

**Monetary policy**: Hard cap. 21 million tokens. Lifetime ceiling — burns are permanent and do not create room for re-minting. Once all 21M have been minted across all time, no more will ever exist.

**How it works**: Minted exclusively through verified on-chain contribution, measured by Shapley value distribution. Never airdropped, never pre-mined. Annual halving emission schedule. Governance power via ERC20Votes delegation.

**Why hard cap**: Same reason Bitcoin works as a store of value. Absolute scarcity creates a credible commitment that no future governance vote, no emergency, no "just this once" can dilute holders. The code enforces `totalMinted + amount > MAX_SUPPLY` — not `totalSupply()`, which would let burns create room. The cap is on lifetime minting, not circulating supply.

**What it doesn't do**: VIBE is not for spending. It's not stable. It's not meant to be liquid. It's meant to be earned, held, and used to govern. Asking VIBE to also be a medium of exchange would compromise the scarcity that makes it meaningful.

**Deployed on**: Ethereum / Base.

### JUL (Joule) — Medium of Exchange and Unit of Account

**Monetary policy**: Fully elastic. Three stabilization mechanisms working together — proportional proof-of-work mining (price floor = electricity cost), PI-controller dampening (smooths medium-term oscillations), and elastic supply rebasing (absorbs short-term demand shocks).

**How it works**: Miners produce JUL by expending electricity, creating a thermodynamic price floor. The PI controller (RAI model) adjusts a redemption rate to keep price stable around equilibrium. Elastic rebase (AMPL model) expands or contracts supply proportionally across all holders when price deviates from target. A dual oracle cross-references CPI purchasing power against PoW electricity cost — each constrains the other.

**Why elastic**: A medium of exchange must be stable. You can't price goods in something that moves 10% daily. JUL's supply responds to demand so that price doesn't have to. The three-layer stabilization bounds volatility to the variance of global electricity costs — tight enough that the rebase adjustments are imperceptible (1-3% after double dampening).

**What it doesn't do**: JUL is not a store of value in the traditional sense. It maintains purchasing power, not price appreciation. Holding JUL won't make you rich. Spending JUL won't cost you opportunity. That's the point — it's money you can actually use without regret.

### CKB-Native Asset — Knowledge Economy Utility

**Monetary policy**: Disinflationary with supply recycling. Inspired by Nervos CKB's own cryptoeconomic model (RFC-0015).

CKB solved something at the base layer that most chains haven't even recognized as a problem. Primary issuance halves like Bitcoin, creating long-term scarcity. Secondary issuance is constant and perpetual, funding ongoing network security. But here's the insight: NervosDAO compensates depositors with proportional secondary issuance, making long-term holders effectively immune to inflation. The inflation only dilutes those who keep CKB liquid without using it — which functions as implicit state rent. You either use the network (occupy state), lock in the DAO (preserve value), or pay the inflation tax for the privilege of doing neither.

This is not elastic — supply does not respond to demand. The issuance schedule is fixed and predetermined. But it recycles economic pressure without unbounded inflation. Holders who participate are made whole. Free riders are diluted. The network funds its own security perpetually without destroying scarcity for engaged participants.

Our CKB-native asset applies this model to the Jarvis Common Knowledge Base — the shared intelligence substrate that powers our AI agent network. Locking tokens funds knowledge storage and compute. Depositing in the equivalent of a DAO compensation mechanism preserves value for passive holders. The knowledge economy sustains itself through the same implicit rent mechanism that sustains CKB itself.

**Why this model**: A knowledge base needs perpetual funding (storage, compute, curation) but can't afford runaway inflation that destroys the token's utility. CKB's model threads the needle — perpetual funding through secondary issuance, perpetual scarcity preservation through DAO compensation. We're not reinventing this. We're composing with it on the chain that was literally designed for it.

**What it doesn't do**: This token is not for speculation (use VIBE) and not for commerce (use JUL). It's for participating in and funding the knowledge infrastructure that makes the rest of the protocol intelligent.

**Deployed on**: Nervos CKB (native).

---

## Why Three and Not One

| Function | What it needs | VIBE | JUL | CKB-Native |
|----------|--------------|------|-----|------------|
| Store of Value | Scarcity, permanence | Yes | No | Partial (for participants) |
| Medium of Exchange | Stability, liquidity | No | Yes | No |
| Unit of Account | Stability, universality | No | Yes | No |
| Governance | Skin in game, alignment | Yes | No | No |
| Operational Utility | Elasticity, throughput | No | No | Yes |

No single column has all checkmarks. That's not a failure — it's the design. Each token excels at its job because it doesn't have to compromise for the others.

---

## How They Interact

The three tokens aren't isolated economies. They feed each other through the Shapley distribution framework:

**Earning VIBE**: Contribute to any part of the ecosystem — provide liquidity (JUL pairs), build on the knowledge base (CKB-native), govern wisely (VIBE staking) — and Shapley measures your marginal contribution. VIBE is the reward for all forms of contribution, regardless of which token you operated in.

**Spending JUL**: All commerce, payments, and exchange within VibeSwap are denominated in JUL. LP fees are in JUL. x402 API payments are in JUL. Agent-to-agent transactions are in JUL. Stable value means prices are meaningful.

**Locking CKB-native**: Fund the intelligence layer. Knowledge storage, agent compute, CKB attestations. The implicit rent model ensures the knowledge base is perpetually funded without draining the operational economy.

---

## Credit Where It's Due

This architecture doesn't exist without Nervos. The CKB team designed an economic model (RFC-0015) that solved the "perpetual funding without unbounded inflation" problem at the base layer. We're applying their insight at the application layer, on their chain, using their native patterns. The cell model, the NervosDAO compensation mechanism, the implicit state rent — these aren't features we're working around. They're the foundation we're building on.

---

## Open Questions

1. What's the right secondary issuance rate for a knowledge economy token? CKB's rate was calibrated for a global state storage network. Our knowledge base has different capacity dynamics.

2. How should the DAO compensation mechanism work for knowledge contributors vs passive holders? CKB treats all depositors equally. Should knowledge curators get a higher rate?

3. Cross-token Shapley: when a user contributes liquidity in JUL, locks knowledge state with CKB-native, and governs with VIBE — how do you weight these three types of contribution in the same cooperative game?

---

## Links

- [VIBEToken.sol — 21M Lifetime Cap](https://github.com/WGlynn/VibeSwap/blob/master/contracts/monetary/VIBEToken.sol)
- [Joule.sol — Elastic Stable](https://github.com/WGlynn/VibeSwap/blob/master/contracts/monetary/Joule.sol)
- [Trinomial Stability Theorem](https://github.com/WGlynn/VibeSwap/blob/master/docs/TRINOMIAL_STABILITY_THEOREM/TRINOMIAL_STABILITY_THEOREM.md)
- [ShapleyDistributor.sol — Unified Distribution](https://github.com/WGlynn/VibeSwap/blob/master/contracts/incentives/ShapleyDistributor.sol)
- [CKB RFC-0015 — Cryptoeconomics](https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0015-ckb-cryptoeconomics/0015-ckb-cryptoeconomics.md)
- [CKB SDK — 73 Modules, 15,155 Tests](https://github.com/WGlynn/VibeSwap/tree/master/ckb/sdk/src)

---

*VibeSwap — three tokens, three jobs, one protocol. 1,850+ commits, $0 funding. Built in a cave. Coming out now.*
