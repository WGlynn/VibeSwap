//! Reviewable test-spec stub for `bls-verify`. The on-chain crate is
//! a `no_std` library shape and can host `#[cfg(test)]` inline unit
//! tests that run on the host target via `cargo test` once the
//! workspace `cargo test` blockers are cleared (see `tests/README.md`).
//!
//! Currently unit tests live in `src/lib.rs`, `src/aggregate.rs`, and
//! `src/hash_to_curve.rs` under `#[cfg(test)]`. The full integration
//! suite (signed-and-verified end-to-end against generated validator
//! keypairs) belongs in the workspace `tests/` crate as
//! `tests/src/bls_verify_tests.rs` once Capsule + cc on PATH are
//! resolved.
//!
//! Until then this file exists to document the intended test surface
//! so any reviewer can see what coverage we INTEND to ship.

/// Test surface enumerated. Each line is a test case planned for the
/// workspace `tests/` crate, mapped against the error taxonomy in
/// `src/error.rs::BlsError`.
///
/// - `verify_aggregate_happy_path_2of3`:
///     Generate 3 validator keypairs, sign a canonical digest with 2,
///     aggregate via `bls-aggregator`, verify on-chain ⇒ Ok.
/// - `verify_aggregate_happy_path_16of24`:
///     Genesis-set case. 24-validator registry, 2/3 threshold ⇒ 16
///     signers minimum. Stresses the Phase-A pubkey reconstruction at
///     the spec's default genesis size (per task brief).
/// - `verify_aggregate_happy_path_100of200`:
///     Stress test at the spec's 200-validator ceiling
///     (`specs/bls12-381-cycle-budget-spike.md §8.4`), 50%
///     participation. Establishes upper-bound cycle reading.
/// - `verify_aggregate_threshold_not_met`:
///     15-of-24 signature against 16-of-24 threshold ⇒
///     `BlsError::ThresholdNotMet`.
/// - `verify_aggregate_bad_signature`:
///     Valid pk_agg, tampered aggregate signature ⇒
///     `BlsError::PairingMismatch`.
/// - `verify_aggregate_bad_message`:
///     Valid signature, tampered message ⇒ `BlsError::PairingMismatch`.
/// - `verify_aggregate_off_curve_pubkey`:
///     One validator's pubkey is replaced with off-curve bytes ⇒
///     `BlsError::PointDecompressionFailed`.
/// - `verify_aggregate_trailing_bit_attack`:
///     Set a trailing bit in the bitmap past N ⇒
///     `BlsError::BitmapOutOfRange`.
/// - `verify_aggregate_bitmap_wrong_length`:
///     Bitmap len != ceil(N/8) ⇒ `BlsError::BitmapSizeMismatch`.
/// - `verify_aggregate_empty_validator_set`:
///     n_validators == 0 ⇒ `BlsError::EmptyValidatorSet`.
/// - `verify_aggregate_threshold_malformed_zero_d`:
///     threshold_d == 0 ⇒ `BlsError::ThresholdMalformed`.
/// - `verify_aggregate_threshold_malformed_n_gt_d`:
///     threshold_n > threshold_d ⇒ `BlsError::ThresholdMalformed`.
/// - `verify_proof_of_possession_happy`:
///     PoP signature over (pubkey, distinct DST) verifies. Closes the
///     rogue-key attack class per Boneh-Drijvers-Neven.
/// - `verify_proof_of_possession_wrong_dst`:
///     PoP signature under MessagingHub DST fails when verified under
///     PoP DST ⇒ `BlsError::PairingMismatch`. Confirms DST
///     domain-separation.
/// - `hash_to_g2_matches_aggregator`:
///     Cross-check the on-chain hash-to-G2 output against the
///     off-chain `bls-aggregator`'s pre-computed hash for the same
///     canonical digest. Confirms DST agreement and serialization
///     determinism.
/// - `aggregate_pubkey_associativity_property`:
///     pk_agg(S_1 ∪ S_2) == pk_agg(S_1) + pk_agg(S_2) for disjoint
///     S_1, S_2. Property test over arbitrary signer sets.
/// - `molecule_digest_canonical`:
///     `molecule_digest::attestation_preimage(...)` produces the exact
///     byte sequence specified in
///     `bls-aggregation/SERIALIZATION_SPEC.md` § Canonical Digest.
///     Byte-for-byte vector check.
///
/// **CYCLE5 SKIP** until workspace `cargo test` blockers are cleared
/// (toolchain pinning + cc on PATH + capsule install).
#[test]
#[ignore = "test surface stub; runnable suite lives in workspace `tests/` crate (CYCLE5)"]
fn test_surface_stub() {
    // The mere existence of this annotated test serves as the
    // reviewable record of intended coverage. The `cargo test --ignored`
    // sweep when the workspace test crate is wired will pick this up
    // as a no-op pass marker.
}
