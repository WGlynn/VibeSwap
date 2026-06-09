//! Error taxonomy for `bls-verify`.
//!
//! These codes are surfaced to the calling type-script which translates
//! them into its own script-level error codes. The numbers here are
//! library-local; the calling crate maps them to its 1-127 range.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum BlsError {
    /// `threshold_d == 0` or `threshold_n > threshold_d`.
    ThresholdMalformed = 1,
    /// `validator_pubkeys` slice is empty.
    EmptyValidatorSet = 2,
    /// `signer_bitmap` has fewer/more bits than the validator set.
    BitmapSizeMismatch = 3,
    /// Bit set in `signer_bitmap` beyond `validator_pubkeys.len()`.
    BitmapOutOfRange = 4,
    /// Selected signer count < threshold requirement.
    ThresholdNotMet = 5,
    /// G1 / G2 decompression failed (invalid point encoding).
    PointDecompressionFailed = 6,
    /// Pairing equality check failed.
    PairingMismatch = 7,
    /// Hash-to-curve produced an invalid point (should not happen with
    /// a correct implementation; returned defensively).
    HashToCurveFailed = 8,
    /// Arithmetic overflow during threshold computation. Defensive guard
    /// against pathological inputs (`u16::MAX` validator sets etc).
    ArithmeticOverflow = 9,
}
