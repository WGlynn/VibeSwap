// ============ Batch Auction Type Script — CKB-VM Entry Point ============
// Core type script for VibeSwap's commit-reveal batch auction on CKB.
// Validates all state transitions of the auction cell.

#![cfg_attr(feature = "ckb", no_std)]
#![cfg_attr(feature = "ckb", no_main)]

#[cfg(feature = "ckb")]
ckb_std::default_alloc!();

#[cfg(feature = "ckb")]
ckb_std::entry!(program);

// ============ CKB-VM Entry Point ============

#[cfg(feature = "ckb")]
fn program() -> i8 {
    use alloc::vec::Vec;
    use ckb_std::ckb_constants::Source;
    use ckb_std::high_level::{load_cell_data, load_script};
    use batch_auction_type::verify_batch_auction_type;
    use vibeswap_types::*;

    let _script = match load_script() {
        Ok(s) => s,
        Err(_) => return -1,
    };

    // Determine creation vs transition by checking GroupInput
    let old_data = load_cell_data(0, Source::GroupInput).ok();
    let is_creation = old_data.is_none();

    // Load new cell data from GroupOutput
    let new_data = match load_cell_data(0, Source::GroupOutput) {
        Ok(d) => d,
        Err(_) => return -2,
    };

    // Load config cell from cell_deps (first cell_dep by convention)
    let config = match load_cell_data(0, Source::CellDep) {
        Ok(d) => match ConfigCellData::deserialize(&d) {
            Some(c) => c,
            None => return -3,
        },
        Err(_) => ConfigCellData::default(),
    };

    // Load compliance cell from cell_deps (second cell_dep if present)
    let compliance = load_cell_data(1, Source::CellDep)
        .ok()
        .and_then(|d| ComplianceCellData::deserialize(&d));

    // Collect commit cells from inputs (non-group inputs with commit type)
    // In CKB, commit cells are consumed alongside the auction cell
    let commit_cells: Vec<CommitCellData> = {
        let mut commits = Vec::new();
        let mut i = 0;
        loop {
            match load_cell_data(i, Source::Input) {
                Ok(data) => {
                    if let Some(commit) = CommitCellData::deserialize(&data) {
                        commits.push(commit);
                    }
                    i += 1;
                }
                Err(_) => break,
            }
        }
        commits
    };

    // Verify state transition
    match verify_batch_auction_type(
        if is_creation { None } else { old_data.as_deref() },
        &new_data,
        &commit_cells,
        &[], // reveal_witnesses loaded separately in reveal phase
        compliance.as_ref(),
        &config,
        0,    // block_number — from header_deps in production
        None, // block_entropy
        commit_cells.len() as u32,
    ) {
        Ok(()) => 0,
        Err(_) => -10,
    }
}

// ============ Native Entry Point ============

#[cfg(not(feature = "ckb"))]
fn main() {
    println!("Batch Auction Type Script — compile with --features ckb for CKB-VM");
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
