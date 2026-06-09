//! # PrimitiveCell Type Script
//!
//! Enforces structural invariants on PsiNet primitive cells.
//!
//! Validates:
//! - Schema version supported
//! - `content_hash` / `frontmatter_hash` non-zero
//! - `fork_depth <= MAX_FORK_DEPTH` (32)
//! - `fork_depth = parent.fork_depth + 1` if forked
//! - `status` transitions are monotonic (ACTIVE -> DEPRECATED -> SLASHED)
//! - Identity fields immutable post-mint
//!
//! Spec: `vibeswap/docs/research/papers/psinet-ckb-cell-model-canonical-spec.md`
//! Section 2.1.
//!
//! Status: SPEC-ONLY scaffold. Not audit-ready.

#![no_std]
#![no_main]

use ckb_std::{
    ckb_constants::Source,
    default_alloc,
    high_level::{load_cell_data, load_script, QueryIter},
};

ckb_std::entry!(program_entry);
default_alloc!();

const SCHEMA_VERSION: u8 = 1;
const MAX_FORK_DEPTH: u16 = 32;

// Cell data layout offsets (see spec Section 2.1)
const OFFSET_VERSION: usize = 0;
const OFFSET_STATUS: usize = 1;
const OFFSET_CONTENT_HASH: usize = 2;
const OFFSET_FRONTMATTER_HASH: usize = 34;
const OFFSET_FORK_PARENT: usize = 66;
const OFFSET_FORK_DEPTH: usize = 98;
const OFFSET_AUTHOR_AGENT: usize = 100;
const OFFSET_CREATED_AT: usize = 132;
const OFFSET_CITATION_COUNT: usize = 140;
const OFFSET_LAST_CITATION_ROOT: usize = 148;
const MIN_CELL_LEN: usize = 180; // up to content_uri start

// Status values
const STATUS_ACTIVE: u8 = 1;
const STATUS_DEPRECATED: u8 = 2;
const STATUS_SLASHED: u8 = 3;

#[repr(i8)]
enum Error {
    IndexOutOfBound = 1,
    ItemMissing = 2,
    LengthNotEnough = 3,
    Encoding = 4,
    SchemaVersionUnsupported = 10,
    EmptyContentHash = 11,
    ForkDepthExceeded = 12,
    ForkDepthMismatch = 13,
    StatusTransitionInvalid = 14,
    IdentityFieldMutated = 15,
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

fn verify() -> Result<(), Error> {
    let _script = load_script()?;

    // Validate each output cell carrying this type script
    for (i, data) in QueryIter::new(load_cell_data, Source::GroupOutput).enumerate() {
        validate_cell_data(&data)?;
        // If a matching input exists at the same index, enforce
        // identity-field immutability + status monotonicity
        if let Ok(prev) = load_cell_data(i, Source::GroupInput) {
            validate_transition(&prev, &data)?;
        }
    }

    Ok(())
}

fn validate_cell_data(data: &[u8]) -> Result<(), Error> {
    if data.len() < MIN_CELL_LEN {
        return Err(Error::LengthNotEnough);
    }
    if data[OFFSET_VERSION] != SCHEMA_VERSION {
        return Err(Error::SchemaVersionUnsupported);
    }
    // content_hash + frontmatter_hash must be non-zero
    if is_all_zero(&data[OFFSET_CONTENT_HASH..OFFSET_CONTENT_HASH + 32]) {
        return Err(Error::EmptyContentHash);
    }
    if is_all_zero(&data[OFFSET_FRONTMATTER_HASH..OFFSET_FRONTMATTER_HASH + 32]) {
        return Err(Error::EmptyContentHash);
    }
    let fork_depth = u16::from_le_bytes([data[OFFSET_FORK_DEPTH], data[OFFSET_FORK_DEPTH + 1]]);
    if fork_depth > MAX_FORK_DEPTH {
        return Err(Error::ForkDepthExceeded);
    }
    // If forked (parent non-zero), fork_depth must be > 0
    let parent_zero = is_all_zero(&data[OFFSET_FORK_PARENT..OFFSET_FORK_PARENT + 32]);
    if !parent_zero && fork_depth == 0 {
        return Err(Error::ForkDepthMismatch);
    }
    if parent_zero && fork_depth != 0 {
        return Err(Error::ForkDepthMismatch);
    }
    // CYCLE5: also fetch parent cell from CellDeps and verify
    // `fork_depth = parent.fork_depth + 1`. Requires cell-dep lookup helper.
    Ok(())
}

fn validate_transition(prev: &[u8], next: &[u8]) -> Result<(), Error> {
    if prev.len() < MIN_CELL_LEN || next.len() < MIN_CELL_LEN {
        return Err(Error::LengthNotEnough);
    }
    // Identity fields MUST be byte-identical post-mint
    let identity_ranges = [
        OFFSET_CONTENT_HASH..OFFSET_CONTENT_HASH + 32,
        OFFSET_FRONTMATTER_HASH..OFFSET_FRONTMATTER_HASH + 32,
        OFFSET_FORK_PARENT..OFFSET_FORK_PARENT + 32,
        OFFSET_AUTHOR_AGENT..OFFSET_AUTHOR_AGENT + 32,
        OFFSET_CREATED_AT..OFFSET_CREATED_AT + 8,
        OFFSET_FORK_DEPTH..OFFSET_FORK_DEPTH + 2,
    ];
    for range in identity_ranges {
        if prev[range.clone()] != next[range] {
            return Err(Error::IdentityFieldMutated);
        }
    }
    // Status monotonic: ACTIVE -> DEPRECATED -> SLASHED, never backwards
    let prev_status = prev[OFFSET_STATUS];
    let next_status = next[OFFSET_STATUS];
    if !is_valid_status_transition(prev_status, next_status) {
        return Err(Error::StatusTransitionInvalid);
    }
    Ok(())
}

fn is_valid_status_transition(prev: u8, next: u8) -> bool {
    match (prev, next) {
        (a, b) if a == b => true,
        (STATUS_ACTIVE, STATUS_DEPRECATED) => true,
        (STATUS_ACTIVE, STATUS_SLASHED) => true,
        (STATUS_DEPRECATED, STATUS_SLASHED) => true,
        _ => false,
    }
}

fn is_all_zero(b: &[u8]) -> bool {
    b.iter().all(|x| *x == 0)
}
