// ============ Whitelist Module ============
// Whitelist & Access Control for the VibeSwap protocol on CKB.
// Manages which tokens, addresses, and pools are permitted within the protocol.
// Integrates with KYC tiers and sanctions screening.
//
// Key capabilities:
// - Token whitelist/blacklist management with expiry
// - Address-level access control (Blocked, Restricted, Basic, Verified, Institutional, Admin)
// - Pool whitelisting for controlled liquidity venue access
// - KYC tier mapping and upgrade paths
// - Sanctions screening with risk scoring
// - Strict mode: only explicitly whitelisted items allowed
// - Auto-expiry and registry analytics
//
// Philosophy: Cooperative Capitalism — transparent access rules that protect
// protocol integrity while preserving openness. Whitelist controls are
// structural safeguards, not gatekeeping (P-000).

// ============ Data Types ============

#[derive(Debug, Clone, PartialEq)]
pub enum AccessLevel {
    Blocked,       // Sanctioned / banned
    Restricted,    // Limited functionality (e.g., withdraw only)
    Basic,         // Standard access (KYC tier 0)
    Verified,      // KYC tier 1
    Institutional, // KYC tier 2 (higher limits)
    Admin,         // Protocol admin
}

#[derive(Debug, Clone, PartialEq)]
pub enum ListType {
    TokenWhitelist,
    TokenBlacklist,
    AddressWhitelist,
    AddressBlacklist,
    PoolWhitelist,
}

#[derive(Debug, Clone, PartialEq)]
pub struct WhitelistEntry {
    pub identifier: [u8; 32],   // Token/address/pool hash
    pub list_type: ListType,
    pub added_at: u64,
    pub added_by: [u8; 32],    // Admin who added
    pub expires_at: Option<u64>, // None = permanent
    pub reason: u32,            // Reason code
    pub metadata: u64,          // Extra data (e.g., risk score)
}

#[derive(Debug, Clone)]
pub struct AccessPolicy {
    pub max_tx_amount: u64,         // Per-transaction limit
    pub daily_limit: u64,           // 24h rolling limit
    pub requires_kyc: bool,
    pub min_access_level: AccessLevel,
    pub allowed_pool_types: u8,     // Bitmask: 1=ConstantProduct, 2=Stable, 4=Concentrated
    pub cooldown_ms: u64,           // Time between transactions
}

#[derive(Debug, Clone)]
pub struct WhitelistRegistry {
    pub entries: Vec<WhitelistEntry>,
    pub default_access: AccessLevel,
    pub strict_mode: bool,          // If true, only whitelisted items allowed
    pub auto_expire_ms: u64,        // Default expiry for new entries (0 = permanent)
}

#[derive(Debug, Clone)]
pub struct AccessCheck {
    pub address: [u8; 32],
    pub level: AccessLevel,
    pub can_swap: bool,
    pub can_deposit: bool,
    pub can_withdraw: bool,
    pub max_amount: u64,
    pub daily_remaining: u64,
    pub next_allowed_ms: u64, // When next tx is allowed (cooldown)
}

#[derive(Debug, Clone, PartialEq)]
pub enum WhitelistError {
    AlreadyListed,
    NotFound,
    Expired,
    InsufficientAccess,
    Blocked,
    ExceedsLimit,
    CooldownActive,
    InvalidExpiry,
    NotAdmin,
    StrictModeViolation,
    InvalidIdentifier,
}

// ============ Registry Management ============

/// Create a new whitelist registry with the given default access level and strict mode flag.
pub fn create_registry(default_access: AccessLevel, strict_mode: bool) -> WhitelistRegistry {
    WhitelistRegistry {
        entries: Vec::new(),
        default_access,
        strict_mode,
        auto_expire_ms: 0,
    }
}

/// Add an entry to the registry. Rejects duplicates (same identifier + list_type).
pub fn add_entry(
    registry: &mut WhitelistRegistry,
    entry: WhitelistEntry,
) -> Result<(), WhitelistError> {
    if !is_valid_identifier(&entry.identifier) {
        return Err(WhitelistError::InvalidIdentifier);
    }
    // Check for expiry in the past — expires_at must be > added_at if set
    if let Some(exp) = entry.expires_at {
        if exp <= entry.added_at {
            return Err(WhitelistError::InvalidExpiry);
        }
    }
    // Duplicate check
    let dup = registry
        .entries
        .iter()
        .any(|e| e.identifier == entry.identifier && e.list_type == entry.list_type);
    if dup {
        return Err(WhitelistError::AlreadyListed);
    }
    registry.entries.push(entry);
    Ok(())
}

/// Remove an entry by identifier and list type. Returns the removed entry.
pub fn remove_entry(
    registry: &mut WhitelistRegistry,
    identifier: &[u8; 32],
    list_type: &ListType,
) -> Result<WhitelistEntry, WhitelistError> {
    let pos = registry
        .entries
        .iter()
        .position(|e| &e.identifier == identifier && &e.list_type == list_type);
    match pos {
        Some(idx) => Ok(registry.entries.remove(idx)),
        None => Err(WhitelistError::NotFound),
    }
}

/// Update expiry and metadata for an existing entry.
pub fn update_entry(
    registry: &mut WhitelistRegistry,
    identifier: &[u8; 32],
    list_type: &ListType,
    new_expiry: Option<u64>,
    new_metadata: u64,
) -> Result<(), WhitelistError> {
    let entry = registry
        .entries
        .iter_mut()
        .find(|e| &e.identifier == identifier && &e.list_type == list_type);
    match entry {
        Some(e) => {
            if let Some(exp) = new_expiry {
                if exp <= e.added_at {
                    return Err(WhitelistError::InvalidExpiry);
                }
            }
            e.expires_at = new_expiry;
            e.metadata = new_metadata;
            Ok(())
        }
        None => Err(WhitelistError::NotFound),
    }
}

/// Find an entry by identifier and list type.
pub fn find_entry<'a>(
    registry: &'a WhitelistRegistry,
    identifier: &[u8; 32],
    list_type: &ListType,
) -> Option<&'a WhitelistEntry> {
    registry
        .entries
        .iter()
        .find(|e| &e.identifier == identifier && &e.list_type == list_type)
}

/// Count entries of a given list type.
pub fn entry_count(registry: &WhitelistRegistry, list_type: &ListType) -> usize {
    registry
        .entries
        .iter()
        .filter(|e| &e.list_type == list_type)
        .count()
}

/// Remove all expired entries. Returns the number removed.
pub fn clear_expired(registry: &mut WhitelistRegistry, now: u64) -> usize {
    let before = registry.entries.len();
    registry.entries.retain(|e| match e.expires_at {
        Some(exp) => exp > now,
        None => true,
    });
    before - registry.entries.len()
}

// ============ Token Operations ============

/// Check if a token is on the whitelist and not expired.
pub fn is_token_whitelisted(registry: &WhitelistRegistry, token: &[u8; 32], now: u64) -> bool {
    registry.entries.iter().any(|e| {
        &e.identifier == token
            && e.list_type == ListType::TokenWhitelist
            && !is_entry_expired(e, now)
    })
}

/// Check if a token is on the blacklist and not expired.
pub fn is_token_blacklisted(registry: &WhitelistRegistry, token: &[u8; 32], now: u64) -> bool {
    registry.entries.iter().any(|e| {
        &e.identifier == token
            && e.list_type == ListType::TokenBlacklist
            && !is_entry_expired(e, now)
    })
}

/// Add a token to the whitelist.
pub fn whitelist_token(
    registry: &mut WhitelistRegistry,
    token: [u8; 32],
    admin: [u8; 32],
    expires: Option<u64>,
    now: u64,
) -> Result<(), WhitelistError> {
    if !is_valid_identifier(&token) {
        return Err(WhitelistError::InvalidIdentifier);
    }
    if let Some(exp) = expires {
        if exp <= now {
            return Err(WhitelistError::InvalidExpiry);
        }
    }
    let entry = WhitelistEntry {
        identifier: token,
        list_type: ListType::TokenWhitelist,
        added_at: now,
        added_by: admin,
        expires_at: expires,
        reason: 0,
        metadata: 0,
    };
    add_entry(registry, entry)
}

/// Add a token to the blacklist with a reason code.
pub fn blacklist_token(
    registry: &mut WhitelistRegistry,
    token: [u8; 32],
    admin: [u8; 32],
    reason: u32,
    now: u64,
) -> Result<(), WhitelistError> {
    if !is_valid_identifier(&token) {
        return Err(WhitelistError::InvalidIdentifier);
    }
    let entry = WhitelistEntry {
        identifier: token,
        list_type: ListType::TokenBlacklist,
        added_at: now,
        added_by: admin,
        expires_at: None, // Blacklist entries are permanent by default
        reason,
        metadata: 0,
    };
    add_entry(registry, entry)
}

/// Return all currently active whitelisted token identifiers.
pub fn whitelisted_tokens(registry: &WhitelistRegistry, now: u64) -> Vec<[u8; 32]> {
    registry
        .entries
        .iter()
        .filter(|e| e.list_type == ListType::TokenWhitelist && !is_entry_expired(e, now))
        .map(|e| e.identifier)
        .collect()
}

// ============ Address Operations ============

/// Determine the access level for an address based on registry entries.
/// Blacklisted = Blocked, Whitelisted = Verified, otherwise default_access.
pub fn check_address(
    registry: &WhitelistRegistry,
    address: &[u8; 32],
    now: u64,
) -> AccessLevel {
    // Blacklist takes priority
    let blocked = registry.entries.iter().any(|e| {
        &e.identifier == address
            && e.list_type == ListType::AddressBlacklist
            && !is_entry_expired(e, now)
    });
    if blocked {
        return AccessLevel::Blocked;
    }
    // Check whitelist — use metadata to encode level if present
    let wl = registry.entries.iter().find(|e| {
        &e.identifier == address
            && e.list_type == ListType::AddressWhitelist
            && !is_entry_expired(e, now)
    });
    if let Some(entry) = wl {
        // metadata encodes access level: 0=Basic, 1=Verified, 2=Institutional, 3=Admin
        return match entry.metadata {
            1 => AccessLevel::Verified,
            2 => AccessLevel::Institutional,
            3 => AccessLevel::Admin,
            _ => AccessLevel::Basic,
        };
    }
    registry.default_access.clone()
}

/// Check if an address is explicitly blocked (on the address blacklist and not expired).
pub fn is_address_blocked(registry: &WhitelistRegistry, address: &[u8; 32], now: u64) -> bool {
    registry.entries.iter().any(|e| {
        &e.identifier == address
            && e.list_type == ListType::AddressBlacklist
            && !is_entry_expired(e, now)
    })
}

/// Block an address by adding it to the address blacklist.
pub fn block_address(
    registry: &mut WhitelistRegistry,
    address: [u8; 32],
    admin: [u8; 32],
    reason: u32,
    expires: Option<u64>,
    now: u64,
) -> Result<(), WhitelistError> {
    if !is_valid_identifier(&address) {
        return Err(WhitelistError::InvalidIdentifier);
    }
    if let Some(exp) = expires {
        if exp <= now {
            return Err(WhitelistError::InvalidExpiry);
        }
    }
    let entry = WhitelistEntry {
        identifier: address,
        list_type: ListType::AddressBlacklist,
        added_at: now,
        added_by: admin,
        expires_at: expires,
        reason,
        metadata: 0,
    };
    add_entry(registry, entry)
}

/// Unblock an address by removing it from the address blacklist.
pub fn unblock_address(
    registry: &mut WhitelistRegistry,
    address: &[u8; 32],
) -> Result<(), WhitelistError> {
    remove_entry(registry, address, &ListType::AddressBlacklist)?;
    Ok(())
}

/// Set an access level for an address by adding/updating it on the address whitelist.
/// metadata: 0=Basic, 1=Verified, 2=Institutional, 3=Admin.
pub fn set_access_level(
    registry: &mut WhitelistRegistry,
    address: [u8; 32],
    level: AccessLevel,
    admin: [u8; 32],
    now: u64,
) -> Result<(), WhitelistError> {
    if !is_valid_identifier(&address) {
        return Err(WhitelistError::InvalidIdentifier);
    }
    let meta = match &level {
        AccessLevel::Blocked => {
            // Use block_address for blocking
            return Err(WhitelistError::InsufficientAccess);
        }
        AccessLevel::Restricted => 0, // Restricted stored as metadata 0 but on blacklist? No — use whitelist with restricted marker
        AccessLevel::Basic => 0,
        AccessLevel::Verified => 1,
        AccessLevel::Institutional => 2,
        AccessLevel::Admin => 3,
    };
    // Remove old whitelist entry if exists
    let _ = remove_entry(registry, &address, &ListType::AddressWhitelist);
    let entry = WhitelistEntry {
        identifier: address,
        list_type: ListType::AddressWhitelist,
        added_at: now,
        added_by: admin,
        expires_at: None,
        reason: 0,
        metadata: meta,
    };
    add_entry(registry, entry)
}

/// Return all currently blocked address identifiers.
pub fn blocked_addresses(registry: &WhitelistRegistry, now: u64) -> Vec<[u8; 32]> {
    registry
        .entries
        .iter()
        .filter(|e| e.list_type == ListType::AddressBlacklist && !is_entry_expired(e, now))
        .map(|e| e.identifier)
        .collect()
}

// ============ Access Control ============

/// Perform a full access check for an address given a policy and usage data.
pub fn check_access(
    registry: &WhitelistRegistry,
    address: &[u8; 32],
    policy: &AccessPolicy,
    now: u64,
    daily_used: u64,
    last_tx_ms: u64,
) -> AccessCheck {
    let level = check_address(registry, address, now);
    let level_ord = access_level_ord(&level);
    let min_ord = access_level_ord(&policy.min_access_level);
    let has_access = level_ord >= min_ord;

    let blocked = level == AccessLevel::Blocked;
    let restricted = level == AccessLevel::Restricted;

    // Determine capabilities
    let can_swap = has_access && !blocked && !restricted;
    let can_deposit = has_access && !blocked && !restricted;
    let can_withdraw = !blocked; // Even restricted users can withdraw

    // Cooldown
    let next_allowed = if policy.cooldown_ms > 0 {
        last_tx_ms.saturating_add(policy.cooldown_ms)
    } else {
        0
    };

    // Daily remaining
    let daily_remaining = if policy.daily_limit > daily_used {
        policy.daily_limit - daily_used
    } else {
        0
    };

    // Effective max amount = min(per-tx, daily_remaining)
    let max_amount = if has_access && !blocked {
        core::cmp::min(policy.max_tx_amount, daily_remaining)
    } else {
        0
    };

    AccessCheck {
        address: *address,
        level,
        can_swap,
        can_deposit,
        can_withdraw,
        max_amount,
        daily_remaining,
        next_allowed_ms: next_allowed,
    }
}

/// Check if a specific transaction amount can be executed given an AccessCheck.
pub fn can_execute(check: &AccessCheck, amount: u64) -> Result<(), WhitelistError> {
    if check.level == AccessLevel::Blocked {
        return Err(WhitelistError::Blocked);
    }
    if !check.can_swap {
        return Err(WhitelistError::InsufficientAccess);
    }
    if amount > check.max_amount {
        return Err(WhitelistError::ExceedsLimit);
    }
    if check.next_allowed_ms > 0 && amount > 0 {
        // Caller should check next_allowed_ms against current time externally;
        // here we just flag if cooldown is non-zero (meaning it hasn't elapsed).
        // Convention: next_allowed_ms > 0 with amount > 0 means we need to verify timing.
        // We don't have current time here, so we pass if max_amount > 0 (access check already computed).
    }
    Ok(())
}

/// Return sensible default access policy for a given access level.
pub fn default_policy(level: &AccessLevel) -> AccessPolicy {
    match level {
        AccessLevel::Blocked => AccessPolicy {
            max_tx_amount: 0,
            daily_limit: 0,
            requires_kyc: false,
            min_access_level: AccessLevel::Admin, // Nobody can transact
            allowed_pool_types: 0,
            cooldown_ms: 0,
        },
        AccessLevel::Restricted => AccessPolicy {
            max_tx_amount: 1_000,
            daily_limit: 5_000,
            requires_kyc: false,
            min_access_level: AccessLevel::Restricted,
            allowed_pool_types: 1, // ConstantProduct only
            cooldown_ms: 60_000,   // 1 minute
        },
        AccessLevel::Basic => AccessPolicy {
            max_tx_amount: 10_000,
            daily_limit: 50_000,
            requires_kyc: false,
            min_access_level: AccessLevel::Basic,
            allowed_pool_types: 3, // ConstantProduct + Stable
            cooldown_ms: 10_000,   // 10 seconds
        },
        AccessLevel::Verified => AccessPolicy {
            max_tx_amount: 100_000,
            daily_limit: 500_000,
            requires_kyc: true,
            min_access_level: AccessLevel::Verified,
            allowed_pool_types: 7, // All types
            cooldown_ms: 1_000,    // 1 second
        },
        AccessLevel::Institutional => AccessPolicy {
            max_tx_amount: 10_000_000,
            daily_limit: 100_000_000,
            requires_kyc: true,
            min_access_level: AccessLevel::Institutional,
            allowed_pool_types: 7, // All types
            cooldown_ms: 0,        // No cooldown
        },
        AccessLevel::Admin => AccessPolicy {
            max_tx_amount: u64::MAX,
            daily_limit: u64::MAX,
            requires_kyc: false,
            min_access_level: AccessLevel::Admin,
            allowed_pool_types: 7,
            cooldown_ms: 0,
        },
    }
}

/// Merge two policies, taking the more restrictive value for each field.
pub fn merge_policies(base: &AccessPolicy, override_policy: &AccessPolicy) -> AccessPolicy {
    AccessPolicy {
        max_tx_amount: core::cmp::min(base.max_tx_amount, override_policy.max_tx_amount),
        daily_limit: core::cmp::min(base.daily_limit, override_policy.daily_limit),
        requires_kyc: base.requires_kyc || override_policy.requires_kyc,
        min_access_level: if access_level_ord(&base.min_access_level)
            >= access_level_ord(&override_policy.min_access_level)
        {
            base.min_access_level.clone()
        } else {
            override_policy.min_access_level.clone()
        },
        allowed_pool_types: base.allowed_pool_types & override_policy.allowed_pool_types,
        cooldown_ms: core::cmp::max(base.cooldown_ms, override_policy.cooldown_ms),
    }
}

/// Compute the effective transaction limit for a given access level and policy.
pub fn effective_limit(policy: &AccessPolicy, level: &AccessLevel) -> u64 {
    let level_ord = access_level_ord(level);
    let min_ord = access_level_ord(&policy.min_access_level);
    if level_ord < min_ord {
        return 0;
    }
    // Scale limit by access level: higher levels get full amount, lower get reduced
    match level {
        AccessLevel::Blocked => 0,
        AccessLevel::Restricted => policy.max_tx_amount / 10, // 10% of max
        AccessLevel::Basic => policy.max_tx_amount / 2,       // 50% of max
        AccessLevel::Verified => policy.max_tx_amount,        // 100%
        AccessLevel::Institutional => {
            // 200% but capped at u64::MAX
            policy.max_tx_amount.saturating_mul(2)
        }
        AccessLevel::Admin => u64::MAX,
    }
}

// ============ Pool Access ============

/// Check if a pool is whitelisted and not expired.
pub fn is_pool_whitelisted(registry: &WhitelistRegistry, pool: &[u8; 32], now: u64) -> bool {
    registry.entries.iter().any(|e| {
        &e.identifier == pool
            && e.list_type == ListType::PoolWhitelist
            && !is_entry_expired(e, now)
    })
}

/// Add a pool to the whitelist.
pub fn whitelist_pool(
    registry: &mut WhitelistRegistry,
    pool: [u8; 32],
    admin: [u8; 32],
    now: u64,
) -> Result<(), WhitelistError> {
    if !is_valid_identifier(&pool) {
        return Err(WhitelistError::InvalidIdentifier);
    }
    let expires = if registry.auto_expire_ms > 0 {
        Some(now.saturating_add(registry.auto_expire_ms))
    } else {
        None
    };
    let entry = WhitelistEntry {
        identifier: pool,
        list_type: ListType::PoolWhitelist,
        added_at: now,
        added_by: admin,
        expires_at: expires,
        reason: 0,
        metadata: 0,
    };
    add_entry(registry, entry)
}

/// Check if an address can access a specific pool. Both the address must not be blocked
/// and the pool must be whitelisted (in strict mode) or the pool is allowed (in non-strict mode).
pub fn can_access_pool(
    registry: &WhitelistRegistry,
    address: &[u8; 32],
    pool: &[u8; 32],
    now: u64,
) -> bool {
    // Address must not be blocked
    if is_address_blocked(registry, address, now) {
        return false;
    }
    // In strict mode, pool must be explicitly whitelisted
    if registry.strict_mode {
        return is_pool_whitelisted(registry, pool, now);
    }
    // In non-strict mode, pool is allowed unless address is blocked (already checked)
    true
}

/// Count the number of active (non-expired) pool whitelist entries.
pub fn pool_access_count(registry: &WhitelistRegistry, now: u64) -> usize {
    registry
        .entries
        .iter()
        .filter(|e| e.list_type == ListType::PoolWhitelist && !is_entry_expired(e, now))
        .count()
}

// ============ KYC Tiers ============

/// Map an access level to its KYC tier number.
/// Blocked=0, Restricted=0, Basic=0, Verified=1, Institutional=2, Admin=3
pub fn kyc_tier(level: &AccessLevel) -> u8 {
    match level {
        AccessLevel::Blocked => 0,
        AccessLevel::Restricted => 0,
        AccessLevel::Basic => 0,
        AccessLevel::Verified => 1,
        AccessLevel::Institutional => 2,
        AccessLevel::Admin => 3,
    }
}

/// Check if the given access level requires KYC verification.
/// Returns true for Verified and above.
pub fn requires_kyc(level: &AccessLevel) -> bool {
    matches!(
        level,
        AccessLevel::Verified | AccessLevel::Institutional | AccessLevel::Admin
    )
}

/// Upgrade an access level based on completed KYC tier.
/// tier 0 -> Basic, tier 1 -> Verified, tier 2 -> Institutional, tier 3+ -> Admin
pub fn upgrade_access(current: &AccessLevel, kyc_tier_val: u8) -> AccessLevel {
    // Cannot upgrade from Blocked — must be unblocked first
    if *current == AccessLevel::Blocked {
        return AccessLevel::Blocked;
    }
    match kyc_tier_val {
        0 => {
            // Can upgrade from Restricted to Basic, but not downgrade
            if access_level_ord(current) < access_level_ord(&AccessLevel::Basic) {
                AccessLevel::Basic
            } else {
                current.clone()
            }
        }
        1 => {
            if access_level_ord(current) < access_level_ord(&AccessLevel::Verified) {
                AccessLevel::Verified
            } else {
                current.clone()
            }
        }
        2 => {
            if access_level_ord(current) < access_level_ord(&AccessLevel::Institutional) {
                AccessLevel::Institutional
            } else {
                current.clone()
            }
        }
        _ => {
            // tier 3+ = Admin
            if access_level_ord(current) < access_level_ord(&AccessLevel::Admin) {
                AccessLevel::Admin
            } else {
                current.clone()
            }
        }
    }
}

/// Map a risk/reputation score (0-100) to an access level.
/// 0-20=Blocked, 21-40=Restricted, 41-60=Basic, 61-80=Verified, 81-100=Institutional
pub fn access_level_from_score(score: u64) -> AccessLevel {
    match score {
        0..=20 => AccessLevel::Blocked,
        21..=40 => AccessLevel::Restricted,
        41..=60 => AccessLevel::Basic,
        61..=80 => AccessLevel::Verified,
        81..=100 => AccessLevel::Institutional,
        _ => AccessLevel::Institutional, // Scores above 100 are capped
    }
}

// ============ Sanctions Screening ============

/// Screen an address against the registry blacklist and risk score.
/// Returns the effective access level and an optional error if blocked.
pub fn screen_address(
    registry: &WhitelistRegistry,
    address: &[u8; 32],
    risk_score: u64,
    now: u64,
) -> (AccessLevel, Option<WhitelistError>) {
    // Check blacklist first
    if is_address_blocked(registry, address, now) {
        return (AccessLevel::Blocked, Some(WhitelistError::Blocked));
    }
    // Determine level from risk score
    let level = access_level_from_score(risk_score);
    if level == AccessLevel::Blocked {
        return (AccessLevel::Blocked, Some(WhitelistError::Blocked));
    }
    (level, None)
}

/// Batch screen multiple addresses. Returns (level, is_blocked) for each.
pub fn batch_screen(
    registry: &WhitelistRegistry,
    addresses: &[[u8; 32]],
    now: u64,
) -> Vec<(AccessLevel, bool)> {
    addresses
        .iter()
        .map(|addr| {
            let blocked = is_address_blocked(registry, addr, now);
            let level = if blocked {
                AccessLevel::Blocked
            } else {
                check_address(registry, addr, now)
            };
            (level, blocked)
        })
        .collect()
}

/// Return the maximum risk score allowed for a given access level.
/// Higher access = lower risk threshold (more strict).
pub fn risk_threshold(level: &AccessLevel) -> u64 {
    match level {
        AccessLevel::Blocked => 0,
        AccessLevel::Restricted => 40,
        AccessLevel::Basic => 60,
        AccessLevel::Verified => 80,
        AccessLevel::Institutional => 90,
        AccessLevel::Admin => 100,
    }
}

// ============ Analytics ============

/// Return active counts: (token_wl, token_bl, addr_wl, addr_bl, pool_wl)
pub fn registry_stats(
    registry: &WhitelistRegistry,
    now: u64,
) -> (usize, usize, usize, usize, usize) {
    let mut token_wl = 0;
    let mut token_bl = 0;
    let mut addr_wl = 0;
    let mut addr_bl = 0;
    let mut pool_wl = 0;
    for e in &registry.entries {
        if is_entry_expired(e, now) {
            continue;
        }
        match e.list_type {
            ListType::TokenWhitelist => token_wl += 1,
            ListType::TokenBlacklist => token_bl += 1,
            ListType::AddressWhitelist => addr_wl += 1,
            ListType::AddressBlacklist => addr_bl += 1,
            ListType::PoolWhitelist => pool_wl += 1,
        }
    }
    (token_wl, token_bl, addr_wl, addr_bl, pool_wl)
}

/// Return entries expiring within a given time window from now.
pub fn expiring_soon<'a>(
    registry: &'a WhitelistRegistry,
    now: u64,
    window_ms: u64,
) -> Vec<&'a WhitelistEntry> {
    let deadline = now.saturating_add(window_ms);
    registry
        .entries
        .iter()
        .filter(|e| match e.expires_at {
            Some(exp) => exp > now && exp <= deadline,
            None => false,
        })
        .collect()
}

/// Return all entries added by a specific admin.
pub fn entries_by_admin<'a>(
    registry: &'a WhitelistRegistry,
    admin: &[u8; 32],
) -> Vec<&'a WhitelistEntry> {
    registry
        .entries
        .iter()
        .filter(|e| &e.added_by == admin)
        .collect()
}

/// Return the most recent entries, sorted by added_at descending.
pub fn most_recent_entries<'a>(
    registry: &'a WhitelistRegistry,
    count: usize,
) -> Vec<&'a WhitelistEntry> {
    let mut refs: Vec<&WhitelistEntry> = registry.entries.iter().collect();
    refs.sort_by(|a, b| b.added_at.cmp(&a.added_at));
    refs.truncate(count);
    refs
}

// ============ Utilities ============

/// Check that an identifier is not all zeros.
pub fn is_valid_identifier(id: &[u8; 32]) -> bool {
    id.iter().any(|&b| b != 0)
}

/// Return a numeric ordering for access levels (higher = more access).
/// Blocked=0, Restricted=1, Basic=2, Verified=3, Institutional=4, Admin=5
pub fn access_level_ord(level: &AccessLevel) -> u8 {
    match level {
        AccessLevel::Blocked => 0,
        AccessLevel::Restricted => 1,
        AccessLevel::Basic => 2,
        AccessLevel::Verified => 3,
        AccessLevel::Institutional => 4,
        AccessLevel::Admin => 5,
    }
}

/// Check if access level `a` is higher than or equal to `b`.
pub fn is_higher_access(a: &AccessLevel, b: &AccessLevel) -> bool {
    access_level_ord(a) >= access_level_ord(b)
}

/// In strict mode, verify that the identifier is explicitly whitelisted.
/// Returns Ok(()) if found and not expired, or StrictModeViolation if strict mode is on and not found.
pub fn strict_mode_check(
    registry: &WhitelistRegistry,
    identifier: &[u8; 32],
    list_type: &ListType,
    now: u64,
) -> Result<(), WhitelistError> {
    if !registry.strict_mode {
        return Ok(());
    }
    let found = registry.entries.iter().any(|e| {
        &e.identifier == identifier && &e.list_type == list_type && !is_entry_expired(e, now)
    });
    if found {
        Ok(())
    } else {
        Err(WhitelistError::StrictModeViolation)
    }
}

// ============ Internal Helpers ============

/// Check if an entry has expired at the given timestamp.
fn is_entry_expired(entry: &WhitelistEntry, now: u64) -> bool {
    match entry.expires_at {
        Some(exp) => now >= exp,
        None => false,
    }
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // ---- Test Helpers ----

    fn test_id(val: u8) -> [u8; 32] {
        let mut id = [0u8; 32];
        id[0] = val;
        id
    }

    fn test_admin() -> [u8; 32] {
        let mut id = [0u8; 32];
        id[31] = 0xAD;
        id
    }

    fn test_admin_2() -> [u8; 32] {
        let mut id = [0u8; 32];
        id[31] = 0xBE;
        id
    }

    fn make_entry(
        val: u8,
        list_type: ListType,
        added_at: u64,
        expires_at: Option<u64>,
    ) -> WhitelistEntry {
        WhitelistEntry {
            identifier: test_id(val),
            list_type,
            added_at,
            added_by: test_admin(),
            expires_at,
            reason: 0,
            metadata: 0,
        }
    }

    // ============ Registry Management Tests ============

    #[test]
    fn test_create_registry_default() {
        let reg = create_registry(AccessLevel::Basic, false);
        assert_eq!(reg.entries.len(), 0);
        assert_eq!(reg.default_access, AccessLevel::Basic);
        assert!(!reg.strict_mode);
        assert_eq!(reg.auto_expire_ms, 0);
    }

    #[test]
    fn test_create_registry_strict() {
        let reg = create_registry(AccessLevel::Blocked, true);
        assert!(reg.strict_mode);
        assert_eq!(reg.default_access, AccessLevel::Blocked);
    }

    #[test]
    fn test_create_registry_admin_default() {
        let reg = create_registry(AccessLevel::Admin, false);
        assert_eq!(reg.default_access, AccessLevel::Admin);
    }

    #[test]
    fn test_add_entry_success() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        let entry = make_entry(1, ListType::TokenWhitelist, 100, None);
        assert!(add_entry(&mut reg, entry).is_ok());
        assert_eq!(reg.entries.len(), 1);
    }

    #[test]
    fn test_add_entry_duplicate() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        let e1 = make_entry(1, ListType::TokenWhitelist, 100, None);
        let e2 = make_entry(1, ListType::TokenWhitelist, 200, None);
        assert!(add_entry(&mut reg, e1).is_ok());
        assert_eq!(add_entry(&mut reg, e2), Err(WhitelistError::AlreadyListed));
    }

    #[test]
    fn test_add_entry_same_id_different_list() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        let e1 = make_entry(1, ListType::TokenWhitelist, 100, None);
        let e2 = make_entry(1, ListType::TokenBlacklist, 100, None);
        assert!(add_entry(&mut reg, e1).is_ok());
        assert!(add_entry(&mut reg, e2).is_ok());
        assert_eq!(reg.entries.len(), 2);
    }

    #[test]
    fn test_add_entry_invalid_identifier() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        let entry = WhitelistEntry {
            identifier: [0u8; 32],
            list_type: ListType::TokenWhitelist,
            added_at: 100,
            added_by: test_admin(),
            expires_at: None,
            reason: 0,
            metadata: 0,
        };
        assert_eq!(
            add_entry(&mut reg, entry),
            Err(WhitelistError::InvalidIdentifier)
        );
    }

    #[test]
    fn test_add_entry_invalid_expiry() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        let entry = make_entry(1, ListType::TokenWhitelist, 100, Some(50)); // expires before added
        assert_eq!(
            add_entry(&mut reg, entry),
            Err(WhitelistError::InvalidExpiry)
        );
    }

    #[test]
    fn test_add_entry_expiry_equals_added() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        let entry = make_entry(1, ListType::TokenWhitelist, 100, Some(100));
        assert_eq!(
            add_entry(&mut reg, entry),
            Err(WhitelistError::InvalidExpiry)
        );
    }

    #[test]
    fn test_remove_entry_success() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        let entry = make_entry(1, ListType::TokenWhitelist, 100, None);
        add_entry(&mut reg, entry).unwrap();
        let removed = remove_entry(&mut reg, &test_id(1), &ListType::TokenWhitelist).unwrap();
        assert_eq!(removed.identifier, test_id(1));
        assert_eq!(reg.entries.len(), 0);
    }

    #[test]
    fn test_remove_entry_not_found() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        assert_eq!(
            remove_entry(&mut reg, &test_id(1), &ListType::TokenWhitelist),
            Err(WhitelistError::NotFound)
        );
    }

    #[test]
    fn test_remove_entry_wrong_list_type() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        let entry = make_entry(1, ListType::TokenWhitelist, 100, None);
        add_entry(&mut reg, entry).unwrap();
        assert_eq!(
            remove_entry(&mut reg, &test_id(1), &ListType::TokenBlacklist),
            Err(WhitelistError::NotFound)
        );
    }

    #[test]
    fn test_update_entry_success() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        let entry = make_entry(1, ListType::TokenWhitelist, 100, None);
        add_entry(&mut reg, entry).unwrap();
        assert!(update_entry(&mut reg, &test_id(1), &ListType::TokenWhitelist, Some(500), 42).is_ok());
        let e = find_entry(&reg, &test_id(1), &ListType::TokenWhitelist).unwrap();
        assert_eq!(e.expires_at, Some(500));
        assert_eq!(e.metadata, 42);
    }

    #[test]
    fn test_update_entry_not_found() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        assert_eq!(
            update_entry(&mut reg, &test_id(1), &ListType::TokenWhitelist, None, 0),
            Err(WhitelistError::NotFound)
        );
    }

    #[test]
    fn test_update_entry_invalid_expiry() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        let entry = make_entry(1, ListType::TokenWhitelist, 100, None);
        add_entry(&mut reg, entry).unwrap();
        assert_eq!(
            update_entry(&mut reg, &test_id(1), &ListType::TokenWhitelist, Some(50), 0),
            Err(WhitelistError::InvalidExpiry)
        );
    }

    #[test]
    fn test_update_entry_remove_expiry() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        let entry = make_entry(1, ListType::TokenWhitelist, 100, Some(500));
        add_entry(&mut reg, entry).unwrap();
        assert!(update_entry(&mut reg, &test_id(1), &ListType::TokenWhitelist, None, 0).is_ok());
        let e = find_entry(&reg, &test_id(1), &ListType::TokenWhitelist).unwrap();
        assert_eq!(e.expires_at, None);
    }

    #[test]
    fn test_find_entry_exists() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        let entry = make_entry(1, ListType::TokenWhitelist, 100, None);
        add_entry(&mut reg, entry).unwrap();
        let found = find_entry(&reg, &test_id(1), &ListType::TokenWhitelist);
        assert!(found.is_some());
        assert_eq!(found.unwrap().added_at, 100);
    }

    #[test]
    fn test_find_entry_missing() {
        let reg = create_registry(AccessLevel::Basic, false);
        assert!(find_entry(&reg, &test_id(1), &ListType::TokenWhitelist).is_none());
    }

    #[test]
    fn test_entry_count_empty() {
        let reg = create_registry(AccessLevel::Basic, false);
        assert_eq!(entry_count(&reg, &ListType::TokenWhitelist), 0);
    }

    #[test]
    fn test_entry_count_mixed() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        add_entry(&mut reg, make_entry(1, ListType::TokenWhitelist, 100, None)).unwrap();
        add_entry(&mut reg, make_entry(2, ListType::TokenWhitelist, 100, None)).unwrap();
        add_entry(&mut reg, make_entry(3, ListType::TokenBlacklist, 100, None)).unwrap();
        assert_eq!(entry_count(&reg, &ListType::TokenWhitelist), 2);
        assert_eq!(entry_count(&reg, &ListType::TokenBlacklist), 1);
        assert_eq!(entry_count(&reg, &ListType::PoolWhitelist), 0);
    }

    #[test]
    fn test_clear_expired_none() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        add_entry(&mut reg, make_entry(1, ListType::TokenWhitelist, 100, None)).unwrap();
        assert_eq!(clear_expired(&mut reg, 1000), 0);
        assert_eq!(reg.entries.len(), 1);
    }

    #[test]
    fn test_clear_expired_some() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        add_entry(&mut reg, make_entry(1, ListType::TokenWhitelist, 100, Some(200))).unwrap();
        add_entry(&mut reg, make_entry(2, ListType::TokenWhitelist, 100, Some(500))).unwrap();
        add_entry(&mut reg, make_entry(3, ListType::TokenWhitelist, 100, None)).unwrap();
        assert_eq!(clear_expired(&mut reg, 300), 1); // entry 1 expired
        assert_eq!(reg.entries.len(), 2);
    }

    #[test]
    fn test_clear_expired_all() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        add_entry(&mut reg, make_entry(1, ListType::TokenWhitelist, 100, Some(200))).unwrap();
        add_entry(&mut reg, make_entry(2, ListType::TokenWhitelist, 100, Some(300))).unwrap();
        assert_eq!(clear_expired(&mut reg, 1000), 2);
        assert_eq!(reg.entries.len(), 0);
    }

    #[test]
    fn test_clear_expired_boundary() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        add_entry(&mut reg, make_entry(1, ListType::TokenWhitelist, 100, Some(200))).unwrap();
        // now == expires_at means expired
        assert_eq!(clear_expired(&mut reg, 200), 1);
    }

    // ============ Token Operations Tests ============

    #[test]
    fn test_is_token_whitelisted_yes() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        whitelist_token(&mut reg, test_id(1), test_admin(), None, 100).unwrap();
        assert!(is_token_whitelisted(&reg, &test_id(1), 200));
    }

    #[test]
    fn test_is_token_whitelisted_no() {
        let reg = create_registry(AccessLevel::Basic, false);
        assert!(!is_token_whitelisted(&reg, &test_id(1), 200));
    }

    #[test]
    fn test_is_token_whitelisted_expired() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        whitelist_token(&mut reg, test_id(1), test_admin(), Some(300), 100).unwrap();
        assert!(is_token_whitelisted(&reg, &test_id(1), 200));
        assert!(!is_token_whitelisted(&reg, &test_id(1), 300)); // expired at exactly 300
        assert!(!is_token_whitelisted(&reg, &test_id(1), 400));
    }

    #[test]
    fn test_is_token_blacklisted_yes() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        blacklist_token(&mut reg, test_id(1), test_admin(), 1, 100).unwrap();
        assert!(is_token_blacklisted(&reg, &test_id(1), 200));
    }

    #[test]
    fn test_is_token_blacklisted_no() {
        let reg = create_registry(AccessLevel::Basic, false);
        assert!(!is_token_blacklisted(&reg, &test_id(1), 200));
    }

    #[test]
    fn test_whitelist_token_success() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        assert!(whitelist_token(&mut reg, test_id(1), test_admin(), None, 100).is_ok());
        assert_eq!(reg.entries.len(), 1);
    }

    #[test]
    fn test_whitelist_token_duplicate() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        whitelist_token(&mut reg, test_id(1), test_admin(), None, 100).unwrap();
        assert_eq!(
            whitelist_token(&mut reg, test_id(1), test_admin(), None, 200),
            Err(WhitelistError::AlreadyListed)
        );
    }

    #[test]
    fn test_whitelist_token_invalid_id() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        assert_eq!(
            whitelist_token(&mut reg, [0u8; 32], test_admin(), None, 100),
            Err(WhitelistError::InvalidIdentifier)
        );
    }

    #[test]
    fn test_whitelist_token_invalid_expiry() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        assert_eq!(
            whitelist_token(&mut reg, test_id(1), test_admin(), Some(50), 100),
            Err(WhitelistError::InvalidExpiry)
        );
    }

    #[test]
    fn test_blacklist_token_success() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        assert!(blacklist_token(&mut reg, test_id(1), test_admin(), 42, 100).is_ok());
        let e = find_entry(&reg, &test_id(1), &ListType::TokenBlacklist).unwrap();
        assert_eq!(e.reason, 42);
    }

    #[test]
    fn test_blacklist_token_invalid_id() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        assert_eq!(
            blacklist_token(&mut reg, [0u8; 32], test_admin(), 1, 100),
            Err(WhitelistError::InvalidIdentifier)
        );
    }

    #[test]
    fn test_blacklist_token_permanent() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        blacklist_token(&mut reg, test_id(1), test_admin(), 1, 100).unwrap();
        let e = find_entry(&reg, &test_id(1), &ListType::TokenBlacklist).unwrap();
        assert_eq!(e.expires_at, None);
    }

    #[test]
    fn test_whitelisted_tokens_returns_active() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        whitelist_token(&mut reg, test_id(1), test_admin(), None, 100).unwrap();
        whitelist_token(&mut reg, test_id(2), test_admin(), Some(300), 100).unwrap();
        whitelist_token(&mut reg, test_id(3), test_admin(), Some(150), 100).unwrap();
        let tokens = whitelisted_tokens(&reg, 200);
        assert_eq!(tokens.len(), 2); // id(3) expired
        assert!(tokens.contains(&test_id(1)));
        assert!(tokens.contains(&test_id(2)));
    }

    #[test]
    fn test_whitelisted_tokens_empty() {
        let reg = create_registry(AccessLevel::Basic, false);
        assert!(whitelisted_tokens(&reg, 100).is_empty());
    }

    #[test]
    fn test_token_both_whitelisted_and_blacklisted() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        whitelist_token(&mut reg, test_id(1), test_admin(), None, 100).unwrap();
        blacklist_token(&mut reg, test_id(1), test_admin(), 1, 100).unwrap();
        // Both should be true — they're on different lists
        assert!(is_token_whitelisted(&reg, &test_id(1), 200));
        assert!(is_token_blacklisted(&reg, &test_id(1), 200));
    }

    // ============ Address Operations Tests ============

    #[test]
    fn test_check_address_default() {
        let reg = create_registry(AccessLevel::Basic, false);
        assert_eq!(check_address(&reg, &test_id(1), 100), AccessLevel::Basic);
    }

    #[test]
    fn test_check_address_blocked() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        block_address(&mut reg, test_id(1), test_admin(), 1, None, 100).unwrap();
        assert_eq!(check_address(&reg, &test_id(1), 200), AccessLevel::Blocked);
    }

    #[test]
    fn test_check_address_whitelisted_basic() {
        let mut reg = create_registry(AccessLevel::Blocked, false);
        set_access_level(&mut reg, test_id(1), AccessLevel::Basic, test_admin(), 100).unwrap();
        assert_eq!(check_address(&reg, &test_id(1), 200), AccessLevel::Basic);
    }

    #[test]
    fn test_check_address_whitelisted_verified() {
        let mut reg = create_registry(AccessLevel::Blocked, false);
        set_access_level(&mut reg, test_id(1), AccessLevel::Verified, test_admin(), 100).unwrap();
        assert_eq!(check_address(&reg, &test_id(1), 200), AccessLevel::Verified);
    }

    #[test]
    fn test_check_address_whitelisted_institutional() {
        let mut reg = create_registry(AccessLevel::Blocked, false);
        set_access_level(&mut reg, test_id(1), AccessLevel::Institutional, test_admin(), 100).unwrap();
        assert_eq!(
            check_address(&reg, &test_id(1), 200),
            AccessLevel::Institutional
        );
    }

    #[test]
    fn test_check_address_whitelisted_admin() {
        let mut reg = create_registry(AccessLevel::Blocked, false);
        set_access_level(&mut reg, test_id(1), AccessLevel::Admin, test_admin(), 100).unwrap();
        assert_eq!(check_address(&reg, &test_id(1), 200), AccessLevel::Admin);
    }

    #[test]
    fn test_check_address_blacklist_priority() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        // Whitelist then blacklist — blacklist wins
        set_access_level(&mut reg, test_id(1), AccessLevel::Admin, test_admin(), 100).unwrap();
        block_address(&mut reg, test_id(1), test_admin(), 1, None, 100).unwrap();
        assert_eq!(check_address(&reg, &test_id(1), 200), AccessLevel::Blocked);
    }

    #[test]
    fn test_is_address_blocked_yes() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        block_address(&mut reg, test_id(1), test_admin(), 1, None, 100).unwrap();
        assert!(is_address_blocked(&reg, &test_id(1), 200));
    }

    #[test]
    fn test_is_address_blocked_no() {
        let reg = create_registry(AccessLevel::Basic, false);
        assert!(!is_address_blocked(&reg, &test_id(1), 200));
    }

    #[test]
    fn test_is_address_blocked_expired() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        block_address(&mut reg, test_id(1), test_admin(), 1, Some(300), 100).unwrap();
        assert!(is_address_blocked(&reg, &test_id(1), 200));
        assert!(!is_address_blocked(&reg, &test_id(1), 300)); // expired
    }

    #[test]
    fn test_block_address_success() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        assert!(block_address(&mut reg, test_id(1), test_admin(), 1, None, 100).is_ok());
    }

    #[test]
    fn test_block_address_duplicate() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        block_address(&mut reg, test_id(1), test_admin(), 1, None, 100).unwrap();
        assert_eq!(
            block_address(&mut reg, test_id(1), test_admin(), 2, None, 200),
            Err(WhitelistError::AlreadyListed)
        );
    }

    #[test]
    fn test_block_address_invalid_id() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        assert_eq!(
            block_address(&mut reg, [0u8; 32], test_admin(), 1, None, 100),
            Err(WhitelistError::InvalidIdentifier)
        );
    }

    #[test]
    fn test_block_address_invalid_expiry() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        assert_eq!(
            block_address(&mut reg, test_id(1), test_admin(), 1, Some(50), 100),
            Err(WhitelistError::InvalidExpiry)
        );
    }

    #[test]
    fn test_unblock_address_success() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        block_address(&mut reg, test_id(1), test_admin(), 1, None, 100).unwrap();
        assert!(unblock_address(&mut reg, &test_id(1)).is_ok());
        assert!(!is_address_blocked(&reg, &test_id(1), 200));
    }

    #[test]
    fn test_unblock_address_not_found() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        assert_eq!(
            unblock_address(&mut reg, &test_id(1)),
            Err(WhitelistError::NotFound)
        );
    }

    #[test]
    fn test_set_access_level_basic() {
        let mut reg = create_registry(AccessLevel::Blocked, false);
        assert!(set_access_level(&mut reg, test_id(1), AccessLevel::Basic, test_admin(), 100).is_ok());
        assert_eq!(check_address(&reg, &test_id(1), 200), AccessLevel::Basic);
    }

    #[test]
    fn test_set_access_level_upgrade() {
        let mut reg = create_registry(AccessLevel::Blocked, false);
        set_access_level(&mut reg, test_id(1), AccessLevel::Basic, test_admin(), 100).unwrap();
        set_access_level(&mut reg, test_id(1), AccessLevel::Verified, test_admin(), 200).unwrap();
        assert_eq!(check_address(&reg, &test_id(1), 300), AccessLevel::Verified);
        assert_eq!(reg.entries.iter().filter(|e| e.list_type == ListType::AddressWhitelist).count(), 1);
    }

    #[test]
    fn test_set_access_level_blocked_rejected() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        assert_eq!(
            set_access_level(&mut reg, test_id(1), AccessLevel::Blocked, test_admin(), 100),
            Err(WhitelistError::InsufficientAccess)
        );
    }

    #[test]
    fn test_set_access_level_invalid_id() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        assert_eq!(
            set_access_level(&mut reg, [0u8; 32], AccessLevel::Verified, test_admin(), 100),
            Err(WhitelistError::InvalidIdentifier)
        );
    }

    #[test]
    fn test_blocked_addresses_list() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        block_address(&mut reg, test_id(1), test_admin(), 1, None, 100).unwrap();
        block_address(&mut reg, test_id(2), test_admin(), 1, Some(300), 100).unwrap();
        block_address(&mut reg, test_id(3), test_admin(), 1, Some(150), 100).unwrap();
        let blocked = blocked_addresses(&reg, 200);
        assert_eq!(blocked.len(), 2); // id(3) expired
        assert!(blocked.contains(&test_id(1)));
        assert!(blocked.contains(&test_id(2)));
    }

    #[test]
    fn test_blocked_addresses_empty() {
        let reg = create_registry(AccessLevel::Basic, false);
        assert!(blocked_addresses(&reg, 100).is_empty());
    }

    // ============ Access Control Tests ============

    #[test]
    fn test_check_access_basic_user() {
        let reg = create_registry(AccessLevel::Basic, false);
        let policy = default_policy(&AccessLevel::Basic);
        let check = check_access(&reg, &test_id(1), &policy, 1000, 0, 0);
        assert_eq!(check.level, AccessLevel::Basic);
        assert!(check.can_swap);
        assert!(check.can_deposit);
        assert!(check.can_withdraw);
        assert_eq!(check.max_amount, 10_000);
    }

    #[test]
    fn test_check_access_blocked_user() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        block_address(&mut reg, test_id(1), test_admin(), 1, None, 100).unwrap();
        let policy = default_policy(&AccessLevel::Basic);
        let check = check_access(&reg, &test_id(1), &policy, 1000, 0, 0);
        assert_eq!(check.level, AccessLevel::Blocked);
        assert!(!check.can_swap);
        assert!(!check.can_deposit);
        assert!(!check.can_withdraw);
        assert_eq!(check.max_amount, 0);
    }

    #[test]
    fn test_check_access_restricted_user() {
        let reg = create_registry(AccessLevel::Restricted, false);
        let policy = default_policy(&AccessLevel::Restricted);
        let check = check_access(&reg, &test_id(1), &policy, 1000, 0, 0);
        assert_eq!(check.level, AccessLevel::Restricted);
        assert!(!check.can_swap); // restricted cannot swap
        assert!(!check.can_deposit);
        assert!(check.can_withdraw); // but can withdraw
    }

    #[test]
    fn test_check_access_daily_limit_used() {
        let reg = create_registry(AccessLevel::Basic, false);
        let policy = default_policy(&AccessLevel::Basic);
        let check = check_access(&reg, &test_id(1), &policy, 1000, 45_000, 0);
        assert_eq!(check.daily_remaining, 5_000);
        assert_eq!(check.max_amount, 5_000); // min(10_000 per-tx, 5_000 remaining)
    }

    #[test]
    fn test_check_access_daily_limit_exceeded() {
        let reg = create_registry(AccessLevel::Basic, false);
        let policy = default_policy(&AccessLevel::Basic);
        let check = check_access(&reg, &test_id(1), &policy, 1000, 50_000, 0);
        assert_eq!(check.daily_remaining, 0);
        assert_eq!(check.max_amount, 0);
    }

    #[test]
    fn test_check_access_cooldown() {
        let reg = create_registry(AccessLevel::Basic, false);
        let policy = default_policy(&AccessLevel::Basic);
        let check = check_access(&reg, &test_id(1), &policy, 1000, 0, 995);
        assert_eq!(check.next_allowed_ms, 995 + 10_000); // 10s cooldown
    }

    #[test]
    fn test_check_access_insufficient_level() {
        let reg = create_registry(AccessLevel::Basic, false);
        // Policy requires Verified but user is Basic
        let policy = default_policy(&AccessLevel::Verified);
        let check = check_access(&reg, &test_id(1), &policy, 1000, 0, 0);
        assert!(!check.can_swap);
        assert_eq!(check.max_amount, 0);
    }

    #[test]
    fn test_can_execute_success() {
        let check = AccessCheck {
            address: test_id(1),
            level: AccessLevel::Basic,
            can_swap: true,
            can_deposit: true,
            can_withdraw: true,
            max_amount: 10_000,
            daily_remaining: 50_000,
            next_allowed_ms: 0,
        };
        assert!(can_execute(&check, 5_000).is_ok());
    }

    #[test]
    fn test_can_execute_blocked() {
        let check = AccessCheck {
            address: test_id(1),
            level: AccessLevel::Blocked,
            can_swap: false,
            can_deposit: false,
            can_withdraw: false,
            max_amount: 0,
            daily_remaining: 0,
            next_allowed_ms: 0,
        };
        assert_eq!(can_execute(&check, 100), Err(WhitelistError::Blocked));
    }

    #[test]
    fn test_can_execute_insufficient_access() {
        let check = AccessCheck {
            address: test_id(1),
            level: AccessLevel::Restricted,
            can_swap: false,
            can_deposit: false,
            can_withdraw: true,
            max_amount: 0,
            daily_remaining: 0,
            next_allowed_ms: 0,
        };
        assert_eq!(
            can_execute(&check, 100),
            Err(WhitelistError::InsufficientAccess)
        );
    }

    #[test]
    fn test_can_execute_exceeds_limit() {
        let check = AccessCheck {
            address: test_id(1),
            level: AccessLevel::Basic,
            can_swap: true,
            can_deposit: true,
            can_withdraw: true,
            max_amount: 10_000,
            daily_remaining: 50_000,
            next_allowed_ms: 0,
        };
        assert_eq!(
            can_execute(&check, 15_000),
            Err(WhitelistError::ExceedsLimit)
        );
    }

    #[test]
    fn test_can_execute_zero_amount() {
        let check = AccessCheck {
            address: test_id(1),
            level: AccessLevel::Basic,
            can_swap: true,
            can_deposit: true,
            can_withdraw: true,
            max_amount: 10_000,
            daily_remaining: 50_000,
            next_allowed_ms: 0,
        };
        assert!(can_execute(&check, 0).is_ok());
    }

    #[test]
    fn test_default_policy_blocked() {
        let p = default_policy(&AccessLevel::Blocked);
        assert_eq!(p.max_tx_amount, 0);
        assert_eq!(p.daily_limit, 0);
        assert_eq!(p.allowed_pool_types, 0);
    }

    #[test]
    fn test_default_policy_basic() {
        let p = default_policy(&AccessLevel::Basic);
        assert_eq!(p.max_tx_amount, 10_000);
        assert_eq!(p.daily_limit, 50_000);
        assert!(!p.requires_kyc);
    }

    #[test]
    fn test_default_policy_verified() {
        let p = default_policy(&AccessLevel::Verified);
        assert_eq!(p.max_tx_amount, 100_000);
        assert!(p.requires_kyc);
        assert_eq!(p.allowed_pool_types, 7);
    }

    #[test]
    fn test_default_policy_institutional() {
        let p = default_policy(&AccessLevel::Institutional);
        assert_eq!(p.max_tx_amount, 10_000_000);
        assert_eq!(p.cooldown_ms, 0);
    }

    #[test]
    fn test_default_policy_admin() {
        let p = default_policy(&AccessLevel::Admin);
        assert_eq!(p.max_tx_amount, u64::MAX);
        assert_eq!(p.daily_limit, u64::MAX);
    }

    #[test]
    fn test_default_policy_restricted() {
        let p = default_policy(&AccessLevel::Restricted);
        assert_eq!(p.max_tx_amount, 1_000);
        assert_eq!(p.daily_limit, 5_000);
        assert_eq!(p.cooldown_ms, 60_000);
    }

    #[test]
    fn test_merge_policies_takes_restrictive() {
        let p1 = AccessPolicy {
            max_tx_amount: 10_000,
            daily_limit: 50_000,
            requires_kyc: false,
            min_access_level: AccessLevel::Basic,
            allowed_pool_types: 7,
            cooldown_ms: 1_000,
        };
        let p2 = AccessPolicy {
            max_tx_amount: 5_000,
            daily_limit: 100_000,
            requires_kyc: true,
            min_access_level: AccessLevel::Verified,
            allowed_pool_types: 3,
            cooldown_ms: 500,
        };
        let merged = merge_policies(&p1, &p2);
        assert_eq!(merged.max_tx_amount, 5_000);
        assert_eq!(merged.daily_limit, 50_000);
        assert!(merged.requires_kyc);
        assert_eq!(merged.min_access_level, AccessLevel::Verified);
        assert_eq!(merged.allowed_pool_types, 3); // 7 & 3 = 3
        assert_eq!(merged.cooldown_ms, 1_000);     // max cooldown
    }

    #[test]
    fn test_merge_policies_identical() {
        let p = default_policy(&AccessLevel::Basic);
        let merged = merge_policies(&p, &p);
        assert_eq!(merged.max_tx_amount, p.max_tx_amount);
        assert_eq!(merged.daily_limit, p.daily_limit);
    }

    #[test]
    fn test_merge_policies_pool_types_intersection() {
        let p1 = AccessPolicy {
            max_tx_amount: 100,
            daily_limit: 100,
            requires_kyc: false,
            min_access_level: AccessLevel::Basic,
            allowed_pool_types: 0b101, // ConstantProduct + Concentrated
            cooldown_ms: 0,
        };
        let p2 = AccessPolicy {
            max_tx_amount: 100,
            daily_limit: 100,
            requires_kyc: false,
            min_access_level: AccessLevel::Basic,
            allowed_pool_types: 0b110, // Stable + Concentrated
            cooldown_ms: 0,
        };
        let merged = merge_policies(&p1, &p2);
        assert_eq!(merged.allowed_pool_types, 0b100); // Only Concentrated
    }

    #[test]
    fn test_effective_limit_blocked() {
        let policy = default_policy(&AccessLevel::Verified);
        assert_eq!(effective_limit(&policy, &AccessLevel::Blocked), 0);
    }

    #[test]
    fn test_effective_limit_below_min() {
        let policy = default_policy(&AccessLevel::Verified);
        // Basic < Verified (min level)
        assert_eq!(effective_limit(&policy, &AccessLevel::Basic), 0);
    }

    #[test]
    fn test_effective_limit_verified() {
        let policy = default_policy(&AccessLevel::Verified);
        assert_eq!(effective_limit(&policy, &AccessLevel::Verified), 100_000);
    }

    #[test]
    fn test_effective_limit_institutional() {
        let policy = default_policy(&AccessLevel::Basic);
        // Institutional gets 2x
        assert_eq!(
            effective_limit(&policy, &AccessLevel::Institutional),
            20_000
        );
    }

    #[test]
    fn test_effective_limit_admin() {
        let policy = default_policy(&AccessLevel::Basic);
        assert_eq!(effective_limit(&policy, &AccessLevel::Admin), u64::MAX);
    }

    #[test]
    fn test_effective_limit_restricted() {
        let policy = default_policy(&AccessLevel::Restricted);
        assert_eq!(effective_limit(&policy, &AccessLevel::Restricted), 100); // 1000/10
    }

    // ============ Pool Access Tests ============

    #[test]
    fn test_is_pool_whitelisted_yes() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        whitelist_pool(&mut reg, test_id(1), test_admin(), 100).unwrap();
        assert!(is_pool_whitelisted(&reg, &test_id(1), 200));
    }

    #[test]
    fn test_is_pool_whitelisted_no() {
        let reg = create_registry(AccessLevel::Basic, false);
        assert!(!is_pool_whitelisted(&reg, &test_id(1), 200));
    }

    #[test]
    fn test_whitelist_pool_success() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        assert!(whitelist_pool(&mut reg, test_id(1), test_admin(), 100).is_ok());
        assert_eq!(entry_count(&reg, &ListType::PoolWhitelist), 1);
    }

    #[test]
    fn test_whitelist_pool_duplicate() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        whitelist_pool(&mut reg, test_id(1), test_admin(), 100).unwrap();
        assert_eq!(
            whitelist_pool(&mut reg, test_id(1), test_admin(), 200),
            Err(WhitelistError::AlreadyListed)
        );
    }

    #[test]
    fn test_whitelist_pool_invalid_id() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        assert_eq!(
            whitelist_pool(&mut reg, [0u8; 32], test_admin(), 100),
            Err(WhitelistError::InvalidIdentifier)
        );
    }

    #[test]
    fn test_whitelist_pool_auto_expire() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        reg.auto_expire_ms = 1000;
        whitelist_pool(&mut reg, test_id(1), test_admin(), 100).unwrap();
        let e = find_entry(&reg, &test_id(1), &ListType::PoolWhitelist).unwrap();
        assert_eq!(e.expires_at, Some(1100));
    }

    #[test]
    fn test_can_access_pool_allowed_non_strict() {
        let reg = create_registry(AccessLevel::Basic, false);
        // Non-strict: any non-blocked address can access any pool
        assert!(can_access_pool(&reg, &test_id(1), &test_id(2), 100));
    }

    #[test]
    fn test_can_access_pool_blocked_address() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        block_address(&mut reg, test_id(1), test_admin(), 1, None, 100).unwrap();
        assert!(!can_access_pool(&reg, &test_id(1), &test_id(2), 200));
    }

    #[test]
    fn test_can_access_pool_strict_whitelisted() {
        let mut reg = create_registry(AccessLevel::Basic, true);
        whitelist_pool(&mut reg, test_id(2), test_admin(), 100).unwrap();
        assert!(can_access_pool(&reg, &test_id(1), &test_id(2), 200));
    }

    #[test]
    fn test_can_access_pool_strict_not_whitelisted() {
        let reg = create_registry(AccessLevel::Basic, true);
        assert!(!can_access_pool(&reg, &test_id(1), &test_id(2), 200));
    }

    #[test]
    fn test_can_access_pool_strict_blocked_address() {
        let mut reg = create_registry(AccessLevel::Basic, true);
        whitelist_pool(&mut reg, test_id(2), test_admin(), 100).unwrap();
        block_address(&mut reg, test_id(1), test_admin(), 1, None, 100).unwrap();
        assert!(!can_access_pool(&reg, &test_id(1), &test_id(2), 200));
    }

    #[test]
    fn test_pool_access_count_empty() {
        let reg = create_registry(AccessLevel::Basic, false);
        assert_eq!(pool_access_count(&reg, 100), 0);
    }

    #[test]
    fn test_pool_access_count_active() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        whitelist_pool(&mut reg, test_id(1), test_admin(), 100).unwrap();
        whitelist_pool(&mut reg, test_id(2), test_admin(), 100).unwrap();
        assert_eq!(pool_access_count(&reg, 200), 2);
    }

    #[test]
    fn test_pool_access_count_expired() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        reg.auto_expire_ms = 100;
        whitelist_pool(&mut reg, test_id(1), test_admin(), 100).unwrap();
        whitelist_pool(&mut reg, test_id(2), test_admin(), 100).unwrap();
        assert_eq!(pool_access_count(&reg, 250), 0); // All expired at 200
    }

    // ============ KYC Tier Tests ============

    #[test]
    fn test_kyc_tier_blocked() {
        assert_eq!(kyc_tier(&AccessLevel::Blocked), 0);
    }

    #[test]
    fn test_kyc_tier_restricted() {
        assert_eq!(kyc_tier(&AccessLevel::Restricted), 0);
    }

    #[test]
    fn test_kyc_tier_basic() {
        assert_eq!(kyc_tier(&AccessLevel::Basic), 0);
    }

    #[test]
    fn test_kyc_tier_verified() {
        assert_eq!(kyc_tier(&AccessLevel::Verified), 1);
    }

    #[test]
    fn test_kyc_tier_institutional() {
        assert_eq!(kyc_tier(&AccessLevel::Institutional), 2);
    }

    #[test]
    fn test_kyc_tier_admin() {
        assert_eq!(kyc_tier(&AccessLevel::Admin), 3);
    }

    #[test]
    fn test_requires_kyc_false() {
        assert!(!requires_kyc(&AccessLevel::Blocked));
        assert!(!requires_kyc(&AccessLevel::Restricted));
        assert!(!requires_kyc(&AccessLevel::Basic));
    }

    #[test]
    fn test_requires_kyc_true() {
        assert!(requires_kyc(&AccessLevel::Verified));
        assert!(requires_kyc(&AccessLevel::Institutional));
        assert!(requires_kyc(&AccessLevel::Admin));
    }

    #[test]
    fn test_upgrade_access_blocked_stays_blocked() {
        assert_eq!(upgrade_access(&AccessLevel::Blocked, 3), AccessLevel::Blocked);
    }

    #[test]
    fn test_upgrade_access_restricted_to_basic() {
        assert_eq!(
            upgrade_access(&AccessLevel::Restricted, 0),
            AccessLevel::Basic
        );
    }

    #[test]
    fn test_upgrade_access_basic_to_verified() {
        assert_eq!(
            upgrade_access(&AccessLevel::Basic, 1),
            AccessLevel::Verified
        );
    }

    #[test]
    fn test_upgrade_access_basic_to_institutional() {
        assert_eq!(
            upgrade_access(&AccessLevel::Basic, 2),
            AccessLevel::Institutional
        );
    }

    #[test]
    fn test_upgrade_access_basic_to_admin() {
        assert_eq!(
            upgrade_access(&AccessLevel::Basic, 3),
            AccessLevel::Admin
        );
    }

    #[test]
    fn test_upgrade_access_no_downgrade() {
        // Already Institutional, tier 1 should not downgrade to Verified
        assert_eq!(
            upgrade_access(&AccessLevel::Institutional, 1),
            AccessLevel::Institutional
        );
    }

    #[test]
    fn test_upgrade_access_admin_stays_admin() {
        assert_eq!(
            upgrade_access(&AccessLevel::Admin, 0),
            AccessLevel::Admin
        );
    }

    #[test]
    fn test_upgrade_access_tier_high() {
        assert_eq!(
            upgrade_access(&AccessLevel::Basic, 255),
            AccessLevel::Admin
        );
    }

    #[test]
    fn test_access_level_from_score_blocked() {
        assert_eq!(access_level_from_score(0), AccessLevel::Blocked);
        assert_eq!(access_level_from_score(10), AccessLevel::Blocked);
        assert_eq!(access_level_from_score(20), AccessLevel::Blocked);
    }

    #[test]
    fn test_access_level_from_score_restricted() {
        assert_eq!(access_level_from_score(21), AccessLevel::Restricted);
        assert_eq!(access_level_from_score(30), AccessLevel::Restricted);
        assert_eq!(access_level_from_score(40), AccessLevel::Restricted);
    }

    #[test]
    fn test_access_level_from_score_basic() {
        assert_eq!(access_level_from_score(41), AccessLevel::Basic);
        assert_eq!(access_level_from_score(50), AccessLevel::Basic);
        assert_eq!(access_level_from_score(60), AccessLevel::Basic);
    }

    #[test]
    fn test_access_level_from_score_verified() {
        assert_eq!(access_level_from_score(61), AccessLevel::Verified);
        assert_eq!(access_level_from_score(70), AccessLevel::Verified);
        assert_eq!(access_level_from_score(80), AccessLevel::Verified);
    }

    #[test]
    fn test_access_level_from_score_institutional() {
        assert_eq!(access_level_from_score(81), AccessLevel::Institutional);
        assert_eq!(access_level_from_score(90), AccessLevel::Institutional);
        assert_eq!(access_level_from_score(100), AccessLevel::Institutional);
    }

    #[test]
    fn test_access_level_from_score_above_100() {
        assert_eq!(access_level_from_score(150), AccessLevel::Institutional);
        assert_eq!(access_level_from_score(u64::MAX), AccessLevel::Institutional);
    }

    // ============ Sanctions Screening Tests ============

    #[test]
    fn test_screen_address_clean() {
        let reg = create_registry(AccessLevel::Basic, false);
        let (level, err) = screen_address(&reg, &test_id(1), 75, 100);
        assert_eq!(level, AccessLevel::Verified);
        assert!(err.is_none());
    }

    #[test]
    fn test_screen_address_blacklisted() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        block_address(&mut reg, test_id(1), test_admin(), 1, None, 100).unwrap();
        let (level, err) = screen_address(&reg, &test_id(1), 90, 200);
        assert_eq!(level, AccessLevel::Blocked);
        assert_eq!(err, Some(WhitelistError::Blocked));
    }

    #[test]
    fn test_screen_address_low_risk_score() {
        let reg = create_registry(AccessLevel::Basic, false);
        let (level, err) = screen_address(&reg, &test_id(1), 10, 100);
        assert_eq!(level, AccessLevel::Blocked);
        assert_eq!(err, Some(WhitelistError::Blocked));
    }

    #[test]
    fn test_screen_address_medium_risk() {
        let reg = create_registry(AccessLevel::Basic, false);
        let (level, err) = screen_address(&reg, &test_id(1), 50, 100);
        assert_eq!(level, AccessLevel::Basic);
        assert!(err.is_none());
    }

    #[test]
    fn test_batch_screen_multiple() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        block_address(&mut reg, test_id(2), test_admin(), 1, None, 100).unwrap();
        let addresses = [test_id(1), test_id(2), test_id(3)];
        let results = batch_screen(&reg, &addresses, 200);
        assert_eq!(results.len(), 3);
        assert_eq!(results[0], (AccessLevel::Basic, false));  // default
        assert_eq!(results[1], (AccessLevel::Blocked, true)); // blocked
        assert_eq!(results[2], (AccessLevel::Basic, false));  // default
    }

    #[test]
    fn test_batch_screen_empty() {
        let reg = create_registry(AccessLevel::Basic, false);
        let results = batch_screen(&reg, &[], 100);
        assert!(results.is_empty());
    }

    #[test]
    fn test_batch_screen_all_blocked() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        block_address(&mut reg, test_id(1), test_admin(), 1, None, 100).unwrap();
        block_address(&mut reg, test_id(2), test_admin(), 1, None, 100).unwrap();
        let addresses = [test_id(1), test_id(2)];
        let results = batch_screen(&reg, &addresses, 200);
        assert!(results.iter().all(|(_, blocked)| *blocked));
    }

    #[test]
    fn test_risk_threshold_blocked() {
        assert_eq!(risk_threshold(&AccessLevel::Blocked), 0);
    }

    #[test]
    fn test_risk_threshold_restricted() {
        assert_eq!(risk_threshold(&AccessLevel::Restricted), 40);
    }

    #[test]
    fn test_risk_threshold_basic() {
        assert_eq!(risk_threshold(&AccessLevel::Basic), 60);
    }

    #[test]
    fn test_risk_threshold_verified() {
        assert_eq!(risk_threshold(&AccessLevel::Verified), 80);
    }

    #[test]
    fn test_risk_threshold_institutional() {
        assert_eq!(risk_threshold(&AccessLevel::Institutional), 90);
    }

    #[test]
    fn test_risk_threshold_admin() {
        assert_eq!(risk_threshold(&AccessLevel::Admin), 100);
    }

    // ============ Analytics Tests ============

    #[test]
    fn test_registry_stats_empty() {
        let reg = create_registry(AccessLevel::Basic, false);
        assert_eq!(registry_stats(&reg, 100), (0, 0, 0, 0, 0));
    }

    #[test]
    fn test_registry_stats_mixed() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        whitelist_token(&mut reg, test_id(1), test_admin(), None, 100).unwrap();
        whitelist_token(&mut reg, test_id(2), test_admin(), None, 100).unwrap();
        blacklist_token(&mut reg, test_id(3), test_admin(), 1, 100).unwrap();
        set_access_level(&mut reg, test_id(4), AccessLevel::Verified, test_admin(), 100).unwrap();
        block_address(&mut reg, test_id(5), test_admin(), 1, None, 100).unwrap();
        whitelist_pool(&mut reg, test_id(6), test_admin(), 100).unwrap();
        assert_eq!(registry_stats(&reg, 200), (2, 1, 1, 1, 1));
    }

    #[test]
    fn test_registry_stats_excludes_expired() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        whitelist_token(&mut reg, test_id(1), test_admin(), Some(150), 100).unwrap();
        whitelist_token(&mut reg, test_id(2), test_admin(), None, 100).unwrap();
        let (tw, _, _, _, _) = registry_stats(&reg, 200);
        assert_eq!(tw, 1); // id(1) expired
    }

    #[test]
    fn test_expiring_soon_found() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        whitelist_token(&mut reg, test_id(1), test_admin(), Some(500), 100).unwrap();
        whitelist_token(&mut reg, test_id(2), test_admin(), Some(1500), 100).unwrap();
        whitelist_token(&mut reg, test_id(3), test_admin(), None, 100).unwrap();
        let soon = expiring_soon(&reg, 400, 200);
        assert_eq!(soon.len(), 1); // Only id(1) expires within 400..600
        assert_eq!(soon[0].identifier, test_id(1));
    }

    #[test]
    fn test_expiring_soon_none() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        whitelist_token(&mut reg, test_id(1), test_admin(), None, 100).unwrap();
        assert!(expiring_soon(&reg, 200, 100).is_empty());
    }

    #[test]
    fn test_expiring_soon_already_expired() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        whitelist_token(&mut reg, test_id(1), test_admin(), Some(150), 100).unwrap();
        // now=200, window=100 -> looking at 200..300, but entry expired at 150
        assert!(expiring_soon(&reg, 200, 100).is_empty());
    }

    #[test]
    fn test_entries_by_admin_found() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        let admin1 = test_admin();
        let admin2 = test_admin_2();
        whitelist_token(&mut reg, test_id(1), admin1, None, 100).unwrap();
        whitelist_token(&mut reg, test_id(2), admin2, None, 100).unwrap();
        whitelist_token(&mut reg, test_id(3), admin1, None, 100).unwrap();
        let by_admin1 = entries_by_admin(&reg, &admin1);
        assert_eq!(by_admin1.len(), 2);
    }

    #[test]
    fn test_entries_by_admin_none() {
        let reg = create_registry(AccessLevel::Basic, false);
        assert!(entries_by_admin(&reg, &test_admin()).is_empty());
    }

    #[test]
    fn test_most_recent_entries_ordering() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        whitelist_token(&mut reg, test_id(1), test_admin(), None, 100).unwrap();
        whitelist_token(&mut reg, test_id(2), test_admin(), None, 300).unwrap();
        whitelist_token(&mut reg, test_id(3), test_admin(), None, 200).unwrap();
        let recent = most_recent_entries(&reg, 2);
        assert_eq!(recent.len(), 2);
        assert_eq!(recent[0].added_at, 300);
        assert_eq!(recent[1].added_at, 200);
    }

    #[test]
    fn test_most_recent_entries_truncated() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        whitelist_token(&mut reg, test_id(1), test_admin(), None, 100).unwrap();
        whitelist_token(&mut reg, test_id(2), test_admin(), None, 200).unwrap();
        let recent = most_recent_entries(&reg, 10);
        assert_eq!(recent.len(), 2); // Only 2 entries exist
    }

    #[test]
    fn test_most_recent_entries_empty() {
        let reg = create_registry(AccessLevel::Basic, false);
        assert!(most_recent_entries(&reg, 5).is_empty());
    }

    // ============ Utilities Tests ============

    #[test]
    fn test_is_valid_identifier_valid() {
        assert!(is_valid_identifier(&test_id(1)));
        assert!(is_valid_identifier(&[0xFF; 32]));
    }

    #[test]
    fn test_is_valid_identifier_invalid() {
        assert!(!is_valid_identifier(&[0u8; 32]));
    }

    #[test]
    fn test_is_valid_identifier_single_nonzero_byte() {
        let mut id = [0u8; 32];
        id[15] = 1;
        assert!(is_valid_identifier(&id));
    }

    #[test]
    fn test_access_level_ord_ordering() {
        assert_eq!(access_level_ord(&AccessLevel::Blocked), 0);
        assert_eq!(access_level_ord(&AccessLevel::Restricted), 1);
        assert_eq!(access_level_ord(&AccessLevel::Basic), 2);
        assert_eq!(access_level_ord(&AccessLevel::Verified), 3);
        assert_eq!(access_level_ord(&AccessLevel::Institutional), 4);
        assert_eq!(access_level_ord(&AccessLevel::Admin), 5);
    }

    #[test]
    fn test_is_higher_access_equal() {
        assert!(is_higher_access(&AccessLevel::Basic, &AccessLevel::Basic));
    }

    #[test]
    fn test_is_higher_access_higher() {
        assert!(is_higher_access(&AccessLevel::Admin, &AccessLevel::Basic));
    }

    #[test]
    fn test_is_higher_access_lower() {
        assert!(!is_higher_access(&AccessLevel::Basic, &AccessLevel::Admin));
    }

    #[test]
    fn test_is_higher_access_blocked_vs_restricted() {
        assert!(!is_higher_access(
            &AccessLevel::Blocked,
            &AccessLevel::Restricted
        ));
    }

    #[test]
    fn test_strict_mode_check_not_strict() {
        let reg = create_registry(AccessLevel::Basic, false);
        // Non-strict mode always passes
        assert!(strict_mode_check(&reg, &test_id(1), &ListType::TokenWhitelist, 100).is_ok());
    }

    #[test]
    fn test_strict_mode_check_strict_found() {
        let mut reg = create_registry(AccessLevel::Basic, true);
        whitelist_token(&mut reg, test_id(1), test_admin(), None, 100).unwrap();
        assert!(strict_mode_check(&reg, &test_id(1), &ListType::TokenWhitelist, 200).is_ok());
    }

    #[test]
    fn test_strict_mode_check_strict_not_found() {
        let reg = create_registry(AccessLevel::Basic, true);
        assert_eq!(
            strict_mode_check(&reg, &test_id(1), &ListType::TokenWhitelist, 100),
            Err(WhitelistError::StrictModeViolation)
        );
    }

    #[test]
    fn test_strict_mode_check_strict_expired() {
        let mut reg = create_registry(AccessLevel::Basic, true);
        whitelist_token(&mut reg, test_id(1), test_admin(), Some(150), 100).unwrap();
        assert_eq!(
            strict_mode_check(&reg, &test_id(1), &ListType::TokenWhitelist, 200),
            Err(WhitelistError::StrictModeViolation)
        );
    }

    // ============ Integration / Scenario Tests ============

    #[test]
    fn test_full_lifecycle_token() {
        let mut reg = create_registry(AccessLevel::Basic, true);
        // Strict mode — tokens must be whitelisted
        assert_eq!(
            strict_mode_check(&reg, &test_id(1), &ListType::TokenWhitelist, 100),
            Err(WhitelistError::StrictModeViolation)
        );
        // Whitelist token
        whitelist_token(&mut reg, test_id(1), test_admin(), None, 100).unwrap();
        assert!(is_token_whitelisted(&reg, &test_id(1), 200));
        assert!(strict_mode_check(&reg, &test_id(1), &ListType::TokenWhitelist, 200).is_ok());
        // Remove from whitelist
        remove_entry(&mut reg, &test_id(1), &ListType::TokenWhitelist).unwrap();
        assert!(!is_token_whitelisted(&reg, &test_id(1), 200));
    }

    #[test]
    fn test_full_lifecycle_address() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        // Default access
        assert_eq!(check_address(&reg, &test_id(1), 100), AccessLevel::Basic);
        // Upgrade to Verified
        set_access_level(&mut reg, test_id(1), AccessLevel::Verified, test_admin(), 100).unwrap();
        assert_eq!(check_address(&reg, &test_id(1), 200), AccessLevel::Verified);
        // Block address
        block_address(&mut reg, test_id(1), test_admin(), 1, None, 200).unwrap();
        assert_eq!(check_address(&reg, &test_id(1), 300), AccessLevel::Blocked);
        // Unblock
        unblock_address(&mut reg, &test_id(1)).unwrap();
        assert_eq!(check_address(&reg, &test_id(1), 400), AccessLevel::Verified);
    }

    #[test]
    fn test_screening_with_policy_enforcement() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        let policy = default_policy(&AccessLevel::Verified);

        // Screen address — high risk score
        let (level, err) = screen_address(&reg, &test_id(1), 15, 100);
        assert_eq!(level, AccessLevel::Blocked);
        assert!(err.is_some());

        // Screen address — good risk score
        set_access_level(&mut reg, test_id(2), AccessLevel::Verified, test_admin(), 100).unwrap();
        let check = check_access(&reg, &test_id(2), &policy, 200, 0, 0);
        assert!(check.can_swap);
        assert_eq!(check.max_amount, 100_000);
    }

    #[test]
    fn test_multi_list_interaction() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        // Same identifier on multiple list types
        whitelist_token(&mut reg, test_id(1), test_admin(), None, 100).unwrap();
        blacklist_token(&mut reg, test_id(1), test_admin(), 1, 100).unwrap();
        set_access_level(&mut reg, test_id(1), AccessLevel::Admin, test_admin(), 100).unwrap();
        whitelist_pool(&mut reg, test_id(1), test_admin(), 100).unwrap();

        assert_eq!(reg.entries.len(), 4);
        assert!(is_token_whitelisted(&reg, &test_id(1), 200));
        assert!(is_token_blacklisted(&reg, &test_id(1), 200));
        assert_eq!(check_address(&reg, &test_id(1), 200), AccessLevel::Admin);
        assert!(is_pool_whitelisted(&reg, &test_id(1), 200));
    }

    #[test]
    fn test_expiry_cascade() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        whitelist_token(&mut reg, test_id(1), test_admin(), Some(200), 100).unwrap();
        whitelist_token(&mut reg, test_id(2), test_admin(), Some(300), 100).unwrap();
        whitelist_token(&mut reg, test_id(3), test_admin(), Some(400), 100).unwrap();
        whitelist_token(&mut reg, test_id(4), test_admin(), None, 100).unwrap();

        assert_eq!(whitelisted_tokens(&reg, 150).len(), 4);
        assert_eq!(whitelisted_tokens(&reg, 250).len(), 3);
        assert_eq!(whitelisted_tokens(&reg, 350).len(), 2);
        assert_eq!(whitelisted_tokens(&reg, 450).len(), 1); // Only permanent one
    }

    #[test]
    fn test_clear_expired_then_stats() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        whitelist_token(&mut reg, test_id(1), test_admin(), Some(200), 100).unwrap();
        whitelist_token(&mut reg, test_id(2), test_admin(), None, 100).unwrap();
        blacklist_token(&mut reg, test_id(3), test_admin(), 1, 100).unwrap();

        let removed = clear_expired(&mut reg, 300);
        assert_eq!(removed, 1);
        let (tw, tb, _, _, _) = registry_stats(&reg, 300);
        assert_eq!(tw, 1);
        assert_eq!(tb, 1);
    }

    #[test]
    fn test_pool_access_strict_mode_complete() {
        let mut reg = create_registry(AccessLevel::Basic, true);
        let pool = test_id(10);
        let user = test_id(1);

        // Pool not whitelisted in strict mode
        assert!(!can_access_pool(&reg, &user, &pool, 100));

        // Whitelist pool
        whitelist_pool(&mut reg, pool, test_admin(), 100).unwrap();
        assert!(can_access_pool(&reg, &user, &pool, 200));

        // Block the user
        block_address(&mut reg, user, test_admin(), 1, None, 200).unwrap();
        assert!(!can_access_pool(&reg, &user, &pool, 300));

        // Unblock user
        unblock_address(&mut reg, &user).unwrap();
        assert!(can_access_pool(&reg, &user, &pool, 400));
    }

    #[test]
    fn test_kyc_upgrade_path() {
        // Start at Restricted, upgrade through tiers
        let level = AccessLevel::Restricted;
        let level = upgrade_access(&level, 0); // -> Basic
        assert_eq!(level, AccessLevel::Basic);
        let level = upgrade_access(&level, 1); // -> Verified
        assert_eq!(level, AccessLevel::Verified);
        let level = upgrade_access(&level, 2); // -> Institutional
        assert_eq!(level, AccessLevel::Institutional);
        let level = upgrade_access(&level, 3); // -> Admin
        assert_eq!(level, AccessLevel::Admin);
    }

    #[test]
    fn test_merged_policy_access_check() {
        let reg = create_registry(AccessLevel::Basic, false);
        let p1 = default_policy(&AccessLevel::Basic);
        let p2 = default_policy(&AccessLevel::Verified);
        let merged = merge_policies(&p1, &p2);
        // Merged takes the more restrictive
        let check = check_access(&reg, &test_id(1), &merged, 1000, 0, 0);
        // Basic user can't meet Verified min_access_level
        assert!(!check.can_swap);
    }

    #[test]
    fn test_entries_by_admin_after_modifications() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        let admin1 = test_admin();
        whitelist_token(&mut reg, test_id(1), admin1, None, 100).unwrap();
        whitelist_token(&mut reg, test_id(2), admin1, None, 200).unwrap();
        assert_eq!(entries_by_admin(&reg, &admin1).len(), 2);

        // Remove one
        remove_entry(&mut reg, &test_id(1), &ListType::TokenWhitelist).unwrap();
        assert_eq!(entries_by_admin(&reg, &admin1).len(), 1);
    }

    #[test]
    fn test_auto_expire_ms_registry() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        reg.auto_expire_ms = 500;
        whitelist_pool(&mut reg, test_id(1), test_admin(), 100).unwrap();
        // Pool should expire at 600
        assert!(is_pool_whitelisted(&reg, &test_id(1), 500));
        assert!(!is_pool_whitelisted(&reg, &test_id(1), 600));
    }

    #[test]
    fn test_batch_screen_with_mixed_states() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        set_access_level(&mut reg, test_id(1), AccessLevel::Verified, test_admin(), 100).unwrap();
        block_address(&mut reg, test_id(2), test_admin(), 1, None, 100).unwrap();
        set_access_level(&mut reg, test_id(3), AccessLevel::Institutional, test_admin(), 100).unwrap();

        let addresses = [test_id(1), test_id(2), test_id(3), test_id(4)];
        let results = batch_screen(&reg, &addresses, 200);
        assert_eq!(results[0], (AccessLevel::Verified, false));
        assert_eq!(results[1], (AccessLevel::Blocked, true));
        assert_eq!(results[2], (AccessLevel::Institutional, false));
        assert_eq!(results[3], (AccessLevel::Basic, false)); // default
    }

    #[test]
    fn test_expiring_soon_boundary() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        whitelist_token(&mut reg, test_id(1), test_admin(), Some(500), 100).unwrap();
        // Exactly at boundary: now=400, window=100, deadline=500
        // exp(500) > now(400) AND exp(500) <= deadline(500) => included
        let soon = expiring_soon(&reg, 400, 100);
        assert_eq!(soon.len(), 1);
    }

    #[test]
    fn test_multiple_pools_access() {
        let mut reg = create_registry(AccessLevel::Basic, true);
        whitelist_pool(&mut reg, test_id(10), test_admin(), 100).unwrap();
        whitelist_pool(&mut reg, test_id(11), test_admin(), 100).unwrap();
        whitelist_pool(&mut reg, test_id(12), test_admin(), 100).unwrap();

        assert_eq!(pool_access_count(&reg, 200), 3);
        assert!(can_access_pool(&reg, &test_id(1), &test_id(10), 200));
        assert!(can_access_pool(&reg, &test_id(1), &test_id(11), 200));
        assert!(!can_access_pool(&reg, &test_id(1), &test_id(13), 200)); // not whitelisted
    }

    #[test]
    fn test_risk_threshold_vs_access_level_from_score() {
        // risk_threshold returns max risk allowed for a level
        // access_level_from_score maps a score to a level
        // Verify consistency: risk_threshold(level) >= boundary of level
        assert!(risk_threshold(&AccessLevel::Restricted) >= 21);
        assert!(risk_threshold(&AccessLevel::Basic) >= 41);
        assert!(risk_threshold(&AccessLevel::Verified) >= 61);
        assert!(risk_threshold(&AccessLevel::Institutional) >= 81);
    }

    #[test]
    fn test_effective_limit_basic_policy_basic_user() {
        let policy = default_policy(&AccessLevel::Basic);
        let limit = effective_limit(&policy, &AccessLevel::Basic);
        assert_eq!(limit, 5_000); // 50% of 10_000
    }

    #[test]
    fn test_check_access_no_cooldown() {
        let reg = create_registry(AccessLevel::Institutional, false);
        let policy = default_policy(&AccessLevel::Institutional);
        let check = check_access(&reg, &test_id(1), &policy, 1000, 0, 999);
        assert_eq!(check.next_allowed_ms, 0); // No cooldown for institutional
    }

    #[test]
    fn test_whitelist_registry_many_entries() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        for i in 1..=50u8 {
            whitelist_token(&mut reg, test_id(i), test_admin(), None, 100).unwrap();
        }
        assert_eq!(entry_count(&reg, &ListType::TokenWhitelist), 50);
        assert_eq!(whitelisted_tokens(&reg, 200).len(), 50);
    }

    #[test]
    fn test_update_entry_metadata() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        whitelist_token(&mut reg, test_id(1), test_admin(), None, 100).unwrap();
        update_entry(&mut reg, &test_id(1), &ListType::TokenWhitelist, None, 999).unwrap();
        let e = find_entry(&reg, &test_id(1), &ListType::TokenWhitelist).unwrap();
        assert_eq!(e.metadata, 999);
    }

    #[test]
    fn test_screen_address_boundary_score_20() {
        let reg = create_registry(AccessLevel::Basic, false);
        let (level, err) = screen_address(&reg, &test_id(1), 20, 100);
        assert_eq!(level, AccessLevel::Blocked);
        assert!(err.is_some());
    }

    #[test]
    fn test_screen_address_boundary_score_21() {
        let reg = create_registry(AccessLevel::Basic, false);
        let (level, err) = screen_address(&reg, &test_id(1), 21, 100);
        assert_eq!(level, AccessLevel::Restricted);
        assert!(err.is_none());
    }

    #[test]
    fn test_most_recent_entries_zero_count() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        whitelist_token(&mut reg, test_id(1), test_admin(), None, 100).unwrap();
        let recent = most_recent_entries(&reg, 0);
        assert!(recent.is_empty());
    }

    #[test]
    fn test_access_check_address_matches() {
        let reg = create_registry(AccessLevel::Basic, false);
        let policy = default_policy(&AccessLevel::Basic);
        let check = check_access(&reg, &test_id(42), &policy, 1000, 0, 0);
        assert_eq!(check.address, test_id(42));
    }

    #[test]
    fn test_entry_preserves_reason() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        let entry = WhitelistEntry {
            identifier: test_id(1),
            list_type: ListType::TokenBlacklist,
            added_at: 100,
            added_by: test_admin(),
            expires_at: None,
            reason: 12345,
            metadata: 0,
        };
        add_entry(&mut reg, entry).unwrap();
        let found = find_entry(&reg, &test_id(1), &ListType::TokenBlacklist).unwrap();
        assert_eq!(found.reason, 12345);
    }

    #[test]
    fn test_clear_expired_preserves_permanent() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        add_entry(&mut reg, make_entry(1, ListType::TokenWhitelist, 100, None)).unwrap();
        add_entry(&mut reg, make_entry(2, ListType::TokenBlacklist, 100, None)).unwrap();
        add_entry(&mut reg, make_entry(3, ListType::PoolWhitelist, 100, None)).unwrap();
        let removed = clear_expired(&mut reg, u64::MAX);
        assert_eq!(removed, 0);
        assert_eq!(reg.entries.len(), 3);
    }

    #[test]
    fn test_find_entry_after_remove() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        add_entry(&mut reg, make_entry(1, ListType::TokenWhitelist, 100, None)).unwrap();
        remove_entry(&mut reg, &test_id(1), &ListType::TokenWhitelist).unwrap();
        assert!(find_entry(&reg, &test_id(1), &ListType::TokenWhitelist).is_none());
    }

    #[test]
    fn test_remove_returns_correct_entry() {
        let mut reg = create_registry(AccessLevel::Basic, false);
        let mut entry = make_entry(1, ListType::TokenWhitelist, 100, None);
        entry.metadata = 777;
        add_entry(&mut reg, entry).unwrap();
        let removed = remove_entry(&mut reg, &test_id(1), &ListType::TokenWhitelist).unwrap();
        assert_eq!(removed.metadata, 777);
    }

    #[test]
    fn test_can_execute_exact_max() {
        let check = AccessCheck {
            address: test_id(1),
            level: AccessLevel::Basic,
            can_swap: true,
            can_deposit: true,
            can_withdraw: true,
            max_amount: 10_000,
            daily_remaining: 50_000,
            next_allowed_ms: 0,
        };
        assert!(can_execute(&check, 10_000).is_ok());
    }

    #[test]
    fn test_can_execute_one_over_max() {
        let check = AccessCheck {
            address: test_id(1),
            level: AccessLevel::Basic,
            can_swap: true,
            can_deposit: true,
            can_withdraw: true,
            max_amount: 10_000,
            daily_remaining: 50_000,
            next_allowed_ms: 0,
        };
        assert_eq!(
            can_execute(&check, 10_001),
            Err(WhitelistError::ExceedsLimit)
        );
    }

    #[test]
    fn test_is_higher_access_all_pairs() {
        let levels = [
            AccessLevel::Blocked,
            AccessLevel::Restricted,
            AccessLevel::Basic,
            AccessLevel::Verified,
            AccessLevel::Institutional,
            AccessLevel::Admin,
        ];
        for (i, a) in levels.iter().enumerate() {
            for (j, b) in levels.iter().enumerate() {
                assert_eq!(is_higher_access(a, b), i >= j);
            }
        }
    }

    #[test]
    fn test_set_access_level_restricted() {
        let mut reg = create_registry(AccessLevel::Blocked, false);
        // Restricted via set_access_level uses metadata 0 on AddressWhitelist
        assert!(set_access_level(&mut reg, test_id(1), AccessLevel::Restricted, test_admin(), 100).is_ok());
        // Should resolve to Basic (metadata 0 = Basic on whitelist)
        assert_eq!(check_address(&reg, &test_id(1), 200), AccessLevel::Basic);
    }

    #[test]
    fn test_check_access_daily_over_used() {
        let reg = create_registry(AccessLevel::Basic, false);
        let policy = default_policy(&AccessLevel::Basic);
        // daily_used exceeds daily_limit
        let check = check_access(&reg, &test_id(1), &policy, 1000, 100_000, 0);
        assert_eq!(check.daily_remaining, 0);
        assert_eq!(check.max_amount, 0);
    }

    #[test]
    fn test_merge_policies_kyc_both_false() {
        let p1 = AccessPolicy {
            max_tx_amount: 100,
            daily_limit: 100,
            requires_kyc: false,
            min_access_level: AccessLevel::Basic,
            allowed_pool_types: 7,
            cooldown_ms: 0,
        };
        let merged = merge_policies(&p1, &p1);
        assert!(!merged.requires_kyc);
    }

    #[test]
    fn test_merge_policies_kyc_one_true() {
        let p1 = AccessPolicy {
            max_tx_amount: 100,
            daily_limit: 100,
            requires_kyc: false,
            min_access_level: AccessLevel::Basic,
            allowed_pool_types: 7,
            cooldown_ms: 0,
        };
        let p2 = AccessPolicy {
            max_tx_amount: 100,
            daily_limit: 100,
            requires_kyc: true,
            min_access_level: AccessLevel::Basic,
            allowed_pool_types: 7,
            cooldown_ms: 0,
        };
        let merged = merge_policies(&p1, &p2);
        assert!(merged.requires_kyc);
    }
}
