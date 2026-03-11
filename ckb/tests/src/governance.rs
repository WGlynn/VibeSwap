// ============ Governance Integration Tests ============
// End-to-end testing of governance flows integrated with protocol operations.
// Tests the full pipeline: propose → vote → timelock → execute → config updated.

use vibeswap_types::*;
use vibeswap_sdk::governance::{self, *};
use vibeswap_sdk::{VibeSwapSDK, DeploymentInfo, CellInput, Script, HashType};
use vibeswap_math::PRECISION;

// ============ Helpers ============

fn test_sdk() -> VibeSwapSDK {
    VibeSwapSDK::new(DeploymentInfo {
        pow_lock_code_hash: [0x01; 32],
        batch_auction_type_code_hash: [0x02; 32],
        commit_type_code_hash: [0x03; 32],
        amm_pool_type_code_hash: [0x04; 32],
        lp_position_type_code_hash: [0x05; 32],
        compliance_type_code_hash: [0x06; 32],
        config_type_code_hash: [0x07; 32],
        oracle_type_code_hash: [0x08; 32],
        knowledge_type_code_hash: [0x09; 32],
        lending_pool_type_code_hash: [0x0A; 32],
        vault_type_code_hash: [0x0B; 32],
        insurance_pool_type_code_hash: [0x0C; 32],
        prediction_market_type_code_hash: [0x0D; 32],
        script_dep_tx_hash: [0x10; 32],
        script_dep_index: 0,
    })
}

fn governance_lock() -> Script {
    Script { code_hash: [0xDA; 32], hash_type: HashType::Type, args: vec![0xDA; 20] }
}

fn base_config() -> ConfigCellData {
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

const TOTAL_SUPPLY: u128 = 100_000_000 * PRECISION;
fn voter(id: u8) -> [u8; 32] { [id; 32] }
fn proposer() -> [u8; 32] { [0xA1; 32] }
fn guardian() -> [u8; 32] { [0xFF; 32] }

// ============ Governance → Config Update Integration ============

#[test]
fn test_governance_propose_vote_execute_config_update() {
    let sdk = test_sdk();

    // Current on-chain config
    let current_config = base_config();

    // Step 1: Propose new config via governance
    let new_config = ConfigCellData {
        commit_window_blocks: 60, // Increase batch window
        reveal_window_blocks: 15, // Slight increase
        ..current_config.clone()
    };

    assert!(can_propose(200_000 * PRECISION, TOTAL_SUPPLY).is_ok());

    let mut proposal = create_proposal(
        1, proposer(), new_config.clone(), [0xDD; 32],
        1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
    ).unwrap();

    // Step 2: Community votes
    cast_vote(&mut proposal, voter(0x01), 3_000_000 * PRECISION, true, 5000).unwrap();
    cast_vote(&mut proposal, voter(0x02), 2_000_000 * PRECISION, true, 6000).unwrap();
    cast_vote(&mut proposal, voter(0x03), 500_000 * PRECISION, false, 7000).unwrap();

    // Verify: quorum met (5.5M > 4M threshold), majority (5M > 0.5M)
    assert!(has_quorum(&proposal, TOTAL_SUPPLY));
    assert!(has_passed(&proposal, TOTAL_SUPPLY));

    // Step 3: Finalize → queue with timelock
    let end_block = 1000 + DEFAULT_VOTING_PERIOD_BLOCKS + 1;
    finalize_voting(&mut proposal, TOTAL_SUPPLY, end_block).unwrap();

    // Step 4: Execute after timelock
    let execute_block = end_block + TIMELOCK_DELAY_BLOCKS + 1;
    let approved_config = execute_proposal(&mut proposal, execute_block).unwrap();

    // Step 5: Apply via SDK — build the config update transaction
    let tx = sdk.update_config(
        CellInput { tx_hash: [0xCF; 32], index: 0, since: 0 },
        approved_config.clone(),
        governance_lock(),
    );

    // Verify transaction structure
    assert_eq!(tx.inputs.len(), 1);  // Old config consumed
    assert_eq!(tx.outputs.len(), 1); // New config created

    // Verify new config in output matches governance-approved config
    let output_config = ConfigCellData::deserialize(&tx.outputs[0].data).unwrap();
    assert_eq!(output_config.commit_window_blocks, 60);
    assert_eq!(output_config.reveal_window_blocks, 15);
    assert_eq!(output_config.slash_rate_bps, current_config.slash_rate_bps); // Unchanged
}

// ============ Safe Config Validation ============

#[test]
fn test_governance_blocks_unsafe_config_via_validation() {
    let current = base_config();

    // Dangerous proposal: disable circuit breakers
    let dangerous = ConfigCellData {
        volume_breaker_limit: 0,      // DISABLED
        price_breaker_bps: 0,         // DISABLED
        withdrawal_breaker_bps: 0,    // DISABLED
        ..current.clone()
    };

    assert!(!is_safe_config_change(&current, &dangerous));

    // Safe proposal: double the rate limit
    let safe = ConfigCellData {
        rate_limit_amount: 2_000_000 * PRECISION,
        ..current.clone()
    };

    assert!(is_safe_config_change(&current, &safe));
}

// ============ Emergency Governance Path ============

#[test]
fn test_emergency_governance_faster_execution() {
    let current = base_config();

    // Emergency: reduce PoW difficulty to speed up settlement during high load
    let emergency_config = ConfigCellData {
        min_pow_difficulty: 5, // Reduced from 10
        ..current.clone()
    };

    let mut proposal = create_proposal(
        99, proposer(), emergency_config, [0xEE; 32],
        1000, MIN_VOTING_PERIOD_BLOCKS, true, // Emergency
    ).unwrap();

    // Emergency needs 10% quorum
    cast_vote(&mut proposal, voter(0x01), 10_000_001 * PRECISION, true, 2000).unwrap();
    assert!(has_quorum(&proposal, TOTAL_SUPPLY));

    let end_block = 1000 + MIN_VOTING_PERIOD_BLOCKS + 1;
    finalize_voting(&mut proposal, TOTAL_SUPPLY, end_block).unwrap();

    // Emergency timelock: 3600 blocks (≈ 6 hours) vs normal 28800 (≈ 2 days)
    let emergency_execute_block = end_block + EMERGENCY_TIMELOCK_BLOCKS + 1;
    let normal_would_be = end_block + TIMELOCK_DELAY_BLOCKS + 1;

    // Can execute much sooner
    assert!(emergency_execute_block < normal_would_be);
    let config = execute_proposal(&mut proposal, emergency_execute_block).unwrap();
    assert_eq!(config.min_pow_difficulty, 5);
}

// ============ Governance Attack Resistance ============

#[test]
fn test_whale_cannot_bypass_timelock() {
    // Even a 51% holder must wait through timelock
    let mut proposal = create_proposal(
        1, proposer(), base_config(), [0xDD; 32],
        1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
    ).unwrap();

    // Whale votes with 60% of supply
    cast_vote(&mut proposal, voter(0x01), 60_000_000 * PRECISION, true, 2000).unwrap();

    let end_block = 1000 + DEFAULT_VOTING_PERIOD_BLOCKS + 1;
    finalize_voting(&mut proposal, TOTAL_SUPPLY, end_block).unwrap();

    // Try to execute during timelock — must fail
    let result = execute_proposal(&mut proposal, end_block + 1);
    assert!(matches!(result, Err(GovernanceError::TimelockNotExpired)));
}

#[test]
fn test_guardian_cancels_malicious_proposal() {
    // Attacker proposes disabling PoW
    let malicious = ConfigCellData {
        min_pow_difficulty: 0, // Effectively disable PoW
        volume_breaker_limit: 0, // Disable circuit breaker
        ..base_config()
    };

    let mut proposal = create_proposal(
        666, [0xBA; 32], malicious, [0xDD; 32],
        1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
    ).unwrap();

    // Somehow gets votes (sybil attack etc)
    cast_vote(&mut proposal, voter(0x01), 5_000_000 * PRECISION, true, 2000).unwrap();

    // Guardian detects unsafe config and cancels
    assert!(!is_safe_config_change(&base_config(), &proposal.new_config));
    cancel_proposal(&mut proposal, &guardian(), &guardian()).unwrap();
    assert_eq!(proposal.status, ProposalStatus::Cancelled);
}

#[test]
fn test_insufficient_quorum_defeats_proposal() {
    let mut proposal = create_proposal(
        1, proposer(), base_config(), [0xDD; 32],
        1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
    ).unwrap();

    // Only 2% votes — below 4% quorum
    cast_vote(&mut proposal, voter(0x01), 2_000_000 * PRECISION, true, 2000).unwrap();

    let end_block = 1000 + DEFAULT_VOTING_PERIOD_BLOCKS + 1;
    finalize_voting(&mut proposal, TOTAL_SUPPLY, end_block).unwrap();
    assert_eq!(proposal.status, ProposalStatus::Defeated);
}

#[test]
fn test_close_vote_majority_rules() {
    // 51% vs 49% — passes with quorum
    let mut proposal = create_proposal(
        1, proposer(), base_config(), [0xDD; 32],
        1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
    ).unwrap();

    cast_vote(&mut proposal, voter(0x01), 2_100_000 * PRECISION, true, 2000).unwrap();
    cast_vote(&mut proposal, voter(0x02), 2_000_000 * PRECISION, false, 3000).unwrap();

    assert!(has_quorum(&proposal, TOTAL_SUPPLY)); // 4.1M > 4M
    assert!(has_passed(&proposal, TOTAL_SUPPLY));  // 2.1M > 2.0M

    let end_block = 1000 + DEFAULT_VOTING_PERIOD_BLOCKS + 1;
    finalize_voting(&mut proposal, TOTAL_SUPPLY, end_block).unwrap();
    assert!(matches!(proposal.status, ProposalStatus::Queued { .. }));
}

// ============ Multi-Proposal Scenario ============

#[test]
fn test_multiple_proposals_independent() {
    // Two proposals can coexist and resolve independently
    let mut proposal_a = create_proposal(
        1, proposer(),
        ConfigCellData { commit_window_blocks: 50, ..base_config() },
        [0xAA; 32], 1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
    ).unwrap();

    let mut proposal_b = create_proposal(
        2, proposer(),
        ConfigCellData { reveal_window_blocks: 20, ..base_config() },
        [0xBB; 32], 1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
    ).unwrap();

    // A gets lots of support
    cast_vote(&mut proposal_a, voter(0x01), 8_000_000 * PRECISION, true, 2000).unwrap();

    // B gets defeated
    cast_vote(&mut proposal_b, voter(0x02), 3_000_000 * PRECISION, false, 2000).unwrap();
    cast_vote(&mut proposal_b, voter(0x03), 2_000_000 * PRECISION, true, 3000).unwrap();

    let end_block = 1000 + DEFAULT_VOTING_PERIOD_BLOCKS + 1;

    finalize_voting(&mut proposal_a, TOTAL_SUPPLY, end_block).unwrap();
    finalize_voting(&mut proposal_b, TOTAL_SUPPLY, end_block).unwrap();

    assert!(matches!(proposal_a.status, ProposalStatus::Queued { .. }));
    assert_eq!(proposal_b.status, ProposalStatus::Defeated);
}

// ============ Analytics Integration ============

#[test]
fn test_governance_analytics_throughout_lifecycle() {
    let mut proposal = create_proposal(
        1, proposer(), base_config(), [0xDD; 32],
        1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
    ).unwrap();

    // Phase 1: No votes
    assert_eq!(participation_rate_bps(&proposal, TOTAL_SUPPLY), 0);
    assert_eq!(approval_rate_bps(&proposal), 0);
    assert_eq!(votes_needed_to_pass(&proposal, TOTAL_SUPPLY), 4_000_000 * PRECISION);

    // Phase 2: Some votes
    cast_vote(&mut proposal, voter(0x01), 3_000_000 * PRECISION, true, 2000).unwrap();
    assert_eq!(participation_rate_bps(&proposal, TOTAL_SUPPLY), 300); // 3%
    assert_eq!(approval_rate_bps(&proposal), 10_000); // 100% (all for)
    // Still need quorum: 4M - 3M = 1M more
    assert_eq!(votes_needed_to_pass(&proposal, TOTAL_SUPPLY), 1_000_000 * PRECISION);

    // Phase 3: Quorum met, close vote
    cast_vote(&mut proposal, voter(0x02), 1_500_000 * PRECISION, true, 3000).unwrap();
    cast_vote(&mut proposal, voter(0x03), 1_000_000 * PRECISION, false, 4000).unwrap();

    assert_eq!(participation_rate_bps(&proposal, TOTAL_SUPPLY), 550); // 5.5%
    // 4.5M for, 1M against → 81.8% approval
    assert_eq!(approval_rate_bps(&proposal), 8181);
    assert_eq!(votes_needed_to_pass(&proposal, TOTAL_SUPPLY), 0); // Already passing
}

// ============ Edge Cases ============

#[test]
fn test_exact_quorum_boundary() {
    let mut proposal = create_proposal(
        1, proposer(), base_config(), [0xDD; 32],
        1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
    ).unwrap();

    // Exactly 4% = 4M tokens
    cast_vote(&mut proposal, voter(0x01), 4_000_000 * PRECISION, true, 2000).unwrap();
    assert!(has_quorum(&proposal, TOTAL_SUPPLY));

    // One less — below quorum
    let mut proposal_2 = create_proposal(
        2, proposer(), base_config(), [0xDD; 32],
        1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
    ).unwrap();
    cast_vote(&mut proposal_2, voter(0x01), 4_000_000 * PRECISION - 1, true, 2000).unwrap();
    assert!(!has_quorum(&proposal_2, TOTAL_SUPPLY));
}

#[test]
fn test_tied_vote_fails() {
    // Equal for/against → doesn't pass (need strictly more for)
    let mut proposal = create_proposal(
        1, proposer(), base_config(), [0xDD; 32],
        1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
    ).unwrap();

    cast_vote(&mut proposal, voter(0x01), 3_000_000 * PRECISION, true, 2000).unwrap();
    cast_vote(&mut proposal, voter(0x02), 3_000_000 * PRECISION, false, 3000).unwrap();

    assert!(has_quorum(&proposal, TOTAL_SUPPLY)); // 6M > 4M
    assert!(!has_passed(&proposal, TOTAL_SUPPLY)); // 3M == 3M, not strictly >
}

#[test]
fn test_double_finalize_rejected() {
    let mut proposal = create_proposal(
        1, proposer(), base_config(), [0xDD; 32],
        1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
    ).unwrap();

    cast_vote(&mut proposal, voter(0x01), 5_000_000 * PRECISION, true, 2000).unwrap();

    let end_block = 1000 + DEFAULT_VOTING_PERIOD_BLOCKS + 1;
    finalize_voting(&mut proposal, TOTAL_SUPPLY, end_block).unwrap();

    // Can't finalize again
    let result = finalize_voting(&mut proposal, TOTAL_SUPPLY, end_block + 100);
    assert!(matches!(result, Err(GovernanceError::ProposalNotActive)));
}

#[test]
fn test_vote_on_cancelled_proposal_rejected() {
    let mut proposal = create_proposal(
        1, proposer(), base_config(), [0xDD; 32],
        1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
    ).unwrap();

    cancel_proposal(&mut proposal, &proposer(), &guardian()).unwrap();

    let result = cast_vote(&mut proposal, voter(0x01), 5_000_000 * PRECISION, true, 2000);
    assert!(matches!(result, Err(GovernanceError::ProposalNotActive)));
}

#[test]
fn test_execute_defeated_proposal_rejected() {
    let mut proposal = create_proposal(
        1, proposer(), base_config(), [0xDD; 32],
        1000, DEFAULT_VOTING_PERIOD_BLOCKS, false,
    ).unwrap();

    // Defeat by insufficient quorum
    cast_vote(&mut proposal, voter(0x01), 1_000_000 * PRECISION, true, 2000).unwrap();

    let end_block = 1000 + DEFAULT_VOTING_PERIOD_BLOCKS + 1;
    finalize_voting(&mut proposal, TOTAL_SUPPLY, end_block).unwrap();
    assert_eq!(proposal.status, ProposalStatus::Defeated);

    let result = execute_proposal(&mut proposal, end_block + TIMELOCK_DELAY_BLOCKS + 1);
    assert!(matches!(result, Err(GovernanceError::ProposalNotActive)));
}
