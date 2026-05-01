# USD8 Cover Pool — Candidate Protocol Shortlist

*Working draft · 2026-04-30 · Subject to revision after USD8 confirms cover-pool target capacity*

## TL;DR

Candidate protocols qualify under USD8's three-filter screen: (1) underlying asset is top-100 by market cap, (2) protocol has demonstrated credibility (audit history, governance maturity, no unresolved incidents), (3) yield on the covered position is low (interpreted as both *premium-math-closes* AND *risk-screening proxy*).

Six lending/borrowing protocols anchor the shortlist; with the top-100-asset scope confirmed (BTC and ETH inclusive), each protocol now contributes multiple coverable market classes (wBTC supply, ETH supply, stablecoin supply). Two ETH-staking protocols (Lido, Rocket Pool) re-enter scope under the expanded asset universe.

**Recommended approach order:** Sky → Spark → Aave → Compound → Morpho (conservative vaults only) → Fluid. Lido / Rocket Pool join as a Phase 2 sequence once the cover-pool denomination architecture is locked.

**Five questions outstanding for USD8:**
1. Cover-pool target capacity range
2. Coverage-event scope (smart-contract exploit only, or also oracle / governance / bridge / depeg)
3. **Cover-pool denomination architecture** — single USD pool with oracle conversion, or per-asset-class sub-pools (USD / ETH / BTC)
4. **Cross-provider subrogation mechanism** — required to enforce the no-double-claim invariant against peer cover products
5. Cross-chain scope (Mainnet + L2 only, or also Solana / Sui / Aptos)

---

## Why timing matters

The April 18, 2026 KelpDAO exploit ($292M, originating from a single-verifier LayerZero bridge configuration) triggered emergency rsETH market freezes across Aave, Spark, Fluid, Morpho, Compound, and Euler within hours. Aave subsequently launched a $200M bad-debt coverage fundraise, raising approximately 80% by late April. The "DeFi United" coalition (Aave, EtherFi, Lido, Ethena, Mantle, Ink, BGD) formed in the immediate aftermath to coordinate mutual-defense.

The implication for cover-pool BD: every Tier 1 candidate on this shortlist just experienced, in real time, the exact failure mode cover-pool products exist to absorb. The framing *"a cover-pool product would have absorbed this loss class"* is uniquely receptive in this window. Six months from now, internal reserves rebuild and institutional memory dulls.

---

## Filter methodology

Three-filter screen, applied in series:

- **Top-100 asset filter.** Underlying covered asset is top-100 by market capitalization. BTC and ETH inclusive. This is the credibility floor at the asset layer.
- **Protocol credibility filter.** Audit history, governance maturity, age, no unresolved security incidents. Screens out top-100 assets paired with immature or unaudited protocols (e.g., a memecoin lending market on a fresh protocol fails this even if the token is top-100).
- **Low-yield filter.** Two senses, both pulling the same direction:
  - **Premium-economics.** Cover-pool LPs need competitive yield. Covering a 15% APY position requires the cover pool to pay 16%+ to attract LPs — that premium has to come from the covered protocol's insurance fee, USD8 subsidy, or end-user pricing, and the math does not close at high underlying yields. Low yield = premium math closes.
  - **Risk-screening.** In DeFi, yield correlates with risk: high yield typically signals immature code, mercenary capital, token-emission inflation, or recursive leverage. Low yield signals mature, audited protocols with real organic borrow demand. Low yield = the position is one you'd actually want to cover.

The two senses of low-yield coincide. This is structural — not a tradeoff to balance, a single criterion that selects correctly on both axes. (Discussed in `primitive_filter_coincidence_as_structural_edge.md`.) The expansion to top-100-asset scope generalizes the original stablecoin-only filter without weakening it: the same filter-coincidence holds across asset classes.

**Applied screen:** position yield 0.5–6%, protocol TVL ≥ $500M, no active unresolved bad debt, audit history clean or with documented recovery.

---

## Shortlist (data current as of 2026-04-30)

### Tier 1 — Lending/borrowing markets (multi-asset coverage scope per protocol)

| # | Protocol | TVL | Coverable market classes | Yield range | Governance | Notes |
|---|----------|-----|--------------------------|-------------|------------|-------|
| 1 | **Sky / sUSDS** | $5.4B Sky Lending + $10B+ sUSDS supply | sUSDS savings, Sky Lending stable markets | 4.0–4.5% (governance-set) | DAO (SKY holders) | Governance-set rate means predictable cover pricing. Recent Privy/Stripe distribution partnership signals openness to integrations. |
| 2 | **Spark / SparkLend** | $7.9B | Stable supply, ETH supply, wBTC supply | 1–4.75% (varies by asset) | DAO (Sky-aligned) | Sky-adjacent — likely a faster yes once Sky has greenlit. Pivoting toward institutional liquidity. |
| 3 | **Aave V3** | $13.8B (down from $26.4B pre-Kelp) | Stable supply, ETH supply, wBTC supply across multiple chains | 0.5–6% (varies by asset/chain) | DAO (Aave Governance) | Mid-fundraise for Kelp bad debt; leading the DeFi United coalition. Pitch lands now in a way it will not in six months. |
| 4 | **Compound V3** | $1.3B | Stable supply, ETH supply, wBTC supply | 0.5–5% (varies by asset) | DAO (COMP holders) | Low historical exploit incidence; Gauntlet-managed risk parameters; conservative governance. |
| 5 | **Morpho Blue** | $7B (only conservative curator vaults qualify under filter) | Curated vaults across asset classes | 4–6% (Steakhouse, Block Analitica) | Curator marketplace + DAO | Modular — coverage scopes per-vault, not protocol-wide. Strong institutional integration history. |
| 6 | **Fluid (Instadapp)** | ~$6B | Smart-collateral markets across asset classes | 1–5% (varies by asset) | Token (FLUID), Foundation in formation | Demonstrated event-resolution discipline (Resolv-hack debt repayment, March 2026). |

### Tier 2 — ETH-staking protocols (re-entered under expanded scope)

| # | Protocol | TVL | Coverable position | Yield | Governance | Notes |
|---|----------|-----|-------------------|-------|------------|-------|
| 7 | **Lido (stETH)** | $30B+ | stETH-denominated staking position | ~3% APR | DAO (LDO holders) | Largest LST by TVL. Coverage requires the cover-pool denomination decision to be locked first (currency-risk constraint, see below). |
| 8 | **Rocket Pool (rETH)** | $3B+ | rETH-denominated staking position | ~3.5% APR | DAO (RPL holders, decentralized node operator set) | Decentralized node operator architecture — different risk profile than Lido. Same denomination prerequisite. |

### Borderline — flagged but likely deferred

| Protocol | Issue |
|----------|-------|
| Marinade (mSOL), Jito (jitoSOL) | SOL is top-100, mSOL/jitoSOL credible. But staking yields 6–8% sit at the cover-pool APY ceiling — premium math gets tight. Defer until cover-pool LP yield target is locked. |

---

## Risk-correlation constraints (cover-pool sizing implications)

**Diversification by protocol name is fake. Diversification by risk class is what counts.** Four correlation buckets shape sizing:

1. **LRT collateral exposure.** Aave, Spark, Fluid, Morpho, Compound, and Euler all share liquid-restaking-token collateral exposure — the exposure class that triggered the Kelp event. Any future LRT-related exploit is a near-correlated payout trigger across the entire Tier 1 shortlist. **This is the single most important cover-pool sizing constraint.**
2. **USDS/DAI dependency.** Sky, Spark, and Aave all depend on USDS/DAI. Treat as one risk bucket; do not double-count diversification across them.
3. **Risk-curator concentration.** Sky, Spark, Morpho, and Compound V3 all rely on Gauntlet or Block Analitica for risk parameter curation. Curator failure is a correlated tail risk.
4. **ETH-consensus failure.** Lido, Rocket Pool, and any ETH-staking exposure inside Tier 1 lending markets (e.g., Aave's stETH collateral pool) all correlate on ETH-consensus-layer events (mass slashing, finality failure, validator-set incidents). Worth a fourth bucket once Tier 2 enters scope.

Cover-pool capacity should be allocated against risk-class exposure, not against headline TVL of covered protocols.

---

## Cover-pool denomination — open architectural decision

Expanding scope to BTC- and ETH-denominated coverable positions surfaces a denomination choice the cover pool architecture must resolve before Tier 2 (ETH staking) outreach can begin:

- **Option A — Single USD-denominated pool with oracle conversion at event time.** Cover pool stays denominated in USD8 (or stablecoins). When a non-USD position is covered, payout converts at the oracle-attested USD-equivalent at the moment of the loss event. *Mechanically simple; introduces oracle dependency and ETH/BTC price-volatility on the cover-pool balance sheet.*
- **Option B — Per-asset-class sub-pools.** Separate cover sub-pools per denomination (USD pool, ETH pool, BTC pool), each capitalized in its own asset, each with its own LP base. *Cleaner currency-risk isolation; fragments capital; requires three separate LP recruitment efforts.*

This decision flows from USD8's scope expansion and shapes the financial model differently in each direction. Recommended placement on the call agenda before Lido / Rocket Pool outreach commences.

---

## Cross-provider subrogation — required architectural addition

The originally-shipped 5-invariant stack addressed *intra-USD8* attacks (attacker accumulating cover position then triggering self-attack). It does not address *inter-provider* double-claiming: same loss event, multiple cover products paying out to the same claimant independently, total payouts compounding to exceed actual loss.

**Required invariant (proposed addition as #6):**

> ∀ claimant, ∀ loss-event E, Σ payouts_from_all_cover_providers(claimant, E) ≤ actual_loss_borne(claimant, E)

**Mechanism — on-chain subrogation:** at payout, the smart contract atomically transfers the claimant's rights against peer cover providers for this loss event to USD8. USD8 (now the rightful claim-holder) submits claims to peer providers. Peer providers verify the rights-transfer before paying. Net effect: claimant receives total loss amount once, providers split the payout proportionally, no double-claim possible because the rights-transfer at payout invalidates downstream claims.

This is the same anti-double-spend pattern as Bitcoin's UTXO model — once spent, the right is invalidated. It is also the same mechanism traditional insurance has used for two centuries (subrogation), now smart-contract-enforced.

**Implementation phasing:**

- *Phase 1.* Bilateral subrogation agreement between USD8 and one peer cover provider (e.g., Nexus Mutual, where applicable). Demonstrates the mechanism, establishes the contract pattern.
- *Phase 2.* Multi-party consortium with a shared on-chain claims registry. All participants verify against the registry before paying.
- *Phase 3.* Oracle-attested loss-event registry (loss verified once, total cap enforced across all providers without provider cooperation).

This addition does not yet exist in the cover-pool architecture and is flagged as a required design ask.

---

## Skip list

| Protocol | Reason |
|----------|--------|
| Ethena USDe | $3.89B TVL but 8–15% basis-trade yield. Funding-rate inversion = full-pool drawdown event. **Active risk to a cover pool, not coverable.** |
| Pendle | $1.48B TVL but yield-tokenization, not low-yield position. Wrong primitive fit. |
| EigenLayer / Kelp / EtherFi | Just demonstrated the failure mode. Not coverable. |
| Curve crvUSD pools / Uniswap V3 stable pairs | DEX LP positions — IL + LP-specific risk model does not fit "covered protocol exploit" coverage scope. |
| Euler V2 | $370M TVL — below the $500M floor. Strong audit history, but had a $197M exploit in March 2023. Revisit if TVL crosses the floor. |
| Kamino Lend | $1.41B TVL, Solana-only. Chain-risk dimension complicates the cover model. Phase 2 candidate if Solana exposure becomes an explicit goal. |
| Memecoin lending markets (top-100 by mcap but failing credibility filter) | Top-100 market cap is necessary but not sufficient. The credibility filter screens these out. |

---

## Recommended outreach sequence

| Step | Target | Hook | Notes |
|------|--------|------|-------|
| 1 | Sky | Distribution-partner alignment; governance-set rate enables predictable cover pricing | Cleanest first conversation. |
| 2 | Spark | Sky's commitment is the wedge | Shorter cycle once Sky lands. |
| 3 | Aave | *"A cover-pool product would have absorbed the Kelp loss class"* | Time-sensitive — this framing weakens as Kelp recedes. |
| 4 | Compound, Morpho (curated vaults), Fluid | Fill out the pool | Do not lead with these; reference partnerships earned in steps 1–3 carry the conversation. |
| 5 | Lido, Rocket Pool | Phase 2 outreach | Gated on cover-pool denomination decision (Option A vs Option B above). |

Approaching Aave first with zero reference partnerships is a polite no. Approaching Aave with two live partnerships is a real conversation.

---

## Open questions for USD8

The five answers below determine whether this shortlist is correct or whether material revision is needed:

1. **Cover-pool target capacity range.** Below $50M: focus shifts to Morpho conservative-curator vaults and Fluid for tightly-scoped coverage. $50M–$500M: Tier 1 + Tier 2 mix. $500M+: Tier 1 is the credible list (Aave alone carries $13.8B exposure — coverage must be sized to be meaningful).
2. **Coverage-event scope definition.** "Covered protocol exploit" needs scoping. Smart-contract exploit only, or also oracle failure, governance attack, bridge failure, depeg events? Each expansion changes the premium-math.
3. **Cover-pool denomination architecture.** Single USD-denominated pool with oracle conversion, or per-asset-class sub-pools? Decision blocks Tier 2 ETH-staking outreach.
4. **Cross-provider subrogation mechanism.** Bilateral first vs multi-party consortium vs oracle-registry — and which peer cover providers to begin negotiation with for Phase 1.
5. **Cross-chain scope.** Mainnet + L2 only (Sky, Spark, Aave, Compound, Morpho, Fluid, Lido, Rocket Pool all qualify), or does Phase 1 include Solana / Sui / Aptos (each adds a chain-risk dimension that complicates the cover model)?

---

## Sources

- DefiLlama protocol pages: [Aave V3](https://defillama.com/protocol/aave-v3) · [Morpho](https://defillama.com/protocol/morpho) · [Spark](https://defillama.com/protocol/spark) · [Fluid](https://defillama.com/protocol/fluid) · [Euler](https://defillama.com/protocol/euler) · [Compound V3 yields (Aavescan)](https://aavescan.com/rates/compound-v3-ethereum-usdc)
- Sky Savings Rate: [sky.money/susds](https://sky.money/susds)
- Sky / Privy / Stripe partnership announcement: [PR Newswire, March 2026](https://www.prnewswire.com/news-releases/sky-savings-rate-now-available-to-all-developers-building-on-privy-a-stripe-company-302706752.html)
- KelpDAO exploit and Aave bad-debt fundraise: [CoinDesk, April 20 2026](https://www.coindesk.com/tech/2026/04/20/aave-could-face-up-to-usd230-million-in-losses-after-kelp-dao-bridge-exploit-triggers-defi-chaos) · [CoinDesk, April 26 2026](https://www.coindesk.com/business/2026/04/26/aave-raises-nearly-80-of-the-usd200-million-it-needs-to-cover-bad-debt-left-by-kelp-dao-exploit)
- DeFi contagion analysis: [FinanceFeeds, April 2026](https://financefeeds.com/defi-contagion-risk-in-2026-inside-the-kelp-dao-aave-crisis/)
- rsETH incident report: [Aave Governance Forum](https://governance.aave.com/t/rseth-incident-report-april-20-2026/24580)
- Lido stETH yield: [DefiLlama yields](https://defillama.com/yields/pool/747c1d2a-c668-4682-b9f9-296708a3dd90)
