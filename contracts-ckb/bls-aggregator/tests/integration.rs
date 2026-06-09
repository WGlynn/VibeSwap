//! Reviewable integration-test scaffold for `bls-aggregator`.
//!
//! The runnable suite requires a host-side BLS keygen + signing harness
//! to produce synthetic per-validator signature files. That harness is
//! straightforward (use `bls12_381::Scalar::random + g1_gen * sk` to
//! generate pubkeys, sign with `sk * H(m)` in G2) but introduces a
//! `rand_core::OsRng` dep that's currently parked behind the same dev-
//! machine blockers as the rest of the chain-build (see
//! `contracts-ckb/tests/README.md`).
//!
//! Until the harness lands this file enumerates intended coverage so a
//! reviewer can audit the planned test surface.

/// Integration test surface enumerated.
///
/// - `aggregate_3_of_3_happy_path`:
///     Generate 3 keypairs, sign the same digest with all 3, aggregate,
///     decode the witness, hand to a mock `bls-verify::verify_aggregate`
///     ⇒ Ok.
/// - `aggregate_2_of_3_threshold_met`:
///     Sign with 2 of 3, default threshold 2/3 ⇒ Ok.
/// - `aggregate_1_of_3_threshold_not_met`:
///     Sign with 1 of 3, default threshold 2/3 ⇒ exits with non-zero,
///     no output file written.
/// - `aggregate_24_of_24_genesis_set`:
///     Full-participation genesis set, witness blob length == 142 bytes.
/// - `aggregate_16_of_24_genesis_threshold`:
///     Genesis 2/3 threshold met exactly. Bitmap has 16 of 24 bits set.
/// - `aggregate_skips_bad_individual_signature`:
///     One sig file has a corrupted signature_hex. Aggregator logs
///     "individual verify failed", skips it, still meets threshold ⇒
///     witness contains the OTHER signers' aggregate.
/// - `aggregate_skips_pubkey_mismatch_vs_registry`:
///     One sig file claims an index whose pubkey doesn't match the
///     registry entry ⇒ skipped, logged.
/// - `aggregate_rejects_validator_index_out_of_range`:
///     Sig file claims index >= n_validators ⇒ skipped.
/// - `digest_matches_on_chain_preimage`:
///     `digest::canonical_attestation_digest(...)` produces the SAME
///     bytes as `bls-verify::molecule_digest::attestation_preimage(...)`
///     followed by blake2b-256. Confirms cross-port byte-equality.
/// - `witness_round_trip_decode`:
///     Encode a witness, parse it back via the on-chain
///     attestation-cell decoder ⇒ all fields preserved.
/// - `cli_arg_parsing_smoke`:
///     `bls-aggregator --help` returns 0 and emits all 6 required flags.
/// - `large_validator_set_200`:
///     200 validators, 134 signers (just above 2/3). Cycle-budget upper-
///     bound case from `specs/bls12-381-cycle-budget-spike.md §8.4`.
///
/// CYCLE5 SKIP until the keygen-harness lands.
#[test]
#[ignore = "integration tests require host-side BLS keygen harness (CYCLE5)"]
fn integration_surface_stub() {
    // Reviewable-record marker. See doc-comment above for the planned
    // test surface.
}
