// ============ Oracle Price Feed Integration ============
// Bridges oracle cells to lending/insurance operations on CKB.
// Oracle cells are included as cell_deps (read-only references) in transactions,
// providing on-chain verifiable price data for all price-sensitive operations.

use vibeswap_types::OracleCellData;
use vibeswap_math::PRECISION;
use crate::{CellDep, CellInput, DepType, SDKError};

// ============ Constants ============

/// Maximum staleness before an oracle price is rejected (100 blocks ≈ 10 minutes)
pub const MAX_STALENESS_BLOCKS: u64 = 100;

/// Minimum confidence score accepted for lending operations (0-100)
pub const MIN_CONFIDENCE_LENDING: u8 = 50;

/// Minimum confidence score for liquidation operations (lower bar — liquidation is urgent)
pub const MIN_CONFIDENCE_LIQUIDATION: u8 = 25;

/// Maximum deviation between oracle sources before rejecting (10%)
pub const MAX_ORACLE_DEVIATION_BPS: u64 = 1000;

// ============ Oracle Price Feed ============

/// A validated oracle price with its on-chain cell reference
#[derive(Clone, Debug)]
pub struct OraclePrice {
    /// The oracle cell data
    pub data: OracleCellData,
    /// The outpoint of the oracle cell (for inclusion as cell_dep)
    pub cell_dep: CellDep,
}

/// A pair of validated prices for lending operations (collateral + debt)
#[derive(Clone, Debug)]
pub struct PricePair {
    pub collateral: OraclePrice,
    pub debt: OraclePrice,
}

// ============ Validation ============

/// Validate that an oracle price is fresh enough for use
///
/// Returns Ok(()) if the oracle data is within MAX_STALENESS_BLOCKS of current_block,
/// or Err(SDKError::StaleOracleData) if too old.
pub fn validate_freshness(
    oracle: &OracleCellData,
    current_block: u64,
) -> Result<(), SDKError> {
    if current_block > oracle.block_number
        && (current_block - oracle.block_number) > MAX_STALENESS_BLOCKS
    {
        return Err(SDKError::StaleOracleData);
    }
    Ok(())
}

/// Validate that an oracle has sufficient confidence for lending
pub fn validate_confidence_lending(oracle: &OracleCellData) -> Result<(), SDKError> {
    if oracle.confidence < MIN_CONFIDENCE_LENDING {
        return Err(SDKError::LowOracleConfidence);
    }
    Ok(())
}

/// Validate that an oracle has sufficient confidence for liquidation (lower threshold)
pub fn validate_confidence_liquidation(oracle: &OracleCellData) -> Result<(), SDKError> {
    if oracle.confidence < MIN_CONFIDENCE_LIQUIDATION {
        return Err(SDKError::LowOracleConfidence);
    }
    Ok(())
}

/// Validate that an oracle pair_id matches the expected pair
pub fn validate_pair_id(
    oracle: &OracleCellData,
    expected_pair_id: &[u8; 32],
) -> Result<(), SDKError> {
    if oracle.pair_id != *expected_pair_id {
        return Err(SDKError::OraclePairMismatch);
    }
    Ok(())
}

/// Full validation for a lending-grade oracle price
pub fn validate_for_lending(
    oracle: &OracleCellData,
    expected_pair_id: &[u8; 32],
    current_block: u64,
) -> Result<(), SDKError> {
    if oracle.price == 0 {
        return Err(SDKError::InvalidAmounts);
    }
    validate_freshness(oracle, current_block)?;
    validate_confidence_lending(oracle)?;
    validate_pair_id(oracle, expected_pair_id)?;
    Ok(())
}

/// Full validation for a liquidation-grade oracle price (lower confidence bar)
pub fn validate_for_liquidation(
    oracle: &OracleCellData,
    expected_pair_id: &[u8; 32],
    current_block: u64,
) -> Result<(), SDKError> {
    if oracle.price == 0 {
        return Err(SDKError::InvalidAmounts);
    }
    validate_freshness(oracle, current_block)?;
    validate_confidence_liquidation(oracle)?;
    validate_pair_id(oracle, expected_pair_id)?;
    Ok(())
}

// ============ Multi-Oracle Aggregation ============

/// Aggregate multiple oracle prices using median for manipulation resistance.
///
/// Requires at least 1 oracle. With 1, returns it directly. With 2+, returns
/// the median. All oracles must have the same pair_id and pass freshness checks.
///
/// Returns the median price (u128, 1e18 scaled).
pub fn aggregate_prices(
    oracles: &[OracleCellData],
    expected_pair_id: &[u8; 32],
    current_block: u64,
) -> Result<u128, SDKError> {
    if oracles.is_empty() {
        return Err(SDKError::InvalidAmounts);
    }

    // Validate all oracles
    for oracle in oracles {
        validate_freshness(oracle, current_block)?;
        validate_pair_id(oracle, expected_pair_id)?;
        if oracle.price == 0 {
            return Err(SDKError::InvalidAmounts);
        }
    }

    // Single oracle — return directly
    if oracles.len() == 1 {
        return Ok(oracles[0].price);
    }

    // Collect and sort prices
    let mut prices: Vec<u128> = oracles.iter().map(|o| o.price).collect();
    prices.sort();

    // Check deviation: max price vs min price must be within MAX_ORACLE_DEVIATION_BPS
    let min_price = prices[0];
    let max_price = prices[prices.len() - 1];
    let deviation_bps = if min_price > 0 {
        ((max_price - min_price) * 10_000) / min_price
    } else {
        return Err(SDKError::InvalidAmounts);
    };
    if deviation_bps > MAX_ORACLE_DEVIATION_BPS as u128 {
        return Err(SDKError::OracleDeviationTooHigh);
    }

    // Return median
    let mid = prices.len() / 2;
    if prices.len() % 2 == 0 {
        // Even count: average of two middle values
        Ok((prices[mid - 1] + prices[mid]) / 2)
    } else {
        Ok(prices[mid])
    }
}

/// Confidence-weighted average price across multiple oracles.
///
/// Higher-confidence oracles contribute more to the final price.
/// All oracles must pass basic validation.
pub fn weighted_price(
    oracles: &[OracleCellData],
    expected_pair_id: &[u8; 32],
    current_block: u64,
) -> Result<u128, SDKError> {
    if oracles.is_empty() {
        return Err(SDKError::InvalidAmounts);
    }

    for oracle in oracles {
        validate_freshness(oracle, current_block)?;
        validate_pair_id(oracle, expected_pair_id)?;
        if oracle.price == 0 {
            return Err(SDKError::InvalidAmounts);
        }
    }

    if oracles.len() == 1 {
        return Ok(oracles[0].price);
    }

    let total_weight: u128 = oracles.iter().map(|o| o.confidence as u128).sum();
    if total_weight == 0 {
        return Err(SDKError::LowOracleConfidence);
    }

    let weighted_sum: u128 = oracles
        .iter()
        .map(|o| {
            vibeswap_math::mul_div(o.price, o.confidence as u128, total_weight)
        })
        .sum();

    Ok(weighted_sum)
}

// ============ Oracle Cell Dep Builder ============

/// Build a CellDep for including an oracle cell as a read-only reference in a transaction.
///
/// In CKB's UTXO model, oracle cells are not consumed — they're referenced as
/// cell_deps so type scripts can verify the price data is from an authorized oracle.
pub fn build_oracle_cell_dep(oracle_tx_hash: [u8; 32], oracle_index: u32) -> CellDep {
    CellDep {
        tx_hash: oracle_tx_hash,
        index: oracle_index,
        dep_type: DepType::Code,
    }
}

/// Build cell deps for a price pair (two oracle cells)
pub fn build_price_pair_deps(pair: &PricePair) -> Vec<CellDep> {
    vec![pair.collateral.cell_dep.clone(), pair.debt.cell_dep.clone()]
}

// ============ Price Extraction Helpers ============

/// Extract the collateral and debt prices from a validated PricePair
pub fn extract_prices(pair: &PricePair) -> (u128, u128) {
    (pair.collateral.data.price, pair.debt.data.price)
}

/// Calculate the exchange rate between two oracle-sourced prices.
/// Returns collateral_price / debt_price scaled by PRECISION.
pub fn exchange_rate(collateral_price: u128, debt_price: u128) -> Result<u128, SDKError> {
    if debt_price == 0 {
        return Err(SDKError::InvalidAmounts);
    }
    Ok(vibeswap_math::mul_div(collateral_price, PRECISION, debt_price))
}

/// Check if a price has moved more than a threshold since last known price.
/// Useful for triggering keeper actions on large price movements.
///
/// Returns the absolute percentage change in basis points.
pub fn price_change_bps(old_price: u128, new_price: u128) -> u64 {
    if old_price == 0 {
        return 10_000; // 100% change from zero
    }
    let diff = if new_price > old_price {
        new_price - old_price
    } else {
        old_price - new_price
    };
    // diff * 10000 / old_price — capped at u64::MAX
    let bps = (diff * 10_000) / old_price;
    bps.min(u64::MAX as u128) as u64
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    fn test_pair_id() -> [u8; 32] {
        let mut id = [0u8; 32];
        id[0..4].copy_from_slice(b"ETH\0");
        id
    }

    fn test_source_hash() -> [u8; 32] {
        [0xAA; 32]
    }

    fn fresh_oracle(price: u128, block: u64) -> OracleCellData {
        OracleCellData {
            price,
            block_number: block,
            confidence: 80,
            source_hash: test_source_hash(),
            pair_id: test_pair_id(),
        }
    }

    fn oracle_with_confidence(price: u128, block: u64, confidence: u8) -> OracleCellData {
        OracleCellData {
            price,
            block_number: block,
            confidence,
            source_hash: test_source_hash(),
            pair_id: test_pair_id(),
        }
    }

    // ============ Freshness Tests ============

    #[test]
    fn test_freshness_ok() {
        let oracle = fresh_oracle(1000 * PRECISION, 100);
        assert!(validate_freshness(&oracle, 150).is_ok()); // 50 blocks ago
    }

    #[test]
    fn test_freshness_exact_boundary() {
        let oracle = fresh_oracle(1000 * PRECISION, 100);
        assert!(validate_freshness(&oracle, 200).is_ok()); // Exactly 100 blocks
    }

    #[test]
    fn test_freshness_stale() {
        let oracle = fresh_oracle(1000 * PRECISION, 100);
        let result = validate_freshness(&oracle, 201); // 101 blocks ago
        assert!(matches!(result, Err(SDKError::StaleOracleData)));
    }

    #[test]
    fn test_freshness_same_block() {
        let oracle = fresh_oracle(1000 * PRECISION, 100);
        assert!(validate_freshness(&oracle, 100).is_ok());
    }

    #[test]
    fn test_freshness_future_block() {
        // Oracle from a later block than current — shouldn't happen but not stale
        let oracle = fresh_oracle(1000 * PRECISION, 200);
        assert!(validate_freshness(&oracle, 100).is_ok());
    }

    // ============ Confidence Tests ============

    #[test]
    fn test_confidence_lending_ok() {
        let oracle = oracle_with_confidence(1000 * PRECISION, 100, 80);
        assert!(validate_confidence_lending(&oracle).is_ok());
    }

    #[test]
    fn test_confidence_lending_at_boundary() {
        let oracle = oracle_with_confidence(1000 * PRECISION, 100, 50);
        assert!(validate_confidence_lending(&oracle).is_ok());
    }

    #[test]
    fn test_confidence_lending_too_low() {
        let oracle = oracle_with_confidence(1000 * PRECISION, 100, 49);
        assert!(matches!(
            validate_confidence_lending(&oracle),
            Err(SDKError::LowOracleConfidence)
        ));
    }

    #[test]
    fn test_confidence_liquidation_lower_bar() {
        // Liquidation accepts confidence=25, lending would reject it
        let oracle = oracle_with_confidence(1000 * PRECISION, 100, 30);
        assert!(validate_confidence_liquidation(&oracle).is_ok());
        assert!(validate_confidence_lending(&oracle).is_err());
    }

    #[test]
    fn test_confidence_liquidation_too_low() {
        let oracle = oracle_with_confidence(1000 * PRECISION, 100, 24);
        assert!(matches!(
            validate_confidence_liquidation(&oracle),
            Err(SDKError::LowOracleConfidence)
        ));
    }

    // ============ Pair ID Tests ============

    #[test]
    fn test_pair_id_match() {
        let oracle = fresh_oracle(1000 * PRECISION, 100);
        assert!(validate_pair_id(&oracle, &test_pair_id()).is_ok());
    }

    #[test]
    fn test_pair_id_mismatch() {
        let oracle = fresh_oracle(1000 * PRECISION, 100);
        let wrong_pair = [0xFF; 32];
        assert!(matches!(
            validate_pair_id(&oracle, &wrong_pair),
            Err(SDKError::OraclePairMismatch)
        ));
    }

    // ============ Full Validation Tests ============

    #[test]
    fn test_validate_for_lending_all_good() {
        let oracle = fresh_oracle(2000 * PRECISION, 100);
        assert!(validate_for_lending(&oracle, &test_pair_id(), 150).is_ok());
    }

    #[test]
    fn test_validate_for_lending_zero_price() {
        let oracle = fresh_oracle(0, 100);
        assert!(validate_for_lending(&oracle, &test_pair_id(), 150).is_err());
    }

    #[test]
    fn test_validate_for_lending_stale() {
        let oracle = fresh_oracle(2000 * PRECISION, 100);
        assert!(validate_for_lending(&oracle, &test_pair_id(), 250).is_err());
    }

    #[test]
    fn test_validate_for_lending_low_confidence() {
        let oracle = oracle_with_confidence(2000 * PRECISION, 100, 30);
        assert!(validate_for_lending(&oracle, &test_pair_id(), 150).is_err());
    }

    #[test]
    fn test_validate_for_liquidation_accepts_lower_confidence() {
        let oracle = oracle_with_confidence(2000 * PRECISION, 100, 30);
        // Lending rejects at confidence=30, liquidation accepts
        assert!(validate_for_lending(&oracle, &test_pair_id(), 150).is_err());
        assert!(validate_for_liquidation(&oracle, &test_pair_id(), 150).is_ok());
    }

    // ============ Aggregation Tests ============

    #[test]
    fn test_aggregate_single_oracle() {
        let oracles = vec![fresh_oracle(3000 * PRECISION, 100)];
        let price = aggregate_prices(&oracles, &test_pair_id(), 150).unwrap();
        assert_eq!(price, 3000 * PRECISION);
    }

    #[test]
    fn test_aggregate_two_oracles_median() {
        let oracles = vec![
            fresh_oracle(3000 * PRECISION, 100),
            fresh_oracle(3100 * PRECISION, 101),
        ];
        let price = aggregate_prices(&oracles, &test_pair_id(), 150).unwrap();
        // Even count: average of two = (3000 + 3100) / 2 = 3050
        assert_eq!(price, 3050 * PRECISION);
    }

    #[test]
    fn test_aggregate_three_oracles_median() {
        let oracles = vec![
            fresh_oracle(3100 * PRECISION, 100),
            fresh_oracle(2900 * PRECISION, 101),
            fresh_oracle(3000 * PRECISION, 102),
        ];
        let price = aggregate_prices(&oracles, &test_pair_id(), 150).unwrap();
        // Sorted: 2900, 3000, 3100 → median = 3000
        assert_eq!(price, 3000 * PRECISION);
    }

    #[test]
    fn test_aggregate_rejects_high_deviation() {
        let oracles = vec![
            fresh_oracle(1000 * PRECISION, 100),
            fresh_oracle(1200 * PRECISION, 101), // 20% deviation > 10% max
        ];
        let result = aggregate_prices(&oracles, &test_pair_id(), 150);
        assert!(matches!(result, Err(SDKError::OracleDeviationTooHigh)));
    }

    #[test]
    fn test_aggregate_within_deviation() {
        let oracles = vec![
            fresh_oracle(1000 * PRECISION, 100),
            fresh_oracle(1099 * PRECISION, 101), // 9.9% deviation < 10% max
        ];
        let price = aggregate_prices(&oracles, &test_pair_id(), 150).unwrap();
        assert_eq!(price, (1000 * PRECISION + 1099 * PRECISION) / 2);
    }

    #[test]
    fn test_aggregate_empty_rejected() {
        let result = aggregate_prices(&[], &test_pair_id(), 150);
        assert!(result.is_err());
    }

    #[test]
    fn test_aggregate_stale_oracle_rejected() {
        let oracles = vec![
            fresh_oracle(3000 * PRECISION, 100),
            fresh_oracle(3000 * PRECISION, 10), // Stale
        ];
        let result = aggregate_prices(&oracles, &test_pair_id(), 150);
        assert!(matches!(result, Err(SDKError::StaleOracleData)));
    }

    // ============ Weighted Price Tests ============

    #[test]
    fn test_weighted_single_oracle() {
        let oracles = vec![fresh_oracle(5000 * PRECISION, 100)];
        let price = weighted_price(&oracles, &test_pair_id(), 150).unwrap();
        assert_eq!(price, 5000 * PRECISION);
    }

    #[test]
    fn test_weighted_equal_confidence() {
        let oracles = vec![
            oracle_with_confidence(3000 * PRECISION, 100, 80),
            oracle_with_confidence(3100 * PRECISION, 101, 80),
        ];
        let price = weighted_price(&oracles, &test_pair_id(), 150).unwrap();
        // Equal weights → average
        // 3000 * 80/160 + 3100 * 80/160 = 1500 + 1550 = 3050
        assert_eq!(price, 3050 * PRECISION);
    }

    #[test]
    fn test_weighted_skewed_confidence() {
        let oracles = vec![
            oracle_with_confidence(3000 * PRECISION, 100, 90),
            oracle_with_confidence(4000 * PRECISION, 101, 10),
        ];
        let price = weighted_price(&oracles, &test_pair_id(), 150).unwrap();
        // 3000 * 90/100 + 4000 * 10/100 = 2700 + 400 = 3100
        assert_eq!(price, 3100 * PRECISION);
    }

    #[test]
    fn test_weighted_zero_confidence_all() {
        let oracles = vec![
            oracle_with_confidence(3000 * PRECISION, 100, 0),
            oracle_with_confidence(4000 * PRECISION, 101, 0),
        ];
        let result = weighted_price(&oracles, &test_pair_id(), 150);
        assert!(matches!(result, Err(SDKError::LowOracleConfidence)));
    }

    // ============ Cell Dep Builder Tests ============

    #[test]
    fn test_build_oracle_cell_dep() {
        let dep = build_oracle_cell_dep([0xAB; 32], 3);
        assert_eq!(dep.tx_hash, [0xAB; 32]);
        assert_eq!(dep.index, 3);
        assert!(matches!(dep.dep_type, DepType::Code));
    }

    #[test]
    fn test_build_price_pair_deps() {
        let pair = PricePair {
            collateral: OraclePrice {
                data: fresh_oracle(3000 * PRECISION, 100),
                cell_dep: build_oracle_cell_dep([0x01; 32], 0),
            },
            debt: OraclePrice {
                data: fresh_oracle(1 * PRECISION, 100),
                cell_dep: build_oracle_cell_dep([0x02; 32], 1),
            },
        };
        let deps = build_price_pair_deps(&pair);
        assert_eq!(deps.len(), 2);
        assert_eq!(deps[0].tx_hash, [0x01; 32]);
        assert_eq!(deps[1].tx_hash, [0x02; 32]);
    }

    // ============ Exchange Rate Tests ============

    #[test]
    fn test_exchange_rate_equal_prices() {
        let rate = exchange_rate(1000 * PRECISION, 1000 * PRECISION).unwrap();
        assert_eq!(rate, PRECISION); // 1:1
    }

    #[test]
    fn test_exchange_rate_eth_to_usdc() {
        // ETH = 3000, USDC = 1
        let rate = exchange_rate(3000 * PRECISION, 1 * PRECISION).unwrap();
        assert_eq!(rate, 3000 * PRECISION);
    }

    #[test]
    fn test_exchange_rate_zero_debt_price() {
        let result = exchange_rate(3000 * PRECISION, 0);
        assert!(result.is_err());
    }

    // ============ Price Change Tests ============

    #[test]
    fn test_price_change_bps_no_change() {
        assert_eq!(price_change_bps(100 * PRECISION, 100 * PRECISION), 0);
    }

    #[test]
    fn test_price_change_bps_increase() {
        // 10% increase = 1000 bps
        assert_eq!(price_change_bps(100 * PRECISION, 110 * PRECISION), 1000);
    }

    #[test]
    fn test_price_change_bps_decrease() {
        // 5% decrease = 500 bps
        assert_eq!(price_change_bps(100 * PRECISION, 95 * PRECISION), 500);
    }

    #[test]
    fn test_price_change_bps_from_zero() {
        assert_eq!(price_change_bps(0, 100 * PRECISION), 10_000);
    }

    #[test]
    fn test_price_change_bps_50_percent_crash() {
        assert_eq!(price_change_bps(200 * PRECISION, 100 * PRECISION), 5000);
    }

    // ============ Extract Prices Test ============

    #[test]
    fn test_extract_prices() {
        let pair = PricePair {
            collateral: OraclePrice {
                data: fresh_oracle(3000 * PRECISION, 100),
                cell_dep: build_oracle_cell_dep([0x01; 32], 0),
            },
            debt: OraclePrice {
                data: fresh_oracle(1 * PRECISION, 100),
                cell_dep: build_oracle_cell_dep([0x02; 32], 1),
            },
        };
        let (col, debt) = extract_prices(&pair);
        assert_eq!(col, 3000 * PRECISION);
        assert_eq!(debt, 1 * PRECISION);
    }

    // ============ Integration: Oracle → Keeper Flow ============

    #[test]
    fn test_oracle_to_keeper_price_flow() {
        // Simulate: 3 oracle sources for ETH, aggregate, use for vault assessment
        let oracles = vec![
            oracle_with_confidence(2995 * PRECISION, 100, 90),
            oracle_with_confidence(3000 * PRECISION, 101, 85),
            oracle_with_confidence(3005 * PRECISION, 102, 80),
        ];
        let pair_id = test_pair_id();

        // Aggregate returns median (3000)
        let eth_price = aggregate_prices(&oracles, &pair_id, 150).unwrap();
        assert_eq!(eth_price, 3000 * PRECISION);

        // Check deviation is small
        let change = price_change_bps(3000 * PRECISION, eth_price);
        assert_eq!(change, 0);

        // Weighted price should lean toward higher-confidence sources
        let weighted = weighted_price(&oracles, &pair_id, 150).unwrap();
        // 2995*90/255 + 3000*85/255 + 3005*80/255
        // = (269550 + 255000 + 240400) / 255 * PRECISION
        // ≈ 2999.8 * PRECISION (leans toward 2995 due to highest confidence)
        assert!(weighted < 3000 * PRECISION);
        assert!(weighted > 2995 * PRECISION);
    }

    // ============ Additional Edge Case & Coverage Tests ============

    #[test]
    fn test_freshness_one_past_boundary() {
        // Exactly MAX_STALENESS_BLOCKS + 1 blocks ago = stale
        let oracle = fresh_oracle(1000 * PRECISION, 100);
        let result = validate_freshness(&oracle, 100 + MAX_STALENESS_BLOCKS + 1);
        assert!(matches!(result, Err(SDKError::StaleOracleData)));
    }

    #[test]
    fn test_freshness_current_block_zero() {
        // current_block = 0 and oracle block = 0 => not stale
        let oracle = fresh_oracle(1000 * PRECISION, 0);
        assert!(validate_freshness(&oracle, 0).is_ok());
    }

    #[test]
    fn test_confidence_lending_zero() {
        let oracle = oracle_with_confidence(1000 * PRECISION, 100, 0);
        assert!(matches!(
            validate_confidence_lending(&oracle),
            Err(SDKError::LowOracleConfidence)
        ));
    }

    #[test]
    fn test_confidence_liquidation_exactly_at_boundary() {
        // Exactly MIN_CONFIDENCE_LIQUIDATION = 25
        let oracle = oracle_with_confidence(1000 * PRECISION, 100, 25);
        assert!(validate_confidence_liquidation(&oracle).is_ok());
    }

    #[test]
    fn test_confidence_liquidation_zero() {
        let oracle = oracle_with_confidence(1000 * PRECISION, 100, 0);
        assert!(matches!(
            validate_confidence_liquidation(&oracle),
            Err(SDKError::LowOracleConfidence)
        ));
    }

    #[test]
    fn test_validate_for_lending_wrong_pair_id() {
        let oracle = fresh_oracle(2000 * PRECISION, 100);
        let wrong_pair = [0xFF; 32];
        let result = validate_for_lending(&oracle, &wrong_pair, 150);
        assert!(matches!(result, Err(SDKError::OraclePairMismatch)));
    }

    #[test]
    fn test_validate_for_liquidation_zero_price() {
        let oracle = fresh_oracle(0, 100);
        let result = validate_for_liquidation(&oracle, &test_pair_id(), 150);
        assert!(matches!(result, Err(SDKError::InvalidAmounts)));
    }

    #[test]
    fn test_validate_for_liquidation_stale() {
        let oracle = fresh_oracle(2000 * PRECISION, 10);
        let result = validate_for_liquidation(&oracle, &test_pair_id(), 200);
        assert!(matches!(result, Err(SDKError::StaleOracleData)));
    }

    #[test]
    fn test_aggregate_zero_price_oracle_rejected() {
        let oracles = vec![
            fresh_oracle(3000 * PRECISION, 100),
            fresh_oracle(0, 101), // Zero price
        ];
        let result = aggregate_prices(&oracles, &test_pair_id(), 150);
        assert!(matches!(result, Err(SDKError::InvalidAmounts)));
    }

    #[test]
    fn test_aggregate_wrong_pair_id_rejected() {
        let wrong_pair_oracle = OracleCellData {
            price: 3000 * PRECISION,
            block_number: 100,
            confidence: 80,
            source_hash: test_source_hash(),
            pair_id: [0xFF; 32], // Wrong pair
        };
        let oracles = vec![
            fresh_oracle(3000 * PRECISION, 100),
            wrong_pair_oracle,
        ];
        let result = aggregate_prices(&oracles, &test_pair_id(), 150);
        assert!(matches!(result, Err(SDKError::OraclePairMismatch)));
    }

    #[test]
    fn test_aggregate_four_oracles_even_median() {
        let oracles = vec![
            fresh_oracle(1000 * PRECISION, 100),
            fresh_oracle(1020 * PRECISION, 101),
            fresh_oracle(1040 * PRECISION, 102),
            fresh_oracle(1060 * PRECISION, 103),
        ];
        let price = aggregate_prices(&oracles, &test_pair_id(), 150).unwrap();
        // Sorted: 1000, 1020, 1040, 1060 -> median = (1020+1040)/2 = 1030
        assert_eq!(price, 1030 * PRECISION);
    }

    #[test]
    fn test_aggregate_five_oracles_odd_median() {
        let oracles = vec![
            fresh_oracle(1000 * PRECISION, 100),
            fresh_oracle(1010 * PRECISION, 101),
            fresh_oracle(1050 * PRECISION, 102),
            fresh_oracle(1020 * PRECISION, 103),
            fresh_oracle(1030 * PRECISION, 104),
        ];
        let price = aggregate_prices(&oracles, &test_pair_id(), 150).unwrap();
        // Sorted: 1000, 1010, 1020, 1030, 1050 -> median = 1020
        assert_eq!(price, 1020 * PRECISION);
    }

    #[test]
    fn test_aggregate_exact_10_percent_deviation() {
        // 10% deviation = 1000 bps = MAX_ORACLE_DEVIATION_BPS exactly
        let oracles = vec![
            fresh_oracle(1000 * PRECISION, 100),
            fresh_oracle(1100 * PRECISION, 101), // exactly 10%
        ];
        let price = aggregate_prices(&oracles, &test_pair_id(), 150).unwrap();
        assert_eq!(price, 1050 * PRECISION);
    }

    #[test]
    fn test_weighted_price_zero_price_rejected() {
        let oracles = vec![
            fresh_oracle(3000 * PRECISION, 100),
            fresh_oracle(0, 101), // Zero price
        ];
        let result = weighted_price(&oracles, &test_pair_id(), 150);
        assert!(matches!(result, Err(SDKError::InvalidAmounts)));
    }

    #[test]
    fn test_weighted_price_stale_rejected() {
        let oracles = vec![
            fresh_oracle(3000 * PRECISION, 100),
            fresh_oracle(3000 * PRECISION, 10), // Stale
        ];
        let result = weighted_price(&oracles, &test_pair_id(), 150);
        assert!(matches!(result, Err(SDKError::StaleOracleData)));
    }

    #[test]
    fn test_exchange_rate_fractional() {
        // Token A = $0.50, Token B = $2.00
        let rate = exchange_rate(PRECISION / 2, 2 * PRECISION).unwrap();
        // 0.5 / 2.0 = 0.25, scaled by PRECISION
        assert_eq!(rate, PRECISION / 4);
    }

    #[test]
    fn test_exchange_rate_very_small_debt_price() {
        // Collateral = $1000, Debt = smallest possible non-zero
        let rate = exchange_rate(1000 * PRECISION, 1).unwrap();
        assert!(rate > 0);
    }

    #[test]
    fn test_price_change_bps_100_percent_increase() {
        // 100% increase = doubled = 10000 bps
        assert_eq!(price_change_bps(100 * PRECISION, 200 * PRECISION), 10_000);
    }

    #[test]
    fn test_price_change_bps_both_zero() {
        // Both zero: old_price == 0 -> returns 10000
        assert_eq!(price_change_bps(0, 0), 10_000);
    }

    #[test]
    fn test_price_change_bps_tiny_change() {
        // 1 shannon change on a large price — should be 0 bps (integer division)
        let large_price = 1_000_000 * PRECISION;
        assert_eq!(price_change_bps(large_price, large_price + 1), 0);
    }

    #[test]
    fn test_build_oracle_cell_dep_zero_index() {
        let dep = build_oracle_cell_dep([0x00; 32], 0);
        assert_eq!(dep.tx_hash, [0x00; 32]);
        assert_eq!(dep.index, 0);
    }

    #[test]
    fn test_extract_prices_symmetric() {
        let price_val = 1500 * PRECISION;
        let pair = PricePair {
            collateral: OraclePrice {
                data: fresh_oracle(price_val, 100),
                cell_dep: build_oracle_cell_dep([0x01; 32], 0),
            },
            debt: OraclePrice {
                data: fresh_oracle(price_val, 100),
                cell_dep: build_oracle_cell_dep([0x02; 32], 1),
            },
        };
        let (col, debt) = extract_prices(&pair);
        assert_eq!(col, debt);
        assert_eq!(col, price_val);
    }

    // ============ Batch 2: Additional Coverage Tests ============

    #[test]
    fn test_aggregate_all_identical_prices() {
        // All oracles report the exact same price → median = that price
        let oracles = vec![
            fresh_oracle(5000 * PRECISION, 100),
            fresh_oracle(5000 * PRECISION, 101),
            fresh_oracle(5000 * PRECISION, 102),
            fresh_oracle(5000 * PRECISION, 103),
        ];
        let price = aggregate_prices(&oracles, &test_pair_id(), 150).unwrap();
        assert_eq!(price, 5000 * PRECISION);
    }

    #[test]
    fn test_weighted_price_one_zero_confidence_one_high() {
        // One oracle with confidence=0, one with confidence=100
        // Only the high-confidence oracle should matter
        let oracles = vec![
            oracle_with_confidence(1000 * PRECISION, 100, 0),
            oracle_with_confidence(5000 * PRECISION, 101, 100),
        ];
        // total_weight = 100, weighted = 1000*0/100 + 5000*100/100 = 5000
        let price = weighted_price(&oracles, &test_pair_id(), 150).unwrap();
        assert_eq!(price, 5000 * PRECISION);
    }

    #[test]
    fn test_exchange_rate_inverse() {
        // rate(A/B) * rate(B/A) should ≈ PRECISION^2 (within rounding)
        let price_a = 2500 * PRECISION;
        let price_b = 50 * PRECISION;

        let rate_ab = exchange_rate(price_a, price_b).unwrap();
        let rate_ba = exchange_rate(price_b, price_a).unwrap();

        // rate_ab = 2500/50 = 50 * PRECISION
        // rate_ba = 50/2500 = 0.02 * PRECISION
        // rate_ab * rate_ba / PRECISION should ≈ PRECISION
        let product = vibeswap_math::mul_div(rate_ab, rate_ba, PRECISION);
        assert_eq!(product, PRECISION, "Inverse rates should multiply to 1.0");
    }

    #[test]
    fn test_price_change_bps_to_zero() {
        // Price drops to zero from some value → should be 10000 bps (100% drop)
        assert_eq!(price_change_bps(500 * PRECISION, 0), 10_000);
    }

    #[test]
    fn test_validate_for_lending_all_failures_in_order() {
        // Test that validate_for_lending checks price=0 first, then freshness, then confidence, then pair_id
        // Zero price fails before anything else
        let zero_price = oracle_with_confidence(0, 100, 80);
        assert!(matches!(
            validate_for_lending(&zero_price, &test_pair_id(), 150),
            Err(SDKError::InvalidAmounts)
        ));

        // Stale but otherwise valid → StaleOracleData
        let stale = oracle_with_confidence(1000 * PRECISION, 10, 80);
        assert!(matches!(
            validate_for_lending(&stale, &test_pair_id(), 200),
            Err(SDKError::StaleOracleData)
        ));

        // Fresh but low confidence → LowOracleConfidence
        let low_conf = oracle_with_confidence(1000 * PRECISION, 100, 20);
        assert!(matches!(
            validate_for_lending(&low_conf, &test_pair_id(), 150),
            Err(SDKError::LowOracleConfidence)
        ));

        // Fresh, confident, but wrong pair → OraclePairMismatch
        let wrong_pair = oracle_with_confidence(1000 * PRECISION, 100, 80);
        assert!(matches!(
            validate_for_lending(&wrong_pair, &[0xFF; 32], 150),
            Err(SDKError::OraclePairMismatch)
        ));
    }

    #[test]
    fn test_confidence_lending_max_value() {
        // u8::MAX (255) confidence should always pass lending check
        let oracle = oracle_with_confidence(1000 * PRECISION, 100, 255);
        assert!(validate_confidence_lending(&oracle).is_ok());
    }

    #[test]
    fn test_weighted_price_three_sources_different_confidence() {
        // Three sources: verify weighted average leans toward highest-confidence oracle
        let oracles = vec![
            oracle_with_confidence(1000 * PRECISION, 100, 10), // Low confidence
            oracle_with_confidence(2000 * PRECISION, 101, 30), // Medium confidence
            oracle_with_confidence(3000 * PRECISION, 102, 60), // High confidence
        ];
        // total_weight = 100
        // weighted = 1000*10/100 + 2000*30/100 + 3000*60/100 = 100 + 600 + 1800 = 2500
        let price = weighted_price(&oracles, &test_pair_id(), 150).unwrap();
        assert_eq!(price, 2500 * PRECISION);
    }

    #[test]
    fn test_price_change_bps_symmetric() {
        // Price change should be symmetric: going from 100→150 and 150→100 both = same bps
        // But actually they are NOT symmetric because we divide by old_price
        // 100→150: diff=50, 50*10000/100 = 5000 bps
        // 150→100: diff=50, 50*10000/150 = 3333 bps
        let up = price_change_bps(100 * PRECISION, 150 * PRECISION);
        let down = price_change_bps(150 * PRECISION, 100 * PRECISION);
        assert_eq!(up, 5000);
        assert_eq!(down, 3333);
        assert_ne!(up, down, "Price change bps is NOT symmetric (divides by old_price)");
    }

    // ============ Batch 3: Edge Cases, Boundaries, Overflow, Error Paths ============

    #[test]
    fn test_freshness_u64_max_block_number() {
        // Oracle at u64::MAX block, current also u64::MAX — not stale
        let oracle = fresh_oracle(1000 * PRECISION, u64::MAX);
        assert!(validate_freshness(&oracle, u64::MAX).is_ok());
    }

    #[test]
    fn test_freshness_oracle_at_block_zero_current_at_max_staleness() {
        // Oracle at block 0, current at exactly MAX_STALENESS_BLOCKS — not stale
        let oracle = fresh_oracle(1000 * PRECISION, 0);
        assert!(validate_freshness(&oracle, MAX_STALENESS_BLOCKS).is_ok());
    }

    #[test]
    fn test_freshness_oracle_at_block_zero_current_just_past() {
        // Oracle at block 0, current at MAX_STALENESS_BLOCKS + 1 — stale
        let oracle = fresh_oracle(1000 * PRECISION, 0);
        let result = validate_freshness(&oracle, MAX_STALENESS_BLOCKS + 1);
        assert!(matches!(result, Err(SDKError::StaleOracleData)));
    }

    #[test]
    fn test_confidence_lending_one_below_max_u8() {
        // 254 is well above threshold
        let oracle = oracle_with_confidence(1000 * PRECISION, 100, 254);
        assert!(validate_confidence_lending(&oracle).is_ok());
    }

    #[test]
    fn test_confidence_liquidation_one_below_boundary() {
        // Exactly MIN_CONFIDENCE_LIQUIDATION - 1 = 24
        let oracle = oracle_with_confidence(1000 * PRECISION, 100, MIN_CONFIDENCE_LIQUIDATION - 1);
        assert!(matches!(
            validate_confidence_liquidation(&oracle),
            Err(SDKError::LowOracleConfidence)
        ));
    }

    #[test]
    fn test_confidence_liquidation_max_u8() {
        let oracle = oracle_with_confidence(1000 * PRECISION, 100, 255);
        assert!(validate_confidence_liquidation(&oracle).is_ok());
    }

    #[test]
    fn test_pair_id_all_zeros() {
        let oracle = OracleCellData {
            price: 1000 * PRECISION,
            block_number: 100,
            confidence: 80,
            source_hash: test_source_hash(),
            pair_id: [0u8; 32],
        };
        assert!(validate_pair_id(&oracle, &[0u8; 32]).is_ok());
    }

    #[test]
    fn test_pair_id_single_byte_difference() {
        let oracle = fresh_oracle(1000 * PRECISION, 100);
        let mut almost_right = test_pair_id();
        almost_right[31] = 0xFF; // Differ in last byte only
        assert!(matches!(
            validate_pair_id(&oracle, &almost_right),
            Err(SDKError::OraclePairMismatch)
        ));
    }

    #[test]
    fn test_validate_for_lending_price_one_wei() {
        // Smallest valid price (1 wei) should pass
        let oracle = oracle_with_confidence(1, 100, 80);
        assert!(validate_for_lending(&oracle, &test_pair_id(), 150).is_ok());
    }

    #[test]
    fn test_validate_for_liquidation_wrong_pair_id() {
        let oracle = fresh_oracle(2000 * PRECISION, 100);
        let wrong_pair = [0xBB; 32];
        let result = validate_for_liquidation(&oracle, &wrong_pair, 150);
        assert!(matches!(result, Err(SDKError::OraclePairMismatch)));
    }

    #[test]
    fn test_validate_for_liquidation_low_confidence_below_25() {
        let oracle = oracle_with_confidence(2000 * PRECISION, 100, 24);
        let result = validate_for_liquidation(&oracle, &test_pair_id(), 150);
        assert!(matches!(result, Err(SDKError::LowOracleConfidence)));
    }

    #[test]
    fn test_validate_for_liquidation_exactly_at_liquidation_confidence() {
        let oracle = oracle_with_confidence(2000 * PRECISION, 100, MIN_CONFIDENCE_LIQUIDATION);
        assert!(validate_for_liquidation(&oracle, &test_pair_id(), 150).is_ok());
    }

    #[test]
    fn test_aggregate_deviation_just_over_threshold() {
        // 10.01% deviation should be rejected: 1000 * 1001 / 10000 = 100.1
        // We need min=10000, max=11001 → deviation = 1001*10000/10000 = 1001 bps > 1000
        let oracles = vec![
            fresh_oracle(10000 * PRECISION, 100),
            fresh_oracle(11001 * PRECISION, 101),
        ];
        let result = aggregate_prices(&oracles, &test_pair_id(), 150);
        assert!(matches!(result, Err(SDKError::OracleDeviationTooHigh)));
    }

    #[test]
    fn test_aggregate_two_identical_prices() {
        let oracles = vec![
            fresh_oracle(7777 * PRECISION, 100),
            fresh_oracle(7777 * PRECISION, 101),
        ];
        let price = aggregate_prices(&oracles, &test_pair_id(), 150).unwrap();
        assert_eq!(price, 7777 * PRECISION);
    }

    #[test]
    fn test_aggregate_six_oracles_even_median() {
        // 6 oracles: median = average of 3rd and 4th sorted values
        let oracles = vec![
            fresh_oracle(1000 * PRECISION, 100),
            fresh_oracle(1010 * PRECISION, 101),
            fresh_oracle(1020 * PRECISION, 102),
            fresh_oracle(1030 * PRECISION, 103),
            fresh_oracle(1040 * PRECISION, 104),
            fresh_oracle(1050 * PRECISION, 105),
        ];
        let price = aggregate_prices(&oracles, &test_pair_id(), 150).unwrap();
        // Sorted: 1000,1010,1020,1030,1040,1050 → mid=3 → (prices[2]+prices[3])/2 = (1020+1030)/2 = 1025
        assert_eq!(price, 1025 * PRECISION);
    }

    #[test]
    fn test_aggregate_unsorted_input_still_correct() {
        // Verify that internal sorting produces correct median regardless of input order
        let oracles = vec![
            fresh_oracle(1050 * PRECISION, 100),
            fresh_oracle(1000 * PRECISION, 101),
            fresh_oracle(1030 * PRECISION, 102),
            fresh_oracle(1010 * PRECISION, 103),
            fresh_oracle(1040 * PRECISION, 104),
            fresh_oracle(1020 * PRECISION, 105),
        ];
        let price = aggregate_prices(&oracles, &test_pair_id(), 150).unwrap();
        assert_eq!(price, 1025 * PRECISION);
    }

    #[test]
    fn test_weighted_price_empty_rejected() {
        let result = weighted_price(&[], &test_pair_id(), 150);
        assert!(matches!(result, Err(SDKError::InvalidAmounts)));
    }

    #[test]
    fn test_weighted_price_wrong_pair_id_rejected() {
        let wrong_pair_oracle = OracleCellData {
            price: 3000 * PRECISION,
            block_number: 100,
            confidence: 80,
            source_hash: test_source_hash(),
            pair_id: [0xDD; 32],
        };
        let oracles = vec![wrong_pair_oracle];
        let result = weighted_price(&oracles, &test_pair_id(), 150);
        assert!(matches!(result, Err(SDKError::OraclePairMismatch)));
    }

    #[test]
    fn test_weighted_single_oracle_ignores_confidence() {
        // With a single oracle, weighted_price returns the price directly regardless of confidence
        let oracles = vec![oracle_with_confidence(9999 * PRECISION, 100, 1)];
        let price = weighted_price(&oracles, &test_pair_id(), 150).unwrap();
        assert_eq!(price, 9999 * PRECISION);
    }

    #[test]
    fn test_exchange_rate_collateral_zero() {
        // Zero collateral price, non-zero debt — should return 0
        let rate = exchange_rate(0, 1000 * PRECISION).unwrap();
        assert_eq!(rate, 0);
    }

    #[test]
    fn test_exchange_rate_both_one_precision() {
        let rate = exchange_rate(PRECISION, PRECISION).unwrap();
        assert_eq!(rate, PRECISION);
    }

    #[test]
    fn test_exchange_rate_large_values() {
        // Very large prices — exercises wide_mul in mul_div
        let large = u128::MAX / PRECISION; // Avoid overflow in mul_div
        let rate = exchange_rate(large, large).unwrap();
        assert_eq!(rate, PRECISION); // Same price → 1:1
    }

    #[test]
    fn test_price_change_bps_very_small_old_price() {
        // old_price = 1, new_price = 2 → diff=1, 1*10000/1 = 10000 bps
        assert_eq!(price_change_bps(1, 2), 10_000);
    }

    #[test]
    fn test_price_change_bps_new_equals_old() {
        // Same value expressed differently (not using PRECISION multiples)
        assert_eq!(price_change_bps(42, 42), 0);
    }

    #[test]
    fn test_price_change_bps_200_percent_increase() {
        // 100→300 = 200% increase = 20000 bps
        assert_eq!(price_change_bps(100 * PRECISION, 300 * PRECISION), 20_000);
    }

    #[test]
    fn test_build_oracle_cell_dep_max_index() {
        let dep = build_oracle_cell_dep([0xFF; 32], u32::MAX);
        assert_eq!(dep.index, u32::MAX);
        assert!(matches!(dep.dep_type, DepType::Code));
    }

    #[test]
    fn test_build_price_pair_deps_preserves_order() {
        // Verify the first dep is collateral, second is debt
        let pair = PricePair {
            collateral: OraclePrice {
                data: fresh_oracle(3000 * PRECISION, 100),
                cell_dep: build_oracle_cell_dep([0xAA; 32], 5),
            },
            debt: OraclePrice {
                data: fresh_oracle(1 * PRECISION, 100),
                cell_dep: build_oracle_cell_dep([0xBB; 32], 7),
            },
        };
        let deps = build_price_pair_deps(&pair);
        assert_eq!(deps[0].tx_hash, [0xAA; 32]);
        assert_eq!(deps[0].index, 5);
        assert_eq!(deps[1].tx_hash, [0xBB; 32]);
        assert_eq!(deps[1].index, 7);
    }

    #[test]
    fn test_extract_prices_zero_values() {
        // Extract should work even with zero prices (extraction doesn't validate)
        let pair = PricePair {
            collateral: OraclePrice {
                data: fresh_oracle(0, 100),
                cell_dep: build_oracle_cell_dep([0x01; 32], 0),
            },
            debt: OraclePrice {
                data: fresh_oracle(0, 100),
                cell_dep: build_oracle_cell_dep([0x02; 32], 1),
            },
        };
        let (col, debt) = extract_prices(&pair);
        assert_eq!(col, 0);
        assert_eq!(debt, 0);
    }

    #[test]
    fn test_validate_for_liquidation_all_failures_in_order() {
        // Mirrors test_validate_for_lending_all_failures_in_order but for liquidation
        // Zero price → InvalidAmounts
        let zero_price = oracle_with_confidence(0, 100, 80);
        assert!(matches!(
            validate_for_liquidation(&zero_price, &test_pair_id(), 150),
            Err(SDKError::InvalidAmounts)
        ));

        // Stale → StaleOracleData
        let stale = oracle_with_confidence(1000 * PRECISION, 10, 80);
        assert!(matches!(
            validate_for_liquidation(&stale, &test_pair_id(), 200),
            Err(SDKError::StaleOracleData)
        ));

        // Low confidence (below liquidation threshold of 25) → LowOracleConfidence
        let low_conf = oracle_with_confidence(1000 * PRECISION, 100, 10);
        assert!(matches!(
            validate_for_liquidation(&low_conf, &test_pair_id(), 150),
            Err(SDKError::LowOracleConfidence)
        ));

        // Wrong pair → OraclePairMismatch
        let wrong_pair = oracle_with_confidence(1000 * PRECISION, 100, 80);
        assert!(matches!(
            validate_for_liquidation(&wrong_pair, &[0xCC; 32], 150),
            Err(SDKError::OraclePairMismatch)
        ));
    }

    #[test]
    fn test_aggregate_single_oracle_no_deviation_check() {
        // Single oracle bypasses deviation check — just returns the price
        let oracles = vec![fresh_oracle(1 * PRECISION, 100)];
        let price = aggregate_prices(&oracles, &test_pair_id(), 150).unwrap();
        assert_eq!(price, 1 * PRECISION);
    }

    #[test]
    fn test_weighted_price_heavily_skewed() {
        // One oracle with confidence=1, another with confidence=255
        let oracles = vec![
            oracle_with_confidence(1000 * PRECISION, 100, 1),
            oracle_with_confidence(2000 * PRECISION, 101, 255),
        ];
        // total_weight = 256
        // weighted = 1000*1/256 + 2000*255/256
        // = 3 + 1992 (integer math) — should be very close to 2000
        let price = weighted_price(&oracles, &test_pair_id(), 150).unwrap();
        assert!(price > 1990 * PRECISION, "Should lean heavily toward 2000");
        assert!(price < 2000 * PRECISION, "Slight pull from low-confidence oracle");
    }

    #[test]
    fn test_price_change_bps_u128_max_prices() {
        // Both at u128::MAX → no change → 0 bps
        assert_eq!(price_change_bps(u128::MAX, u128::MAX), 0);
    }

    #[test]
    fn test_aggregate_with_minimum_price_values() {
        // All oracles at price = 1 (smallest non-zero)
        let oracles = vec![
            fresh_oracle(1, 100),
            fresh_oracle(1, 101),
            fresh_oracle(1, 102),
        ];
        let price = aggregate_prices(&oracles, &test_pair_id(), 150).unwrap();
        assert_eq!(price, 1);
    }

    // ============ Batch 4: Hardening to 120+ Tests ============

    #[test]
    fn test_freshness_oracle_block_higher_than_current() {
        // Oracle block_number > current_block (e.g., during reorg). Should not be stale.
        let oracle = fresh_oracle(1000 * PRECISION, 500);
        assert!(validate_freshness(&oracle, 200).is_ok());
    }

    #[test]
    fn test_freshness_large_gap_u64_overflow_protection() {
        // current_block far above oracle block — subtraction is safe due to the > check
        let oracle = fresh_oracle(1000 * PRECISION, 0);
        let result = validate_freshness(&oracle, u64::MAX);
        assert!(matches!(result, Err(SDKError::StaleOracleData)));
    }

    #[test]
    fn test_confidence_lending_exactly_one_below() {
        // MIN_CONFIDENCE_LENDING - 1 = 49 should fail
        let oracle = oracle_with_confidence(1000 * PRECISION, 100, MIN_CONFIDENCE_LENDING - 1);
        assert!(matches!(
            validate_confidence_lending(&oracle),
            Err(SDKError::LowOracleConfidence)
        ));
    }

    #[test]
    fn test_confidence_lending_exactly_one_above() {
        // MIN_CONFIDENCE_LENDING + 1 = 51 should pass
        let oracle = oracle_with_confidence(1000 * PRECISION, 100, MIN_CONFIDENCE_LENDING + 1);
        assert!(validate_confidence_lending(&oracle).is_ok());
    }

    #[test]
    fn test_confidence_liquidation_exactly_one_above() {
        // MIN_CONFIDENCE_LIQUIDATION + 1 = 26 should pass
        let oracle = oracle_with_confidence(1000 * PRECISION, 100, MIN_CONFIDENCE_LIQUIDATION + 1);
        assert!(validate_confidence_liquidation(&oracle).is_ok());
    }

    #[test]
    fn test_validate_for_lending_passes_all_checks() {
        // Oracle that passes every check — price, freshness, confidence, pair_id
        let oracle = oracle_with_confidence(5000 * PRECISION, 140, 90);
        assert!(validate_for_lending(&oracle, &test_pair_id(), 150).is_ok());
    }

    #[test]
    fn test_validate_for_liquidation_passes_all_checks() {
        // Oracle that passes every liquidation check — lower confidence bar
        let oracle = oracle_with_confidence(5000 * PRECISION, 140, 30);
        assert!(validate_for_liquidation(&oracle, &test_pair_id(), 150).is_ok());
    }

    #[test]
    fn test_aggregate_seven_oracles_odd_median() {
        // 7 oracles: median is the 4th sorted value
        let oracles = vec![
            fresh_oracle(1070 * PRECISION, 100),
            fresh_oracle(1000 * PRECISION, 101),
            fresh_oracle(1020 * PRECISION, 102),
            fresh_oracle(1050 * PRECISION, 103),
            fresh_oracle(1030 * PRECISION, 104),
            fresh_oracle(1010 * PRECISION, 105),
            fresh_oracle(1060 * PRECISION, 106),
        ];
        let price = aggregate_prices(&oracles, &test_pair_id(), 150).unwrap();
        // Sorted: 1000,1010,1020,1030,1050,1060,1070 → median index 3 = 1030
        assert_eq!(price, 1030 * PRECISION);
    }

    #[test]
    fn test_aggregate_deviation_exactly_at_threshold() {
        // 10% deviation = 1000 bps exactly = MAX_ORACLE_DEVIATION_BPS => passes
        let oracles = vec![
            fresh_oracle(10000 * PRECISION, 100),
            fresh_oracle(11000 * PRECISION, 101), // exactly 10%
        ];
        let price = aggregate_prices(&oracles, &test_pair_id(), 150).unwrap();
        assert_eq!(price, 10500 * PRECISION);
    }

    #[test]
    fn test_weighted_price_all_max_confidence() {
        // All oracles at confidence=255 → equal weighting → simple average
        let oracles = vec![
            oracle_with_confidence(2000 * PRECISION, 100, 255),
            oracle_with_confidence(4000 * PRECISION, 101, 255),
        ];
        let price = weighted_price(&oracles, &test_pair_id(), 150).unwrap();
        // 2000*255/510 + 4000*255/510 = 1000 + 2000 = 3000
        assert_eq!(price, 3000 * PRECISION);
    }

    #[test]
    fn test_exchange_rate_very_large_collateral_small_debt() {
        // Large collateral price with tiny debt price
        let rate = exchange_rate(u128::MAX / PRECISION, 1).unwrap();
        assert!(rate > 0);
    }

    #[test]
    fn test_exchange_rate_both_zero_collateral() {
        // Zero collateral, non-zero debt → rate = 0
        let rate = exchange_rate(0, 5000 * PRECISION).unwrap();
        assert_eq!(rate, 0);
    }

    #[test]
    fn test_price_change_bps_half() {
        // 50% decrease: 100→50 = 5000 bps
        assert_eq!(price_change_bps(100 * PRECISION, 50 * PRECISION), 5000);
    }

    #[test]
    fn test_price_change_bps_triple() {
        // 200% increase: 100→300 = 20000 bps
        assert_eq!(price_change_bps(100 * PRECISION, 300 * PRECISION), 20_000);
    }

    #[test]
    fn test_price_change_bps_one_wei_difference() {
        // 1 wei difference on a small price
        let bps = price_change_bps(2, 3);
        // diff=1, 1*10000/2 = 5000
        assert_eq!(bps, 5000);
    }

    #[test]
    fn test_oracle_price_struct_clone() {
        let op = OraclePrice {
            data: fresh_oracle(3000 * PRECISION, 100),
            cell_dep: build_oracle_cell_dep([0x01; 32], 0),
        };
        let cloned = op.clone();
        assert_eq!(cloned.data.price, op.data.price);
        assert_eq!(cloned.cell_dep.tx_hash, op.cell_dep.tx_hash);
    }

    #[test]
    fn test_price_pair_struct_clone() {
        let pair = PricePair {
            collateral: OraclePrice {
                data: fresh_oracle(3000 * PRECISION, 100),
                cell_dep: build_oracle_cell_dep([0x01; 32], 0),
            },
            debt: OraclePrice {
                data: fresh_oracle(1 * PRECISION, 100),
                cell_dep: build_oracle_cell_dep([0x02; 32], 1),
            },
        };
        let cloned = pair.clone();
        assert_eq!(cloned.collateral.data.price, pair.collateral.data.price);
        assert_eq!(cloned.debt.data.price, pair.debt.data.price);
    }

    #[test]
    fn test_aggregate_all_stale_rejected() {
        // All oracles stale → first one triggers StaleOracleData
        let oracles = vec![
            fresh_oracle(3000 * PRECISION, 10),
            fresh_oracle(3000 * PRECISION, 20),
        ];
        let result = aggregate_prices(&oracles, &test_pair_id(), 200);
        assert!(matches!(result, Err(SDKError::StaleOracleData)));
    }

    #[test]
    fn test_weighted_price_four_sources_computation() {
        // 4 sources with known weights → verify exact computation
        let oracles = vec![
            oracle_with_confidence(1000 * PRECISION, 100, 10),
            oracle_with_confidence(2000 * PRECISION, 101, 20),
            oracle_with_confidence(3000 * PRECISION, 102, 30),
            oracle_with_confidence(4000 * PRECISION, 103, 40),
        ];
        // total_weight = 100
        // weighted = 1000*10/100 + 2000*20/100 + 3000*30/100 + 4000*40/100
        //          = 100 + 400 + 900 + 1600 = 3000
        let price = weighted_price(&oracles, &test_pair_id(), 150).unwrap();
        assert_eq!(price, 3000 * PRECISION);
    }

    #[test]
    fn test_constants_values() {
        // Verify constant values are what we expect (regression test)
        assert_eq!(MAX_STALENESS_BLOCKS, 100);
        assert_eq!(MIN_CONFIDENCE_LENDING, 50);
        assert_eq!(MIN_CONFIDENCE_LIQUIDATION, 25);
        assert_eq!(MAX_ORACLE_DEVIATION_BPS, 1000);
    }

    #[test]
    fn test_build_oracle_cell_dep_preserves_fields() {
        let dep = build_oracle_cell_dep([0x42; 32], 17);
        assert_eq!(dep.tx_hash, [0x42; 32]);
        assert_eq!(dep.index, 17);
        assert!(matches!(dep.dep_type, DepType::Code));
    }

    #[test]
    fn test_exchange_rate_precision_scaling() {
        // rate = collateral / debt * PRECISION
        // 10 / 5 = 2.0 → 2 * PRECISION
        let rate = exchange_rate(10 * PRECISION, 5 * PRECISION).unwrap();
        assert_eq!(rate, 2 * PRECISION);
    }

    #[test]
    fn test_price_change_bps_old_one_new_zero() {
        // old=1, new=0 → diff=1, 1*10000/1 = 10000 bps
        assert_eq!(price_change_bps(1, 0), 10_000);
    }

    #[test]
    fn test_validate_for_lending_confidence_exactly_at_threshold() {
        // confidence = 50 (exactly MIN_CONFIDENCE_LENDING) should pass
        let oracle = oracle_with_confidence(2000 * PRECISION, 100, 50);
        assert!(validate_for_lending(&oracle, &test_pair_id(), 150).is_ok());
    }

    #[test]
    fn test_validate_for_liquidation_confidence_exactly_at_threshold() {
        // confidence = 25 (exactly MIN_CONFIDENCE_LIQUIDATION) should pass
        let oracle = oracle_with_confidence(2000 * PRECISION, 100, 25);
        assert!(validate_for_liquidation(&oracle, &test_pair_id(), 150).is_ok());
    }

    #[test]
    fn test_aggregate_deviation_bps_with_identical_prices() {
        // All identical prices → deviation = 0 bps → always passes
        let oracles = vec![
            fresh_oracle(42 * PRECISION, 100),
            fresh_oracle(42 * PRECISION, 101),
            fresh_oracle(42 * PRECISION, 102),
        ];
        let price = aggregate_prices(&oracles, &test_pair_id(), 150).unwrap();
        assert_eq!(price, 42 * PRECISION);
    }
}
