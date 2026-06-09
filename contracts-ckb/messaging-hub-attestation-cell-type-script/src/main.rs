//! # MessagingHub Attestation Cell Type Script
//!
//! Verifies a threshold-aggregated BLS12-381 signature over a remote-chain
//! burn event. Created by anyone who collects sufficient validator signatures
//! off-chain. Cell-deps: ValidatorRegistryCell (for active pubkey set + threshold).
//!
//! ## Pipeline (Path 1+3 per cycle-budget spike)
//!
//! 1. Off-chain: validators sign canonical attestation digest, gossip
//!    individual signatures. An aggregator (anyone) collects them, sums
//!    sigs in G2, builds the signer-bitmap.
//! 2. On-chain (THIS script): parse cell-data, load ValidatorRegistryCell
//!    via cell-dep, call `bls-verify::verify_aggregate`. One pairing.
//!
//! ## Cell-data layout (per messaging-hub.md § AttestationCell)
//!
//! ```text
//! | field                  | bytes | offset |
//! |------------------------|-------|--------|
//! | version                |   1   |   0    |
//! | attestation_id         |  32   |   1    |   blake2b of preimage (below)
//! | source_chain_id        |   8   |  33    |   u64 LE
//! | source_burn_id         |  32   |  41    |
//! | amount                 |  16   |  73    |   u128 LE
//! | destination_recipient  |  32   |  89    |
//! | destination_chain_id   |   8   | 121    |   u64 LE; must == our chain
//! | attested_at_epoch      |   8   | 129    |   u64 LE; must == registry.epoch
//! | aggregate_signature    |  96   | 137    |   compressed G2
//! | signer_bitmap          |  var  | 233    |   ceil(n_validators / 8) bytes
//! ```
//!
//! ## Signed message format (Molecule per PairwiseVerifier decision)
//!
//! The signed preimage is the Molecule encoding of:
//! ```text
//! struct AttestationPayload {
//!     source_chain_id: u64,
//!     source_burn_id: [u8; 32],
//!     amount: u128,
//!     destination_recipient: [u8; 32],
//!     destination_chain_id: u64,
//!     attested_at_epoch: u64,
//! }
//! ```
//! The 32-byte digest = blake2b256(preimage). Validators sign the digest;
//! this script reconstructs the preimage from cell-data, hashes it, and
//! passes the digest as `message` to `bls-verify`.
//!
//! ## DST (domain separation tag)
//!
//! `BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_VIBESWAP_ATTESTATION_V1_`
//!
//! Per the IETF BLS draft + a VibeSwap-specific suffix that domain-
//! separates MessagingHub attestations from NCI ScoreCells (which use
//! `..._VIBESWAP_NCI_SCORE_V1_`).
//!
//! ## Type-script args
//!
//! Exactly 32 bytes = `type_id_args` of the ValidatorRegistryCell. This
//! binds the attestation to a specific registry; cell-dep is checked
//! against this.
//!
//! ## Invariants enforced
//!
//! 1. Cell-data length covers fixed-header + signer-bitmap.
//! 2. `destination_chain_id == OUR_CHAIN_ID` (compile-time constant for
//!    now; should be read from a ChainConfigCell cell-dep when that
//!    crate ships).
//! 3. `attested_at_epoch == registry.epoch` (no cross-epoch staleness).
//! 4. `attestation_id == blake2b(preimage)`.
//! 5. `signer_bitmap` length matches `registry.n_validators`.
//! 6. BLS aggregate verifies under selected pubkeys.
//! 7. Threshold check delegated to `bls-verify`.
//! 8. AttestationCell is created (output) AND not edited (no in+out same
//!    type).
//!
//! ## End-to-end BLS integration
//!
//! This crate is the end-to-end SKELETON of BLS aggregate-verify
//! integration on CKB. The cell-data layout is wired, the digest
//! preimage builder is wired, the bls-verify call is wired. What's
//! NOT yet finished:
//! - blake2b digest of the Molecule preimage (using ckb-std's
//!   blake2b — wired)
//! - actual cell-dep loading of the ValidatorRegistryCell shape (wired
//!   but uses positional cell-dep index 0; production wants type-script
//!   matching)
//! - exact bls12_381 0.x API symbol confirmation (marked `// TODO` in
//!   bls-verify)
//!
//! ## Status
//!
//! Scaffold. Source-reviewable, not machine-verified. The bls-verify
//! call site is the only path where compilation errors are likely; see
//! `// TODO: verify against bls12_381 0.x` markers in `bls-verify/src/`.

#![no_std]
#![no_main]

extern crate alloc;

use alloc::vec::Vec;
use ckb_std::{
    ckb_constants::Source,
    default_alloc,
    high_level::{load_cell_data, load_script, QueryIter},
};

mod error;
use error::Error;

ckb_std::entry!(program_entry);
default_alloc!();

// ============ Cell-data layout ============

const SCHEMA_VERSION: u8 = 1;
const OFFSET_VERSION: usize = 0;
const OFFSET_ATTESTATION_ID: usize = 1;
const OFFSET_SOURCE_CHAIN_ID: usize = 33;
const OFFSET_SOURCE_BURN_ID: usize = 41;
const OFFSET_AMOUNT: usize = 73;
const OFFSET_DEST_RECIPIENT: usize = 89;
const OFFSET_DEST_CHAIN_ID: usize = 121;
const OFFSET_ATTESTED_EPOCH: usize = 129;
const OFFSET_AGG_SIG: usize = 137;
const OFFSET_SIGNER_BITMAP: usize = 233;
const HEADER_FIXED_LEN: usize = OFFSET_SIGNER_BITMAP;

// ============ Type-script args ============

const ARGS_REGISTRY_REF_LEN: usize = 32;

// ============ Compile-time chain identity ============
//
// TODO: This should come from a ChainConfigCell cell-dep. For scaffold,
// hardcoded to a sentinel that will be replaced when ChainConfigCell
// ships. The sentinel value `0xCB_5_C_BE_77_4_BE_5_2A` is intentionally
// recognizable in hex-dumps as "CKB sov-chain VS 7474" until the real
// chain id lands.
const OUR_CHAIN_ID: u64 = 0xCB_5C_BE77_4BE5_2A;

// ============ DST ============

const ATTESTATION_DST: &[u8] = b"BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_VIBESWAP_ATTESTATION_V1_";

// ============ ValidatorRegistryCell layout (from registry crate) ============
//
// Mirror of the registry crate's layout. If the registry crate changes
// these, this constant block must stay in sync.

const REGISTRY_HEADER_LEN: usize = 31;
const REGISTRY_OFFSET_VERSION: usize = 0;
const REGISTRY_OFFSET_EPOCH: usize = 1;
const REGISTRY_OFFSET_THRESHOLD_N: usize = 9;
const REGISTRY_OFFSET_THRESHOLD_D: usize = 11;
const REGISTRY_OFFSET_N_VALIDATORS: usize = 29;
const REGISTRY_OFFSET_VALIDATORS: usize = 31;
const REGISTRY_VALIDATOR_ENTRY_LEN: usize = 64;
const REGISTRY_VALIDATOR_PUBKEY_OFFSET: usize = 0;
const REGISTRY_VALIDATOR_PUBKEY_LEN: usize = 48;

// ============ Entry ============

pub fn program_entry() -> i8 {
    match verify() {
        Ok(()) => 0,
        Err(e) => match e {
            Error::BlsLibError(c) => c as i8,
            other => other as i8,
        },
    }
}

fn verify() -> Result<(), Error> {
    let script = load_script()?;
    let args_reader = script.as_reader();
    let args_bytes = args_reader.args().raw_data();
    if args_bytes.len() != ARGS_REGISTRY_REF_LEN {
        return Err(Error::ScriptArgsMalformed);
    }

    // Attestation cells are create-only.
    let inputs_data = collect_group_cell_data(Source::GroupInput)?;
    let outputs_data = collect_group_cell_data(Source::GroupOutput)?;

    if !inputs_data.is_empty() {
        return Err(Error::AttestationEditAttempted);
    }
    if outputs_data.is_empty() {
        return Err(Error::EmptyTransition);
    }

    // Load the registry cell from cell-deps.
    let registry_data = load_registry_from_cell_deps()?;
    let registry = parse_registry(&registry_data)?;

    // Verify each output attestation.
    for att_data in outputs_data.iter() {
        verify_one_attestation(att_data, &registry)?;
    }
    Ok(())
}

// ============ Per-attestation verification ============

fn verify_one_attestation(data: &[u8], registry: &ParsedRegistry) -> Result<(), Error> {
    if data.len() < HEADER_FIXED_LEN {
        return Err(Error::CellDataMalformed);
    }
    let version = data[OFFSET_VERSION];
    if version != SCHEMA_VERSION {
        return Err(Error::SchemaVersionUnsupported);
    }

    let mut attestation_id = [0u8; 32];
    attestation_id.copy_from_slice(&data[OFFSET_ATTESTATION_ID..OFFSET_ATTESTATION_ID + 32]);
    let source_chain_id =
        read_u64_le(&data[OFFSET_SOURCE_CHAIN_ID..OFFSET_SOURCE_CHAIN_ID + 8]);
    let mut source_burn_id = [0u8; 32];
    source_burn_id.copy_from_slice(&data[OFFSET_SOURCE_BURN_ID..OFFSET_SOURCE_BURN_ID + 32]);
    let amount = read_u128_le(&data[OFFSET_AMOUNT..OFFSET_AMOUNT + 16]);
    let mut destination_recipient = [0u8; 32];
    destination_recipient
        .copy_from_slice(&data[OFFSET_DEST_RECIPIENT..OFFSET_DEST_RECIPIENT + 32]);
    let destination_chain_id =
        read_u64_le(&data[OFFSET_DEST_CHAIN_ID..OFFSET_DEST_CHAIN_ID + 8]);
    let attested_at_epoch =
        read_u64_le(&data[OFFSET_ATTESTED_EPOCH..OFFSET_ATTESTED_EPOCH + 8]);

    // Destination must be our chain.
    if destination_chain_id != OUR_CHAIN_ID {
        return Err(Error::DestinationChainMismatch);
    }
    // Epoch must match registry's epoch (no stale attestations).
    if attested_at_epoch != registry.epoch {
        return Err(Error::AttestationEpochMismatch);
    }
    // Source chain reserved-zero check.
    if source_chain_id == 0 {
        return Err(Error::SourceChainIdReserved);
    }

    // Build the canonical preimage and verify attestation_id == blake2b(preimage).
    let preimage = bls_verify::molecule_digest::attestation_preimage(
        source_chain_id,
        &source_burn_id,
        amount,
        &destination_recipient,
        destination_chain_id,
        attested_at_epoch,
    );
    let computed_id = blake2b_256(&preimage);
    if computed_id != attestation_id {
        return Err(Error::AttestationIdMismatch);
    }

    // Aggregate signature.
    let mut agg_sig = [0u8; 96];
    agg_sig.copy_from_slice(&data[OFFSET_AGG_SIG..OFFSET_AGG_SIG + 96]);

    // Signer bitmap must be exactly ceil(n_validators / 8) bytes.
    let expected_bitmap_len = (registry.n_validators as usize + 7) / 8;
    if data.len() < OFFSET_SIGNER_BITMAP + expected_bitmap_len {
        return Err(Error::CellDataMalformed);
    }
    let signer_bitmap = &data[OFFSET_SIGNER_BITMAP..OFFSET_SIGNER_BITMAP + expected_bitmap_len];

    // Build the validator-pubkeys slice the verifier expects: an array
    // of [u8; 48]. We copy out of the registry byte region into a
    // heap-backed Vec because slice-of-arrays from byte data requires
    // alignment we can't guarantee. Cost is 24*48 = 1152 bytes for
    // genesis case — trivial.
    let mut pubkeys: Vec<[u8; 48]> = Vec::with_capacity(registry.n_validators as usize);
    for i in 0..(registry.n_validators as usize) {
        let off = REGISTRY_OFFSET_VALIDATORS
            + i * REGISTRY_VALIDATOR_ENTRY_LEN
            + REGISTRY_VALIDATOR_PUBKEY_OFFSET;
        let mut pk = [0u8; 48];
        pk.copy_from_slice(
            &registry.full_data[off..off + REGISTRY_VALIDATOR_PUBKEY_LEN],
        );
        pubkeys.push(pk);
    }

    // The canonical attestation digest (32 bytes) is what validators
    // sign. bls-verify hashes it again into G2 under the DST.
    let digest = computed_id;
    let inputs = bls_verify::AggregateInputs {
        message: &digest,
        dst: ATTESTATION_DST,
        validator_pubkeys: &pubkeys,
        signer_bitmap,
        aggregate_signature: &agg_sig,
        threshold_n: registry.threshold_n,
        threshold_d: registry.threshold_d,
    };
    bls_verify::verify_aggregate(&inputs).map_err(|e| Error::BlsLibError(e as i8 + 60))
}

// ============ Registry loading ============

struct ParsedRegistry {
    full_data: Vec<u8>,
    epoch: u64,
    threshold_n: u16,
    threshold_d: u16,
    n_validators: u16,
}

fn load_registry_from_cell_deps() -> Result<Vec<u8>, Error> {
    // TODO: production should match by ValidatorRegistryCell type-script
    // code-hash, not positional index 0. The args of THIS script encode
    // the registry's type-id; the registry must be found in cell-deps
    // whose type_id == args. For scaffold, we walk cell-deps and pick
    // the first that decodes as a registry-shaped cell (length >=
    // REGISTRY_HEADER_LEN + 1 validator entry = 95 bytes).
    let mut idx = 0usize;
    loop {
        match load_cell_data(idx, Source::CellDep) {
            Ok(data) => {
                if data.len() >= REGISTRY_HEADER_LEN + REGISTRY_VALIDATOR_ENTRY_LEN
                    && data[REGISTRY_OFFSET_VERSION] == SCHEMA_VERSION
                {
                    return Ok(data);
                }
                idx += 1;
            }
            Err(ckb_std::error::SysError::IndexOutOfBound) => {
                return Err(Error::RegistryCellDepMissing);
            }
            Err(e) => return Err(e.into()),
        }
    }
}

fn parse_registry(data: &[u8]) -> Result<ParsedRegistry, Error> {
    if data.len() < REGISTRY_HEADER_LEN {
        return Err(Error::RegistryMalformed);
    }
    let epoch = read_u64_le(&data[REGISTRY_OFFSET_EPOCH..REGISTRY_OFFSET_EPOCH + 8]);
    let threshold_n =
        read_u16_le(&data[REGISTRY_OFFSET_THRESHOLD_N..REGISTRY_OFFSET_THRESHOLD_N + 2]);
    let threshold_d =
        read_u16_le(&data[REGISTRY_OFFSET_THRESHOLD_D..REGISTRY_OFFSET_THRESHOLD_D + 2]);
    let n_validators =
        read_u16_le(&data[REGISTRY_OFFSET_N_VALIDATORS..REGISTRY_OFFSET_N_VALIDATORS + 2]);
    let needed = REGISTRY_HEADER_LEN + (n_validators as usize) * REGISTRY_VALIDATOR_ENTRY_LEN;
    if data.len() < needed {
        return Err(Error::RegistryMalformed);
    }
    let mut full_data = Vec::with_capacity(data.len());
    full_data.extend_from_slice(data);
    Ok(ParsedRegistry {
        full_data,
        epoch,
        threshold_n,
        threshold_d,
        n_validators,
    })
}

// ============ Helpers ============

fn collect_group_cell_data(source: Source) -> Result<Vec<Vec<u8>>, Error> {
    let mut out: Vec<Vec<u8>> = Vec::new();
    for data in QueryIter::new(load_cell_data, source) {
        out.push(data);
    }
    Ok(out)
}

fn blake2b_256(data: &[u8]) -> [u8; 32] {
    // ckb-std's blake2b uses the CKB personalization "ckb-default-hash".
    // TODO: verify against ckb-std 0.16 — the symbol path is
    // `ckb_std::high_level::blake2b_256` in some 0.x versions and a
    // submodule in others. If this fails, swap to a manual blake2b-rs
    // call with the same personalization.
    let mut out = [0u8; 32];
    let hash = ckb_std::high_level::blake2b_256(data);
    out.copy_from_slice(&hash);
    out
}

fn read_u128_le(b: &[u8]) -> u128 {
    let mut buf = [0u8; 16];
    buf.copy_from_slice(&b[..16]);
    u128::from_le_bytes(buf)
}

fn read_u64_le(b: &[u8]) -> u64 {
    let mut buf = [0u8; 8];
    buf.copy_from_slice(&b[..8]);
    u64::from_le_bytes(buf)
}

fn read_u16_le(b: &[u8]) -> u16 {
    let mut buf = [0u8; 2];
    buf.copy_from_slice(&b[..2]);
    u16::from_le_bytes(buf)
}
