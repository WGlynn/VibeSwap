//! # ckb-tests
//!
//! Host-target integration-test harness for the six PsiNet CKB scripts in
//! sibling workspace crates. Each script gets its own test module under
//! `tests/src/`. The tests use `ckb-testtool::context::Context` to:
//!
//! 1. Deploy the script binary as a code-cell
//! 2. Build a transaction with input/output cells that carry the script
//!    as their type or lock
//! 3. Run `Context::verify_tx` and assert success / specific error code
//!
//! ## Honest status (CYCLE5 → CYCLE6 transition)
//!
//! The test **source code** compiles against `cargo check -p ckb-tests` on
//! the host target. The test **bodies** cannot actually execute until
//! `capsule build --release` has produced the RISC-V binaries at
//! `contracts-ckb/build/release/<script-name>`. Until then the
//! `load_script_binary!` macro returns a zero-byte placeholder which
//! `Context::deploy_cell` will accept (it stores arbitrary bytes), but
//! `verify_tx` will fail to execute the empty bytecode.
//!
//! The point of scaffolding now is: the **test logic** — what cells to
//! construct, what witnesses to attach, what error codes to assert against
//! — is real and reviewable. Wiring in real binaries is the last mile.
//!
//! Spec reference: `vibeswap/docs/research/papers/psinet-ckb-cell-model-canonical-spec.md`

#![cfg(test)]

pub mod primitive_cell_type_tests;
pub mod vibeswap_canonical_token_tests;

/// Path inside `contracts-ckb/build/release/` where Capsule emits a script
/// binary, by script-crate name.
///
/// CYCLE5: Replace stub at call-site with real `include_bytes!` once
/// `capsule build --release` is verified end-to-end on a dev machine.
#[macro_export]
macro_rules! load_script_binary {
    ($name:literal) => {{
        // CYCLE5: swap for: include_bytes!(concat!("../../build/release/", $name))
        // Returns an empty slice until Capsule output exists; tests that depend
        // on actual VM execution will fail at `verify_tx` step with a clear
        // "empty bytecode" symptom, NOT a silent pass.
        const _PLACEHOLDER: &[u8] = &[];
        _PLACEHOLDER
    }};
}
