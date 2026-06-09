//! Witness-blob encoder.
//!
//! Encodes the aggregated attestation as a length-prefixed binary blob
//! ready for direct embedding in a CKB transaction witness array. The
//! on-chain `messaging-hub-attestation-cell-type-script` parses this
//! same layout in reverse.
//!
//! Per `SERIALIZATION_SPEC.md § Witness Layout`:
//!
//! ```text
//! | offset            | size       | field               |
//! |-------------------|------------|---------------------|
//! | 0                 | 1          | version (= 1)       |
//! | 1                 | 32         | canonical_digest    |
//! | 33                | 96         | aggregate_signature |
//! | 129               | 2 (u16 LE) | n_validators        |
//! | 131               | ceil(N/8)  | signer_bitmap       |
//! | 131 + ceil(N/8)   | 8 (u64 LE) | attested_at_epoch   |
//! ```
//!
//! Total: 139 + ceil(N/8) bytes. Length is fully recoverable from the
//! `n_validators` field alone, so the on-chain parser does not need a
//! separate length prefix.

/// Encode the aggregated witness blob.
pub(crate) fn encode(
    canonical_digest: [u8; 32],
    aggregate_signature: &[u8; 96],
    n_validators: u16,
    signer_bitmap: &[u8],
    attested_at_epoch: u64,
) -> Vec<u8> {
    let bitmap_len = ((n_validators as usize) + 7) / 8;
    debug_assert_eq!(signer_bitmap.len(), bitmap_len);
    let total = 1 + 32 + 96 + 2 + bitmap_len + 8;
    let mut out = Vec::with_capacity(total);
    out.push(1u8); // version
    out.extend_from_slice(&canonical_digest);
    out.extend_from_slice(aggregate_signature);
    out.extend_from_slice(&n_validators.to_le_bytes());
    out.extend_from_slice(signer_bitmap);
    out.extend_from_slice(&attested_at_epoch.to_le_bytes());
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_known_layout() {
        let digest = [0xAAu8; 32];
        let sig = [0xBBu8; 96];
        let bitmap = vec![0x05u8]; // 3 validators ⇒ ceil(3/8)=1
        let blob = encode(digest, &sig, 3, &bitmap, 42);
        assert_eq!(blob.len(), 1 + 32 + 96 + 2 + 1 + 8);
        assert_eq!(blob[0], 1);
        assert_eq!(&blob[1..33], &digest[..]);
        assert_eq!(&blob[33..129], &sig[..]);
        // n_validators LE
        assert_eq!(&blob[129..131], &3u16.to_le_bytes()[..]);
        assert_eq!(blob[131], 0x05);
        // attested_at_epoch LE
        assert_eq!(&blob[132..140], &42u64.to_le_bytes()[..]);
    }

    #[test]
    fn encode_24_validators_genesis_size() {
        // Genesis case from the task brief: 24 validators ⇒ ceil(24/8)=3
        let digest = [0u8; 32];
        let sig = [0u8; 96];
        let bitmap = vec![0xFF, 0xFF, 0xFF];
        let blob = encode(digest, &sig, 24, &bitmap, 0);
        assert_eq!(blob.len(), 1 + 32 + 96 + 2 + 3 + 8);
    }
}
