// ============ Prediction Market Integration Tests ============
// Full lifecycle tests for the parimutuel prediction market system.
// Tests the interaction between market creation, betting, resolution,
// payout calculation, and settlement across all three settlement modes.

use vibeswap_sdk::prediction::*;
use vibeswap_sdk::{CellInput, Script, HashType};
use vibeswap_types::*;

// ============ Helpers ============

fn lock(seed: u8) -> Script {
    Script {
        code_hash: [seed; 32],
        hash_type: HashType::Type,
        args: vec![seed],
    }
}

fn input() -> CellInput {
    CellInput { tx_hash: [0; 32], index: 0, since: 0 }
}

fn create_params(num_tiers: u8, settlement_mode: u8) -> CreateMarketParams {
    CreateMarketParams {
        question_hash: [0xBB; 32],
        oracle_pair_id: [0xCC; 32],
        num_tiers,
        settlement_mode,
        resolution_block: 1000,
        dispute_window_blocks: DEFAULT_DISPUTE_WINDOW_BLOCKS,
        fee_rate_bps: DEFAULT_MARKET_FEE_BPS,
        creator_lock: lock(0xAA),
        creator_input: input(),
        current_block: 100,
    }
}

// ============ Full Lifecycle: Binary WTA ============

#[test]
fn test_lifecycle_binary_yes_wins() {
    let (mut market, _id) = create_market(&create_params(2, SETTLEMENT_WINNER_TAKES_ALL)).unwrap();

    // 3 bettors: 2 on YES (tier 0), 1 on NO (tier 1)
    let (m, p_alice) = place_bet(&market, 0, 10 * MINIMUM_BET_AMOUNT, [0x01; 32], 200).unwrap();
    market = m;
    let (m, p_bob) = place_bet(&market, 0, 5 * MINIMUM_BET_AMOUNT, [0x02; 32], 201).unwrap();
    market = m;
    let (m, p_charlie) = place_bet(&market, 1, 15 * MINIMUM_BET_AMOUNT, [0x03; 32], 202).unwrap();
    market = m;

    assert_eq!(market.total_liquidity, 30 * MINIMUM_BET_AMOUNT);

    // Resolve: YES wins (low oracle value → tier 0)
    let resolved = resolve_market(&market, PRECISION / 4, 1000).unwrap();
    assert_eq!(resolved.resolved_tier, 0);

    // Alice: 10/15 * 30 = 20
    let (g_alice, _, _) = calculate_payout(&resolved, &p_alice).unwrap();
    assert_eq!(g_alice, 20 * MINIMUM_BET_AMOUNT);

    // Bob: 5/15 * 30 = 10
    let (g_bob, _, _) = calculate_payout(&resolved, &p_bob).unwrap();
    assert_eq!(g_bob, 10 * MINIMUM_BET_AMOUNT);

    // Charlie: 0 (wrong tier)
    let (g_charlie, _, _) = calculate_payout(&resolved, &p_charlie).unwrap();
    assert_eq!(g_charlie, 0);

    // Settle
    let settled = settle_market(&resolved, resolved.dispute_end_block).unwrap();
    assert_eq!(settled.status, MARKET_SETTLED);
}

#[test]
fn test_lifecycle_binary_no_wins() {
    let (mut market, _) = create_market(&create_params(2, SETTLEMENT_WINNER_TAKES_ALL)).unwrap();

    let (m, p_yes) = place_bet(&market, 0, 20 * MINIMUM_BET_AMOUNT, [0x01; 32], 200).unwrap();
    market = m;
    let (m, p_no) = place_bet(&market, 1, 10 * MINIMUM_BET_AMOUNT, [0x02; 32], 201).unwrap();
    market = m;

    // Resolve: NO wins (high oracle value → tier 1)
    let resolved = resolve_market(&market, PRECISION * 80 / 100, 1000).unwrap();
    assert_eq!(resolved.resolved_tier, 1);

    let (g_yes, _, _) = calculate_payout(&resolved, &p_yes).unwrap();
    let (g_no, _, _) = calculate_payout(&resolved, &p_no).unwrap();

    assert_eq!(g_yes, 0);
    assert_eq!(g_no, 30 * MINIMUM_BET_AMOUNT); // Winner takes all
}

// ============ Full Lifecycle: Multi-Tier Proportional ============

#[test]
fn test_lifecycle_4tier_proportional() {
    let (mut market, _) = create_market(&create_params(4, SETTLEMENT_PROPORTIONAL)).unwrap();

    // Equal bets on all 4 tiers
    let bet = 10 * MINIMUM_BET_AMOUNT;
    let (m, p0) = place_bet(&market, 0, bet, [0x01; 32], 200).unwrap(); market = m;
    let (m, p1) = place_bet(&market, 1, bet, [0x02; 32], 201).unwrap(); market = m;
    let (m, p2) = place_bet(&market, 2, bet, [0x03; 32], 202).unwrap(); market = m;
    let (m, p3) = place_bet(&market, 3, bet, [0x04; 32], 203).unwrap(); market = m;

    let total = 40 * MINIMUM_BET_AMOUNT;
    assert_eq!(market.total_liquidity, total);

    // Resolve: tier 2 wins
    let resolved = resolve_market(&market, PRECISION * 60 / 100, 1000).unwrap();
    assert_eq!(resolved.resolved_tier, 2);

    let (g0, _, _) = calculate_payout(&resolved, &p0).unwrap();
    let (g1, _, _) = calculate_payout(&resolved, &p1).unwrap();
    let (g2, _, _) = calculate_payout(&resolved, &p2).unwrap();
    let (g3, _, _) = calculate_payout(&resolved, &p3).unwrap();

    // Tier 2 = winner (70% of pool), tiers 1 and 3 = adjacent (15% each), tier 0 = nothing
    assert_eq!(g0, 0);
    assert!(g1 > 0);
    assert!(g2 > g1);
    assert!(g2 > g3);
    assert!(g1 == g3); // Symmetric adjacents with equal pools
}

// ============ Full Lifecycle: Multi-Tier Scalar ============

#[test]
fn test_lifecycle_5tier_scalar() {
    let (mut market, _) = create_market(&create_params(5, SETTLEMENT_SCALAR)).unwrap();

    let bet = 10 * MINIMUM_BET_AMOUNT;
    let (m, p0) = place_bet(&market, 0, bet, [0x01; 32], 200).unwrap(); market = m;
    let (m, p1) = place_bet(&market, 1, bet, [0x02; 32], 201).unwrap(); market = m;
    let (m, p2) = place_bet(&market, 2, bet, [0x03; 32], 202).unwrap(); market = m;
    let (m, p3) = place_bet(&market, 3, bet, [0x04; 32], 203).unwrap(); market = m;
    let (m, p4) = place_bet(&market, 4, bet, [0x05; 32], 204).unwrap(); market = m;

    // Resolve: tier 2 (middle) wins
    let resolved = resolve_market(&market, PRECISION * 45 / 100, 1000).unwrap();
    assert_eq!(resolved.resolved_tier, 2);

    let (g0, _, _) = calculate_payout(&resolved, &p0).unwrap();
    let (g1, _, _) = calculate_payout(&resolved, &p1).unwrap();
    let (g2, _, _) = calculate_payout(&resolved, &p2).unwrap();
    let (g3, _, _) = calculate_payout(&resolved, &p3).unwrap();
    let (g4, _, _) = calculate_payout(&resolved, &p4).unwrap();

    // Scalar: distance determines weight. All should get something.
    assert!(g2 > g1); // distance 0 > distance 1
    assert!(g1 > g0); // distance 1 > distance 2
    assert!(g1 == g3); // symmetric distances
    assert!(g0 == g4); // symmetric distances
    assert!(g0 > 0);   // even the farthest tier gets something
}

// ============ Conservation of Liquidity ============

#[test]
fn test_conservation_wta() {
    let (mut market, _) = create_market(&create_params(3, SETTLEMENT_WINNER_TAKES_ALL)).unwrap();

    let (m, p0) = place_bet(&market, 0, 7 * MINIMUM_BET_AMOUNT, [0x01; 32], 200).unwrap(); market = m;
    let (m, p1) = place_bet(&market, 1, 3 * MINIMUM_BET_AMOUNT, [0x02; 32], 201).unwrap(); market = m;
    let (m, p2) = place_bet(&market, 2, 5 * MINIMUM_BET_AMOUNT, [0x03; 32], 202).unwrap(); market = m;

    let resolved = resolve_market(&market, PRECISION / 6, 1000).unwrap(); // tier 0 wins

    let (g0, _, _) = calculate_payout(&resolved, &p0).unwrap();
    let (g1, _, _) = calculate_payout(&resolved, &p1).unwrap();
    let (g2, _, _) = calculate_payout(&resolved, &p2).unwrap();

    // In WTA, winning tier gets everything, losers get 0
    assert_eq!(g0, market.total_liquidity);
    assert_eq!(g1, 0);
    assert_eq!(g2, 0);
}

#[test]
fn test_conservation_scalar() {
    let (mut market, _) = create_market(&create_params(4, SETTLEMENT_SCALAR)).unwrap();

    let bet = 10 * MINIMUM_BET_AMOUNT;
    let (m, p0) = place_bet(&market, 0, bet, [0x01; 32], 200).unwrap(); market = m;
    let (m, p1) = place_bet(&market, 1, bet, [0x02; 32], 201).unwrap(); market = m;
    let (m, p2) = place_bet(&market, 2, bet, [0x03; 32], 202).unwrap(); market = m;
    let (m, p3) = place_bet(&market, 3, bet, [0x04; 32], 203).unwrap(); market = m;

    let resolved = resolve_market(&market, PRECISION * 30 / 100, 1000).unwrap();

    let (g0, _, _) = calculate_payout(&resolved, &p0).unwrap();
    let (g1, _, _) = calculate_payout(&resolved, &p1).unwrap();
    let (g2, _, _) = calculate_payout(&resolved, &p2).unwrap();
    let (g3, _, _) = calculate_payout(&resolved, &p3).unwrap();

    let total_out = g0 + g1 + g2 + g3;
    // Rounding tolerance: total payout should be close to total liquidity
    assert!(total_out <= market.total_liquidity + 4, "Paid more than pool: {} > {}", total_out, market.total_liquidity);
    // Should pay at least 99% of pool (integer rounding)
    assert!(total_out >= market.total_liquidity * 99 / 100, "Paid too little: {} < 99% of {}", total_out, market.total_liquidity);
}

// ============ Fee Verification ============

#[test]
fn test_fees_are_correct() {
    let (mut market, _) = create_market(&create_params(2, SETTLEMENT_WINNER_TAKES_ALL)).unwrap();

    let (m, pos) = place_bet(&market, 0, 100 * MINIMUM_BET_AMOUNT, [0x01; 32], 200).unwrap(); market = m;
    let (m, _) = place_bet(&market, 1, 100 * MINIMUM_BET_AMOUNT, [0x02; 32], 201).unwrap(); market = m;

    let resolved = resolve_market(&market, PRECISION / 4, 1000).unwrap();
    let (gross, fee, net) = calculate_payout(&resolved, &pos).unwrap();

    // Fee = 1% of gross
    let expected_fee = gross * DEFAULT_MARKET_FEE_BPS as u128 / BPS_DENOMINATOR;
    assert_eq!(fee, expected_fee);
    assert_eq!(net, gross - fee);
    assert!(fee > 0);
}

// ============ Market Analytics ============

#[test]
fn test_odds_sum_to_100_percent() {
    let (mut market, _) = create_market(&create_params(4, SETTLEMENT_WINNER_TAKES_ALL)).unwrap();

    let (m, _) = place_bet(&market, 0, 5 * MINIMUM_BET_AMOUNT, [0x01; 32], 200).unwrap(); market = m;
    let (m, _) = place_bet(&market, 1, 15 * MINIMUM_BET_AMOUNT, [0x02; 32], 201).unwrap(); market = m;
    let (m, _) = place_bet(&market, 2, 10 * MINIMUM_BET_AMOUNT, [0x03; 32], 202).unwrap(); market = m;
    let (m, _) = place_bet(&market, 3, 20 * MINIMUM_BET_AMOUNT, [0x04; 32], 203).unwrap(); market = m;

    let odds: u128 = (0..4).map(|i| implied_odds_bps(&market, i)).sum();
    assert_eq!(odds, BPS_DENOMINATOR);
}

#[test]
fn test_multiplier_inverse_of_odds() {
    let (mut market, _) = create_market(&create_params(2, SETTLEMENT_WINNER_TAKES_ALL)).unwrap();

    let (m, _) = place_bet(&market, 0, 25 * MINIMUM_BET_AMOUNT, [0x01; 32], 200).unwrap(); market = m;
    let (m, _) = place_bet(&market, 1, 75 * MINIMUM_BET_AMOUNT, [0x02; 32], 201).unwrap(); market = m;

    // Tier 0: 25% odds → 4x multiplier
    let mult = potential_multiplier(&market, 0);
    assert_eq!(mult, 4 * PRECISION);
}

// ============ Edge Cases ============

#[test]
fn test_single_bettor_single_tier() {
    let (mut market, _) = create_market(&create_params(2, SETTLEMENT_WINNER_TAKES_ALL)).unwrap();

    let (m, pos) = place_bet(&market, 0, 50 * MINIMUM_BET_AMOUNT, [0x01; 32], 200).unwrap(); market = m;

    // Only bets on tier 0, tier 0 wins
    let resolved = resolve_market(&market, PRECISION / 4, 1000).unwrap();
    let (gross, fee, net) = calculate_payout(&resolved, &pos).unwrap();

    // Gets their own money back minus fee
    assert_eq!(gross, 50 * MINIMUM_BET_AMOUNT);
    assert!(net < gross);
}

#[test]
fn test_max_tiers_8() {
    let (mut market, _) = create_market(&create_params(8, SETTLEMENT_SCALAR)).unwrap();

    let bet = MINIMUM_BET_AMOUNT;
    for i in 0..8u8 {
        let (m, _) = place_bet(&market, i, bet, [i + 1; 32], 200 + i as u64).unwrap();
        market = m;
    }
    assert_eq!(market.total_liquidity, 8 * bet);
    assert_eq!(market.num_tiers, 8);

    // Resolve to middle
    let resolved = resolve_market(&market, PRECISION / 2, 1000).unwrap();
    assert!(resolved.resolved_tier == 3 || resolved.resolved_tier == 4);
}

#[test]
fn test_oracle_value_at_tier_boundary() {
    // Test exact boundary between tiers
    let bucket = PRECISION / 4; // 4 tiers, each bucket = PRECISION/4

    assert_eq!(value_to_tier(0, 4), 0);
    assert_eq!(value_to_tier(bucket - 1, 4), 0);
    assert_eq!(value_to_tier(bucket, 4), 1);
    assert_eq!(value_to_tier(2 * bucket, 4), 2);
    assert_eq!(value_to_tier(3 * bucket, 4), 3);
    assert_eq!(value_to_tier(4 * bucket, 4), 3); // clamped
}

#[test]
fn test_oracle_value_zero() {
    assert_eq!(value_to_tier(0, 2), 0);
    assert_eq!(value_to_tier(0, 8), 0);
}

#[test]
fn test_oracle_value_max() {
    assert_eq!(value_to_tier(u128::MAX, 2), 1);
    assert_eq!(value_to_tier(u128::MAX, 8), 7);
}

// ============ Dispute Window ============

#[test]
fn test_dispute_window_prevents_early_settlement() {
    let (mut market, _) = create_market(&create_params(2, SETTLEMENT_WINNER_TAKES_ALL)).unwrap();
    let (m, _) = place_bet(&market, 0, MINIMUM_BET_AMOUNT, [0x01; 32], 200).unwrap(); market = m;

    let resolved = resolve_market(&market, PRECISION / 4, 1000).unwrap();
    assert_eq!(resolved.dispute_end_block, 1000 + DEFAULT_DISPUTE_WINDOW_BLOCKS);

    // Cannot settle during dispute window
    assert!(settle_market(&resolved, 1000).is_err());
    assert!(settle_market(&resolved, resolved.dispute_end_block - 1).is_err());

    // Can settle after
    assert!(settle_market(&resolved, resolved.dispute_end_block).is_ok());
}

// ============ Cancellation ============

#[test]
fn test_cancel_and_recreate() {
    let params = create_params(2, SETTLEMENT_WINNER_TAKES_ALL);
    let (market, id1) = create_market(&params).unwrap();

    let lock_hash = market.creator_lock_hash;
    let cancelled = cancel_market(&market, &lock_hash).unwrap();
    assert_eq!(cancelled.status, MARKET_CANCELLED);

    // Can create another market (different block → different ID)
    let mut params2 = create_params(2, SETTLEMENT_WINNER_TAKES_ALL);
    params2.current_block = 101;
    let (market2, id2) = create_market(&params2).unwrap();
    assert_ne!(id1, id2);
    assert_eq!(market2.status, MARKET_ACTIVE);
}
