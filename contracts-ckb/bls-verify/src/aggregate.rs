//! Aggregate-pubkey reconstruction + G1/G2 point decompression.
//!
//! Reused across AttestationCell and (future) NCI ScoreCell.

use super::BlsError;
use alloc::vec::Vec;
use bls12_381::{G1Affine, G1Projective, G2Affine};

/// Extract the set of selected-signer indices from a signer-bitmap.
///
/// Bit `i` (LSB-first within each byte) set ⇒ index `i` selected.
/// We require the bitmap to be EXACTLY ceil(n_validators / 8) bytes —
/// any trailing bits past `n_validators` must be zero. This blocks
/// silent-corruption attacks where an adversary stuffs extra bits.
pub(crate) fn indices_from_bitmap(
    bitmap: &[u8],
    n_validators: usize,
) -> Result<Vec<usize>, BlsError> {
    let expected_len = (n_validators + 7) / 8;
    if bitmap.len() != expected_len {
        return Err(BlsError::BitmapSizeMismatch);
    }
    let mut indices: Vec<usize> = Vec::new();
    for (byte_idx, byte) in bitmap.iter().enumerate() {
        for bit in 0..8u8 {
            let global_idx = byte_idx * 8 + bit as usize;
            let is_set = (byte >> bit) & 1 == 1;
            if global_idx >= n_validators {
                // Trailing bits past the validator set must be zero.
                if is_set {
                    return Err(BlsError::BitmapOutOfRange);
                }
                continue;
            }
            if is_set {
                indices.push(global_idx);
            }
        }
    }
    Ok(indices)
}

/// Aggregate the selected pubkeys: `pk_agg = Σ pk_i` in G1.
///
/// Cost analysis (per spike Phase A): one G1 add ≈ 11 Fp mul-equivalents
/// ≈ ~50K cycles. For a 24-validator threshold (Will-decided genesis set
/// size), this is ~24 * 50K = 1.2M cycles. Negligible vs. the 50M-cycle
/// pairing.
pub(crate) fn aggregate_pubkeys(
    pubkeys: &[[u8; 48]],
    selected: &[usize],
) -> Result<G1Affine, BlsError> {
    // Sum in projective space to avoid intermediate-to-affine conversions.
    // TODO: verify against bls12_381 0.x — G1Projective::identity() and
    // += G1Affine should compile; if API renamed (e.g. G1Projective::zero())
    // adjust here.
    let mut acc = G1Projective::identity();
    for &idx in selected {
        let pk = decompress_g1(&pubkeys[idx])?;
        acc += G1Projective::from(pk);
    }
    Ok(acc.into())
}

/// Decompress a 48-byte G1 point (BLS12-381 compressed encoding).
pub(crate) fn decompress_g1(bytes: &[u8; 48]) -> Result<G1Affine, BlsError> {
    // bls12_381 0.8.x: G1Affine::from_compressed returns CtOption.
    let opt = G1Affine::from_compressed(bytes);
    if opt.is_some().into() {
        Ok(opt.unwrap())
    } else {
        Err(BlsError::PointDecompressionFailed)
    }
}

/// Decompress a 96-byte G2 point (BLS12-381 compressed encoding).
pub(crate) fn decompress_g2(bytes: &[u8; 96]) -> Result<G2Affine, BlsError> {
    let opt = G2Affine::from_compressed(bytes);
    if opt.is_some().into() {
        Ok(opt.unwrap())
    } else {
        Err(BlsError::PointDecompressionFailed)
    }
}
