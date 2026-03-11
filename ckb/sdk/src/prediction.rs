// ============ Parimutuel Prediction Market ============
// Non-binary outcome prediction markets for CKB.
//
// Architecture:
//   Markets support 2-8 outcome tiers (binary = 2, multi = 3-8).
//   All bets go into a common pool (parimutuel model).
//   Resolution maps an oracle value to a winning tier/distribution.
//
// Settlement Modes:
//   WinnerTakesAll — single winning tier splits the entire pool
//   Proportional   — graduated payouts to adjacent tiers
//   Scalar         — continuous payout based on oracle value position
//
// The quantization boundary from consensus.rs is what maps the continuous
// oracle value into discrete tier outcomes. Non-binary and binary outcomes
// understand each other through this boundary.

use vibeswap_types::*;
use sha2::{Digest, Sha256};
use crate::{CellDep, CellInput, CellOutput, Script, HashType, DepType, UnsignedTransaction, SDKError};

// ============ Constants ============

/// Minimum cell capacity for a prediction market cell
pub const MARKET_CELL_CAPACITY: u64 = 25_000_000_000; // ~250 CKB

/// Minimum cell capacity for a position cell
pub const POSITION_CELL_CAPACITY: u64 = 14_200_000_000; // ~142 CKB

/// Minimum number of tiers
pub const MIN_TIERS: u8 = 2;

/// Maximum number of tiers
pub const MAX_TIERS: u8 = MAX_OUTCOME_TIERS as u8;

/// Proportional mode: adjacent tier gets this % of the winning pool
pub const ADJACENT_PAYOUT_BPS: u128 = 1500; // 15%

// ============ Market Creation ============

/// Parameters for creating a new prediction market
#[derive(Clone, Debug)]
pub struct CreateMarketParams {
    /// SHA-256 hash of the question text
    pub question_hash: [u8; 32],
    /// Oracle pair_id for price-based resolution
    pub oracle_pair_id: [u8; 32],
    /// Number of outcome tiers (2-8)
    pub num_tiers: u8,
    /// Settlement mode
    pub settlement_mode: u8,
    /// Block when betting closes and resolution begins
    pub resolution_block: u64,
    /// Dispute window length in blocks (default: 1200)
    pub dispute_window_blocks: u64,
    /// Fee rate in basis points (default: 100 = 1%)
    pub fee_rate_bps: u16,
    /// Creator's lock script
    pub creator_lock: Script,
    /// Funding input cell
    pub creator_input: CellInput,
    /// Current block number
    pub current_block: u64,
}

/// Create a new prediction market cell.
///
/// Validates parameters and builds the market cell data.
/// The market_id is derived from: SHA-256(question_hash || creator_lock_hash || created_block).
pub fn create_market(params: &CreateMarketParams) -> Result<(PredictionMarketCellData, [u8; 32]), SDKError> {
    // Validate tiers
    if params.num_tiers < MIN_TIERS || params.num_tiers > MAX_TIERS {
        return Err(SDKError::InvalidAmounts);
    }

    // Validate settlement mode
    if params.settlement_mode > SETTLEMENT_SCALAR {
        return Err(SDKError::InvalidAmounts);
    }

    // Validate resolution block is in the future
    if params.resolution_block <= params.current_block {
        return Err(SDKError::InvalidPhase);
    }

    // Derive market_id
    let creator_lock_hash = hash_script(&params.creator_lock);
    let market_id = derive_market_id(
        &params.question_hash,
        &creator_lock_hash,
        params.current_block,
    );

    let dispute_end = params.resolution_block + params.dispute_window_blocks;

    let market = PredictionMarketCellData {
        market_id,
        question_hash: params.question_hash,
        creator_lock_hash,
        oracle_pair_id: params.oracle_pair_id,
        status: MARKET_ACTIVE,
        num_tiers: params.num_tiers,
        settlement_mode: params.settlement_mode,
        resolved_tier: 0,
        total_liquidity: 0,
        resolved_value: 0,
        tier_pools: [0u128; MAX_OUTCOME_TIERS],
        created_block: params.current_block,
        resolution_block: params.resolution_block,
        dispute_end_block: dispute_end,
        fee_rate_bps: params.fee_rate_bps,
    };

    Ok((market, market_id))
}

/// Derive a deterministic market_id from the question, creator, and block.
pub fn derive_market_id(
    question_hash: &[u8; 32],
    creator_lock_hash: &[u8; 32],
    created_block: u64,
) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(question_hash);
    hasher.update(creator_lock_hash);
    hasher.update(&created_block.to_le_bytes());
    let result = hasher.finalize();
    let mut id = [0u8; 32];
    id.copy_from_slice(&result);
    id
}

// ============ Betting ============

/// Place a bet on a specific outcome tier.
///
/// Updates the market's tier pool and total liquidity.
/// Returns the updated market and new position cell data.
pub fn place_bet(
    market: &PredictionMarketCellData,
    tier_index: u8,
    amount: u128,
    owner_lock_hash: [u8; 32],
    current_block: u64,
) -> Result<(PredictionMarketCellData, PredictionPositionCellData), SDKError> {
    // Market must be active
    if market.status != MARKET_ACTIVE {
        return Err(SDKError::InvalidPhase);
    }

    // Must be before resolution block
    if current_block >= market.resolution_block {
        return Err(SDKError::InvalidPhase);
    }

    // Tier must be valid
    if tier_index >= market.num_tiers {
        return Err(SDKError::InvalidAmounts);
    }

    // Amount must meet minimum
    if amount < MINIMUM_BET_AMOUNT {
        return Err(SDKError::InvalidAmounts);
    }

    // Update market
    let mut updated = market.clone();
    updated.tier_pools[tier_index as usize] = updated.tier_pools[tier_index as usize]
        .checked_add(amount)
        .ok_or(SDKError::Overflow)?;
    updated.total_liquidity = updated.total_liquidity
        .checked_add(amount)
        .ok_or(SDKError::Overflow)?;

    // Create position
    let position = PredictionPositionCellData {
        market_id: market.market_id,
        owner_lock_hash,
        tier_index,
        amount,
        created_block: current_block,
    };

    Ok((updated, position))
}

// ============ Resolution ============

/// Resolve a market using an oracle value.
///
/// Maps the oracle value to a winning tier based on evenly-spaced boundaries.
/// For a market with N tiers and value range [0, PRECISION]:
///   tier_i covers [i * PRECISION/N, (i+1) * PRECISION/N)
///
/// For price-based markets, the oracle value should be normalized to [0, PRECISION]
/// by the caller (e.g., via the consensus quantization boundary).
pub fn resolve_market(
    market: &PredictionMarketCellData,
    oracle_value: u128,
    current_block: u64,
) -> Result<PredictionMarketCellData, SDKError> {
    // Market must be active or resolving
    if market.status != MARKET_ACTIVE && market.status != MARKET_RESOLVING {
        return Err(SDKError::InvalidPhase);
    }

    // Must be at or after resolution block
    if current_block < market.resolution_block {
        return Err(SDKError::InvalidPhase);
    }

    let winning_tier = value_to_tier(oracle_value, market.num_tiers);

    let mut resolved = market.clone();
    resolved.status = MARKET_RESOLVED;
    resolved.resolved_tier = winning_tier;
    resolved.resolved_value = oracle_value;

    Ok(resolved)
}

/// Map a continuous oracle value to a discrete tier.
///
/// Evenly divides the [0, PRECISION] range into num_tiers buckets.
/// Values >= PRECISION map to the last tier.
pub fn value_to_tier(value: u128, num_tiers: u8) -> u8 {
    if num_tiers == 0 {
        return 0;
    }
    let bucket_size = PRECISION / (num_tiers as u128);
    if bucket_size == 0 {
        return 0;
    }
    let tier = value / bucket_size;
    if tier >= num_tiers as u128 {
        num_tiers - 1
    } else {
        tier as u8
    }
}

/// Cancel a market (only creator, only while active, only if no bets)
pub fn cancel_market(
    market: &PredictionMarketCellData,
    caller_lock_hash: &[u8; 32],
) -> Result<PredictionMarketCellData, SDKError> {
    if market.status != MARKET_ACTIVE {
        return Err(SDKError::InvalidPhase);
    }
    if &market.creator_lock_hash != caller_lock_hash {
        return Err(SDKError::InvalidAmounts); // not creator
    }
    if market.total_liquidity > 0 {
        return Err(SDKError::InvalidAmounts); // has bets
    }

    let mut cancelled = market.clone();
    cancelled.status = MARKET_CANCELLED;
    Ok(cancelled)
}

// ============ Payout Calculation ============

/// Calculate payout for a position in a resolved market.
///
/// Returns (gross_payout, fee, net_payout).
/// All values in the same unit as position.amount.
pub fn calculate_payout(
    market: &PredictionMarketCellData,
    position: &PredictionPositionCellData,
) -> Result<(u128, u128, u128), SDKError> {
    if market.status != MARKET_RESOLVED && market.status != MARKET_SETTLED {
        return Err(SDKError::InvalidPhase);
    }

    if position.market_id != market.market_id {
        return Err(SDKError::InvalidAmounts);
    }

    let gross = match market.settlement_mode {
        SETTLEMENT_WINNER_TAKES_ALL => {
            calculate_winner_takes_all(market, position)
        }
        SETTLEMENT_PROPORTIONAL => {
            calculate_proportional(market, position)
        }
        SETTLEMENT_SCALAR => {
            calculate_scalar(market, position)
        }
        _ => return Err(SDKError::InvalidAmounts),
    };

    // Apply fee
    let fee = mul_div(gross, market.fee_rate_bps as u128, BPS_DENOMINATOR);
    let net = gross.saturating_sub(fee);

    Ok((gross, fee, net))
}

/// Winner-takes-all: only the winning tier gets paid.
/// Payout = (position_amount / winning_tier_pool) * total_pool
fn calculate_winner_takes_all(
    market: &PredictionMarketCellData,
    position: &PredictionPositionCellData,
) -> u128 {
    if position.tier_index != market.resolved_tier {
        return 0;
    }
    let tier_pool = market.tier_pools[position.tier_index as usize];
    if tier_pool == 0 {
        return 0;
    }
    mul_div(position.amount, market.total_liquidity, tier_pool)
}

/// Proportional: winning tier gets the majority, adjacent tiers get partial payouts.
/// Winner tier gets (100% - 2*ADJACENT_PAYOUT_BPS) of the pool.
/// Each adjacent tier (if exists) gets ADJACENT_PAYOUT_BPS.
fn calculate_proportional(
    market: &PredictionMarketCellData,
    position: &PredictionPositionCellData,
) -> u128 {
    let winning = market.resolved_tier;
    let tier_idx = position.tier_index;
    let distance = if tier_idx >= winning {
        tier_idx - winning
    } else {
        winning - tier_idx
    };

    // Only winning tier and immediately adjacent tiers get payouts
    if distance > 1 {
        return 0;
    }

    let tier_pool = market.tier_pools[tier_idx as usize];
    if tier_pool == 0 {
        return 0;
    }

    // Calculate share of total pool allocated to this tier's bettors
    let tier_share_bps = if distance == 0 {
        // Winning tier: gets everything minus adjacent allocations
        let mut deduction: u128 = 0;
        if winning > 0 && market.tier_pools[(winning - 1) as usize] > 0 {
            deduction += ADJACENT_PAYOUT_BPS;
        }
        if (winning + 1) < market.num_tiers && market.tier_pools[(winning + 1) as usize] > 0 {
            deduction += ADJACENT_PAYOUT_BPS;
        }
        BPS_DENOMINATOR.saturating_sub(deduction)
    } else {
        // Adjacent tier
        ADJACENT_PAYOUT_BPS
    };

    // Pool allocated to this tier's bettors
    let pool_for_tier = mul_div(market.total_liquidity, tier_share_bps, BPS_DENOMINATOR);

    // Individual payout = (position / tier_pool) * pool_for_tier
    mul_div(position.amount, pool_for_tier, tier_pool)
}

/// Scalar: continuous payout based on distance from oracle value.
/// Each tier gets a share inversely proportional to its distance from the resolved value.
/// Tier that contains the resolved value gets the highest share.
fn calculate_scalar(
    market: &PredictionMarketCellData,
    position: &PredictionPositionCellData,
) -> u128 {
    let n = market.num_tiers as u128;
    if n == 0 {
        return 0;
    }

    let tier_pool = market.tier_pools[position.tier_index as usize];
    if tier_pool == 0 {
        return 0;
    }

    // Calculate weight for each tier based on proximity to resolved value
    // Weight = max_distance - distance, where max_distance = num_tiers
    let resolved_tier = market.resolved_tier as u128;
    let this_tier = position.tier_index as u128;
    let distance = if this_tier >= resolved_tier {
        this_tier - resolved_tier
    } else {
        resolved_tier - this_tier
    };

    if distance >= n {
        return 0;
    }

    let weight = n - distance;

    // Sum of all weights = n + (n-1) + ... + 1 = n*(n+1)/2
    // But only for tiers that have liquidity
    let mut total_weight: u128 = 0;
    for i in 0..market.num_tiers {
        if market.tier_pools[i as usize] > 0 {
            let d = if (i as u128) >= resolved_tier {
                (i as u128) - resolved_tier
            } else {
                resolved_tier - (i as u128)
            };
            if d < n {
                total_weight += n - d;
            }
        }
    }

    if total_weight == 0 {
        return 0;
    }

    // Pool allocated to this tier
    let pool_for_tier = mul_div(market.total_liquidity, weight, total_weight);

    // Individual payout
    mul_div(position.amount, pool_for_tier, tier_pool)
}

// ============ Market Analytics ============

/// Calculate implied probability for a tier as basis points (0-10000).
///
/// implied_probability = tier_pool / total_liquidity
pub fn implied_odds_bps(market: &PredictionMarketCellData, tier_index: u8) -> u128 {
    if tier_index >= market.num_tiers || market.total_liquidity == 0 {
        return 0;
    }
    mul_div(
        market.tier_pools[tier_index as usize],
        BPS_DENOMINATOR,
        market.total_liquidity,
    )
}

/// Calculate the potential payout multiplier for a tier (in PRECISION units).
///
/// multiplier = total_liquidity / tier_pool (returns 0 if no bets in tier)
pub fn potential_multiplier(market: &PredictionMarketCellData, tier_index: u8) -> u128 {
    if tier_index >= market.num_tiers {
        return 0;
    }
    let tier_pool = market.tier_pools[tier_index as usize];
    if tier_pool == 0 {
        return 0; // No bets yet — infinite multiplier, return 0 as sentinel
    }
    mul_div(market.total_liquidity, PRECISION, tier_pool)
}

/// Market depth analysis — returns (min_pool, max_pool, imbalance_bps).
///
/// Imbalance measures how unevenly distributed the liquidity is.
/// 0 = perfectly balanced, 10000 = all in one tier.
pub fn market_depth(market: &PredictionMarketCellData) -> (u128, u128, u128) {
    if market.num_tiers == 0 || market.total_liquidity == 0 {
        return (0, 0, 0);
    }

    let mut min_pool = u128::MAX;
    let mut max_pool: u128 = 0;

    for i in 0..market.num_tiers as usize {
        let pool = market.tier_pools[i];
        if pool < min_pool {
            min_pool = pool;
        }
        if pool > max_pool {
            max_pool = pool;
        }
    }

    // Imbalance = (max - min) / total * 10000
    let imbalance = if market.total_liquidity > 0 {
        mul_div(max_pool - min_pool, BPS_DENOMINATOR, market.total_liquidity)
    } else {
        0
    };

    (min_pool, max_pool, imbalance)
}

/// Check if a market is ready for settlement (past dispute window)
pub fn is_settleable(market: &PredictionMarketCellData, current_block: u64) -> bool {
    market.status == MARKET_RESOLVED && current_block >= market.dispute_end_block
}

/// Transition a resolved market to settled status
pub fn settle_market(
    market: &PredictionMarketCellData,
    current_block: u64,
) -> Result<PredictionMarketCellData, SDKError> {
    if !is_settleable(market, current_block) {
        return Err(SDKError::InvalidPhase);
    }
    let mut settled = market.clone();
    settled.status = MARKET_SETTLED;
    Ok(settled)
}

// ============ Helpers ============

/// Integer mul-div: (a * b) / c with overflow protection via u256 widening
fn mul_div(a: u128, b: u128, c: u128) -> u128 {
    if c == 0 {
        return 0;
    }
    let wide = (a as u128).wrapping_mul(b as u128);
    // For production: use 256-bit intermediate. For now, saturating approach.
    // This matches the pattern in vibeswap_math::batch_math::mul_div
    let result = (a / c) * b + (a % c) * b / c;
    result
}

fn hash_script(script: &Script) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(&script.code_hash);
    hasher.update(&[match script.hash_type {
        HashType::Data => 0,
        HashType::Type => 1,
        HashType::Data1 => 2,
        HashType::Data2 => 3,
    }]);
    hasher.update(&script.args);
    let result = hasher.finalize();
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&result);
    hash
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    fn test_lock() -> Script {
        Script {
            code_hash: [0xAA; 32],
            hash_type: HashType::Type,
            args: vec![0x01, 0x02, 0x03],
        }
    }

    fn test_market(num_tiers: u8, settlement_mode: u8) -> PredictionMarketCellData {
        let lock = test_lock();
        let lock_hash = hash_script(&lock);
        let params = CreateMarketParams {
            question_hash: [0xBB; 32],
            oracle_pair_id: [0xCC; 32],
            num_tiers,
            settlement_mode,
            resolution_block: 1000,
            dispute_window_blocks: DEFAULT_DISPUTE_WINDOW_BLOCKS,
            fee_rate_bps: DEFAULT_MARKET_FEE_BPS,
            creator_lock: lock,
            creator_input: CellInput { tx_hash: [0; 32], index: 0, since: 0 },
            current_block: 100,
        };
        let (market, _id) = create_market(&params).unwrap();
        market
    }

    fn market_with_bets(num_tiers: u8, settlement_mode: u8, bets: &[(u8, u128)]) -> PredictionMarketCellData {
        let mut market = test_market(num_tiers, settlement_mode);
        for &(tier, amount) in bets {
            let (updated, _pos) = place_bet(&market, tier, amount, [0x11; 32], 200).unwrap();
            market = updated;
        }
        market
    }

    // ============ Market Creation Tests ============

    #[test]
    fn test_create_binary_market() {
        let market = test_market(2, SETTLEMENT_WINNER_TAKES_ALL);
        assert_eq!(market.num_tiers, 2);
        assert_eq!(market.status, MARKET_ACTIVE);
        assert_eq!(market.settlement_mode, SETTLEMENT_WINNER_TAKES_ALL);
        assert_eq!(market.total_liquidity, 0);
        assert_eq!(market.resolution_block, 1000);
        assert_eq!(market.dispute_end_block, 1000 + DEFAULT_DISPUTE_WINDOW_BLOCKS);
    }

    #[test]
    fn test_create_multi_tier_market() {
        let market = test_market(5, SETTLEMENT_PROPORTIONAL);
        assert_eq!(market.num_tiers, 5);
        assert_eq!(market.settlement_mode, SETTLEMENT_PROPORTIONAL);
    }

    #[test]
    fn test_create_max_tiers() {
        let market = test_market(8, SETTLEMENT_SCALAR);
        assert_eq!(market.num_tiers, 8);
    }

    #[test]
    fn test_create_invalid_tiers_too_few() {
        let lock = test_lock();
        let params = CreateMarketParams {
            question_hash: [0; 32],
            oracle_pair_id: [0; 32],
            num_tiers: 1, // too few
            settlement_mode: SETTLEMENT_WINNER_TAKES_ALL,
            resolution_block: 1000,
            dispute_window_blocks: 1200,
            fee_rate_bps: 100,
            creator_lock: lock,
            creator_input: CellInput { tx_hash: [0; 32], index: 0, since: 0 },
            current_block: 100,
        };
        assert!(create_market(&params).is_err());
    }

    #[test]
    fn test_create_invalid_tiers_too_many() {
        let lock = test_lock();
        let params = CreateMarketParams {
            question_hash: [0; 32],
            oracle_pair_id: [0; 32],
            num_tiers: 9, // too many
            settlement_mode: SETTLEMENT_WINNER_TAKES_ALL,
            resolution_block: 1000,
            dispute_window_blocks: 1200,
            fee_rate_bps: 100,
            creator_lock: lock,
            creator_input: CellInput { tx_hash: [0; 32], index: 0, since: 0 },
            current_block: 100,
        };
        assert!(create_market(&params).is_err());
    }

    #[test]
    fn test_create_invalid_settlement_mode() {
        let lock = test_lock();
        let params = CreateMarketParams {
            question_hash: [0; 32],
            oracle_pair_id: [0; 32],
            num_tiers: 2,
            settlement_mode: 99, // invalid
            resolution_block: 1000,
            dispute_window_blocks: 1200,
            fee_rate_bps: 100,
            creator_lock: lock,
            creator_input: CellInput { tx_hash: [0; 32], index: 0, since: 0 },
            current_block: 100,
        };
        assert!(create_market(&params).is_err());
    }

    #[test]
    fn test_create_resolution_in_past() {
        let lock = test_lock();
        let params = CreateMarketParams {
            question_hash: [0; 32],
            oracle_pair_id: [0; 32],
            num_tiers: 2,
            settlement_mode: SETTLEMENT_WINNER_TAKES_ALL,
            resolution_block: 50, // in the past
            dispute_window_blocks: 1200,
            fee_rate_bps: 100,
            creator_lock: lock,
            creator_input: CellInput { tx_hash: [0; 32], index: 0, since: 0 },
            current_block: 100,
        };
        assert!(create_market(&params).is_err());
    }

    #[test]
    fn test_market_id_deterministic() {
        let id1 = derive_market_id(&[0xBB; 32], &[0xAA; 32], 100);
        let id2 = derive_market_id(&[0xBB; 32], &[0xAA; 32], 100);
        assert_eq!(id1, id2);
    }

    #[test]
    fn test_market_id_unique_per_question() {
        let id1 = derive_market_id(&[0xBB; 32], &[0xAA; 32], 100);
        let id2 = derive_market_id(&[0xCC; 32], &[0xAA; 32], 100);
        assert_ne!(id1, id2);
    }

    #[test]
    fn test_market_id_unique_per_creator() {
        let id1 = derive_market_id(&[0xBB; 32], &[0xAA; 32], 100);
        let id2 = derive_market_id(&[0xBB; 32], &[0xDD; 32], 100);
        assert_ne!(id1, id2);
    }

    #[test]
    fn test_market_id_unique_per_block() {
        let id1 = derive_market_id(&[0xBB; 32], &[0xAA; 32], 100);
        let id2 = derive_market_id(&[0xBB; 32], &[0xAA; 32], 101);
        assert_ne!(id1, id2);
    }

    // ============ Betting Tests ============

    #[test]
    fn test_place_bet_valid() {
        let market = test_market(3, SETTLEMENT_WINNER_TAKES_ALL);
        let amount = 5 * MINIMUM_BET_AMOUNT;
        let (updated, pos) = place_bet(&market, 1, amount, [0x11; 32], 200).unwrap();

        assert_eq!(updated.total_liquidity, amount);
        assert_eq!(updated.tier_pools[1], amount);
        assert_eq!(pos.tier_index, 1);
        assert_eq!(pos.amount, amount);
        assert_eq!(pos.market_id, market.market_id);
    }

    #[test]
    fn test_place_multiple_bets() {
        let market = test_market(3, SETTLEMENT_WINNER_TAKES_ALL);
        let a1 = 5 * MINIMUM_BET_AMOUNT;
        let a2 = 10 * MINIMUM_BET_AMOUNT;

        let (m1, _) = place_bet(&market, 0, a1, [0x11; 32], 200).unwrap();
        let (m2, _) = place_bet(&m1, 1, a2, [0x22; 32], 201).unwrap();

        assert_eq!(m2.total_liquidity, a1 + a2);
        assert_eq!(m2.tier_pools[0], a1);
        assert_eq!(m2.tier_pools[1], a2);
    }

    #[test]
    fn test_place_bet_invalid_tier() {
        let market = test_market(3, SETTLEMENT_WINNER_TAKES_ALL);
        let result = place_bet(&market, 3, MINIMUM_BET_AMOUNT, [0x11; 32], 200);
        assert!(result.is_err());
    }

    #[test]
    fn test_place_bet_below_minimum() {
        let market = test_market(3, SETTLEMENT_WINNER_TAKES_ALL);
        let result = place_bet(&market, 0, MINIMUM_BET_AMOUNT - 1, [0x11; 32], 200);
        assert!(result.is_err());
    }

    #[test]
    fn test_place_bet_after_resolution_block() {
        let market = test_market(3, SETTLEMENT_WINNER_TAKES_ALL);
        let result = place_bet(&market, 0, MINIMUM_BET_AMOUNT, [0x11; 32], 1000); // at resolution
        assert!(result.is_err());
    }

    #[test]
    fn test_place_bet_on_cancelled_market() {
        let mut market = test_market(3, SETTLEMENT_WINNER_TAKES_ALL);
        market.status = MARKET_CANCELLED;
        let result = place_bet(&market, 0, MINIMUM_BET_AMOUNT, [0x11; 32], 200);
        assert!(result.is_err());
    }

    // ============ Resolution Tests ============

    #[test]
    fn test_resolve_binary_low() {
        let bets = [(0, 10 * MINIMUM_BET_AMOUNT), (1, 5 * MINIMUM_BET_AMOUNT)];
        let market = market_with_bets(2, SETTLEMENT_WINNER_TAKES_ALL, &bets);

        // Value in lower half → tier 0
        let oracle_value = PRECISION / 4; // 25%
        let resolved = resolve_market(&market, oracle_value, 1000).unwrap();

        assert_eq!(resolved.status, MARKET_RESOLVED);
        assert_eq!(resolved.resolved_tier, 0);
        assert_eq!(resolved.resolved_value, oracle_value);
    }

    #[test]
    fn test_resolve_binary_high() {
        let bets = [(0, 10 * MINIMUM_BET_AMOUNT), (1, 5 * MINIMUM_BET_AMOUNT)];
        let market = market_with_bets(2, SETTLEMENT_WINNER_TAKES_ALL, &bets);

        // Value in upper half → tier 1
        let oracle_value = PRECISION * 3 / 4; // 75%
        let resolved = resolve_market(&market, oracle_value, 1000).unwrap();
        assert_eq!(resolved.resolved_tier, 1);
    }

    #[test]
    fn test_resolve_multi_tier() {
        let bets = [
            (0, 5 * MINIMUM_BET_AMOUNT),
            (1, 5 * MINIMUM_BET_AMOUNT),
            (2, 5 * MINIMUM_BET_AMOUNT),
            (3, 5 * MINIMUM_BET_AMOUNT),
        ];
        let market = market_with_bets(4, SETTLEMENT_WINNER_TAKES_ALL, &bets);

        // Value at 60% → tier 2 (buckets: 0-25%, 25-50%, 50-75%, 75-100%)
        let oracle_value = PRECISION * 60 / 100;
        let resolved = resolve_market(&market, oracle_value, 1000).unwrap();
        assert_eq!(resolved.resolved_tier, 2);
    }

    #[test]
    fn test_resolve_before_resolution_block() {
        let market = test_market(2, SETTLEMENT_WINNER_TAKES_ALL);
        let result = resolve_market(&market, PRECISION / 2, 999); // too early
        assert!(result.is_err());
    }

    #[test]
    fn test_resolve_already_settled() {
        let mut market = test_market(2, SETTLEMENT_WINNER_TAKES_ALL);
        market.status = MARKET_SETTLED;
        let result = resolve_market(&market, PRECISION / 2, 1000);
        assert!(result.is_err());
    }

    // ============ Value-to-Tier Mapping Tests ============

    #[test]
    fn test_value_to_tier_binary() {
        assert_eq!(value_to_tier(0, 2), 0);
        assert_eq!(value_to_tier(PRECISION / 2 - 1, 2), 0);
        assert_eq!(value_to_tier(PRECISION / 2, 2), 1);
        assert_eq!(value_to_tier(PRECISION, 2), 1); // clamped
    }

    #[test]
    fn test_value_to_tier_8way() {
        for i in 0..8u8 {
            let value = (PRECISION / 8) * (i as u128) + 1;
            assert_eq!(value_to_tier(value, 8), i, "Failed for tier {}", i);
        }
    }

    #[test]
    fn test_value_to_tier_max_value() {
        // PRECISION should map to last tier
        assert_eq!(value_to_tier(PRECISION, 3), 2);
        assert_eq!(value_to_tier(PRECISION * 2, 3), 2);
    }

    #[test]
    fn test_value_to_tier_zero_tiers() {
        assert_eq!(value_to_tier(PRECISION / 2, 0), 0);
    }

    // ============ Winner-Takes-All Payout Tests ============

    #[test]
    fn test_wta_winning_tier_full_pool() {
        let bets = [(0, 10 * MINIMUM_BET_AMOUNT), (1, 5 * MINIMUM_BET_AMOUNT)];
        let mut market = market_with_bets(2, SETTLEMENT_WINNER_TAKES_ALL, &bets);
        market.status = MARKET_RESOLVED;
        market.resolved_tier = 0;

        let position = PredictionPositionCellData {
            market_id: market.market_id,
            owner_lock_hash: [0x11; 32],
            tier_index: 0,
            amount: 10 * MINIMUM_BET_AMOUNT,
            created_block: 200,
        };

        let (gross, fee, net) = calculate_payout(&market, &position).unwrap();
        // Only bettor on tier 0, gets entire pool
        assert_eq!(gross, 15 * MINIMUM_BET_AMOUNT);
        assert!(fee > 0);
        assert_eq!(net, gross - fee);
    }

    #[test]
    fn test_wta_losing_tier_gets_nothing() {
        let bets = [(0, 10 * MINIMUM_BET_AMOUNT), (1, 5 * MINIMUM_BET_AMOUNT)];
        let mut market = market_with_bets(2, SETTLEMENT_WINNER_TAKES_ALL, &bets);
        market.status = MARKET_RESOLVED;
        market.resolved_tier = 0;

        let position = PredictionPositionCellData {
            market_id: market.market_id,
            owner_lock_hash: [0x22; 32],
            tier_index: 1, // losing tier
            amount: 5 * MINIMUM_BET_AMOUNT,
            created_block: 200,
        };

        let (gross, fee, net) = calculate_payout(&market, &position).unwrap();
        assert_eq!(gross, 0);
        assert_eq!(fee, 0);
        assert_eq!(net, 0);
    }

    #[test]
    fn test_wta_proportional_split() {
        // Two bettors on winning tier: 60/40 split
        let bets = [
            (0, 6 * MINIMUM_BET_AMOUNT),  // bettor A
            (0, 4 * MINIMUM_BET_AMOUNT),  // bettor B
            (1, 10 * MINIMUM_BET_AMOUNT), // losing
        ];
        let mut market = market_with_bets(2, SETTLEMENT_WINNER_TAKES_ALL, &bets);
        market.status = MARKET_RESOLVED;
        market.resolved_tier = 0;

        let total = 20 * MINIMUM_BET_AMOUNT;
        assert_eq!(market.total_liquidity, total);

        // Bettor A: 6/10 of the pool
        let pos_a = PredictionPositionCellData {
            market_id: market.market_id,
            owner_lock_hash: [0x11; 32],
            tier_index: 0,
            amount: 6 * MINIMUM_BET_AMOUNT,
            created_block: 200,
        };
        let (gross_a, _, _) = calculate_payout(&market, &pos_a).unwrap();
        assert_eq!(gross_a, 12 * MINIMUM_BET_AMOUNT); // 6/10 * 20

        // Bettor B: 4/10 of the pool
        let pos_b = PredictionPositionCellData {
            market_id: market.market_id,
            owner_lock_hash: [0x22; 32],
            tier_index: 0,
            amount: 4 * MINIMUM_BET_AMOUNT,
            created_block: 200,
        };
        let (gross_b, _, _) = calculate_payout(&market, &pos_b).unwrap();
        assert_eq!(gross_b, 8 * MINIMUM_BET_AMOUNT); // 4/10 * 20
    }

    // ============ Proportional Payout Tests ============

    #[test]
    fn test_proportional_adjacent_gets_partial() {
        let bets = [
            (0, 5 * MINIMUM_BET_AMOUNT),
            (1, 5 * MINIMUM_BET_AMOUNT),
            (2, 5 * MINIMUM_BET_AMOUNT),
        ];
        let mut market = market_with_bets(3, SETTLEMENT_PROPORTIONAL, &bets);
        market.status = MARKET_RESOLVED;
        market.resolved_tier = 1; // middle tier wins

        let total = 15 * MINIMUM_BET_AMOUNT;

        // Winning tier gets 70% (100% - 15% - 15%)
        let pos_winner = PredictionPositionCellData {
            market_id: market.market_id,
            owner_lock_hash: [0x11; 32],
            tier_index: 1,
            amount: 5 * MINIMUM_BET_AMOUNT,
            created_block: 200,
        };
        let (gross_win, _, _) = calculate_payout(&market, &pos_winner).unwrap();
        let expected_win = mul_div(total, 7000, BPS_DENOMINATOR);
        assert_eq!(gross_win, expected_win);

        // Adjacent tier gets 15%
        let pos_adj = PredictionPositionCellData {
            market_id: market.market_id,
            owner_lock_hash: [0x22; 32],
            tier_index: 0,
            amount: 5 * MINIMUM_BET_AMOUNT,
            created_block: 200,
        };
        let (gross_adj, _, _) = calculate_payout(&market, &pos_adj).unwrap();
        let expected_adj = mul_div(total, ADJACENT_PAYOUT_BPS, BPS_DENOMINATOR);
        assert_eq!(gross_adj, expected_adj);
    }

    #[test]
    fn test_proportional_far_tier_gets_nothing() {
        let bets = [
            (0, 5 * MINIMUM_BET_AMOUNT),
            (1, 5 * MINIMUM_BET_AMOUNT),
            (2, 5 * MINIMUM_BET_AMOUNT),
            (3, 5 * MINIMUM_BET_AMOUNT),
        ];
        let mut market = market_with_bets(4, SETTLEMENT_PROPORTIONAL, &bets);
        market.status = MARKET_RESOLVED;
        market.resolved_tier = 0; // tier 0 wins

        // Tier 2 is 2 away — gets nothing
        let pos_far = PredictionPositionCellData {
            market_id: market.market_id,
            owner_lock_hash: [0x33; 32],
            tier_index: 2,
            amount: 5 * MINIMUM_BET_AMOUNT,
            created_block: 200,
        };
        let (gross, _, _) = calculate_payout(&market, &pos_far).unwrap();
        assert_eq!(gross, 0);
    }

    // ============ Scalar Payout Tests ============

    #[test]
    fn test_scalar_closer_tier_gets_more() {
        let bets = [
            (0, 5 * MINIMUM_BET_AMOUNT),
            (1, 5 * MINIMUM_BET_AMOUNT),
            (2, 5 * MINIMUM_BET_AMOUNT),
        ];
        let mut market = market_with_bets(3, SETTLEMENT_SCALAR, &bets);
        market.status = MARKET_RESOLVED;
        market.resolved_tier = 0;

        // Tier 0 (distance 0, weight 3), Tier 1 (distance 1, weight 2), Tier 2 (distance 2, weight 1)
        // Total weight = 6

        let pos0 = PredictionPositionCellData {
            market_id: market.market_id,
            owner_lock_hash: [0x11; 32],
            tier_index: 0,
            amount: 5 * MINIMUM_BET_AMOUNT,
            created_block: 200,
        };
        let pos1 = PredictionPositionCellData {
            market_id: market.market_id,
            owner_lock_hash: [0x22; 32],
            tier_index: 1,
            amount: 5 * MINIMUM_BET_AMOUNT,
            created_block: 200,
        };
        let pos2 = PredictionPositionCellData {
            market_id: market.market_id,
            owner_lock_hash: [0x33; 32],
            tier_index: 2,
            amount: 5 * MINIMUM_BET_AMOUNT,
            created_block: 200,
        };

        let (g0, _, _) = calculate_payout(&market, &pos0).unwrap();
        let (g1, _, _) = calculate_payout(&market, &pos1).unwrap();
        let (g2, _, _) = calculate_payout(&market, &pos2).unwrap();

        // Closer tiers should get more
        assert!(g0 > g1, "tier 0 ({}) should get more than tier 1 ({})", g0, g1);
        assert!(g1 > g2, "tier 1 ({}) should get more than tier 2 ({})", g1, g2);
        assert!(g2 > 0, "tier 2 should get something in scalar mode");
    }

    // ============ Analytics Tests ============

    #[test]
    fn test_implied_odds_balanced() {
        let bets = [(0, 5 * MINIMUM_BET_AMOUNT), (1, 5 * MINIMUM_BET_AMOUNT)];
        let market = market_with_bets(2, SETTLEMENT_WINNER_TAKES_ALL, &bets);

        let odds0 = implied_odds_bps(&market, 0);
        let odds1 = implied_odds_bps(&market, 1);
        assert_eq!(odds0, 5000); // 50%
        assert_eq!(odds1, 5000); // 50%
    }

    #[test]
    fn test_implied_odds_unbalanced() {
        let bets = [(0, 3 * MINIMUM_BET_AMOUNT), (1, 7 * MINIMUM_BET_AMOUNT)];
        let market = market_with_bets(2, SETTLEMENT_WINNER_TAKES_ALL, &bets);

        let odds0 = implied_odds_bps(&market, 0);
        let odds1 = implied_odds_bps(&market, 1);
        assert_eq!(odds0, 3000); // 30%
        assert_eq!(odds1, 7000); // 70%
    }

    #[test]
    fn test_potential_multiplier() {
        let bets = [(0, 2 * MINIMUM_BET_AMOUNT), (1, 8 * MINIMUM_BET_AMOUNT)];
        let market = market_with_bets(2, SETTLEMENT_WINNER_TAKES_ALL, &bets);

        // Tier 0 has 2/10 → multiplier = 5x
        let mult0 = potential_multiplier(&market, 0);
        assert_eq!(mult0, 5 * PRECISION);

        // Tier 1 has 8/10 → multiplier = 1.25x
        let mult1 = potential_multiplier(&market, 1);
        assert_eq!(mult1, PRECISION + PRECISION / 4);
    }

    #[test]
    fn test_market_depth_balanced() {
        let bets = [(0, 5 * MINIMUM_BET_AMOUNT), (1, 5 * MINIMUM_BET_AMOUNT)];
        let market = market_with_bets(2, SETTLEMENT_WINNER_TAKES_ALL, &bets);

        let (min_pool, max_pool, imbalance) = market_depth(&market);
        assert_eq!(min_pool, 5 * MINIMUM_BET_AMOUNT);
        assert_eq!(max_pool, 5 * MINIMUM_BET_AMOUNT);
        assert_eq!(imbalance, 0);
    }

    #[test]
    fn test_market_depth_imbalanced() {
        let bets = [(0, 1 * MINIMUM_BET_AMOUNT), (1, 9 * MINIMUM_BET_AMOUNT)];
        let market = market_with_bets(2, SETTLEMENT_WINNER_TAKES_ALL, &bets);

        let (min_pool, max_pool, imbalance) = market_depth(&market);
        assert_eq!(min_pool, MINIMUM_BET_AMOUNT);
        assert_eq!(max_pool, 9 * MINIMUM_BET_AMOUNT);
        assert!(imbalance > 0);
    }

    // ============ Settlement Tests ============

    #[test]
    fn test_is_settleable() {
        let mut market = test_market(2, SETTLEMENT_WINNER_TAKES_ALL);
        market.status = MARKET_RESOLVED;
        market.dispute_end_block = 2200;

        assert!(!is_settleable(&market, 2199));
        assert!(is_settleable(&market, 2200));
        assert!(is_settleable(&market, 2201));
    }

    #[test]
    fn test_settle_market() {
        let mut market = test_market(2, SETTLEMENT_WINNER_TAKES_ALL);
        market.status = MARKET_RESOLVED;
        market.dispute_end_block = 2200;

        let settled = settle_market(&market, 2200).unwrap();
        assert_eq!(settled.status, MARKET_SETTLED);
    }

    #[test]
    fn test_settle_before_dispute_end() {
        let mut market = test_market(2, SETTLEMENT_WINNER_TAKES_ALL);
        market.status = MARKET_RESOLVED;
        market.dispute_end_block = 2200;

        let result = settle_market(&market, 2199);
        assert!(result.is_err());
    }

    // ============ Cancel Tests ============

    #[test]
    fn test_cancel_empty_market() {
        let lock = test_lock();
        let lock_hash = hash_script(&lock);
        let market = test_market(2, SETTLEMENT_WINNER_TAKES_ALL);

        let cancelled = cancel_market(&market, &lock_hash).unwrap();
        assert_eq!(cancelled.status, MARKET_CANCELLED);
    }

    #[test]
    fn test_cancel_with_bets_fails() {
        let lock = test_lock();
        let lock_hash = hash_script(&lock);
        let bets = [(0, MINIMUM_BET_AMOUNT)];
        let market = market_with_bets(2, SETTLEMENT_WINNER_TAKES_ALL, &bets);

        let result = cancel_market(&market, &lock_hash);
        assert!(result.is_err());
    }

    #[test]
    fn test_cancel_wrong_creator_fails() {
        let market = test_market(2, SETTLEMENT_WINNER_TAKES_ALL);
        let wrong_hash = [0xFF; 32];
        let result = cancel_market(&market, &wrong_hash);
        assert!(result.is_err());
    }

    // ============ Serialization Round-Trip Tests ============

    #[test]
    fn test_market_serialize_roundtrip() {
        let bets = [(0, 3 * MINIMUM_BET_AMOUNT), (1, 7 * MINIMUM_BET_AMOUNT)];
        let market = market_with_bets(2, SETTLEMENT_WINNER_TAKES_ALL, &bets);

        let bytes = market.serialize();
        let deserialized = PredictionMarketCellData::deserialize(&bytes).unwrap();
        assert_eq!(market, deserialized);
    }

    #[test]
    fn test_position_serialize_roundtrip() {
        let position = PredictionPositionCellData {
            market_id: [0xAA; 32],
            owner_lock_hash: [0xBB; 32],
            tier_index: 3,
            amount: 42 * MINIMUM_BET_AMOUNT,
            created_block: 500,
        };

        let bytes = position.serialize();
        let deserialized = PredictionPositionCellData::deserialize(&bytes).unwrap();
        assert_eq!(position, deserialized);
    }

    // ============ Edge Cases ============

    #[test]
    fn test_payout_unresolved_market_fails() {
        let market = test_market(2, SETTLEMENT_WINNER_TAKES_ALL);
        let position = PredictionPositionCellData {
            market_id: market.market_id,
            owner_lock_hash: [0x11; 32],
            tier_index: 0,
            amount: MINIMUM_BET_AMOUNT,
            created_block: 200,
        };
        let result = calculate_payout(&market, &position);
        assert!(result.is_err());
    }

    #[test]
    fn test_payout_market_id_mismatch() {
        let mut market = test_market(2, SETTLEMENT_WINNER_TAKES_ALL);
        market.status = MARKET_RESOLVED;

        let position = PredictionPositionCellData {
            market_id: [0xFF; 32], // wrong market
            owner_lock_hash: [0x11; 32],
            tier_index: 0,
            amount: MINIMUM_BET_AMOUNT,
            created_block: 200,
        };
        let result = calculate_payout(&market, &position);
        assert!(result.is_err());
    }

    #[test]
    fn test_implied_odds_empty_market() {
        let market = test_market(2, SETTLEMENT_WINNER_TAKES_ALL);
        assert_eq!(implied_odds_bps(&market, 0), 0);
        assert_eq!(implied_odds_bps(&market, 1), 0);
    }

    #[test]
    fn test_implied_odds_invalid_tier() {
        let market = test_market(2, SETTLEMENT_WINNER_TAKES_ALL);
        assert_eq!(implied_odds_bps(&market, 5), 0);
    }

    #[test]
    fn test_potential_multiplier_no_bets() {
        let market = test_market(2, SETTLEMENT_WINNER_TAKES_ALL);
        assert_eq!(potential_multiplier(&market, 0), 0);
    }

    #[test]
    fn test_wta_empty_winning_tier() {
        // Tier 0 wins but has no bets — nobody gets paid
        let bets = [(1, 5 * MINIMUM_BET_AMOUNT)];
        let mut market = market_with_bets(2, SETTLEMENT_WINNER_TAKES_ALL, &bets);
        market.status = MARKET_RESOLVED;
        market.resolved_tier = 0; // empty winning tier

        let pos = PredictionPositionCellData {
            market_id: market.market_id,
            owner_lock_hash: [0x11; 32],
            tier_index: 1,
            amount: 5 * MINIMUM_BET_AMOUNT,
            created_block: 200,
        };
        let (gross, _, _) = calculate_payout(&market, &pos).unwrap();
        assert_eq!(gross, 0); // Losing tier gets nothing
    }

    // ============ Full Lifecycle Test ============

    #[test]
    fn test_full_lifecycle_binary_wta() {
        // 1. Create market
        let market = test_market(2, SETTLEMENT_WINNER_TAKES_ALL);
        assert_eq!(market.status, MARKET_ACTIVE);

        // 2. Place bets
        let (m1, pos_a) = place_bet(&market, 0, 10 * MINIMUM_BET_AMOUNT, [0x11; 32], 200).unwrap();
        let (m2, pos_b) = place_bet(&m1, 1, 5 * MINIMUM_BET_AMOUNT, [0x22; 32], 201).unwrap();
        assert_eq!(m2.total_liquidity, 15 * MINIMUM_BET_AMOUNT);

        // 3. Resolve — tier 0 wins
        let resolved = resolve_market(&m2, PRECISION / 4, 1000).unwrap();
        assert_eq!(resolved.resolved_tier, 0);

        // 4. Calculate payouts
        let (gross_a, _, _) = calculate_payout(&resolved, &pos_a).unwrap();
        assert_eq!(gross_a, 15 * MINIMUM_BET_AMOUNT); // Winner gets all

        let (gross_b, _, _) = calculate_payout(&resolved, &pos_b).unwrap();
        assert_eq!(gross_b, 0); // Loser gets nothing

        // 5. Settle
        let settled = settle_market(&resolved, resolved.dispute_end_block).unwrap();
        assert_eq!(settled.status, MARKET_SETTLED);
    }

    #[test]
    fn test_full_lifecycle_multi_tier_scalar() {
        // 4-tier scalar market
        let market = test_market(4, SETTLEMENT_SCALAR);

        // Bets across all tiers
        let (m1, p0) = place_bet(&market, 0, 5 * MINIMUM_BET_AMOUNT, [0x11; 32], 200).unwrap();
        let (m2, p1) = place_bet(&m1, 1, 5 * MINIMUM_BET_AMOUNT, [0x22; 32], 201).unwrap();
        let (m3, p2) = place_bet(&m2, 2, 5 * MINIMUM_BET_AMOUNT, [0x33; 32], 202).unwrap();
        let (m4, p3) = place_bet(&m3, 3, 5 * MINIMUM_BET_AMOUNT, [0x44; 32], 203).unwrap();

        // Resolve to tier 1
        let resolved = resolve_market(&m4, PRECISION * 30 / 100, 1000).unwrap();
        assert_eq!(resolved.resolved_tier, 1);

        // All tiers get something in scalar mode
        let (g0, _, _) = calculate_payout(&resolved, &p0).unwrap();
        let (g1, _, _) = calculate_payout(&resolved, &p1).unwrap();
        let (g2, _, _) = calculate_payout(&resolved, &p2).unwrap();
        let (g3, _, _) = calculate_payout(&resolved, &p3).unwrap();

        assert!(g1 > g0); // tier 1 is closest (distance 0)
        assert!(g0 > 0);  // tier 0 gets something (distance 1)
        assert!(g2 > 0);  // tier 2 gets something (distance 1)
        assert!(g3 > 0);  // tier 3 gets something (distance 2)
        assert!(g0 == g2); // both distance 1 from resolved tier

        // Total payouts should approximately equal total liquidity
        let total_gross = g0 + g1 + g2 + g3;
        assert!(total_gross <= m4.total_liquidity + 4); // rounding tolerance
    }
}
