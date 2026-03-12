// ============ Multisig Module ============
// Multi-Signature Operations — managing m-of-n signature requirements for CKB
// transactions. Essential for treasury management, governance execution, and
// protocol upgrades.
//
// All functions are standalone pub fn. No traits, no impl blocks.
// Weighted voting: each signer carries a weight, threshold is total weight needed.

use sha2::{Digest, Sha256};

// ============ Constants ============

/// Maximum signers per wallet
pub const MAX_SIGNERS: usize = 32;

/// Maximum proposals per wallet
pub const MAX_PROPOSALS: usize = 256;

/// One day in milliseconds
pub const ONE_DAY_MS: u64 = 86_400_000;

/// Default proposal expiry (72 hours)
pub const DEFAULT_EXPIRY_MS: u64 = 259_200_000;

/// Default execution delay (24 hours)
pub const DEFAULT_DELAY_MS: u64 = 86_400_000;

// ============ Error Types ============

#[derive(Debug, Clone, PartialEq)]
pub enum MultisigError {
    NotASigner,
    AlreadyApproved,
    InsufficientThreshold,
    ProposalExpired,
    ProposalNotApproved,
    TimelockActive,
    InvalidThreshold,
    DuplicateSigner,
    SignerNotFound,
    ProposalNotFound,
    WalletFull,
    InvalidWeight,
    ReplayDetected,
    DailyLimitExceeded,
    CannotRemoveLastSigner,
    ProposalNotPending,
    Cancelled,
    AlreadyExecuted,
}

// ============ Data Types ============

#[derive(Debug, Clone, PartialEq)]
pub enum MultisigStatus {
    Pending,
    Approved,
    Rejected,
    Executed,
    Expired,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ProposalType {
    Transfer { to: [u8; 32], amount: u64, token: [u8; 32] },
    ConfigChange { key: u32, old_value: u64, new_value: u64 },
    SignerAdd { signer: [u8; 32], weight: u32 },
    SignerRemove { signer: [u8; 32] },
    ThresholdChange { new_threshold: u32 },
    EmergencyAction { action_code: u32, data: u64 },
    Custom { action_hash: [u8; 32], description_hash: [u8; 32] },
}

#[derive(Debug, Clone, PartialEq)]
pub struct Signer {
    pub address: [u8; 32],
    pub weight: u32,
    pub added_at: u64,
    pub is_active: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Approval {
    pub signer: [u8; 32],
    pub approved: bool,
    pub timestamp: u64,
    pub nonce: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MultisigProposal {
    pub proposal_id: u64,
    pub proposer: [u8; 32],
    pub proposal_type: ProposalType,
    pub status: MultisigStatus,
    pub created_at: u64,
    pub expires_at: u64,
    pub approvals: Vec<Approval>,
    pub execution_delay_ms: u64,
    pub executed_at: Option<u64>,
    pub nonce: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MultisigWallet {
    pub wallet_id: [u8; 32],
    pub signers: Vec<Signer>,
    pub threshold: u32,
    pub total_weight: u32,
    pub proposals: Vec<MultisigProposal>,
    pub nonce: u64,
    pub proposal_expiry_ms: u64,
    pub execution_delay_ms: u64,
    pub daily_limit: u64,
    pub daily_spent: u64,
    pub daily_reset_at: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MultisigStats {
    pub total_proposals: u64,
    pub approved_count: u64,
    pub rejected_count: u64,
    pub expired_count: u64,
    pub executed_count: u64,
    pub avg_approval_time_ms: u64,
    pub avg_signers_per_proposal: u64,
    pub most_active_signer: Option<[u8; 32]>,
}

// ============ Wallet Management ============

pub fn create_wallet(
    wallet_id: [u8; 32],
    initial_signers: Vec<Signer>,
    threshold: u32,
    expiry_ms: u64,
    delay_ms: u64,
    daily_limit: u64,
) -> Result<MultisigWallet, MultisigError> {
    if initial_signers.is_empty() {
        return Err(MultisigError::InvalidThreshold);
    }
    if initial_signers.len() > MAX_SIGNERS {
        return Err(MultisigError::WalletFull);
    }
    // Check for duplicates
    for i in 0..initial_signers.len() {
        for j in (i + 1)..initial_signers.len() {
            if initial_signers[i].address == initial_signers[j].address {
                return Err(MultisigError::DuplicateSigner);
            }
        }
    }
    // Check weights
    let mut total_weight: u32 = 0;
    for s in &initial_signers {
        if s.weight == 0 {
            return Err(MultisigError::InvalidWeight);
        }
        total_weight = total_weight.saturating_add(s.weight);
    }
    if threshold == 0 || threshold > total_weight {
        return Err(MultisigError::InvalidThreshold);
    }
    Ok(MultisigWallet {
        wallet_id,
        signers: initial_signers,
        threshold,
        total_weight,
        proposals: Vec::new(),
        nonce: 0,
        proposal_expiry_ms: expiry_ms,
        execution_delay_ms: delay_ms,
        daily_limit,
        daily_spent: 0,
        daily_reset_at: 0,
    })
}

pub fn validate_wallet(wallet: &MultisigWallet) -> Result<(), MultisigError> {
    if wallet.signers.is_empty() {
        return Err(MultisigError::InvalidThreshold);
    }
    if wallet.signers.len() > MAX_SIGNERS {
        return Err(MultisigError::WalletFull);
    }
    let active: Vec<&Signer> = wallet.signers.iter().filter(|s| s.is_active).collect();
    if active.is_empty() {
        return Err(MultisigError::InvalidThreshold);
    }
    let mut computed_weight: u32 = 0;
    for s in &active {
        if s.weight == 0 {
            return Err(MultisigError::InvalidWeight);
        }
        computed_weight = computed_weight.saturating_add(s.weight);
    }
    if wallet.threshold == 0 || wallet.threshold > computed_weight {
        return Err(MultisigError::InvalidThreshold);
    }
    // Check for duplicates
    for i in 0..wallet.signers.len() {
        for j in (i + 1)..wallet.signers.len() {
            if wallet.signers[i].address == wallet.signers[j].address {
                return Err(MultisigError::DuplicateSigner);
            }
        }
    }
    Ok(())
}

pub fn add_signer(wallet: &mut MultisigWallet, signer: Signer) -> Result<(), MultisigError> {
    if wallet.signers.len() >= MAX_SIGNERS {
        return Err(MultisigError::WalletFull);
    }
    if signer.weight == 0 {
        return Err(MultisigError::InvalidWeight);
    }
    for s in &wallet.signers {
        if s.address == signer.address {
            return Err(MultisigError::DuplicateSigner);
        }
    }
    wallet.total_weight = wallet.total_weight.saturating_add(signer.weight);
    wallet.signers.push(signer);
    Ok(())
}

pub fn remove_signer(
    wallet: &mut MultisigWallet,
    address: &[u8; 32],
) -> Result<Signer, MultisigError> {
    let active_count = wallet.signers.iter().filter(|s| s.is_active).count();
    let pos = wallet
        .signers
        .iter()
        .position(|s| &s.address == address && s.is_active)
        .ok_or(MultisigError::SignerNotFound)?;
    if active_count <= 1 {
        return Err(MultisigError::CannotRemoveLastSigner);
    }
    let removed = wallet.signers.remove(pos);
    wallet.total_weight = wallet.total_weight.saturating_sub(removed.weight);
    // Auto-adjust threshold if it now exceeds total_weight
    if wallet.threshold > wallet.total_weight {
        wallet.threshold = wallet.total_weight;
    }
    Ok(removed)
}

pub fn update_threshold(
    wallet: &mut MultisigWallet,
    new_threshold: u32,
) -> Result<(), MultisigError> {
    if new_threshold == 0 || new_threshold > wallet.total_weight {
        return Err(MultisigError::InvalidThreshold);
    }
    wallet.threshold = new_threshold;
    Ok(())
}

pub fn is_signer(wallet: &MultisigWallet, address: &[u8; 32]) -> bool {
    wallet.signers.iter().any(|s| &s.address == address && s.is_active)
}

pub fn signer_weight(wallet: &MultisigWallet, address: &[u8; 32]) -> u32 {
    wallet
        .signers
        .iter()
        .find(|s| &s.address == address && s.is_active)
        .map(|s| s.weight)
        .unwrap_or(0)
}

pub fn signer_count(wallet: &MultisigWallet) -> usize {
    wallet.signers.iter().filter(|s| s.is_active).count()
}

pub fn active_signers(wallet: &MultisigWallet) -> Vec<&Signer> {
    wallet.signers.iter().filter(|s| s.is_active).collect()
}

// ============ Proposal Lifecycle ============

pub fn create_proposal(
    wallet: &mut MultisigWallet,
    proposer: [u8; 32],
    proposal_type: ProposalType,
    now: u64,
) -> Result<u64, MultisigError> {
    if !is_signer(wallet, &proposer) {
        return Err(MultisigError::NotASigner);
    }
    if wallet.proposals.len() >= MAX_PROPOSALS {
        return Err(MultisigError::WalletFull);
    }
    let id = next_proposal_id(wallet);
    wallet.nonce += 1;
    let proposal = MultisigProposal {
        proposal_id: id,
        proposer,
        proposal_type,
        status: MultisigStatus::Pending,
        created_at: now,
        expires_at: now.saturating_add(wallet.proposal_expiry_ms),
        approvals: Vec::new(),
        execution_delay_ms: wallet.execution_delay_ms,
        executed_at: None,
        nonce: wallet.nonce,
    };
    wallet.proposals.push(proposal);
    Ok(id)
}

pub fn approve(
    wallet: &mut MultisigWallet,
    proposal_id: u64,
    signer: [u8; 32],
    now: u64,
) -> Result<MultisigStatus, MultisigError> {
    if !is_signer(wallet, &signer) {
        return Err(MultisigError::NotASigner);
    }
    let proposal = wallet
        .proposals
        .iter_mut()
        .find(|p| p.proposal_id == proposal_id)
        .ok_or(MultisigError::ProposalNotFound)?;
    if proposal.status != MultisigStatus::Pending {
        return Err(MultisigError::ProposalNotPending);
    }
    if now >= proposal.expires_at {
        proposal.status = MultisigStatus::Expired;
        return Err(MultisigError::ProposalExpired);
    }
    if proposal.approvals.iter().any(|a| a.signer == signer) {
        return Err(MultisigError::AlreadyApproved);
    }
    wallet.nonce += 1;
    let nonce = wallet.nonce;
    let proposal = wallet
        .proposals
        .iter_mut()
        .find(|p| p.proposal_id == proposal_id)
        .unwrap();
    proposal.approvals.push(Approval {
        signer,
        approved: true,
        timestamp: now,
        nonce,
    });
    // Check if threshold is met
    let weight = compute_approval_weight_from_approvals(&wallet.signers, &proposal.approvals);
    if weight >= wallet.threshold {
        proposal.status = MultisigStatus::Approved;
    }
    Ok(proposal.status.clone())
}

/// Helper: compute approval weight from approvals + signers list
fn compute_approval_weight_from_approvals(signers: &[Signer], approvals: &[Approval]) -> u32 {
    let mut w: u32 = 0;
    for a in approvals {
        if a.approved {
            if let Some(s) = signers.iter().find(|s| s.address == a.signer && s.is_active) {
                w = w.saturating_add(s.weight);
            }
        }
    }
    w
}

fn compute_rejection_weight_from_approvals(signers: &[Signer], approvals: &[Approval]) -> u32 {
    let mut w: u32 = 0;
    for a in approvals {
        if !a.approved {
            if let Some(s) = signers.iter().find(|s| s.address == a.signer && s.is_active) {
                w = w.saturating_add(s.weight);
            }
        }
    }
    w
}

pub fn reject(
    wallet: &mut MultisigWallet,
    proposal_id: u64,
    signer: [u8; 32],
    now: u64,
) -> Result<MultisigStatus, MultisigError> {
    if !is_signer(wallet, &signer) {
        return Err(MultisigError::NotASigner);
    }
    let proposal = wallet
        .proposals
        .iter_mut()
        .find(|p| p.proposal_id == proposal_id)
        .ok_or(MultisigError::ProposalNotFound)?;
    if proposal.status != MultisigStatus::Pending {
        return Err(MultisigError::ProposalNotPending);
    }
    if now >= proposal.expires_at {
        proposal.status = MultisigStatus::Expired;
        return Err(MultisigError::ProposalExpired);
    }
    if proposal.approvals.iter().any(|a| a.signer == signer) {
        return Err(MultisigError::AlreadyApproved);
    }
    wallet.nonce += 1;
    let nonce = wallet.nonce;
    let total_weight = wallet.total_weight;
    let threshold = wallet.threshold;
    let proposal = wallet
        .proposals
        .iter_mut()
        .find(|p| p.proposal_id == proposal_id)
        .unwrap();
    proposal.approvals.push(Approval {
        signer,
        approved: false,
        timestamp: now,
        nonce,
    });
    // Check if definitively rejected (remaining weight can't meet threshold)
    let rej_weight = compute_rejection_weight_from_approvals(&wallet.signers, &proposal.approvals);
    let app_weight = compute_approval_weight_from_approvals(&wallet.signers, &proposal.approvals);
    let remaining = total_weight.saturating_sub(app_weight).saturating_sub(rej_weight);
    if app_weight.saturating_add(remaining) < threshold {
        proposal.status = MultisigStatus::Rejected;
    }
    Ok(proposal.status.clone())
}

pub fn cancel_proposal(
    wallet: &mut MultisigWallet,
    proposal_id: u64,
    canceller: &[u8; 32],
) -> Result<(), MultisigError> {
    let proposal = wallet
        .proposals
        .iter_mut()
        .find(|p| p.proposal_id == proposal_id)
        .ok_or(MultisigError::ProposalNotFound)?;
    if &proposal.proposer != canceller {
        return Err(MultisigError::NotASigner);
    }
    if proposal.status != MultisigStatus::Pending && proposal.status != MultisigStatus::Approved {
        return Err(MultisigError::ProposalNotPending);
    }
    proposal.status = MultisigStatus::Cancelled;
    Ok(())
}

pub fn execute_proposal(
    wallet: &mut MultisigWallet,
    proposal_id: u64,
    now: u64,
) -> Result<ProposalType, MultisigError> {
    let proposal = wallet
        .proposals
        .iter()
        .find(|p| p.proposal_id == proposal_id)
        .ok_or(MultisigError::ProposalNotFound)?;
    if proposal.status == MultisigStatus::Executed {
        return Err(MultisigError::AlreadyExecuted);
    }
    if proposal.status == MultisigStatus::Cancelled {
        return Err(MultisigError::Cancelled);
    }
    if proposal.status != MultisigStatus::Approved {
        return Err(MultisigError::ProposalNotApproved);
    }
    if now >= proposal.expires_at {
        // Mark expired — need mut
        let proposal = wallet
            .proposals
            .iter_mut()
            .find(|p| p.proposal_id == proposal_id)
            .unwrap();
        proposal.status = MultisigStatus::Expired;
        return Err(MultisigError::ProposalExpired);
    }
    // Find the last approval timestamp to calculate timelock from
    let last_approval_ts = proposal
        .approvals
        .iter()
        .filter(|a| a.approved)
        .map(|a| a.timestamp)
        .max()
        .unwrap_or(proposal.created_at);
    let timelock_end = last_approval_ts.saturating_add(proposal.execution_delay_ms);
    if now < timelock_end {
        return Err(MultisigError::TimelockActive);
    }
    let pt = proposal.proposal_type.clone();
    let proposal = wallet
        .proposals
        .iter_mut()
        .find(|p| p.proposal_id == proposal_id)
        .unwrap();
    proposal.status = MultisigStatus::Executed;
    proposal.executed_at = Some(now);
    Ok(pt)
}

pub fn get_proposal(wallet: &MultisigWallet, proposal_id: u64) -> Option<&MultisigProposal> {
    wallet.proposals.iter().find(|p| p.proposal_id == proposal_id)
}

// ============ Approval Analysis ============

pub fn approval_weight(wallet: &MultisigWallet, proposal_id: u64) -> u32 {
    wallet
        .proposals
        .iter()
        .find(|p| p.proposal_id == proposal_id)
        .map(|p| compute_approval_weight_from_approvals(&wallet.signers, &p.approvals))
        .unwrap_or(0)
}

pub fn rejection_weight(wallet: &MultisigWallet, proposal_id: u64) -> u32 {
    wallet
        .proposals
        .iter()
        .find(|p| p.proposal_id == proposal_id)
        .map(|p| compute_rejection_weight_from_approvals(&wallet.signers, &p.approvals))
        .unwrap_or(0)
}

pub fn remaining_weight_needed(wallet: &MultisigWallet, proposal_id: u64) -> u32 {
    let aw = approval_weight(wallet, proposal_id);
    wallet.threshold.saturating_sub(aw)
}

pub fn has_approved(wallet: &MultisigWallet, proposal_id: u64, signer: &[u8; 32]) -> bool {
    wallet
        .proposals
        .iter()
        .find(|p| p.proposal_id == proposal_id)
        .map(|p| p.approvals.iter().any(|a| &a.signer == signer && a.approved))
        .unwrap_or(false)
}

pub fn approval_percentage(wallet: &MultisigWallet, proposal_id: u64) -> u64 {
    if wallet.total_weight == 0 {
        return 0;
    }
    let aw = approval_weight(wallet, proposal_id) as u64;
    (aw * 10_000) / wallet.total_weight as u64
}

pub fn can_still_approve(wallet: &MultisigWallet, proposal_id: u64) -> bool {
    let proposal = match wallet.proposals.iter().find(|p| p.proposal_id == proposal_id) {
        Some(p) => p,
        None => return false,
    };
    if proposal.status != MultisigStatus::Pending {
        return false;
    }
    let aw = compute_approval_weight_from_approvals(&wallet.signers, &proposal.approvals);
    if aw >= wallet.threshold {
        return true; // already approved actually
    }
    // Sum weight of active signers who haven't voted yet
    let mut remaining_w: u32 = 0;
    for s in &wallet.signers {
        if s.is_active && !proposal.approvals.iter().any(|a| a.signer == s.address) {
            remaining_w = remaining_w.saturating_add(s.weight);
        }
    }
    aw.saturating_add(remaining_w) >= wallet.threshold
}

pub fn is_definitively_rejected(wallet: &MultisigWallet, proposal_id: u64) -> bool {
    !can_still_approve(wallet, proposal_id)
        && wallet
            .proposals
            .iter()
            .find(|p| p.proposal_id == proposal_id)
            .map(|p| p.status == MultisigStatus::Pending || p.status == MultisigStatus::Rejected)
            .unwrap_or(false)
}

// ============ Timelock ============

pub fn timelock_remaining_ms(proposal: &MultisigProposal, now: u64) -> u64 {
    let last_approval_ts = proposal
        .approvals
        .iter()
        .filter(|a| a.approved)
        .map(|a| a.timestamp)
        .max()
        .unwrap_or(proposal.created_at);
    let timelock_end = last_approval_ts.saturating_add(proposal.execution_delay_ms);
    timelock_end.saturating_sub(now)
}

pub fn is_timelock_elapsed(proposal: &MultisigProposal, now: u64) -> bool {
    timelock_remaining_ms(proposal, now) == 0
}

pub fn is_expired(proposal: &MultisigProposal, now: u64) -> bool {
    now >= proposal.expires_at
}

// ============ Daily Limits ============

pub fn check_daily_limit(wallet: &MultisigWallet, amount: u64, now: u64) -> bool {
    let spent = if now >= wallet.daily_reset_at.saturating_add(ONE_DAY_MS) {
        0
    } else {
        wallet.daily_spent
    };
    spent.saturating_add(amount) <= wallet.daily_limit
}

pub fn record_spend(wallet: &mut MultisigWallet, amount: u64, now: u64) {
    if now >= wallet.daily_reset_at.saturating_add(ONE_DAY_MS) {
        wallet.daily_spent = 0;
        wallet.daily_reset_at = now;
    }
    wallet.daily_spent = wallet.daily_spent.saturating_add(amount);
}

pub fn daily_remaining(wallet: &MultisigWallet, now: u64) -> u64 {
    let spent = if now >= wallet.daily_reset_at.saturating_add(ONE_DAY_MS) {
        0
    } else {
        wallet.daily_spent
    };
    wallet.daily_limit.saturating_sub(spent)
}

pub fn requires_multisig(wallet: &MultisigWallet, amount: u64, now: u64) -> bool {
    !check_daily_limit(wallet, amount, now)
}

// ============ Expiry & Cleanup ============

pub fn expire_proposals(wallet: &mut MultisigWallet, now: u64) -> usize {
    let mut count = 0;
    for p in &mut wallet.proposals {
        if p.status == MultisigStatus::Pending && now >= p.expires_at {
            p.status = MultisigStatus::Expired;
            count += 1;
        }
    }
    count
}

pub fn pending_proposals(wallet: &MultisigWallet, now: u64) -> Vec<&MultisigProposal> {
    wallet
        .proposals
        .iter()
        .filter(|p| p.status == MultisigStatus::Pending && now < p.expires_at)
        .collect()
}

pub fn active_proposals(wallet: &MultisigWallet, now: u64) -> Vec<&MultisigProposal> {
    wallet
        .proposals
        .iter()
        .filter(|p| {
            (p.status == MultisigStatus::Pending || p.status == MultisigStatus::Approved)
                && now < p.expires_at
        })
        .collect()
}

pub fn cleanup_executed(wallet: &mut MultisigWallet) -> usize {
    let before = wallet.proposals.len();
    wallet.proposals.retain(|p| p.status != MultisigStatus::Executed);
    before - wallet.proposals.len()
}

// ============ Analytics ============

pub fn compute_stats(wallet: &MultisigWallet) -> MultisigStats {
    let total = wallet.proposals.len() as u64;
    let mut approved = 0u64;
    let mut rejected = 0u64;
    let mut expired = 0u64;
    let mut executed = 0u64;
    let mut total_approval_time: u64 = 0;
    let mut approval_time_count: u64 = 0;
    let mut total_signers_count: u64 = 0;
    let mut signer_votes: Vec<([u8; 32], u64)> = Vec::new();

    for p in &wallet.proposals {
        match p.status {
            MultisigStatus::Approved => approved += 1,
            MultisigStatus::Rejected => rejected += 1,
            MultisigStatus::Expired => expired += 1,
            MultisigStatus::Executed => {
                executed += 1;
                // Also count as approved for stats
                approved += 1;
            }
            _ => {}
        }
        total_signers_count += p.approvals.len() as u64;
        // Approval time: last approval - created
        if p.status == MultisigStatus::Approved || p.status == MultisigStatus::Executed {
            let last_ts = p
                .approvals
                .iter()
                .filter(|a| a.approved)
                .map(|a| a.timestamp)
                .max()
                .unwrap_or(p.created_at);
            total_approval_time += last_ts.saturating_sub(p.created_at);
            approval_time_count += 1;
        }
        for a in &p.approvals {
            if let Some(entry) = signer_votes.iter_mut().find(|(addr, _)| *addr == a.signer) {
                entry.1 += 1;
            } else {
                signer_votes.push((a.signer, 1));
            }
        }
    }

    let most_active = signer_votes
        .iter()
        .max_by_key(|(_, count)| *count)
        .map(|(addr, _)| *addr);

    MultisigStats {
        total_proposals: total,
        approved_count: approved,
        rejected_count: rejected,
        expired_count: expired,
        executed_count: executed,
        avg_approval_time_ms: if approval_time_count > 0 {
            total_approval_time / approval_time_count
        } else {
            0
        },
        avg_signers_per_proposal: if total > 0 {
            total_signers_count / total
        } else {
            0
        },
        most_active_signer: most_active,
    }
}

pub fn signer_participation(wallet: &MultisigWallet, signer: &[u8; 32]) -> u64 {
    let total = wallet.proposals.len() as u64;
    if total == 0 {
        return 0;
    }
    let voted = wallet
        .proposals
        .iter()
        .filter(|p| p.approvals.iter().any(|a| &a.signer == signer))
        .count() as u64;
    (voted * 10_000) / total
}

pub fn avg_approval_time(wallet: &MultisigWallet) -> u64 {
    let mut total_time: u64 = 0;
    let mut count: u64 = 0;
    for p in &wallet.proposals {
        if p.status == MultisigStatus::Approved || p.status == MultisigStatus::Executed {
            let last_ts = p
                .approvals
                .iter()
                .filter(|a| a.approved)
                .map(|a| a.timestamp)
                .max()
                .unwrap_or(p.created_at);
            total_time += last_ts.saturating_sub(p.created_at);
            count += 1;
        }
    }
    if count == 0 { 0 } else { total_time / count }
}

pub fn proposal_success_rate(wallet: &MultisigWallet) -> u64 {
    let total = wallet.proposals.len() as u64;
    if total == 0 {
        return 0;
    }
    let executed = wallet
        .proposals
        .iter()
        .filter(|p| p.status == MultisigStatus::Executed)
        .count() as u64;
    (executed * 10_000) / total
}

// ============ Security ============

pub fn verify_nonce(wallet: &MultisigWallet, nonce: u64) -> bool {
    nonce > wallet.nonce
}

pub fn compute_proposal_hash(proposal: &MultisigProposal) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(proposal.proposal_id.to_le_bytes());
    hasher.update(proposal.proposer);
    hasher.update(proposal.created_at.to_le_bytes());
    hasher.update(proposal.expires_at.to_le_bytes());
    hasher.update(proposal.nonce.to_le_bytes());
    // Hash proposal type discriminant
    match &proposal.proposal_type {
        ProposalType::Transfer { to, amount, token } => {
            hasher.update([0u8]);
            hasher.update(to);
            hasher.update(amount.to_le_bytes());
            hasher.update(token);
        }
        ProposalType::ConfigChange { key, old_value, new_value } => {
            hasher.update([1u8]);
            hasher.update(key.to_le_bytes());
            hasher.update(old_value.to_le_bytes());
            hasher.update(new_value.to_le_bytes());
        }
        ProposalType::SignerAdd { signer, weight } => {
            hasher.update([2u8]);
            hasher.update(signer);
            hasher.update(weight.to_le_bytes());
        }
        ProposalType::SignerRemove { signer } => {
            hasher.update([3u8]);
            hasher.update(signer);
        }
        ProposalType::ThresholdChange { new_threshold } => {
            hasher.update([4u8]);
            hasher.update(new_threshold.to_le_bytes());
        }
        ProposalType::EmergencyAction { action_code, data } => {
            hasher.update([5u8]);
            hasher.update(action_code.to_le_bytes());
            hasher.update(data.to_le_bytes());
        }
        ProposalType::Custom { action_hash, description_hash } => {
            hasher.update([6u8]);
            hasher.update(action_hash);
            hasher.update(description_hash);
        }
    }
    let result = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&result);
    out
}

pub fn required_confirmations(wallet: &MultisigWallet) -> u32 {
    // Minimum number of signers needed (considering weights)
    // Sort active signers by weight descending, accumulate until threshold met
    let mut weights: Vec<u32> = wallet
        .signers
        .iter()
        .filter(|s| s.is_active)
        .map(|s| s.weight)
        .collect();
    weights.sort_unstable_by(|a, b| b.cmp(a)); // descending
    let mut acc: u32 = 0;
    let mut count: u32 = 0;
    for w in &weights {
        acc = acc.saturating_add(*w);
        count += 1;
        if acc >= wallet.threshold {
            return count;
        }
    }
    count
}

// ============ Utilities ============

pub fn format_proposal_summary(proposal: &MultisigProposal) -> (u32, u32, u32) {
    let approvals = proposal.approvals.iter().filter(|a| a.approved).count() as u32;
    let rejections = proposal.approvals.iter().filter(|a| !a.approved).count() as u32;
    // pending_signers is not knowable without wallet context, so we return total votes - split
    // Actually spec says (approvals, rejections, pending_signers) — but we don't have wallet here.
    // Return votes cast info: pending = 0 since we can't know total without wallet.
    // Re-reading spec: it says "pending_signers" — we'll compute from total votes absent.
    // Without wallet we can only return (approvals, rejections, 0). But let's keep it simple.
    (approvals, rejections, 0)
}

pub fn is_m_of_n(wallet: &MultisigWallet) -> (u32, u32) {
    // Returns (m, n) if all active signer weights are 1
    let active: Vec<&Signer> = wallet.signers.iter().filter(|s| s.is_active).collect();
    let all_weight_one = active.iter().all(|s| s.weight == 1);
    if all_weight_one {
        (wallet.threshold, active.len() as u32)
    } else {
        // Return threshold and total_weight for weighted case
        (wallet.threshold, wallet.total_weight)
    }
}

pub fn next_proposal_id(wallet: &MultisigWallet) -> u64 {
    wallet
        .proposals
        .iter()
        .map(|p| p.proposal_id)
        .max()
        .map(|id| id + 1)
        .unwrap_or(0)
}

pub fn proposals_by_status<'a>(
    wallet: &'a MultisigWallet,
    status: &MultisigStatus,
) -> Vec<&'a MultisigProposal> {
    wallet.proposals.iter().filter(|p| &p.status == status).collect()
}

pub fn total_value_pending(wallet: &MultisigWallet) -> u64 {
    let mut total: u64 = 0;
    for p in &wallet.proposals {
        if p.status == MultisigStatus::Pending {
            if let ProposalType::Transfer { amount, .. } = &p.proposal_type {
                total = total.saturating_add(*amount);
            }
        }
    }
    total
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // ---- Test Helpers ----

    fn addr(n: u8) -> [u8; 32] {
        let mut a = [0u8; 32];
        a[0] = n;
        a
    }

    fn make_signer(n: u8, weight: u32) -> Signer {
        Signer { address: addr(n), weight, added_at: 1000, is_active: true }
    }

    fn wallet_2of3() -> MultisigWallet {
        create_wallet(
            [1u8; 32],
            vec![make_signer(1, 1), make_signer(2, 1), make_signer(3, 1)],
            2,
            DEFAULT_EXPIRY_MS,
            DEFAULT_DELAY_MS,
            1_000_000,
        )
        .unwrap()
    }

    fn wallet_weighted() -> MultisigWallet {
        // Signer 1: weight 3, Signer 2: weight 2, Signer 3: weight 1. Threshold 4.
        create_wallet(
            [2u8; 32],
            vec![make_signer(1, 3), make_signer(2, 2), make_signer(3, 1)],
            4,
            DEFAULT_EXPIRY_MS,
            DEFAULT_DELAY_MS,
            500_000,
        )
        .unwrap()
    }

    fn wallet_1of1() -> MultisigWallet {
        create_wallet(
            [3u8; 32],
            vec![make_signer(1, 1)],
            1,
            DEFAULT_EXPIRY_MS,
            DEFAULT_DELAY_MS,
            100_000,
        )
        .unwrap()
    }

    fn transfer_type(amount: u64) -> ProposalType {
        ProposalType::Transfer { to: addr(99), amount, token: [0xAA; 32] }
    }

    // ============ Wallet Management Tests ============

    #[test]
    fn test_create_wallet_basic() {
        let w = wallet_2of3();
        assert_eq!(w.signers.len(), 3);
        assert_eq!(w.threshold, 2);
        assert_eq!(w.total_weight, 3);
        assert_eq!(w.nonce, 0);
    }

    #[test]
    fn test_create_wallet_weighted() {
        let w = wallet_weighted();
        assert_eq!(w.total_weight, 6);
        assert_eq!(w.threshold, 4);
    }

    #[test]
    fn test_create_wallet_1of1() {
        let w = wallet_1of1();
        assert_eq!(w.signers.len(), 1);
        assert_eq!(w.threshold, 1);
    }

    #[test]
    fn test_create_wallet_empty_signers() {
        let r = create_wallet([0u8; 32], vec![], 1, DEFAULT_EXPIRY_MS, DEFAULT_DELAY_MS, 0);
        assert_eq!(r, Err(MultisigError::InvalidThreshold));
    }

    #[test]
    fn test_create_wallet_threshold_zero() {
        let r = create_wallet(
            [0u8; 32],
            vec![make_signer(1, 1)],
            0,
            DEFAULT_EXPIRY_MS,
            DEFAULT_DELAY_MS,
            0,
        );
        assert_eq!(r, Err(MultisigError::InvalidThreshold));
    }

    #[test]
    fn test_create_wallet_threshold_exceeds_weight() {
        let r = create_wallet(
            [0u8; 32],
            vec![make_signer(1, 1), make_signer(2, 1)],
            5,
            DEFAULT_EXPIRY_MS,
            DEFAULT_DELAY_MS,
            0,
        );
        assert_eq!(r, Err(MultisigError::InvalidThreshold));
    }

    #[test]
    fn test_create_wallet_duplicate_signers() {
        let s1 = make_signer(1, 1);
        let s2 = make_signer(1, 2); // same address
        let r = create_wallet([0u8; 32], vec![s1, s2], 1, DEFAULT_EXPIRY_MS, DEFAULT_DELAY_MS, 0);
        assert_eq!(r, Err(MultisigError::DuplicateSigner));
    }

    #[test]
    fn test_create_wallet_zero_weight_signer() {
        let mut s = make_signer(1, 1);
        s.weight = 0;
        let r = create_wallet([0u8; 32], vec![s], 1, DEFAULT_EXPIRY_MS, DEFAULT_DELAY_MS, 0);
        assert_eq!(r, Err(MultisigError::InvalidWeight));
    }

    #[test]
    fn test_create_wallet_too_many_signers() {
        let signers: Vec<Signer> = (0..33).map(|i| make_signer(i as u8, 1)).collect();
        let r = create_wallet([0u8; 32], signers, 1, DEFAULT_EXPIRY_MS, DEFAULT_DELAY_MS, 0);
        assert_eq!(r, Err(MultisigError::WalletFull));
    }

    #[test]
    fn test_create_wallet_max_signers_ok() {
        let signers: Vec<Signer> = (0..32).map(|i| make_signer(i as u8, 1)).collect();
        let r = create_wallet([0u8; 32], signers, 16, DEFAULT_EXPIRY_MS, DEFAULT_DELAY_MS, 0);
        assert!(r.is_ok());
        assert_eq!(r.unwrap().total_weight, 32);
    }

    #[test]
    fn test_validate_wallet_ok() {
        let w = wallet_2of3();
        assert!(validate_wallet(&w).is_ok());
    }

    #[test]
    fn test_validate_wallet_no_active_signers() {
        let mut w = wallet_2of3();
        for s in &mut w.signers {
            s.is_active = false;
        }
        assert_eq!(validate_wallet(&w), Err(MultisigError::InvalidThreshold));
    }

    #[test]
    fn test_validate_wallet_threshold_exceeds_active_weight() {
        let mut w = wallet_2of3();
        w.threshold = 10;
        assert_eq!(validate_wallet(&w), Err(MultisigError::InvalidThreshold));
    }

    #[test]
    fn test_add_signer_ok() {
        let mut w = wallet_2of3();
        let r = add_signer(&mut w, make_signer(4, 2));
        assert!(r.is_ok());
        assert_eq!(w.signers.len(), 4);
        assert_eq!(w.total_weight, 5);
    }

    #[test]
    fn test_add_signer_duplicate() {
        let mut w = wallet_2of3();
        let r = add_signer(&mut w, make_signer(1, 1));
        assert_eq!(r, Err(MultisigError::DuplicateSigner));
    }

    #[test]
    fn test_add_signer_zero_weight() {
        let mut w = wallet_2of3();
        let r = add_signer(&mut w, make_signer(4, 0));
        assert_eq!(r, Err(MultisigError::InvalidWeight));
    }

    #[test]
    fn test_add_signer_wallet_full() {
        let signers: Vec<Signer> = (0..32).map(|i| make_signer(i as u8, 1)).collect();
        let mut w = create_wallet([0u8; 32], signers, 1, DEFAULT_EXPIRY_MS, DEFAULT_DELAY_MS, 0).unwrap();
        let r = add_signer(&mut w, make_signer(99, 1));
        assert_eq!(r, Err(MultisigError::WalletFull));
    }

    #[test]
    fn test_remove_signer_ok() {
        let mut w = wallet_2of3();
        let removed = remove_signer(&mut w, &addr(2)).unwrap();
        assert_eq!(removed.address, addr(2));
        assert_eq!(w.signers.len(), 2);
        assert_eq!(w.total_weight, 2);
        assert_eq!(w.threshold, 2); // still fits
    }

    #[test]
    fn test_remove_signer_threshold_auto_adjusts() {
        let mut w = wallet_2of3();
        // Remove two signers => threshold should auto-adjust
        remove_signer(&mut w, &addr(3)).unwrap();
        // Now 2 signers, weight 2, threshold 2 — fine
        remove_signer(&mut w, &addr(2)).unwrap();
        // Now 1 signer, weight 1, threshold was 2 => should auto-adjust to 1
        assert_eq!(w.threshold, 1);
        assert_eq!(w.total_weight, 1);
    }

    #[test]
    fn test_remove_last_signer_fails() {
        let mut w = wallet_1of1();
        let r = remove_signer(&mut w, &addr(1));
        assert_eq!(r, Err(MultisigError::CannotRemoveLastSigner));
    }

    #[test]
    fn test_remove_nonexistent_signer() {
        let mut w = wallet_2of3();
        let r = remove_signer(&mut w, &addr(99));
        assert_eq!(r, Err(MultisigError::SignerNotFound));
    }

    #[test]
    fn test_update_threshold_ok() {
        let mut w = wallet_2of3();
        assert!(update_threshold(&mut w, 3).is_ok());
        assert_eq!(w.threshold, 3);
    }

    #[test]
    fn test_update_threshold_zero() {
        let mut w = wallet_2of3();
        assert_eq!(update_threshold(&mut w, 0), Err(MultisigError::InvalidThreshold));
    }

    #[test]
    fn test_update_threshold_exceeds() {
        let mut w = wallet_2of3();
        assert_eq!(update_threshold(&mut w, 10), Err(MultisigError::InvalidThreshold));
    }

    #[test]
    fn test_is_signer_true() {
        let w = wallet_2of3();
        assert!(is_signer(&w, &addr(1)));
        assert!(is_signer(&w, &addr(2)));
        assert!(is_signer(&w, &addr(3)));
    }

    #[test]
    fn test_is_signer_false() {
        let w = wallet_2of3();
        assert!(!is_signer(&w, &addr(99)));
    }

    #[test]
    fn test_is_signer_inactive() {
        let mut w = wallet_2of3();
        w.signers[0].is_active = false;
        assert!(!is_signer(&w, &addr(1)));
    }

    #[test]
    fn test_signer_weight_found() {
        let w = wallet_weighted();
        assert_eq!(signer_weight(&w, &addr(1)), 3);
        assert_eq!(signer_weight(&w, &addr(2)), 2);
        assert_eq!(signer_weight(&w, &addr(3)), 1);
    }

    #[test]
    fn test_signer_weight_not_found() {
        let w = wallet_2of3();
        assert_eq!(signer_weight(&w, &addr(99)), 0);
    }

    #[test]
    fn test_signer_count() {
        let w = wallet_2of3();
        assert_eq!(signer_count(&w), 3);
    }

    #[test]
    fn test_signer_count_with_inactive() {
        let mut w = wallet_2of3();
        w.signers[0].is_active = false;
        assert_eq!(signer_count(&w), 2);
    }

    #[test]
    fn test_active_signers() {
        let mut w = wallet_2of3();
        w.signers[1].is_active = false;
        let active = active_signers(&w);
        assert_eq!(active.len(), 2);
    }

    // ============ Proposal Lifecycle Tests ============

    #[test]
    fn test_create_proposal_basic() {
        let mut w = wallet_2of3();
        let id = create_proposal(&mut w, addr(1), transfer_type(1000), 5000).unwrap();
        assert_eq!(id, 0);
        assert_eq!(w.proposals.len(), 1);
        assert_eq!(w.proposals[0].status, MultisigStatus::Pending);
        assert_eq!(w.proposals[0].proposer, addr(1));
        assert_eq!(w.nonce, 1);
    }

    #[test]
    fn test_create_proposal_non_signer() {
        let mut w = wallet_2of3();
        let r = create_proposal(&mut w, addr(99), transfer_type(1000), 5000);
        assert_eq!(r, Err(MultisigError::NotASigner));
    }

    #[test]
    fn test_create_proposal_increments_id() {
        let mut w = wallet_2of3();
        let id0 = create_proposal(&mut w, addr(1), transfer_type(100), 5000).unwrap();
        let id1 = create_proposal(&mut w, addr(2), transfer_type(200), 5000).unwrap();
        assert_eq!(id0, 0);
        assert_eq!(id1, 1);
    }

    #[test]
    fn test_create_proposal_sets_expiry() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 5000).unwrap();
        assert_eq!(w.proposals[0].expires_at, 5000 + DEFAULT_EXPIRY_MS);
    }

    #[test]
    fn test_approve_basic() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        let status = approve(&mut w, 0, addr(1), 2000).unwrap();
        assert_eq!(status, MultisigStatus::Pending); // 1 of 2 needed
    }

    #[test]
    fn test_approve_reaches_threshold() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        approve(&mut w, 0, addr(1), 2000).unwrap();
        let status = approve(&mut w, 0, addr(2), 3000).unwrap();
        assert_eq!(status, MultisigStatus::Approved);
    }

    #[test]
    fn test_approve_non_signer() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        let r = approve(&mut w, 0, addr(99), 2000);
        assert_eq!(r, Err(MultisigError::NotASigner));
    }

    #[test]
    fn test_approve_duplicate() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        approve(&mut w, 0, addr(1), 2000).unwrap();
        let r = approve(&mut w, 0, addr(1), 3000);
        assert_eq!(r, Err(MultisigError::AlreadyApproved));
    }

    #[test]
    fn test_approve_expired_proposal() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        let r = approve(&mut w, 0, addr(1), 1000 + DEFAULT_EXPIRY_MS + 1);
        assert_eq!(r, Err(MultisigError::ProposalExpired));
        assert_eq!(w.proposals[0].status, MultisigStatus::Expired);
    }

    #[test]
    fn test_approve_not_pending() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        approve(&mut w, 0, addr(1), 2000).unwrap();
        approve(&mut w, 0, addr(2), 3000).unwrap(); // now Approved
        let r = approve(&mut w, 0, addr(3), 4000);
        assert_eq!(r, Err(MultisigError::ProposalNotPending));
    }

    #[test]
    fn test_approve_proposal_not_found() {
        let mut w = wallet_2of3();
        let r = approve(&mut w, 999, addr(1), 2000);
        assert_eq!(r, Err(MultisigError::ProposalNotFound));
    }

    #[test]
    fn test_approve_weighted_threshold() {
        let mut w = wallet_weighted(); // threshold 4, weights: 3,2,1
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        let s = approve(&mut w, 0, addr(1), 2000).unwrap(); // weight 3
        assert_eq!(s, MultisigStatus::Pending);
        let s = approve(&mut w, 0, addr(3), 3000).unwrap(); // weight 1 => total 4
        assert_eq!(s, MultisigStatus::Approved);
    }

    #[test]
    fn test_reject_basic() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        let status = reject(&mut w, 0, addr(1), 2000).unwrap();
        assert_eq!(status, MultisigStatus::Pending); // 1 reject, 2 can still approve
    }

    #[test]
    fn test_reject_definitive() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        reject(&mut w, 0, addr(1), 2000).unwrap();
        let status = reject(&mut w, 0, addr(2), 3000).unwrap();
        // 2 rejects, only 1 weight left, need 2 => definitively rejected
        assert_eq!(status, MultisigStatus::Rejected);
    }

    #[test]
    fn test_reject_non_signer() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        let r = reject(&mut w, 0, addr(99), 2000);
        assert_eq!(r, Err(MultisigError::NotASigner));
    }

    #[test]
    fn test_reject_already_voted() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        approve(&mut w, 0, addr(1), 2000).unwrap();
        let r = reject(&mut w, 0, addr(1), 3000);
        assert_eq!(r, Err(MultisigError::AlreadyApproved));
    }

    #[test]
    fn test_reject_expired() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        let r = reject(&mut w, 0, addr(1), 1000 + DEFAULT_EXPIRY_MS + 1);
        assert_eq!(r, Err(MultisigError::ProposalExpired));
    }

    #[test]
    fn test_cancel_proposal_by_proposer() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        assert!(cancel_proposal(&mut w, 0, &addr(1)).is_ok());
        assert_eq!(w.proposals[0].status, MultisigStatus::Cancelled);
    }

    #[test]
    fn test_cancel_proposal_by_non_proposer() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        let r = cancel_proposal(&mut w, 0, &addr(2));
        assert_eq!(r, Err(MultisigError::NotASigner));
    }

    #[test]
    fn test_cancel_approved_proposal() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        approve(&mut w, 0, addr(1), 2000).unwrap();
        approve(&mut w, 0, addr(2), 3000).unwrap();
        // Can cancel even after approved (before execution)
        assert!(cancel_proposal(&mut w, 0, &addr(1)).is_ok());
    }

    #[test]
    fn test_cancel_not_found() {
        let mut w = wallet_2of3();
        let r = cancel_proposal(&mut w, 999, &addr(1));
        assert_eq!(r, Err(MultisigError::ProposalNotFound));
    }

    #[test]
    fn test_execute_proposal_ok() {
        let mut w = wallet_2of3();
        let now = 1000;
        create_proposal(&mut w, addr(1), transfer_type(500), now).unwrap();
        approve(&mut w, 0, addr(1), now + 100).unwrap();
        approve(&mut w, 0, addr(2), now + 200).unwrap();
        // Execute after timelock
        let exec_time = now + 200 + DEFAULT_DELAY_MS + 1;
        let pt = execute_proposal(&mut w, 0, exec_time).unwrap();
        assert!(matches!(pt, ProposalType::Transfer { amount: 500, .. }));
        assert_eq!(w.proposals[0].status, MultisigStatus::Executed);
        assert_eq!(w.proposals[0].executed_at, Some(exec_time));
    }

    #[test]
    fn test_execute_proposal_timelock_active() {
        let mut w = wallet_2of3();
        let now = 1000;
        create_proposal(&mut w, addr(1), transfer_type(500), now).unwrap();
        approve(&mut w, 0, addr(1), now + 100).unwrap();
        approve(&mut w, 0, addr(2), now + 200).unwrap();
        // Try to execute before timelock
        let r = execute_proposal(&mut w, 0, now + 200 + 1000);
        assert_eq!(r, Err(MultisigError::TimelockActive));
    }

    #[test]
    fn test_execute_proposal_not_approved() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(500), 1000).unwrap();
        approve(&mut w, 0, addr(1), 2000).unwrap(); // only 1 of 2
        let r = execute_proposal(&mut w, 0, 2000 + DEFAULT_DELAY_MS + 1);
        assert_eq!(r, Err(MultisigError::ProposalNotApproved));
    }

    #[test]
    fn test_execute_proposal_already_executed() {
        let mut w = wallet_2of3();
        let now = 1000;
        create_proposal(&mut w, addr(1), transfer_type(500), now).unwrap();
        approve(&mut w, 0, addr(1), now + 100).unwrap();
        approve(&mut w, 0, addr(2), now + 200).unwrap();
        let exec_time = now + 200 + DEFAULT_DELAY_MS + 1;
        execute_proposal(&mut w, 0, exec_time).unwrap();
        let r = execute_proposal(&mut w, 0, exec_time + 1);
        assert_eq!(r, Err(MultisigError::AlreadyExecuted));
    }

    #[test]
    fn test_execute_cancelled_proposal() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(500), 1000).unwrap();
        cancel_proposal(&mut w, 0, &addr(1)).unwrap();
        let r = execute_proposal(&mut w, 0, 999_999_999);
        assert_eq!(r, Err(MultisigError::Cancelled));
    }

    #[test]
    fn test_execute_expired_proposal() {
        let mut w = wallet_2of3();
        let now = 1000;
        create_proposal(&mut w, addr(1), transfer_type(500), now).unwrap();
        approve(&mut w, 0, addr(1), now + 100).unwrap();
        approve(&mut w, 0, addr(2), now + 200).unwrap();
        // Execute after expiry
        let r = execute_proposal(&mut w, 0, now + DEFAULT_EXPIRY_MS + 1);
        assert_eq!(r, Err(MultisigError::ProposalExpired));
    }

    #[test]
    fn test_get_proposal_found() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        let p = get_proposal(&w, 0);
        assert!(p.is_some());
        assert_eq!(p.unwrap().proposal_id, 0);
    }

    #[test]
    fn test_get_proposal_not_found() {
        let w = wallet_2of3();
        assert!(get_proposal(&w, 999).is_none());
    }

    // ============ Approval Analysis Tests ============

    #[test]
    fn test_approval_weight_none() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        assert_eq!(approval_weight(&w, 0), 0);
    }

    #[test]
    fn test_approval_weight_partial() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        approve(&mut w, 0, addr(1), 2000).unwrap();
        assert_eq!(approval_weight(&w, 0), 1);
    }

    #[test]
    fn test_approval_weight_weighted() {
        let mut w = wallet_weighted();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        approve(&mut w, 0, addr(1), 2000).unwrap(); // weight 3
        assert_eq!(approval_weight(&w, 0), 3);
    }

    #[test]
    fn test_rejection_weight() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        reject(&mut w, 0, addr(1), 2000).unwrap();
        assert_eq!(rejection_weight(&w, 0), 1);
    }

    #[test]
    fn test_rejection_weight_weighted() {
        let mut w = wallet_weighted();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        reject(&mut w, 0, addr(1), 2000).unwrap();
        assert_eq!(rejection_weight(&w, 0), 3);
    }

    #[test]
    fn test_remaining_weight_needed() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        assert_eq!(remaining_weight_needed(&w, 0), 2);
        approve(&mut w, 0, addr(1), 2000).unwrap();
        assert_eq!(remaining_weight_needed(&w, 0), 1);
    }

    #[test]
    fn test_remaining_weight_needed_after_full_approval() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        approve(&mut w, 0, addr(1), 2000).unwrap();
        approve(&mut w, 0, addr(2), 3000).unwrap();
        assert_eq!(remaining_weight_needed(&w, 0), 0);
    }

    #[test]
    fn test_has_approved_true() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        approve(&mut w, 0, addr(1), 2000).unwrap();
        assert!(has_approved(&w, 0, &addr(1)));
    }

    #[test]
    fn test_has_approved_false_not_voted() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        assert!(!has_approved(&w, 0, &addr(1)));
    }

    #[test]
    fn test_has_approved_false_rejected() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        reject(&mut w, 0, addr(1), 2000).unwrap();
        assert!(!has_approved(&w, 0, &addr(1)));
    }

    #[test]
    fn test_approval_percentage_zero() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        assert_eq!(approval_percentage(&w, 0), 0);
    }

    #[test]
    fn test_approval_percentage_partial() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        approve(&mut w, 0, addr(1), 2000).unwrap();
        assert_eq!(approval_percentage(&w, 0), 3333); // 1/3 * 10000
    }

    #[test]
    fn test_approval_percentage_full() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        approve(&mut w, 0, addr(1), 2000).unwrap();
        approve(&mut w, 0, addr(2), 3000).unwrap();
        // Only 2 approved out of 3 total weight
        assert_eq!(approval_percentage(&w, 0), 6666);
    }

    #[test]
    fn test_approval_percentage_all() {
        let mut w = wallet_2of3();
        w.threshold = 3; // require all
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        approve(&mut w, 0, addr(1), 2000).unwrap();
        approve(&mut w, 0, addr(2), 3000).unwrap();
        approve(&mut w, 0, addr(3), 4000).unwrap();
        assert_eq!(approval_percentage(&w, 0), 10000);
    }

    #[test]
    fn test_can_still_approve_yes() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        reject(&mut w, 0, addr(1), 2000).unwrap();
        assert!(can_still_approve(&w, 0)); // 2 remaining can still hit threshold 2
    }

    #[test]
    fn test_can_still_approve_no() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        reject(&mut w, 0, addr(1), 2000).unwrap();
        reject(&mut w, 0, addr(2), 3000).unwrap();
        assert!(!can_still_approve(&w, 0));
    }

    #[test]
    fn test_can_still_approve_nonexistent() {
        let w = wallet_2of3();
        assert!(!can_still_approve(&w, 999));
    }

    #[test]
    fn test_is_definitively_rejected_true() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        reject(&mut w, 0, addr(1), 2000).unwrap();
        reject(&mut w, 0, addr(2), 3000).unwrap();
        assert!(is_definitively_rejected(&w, 0));
    }

    #[test]
    fn test_is_definitively_rejected_false() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        reject(&mut w, 0, addr(1), 2000).unwrap();
        assert!(!is_definitively_rejected(&w, 0));
    }

    // ============ Timelock Tests ============

    #[test]
    fn test_timelock_remaining_no_approvals() {
        let p = MultisigProposal {
            proposal_id: 0,
            proposer: addr(1),
            proposal_type: transfer_type(100),
            status: MultisigStatus::Pending,
            created_at: 1000,
            expires_at: 1000 + DEFAULT_EXPIRY_MS,
            approvals: vec![],
            execution_delay_ms: DEFAULT_DELAY_MS,
            executed_at: None,
            nonce: 1,
        };
        // With no approvals, uses created_at. Timelock end = 1000 + DEFAULT_DELAY_MS
        assert_eq!(timelock_remaining_ms(&p, 1000), DEFAULT_DELAY_MS);
    }

    #[test]
    fn test_timelock_remaining_with_approval() {
        let p = MultisigProposal {
            proposal_id: 0,
            proposer: addr(1),
            proposal_type: transfer_type(100),
            status: MultisigStatus::Approved,
            created_at: 1000,
            expires_at: 1000 + DEFAULT_EXPIRY_MS,
            approvals: vec![Approval { signer: addr(1), approved: true, timestamp: 5000, nonce: 1 }],
            execution_delay_ms: DEFAULT_DELAY_MS,
            executed_at: None,
            nonce: 1,
        };
        // Timelock end = 5000 + DEFAULT_DELAY_MS
        assert_eq!(timelock_remaining_ms(&p, 5000), DEFAULT_DELAY_MS);
        assert_eq!(timelock_remaining_ms(&p, 5000 + DEFAULT_DELAY_MS), 0);
    }

    #[test]
    fn test_is_timelock_elapsed_false() {
        let p = MultisigProposal {
            proposal_id: 0,
            proposer: addr(1),
            proposal_type: transfer_type(100),
            status: MultisigStatus::Approved,
            created_at: 1000,
            expires_at: 1000 + DEFAULT_EXPIRY_MS,
            approvals: vec![Approval { signer: addr(1), approved: true, timestamp: 5000, nonce: 1 }],
            execution_delay_ms: 10000,
            executed_at: None,
            nonce: 1,
        };
        assert!(!is_timelock_elapsed(&p, 5001));
    }

    #[test]
    fn test_is_timelock_elapsed_true() {
        let p = MultisigProposal {
            proposal_id: 0,
            proposer: addr(1),
            proposal_type: transfer_type(100),
            status: MultisigStatus::Approved,
            created_at: 1000,
            expires_at: 1000 + DEFAULT_EXPIRY_MS,
            approvals: vec![Approval { signer: addr(1), approved: true, timestamp: 5000, nonce: 1 }],
            execution_delay_ms: 10000,
            executed_at: None,
            nonce: 1,
        };
        assert!(is_timelock_elapsed(&p, 15000));
    }

    #[test]
    fn test_is_expired_false() {
        let p = MultisigProposal {
            proposal_id: 0, proposer: addr(1), proposal_type: transfer_type(100),
            status: MultisigStatus::Pending, created_at: 1000,
            expires_at: 100_000, approvals: vec![],
            execution_delay_ms: 0, executed_at: None, nonce: 1,
        };
        assert!(!is_expired(&p, 50_000));
    }

    #[test]
    fn test_is_expired_true() {
        let p = MultisigProposal {
            proposal_id: 0, proposer: addr(1), proposal_type: transfer_type(100),
            status: MultisigStatus::Pending, created_at: 1000,
            expires_at: 100_000, approvals: vec![],
            execution_delay_ms: 0, executed_at: None, nonce: 1,
        };
        assert!(is_expired(&p, 100_001));
    }

    #[test]
    fn test_is_expired_exact_boundary() {
        let p = MultisigProposal {
            proposal_id: 0, proposer: addr(1), proposal_type: transfer_type(100),
            status: MultisigStatus::Pending, created_at: 1000,
            expires_at: 100_000, approvals: vec![],
            execution_delay_ms: 0, executed_at: None, nonce: 1,
        };
        assert!(is_expired(&p, 100_000)); // >= boundary
    }

    // ============ Daily Limit Tests ============

    #[test]
    fn test_check_daily_limit_within() {
        let w = wallet_2of3(); // daily_limit = 1_000_000
        assert!(check_daily_limit(&w, 500_000, 1000));
    }

    #[test]
    fn test_check_daily_limit_exact() {
        let w = wallet_2of3();
        assert!(check_daily_limit(&w, 1_000_000, 1000));
    }

    #[test]
    fn test_check_daily_limit_exceeded() {
        let mut w = wallet_2of3();
        w.daily_spent = 600_000;
        w.daily_reset_at = 1000;
        assert!(!check_daily_limit(&w, 500_000, 1000 + ONE_DAY_MS - 1));
    }

    #[test]
    fn test_check_daily_limit_resets_after_day() {
        let mut w = wallet_2of3();
        w.daily_spent = 999_999;
        w.daily_reset_at = 1000;
        // After one day, spent resets
        assert!(check_daily_limit(&w, 500_000, 1000 + ONE_DAY_MS));
    }

    #[test]
    fn test_record_spend() {
        let mut w = wallet_2of3();
        record_spend(&mut w, 100, 1000);
        assert_eq!(w.daily_spent, 100);
        record_spend(&mut w, 200, 1000 + 500);
        assert_eq!(w.daily_spent, 300);
    }

    #[test]
    fn test_record_spend_resets() {
        let mut w = wallet_2of3();
        record_spend(&mut w, 100, 1000);
        assert_eq!(w.daily_spent, 100);
        record_spend(&mut w, 50, 1000 + ONE_DAY_MS);
        assert_eq!(w.daily_spent, 50); // reset then added
    }

    #[test]
    fn test_daily_remaining_full() {
        let w = wallet_2of3();
        assert_eq!(daily_remaining(&w, 1000), 1_000_000);
    }

    #[test]
    fn test_daily_remaining_partial() {
        let mut w = wallet_2of3();
        w.daily_spent = 400_000;
        w.daily_reset_at = 1000;
        assert_eq!(daily_remaining(&w, 1000 + 100), 600_000);
    }

    #[test]
    fn test_daily_remaining_resets() {
        let mut w = wallet_2of3();
        w.daily_spent = 999_999;
        w.daily_reset_at = 1000;
        assert_eq!(daily_remaining(&w, 1000 + ONE_DAY_MS), 1_000_000);
    }

    #[test]
    fn test_requires_multisig_below_limit() {
        let w = wallet_2of3();
        assert!(!requires_multisig(&w, 500_000, 1000));
    }

    #[test]
    fn test_requires_multisig_above_limit() {
        let w = wallet_2of3();
        assert!(requires_multisig(&w, 2_000_000, 1000));
    }

    // ============ Expiry & Cleanup Tests ============

    #[test]
    fn test_expire_proposals_none() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        assert_eq!(expire_proposals(&mut w, 2000), 0);
    }

    #[test]
    fn test_expire_proposals_one() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        let count = expire_proposals(&mut w, 1000 + DEFAULT_EXPIRY_MS);
        assert_eq!(count, 1);
        assert_eq!(w.proposals[0].status, MultisigStatus::Expired);
    }

    #[test]
    fn test_expire_proposals_multiple() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        create_proposal(&mut w, addr(2), transfer_type(200), 2000).unwrap();
        let count = expire_proposals(&mut w, 2000 + DEFAULT_EXPIRY_MS);
        assert_eq!(count, 2);
    }

    #[test]
    fn test_expire_skips_non_pending() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        cancel_proposal(&mut w, 0, &addr(1)).unwrap();
        let count = expire_proposals(&mut w, 1000 + DEFAULT_EXPIRY_MS);
        assert_eq!(count, 0); // already cancelled
    }

    #[test]
    fn test_pending_proposals() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        create_proposal(&mut w, addr(2), transfer_type(200), 2000).unwrap();
        cancel_proposal(&mut w, 0, &addr(1)).unwrap();
        let pending = pending_proposals(&w, 3000);
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].proposal_id, 1);
    }

    #[test]
    fn test_pending_proposals_excludes_expired() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        let pending = pending_proposals(&w, 1000 + DEFAULT_EXPIRY_MS + 1);
        assert_eq!(pending.len(), 0);
    }

    #[test]
    fn test_active_proposals_includes_approved() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        approve(&mut w, 0, addr(1), 2000).unwrap();
        approve(&mut w, 0, addr(2), 3000).unwrap();
        let active = active_proposals(&w, 4000);
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].status, MultisigStatus::Approved);
    }

    #[test]
    fn test_active_proposals_excludes_executed() {
        let mut w = wallet_2of3();
        w.execution_delay_ms = 0; // no timelock for this test
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        approve(&mut w, 0, addr(1), 2000).unwrap();
        approve(&mut w, 0, addr(2), 3000).unwrap();
        execute_proposal(&mut w, 0, 3001).unwrap();
        let active = active_proposals(&w, 4000);
        assert_eq!(active.len(), 0);
    }

    #[test]
    fn test_cleanup_executed() {
        let mut w = wallet_2of3();
        w.execution_delay_ms = 0;
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        create_proposal(&mut w, addr(2), transfer_type(200), 1000).unwrap();
        approve(&mut w, 0, addr(1), 2000).unwrap();
        approve(&mut w, 0, addr(2), 3000).unwrap();
        execute_proposal(&mut w, 0, 3001).unwrap();
        let removed = cleanup_executed(&mut w);
        assert_eq!(removed, 1);
        assert_eq!(w.proposals.len(), 1);
        assert_eq!(w.proposals[0].proposal_id, 1);
    }

    #[test]
    fn test_cleanup_executed_none() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        let removed = cleanup_executed(&mut w);
        assert_eq!(removed, 0);
    }

    // ============ Analytics Tests ============

    #[test]
    fn test_compute_stats_empty() {
        let w = wallet_2of3();
        let stats = compute_stats(&w);
        assert_eq!(stats.total_proposals, 0);
        assert_eq!(stats.executed_count, 0);
        assert!(stats.most_active_signer.is_none());
    }

    #[test]
    fn test_compute_stats_with_data() {
        let mut w = wallet_2of3();
        w.execution_delay_ms = 0;
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        approve(&mut w, 0, addr(1), 2000).unwrap();
        approve(&mut w, 0, addr(2), 3000).unwrap();
        execute_proposal(&mut w, 0, 3001).unwrap();
        let stats = compute_stats(&w);
        assert_eq!(stats.total_proposals, 1);
        assert_eq!(stats.executed_count, 1);
        assert_eq!(stats.approved_count, 1); // executed counts as approved
        assert_eq!(stats.avg_approval_time_ms, 2000); // 3000 - 1000
    }

    #[test]
    fn test_compute_stats_most_active() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        create_proposal(&mut w, addr(2), transfer_type(200), 1000).unwrap();
        approve(&mut w, 0, addr(1), 2000).unwrap();
        approve(&mut w, 1, addr(1), 2000).unwrap();
        approve(&mut w, 1, addr(2), 3000).unwrap();
        let stats = compute_stats(&w);
        assert_eq!(stats.most_active_signer, Some(addr(1))); // voted on 2 proposals
    }

    #[test]
    fn test_signer_participation_full() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        create_proposal(&mut w, addr(2), transfer_type(200), 1000).unwrap();
        approve(&mut w, 0, addr(1), 2000).unwrap();
        approve(&mut w, 1, addr(1), 2000).unwrap();
        assert_eq!(signer_participation(&w, &addr(1)), 10_000); // 2/2
    }

    #[test]
    fn test_signer_participation_partial() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        create_proposal(&mut w, addr(2), transfer_type(200), 1000).unwrap();
        approve(&mut w, 0, addr(1), 2000).unwrap();
        assert_eq!(signer_participation(&w, &addr(1)), 5000); // 1/2
    }

    #[test]
    fn test_signer_participation_zero() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        assert_eq!(signer_participation(&w, &addr(2)), 0);
    }

    #[test]
    fn test_signer_participation_empty() {
        let w = wallet_2of3();
        assert_eq!(signer_participation(&w, &addr(1)), 0);
    }

    #[test]
    fn test_avg_approval_time_basic() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        approve(&mut w, 0, addr(1), 2000).unwrap();
        approve(&mut w, 0, addr(2), 4000).unwrap(); // approved at 4000, created 1000
        assert_eq!(avg_approval_time(&w), 3000);
    }

    #[test]
    fn test_avg_approval_time_empty() {
        let w = wallet_2of3();
        assert_eq!(avg_approval_time(&w), 0);
    }

    #[test]
    fn test_proposal_success_rate_none() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        assert_eq!(proposal_success_rate(&w), 0);
    }

    #[test]
    fn test_proposal_success_rate_half() {
        let mut w = wallet_2of3();
        w.execution_delay_ms = 0;
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        create_proposal(&mut w, addr(2), transfer_type(200), 1000).unwrap();
        approve(&mut w, 0, addr(1), 2000).unwrap();
        approve(&mut w, 0, addr(2), 3000).unwrap();
        execute_proposal(&mut w, 0, 3001).unwrap();
        assert_eq!(proposal_success_rate(&w), 5000); // 1/2
    }

    #[test]
    fn test_proposal_success_rate_empty() {
        let w = wallet_2of3();
        assert_eq!(proposal_success_rate(&w), 0);
    }

    // ============ Security Tests ============

    #[test]
    fn test_verify_nonce_valid() {
        let w = wallet_2of3();
        assert!(verify_nonce(&w, 1)); // 1 > 0
    }

    #[test]
    fn test_verify_nonce_equal() {
        let w = wallet_2of3();
        assert!(!verify_nonce(&w, 0)); // 0 is not > 0
    }

    #[test]
    fn test_verify_nonce_old() {
        let mut w = wallet_2of3();
        w.nonce = 10;
        assert!(!verify_nonce(&w, 5));
    }

    #[test]
    fn test_verify_nonce_after_proposal() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        assert_eq!(w.nonce, 1);
        assert!(verify_nonce(&w, 2));
        assert!(!verify_nonce(&w, 1));
    }

    #[test]
    fn test_compute_proposal_hash_deterministic() {
        let p = MultisigProposal {
            proposal_id: 42, proposer: addr(1), proposal_type: transfer_type(1000),
            status: MultisigStatus::Pending, created_at: 5000,
            expires_at: 5000 + DEFAULT_EXPIRY_MS, approvals: vec![],
            execution_delay_ms: DEFAULT_DELAY_MS, executed_at: None, nonce: 1,
        };
        let h1 = compute_proposal_hash(&p);
        let h2 = compute_proposal_hash(&p);
        assert_eq!(h1, h2);
    }

    #[test]
    fn test_compute_proposal_hash_different_types() {
        let p1 = MultisigProposal {
            proposal_id: 0, proposer: addr(1), proposal_type: transfer_type(100),
            status: MultisigStatus::Pending, created_at: 1000,
            expires_at: 2000, approvals: vec![],
            execution_delay_ms: 0, executed_at: None, nonce: 1,
        };
        let p2 = MultisigProposal {
            proposal_type: ProposalType::ConfigChange { key: 1, old_value: 0, new_value: 10 },
            ..p1.clone()
        };
        assert_ne!(compute_proposal_hash(&p1), compute_proposal_hash(&p2));
    }

    #[test]
    fn test_compute_proposal_hash_different_nonces() {
        let p1 = MultisigProposal {
            proposal_id: 0, proposer: addr(1), proposal_type: transfer_type(100),
            status: MultisigStatus::Pending, created_at: 1000,
            expires_at: 2000, approvals: vec![],
            execution_delay_ms: 0, executed_at: None, nonce: 1,
        };
        let mut p2 = p1.clone();
        p2.nonce = 2;
        assert_ne!(compute_proposal_hash(&p1), compute_proposal_hash(&p2));
    }

    #[test]
    fn test_compute_hash_all_proposal_types() {
        let types = vec![
            ProposalType::Transfer { to: addr(1), amount: 100, token: [0; 32] },
            ProposalType::ConfigChange { key: 1, old_value: 0, new_value: 10 },
            ProposalType::SignerAdd { signer: addr(5), weight: 2 },
            ProposalType::SignerRemove { signer: addr(3) },
            ProposalType::ThresholdChange { new_threshold: 3 },
            ProposalType::EmergencyAction { action_code: 1, data: 42 },
            ProposalType::Custom { action_hash: [0xAA; 32], description_hash: [0xBB; 32] },
        ];
        let mut hashes = Vec::new();
        for pt in types {
            let p = MultisigProposal {
                proposal_id: 0, proposer: addr(1), proposal_type: pt,
                status: MultisigStatus::Pending, created_at: 1000,
                expires_at: 2000, approvals: vec![],
                execution_delay_ms: 0, executed_at: None, nonce: 1,
            };
            hashes.push(compute_proposal_hash(&p));
        }
        // All hashes should be unique
        for i in 0..hashes.len() {
            for j in (i+1)..hashes.len() {
                assert_ne!(hashes[i], hashes[j], "hash collision at i={}, j={}", i, j);
            }
        }
    }

    #[test]
    fn test_required_confirmations_uniform() {
        let w = wallet_2of3(); // threshold 2, all weight 1
        assert_eq!(required_confirmations(&w), 2);
    }

    #[test]
    fn test_required_confirmations_weighted() {
        let w = wallet_weighted(); // threshold 4, weights 3,2,1
        // Heaviest signer (3) + next (2) = 5 >= 4 => 2 needed
        assert_eq!(required_confirmations(&w), 2);
    }

    #[test]
    fn test_required_confirmations_all_needed() {
        let mut w = wallet_2of3();
        w.threshold = 3;
        assert_eq!(required_confirmations(&w), 3);
    }

    #[test]
    fn test_required_confirmations_one_heavy() {
        // Single signer with weight 5, threshold 3
        let w = create_wallet(
            [0u8; 32],
            vec![make_signer(1, 5), make_signer(2, 1)],
            3,
            DEFAULT_EXPIRY_MS,
            DEFAULT_DELAY_MS,
            0,
        )
        .unwrap();
        assert_eq!(required_confirmations(&w), 1); // signer 1 alone meets it
    }

    // ============ Utility Tests ============

    #[test]
    fn test_format_proposal_summary_no_votes() {
        let p = MultisigProposal {
            proposal_id: 0, proposer: addr(1), proposal_type: transfer_type(100),
            status: MultisigStatus::Pending, created_at: 1000,
            expires_at: 2000, approvals: vec![],
            execution_delay_ms: 0, executed_at: None, nonce: 1,
        };
        assert_eq!(format_proposal_summary(&p), (0, 0, 0));
    }

    #[test]
    fn test_format_proposal_summary_mixed() {
        let p = MultisigProposal {
            proposal_id: 0, proposer: addr(1), proposal_type: transfer_type(100),
            status: MultisigStatus::Pending, created_at: 1000,
            expires_at: 2000,
            approvals: vec![
                Approval { signer: addr(1), approved: true, timestamp: 2000, nonce: 1 },
                Approval { signer: addr(2), approved: false, timestamp: 3000, nonce: 2 },
                Approval { signer: addr(3), approved: true, timestamp: 4000, nonce: 3 },
            ],
            execution_delay_ms: 0, executed_at: None, nonce: 1,
        };
        assert_eq!(format_proposal_summary(&p), (2, 1, 0));
    }

    #[test]
    fn test_is_m_of_n_uniform() {
        let w = wallet_2of3();
        assert_eq!(is_m_of_n(&w), (2, 3));
    }

    #[test]
    fn test_is_m_of_n_weighted() {
        let w = wallet_weighted();
        assert_eq!(is_m_of_n(&w), (4, 6)); // returns threshold, total_weight
    }

    #[test]
    fn test_is_m_of_n_1of1() {
        let w = wallet_1of1();
        assert_eq!(is_m_of_n(&w), (1, 1));
    }

    #[test]
    fn test_next_proposal_id_empty() {
        let w = wallet_2of3();
        assert_eq!(next_proposal_id(&w), 0);
    }

    #[test]
    fn test_next_proposal_id_increments() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        assert_eq!(next_proposal_id(&w), 1);
        create_proposal(&mut w, addr(2), transfer_type(200), 1000).unwrap();
        assert_eq!(next_proposal_id(&w), 2);
    }

    #[test]
    fn test_proposals_by_status() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        create_proposal(&mut w, addr(2), transfer_type(200), 1000).unwrap();
        cancel_proposal(&mut w, 0, &addr(1)).unwrap();
        let pending = proposals_by_status(&w, &MultisigStatus::Pending);
        assert_eq!(pending.len(), 1);
        let cancelled = proposals_by_status(&w, &MultisigStatus::Cancelled);
        assert_eq!(cancelled.len(), 1);
    }

    #[test]
    fn test_proposals_by_status_empty() {
        let w = wallet_2of3();
        let executed = proposals_by_status(&w, &MultisigStatus::Executed);
        assert_eq!(executed.len(), 0);
    }

    #[test]
    fn test_total_value_pending() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(1000), 1000).unwrap();
        create_proposal(&mut w, addr(2), transfer_type(2000), 1000).unwrap();
        assert_eq!(total_value_pending(&w), 3000);
    }

    #[test]
    fn test_total_value_pending_excludes_non_transfer() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(1000), 1000).unwrap();
        create_proposal(
            &mut w,
            addr(2),
            ProposalType::ConfigChange { key: 1, old_value: 0, new_value: 10 },
            1000,
        )
        .unwrap();
        assert_eq!(total_value_pending(&w), 1000);
    }

    #[test]
    fn test_total_value_pending_excludes_cancelled() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(5000), 1000).unwrap();
        cancel_proposal(&mut w, 0, &addr(1)).unwrap();
        assert_eq!(total_value_pending(&w), 0);
    }

    // ============ Integration / Edge Case Tests ============

    #[test]
    fn test_full_lifecycle_transfer() {
        let mut w = wallet_2of3();
        w.execution_delay_ms = 1000; // 1 second timelock
        let now = 10_000;

        // Create
        let id = create_proposal(&mut w, addr(1), transfer_type(50_000), now).unwrap();
        assert_eq!(id, 0);

        // Approve
        approve(&mut w, 0, addr(1), now + 100).unwrap();
        let status = approve(&mut w, 0, addr(2), now + 200).unwrap();
        assert_eq!(status, MultisigStatus::Approved);

        // Timelock not elapsed
        let r = execute_proposal(&mut w, 0, now + 500);
        assert_eq!(r, Err(MultisigError::TimelockActive));

        // Execute after timelock
        let pt = execute_proposal(&mut w, 0, now + 200 + 1001).unwrap();
        assert!(matches!(pt, ProposalType::Transfer { amount: 50_000, .. }));
    }

    #[test]
    fn test_full_lifecycle_config_change() {
        let mut w = wallet_weighted();
        w.execution_delay_ms = 0;
        let now = 5000;
        let pt = ProposalType::ConfigChange { key: 42, old_value: 10, new_value: 20 };
        create_proposal(&mut w, addr(1), pt, now).unwrap();
        approve(&mut w, 0, addr(1), now + 10).unwrap(); // weight 3
        let s = approve(&mut w, 0, addr(2), now + 20).unwrap(); // weight 2 => total 5 >= 4
        assert_eq!(s, MultisigStatus::Approved);
        let result = execute_proposal(&mut w, 0, now + 21).unwrap();
        assert!(matches!(result, ProposalType::ConfigChange { key: 42, new_value: 20, .. }));
    }

    #[test]
    fn test_nonce_increments_through_lifecycle() {
        let mut w = wallet_2of3();
        assert_eq!(w.nonce, 0);
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        assert_eq!(w.nonce, 1);
        approve(&mut w, 0, addr(1), 2000).unwrap();
        assert_eq!(w.nonce, 2);
        approve(&mut w, 0, addr(2), 3000).unwrap();
        assert_eq!(w.nonce, 3);
    }

    #[test]
    fn test_multiple_proposals_independent() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        create_proposal(&mut w, addr(2), transfer_type(200), 1000).unwrap();
        // Approve proposal 1
        approve(&mut w, 0, addr(1), 2000).unwrap();
        approve(&mut w, 0, addr(2), 3000).unwrap();
        // Reject proposal 2
        reject(&mut w, 1, addr(1), 2000).unwrap();
        reject(&mut w, 1, addr(2), 3000).unwrap();
        assert_eq!(w.proposals[0].status, MultisigStatus::Approved);
        assert_eq!(w.proposals[1].status, MultisigStatus::Rejected);
    }

    #[test]
    fn test_wallet_after_signer_changes() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        approve(&mut w, 0, addr(1), 2000).unwrap();
        // Add new signer
        add_signer(&mut w, make_signer(4, 1)).unwrap();
        assert_eq!(w.total_weight, 4);
        // New signer can approve existing proposal
        let s = approve(&mut w, 0, addr(4), 3000).unwrap();
        assert_eq!(s, MultisigStatus::Approved); // 2 >= threshold 2
    }

    #[test]
    fn test_emergency_action_proposal() {
        let mut w = wallet_1of1();
        w.execution_delay_ms = 0;
        let pt = ProposalType::EmergencyAction { action_code: 911, data: 0 };
        create_proposal(&mut w, addr(1), pt, 1000).unwrap();
        approve(&mut w, 0, addr(1), 2000).unwrap();
        let result = execute_proposal(&mut w, 0, 2001).unwrap();
        assert!(matches!(result, ProposalType::EmergencyAction { action_code: 911, .. }));
    }

    #[test]
    fn test_threshold_change_proposal() {
        let mut w = wallet_2of3();
        w.execution_delay_ms = 0;
        let pt = ProposalType::ThresholdChange { new_threshold: 3 };
        create_proposal(&mut w, addr(1), pt, 1000).unwrap();
        approve(&mut w, 0, addr(1), 2000).unwrap();
        approve(&mut w, 0, addr(2), 3000).unwrap();
        let result = execute_proposal(&mut w, 0, 3001).unwrap();
        assert!(matches!(result, ProposalType::ThresholdChange { new_threshold: 3 }));
    }

    #[test]
    fn test_signer_add_proposal_type() {
        let mut w = wallet_2of3();
        w.execution_delay_ms = 0;
        let pt = ProposalType::SignerAdd { signer: addr(4), weight: 2 };
        create_proposal(&mut w, addr(1), pt, 1000).unwrap();
        approve(&mut w, 0, addr(1), 2000).unwrap();
        approve(&mut w, 0, addr(2), 3000).unwrap();
        let result = execute_proposal(&mut w, 0, 3001).unwrap();
        assert!(matches!(result, ProposalType::SignerAdd { weight: 2, .. }));
    }

    #[test]
    fn test_custom_proposal_type() {
        let mut w = wallet_2of3();
        w.execution_delay_ms = 0;
        let pt = ProposalType::Custom { action_hash: [0xAA; 32], description_hash: [0xBB; 32] };
        create_proposal(&mut w, addr(1), pt, 1000).unwrap();
        approve(&mut w, 0, addr(1), 2000).unwrap();
        approve(&mut w, 0, addr(2), 3000).unwrap();
        let result = execute_proposal(&mut w, 0, 3001).unwrap();
        assert!(matches!(result, ProposalType::Custom { .. }));
    }

    #[test]
    fn test_approval_weight_nonexistent_proposal() {
        let w = wallet_2of3();
        assert_eq!(approval_weight(&w, 999), 0);
    }

    #[test]
    fn test_rejection_weight_nonexistent_proposal() {
        let w = wallet_2of3();
        assert_eq!(rejection_weight(&w, 999), 0);
    }

    #[test]
    fn test_has_approved_nonexistent_proposal() {
        let w = wallet_2of3();
        assert!(!has_approved(&w, 999, &addr(1)));
    }

    #[test]
    fn test_approval_percentage_nonexistent() {
        let w = wallet_2of3();
        assert_eq!(approval_percentage(&w, 999), 0);
    }

    #[test]
    fn test_daily_limit_saturating() {
        let mut w = wallet_2of3();
        w.daily_limit = u64::MAX;
        assert!(check_daily_limit(&w, u64::MAX, 1000));
    }

    #[test]
    fn test_record_spend_saturating() {
        let mut w = wallet_2of3();
        record_spend(&mut w, u64::MAX, 1000);
        record_spend(&mut w, 1, 1000 + 1);
        assert_eq!(w.daily_spent, u64::MAX); // saturates
    }

    #[test]
    fn test_execute_proposal_not_found() {
        let mut w = wallet_2of3();
        let r = execute_proposal(&mut w, 999, 1000);
        assert_eq!(r, Err(MultisigError::ProposalNotFound));
    }

    #[test]
    fn test_reject_not_found() {
        let mut w = wallet_2of3();
        let r = reject(&mut w, 999, addr(1), 1000);
        assert_eq!(r, Err(MultisigError::ProposalNotFound));
    }

    #[test]
    fn test_reject_not_pending() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        cancel_proposal(&mut w, 0, &addr(1)).unwrap();
        let r = reject(&mut w, 0, addr(2), 2000);
        assert_eq!(r, Err(MultisigError::ProposalNotPending));
    }

    #[test]
    fn test_cancel_already_cancelled() {
        let mut w = wallet_2of3();
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        cancel_proposal(&mut w, 0, &addr(1)).unwrap();
        let r = cancel_proposal(&mut w, 0, &addr(1));
        assert_eq!(r, Err(MultisigError::ProposalNotPending));
    }

    #[test]
    fn test_remove_inactive_signer_fails() {
        let mut w = wallet_2of3();
        w.signers[1].is_active = false;
        let r = remove_signer(&mut w, &addr(2));
        assert_eq!(r, Err(MultisigError::SignerNotFound));
    }

    #[test]
    fn test_validate_wallet_with_zero_weight_signer() {
        let mut w = wallet_2of3();
        w.signers[0].weight = 0;
        assert_eq!(validate_wallet(&w), Err(MultisigError::InvalidWeight));
    }

    #[test]
    fn test_validate_wallet_duplicate() {
        let mut w = wallet_2of3();
        w.signers[1].address = w.signers[0].address;
        assert_eq!(validate_wallet(&w), Err(MultisigError::DuplicateSigner));
    }

    #[test]
    fn test_create_proposal_wallet_full() {
        let mut w = wallet_2of3();
        for i in 0..MAX_PROPOSALS {
            w.proposals.push(MultisigProposal {
                proposal_id: i as u64, proposer: addr(1),
                proposal_type: transfer_type(1), status: MultisigStatus::Pending,
                created_at: 1000, expires_at: u64::MAX, approvals: vec![],
                execution_delay_ms: 0, executed_at: None, nonce: i as u64,
            });
        }
        let r = create_proposal(&mut w, addr(1), transfer_type(100), 1000);
        assert_eq!(r, Err(MultisigError::WalletFull));
    }

    #[test]
    fn test_approval_percentage_zero_weight_wallet() {
        let mut w = wallet_2of3();
        w.total_weight = 0;
        assert_eq!(approval_percentage(&w, 0), 0);
    }

    #[test]
    fn test_signer_remove_proposal_type() {
        let mut w = wallet_2of3();
        w.execution_delay_ms = 0;
        let pt = ProposalType::SignerRemove { signer: addr(3) };
        create_proposal(&mut w, addr(1), pt, 1000).unwrap();
        approve(&mut w, 0, addr(1), 2000).unwrap();
        approve(&mut w, 0, addr(2), 3000).unwrap();
        let result = execute_proposal(&mut w, 0, 3001).unwrap();
        assert!(matches!(result, ProposalType::SignerRemove { .. }));
    }

    #[test]
    fn test_expire_then_cleanup_lifecycle() {
        let mut w = wallet_2of3();
        w.execution_delay_ms = 0;
        // Create two proposals: one that gets executed, one that expires
        create_proposal(&mut w, addr(1), transfer_type(100), 1000).unwrap();
        create_proposal(&mut w, addr(2), transfer_type(200), 1000).unwrap();
        approve(&mut w, 0, addr(1), 2000).unwrap();
        approve(&mut w, 0, addr(2), 3000).unwrap();
        execute_proposal(&mut w, 0, 3001).unwrap();
        // Expire the second
        let expired = expire_proposals(&mut w, 1000 + DEFAULT_EXPIRY_MS);
        assert_eq!(expired, 1);
        // Cleanup executed
        let cleaned = cleanup_executed(&mut w);
        assert_eq!(cleaned, 1);
        // Only expired proposal remains
        assert_eq!(w.proposals.len(), 1);
        assert_eq!(w.proposals[0].status, MultisigStatus::Expired);
    }

    #[test]
    fn test_remaining_weight_nonexistent() {
        let w = wallet_2of3();
        assert_eq!(remaining_weight_needed(&w, 999), 2); // threshold since no approvals found
    }
}
