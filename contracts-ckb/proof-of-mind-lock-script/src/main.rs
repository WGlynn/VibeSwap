//! # Proof of Mind (PoM) Lock Script
//!
//! Replaces Matt Quinn's PoW-lock-hash with cognitive-work attestation.
//! Unlocks iff the witness proves: (1) WWWD gate fired >= min_gate_fire_count
//! on primitive_type_id, (2) convergence signal meets floor over window_secs,
//! (3) K-of-M mesh-agent attestations endorse the claim.
//!
//! Args + witness layout: see spec doc Section 3 (+ §3.2 addendum at end of
//! the spec for the merkle-proof extension introduced by CYCLE5).
//! Data source: ~/.claude/projects/C--Users-Will/memory/_system/wwwd_gate_fires.jsonl
//! (off-chain prover computes merkle blake2b root over filtered subset).
//!
//! Status: CYCLE5 verifier path implemented — real ed25519 K-of-M verify +
//! binary merkle proof validator-set membership. Structural checks fire first
//! so error codes stay distinct for test triage. SPEC-ONLY at the system
//! level: off-chain prover, validator-set bootstrap, and on-chain integration
//! tests are still pending; do not treat as deployed.

#![no_std]
#![no_main]

use blake2b_ref::Blake2bBuilder;
use ckb_std::{
    ckb_constants::Source,
    default_alloc,
    high_level::{load_script, load_witness_args},
};
use ed25519_compact::{PublicKey, Signature};

ckb_std::entry!(program_entry);
default_alloc!();

// ============ Args layout ============
const ARGS_PRIMITIVE_ID: usize = 0;
const ARGS_MIN_FIRES: usize = 32;
const ARGS_SIGNAL_FLOOR: usize = 40;
const ARGS_MIN_CORRECTION_BPS: usize = 41;
const ARGS_WINDOW_SECS: usize = 43;
const ARGS_K: usize = 47;
const ARGS_M: usize = 48;
const ARGS_VALIDATOR_ROOT: usize = 49;
const ARGS_LEN: usize = ARGS_VALIDATOR_ROOT + 32;

// ============ Witness layout ============
// Fixed-prefix:
//   0..32   gate_fire_log_root          ([u8; 32])
//   32..40  gate_fire_count             (u64 LE)
//   40      convergence_signal          (u8)
//   41..43  correction_rate_bps         (u16 LE)
//   43..47  window_secs                 (u32 LE)
//   47      attestation_count           (u8)
//   48..    per-attestation block (variable length, see ATTESTATION_PREFIX_LEN)
//
// Per-attestation block (CYCLE5 extension — addendum to spec §3.2):
//   0..32   agent_did       ([u8; 32], ed25519 did:key fingerprint)
//   32..96  sig             ([u8; 64], ed25519 sig over signed_payload below)
//   96      proof_len       (u8, number of merkle sibling hashes, ≤ MAX_PROOF_DEPTH)
//   97      proof_dirs      (u8 bitmap: bit i = 0 ⇒ sibling on right, 1 ⇒ on left)
//   98..    proof_len × 32 bytes of sibling hashes (leaf-to-root order)
//
// Signed payload (the ed25519 message body):
//   log_root[32] || fire_count_le[8] || signal[1] || window_secs_le[4]    = 45 bytes
// NOTE: correction_bps is NOT in the signed payload by design — it is an
// off-chain-computed metric the lock script also asserts a floor on, but the
// attester is signing the raw cognition observation, not the derived metric.
const WIT_LOG_ROOT: usize = 0;
const WIT_FIRE_COUNT: usize = 32;
const WIT_SIGNAL: usize = 40;
const WIT_CORRECTION_BPS: usize = 41;
const WIT_WINDOW_SECS: usize = 43;
const WIT_ATTEST_LEN: usize = 47;
const WIT_ATTEST_START: usize = 48;

const DID_LEN: usize = 32;
const SIG_LEN: usize = 64;
const HASH_LEN: usize = 32;
const ATTESTATION_PREFIX_LEN: usize = DID_LEN + SIG_LEN + 1 /* proof_len */ + 1 /* proof_dirs */;
const SIGNED_PAYLOAD_LEN: usize = HASH_LEN + 8 + 1 + 4; // 45

// Bounds (stack-sized, CKB-VM tight):
const MAX_K: usize = 16; // M ≤ 16 per spec; K ≤ M
const MAX_PROOF_DEPTH: usize = 24; // supports validator-set ≤ 16M entries; >> needed
const CKB_BLAKE2B_PERSONAL: &[u8] = b"ckb-default-hash";

#[repr(i8)]
enum Error {
    IndexOutOfBound = 1,
    ItemMissing = 2,
    LengthNotEnough = 3,
    Encoding = 4,
    InvalidArgs = 60,
    MissingWitness = 61,
    FireCountBelowFloor = 62,
    SignalBelowFloor = 63,
    CorrectionRateBelowFloor = 64,
    WindowMismatch = 65,
    InsufficientAttestations = 66,
    DuplicateAttester = 67,
    AttesterNotInValidatorSet = 68,
    SignatureVerifyFailed = 69,
    AttestationBlockMalformed = 70,
    MerkleProofTooDeep = 71,
}

impl From<ckb_std::error::SysError> for Error {
    fn from(err: ckb_std::error::SysError) -> Self {
        use ckb_std::error::SysError::*;
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

// ============ Crate-choice receipts (pairwise compare) ============
// Per [F·pairwise-language-comparison]. Candidates evaluated:
//   - ed25519-dalek v2 : popular but requires alloc on no_std (curve25519-dalek
//     backend allocates for scalar mul); zeroize chain pulls extra weight; would
//     fit but ~25KB code-size hit on RISC-V.
//   - ed25519-compact v2.3 (jedisct1) : pure no_std + no_alloc w/ default-features=false;
//     verify path is single-file; libsodium-author pedigree; <10KB on RISC-V.
//     WINNER for CKB-VM constraints.
//   - dalek-ed25519 (legacy 1.x) : abandoned; superseded by v2.
// Decision: ed25519-compact. Single-crate dep, no alloc, no random, no zeroize chain.

// ============ Verifier ============
fn verify() -> Result<(), Error> {
    let script = load_script()?;
    let args = script.as_reader().args().raw_data();
    if args.len() < ARGS_LEN {
        return Err(Error::InvalidArgs);
    }

    let min_fires = read_u64(&args[ARGS_MIN_FIRES..ARGS_MIN_FIRES + 8]);
    let signal_floor = args[ARGS_SIGNAL_FLOOR];
    let min_correction_bps =
        read_u16(&args[ARGS_MIN_CORRECTION_BPS..ARGS_MIN_CORRECTION_BPS + 2]);
    let window_secs = read_u32(&args[ARGS_WINDOW_SECS..ARGS_WINDOW_SECS + 4]);
    let k = args[ARGS_K];
    let m = args[ARGS_M];
    let mut validator_root = [0u8; HASH_LEN];
    validator_root.copy_from_slice(&args[ARGS_VALIDATOR_ROOT..ARGS_VALIDATOR_ROOT + 32]);
    let _ = ARGS_PRIMITIVE_ID; // primitive_type_id is bound by type-script; lock-script just signs over it indirectly via log_root

    let witness_args = load_witness_args(0, Source::GroupInput).map_err(Error::from)?;
    let lock_wit = witness_args.lock().to_opt().ok_or(Error::MissingWitness)?;
    let wit = lock_wit.raw_data();
    if wit.len() < WIT_ATTEST_START {
        return Err(Error::LengthNotEnough);
    }

    let fire_count = read_u64(&wit[WIT_FIRE_COUNT..WIT_FIRE_COUNT + 8]);
    let signal = wit[WIT_SIGNAL];
    let correction_bps = read_u16(&wit[WIT_CORRECTION_BPS..WIT_CORRECTION_BPS + 2]);
    let wit_window = read_u32(&wit[WIT_WINDOW_SECS..WIT_WINDOW_SECS + 4]);
    let attest_count = wit[WIT_ATTEST_LEN] as usize;

    if fire_count < min_fires {
        return Err(Error::FireCountBelowFloor);
    }
    if signal < signal_floor {
        return Err(Error::SignalBelowFloor);
    }
    if correction_bps < min_correction_bps {
        return Err(Error::CorrectionRateBelowFloor);
    }
    if wit_window != window_secs {
        return Err(Error::WindowMismatch);
    }
    if attest_count < k as usize || attest_count > m as usize || attest_count > MAX_K {
        return Err(Error::InsufficientAttestations);
    }

    // Build the canonical signed-payload (the message every attester signed).
    // Layout: log_root[32] || fire_count_le[8] || signal[1] || window_secs_le[4]
    let mut signed_payload = [0u8; SIGNED_PAYLOAD_LEN];
    signed_payload[..32].copy_from_slice(&wit[WIT_LOG_ROOT..WIT_LOG_ROOT + 32]);
    signed_payload[32..40].copy_from_slice(&wit[WIT_FIRE_COUNT..WIT_FIRE_COUNT + 8]);
    signed_payload[40] = wit[WIT_SIGNAL];
    signed_payload[41..45].copy_from_slice(&wit[WIT_WINDOW_SECS..WIT_WINDOW_SECS + 4]);

    let attest_bytes = &wit[WIT_ATTEST_START..];
    verify_attestations(attest_bytes, attest_count, &validator_root, &signed_payload)
}

/// Per-attestation verification (CYCLE5 — real path):
/// 1. Each DID must be unique (no double-counting one validator)
/// 2. Each DID must be present in the validator-set merkle tree rooted at
///    `validator_root` (binary merkle, blake2b w/ CKB personalisation)
/// 3. Each ed25519 signature must verify over `signed_payload`
///
/// Walks the variable-length attestation block in a single forward pass;
/// stack-only state (`[Option<[u8; 32]>; MAX_K]` for dedup).
fn verify_attestations(
    attest_bytes: &[u8],
    count: usize,
    validator_root: &[u8],
    signed_payload: &[u8],
) -> Result<(), Error> {
    let mut seen: [Option<[u8; DID_LEN]>; MAX_K] = [None; MAX_K];
    let mut cursor: usize = 0;

    for i in 0..count {
        // Bounds check the fixed prefix
        if attest_bytes.len() < cursor + ATTESTATION_PREFIX_LEN {
            return Err(Error::AttestationBlockMalformed);
        }
        let did_slice = &attest_bytes[cursor..cursor + DID_LEN];
        let sig_slice = &attest_bytes[cursor + DID_LEN..cursor + DID_LEN + SIG_LEN];
        let proof_len = attest_bytes[cursor + DID_LEN + SIG_LEN] as usize;
        let proof_dirs = attest_bytes[cursor + DID_LEN + SIG_LEN + 1];
        cursor += ATTESTATION_PREFIX_LEN;

        if proof_len > MAX_PROOF_DEPTH {
            return Err(Error::MerkleProofTooDeep);
        }
        if attest_bytes.len() < cursor + proof_len * HASH_LEN {
            return Err(Error::AttestationBlockMalformed);
        }
        let proof_slice = &attest_bytes[cursor..cursor + proof_len * HASH_LEN];
        cursor += proof_len * HASH_LEN;

        // Dedup: linear scan, M ≤ 16
        let mut did = [0u8; DID_LEN];
        did.copy_from_slice(did_slice);
        for j in 0..i {
            if let Some(prev) = seen[j] {
                if prev == did {
                    return Err(Error::DuplicateAttester);
                }
            }
        }
        seen[i] = Some(did);

        // Validator-set membership: leaf = blake2b(did), then walk siblings
        if !verify_merkle_proof(&did, proof_slice, proof_len, proof_dirs, validator_root) {
            return Err(Error::AttesterNotInValidatorSet);
        }

        // ed25519 verify
        let pk = PublicKey::from_slice(did_slice).map_err(|_| Error::SignatureVerifyFailed)?;
        let sig = Signature::from_slice(sig_slice).map_err(|_| Error::SignatureVerifyFailed)?;
        pk.verify(signed_payload, &sig)
            .map_err(|_| Error::SignatureVerifyFailed)?;
    }

    Ok(())
}

/// Binary merkle proof verification. Leaf is `blake2b(did)`; each step combines
/// the running hash with the next sibling per `dirs` bitmap (bit i = 0 ⇒
/// sibling is on the right; bit i = 1 ⇒ sibling is on the left). Final hash
/// must equal `root`. Uses CKB's canonical blake2b personalisation so off-chain
/// tooling can use ckb-hash crate directly.
fn verify_merkle_proof(
    did: &[u8],
    proof: &[u8],
    proof_len: usize,
    dirs: u8,
    root: &[u8],
) -> bool {
    let mut current = blake2b_hash(did);
    for i in 0..proof_len {
        let sibling = &proof[i * HASH_LEN..(i + 1) * HASH_LEN];
        let mut buf = [0u8; HASH_LEN * 2];
        if (dirs >> i) & 1 == 0 {
            // sibling on the right
            buf[..HASH_LEN].copy_from_slice(&current);
            buf[HASH_LEN..].copy_from_slice(sibling);
        } else {
            // sibling on the left
            buf[..HASH_LEN].copy_from_slice(sibling);
            buf[HASH_LEN..].copy_from_slice(&current);
        }
        current = blake2b_hash(&buf);
    }
    current.as_slice() == root
}

fn blake2b_hash(input: &[u8]) -> [u8; HASH_LEN] {
    let mut out = [0u8; HASH_LEN];
    let mut hasher = Blake2bBuilder::new(HASH_LEN)
        .personal(CKB_BLAKE2B_PERSONAL)
        .build();
    hasher.update(input);
    hasher.finalize(&mut out);
    out
}

fn read_u64(b: &[u8]) -> u64 {
    let mut buf = [0u8; 8];
    buf.copy_from_slice(&b[..8]);
    u64::from_le_bytes(buf)
}

fn read_u32(b: &[u8]) -> u32 {
    let mut buf = [0u8; 4];
    buf.copy_from_slice(&b[..4]);
    u32::from_le_bytes(buf)
}

fn read_u16(b: &[u8]) -> u16 {
    let mut buf = [0u8; 2];
    buf.copy_from_slice(&b[..2]);
    u16::from_le_bytes(buf)
}
