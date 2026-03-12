// ============ Batch Auction Module ============
// Batch Auction Lifecycle Manager — coordinates commit-reveal batch auctions.
// Ties together commit phase (8s), reveal phase (2s), and settlement
// into a coherent auction lifecycle with slashing, fee collection,
// and multi-batch analytics.

use sha2::{Digest, Sha256};

// ============ Constants ============

/// Basis points denominator (10000 = 100%)
pub const BPS: u64 = 10_000;

/// Maximum allowed slash rate in basis points
pub const MAX_SLASH_BPS: u64 = 10_000;

/// Maximum allowed fee rate in basis points
pub const MAX_FEE_BPS: u64 = 5_000;

// ============ Error Types ============

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BatchError {
    /// Batch is not in the expected phase
    WrongPhase { expected: BatchPhase, actual: BatchPhase },
    /// Maximum orders reached for this batch
    MaxOrdersReached { max: u32 },
    /// Commit must come from an EOA (flash loan protection)
    NotEoa,
    /// Deposit too small
    InsufficientDeposit { required: u64, provided: u64 },
    /// Reveal hash does not match commit hash
    RevealMismatch,
    /// Commit index out of bounds
    InvalidCommitIndex { index: usize, count: usize },
    /// Commit already revealed
    AlreadyRevealed { index: usize },
    /// Not enough reveals to settle
    InsufficientReveals { required: u32, actual: u32 },
    /// Batch already settled or expired
    BatchFinalized,
    /// Invalid config parameter
    InvalidConfig(String),
    /// No reserves provided for settlement
    ZeroReserves,
    /// Batch sequence invalid
    InvalidSequence,
    /// Overflow in arithmetic
    Overflow,
    /// Batch not yet ready for settlement
    NotReadyToSettle,
    /// Cannot expire before reveal window ends
    NotExpired,
}

// ============ Data Types ============

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BatchPhase {
    Accepting,
    Revealing,
    Settling,
    Settled,
    Expired,
}

#[derive(Debug, Clone)]
pub struct BatchConfig {
    pub commit_duration_ms: u64,
    pub reveal_duration_ms: u64,
    pub min_orders: u32,
    pub max_orders: u32,
    pub min_deposit_bps: u64,
    pub slash_rate_bps: u64,
    pub fee_rate_bps: u64,
    pub priority_fee_enabled: bool,
}

#[derive(Debug, Clone)]
pub struct Commit {
    pub commit_hash: [u8; 32],
    pub depositor: [u8; 32],
    pub deposit_amount: u64,
    pub timestamp_ms: u64,
    pub is_eoa: bool,
}

#[derive(Debug, Clone)]
pub struct Reveal {
    pub commit_index: usize,
    pub amount: u64,
    pub is_buy: bool,
    pub secret: [u8; 32],
    pub priority_fee: u64,
}

#[derive(Debug, Clone)]
pub struct Batch {
    pub batch_id: u64,
    pub pool_id: [u8; 32],
    pub phase: BatchPhase,
    pub start_time_ms: u64,
    pub commits: Vec<Commit>,
    pub reveals: Vec<Reveal>,
    pub total_deposits: u64,
    pub total_slashed: u64,
    pub clearing_price: Option<u64>,
    pub config: BatchConfig,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BatchResult {
    pub batch_id: u64,
    pub clearing_price: u64,
    pub total_buy_volume: u64,
    pub total_sell_volume: u64,
    pub matched_volume: u64,
    pub total_fees: u64,
    pub total_slashed: u64,
    pub fill_count: u32,
    pub average_fill_rate_bps: u64,
    pub quality_score: u64,
}

#[derive(Debug, Clone)]
pub struct BatchStats {
    pub total_batches: u64,
    pub settled_batches: u64,
    pub expired_batches: u64,
    pub total_volume: u128,
    pub total_fees_collected: u128,
    pub total_slashed: u128,
    pub avg_orders_per_batch: u64,
    pub avg_reveal_rate_bps: u64,
    pub avg_settlement_quality: u64,
}

// ============ Configuration & Creation ============

pub fn default_config() -> BatchConfig {
    BatchConfig {
        commit_duration_ms: 8000,
        reveal_duration_ms: 2000,
        min_orders: 2,
        max_orders: 1000,
        min_deposit_bps: 100,
        slash_rate_bps: 5000,
        fee_rate_bps: 30,
        priority_fee_enabled: true,
    }
}

pub fn create_batch(batch_id: u64, pool_id: [u8; 32], start_time_ms: u64, config: BatchConfig) -> Batch {
    Batch {
        batch_id,
        pool_id,
        phase: BatchPhase::Accepting,
        start_time_ms,
        commits: Vec::new(),
        reveals: Vec::new(),
        total_deposits: 0,
        total_slashed: 0,
        clearing_price: None,
        config,
    }
}

pub fn validate_config(config: &BatchConfig) -> Result<(), BatchError> {
    if config.commit_duration_ms == 0 {
        return Err(BatchError::InvalidConfig("commit_duration_ms must be > 0".into()));
    }
    if config.reveal_duration_ms == 0 {
        return Err(BatchError::InvalidConfig("reveal_duration_ms must be > 0".into()));
    }
    if config.min_orders == 0 {
        return Err(BatchError::InvalidConfig("min_orders must be > 0".into()));
    }
    if config.min_orders > config.max_orders {
        return Err(BatchError::InvalidConfig("min_orders must be <= max_orders".into()));
    }
    if config.slash_rate_bps > MAX_SLASH_BPS {
        return Err(BatchError::InvalidConfig("slash_rate_bps must be <= 10000".into()));
    }
    if config.fee_rate_bps > MAX_FEE_BPS {
        return Err(BatchError::InvalidConfig("fee_rate_bps must be <= 5000".into()));
    }
    if config.min_deposit_bps > BPS {
        return Err(BatchError::InvalidConfig("min_deposit_bps must be <= 10000".into()));
    }
    Ok(())
}

// ============ Phase Management ============

pub fn current_phase(batch: &Batch, now_ms: u64) -> BatchPhase {
    if batch.phase == BatchPhase::Settled {
        return BatchPhase::Settled;
    }
    if batch.phase == BatchPhase::Expired {
        return BatchPhase::Expired;
    }

    let commit_end = batch.start_time_ms.saturating_add(batch.config.commit_duration_ms);
    let reveal_end = commit_end.saturating_add(batch.config.reveal_duration_ms);

    if now_ms < commit_end {
        BatchPhase::Accepting
    } else if now_ms < reveal_end {
        BatchPhase::Revealing
    } else {
        // Past reveal window — either settling or expired depending on state
        BatchPhase::Settling
    }
}

pub fn time_remaining_ms(batch: &Batch, now_ms: u64) -> u64 {
    let phase = current_phase(batch, now_ms);
    let commit_end = batch.start_time_ms.saturating_add(batch.config.commit_duration_ms);
    let reveal_end = commit_end.saturating_add(batch.config.reveal_duration_ms);

    match phase {
        BatchPhase::Accepting => commit_end.saturating_sub(now_ms),
        BatchPhase::Revealing => reveal_end.saturating_sub(now_ms),
        _ => 0,
    }
}

pub fn is_accepting_commits(batch: &Batch, now_ms: u64) -> bool {
    current_phase(batch, now_ms) == BatchPhase::Accepting
}

pub fn is_accepting_reveals(batch: &Batch, now_ms: u64) -> bool {
    current_phase(batch, now_ms) == BatchPhase::Revealing
}

pub fn transition_phase(batch: &mut Batch, now_ms: u64) -> Result<BatchPhase, BatchError> {
    if batch.phase == BatchPhase::Settled || batch.phase == BatchPhase::Expired {
        return Err(BatchError::BatchFinalized);
    }

    let new_phase = current_phase(batch, now_ms);
    batch.phase = new_phase.clone();
    Ok(new_phase)
}

// ============ Commit Operations ============

pub fn add_commit(batch: &mut Batch, commit: Commit, now_ms: u64) -> Result<usize, BatchError> {
    validate_commit(batch, &commit, now_ms)?;
    let index = batch.commits.len();
    batch.total_deposits = batch.total_deposits.saturating_add(commit.deposit_amount);
    batch.commits.push(commit);
    Ok(index)
}

pub fn compute_commit_hash(amount: u64, is_buy: bool, secret: &[u8; 32]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(amount.to_le_bytes());
    hasher.update(if is_buy { [1u8] } else { [0u8] });
    hasher.update(secret);
    let result = hasher.finalize();
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&result);
    hash
}

pub fn validate_commit(batch: &Batch, commit: &Commit, now_ms: u64) -> Result<(), BatchError> {
    let phase = current_phase(batch, now_ms);
    if phase != BatchPhase::Accepting {
        return Err(BatchError::WrongPhase {
            expected: BatchPhase::Accepting,
            actual: phase,
        });
    }
    if batch.commits.len() >= batch.config.max_orders as usize {
        return Err(BatchError::MaxOrdersReached { max: batch.config.max_orders });
    }
    if !commit.is_eoa {
        return Err(BatchError::NotEoa);
    }
    // We can't validate min deposit without knowing the order amount at commit time,
    // but we can ensure the deposit is non-zero
    if commit.deposit_amount == 0 {
        return Err(BatchError::InsufficientDeposit { required: 1, provided: 0 });
    }
    Ok(())
}

pub fn minimum_deposit(amount: u64, config: &BatchConfig) -> u64 {
    let deposit = (amount as u128)
        .saturating_mul(config.min_deposit_bps as u128)
        / (BPS as u128);
    // Minimum of 1 if amount > 0
    if amount > 0 && deposit == 0 {
        1
    } else {
        deposit as u64
    }
}

pub fn commit_count(batch: &Batch) -> usize {
    batch.commits.len()
}

// ============ Reveal Operations ============

pub fn add_reveal(batch: &mut Batch, reveal: Reveal, now_ms: u64) -> Result<(), BatchError> {
    let phase = current_phase(batch, now_ms);
    if phase != BatchPhase::Revealing {
        return Err(BatchError::WrongPhase {
            expected: BatchPhase::Revealing,
            actual: phase,
        });
    }
    if reveal.commit_index >= batch.commits.len() {
        return Err(BatchError::InvalidCommitIndex {
            index: reveal.commit_index,
            count: batch.commits.len(),
        });
    }
    // Check not already revealed
    for r in &batch.reveals {
        if r.commit_index == reveal.commit_index {
            return Err(BatchError::AlreadyRevealed { index: reveal.commit_index });
        }
    }
    // Verify hash matches
    if !verify_reveal(&batch.commits[reveal.commit_index], &reveal) {
        return Err(BatchError::RevealMismatch);
    }
    batch.reveals.push(reveal);
    Ok(())
}

pub fn verify_reveal(commit: &Commit, reveal: &Reveal) -> bool {
    let expected = compute_commit_hash(reveal.amount, reveal.is_buy, &reveal.secret);
    expected == commit.commit_hash
}

pub fn reveal_count(batch: &Batch) -> usize {
    batch.reveals.len()
}

pub fn reveal_rate_bps(batch: &Batch) -> u64 {
    if batch.commits.is_empty() {
        return 0;
    }
    let rate = (batch.reveals.len() as u128)
        .saturating_mul(BPS as u128)
        / (batch.commits.len() as u128);
    rate as u64
}

pub fn unrevealed_commits(batch: &Batch) -> Vec<usize> {
    let revealed_indices: Vec<usize> = batch.reveals.iter().map(|r| r.commit_index).collect();
    (0..batch.commits.len())
        .filter(|i| !revealed_indices.contains(i))
        .collect()
}

pub fn slash_unrevealed(batch: &mut Batch) -> u64 {
    let unrevealed = unrevealed_commits(batch);
    let mut total_slashed: u64 = 0;
    for idx in &unrevealed {
        let deposit = batch.commits[*idx].deposit_amount;
        let slash = (deposit as u128)
            .saturating_mul(batch.config.slash_rate_bps as u128)
            / (BPS as u128);
        total_slashed = total_slashed.saturating_add(slash as u64);
    }
    batch.total_slashed = total_slashed;
    total_slashed
}

// ============ Settlement ============

pub fn can_settle(batch: &Batch, now_ms: u64) -> bool {
    let phase = current_phase(batch, now_ms);
    if phase != BatchPhase::Settling {
        return false;
    }
    if batch.phase == BatchPhase::Settled || batch.phase == BatchPhase::Expired {
        return false;
    }
    batch.reveals.len() >= batch.config.min_orders as usize
}

pub fn compute_clearing_price(reveals: &[Reveal], reserve_a: u64, reserve_b: u64) -> u64 {
    if reserve_a == 0 || reserve_b == 0 {
        return 0;
    }
    // AMM-derived clearing price: price = reserve_b / reserve_a (scaled by BPS)
    // Then adjust based on net order flow
    let base_price = (reserve_b as u128)
        .saturating_mul(BPS as u128)
        / (reserve_a as u128);

    let mut buy_volume: u128 = 0;
    let mut sell_volume: u128 = 0;
    for r in reveals {
        if r.is_buy {
            buy_volume = buy_volume.saturating_add(r.amount as u128);
        } else {
            sell_volume = sell_volume.saturating_add(r.amount as u128);
        }
    }

    // Price impact: shift price based on buy/sell imbalance
    // More buys => price goes up, more sells => price goes down
    let total = buy_volume.saturating_add(sell_volume);
    if total == 0 {
        return base_price as u64;
    }

    // impact_bps = (buy_volume - sell_volume) / total * 1000 (max 10% shift)
    let (imbalance, is_positive) = if buy_volume >= sell_volume {
        (buy_volume - sell_volume, true)
    } else {
        (sell_volume - buy_volume, false)
    };

    let impact_bps = imbalance.saturating_mul(1000) / total; // max 1000 bps = 10%
    let impact_bps = if impact_bps > 1000 { 1000 } else { impact_bps };

    let adjusted = if is_positive {
        base_price.saturating_mul(BPS as u128 + impact_bps) / (BPS as u128)
    } else {
        base_price.saturating_mul((BPS as u128).saturating_sub(impact_bps)) / (BPS as u128)
    };

    adjusted as u64
}

pub fn settle_batch(
    batch: &mut Batch,
    reserve_a: u64,
    reserve_b: u64,
    now_ms: u64,
) -> Result<BatchResult, BatchError> {
    if batch.phase == BatchPhase::Settled || batch.phase == BatchPhase::Expired {
        return Err(BatchError::BatchFinalized);
    }
    if !can_settle(batch, now_ms) {
        let reveal_len = batch.reveals.len() as u32;
        if reveal_len < batch.config.min_orders {
            return Err(BatchError::InsufficientReveals {
                required: batch.config.min_orders,
                actual: reveal_len,
            });
        }
        return Err(BatchError::NotReadyToSettle);
    }
    if reserve_a == 0 || reserve_b == 0 {
        return Err(BatchError::ZeroReserves);
    }

    // Slash unrevealed commits
    let slashed = slash_unrevealed(batch);

    // Compute clearing price
    let price = compute_clearing_price(&batch.reveals, reserve_a, reserve_b);
    batch.clearing_price = Some(price);

    // Compute fills
    let fills = compute_fills(&batch.reveals, price);

    let mut total_buy_volume: u64 = 0;
    let mut total_sell_volume: u64 = 0;
    let mut matched_volume: u64 = 0;
    let mut total_fees: u64 = 0;
    let mut fill_count: u32 = 0;

    for r in &batch.reveals {
        if r.is_buy {
            total_buy_volume = total_buy_volume.saturating_add(r.amount);
        } else {
            total_sell_volume = total_sell_volume.saturating_add(r.amount);
        }
    }

    for (_idx, fill_amount, fee) in &fills {
        if *fill_amount > 0 {
            fill_count += 1;
            matched_volume = matched_volume.saturating_add(*fill_amount);
            total_fees = total_fees.saturating_add(*fee);
        }
    }

    let total_volume = total_buy_volume.saturating_add(total_sell_volume);
    let average_fill_rate_bps = if total_volume > 0 {
        (matched_volume as u128).saturating_mul(BPS as u128) / (total_volume as u128)
    } else {
        0
    } as u64;

    let result = BatchResult {
        batch_id: batch.batch_id,
        clearing_price: price,
        total_buy_volume,
        total_sell_volume,
        matched_volume,
        total_fees,
        total_slashed: slashed,
        fill_count,
        average_fill_rate_bps,
        quality_score: 0, // computed below
    };

    let quality = settlement_quality(&result);
    let result = BatchResult { quality_score: quality, ..result };

    batch.phase = BatchPhase::Settled;
    Ok(result)
}

pub fn compute_fills(reveals: &[Reveal], clearing_price: u64) -> Vec<(usize, u64, u64)> {
    if clearing_price == 0 {
        return reveals.iter().enumerate().map(|(i, _)| (i, 0u64, 0u64)).collect();
    }

    let mut fills = Vec::new();
    // For buys: fill at clearing price means user gets amount * BPS / clearing_price tokens
    // For sells: fill at clearing price means user gets amount * clearing_price / BPS tokens
    // Fee is deducted from the fill
    // Simplified: fill_amount = order amount, fee = amount * fee_rate / BPS
    // (fee_rate is not available here, so we use a default 30 bps)
    let fee_bps: u64 = 30;

    for (i, r) in reveals.iter().enumerate() {
        let fee = (r.amount as u128).saturating_mul(fee_bps as u128) / (BPS as u128);
        let fill_amount = r.amount.saturating_sub(fee as u64);
        fills.push((i, fill_amount, fee as u64));
    }
    fills
}

pub fn settlement_quality(result: &BatchResult) -> u64 {
    // Quality score 0-10000 based on:
    // 1. Fill rate (40% weight) — higher fill rate = better
    // 2. Volume balance (30% weight) — closer buy/sell = better price discovery
    // 3. Fill count (30% weight) — more participants = better

    let fill_rate_score = result.average_fill_rate_bps; // already 0-10000

    let total_vol = result.total_buy_volume.saturating_add(result.total_sell_volume);
    let balance_score = if total_vol > 0 {
        let min_side = std::cmp::min(result.total_buy_volume, result.total_sell_volume);
        (min_side as u128).saturating_mul(BPS as u128 * 2) / (total_vol as u128)
    } else {
        0
    } as u64;
    let balance_score = std::cmp::min(balance_score, BPS);

    // fill_count score: cap at 20 orders = 10000
    let count_score = std::cmp::min(result.fill_count as u64 * 500, BPS);

    let quality = (fill_rate_score as u128 * 40
        + balance_score as u128 * 30
        + count_score as u128 * 30)
        / 100;

    std::cmp::min(quality as u64, BPS)
}

// ============ Batch Analysis ============

pub fn buy_sell_ratio(batch: &Batch) -> (u64, u64) {
    let mut buys: u64 = 0;
    let mut sells: u64 = 0;
    for r in &batch.reveals {
        if r.is_buy {
            buys = buys.saturating_add(r.amount);
        } else {
            sells = sells.saturating_add(r.amount);
        }
    }
    (buys, sells)
}

pub fn order_imbalance_bps(batch: &Batch) -> u64 {
    let (buys, sells) = buy_sell_ratio(batch);
    let total = (buys as u128).saturating_add(sells as u128);
    if total == 0 {
        return 0;
    }
    let diff = if buys >= sells {
        (buys - sells) as u128
    } else {
        (sells - buys) as u128
    };
    let imbalance = diff.saturating_mul(BPS as u128) / total;
    imbalance as u64
}

pub fn avg_order_size(batch: &Batch) -> u64 {
    if batch.reveals.is_empty() {
        return 0;
    }
    let total: u128 = batch.reveals.iter().map(|r| r.amount as u128).sum();
    (total / batch.reveals.len() as u128) as u64
}

pub fn priority_fee_total(batch: &Batch) -> u64 {
    batch.reveals.iter().map(|r| r.priority_fee).fold(0u64, |acc, f| acc.saturating_add(f))
}

pub fn deposit_utilization_bps(batch: &Batch) -> u64 {
    if batch.total_deposits == 0 {
        return 0;
    }
    let matched: u128 = batch.reveals.iter().map(|r| r.amount as u128).sum();
    let util = matched.saturating_mul(BPS as u128) / (batch.total_deposits as u128);
    std::cmp::min(util as u64, BPS)
}

pub fn effective_fee_rate_bps(result: &BatchResult) -> u64 {
    if result.matched_volume == 0 {
        return 0;
    }
    let rate = (result.total_fees as u128)
        .saturating_mul(BPS as u128)
        / (result.matched_volume as u128);
    rate as u64
}

// ============ Multi-Batch Stats ============

pub fn compute_batch_stats(results: &[BatchResult], expired_count: u64) -> BatchStats {
    let settled = results.len() as u64;
    let total_batches = settled + expired_count;

    let mut total_volume: u128 = 0;
    let mut total_fees: u128 = 0;
    let mut total_slashed: u128 = 0;
    let mut total_orders: u128 = 0;
    let mut total_quality: u128 = 0;
    let mut total_fill_rate: u128 = 0;

    for r in results {
        total_volume = total_volume.saturating_add(r.matched_volume as u128);
        total_fees = total_fees.saturating_add(r.total_fees as u128);
        total_slashed = total_slashed.saturating_add(r.total_slashed as u128);
        total_orders = total_orders.saturating_add(r.fill_count as u128);
        total_quality = total_quality.saturating_add(r.quality_score as u128);
        total_fill_rate = total_fill_rate.saturating_add(r.average_fill_rate_bps as u128);
    }

    let avg_orders = if settled > 0 { (total_orders / settled as u128) as u64 } else { 0 };
    let avg_reveal = if settled > 0 { (total_fill_rate / settled as u128) as u64 } else { 0 };
    let avg_quality = if settled > 0 { (total_quality / settled as u128) as u64 } else { 0 };

    BatchStats {
        total_batches,
        settled_batches: settled,
        expired_batches: expired_count,
        total_volume,
        total_fees_collected: total_fees,
        total_slashed,
        avg_orders_per_batch: avg_orders,
        avg_reveal_rate_bps: avg_reveal,
        avg_settlement_quality: avg_quality,
    }
}

pub fn batch_throughput(stats: &BatchStats, time_span_ms: u64) -> u64 {
    if time_span_ms == 0 {
        return 0;
    }
    // batches per second * 1000 (to keep integer precision)
    (stats.total_batches as u128)
        .saturating_mul(1_000_000)
        .checked_div(time_span_ms as u128)
        .unwrap_or(0) as u64
}

pub fn volume_weighted_quality(results: &[BatchResult]) -> u64 {
    if results.is_empty() {
        return 0;
    }
    let mut weighted_sum: u128 = 0;
    let mut total_vol: u128 = 0;
    for r in results {
        let vol = r.matched_volume as u128;
        weighted_sum = weighted_sum.saturating_add(vol.saturating_mul(r.quality_score as u128));
        total_vol = total_vol.saturating_add(vol);
    }
    if total_vol == 0 {
        return 0;
    }
    (weighted_sum / total_vol) as u64
}

pub fn fee_efficiency(stats: &BatchStats) -> u64 {
    if stats.total_volume == 0 {
        return 0;
    }
    let eff = stats.total_fees_collected
        .saturating_mul(BPS as u128)
        / stats.total_volume;
    eff as u64
}

// ============ Lifecycle ============

pub fn expire_batch(batch: &mut Batch, now_ms: u64) -> Result<u64, BatchError> {
    if batch.phase == BatchPhase::Settled || batch.phase == BatchPhase::Expired {
        return Err(BatchError::BatchFinalized);
    }
    let commit_end = batch.start_time_ms.saturating_add(batch.config.commit_duration_ms);
    let reveal_end = commit_end.saturating_add(batch.config.reveal_duration_ms);
    if now_ms < reveal_end {
        return Err(BatchError::NotExpired);
    }

    // Slash unrevealed
    slash_unrevealed(batch);

    // Calculate total refunds
    let refunds = refund_amounts(batch);
    let total_refund: u64 = refunds.iter().map(|(_, amt)| amt).sum();

    batch.phase = BatchPhase::Expired;
    Ok(total_refund)
}

pub fn refund_amounts(batch: &Batch) -> Vec<([u8; 32], u64)> {
    let revealed_indices: Vec<usize> = batch.reveals.iter().map(|r| r.commit_index).collect();

    batch.commits.iter().enumerate().map(|(i, c)| {
        if revealed_indices.contains(&i) {
            // Revealed commits get full deposit back (settlement handles their order)
            (c.depositor, c.deposit_amount)
        } else {
            // Unrevealed commits get deposit minus slash
            let slash = (c.deposit_amount as u128)
                .saturating_mul(batch.config.slash_rate_bps as u128)
                / (BPS as u128);
            (c.depositor, c.deposit_amount.saturating_sub(slash as u64))
        }
    }).collect()
}

pub fn next_batch_id(current: u64) -> u64 {
    current.saturating_add(1)
}

pub fn batch_duration_ms(config: &BatchConfig) -> u64 {
    config.commit_duration_ms.saturating_add(config.reveal_duration_ms)
}

// ============ Validation ============

pub fn validate_batch_sequence(batches: &[Batch]) -> bool {
    if batches.is_empty() {
        return true;
    }
    for i in 1..batches.len() {
        // IDs must be sequential
        if batches[i].batch_id != batches[i - 1].batch_id + 1 {
            return false;
        }
        // No time overlaps: next batch starts after previous ends
        let prev_end = batches[i - 1].start_time_ms
            .saturating_add(batch_duration_ms(&batches[i - 1].config));
        if batches[i].start_time_ms < prev_end {
            return false;
        }
    }
    true
}

pub fn is_valid_batch(batch: &Batch) -> bool {
    // Config valid
    if validate_config(&batch.config).is_err() {
        return false;
    }
    // All reveals reference valid commits
    for r in &batch.reveals {
        if r.commit_index >= batch.commits.len() {
            return false;
        }
    }
    // No duplicate reveal indices
    let mut seen = Vec::new();
    for r in &batch.reveals {
        if seen.contains(&r.commit_index) {
            return false;
        }
        seen.push(r.commit_index);
    }
    // Reveals <= commits
    if batch.reveals.len() > batch.commits.len() {
        return false;
    }
    // If settled, must have clearing price
    if batch.phase == BatchPhase::Settled && batch.clearing_price.is_none() {
        return false;
    }
    true
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // ============ Test Helpers ============

    fn test_config() -> BatchConfig {
        default_config()
    }

    fn test_pool_id() -> [u8; 32] {
        [0xAA; 32]
    }

    fn test_depositor(id: u8) -> [u8; 32] {
        [id; 32]
    }

    fn test_secret(id: u8) -> [u8; 32] {
        [id; 32]
    }

    fn make_commit(amount: u64, is_buy: bool, secret: &[u8; 32], depositor: [u8; 32], deposit: u64, ts: u64) -> Commit {
        Commit {
            commit_hash: compute_commit_hash(amount, is_buy, secret),
            depositor,
            deposit_amount: deposit,
            timestamp_ms: ts,
            is_eoa: true,
        }
    }

    fn make_reveal(commit_index: usize, amount: u64, is_buy: bool, secret: [u8; 32], priority_fee: u64) -> Reveal {
        Reveal {
            commit_index,
            amount,
            is_buy,
            secret,
            priority_fee,
        }
    }

    fn make_batch_with_commits_and_reveals(
        num_buys: usize,
        buy_amount: u64,
        num_sells: usize,
        sell_amount: u64,
    ) -> Batch {
        let config = test_config();
        let start = 1000;
        let mut batch = create_batch(1, test_pool_id(), start, config);
        let commit_time = start + 100;
        let reveal_time = start + 8500;

        let mut idx = 0;
        for i in 0..num_buys {
            let secret = test_secret(i as u8);
            let commit = make_commit(buy_amount, true, &secret, test_depositor(i as u8), buy_amount / 10, commit_time);
            batch.commits.push(commit);
            batch.total_deposits += buy_amount / 10;
            let reveal = make_reveal(idx, buy_amount, true, secret, 0);
            batch.reveals.push(reveal);
            idx += 1;
        }
        for i in 0..num_sells {
            let secret = test_secret((100 + i) as u8);
            let commit = make_commit(sell_amount, false, &secret, test_depositor((100 + i) as u8), sell_amount / 10, commit_time);
            batch.commits.push(commit);
            batch.total_deposits += sell_amount / 10;
            let reveal = make_reveal(idx, sell_amount, false, secret, 0);
            batch.reveals.push(reveal);
            idx += 1;
        }
        batch
    }

    // ============ Configuration & Creation Tests ============

    #[test]
    fn test_default_config_values() {
        let cfg = default_config();
        assert_eq!(cfg.commit_duration_ms, 8000);
        assert_eq!(cfg.reveal_duration_ms, 2000);
        assert_eq!(cfg.min_orders, 2);
        assert_eq!(cfg.max_orders, 1000);
        assert_eq!(cfg.min_deposit_bps, 100);
        assert_eq!(cfg.slash_rate_bps, 5000);
        assert_eq!(cfg.fee_rate_bps, 30);
        assert!(cfg.priority_fee_enabled);
    }

    #[test]
    fn test_default_config_valid() {
        assert!(validate_config(&default_config()).is_ok());
    }

    #[test]
    fn test_create_batch_initial_state() {
        let b = create_batch(42, test_pool_id(), 1000, test_config());
        assert_eq!(b.batch_id, 42);
        assert_eq!(b.pool_id, test_pool_id());
        assert_eq!(b.phase, BatchPhase::Accepting);
        assert_eq!(b.start_time_ms, 1000);
        assert!(b.commits.is_empty());
        assert!(b.reveals.is_empty());
        assert_eq!(b.total_deposits, 0);
        assert_eq!(b.total_slashed, 0);
        assert!(b.clearing_price.is_none());
    }

    #[test]
    fn test_create_batch_zero_id() {
        let b = create_batch(0, [0; 32], 0, test_config());
        assert_eq!(b.batch_id, 0);
    }

    #[test]
    fn test_create_batch_max_id() {
        let b = create_batch(u64::MAX, [0xFF; 32], u64::MAX, test_config());
        assert_eq!(b.batch_id, u64::MAX);
    }

    #[test]
    fn test_validate_config_zero_commit_duration() {
        let mut cfg = test_config();
        cfg.commit_duration_ms = 0;
        assert_eq!(
            validate_config(&cfg),
            Err(BatchError::InvalidConfig("commit_duration_ms must be > 0".into()))
        );
    }

    #[test]
    fn test_validate_config_zero_reveal_duration() {
        let mut cfg = test_config();
        cfg.reveal_duration_ms = 0;
        assert_eq!(
            validate_config(&cfg),
            Err(BatchError::InvalidConfig("reveal_duration_ms must be > 0".into()))
        );
    }

    #[test]
    fn test_validate_config_zero_min_orders() {
        let mut cfg = test_config();
        cfg.min_orders = 0;
        assert_eq!(
            validate_config(&cfg),
            Err(BatchError::InvalidConfig("min_orders must be > 0".into()))
        );
    }

    #[test]
    fn test_validate_config_min_exceeds_max() {
        let mut cfg = test_config();
        cfg.min_orders = 100;
        cfg.max_orders = 10;
        assert_eq!(
            validate_config(&cfg),
            Err(BatchError::InvalidConfig("min_orders must be <= max_orders".into()))
        );
    }

    #[test]
    fn test_validate_config_slash_exceeds_max() {
        let mut cfg = test_config();
        cfg.slash_rate_bps = 10001;
        assert_eq!(
            validate_config(&cfg),
            Err(BatchError::InvalidConfig("slash_rate_bps must be <= 10000".into()))
        );
    }

    #[test]
    fn test_validate_config_fee_exceeds_max() {
        let mut cfg = test_config();
        cfg.fee_rate_bps = 5001;
        assert_eq!(
            validate_config(&cfg),
            Err(BatchError::InvalidConfig("fee_rate_bps must be <= 5000".into()))
        );
    }

    #[test]
    fn test_validate_config_deposit_bps_exceeds_max() {
        let mut cfg = test_config();
        cfg.min_deposit_bps = 10001;
        assert_eq!(
            validate_config(&cfg),
            Err(BatchError::InvalidConfig("min_deposit_bps must be <= 10000".into()))
        );
    }

    #[test]
    fn test_validate_config_slash_at_boundary() {
        let mut cfg = test_config();
        cfg.slash_rate_bps = 10000;
        assert!(validate_config(&cfg).is_ok());
    }

    #[test]
    fn test_validate_config_fee_at_boundary() {
        let mut cfg = test_config();
        cfg.fee_rate_bps = 5000;
        assert!(validate_config(&cfg).is_ok());
    }

    #[test]
    fn test_validate_config_min_equals_max_orders() {
        let mut cfg = test_config();
        cfg.min_orders = 5;
        cfg.max_orders = 5;
        assert!(validate_config(&cfg).is_ok());
    }

    // ============ Phase Management Tests ============

    #[test]
    fn test_phase_accepting_at_start() {
        let b = create_batch(1, test_pool_id(), 1000, test_config());
        assert_eq!(current_phase(&b, 1000), BatchPhase::Accepting);
    }

    #[test]
    fn test_phase_accepting_mid() {
        let b = create_batch(1, test_pool_id(), 1000, test_config());
        assert_eq!(current_phase(&b, 5000), BatchPhase::Accepting);
    }

    #[test]
    fn test_phase_accepting_last_ms() {
        let b = create_batch(1, test_pool_id(), 1000, test_config());
        // commit ends at 9000, so 8999 is last accepting ms
        assert_eq!(current_phase(&b, 8999), BatchPhase::Accepting);
    }

    #[test]
    fn test_phase_revealing_at_boundary() {
        let b = create_batch(1, test_pool_id(), 1000, test_config());
        // commit ends at 9000
        assert_eq!(current_phase(&b, 9000), BatchPhase::Revealing);
    }

    #[test]
    fn test_phase_revealing_mid() {
        let b = create_batch(1, test_pool_id(), 1000, test_config());
        assert_eq!(current_phase(&b, 9500), BatchPhase::Revealing);
    }

    #[test]
    fn test_phase_revealing_last_ms() {
        let b = create_batch(1, test_pool_id(), 1000, test_config());
        // reveal ends at 11000, so 10999 is last revealing ms
        assert_eq!(current_phase(&b, 10999), BatchPhase::Revealing);
    }

    #[test]
    fn test_phase_settling_at_boundary() {
        let b = create_batch(1, test_pool_id(), 1000, test_config());
        // reveal ends at 11000
        assert_eq!(current_phase(&b, 11000), BatchPhase::Settling);
    }

    #[test]
    fn test_phase_settling_well_past() {
        let b = create_batch(1, test_pool_id(), 1000, test_config());
        assert_eq!(current_phase(&b, 99999), BatchPhase::Settling);
    }

    #[test]
    fn test_phase_settled_sticky() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        b.phase = BatchPhase::Settled;
        // Even if time says accepting, settled is sticky
        assert_eq!(current_phase(&b, 1000), BatchPhase::Settled);
    }

    #[test]
    fn test_phase_expired_sticky() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        b.phase = BatchPhase::Expired;
        assert_eq!(current_phase(&b, 1000), BatchPhase::Expired);
    }

    #[test]
    fn test_time_remaining_accepting() {
        let b = create_batch(1, test_pool_id(), 1000, test_config());
        assert_eq!(time_remaining_ms(&b, 3000), 6000); // 9000 - 3000
    }

    #[test]
    fn test_time_remaining_revealing() {
        let b = create_batch(1, test_pool_id(), 1000, test_config());
        assert_eq!(time_remaining_ms(&b, 9500), 1500); // 11000 - 9500
    }

    #[test]
    fn test_time_remaining_settling() {
        let b = create_batch(1, test_pool_id(), 1000, test_config());
        assert_eq!(time_remaining_ms(&b, 12000), 0);
    }

    #[test]
    fn test_time_remaining_at_boundary() {
        let b = create_batch(1, test_pool_id(), 1000, test_config());
        assert_eq!(time_remaining_ms(&b, 9000), 2000); // at reveal start, 2s left
    }

    #[test]
    fn test_is_accepting_commits_true() {
        let b = create_batch(1, test_pool_id(), 1000, test_config());
        assert!(is_accepting_commits(&b, 5000));
    }

    #[test]
    fn test_is_accepting_commits_false_revealing() {
        let b = create_batch(1, test_pool_id(), 1000, test_config());
        assert!(!is_accepting_commits(&b, 9500));
    }

    #[test]
    fn test_is_accepting_reveals_true() {
        let b = create_batch(1, test_pool_id(), 1000, test_config());
        assert!(is_accepting_reveals(&b, 9500));
    }

    #[test]
    fn test_is_accepting_reveals_false_accepting() {
        let b = create_batch(1, test_pool_id(), 1000, test_config());
        assert!(!is_accepting_reveals(&b, 5000));
    }

    #[test]
    fn test_transition_phase_to_revealing() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        let phase = transition_phase(&mut b, 9500).unwrap();
        assert_eq!(phase, BatchPhase::Revealing);
        assert_eq!(b.phase, BatchPhase::Revealing);
    }

    #[test]
    fn test_transition_phase_to_settling() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        let phase = transition_phase(&mut b, 12000).unwrap();
        assert_eq!(phase, BatchPhase::Settling);
    }

    #[test]
    fn test_transition_settled_fails() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        b.phase = BatchPhase::Settled;
        assert_eq!(transition_phase(&mut b, 1000), Err(BatchError::BatchFinalized));
    }

    #[test]
    fn test_transition_expired_fails() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        b.phase = BatchPhase::Expired;
        assert_eq!(transition_phase(&mut b, 1000), Err(BatchError::BatchFinalized));
    }

    // ============ Commit Operation Tests ============

    #[test]
    fn test_add_commit_success() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        let secret = test_secret(1);
        let commit = make_commit(100, true, &secret, test_depositor(1), 10, 1500);
        let idx = add_commit(&mut b, commit, 1500).unwrap();
        assert_eq!(idx, 0);
        assert_eq!(b.commits.len(), 1);
        assert_eq!(b.total_deposits, 10);
    }

    #[test]
    fn test_add_multiple_commits() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        for i in 0..5 {
            let secret = test_secret(i);
            let commit = make_commit(100, true, &secret, test_depositor(i), 10, 1500);
            let idx = add_commit(&mut b, commit, 1500).unwrap();
            assert_eq!(idx, i as usize);
        }
        assert_eq!(b.commits.len(), 5);
        assert_eq!(b.total_deposits, 50);
    }

    #[test]
    fn test_add_commit_wrong_phase() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        let secret = test_secret(1);
        let commit = make_commit(100, true, &secret, test_depositor(1), 10, 9500);
        let result = add_commit(&mut b, commit, 9500); // reveal phase
        assert_eq!(
            result,
            Err(BatchError::WrongPhase {
                expected: BatchPhase::Accepting,
                actual: BatchPhase::Revealing,
            })
        );
    }

    #[test]
    fn test_add_commit_max_orders() {
        let mut cfg = test_config();
        cfg.max_orders = 2;
        let mut b = create_batch(1, test_pool_id(), 1000, cfg);
        for i in 0..2 {
            let secret = test_secret(i);
            let commit = make_commit(100, true, &secret, test_depositor(i), 10, 1500);
            add_commit(&mut b, commit, 1500).unwrap();
        }
        let secret = test_secret(3);
        let commit = make_commit(100, true, &secret, test_depositor(3), 10, 1500);
        assert_eq!(add_commit(&mut b, commit, 1500), Err(BatchError::MaxOrdersReached { max: 2 }));
    }

    #[test]
    fn test_add_commit_not_eoa() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        let mut commit = make_commit(100, true, &test_secret(1), test_depositor(1), 10, 1500);
        commit.is_eoa = false;
        assert_eq!(add_commit(&mut b, commit, 1500), Err(BatchError::NotEoa));
    }

    #[test]
    fn test_add_commit_zero_deposit() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        let commit = make_commit(100, true, &test_secret(1), test_depositor(1), 0, 1500);
        assert_eq!(
            add_commit(&mut b, commit, 1500),
            Err(BatchError::InsufficientDeposit { required: 1, provided: 0 })
        );
    }

    #[test]
    fn test_compute_commit_hash_deterministic() {
        let secret = test_secret(42);
        let h1 = compute_commit_hash(1000, true, &secret);
        let h2 = compute_commit_hash(1000, true, &secret);
        assert_eq!(h1, h2);
    }

    #[test]
    fn test_compute_commit_hash_different_amounts() {
        let secret = test_secret(1);
        let h1 = compute_commit_hash(100, true, &secret);
        let h2 = compute_commit_hash(200, true, &secret);
        assert_ne!(h1, h2);
    }

    #[test]
    fn test_compute_commit_hash_different_sides() {
        let secret = test_secret(1);
        let h1 = compute_commit_hash(100, true, &secret);
        let h2 = compute_commit_hash(100, false, &secret);
        assert_ne!(h1, h2);
    }

    #[test]
    fn test_compute_commit_hash_different_secrets() {
        let h1 = compute_commit_hash(100, true, &test_secret(1));
        let h2 = compute_commit_hash(100, true, &test_secret(2));
        assert_ne!(h1, h2);
    }

    #[test]
    fn test_compute_commit_hash_zero_amount() {
        let h = compute_commit_hash(0, true, &test_secret(1));
        assert_ne!(h, [0u8; 32]); // still produces a valid hash
    }

    #[test]
    fn test_minimum_deposit_normal() {
        let cfg = test_config(); // 100 bps = 1%
        assert_eq!(minimum_deposit(10000, &cfg), 100);
    }

    #[test]
    fn test_minimum_deposit_small_amount() {
        let cfg = test_config();
        // 50 * 100 / 10000 = 0, but min is 1
        assert_eq!(minimum_deposit(50, &cfg), 1);
    }

    #[test]
    fn test_minimum_deposit_zero_amount() {
        let cfg = test_config();
        assert_eq!(minimum_deposit(0, &cfg), 0);
    }

    #[test]
    fn test_minimum_deposit_large_amount() {
        let cfg = test_config();
        assert_eq!(minimum_deposit(1_000_000, &cfg), 10_000);
    }

    #[test]
    fn test_minimum_deposit_full_bps() {
        let mut cfg = test_config();
        cfg.min_deposit_bps = 10000; // 100%
        assert_eq!(minimum_deposit(500, &cfg), 500);
    }

    #[test]
    fn test_commit_count_empty() {
        let b = create_batch(1, test_pool_id(), 1000, test_config());
        assert_eq!(commit_count(&b), 0);
    }

    #[test]
    fn test_commit_count_after_adds() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        for i in 0..3 {
            let commit = make_commit(100, true, &test_secret(i), test_depositor(i), 10, 1500);
            add_commit(&mut b, commit, 1500).unwrap();
        }
        assert_eq!(commit_count(&b), 3);
    }

    // ============ Reveal Operation Tests ============

    #[test]
    fn test_add_reveal_success() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        let secret = test_secret(1);
        let commit = make_commit(100, true, &secret, test_depositor(1), 10, 1500);
        add_commit(&mut b, commit, 1500).unwrap();

        let reveal = make_reveal(0, 100, true, secret, 0);
        assert!(add_reveal(&mut b, reveal, 9500).is_ok());
        assert_eq!(b.reveals.len(), 1);
    }

    #[test]
    fn test_add_reveal_wrong_phase_accepting() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        let secret = test_secret(1);
        let commit = make_commit(100, true, &secret, test_depositor(1), 10, 1500);
        add_commit(&mut b, commit, 1500).unwrap();

        let reveal = make_reveal(0, 100, true, secret, 0);
        assert_eq!(
            add_reveal(&mut b, reveal, 5000),
            Err(BatchError::WrongPhase {
                expected: BatchPhase::Revealing,
                actual: BatchPhase::Accepting,
            })
        );
    }

    #[test]
    fn test_add_reveal_wrong_phase_settling() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        let secret = test_secret(1);
        let commit = make_commit(100, true, &secret, test_depositor(1), 10, 1500);
        add_commit(&mut b, commit, 1500).unwrap();

        let reveal = make_reveal(0, 100, true, secret, 0);
        assert_eq!(
            add_reveal(&mut b, reveal, 12000),
            Err(BatchError::WrongPhase {
                expected: BatchPhase::Revealing,
                actual: BatchPhase::Settling,
            })
        );
    }

    #[test]
    fn test_add_reveal_invalid_index() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        let secret = test_secret(1);
        let commit = make_commit(100, true, &secret, test_depositor(1), 10, 1500);
        add_commit(&mut b, commit, 1500).unwrap();

        let reveal = make_reveal(5, 100, true, secret, 0);
        assert_eq!(
            add_reveal(&mut b, reveal, 9500),
            Err(BatchError::InvalidCommitIndex { index: 5, count: 1 })
        );
    }

    #[test]
    fn test_add_reveal_already_revealed() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        let secret = test_secret(1);
        let commit = make_commit(100, true, &secret, test_depositor(1), 10, 1500);
        add_commit(&mut b, commit, 1500).unwrap();

        let reveal = make_reveal(0, 100, true, secret, 0);
        add_reveal(&mut b, reveal.clone(), 9500).unwrap();
        assert_eq!(
            add_reveal(&mut b, reveal, 9500),
            Err(BatchError::AlreadyRevealed { index: 0 })
        );
    }

    #[test]
    fn test_add_reveal_hash_mismatch() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        let secret = test_secret(1);
        let commit = make_commit(100, true, &secret, test_depositor(1), 10, 1500);
        add_commit(&mut b, commit, 1500).unwrap();

        // Wrong amount
        let reveal = make_reveal(0, 999, true, secret, 0);
        assert_eq!(add_reveal(&mut b, reveal, 9500), Err(BatchError::RevealMismatch));
    }

    #[test]
    fn test_add_reveal_wrong_side_mismatch() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        let secret = test_secret(1);
        let commit = make_commit(100, true, &secret, test_depositor(1), 10, 1500);
        add_commit(&mut b, commit, 1500).unwrap();

        // Wrong side (sell instead of buy)
        let reveal = make_reveal(0, 100, false, secret, 0);
        assert_eq!(add_reveal(&mut b, reveal, 9500), Err(BatchError::RevealMismatch));
    }

    #[test]
    fn test_add_reveal_wrong_secret_mismatch() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        let secret = test_secret(1);
        let commit = make_commit(100, true, &secret, test_depositor(1), 10, 1500);
        add_commit(&mut b, commit, 1500).unwrap();

        // Wrong secret
        let reveal = make_reveal(0, 100, true, test_secret(99), 0);
        assert_eq!(add_reveal(&mut b, reveal, 9500), Err(BatchError::RevealMismatch));
    }

    #[test]
    fn test_verify_reveal_correct() {
        let secret = test_secret(5);
        let commit = make_commit(500, false, &secret, test_depositor(1), 50, 1000);
        let reveal = make_reveal(0, 500, false, secret, 0);
        assert!(verify_reveal(&commit, &reveal));
    }

    #[test]
    fn test_verify_reveal_incorrect() {
        let secret = test_secret(5);
        let commit = make_commit(500, false, &secret, test_depositor(1), 50, 1000);
        let reveal = make_reveal(0, 501, false, secret, 0);
        assert!(!verify_reveal(&commit, &reveal));
    }

    #[test]
    fn test_reveal_count_empty() {
        let b = create_batch(1, test_pool_id(), 1000, test_config());
        assert_eq!(reveal_count(&b), 0);
    }

    #[test]
    fn test_reveal_rate_bps_all_revealed() {
        let b = make_batch_with_commits_and_reveals(2, 100, 2, 100);
        assert_eq!(reveal_rate_bps(&b), 10000);
    }

    #[test]
    fn test_reveal_rate_bps_half_revealed() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        let ts = 1500;
        for i in 0..4u8 {
            let secret = test_secret(i);
            let commit = make_commit(100, true, &secret, test_depositor(i), 10, ts);
            b.commits.push(commit);
        }
        // Only reveal 2 out of 4
        for i in 0..2usize {
            let secret = test_secret(i as u8);
            let reveal = make_reveal(i, 100, true, secret, 0);
            b.reveals.push(reveal);
        }
        assert_eq!(reveal_rate_bps(&b), 5000);
    }

    #[test]
    fn test_reveal_rate_bps_none_revealed() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        let secret = test_secret(1);
        let commit = make_commit(100, true, &secret, test_depositor(1), 10, 1500);
        b.commits.push(commit);
        assert_eq!(reveal_rate_bps(&b), 0);
    }

    #[test]
    fn test_reveal_rate_bps_no_commits() {
        let b = create_batch(1, test_pool_id(), 1000, test_config());
        assert_eq!(reveal_rate_bps(&b), 0);
    }

    #[test]
    fn test_unrevealed_commits_all_unrevealed() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        for i in 0..3u8 {
            let commit = make_commit(100, true, &test_secret(i), test_depositor(i), 10, 1500);
            b.commits.push(commit);
        }
        assert_eq!(unrevealed_commits(&b), vec![0, 1, 2]);
    }

    #[test]
    fn test_unrevealed_commits_some_revealed() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        for i in 0..4u8 {
            let commit = make_commit(100, true, &test_secret(i), test_depositor(i), 10, 1500);
            b.commits.push(commit);
        }
        b.reveals.push(make_reveal(1, 100, true, test_secret(1), 0));
        b.reveals.push(make_reveal(3, 100, true, test_secret(3), 0));
        assert_eq!(unrevealed_commits(&b), vec![0, 2]);
    }

    #[test]
    fn test_unrevealed_commits_all_revealed() {
        let b = make_batch_with_commits_and_reveals(3, 100, 0, 0);
        assert!(unrevealed_commits(&b).is_empty());
    }

    #[test]
    fn test_slash_unrevealed_basic() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        // 50% slash rate
        let commit = make_commit(100, true, &test_secret(1), test_depositor(1), 200, 1500);
        b.commits.push(commit);
        // No reveals => slash 50% of 200 = 100
        let slashed = slash_unrevealed(&mut b);
        assert_eq!(slashed, 100);
        assert_eq!(b.total_slashed, 100);
    }

    #[test]
    fn test_slash_unrevealed_none_to_slash() {
        let mut b = make_batch_with_commits_and_reveals(2, 100, 0, 0);
        let slashed = slash_unrevealed(&mut b);
        assert_eq!(slashed, 0);
    }

    #[test]
    fn test_slash_unrevealed_multiple() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        for i in 0..3u8 {
            let commit = make_commit(100, true, &test_secret(i), test_depositor(i), 100, 1500);
            b.commits.push(commit);
            b.total_deposits += 100;
        }
        // Reveal only index 1
        b.reveals.push(make_reveal(1, 100, true, test_secret(1), 0));
        // Slash indices 0 and 2: 50% of 100 each = 50 + 50 = 100
        let slashed = slash_unrevealed(&mut b);
        assert_eq!(slashed, 100);
    }

    // ============ Settlement Tests ============

    #[test]
    fn test_can_settle_true() {
        let mut b = make_batch_with_commits_and_reveals(1, 100, 1, 100);
        b.phase = BatchPhase::Accepting; // not finalized
        assert!(can_settle(&b, 12000)); // past reveal window
    }

    #[test]
    fn test_can_settle_false_still_revealing() {
        let b = make_batch_with_commits_and_reveals(1, 100, 1, 100);
        assert!(!can_settle(&b, 9500));
    }

    #[test]
    fn test_can_settle_false_not_enough_reveals() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        let commit = make_commit(100, true, &test_secret(1), test_depositor(1), 10, 1500);
        b.commits.push(commit);
        // Only 1 reveal, min is 2
        b.reveals.push(make_reveal(0, 100, true, test_secret(1), 0));
        assert!(!can_settle(&b, 12000));
    }

    #[test]
    fn test_can_settle_false_already_settled() {
        let mut b = make_batch_with_commits_and_reveals(1, 100, 1, 100);
        b.phase = BatchPhase::Settled;
        assert!(!can_settle(&b, 12000));
    }

    #[test]
    fn test_compute_clearing_price_balanced() {
        let reveals = vec![
            make_reveal(0, 1000, true, test_secret(0), 0),
            make_reveal(1, 1000, false, test_secret(1), 0),
        ];
        let price = compute_clearing_price(&reveals, 10000, 10000);
        // Balanced => price = reserve_b / reserve_a * BPS = 10000
        assert_eq!(price, 10000);
    }

    #[test]
    fn test_compute_clearing_price_buy_heavy() {
        let reveals = vec![
            make_reveal(0, 2000, true, test_secret(0), 0),
            make_reveal(1, 1000, true, test_secret(1), 0),
            make_reveal(2, 500, false, test_secret(2), 0),
        ];
        // More buys => price should go up
        let price = compute_clearing_price(&reveals, 10000, 10000);
        assert!(price > 10000);
    }

    #[test]
    fn test_compute_clearing_price_sell_heavy() {
        let reveals = vec![
            make_reveal(0, 500, true, test_secret(0), 0),
            make_reveal(1, 2000, false, test_secret(1), 0),
            make_reveal(2, 1000, false, test_secret(2), 0),
        ];
        let price = compute_clearing_price(&reveals, 10000, 10000);
        assert!(price < 10000);
    }

    #[test]
    fn test_compute_clearing_price_zero_reserves() {
        let reveals = vec![make_reveal(0, 100, true, test_secret(0), 0)];
        assert_eq!(compute_clearing_price(&reveals, 0, 10000), 0);
        assert_eq!(compute_clearing_price(&reveals, 10000, 0), 0);
    }

    #[test]
    fn test_compute_clearing_price_empty_reveals() {
        let price = compute_clearing_price(&[], 10000, 10000);
        assert_eq!(price, 10000); // falls back to base price
    }

    #[test]
    fn test_settle_batch_success() {
        let mut b = make_batch_with_commits_and_reveals(2, 1000, 2, 1000);
        b.phase = BatchPhase::Accepting;
        let result = settle_batch(&mut b, 10000, 10000, 12000).unwrap();
        assert_eq!(result.batch_id, 1);
        assert!(result.clearing_price > 0);
        assert_eq!(result.total_buy_volume, 2000);
        assert_eq!(result.total_sell_volume, 2000);
        assert!(result.matched_volume > 0);
        assert!(result.fill_count > 0);
        assert_eq!(b.phase, BatchPhase::Settled);
    }

    #[test]
    fn test_settle_batch_already_settled() {
        let mut b = make_batch_with_commits_and_reveals(2, 1000, 2, 1000);
        b.phase = BatchPhase::Settled;
        assert_eq!(settle_batch(&mut b, 10000, 10000, 12000), Err(BatchError::BatchFinalized));
    }

    #[test]
    fn test_settle_batch_zero_reserves() {
        let mut b = make_batch_with_commits_and_reveals(2, 1000, 2, 1000);
        b.phase = BatchPhase::Accepting;
        assert_eq!(settle_batch(&mut b, 0, 10000, 12000), Err(BatchError::ZeroReserves));
    }

    #[test]
    fn test_settle_batch_insufficient_reveals() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        let commit = make_commit(100, true, &test_secret(1), test_depositor(1), 10, 1500);
        b.commits.push(commit);
        b.reveals.push(make_reveal(0, 100, true, test_secret(1), 0));
        assert_eq!(
            settle_batch(&mut b, 10000, 10000, 12000),
            Err(BatchError::InsufficientReveals { required: 2, actual: 1 })
        );
    }

    #[test]
    fn test_compute_fills_basic() {
        let reveals = vec![
            make_reveal(0, 1000, true, test_secret(0), 0),
            make_reveal(1, 2000, false, test_secret(1), 0),
        ];
        let fills = compute_fills(&reveals, 10000);
        assert_eq!(fills.len(), 2);
        // First: 1000 - 1000*30/10000 = 1000 - 3 = 997
        assert_eq!(fills[0], (0, 997, 3));
        // Second: 2000 - 2000*30/10000 = 2000 - 6 = 1994
        assert_eq!(fills[1], (1, 1994, 6));
    }

    #[test]
    fn test_compute_fills_zero_price() {
        let reveals = vec![make_reveal(0, 1000, true, test_secret(0), 0)];
        let fills = compute_fills(&reveals, 0);
        assert_eq!(fills[0], (0, 0, 0));
    }

    #[test]
    fn test_settlement_quality_perfect() {
        let result = BatchResult {
            batch_id: 1,
            clearing_price: 10000,
            total_buy_volume: 5000,
            total_sell_volume: 5000,
            matched_volume: 10000,
            total_fees: 30,
            total_slashed: 0,
            fill_count: 20,
            average_fill_rate_bps: 10000, // 100%
            quality_score: 0,
        };
        let q = settlement_quality(&result);
        assert_eq!(q, 10000); // perfect score
    }

    #[test]
    fn test_settlement_quality_imbalanced() {
        let result = BatchResult {
            batch_id: 1,
            clearing_price: 10000,
            total_buy_volume: 9000,
            total_sell_volume: 1000,
            matched_volume: 2000,
            total_fees: 6,
            total_slashed: 0,
            fill_count: 2,
            average_fill_rate_bps: 2000,
            quality_score: 0,
        };
        let q = settlement_quality(&result);
        assert!(q < 5000); // poor due to imbalance and low fill count
    }

    #[test]
    fn test_settlement_quality_zero_volume() {
        let result = BatchResult {
            batch_id: 1,
            clearing_price: 0,
            total_buy_volume: 0,
            total_sell_volume: 0,
            matched_volume: 0,
            total_fees: 0,
            total_slashed: 0,
            fill_count: 0,
            average_fill_rate_bps: 0,
            quality_score: 0,
        };
        let q = settlement_quality(&result);
        assert_eq!(q, 0);
    }

    // ============ Batch Analysis Tests ============

    #[test]
    fn test_buy_sell_ratio_balanced() {
        let b = make_batch_with_commits_and_reveals(2, 500, 2, 500);
        let (buys, sells) = buy_sell_ratio(&b);
        assert_eq!(buys, 1000);
        assert_eq!(sells, 1000);
    }

    #[test]
    fn test_buy_sell_ratio_buy_heavy() {
        let b = make_batch_with_commits_and_reveals(3, 1000, 1, 500);
        let (buys, sells) = buy_sell_ratio(&b);
        assert_eq!(buys, 3000);
        assert_eq!(sells, 500);
    }

    #[test]
    fn test_buy_sell_ratio_empty() {
        let b = create_batch(1, test_pool_id(), 1000, test_config());
        let (buys, sells) = buy_sell_ratio(&b);
        assert_eq!(buys, 0);
        assert_eq!(sells, 0);
    }

    #[test]
    fn test_order_imbalance_balanced() {
        let b = make_batch_with_commits_and_reveals(2, 500, 2, 500);
        assert_eq!(order_imbalance_bps(&b), 0);
    }

    #[test]
    fn test_order_imbalance_full() {
        let b = make_batch_with_commits_and_reveals(2, 500, 0, 0);
        assert_eq!(order_imbalance_bps(&b), 10000); // all buys
    }

    #[test]
    fn test_order_imbalance_empty() {
        let b = create_batch(1, test_pool_id(), 1000, test_config());
        assert_eq!(order_imbalance_bps(&b), 0);
    }

    #[test]
    fn test_order_imbalance_partial() {
        let b = make_batch_with_commits_and_reveals(3, 1000, 1, 1000);
        // buys=3000, sells=1000, total=4000, diff=2000
        // 2000 * 10000 / 4000 = 5000
        assert_eq!(order_imbalance_bps(&b), 5000);
    }

    #[test]
    fn test_avg_order_size_normal() {
        let b = make_batch_with_commits_and_reveals(2, 1000, 2, 500);
        // total = 2000 + 1000 = 3000, count = 4
        assert_eq!(avg_order_size(&b), 750);
    }

    #[test]
    fn test_avg_order_size_empty() {
        let b = create_batch(1, test_pool_id(), 1000, test_config());
        assert_eq!(avg_order_size(&b), 0);
    }

    #[test]
    fn test_priority_fee_total_none() {
        let b = make_batch_with_commits_and_reveals(2, 100, 2, 100);
        assert_eq!(priority_fee_total(&b), 0);
    }

    #[test]
    fn test_priority_fee_total_with_fees() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        b.reveals.push(make_reveal(0, 100, true, test_secret(0), 50));
        b.reveals.push(make_reveal(1, 200, false, test_secret(1), 75));
        assert_eq!(priority_fee_total(&b), 125);
    }

    #[test]
    fn test_deposit_utilization_full() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        b.total_deposits = 1000;
        b.reveals.push(make_reveal(0, 500, true, test_secret(0), 0));
        b.reveals.push(make_reveal(1, 500, false, test_secret(1), 0));
        assert_eq!(deposit_utilization_bps(&b), 10000);
    }

    #[test]
    fn test_deposit_utilization_zero_deposits() {
        let b = create_batch(1, test_pool_id(), 1000, test_config());
        assert_eq!(deposit_utilization_bps(&b), 0);
    }

    #[test]
    fn test_deposit_utilization_partial() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        b.total_deposits = 2000;
        b.reveals.push(make_reveal(0, 500, true, test_secret(0), 0));
        // 500 / 2000 * 10000 = 2500
        assert_eq!(deposit_utilization_bps(&b), 2500);
    }

    #[test]
    fn test_effective_fee_rate_normal() {
        let result = BatchResult {
            batch_id: 1,
            clearing_price: 10000,
            total_buy_volume: 5000,
            total_sell_volume: 5000,
            matched_volume: 10000,
            total_fees: 30,
            total_slashed: 0,
            fill_count: 10,
            average_fill_rate_bps: 10000,
            quality_score: 10000,
        };
        // 30 / 10000 * 10000 = 30
        assert_eq!(effective_fee_rate_bps(&result), 30);
    }

    #[test]
    fn test_effective_fee_rate_zero_volume() {
        let result = BatchResult {
            batch_id: 1,
            clearing_price: 0,
            total_buy_volume: 0,
            total_sell_volume: 0,
            matched_volume: 0,
            total_fees: 0,
            total_slashed: 0,
            fill_count: 0,
            average_fill_rate_bps: 0,
            quality_score: 0,
        };
        assert_eq!(effective_fee_rate_bps(&result), 0);
    }

    // ============ Multi-Batch Stats Tests ============

    #[test]
    fn test_compute_batch_stats_basic() {
        let results = vec![
            BatchResult {
                batch_id: 1, clearing_price: 10000,
                total_buy_volume: 1000, total_sell_volume: 1000,
                matched_volume: 2000, total_fees: 6, total_slashed: 50,
                fill_count: 4, average_fill_rate_bps: 10000, quality_score: 8000,
            },
            BatchResult {
                batch_id: 2, clearing_price: 10000,
                total_buy_volume: 2000, total_sell_volume: 2000,
                matched_volume: 4000, total_fees: 12, total_slashed: 0,
                fill_count: 8, average_fill_rate_bps: 10000, quality_score: 9000,
            },
        ];
        let stats = compute_batch_stats(&results, 1);
        assert_eq!(stats.total_batches, 3);
        assert_eq!(stats.settled_batches, 2);
        assert_eq!(stats.expired_batches, 1);
        assert_eq!(stats.total_volume, 6000);
        assert_eq!(stats.total_fees_collected, 18);
        assert_eq!(stats.total_slashed, 50);
        assert_eq!(stats.avg_orders_per_batch, 6);
        assert_eq!(stats.avg_reveal_rate_bps, 10000);
        assert_eq!(stats.avg_settlement_quality, 8500);
    }

    #[test]
    fn test_compute_batch_stats_empty() {
        let stats = compute_batch_stats(&[], 0);
        assert_eq!(stats.total_batches, 0);
        assert_eq!(stats.settled_batches, 0);
        assert_eq!(stats.avg_orders_per_batch, 0);
    }

    #[test]
    fn test_compute_batch_stats_only_expired() {
        let stats = compute_batch_stats(&[], 5);
        assert_eq!(stats.total_batches, 5);
        assert_eq!(stats.settled_batches, 0);
        assert_eq!(stats.expired_batches, 5);
    }

    #[test]
    fn test_batch_throughput_normal() {
        let stats = BatchStats {
            total_batches: 100,
            settled_batches: 90, expired_batches: 10,
            total_volume: 0, total_fees_collected: 0, total_slashed: 0,
            avg_orders_per_batch: 0, avg_reveal_rate_bps: 0, avg_settlement_quality: 0,
        };
        // 100 batches in 10,000 ms = 10 per second => 10 * 1000 = 10000
        assert_eq!(batch_throughput(&stats, 10_000), 10000);
    }

    #[test]
    fn test_batch_throughput_zero_time() {
        let stats = BatchStats {
            total_batches: 100,
            settled_batches: 100, expired_batches: 0,
            total_volume: 0, total_fees_collected: 0, total_slashed: 0,
            avg_orders_per_batch: 0, avg_reveal_rate_bps: 0, avg_settlement_quality: 0,
        };
        assert_eq!(batch_throughput(&stats, 0), 0);
    }

    #[test]
    fn test_volume_weighted_quality_basic() {
        let results = vec![
            BatchResult {
                batch_id: 1, clearing_price: 10000,
                total_buy_volume: 0, total_sell_volume: 0,
                matched_volume: 1000, total_fees: 0, total_slashed: 0,
                fill_count: 0, average_fill_rate_bps: 0, quality_score: 8000,
            },
            BatchResult {
                batch_id: 2, clearing_price: 10000,
                total_buy_volume: 0, total_sell_volume: 0,
                matched_volume: 3000, total_fees: 0, total_slashed: 0,
                fill_count: 0, average_fill_rate_bps: 0, quality_score: 4000,
            },
        ];
        // weighted = (1000*8000 + 3000*4000) / 4000 = (8M + 12M) / 4000 = 5000
        assert_eq!(volume_weighted_quality(&results), 5000);
    }

    #[test]
    fn test_volume_weighted_quality_empty() {
        assert_eq!(volume_weighted_quality(&[]), 0);
    }

    #[test]
    fn test_volume_weighted_quality_zero_volume() {
        let results = vec![
            BatchResult {
                batch_id: 1, clearing_price: 0,
                total_buy_volume: 0, total_sell_volume: 0,
                matched_volume: 0, total_fees: 0, total_slashed: 0,
                fill_count: 0, average_fill_rate_bps: 0, quality_score: 5000,
            },
        ];
        assert_eq!(volume_weighted_quality(&results), 0);
    }

    #[test]
    fn test_fee_efficiency_normal() {
        let stats = BatchStats {
            total_batches: 10, settled_batches: 10, expired_batches: 0,
            total_volume: 100000, total_fees_collected: 300, total_slashed: 0,
            avg_orders_per_batch: 0, avg_reveal_rate_bps: 0, avg_settlement_quality: 0,
        };
        // 300 / 100000 * 10000 = 30
        assert_eq!(fee_efficiency(&stats), 30);
    }

    #[test]
    fn test_fee_efficiency_zero_volume() {
        let stats = BatchStats {
            total_batches: 0, settled_batches: 0, expired_batches: 0,
            total_volume: 0, total_fees_collected: 0, total_slashed: 0,
            avg_orders_per_batch: 0, avg_reveal_rate_bps: 0, avg_settlement_quality: 0,
        };
        assert_eq!(fee_efficiency(&stats), 0);
    }

    // ============ Lifecycle Tests ============

    #[test]
    fn test_expire_batch_success() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        let commit = make_commit(100, true, &test_secret(1), test_depositor(1), 200, 1500);
        b.commits.push(commit);
        b.total_deposits = 200;
        // No reveals, expire after reveal window
        let refund = expire_batch(&mut b, 12000).unwrap();
        assert_eq!(b.phase, BatchPhase::Expired);
        // refund = 200 - 50% slash = 100
        assert_eq!(refund, 100);
    }

    #[test]
    fn test_expire_batch_too_early() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        assert_eq!(expire_batch(&mut b, 5000), Err(BatchError::NotExpired));
    }

    #[test]
    fn test_expire_batch_already_settled() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        b.phase = BatchPhase::Settled;
        assert_eq!(expire_batch(&mut b, 12000), Err(BatchError::BatchFinalized));
    }

    #[test]
    fn test_expire_batch_already_expired() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        b.phase = BatchPhase::Expired;
        assert_eq!(expire_batch(&mut b, 12000), Err(BatchError::BatchFinalized));
    }

    #[test]
    fn test_expire_batch_with_reveals() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        for i in 0..3u8 {
            let commit = make_commit(100, true, &test_secret(i), test_depositor(i), 100, 1500);
            b.commits.push(commit);
            b.total_deposits += 100;
        }
        // Reveal index 1 only
        b.reveals.push(make_reveal(1, 100, true, test_secret(1), 0));
        let refund = expire_batch(&mut b, 12000).unwrap();
        // Index 0 and 2 unrevealed: refund = 100 - 50 = 50 each = 100
        // Index 1 revealed: refund = 100
        // Total = 100 + 100 + 50 = ... wait, let me recalc
        // refund_amounts: idx0 = 100-50=50, idx1 = 100, idx2 = 100-50=50 => total = 200
        assert_eq!(refund, 200);
    }

    #[test]
    fn test_refund_amounts_all_revealed() {
        let mut b = make_batch_with_commits_and_reveals(2, 100, 0, 0);
        let refunds = refund_amounts(&b);
        assert_eq!(refunds.len(), 2);
        for (_, amt) in &refunds {
            assert_eq!(*amt, 10); // full deposit back (100/10)
        }
    }

    #[test]
    fn test_refund_amounts_none_revealed() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        let commit = make_commit(100, true, &test_secret(1), test_depositor(1), 100, 1500);
        b.commits.push(commit);
        let refunds = refund_amounts(&b);
        // 100 - 50% = 50
        assert_eq!(refunds[0].1, 50);
    }

    #[test]
    fn test_refund_amounts_empty_batch() {
        let b = create_batch(1, test_pool_id(), 1000, test_config());
        let refunds = refund_amounts(&b);
        assert!(refunds.is_empty());
    }

    #[test]
    fn test_next_batch_id_normal() {
        assert_eq!(next_batch_id(0), 1);
        assert_eq!(next_batch_id(41), 42);
        assert_eq!(next_batch_id(999), 1000);
    }

    #[test]
    fn test_next_batch_id_max() {
        assert_eq!(next_batch_id(u64::MAX), u64::MAX); // saturating
    }

    #[test]
    fn test_batch_duration_ms_default() {
        let cfg = test_config();
        assert_eq!(batch_duration_ms(&cfg), 10000); // 8000 + 2000
    }

    #[test]
    fn test_batch_duration_ms_custom() {
        let mut cfg = test_config();
        cfg.commit_duration_ms = 5000;
        cfg.reveal_duration_ms = 3000;
        assert_eq!(batch_duration_ms(&cfg), 8000);
    }

    #[test]
    fn test_batch_duration_ms_overflow_safe() {
        let mut cfg = test_config();
        cfg.commit_duration_ms = u64::MAX;
        cfg.reveal_duration_ms = 1000;
        assert_eq!(batch_duration_ms(&cfg), u64::MAX); // saturating
    }

    // ============ Validation Tests ============

    #[test]
    fn test_validate_batch_sequence_valid() {
        let batches = vec![
            create_batch(0, test_pool_id(), 0, test_config()),
            create_batch(1, test_pool_id(), 10000, test_config()),
            create_batch(2, test_pool_id(), 20000, test_config()),
        ];
        assert!(validate_batch_sequence(&batches));
    }

    #[test]
    fn test_validate_batch_sequence_empty() {
        assert!(validate_batch_sequence(&[]));
    }

    #[test]
    fn test_validate_batch_sequence_single() {
        let batches = vec![create_batch(0, test_pool_id(), 0, test_config())];
        assert!(validate_batch_sequence(&batches));
    }

    #[test]
    fn test_validate_batch_sequence_non_sequential_ids() {
        let batches = vec![
            create_batch(0, test_pool_id(), 0, test_config()),
            create_batch(5, test_pool_id(), 10000, test_config()), // gap
        ];
        assert!(!validate_batch_sequence(&batches));
    }

    #[test]
    fn test_validate_batch_sequence_time_overlap() {
        let batches = vec![
            create_batch(0, test_pool_id(), 0, test_config()),
            create_batch(1, test_pool_id(), 5000, test_config()), // overlaps with first (ends at 10000)
        ];
        assert!(!validate_batch_sequence(&batches));
    }

    #[test]
    fn test_validate_batch_sequence_exact_adjacent() {
        let batches = vec![
            create_batch(0, test_pool_id(), 0, test_config()),
            create_batch(1, test_pool_id(), 10000, test_config()), // starts exactly when first ends
        ];
        assert!(validate_batch_sequence(&batches));
    }

    #[test]
    fn test_is_valid_batch_good() {
        let b = make_batch_with_commits_and_reveals(2, 100, 2, 100);
        assert!(is_valid_batch(&b));
    }

    #[test]
    fn test_is_valid_batch_bad_config() {
        let mut cfg = test_config();
        cfg.commit_duration_ms = 0;
        let b = create_batch(1, test_pool_id(), 1000, cfg);
        assert!(!is_valid_batch(&b));
    }

    #[test]
    fn test_is_valid_batch_reveal_out_of_bounds() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        let commit = make_commit(100, true, &test_secret(1), test_depositor(1), 10, 1500);
        b.commits.push(commit);
        b.reveals.push(make_reveal(5, 100, true, test_secret(1), 0)); // index 5 doesn't exist
        assert!(!is_valid_batch(&b));
    }

    #[test]
    fn test_is_valid_batch_duplicate_reveals() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        let commit = make_commit(100, true, &test_secret(1), test_depositor(1), 10, 1500);
        b.commits.push(commit);
        b.reveals.push(make_reveal(0, 100, true, test_secret(1), 0));
        b.reveals.push(make_reveal(0, 100, true, test_secret(1), 0)); // duplicate
        assert!(!is_valid_batch(&b));
    }

    #[test]
    fn test_is_valid_batch_more_reveals_than_commits() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        b.reveals.push(make_reveal(0, 100, true, test_secret(1), 0));
        assert!(!is_valid_batch(&b));
    }

    #[test]
    fn test_is_valid_batch_settled_without_price() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        b.phase = BatchPhase::Settled;
        b.clearing_price = None;
        assert!(!is_valid_batch(&b));
    }

    #[test]
    fn test_is_valid_batch_settled_with_price() {
        let mut b = make_batch_with_commits_and_reveals(2, 100, 2, 100);
        b.phase = BatchPhase::Settled;
        b.clearing_price = Some(10000);
        assert!(is_valid_batch(&b));
    }

    // ============ Edge Case & Overflow Tests ============

    #[test]
    fn test_large_amounts_no_overflow() {
        let b = make_batch_with_commits_and_reveals(1, u64::MAX / 2, 1, u64::MAX / 2);
        let (buys, sells) = buy_sell_ratio(&b);
        assert_eq!(buys, u64::MAX / 2);
        assert_eq!(sells, u64::MAX / 2);
    }

    #[test]
    fn test_clearing_price_asymmetric_reserves() {
        let reveals = vec![
            make_reveal(0, 100, true, test_secret(0), 0),
            make_reveal(1, 100, false, test_secret(1), 0),
        ];
        // reserve_b >> reserve_a => high price
        let price = compute_clearing_price(&reveals, 100, 1_000_000);
        assert!(price > 10000);
    }

    #[test]
    fn test_minimum_deposit_max_u64() {
        let cfg = test_config();
        // Should not overflow
        let dep = minimum_deposit(u64::MAX, &cfg);
        assert!(dep > 0);
    }

    #[test]
    fn test_slash_with_100_percent_rate() {
        let mut cfg = test_config();
        cfg.slash_rate_bps = 10000; // 100%
        let mut b = create_batch(1, test_pool_id(), 1000, cfg);
        let commit = make_commit(100, true, &test_secret(1), test_depositor(1), 500, 1500);
        b.commits.push(commit);
        let slashed = slash_unrevealed(&mut b);
        assert_eq!(slashed, 500); // full deposit
    }

    #[test]
    fn test_slash_with_zero_percent_rate() {
        let mut cfg = test_config();
        cfg.slash_rate_bps = 0;
        let mut b = create_batch(1, test_pool_id(), 1000, cfg);
        let commit = make_commit(100, true, &test_secret(1), test_depositor(1), 500, 1500);
        b.commits.push(commit);
        let slashed = slash_unrevealed(&mut b);
        assert_eq!(slashed, 0);
    }

    #[test]
    fn test_phase_with_custom_durations() {
        let mut cfg = test_config();
        cfg.commit_duration_ms = 100;
        cfg.reveal_duration_ms = 50;
        let b = create_batch(1, test_pool_id(), 0, cfg);
        assert_eq!(current_phase(&b, 0), BatchPhase::Accepting);
        assert_eq!(current_phase(&b, 99), BatchPhase::Accepting);
        assert_eq!(current_phase(&b, 100), BatchPhase::Revealing);
        assert_eq!(current_phase(&b, 149), BatchPhase::Revealing);
        assert_eq!(current_phase(&b, 150), BatchPhase::Settling);
    }

    #[test]
    fn test_batch_with_only_buys() {
        let b = make_batch_with_commits_and_reveals(5, 1000, 0, 0);
        let (buys, sells) = buy_sell_ratio(&b);
        assert_eq!(buys, 5000);
        assert_eq!(sells, 0);
        assert_eq!(order_imbalance_bps(&b), 10000);
    }

    #[test]
    fn test_batch_with_only_sells() {
        let b = make_batch_with_commits_and_reveals(0, 0, 5, 1000);
        let (buys, sells) = buy_sell_ratio(&b);
        assert_eq!(buys, 0);
        assert_eq!(sells, 5000);
        assert_eq!(order_imbalance_bps(&b), 10000);
    }

    #[test]
    fn test_priority_fee_saturation() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        b.reveals.push(make_reveal(0, 100, true, test_secret(0), u64::MAX / 2));
        b.reveals.push(make_reveal(1, 100, false, test_secret(1), u64::MAX / 2));
        let total = priority_fee_total(&b);
        // saturating add should not overflow
        assert_eq!(total, u64::MAX - 1);
    }

    #[test]
    fn test_settle_sets_clearing_price() {
        let mut b = make_batch_with_commits_and_reveals(2, 1000, 2, 1000);
        b.phase = BatchPhase::Accepting;
        settle_batch(&mut b, 10000, 10000, 12000).unwrap();
        assert!(b.clearing_price.is_some());
    }

    #[test]
    fn test_settle_computes_quality() {
        let mut b = make_batch_with_commits_and_reveals(2, 1000, 2, 1000);
        b.phase = BatchPhase::Accepting;
        let result = settle_batch(&mut b, 10000, 10000, 12000).unwrap();
        assert!(result.quality_score > 0);
    }

    #[test]
    fn test_refund_preserves_depositor() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        let depositor = [0xBB; 32];
        let commit = make_commit(100, true, &test_secret(1), depositor, 100, 1500);
        b.commits.push(commit);
        let refunds = refund_amounts(&b);
        assert_eq!(refunds[0].0, depositor);
    }

    #[test]
    fn test_multiple_batch_stats_single_result() {
        let results = vec![BatchResult {
            batch_id: 1,
            clearing_price: 10000,
            total_buy_volume: 5000,
            total_sell_volume: 5000,
            matched_volume: 10000,
            total_fees: 30,
            total_slashed: 100,
            fill_count: 10,
            average_fill_rate_bps: 10000,
            quality_score: 9000,
        }];
        let stats = compute_batch_stats(&results, 0);
        assert_eq!(stats.total_batches, 1);
        assert_eq!(stats.total_volume, 10000);
        assert_eq!(stats.avg_settlement_quality, 9000);
    }

    #[test]
    fn test_effective_fee_rate_high_fees() {
        let result = BatchResult {
            batch_id: 1,
            clearing_price: 10000,
            total_buy_volume: 500,
            total_sell_volume: 500,
            matched_volume: 1000,
            total_fees: 500,
            total_slashed: 0,
            fill_count: 2,
            average_fill_rate_bps: 10000,
            quality_score: 5000,
        };
        // 500/1000 * 10000 = 5000 bps = 50%
        assert_eq!(effective_fee_rate_bps(&result), 5000);
    }

    #[test]
    fn test_commit_hash_all_zeros() {
        let h = compute_commit_hash(0, false, &[0u8; 32]);
        // Should be a valid hash, not all zeros
        assert_ne!(h, [0u8; 32]);
    }

    #[test]
    fn test_commit_hash_max_amount() {
        let h = compute_commit_hash(u64::MAX, true, &[0xFF; 32]);
        assert_ne!(h, [0u8; 32]);
    }

    #[test]
    fn test_phase_before_start() {
        let b = create_batch(1, test_pool_id(), 5000, test_config());
        // now_ms = 1000, start = 5000, so we're "before" the batch
        // commit_end = 13000, 1000 < 13000 => Accepting
        assert_eq!(current_phase(&b, 1000), BatchPhase::Accepting);
    }

    #[test]
    fn test_batch_throughput_single_batch() {
        let stats = BatchStats {
            total_batches: 1,
            settled_batches: 1, expired_batches: 0,
            total_volume: 0, total_fees_collected: 0, total_slashed: 0,
            avg_orders_per_batch: 0, avg_reveal_rate_bps: 0, avg_settlement_quality: 0,
        };
        // 1 batch in 10_000 ms => 0.1/s => 100 per 1000
        assert_eq!(batch_throughput(&stats, 10_000), 100);
    }

    #[test]
    fn test_avg_order_size_single_order() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        b.reveals.push(make_reveal(0, 42000, true, test_secret(0), 0));
        assert_eq!(avg_order_size(&b), 42000);
    }

    #[test]
    fn test_validate_config_one_order() {
        let mut cfg = test_config();
        cfg.min_orders = 1;
        cfg.max_orders = 1;
        assert!(validate_config(&cfg).is_ok());
    }

    #[test]
    fn test_expire_batch_at_exact_boundary() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        // reveal ends at 11000
        assert_eq!(expire_batch(&mut b, 10999), Err(BatchError::NotExpired));
        assert!(expire_batch(&mut b, 11000).is_ok());
    }

    #[test]
    fn test_reveal_at_exact_boundary_start() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        let secret = test_secret(1);
        let commit = make_commit(100, true, &secret, test_depositor(1), 10, 1500);
        add_commit(&mut b, commit, 1500).unwrap();

        // Reveal at exactly the start of reveal phase (9000)
        let reveal = make_reveal(0, 100, true, secret, 0);
        assert!(add_reveal(&mut b, reveal, 9000).is_ok());
    }

    #[test]
    fn test_reveal_at_exact_boundary_end() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        let secret = test_secret(1);
        let commit = make_commit(100, true, &secret, test_depositor(1), 10, 1500);
        add_commit(&mut b, commit, 1500).unwrap();

        // Reveal at exactly 11000 (reveal phase ended)
        let reveal = make_reveal(0, 100, true, secret, 0);
        assert!(add_reveal(&mut b, reveal, 11000).is_err());
    }

    #[test]
    fn test_commit_at_exact_boundary() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        let secret = test_secret(1);
        let commit = make_commit(100, true, &secret, test_depositor(1), 10, 9000);
        // commit phase ends at 9000, so 9000 is reveal phase
        assert!(add_commit(&mut b, commit, 9000).is_err());
    }

    #[test]
    fn test_deposit_utilization_overflow_safe() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        b.total_deposits = 1;
        b.reveals.push(make_reveal(0, u64::MAX, true, test_secret(0), 0));
        // Should cap at BPS (10000) not overflow
        let util = deposit_utilization_bps(&b);
        assert_eq!(util, BPS);
    }

    #[test]
    fn test_settle_slashes_unrevealed() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        // 3 commits, only 2 revealed
        for i in 0..3u8 {
            let secret = test_secret(i);
            let is_buy = i < 2;
            let commit = make_commit(1000, is_buy, &secret, test_depositor(i), 100, 1500);
            b.commits.push(commit);
            b.total_deposits += 100;
        }
        // Reveal first two
        b.reveals.push(make_reveal(0, 1000, true, test_secret(0), 0));
        b.reveals.push(make_reveal(1, 1000, true, test_secret(1), 0));
        // Index 2 unrevealed

        let result = settle_batch(&mut b, 10000, 10000, 12000).unwrap();
        // Slash = 50% of 100 = 50
        assert_eq!(result.total_slashed, 50);
    }

    // ============ Hardening Round 6 ============

    #[test]
    fn test_create_batch_preserves_config_h6() {
        let cfg = test_config();
        let b = create_batch(42, test_pool_id(), 5000, cfg.clone());
        assert_eq!(b.batch_id, 42);
        assert_eq!(b.pool_id, test_pool_id());
        assert_eq!(b.start_time_ms, 5000);
        assert_eq!(b.config.commit_duration_ms, cfg.commit_duration_ms);
    }

    #[test]
    fn test_validate_config_all_valid_h6() {
        let cfg = BatchConfig {
            commit_duration_ms: 1,
            reveal_duration_ms: 1,
            min_orders: 1,
            max_orders: 1,
            min_deposit_bps: 0,
            slash_rate_bps: 0,
            fee_rate_bps: 0,
            priority_fee_enabled: false,
        };
        assert!(validate_config(&cfg).is_ok());
    }

    #[test]
    fn test_validate_config_boundary_max_slash_h6() {
        let mut cfg = test_config();
        cfg.slash_rate_bps = MAX_SLASH_BPS;
        assert!(validate_config(&cfg).is_ok());
        cfg.slash_rate_bps = MAX_SLASH_BPS + 1;
        assert!(validate_config(&cfg).is_err());
    }

    #[test]
    fn test_validate_config_boundary_max_fee_h6() {
        let mut cfg = test_config();
        cfg.fee_rate_bps = MAX_FEE_BPS;
        assert!(validate_config(&cfg).is_ok());
        cfg.fee_rate_bps = MAX_FEE_BPS + 1;
        assert!(validate_config(&cfg).is_err());
    }

    #[test]
    fn test_current_phase_exactly_at_commit_end_h6() {
        let b = create_batch(1, test_pool_id(), 1000, test_config());
        // commit_end = 1000 + 8000 = 9000
        let phase = current_phase(&b, 9000);
        assert_eq!(phase, BatchPhase::Revealing);
    }

    #[test]
    fn test_current_phase_one_ms_before_commit_end_h6() {
        let b = create_batch(1, test_pool_id(), 1000, test_config());
        let phase = current_phase(&b, 8999);
        assert_eq!(phase, BatchPhase::Accepting);
    }

    #[test]
    fn test_time_remaining_mid_accepting_h6() {
        let b = create_batch(1, test_pool_id(), 1000, test_config());
        // commit_end = 9000, now = 5000
        let rem = time_remaining_ms(&b, 5000);
        assert_eq!(rem, 4000);
    }

    #[test]
    fn test_time_remaining_mid_revealing_h6() {
        let b = create_batch(1, test_pool_id(), 1000, test_config());
        // reveal_end = 9000 + 2000 = 11000, now = 10000
        let rem = time_remaining_ms(&b, 10000);
        assert_eq!(rem, 1000);
    }

    #[test]
    fn test_add_commit_deposits_accumulate_h6() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        let s1 = test_secret(1);
        let s2 = test_secret(2);
        let c1 = make_commit(100, true, &s1, test_depositor(1), 50, 1500);
        let c2 = make_commit(200, false, &s2, test_depositor(2), 75, 1600);
        add_commit(&mut b, c1, 1500).unwrap();
        add_commit(&mut b, c2, 1600).unwrap();
        assert_eq!(b.total_deposits, 125);
    }

    #[test]
    fn test_compute_commit_hash_buy_vs_sell_differ_h6() {
        let secret = test_secret(1);
        let h_buy = compute_commit_hash(100, true, &secret);
        let h_sell = compute_commit_hash(100, false, &secret);
        assert_ne!(h_buy, h_sell);
    }

    #[test]
    fn test_minimum_deposit_100_bps_h6() {
        let cfg = test_config(); // min_deposit_bps = 100
        let deposit = minimum_deposit(10000, &cfg);
        assert_eq!(deposit, 100); // 10000 * 100 / 10000 = 100
    }

    #[test]
    fn test_minimum_deposit_small_amount_floor_h6() {
        let cfg = test_config();
        let deposit = minimum_deposit(1, &cfg);
        assert_eq!(deposit, 1); // minimum 1 if amount > 0
    }

    #[test]
    fn test_verify_reveal_correct_h6() {
        let secret = test_secret(1);
        let hash = compute_commit_hash(500, true, &secret);
        let commit = Commit { commit_hash: hash, depositor: test_depositor(1), deposit_amount: 50, timestamp_ms: 1000, is_eoa: true };
        let reveal = Reveal { commit_index: 0, amount: 500, is_buy: true, secret, priority_fee: 0 };
        assert!(verify_reveal(&commit, &reveal));
    }

    #[test]
    fn test_verify_reveal_wrong_amount_h6() {
        let secret = test_secret(1);
        let hash = compute_commit_hash(500, true, &secret);
        let commit = Commit { commit_hash: hash, depositor: test_depositor(1), deposit_amount: 50, timestamp_ms: 1000, is_eoa: true };
        let reveal = Reveal { commit_index: 0, amount: 501, is_buy: true, secret, priority_fee: 0 };
        assert!(!verify_reveal(&commit, &reveal));
    }

    #[test]
    fn test_reveal_rate_bps_all_revealed_h6() {
        let b = make_batch_with_commits_and_reveals(3, 1000, 2, 1000);
        assert_eq!(reveal_rate_bps(&b), 10000); // 5/5 = 100%
    }

    #[test]
    fn test_unrevealed_commits_all_revealed_empty_h6() {
        let b = make_batch_with_commits_and_reveals(2, 1000, 2, 1000);
        let unrevealed = unrevealed_commits(&b);
        assert!(unrevealed.is_empty());
    }

    #[test]
    fn test_slash_unrevealed_no_unrevealed_h6() {
        let mut b = make_batch_with_commits_and_reveals(2, 1000, 0, 0);
        let slashed = slash_unrevealed(&mut b);
        assert_eq!(slashed, 0);
    }

    #[test]
    fn test_compute_clearing_price_equal_reserves_h6() {
        let reveals = vec![
            Reveal { commit_index: 0, amount: 1000, is_buy: true, secret: test_secret(1), priority_fee: 0 },
            Reveal { commit_index: 1, amount: 1000, is_buy: false, secret: test_secret(2), priority_fee: 0 },
        ];
        let price = compute_clearing_price(&reveals, 10000, 10000);
        // Base price = 10000 * 10000 / 10000 = 10000, balanced so no shift
        assert_eq!(price, 10000);
    }

    #[test]
    fn test_compute_clearing_price_zero_reserve_a_h6() {
        let reveals = vec![];
        let price = compute_clearing_price(&reveals, 0, 10000);
        assert_eq!(price, 0);
    }

    #[test]
    fn test_buy_sell_ratio_only_buys_h6() {
        let b = make_batch_with_commits_and_reveals(3, 1000, 0, 0);
        let (buys, sells) = buy_sell_ratio(&b);
        assert_eq!(buys, 3000);
        assert_eq!(sells, 0);
    }

    #[test]
    fn test_order_imbalance_full_buy_h6() {
        let b = make_batch_with_commits_and_reveals(3, 1000, 0, 0);
        let imb = order_imbalance_bps(&b);
        assert_eq!(imb, 10000); // 100% imbalance
    }

    #[test]
    fn test_avg_order_size_h6() {
        let b = make_batch_with_commits_and_reveals(2, 1000, 2, 3000);
        let avg = avg_order_size(&b);
        // Total = 2*1000 + 2*3000 = 8000, count = 4, avg = 2000
        assert_eq!(avg, 2000);
    }

    #[test]
    fn test_priority_fee_total_nonzero_h6() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        b.reveals.push(Reveal { commit_index: 0, amount: 100, is_buy: true, secret: test_secret(1), priority_fee: 10 });
        b.reveals.push(Reveal { commit_index: 1, amount: 200, is_buy: false, secret: test_secret(2), priority_fee: 20 });
        assert_eq!(priority_fee_total(&b), 30);
    }

    #[test]
    fn test_settlement_quality_balanced_high_count_h6() {
        let result = BatchResult {
            batch_id: 1,
            clearing_price: 10000,
            total_buy_volume: 5000,
            total_sell_volume: 5000,
            matched_volume: 10000,
            total_fees: 30,
            total_slashed: 0,
            fill_count: 20,
            average_fill_rate_bps: 10000,
            quality_score: 0,
        };
        let q = settlement_quality(&result);
        assert_eq!(q, 10000); // Perfect balance, perfect fill, 20+ orders
    }

    #[test]
    fn test_compute_batch_stats_two_results_h6() {
        let r1 = BatchResult { batch_id: 1, clearing_price: 10000, total_buy_volume: 500, total_sell_volume: 500, matched_volume: 1000, total_fees: 3, total_slashed: 0, fill_count: 4, average_fill_rate_bps: 10000, quality_score: 9000 };
        let r2 = BatchResult { batch_id: 2, clearing_price: 12000, total_buy_volume: 800, total_sell_volume: 200, matched_volume: 500, total_fees: 2, total_slashed: 10, fill_count: 3, average_fill_rate_bps: 5000, quality_score: 6000 };
        let stats = compute_batch_stats(&[r1, r2], 1);
        assert_eq!(stats.total_batches, 3);
        assert_eq!(stats.settled_batches, 2);
        assert_eq!(stats.expired_batches, 1);
        assert_eq!(stats.total_volume, 1500);
    }

    #[test]
    fn test_batch_throughput_10_batches_1_second_h6() {
        let stats = BatchStats { total_batches: 10, settled_batches: 10, expired_batches: 0, total_volume: 0, total_fees_collected: 0, total_slashed: 0, avg_orders_per_batch: 0, avg_reveal_rate_bps: 0, avg_settlement_quality: 0 };
        let tput = batch_throughput(&stats, 1000);
        assert_eq!(tput, 10_000); // 10 batches per 1000ms = 10_000 per million ms
    }

    #[test]
    fn test_expire_batch_returns_total_refund_h6() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        let s = test_secret(1);
        let commit = make_commit(1000, true, &s, test_depositor(1), 100, 1500);
        b.commits.push(commit);
        b.total_deposits += 100;
        // All unrevealed, slash 50%
        let refund = expire_batch(&mut b, 12000).unwrap();
        // Refund = 100 - slash(50%) = 50
        assert_eq!(refund, 50);
    }

    #[test]
    fn test_refund_amounts_revealed_get_full_back_h6() {
        let mut b = create_batch(1, test_pool_id(), 1000, test_config());
        let s = test_secret(1);
        let commit = make_commit(1000, true, &s, test_depositor(1), 100, 1500);
        b.commits.push(commit);
        b.reveals.push(make_reveal(0, 1000, true, s, 0));
        let refunds = refund_amounts(&b);
        assert_eq!(refunds[0].1, 100); // Full deposit back
    }

    #[test]
    fn test_next_batch_id_increment_h6() {
        assert_eq!(next_batch_id(0), 1);
        assert_eq!(next_batch_id(100), 101);
    }

    #[test]
    fn test_next_batch_id_saturates_h6() {
        assert_eq!(next_batch_id(u64::MAX), u64::MAX);
    }

    #[test]
    fn test_batch_duration_default_h6() {
        let cfg = test_config();
        assert_eq!(batch_duration_ms(&cfg), 10000); // 8000 + 2000
    }

    #[test]
    fn test_validate_batch_sequence_gap_in_ids_h6() {
        let b1 = create_batch(1, test_pool_id(), 1000, test_config());
        let b2 = create_batch(3, test_pool_id(), 20000, test_config()); // id gap
        assert!(!validate_batch_sequence(&[b1, b2]));
    }

    #[test]
    fn test_is_valid_batch_fresh_batch_h6() {
        let b = create_batch(1, test_pool_id(), 1000, test_config());
        assert!(is_valid_batch(&b));
    }

    #[test]
    fn test_effective_fee_rate_30_bps_h6() {
        let result = BatchResult { batch_id: 1, clearing_price: 10000, total_buy_volume: 500, total_sell_volume: 500, matched_volume: 10000, total_fees: 30, total_slashed: 0, fill_count: 2, average_fill_rate_bps: 10000, quality_score: 0 };
        let rate = effective_fee_rate_bps(&result);
        assert_eq!(rate, 30); // 30 fees / 10000 volume * 10000 = 30
    }

    #[test]
    fn test_fee_efficiency_h6() {
        let stats = BatchStats { total_batches: 1, settled_batches: 1, expired_batches: 0, total_volume: 10000, total_fees_collected: 30, total_slashed: 0, avg_orders_per_batch: 5, avg_reveal_rate_bps: 10000, avg_settlement_quality: 9000 };
        let eff = fee_efficiency(&stats);
        assert_eq!(eff, 30); // 30 * 10000 / 10000
    }

    #[test]
    fn test_volume_weighted_quality_single_h6() {
        let r = BatchResult { batch_id: 1, clearing_price: 10000, total_buy_volume: 500, total_sell_volume: 500, matched_volume: 1000, total_fees: 3, total_slashed: 0, fill_count: 4, average_fill_rate_bps: 10000, quality_score: 8000 };
        let q = volume_weighted_quality(&[r]);
        assert_eq!(q, 8000);
    }
}
