// ============ Compliance Type Script — Library ============
// CKB type script for the compliance registry singleton cell
// Used as cell_dep by auction type script for address filtering
//
// The compliance cell stores Merkle roots for:
// - Blocked addresses (sanctioned)
// - User tiers (RETAIL, ACCREDITED, INSTITUTIONAL)
// - Jurisdiction configs
//
// Only governance multisig can update this cell

#![cfg_attr(feature = "ckb", no_std)]

use vibeswap_types::*;

// ============ Script Entry Point ============

pub fn verify_compliance_type(
    is_creation: bool,
    old_data: Option<&[u8]>,
    new_data: &[u8],
    is_governance_authorized: bool,
) -> Result<(), ComplianceTypeError> {
    let new_compliance = ComplianceCellData::deserialize(new_data)
        .ok_or(ComplianceTypeError::InvalidCellData)?;

    if is_creation {
        // Only governance can create
        if !is_governance_authorized {
            return Err(ComplianceTypeError::Unauthorized);
        }
        return Ok(());
    }

    // Updates require governance authorization
    if !is_governance_authorized {
        return Err(ComplianceTypeError::Unauthorized);
    }

    if let Some(old) = old_data {
        let old_compliance = ComplianceCellData::deserialize(old)
            .ok_or(ComplianceTypeError::InvalidCellData)?;

        // Version must increment
        if new_compliance.version <= old_compliance.version {
            return Err(ComplianceTypeError::VersionNotIncremented);
        }

        // Last updated must be more recent
        if new_compliance.last_updated <= old_compliance.last_updated {
            return Err(ComplianceTypeError::StaleUpdate);
        }
    }

    Ok(())
}

/// Verify a Merkle proof that an address is blocked
pub fn verify_blocked_address(
    compliance: &ComplianceCellData,
    lock_hash: &[u8; 32],
    proof_path: &[[u8; 32]],
    proof_indices: u32,
) -> bool {
    use sha2::{Digest, Sha256};

    let leaf = {
        let mut hasher = Sha256::new();
        hasher.update(lock_hash);
        let result = hasher.finalize();
        let mut hash = [0u8; 32];
        hash.copy_from_slice(&result);
        hash
    };

    let mut current = leaf;
    for (i, sibling) in proof_path.iter().enumerate() {
        let mut hasher = Sha256::new();
        if (proof_indices >> i) & 1 == 0 {
            hasher.update(current);
            hasher.update(sibling);
        } else {
            hasher.update(sibling);
            hasher.update(current);
        }
        let result = hasher.finalize();
        current.copy_from_slice(&result);
    }

    current == compliance.blocked_merkle_root
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ComplianceTypeError {
    InvalidCellData,
    Unauthorized,
    VersionNotIncremented,
    StaleUpdate,
}
