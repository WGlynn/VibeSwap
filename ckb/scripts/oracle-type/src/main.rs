// ============ Oracle Type Script ============
// CKB type script for oracle price feed cells
// Updated by authorized relayers with freshness checks

use vibeswap_types::*;

pub fn verify_oracle_type(
    _is_creation: bool,
    old_data: Option<&[u8]>,
    new_data: &[u8],
    is_authorized_relayer: bool,
    current_block: u64,
) -> Result<(), OracleTypeError> {
    let new_oracle = OracleCellData::deserialize(new_data)
        .ok_or(OracleTypeError::InvalidCellData)?;

    // Only authorized relayers can update
    if !is_authorized_relayer {
        return Err(OracleTypeError::Unauthorized);
    }

    // Price must be positive
    if new_oracle.price == 0 {
        return Err(OracleTypeError::ZeroPrice);
    }

    // Confidence must be 0-100
    if new_oracle.confidence > 100 {
        return Err(OracleTypeError::InvalidConfidence);
    }

    // Block number must be current or recent
    if new_oracle.block_number > current_block {
        return Err(OracleTypeError::FutureBlock);
    }
    if current_block - new_oracle.block_number > 100 {
        return Err(OracleTypeError::StaleData);
    }

    // Pair ID must be non-zero
    if new_oracle.pair_id == [0u8; 32] {
        return Err(OracleTypeError::InvalidPairId);
    }

    // If updating, verify freshness
    if let Some(old) = old_data {
        let old_oracle = OracleCellData::deserialize(old)
            .ok_or(OracleTypeError::InvalidCellData)?;

        // Must be newer
        if new_oracle.block_number <= old_oracle.block_number {
            return Err(OracleTypeError::NotNewer);
        }

        // Pair ID must match
        if new_oracle.pair_id != old_oracle.pair_id {
            return Err(OracleTypeError::PairIdChanged);
        }

        // Price change must be reasonable (max 50% per update)
        let max_change = old_oracle.price / 2;
        if new_oracle.price > old_oracle.price + max_change
            || new_oracle.price + max_change < old_oracle.price
        {
            return Err(OracleTypeError::ExcessivePriceChange);
        }
    }

    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OracleTypeError {
    InvalidCellData,
    Unauthorized,
    ZeroPrice,
    InvalidConfidence,
    FutureBlock,
    StaleData,
    InvalidPairId,
    NotNewer,
    PairIdChanged,
    ExcessivePriceChange,
}

fn main() {
    println!("Oracle Type Script — compile with RISC-V target for CKB-VM");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_creation() {
        let oracle = OracleCellData {
            price: 2_000 * PRECISION,
            block_number: 100,
            confidence: 95,
            source_hash: [0x01; 32],
            pair_id: [0x02; 32],
        };
        let data = oracle.serialize();
        assert!(verify_oracle_type(true, None, &data, true, 100).is_ok());
    }

    #[test]
    fn test_unauthorized() {
        let oracle = OracleCellData {
            price: 2_000 * PRECISION,
            block_number: 100,
            confidence: 95,
            source_hash: [0x01; 32],
            pair_id: [0x02; 32],
        };
        let data = oracle.serialize();
        assert_eq!(
            verify_oracle_type(true, None, &data, false, 100),
            Err(OracleTypeError::Unauthorized)
        );
    }

    #[test]
    fn test_stale_data_rejected() {
        let oracle = OracleCellData {
            price: 2_000 * PRECISION,
            block_number: 100,
            confidence: 95,
            source_hash: [0x01; 32],
            pair_id: [0x02; 32],
        };
        let data = oracle.serialize();
        assert_eq!(
            verify_oracle_type(true, None, &data, true, 300), // 200 blocks old
            Err(OracleTypeError::StaleData)
        );
    }

    #[test]
    fn test_excessive_price_change() {
        let old = OracleCellData {
            price: 2_000 * PRECISION,
            block_number: 100,
            confidence: 95,
            source_hash: [0x01; 32],
            pair_id: [0x02; 32],
        };
        let old_data = old.serialize();

        let new_oracle = OracleCellData {
            price: 4_000 * PRECISION, // 100% increase
            block_number: 110,
            confidence: 90,
            source_hash: [0x01; 32],
            pair_id: [0x02; 32],
        };
        let new_data = new_oracle.serialize();

        assert_eq!(
            verify_oracle_type(false, Some(&old_data), &new_data, true, 110),
            Err(OracleTypeError::ExcessivePriceChange)
        );
    }
}
