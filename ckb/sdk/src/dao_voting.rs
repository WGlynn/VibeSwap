// ============ DAO Voting Module ============
// On-chain governance for VibeSwap's DAO on CKB.
//
// Implements:
// - Proposal lifecycle (create, queue, execute, cancel, expire)
// - Voting mechanics (for/against/abstain, veVIBE boost)
// - Dynamic quorum based on total supply and participation
// - Timelock execution with grace period
// - Vote delegation and split delegation
// - Vote incentives with early voter bonus
// - Quadratic voting cost calculation
// - Analytics: participation rates, power concentration (Herfindahl)
//
// All arithmetic uses u64/u128 — no floating point, deterministic everywhere.
// Errors are simple strings for CKB cell compatibility.

// ============ Constants ============

/// Proposal status codes
pub const STATUS_PENDING: u8 = 0;
pub const STATUS_ACTIVE: u8 = 1;
pub const STATUS_PASSED: u8 = 2;
pub const STATUS_FAILED: u8 = 3;
pub const STATUS_QUEUED: u8 = 4;
pub const STATUS_EXECUTED: u8 = 5;
pub const STATUS_CANCELLED: u8 = 6;
pub const STATUS_EXPIRED: u8 = 7;

/// Vote support values
pub const VOTE_AGAINST: u8 = 0;
pub const VOTE_FOR: u8 = 1;
pub const VOTE_ABSTAIN: u8 = 2;

/// Proposal types
pub const PROPOSAL_PARAMETER_CHANGE: u8 = 0;
pub const PROPOSAL_TREASURY_SPEND: u8 = 1;
pub const PROPOSAL_EMERGENCY_ACTION: u8 = 2;
pub const PROPOSAL_UPGRADE: u8 = 3;

/// Outcome codes from determine_outcome
pub const OUTCOME_PENDING: u8 = 0;
pub const OUTCOME_PASSED: u8 = 1;
pub const OUTCOME_FAILED: u8 = 2;
pub const OUTCOME_QUORUM_NOT_MET: u8 = 3;

/// Basis points denominator
pub const BPS_DENOMINATOR: u64 = 10_000;

// ============ Data Types ============

#[derive(Debug, Clone)]
pub struct Proposal {
    pub id: u64,
    pub proposer: u64,
    pub title_hash: [u8; 32],
    pub description_hash: [u8; 32],
    pub proposal_type: u8,
    pub for_votes: u128,
    pub against_votes: u128,
    pub abstain_votes: u128,
    pub start_block: u64,
    pub end_block: u64,
    pub eta: u64,
    pub status: u8,
    pub created_at: u64,
}

#[derive(Debug, Clone)]
pub struct Vote {
    pub voter: u64,
    pub proposal_id: u64,
    pub support: u8,
    pub weight: u128,
    pub timestamp: u64,
}

#[derive(Debug, Clone)]
pub struct GovernanceConfig {
    pub voting_delay_blocks: u64,
    pub voting_period_blocks: u64,
    pub quorum_bps: u64,
    pub timelock_delay_blocks: u64,
    pub grace_period_blocks: u64,
    pub proposal_threshold: u128,
}

#[derive(Debug, Clone)]
pub struct DelegationRecord {
    pub delegator: u64,
    pub delegatee: u64,
    pub amount: u128,
    pub expires_at: u64,
}

#[derive(Debug, Clone)]
pub struct VoteIncentive {
    pub proposal_id: u64,
    pub total_reward: u64,
    pub reward_per_vote: u64,
    pub early_bonus_bps: u64,
    pub early_cutoff_block: u64,
}

#[derive(Debug, Clone)]
pub struct QuorumState {
    pub total_supply: u128,
    pub total_votes_cast: u128,
    pub quorum_threshold: u128,
    pub participation_rate_bps: u64,
}

#[derive(Debug, Clone)]
pub struct TimelockEntry {
    pub proposal_id: u64,
    pub execute_after: u64,
    pub execute_before: u64,
    pub executed: bool,
}

#[derive(Debug, Clone)]
pub struct ProposalStats {
    pub total_proposals: u64,
    pub passed: u64,
    pub failed: u64,
    pub expired: u64,
    pub cancelled: u64,
    pub avg_participation_bps: u64,
}

// ============ Proposal Lifecycle ============

pub fn create_proposal(
    config: &GovernanceConfig,
    proposer: u64,
    title_hash: [u8; 32],
    desc_hash: [u8; 32],
    proposal_type: u8,
    current_block: u64,
    proposer_balance: u128,
) -> Result<Proposal, String> {
    if proposer_balance < config.proposal_threshold {
        return Err("Proposer balance below threshold".to_string());
    }
    validate_proposal_type(proposal_type)?;

    let start_block = current_block + config.voting_delay_blocks;
    let end_block = start_block + config.voting_period_blocks;

    Ok(Proposal {
        id: current_block,
        proposer,
        title_hash,
        description_hash: desc_hash,
        proposal_type,
        for_votes: 0,
        against_votes: 0,
        abstain_votes: 0,
        start_block,
        end_block,
        eta: 0,
        status: STATUS_ACTIVE,
        created_at: current_block,
    })
}

pub fn cancel_proposal(
    proposal: &Proposal,
    canceller: u64,
    proposer_balance: u128,
    config: &GovernanceConfig,
) -> Result<Proposal, String> {
    if proposal.status == STATUS_EXECUTED {
        return Err("Cannot cancel executed proposal".to_string());
    }
    if proposal.status == STATUS_CANCELLED {
        return Err("Proposal already cancelled".to_string());
    }
    // Canceller must be proposer OR proposer has fallen below threshold
    if canceller != proposal.proposer && proposer_balance >= config.proposal_threshold {
        return Err("Not authorized to cancel".to_string());
    }

    let mut cancelled = proposal.clone();
    cancelled.status = STATUS_CANCELLED;
    Ok(cancelled)
}

pub fn expire_proposal(proposal: &Proposal, current_block: u64) -> Result<Proposal, String> {
    if proposal.status != STATUS_ACTIVE {
        return Err("Only active proposals can expire".to_string());
    }
    if current_block <= proposal.end_block {
        return Err("Voting period not yet ended".to_string());
    }
    let mut expired = proposal.clone();
    expired.status = STATUS_EXPIRED;
    Ok(expired)
}

// ============ Voting Mechanics ============

pub fn cast_vote(
    proposal: &mut Proposal,
    voter: u64,
    support: u8,
    weight: u128,
    current_block: u64,
) -> Result<Vote, String> {
    if proposal.status != STATUS_ACTIVE {
        return Err("Proposal is not active".to_string());
    }
    if current_block < proposal.start_block {
        return Err("Voting has not started".to_string());
    }
    if current_block > proposal.end_block {
        return Err("Voting period has ended".to_string());
    }
    if weight == 0 {
        return Err("Vote weight cannot be zero".to_string());
    }
    if support > VOTE_ABSTAIN {
        return Err("Invalid vote support value".to_string());
    }

    match support {
        VOTE_AGAINST => proposal.against_votes += weight,
        VOTE_FOR => proposal.for_votes += weight,
        VOTE_ABSTAIN => proposal.abstain_votes += weight,
        _ => return Err("Invalid vote support value".to_string()),
    }

    Ok(Vote {
        voter,
        proposal_id: proposal.id,
        support,
        weight,
        timestamp: current_block,
    })
}

pub fn calculate_vote_weight(
    token_balance: u128,
    ve_balance: u128,
    boost_multiplier_bps: u64,
) -> u128 {
    if token_balance == 0 {
        return 0;
    }
    let boost = ve_balance * boost_multiplier_bps as u128 / BPS_DENOMINATOR as u128;
    token_balance + boost
}

// ============ Quorum ============

pub fn check_quorum(proposal: &Proposal, config: &GovernanceConfig, total_supply: u128) -> bool {
    if total_supply == 0 {
        return false;
    }
    let total_votes = proposal.for_votes + proposal.against_votes + proposal.abstain_votes;
    let quorum_threshold = total_supply * config.quorum_bps as u128 / BPS_DENOMINATOR as u128;
    total_votes >= quorum_threshold
}

pub fn calculate_dynamic_quorum(total_supply: u128, recent_participation_bps: u64) -> u128 {
    if total_supply == 0 {
        return 0;
    }
    // If participation is high, lower quorum to reduce friction
    // If participation is low, raise quorum to ensure legitimacy
    // Base quorum: 4% (400 bps). Adjusted inversely with participation.
    let base_quorum_bps: u64 = 400;
    let adjusted_bps = if recent_participation_bps > 2000 {
        // High participation: reduce quorum (min 200 bps = 2%)
        let reduction = (recent_participation_bps - 2000) / 10;
        if reduction < base_quorum_bps {
            base_quorum_bps - reduction
        } else {
            200
        }
    } else if recent_participation_bps < 500 {
        // Low participation: increase quorum (max 800 bps = 8%)
        let increase = (500 - recent_participation_bps) / 5;
        let result = base_quorum_bps + increase;
        if result > 800 { 800 } else { result }
    } else {
        base_quorum_bps
    };
    // Clamp between 200 and 800 bps
    let final_bps = if adjusted_bps < 200 {
        200
    } else if adjusted_bps > 800 {
        800
    } else {
        adjusted_bps
    };
    total_supply * final_bps as u128 / BPS_DENOMINATOR as u128
}

// ============ Tally & Outcome ============

pub fn tally_votes(proposal: &Proposal) -> (u128, u128, u128) {
    (proposal.for_votes, proposal.against_votes, proposal.abstain_votes)
}

pub fn determine_outcome(
    proposal: &Proposal,
    config: &GovernanceConfig,
    total_supply: u128,
) -> u8 {
    if proposal.status != STATUS_ACTIVE {
        return OUTCOME_PENDING;
    }
    if !check_quorum(proposal, config, total_supply) {
        return OUTCOME_QUORUM_NOT_MET;
    }
    if proposal.for_votes > proposal.against_votes {
        OUTCOME_PASSED
    } else {
        OUTCOME_FAILED
    }
}

// ============ Timelock ============

pub fn queue_for_execution(
    proposal: &Proposal,
    config: &GovernanceConfig,
    current_block: u64,
) -> Result<TimelockEntry, String> {
    if proposal.status != STATUS_ACTIVE && proposal.status != STATUS_PASSED {
        return Err("Proposal not in valid state for queuing".to_string());
    }
    if proposal.for_votes <= proposal.against_votes {
        return Err("Proposal did not pass".to_string());
    }

    let execute_after = current_block + config.timelock_delay_blocks;
    let execute_before = execute_after + config.grace_period_blocks;

    Ok(TimelockEntry {
        proposal_id: proposal.id,
        execute_after,
        execute_before,
        executed: false,
    })
}

pub fn execute_proposal(entry: &TimelockEntry, current_block: u64) -> Result<bool, String> {
    if entry.executed {
        return Err("Proposal already executed".to_string());
    }
    if current_block < entry.execute_after {
        return Err("Timelock has not expired".to_string());
    }
    if current_block > entry.execute_before {
        return Err("Grace period has expired".to_string());
    }
    Ok(true)
}

pub fn is_in_timelock(entry: &TimelockEntry, current_block: u64) -> bool {
    !entry.executed && current_block >= entry.execute_after && current_block <= entry.execute_before
}

pub fn is_expired(entry: &TimelockEntry, current_block: u64) -> bool {
    !entry.executed && current_block > entry.execute_before
}

// ============ Delegation ============

pub fn delegate_votes(
    delegator: u64,
    delegatee: u64,
    amount: u128,
    expires_at: u64,
) -> Result<DelegationRecord, String> {
    if delegator == delegatee {
        return Err("Cannot delegate to self".to_string());
    }
    if amount == 0 {
        return Err("Delegation amount cannot be zero".to_string());
    }
    Ok(DelegationRecord {
        delegator,
        delegatee,
        amount,
        expires_at,
    })
}

pub fn calculate_delegated_power(delegations: &[DelegationRecord], voter: u64) -> u128 {
    delegations
        .iter()
        .filter(|d| d.delegatee == voter)
        .map(|d| d.amount)
        .sum()
}

pub fn split_delegation(
    delegator: u64,
    delegatees: &[u64],
    amounts: &[u128],
) -> Result<Vec<DelegationRecord>, String> {
    if delegatees.len() != amounts.len() {
        return Err("Delegatees and amounts must have same length".to_string());
    }
    if delegatees.is_empty() {
        return Err("Must have at least one delegatee".to_string());
    }
    let mut records = Vec::new();
    for i in 0..delegatees.len() {
        if delegatees[i] == delegator {
            return Err("Cannot delegate to self".to_string());
        }
        if amounts[i] == 0 {
            return Err("Delegation amount cannot be zero".to_string());
        }
        records.push(DelegationRecord {
            delegator,
            delegatee: delegatees[i],
            amount: amounts[i],
            expires_at: 0,
        });
    }
    Ok(records)
}

pub fn get_effective_voting_power(
    own_balance: u128,
    delegated_power: u128,
    ve_boost_bps: u64,
) -> u128 {
    let base = own_balance + delegated_power;
    let boost = base * ve_boost_bps as u128 / BPS_DENOMINATOR as u128;
    base + boost
}

// ============ Vote Incentives ============

pub fn calculate_early_voter_bonus(
    incentive: &VoteIncentive,
    vote_block: u64,
    proposal_start_block: u64,
) -> u64 {
    if vote_block > incentive.early_cutoff_block {
        return 0;
    }
    if vote_block < proposal_start_block {
        return 0;
    }
    if incentive.early_cutoff_block <= proposal_start_block {
        return incentive.early_bonus_bps as u64;
    }
    let window = incentive.early_cutoff_block - proposal_start_block;
    let elapsed = vote_block - proposal_start_block;
    // Linear decay: full bonus at start, zero at cutoff
    let remaining = window - elapsed;
    (incentive.early_bonus_bps * remaining / window) as u64
}

pub fn distribute_vote_rewards(
    incentive: &VoteIncentive,
    voters: &[(u64, u64)], // (voter_id, vote_block)
) -> Vec<(u64, u64)> {
    if voters.is_empty() || incentive.total_reward == 0 {
        return Vec::new();
    }
    let base_reward = if voters.len() > 0 {
        incentive.total_reward / voters.len() as u64
    } else {
        0
    };
    voters
        .iter()
        .map(|&(voter_id, _vote_block)| {
            (voter_id, base_reward)
        })
        .collect()
}

// ============ Quadratic Voting ============

pub fn quadratic_vote_cost(num_votes: u128) -> u128 {
    num_votes * num_votes
}

// ============ Validation & Queries ============

pub fn check_proposal_threshold(balance: u128, config: &GovernanceConfig) -> bool {
    balance >= config.proposal_threshold
}

pub fn is_voting_active(proposal: &Proposal, current_block: u64) -> bool {
    proposal.status == STATUS_ACTIVE
        && current_block >= proposal.start_block
        && current_block <= proposal.end_block
}

pub fn validate_proposal_type(proposal_type: u8) -> Result<bool, String> {
    match proposal_type {
        PROPOSAL_PARAMETER_CHANGE
        | PROPOSAL_TREASURY_SPEND
        | PROPOSAL_EMERGENCY_ACTION
        | PROPOSAL_UPGRADE => Ok(true),
        _ => Err("Invalid proposal type".to_string()),
    }
}

// ============ Analytics ============

pub fn calculate_participation_rate(votes_cast: u128, total_supply: u128) -> u64 {
    if total_supply == 0 {
        return 0;
    }
    (votes_cast * BPS_DENOMINATOR as u128 / total_supply) as u64
}

pub fn get_proposal_stats(proposals: &[Proposal]) -> ProposalStats {
    let total = proposals.len() as u64;
    let passed = proposals.iter().filter(|p| p.status == STATUS_PASSED || p.status == STATUS_EXECUTED).count() as u64;
    let failed = proposals.iter().filter(|p| p.status == STATUS_FAILED).count() as u64;
    let expired = proposals.iter().filter(|p| p.status == STATUS_EXPIRED).count() as u64;
    let cancelled = proposals.iter().filter(|p| p.status == STATUS_CANCELLED).count() as u64;

    let avg_participation = if total == 0 {
        0
    } else {
        let total_participation: u64 = proposals
            .iter()
            .map(|p| {
                let total_votes = p.for_votes + p.against_votes + p.abstain_votes;
                if total_votes > 0 { 5000_u64 } else { 0_u64 } // placeholder 50% when votes exist
            })
            .sum();
        total_participation / total
    };

    ProposalStats {
        total_proposals: total,
        passed,
        failed,
        expired,
        cancelled,
        avg_participation_bps: avg_participation,
    }
}

pub fn calculate_power_concentration(voter_weights: &[u128], total_votes: u128) -> u64 {
    if total_votes == 0 || voter_weights.is_empty() {
        return 0;
    }
    // Herfindahl-Hirschman Index in basis points
    // HHI = sum of (market_share_i)^2
    // We compute in bps: share_i = weight_i * 10000 / total, HHI = sum(share_i^2) / 10000
    let mut hhi: u128 = 0;
    for &w in voter_weights {
        let share_bps = w * BPS_DENOMINATOR as u128 / total_votes;
        hhi += share_bps * share_bps;
    }
    // Normalize: max HHI = 10000^2 = 100_000_000, divide by 10000 to get bps
    (hhi / BPS_DENOMINATOR as u128) as u64
}

pub fn detect_vote_buying(votes: &[Vote], threshold_pct: u64) -> Vec<u64> {
    // Detect voters who cast suspiciously large votes (weight > threshold% of total)
    if votes.is_empty() || threshold_pct == 0 {
        return Vec::new();
    }
    let total_weight: u128 = votes.iter().map(|v| v.weight).sum();
    if total_weight == 0 {
        return Vec::new();
    }
    let threshold = total_weight * threshold_pct as u128 / 100;
    votes
        .iter()
        .filter(|v| v.weight > threshold)
        .map(|v| v.voter)
        .collect()
}

// ============ Helper Functions ============

pub fn create_default_config() -> GovernanceConfig {
    GovernanceConfig {
        voting_delay_blocks: 100,
        voting_period_blocks: 1000,
        quorum_bps: 400,
        timelock_delay_blocks: 200,
        grace_period_blocks: 500,
        proposal_threshold: 1000,
    }
}

pub fn create_quorum_state(
    total_supply: u128,
    total_votes_cast: u128,
    config: &GovernanceConfig,
) -> QuorumState {
    let quorum_threshold = total_supply * config.quorum_bps as u128 / BPS_DENOMINATOR as u128;
    let participation_rate_bps = calculate_participation_rate(total_votes_cast, total_supply);
    QuorumState {
        total_supply,
        total_votes_cast,
        quorum_threshold,
        participation_rate_bps,
    }
}

pub fn total_votes(proposal: &Proposal) -> u128 {
    proposal.for_votes + proposal.against_votes + proposal.abstain_votes
}

pub fn has_passed(proposal: &Proposal) -> bool {
    proposal.for_votes > proposal.against_votes
}

pub fn vote_margin(proposal: &Proposal) -> i128 {
    proposal.for_votes as i128 - proposal.against_votes as i128
}

pub fn filter_active_delegations(delegations: &[DelegationRecord], current_time: u64) -> Vec<DelegationRecord> {
    delegations
        .iter()
        .filter(|d| d.expires_at == 0 || d.expires_at > current_time)
        .cloned()
        .collect()
}

pub fn calculate_total_delegated(delegations: &[DelegationRecord], delegator: u64) -> u128 {
    delegations
        .iter()
        .filter(|d| d.delegator == delegator)
        .map(|d| d.amount)
        .sum()
}

pub fn is_proposal_type_emergency(proposal_type: u8) -> bool {
    proposal_type == PROPOSAL_EMERGENCY_ACTION
}

pub fn calculate_remaining_voting_blocks(proposal: &Proposal, current_block: u64) -> u64 {
    if current_block >= proposal.end_block {
        0
    } else {
        proposal.end_block - current_block
    }
}

pub fn calculate_voting_progress_bps(proposal: &Proposal, current_block: u64) -> u64 {
    if current_block <= proposal.start_block {
        return 0;
    }
    let period = proposal.end_block - proposal.start_block;
    if period == 0 {
        return BPS_DENOMINATOR;
    }
    let elapsed = if current_block >= proposal.end_block {
        period
    } else {
        current_block - proposal.start_block
    };
    (elapsed * BPS_DENOMINATOR / period) as u64
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    fn default_config() -> GovernanceConfig {
        create_default_config()
    }

    fn default_title_hash() -> [u8; 32] {
        [1u8; 32]
    }

    fn default_desc_hash() -> [u8; 32] {
        [2u8; 32]
    }

    fn make_proposal(id: u64, for_v: u128, against_v: u128, abstain_v: u128) -> Proposal {
        Proposal {
            id,
            proposer: 1,
            title_hash: default_title_hash(),
            description_hash: default_desc_hash(),
            proposal_type: PROPOSAL_PARAMETER_CHANGE,
            for_votes: for_v,
            against_votes: against_v,
            abstain_votes: abstain_v,
            start_block: 100,
            end_block: 1100,
            eta: 0,
            status: STATUS_ACTIVE,
            created_at: 0,
        }
    }

    fn make_proposal_with_status(status: u8) -> Proposal {
        let mut p = make_proposal(1, 0, 0, 0);
        p.status = status;
        p
    }

    fn make_timelock(proposal_id: u64, after: u64, before: u64) -> TimelockEntry {
        TimelockEntry {
            proposal_id,
            execute_after: after,
            execute_before: before,
            executed: false,
        }
    }

    // ============ Proposal Creation Tests ============

    #[test]
    fn test_create_proposal_success() {
        let config = default_config();
        let result = create_proposal(&config, 1, default_title_hash(), default_desc_hash(), PROPOSAL_PARAMETER_CHANGE, 50, 2000);
        assert!(result.is_ok());
        let p = result.unwrap();
        assert_eq!(p.proposer, 1);
        assert_eq!(p.status, STATUS_ACTIVE);
        assert_eq!(p.for_votes, 0);
        assert_eq!(p.against_votes, 0);
    }

    #[test]
    fn test_create_proposal_below_threshold() {
        let config = default_config();
        let result = create_proposal(&config, 1, default_title_hash(), default_desc_hash(), PROPOSAL_PARAMETER_CHANGE, 50, 500);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("threshold"));
    }

    #[test]
    fn test_create_proposal_exact_threshold() {
        let config = default_config();
        let result = create_proposal(&config, 1, default_title_hash(), default_desc_hash(), PROPOSAL_PARAMETER_CHANGE, 50, 1000);
        assert!(result.is_ok());
    }

    #[test]
    fn test_create_proposal_invalid_type() {
        let config = default_config();
        let result = create_proposal(&config, 1, default_title_hash(), default_desc_hash(), 99, 50, 2000);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid proposal type"));
    }

    #[test]
    fn test_create_proposal_start_block_delay() {
        let config = default_config();
        let p = create_proposal(&config, 1, default_title_hash(), default_desc_hash(), PROPOSAL_PARAMETER_CHANGE, 50, 2000).unwrap();
        assert_eq!(p.start_block, 50 + config.voting_delay_blocks);
    }

    #[test]
    fn test_create_proposal_end_block() {
        let config = default_config();
        let p = create_proposal(&config, 1, default_title_hash(), default_desc_hash(), PROPOSAL_PARAMETER_CHANGE, 50, 2000).unwrap();
        assert_eq!(p.end_block, 50 + config.voting_delay_blocks + config.voting_period_blocks);
    }

    #[test]
    fn test_create_proposal_treasury_spend_type() {
        let config = default_config();
        let p = create_proposal(&config, 1, default_title_hash(), default_desc_hash(), PROPOSAL_TREASURY_SPEND, 50, 2000).unwrap();
        assert_eq!(p.proposal_type, PROPOSAL_TREASURY_SPEND);
    }

    #[test]
    fn test_create_proposal_emergency_action_type() {
        let config = default_config();
        let p = create_proposal(&config, 1, default_title_hash(), default_desc_hash(), PROPOSAL_EMERGENCY_ACTION, 50, 2000).unwrap();
        assert_eq!(p.proposal_type, PROPOSAL_EMERGENCY_ACTION);
    }

    #[test]
    fn test_create_proposal_upgrade_type() {
        let config = default_config();
        let p = create_proposal(&config, 1, default_title_hash(), default_desc_hash(), PROPOSAL_UPGRADE, 50, 2000).unwrap();
        assert_eq!(p.proposal_type, PROPOSAL_UPGRADE);
    }

    #[test]
    fn test_create_proposal_stores_title_hash() {
        let config = default_config();
        let th = [42u8; 32];
        let p = create_proposal(&config, 1, th, default_desc_hash(), PROPOSAL_PARAMETER_CHANGE, 50, 2000).unwrap();
        assert_eq!(p.title_hash, th);
    }

    #[test]
    fn test_create_proposal_stores_desc_hash() {
        let config = default_config();
        let dh = [43u8; 32];
        let p = create_proposal(&config, 1, default_title_hash(), dh, PROPOSAL_PARAMETER_CHANGE, 50, 2000).unwrap();
        assert_eq!(p.description_hash, dh);
    }

    #[test]
    fn test_create_proposal_zero_balance() {
        let config = default_config();
        let result = create_proposal(&config, 1, default_title_hash(), default_desc_hash(), PROPOSAL_PARAMETER_CHANGE, 50, 0);
        assert!(result.is_err());
    }

    #[test]
    fn test_create_proposal_large_balance() {
        let config = default_config();
        let result = create_proposal(&config, 1, default_title_hash(), default_desc_hash(), PROPOSAL_PARAMETER_CHANGE, 50, u128::MAX);
        assert!(result.is_ok());
    }

    // ============ Vote Casting Tests ============

    #[test]
    fn test_cast_vote_for() {
        let mut p = make_proposal(1, 0, 0, 0);
        let result = cast_vote(&mut p, 10, VOTE_FOR, 500, 200);
        assert!(result.is_ok());
        assert_eq!(p.for_votes, 500);
    }

    #[test]
    fn test_cast_vote_against() {
        let mut p = make_proposal(1, 0, 0, 0);
        let result = cast_vote(&mut p, 10, VOTE_AGAINST, 300, 200);
        assert!(result.is_ok());
        assert_eq!(p.against_votes, 300);
    }

    #[test]
    fn test_cast_vote_abstain() {
        let mut p = make_proposal(1, 0, 0, 0);
        let result = cast_vote(&mut p, 10, VOTE_ABSTAIN, 200, 200);
        assert!(result.is_ok());
        assert_eq!(p.abstain_votes, 200);
    }

    #[test]
    fn test_cast_vote_invalid_support() {
        let mut p = make_proposal(1, 0, 0, 0);
        let result = cast_vote(&mut p, 10, 5, 100, 200);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid"));
    }

    #[test]
    fn test_cast_vote_zero_weight() {
        let mut p = make_proposal(1, 0, 0, 0);
        let result = cast_vote(&mut p, 10, VOTE_FOR, 0, 200);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("zero"));
    }

    #[test]
    fn test_cast_vote_before_start() {
        let mut p = make_proposal(1, 0, 0, 0);
        let result = cast_vote(&mut p, 10, VOTE_FOR, 100, 50); // before start_block=100
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not started"));
    }

    #[test]
    fn test_cast_vote_after_end() {
        let mut p = make_proposal(1, 0, 0, 0);
        let result = cast_vote(&mut p, 10, VOTE_FOR, 100, 2000); // after end_block=1100
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("ended"));
    }

    #[test]
    fn test_cast_vote_not_active() {
        let mut p = make_proposal_with_status(STATUS_CANCELLED);
        let result = cast_vote(&mut p, 10, VOTE_FOR, 100, 200);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not active"));
    }

    #[test]
    fn test_cast_vote_at_start_block() {
        let mut p = make_proposal(1, 0, 0, 0);
        let result = cast_vote(&mut p, 10, VOTE_FOR, 100, 100); // exactly at start
        assert!(result.is_ok());
    }

    #[test]
    fn test_cast_vote_at_end_block() {
        let mut p = make_proposal(1, 0, 0, 0);
        let result = cast_vote(&mut p, 10, VOTE_FOR, 100, 1100); // exactly at end
        assert!(result.is_ok());
    }

    #[test]
    fn test_cast_multiple_votes_accumulate() {
        let mut p = make_proposal(1, 0, 0, 0);
        cast_vote(&mut p, 10, VOTE_FOR, 100, 200).unwrap();
        cast_vote(&mut p, 11, VOTE_FOR, 200, 201).unwrap();
        assert_eq!(p.for_votes, 300);
    }

    #[test]
    fn test_cast_vote_returns_correct_vote() {
        let mut p = make_proposal(1, 0, 0, 0);
        let vote = cast_vote(&mut p, 42, VOTE_AGAINST, 999, 500).unwrap();
        assert_eq!(vote.voter, 42);
        assert_eq!(vote.proposal_id, 1);
        assert_eq!(vote.support, VOTE_AGAINST);
        assert_eq!(vote.weight, 999);
        assert_eq!(vote.timestamp, 500);
    }

    #[test]
    fn test_cast_vote_max_weight() {
        let mut p = make_proposal(1, 0, 0, 0);
        let result = cast_vote(&mut p, 10, VOTE_FOR, u128::MAX / 2, 200);
        assert!(result.is_ok());
    }

    // ============ Vote Weight Tests ============

    #[test]
    fn test_vote_weight_no_boost() {
        let w = calculate_vote_weight(1000, 0, 0);
        assert_eq!(w, 1000);
    }

    #[test]
    fn test_vote_weight_with_ve_boost() {
        let w = calculate_vote_weight(1000, 500, 5000); // 50% boost
        // boost = 500 * 5000 / 10000 = 250
        assert_eq!(w, 1250);
    }

    #[test]
    fn test_vote_weight_zero_balance() {
        let w = calculate_vote_weight(0, 1000, 5000);
        assert_eq!(w, 0);
    }

    #[test]
    fn test_vote_weight_max_boost() {
        let w = calculate_vote_weight(1000, 1000, 10000); // 100% boost
        // boost = 1000 * 10000 / 10000 = 1000
        assert_eq!(w, 2000);
    }

    #[test]
    fn test_vote_weight_small_boost() {
        let w = calculate_vote_weight(10000, 100, 100); // 1% boost
        // boost = 100 * 100 / 10000 = 1
        assert_eq!(w, 10001);
    }

    #[test]
    fn test_vote_weight_zero_ve_balance() {
        let w = calculate_vote_weight(5000, 0, 10000);
        assert_eq!(w, 5000);
    }

    #[test]
    fn test_vote_weight_zero_multiplier() {
        let w = calculate_vote_weight(5000, 5000, 0);
        assert_eq!(w, 5000);
    }

    // ============ Quorum Tests ============

    #[test]
    fn test_quorum_met() {
        let config = default_config(); // 400 bps = 4%
        let p = make_proposal(1, 300, 200, 100); // 600 total
        // quorum = 10000 * 400 / 10000 = 400
        assert!(check_quorum(&p, &config, 10000));
    }

    #[test]
    fn test_quorum_not_met() {
        let config = default_config();
        let p = make_proposal(1, 100, 50, 0); // 150 total
        // quorum = 10000 * 400 / 10000 = 400
        assert!(!check_quorum(&p, &config, 10000));
    }

    #[test]
    fn test_quorum_exact_threshold() {
        let config = default_config();
        let p = make_proposal(1, 200, 100, 100); // 400 total
        // quorum = 10000 * 400 / 10000 = 400
        assert!(check_quorum(&p, &config, 10000));
    }

    #[test]
    fn test_quorum_zero_supply() {
        let config = default_config();
        let p = make_proposal(1, 100, 0, 0);
        assert!(!check_quorum(&p, &config, 0));
    }

    #[test]
    fn test_quorum_all_abstain() {
        let config = default_config();
        let p = make_proposal(1, 0, 0, 500);
        assert!(check_quorum(&p, &config, 10000));
    }

    #[test]
    fn test_quorum_large_supply() {
        let config = default_config();
        let p = make_proposal(1, 50_000_000, 0, 0);
        // quorum = 1_000_000_000 * 400 / 10000 = 40_000_000
        assert!(check_quorum(&p, &config, 1_000_000_000));
    }

    #[test]
    fn test_quorum_just_below() {
        let config = default_config();
        let p = make_proposal(1, 199, 100, 100); // 399
        assert!(!check_quorum(&p, &config, 10000));
    }

    // ============ Dynamic Quorum Tests ============

    #[test]
    fn test_dynamic_quorum_normal_participation() {
        // 500-2000 bps = base quorum
        let q = calculate_dynamic_quorum(1_000_000, 1000);
        // base 400 bps
        assert_eq!(q, 1_000_000 * 400 / 10000);
    }

    #[test]
    fn test_dynamic_quorum_high_participation() {
        let q = calculate_dynamic_quorum(1_000_000, 3000);
        // High participation reduces quorum
        assert!(q < 1_000_000 * 400 / 10000);
    }

    #[test]
    fn test_dynamic_quorum_low_participation() {
        let q = calculate_dynamic_quorum(1_000_000, 100);
        // Low participation increases quorum
        assert!(q > 1_000_000 * 400 / 10000);
    }

    #[test]
    fn test_dynamic_quorum_zero_supply() {
        let q = calculate_dynamic_quorum(0, 1000);
        assert_eq!(q, 0);
    }

    #[test]
    fn test_dynamic_quorum_max_cap() {
        // Very low participation should cap at 800 bps
        let q = calculate_dynamic_quorum(1_000_000, 0);
        assert!(q <= 1_000_000 * 800 / 10000);
    }

    #[test]
    fn test_dynamic_quorum_min_floor() {
        // Very high participation should floor at 200 bps
        let q = calculate_dynamic_quorum(1_000_000, 9000);
        assert!(q >= 1_000_000 * 200 / 10000);
    }

    // ============ Tally Tests ============

    #[test]
    fn test_tally_basic() {
        let p = make_proposal(1, 500, 300, 200);
        let (f, a, ab) = tally_votes(&p);
        assert_eq!(f, 500);
        assert_eq!(a, 300);
        assert_eq!(ab, 200);
    }

    #[test]
    fn test_tally_all_zeros() {
        let p = make_proposal(1, 0, 0, 0);
        let (f, a, ab) = tally_votes(&p);
        assert_eq!(f, 0);
        assert_eq!(a, 0);
        assert_eq!(ab, 0);
    }

    #[test]
    fn test_tally_only_for() {
        let p = make_proposal(1, 1000, 0, 0);
        let (f, a, ab) = tally_votes(&p);
        assert_eq!(f, 1000);
        assert_eq!(a, 0);
        assert_eq!(ab, 0);
    }

    #[test]
    fn test_tally_only_against() {
        let p = make_proposal(1, 0, 999, 0);
        let (_, a, _) = tally_votes(&p);
        assert_eq!(a, 999);
    }

    // ============ Outcome Tests ============

    #[test]
    fn test_outcome_passed() {
        let config = default_config();
        let p = make_proposal(1, 600, 100, 0); // quorum = 400 for 10000 supply
        let outcome = determine_outcome(&p, &config, 10000);
        assert_eq!(outcome, OUTCOME_PASSED);
    }

    #[test]
    fn test_outcome_failed_more_against() {
        let config = default_config();
        let p = make_proposal(1, 100, 600, 0);
        let outcome = determine_outcome(&p, &config, 10000);
        assert_eq!(outcome, OUTCOME_FAILED);
    }

    #[test]
    fn test_outcome_quorum_not_met() {
        let config = default_config();
        let p = make_proposal(1, 50, 10, 0); // only 60, need 400
        let outcome = determine_outcome(&p, &config, 10000);
        assert_eq!(outcome, OUTCOME_QUORUM_NOT_MET);
    }

    #[test]
    fn test_outcome_not_active() {
        let config = default_config();
        let p = make_proposal_with_status(STATUS_CANCELLED);
        let outcome = determine_outcome(&p, &config, 10000);
        assert_eq!(outcome, OUTCOME_PENDING);
    }

    #[test]
    fn test_outcome_tied_votes_fails() {
        let config = default_config();
        let p = make_proposal(1, 300, 300, 0); // tie, quorum met
        let outcome = determine_outcome(&p, &config, 10000);
        assert_eq!(outcome, OUTCOME_FAILED); // for must be strictly greater
    }

    #[test]
    fn test_outcome_passed_with_abstain() {
        let config = default_config();
        let p = make_proposal(1, 300, 100, 200); // 600 total, for > against
        let outcome = determine_outcome(&p, &config, 10000);
        assert_eq!(outcome, OUTCOME_PASSED);
    }

    // ============ Timelock Tests ============

    #[test]
    fn test_queue_for_execution_success() {
        let config = default_config();
        let p = make_proposal(1, 500, 100, 0);
        let result = queue_for_execution(&p, &config, 1200);
        assert!(result.is_ok());
        let entry = result.unwrap();
        assert_eq!(entry.execute_after, 1200 + config.timelock_delay_blocks);
        assert_eq!(entry.execute_before, 1200 + config.timelock_delay_blocks + config.grace_period_blocks);
    }

    #[test]
    fn test_queue_failed_proposal() {
        let config = default_config();
        let p = make_proposal(1, 100, 500, 0); // against > for
        let result = queue_for_execution(&p, &config, 1200);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("did not pass"));
    }

    #[test]
    fn test_queue_cancelled_proposal() {
        let config = default_config();
        let p = make_proposal_with_status(STATUS_CANCELLED);
        let result = queue_for_execution(&p, &config, 1200);
        assert!(result.is_err());
    }

    #[test]
    fn test_execute_success() {
        let entry = make_timelock(1, 1000, 1500);
        let result = execute_proposal(&entry, 1200);
        assert!(result.is_ok());
        assert!(result.unwrap());
    }

    #[test]
    fn test_execute_too_early() {
        let entry = make_timelock(1, 1000, 1500);
        let result = execute_proposal(&entry, 900);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not expired"));
    }

    #[test]
    fn test_execute_grace_period_expired() {
        let entry = make_timelock(1, 1000, 1500);
        let result = execute_proposal(&entry, 1600);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Grace period"));
    }

    #[test]
    fn test_execute_already_executed() {
        let mut entry = make_timelock(1, 1000, 1500);
        entry.executed = true;
        let result = execute_proposal(&entry, 1200);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("already executed"));
    }

    #[test]
    fn test_execute_at_exact_start() {
        let entry = make_timelock(1, 1000, 1500);
        let result = execute_proposal(&entry, 1000);
        assert!(result.is_ok());
    }

    #[test]
    fn test_execute_at_exact_end() {
        let entry = make_timelock(1, 1000, 1500);
        let result = execute_proposal(&entry, 1500);
        assert!(result.is_ok());
    }

    #[test]
    fn test_is_in_timelock_true() {
        let entry = make_timelock(1, 1000, 1500);
        assert!(is_in_timelock(&entry, 1200));
    }

    #[test]
    fn test_is_in_timelock_false_early() {
        let entry = make_timelock(1, 1000, 1500);
        assert!(!is_in_timelock(&entry, 800));
    }

    #[test]
    fn test_is_in_timelock_false_late() {
        let entry = make_timelock(1, 1000, 1500);
        assert!(!is_in_timelock(&entry, 1600));
    }

    #[test]
    fn test_is_in_timelock_false_executed() {
        let mut entry = make_timelock(1, 1000, 1500);
        entry.executed = true;
        assert!(!is_in_timelock(&entry, 1200));
    }

    #[test]
    fn test_is_expired_true() {
        let entry = make_timelock(1, 1000, 1500);
        assert!(is_expired(&entry, 1501));
    }

    #[test]
    fn test_is_expired_false_in_window() {
        let entry = make_timelock(1, 1000, 1500);
        assert!(!is_expired(&entry, 1200));
    }

    #[test]
    fn test_is_expired_false_executed() {
        let mut entry = make_timelock(1, 1000, 1500);
        entry.executed = true;
        assert!(!is_expired(&entry, 2000));
    }

    // ============ Delegation Tests ============

    #[test]
    fn test_delegate_success() {
        let result = delegate_votes(1, 2, 1000, 0);
        assert!(result.is_ok());
        let d = result.unwrap();
        assert_eq!(d.delegator, 1);
        assert_eq!(d.delegatee, 2);
        assert_eq!(d.amount, 1000);
    }

    #[test]
    fn test_delegate_self() {
        let result = delegate_votes(1, 1, 1000, 0);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("self"));
    }

    #[test]
    fn test_delegate_zero_amount() {
        let result = delegate_votes(1, 2, 0, 0);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("zero"));
    }

    #[test]
    fn test_delegate_with_expiry() {
        let d = delegate_votes(1, 2, 1000, 99999).unwrap();
        assert_eq!(d.expires_at, 99999);
    }

    #[test]
    fn test_delegated_power_single() {
        let delegations = vec![
            DelegationRecord { delegator: 1, delegatee: 2, amount: 500, expires_at: 0 },
        ];
        assert_eq!(calculate_delegated_power(&delegations, 2), 500);
    }

    #[test]
    fn test_delegated_power_multiple() {
        let delegations = vec![
            DelegationRecord { delegator: 1, delegatee: 3, amount: 500, expires_at: 0 },
            DelegationRecord { delegator: 2, delegatee: 3, amount: 300, expires_at: 0 },
        ];
        assert_eq!(calculate_delegated_power(&delegations, 3), 800);
    }

    #[test]
    fn test_delegated_power_no_match() {
        let delegations = vec![
            DelegationRecord { delegator: 1, delegatee: 2, amount: 500, expires_at: 0 },
        ];
        assert_eq!(calculate_delegated_power(&delegations, 99), 0);
    }

    #[test]
    fn test_delegated_power_empty() {
        let delegations: Vec<DelegationRecord> = vec![];
        assert_eq!(calculate_delegated_power(&delegations, 1), 0);
    }

    // ============ Split Delegation Tests ============

    #[test]
    fn test_split_delegation_success() {
        let result = split_delegation(1, &[2, 3, 4], &[100, 200, 300]);
        assert!(result.is_ok());
        let records = result.unwrap();
        assert_eq!(records.len(), 3);
        assert_eq!(records[0].delegatee, 2);
        assert_eq!(records[0].amount, 100);
        assert_eq!(records[2].amount, 300);
    }

    #[test]
    fn test_split_delegation_length_mismatch() {
        let result = split_delegation(1, &[2, 3], &[100]);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("same length"));
    }

    #[test]
    fn test_split_delegation_empty() {
        let result = split_delegation(1, &[], &[]);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("at least one"));
    }

    #[test]
    fn test_split_delegation_self_in_list() {
        let result = split_delegation(1, &[1, 2], &[100, 200]);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("self"));
    }

    #[test]
    fn test_split_delegation_zero_amount_in_list() {
        let result = split_delegation(1, &[2, 3], &[100, 0]);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("zero"));
    }

    #[test]
    fn test_split_delegation_single_delegatee() {
        let result = split_delegation(1, &[2], &[500]);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().len(), 1);
    }

    // ============ Effective Voting Power Tests ============

    #[test]
    fn test_effective_power_no_boost() {
        let p = get_effective_voting_power(1000, 500, 0);
        assert_eq!(p, 1500);
    }

    #[test]
    fn test_effective_power_with_boost() {
        let p = get_effective_voting_power(1000, 500, 2000); // 20% boost
        // base = 1500, boost = 1500 * 2000 / 10000 = 300
        assert_eq!(p, 1800);
    }

    #[test]
    fn test_effective_power_zero_balance() {
        let p = get_effective_voting_power(0, 0, 5000);
        assert_eq!(p, 0);
    }

    #[test]
    fn test_effective_power_only_delegated() {
        let p = get_effective_voting_power(0, 1000, 0);
        assert_eq!(p, 1000);
    }

    #[test]
    fn test_effective_power_100_pct_boost() {
        let p = get_effective_voting_power(1000, 0, 10000);
        // base = 1000, boost = 1000 * 10000 / 10000 = 1000
        assert_eq!(p, 2000);
    }

    // ============ Early Voter Bonus Tests ============

    #[test]
    fn test_early_bonus_at_start() {
        let incentive = VoteIncentive {
            proposal_id: 1,
            total_reward: 10000,
            reward_per_vote: 100,
            early_bonus_bps: 2000, // 20%
            early_cutoff_block: 200,
        };
        let bonus = calculate_early_voter_bonus(&incentive, 100, 100);
        assert_eq!(bonus, 2000); // full bonus
    }

    #[test]
    fn test_early_bonus_at_midpoint() {
        let incentive = VoteIncentive {
            proposal_id: 1,
            total_reward: 10000,
            reward_per_vote: 100,
            early_bonus_bps: 2000,
            early_cutoff_block: 200,
        };
        let bonus = calculate_early_voter_bonus(&incentive, 150, 100);
        // window=100, elapsed=50, remaining=50, bonus = 2000 * 50 / 100 = 1000
        assert_eq!(bonus, 1000);
    }

    #[test]
    fn test_early_bonus_after_cutoff() {
        let incentive = VoteIncentive {
            proposal_id: 1,
            total_reward: 10000,
            reward_per_vote: 100,
            early_bonus_bps: 2000,
            early_cutoff_block: 200,
        };
        let bonus = calculate_early_voter_bonus(&incentive, 250, 100);
        assert_eq!(bonus, 0);
    }

    #[test]
    fn test_early_bonus_before_proposal_start() {
        let incentive = VoteIncentive {
            proposal_id: 1,
            total_reward: 10000,
            reward_per_vote: 100,
            early_bonus_bps: 2000,
            early_cutoff_block: 200,
        };
        let bonus = calculate_early_voter_bonus(&incentive, 50, 100);
        assert_eq!(bonus, 0);
    }

    #[test]
    fn test_early_bonus_at_cutoff_exact() {
        let incentive = VoteIncentive {
            proposal_id: 1,
            total_reward: 10000,
            reward_per_vote: 100,
            early_bonus_bps: 2000,
            early_cutoff_block: 200,
        };
        let bonus = calculate_early_voter_bonus(&incentive, 200, 100);
        // remaining = 0, bonus = 0
        assert_eq!(bonus, 0);
    }

    #[test]
    fn test_early_bonus_one_block_before_cutoff() {
        let incentive = VoteIncentive {
            proposal_id: 1,
            total_reward: 10000,
            reward_per_vote: 100,
            early_bonus_bps: 1000,
            early_cutoff_block: 200,
        };
        let bonus = calculate_early_voter_bonus(&incentive, 199, 100);
        // window=100, elapsed=99, remaining=1, bonus = 1000 * 1 / 100 = 10
        assert_eq!(bonus, 10);
    }

    // ============ Vote Reward Distribution Tests ============

    #[test]
    fn test_distribute_rewards_basic() {
        let incentive = VoteIncentive {
            proposal_id: 1,
            total_reward: 1000,
            reward_per_vote: 0,
            early_bonus_bps: 0,
            early_cutoff_block: 0,
        };
        let voters = vec![(1, 100), (2, 101), (3, 102)];
        let rewards = distribute_vote_rewards(&incentive, &voters);
        assert_eq!(rewards.len(), 3);
        // 1000 / 3 = 333 each
        assert_eq!(rewards[0].1, 333);
    }

    #[test]
    fn test_distribute_rewards_empty_voters() {
        let incentive = VoteIncentive {
            proposal_id: 1,
            total_reward: 1000,
            reward_per_vote: 0,
            early_bonus_bps: 0,
            early_cutoff_block: 0,
        };
        let rewards = distribute_vote_rewards(&incentive, &[]);
        assert!(rewards.is_empty());
    }

    #[test]
    fn test_distribute_rewards_zero_reward() {
        let incentive = VoteIncentive {
            proposal_id: 1,
            total_reward: 0,
            reward_per_vote: 0,
            early_bonus_bps: 0,
            early_cutoff_block: 0,
        };
        let voters = vec![(1, 100)];
        let rewards = distribute_vote_rewards(&incentive, &voters);
        assert!(rewards.is_empty());
    }

    #[test]
    fn test_distribute_rewards_single_voter() {
        let incentive = VoteIncentive {
            proposal_id: 1,
            total_reward: 500,
            reward_per_vote: 0,
            early_bonus_bps: 0,
            early_cutoff_block: 0,
        };
        let voters = vec![(42, 100)];
        let rewards = distribute_vote_rewards(&incentive, &voters);
        assert_eq!(rewards.len(), 1);
        assert_eq!(rewards[0], (42, 500));
    }

    // ============ Quadratic Voting Tests ============

    #[test]
    fn test_quadratic_cost_zero() {
        assert_eq!(quadratic_vote_cost(0), 0);
    }

    #[test]
    fn test_quadratic_cost_one() {
        assert_eq!(quadratic_vote_cost(1), 1);
    }

    #[test]
    fn test_quadratic_cost_two() {
        assert_eq!(quadratic_vote_cost(2), 4);
    }

    #[test]
    fn test_quadratic_cost_ten() {
        assert_eq!(quadratic_vote_cost(10), 100);
    }

    #[test]
    fn test_quadratic_cost_hundred() {
        assert_eq!(quadratic_vote_cost(100), 10000);
    }

    #[test]
    fn test_quadratic_cost_large() {
        assert_eq!(quadratic_vote_cost(1000), 1_000_000);
    }

    #[test]
    fn test_quadratic_cost_three() {
        assert_eq!(quadratic_vote_cost(3), 9);
    }

    // ============ Proposal Threshold Tests ============

    #[test]
    fn test_threshold_met() {
        let config = default_config();
        assert!(check_proposal_threshold(2000, &config));
    }

    #[test]
    fn test_threshold_exact() {
        let config = default_config();
        assert!(check_proposal_threshold(1000, &config));
    }

    #[test]
    fn test_threshold_not_met() {
        let config = default_config();
        assert!(!check_proposal_threshold(999, &config));
    }

    #[test]
    fn test_threshold_zero() {
        let config = default_config();
        assert!(!check_proposal_threshold(0, &config));
    }

    // ============ Voting Active Tests ============

    #[test]
    fn test_voting_active_true() {
        let p = make_proposal(1, 0, 0, 0);
        assert!(is_voting_active(&p, 500));
    }

    #[test]
    fn test_voting_active_before_start() {
        let p = make_proposal(1, 0, 0, 0);
        assert!(!is_voting_active(&p, 50));
    }

    #[test]
    fn test_voting_active_after_end() {
        let p = make_proposal(1, 0, 0, 0);
        assert!(!is_voting_active(&p, 2000));
    }

    #[test]
    fn test_voting_active_not_active_status() {
        let p = make_proposal_with_status(STATUS_CANCELLED);
        assert!(!is_voting_active(&p, 500));
    }

    #[test]
    fn test_voting_active_at_start() {
        let p = make_proposal(1, 0, 0, 0);
        assert!(is_voting_active(&p, 100));
    }

    #[test]
    fn test_voting_active_at_end() {
        let p = make_proposal(1, 0, 0, 0);
        assert!(is_voting_active(&p, 1100));
    }

    // ============ Validate Proposal Type Tests ============

    #[test]
    fn test_validate_type_parameter_change() {
        assert!(validate_proposal_type(PROPOSAL_PARAMETER_CHANGE).is_ok());
    }

    #[test]
    fn test_validate_type_treasury_spend() {
        assert!(validate_proposal_type(PROPOSAL_TREASURY_SPEND).is_ok());
    }

    #[test]
    fn test_validate_type_emergency() {
        assert!(validate_proposal_type(PROPOSAL_EMERGENCY_ACTION).is_ok());
    }

    #[test]
    fn test_validate_type_upgrade() {
        assert!(validate_proposal_type(PROPOSAL_UPGRADE).is_ok());
    }

    #[test]
    fn test_validate_type_invalid() {
        assert!(validate_proposal_type(10).is_err());
    }

    #[test]
    fn test_validate_type_max_u8() {
        assert!(validate_proposal_type(255).is_err());
    }

    // ============ Participation Rate Tests ============

    #[test]
    fn test_participation_rate_half() {
        let rate = calculate_participation_rate(5000, 10000);
        assert_eq!(rate, 5000); // 50%
    }

    #[test]
    fn test_participation_rate_all() {
        let rate = calculate_participation_rate(10000, 10000);
        assert_eq!(rate, 10000); // 100%
    }

    #[test]
    fn test_participation_rate_zero_votes() {
        let rate = calculate_participation_rate(0, 10000);
        assert_eq!(rate, 0);
    }

    #[test]
    fn test_participation_rate_zero_supply() {
        let rate = calculate_participation_rate(100, 0);
        assert_eq!(rate, 0);
    }

    #[test]
    fn test_participation_rate_small() {
        let rate = calculate_participation_rate(1, 10000);
        assert_eq!(rate, 1); // 0.01%
    }

    // ============ Proposal Stats Tests ============

    #[test]
    fn test_stats_empty() {
        let stats = get_proposal_stats(&[]);
        assert_eq!(stats.total_proposals, 0);
        assert_eq!(stats.passed, 0);
        assert_eq!(stats.failed, 0);
    }

    #[test]
    fn test_stats_mixed() {
        let proposals = vec![
            make_proposal_with_status(STATUS_EXECUTED),
            make_proposal_with_status(STATUS_FAILED),
            make_proposal_with_status(STATUS_EXPIRED),
            make_proposal_with_status(STATUS_CANCELLED),
        ];
        let stats = get_proposal_stats(&proposals);
        assert_eq!(stats.total_proposals, 4);
        assert_eq!(stats.passed, 1); // EXECUTED counts as passed
        assert_eq!(stats.failed, 1);
        assert_eq!(stats.expired, 1);
        assert_eq!(stats.cancelled, 1);
    }

    #[test]
    fn test_stats_all_passed() {
        let proposals = vec![
            make_proposal_with_status(STATUS_PASSED),
            make_proposal_with_status(STATUS_PASSED),
            make_proposal_with_status(STATUS_EXECUTED),
        ];
        let stats = get_proposal_stats(&proposals);
        assert_eq!(stats.passed, 3);
    }

    #[test]
    fn test_stats_single_proposal() {
        let proposals = vec![make_proposal_with_status(STATUS_FAILED)];
        let stats = get_proposal_stats(&proposals);
        assert_eq!(stats.total_proposals, 1);
        assert_eq!(stats.failed, 1);
    }

    // ============ Power Concentration Tests ============

    #[test]
    fn test_concentration_single_voter() {
        // One voter holds everything -> HHI = 10000 bps (maximum)
        let hhi = calculate_power_concentration(&[1000], 1000);
        assert_eq!(hhi, 10000);
    }

    #[test]
    fn test_concentration_equal_two_voters() {
        // Two equal voters: each 50% -> HHI = 5000^2 * 2 / 10000 = 5000
        let hhi = calculate_power_concentration(&[500, 500], 1000);
        assert_eq!(hhi, 5000);
    }

    #[test]
    fn test_concentration_equal_four_voters() {
        // Four equal voters: each 25% -> HHI = 2500^2 * 4 / 10000 = 2500
        let hhi = calculate_power_concentration(&[250, 250, 250, 250], 1000);
        assert_eq!(hhi, 2500);
    }

    #[test]
    fn test_concentration_zero_total() {
        let hhi = calculate_power_concentration(&[100], 0);
        assert_eq!(hhi, 0);
    }

    #[test]
    fn test_concentration_empty_voters() {
        let hhi = calculate_power_concentration(&[], 1000);
        assert_eq!(hhi, 0);
    }

    #[test]
    fn test_concentration_highly_concentrated() {
        // One big voter + many small: 900 + 10*10 = 1000
        let weights: Vec<u128> = std::iter::once(900).chain(std::iter::repeat(10).take(10)).collect();
        let hhi = calculate_power_concentration(&weights, 1000);
        // 9000^2 + 10*(100^2) = 81_000_000 + 100_000 = 81_100_000 / 10000 = 8110
        assert_eq!(hhi, 8110);
    }

    #[test]
    fn test_concentration_ten_equal_voters() {
        let weights = vec![100u128; 10];
        let hhi = calculate_power_concentration(&weights, 1000);
        // each share = 1000 bps, 10 * 1000^2 / 10000 = 1000
        assert_eq!(hhi, 1000);
    }

    // ============ Vote Buying Detection Tests ============

    #[test]
    fn test_detect_vote_buying_none() {
        let votes = vec![
            Vote { voter: 1, proposal_id: 1, support: VOTE_FOR, weight: 100, timestamp: 0 },
            Vote { voter: 2, proposal_id: 1, support: VOTE_FOR, weight: 100, timestamp: 0 },
        ];
        let suspicious = detect_vote_buying(&votes, 60);
        assert!(suspicious.is_empty());
    }

    #[test]
    fn test_detect_vote_buying_one_large() {
        let votes = vec![
            Vote { voter: 1, proposal_id: 1, support: VOTE_FOR, weight: 900, timestamp: 0 },
            Vote { voter: 2, proposal_id: 1, support: VOTE_FOR, weight: 100, timestamp: 0 },
        ];
        // total = 1000, threshold = 50% = 500. voter 1 has 900 > 500
        let suspicious = detect_vote_buying(&votes, 50);
        assert_eq!(suspicious, vec![1]);
    }

    #[test]
    fn test_detect_vote_buying_empty() {
        let suspicious = detect_vote_buying(&[], 50);
        assert!(suspicious.is_empty());
    }

    #[test]
    fn test_detect_vote_buying_zero_threshold() {
        let votes = vec![
            Vote { voter: 1, proposal_id: 1, support: VOTE_FOR, weight: 100, timestamp: 0 },
        ];
        let suspicious = detect_vote_buying(&votes, 0);
        assert!(suspicious.is_empty());
    }

    #[test]
    fn test_detect_vote_buying_all_suspicious() {
        let votes = vec![
            Vote { voter: 1, proposal_id: 1, support: VOTE_FOR, weight: 600, timestamp: 0 },
            Vote { voter: 2, proposal_id: 1, support: VOTE_FOR, weight: 500, timestamp: 0 },
        ];
        // total = 1100, threshold 40% = 440
        let suspicious = detect_vote_buying(&votes, 40);
        assert_eq!(suspicious.len(), 2);
    }

    // ============ Cancel Proposal Tests ============

    #[test]
    fn test_cancel_by_proposer() {
        let p = make_proposal(1, 0, 0, 0);
        let config = default_config();
        let result = cancel_proposal(&p, 1, 2000, &config); // proposer=1
        assert!(result.is_ok());
        assert_eq!(result.unwrap().status, STATUS_CANCELLED);
    }

    #[test]
    fn test_cancel_proposer_below_threshold() {
        let p = make_proposal(1, 0, 0, 0);
        let config = default_config();
        // Non-proposer can cancel if proposer balance is below threshold
        let result = cancel_proposal(&p, 99, 500, &config);
        assert!(result.is_ok());
    }

    #[test]
    fn test_cancel_unauthorized() {
        let p = make_proposal(1, 0, 0, 0);
        let config = default_config();
        // Non-proposer, proposer still has enough balance
        let result = cancel_proposal(&p, 99, 2000, &config);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Not authorized"));
    }

    #[test]
    fn test_cancel_already_executed() {
        let p = make_proposal_with_status(STATUS_EXECUTED);
        let config = default_config();
        let result = cancel_proposal(&p, 1, 2000, &config);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("executed"));
    }

    #[test]
    fn test_cancel_already_cancelled() {
        let p = make_proposal_with_status(STATUS_CANCELLED);
        let config = default_config();
        let result = cancel_proposal(&p, 1, 2000, &config);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("already cancelled"));
    }

    // ============ Expire Proposal Tests ============

    #[test]
    fn test_expire_after_end() {
        let p = make_proposal(1, 0, 0, 0);
        let result = expire_proposal(&p, 2000);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().status, STATUS_EXPIRED);
    }

    #[test]
    fn test_expire_before_end() {
        let p = make_proposal(1, 0, 0, 0);
        let result = expire_proposal(&p, 500);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not yet ended"));
    }

    #[test]
    fn test_expire_not_active() {
        let p = make_proposal_with_status(STATUS_CANCELLED);
        let result = expire_proposal(&p, 2000);
        assert!(result.is_err());
    }

    // ============ Default Config Tests ============

    #[test]
    fn test_default_config_voting_delay() {
        let c = default_config();
        assert_eq!(c.voting_delay_blocks, 100);
    }

    #[test]
    fn test_default_config_voting_period() {
        let c = default_config();
        assert_eq!(c.voting_period_blocks, 1000);
    }

    #[test]
    fn test_default_config_quorum() {
        let c = default_config();
        assert_eq!(c.quorum_bps, 400);
    }

    #[test]
    fn test_default_config_timelock() {
        let c = default_config();
        assert_eq!(c.timelock_delay_blocks, 200);
    }

    #[test]
    fn test_default_config_grace() {
        let c = default_config();
        assert_eq!(c.grace_period_blocks, 500);
    }

    #[test]
    fn test_default_config_threshold() {
        let c = default_config();
        assert_eq!(c.proposal_threshold, 1000);
    }

    // ============ Quorum State Tests ============

    #[test]
    fn test_create_quorum_state() {
        let config = default_config();
        let qs = create_quorum_state(100_000, 5_000, &config);
        assert_eq!(qs.total_supply, 100_000);
        assert_eq!(qs.total_votes_cast, 5_000);
        assert_eq!(qs.quorum_threshold, 100_000 * 400 / 10000);
    }

    #[test]
    fn test_quorum_state_participation_rate() {
        let config = default_config();
        let qs = create_quorum_state(10000, 5000, &config);
        assert_eq!(qs.participation_rate_bps, 5000);
    }

    #[test]
    fn test_quorum_state_zero_supply() {
        let config = default_config();
        let qs = create_quorum_state(0, 0, &config);
        assert_eq!(qs.quorum_threshold, 0);
        assert_eq!(qs.participation_rate_bps, 0);
    }

    // ============ Total Votes Tests ============

    #[test]
    fn test_total_votes_sum() {
        let p = make_proposal(1, 100, 200, 300);
        assert_eq!(total_votes(&p), 600);
    }

    #[test]
    fn test_total_votes_zero() {
        let p = make_proposal(1, 0, 0, 0);
        assert_eq!(total_votes(&p), 0);
    }

    // ============ Has Passed Tests ============

    #[test]
    fn test_has_passed_true() {
        let p = make_proposal(1, 500, 400, 0);
        assert!(has_passed(&p));
    }

    #[test]
    fn test_has_passed_false() {
        let p = make_proposal(1, 400, 500, 0);
        assert!(!has_passed(&p));
    }

    #[test]
    fn test_has_passed_tie() {
        let p = make_proposal(1, 500, 500, 0);
        assert!(!has_passed(&p));
    }

    // ============ Vote Margin Tests ============

    #[test]
    fn test_vote_margin_positive() {
        let p = make_proposal(1, 700, 300, 0);
        assert_eq!(vote_margin(&p), 400);
    }

    #[test]
    fn test_vote_margin_negative() {
        let p = make_proposal(1, 200, 800, 0);
        assert_eq!(vote_margin(&p), -600);
    }

    #[test]
    fn test_vote_margin_zero() {
        let p = make_proposal(1, 500, 500, 0);
        assert_eq!(vote_margin(&p), 0);
    }

    // ============ Filter Active Delegations Tests ============

    #[test]
    fn test_filter_active_no_expiry() {
        let delegations = vec![
            DelegationRecord { delegator: 1, delegatee: 2, amount: 100, expires_at: 0 },
        ];
        let active = filter_active_delegations(&delegations, 99999);
        assert_eq!(active.len(), 1);
    }

    #[test]
    fn test_filter_active_not_expired() {
        let delegations = vec![
            DelegationRecord { delegator: 1, delegatee: 2, amount: 100, expires_at: 1000 },
        ];
        let active = filter_active_delegations(&delegations, 500);
        assert_eq!(active.len(), 1);
    }

    #[test]
    fn test_filter_active_expired() {
        let delegations = vec![
            DelegationRecord { delegator: 1, delegatee: 2, amount: 100, expires_at: 1000 },
        ];
        let active = filter_active_delegations(&delegations, 2000);
        assert_eq!(active.len(), 0);
    }

    #[test]
    fn test_filter_active_mixed() {
        let delegations = vec![
            DelegationRecord { delegator: 1, delegatee: 2, amount: 100, expires_at: 1000 },
            DelegationRecord { delegator: 3, delegatee: 4, amount: 200, expires_at: 0 },
            DelegationRecord { delegator: 5, delegatee: 6, amount: 300, expires_at: 500 },
        ];
        let active = filter_active_delegations(&delegations, 800);
        assert_eq!(active.len(), 2); // first + second (no expiry)
    }

    // ============ Total Delegated Tests ============

    #[test]
    fn test_total_delegated_single() {
        let delegations = vec![
            DelegationRecord { delegator: 1, delegatee: 2, amount: 500, expires_at: 0 },
        ];
        assert_eq!(calculate_total_delegated(&delegations, 1), 500);
    }

    #[test]
    fn test_total_delegated_multiple() {
        let delegations = vec![
            DelegationRecord { delegator: 1, delegatee: 2, amount: 300, expires_at: 0 },
            DelegationRecord { delegator: 1, delegatee: 3, amount: 200, expires_at: 0 },
        ];
        assert_eq!(calculate_total_delegated(&delegations, 1), 500);
    }

    #[test]
    fn test_total_delegated_none() {
        let delegations = vec![
            DelegationRecord { delegator: 2, delegatee: 3, amount: 100, expires_at: 0 },
        ];
        assert_eq!(calculate_total_delegated(&delegations, 1), 0);
    }

    // ============ Emergency Type Tests ============

    #[test]
    fn test_is_emergency_true() {
        assert!(is_proposal_type_emergency(PROPOSAL_EMERGENCY_ACTION));
    }

    #[test]
    fn test_is_emergency_false() {
        assert!(!is_proposal_type_emergency(PROPOSAL_PARAMETER_CHANGE));
    }

    #[test]
    fn test_is_emergency_false_treasury() {
        assert!(!is_proposal_type_emergency(PROPOSAL_TREASURY_SPEND));
    }

    // ============ Remaining Blocks Tests ============

    #[test]
    fn test_remaining_blocks_during_voting() {
        let p = make_proposal(1, 0, 0, 0); // end_block = 1100
        assert_eq!(calculate_remaining_voting_blocks(&p, 500), 600);
    }

    #[test]
    fn test_remaining_blocks_after_end() {
        let p = make_proposal(1, 0, 0, 0);
        assert_eq!(calculate_remaining_voting_blocks(&p, 2000), 0);
    }

    #[test]
    fn test_remaining_blocks_at_end() {
        let p = make_proposal(1, 0, 0, 0);
        assert_eq!(calculate_remaining_voting_blocks(&p, 1100), 0);
    }

    // ============ Voting Progress Tests ============

    #[test]
    fn test_progress_at_start() {
        let p = make_proposal(1, 0, 0, 0); // start=100, end=1100
        assert_eq!(calculate_voting_progress_bps(&p, 100), 0);
    }

    #[test]
    fn test_progress_at_midpoint() {
        let p = make_proposal(1, 0, 0, 0); // start=100, end=1100, period=1000
        let progress = calculate_voting_progress_bps(&p, 600);
        // elapsed=500, period=1000 -> 5000 bps
        assert_eq!(progress, 5000);
    }

    #[test]
    fn test_progress_at_end() {
        let p = make_proposal(1, 0, 0, 0);
        assert_eq!(calculate_voting_progress_bps(&p, 1100), 10000);
    }

    #[test]
    fn test_progress_after_end() {
        let p = make_proposal(1, 0, 0, 0);
        assert_eq!(calculate_voting_progress_bps(&p, 5000), 10000);
    }

    #[test]
    fn test_progress_before_start() {
        let p = make_proposal(1, 0, 0, 0);
        assert_eq!(calculate_voting_progress_bps(&p, 50), 0);
    }

    // ============ Full Lifecycle Tests ============

    #[test]
    fn test_full_lifecycle_create_vote_pass_queue_execute() {
        let config = default_config();
        let mut proposal = create_proposal(
            &config, 1, default_title_hash(), default_desc_hash(),
            PROPOSAL_PARAMETER_CHANGE, 0, 5000,
        ).unwrap();

        // Cast votes to pass
        let vote_block = proposal.start_block + 10;
        cast_vote(&mut proposal, 10, VOTE_FOR, 3000, vote_block).unwrap();
        cast_vote(&mut proposal, 11, VOTE_AGAINST, 500, vote_block + 1).unwrap();

        // Verify quorum and outcome
        assert!(check_quorum(&proposal, &config, 10000));
        assert_eq!(determine_outcome(&proposal, &config, 10000), OUTCOME_PASSED);

        // Queue
        let entry = queue_for_execution(&proposal, &config, proposal.end_block + 1).unwrap();
        assert!(!entry.executed);

        // Execute at correct time
        let result = execute_proposal(&entry, entry.execute_after + 1);
        assert!(result.is_ok());
    }

    #[test]
    fn test_full_lifecycle_create_vote_fail() {
        let config = default_config();
        let mut proposal = create_proposal(
            &config, 1, default_title_hash(), default_desc_hash(),
            PROPOSAL_PARAMETER_CHANGE, 0, 5000,
        ).unwrap();

        let vote_block = proposal.start_block + 10;
        cast_vote(&mut proposal, 10, VOTE_AGAINST, 3000, vote_block).unwrap();
        cast_vote(&mut proposal, 11, VOTE_FOR, 500, vote_block + 1).unwrap();

        assert_eq!(determine_outcome(&proposal, &config, 10000), OUTCOME_FAILED);
    }

    #[test]
    fn test_full_lifecycle_quorum_not_met() {
        let config = default_config();
        let mut proposal = create_proposal(
            &config, 1, default_title_hash(), default_desc_hash(),
            PROPOSAL_PARAMETER_CHANGE, 0, 5000,
        ).unwrap();

        let vote_block = proposal.start_block + 10;
        cast_vote(&mut proposal, 10, VOTE_FOR, 50, vote_block).unwrap();

        assert_eq!(determine_outcome(&proposal, &config, 100000), OUTCOME_QUORUM_NOT_MET);
    }

    #[test]
    fn test_full_lifecycle_cancel_during_voting() {
        let config = default_config();
        let proposal = create_proposal(
            &config, 1, default_title_hash(), default_desc_hash(),
            PROPOSAL_PARAMETER_CHANGE, 0, 5000,
        ).unwrap();

        let cancelled = cancel_proposal(&proposal, 1, 5000, &config).unwrap();
        assert_eq!(cancelled.status, STATUS_CANCELLED);
    }

    #[test]
    fn test_full_lifecycle_expire_without_execution() {
        let config = default_config();
        let proposal = create_proposal(
            &config, 1, default_title_hash(), default_desc_hash(),
            PROPOSAL_PARAMETER_CHANGE, 0, 5000,
        ).unwrap();

        let expired = expire_proposal(&proposal, proposal.end_block + 1).unwrap();
        assert_eq!(expired.status, STATUS_EXPIRED);
    }

    #[test]
    fn test_lifecycle_timelock_too_early_then_success() {
        let config = default_config();
        let mut proposal = create_proposal(
            &config, 1, default_title_hash(), default_desc_hash(),
            PROPOSAL_PARAMETER_CHANGE, 0, 5000,
        ).unwrap();

        let vote_block = proposal.start_block + 1;
        cast_vote(&mut proposal, 10, VOTE_FOR, 1000, vote_block).unwrap();

        let after_end = proposal.end_block + 1;
        let entry = queue_for_execution(&proposal, &config, after_end).unwrap();

        // Too early
        let early = execute_proposal(&entry, entry.execute_after - 1);
        assert!(early.is_err());

        // Just right
        let ok = execute_proposal(&entry, entry.execute_after);
        assert!(ok.is_ok());
    }

    #[test]
    fn test_lifecycle_grace_period_expired() {
        let config = default_config();
        let mut proposal = create_proposal(
            &config, 1, default_title_hash(), default_desc_hash(),
            PROPOSAL_PARAMETER_CHANGE, 0, 5000,
        ).unwrap();

        let vote_block = proposal.start_block + 1;
        cast_vote(&mut proposal, 10, VOTE_FOR, 1000, vote_block).unwrap();

        let after_end = proposal.end_block + 1;
        let entry = queue_for_execution(&proposal, &config, after_end).unwrap();

        let expired = execute_proposal(&entry, entry.execute_before + 1);
        assert!(expired.is_err());
    }

    // ============ Delegation Chain Tests ============

    #[test]
    fn test_delegation_chain_a_to_b_to_c() {
        let d1 = delegate_votes(1, 2, 500, 0).unwrap();
        let d2 = delegate_votes(2, 3, 300, 0).unwrap();
        let delegations = vec![d1, d2];
        assert_eq!(calculate_delegated_power(&delegations, 3), 300);
        assert_eq!(calculate_delegated_power(&delegations, 2), 500);
    }

    #[test]
    fn test_delegation_power_aggregation() {
        let delegations = vec![
            delegate_votes(1, 5, 100, 0).unwrap(),
            delegate_votes(2, 5, 200, 0).unwrap(),
            delegate_votes(3, 5, 300, 0).unwrap(),
            delegate_votes(4, 5, 400, 0).unwrap(),
        ];
        assert_eq!(calculate_delegated_power(&delegations, 5), 1000);
    }

    // ============ Edge Case Tests ============

    #[test]
    fn test_edge_case_max_u128_votes() {
        let p = make_proposal(1, u128::MAX / 3, u128::MAX / 3, u128::MAX / 3);
        let (f, a, ab) = tally_votes(&p);
        assert_eq!(f, u128::MAX / 3);
        assert_eq!(a, u128::MAX / 3);
        assert_eq!(ab, u128::MAX / 3);
    }

    #[test]
    fn test_edge_case_single_voter_decides() {
        let config = default_config();
        let mut p = make_proposal(1, 0, 0, 0);
        cast_vote(&mut p, 1, VOTE_FOR, 500, 200).unwrap();
        assert_eq!(determine_outcome(&p, &config, 10000), OUTCOME_PASSED);
    }

    #[test]
    fn test_edge_case_zero_supply_quorum() {
        let config = default_config();
        let p = make_proposal(1, 100, 0, 0);
        assert!(!check_quorum(&p, &config, 0));
    }

    #[test]
    fn test_edge_case_proposal_id_matches_block() {
        let config = default_config();
        let p = create_proposal(&config, 1, default_title_hash(), default_desc_hash(), PROPOSAL_PARAMETER_CHANGE, 42, 5000).unwrap();
        assert_eq!(p.id, 42);
    }

    #[test]
    fn test_edge_case_all_abstain_passes_quorum() {
        let config = default_config();
        let p = make_proposal(1, 0, 0, 500);
        // Quorum is met by abstain votes
        assert!(check_quorum(&p, &config, 10000));
        // But outcome is failed because for <= against (0 <= 0)
        assert_eq!(determine_outcome(&p, &config, 10000), OUTCOME_FAILED);
    }

    #[test]
    fn test_edge_case_quadratic_cost_large_value() {
        let cost = quadratic_vote_cost(1_000_000);
        assert_eq!(cost, 1_000_000_000_000);
    }

    #[test]
    fn test_edge_case_participation_rate_exceeds_100_pct() {
        // More votes than supply (shouldn't happen but handle gracefully)
        let rate = calculate_participation_rate(20000, 10000);
        assert_eq!(rate, 20000); // 200%
    }

    #[test]
    fn test_edge_case_concentration_single_large_voter() {
        let hhi = calculate_power_concentration(&[999, 1], 1000);
        // 9990^2 + 10^2 = 99_800_100 + 100 = 99_800_200 / 10000 = 9980
        assert_eq!(hhi, 9980);
    }

    #[test]
    fn test_edge_case_vote_buying_equal_votes() {
        let votes = vec![
            Vote { voter: 1, proposal_id: 1, support: VOTE_FOR, weight: 100, timestamp: 0 },
            Vote { voter: 2, proposal_id: 1, support: VOTE_FOR, weight: 100, timestamp: 0 },
        ];
        // total=200, threshold 50% = 100, weight must be > 100
        let suspicious = detect_vote_buying(&votes, 50);
        assert!(suspicious.is_empty());
    }

    #[test]
    fn test_edge_case_dynamic_quorum_boundary_2000_bps() {
        // Exactly at 2000 bps boundary
        let q = calculate_dynamic_quorum(1_000_000, 2000);
        // Falls into 500-2000 range -> base quorum
        assert_eq!(q, 1_000_000 * 400 / 10000);
    }

    #[test]
    fn test_edge_case_dynamic_quorum_boundary_500_bps() {
        // Exactly at 500 bps boundary
        let q = calculate_dynamic_quorum(1_000_000, 500);
        assert_eq!(q, 1_000_000 * 400 / 10000);
    }

    #[test]
    fn test_edge_case_split_delegation_many_delegates() {
        let delegatees: Vec<u64> = (2..=20).collect();
        let amounts: Vec<u128> = vec![100; 19];
        let result = split_delegation(1, &delegatees, &amounts);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().len(), 19);
    }

    #[test]
    fn test_edge_case_effective_power_max_values() {
        let p = get_effective_voting_power(u128::MAX / 4, u128::MAX / 4, 0);
        assert_eq!(p, u128::MAX / 4 * 2);
    }

    #[test]
    fn test_edge_case_timelock_zero_grace() {
        let entry = TimelockEntry {
            proposal_id: 1,
            execute_after: 100,
            execute_before: 100, // zero grace window
            executed: false,
        };
        // Can execute at exact block
        assert!(execute_proposal(&entry, 100).is_ok());
        // One block later is too late
        assert!(execute_proposal(&entry, 101).is_err());
    }

    #[test]
    fn test_edge_case_create_proposal_zero_block() {
        let config = default_config();
        let p = create_proposal(&config, 1, default_title_hash(), default_desc_hash(), PROPOSAL_PARAMETER_CHANGE, 0, 5000).unwrap();
        assert_eq!(p.created_at, 0);
        assert_eq!(p.start_block, config.voting_delay_blocks);
    }

    // ============ Additional Coverage Tests ============

    #[test]
    fn test_multiple_proposals_stats_tracking() {
        let proposals: Vec<Proposal> = (0..10).map(|i| {
            let status = match i % 5 {
                0 => STATUS_EXECUTED,
                1 => STATUS_FAILED,
                2 => STATUS_EXPIRED,
                3 => STATUS_CANCELLED,
                _ => STATUS_ACTIVE,
            };
            make_proposal_with_status(status)
        }).collect();
        let stats = get_proposal_stats(&proposals);
        assert_eq!(stats.total_proposals, 10);
        assert_eq!(stats.passed, 2);
        assert_eq!(stats.failed, 2);
        assert_eq!(stats.expired, 2);
        assert_eq!(stats.cancelled, 2);
    }

    #[test]
    fn test_vote_weight_combined_boost() {
        // token=10000, ve=5000, boost=3000 (30%)
        let w = calculate_vote_weight(10000, 5000, 3000);
        // boost = 5000 * 3000 / 10000 = 1500
        assert_eq!(w, 11500);
    }

    #[test]
    fn test_delegation_record_fields() {
        let d = delegate_votes(10, 20, 999, 12345).unwrap();
        assert_eq!(d.delegator, 10);
        assert_eq!(d.delegatee, 20);
        assert_eq!(d.amount, 999);
        assert_eq!(d.expires_at, 12345);
    }

    #[test]
    fn test_is_in_timelock_at_boundaries() {
        let entry = make_timelock(1, 100, 200);
        assert!(is_in_timelock(&entry, 100));
        assert!(is_in_timelock(&entry, 200));
        assert!(!is_in_timelock(&entry, 99));
        assert!(!is_in_timelock(&entry, 201));
    }

    #[test]
    fn test_is_expired_at_boundary() {
        let entry = make_timelock(1, 100, 200);
        assert!(!is_expired(&entry, 200)); // at boundary, not expired
        assert!(is_expired(&entry, 201));
    }

    #[test]
    fn test_concentration_three_unequal() {
        // 600, 300, 100 out of 1000
        // shares: 6000, 3000, 1000
        // HHI = (36000000 + 9000000 + 1000000) / 10000 = 4600
        let hhi = calculate_power_concentration(&[600, 300, 100], 1000);
        assert_eq!(hhi, 4600);
    }

    #[test]
    fn test_distribute_rewards_two_voters() {
        let incentive = VoteIncentive {
            proposal_id: 1,
            total_reward: 100,
            reward_per_vote: 0,
            early_bonus_bps: 0,
            early_cutoff_block: 0,
        };
        let voters = vec![(1, 100), (2, 200)];
        let rewards = distribute_vote_rewards(&incentive, &voters);
        assert_eq!(rewards[0].1, 50);
        assert_eq!(rewards[1].1, 50);
    }

    #[test]
    fn test_cast_vote_accumulates_all_types() {
        let mut p = make_proposal(1, 0, 0, 0);
        cast_vote(&mut p, 1, VOTE_FOR, 100, 200).unwrap();
        cast_vote(&mut p, 2, VOTE_AGAINST, 200, 201).unwrap();
        cast_vote(&mut p, 3, VOTE_ABSTAIN, 300, 202).unwrap();
        assert_eq!(p.for_votes, 100);
        assert_eq!(p.against_votes, 200);
        assert_eq!(p.abstain_votes, 300);
        assert_eq!(total_votes(&p), 600);
    }

    #[test]
    fn test_vote_margin_large_difference() {
        let p = make_proposal(1, 1_000_000, 1, 0);
        assert_eq!(vote_margin(&p), 999_999);
    }

    #[test]
    fn test_filter_delegations_at_exact_expiry() {
        let delegations = vec![
            DelegationRecord { delegator: 1, delegatee: 2, amount: 100, expires_at: 1000 },
        ];
        // At exact expiry time, it should be expired (not active)
        let active = filter_active_delegations(&delegations, 1000);
        assert_eq!(active.len(), 0);
    }

    #[test]
    fn test_calculate_total_delegated_empty() {
        let delegations: Vec<DelegationRecord> = vec![];
        assert_eq!(calculate_total_delegated(&delegations, 1), 0);
    }

    #[test]
    fn test_voting_progress_quarter() {
        let p = make_proposal(1, 0, 0, 0); // start=100, end=1100, period=1000
        let progress = calculate_voting_progress_bps(&p, 350);
        // elapsed=250, period=1000 -> 2500 bps
        assert_eq!(progress, 2500);
    }

    #[test]
    fn test_remaining_blocks_at_start() {
        let p = make_proposal(1, 0, 0, 0); // end=1100
        assert_eq!(calculate_remaining_voting_blocks(&p, 100), 1000);
    }

    #[test]
    fn test_is_not_emergency_upgrade() {
        assert!(!is_proposal_type_emergency(PROPOSAL_UPGRADE));
    }

    #[test]
    fn test_queue_equal_votes_fails() {
        let config = default_config();
        let p = make_proposal(1, 500, 500, 0); // tied
        let result = queue_for_execution(&p, &config, 1200);
        assert!(result.is_err());
    }

    #[test]
    fn test_quadratic_cost_five() {
        assert_eq!(quadratic_vote_cost(5), 25);
    }

    #[test]
    fn test_dynamic_quorum_very_high_participation() {
        let q = calculate_dynamic_quorum(1_000_000, 5000);
        // Very high -> should reduce toward floor of 200 bps
        assert!(q >= 1_000_000 * 200 / 10000);
    }

    #[test]
    fn test_detect_vote_buying_near_threshold() {
        let votes = vec![
            Vote { voter: 1, proposal_id: 1, support: VOTE_FOR, weight: 501, timestamp: 0 },
            Vote { voter: 2, proposal_id: 1, support: VOTE_FOR, weight: 499, timestamp: 0 },
        ];
        // total=1000, threshold 50% = 500. voter 1 has 501 > 500
        let suspicious = detect_vote_buying(&votes, 50);
        assert_eq!(suspicious, vec![1]);
    }
}
