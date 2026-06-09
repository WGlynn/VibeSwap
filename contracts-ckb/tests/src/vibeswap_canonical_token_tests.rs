//! Integration tests for `vibeswap-canonical-token-type-script`.
//!
//! Runnable host-target counterpart to the reviewable spec stub at
//! `vibeswap-canonical-token-type-script/tests/test_basic.rs`. That stub is
//! `#[cfg(any())]`-gated because the script crate is `no_std`/`no_main`
//! and cannot host runnable cargo tests; the runnable version lives here.
//!
//! ## What this exercises
//!
//! Owner-mode mint of a CanonicalTokenCell (sUDT-extended shape):
//!   - one input cell uses the owner lock, no type-script (per RFC-0025
//!     owner-mode: at least one input bears the owner lock-hash)
//!   - one output cell carries the canonical-token type-script with a
//!     freshly minted amount and source_chain_id == 1 (this chain)
//!
//! Plus two adversarial cases that the script must reject:
//!   - schema version != 1   → `Error::SchemaVersionUnsupported`
//!   - source_chain_id == 0  → `Error::SourceChainIdReserved`
//!
//! ## Cell-data layout (from vibeswap-canonical-token-type-script/src/main.rs)
//!
//! ```text
//! | field           | bytes | offset |
//! |-----------------|-------|--------|
//! | amount          |  16   |   0    |   <-- u128 LE; sUDT canonical
//! | version         |   1   |  16    |
//! | source_chain_id |   8   |  17    |   <-- u64 LE
//! | reserved        |   7   |  25    |
//! ```
//!
//! Minimum cell-data length = 32 bytes.
//!
//! ## Status
//!
//! [SKIP] path is in effect until the RISC-V binary is built at
//! `target/riscv64imac-unknown-none-elf/release/vibeswap-canonical-token-type-script`
//! (or Capsule's `build/release/vibeswap-canonical-token-type-script`).
//! Test source compiles + is reviewable now; real VM execution gated on
//! the build step. See `contracts-ckb/test-infra/SETUP.md`.

use ckb_testtool::ckb_types::{
    bytes::Bytes,
    core::TransactionBuilder,
    packed::{CellInput, CellOutput},
    prelude::*,
};
use ckb_testtool::context::Context;

use crate::load_script_binary;

// ============ Cell-data layout (mirrors main.rs) ============

const SCHEMA_VERSION: u8 = 1;
const OFFSET_AMOUNT: usize = 0;
const AMOUNT_LEN: usize = 16;
const OFFSET_VERSION: usize = 16;
const OFFSET_SOURCE_CHAIN: usize = 17;
const SOURCE_CHAIN_LEN: usize = 8;
const MIN_CELL_LEN: usize = 32;

/// CKB mainnet ceiling reference.
const MAX_CYCLES: u64 = 70_000_000;

// ============ Helpers ============

/// Build a well-formed CanonicalTokenCell data payload.
fn build_cell_data(amount: u128, source_chain_id: u64) -> Vec<u8> {
    let mut data = vec![0u8; MIN_CELL_LEN];
    data[OFFSET_AMOUNT..OFFSET_AMOUNT + AMOUNT_LEN].copy_from_slice(&amount.to_le_bytes());
    data[OFFSET_VERSION] = SCHEMA_VERSION;
    data[OFFSET_SOURCE_CHAIN..OFFSET_SOURCE_CHAIN + SOURCE_CHAIN_LEN]
        .copy_from_slice(&source_chain_id.to_le_bytes());
    data
}

/// Build cell data with a custom version byte (for the SchemaVersionUnsupported case).
fn build_cell_data_with_version(amount: u128, source_chain_id: u64, version: u8) -> Vec<u8> {
    let mut data = build_cell_data(amount, source_chain_id);
    data[OFFSET_VERSION] = version;
    data
}

// ============================================================================
// Test 1: owner-mode mint happy path
// ============================================================================

/// Owner-mode mint: an input cell carries the owner lock (no type-script),
/// an output cell carries the canonical-token type-script with a fresh
/// `amount`. Per sUDT § owner-mode, this MUST verify because at least one
/// input bears the owner lock-hash that the type-script's args encode.
#[test]
fn test_canonical_token_owner_mode_mint_happy_path() {
    let mut context = Context::default();
    let script_bin = Bytes::from(
        load_script_binary!("vibeswap-canonical-token-type-script").to_vec(),
    );

    if script_bin.is_empty() {
        eprintln!(
            "[SKIP] vibeswap-canonical-token-type-script binary not present. \
             Run `cargo build --release --target riscv64imac-unknown-none-elf` \
             (or `capsule build --release`) first. Test logic is compiled \
             and reviewable. See test-infra/SETUP.md."
        );
        return;
    }

    // Deploy the type-script binary as a code-cell.
    let type_outpoint = context.deploy_cell(script_bin);

    // Build the owner lock. We reuse the type-script outpoint as the lock
    // code-cell — matches the pattern in `primitive_cell_type_tests.rs`. The
    // important property is that the lock-hash computed from this Script is
    // what we'll feed into the type-script's `args`.
    let owner_lock = context
        .build_script(&type_outpoint, Bytes::from(vec![0u8]))
        .expect("build owner lock");
    let owner_lock_hash: [u8; 32] = owner_lock
        .calc_script_hash()
        .as_slice()
        .try_into()
        .expect("32-byte lock hash");

    // Type-script args = owner_lock_hash (32 bytes), per sUDT canonical shape.
    let type_script = context
        .build_script(&type_outpoint, Bytes::from(owner_lock_hash.to_vec()))
        .expect("build type script");

    // Input cell: uses the owner lock, no type-script. This is the cell
    // whose presence makes the tx "owner-mode".
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

    // Output cell: carries the canonical-token type-script. Source chain
    // id 1 (this chain), amount 1_000 (freshly minted).
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

// ============================================================================
// Test 2: adversarial — schema_version != 1
// ============================================================================

/// A cell with an unsupported schema version MUST be rejected. The script
/// returns `Error::SchemaVersionUnsupported` for any version byte other
/// than `SCHEMA_VERSION = 1`.
#[test]
fn test_canonical_token_rejects_unsupported_schema_version() {
    let mut context = Context::default();
    let script_bin = Bytes::from(
        load_script_binary!("vibeswap-canonical-token-type-script").to_vec(),
    );

    if script_bin.is_empty() {
        eprintln!(
            "[SKIP] vibeswap-canonical-token-type-script binary not present. \
             Run `cargo build --release --target riscv64imac-unknown-none-elf` first."
        );
        return;
    }

    let type_outpoint = context.deploy_cell(script_bin);
    let owner_lock = context
        .build_script(&type_outpoint, Bytes::from(vec![0u8]))
        .expect("build owner lock");
    let owner_lock_hash: [u8; 32] = owner_lock
        .calc_script_hash()
        .as_slice()
        .try_into()
        .expect("32-byte lock hash");
    let type_script = context
        .build_script(&type_outpoint, Bytes::from(owner_lock_hash.to_vec()))
        .expect("build type script");

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

    // Unsupported schema version = 99.
    let output_data = build_cell_data_with_version(1_000u128, 1u64, 99u8);
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

    let result = context.verify_tx(&tx, MAX_CYCLES);
    assert!(
        result.is_err(),
        "schema_version = 99 must be rejected (SchemaVersionUnsupported)"
    );
    // Future tighten: downcast to ScriptError and assert exact error code
    // once the script's Error enum surfaces its discriminants here.
}

// ============================================================================
// Test 3: adversarial — source_chain_id == 0
// ============================================================================

/// `source_chain_id = 0` is reserved (no chain originates with id 0). The
/// script returns `Error::SourceChainIdReserved` for any cell that carries
/// this value.
#[test]
fn test_canonical_token_rejects_reserved_source_chain_id() {
    let mut context = Context::default();
    let script_bin = Bytes::from(
        load_script_binary!("vibeswap-canonical-token-type-script").to_vec(),
    );

    if script_bin.is_empty() {
        eprintln!(
            "[SKIP] vibeswap-canonical-token-type-script binary not present. \
             Run `cargo build --release --target riscv64imac-unknown-none-elf` first."
        );
        return;
    }

    let type_outpoint = context.deploy_cell(script_bin);
    let owner_lock = context
        .build_script(&type_outpoint, Bytes::from(vec![0u8]))
        .expect("build owner lock");
    let owner_lock_hash: [u8; 32] = owner_lock
        .calc_script_hash()
        .as_slice()
        .try_into()
        .expect("32-byte lock hash");
    let type_script = context
        .build_script(&type_outpoint, Bytes::from(owner_lock_hash.to_vec()))
        .expect("build type script");

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

    // source_chain_id = 0 (reserved).
    let output_data = build_cell_data(1_000u128, 0u64);
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

    let result = context.verify_tx(&tx, MAX_CYCLES);
    assert!(
        result.is_err(),
        "source_chain_id = 0 must be rejected (SourceChainIdReserved)"
    );
}
