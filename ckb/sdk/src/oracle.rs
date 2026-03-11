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
}
