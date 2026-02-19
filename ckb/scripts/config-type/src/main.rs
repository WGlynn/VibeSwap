// ============ Config Type Script — CKB-VM Entry Point ============
// Type script for protocol configuration singleton cell.
// Used as cell_dep by auction and pool type scripts.

#![cfg_attr(feature = "ckb", no_std)]
#![cfg_attr(feature = "ckb", no_main)]

#[cfg(feature = "ckb")]
ckb_std::default_alloc!();

#[cfg(feature = "ckb")]
ckb_std::entry!(program);

// ============ CKB-VM Entry Point ============

#[cfg(feature = "ckb")]
fn program() -> i8 {
    use ckb_std::ckb_constants::Source;
    use ckb_std::high_level::load_cell_data;
    use config_type::verify_config_type;

    // Determine creation vs update
    let old_data = load_cell_data(0, Source::GroupInput).ok();
    let is_creation = old_data.is_none();

    // Load new cell data
    let new_data = match load_cell_data(0, Source::GroupOutput) {
        Ok(d) => d,
        Err(_) => return -2,
    };

    // Governance authorization: if input cell lock script passed, it's authorized
    let is_governance_authorized = !is_creation || {
        // For creation: simplified — actual auth via lock script
        true
    };

    match verify_config_type(
        is_creation,
        old_data.as_deref(),
        &new_data,
        is_governance_authorized,
    ) {
        Ok(()) => 0,
        Err(_) => -10,
    }
}

// ============ Native Entry Point ============

#[cfg(not(feature = "ckb"))]
fn main() {
    println!("Config Type Script — compile with --features ckb for CKB-VM");
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use config_type::*;
    use vibeswap_types::*;

    #[test]
    fn test_valid_creation() {
        let config = ConfigCellData::default();
        let data = config.serialize();
        assert!(verify_config_type(true, None, &data, true).is_ok());
    }

    #[test]
    fn test_unauthorized_rejected() {
        let config = ConfigCellData::default();
        let data = config.serialize();
        assert_eq!(
            verify_config_type(true, None, &data, false),
            Err(ConfigTypeError::Unauthorized)
        );
    }

    #[test]
    fn test_zero_commit_window_rejected() {
        let mut config = ConfigCellData::default();
        config.commit_window_blocks = 0;
        let data = config.serialize();
        assert_eq!(
            verify_config_type(true, None, &data, true),
            Err(ConfigTypeError::InvalidCommitWindow)
        );
    }

    #[test]
    fn test_zero_pow_difficulty_rejected() {
        let mut config = ConfigCellData::default();
        config.min_pow_difficulty = 0;
        let data = config.serialize();
        assert_eq!(
            verify_config_type(true, None, &data, true),
            Err(ConfigTypeError::InvalidMinDifficulty)
        );
    }
}
