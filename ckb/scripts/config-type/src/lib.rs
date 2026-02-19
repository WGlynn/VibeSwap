// ============ Config Type Script — Library ============
// CKB type script for protocol configuration singleton cell
// Used as cell_dep by auction and pool type scripts

#![cfg_attr(feature = "ckb", no_std)]

use vibeswap_types::*;

pub fn verify_config_type(
    _is_creation: bool,
    old_data: Option<&[u8]>,
    new_data: &[u8],
    is_governance_authorized: bool,
) -> Result<(), ConfigTypeError> {
    let new_config = ConfigCellData::deserialize(new_data)
        .ok_or(ConfigTypeError::InvalidCellData)?;

    if !is_governance_authorized {
        return Err(ConfigTypeError::Unauthorized);
    }

    // Validate parameter ranges
    validate_config_ranges(&new_config)?;

    if let Some(old) = old_data {
        let _old_config = ConfigCellData::deserialize(old)
            .ok_or(ConfigTypeError::InvalidCellData)?;

        // Slash rate cannot exceed 100%
        if new_config.slash_rate_bps > 10_000 {
            return Err(ConfigTypeError::InvalidSlashRate);
        }

        // Min PoW difficulty cannot be zero
        if new_config.min_pow_difficulty == 0 {
            return Err(ConfigTypeError::InvalidMinDifficulty);
        }
    }

    Ok(())
}

fn validate_config_ranges(config: &ConfigCellData) -> Result<(), ConfigTypeError> {
    // Commit window: 1-1000 blocks
    if config.commit_window_blocks == 0 || config.commit_window_blocks > 1000 {
        return Err(ConfigTypeError::InvalidCommitWindow);
    }

    // Reveal window: 1-500 blocks
    if config.reveal_window_blocks == 0 || config.reveal_window_blocks > 500 {
        return Err(ConfigTypeError::InvalidRevealWindow);
    }

    // Slash rate: 0-10000 bps
    if config.slash_rate_bps > 10_000 {
        return Err(ConfigTypeError::InvalidSlashRate);
    }

    // Price deviation: 1-5000 bps (0.01%-50%)
    if config.max_price_deviation == 0 || config.max_price_deviation > 5000 {
        return Err(ConfigTypeError::InvalidPriceDeviation);
    }

    // PoW difficulty: 1-255
    if config.min_pow_difficulty == 0 {
        return Err(ConfigTypeError::InvalidMinDifficulty);
    }

    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConfigTypeError {
    InvalidCellData,
    Unauthorized,
    InvalidCommitWindow,
    InvalidRevealWindow,
    InvalidSlashRate,
    InvalidPriceDeviation,
    InvalidMinDifficulty,
}
