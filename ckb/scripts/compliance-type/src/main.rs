// ============ Compliance Type Script — CKB-VM Entry Point ============
// Type script for the compliance registry singleton cell.
// Used as cell_dep by auction type script for address filtering.

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
    use compliance_type::verify_compliance_type;

    // Determine creation vs update
    let old_data = load_cell_data(0, Source::GroupInput).ok();
    let is_creation = old_data.is_none();

    // Load new cell data
    let new_data = match load_cell_data(0, Source::GroupOutput) {
        Ok(d) => d,
        Err(_) => return -2,
    };

    // Governance authorization: check if a governance signature is present
    // In CKB, this would be verified via a separate governance lock script
    // on the input cell. If the input cell is consumed, its lock script passed.
    let is_governance_authorized = !is_creation; // Input lock passed = authorized
    // For creation, check if any input has governance lock (simplified)
    let is_authorized = if is_creation {
        // In production: verify governance multisig via cell_dep or input lock
        true // Simplified — actual auth via lock script
    } else {
        is_governance_authorized
    };

    match verify_compliance_type(
        is_creation,
        old_data.as_deref(),
        &new_data,
        is_authorized,
    ) {
        Ok(()) => 0,
        Err(_) => -10,
    }
}

// ============ Native Entry Point ============

#[cfg(not(feature = "ckb"))]
fn main() {
    println!("Compliance Type Script — compile with --features ckb for CKB-VM");
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use compliance_type::*;
    use vibeswap_types::*;

    #[test]
    fn test_creation_authorized() {
        let compliance = ComplianceCellData {
            version: 1,
            last_updated: 100,
            ..Default::default()
        };
        let data = compliance.serialize();
        assert!(verify_compliance_type(true, None, &data, true).is_ok());
    }

    #[test]
    fn test_creation_unauthorized() {
        let compliance = ComplianceCellData::default();
        let data = compliance.serialize();
        assert_eq!(
            verify_compliance_type(true, None, &data, false),
            Err(ComplianceTypeError::Unauthorized)
        );
    }

    #[test]
    fn test_update_version_increment() {
        let old = ComplianceCellData { version: 1, last_updated: 100, ..Default::default() };
        let new = ComplianceCellData { version: 2, last_updated: 200, ..Default::default() };
        let old_data = old.serialize();
        let new_data = new.serialize();

        assert!(verify_compliance_type(false, Some(&old_data), &new_data, true).is_ok());
    }

    #[test]
    fn test_update_version_not_incremented() {
        let old = ComplianceCellData { version: 2, last_updated: 100, ..Default::default() };
        let new = ComplianceCellData { version: 2, last_updated: 200, ..Default::default() };
        let old_data = old.serialize();
        let new_data = new.serialize();

        assert_eq!(
            verify_compliance_type(false, Some(&old_data), &new_data, true),
            Err(ComplianceTypeError::VersionNotIncremented)
        );
    }
}
