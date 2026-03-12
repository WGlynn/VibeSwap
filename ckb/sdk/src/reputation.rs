// ============ Reputation Module ============
// On-chain reputation system for VibeSwap participants on CKB.
//
// Tracks behavior, contributions, reliability, and trust scores to enable
// reputation-weighted governance and access control.
//
// Key capabilities:
// - Per-address reputation scores with category breakdown (trading, governance, liquidity, social)
// - Weighted score computation with configurable decay over time
// - Contribution recording with positive/negative events weighted by significance
// - Trust tier classification (untrusted -> basic -> verified -> trusted -> elite -> guardian)
// - Penalty system with cooldown periods and gradual recovery
// - Sybil resistance via rapid-creation and correlated-behavior detection
// - Reputation-gated access with progressive unlocks
//
// All arithmetic uses u64/u128 — no floating point, deterministic everywhere.
// Errors are simple strings for CKB cell compatibility.
//
// Philosophy: Trust is earned incrementally, lost rapidly, and recovered slowly.

// ============ Constants ============

/// Basis points denominator
pub const BPS_DENOMINATOR: u64 = 10_000;

/// Category identifiers
pub const CATEGORY_TRADING: u8 = 0;
pub const CATEGORY_GOVERNANCE: u8 = 1;
pub const CATEGORY_LIQUIDITY: u8 = 2;
pub const CATEGORY_SOCIAL: u8 = 3;
pub const NUM_CATEGORIES: usize = 4;

/// Trust tier identifiers
pub const TIER_UNTRUSTED: u8 = 0;
pub const TIER_BASIC: u8 = 1;
pub const TIER_VERIFIED: u8 = 2;
pub const TIER_TRUSTED: u8 = 3;
pub const TIER_ELITE: u8 = 4;
pub const TIER_GUARDIAN: u8 = 5;

/// Default tier thresholds
pub const DEFAULT_TIER_THRESHOLDS: [u64; 6] = [0, 100, 500, 2000, 5000, 10000];

/// Default decay rate: 1% per period (100 bps)
pub const DEFAULT_DECAY_RATE_BPS: u64 = 100;

/// Default max score
pub const DEFAULT_MAX_SCORE: u64 = 100_000;

/// Default penalty multiplier (2x = 20000 bps)
pub const DEFAULT_PENALTY_MULTIPLIER: u64 = 20_000;

/// Default recovery rate: 0.5% per period (50 bps)
pub const DEFAULT_RECOVERY_RATE_BPS: u64 = 50;

/// Default cooldown: 1000 blocks
pub const DEFAULT_COOLDOWN_BLOCKS: u64 = 1000;

/// Maximum number of sybil indicators before flagging
pub const SYBIL_FLAG_THRESHOLD: u64 = 3;

/// Penalty types
pub const PENALTY_FAILED_REVEAL: u8 = 0;
pub const PENALTY_MALICIOUS_PROPOSAL: u8 = 1;
pub const PENALTY_SPAM: u8 = 2;
pub const PENALTY_MANIPULATION: u8 = 3;

/// Sybil indicator types
pub const SYBIL_RAPID_CREATION: u8 = 0;
pub const SYBIL_CORRELATED_BEHAVIOR: u8 = 1;
pub const SYBIL_LOW_AGE_HIGH_ACTIVITY: u8 = 2;

// ============ Data Types ============

#[derive(Debug, Clone)]
pub struct ReputationProfile {
    pub address_hash: u64,
    pub total_score: u64,
    pub trading_score: u64,
    pub governance_score: u64,
    pub liquidity_score: u64,
    pub social_score: u64,
    pub last_updated: u64,
    pub created_at: u64,
    pub penalty_count: u64,
    pub trust_tier: u8,
}

#[derive(Debug, Clone)]
pub struct ReputationEvent {
    pub address_hash: u64,
    pub event_type: u8,
    pub delta: i64,
    pub category: u8,
    pub timestamp: u64,
    pub details_hash: u64,
}

#[derive(Debug, Clone)]
pub struct ReputationConfig {
    pub decay_rate_bps: u64,
    pub max_score: u64,
    pub min_score: u64,
    pub tier_thresholds: Vec<u64>,
    pub penalty_multiplier: u64,
    pub recovery_rate_bps: u64,
    pub cooldown_blocks: u64,
}

#[derive(Debug, Clone)]
pub struct TrustTier {
    pub tier: u8,
    pub min_score: u64,
    pub max_score: u64,
    pub label_hash: u64,
}

#[derive(Debug, Clone)]
pub struct PenaltyRecord {
    pub address_hash: u64,
    pub penalty_type: u8,
    pub amount: u64,
    pub applied_at: u64,
    pub cooldown_until: u64,
    pub recovered: bool,
}

#[derive(Debug, Clone)]
pub struct SybilIndicator {
    pub address_hash: u64,
    pub indicator_type: u8,
    pub score: u64,
    pub detected_at: u64,
}

#[derive(Debug, Clone)]
pub struct AccessGate {
    pub feature_hash: u64,
    pub required_tier: u8,
    pub required_score: u64,
    pub required_age_blocks: u64,
}

// ============ Profile Management ============

/// Create a new reputation profile for an address.
pub fn create_profile(address_hash: u64, current_time: u64) -> ReputationProfile {
    ReputationProfile {
        address_hash,
        total_score: 0,
        trading_score: 0,
        governance_score: 0,
        liquidity_score: 0,
        social_score: 0,
        last_updated: current_time,
        created_at: current_time,
        penalty_count: 0,
        trust_tier: TIER_UNTRUSTED,
    }
}

/// Record a reputation event on a profile, updating the appropriate category score.
pub fn record_event(profile: &ReputationProfile, event: &ReputationEvent) -> Result<ReputationProfile, String> {
    if event.address_hash != profile.address_hash {
        return Err("event address does not match profile".to_string());
    }
    if event.category > CATEGORY_SOCIAL {
        return Err("invalid event category".to_string());
    }

    let mut p = profile.clone();

    match event.category {
        CATEGORY_TRADING => {
            p.trading_score = apply_delta(p.trading_score, event.delta);
        }
        CATEGORY_GOVERNANCE => {
            p.governance_score = apply_delta(p.governance_score, event.delta);
        }
        CATEGORY_LIQUIDITY => {
            p.liquidity_score = apply_delta(p.liquidity_score, event.delta);
        }
        CATEGORY_SOCIAL => {
            p.social_score = apply_delta(p.social_score, event.delta);
        }
        _ => return Err("invalid category".to_string()),
    }

    p.total_score = p.trading_score
        .saturating_add(p.governance_score)
        .saturating_add(p.liquidity_score)
        .saturating_add(p.social_score);
    p.last_updated = event.timestamp;

    Ok(p)
}

/// Apply a signed delta to a u64 score, flooring at zero.
fn apply_delta(current: u64, delta: i64) -> u64 {
    if delta >= 0 {
        current.saturating_add(delta as u64)
    } else {
        let abs = delta.unsigned_abs();
        current.saturating_sub(abs)
    }
}

// ============ Score Computation ============

/// Calculate total score as the sum of all category scores.
pub fn calculate_total_score(profile: &ReputationProfile) -> u64 {
    profile.trading_score
        .saturating_add(profile.governance_score)
        .saturating_add(profile.liquidity_score)
        .saturating_add(profile.social_score)
}

/// Calculate a weighted score from category scores using basis-point weights.
/// `weights_bps` must have exactly 4 entries summing to 10000.
pub fn calculate_weighted_score(
    trading: u64,
    governance: u64,
    liquidity: u64,
    social: u64,
    weights_bps: &[u64; 4],
) -> u64 {
    let sum: u64 = weights_bps.iter().sum();
    if sum == 0 {
        return 0;
    }
    let scores = [trading, governance, liquidity, social];
    let mut total: u128 = 0;
    for i in 0..4 {
        total = total.saturating_add((scores[i] as u128).saturating_mul(weights_bps[i] as u128));
    }
    (total / sum as u128) as u64
}

/// Apply time-based decay to a profile's scores.
/// Decay reduces each score by `decay_rate_bps` per elapsed block.
pub fn apply_decay(profile: &ReputationProfile, elapsed_blocks: u64, config: &ReputationConfig) -> ReputationProfile {
    let mut p = profile.clone();
    if elapsed_blocks == 0 || config.decay_rate_bps == 0 {
        return p;
    }
    // Compound decay: score * ((BPS - rate) / BPS) ^ elapsed
    // For efficiency, apply per-block decay multiplicatively up to a cap
    // Use iterative approach for small elapsed, exponential approximation for large
    let decay_factor = compute_decay_factor(elapsed_blocks, config.decay_rate_bps);

    p.trading_score = apply_decay_factor(p.trading_score, decay_factor);
    p.governance_score = apply_decay_factor(p.governance_score, decay_factor);
    p.liquidity_score = apply_decay_factor(p.liquidity_score, decay_factor);
    p.social_score = apply_decay_factor(p.social_score, decay_factor);
    p.total_score = p.trading_score
        .saturating_add(p.governance_score)
        .saturating_add(p.liquidity_score)
        .saturating_add(p.social_score);
    p.last_updated = p.last_updated.saturating_add(elapsed_blocks);

    p
}

/// Compute a decay factor in BPS after `elapsed` blocks at `rate_bps` per block.
/// Returns remaining fraction in BPS (e.g., 9900 means 99% remains).
fn compute_decay_factor(elapsed: u64, rate_bps: u64) -> u64 {
    if rate_bps >= BPS_DENOMINATOR {
        return 0;
    }
    let retain_bps = BPS_DENOMINATOR - rate_bps;
    // For large elapsed values, use repeated squaring
    let mut result: u128 = BPS_DENOMINATOR as u128;
    let mut base: u128 = retain_bps as u128;
    let mut exp = elapsed;
    let denom: u128 = BPS_DENOMINATOR as u128;

    while exp > 0 {
        if exp & 1 == 1 {
            result = result * base / denom;
        }
        base = base * base / denom;
        exp >>= 1;
    }

    if result > BPS_DENOMINATOR as u128 {
        BPS_DENOMINATOR
    } else {
        result as u64
    }
}

/// Apply a BPS decay factor to a score.
fn apply_decay_factor(score: u64, factor_bps: u64) -> u64 {
    ((score as u128) * (factor_bps as u128) / (BPS_DENOMINATOR as u128)) as u64
}

// ============ Trust Tiers ============

/// Determine the trust tier for a given score based on config thresholds.
/// Thresholds are sorted ascending; tier = index of highest threshold <= score.
pub fn determine_trust_tier(score: u64, config: &ReputationConfig) -> u8 {
    let mut tier: u8 = 0;
    for (i, &threshold) in config.tier_thresholds.iter().enumerate() {
        if score >= threshold {
            tier = i as u8;
        } else {
            break;
        }
    }
    tier
}

/// Build a TrustTier struct for a given tier index.
pub fn build_trust_tier(tier: u8, config: &ReputationConfig) -> Result<TrustTier, String> {
    let idx = tier as usize;
    if idx >= config.tier_thresholds.len() {
        return Err("tier index out of range".to_string());
    }
    let min_score = config.tier_thresholds[idx];
    let max_score = if idx + 1 < config.tier_thresholds.len() {
        config.tier_thresholds[idx + 1].saturating_sub(1)
    } else {
        config.max_score
    };
    Ok(TrustTier {
        tier,
        min_score,
        max_score,
        label_hash: tier as u64,
    })
}

// ============ Penalty System ============

/// Apply a penalty to a profile, reducing its score and recording a penalty.
pub fn apply_penalty(
    profile: &ReputationProfile,
    penalty_type: u8,
    amount: u64,
    current_block: u64,
    config: &ReputationConfig,
) -> Result<(ReputationProfile, PenaltyRecord), String> {
    if amount == 0 {
        return Err("penalty amount cannot be zero".to_string());
    }
    // Multiply penalty by multiplier for repeat offenders
    let effective = if profile.penalty_count > 0 {
        let mult = config.penalty_multiplier.min(100_000); // cap at 10x
        let scaled = (amount as u128) * (mult as u128) / (BPS_DENOMINATOR as u128);
        scaled.min(u64::MAX as u128) as u64
    } else {
        amount
    };

    let mut p = profile.clone();
    // Subtract penalty from total score proportionally across categories
    let total = calculate_total_score(&p);
    if total > 0 {
        let deduction = effective.min(total);
        p.trading_score = p.trading_score.saturating_sub(
            ((deduction as u128) * (p.trading_score as u128) / (total as u128)) as u64,
        );
        p.governance_score = p.governance_score.saturating_sub(
            ((deduction as u128) * (p.governance_score as u128) / (total as u128)) as u64,
        );
        p.liquidity_score = p.liquidity_score.saturating_sub(
            ((deduction as u128) * (p.liquidity_score as u128) / (total as u128)) as u64,
        );
        p.social_score = p.social_score.saturating_sub(
            ((deduction as u128) * (p.social_score as u128) / (total as u128)) as u64,
        );
    }
    p.total_score = calculate_total_score(&p);
    p.penalty_count = p.penalty_count.saturating_add(1);
    p.last_updated = current_block;
    p.trust_tier = determine_trust_tier(p.total_score, config);

    let record = PenaltyRecord {
        address_hash: profile.address_hash,
        penalty_type,
        amount: effective,
        applied_at: current_block,
        cooldown_until: current_block.saturating_add(config.cooldown_blocks),
        recovered: false,
    };

    Ok((p, record))
}

/// Check whether a penalty is in its cooldown period.
pub fn is_in_cooldown(penalty: &PenaltyRecord, current_block: u64) -> bool {
    !penalty.recovered && current_block < penalty.cooldown_until
}

/// Check if a penalty's cooldown has expired and recovery is possible.
pub fn check_recovery(penalty: &PenaltyRecord, current_block: u64) -> bool {
    !penalty.recovered && current_block >= penalty.cooldown_until
}

/// Apply recovery to a profile after a penalty's cooldown has expired.
/// Recovers a fraction of the penalty amount based on recovery_rate_bps.
pub fn apply_recovery(
    profile: &ReputationProfile,
    penalty: &PenaltyRecord,
    current_block: u64,
    config: &ReputationConfig,
) -> Result<ReputationProfile, String> {
    if penalty.recovered {
        return Err("penalty already recovered".to_string());
    }
    if current_block < penalty.cooldown_until {
        return Err("penalty still in cooldown".to_string());
    }
    let blocks_since = current_block.saturating_sub(penalty.cooldown_until);
    let recovery_amount = ((penalty.amount as u128)
        * (config.recovery_rate_bps as u128)
        * (blocks_since as u128)
        / (BPS_DENOMINATOR as u128))
        .min(penalty.amount as u128) as u64;

    let mut p = profile.clone();
    // Distribute recovery equally across categories
    let per_cat = recovery_amount / NUM_CATEGORIES as u64;
    p.trading_score = p.trading_score.saturating_add(per_cat);
    p.governance_score = p.governance_score.saturating_add(per_cat);
    p.liquidity_score = p.liquidity_score.saturating_add(per_cat);
    p.social_score = p.social_score.saturating_add(per_cat);
    p.total_score = calculate_total_score(&p);
    p.last_updated = current_block;
    p.trust_tier = determine_trust_tier(p.total_score, config);

    Ok(p)
}

// ============ Sybil Resistance ============

/// Detect rapid account creation within a time window.
/// Returns sybil indicators for any address_hash that appears too many times.
pub fn detect_rapid_creation(
    creation_times: &[(u64, u64)], // (address_hash, timestamp)
    window_ms: u64,
    threshold: u64,
) -> Vec<SybilIndicator> {
    let mut indicators = Vec::new();
    if creation_times.is_empty() || window_ms == 0 || threshold == 0 {
        return indicators;
    }

    // Sort by timestamp
    let mut sorted: Vec<(u64, u64)> = creation_times.to_vec();
    sorted.sort_by_key(|&(_, ts)| ts);

    // Sliding window: count creations within each window
    for i in 0..sorted.len() {
        let window_start = sorted[i].1;
        let window_end = window_start.saturating_add(window_ms);
        let mut count: u64 = 0;
        for j in i..sorted.len() {
            if sorted[j].1 <= window_end {
                count += 1;
            } else {
                break;
            }
        }
        if count >= threshold {
            // Flag all addresses in this window
            for j in i..sorted.len() {
                if sorted[j].1 <= window_end {
                    let already = indicators.iter().any(|ind: &SybilIndicator| ind.address_hash == sorted[j].0);
                    if !already {
                        indicators.push(SybilIndicator {
                            address_hash: sorted[j].0,
                            indicator_type: SYBIL_RAPID_CREATION,
                            score: count,
                            detected_at: window_start,
                        });
                    }
                } else {
                    break;
                }
            }
            break; // Only report once per window detection
        }
    }
    indicators
}

/// Detect correlated behavior between two sets of events.
/// Returns true if the timing correlation exceeds the threshold.
pub fn detect_correlated_behavior(
    events_a: &[u64], // timestamps
    events_b: &[u64], // timestamps
    correlation_threshold_bps: u64,
) -> bool {
    if events_a.is_empty() || events_b.is_empty() {
        return false;
    }

    let min_len = events_a.len().min(events_b.len());
    if min_len == 0 {
        return false;
    }

    // Sort both
    let mut a: Vec<u64> = events_a.to_vec();
    let mut b: Vec<u64> = events_b.to_vec();
    a.sort();
    b.sort();

    // Count "close" pairs — events within 10 units of each other
    let tolerance: u64 = 10;
    let mut matches: u64 = 0;
    let mut j = 0;
    for &ta in a.iter() {
        while j < b.len() && b[j] + tolerance < ta {
            j += 1;
        }
        if j < b.len() {
            let diff = if ta > b[j] { ta - b[j] } else { b[j] - ta };
            if diff <= tolerance {
                matches += 1;
            }
        }
    }

    let correlation_bps = if min_len > 0 {
        (matches as u128 * BPS_DENOMINATOR as u128 / min_len as u128) as u64
    } else {
        0
    };

    correlation_bps >= correlation_threshold_bps
}

/// Calculate overall sybil risk score from a set of indicators.
/// Higher score = more suspicious. Max 10000 (100%).
pub fn calculate_sybil_risk_score(indicators: &[SybilIndicator]) -> u64 {
    if indicators.is_empty() {
        return 0;
    }
    let total: u128 = indicators.iter().map(|i| i.score as u128).sum();
    let avg = (total / indicators.len() as u128) as u64;
    let count_factor = (indicators.len() as u64).min(10) * 1000; // up to 10000
    // Combine average score with count factor
    let combined = avg.saturating_add(count_factor);
    combined.min(BPS_DENOMINATOR)
}

// ============ Access Control ============

/// Check if a profile meets the requirements of an access gate.
pub fn check_access(
    profile: &ReputationProfile,
    gate: &AccessGate,
    current_block: u64,
) -> Result<bool, String> {
    if current_block < profile.created_at {
        return Err("current block before profile creation".to_string());
    }
    let age = current_block.saturating_sub(profile.created_at);

    let tier_ok = profile.trust_tier >= gate.required_tier;
    let score_ok = profile.total_score >= gate.required_score;
    let age_ok = age >= gate.required_age_blocks;

    Ok(tier_ok && score_ok && age_ok)
}

/// Determine the highest progressive unlock level a profile qualifies for.
/// Gates should be sorted by increasing difficulty.
pub fn progressive_unlock_level(profile: &ReputationProfile, gates: &[AccessGate], current_block: u64) -> u8 {
    let mut level: u8 = 0;
    for gate in gates {
        match check_access(profile, gate, current_block) {
            Ok(true) => level += 1,
            _ => break,
        }
    }
    level
}

// ============ Analytics ============

/// Get the percentile rank of a score within all scores (in bps).
pub fn get_reputation_percentile(score: u64, all_scores: &[u64]) -> u64 {
    if all_scores.is_empty() {
        return 0;
    }
    let below = all_scores.iter().filter(|&&s| s < score).count() as u128;
    (below * BPS_DENOMINATOR as u128 / all_scores.len() as u128) as u64
}

/// Calculate reputation weight for weighted voting.
/// Returns a weight in bps scaled by the profile's score relative to max_weight_bps.
pub fn calculate_reputation_weight(profile: &ReputationProfile, max_weight_bps: u64) -> u64 {
    if profile.total_score == 0 || max_weight_bps == 0 {
        return 0;
    }
    // Weight scales linearly with score, capped at max_weight_bps
    // Normalize: score / DEFAULT_MAX_SCORE * max_weight_bps
    let weight = (profile.total_score as u128 * max_weight_bps as u128 / DEFAULT_MAX_SCORE as u128) as u64;
    weight.min(max_weight_bps)
}

/// Merge multiple profiles into an aggregate profile.
/// Sums all category scores and uses the latest timestamp.
pub fn merge_profiles(profiles: &[ReputationProfile]) -> ReputationProfile {
    let mut merged = create_profile(0, 0);
    for p in profiles {
        merged.trading_score = merged.trading_score.saturating_add(p.trading_score);
        merged.governance_score = merged.governance_score.saturating_add(p.governance_score);
        merged.liquidity_score = merged.liquidity_score.saturating_add(p.liquidity_score);
        merged.social_score = merged.social_score.saturating_add(p.social_score);
        merged.penalty_count = merged.penalty_count.saturating_add(p.penalty_count);
        if p.last_updated > merged.last_updated {
            merged.last_updated = p.last_updated;
        }
        if merged.created_at == 0 || (p.created_at > 0 && p.created_at < merged.created_at) {
            merged.created_at = p.created_at;
        }
    }
    merged.total_score = calculate_total_score(&merged);
    merged
}

/// Rank profiles by reputation score, returning (address_hash, score) sorted descending.
pub fn rank_by_reputation(profiles: &[ReputationProfile]) -> Vec<(u64, u64)> {
    let mut ranked: Vec<(u64, u64)> = profiles.iter().map(|p| (p.address_hash, p.total_score)).collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    ranked
}

/// Apply decay to multiple profiles at once.
pub fn batch_apply_decay(
    profiles: &[ReputationProfile],
    elapsed_blocks: u64,
    config: &ReputationConfig,
) -> Vec<ReputationProfile> {
    profiles.iter().map(|p| apply_decay(p, elapsed_blocks, config)).collect()
}

/// Get category breakdown as vec of (category_id, score).
pub fn calculate_category_breakdown(profile: &ReputationProfile) -> Vec<(u8, u64)> {
    vec![
        (CATEGORY_TRADING, profile.trading_score),
        (CATEGORY_GOVERNANCE, profile.governance_score),
        (CATEGORY_LIQUIDITY, profile.liquidity_score),
        (CATEGORY_SOCIAL, profile.social_score),
    ]
}

/// Calculate effective score after subtracting active (un-recovered, not in cooldown) penalties.
pub fn calculate_effective_score(profile: &ReputationProfile, penalties: &[PenaltyRecord]) -> u64 {
    let active_penalty_sum: u64 = penalties
        .iter()
        .filter(|p| !p.recovered)
        .map(|p| p.amount)
        .fold(0u64, |acc, a| acc.saturating_add(a));
    profile.total_score.saturating_sub(active_penalty_sum)
}

/// Estimate the number of blocks needed to reach a target tier.
/// Based on avg_daily_events (events per day, each worth 1 point) and decay.
pub fn estimate_time_to_tier(
    profile: &ReputationProfile,
    target_tier: u8,
    avg_daily_events: u64,
    config: &ReputationConfig,
) -> u64 {
    if config.tier_thresholds.is_empty() {
        return 0;
    }
    let target_idx = target_tier as usize;
    if target_idx >= config.tier_thresholds.len() {
        return u64::MAX;
    }
    let target_score = config.tier_thresholds[target_idx];
    if profile.total_score >= target_score {
        return 0;
    }
    let gap = target_score.saturating_sub(profile.total_score);
    if avg_daily_events == 0 {
        return u64::MAX;
    }
    // Simple estimate: gap / avg_daily_events (blocks ~ days for simplicity)
    // Account for decay: effective gain = events - decay
    let daily_decay = (profile.total_score as u128 * config.decay_rate_bps as u128 / BPS_DENOMINATOR as u128) as u64;
    let net_gain = avg_daily_events.saturating_sub(daily_decay);
    if net_gain == 0 {
        return u64::MAX;
    }
    gap.saturating_add(net_gain - 1) / net_gain // ceiling division
}

/// Create a default ReputationConfig.
pub fn default_config() -> ReputationConfig {
    ReputationConfig {
        decay_rate_bps: DEFAULT_DECAY_RATE_BPS,
        max_score: DEFAULT_MAX_SCORE,
        min_score: 0,
        tier_thresholds: DEFAULT_TIER_THRESHOLDS.to_vec(),
        penalty_multiplier: DEFAULT_PENALTY_MULTIPLIER,
        recovery_rate_bps: DEFAULT_RECOVERY_RATE_BPS,
        cooldown_blocks: DEFAULT_COOLDOWN_BLOCKS,
    }
}

/// Validate a ReputationConfig for consistency.
pub fn validate_config(config: &ReputationConfig) -> Result<(), String> {
    if config.decay_rate_bps > BPS_DENOMINATOR {
        return Err("decay rate exceeds 100%".to_string());
    }
    if config.max_score == 0 {
        return Err("max score cannot be zero".to_string());
    }
    if config.min_score > config.max_score {
        return Err("min score exceeds max score".to_string());
    }
    if config.tier_thresholds.is_empty() {
        return Err("tier thresholds cannot be empty".to_string());
    }
    // Check thresholds are sorted
    for i in 1..config.tier_thresholds.len() {
        if config.tier_thresholds[i] < config.tier_thresholds[i - 1] {
            return Err("tier thresholds must be sorted ascending".to_string());
        }
    }
    if config.recovery_rate_bps > BPS_DENOMINATOR {
        return Err("recovery rate exceeds 100%".to_string());
    }
    Ok(())
}

/// Record multiple events on a profile in sequence.
pub fn record_events(profile: &ReputationProfile, events: &[ReputationEvent]) -> Result<ReputationProfile, String> {
    let mut p = profile.clone();
    for event in events {
        p = record_event(&p, event)?;
    }
    Ok(p)
}

/// Clamp a profile's scores to the config max.
pub fn clamp_scores(profile: &ReputationProfile, config: &ReputationConfig) -> ReputationProfile {
    let mut p = profile.clone();
    let max_per_cat = config.max_score; // Each category can go up to max
    p.trading_score = p.trading_score.min(max_per_cat);
    p.governance_score = p.governance_score.min(max_per_cat);
    p.liquidity_score = p.liquidity_score.min(max_per_cat);
    p.social_score = p.social_score.min(max_per_cat);
    p.total_score = calculate_total_score(&p);
    p
}

/// Get the profile age in blocks.
pub fn profile_age(profile: &ReputationProfile, current_block: u64) -> u64 {
    current_block.saturating_sub(profile.created_at)
}

/// Check if a profile has been active recently (within `window` blocks of current).
pub fn is_active(profile: &ReputationProfile, current_block: u64, window: u64) -> bool {
    current_block.saturating_sub(profile.last_updated) <= window
}

/// Count how many profiles are in each trust tier.
pub fn tier_distribution(profiles: &[ReputationProfile]) -> Vec<(u8, u64)> {
    let mut counts = [0u64; 6];
    for p in profiles {
        let idx = (p.trust_tier as usize).min(5);
        counts[idx] += 1;
    }
    counts.iter().enumerate().map(|(i, &c)| (i as u8, c)).collect()
}

/// Filter profiles by minimum tier.
pub fn filter_by_tier(profiles: &[ReputationProfile], min_tier: u8) -> Vec<ReputationProfile> {
    profiles.iter().filter(|p| p.trust_tier >= min_tier).cloned().collect()
}

/// Create a reputation event helper.
pub fn make_event(address_hash: u64, event_type: u8, delta: i64, category: u8, timestamp: u64) -> ReputationEvent {
    ReputationEvent {
        address_hash,
        event_type,
        delta,
        category,
        timestamp,
        details_hash: 0,
    }
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config() -> ReputationConfig {
        default_config()
    }

    fn profile_with_scores(addr: u64, t: u64, g: u64, l: u64, s: u64) -> ReputationProfile {
        ReputationProfile {
            address_hash: addr,
            total_score: t + g + l + s,
            trading_score: t,
            governance_score: g,
            liquidity_score: l,
            social_score: s,
            last_updated: 1000,
            created_at: 100,
            penalty_count: 0,
            trust_tier: TIER_UNTRUSTED,
        }
    }

    // ============ Profile Creation Tests ============

    #[test]
    fn test_create_profile_zero_scores() {
        let p = create_profile(42, 1000);
        assert_eq!(p.address_hash, 42);
        assert_eq!(p.total_score, 0);
        assert_eq!(p.trading_score, 0);
        assert_eq!(p.governance_score, 0);
        assert_eq!(p.liquidity_score, 0);
        assert_eq!(p.social_score, 0);
        assert_eq!(p.trust_tier, TIER_UNTRUSTED);
    }

    #[test]
    fn test_create_profile_timestamp() {
        let p = create_profile(1, 5000);
        assert_eq!(p.last_updated, 5000);
        assert_eq!(p.created_at, 5000);
    }

    #[test]
    fn test_create_profile_zero_penalties() {
        let p = create_profile(1, 100);
        assert_eq!(p.penalty_count, 0);
    }

    #[test]
    fn test_create_profile_different_addresses() {
        let p1 = create_profile(1, 100);
        let p2 = create_profile(2, 100);
        assert_ne!(p1.address_hash, p2.address_hash);
    }

    #[test]
    fn test_create_profile_max_address() {
        let p = create_profile(u64::MAX, 0);
        assert_eq!(p.address_hash, u64::MAX);
    }

    // ============ Event Recording Tests ============

    #[test]
    fn test_record_positive_trading_event() {
        let p = create_profile(1, 100);
        let e = make_event(1, 0, 50, CATEGORY_TRADING, 200);
        let r = record_event(&p, &e).unwrap();
        assert_eq!(r.trading_score, 50);
        assert_eq!(r.total_score, 50);
    }

    #[test]
    fn test_record_positive_governance_event() {
        let p = create_profile(1, 100);
        let e = make_event(1, 0, 30, CATEGORY_GOVERNANCE, 200);
        let r = record_event(&p, &e).unwrap();
        assert_eq!(r.governance_score, 30);
    }

    #[test]
    fn test_record_positive_liquidity_event() {
        let p = create_profile(1, 100);
        let e = make_event(1, 0, 75, CATEGORY_LIQUIDITY, 200);
        let r = record_event(&p, &e).unwrap();
        assert_eq!(r.liquidity_score, 75);
    }

    #[test]
    fn test_record_positive_social_event() {
        let p = create_profile(1, 100);
        let e = make_event(1, 0, 20, CATEGORY_SOCIAL, 200);
        let r = record_event(&p, &e).unwrap();
        assert_eq!(r.social_score, 20);
    }

    #[test]
    fn test_record_negative_event_reduces_score() {
        let p = profile_with_scores(1, 100, 0, 0, 0);
        let e = make_event(1, 0, -30, CATEGORY_TRADING, 200);
        let r = record_event(&p, &e).unwrap();
        assert_eq!(r.trading_score, 70);
    }

    #[test]
    fn test_record_negative_event_floor_at_zero() {
        let p = profile_with_scores(1, 10, 0, 0, 0);
        let e = make_event(1, 0, -50, CATEGORY_TRADING, 200);
        let r = record_event(&p, &e).unwrap();
        assert_eq!(r.trading_score, 0);
    }

    #[test]
    fn test_record_event_wrong_address() {
        let p = create_profile(1, 100);
        let e = make_event(2, 0, 10, CATEGORY_TRADING, 200);
        let r = record_event(&p, &e);
        assert!(r.is_err());
    }

    #[test]
    fn test_record_event_invalid_category() {
        let p = create_profile(1, 100);
        let e = make_event(1, 0, 10, 99, 200);
        let r = record_event(&p, &e);
        assert!(r.is_err());
    }

    #[test]
    fn test_record_event_updates_timestamp() {
        let p = create_profile(1, 100);
        let e = make_event(1, 0, 10, CATEGORY_TRADING, 999);
        let r = record_event(&p, &e).unwrap();
        assert_eq!(r.last_updated, 999);
    }

    #[test]
    fn test_record_event_total_score_updated() {
        let p = profile_with_scores(1, 10, 20, 30, 40);
        let e = make_event(1, 0, 5, CATEGORY_TRADING, 200);
        let r = record_event(&p, &e).unwrap();
        assert_eq!(r.total_score, 105);
    }

    #[test]
    fn test_record_multiple_events_accumulate() {
        let p = create_profile(1, 100);
        let e1 = make_event(1, 0, 10, CATEGORY_TRADING, 200);
        let e2 = make_event(1, 0, 20, CATEGORY_TRADING, 300);
        let r = record_event(&record_event(&p, &e1).unwrap(), &e2).unwrap();
        assert_eq!(r.trading_score, 30);
    }

    #[test]
    fn test_record_events_batch() {
        let p = create_profile(1, 100);
        let events = vec![
            make_event(1, 0, 10, CATEGORY_TRADING, 200),
            make_event(1, 0, 20, CATEGORY_GOVERNANCE, 300),
            make_event(1, 0, 30, CATEGORY_LIQUIDITY, 400),
        ];
        let r = record_events(&p, &events).unwrap();
        assert_eq!(r.trading_score, 10);
        assert_eq!(r.governance_score, 20);
        assert_eq!(r.liquidity_score, 30);
        assert_eq!(r.total_score, 60);
    }

    #[test]
    fn test_record_events_batch_with_negative() {
        let p = profile_with_scores(1, 100, 100, 100, 100);
        let events = vec![
            make_event(1, 0, -50, CATEGORY_TRADING, 200),
            make_event(1, 0, 10, CATEGORY_GOVERNANCE, 300),
        ];
        let r = record_events(&p, &events).unwrap();
        assert_eq!(r.trading_score, 50);
        assert_eq!(r.governance_score, 110);
    }

    #[test]
    fn test_record_event_zero_delta() {
        let p = profile_with_scores(1, 50, 0, 0, 0);
        let e = make_event(1, 0, 0, CATEGORY_TRADING, 200);
        let r = record_event(&p, &e).unwrap();
        assert_eq!(r.trading_score, 50);
    }

    #[test]
    fn test_record_event_large_positive_delta() {
        let p = create_profile(1, 100);
        let e = make_event(1, 0, i64::MAX, CATEGORY_TRADING, 200);
        let r = record_event(&p, &e).unwrap();
        assert_eq!(r.trading_score, i64::MAX as u64);
    }

    // ============ Score Computation Tests ============

    #[test]
    fn test_calculate_total_score_all_zero() {
        let p = create_profile(1, 100);
        assert_eq!(calculate_total_score(&p), 0);
    }

    #[test]
    fn test_calculate_total_score_mixed() {
        let p = profile_with_scores(1, 100, 200, 300, 400);
        assert_eq!(calculate_total_score(&p), 1000);
    }

    #[test]
    fn test_calculate_total_score_single_category() {
        let p = profile_with_scores(1, 500, 0, 0, 0);
        assert_eq!(calculate_total_score(&p), 500);
    }

    #[test]
    fn test_calculate_weighted_score_equal_weights() {
        let w = [2500, 2500, 2500, 2500];
        let r = calculate_weighted_score(100, 100, 100, 100, &w);
        assert_eq!(r, 100);
    }

    #[test]
    fn test_calculate_weighted_score_trading_heavy() {
        let w = [7000, 1000, 1000, 1000];
        let r = calculate_weighted_score(100, 100, 100, 100, &w);
        assert_eq!(r, 100);
    }

    #[test]
    fn test_calculate_weighted_score_different_scores() {
        let w = [5000, 3000, 1000, 1000];
        // (1000*5000 + 500*3000 + 200*1000 + 100*1000) / 10000
        // = (5000000 + 1500000 + 200000 + 100000) / 10000 = 680
        let r = calculate_weighted_score(1000, 500, 200, 100, &w);
        assert_eq!(r, 680);
    }

    #[test]
    fn test_calculate_weighted_score_zero_weights() {
        let w = [0, 0, 0, 0];
        let r = calculate_weighted_score(100, 200, 300, 400, &w);
        assert_eq!(r, 0);
    }

    #[test]
    fn test_calculate_weighted_score_single_category_weight() {
        let w = [10000, 0, 0, 0];
        let r = calculate_weighted_score(500, 200, 300, 400, &w);
        assert_eq!(r, 500);
    }

    #[test]
    fn test_calculate_weighted_score_all_zero_scores() {
        let w = [2500, 2500, 2500, 2500];
        let r = calculate_weighted_score(0, 0, 0, 0, &w);
        assert_eq!(r, 0);
    }

    // ============ Decay Tests ============

    #[test]
    fn test_apply_decay_zero_elapsed() {
        let p = profile_with_scores(1, 1000, 1000, 1000, 1000);
        let cfg = test_config();
        let r = apply_decay(&p, 0, &cfg);
        assert_eq!(r.total_score, 4000);
    }

    #[test]
    fn test_apply_decay_one_block() {
        let p = profile_with_scores(1, 10000, 0, 0, 0);
        let cfg = test_config(); // 100 bps = 1%
        let r = apply_decay(&p, 1, &cfg);
        // 10000 * 9900/10000 = 9900
        assert_eq!(r.trading_score, 9900);
    }

    #[test]
    fn test_apply_decay_multiple_blocks() {
        let p = profile_with_scores(1, 10000, 0, 0, 0);
        let cfg = test_config();
        let r = apply_decay(&p, 2, &cfg);
        // 10000 * (9900/10000)^2 = 10000 * 0.9801 = 9801
        assert_eq!(r.trading_score, 9801);
    }

    #[test]
    fn test_apply_decay_preserves_address() {
        let p = profile_with_scores(42, 1000, 0, 0, 0);
        let cfg = test_config();
        let r = apply_decay(&p, 5, &cfg);
        assert_eq!(r.address_hash, 42);
    }

    #[test]
    fn test_apply_decay_updates_timestamp() {
        let mut p = profile_with_scores(1, 1000, 0, 0, 0);
        p.last_updated = 100;
        let cfg = test_config();
        let r = apply_decay(&p, 50, &cfg);
        assert_eq!(r.last_updated, 150);
    }

    #[test]
    fn test_apply_decay_zero_rate() {
        let p = profile_with_scores(1, 1000, 0, 0, 0);
        let mut cfg = test_config();
        cfg.decay_rate_bps = 0;
        let r = apply_decay(&p, 100, &cfg);
        assert_eq!(r.trading_score, 1000);
    }

    #[test]
    fn test_apply_decay_full_rate_zeroes_score() {
        let p = profile_with_scores(1, 1000, 0, 0, 0);
        let mut cfg = test_config();
        cfg.decay_rate_bps = BPS_DENOMINATOR;
        let r = apply_decay(&p, 1, &cfg);
        assert_eq!(r.trading_score, 0);
    }

    #[test]
    fn test_apply_decay_all_categories() {
        let p = profile_with_scores(1, 1000, 2000, 3000, 4000);
        let cfg = test_config();
        let r = apply_decay(&p, 1, &cfg);
        assert_eq!(r.trading_score, 990);
        assert_eq!(r.governance_score, 1980);
        assert_eq!(r.liquidity_score, 2970);
        assert_eq!(r.social_score, 3960);
    }

    #[test]
    fn test_apply_decay_total_score_consistent() {
        let p = profile_with_scores(1, 1000, 2000, 3000, 4000);
        let cfg = test_config();
        let r = apply_decay(&p, 1, &cfg);
        assert_eq!(r.total_score, r.trading_score + r.governance_score + r.liquidity_score + r.social_score);
    }

    #[test]
    fn test_apply_decay_large_elapsed() {
        let p = profile_with_scores(1, 10000, 0, 0, 0);
        let cfg = test_config();
        let r = apply_decay(&p, 1000, &cfg);
        // After 1000 blocks at 1% decay, score should be very small
        assert!(r.trading_score < 100);
    }

    // ============ Trust Tier Tests ============

    #[test]
    fn test_determine_tier_zero_score() {
        let cfg = test_config();
        assert_eq!(determine_trust_tier(0, &cfg), TIER_UNTRUSTED);
    }

    #[test]
    fn test_determine_tier_basic() {
        let cfg = test_config();
        assert_eq!(determine_trust_tier(100, &cfg), TIER_BASIC);
    }

    #[test]
    fn test_determine_tier_verified() {
        let cfg = test_config();
        assert_eq!(determine_trust_tier(500, &cfg), TIER_VERIFIED);
    }

    #[test]
    fn test_determine_tier_trusted() {
        let cfg = test_config();
        assert_eq!(determine_trust_tier(2000, &cfg), TIER_TRUSTED);
    }

    #[test]
    fn test_determine_tier_elite() {
        let cfg = test_config();
        assert_eq!(determine_trust_tier(5000, &cfg), TIER_ELITE);
    }

    #[test]
    fn test_determine_tier_guardian() {
        let cfg = test_config();
        assert_eq!(determine_trust_tier(10000, &cfg), TIER_GUARDIAN);
    }

    #[test]
    fn test_determine_tier_between_thresholds() {
        let cfg = test_config();
        assert_eq!(determine_trust_tier(250, &cfg), TIER_BASIC);
    }

    #[test]
    fn test_determine_tier_at_boundary() {
        let cfg = test_config();
        assert_eq!(determine_trust_tier(99, &cfg), TIER_UNTRUSTED);
    }

    #[test]
    fn test_determine_tier_max_score() {
        let cfg = test_config();
        assert_eq!(determine_trust_tier(u64::MAX, &cfg), TIER_GUARDIAN);
    }

    #[test]
    fn test_build_trust_tier_basic() {
        let cfg = test_config();
        let t = build_trust_tier(TIER_BASIC, &cfg).unwrap();
        assert_eq!(t.tier, TIER_BASIC);
        assert_eq!(t.min_score, 100);
        assert_eq!(t.max_score, 499);
    }

    #[test]
    fn test_build_trust_tier_guardian() {
        let cfg = test_config();
        let t = build_trust_tier(TIER_GUARDIAN, &cfg).unwrap();
        assert_eq!(t.tier, TIER_GUARDIAN);
        assert_eq!(t.min_score, 10000);
        assert_eq!(t.max_score, cfg.max_score);
    }

    #[test]
    fn test_build_trust_tier_out_of_range() {
        let cfg = test_config();
        let r = build_trust_tier(10, &cfg);
        assert!(r.is_err());
    }

    // ============ Penalty Tests ============

    #[test]
    fn test_apply_penalty_reduces_score() {
        let p = profile_with_scores(1, 500, 500, 0, 0);
        let cfg = test_config();
        let (r, _) = apply_penalty(&p, PENALTY_FAILED_REVEAL, 200, 5000, &cfg).unwrap();
        assert!(r.total_score < 1000);
    }

    #[test]
    fn test_apply_penalty_creates_record() {
        let p = profile_with_scores(1, 500, 0, 0, 0);
        let cfg = test_config();
        let (_, rec) = apply_penalty(&p, PENALTY_FAILED_REVEAL, 100, 5000, &cfg).unwrap();
        assert_eq!(rec.address_hash, 1);
        assert_eq!(rec.penalty_type, PENALTY_FAILED_REVEAL);
        assert_eq!(rec.applied_at, 5000);
    }

    #[test]
    fn test_apply_penalty_zero_amount_error() {
        let p = profile_with_scores(1, 500, 0, 0, 0);
        let cfg = test_config();
        let r = apply_penalty(&p, PENALTY_FAILED_REVEAL, 0, 5000, &cfg);
        assert!(r.is_err());
    }

    #[test]
    fn test_apply_penalty_increments_count() {
        let p = profile_with_scores(1, 500, 0, 0, 0);
        let cfg = test_config();
        let (r, _) = apply_penalty(&p, PENALTY_SPAM, 50, 5000, &cfg).unwrap();
        assert_eq!(r.penalty_count, 1);
    }

    #[test]
    fn test_apply_penalty_repeat_offender_multiplier() {
        let mut p = profile_with_scores(1, 10000, 0, 0, 0);
        p.penalty_count = 2; // repeat offender
        let cfg = test_config();
        let (_, rec) = apply_penalty(&p, PENALTY_SPAM, 100, 5000, &cfg).unwrap();
        // multiplier = 20000 bps = 2x, so effective = 200
        assert_eq!(rec.amount, 200);
    }

    #[test]
    fn test_apply_penalty_cooldown_set() {
        let p = profile_with_scores(1, 500, 0, 0, 0);
        let cfg = test_config();
        let (_, rec) = apply_penalty(&p, PENALTY_FAILED_REVEAL, 100, 5000, &cfg).unwrap();
        assert_eq!(rec.cooldown_until, 5000 + cfg.cooldown_blocks);
    }

    #[test]
    fn test_apply_penalty_proportional_deduction() {
        let p = profile_with_scores(1, 600, 400, 0, 0);
        let cfg = test_config();
        let (r, _) = apply_penalty(&p, PENALTY_SPAM, 100, 5000, &cfg).unwrap();
        // Trading had 60%, governance 40% — deduction should be proportional
        assert!(r.trading_score < 600);
        assert!(r.governance_score < 400);
    }

    #[test]
    fn test_apply_penalty_updates_trust_tier() {
        let mut p = profile_with_scores(1, 5000, 0, 0, 0);
        p.trust_tier = TIER_ELITE;
        let cfg = test_config();
        let (r, _) = apply_penalty(&p, PENALTY_MANIPULATION, 4500, 5000, &cfg).unwrap();
        assert!(r.trust_tier < TIER_ELITE);
    }

    #[test]
    fn test_apply_penalty_on_zero_score() {
        let p = create_profile(1, 100);
        let cfg = test_config();
        let (r, _) = apply_penalty(&p, PENALTY_SPAM, 100, 5000, &cfg).unwrap();
        assert_eq!(r.total_score, 0);
    }

    #[test]
    fn test_apply_penalty_large_amount_capped() {
        let p = profile_with_scores(1, 100, 0, 0, 0);
        let cfg = test_config();
        let (r, _) = apply_penalty(&p, PENALTY_MANIPULATION, 99999, 5000, &cfg).unwrap();
        assert_eq!(r.total_score, 0); // can't go below zero
    }

    // ============ Cooldown and Recovery Tests ============

    #[test]
    fn test_is_in_cooldown_active() {
        let rec = PenaltyRecord {
            address_hash: 1,
            penalty_type: PENALTY_SPAM,
            amount: 100,
            applied_at: 1000,
            cooldown_until: 2000,
            recovered: false,
        };
        assert!(is_in_cooldown(&rec, 1500));
    }

    #[test]
    fn test_is_in_cooldown_expired() {
        let rec = PenaltyRecord {
            address_hash: 1,
            penalty_type: PENALTY_SPAM,
            amount: 100,
            applied_at: 1000,
            cooldown_until: 2000,
            recovered: false,
        };
        assert!(!is_in_cooldown(&rec, 2000));
    }

    #[test]
    fn test_is_in_cooldown_already_recovered() {
        let rec = PenaltyRecord {
            address_hash: 1,
            penalty_type: PENALTY_SPAM,
            amount: 100,
            applied_at: 1000,
            cooldown_until: 2000,
            recovered: true,
        };
        assert!(!is_in_cooldown(&rec, 1500));
    }

    #[test]
    fn test_check_recovery_possible() {
        let rec = PenaltyRecord {
            address_hash: 1,
            penalty_type: PENALTY_SPAM,
            amount: 100,
            applied_at: 1000,
            cooldown_until: 2000,
            recovered: false,
        };
        assert!(check_recovery(&rec, 2000));
        assert!(check_recovery(&rec, 3000));
    }

    #[test]
    fn test_check_recovery_still_in_cooldown() {
        let rec = PenaltyRecord {
            address_hash: 1,
            penalty_type: PENALTY_SPAM,
            amount: 100,
            applied_at: 1000,
            cooldown_until: 2000,
            recovered: false,
        };
        assert!(!check_recovery(&rec, 1999));
    }

    #[test]
    fn test_check_recovery_already_recovered() {
        let rec = PenaltyRecord {
            address_hash: 1,
            penalty_type: PENALTY_SPAM,
            amount: 100,
            applied_at: 1000,
            cooldown_until: 2000,
            recovered: true,
        };
        assert!(!check_recovery(&rec, 5000));
    }

    #[test]
    fn test_apply_recovery_success() {
        let p = profile_with_scores(1, 100, 0, 0, 0);
        let rec = PenaltyRecord {
            address_hash: 1,
            penalty_type: PENALTY_SPAM,
            amount: 400,
            applied_at: 1000,
            cooldown_until: 2000,
            recovered: false,
        };
        let cfg = test_config();
        let r = apply_recovery(&p, &rec, 2100, &cfg).unwrap();
        // Recovery: 400 * 50bps * 100 blocks / 10000 = 200 total, 50 per category
        assert!(r.total_score > 100);
    }

    #[test]
    fn test_apply_recovery_still_in_cooldown_error() {
        let p = profile_with_scores(1, 100, 0, 0, 0);
        let rec = PenaltyRecord {
            address_hash: 1,
            penalty_type: PENALTY_SPAM,
            amount: 400,
            applied_at: 1000,
            cooldown_until: 2000,
            recovered: false,
        };
        let cfg = test_config();
        let r = apply_recovery(&p, &rec, 1500, &cfg);
        assert!(r.is_err());
    }

    #[test]
    fn test_apply_recovery_already_recovered_error() {
        let p = profile_with_scores(1, 100, 0, 0, 0);
        let rec = PenaltyRecord {
            address_hash: 1,
            penalty_type: PENALTY_SPAM,
            amount: 400,
            applied_at: 1000,
            cooldown_until: 2000,
            recovered: true,
        };
        let cfg = test_config();
        let r = apply_recovery(&p, &rec, 3000, &cfg);
        assert!(r.is_err());
    }

    #[test]
    fn test_apply_recovery_at_cooldown_boundary() {
        let p = profile_with_scores(1, 100, 0, 0, 0);
        let rec = PenaltyRecord {
            address_hash: 1,
            penalty_type: PENALTY_SPAM,
            amount: 400,
            applied_at: 1000,
            cooldown_until: 2000,
            recovered: false,
        };
        let cfg = test_config();
        // At exactly cooldown_until, 0 blocks since = 0 recovery
        let r = apply_recovery(&p, &rec, 2000, &cfg).unwrap();
        assert_eq!(r.total_score, 100); // no recovery yet
    }

    #[test]
    fn test_apply_recovery_capped_at_penalty_amount() {
        let p = profile_with_scores(1, 100, 0, 0, 0);
        let rec = PenaltyRecord {
            address_hash: 1,
            penalty_type: PENALTY_SPAM,
            amount: 100,
            applied_at: 1000,
            cooldown_until: 2000,
            recovered: false,
        };
        let cfg = test_config();
        // Very large elapsed — recovery should cap at penalty.amount
        let r = apply_recovery(&p, &rec, 1_000_000, &cfg).unwrap();
        // 100 / 4 categories = 25 each
        assert_eq!(r.trading_score, 125);
    }

    // ============ Sybil Detection Tests ============

    #[test]
    fn test_detect_rapid_creation_no_data() {
        let r = detect_rapid_creation(&[], 1000, 3);
        assert!(r.is_empty());
    }

    #[test]
    fn test_detect_rapid_creation_below_threshold() {
        let times = vec![(1, 100), (2, 200)];
        let r = detect_rapid_creation(&times, 1000, 5);
        assert!(r.is_empty());
    }

    #[test]
    fn test_detect_rapid_creation_above_threshold() {
        let times = vec![(1, 100), (2, 105), (3, 110), (4, 115), (5, 120)];
        let r = detect_rapid_creation(&times, 50, 3);
        assert!(!r.is_empty());
    }

    #[test]
    fn test_detect_rapid_creation_spread_out() {
        let times = vec![(1, 100), (2, 10000), (3, 20000)];
        let r = detect_rapid_creation(&times, 50, 3);
        assert!(r.is_empty());
    }

    #[test]
    fn test_detect_rapid_creation_exact_threshold() {
        let times = vec![(1, 100), (2, 110), (3, 120)];
        let r = detect_rapid_creation(&times, 100, 3);
        assert!(!r.is_empty());
        assert_eq!(r.len(), 3);
    }

    #[test]
    fn test_detect_rapid_creation_zero_window() {
        let times = vec![(1, 100), (2, 100)];
        let r = detect_rapid_creation(&times, 0, 1);
        assert!(r.is_empty());
    }

    #[test]
    fn test_detect_rapid_creation_zero_threshold() {
        let times = vec![(1, 100)];
        let r = detect_rapid_creation(&times, 1000, 0);
        assert!(r.is_empty());
    }

    #[test]
    fn test_detect_rapid_creation_indicator_type() {
        let times = vec![(1, 100), (2, 101), (3, 102)];
        let r = detect_rapid_creation(&times, 10, 2);
        assert!(r.iter().all(|i| i.indicator_type == SYBIL_RAPID_CREATION));
    }

    #[test]
    fn test_detect_correlated_behavior_identical() {
        let a = vec![100, 200, 300, 400, 500];
        let b = vec![100, 200, 300, 400, 500];
        assert!(detect_correlated_behavior(&a, &b, 5000));
    }

    #[test]
    fn test_detect_correlated_behavior_no_correlation() {
        let a = vec![100, 200, 300];
        let b = vec![10000, 20000, 30000];
        assert!(!detect_correlated_behavior(&a, &b, 5000));
    }

    #[test]
    fn test_detect_correlated_behavior_empty_a() {
        let a: Vec<u64> = vec![];
        let b = vec![100, 200];
        assert!(!detect_correlated_behavior(&a, &b, 5000));
    }

    #[test]
    fn test_detect_correlated_behavior_empty_b() {
        let a = vec![100, 200];
        let b: Vec<u64> = vec![];
        assert!(!detect_correlated_behavior(&a, &b, 5000));
    }

    #[test]
    fn test_detect_correlated_behavior_close_timestamps() {
        let a = vec![100, 200, 300];
        let b = vec![105, 195, 308];
        assert!(detect_correlated_behavior(&a, &b, 5000));
    }

    #[test]
    fn test_detect_correlated_behavior_high_threshold() {
        let a = vec![100, 200, 300];
        let b = vec![105, 195, 308];
        // All within tolerance but threshold is 100%
        assert!(detect_correlated_behavior(&a, &b, 10000));
    }

    #[test]
    fn test_calculate_sybil_risk_empty() {
        assert_eq!(calculate_sybil_risk_score(&[]), 0);
    }

    #[test]
    fn test_calculate_sybil_risk_single_indicator() {
        let ind = vec![SybilIndicator {
            address_hash: 1,
            indicator_type: SYBIL_RAPID_CREATION,
            score: 500,
            detected_at: 1000,
        }];
        let r = calculate_sybil_risk_score(&ind);
        assert!(r > 0);
        assert!(r <= BPS_DENOMINATOR);
    }

    #[test]
    fn test_calculate_sybil_risk_multiple_indicators() {
        let inds = vec![
            SybilIndicator { address_hash: 1, indicator_type: SYBIL_RAPID_CREATION, score: 100, detected_at: 1000 },
            SybilIndicator { address_hash: 1, indicator_type: SYBIL_CORRELATED_BEHAVIOR, score: 200, detected_at: 1000 },
            SybilIndicator { address_hash: 1, indicator_type: SYBIL_LOW_AGE_HIGH_ACTIVITY, score: 300, detected_at: 1000 },
        ];
        let r = calculate_sybil_risk_score(&inds);
        assert!(r > 0);
    }

    #[test]
    fn test_calculate_sybil_risk_capped_at_bps() {
        let inds: Vec<SybilIndicator> = (0..20).map(|i| SybilIndicator {
            address_hash: i,
            indicator_type: SYBIL_RAPID_CREATION,
            score: 50000,
            detected_at: 1000,
        }).collect();
        let r = calculate_sybil_risk_score(&inds);
        assert_eq!(r, BPS_DENOMINATOR);
    }

    // ============ Access Control Tests ============

    #[test]
    fn test_check_access_passes() {
        let mut p = profile_with_scores(1, 1000, 1000, 1000, 1000);
        p.trust_tier = TIER_VERIFIED;
        p.created_at = 100;
        let gate = AccessGate {
            feature_hash: 1,
            required_tier: TIER_BASIC,
            required_score: 1000,
            required_age_blocks: 100,
        };
        assert!(check_access(&p, &gate, 300).unwrap());
    }

    #[test]
    fn test_check_access_fails_tier() {
        let mut p = profile_with_scores(1, 1000, 1000, 1000, 1000);
        p.trust_tier = TIER_UNTRUSTED;
        p.created_at = 100;
        let gate = AccessGate {
            feature_hash: 1,
            required_tier: TIER_ELITE,
            required_score: 0,
            required_age_blocks: 0,
        };
        assert!(!check_access(&p, &gate, 200).unwrap());
    }

    #[test]
    fn test_check_access_fails_score() {
        let mut p = profile_with_scores(1, 10, 0, 0, 0);
        p.trust_tier = TIER_GUARDIAN;
        p.created_at = 100;
        let gate = AccessGate {
            feature_hash: 1,
            required_tier: TIER_UNTRUSTED,
            required_score: 1000,
            required_age_blocks: 0,
        };
        assert!(!check_access(&p, &gate, 200).unwrap());
    }

    #[test]
    fn test_check_access_fails_age() {
        let mut p = profile_with_scores(1, 1000, 1000, 1000, 1000);
        p.trust_tier = TIER_GUARDIAN;
        p.created_at = 100;
        let gate = AccessGate {
            feature_hash: 1,
            required_tier: TIER_UNTRUSTED,
            required_score: 0,
            required_age_blocks: 5000,
        };
        assert!(!check_access(&p, &gate, 200).unwrap());
    }

    #[test]
    fn test_check_access_error_future_creation() {
        let mut p = create_profile(1, 500);
        p.created_at = 500;
        let gate = AccessGate {
            feature_hash: 1,
            required_tier: TIER_UNTRUSTED,
            required_score: 0,
            required_age_blocks: 0,
        };
        let r = check_access(&p, &gate, 100);
        assert!(r.is_err());
    }

    #[test]
    fn test_check_access_exact_requirements() {
        let mut p = profile_with_scores(1, 500, 0, 0, 0);
        p.trust_tier = TIER_VERIFIED;
        p.created_at = 0;
        let gate = AccessGate {
            feature_hash: 1,
            required_tier: TIER_VERIFIED,
            required_score: 500,
            required_age_blocks: 100,
        };
        assert!(check_access(&p, &gate, 100).unwrap());
    }

    #[test]
    fn test_check_access_zero_requirements() {
        let p = create_profile(1, 0);
        let gate = AccessGate {
            feature_hash: 1,
            required_tier: TIER_UNTRUSTED,
            required_score: 0,
            required_age_blocks: 0,
        };
        assert!(check_access(&p, &gate, 0).unwrap());
    }

    // ============ Progressive Unlock Tests ============

    #[test]
    fn test_progressive_unlock_no_gates() {
        let p = profile_with_scores(1, 1000, 0, 0, 0);
        assert_eq!(progressive_unlock_level(&p, &[], 1000), 0);
    }

    #[test]
    fn test_progressive_unlock_passes_all() {
        let mut p = profile_with_scores(1, 10000, 10000, 10000, 10000);
        p.trust_tier = TIER_GUARDIAN;
        p.created_at = 0;
        let gates = vec![
            AccessGate { feature_hash: 1, required_tier: TIER_BASIC, required_score: 100, required_age_blocks: 0 },
            AccessGate { feature_hash: 2, required_tier: TIER_VERIFIED, required_score: 500, required_age_blocks: 0 },
            AccessGate { feature_hash: 3, required_tier: TIER_TRUSTED, required_score: 2000, required_age_blocks: 0 },
        ];
        assert_eq!(progressive_unlock_level(&p, &gates, 1000), 3);
    }

    #[test]
    fn test_progressive_unlock_partial() {
        let mut p = profile_with_scores(1, 300, 0, 0, 0);
        p.trust_tier = TIER_BASIC;
        p.created_at = 0;
        let gates = vec![
            AccessGate { feature_hash: 1, required_tier: TIER_BASIC, required_score: 100, required_age_blocks: 0 },
            AccessGate { feature_hash: 2, required_tier: TIER_ELITE, required_score: 5000, required_age_blocks: 0 },
        ];
        assert_eq!(progressive_unlock_level(&p, &gates, 1000), 1);
    }

    #[test]
    fn test_progressive_unlock_none() {
        let p = create_profile(1, 0);
        let gates = vec![
            AccessGate { feature_hash: 1, required_tier: TIER_BASIC, required_score: 100, required_age_blocks: 0 },
        ];
        assert_eq!(progressive_unlock_level(&p, &gates, 0), 0);
    }

    // ============ Reputation Weight Tests ============

    #[test]
    fn test_reputation_weight_zero_score() {
        let p = create_profile(1, 100);
        assert_eq!(calculate_reputation_weight(&p, 10000), 0);
    }

    #[test]
    fn test_reputation_weight_max_score() {
        let p = profile_with_scores(1, DEFAULT_MAX_SCORE, 0, 0, 0);
        assert_eq!(calculate_reputation_weight(&p, 10000), 10000);
    }

    #[test]
    fn test_reputation_weight_half_score() {
        let p = profile_with_scores(1, DEFAULT_MAX_SCORE / 2, 0, 0, 0);
        let w = calculate_reputation_weight(&p, 10000);
        assert_eq!(w, 5000);
    }

    #[test]
    fn test_reputation_weight_capped() {
        let p = profile_with_scores(1, DEFAULT_MAX_SCORE * 2, 0, 0, 0);
        assert_eq!(calculate_reputation_weight(&p, 10000), 10000);
    }

    #[test]
    fn test_reputation_weight_zero_max() {
        let p = profile_with_scores(1, 1000, 0, 0, 0);
        assert_eq!(calculate_reputation_weight(&p, 0), 0);
    }

    #[test]
    fn test_reputation_weight_custom_max() {
        let p = profile_with_scores(1, DEFAULT_MAX_SCORE, 0, 0, 0);
        assert_eq!(calculate_reputation_weight(&p, 5000), 5000);
    }

    // ============ Percentile Tests ============

    #[test]
    fn test_percentile_empty_scores() {
        assert_eq!(get_reputation_percentile(100, &[]), 0);
    }

    #[test]
    fn test_percentile_highest_score() {
        let scores = vec![10, 20, 30, 40, 50];
        let p = get_reputation_percentile(50, &scores);
        assert_eq!(p, 8000); // 4/5 = 80%
    }

    #[test]
    fn test_percentile_lowest_score() {
        let scores = vec![10, 20, 30, 40, 50];
        let p = get_reputation_percentile(10, &scores);
        assert_eq!(p, 0); // 0/5 = 0%
    }

    #[test]
    fn test_percentile_middle_score() {
        let scores = vec![10, 20, 30, 40, 50];
        let p = get_reputation_percentile(30, &scores);
        assert_eq!(p, 4000); // 2/5 = 40%
    }

    #[test]
    fn test_percentile_above_all() {
        let scores = vec![10, 20, 30];
        let p = get_reputation_percentile(100, &scores);
        assert_eq!(p, 10000); // 3/3 = 100%
    }

    #[test]
    fn test_percentile_below_all() {
        let scores = vec![10, 20, 30];
        let p = get_reputation_percentile(5, &scores);
        assert_eq!(p, 0);
    }

    #[test]
    fn test_percentile_single_score() {
        let scores = vec![50];
        assert_eq!(get_reputation_percentile(50, &scores), 0);
        assert_eq!(get_reputation_percentile(100, &scores), 10000);
    }

    // ============ Merge & Rank Tests ============

    #[test]
    fn test_merge_profiles_empty() {
        let r = merge_profiles(&[]);
        assert_eq!(r.total_score, 0);
    }

    #[test]
    fn test_merge_profiles_single() {
        let p = profile_with_scores(1, 100, 200, 300, 400);
        let r = merge_profiles(&[p]);
        assert_eq!(r.total_score, 1000);
    }

    #[test]
    fn test_merge_profiles_multiple() {
        let p1 = profile_with_scores(1, 100, 0, 0, 0);
        let p2 = profile_with_scores(2, 0, 200, 0, 0);
        let r = merge_profiles(&[p1, p2]);
        assert_eq!(r.trading_score, 100);
        assert_eq!(r.governance_score, 200);
        assert_eq!(r.total_score, 300);
    }

    #[test]
    fn test_merge_profiles_takes_latest_timestamp() {
        let mut p1 = profile_with_scores(1, 100, 0, 0, 0);
        p1.last_updated = 500;
        let mut p2 = profile_with_scores(2, 200, 0, 0, 0);
        p2.last_updated = 1000;
        let r = merge_profiles(&[p1, p2]);
        assert_eq!(r.last_updated, 1000);
    }

    #[test]
    fn test_merge_profiles_takes_earliest_creation() {
        let mut p1 = profile_with_scores(1, 100, 0, 0, 0);
        p1.created_at = 500;
        let mut p2 = profile_with_scores(2, 200, 0, 0, 0);
        p2.created_at = 200;
        let r = merge_profiles(&[p1, p2]);
        assert_eq!(r.created_at, 200);
    }

    #[test]
    fn test_merge_profiles_sums_penalties() {
        let mut p1 = profile_with_scores(1, 100, 0, 0, 0);
        p1.penalty_count = 2;
        let mut p2 = profile_with_scores(2, 200, 0, 0, 0);
        p2.penalty_count = 3;
        let r = merge_profiles(&[p1, p2]);
        assert_eq!(r.penalty_count, 5);
    }

    #[test]
    fn test_rank_by_reputation_sorted() {
        let profiles = vec![
            profile_with_scores(1, 100, 0, 0, 0),
            profile_with_scores(2, 500, 0, 0, 0),
            profile_with_scores(3, 200, 0, 0, 0),
        ];
        let ranked = rank_by_reputation(&profiles);
        assert_eq!(ranked[0], (2, 500));
        assert_eq!(ranked[1], (3, 200));
        assert_eq!(ranked[2], (1, 100));
    }

    #[test]
    fn test_rank_by_reputation_empty() {
        let ranked = rank_by_reputation(&[]);
        assert!(ranked.is_empty());
    }

    #[test]
    fn test_rank_by_reputation_equal_scores() {
        let profiles = vec![
            profile_with_scores(5, 100, 0, 0, 0),
            profile_with_scores(3, 100, 0, 0, 0),
        ];
        let ranked = rank_by_reputation(&profiles);
        // Tiebreak by address ascending
        assert_eq!(ranked[0].0, 3);
        assert_eq!(ranked[1].0, 5);
    }

    // ============ Batch Decay Tests ============

    #[test]
    fn test_batch_apply_decay_empty() {
        let cfg = test_config();
        let r = batch_apply_decay(&[], 10, &cfg);
        assert!(r.is_empty());
    }

    #[test]
    fn test_batch_apply_decay_multiple() {
        let profiles = vec![
            profile_with_scores(1, 1000, 0, 0, 0),
            profile_with_scores(2, 2000, 0, 0, 0),
        ];
        let cfg = test_config();
        let r = batch_apply_decay(&profiles, 1, &cfg);
        assert_eq!(r.len(), 2);
        assert_eq!(r[0].trading_score, 990);
        assert_eq!(r[1].trading_score, 1980);
    }

    // ============ Category Breakdown Tests ============

    #[test]
    fn test_category_breakdown_all_zero() {
        let p = create_profile(1, 100);
        let bd = calculate_category_breakdown(&p);
        assert_eq!(bd.len(), 4);
        assert!(bd.iter().all(|(_, s)| *s == 0));
    }

    #[test]
    fn test_category_breakdown_mixed() {
        let p = profile_with_scores(1, 100, 200, 300, 400);
        let bd = calculate_category_breakdown(&p);
        assert_eq!(bd[0], (CATEGORY_TRADING, 100));
        assert_eq!(bd[1], (CATEGORY_GOVERNANCE, 200));
        assert_eq!(bd[2], (CATEGORY_LIQUIDITY, 300));
        assert_eq!(bd[3], (CATEGORY_SOCIAL, 400));
    }

    // ============ Effective Score Tests ============

    #[test]
    fn test_effective_score_no_penalties() {
        let p = profile_with_scores(1, 1000, 0, 0, 0);
        assert_eq!(calculate_effective_score(&p, &[]), 1000);
    }

    #[test]
    fn test_effective_score_with_active_penalty() {
        let p = profile_with_scores(1, 1000, 0, 0, 0);
        let penalties = vec![PenaltyRecord {
            address_hash: 1,
            penalty_type: PENALTY_SPAM,
            amount: 300,
            applied_at: 100,
            cooldown_until: 2000,
            recovered: false,
        }];
        assert_eq!(calculate_effective_score(&p, &penalties), 700);
    }

    #[test]
    fn test_effective_score_with_recovered_penalty() {
        let p = profile_with_scores(1, 1000, 0, 0, 0);
        let penalties = vec![PenaltyRecord {
            address_hash: 1,
            penalty_type: PENALTY_SPAM,
            amount: 300,
            applied_at: 100,
            cooldown_until: 2000,
            recovered: true,
        }];
        assert_eq!(calculate_effective_score(&p, &penalties), 1000);
    }

    #[test]
    fn test_effective_score_multiple_penalties() {
        let p = profile_with_scores(1, 1000, 0, 0, 0);
        let penalties = vec![
            PenaltyRecord { address_hash: 1, penalty_type: PENALTY_SPAM, amount: 200, applied_at: 100, cooldown_until: 2000, recovered: false },
            PenaltyRecord { address_hash: 1, penalty_type: PENALTY_SPAM, amount: 300, applied_at: 200, cooldown_until: 3000, recovered: false },
        ];
        assert_eq!(calculate_effective_score(&p, &penalties), 500);
    }

    #[test]
    fn test_effective_score_penalty_exceeds_score() {
        let p = profile_with_scores(1, 100, 0, 0, 0);
        let penalties = vec![PenaltyRecord {
            address_hash: 1,
            penalty_type: PENALTY_SPAM,
            amount: 500,
            applied_at: 100,
            cooldown_until: 2000,
            recovered: false,
        }];
        assert_eq!(calculate_effective_score(&p, &penalties), 0);
    }

    // ============ Time-to-Tier Estimation Tests ============

    #[test]
    fn test_estimate_time_already_at_tier() {
        let p = profile_with_scores(1, 5000, 0, 0, 0);
        let cfg = test_config();
        assert_eq!(estimate_time_to_tier(&p, TIER_ELITE, 10, &cfg), 0);
    }

    #[test]
    fn test_estimate_time_zero_events() {
        let p = create_profile(1, 100);
        let cfg = test_config();
        assert_eq!(estimate_time_to_tier(&p, TIER_BASIC, 0, &cfg), u64::MAX);
    }

    #[test]
    fn test_estimate_time_simple() {
        let p = create_profile(1, 100);
        let mut cfg = test_config();
        cfg.decay_rate_bps = 0; // no decay for simple test
        let t = estimate_time_to_tier(&p, TIER_BASIC, 10, &cfg);
        // Need 100 points, 10/day, 0 decay = 10 days
        assert_eq!(t, 10);
    }

    #[test]
    fn test_estimate_time_empty_thresholds() {
        let p = create_profile(1, 100);
        let mut cfg = test_config();
        cfg.tier_thresholds = vec![];
        assert_eq!(estimate_time_to_tier(&p, TIER_BASIC, 10, &cfg), 0);
    }

    #[test]
    fn test_estimate_time_tier_out_of_range() {
        let p = create_profile(1, 100);
        let cfg = test_config();
        assert_eq!(estimate_time_to_tier(&p, 20, 10, &cfg), u64::MAX);
    }

    // ============ Config Validation Tests ============

    #[test]
    fn test_validate_config_default_ok() {
        let cfg = default_config();
        assert!(validate_config(&cfg).is_ok());
    }

    #[test]
    fn test_validate_config_decay_too_high() {
        let mut cfg = default_config();
        cfg.decay_rate_bps = BPS_DENOMINATOR + 1;
        assert!(validate_config(&cfg).is_err());
    }

    #[test]
    fn test_validate_config_zero_max_score() {
        let mut cfg = default_config();
        cfg.max_score = 0;
        assert!(validate_config(&cfg).is_err());
    }

    #[test]
    fn test_validate_config_min_exceeds_max() {
        let mut cfg = default_config();
        cfg.min_score = 1000;
        cfg.max_score = 500;
        assert!(validate_config(&cfg).is_err());
    }

    #[test]
    fn test_validate_config_empty_thresholds() {
        let mut cfg = default_config();
        cfg.tier_thresholds = vec![];
        assert!(validate_config(&cfg).is_err());
    }

    #[test]
    fn test_validate_config_unsorted_thresholds() {
        let mut cfg = default_config();
        cfg.tier_thresholds = vec![100, 50, 200];
        assert!(validate_config(&cfg).is_err());
    }

    #[test]
    fn test_validate_config_recovery_too_high() {
        let mut cfg = default_config();
        cfg.recovery_rate_bps = BPS_DENOMINATOR + 1;
        assert!(validate_config(&cfg).is_err());
    }

    // ============ Clamp and Utility Tests ============

    #[test]
    fn test_clamp_scores_within_bounds() {
        let p = profile_with_scores(1, 100, 200, 300, 400);
        let cfg = test_config();
        let r = clamp_scores(&p, &cfg);
        assert_eq!(r.trading_score, 100);
    }

    #[test]
    fn test_clamp_scores_exceeding_max() {
        let p = profile_with_scores(1, DEFAULT_MAX_SCORE + 1000, 0, 0, 0);
        let cfg = test_config();
        let r = clamp_scores(&p, &cfg);
        assert_eq!(r.trading_score, DEFAULT_MAX_SCORE);
    }

    #[test]
    fn test_profile_age_calculation() {
        let p = create_profile(1, 100);
        assert_eq!(profile_age(&p, 500), 400);
    }

    #[test]
    fn test_profile_age_at_creation() {
        let p = create_profile(1, 100);
        assert_eq!(profile_age(&p, 100), 0);
    }

    #[test]
    fn test_profile_age_before_creation() {
        let p = create_profile(1, 500);
        assert_eq!(profile_age(&p, 100), 0); // saturating sub
    }

    #[test]
    fn test_is_active_recently_updated() {
        let mut p = create_profile(1, 100);
        p.last_updated = 900;
        assert!(is_active(&p, 1000, 200));
    }

    #[test]
    fn test_is_active_stale() {
        let mut p = create_profile(1, 100);
        p.last_updated = 100;
        assert!(!is_active(&p, 1000, 200));
    }

    #[test]
    fn test_is_active_exact_boundary() {
        let mut p = create_profile(1, 100);
        p.last_updated = 800;
        assert!(is_active(&p, 1000, 200));
    }

    // ============ Tier Distribution Tests ============

    #[test]
    fn test_tier_distribution_empty() {
        let d = tier_distribution(&[]);
        assert_eq!(d.len(), 6);
        assert!(d.iter().all(|(_, c)| *c == 0));
    }

    #[test]
    fn test_tier_distribution_all_untrusted() {
        let profiles: Vec<ReputationProfile> = (0..5).map(|i| create_profile(i, 100)).collect();
        let d = tier_distribution(&profiles);
        assert_eq!(d[0], (TIER_UNTRUSTED, 5));
    }

    #[test]
    fn test_tier_distribution_mixed() {
        let mut profiles = vec![
            create_profile(1, 100),
            create_profile(2, 100),
        ];
        profiles[0].trust_tier = TIER_BASIC;
        profiles[1].trust_tier = TIER_GUARDIAN;
        let d = tier_distribution(&profiles);
        assert_eq!(d[1], (TIER_BASIC, 1));
        assert_eq!(d[5], (TIER_GUARDIAN, 1));
    }

    // ============ Filter by Tier Tests ============

    #[test]
    fn test_filter_by_tier_none_pass() {
        let profiles: Vec<ReputationProfile> = (0..3).map(|i| create_profile(i, 100)).collect();
        let r = filter_by_tier(&profiles, TIER_BASIC);
        assert!(r.is_empty());
    }

    #[test]
    fn test_filter_by_tier_all_pass() {
        let mut profiles: Vec<ReputationProfile> = (0..3).map(|i| create_profile(i, 100)).collect();
        for p in profiles.iter_mut() { p.trust_tier = TIER_GUARDIAN; }
        let r = filter_by_tier(&profiles, TIER_BASIC);
        assert_eq!(r.len(), 3);
    }

    #[test]
    fn test_filter_by_tier_some_pass() {
        let mut profiles: Vec<ReputationProfile> = (0..4).map(|i| create_profile(i, 100)).collect();
        profiles[0].trust_tier = TIER_UNTRUSTED;
        profiles[1].trust_tier = TIER_BASIC;
        profiles[2].trust_tier = TIER_VERIFIED;
        profiles[3].trust_tier = TIER_TRUSTED;
        let r = filter_by_tier(&profiles, TIER_VERIFIED);
        assert_eq!(r.len(), 2);
    }

    // ============ Make Event Helper Tests ============

    #[test]
    fn test_make_event_fields() {
        let e = make_event(42, 7, -100, CATEGORY_GOVERNANCE, 9999);
        assert_eq!(e.address_hash, 42);
        assert_eq!(e.event_type, 7);
        assert_eq!(e.delta, -100);
        assert_eq!(e.category, CATEGORY_GOVERNANCE);
        assert_eq!(e.timestamp, 9999);
        assert_eq!(e.details_hash, 0);
    }

    // ============ Edge Case Tests ============

    #[test]
    fn test_apply_delta_positive_overflow() {
        let r = apply_delta(u64::MAX - 10, 100);
        assert_eq!(r, u64::MAX);
    }

    #[test]
    fn test_apply_delta_negative_underflow() {
        let r = apply_delta(5, -100);
        assert_eq!(r, 0);
    }

    #[test]
    fn test_apply_delta_zero() {
        let r = apply_delta(500, 0);
        assert_eq!(r, 500);
    }

    #[test]
    fn test_compute_decay_factor_zero_elapsed() {
        let f = compute_decay_factor(0, 100);
        assert_eq!(f, BPS_DENOMINATOR);
    }

    #[test]
    fn test_compute_decay_factor_full_rate() {
        let f = compute_decay_factor(1, BPS_DENOMINATOR);
        assert_eq!(f, 0);
    }

    #[test]
    fn test_compute_decay_factor_one_block() {
        let f = compute_decay_factor(1, 100);
        assert_eq!(f, 9900);
    }

    #[test]
    fn test_apply_decay_factor_zero_score() {
        assert_eq!(apply_decay_factor(0, 5000), 0);
    }

    #[test]
    fn test_apply_decay_factor_full_retention() {
        assert_eq!(apply_decay_factor(1000, BPS_DENOMINATOR), 1000);
    }

    #[test]
    fn test_apply_decay_factor_half_retention() {
        assert_eq!(apply_decay_factor(1000, 5000), 500);
    }

    // ============ Integration / Scenario Tests ============

    #[test]
    fn test_full_lifecycle_new_user() {
        let cfg = test_config();
        // Create profile
        let p = create_profile(1, 0);
        assert_eq!(p.trust_tier, TIER_UNTRUSTED);

        // Record some trading events
        let e1 = make_event(1, 0, 200, CATEGORY_TRADING, 100);
        let p = record_event(&p, &e1).unwrap();
        assert_eq!(p.trading_score, 200);

        // Determine tier
        let tier = determine_trust_tier(p.total_score, &cfg);
        assert_eq!(tier, TIER_BASIC);
    }

    #[test]
    fn test_full_lifecycle_penalty_and_recovery() {
        let cfg = test_config();
        let p = profile_with_scores(1, 3000, 0, 0, 0);

        // Apply penalty
        let (p, rec) = apply_penalty(&p, PENALTY_FAILED_REVEAL, 500, 1000, &cfg).unwrap();
        assert!(p.total_score < 3000);
        assert!(is_in_cooldown(&rec, 1500));

        // Try recovery during cooldown
        let r = apply_recovery(&p, &rec, 1500, &cfg);
        assert!(r.is_err());

        // Recovery after cooldown
        let r = apply_recovery(&p, &rec, 2100, &cfg);
        assert!(r.is_ok());
    }

    #[test]
    fn test_full_lifecycle_access_gates() {
        let cfg = test_config();
        let mut p = profile_with_scores(1, 1000, 500, 200, 100);
        p.created_at = 0;
        p.trust_tier = determine_trust_tier(p.total_score, &cfg);

        let gate_basic = AccessGate { feature_hash: 1, required_tier: TIER_BASIC, required_score: 100, required_age_blocks: 10 };
        let gate_elite = AccessGate { feature_hash: 2, required_tier: TIER_ELITE, required_score: 5000, required_age_blocks: 1000 };

        assert!(check_access(&p, &gate_basic, 100).unwrap());
        assert!(!check_access(&p, &gate_elite, 100).unwrap());
    }

    #[test]
    fn test_sybil_detection_scenario() {
        // Rapid creation
        let creations = vec![(1, 100), (2, 101), (3, 102), (4, 103), (5, 104)];
        let indicators = detect_rapid_creation(&creations, 10, 4);
        assert!(!indicators.is_empty());

        // Risk score
        let risk = calculate_sybil_risk_score(&indicators);
        assert!(risk > 0);
    }

    #[test]
    fn test_weighted_governance_voting_scenario() {
        let p1 = profile_with_scores(1, 10000, 0, 0, 0);
        let p2 = profile_with_scores(2, 1000, 0, 0, 0);

        let w1 = calculate_reputation_weight(&p1, 10000);
        let w2 = calculate_reputation_weight(&p2, 10000);

        // Higher reputation = more voting weight
        assert!(w1 > w2);
    }

    #[test]
    fn test_percentile_ranking_scenario() {
        let scores = vec![100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
        let p = get_reputation_percentile(500, &scores);
        assert_eq!(p, 4000); // 4 out of 10 below 500
    }

    #[test]
    fn test_decay_over_extended_period() {
        let p = profile_with_scores(1, 100_000, 0, 0, 0);
        let cfg = test_config();
        // After 100 blocks at 1% decay each
        let r = apply_decay(&p, 100, &cfg);
        // (0.99)^100 ~ 0.366 → ~36600
        assert!(r.trading_score > 30000);
        assert!(r.trading_score < 40000);
    }

    #[test]
    fn test_multiple_penalties_escalate() {
        let cfg = test_config();
        let p = profile_with_scores(1, 10000, 0, 0, 0);

        let (p, rec1) = apply_penalty(&p, PENALTY_SPAM, 100, 1000, &cfg).unwrap();
        assert_eq!(rec1.amount, 100); // first offense, no multiplier

        let (_, rec2) = apply_penalty(&p, PENALTY_SPAM, 100, 2000, &cfg).unwrap();
        assert_eq!(rec2.amount, 200); // second offense, 2x multiplier
    }

    #[test]
    fn test_batch_decay_consistency() {
        let profiles = vec![
            profile_with_scores(1, 1000, 500, 250, 125),
            profile_with_scores(2, 800, 400, 200, 100),
        ];
        let cfg = test_config();
        let results = batch_apply_decay(&profiles, 5, &cfg);

        for (original, decayed) in profiles.iter().zip(results.iter()) {
            assert!(decayed.total_score < original.total_score);
            assert_eq!(decayed.address_hash, original.address_hash);
        }
    }

    #[test]
    fn test_record_events_batch_error_propagation() {
        let p = create_profile(1, 100);
        let events = vec![
            make_event(1, 0, 10, CATEGORY_TRADING, 200),
            make_event(2, 0, 20, CATEGORY_GOVERNANCE, 300), // wrong address
        ];
        let r = record_events(&p, &events);
        assert!(r.is_err());
    }

    #[test]
    fn test_tier_upgrade_via_events() {
        let cfg = test_config();
        let p = create_profile(1, 0);
        // Add enough score for TIER_VERIFIED (500+)
        let e = make_event(1, 0, 600, CATEGORY_TRADING, 100);
        let p = record_event(&p, &e).unwrap();
        let tier = determine_trust_tier(p.total_score, &cfg);
        assert_eq!(tier, TIER_VERIFIED);
    }

    #[test]
    fn test_tier_downgrade_via_penalty() {
        let cfg = test_config();
        let mut p = profile_with_scores(1, 5500, 0, 0, 0);
        p.trust_tier = determine_trust_tier(p.total_score, &cfg);
        assert_eq!(p.trust_tier, TIER_ELITE);

        let (p, _) = apply_penalty(&p, PENALTY_MANIPULATION, 4000, 1000, &cfg).unwrap();
        assert!(p.trust_tier < TIER_ELITE);
    }

    #[test]
    fn test_correlated_behavior_partial_match() {
        let a = vec![100, 200, 300, 400, 500];
        let b = vec![100, 999, 300, 888, 500]; // 3 out of 5 match
        let correlated = detect_correlated_behavior(&a, &b, 6000); // need 60%+
        assert!(correlated);
    }

    #[test]
    fn test_correlated_behavior_below_threshold() {
        let a = vec![100, 200, 300, 400, 500];
        let b = vec![100, 999, 888, 777, 666]; // only 1 match
        let correlated = detect_correlated_behavior(&a, &b, 5000); // need 50%+
        assert!(!correlated);
    }

    #[test]
    fn test_default_config_valid() {
        let cfg = default_config();
        assert!(validate_config(&cfg).is_ok());
        assert_eq!(cfg.tier_thresholds.len(), 6);
        assert_eq!(cfg.decay_rate_bps, DEFAULT_DECAY_RATE_BPS);
    }

    #[test]
    fn test_profile_with_all_max_scores() {
        let p = profile_with_scores(1, u64::MAX / 4, u64::MAX / 4, u64::MAX / 4, u64::MAX / 4);
        let total = calculate_total_score(&p);
        // Should not overflow due to saturating add
        assert!(total > 0);
    }

    #[test]
    fn test_recovery_distributes_equally() {
        let p = profile_with_scores(1, 0, 0, 0, 0);
        let rec = PenaltyRecord {
            address_hash: 1,
            penalty_type: PENALTY_SPAM,
            amount: 4000,
            applied_at: 1000,
            cooldown_until: 2000,
            recovered: false,
        };
        let cfg = test_config();
        // 200 blocks after cooldown, recovery = 4000 * 50 * 200 / 10000 = 4000
        // Per category = 1000
        let r = apply_recovery(&p, &rec, 2200, &cfg).unwrap();
        assert_eq!(r.trading_score, 1000);
        assert_eq!(r.governance_score, 1000);
        assert_eq!(r.liquidity_score, 1000);
        assert_eq!(r.social_score, 1000);
    }

    #[test]
    fn test_progressive_unlock_with_age_requirement() {
        let mut p = profile_with_scores(1, 5000, 5000, 5000, 5000);
        p.trust_tier = TIER_GUARDIAN;
        p.created_at = 100;
        let gates = vec![
            AccessGate { feature_hash: 1, required_tier: TIER_BASIC, required_score: 0, required_age_blocks: 0 },
            AccessGate { feature_hash: 2, required_tier: TIER_BASIC, required_score: 0, required_age_blocks: 1000 },
        ];
        // At block 200, age is only 100 — fails gate 2
        assert_eq!(progressive_unlock_level(&p, &gates, 200), 1);
        // At block 1200, age is 1100 — passes gate 2
        assert_eq!(progressive_unlock_level(&p, &gates, 1200), 2);
    }

    #[test]
    fn test_decay_with_zero_score_remains_zero() {
        let p = create_profile(1, 100);
        let cfg = test_config();
        let r = apply_decay(&p, 100, &cfg);
        assert_eq!(r.total_score, 0);
    }

    #[test]
    fn test_weighted_score_governance_only() {
        let w = [0, 10000, 0, 0];
        let r = calculate_weighted_score(1000, 500, 2000, 3000, &w);
        assert_eq!(r, 500);
    }

    #[test]
    fn test_effective_score_mixed_recovered_and_active() {
        let p = profile_with_scores(1, 1000, 0, 0, 0);
        let penalties = vec![
            PenaltyRecord { address_hash: 1, penalty_type: PENALTY_SPAM, amount: 100, applied_at: 100, cooldown_until: 200, recovered: true },
            PenaltyRecord { address_hash: 1, penalty_type: PENALTY_SPAM, amount: 200, applied_at: 300, cooldown_until: 400, recovered: false },
            PenaltyRecord { address_hash: 1, penalty_type: PENALTY_SPAM, amount: 300, applied_at: 500, cooldown_until: 600, recovered: true },
        ];
        // Only 200 is active (not recovered)
        assert_eq!(calculate_effective_score(&p, &penalties), 800);
    }

    // ============ Additional Tests for 195+ ============

    #[test]
    fn test_rank_by_reputation_single_profile() {
        let profiles = vec![profile_with_scores(7, 999, 0, 0, 0)];
        let ranked = rank_by_reputation(&profiles);
        assert_eq!(ranked.len(), 1);
        assert_eq!(ranked[0], (7, 999));
    }

    #[test]
    fn test_rank_by_reputation_descending_order() {
        let profiles = vec![
            profile_with_scores(1, 10, 0, 0, 0),
            profile_with_scores(2, 50, 0, 0, 0),
            profile_with_scores(3, 30, 0, 0, 0),
            profile_with_scores(4, 90, 0, 0, 0),
            profile_with_scores(5, 70, 0, 0, 0),
        ];
        let ranked = rank_by_reputation(&profiles);
        for i in 1..ranked.len() {
            assert!(ranked[i - 1].1 >= ranked[i].1);
        }
    }

    #[test]
    fn test_clamp_scores_all_categories_over_max() {
        let p = profile_with_scores(1, 200_000, 200_000, 200_000, 200_000);
        let cfg = test_config();
        let r = clamp_scores(&p, &cfg);
        assert_eq!(r.trading_score, DEFAULT_MAX_SCORE);
        assert_eq!(r.governance_score, DEFAULT_MAX_SCORE);
        assert_eq!(r.liquidity_score, DEFAULT_MAX_SCORE);
        assert_eq!(r.social_score, DEFAULT_MAX_SCORE);
        assert_eq!(r.total_score, DEFAULT_MAX_SCORE * 4);
    }

    #[test]
    fn test_create_profile_zero_timestamp() {
        let p = create_profile(1, 0);
        assert_eq!(p.created_at, 0);
        assert_eq!(p.last_updated, 0);
    }

    #[test]
    fn test_record_event_preserves_penalty_count() {
        let mut p = create_profile(1, 100);
        p.penalty_count = 5;
        let e = make_event(1, 0, 10, CATEGORY_TRADING, 200);
        let r = record_event(&p, &e).unwrap();
        assert_eq!(r.penalty_count, 5);
    }

    #[test]
    fn test_calculate_total_score_large_values() {
        let p = profile_with_scores(1, 1_000_000, 2_000_000, 3_000_000, 4_000_000);
        assert_eq!(calculate_total_score(&p), 10_000_000);
    }

    #[test]
    fn test_determine_tier_just_below_verified() {
        let cfg = test_config();
        assert_eq!(determine_trust_tier(499, &cfg), TIER_BASIC);
    }

    #[test]
    fn test_determine_tier_exactly_at_trusted() {
        let cfg = test_config();
        assert_eq!(determine_trust_tier(2000, &cfg), TIER_TRUSTED);
    }
}
