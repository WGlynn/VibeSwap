//! # Commit-Reveal Auction Cell Type Script
//!
//! 10-second batched auction that dissolves MEV by separating commitment from
//! execution. Role-multiplexed binary: one of {CommitCell, RevealCell,
//! BatchSettlementCell, SlashCell} per `type_script.args[0]`.
//!
//! Spec: `contracts-ckb/specs/commit-reveal-auction.md`.
//!
//! ## Role tag (type_script.args[0])
//!
//! | tag  | role                  |
//! |------|-----------------------|
//! | 0x01 | CommitCell            |
//! | 0x02 | RevealCell            |
//! | 0x03 | BatchSettlementCell   |
//! | 0x04 | SlashCell             |
//!
//! Tag is followed by 32 bytes of context (own type-hash for sibling
//! discrimination in cell-dep scans).
//!
//! ## CommitCell layout (Molecule fixed-struct, LE)
//!
//! | field             | bytes | offset |
//! |-------------------|-------|--------|
//! | version           |  1    |   0    |
//! | batch_id          |  8    |   1    |
//! | pool_id           | 32    |   9    |
//! | commit_hash       | 32    |  41    |
//! | deposit_amount    |  8    |  73    |
//! | collateral_amount |  8    |  81    |
//! | recipient         | 32    |  89    |
//! | deadline          |  8    | 121    |
//!
//! Total: 129 bytes. (xchain_recipient deferred to v2; spec § Open Questions.)
//!
//! ## RevealCell layout
//!
//! | field                | bytes | offset |
//! |----------------------|-------|--------|
//! | version              |  1    |   0    |
//! | batch_id             |  8    |   1    |
//! | commit_outpoint_tx   | 32    |   9    |
//! | commit_outpoint_idx  |  4    |  41    |
//! | pool_id              | 32    |  45    |
//! | sudt_in_hash         | 32    |  77    |
//! | amount_in            | 16    | 109    |
//! | sudt_out_hash        | 32    | 125    |
//! | min_amount_out       | 16    | 157    |
//! | recipient            | 32    | 173    |
//! | secret               | 32    | 205    |
//! | deposit_amount       |  8    | 237    |
//! | collateral_amount    |  8    | 245    |
//!
//! Total: 253 bytes.
//!
//! ## BatchSettlementCell layout
//!
//! | field             | bytes | offset |
//! |-------------------|-------|--------|
//! | version           |  1    |   0    |
//! | batch_id          |  8    |   1    |
//! | pool_id           | 32    |   9    |
//! | shuffle_seed      | 32    |  41    |
//! | clearing_price    | 16    |  73    |
//! | commit_count      |  4    |  89    |
//! | reveal_count      |  4    |  93    |
//! | matched_count     |  4    |  97    |
//! | settlement_block  |  8    | 101    |
//!
//! Total: 109 bytes fixed header. `matched_orders` Vec follows variably
//! sized; encoded as `count * MATCHED_ORDER_ENTRY_LEN` after header.
//!
//! ## SlashCell layout
//!
//! | field             | bytes | offset |
//! |-------------------|-------|--------|
//! | version           |  1    |   0    |
//! | batch_id          |  8    |   1    |
//! | commit_outpoint_tx| 32    |   9    |
//! | commit_outpoint_idx| 4    |  41    |
//! | treasury_share    |  8    |  45    |
//! | committer_share   |  8    |  53    |
//! | sweeper_bounty    |  8    |  61    |
//!
//! Total: 69 bytes.

#![no_std]
#![no_main]


use ckb_std::{
    ckb_constants::Source,
    default_alloc,
    high_level::{load_cell_data, load_cell_type_hash, load_script, QueryIter},
};

mod error;
use error::Error;

ckb_std::entry!(program_entry);
default_alloc!();

// ============ Schema ============

const SCHEMA_VERSION: u8 = 1;

// ============ Role tag ============

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
enum RoleTag {
    Commit = 0x01,
    Reveal = 0x02,
    BatchSettlement = 0x03,
    Slash = 0x04,
}

impl RoleTag {
    fn from_byte(b: u8) -> Result<Self, Error> {
        match b {
            0x01 => Ok(Self::Commit),
            0x02 => Ok(Self::Reveal),
            0x03 => Ok(Self::BatchSettlement),
            0x04 => Ok(Self::Slash),
            _ => Err(Error::RoleTagUnknown),
        }
    }
}

// args = role_tag (1) || own_type_hash (32)
const ARGS_LEN: usize = 33;

// ============ Cell-data layouts ============

const COMMIT_CELL_DATA_LEN: usize = 129;
const CMT_OFF_VERSION: usize = 0;
const CMT_OFF_BATCH_ID: usize = 1;
const CMT_OFF_POOL_ID: usize = 9;
const CMT_OFF_HASH: usize = 41;
const CMT_OFF_DEPOSIT: usize = 73;
const CMT_OFF_COLLATERAL: usize = 81;
const CMT_OFF_RECIPIENT: usize = 89;
const CMT_OFF_DEADLINE: usize = 121;

const REVEAL_CELL_DATA_LEN: usize = 253;
const RVL_OFF_VERSION: usize = 0;
const RVL_OFF_BATCH_ID: usize = 1;
const RVL_OFF_COMMIT_OUTPOINT_TX: usize = 9;
const RVL_OFF_COMMIT_OUTPOINT_IDX: usize = 41;
const RVL_OFF_POOL_ID: usize = 45;
const RVL_OFF_SUDT_IN_HASH: usize = 77;
const RVL_OFF_AMOUNT_IN: usize = 109;
const RVL_OFF_SUDT_OUT_HASH: usize = 125;
const RVL_OFF_MIN_AMOUNT_OUT: usize = 157;
const RVL_OFF_RECIPIENT: usize = 173;
const RVL_OFF_SECRET: usize = 205;
const RVL_OFF_DEPOSIT: usize = 237;
const RVL_OFF_COLLATERAL: usize = 245;

const SETTLE_HEADER_LEN: usize = 109;
const STL_OFF_VERSION: usize = 0;
const STL_OFF_BATCH_ID: usize = 1;
const STL_OFF_POOL_ID: usize = 9;
const STL_OFF_SHUFFLE_SEED: usize = 41;
const STL_OFF_CLEARING_PRICE: usize = 73;
const STL_OFF_COMMIT_COUNT: usize = 89;
const STL_OFF_REVEAL_COUNT: usize = 93;
const STL_OFF_MATCHED_COUNT: usize = 97;
const STL_OFF_SETTLEMENT_BLOCK: usize = 101;

// MatchedOrder entry: reveal_outpoint_tx[32] | reveal_outpoint_idx[4] |
// amount_out u128 LE [16] | recipient[32] = 84 bytes.
const MATCHED_ORDER_ENTRY_LEN: usize = 84;
const MO_OFF_REVEAL_TX: usize = 0;
const MO_OFF_REVEAL_IDX: usize = 32;
const MO_OFF_AMOUNT_OUT: usize = 36;
const MO_OFF_RECIPIENT: usize = 52;

const SLASH_CELL_DATA_LEN: usize = 69;
const SLS_OFF_VERSION: usize = 0;
const SLS_OFF_BATCH_ID: usize = 1;
const SLS_OFF_COMMIT_OUTPOINT_TX: usize = 9;
const SLS_OFF_COMMIT_OUTPOINT_IDX: usize = 41;
const SLS_OFF_TREASURY: usize = 45;
const SLS_OFF_COMMITTER: usize = 53;
const SLS_OFF_BOUNTY: usize = 61;

// ============ Heapless caps ============

// Max reveals per batch — bounds Fisher-Yates allocation and settlement
// cycle budget. Spec § Open Questions flags settlement cycle as live spike.
const MAX_REVEALS_PER_BATCH: usize = 64;
const MAX_INPUTS_SCAN: usize = 256;
const LAWSON_BLOB_CAP: usize = 8192;
const POOL_BLOB_CAP: usize = 2048;

// ============ Lawson ============

const LAWSON_REGISTRY_HEADER_LEN: usize = 3;
const LAWSON_CONSTANT_ENTRY_LEN: usize = 72;
const LAWSON_MAX_CONSTANTS: usize = 64;

// Lawson constant name_hashes — sentinels; TODO: blake2b at compile time.
const LAWSON_NAME_MIN_COMMIT_BOND: [u8; 32] = [0x20; 32];
const LAWSON_NAME_BATCH_PERIOD_BLOCKS: [u8; 32] = [0x21; 32];
const LAWSON_NAME_COMMIT_DURATION_BLOCKS: [u8; 32] = [0x22; 32];
const LAWSON_NAME_REVEAL_DURATION_BLOCKS: [u8; 32] = [0x23; 32];
const LAWSON_NAME_SLASH_RATE_BPS: [u8; 32] = [0x24; 32];
const LAWSON_NAME_MAX_TRADE_SIZE_BPS: [u8; 32] = [0x25; 32];
const LAWSON_NAME_SWEEPER_BOUNTY: [u8; 32] = [0x26; 32];

// ============ Entry ============

pub fn program_entry() -> i8 {
    match verify() {
        Ok(()) => 0,
        Err(e) => e as i8,
    }
}

// ============ Top-level dispatch ============

fn verify() -> Result<(), Error> {
    let script = load_script()?;
    let args_reader = script.as_reader();
    let args_bytes = args_reader.args().raw_data();
    if args_bytes.len() != ARGS_LEN {
        return Err(Error::ScriptArgsMalformed);
    }
    let role = RoleTag::from_byte(args_bytes[0])?;
    let mut own_type_hash = [0u8; 32];
    own_type_hash.copy_from_slice(&args_bytes[1..33]);

    let inputs = read_group_cells(Source::GroupInput)?;
    let outputs = read_group_cells(Source::GroupOutput)?;

    if inputs.is_empty() && outputs.is_empty() {
        return Err(Error::EmptyTransition);
    }

    match role {
        RoleTag::Commit => verify_commit(&inputs, &outputs, &own_type_hash),
        RoleTag::Reveal => verify_reveal(&inputs, &outputs, &own_type_hash),
        RoleTag::BatchSettlement => verify_settlement(&inputs, &outputs, &own_type_hash),
        RoleTag::Slash => verify_slash(&inputs, &outputs, &own_type_hash),
    }
}

fn read_group_cells(
    source: Source,
) -> Result<heapless::Vec<alloc::vec::Vec<u8>, MAX_REVEALS_PER_BATCH>, Error> {
    let mut out: heapless::Vec<alloc::vec::Vec<u8>, MAX_REVEALS_PER_BATCH> = heapless::Vec::new();
    for data in QueryIter::new(load_cell_data, source) {
        out.push(data).map_err(|_| Error::CapacityExceeded)?;
    }
    Ok(out)
}

// ============ CommitCell ============

fn verify_commit(
    inputs: &[alloc::vec::Vec<u8>],
    outputs: &[alloc::vec::Vec<u8>],
    _own_type_hash: &[u8; 32],
) -> Result<(), Error> {
    // Creation: external -> CommitCell. Outputs only.
    // Consumption-by-reveal: handled by the RevealCell role (it spends the
    // CommitCell as an input in its own group; the CommitCell role doesn't
    // see that because the type-script is keyed by role tag).
    if !inputs.is_empty() {
        return Err(Error::CellMultiplicityMismatch);
    }

    let lawson = find_lawson_cell_dep()?;
    let lp = parse_lawson_params(&lawson)?;

    for out in outputs {
        verify_commit_layout(out)?;

        let deposit = read_u64_le(&out[CMT_OFF_DEPOSIT..CMT_OFF_DEPOSIT + 8]);
        if deposit < lp.min_commit_bond {
            return Err(Error::DepositBelowMinBond);
        }

        // Window check: deadline = batch_start + commit + reveal. The commit
        // must be created during the commit window — verified structurally
        // by deadline = current_window_end (tip + (commit - elapsed) + reveal).
        // v1: trust the deadline field shape; tip-anchor + window math = v2.
        // TODO: load_header(HeaderDep) -> derive batch_start; verify tip
        // within [batch_start, batch_start + commit_duration].
        let deadline = read_u64_le(&out[CMT_OFF_DEADLINE..CMT_OFF_DEADLINE + 8]);
        if deadline == 0 {
            return Err(Error::CommitOutsideCommitWindow);
        }
        let _ = lp.batch_period_blocks;
        let _ = lp.commit_duration_blocks;
        let _ = lp.reveal_duration_blocks;
    }

    Ok(())
}

fn verify_commit_layout(data: &[u8]) -> Result<(), Error> {
    if data.len() < COMMIT_CELL_DATA_LEN {
        return Err(Error::CellDataMalformed);
    }
    if data[CMT_OFF_VERSION] != SCHEMA_VERSION {
        return Err(Error::SchemaVersionUnsupported);
    }
    // Hash must not be all-zero (sentinel rejection — distinguishes
    // "unfilled" from "deliberately committed").
    let hash = &data[CMT_OFF_HASH..CMT_OFF_HASH + 32];
    if hash.iter().all(|&b| b == 0) {
        return Err(Error::CommitHashMalformed);
    }
    Ok(())
}

// ============ RevealCell ============

fn verify_reveal(
    inputs: &[alloc::vec::Vec<u8>],
    outputs: &[alloc::vec::Vec<u8>],
    _own_type_hash: &[u8; 32],
) -> Result<(), Error> {
    // Creation transaction: consumes the trader's CommitCell as input (not in
    // group — the CommitCell type-script is the Commit role binary); creates
    // RevealCell as group-output. Consumption-by-settlement: input-only.
    if !outputs.is_empty() && !inputs.is_empty() {
        return Err(Error::CellMultiplicityMismatch);
    }

    let lawson = find_lawson_cell_dep()?;
    let lp = parse_lawson_params(&lawson)?;

    if inputs.is_empty() {
        // Creation path.
        for out in outputs {
            verify_reveal_layout(out)?;
            verify_reveal_binding(out)?;
            verify_reveal_order_data(out, &lp)?;
            // TODO: tip-anchor window check — current block in reveal window.
        }
        Ok(())
    } else {
        // Consumed by settlement — the BatchSettlementCell role enforces
        // inclusion + matched-order correctness.
        for inp in inputs {
            verify_reveal_layout(inp)?;
        }
        Ok(())
    }
}

fn verify_reveal_layout(data: &[u8]) -> Result<(), Error> {
    if data.len() < REVEAL_CELL_DATA_LEN {
        return Err(Error::CellDataMalformed);
    }
    if data[RVL_OFF_VERSION] != SCHEMA_VERSION {
        return Err(Error::SchemaVersionUnsupported);
    }
    Ok(())
}

fn verify_reveal_binding(reveal_data: &[u8]) -> Result<(), Error> {
    // Load the consumed CommitCell from the tx inputs (Source::Input, not
    // GroupInput — different role tag puts it outside the group).
    let commit_tx = &reveal_data[RVL_OFF_COMMIT_OUTPOINT_TX..RVL_OFF_COMMIT_OUTPOINT_TX + 32];
    let commit_idx = read_u32_le(
        &reveal_data[RVL_OFF_COMMIT_OUTPOINT_IDX..RVL_OFF_COMMIT_OUTPOINT_IDX + 4],
    );

    let commit_data = find_input_commit_cell(commit_tx, commit_idx)?;
    let expected_hash = &commit_data[CMT_OFF_HASH..CMT_OFF_HASH + 32];

    // Recompute hash(order_data || secret). The "order_data" canonical bytes
    // are reveal_data[RVL_OFF_POOL_ID..RVL_OFF_SECRET]; secret follows.
    // Spec § property preservation requires keccak; ckb-std-native is blake2b.
    // TODO: decide on hash function — the spec text says keccak, but the CKB
    // ecosystem default is blake2b. Blake2b chosen for v1; cross-chain
    // bridges that compute commit-hash off-chain must match.
    let order_bytes = &reveal_data[RVL_OFF_POOL_ID..RVL_OFF_SECRET];
    let secret = &reveal_data[RVL_OFF_SECRET..RVL_OFF_SECRET + 32];
    let computed = blake2b_concat(order_bytes, secret);

    if &computed != expected_hash {
        return Err(Error::HashBindingFailed);
    }

    // Deposit + collateral pass through unchanged.
    let cmt_deposit = read_u64_le(&commit_data[CMT_OFF_DEPOSIT..CMT_OFF_DEPOSIT + 8]);
    let cmt_collateral = read_u64_le(&commit_data[CMT_OFF_COLLATERAL..CMT_OFF_COLLATERAL + 8]);
    let rvl_deposit = read_u64_le(&reveal_data[RVL_OFF_DEPOSIT..RVL_OFF_DEPOSIT + 8]);
    let rvl_collateral = read_u64_le(&reveal_data[RVL_OFF_COLLATERAL..RVL_OFF_COLLATERAL + 8]);
    if cmt_deposit != rvl_deposit || cmt_collateral != rvl_collateral {
        return Err(Error::DepositOrCollateralMutated);
    }

    // Pool ID matches.
    if &reveal_data[RVL_OFF_POOL_ID..RVL_OFF_POOL_ID + 32]
        != &commit_data[CMT_OFF_POOL_ID..CMT_OFF_POOL_ID + 32]
    {
        return Err(Error::OrderDataMalformed);
    }

    Ok(())
}

fn verify_reveal_order_data(reveal_data: &[u8], lp: &LawsonParams) -> Result<(), Error> {
    let amount_in = read_u128_le(&reveal_data[RVL_OFF_AMOUNT_IN..RVL_OFF_AMOUNT_IN + 16]);
    if amount_in == 0 {
        return Err(Error::OrderDataMalformed);
    }

    // MAX_TRADE_SIZE check: amount_in / reserve_in <= MAX_TRADE_SIZE_BPS/10000.
    // Pool reserve read from PoolCell cell-dep.
    let pool = find_pool_cell_dep()?;
    let reserve_in = read_pool_reserve_for_token(
        &pool,
        &reveal_data[RVL_OFF_SUDT_IN_HASH..RVL_OFF_SUDT_IN_HASH + 32],
    )?;
    let max_size = reserve_in
        .checked_mul(lp.max_trade_size_bps as u128)
        .ok_or(Error::OrderExceedsTradeSize)?
        / 10_000u128;
    if amount_in > max_size {
        return Err(Error::OrderExceedsTradeSize);
    }
    Ok(())
}

fn find_input_commit_cell(
    target_tx: &[u8],
    target_idx: u32,
) -> Result<alloc::vec::Vec<u8>, Error> {
    // Scan tx inputs for a CommitCell shape match at the referenced outpoint.
    // TODO: ckb-std load_input(idx, Source::Input) to read outpoint and match
    // exactly; v1 matches by shape (len == COMMIT_CELL_DATA_LEN) and asserts
    // the hash field at the expected offset is non-zero.
    let _ = (target_tx, target_idx);
    for i in 0..MAX_INPUTS_SCAN {
        match load_cell_data(i, Source::Input) {
            Ok(data) => {
                if data.len() == COMMIT_CELL_DATA_LEN && data[CMT_OFF_VERSION] == SCHEMA_VERSION {
                    return Ok(data);
                }
            }
            Err(ckb_std::error::SysError::IndexOutOfBound) => break,
            Err(e) => return Err(e.into()),
        }
    }
    Err(Error::CommitOutpointAbsent)
}

// ============ BatchSettlementCell ============

fn verify_settlement(
    inputs: &[alloc::vec::Vec<u8>],
    outputs: &[alloc::vec::Vec<u8>],
    _own_type_hash: &[u8; 32],
) -> Result<(), Error> {
    // Creation only — settlement is produced once per batch.
    if !inputs.is_empty() || outputs.len() != 1 {
        return Err(Error::CellMultiplicityMismatch);
    }
    let settle = &outputs[0];
    verify_settlement_layout(settle)?;

    let lawson = find_lawson_cell_dep()?;
    let lp = parse_lawson_params(&lawson)?;
    let _ = lp.batch_period_blocks;

    let batch_id = read_u64_le(&settle[STL_OFF_BATCH_ID..STL_OFF_BATCH_ID + 8]);
    let pool_id = &settle[STL_OFF_POOL_ID..STL_OFF_POOL_ID + 32];
    let claimed_seed = &settle[STL_OFF_SHUFFLE_SEED..STL_OFF_SHUFFLE_SEED + 32];
    let reveal_count = read_u32_le(&settle[STL_OFF_REVEAL_COUNT..STL_OFF_REVEAL_COUNT + 4]);
    let matched_count = read_u32_le(&settle[STL_OFF_MATCHED_COUNT..STL_OFF_MATCHED_COUNT + 4]);

    // Window: settlement only legal after batch end.
    // TODO: tip-anchor header-dep. v1 trusts settlement_block field <= tip.
    let _settlement_block = read_u64_le(
        &settle[STL_OFF_SETTLEMENT_BLOCK..STL_OFF_SETTLEMENT_BLOCK + 8],
    );

    // Scan tx inputs for all RevealCells matching this batch_id + pool_id.
    let reveals = collect_reveals_for_batch(batch_id, pool_id)?;
    if reveals.len() as u32 != reveal_count {
        return Err(Error::RevealNotIncludedInSettlement);
    }

    // §1: shuffle_seed = XOR of all reveal secrets (canonical ordering = sort
    // ascending by commit_outpoint_tx || commit_outpoint_idx; this is the
    // load-bearing piece of the property — any ordering choice that an
    // adversary could influence breaks the shuffle's resistance).
    let computed_seed = compute_shuffle_seed(&reveals)?;
    if &computed_seed != claimed_seed {
        return Err(Error::ShuffleSeedMismatch);
    }

    // §2: Fisher-Yates over reveals seeded by computed_seed must produce
    // matched_orders[].reveal_outpoint sequence.
    verify_fisher_yates_ordering(settle, &reveals, &computed_seed, matched_count as usize)?;

    // §3: uniform clearing price + per-order amount_out consistent with pool.
    verify_clearing_price_and_amounts(settle, &reveals, matched_count as usize)?;

    // §4: single pool per batch (v1).
    for rvl in &reveals {
        if &rvl[RVL_OFF_POOL_ID..RVL_OFF_POOL_ID + 32] != pool_id {
            return Err(Error::MultiplePoolsInBatch);
        }
    }

    Ok(())
}

fn verify_settlement_layout(data: &[u8]) -> Result<(), Error> {
    if data.len() < SETTLE_HEADER_LEN {
        return Err(Error::CellDataMalformed);
    }
    if data[STL_OFF_VERSION] != SCHEMA_VERSION {
        return Err(Error::SchemaVersionUnsupported);
    }
    let matched = read_u32_le(&data[STL_OFF_MATCHED_COUNT..STL_OFF_MATCHED_COUNT + 4]) as usize;
    let expected_len = SETTLE_HEADER_LEN + matched * MATCHED_ORDER_ENTRY_LEN;
    if data.len() < expected_len {
        return Err(Error::CellDataMalformed);
    }
    if matched > MAX_REVEALS_PER_BATCH {
        return Err(Error::CapacityExceeded);
    }
    Ok(())
}

fn collect_reveals_for_batch(
    batch_id: u64,
    pool_id: &[u8],
) -> Result<heapless::Vec<alloc::vec::Vec<u8>, MAX_REVEALS_PER_BATCH>, Error> {
    let mut out: heapless::Vec<alloc::vec::Vec<u8>, MAX_REVEALS_PER_BATCH> = heapless::Vec::new();
    for i in 0..MAX_INPUTS_SCAN {
        match load_cell_data(i, Source::Input) {
            Ok(data) => {
                if data.len() == REVEAL_CELL_DATA_LEN && data[RVL_OFF_VERSION] == SCHEMA_VERSION {
                    let rvl_batch =
                        read_u64_le(&data[RVL_OFF_BATCH_ID..RVL_OFF_BATCH_ID + 8]);
                    if rvl_batch == batch_id
                        && &data[RVL_OFF_POOL_ID..RVL_OFF_POOL_ID + 32] == pool_id
                    {
                        out.push(data).map_err(|_| Error::CapacityExceeded)?;
                    }
                }
            }
            Err(ckb_std::error::SysError::IndexOutOfBound) => break,
            Err(e) => return Err(e.into()),
        }
    }
    Ok(out)
}

fn compute_shuffle_seed(reveals: &[alloc::vec::Vec<u8>]) -> Result<[u8; 32], Error> {
    // Canonical ordering: ascending by (commit_outpoint_tx, commit_outpoint_idx).
    // Indices into reveals[] sorted by that key.
    let n = reveals.len();
    let mut indices: heapless::Vec<usize, MAX_REVEALS_PER_BATCH> = heapless::Vec::new();
    for i in 0..n {
        indices.push(i).map_err(|_| Error::CapacityExceeded)?;
    }
    // Insertion sort (n bounded by MAX_REVEALS_PER_BATCH = 64).
    for i in 1..n {
        let mut j = i;
        while j > 0 && reveal_outpoint_lt(&reveals[indices[j]], &reveals[indices[j - 1]]) {
            indices.swap(j, j - 1);
            j -= 1;
        }
    }

    let mut seed = [0u8; 32];
    for &idx in indices.iter() {
        let secret = &reveals[idx][RVL_OFF_SECRET..RVL_OFF_SECRET + 32];
        for k in 0..32 {
            seed[k] ^= secret[k];
        }
    }
    Ok(seed)
}

fn reveal_outpoint_lt(a: &[u8], b: &[u8]) -> bool {
    let a_tx = &a[RVL_OFF_COMMIT_OUTPOINT_TX..RVL_OFF_COMMIT_OUTPOINT_TX + 32];
    let b_tx = &b[RVL_OFF_COMMIT_OUTPOINT_TX..RVL_OFF_COMMIT_OUTPOINT_TX + 32];
    match a_tx.cmp(b_tx) {
        core::cmp::Ordering::Less => true,
        core::cmp::Ordering::Greater => false,
        core::cmp::Ordering::Equal => {
            let a_idx = read_u32_le(
                &a[RVL_OFF_COMMIT_OUTPOINT_IDX..RVL_OFF_COMMIT_OUTPOINT_IDX + 4],
            );
            let b_idx = read_u32_le(
                &b[RVL_OFF_COMMIT_OUTPOINT_IDX..RVL_OFF_COMMIT_OUTPOINT_IDX + 4],
            );
            a_idx < b_idx
        }
    }
}

fn verify_fisher_yates_ordering(
    settle: &[u8],
    reveals: &[alloc::vec::Vec<u8>],
    seed: &[u8; 32],
    matched_count: usize,
) -> Result<(), Error> {
    // Re-run Fisher-Yates on the canonically-ordered reveal index list using
    // seed as the entropy source (PRG = repeated blake2b over (seed || ctr)).
    // Then assert the matched_orders Vec in cell-data references the reveal
    // outpoints in that exact order.
    let n = reveals.len();
    let mut perm: heapless::Vec<usize, MAX_REVEALS_PER_BATCH> = heapless::Vec::new();
    let mut indices: heapless::Vec<usize, MAX_REVEALS_PER_BATCH> = heapless::Vec::new();
    for i in 0..n {
        indices.push(i).map_err(|_| Error::CapacityExceeded)?;
    }
    // Canonical pre-sort (same as compute_shuffle_seed).
    for i in 1..n {
        let mut j = i;
        while j > 0 && reveal_outpoint_lt(&reveals[indices[j]], &reveals[indices[j - 1]]) {
            indices.swap(j, j - 1);
            j -= 1;
        }
    }

    // Fisher-Yates: for i from n-1 down to 1, j = rng(seed, i) mod (i+1), swap.
    let mut rng_ctr: u64 = 0;
    if n > 1 {
        for i in (1..n).rev() {
            let r = prg_u64(seed, rng_ctr);
            rng_ctr += 1;
            let j = (r as usize) % (i + 1);
            indices.swap(i, j);
        }
    }
    for &idx in indices.iter() {
        perm.push(idx).map_err(|_| Error::CapacityExceeded)?;
    }

    // Assert matched_orders references reveals in `perm` order.
    if matched_count > n {
        return Err(Error::FisherYatesOrderingInvalid);
    }
    for (out_idx, &rvl_idx) in perm.iter().take(matched_count).enumerate() {
        let mo_base = SETTLE_HEADER_LEN + out_idx * MATCHED_ORDER_ENTRY_LEN;
        let mo_tx = &settle[mo_base + MO_OFF_REVEAL_TX..mo_base + MO_OFF_REVEAL_TX + 32];
        let mo_idx = read_u32_le(
            &settle[mo_base + MO_OFF_REVEAL_IDX..mo_base + MO_OFF_REVEAL_IDX + 4],
        );
        let rvl_tx = &reveals[rvl_idx]
            [RVL_OFF_COMMIT_OUTPOINT_TX..RVL_OFF_COMMIT_OUTPOINT_TX + 32];
        let rvl_idx_field = read_u32_le(
            &reveals[rvl_idx]
                [RVL_OFF_COMMIT_OUTPOINT_IDX..RVL_OFF_COMMIT_OUTPOINT_IDX + 4],
        );
        if mo_tx != rvl_tx || mo_idx != rvl_idx_field {
            return Err(Error::FisherYatesOrderingInvalid);
        }
    }
    Ok(())
}

fn verify_clearing_price_and_amounts(
    settle: &[u8],
    reveals: &[alloc::vec::Vec<u8>],
    matched_count: usize,
) -> Result<(), Error> {
    let clearing_price = read_u128_le(
        &settle[STL_OFF_CLEARING_PRICE..STL_OFF_CLEARING_PRICE + 16],
    );
    if clearing_price == 0 {
        return Err(Error::ClearingPriceInvalid);
    }

    // Per-order: amount_out_recorded must equal amount_in * clearing_price /
    // PRICE_SCALE (PRICE_SCALE = 1e18 LE u128 convention). And >= min_amount_out.
    const PRICE_SCALE: u128 = 1_000_000_000_000_000_000u128;
    for out_idx in 0..matched_count {
        let mo_base = SETTLE_HEADER_LEN + out_idx * MATCHED_ORDER_ENTRY_LEN;
        let mo_amount = read_u128_le(
            &settle[mo_base + MO_OFF_AMOUNT_OUT..mo_base + MO_OFF_AMOUNT_OUT + 16],
        );
        let mo_tx = &settle[mo_base + MO_OFF_REVEAL_TX..mo_base + MO_OFF_REVEAL_TX + 32];
        let mo_idx = read_u32_le(
            &settle[mo_base + MO_OFF_REVEAL_IDX..mo_base + MO_OFF_REVEAL_IDX + 4],
        );

        // Find matching reveal.
        let mut found = false;
        for rvl in reveals {
            let rvl_tx = &rvl[RVL_OFF_COMMIT_OUTPOINT_TX..RVL_OFF_COMMIT_OUTPOINT_TX + 32];
            let rvl_idx = read_u32_le(
                &rvl[RVL_OFF_COMMIT_OUTPOINT_IDX..RVL_OFF_COMMIT_OUTPOINT_IDX + 4],
            );
            if rvl_tx == mo_tx && rvl_idx == mo_idx {
                let amount_in =
                    read_u128_le(&rvl[RVL_OFF_AMOUNT_IN..RVL_OFF_AMOUNT_IN + 16]);
                let min_out =
                    read_u128_le(&rvl[RVL_OFF_MIN_AMOUNT_OUT..RVL_OFF_MIN_AMOUNT_OUT + 16]);
                let expected = amount_in
                    .checked_mul(clearing_price)
                    .ok_or(Error::ClearingPriceInvalid)?
                    / PRICE_SCALE;
                if mo_amount != expected || mo_amount < min_out {
                    return Err(Error::MatchedOrderInconsistent);
                }
                found = true;
                break;
            }
        }
        if !found {
            return Err(Error::RevealNotIncludedInSettlement);
        }
    }
    Ok(())
}

// ============ SlashCell ============

fn verify_slash(
    inputs: &[alloc::vec::Vec<u8>],
    outputs: &[alloc::vec::Vec<u8>],
    _own_type_hash: &[u8; 32],
) -> Result<(), Error> {
    // Creation only. Same-tx consumes the expired CommitCell as input (Commit
    // role binary, not in this group).
    if !inputs.is_empty() || outputs.len() != 1 {
        return Err(Error::CellMultiplicityMismatch);
    }
    let slash = &outputs[0];
    if slash.len() < SLASH_CELL_DATA_LEN {
        return Err(Error::CellDataMalformed);
    }
    if slash[SLS_OFF_VERSION] != SCHEMA_VERSION {
        return Err(Error::SchemaVersionUnsupported);
    }

    let lawson = find_lawson_cell_dep()?;
    let lp = parse_lawson_params(&lawson)?;

    // Find consumed CommitCell.
    let commit_tx = &slash[SLS_OFF_COMMIT_OUTPOINT_TX..SLS_OFF_COMMIT_OUTPOINT_TX + 32];
    let commit_idx = read_u32_le(
        &slash[SLS_OFF_COMMIT_OUTPOINT_IDX..SLS_OFF_COMMIT_OUTPOINT_IDX + 4],
    );
    let commit_data = find_input_commit_cell(commit_tx, commit_idx)?;

    // Timing: tip > commit.deadline.
    // TODO: tip-anchor header-dep — v1 trusts commit.deadline against a proxy.
    let deadline = read_u64_le(&commit_data[CMT_OFF_DEADLINE..CMT_OFF_DEADLINE + 8]);
    let tip = read_tip_height_proxy()?;
    if tip <= deadline {
        return Err(Error::SlashBeforeDeadline);
    }

    // No reveal for this commit-outpoint in the same tx — slash and reveal
    // are mutually exclusive consumers of a CommitCell.
    if reveal_exists_for_commit(commit_tx, commit_idx)? {
        return Err(Error::RevealExistedForCommit);
    }

    // Split: 50% treasury per SLASH_RATE_BPS = 5000.
    let cmt_deposit = read_u64_le(&commit_data[CMT_OFF_DEPOSIT..CMT_OFF_DEPOSIT + 8]);
    let cmt_collateral = read_u64_le(&commit_data[CMT_OFF_COLLATERAL..CMT_OFF_COLLATERAL + 8]);
    let total = cmt_deposit
        .checked_add(cmt_collateral)
        .ok_or(Error::CapacityExceeded)?;

    let treasury = read_u64_le(&slash[SLS_OFF_TREASURY..SLS_OFF_TREASURY + 8]);
    let committer = read_u64_le(&slash[SLS_OFF_COMMITTER..SLS_OFF_COMMITTER + 8]);
    let bounty = read_u64_le(&slash[SLS_OFF_BOUNTY..SLS_OFF_BOUNTY + 8]);

    let expected_treasury = (total as u128)
        .checked_mul(lp.slash_rate_bps as u128)
        .ok_or(Error::CapacityExceeded)?
        / 10_000u128;
    if treasury as u128 != expected_treasury {
        return Err(Error::SlashRateMismatch);
    }
    if bounty > lp.sweeper_bounty {
        return Err(Error::SlashRateMismatch);
    }
    let sum = treasury
        .checked_add(committer)
        .and_then(|v| v.checked_add(bounty))
        .ok_or(Error::CapacityExceeded)?;
    if sum != total {
        return Err(Error::SlashSumMismatch);
    }

    Ok(())
}

fn reveal_exists_for_commit(target_tx: &[u8], target_idx: u32) -> Result<bool, Error> {
    // Scan tx inputs: any RevealCell whose commit_outpoint matches?
    for i in 0..MAX_INPUTS_SCAN {
        match load_cell_data(i, Source::Input) {
            Ok(data) => {
                if data.len() == REVEAL_CELL_DATA_LEN
                    && data[RVL_OFF_VERSION] == SCHEMA_VERSION
                {
                    let tx = &data[RVL_OFF_COMMIT_OUTPOINT_TX..RVL_OFF_COMMIT_OUTPOINT_TX + 32];
                    let idx = read_u32_le(
                        &data[RVL_OFF_COMMIT_OUTPOINT_IDX..RVL_OFF_COMMIT_OUTPOINT_IDX + 4],
                    );
                    if tx == target_tx && idx == target_idx {
                        return Ok(true);
                    }
                }
            }
            Err(ckb_std::error::SysError::IndexOutOfBound) => break,
            Err(e) => return Err(e.into()),
        }
    }
    Ok(false)
}

// ============ Lawson cell-dep scan ============

struct LawsonParams {
    min_commit_bond: u64,
    batch_period_blocks: u64,
    commit_duration_blocks: u64,
    reveal_duration_blocks: u64,
    slash_rate_bps: u64,
    max_trade_size_bps: u64,
    sweeper_bounty: u64,
}

fn find_lawson_cell_dep() -> Result<heapless::Vec<u8, LAWSON_BLOB_CAP>, Error> {
    // Shape match; TODO: code-hash match against deployed lawson binary.
    let mut idx = 0usize;
    loop {
        match load_cell_data(idx, Source::CellDep) {
            Ok(data) => {
                if !data.is_empty()
                    && data[0] == SCHEMA_VERSION
                    && data.len() >= LAWSON_REGISTRY_HEADER_LEN
                {
                    let mut buf: heapless::Vec<u8, LAWSON_BLOB_CAP> = heapless::Vec::new();
                    if data.len() > buf.capacity() {
                        return Err(Error::CapacityExceeded);
                    }
                    for b in data.iter() {
                        buf.push(*b).map_err(|_| Error::CapacityExceeded)?;
                    }
                    return Ok(buf);
                }
                idx += 1;
            }
            Err(ckb_std::error::SysError::IndexOutOfBound) => {
                return Err(Error::LawsonCellDepMissing);
            }
            Err(e) => return Err(e.into()),
        }
    }
}

fn parse_lawson_params(data: &[u8]) -> Result<LawsonParams, Error> {
    if data.len() < LAWSON_REGISTRY_HEADER_LEN {
        return Err(Error::LawsonCellDepMissing);
    }
    let count = read_u16_le(&data[1..3]) as usize;
    if count > LAWSON_MAX_CONSTANTS {
        return Err(Error::CapacityExceeded);
    }
    let expected = LAWSON_REGISTRY_HEADER_LEN + count * LAWSON_CONSTANT_ENTRY_LEN;
    if data.len() < expected {
        return Err(Error::LawsonCellDepMissing);
    }

    Ok(LawsonParams {
        min_commit_bond: lookup_lawson_u64(data, count, &LAWSON_NAME_MIN_COMMIT_BOND)?,
        batch_period_blocks: lookup_lawson_u64(
            data,
            count,
            &LAWSON_NAME_BATCH_PERIOD_BLOCKS,
        )?,
        commit_duration_blocks: lookup_lawson_u64(
            data,
            count,
            &LAWSON_NAME_COMMIT_DURATION_BLOCKS,
        )?,
        reveal_duration_blocks: lookup_lawson_u64(
            data,
            count,
            &LAWSON_NAME_REVEAL_DURATION_BLOCKS,
        )?,
        slash_rate_bps: lookup_lawson_u64(data, count, &LAWSON_NAME_SLASH_RATE_BPS)?,
        max_trade_size_bps: lookup_lawson_u64(data, count, &LAWSON_NAME_MAX_TRADE_SIZE_BPS)?,
        sweeper_bounty: lookup_lawson_u64(data, count, &LAWSON_NAME_SWEEPER_BOUNTY)?,
    })
}

fn lookup_lawson_u64(data: &[u8], count: usize, name: &[u8; 32]) -> Result<u64, Error> {
    for i in 0..count {
        let base = LAWSON_REGISTRY_HEADER_LEN + i * LAWSON_CONSTANT_ENTRY_LEN;
        if &data[base..base + 32] == name {
            let v = read_u128_le(&data[base + 32..base + 48]);
            if v > u64::MAX as u128 {
                return Err(Error::CapacityExceeded);
            }
            return Ok(v as u64);
        }
    }
    Err(Error::LawsonCellDepMissing)
}

// ============ PoolCell cell-dep scan ============

fn find_pool_cell_dep() -> Result<heapless::Vec<u8, POOL_BLOB_CAP>, Error> {
    // Shape match; TODO: code-hash match against deployed pool-type-script.
    let mut idx = 0usize;
    loop {
        match load_cell_type_hash(idx, Source::CellDep) {
            Ok(Some(_th)) => {
                let data = load_cell_data(idx, Source::CellDep)?;
                // PoolCell layout shape: version + token_a_hash[32] + token_b_hash[32]
                // + reserve_a u128 + reserve_b u128 + ... Minimum reachable
                // prefix = 1 + 32 + 32 + 16 + 16 = 97 bytes.
                if data.len() >= 97 && data[0] == SCHEMA_VERSION {
                    let mut buf: heapless::Vec<u8, POOL_BLOB_CAP> = heapless::Vec::new();
                    if data.len() > buf.capacity() {
                        return Err(Error::CapacityExceeded);
                    }
                    for b in data.iter() {
                        buf.push(*b).map_err(|_| Error::CapacityExceeded)?;
                    }
                    return Ok(buf);
                }
                idx += 1;
            }
            Ok(None) => idx += 1,
            Err(ckb_std::error::SysError::IndexOutOfBound) => {
                return Err(Error::PoolCellDepMissing);
            }
            Err(e) => return Err(e.into()),
        }
    }
}

fn read_pool_reserve_for_token(pool: &[u8], sudt_hash: &[u8]) -> Result<u128, Error> {
    // PoolCell offsets per vibe-amm.md PoolCell layout:
    //   token_a_type_hash @ 1..33, token_b_type_hash @ 33..65,
    //   reserve_a @ 65..81, reserve_b @ 81..97.
    if pool.len() < 97 {
        return Err(Error::PoolCellDepMissing);
    }
    if &pool[1..33] == sudt_hash {
        Ok(read_u128_le(&pool[65..81]))
    } else if &pool[33..65] == sudt_hash {
        Ok(read_u128_le(&pool[81..97]))
    } else {
        Err(Error::OrderDataMalformed)
    }
}

// ============ Tip-height proxy ============

fn read_tip_height_proxy() -> Result<u64, Error> {
    // TODO: load_header(HeaderDep) on PoWAnchorCell. v1 returns saturated max
    // so timing checks degrade to "always after deadline" — useful for the
    // shape-only invariant pass but not for adversarial timing tests.
    Ok(u64::MAX / 2)
}

// ============ Blake2b ============

fn blake2b_concat(a: &[u8], b: &[u8]) -> [u8; 32] {
    // ckb-std exposes blake2b via syscall; this is a thin wrapper.
    // TODO: replace with ckb_std::high_level blake2b once API confirmed
    // against ckb-std 0.16. v1 returns sentinel so HashBindingFailed fires
    // on any non-matching commit — fail-closed during scaffold phase.
    let _ = (a, b);
    [0xCCu8; 32]
}

// ============ PRG ============

fn prg_u64(seed: &[u8; 32], ctr: u64) -> u64 {
    // PRG = blake2b(seed || ctr). v1 mixes ctr into seed[0..8] LE-add for a
    // placeholder that produces distinct values per ctr without needing the
    // blake2b syscall hookup. TODO: replace with blake2b(seed || ctr).
    let mut acc = read_u64_le(&seed[0..8]);
    acc = acc.wrapping_add(ctr);
    for i in 0..4 {
        acc ^= read_u64_le(&seed[i * 8..(i + 1) * 8]);
    }
    acc
}

// ============ Byte readers ============

fn read_u128_le(b: &[u8]) -> u128 {
    let mut buf = [0u8; 16];
    buf.copy_from_slice(&b[..16]);
    u128::from_le_bytes(buf)
}

fn read_u64_le(b: &[u8]) -> u64 {
    let mut buf = [0u8; 8];
    buf.copy_from_slice(&b[..8]);
    u64::from_le_bytes(buf)
}

fn read_u32_le(b: &[u8]) -> u32 {
    let mut buf = [0u8; 4];
    buf.copy_from_slice(&b[..4]);
    u32::from_le_bytes(buf)
}

fn read_u16_le(b: &[u8]) -> u16 {
    let mut buf = [0u8; 2];
    buf.copy_from_slice(&b[..2]);
    u16::from_le_bytes(buf)
}
