// ============ Commit Type Script — CKB-VM Entry Point ============
// Type script for commit cell validation (creation and consumption).
// No contention — each user creates their own commit cells.

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
    use ckb_std::high_level::{load_cell_data, load_script, load_cell_lock_hash};
    use commit_type::verify_commit_type;

    let script = match load_script() {
        Ok(s) => s,
        Err(_) => return -1,
    };
    let type_args: alloc::vec::Vec<u8> = script.args().raw_data().to_vec();

    // Determine creation vs consumption
    let has_group_input = load_cell_data(0, Source::GroupInput).is_ok();
    let has_group_output = load_cell_data(0, Source::GroupOutput).is_ok();
    let is_creation = !has_group_input && has_group_output;

    // Load the commit cell data
    let cell_data = if is_creation {
        match load_cell_data(0, Source::GroupOutput) {
            Ok(d) => d,
            Err(_) => return -2,
        }
    } else {
        match load_cell_data(0, Source::GroupInput) {
            Ok(d) => d,
            Err(_) => return -2,
        }
    };

    // Load input lock hash for authorization check (creation only)
    let lock_hash: Option<[u8; 32]> = if is_creation {
        load_cell_lock_hash(0, Source::Input).ok()
    } else {
        None
    };

    // Try to load auction cell data from cell_deps
    let auction_data = load_cell_data(0, Source::CellDep).ok();

    // Min deposit from config (simplified — would come from config cell_dep)
    let min_deposit = 100_000_000u64; // 1 CKB

    match verify_commit_type(
        is_creation,
        &cell_data,
        &type_args,
        lock_hash.as_ref(),
        auction_data.as_deref(),
        min_deposit,
    ) {
        Ok(()) => 0,
        Err(_) => -10,
    }
}

// ============ Native Entry Point ============

#[cfg(not(feature = "ckb"))]
fn main() {
    println!("Commit Type Script — compile with --features ckb for CKB-VM");
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use commit_type::*;
    use vibeswap_types::*;

    fn make_valid_commit() -> CommitCellData {
        CommitCellData {
            order_hash: [0xAB; 32],
            batch_id: 1,
            deposit_ckb: 100_000_000, // 1 CKB
            token_type_hash: [0x01; 32],
            token_amount: 1_000_000_000_000_000_000,
            block_number: 100,
            sender_lock_hash: [0xCC; 32],
        }
    }

    fn make_auction_in_commit_phase() -> Vec<u8> {
        let auction = AuctionCellData {
            phase: PHASE_COMMIT,
            batch_id: 1,
            ..Default::default()
        };
        auction.serialize().to_vec()
    }

    fn make_type_args() -> Vec<u8> {
        let mut args = vec![0u8; 40];
        args[0..32].copy_from_slice(&[0x01; 32]); // pair_id
        args[32..40].copy_from_slice(&1u64.to_le_bytes()); // batch_id
        args
    }

    #[test]
    fn test_valid_creation() {
        let commit = make_valid_commit();
        let data = commit.serialize();
        let lock_hash = [0xCC; 32];
        let auction_data = make_auction_in_commit_phase();
        let type_args = make_type_args();

        let result = verify_commit_type(
            true,
            &data,
            &type_args,
            Some(&lock_hash),
            Some(&auction_data),
            100_000_000,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_zero_order_hash_rejected() {
        let mut commit = make_valid_commit();
        commit.order_hash = [0u8; 32];
        let data = commit.serialize();
        let type_args = make_type_args();

        let result = verify_commit_type(true, &data, &type_args, None, None, 0);
        assert_eq!(result, Err(CommitTypeError::ZeroOrderHash));
    }

    #[test]
    fn test_insufficient_deposit() {
        let mut commit = make_valid_commit();
        commit.deposit_ckb = 50_000_000; // 0.5 CKB
        let data = commit.serialize();
        let type_args = make_type_args();

        let result = verify_commit_type(true, &data, &type_args, None, None, 100_000_000);
        assert_eq!(result, Err(CommitTypeError::InsufficientDeposit));
    }

    #[test]
    fn test_zero_token_amount() {
        let mut commit = make_valid_commit();
        commit.token_amount = 0;
        let data = commit.serialize();
        let type_args = make_type_args();

        let result = verify_commit_type(true, &data, &type_args, None, None, 0);
        assert_eq!(result, Err(CommitTypeError::ZeroTokenAmount));
    }

    #[test]
    fn test_lock_hash_mismatch() {
        let commit = make_valid_commit();
        let data = commit.serialize();
        let wrong_lock = [0xDD; 32];
        let type_args = make_type_args();

        let result = verify_commit_type(true, &data, &type_args, Some(&wrong_lock), None, 0);
        assert_eq!(result, Err(CommitTypeError::LockHashMismatch));
    }

    #[test]
    fn test_batch_id_mismatch() {
        let commit = make_valid_commit(); // batch_id = 1
        let data = commit.serialize();

        let auction = AuctionCellData {
            phase: PHASE_COMMIT,
            batch_id: 2, // Different batch
            ..Default::default()
        };
        let auction_data = auction.serialize().to_vec();
        let type_args = make_type_args();

        let result = verify_commit_type(true, &data, &type_args, None, Some(&auction_data), 0);
        assert_eq!(result, Err(CommitTypeError::BatchIdMismatch));
    }

    #[test]
    fn test_wrong_phase() {
        let commit = make_valid_commit();
        let data = commit.serialize();

        let auction = AuctionCellData {
            phase: PHASE_REVEAL,
            batch_id: 1,
            ..Default::default()
        };
        let auction_data = auction.serialize().to_vec();
        let type_args = make_type_args();

        let result = verify_commit_type(true, &data, &type_args, None, Some(&auction_data), 0);
        assert_eq!(result, Err(CommitTypeError::WrongPhase));
    }

    #[test]
    fn test_consumption_requires_auction() {
        let commit = make_valid_commit();
        let data = commit.serialize();
        let type_args = make_type_args();

        let result = verify_commit_type(false, &data, &type_args, None, None, 0);
        assert_eq!(result, Err(CommitTypeError::NoAuctionCellInTx));
    }

    #[test]
    fn test_consumption_with_auction_ok() {
        let commit = make_valid_commit();
        let data = commit.serialize();
        let auction_data = make_auction_in_commit_phase();
        let type_args = make_type_args();

        let result = verify_commit_type(false, &data, &type_args, None, Some(&auction_data), 0);
        assert!(result.is_ok());
    }
}
