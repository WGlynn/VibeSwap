// ============ Commit Type Script — CKB-VM Entry Point ============
// The library logic lives in lib.rs; this binary is compiled for RISC-V.

fn main() {
    println!("Commit Type Script — compile with RISC-V target for CKB-VM");
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
        let wrong_lock = [0xDD; 32]; // Doesn't match sender_lock_hash
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
            phase: PHASE_REVEAL, // Not commit phase
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
