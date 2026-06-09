//! Error codes returned by `vibeswap-canonical-token-type-script`.
//!
//! Codes 1-9 are reserved for ckb-std SysError conversion (matches the
//! convention used by sibling crates `datatoken-cell-type-script` and
//! `primitive-cell-type-script`). Codes 30+ are script-specific.
//!
//! On failure, `program_entry()` returns the discriminant value as the
//! exit code via `process::exit(code as i32)` (CKB-VM consumes this as
//! the verification result).

use ckb_std::error::SysError;

#[repr(i8)]
#[derive(Debug, Clone, Copy)]
pub enum Error {
    // ============ ckb-std passthrough (1-9) ============
    IndexOutOfBound = 1,
    ItemMissing = 2,
    LengthNotEnough = 3,
    Encoding = 4,

    // ============ sUDT-shape invariants (30-39) ============
    /// `sum(inputs.amount) < sum(outputs.amount)` and tx is not in owner-mode
    /// nor mint-claim-mode. sUDT canonical: surplus on input side is allowed
    /// (it's a burn-without-receipt, which we reject separately when the
    /// transaction has no BurnReceiptCell — see code 41).
    ConservationViolated = 30,
    /// u128 overflow when summing input or output amounts.
    AmountOverflow = 31,
    /// Cell data is shorter than the canonical layout requires.
    CellDataMalformed = 32,
    /// Type-script args are not exactly 32 bytes (owner lock hash).
    ScriptArgsMalformed = 33,
    /// Version byte in cell data does not match SCHEMA_VERSION.
    SchemaVersionUnsupported = 34,

    // ============ VibeSwap canonical-burn-and-mint extension (40-49) ============
    /// A mint occurred (outputs > inputs) but no MintClaimCell was consumed
    /// in the transaction. See `messaging-hub.md` § MintClaimCell.
    MintWithoutClaim = 40,
    /// A burn occurred (inputs > outputs) but no matching BurnReceiptCell
    /// was produced. See `messaging-hub.md` § BurnReceiptCell.
    BurnWithoutReceipt = 41,
    /// Mint amount disagrees with the consumed MintClaimCell's amount field.
    MintAmountMismatch = 42,
    /// Burn amount disagrees with the produced BurnReceiptCell's amount field.
    BurnAmountMismatch = 43,
    /// `source_chain_id` field changed across input/output for a non-mint,
    /// non-burn transfer. Origin is immutable post-mint.
    SourceChainIdMutated = 44,
    /// `source_chain_id == 0` on a freshly-minted cell (reserved sentinel).
    SourceChainIdReserved = 45,
}

impl From<SysError> for Error {
    fn from(err: SysError) -> Self {
        match err {
            SysError::IndexOutOfBound => Self::IndexOutOfBound,
            SysError::ItemMissing => Self::ItemMissing,
            SysError::LengthNotEnough(_) => Self::LengthNotEnough,
            SysError::Encoding => Self::Encoding,
            // Catch-all: any new variant ckb-std introduces gets bucketed
            // into Encoding rather than producing an unreachable! panic in
            // VM. TODO: verify against ckb-std 0.16 SysError variant list.
            _ => Self::Encoding,
        }
    }
}
