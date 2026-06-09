//! Reviewable test-spec stub for `vibeswap-canonical-token-type-script`.
//!
//! ## NOT a runnable cargo test (intentionally)
//!
//! The on-chain crate is `no_std` + `no_main` — it cannot host
//! `cargo test` integration runners. The workspace pattern (per the
//! sibling crates `primitive-cell-type-script`, `datatoken-cell-type-
//! script`, etc.) puts all runnable integration tests in the dedicated
//! `contracts-ckb/tests/` workspace crate, which compiles host-target
//! and uses `ckb-testtool`.
//!
//! This file exists as a **reviewable test spec** colocated with the
//! script it tests, so a reader can see the intended invariants and
//! happy-path shape without leaving the crate. The actual runnable
//! version of this test will be added at
//! `contracts-ckb/tests/src/vibeswap_canonical_token_tests.rs` and
//! registered as a module in `tests/src/lib.rs`.
//!
//! ## Pattern reference
//!
//! Mirrors the `[CYCLE5 SKIP]` shape from
//! `contracts-ckb/tests/src/primitive_cell_type_tests.rs`. Actual VM
//! execution gated on Capsule emitting a binary at
//! `contracts-ckb/build/release/vibeswap-canonical-token-type-script`.
//!
//! ## What this stub covers
//!
//! Owner-mode mint: one input cell uses the owner lock, one output cell
//! carries our type-script with a fresh amount. sUDT-canonical.
//!
//! Future coverage (CYCLE5, in `ckb-tests` crate):
//!   - transfer happy-path (sum_in == sum_out)
//!   - mint-with-MintClaimCell (non-owner path)
//!   - burn-with-BurnReceiptCell (non-owner path)
//!   - adversarial: mint w/o claim → rejected w/ code 40
//!   - adversarial: burn w/o receipt → rejected w/ code 41
//!   - adversarial: origin-relabel on transfer → rejected w/ code 44
//!   - adversarial: source_chain_id == 0 → rejected w/ code 45
//!
//! The `#[cfg(any())]` gate below makes this file NOT compile under
//! `cargo test` from this crate (which would fail anyway given the
//! no_std main.rs), while keeping the source reviewable.

#![cfg(any())]

use ckb_testtool::ckb_types::{
    bytes::Bytes,
    core::TransactionBuilder,
    packed::{CellInput, CellOutput},
    prelude::*,
};
use ckb_testtool::context::Context;

const SCHEMA_VERSION: u8 = 1;
const OFFSET_AMOUNT: usize = 0;
const OFFSET_VERSION: usize = 16;
const OFFSET_SOURCE_CHAIN: usize = 17;
const MIN_CELL_LEN: usize = 32;
const MAX_CYCLES: u64 = 70_000_000;

/// Path inside `contracts-ckb/build/release/` where Capsule emits the
/// script binary. Stub returns an empty slice until Capsule wired.
///
/// TODO: replace with
///   include_bytes!("../../build/release/vibeswap-canonical-token-type-script")
/// once Capsule build verified end-to-end.
fn load_script_binary() -> &'static [u8] {
    const _PLACEHOLDER: &[u8] = &[];
    _PLACEHOLDER
}

/// Build a CanonicalTokenCell data payload.
fn build_cell_data(amount: u128, source_chain_id: u64) -> Vec<u8> {
    let mut data = vec![0u8; MIN_CELL_LEN];
    data[OFFSET_AMOUNT..OFFSET_AMOUNT + 16].copy_from_slice(&amount.to_le_bytes());
    data[OFFSET_VERSION] = SCHEMA_VERSION;
    data[OFFSET_SOURCE_CHAIN..OFFSET_SOURCE_CHAIN + 8]
        .copy_from_slice(&source_chain_id.to_le_bytes());
    data
}

/// Owner-mode mint: one input cell uses the owner lock, one output cell
/// carries our type-script with a fresh amount. sUDT-canonical.
///
/// CYCLE5: actual VM execution gated on real binary. SKIP path emits a
/// clear diagnostic and returns early — does NOT silently pass.
#[test]
fn test_canonical_token_owner_mode_mint_skips_without_binary() {
    let mut context = Context::default();
    let script_bin = Bytes::from(load_script_binary().to_vec());

    if script_bin.is_empty() {
        eprintln!(
            "[CYCLE5 SKIP] vibeswap-canonical-token-type-script binary not present. \
             Run `capsule build --release` first. Test logic is compiled and reviewable."
        );
        return;
    }

    // Deploy the type-script binary as a code-cell.
    let type_outpoint = context.deploy_cell(script_bin);

    // The owner lock for this test is the always-success script that
    // ckb-testtool ships internally; we reuse the type-script outpoint
    // as a stand-in lock outpoint (matches the pattern used in the
    // primitive_cell_type_tests scaffold).
    let owner_lock = context
        .build_script(&type_outpoint, Bytes::from(vec![0u8]))
        .expect("build owner lock");
    let owner_lock_hash: [u8; 32] = owner_lock
        .calc_script_hash()
        .as_slice()
        .try_into()
        .expect("32-byte lock hash");

    // Type-script args = owner_lock_hash (sUDT-canonical).
    let type_script = context
        .build_script(&type_outpoint, Bytes::from(owner_lock_hash.to_vec()))
        .expect("build type script");

    // Set up an INPUT cell using the owner lock (no type-script — this
    // satisfies the owner-mode check: at least one input bears the owner
    // lock). The cell can be a plain CKB cell of any capacity.
    let owner_input_outpoint = context.create_cell(
        CellOutput::new_builder()
            .capacity(1_000_000u64.pack())
            .lock(owner_lock.clone())
            .build(),
        Bytes::new(),
    );
    let owner_input = CellInput::new_builder()
        .previous_output(owner_input_outpoint)
        .build();

    // Output cell: canonical token, freshly minted. Source chain id 1
    // (this chain), amount 1_000.
    let output_data = build_cell_data(1_000u128, 1u64);
    let output = CellOutput::new_builder()
        .capacity(10_000u64.pack())
        .lock(owner_lock)
        .type_(Some(type_script).pack())
        .build();

    let tx = TransactionBuilder::default()
        .input(owner_input)
        .output(output)
        .output_data(Bytes::from(output_data).pack())
        .build();
    let tx = context.complete_tx(tx);

    let cycles = context
        .verify_tx(&tx, MAX_CYCLES)
        .expect("owner-mode mint must verify");
    assert!(cycles > 0, "verify_tx should report nonzero cycles");
}
