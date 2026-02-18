// ============ Commit Type Script ============
// CKB type script for commit cell validation
//
// Validates:
// 1. CREATION: When a new commit cell is created
//    - order_hash is non-zero (well-formed commitment)
//    - batch_id matches current auction batch
//    - deposit meets minimum requirement
//    - token_amount > 0
//    - sender_lock_hash matches the input cell's lock hash
//
// 2. CONSUMPTION: When a commit cell is consumed
//    - Can only be consumed in a transaction that also consumes/creates an auction cell
//    - This enforces that commits are aggregated properly
//
// No contention: Each user creates their own commit cells independently

use vibeswap_types::{CommitCellData, AuctionCellData, PHASE_COMMIT};

// ============ Script Entry Point ============

/// Validate commit cell creation or consumption
pub fn verify_commit_type(
    is_creation: bool,
    cell_data: &[u8],
    type_args: &[u8],      // Contains pair_id + batch_id
    input_lock_hash: Option<&[u8; 32]>,
    auction_cell_data: Option<&[u8]>,
    min_deposit: u64,
) -> Result<(), CommitTypeError> {
    let commit = CommitCellData::deserialize(cell_data)
        .ok_or(CommitTypeError::InvalidCellData)?;

    if is_creation {
        validate_creation(&commit, type_args, input_lock_hash, auction_cell_data, min_deposit)
    } else {
        validate_consumption(&commit, auction_cell_data)
    }
}

// ============ Creation Validation ============

fn validate_creation(
    commit: &CommitCellData,
    type_args: &[u8],
    input_lock_hash: Option<&[u8; 32]>,
    auction_cell_data: Option<&[u8]>,
    min_deposit: u64,
) -> Result<(), CommitTypeError> {
    // 1. Order hash must be non-zero
    if commit.order_hash == [0u8; 32] {
        return Err(CommitTypeError::ZeroOrderHash);
    }

    // 2. Verify deposit meets minimum
    if commit.deposit_ckb < min_deposit {
        return Err(CommitTypeError::InsufficientDeposit);
    }

    // 3. Token amount must be positive
    if commit.token_amount == 0 {
        return Err(CommitTypeError::ZeroTokenAmount);
    }

    // 4. Verify sender lock hash matches input
    if let Some(lock_hash) = input_lock_hash {
        if commit.sender_lock_hash != *lock_hash {
            return Err(CommitTypeError::LockHashMismatch);
        }
    }

    // 5. If auction cell is available, verify batch_id and phase
    if let Some(auction_data) = auction_cell_data {
        if let Some(auction) = AuctionCellData::deserialize(auction_data) {
            // Batch ID must match
            if commit.batch_id != auction.batch_id {
                return Err(CommitTypeError::BatchIdMismatch);
            }
            // Auction must be in commit phase
            if auction.phase != PHASE_COMMIT {
                return Err(CommitTypeError::WrongPhase);
            }
        }
    }

    // 6. Verify type args contain valid pair_id
    if type_args.len() < 32 {
        return Err(CommitTypeError::InvalidTypeArgs);
    }

    Ok(())
}

// ============ Consumption Validation ============

fn validate_consumption(
    _commit: &CommitCellData,
    auction_cell_data: Option<&[u8]>,
) -> Result<(), CommitTypeError> {
    // Commit cells can only be consumed in a transaction that
    // also transitions an auction cell (aggregation transaction)
    //
    // This is enforced by checking that an auction cell exists
    // in the transaction's inputs or outputs
    if auction_cell_data.is_none() {
        return Err(CommitTypeError::NoAuctionCellInTx);
    }

    // The auction type script handles the rest of the validation
    // (forced inclusion, MMR accumulation, etc.)
    Ok(())
}

// ============ Error Types ============

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CommitTypeError {
    InvalidCellData,
    ZeroOrderHash,
    InsufficientDeposit,
    ZeroTokenAmount,
    LockHashMismatch,
    BatchIdMismatch,
    WrongPhase,
    InvalidTypeArgs,
    NoAuctionCellInTx,
}
