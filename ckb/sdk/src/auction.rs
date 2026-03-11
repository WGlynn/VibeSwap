// ============ Auction SDK — Commit-Reveal Batch Auction Helpers ============
// High-level utilities for participating in VibeSwap's commit-reveal batch auctions.
// Complements the TX builders in lib.rs (create_commit, create_reveal, create_settle_batch)
// with simulation, validation, strategy, and analysis functions.
//
// Flow:
//   1. commit_order_hash()  → compute hash for commit
//   2. validate_commit()    → verify commit cell matches expectations
//   3. verify_reveal()      → check reveal preimage matches commit
//   4. simulate_batch()     → estimate clearing price + fills before settlement
//   5. estimate_fill()      → predict a single order's execution outcome
//   6. calculate_slash()    → compute penalty for non-revealers
//   7. optimal_priority()   → strategy for priority bid sizing

use sha2::{Digest, Sha256};
use vibeswap_types::*;
use vibeswap_math::PRECISION;

// ============ Error Types ============

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AuctionError {
    /// Auction is not in the expected phase
    WrongPhase { expected: u8, actual: u8 },
    /// Commit hash doesn't match order + secret
    CommitMismatch,
    /// Reveal preimage doesn't match commit hash
    RevealMismatch,
    /// Batch ID mismatch between commit and auction
    BatchIdMismatch { commit: u64, auction: u64 },
    /// No orders to simulate
    EmptyBatch,
    /// Clearing price calculation failed
    ClearingPriceFailed,
    /// Order amount is zero
    ZeroAmount,
    /// Invalid order type (must be ORDER_BUY or ORDER_SELL)
    InvalidOrderType(u8),
    /// Phase window has expired
    PhaseExpired,
    /// Phase window has not yet elapsed
    PhaseNotElapsed,
}

// ============ Batch Simulation Results ============

/// Result of simulating a batch settlement
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BatchSimulation {
    /// Uniform clearing price (PRECISION scale)
    pub clearing_price: u128,
    /// Total fillable volume at clearing price
    pub fillable_volume: u128,
    /// Number of buy orders that would fill
    pub buy_fills: u32,
    /// Number of sell orders that would fill
    pub sell_fills: u32,
    /// Total buy volume (sum of all buy amounts)
    pub total_buy_volume: u128,
    /// Total sell volume (sum of all sell amounts)
    pub total_sell_volume: u128,
    /// Buy/sell pressure ratio (buy_volume * PRECISION / sell_volume)
    pub pressure_ratio: u128,
    /// Estimated price impact vs spot price (in bps)
    pub price_impact_bps: u64,
}

/// Result of estimating a single order's fill
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FillEstimate {
    /// Whether the order would fill at the simulated clearing price
    pub would_fill: bool,
    /// Estimated output amount (0 if wouldn't fill)
    pub estimated_output: u128,
    /// Effective price the order would execute at (PRECISION scale)
    pub effective_price: u128,
    /// Estimated position in execution queue (lower = earlier)
    pub queue_position: u32,
    /// Whether priority bid would improve execution
    pub priority_helpful: bool,
}

/// Phase timing information
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PhaseInfo {
    /// Current phase
    pub phase: u8,
    /// Blocks remaining in current phase (0 if expired)
    pub blocks_remaining: u64,
    /// Whether a phase transition is available
    pub can_transition: bool,
    /// Next phase after transition
    pub next_phase: u8,
}

/// Slash calculation result
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SlashResult {
    /// Amount of deposit slashed
    pub slash_amount: u64,
    /// Amount returned to user
    pub return_amount: u64,
    /// Slash rate applied (bps)
    pub slash_rate_bps: u16,
}

// ============ Order Hash Computation ============

/// Compute the order hash for a commit.
/// This is the SHA256 of the concatenated order fields + secret.
/// Must match the hash stored in CommitCellData.order_hash.
pub fn commit_order_hash(
    order_type: u8,
    amount_in: u128,
    limit_price: u128,
    priority_bid: u64,
    secret: &[u8; 32],
) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update([order_type]);
    hasher.update(amount_in.to_le_bytes());
    hasher.update(limit_price.to_le_bytes());
    hasher.update(priority_bid.to_le_bytes());
    hasher.update(secret);
    let result = hasher.finalize();
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&result);
    hash
}

// ============ Commit Validation ============

/// Validate that a commit cell matches the expected order parameters.
/// Returns Ok(()) if the commit is consistent, or an error describing the mismatch.
pub fn validate_commit(
    commit: &CommitCellData,
    order_type: u8,
    amount_in: u128,
    limit_price: u128,
    priority_bid: u64,
    secret: &[u8; 32],
    auction: &AuctionCellData,
) -> Result<(), AuctionError> {
    // Check batch ID matches
    if commit.batch_id != auction.batch_id {
        return Err(AuctionError::BatchIdMismatch {
            commit: commit.batch_id,
            auction: auction.batch_id,
        });
    }

    // Check phase is COMMIT
    if auction.phase != PHASE_COMMIT {
        return Err(AuctionError::WrongPhase {
            expected: PHASE_COMMIT,
            actual: auction.phase,
        });
    }

    // Verify order hash
    let expected_hash = commit_order_hash(order_type, amount_in, limit_price, priority_bid, secret);
    if commit.order_hash != expected_hash {
        return Err(AuctionError::CommitMismatch);
    }

    Ok(())
}

// ============ Reveal Verification ============

/// Verify that a reveal's preimage matches a commit's order hash.
/// This is the core verification that prevents order manipulation after commit.
pub fn verify_reveal(
    reveal: &RevealWitness,
    commit: &CommitCellData,
) -> Result<(), AuctionError> {
    let computed_hash = commit_order_hash(
        reveal.order_type,
        reveal.amount_in,
        reveal.limit_price,
        reveal.priority_bid,
        &reveal.secret,
    );

    if computed_hash != commit.order_hash {
        Err(AuctionError::RevealMismatch)
    } else {
        Ok(())
    }
}

// ============ Phase Timing ============

/// Determine current phase info given auction state and block number.
pub fn phase_info(
    auction: &AuctionCellData,
    current_block: u64,
    config: &ConfigCellData,
) -> PhaseInfo {
    let blocks_elapsed = current_block.saturating_sub(auction.phase_start_block);

    match auction.phase {
        PHASE_COMMIT => {
            let window = config.commit_window_blocks;
            let remaining = window.saturating_sub(blocks_elapsed);
            PhaseInfo {
                phase: PHASE_COMMIT,
                blocks_remaining: remaining,
                can_transition: blocks_elapsed >= window && auction.commit_count > 0,
                next_phase: PHASE_REVEAL,
            }
        }
        PHASE_REVEAL => {
            let window = config.reveal_window_blocks;
            let remaining = window.saturating_sub(blocks_elapsed);
            PhaseInfo {
                phase: PHASE_REVEAL,
                blocks_remaining: remaining,
                can_transition: blocks_elapsed >= window,
                next_phase: PHASE_SETTLING,
            }
        }
        PHASE_SETTLING => PhaseInfo {
            phase: PHASE_SETTLING,
            blocks_remaining: 0, // PoW-gated, no fixed window
            can_transition: true, // Can settle whenever PoW is found
            next_phase: PHASE_SETTLED,
        },
        PHASE_SETTLED => PhaseInfo {
            phase: PHASE_SETTLED,
            blocks_remaining: 0,
            can_transition: true, // Can start next batch immediately
            next_phase: PHASE_COMMIT,
        },
        _ => PhaseInfo {
            phase: auction.phase,
            blocks_remaining: 0,
            can_transition: false,
            next_phase: auction.phase,
        },
    }
}

// ============ Batch Simulation ============

/// Simulate a batch settlement to estimate clearing price and fills.
/// Takes revealed orders + pool state, returns simulation results.
pub fn simulate_batch(
    reveals: &[RevealWitness],
    reserve0: u128,
    reserve1: u128,
    spot_price: u128,
) -> Result<BatchSimulation, AuctionError> {
    if reveals.is_empty() {
        return Err(AuctionError::EmptyBatch);
    }

    // Separate into buy and sell orders
    let mut buy_orders = Vec::new();
    let mut sell_orders = Vec::new();
    let mut total_buy_volume: u128 = 0;
    let mut total_sell_volume: u128 = 0;

    for reveal in reveals {
        let math_order = vibeswap_math::batch_math::Order {
            amount: reveal.amount_in,
            limit_price: reveal.limit_price,
        };

        match reveal.order_type {
            ORDER_BUY => {
                total_buy_volume += reveal.amount_in;
                buy_orders.push(math_order);
            }
            ORDER_SELL => {
                total_sell_volume += reveal.amount_in;
                sell_orders.push(math_order);
            }
            other => return Err(AuctionError::InvalidOrderType(other)),
        }
    }

    // Calculate clearing price
    let (clearing_price, fillable_volume) =
        vibeswap_math::batch_math::calculate_clearing_price(
            &buy_orders,
            &sell_orders,
            reserve0,
            reserve1,
        )
        .map_err(|_| AuctionError::ClearingPriceFailed)?;

    // Count fills at clearing price
    let buy_fills = buy_orders
        .iter()
        .filter(|o| o.limit_price >= clearing_price)
        .count() as u32;
    let sell_fills = sell_orders
        .iter()
        .filter(|o| o.limit_price <= clearing_price)
        .count() as u32;

    // Pressure ratio (buy/sell)
    let pressure_ratio = if total_sell_volume > 0 {
        vibeswap_math::mul_div(total_buy_volume, PRECISION, total_sell_volume)
    } else if total_buy_volume > 0 {
        u128::MAX // Infinite buy pressure
    } else {
        PRECISION // Balanced (both zero — shouldn't happen)
    };

    // Price impact vs spot
    let price_impact_bps = if spot_price > 0 {
        let diff = if clearing_price > spot_price {
            clearing_price - spot_price
        } else {
            spot_price - clearing_price
        };
        vibeswap_math::mul_div(diff, 10_000, spot_price) as u64
    } else {
        0
    };

    Ok(BatchSimulation {
        clearing_price,
        fillable_volume,
        buy_fills,
        sell_fills,
        total_buy_volume,
        total_sell_volume,
        pressure_ratio,
        price_impact_bps,
    })
}

// ============ Fill Estimation ============

/// Estimate how a single order would be filled in the current batch.
/// Takes the order params + current batch state (other reveals, pool).
pub fn estimate_fill(
    order_type: u8,
    amount_in: u128,
    limit_price: u128,
    priority_bid: u64,
    other_reveals: &[RevealWitness],
    reserve0: u128,
    reserve1: u128,
    spot_price: u128,
) -> Result<FillEstimate, AuctionError> {
    if amount_in == 0 {
        return Err(AuctionError::ZeroAmount);
    }

    // Build the full order list including this order
    let my_reveal = RevealWitness {
        order_type,
        amount_in,
        limit_price,
        secret: [0u8; 32], // Doesn't affect simulation
        priority_bid,
        commit_index: 0,
    };

    let mut all_reveals = Vec::with_capacity(other_reveals.len() + 1);
    all_reveals.push(my_reveal);
    all_reveals.extend_from_slice(other_reveals);

    // Simulate the batch
    let sim = simulate_batch(&all_reveals, reserve0, reserve1, spot_price)?;

    // Check if this order would fill
    let would_fill = match order_type {
        ORDER_BUY => limit_price >= sim.clearing_price,
        ORDER_SELL => limit_price <= sim.clearing_price,
        other => return Err(AuctionError::InvalidOrderType(other)),
    };

    // Estimate output
    let estimated_output = if would_fill {
        match order_type {
            ORDER_BUY => {
                // Buying token0 with token1: output = amount_in / clearing_price
                vibeswap_math::mul_div(amount_in, PRECISION, sim.clearing_price)
            }
            ORDER_SELL => {
                // Selling token0 for token1: output = amount_in × clearing_price
                vibeswap_math::mul_div(amount_in, sim.clearing_price, PRECISION)
            }
            _ => 0,
        }
    } else {
        0
    };

    // Effective price
    let effective_price = if would_fill {
        sim.clearing_price
    } else {
        0
    };

    // Queue position estimate: priority orders first, then by commit order
    let priority_count = all_reveals
        .iter()
        .filter(|r| r.priority_bid > 0)
        .count() as u32;

    let queue_position = if priority_bid > 0 {
        // Among priority orders, position based on bid size (higher = better)
        all_reveals
            .iter()
            .filter(|r| r.priority_bid > priority_bid)
            .count() as u32
    } else {
        // After all priority orders, random position
        priority_count + (all_reveals.len() as u32 - priority_count) / 2
    };

    // Is priority helpful? Only if there are other priority bidders
    // or if the order is large enough to benefit from early execution
    let priority_helpful = priority_count > 0
        || vibeswap_math::mul_div(amount_in, 10_000, sim.fillable_volume.max(1)) > 500; // >5% of volume

    Ok(FillEstimate {
        would_fill,
        estimated_output,
        effective_price,
        queue_position,
        priority_helpful,
    })
}

// ============ Slash Calculation ============

/// Calculate the slash penalty for a non-revealing committer.
pub fn calculate_slash(
    deposit_ckb: u64,
    slash_rate_bps: u16,
) -> SlashResult {
    let slash_amount = (deposit_ckb as u128 * slash_rate_bps as u128 / 10_000) as u64;
    let return_amount = deposit_ckb - slash_amount;

    SlashResult {
        slash_amount,
        return_amount,
        slash_rate_bps,
    }
}

/// Calculate slash using default rate (50%)
pub fn calculate_default_slash(deposit_ckb: u64) -> SlashResult {
    calculate_slash(deposit_ckb, DEFAULT_SLASH_RATE_BPS)
}

// ============ Priority Bid Strategy ============

/// Estimate optimal priority bid for a given order.
///
/// Strategy: bid enough to cover the marginal benefit of earlier execution,
/// but not more than the expected slippage savings.
///
/// Returns suggested priority bid in CKB shannons.
pub fn optimal_priority_bid(
    amount_in: u128,
    total_batch_volume: u128,
    reserve0: u128,
    reserve1: u128,
    _fee_rate_bps: u16,
) -> u64 {
    if total_batch_volume == 0 || reserve0 == 0 || reserve1 == 0 {
        return 0;
    }

    // Price impact of executing after all other orders vs before them
    // Early execution means less slippage from pool reserve changes
    let impact_bps = vibeswap_math::mul_div(
        total_batch_volume,
        10_000,
        reserve0.min(reserve1),
    );

    // Marginal benefit = amount_in × impact / 10000
    let benefit = vibeswap_math::mul_div(amount_in, impact_bps, 10_000);

    // Bid should be a fraction of the benefit (don't overpay)
    // Use 10% of expected benefit as the bid
    let bid = vibeswap_math::mul_div(benefit, 1_000, 10_000);

    // Convert to CKB shannons (1 CKB = 1e8 shannons)
    // Assume the token amount is in PRECISION scale, convert down
    (bid / (PRECISION / 100_000_000)).min(u64::MAX as u128) as u64
}

// ============ Batch Analytics ============

/// Analyze buy/sell order distribution in a batch.
/// Returns (buy_count, sell_count, buy_volume, sell_volume, avg_buy_price, avg_sell_price)
pub fn analyze_order_book(
    reveals: &[RevealWitness],
) -> (u32, u32, u128, u128, u128, u128) {
    let mut buy_count: u32 = 0;
    let mut sell_count: u32 = 0;
    let mut buy_volume: u128 = 0;
    let mut sell_volume: u128 = 0;
    let mut buy_price_sum: u128 = 0;
    let mut sell_price_sum: u128 = 0;

    for reveal in reveals {
        match reveal.order_type {
            ORDER_BUY => {
                buy_count += 1;
                buy_volume += reveal.amount_in;
                buy_price_sum += reveal.limit_price;
            }
            ORDER_SELL => {
                sell_count += 1;
                sell_volume += reveal.amount_in;
                sell_price_sum += reveal.limit_price;
            }
            _ => {}
        }
    }

    let avg_buy_price = if buy_count > 0 {
        buy_price_sum / buy_count as u128
    } else {
        0
    };

    let avg_sell_price = if sell_count > 0 {
        sell_price_sum / sell_count as u128
    } else {
        0
    };

    (buy_count, sell_count, buy_volume, sell_volume, avg_buy_price, avg_sell_price)
}

/// Generate the XOR seed from a set of revealed secrets.
/// This is the deterministic entropy source for Fisher-Yates shuffle.
pub fn compute_xor_seed(secrets: &[[u8; 32]]) -> [u8; 32] {
    vibeswap_math::shuffle::generate_seed(secrets)
}

/// Verify that a claimed execution order matches the deterministic shuffle.
pub fn verify_execution_order(
    total_orders: usize,
    priority_count: usize,
    seed: &[u8; 32],
    claimed_order: &[usize],
) -> bool {
    let expected = vibeswap_math::shuffle::partition_and_shuffle(
        total_orders,
        priority_count,
        seed,
    );
    claimed_order == expected.as_slice()
}

/// Count how many commits in a batch have NOT been revealed.
/// Non-revealers get slashed.
pub fn count_non_revealers(auction: &AuctionCellData) -> u32 {
    auction.commit_count.saturating_sub(auction.reveal_count)
}

/// Estimate total slash revenue from non-revealers in a batch.
pub fn estimate_slash_revenue(
    non_reveal_count: u32,
    avg_deposit_ckb: u64,
    slash_rate_bps: u16,
) -> u64 {
    let per_slash = (avg_deposit_ckb as u128 * slash_rate_bps as u128 / 10_000) as u64;
    per_slash.saturating_mul(non_reveal_count as u64)
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    fn make_reveal(order_type: u8, amount: u128, limit_price: u128, priority: u64) -> RevealWitness {
        RevealWitness {
            order_type,
            amount_in: amount,
            limit_price,
            secret: [0xAA; 32],
            priority_bid: priority,
            commit_index: 0,
        }
    }

    fn make_reveal_with_secret(order_type: u8, amount: u128, limit_price: u128, secret: [u8; 32]) -> RevealWitness {
        RevealWitness {
            order_type,
            amount_in: amount,
            limit_price,
            secret,
            priority_bid: 0,
            commit_index: 0,
        }
    }

    fn default_auction() -> AuctionCellData {
        AuctionCellData {
            phase: PHASE_COMMIT,
            batch_id: 1,
            commit_mmr_root: [0u8; 32],
            commit_count: 5,
            reveal_count: 0,
            xor_seed: [0u8; 32],
            clearing_price: 0,
            fillable_volume: 0,
            difficulty_target: [0u8; 32],
            prev_state_hash: [0u8; 32],
            phase_start_block: 100,
            pair_id: [1u8; 32],
        }
    }

    fn default_config() -> ConfigCellData {
        ConfigCellData::default()
    }

    // ============ Order Hash ============

    #[test]
    fn test_order_hash_deterministic() {
        let secret = [0x42u8; 32];
        let h1 = commit_order_hash(ORDER_BUY, 1000 * PRECISION, 2000 * PRECISION, 100, &secret);
        let h2 = commit_order_hash(ORDER_BUY, 1000 * PRECISION, 2000 * PRECISION, 100, &secret);
        assert_eq!(h1, h2);
    }

    #[test]
    fn test_order_hash_differs_by_type() {
        let secret = [0x42u8; 32];
        let buy = commit_order_hash(ORDER_BUY, 1000, 2000, 0, &secret);
        let sell = commit_order_hash(ORDER_SELL, 1000, 2000, 0, &secret);
        assert_ne!(buy, sell);
    }

    #[test]
    fn test_order_hash_differs_by_secret() {
        let s1 = [0x01u8; 32];
        let s2 = [0x02u8; 32];
        let h1 = commit_order_hash(ORDER_BUY, 1000, 2000, 0, &s1);
        let h2 = commit_order_hash(ORDER_BUY, 1000, 2000, 0, &s2);
        assert_ne!(h1, h2);
    }

    #[test]
    fn test_order_hash_differs_by_amount() {
        let secret = [0x42u8; 32];
        let h1 = commit_order_hash(ORDER_BUY, 1000, 2000, 0, &secret);
        let h2 = commit_order_hash(ORDER_BUY, 1001, 2000, 0, &secret);
        assert_ne!(h1, h2);
    }

    #[test]
    fn test_order_hash_differs_by_priority() {
        let secret = [0x42u8; 32];
        let h1 = commit_order_hash(ORDER_BUY, 1000, 2000, 0, &secret);
        let h2 = commit_order_hash(ORDER_BUY, 1000, 2000, 100, &secret);
        assert_ne!(h1, h2);
    }

    #[test]
    fn test_order_hash_nonzero() {
        let secret = [0u8; 32];
        let hash = commit_order_hash(ORDER_BUY, 0, 0, 0, &secret);
        // Even with zero inputs, hash should be non-zero (SHA256 of non-empty data)
        assert_ne!(hash, [0u8; 32]);
    }

    // ============ Commit Validation ============

    #[test]
    fn test_validate_commit_success() {
        let secret = [0x42u8; 32];
        let hash = commit_order_hash(ORDER_BUY, 1000, 2000, 50, &secret);
        let auction = default_auction();
        let commit = CommitCellData {
            order_hash: hash,
            batch_id: auction.batch_id,
            deposit_ckb: 100_000,
            token_type_hash: [0x11; 32],
            token_amount: 1000,
            block_number: 105,
            sender_lock_hash: [0xAA; 32],
        };

        assert!(validate_commit(&commit, ORDER_BUY, 1000, 2000, 50, &secret, &auction).is_ok());
    }

    #[test]
    fn test_validate_commit_wrong_batch() {
        let secret = [0x42u8; 32];
        let hash = commit_order_hash(ORDER_BUY, 1000, 2000, 0, &secret);
        let auction = default_auction();
        let commit = CommitCellData {
            order_hash: hash,
            batch_id: 999, // Wrong batch
            deposit_ckb: 100_000,
            token_type_hash: [0x11; 32],
            token_amount: 1000,
            block_number: 105,
            sender_lock_hash: [0xAA; 32],
        };

        let err = validate_commit(&commit, ORDER_BUY, 1000, 2000, 0, &secret, &auction).unwrap_err();
        assert!(matches!(err, AuctionError::BatchIdMismatch { commit: 999, auction: 1 }));
    }

    #[test]
    fn test_validate_commit_wrong_phase() {
        let secret = [0x42u8; 32];
        let hash = commit_order_hash(ORDER_BUY, 1000, 2000, 0, &secret);
        let mut auction = default_auction();
        auction.phase = PHASE_REVEAL; // Wrong phase
        let commit = CommitCellData {
            order_hash: hash,
            batch_id: auction.batch_id,
            deposit_ckb: 100_000,
            token_type_hash: [0x11; 32],
            token_amount: 1000,
            block_number: 105,
            sender_lock_hash: [0xAA; 32],
        };

        let err = validate_commit(&commit, ORDER_BUY, 1000, 2000, 0, &secret, &auction).unwrap_err();
        assert!(matches!(err, AuctionError::WrongPhase { expected: 0, actual: 1 }));
    }

    #[test]
    fn test_validate_commit_hash_mismatch() {
        let secret = [0x42u8; 32];
        let auction = default_auction();
        let commit = CommitCellData {
            order_hash: [0xFF; 32], // Wrong hash
            batch_id: auction.batch_id,
            deposit_ckb: 100_000,
            token_type_hash: [0x11; 32],
            token_amount: 1000,
            block_number: 105,
            sender_lock_hash: [0xAA; 32],
        };

        let err = validate_commit(&commit, ORDER_BUY, 1000, 2000, 0, &secret, &auction).unwrap_err();
        assert!(matches!(err, AuctionError::CommitMismatch));
    }

    // ============ Reveal Verification ============

    #[test]
    fn test_verify_reveal_success() {
        let secret = [0x42u8; 32];
        let hash = commit_order_hash(ORDER_SELL, 5000, 1500, 200, &secret);

        let commit = CommitCellData {
            order_hash: hash,
            batch_id: 1,
            deposit_ckb: 100_000,
            token_type_hash: [0x11; 32],
            token_amount: 5000,
            block_number: 105,
            sender_lock_hash: [0xAA; 32],
        };

        let reveal = RevealWitness {
            order_type: ORDER_SELL,
            amount_in: 5000,
            limit_price: 1500,
            secret,
            priority_bid: 200,
            commit_index: 0,
        };

        assert!(verify_reveal(&reveal, &commit).is_ok());
    }

    #[test]
    fn test_verify_reveal_wrong_secret() {
        let secret = [0x42u8; 32];
        let hash = commit_order_hash(ORDER_BUY, 1000, 2000, 0, &secret);

        let commit = CommitCellData {
            order_hash: hash,
            batch_id: 1,
            deposit_ckb: 100_000,
            token_type_hash: [0x11; 32],
            token_amount: 1000,
            block_number: 105,
            sender_lock_hash: [0xAA; 32],
        };

        let reveal = RevealWitness {
            order_type: ORDER_BUY,
            amount_in: 1000,
            limit_price: 2000,
            secret: [0xFF; 32], // Wrong secret!
            priority_bid: 0,
            commit_index: 0,
        };

        assert_eq!(verify_reveal(&reveal, &commit).unwrap_err(), AuctionError::RevealMismatch);
    }

    #[test]
    fn test_verify_reveal_wrong_amount() {
        let secret = [0x42u8; 32];
        let hash = commit_order_hash(ORDER_BUY, 1000, 2000, 0, &secret);

        let commit = CommitCellData {
            order_hash: hash,
            batch_id: 1,
            deposit_ckb: 100_000,
            token_type_hash: [0x11; 32],
            token_amount: 1000,
            block_number: 105,
            sender_lock_hash: [0xAA; 32],
        };

        let reveal = RevealWitness {
            order_type: ORDER_BUY,
            amount_in: 9999, // Changed amount
            limit_price: 2000,
            secret,
            priority_bid: 0,
            commit_index: 0,
        };

        assert_eq!(verify_reveal(&reveal, &commit).unwrap_err(), AuctionError::RevealMismatch);
    }

    // ============ Phase Timing ============

    #[test]
    fn test_phase_info_commit_mid_window() {
        let auction = default_auction(); // phase_start_block = 100
        let config = default_config();   // commit_window = 40

        let info = phase_info(&auction, 120, &config); // 20 blocks in
        assert_eq!(info.phase, PHASE_COMMIT);
        assert_eq!(info.blocks_remaining, 20);
        assert!(!info.can_transition);
        assert_eq!(info.next_phase, PHASE_REVEAL);
    }

    #[test]
    fn test_phase_info_commit_expired() {
        let auction = default_auction();
        let config = default_config();

        let info = phase_info(&auction, 200, &config); // 100 blocks in, window=40
        assert_eq!(info.phase, PHASE_COMMIT);
        assert_eq!(info.blocks_remaining, 0);
        assert!(info.can_transition); // commit_count=5 > 0
        assert_eq!(info.next_phase, PHASE_REVEAL);
    }

    #[test]
    fn test_phase_info_commit_expired_no_commits() {
        let mut auction = default_auction();
        auction.commit_count = 0;
        let config = default_config();

        let info = phase_info(&auction, 200, &config);
        assert!(!info.can_transition); // No commits, can't transition
    }

    #[test]
    fn test_phase_info_reveal() {
        let mut auction = default_auction();
        auction.phase = PHASE_REVEAL;
        auction.phase_start_block = 150;
        let config = default_config(); // reveal_window = 10

        let info = phase_info(&auction, 155, &config);
        assert_eq!(info.phase, PHASE_REVEAL);
        assert_eq!(info.blocks_remaining, 5);
        assert!(!info.can_transition);
        assert_eq!(info.next_phase, PHASE_SETTLING);
    }

    #[test]
    fn test_phase_info_settling() {
        let mut auction = default_auction();
        auction.phase = PHASE_SETTLING;

        let info = phase_info(&auction, 500, &default_config());
        assert_eq!(info.phase, PHASE_SETTLING);
        assert!(info.can_transition);
        assert_eq!(info.next_phase, PHASE_SETTLED);
    }

    #[test]
    fn test_phase_info_settled() {
        let mut auction = default_auction();
        auction.phase = PHASE_SETTLED;

        let info = phase_info(&auction, 600, &default_config());
        assert_eq!(info.phase, PHASE_SETTLED);
        assert!(info.can_transition);
        assert_eq!(info.next_phase, PHASE_COMMIT);
    }

    // ============ Slash Calculation ============

    #[test]
    fn test_slash_default_50_percent() {
        let result = calculate_default_slash(1_000_000);
        assert_eq!(result.slash_amount, 500_000);
        assert_eq!(result.return_amount, 500_000);
        assert_eq!(result.slash_rate_bps, DEFAULT_SLASH_RATE_BPS);
    }

    #[test]
    fn test_slash_custom_rate() {
        let result = calculate_slash(1_000_000, 2500); // 25%
        assert_eq!(result.slash_amount, 250_000);
        assert_eq!(result.return_amount, 750_000);
    }

    #[test]
    fn test_slash_zero_deposit() {
        let result = calculate_default_slash(0);
        assert_eq!(result.slash_amount, 0);
        assert_eq!(result.return_amount, 0);
    }

    #[test]
    fn test_slash_100_percent() {
        let result = calculate_slash(1_000_000, 10_000);
        assert_eq!(result.slash_amount, 1_000_000);
        assert_eq!(result.return_amount, 0);
    }

    #[test]
    fn test_slash_conservation() {
        let deposit = 12_345_678;
        let result = calculate_slash(deposit, 3333);
        assert_eq!(result.slash_amount + result.return_amount, deposit);
    }

    // ============ Batch Simulation ============

    #[test]
    fn test_simulate_empty_batch() {
        let err = simulate_batch(&[], 1_000_000 * PRECISION, 1_000_000 * PRECISION, PRECISION).unwrap_err();
        assert_eq!(err, AuctionError::EmptyBatch);
    }

    #[test]
    fn test_simulate_balanced_batch() {
        let spot = PRECISION; // 1:1 price
        let reveals = vec![
            make_reveal(ORDER_BUY, 1_000 * PRECISION, 2 * PRECISION, 0),
            make_reveal(ORDER_SELL, 1_000 * PRECISION, PRECISION / 2, 0),
        ];

        let sim = simulate_batch(
            &reveals,
            1_000_000 * PRECISION,
            1_000_000 * PRECISION,
            spot,
        ).unwrap();

        assert!(sim.clearing_price > 0);
        assert!(sim.fillable_volume > 0);
        assert_eq!(sim.total_buy_volume, 1_000 * PRECISION);
        assert_eq!(sim.total_sell_volume, 1_000 * PRECISION);
    }

    #[test]
    fn test_simulate_buy_heavy_batch() {
        let spot = PRECISION;
        let reveals = vec![
            make_reveal(ORDER_BUY, 5_000 * PRECISION, 2 * PRECISION, 0),
            make_reveal(ORDER_BUY, 3_000 * PRECISION, 2 * PRECISION, 0),
            make_reveal(ORDER_SELL, 1_000 * PRECISION, PRECISION / 2, 0),
        ];

        let sim = simulate_batch(
            &reveals,
            1_000_000 * PRECISION,
            1_000_000 * PRECISION,
            spot,
        ).unwrap();

        assert!(sim.total_buy_volume > sim.total_sell_volume);
        assert!(sim.pressure_ratio > PRECISION); // More buy than sell pressure
    }

    #[test]
    fn test_simulate_invalid_order_type() {
        let reveals = vec![RevealWitness {
            order_type: 99, // Invalid
            amount_in: 1000,
            limit_price: 2000,
            secret: [0; 32],
            priority_bid: 0,
            commit_index: 0,
        }];

        let err = simulate_batch(&reveals, 1_000_000, 1_000_000, PRECISION).unwrap_err();
        assert_eq!(err, AuctionError::InvalidOrderType(99));
    }

    // ============ Fill Estimation ============

    #[test]
    fn test_estimate_fill_zero_amount() {
        let err = estimate_fill(ORDER_BUY, 0, PRECISION, 0, &[], 1_000_000, 1_000_000, PRECISION).unwrap_err();
        assert_eq!(err, AuctionError::ZeroAmount);
    }

    #[test]
    fn test_estimate_fill_buy_at_market() {
        let spot = PRECISION;
        // Place a generous buy limit (2x spot)
        let result = estimate_fill(
            ORDER_BUY,
            1_000 * PRECISION,
            2 * PRECISION,
            0,
            &[make_reveal(ORDER_SELL, 1_000 * PRECISION, PRECISION / 2, 0)],
            1_000_000 * PRECISION,
            1_000_000 * PRECISION,
            spot,
        ).unwrap();

        assert!(result.would_fill);
        assert!(result.estimated_output > 0);
        assert!(result.effective_price > 0);
    }

    #[test]
    fn test_estimate_fill_sell_at_market() {
        let spot = PRECISION;
        let result = estimate_fill(
            ORDER_SELL,
            1_000 * PRECISION,
            PRECISION / 2, // Willing to sell at half spot
            0,
            &[make_reveal(ORDER_BUY, 1_000 * PRECISION, 2 * PRECISION, 0)],
            1_000_000 * PRECISION,
            1_000_000 * PRECISION,
            spot,
        ).unwrap();

        assert!(result.would_fill);
        assert!(result.estimated_output > 0);
    }

    // ============ Order Book Analysis ============

    #[test]
    fn test_analyze_empty_book() {
        let (bc, sc, bv, sv, bp, sp) = analyze_order_book(&[]);
        assert_eq!((bc, sc, bv, sv, bp, sp), (0, 0, 0, 0, 0, 0));
    }

    #[test]
    fn test_analyze_mixed_book() {
        let reveals = vec![
            make_reveal(ORDER_BUY, 1_000, 2_000, 0),
            make_reveal(ORDER_BUY, 3_000, 1_800, 0),
            make_reveal(ORDER_SELL, 2_000, 1_500, 0),
        ];

        let (bc, sc, bv, sv, bp, sp) = analyze_order_book(&reveals);
        assert_eq!(bc, 2);
        assert_eq!(sc, 1);
        assert_eq!(bv, 4_000);
        assert_eq!(sv, 2_000);
        assert_eq!(bp, (2_000 + 1_800) / 2); // avg buy price
        assert_eq!(sp, 1_500); // avg sell price
    }

    #[test]
    fn test_analyze_all_buys() {
        let reveals = vec![
            make_reveal(ORDER_BUY, 1_000, 2_000, 0),
            make_reveal(ORDER_BUY, 2_000, 1_500, 0),
        ];

        let (bc, sc, bv, sv, _, sp) = analyze_order_book(&reveals);
        assert_eq!(bc, 2);
        assert_eq!(sc, 0);
        assert_eq!(bv, 3_000);
        assert_eq!(sv, 0);
        assert_eq!(sp, 0); // No sell orders
    }

    // ============ XOR Seed ============

    #[test]
    fn test_xor_seed_deterministic() {
        let secrets = vec![[0x01u8; 32], [0x02u8; 32], [0x03u8; 32]];
        let s1 = compute_xor_seed(&secrets);
        let s2 = compute_xor_seed(&secrets);
        assert_eq!(s1, s2);
    }

    #[test]
    fn test_xor_seed_different_secrets() {
        let s1 = compute_xor_seed(&[[0x01u8; 32], [0x02u8; 32]]);
        let s2 = compute_xor_seed(&[[0x03u8; 32], [0x04u8; 32]]);
        assert_ne!(s1, s2);
    }

    // ============ Execution Order Verification ============

    #[test]
    fn test_verify_execution_order_valid() {
        let seed = [0x42u8; 32];
        let expected = vibeswap_math::shuffle::partition_and_shuffle(10, 2, &seed);
        assert!(verify_execution_order(10, 2, &seed, &expected));
    }

    #[test]
    fn test_verify_execution_order_invalid() {
        let seed = [0x42u8; 32];
        let mut wrong_order = vibeswap_math::shuffle::partition_and_shuffle(10, 2, &seed);
        if wrong_order.len() >= 2 {
            wrong_order.swap(0, 1); // Tamper with order
        }
        assert!(!verify_execution_order(10, 2, &seed, &wrong_order));
    }

    // ============ Non-Revealer Counting ============

    #[test]
    fn test_count_non_revealers() {
        let mut auction = default_auction();
        auction.commit_count = 10;
        auction.reveal_count = 7;
        assert_eq!(count_non_revealers(&auction), 3);
    }

    #[test]
    fn test_count_non_revealers_all_revealed() {
        let mut auction = default_auction();
        auction.commit_count = 10;
        auction.reveal_count = 10;
        assert_eq!(count_non_revealers(&auction), 0);
    }

    // ============ Slash Revenue Estimation ============

    #[test]
    fn test_estimate_slash_revenue() {
        // 5 non-revealers, 100 CKB deposit each, 50% slash
        let revenue = estimate_slash_revenue(5, 100_000_000, 5000);
        assert_eq!(revenue, 5 * 50_000_000);
    }

    #[test]
    fn test_estimate_slash_revenue_zero_non_revealers() {
        let revenue = estimate_slash_revenue(0, 100_000_000, 5000);
        assert_eq!(revenue, 0);
    }

    // ============ Priority Bid Strategy ============

    #[test]
    fn test_optimal_priority_zero_volume() {
        let bid = optimal_priority_bid(1_000 * PRECISION, 0, 1_000_000 * PRECISION, 1_000_000 * PRECISION, 30);
        assert_eq!(bid, 0);
    }

    #[test]
    fn test_optimal_priority_increases_with_amount() {
        let small = optimal_priority_bid(
            100 * PRECISION, 50_000 * PRECISION,
            1_000_000 * PRECISION, 1_000_000 * PRECISION, 30,
        );
        let large = optimal_priority_bid(
            10_000 * PRECISION, 50_000 * PRECISION,
            1_000_000 * PRECISION, 1_000_000 * PRECISION, 30,
        );
        assert!(large >= small, "Larger orders should have higher optimal priority bids");
    }

    #[test]
    fn test_optimal_priority_zero_reserves() {
        let bid = optimal_priority_bid(1_000 * PRECISION, 50_000 * PRECISION, 0, 0, 30);
        assert_eq!(bid, 0);
    }

    // ============ Integration ============

    #[test]
    fn test_commit_reveal_roundtrip() {
        // Full commit → reveal → verify flow
        let secret = [0xDE; 32];
        let order_type = ORDER_BUY;
        let amount = 5_000 * PRECISION;
        let limit = 2 * PRECISION;
        let priority = 1000;

        // Step 1: Compute commit hash
        let hash = commit_order_hash(order_type, amount, limit, priority, &secret);
        assert_ne!(hash, [0u8; 32]);

        // Step 2: Create commit cell
        let auction = default_auction();
        let commit = CommitCellData {
            order_hash: hash,
            batch_id: auction.batch_id,
            deposit_ckb: 200_000,
            token_type_hash: [0x11; 32],
            token_amount: amount as u128,
            block_number: 110,
            sender_lock_hash: [0xCC; 32],
        };

        // Step 3: Validate commit
        assert!(validate_commit(&commit, order_type, amount, limit, priority, &secret, &auction).is_ok());

        // Step 4: Create reveal
        let reveal = RevealWitness {
            order_type,
            amount_in: amount,
            limit_price: limit,
            secret,
            priority_bid: priority,
            commit_index: 0,
        };

        // Step 5: Verify reveal matches commit
        assert!(verify_reveal(&reveal, &commit).is_ok());
    }

    #[test]
    fn test_full_batch_lifecycle() {
        let auction = default_auction();
        let config = default_config();

        // Phase 1: Commit window open
        let info = phase_info(&auction, 110, &config);
        assert_eq!(info.phase, PHASE_COMMIT);
        assert!(info.blocks_remaining > 0);

        // Phase 2: Commit window elapsed
        let info = phase_info(&auction, 200, &config);
        assert!(info.can_transition);

        // Phase 3: Simulate reveals
        let reveals = vec![
            make_reveal(ORDER_BUY, 2_000 * PRECISION, 2 * PRECISION, 0),
            make_reveal(ORDER_SELL, 1_500 * PRECISION, PRECISION / 2, 0),
        ];

        let sim = simulate_batch(
            &reveals,
            1_000_000 * PRECISION,
            1_000_000 * PRECISION,
            PRECISION,
        ).unwrap();

        assert!(sim.clearing_price > 0);
        assert!(sim.fillable_volume > 0);

        // Phase 4: Check non-revealers
        let mut settled_auction = auction.clone();
        settled_auction.commit_count = 5;
        settled_auction.reveal_count = 2;
        assert_eq!(count_non_revealers(&settled_auction), 3);

        // Phase 5: Slash non-revealers
        let slash = calculate_default_slash(200_000);
        assert_eq!(slash.slash_amount, 100_000);
    }

    // ============ Additional Edge Case & Boundary Tests ============

    #[test]
    fn test_order_hash_differs_by_limit_price() {
        let secret = [0x42u8; 32];
        let h1 = commit_order_hash(ORDER_BUY, 1000, 2000, 0, &secret);
        let h2 = commit_order_hash(ORDER_BUY, 1000, 2001, 0, &secret);
        assert_ne!(h1, h2);
    }

    #[test]
    fn test_order_hash_max_values() {
        // Test with u128::MAX amounts — should not panic
        let secret = [0xFF; 32];
        let hash = commit_order_hash(ORDER_BUY, u128::MAX, u128::MAX, u64::MAX, &secret);
        assert_ne!(hash, [0u8; 32]);
    }

    #[test]
    fn test_validate_commit_wrong_order_params() {
        // Commit hash was computed with one set of params, validate with different
        let secret = [0x42u8; 32];
        let hash = commit_order_hash(ORDER_BUY, 1000, 2000, 50, &secret);
        let auction = default_auction();
        let commit = CommitCellData {
            order_hash: hash,
            batch_id: auction.batch_id,
            deposit_ckb: 100_000,
            token_type_hash: [0x11; 32],
            token_amount: 1000,
            block_number: 105,
            sender_lock_hash: [0xAA; 32],
        };

        // Wrong amount_in
        assert!(matches!(
            validate_commit(&commit, ORDER_BUY, 999, 2000, 50, &secret, &auction),
            Err(AuctionError::CommitMismatch)
        ));
    }

    #[test]
    fn test_verify_reveal_wrong_order_type() {
        let secret = [0x42u8; 32];
        let hash = commit_order_hash(ORDER_BUY, 1000, 2000, 0, &secret);

        let commit = CommitCellData {
            order_hash: hash,
            batch_id: 1,
            deposit_ckb: 100_000,
            token_type_hash: [0x11; 32],
            token_amount: 1000,
            block_number: 105,
            sender_lock_hash: [0xAA; 32],
        };

        let reveal = RevealWitness {
            order_type: ORDER_SELL, // Was committed as BUY
            amount_in: 1000,
            limit_price: 2000,
            secret,
            priority_bid: 0,
            commit_index: 0,
        };

        assert_eq!(verify_reveal(&reveal, &commit).unwrap_err(), AuctionError::RevealMismatch);
    }

    #[test]
    fn test_verify_reveal_wrong_priority_bid() {
        let secret = [0x42u8; 32];
        let hash = commit_order_hash(ORDER_BUY, 1000, 2000, 100, &secret);

        let commit = CommitCellData {
            order_hash: hash,
            batch_id: 1,
            deposit_ckb: 100_000,
            token_type_hash: [0x11; 32],
            token_amount: 1000,
            block_number: 105,
            sender_lock_hash: [0xAA; 32],
        };

        let reveal = RevealWitness {
            order_type: ORDER_BUY,
            amount_in: 1000,
            limit_price: 2000,
            secret,
            priority_bid: 999, // Was committed as 100
            commit_index: 0,
        };

        assert_eq!(verify_reveal(&reveal, &commit).unwrap_err(), AuctionError::RevealMismatch);
    }

    #[test]
    fn test_phase_info_commit_at_exact_boundary() {
        let auction = default_auction(); // phase_start_block = 100
        let config = default_config();   // commit_window = 40

        // Exactly at the boundary: block 140 = 40 blocks elapsed = window
        let info = phase_info(&auction, 140, &config);
        assert_eq!(info.phase, PHASE_COMMIT);
        assert_eq!(info.blocks_remaining, 0);
        assert!(info.can_transition); // commit_count=5 > 0
    }

    #[test]
    fn test_phase_info_reveal_expired() {
        let mut auction = default_auction();
        auction.phase = PHASE_REVEAL;
        auction.phase_start_block = 150;
        let config = default_config(); // reveal_window = 10

        // 20 blocks in, window=10 → expired
        let info = phase_info(&auction, 170, &config);
        assert_eq!(info.phase, PHASE_REVEAL);
        assert_eq!(info.blocks_remaining, 0);
        assert!(info.can_transition);
        assert_eq!(info.next_phase, PHASE_SETTLING);
    }

    #[test]
    fn test_phase_info_unknown_phase() {
        let mut auction = default_auction();
        auction.phase = 99; // Unknown phase

        let info = phase_info(&auction, 200, &default_config());
        assert_eq!(info.phase, 99);
        assert!(!info.can_transition);
        assert_eq!(info.next_phase, 99); // Points to itself
    }

    #[test]
    fn test_phase_info_current_block_before_start() {
        // Edge case: current_block < phase_start_block (saturating_sub should handle)
        let mut auction = default_auction();
        auction.phase_start_block = 200;
        let config = default_config();

        let info = phase_info(&auction, 100, &config); // Before start
        assert_eq!(info.phase, PHASE_COMMIT);
        assert_eq!(info.blocks_remaining, config.commit_window_blocks); // Full window remaining
        assert!(!info.can_transition);
    }

    #[test]
    fn test_slash_small_deposit_rounding() {
        // 1 shannon with 50% slash → should truncate to 0
        let result = calculate_slash(1, 5000);
        assert_eq!(result.slash_amount, 0);
        assert_eq!(result.return_amount, 1);
        assert_eq!(result.slash_amount + result.return_amount, 1);
    }

    #[test]
    fn test_slash_odd_amount_conservation() {
        // Odd deposit with a rate that causes truncation
        let deposit = 999_999;
        let result = calculate_slash(deposit, 3333); // 33.33%
        assert_eq!(result.slash_amount + result.return_amount, deposit);
    }

    #[test]
    fn test_slash_zero_rate() {
        let result = calculate_slash(1_000_000, 0);
        assert_eq!(result.slash_amount, 0);
        assert_eq!(result.return_amount, 1_000_000);
        assert_eq!(result.slash_rate_bps, 0);
    }

    #[test]
    fn test_simulate_all_buys_no_sells() {
        let reveals = vec![
            make_reveal(ORDER_BUY, 1_000 * PRECISION, 2 * PRECISION, 0),
            make_reveal(ORDER_BUY, 500 * PRECISION, 2 * PRECISION, 0),
        ];

        // This may fail or succeed depending on batch_math internals,
        // but should not panic
        let result = simulate_batch(
            &reveals,
            1_000_000 * PRECISION,
            1_000_000 * PRECISION,
            PRECISION,
        );
        // Either Ok or ClearingPriceFailed — both are valid outcomes
        assert!(result.is_ok() || matches!(result, Err(AuctionError::ClearingPriceFailed)));
    }

    #[test]
    fn test_simulate_pressure_ratio_sell_heavy() {
        let spot = PRECISION;
        let reveals = vec![
            make_reveal(ORDER_BUY, 1_000 * PRECISION, 2 * PRECISION, 0),
            make_reveal(ORDER_SELL, 5_000 * PRECISION, PRECISION / 2, 0),
            make_reveal(ORDER_SELL, 3_000 * PRECISION, PRECISION / 2, 0),
        ];

        let sim = simulate_batch(
            &reveals,
            1_000_000 * PRECISION,
            1_000_000 * PRECISION,
            spot,
        ).unwrap();

        assert!(sim.total_sell_volume > sim.total_buy_volume);
        assert!(sim.pressure_ratio < PRECISION); // More sell than buy pressure
    }

    #[test]
    fn test_estimate_fill_invalid_order_type() {
        let err = estimate_fill(
            99, // Invalid
            1_000 * PRECISION,
            PRECISION,
            0,
            &[],
            1_000_000 * PRECISION,
            1_000_000 * PRECISION,
            PRECISION,
        );
        // Should return an error (InvalidOrderType or EmptyBatch depending on path)
        assert!(err.is_err());
    }

    #[test]
    fn test_count_non_revealers_overflow_safety() {
        // Edge: reveal_count > commit_count (shouldn't happen, but test saturating_sub)
        let mut auction = default_auction();
        auction.commit_count = 3;
        auction.reveal_count = 10;
        assert_eq!(count_non_revealers(&auction), 0); // saturating_sub
    }

    #[test]
    fn test_estimate_slash_revenue_large_values() {
        // Test with large counts to verify no overflow
        let revenue = estimate_slash_revenue(100, 500_000_000, 5000); // 100 non-revealers, 5 CKB each
        assert_eq!(revenue, 100 * 250_000_000); // 50% of 500M shannons each
    }

    #[test]
    fn test_estimate_slash_revenue_zero_deposit() {
        let revenue = estimate_slash_revenue(10, 0, 5000);
        assert_eq!(revenue, 0);
    }

    #[test]
    fn test_analyze_all_sells() {
        let reveals = vec![
            make_reveal(ORDER_SELL, 2_000, 1_500, 0),
            make_reveal(ORDER_SELL, 3_000, 1_200, 0),
        ];

        let (bc, sc, bv, sv, bp, sp) = analyze_order_book(&reveals);
        assert_eq!(bc, 0);
        assert_eq!(sc, 2);
        assert_eq!(bv, 0);
        assert_eq!(sv, 5_000);
        assert_eq!(bp, 0); // No buy orders
        assert_eq!(sp, (1_500 + 1_200) / 2);
    }

    #[test]
    fn test_analyze_skips_invalid_order_types() {
        let reveals = vec![
            make_reveal(ORDER_BUY, 1_000, 2_000, 0),
            RevealWitness {
                order_type: 99, // Invalid — should be skipped
                amount_in: 5_000,
                limit_price: 3_000,
                secret: [0xAA; 32],
                priority_bid: 0,
                commit_index: 0,
            },
        ];

        let (bc, sc, bv, sv, _, _) = analyze_order_book(&reveals);
        assert_eq!(bc, 1);
        assert_eq!(sc, 0);
        assert_eq!(bv, 1_000);
        assert_eq!(sv, 0);
    }

    #[test]
    fn test_xor_seed_single_secret() {
        let s = compute_xor_seed(&[[0x42u8; 32]]);
        assert_ne!(s, [0u8; 32]);
    }

    #[test]
    fn test_xor_seed_empty_secrets() {
        let s = compute_xor_seed(&[]);
        // With no secrets the seed is the XOR of nothing — implementation defined
        // Just verify it doesn't panic
        let _ = s;
    }

    #[test]
    fn test_optimal_priority_one_reserve_zero() {
        // One reserve zero, one nonzero
        let bid = optimal_priority_bid(1_000 * PRECISION, 50_000 * PRECISION, PRECISION, 0, 30);
        assert_eq!(bid, 0);
    }

    #[test]
    fn test_optimal_priority_increases_with_batch_volume() {
        let small_vol = optimal_priority_bid(
            1_000 * PRECISION, 10_000 * PRECISION,
            1_000_000 * PRECISION, 1_000_000 * PRECISION, 30,
        );
        let large_vol = optimal_priority_bid(
            1_000 * PRECISION, 500_000 * PRECISION,
            1_000_000 * PRECISION, 1_000_000 * PRECISION, 30,
        );
        assert!(large_vol >= small_vol, "Higher batch volume should suggest higher priority bid");
    }

    // ============ NEW TESTS: Edge Cases, Boundaries, Error Paths ============

    // --- Order Hash Edge Cases ---

    #[test]
    fn test_order_hash_zero_amount_zero_price() {
        let secret = [0x42u8; 32];
        let hash = commit_order_hash(ORDER_BUY, 0, 0, 0, &secret);
        // Different from all-zero secret version
        let hash2 = commit_order_hash(ORDER_BUY, 0, 0, 0, &[0u8; 32]);
        assert_ne!(hash, hash2);
    }

    #[test]
    fn test_order_hash_u128_max_amount_only() {
        let secret = [0x01u8; 32];
        let h1 = commit_order_hash(ORDER_BUY, u128::MAX, 0, 0, &secret);
        let h2 = commit_order_hash(ORDER_BUY, u128::MAX - 1, 0, 0, &secret);
        assert_ne!(h1, h2);
    }

    #[test]
    fn test_order_hash_u128_max_limit_price_only() {
        let secret = [0x01u8; 32];
        let h1 = commit_order_hash(ORDER_SELL, 1000, u128::MAX, 0, &secret);
        let h2 = commit_order_hash(ORDER_SELL, 1000, u128::MAX - 1, 0, &secret);
        assert_ne!(h1, h2);
    }

    #[test]
    fn test_order_hash_u64_max_priority() {
        let secret = [0x01u8; 32];
        let h1 = commit_order_hash(ORDER_BUY, 1000, 2000, u64::MAX, &secret);
        let h2 = commit_order_hash(ORDER_BUY, 1000, 2000, u64::MAX - 1, &secret);
        assert_ne!(h1, h2);
    }

    #[test]
    fn test_order_hash_sell_type_with_all_max_values() {
        let secret = [0xFF; 32];
        let hash = commit_order_hash(ORDER_SELL, u128::MAX, u128::MAX, u64::MAX, &secret);
        assert_ne!(hash, [0u8; 32]);
        // Also verify determinism at extremes
        let hash2 = commit_order_hash(ORDER_SELL, u128::MAX, u128::MAX, u64::MAX, &secret);
        assert_eq!(hash, hash2);
    }

    // --- Commit Validation Edge Cases ---

    #[test]
    fn test_validate_commit_settling_phase() {
        let secret = [0x42u8; 32];
        let hash = commit_order_hash(ORDER_BUY, 1000, 2000, 0, &secret);
        let mut auction = default_auction();
        auction.phase = PHASE_SETTLING;
        let commit = CommitCellData {
            order_hash: hash,
            batch_id: auction.batch_id,
            deposit_ckb: 100_000,
            token_type_hash: [0x11; 32],
            token_amount: 1000,
            block_number: 105,
            sender_lock_hash: [0xAA; 32],
        };

        let err = validate_commit(&commit, ORDER_BUY, 1000, 2000, 0, &secret, &auction).unwrap_err();
        assert!(matches!(err, AuctionError::WrongPhase { expected: 0, actual: 2 }));
    }

    #[test]
    fn test_validate_commit_settled_phase() {
        let secret = [0x42u8; 32];
        let hash = commit_order_hash(ORDER_BUY, 1000, 2000, 0, &secret);
        let mut auction = default_auction();
        auction.phase = PHASE_SETTLED;
        let commit = CommitCellData {
            order_hash: hash,
            batch_id: auction.batch_id,
            deposit_ckb: 100_000,
            token_type_hash: [0x11; 32],
            token_amount: 1000,
            block_number: 105,
            sender_lock_hash: [0xAA; 32],
        };

        let err = validate_commit(&commit, ORDER_BUY, 1000, 2000, 0, &secret, &auction).unwrap_err();
        assert!(matches!(err, AuctionError::WrongPhase { expected: 0, actual: 3 }));
    }

    #[test]
    fn test_validate_commit_batch_id_zero() {
        let secret = [0x42u8; 32];
        let hash = commit_order_hash(ORDER_BUY, 1000, 2000, 0, &secret);
        let mut auction = default_auction();
        auction.batch_id = 0;
        let commit = CommitCellData {
            order_hash: hash,
            batch_id: 0,
            deposit_ckb: 100_000,
            token_type_hash: [0x11; 32],
            token_amount: 1000,
            block_number: 105,
            sender_lock_hash: [0xAA; 32],
        };

        assert!(validate_commit(&commit, ORDER_BUY, 1000, 2000, 0, &secret, &auction).is_ok());
    }

    #[test]
    fn test_validate_commit_checks_batch_before_phase() {
        // When both batch ID and phase are wrong, batch mismatch should be caught first
        let secret = [0x42u8; 32];
        let hash = commit_order_hash(ORDER_BUY, 1000, 2000, 0, &secret);
        let mut auction = default_auction();
        auction.phase = PHASE_REVEAL; // Wrong phase
        let commit = CommitCellData {
            order_hash: hash,
            batch_id: 999, // Wrong batch
            deposit_ckb: 100_000,
            token_type_hash: [0x11; 32],
            token_amount: 1000,
            block_number: 105,
            sender_lock_hash: [0xAA; 32],
        };

        let err = validate_commit(&commit, ORDER_BUY, 1000, 2000, 0, &secret, &auction).unwrap_err();
        assert!(matches!(err, AuctionError::BatchIdMismatch { .. }));
    }

    #[test]
    fn test_validate_commit_wrong_secret_causes_mismatch() {
        let secret = [0x42u8; 32];
        let wrong_secret = [0x43u8; 32];
        let hash = commit_order_hash(ORDER_BUY, 1000, 2000, 0, &secret);
        let auction = default_auction();
        let commit = CommitCellData {
            order_hash: hash,
            batch_id: auction.batch_id,
            deposit_ckb: 100_000,
            token_type_hash: [0x11; 32],
            token_amount: 1000,
            block_number: 105,
            sender_lock_hash: [0xAA; 32],
        };

        let err = validate_commit(&commit, ORDER_BUY, 1000, 2000, 0, &wrong_secret, &auction).unwrap_err();
        assert!(matches!(err, AuctionError::CommitMismatch));
    }

    // --- Reveal Verification Edge Cases ---

    #[test]
    fn test_verify_reveal_wrong_limit_price() {
        let secret = [0x42u8; 32];
        let hash = commit_order_hash(ORDER_BUY, 1000, 2000, 0, &secret);
        let commit = CommitCellData {
            order_hash: hash,
            batch_id: 1,
            deposit_ckb: 100_000,
            token_type_hash: [0x11; 32],
            token_amount: 1000,
            block_number: 105,
            sender_lock_hash: [0xAA; 32],
        };
        let reveal = RevealWitness {
            order_type: ORDER_BUY,
            amount_in: 1000,
            limit_price: 2001, // Wrong limit price
            secret,
            priority_bid: 0,
            commit_index: 0,
        };
        assert_eq!(verify_reveal(&reveal, &commit).unwrap_err(), AuctionError::RevealMismatch);
    }

    #[test]
    fn test_verify_reveal_all_zero_params() {
        let secret = [0u8; 32];
        let hash = commit_order_hash(0, 0, 0, 0, &secret);
        let commit = CommitCellData {
            order_hash: hash,
            batch_id: 0,
            deposit_ckb: 0,
            token_type_hash: [0; 32],
            token_amount: 0,
            block_number: 0,
            sender_lock_hash: [0; 32],
        };
        let reveal = RevealWitness {
            order_type: 0,
            amount_in: 0,
            limit_price: 0,
            secret,
            priority_bid: 0,
            commit_index: 0,
        };
        assert!(verify_reveal(&reveal, &commit).is_ok());
    }

    #[test]
    fn test_verify_reveal_max_values_roundtrip() {
        let secret = [0xFF; 32];
        let hash = commit_order_hash(ORDER_SELL, u128::MAX, u128::MAX, u64::MAX, &secret);
        let commit = CommitCellData {
            order_hash: hash,
            batch_id: u64::MAX,
            deposit_ckb: u64::MAX,
            token_type_hash: [0xFF; 32],
            token_amount: u128::MAX,
            block_number: u64::MAX,
            sender_lock_hash: [0xFF; 32],
        };
        let reveal = RevealWitness {
            order_type: ORDER_SELL,
            amount_in: u128::MAX,
            limit_price: u128::MAX,
            secret,
            priority_bid: u64::MAX,
            commit_index: u32::MAX,
        };
        assert!(verify_reveal(&reveal, &commit).is_ok());
    }

    // --- Phase Timing Edge Cases ---

    #[test]
    fn test_phase_info_commit_at_start_block() {
        let auction = default_auction(); // phase_start_block = 100
        let config = default_config();   // commit_window = 40
        // At exact start block: 0 elapsed, full window remaining
        let info = phase_info(&auction, 100, &config);
        assert_eq!(info.phase, PHASE_COMMIT);
        assert_eq!(info.blocks_remaining, 40);
        assert!(!info.can_transition);
    }

    #[test]
    fn test_phase_info_commit_one_block_before_boundary() {
        let auction = default_auction(); // phase_start_block = 100
        let config = default_config();   // commit_window = 40
        // Block 139 = 39 elapsed, 1 remaining
        let info = phase_info(&auction, 139, &config);
        assert_eq!(info.blocks_remaining, 1);
        assert!(!info.can_transition);
    }

    #[test]
    fn test_phase_info_reveal_at_exact_boundary() {
        let mut auction = default_auction();
        auction.phase = PHASE_REVEAL;
        auction.phase_start_block = 150;
        let config = default_config(); // reveal_window = 10
        // Block 160 = exactly 10 elapsed = window
        let info = phase_info(&auction, 160, &config);
        assert_eq!(info.blocks_remaining, 0);
        assert!(info.can_transition);
    }

    #[test]
    fn test_phase_info_reveal_one_block_before_boundary() {
        let mut auction = default_auction();
        auction.phase = PHASE_REVEAL;
        auction.phase_start_block = 150;
        let config = default_config(); // reveal_window = 10
        // Block 159 = 9 elapsed, 1 remaining
        let info = phase_info(&auction, 159, &config);
        assert_eq!(info.blocks_remaining, 1);
        assert!(!info.can_transition);
    }

    #[test]
    fn test_phase_info_settling_always_zero_remaining() {
        let mut auction = default_auction();
        auction.phase = PHASE_SETTLING;
        auction.phase_start_block = 0;
        let info = phase_info(&auction, 0, &default_config());
        assert_eq!(info.blocks_remaining, 0);
        assert!(info.can_transition);
    }

    #[test]
    fn test_phase_info_max_block_numbers() {
        let mut auction = default_auction();
        auction.phase_start_block = u64::MAX - 1;
        let config = default_config();
        // At u64::MAX: 1 block elapsed, should not overflow
        let info = phase_info(&auction, u64::MAX, &config);
        assert_eq!(info.phase, PHASE_COMMIT);
        assert!(!info.can_transition); // Only 1 block elapsed, window is 40
    }

    // --- Slash Calculation Edge Cases ---

    #[test]
    fn test_slash_one_bps() {
        // 1 bps = 0.01%
        let result = calculate_slash(1_000_000, 1);
        assert_eq!(result.slash_amount, 100); // 1_000_000 * 1 / 10_000 = 100
        assert_eq!(result.return_amount, 999_900);
        assert_eq!(result.slash_amount + result.return_amount, 1_000_000);
    }

    #[test]
    fn test_slash_9999_bps() {
        // 99.99% slash
        let result = calculate_slash(1_000_000, 9999);
        assert_eq!(result.slash_amount, 999_900);
        assert_eq!(result.return_amount, 100);
    }

    #[test]
    fn test_slash_large_deposit_no_overflow() {
        // Max u64 deposit with 50% slash — intermediate computation uses u128
        let deposit = u64::MAX;
        let result = calculate_slash(deposit, 5000);
        // (u64::MAX as u128 * 5000 / 10_000) as u64
        let expected_slash = (u64::MAX as u128 * 5000 / 10_000) as u64;
        assert_eq!(result.slash_amount, expected_slash);
        assert_eq!(result.slash_amount + result.return_amount, deposit);
    }

    #[test]
    fn test_slash_deposit_1_rate_10000() {
        // 1 shannon with 100% slash
        let result = calculate_slash(1, 10_000);
        assert_eq!(result.slash_amount, 1);
        assert_eq!(result.return_amount, 0);
    }

    #[test]
    fn test_slash_deposit_1_rate_1() {
        // 1 shannon with 0.01% slash — rounds to 0
        let result = calculate_slash(1, 1);
        assert_eq!(result.slash_amount, 0);
        assert_eq!(result.return_amount, 1);
    }

    // --- Batch Simulation Edge Cases ---

    #[test]
    fn test_simulate_single_buy_order() {
        let reveals = vec![
            make_reveal(ORDER_BUY, 1_000 * PRECISION, 2 * PRECISION, 0),
        ];
        let result = simulate_batch(
            &reveals,
            1_000_000 * PRECISION,
            1_000_000 * PRECISION,
            PRECISION,
        );
        // Single buy with no sells — may succeed via AMM or fail
        assert!(result.is_ok() || matches!(result, Err(AuctionError::ClearingPriceFailed)));
    }

    #[test]
    fn test_simulate_single_sell_order() {
        let reveals = vec![
            make_reveal(ORDER_SELL, 1_000 * PRECISION, PRECISION / 2, 0),
        ];
        let result = simulate_batch(
            &reveals,
            1_000_000 * PRECISION,
            1_000_000 * PRECISION,
            PRECISION,
        );
        assert!(result.is_ok() || matches!(result, Err(AuctionError::ClearingPriceFailed)));
    }

    #[test]
    fn test_simulate_many_orders() {
        // 10 buys, 10 sells — stress test
        let mut reveals = Vec::new();
        for i in 0..10 {
            reveals.push(make_reveal(
                ORDER_BUY,
                (100 + i as u128) * PRECISION,
                2 * PRECISION,
                0,
            ));
            reveals.push(make_reveal(
                ORDER_SELL,
                (100 + i as u128) * PRECISION,
                PRECISION / 2,
                0,
            ));
        }

        let result = simulate_batch(
            &reveals,
            10_000_000 * PRECISION,
            10_000_000 * PRECISION,
            PRECISION,
        );
        assert!(result.is_ok());
        let sim = result.unwrap();
        assert_eq!(sim.buy_fills + sim.sell_fills, 20); // All should fill with generous limits
    }

    #[test]
    fn test_simulate_buy_sell_volume_tracking() {
        let reveals = vec![
            make_reveal(ORDER_BUY, 100 * PRECISION, 2 * PRECISION, 0),
            make_reveal(ORDER_BUY, 200 * PRECISION, 2 * PRECISION, 0),
            make_reveal(ORDER_SELL, 50 * PRECISION, PRECISION / 2, 0),
            make_reveal(ORDER_SELL, 75 * PRECISION, PRECISION / 2, 0),
        ];
        let sim = simulate_batch(
            &reveals,
            1_000_000 * PRECISION,
            1_000_000 * PRECISION,
            PRECISION,
        ).unwrap();
        assert_eq!(sim.total_buy_volume, 300 * PRECISION);
        assert_eq!(sim.total_sell_volume, 125 * PRECISION);
    }

    #[test]
    fn test_simulate_spot_price_zero_no_panic() {
        // spot_price = 0 should still produce price_impact_bps = 0
        let reveals = vec![
            make_reveal(ORDER_BUY, 1_000 * PRECISION, 2 * PRECISION, 0),
            make_reveal(ORDER_SELL, 1_000 * PRECISION, PRECISION / 2, 0),
        ];
        let result = simulate_batch(
            &reveals,
            1_000_000 * PRECISION,
            1_000_000 * PRECISION,
            0, // zero spot price
        );
        if let Ok(sim) = result {
            assert_eq!(sim.price_impact_bps, 0);
        }
    }

    // --- Fill Estimation Edge Cases ---

    #[test]
    fn test_estimate_fill_with_priority_bid() {
        let spot = PRECISION;
        let other = make_reveal(ORDER_SELL, 1_000 * PRECISION, PRECISION / 2, 0);
        let result = estimate_fill(
            ORDER_BUY,
            1_000 * PRECISION,
            2 * PRECISION,
            500, // priority bid
            &[other],
            1_000_000 * PRECISION,
            1_000_000 * PRECISION,
            spot,
        ).unwrap();
        assert!(result.would_fill);
        // With a priority bid, queue_position should be 0 (no one has higher bid)
        assert_eq!(result.queue_position, 0);
    }

    #[test]
    fn test_estimate_fill_multiple_priority_bidders() {
        let spot = PRECISION;
        let others = vec![
            make_reveal(ORDER_SELL, 1_000 * PRECISION, PRECISION / 2, 1000), // higher priority
            make_reveal(ORDER_SELL, 1_000 * PRECISION, PRECISION / 2, 200),  // lower priority
        ];
        let result = estimate_fill(
            ORDER_BUY,
            500 * PRECISION,
            2 * PRECISION,
            500, // mid-range priority
            &others,
            1_000_000 * PRECISION,
            1_000_000 * PRECISION,
            spot,
        ).unwrap();
        // 1 bidder has higher priority (1000 > 500), so queue_position = 1
        assert_eq!(result.queue_position, 1);
    }

    #[test]
    fn test_estimate_fill_no_priority_queue_position() {
        let spot = PRECISION;
        let others = vec![
            make_reveal(ORDER_SELL, 500 * PRECISION, PRECISION / 2, 100), // has priority
            make_reveal(ORDER_SELL, 500 * PRECISION, PRECISION / 2, 0),   // no priority
        ];
        let result = estimate_fill(
            ORDER_BUY,
            500 * PRECISION,
            2 * PRECISION,
            0, // no priority bid
            &others,
            1_000_000 * PRECISION,
            1_000_000 * PRECISION,
            spot,
        ).unwrap();
        // priority_count = 1 (the one with bid=100), non-priority = 2 (self + one other)
        // queue_position = priority_count + (total - priority_count) / 2 = 1 + 2/2 = 2
        assert_eq!(result.queue_position, 2);
    }

    #[test]
    fn test_estimate_fill_priority_helpful_large_order() {
        let spot = PRECISION;
        // One large order against a small counterparty — should signal priority is helpful
        let others = vec![
            make_reveal(ORDER_SELL, 100 * PRECISION, PRECISION / 2, 0),
        ];
        let result = estimate_fill(
            ORDER_BUY,
            500 * PRECISION, // Very large relative to fillable volume
            2 * PRECISION,
            0,
            &others,
            1_000_000 * PRECISION,
            1_000_000 * PRECISION,
            spot,
        ).unwrap();
        // priority_helpful should be true if order > 5% of fillable volume
        // (this depends on fillable_volume from batch sim)
        let _ = result.priority_helpful; // Verify no panic; value depends on sim
    }

    // --- Order Book Analysis Edge Cases ---

    #[test]
    fn test_analyze_single_buy() {
        let reveals = vec![make_reveal(ORDER_BUY, 5_000, 3_000, 0)];
        let (bc, sc, bv, sv, bp, sp) = analyze_order_book(&reveals);
        assert_eq!(bc, 1);
        assert_eq!(sc, 0);
        assert_eq!(bv, 5_000);
        assert_eq!(sv, 0);
        assert_eq!(bp, 3_000);
        assert_eq!(sp, 0);
    }

    #[test]
    fn test_analyze_single_sell() {
        let reveals = vec![make_reveal(ORDER_SELL, 7_000, 1_000, 0)];
        let (bc, sc, bv, sv, bp, sp) = analyze_order_book(&reveals);
        assert_eq!(bc, 0);
        assert_eq!(sc, 1);
        assert_eq!(bv, 0);
        assert_eq!(sv, 7_000);
        assert_eq!(bp, 0);
        assert_eq!(sp, 1_000);
    }

    #[test]
    fn test_analyze_all_invalid_order_types() {
        let reveals = vec![
            RevealWitness {
                order_type: 5,
                amount_in: 1_000,
                limit_price: 2_000,
                secret: [0xAA; 32],
                priority_bid: 0,
                commit_index: 0,
            },
            RevealWitness {
                order_type: 99,
                amount_in: 2_000,
                limit_price: 3_000,
                secret: [0xBB; 32],
                priority_bid: 0,
                commit_index: 0,
            },
        ];
        let (bc, sc, bv, sv, bp, sp) = analyze_order_book(&reveals);
        assert_eq!((bc, sc, bv, sv, bp, sp), (0, 0, 0, 0, 0, 0));
    }

    #[test]
    fn test_analyze_avg_price_precision() {
        // Test that avg price is correct with integer division
        let reveals = vec![
            make_reveal(ORDER_BUY, 1_000, 10, 0),
            make_reveal(ORDER_BUY, 2_000, 20, 0),
            make_reveal(ORDER_BUY, 3_000, 30, 0),
        ];
        let (bc, _, _, _, bp, _) = analyze_order_book(&reveals);
        assert_eq!(bc, 3);
        assert_eq!(bp, (10 + 20 + 30) / 3); // = 20
    }

    // --- XOR Seed Edge Cases ---

    #[test]
    fn test_xor_seed_two_identical_secrets() {
        let s1 = compute_xor_seed(&[[0x42u8; 32], [0x42u8; 32]]);
        let s2 = compute_xor_seed(&[[0x42u8; 32]]);
        // Two identical secrets XOR to zero for their contribution, different from one secret
        assert_ne!(s1, s2);
    }

    #[test]
    fn test_xor_seed_order_matters_or_not() {
        // XOR is commutative, so order should NOT matter for the raw XOR,
        // but generate_seed may do more than just XOR
        let s1 = compute_xor_seed(&[[0x01u8; 32], [0x02u8; 32]]);
        let s2 = compute_xor_seed(&[[0x02u8; 32], [0x01u8; 32]]);
        // Just verify neither panics; commutativity depends on implementation
        let _ = (s1, s2);
    }

    // --- Execution Order Verification Edge Cases ---

    #[test]
    fn test_verify_execution_order_single_element() {
        let seed = [0x42u8; 32];
        let expected = vibeswap_math::shuffle::partition_and_shuffle(1, 0, &seed);
        assert!(verify_execution_order(1, 0, &seed, &expected));
    }

    #[test]
    fn test_verify_execution_order_all_priority() {
        let seed = [0x42u8; 32];
        let expected = vibeswap_math::shuffle::partition_and_shuffle(5, 5, &seed);
        assert!(verify_execution_order(5, 5, &seed, &expected));
    }

    #[test]
    fn test_verify_execution_order_no_priority() {
        let seed = [0x42u8; 32];
        let expected = vibeswap_math::shuffle::partition_and_shuffle(5, 0, &seed);
        assert!(verify_execution_order(5, 0, &seed, &expected));
    }

    #[test]
    fn test_verify_execution_order_empty_claimed() {
        let seed = [0x42u8; 32];
        // Empty claimed order should match empty expected when total_orders = 0
        assert!(verify_execution_order(0, 0, &seed, &[]));
    }

    #[test]
    fn test_verify_execution_order_wrong_length() {
        let seed = [0x42u8; 32];
        let wrong = vec![0, 1]; // Only 2 elements but 5 expected
        assert!(!verify_execution_order(5, 0, &seed, &wrong));
    }

    // --- Non-Revealer Edge Cases ---

    #[test]
    fn test_count_non_revealers_zero_both() {
        let mut auction = default_auction();
        auction.commit_count = 0;
        auction.reveal_count = 0;
        assert_eq!(count_non_revealers(&auction), 0);
    }

    #[test]
    fn test_count_non_revealers_max_values() {
        let mut auction = default_auction();
        auction.commit_count = u32::MAX;
        auction.reveal_count = 0;
        assert_eq!(count_non_revealers(&auction), u32::MAX);
    }

    #[test]
    fn test_count_non_revealers_one_missing() {
        let mut auction = default_auction();
        auction.commit_count = 100;
        auction.reveal_count = 99;
        assert_eq!(count_non_revealers(&auction), 1);
    }

    // --- Slash Revenue Edge Cases ---

    #[test]
    fn test_estimate_slash_revenue_zero_rate() {
        let revenue = estimate_slash_revenue(10, 100_000_000, 0);
        assert_eq!(revenue, 0);
    }

    #[test]
    fn test_estimate_slash_revenue_one_non_revealer() {
        let revenue = estimate_slash_revenue(1, 200_000_000, 5000);
        assert_eq!(revenue, 100_000_000);
    }

    #[test]
    fn test_estimate_slash_revenue_100_percent_rate() {
        let revenue = estimate_slash_revenue(3, 100_000_000, 10_000);
        assert_eq!(revenue, 3 * 100_000_000);
    }

    // --- Priority Bid Strategy Edge Cases ---

    #[test]
    fn test_optimal_priority_equal_reserves() {
        // When reserves are equal and volume is small, bid should be minimal
        let bid = optimal_priority_bid(
            10 * PRECISION, 100 * PRECISION,
            1_000_000 * PRECISION, 1_000_000 * PRECISION, 30,
        );
        // Small order + small batch relative to reserves = tiny bid
        assert!(bid < 1_000_000); // Less than 0.01 CKB
    }

    #[test]
    fn test_optimal_priority_asymmetric_reserves() {
        // min(reserve0, reserve1) is used for impact calculation
        let bid_balanced = optimal_priority_bid(
            1_000 * PRECISION, 50_000 * PRECISION,
            1_000_000 * PRECISION, 1_000_000 * PRECISION, 30,
        );
        let bid_asymmetric = optimal_priority_bid(
            1_000 * PRECISION, 50_000 * PRECISION,
            100_000 * PRECISION, 1_000_000 * PRECISION, 30,
        );
        // With smaller min reserve, impact is higher, so bid should be higher
        assert!(bid_asymmetric >= bid_balanced);
    }

    // --- Error Type Coverage ---

    #[test]
    fn test_auction_error_clone_and_debug() {
        let e1 = AuctionError::WrongPhase { expected: 0, actual: 1 };
        let e2 = e1.clone();
        assert_eq!(e1, e2);
        let debug_str = format!("{:?}", e1);
        assert!(debug_str.contains("WrongPhase"));
    }

    #[test]
    fn test_all_error_variants_are_distinct() {
        let errors: Vec<AuctionError> = vec![
            AuctionError::WrongPhase { expected: 0, actual: 1 },
            AuctionError::CommitMismatch,
            AuctionError::RevealMismatch,
            AuctionError::BatchIdMismatch { commit: 1, auction: 2 },
            AuctionError::EmptyBatch,
            AuctionError::ClearingPriceFailed,
            AuctionError::ZeroAmount,
            AuctionError::InvalidOrderType(99),
            AuctionError::PhaseExpired,
            AuctionError::PhaseNotElapsed,
        ];
        // Each variant should be distinct from every other
        for i in 0..errors.len() {
            for j in (i + 1)..errors.len() {
                assert_ne!(errors[i], errors[j], "Error variants {} and {} should differ", i, j);
            }
        }
    }

    // --- Struct Coverage ---

    #[test]
    fn test_batch_simulation_clone_eq() {
        let sim = BatchSimulation {
            clearing_price: PRECISION,
            fillable_volume: 1000,
            buy_fills: 5,
            sell_fills: 3,
            total_buy_volume: 5000,
            total_sell_volume: 3000,
            pressure_ratio: PRECISION,
            price_impact_bps: 50,
        };
        let sim2 = sim.clone();
        assert_eq!(sim, sim2);
    }

    #[test]
    fn test_fill_estimate_clone_eq() {
        let est = FillEstimate {
            would_fill: true,
            estimated_output: 999,
            effective_price: PRECISION,
            queue_position: 2,
            priority_helpful: false,
        };
        let est2 = est.clone();
        assert_eq!(est, est2);
    }

    #[test]
    fn test_phase_info_clone_eq() {
        let info = PhaseInfo {
            phase: PHASE_COMMIT,
            blocks_remaining: 10,
            can_transition: false,
            next_phase: PHASE_REVEAL,
        };
        let info2 = info.clone();
        assert_eq!(info, info2);
    }

    #[test]
    fn test_slash_result_clone_eq() {
        let sr = SlashResult {
            slash_amount: 500,
            return_amount: 500,
            slash_rate_bps: 5000,
        };
        let sr2 = sr.clone();
        assert_eq!(sr, sr2);
    }

    #[test]
    fn test_default_slash_uses_correct_rate() {
        let result = calculate_default_slash(10_000);
        assert_eq!(result.slash_rate_bps, DEFAULT_SLASH_RATE_BPS);
        assert_eq!(result.slash_rate_bps, 5000);
    }
}
