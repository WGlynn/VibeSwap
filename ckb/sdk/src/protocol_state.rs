// ============ Protocol State — Global Protocol State Machine ============
// Manages the global state of the VibeSwap protocol: system-wide parameters,
// protocol phases, upgrade states, emergency modes, and aggregate metrics.
//
// Key capabilities:
// - Protocol phase tracking (bootstrap, growth, maturity, sunset) with transition rules
// - System parameter management with validation and bounded updates
// - Emergency mode with graduated levels (normal -> caution -> restricted -> paused -> shutdown)
// - Upgrade proposal lifecycle with compatibility checks and rollback
// - Aggregate metric tracking (TVL, volume, users, fee revenue)
// - Epoch management with boundary tracking and parameter adjustments
// - Validated state transitions with pre/post conditions
// - Periodic state snapshots for audit and diff computation
//
// All percentages are basis points (10000 = 100%). All arithmetic is u64/u128 only.

use sha2::{Digest, Sha256};

// ============ Constants ============

/// Basis points denominator (100% = 10_000 bps)
pub const BPS: u64 = 10_000;

/// Protocol phases
pub const PHASE_BOOTSTRAP: u8 = 0;
pub const PHASE_GROWTH: u8 = 1;
pub const PHASE_MATURITY: u8 = 2;
pub const PHASE_SUNSET: u8 = 3;

/// Emergency levels
pub const EMERGENCY_NORMAL: u8 = 0;
pub const EMERGENCY_CAUTION: u8 = 1;
pub const EMERGENCY_RESTRICTED: u8 = 2;
pub const EMERGENCY_PAUSED: u8 = 3;
pub const EMERGENCY_SHUTDOWN: u8 = 4;

/// Maximum fee in basis points (50%)
pub const MAX_FEE_BPS: u64 = 5000;

/// Maximum batch size
pub const MAX_BATCH_SIZE_LIMIT: u64 = 10_000;

/// Maximum leverage in bps (100x = 1_000_000 bps)
pub const MAX_LEVERAGE_LIMIT_BPS: u64 = 1_000_000;

/// Maximum oracle deviation in bps (50%)
pub const MAX_ORACLE_DEVIATION_BPS: u64 = 5000;

/// Maximum reward rate in bps (100%)
pub const MAX_REWARD_RATE_BPS: u64 = 10_000;

/// Auto-resume window: 6 hours in seconds
pub const AUTO_RESUME_WINDOW: u64 = 21_600;

/// Health score perfect
pub const HEALTH_PERFECT: u64 = 10_000;

/// Maximum protocol version
pub const MAX_VERSION: u64 = 1_000_000;

/// Default epoch length in blocks
pub const DEFAULT_EPOCH_BLOCKS: u64 = 21_600;

// ============ Data Types ============

/// Global protocol state
#[derive(Debug, Clone)]
pub struct ProtocolState {
    pub phase: u8,
    pub epoch: u64,
    pub total_tvl: u128,
    pub total_volume_24h: u128,
    pub total_users: u64,
    pub total_fee_revenue: u128,
    pub emergency_level: u8,
    pub last_updated: u64,
    pub version: u64,
}

/// System-wide parameters
#[derive(Debug, Clone)]
pub struct SystemParams {
    pub base_fee_bps: u64,
    pub max_batch_size: u64,
    pub reward_rate_bps: u64,
    pub min_stake: u64,
    pub max_leverage_bps: u64,
    pub oracle_deviation_bps: u64,
    pub circuit_breaker_volume: u128,
    pub circuit_breaker_price_bps: u64,
}

/// Phase configuration and transition criteria
#[derive(Debug, Clone)]
pub struct PhaseConfig {
    pub phase_id: u8,
    pub min_tvl: u128,
    pub min_users: u64,
    pub min_epoch: u64,
    pub max_epoch: u64,
    pub transition_rules_hash: [u8; 32],
}

/// Emergency state tracking
#[derive(Debug, Clone)]
pub struct EmergencyState {
    pub level: u8,
    pub triggered_at: u64,
    pub trigger_reason_hash: [u8; 32],
    pub auto_resume_at: u64,
    pub authorized_by: [u8; 32],
}

/// Upgrade record
#[derive(Debug, Clone)]
pub struct UpgradeRecord {
    pub from_version: u64,
    pub to_version: u64,
    pub proposed_at: u64,
    pub activated_at: u64,
    pub rollback_to: u64,
    pub compatible: bool,
}

/// Epoch information
#[derive(Debug, Clone)]
pub struct EpochInfo {
    pub epoch_number: u64,
    pub start_block: u64,
    pub end_block: u64,
    pub blocks_produced: u64,
    pub tx_count: u64,
    pub fees_collected: u128,
}

/// Point-in-time state snapshot
#[derive(Debug, Clone)]
pub struct StateSnapshot {
    pub epoch: u64,
    pub state_hash: [u8; 32],
    pub tvl: u128,
    pub volume: u128,
    pub users: u64,
    pub fees: u128,
    pub params_hash: [u8; 32],
    pub timestamp: u64,
}

/// Diff between two snapshots
#[derive(Debug, Clone)]
pub struct StateDiff {
    pub field_name_hash: [u8; 32],
    pub old_value: u128,
    pub new_value: u128,
    pub changed_at: u64,
}

// ============ Helpers ============

fn hash_u64(val: u64) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(val.to_le_bytes());
    let result = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&result);
    out
}

fn hash_bytes(data: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(data);
    let result = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&result);
    out
}

fn hash_field_name(name: &str) -> [u8; 32] {
    hash_bytes(name.as_bytes())
}

fn hash_state(state: &ProtocolState) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(state.phase.to_le_bytes());
    hasher.update(state.epoch.to_le_bytes());
    hasher.update(state.total_tvl.to_le_bytes());
    hasher.update(state.total_volume_24h.to_le_bytes());
    hasher.update(state.total_users.to_le_bytes());
    hasher.update(state.total_fee_revenue.to_le_bytes());
    hasher.update(state.emergency_level.to_le_bytes());
    hasher.update(state.last_updated.to_le_bytes());
    hasher.update(state.version.to_le_bytes());
    let result = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&result);
    out
}

fn hash_params(params: &SystemParams) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(params.base_fee_bps.to_le_bytes());
    hasher.update(params.max_batch_size.to_le_bytes());
    hasher.update(params.reward_rate_bps.to_le_bytes());
    hasher.update(params.min_stake.to_le_bytes());
    hasher.update(params.max_leverage_bps.to_le_bytes());
    hasher.update(params.oracle_deviation_bps.to_le_bytes());
    hasher.update(params.circuit_breaker_volume.to_le_bytes());
    hasher.update(params.circuit_breaker_price_bps.to_le_bytes());
    let result = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&result);
    out
}

// ============ State Creation ============

/// Create the initial protocol state at version.
pub fn create_initial_state(version: u64) -> ProtocolState {
    ProtocolState {
        phase: PHASE_BOOTSTRAP,
        epoch: 0,
        total_tvl: 0,
        total_volume_24h: 0,
        total_users: 0,
        total_fee_revenue: 0,
        emergency_level: EMERGENCY_NORMAL,
        last_updated: 0,
        version,
    }
}

// ============ Default Constructors ============

/// Return sensible default system parameters.
pub fn default_system_params() -> SystemParams {
    SystemParams {
        base_fee_bps: 30,          // 0.3%
        max_batch_size: 500,
        reward_rate_bps: 200,      // 2%
        min_stake: 1_000_000,      // 1M smallest units
        max_leverage_bps: 50_000,  // 5x
        oracle_deviation_bps: 500, // 5%
        circuit_breaker_volume: 100_000_000_000, // 100B
        circuit_breaker_price_bps: 1000, // 10%
    }
}

/// Return default phase configurations for all four phases.
pub fn default_phase_configs() -> Vec<PhaseConfig> {
    vec![
        PhaseConfig {
            phase_id: PHASE_BOOTSTRAP,
            min_tvl: 0,
            min_users: 0,
            min_epoch: 0,
            max_epoch: 100,
            transition_rules_hash: hash_bytes(b"bootstrap"),
        },
        PhaseConfig {
            phase_id: PHASE_GROWTH,
            min_tvl: 1_000_000_000,       // 1B
            min_users: 100,
            min_epoch: 10,
            max_epoch: 1000,
            transition_rules_hash: hash_bytes(b"growth"),
        },
        PhaseConfig {
            phase_id: PHASE_MATURITY,
            min_tvl: 100_000_000_000,      // 100B
            min_users: 10_000,
            min_epoch: 100,
            max_epoch: 100_000,
            transition_rules_hash: hash_bytes(b"maturity"),
        },
        PhaseConfig {
            phase_id: PHASE_SUNSET,
            min_tvl: 0,
            min_users: 0,
            min_epoch: 1000,
            max_epoch: u64::MAX,
            transition_rules_hash: hash_bytes(b"sunset"),
        },
    ]
}

// ============ Epoch Management ============

/// Advance the protocol to the next epoch, incorporating epoch info.
pub fn advance_epoch(state: &ProtocolState, epoch_info: &EpochInfo) -> Result<ProtocolState, String> {
    if epoch_info.epoch_number != state.epoch + 1 {
        return Err(format!(
            "epoch mismatch: expected {} got {}",
            state.epoch + 1,
            epoch_info.epoch_number
        ));
    }
    if epoch_info.end_block <= epoch_info.start_block {
        return Err("epoch end_block must exceed start_block".to_string());
    }
    if epoch_info.blocks_produced == 0 {
        return Err("epoch must have at least one block".to_string());
    }
    let new_revenue = state
        .total_fee_revenue
        .checked_add(epoch_info.fees_collected)
        .ok_or_else(|| "fee revenue overflow".to_string())?;
    Ok(ProtocolState {
        epoch: epoch_info.epoch_number,
        total_fee_revenue: new_revenue,
        last_updated: epoch_info.end_block,
        ..state.clone()
    })
}

/// Summarize a slice of epoch infos: (total_blocks, total_tx, total_fees).
pub fn get_epoch_summary(epoch_infos: &[EpochInfo]) -> (u64, u64, u64) {
    let mut total_blocks: u64 = 0;
    let mut total_tx: u64 = 0;
    let mut total_fees: u64 = 0;
    for info in epoch_infos {
        total_blocks = total_blocks.saturating_add(info.blocks_produced);
        total_tx = total_tx.saturating_add(info.tx_count);
        // Truncate fees to u64 for summary
        let fee_u64 = if info.fees_collected > u64::MAX as u128 {
            u64::MAX
        } else {
            info.fees_collected as u64
        };
        total_fees = total_fees.saturating_add(fee_u64);
    }
    (total_blocks, total_tx, total_fees)
}

// ============ Phase Transitions ============

/// Check if a phase transition is warranted. Returns Some(new_phase) or None.
pub fn check_phase_transition(state: &ProtocolState, configs: &[PhaseConfig]) -> Option<u8> {
    if state.phase >= PHASE_SUNSET {
        return None; // no transition past sunset
    }
    let next_phase = state.phase + 1;
    let config = configs.iter().find(|c| c.phase_id == next_phase)?;
    if state.total_tvl >= config.min_tvl
        && state.total_users >= config.min_users
        && state.epoch >= config.min_epoch
    {
        Some(next_phase)
    } else {
        None
    }
}

/// Transition to a new phase with validation.
pub fn transition_phase(
    state: &ProtocolState,
    new_phase: u8,
    configs: &[PhaseConfig],
) -> Result<ProtocolState, String> {
    if new_phase > PHASE_SUNSET {
        return Err(format!("invalid phase: {}", new_phase));
    }
    if new_phase != state.phase + 1 {
        return Err(format!(
            "can only advance one phase at a time: {} -> {}",
            state.phase, new_phase
        ));
    }
    let config = configs
        .iter()
        .find(|c| c.phase_id == new_phase)
        .ok_or_else(|| format!("no config for phase {}", new_phase))?;
    if state.total_tvl < config.min_tvl {
        return Err(format!(
            "TVL {} below minimum {} for phase {}",
            state.total_tvl, config.min_tvl, new_phase
        ));
    }
    if state.total_users < config.min_users {
        return Err(format!(
            "users {} below minimum {} for phase {}",
            state.total_users, config.min_users, new_phase
        ));
    }
    if state.epoch < config.min_epoch {
        return Err(format!(
            "epoch {} below minimum {} for phase {}",
            state.epoch, config.min_epoch, new_phase
        ));
    }
    Ok(ProtocolState {
        phase: new_phase,
        ..state.clone()
    })
}

/// Estimate progress toward the next phase in bps (0-10000).
pub fn estimate_phase_progress(state: &ProtocolState, configs: &[PhaseConfig]) -> u64 {
    if state.phase >= PHASE_SUNSET {
        return BPS; // already at final phase
    }
    let next_phase = state.phase + 1;
    let config = match configs.iter().find(|c| c.phase_id == next_phase) {
        Some(c) => c,
        None => return 0,
    };

    // Average of three criteria progress, each capped at 10000
    let tvl_progress = if config.min_tvl == 0 {
        BPS
    } else {
        let tvl_u64 = if state.total_tvl > u64::MAX as u128 {
            u64::MAX
        } else {
            state.total_tvl as u64
        };
        let min_tvl_u64 = if config.min_tvl > u64::MAX as u128 {
            u64::MAX
        } else {
            config.min_tvl as u64
        };
        if min_tvl_u64 == 0 {
            BPS
        } else {
            (tvl_u64.min(min_tvl_u64) as u128 * BPS as u128 / min_tvl_u64 as u128) as u64
        }
    };

    let user_progress = if config.min_users == 0 {
        BPS
    } else {
        state.total_users.min(config.min_users) * BPS / config.min_users
    };

    let epoch_progress = if config.min_epoch == 0 {
        BPS
    } else {
        state.epoch.min(config.min_epoch) * BPS / config.min_epoch
    };

    (tvl_progress + user_progress + epoch_progress) / 3
}

// ============ System Parameters ============

/// Validate that system parameters are within acceptable bounds.
pub fn validate_params(params: &SystemParams) -> Result<bool, String> {
    if params.base_fee_bps > MAX_FEE_BPS {
        return Err(format!("base_fee_bps {} exceeds max {}", params.base_fee_bps, MAX_FEE_BPS));
    }
    if params.max_batch_size == 0 || params.max_batch_size > MAX_BATCH_SIZE_LIMIT {
        return Err(format!(
            "max_batch_size {} out of range [1, {}]",
            params.max_batch_size, MAX_BATCH_SIZE_LIMIT
        ));
    }
    if params.reward_rate_bps > MAX_REWARD_RATE_BPS {
        return Err(format!(
            "reward_rate_bps {} exceeds max {}",
            params.reward_rate_bps, MAX_REWARD_RATE_BPS
        ));
    }
    if params.max_leverage_bps > MAX_LEVERAGE_LIMIT_BPS {
        return Err(format!(
            "max_leverage_bps {} exceeds max {}",
            params.max_leverage_bps, MAX_LEVERAGE_LIMIT_BPS
        ));
    }
    if params.oracle_deviation_bps > MAX_ORACLE_DEVIATION_BPS {
        return Err(format!(
            "oracle_deviation_bps {} exceeds max {}",
            params.oracle_deviation_bps, MAX_ORACLE_DEVIATION_BPS
        ));
    }
    if params.circuit_breaker_price_bps > BPS {
        return Err(format!(
            "circuit_breaker_price_bps {} exceeds {}",
            params.circuit_breaker_price_bps, BPS
        ));
    }
    Ok(true)
}

/// Update system parameters with a partial change set. Only non-None fields are applied.
pub fn update_system_params(
    params: &SystemParams,
    base_fee_bps: Option<u64>,
    max_batch_size: Option<u64>,
    reward_rate_bps: Option<u64>,
    min_stake: Option<u64>,
    max_leverage_bps: Option<u64>,
    oracle_deviation_bps: Option<u64>,
    circuit_breaker_volume: Option<u128>,
    circuit_breaker_price_bps: Option<u64>,
) -> Result<SystemParams, String> {
    let new_params = SystemParams {
        base_fee_bps: base_fee_bps.unwrap_or(params.base_fee_bps),
        max_batch_size: max_batch_size.unwrap_or(params.max_batch_size),
        reward_rate_bps: reward_rate_bps.unwrap_or(params.reward_rate_bps),
        min_stake: min_stake.unwrap_or(params.min_stake),
        max_leverage_bps: max_leverage_bps.unwrap_or(params.max_leverage_bps),
        oracle_deviation_bps: oracle_deviation_bps.unwrap_or(params.oracle_deviation_bps),
        circuit_breaker_volume: circuit_breaker_volume.unwrap_or(params.circuit_breaker_volume),
        circuit_breaker_price_bps: circuit_breaker_price_bps
            .unwrap_or(params.circuit_breaker_price_bps),
    };
    validate_params(&new_params)?;
    Ok(new_params)
}

// ============ Emergency Mode ============

/// Set emergency level with authorization.
pub fn set_emergency_level(
    state: &ProtocolState,
    level: u8,
    reason_hash: [u8; 32],
    authorized_by: [u8; 32],
    current_time: u64,
) -> Result<EmergencyState, String> {
    if level > EMERGENCY_SHUTDOWN {
        return Err(format!("invalid emergency level: {}", level));
    }
    if level == state.emergency_level {
        return Err("already at requested emergency level".to_string());
    }
    // Can always de-escalate, but escalation by more than 1 level requires shutdown justification
    if level > state.emergency_level + 2 && level != EMERGENCY_SHUTDOWN {
        return Err("cannot escalate more than 2 levels at once unless shutdown".to_string());
    }
    let auto_resume = if level <= EMERGENCY_CAUTION {
        0 // no auto-resume for normal/caution
    } else {
        current_time + AUTO_RESUME_WINDOW
    };
    Ok(EmergencyState {
        level,
        triggered_at: current_time,
        trigger_reason_hash: reason_hash,
        auto_resume_at: auto_resume,
        authorized_by,
    })
}

/// Check if auto-resume time has been reached.
pub fn check_auto_resume(emergency: &EmergencyState, current_time: u64) -> bool {
    if emergency.level == EMERGENCY_NORMAL {
        return false; // already normal
    }
    if emergency.level == EMERGENCY_SHUTDOWN {
        return false; // shutdown never auto-resumes
    }
    if emergency.auto_resume_at == 0 {
        return false;
    }
    current_time >= emergency.auto_resume_at
}

/// Auto-detect dangerous conditions and return suggested emergency level, or None.
pub fn auto_trigger_emergency(state: &ProtocolState, params: &SystemParams) -> Option<u8> {
    // Check volume against circuit breaker
    if state.total_volume_24h > params.circuit_breaker_volume {
        let ratio = state.total_volume_24h / params.circuit_breaker_volume;
        if ratio >= 10 {
            return Some(EMERGENCY_PAUSED);
        } else if ratio >= 5 {
            return Some(EMERGENCY_RESTRICTED);
        } else {
            return Some(EMERGENCY_CAUTION);
        }
    }
    None
}

/// Check if trading is currently allowed given state and emergency.
pub fn is_trading_allowed(state: &ProtocolState, emergency: &EmergencyState) -> bool {
    if emergency.level >= EMERGENCY_PAUSED {
        return false;
    }
    if state.phase == PHASE_SUNSET {
        return false; // sunset phase = no new trades
    }
    true
}

// ============ Upgrade Management ============

/// Create a new upgrade proposal.
pub fn propose_upgrade(from_version: u64, to_version: u64, current_time: u64) -> UpgradeRecord {
    UpgradeRecord {
        from_version,
        to_version,
        proposed_at: current_time,
        activated_at: 0,
        rollback_to: from_version,
        compatible: check_compatibility(from_version, to_version),
    }
}

/// Check if two versions are compatible (same major version = compatible).
/// Major version = version / 10000.
pub fn check_compatibility(current_version: u64, target_version: u64) -> bool {
    if target_version <= current_version {
        return false; // downgrade is not compatible
    }
    let current_major = current_version / 10_000;
    let target_major = target_version / 10_000;
    current_major == target_major
}

/// Activate a proposed upgrade.
pub fn activate_upgrade(
    record: &UpgradeRecord,
    current_time: u64,
) -> Result<UpgradeRecord, String> {
    if record.activated_at != 0 {
        return Err("upgrade already activated".to_string());
    }
    if current_time <= record.proposed_at {
        return Err("activation time must be after proposal time".to_string());
    }
    Ok(UpgradeRecord {
        activated_at: current_time,
        ..record.clone()
    })
}

/// Roll back an activated upgrade.
pub fn rollback_upgrade(
    record: &UpgradeRecord,
    state: &ProtocolState,
) -> Result<ProtocolState, String> {
    if record.activated_at == 0 {
        return Err("cannot rollback: upgrade not activated".to_string());
    }
    if state.version != record.to_version {
        return Err(format!(
            "state version {} does not match upgrade to_version {}",
            state.version, record.to_version
        ));
    }
    Ok(ProtocolState {
        version: record.rollback_to,
        ..state.clone()
    })
}

/// Check if an upgrade is pending (proposed but not activated).
pub fn is_upgrade_pending(record: &UpgradeRecord) -> bool {
    record.activated_at == 0
}

// ============ Aggregate Metrics ============

/// Update TVL in the protocol state.
pub fn update_tvl(state: &ProtocolState, new_tvl: u128) -> ProtocolState {
    ProtocolState {
        total_tvl: new_tvl,
        ..state.clone()
    }
}

/// Add volume to the 24h counter.
pub fn update_volume(state: &ProtocolState, additional_volume: u128) -> ProtocolState {
    ProtocolState {
        total_volume_24h: state.total_volume_24h.saturating_add(additional_volume),
        ..state.clone()
    }
}

/// Update the total user count.
pub fn update_user_count(state: &ProtocolState, new_count: u64) -> ProtocolState {
    ProtocolState {
        total_users: new_count,
        ..state.clone()
    }
}

/// Accumulate fee revenue.
pub fn accumulate_fees(state: &ProtocolState, fee_amount: u128) -> ProtocolState {
    ProtocolState {
        total_fee_revenue: state.total_fee_revenue.saturating_add(fee_amount),
        ..state.clone()
    }
}

// ============ State Snapshots ============

/// Take a snapshot of the current state and params.
pub fn take_snapshot(state: &ProtocolState, params: &SystemParams) -> StateSnapshot {
    StateSnapshot {
        epoch: state.epoch,
        state_hash: hash_state(state),
        tvl: state.total_tvl,
        volume: state.total_volume_24h,
        users: state.total_users,
        fees: state.total_fee_revenue,
        params_hash: hash_params(params),
        timestamp: state.last_updated,
    }
}

/// Compute the diffs between two snapshots.
pub fn compute_diff(snapshot_a: &StateSnapshot, snapshot_b: &StateSnapshot) -> Vec<StateDiff> {
    let mut diffs = Vec::new();
    let ts = snapshot_b.timestamp;

    if snapshot_a.tvl != snapshot_b.tvl {
        diffs.push(StateDiff {
            field_name_hash: hash_field_name("tvl"),
            old_value: snapshot_a.tvl,
            new_value: snapshot_b.tvl,
            changed_at: ts,
        });
    }
    if snapshot_a.volume != snapshot_b.volume {
        diffs.push(StateDiff {
            field_name_hash: hash_field_name("volume"),
            old_value: snapshot_a.volume,
            new_value: snapshot_b.volume,
            changed_at: ts,
        });
    }
    if snapshot_a.users != snapshot_b.users {
        diffs.push(StateDiff {
            field_name_hash: hash_field_name("users"),
            old_value: snapshot_a.users as u128,
            new_value: snapshot_b.users as u128,
            changed_at: ts,
        });
    }
    if snapshot_a.fees != snapshot_b.fees {
        diffs.push(StateDiff {
            field_name_hash: hash_field_name("fees"),
            old_value: snapshot_a.fees,
            new_value: snapshot_b.fees,
            changed_at: ts,
        });
    }
    if snapshot_a.epoch != snapshot_b.epoch {
        diffs.push(StateDiff {
            field_name_hash: hash_field_name("epoch"),
            old_value: snapshot_a.epoch as u128,
            new_value: snapshot_b.epoch as u128,
            changed_at: ts,
        });
    }
    if snapshot_a.params_hash != snapshot_b.params_hash {
        diffs.push(StateDiff {
            field_name_hash: hash_field_name("params_hash"),
            old_value: 0, // hash changed, values are hashes not scalars
            new_value: 1,
            changed_at: ts,
        });
    }
    if snapshot_a.state_hash != snapshot_b.state_hash {
        diffs.push(StateDiff {
            field_name_hash: hash_field_name("state_hash"),
            old_value: 0,
            new_value: 1,
            changed_at: ts,
        });
    }
    diffs
}

// ============ Integrity & Health ============

/// Verify internal consistency of protocol state and params.
pub fn verify_state_integrity(
    state: &ProtocolState,
    params: &SystemParams,
) -> Result<bool, String> {
    if state.phase > PHASE_SUNSET {
        return Err(format!("invalid phase: {}", state.phase));
    }
    if state.emergency_level > EMERGENCY_SHUTDOWN {
        return Err(format!("invalid emergency level: {}", state.emergency_level));
    }
    if state.version == 0 {
        return Err("version must be non-zero".to_string());
    }
    validate_params(params)?;
    Ok(true)
}

/// Calculate a composite health score for the protocol (0-10000 bps).
/// Factors: TVL (30%), volume activity (20%), user count (20%), low emergency (30%).
pub fn calculate_protocol_health_score(state: &ProtocolState, params: &SystemParams) -> u64 {
    // TVL component (30%): ratio of TVL to circuit breaker volume (a proxy for "healthy" TVL)
    let tvl_target = params.circuit_breaker_volume;
    let tvl_score = if tvl_target == 0 {
        3000u64
    } else {
        let ratio = if state.total_tvl >= tvl_target {
            3000u64
        } else {
            (state.total_tvl as u64).min(tvl_target as u64) * 3000 / tvl_target as u64
        };
        ratio
    };

    // Volume component (20%): any volume at all is good
    let volume_score: u64 = if state.total_volume_24h > 0 {
        let vol_ratio = if state.total_volume_24h >= tvl_target {
            2000
        } else {
            (state.total_volume_24h as u64).min(tvl_target as u64) * 2000
                / (tvl_target as u64).max(1)
        };
        vol_ratio
    } else {
        0
    };

    // User component (20%): target 1000 users for full score
    let user_target: u64 = 1000;
    let user_score = state.total_users.min(user_target) * 2000 / user_target;

    // Emergency component (30%): lower emergency = higher score
    let emergency_score: u64 = match state.emergency_level {
        0 => 3000,
        1 => 2250,
        2 => 1500,
        3 => 750,
        _ => 0,
    };

    tvl_score + volume_score + user_score + emergency_score
}

/// Calculate fee growth rate between two snapshots in basis points.
/// Positive = growth, negative = decline.
pub fn calculate_fee_growth_rate(snapshots: &[StateSnapshot]) -> i64 {
    if snapshots.len() < 2 {
        return 0;
    }
    let first = &snapshots[0];
    let last = &snapshots[snapshots.len() - 1];
    if first.fees == 0 {
        if last.fees > 0 {
            return BPS as i64; // 100% growth from zero
        }
        return 0;
    }
    let growth = if last.fees >= first.fees {
        let diff = last.fees - first.fees;
        (diff * BPS as u128 / first.fees) as i64
    } else {
        let diff = first.fees - last.fees;
        -((diff * BPS as u128 / first.fees) as i64)
    };
    growth
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // ============ Test Helpers ============

    fn make_state() -> ProtocolState {
        create_initial_state(1)
    }

    fn make_state_v(version: u64) -> ProtocolState {
        create_initial_state(version)
    }

    fn make_params() -> SystemParams {
        default_system_params()
    }

    fn make_epoch(n: u64) -> EpochInfo {
        EpochInfo {
            epoch_number: n,
            start_block: (n - 1) * DEFAULT_EPOCH_BLOCKS,
            end_block: n * DEFAULT_EPOCH_BLOCKS,
            blocks_produced: DEFAULT_EPOCH_BLOCKS,
            tx_count: 100,
            fees_collected: 1000,
        }
    }

    fn reason_hash(n: u8) -> [u8; 32] {
        let mut h = [0u8; 32];
        h[0] = n;
        h
    }

    fn auth(n: u8) -> [u8; 32] {
        let mut h = [0u8; 32];
        h[1] = n;
        h
    }

    fn populated_state() -> ProtocolState {
        ProtocolState {
            phase: PHASE_GROWTH,
            epoch: 50,
            total_tvl: 50_000_000_000,
            total_volume_24h: 1_000_000_000,
            total_users: 500,
            total_fee_revenue: 10_000_000,
            emergency_level: EMERGENCY_NORMAL,
            last_updated: 1_000_000,
            version: 1,
        }
    }

    fn make_emergency_normal() -> EmergencyState {
        EmergencyState {
            level: EMERGENCY_NORMAL,
            triggered_at: 0,
            trigger_reason_hash: [0u8; 32],
            auto_resume_at: 0,
            authorized_by: [0u8; 32],
        }
    }

    fn make_snapshot_at(epoch: u64, tvl: u128, volume: u128, users: u64, fees: u128, ts: u64) -> StateSnapshot {
        StateSnapshot {
            epoch,
            state_hash: hash_u64(epoch),
            tvl,
            volume,
            users,
            fees,
            params_hash: hash_u64(0),
            timestamp: ts,
        }
    }

    // ============ create_initial_state tests ============

    #[test]
    fn test_create_initial_state_version_1() {
        let s = create_initial_state(1);
        assert_eq!(s.version, 1);
        assert_eq!(s.phase, PHASE_BOOTSTRAP);
        assert_eq!(s.epoch, 0);
    }

    #[test]
    fn test_create_initial_state_version_large() {
        let s = create_initial_state(999_999);
        assert_eq!(s.version, 999_999);
    }

    #[test]
    fn test_create_initial_state_zero_tvl() {
        let s = make_state();
        assert_eq!(s.total_tvl, 0);
    }

    #[test]
    fn test_create_initial_state_zero_volume() {
        let s = make_state();
        assert_eq!(s.total_volume_24h, 0);
    }

    #[test]
    fn test_create_initial_state_zero_users() {
        let s = make_state();
        assert_eq!(s.total_users, 0);
    }

    #[test]
    fn test_create_initial_state_zero_fees() {
        let s = make_state();
        assert_eq!(s.total_fee_revenue, 0);
    }

    #[test]
    fn test_create_initial_state_normal_emergency() {
        let s = make_state();
        assert_eq!(s.emergency_level, EMERGENCY_NORMAL);
    }

    #[test]
    fn test_create_initial_state_last_updated_zero() {
        let s = make_state();
        assert_eq!(s.last_updated, 0);
    }

    // ============ default_system_params tests ============

    #[test]
    fn test_default_params_base_fee() {
        let p = default_system_params();
        assert_eq!(p.base_fee_bps, 30);
    }

    #[test]
    fn test_default_params_batch_size() {
        let p = default_system_params();
        assert_eq!(p.max_batch_size, 500);
    }

    #[test]
    fn test_default_params_reward_rate() {
        let p = default_system_params();
        assert_eq!(p.reward_rate_bps, 200);
    }

    #[test]
    fn test_default_params_min_stake() {
        let p = default_system_params();
        assert_eq!(p.min_stake, 1_000_000);
    }

    #[test]
    fn test_default_params_leverage() {
        let p = default_system_params();
        assert_eq!(p.max_leverage_bps, 50_000);
    }

    #[test]
    fn test_default_params_oracle_deviation() {
        let p = default_system_params();
        assert_eq!(p.oracle_deviation_bps, 500);
    }

    #[test]
    fn test_default_params_are_valid() {
        let p = default_system_params();
        assert!(validate_params(&p).is_ok());
    }

    // ============ default_phase_configs tests ============

    #[test]
    fn test_default_phase_configs_count() {
        let configs = default_phase_configs();
        assert_eq!(configs.len(), 4);
    }

    #[test]
    fn test_default_phase_configs_bootstrap() {
        let configs = default_phase_configs();
        assert_eq!(configs[0].phase_id, PHASE_BOOTSTRAP);
        assert_eq!(configs[0].min_tvl, 0);
    }

    #[test]
    fn test_default_phase_configs_growth() {
        let configs = default_phase_configs();
        assert_eq!(configs[1].phase_id, PHASE_GROWTH);
        assert!(configs[1].min_tvl > 0);
    }

    #[test]
    fn test_default_phase_configs_maturity() {
        let configs = default_phase_configs();
        assert_eq!(configs[2].phase_id, PHASE_MATURITY);
        assert!(configs[2].min_users > 0);
    }

    #[test]
    fn test_default_phase_configs_sunset() {
        let configs = default_phase_configs();
        assert_eq!(configs[3].phase_id, PHASE_SUNSET);
        assert_eq!(configs[3].max_epoch, u64::MAX);
    }

    #[test]
    fn test_default_phase_configs_ascending_tvl() {
        let configs = default_phase_configs();
        assert!(configs[1].min_tvl < configs[2].min_tvl);
    }

    // ============ validate_params tests ============

    #[test]
    fn test_validate_params_ok() {
        let p = make_params();
        assert_eq!(validate_params(&p).unwrap(), true);
    }

    #[test]
    fn test_validate_params_fee_too_high() {
        let mut p = make_params();
        p.base_fee_bps = MAX_FEE_BPS + 1;
        assert!(validate_params(&p).is_err());
    }

    #[test]
    fn test_validate_params_fee_at_max() {
        let mut p = make_params();
        p.base_fee_bps = MAX_FEE_BPS;
        assert!(validate_params(&p).is_ok());
    }

    #[test]
    fn test_validate_params_batch_zero() {
        let mut p = make_params();
        p.max_batch_size = 0;
        assert!(validate_params(&p).is_err());
    }

    #[test]
    fn test_validate_params_batch_too_large() {
        let mut p = make_params();
        p.max_batch_size = MAX_BATCH_SIZE_LIMIT + 1;
        assert!(validate_params(&p).is_err());
    }

    #[test]
    fn test_validate_params_batch_at_max() {
        let mut p = make_params();
        p.max_batch_size = MAX_BATCH_SIZE_LIMIT;
        assert!(validate_params(&p).is_ok());
    }

    #[test]
    fn test_validate_params_reward_rate_too_high() {
        let mut p = make_params();
        p.reward_rate_bps = MAX_REWARD_RATE_BPS + 1;
        assert!(validate_params(&p).is_err());
    }

    #[test]
    fn test_validate_params_leverage_too_high() {
        let mut p = make_params();
        p.max_leverage_bps = MAX_LEVERAGE_LIMIT_BPS + 1;
        assert!(validate_params(&p).is_err());
    }

    #[test]
    fn test_validate_params_oracle_deviation_too_high() {
        let mut p = make_params();
        p.oracle_deviation_bps = MAX_ORACLE_DEVIATION_BPS + 1;
        assert!(validate_params(&p).is_err());
    }

    #[test]
    fn test_validate_params_circuit_breaker_price_too_high() {
        let mut p = make_params();
        p.circuit_breaker_price_bps = BPS + 1;
        assert!(validate_params(&p).is_err());
    }

    #[test]
    fn test_validate_params_all_at_zero_min() {
        let p = SystemParams {
            base_fee_bps: 0,
            max_batch_size: 1,
            reward_rate_bps: 0,
            min_stake: 0,
            max_leverage_bps: 0,
            oracle_deviation_bps: 0,
            circuit_breaker_volume: 0,
            circuit_breaker_price_bps: 0,
        };
        assert!(validate_params(&p).is_ok());
    }

    // ============ update_system_params tests ============

    #[test]
    fn test_update_params_no_changes() {
        let p = make_params();
        let r = update_system_params(&p, None, None, None, None, None, None, None, None);
        assert!(r.is_ok());
        let new_p = r.unwrap();
        assert_eq!(new_p.base_fee_bps, p.base_fee_bps);
    }

    #[test]
    fn test_update_params_change_fee() {
        let p = make_params();
        let r = update_system_params(&p, Some(100), None, None, None, None, None, None, None);
        assert_eq!(r.unwrap().base_fee_bps, 100);
    }

    #[test]
    fn test_update_params_change_batch_size() {
        let p = make_params();
        let r = update_system_params(&p, None, Some(1000), None, None, None, None, None, None);
        assert_eq!(r.unwrap().max_batch_size, 1000);
    }

    #[test]
    fn test_update_params_change_reward_rate() {
        let p = make_params();
        let r = update_system_params(&p, None, None, Some(500), None, None, None, None, None);
        assert_eq!(r.unwrap().reward_rate_bps, 500);
    }

    #[test]
    fn test_update_params_change_min_stake() {
        let p = make_params();
        let r = update_system_params(&p, None, None, None, Some(5_000_000), None, None, None, None);
        assert_eq!(r.unwrap().min_stake, 5_000_000);
    }

    #[test]
    fn test_update_params_invalid_fee_rejected() {
        let p = make_params();
        let r = update_system_params(&p, Some(MAX_FEE_BPS + 1), None, None, None, None, None, None, None);
        assert!(r.is_err());
    }

    #[test]
    fn test_update_params_invalid_batch_rejected() {
        let p = make_params();
        let r = update_system_params(&p, None, Some(0), None, None, None, None, None, None);
        assert!(r.is_err());
    }

    #[test]
    fn test_update_params_multiple_changes() {
        let p = make_params();
        let r = update_system_params(&p, Some(50), Some(200), Some(300), None, None, None, None, None);
        let np = r.unwrap();
        assert_eq!(np.base_fee_bps, 50);
        assert_eq!(np.max_batch_size, 200);
        assert_eq!(np.reward_rate_bps, 300);
    }

    #[test]
    fn test_update_params_circuit_breaker_volume() {
        let p = make_params();
        let r = update_system_params(&p, None, None, None, None, None, None, Some(999), None);
        assert_eq!(r.unwrap().circuit_breaker_volume, 999);
    }

    #[test]
    fn test_update_params_circuit_breaker_price() {
        let p = make_params();
        let r = update_system_params(&p, None, None, None, None, None, None, None, Some(500));
        assert_eq!(r.unwrap().circuit_breaker_price_bps, 500);
    }

    // ============ advance_epoch tests ============

    #[test]
    fn test_advance_epoch_first() {
        let s = make_state();
        let e = make_epoch(1);
        let r = advance_epoch(&s, &e).unwrap();
        assert_eq!(r.epoch, 1);
    }

    #[test]
    fn test_advance_epoch_accumulates_fees() {
        let s = make_state();
        let e = make_epoch(1);
        let r = advance_epoch(&s, &e).unwrap();
        assert_eq!(r.total_fee_revenue, 1000);
    }

    #[test]
    fn test_advance_epoch_updates_last_updated() {
        let s = make_state();
        let e = make_epoch(1);
        let r = advance_epoch(&s, &e).unwrap();
        assert_eq!(r.last_updated, e.end_block);
    }

    #[test]
    fn test_advance_epoch_wrong_number() {
        let s = make_state();
        let e = make_epoch(5); // should be 1
        assert!(advance_epoch(&s, &e).is_err());
    }

    #[test]
    fn test_advance_epoch_invalid_blocks() {
        let s = make_state();
        let mut e = make_epoch(1);
        e.end_block = 0;
        e.start_block = 10;
        assert!(advance_epoch(&s, &e).is_err());
    }

    #[test]
    fn test_advance_epoch_zero_blocks_produced() {
        let s = make_state();
        let mut e = make_epoch(1);
        e.blocks_produced = 0;
        assert!(advance_epoch(&s, &e).is_err());
    }

    #[test]
    fn test_advance_epoch_preserves_tvl() {
        let mut s = make_state();
        s.total_tvl = 999;
        let e = make_epoch(1);
        let r = advance_epoch(&s, &e).unwrap();
        assert_eq!(r.total_tvl, 999);
    }

    #[test]
    fn test_advance_epoch_preserves_phase() {
        let mut s = make_state();
        s.phase = PHASE_GROWTH;
        let e = make_epoch(1);
        let r = advance_epoch(&s, &e).unwrap();
        assert_eq!(r.phase, PHASE_GROWTH);
    }

    #[test]
    fn test_advance_epoch_sequential() {
        let s = make_state();
        let e1 = make_epoch(1);
        let s2 = advance_epoch(&s, &e1).unwrap();
        let e2 = make_epoch(2);
        let s3 = advance_epoch(&s2, &e2).unwrap();
        assert_eq!(s3.epoch, 2);
        assert_eq!(s3.total_fee_revenue, 2000);
    }

    // ============ get_epoch_summary tests ============

    #[test]
    fn test_epoch_summary_empty() {
        let (b, t, f) = get_epoch_summary(&[]);
        assert_eq!((b, t, f), (0, 0, 0));
    }

    #[test]
    fn test_epoch_summary_single() {
        let e = make_epoch(1);
        let (b, t, f) = get_epoch_summary(&[e]);
        assert_eq!(b, DEFAULT_EPOCH_BLOCKS);
        assert_eq!(t, 100);
        assert_eq!(f, 1000);
    }

    #[test]
    fn test_epoch_summary_multiple() {
        let epochs: Vec<EpochInfo> = (1..=5).map(|n| make_epoch(n)).collect();
        let (b, t, f) = get_epoch_summary(&epochs);
        assert_eq!(b, DEFAULT_EPOCH_BLOCKS * 5);
        assert_eq!(t, 500);
        assert_eq!(f, 5000);
    }

    #[test]
    fn test_epoch_summary_saturates_on_overflow() {
        let e = EpochInfo {
            epoch_number: 1,
            start_block: 0,
            end_block: 100,
            blocks_produced: u64::MAX,
            tx_count: u64::MAX,
            fees_collected: u128::MAX,
        };
        let (b, t, _f) = get_epoch_summary(&[e.clone(), e]);
        assert_eq!(b, u64::MAX);
        assert_eq!(t, u64::MAX);
    }

    // ============ check_phase_transition tests ============

    #[test]
    fn test_check_phase_transition_bootstrap_to_growth() {
        let configs = default_phase_configs();
        let mut s = make_state();
        s.total_tvl = 1_000_000_000;
        s.total_users = 100;
        s.epoch = 10;
        let result = check_phase_transition(&s, &configs);
        assert_eq!(result, Some(PHASE_GROWTH));
    }

    #[test]
    fn test_check_phase_transition_not_enough_tvl() {
        let configs = default_phase_configs();
        let mut s = make_state();
        s.total_tvl = 999;
        s.total_users = 100;
        s.epoch = 10;
        assert_eq!(check_phase_transition(&s, &configs), None);
    }

    #[test]
    fn test_check_phase_transition_not_enough_users() {
        let configs = default_phase_configs();
        let mut s = make_state();
        s.total_tvl = 1_000_000_000;
        s.total_users = 1;
        s.epoch = 10;
        assert_eq!(check_phase_transition(&s, &configs), None);
    }

    #[test]
    fn test_check_phase_transition_not_enough_epochs() {
        let configs = default_phase_configs();
        let mut s = make_state();
        s.total_tvl = 1_000_000_000;
        s.total_users = 100;
        s.epoch = 1;
        assert_eq!(check_phase_transition(&s, &configs), None);
    }

    #[test]
    fn test_check_phase_transition_sunset_no_further() {
        let configs = default_phase_configs();
        let mut s = make_state();
        s.phase = PHASE_SUNSET;
        s.total_tvl = u128::MAX;
        s.total_users = u64::MAX;
        s.epoch = u64::MAX;
        assert_eq!(check_phase_transition(&s, &configs), None);
    }

    #[test]
    fn test_check_phase_transition_growth_to_maturity() {
        let configs = default_phase_configs();
        let mut s = make_state();
        s.phase = PHASE_GROWTH;
        s.total_tvl = 100_000_000_000;
        s.total_users = 10_000;
        s.epoch = 100;
        assert_eq!(check_phase_transition(&s, &configs), Some(PHASE_MATURITY));
    }

    // ============ transition_phase tests ============

    #[test]
    fn test_transition_phase_bootstrap_to_growth() {
        let configs = default_phase_configs();
        let mut s = make_state();
        s.total_tvl = 1_000_000_000;
        s.total_users = 100;
        s.epoch = 10;
        let r = transition_phase(&s, PHASE_GROWTH, &configs).unwrap();
        assert_eq!(r.phase, PHASE_GROWTH);
    }

    #[test]
    fn test_transition_phase_invalid_phase() {
        let configs = default_phase_configs();
        let s = make_state();
        assert!(transition_phase(&s, 5, &configs).is_err());
    }

    #[test]
    fn test_transition_phase_skip_not_allowed() {
        let configs = default_phase_configs();
        let s = make_state();
        assert!(transition_phase(&s, PHASE_MATURITY, &configs).is_err());
    }

    #[test]
    fn test_transition_phase_tvl_too_low() {
        let configs = default_phase_configs();
        let mut s = make_state();
        s.total_tvl = 0;
        s.total_users = 100;
        s.epoch = 10;
        assert!(transition_phase(&s, PHASE_GROWTH, &configs).is_err());
    }

    #[test]
    fn test_transition_phase_users_too_low() {
        let configs = default_phase_configs();
        let mut s = make_state();
        s.total_tvl = 1_000_000_000;
        s.total_users = 0;
        s.epoch = 10;
        assert!(transition_phase(&s, PHASE_GROWTH, &configs).is_err());
    }

    #[test]
    fn test_transition_phase_epoch_too_low() {
        let configs = default_phase_configs();
        let mut s = make_state();
        s.total_tvl = 1_000_000_000;
        s.total_users = 100;
        s.epoch = 0;
        assert!(transition_phase(&s, PHASE_GROWTH, &configs).is_err());
    }

    #[test]
    fn test_transition_phase_preserves_tvl() {
        let configs = default_phase_configs();
        let mut s = make_state();
        s.total_tvl = 1_000_000_000;
        s.total_users = 100;
        s.epoch = 10;
        let r = transition_phase(&s, PHASE_GROWTH, &configs).unwrap();
        assert_eq!(r.total_tvl, 1_000_000_000);
    }

    // ============ estimate_phase_progress tests ============

    #[test]
    fn test_phase_progress_zero_at_start() {
        let configs = default_phase_configs();
        let s = make_state();
        let progress = estimate_phase_progress(&s, &configs);
        assert_eq!(progress, 0);
    }

    #[test]
    fn test_phase_progress_full_at_sunset() {
        let configs = default_phase_configs();
        let mut s = make_state();
        s.phase = PHASE_SUNSET;
        assert_eq!(estimate_phase_progress(&s, &configs), BPS);
    }

    #[test]
    fn test_phase_progress_partial() {
        let configs = default_phase_configs();
        let mut s = make_state();
        // 50% of TVL, 50% of users, 50% of epoch for growth
        s.total_tvl = 500_000_000;
        s.total_users = 50;
        s.epoch = 5;
        let progress = estimate_phase_progress(&s, &configs);
        assert!(progress > 0 && progress < BPS);
    }

    #[test]
    fn test_phase_progress_all_criteria_met() {
        let configs = default_phase_configs();
        let mut s = make_state();
        s.total_tvl = 2_000_000_000; // exceeds growth min
        s.total_users = 200;
        s.epoch = 20;
        let progress = estimate_phase_progress(&s, &configs);
        assert_eq!(progress, BPS);
    }

    // ============ set_emergency_level tests ============

    #[test]
    fn test_set_emergency_caution() {
        let s = make_state();
        let r = set_emergency_level(&s, EMERGENCY_CAUTION, reason_hash(1), auth(1), 1000).unwrap();
        assert_eq!(r.level, EMERGENCY_CAUTION);
    }

    #[test]
    fn test_set_emergency_restricted() {
        let s = make_state();
        let r = set_emergency_level(&s, EMERGENCY_RESTRICTED, reason_hash(1), auth(1), 1000).unwrap();
        assert_eq!(r.level, EMERGENCY_RESTRICTED);
        assert!(r.auto_resume_at > 0);
    }

    #[test]
    fn test_set_emergency_paused() {
        let mut s = make_state();
        s.emergency_level = EMERGENCY_CAUTION; // must be within 2 levels
        let r = set_emergency_level(&s, EMERGENCY_PAUSED, reason_hash(1), auth(1), 1000).unwrap();
        assert_eq!(r.level, EMERGENCY_PAUSED);
    }

    #[test]
    fn test_set_emergency_shutdown() {
        let s = make_state();
        let r = set_emergency_level(&s, EMERGENCY_SHUTDOWN, reason_hash(1), auth(1), 1000).unwrap();
        assert_eq!(r.level, EMERGENCY_SHUTDOWN);
    }

    #[test]
    fn test_set_emergency_same_level_rejected() {
        let s = make_state(); // emergency_level = 0
        assert!(set_emergency_level(&s, EMERGENCY_NORMAL, reason_hash(1), auth(1), 1000).is_err());
    }

    #[test]
    fn test_set_emergency_invalid_level() {
        let s = make_state();
        assert!(set_emergency_level(&s, 5, reason_hash(1), auth(1), 1000).is_err());
    }

    #[test]
    fn test_set_emergency_escalate_too_fast_rejected() {
        let s = make_state(); // level 0
        // Jump to level 3 (more than 2 levels, not shutdown)
        assert!(set_emergency_level(&s, EMERGENCY_PAUSED, reason_hash(1), auth(1), 1000).is_err());
    }

    #[test]
    fn test_set_emergency_shutdown_always_allowed() {
        let s = make_state(); // level 0
        // Shutdown is allowed from any level
        let r = set_emergency_level(&s, EMERGENCY_SHUTDOWN, reason_hash(1), auth(1), 1000);
        assert!(r.is_ok());
    }

    #[test]
    fn test_set_emergency_deescalate() {
        let mut s = make_state();
        s.emergency_level = EMERGENCY_PAUSED;
        let r = set_emergency_level(&s, EMERGENCY_CAUTION, reason_hash(1), auth(1), 2000).unwrap();
        assert_eq!(r.level, EMERGENCY_CAUTION);
    }

    #[test]
    fn test_set_emergency_auto_resume_time() {
        let s = make_state();
        let r = set_emergency_level(&s, EMERGENCY_RESTRICTED, reason_hash(1), auth(1), 1000).unwrap();
        assert_eq!(r.auto_resume_at, 1000 + AUTO_RESUME_WINDOW);
    }

    #[test]
    fn test_set_emergency_caution_no_auto_resume() {
        let s = make_state();
        let r = set_emergency_level(&s, EMERGENCY_CAUTION, reason_hash(1), auth(1), 1000).unwrap();
        assert_eq!(r.auto_resume_at, 0);
    }

    #[test]
    fn test_set_emergency_authorized_by_stored() {
        let s = make_state();
        let a = auth(42);
        let r = set_emergency_level(&s, EMERGENCY_CAUTION, reason_hash(1), a, 1000).unwrap();
        assert_eq!(r.authorized_by, a);
    }

    #[test]
    fn test_set_emergency_reason_hash_stored() {
        let s = make_state();
        let rh = reason_hash(99);
        let r = set_emergency_level(&s, EMERGENCY_CAUTION, rh, auth(1), 1000).unwrap();
        assert_eq!(r.trigger_reason_hash, rh);
    }

    // ============ check_auto_resume tests ============

    #[test]
    fn test_auto_resume_normal_returns_false() {
        let e = make_emergency_normal();
        assert!(!check_auto_resume(&e, 999_999));
    }

    #[test]
    fn test_auto_resume_shutdown_returns_false() {
        let e = EmergencyState {
            level: EMERGENCY_SHUTDOWN,
            triggered_at: 1000,
            trigger_reason_hash: [0u8; 32],
            auto_resume_at: 2000,
            authorized_by: [0u8; 32],
        };
        assert!(!check_auto_resume(&e, 999_999));
    }

    #[test]
    fn test_auto_resume_before_time() {
        let e = EmergencyState {
            level: EMERGENCY_RESTRICTED,
            triggered_at: 1000,
            trigger_reason_hash: [0u8; 32],
            auto_resume_at: 5000,
            authorized_by: [0u8; 32],
        };
        assert!(!check_auto_resume(&e, 4999));
    }

    #[test]
    fn test_auto_resume_at_time() {
        let e = EmergencyState {
            level: EMERGENCY_RESTRICTED,
            triggered_at: 1000,
            trigger_reason_hash: [0u8; 32],
            auto_resume_at: 5000,
            authorized_by: [0u8; 32],
        };
        assert!(check_auto_resume(&e, 5000));
    }

    #[test]
    fn test_auto_resume_after_time() {
        let e = EmergencyState {
            level: EMERGENCY_PAUSED,
            triggered_at: 1000,
            trigger_reason_hash: [0u8; 32],
            auto_resume_at: 5000,
            authorized_by: [0u8; 32],
        };
        assert!(check_auto_resume(&e, 6000));
    }

    #[test]
    fn test_auto_resume_zero_resume_time() {
        let e = EmergencyState {
            level: EMERGENCY_CAUTION,
            triggered_at: 1000,
            trigger_reason_hash: [0u8; 32],
            auto_resume_at: 0,
            authorized_by: [0u8; 32],
        };
        assert!(!check_auto_resume(&e, 999_999));
    }

    // ============ auto_trigger_emergency tests ============

    #[test]
    fn test_auto_trigger_normal_volume() {
        let mut s = make_state();
        let p = make_params();
        s.total_volume_24h = p.circuit_breaker_volume / 2;
        assert_eq!(auto_trigger_emergency(&s, &p), None);
    }

    #[test]
    fn test_auto_trigger_high_volume_caution() {
        let mut s = make_state();
        let p = make_params();
        s.total_volume_24h = p.circuit_breaker_volume + 1;
        assert_eq!(auto_trigger_emergency(&s, &p), Some(EMERGENCY_CAUTION));
    }

    #[test]
    fn test_auto_trigger_very_high_volume_restricted() {
        let mut s = make_state();
        let p = make_params();
        s.total_volume_24h = p.circuit_breaker_volume * 5;
        assert_eq!(auto_trigger_emergency(&s, &p), Some(EMERGENCY_RESTRICTED));
    }

    #[test]
    fn test_auto_trigger_extreme_volume_paused() {
        let mut s = make_state();
        let p = make_params();
        s.total_volume_24h = p.circuit_breaker_volume * 10;
        assert_eq!(auto_trigger_emergency(&s, &p), Some(EMERGENCY_PAUSED));
    }

    #[test]
    fn test_auto_trigger_at_exact_threshold() {
        let mut s = make_state();
        let p = make_params();
        s.total_volume_24h = p.circuit_breaker_volume;
        // Equal doesn't exceed, so None
        assert_eq!(auto_trigger_emergency(&s, &p), None);
    }

    // ============ is_trading_allowed tests ============

    #[test]
    fn test_trading_allowed_normal() {
        let s = make_state();
        let e = make_emergency_normal();
        assert!(is_trading_allowed(&s, &e));
    }

    #[test]
    fn test_trading_allowed_caution() {
        let s = make_state();
        let e = EmergencyState {
            level: EMERGENCY_CAUTION,
            ..make_emergency_normal()
        };
        assert!(is_trading_allowed(&s, &e));
    }

    #[test]
    fn test_trading_allowed_restricted() {
        let s = make_state();
        let e = EmergencyState {
            level: EMERGENCY_RESTRICTED,
            ..make_emergency_normal()
        };
        assert!(is_trading_allowed(&s, &e));
    }

    #[test]
    fn test_trading_not_allowed_paused() {
        let s = make_state();
        let e = EmergencyState {
            level: EMERGENCY_PAUSED,
            ..make_emergency_normal()
        };
        assert!(!is_trading_allowed(&s, &e));
    }

    #[test]
    fn test_trading_not_allowed_shutdown() {
        let s = make_state();
        let e = EmergencyState {
            level: EMERGENCY_SHUTDOWN,
            ..make_emergency_normal()
        };
        assert!(!is_trading_allowed(&s, &e));
    }

    #[test]
    fn test_trading_not_allowed_sunset() {
        let mut s = make_state();
        s.phase = PHASE_SUNSET;
        let e = make_emergency_normal();
        assert!(!is_trading_allowed(&s, &e));
    }

    #[test]
    fn test_trading_allowed_growth_normal() {
        let mut s = make_state();
        s.phase = PHASE_GROWTH;
        let e = make_emergency_normal();
        assert!(is_trading_allowed(&s, &e));
    }

    #[test]
    fn test_trading_allowed_maturity_normal() {
        let mut s = make_state();
        s.phase = PHASE_MATURITY;
        let e = make_emergency_normal();
        assert!(is_trading_allowed(&s, &e));
    }

    // ============ propose_upgrade tests ============

    #[test]
    fn test_propose_upgrade_basic() {
        let r = propose_upgrade(1, 2, 1000);
        assert_eq!(r.from_version, 1);
        assert_eq!(r.to_version, 2);
        assert_eq!(r.proposed_at, 1000);
    }

    #[test]
    fn test_propose_upgrade_not_activated() {
        let r = propose_upgrade(1, 2, 1000);
        assert_eq!(r.activated_at, 0);
    }

    #[test]
    fn test_propose_upgrade_rollback_to_from() {
        let r = propose_upgrade(1, 2, 1000);
        assert_eq!(r.rollback_to, 1);
    }

    #[test]
    fn test_propose_upgrade_compatible_same_major() {
        let r = propose_upgrade(10_001, 10_002, 1000);
        assert!(r.compatible);
    }

    #[test]
    fn test_propose_upgrade_incompatible_different_major() {
        let r = propose_upgrade(10_000, 20_001, 1000);
        assert!(!r.compatible);
    }

    #[test]
    fn test_propose_upgrade_incompatible_downgrade() {
        let r = propose_upgrade(2, 1, 1000);
        assert!(!r.compatible);
    }

    // ============ check_compatibility tests ============

    #[test]
    fn test_compatibility_same_major() {
        assert!(check_compatibility(10_001, 10_999));
    }

    #[test]
    fn test_compatibility_different_major() {
        assert!(!check_compatibility(10_000, 20_000));
    }

    #[test]
    fn test_compatibility_downgrade() {
        assert!(!check_compatibility(5, 3));
    }

    #[test]
    fn test_compatibility_same_version() {
        assert!(!check_compatibility(5, 5));
    }

    #[test]
    fn test_compatibility_zero_to_one() {
        assert!(check_compatibility(0, 1));
    }

    #[test]
    fn test_compatibility_major_boundary() {
        assert!(!check_compatibility(9_999, 10_000));
    }

    // ============ activate_upgrade tests ============

    #[test]
    fn test_activate_upgrade_basic() {
        let r = propose_upgrade(1, 2, 1000);
        let a = activate_upgrade(&r, 2000).unwrap();
        assert_eq!(a.activated_at, 2000);
    }

    #[test]
    fn test_activate_upgrade_already_activated() {
        let r = propose_upgrade(1, 2, 1000);
        let a = activate_upgrade(&r, 2000).unwrap();
        assert!(activate_upgrade(&a, 3000).is_err());
    }

    #[test]
    fn test_activate_upgrade_time_must_be_after_proposal() {
        let r = propose_upgrade(1, 2, 1000);
        assert!(activate_upgrade(&r, 1000).is_err());
    }

    #[test]
    fn test_activate_upgrade_preserves_versions() {
        let r = propose_upgrade(1, 2, 1000);
        let a = activate_upgrade(&r, 2000).unwrap();
        assert_eq!(a.from_version, 1);
        assert_eq!(a.to_version, 2);
    }

    // ============ rollback_upgrade tests ============

    #[test]
    fn test_rollback_upgrade_basic() {
        let r = propose_upgrade(1, 2, 1000);
        let a = activate_upgrade(&r, 2000).unwrap();
        let mut s = make_state();
        s.version = 2;
        let rolled = rollback_upgrade(&a, &s).unwrap();
        assert_eq!(rolled.version, 1);
    }

    #[test]
    fn test_rollback_upgrade_not_activated() {
        let r = propose_upgrade(1, 2, 1000);
        let s = make_state();
        assert!(rollback_upgrade(&r, &s).is_err());
    }

    #[test]
    fn test_rollback_upgrade_version_mismatch() {
        let r = propose_upgrade(1, 2, 1000);
        let a = activate_upgrade(&r, 2000).unwrap();
        let mut s = make_state();
        s.version = 99;
        assert!(rollback_upgrade(&a, &s).is_err());
    }

    #[test]
    fn test_rollback_preserves_state() {
        let r = propose_upgrade(1, 2, 1000);
        let a = activate_upgrade(&r, 2000).unwrap();
        let mut s = populated_state();
        s.version = 2;
        let rolled = rollback_upgrade(&a, &s).unwrap();
        assert_eq!(rolled.total_tvl, s.total_tvl);
        assert_eq!(rolled.epoch, s.epoch);
    }

    // ============ is_upgrade_pending tests ============

    #[test]
    fn test_is_upgrade_pending_true() {
        let r = propose_upgrade(1, 2, 1000);
        assert!(is_upgrade_pending(&r));
    }

    #[test]
    fn test_is_upgrade_pending_false_after_activation() {
        let r = propose_upgrade(1, 2, 1000);
        let a = activate_upgrade(&r, 2000).unwrap();
        assert!(!is_upgrade_pending(&a));
    }

    // ============ update_tvl tests ============

    #[test]
    fn test_update_tvl_set() {
        let s = make_state();
        let r = update_tvl(&s, 5_000_000_000);
        assert_eq!(r.total_tvl, 5_000_000_000);
    }

    #[test]
    fn test_update_tvl_overwrite() {
        let s = update_tvl(&make_state(), 100);
        let r = update_tvl(&s, 200);
        assert_eq!(r.total_tvl, 200);
    }

    #[test]
    fn test_update_tvl_preserves_version() {
        let s = make_state_v(42);
        let r = update_tvl(&s, 100);
        assert_eq!(r.version, 42);
    }

    #[test]
    fn test_update_tvl_zero() {
        let s = update_tvl(&make_state(), 100);
        let r = update_tvl(&s, 0);
        assert_eq!(r.total_tvl, 0);
    }

    #[test]
    fn test_update_tvl_max() {
        let s = make_state();
        let r = update_tvl(&s, u128::MAX);
        assert_eq!(r.total_tvl, u128::MAX);
    }

    // ============ update_volume tests ============

    #[test]
    fn test_update_volume_add() {
        let s = make_state();
        let r = update_volume(&s, 1000);
        assert_eq!(r.total_volume_24h, 1000);
    }

    #[test]
    fn test_update_volume_accumulate() {
        let s = update_volume(&make_state(), 500);
        let r = update_volume(&s, 300);
        assert_eq!(r.total_volume_24h, 800);
    }

    #[test]
    fn test_update_volume_saturates() {
        let mut s = make_state();
        s.total_volume_24h = u128::MAX - 10;
        let r = update_volume(&s, 100);
        assert_eq!(r.total_volume_24h, u128::MAX);
    }

    #[test]
    fn test_update_volume_zero() {
        let s = update_volume(&make_state(), 500);
        let r = update_volume(&s, 0);
        assert_eq!(r.total_volume_24h, 500);
    }

    // ============ update_user_count tests ============

    #[test]
    fn test_update_user_count_set() {
        let s = make_state();
        let r = update_user_count(&s, 42);
        assert_eq!(r.total_users, 42);
    }

    #[test]
    fn test_update_user_count_overwrite() {
        let s = update_user_count(&make_state(), 10);
        let r = update_user_count(&s, 20);
        assert_eq!(r.total_users, 20);
    }

    #[test]
    fn test_update_user_count_zero() {
        let s = update_user_count(&make_state(), 10);
        let r = update_user_count(&s, 0);
        assert_eq!(r.total_users, 0);
    }

    // ============ accumulate_fees tests ============

    #[test]
    fn test_accumulate_fees_add() {
        let s = make_state();
        let r = accumulate_fees(&s, 1000);
        assert_eq!(r.total_fee_revenue, 1000);
    }

    #[test]
    fn test_accumulate_fees_multiple() {
        let s = accumulate_fees(&make_state(), 500);
        let r = accumulate_fees(&s, 300);
        assert_eq!(r.total_fee_revenue, 800);
    }

    #[test]
    fn test_accumulate_fees_saturates() {
        let mut s = make_state();
        s.total_fee_revenue = u128::MAX - 10;
        let r = accumulate_fees(&s, 100);
        assert_eq!(r.total_fee_revenue, u128::MAX);
    }

    #[test]
    fn test_accumulate_fees_zero() {
        let s = accumulate_fees(&make_state(), 500);
        let r = accumulate_fees(&s, 0);
        assert_eq!(r.total_fee_revenue, 500);
    }

    // ============ take_snapshot tests ============

    #[test]
    fn test_take_snapshot_basic() {
        let s = populated_state();
        let p = make_params();
        let snap = take_snapshot(&s, &p);
        assert_eq!(snap.epoch, s.epoch);
        assert_eq!(snap.tvl, s.total_tvl);
        assert_eq!(snap.volume, s.total_volume_24h);
        assert_eq!(snap.users, s.total_users);
    }

    #[test]
    fn test_take_snapshot_fees() {
        let s = populated_state();
        let p = make_params();
        let snap = take_snapshot(&s, &p);
        assert_eq!(snap.fees, s.total_fee_revenue);
    }

    #[test]
    fn test_take_snapshot_timestamp() {
        let s = populated_state();
        let p = make_params();
        let snap = take_snapshot(&s, &p);
        assert_eq!(snap.timestamp, s.last_updated);
    }

    #[test]
    fn test_take_snapshot_state_hash_not_zero() {
        let s = populated_state();
        let p = make_params();
        let snap = take_snapshot(&s, &p);
        assert_ne!(snap.state_hash, [0u8; 32]);
    }

    #[test]
    fn test_take_snapshot_params_hash_not_zero() {
        let s = populated_state();
        let p = make_params();
        let snap = take_snapshot(&s, &p);
        assert_ne!(snap.params_hash, [0u8; 32]);
    }

    #[test]
    fn test_take_snapshot_different_states_different_hashes() {
        let p = make_params();
        let s1 = make_state();
        let s2 = populated_state();
        let snap1 = take_snapshot(&s1, &p);
        let snap2 = take_snapshot(&s2, &p);
        assert_ne!(snap1.state_hash, snap2.state_hash);
    }

    #[test]
    fn test_take_snapshot_different_params_different_hashes() {
        let s = make_state();
        let p1 = make_params();
        let mut p2 = make_params();
        p2.base_fee_bps = 999;
        let snap1 = take_snapshot(&s, &p1);
        let snap2 = take_snapshot(&s, &p2);
        assert_ne!(snap1.params_hash, snap2.params_hash);
    }

    // ============ compute_diff tests ============

    #[test]
    fn test_compute_diff_identical() {
        let snap = make_snapshot_at(1, 100, 200, 50, 300, 1000);
        let diffs = compute_diff(&snap, &snap);
        assert_eq!(diffs.len(), 0);
    }

    #[test]
    fn test_compute_diff_tvl_changed() {
        let a = make_snapshot_at(1, 100, 200, 50, 300, 1000);
        let b = make_snapshot_at(1, 200, 200, 50, 300, 2000);
        let diffs = compute_diff(&a, &b);
        let tvl_hash = hash_field_name("tvl");
        assert!(diffs.iter().any(|d| d.field_name_hash == tvl_hash));
    }

    #[test]
    fn test_compute_diff_volume_changed() {
        let a = make_snapshot_at(1, 100, 200, 50, 300, 1000);
        let b = make_snapshot_at(1, 100, 500, 50, 300, 2000);
        let diffs = compute_diff(&a, &b);
        let vol_hash = hash_field_name("volume");
        assert!(diffs.iter().any(|d| d.field_name_hash == vol_hash));
    }

    #[test]
    fn test_compute_diff_users_changed() {
        let a = make_snapshot_at(1, 100, 200, 50, 300, 1000);
        let b = make_snapshot_at(1, 100, 200, 100, 300, 2000);
        let diffs = compute_diff(&a, &b);
        let user_hash = hash_field_name("users");
        assert!(diffs.iter().any(|d| d.field_name_hash == user_hash));
    }

    #[test]
    fn test_compute_diff_fees_changed() {
        let a = make_snapshot_at(1, 100, 200, 50, 300, 1000);
        let b = make_snapshot_at(1, 100, 200, 50, 600, 2000);
        let diffs = compute_diff(&a, &b);
        let fee_hash = hash_field_name("fees");
        assert!(diffs.iter().any(|d| d.field_name_hash == fee_hash));
    }

    #[test]
    fn test_compute_diff_epoch_changed() {
        let a = make_snapshot_at(1, 100, 200, 50, 300, 1000);
        let b = make_snapshot_at(2, 100, 200, 50, 300, 2000);
        let diffs = compute_diff(&a, &b);
        let epoch_hash = hash_field_name("epoch");
        assert!(diffs.iter().any(|d| d.field_name_hash == epoch_hash));
    }

    #[test]
    fn test_compute_diff_multiple_changes() {
        let a = make_snapshot_at(1, 100, 200, 50, 300, 1000);
        let b = make_snapshot_at(2, 200, 400, 100, 600, 2000);
        let diffs = compute_diff(&a, &b);
        // epoch, tvl, volume, users, fees all changed + state_hash
        assert!(diffs.len() >= 5);
    }

    #[test]
    fn test_compute_diff_old_new_values() {
        let a = make_snapshot_at(1, 100, 200, 50, 300, 1000);
        let b = make_snapshot_at(1, 999, 200, 50, 300, 2000);
        let diffs = compute_diff(&a, &b);
        let tvl_diff = diffs.iter().find(|d| d.field_name_hash == hash_field_name("tvl")).unwrap();
        assert_eq!(tvl_diff.old_value, 100);
        assert_eq!(tvl_diff.new_value, 999);
    }

    #[test]
    fn test_compute_diff_changed_at_timestamp() {
        let a = make_snapshot_at(1, 100, 200, 50, 300, 1000);
        let b = make_snapshot_at(1, 999, 200, 50, 300, 5000);
        let diffs = compute_diff(&a, &b);
        for d in &diffs {
            assert_eq!(d.changed_at, 5000);
        }
    }

    // ============ verify_state_integrity tests ============

    #[test]
    fn test_verify_integrity_ok() {
        let s = make_state();
        let p = make_params();
        assert!(verify_state_integrity(&s, &p).is_ok());
    }

    #[test]
    fn test_verify_integrity_invalid_phase() {
        let mut s = make_state();
        s.phase = 10;
        let p = make_params();
        assert!(verify_state_integrity(&s, &p).is_err());
    }

    #[test]
    fn test_verify_integrity_invalid_emergency() {
        let mut s = make_state();
        s.emergency_level = 10;
        let p = make_params();
        assert!(verify_state_integrity(&s, &p).is_err());
    }

    #[test]
    fn test_verify_integrity_zero_version() {
        let s = create_initial_state(0);
        let p = make_params();
        assert!(verify_state_integrity(&s, &p).is_err());
    }

    #[test]
    fn test_verify_integrity_invalid_params() {
        let s = make_state();
        let mut p = make_params();
        p.base_fee_bps = MAX_FEE_BPS + 1;
        assert!(verify_state_integrity(&s, &p).is_err());
    }

    #[test]
    fn test_verify_integrity_populated_state() {
        let s = populated_state();
        let p = make_params();
        assert!(verify_state_integrity(&s, &p).is_ok());
    }

    // ============ calculate_protocol_health_score tests ============

    #[test]
    fn test_health_score_initial_state() {
        let s = make_state();
        let p = make_params();
        let score = calculate_protocol_health_score(&s, &p);
        // Only emergency component contributes (3000), others are 0
        assert_eq!(score, 3000);
    }

    #[test]
    fn test_health_score_populated_state() {
        let s = populated_state();
        let p = make_params();
        let score = calculate_protocol_health_score(&s, &p);
        assert!(score > 3000);
    }

    #[test]
    fn test_health_score_max_possible() {
        let mut s = make_state();
        let p = make_params();
        s.total_tvl = p.circuit_breaker_volume * 2;
        s.total_volume_24h = p.circuit_breaker_volume * 2;
        s.total_users = 10_000;
        s.emergency_level = EMERGENCY_NORMAL;
        let score = calculate_protocol_health_score(&s, &p);
        assert_eq!(score, HEALTH_PERFECT);
    }

    #[test]
    fn test_health_score_emergency_reduces() {
        let mut s = populated_state();
        let p = make_params();
        let normal_score = calculate_protocol_health_score(&s, &p);
        s.emergency_level = EMERGENCY_PAUSED;
        let paused_score = calculate_protocol_health_score(&s, &p);
        assert!(paused_score < normal_score);
    }

    #[test]
    fn test_health_score_shutdown_lowest_emergency() {
        let mut s = populated_state();
        let p = make_params();
        s.emergency_level = EMERGENCY_SHUTDOWN;
        let score = calculate_protocol_health_score(&s, &p);
        // Emergency component is 0
        assert!(score < 10_000);
    }

    #[test]
    fn test_health_score_users_component() {
        let mut s = make_state();
        let p = make_params();
        let score_no_users = calculate_protocol_health_score(&s, &p);
        s.total_users = 1000;
        let score_with_users = calculate_protocol_health_score(&s, &p);
        assert!(score_with_users > score_no_users);
    }

    // ============ calculate_fee_growth_rate tests ============

    #[test]
    fn test_fee_growth_rate_empty() {
        assert_eq!(calculate_fee_growth_rate(&[]), 0);
    }

    #[test]
    fn test_fee_growth_rate_single() {
        let snap = make_snapshot_at(1, 100, 200, 50, 300, 1000);
        assert_eq!(calculate_fee_growth_rate(&[snap]), 0);
    }

    #[test]
    fn test_fee_growth_rate_doubled() {
        let a = make_snapshot_at(1, 100, 200, 50, 1000, 1000);
        let b = make_snapshot_at(2, 100, 200, 50, 2000, 2000);
        let rate = calculate_fee_growth_rate(&[a, b]);
        assert_eq!(rate, BPS as i64); // 100% growth
    }

    #[test]
    fn test_fee_growth_rate_halved() {
        let a = make_snapshot_at(1, 100, 200, 50, 2000, 1000);
        let b = make_snapshot_at(2, 100, 200, 50, 1000, 2000);
        let rate = calculate_fee_growth_rate(&[a, b]);
        assert_eq!(rate, -(BPS as i64) / 2); // -50%
    }

    #[test]
    fn test_fee_growth_rate_no_change() {
        let a = make_snapshot_at(1, 100, 200, 50, 500, 1000);
        let b = make_snapshot_at(2, 100, 200, 50, 500, 2000);
        let rate = calculate_fee_growth_rate(&[a, b]);
        assert_eq!(rate, 0);
    }

    #[test]
    fn test_fee_growth_rate_from_zero() {
        let a = make_snapshot_at(1, 100, 200, 50, 0, 1000);
        let b = make_snapshot_at(2, 100, 200, 50, 100, 2000);
        let rate = calculate_fee_growth_rate(&[a, b]);
        assert_eq!(rate, BPS as i64); // 100% from zero
    }

    #[test]
    fn test_fee_growth_rate_zero_to_zero() {
        let a = make_snapshot_at(1, 100, 200, 50, 0, 1000);
        let b = make_snapshot_at(2, 100, 200, 50, 0, 2000);
        let rate = calculate_fee_growth_rate(&[a, b]);
        assert_eq!(rate, 0);
    }

    #[test]
    fn test_fee_growth_rate_uses_first_and_last() {
        let a = make_snapshot_at(1, 0, 0, 0, 1000, 1000);
        let b = make_snapshot_at(2, 0, 0, 0, 5000, 2000); // middle, ignored
        let c = make_snapshot_at(3, 0, 0, 0, 3000, 3000);
        let rate = calculate_fee_growth_rate(&[a, b, c]);
        // Growth from 1000 to 3000 = 200%
        assert_eq!(rate, 20_000);
    }

    // ============ Hash helper tests ============

    #[test]
    fn test_hash_state_deterministic() {
        let s = populated_state();
        let h1 = hash_state(&s);
        let h2 = hash_state(&s);
        assert_eq!(h1, h2);
    }

    #[test]
    fn test_hash_state_different_states() {
        let s1 = make_state();
        let s2 = populated_state();
        assert_ne!(hash_state(&s1), hash_state(&s2));
    }

    #[test]
    fn test_hash_params_deterministic() {
        let p = make_params();
        let h1 = hash_params(&p);
        let h2 = hash_params(&p);
        assert_eq!(h1, h2);
    }

    #[test]
    fn test_hash_params_different() {
        let p1 = make_params();
        let mut p2 = make_params();
        p2.base_fee_bps = 999;
        assert_ne!(hash_params(&p1), hash_params(&p2));
    }

    #[test]
    fn test_hash_field_name_deterministic() {
        let h1 = hash_field_name("tvl");
        let h2 = hash_field_name("tvl");
        assert_eq!(h1, h2);
    }

    #[test]
    fn test_hash_field_name_different_names() {
        assert_ne!(hash_field_name("tvl"), hash_field_name("volume"));
    }

    // ============ Integration / Combined workflow tests ============

    #[test]
    fn test_full_lifecycle_bootstrap_to_growth() {
        let configs = default_phase_configs();
        let params = make_params();
        let mut s = create_initial_state(1);

        // Advance through epochs
        for i in 1..=10 {
            let e = make_epoch(i);
            s = advance_epoch(&s, &e).unwrap();
        }
        assert_eq!(s.epoch, 10);

        // Build up TVL and users
        s = update_tvl(&s, 1_000_000_000);
        s = update_user_count(&s, 100);

        // Check transition
        assert_eq!(check_phase_transition(&s, &configs), Some(PHASE_GROWTH));
        s = transition_phase(&s, PHASE_GROWTH, &configs).unwrap();
        assert_eq!(s.phase, PHASE_GROWTH);

        // Verify integrity
        assert!(verify_state_integrity(&s, &params).is_ok());
    }

    #[test]
    fn test_emergency_then_resume_workflow() {
        let mut s = make_state();
        s.emergency_level = EMERGENCY_NORMAL;
        let e = make_emergency_normal();
        assert!(is_trading_allowed(&s, &e));

        // Escalate to restricted
        let e2 = set_emergency_level(&s, EMERGENCY_RESTRICTED, reason_hash(1), auth(1), 1000).unwrap();
        s.emergency_level = e2.level;
        assert!(is_trading_allowed(&s, &e2));

        // Check auto-resume not yet
        assert!(!check_auto_resume(&e2, 1000 + AUTO_RESUME_WINDOW - 1));
        // Auto-resume triggered
        assert!(check_auto_resume(&e2, 1000 + AUTO_RESUME_WINDOW));
    }

    #[test]
    fn test_upgrade_lifecycle() {
        let mut s = create_initial_state(10_001);
        let record = propose_upgrade(10_001, 10_002, 1000);
        assert!(is_upgrade_pending(&record));
        assert!(record.compatible);

        let activated = activate_upgrade(&record, 2000).unwrap();
        assert!(!is_upgrade_pending(&activated));

        // Apply upgrade
        s.version = 10_002;

        // Rollback
        let rolled = rollback_upgrade(&activated, &s).unwrap();
        assert_eq!(rolled.version, 10_001);
    }

    #[test]
    fn test_snapshot_and_diff_workflow() {
        let params = make_params();
        let s1 = populated_state();
        let snap1 = take_snapshot(&s1, &params);

        let mut s2 = s1.clone();
        s2.total_tvl = 100_000_000_000;
        s2.total_users = 1000;
        s2.last_updated = 2_000_000;
        let snap2 = take_snapshot(&s2, &params);

        let diffs = compute_diff(&snap1, &snap2);
        assert!(!diffs.is_empty());

        // TVL and users changed
        let tvl_hash = hash_field_name("tvl");
        let user_hash = hash_field_name("users");
        assert!(diffs.iter().any(|d| d.field_name_hash == tvl_hash));
        assert!(diffs.iter().any(|d| d.field_name_hash == user_hash));
    }

    #[test]
    fn test_metrics_accumulation_workflow() {
        let mut s = make_state();
        s = update_tvl(&s, 1_000_000);
        s = update_volume(&s, 500_000);
        s = update_volume(&s, 300_000);
        s = update_user_count(&s, 42);
        s = accumulate_fees(&s, 100);
        s = accumulate_fees(&s, 200);

        assert_eq!(s.total_tvl, 1_000_000);
        assert_eq!(s.total_volume_24h, 800_000);
        assert_eq!(s.total_users, 42);
        assert_eq!(s.total_fee_revenue, 300);
    }

    #[test]
    fn test_phase_progress_incremental() {
        let configs = default_phase_configs();
        let mut s = make_state();
        let p0 = estimate_phase_progress(&s, &configs);

        s.total_tvl = 500_000_000; // 50% of growth min
        let p1 = estimate_phase_progress(&s, &configs);
        assert!(p1 > p0);

        s.total_users = 50; // 50% of growth min
        let p2 = estimate_phase_progress(&s, &configs);
        assert!(p2 > p1);

        s.epoch = 5; // 50% of growth min
        let p3 = estimate_phase_progress(&s, &configs);
        assert!(p3 > p2);
    }

    #[test]
    fn test_health_score_varies_with_emergency_level() {
        let p = make_params();
        let mut s = populated_state();
        let scores: Vec<u64> = (0..=4)
            .map(|level| {
                s.emergency_level = level;
                calculate_protocol_health_score(&s, &p)
            })
            .collect();
        // Each level should decrease health
        for i in 1..scores.len() {
            assert!(scores[i] <= scores[i - 1]);
        }
    }

    #[test]
    fn test_epoch_advancement_with_fee_accumulation() {
        let mut s = make_state();
        let mut total_fees: u128 = 0;
        for i in 1..=20 {
            let mut e = make_epoch(i);
            e.fees_collected = i as u128 * 100;
            total_fees += e.fees_collected;
            s = advance_epoch(&s, &e).unwrap();
        }
        assert_eq!(s.epoch, 20);
        assert_eq!(s.total_fee_revenue, total_fees);
    }

    #[test]
    fn test_create_state_take_snapshot_verify() {
        let s = make_state();
        let p = make_params();
        let snap = take_snapshot(&s, &p);
        assert_eq!(snap.tvl, 0);
        assert_eq!(snap.users, 0);
        assert_eq!(snap.fees, 0);
        assert_eq!(snap.volume, 0);
        assert_eq!(snap.epoch, 0);
    }

    #[test]
    fn test_multiple_upgrades_sequential() {
        let r1 = propose_upgrade(1, 2, 100);
        let a1 = activate_upgrade(&r1, 200).unwrap();
        assert_eq!(a1.activated_at, 200);

        let r2 = propose_upgrade(2, 3, 300);
        let a2 = activate_upgrade(&r2, 400).unwrap();
        assert_eq!(a2.from_version, 2);
        assert_eq!(a2.to_version, 3);
    }

    #[test]
    fn test_auto_trigger_then_manual_set() {
        let mut s = make_state();
        let p = make_params();
        s.total_volume_24h = p.circuit_breaker_volume * 6;

        let trigger = auto_trigger_emergency(&s, &p);
        assert_eq!(trigger, Some(EMERGENCY_RESTRICTED));

        // Manually set to the triggered level
        let em = set_emergency_level(&s, EMERGENCY_RESTRICTED, reason_hash(1), auth(1), 5000).unwrap();
        assert_eq!(em.level, EMERGENCY_RESTRICTED);
    }

    #[test]
    fn test_validate_params_all_max_values() {
        let p = SystemParams {
            base_fee_bps: MAX_FEE_BPS,
            max_batch_size: MAX_BATCH_SIZE_LIMIT,
            reward_rate_bps: MAX_REWARD_RATE_BPS,
            min_stake: u64::MAX,
            max_leverage_bps: MAX_LEVERAGE_LIMIT_BPS,
            oracle_deviation_bps: MAX_ORACLE_DEVIATION_BPS,
            circuit_breaker_volume: u128::MAX,
            circuit_breaker_price_bps: BPS,
        };
        assert!(validate_params(&p).is_ok());
    }

    #[test]
    fn test_state_clone_independence() {
        let s1 = populated_state();
        let s2 = update_tvl(&s1, 999);
        assert_eq!(s1.total_tvl, 50_000_000_000);
        assert_eq!(s2.total_tvl, 999);
    }

    #[test]
    fn test_snapshot_deterministic() {
        let s = populated_state();
        let p = make_params();
        let snap1 = take_snapshot(&s, &p);
        let snap2 = take_snapshot(&s, &p);
        assert_eq!(snap1.state_hash, snap2.state_hash);
        assert_eq!(snap1.params_hash, snap2.params_hash);
    }

    #[test]
    fn test_diff_symmetry() {
        let a = make_snapshot_at(1, 100, 200, 50, 300, 1000);
        let b = make_snapshot_at(2, 200, 400, 100, 600, 2000);
        let diffs_ab = compute_diff(&a, &b);
        let diffs_ba = compute_diff(&b, &a);
        // Same number of diffs (fields changed are the same)
        assert_eq!(diffs_ab.len(), diffs_ba.len());
    }

    #[test]
    fn test_emergency_level_boundary_escalation() {
        let mut s = make_state();
        // 0 -> 2 is allowed (within 2 levels)
        let e = set_emergency_level(&s, EMERGENCY_RESTRICTED, reason_hash(1), auth(1), 1000);
        assert!(e.is_ok());

        // 0 -> 3 is NOT allowed (more than 2 levels, not shutdown)
        let e2 = set_emergency_level(&s, EMERGENCY_PAUSED, reason_hash(1), auth(1), 1000);
        assert!(e2.is_err());

        // But 1 -> 3 is allowed
        s.emergency_level = EMERGENCY_CAUTION;
        let e3 = set_emergency_level(&s, EMERGENCY_PAUSED, reason_hash(1), auth(1), 1000);
        assert!(e3.is_ok());
    }

    #[test]
    fn test_epoch_end_equals_start_rejected() {
        let s = make_state();
        let e = EpochInfo {
            epoch_number: 1,
            start_block: 100,
            end_block: 100,
            blocks_produced: 1,
            tx_count: 1,
            fees_collected: 1,
        };
        assert!(advance_epoch(&s, &e).is_err());
    }

    #[test]
    fn test_upgrade_same_time_rejected() {
        let r = propose_upgrade(1, 2, 1000);
        assert!(activate_upgrade(&r, 1000).is_err());
    }

    #[test]
    fn test_upgrade_before_proposal_rejected() {
        let r = propose_upgrade(1, 2, 1000);
        assert!(activate_upgrade(&r, 500).is_err());
    }

    #[test]
    fn test_fee_growth_rate_10x() {
        let a = make_snapshot_at(1, 0, 0, 0, 100, 1000);
        let b = make_snapshot_at(2, 0, 0, 0, 1000, 2000);
        let rate = calculate_fee_growth_rate(&[a, b]);
        // 900% growth = 90_000 bps
        assert_eq!(rate, 90_000);
    }

    #[test]
    fn test_fee_growth_rate_negative() {
        let a = make_snapshot_at(1, 0, 0, 0, 1000, 1000);
        let b = make_snapshot_at(2, 0, 0, 0, 100, 2000);
        let rate = calculate_fee_growth_rate(&[a, b]);
        assert!(rate < 0);
    }

    #[test]
    fn test_phase_all_transitions_sequential() {
        let configs = default_phase_configs();
        let mut s = create_initial_state(1);
        // bootstrap -> growth
        s.total_tvl = 1_000_000_000;
        s.total_users = 100;
        s.epoch = 10;
        s = transition_phase(&s, PHASE_GROWTH, &configs).unwrap();
        // growth -> maturity
        s.total_tvl = 100_000_000_000;
        s.total_users = 10_000;
        s.epoch = 100;
        s = transition_phase(&s, PHASE_MATURITY, &configs).unwrap();
        // maturity -> sunset
        s.epoch = 1000;
        s = transition_phase(&s, PHASE_SUNSET, &configs).unwrap();
        assert_eq!(s.phase, PHASE_SUNSET);
    }

    #[test]
    fn test_emergency_deescalate_to_normal() {
        let mut s = make_state();
        s.emergency_level = EMERGENCY_CAUTION;
        let r = set_emergency_level(&s, EMERGENCY_NORMAL, reason_hash(0), auth(1), 5000).unwrap();
        assert_eq!(r.level, EMERGENCY_NORMAL);
        assert_eq!(r.auto_resume_at, 0);
    }

    #[test]
    fn test_update_tvl_then_snapshot() {
        let s = update_tvl(&make_state(), 42_000);
        let p = make_params();
        let snap = take_snapshot(&s, &p);
        assert_eq!(snap.tvl, 42_000);
    }

    #[test]
    fn test_accumulate_fees_then_growth_rate() {
        let mut s1 = make_state();
        s1.total_fee_revenue = 1000;
        let p = make_params();
        let snap1 = take_snapshot(&s1, &p);

        let mut s2 = s1.clone();
        s2.total_fee_revenue = 1500;
        s2.last_updated = 100;
        let snap2 = take_snapshot(&s2, &p);

        let rate = calculate_fee_growth_rate(&[snap1, snap2]);
        assert_eq!(rate, 5000); // 50% growth
    }

    #[test]
    fn test_compute_diff_no_params_change() {
        let a = make_snapshot_at(1, 100, 200, 50, 300, 1000);
        let mut b = a.clone();
        b.tvl = 200;
        b.timestamp = 2000;
        let diffs = compute_diff(&a, &b);
        // TVL changed + state_hash changed
        let params_hash = hash_field_name("params_hash");
        assert!(!diffs.iter().any(|d| d.field_name_hash == params_hash));
    }

    #[test]
    fn test_default_params_circuit_breaker_volume() {
        let p = default_system_params();
        assert_eq!(p.circuit_breaker_volume, 100_000_000_000);
    }

    #[test]
    fn test_default_params_circuit_breaker_price() {
        let p = default_system_params();
        assert_eq!(p.circuit_breaker_price_bps, 1000);
    }

    #[test]
    fn test_version_preserved_through_operations() {
        let mut s = create_initial_state(77);
        s = update_tvl(&s, 100);
        s = update_volume(&s, 200);
        s = update_user_count(&s, 10);
        s = accumulate_fees(&s, 50);
        assert_eq!(s.version, 77);
    }

    #[test]
    fn test_advance_epoch_preserves_emergency() {
        let mut s = make_state();
        s.emergency_level = EMERGENCY_RESTRICTED;
        let e = make_epoch(1);
        let r = advance_epoch(&s, &e).unwrap();
        assert_eq!(r.emergency_level, EMERGENCY_RESTRICTED);
    }

    #[test]
    fn test_advance_epoch_preserves_version() {
        let s = create_initial_state(42);
        let e = make_epoch(1);
        let r = advance_epoch(&s, &e).unwrap();
        assert_eq!(r.version, 42);
    }

    #[test]
    fn test_transition_phase_preserves_emergency() {
        let configs = default_phase_configs();
        let mut s = make_state();
        s.total_tvl = 1_000_000_000;
        s.total_users = 100;
        s.epoch = 10;
        s.emergency_level = EMERGENCY_CAUTION;
        let r = transition_phase(&s, PHASE_GROWTH, &configs).unwrap();
        assert_eq!(r.emergency_level, EMERGENCY_CAUTION);
    }

    #[test]
    fn test_health_score_zero_tvl_target() {
        let s = make_state();
        let mut p = make_params();
        p.circuit_breaker_volume = 0;
        let score = calculate_protocol_health_score(&s, &p);
        // TVL component = 3000, volume = 0, users = 0, emergency = 3000
        assert!(score >= 3000);
    }

    #[test]
    fn test_update_params_change_leverage() {
        let p = make_params();
        let r = update_system_params(&p, None, None, None, None, Some(100_000), None, None, None);
        assert_eq!(r.unwrap().max_leverage_bps, 100_000);
    }

    #[test]
    fn test_update_params_change_oracle_deviation() {
        let p = make_params();
        let r = update_system_params(&p, None, None, None, None, None, Some(1000), None, None);
        assert_eq!(r.unwrap().oracle_deviation_bps, 1000);
    }

    #[test]
    fn test_rollback_preserves_emergency() {
        let r = propose_upgrade(1, 2, 1000);
        let a = activate_upgrade(&r, 2000).unwrap();
        let mut s = make_state();
        s.version = 2;
        s.emergency_level = EMERGENCY_RESTRICTED;
        let rolled = rollback_upgrade(&a, &s).unwrap();
        assert_eq!(rolled.emergency_level, EMERGENCY_RESTRICTED);
    }

    #[test]
    fn test_rollback_preserves_epoch() {
        let r = propose_upgrade(1, 2, 1000);
        let a = activate_upgrade(&r, 2000).unwrap();
        let mut s = make_state();
        s.version = 2;
        s.epoch = 99;
        let rolled = rollback_upgrade(&a, &s).unwrap();
        assert_eq!(rolled.epoch, 99);
    }

    #[test]
    fn test_auto_trigger_zero_volume() {
        let s = make_state();
        let p = make_params();
        assert_eq!(auto_trigger_emergency(&s, &p), None);
    }

    #[test]
    fn test_trading_allowed_bootstrap_normal() {
        let s = make_state();
        let e = make_emergency_normal();
        assert!(is_trading_allowed(&s, &e));
    }
}
