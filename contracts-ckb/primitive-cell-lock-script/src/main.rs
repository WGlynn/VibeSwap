//! # PrimitiveCell Lock Script
//!
//! Authorises spending of a PrimitiveCell under a post-quantum signature scheme.
//! Default lock is SPHINCS+ (sphincs-shake-128s-simple parameter set per spec
//! discussion below); XMSS / ML-DSA (Dilithium) reserved as alternatives via
//! the scheme-id field in script args.
//!
//! ## Script args layout (binary, fixed offsets)
//!
//! ```
//! | field            | bytes | type      |
//! |------------------|-------|-----------|
//! | scheme_id        |   1   | u8        | // 0 = SPHINCS+ shake-128s-simple
//! |                  |       |           | // 1 = SPHINCS+ shake-128f-simple (reserved)
//! |                  |       |           | // 2 = XMSS (reserved)
//! |                  |       |           | // 3 = ML-DSA-44 (reserved)
//! | pubkey_hash      |  32   | blake2b   | // hash of the full PQ public key
//! | pubkey_cell_dep  |  32   | type_id   | // cell-dep that carries the full pubkey bytes
//! ```
//!
//! Total: 65 bytes.
//!
//! The full public key is too large to inline in the lock-script args
//! (SPHINCS+ shake-128s-simple pubkey = 32 bytes; manageable inline.
//! XMSS / Dilithium pubkeys 1-2KB; must be carried via cell-dep). The
//! lock-script-args pattern is one of:
//!   - inline if pubkey fits in remaining args budget (SPHINCS+ shake-128s
//!     fits at 32 bytes; could be inlined as `pubkey` instead of `pubkey_hash`)
//!   - cell-dep reference (this script's chosen pattern for uniformity across
//!     schemes; the cell-dep cell is small and re-usable across many primitive cells)
//!
//! For v0 we use the hash-pointer pattern uniformly. Cell-dep contains the
//! full pubkey bytes; this script resolves the cell-dep at verify time,
//! verifies the dep's data hashes to `pubkey_hash`, then uses the resolved
//! pubkey for signature verification.
//!
//! ## Witness layout
//!
//! The lock witness carries the SPHINCS+ signature (variable length per
//! parameter set):
//!
//! | parameter set                | sig bytes |
//! |------------------------------|-----------|
//! | sphincs-shake-128s-simple    |    7856   |
//! | sphincs-shake-128f-simple    |   17088   |
//! | sphincs-shake-192s-simple    |   16224   |
//!
//! Signature is computed over `tx_hash` (the CKB transaction signing hash
//! per CKB convention) using the SPHINCS+ scheme indexed by `scheme_id`.
//!
//! ## Verification flow
//!
//! 1. Load script args; parse scheme_id + pubkey_hash + pubkey_cell_dep.
//! 2. Load tx_hash (canonical signing target on CKB).
//! 3. Load lock_witness; treat as signature bytes.
//! 4. Resolve pubkey_cell_dep cell; verify its data blake2b matches pubkey_hash.
//! 5. Dispatch to per-scheme verifier with (pubkey_bytes, tx_hash, sig_bytes).
//! 6. Return 0 on Ok, error code on Err.
//!
//! All steps 1-4 are implemented below in safe no_std code. Step 5's per-scheme
//! verifier is the irreducible cryptographic primitive; see `pq_verify` for
//! its CYCLE5 status.
//!
//! ## Honest scope on SPHINCS+ in CKB-VM
//!
//! Status: the cryptographic verifier itself is CYCLE5. A no_std + no_alloc
//! SPHINCS+ verifier suitable for the CKB-VM cycle budget is open research as
//! of 2026-05. Reference C implementations from the SPHINCS+ submission
//! (https://sphincs.org) port partially but require careful trimming + audit;
//! verification cost in the shake-128s-simple set is ~7-15M RISC-V cycles
//! which is within CKB-VM budget but only with optimization.
//!
//! Path to closure:
//!   (a) Nervos research team or external contributor produces a no_std SPHINCS+
//!       crate audited for CKB-VM (preferred — leverages substrate-native expertise)
//!   (b) Inline the SPHINCS+ verifier here from a reference impl, trim alloc-deps,
//!       audit, integrate (high effort, requires PQ-crypto specialist review)
//!   (c) CKB-VM adds a PQ-sig precompile (long-horizon, requires Nervos protocol upgrade)
//!
//! Until closure, this script REJECTS all spend attempts with `PqVerifyUnimplemented`,
//! preserving the structural property that no value can be extracted from a
//! lock-script-protected cell via an unverified signature. Fail-closed.
//!
//! Spec: psinet-ckb-cell-model-canonical-spec.md Section 2.1 (lock script).

#![no_std]
#![no_main]

use ckb_std::{
    ckb_constants::Source,
    default_alloc,
    high_level::{load_cell_data, load_script, load_tx_hash, load_witness_args, QueryIter},
    syscalls::SysError,
};
use blake2b_ref::Blake2bBuilder;

ckb_std::entry!(program_entry);
default_alloc!();

const ARGS_SCHEME_ID: usize = 0;
const ARGS_PUBKEY_HASH: usize = 1;
const ARGS_PUBKEY_CELL_DEP: usize = 33;
const ARGS_LEN: usize = ARGS_PUBKEY_CELL_DEP + 32;

const PUBKEY_HASH_LEN: usize = 32;
const TX_HASH_LEN: usize = 32;

const BLAKE2B_CKB_PERSONAL: &[u8] = b"ckb-default-hash";

const SCHEME_SPHINCS_SHAKE_128S_SIMPLE: u8 = 0;
const SCHEME_SPHINCS_SHAKE_128F_SIMPLE: u8 = 1;
const SCHEME_XMSS: u8 = 2;
const SCHEME_ML_DSA_44: u8 = 3;

#[repr(i8)]
enum Error {
    IndexOutOfBound = 1,
    ItemMissing = 2,
    LengthNotEnough = 3,
    Encoding = 4,

    InvalidArgs = 20,
    MissingWitnessSignature = 21,
    UnknownSchemeId = 22,
    PubkeyCellDepNotFound = 23,
    PubkeyHashMismatch = 24,
    PqVerifyUnimplemented = 25,
    PqVerifyFailed = 26,
}

impl From<SysError> for Error {
    fn from(err: SysError) -> Self {
        use SysError::*;
        match err {
            IndexOutOfBound => Self::IndexOutOfBound,
            ItemMissing => Self::ItemMissing,
            LengthNotEnough(_) => Self::LengthNotEnough,
            Encoding => Self::Encoding,
            _ => Self::Encoding,
        }
    }
}

/// Script entry point. Returns 0 on success, nonzero error code on rejection.
pub fn program_entry() -> i8 {
    match verify() {
        Ok(_) => 0,
        Err(e) => e as i8,
    }
}

fn verify() -> Result<(), Error> {
    let script = load_script()?;
    let args = script.as_reader().args().raw_data();
    if args.len() < ARGS_LEN {
        return Err(Error::InvalidArgs);
    }

    let scheme_id = args[ARGS_SCHEME_ID];
    let pubkey_hash: [u8; 32] = copy_32(&args[ARGS_PUBKEY_HASH..ARGS_PUBKEY_HASH + 32])?;
    let pubkey_cell_dep_type_id: [u8; 32] =
        copy_32(&args[ARGS_PUBKEY_CELL_DEP..ARGS_PUBKEY_CELL_DEP + 32])?;

    let tx_hash_vec = load_tx_hash()?;
    let tx_hash: [u8; 32] = copy_32(&tx_hash_vec[..])?;

    let witness_args = load_witness_args(0, Source::GroupInput)?;
    let lock_witness = witness_args
        .lock()
        .to_opt()
        .ok_or(Error::MissingWitnessSignature)?;
    let sig_bytes = lock_witness.raw_data();
    if sig_bytes.is_empty() {
        return Err(Error::MissingWitnessSignature);
    }

    let pubkey_bytes = resolve_pubkey_cell_dep(&pubkey_cell_dep_type_id, &pubkey_hash)?;

    pq_verify(scheme_id, &pubkey_bytes, &tx_hash, &sig_bytes)
}

/// Resolve the cell-dep carrying the full PQ public key.
///
/// Scans `Source::CellDep` for a cell whose type-script type_id matches the
/// `expected_type_id`, loads its data, verifies the data's blake2b hash matches
/// `expected_pubkey_hash`, and returns the data bytes.
fn resolve_pubkey_cell_dep(
    expected_type_id: &[u8; 32],
    expected_pubkey_hash: &[u8; 32],
) -> Result<alloc::vec::Vec<u8>, Error> {
    use alloc::vec::Vec;

    for (i, ts_opt) in QueryIter::new(
        |i, src| ckb_std::high_level::load_cell_type(i, src),
        Source::CellDep,
    )
    .enumerate()
    {
        if let Some(ts) = ts_opt {
            let ts_args = ts.as_reader().args().raw_data();
            if ts_args.len() >= 32 && &ts_args[..32] == expected_type_id.as_ref() {
                let data: Vec<u8> = load_cell_data(i, Source::CellDep)?;
                let h = blake2b_ckb(&data);
                if &h != expected_pubkey_hash {
                    return Err(Error::PubkeyHashMismatch);
                }
                return Ok(data);
            }
        }
    }
    Err(Error::PubkeyCellDepNotFound)
}

/// Post-quantum signature verification dispatch.
///
/// This function is the SINGLE point where the cryptographic primitive lives.
/// Everything around it (witness parsing, pubkey resolution, hash check) is
/// fully implemented above. This function dispatches by `scheme_id` to the
/// per-scheme verifier — none of which are implemented yet (CYCLE5).
///
/// Fail-closed: returns `PqVerifyUnimplemented` for any unknown scheme.
fn pq_verify(
    scheme_id: u8,
    _pubkey_bytes: &[u8],
    _tx_hash: &[u8; 32],
    _signature: &[u8],
) -> Result<(), Error> {
    match scheme_id {
        SCHEME_SPHINCS_SHAKE_128S_SIMPLE => verify_sphincs_shake_128s_simple(
            _pubkey_bytes, _tx_hash, _signature,
        ),
        SCHEME_SPHINCS_SHAKE_128F_SIMPLE => verify_sphincs_shake_128f_simple(
            _pubkey_bytes, _tx_hash, _signature,
        ),
        SCHEME_XMSS => verify_xmss(_pubkey_bytes, _tx_hash, _signature),
        SCHEME_ML_DSA_44 => verify_ml_dsa_44(_pubkey_bytes, _tx_hash, _signature),
        _ => Err(Error::UnknownSchemeId),
    }
}

/// CYCLE5: SPHINCS+ shake-128s-simple verifier.
///
/// Reference parameters (from SPHINCS+ submission, sphincsplus.org):
///   n=16, h=63, d=7, log_t=12, k=14, w=16
///   pubkey: 32 bytes, signature: 7856 bytes
///   verification: ~7-15M RISC-V cycles (within CKB-VM budget with care)
///
/// Implementation plan:
///   - SHAKE-256 hash function (CYCLE5: port from XKCP reference or audit-grade Rust impl)
///   - WOTS+ one-time signature verification (CYCLE5)
///   - FORS few-time signature verification (CYCLE5)
///   - Hypertree path verification via SHAKE-256 hash tree (CYCLE5)
///   - Compare reconstructed pubkey root against provided pubkey_bytes
fn verify_sphincs_shake_128s_simple(
    _pubkey: &[u8],
    _msg: &[u8; 32],
    _sig: &[u8],
) -> Result<(), Error> {
    Err(Error::PqVerifyUnimplemented)
}

/// CYCLE5: SPHINCS+ shake-128f-simple verifier (faster variant, larger sigs).
fn verify_sphincs_shake_128f_simple(
    _pubkey: &[u8],
    _msg: &[u8; 32],
    _sig: &[u8],
) -> Result<(), Error> {
    Err(Error::PqVerifyUnimplemented)
}

/// CYCLE5: XMSS verifier (stateful hash-based; key-reuse hazard).
fn verify_xmss(_pubkey: &[u8], _msg: &[u8; 32], _sig: &[u8]) -> Result<(), Error> {
    Err(Error::PqVerifyUnimplemented)
}

/// CYCLE5: ML-DSA-44 (Dilithium) verifier (lattice-based, NIST PQ standard).
fn verify_ml_dsa_44(_pubkey: &[u8], _msg: &[u8; 32], _sig: &[u8]) -> Result<(), Error> {
    Err(Error::PqVerifyUnimplemented)
}

// ============ Helpers ============

fn copy_32(src: &[u8]) -> Result<[u8; 32], Error> {
    if src.len() < 32 {
        return Err(Error::LengthNotEnough);
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(&src[..32]);
    Ok(out)
}

fn blake2b_ckb(data: &[u8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    let mut hasher = Blake2bBuilder::new(32)
        .personal(BLAKE2B_CKB_PERSONAL)
        .build();
    hasher.update(data);
    hasher.finalize(&mut out);
    out
}

