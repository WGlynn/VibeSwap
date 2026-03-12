// ============ Rate Limiter Module ============
// Implements rate limiting for VibeSwap on CKB: per-address, per-pool, and global
// rate limits using token bucket, sliding window, leaky bucket, and adaptive algorithms.
//
// Key capabilities:
// - Token bucket: burst-friendly with steady refill
// - Sliding window: strict per-window request counting
// - Leaky bucket: smooth output rate limiting
// - Adaptive: adjusts limits based on system load
// - Penalty escalation: exponential backoff for violations
// - Volume-based limiting: caps CKB throughput per window
// - Multi-state management and analytics
//
// All rates use millisecond granularity. Percentages in basis points (10000 = 100%).
//
// Philosophy: Prevention > punishment. Fair access for humans, friction for bots.

// ============ Error Types ============

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RateLimitError {
    /// Request denied — rate limit exceeded
    RateLimited,
    /// Address is in penalty lockout
    PenaltyActive,
    /// Too many violations — permanent block
    PermanentlyBlocked,
    /// Configuration values are invalid
    InvalidConfig,
    /// Identifier not found in state list
    IdentifierNotFound,
    /// Arithmetic overflow
    Overflow,
    /// Sliding window duration is too small
    WindowTooSmall,
    /// Rate cannot be zero
    ZeroRate,
}

// ============ Data Types ============

/// The algorithm used for rate limiting.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RateLimitType {
    /// Burst-friendly, refills over time
    TokenBucket,
    /// Strict per-window counting
    SlidingWindow,
    /// Smooth output rate
    LeakyBucket,
    /// Adjusts based on system load
    Adaptive,
}

/// The scope at which the rate limit is applied.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RateLimitScope {
    /// Individual address limits
    PerAddress,
    /// Per liquidity pool
    PerPool,
    /// Protocol-wide
    Global,
    /// Per (address, pool) pair
    PerPair,
}

/// Token bucket state — allows bursts up to capacity, refills at a steady rate.
#[derive(Debug, Clone)]
pub struct TokenBucket {
    /// Maximum tokens the bucket can hold
    pub capacity: u64,
    /// Current available tokens
    pub tokens: u64,
    /// Tokens added per second
    pub refill_rate: u64,
    /// Timestamp of last refill (milliseconds)
    pub last_refill: u64,
}

/// Sliding window state — tracks exact request timestamps within a window.
#[derive(Debug, Clone)]
pub struct SlidingWindow {
    /// Window duration in milliseconds
    pub window_ms: u64,
    /// Maximum requests allowed per window
    pub max_requests: u64,
    /// Timestamps of requests within the current window
    pub timestamps: Vec<u64>,
}

/// Leaky bucket state — requests queue up and drain at a fixed rate.
#[derive(Debug, Clone)]
pub struct LeakyBucket {
    /// Maximum queue size
    pub capacity: u64,
    /// Current queue fill level
    pub current_level: u64,
    /// Items drained per second
    pub drain_rate: u64,
    /// Timestamp of last drain (milliseconds)
    pub last_drain: u64,
}

/// Adaptive limit state — adjusts rate limit based on system load.
#[derive(Debug, Clone)]
pub struct AdaptiveLimit {
    /// Normal rate limit (requests per second)
    pub base_rate: u64,
    /// Currently adjusted rate limit
    pub current_rate: u64,
    /// Current system load in basis points (0-10000)
    pub load_factor: u64,
    /// Floor — never reduce below this
    pub min_rate: u64,
    /// Ceiling — never exceed this
    pub max_rate: u64,
    /// Adaptation speed (1-100, higher = faster adjustment)
    pub adjustment_speed: u64,
}

/// Configuration for a rate limiter instance.
#[derive(Debug, Clone)]
pub struct RateLimitConfig {
    /// Which algorithm to use
    pub limit_type: RateLimitType,
    /// What scope this applies to
    pub scope: RateLimitScope,
    /// Allowed requests per second
    pub requests_per_second: u64,
    /// Burst size for token bucket
    pub burst_size: u64,
    /// Window duration for sliding window (ms)
    pub window_ms: u64,
    /// Lockout duration after a violation (ms)
    pub penalty_duration_ms: u64,
    /// Violations before permanent block
    pub max_violations: u32,
    /// Max CKB volume per window (amount-based limiting)
    pub volume_limit: u64,
}

/// Full state of a rate limiter for one identifier.
#[derive(Debug, Clone)]
pub struct RateLimitState {
    /// Address hash or pool ID
    pub identifier: [u8; 32],
    /// Configuration
    pub config: RateLimitConfig,
    /// Token bucket state (if using TokenBucket type)
    pub bucket: Option<TokenBucket>,
    /// Sliding window state (if using SlidingWindow type)
    pub window: Option<SlidingWindow>,
    /// Leaky bucket state (if using LeakyBucket type)
    pub leaky: Option<LeakyBucket>,
    /// Adaptive limit state (if using Adaptive type)
    pub adaptive: Option<AdaptiveLimit>,
    /// Number of violations recorded
    pub violations: u32,
    /// Penalty lockout expires at this timestamp (ms)
    pub locked_until: u64,
    /// Total requests ever recorded
    pub total_requests: u64,
    /// Total volume processed (u128 for large sums)
    pub total_volume: u128,
}

/// Result of a rate limit check.
#[derive(Debug, Clone, PartialEq)]
pub struct RateLimitResult {
    /// Whether the request is allowed
    pub allowed: bool,
    /// Remaining capacity after this check
    pub remaining: u64,
    /// Milliseconds until retry if denied (0 if allowed)
    pub retry_after_ms: u64,
    /// Tokens consumed by this request
    pub tokens_consumed: u64,
    /// Whether a violation was recorded on this check
    pub violation_recorded: bool,
}

// ============ Config & Creation ============

/// Returns a default configuration for the given limit type and scope.
pub fn default_config(limit_type: RateLimitType, scope: RateLimitScope) -> RateLimitConfig {
    let (rps, burst, window, penalty, max_viol, vol) = match &limit_type {
        RateLimitType::TokenBucket => (10, 50, 60_000, 30_000, 5, 1_000_000),
        RateLimitType::SlidingWindow => (10, 10, 60_000, 30_000, 5, 1_000_000),
        RateLimitType::LeakyBucket => (10, 20, 60_000, 30_000, 5, 1_000_000),
        RateLimitType::Adaptive => (20, 40, 60_000, 30_000, 5, 1_000_000),
    };
    RateLimitConfig {
        limit_type,
        scope,
        requests_per_second: rps,
        burst_size: burst,
        window_ms: window,
        penalty_duration_ms: penalty,
        max_violations: max_viol,
        volume_limit: vol,
    }
}

/// Creates a new rate limit state for an identifier with the given config.
pub fn create_state(identifier: [u8; 32], config: RateLimitConfig, now: u64) -> RateLimitState {
    let bucket = if config.limit_type == RateLimitType::TokenBucket {
        Some(create_bucket(config.burst_size, config.requests_per_second, now))
    } else {
        None
    };
    let window = if config.limit_type == RateLimitType::SlidingWindow {
        Some(create_window(config.window_ms, config.requests_per_second * (config.window_ms / 1000).max(1)))
    } else {
        None
    };
    let leaky = if config.limit_type == RateLimitType::LeakyBucket {
        Some(create_leaky(config.burst_size, config.requests_per_second, now))
    } else {
        None
    };
    let adaptive = if config.limit_type == RateLimitType::Adaptive {
        Some(create_adaptive(config.requests_per_second, config.requests_per_second / 4, config.requests_per_second * 2, 50))
    } else {
        None
    };
    RateLimitState {
        identifier,
        config,
        bucket,
        window,
        leaky,
        adaptive,
        violations: 0,
        locked_until: 0,
        total_requests: 0,
        total_volume: 0,
    }
}

/// Validates a configuration, returning an error if any values are invalid.
pub fn validate_config(config: &RateLimitConfig) -> Result<(), RateLimitError> {
    if config.requests_per_second == 0 {
        return Err(RateLimitError::ZeroRate);
    }
    if config.limit_type == RateLimitType::SlidingWindow && config.window_ms < 100 {
        return Err(RateLimitError::WindowTooSmall);
    }
    if config.burst_size == 0 && config.limit_type == RateLimitType::TokenBucket {
        return Err(RateLimitError::InvalidConfig);
    }
    if config.max_violations == 0 {
        return Err(RateLimitError::InvalidConfig);
    }
    if config.volume_limit == 0 {
        return Err(RateLimitError::InvalidConfig);
    }
    Ok(())
}

// ============ Token Bucket ============

/// Creates a new token bucket, initially full.
pub fn create_bucket(capacity: u64, refill_rate: u64, now: u64) -> TokenBucket {
    TokenBucket {
        capacity,
        tokens: capacity,
        refill_rate,
        last_refill: now,
    }
}

/// Refills the bucket based on elapsed time since last refill.
pub fn refill_bucket(bucket: &mut TokenBucket, now: u64) {
    if now <= bucket.last_refill {
        return;
    }
    let elapsed_ms = now - bucket.last_refill;
    // tokens_to_add = refill_rate * elapsed_ms / 1000
    let tokens_to_add = (bucket.refill_rate as u128)
        .saturating_mul(elapsed_ms as u128)
        / 1000;
    let tokens_to_add = tokens_to_add.min(u64::MAX as u128) as u64;
    bucket.tokens = bucket.tokens.saturating_add(tokens_to_add).min(bucket.capacity);
    bucket.last_refill = now;
}

/// Attempts to consume tokens from the bucket. Returns true if successful.
pub fn try_consume_bucket(bucket: &mut TokenBucket, tokens: u64, now: u64) -> bool {
    refill_bucket(bucket, now);
    if bucket.tokens >= tokens {
        bucket.tokens -= tokens;
        true
    } else {
        false
    }
}

/// Returns the number of tokens currently available in the bucket.
pub fn bucket_remaining(bucket: &TokenBucket) -> u64 {
    bucket.tokens
}

/// Returns milliseconds until the bucket has enough tokens for the request.
/// Returns 0 if already available.
pub fn time_until_available(bucket: &TokenBucket, tokens: u64) -> u64 {
    if bucket.tokens >= tokens {
        return 0;
    }
    if bucket.refill_rate == 0 {
        return u64::MAX;
    }
    let deficit = tokens - bucket.tokens;
    // time_ms = deficit * 1000 / refill_rate (ceiling division)
    let time_ms = (deficit as u128)
        .saturating_mul(1000)
        .saturating_add(bucket.refill_rate as u128 - 1)
        / (bucket.refill_rate as u128);
    time_ms.min(u64::MAX as u128) as u64
}

// ============ Sliding Window ============

/// Creates a new sliding window with no recorded requests.
pub fn create_window(window_ms: u64, max_requests: u64) -> SlidingWindow {
    SlidingWindow {
        window_ms,
        max_requests,
        timestamps: Vec::new(),
    }
}

/// Attempts to record a request in the window. Returns true if allowed.
pub fn try_request_window(window: &mut SlidingWindow, now: u64) -> bool {
    prune_window(window, now);
    if (window.timestamps.len() as u64) < window.max_requests {
        window.timestamps.push(now);
        true
    } else {
        false
    }
}

/// Returns the number of remaining requests allowed in the current window.
pub fn window_remaining(window: &SlidingWindow, now: u64) -> u64 {
    let active = window.timestamps.iter()
        .filter(|&&ts| now.saturating_sub(window.window_ms) <= ts)
        .count() as u64;
    window.max_requests.saturating_sub(active)
}

/// Returns usage as a fraction of max in basis points (0-10000).
pub fn window_usage_bps(window: &SlidingWindow, now: u64) -> u64 {
    if window.max_requests == 0 {
        return 10_000;
    }
    let active = window.timestamps.iter()
        .filter(|&&ts| now.saturating_sub(window.window_ms) <= ts)
        .count() as u64;
    active.saturating_mul(10_000) / window.max_requests
}

/// Removes timestamps that have fallen outside the window. Returns count removed.
pub fn prune_window(window: &mut SlidingWindow, now: u64) -> usize {
    let cutoff = now.saturating_sub(window.window_ms);
    let before = window.timestamps.len();
    window.timestamps.retain(|&ts| ts > cutoff);
    before - window.timestamps.len()
}

// ============ Leaky Bucket ============

/// Creates a new leaky bucket, initially empty.
pub fn create_leaky(capacity: u64, drain_rate: u64, now: u64) -> LeakyBucket {
    LeakyBucket {
        capacity,
        current_level: 0,
        drain_rate,
        last_drain: now,
    }
}

/// Drains the bucket based on elapsed time.
pub fn drain_leaky(leaky: &mut LeakyBucket, now: u64) {
    if now <= leaky.last_drain {
        return;
    }
    let elapsed_ms = now - leaky.last_drain;
    let drained = (leaky.drain_rate as u128)
        .saturating_mul(elapsed_ms as u128)
        / 1000;
    let drained = drained.min(u64::MAX as u128) as u64;
    leaky.current_level = leaky.current_level.saturating_sub(drained);
    leaky.last_drain = now;
}

/// Attempts to add an amount to the leaky bucket. Returns true if it fits.
pub fn try_add_leaky(leaky: &mut LeakyBucket, amount: u64, now: u64) -> bool {
    drain_leaky(leaky, now);
    if leaky.current_level.saturating_add(amount) <= leaky.capacity {
        leaky.current_level += amount;
        true
    } else {
        false
    }
}

/// Returns remaining capacity in the leaky bucket.
pub fn leaky_remaining(leaky: &LeakyBucket) -> u64 {
    leaky.capacity.saturating_sub(leaky.current_level)
}

/// Returns milliseconds until the bucket has room for the given amount.
/// Returns 0 if already available.
pub fn leaky_wait_time(leaky: &LeakyBucket, amount: u64) -> u64 {
    let available = leaky.capacity.saturating_sub(leaky.current_level);
    if available >= amount {
        return 0;
    }
    if leaky.drain_rate == 0 {
        return u64::MAX;
    }
    let deficit = amount - available;
    let time_ms = (deficit as u128)
        .saturating_mul(1000)
        .saturating_add(leaky.drain_rate as u128 - 1)
        / (leaky.drain_rate as u128);
    time_ms.min(u64::MAX as u128) as u64
}

// ============ Adaptive ============

/// Creates a new adaptive limit with the given parameters.
pub fn create_adaptive(base_rate: u64, min_rate: u64, max_rate: u64, speed: u64) -> AdaptiveLimit {
    AdaptiveLimit {
        base_rate,
        current_rate: base_rate,
        load_factor: 0,
        min_rate,
        max_rate,
        adjustment_speed: speed.clamp(1, 100),
    }
}

/// Updates the adaptive limit based on current system load.
pub fn update_load(adaptive: &mut AdaptiveLimit, current_load_bps: u64) {
    let load = current_load_bps.min(10_000);
    adaptive.load_factor = load;
    adaptive.current_rate = compute_adjusted_rate(
        adaptive.base_rate,
        load,
        adaptive.min_rate,
        adaptive.max_rate,
    );
}

/// Returns true if the adaptive limit allows the given number of requests this second.
pub fn adaptive_allows(adaptive: &AdaptiveLimit, requests_this_second: u64) -> bool {
    requests_this_second <= adaptive.current_rate
}

/// Computes the adjusted rate: inversely proportional to load.
/// At 0 load: base_rate (clamped to max). At 10000 load: min_rate.
pub fn compute_adjusted_rate(base: u64, load_bps: u64, min: u64, max: u64) -> u64 {
    let load = load_bps.min(10_000);
    // rate = base * (10000 - load) / 10000
    let rate = (base as u128)
        .saturating_mul((10_000u64.saturating_sub(load)) as u128)
        / 10_000;
    let rate = rate.min(u64::MAX as u128) as u64;
    rate.clamp(min, max)
}

// ============ Unified Interface ============

/// Checks and consumes rate limit for any limiter type. Returns a result describing the outcome.
pub fn check_rate_limit(state: &mut RateLimitState, amount: u64, now: u64) -> RateLimitResult {
    // Check permanent block
    if is_permanently_blocked(state) {
        return RateLimitResult {
            allowed: false,
            remaining: 0,
            retry_after_ms: u64::MAX,
            tokens_consumed: 0,
            violation_recorded: false,
        };
    }

    // Check penalty lockout
    if is_locked(state, now) {
        return RateLimitResult {
            allowed: false,
            remaining: 0,
            retry_after_ms: lockout_remaining_ms(state, now),
            tokens_consumed: 0,
            violation_recorded: false,
        };
    }

    // Check volume limit
    if !check_volume(state, amount) {
        let viol = record_violation(state, now);
        return RateLimitResult {
            allowed: false,
            remaining: volume_remaining(state),
            retry_after_ms: lockout_remaining_ms(state, now),
            tokens_consumed: 0,
            violation_recorded: viol > 0,
        };
    }

    let (allowed, remaining, retry_ms) = match state.config.limit_type {
        RateLimitType::TokenBucket => {
            if let Some(ref mut bucket) = state.bucket {
                let ok = try_consume_bucket(bucket, amount.max(1), now);
                let rem = bucket_remaining(bucket);
                let retry = if ok { 0 } else { time_until_available(bucket, amount.max(1)) };
                (ok, rem, retry)
            } else {
                (false, 0, 0)
            }
        }
        RateLimitType::SlidingWindow => {
            if let Some(ref mut window) = state.window {
                let ok = try_request_window(window, now);
                let rem = window_remaining(window, now);
                let retry = if ok { 0 } else { window.window_ms };
                (ok, rem, retry)
            } else {
                (false, 0, 0)
            }
        }
        RateLimitType::LeakyBucket => {
            if let Some(ref mut leaky) = state.leaky {
                let ok = try_add_leaky(leaky, amount.max(1), now);
                let rem = leaky_remaining(leaky);
                let retry = if ok { 0 } else { leaky_wait_time(leaky, amount.max(1)) };
                (ok, rem, retry)
            } else {
                (false, 0, 0)
            }
        }
        RateLimitType::Adaptive => {
            if let Some(ref adaptive) = state.adaptive {
                let ok = adaptive_allows(adaptive, amount);
                let rem = adaptive.current_rate.saturating_sub(amount);
                let retry = if ok { 0 } else { 1000 };
                (ok, rem, retry)
            } else {
                (false, 0, 0)
            }
        }
    };

    let violation_recorded = if !allowed {
        record_violation(state, now);
        true
    } else {
        state.total_requests += 1;
        state.total_volume = state.total_volume.saturating_add(amount as u128);
        false
    };

    RateLimitResult {
        allowed,
        remaining,
        retry_after_ms: retry_ms,
        tokens_consumed: if allowed { amount.max(1) } else { 0 },
        violation_recorded,
    }
}

/// Records a request, returning Ok with the result or Err if blocked/locked.
pub fn record_request(state: &mut RateLimitState, amount: u64, now: u64) -> Result<RateLimitResult, RateLimitError> {
    if is_permanently_blocked(state) {
        return Err(RateLimitError::PermanentlyBlocked);
    }
    if is_locked(state, now) {
        return Err(RateLimitError::PenaltyActive);
    }
    Ok(check_rate_limit(state, amount, now))
}

/// Returns true if the state is rate limited right now, without consuming capacity.
pub fn is_rate_limited(state: &RateLimitState, now: u64) -> bool {
    if is_permanently_blocked(state) {
        return true;
    }
    if is_locked(state, now) {
        return true;
    }
    remaining_capacity(state, now) == 0
}

/// Returns the remaining capacity without consuming anything.
pub fn remaining_capacity(state: &RateLimitState, now: u64) -> u64 {
    match state.config.limit_type {
        RateLimitType::TokenBucket => {
            if let Some(ref bucket) = state.bucket {
                // Calculate what tokens would be after refill
                let elapsed_ms = now.saturating_sub(bucket.last_refill);
                let refilled = (bucket.refill_rate as u128)
                    .saturating_mul(elapsed_ms as u128)
                    / 1000;
                let refilled = refilled.min(u64::MAX as u128) as u64;
                bucket.tokens.saturating_add(refilled).min(bucket.capacity)
            } else {
                0
            }
        }
        RateLimitType::SlidingWindow => {
            if let Some(ref window) = state.window {
                window_remaining(window, now)
            } else {
                0
            }
        }
        RateLimitType::LeakyBucket => {
            if let Some(ref leaky) = state.leaky {
                let elapsed_ms = now.saturating_sub(leaky.last_drain);
                let drained = (leaky.drain_rate as u128)
                    .saturating_mul(elapsed_ms as u128)
                    / 1000;
                let drained = drained.min(u64::MAX as u128) as u64;
                let level = leaky.current_level.saturating_sub(drained);
                leaky.capacity.saturating_sub(level)
            } else {
                0
            }
        }
        RateLimitType::Adaptive => {
            if let Some(ref adaptive) = state.adaptive {
                adaptive.current_rate
            } else {
                0
            }
        }
    }
}

/// Resets the rate limiter state. Clears violations, buckets, windows, etc.
pub fn reset_state(state: &mut RateLimitState, now: u64) {
    state.violations = 0;
    state.locked_until = 0;
    state.total_requests = 0;
    state.total_volume = 0;
    if let Some(ref mut bucket) = state.bucket {
        bucket.tokens = bucket.capacity;
        bucket.last_refill = now;
    }
    if let Some(ref mut window) = state.window {
        window.timestamps.clear();
    }
    if let Some(ref mut leaky) = state.leaky {
        leaky.current_level = 0;
        leaky.last_drain = now;
    }
    if let Some(ref mut adaptive) = state.adaptive {
        adaptive.current_rate = adaptive.base_rate;
        adaptive.load_factor = 0;
    }
}

// ============ Penalties ============

/// Records a violation. Increments count and applies penalty lockout.
/// Returns the new violation count.
pub fn record_violation(state: &mut RateLimitState, now: u64) -> u32 {
    state.violations += 1;
    let penalty = escalated_penalty_ms(state.config.penalty_duration_ms, state.violations);
    state.locked_until = now.saturating_add(penalty);
    state.violations
}

/// Returns true if the state is in penalty lockout.
pub fn is_locked(state: &RateLimitState, now: u64) -> bool {
    state.locked_until > now
}

/// Returns true if the state has exceeded maximum violations.
pub fn is_permanently_blocked(state: &RateLimitState) -> bool {
    state.violations >= state.config.max_violations
}

/// Returns milliseconds remaining in the lockout, or 0 if not locked.
pub fn lockout_remaining_ms(state: &RateLimitState, now: u64) -> u64 {
    if state.locked_until > now {
        state.locked_until - now
    } else {
        0
    }
}

/// Computes escalated penalty with exponential backoff.
/// penalty = base_penalty * 2^(violation_count - 1), capped at 24 hours.
pub fn escalated_penalty_ms(base_penalty: u64, violation_count: u32) -> u64 {
    if violation_count == 0 {
        return 0;
    }
    let exponent = (violation_count - 1).min(30); // prevent overflow
    let multiplier = 1u64.checked_shl(exponent).unwrap_or(u64::MAX);
    let penalty = (base_penalty as u128).saturating_mul(multiplier as u128);
    // Cap at 24 hours
    let max_penalty = 24u64 * 60 * 60 * 1000;
    penalty.min(max_penalty as u128) as u64
}

// ============ Volume Limiting ============

/// Returns true if the given amount would stay within the volume limit.
pub fn check_volume(state: &RateLimitState, amount: u64) -> bool {
    if state.config.volume_limit == 0 {
        return false;
    }
    state.total_volume.saturating_add(amount as u128) <= state.config.volume_limit as u128
}

/// Returns the remaining volume allowance.
pub fn volume_remaining(state: &RateLimitState) -> u64 {
    let limit = state.config.volume_limit as u128;
    if state.total_volume >= limit {
        0
    } else {
        let rem = limit - state.total_volume;
        rem.min(u64::MAX as u128) as u64
    }
}

/// Returns volume usage as basis points (0-10000) of the limit.
pub fn volume_usage_bps(state: &RateLimitState) -> u64 {
    if state.config.volume_limit == 0 {
        return 10_000;
    }
    let usage = state.total_volume.saturating_mul(10_000) / (state.config.volume_limit as u128);
    usage.min(10_000) as u64
}

// ============ Multi-State Management ============

/// Finds the index of a state by identifier.
pub fn find_state(states: &[RateLimitState], identifier: &[u8; 32]) -> Option<usize> {
    states.iter().position(|s| s.identifier == *identifier)
}

/// Returns the index of the state with the least remaining capacity.
pub fn most_limited(states: &[RateLimitState], now: u64) -> Option<usize> {
    if states.is_empty() {
        return None;
    }
    let mut min_idx = 0;
    let mut min_cap = remaining_capacity(&states[0], now);
    for (i, s) in states.iter().enumerate().skip(1) {
        let cap = remaining_capacity(s, now);
        if cap < min_cap {
            min_cap = cap;
            min_idx = i;
        }
    }
    Some(min_idx)
}

/// Returns total violations across all states.
pub fn aggregate_violations(states: &[RateLimitState]) -> u64 {
    states.iter().map(|s| s.violations as u64).sum()
}

/// Returns indices of states whose usage exceeds the given threshold in bps.
pub fn states_above_threshold(states: &[RateLimitState], usage_bps: u64, now: u64) -> Vec<usize> {
    states.iter().enumerate().filter_map(|(i, s)| {
        let usage = match s.config.limit_type {
            RateLimitType::SlidingWindow => {
                if let Some(ref w) = s.window {
                    window_usage_bps(w, now)
                } else {
                    0
                }
            }
            RateLimitType::TokenBucket => {
                if let Some(ref b) = s.bucket {
                    let cap = remaining_capacity(s, now);
                    if b.capacity == 0 { 10_000 } else {
                        10_000u64.saturating_sub(cap.saturating_mul(10_000) / b.capacity)
                    }
                } else {
                    0
                }
            }
            RateLimitType::LeakyBucket => {
                if let Some(ref l) = s.leaky {
                    if l.capacity == 0 { 10_000 } else {
                        let elapsed_ms = now.saturating_sub(l.last_drain);
                        let drained = (l.drain_rate as u128).saturating_mul(elapsed_ms as u128) / 1000;
                        let drained = drained.min(u64::MAX as u128) as u64;
                        let level = l.current_level.saturating_sub(drained);
                        level.saturating_mul(10_000) / l.capacity
                    }
                } else {
                    0
                }
            }
            RateLimitType::Adaptive => {
                if let Some(ref a) = s.adaptive {
                    a.load_factor
                } else {
                    0
                }
            }
        };
        if usage >= usage_bps { Some(i) } else { None }
    }).collect()
}

// ============ Analytics ============

/// Returns average request rate in milli-requests per second (requests * 1000 / seconds).
/// Divide result by 1000 to get requests per second.
pub fn average_request_rate(state: &RateLimitState, time_span_ms: u64) -> u64 {
    if time_span_ms == 0 {
        return 0;
    }
    // result = total_requests * 1_000_000 / time_span_ms
    let rate = (state.total_requests as u128)
        .saturating_mul(1_000_000)
        / (time_span_ms as u128);
    rate.min(u64::MAX as u128) as u64
}

/// Returns peak usage in basis points based on current utilization.
pub fn peak_usage_bps(state: &RateLimitState, now: u64) -> u64 {
    match state.config.limit_type {
        RateLimitType::TokenBucket => {
            if let Some(ref b) = state.bucket {
                if b.capacity == 0 { return 10_000; }
                let cap = remaining_capacity(state, now);
                10_000u64.saturating_sub(cap.saturating_mul(10_000) / b.capacity)
            } else {
                0
            }
        }
        RateLimitType::SlidingWindow => {
            if let Some(ref w) = state.window {
                window_usage_bps(w, now)
            } else {
                0
            }
        }
        RateLimitType::LeakyBucket => {
            if let Some(ref l) = state.leaky {
                if l.capacity == 0 { return 10_000; }
                let elapsed_ms = now.saturating_sub(l.last_drain);
                let drained = (l.drain_rate as u128).saturating_mul(elapsed_ms as u128) / 1000;
                let drained = drained.min(u64::MAX as u128) as u64;
                let level = l.current_level.saturating_sub(drained);
                level.saturating_mul(10_000) / l.capacity
            } else {
                0
            }
        }
        RateLimitType::Adaptive => {
            if let Some(ref a) = state.adaptive {
                a.load_factor
            } else {
                0
            }
        }
    }
}

/// Returns violation rate as basis points: violations / total_requests * 10000.
pub fn violation_rate(state: &RateLimitState) -> u64 {
    let total = state.total_requests + state.violations as u64;
    if total == 0 {
        return 0;
    }
    (state.violations as u128).saturating_mul(10_000) as u64 / total as u64
}

/// Returns a health score (0-10000). Higher is healthier.
/// Factors: utilization (lower is better), violations (fewer is better).
pub fn health_score(state: &RateLimitState, now: u64) -> u64 {
    let usage = peak_usage_bps(state, now);
    let viol_penalty = if state.total_requests + state.violations as u64 > 0 {
        violation_rate(state)
    } else {
        0
    };
    // Health = 10000 - usage/2 - violation_penalty/2
    10_000u64
        .saturating_sub(usage / 2)
        .saturating_sub(viol_penalty / 2)
}

/// Returns milliseconds until the token bucket is fully refilled.
/// Returns 0 for non-bucket types or if already full.
pub fn time_to_full_recovery(state: &RateLimitState) -> u64 {
    if let Some(ref bucket) = state.bucket {
        if bucket.tokens >= bucket.capacity {
            return 0;
        }
        if bucket.refill_rate == 0 {
            return u64::MAX;
        }
        let deficit = bucket.capacity - bucket.tokens;
        let time_ms = (deficit as u128)
            .saturating_mul(1000)
            .saturating_add(bucket.refill_rate as u128 - 1)
            / (bucket.refill_rate as u128);
        time_ms.min(u64::MAX as u128) as u64
    } else {
        0
    }
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // ---- Helpers ----

    fn test_id(val: u8) -> [u8; 32] {
        let mut id = [0u8; 32];
        id[0] = val;
        id
    }

    fn bucket_config() -> RateLimitConfig {
        RateLimitConfig {
            limit_type: RateLimitType::TokenBucket,
            scope: RateLimitScope::PerAddress,
            requests_per_second: 10,
            burst_size: 50,
            window_ms: 60_000,
            penalty_duration_ms: 5_000,
            max_violations: 3,
            volume_limit: 1_000_000,
        }
    }

    fn window_config() -> RateLimitConfig {
        RateLimitConfig {
            limit_type: RateLimitType::SlidingWindow,
            scope: RateLimitScope::PerPool,
            requests_per_second: 10,
            burst_size: 10,
            window_ms: 10_000,
            penalty_duration_ms: 5_000,
            max_violations: 3,
            volume_limit: 1_000_000,
        }
    }

    fn leaky_config() -> RateLimitConfig {
        RateLimitConfig {
            limit_type: RateLimitType::LeakyBucket,
            scope: RateLimitScope::Global,
            requests_per_second: 10,
            burst_size: 20,
            window_ms: 60_000,
            penalty_duration_ms: 5_000,
            max_violations: 3,
            volume_limit: 1_000_000,
        }
    }

    fn adaptive_config() -> RateLimitConfig {
        RateLimitConfig {
            limit_type: RateLimitType::Adaptive,
            scope: RateLimitScope::PerPair,
            requests_per_second: 20,
            burst_size: 40,
            window_ms: 60_000,
            penalty_duration_ms: 5_000,
            max_violations: 3,
            volume_limit: 1_000_000,
        }
    }

    // ============ Config & Creation Tests ============

    #[test]
    fn test_default_config_token_bucket() {
        let cfg = default_config(RateLimitType::TokenBucket, RateLimitScope::PerAddress);
        assert_eq!(cfg.limit_type, RateLimitType::TokenBucket);
        assert_eq!(cfg.scope, RateLimitScope::PerAddress);
        assert!(cfg.requests_per_second > 0);
        assert!(cfg.burst_size > 0);
    }

    #[test]
    fn test_default_config_sliding_window() {
        let cfg = default_config(RateLimitType::SlidingWindow, RateLimitScope::PerPool);
        assert_eq!(cfg.limit_type, RateLimitType::SlidingWindow);
        assert_eq!(cfg.scope, RateLimitScope::PerPool);
    }

    #[test]
    fn test_default_config_leaky_bucket() {
        let cfg = default_config(RateLimitType::LeakyBucket, RateLimitScope::Global);
        assert_eq!(cfg.limit_type, RateLimitType::LeakyBucket);
    }

    #[test]
    fn test_default_config_adaptive() {
        let cfg = default_config(RateLimitType::Adaptive, RateLimitScope::PerPair);
        assert_eq!(cfg.limit_type, RateLimitType::Adaptive);
    }

    #[test]
    fn test_create_state_token_bucket() {
        let state = create_state(test_id(1), bucket_config(), 1000);
        assert!(state.bucket.is_some());
        assert!(state.window.is_none());
        assert!(state.leaky.is_none());
        assert!(state.adaptive.is_none());
        assert_eq!(state.violations, 0);
        assert_eq!(state.total_requests, 0);
    }

    #[test]
    fn test_create_state_sliding_window() {
        let state = create_state(test_id(2), window_config(), 1000);
        assert!(state.window.is_some());
        assert!(state.bucket.is_none());
    }

    #[test]
    fn test_create_state_leaky_bucket() {
        let state = create_state(test_id(3), leaky_config(), 1000);
        assert!(state.leaky.is_some());
        assert!(state.bucket.is_none());
    }

    #[test]
    fn test_create_state_adaptive() {
        let state = create_state(test_id(4), adaptive_config(), 1000);
        assert!(state.adaptive.is_some());
        assert!(state.bucket.is_none());
    }

    #[test]
    fn test_create_state_identifier_preserved() {
        let id = test_id(42);
        let state = create_state(id, bucket_config(), 0);
        assert_eq!(state.identifier, id);
    }

    #[test]
    fn test_validate_config_valid() {
        assert_eq!(validate_config(&bucket_config()), Ok(()));
    }

    #[test]
    fn test_validate_config_zero_rate() {
        let mut cfg = bucket_config();
        cfg.requests_per_second = 0;
        assert_eq!(validate_config(&cfg), Err(RateLimitError::ZeroRate));
    }

    #[test]
    fn test_validate_config_window_too_small() {
        let mut cfg = window_config();
        cfg.window_ms = 50;
        assert_eq!(validate_config(&cfg), Err(RateLimitError::WindowTooSmall));
    }

    #[test]
    fn test_validate_config_zero_burst_token_bucket() {
        let mut cfg = bucket_config();
        cfg.burst_size = 0;
        assert_eq!(validate_config(&cfg), Err(RateLimitError::InvalidConfig));
    }

    #[test]
    fn test_validate_config_zero_max_violations() {
        let mut cfg = bucket_config();
        cfg.max_violations = 0;
        assert_eq!(validate_config(&cfg), Err(RateLimitError::InvalidConfig));
    }

    #[test]
    fn test_validate_config_zero_volume_limit() {
        let mut cfg = bucket_config();
        cfg.volume_limit = 0;
        assert_eq!(validate_config(&cfg), Err(RateLimitError::InvalidConfig));
    }

    #[test]
    fn test_validate_config_window_exactly_100ms_ok() {
        let mut cfg = window_config();
        cfg.window_ms = 100;
        assert_eq!(validate_config(&cfg), Ok(()));
    }

    // ============ Token Bucket Tests ============

    #[test]
    fn test_create_bucket_starts_full() {
        let b = create_bucket(100, 10, 0);
        assert_eq!(b.capacity, 100);
        assert_eq!(b.tokens, 100);
        assert_eq!(b.refill_rate, 10);
    }

    #[test]
    fn test_refill_bucket_no_time_elapsed() {
        let mut b = create_bucket(100, 10, 1000);
        refill_bucket(&mut b, 1000);
        assert_eq!(b.tokens, 100);
    }

    #[test]
    fn test_refill_bucket_adds_tokens() {
        let mut b = create_bucket(100, 10, 0);
        b.tokens = 50;
        refill_bucket(&mut b, 2000); // 2 seconds = 20 tokens
        assert_eq!(b.tokens, 70);
    }

    #[test]
    fn test_refill_bucket_capped_at_capacity() {
        let mut b = create_bucket(100, 10, 0);
        b.tokens = 95;
        refill_bucket(&mut b, 10_000); // 10 seconds = 100 tokens, but cap at 100
        assert_eq!(b.tokens, 100);
    }

    #[test]
    fn test_refill_bucket_time_goes_backwards_noop() {
        let mut b = create_bucket(100, 10, 5000);
        b.tokens = 50;
        refill_bucket(&mut b, 3000); // earlier timestamp
        assert_eq!(b.tokens, 50);
    }

    #[test]
    fn test_try_consume_bucket_success() {
        let mut b = create_bucket(100, 10, 0);
        assert!(try_consume_bucket(&mut b, 30, 0));
        assert_eq!(b.tokens, 70);
    }

    #[test]
    fn test_try_consume_bucket_insufficient() {
        let mut b = create_bucket(10, 1, 0);
        assert!(!try_consume_bucket(&mut b, 20, 0));
        assert_eq!(b.tokens, 10); // unchanged
    }

    #[test]
    fn test_try_consume_bucket_exact_amount() {
        let mut b = create_bucket(10, 1, 0);
        assert!(try_consume_bucket(&mut b, 10, 0));
        assert_eq!(b.tokens, 0);
    }

    #[test]
    fn test_try_consume_bucket_with_refill() {
        let mut b = create_bucket(100, 10, 0);
        b.tokens = 0;
        // After 5 seconds, should have 50 tokens
        assert!(try_consume_bucket(&mut b, 50, 5000));
        assert_eq!(b.tokens, 0);
    }

    #[test]
    fn test_bucket_remaining_returns_tokens() {
        let b = create_bucket(100, 10, 0);
        assert_eq!(bucket_remaining(&b), 100);
    }

    #[test]
    fn test_time_until_available_already_available() {
        let b = create_bucket(100, 10, 0);
        assert_eq!(time_until_available(&b, 50), 0);
    }

    #[test]
    fn test_time_until_available_needs_refill() {
        let mut b = create_bucket(100, 10, 0);
        b.tokens = 0;
        // Need 50 tokens at 10/s = 5000ms
        assert_eq!(time_until_available(&b, 50), 5000);
    }

    #[test]
    fn test_time_until_available_partial_tokens() {
        let mut b = create_bucket(100, 10, 0);
        b.tokens = 30;
        // Need 50-30=20 more at 10/s = 2000ms
        assert_eq!(time_until_available(&b, 50), 2000);
    }

    #[test]
    fn test_time_until_available_zero_refill_rate() {
        let mut b = create_bucket(100, 0, 0);
        b.tokens = 0;
        assert_eq!(time_until_available(&b, 10), u64::MAX);
    }

    #[test]
    fn test_bucket_consume_then_refill_cycle() {
        let mut b = create_bucket(10, 5, 0);
        assert!(try_consume_bucket(&mut b, 10, 0));
        assert_eq!(b.tokens, 0);
        assert!(!try_consume_bucket(&mut b, 1, 0)); // empty
        assert!(try_consume_bucket(&mut b, 5, 1000)); // 1s later: +5
        assert_eq!(b.tokens, 0);
    }

    #[test]
    fn test_bucket_rapid_small_consumes() {
        let mut b = create_bucket(5, 1, 0);
        for _ in 0..5 {
            assert!(try_consume_bucket(&mut b, 1, 0));
        }
        assert!(!try_consume_bucket(&mut b, 1, 0));
    }

    #[test]
    fn test_refill_bucket_fractional_seconds() {
        let mut b = create_bucket(100, 10, 0);
        b.tokens = 0;
        refill_bucket(&mut b, 500); // 0.5s = 5 tokens
        assert_eq!(b.tokens, 5);
    }

    // ============ Sliding Window Tests ============

    #[test]
    fn test_create_window_empty() {
        let w = create_window(10_000, 100);
        assert_eq!(w.window_ms, 10_000);
        assert_eq!(w.max_requests, 100);
        assert!(w.timestamps.is_empty());
    }

    #[test]
    fn test_try_request_window_allows_under_limit() {
        let mut w = create_window(10_000, 5);
        assert!(try_request_window(&mut w, 1000));
        assert_eq!(w.timestamps.len(), 1);
    }

    #[test]
    fn test_try_request_window_blocks_at_limit() {
        let mut w = create_window(10_000, 3);
        assert!(try_request_window(&mut w, 1000));
        assert!(try_request_window(&mut w, 2000));
        assert!(try_request_window(&mut w, 3000));
        assert!(!try_request_window(&mut w, 4000)); // at limit
    }

    #[test]
    fn test_try_request_window_allows_after_expiry() {
        let mut w = create_window(5_000, 2);
        assert!(try_request_window(&mut w, 1000));
        assert!(try_request_window(&mut w, 2000));
        assert!(!try_request_window(&mut w, 3000)); // full
        // After window expires
        assert!(try_request_window(&mut w, 7000)); // 1000 is now expired
    }

    #[test]
    fn test_window_remaining_full() {
        let w = create_window(10_000, 100);
        assert_eq!(window_remaining(&w, 5000), 100);
    }

    #[test]
    fn test_window_remaining_some_used() {
        let mut w = create_window(10_000, 100);
        w.timestamps.push(5000);
        w.timestamps.push(6000);
        assert_eq!(window_remaining(&w, 8000), 98);
    }

    #[test]
    fn test_window_usage_bps_empty() {
        let w = create_window(10_000, 100);
        assert_eq!(window_usage_bps(&w, 5000), 0);
    }

    #[test]
    fn test_window_usage_bps_half() {
        let mut w = create_window(10_000, 10);
        for i in 0..5 {
            w.timestamps.push(1000 + i * 100);
        }
        assert_eq!(window_usage_bps(&w, 5000), 5000);
    }

    #[test]
    fn test_window_usage_bps_full() {
        let mut w = create_window(10_000, 3);
        w.timestamps.push(1000);
        w.timestamps.push(2000);
        w.timestamps.push(3000);
        assert_eq!(window_usage_bps(&w, 5000), 10_000);
    }

    #[test]
    fn test_window_usage_bps_zero_max() {
        let w = create_window(10_000, 0);
        assert_eq!(window_usage_bps(&w, 5000), 10_000);
    }

    #[test]
    fn test_prune_window_removes_old() {
        let mut w = create_window(5_000, 100);
        w.timestamps = vec![1000, 2000, 3000, 8000, 9000];
        let removed = prune_window(&mut w, 10_000);
        assert_eq!(removed, 3);
        assert_eq!(w.timestamps.len(), 2);
    }

    #[test]
    fn test_prune_window_nothing_to_remove() {
        let mut w = create_window(10_000, 100);
        w.timestamps = vec![5000, 6000, 7000];
        let removed = prune_window(&mut w, 8000);
        assert_eq!(removed, 0);
    }

    #[test]
    fn test_prune_window_all_expired() {
        let mut w = create_window(1_000, 100);
        w.timestamps = vec![100, 200, 300];
        let removed = prune_window(&mut w, 5000);
        assert_eq!(removed, 3);
        assert!(w.timestamps.is_empty());
    }

    #[test]
    fn test_sliding_window_rolling_behavior() {
        let mut w = create_window(5_000, 3);
        assert!(try_request_window(&mut w, 1000));
        assert!(try_request_window(&mut w, 2000));
        assert!(try_request_window(&mut w, 3000));
        assert!(!try_request_window(&mut w, 4000)); // window full
        // At t=6001, the first request (t=1000) expires
        assert!(try_request_window(&mut w, 6001));
    }

    // ============ Leaky Bucket Tests ============

    #[test]
    fn test_create_leaky_empty() {
        let l = create_leaky(100, 10, 0);
        assert_eq!(l.capacity, 100);
        assert_eq!(l.current_level, 0);
        assert_eq!(l.drain_rate, 10);
    }

    #[test]
    fn test_try_add_leaky_success() {
        let mut l = create_leaky(100, 10, 0);
        assert!(try_add_leaky(&mut l, 50, 0));
        assert_eq!(l.current_level, 50);
    }

    #[test]
    fn test_try_add_leaky_overflow() {
        let mut l = create_leaky(10, 1, 0);
        assert!(!try_add_leaky(&mut l, 20, 0));
        assert_eq!(l.current_level, 0); // unchanged
    }

    #[test]
    fn test_try_add_leaky_exact_capacity() {
        let mut l = create_leaky(100, 10, 0);
        assert!(try_add_leaky(&mut l, 100, 0));
        assert_eq!(l.current_level, 100);
    }

    #[test]
    fn test_try_add_leaky_with_drain() {
        let mut l = create_leaky(10, 5, 0);
        assert!(try_add_leaky(&mut l, 10, 0));
        assert!(!try_add_leaky(&mut l, 1, 0)); // full
        // After 2 seconds: drain 10, level back to 0
        assert!(try_add_leaky(&mut l, 10, 2000));
    }

    #[test]
    fn test_drain_leaky_reduces_level() {
        let mut l = create_leaky(100, 10, 0);
        l.current_level = 50;
        drain_leaky(&mut l, 3000); // 3 seconds = drain 30
        assert_eq!(l.current_level, 20);
    }

    #[test]
    fn test_drain_leaky_floors_at_zero() {
        let mut l = create_leaky(100, 10, 0);
        l.current_level = 5;
        drain_leaky(&mut l, 10_000); // drain 100 from 5 -> 0
        assert_eq!(l.current_level, 0);
    }

    #[test]
    fn test_drain_leaky_time_backwards_noop() {
        let mut l = create_leaky(100, 10, 5000);
        l.current_level = 50;
        drain_leaky(&mut l, 3000);
        assert_eq!(l.current_level, 50);
    }

    #[test]
    fn test_leaky_remaining_full_capacity() {
        let l = create_leaky(100, 10, 0);
        assert_eq!(leaky_remaining(&l), 100);
    }

    #[test]
    fn test_leaky_remaining_partial() {
        let mut l = create_leaky(100, 10, 0);
        l.current_level = 60;
        assert_eq!(leaky_remaining(&l), 40);
    }

    #[test]
    fn test_leaky_wait_time_room_available() {
        let l = create_leaky(100, 10, 0);
        assert_eq!(leaky_wait_time(&l, 50), 0);
    }

    #[test]
    fn test_leaky_wait_time_needs_drain() {
        let mut l = create_leaky(100, 10, 0);
        l.current_level = 90;
        // Need 50, have 10 available. Deficit = 40 at 10/s = 4000ms
        assert_eq!(leaky_wait_time(&l, 50), 4000);
    }

    #[test]
    fn test_leaky_wait_time_zero_drain_rate() {
        let mut l = create_leaky(100, 0, 0);
        l.current_level = 100;
        assert_eq!(leaky_wait_time(&l, 10), u64::MAX);
    }

    #[test]
    fn test_leaky_bucket_continuous_drain() {
        let mut l = create_leaky(20, 10, 0);
        assert!(try_add_leaky(&mut l, 20, 0));
        assert_eq!(l.current_level, 20);
        // After 1 second, drained 10
        assert!(try_add_leaky(&mut l, 10, 1000));
        assert_eq!(l.current_level, 20); // 20-10+10
    }

    // ============ Adaptive Tests ============

    #[test]
    fn test_create_adaptive_defaults() {
        let a = create_adaptive(100, 25, 200, 50);
        assert_eq!(a.base_rate, 100);
        assert_eq!(a.current_rate, 100);
        assert_eq!(a.min_rate, 25);
        assert_eq!(a.max_rate, 200);
        assert_eq!(a.adjustment_speed, 50);
    }

    #[test]
    fn test_create_adaptive_clamps_speed() {
        let a = create_adaptive(100, 25, 200, 0);
        assert_eq!(a.adjustment_speed, 1);
        let a2 = create_adaptive(100, 25, 200, 999);
        assert_eq!(a2.adjustment_speed, 100);
    }

    #[test]
    fn test_update_load_zero() {
        let mut a = create_adaptive(100, 25, 200, 50);
        update_load(&mut a, 0);
        assert_eq!(a.load_factor, 0);
        assert_eq!(a.current_rate, 100); // base_rate
    }

    #[test]
    fn test_update_load_max() {
        let mut a = create_adaptive(100, 25, 200, 50);
        update_load(&mut a, 10_000);
        assert_eq!(a.load_factor, 10_000);
        assert_eq!(a.current_rate, 25); // min_rate
    }

    #[test]
    fn test_update_load_half() {
        let mut a = create_adaptive(100, 25, 200, 50);
        update_load(&mut a, 5_000);
        assert_eq!(a.current_rate, 50); // 100 * 5000/10000 = 50, clamped to [25,200]
    }

    #[test]
    fn test_update_load_clamps_above_max() {
        let mut a = create_adaptive(100, 25, 200, 50);
        update_load(&mut a, 15_000); // over 10000
        assert_eq!(a.load_factor, 10_000); // capped
        assert_eq!(a.current_rate, 25); // min
    }

    #[test]
    fn test_adaptive_allows_under_limit() {
        let a = create_adaptive(100, 25, 200, 50);
        assert!(adaptive_allows(&a, 50));
    }

    #[test]
    fn test_adaptive_allows_at_limit() {
        let a = create_adaptive(100, 25, 200, 50);
        assert!(adaptive_allows(&a, 100));
    }

    #[test]
    fn test_adaptive_denies_over_limit() {
        let a = create_adaptive(100, 25, 200, 50);
        assert!(!adaptive_allows(&a, 101));
    }

    #[test]
    fn test_compute_adjusted_rate_zero_load() {
        assert_eq!(compute_adjusted_rate(100, 0, 10, 200), 100);
    }

    #[test]
    fn test_compute_adjusted_rate_full_load() {
        assert_eq!(compute_adjusted_rate(100, 10_000, 10, 200), 10);
    }

    #[test]
    fn test_compute_adjusted_rate_half_load() {
        assert_eq!(compute_adjusted_rate(100, 5_000, 10, 200), 50);
    }

    #[test]
    fn test_compute_adjusted_rate_clamped_to_min() {
        assert_eq!(compute_adjusted_rate(100, 9_500, 20, 200), 20);
    }

    #[test]
    fn test_compute_adjusted_rate_clamped_to_max() {
        // base=300 at 0 load = 300, but max=200
        assert_eq!(compute_adjusted_rate(300, 0, 10, 200), 200);
    }

    #[test]
    fn test_adaptive_under_load_reduces_rate() {
        let mut a = create_adaptive(100, 10, 200, 50);
        update_load(&mut a, 0);
        let rate_idle = a.current_rate;
        update_load(&mut a, 7_500);
        let rate_loaded = a.current_rate;
        assert!(rate_loaded < rate_idle);
    }

    // ============ Unified Interface Tests ============

    #[test]
    fn test_check_rate_limit_token_bucket_allowed() {
        let mut state = create_state(test_id(1), bucket_config(), 1000);
        let result = check_rate_limit(&mut state, 1, 1000);
        assert!(result.allowed);
        assert_eq!(result.retry_after_ms, 0);
        assert!(!result.violation_recorded);
    }

    #[test]
    fn test_check_rate_limit_token_bucket_denied() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        // Drain the bucket
        state.bucket.as_mut().unwrap().tokens = 0;
        let result = check_rate_limit(&mut state, 1, 0);
        assert!(!result.allowed);
        assert!(result.retry_after_ms > 0);
        assert!(result.violation_recorded);
    }

    #[test]
    fn test_check_rate_limit_sliding_window_allowed() {
        let mut state = create_state(test_id(2), window_config(), 1000);
        let result = check_rate_limit(&mut state, 1, 1000);
        assert!(result.allowed);
    }

    #[test]
    fn test_check_rate_limit_leaky_bucket_allowed() {
        let mut state = create_state(test_id(3), leaky_config(), 1000);
        let result = check_rate_limit(&mut state, 1, 1000);
        assert!(result.allowed);
    }

    #[test]
    fn test_check_rate_limit_adaptive_allowed() {
        let mut state = create_state(test_id(4), adaptive_config(), 1000);
        let result = check_rate_limit(&mut state, 1, 1000);
        assert!(result.allowed);
    }

    #[test]
    fn test_check_rate_limit_permanently_blocked() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        state.violations = state.config.max_violations;
        let result = check_rate_limit(&mut state, 1, 1000);
        assert!(!result.allowed);
        assert_eq!(result.retry_after_ms, u64::MAX);
    }

    #[test]
    fn test_check_rate_limit_penalty_active() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        state.locked_until = 10_000;
        let result = check_rate_limit(&mut state, 1, 5_000);
        assert!(!result.allowed);
        assert_eq!(result.retry_after_ms, 5_000);
    }

    #[test]
    fn test_check_rate_limit_volume_exceeded() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        state.total_volume = state.config.volume_limit as u128;
        let result = check_rate_limit(&mut state, 1, 1000);
        assert!(!result.allowed);
        assert!(result.violation_recorded);
    }

    #[test]
    fn test_check_rate_limit_increments_total_requests() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        check_rate_limit(&mut state, 1, 0);
        assert_eq!(state.total_requests, 1);
        check_rate_limit(&mut state, 1, 0);
        assert_eq!(state.total_requests, 2);
    }

    #[test]
    fn test_check_rate_limit_increments_total_volume() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        check_rate_limit(&mut state, 5, 0);
        assert_eq!(state.total_volume, 5);
    }

    #[test]
    fn test_record_request_success() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        let result = record_request(&mut state, 1, 0);
        assert!(result.is_ok());
        assert!(result.unwrap().allowed);
    }

    #[test]
    fn test_record_request_permanently_blocked() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        state.violations = state.config.max_violations;
        let result = record_request(&mut state, 1, 0);
        assert_eq!(result, Err(RateLimitError::PermanentlyBlocked));
    }

    #[test]
    fn test_record_request_penalty_active() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        state.locked_until = 10_000;
        let result = record_request(&mut state, 1, 5_000);
        assert_eq!(result, Err(RateLimitError::PenaltyActive));
    }

    #[test]
    fn test_is_rate_limited_not_limited() {
        let state = create_state(test_id(1), bucket_config(), 0);
        assert!(!is_rate_limited(&state, 0));
    }

    #[test]
    fn test_is_rate_limited_locked() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        state.locked_until = 10_000;
        assert!(is_rate_limited(&state, 5_000));
    }

    #[test]
    fn test_is_rate_limited_permanently_blocked() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        state.violations = state.config.max_violations;
        assert!(is_rate_limited(&state, 0));
    }

    #[test]
    fn test_is_rate_limited_empty_bucket() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        state.bucket.as_mut().unwrap().tokens = 0;
        assert!(is_rate_limited(&state, 0));
    }

    #[test]
    fn test_remaining_capacity_token_bucket() {
        let state = create_state(test_id(1), bucket_config(), 0);
        assert_eq!(remaining_capacity(&state, 0), 50); // full bucket
    }

    #[test]
    fn test_remaining_capacity_token_bucket_with_refill() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        state.bucket.as_mut().unwrap().tokens = 0;
        // After 1 second: 10 tokens refilled
        assert_eq!(remaining_capacity(&state, 1000), 10);
    }

    #[test]
    fn test_remaining_capacity_sliding_window() {
        let state = create_state(test_id(2), window_config(), 0);
        let cap = remaining_capacity(&state, 0);
        assert!(cap > 0);
    }

    #[test]
    fn test_remaining_capacity_leaky_bucket() {
        let state = create_state(test_id(3), leaky_config(), 0);
        assert_eq!(remaining_capacity(&state, 0), 20); // capacity = burst_size = 20
    }

    #[test]
    fn test_remaining_capacity_adaptive() {
        let state = create_state(test_id(4), adaptive_config(), 0);
        assert_eq!(remaining_capacity(&state, 0), 20); // requests_per_second
    }

    #[test]
    fn test_reset_state_clears_violations() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        state.violations = 5;
        state.locked_until = 99999;
        state.total_requests = 1000;
        state.total_volume = 5_000_000;
        reset_state(&mut state, 1000);
        assert_eq!(state.violations, 0);
        assert_eq!(state.locked_until, 0);
        assert_eq!(state.total_requests, 0);
        assert_eq!(state.total_volume, 0);
    }

    #[test]
    fn test_reset_state_refills_bucket() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        state.bucket.as_mut().unwrap().tokens = 0;
        reset_state(&mut state, 1000);
        assert_eq!(state.bucket.as_ref().unwrap().tokens, 50);
    }

    #[test]
    fn test_reset_state_clears_window() {
        let mut state = create_state(test_id(2), window_config(), 0);
        state.window.as_mut().unwrap().timestamps.push(100);
        state.window.as_mut().unwrap().timestamps.push(200);
        reset_state(&mut state, 1000);
        assert!(state.window.as_ref().unwrap().timestamps.is_empty());
    }

    #[test]
    fn test_reset_state_clears_leaky() {
        let mut state = create_state(test_id(3), leaky_config(), 0);
        state.leaky.as_mut().unwrap().current_level = 15;
        reset_state(&mut state, 1000);
        assert_eq!(state.leaky.as_ref().unwrap().current_level, 0);
    }

    #[test]
    fn test_reset_state_resets_adaptive() {
        let mut state = create_state(test_id(4), adaptive_config(), 0);
        let adaptive = state.adaptive.as_mut().unwrap();
        adaptive.current_rate = 5;
        adaptive.load_factor = 9000;
        reset_state(&mut state, 1000);
        let a = state.adaptive.as_ref().unwrap();
        assert_eq!(a.current_rate, a.base_rate);
        assert_eq!(a.load_factor, 0);
    }

    // ============ Penalty Tests ============

    #[test]
    fn test_record_violation_increments() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        assert_eq!(record_violation(&mut state, 1000), 1);
        assert_eq!(record_violation(&mut state, 2000), 2);
    }

    #[test]
    fn test_record_violation_sets_lockout() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        record_violation(&mut state, 1000);
        assert!(state.locked_until > 1000);
    }

    #[test]
    fn test_is_locked_within_penalty() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        state.locked_until = 10_000;
        assert!(is_locked(&state, 5_000));
    }

    #[test]
    fn test_is_locked_after_penalty() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        state.locked_until = 10_000;
        assert!(!is_locked(&state, 15_000));
    }

    #[test]
    fn test_is_locked_exactly_at_expiry() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        state.locked_until = 10_000;
        assert!(!is_locked(&state, 10_000));
    }

    #[test]
    fn test_is_permanently_blocked_below_max() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        state.violations = 2;
        assert!(!is_permanently_blocked(&state));
    }

    #[test]
    fn test_is_permanently_blocked_at_max() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        state.violations = 3; // max_violations = 3
        assert!(is_permanently_blocked(&state));
    }

    #[test]
    fn test_is_permanently_blocked_above_max() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        state.violations = 10;
        assert!(is_permanently_blocked(&state));
    }

    #[test]
    fn test_lockout_remaining_ms_locked() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        state.locked_until = 10_000;
        assert_eq!(lockout_remaining_ms(&state, 3_000), 7_000);
    }

    #[test]
    fn test_lockout_remaining_ms_not_locked() {
        let state = create_state(test_id(1), bucket_config(), 0);
        assert_eq!(lockout_remaining_ms(&state, 1000), 0);
    }

    #[test]
    fn test_escalated_penalty_first_violation() {
        assert_eq!(escalated_penalty_ms(5_000, 1), 5_000); // 5000 * 2^0 = 5000
    }

    #[test]
    fn test_escalated_penalty_second_violation() {
        assert_eq!(escalated_penalty_ms(5_000, 2), 10_000); // 5000 * 2^1 = 10000
    }

    #[test]
    fn test_escalated_penalty_third_violation() {
        assert_eq!(escalated_penalty_ms(5_000, 3), 20_000); // 5000 * 2^2 = 20000
    }

    #[test]
    fn test_escalated_penalty_zero_violations() {
        assert_eq!(escalated_penalty_ms(5_000, 0), 0);
    }

    #[test]
    fn test_escalated_penalty_capped_at_24_hours() {
        let max_ms = 24 * 60 * 60 * 1000;
        let result = escalated_penalty_ms(5_000, 30);
        assert!(result <= max_ms);
    }

    #[test]
    fn test_escalated_penalty_exponential_growth() {
        let p1 = escalated_penalty_ms(1000, 1);
        let p2 = escalated_penalty_ms(1000, 2);
        let p3 = escalated_penalty_ms(1000, 3);
        assert_eq!(p2, p1 * 2);
        assert_eq!(p3, p1 * 4);
    }

    #[test]
    fn test_violations_lead_to_permanent_block() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        record_violation(&mut state, 1000);
        record_violation(&mut state, 2000);
        assert!(!is_permanently_blocked(&state));
        record_violation(&mut state, 3000);
        assert!(is_permanently_blocked(&state));
    }

    // ============ Volume Limiting Tests ============

    #[test]
    fn test_check_volume_within_limit() {
        let state = create_state(test_id(1), bucket_config(), 0);
        assert!(check_volume(&state, 500_000));
    }

    #[test]
    fn test_check_volume_at_limit() {
        let state = create_state(test_id(1), bucket_config(), 0);
        assert!(check_volume(&state, 1_000_000));
    }

    #[test]
    fn test_check_volume_exceeds_limit() {
        let state = create_state(test_id(1), bucket_config(), 0);
        assert!(!check_volume(&state, 1_000_001));
    }

    #[test]
    fn test_check_volume_with_existing_volume() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        state.total_volume = 900_000;
        assert!(check_volume(&state, 100_000));
        assert!(!check_volume(&state, 100_001));
    }

    #[test]
    fn test_volume_remaining_full() {
        let state = create_state(test_id(1), bucket_config(), 0);
        assert_eq!(volume_remaining(&state), 1_000_000);
    }

    #[test]
    fn test_volume_remaining_partial() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        state.total_volume = 600_000;
        assert_eq!(volume_remaining(&state), 400_000);
    }

    #[test]
    fn test_volume_remaining_exhausted() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        state.total_volume = 1_000_000;
        assert_eq!(volume_remaining(&state), 0);
    }

    #[test]
    fn test_volume_usage_bps_zero() {
        let state = create_state(test_id(1), bucket_config(), 0);
        assert_eq!(volume_usage_bps(&state), 0);
    }

    #[test]
    fn test_volume_usage_bps_half() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        state.total_volume = 500_000;
        assert_eq!(volume_usage_bps(&state), 5_000);
    }

    #[test]
    fn test_volume_usage_bps_full() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        state.total_volume = 1_000_000;
        assert_eq!(volume_usage_bps(&state), 10_000);
    }

    #[test]
    fn test_volume_usage_bps_zero_limit() {
        let mut cfg = bucket_config();
        cfg.volume_limit = 0;
        let state = RateLimitState {
            identifier: test_id(1),
            config: cfg,
            bucket: None,
            window: None,
            leaky: None,
            adaptive: None,
            violations: 0,
            locked_until: 0,
            total_requests: 0,
            total_volume: 0,
        };
        assert_eq!(volume_usage_bps(&state), 10_000);
    }

    // ============ Multi-State Management Tests ============

    #[test]
    fn test_find_state_found() {
        let states = vec![
            create_state(test_id(1), bucket_config(), 0),
            create_state(test_id(2), bucket_config(), 0),
            create_state(test_id(3), bucket_config(), 0),
        ];
        assert_eq!(find_state(&states, &test_id(2)), Some(1));
    }

    #[test]
    fn test_find_state_not_found() {
        let states = vec![
            create_state(test_id(1), bucket_config(), 0),
        ];
        assert_eq!(find_state(&states, &test_id(99)), None);
    }

    #[test]
    fn test_find_state_empty() {
        let states: Vec<RateLimitState> = vec![];
        assert_eq!(find_state(&states, &test_id(1)), None);
    }

    #[test]
    fn test_most_limited_single() {
        let states = vec![create_state(test_id(1), bucket_config(), 0)];
        assert_eq!(most_limited(&states, 0), Some(0));
    }

    #[test]
    fn test_most_limited_empty() {
        let states: Vec<RateLimitState> = vec![];
        assert_eq!(most_limited(&states, 0), None);
    }

    #[test]
    fn test_most_limited_returns_least_remaining() {
        let mut s1 = create_state(test_id(1), bucket_config(), 0);
        let mut s2 = create_state(test_id(2), bucket_config(), 0);
        s1.bucket.as_mut().unwrap().tokens = 40;
        s2.bucket.as_mut().unwrap().tokens = 10;
        let states = vec![s1, s2];
        assert_eq!(most_limited(&states, 0), Some(1));
    }

    #[test]
    fn test_aggregate_violations_none() {
        let states = vec![
            create_state(test_id(1), bucket_config(), 0),
            create_state(test_id(2), bucket_config(), 0),
        ];
        assert_eq!(aggregate_violations(&states), 0);
    }

    #[test]
    fn test_aggregate_violations_some() {
        let mut s1 = create_state(test_id(1), bucket_config(), 0);
        let mut s2 = create_state(test_id(2), bucket_config(), 0);
        s1.violations = 3;
        s2.violations = 7;
        assert_eq!(aggregate_violations(&[s1, s2]), 10);
    }

    #[test]
    fn test_aggregate_violations_empty() {
        assert_eq!(aggregate_violations(&[]), 0);
    }

    #[test]
    fn test_states_above_threshold_none() {
        let states = vec![
            create_state(test_id(1), bucket_config(), 0),
            create_state(test_id(2), bucket_config(), 0),
        ];
        let above = states_above_threshold(&states, 5_000, 0);
        assert!(above.is_empty());
    }

    #[test]
    fn test_states_above_threshold_some() {
        let mut s1 = create_state(test_id(1), bucket_config(), 0);
        let s2 = create_state(test_id(2), bucket_config(), 0);
        // Drain s1's bucket to create high usage
        s1.bucket.as_mut().unwrap().tokens = 0;
        let states = vec![s1, s2];
        let above = states_above_threshold(&states, 9_000, 0);
        assert!(above.contains(&0));
        assert!(!above.contains(&1));
    }

    #[test]
    fn test_states_above_threshold_sliding_window() {
        let mut state = create_state(test_id(1), window_config(), 0);
        let max_req = state.window.as_ref().unwrap().max_requests;
        // Fill window to capacity
        for i in 0..max_req {
            state.window.as_mut().unwrap().timestamps.push(1000 + i * 10);
        }
        let states = vec![state];
        let above = states_above_threshold(&states, 9_000, 2000);
        assert!(above.contains(&0));
    }

    #[test]
    fn test_states_above_threshold_leaky_bucket() {
        let mut state = create_state(test_id(1), leaky_config(), 0);
        state.leaky.as_mut().unwrap().current_level = 19; // 19/20 = 9500 bps
        let states = vec![state];
        let above = states_above_threshold(&states, 9_000, 0);
        assert!(above.contains(&0));
    }

    #[test]
    fn test_states_above_threshold_adaptive() {
        let mut state = create_state(test_id(1), adaptive_config(), 0);
        state.adaptive.as_mut().unwrap().load_factor = 9_500;
        let states = vec![state];
        let above = states_above_threshold(&states, 9_000, 0);
        assert!(above.contains(&0));
    }

    // ============ Analytics Tests ============

    #[test]
    fn test_average_request_rate_zero_time() {
        let state = create_state(test_id(1), bucket_config(), 0);
        assert_eq!(average_request_rate(&state, 0), 0);
    }

    #[test]
    fn test_average_request_rate_calculation() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        state.total_requests = 100;
        // 100 requests in 10 seconds = 10 rps = 10000 milli-rps
        assert_eq!(average_request_rate(&state, 10_000), 10_000);
    }

    #[test]
    fn test_average_request_rate_fractional() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        state.total_requests = 1;
        // 1 request in 2 seconds = 0.5 rps = 500 milli-rps
        assert_eq!(average_request_rate(&state, 2_000), 500);
    }

    #[test]
    fn test_peak_usage_bps_empty_bucket() {
        let state = create_state(test_id(1), bucket_config(), 0);
        assert_eq!(peak_usage_bps(&state, 0), 0); // full bucket = 0 usage
    }

    #[test]
    fn test_peak_usage_bps_drained_bucket() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        state.bucket.as_mut().unwrap().tokens = 0;
        assert_eq!(peak_usage_bps(&state, 0), 10_000);
    }

    #[test]
    fn test_peak_usage_bps_half_bucket() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        state.bucket.as_mut().unwrap().tokens = 25;
        assert_eq!(peak_usage_bps(&state, 0), 5_000);
    }

    #[test]
    fn test_peak_usage_bps_sliding_window() {
        let mut state = create_state(test_id(1), window_config(), 0);
        let max_req = state.window.as_ref().unwrap().max_requests;
        for i in 0..max_req {
            state.window.as_mut().unwrap().timestamps.push(1000 + i * 10);
        }
        assert_eq!(peak_usage_bps(&state, 5000), 10_000);
    }

    #[test]
    fn test_violation_rate_no_activity() {
        let state = create_state(test_id(1), bucket_config(), 0);
        assert_eq!(violation_rate(&state), 0);
    }

    #[test]
    fn test_violation_rate_all_violations() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        state.violations = 10;
        state.total_requests = 0;
        assert_eq!(violation_rate(&state), 10_000);
    }

    #[test]
    fn test_violation_rate_mixed() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        state.violations = 1;
        state.total_requests = 9;
        // 1 violation / 10 total = 1000 bps
        assert_eq!(violation_rate(&state), 1_000);
    }

    #[test]
    fn test_health_score_perfect() {
        let state = create_state(test_id(1), bucket_config(), 0);
        assert_eq!(health_score(&state, 0), 10_000);
    }

    #[test]
    fn test_health_score_degraded() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        state.bucket.as_mut().unwrap().tokens = 0;
        state.violations = 1;
        state.total_requests = 9;
        let score = health_score(&state, 0);
        assert!(score < 10_000);
        assert!(score > 0);
    }

    #[test]
    fn test_health_score_heavily_loaded() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        state.bucket.as_mut().unwrap().tokens = 0;
        state.violations = 5;
        state.total_requests = 5;
        let score = health_score(&state, 0);
        assert!(score < 5_000);
    }

    #[test]
    fn test_time_to_full_recovery_already_full() {
        let state = create_state(test_id(1), bucket_config(), 0);
        assert_eq!(time_to_full_recovery(&state), 0);
    }

    #[test]
    fn test_time_to_full_recovery_empty() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        state.bucket.as_mut().unwrap().tokens = 0;
        // 50 tokens at 10/s = 5000ms
        assert_eq!(time_to_full_recovery(&state), 5000);
    }

    #[test]
    fn test_time_to_full_recovery_partial() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        state.bucket.as_mut().unwrap().tokens = 30;
        // 20 tokens at 10/s = 2000ms
        assert_eq!(time_to_full_recovery(&state), 2000);
    }

    #[test]
    fn test_time_to_full_recovery_non_bucket() {
        let state = create_state(test_id(1), window_config(), 0);
        assert_eq!(time_to_full_recovery(&state), 0);
    }

    #[test]
    fn test_time_to_full_recovery_zero_refill() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        state.bucket.as_mut().unwrap().tokens = 0;
        state.bucket.as_mut().unwrap().refill_rate = 0;
        assert_eq!(time_to_full_recovery(&state), u64::MAX);
    }

    // ============ Integration / Scenario Tests ============

    #[test]
    fn test_full_lifecycle_token_bucket() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        // Initial: should be allowed
        let r = check_rate_limit(&mut state, 1, 0);
        assert!(r.allowed);
        // Drain the bucket
        for _ in 0..49 {
            check_rate_limit(&mut state, 1, 0);
        }
        // Now we have 0 tokens (consumed 50 total)
        // Next request should record a violation (but we're now locked)
        // Wait until lockout expires, then bucket refills
        let r = check_rate_limit(&mut state, 1, 100_000);
        assert!(r.allowed);
    }

    #[test]
    fn test_full_lifecycle_sliding_window() {
        let mut state = create_state(test_id(1), window_config(), 0);
        // Fill window
        let max = state.window.as_ref().unwrap().max_requests;
        for i in 0..max {
            let r = check_rate_limit(&mut state, 1, 1000 + i * 10);
            assert!(r.allowed);
        }
        // Next should be denied
        let r = check_rate_limit(&mut state, 1, 1000 + max * 10);
        assert!(!r.allowed);
    }

    #[test]
    fn test_penalty_escalation_blocks_permanently() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        state.bucket.as_mut().unwrap().tokens = 0;
        state.bucket.as_mut().unwrap().refill_rate = 0; // prevent refill
        // Cause 3 violations (max_violations = 3)
        // Each violation sets lockout; must wait for lockout to expire before next
        check_rate_limit(&mut state, 1, 0); // violation 1, locked_until = 5000
        check_rate_limit(&mut state, 1, 10_000); // violation 2, locked_until = 10000 + 10000 = 20000
        check_rate_limit(&mut state, 1, 100_000); // violation 3
        assert!(is_permanently_blocked(&state));
    }

    #[test]
    fn test_reset_then_use_again() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        state.violations = 2;
        state.locked_until = 50_000;
        state.bucket.as_mut().unwrap().tokens = 0;
        reset_state(&mut state, 60_000);
        assert!(!is_locked(&state, 60_000));
        assert!(!is_permanently_blocked(&state));
        let r = check_rate_limit(&mut state, 1, 60_000);
        assert!(r.allowed);
    }

    #[test]
    fn test_multiple_states_find_most_limited() {
        let mut s1 = create_state(test_id(1), bucket_config(), 0);
        let s2 = create_state(test_id(2), bucket_config(), 0);
        let mut s3 = create_state(test_id(3), bucket_config(), 0);
        s1.bucket.as_mut().unwrap().tokens = 30;
        s3.bucket.as_mut().unwrap().tokens = 5;
        let states = vec![s1, s2, s3];
        assert_eq!(most_limited(&states, 0), Some(2));
    }

    #[test]
    fn test_volume_limiting_blocks_large_transfer() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        state.total_volume = 999_990;
        let r = check_rate_limit(&mut state, 100, 0);
        assert!(!r.allowed); // would exceed 1M limit
    }

    #[test]
    fn test_concurrent_scopes_independent() {
        let mut s_addr = create_state(test_id(1), bucket_config(), 0);
        let mut cfg_pool = bucket_config();
        cfg_pool.scope = RateLimitScope::PerPool;
        let mut s_pool = create_state(test_id(2), cfg_pool, 0);
        // Drain address bucket
        s_addr.bucket.as_mut().unwrap().tokens = 0;
        // Pool should still work
        let r = check_rate_limit(&mut s_pool, 1, 0);
        assert!(r.allowed);
    }

    #[test]
    fn test_adaptive_responds_to_load_change() {
        let mut state = create_state(test_id(1), adaptive_config(), 0);
        let initial_rate = state.adaptive.as_ref().unwrap().current_rate;
        update_load(state.adaptive.as_mut().unwrap(), 8_000);
        let loaded_rate = state.adaptive.as_ref().unwrap().current_rate;
        assert!(loaded_rate < initial_rate);
        update_load(state.adaptive.as_mut().unwrap(), 0);
        let idle_rate = state.adaptive.as_ref().unwrap().current_rate;
        assert!(idle_rate > loaded_rate);
    }

    #[test]
    fn test_leaky_bucket_steady_state() {
        let mut state = create_state(test_id(1), leaky_config(), 0);
        // Add at drain rate over multiple seconds
        for i in 0..5 {
            let t = i * 1000;
            let r = check_rate_limit(&mut state, 10, t);
            assert!(r.allowed);
        }
    }

    #[test]
    fn test_sliding_window_exact_boundary() {
        let mut w = create_window(1_000, 2);
        assert!(try_request_window(&mut w, 1000));
        assert!(try_request_window(&mut w, 1500));
        assert!(!try_request_window(&mut w, 1999)); // both still in window
        // At 2001, t=1000 is exactly expired (cutoff = 2001-1000 = 1001)
        assert!(try_request_window(&mut w, 2001));
    }

    #[test]
    fn test_bucket_refill_precision_100ms() {
        let mut b = create_bucket(1000, 100, 0);
        b.tokens = 0;
        refill_bucket(&mut b, 100); // 0.1s * 100/s = 10 tokens
        assert_eq!(b.tokens, 10);
    }

    #[test]
    fn test_leaky_drain_precision_100ms() {
        let mut l = create_leaky(1000, 100, 0);
        l.current_level = 500;
        drain_leaky(&mut l, 100); // 0.1s * 100/s = 10 drained
        assert_eq!(l.current_level, 490);
    }

    #[test]
    fn test_health_score_monotonically_decreases_with_violations() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        state.total_requests = 100;
        state.violations = 0;
        let h0 = health_score(&state, 0);
        state.violations = 5;
        let h1 = health_score(&state, 0);
        state.violations = 20;
        let h2 = health_score(&state, 0);
        assert!(h0 >= h1);
        assert!(h1 >= h2);
    }

    #[test]
    fn test_check_volume_zero_amount() {
        let state = create_state(test_id(1), bucket_config(), 0);
        assert!(check_volume(&state, 0));
    }

    #[test]
    fn test_window_remaining_after_all_expired() {
        let mut w = create_window(1_000, 10);
        w.timestamps = vec![100, 200, 300];
        assert_eq!(window_remaining(&w, 5000), 10); // all expired
    }

    #[test]
    fn test_leaky_bucket_exactly_at_capacity() {
        let mut l = create_leaky(10, 1, 0);
        assert!(try_add_leaky(&mut l, 10, 0));
        assert!(!try_add_leaky(&mut l, 1, 0)); // full
    }

    #[test]
    fn test_token_bucket_consume_zero() {
        let mut b = create_bucket(10, 1, 0);
        assert!(try_consume_bucket(&mut b, 0, 0));
        assert_eq!(b.tokens, 10);
    }

    #[test]
    fn test_adaptive_allows_zero_requests() {
        let a = create_adaptive(100, 10, 200, 50);
        assert!(adaptive_allows(&a, 0));
    }

    #[test]
    fn test_escalated_penalty_large_violation_count() {
        let max_24h = 24 * 60 * 60 * 1000;
        let result = escalated_penalty_ms(1000, 31);
        assert!(result <= max_24h);
    }

    #[test]
    fn test_find_state_returns_first_match() {
        let states = vec![
            create_state(test_id(1), bucket_config(), 0),
            create_state(test_id(1), bucket_config(), 0), // duplicate
        ];
        assert_eq!(find_state(&states, &test_id(1)), Some(0));
    }

    #[test]
    fn test_create_state_initial_volume_zero() {
        let state = create_state(test_id(1), bucket_config(), 0);
        assert_eq!(state.total_volume, 0);
    }

    #[test]
    fn test_create_state_initial_locked_until_zero() {
        let state = create_state(test_id(1), bucket_config(), 0);
        assert_eq!(state.locked_until, 0);
    }

    #[test]
    fn test_record_request_returns_allowed_result() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        let r = record_request(&mut state, 1, 0).unwrap();
        assert!(r.allowed);
        assert_eq!(r.tokens_consumed, 1);
    }

    #[test]
    fn test_remaining_capacity_leaky_with_drain() {
        let mut state = create_state(test_id(1), leaky_config(), 0);
        state.leaky.as_mut().unwrap().current_level = 15;
        // After 1 second: drain 10, level = 5, remaining = 20-5 = 15
        assert_eq!(remaining_capacity(&state, 1000), 15);
    }

    #[test]
    fn test_default_config_volume_limit_positive() {
        let cfg = default_config(RateLimitType::TokenBucket, RateLimitScope::PerAddress);
        assert!(cfg.volume_limit > 0);
    }

    #[test]
    fn test_default_config_penalty_duration_positive() {
        let cfg = default_config(RateLimitType::SlidingWindow, RateLimitScope::Global);
        assert!(cfg.penalty_duration_ms > 0);
    }

    #[test]
    fn test_default_config_max_violations_positive() {
        let cfg = default_config(RateLimitType::LeakyBucket, RateLimitScope::PerPair);
        assert!(cfg.max_violations > 0);
    }

    #[test]
    fn test_check_rate_limit_denied_sets_remaining_zero_on_volume() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        state.total_volume = 1_000_000; // at limit
        let r = check_rate_limit(&mut state, 1, 0);
        assert!(!r.allowed);
        assert_eq!(r.remaining, 0);
    }

    #[test]
    fn test_multiple_windows_independent_expiry() {
        let mut w = create_window(2_000, 10);
        // Add timestamps at different times
        w.timestamps = vec![1000, 2000, 3000, 4000, 5000];
        let pruned = prune_window(&mut w, 4500);
        assert_eq!(pruned, 2); // 1000 and 2000 removed (cutoff = 2500)
    }

    #[test]
    fn test_average_request_rate_large_values() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        state.total_requests = u64::MAX;
        let rate = average_request_rate(&state, 1_000);
        assert!(rate > 0);
    }

    #[test]
    fn test_health_score_range_always_valid() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        let score = health_score(&state, 0);
        assert!(score <= 10_000);
        state.bucket.as_mut().unwrap().tokens = 0;
        state.violations = 100;
        state.total_requests = 100;
        let score = health_score(&state, 0);
        assert!(score <= 10_000);
    }

    #[test]
    fn test_validate_config_leaky_zero_burst_ok() {
        let mut cfg = leaky_config();
        cfg.burst_size = 0; // Only matters for TokenBucket
        assert_eq!(validate_config(&cfg), Ok(()));
    }

    #[test]
    fn test_volume_limiting_incremental_accumulation() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        for i in 0..10 {
            let r = check_rate_limit(&mut state, 100_000, i * 1000);
            if state.total_volume <= 1_000_000 {
                // Still have volume
            } else {
                assert!(!r.allowed);
            }
        }
    }

    #[test]
    fn test_record_violation_returns_correct_count() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        assert_eq!(record_violation(&mut state, 100), 1);
        assert_eq!(record_violation(&mut state, 200), 2);
        assert_eq!(record_violation(&mut state, 300), 3);
    }

    #[test]
    fn test_lockout_remaining_after_expiry() {
        let mut state = create_state(test_id(1), bucket_config(), 0);
        state.locked_until = 5_000;
        assert_eq!(lockout_remaining_ms(&state, 10_000), 0);
    }

    #[test]
    fn test_bucket_large_refill_rate() {
        let mut b = create_bucket(u64::MAX, 1_000_000, 0);
        b.tokens = 0;
        refill_bucket(&mut b, 1000); // 1s * 1M/s = 1M tokens
        assert_eq!(b.tokens, 1_000_000);
    }

    #[test]
    fn test_leaky_wait_time_exact_fit() {
        let l = create_leaky(100, 10, 0);
        assert_eq!(leaky_wait_time(&l, 100), 0); // exactly fits
    }

    #[test]
    fn test_adaptive_rate_quarter_load() {
        let rate = compute_adjusted_rate(100, 2_500, 10, 200);
        assert_eq!(rate, 75); // 100 * 7500/10000
    }

    #[test]
    fn test_adaptive_rate_three_quarter_load() {
        let rate = compute_adjusted_rate(100, 7_500, 10, 200);
        assert_eq!(rate, 25); // 100 * 2500/10000
    }

    #[test]
    fn test_is_rate_limited_not_limited_window() {
        let state = create_state(test_id(1), window_config(), 0);
        assert!(!is_rate_limited(&state, 0));
    }

    #[test]
    fn test_is_rate_limited_full_window() {
        let mut state = create_state(test_id(1), window_config(), 0);
        let max = state.window.as_ref().unwrap().max_requests;
        for i in 0..max {
            state.window.as_mut().unwrap().timestamps.push(1000 + i * 10);
        }
        assert!(is_rate_limited(&state, 2000));
    }
}
