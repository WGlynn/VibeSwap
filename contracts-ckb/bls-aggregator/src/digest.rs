//! Canonical attestation-digest computation.
//!
//! Builds the exact byte sequence the on-chain AttestationCell will
//! see as the signed message. Per `SERIALIZATION_SPEC.md § Canonical
//! Digest`:
//!
//! 1. Serialize the 5-tuple via the Molecule-style fixed-struct
//!    encoding documented in §2.1 (LE u64 / [u8;32] / LE u128 /
//!    [u8;32] / LE u64 / LE u64 = 92 bytes).
//! 2. Compute `blake2b-256(serialized)` and use the resulting 32 bytes
//!    as the digest fed to the BLS hash-to-curve step.
//!
//! Both off-chain aggregator (this crate) and on-chain verifier
//! (`bls-verify::molecule_digest`) MUST produce identical bytes here.
//! The cross-port test (`hash_to_g2_matches_aggregator` in
//! `bls-verify/tests/`) enforces it.

use crate::AttestationPayload;
use anyhow::{anyhow, Result};
use blake2::{Blake2bVar, digest::{Update, VariableOutput}};

/// Produce the 32-byte canonical attestation digest used as the BLS
/// signed-message.
pub(crate) fn canonical_attestation_digest(
    payload: &AttestationPayload,
    attested_at_epoch: u64,
) -> Result<[u8; 32]> {
    let burn_id = decode_hex_32(&payload.source_burn_id, "source_burn_id")?;
    let dst_recipient =
        decode_hex_32(&payload.destination_recipient, "destination_recipient")?;

    // Molecule fixed-struct layout (matches
    // `bls-verify::molecule_digest::attestation_preimage`):
    //   source_chain_id        : u64 LE   (8 bytes)
    //   source_burn_id         : [u8; 32]
    //   amount                 : u128 LE  (16 bytes)
    //   destination_recipient  : [u8; 32]
    //   destination_chain_id   : u64 LE   (8 bytes)
    //   attested_at_epoch      : u64 LE   (8 bytes)
    // Total: 104 bytes (NOT 92; corrected here vs. an earlier comment).
    let mut buf: Vec<u8> = Vec::with_capacity(104);
    buf.extend_from_slice(&payload.source_chain_id.to_le_bytes());
    buf.extend_from_slice(&burn_id);
    buf.extend_from_slice(&payload.amount.to_le_bytes());
    buf.extend_from_slice(&dst_recipient);
    buf.extend_from_slice(&payload.destination_chain_id.to_le_bytes());
    buf.extend_from_slice(&attested_at_epoch.to_le_bytes());

    let mut hasher = Blake2bVar::new(32).map_err(|e| anyhow!("blake2b: {e}"))?;
    hasher.update(&buf);
    let mut out = [0u8; 32];
    hasher
        .finalize_variable(&mut out)
        .map_err(|e| anyhow!("blake2b finalize: {e}"))?;
    Ok(out)
}

fn decode_hex_32(s: &str, name: &str) -> Result<[u8; 32]> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    let bytes = hex::decode(s).map_err(|e| anyhow!("{name} not hex: {e}"))?;
    if bytes.len() != 32 {
        return Err(anyhow!("{name} must be 32 bytes, got {}", bytes.len()));
    }
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&bytes);
    Ok(arr)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> AttestationPayload {
        AttestationPayload {
            source_chain_id: 1,
            source_burn_id: "00".repeat(32),
            amount: 1_000_000_000,
            destination_recipient: "ff".repeat(32),
            destination_chain_id: 2,
        }
    }

    #[test]
    fn digest_deterministic() {
        let p = fixture();
        let a = canonical_attestation_digest(&p, 42).unwrap();
        let b = canonical_attestation_digest(&p, 42).unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn digest_distinguishes_epoch() {
        let p = fixture();
        let a = canonical_attestation_digest(&p, 42).unwrap();
        let b = canonical_attestation_digest(&p, 43).unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn digest_distinguishes_amount() {
        let mut p = fixture();
        let a = canonical_attestation_digest(&p, 1).unwrap();
        p.amount += 1;
        let b = canonical_attestation_digest(&p, 1).unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn rejects_bad_burn_id_length() {
        let mut p = fixture();
        p.source_burn_id = "00".to_string();
        assert!(canonical_attestation_digest(&p, 1).is_err());
    }
}
