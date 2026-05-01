# One Token Per Function: Decomposing Money in DeFi

*ethresear.ch*
*March 2026*

---

## Abstract

Money has three classical functions: store of value, medium of exchange, and unit of account. Every DeFi protocol that forces a single token to serve all three is repeating the structural error that fiat monetary systems made — optimizing for one function at the expense of the others. This post argues that the "one token to rule them all" design pattern is DeFi's original sin, proposes a three-token architecture where each token's monetary policy is purpose-built for exactly one function of money, and deploys each token on the chain whose architecture best matches its job. We present VIBE (hard-capped governance, ERC-20 on Base/Ethereum), JUL (trinomial-stabilized medium of exchange, combining PoW mining floors, PI-controller dampening, and elastic rebase), and a disinflationary knowledge-economy token on an alternative L1. We believe this decomposition resolves tensions that are structurally irresolvable within single-token designs.

---

## 1. The Problem: Monetary Policy Trilemma

Consider the requirements for each function of money. Store of value demands scarcity and credible permanence — the holder must believe that no future event can dilute their claim. Medium of exchange demands stability and liquidity — the spender must trust that the token's purchasing power tomorrow is close to its purchasing power today. Unit of account demands universality and low volatility — the merchant must be able to price goods without repricing every block.

These requirements are in direct tension. Scarcity creates volatility, which destroys medium-of-exchange utility. Stability requires elastic supply, which destroys store-of-value properties. Governance utility requires staking lockups, which destroys liquidity. No single monetary policy can simultaneously optimize for all three. This is not a criticism of any specific protocol — it is a structural impossibility, the monetary analog of the CAP theorem.

The evidence is everywhere. Bitcoin is an extraordinary store of value and a poor medium of exchange; nobody prices goods in BTC because the unit of account fluctuates 5-15% weekly. USDC is a functional medium of exchange and a terrible store of value — holding it means holding depreciating fiat with counterparty risk layered on top. UNI, AAVE, and COMP are governance tokens that serve neither function well: too volatile to spend, too inflationary to hold, with "utility" that is mostly a regulatory fiction. The community understands this intuitively. The question is whether protocol design should acknowledge it structurally.

---

## 2. VIBE — Store of Value (ERC-20 on Ethereum/Base)

**Monetary policy**: Hard cap. 21,000,000 tokens. Lifetime ceiling — burns are permanent and do not create room for re-minting.

VIBE is deployed as a UUPS-upgradeable ERC-20 with ERC20Votes (EIP-5805) for on-chain delegation and ERC20Permit (EIP-2612) for gasless approvals. The contract tracks `totalMinted` separately from `totalSupply()`. The cap is enforced on lifetime minting: `totalMinted + amount > MAX_SUPPLY` reverts. This is a deliberate design choice. If the cap were on circulating supply, burns would create re-minting headroom, and the scarcity commitment would be meaningless — any governance vote could authorize a burn-and-remint cycle. Lifetime minting caps make dilution structurally impossible, not merely politically unlikely.

VIBE is minted exclusively through verified on-chain contribution, measured by Shapley value distribution. No pre-mine, no team allocation at deployment, no airdrop. Founders receive retroactive Shapley claims validated by three-factor contribution proof. The emission schedule follows Bitcoin-style halving: 32 eras of 52,560 games each (~1 year per era at one game per 10 minutes), with emission multipliers halving each era. After 32 halvings, new emissions asymptotically approach zero.

**Why this matters for Ethereum**: The DeFi governance token model is broken. UNI was distributed via airdrop and liquidity mining, creating a holder base with no skin in the protocol's long-term success. The result was predictable: governance participation hovers around 1-5% of supply, vote-buying via Convex-style wrappers is rampant, and the token price is decoupled from protocol performance. VIBE's Shapley distribution ties token acquisition to demonstrated marginal contribution. You cannot buy your way to governance power — you must earn it by making the protocol measurably better. This is closer to proof-of-work for governance than proof-of-stake.

**What VIBE is not**: It is not a medium of exchange. It is not stable. It is not meant to be liquid. Using VIBE to buy coffee would be like using equity shares to buy coffee — technically possible, structurally wrong. A store of value that doubles as a spending token compromises the scarcity that makes it worth storing.

---

## 3. JUL (Joule) — Medium of Exchange and Unit of Account

**Monetary policy**: Fully elastic. Three stabilization mechanisms operating simultaneously.

This is where the mechanism design gets interesting. JUL implements what we call the Trinomial Stability Theorem — the claim that three independent stabilization layers, each targeting a different frequency of price deviation, can bound volatility to a narrower range than any single mechanism achieves alone. The three layers are:

**Layer 1 — Proportional Proof-of-Work Mining (Ergon model, long-term floor)**. JUL is SHA-256 mineable, Bitcoin ASIC-compatible. The key innovation is proportional rewards: `reward = difficulty * scale * mooresLawFactor`. As difficulty increases, rewards increase proportionally, maintaining a constant ratio between mining cost and token output. This creates a thermodynamic price floor — the token cannot sustainably trade below the electricity cost required to produce it. The Moore's Law decay factor (~25% annual reduction) accounts for hardware efficiency improvements, preventing the floor from eroding as ASICs improve. This is the same insight behind Ergon's proportional PoW, applied as one layer of a composite stabilizer rather than a standalone mechanism.

**Layer 2 — Elastic Supply Rebase (AMPL model, short-term shock absorption)**. A global O(1) rebase scalar adjusts all balances simultaneously: `externalBalance = internalBalance * rebaseScalar / 1e18`. When price exceeds the target by more than 5% (the equilibrium band), supply expands proportionally across all holders. When price falls below, supply contracts. A lag factor of 10 means each rebase corrects 10% of the deviation, preventing oscillatory overcorrection. AMPL demonstrated that elastic supply can maintain a price target; its limitation was relying on rebase alone, which creates predictable arbitrage cycles. JUL uses rebase as a shock absorber, not a sole stabilizer.

**Layer 3 — PI Controller (RAI model, medium-term target adjustment)**. Rather than pegging to a fixed price, JUL's target floats. A proportional-integral controller (Kp = 7.5e-8, Ki = 2.4e-14) adjusts the redemption price based on sustained deviation. A leaky integrator with a 120-day half-life prevents integral windup. This is directly inspired by RAI's "money god" controller — the insight that a floating target absorbs macro shocks that a fixed peg cannot. RAI proved the concept works for a single-mechanism stable asset. JUL compounds it with PoW floors and elastic rebase.

**Dual oracle cross-reference**: The PI controller references both an electricity cost oracle and a CPI purchasing power oracle. Each constrains the other. If CPI diverges from electricity cost (indicating either energy market disruption or monetary inflation), the dual reference prevents the controller from chasing a single distorted signal. This is a form of oracle diversity that goes beyond the standard Chainlink/TWAP redundancy — it cross-references fundamentally different economic indicators.

**Why three layers instead of one**: Each layer targets a different timescale. PoW mining sets a long-term thermodynamic floor (months to years). The PI controller absorbs medium-term macro shifts (weeks to months). Elastic rebase handles short-term demand shocks (hours to days). Alone, each has known failure modes: PoW floors can be temporarily breached by sell pressure, PI controllers can oscillate, rebase creates predictable arbitrage. Together, they bound volatility to the variance of global electricity costs — tight enough that rebase adjustments become imperceptible (1-3% after double dampening). The formal argument is that three independent error-correction systems with complementary frequency responses produce a composite stability region that is the intersection of their individual stability regions.

**What JUL is not**: It is not a store of value in the appreciation sense. Holding JUL will not make you rich. Spending JUL will not cost you opportunity. It maintains purchasing power, not price appreciation. This is a feature. A medium of exchange that appreciates creates Gresham's Law dynamics — everyone hoards, nobody spends, and the "currency" becomes a speculative asset. JUL is designed to be the money you actually use without regret.

---

## 4. Knowledge-Economy Token — Operational Utility

**Monetary policy**: Disinflationary with supply recycling.

The third token funds and governs the protocol's knowledge infrastructure — the shared intelligence substrate that powers AI agent computation, on-chain attestation, and data curation. Its monetary policy is inspired by a specific L1 cryptoeconomic model: primary issuance halves like Bitcoin (long-term scarcity), while constant secondary issuance funds perpetual network operations. A DAO compensation mechanism makes long-term stakers immune to secondary inflation by returning proportional issuance. The inflation only dilutes liquid tokens held passively — functioning as implicit state rent.

This is not elastic (supply does not respond to demand) and not hard-capped (secondary issuance is perpetual). It threads a needle that matters for any token funding ongoing operations: perpetual revenue without unbounded inflation. Engaged participants are made whole. Free riders are diluted. The network funds its own security without destroying scarcity for those who use it.

This token is deployed on an alternative L1 whose cell-based architecture is optimized for state storage and knowledge representation. It is mentioned here for completeness but is not the focus of this post. The mechanism design questions around perpetual-funding-without-dilution are relevant to any Ethereum L2 considering how to fund ongoing public goods.

---

## 5. Why Three and Not One

| Function | Requirement | VIBE | JUL | Knowledge Token |
|----------|-------------|------|-----|-----------------|
| Store of Value | Scarcity, permanence | Yes | No | Partial (stakers) |
| Medium of Exchange | Stability, liquidity | No | Yes | No |
| Unit of Account | Low volatility, universality | No | Yes | No |
| Governance | Earned skin in game | Yes | No | No |
| Operational Utility | Perpetual funding | No | No | Yes |

No single column has all checkmarks. This is the design, not a limitation. Each token excels at its function precisely because it does not compromise for the others.

The interaction layer is a cross-token Shapley distribution framework. Contribute in any denomination — provide JUL liquidity, stake VIBE for governance, lock knowledge tokens for compute — and the protocol measures your marginal contribution to the cooperative game. VIBE is the universal reward for all forms of contribution, regardless of which token you operated in. JUL denominates all commerce (LP fees, API payments, agent-to-agent transactions). Knowledge tokens fund the intelligence layer through implicit rent. The tokens are not isolated economies — they are specialized instruments within a unified protocol.

---

## 6. Relation to Existing Work

**RAI** (Reflexer): Proved that a floating-target PI controller can maintain stability without a fixed peg. JUL adopts RAI's controller architecture as one of three layers. RAI's limitation was that a single stabilization mechanism is fragile to black swan shocks outside its frequency response. JUL compounds three mechanisms with complementary frequency responses.

**AMPL** (Ampleforth): Proved that elastic rebase can target a price. AMPL's limitation was that rebase-only creates predictable expansion/contraction cycles exploitable by arbitrageurs. JUL uses rebase as a short-term shock absorber within a trinomial system, not a standalone mechanism.

**OHM** (Olympus): Attempted to create a free-floating reserve currency backed by a treasury. OHM's (3,3) game theory assumed cooperative staking but produced a Ponzi dynamic where late entrants subsidized early ones. JUL sidesteps this by anchoring value to electricity cost (physics, not treasury) and using Shapley values (mathematical fairness, not (3,3) social pressure).

**Bitcoin**: The gold standard for store of value via hard cap and PoW. VIBE adopts Bitcoin's lifetime minting cap and halving schedule for the governance layer. JUL adopts Bitcoin's SHA-256 PoW for the thermodynamic floor but makes rewards proportional to difficulty rather than fixed per block.

**EIP-5805 (Votes)**: VIBE implements ERC20Votes for delegation, compatible with Governor contracts and Snapshot-style off-chain voting. The difference is distribution: VIBE is Shapley-distributed rather than airdropped, so governance weight correlates with contribution rather than early liquidity mining participation.

**Uniswap governance failures**: UNI's governance has been widely criticized for low participation, vote-buying via wrappers like Convex and Aura, and disconnection between token price and protocol decisions. The root cause is that UNI was distributed to maximize liquidity bootstrapping, not governance quality. VIBE's Shapley distribution is a direct response — governance power must be earned through measurable marginal contribution, not purchased or farmed.

---

## 7. Open Questions

**Cross-token Shapley valuation**: When a participant contributes liquidity in JUL, governs with VIBE, and locks knowledge tokens simultaneously, how should the Shapley value calculation weight these heterogeneous contributions within a single cooperative game? The standard Shapley formula assumes a common value function. We use a characteristic function that normalizes contributions by their marginal impact on protocol-wide surplus, but the cross-denomination comparison remains an open design problem. We would be interested in approaches from the mechanism design literature on multi-commodity cooperative games.

**Trinomial stability formal guarantees**: We claim empirically that three stabilization layers produce tighter bounds than any individual layer. A formal proof would require characterizing each layer as a control system with a transfer function and showing that the composite system's Bode magnitude plot has lower gain at all frequencies than any individual system. We have simulation results but not a closed-form proof. Pointers to relevant control theory literature from this community would be valuable.

**Cross-chain settlement atomicity**: VIBE lives on Ethereum/Base, JUL is chain-agnostic (mineable anywhere), and the knowledge token lives on an alternative L1. Cross-chain Shapley claims require atomic settlement across heterogeneous chains. We use LayerZero V2 for message passing, but the liveness assumptions of bridge-based settlement are weaker than native on-chain atomicity. How should cross-chain contribution claims be validated when the bridge has different finality guarantees than the source chain?

**Elastic rebase composability with DeFi**: AMPL's rebase mechanism famously breaks composability — rebasing tokens in Uniswap V2 pools cause LP losses because the AMM does not recognize the supply change. JUL's O(1) global scalar has the same composability challenge. We handle this internally via a rebase-aware AMM, but integration with external protocols (Aave, Compound, Uniswap V4 hooks) requires either wrapper tokens that absorb rebases or protocol-level support for elastic balances. EIP-4626 vaults partially address this for yield-bearing tokens. Is there appetite for a more general standard for rebase-compatible DeFi primitives?

**Governance capture resistance**: VIBE's Shapley distribution makes governance power non-purchasable at the primary market level. But secondary market purchases still allow concentration. Is Shapley distribution sufficient to prevent governance capture, or does it merely raise the cost? What is the empirical relationship between distribution mechanism and long-term governance centralization?

---

## 8. Summary

DeFi's original sin is forcing one token to be simultaneously scarce, stable, and elastic. These are contradictory monetary policies. The result is tokens that are mediocre at all three functions — volatile governance tokens that nobody governs with, "stable" coins backed by depreciating fiat, and "utility" tokens whose utility is holding them and hoping someone else buys.

The fix is compositional: one token per function, each with a monetary policy designed for exactly that job, deployed on the chain whose architecture matches. A hard-capped Shapley-distributed governance token for store of value. A trinomial-stabilized mineable token for medium of exchange. A disinflationary recycling token for operational funding. Three tokens, three policies, one protocol.

This is not novel economics — it is classical monetary theory applied with the precision that programmable money enables. Hayek argued for competing currencies. We argue for cooperating currencies within a single protocol, each optimized for its function and connected through a unified contribution measurement framework.

---

## References

- [VIBEToken.sol — 21M Lifetime Cap, ERC20Votes, UUPS](https://github.com/WGlynn/VibeSwap)
- [Joule.sol — Trinomial Stability (PoW + Rebase + PI Controller)](https://github.com/WGlynn/VibeSwap)
- [ShapleyDistributor.sol — Cooperative Game Distribution](https://github.com/WGlynn/VibeSwap)
- [EIP-5805: Voting with delegation](https://eips.ethereum.org/EIPS/eip-5805)
- [EIP-2612: Permit (gasless approvals)](https://eips.ethereum.org/EIPS/eip-2612)
- [RAI — Reflexer Protocol](https://reflexer.finance)
- [AMPL — Ampleforth](https://www.ampleforth.org)
- [Ergon — Proportional PoW](https://ergon.moe)
- [Shapley, L.S. (1953). "A Value for n-Person Games"](https://doi.org/10.1515/9781400881970-018)
- [Hayek, F.A. (1976). "Denationalisation of Money"](https://mises.org/library/denationalisation-money)
