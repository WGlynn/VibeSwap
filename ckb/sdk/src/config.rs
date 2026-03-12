// ============ Config Module ============
// Protocol Configuration Management for VibeSwap on CKB.
// Centralized parameter store for all tunable protocol values with validation,
// versioning, migration between config versions, and parameter bounds enforcement.
//
// Key capabilities:
// - Parameter registration with type, bounds, and governance requirements
// - Value validation against type-specific rules (bps<=10000, pct<=100, bool<=1)
// - Config versioning and diff generation between versions
// - Migration support: add/remove params, merge configs
// - Snapshot hashing for integrity verification
// - Freeze/unfreeze to lock configs during critical operations
// - Batch operations with atomic all-or-none semantics
// - Analytics: governance ratio, deviation from defaults, change frequency
// - Convenience getters for common VibeSwap parameters
//
// Philosophy: Tunable protocols survive. Hardcoded protocols die.
// Configuration is the dial between security and flexibility.

use sha2::{Digest, Sha256};

// ============ Error Types ============

#[derive(Debug, Clone, PartialEq)]
pub enum ConfigError {
    /// Parameter key not found in config
    ParamNotFound,
    /// Value is outside the allowed min/max range
    ValueOutOfRange,
    /// Value does not match the parameter's declared type
    TypeMismatch,
    /// Config is frozen — no modifications allowed
    ConfigFrozen,
    /// A parameter with this key already exists
    DuplicateKey,
    /// This parameter requires a governance vote to change
    RequiresGovernance,
    /// Version number is invalid or out of sequence
    InvalidVersion,
    /// Migration failed (incompatible or missing data)
    MigrationError,
    /// Default value does not pass its own validation
    InvalidDefault,
    /// Snapshot hash does not match current config state
    SnapshotMismatch,
    /// Config has no parameters
    EmptyConfig,
    /// Key collision during merge or import
    KeyConflict,
}

// ============ Data Types ============

/// The type of a protocol parameter, determines validation rules.
#[derive(Debug, Clone, PartialEq)]
pub enum ParamType {
    /// Unsigned 64-bit integer
    Uint64,
    /// Boolean (0 or 1)
    Bool,
    /// Basis points (0-10000)
    Bps,
    /// Duration in milliseconds
    Duration,
    /// 32-byte address
    Address,
    /// Percentage (0-100)
    Percentage,
}

/// Category grouping for parameters.
#[derive(Debug, Clone, PartialEq)]
pub enum ParamCategory {
    /// Batch auction parameters (commit/reveal durations, etc.)
    Auction,
    /// AMM and pool parameters
    Amm,
    /// Governance voting and proposals
    Governance,
    /// Security: rate limits, circuit breakers
    Security,
    /// Fee rates and distributions
    Fees,
    /// Staking lock durations, reward rates
    Staking,
    /// Cross-chain bridge parameters
    Bridge,
    /// Treasury spending limits and allocations
    Treasury,
}

/// Definition of a protocol parameter: its key, type, bounds, and metadata.
#[derive(Debug, Clone)]
pub struct ParamDef {
    pub key: u32,
    pub name_hash: [u8; 32],
    pub param_type: ParamType,
    pub category: ParamCategory,
    pub default_value: u64,
    pub min_value: u64,
    pub max_value: u64,
    pub requires_governance: bool,
    pub description_hash: [u8; 32],
}

/// Current value of a parameter with audit metadata.
#[derive(Debug, Clone)]
pub struct ParamValue {
    pub key: u32,
    pub value: u64,
    pub updated_at: u64,
    pub updated_by: [u8; 32],
    pub previous_value: u64,
    pub version: u32,
}

/// The full protocol configuration: definitions + current values.
#[derive(Debug, Clone)]
pub struct ProtocolConfig {
    pub version: u32,
    pub params: Vec<ParamValue>,
    pub definitions: Vec<ParamDef>,
    pub created_at: u64,
    pub last_modified: u64,
    pub frozen: bool,
}

/// Difference between two config versions.
#[derive(Debug, Clone)]
pub struct ConfigDiff {
    pub from_version: u32,
    pub to_version: u32,
    pub changes: Vec<(u32, u64, u64)>,
    pub added_keys: Vec<u32>,
    pub removed_keys: Vec<u32>,
}

/// Lightweight snapshot for integrity verification.
#[derive(Debug, Clone)]
pub struct ConfigSnapshot {
    pub version: u32,
    pub timestamp: u64,
    pub param_count: u32,
    pub hash: [u8; 32],
}

// ============ Constants ============

/// VibeSwap default param keys
pub const KEY_COMMIT_DURATION: u32 = 1;
pub const KEY_REVEAL_DURATION: u32 = 2;
pub const KEY_FEE_RATE: u32 = 3;
pub const KEY_SLASH_RATE: u32 = 4;
pub const KEY_MAX_PRICE_IMPACT: u32 = 5;
pub const KEY_CIRCUIT_BREAKER_THRESHOLD: u32 = 6;
pub const KEY_MIN_BATCH_SIZE: u32 = 7;
pub const KEY_MAX_BATCH_SIZE: u32 = 8;
pub const KEY_GOVERNANCE_QUORUM: u32 = 9;
pub const KEY_GOVERNANCE_PERIOD: u32 = 10;

// ============ Config Creation ============

/// Create an empty config at the given version.
pub fn create_config(version: u32, now: u64) -> ProtocolConfig {
    ProtocolConfig {
        version,
        params: Vec::new(),
        definitions: Vec::new(),
        created_at: now,
        last_modified: now,
        frozen: false,
    }
}

/// Create a config pre-populated with VibeSwap default parameters.
pub fn default_vibeswap_config(now: u64) -> ProtocolConfig {
    let mut config = create_config(1, now);
    let updater = [0u8; 32];

    let defaults: Vec<ParamDef> = vec![
        make_def(KEY_COMMIT_DURATION, b"commit_duration", ParamType::Duration, ParamCategory::Auction, 8000, 1000, 60000, true),
        make_def(KEY_REVEAL_DURATION, b"reveal_duration", ParamType::Duration, ParamCategory::Auction, 2000, 500, 30000, true),
        make_def(KEY_FEE_RATE, b"fee_rate", ParamType::Bps, ParamCategory::Fees, 30, 0, 1000, true),
        make_def(KEY_SLASH_RATE, b"slash_rate", ParamType::Bps, ParamCategory::Security, 5000, 0, 10000, true),
        make_def(KEY_MAX_PRICE_IMPACT, b"max_price_impact", ParamType::Bps, ParamCategory::Amm, 500, 10, 5000, true),
        make_def(KEY_CIRCUIT_BREAKER_THRESHOLD, b"circuit_breaker_threshold", ParamType::Bps, ParamCategory::Security, 1000, 100, 5000, true),
        make_def(KEY_MIN_BATCH_SIZE, b"min_batch_size", ParamType::Uint64, ParamCategory::Auction, 1, 1, 100, false),
        make_def(KEY_MAX_BATCH_SIZE, b"max_batch_size", ParamType::Uint64, ParamCategory::Auction, 1000, 10, 100000, false),
        make_def(KEY_GOVERNANCE_QUORUM, b"governance_quorum", ParamType::Percentage, ParamCategory::Governance, 51, 1, 100, true),
        make_def(KEY_GOVERNANCE_PERIOD, b"governance_period", ParamType::Duration, ParamCategory::Governance, 604800000, 86400000, 2592000000, true),
    ];

    for def in defaults {
        let _ = register_param(&mut config, def, now);
    }

    // The register_param function sets updated_by to the zero address internally,
    // which is correct for default initialization.
    let _ = bump_version(&mut config);
    config.last_modified = now;

    config
}

/// Internal helper to build a ParamDef with hashed name.
fn make_def(
    key: u32,
    name: &[u8],
    param_type: ParamType,
    category: ParamCategory,
    default_value: u64,
    min_value: u64,
    max_value: u64,
    requires_governance: bool,
) -> ParamDef {
    ParamDef {
        key,
        name_hash: hash_bytes(name),
        param_type,
        category,
        default_value,
        min_value,
        max_value,
        requires_governance,
        description_hash: [0u8; 32],
    }
}

/// Register a new parameter definition and set its default value.
pub fn register_param(config: &mut ProtocolConfig, def: ParamDef, now: u64) -> Result<(), ConfigError> {
    if config.frozen {
        return Err(ConfigError::ConfigFrozen);
    }

    // Check for duplicate key
    if config.definitions.iter().any(|d| d.key == def.key) {
        return Err(ConfigError::DuplicateKey);
    }

    // Validate that the default value passes its own validation
    validate_value(&def, def.default_value)?;

    let key = def.key;
    let default_value = def.default_value;

    config.definitions.push(def);
    config.params.push(ParamValue {
        key,
        value: default_value,
        updated_at: now,
        updated_by: [0u8; 32],
        previous_value: default_value,
        version: config.version,
    });

    config.last_modified = now;
    Ok(())
}

/// Validate that all parameter values are within their defined bounds.
pub fn validate_config(config: &ProtocolConfig) -> Result<(), ConfigError> {
    if config.definitions.is_empty() {
        return Err(ConfigError::EmptyConfig);
    }
    for pv in &config.params {
        if let Some(def) = config.definitions.iter().find(|d| d.key == pv.key) {
            validate_value(def, pv.value)?;
        } else {
            return Err(ConfigError::ParamNotFound);
        }
    }
    Ok(())
}

// ============ Parameter Operations ============

/// Get the current value of a parameter by key.
pub fn get_param(config: &ProtocolConfig, key: u32) -> Option<u64> {
    config.params.iter().find(|p| p.key == key).map(|p| p.value)
}

/// Set a parameter value. Returns the old value on success.
/// Fails if frozen, key not found, value out of range, or requires governance.
pub fn set_param(
    config: &mut ProtocolConfig,
    key: u32,
    value: u64,
    updater: [u8; 32],
    now: u64,
) -> Result<u64, ConfigError> {
    if config.frozen {
        return Err(ConfigError::ConfigFrozen);
    }

    let def = config.definitions.iter().find(|d| d.key == key)
        .ok_or(ConfigError::ParamNotFound)?;

    if def.requires_governance {
        return Err(ConfigError::RequiresGovernance);
    }

    validate_value(def, value)?;

    let pv = config.params.iter_mut().find(|p| p.key == key)
        .ok_or(ConfigError::ParamNotFound)?;

    let old = pv.value;
    pv.previous_value = old;
    pv.value = value;
    pv.updated_at = now;
    pv.updated_by = updater;
    pv.version += 1;
    config.last_modified = now;

    Ok(old)
}

/// Set a parameter value bypassing the governance check.
/// Still validates bounds. Returns the old value on success.
pub fn set_param_unchecked(
    config: &mut ProtocolConfig,
    key: u32,
    value: u64,
    updater: [u8; 32],
    now: u64,
) -> Result<u64, ConfigError> {
    if config.frozen {
        return Err(ConfigError::ConfigFrozen);
    }

    let def = config.definitions.iter().find(|d| d.key == key)
        .ok_or(ConfigError::ParamNotFound)?;

    validate_value(def, value)?;

    let pv = config.params.iter_mut().find(|p| p.key == key)
        .ok_or(ConfigError::ParamNotFound)?;

    let old = pv.value;
    pv.previous_value = old;
    pv.value = value;
    pv.updated_at = now;
    pv.updated_by = updater;
    pv.version += 1;
    config.last_modified = now;

    Ok(old)
}

/// Reset a parameter to its default value. Returns the old value.
pub fn reset_to_default(
    config: &mut ProtocolConfig,
    key: u32,
    updater: [u8; 32],
    now: u64,
) -> Result<u64, ConfigError> {
    if config.frozen {
        return Err(ConfigError::ConfigFrozen);
    }

    let default_val = config.definitions.iter().find(|d| d.key == key)
        .ok_or(ConfigError::ParamNotFound)?
        .default_value;

    let pv = config.params.iter_mut().find(|p| p.key == key)
        .ok_or(ConfigError::ParamNotFound)?;

    let old = pv.value;
    pv.previous_value = old;
    pv.value = default_val;
    pv.updated_at = now;
    pv.updated_by = updater;
    pv.version += 1;
    config.last_modified = now;

    Ok(old)
}

/// Reset all parameters to their defaults. Returns the count of params reset.
pub fn reset_all_defaults(config: &mut ProtocolConfig, updater: [u8; 32], now: u64) -> usize {
    if config.frozen {
        return 0;
    }

    let mut count = 0;
    let defaults: Vec<(u32, u64)> = config.definitions.iter()
        .map(|d| (d.key, d.default_value))
        .collect();

    for (key, default_val) in &defaults {
        if let Some(pv) = config.params.iter_mut().find(|p| p.key == *key) {
            if pv.value != *default_val {
                pv.previous_value = pv.value;
                pv.value = *default_val;
                pv.updated_at = now;
                pv.updated_by = updater;
                pv.version += 1;
                count += 1;
            }
        }
    }

    if count > 0 {
        config.last_modified = now;
    }

    count
}

/// Get the definition of a parameter by key.
pub fn get_definition(config: &ProtocolConfig, key: u32) -> Option<&ParamDef> {
    config.definitions.iter().find(|d| d.key == key)
}

/// Return the number of registered parameters.
pub fn param_count(config: &ProtocolConfig) -> usize {
    config.params.len()
}

// ============ Validation ============

/// Validate a value against a parameter definition's type and bounds.
pub fn validate_value(def: &ParamDef, value: u64) -> Result<(), ConfigError> {
    // Type-specific upper bound checks
    match def.param_type {
        ParamType::Bool => {
            if value > 1 {
                return Err(ConfigError::TypeMismatch);
            }
        }
        ParamType::Bps => {
            if value > 10000 {
                return Err(ConfigError::TypeMismatch);
            }
        }
        ParamType::Percentage => {
            if value > 100 {
                return Err(ConfigError::TypeMismatch);
            }
        }
        _ => {}
    }

    // Bounds check
    if value < def.min_value || value > def.max_value {
        return Err(ConfigError::ValueOutOfRange);
    }

    Ok(())
}

/// Check if a value is within bounds for a given parameter key.
pub fn is_within_bounds(config: &ProtocolConfig, key: u32, value: u64) -> bool {
    config.definitions.iter().find(|d| d.key == key)
        .map(|def| validate_value(def, value).is_ok())
        .unwrap_or(false)
}

/// Return keys of parameters that require governance to change.
pub fn params_requiring_governance(config: &ProtocolConfig) -> Vec<u32> {
    config.definitions.iter()
        .filter(|d| d.requires_governance)
        .map(|d| d.key)
        .collect()
}

/// Return (key, value) pairs for parameters whose current values are out of bounds.
pub fn invalid_params(config: &ProtocolConfig) -> Vec<(u32, u64)> {
    let mut result = Vec::new();
    for pv in &config.params {
        if let Some(def) = config.definitions.iter().find(|d| d.key == pv.key) {
            if validate_value(def, pv.value).is_err() {
                result.push((pv.key, pv.value));
            }
        }
    }
    result
}

// ============ Categories ============

/// Return (definition, current_value) pairs for all parameters in a category.
pub fn params_by_category<'a>(config: &'a ProtocolConfig, category: &ParamCategory) -> Vec<(&'a ParamDef, u64)> {
    config.definitions.iter()
        .filter(|d| d.category == *category)
        .filter_map(|d| {
            let val = config.params.iter().find(|p| p.key == d.key)?.value;
            Some((d, val))
        })
        .collect()
}

/// Return the count of parameters in a given category.
pub fn category_count(config: &ProtocolConfig, category: &ParamCategory) -> usize {
    config.definitions.iter()
        .filter(|d| d.category == *category)
        .count()
}

/// Return all unique categories present in the config.
pub fn all_categories(config: &ProtocolConfig) -> Vec<ParamCategory> {
    let mut cats = Vec::new();
    for d in &config.definitions {
        if !cats.contains(&d.category) {
            cats.push(d.category.clone());
        }
    }
    cats
}

// ============ Versioning ============

/// Increment the config version. Returns the new version number.
pub fn bump_version(config: &mut ProtocolConfig) -> u32 {
    config.version += 1;
    config.version
}

/// Compute the difference between two configs.
pub fn diff_configs(old: &ProtocolConfig, new: &ProtocolConfig) -> ConfigDiff {
    let mut changes = Vec::new();
    let mut added_keys = Vec::new();
    let mut removed_keys = Vec::new();

    // Find changed and removed params
    for op in &old.params {
        match new.params.iter().find(|np| np.key == op.key) {
            Some(np) => {
                if op.value != np.value {
                    changes.push((op.key, op.value, np.value));
                }
            }
            None => {
                removed_keys.push(op.key);
            }
        }
    }

    // Find added params
    for np in &new.params {
        if !old.params.iter().any(|op| op.key == np.key) {
            added_keys.push(np.key);
        }
    }

    ConfigDiff {
        from_version: old.version,
        to_version: new.version,
        changes,
        added_keys,
        removed_keys,
    }
}

/// Apply a diff to a config. Returns the number of changes applied.
pub fn apply_diff(
    config: &mut ProtocolConfig,
    diff: &ConfigDiff,
    updater: [u8; 32],
    now: u64,
) -> Result<usize, ConfigError> {
    if config.frozen {
        return Err(ConfigError::ConfigFrozen);
    }

    let mut applied = 0;

    for &(key, _old_val, new_val) in &diff.changes {
        if let Some(def) = config.definitions.iter().find(|d| d.key == key) {
            if validate_value(def, new_val).is_err() {
                return Err(ConfigError::ValueOutOfRange);
            }
        } else {
            return Err(ConfigError::ParamNotFound);
        }
    }

    for &(key, _old_val, new_val) in &diff.changes {
        if let Some(pv) = config.params.iter_mut().find(|p| p.key == key) {
            pv.previous_value = pv.value;
            pv.value = new_val;
            pv.updated_at = now;
            pv.updated_by = updater;
            pv.version += 1;
            applied += 1;
        }
    }

    // Remove keys
    for &key in &diff.removed_keys {
        config.params.retain(|p| p.key != key);
        config.definitions.retain(|d| d.key != key);
        applied += 1;
    }

    if applied > 0 {
        config.last_modified = now;
    }

    Ok(applied)
}

/// Check if the config has changed since the given version.
pub fn has_changed_since(config: &ProtocolConfig, version: u32) -> bool {
    config.version > version || config.params.iter().any(|p| p.version > version)
}

/// Return all parameter values that were changed after the given timestamp.
pub fn changes_since(config: &ProtocolConfig, since: u64) -> Vec<&ParamValue> {
    config.params.iter()
        .filter(|p| p.updated_at > since)
        .collect()
}

// ============ Migration ============

/// Migrate a config by adding new params and removing old ones.
/// Returns (added_count, removed_count).
pub fn migrate_config(
    config: &mut ProtocolConfig,
    new_params: &[ParamDef],
    remove_keys: &[u32],
    now: u64,
) -> Result<(usize, usize), ConfigError> {
    if config.frozen {
        return Err(ConfigError::MigrationError);
    }

    // Validate all new params before making changes
    for def in new_params {
        if config.definitions.iter().any(|d| d.key == def.key) {
            return Err(ConfigError::DuplicateKey);
        }
        if validate_value(def, def.default_value).is_err() {
            return Err(ConfigError::InvalidDefault);
        }
    }

    // Remove keys
    let mut removed = 0;
    for &key in remove_keys {
        let before = config.params.len();
        config.params.retain(|p| p.key != key);
        config.definitions.retain(|d| d.key != key);
        if config.params.len() < before {
            removed += 1;
        }
    }

    // Add new params
    let mut added = 0;
    for def in new_params {
        config.definitions.push(def.clone());
        config.params.push(ParamValue {
            key: def.key,
            value: def.default_value,
            updated_at: now,
            updated_by: [0u8; 32],
            previous_value: def.default_value,
            version: config.version,
        });
        added += 1;
    }

    if added > 0 || removed > 0 {
        config.version += 1;
        config.last_modified = now;
    }

    Ok((added, removed))
}

/// Check if two configs are compatible (old has no required params removed in new).
pub fn is_compatible(old: &ProtocolConfig, new: &ProtocolConfig) -> bool {
    for def in &old.definitions {
        if def.requires_governance {
            if !new.definitions.iter().any(|d| d.key == def.key) {
                return false;
            }
        }
    }
    true
}

/// Merge two configs, with overlay values taking precedence over base.
pub fn merge_configs(base: &ProtocolConfig, overlay: &ProtocolConfig) -> ProtocolConfig {
    let mut result = base.clone();
    result.version = std::cmp::max(base.version, overlay.version);
    result.last_modified = std::cmp::max(base.last_modified, overlay.last_modified);

    // Add definitions from overlay that are not in base
    for odef in &overlay.definitions {
        if !result.definitions.iter().any(|d| d.key == odef.key) {
            result.definitions.push(odef.clone());
        }
    }

    // Add or overwrite values from overlay
    for opv in &overlay.params {
        if let Some(rpv) = result.params.iter_mut().find(|p| p.key == opv.key) {
            rpv.previous_value = rpv.value;
            rpv.value = opv.value;
            rpv.updated_at = opv.updated_at;
            rpv.updated_by = opv.updated_by;
            rpv.version = opv.version;
        } else {
            result.params.push(opv.clone());
        }
    }

    result
}

// ============ Snapshots ============

/// Take a snapshot of the current config state.
pub fn take_snapshot(config: &ProtocolConfig, now: u64) -> ConfigSnapshot {
    ConfigSnapshot {
        version: config.version,
        timestamp: now,
        param_count: config.params.len() as u32,
        hash: compute_config_hash(config),
    }
}

/// Verify that a snapshot matches the current config state.
pub fn verify_snapshot(config: &ProtocolConfig, snapshot: &ConfigSnapshot) -> bool {
    snapshot.version == config.version
        && snapshot.param_count == config.params.len() as u32
        && snapshot.hash == compute_config_hash(config)
}

/// Compute a SHA-256 hash of all parameter key-value pairs, sorted by key.
pub fn compute_config_hash(config: &ProtocolConfig) -> [u8; 32] {
    let mut hasher = Sha256::new();

    // Sort by key for deterministic hashing
    let mut kv: Vec<(u32, u64)> = config.params.iter()
        .map(|p| (p.key, p.value))
        .collect();
    kv.sort_by_key(|&(k, _)| k);

    for (key, value) in &kv {
        hasher.update(key.to_le_bytes());
        hasher.update(value.to_le_bytes());
    }

    let result = hasher.finalize();
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&result);
    hash
}

// ============ Freeze ============

/// Freeze the config to prevent any modifications.
pub fn freeze_config(config: &mut ProtocolConfig) -> Result<(), ConfigError> {
    if config.frozen {
        return Err(ConfigError::ConfigFrozen);
    }
    config.frozen = true;
    Ok(())
}

/// Unfreeze the config to allow modifications again.
pub fn unfreeze_config(config: &mut ProtocolConfig) {
    config.frozen = false;
}

/// Check whether the config is frozen.
pub fn is_frozen(config: &ProtocolConfig) -> bool {
    config.frozen
}

// ============ Batch Operations ============

/// Apply multiple parameter updates atomically: all succeed or none apply.
/// Returns the number of updates applied.
pub fn batch_set(
    config: &mut ProtocolConfig,
    updates: &[(u32, u64)],
    updater: [u8; 32],
    now: u64,
) -> Result<usize, ConfigError> {
    if config.frozen {
        return Err(ConfigError::ConfigFrozen);
    }

    // Validate all updates first (all-or-none)
    for &(key, value) in updates {
        let def = config.definitions.iter().find(|d| d.key == key)
            .ok_or(ConfigError::ParamNotFound)?;
        validate_value(def, value)?;
    }

    // Apply all updates
    let mut applied = 0;
    for &(key, value) in updates {
        if let Some(pv) = config.params.iter_mut().find(|p| p.key == key) {
            pv.previous_value = pv.value;
            pv.value = value;
            pv.updated_at = now;
            pv.updated_by = updater;
            pv.version += 1;
            applied += 1;
        }
    }

    if applied > 0 {
        config.last_modified = now;
    }

    Ok(applied)
}

/// Export all current parameter key-value pairs.
pub fn export_values(config: &ProtocolConfig) -> Vec<(u32, u64)> {
    config.params.iter()
        .map(|p| (p.key, p.value))
        .collect()
}

/// Import parameter values into a config. Only updates existing keys.
/// Returns the count of values imported.
pub fn import_values(
    config: &mut ProtocolConfig,
    values: &[(u32, u64)],
    updater: [u8; 32],
    now: u64,
) -> Result<usize, ConfigError> {
    if config.frozen {
        return Err(ConfigError::ConfigFrozen);
    }

    // Validate all first
    for &(key, value) in values {
        let def = config.definitions.iter().find(|d| d.key == key)
            .ok_or(ConfigError::ParamNotFound)?;
        validate_value(def, value)?;
    }

    let mut imported = 0;
    for &(key, value) in values {
        if let Some(pv) = config.params.iter_mut().find(|p| p.key == key) {
            pv.previous_value = pv.value;
            pv.value = value;
            pv.updated_at = now;
            pv.updated_by = updater;
            pv.version += 1;
            imported += 1;
        }
    }

    if imported > 0 {
        config.last_modified = now;
    }

    Ok(imported)
}

// ============ Analytics ============

/// Return parameter values changed within a time window ending at `now`.
pub fn recently_changed<'a>(config: &'a ProtocolConfig, window_ms: u64, now: u64) -> Vec<&'a ParamValue> {
    let cutoff = now.saturating_sub(window_ms);
    config.params.iter()
        .filter(|p| p.updated_at > cutoff)
        .collect()
}

/// Return (key, version) pairs sorted descending by version (most changed first).
pub fn most_changed_params(config: &ProtocolConfig) -> Vec<(u32, u32)> {
    let mut result: Vec<(u32, u32)> = config.params.iter()
        .map(|p| (p.key, p.version))
        .collect();
    result.sort_by(|a, b| b.1.cmp(&a.1));
    result
}

/// Return the ratio of governance-required params to total, in basis points.
pub fn governance_params_ratio(config: &ProtocolConfig) -> u64 {
    let total = config.definitions.len() as u64;
    if total == 0 {
        return 0;
    }
    let gov_count = config.definitions.iter()
        .filter(|d| d.requires_governance)
        .count() as u64;
    gov_count * 10000 / total
}

/// Return (key, current, default) for all params that differ from their default.
pub fn deviation_from_defaults(config: &ProtocolConfig) -> Vec<(u32, u64, u64)> {
    let mut result = Vec::new();
    for def in &config.definitions {
        if let Some(pv) = config.params.iter().find(|p| p.key == def.key) {
            if pv.value != def.default_value {
                result.push((def.key, pv.value, def.default_value));
            }
        }
    }
    result
}

// ============ Convenience Getters ============

/// Get commit phase duration in milliseconds (param key 1).
pub fn commit_duration(config: &ProtocolConfig) -> u64 {
    get_param(config, KEY_COMMIT_DURATION).unwrap_or(0)
}

/// Get reveal phase duration in milliseconds (param key 2).
pub fn reveal_duration(config: &ProtocolConfig) -> u64 {
    get_param(config, KEY_REVEAL_DURATION).unwrap_or(0)
}

/// Get fee rate in basis points (param key 3).
pub fn fee_rate_bps(config: &ProtocolConfig) -> u64 {
    get_param(config, KEY_FEE_RATE).unwrap_or(0)
}

/// Get slash rate in basis points (param key 4).
pub fn slash_rate_bps(config: &ProtocolConfig) -> u64 {
    get_param(config, KEY_SLASH_RATE).unwrap_or(0)
}

/// Get max price impact in basis points (param key 5).
pub fn max_price_impact_bps(config: &ProtocolConfig) -> u64 {
    get_param(config, KEY_MAX_PRICE_IMPACT).unwrap_or(0)
}

// ============ Internal Helpers ============

/// Hash arbitrary bytes with SHA-256.
fn hash_bytes(data: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(data);
    let result = hasher.finalize();
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&result);
    hash
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // ---- Helpers ----

    fn addr(byte: u8) -> [u8; 32] {
        [byte; 32]
    }

    fn test_def(key: u32, param_type: ParamType, category: ParamCategory, default: u64, min: u64, max: u64, gov: bool) -> ParamDef {
        ParamDef {
            key,
            name_hash: hash_bytes(&key.to_le_bytes()),
            param_type,
            category,
            default_value: default,
            min_value: min,
            max_value: max,
            requires_governance: gov,
            description_hash: [0u8; 32],
        }
    }

    fn uint_def(key: u32, default: u64, min: u64, max: u64) -> ParamDef {
        test_def(key, ParamType::Uint64, ParamCategory::Auction, default, min, max, false)
    }

    fn bps_def(key: u32, default: u64, min: u64, max: u64) -> ParamDef {
        test_def(key, ParamType::Bps, ParamCategory::Fees, default, min, max, false)
    }

    fn gov_def(key: u32, default: u64, min: u64, max: u64) -> ParamDef {
        test_def(key, ParamType::Uint64, ParamCategory::Governance, default, min, max, true)
    }

    fn pct_def(key: u32, default: u64, min: u64, max: u64) -> ParamDef {
        test_def(key, ParamType::Percentage, ParamCategory::Security, default, min, max, false)
    }

    fn bool_def(key: u32, default: u64) -> ParamDef {
        test_def(key, ParamType::Bool, ParamCategory::Security, default, 0, 1, false)
    }

    fn dur_def(key: u32, default: u64, min: u64, max: u64) -> ParamDef {
        test_def(key, ParamType::Duration, ParamCategory::Auction, default, min, max, false)
    }

    fn simple_config() -> ProtocolConfig {
        let mut c = create_config(1, 1000);
        let _ = register_param(&mut c, uint_def(100, 50, 0, 100), 1000);
        let _ = register_param(&mut c, uint_def(101, 75, 0, 200), 1000);
        let _ = register_param(&mut c, bps_def(102, 30, 0, 500), 1000);
        c
    }

    fn populated_config() -> ProtocolConfig {
        let mut c = create_config(1, 1000);
        let _ = register_param(&mut c, uint_def(1, 100, 0, 1000), 1000);
        let _ = register_param(&mut c, bps_def(2, 30, 0, 500), 1000);
        let _ = register_param(&mut c, gov_def(3, 500, 100, 10000), 1000);
        let _ = register_param(&mut c, pct_def(4, 50, 0, 100), 1000);
        let _ = register_param(&mut c, bool_def(5, 1), 1000);
        let _ = register_param(&mut c, dur_def(6, 8000, 1000, 60000), 1000);
        c
    }

    // ============ Config Creation Tests ============

    #[test]
    fn test_create_config_basic() {
        let c = create_config(1, 1000);
        assert_eq!(c.version, 1);
        assert_eq!(c.created_at, 1000);
        assert_eq!(c.last_modified, 1000);
        assert!(!c.frozen);
        assert!(c.params.is_empty());
        assert!(c.definitions.is_empty());
    }

    #[test]
    fn test_create_config_version_zero() {
        let c = create_config(0, 0);
        assert_eq!(c.version, 0);
        assert_eq!(c.created_at, 0);
    }

    #[test]
    fn test_create_config_high_version() {
        let c = create_config(u32::MAX, u64::MAX);
        assert_eq!(c.version, u32::MAX);
        assert_eq!(c.created_at, u64::MAX);
    }

    #[test]
    fn test_default_vibeswap_config_has_params() {
        let c = default_vibeswap_config(5000);
        assert_eq!(param_count(&c), 10);
        assert_eq!(c.definitions.len(), 10);
    }

    #[test]
    fn test_default_vibeswap_config_commit_duration() {
        let c = default_vibeswap_config(5000);
        assert_eq!(commit_duration(&c), 8000);
    }

    #[test]
    fn test_default_vibeswap_config_reveal_duration() {
        let c = default_vibeswap_config(5000);
        assert_eq!(reveal_duration(&c), 2000);
    }

    #[test]
    fn test_default_vibeswap_config_fee_rate() {
        let c = default_vibeswap_config(5000);
        assert_eq!(fee_rate_bps(&c), 30);
    }

    #[test]
    fn test_default_vibeswap_config_slash_rate() {
        let c = default_vibeswap_config(5000);
        assert_eq!(slash_rate_bps(&c), 5000);
    }

    #[test]
    fn test_default_vibeswap_config_max_price_impact() {
        let c = default_vibeswap_config(5000);
        assert_eq!(max_price_impact_bps(&c), 500);
    }

    #[test]
    fn test_default_vibeswap_config_validates() {
        let c = default_vibeswap_config(5000);
        assert!(validate_config(&c).is_ok());
    }

    #[test]
    fn test_default_vibeswap_config_version() {
        let c = default_vibeswap_config(5000);
        assert_eq!(c.version, 2); // 1 initial + 1 bump
    }

    #[test]
    fn test_default_vibeswap_config_not_frozen() {
        let c = default_vibeswap_config(5000);
        assert!(!is_frozen(&c));
    }

    // ============ Register Param Tests ============

    #[test]
    fn test_register_param_basic() {
        let mut c = create_config(1, 1000);
        let result = register_param(&mut c, uint_def(10, 50, 0, 100), 1000);
        assert!(result.is_ok());
        assert_eq!(param_count(&c), 1);
    }

    #[test]
    fn test_register_param_sets_default() {
        let mut c = create_config(1, 1000);
        let _ = register_param(&mut c, uint_def(10, 42, 0, 100), 1000);
        assert_eq!(get_param(&c, 10), Some(42));
    }

    #[test]
    fn test_register_param_duplicate_key() {
        let mut c = create_config(1, 1000);
        let _ = register_param(&mut c, uint_def(10, 50, 0, 100), 1000);
        let result = register_param(&mut c, uint_def(10, 60, 0, 100), 1000);
        assert_eq!(result, Err(ConfigError::DuplicateKey));
    }

    #[test]
    fn test_register_param_frozen() {
        let mut c = create_config(1, 1000);
        let _ = freeze_config(&mut c);
        let result = register_param(&mut c, uint_def(10, 50, 0, 100), 1000);
        assert_eq!(result, Err(ConfigError::ConfigFrozen));
    }

    #[test]
    fn test_register_param_invalid_default_bps_too_high() {
        let mut c = create_config(1, 1000);
        let def = bps_def(10, 20000, 0, 20000); // default 20000 > 10000
        let result = register_param(&mut c, def, 1000);
        assert_eq!(result, Err(ConfigError::TypeMismatch));
    }

    #[test]
    fn test_register_param_invalid_default_below_min() {
        let mut c = create_config(1, 1000);
        let def = uint_def(10, 5, 10, 100); // default 5 < min 10
        let result = register_param(&mut c, def, 1000);
        assert_eq!(result, Err(ConfigError::ValueOutOfRange));
    }

    #[test]
    fn test_register_param_updates_last_modified() {
        let mut c = create_config(1, 1000);
        let _ = register_param(&mut c, uint_def(10, 50, 0, 100), 2000);
        assert_eq!(c.last_modified, 2000);
    }

    #[test]
    fn test_register_multiple_params() {
        let mut c = create_config(1, 1000);
        let _ = register_param(&mut c, uint_def(1, 10, 0, 100), 1000);
        let _ = register_param(&mut c, uint_def(2, 20, 0, 200), 1000);
        let _ = register_param(&mut c, uint_def(3, 30, 0, 300), 1000);
        assert_eq!(param_count(&c), 3);
    }

    // ============ Validate Config Tests ============

    #[test]
    fn test_validate_config_empty() {
        let c = create_config(1, 1000);
        assert_eq!(validate_config(&c), Err(ConfigError::EmptyConfig));
    }

    #[test]
    fn test_validate_config_valid() {
        let c = simple_config();
        assert!(validate_config(&c).is_ok());
    }

    #[test]
    fn test_validate_config_out_of_bounds() {
        let mut c = simple_config();
        // Force a value out of bounds
        c.params[0].value = 999;
        assert_eq!(validate_config(&c), Err(ConfigError::ValueOutOfRange));
    }

    #[test]
    fn test_validate_config_orphan_param() {
        let mut c = simple_config();
        c.params.push(ParamValue {
            key: 999,
            value: 0,
            updated_at: 0,
            updated_by: [0u8; 32],
            previous_value: 0,
            version: 0,
        });
        assert_eq!(validate_config(&c), Err(ConfigError::ParamNotFound));
    }

    // ============ Get/Set Param Tests ============

    #[test]
    fn test_get_param_exists() {
        let c = simple_config();
        assert_eq!(get_param(&c, 100), Some(50));
    }

    #[test]
    fn test_get_param_not_exists() {
        let c = simple_config();
        assert_eq!(get_param(&c, 999), None);
    }

    #[test]
    fn test_set_param_basic() {
        let mut c = simple_config();
        let old = set_param(&mut c, 100, 75, addr(1), 2000).unwrap();
        assert_eq!(old, 50);
        assert_eq!(get_param(&c, 100), Some(75));
    }

    #[test]
    fn test_set_param_updates_metadata() {
        let mut c = simple_config();
        let _ = set_param(&mut c, 100, 75, addr(1), 2000);
        let pv = c.params.iter().find(|p| p.key == 100).unwrap();
        assert_eq!(pv.updated_at, 2000);
        assert_eq!(pv.updated_by, addr(1));
        assert_eq!(pv.previous_value, 50);
    }

    #[test]
    fn test_set_param_out_of_range() {
        let mut c = simple_config();
        let result = set_param(&mut c, 100, 200, addr(1), 2000);
        assert_eq!(result, Err(ConfigError::ValueOutOfRange));
        assert_eq!(get_param(&c, 100), Some(50)); // unchanged
    }

    #[test]
    fn test_set_param_not_found() {
        let mut c = simple_config();
        let result = set_param(&mut c, 999, 10, addr(1), 2000);
        assert_eq!(result, Err(ConfigError::ParamNotFound));
    }

    #[test]
    fn test_set_param_frozen() {
        let mut c = simple_config();
        let _ = freeze_config(&mut c);
        let result = set_param(&mut c, 100, 75, addr(1), 2000);
        assert_eq!(result, Err(ConfigError::ConfigFrozen));
    }

    #[test]
    fn test_set_param_requires_governance() {
        let mut c = create_config(1, 1000);
        let _ = register_param(&mut c, gov_def(10, 500, 100, 10000), 1000);
        let result = set_param(&mut c, 10, 600, addr(1), 2000);
        assert_eq!(result, Err(ConfigError::RequiresGovernance));
    }

    #[test]
    fn test_set_param_increments_version() {
        let mut c = simple_config();
        let pv_before = c.params.iter().find(|p| p.key == 100).unwrap().version;
        let _ = set_param(&mut c, 100, 60, addr(1), 2000);
        let pv_after = c.params.iter().find(|p| p.key == 100).unwrap().version;
        assert_eq!(pv_after, pv_before + 1);
    }

    #[test]
    fn test_set_param_updates_last_modified() {
        let mut c = simple_config();
        let _ = set_param(&mut c, 100, 60, addr(1), 5000);
        assert_eq!(c.last_modified, 5000);
    }

    // ============ Set Param Unchecked Tests ============

    #[test]
    fn test_set_param_unchecked_bypasses_governance() {
        let mut c = create_config(1, 1000);
        let _ = register_param(&mut c, gov_def(10, 500, 100, 10000), 1000);
        let old = set_param_unchecked(&mut c, 10, 600, addr(1), 2000).unwrap();
        assert_eq!(old, 500);
        assert_eq!(get_param(&c, 10), Some(600));
    }

    #[test]
    fn test_set_param_unchecked_still_validates_bounds() {
        let mut c = create_config(1, 1000);
        let _ = register_param(&mut c, gov_def(10, 500, 100, 10000), 1000);
        let result = set_param_unchecked(&mut c, 10, 50, addr(1), 2000); // below min
        assert_eq!(result, Err(ConfigError::ValueOutOfRange));
    }

    #[test]
    fn test_set_param_unchecked_frozen() {
        let mut c = create_config(1, 1000);
        let _ = register_param(&mut c, gov_def(10, 500, 100, 10000), 1000);
        let _ = freeze_config(&mut c);
        let result = set_param_unchecked(&mut c, 10, 600, addr(1), 2000);
        assert_eq!(result, Err(ConfigError::ConfigFrozen));
    }

    #[test]
    fn test_set_param_unchecked_not_found() {
        let mut c = simple_config();
        let result = set_param_unchecked(&mut c, 999, 10, addr(1), 2000);
        assert_eq!(result, Err(ConfigError::ParamNotFound));
    }

    #[test]
    fn test_set_param_unchecked_updates_metadata() {
        let mut c = create_config(1, 1000);
        let _ = register_param(&mut c, gov_def(10, 500, 100, 10000), 1000);
        let _ = set_param_unchecked(&mut c, 10, 700, addr(5), 3000);
        let pv = c.params.iter().find(|p| p.key == 10).unwrap();
        assert_eq!(pv.updated_at, 3000);
        assert_eq!(pv.updated_by, addr(5));
        assert_eq!(pv.previous_value, 500);
    }

    // ============ Reset to Default Tests ============

    #[test]
    fn test_reset_to_default_basic() {
        let mut c = simple_config();
        let _ = set_param(&mut c, 100, 80, addr(1), 2000);
        let old = reset_to_default(&mut c, 100, addr(2), 3000).unwrap();
        assert_eq!(old, 80);
        assert_eq!(get_param(&c, 100), Some(50)); // back to default
    }

    #[test]
    fn test_reset_to_default_already_default() {
        let mut c = simple_config();
        let old = reset_to_default(&mut c, 100, addr(1), 2000).unwrap();
        assert_eq!(old, 50); // was already default
        assert_eq!(get_param(&c, 100), Some(50));
    }

    #[test]
    fn test_reset_to_default_not_found() {
        let mut c = simple_config();
        let result = reset_to_default(&mut c, 999, addr(1), 2000);
        assert_eq!(result, Err(ConfigError::ParamNotFound));
    }

    #[test]
    fn test_reset_to_default_frozen() {
        let mut c = simple_config();
        let _ = freeze_config(&mut c);
        let result = reset_to_default(&mut c, 100, addr(1), 2000);
        assert_eq!(result, Err(ConfigError::ConfigFrozen));
    }

    #[test]
    fn test_reset_to_default_updates_metadata() {
        let mut c = simple_config();
        let _ = set_param(&mut c, 100, 90, addr(1), 2000);
        let _ = reset_to_default(&mut c, 100, addr(3), 4000);
        let pv = c.params.iter().find(|p| p.key == 100).unwrap();
        assert_eq!(pv.updated_at, 4000);
        assert_eq!(pv.updated_by, addr(3));
        assert_eq!(pv.previous_value, 90);
    }

    // ============ Reset All Defaults Tests ============

    #[test]
    fn test_reset_all_defaults_none_changed() {
        let mut c = simple_config();
        let count = reset_all_defaults(&mut c, addr(1), 2000);
        assert_eq!(count, 0);
    }

    #[test]
    fn test_reset_all_defaults_some_changed() {
        let mut c = simple_config();
        let _ = set_param(&mut c, 100, 80, addr(1), 2000);
        let _ = set_param(&mut c, 101, 150, addr(1), 2000);
        let count = reset_all_defaults(&mut c, addr(2), 3000);
        assert_eq!(count, 2);
        assert_eq!(get_param(&c, 100), Some(50));
        assert_eq!(get_param(&c, 101), Some(75));
    }

    #[test]
    fn test_reset_all_defaults_frozen() {
        let mut c = simple_config();
        let _ = set_param(&mut c, 100, 80, addr(1), 2000);
        let _ = freeze_config(&mut c);
        let count = reset_all_defaults(&mut c, addr(1), 3000);
        assert_eq!(count, 0);
    }

    #[test]
    fn test_reset_all_defaults_updates_last_modified() {
        let mut c = simple_config();
        let _ = set_param(&mut c, 100, 80, addr(1), 2000);
        let _ = reset_all_defaults(&mut c, addr(1), 5000);
        assert_eq!(c.last_modified, 5000);
    }

    // ============ Get Definition Tests ============

    #[test]
    fn test_get_definition_exists() {
        let c = simple_config();
        let def = get_definition(&c, 100).unwrap();
        assert_eq!(def.key, 100);
        assert_eq!(def.default_value, 50);
    }

    #[test]
    fn test_get_definition_not_exists() {
        let c = simple_config();
        assert!(get_definition(&c, 999).is_none());
    }

    // ============ Param Count Tests ============

    #[test]
    fn test_param_count_empty() {
        let c = create_config(1, 1000);
        assert_eq!(param_count(&c), 0);
    }

    #[test]
    fn test_param_count_populated() {
        let c = simple_config();
        assert_eq!(param_count(&c), 3);
    }

    // ============ Validate Value Tests ============

    #[test]
    fn test_validate_value_uint64_valid() {
        let def = uint_def(1, 50, 0, 100);
        assert!(validate_value(&def, 50).is_ok());
    }

    #[test]
    fn test_validate_value_uint64_at_min() {
        let def = uint_def(1, 10, 10, 100);
        assert!(validate_value(&def, 10).is_ok());
    }

    #[test]
    fn test_validate_value_uint64_at_max() {
        let def = uint_def(1, 50, 0, 100);
        assert!(validate_value(&def, 100).is_ok());
    }

    #[test]
    fn test_validate_value_uint64_below_min() {
        let def = uint_def(1, 50, 10, 100);
        assert_eq!(validate_value(&def, 5), Err(ConfigError::ValueOutOfRange));
    }

    #[test]
    fn test_validate_value_uint64_above_max() {
        let def = uint_def(1, 50, 0, 100);
        assert_eq!(validate_value(&def, 101), Err(ConfigError::ValueOutOfRange));
    }

    #[test]
    fn test_validate_value_bps_valid() {
        let def = bps_def(1, 30, 0, 500);
        assert!(validate_value(&def, 300).is_ok());
    }

    #[test]
    fn test_validate_value_bps_at_10000() {
        let def = bps_def(1, 5000, 0, 10000);
        assert!(validate_value(&def, 10000).is_ok());
    }

    #[test]
    fn test_validate_value_bps_above_10000() {
        let def = bps_def(1, 5000, 0, 20000);
        assert_eq!(validate_value(&def, 10001), Err(ConfigError::TypeMismatch));
    }

    #[test]
    fn test_validate_value_bool_zero() {
        let def = bool_def(1, 0);
        assert!(validate_value(&def, 0).is_ok());
    }

    #[test]
    fn test_validate_value_bool_one() {
        let def = bool_def(1, 1);
        assert!(validate_value(&def, 1).is_ok());
    }

    #[test]
    fn test_validate_value_bool_two() {
        let def = bool_def(1, 0);
        assert_eq!(validate_value(&def, 2), Err(ConfigError::TypeMismatch));
    }

    #[test]
    fn test_validate_value_percentage_valid() {
        let def = pct_def(1, 50, 0, 100);
        assert!(validate_value(&def, 75).is_ok());
    }

    #[test]
    fn test_validate_value_percentage_at_100() {
        let def = pct_def(1, 50, 0, 100);
        assert!(validate_value(&def, 100).is_ok());
    }

    #[test]
    fn test_validate_value_percentage_above_100() {
        let def = pct_def(1, 50, 0, 200);
        assert_eq!(validate_value(&def, 101), Err(ConfigError::TypeMismatch));
    }

    #[test]
    fn test_validate_value_duration_valid() {
        let def = dur_def(1, 5000, 1000, 60000);
        assert!(validate_value(&def, 30000).is_ok());
    }

    #[test]
    fn test_validate_value_duration_below_min() {
        let def = dur_def(1, 5000, 1000, 60000);
        assert_eq!(validate_value(&def, 500), Err(ConfigError::ValueOutOfRange));
    }

    // ============ Is Within Bounds Tests ============

    #[test]
    fn test_is_within_bounds_valid() {
        let c = simple_config();
        assert!(is_within_bounds(&c, 100, 50));
    }

    #[test]
    fn test_is_within_bounds_invalid() {
        let c = simple_config();
        assert!(!is_within_bounds(&c, 100, 200));
    }

    #[test]
    fn test_is_within_bounds_unknown_key() {
        let c = simple_config();
        assert!(!is_within_bounds(&c, 999, 50));
    }

    // ============ Params Requiring Governance Tests ============

    #[test]
    fn test_params_requiring_governance_none() {
        let c = simple_config();
        assert!(params_requiring_governance(&c).is_empty());
    }

    #[test]
    fn test_params_requiring_governance_some() {
        let c = populated_config();
        let gov = params_requiring_governance(&c);
        assert!(gov.contains(&3));
        assert!(!gov.contains(&1));
    }

    #[test]
    fn test_params_requiring_governance_default_config() {
        let c = default_vibeswap_config(1000);
        let gov = params_requiring_governance(&c);
        // commit_duration, reveal_duration, fee_rate, slash_rate, max_price_impact, circuit_breaker, governance_quorum, governance_period
        assert!(gov.len() >= 6);
    }

    // ============ Invalid Params Tests ============

    #[test]
    fn test_invalid_params_none() {
        let c = simple_config();
        assert!(invalid_params(&c).is_empty());
    }

    #[test]
    fn test_invalid_params_one_bad() {
        let mut c = simple_config();
        c.params[0].value = 999; // out of range for key 100 (max 100)
        let bad = invalid_params(&c);
        assert_eq!(bad.len(), 1);
        assert_eq!(bad[0], (100, 999));
    }

    // ============ Category Tests ============

    #[test]
    fn test_params_by_category_auction() {
        let c = populated_config();
        let auction_params = params_by_category(&c, &ParamCategory::Auction);
        assert_eq!(auction_params.len(), 2); // key 1 (uint64 auction) and key 6 (duration auction)
    }

    #[test]
    fn test_params_by_category_empty() {
        let c = simple_config();
        let bridge = params_by_category(&c, &ParamCategory::Bridge);
        assert!(bridge.is_empty());
    }

    #[test]
    fn test_params_by_category_values_correct() {
        let c = simple_config();
        let auction_params = params_by_category(&c, &ParamCategory::Auction);
        assert_eq!(auction_params.len(), 2);
        // keys 100 and 101 are Auction category in simple_config
        let vals: Vec<u64> = auction_params.iter().map(|(_, v)| *v).collect();
        assert!(vals.contains(&50));
        assert!(vals.contains(&75));
    }

    #[test]
    fn test_category_count_auction() {
        let c = populated_config();
        assert_eq!(category_count(&c, &ParamCategory::Auction), 2);
    }

    #[test]
    fn test_category_count_empty() {
        let c = simple_config();
        assert_eq!(category_count(&c, &ParamCategory::Bridge), 0);
    }

    #[test]
    fn test_all_categories_simple() {
        let c = simple_config();
        let cats = all_categories(&c);
        assert!(cats.contains(&ParamCategory::Auction));
        assert!(cats.contains(&ParamCategory::Fees));
    }

    #[test]
    fn test_all_categories_populated() {
        let c = populated_config();
        let cats = all_categories(&c);
        assert!(cats.len() >= 4);
    }

    #[test]
    fn test_all_categories_no_duplicates() {
        let c = populated_config();
        let cats = all_categories(&c);
        for i in 0..cats.len() {
            for j in (i + 1)..cats.len() {
                assert_ne!(cats[i], cats[j]);
            }
        }
    }

    // ============ Versioning Tests ============

    #[test]
    fn test_bump_version_basic() {
        let mut c = create_config(1, 1000);
        let new_ver = bump_version(&mut c);
        assert_eq!(new_ver, 2);
        assert_eq!(c.version, 2);
    }

    #[test]
    fn test_bump_version_multiple() {
        let mut c = create_config(1, 1000);
        let _ = bump_version(&mut c);
        let _ = bump_version(&mut c);
        let v = bump_version(&mut c);
        assert_eq!(v, 4);
    }

    #[test]
    fn test_diff_configs_no_changes() {
        let c = simple_config();
        let diff = diff_configs(&c, &c);
        assert!(diff.changes.is_empty());
        assert!(diff.added_keys.is_empty());
        assert!(diff.removed_keys.is_empty());
    }

    #[test]
    fn test_diff_configs_value_changed() {
        let old = simple_config();
        let mut new = old.clone();
        new.params[0].value = 99;
        let diff = diff_configs(&old, &new);
        assert_eq!(diff.changes.len(), 1);
        assert_eq!(diff.changes[0], (100, 50, 99));
    }

    #[test]
    fn test_diff_configs_added_key() {
        let old = simple_config();
        let mut new = old.clone();
        new.params.push(ParamValue {
            key: 200,
            value: 10,
            updated_at: 2000,
            updated_by: [0u8; 32],
            previous_value: 10,
            version: 1,
        });
        let diff = diff_configs(&old, &new);
        assert_eq!(diff.added_keys, vec![200]);
    }

    #[test]
    fn test_diff_configs_removed_key() {
        let old = simple_config();
        let mut new = old.clone();
        new.params.retain(|p| p.key != 100);
        let diff = diff_configs(&old, &new);
        assert_eq!(diff.removed_keys, vec![100]);
    }

    #[test]
    fn test_diff_configs_versions() {
        let old = create_config(1, 1000);
        let new = create_config(5, 2000);
        let diff = diff_configs(&old, &new);
        assert_eq!(diff.from_version, 1);
        assert_eq!(diff.to_version, 5);
    }

    #[test]
    fn test_apply_diff_changes() {
        let old = simple_config();
        let mut new = old.clone();
        new.params[0].value = 99;
        let diff = diff_configs(&old, &new);

        let mut target = old.clone();
        let applied = apply_diff(&mut target, &diff, addr(1), 3000).unwrap();
        assert_eq!(applied, 1);
        assert_eq!(get_param(&target, 100), Some(99));
    }

    #[test]
    fn test_apply_diff_removes_keys() {
        let old = simple_config();
        let mut new = old.clone();
        new.params.retain(|p| p.key != 100);
        new.definitions.retain(|d| d.key != 100);
        let diff = diff_configs(&old, &new);

        let mut target = old.clone();
        let applied = apply_diff(&mut target, &diff, addr(1), 3000).unwrap();
        assert_eq!(applied, 1);
        assert!(get_param(&target, 100).is_none());
    }

    #[test]
    fn test_apply_diff_frozen() {
        let old = simple_config();
        let diff = ConfigDiff {
            from_version: 1,
            to_version: 2,
            changes: vec![(100, 50, 99)],
            added_keys: vec![],
            removed_keys: vec![],
        };
        let mut target = old;
        let _ = freeze_config(&mut target);
        let result = apply_diff(&mut target, &diff, addr(1), 3000);
        assert_eq!(result, Err(ConfigError::ConfigFrozen));
    }

    #[test]
    fn test_apply_diff_invalid_value() {
        let old = simple_config();
        let diff = ConfigDiff {
            from_version: 1,
            to_version: 2,
            changes: vec![(100, 50, 9999)], // out of bounds
            added_keys: vec![],
            removed_keys: vec![],
        };
        let mut target = old;
        let result = apply_diff(&mut target, &diff, addr(1), 3000);
        assert_eq!(result, Err(ConfigError::ValueOutOfRange));
    }

    #[test]
    fn test_has_changed_since_true() {
        let mut c = simple_config();
        let _ = set_param(&mut c, 100, 60, addr(1), 2000);
        assert!(has_changed_since(&c, 0));
    }

    #[test]
    fn test_has_changed_since_false() {
        let c = create_config(1, 1000);
        assert!(!has_changed_since(&c, 1));
    }

    #[test]
    fn test_has_changed_since_version_bump() {
        let mut c = create_config(1, 1000);
        let _ = bump_version(&mut c);
        assert!(has_changed_since(&c, 1));
    }

    #[test]
    fn test_changes_since_none() {
        let c = simple_config();
        let changes = changes_since(&c, 5000);
        assert!(changes.is_empty());
    }

    #[test]
    fn test_changes_since_some() {
        let mut c = simple_config();
        let _ = set_param(&mut c, 100, 60, addr(1), 3000);
        let changes = changes_since(&c, 2000);
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].key, 100);
    }

    #[test]
    fn test_changes_since_boundary() {
        let mut c = simple_config();
        let _ = set_param(&mut c, 100, 60, addr(1), 2000);
        // since=2000 should NOT include things updated AT 2000 (strictly >)
        let changes = changes_since(&c, 2000);
        assert!(changes.is_empty());
    }

    // ============ Migration Tests ============

    #[test]
    fn test_migrate_config_add_params() {
        let mut c = simple_config();
        let new_params = vec![uint_def(200, 10, 0, 100)];
        let (added, removed) = migrate_config(&mut c, &new_params, &[], 2000).unwrap();
        assert_eq!(added, 1);
        assert_eq!(removed, 0);
        assert_eq!(get_param(&c, 200), Some(10));
    }

    #[test]
    fn test_migrate_config_remove_params() {
        let mut c = simple_config();
        let (added, removed) = migrate_config(&mut c, &[], &[100], 2000).unwrap();
        assert_eq!(added, 0);
        assert_eq!(removed, 1);
        assert!(get_param(&c, 100).is_none());
    }

    #[test]
    fn test_migrate_config_add_and_remove() {
        let mut c = simple_config();
        let new_params = vec![uint_def(200, 10, 0, 100)];
        let (added, removed) = migrate_config(&mut c, &new_params, &[100], 2000).unwrap();
        assert_eq!(added, 1);
        assert_eq!(removed, 1);
    }

    #[test]
    fn test_migrate_config_bumps_version() {
        let mut c = simple_config();
        let ver_before = c.version;
        let _ = migrate_config(&mut c, &[uint_def(200, 10, 0, 100)], &[], 2000);
        assert_eq!(c.version, ver_before + 1);
    }

    #[test]
    fn test_migrate_config_duplicate_key() {
        let mut c = simple_config();
        let result = migrate_config(&mut c, &[uint_def(100, 10, 0, 100)], &[], 2000);
        assert_eq!(result, Err(ConfigError::DuplicateKey));
    }

    #[test]
    fn test_migrate_config_invalid_default() {
        let mut c = simple_config();
        let bad = bps_def(200, 20000, 0, 20000); // default > 10000
        let result = migrate_config(&mut c, &[bad], &[], 2000);
        assert_eq!(result, Err(ConfigError::InvalidDefault));
    }

    #[test]
    fn test_migrate_config_frozen() {
        let mut c = simple_config();
        let _ = freeze_config(&mut c);
        let result = migrate_config(&mut c, &[], &[100], 2000);
        assert_eq!(result, Err(ConfigError::MigrationError));
    }

    #[test]
    fn test_migrate_config_remove_nonexistent() {
        let mut c = simple_config();
        let (added, removed) = migrate_config(&mut c, &[], &[999], 2000).unwrap();
        assert_eq!(added, 0);
        assert_eq!(removed, 0); // key 999 doesn't exist, nothing removed
    }

    // ============ Is Compatible Tests ============

    #[test]
    fn test_is_compatible_same() {
        let c = populated_config();
        assert!(is_compatible(&c, &c));
    }

    #[test]
    fn test_is_compatible_governance_removed() {
        let old = populated_config();
        let mut new = old.clone();
        new.definitions.retain(|d| d.key != 3); // remove governance param
        assert!(!is_compatible(&old, &new));
    }

    #[test]
    fn test_is_compatible_non_gov_removed() {
        let old = populated_config();
        let mut new = old.clone();
        new.definitions.retain(|d| d.key != 1); // remove non-governance param
        assert!(is_compatible(&old, &new));
    }

    #[test]
    fn test_is_compatible_param_added() {
        let old = simple_config();
        let mut new = old.clone();
        new.definitions.push(uint_def(500, 10, 0, 100));
        assert!(is_compatible(&old, &new));
    }

    // ============ Merge Configs Tests ============

    #[test]
    fn test_merge_configs_overlay_wins() {
        let base = simple_config();
        let mut overlay = base.clone();
        overlay.params[0].value = 99;
        let merged = merge_configs(&base, &overlay);
        assert_eq!(get_param(&merged, 100), Some(99));
    }

    #[test]
    fn test_merge_configs_base_preserved() {
        let base = simple_config();
        let overlay = create_config(1, 1000);
        let merged = merge_configs(&base, &overlay);
        assert_eq!(get_param(&merged, 100), Some(50)); // base value preserved
    }

    #[test]
    fn test_merge_configs_overlay_adds_new() {
        let base = simple_config();
        let mut overlay = create_config(1, 2000);
        let _ = register_param(&mut overlay, uint_def(500, 10, 0, 100), 2000);
        let merged = merge_configs(&base, &overlay);
        assert_eq!(get_param(&merged, 500), Some(10));
        assert_eq!(get_param(&merged, 100), Some(50)); // base still there
    }

    #[test]
    fn test_merge_configs_higher_version_wins() {
        let base = create_config(3, 1000);
        let overlay = create_config(7, 2000);
        let merged = merge_configs(&base, &overlay);
        assert_eq!(merged.version, 7);
    }

    #[test]
    fn test_merge_configs_later_timestamp_wins() {
        let base = create_config(1, 5000);
        let overlay = create_config(1, 3000);
        let merged = merge_configs(&base, &overlay);
        assert_eq!(merged.last_modified, 5000);
    }

    // ============ Snapshot Tests ============

    #[test]
    fn test_take_snapshot_basic() {
        let c = simple_config();
        let snap = take_snapshot(&c, 5000);
        assert_eq!(snap.version, c.version);
        assert_eq!(snap.timestamp, 5000);
        assert_eq!(snap.param_count, 3);
    }

    #[test]
    fn test_verify_snapshot_valid() {
        let c = simple_config();
        let snap = take_snapshot(&c, 5000);
        assert!(verify_snapshot(&c, &snap));
    }

    #[test]
    fn test_verify_snapshot_after_change() {
        let mut c = simple_config();
        let snap = take_snapshot(&c, 5000);
        let _ = set_param(&mut c, 100, 60, addr(1), 6000);
        assert!(!verify_snapshot(&c, &snap));
    }

    #[test]
    fn test_verify_snapshot_wrong_version() {
        let c = simple_config();
        let mut snap = take_snapshot(&c, 5000);
        snap.version = 999;
        assert!(!verify_snapshot(&c, &snap));
    }

    #[test]
    fn test_verify_snapshot_wrong_count() {
        let c = simple_config();
        let mut snap = take_snapshot(&c, 5000);
        snap.param_count = 999;
        assert!(!verify_snapshot(&c, &snap));
    }

    #[test]
    fn test_compute_config_hash_deterministic() {
        let c = simple_config();
        let h1 = compute_config_hash(&c);
        let h2 = compute_config_hash(&c);
        assert_eq!(h1, h2);
    }

    #[test]
    fn test_compute_config_hash_changes_with_value() {
        let c1 = simple_config();
        let mut c2 = simple_config();
        c2.params[0].value = 99;
        assert_ne!(compute_config_hash(&c1), compute_config_hash(&c2));
    }

    #[test]
    fn test_compute_config_hash_empty() {
        let c = create_config(1, 1000);
        let h = compute_config_hash(&c);
        // Empty config should still produce a valid hash
        assert_eq!(h.len(), 32);
    }

    // ============ Freeze Tests ============

    #[test]
    fn test_freeze_config_basic() {
        let mut c = simple_config();
        assert!(freeze_config(&mut c).is_ok());
        assert!(is_frozen(&c));
    }

    #[test]
    fn test_freeze_config_already_frozen() {
        let mut c = simple_config();
        let _ = freeze_config(&mut c);
        let result = freeze_config(&mut c);
        assert_eq!(result, Err(ConfigError::ConfigFrozen));
    }

    #[test]
    fn test_unfreeze_config() {
        let mut c = simple_config();
        let _ = freeze_config(&mut c);
        unfreeze_config(&mut c);
        assert!(!is_frozen(&c));
    }

    #[test]
    fn test_unfreeze_already_unfrozen() {
        let mut c = simple_config();
        unfreeze_config(&mut c); // no-op, no error
        assert!(!is_frozen(&c));
    }

    #[test]
    fn test_is_frozen_default() {
        let c = create_config(1, 1000);
        assert!(!is_frozen(&c));
    }

    #[test]
    fn test_frozen_blocks_set_param() {
        let mut c = simple_config();
        let _ = freeze_config(&mut c);
        assert_eq!(set_param(&mut c, 100, 60, addr(1), 2000), Err(ConfigError::ConfigFrozen));
    }

    #[test]
    fn test_frozen_blocks_batch_set() {
        let mut c = simple_config();
        let _ = freeze_config(&mut c);
        assert_eq!(batch_set(&mut c, &[(100, 60)], addr(1), 2000), Err(ConfigError::ConfigFrozen));
    }

    // ============ Batch Set Tests ============

    #[test]
    fn test_batch_set_single() {
        let mut c = simple_config();
        let count = batch_set(&mut c, &[(100, 60)], addr(1), 2000).unwrap();
        assert_eq!(count, 1);
        assert_eq!(get_param(&c, 100), Some(60));
    }

    #[test]
    fn test_batch_set_multiple() {
        let mut c = simple_config();
        let count = batch_set(&mut c, &[(100, 60), (101, 100)], addr(1), 2000).unwrap();
        assert_eq!(count, 2);
        assert_eq!(get_param(&c, 100), Some(60));
        assert_eq!(get_param(&c, 101), Some(100));
    }

    #[test]
    fn test_batch_set_atomic_failure() {
        let mut c = simple_config();
        // Second update is out of range — entire batch should fail
        let result = batch_set(&mut c, &[(100, 60), (101, 999)], addr(1), 2000);
        assert_eq!(result, Err(ConfigError::ValueOutOfRange));
        // First param should NOT have changed
        assert_eq!(get_param(&c, 100), Some(50));
    }

    #[test]
    fn test_batch_set_empty() {
        let mut c = simple_config();
        let count = batch_set(&mut c, &[], addr(1), 2000).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_batch_set_unknown_key() {
        let mut c = simple_config();
        let result = batch_set(&mut c, &[(999, 10)], addr(1), 2000);
        assert_eq!(result, Err(ConfigError::ParamNotFound));
    }

    #[test]
    fn test_batch_set_updates_metadata() {
        let mut c = simple_config();
        let _ = batch_set(&mut c, &[(100, 60)], addr(5), 9000);
        let pv = c.params.iter().find(|p| p.key == 100).unwrap();
        assert_eq!(pv.updated_at, 9000);
        assert_eq!(pv.updated_by, addr(5));
    }

    // ============ Export/Import Tests ============

    #[test]
    fn test_export_values_basic() {
        let c = simple_config();
        let vals = export_values(&c);
        assert_eq!(vals.len(), 3);
    }

    #[test]
    fn test_export_values_empty() {
        let c = create_config(1, 1000);
        let vals = export_values(&c);
        assert!(vals.is_empty());
    }

    #[test]
    fn test_export_values_contains_correct_pairs() {
        let c = simple_config();
        let vals = export_values(&c);
        assert!(vals.contains(&(100, 50)));
        assert!(vals.contains(&(101, 75)));
        assert!(vals.contains(&(102, 30)));
    }

    #[test]
    fn test_import_values_basic() {
        let mut c = simple_config();
        let count = import_values(&mut c, &[(100, 60)], addr(1), 3000).unwrap();
        assert_eq!(count, 1);
        assert_eq!(get_param(&c, 100), Some(60));
    }

    #[test]
    fn test_import_values_multiple() {
        let mut c = simple_config();
        let count = import_values(&mut c, &[(100, 60), (101, 100)], addr(1), 3000).unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn test_import_values_unknown_key() {
        let mut c = simple_config();
        let result = import_values(&mut c, &[(999, 10)], addr(1), 3000);
        assert_eq!(result, Err(ConfigError::ParamNotFound));
    }

    #[test]
    fn test_import_values_out_of_range() {
        let mut c = simple_config();
        let result = import_values(&mut c, &[(100, 999)], addr(1), 3000);
        assert_eq!(result, Err(ConfigError::ValueOutOfRange));
    }

    #[test]
    fn test_import_values_frozen() {
        let mut c = simple_config();
        let _ = freeze_config(&mut c);
        let result = import_values(&mut c, &[(100, 60)], addr(1), 3000);
        assert_eq!(result, Err(ConfigError::ConfigFrozen));
    }

    #[test]
    fn test_export_import_roundtrip() {
        let c1 = simple_config();
        let vals = export_values(&c1);
        let mut c2 = simple_config();
        let _ = set_param(&mut c2, 100, 80, addr(1), 2000); // change a value
        let _ = import_values(&mut c2, &vals, addr(2), 3000);
        assert_eq!(get_param(&c2, 100), Some(50)); // restored to c1's value
    }

    // ============ Analytics Tests ============

    #[test]
    fn test_recently_changed_none() {
        let c = simple_config(); // all updated at 1000
        // window=100, now=2000 => cutoff=1900, updated_at(1000) > 1900 => false
        let recent = recently_changed(&c, 100, 2000);
        assert!(recent.is_empty());
    }

    #[test]
    fn test_recently_changed_all() {
        let c = simple_config(); // all updated at 1000
        // window=2000, now=1500 => cutoff=0 (saturating), updated_at(1000) > 0 => true
        let recent = recently_changed(&c, 2000, 1500);
        assert_eq!(recent.len(), 3);
    }

    #[test]
    fn test_recently_changed_some() {
        let mut c = simple_config();
        let _ = set_param(&mut c, 100, 60, addr(1), 5000);
        let recent = recently_changed(&c, 1000, 5500);
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].key, 100);
    }

    #[test]
    fn test_recently_changed_saturating_sub() {
        let c = simple_config(); // all updated at 1000
        let recent = recently_changed(&c, u64::MAX, 500);
        // saturating_sub: 500 - MAX = 0, so updated_at > 0 is true for all
        assert_eq!(recent.len(), 3);
    }

    #[test]
    fn test_most_changed_params_sorted() {
        let mut c = simple_config();
        // Bump key 101 version twice
        let _ = set_param(&mut c, 101, 80, addr(1), 2000);
        let _ = set_param(&mut c, 101, 90, addr(1), 3000);
        let most = most_changed_params(&c);
        // key 101 should be first (highest version)
        assert_eq!(most[0].0, 101);
    }

    #[test]
    fn test_most_changed_params_empty() {
        let c = create_config(1, 1000);
        let most = most_changed_params(&c);
        assert!(most.is_empty());
    }

    #[test]
    fn test_governance_params_ratio_zero() {
        let c = simple_config(); // no governance params
        assert_eq!(governance_params_ratio(&c), 0);
    }

    #[test]
    fn test_governance_params_ratio_some() {
        let c = populated_config();
        let ratio = governance_params_ratio(&c);
        // 1 governance param out of 6 = 1666 bps
        assert_eq!(ratio, 1666);
    }

    #[test]
    fn test_governance_params_ratio_empty() {
        let c = create_config(1, 1000);
        assert_eq!(governance_params_ratio(&c), 0);
    }

    #[test]
    fn test_governance_params_ratio_all_governance() {
        let mut c = create_config(1, 1000);
        let _ = register_param(&mut c, gov_def(1, 100, 0, 1000), 1000);
        let _ = register_param(&mut c, gov_def(2, 200, 0, 1000), 1000);
        assert_eq!(governance_params_ratio(&c), 10000);
    }

    #[test]
    fn test_deviation_from_defaults_none() {
        let c = simple_config();
        assert!(deviation_from_defaults(&c).is_empty());
    }

    #[test]
    fn test_deviation_from_defaults_some() {
        let mut c = simple_config();
        let _ = set_param(&mut c, 100, 80, addr(1), 2000);
        let devs = deviation_from_defaults(&c);
        assert_eq!(devs.len(), 1);
        assert_eq!(devs[0], (100, 80, 50));
    }

    #[test]
    fn test_deviation_from_defaults_multiple() {
        let mut c = simple_config();
        let _ = set_param(&mut c, 100, 80, addr(1), 2000);
        let _ = set_param(&mut c, 101, 150, addr(1), 2000);
        let devs = deviation_from_defaults(&c);
        assert_eq!(devs.len(), 2);
    }

    // ============ Convenience Getter Tests ============

    #[test]
    fn test_commit_duration_default() {
        let c = default_vibeswap_config(1000);
        assert_eq!(commit_duration(&c), 8000);
    }

    #[test]
    fn test_reveal_duration_default() {
        let c = default_vibeswap_config(1000);
        assert_eq!(reveal_duration(&c), 2000);
    }

    #[test]
    fn test_fee_rate_bps_default() {
        let c = default_vibeswap_config(1000);
        assert_eq!(fee_rate_bps(&c), 30);
    }

    #[test]
    fn test_slash_rate_bps_default() {
        let c = default_vibeswap_config(1000);
        assert_eq!(slash_rate_bps(&c), 5000);
    }

    #[test]
    fn test_max_price_impact_bps_default() {
        let c = default_vibeswap_config(1000);
        assert_eq!(max_price_impact_bps(&c), 500);
    }

    #[test]
    fn test_commit_duration_missing() {
        let c = create_config(1, 1000);
        assert_eq!(commit_duration(&c), 0);
    }

    #[test]
    fn test_reveal_duration_missing() {
        let c = create_config(1, 1000);
        assert_eq!(reveal_duration(&c), 0);
    }

    #[test]
    fn test_fee_rate_bps_missing() {
        let c = create_config(1, 1000);
        assert_eq!(fee_rate_bps(&c), 0);
    }

    #[test]
    fn test_slash_rate_bps_missing() {
        let c = create_config(1, 1000);
        assert_eq!(slash_rate_bps(&c), 0);
    }

    #[test]
    fn test_max_price_impact_bps_missing() {
        let c = create_config(1, 1000);
        assert_eq!(max_price_impact_bps(&c), 0);
    }

    #[test]
    fn test_convenience_getters_after_update() {
        let mut c = default_vibeswap_config(1000);
        let _ = set_param_unchecked(&mut c, KEY_COMMIT_DURATION, 10000, addr(1), 2000);
        assert_eq!(commit_duration(&c), 10000);
    }

    // ============ Integration Tests ============

    #[test]
    fn test_full_lifecycle() {
        // Create -> register -> set -> snapshot -> verify
        let mut c = create_config(1, 1000);
        let _ = register_param(&mut c, uint_def(1, 50, 0, 100), 1000);
        let _ = register_param(&mut c, bps_def(2, 30, 0, 500), 1000);

        assert!(validate_config(&c).is_ok());

        let _ = set_param(&mut c, 1, 75, addr(1), 2000);
        let snap = take_snapshot(&c, 2000);
        assert!(verify_snapshot(&c, &snap));

        let _ = set_param(&mut c, 1, 80, addr(2), 3000);
        assert!(!verify_snapshot(&c, &snap));
    }

    #[test]
    fn test_freeze_unfreeze_cycle() {
        let mut c = simple_config();
        let _ = freeze_config(&mut c);
        assert!(set_param(&mut c, 100, 60, addr(1), 2000).is_err());
        unfreeze_config(&mut c);
        assert!(set_param(&mut c, 100, 60, addr(1), 2000).is_ok());
    }

    #[test]
    fn test_migration_preserves_existing() {
        let mut c = simple_config();
        let _ = set_param(&mut c, 100, 80, addr(1), 2000);
        let _ = migrate_config(&mut c, &[uint_def(300, 10, 0, 50)], &[], 3000);
        assert_eq!(get_param(&c, 100), Some(80)); // preserved
        assert_eq!(get_param(&c, 300), Some(10)); // added
    }

    #[test]
    fn test_diff_and_apply_roundtrip() {
        let old = simple_config();
        let mut new = old.clone();
        let _ = set_param(&mut new, 100, 80, addr(1), 2000);
        let _ = set_param(&mut new, 101, 150, addr(1), 2000);

        let diff = diff_configs(&old, &new);
        assert_eq!(diff.changes.len(), 2);

        let mut target = old.clone();
        let applied = apply_diff(&mut target, &diff, addr(2), 3000).unwrap();
        assert_eq!(applied, 2);
        assert_eq!(get_param(&target, 100), Some(80));
        assert_eq!(get_param(&target, 101), Some(150));
    }

    #[test]
    fn test_batch_set_and_export() {
        let mut c = simple_config();
        let _ = batch_set(&mut c, &[(100, 90), (101, 180)], addr(1), 2000);
        let vals = export_values(&c);
        assert!(vals.contains(&(100, 90)));
        assert!(vals.contains(&(101, 180)));
    }

    #[test]
    fn test_reset_all_then_validate() {
        let mut c = simple_config();
        let _ = set_param(&mut c, 100, 80, addr(1), 2000);
        let _ = set_param(&mut c, 101, 150, addr(1), 2000);
        let count = reset_all_defaults(&mut c, addr(2), 3000);
        assert_eq!(count, 2);
        assert!(validate_config(&c).is_ok());
    }

    #[test]
    fn test_default_config_all_params_in_bounds() {
        let c = default_vibeswap_config(1000);
        assert!(invalid_params(&c).is_empty());
    }

    #[test]
    fn test_snapshot_empty_config() {
        let c = create_config(1, 1000);
        let snap = take_snapshot(&c, 2000);
        assert_eq!(snap.param_count, 0);
        assert!(verify_snapshot(&c, &snap));
    }

    #[test]
    fn test_merge_then_validate() {
        let base = simple_config();
        let mut overlay = create_config(2, 2000);
        let _ = register_param(&mut overlay, uint_def(200, 10, 0, 100), 2000);
        let merged = merge_configs(&base, &overlay);
        // Merged config has both base and overlay definitions
        assert_eq!(param_count(&merged), 4);
    }

    #[test]
    fn test_param_value_version_increments() {
        let mut c = simple_config();
        let pv0 = c.params.iter().find(|p| p.key == 100).unwrap().version;
        let _ = set_param(&mut c, 100, 60, addr(1), 2000);
        let pv1 = c.params.iter().find(|p| p.key == 100).unwrap().version;
        let _ = set_param(&mut c, 100, 70, addr(1), 3000);
        let pv2 = c.params.iter().find(|p| p.key == 100).unwrap().version;
        assert_eq!(pv1, pv0 + 1);
        assert_eq!(pv2, pv0 + 2);
    }

    #[test]
    fn test_multiple_registrations_different_types() {
        let mut c = create_config(1, 1000);
        let _ = register_param(&mut c, uint_def(1, 100, 0, 1000), 1000);
        let _ = register_param(&mut c, bps_def(2, 50, 0, 500), 1000);
        let _ = register_param(&mut c, pct_def(3, 50, 0, 100), 1000);
        let _ = register_param(&mut c, bool_def(4, 1), 1000);
        let _ = register_param(&mut c, dur_def(5, 5000, 1000, 60000), 1000);
        assert_eq!(param_count(&c), 5);
        assert!(validate_config(&c).is_ok());
    }

    #[test]
    fn test_changes_since_after_batch() {
        let mut c = simple_config();
        let _ = batch_set(&mut c, &[(100, 60), (101, 100)], addr(1), 5000);
        let changes = changes_since(&c, 4000);
        assert_eq!(changes.len(), 2);
    }

    #[test]
    fn test_deviation_after_reset() {
        let mut c = simple_config();
        let _ = set_param(&mut c, 100, 80, addr(1), 2000);
        assert_eq!(deviation_from_defaults(&c).len(), 1);
        let _ = reset_to_default(&mut c, 100, addr(2), 3000);
        assert!(deviation_from_defaults(&c).is_empty());
    }

    #[test]
    fn test_hash_changes_after_migration() {
        let mut c = simple_config();
        let h1 = compute_config_hash(&c);
        let _ = migrate_config(&mut c, &[uint_def(300, 10, 0, 50)], &[], 2000);
        let h2 = compute_config_hash(&c);
        assert_ne!(h1, h2);
    }

    #[test]
    fn test_governance_ratio_changes_after_migration() {
        let mut c = simple_config(); // all non-governance
        assert_eq!(governance_params_ratio(&c), 0);
        let _ = migrate_config(&mut c, &[gov_def(300, 100, 0, 1000)], &[], 2000);
        // 1 out of 4 = 2500 bps
        assert_eq!(governance_params_ratio(&c), 2500);
    }

    #[test]
    fn test_apply_diff_empty() {
        let mut c = simple_config();
        let diff = ConfigDiff {
            from_version: 1,
            to_version: 1,
            changes: vec![],
            added_keys: vec![],
            removed_keys: vec![],
        };
        let applied = apply_diff(&mut c, &diff, addr(1), 2000).unwrap();
        assert_eq!(applied, 0);
    }

    #[test]
    fn test_most_changed_single_param() {
        let mut c = create_config(1, 1000);
        let _ = register_param(&mut c, uint_def(1, 10, 0, 100), 1000);
        let _ = set_param(&mut c, 1, 20, addr(1), 2000);
        let _ = set_param(&mut c, 1, 30, addr(1), 3000);
        let _ = set_param(&mut c, 1, 40, addr(1), 4000);
        let most = most_changed_params(&c);
        assert_eq!(most.len(), 1);
        assert_eq!(most[0].0, 1);
        assert_eq!(most[0].1, 4); // version 1 + 3 bumps = 4
    }

    #[test]
    fn test_diff_configs_multiple_changes() {
        let old = simple_config();
        let mut new = old.clone();
        new.params[0].value = 10;
        new.params[1].value = 20;
        new.params[2].value = 40;
        let diff = diff_configs(&old, &new);
        assert_eq!(diff.changes.len(), 3);
    }

    #[test]
    fn test_validate_value_address_type() {
        let def = test_def(1, ParamType::Address, ParamCategory::Security, 0, 0, u64::MAX, false);
        assert!(validate_value(&def, 0).is_ok());
        assert!(validate_value(&def, u64::MAX).is_ok());
    }

    #[test]
    fn test_bps_zero_valid() {
        let def = bps_def(1, 0, 0, 500);
        assert!(validate_value(&def, 0).is_ok());
    }

    #[test]
    fn test_percentage_zero_valid() {
        let def = pct_def(1, 0, 0, 100);
        assert!(validate_value(&def, 0).is_ok());
    }

    #[test]
    fn test_register_param_param_value_metadata() {
        let mut c = create_config(1, 5000);
        let _ = register_param(&mut c, uint_def(42, 99, 0, 200), 5000);
        let pv = c.params.iter().find(|p| p.key == 42).unwrap();
        assert_eq!(pv.key, 42);
        assert_eq!(pv.value, 99);
        assert_eq!(pv.updated_at, 5000);
        assert_eq!(pv.updated_by, [0u8; 32]);
        assert_eq!(pv.previous_value, 99);
        assert_eq!(pv.version, 1);
    }
}
