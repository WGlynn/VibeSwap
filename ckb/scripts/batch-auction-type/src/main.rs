// ============ Batch Auction Type Script — CKB-VM Entry Point ============
// The library logic lives in lib.rs; this binary is compiled for RISC-V.

fn main() {
    println!("Batch Auction Type Script — compile with RISC-V target for CKB-VM");
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use batch_auction_type::*;
    use vibeswap_types::*;

    fn default_config() -> ConfigCellData {
        ConfigCellData::default()
    }

    fn make_initial_auction(pair_id: [u8; 32]) -> AuctionCellData {
        AuctionCellData {
            phase: PHASE_COMMIT,
            batch_id: 0,
            pair_id,
            ..Default::default()
        }
    }

    #[test]
    fn test_valid_creation() {
        let state = make_initial_auction([0x01; 32]);
        let data = state.serialize();
        let config = default_config();

        let result = verify_batch_auction_type(
            None, &data, &[], &[], None, &config, 0, None, 0,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_creation_wrong_phase() {
        let mut state = make_initial_auction([0x01; 32]);
        state.phase = PHASE_REVEAL;
        let data = state.serialize();
        let config = default_config();

        let result = verify_batch_auction_type(
            None, &data, &[], &[], None, &config, 0, None, 0,
        );
        assert_eq!(result, Err(AuctionTypeError::InvalidInitialPhase));
    }

    #[test]
    fn test_commit_aggregation() {
        let pair_id = [0x01; 32];
        let old = make_initial_auction(pair_id);
        let old_data = old.serialize();

        let commits = vec![
            CommitCellData {
                order_hash: [0xAA; 32],
                batch_id: 0,
                deposit_ckb: 100_000_000,
                token_type_hash: [0x02; 32],
                token_amount: PRECISION,
                block_number: 10,
                sender_lock_hash: [0xCC; 32],
            },
            CommitCellData {
                order_hash: [0xBB; 32],
                batch_id: 0,
                deposit_ckb: 100_000_000,
                token_type_hash: [0x02; 32],
                token_amount: PRECISION,
                block_number: 11,
                sender_lock_hash: [0xDD; 32],
            },
        ];

        let mut new = old.clone();
        new.commit_count = 2;
        new.prev_state_hash = compute_state_hash(&old);
        let new_data = new.serialize();

        let config = default_config();
        let result = verify_batch_auction_type(
            Some(&old_data), &new_data, &commits, &[], None, &config, 5, None, 2,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_commit_to_reveal_transition() {
        let pair_id = [0x01; 32];
        let mut old = make_initial_auction(pair_id);
        old.commit_count = 5;
        old.phase_start_block = 0;
        let old_data = old.serialize();

        let mut new = old.clone();
        new.phase = PHASE_REVEAL;
        new.reveal_count = 0;
        new.phase_start_block = 50;
        new.prev_state_hash = compute_state_hash(&old);
        let new_data = new.serialize();

        let config = default_config();
        let result = verify_batch_auction_type(
            Some(&old_data), &new_data, &[], &[], None, &config, 50, None, 0,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_new_batch() {
        let pair_id = [0x01; 32];
        let old = AuctionCellData {
            phase: PHASE_SETTLED,
            batch_id: 0,
            pair_id,
            commit_count: 5,
            reveal_count: 4,
            clearing_price: 2000 * PRECISION,
            ..Default::default()
        };
        let old_data = old.serialize();

        let new = AuctionCellData {
            phase: PHASE_COMMIT,
            batch_id: 1,
            pair_id,
            phase_start_block: 200,
            prev_state_hash: compute_state_hash(&old),
            ..Default::default()
        };
        let new_data = new.serialize();

        let config = default_config();
        let result = verify_batch_auction_type(
            Some(&old_data), &new_data, &[], &[], None, &config, 200, None, 0,
        );
        assert!(result.is_ok());
    }
}
