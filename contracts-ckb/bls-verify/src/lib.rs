//! # bls-verify — shared BLS12-381 aggregate-signature verifier
//!
//! This crate implements the on-chain side of the Path 1+3 architecture
//! decided in `contracts-ckb/specs/bls12-381-cycle-budget-spike.md` §5:
//!
//! - **Off-chain** (Path 3): validators aggregate their individual
//!   signatures into a single 96-byte aggregate sig + a signer-bitmap.
//! - **On-chain** (Path 1): the type-script reconstructs `pk_agg` over
//!   the selected signers (linear-in-bitmap-count, cheap G1 adds),
//!   hashes the message to G2, and runs a single pairing equality check.
//!
//! ## Public surface
//!
//! Two functions, both `no_std`:
//!
//! - `verify_aggregate(...)` — verify a threshold-aggregated signature
//!   against the active validator set.
//! - `verify_proof_of_possession(...)` — verify a single PoP signature
//!   used at validator-bond time to close the rogue-key attack class.
//!
//! Consumers (AttestationCell type-script, future NCI ScoreCell
//! type-script) call into this crate; they do not touch the bls12_381
//! API directly. This isolates the audit surface to one place.
//!
//! ## Cycle budget
//!
//! Per the spike, a 100-signer aggregate-verify lands at ~60M cycles
//! post-MOP, ~75-90M pre-MOP. `max_block_cycles` is 3.5B. Headroom is
//! ~50x. The spike's recommendation is to ship Path 1+3 and revisit
//! only if attestation throughput pushes the budget.
//!
//! ## Status
//!
//! Skeleton — the public API is finalized but the pairing call site is
//! marked with `// TODO: verify against bls12_381 0.x` because the
//! exact `pairing` / `multi_miller_loop` symbol-names shift between
//! minor versions. The shape is correct; the symbols may need a `cargo
//! check` pass to lock in.

#![no_std]

extern crate alloc;

use alloc::vec::Vec;

mod aggregate;
mod error;
mod hash_to_curve;

pub use error::BlsError;

/// Inputs to a threshold-aggregate signature verification.
///
/// The `validator_pubkeys` slice is the canonical ordering of the
/// active validator set as recorded in the ValidatorRegistryCell. The
/// `signer_bitmap` selects which validators contributed: bit `i` set
/// (LSB-first within each byte) means `validator_pubkeys[i]`'s public
/// key is included in `pk_agg`.
///
/// `threshold_n / threshold_d` is the active-epoch threshold (e.g.
/// 16/24 = 2/3 of a 24-validator set). The call rejects with
/// `ThresholdNotMet` if the bitmap selects fewer than
/// `ceil(validator_pubkeys.len() * threshold_n / threshold_d)` signers.
pub struct AggregateInputs<'a> {
    /// Canonical attestation digest (already hashed to 32 bytes). For
    /// MessagingHub this is `blake2b(Molecule(attestation_payload))`.
    /// For NCI this is `blake2b(Molecule(score_payload))`.
    pub message: &'a [u8],
    /// Domain separation tag for hash-to-curve. Per IETF BLS draft §4.2.3,
    /// the suite ID is e.g. `BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_`.
    /// VibeSwap appends a context byte: `..._VIBESWAP_ATTESTATION_` or
    /// `..._VIBESWAP_NCI_SCORE_`.
    pub dst: &'a [u8],
    /// Validator BLS public keys in canonical registry order; 48 bytes each.
    pub validator_pubkeys: &'a [[u8; 48]],
    /// Bit i (LSB-first) set => validator i contributed to aggregate.
    pub signer_bitmap: &'a [u8],
    /// Aggregated BLS signature (G2 compressed encoding).
    pub aggregate_signature: &'a [u8; 96],
    /// Threshold numerator (e.g. 16).
    pub threshold_n: u16,
    /// Threshold denominator (e.g. 24).
    pub threshold_d: u16,
}

/// Verify a threshold-aggregate BLS12-381 signature.
///
/// Returns `Ok(())` if (a) the bitmap selects at least the threshold
/// number of validators, (b) the aggregate signature verifies under the
/// aggregated public key, and (c) all inputs decode as valid G1/G2
/// points.
pub fn verify_aggregate(inputs: &AggregateInputs<'_>) -> Result<(), BlsError> {
    // 1. Validate threshold parameters.
    if inputs.threshold_d == 0 {
        return Err(BlsError::ThresholdMalformed);
    }
    if inputs.threshold_n > inputs.threshold_d {
        return Err(BlsError::ThresholdMalformed);
    }
    let n_validators = inputs.validator_pubkeys.len();
    if n_validators == 0 {
        return Err(BlsError::EmptyValidatorSet);
    }

    // 2. Count + collect selected signer indices from the bitmap.
    let signer_indices = aggregate::indices_from_bitmap(inputs.signer_bitmap, n_validators)?;
    let n_signers = signer_indices.len();

    // 3. Threshold check: signers >= ceil(n * threshold_n / threshold_d).
    // Use u64 widening to avoid u16 overflow on large validator sets.
    let n_required = ((n_validators as u64)
        .checked_mul(inputs.threshold_n as u64)
        .ok_or(BlsError::ArithmeticOverflow)?
        + (inputs.threshold_d as u64 - 1))
        / (inputs.threshold_d as u64);
    if (n_signers as u64) < n_required {
        return Err(BlsError::ThresholdNotMet);
    }

    // 4. Aggregate selected pubkeys: pk_agg = Σ pk_i.
    let pk_agg = aggregate::aggregate_pubkeys(inputs.validator_pubkeys, &signer_indices)?;

    // 5. Hash the message to G2 under the spec'd DST.
    let h_m = hash_to_curve::hash_to_g2(inputs.message, inputs.dst)?;

    // 6. Decompress aggregate signature.
    let sig = aggregate::decompress_g2(inputs.aggregate_signature)?;

    // 7. Pairing equality: e(g1, sig) == e(pk_agg, H(m)).
    // TODO: verify against bls12_381 0.x — exact symbol names for
    // `G1Affine::generator()` and `pairing()` shift between minor
    // versions. The shape below assumes the 0.8.x API.
    let g1_generator = bls12_381::G1Affine::generator();
    let lhs = bls12_381::pairing(&g1_generator, &sig.into());
    let rhs = bls12_381::pairing(&pk_agg.into(), &h_m.into());

    if lhs == rhs {
        Ok(())
    } else {
        Err(BlsError::PairingMismatch)
    }
}

/// Verify a proof-of-possession signature for a validator pubkey.
///
/// Per Boneh-Drijvers-Neven and the IETF BLS draft, PoP closes the
/// rogue-key attack on aggregate signatures. At bond time the validator
/// signs their own public key under a distinct DST; the
/// ValidatorBondCell type-script calls this to verify.
pub fn verify_proof_of_possession(
    pubkey: &[u8; 48],
    pop_signature: &[u8; 96],
    pop_dst: &[u8],
) -> Result<(), BlsError> {
    let pk = aggregate::decompress_g1(pubkey)?;
    let sig = aggregate::decompress_g2(pop_signature)?;
    // PoP message is the canonical encoding of the pubkey itself.
    let h_m = hash_to_curve::hash_to_g2(pubkey, pop_dst)?;
    let g1_generator = bls12_381::G1Affine::generator();
    let lhs = bls12_381::pairing(&g1_generator, &sig.into());
    let rhs = bls12_381::pairing(&pk.into(), &h_m.into());
    if lhs == rhs {
        Ok(())
    } else {
        Err(BlsError::PairingMismatch)
    }
}

// Re-export submodule helpers for the AttestationCell + ValidatorRegistry
// crates that need to compute Molecule digests over the same canonical
// shape this verifier expects.
pub mod molecule_digest {
    //! Canonical Molecule-shape attestation digest (32 bytes).
    //!
    //! Per the cycle-budget spike Q3 + the PairwiseVerifier spec, the
    //! signed-message for an AttestationCell is:
    //!
    //! ```text
    //! Molecule(struct {
    //!     source_chain_id: u64,
    //!     source_burn_id: [u8; 32],
    //!     amount: u128,
    //!     destination_recipient: [u8; 32],
    //!     destination_chain_id: u64,
    //!     attested_at_epoch: u64,
    //! })
    //! ```
    //!
    //! The 32-byte digest is `blake2b256` over the Molecule encoding.

    use super::Vec;

    /// Build the canonical pre-image (Molecule-encoded fields concatenated).
    pub fn attestation_preimage(
        source_chain_id: u64,
        source_burn_id: &[u8; 32],
        amount: u128,
        destination_recipient: &[u8; 32],
        destination_chain_id: u64,
        attested_at_epoch: u64,
    ) -> Vec<u8> {
        // Molecule fixed-struct ordering: little-endian for primitives,
        // raw bytes for arrays. No length prefix on fixed-size structs.
        let mut out = Vec::with_capacity(8 + 32 + 16 + 32 + 8 + 8);
        out.extend_from_slice(&source_chain_id.to_le_bytes());
        out.extend_from_slice(source_burn_id);
        out.extend_from_slice(&amount.to_le_bytes());
        out.extend_from_slice(destination_recipient);
        out.extend_from_slice(&destination_chain_id.to_le_bytes());
        out.extend_from_slice(&attested_at_epoch.to_le_bytes());
        out
    }
}
