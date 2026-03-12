// ============ Governance Module — DAO Parameter Management ============
// Token-weighted governance for updating protocol parameters on CKB.
//
// Flow:
// 1. PROPOSE: Create proposal cell with new parameters + description
// 2. VOTE: Token holders create vote cells (for/against, weighted by balance)
// 3. QUEUE: After voting period + quorum met, proposal enters timelock
// 4. EXECUTE: After timelock expires, anyone can execute (consumes proposal + old config)
// 5. CANCEL: Proposer or guardian can cancel during voting/timelock
//
// Emergency path: Guardian can execute with shorter timelock + lower quorum
// for circuit-breaker-level actions (pause, rate limit adjustments).
//
// All state is represented as cells — no global mutable state, pure UTXO.

use vibeswap_types::ConfigCellData;
use vibeswap_math::PRECISION;

// ============ Constants ============

/// Minimum voting period in blocks (≈ 3 days at ~6 sec/block)
pub const MIN_VOTING_PERIOD_BLOCKS: u64 = 43_200;

/// Default voting period (≈ 7 days)
pub const DEFAULT_VOTING_PERIOD_BLOCKS: u64 = 100_800;

/// Timelock delay after passing (≈ 2 days)
pub const TIMELOCK_DELAY_BLOCKS: u64 = 28_800;

/// Emergency timelock (≈ 6 hours)
pub const EMERGENCY_TIMELOCK_BLOCKS: u64 = 3_600;

/// Quorum: minimum % of total supply that must vote (4%)
pub const QUORUM_BPS: u64 = 400;

/// Emergency quorum: higher threshold for bypassing timelock (10%)
pub const EMERGENCY_QUORUM_BPS: u64 = 1000;

/// Proposal threshold: minimum token balance to create proposal (0.1% of supply)
pub const PROPOSAL_THRESHOLD_BPS: u64 = 10;

/// Maximum active proposals at once
pub const MAX_ACTIVE_PROPOSALS: usize = 10;

// ============ Types ============

/// Proposal status lifecycle
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProposalStatus {
    /// Voting is open
    Active {
        start_block: u64,
        end_block: u64,
    },
    /// Voting passed, in timelock
    Queued {
        execute_after_block: u64,
    },
    /// Executed successfully
    Executed {
        executed_at_block: u64,
    },
    /// Cancelled by proposer or guardian
    Cancelled,
    /// Voting ended without quorum or majority
    Defeated,
    /// Timelock expired without execution
    Expired,
}

/// A governance proposal
#[derive(Debug, Clone)]
pub struct Proposal {
    /// Unique proposal ID
    pub id: u64,
    /// Proposer's lock hash
    pub proposer: [u8; 32],
    /// Block when voting started
    pub start_block: u64,
    /// Block when voting ends
    pub end_block: u64,
    /// Proposed new configuration
    pub new_config: ConfigCellData,
    /// Description hash (SHA-256 of off-chain description text)
    pub description_hash: [u8; 32],
    /// Total votes FOR (token-weighted)
    pub votes_for: u128,
    /// Total votes AGAINST (token-weighted)
    pub votes_against: u128,
    /// Is this an emergency proposal (shorter timelock)?
    pub is_emergency: bool,
    /// Current status
    pub status: ProposalStatus,
}

/// A vote on a proposal
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Vote {
    /// Voter's lock hash
    pub voter: [u8; 32],
    /// Proposal being voted on
    pub proposal_id: u64,
    /// Token balance at vote time (weight)
    pub weight: u128,
    /// Support: true = for, false = against
    pub support: bool,
}

/// Result of a governance check
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GovernanceError {
    /// Proposer doesn't have enough tokens
    InsufficientProposalThreshold,
    /// Voting period has ended
    VotingEnded,
    /// Voting period hasn't ended yet
    VotingNotEnded,
    /// Quorum not reached
    QuorumNotReached,
    /// Proposal was defeated (more against than for)
    ProposalDefeated,
    /// Timelock hasn't expired yet
    TimelockNotExpired,
    /// Proposal already cancelled/executed/defeated
    ProposalNotActive,
    /// Too many active proposals
    TooManyActiveProposals,
    /// Not authorized (not proposer or guardian)
    Unauthorized,
    /// Duplicate vote
    AlreadyVoted,
    /// Invalid voting period
    InvalidVotingPeriod,
}

// ============ Proposal Lifecycle ============

/// Check if an address has enough tokens to create a proposal
pub fn can_propose(
    voter_balance: u128,
    total_supply: u128,
) -> Result<(), GovernanceError> {
    if total_supply == 0 {
        return Err(GovernanceError::InsufficientProposalThreshold);
    }
    let threshold = total_supply * PROPOSAL_THRESHOLD_BPS as u128 / 10_000;
    if voter_balance < threshold {
        Err(GovernanceError::InsufficientProposalThreshold)
    } else {
        Ok(())
    }
}

/// Create a new proposal
pub fn create_proposal(
    id: u64,
    proposer: [u8; 32],
    new_config: ConfigCellData,
    description_hash: [u8; 32],
    current_block: u64,
    voting_period: u64,
    is_emergency: bool,
) -> Result<Proposal, GovernanceError> {
    if voting_period < MIN_VOTING_PERIOD_BLOCKS {
        return Err(GovernanceError::InvalidVotingPeriod);
    }

    Ok(Proposal {
        id,
        proposer,
        start_block: current_block,
        end_block: current_block + voting_period,
        new_config,
        description_hash,
        votes_for: 0,
        votes_against: 0,
        is_emergency,
        status: ProposalStatus::Active {
            start_block: current_block,
            end_block: current_block + voting_period,
        },
    })
}

/// Cast a vote on an active proposal
pub fn cast_vote(
    proposal: &mut Proposal,
    voter: [u8; 32],
    weight: u128,
    support: bool,
    current_block: u64,
) -> Result<Vote, GovernanceError> {
    // Must be active
    match &proposal.status {
        ProposalStatus::Active { end_block, .. } => {
            if current_block > *end_block {
                return Err(GovernanceError::VotingEnded);
            }
        }
        _ => return Err(GovernanceError::ProposalNotActive),
    }

    // Apply vote
    if support {
        proposal.votes_for += weight;
    } else {
        proposal.votes_against += weight;
    }

    Ok(Vote {
        voter,
        proposal_id: proposal.id,
        weight,
        support,
    })
}

/// Check if a proposal has reached quorum
pub fn has_quorum(
    proposal: &Proposal,
    total_supply: u128,
) -> bool {
    let total_votes = proposal.votes_for + proposal.votes_against;
    let quorum_bps = if proposal.is_emergency {
        EMERGENCY_QUORUM_BPS
    } else {
        QUORUM_BPS
    };
    let required = total_supply * quorum_bps as u128 / 10_000;
    total_votes >= required
}

/// Check if a proposal has passed (majority + quorum)
pub fn has_passed(
    proposal: &Proposal,
    total_supply: u128,
) -> bool {
    has_quorum(proposal, total_supply) && proposal.votes_for > proposal.votes_against
}

/// Finalize voting and transition to Queued or Defeated
pub fn finalize_voting(
    proposal: &mut Proposal,
    total_supply: u128,
    current_block: u64,
) -> Result<(), GovernanceError> {
    match &proposal.status {
        ProposalStatus::Active { end_block, .. } => {
            if current_block <= *end_block {
                return Err(GovernanceError::VotingNotEnded);
            }
        }
        _ => return Err(GovernanceError::ProposalNotActive),
    }

    if has_passed(proposal, total_supply) {
        let delay = if proposal.is_emergency {
            EMERGENCY_TIMELOCK_BLOCKS
        } else {
            TIMELOCK_DELAY_BLOCKS
        };
        proposal.status = ProposalStatus::Queued {
            execute_after_block: current_block + delay,
        };
    } else {
        proposal.status = ProposalStatus::Defeated;
    }

    Ok(())
}

/// Execute a queued proposal (apply the config change)
///
/// Returns the new ConfigCellData to be written on-chain.
pub fn execute_proposal(
    proposal: &mut Proposal,
    current_block: u64,
) -> Result<ConfigCellData, GovernanceError> {
    match &proposal.status {
        ProposalStatus::Queued { execute_after_block } => {
            if current_block < *execute_after_block {
                return Err(GovernanceError::TimelockNotExpired);
            }
        }
        _ => return Err(GovernanceError::ProposalNotActive),
    }

    proposal.status = ProposalStatus::Executed {
        executed_at_block: current_block,
    };

    Ok(proposal.new_config.clone())
}

/// Cancel a proposal (only proposer or guardian)
pub fn cancel_proposal(
    proposal: &mut Proposal,
    canceller: &[u8; 32],
    guardian: &[u8; 32],
) -> Result<(), GovernanceError> {
    // Only proposer or guardian can cancel
    if canceller != &proposal.proposer && canceller != guardian {
        return Err(GovernanceError::Unauthorized);
    }

    match &proposal.status {
        ProposalStatus::Active { .. } | ProposalStatus::Queued { .. } => {
            proposal.status = ProposalStatus::Cancelled;
            Ok(())
        }
        _ => Err(GovernanceError::ProposalNotActive),
    }
}

// ============ Governance Analytics ============

/// Calculate participation rate in basis points
pub fn participation_rate_bps(
    proposal: &Proposal,
    total_supply: u128,
) -> u64 {
    if total_supply == 0 {
        return 0;
    }
    let total_votes = proposal.votes_for + proposal.votes_against;
    ((total_votes * 10_000) / total_supply).min(10_000) as u64
}

/// Calculate approval rate in basis points (of votes cast, not total supply)
pub fn approval_rate_bps(proposal: &Proposal) -> u64 {
    let total = proposal.votes_for + proposal.votes_against;
    if total == 0 {
        return 0;
    }
    ((proposal.votes_for * 10_000) / total) as u64
}

/// Check if a config change is "safe" (within reasonable bounds)
///
/// Returns true if all parameters are within safe ranges.
/// This is a soft check — governance can override, but keepers should flag unsafe proposals.
pub fn is_safe_config_change(
    old_config: &ConfigCellData,
    new_config: &ConfigCellData,
) -> bool {
    // Commit window: can't change by more than 2x in either direction
    let commit_ratio_ok = new_config.commit_window_blocks <= old_config.commit_window_blocks * 2
        && new_config.commit_window_blocks >= old_config.commit_window_blocks / 2;

    // Reveal window: same 2x bound
    let reveal_ratio_ok = new_config.reveal_window_blocks <= old_config.reveal_window_blocks * 2
        && new_config.reveal_window_blocks >= old_config.reveal_window_blocks / 2;

    // Slash rate: can't exceed 50%
    let slash_ok = new_config.slash_rate_bps <= 5000;

    // PoW difficulty: can't drop below 1
    let pow_ok = new_config.min_pow_difficulty >= 1;

    // Circuit breakers: can't be disabled (set to 0)
    let breakers_ok = new_config.volume_breaker_limit > 0
        && new_config.price_breaker_bps > 0
        && new_config.withdrawal_breaker_bps > 0;

    commit_ratio_ok && reveal_ratio_ok && slash_ok && pow_ok && breakers_ok
}

/// Estimate voting power needed to pass a proposal
pub fn votes_needed_to_pass(
    proposal: &Proposal,
    total_supply: u128,
) -> u128 {
    let quorum_bps = if proposal.is_emergency {
        EMERGENCY_QUORUM_BPS
    } else {
        QUORUM_BPS
    };
    let quorum_threshold = total_supply * quorum_bps as u128 / 10_000;

    let total_votes = proposal.votes_for + proposal.votes_against;
    let votes_for_quorum = if total_votes >= quorum_threshold {
        0
    } else {
        quorum_threshold - total_votes
    };

    // Also need majority
    let votes_for_majority = if proposal.votes_for > proposal.votes_against {
        0
    } else {
        proposal.votes_against - proposal.votes_for + 1
    };

    // Need whichever is greater (for votes must beat both thresholds)
    votes_for_quorum.max(votes_for_majority)
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config() -> ConfigCellData {
        ConfigCellData {
            commit_window_blocks: 40,
            reveal_window_blocks: 10,
            slash_rate_bps: 5000,
            max_price_deviation: 500,
            max_trade_size_bps: 1000,
            rate_limit_amount: 1_000_000 * PRECISION,
            rate_limit_window: 3600,
            volume_breaker_limit: 10_000_000 * PRECISION,
            price_breaker_bps: 1000,
            withdrawal_breaker_bps: 2000,
            min_pow_difficulty: 10,
        }
    }

    fn test_proposer() -> [u8; 32] { [0xA1; 32] }
    fn test_guardian() -> [u8; 32] { [0xFF; 32] }
    fn test_voter(id: u8) -> [u8; 32] { [id; 32] }
    fn test_desc_hash() -> [u8; 32] { [0xDD; 32] }

    const TOTAL_SUPPLY: u128 = 100_000_000 * PRECISION; // 100M tokens

    // ============ Proposal Threshold ============

    #[test]
    fn test_can_propose_above_threshold() {
        // 0.1% of 100M = 100K tokens
        let balance = 100_001 * PRECISION;
        assert!(can_propose(balance, TOTAL_SUPPLY).is_ok());
    }

    #[test]
    fn test_can_propose_below_threshold() {
        let balance = 99_000 * PRECISION;
        assert!(matches!(
            can_propose(balance, TOTAL_SUPPLY),
            Err(GovernanceError::InsufficientProposalThreshold)
        ));
    }

    #[test]
    fn test_can_propose_zero_supply() {
        assert!(can_propose(1000, 0).is_err());
    }

    // ============ Proposal Creation ============

    #[test]
    fn test_create_proposal() {
        let proposal = create_proposal(
            1,
            test_proposer(),
            test_config(),
            test_desc_hash(),
            1000,
            DEFAULT_VOTING_PERIOD_BLOCKS,
            false,
        ).unwrap();

        assert_eq!(proposal.id, 1);
        assert_eq!(proposal.start_block, 1000);
        assert_eq!(proposal.end_block, 1000 + DEFAULT_VOTING_PERIOD_BLOCKS);
        assert_eq!(proposal.votes_for, 0);
        assert_eq!(proposal.votes_against, 0);
        assert!(!proposal.is_emergency);
        assert!(matches!(proposal.status, ProposalStatus::Active { .. }));
    }

    #[test]
    fn test_create_proposal_too_short_voting_period() {
        let result = create_proposal(
            1,
            test_proposer(),
            test_config(),
            test_desc_hash(),
            1000,
            MIN_VOTING_PERIOD_BLOCKS - 1, // Too short
            false,
        );
        assert!(matches!(result, Err(GovernanceError::InvalidVotingPeriod)));
    }

    #[test]
    fn test_create_emergency_proposal() {
        let proposal = create_proposal(
            2,
            test_proposer(),
            test_config(),
            test_desc_hash(),
            1000,
            MIN_VOTING_PERIOD_BLOCKS,
            true,
        ).unwrap();

        assert!(proposal.is_emergency);
    }

    // ============ Voting ============

    #[test]
    fn test_cast_vote_for() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        let vote = cast_vote(
            &mut proposal,
            test_voter(0x01),
            5_000_000 * PRECISION,
            true,
            2000,
        ).unwrap();

        assert!(vote.support);
        assert_eq!(vote.weight, 5_000_000 * PRECISION);
        assert_eq!(proposal.votes_for, 5_000_000 * PRECISION);
        assert_eq!(proposal.votes_against, 0);
    }

    #[test]
    fn test_cast_vote_against() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        cast_vote(&mut proposal, test_voter(0x01), 3_000_000 * PRECISION, false, 2000).unwrap();

        assert_eq!(proposal.votes_for, 0);
        assert_eq!(proposal.votes_against, 3_000_000 * PRECISION);
    }

    #[test]
    fn test_cast_vote_after_voting_ended() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        // Vote after end_block
        let result = cast_vote(
            &mut proposal,
            test_voter(0x01),
            1_000_000 * PRECISION,
            true,
            1000 + DEFAULT_VOTING_PERIOD_BLOCKS + 1,
        );
        assert!(matches!(result, Err(GovernanceError::VotingEnded)));
    }

    #[test]
    fn test_multiple_voters() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        cast_vote(&mut proposal, test_voter(0x01), 2_000_000 * PRECISION, true, 2000).unwrap();
        cast_vote(&mut proposal, test_voter(0x02), 1_500_000 * PRECISION, true, 3000).unwrap();
        cast_vote(&mut proposal, test_voter(0x03), 1_000_000 * PRECISION, false, 4000).unwrap();

        assert_eq!(proposal.votes_for, 3_500_000 * PRECISION);
        assert_eq!(proposal.votes_against, 1_000_000 * PRECISION);
    }

    // ============ Quorum & Passing ============

    #[test]
    fn test_has_quorum_met() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        // 4% of 100M = 4M tokens needed
        cast_vote(&mut proposal, test_voter(0x01), 4_000_001 * PRECISION, true, 2000).unwrap();
        assert!(has_quorum(&proposal, TOTAL_SUPPLY));
    }

    #[test]
    fn test_has_quorum_not_met() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        // Just under 4%
        cast_vote(&mut proposal, test_voter(0x01), 3_999_999 * PRECISION, true, 2000).unwrap();
        assert!(!has_quorum(&proposal, TOTAL_SUPPLY));
    }

    #[test]
    fn test_emergency_quorum_higher() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, MIN_VOTING_PERIOD_BLOCKS, true,
        ).unwrap();

        // 4M = 4% — enough for normal quorum, not for emergency (10%)
        cast_vote(&mut proposal, test_voter(0x01), 4_000_000 * PRECISION, true, 2000).unwrap();
        assert!(!has_quorum(&proposal, TOTAL_SUPPLY));

        // Add more to reach 10%
        cast_vote(&mut proposal, test_voter(0x02), 6_000_001 * PRECISION, true, 3000).unwrap();
        assert!(has_quorum(&proposal, TOTAL_SUPPLY));
    }

    #[test]
    fn test_has_passed() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        // 5M for, 1M against → quorum met (6M > 4M threshold) + majority
        cast_vote(&mut proposal, test_voter(0x01), 5_000_000 * PRECISION, true, 2000).unwrap();
        cast_vote(&mut proposal, test_voter(0x02), 1_000_000 * PRECISION, false, 3000).unwrap();

        assert!(has_passed(&proposal, TOTAL_SUPPLY));
    }

    #[test]
    fn test_defeated_by_majority() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        // Quorum met but against wins
        cast_vote(&mut proposal, test_voter(0x01), 2_000_000 * PRECISION, true, 2000).unwrap();
        cast_vote(&mut proposal, test_voter(0x02), 3_000_000 * PRECISION, false, 3000).unwrap();

        assert!(has_quorum(&proposal, TOTAL_SUPPLY));
        assert!(!has_passed(&proposal, TOTAL_SUPPLY));
    }

    // ============ Finalize Voting ============

    #[test]
    fn test_finalize_voting_passed() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        cast_vote(&mut proposal, test_voter(0x01), 5_000_000 * PRECISION, true, 2000).unwrap();

        let end_block = 1000 + DEFAULT_VOTING_PERIOD_BLOCKS + 1;
        finalize_voting(&mut proposal, TOTAL_SUPPLY, end_block).unwrap();

        match &proposal.status {
            ProposalStatus::Queued { execute_after_block } => {
                assert_eq!(*execute_after_block, end_block + TIMELOCK_DELAY_BLOCKS);
            }
            _ => panic!("Expected Queued status"),
        }
    }

    #[test]
    fn test_finalize_voting_defeated() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        // Only 1M votes — quorum not met (need 4M)
        cast_vote(&mut proposal, test_voter(0x01), 1_000_000 * PRECISION, true, 2000).unwrap();

        let end_block = 1000 + DEFAULT_VOTING_PERIOD_BLOCKS + 1;
        finalize_voting(&mut proposal, TOTAL_SUPPLY, end_block).unwrap();

        assert_eq!(proposal.status, ProposalStatus::Defeated);
    }

    #[test]
    fn test_finalize_voting_too_early() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        let result = finalize_voting(&mut proposal, TOTAL_SUPPLY, 1000 + 100); // Too early
        assert!(matches!(result, Err(GovernanceError::VotingNotEnded)));
    }

    #[test]
    fn test_finalize_emergency_shorter_timelock() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, MIN_VOTING_PERIOD_BLOCKS, true,
        ).unwrap();

        cast_vote(&mut proposal, test_voter(0x01), 10_000_001 * PRECISION, true, 2000).unwrap();

        let end_block = 1000 + MIN_VOTING_PERIOD_BLOCKS + 1;
        finalize_voting(&mut proposal, TOTAL_SUPPLY, end_block).unwrap();

        match &proposal.status {
            ProposalStatus::Queued { execute_after_block } => {
                // Emergency: shorter timelock
                assert_eq!(*execute_after_block, end_block + EMERGENCY_TIMELOCK_BLOCKS);
            }
            _ => panic!("Expected Queued status"),
        }
    }

    // ============ Execute ============

    #[test]
    fn test_execute_proposal() {
        let new_config = ConfigCellData {
            commit_window_blocks: 50, // Changed from 40
            ..test_config()
        };

        let mut proposal = create_proposal(
            1, test_proposer(), new_config.clone(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        cast_vote(&mut proposal, test_voter(0x01), 5_000_000 * PRECISION, true, 2000).unwrap();

        let end_block = 1000 + DEFAULT_VOTING_PERIOD_BLOCKS + 1;
        finalize_voting(&mut proposal, TOTAL_SUPPLY, end_block).unwrap();

        let execute_block = end_block + TIMELOCK_DELAY_BLOCKS + 1;
        let result_config = execute_proposal(&mut proposal, execute_block).unwrap();

        assert_eq!(result_config.commit_window_blocks, 50);
        assert!(matches!(proposal.status, ProposalStatus::Executed { .. }));
    }

    #[test]
    fn test_execute_too_early() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        cast_vote(&mut proposal, test_voter(0x01), 5_000_000 * PRECISION, true, 2000).unwrap();

        let end_block = 1000 + DEFAULT_VOTING_PERIOD_BLOCKS + 1;
        finalize_voting(&mut proposal, TOTAL_SUPPLY, end_block).unwrap();

        // Try to execute before timelock
        let result = execute_proposal(&mut proposal, end_block + 100);
        assert!(matches!(result, Err(GovernanceError::TimelockNotExpired)));
    }

    // ============ Cancel ============

    #[test]
    fn test_cancel_by_proposer() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        cancel_proposal(&mut proposal, &test_proposer(), &test_guardian()).unwrap();
        assert_eq!(proposal.status, ProposalStatus::Cancelled);
    }

    #[test]
    fn test_cancel_by_guardian() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        cancel_proposal(&mut proposal, &test_guardian(), &test_guardian()).unwrap();
        assert_eq!(proposal.status, ProposalStatus::Cancelled);
    }

    #[test]
    fn test_cancel_by_random_rejected() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        let random = [0x99; 32];
        let result = cancel_proposal(&mut proposal, &random, &test_guardian());
        assert!(matches!(result, Err(GovernanceError::Unauthorized)));
    }

    #[test]
    fn test_cancel_queued_proposal() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        cast_vote(&mut proposal, test_voter(0x01), 5_000_000 * PRECISION, true, 2000).unwrap();
        finalize_voting(&mut proposal, TOTAL_SUPPLY, 1000 + DEFAULT_VOTING_PERIOD_BLOCKS + 1).unwrap();

        // Guardian can cancel even during timelock
        cancel_proposal(&mut proposal, &test_guardian(), &test_guardian()).unwrap();
        assert_eq!(proposal.status, ProposalStatus::Cancelled);
    }

    #[test]
    fn test_cancel_executed_rejected() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        cast_vote(&mut proposal, test_voter(0x01), 5_000_000 * PRECISION, true, 2000).unwrap();
        let end_block = 1000 + DEFAULT_VOTING_PERIOD_BLOCKS + 1;
        finalize_voting(&mut proposal, TOTAL_SUPPLY, end_block).unwrap();
        execute_proposal(&mut proposal, end_block + TIMELOCK_DELAY_BLOCKS + 1).unwrap();

        // Can't cancel what's already executed
        let result = cancel_proposal(&mut proposal, &test_proposer(), &test_guardian());
        assert!(matches!(result, Err(GovernanceError::ProposalNotActive)));
    }

    // ============ Analytics ============

    #[test]
    fn test_participation_rate() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        cast_vote(&mut proposal, test_voter(0x01), 10_000_000 * PRECISION, true, 2000).unwrap();
        cast_vote(&mut proposal, test_voter(0x02), 5_000_000 * PRECISION, false, 3000).unwrap();

        // 15M / 100M = 15% = 1500 bps
        let rate = participation_rate_bps(&proposal, TOTAL_SUPPLY);
        assert_eq!(rate, 1500);
    }

    #[test]
    fn test_approval_rate() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        cast_vote(&mut proposal, test_voter(0x01), 8_000_000 * PRECISION, true, 2000).unwrap();
        cast_vote(&mut proposal, test_voter(0x02), 2_000_000 * PRECISION, false, 3000).unwrap();

        // 8M / 10M = 80% = 8000 bps
        let rate = approval_rate_bps(&proposal);
        assert_eq!(rate, 8000);
    }

    #[test]
    fn test_votes_needed_quorum() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        // Need 4M for quorum, 0 votes so far
        let needed = votes_needed_to_pass(&proposal, TOTAL_SUPPLY);
        assert_eq!(needed, 4_000_000 * PRECISION);
    }

    #[test]
    fn test_votes_needed_majority() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        // 10M against — quorum met, need majority
        cast_vote(&mut proposal, test_voter(0x01), 10_000_000 * PRECISION, false, 2000).unwrap();

        let needed = votes_needed_to_pass(&proposal, TOTAL_SUPPLY);
        // Need 10M+1 for votes to be > 10M against
        assert_eq!(needed, 10_000_000 * PRECISION + 1);
    }

    // ============ Safe Config Change ============

    #[test]
    fn test_safe_config_change() {
        let old = test_config();
        let new = ConfigCellData {
            commit_window_blocks: 50, // 40→50 (within 2x)
            ..old.clone()
        };
        assert!(is_safe_config_change(&old, &new));
    }

    #[test]
    fn test_unsafe_config_change_commit_too_large() {
        let old = test_config();
        let new = ConfigCellData {
            commit_window_blocks: 81, // 40→81 (>2x)
            ..old.clone()
        };
        assert!(!is_safe_config_change(&old, &new));
    }

    #[test]
    fn test_unsafe_config_disabled_breaker() {
        let old = test_config();
        let new = ConfigCellData {
            volume_breaker_limit: 0, // Disabled!
            ..old.clone()
        };
        assert!(!is_safe_config_change(&old, &new));
    }

    #[test]
    fn test_unsafe_config_zero_pow() {
        let old = test_config();
        let new = ConfigCellData {
            min_pow_difficulty: 0, // Disabled!
            ..old.clone()
        };
        assert!(!is_safe_config_change(&old, &new));
    }

    // ============ Full Lifecycle ============

    #[test]
    fn test_governance_full_lifecycle() {
        let total_supply = TOTAL_SUPPLY;

        // 1. Propose: increase commit window from 40 to 60 blocks
        let new_config = ConfigCellData {
            commit_window_blocks: 60,
            ..test_config()
        };

        let mut proposal = create_proposal(
            42, test_proposer(), new_config.clone(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        // 2. Vote: 3 voters, 2 for, 1 against
        cast_vote(&mut proposal, test_voter(0x01), 3_000_000 * PRECISION, true, 5000).unwrap();
        cast_vote(&mut proposal, test_voter(0x02), 2_000_000 * PRECISION, true, 6000).unwrap();
        cast_vote(&mut proposal, test_voter(0x03), 1_000_000 * PRECISION, false, 7000).unwrap();

        // Verify analytics
        assert_eq!(participation_rate_bps(&proposal, total_supply), 600); // 6%
        assert_eq!(approval_rate_bps(&proposal), 8333); // 83.33%

        // 3. Finalize: voting period ended
        let end_block = 1000 + DEFAULT_VOTING_PERIOD_BLOCKS + 1;
        finalize_voting(&mut proposal, total_supply, end_block).unwrap();
        assert!(matches!(proposal.status, ProposalStatus::Queued { .. }));

        // 4. Execute: timelock expired
        let execute_block = end_block + TIMELOCK_DELAY_BLOCKS + 1;
        let result_config = execute_proposal(&mut proposal, execute_block).unwrap();

        assert_eq!(result_config.commit_window_blocks, 60);
        assert!(matches!(proposal.status, ProposalStatus::Executed { .. }));
    }

    #[test]
    fn test_emergency_governance_lifecycle() {
        let total_supply = TOTAL_SUPPLY;

        // Emergency: disable trading by maxing out slash rate
        let emergency_config = ConfigCellData {
            slash_rate_bps: 5000,
            ..test_config()
        };

        let mut proposal = create_proposal(
            99, test_proposer(), emergency_config.clone(), test_desc_hash(),
            1000, MIN_VOTING_PERIOD_BLOCKS, true,
        ).unwrap();

        // Emergency needs 10% quorum — 10M tokens
        cast_vote(&mut proposal, test_voter(0x01), 10_000_001 * PRECISION, true, 2000).unwrap();

        let end_block = 1000 + MIN_VOTING_PERIOD_BLOCKS + 1;
        finalize_voting(&mut proposal, total_supply, end_block).unwrap();

        // Emergency timelock is shorter
        if let ProposalStatus::Queued { execute_after_block } = proposal.status {
            assert_eq!(execute_after_block, end_block + EMERGENCY_TIMELOCK_BLOCKS);

            let result = execute_proposal(&mut proposal, execute_after_block + 1).unwrap();
            assert_eq!(result.slash_rate_bps, 5000);
        } else {
            panic!("Expected Queued status");
        }
    }

    // ============ Additional Edge Case & Coverage Tests ============

    #[test]
    fn test_can_propose_exact_threshold() {
        // Exact threshold: 0.1% of 100M = 100_000 tokens
        let threshold = TOTAL_SUPPLY * PROPOSAL_THRESHOLD_BPS as u128 / 10_000;
        assert!(can_propose(threshold, TOTAL_SUPPLY).is_ok());
    }

    #[test]
    fn test_can_propose_one_below_threshold() {
        let threshold = TOTAL_SUPPLY * PROPOSAL_THRESHOLD_BPS as u128 / 10_000;
        assert!(can_propose(threshold - 1, TOTAL_SUPPLY).is_err());
    }

    #[test]
    fn test_create_proposal_exact_min_voting_period() {
        // Exactly MIN_VOTING_PERIOD_BLOCKS should succeed
        let proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, MIN_VOTING_PERIOD_BLOCKS, false,
        );
        assert!(proposal.is_ok());
        let p = proposal.unwrap();
        assert_eq!(p.end_block, 1000 + MIN_VOTING_PERIOD_BLOCKS);
    }

    #[test]
    fn test_cast_vote_exactly_at_end_block() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        // Vote exactly at end_block (end_block = 1000 + DEFAULT_VOTING_PERIOD_BLOCKS)
        // current_block > end_block check => equal should be ok
        let result = cast_vote(
            &mut proposal,
            test_voter(0x01),
            1_000_000 * PRECISION,
            true,
            1000 + DEFAULT_VOTING_PERIOD_BLOCKS, // exactly at end
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_cast_vote_on_cancelled_proposal() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        cancel_proposal(&mut proposal, &test_proposer(), &test_guardian()).unwrap();

        let result = cast_vote(
            &mut proposal,
            test_voter(0x01),
            1_000_000 * PRECISION,
            true,
            2000,
        );
        assert!(matches!(result, Err(GovernanceError::ProposalNotActive)));
    }

    #[test]
    fn test_cast_vote_on_defeated_proposal() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        // Small votes, then finalize as defeated
        cast_vote(&mut proposal, test_voter(0x01), 100 * PRECISION, true, 2000).unwrap();
        let end_block = 1000 + DEFAULT_VOTING_PERIOD_BLOCKS + 1;
        finalize_voting(&mut proposal, TOTAL_SUPPLY, end_block).unwrap();
        assert_eq!(proposal.status, ProposalStatus::Defeated);

        // Attempting to vote on defeated proposal
        let result = cast_vote(
            &mut proposal,
            test_voter(0x02),
            1_000_000 * PRECISION,
            true,
            end_block + 1,
        );
        assert!(matches!(result, Err(GovernanceError::ProposalNotActive)));
    }

    #[test]
    fn test_finalize_voting_exactly_at_end_block_fails() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        cast_vote(&mut proposal, test_voter(0x01), 5_000_000 * PRECISION, true, 2000).unwrap();

        // current_block == end_block => VotingNotEnded (need current_block > end_block)
        let result = finalize_voting(
            &mut proposal,
            TOTAL_SUPPLY,
            1000 + DEFAULT_VOTING_PERIOD_BLOCKS,
        );
        assert!(matches!(result, Err(GovernanceError::VotingNotEnded)));
    }

    #[test]
    fn test_finalize_already_defeated_proposal() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        let end_block = 1000 + DEFAULT_VOTING_PERIOD_BLOCKS + 1;
        finalize_voting(&mut proposal, TOTAL_SUPPLY, end_block).unwrap();
        assert_eq!(proposal.status, ProposalStatus::Defeated);

        // Trying to finalize again should fail
        let result = finalize_voting(&mut proposal, TOTAL_SUPPLY, end_block + 100);
        assert!(matches!(result, Err(GovernanceError::ProposalNotActive)));
    }

    #[test]
    fn test_execute_proposal_not_queued() {
        // Attempt to execute an Active proposal (not yet finalized)
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        let result = execute_proposal(&mut proposal, 999_999);
        assert!(matches!(result, Err(GovernanceError::ProposalNotActive)));
    }

    #[test]
    fn test_execute_proposal_exactly_at_timelock_succeeds() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        cast_vote(&mut proposal, test_voter(0x01), 5_000_000 * PRECISION, true, 2000).unwrap();
        let end_block = 1000 + DEFAULT_VOTING_PERIOD_BLOCKS + 1;
        finalize_voting(&mut proposal, TOTAL_SUPPLY, end_block).unwrap();

        if let ProposalStatus::Queued { execute_after_block } = proposal.status {
            // Exactly at execute_after_block: current_block >= execute_after_block passes
            let result = execute_proposal(&mut proposal, execute_after_block);
            assert!(result.is_ok());
            assert!(matches!(proposal.status, ProposalStatus::Executed { .. }));
        } else {
            panic!("Expected Queued status");
        }
    }

    #[test]
    fn test_execute_proposal_one_before_timelock_fails() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        cast_vote(&mut proposal, test_voter(0x01), 5_000_000 * PRECISION, true, 2000).unwrap();
        let end_block = 1000 + DEFAULT_VOTING_PERIOD_BLOCKS + 1;
        finalize_voting(&mut proposal, TOTAL_SUPPLY, end_block).unwrap();

        if let ProposalStatus::Queued { execute_after_block } = proposal.status {
            // One block before timelock expires
            let result = execute_proposal(&mut proposal, execute_after_block - 1);
            assert!(matches!(result, Err(GovernanceError::TimelockNotExpired)));
        } else {
            panic!("Expected Queued status");
        }
    }

    #[test]
    fn test_cancel_defeated_proposal_rejected() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        let end_block = 1000 + DEFAULT_VOTING_PERIOD_BLOCKS + 1;
        finalize_voting(&mut proposal, TOTAL_SUPPLY, end_block).unwrap();
        assert_eq!(proposal.status, ProposalStatus::Defeated);

        let result = cancel_proposal(&mut proposal, &test_proposer(), &test_guardian());
        assert!(matches!(result, Err(GovernanceError::ProposalNotActive)));
    }

    #[test]
    fn test_participation_rate_zero_supply() {
        let proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        assert_eq!(participation_rate_bps(&proposal, 0), 0);
    }

    #[test]
    fn test_participation_rate_capped_at_10000() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        // Votes exceed total_supply (shouldn't happen in practice, but tests the cap)
        proposal.votes_for = 200_000_000 * PRECISION;
        let rate = participation_rate_bps(&proposal, TOTAL_SUPPLY);
        assert_eq!(rate, 10_000); // Capped at 100%
    }

    #[test]
    fn test_approval_rate_zero_votes() {
        let proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        assert_eq!(approval_rate_bps(&proposal), 0);
    }

    #[test]
    fn test_approval_rate_unanimous_for() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        cast_vote(&mut proposal, test_voter(0x01), 10_000_000 * PRECISION, true, 2000).unwrap();
        assert_eq!(approval_rate_bps(&proposal), 10_000); // 100%
    }

    #[test]
    fn test_votes_needed_already_passing() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        // 5M for, 0 against — quorum met + majority achieved
        cast_vote(&mut proposal, test_voter(0x01), 5_000_000 * PRECISION, true, 2000).unwrap();

        let needed = votes_needed_to_pass(&proposal, TOTAL_SUPPLY);
        assert_eq!(needed, 0); // Already passing
    }

    #[test]
    fn test_unsafe_config_change_reveal_too_small() {
        let old = test_config();
        let new = ConfigCellData {
            reveal_window_blocks: old.reveal_window_blocks / 2 - 1, // < half = unsafe
            ..old.clone()
        };
        assert!(!is_safe_config_change(&old, &new));
    }

    #[test]
    fn test_unsafe_config_change_slash_over_50_percent() {
        let old = test_config();
        let new = ConfigCellData {
            slash_rate_bps: 5001, // > 50%
            ..old.clone()
        };
        assert!(!is_safe_config_change(&old, &new));
    }

    #[test]
    fn test_safe_config_change_all_boundaries() {
        let old = test_config();
        // Set everything to exactly the boundary: 2x commit, 2x reveal, 50% slash, min pow=1
        let new = ConfigCellData {
            commit_window_blocks: old.commit_window_blocks * 2,
            reveal_window_blocks: old.reveal_window_blocks * 2,
            slash_rate_bps: 5000,
            min_pow_difficulty: 1,
            volume_breaker_limit: 1,
            price_breaker_bps: 1,
            withdrawal_breaker_bps: 1,
            ..old.clone()
        };
        assert!(is_safe_config_change(&old, &new));
    }

    // ============ New Tests: Additional Edge Cases & Coverage ============

    #[test]
    fn test_has_quorum_exact_threshold() {
        // Exactly at quorum threshold (4% of 100M = 4M tokens)
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        let quorum_amount = TOTAL_SUPPLY * QUORUM_BPS as u128 / 10_000;
        cast_vote(&mut proposal, test_voter(0x01), quorum_amount, true, 2000).unwrap();
        assert!(has_quorum(&proposal, TOTAL_SUPPLY),
            "Exactly at quorum threshold should pass");
    }

    #[test]
    fn test_has_quorum_one_below_threshold() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        let quorum_amount = TOTAL_SUPPLY * QUORUM_BPS as u128 / 10_000;
        cast_vote(&mut proposal, test_voter(0x01), quorum_amount - 1, true, 2000).unwrap();
        assert!(!has_quorum(&proposal, TOTAL_SUPPLY),
            "One below quorum threshold should not pass");
    }

    #[test]
    fn test_has_passed_tie_does_not_pass() {
        // Equal votes for and against: votes_for is NOT > votes_against
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        cast_vote(&mut proposal, test_voter(0x01), 5_000_000 * PRECISION, true, 2000).unwrap();
        cast_vote(&mut proposal, test_voter(0x02), 5_000_000 * PRECISION, false, 3000).unwrap();

        // Quorum met (10M > 4M) but tied — should NOT pass
        assert!(has_quorum(&proposal, TOTAL_SUPPLY));
        assert!(!has_passed(&proposal, TOTAL_SUPPLY),
            "A tied vote should not pass (need strict majority)");
    }

    #[test]
    fn test_finalize_tied_vote_is_defeated() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        cast_vote(&mut proposal, test_voter(0x01), 5_000_000 * PRECISION, true, 2000).unwrap();
        cast_vote(&mut proposal, test_voter(0x02), 5_000_000 * PRECISION, false, 3000).unwrap();

        let end_block = 1000 + DEFAULT_VOTING_PERIOD_BLOCKS + 1;
        finalize_voting(&mut proposal, TOTAL_SUPPLY, end_block).unwrap();
        assert_eq!(proposal.status, ProposalStatus::Defeated,
            "Tied vote should finalize as Defeated");
    }

    #[test]
    fn test_votes_needed_tie_requires_one_more() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        // 5M for, 5M against — tied. Need 1 more for vote to beat against.
        cast_vote(&mut proposal, test_voter(0x01), 5_000_000 * PRECISION, true, 2000).unwrap();
        cast_vote(&mut proposal, test_voter(0x02), 5_000_000 * PRECISION, false, 3000).unwrap();

        let needed = votes_needed_to_pass(&proposal, TOTAL_SUPPLY);
        // votes_for_majority = votes_against - votes_for + 1 = 0 + 1 = 1
        // votes_for_quorum = 0 (already above 4M)
        assert_eq!(needed, 1, "Tied vote needs exactly 1 more token to pass");
    }

    #[test]
    fn test_votes_needed_emergency_higher_quorum() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, MIN_VOTING_PERIOD_BLOCKS, true, // emergency
        ).unwrap();

        // No votes yet — emergency needs 10% = 10M tokens
        let needed = votes_needed_to_pass(&proposal, TOTAL_SUPPLY);
        let emergency_quorum = TOTAL_SUPPLY * EMERGENCY_QUORUM_BPS as u128 / 10_000;
        assert_eq!(needed, emergency_quorum,
            "Emergency proposal with no votes needs full emergency quorum");
    }

    #[test]
    fn test_unsafe_config_price_breaker_disabled() {
        let old = test_config();
        let new = ConfigCellData {
            price_breaker_bps: 0, // Disabled
            ..old.clone()
        };
        assert!(!is_safe_config_change(&old, &new),
            "Disabling price breaker should be unsafe");
    }

    #[test]
    fn test_unsafe_config_withdrawal_breaker_disabled() {
        let old = test_config();
        let new = ConfigCellData {
            withdrawal_breaker_bps: 0, // Disabled
            ..old.clone()
        };
        assert!(!is_safe_config_change(&old, &new),
            "Disabling withdrawal breaker should be unsafe");
    }

    #[test]
    fn test_safe_config_change_halving_windows() {
        // Exactly halving commit and reveal windows should be safe (within 2x bound)
        let old = test_config();
        let new = ConfigCellData {
            commit_window_blocks: old.commit_window_blocks / 2,
            reveal_window_blocks: old.reveal_window_blocks / 2,
            ..old.clone()
        };
        assert!(is_safe_config_change(&old, &new),
            "Halving windows should be within safe 2x bounds");
    }

    #[test]
    fn test_approval_rate_all_against() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        cast_vote(&mut proposal, test_voter(0x01), 10_000_000 * PRECISION, false, 2000).unwrap();
        assert_eq!(approval_rate_bps(&proposal), 0,
            "All votes against should yield 0% approval");
    }

    // ============ New Tests: Extended Edge Cases & Boundary Coverage ============

    #[test]
    fn test_can_propose_max_balance() {
        // u128::MAX balance should always pass the threshold
        assert!(can_propose(u128::MAX, TOTAL_SUPPLY).is_ok());
    }

    #[test]
    fn test_can_propose_both_zero() {
        // Zero balance and zero supply — supply=0 triggers early error
        assert!(matches!(
            can_propose(0, 0),
            Err(GovernanceError::InsufficientProposalThreshold)
        ));
    }

    #[test]
    fn test_can_propose_zero_balance_nonzero_supply() {
        assert!(matches!(
            can_propose(0, TOTAL_SUPPLY),
            Err(GovernanceError::InsufficientProposalThreshold)
        ));
    }

    #[test]
    fn test_can_propose_tiny_supply() {
        // If total_supply is very small (e.g. 1), threshold = 1 * 10 / 10_000 = 0
        // Any balance >= 0 should pass
        assert!(can_propose(0, 1).is_ok());
        assert!(can_propose(1, 1).is_ok());
    }

    #[test]
    fn test_create_proposal_at_block_zero() {
        // Creating a proposal at block 0 should work
        let proposal = create_proposal(
            0, test_proposer(), test_config(), test_desc_hash(),
            0, MIN_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        assert_eq!(proposal.start_block, 0);
        assert_eq!(proposal.end_block, MIN_VOTING_PERIOD_BLOCKS);
    }

    #[test]
    fn test_create_proposal_voting_period_zero_fails() {
        let result = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, 0, false,
        );
        assert!(matches!(result, Err(GovernanceError::InvalidVotingPeriod)));
    }

    #[test]
    fn test_create_proposal_id_zero() {
        // ID 0 should be valid — no restriction on ID values
        let proposal = create_proposal(
            0, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();
        assert_eq!(proposal.id, 0);
    }

    #[test]
    fn test_create_proposal_id_max() {
        // u64::MAX proposal ID should work
        let proposal = create_proposal(
            u64::MAX, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();
        assert_eq!(proposal.id, u64::MAX);
    }

    #[test]
    fn test_cast_vote_zero_weight() {
        // A vote with 0 weight should succeed but not change tallies
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        let vote = cast_vote(&mut proposal, test_voter(0x01), 0, true, 2000).unwrap();
        assert_eq!(vote.weight, 0);
        assert_eq!(proposal.votes_for, 0);
        assert_eq!(proposal.votes_against, 0);
    }

    #[test]
    fn test_cast_vote_at_start_block() {
        // Voting exactly at start_block should succeed
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        let result = cast_vote(&mut proposal, test_voter(0x01), 1_000 * PRECISION, true, 1000);
        assert!(result.is_ok());
    }

    #[test]
    fn test_cast_vote_on_executed_proposal() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        cast_vote(&mut proposal, test_voter(0x01), 5_000_000 * PRECISION, true, 2000).unwrap();
        let end_block = 1000 + DEFAULT_VOTING_PERIOD_BLOCKS + 1;
        finalize_voting(&mut proposal, TOTAL_SUPPLY, end_block).unwrap();
        execute_proposal(&mut proposal, end_block + TIMELOCK_DELAY_BLOCKS + 1).unwrap();

        let result = cast_vote(&mut proposal, test_voter(0x02), 1_000 * PRECISION, true, end_block + TIMELOCK_DELAY_BLOCKS + 2);
        assert!(matches!(result, Err(GovernanceError::ProposalNotActive)));
    }

    #[test]
    fn test_cast_vote_on_queued_proposal() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        cast_vote(&mut proposal, test_voter(0x01), 5_000_000 * PRECISION, true, 2000).unwrap();
        let end_block = 1000 + DEFAULT_VOTING_PERIOD_BLOCKS + 1;
        finalize_voting(&mut proposal, TOTAL_SUPPLY, end_block).unwrap();
        assert!(matches!(proposal.status, ProposalStatus::Queued { .. }));

        // Voting on a queued proposal should fail
        let result = cast_vote(&mut proposal, test_voter(0x02), 1_000 * PRECISION, true, end_block + 1);
        assert!(matches!(result, Err(GovernanceError::ProposalNotActive)));
    }

    #[test]
    fn test_has_quorum_zero_supply() {
        // With zero supply, required = 0 * bps / 10000 = 0, and 0 votes >= 0 is true
        let proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        assert!(has_quorum(&proposal, 0));
    }

    #[test]
    fn test_has_passed_zero_supply_no_votes() {
        // With zero supply, quorum met (0 >= 0), but 0 is NOT > 0 — should NOT pass
        let proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        assert!(!has_passed(&proposal, 0));
    }

    #[test]
    fn test_has_passed_zero_supply_with_votes() {
        // Zero supply but has votes_for > 0 — quorum met and majority met
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        cast_vote(&mut proposal, test_voter(0x01), 100, true, 2000).unwrap();
        assert!(has_passed(&proposal, 0));
    }

    #[test]
    fn test_finalize_cancelled_proposal_fails() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        cancel_proposal(&mut proposal, &test_proposer(), &test_guardian()).unwrap();

        let result = finalize_voting(&mut proposal, TOTAL_SUPPLY, 1000 + DEFAULT_VOTING_PERIOD_BLOCKS + 1);
        assert!(matches!(result, Err(GovernanceError::ProposalNotActive)));
    }

    #[test]
    fn test_execute_cancelled_proposal_fails() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        cancel_proposal(&mut proposal, &test_proposer(), &test_guardian()).unwrap();

        let result = execute_proposal(&mut proposal, 999_999);
        assert!(matches!(result, Err(GovernanceError::ProposalNotActive)));
    }

    #[test]
    fn test_execute_defeated_proposal_fails() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        let end_block = 1000 + DEFAULT_VOTING_PERIOD_BLOCKS + 1;
        finalize_voting(&mut proposal, TOTAL_SUPPLY, end_block).unwrap();
        assert_eq!(proposal.status, ProposalStatus::Defeated);

        let result = execute_proposal(&mut proposal, end_block + TIMELOCK_DELAY_BLOCKS + 1);
        assert!(matches!(result, Err(GovernanceError::ProposalNotActive)));
    }

    #[test]
    fn test_execute_already_executed_fails() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        cast_vote(&mut proposal, test_voter(0x01), 5_000_000 * PRECISION, true, 2000).unwrap();
        let end_block = 1000 + DEFAULT_VOTING_PERIOD_BLOCKS + 1;
        finalize_voting(&mut proposal, TOTAL_SUPPLY, end_block).unwrap();
        let exec_block = end_block + TIMELOCK_DELAY_BLOCKS + 1;
        execute_proposal(&mut proposal, exec_block).unwrap();

        // Double-execute should fail
        let result = execute_proposal(&mut proposal, exec_block + 1);
        assert!(matches!(result, Err(GovernanceError::ProposalNotActive)));
    }

    #[test]
    fn test_cancel_cancelled_proposal_fails() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        cancel_proposal(&mut proposal, &test_proposer(), &test_guardian()).unwrap();

        // Double-cancel should fail
        let result = cancel_proposal(&mut proposal, &test_proposer(), &test_guardian());
        assert!(matches!(result, Err(GovernanceError::ProposalNotActive)));
    }

    #[test]
    fn test_participation_rate_no_votes() {
        let proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        assert_eq!(participation_rate_bps(&proposal, TOTAL_SUPPLY), 0);
    }

    #[test]
    fn test_participation_rate_full_supply_voted() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        // All supply votes for
        proposal.votes_for = TOTAL_SUPPLY;
        let rate = participation_rate_bps(&proposal, TOTAL_SUPPLY);
        assert_eq!(rate, 10_000); // 100%
    }

    #[test]
    fn test_approval_rate_near_50_50_split() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        // 5_000_001 for, 5_000_000 against → just barely majority
        cast_vote(&mut proposal, test_voter(0x01), 5_000_001 * PRECISION, true, 2000).unwrap();
        cast_vote(&mut proposal, test_voter(0x02), 5_000_000 * PRECISION, false, 3000).unwrap();

        let rate = approval_rate_bps(&proposal);
        // 5_000_001 / 10_000_001 * 10_000 ≈ 5000 (just barely over 50%)
        assert!(rate >= 5000, "Approval rate should be at or above 50% when for > against");
        assert!(rate <= 5001, "Approval rate should be near 50% for near-equal split");
    }

    #[test]
    fn test_votes_needed_no_votes_normal() {
        // Normal proposal, no votes — need the quorum amount
        let proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        let needed = votes_needed_to_pass(&proposal, TOTAL_SUPPLY);
        let quorum = TOTAL_SUPPLY * QUORUM_BPS as u128 / 10_000;
        assert_eq!(needed, quorum);
    }

    #[test]
    fn test_votes_needed_majority_dominates_quorum() {
        // Scenario where majority needed is greater than quorum remaining
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        // 20M against — well above quorum. For votes need 20M + 1 to win.
        cast_vote(&mut proposal, test_voter(0x01), 20_000_000 * PRECISION, false, 2000).unwrap();

        let needed = votes_needed_to_pass(&proposal, TOTAL_SUPPLY);
        assert_eq!(needed, 20_000_000 * PRECISION + 1);
    }

    #[test]
    fn test_votes_needed_zero_supply() {
        // With 0 supply, quorum = 0; need majority
        let proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        // No votes, quorum threshold = 0, votes_for_quorum = 0
        // votes_for == votes_against (both 0) => need 1 for majority
        let needed = votes_needed_to_pass(&proposal, 0);
        assert_eq!(needed, 1);
    }

    #[test]
    fn test_safe_config_identical() {
        // Identical config should always be safe
        let config = test_config();
        assert!(is_safe_config_change(&config, &config));
    }

    #[test]
    fn test_unsafe_config_commit_too_small() {
        // Shrinking commit window below half should be unsafe
        let old = test_config();
        let new = ConfigCellData {
            commit_window_blocks: old.commit_window_blocks / 2 - 1, // < half
            ..old.clone()
        };
        assert!(!is_safe_config_change(&old, &new));
    }

    #[test]
    fn test_unsafe_config_reveal_too_large() {
        // Reveal window more than 2x should be unsafe
        let old = test_config();
        let new = ConfigCellData {
            reveal_window_blocks: old.reveal_window_blocks * 2 + 1, // > 2x
            ..old.clone()
        };
        assert!(!is_safe_config_change(&old, &new));
    }

    #[test]
    fn test_safe_config_slash_at_zero() {
        // Slash rate of 0 should be safe (less than 5000)
        let old = test_config();
        let new = ConfigCellData {
            slash_rate_bps: 0,
            ..old.clone()
        };
        assert!(is_safe_config_change(&old, &new));
    }

    #[test]
    fn test_execute_returns_correct_config() {
        // Verify execute returns the exact proposed new_config
        let new_config = ConfigCellData {
            commit_window_blocks: 80,
            reveal_window_blocks: 20,
            slash_rate_bps: 2500,
            max_price_deviation: 300,
            max_trade_size_bps: 500,
            rate_limit_amount: 2_000_000 * PRECISION,
            rate_limit_window: 7200,
            volume_breaker_limit: 20_000_000 * PRECISION,
            price_breaker_bps: 500,
            withdrawal_breaker_bps: 1500,
            min_pow_difficulty: 20,
        };

        let mut proposal = create_proposal(
            1, test_proposer(), new_config.clone(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        cast_vote(&mut proposal, test_voter(0x01), 5_000_000 * PRECISION, true, 2000).unwrap();
        let end_block = 1000 + DEFAULT_VOTING_PERIOD_BLOCKS + 1;
        finalize_voting(&mut proposal, TOTAL_SUPPLY, end_block).unwrap();
        let result = execute_proposal(&mut proposal, end_block + TIMELOCK_DELAY_BLOCKS + 1).unwrap();

        assert_eq!(result.commit_window_blocks, 80);
        assert_eq!(result.reveal_window_blocks, 20);
        assert_eq!(result.slash_rate_bps, 2500);
        assert_eq!(result.max_price_deviation, 300);
        assert_eq!(result.max_trade_size_bps, 500);
        assert_eq!(result.rate_limit_amount, 2_000_000 * PRECISION);
        assert_eq!(result.rate_limit_window, 7200);
        assert_eq!(result.volume_breaker_limit, 20_000_000 * PRECISION);
        assert_eq!(result.price_breaker_bps, 500);
        assert_eq!(result.withdrawal_breaker_bps, 1500);
        assert_eq!(result.min_pow_difficulty, 20);
    }

    #[test]
    fn test_executed_at_block_recorded() {
        // Verify the executed_at_block field is set correctly
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        cast_vote(&mut proposal, test_voter(0x01), 5_000_000 * PRECISION, true, 2000).unwrap();
        let end_block = 1000 + DEFAULT_VOTING_PERIOD_BLOCKS + 1;
        finalize_voting(&mut proposal, TOTAL_SUPPLY, end_block).unwrap();

        let exec_block = end_block + TIMELOCK_DELAY_BLOCKS + 100;
        execute_proposal(&mut proposal, exec_block).unwrap();

        match proposal.status {
            ProposalStatus::Executed { executed_at_block } => {
                assert_eq!(executed_at_block, exec_block);
            }
            _ => panic!("Expected Executed status"),
        }
    }

    #[test]
    fn test_cancel_queued_by_proposer() {
        // Proposer (not just guardian) should be able to cancel a queued proposal
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        cast_vote(&mut proposal, test_voter(0x01), 5_000_000 * PRECISION, true, 2000).unwrap();
        finalize_voting(&mut proposal, TOTAL_SUPPLY, 1000 + DEFAULT_VOTING_PERIOD_BLOCKS + 1).unwrap();
        assert!(matches!(proposal.status, ProposalStatus::Queued { .. }));

        cancel_proposal(&mut proposal, &test_proposer(), &test_guardian()).unwrap();
        assert_eq!(proposal.status, ProposalStatus::Cancelled);
    }

    #[test]
    fn test_finalize_defeated_by_majority_not_quorum() {
        // Quorum met but votes_against > votes_for => Defeated
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        cast_vote(&mut proposal, test_voter(0x01), 1_000_000 * PRECISION, true, 2000).unwrap();
        cast_vote(&mut proposal, test_voter(0x02), 4_000_000 * PRECISION, false, 3000).unwrap();

        assert!(has_quorum(&proposal, TOTAL_SUPPLY)); // 5M > 4M quorum
        assert!(!has_passed(&proposal, TOTAL_SUPPLY)); // 1M < 4M

        let end_block = 1000 + DEFAULT_VOTING_PERIOD_BLOCKS + 1;
        finalize_voting(&mut proposal, TOTAL_SUPPLY, end_block).unwrap();
        assert_eq!(proposal.status, ProposalStatus::Defeated);
    }

    // ============ Hardening Tests: 101-116 ============

    #[test]
    fn test_create_proposal_max_block_overflow_check() {
        // current_block near u64::MAX could overflow end_block
        // MIN_VOTING_PERIOD_BLOCKS = 43_200, so u64::MAX - 43_200 + 43_200 = u64::MAX
        let current = u64::MAX - MIN_VOTING_PERIOD_BLOCKS;
        let proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            current, MIN_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();
        assert_eq!(proposal.end_block, u64::MAX);
    }

    #[test]
    fn test_cast_vote_large_weight_accumulation() {
        // Multiple votes with large weights approaching u128 overflow territory
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        let large_weight = u128::MAX / 4;
        cast_vote(&mut proposal, test_voter(0x01), large_weight, true, 2000).unwrap();
        cast_vote(&mut proposal, test_voter(0x02), large_weight, true, 3000).unwrap();
        assert_eq!(proposal.votes_for, large_weight * 2);
    }

    #[test]
    fn test_cast_vote_mixed_large_weights() {
        // Large votes both for and against
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        let large = u128::MAX / 4;
        cast_vote(&mut proposal, test_voter(0x01), large, true, 2000).unwrap();
        cast_vote(&mut proposal, test_voter(0x02), large, false, 3000).unwrap();
        assert_eq!(proposal.votes_for, large);
        assert_eq!(proposal.votes_against, large);
    }

    #[test]
    fn test_vote_struct_fields() {
        // Verify Vote struct captures all fields correctly
        let mut proposal = create_proposal(
            42, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        let voter = test_voter(0x77);
        let weight = 999_999 * PRECISION;
        let vote = cast_vote(&mut proposal, voter, weight, false, 5000).unwrap();

        assert_eq!(vote.voter, voter);
        assert_eq!(vote.proposal_id, 42);
        assert_eq!(vote.weight, weight);
        assert!(!vote.support);
    }

    #[test]
    fn test_proposal_description_hash_preserved() {
        // Verify description_hash is stored correctly
        let desc = [0xAB; 32];
        let proposal = create_proposal(
            1, test_proposer(), test_config(), desc,
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();
        assert_eq!(proposal.description_hash, desc);
    }

    #[test]
    fn test_proposal_proposer_preserved() {
        let proposer = [0x42; 32];
        let proposal = create_proposal(
            1, proposer, test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();
        assert_eq!(proposal.proposer, proposer);
    }

    #[test]
    fn test_has_quorum_with_only_against_votes() {
        // Against votes still count toward quorum
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        cast_vote(&mut proposal, test_voter(0x01), 5_000_000 * PRECISION, false, 2000).unwrap();
        assert!(has_quorum(&proposal, TOTAL_SUPPLY),
            "Against votes should count toward quorum");
    }

    #[test]
    fn test_emergency_quorum_exact_threshold() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, MIN_VOTING_PERIOD_BLOCKS, true,
        ).unwrap();

        let emergency_quorum = TOTAL_SUPPLY * EMERGENCY_QUORUM_BPS as u128 / 10_000;
        cast_vote(&mut proposal, test_voter(0x01), emergency_quorum, true, 2000).unwrap();
        assert!(has_quorum(&proposal, TOTAL_SUPPLY),
            "Exactly at emergency quorum threshold should pass");
    }

    #[test]
    fn test_emergency_quorum_one_below() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, MIN_VOTING_PERIOD_BLOCKS, true,
        ).unwrap();

        let emergency_quorum = TOTAL_SUPPLY * EMERGENCY_QUORUM_BPS as u128 / 10_000;
        cast_vote(&mut proposal, test_voter(0x01), emergency_quorum - 1, true, 2000).unwrap();
        assert!(!has_quorum(&proposal, TOTAL_SUPPLY),
            "One below emergency quorum threshold should not pass");
    }

    #[test]
    fn test_multiple_finalize_attempts_on_queued() {
        // Once queued, attempting finalize again should fail
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        cast_vote(&mut proposal, test_voter(0x01), 5_000_000 * PRECISION, true, 2000).unwrap();
        let end_block = 1000 + DEFAULT_VOTING_PERIOD_BLOCKS + 1;
        finalize_voting(&mut proposal, TOTAL_SUPPLY, end_block).unwrap();
        assert!(matches!(proposal.status, ProposalStatus::Queued { .. }));

        let result = finalize_voting(&mut proposal, TOTAL_SUPPLY, end_block + 100);
        assert!(matches!(result, Err(GovernanceError::ProposalNotActive)));
    }

    #[test]
    fn test_safe_config_change_slash_at_exact_50_percent() {
        let old = test_config();
        let new = ConfigCellData {
            slash_rate_bps: 5000, // exactly 50%
            ..old.clone()
        };
        assert!(is_safe_config_change(&old, &new),
            "Slash rate at exactly 50% should be safe");
    }

    #[test]
    fn test_unsafe_config_multiple_violations() {
        // Config that violates multiple safety checks simultaneously
        let old = test_config();
        let new = ConfigCellData {
            commit_window_blocks: old.commit_window_blocks * 3, // > 2x
            reveal_window_blocks: 0,                             // < half
            slash_rate_bps: 9999,                                // > 50%
            min_pow_difficulty: 0,                                // < 1
            volume_breaker_limit: 0,                             // disabled
            price_breaker_bps: 0,                                // disabled
            withdrawal_breaker_bps: 0,                           // disabled
            ..old.clone()
        };
        assert!(!is_safe_config_change(&old, &new));
    }

    #[test]
    fn test_participation_rate_single_token_of_large_supply() {
        // 1 token out of 100M — rate should be ~0 bps (rounds down to 0)
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        cast_vote(&mut proposal, test_voter(0x01), 1, true, 2000).unwrap();
        let rate = participation_rate_bps(&proposal, TOTAL_SUPPLY);
        assert_eq!(rate, 0, "Single token of 100M supply should round to 0 bps");
    }

    #[test]
    fn test_votes_needed_quorum_met_but_behind() {
        // Quorum is met but votes_against leads — need majority, not quorum
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        // 3M for, 5M against = 8M total > 4M quorum, but behind by 2M
        cast_vote(&mut proposal, test_voter(0x01), 3_000_000 * PRECISION, true, 2000).unwrap();
        cast_vote(&mut proposal, test_voter(0x02), 5_000_000 * PRECISION, false, 3000).unwrap();

        let needed = votes_needed_to_pass(&proposal, TOTAL_SUPPLY);
        // Need to overtake: 5M - 3M + 1 = 2_000_001 tokens
        assert_eq!(needed, 2_000_000 * PRECISION + 1);
    }

    #[test]
    fn test_governance_error_variants_distinct() {
        // Verify all error variants are distinguishable
        let errors: Vec<GovernanceError> = vec![
            GovernanceError::InsufficientProposalThreshold,
            GovernanceError::VotingEnded,
            GovernanceError::VotingNotEnded,
            GovernanceError::QuorumNotReached,
            GovernanceError::ProposalDefeated,
            GovernanceError::TimelockNotExpired,
            GovernanceError::ProposalNotActive,
            GovernanceError::TooManyActiveProposals,
            GovernanceError::Unauthorized,
            GovernanceError::AlreadyVoted,
            GovernanceError::InvalidVotingPeriod,
        ];
        // Each pair should be different
        for i in 0..errors.len() {
            for j in (i + 1)..errors.len() {
                assert_ne!(errors[i], errors[j],
                    "Error variants {} and {} should be different", i, j);
            }
        }
    }

    #[test]
    fn test_proposal_status_active_fields() {
        let proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            5000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        match &proposal.status {
            ProposalStatus::Active { start_block, end_block } => {
                assert_eq!(*start_block, 5000);
                assert_eq!(*end_block, 5000 + DEFAULT_VOTING_PERIOD_BLOCKS);
            }
            _ => panic!("Expected Active status"),
        }
    }

    // ============ Hardening Tests — Edge Cases, Boundaries, Error Paths ============

    #[test]
    fn test_can_propose_exact_threshold_2() {
        // 0.1% of 100M = 100_000 tokens
        let threshold = TOTAL_SUPPLY * PROPOSAL_THRESHOLD_BPS as u128 / 10_000;
        assert!(can_propose(threshold, TOTAL_SUPPLY).is_ok());
    }

    #[test]
    fn test_can_propose_one_below_threshold_2() {
        let threshold = TOTAL_SUPPLY * PROPOSAL_THRESHOLD_BPS as u128 / 10_000;
        assert!(matches!(
            can_propose(threshold - 1, TOTAL_SUPPLY),
            Err(GovernanceError::InsufficientProposalThreshold)
        ));
    }

    #[test]
    fn test_can_propose_with_entire_supply() {
        assert!(can_propose(TOTAL_SUPPLY, TOTAL_SUPPLY).is_ok());
    }

    #[test]
    fn test_create_proposal_min_voting_period() {
        let proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, MIN_VOTING_PERIOD_BLOCKS, false,
        );
        assert!(proposal.is_ok());
        let p = proposal.unwrap();
        assert_eq!(p.end_block, 1000 + MIN_VOTING_PERIOD_BLOCKS);
    }

    #[test]
    fn test_create_proposal_very_large_voting_period() {
        let proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, u64::MAX - 1000, false,
        );
        assert!(proposal.is_ok());
    }

    #[test]
    fn test_cast_vote_at_exactly_end_block() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        let end_block = 1000 + DEFAULT_VOTING_PERIOD_BLOCKS;
        // Voting AT end_block should still work (> not >=)
        let result = cast_vote(&mut proposal, test_voter(0x01), 1000 * PRECISION, true, end_block);
        assert!(result.is_ok());
    }

    #[test]
    fn test_cast_vote_one_after_end_block_fails() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        let end_block = 1000 + DEFAULT_VOTING_PERIOD_BLOCKS;
        let result = cast_vote(&mut proposal, test_voter(0x01), 1000 * PRECISION, true, end_block + 1);
        assert!(matches!(result, Err(GovernanceError::VotingEnded)));
    }

    #[test]
    fn test_cast_vote_on_cancelled_proposal_fails() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        cancel_proposal(&mut proposal, &test_proposer(), &test_guardian()).unwrap();

        let result = cast_vote(&mut proposal, test_voter(0x01), 1000 * PRECISION, true, 2000);
        assert!(matches!(result, Err(GovernanceError::ProposalNotActive)));
    }

    #[test]
    fn test_cast_vote_zero_weight_2() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        let vote = cast_vote(&mut proposal, test_voter(0x01), 0, true, 2000).unwrap();
        assert_eq!(vote.weight, 0);
        assert_eq!(proposal.votes_for, 0);
    }

    #[test]
    fn test_has_quorum_normal_just_below() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        // Quorum = 4% of 100M = 4M tokens
        let quorum = TOTAL_SUPPLY * QUORUM_BPS as u128 / 10_000;
        cast_vote(&mut proposal, test_voter(0x01), quorum - 1, true, 2000).unwrap();
        assert!(!has_quorum(&proposal, TOTAL_SUPPLY));
    }

    #[test]
    fn test_has_quorum_normal_exact() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        let quorum = TOTAL_SUPPLY * QUORUM_BPS as u128 / 10_000;
        cast_vote(&mut proposal, test_voter(0x01), quorum, true, 2000).unwrap();
        assert!(has_quorum(&proposal, TOTAL_SUPPLY));
    }

    #[test]
    fn test_has_quorum_emergency_higher_threshold() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, true, // emergency
        ).unwrap();

        // Normal quorum (4%) would pass, but emergency needs 10%
        let normal_quorum = TOTAL_SUPPLY * QUORUM_BPS as u128 / 10_000;
        cast_vote(&mut proposal, test_voter(0x01), normal_quorum, true, 2000).unwrap();
        assert!(!has_quorum(&proposal, TOTAL_SUPPLY));

        // Add enough to reach emergency quorum
        let emergency_quorum = TOTAL_SUPPLY * EMERGENCY_QUORUM_BPS as u128 / 10_000;
        cast_vote(&mut proposal, test_voter(0x02), emergency_quorum - normal_quorum, true, 2000).unwrap();
        assert!(has_quorum(&proposal, TOTAL_SUPPLY));
    }

    #[test]
    fn test_has_passed_requires_majority() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        // Equal votes (quorum met but no majority)
        let quorum = TOTAL_SUPPLY * QUORUM_BPS as u128 / 10_000;
        cast_vote(&mut proposal, test_voter(0x01), quorum / 2, true, 2000).unwrap();
        cast_vote(&mut proposal, test_voter(0x02), quorum / 2, false, 2000).unwrap();
        assert!(!has_passed(&proposal, TOTAL_SUPPLY));
    }

    #[test]
    fn test_finalize_voting_before_end_block_fails() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        let end_block = 1000 + DEFAULT_VOTING_PERIOD_BLOCKS;
        let result = finalize_voting(&mut proposal, TOTAL_SUPPLY, end_block);
        assert!(matches!(result, Err(GovernanceError::VotingNotEnded)));
    }

    #[test]
    fn test_finalize_voting_defeated_no_quorum() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        // No votes cast → no quorum
        let end_block = 1000 + DEFAULT_VOTING_PERIOD_BLOCKS;
        finalize_voting(&mut proposal, TOTAL_SUPPLY, end_block + 1).unwrap();
        assert!(matches!(proposal.status, ProposalStatus::Defeated));
    }

    #[test]
    fn test_finalize_voting_defeated_more_against() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        let quorum = TOTAL_SUPPLY * QUORUM_BPS as u128 / 10_000;
        cast_vote(&mut proposal, test_voter(0x01), quorum / 3, true, 2000).unwrap();
        cast_vote(&mut proposal, test_voter(0x02), quorum, false, 2000).unwrap();

        let end_block = 1000 + DEFAULT_VOTING_PERIOD_BLOCKS;
        finalize_voting(&mut proposal, TOTAL_SUPPLY, end_block + 1).unwrap();
        assert!(matches!(proposal.status, ProposalStatus::Defeated));
    }

    #[test]
    fn test_finalize_voting_queued_normal_timelock() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        let big_vote = TOTAL_SUPPLY / 2;
        cast_vote(&mut proposal, test_voter(0x01), big_vote, true, 2000).unwrap();

        let end_block = 1000 + DEFAULT_VOTING_PERIOD_BLOCKS;
        finalize_voting(&mut proposal, TOTAL_SUPPLY, end_block + 1).unwrap();

        match &proposal.status {
            ProposalStatus::Queued { execute_after_block } => {
                assert_eq!(*execute_after_block, end_block + 1 + TIMELOCK_DELAY_BLOCKS);
            }
            _ => panic!("Expected Queued status"),
        }
    }

    #[test]
    fn test_finalize_voting_queued_emergency_timelock() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, true, // emergency
        ).unwrap();

        let big_vote = TOTAL_SUPPLY / 2;
        cast_vote(&mut proposal, test_voter(0x01), big_vote, true, 2000).unwrap();

        let end_block = 1000 + DEFAULT_VOTING_PERIOD_BLOCKS;
        finalize_voting(&mut proposal, TOTAL_SUPPLY, end_block + 1).unwrap();

        match &proposal.status {
            ProposalStatus::Queued { execute_after_block } => {
                assert_eq!(*execute_after_block, end_block + 1 + EMERGENCY_TIMELOCK_BLOCKS);
            }
            _ => panic!("Expected Queued status"),
        }
    }

    #[test]
    fn test_execute_before_timelock_fails() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        let big_vote = TOTAL_SUPPLY / 2;
        cast_vote(&mut proposal, test_voter(0x01), big_vote, true, 2000).unwrap();
        let end_block = 1000 + DEFAULT_VOTING_PERIOD_BLOCKS;
        finalize_voting(&mut proposal, TOTAL_SUPPLY, end_block + 1).unwrap();

        let execute_after = end_block + 1 + TIMELOCK_DELAY_BLOCKS;
        let result = execute_proposal(&mut proposal, execute_after - 1);
        assert!(matches!(result, Err(GovernanceError::TimelockNotExpired)));
    }

    #[test]
    fn test_execute_at_exact_timelock() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        let big_vote = TOTAL_SUPPLY / 2;
        cast_vote(&mut proposal, test_voter(0x01), big_vote, true, 2000).unwrap();
        let end_block = 1000 + DEFAULT_VOTING_PERIOD_BLOCKS;
        finalize_voting(&mut proposal, TOTAL_SUPPLY, end_block + 1).unwrap();

        let execute_after = end_block + 1 + TIMELOCK_DELAY_BLOCKS;
        let result = execute_proposal(&mut proposal, execute_after);
        assert!(result.is_ok());
    }

    #[test]
    fn test_execute_active_proposal_fails() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        let result = execute_proposal(&mut proposal, 50000);
        assert!(matches!(result, Err(GovernanceError::ProposalNotActive)));
    }

    #[test]
    fn test_execute_defeated_proposal_fails_2() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        let end_block = 1000 + DEFAULT_VOTING_PERIOD_BLOCKS;
        finalize_voting(&mut proposal, TOTAL_SUPPLY, end_block + 1).unwrap();

        let result = execute_proposal(&mut proposal, end_block + 100_000);
        assert!(matches!(result, Err(GovernanceError::ProposalNotActive)));
    }

    #[test]
    fn test_cancel_by_guardian_2() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        let result = cancel_proposal(&mut proposal, &test_guardian(), &test_guardian());
        assert!(result.is_ok());
        assert!(matches!(proposal.status, ProposalStatus::Cancelled));
    }

    #[test]
    fn test_cancel_by_proposer_2() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        let result = cancel_proposal(&mut proposal, &test_proposer(), &test_guardian());
        assert!(result.is_ok());
    }

    #[test]
    fn test_cancel_by_unauthorized_fails() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        let random = [0x99; 32];
        let result = cancel_proposal(&mut proposal, &random, &test_guardian());
        assert!(matches!(result, Err(GovernanceError::Unauthorized)));
    }

    #[test]
    fn test_cancel_executed_proposal_fails() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        let big_vote = TOTAL_SUPPLY / 2;
        cast_vote(&mut proposal, test_voter(0x01), big_vote, true, 2000).unwrap();
        let end_block = 1000 + DEFAULT_VOTING_PERIOD_BLOCKS;
        finalize_voting(&mut proposal, TOTAL_SUPPLY, end_block + 1).unwrap();
        execute_proposal(&mut proposal, end_block + 1 + TIMELOCK_DELAY_BLOCKS).unwrap();

        let result = cancel_proposal(&mut proposal, &test_proposer(), &test_guardian());
        assert!(matches!(result, Err(GovernanceError::ProposalNotActive)));
    }

    #[test]
    fn test_participation_rate_half_supply() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        cast_vote(&mut proposal, test_voter(0x01), TOTAL_SUPPLY / 2, true, 2000).unwrap();
        assert_eq!(participation_rate_bps(&proposal, TOTAL_SUPPLY), 5000);
    }

    #[test]
    fn test_participation_rate_zero_supply_2() {
        let proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();
        assert_eq!(participation_rate_bps(&proposal, 0), 0);
    }

    #[test]
    fn test_approval_rate_all_for() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        cast_vote(&mut proposal, test_voter(0x01), 1000 * PRECISION, true, 2000).unwrap();
        assert_eq!(approval_rate_bps(&proposal), 10_000);
    }

    #[test]
    fn test_approval_rate_all_against_2() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        cast_vote(&mut proposal, test_voter(0x01), 1000 * PRECISION, false, 2000).unwrap();
        assert_eq!(approval_rate_bps(&proposal), 0);
    }

    #[test]
    fn test_approval_rate_no_votes() {
        let proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();
        assert_eq!(approval_rate_bps(&proposal), 0);
    }

    #[test]
    fn test_is_safe_config_change_double_commit_window() {
        let old = test_config();
        let mut new = test_config();
        new.commit_window_blocks = old.commit_window_blocks * 2;
        assert!(is_safe_config_change(&old, &new));
    }

    #[test]
    fn test_is_safe_config_change_more_than_double_commit() {
        let old = test_config();
        let mut new = test_config();
        new.commit_window_blocks = old.commit_window_blocks * 2 + 1;
        assert!(!is_safe_config_change(&old, &new));
    }

    #[test]
    fn test_is_safe_config_change_half_commit_window() {
        let old = test_config();
        let mut new = test_config();
        new.commit_window_blocks = old.commit_window_blocks / 2;
        assert!(is_safe_config_change(&old, &new));
    }

    #[test]
    fn test_is_safe_config_change_slash_over_50_percent() {
        let old = test_config();
        let mut new = test_config();
        new.slash_rate_bps = 5001;
        assert!(!is_safe_config_change(&old, &new));
    }

    #[test]
    fn test_is_safe_config_change_pow_difficulty_zero() {
        let old = test_config();
        let mut new = test_config();
        new.min_pow_difficulty = 0;
        assert!(!is_safe_config_change(&old, &new));
    }

    #[test]
    fn test_is_safe_config_change_volume_breaker_zero() {
        let old = test_config();
        let mut new = test_config();
        new.volume_breaker_limit = 0;
        assert!(!is_safe_config_change(&old, &new));
    }

    #[test]
    fn test_is_safe_config_change_price_breaker_zero() {
        let old = test_config();
        let mut new = test_config();
        new.price_breaker_bps = 0;
        assert!(!is_safe_config_change(&old, &new));
    }

    #[test]
    fn test_is_safe_config_change_withdrawal_breaker_zero() {
        let old = test_config();
        let mut new = test_config();
        new.withdrawal_breaker_bps = 0;
        assert!(!is_safe_config_change(&old, &new));
    }

    #[test]
    fn test_votes_needed_no_votes_emergency() {
        let proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, true,
        ).unwrap();
        let needed = votes_needed_to_pass(&proposal, TOTAL_SUPPLY);
        let emergency_quorum = TOTAL_SUPPLY * EMERGENCY_QUORUM_BPS as u128 / 10_000;
        // Need quorum (10M) + majority (at least 1 vote for)
        assert_eq!(needed, emergency_quorum);
    }

    #[test]
    fn test_votes_needed_already_passing_2() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        let big_vote = TOTAL_SUPPLY / 2;
        cast_vote(&mut proposal, test_voter(0x01), big_vote, true, 2000).unwrap();
        assert_eq!(votes_needed_to_pass(&proposal, TOTAL_SUPPLY), 0);
    }

    #[test]
    fn test_finalize_already_cancelled_fails() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        cancel_proposal(&mut proposal, &test_proposer(), &test_guardian()).unwrap();
        let end_block = 1000 + DEFAULT_VOTING_PERIOD_BLOCKS;
        let result = finalize_voting(&mut proposal, TOTAL_SUPPLY, end_block + 1);
        assert!(matches!(result, Err(GovernanceError::ProposalNotActive)));
    }

    #[test]
    fn test_vote_struct_fields_against() {
        let mut proposal = create_proposal(
            42, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        let voter = test_voter(0xBB);
        let vote = cast_vote(&mut proposal, voter, 999 * PRECISION, false, 2000).unwrap();
        assert_eq!(vote.voter, voter);
        assert_eq!(vote.proposal_id, 42);
        assert_eq!(vote.weight, 999 * PRECISION);
        assert!(!vote.support);
    }

    #[test]
    fn test_execute_returns_new_config() {
        let mut proposal = create_proposal(
            1, test_proposer(), test_config(), test_desc_hash(),
            1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
        ).unwrap();

        // Modify the config we're proposing
        proposal.new_config.commit_window_blocks = 80;

        let big_vote = TOTAL_SUPPLY / 2;
        cast_vote(&mut proposal, test_voter(0x01), big_vote, true, 2000).unwrap();
        let end_block = 1000 + DEFAULT_VOTING_PERIOD_BLOCKS;
        finalize_voting(&mut proposal, TOTAL_SUPPLY, end_block + 1).unwrap();

        let config = execute_proposal(&mut proposal, end_block + 1 + TIMELOCK_DELAY_BLOCKS).unwrap();
        assert_eq!(config.commit_window_blocks, 80);
    }

    #[test]
    fn test_is_safe_config_reveal_window_more_than_double() {
        let old = test_config();
        let mut new = test_config();
        new.reveal_window_blocks = old.reveal_window_blocks * 2 + 1;
        assert!(!is_safe_config_change(&old, &new));
    }

    #[test]
    fn test_is_safe_config_reveal_window_less_than_half() {
        let old = test_config();
        let mut new = test_config();
        // old is 10, half is 5, so 4 should fail
        new.reveal_window_blocks = old.reveal_window_blocks / 2 - 1;
        assert!(!is_safe_config_change(&old, &new));
    }

    // ============ Hardening Tests v4 ============

    #[test]
    fn test_create_proposal_preserves_all_fields_v4() {
        let cfg = test_config();
        let proposer = test_proposer();
        let desc = test_desc_hash();
        let p = create_proposal(42, proposer, cfg.clone(), desc, 1000, 100_800, false).unwrap();
        assert_eq!(p.id, 42);
        assert_eq!(p.proposer, proposer);
        assert_eq!(p.start_block, 1000);
        assert_eq!(p.end_block, 1000 + 100_800);
        assert_eq!(p.description_hash, desc);
        assert!(!p.is_emergency);
        assert_eq!(p.votes_for, 0);
        assert_eq!(p.votes_against, 0);
    }

    #[test]
    fn test_cast_vote_accumulates_correctly_v4() {
        let cfg = test_config();
        let mut p = create_proposal(1, test_proposer(), cfg, test_desc_hash(), 0, 100_800, false).unwrap();
        let _v1 = cast_vote(&mut p, test_voter(1), 100, true, 50_000).unwrap();
        let _v2 = cast_vote(&mut p, test_voter(2), 200, true, 50_000).unwrap();
        let _v3 = cast_vote(&mut p, test_voter(3), 50, false, 50_000).unwrap();
        assert_eq!(p.votes_for, 300);
        assert_eq!(p.votes_against, 50);
    }

    #[test]
    fn test_has_quorum_boundary_exactly_at_threshold_v4() {
        let cfg = test_config();
        let mut p = create_proposal(1, test_proposer(), cfg, test_desc_hash(), 0, 100_800, false).unwrap();
        let total_supply: u128 = 10_000;
        // Quorum = 4% of 10000 = 400
        let _ = cast_vote(&mut p, test_voter(1), 400, true, 1000);
        assert!(has_quorum(&p, total_supply));
    }

    #[test]
    fn test_has_quorum_one_below_threshold_v4() {
        let cfg = test_config();
        let mut p = create_proposal(1, test_proposer(), cfg, test_desc_hash(), 0, 100_800, false).unwrap();
        let total_supply: u128 = 10_000;
        let _ = cast_vote(&mut p, test_voter(1), 399, true, 1000);
        assert!(!has_quorum(&p, total_supply));
    }

    #[test]
    fn test_has_passed_requires_strict_majority_v4() {
        let cfg = test_config();
        let mut p = create_proposal(1, test_proposer(), cfg, test_desc_hash(), 0, 100_800, false).unwrap();
        let total_supply: u128 = 10_000;
        let _ = cast_vote(&mut p, test_voter(1), 200, true, 1000);
        let _ = cast_vote(&mut p, test_voter(2), 200, false, 1000);
        // Quorum met (400 >= 400), but tie = not passed
        assert!(has_quorum(&p, total_supply));
        assert!(!has_passed(&p, total_supply));
    }

    #[test]
    fn test_finalize_queued_has_correct_timelock_v4() {
        let cfg = test_config();
        let mut p = create_proposal(1, test_proposer(), cfg, test_desc_hash(), 0, 100_800, false).unwrap();
        let _ = cast_vote(&mut p, test_voter(1), 500, true, 1000);
        finalize_voting(&mut p, 1_000, 100_801).unwrap();
        match p.status {
            ProposalStatus::Queued { execute_after_block } => {
                assert_eq!(execute_after_block, 100_801 + TIMELOCK_DELAY_BLOCKS);
            }
            _ => panic!("Expected Queued"),
        }
    }

    #[test]
    fn test_finalize_emergency_shorter_timelock_v4() {
        let cfg = test_config();
        let mut p = create_proposal(1, test_proposer(), cfg, test_desc_hash(), 0, 100_800, true).unwrap();
        let _ = cast_vote(&mut p, test_voter(1), 1500, true, 1000);
        finalize_voting(&mut p, 10_000, 100_801).unwrap();
        match p.status {
            ProposalStatus::Queued { execute_after_block } => {
                assert_eq!(execute_after_block, 100_801 + EMERGENCY_TIMELOCK_BLOCKS);
            }
            _ => panic!("Expected Queued"),
        }
    }

    #[test]
    fn test_execute_one_block_after_timelock_v4() {
        let cfg = test_config();
        let mut p = create_proposal(1, test_proposer(), cfg.clone(), test_desc_hash(), 0, 100_800, false).unwrap();
        let _ = cast_vote(&mut p, test_voter(1), 500, true, 1000);
        finalize_voting(&mut p, 1_000, 100_801).unwrap();
        let timelock_end = 100_801 + TIMELOCK_DELAY_BLOCKS;
        let result = execute_proposal(&mut p, timelock_end + 1);
        assert!(result.is_ok());
    }

    #[test]
    fn test_cancel_by_neither_proposer_nor_guardian_v4() {
        let cfg = test_config();
        let mut p = create_proposal(1, test_proposer(), cfg, test_desc_hash(), 0, 100_800, false).unwrap();
        let random = [0x99; 32];
        let result = cancel_proposal(&mut p, &random, &test_guardian());
        assert_eq!(result, Err(GovernanceError::Unauthorized));
    }

    #[test]
    fn test_participation_rate_100_percent_v4() {
        let cfg = test_config();
        let mut p = create_proposal(1, test_proposer(), cfg, test_desc_hash(), 0, 100_800, false).unwrap();
        let total_supply: u128 = 1_000;
        let _ = cast_vote(&mut p, test_voter(1), 1_000, true, 1000);
        assert_eq!(participation_rate_bps(&p, total_supply), 10_000);
    }

    #[test]
    fn test_approval_rate_75_percent_v4() {
        let cfg = test_config();
        let mut p = create_proposal(1, test_proposer(), cfg, test_desc_hash(), 0, 100_800, false).unwrap();
        let _ = cast_vote(&mut p, test_voter(1), 750, true, 1000);
        let _ = cast_vote(&mut p, test_voter(2), 250, false, 1000);
        assert_eq!(approval_rate_bps(&p), 7_500);
    }

    #[test]
    fn test_votes_needed_when_behind_majority_v4() {
        let cfg = test_config();
        let mut p = create_proposal(1, test_proposer(), cfg, test_desc_hash(), 0, 100_800, false).unwrap();
        let _ = cast_vote(&mut p, test_voter(1), 100, true, 1000);
        let _ = cast_vote(&mut p, test_voter(2), 300, false, 1000);
        let total_supply: u128 = 10_000;
        let needed = votes_needed_to_pass(&p, total_supply);
        // Need 201 to beat 300 against. Quorum already met (400 >= 400).
        assert_eq!(needed, 201);
    }

    #[test]
    fn test_votes_needed_when_no_votes_v4() {
        let cfg = test_config();
        let p = create_proposal(1, test_proposer(), cfg, test_desc_hash(), 0, 100_800, false).unwrap();
        let total_supply: u128 = 10_000;
        let needed = votes_needed_to_pass(&p, total_supply);
        // Need quorum (400) AND majority (1 for vote)
        assert_eq!(needed, 400);
    }

    #[test]
    fn test_safe_config_change_exact_2x_commit_v4() {
        let old = test_config();
        let mut new = test_config();
        new.commit_window_blocks = old.commit_window_blocks * 2;
        assert!(is_safe_config_change(&old, &new));
    }

    #[test]
    fn test_unsafe_config_change_3x_commit_v4() {
        let old = test_config();
        let mut new = test_config();
        new.commit_window_blocks = old.commit_window_blocks * 3;
        assert!(!is_safe_config_change(&old, &new));
    }

    #[test]
    fn test_safe_config_change_slash_at_50_percent_v4() {
        let old = test_config();
        let mut new = test_config();
        new.slash_rate_bps = 5000;
        assert!(is_safe_config_change(&old, &new));
    }

    #[test]
    fn test_unsafe_config_change_slash_at_50_01_percent_v4() {
        let old = test_config();
        let mut new = test_config();
        new.slash_rate_bps = 5001;
        assert!(!is_safe_config_change(&old, &new));
    }

    #[test]
    fn test_cast_vote_preserves_vote_fields_v4() {
        let cfg = test_config();
        let mut p = create_proposal(1, test_proposer(), cfg, test_desc_hash(), 0, 100_800, false).unwrap();
        let voter_addr = test_voter(5);
        let vote = cast_vote(&mut p, voter_addr, 777, false, 50_000).unwrap();
        assert_eq!(vote.voter, voter_addr);
        assert_eq!(vote.proposal_id, 1);
        assert_eq!(vote.weight, 777);
        assert!(!vote.support);
    }

    #[test]
    fn test_finalize_already_queued_fails_v4() {
        let cfg = test_config();
        let mut p = create_proposal(1, test_proposer(), cfg, test_desc_hash(), 0, 100_800, false).unwrap();
        let _ = cast_vote(&mut p, test_voter(1), 500, true, 1000);
        finalize_voting(&mut p, 1_000, 100_801).unwrap();
        let result = finalize_voting(&mut p, 1_000, 200_000);
        assert_eq!(result, Err(GovernanceError::ProposalNotActive));
    }

    #[test]
    fn test_cancel_queued_by_guardian_v4() {
        let cfg = test_config();
        let mut p = create_proposal(1, test_proposer(), cfg, test_desc_hash(), 0, 100_800, false).unwrap();
        let _ = cast_vote(&mut p, test_voter(1), 500, true, 1000);
        finalize_voting(&mut p, 1_000, 100_801).unwrap();
        let result = cancel_proposal(&mut p, &test_guardian(), &test_guardian());
        assert!(result.is_ok());
        assert_eq!(p.status, ProposalStatus::Cancelled);
    }

    #[test]
    fn test_governance_error_all_variants_exist_v4() {
        // Ensure all error variants are constructable
        let errors = vec![
            GovernanceError::InsufficientProposalThreshold,
            GovernanceError::VotingEnded,
            GovernanceError::VotingNotEnded,
            GovernanceError::QuorumNotReached,
            GovernanceError::ProposalDefeated,
            GovernanceError::TimelockNotExpired,
            GovernanceError::ProposalNotActive,
            GovernanceError::TooManyActiveProposals,
            GovernanceError::Unauthorized,
            GovernanceError::AlreadyVoted,
            GovernanceError::InvalidVotingPeriod,
        ];
        assert_eq!(errors.len(), 11);
        // Each should be distinct
        for i in 0..errors.len() {
            for j in (i+1)..errors.len() {
                assert_ne!(errors[i], errors[j]);
            }
        }
    }

    #[test]
    fn test_proposal_status_variants_v4() {
        let active = ProposalStatus::Active { start_block: 0, end_block: 100 };
        let queued = ProposalStatus::Queued { execute_after_block: 200 };
        let executed = ProposalStatus::Executed { executed_at_block: 300 };
        let cancelled = ProposalStatus::Cancelled;
        let defeated = ProposalStatus::Defeated;
        let expired = ProposalStatus::Expired;
        assert_ne!(active, queued);
        assert_ne!(queued, executed);
        assert_ne!(cancelled, defeated);
        assert_ne!(defeated, expired);
    }

    #[test]
    fn test_can_propose_large_supply_v4() {
        // With very large supply, threshold is still proportional
        let supply: u128 = u64::MAX as u128;
        let threshold = supply * PROPOSAL_THRESHOLD_BPS as u128 / 10_000;
        assert!(can_propose(threshold, supply).is_ok());
        assert!(can_propose(threshold - 1, supply).is_err());
    }

    #[test]
    fn test_participation_rate_exceeds_100_capped_v4() {
        let cfg = test_config();
        let mut p = create_proposal(1, test_proposer(), cfg, test_desc_hash(), 0, 100_800, false).unwrap();
        // Vote weight exceeds total supply — capped at 10000
        let _ = cast_vote(&mut p, test_voter(1), 20_000, true, 1000);
        assert_eq!(participation_rate_bps(&p, 10_000), 10_000);
    }

    #[test]
    fn test_votes_needed_already_passing_zero_v4() {
        let cfg = test_config();
        let mut p = create_proposal(1, test_proposer(), cfg, test_desc_hash(), 0, 100_800, false).unwrap();
        let total_supply: u128 = 1_000;
        let _ = cast_vote(&mut p, test_voter(1), 500, true, 1000);
        let needed = votes_needed_to_pass(&p, total_supply);
        // Already exceeds quorum (40) and has majority
        assert_eq!(needed, 0);
    }
}
