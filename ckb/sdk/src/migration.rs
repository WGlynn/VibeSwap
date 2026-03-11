// ============ Migration — Protocol Upgrades & Versioned State Transitions ============
// Protocol migration/upgrade module for VibeSwap on CKB. Manages versioned state
// transitions, data migrations, protocol upgrades, and backward compatibility
// for CKB's immutable cell model.
//
// Key capabilities:
// - Semantic versioning with compatibility checking
// - Migration plan creation, validation, and progress tracking
// - Checkpoint-based integrity verification with SHA-256 checksums
// - Cell data transform analysis (schema changes, size deltas)
// - Rollback safety detection
// - Version string serialization/deserialization
//
// CKB scripts are immutable once deployed. Upgrades require deploying new script
// versions and migrating cell data from old schemas to new ones. This module
// provides the tooling to plan, execute, track, and verify those migrations.

use vibeswap_math::PRECISION;
use vibeswap_math::mul_div;
use sha2::{Digest, Sha256};

// ============ Constants ============

/// Current protocol version
pub const CURRENT_PROTOCOL_VERSION: Version = Version { major: 1, minor: 0, patch: 0 };

/// Minimum supported protocol version for migration
pub const MIN_SUPPORTED_VERSION: Version = Version { major: 0, minor: 9, patch: 0 };

/// Maximum number of steps allowed in a single migration plan
pub const MAX_MIGRATION_STEPS: usize = 64;

/// Maximum cells that can be processed in a single block
pub const MAX_CELLS_PER_BLOCK: u64 = 100;

/// Number of blocks between automatic checkpoints
pub const CHECKPOINT_INTERVAL_BLOCKS: u64 = 10_000;

/// Basis points denominator (100% = 10_000 bps)
const BPS_DENOMINATOR: u16 = 10_000;

// ============ Error Types ============

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MigrationError {
    /// The source and target versions are not compatible for migration
    IncompatibleVersion,
    /// A migration is already running — cannot start another
    MigrationInProgress,
    /// The data has already been migrated to the target version
    AlreadyMigrated,
    /// Cell data failed integrity checks during migration
    DataCorrupted,
    /// Rollback attempted but cannot be completed safely
    RollbackFailed,
    /// Checkpoint data does not match expected state
    InvalidCheckpoint,
    /// Source version is too old — below MIN_SUPPORTED_VERSION
    VersionTooOld,
    /// Target version is ahead of what this code supports
    VersionTooNew,
    /// A required field is missing from migrated cell data
    MissingField,
    /// Computed checksum does not match expected value
    ChecksumMismatch,
}

// ============ Data Types ============

/// Semantic version: major.minor.patch
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Version {
    /// Major version — breaking changes
    pub major: u16,
    /// Minor version — backward-compatible additions
    pub minor: u16,
    /// Patch version — backward-compatible fixes
    pub patch: u16,
}

/// A complete migration plan describing how to move from one version to another.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MigrationPlan {
    /// Source version
    pub from_version: Version,
    /// Target version
    pub to_version: Version,
    /// Ordered list of migration steps
    pub steps: Vec<MigrationStep>,
    /// Estimated number of cells to process
    pub estimated_cells: u64,
    /// Estimated blocks needed to complete
    pub estimated_blocks: u64,
}

/// A single step within a migration plan.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MigrationStep {
    /// Unique step identifier within the plan
    pub step_id: u32,
    /// Human-readable description (fixed-size for on-chain)
    pub description: [u8; 64],
    /// Type of transformation applied in this step
    pub transform_type: TransformType,
    /// Number of cells affected by this step
    pub affected_cells: u64,
    /// Whether this step has been completed
    pub completed: bool,
}

/// Classification of cell data transformation types.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TransformType {
    /// Schema layout change (field reordering, type changes)
    SchemaChange,
    /// Data encoding/format change without schema change
    DataReformat,
    /// Rebuild derived indices from source data
    IndexRebuild,
    /// Replace type/lock script references with new version
    ScriptUpgrade,
    /// Update configuration parameters in cells
    ParameterUpdate,
}

/// Current status of a migration.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MigrationStatus {
    /// Migration has been planned but not started
    NotStarted,
    /// Migration is actively running
    InProgress {
        /// Number of steps completed so far
        completed_steps: u32,
        /// Total number of steps in the plan
        total_steps: u32,
    },
    /// All steps completed successfully
    Completed,
    /// Migration was rolled back to prior state
    RolledBack,
    /// Migration failed at a specific step
    Failed {
        /// The step number where failure occurred
        step: u32,
        /// Reason for failure (fixed-size for on-chain)
        reason: [u8; 64],
    },
}

/// A snapshot of migration state for integrity verification.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Checkpoint {
    /// Protocol version at checkpoint time
    pub version: Version,
    /// CKB block number when checkpoint was taken
    pub block_number: u64,
    /// Number of cells processed at checkpoint time
    pub cell_count: u64,
    /// SHA-256 checksum of migrated state
    pub checksum: [u8; 32],
    /// Timestamp (unix seconds) when checkpoint was created
    pub timestamp: u64,
}

/// Report on compatibility between two protocol versions.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CompatibilityReport {
    /// Whether the versions are compatible (same major version)
    pub compatible: bool,
    /// Number of breaking changes between versions
    pub breaking_changes: u32,
    /// Number of deprecated features between versions
    pub deprecations: u32,
    /// Number of new features added between versions
    pub new_features: u32,
    /// Whether data migration is required (not just code update)
    pub migration_required: bool,
}

/// Description of how a single cell's data changes during migration.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CellTransform {
    /// Size of cell data before migration (bytes)
    pub old_size: u32,
    /// Size of cell data after migration (bytes)
    pub new_size: u32,
    /// Number of new fields added
    pub fields_added: u16,
    /// Number of fields removed
    pub fields_removed: u16,
    /// Number of existing fields whose encoding changed
    pub fields_modified: u16,
}

// ============ Core Functions ============

/// Compare two semantic versions.
///
/// Returns Ordering::Less if `a < b`, Ordering::Greater if `a > b`,
/// Ordering::Equal if identical.  Major takes precedence, then minor, then patch.
pub fn version_compare(a: &Version, b: &Version) -> std::cmp::Ordering {
    a.major
        .cmp(&b.major)
        .then(a.minor.cmp(&b.minor))
        .then(a.patch.cmp(&b.patch))
}

/// Check whether migrating from `from` to `to` is backward-compatible.
///
/// Same major version means compatible (minor/patch changes only).
pub fn is_compatible(from: &Version, to: &Version) -> bool {
    from.major == to.major
}

/// Produce a detailed compatibility report between two versions.
pub fn compatibility_report(
    from: &Version,
    to: &Version,
    breaking: u32,
    deprecations: u32,
    new_features: u32,
) -> CompatibilityReport {
    let compatible = is_compatible(from, to);
    // Migration is required when there are breaking changes or major version differs
    let migration_required = !compatible || breaking > 0;
    CompatibilityReport {
        compatible,
        breaking_changes: breaking,
        deprecations,
        new_features,
        migration_required,
    }
}

/// Create and validate a migration plan.
///
/// Errors:
/// - `AlreadyMigrated` if from == to
/// - `IncompatibleVersion` if to < from (downgrade)
/// - `VersionTooOld` if from < MIN_SUPPORTED_VERSION
/// - `VersionTooNew` if to > CURRENT_PROTOCOL_VERSION
/// - `MissingField` if steps is empty
/// - `DataCorrupted` if steps exceed MAX_MIGRATION_STEPS
pub fn create_migration_plan(
    from: &Version,
    to: &Version,
    steps: Vec<MigrationStep>,
) -> Result<MigrationPlan, MigrationError> {
    // Cannot migrate to the same version
    if version_compare(from, to) == std::cmp::Ordering::Equal {
        return Err(MigrationError::AlreadyMigrated);
    }

    // Cannot downgrade
    if version_compare(from, to) == std::cmp::Ordering::Greater {
        return Err(MigrationError::IncompatibleVersion);
    }

    // Source must be at least MIN_SUPPORTED_VERSION
    if version_compare(from, &MIN_SUPPORTED_VERSION) == std::cmp::Ordering::Less {
        return Err(MigrationError::VersionTooOld);
    }

    // Target must not exceed CURRENT_PROTOCOL_VERSION
    if version_compare(to, &CURRENT_PROTOCOL_VERSION) == std::cmp::Ordering::Greater {
        return Err(MigrationError::VersionTooNew);
    }

    // Must have at least one step
    if steps.is_empty() {
        return Err(MigrationError::MissingField);
    }

    // Cannot exceed max steps
    if steps.len() > MAX_MIGRATION_STEPS {
        return Err(MigrationError::DataCorrupted);
    }

    let estimated_cells: u64 = steps.iter().map(|s| s.affected_cells).sum();
    let estimated_blocks = if MAX_CELLS_PER_BLOCK > 0 {
        // Ceiling division: (cells + per_block - 1) / per_block
        estimated_cells
            .checked_add(MAX_CELLS_PER_BLOCK - 1)
            .unwrap_or(u64::MAX)
            / MAX_CELLS_PER_BLOCK
    } else {
        0
    };

    Ok(MigrationPlan {
        from_version: from.clone(),
        to_version: to.clone(),
        steps,
        estimated_cells,
        estimated_blocks,
    })
}

/// Estimate the number of blocks needed to complete a migration.
///
/// Uses `cells_per_block` as the throughput rate.  Returns 0 if there are no
/// cells or cells_per_block is 0.
pub fn estimate_migration_time(plan: &MigrationPlan, cells_per_block: u64) -> u64 {
    if cells_per_block == 0 || plan.estimated_cells == 0 {
        return 0;
    }
    // Ceiling division
    plan.estimated_cells
        .checked_add(cells_per_block - 1)
        .unwrap_or(u64::MAX)
        / cells_per_block
}

/// Validate a checkpoint's checksum against an expected value.
pub fn validate_checkpoint(
    checkpoint: &Checkpoint,
    expected_checksum: &[u8; 32],
) -> Result<(), MigrationError> {
    if checkpoint.checksum == *expected_checksum {
        Ok(())
    } else {
        Err(MigrationError::ChecksumMismatch)
    }
}

/// Return migration progress in basis points (0 = not started, 10_000 = done).
pub fn migration_progress_bps(status: &MigrationStatus) -> u16 {
    match status {
        MigrationStatus::NotStarted => 0,
        MigrationStatus::InProgress {
            completed_steps,
            total_steps,
        } => {
            if *total_steps == 0 {
                return 0;
            }
            // Use mul_div for safe arithmetic: completed * 10_000 / total
            let result = mul_div(
                *completed_steps as u128,
                BPS_DENOMINATOR as u128,
                *total_steps as u128,
            );
            // Clamp to u16 range (should always fit in BPS_DENOMINATOR)
            if result > BPS_DENOMINATOR as u128 {
                BPS_DENOMINATOR
            } else {
                result as u16
            }
        }
        MigrationStatus::Completed => BPS_DENOMINATOR,
        MigrationStatus::RolledBack => 0,
        MigrationStatus::Failed { .. } => 0,
    }
}

/// Determine whether a rollback is safe given the current status.
///
/// Rollback is only safe when migration is in progress and not yet complete.
pub fn can_rollback(status: &MigrationStatus) -> bool {
    matches!(status, MigrationStatus::InProgress { .. })
}

/// Summarize a slice of cell transforms.
///
/// Returns `(total_old_size, total_new_size, total_transforms)`.
pub fn cell_transform_summary(transforms: &[CellTransform]) -> (u64, u64, u32) {
    let mut total_old: u64 = 0;
    let mut total_new: u64 = 0;
    for t in transforms {
        total_old = total_old.saturating_add(t.old_size as u64);
        total_new = total_new.saturating_add(t.new_size as u64);
    }
    (total_old, total_new, transforms.len() as u32)
}

/// Serialize a Version to a fixed-size byte buffer as "major.minor.patch".
///
/// The result is a 16-byte array, zero-padded on the right.
pub fn version_string(v: &Version) -> [u8; 16] {
    let mut buf = [0u8; 16];
    // Format: "major.minor.patch"
    let s = format!("{}.{}.{}", v.major, v.minor, v.patch);
    let bytes = s.as_bytes();
    let len = bytes.len().min(16);
    buf[..len].copy_from_slice(&bytes[..len]);
    buf
}

/// Parse a Version from a byte slice containing "major.minor.patch".
///
/// Leading/trailing zero bytes are ignored.
pub fn parse_version(bytes: &[u8]) -> Result<Version, MigrationError> {
    // Find the end of the string (first zero byte or end of slice)
    let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
    let s = std::str::from_utf8(&bytes[..end]).map_err(|_| MigrationError::DataCorrupted)?;
    let s = s.trim();

    if s.is_empty() {
        return Err(MigrationError::MissingField);
    }

    let parts: Vec<&str> = s.split('.').collect();
    if parts.len() != 3 {
        return Err(MigrationError::DataCorrupted);
    }

    let major = parts[0]
        .parse::<u16>()
        .map_err(|_| MigrationError::DataCorrupted)?;
    let minor = parts[1]
        .parse::<u16>()
        .map_err(|_| MigrationError::DataCorrupted)?;
    let patch = parts[2]
        .parse::<u16>()
        .map_err(|_| MigrationError::DataCorrupted)?;

    Ok(Version {
        major,
        minor,
        patch,
    })
}

/// Compute a SHA-256 checksum over arbitrary data.
pub fn checksum(data: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(data);
    let result = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&result);
    out
}

/// Determine whether migration is needed between two versions.
///
/// Migration is needed if the versions differ and current < target.
pub fn needs_migration(current: &Version, target: &Version) -> bool {
    version_compare(current, target) == std::cmp::Ordering::Less
}

/// Calculate the completion rate of a migration plan in basis points.
///
/// Counts the number of steps marked `completed` versus total steps.
pub fn step_completion_rate(plan: &MigrationPlan) -> u16 {
    let total = plan.steps.len() as u128;
    if total == 0 {
        return 0;
    }
    let completed = plan.steps.iter().filter(|s| s.completed).count() as u128;
    let result = mul_div(completed, BPS_DENOMINATOR as u128, total);
    if result > BPS_DENOMINATOR as u128 {
        BPS_DENOMINATOR
    } else {
        result as u16
    }
}

/// Calculate the net size delta across all cell transforms.
///
/// Positive = growth (more capacity needed), negative = shrinkage.
pub fn data_size_delta(transforms: &[CellTransform]) -> i64 {
    let mut delta: i64 = 0;
    for t in transforms {
        delta = delta.saturating_add(t.new_size as i64 - t.old_size as i64);
    }
    delta
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // ============ Test Helpers ============

    fn v(major: u16, minor: u16, patch: u16) -> Version {
        Version {
            major,
            minor,
            patch,
        }
    }

    fn make_step(id: u32, transform: TransformType, cells: u64, completed: bool) -> MigrationStep {
        MigrationStep {
            step_id: id,
            description: [0u8; 64],
            transform_type: transform,
            affected_cells: cells,
            completed,
        }
    }

    fn make_step_with_desc(id: u32, desc: &str) -> MigrationStep {
        let mut description = [0u8; 64];
        let bytes = desc.as_bytes();
        let len = bytes.len().min(64);
        description[..len].copy_from_slice(&bytes[..len]);
        MigrationStep {
            step_id: id,
            description,
            transform_type: TransformType::SchemaChange,
            affected_cells: 10,
            completed: false,
        }
    }

    fn make_checkpoint(version: Version, checksum_val: [u8; 32]) -> Checkpoint {
        Checkpoint {
            version,
            block_number: 1000,
            cell_count: 50,
            checksum: checksum_val,
            timestamp: 1700000000,
        }
    }

    fn make_transform(old_size: u32, new_size: u32, added: u16, removed: u16, modified: u16) -> CellTransform {
        CellTransform {
            old_size,
            new_size,
            fields_added: added,
            fields_removed: removed,
            fields_modified: modified,
        }
    }

    // ============ version_compare Tests ============

    #[test]
    fn test_version_compare_equal() {
        assert_eq!(version_compare(&v(1, 0, 0), &v(1, 0, 0)), std::cmp::Ordering::Equal);
    }

    #[test]
    fn test_version_compare_equal_complex() {
        assert_eq!(version_compare(&v(2, 5, 3), &v(2, 5, 3)), std::cmp::Ordering::Equal);
    }

    #[test]
    fn test_version_compare_major_less() {
        assert_eq!(version_compare(&v(0, 9, 9), &v(1, 0, 0)), std::cmp::Ordering::Less);
    }

    #[test]
    fn test_version_compare_major_greater() {
        assert_eq!(version_compare(&v(2, 0, 0), &v(1, 9, 9)), std::cmp::Ordering::Greater);
    }

    #[test]
    fn test_version_compare_minor_less() {
        assert_eq!(version_compare(&v(1, 0, 0), &v(1, 1, 0)), std::cmp::Ordering::Less);
    }

    #[test]
    fn test_version_compare_minor_greater() {
        assert_eq!(version_compare(&v(1, 2, 0), &v(1, 1, 0)), std::cmp::Ordering::Greater);
    }

    #[test]
    fn test_version_compare_patch_less() {
        assert_eq!(version_compare(&v(1, 0, 0), &v(1, 0, 1)), std::cmp::Ordering::Less);
    }

    #[test]
    fn test_version_compare_patch_greater() {
        assert_eq!(version_compare(&v(1, 0, 2), &v(1, 0, 1)), std::cmp::Ordering::Greater);
    }

    #[test]
    fn test_version_compare_zero() {
        assert_eq!(version_compare(&v(0, 0, 0), &v(0, 0, 0)), std::cmp::Ordering::Equal);
    }

    #[test]
    fn test_version_compare_major_takes_precedence_over_minor() {
        assert_eq!(version_compare(&v(2, 0, 0), &v(1, 99, 99)), std::cmp::Ordering::Greater);
    }

    #[test]
    fn test_version_compare_minor_takes_precedence_over_patch() {
        assert_eq!(version_compare(&v(1, 2, 0), &v(1, 1, 99)), std::cmp::Ordering::Greater);
    }

    #[test]
    fn test_version_compare_max_values() {
        assert_eq!(
            version_compare(&v(u16::MAX, u16::MAX, u16::MAX), &v(u16::MAX, u16::MAX, u16::MAX)),
            std::cmp::Ordering::Equal
        );
    }

    // ============ is_compatible Tests ============

    #[test]
    fn test_is_compatible_same_major() {
        assert!(is_compatible(&v(1, 0, 0), &v(1, 5, 3)));
    }

    #[test]
    fn test_is_compatible_same_version() {
        assert!(is_compatible(&v(1, 0, 0), &v(1, 0, 0)));
    }

    #[test]
    fn test_is_compatible_different_major() {
        assert!(!is_compatible(&v(1, 0, 0), &v(2, 0, 0)));
    }

    #[test]
    fn test_is_compatible_major_zero_to_one() {
        assert!(!is_compatible(&v(0, 9, 0), &v(1, 0, 0)));
    }

    #[test]
    fn test_is_compatible_minor_patch_differ() {
        assert!(is_compatible(&v(3, 1, 0), &v(3, 99, 99)));
    }

    #[test]
    fn test_is_compatible_downgrade_same_major() {
        assert!(is_compatible(&v(2, 5, 0), &v(2, 3, 0)));
    }

    // ============ compatibility_report Tests ============

    #[test]
    fn test_compatibility_report_compatible_no_breaking() {
        let report = compatibility_report(&v(1, 0, 0), &v(1, 1, 0), 0, 2, 5);
        assert!(report.compatible);
        assert!(!report.migration_required);
        assert_eq!(report.breaking_changes, 0);
        assert_eq!(report.deprecations, 2);
        assert_eq!(report.new_features, 5);
    }

    #[test]
    fn test_compatibility_report_compatible_with_breaking() {
        let report = compatibility_report(&v(1, 0, 0), &v(1, 2, 0), 3, 1, 2);
        assert!(report.compatible);
        assert!(report.migration_required); // breaking changes force migration
        assert_eq!(report.breaking_changes, 3);
    }

    #[test]
    fn test_compatibility_report_incompatible() {
        let report = compatibility_report(&v(1, 0, 0), &v(2, 0, 0), 5, 3, 10);
        assert!(!report.compatible);
        assert!(report.migration_required);
        assert_eq!(report.breaking_changes, 5);
        assert_eq!(report.deprecations, 3);
        assert_eq!(report.new_features, 10);
    }

    #[test]
    fn test_compatibility_report_zero_changes() {
        let report = compatibility_report(&v(1, 0, 0), &v(1, 0, 1), 0, 0, 0);
        assert!(report.compatible);
        assert!(!report.migration_required);
    }

    #[test]
    fn test_compatibility_report_major_version_zero() {
        let report = compatibility_report(&v(0, 8, 0), &v(0, 9, 0), 0, 0, 1);
        assert!(report.compatible); // same major (0)
        assert!(!report.migration_required);
    }

    // ============ create_migration_plan Tests ============

    #[test]
    fn test_create_migration_plan_valid() {
        let steps = vec![
            make_step(1, TransformType::SchemaChange, 100, false),
            make_step(2, TransformType::DataReformat, 200, false),
        ];
        let plan = create_migration_plan(&v(0, 9, 0), &v(1, 0, 0), steps).unwrap();
        assert_eq!(plan.from_version, v(0, 9, 0));
        assert_eq!(plan.to_version, v(1, 0, 0));
        assert_eq!(plan.steps.len(), 2);
        assert_eq!(plan.estimated_cells, 300);
        assert_eq!(plan.estimated_blocks, 3); // ceil(300/100)
    }

    #[test]
    fn test_create_migration_plan_same_version() {
        let steps = vec![make_step(1, TransformType::SchemaChange, 10, false)];
        let err = create_migration_plan(&v(1, 0, 0), &v(1, 0, 0), steps).unwrap_err();
        assert_eq!(err, MigrationError::AlreadyMigrated);
    }

    #[test]
    fn test_create_migration_plan_downgrade() {
        let steps = vec![make_step(1, TransformType::SchemaChange, 10, false)];
        let err = create_migration_plan(&v(1, 1, 0), &v(1, 0, 0), steps).unwrap_err();
        assert_eq!(err, MigrationError::IncompatibleVersion);
    }

    #[test]
    fn test_create_migration_plan_empty_steps() {
        let err = create_migration_plan(&v(0, 9, 0), &v(1, 0, 0), vec![]).unwrap_err();
        assert_eq!(err, MigrationError::MissingField);
    }

    #[test]
    fn test_create_migration_plan_too_many_steps() {
        let steps: Vec<MigrationStep> = (0..65)
            .map(|i| make_step(i, TransformType::ParameterUpdate, 1, false))
            .collect();
        let err = create_migration_plan(&v(0, 9, 0), &v(1, 0, 0), steps).unwrap_err();
        assert_eq!(err, MigrationError::DataCorrupted);
    }

    #[test]
    fn test_create_migration_plan_max_steps_ok() {
        let steps: Vec<MigrationStep> = (0..64)
            .map(|i| make_step(i, TransformType::ParameterUpdate, 1, false))
            .collect();
        let plan = create_migration_plan(&v(0, 9, 0), &v(1, 0, 0), steps).unwrap();
        assert_eq!(plan.steps.len(), 64);
    }

    #[test]
    fn test_create_migration_plan_version_too_old() {
        let steps = vec![make_step(1, TransformType::SchemaChange, 10, false)];
        let err = create_migration_plan(&v(0, 8, 0), &v(1, 0, 0), steps).unwrap_err();
        assert_eq!(err, MigrationError::VersionTooOld);
    }

    #[test]
    fn test_create_migration_plan_version_too_new() {
        let steps = vec![make_step(1, TransformType::SchemaChange, 10, false)];
        let err = create_migration_plan(&v(0, 9, 0), &v(2, 0, 0), steps).unwrap_err();
        assert_eq!(err, MigrationError::VersionTooNew);
    }

    #[test]
    fn test_create_migration_plan_single_step() {
        let steps = vec![make_step(1, TransformType::ScriptUpgrade, 50, false)];
        let plan = create_migration_plan(&v(0, 9, 0), &v(0, 9, 1), steps).unwrap();
        assert_eq!(plan.estimated_cells, 50);
        assert_eq!(plan.estimated_blocks, 1); // ceil(50/100)
    }

    #[test]
    fn test_create_migration_plan_estimated_blocks_exact_division() {
        let steps = vec![make_step(1, TransformType::IndexRebuild, 200, false)];
        let plan = create_migration_plan(&v(0, 9, 0), &v(1, 0, 0), steps).unwrap();
        assert_eq!(plan.estimated_blocks, 2); // 200 / 100 exactly
    }

    #[test]
    fn test_create_migration_plan_estimated_blocks_with_remainder() {
        let steps = vec![make_step(1, TransformType::IndexRebuild, 201, false)];
        let plan = create_migration_plan(&v(0, 9, 0), &v(1, 0, 0), steps).unwrap();
        assert_eq!(plan.estimated_blocks, 3); // ceil(201/100) = 3
    }

    #[test]
    fn test_create_migration_plan_preserves_step_order() {
        let steps = vec![
            make_step(10, TransformType::SchemaChange, 5, false),
            make_step(20, TransformType::DataReformat, 10, false),
            make_step(30, TransformType::ScriptUpgrade, 15, false),
        ];
        let plan = create_migration_plan(&v(0, 9, 0), &v(1, 0, 0), steps).unwrap();
        assert_eq!(plan.steps[0].step_id, 10);
        assert_eq!(plan.steps[1].step_id, 20);
        assert_eq!(plan.steps[2].step_id, 30);
    }

    // ============ estimate_migration_time Tests ============

    #[test]
    fn test_estimate_migration_time_normal() {
        let steps = vec![make_step(1, TransformType::SchemaChange, 500, false)];
        let plan = create_migration_plan(&v(0, 9, 0), &v(1, 0, 0), steps).unwrap();
        assert_eq!(estimate_migration_time(&plan, 50), 10); // 500/50
    }

    #[test]
    fn test_estimate_migration_time_zero_cells() {
        let steps = vec![make_step(1, TransformType::SchemaChange, 0, false)];
        let plan = create_migration_plan(&v(0, 9, 0), &v(1, 0, 0), steps).unwrap();
        assert_eq!(estimate_migration_time(&plan, 50), 0);
    }

    #[test]
    fn test_estimate_migration_time_zero_rate() {
        let steps = vec![make_step(1, TransformType::SchemaChange, 100, false)];
        let plan = create_migration_plan(&v(0, 9, 0), &v(1, 0, 0), steps).unwrap();
        assert_eq!(estimate_migration_time(&plan, 0), 0);
    }

    #[test]
    fn test_estimate_migration_time_ceiling_division() {
        let steps = vec![make_step(1, TransformType::SchemaChange, 101, false)];
        let plan = create_migration_plan(&v(0, 9, 0), &v(1, 0, 0), steps).unwrap();
        assert_eq!(estimate_migration_time(&plan, 50), 3); // ceil(101/50) = 3
    }

    #[test]
    fn test_estimate_migration_time_one_cell_per_block() {
        let steps = vec![make_step(1, TransformType::SchemaChange, 10, false)];
        let plan = create_migration_plan(&v(0, 9, 0), &v(1, 0, 0), steps).unwrap();
        assert_eq!(estimate_migration_time(&plan, 1), 10);
    }

    #[test]
    fn test_estimate_migration_time_large_plan() {
        let steps = vec![make_step(1, TransformType::SchemaChange, 1_000_000, false)];
        let plan = create_migration_plan(&v(0, 9, 0), &v(1, 0, 0), steps).unwrap();
        assert_eq!(estimate_migration_time(&plan, 100), 10_000);
    }

    // ============ validate_checkpoint Tests ============

    #[test]
    fn test_validate_checkpoint_matching() {
        let cs = checksum(b"state_data");
        let cp = make_checkpoint(v(1, 0, 0), cs);
        assert!(validate_checkpoint(&cp, &cs).is_ok());
    }

    #[test]
    fn test_validate_checkpoint_mismatch() {
        let cs = checksum(b"state_data");
        let bad_cs = checksum(b"different_data");
        let cp = make_checkpoint(v(1, 0, 0), cs);
        assert_eq!(
            validate_checkpoint(&cp, &bad_cs).unwrap_err(),
            MigrationError::ChecksumMismatch
        );
    }

    #[test]
    fn test_validate_checkpoint_zero_checksum() {
        let zero = [0u8; 32];
        let cp = make_checkpoint(v(1, 0, 0), zero);
        assert!(validate_checkpoint(&cp, &zero).is_ok());
    }

    #[test]
    fn test_validate_checkpoint_all_ff() {
        let ff = [0xffu8; 32];
        let cp = make_checkpoint(v(1, 0, 0), ff);
        assert!(validate_checkpoint(&cp, &ff).is_ok());
    }

    // ============ migration_progress_bps Tests ============

    #[test]
    fn test_migration_progress_not_started() {
        assert_eq!(migration_progress_bps(&MigrationStatus::NotStarted), 0);
    }

    #[test]
    fn test_migration_progress_completed() {
        assert_eq!(migration_progress_bps(&MigrationStatus::Completed), 10_000);
    }

    #[test]
    fn test_migration_progress_rolled_back() {
        assert_eq!(migration_progress_bps(&MigrationStatus::RolledBack), 0);
    }

    #[test]
    fn test_migration_progress_failed() {
        let status = MigrationStatus::Failed {
            step: 3,
            reason: [0u8; 64],
        };
        assert_eq!(migration_progress_bps(&status), 0);
    }

    #[test]
    fn test_migration_progress_in_progress_half() {
        let status = MigrationStatus::InProgress {
            completed_steps: 5,
            total_steps: 10,
        };
        assert_eq!(migration_progress_bps(&status), 5_000);
    }

    #[test]
    fn test_migration_progress_in_progress_quarter() {
        let status = MigrationStatus::InProgress {
            completed_steps: 1,
            total_steps: 4,
        };
        assert_eq!(migration_progress_bps(&status), 2_500);
    }

    #[test]
    fn test_migration_progress_in_progress_zero() {
        let status = MigrationStatus::InProgress {
            completed_steps: 0,
            total_steps: 10,
        };
        assert_eq!(migration_progress_bps(&status), 0);
    }

    #[test]
    fn test_migration_progress_in_progress_all_done() {
        let status = MigrationStatus::InProgress {
            completed_steps: 10,
            total_steps: 10,
        };
        assert_eq!(migration_progress_bps(&status), 10_000);
    }

    #[test]
    fn test_migration_progress_in_progress_zero_total() {
        let status = MigrationStatus::InProgress {
            completed_steps: 0,
            total_steps: 0,
        };
        assert_eq!(migration_progress_bps(&status), 0);
    }

    #[test]
    fn test_migration_progress_in_progress_one_third() {
        let status = MigrationStatus::InProgress {
            completed_steps: 1,
            total_steps: 3,
        };
        assert_eq!(migration_progress_bps(&status), 3_333);
    }

    // ============ can_rollback Tests ============

    #[test]
    fn test_can_rollback_not_started() {
        assert!(!can_rollback(&MigrationStatus::NotStarted));
    }

    #[test]
    fn test_can_rollback_in_progress() {
        let status = MigrationStatus::InProgress {
            completed_steps: 3,
            total_steps: 10,
        };
        assert!(can_rollback(&status));
    }

    #[test]
    fn test_can_rollback_completed() {
        assert!(!can_rollback(&MigrationStatus::Completed));
    }

    #[test]
    fn test_can_rollback_rolled_back() {
        assert!(!can_rollback(&MigrationStatus::RolledBack));
    }

    #[test]
    fn test_can_rollback_failed() {
        let status = MigrationStatus::Failed {
            step: 2,
            reason: [0u8; 64],
        };
        assert!(!can_rollback(&status));
    }

    // ============ cell_transform_summary Tests ============

    #[test]
    fn test_cell_transform_summary_empty() {
        let (old, new, count) = cell_transform_summary(&[]);
        assert_eq!(old, 0);
        assert_eq!(new, 0);
        assert_eq!(count, 0);
    }

    #[test]
    fn test_cell_transform_summary_single() {
        let transforms = vec![make_transform(100, 120, 2, 0, 1)];
        let (old, new, count) = cell_transform_summary(&transforms);
        assert_eq!(old, 100);
        assert_eq!(new, 120);
        assert_eq!(count, 1);
    }

    #[test]
    fn test_cell_transform_summary_multiple() {
        let transforms = vec![
            make_transform(100, 120, 2, 0, 1),
            make_transform(200, 180, 0, 1, 0),
            make_transform(50, 75, 3, 0, 0),
        ];
        let (old, new, count) = cell_transform_summary(&transforms);
        assert_eq!(old, 350);
        assert_eq!(new, 375);
        assert_eq!(count, 3);
    }

    #[test]
    fn test_cell_transform_summary_shrinking() {
        let transforms = vec![
            make_transform(200, 100, 0, 3, 0),
            make_transform(300, 150, 0, 5, 0),
        ];
        let (old, new, count) = cell_transform_summary(&transforms);
        assert_eq!(old, 500);
        assert_eq!(new, 250);
        assert_eq!(count, 2);
    }

    #[test]
    fn test_cell_transform_summary_same_size() {
        let transforms = vec![make_transform(100, 100, 1, 1, 0)];
        let (old, new, count) = cell_transform_summary(&transforms);
        assert_eq!(old, 100);
        assert_eq!(new, 100);
        assert_eq!(count, 1);
    }

    // ============ version_string Tests ============

    #[test]
    fn test_version_string_simple() {
        let buf = version_string(&v(1, 0, 0));
        assert_eq!(&buf[..5], b"1.0.0");
        assert_eq!(buf[5], 0); // zero padded
    }

    #[test]
    fn test_version_string_double_digits() {
        let buf = version_string(&v(10, 20, 30));
        assert_eq!(&buf[..8], b"10.20.30");
    }

    #[test]
    fn test_version_string_zero() {
        let buf = version_string(&v(0, 0, 0));
        assert_eq!(&buf[..5], b"0.0.0");
    }

    #[test]
    fn test_version_string_max_single_digits() {
        let buf = version_string(&v(9, 9, 9));
        assert_eq!(&buf[..5], b"9.9.9");
    }

    #[test]
    fn test_version_string_min_supported() {
        let buf = version_string(&MIN_SUPPORTED_VERSION);
        assert_eq!(&buf[..5], b"0.9.0");
    }

    #[test]
    fn test_version_string_current() {
        let buf = version_string(&CURRENT_PROTOCOL_VERSION);
        assert_eq!(&buf[..5], b"1.0.0");
    }

    // ============ parse_version Tests ============

    #[test]
    fn test_parse_version_simple() {
        let ver = parse_version(b"1.0.0").unwrap();
        assert_eq!(ver, v(1, 0, 0));
    }

    #[test]
    fn test_parse_version_complex() {
        let ver = parse_version(b"10.20.30").unwrap();
        assert_eq!(ver, v(10, 20, 30));
    }

    #[test]
    fn test_parse_version_with_trailing_zeros() {
        let mut buf = [0u8; 16];
        buf[..5].copy_from_slice(b"1.2.3");
        let ver = parse_version(&buf).unwrap();
        assert_eq!(ver, v(1, 2, 3));
    }

    #[test]
    fn test_parse_version_roundtrip() {
        let original = v(5, 12, 7);
        let buf = version_string(&original);
        let parsed = parse_version(&buf).unwrap();
        assert_eq!(original, parsed);
    }

    #[test]
    fn test_parse_version_roundtrip_zero() {
        let original = v(0, 0, 0);
        let buf = version_string(&original);
        let parsed = parse_version(&buf).unwrap();
        assert_eq!(original, parsed);
    }

    #[test]
    fn test_parse_version_roundtrip_large() {
        let original = v(999, 999, 999);
        let buf = version_string(&original);
        let parsed = parse_version(&buf).unwrap();
        assert_eq!(original, parsed);
    }

    #[test]
    fn test_parse_version_empty() {
        assert_eq!(parse_version(b"").unwrap_err(), MigrationError::MissingField);
    }

    #[test]
    fn test_parse_version_only_zeros() {
        assert_eq!(parse_version(&[0u8; 8]).unwrap_err(), MigrationError::MissingField);
    }

    #[test]
    fn test_parse_version_missing_patch() {
        assert_eq!(parse_version(b"1.2").unwrap_err(), MigrationError::DataCorrupted);
    }

    #[test]
    fn test_parse_version_too_many_parts() {
        assert_eq!(parse_version(b"1.2.3.4").unwrap_err(), MigrationError::DataCorrupted);
    }

    #[test]
    fn test_parse_version_non_numeric() {
        assert_eq!(parse_version(b"a.b.c").unwrap_err(), MigrationError::DataCorrupted);
    }

    #[test]
    fn test_parse_version_negative() {
        assert_eq!(parse_version(b"-1.0.0").unwrap_err(), MigrationError::DataCorrupted);
    }

    // ============ checksum Tests ============

    #[test]
    fn test_checksum_deterministic() {
        let a = checksum(b"hello world");
        let b = checksum(b"hello world");
        assert_eq!(a, b);
    }

    #[test]
    fn test_checksum_different_data() {
        let a = checksum(b"hello");
        let b = checksum(b"world");
        assert_ne!(a, b);
    }

    #[test]
    fn test_checksum_empty() {
        let a = checksum(b"");
        let b = checksum(b"");
        assert_eq!(a, b);
        // SHA-256 of empty is a known constant
        assert_ne!(a, [0u8; 32]); // not all zeros
    }

    #[test]
    fn test_checksum_length() {
        let cs = checksum(b"any data");
        assert_eq!(cs.len(), 32);
    }

    #[test]
    fn test_checksum_single_byte_difference() {
        let a = checksum(b"test1");
        let b = checksum(b"test2");
        assert_ne!(a, b);
    }

    #[test]
    fn test_checksum_large_input() {
        let data = vec![0xABu8; 10_000];
        let cs = checksum(&data);
        assert_eq!(cs.len(), 32);
    }

    // ============ needs_migration Tests ============

    #[test]
    fn test_needs_migration_same_version() {
        assert!(!needs_migration(&v(1, 0, 0), &v(1, 0, 0)));
    }

    #[test]
    fn test_needs_migration_older_to_newer() {
        assert!(needs_migration(&v(1, 0, 0), &v(1, 1, 0)));
    }

    #[test]
    fn test_needs_migration_newer_to_older() {
        assert!(!needs_migration(&v(1, 1, 0), &v(1, 0, 0)));
    }

    #[test]
    fn test_needs_migration_major_upgrade() {
        assert!(needs_migration(&v(0, 9, 0), &v(1, 0, 0)));
    }

    #[test]
    fn test_needs_migration_patch_only() {
        assert!(needs_migration(&v(1, 0, 0), &v(1, 0, 1)));
    }

    // ============ step_completion_rate Tests ============

    #[test]
    fn test_step_completion_rate_none_done() {
        let steps = vec![
            make_step(1, TransformType::SchemaChange, 10, false),
            make_step(2, TransformType::DataReformat, 10, false),
        ];
        let plan = create_migration_plan(&v(0, 9, 0), &v(1, 0, 0), steps).unwrap();
        assert_eq!(step_completion_rate(&plan), 0);
    }

    #[test]
    fn test_step_completion_rate_half_done() {
        let steps = vec![
            make_step(1, TransformType::SchemaChange, 10, true),
            make_step(2, TransformType::DataReformat, 10, false),
        ];
        let plan = create_migration_plan(&v(0, 9, 0), &v(1, 0, 0), steps).unwrap();
        assert_eq!(step_completion_rate(&plan), 5_000);
    }

    #[test]
    fn test_step_completion_rate_all_done() {
        let steps = vec![
            make_step(1, TransformType::SchemaChange, 10, true),
            make_step(2, TransformType::DataReformat, 10, true),
        ];
        let plan = create_migration_plan(&v(0, 9, 0), &v(1, 0, 0), steps).unwrap();
        assert_eq!(step_completion_rate(&plan), 10_000);
    }

    #[test]
    fn test_step_completion_rate_one_of_three() {
        let steps = vec![
            make_step(1, TransformType::SchemaChange, 10, true),
            make_step(2, TransformType::DataReformat, 10, false),
            make_step(3, TransformType::ScriptUpgrade, 10, false),
        ];
        let plan = create_migration_plan(&v(0, 9, 0), &v(1, 0, 0), steps).unwrap();
        assert_eq!(step_completion_rate(&plan), 3_333);
    }

    #[test]
    fn test_step_completion_rate_two_of_three() {
        let steps = vec![
            make_step(1, TransformType::SchemaChange, 10, true),
            make_step(2, TransformType::DataReformat, 10, true),
            make_step(3, TransformType::ScriptUpgrade, 10, false),
        ];
        let plan = create_migration_plan(&v(0, 9, 0), &v(1, 0, 0), steps).unwrap();
        assert_eq!(step_completion_rate(&plan), 6_666);
    }

    // ============ data_size_delta Tests ============

    #[test]
    fn test_data_size_delta_positive() {
        let transforms = vec![
            make_transform(100, 150, 2, 0, 0),
            make_transform(200, 250, 1, 0, 0),
        ];
        assert_eq!(data_size_delta(&transforms), 100); // +50 + +50
    }

    #[test]
    fn test_data_size_delta_negative() {
        let transforms = vec![
            make_transform(200, 100, 0, 3, 0),
            make_transform(300, 200, 0, 2, 0),
        ];
        assert_eq!(data_size_delta(&transforms), -200); // -100 + -100
    }

    #[test]
    fn test_data_size_delta_zero() {
        let transforms = vec![
            make_transform(100, 120, 1, 0, 0),
            make_transform(120, 100, 0, 1, 0),
        ];
        assert_eq!(data_size_delta(&transforms), 0); // +20 + -20
    }

    #[test]
    fn test_data_size_delta_empty() {
        assert_eq!(data_size_delta(&[]), 0);
    }

    #[test]
    fn test_data_size_delta_single_growth() {
        let transforms = vec![make_transform(50, 200, 5, 0, 0)];
        assert_eq!(data_size_delta(&transforms), 150);
    }

    #[test]
    fn test_data_size_delta_single_shrink() {
        let transforms = vec![make_transform(200, 50, 0, 5, 0)];
        assert_eq!(data_size_delta(&transforms), -150);
    }

    // ============ Integration / Edge Case Tests ============

    #[test]
    fn test_constants_sanity() {
        assert_eq!(CURRENT_PROTOCOL_VERSION.major, 1);
        assert_eq!(CURRENT_PROTOCOL_VERSION.minor, 0);
        assert_eq!(CURRENT_PROTOCOL_VERSION.patch, 0);
        assert_eq!(MIN_SUPPORTED_VERSION.major, 0);
        assert_eq!(MIN_SUPPORTED_VERSION.minor, 9);
        assert_eq!(MIN_SUPPORTED_VERSION.patch, 0);
        assert_eq!(MAX_MIGRATION_STEPS, 64);
        assert_eq!(MAX_CELLS_PER_BLOCK, 100);
        assert_eq!(CHECKPOINT_INTERVAL_BLOCKS, 10_000);
    }

    #[test]
    fn test_min_supported_needs_migration() {
        assert!(needs_migration(&MIN_SUPPORTED_VERSION, &CURRENT_PROTOCOL_VERSION));
    }

    #[test]
    fn test_current_does_not_need_migration() {
        assert!(!needs_migration(&CURRENT_PROTOCOL_VERSION, &CURRENT_PROTOCOL_VERSION));
    }

    #[test]
    fn test_min_and_current_compatible_check() {
        // 0.9.0 and 1.0.0 have different majors — not compatible
        assert!(!is_compatible(&MIN_SUPPORTED_VERSION, &CURRENT_PROTOCOL_VERSION));
    }

    #[test]
    fn test_full_migration_workflow() {
        // 1. Check if migration is needed
        let from = v(0, 9, 0);
        let to = v(1, 0, 0);
        assert!(needs_migration(&from, &to));

        // 2. Check compatibility
        let report = compatibility_report(&from, &to, 2, 1, 5);
        assert!(!report.compatible); // different major
        assert!(report.migration_required);

        // 3. Create plan
        let steps = vec![
            make_step(1, TransformType::SchemaChange, 100, false),
            make_step(2, TransformType::ScriptUpgrade, 50, false),
            make_step(3, TransformType::IndexRebuild, 200, false),
        ];
        let plan = create_migration_plan(&from, &to, steps).unwrap();
        assert_eq!(plan.estimated_cells, 350);

        // 4. Estimate time
        let blocks = estimate_migration_time(&plan, 50);
        assert_eq!(blocks, 7); // ceil(350/50) = 7

        // 5. Check progress (not started)
        assert_eq!(step_completion_rate(&plan), 0);

        // 6. Track status
        let status = MigrationStatus::InProgress {
            completed_steps: 1,
            total_steps: 3,
        };
        assert_eq!(migration_progress_bps(&status), 3_333);
        assert!(can_rollback(&status));
    }

    #[test]
    fn test_checkpoint_with_real_checksum() {
        let data = b"migration state snapshot v1.0.0";
        let cs = checksum(data);
        let cp = Checkpoint {
            version: v(1, 0, 0),
            block_number: 500_000,
            cell_count: 1_000,
            checksum: cs,
            timestamp: 1700000000,
        };
        assert!(validate_checkpoint(&cp, &cs).is_ok());

        // Tamper with data
        let bad_cs = checksum(b"tampered data");
        assert_eq!(
            validate_checkpoint(&cp, &bad_cs).unwrap_err(),
            MigrationError::ChecksumMismatch
        );
    }

    #[test]
    fn test_transform_type_variants() {
        // Ensure all variants are distinct
        let types = vec![
            TransformType::SchemaChange,
            TransformType::DataReformat,
            TransformType::IndexRebuild,
            TransformType::ScriptUpgrade,
            TransformType::ParameterUpdate,
        ];
        for i in 0..types.len() {
            for j in (i + 1)..types.len() {
                assert_ne!(types[i], types[j]);
            }
        }
    }

    #[test]
    fn test_migration_step_description() {
        let step = make_step_with_desc(1, "Add new liquidity pool fields");
        assert_eq!(step.step_id, 1);
        assert_eq!(&step.description[..30], b"Add new liquidity pool fields\0");
    }

    #[test]
    fn test_version_string_roundtrip_all_digits() {
        for major in [0u16, 1, 9, 42, 100, 999] {
            for minor in [0u16, 1, 5, 99] {
                for patch in [0u16, 1, 7, 50] {
                    let original = v(major, minor, patch);
                    let buf = version_string(&original);
                    let parsed = parse_version(&buf).unwrap();
                    assert_eq!(original, parsed, "Roundtrip failed for {}.{}.{}", major, minor, patch);
                }
            }
        }
    }

    #[test]
    fn test_migration_error_variants_distinct() {
        let errors: Vec<MigrationError> = vec![
            MigrationError::IncompatibleVersion,
            MigrationError::MigrationInProgress,
            MigrationError::AlreadyMigrated,
            MigrationError::DataCorrupted,
            MigrationError::RollbackFailed,
            MigrationError::InvalidCheckpoint,
            MigrationError::VersionTooOld,
            MigrationError::VersionTooNew,
            MigrationError::MissingField,
            MigrationError::ChecksumMismatch,
        ];
        for i in 0..errors.len() {
            for j in (i + 1)..errors.len() {
                assert_ne!(errors[i], errors[j]);
            }
        }
    }

    #[test]
    fn test_cell_transform_fields_counts() {
        let t = make_transform(100, 120, 3, 1, 2);
        assert_eq!(t.fields_added, 3);
        assert_eq!(t.fields_removed, 1);
        assert_eq!(t.fields_modified, 2);
    }

    #[test]
    fn test_migration_status_in_progress_at_boundary() {
        // completed_steps == total_steps should give 10_000 bps
        let status = MigrationStatus::InProgress {
            completed_steps: 64,
            total_steps: 64,
        };
        assert_eq!(migration_progress_bps(&status), 10_000);
    }

    #[test]
    fn test_can_rollback_in_progress_at_start() {
        let status = MigrationStatus::InProgress {
            completed_steps: 0,
            total_steps: 10,
        };
        assert!(can_rollback(&status));
    }

    #[test]
    fn test_can_rollback_in_progress_near_end() {
        let status = MigrationStatus::InProgress {
            completed_steps: 9,
            total_steps: 10,
        };
        assert!(can_rollback(&status));
    }
}
