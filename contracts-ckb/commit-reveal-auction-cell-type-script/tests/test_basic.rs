//! Reviewable test-spec stub for `commit-reveal-auction-cell-type-script`.
//!
//! NOT a runnable cargo test — the on-chain crate is no_std + no_main.
//! Runnable integration tests land in `contracts-ckb/tests/` per workspace
//! pattern; this file colocates the intended invariants + adversarial
//! shapes with the script itself.

#![cfg(any())]

use ckb_testtool::ckb_types::{
    bytes::Bytes,
    core::TransactionBuilder,
    packed::{CellInput, CellOutput},
    prelude::*,
};
use ckb_testtool::context::Context;

const SCHEMA_VERSION: u8 = 1;
const MAX_CYCLES: u64 = 70_000_000;

const COMMIT_CELL_DATA_LEN: usize = 129;
const REVEAL_CELL_DATA_LEN: usize = 253;
const SETTLE_HEADER_LEN: usize = 109;
const SLASH_CELL_DATA_LEN: usize = 69;

const ROLE_COMMIT: u8 = 0x01;
const ROLE_REVEAL: u8 = 0x02;
const ROLE_SETTLE: u8 = 0x03;
const ROLE_SLASH: u8 = 0x04;

fn load_script_binary() -> &'static [u8] {
    // TODO: include_bytes!("../../build/release/commit-reveal-auction-cell-type-script")
    const _PLACEHOLDER: &[u8] = &[];
    _PLACEHOLDER
}

fn build_args(role: u8, own_type_hash: [u8; 32]) -> Vec<u8> {
    let mut v = Vec::with_capacity(33);
    v.push(role);
    v.extend_from_slice(&own_type_hash);
    v
}

fn build_commit_data(
    batch_id: u64,
    pool_id: [u8; 32],
    commit_hash: [u8; 32],
    deposit: u64,
    collateral: u64,
    recipient: [u8; 32],
    deadline: u64,
) -> Vec<u8> {
    let mut d = Vec::with_capacity(COMMIT_CELL_DATA_LEN);
    d.push(SCHEMA_VERSION);
    d.extend_from_slice(&batch_id.to_le_bytes());
    d.extend_from_slice(&pool_id);
    d.extend_from_slice(&commit_hash);
    d.extend_from_slice(&deposit.to_le_bytes());
    d.extend_from_slice(&collateral.to_le_bytes());
    d.extend_from_slice(&recipient);
    d.extend_from_slice(&deadline.to_le_bytes());
    d
}

// ============ CommitCell ============

/// Happy path: deposit >= MIN_COMMIT_BOND, hash non-zero, deadline non-zero.
#[test]
fn test_commit_creation_happy_path_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[SKIP] commit-reveal-auction binary absent.");
        return;
    }
    let _ = build_commit_data(1, [0x11; 32], [0xAB; 32], 1_000_000, 500_000, [0x22; 32], 1000);
}

/// Deposit below MIN_COMMIT_BOND.
/// Expected: error 50 (DepositBelowMinBond).
#[test]
fn test_commit_deposit_below_bond_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[SKIP] deposit-below-bond reviewable.");
        return;
    }
}

/// All-zero commit_hash sentinel.
/// Expected: error 53 (CommitHashMalformed).
#[test]
fn test_commit_zero_hash_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[SKIP] commit-zero-hash reviewable.");
        return;
    }
}

// ============ RevealCell ============

/// Happy path: blake2b(order || secret) matches commit.hash, pool matches,
/// deposit + collateral pass through.
#[test]
fn test_reveal_happy_path_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[SKIP] reveal-happy-path reviewable.");
        return;
    }
}

/// Hash binding fails: secret swapped, hash check rejects.
/// Expected: error 61 (HashBindingFailed).
#[test]
fn test_reveal_hash_binding_fails_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[SKIP] reveal-hash-binding reviewable.");
        return;
    }
}

/// Reveal mutates deposit_amount.
/// Expected: error 64 (DepositOrCollateralMutated).
#[test]
fn test_reveal_deposit_mutated_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[SKIP] reveal-deposit-mutated reviewable.");
        return;
    }
}

/// amount_in exceeds MAX_TRADE_SIZE_BPS of reserve_in.
/// Expected: error 65 (OrderExceedsTradeSize).
#[test]
fn test_reveal_oversized_order_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[SKIP] reveal-oversized reviewable.");
        return;
    }
}

// ============ BatchSettlementCell ============

/// Happy path: N reveals consumed, canonical-order XOR seed matches, Fisher-
/// Yates ordering matches matched_orders[].
#[test]
fn test_settlement_happy_path_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[SKIP] settlement-happy-path reviewable.");
        return;
    }
}

/// Adversarial settlement: same reveals, but seed asserted is non-canonical
/// XOR (e.g. attacker reorders).
/// Expected: error 71 (ShuffleSeedMismatch).
#[test]
fn test_settlement_seed_mismatch_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!(
            "[SKIP] settlement-seed-mismatch reviewable. \
             This is the structurally-hardest invariant — the test asserts \
             that no canonical-order alternative is accepted."
        );
        return;
    }
}

/// Adversarial settlement: correct seed, but matched_orders[] permutation is
/// not the Fisher-Yates output.
/// Expected: error 72 (FisherYatesOrderingInvalid).
#[test]
fn test_settlement_fisher_yates_invalid_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[SKIP] settlement-fisher-yates reviewable.");
        return;
    }
}

/// Per-order amount_out != amount_in * clearing_price / 1e18.
/// Expected: error 74 (MatchedOrderInconsistent).
#[test]
fn test_settlement_amount_out_inconsistent_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[SKIP] settlement-amount-out reviewable.");
        return;
    }
}

/// Some RevealCell for the batch consumed, but absent from matched_orders[].
/// Expected: error 75 (RevealNotIncludedInSettlement).
#[test]
fn test_settlement_reveal_excluded_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[SKIP] settlement-reveal-excluded reviewable.");
        return;
    }
}

/// Two pools in the batch.
/// Expected: error 76 (MultiplePoolsInBatch).
#[test]
fn test_settlement_multi_pool_rejected_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[SKIP] settlement-multi-pool reviewable.");
        return;
    }
}

// ============ SlashCell ============

/// Happy path: commit past deadline, no reveal, 50/50 split.
#[test]
fn test_slash_happy_path_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[SKIP] slash-happy-path reviewable.");
        return;
    }
}

/// Slash before deadline.
/// Expected: error 80 (SlashBeforeDeadline).
#[test]
fn test_slash_before_deadline_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[SKIP] slash-before-deadline reviewable.");
        return;
    }
}

/// Reveal exists for this commit; slash attempted same tx.
/// Expected: error 83 (RevealExistedForCommit).
#[test]
fn test_slash_with_reveal_present_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[SKIP] slash-with-reveal reviewable.");
        return;
    }
}

/// Slash split off from 50%.
/// Expected: error 81 (SlashRateMismatch).
#[test]
fn test_slash_rate_mismatch_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[SKIP] slash-rate-mismatch reviewable.");
        return;
    }
}

/// treasury + committer + bounty != deposit + collateral.
/// Expected: error 82 (SlashSumMismatch).
#[test]
fn test_slash_sum_mismatch_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[SKIP] slash-sum-mismatch reviewable.");
        return;
    }
}
