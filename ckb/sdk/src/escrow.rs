// ============ Escrow Module ============
// Conditional Escrow — locking funds until specific conditions are met, timeout
// expires, or disputes are resolved. Used for cross-chain atomic swaps, order
// deposits, and trustless P2P trades.
//
// All functions are standalone pub fn. No traits, no impl blocks.
// Supports hashlock (HTLC), timelock, multisig, oracle, and composite conditions.

use sha2::{Digest, Sha256};

// ============ Constants ============

/// Default deadline: 72 hours in milliseconds
pub const DEFAULT_DEADLINE_MS: u64 = 259_200_000;

/// Default dispute window: 24 hours in milliseconds
pub const DEFAULT_DISPUTE_WINDOW_MS: u64 = 86_400_000;

/// Default fee rate: 10 basis points (0.1%)
pub const DEFAULT_FEE_BPS: u64 = 10;

/// Basis points denominator
pub const BPS: u64 = 10_000;

// ============ Error Types ============

#[derive(Debug, Clone, PartialEq)]
pub enum EscrowError {
    NotFound,
    AlreadyReleased,
    AlreadyRefunded,
    NotExpired,
    NotActive,
    InvalidCondition,
    ConditionNotMet,
    HashMismatch,
    InsufficientSignatures,
    DeadlinePassed,
    DeadlineNotPassed,
    DisputeWindowActive,
    DisputeWindowExpired,
    NotArbiter,
    NotDepositor,
    NotRecipient,
    ZeroAmount,
    InvalidDeadline,
    Overflow,
    SelfEscrow,
}

// ============ Data Types ============

#[derive(Debug, Clone, PartialEq)]
pub enum EscrowStatus {
    Active,
    Released,
    Refunded,
    Disputed,
    Expired,
    Claimed,
}

#[derive(Debug, Clone, PartialEq)]
pub enum EscrowCondition {
    Hashlock { hash: [u8; 32] },
    Timelock { unlock_at: u64 },
    MultiSig { required: u32, signers: Vec<[u8; 32]> },
    Oracle { oracle_id: [u8; 32], expected_value: u64 },
    Composite { conditions: Vec<EscrowCondition>, require_all: bool },
}

#[derive(Debug, Clone)]
pub struct Escrow {
    pub escrow_id: u64,
    pub depositor: [u8; 32],
    pub recipient: [u8; 32],
    pub token: [u8; 32],
    pub amount: u64,
    pub fee: u64,
    pub condition: EscrowCondition,
    pub status: EscrowStatus,
    pub created_at: u64,
    pub deadline: u64,
    pub released_at: Option<u64>,
    pub dispute_deadline: u64,
    pub arbiter: Option<[u8; 32]>,
}

#[derive(Debug, Clone)]
pub struct EscrowRegistry {
    pub escrows: Vec<Escrow>,
    pub total_locked: u128,
    pub total_released: u128,
    pub total_refunded: u128,
    pub total_fees: u128,
    pub next_id: u64,
    pub default_deadline_ms: u64,
    pub default_dispute_window_ms: u64,
    pub fee_rate_bps: u64,
}

#[derive(Debug, Clone)]
pub struct EscrowStats {
    pub active_count: u64,
    pub completed_count: u64,
    pub disputed_count: u64,
    pub expired_count: u64,
    pub total_volume: u128,
    pub avg_duration_ms: u64,
    pub success_rate_bps: u64,
    pub dispute_rate_bps: u64,
}

// ============ Registry ============

pub fn create_registry(deadline_ms: u64, dispute_ms: u64, fee_bps: u64) -> EscrowRegistry {
    EscrowRegistry {
        escrows: Vec::new(),
        total_locked: 0,
        total_released: 0,
        total_refunded: 0,
        total_fees: 0,
        next_id: 1,
        default_deadline_ms: deadline_ms,
        default_dispute_window_ms: dispute_ms,
        fee_rate_bps: fee_bps,
    }
}

pub fn default_registry() -> EscrowRegistry {
    create_registry(DEFAULT_DEADLINE_MS, DEFAULT_DISPUTE_WINDOW_MS, DEFAULT_FEE_BPS)
}

// ============ Utilities ============

pub fn compute_hash(preimage: &[u8; 32]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(preimage);
    let result = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&result);
    out
}

pub fn next_escrow_id(reg: &EscrowRegistry) -> u64 {
    reg.next_id
}

pub fn compute_fee(amount: u64, fee_bps: u64) -> u64 {
    let wide = (amount as u128) * (fee_bps as u128) / (BPS as u128);
    wide as u64
}

// ============ Validation ============

pub fn validate_condition(condition: &EscrowCondition) -> Result<(), EscrowError> {
    match condition {
        EscrowCondition::Hashlock { hash: _ } => Ok(()),
        EscrowCondition::Timelock { unlock_at } => {
            if *unlock_at == 0 {
                Err(EscrowError::InvalidCondition)
            } else {
                Ok(())
            }
        }
        EscrowCondition::MultiSig { required, signers } => {
            if *required == 0 || signers.is_empty() || (*required as usize) > signers.len() {
                Err(EscrowError::InvalidCondition)
            } else {
                Ok(())
            }
        }
        EscrowCondition::Oracle { oracle_id: _, expected_value: _ } => Ok(()),
        EscrowCondition::Composite { conditions, require_all: _ } => {
            if conditions.is_empty() {
                return Err(EscrowError::InvalidCondition);
            }
            for c in conditions {
                validate_condition(c)?;
            }
            Ok(())
        }
    }
}

pub fn validate_escrow(escrow: &Escrow) -> Result<(), EscrowError> {
    if escrow.amount == 0 {
        return Err(EscrowError::ZeroAmount);
    }
    if escrow.depositor == escrow.recipient {
        return Err(EscrowError::SelfEscrow);
    }
    if escrow.deadline <= escrow.created_at {
        return Err(EscrowError::InvalidDeadline);
    }
    validate_condition(&escrow.condition)
}

pub fn validate_registry(reg: &EscrowRegistry) -> bool {
    let mut locked: u128 = 0;
    for e in &reg.escrows {
        if e.status == EscrowStatus::Active || e.status == EscrowStatus::Disputed {
            locked += (e.amount as u128) + (e.fee as u128);
        }
    }
    locked == reg.total_locked
}

// ============ Escrow Creation ============

pub fn create_escrow(
    reg: &mut EscrowRegistry,
    depositor: [u8; 32],
    recipient: [u8; 32],
    token: [u8; 32],
    amount: u64,
    condition: EscrowCondition,
    deadline: u64,
    now: u64,
) -> Result<u64, EscrowError> {
    if amount == 0 {
        return Err(EscrowError::ZeroAmount);
    }
    if depositor == recipient {
        return Err(EscrowError::SelfEscrow);
    }
    if deadline <= now {
        return Err(EscrowError::InvalidDeadline);
    }
    validate_condition(&condition)?;

    let fee = compute_fee(amount, reg.fee_rate_bps);
    let total = (amount as u128) + (fee as u128);
    let new_locked = reg.total_locked.checked_add(total).ok_or(EscrowError::Overflow)?;

    let id = reg.next_id;
    let dispute_deadline = deadline.saturating_add(reg.default_dispute_window_ms);

    let escrow = Escrow {
        escrow_id: id,
        depositor,
        recipient,
        token,
        amount,
        fee,
        condition,
        status: EscrowStatus::Active,
        created_at: now,
        deadline,
        released_at: None,
        dispute_deadline,
        arbiter: None,
    };

    reg.escrows.push(escrow);
    reg.total_locked = new_locked;
    reg.total_fees = reg.total_fees.saturating_add(fee as u128);
    reg.next_id = id + 1;

    Ok(id)
}

pub fn create_htlc(
    reg: &mut EscrowRegistry,
    depositor: [u8; 32],
    recipient: [u8; 32],
    token: [u8; 32],
    amount: u64,
    hash: [u8; 32],
    deadline: u64,
    now: u64,
) -> Result<u64, EscrowError> {
    let condition = EscrowCondition::Hashlock { hash };
    create_escrow(reg, depositor, recipient, token, amount, condition, deadline, now)
}

pub fn create_timelock(
    reg: &mut EscrowRegistry,
    depositor: [u8; 32],
    recipient: [u8; 32],
    token: [u8; 32],
    amount: u64,
    unlock_at: u64,
    now: u64,
) -> Result<u64, EscrowError> {
    if unlock_at == 0 {
        return Err(EscrowError::InvalidCondition);
    }
    let deadline = unlock_at.saturating_add(reg.default_deadline_ms);
    let condition = EscrowCondition::Timelock { unlock_at };
    create_escrow(reg, depositor, recipient, token, amount, condition, deadline, now)
}

// ============ Condition Checking ============

pub fn check_hashlock(hash: &[u8; 32], preimage: &[u8; 32]) -> bool {
    compute_hash(preimage) == *hash
}

pub fn check_timelock(unlock_at: u64, now: u64) -> bool {
    now >= unlock_at
}

pub fn check_multisig(required: u32, signers: &[[u8; 32]], provided: &[[u8; 32]]) -> bool {
    if (required as usize) > signers.len() {
        return false;
    }
    let mut count: u32 = 0;
    for p in provided {
        if signers.contains(p) {
            count += 1;
        }
    }
    count >= required
}

pub fn check_condition(
    condition: &EscrowCondition,
    preimage: Option<&[u8; 32]>,
    now: u64,
    signatures: &[[u8; 32]],
    oracle_value: Option<u64>,
) -> bool {
    match condition {
        EscrowCondition::Hashlock { hash } => {
            if let Some(pre) = preimage {
                check_hashlock(hash, pre)
            } else {
                false
            }
        }
        EscrowCondition::Timelock { unlock_at } => check_timelock(*unlock_at, now),
        EscrowCondition::MultiSig { required, signers } => {
            check_multisig(*required, signers, signatures)
        }
        EscrowCondition::Oracle { oracle_id: _, expected_value } => {
            if let Some(val) = oracle_value {
                val == *expected_value
            } else {
                false
            }
        }
        EscrowCondition::Composite { conditions, require_all } => {
            evaluate_composite(conditions, *require_all, preimage, now, signatures, oracle_value)
        }
    }
}

pub fn evaluate_composite(
    conditions: &[EscrowCondition],
    require_all: bool,
    preimage: Option<&[u8; 32]>,
    now: u64,
    sigs: &[[u8; 32]],
    oracle_val: Option<u64>,
) -> bool {
    if conditions.is_empty() {
        return false;
    }
    if require_all {
        conditions.iter().all(|c| check_condition(c, preimage, now, sigs, oracle_val))
    } else {
        conditions.iter().any(|c| check_condition(c, preimage, now, sigs, oracle_val))
    }
}

// ============ Release & Refund ============

pub fn release_escrow(
    reg: &mut EscrowRegistry,
    escrow_id: u64,
    preimage: Option<[u8; 32]>,
    now: u64,
    signatures: &[[u8; 32]],
    oracle_value: Option<u64>,
) -> Result<u64, EscrowError> {
    let escrow = reg.escrows.iter().find(|e| e.escrow_id == escrow_id)
        .ok_or(EscrowError::NotFound)?;

    if escrow.status == EscrowStatus::Released {
        return Err(EscrowError::AlreadyReleased);
    }
    if escrow.status == EscrowStatus::Refunded || escrow.status == EscrowStatus::Claimed {
        return Err(EscrowError::AlreadyRefunded);
    }
    if escrow.status != EscrowStatus::Active {
        return Err(EscrowError::NotActive);
    }
    if now > escrow.deadline {
        return Err(EscrowError::DeadlinePassed);
    }

    let met = check_condition(
        &escrow.condition,
        preimage.as_ref(),
        now,
        signatures,
        oracle_value,
    );
    if !met {
        return Err(EscrowError::ConditionNotMet);
    }

    let amount = escrow.amount;
    let fee = escrow.fee;

    let escrow_mut = reg.escrows.iter_mut().find(|e| e.escrow_id == escrow_id).unwrap();
    escrow_mut.status = EscrowStatus::Released;
    escrow_mut.released_at = Some(now);

    let total = (amount as u128) + (fee as u128);
    reg.total_locked = reg.total_locked.saturating_sub(total);
    reg.total_released = reg.total_released.saturating_add(amount as u128);

    Ok(amount)
}

pub fn refund_escrow(
    reg: &mut EscrowRegistry,
    escrow_id: u64,
    now: u64,
) -> Result<u64, EscrowError> {
    let escrow = reg.escrows.iter().find(|e| e.escrow_id == escrow_id)
        .ok_or(EscrowError::NotFound)?;

    if escrow.status == EscrowStatus::Released {
        return Err(EscrowError::AlreadyReleased);
    }
    if escrow.status == EscrowStatus::Refunded || escrow.status == EscrowStatus::Claimed {
        return Err(EscrowError::AlreadyRefunded);
    }
    if escrow.status == EscrowStatus::Disputed {
        return Err(EscrowError::NotActive);
    }
    if escrow.status != EscrowStatus::Active && escrow.status != EscrowStatus::Expired {
        return Err(EscrowError::NotActive);
    }
    if now <= escrow.deadline {
        return Err(EscrowError::DeadlineNotPassed);
    }

    let amount = escrow.amount;
    let fee = escrow.fee;

    let escrow_mut = reg.escrows.iter_mut().find(|e| e.escrow_id == escrow_id).unwrap();
    escrow_mut.status = EscrowStatus::Refunded;

    let total = (amount as u128) + (fee as u128);
    reg.total_locked = reg.total_locked.saturating_sub(total);
    reg.total_refunded = reg.total_refunded.saturating_add(amount as u128);

    Ok(amount)
}

pub fn claim_expired(
    reg: &mut EscrowRegistry,
    escrow_id: u64,
    claimer: &[u8; 32],
    now: u64,
) -> Result<u64, EscrowError> {
    let escrow = reg.escrows.iter().find(|e| e.escrow_id == escrow_id)
        .ok_or(EscrowError::NotFound)?;

    if escrow.status == EscrowStatus::Released {
        return Err(EscrowError::AlreadyReleased);
    }
    if escrow.status == EscrowStatus::Refunded || escrow.status == EscrowStatus::Claimed {
        return Err(EscrowError::AlreadyRefunded);
    }
    if *claimer != escrow.depositor {
        return Err(EscrowError::NotDepositor);
    }
    if escrow.status != EscrowStatus::Expired && !is_expired(escrow, now) {
        return Err(EscrowError::NotExpired);
    }

    let amount = escrow.amount;
    let fee = escrow.fee;

    let escrow_mut = reg.escrows.iter_mut().find(|e| e.escrow_id == escrow_id).unwrap();
    escrow_mut.status = EscrowStatus::Claimed;

    let total = (amount as u128) + (fee as u128);
    reg.total_locked = reg.total_locked.saturating_sub(total);
    reg.total_refunded = reg.total_refunded.saturating_add(amount as u128);

    Ok(amount)
}

pub fn force_release(
    reg: &mut EscrowRegistry,
    escrow_id: u64,
    arbiter: &[u8; 32],
    to_recipient: bool,
    now: u64,
) -> Result<u64, EscrowError> {
    let escrow = reg.escrows.iter().find(|e| e.escrow_id == escrow_id)
        .ok_or(EscrowError::NotFound)?;

    if escrow.status != EscrowStatus::Disputed {
        return Err(EscrowError::NotActive);
    }
    match &escrow.arbiter {
        Some(a) => {
            if a != arbiter {
                return Err(EscrowError::NotArbiter);
            }
        }
        None => return Err(EscrowError::NotArbiter),
    }

    let amount = escrow.amount;
    let fee = escrow.fee;

    let escrow_mut = reg.escrows.iter_mut().find(|e| e.escrow_id == escrow_id).unwrap();
    if to_recipient {
        escrow_mut.status = EscrowStatus::Released;
        escrow_mut.released_at = Some(now);
        let total = (amount as u128) + (fee as u128);
        reg.total_locked = reg.total_locked.saturating_sub(total);
        reg.total_released = reg.total_released.saturating_add(amount as u128);
    } else {
        escrow_mut.status = EscrowStatus::Refunded;
        let total = (amount as u128) + (fee as u128);
        reg.total_locked = reg.total_locked.saturating_sub(total);
        reg.total_refunded = reg.total_refunded.saturating_add(amount as u128);
    }

    Ok(amount)
}

// ============ Disputes ============

pub fn raise_dispute(
    reg: &mut EscrowRegistry,
    escrow_id: u64,
    raiser: &[u8; 32],
    now: u64,
) -> Result<(), EscrowError> {
    let escrow = reg.escrows.iter().find(|e| e.escrow_id == escrow_id)
        .ok_or(EscrowError::NotFound)?;

    if escrow.status == EscrowStatus::Released {
        // Can dispute released escrow within dispute window
        if let Some(released_at) = escrow.released_at {
            if now > released_at.saturating_add(reg.default_dispute_window_ms) {
                return Err(EscrowError::DisputeWindowExpired);
            }
        }
    } else if escrow.status != EscrowStatus::Active {
        return Err(EscrowError::NotActive);
    }

    if *raiser != escrow.depositor && *raiser != escrow.recipient {
        return Err(EscrowError::NotDepositor);
    }

    let escrow_mut = reg.escrows.iter_mut().find(|e| e.escrow_id == escrow_id).unwrap();
    escrow_mut.status = EscrowStatus::Disputed;
    // If was released, re-add to locked since it's now disputed
    if escrow_mut.released_at.is_some() {
        let total = (escrow_mut.amount as u128) + (escrow_mut.fee as u128);
        reg.total_locked = reg.total_locked.saturating_add(total);
        reg.total_released = reg.total_released.saturating_sub(escrow_mut.amount as u128);
    }

    Ok(())
}

pub fn resolve_dispute(
    reg: &mut EscrowRegistry,
    escrow_id: u64,
    arbiter: &[u8; 32],
    favor_recipient: bool,
    now: u64,
) -> Result<u64, EscrowError> {
    force_release(reg, escrow_id, arbiter, favor_recipient, now)
}

pub fn can_dispute(reg: &EscrowRegistry, escrow_id: u64, now: u64) -> bool {
    if let Some(escrow) = reg.escrows.iter().find(|e| e.escrow_id == escrow_id) {
        if escrow.status == EscrowStatus::Active {
            return true;
        }
        if escrow.status == EscrowStatus::Released {
            if let Some(released_at) = escrow.released_at {
                return now <= released_at.saturating_add(reg.default_dispute_window_ms);
            }
        }
    }
    false
}

pub fn dispute_remaining_ms(escrow: &Escrow, now: u64) -> u64 {
    if let Some(released_at) = escrow.released_at {
        let window_end = released_at.saturating_add(escrow.dispute_deadline.saturating_sub(escrow.deadline));
        if now >= window_end {
            0
        } else {
            window_end - now
        }
    } else if escrow.status == EscrowStatus::Active {
        // Not yet released, full dispute window remains conceptually
        escrow.dispute_deadline.saturating_sub(escrow.deadline)
    } else {
        0
    }
}

// ============ Queries ============

pub fn get_escrow(reg: &EscrowRegistry, escrow_id: u64) -> Option<&Escrow> {
    reg.escrows.iter().find(|e| e.escrow_id == escrow_id)
}

pub fn escrows_by_depositor<'a>(reg: &'a EscrowRegistry, depositor: &[u8; 32]) -> Vec<&'a Escrow> {
    reg.escrows.iter().filter(|e| e.depositor == *depositor).collect()
}

pub fn escrows_by_recipient<'a>(reg: &'a EscrowRegistry, recipient: &[u8; 32]) -> Vec<&'a Escrow> {
    reg.escrows.iter().filter(|e| e.recipient == *recipient).collect()
}

pub fn escrows_by_status<'a>(reg: &'a EscrowRegistry, status: &EscrowStatus) -> Vec<&'a Escrow> {
    reg.escrows.iter().filter(|e| e.status == *status).collect()
}

pub fn active_escrows(reg: &EscrowRegistry) -> Vec<&Escrow> {
    escrows_by_status(reg, &EscrowStatus::Active)
}

pub fn expiring_soon<'a>(reg: &'a EscrowRegistry, now: u64, window_ms: u64) -> Vec<&'a Escrow> {
    reg.escrows.iter().filter(|e| {
        e.status == EscrowStatus::Active && e.deadline > now && e.deadline <= now.saturating_add(window_ms)
    }).collect()
}

// ============ Lifecycle ============

pub fn expire_escrows(reg: &mut EscrowRegistry, now: u64) -> usize {
    let mut count = 0;
    for escrow in reg.escrows.iter_mut() {
        if escrow.status == EscrowStatus::Active && now > escrow.deadline {
            escrow.status = EscrowStatus::Expired;
            count += 1;
        }
    }
    count
}

pub fn time_remaining(escrow: &Escrow, now: u64) -> u64 {
    if now >= escrow.deadline {
        0
    } else {
        escrow.deadline - now
    }
}

pub fn is_expired(escrow: &Escrow, now: u64) -> bool {
    now > escrow.deadline
}

pub fn is_releasable(escrow: &Escrow, now: u64) -> bool {
    escrow.status == EscrowStatus::Active && now <= escrow.deadline
}

pub fn cleanup_completed(reg: &mut EscrowRegistry) -> usize {
    let before = reg.escrows.len();
    reg.escrows.retain(|e| {
        e.status != EscrowStatus::Released
            && e.status != EscrowStatus::Refunded
            && e.status != EscrowStatus::Claimed
    });
    before - reg.escrows.len()
}

// ============ Analytics ============

pub fn compute_stats(reg: &EscrowRegistry) -> EscrowStats {
    let mut active_count: u64 = 0;
    let mut completed_count: u64 = 0;
    let mut disputed_count: u64 = 0;
    let mut expired_count: u64 = 0;
    let mut total_volume: u128 = 0;
    let mut total_duration: u128 = 0;
    let mut duration_count: u64 = 0;
    let mut total_count: u64 = 0;

    for e in &reg.escrows {
        total_volume += e.amount as u128;
        total_count += 1;
        match e.status {
            EscrowStatus::Active => active_count += 1,
            EscrowStatus::Released | EscrowStatus::Claimed => {
                completed_count += 1;
                if let Some(rel) = e.released_at {
                    total_duration += (rel - e.created_at) as u128;
                    duration_count += 1;
                }
            }
            EscrowStatus::Disputed => disputed_count += 1,
            EscrowStatus::Expired => expired_count += 1,
            EscrowStatus::Refunded => {
                completed_count += 1;
            }
        }
    }

    let avg_duration_ms = if duration_count > 0 {
        (total_duration / duration_count as u128) as u64
    } else {
        0
    };

    let success_rate_bps = if total_count > 0 {
        let released = reg.escrows.iter().filter(|e| e.status == EscrowStatus::Released).count() as u64;
        released * 10_000 / total_count
    } else {
        0
    };

    let dispute_rate_bps = if total_count > 0 {
        disputed_count * 10_000 / total_count
    } else {
        0
    };

    EscrowStats {
        active_count,
        completed_count,
        disputed_count,
        expired_count,
        total_volume,
        avg_duration_ms,
        success_rate_bps,
        dispute_rate_bps,
    }
}

pub fn total_locked_by_token(reg: &EscrowRegistry, token: &[u8; 32]) -> u128 {
    reg.escrows.iter()
        .filter(|e| e.token == *token && (e.status == EscrowStatus::Active || e.status == EscrowStatus::Disputed))
        .map(|e| e.amount as u128)
        .sum()
}

pub fn avg_escrow_duration(reg: &EscrowRegistry) -> u64 {
    let mut total: u128 = 0;
    let mut count: u64 = 0;
    for e in &reg.escrows {
        if let Some(rel) = e.released_at {
            total += (rel - e.created_at) as u128;
            count += 1;
        }
    }
    if count == 0 { 0 } else { (total / count as u128) as u64 }
}

pub fn success_rate(reg: &EscrowRegistry) -> u64 {
    let total = reg.escrows.len() as u64;
    if total == 0 {
        return 0;
    }
    let released = reg.escrows.iter().filter(|e| e.status == EscrowStatus::Released).count() as u64;
    released * 10_000 / total
}

pub fn total_active_value(reg: &EscrowRegistry) -> u128 {
    reg.escrows.iter()
        .filter(|e| e.status == EscrowStatus::Active)
        .map(|e| e.amount as u128)
        .sum()
}

// ============ Atomic Swap Helpers ============

pub fn create_swap_pair(
    reg: &mut EscrowRegistry,
    party_a: [u8; 32],
    party_b: [u8; 32],
    token_a: [u8; 32],
    amount_a: u64,
    token_b: [u8; 32],
    amount_b: u64,
    secret_hash: [u8; 32],
    deadline: u64,
    now: u64,
) -> Result<(u64, u64), EscrowError> {
    let id_a = create_htlc(reg, party_a, party_b, token_a, amount_a, secret_hash, deadline, now)?;
    let id_b = create_htlc(reg, party_b, party_a, token_b, amount_b, secret_hash, deadline, now)?;
    Ok((id_a, id_b))
}

pub fn complete_swap(
    reg: &mut EscrowRegistry,
    escrow_a: u64,
    escrow_b: u64,
    preimage: [u8; 32],
    now: u64,
) -> Result<(u64, u64), EscrowError> {
    let amt_a = release_escrow(reg, escrow_a, Some(preimage), now, &[], None)?;
    let amt_b = release_escrow(reg, escrow_b, Some(preimage), now, &[], None)?;
    Ok((amt_a, amt_b))
}

pub fn is_swap_pair(reg: &EscrowRegistry, id_a: u64, id_b: u64) -> bool {
    let a = match get_escrow(reg, id_a) {
        Some(e) => e,
        None => return false,
    };
    let b = match get_escrow(reg, id_b) {
        Some(e) => e,
        None => return false,
    };
    // Same hashlock, mirrored parties
    let hash_a = match &a.condition {
        EscrowCondition::Hashlock { hash } => *hash,
        _ => return false,
    };
    let hash_b = match &b.condition {
        EscrowCondition::Hashlock { hash } => *hash,
        _ => return false,
    };
    hash_a == hash_b && a.depositor == b.recipient && a.recipient == b.depositor
}

// ============ Health ============

pub fn escrow_health(reg: &EscrowRegistry, now: u64) -> u64 {
    if reg.escrows.is_empty() {
        return 10_000;
    }

    let total = reg.escrows.len() as u64;
    let disputed = reg.escrows.iter().filter(|e| e.status == EscrowStatus::Disputed).count() as u64;
    let expired = reg.escrows.iter().filter(|e| e.status == EscrowStatus::Expired || is_expired(e, now)).count() as u64;

    // Disputes hurt health heavily (-30% per 10% disputed)
    let dispute_penalty = (disputed * 3000).min(total * 10) / total;
    // Expired escrows hurt moderately (-10% per 10% expired)
    let expired_penalty = (expired * 1000).min(total * 10) / total;

    let valid = validate_registry(reg);
    let validity_penalty: u64 = if valid { 0 } else { 2000 };

    10_000u64.saturating_sub(dispute_penalty)
        .saturating_sub(expired_penalty)
        .saturating_sub(validity_penalty)
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    fn alice() -> [u8; 32] { [1u8; 32] }
    fn bob() -> [u8; 32] { [2u8; 32] }
    fn charlie() -> [u8; 32] { [3u8; 32] }
    fn arbiter_key() -> [u8; 32] { [4u8; 32] }
    fn token_a() -> [u8; 32] { [10u8; 32] }
    fn token_b() -> [u8; 32] { [11u8; 32] }
    fn secret() -> [u8; 32] { [42u8; 32] }
    fn secret_hash() -> [u8; 32] { compute_hash(&secret()) }
    fn now() -> u64 { 1_000_000 }
    fn deadline() -> u64 { 2_000_000 }

    // ============ Registry Tests ============

    #[test]
    fn test_create_registry() {
        let reg = create_registry(100, 200, 50);
        assert_eq!(reg.default_deadline_ms, 100);
        assert_eq!(reg.default_dispute_window_ms, 200);
        assert_eq!(reg.fee_rate_bps, 50);
        assert_eq!(reg.next_id, 1);
        assert!(reg.escrows.is_empty());
    }

    #[test]
    fn test_default_registry() {
        let reg = default_registry();
        assert_eq!(reg.default_deadline_ms, DEFAULT_DEADLINE_MS);
        assert_eq!(reg.default_dispute_window_ms, DEFAULT_DISPUTE_WINDOW_MS);
        assert_eq!(reg.fee_rate_bps, DEFAULT_FEE_BPS);
    }

    #[test]
    fn test_registry_initial_counters() {
        let reg = default_registry();
        assert_eq!(reg.total_locked, 0);
        assert_eq!(reg.total_released, 0);
        assert_eq!(reg.total_refunded, 0);
        assert_eq!(reg.total_fees, 0);
    }

    #[test]
    fn test_custom_registry_params() {
        let reg = create_registry(1000, 500, 100);
        assert_eq!(reg.fee_rate_bps, 100); // 1%
        assert_eq!(reg.default_deadline_ms, 1000);
        assert_eq!(reg.default_dispute_window_ms, 500);
    }

    // ============ Compute Fee Tests ============

    #[test]
    fn test_compute_fee_basic() {
        assert_eq!(compute_fee(10_000, 10), 10); // 0.1% of 10000
    }

    #[test]
    fn test_compute_fee_zero_amount() {
        assert_eq!(compute_fee(0, 10), 0);
    }

    #[test]
    fn test_compute_fee_zero_bps() {
        assert_eq!(compute_fee(10_000, 0), 0);
    }

    #[test]
    fn test_compute_fee_100_percent() {
        assert_eq!(compute_fee(1000, 10_000), 1000);
    }

    #[test]
    fn test_compute_fee_rounding_down() {
        // 999 * 10 / 10000 = 0 (integer division)
        assert_eq!(compute_fee(999, 10), 0);
    }

    #[test]
    fn test_compute_fee_large_amount() {
        assert_eq!(compute_fee(u64::MAX, 1), u64::MAX / 10_000);
    }

    // ============ Hash Tests ============

    #[test]
    fn test_compute_hash_deterministic() {
        let h1 = compute_hash(&secret());
        let h2 = compute_hash(&secret());
        assert_eq!(h1, h2);
    }

    #[test]
    fn test_compute_hash_different_inputs() {
        let h1 = compute_hash(&[1u8; 32]);
        let h2 = compute_hash(&[2u8; 32]);
        assert_ne!(h1, h2);
    }

    #[test]
    fn test_check_hashlock_valid() {
        let hash = compute_hash(&secret());
        assert!(check_hashlock(&hash, &secret()));
    }

    #[test]
    fn test_check_hashlock_invalid() {
        let hash = compute_hash(&secret());
        assert!(!check_hashlock(&hash, &[99u8; 32]));
    }

    #[test]
    fn test_check_hashlock_zero_preimage() {
        let pre = [0u8; 32];
        let hash = compute_hash(&pre);
        assert!(check_hashlock(&hash, &pre));
    }

    // ============ Timelock Tests ============

    #[test]
    fn test_check_timelock_met() {
        assert!(check_timelock(1000, 1000));
    }

    #[test]
    fn test_check_timelock_after() {
        assert!(check_timelock(1000, 2000));
    }

    #[test]
    fn test_check_timelock_before() {
        assert!(!check_timelock(1000, 999));
    }

    #[test]
    fn test_check_timelock_zero() {
        assert!(check_timelock(0, 0));
    }

    // ============ MultiSig Tests ============

    #[test]
    fn test_check_multisig_met() {
        let signers = vec![alice(), bob(), charlie()];
        let provided = vec![alice(), bob()];
        assert!(check_multisig(2, &signers, &provided));
    }

    #[test]
    fn test_check_multisig_not_met() {
        let signers = vec![alice(), bob(), charlie()];
        let provided = vec![alice()];
        assert!(!check_multisig(2, &signers, &provided));
    }

    #[test]
    fn test_check_multisig_non_signer() {
        let signers = vec![alice(), bob()];
        let provided = vec![charlie()];
        assert!(!check_multisig(1, &signers, &provided));
    }

    #[test]
    fn test_check_multisig_all_required() {
        let signers = vec![alice(), bob()];
        let provided = vec![alice(), bob()];
        assert!(check_multisig(2, &signers, &provided));
    }

    #[test]
    fn test_check_multisig_required_exceeds_signers() {
        let signers = vec![alice()];
        assert!(!check_multisig(2, &signers, &[alice()]));
    }

    // ============ Condition Validation Tests ============

    #[test]
    fn test_validate_hashlock() {
        let c = EscrowCondition::Hashlock { hash: [0u8; 32] };
        assert!(validate_condition(&c).is_ok());
    }

    #[test]
    fn test_validate_timelock_valid() {
        let c = EscrowCondition::Timelock { unlock_at: 1000 };
        assert!(validate_condition(&c).is_ok());
    }

    #[test]
    fn test_validate_timelock_zero() {
        let c = EscrowCondition::Timelock { unlock_at: 0 };
        assert_eq!(validate_condition(&c), Err(EscrowError::InvalidCondition));
    }

    #[test]
    fn test_validate_multisig_valid() {
        let c = EscrowCondition::MultiSig { required: 2, signers: vec![alice(), bob()] };
        assert!(validate_condition(&c).is_ok());
    }

    #[test]
    fn test_validate_multisig_zero_required() {
        let c = EscrowCondition::MultiSig { required: 0, signers: vec![alice()] };
        assert_eq!(validate_condition(&c), Err(EscrowError::InvalidCondition));
    }

    #[test]
    fn test_validate_multisig_empty_signers() {
        let c = EscrowCondition::MultiSig { required: 1, signers: vec![] };
        assert_eq!(validate_condition(&c), Err(EscrowError::InvalidCondition));
    }

    #[test]
    fn test_validate_multisig_required_exceeds() {
        let c = EscrowCondition::MultiSig { required: 3, signers: vec![alice(), bob()] };
        assert_eq!(validate_condition(&c), Err(EscrowError::InvalidCondition));
    }

    #[test]
    fn test_validate_oracle() {
        let c = EscrowCondition::Oracle { oracle_id: [5u8; 32], expected_value: 100 };
        assert!(validate_condition(&c).is_ok());
    }

    #[test]
    fn test_validate_composite_empty() {
        let c = EscrowCondition::Composite { conditions: vec![], require_all: true };
        assert_eq!(validate_condition(&c), Err(EscrowError::InvalidCondition));
    }

    #[test]
    fn test_validate_composite_nested_invalid() {
        let inner = EscrowCondition::Timelock { unlock_at: 0 };
        let c = EscrowCondition::Composite { conditions: vec![inner], require_all: true };
        assert_eq!(validate_condition(&c), Err(EscrowError::InvalidCondition));
    }

    #[test]
    fn test_validate_composite_valid() {
        let c = EscrowCondition::Composite {
            conditions: vec![
                EscrowCondition::Hashlock { hash: [0u8; 32] },
                EscrowCondition::Timelock { unlock_at: 100 },
            ],
            require_all: true,
        };
        assert!(validate_condition(&c).is_ok());
    }

    // ============ check_condition Tests ============

    #[test]
    fn test_check_condition_hashlock_met() {
        let hash = secret_hash();
        let c = EscrowCondition::Hashlock { hash };
        assert!(check_condition(&c, Some(&secret()), now(), &[], None));
    }

    #[test]
    fn test_check_condition_hashlock_no_preimage() {
        let c = EscrowCondition::Hashlock { hash: secret_hash() };
        assert!(!check_condition(&c, None, now(), &[], None));
    }

    #[test]
    fn test_check_condition_timelock_met() {
        let c = EscrowCondition::Timelock { unlock_at: 500 };
        assert!(check_condition(&c, None, 500, &[], None));
    }

    #[test]
    fn test_check_condition_timelock_not_met() {
        let c = EscrowCondition::Timelock { unlock_at: 500 };
        assert!(!check_condition(&c, None, 499, &[], None));
    }

    #[test]
    fn test_check_condition_multisig_met() {
        let c = EscrowCondition::MultiSig { required: 1, signers: vec![alice()] };
        assert!(check_condition(&c, None, 0, &[alice()], None));
    }

    #[test]
    fn test_check_condition_oracle_met() {
        let c = EscrowCondition::Oracle { oracle_id: [0u8; 32], expected_value: 42 };
        assert!(check_condition(&c, None, 0, &[], Some(42)));
    }

    #[test]
    fn test_check_condition_oracle_not_met() {
        let c = EscrowCondition::Oracle { oracle_id: [0u8; 32], expected_value: 42 };
        assert!(!check_condition(&c, None, 0, &[], Some(43)));
    }

    #[test]
    fn test_check_condition_oracle_none() {
        let c = EscrowCondition::Oracle { oracle_id: [0u8; 32], expected_value: 42 };
        assert!(!check_condition(&c, None, 0, &[], None));
    }

    // ============ Composite Condition Tests ============

    #[test]
    fn test_composite_and_all_met() {
        let c = EscrowCondition::Composite {
            conditions: vec![
                EscrowCondition::Hashlock { hash: secret_hash() },
                EscrowCondition::Timelock { unlock_at: 500 },
            ],
            require_all: true,
        };
        assert!(check_condition(&c, Some(&secret()), 500, &[], None));
    }

    #[test]
    fn test_composite_and_partial() {
        let c = EscrowCondition::Composite {
            conditions: vec![
                EscrowCondition::Hashlock { hash: secret_hash() },
                EscrowCondition::Timelock { unlock_at: 500 },
            ],
            require_all: true,
        };
        assert!(!check_condition(&c, Some(&secret()), 499, &[], None));
    }

    #[test]
    fn test_composite_or_one_met() {
        let c = EscrowCondition::Composite {
            conditions: vec![
                EscrowCondition::Hashlock { hash: secret_hash() },
                EscrowCondition::Timelock { unlock_at: 500 },
            ],
            require_all: false,
        };
        assert!(check_condition(&c, None, 500, &[], None));
    }

    #[test]
    fn test_composite_or_none_met() {
        let c = EscrowCondition::Composite {
            conditions: vec![
                EscrowCondition::Hashlock { hash: secret_hash() },
                EscrowCondition::Timelock { unlock_at: 500 },
            ],
            require_all: false,
        };
        assert!(!check_condition(&c, None, 499, &[], None));
    }

    #[test]
    fn test_evaluate_composite_empty() {
        assert!(!evaluate_composite(&[], true, None, 0, &[], None));
    }

    #[test]
    fn test_composite_nested() {
        let inner = EscrowCondition::Composite {
            conditions: vec![
                EscrowCondition::Timelock { unlock_at: 100 },
                EscrowCondition::Timelock { unlock_at: 200 },
            ],
            require_all: true,
        };
        let outer = EscrowCondition::Composite {
            conditions: vec![
                inner,
                EscrowCondition::Hashlock { hash: secret_hash() },
            ],
            require_all: true,
        };
        assert!(check_condition(&outer, Some(&secret()), 200, &[], None));
        assert!(!check_condition(&outer, Some(&secret()), 150, &[], None));
    }

    // ============ Escrow Creation Tests ============

    #[test]
    fn test_create_escrow_basic() {
        let mut reg = default_registry();
        let id = create_escrow(&mut reg, alice(), bob(), token_a(), 1000, EscrowCondition::Hashlock { hash: secret_hash() }, deadline(), now()).unwrap();
        assert_eq!(id, 1);
        assert_eq!(reg.next_id, 2);
        assert_eq!(reg.escrows.len(), 1);
    }

    #[test]
    fn test_create_escrow_fee_calculated() {
        let mut reg = create_registry(DEFAULT_DEADLINE_MS, DEFAULT_DISPUTE_WINDOW_MS, 100); // 1%
        let id = create_escrow(&mut reg, alice(), bob(), token_a(), 10_000, EscrowCondition::Hashlock { hash: secret_hash() }, deadline(), now()).unwrap();
        let e = get_escrow(&reg, id).unwrap();
        assert_eq!(e.fee, 100); // 1% of 10000
    }

    #[test]
    fn test_create_escrow_zero_amount() {
        let mut reg = default_registry();
        let result = create_escrow(&mut reg, alice(), bob(), token_a(), 0, EscrowCondition::Hashlock { hash: secret_hash() }, deadline(), now());
        assert_eq!(result, Err(EscrowError::ZeroAmount));
    }

    #[test]
    fn test_create_escrow_self_escrow() {
        let mut reg = default_registry();
        let result = create_escrow(&mut reg, alice(), alice(), token_a(), 1000, EscrowCondition::Hashlock { hash: secret_hash() }, deadline(), now());
        assert_eq!(result, Err(EscrowError::SelfEscrow));
    }

    #[test]
    fn test_create_escrow_deadline_in_past() {
        let mut reg = default_registry();
        let result = create_escrow(&mut reg, alice(), bob(), token_a(), 1000, EscrowCondition::Hashlock { hash: secret_hash() }, now() - 1, now());
        assert_eq!(result, Err(EscrowError::InvalidDeadline));
    }

    #[test]
    fn test_create_escrow_deadline_equals_now() {
        let mut reg = default_registry();
        let result = create_escrow(&mut reg, alice(), bob(), token_a(), 1000, EscrowCondition::Hashlock { hash: secret_hash() }, now(), now());
        assert_eq!(result, Err(EscrowError::InvalidDeadline));
    }

    #[test]
    fn test_create_escrow_invalid_condition() {
        let mut reg = default_registry();
        let c = EscrowCondition::Timelock { unlock_at: 0 };
        let result = create_escrow(&mut reg, alice(), bob(), token_a(), 1000, c, deadline(), now());
        assert_eq!(result, Err(EscrowError::InvalidCondition));
    }

    #[test]
    fn test_create_escrow_increments_locked() {
        let mut reg = default_registry();
        create_escrow(&mut reg, alice(), bob(), token_a(), 1000, EscrowCondition::Hashlock { hash: secret_hash() }, deadline(), now()).unwrap();
        let fee = compute_fee(1000, reg.fee_rate_bps);
        assert_eq!(reg.total_locked, 1000 + fee as u128);
    }

    #[test]
    fn test_create_escrow_status_active() {
        let mut reg = default_registry();
        let id = create_escrow(&mut reg, alice(), bob(), token_a(), 1000, EscrowCondition::Hashlock { hash: secret_hash() }, deadline(), now()).unwrap();
        assert_eq!(get_escrow(&reg, id).unwrap().status, EscrowStatus::Active);
    }

    #[test]
    fn test_create_multiple_escrows() {
        let mut reg = default_registry();
        let id1 = create_escrow(&mut reg, alice(), bob(), token_a(), 100, EscrowCondition::Hashlock { hash: secret_hash() }, deadline(), now()).unwrap();
        let id2 = create_escrow(&mut reg, bob(), charlie(), token_a(), 200, EscrowCondition::Timelock { unlock_at: 500 }, deadline(), now()).unwrap();
        assert_eq!(id1, 1);
        assert_eq!(id2, 2);
        assert_eq!(reg.escrows.len(), 2);
    }

    #[test]
    fn test_create_escrow_dispute_deadline_set() {
        let mut reg = default_registry();
        let id = create_escrow(&mut reg, alice(), bob(), token_a(), 1000, EscrowCondition::Hashlock { hash: secret_hash() }, deadline(), now()).unwrap();
        let e = get_escrow(&reg, id).unwrap();
        assert_eq!(e.dispute_deadline, deadline() + DEFAULT_DISPUTE_WINDOW_MS);
    }

    // ============ HTLC Creation Tests ============

    #[test]
    fn test_create_htlc() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 500, secret_hash(), deadline(), now()).unwrap();
        let e = get_escrow(&reg, id).unwrap();
        assert_eq!(e.condition, EscrowCondition::Hashlock { hash: secret_hash() });
    }

    #[test]
    fn test_create_htlc_zero_amount() {
        let mut reg = default_registry();
        assert_eq!(create_htlc(&mut reg, alice(), bob(), token_a(), 0, secret_hash(), deadline(), now()), Err(EscrowError::ZeroAmount));
    }

    // ============ Timelock Creation Tests ============

    #[test]
    fn test_create_timelock_basic() {
        let mut reg = default_registry();
        let id = create_timelock(&mut reg, alice(), bob(), token_a(), 500, now() + 100, now()).unwrap();
        let e = get_escrow(&reg, id).unwrap();
        match &e.condition {
            EscrowCondition::Timelock { unlock_at } => assert_eq!(*unlock_at, now() + 100),
            _ => panic!("expected timelock"),
        }
    }

    #[test]
    fn test_create_timelock_zero_unlock() {
        let mut reg = default_registry();
        assert_eq!(create_timelock(&mut reg, alice(), bob(), token_a(), 500, 0, now()), Err(EscrowError::InvalidCondition));
    }

    #[test]
    fn test_create_timelock_deadline_computed() {
        let mut reg = default_registry();
        let unlock = now() + 100;
        let id = create_timelock(&mut reg, alice(), bob(), token_a(), 500, unlock, now()).unwrap();
        let e = get_escrow(&reg, id).unwrap();
        assert_eq!(e.deadline, unlock + DEFAULT_DEADLINE_MS);
    }

    // ============ Release Tests ============

    #[test]
    fn test_release_hashlock() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        let amt = release_escrow(&mut reg, id, Some(secret()), now() + 100, &[], None).unwrap();
        assert_eq!(amt, 1000);
        assert_eq!(get_escrow(&reg, id).unwrap().status, EscrowStatus::Released);
    }

    #[test]
    fn test_release_wrong_preimage() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        assert_eq!(release_escrow(&mut reg, id, Some([99u8; 32]), now() + 100, &[], None), Err(EscrowError::ConditionNotMet));
    }

    #[test]
    fn test_release_no_preimage() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        assert_eq!(release_escrow(&mut reg, id, None, now() + 100, &[], None), Err(EscrowError::ConditionNotMet));
    }

    #[test]
    fn test_release_after_deadline() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        assert_eq!(release_escrow(&mut reg, id, Some(secret()), deadline() + 1, &[], None), Err(EscrowError::DeadlinePassed));
    }

    #[test]
    fn test_release_at_deadline() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        let amt = release_escrow(&mut reg, id, Some(secret()), deadline(), &[], None).unwrap();
        assert_eq!(amt, 1000);
    }

    #[test]
    fn test_release_already_released() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        release_escrow(&mut reg, id, Some(secret()), now() + 100, &[], None).unwrap();
        assert_eq!(release_escrow(&mut reg, id, Some(secret()), now() + 200, &[], None), Err(EscrowError::AlreadyReleased));
    }

    #[test]
    fn test_release_not_found() {
        let mut reg = default_registry();
        assert_eq!(release_escrow(&mut reg, 999, Some(secret()), now(), &[], None), Err(EscrowError::NotFound));
    }

    #[test]
    fn test_release_updates_totals() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        let locked_before = reg.total_locked;
        release_escrow(&mut reg, id, Some(secret()), now() + 100, &[], None).unwrap();
        assert!(reg.total_locked < locked_before);
        assert_eq!(reg.total_released, 1000);
    }

    #[test]
    fn test_release_sets_released_at() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        release_escrow(&mut reg, id, Some(secret()), now() + 500, &[], None).unwrap();
        assert_eq!(get_escrow(&reg, id).unwrap().released_at, Some(now() + 500));
    }

    #[test]
    fn test_release_timelock() {
        let mut reg = default_registry();
        let unlock = now() + 100;
        let id = create_timelock(&mut reg, alice(), bob(), token_a(), 500, unlock, now()).unwrap();
        let e = get_escrow(&reg, id).unwrap();
        let dl = e.deadline;
        let amt = release_escrow(&mut reg, id, None, unlock, &[], None).unwrap();
        assert_eq!(amt, 500);
        assert!(unlock <= dl);
    }

    #[test]
    fn test_release_timelock_too_early() {
        let mut reg = default_registry();
        let unlock = now() + 100;
        let id = create_timelock(&mut reg, alice(), bob(), token_a(), 500, unlock, now()).unwrap();
        assert_eq!(release_escrow(&mut reg, id, None, unlock - 1, &[], None), Err(EscrowError::ConditionNotMet));
    }

    #[test]
    fn test_release_multisig() {
        let mut reg = default_registry();
        let c = EscrowCondition::MultiSig { required: 2, signers: vec![alice(), bob(), charlie()] };
        let id = create_escrow(&mut reg, alice(), bob(), token_a(), 1000, c, deadline(), now()).unwrap();
        let sigs = vec![alice(), bob()];
        let amt = release_escrow(&mut reg, id, None, now() + 100, &sigs, None).unwrap();
        assert_eq!(amt, 1000);
    }

    #[test]
    fn test_release_multisig_insufficient() {
        let mut reg = default_registry();
        let c = EscrowCondition::MultiSig { required: 2, signers: vec![alice(), bob(), charlie()] };
        let id = create_escrow(&mut reg, alice(), bob(), token_a(), 1000, c, deadline(), now()).unwrap();
        assert_eq!(release_escrow(&mut reg, id, None, now() + 100, &[alice()], None), Err(EscrowError::ConditionNotMet));
    }

    #[test]
    fn test_release_oracle() {
        let mut reg = default_registry();
        let c = EscrowCondition::Oracle { oracle_id: [0u8; 32], expected_value: 42 };
        let id = create_escrow(&mut reg, alice(), bob(), token_a(), 1000, c, deadline(), now()).unwrap();
        let amt = release_escrow(&mut reg, id, None, now() + 100, &[], Some(42)).unwrap();
        assert_eq!(amt, 1000);
    }

    #[test]
    fn test_release_oracle_wrong_value() {
        let mut reg = default_registry();
        let c = EscrowCondition::Oracle { oracle_id: [0u8; 32], expected_value: 42 };
        let id = create_escrow(&mut reg, alice(), bob(), token_a(), 1000, c, deadline(), now()).unwrap();
        assert_eq!(release_escrow(&mut reg, id, None, now() + 100, &[], Some(43)), Err(EscrowError::ConditionNotMet));
    }

    // ============ Refund Tests ============

    #[test]
    fn test_refund_after_deadline() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        let amt = refund_escrow(&mut reg, id, deadline() + 1).unwrap();
        assert_eq!(amt, 1000);
        assert_eq!(get_escrow(&reg, id).unwrap().status, EscrowStatus::Refunded);
    }

    #[test]
    fn test_refund_before_deadline() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        assert_eq!(refund_escrow(&mut reg, id, deadline()), Err(EscrowError::DeadlineNotPassed));
    }

    #[test]
    fn test_refund_already_released() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        release_escrow(&mut reg, id, Some(secret()), now() + 100, &[], None).unwrap();
        assert_eq!(refund_escrow(&mut reg, id, deadline() + 1), Err(EscrowError::AlreadyReleased));
    }

    #[test]
    fn test_refund_already_refunded() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        refund_escrow(&mut reg, id, deadline() + 1).unwrap();
        assert_eq!(refund_escrow(&mut reg, id, deadline() + 2), Err(EscrowError::AlreadyRefunded));
    }

    #[test]
    fn test_refund_not_found() {
        let mut reg = default_registry();
        assert_eq!(refund_escrow(&mut reg, 999, deadline() + 1), Err(EscrowError::NotFound));
    }

    #[test]
    fn test_refund_updates_totals() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        refund_escrow(&mut reg, id, deadline() + 1).unwrap();
        assert_eq!(reg.total_refunded, 1000);
        assert_eq!(reg.total_locked, 0);
    }

    #[test]
    fn test_refund_disputed_escrow() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        raise_dispute(&mut reg, id, &alice(), now() + 10).unwrap();
        assert_eq!(refund_escrow(&mut reg, id, deadline() + 1), Err(EscrowError::NotActive));
    }

    // ============ Claim Expired Tests ============

    #[test]
    fn test_claim_expired_basic() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        expire_escrows(&mut reg, deadline() + 1);
        let amt = claim_expired(&mut reg, id, &alice(), deadline() + 2).unwrap();
        assert_eq!(amt, 1000);
        assert_eq!(get_escrow(&reg, id).unwrap().status, EscrowStatus::Claimed);
    }

    #[test]
    fn test_claim_expired_not_depositor() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        expire_escrows(&mut reg, deadline() + 1);
        assert_eq!(claim_expired(&mut reg, id, &bob(), deadline() + 2), Err(EscrowError::NotDepositor));
    }

    #[test]
    fn test_claim_expired_not_yet_expired() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        assert_eq!(claim_expired(&mut reg, id, &alice(), now() + 100), Err(EscrowError::NotExpired));
    }

    #[test]
    fn test_claim_expired_already_released() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        release_escrow(&mut reg, id, Some(secret()), now() + 100, &[], None).unwrap();
        assert_eq!(claim_expired(&mut reg, id, &alice(), deadline() + 1), Err(EscrowError::AlreadyReleased));
    }

    #[test]
    fn test_claim_expired_updates_totals() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        expire_escrows(&mut reg, deadline() + 1);
        claim_expired(&mut reg, id, &alice(), deadline() + 2).unwrap();
        assert_eq!(reg.total_refunded, 1000);
    }

    // ============ Force Release Tests ============

    #[test]
    fn test_force_release_to_recipient() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        reg.escrows[0].arbiter = Some(arbiter_key());
        raise_dispute(&mut reg, id, &alice(), now() + 10).unwrap();
        let amt = force_release(&mut reg, id, &arbiter_key(), true, now() + 20).unwrap();
        assert_eq!(amt, 1000);
        assert_eq!(get_escrow(&reg, id).unwrap().status, EscrowStatus::Released);
    }

    #[test]
    fn test_force_release_to_depositor() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        reg.escrows[0].arbiter = Some(arbiter_key());
        raise_dispute(&mut reg, id, &alice(), now() + 10).unwrap();
        let amt = force_release(&mut reg, id, &arbiter_key(), false, now() + 20).unwrap();
        assert_eq!(amt, 1000);
        assert_eq!(get_escrow(&reg, id).unwrap().status, EscrowStatus::Refunded);
    }

    #[test]
    fn test_force_release_wrong_arbiter() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        reg.escrows[0].arbiter = Some(arbiter_key());
        raise_dispute(&mut reg, id, &alice(), now() + 10).unwrap();
        assert_eq!(force_release(&mut reg, id, &charlie(), true, now() + 20), Err(EscrowError::NotArbiter));
    }

    #[test]
    fn test_force_release_no_arbiter() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        raise_dispute(&mut reg, id, &alice(), now() + 10).unwrap();
        assert_eq!(force_release(&mut reg, id, &arbiter_key(), true, now() + 20), Err(EscrowError::NotArbiter));
    }

    #[test]
    fn test_force_release_not_disputed() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        reg.escrows[0].arbiter = Some(arbiter_key());
        assert_eq!(force_release(&mut reg, id, &arbiter_key(), true, now() + 20), Err(EscrowError::NotActive));
    }

    // ============ Dispute Tests ============

    #[test]
    fn test_raise_dispute_active() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        raise_dispute(&mut reg, id, &alice(), now() + 10).unwrap();
        assert_eq!(get_escrow(&reg, id).unwrap().status, EscrowStatus::Disputed);
    }

    #[test]
    fn test_raise_dispute_by_recipient() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        raise_dispute(&mut reg, id, &bob(), now() + 10).unwrap();
        assert_eq!(get_escrow(&reg, id).unwrap().status, EscrowStatus::Disputed);
    }

    #[test]
    fn test_raise_dispute_by_third_party() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        assert_eq!(raise_dispute(&mut reg, id, &charlie(), now() + 10), Err(EscrowError::NotDepositor));
    }

    #[test]
    fn test_raise_dispute_not_found() {
        let mut reg = default_registry();
        assert_eq!(raise_dispute(&mut reg, 999, &alice(), now()), Err(EscrowError::NotFound));
    }

    #[test]
    fn test_raise_dispute_on_released_within_window() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        let release_time = now() + 100;
        release_escrow(&mut reg, id, Some(secret()), release_time, &[], None).unwrap();
        raise_dispute(&mut reg, id, &alice(), release_time + 100).unwrap();
        assert_eq!(get_escrow(&reg, id).unwrap().status, EscrowStatus::Disputed);
    }

    #[test]
    fn test_raise_dispute_on_released_after_window() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        let release_time = now() + 100;
        release_escrow(&mut reg, id, Some(secret()), release_time, &[], None).unwrap();
        let after_window = release_time + DEFAULT_DISPUTE_WINDOW_MS + 1;
        assert_eq!(raise_dispute(&mut reg, id, &alice(), after_window), Err(EscrowError::DisputeWindowExpired));
    }

    #[test]
    fn test_raise_dispute_on_refunded() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        refund_escrow(&mut reg, id, deadline() + 1).unwrap();
        assert_eq!(raise_dispute(&mut reg, id, &alice(), deadline() + 2), Err(EscrowError::NotActive));
    }

    #[test]
    fn test_resolve_dispute_favor_recipient() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        reg.escrows[0].arbiter = Some(arbiter_key());
        raise_dispute(&mut reg, id, &alice(), now() + 10).unwrap();
        let amt = resolve_dispute(&mut reg, id, &arbiter_key(), true, now() + 20).unwrap();
        assert_eq!(amt, 1000);
        assert_eq!(get_escrow(&reg, id).unwrap().status, EscrowStatus::Released);
    }

    #[test]
    fn test_resolve_dispute_favor_depositor() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        reg.escrows[0].arbiter = Some(arbiter_key());
        raise_dispute(&mut reg, id, &bob(), now() + 10).unwrap();
        let amt = resolve_dispute(&mut reg, id, &arbiter_key(), false, now() + 20).unwrap();
        assert_eq!(amt, 1000);
        assert_eq!(get_escrow(&reg, id).unwrap().status, EscrowStatus::Refunded);
    }

    #[test]
    fn test_can_dispute_active() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        assert!(can_dispute(&reg, id, now() + 10));
    }

    #[test]
    fn test_can_dispute_released_in_window() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        let rel = now() + 100;
        release_escrow(&mut reg, id, Some(secret()), rel, &[], None).unwrap();
        assert!(can_dispute(&reg, id, rel + 100));
    }

    #[test]
    fn test_can_dispute_released_past_window() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        let rel = now() + 100;
        release_escrow(&mut reg, id, Some(secret()), rel, &[], None).unwrap();
        assert!(!can_dispute(&reg, id, rel + DEFAULT_DISPUTE_WINDOW_MS + 1));
    }

    #[test]
    fn test_can_dispute_not_found() {
        let reg = default_registry();
        assert!(!can_dispute(&reg, 999, now()));
    }

    #[test]
    fn test_dispute_remaining_active() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        let e = get_escrow(&reg, id).unwrap();
        let remaining = dispute_remaining_ms(e, now());
        assert_eq!(remaining, DEFAULT_DISPUTE_WINDOW_MS);
    }

    #[test]
    fn test_dispute_remaining_released() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        let rel = now() + 100;
        release_escrow(&mut reg, id, Some(secret()), rel, &[], None).unwrap();
        let e = get_escrow(&reg, id).unwrap();
        let remaining = dispute_remaining_ms(e, rel + 1000);
        assert!(remaining > 0);
    }

    // ============ Query Tests ============

    #[test]
    fn test_get_escrow_found() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        assert!(get_escrow(&reg, id).is_some());
    }

    #[test]
    fn test_get_escrow_not_found() {
        let reg = default_registry();
        assert!(get_escrow(&reg, 999).is_none());
    }

    #[test]
    fn test_escrows_by_depositor() {
        let mut reg = default_registry();
        create_htlc(&mut reg, alice(), bob(), token_a(), 100, secret_hash(), deadline(), now()).unwrap();
        create_htlc(&mut reg, alice(), charlie(), token_a(), 200, secret_hash(), deadline(), now()).unwrap();
        create_htlc(&mut reg, bob(), charlie(), token_a(), 300, secret_hash(), deadline(), now()).unwrap();
        let alice_escrows = escrows_by_depositor(&reg, &alice());
        assert_eq!(alice_escrows.len(), 2);
    }

    #[test]
    fn test_escrows_by_depositor_empty() {
        let reg = default_registry();
        assert!(escrows_by_depositor(&reg, &alice()).is_empty());
    }

    #[test]
    fn test_escrows_by_recipient() {
        let mut reg = default_registry();
        create_htlc(&mut reg, alice(), charlie(), token_a(), 100, secret_hash(), deadline(), now()).unwrap();
        create_htlc(&mut reg, bob(), charlie(), token_a(), 200, secret_hash(), deadline(), now()).unwrap();
        let charlie_escrows = escrows_by_recipient(&reg, &charlie());
        assert_eq!(charlie_escrows.len(), 2);
    }

    #[test]
    fn test_escrows_by_status() {
        let mut reg = default_registry();
        create_htlc(&mut reg, alice(), bob(), token_a(), 100, secret_hash(), deadline(), now()).unwrap();
        let id2 = create_htlc(&mut reg, alice(), charlie(), token_a(), 200, secret_hash(), deadline(), now()).unwrap();
        release_escrow(&mut reg, id2, Some(secret()), now() + 100, &[], None).unwrap();
        let active = escrows_by_status(&reg, &EscrowStatus::Active);
        assert_eq!(active.len(), 1);
        let released = escrows_by_status(&reg, &EscrowStatus::Released);
        assert_eq!(released.len(), 1);
    }

    #[test]
    fn test_active_escrows() {
        let mut reg = default_registry();
        create_htlc(&mut reg, alice(), bob(), token_a(), 100, secret_hash(), deadline(), now()).unwrap();
        create_htlc(&mut reg, alice(), charlie(), token_a(), 200, secret_hash(), deadline(), now()).unwrap();
        assert_eq!(active_escrows(&reg).len(), 2);
    }

    #[test]
    fn test_expiring_soon() {
        let mut reg = default_registry();
        create_htlc(&mut reg, alice(), bob(), token_a(), 100, secret_hash(), now() + 500, now()).unwrap();
        create_htlc(&mut reg, alice(), charlie(), token_a(), 200, secret_hash(), now() + 5000, now()).unwrap();
        let soon = expiring_soon(&reg, now() + 400, 200);
        assert_eq!(soon.len(), 1);
    }

    #[test]
    fn test_expiring_soon_none() {
        let mut reg = default_registry();
        create_htlc(&mut reg, alice(), bob(), token_a(), 100, secret_hash(), deadline(), now()).unwrap();
        let soon = expiring_soon(&reg, now(), 100);
        assert!(soon.is_empty());
    }

    #[test]
    fn test_expiring_soon_already_expired() {
        let mut reg = default_registry();
        create_htlc(&mut reg, alice(), bob(), token_a(), 100, secret_hash(), now() + 100, now()).unwrap();
        let soon = expiring_soon(&reg, now() + 200, 100);
        assert!(soon.is_empty()); // deadline already passed
    }

    // ============ Lifecycle Tests ============

    #[test]
    fn test_expire_escrows() {
        let mut reg = default_registry();
        create_htlc(&mut reg, alice(), bob(), token_a(), 100, secret_hash(), now() + 100, now()).unwrap();
        create_htlc(&mut reg, alice(), charlie(), token_a(), 200, secret_hash(), now() + 200, now()).unwrap();
        let count = expire_escrows(&mut reg, now() + 150);
        assert_eq!(count, 1);
        assert_eq!(get_escrow(&reg, 1).unwrap().status, EscrowStatus::Expired);
        assert_eq!(get_escrow(&reg, 2).unwrap().status, EscrowStatus::Active);
    }

    #[test]
    fn test_expire_all() {
        let mut reg = default_registry();
        create_htlc(&mut reg, alice(), bob(), token_a(), 100, secret_hash(), now() + 100, now()).unwrap();
        create_htlc(&mut reg, alice(), charlie(), token_a(), 200, secret_hash(), now() + 200, now()).unwrap();
        let count = expire_escrows(&mut reg, now() + 300);
        assert_eq!(count, 2);
    }

    #[test]
    fn test_expire_none() {
        let mut reg = default_registry();
        create_htlc(&mut reg, alice(), bob(), token_a(), 100, secret_hash(), deadline(), now()).unwrap();
        let count = expire_escrows(&mut reg, now() + 100);
        assert_eq!(count, 0);
    }

    #[test]
    fn test_time_remaining() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        let e = get_escrow(&reg, id).unwrap();
        assert_eq!(time_remaining(e, now()), deadline() - now());
    }

    #[test]
    fn test_time_remaining_expired() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        let e = get_escrow(&reg, id).unwrap();
        assert_eq!(time_remaining(e, deadline() + 100), 0);
    }

    #[test]
    fn test_is_expired_true() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        let e = get_escrow(&reg, id).unwrap();
        assert!(is_expired(e, deadline() + 1));
    }

    #[test]
    fn test_is_expired_false() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        let e = get_escrow(&reg, id).unwrap();
        assert!(!is_expired(e, deadline()));
    }

    #[test]
    fn test_is_releasable_active_before_deadline() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        let e = get_escrow(&reg, id).unwrap();
        assert!(is_releasable(e, now() + 100));
    }

    #[test]
    fn test_is_releasable_after_deadline() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        let e = get_escrow(&reg, id).unwrap();
        assert!(!is_releasable(e, deadline() + 1));
    }

    #[test]
    fn test_is_releasable_not_active() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        release_escrow(&mut reg, id, Some(secret()), now() + 100, &[], None).unwrap();
        let e = get_escrow(&reg, id).unwrap();
        assert!(!is_releasable(e, now() + 200));
    }

    #[test]
    fn test_cleanup_completed() {
        let mut reg = default_registry();
        let id1 = create_htlc(&mut reg, alice(), bob(), token_a(), 100, secret_hash(), deadline(), now()).unwrap();
        create_htlc(&mut reg, alice(), charlie(), token_a(), 200, secret_hash(), deadline(), now()).unwrap();
        release_escrow(&mut reg, id1, Some(secret()), now() + 100, &[], None).unwrap();
        let removed = cleanup_completed(&mut reg);
        assert_eq!(removed, 1);
        assert_eq!(reg.escrows.len(), 1);
    }

    #[test]
    fn test_cleanup_nothing() {
        let mut reg = default_registry();
        create_htlc(&mut reg, alice(), bob(), token_a(), 100, secret_hash(), deadline(), now()).unwrap();
        let removed = cleanup_completed(&mut reg);
        assert_eq!(removed, 0);
    }

    #[test]
    fn test_cleanup_all_completed() {
        let mut reg = default_registry();
        let id1 = create_htlc(&mut reg, alice(), bob(), token_a(), 100, secret_hash(), deadline(), now()).unwrap();
        let id2 = create_htlc(&mut reg, alice(), charlie(), token_a(), 200, secret_hash(), deadline(), now()).unwrap();
        release_escrow(&mut reg, id1, Some(secret()), now() + 100, &[], None).unwrap();
        refund_escrow(&mut reg, id2, deadline() + 1).unwrap();
        let removed = cleanup_completed(&mut reg);
        assert_eq!(removed, 2);
        assert!(reg.escrows.is_empty());
    }

    // ============ Analytics Tests ============

    #[test]
    fn test_compute_stats_empty() {
        let reg = default_registry();
        let stats = compute_stats(&reg);
        assert_eq!(stats.active_count, 0);
        assert_eq!(stats.completed_count, 0);
        assert_eq!(stats.total_volume, 0);
    }

    #[test]
    fn test_compute_stats_with_data() {
        let mut reg = default_registry();
        let id1 = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        create_htlc(&mut reg, alice(), charlie(), token_a(), 2000, secret_hash(), deadline(), now()).unwrap();
        release_escrow(&mut reg, id1, Some(secret()), now() + 500, &[], None).unwrap();
        let stats = compute_stats(&reg);
        assert_eq!(stats.active_count, 1);
        assert_eq!(stats.completed_count, 1);
        assert_eq!(stats.total_volume, 3000);
        assert_eq!(stats.success_rate_bps, 5000); // 1/2
    }

    #[test]
    fn test_compute_stats_avg_duration() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        release_escrow(&mut reg, id, Some(secret()), now() + 1000, &[], None).unwrap();
        let stats = compute_stats(&reg);
        assert_eq!(stats.avg_duration_ms, 1000);
    }

    #[test]
    fn test_compute_stats_dispute_rate() {
        let mut reg = default_registry();
        create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        let id2 = create_htlc(&mut reg, alice(), charlie(), token_a(), 2000, secret_hash(), deadline(), now()).unwrap();
        raise_dispute(&mut reg, id2, &alice(), now() + 10).unwrap();
        let stats = compute_stats(&reg);
        assert_eq!(stats.disputed_count, 1);
        assert_eq!(stats.dispute_rate_bps, 5000);
    }

    #[test]
    fn test_total_locked_by_token() {
        let mut reg = default_registry();
        create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        create_htlc(&mut reg, alice(), charlie(), token_b(), 2000, secret_hash(), deadline(), now()).unwrap();
        create_htlc(&mut reg, bob(), charlie(), token_a(), 500, secret_hash(), deadline(), now()).unwrap();
        assert_eq!(total_locked_by_token(&reg, &token_a()), 1500);
        assert_eq!(total_locked_by_token(&reg, &token_b()), 2000);
    }

    #[test]
    fn test_total_locked_by_token_excludes_released() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        create_htlc(&mut reg, alice(), charlie(), token_a(), 500, secret_hash(), deadline(), now()).unwrap();
        release_escrow(&mut reg, id, Some(secret()), now() + 100, &[], None).unwrap();
        assert_eq!(total_locked_by_token(&reg, &token_a()), 500);
    }

    #[test]
    fn test_avg_escrow_duration_none() {
        let reg = default_registry();
        assert_eq!(avg_escrow_duration(&reg), 0);
    }

    #[test]
    fn test_avg_escrow_duration_computed() {
        let mut reg = default_registry();
        let id1 = create_htlc(&mut reg, alice(), bob(), token_a(), 100, secret_hash(), deadline(), now()).unwrap();
        let id2 = create_htlc(&mut reg, alice(), charlie(), token_a(), 200, secret_hash(), deadline(), now()).unwrap();
        release_escrow(&mut reg, id1, Some(secret()), now() + 1000, &[], None).unwrap();
        release_escrow(&mut reg, id2, Some(secret()), now() + 3000, &[], None).unwrap();
        assert_eq!(avg_escrow_duration(&reg), 2000);
    }

    #[test]
    fn test_success_rate_empty() {
        let reg = default_registry();
        assert_eq!(success_rate(&reg), 0);
    }

    #[test]
    fn test_success_rate_all_released() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 100, secret_hash(), deadline(), now()).unwrap();
        release_escrow(&mut reg, id, Some(secret()), now() + 100, &[], None).unwrap();
        assert_eq!(success_rate(&reg), 10_000);
    }

    #[test]
    fn test_success_rate_partial() {
        let mut reg = default_registry();
        let id1 = create_htlc(&mut reg, alice(), bob(), token_a(), 100, secret_hash(), deadline(), now()).unwrap();
        create_htlc(&mut reg, alice(), charlie(), token_a(), 200, secret_hash(), deadline(), now()).unwrap();
        release_escrow(&mut reg, id1, Some(secret()), now() + 100, &[], None).unwrap();
        assert_eq!(success_rate(&reg), 5000);
    }

    #[test]
    fn test_total_active_value() {
        let mut reg = default_registry();
        create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        create_htlc(&mut reg, alice(), charlie(), token_a(), 2000, secret_hash(), deadline(), now()).unwrap();
        assert_eq!(total_active_value(&reg), 3000);
    }

    #[test]
    fn test_total_active_value_excludes_released() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        create_htlc(&mut reg, alice(), charlie(), token_a(), 2000, secret_hash(), deadline(), now()).unwrap();
        release_escrow(&mut reg, id, Some(secret()), now() + 100, &[], None).unwrap();
        assert_eq!(total_active_value(&reg), 2000);
    }

    // ============ Atomic Swap Tests ============

    #[test]
    fn test_create_swap_pair() {
        let mut reg = default_registry();
        let (id_a, id_b) = create_swap_pair(&mut reg, alice(), bob(), token_a(), 1000, token_b(), 2000, secret_hash(), deadline(), now()).unwrap();
        assert_eq!(id_a, 1);
        assert_eq!(id_b, 2);
        assert_eq!(reg.escrows.len(), 2);
    }

    #[test]
    fn test_create_swap_pair_mirrored_parties() {
        let mut reg = default_registry();
        let (id_a, id_b) = create_swap_pair(&mut reg, alice(), bob(), token_a(), 1000, token_b(), 2000, secret_hash(), deadline(), now()).unwrap();
        let a = get_escrow(&reg, id_a).unwrap();
        let b = get_escrow(&reg, id_b).unwrap();
        assert_eq!(a.depositor, alice());
        assert_eq!(a.recipient, bob());
        assert_eq!(b.depositor, bob());
        assert_eq!(b.recipient, alice());
    }

    #[test]
    fn test_complete_swap() {
        let mut reg = default_registry();
        let (id_a, id_b) = create_swap_pair(&mut reg, alice(), bob(), token_a(), 1000, token_b(), 2000, secret_hash(), deadline(), now()).unwrap();
        let (amt_a, amt_b) = complete_swap(&mut reg, id_a, id_b, secret(), now() + 100).unwrap();
        assert_eq!(amt_a, 1000);
        assert_eq!(amt_b, 2000);
        assert_eq!(get_escrow(&reg, id_a).unwrap().status, EscrowStatus::Released);
        assert_eq!(get_escrow(&reg, id_b).unwrap().status, EscrowStatus::Released);
    }

    #[test]
    fn test_complete_swap_wrong_preimage() {
        let mut reg = default_registry();
        let (id_a, id_b) = create_swap_pair(&mut reg, alice(), bob(), token_a(), 1000, token_b(), 2000, secret_hash(), deadline(), now()).unwrap();
        let result = complete_swap(&mut reg, id_a, id_b, [99u8; 32], now() + 100);
        assert_eq!(result, Err(EscrowError::ConditionNotMet));
    }

    #[test]
    fn test_is_swap_pair_true() {
        let mut reg = default_registry();
        let (id_a, id_b) = create_swap_pair(&mut reg, alice(), bob(), token_a(), 1000, token_b(), 2000, secret_hash(), deadline(), now()).unwrap();
        assert!(is_swap_pair(&reg, id_a, id_b));
    }

    #[test]
    fn test_is_swap_pair_false_different_hash() {
        let mut reg = default_registry();
        let id_a = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        let id_b = create_htlc(&mut reg, bob(), alice(), token_b(), 2000, compute_hash(&[99u8; 32]), deadline(), now()).unwrap();
        assert!(!is_swap_pair(&reg, id_a, id_b));
    }

    #[test]
    fn test_is_swap_pair_false_same_direction() {
        let mut reg = default_registry();
        let id_a = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        let id_b = create_htlc(&mut reg, alice(), bob(), token_b(), 2000, secret_hash(), deadline(), now()).unwrap();
        assert!(!is_swap_pair(&reg, id_a, id_b));
    }

    #[test]
    fn test_is_swap_pair_not_found() {
        let reg = default_registry();
        assert!(!is_swap_pair(&reg, 1, 2));
    }

    #[test]
    fn test_is_swap_pair_non_htlc() {
        let mut reg = default_registry();
        let c = EscrowCondition::Timelock { unlock_at: 500 };
        let id_a = create_escrow(&mut reg, alice(), bob(), token_a(), 1000, c, deadline(), now()).unwrap();
        let id_b = create_htlc(&mut reg, bob(), alice(), token_b(), 2000, secret_hash(), deadline(), now()).unwrap();
        assert!(!is_swap_pair(&reg, id_a, id_b));
    }

    // ============ Validation Tests ============

    #[test]
    fn test_validate_escrow_valid() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        let e = get_escrow(&reg, id).unwrap();
        assert!(validate_escrow(e).is_ok());
    }

    #[test]
    fn test_validate_escrow_zero_amount() {
        let e = Escrow {
            escrow_id: 1,
            depositor: alice(),
            recipient: bob(),
            token: token_a(),
            amount: 0,
            fee: 0,
            condition: EscrowCondition::Hashlock { hash: secret_hash() },
            status: EscrowStatus::Active,
            created_at: now(),
            deadline: deadline(),
            released_at: None,
            dispute_deadline: deadline() + DEFAULT_DISPUTE_WINDOW_MS,
            arbiter: None,
        };
        assert_eq!(validate_escrow(&e), Err(EscrowError::ZeroAmount));
    }

    #[test]
    fn test_validate_escrow_self() {
        let e = Escrow {
            escrow_id: 1,
            depositor: alice(),
            recipient: alice(),
            token: token_a(),
            amount: 1000,
            fee: 1,
            condition: EscrowCondition::Hashlock { hash: secret_hash() },
            status: EscrowStatus::Active,
            created_at: now(),
            deadline: deadline(),
            released_at: None,
            dispute_deadline: deadline() + DEFAULT_DISPUTE_WINDOW_MS,
            arbiter: None,
        };
        assert_eq!(validate_escrow(&e), Err(EscrowError::SelfEscrow));
    }

    #[test]
    fn test_validate_escrow_invalid_deadline() {
        let e = Escrow {
            escrow_id: 1,
            depositor: alice(),
            recipient: bob(),
            token: token_a(),
            amount: 1000,
            fee: 1,
            condition: EscrowCondition::Hashlock { hash: secret_hash() },
            status: EscrowStatus::Active,
            created_at: now(),
            deadline: now() - 1,
            released_at: None,
            dispute_deadline: deadline() + DEFAULT_DISPUTE_WINDOW_MS,
            arbiter: None,
        };
        assert_eq!(validate_escrow(&e), Err(EscrowError::InvalidDeadline));
    }

    #[test]
    fn test_validate_registry_valid() {
        let mut reg = default_registry();
        create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        assert!(validate_registry(&reg));
    }

    #[test]
    fn test_validate_registry_empty() {
        let reg = default_registry();
        assert!(validate_registry(&reg));
    }

    #[test]
    fn test_validate_registry_after_release() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        release_escrow(&mut reg, id, Some(secret()), now() + 100, &[], None).unwrap();
        assert!(validate_registry(&reg));
    }

    // ============ Health Tests ============

    #[test]
    fn test_health_empty() {
        let reg = default_registry();
        assert_eq!(escrow_health(&reg, now()), 10_000);
    }

    #[test]
    fn test_health_all_active() {
        let mut reg = default_registry();
        create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        assert_eq!(escrow_health(&reg, now()), 10_000);
    }

    #[test]
    fn test_health_disputed_lowers() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        raise_dispute(&mut reg, id, &alice(), now() + 10).unwrap();
        let health = escrow_health(&reg, now() + 20);
        assert!(health < 10_000);
    }

    #[test]
    fn test_health_expired_lowers() {
        let mut reg = default_registry();
        create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), now() + 100, now()).unwrap();
        let health = escrow_health(&reg, now() + 200);
        assert!(health < 10_000);
    }

    #[test]
    fn test_health_invalid_registry_lowers() {
        let mut reg = default_registry();
        create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        reg.total_locked = 9999999; // corrupt
        let health = escrow_health(&reg, now());
        assert!(health < 10_000);
    }

    // ============ Next ID Tests ============

    #[test]
    fn test_next_escrow_id_initial() {
        let reg = default_registry();
        assert_eq!(next_escrow_id(&reg), 1);
    }

    #[test]
    fn test_next_escrow_id_after_create() {
        let mut reg = default_registry();
        create_htlc(&mut reg, alice(), bob(), token_a(), 100, secret_hash(), deadline(), now()).unwrap();
        assert_eq!(next_escrow_id(&reg), 2);
    }

    // ============ Edge Case Tests ============

    #[test]
    fn test_large_amount_no_overflow() {
        let mut reg = create_registry(DEFAULT_DEADLINE_MS, DEFAULT_DISPUTE_WINDOW_MS, 0);
        let id = create_escrow(&mut reg, alice(), bob(), token_a(), u64::MAX, EscrowCondition::Hashlock { hash: secret_hash() }, deadline(), now()).unwrap();
        let e = get_escrow(&reg, id).unwrap();
        assert_eq!(e.amount, u64::MAX);
    }

    #[test]
    fn test_fee_with_max_bps() {
        assert_eq!(compute_fee(1000, 10_000), 1000);
    }

    #[test]
    fn test_multiple_releases_track_totals() {
        let mut reg = default_registry();
        let id1 = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        let id2 = create_htlc(&mut reg, alice(), charlie(), token_a(), 2000, secret_hash(), deadline(), now()).unwrap();
        release_escrow(&mut reg, id1, Some(secret()), now() + 100, &[], None).unwrap();
        release_escrow(&mut reg, id2, Some(secret()), now() + 200, &[], None).unwrap();
        assert_eq!(reg.total_released, 3000);
    }

    #[test]
    fn test_refund_then_create_new() {
        let mut reg = default_registry();
        let id1 = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        refund_escrow(&mut reg, id1, deadline() + 1).unwrap();
        let id2 = create_htlc(&mut reg, alice(), bob(), token_a(), 500, secret_hash(), deadline() + 100, now()).unwrap();
        assert_eq!(id2, 2);
        assert_eq!(reg.escrows.len(), 2);
    }

    #[test]
    fn test_composite_multisig_and_hashlock() {
        let mut reg = default_registry();
        let c = EscrowCondition::Composite {
            conditions: vec![
                EscrowCondition::MultiSig { required: 1, signers: vec![alice()] },
                EscrowCondition::Hashlock { hash: secret_hash() },
            ],
            require_all: true,
        };
        let id = create_escrow(&mut reg, alice(), bob(), token_a(), 1000, c, deadline(), now()).unwrap();
        let sigs = vec![alice()];
        let amt = release_escrow(&mut reg, id, Some(secret()), now() + 100, &sigs, None).unwrap();
        assert_eq!(amt, 1000);
    }

    #[test]
    fn test_composite_or_oracle_or_timelock() {
        let mut reg = default_registry();
        let c = EscrowCondition::Composite {
            conditions: vec![
                EscrowCondition::Oracle { oracle_id: [0u8; 32], expected_value: 42 },
                EscrowCondition::Timelock { unlock_at: now() + 10000 },
            ],
            require_all: false,
        };
        let id = create_escrow(&mut reg, alice(), bob(), token_a(), 500, c, deadline(), now()).unwrap();
        // Oracle met, timelock not met — should pass with OR
        let amt = release_escrow(&mut reg, id, None, now() + 100, &[], Some(42)).unwrap();
        assert_eq!(amt, 500);
    }

    #[test]
    fn test_dispute_re_locks_released_funds() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        let rel_time = now() + 100;
        release_escrow(&mut reg, id, Some(secret()), rel_time, &[], None).unwrap();
        assert_eq!(reg.total_released, 1000);
        assert_eq!(reg.total_locked, 0);
        raise_dispute(&mut reg, id, &alice(), rel_time + 50).unwrap();
        // Funds should be re-locked
        assert!(reg.total_locked > 0);
        assert_eq!(reg.total_released, 0);
    }

    #[test]
    fn test_swap_pair_zero_amount_a() {
        let mut reg = default_registry();
        let result = create_swap_pair(&mut reg, alice(), bob(), token_a(), 0, token_b(), 2000, secret_hash(), deadline(), now());
        assert_eq!(result, Err(EscrowError::ZeroAmount));
    }

    #[test]
    fn test_swap_pair_zero_amount_b() {
        let mut reg = default_registry();
        let result = create_swap_pair(&mut reg, alice(), bob(), token_a(), 1000, token_b(), 0, secret_hash(), deadline(), now());
        assert_eq!(result, Err(EscrowError::ZeroAmount));
    }

    #[test]
    fn test_complete_swap_after_deadline() {
        let mut reg = default_registry();
        let (id_a, _id_b) = create_swap_pair(&mut reg, alice(), bob(), token_a(), 1000, token_b(), 2000, secret_hash(), deadline(), now()).unwrap();
        let result = complete_swap(&mut reg, id_a, _id_b, secret(), deadline() + 1);
        assert_eq!(result, Err(EscrowError::DeadlinePassed));
    }

    #[test]
    fn test_expire_does_not_touch_released() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), now() + 100, now()).unwrap();
        release_escrow(&mut reg, id, Some(secret()), now() + 50, &[], None).unwrap();
        let count = expire_escrows(&mut reg, now() + 200);
        assert_eq!(count, 0);
        assert_eq!(get_escrow(&reg, id).unwrap().status, EscrowStatus::Released);
    }

    #[test]
    fn test_cleanup_retains_active_and_disputed() {
        let mut reg = default_registry();
        create_htlc(&mut reg, alice(), bob(), token_a(), 100, secret_hash(), deadline(), now()).unwrap();
        let id2 = create_htlc(&mut reg, alice(), charlie(), token_a(), 200, secret_hash(), deadline(), now()).unwrap();
        raise_dispute(&mut reg, id2, &alice(), now() + 10).unwrap();
        let removed = cleanup_completed(&mut reg);
        assert_eq!(removed, 0);
        assert_eq!(reg.escrows.len(), 2);
    }

    #[test]
    fn test_stats_expired_count() {
        let mut reg = default_registry();
        create_htlc(&mut reg, alice(), bob(), token_a(), 100, secret_hash(), now() + 100, now()).unwrap();
        expire_escrows(&mut reg, now() + 200);
        let stats = compute_stats(&reg);
        assert_eq!(stats.expired_count, 1);
    }

    #[test]
    fn test_total_locked_by_token_includes_disputed() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        raise_dispute(&mut reg, id, &alice(), now() + 10).unwrap();
        assert_eq!(total_locked_by_token(&reg, &token_a()), 1000);
    }

    #[test]
    fn test_escrows_by_recipient_empty() {
        let reg = default_registry();
        assert!(escrows_by_recipient(&reg, &alice()).is_empty());
    }

    #[test]
    fn test_create_htlc_self_escrow() {
        let mut reg = default_registry();
        assert_eq!(create_htlc(&mut reg, alice(), alice(), token_a(), 100, secret_hash(), deadline(), now()), Err(EscrowError::SelfEscrow));
    }

    #[test]
    fn test_create_timelock_self_escrow() {
        let mut reg = default_registry();
        assert_eq!(create_timelock(&mut reg, alice(), alice(), token_a(), 100, now() + 100, now()), Err(EscrowError::SelfEscrow));
    }

    #[test]
    fn test_claim_expired_without_expire_call() {
        // claim_expired should work even if expire_escrows was not called, as long as deadline passed
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), now() + 100, now()).unwrap();
        // Don't call expire_escrows — claim_expired checks is_expired internally
        let amt = claim_expired(&mut reg, id, &alice(), now() + 200).unwrap();
        assert_eq!(amt, 1000);
    }

    #[test]
    fn test_claim_expired_already_claimed() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), now() + 100, now()).unwrap();
        expire_escrows(&mut reg, now() + 200);
        claim_expired(&mut reg, id, &alice(), now() + 300).unwrap();
        assert_eq!(claim_expired(&mut reg, id, &alice(), now() + 400), Err(EscrowError::AlreadyRefunded));
    }

    #[test]
    fn test_force_release_updates_released_total() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        reg.escrows[0].arbiter = Some(arbiter_key());
        raise_dispute(&mut reg, id, &alice(), now() + 10).unwrap();
        force_release(&mut reg, id, &arbiter_key(), true, now() + 20).unwrap();
        assert_eq!(reg.total_released, 1000);
    }

    #[test]
    fn test_force_release_updates_refunded_total() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        reg.escrows[0].arbiter = Some(arbiter_key());
        raise_dispute(&mut reg, id, &alice(), now() + 10).unwrap();
        force_release(&mut reg, id, &arbiter_key(), false, now() + 20).unwrap();
        assert_eq!(reg.total_refunded, 1000);
    }

    // ============ Hardening Round 10 ============

    #[test]
    fn test_create_escrow_zero_amount_h10() {
        let mut reg = default_registry();
        let result = create_escrow(&mut reg, alice(), bob(), token_a(), 0,
            EscrowCondition::Hashlock { hash: secret_hash() }, deadline(), now());
        assert_eq!(result, Err(EscrowError::ZeroAmount));
    }

    #[test]
    fn test_create_escrow_self_escrow_h10() {
        let mut reg = default_registry();
        let result = create_escrow(&mut reg, alice(), alice(), token_a(), 1000,
            EscrowCondition::Hashlock { hash: secret_hash() }, deadline(), now());
        assert_eq!(result, Err(EscrowError::SelfEscrow));
    }

    #[test]
    fn test_create_escrow_deadline_in_past_h10() {
        let mut reg = default_registry();
        let result = create_escrow(&mut reg, alice(), bob(), token_a(), 1000,
            EscrowCondition::Hashlock { hash: secret_hash() }, now(), now());
        assert_eq!(result, Err(EscrowError::InvalidDeadline));
    }

    #[test]
    fn test_compute_fee_zero_amount_h10() {
        assert_eq!(compute_fee(0, 100), 0);
    }

    #[test]
    fn test_compute_fee_zero_rate_h10() {
        assert_eq!(compute_fee(10_000, 0), 0);
    }

    #[test]
    fn test_compute_fee_normal_h10() {
        // 10000 * 10 / 10000 = 10
        assert_eq!(compute_fee(10_000, 10), 10);
    }

    #[test]
    fn test_compute_hash_deterministic_h10() {
        let preimage = [42u8; 32];
        let h1 = compute_hash(&preimage);
        let h2 = compute_hash(&preimage);
        assert_eq!(h1, h2);
    }

    #[test]
    fn test_check_hashlock_correct_preimage_h10() {
        let preimage = [1u8; 32];
        let hash = compute_hash(&preimage);
        assert!(check_hashlock(&hash, &preimage));
    }

    #[test]
    fn test_check_hashlock_wrong_preimage_h10() {
        let preimage = [1u8; 32];
        let hash = compute_hash(&preimage);
        let wrong = [2u8; 32];
        assert!(!check_hashlock(&hash, &wrong));
    }

    #[test]
    fn test_check_timelock_before_h10() {
        assert!(!check_timelock(1000, 999));
    }

    #[test]
    fn test_check_timelock_exact_h10() {
        assert!(check_timelock(1000, 1000));
    }

    #[test]
    fn test_check_timelock_after_h10() {
        assert!(check_timelock(1000, 1001));
    }

    #[test]
    fn test_check_multisig_insufficient_h10() {
        let signers = vec![[1u8; 32], [2u8; 32], [3u8; 32]];
        let provided = vec![[1u8; 32]]; // only 1, need 2
        assert!(!check_multisig(2, &signers, &provided));
    }

    #[test]
    fn test_check_multisig_sufficient_h10() {
        let signers = vec![[1u8; 32], [2u8; 32], [3u8; 32]];
        let provided = vec![[1u8; 32], [3u8; 32]]; // 2 of 3
        assert!(check_multisig(2, &signers, &provided));
    }

    #[test]
    fn test_check_multisig_required_exceeds_signers_h10() {
        let signers = vec![[1u8; 32]];
        let provided = vec![[1u8; 32]];
        assert!(!check_multisig(2, &signers, &provided));
    }

    #[test]
    fn test_validate_condition_empty_composite_h10() {
        let cond = EscrowCondition::Composite { conditions: vec![], require_all: true };
        assert_eq!(validate_condition(&cond), Err(EscrowError::InvalidCondition));
    }

    #[test]
    fn test_validate_condition_timelock_zero_h10() {
        let cond = EscrowCondition::Timelock { unlock_at: 0 };
        assert_eq!(validate_condition(&cond), Err(EscrowError::InvalidCondition));
    }

    #[test]
    fn test_validate_condition_multisig_zero_required_h10() {
        let cond = EscrowCondition::MultiSig { required: 0, signers: vec![[1u8; 32]] };
        assert_eq!(validate_condition(&cond), Err(EscrowError::InvalidCondition));
    }

    #[test]
    fn test_validate_escrow_full_h10() {
        let escrow = Escrow {
            escrow_id: 1, depositor: alice(), recipient: bob(), token: token_a(),
            amount: 1000, fee: 1, condition: EscrowCondition::Hashlock { hash: secret_hash() },
            status: EscrowStatus::Active, created_at: now(), deadline: deadline(),
            released_at: None, dispute_deadline: deadline() + 86_400_000,
            arbiter: None,
        };
        assert!(validate_escrow(&escrow).is_ok());
    }

    #[test]
    fn test_release_after_deadline_h10() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        let result = release_escrow(&mut reg, id, Some(secret()), deadline() + 1, &[], None);
        assert_eq!(result, Err(EscrowError::DeadlinePassed));
    }

    #[test]
    fn test_refund_before_deadline_h10() {
        let mut reg = default_registry();
        let id = create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        let result = refund_escrow(&mut reg, id, now() + 10);
        assert_eq!(result, Err(EscrowError::DeadlineNotPassed));
    }

    #[test]
    fn test_release_not_found_h10() {
        let mut reg = default_registry();
        let result = release_escrow(&mut reg, 999, None, now(), &[], None);
        assert_eq!(result, Err(EscrowError::NotFound));
    }

    #[test]
    fn test_refund_not_found_h10() {
        let mut reg = default_registry();
        let result = refund_escrow(&mut reg, 999, now());
        assert_eq!(result, Err(EscrowError::NotFound));
    }

    #[test]
    fn test_escrows_by_depositor_h10() {
        let mut reg = default_registry();
        create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        create_htlc(&mut reg, alice(), bob(), token_a(), 2000, secret_hash(), deadline(), now()).unwrap();
        let found = escrows_by_depositor(&reg, &alice());
        assert_eq!(found.len(), 2);
    }

    #[test]
    fn test_escrows_by_recipient_h10() {
        let mut reg = default_registry();
        create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        let found = escrows_by_recipient(&reg, &bob());
        assert_eq!(found.len(), 1);
    }

    #[test]
    fn test_active_escrows_h10() {
        let mut reg = default_registry();
        create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        assert_eq!(active_escrows(&reg).len(), 1);
    }

    #[test]
    fn test_expire_escrows_count_h10() {
        let mut reg = default_registry();
        create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), now() + 100, now()).unwrap();
        create_htlc(&mut reg, alice(), bob(), token_a(), 2000, secret_hash(), now() + 200, now()).unwrap();
        let expired = expire_escrows(&mut reg, now() + 150);
        assert_eq!(expired, 1);
    }

    #[test]
    fn test_time_remaining_before_deadline_h10() {
        let mut reg = default_registry();
        create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), now() + 500, now()).unwrap();
        let escrow = &reg.escrows[0];
        assert_eq!(time_remaining(escrow, now() + 100), 400);
    }

    #[test]
    fn test_time_remaining_past_deadline_h10() {
        let mut reg = default_registry();
        create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), now() + 100, now()).unwrap();
        let escrow = &reg.escrows[0];
        assert_eq!(time_remaining(escrow, now() + 200), 0);
    }

    #[test]
    fn test_is_expired_h10() {
        let mut reg = default_registry();
        create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), now() + 100, now()).unwrap();
        let escrow = &reg.escrows[0];
        assert!(!is_expired(escrow, now()));
        assert!(is_expired(escrow, now() + 101));
    }

    #[test]
    fn test_is_releasable_h10() {
        let mut reg = default_registry();
        create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), now() + 100, now()).unwrap();
        let escrow = &reg.escrows[0];
        assert!(is_releasable(escrow, now()));
        assert!(!is_releasable(escrow, now() + 101));
    }

    #[test]
    fn test_cleanup_completed_h10() {
        let mut reg = default_registry();
        create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        release_escrow(&mut reg, 1, Some(secret()), now() + 10, &[], None).unwrap();
        let removed = cleanup_completed(&mut reg);
        assert_eq!(removed, 1);
        assert!(reg.escrows.is_empty());
    }

    #[test]
    fn test_compute_stats_empty_h10() {
        let reg = default_registry();
        let stats = compute_stats(&reg);
        assert_eq!(stats.active_count, 0);
        assert_eq!(stats.total_volume, 0);
    }

    #[test]
    fn test_validate_registry_consistent_h10() {
        let mut reg = default_registry();
        create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        assert!(validate_registry(&reg));
    }

    #[test]
    fn test_next_escrow_id_increments_h10() {
        let mut reg = default_registry();
        assert_eq!(next_escrow_id(&reg), 1);
        create_htlc(&mut reg, alice(), bob(), token_a(), 1000, secret_hash(), deadline(), now()).unwrap();
        assert_eq!(next_escrow_id(&reg), 2);
    }

    #[test]
    fn test_create_timelock_zero_unlock_h10() {
        let mut reg = default_registry();
        let result = create_timelock(&mut reg, alice(), bob(), token_a(), 1000, 0, now());
        assert_eq!(result, Err(EscrowError::InvalidCondition));
    }

    #[test]
    fn test_evaluate_composite_empty_conditions_h10() {
        let result = evaluate_composite(&[], true, None, now(), &[], None);
        assert!(!result);
    }

    #[test]
    fn test_evaluate_composite_any_mode_h10() {
        let conditions = vec![
            EscrowCondition::Timelock { unlock_at: now() + 1000 }, // not met
            EscrowCondition::Timelock { unlock_at: now() },        // met
        ];
        assert!(evaluate_composite(&conditions, false, None, now(), &[], None));
    }

    #[test]
    fn test_evaluate_composite_all_mode_h10() {
        let conditions = vec![
            EscrowCondition::Timelock { unlock_at: now() + 1000 }, // not met
            EscrowCondition::Timelock { unlock_at: now() },        // met
        ];
        assert!(!evaluate_composite(&conditions, true, None, now(), &[], None));
    }
}
