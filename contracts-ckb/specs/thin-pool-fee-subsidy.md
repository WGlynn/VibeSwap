# Thin-Pool Fee Subsidy — CKB Cell Spec

**Spec layer**: extends `contracts/incentives/EmissionController.sol` to fund thin-pool depth bootstrapping
**Port classification**: BUILD-NEW
**Status**: Spec draft. Extension 4c of the match-or-beat-CoW plan.
**Substrate**: VibeSwap-augmented Nervos CKB

---

## What this mechanism does

Pools below a configured depth threshold automatically receive a temporary fee multiplier from protocol emissions, distributed Shapley-weighted to that pool's LPs. The subsidy bootstraps depth without inflation, because it draws from emissions that exist anyway under the TOKEN_EMISSION track in `shapley-distributor.md`.

The structural property: pools with shallow liquidity get an emission boost that LPs can earn. This pulls LP capital toward pools where the protocol needs depth, structurally and without governance discretion. CoW has no analogous mechanism because they don't have first-party LPs to subsidize.

## Cell architecture

**Single ThinPoolSubsidyRegistryCell**: tracks which pools are currently in subsidized state and the subsidy parameters. Updated automatically as pools cross depth thresholds.

**EmissionRouterCell**: routes a configured slice of each TOKEN_EMISSION event's value to active subsidies before the standard ShapleyDistributor allocation runs.

## Mechanism

**Depth measurement**:
- A pool's depth is measured by total LP-share-supply-weighted volume in the last N blocks
- The measurement window is governance-tunable (default: ~7 days of blocks)
- "Depth" is a single number per pool, comparable across pools after normalization to USD or another canonical unit (via an oracle reading)

**Subsidy thresholds** (Lawson constants):
- `MIN_DEPTH_USD`: pools below this absolute depth are eligible for the strong subsidy
- `MIN_RELATIVE_DEPTH_BPS`: pools whose depth is below this fraction of the median pool depth are eligible for the relative subsidy
- A pool can be in both states simultaneously (combined multiplier)

**Subsidy intensity**:
- The subsidy fee multiplier scales inversely with the gap between the pool's depth and the threshold
- Smaller gap (closer to threshold) = smaller multiplier
- Larger gap (much thinner) = larger multiplier
- Capped by `MAX_SUBSIDY_MULTIPLIER` (default 5x; pool LPs earn up to 5x their pro-rata of the subsidy pool)

**Subsidy decay**:
- A pool that becomes thin gets subsidy immediately
- As LP capital flows in and the pool's depth grows past the threshold, the subsidy decays gradually
- This prevents abrupt cliff effects where LPs withdraw the moment the threshold crosses

## Per-cell specifications

### ThinPoolSubsidyRegistryCell

**Data layout** (cell-data):
- `version: u8`
- `subsidized_pools: Vec<SubsidyEntry>`
  - per entry: `pool_id: [u8; 32]`, `current_multiplier_bps: u16`, `last_recomputed_block: u64`, `depth_at_last_recompute: u128`
- `median_pool_depth: u128` (cached; refreshed periodically)
- `last_median_refresh_block: u64`

**Lock-script**: Permissionless. Anyone can construct the recomputation transaction.

**Type-script invariants** (universal):
- The set of subsidized pools matches the current depth criteria as of the latest recomputation
- The multipliers correctly reflect the gap between each pool's depth and the threshold
- Median is refreshed at least every `MEDIAN_REFRESH_INTERVAL` blocks

**Type-script invariants** (at recomputation):
- A pool enters the subsidized set if its depth drops below threshold (any of the criteria)
- A pool leaves the subsidized set when its depth rises above threshold + a hysteresis margin
- The multiplier for each pool is computed deterministically from its depth and the registered thresholds
- The transition is one-way per event: a pool can't add and remove subsidy in the same recomputation

### EmissionRouterCell

**Data layout** (cell-data):
- `version: u8`
- `current_era: u64`
- `subsidy_pool_balance: u128` (accumulated emission share waiting to be distributed)
- `subsidy_share_bps: u16` (fraction of each TOKEN_EMISSION event routed to subsidies; e.g., 1000 = 10%)

**Lock-script**: Permissionless.

**Type-script invariants**:
- On each TOKEN_EMISSION event, the configured fraction is added to `subsidy_pool_balance` BEFORE the standard ShapleyDistributor allocation runs
- The standard ShapleyDistributor sees only the post-subsidy emission for distribution
- `subsidy_share_bps` is Lawson-constants-bounded (default 1000 bps; max 2500)

## Subsidy distribution

When the subsidy_pool_balance accumulates and the recomputation transaction runs:

- For each subsidized pool, compute its allocated subsidy share = balance × pool_multiplier / sum_of_multipliers
- For each allocated share, create a ContributionEventCell with `event_type = FEE_DISTRIBUTION` and `participants` = the pool's current LP holders
- The standard ShapleyDistributor runs on each event, distributing the subsidy according to the 5-axiom Shapley value function (40% direct + 30% enabling + 20% scarcity + 10% stability + Pioneer)
- LPs receive RewardClaimCells

The full Shapley value function applies. Sticky LPs in thin pools get the largest share. Mercenary stake-and-flee LPs get less.

## Property preservation

**No inflation**: the subsidy draws from emissions that would otherwise be distributed via the standard TOKEN_EMISSION track. Total emission per era is unchanged; the subsidy is a redistribution within emissions.

**Structurally targeted**: thin pools that the protocol needs to grow get the subsidy. There's no human governance decision; the criteria are mechanical.

**Self-decaying**: as LP capital flows in and the pool grows past threshold, the subsidy decays. No need for governance to "turn off" the subsidy.

**Shapley-internal**: subsidy distribution uses the same 5-axiom Shapley value function as the rest of the protocol. Sticky-during-vol LPs in thin pools get the biggest reward, which is exactly the LP behavior the protocol needs.

**Permissionless recomputation**: anyone can construct the recomputation transaction; the type-script catches any incorrect update.

## Beats CoW

CoW Protocol's LPs are in external DEXes. CoW has no way to redistribute incentives to depth-thin pools because it doesn't own the pools. Pool LPs on Uniswap etc. don't earn from CoW order flow specifically.

VibeSwap can structurally pull liquidity to where it's needed via the subsidy mechanism. Over time, the subsidy makes shallow VibeSwap pools competitively deep, closing the depth gap with CoW's borrowed-liquidity model.

## Transaction shapes

**Recomputation transaction**: permissionless, scheduled by `MEDIAN_REFRESH_INTERVAL`.
- Inputs: previous ThinPoolSubsidyRegistryCell
- Outputs: updated ThinPoolSubsidyRegistryCell
- Cell-deps: all active PoolCells (or a top-K subset by depth; full traversal is bounded by pool count)
- Type-script verifies depth measurements and threshold logic

**Subsidy event spawning**: per accumulation cycle.
- Inputs: EmissionRouterCell, ThinPoolSubsidyRegistryCell (read-only via cell-dep)
- Outputs: per-pool ContributionEventCells (FEE_DISTRIBUTION type with subsidy as totalValue), updated EmissionRouterCell with reset balance

**Subsidy claim**: per LP.
- Same as standard ShapleyDistributor RewardClaim path. No special semantics.

## Upstream pulls

**From the existing ShapleyDistributor spec**: ContributionEventCell + RewardClaimCell + EmissionScheduleCell.

**From oracle**: USD or canonical-unit price feeds for depth normalization.

**From `ckb-std`**: syscalls, hashing.

**From Lawson constants**: `MIN_DEPTH_USD`, `MIN_RELATIVE_DEPTH_BPS`, `MAX_SUBSIDY_MULTIPLIER`, `subsidy_share_bps`, `MEDIAN_REFRESH_INTERVAL`.

## Build new

**`vibeswap-ckb-thin-pool-subsidy-registry-type-script`**: Rust crate. Depth measurement, threshold detection, multiplier computation, hysteresis, recomputation.

**`vibeswap-ckb-emission-router-type-script`**: Rust crate. Routes emission slices to the subsidy balance before standard allocation.

## Open questions

- **Depth measurement window**: 7 days is a guess. Tune empirically; volatile periods may need shorter windows.
- **Subsidy share split**: 10% of emissions is the default. Adjust based on observed effectiveness.
- **Oracle dependency for USD normalization**: needs reliable price feeds. Could use the same oracle as TWAP validation, or a separate dedicated feed.
- **Anti-gaming**: an attacker could try to create a fake "thin pool" they fund themselves to capture subsidy. Mitigations: minimum-real-volume gate, multi-LP requirement, oracle-based fair-value check. Document carefully.
- **Hysteresis margin**: the gap between "enters subsidy" and "leaves subsidy" thresholds. Wider = less churn but slower exit. Calibrate based on observed pool dynamics.

## Cross-references

- Parent specs: `vibeswap/contracts-ckb/specs/shapley-distributor.md`, `vibe-amm.md`
- Sibling specs (this batch): `multi-curve-amm.md`, `cross-pool-lp.md`
- Composes with: `cross-pool-lp.md` (cross-pool LPs in a subsidized pool benefit automatically)
- Plan doc: `Desktop/vibeswap-match-or-beat-cow-mechanism-plan-2026-06-08.md` (Extension 4c)
- Lawson constants: subsidy parameters all bounded
- Mechanism primitives: `[P·structure-does-the-work]` (depth concentration is structurally pulled, not governance-allocated), `[P·shapley-5-axiom-set]` (subsidy distribution uses the same value function)
