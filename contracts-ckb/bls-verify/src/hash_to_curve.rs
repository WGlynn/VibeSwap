//! Hash-to-G2 implementation per IETF BLS draft-irtf-cfrg-bls-signature-05.
//!
//! The signed-message is hashed into G2 via the SSWU map with
//! cofactor clearing. The ciphersuite is
//! `BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_` with the caller's DST
//! appended (see AggregateInputs.dst).
//!
//! Cost analysis (per spike Phase B): ~3M-5M cycles. Dominated by
//! the SSWU map + cofactor clear. Negligible vs the pairing.

use super::BlsError;
use bls12_381::G2Projective;

/// Hash a message to a G2 point under the spec'd DST.
///
/// Per the spike, the message is the canonical Molecule-encoded
/// attestation digest (already a 32-byte blake2b hash for AttestationCell,
/// or the score-payload digest for NCI ScoreCell).
pub(crate) fn hash_to_g2(message: &[u8], dst: &[u8]) -> Result<G2Projective, BlsError> {
    // TODO: verify against bls12_381 0.x — the `hash_to_curve` API lives
    // behind the `experimental` feature in 0.8.x; in 0.9+ it may be
    // promoted to the default surface. The shape below uses the typical
    // `HashToCurve::hash_to_curve(msg, dst)` trait method.
    //
    // If the feature gate is wrong: enable `bls12_381 = { features =
    // ["experimental", ...] }` in bls-verify's Cargo.toml. If the
    // symbol path differs: it might be
    // `bls12_381::hash_to_curve::HashToCurve` or
    // `bls12_381::G2Projective::hash_to_curve`. Both shapes exist
    // across versions.
    use bls12_381::hash_to_curve::{ExpandMsgXmd, HashToCurve};
    let point = <G2Projective as HashToCurve<ExpandMsgXmd<sha2::Sha256>>>::hash_to_curve(
        message, dst,
    );
    Ok(point)
}
