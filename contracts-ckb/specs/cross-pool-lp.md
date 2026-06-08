# Cross-Pool LP — CKB Cell Spec

**Spec layer**: extends `contracts/amm/VibeLP.sol` to span multiple pools
**Port classification**: BUILD-NEW
**Status**: Spec draft. Extension 4b of the match-or-beat-CoW plan.
**Substrate**: VibeSwap-augmented Nervos CKB

---

## What this mechanism does

A single LP cell can provide liquidity to multiple correlated pool pairs simultaneously and earn aggregated rewards from all of them. The cell holds a portfolio of position shares, not a single pool's share.

This captures the "I provide liquidity broadly across an asset basket" pattern. A user who wants to be an LP for ETH-related pairs can hold a single CrossPoolLPCell that participates in ETH/USDC, ETH/BTC, ETH/DAI, ETH/USDT, and so on. Adds and removes are atomic across the basket.

The structural property is that a sticky-across-the-basket LP gets recognized as such by the Shapley distribution. CoW doesn't have first-party LPs; we have first-party LPs with portfolio-level identity.

## Cell architecture

**CrossPoolLPCell**: a new cell that holds the user's positions across multiple pools as a portfolio.

**One CrossPoolLPCell per user per portfolio.** Multiple cells per user are allowed if they want separate portfolios with different rebalance strategies.

The cell does NOT replace single-pool VibeLPCells. Both coexist:
- Single-pool LP: VibeLPCell, share of one pool, standard semantics.
- Cross-pool LP: CrossPoolLPCell, portfolio of positions, this spec.

## Per-cell specifications

### CrossPoolLPCell

**Data layout** (cell-data):
- `version: u8`
- `portfolio_id: [u8; 32]` (user-chosen identifier)
- `owner_lock_hash: [u8; 32]`
- `positions: Vec<Position>`
  - per position: `pool_id: [u8; 32]`, `share_amount: u128`, `entry_block: u64`, `entry_share_price: u128`
- `total_basket_weight: u128` (computed: sum of share_amount × pool's relative weight)
- `last_rebalance_block: u64`

**Lock-script**: Owner's lock-script (Omnilock).

**Type-script invariants**:

*Universal*:
- All `pool_id`s in positions reference existing PoolCells (via cell-dep at read time)
- No duplicate pool_ids in a single portfolio
- `total_basket_weight` is correctly computed from the per-position shares and the pools' canonical weights (read from Lawson constants registry: `cross_pool_lp_weights` table)

*Add position to portfolio*:
- Owner signature in witness
- New position's pool_id is in the configured `eligible_pools` set for this portfolio (configured by the Lawson constants registry, governance-tunable)
- Position's share_amount is correctly computed from the user's token contributions to that pool
- Position is appended (no duplicate pool_id check)
- `entry_share_price` captured at add for fee/yield accounting

*Remove position from portfolio*:
- Owner signature
- Position's removal correctly returns tokens to the user based on the pool's current share price
- Realized fees and rewards earned during the position's tenure are paid out (Shapley-distributed per `shapley-distributor.md`)
- Position removed from the portfolio array

*Rebalance within portfolio*:
- Owner signature
- Multiple positions can be added and removed in a single transaction
- Net token flow respects token conservation
- All affected pools' PoolCells are consumed and re-created with updated reserves
- `last_rebalance_block` updated

*Single-cell representation*:
- The single CrossPoolLPCell encodes the entire portfolio; standard CKB UTXO semantics apply (consume + recreate on every change)

## Shapley distribution integration

The Shapley distributor recognizes cross-pool LP positions as a richer participant type with portfolio-level scoring.

**Recall the value function from `shapley-distributor.md`**:
- 40% DIRECT (stake)
- 30% ENABLING (timeInPool)
- 20% SCARCITY (scarce-side provision)
- 10% STABILITY (stayed-during-vol)
- Pioneer multiplier ≤ 2x

**Cross-pool LPs receive an additional weighting**: a basket-stability score that captures their persistence across the entire basket, not just a single pool.

The basket-stability score is computed as:
```
basket_stability = (current_block - earliest_position.entry_block) × diversity_factor
```
where `diversity_factor` scales with the number of pools in the portfolio (sub-linearly, to avoid gaming via dust positions in many pools).

Cross-pool LPs whose positions span N pools and have held for T blocks get a multiplier (1 + α · log(N) · sqrt(T)) applied to their cumulative weighted contribution. α is a Lawson constant, bounded.

**Why this is honest**: a portfolio LP IS providing more enabling contribution than a single-pool LP of equivalent stake, because they're absorbing volatility correlated across the basket. The Shapley axioms apply naturally; the value function's design captures the increased contribution.

## Thin-pool fee subsidy interaction

A cross-pool LP automatically participates in any thin-pool fee subsidies (see `thin-pool-fee-subsidy.md`) that the constituent pools are eligible for. The subsidy flows through to the portfolio without per-pool claim.

## Transaction shapes

**Create portfolio**: user's first cross-pool LP transaction.
- Inputs: user's tokens needed for each initial position, capacity for the new CrossPoolLPCell
- Outputs: CrossPoolLPCell with all initial positions, updated PoolCells for each pool

**Add position to existing portfolio**:
- Inputs: existing CrossPoolLPCell, user's tokens for the new position, target PoolCell
- Outputs: updated CrossPoolLPCell with new position appended, updated PoolCell

**Remove position from portfolio**:
- Inputs: existing CrossPoolLPCell, target PoolCell
- Outputs: updated CrossPoolLPCell with position removed, updated PoolCell, user's removed-position tokens

**Rebalance**:
- Inputs: CrossPoolLPCell, all affected PoolCells, capacity for net token movements
- Outputs: updated CrossPoolLPCell with new position set, updated PoolCells, user's net residual tokens

**Claim portfolio rewards** (from Shapley distribution events):
- Inputs: ContributionEventCell mentioning this CrossPoolLPCell as a participant, the CrossPoolLPCell
- Outputs: RewardClaimCell to the user, updated CrossPoolLPCell with claim history

## Property preservation

**Atomic basket updates**: rebalance is one transaction; partial fills don't happen. Either the entire rebalance lands or none of it does.

**Identity preservation across positions**: the portfolio is one identity for Shapley purposes. Sticky-across-the-basket gets recognized; mercenary stake-and-flee gets penalized.

**No double-counting**: each position contributes to exactly one pool's share supply. A portfolio holding 100 share of ETH/USDC and 100 share of ETH/BTC has 100 share in each pool, not 200 anywhere.

**Permissionless**: anyone can create a portfolio; pool eligibility is governance-tunable but baseline is "any active pool."

## Beats CoW

CoW Protocol has no first-party LPs. Their depth comes from external DEXes. They cannot reward LPs for portfolio-level identity because the LPs aren't theirs.

VibeSwap's portfolio-level LP identity rewards exactly the behavior that makes for resilient market depth: distributed liquidity provision across correlated pairs, held through volatility, sticky-by-construction.

CoW LPs (in the DEXes CoW routes to) provide liquidity to a single pool each. They don't get rewarded for diversification. We do.

## Upstream pulls

**From sUDT/xUDT**: token reserves.

**From the existing VibeAMM spec**: PoolCell, VibeLPCell base.

**From the existing ShapleyDistributor spec**: ContributionEventCell + RewardClaimCell.

**From `ckb-std`**: cell inspection, signature verification.

**From Lawson constants**: `cross_pool_lp_weights`, `eligible_pools`, basket-stability multiplier `α`.

## Build new

**`vibeswap-ckb-cross-pool-lp-type-script`**: Rust crate. Portfolio management, basket-weight computation, basket-stability score derivation.

**Extension to `shapley-distributor-type-script`**: recognize cross-pool LP cells as participants with the basket-stability multiplier.

## Open questions

- **Eligible pools governance**: should it be permissionless (any active pool) or governance-curated (only "blessed" baskets)? Default to permissionless with anti-spam protection via minimum-position-size; revisit if spam becomes a problem.
- **Basket-stability multiplier calibration**: the `α` coefficient and the diversity_factor curve. Need empirical data to tune. Conservative initial value.
- **Cross-pool impermanent loss**: a portfolio LP eats IL across multiple pools. The Shapley reward should compensate, but the exact compensation curve is open. Worst case is documented; LPs choose their basket knowing the risk.
- **Rebalance gas cost**: rebalancing N positions in one transaction has linear cost in N. Cap N per transaction; LPs can rebalance in batches if portfolio is very large.

## Cross-references

- Parent spec: `vibeswap/contracts-ckb/specs/vibe-amm.md`, `shapley-distributor.md`
- Sibling specs (this batch): `multi-curve-amm.md`, `thin-pool-fee-subsidy.md`
- Composes with: `batch-cycle-resolver.md` (cross-pool LPs benefit from cycle netting just like single-pool LPs)
- Plan doc: `Desktop/vibeswap-match-or-beat-cow-mechanism-plan-2026-06-08.md` (Extension 4b)
- Mechanism primitives: `[P·shapley-5-axiom-set]` (basket-stability is a richer value function), `[P·structure-does-the-work]` (portfolio identity is structurally rewarded), `[P·dont-default-concede-verify-first]` (this is a CoW-cannot-match capability, not parity)
