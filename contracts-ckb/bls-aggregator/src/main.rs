//! # bls-aggregator — off-chain BLS aggregation CLI
//!
//! Reads per-validator signature files from a directory, verifies each
//! against the canonical attestation digest, aggregates the surviving
//! signatures into a single BLS aggregate signature + signer-bitmap,
//! and emits a witness blob ready for direct embedding in a CKB
//! AttestationCell.
//!
//! ## Usage
//!
//! ```text
//! bls-aggregator \
//!     --attestation-payload path/to/attestation.json \
//!     --validator-registry path/to/registry.json \
//!     --signatures-dir path/to/sigs/ \
//!     --output path/to/attestation-witness.bin \
//!     [--min-signers 16]
//! ```
//!
//! - `attestation-payload`: JSON with the 5-tuple `(source_chain_id,
//!   source_burn_id, amount, destination_recipient,
//!   destination_chain_id)` per `SERIALIZATION_SPEC.md`. The aggregator
//!   computes the canonical digest from this and uses it as the
//!   signed-message under the VibeSwap DST.
//! - `validator-registry`: snapshot of the active `ValidatorRegistryCell`
//!   contents as JSON. Provides per-validator BLS pubkey + canonical
//!   ordering (the bitmap index).
//! - `signatures-dir`: directory of per-validator signature files. Each
//!   file is a JSON `{ validator_index, pubkey_hex, signature_hex }`.
//! - `output`: where the aggregated witness blob is written.
//! - `min-signers`: minimum count to bother aggregating (default = the
//!   registry's threshold).
//!
//! ## Witness blob format
//!
//! Per `SERIALIZATION_SPEC.md § Witness Layout`:
//!
//! ```text
//! | offset | size              | field                  |
//! |--------|-------------------|------------------------|
//! | 0      | 1                 | version (= 1)          |
//! | 1      | 32                | canonical_digest       |
//! | 33     | 96                | aggregate_signature    |
//! | 129    | 2 (u16 LE)        | n_validators           |
//! | 131    | ceil(N/8)         | signer_bitmap          |
//! | 131+B  | 8 (u64 LE)        | attested_at_epoch      |
//! | 139+B  | <remainder>       | reserved (= 0 padding) |
//! ```
//!
//! ## Why off-chain
//!
//! Per `specs/bls12-381-cycle-budget-spike.md §4 Path 3`:
//!
//! > Validators aggregate signatures off-chain (as already specified in
//! > `messaging-hub.md` — "validator gossip layer"). The AttestationCell
//! > carries **only** the aggregated signature plus the signer bitmap.
//! > The on-chain type-script does exactly one pairing check.
//!
//! Off-chain aggregation lets us:
//! - Run N individual signature verifies on the host (~10ms each, cheap)
//!   without spending CKB-VM cycles per verify.
//! - Drop signatures that fail individual verify before they corrupt
//!   the aggregate.
//! - Keep the on-chain verify at exactly one pairing-check.
//!
//! ## Status
//!
//! Source-reviewable scaffold. The aggregation loop, witness encoder,
//! and CLI surface are all implemented. The individual-signature verify
//! path leverages the same bls12_381 API as the on-chain `bls-verify`
//! crate so the output is bit-identical (modulo aggregation order — BLS
//! aggregation is commutative in G2, so order does not affect the
//! resulting `aggregate_signature` value).

use anyhow::{anyhow, bail, Context, Result};
use bls12_381::{
    hash_to_curve::{ExpandMsgXmd, HashToCurve},
    G1Affine, G2Affine, G2Projective,
};
use clap::Parser;
use pairing::group::Group;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use subtle::ConstantTimeEq;

mod digest;
mod witness;

/// VibeSwap MessagingHub DST. MUST match `bls-verify::hash::VIBESWAP_BLS_DST`
/// byte-for-byte (any drift breaks signature verification).
pub(crate) const VIBESWAP_BLS_DST: &[u8] =
    b"BLS_SIG_VIBESWAP_MESSAGING_V1_BLS12381G2_XMD:SHA-256_SSWU_RO_";

// ============ CLI ============

#[derive(Parser, Debug)]
#[command(name = "bls-aggregator", about = "VibeSwap MessagingHub BLS aggregator")]
struct Cli {
    /// Path to the attestation payload JSON.
    #[arg(long)]
    attestation_payload: PathBuf,

    /// Path to the validator registry snapshot JSON.
    #[arg(long)]
    validator_registry: PathBuf,

    /// Directory of per-validator signature files.
    #[arg(long)]
    signatures_dir: PathBuf,

    /// Path to write the aggregated witness blob.
    #[arg(long)]
    output: PathBuf,

    /// Override the minimum signer count. Defaults to the registry's
    /// threshold field.
    #[arg(long)]
    min_signers: Option<usize>,

    /// Epoch tag to embed in the witness blob.
    #[arg(long, default_value_t = 0u64)]
    attested_at_epoch: u64,
}

// ============ I/O types ============

#[derive(Debug, Serialize, Deserialize)]
struct AttestationPayload {
    source_chain_id: u64,
    /// 32-byte burn ID as hex.
    source_burn_id: String,
    amount: u128,
    /// 32-byte destination recipient as hex.
    destination_recipient: String,
    destination_chain_id: u64,
}

#[derive(Debug, Serialize, Deserialize)]
struct ValidatorRegistry {
    epoch: u64,
    threshold_n: u16,
    threshold_d: u16,
    validators: Vec<RegistryValidator>,
}

#[derive(Debug, Serialize, Deserialize)]
struct RegistryValidator {
    index: u16,
    /// 48-byte compressed G1 pubkey as hex.
    pubkey_hex: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct SignatureFile {
    validator_index: u16,
    pubkey_hex: String,
    /// 96-byte compressed G2 signature as hex.
    signature_hex: String,
}

// ============ Entry ============

fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();
    let cli = Cli::parse();
    run(cli)
}

fn run(cli: Cli) -> Result<()> {
    // ---- Load inputs ----
    let payload_str = fs::read_to_string(&cli.attestation_payload)
        .with_context(|| format!("read {}", cli.attestation_payload.display()))?;
    let payload: AttestationPayload = serde_json::from_str(&payload_str)?;

    let registry_str = fs::read_to_string(&cli.validator_registry)
        .with_context(|| format!("read {}", cli.validator_registry.display()))?;
    let registry: ValidatorRegistry = serde_json::from_str(&registry_str)?;

    let n_validators = registry.validators.len();
    if n_validators == 0 {
        bail!("validator registry is empty");
    }
    if n_validators > 256 {
        bail!("validator registry exceeds 256 entries (current cap)");
    }

    tracing::info!(
        n_validators,
        threshold = ?(registry.threshold_n, registry.threshold_d),
        "loaded registry"
    );

    // ---- Build canonical digest ----
    let canonical_digest =
        digest::canonical_attestation_digest(&payload, cli.attested_at_epoch)?;
    tracing::info!(
        digest_hex = %hex::encode(canonical_digest),
        "canonical attestation digest"
    );

    // ---- Hash-to-G2 the digest ----
    let h_m = <G2Projective as HashToCurve<ExpandMsgXmd<sha2::Sha256>>>::hash_to_curve(
        &canonical_digest[..],
        VIBESWAP_BLS_DST,
    );
    let h_m_affine: G2Affine = h_m.into();

    // ---- Walk signatures-dir, verify each, accumulate ----
    let mut bitmap = vec![0u8; (n_validators + 7) / 8];
    let mut agg_sig = G2Projective::identity();
    let mut signers: usize = 0;
    let mut skipped: Vec<u16> = Vec::new();

    let entries = fs::read_dir(&cli.signatures_dir)
        .with_context(|| format!("read dir {}", cli.signatures_dir.display()))?;

    for entry in entries {
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            continue;
        }
        let path = entry.path();
        let s = match fs::read_to_string(&path) {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!(path = %path.display(), error = %e, "read failed; skipping");
                continue;
            }
        };
        let sig_file: SignatureFile = match serde_json::from_str(&s) {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!(path = %path.display(), error = %e, "parse failed; skipping");
                continue;
            }
        };

        let idx = sig_file.validator_index as usize;
        if idx >= n_validators {
            tracing::warn!(idx, "validator_index >= n_validators; skipping");
            skipped.push(sig_file.validator_index);
            continue;
        }

        // Cross-check pubkey against registry.
        let registry_pk = &registry
            .validators
            .iter()
            .find(|v| v.index == sig_file.validator_index)
            .ok_or_else(|| anyhow!("validator index {} not in registry", idx))?
            .pubkey_hex;
        if registry_pk != &sig_file.pubkey_hex {
            tracing::warn!(idx, "pubkey mismatch vs registry; skipping");
            skipped.push(sig_file.validator_index);
            continue;
        }

        // Decompress + individual verify.
        let pk_bytes = hex::decode(&sig_file.pubkey_hex)?;
        if pk_bytes.len() != 48 {
            tracing::warn!(idx, "pubkey not 48 bytes; skipping");
            skipped.push(sig_file.validator_index);
            continue;
        }
        let mut pk_arr = [0u8; 48];
        pk_arr.copy_from_slice(&pk_bytes);
        let pk_opt = G1Affine::from_compressed(&pk_arr);
        if bool::from(pk_opt.is_none()) {
            tracing::warn!(idx, "pubkey decompression failed; skipping");
            skipped.push(sig_file.validator_index);
            continue;
        }
        let pk = pk_opt.unwrap();

        let sig_bytes = hex::decode(&sig_file.signature_hex)?;
        if sig_bytes.len() != 96 {
            tracing::warn!(idx, "signature not 96 bytes; skipping");
            skipped.push(sig_file.validator_index);
            continue;
        }
        let mut sig_arr = [0u8; 96];
        sig_arr.copy_from_slice(&sig_bytes);
        let sig_opt = G2Affine::from_compressed(&sig_arr);
        if bool::from(sig_opt.is_none()) {
            tracing::warn!(idx, "signature decompression failed; skipping");
            skipped.push(sig_file.validator_index);
            continue;
        }
        let sig = sig_opt.unwrap();

        // Individual verify: e(g_1, sig_i) == e(pk_i, H(m)).
        if !verify_individual(&pk, &sig, &h_m_affine) {
            tracing::warn!(idx, "individual verify failed; skipping");
            skipped.push(sig_file.validator_index);
            continue;
        }

        // Aggregate.
        bitmap[idx / 8] |= 1u8 << (idx % 8);
        agg_sig += G2Projective::from(&sig);
        signers += 1;
    }

    // ---- Threshold check ----
    let min_signers = cli.min_signers.unwrap_or_else(|| {
        // ceil(n * threshold_n / threshold_d)
        let num = n_validators * registry.threshold_n as usize;
        let den = registry.threshold_d as usize;
        (num + den - 1) / den
    });
    if signers < min_signers {
        tracing::error!(
            signers,
            min_signers,
            skipped = ?skipped,
            "threshold not met; aborting"
        );
        bail!("threshold not met: {} < {}", signers, min_signers);
    }

    let agg_sig_affine: G2Affine = agg_sig.into();
    let agg_sig_bytes = agg_sig_affine.to_compressed();

    // ---- Emit witness ----
    let witness_blob = witness::encode(
        canonical_digest,
        &agg_sig_bytes,
        n_validators as u16,
        &bitmap,
        cli.attested_at_epoch,
    );

    fs::write(&cli.output, &witness_blob)
        .with_context(|| format!("write {}", cli.output.display()))?;

    tracing::info!(
        signers,
        skipped_count = skipped.len(),
        witness_bytes = witness_blob.len(),
        output = %cli.output.display(),
        "aggregation complete"
    );

    Ok(())
}

/// Single-signature BLS verify. Same algebra as the on-chain verify but
/// running on the host. Used as a pre-filter so that bad individual
/// signatures never enter the aggregate.
fn verify_individual(pk: &G1Affine, sig: &G2Affine, h_m: &G2Affine) -> bool {
    use pairing::MultiMillerLoop;
    let g1_gen = G1Affine::generator();
    let neg_h_m = -*h_m;
    let prep_sig = bls12_381::G2Prepared::from(*sig);
    let prep_neg_h = bls12_381::G2Prepared::from(neg_h_m);
    let terms: &[(&G1Affine, &bls12_381::G2Prepared)] = &[
        (&g1_gen, &prep_sig),
        (pk, &prep_neg_h),
    ];
    let miller = bls12_381::Bls12::multi_miller_loop(terms);
    let result = miller.final_exponentiation();
    bool::from(result.0.ct_eq(&bls12_381::Gt::identity().0))
}

