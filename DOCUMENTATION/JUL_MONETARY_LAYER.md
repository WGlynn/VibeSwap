# JUL — The Monetary Layer

**Status**: Load-bearing tokenomic framing. Never collapse to bootstrap.
**Primitive**: [`memory/feedback_jul-is-primary-liquidity.md`](../memory/feedback_jul-is-primary-liquidity.md)
**Sibling docs**: [Three-Token Economy](./THREE_TOKEN_ECONOMY.md), [Constitutional DAO Layer](./CONSTITUTIONAL_DAO_LAYER.md).

---

## The two roles

JUL is the monetary layer of VibeSwap. It plays two standalone load-bearing roles, each of which would justify JUL's existence independently:

### Role 1 — Primary liquidity (the money layer)

JUL is the money. It is PoW-objective (mining backed) and fiat-stable (designed to minimize volatility against USD). It is what users hold and transact in. It is what prices are denominated in within VibeSwap pools.

This is NOT the "gas token" role. Gas is paid in the native chain's token (CKB-native). JUL is the unit of account — the pricing denominator — for everything on the application layer.

### Role 2 — PoW pillar of Nakamoto Consensus Infinity

The NCI weight function combines three pillars to derive consensus authority:
- **PoW** (proof of computation) — JUL's mining backing
- **PoS** (proof of stake) — VIBE governance stake
- **PoM** (proof of mind) — ContributionDAG attestations

JUL is the PoW pillar. The computational work that backs JUL is the same computational work that anchors NCI. Remove JUL and NCI's PoW axis collapses — there is no other token that plays this role.

## What JUL is NOT

This is a high-drift framing. Contributors and integrators try to round JUL to things it isn't:

- **Not a bootstrap token.** JUL is not a temporary ramp that CKB-native or VIBE eventually replaces. All three tokens coexist indefinitely. Suggesting "collapse JUL into VIBE once the network stabilizes" is an error — the two tokens serve orthogonal purposes (monetary vs governance), and one cannot play the other's role.
- **Not a gas token.** Gas is paid in the chain's native token.
- **Not just a reward currency.** JUL is not issued primarily via reward emissions; it's primarily mined and price-anchored.
- **Not interchangeable with VIBE.** VIBE is governance power; JUL is money. Tinbergen's Rule applies — one policy instrument per policy goal.

If you find yourself describing JUL as "the VibeSwap token" (singular), you have collapsed the three-token design. Re-read [Three-Token Economy](./THREE_TOKEN_ECONOMY.md).

## Why two standalone roles

Designs where one token plays multiple core roles are fragile to role-conflict. Example conflict mode: a governance token that also backs PoW has an incentive to inflate issuance for governance mobility, which depresses PoW security. Split the roles → no conflict.

JUL doesn't have this conflict:
- Its PoW role demands stable issuance rules and high computational expense.
- Its monetary role demands value stability and deep liquidity.
- These two goals *align* — both benefit from computational backing, neither wants inflation.

JUL's dual role is sustainable because its two roles point in the same direction. VIBE and CKB-native play roles that would conflict with either of JUL's, which is why they're separate tokens.

## How to talk about JUL to external audiences

- "JUL is the monetary layer of VibeSwap — PoW-mined, fiat-stable, the unit of account for all application-layer activity."
- "VibeSwap uses three tokens, each with a distinct role: JUL for money, VIBE for governance, CKB-native for state-rent. This is Tinbergen's Rule applied to constitutional crypto-design."
- "JUL is also the PoW pillar of our consensus weight function. Mining JUL contributes to the security of the broader NCI layer."

Do NOT say:
- "JUL is our utility token." (Too vague, collapses to bootstrap framing.)
- "JUL will eventually be replaced by VIBE." (Wrong — they coexist.)
- "JUL is the governance token." (Wrong — VIBE is.)

## Monetary mechanics

Details live in [Three-Token Economy](./THREE_TOKEN_ECONOMY.md) and the tokenomics whitepaper. Highlights:

- **Issuance**: PoW mining on dedicated computational substrate. Rate is fixed-schedule, halving-style.
- **Stability**: fiat-stability target via `TreasuryStabilizer.sol` — counter-cyclical treasury operations dampen volatility without breaking the PoW-backing.
- **Redemption**: JUL can be swapped for USD-pegged stables within VibeSwap pools at near-unit rates during normal conditions. During circuit-breaker trips, swaps pause per [Circuit Breaker Design](./CIRCUIT_BREAKER_DESIGN.md).

## Relationship to ETM

In the [Economic Theory of Mind](./ECONOMIC_THEORY_OF_MIND.md), cognition has three economic layers:

- A **medium of exchange** (transactional tokens of immediate value) — JUL.
- A **coordination instrument** (shared norms and voting rights) — VIBE.
- A **memory substrate** (what pays rent to stay in working memory) — CKB-native.

These three layers are orthogonal in cognition and orthogonal on-chain. Collapsing two of them would model cognition wrong — which is why VibeSwap's three-token design is load-bearing, not cosmetic.

## One-line summary

*JUL is two things at once — the money layer and the PoW pillar — and those are orthogonal to VIBE's governance role and CKB-native's state-rent role. Three tokens, three goals, never collapse.*
