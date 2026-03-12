// ============ VibeSwap PoW Mining Client ============
// Watches for pending CommitCells and builds aggregation transactions
// Mines PoW nonces for cell access, then submits to CKB node
//
// Architecture:
// 1. Poll CKB indexer for pending commit cells (by type script hash)
// 2. Build aggregation transaction (consuming all pending commits)
// 3. Mine PoW nonce against current difficulty target
// 4. Submit transaction to CKB node
//
// The miner is a COMPENSATED AGGREGATOR with ZERO DISCRETION:
// - Must include ALL pending commits (forced inclusion)
// - Cannot reorder or censor (type script enforces completeness)
// - Earns mining rewards from PoW difficulty value

use vibeswap_types::*;
use vibeswap_pow::{self, PoWProof};
use sha2::{Digest, Sha256};

// ============ Miner Configuration ============

#[derive(Clone, Debug)]
pub struct MinerConfig {
    /// Maximum hash iterations per mining attempt
    pub max_iterations: u64,
    /// CKB node RPC endpoint
    pub ckb_rpc_url: String,
    /// CKB indexer RPC endpoint
    pub indexer_rpc_url: String,
    /// Miner's lock script (for rewards)
    pub miner_lock: super::Script,
    /// Which trading pairs to mine for
    pub pair_ids: Vec<[u8; 32]>,
    /// Minimum reward threshold (CKB) — skip mining if reward too low
    pub min_reward_ckb: u64,
}

// ============ Miner State ============

#[derive(Clone, Debug)]
pub struct MinerState {
    /// Current difficulty for each pair
    pub difficulties: Vec<(/*pair_id*/ [u8; 32], /*difficulty*/ u8)>,
    /// Pending commit cells discovered
    pub pending_commits: Vec<PendingCommit>,
    /// Last known auction cell state for each pair
    pub auction_states: Vec<(/*pair_id*/ [u8; 32], AuctionCellData)>,
    /// Mining statistics
    pub stats: MiningStats,
}

#[derive(Clone, Debug)]
pub struct PendingCommit {
    pub commit_data: CommitCellData,
    pub outpoint_tx_hash: [u8; 32],
    pub outpoint_index: u32,
}

#[derive(Clone, Debug, Default)]
pub struct MiningStats {
    pub total_hashes: u64,
    pub blocks_mined: u64,
    pub total_commits_aggregated: u64,
    pub total_reward_ckb: u64,
    pub avg_hash_rate: f64,
}

// ============ Mining Operations ============

/// Attempt to mine a PoW nonce for transitioning an auction cell
/// Returns the proof if successful within max_iterations
pub fn mine_for_cell(
    pair_id: &[u8; 32],
    batch_id: u64,
    prev_state_hash: &[u8; 32],
    difficulty: u8,
    max_iterations: u64,
) -> Option<PoWProof> {
    let challenge = vibeswap_pow::generate_challenge(pair_id, batch_id, prev_state_hash);

    let nonce = vibeswap_pow::mine(&challenge, difficulty, max_iterations)?;

    Some(PoWProof { challenge, nonce })
}

/// Build an aggregation transaction that includes all pending commits
/// This is the core function — it creates the forced-inclusion transaction
pub fn build_aggregation_tx(
    auction_state: &AuctionCellData,
    pending_commits: &[PendingCommit],
    compliance_data: Option<&ComplianceCellData>,
    pow_proof: &PoWProof,
    deployment: &super::DeploymentInfo,
    _miner_lock: &super::Script,
) -> super::UnsignedTransaction {
    // Filter blocked addresses (if compliance data available)
    let included_commits: Vec<&PendingCommit> = pending_commits
        .iter()
        .filter(|_c| {
            if let Some(_compliance) = compliance_data {
                // In production: verify non-inclusion Merkle proof
                // For now: include all
                true
            } else {
                true
            }
        })
        .collect();

    // Build new auction state
    let mut new_auction = auction_state.clone();
    new_auction.commit_count += included_commits.len() as u32;
    new_auction.prev_state_hash = compute_auction_hash(auction_state);

    // Build MMR root from commits
    let mut mmr = vibeswap_mmr::MMR::new();
    for commit in &included_commits {
        mmr.append(&commit.commit_data.order_hash);
    }
    new_auction.commit_mmr_root = mmr.root();

    // Build transaction inputs: auction cell + all commit cells
    let mut inputs = Vec::new();

    // Auction cell input (placeholder — in production, from indexer)
    inputs.push(super::CellInput {
        tx_hash: [0u8; 32], // Would be the actual auction cell outpoint
        index: 0,
        since: 0,
    });

    // Commit cell inputs
    for commit in &included_commits {
        inputs.push(super::CellInput {
            tx_hash: commit.outpoint_tx_hash,
            index: commit.outpoint_index,
            since: 0,
        });
    }

    // Build transaction outputs: new auction cell
    let auction_output = super::CellOutput {
        capacity: 0, // Same as input
        lock_script: super::Script {
            code_hash: deployment.pow_lock_code_hash,
            hash_type: super::HashType::Type,
            args: PoWLockArgs {
                pair_id: auction_state.pair_id,
                min_difficulty: DEFAULT_MIN_POW_DIFFICULTY,
            }
            .serialize()
            .to_vec(),
        },
        type_script: Some(super::Script {
            code_hash: deployment.batch_auction_type_code_hash,
            hash_type: super::HashType::Type,
            args: auction_state.pair_id.to_vec(),
        }),
        data: new_auction.serialize().to_vec(),
    };

    // Build witness: PoW proof
    let mut pow_witness = Vec::with_capacity(64);
    pow_witness.extend_from_slice(&pow_proof.challenge);
    pow_witness.extend_from_slice(&pow_proof.nonce);

    super::UnsignedTransaction {
        cell_deps: vec![
            // Script code dep
            super::CellDep {
                tx_hash: deployment.script_dep_tx_hash,
                index: deployment.script_dep_index,
                dep_type: super::DepType::DepGroup,
            },
        ],
        inputs,
        outputs: vec![auction_output],
        witnesses: vec![pow_witness],
    }
}

/// Estimate mining profitability for current conditions
pub fn estimate_profitability(
    difficulty: u8,
    pending_commit_count: u32,
    base_reward_ckb: u64,
    hash_rate: f64, // hashes per second
) -> MiningEstimate {
    let expected_hashes = vibeswap_pow::estimate_hashes(difficulty) as f64;
    let expected_time_secs = expected_hashes / hash_rate;

    // Reward scales with commit count (more commits = more aggregation value)
    let reward = base_reward_ckb as f64 * pending_commit_count as f64;

    // Electricity cost estimate (rough: 0.1 CKB per million hashes at 10c/kWh)
    let energy_cost = expected_hashes / 1_000_000.0 * 0.1;

    let profit = reward - energy_cost;

    MiningEstimate {
        expected_hashes: expected_hashes as u64,
        expected_time_secs,
        expected_reward_ckb: reward as u64,
        estimated_cost_ckb: energy_cost as u64,
        estimated_profit_ckb: if profit > 0.0 { profit as u64 } else { 0 },
        is_profitable: profit > 0.0,
    }
}

#[derive(Clone, Debug)]
pub struct MiningEstimate {
    pub expected_hashes: u64,
    pub expected_time_secs: f64,
    pub expected_reward_ckb: u64,
    pub estimated_cost_ckb: u64,
    pub estimated_profit_ckb: u64,
    pub is_profitable: bool,
}

// ============ Difficulty Tracking ============

/// Track difficulty adjustments across mining epochs
pub fn track_difficulty(
    current_difficulty: u8,
    recent_transition_blocks: &[u64], // Block numbers of recent transitions
    target_blocks_per_transition: u64,
) -> u8 {
    if recent_transition_blocks.len() < 2 {
        return current_difficulty;
    }

    let total_blocks = recent_transition_blocks.last().unwrap()
        - recent_transition_blocks.first().unwrap();
    let num_transitions = (recent_transition_blocks.len() - 1) as u64;
    let actual_avg = total_blocks / num_transitions;

    vibeswap_pow::adjust_difficulty(
        current_difficulty,
        actual_avg * num_transitions,
        target_blocks_per_transition * num_transitions,
    )
}

// ============ Helpers ============

fn compute_auction_hash(state: &AuctionCellData) -> [u8; 32] {
    let serialized = state.serialize();
    let mut hasher = Sha256::new();
    hasher.update(&serialized);
    let result = hasher.finalize();
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&result);
    hash
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mine_for_cell() {
        let pair_id = [0x42; 32];
        let prev_hash = [0u8; 32];

        let proof = mine_for_cell(&pair_id, 0, &prev_hash, 4, 100_000);
        assert!(proof.is_some());

        let proof = proof.unwrap();
        assert!(vibeswap_pow::verify(&proof, 4));
    }

    #[test]
    fn test_build_aggregation_tx() {
        let auction = AuctionCellData {
            phase: PHASE_COMMIT,
            batch_id: 0,
            pair_id: [0x01; 32],
            ..Default::default()
        };

        let commits = vec![
            PendingCommit {
                commit_data: CommitCellData {
                    order_hash: [0xAA; 32],
                    batch_id: 0,
                    deposit_ckb: 100_000_000,
                    token_type_hash: [0x02; 32],
                    token_amount: PRECISION,
                    block_number: 10,
                    sender_lock_hash: [0xCC; 32],
                },
                outpoint_tx_hash: [0x50; 32],
                outpoint_index: 0,
            },
        ];

        let proof = PoWProof {
            challenge: [0x11; 32],
            nonce: [0x22; 32],
        };

        let deployment = super::super::DeploymentInfo {
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
            prediction_position_type_code_hash: [0x0E; 32],
            script_dep_tx_hash: [0x10; 32],
            script_dep_index: 0,
        };

        let miner_lock = super::super::Script {
            code_hash: [0x99; 32],
            hash_type: super::super::HashType::Type,
            args: vec![0x01; 20],
        };

        let tx = build_aggregation_tx(
            &auction,
            &commits,
            None,
            &proof,
            &deployment,
            &miner_lock,
        );

        // 1 auction cell + 1 commit cell = 2 inputs
        assert_eq!(tx.inputs.len(), 2);
        // 1 new auction cell output
        assert_eq!(tx.outputs.len(), 1);
        // PoW proof in witness
        assert_eq!(tx.witnesses[0].len(), 64);
    }

    #[test]
    fn test_estimate_profitability() {
        let estimate = estimate_profitability(
            16,     // difficulty
            10,     // pending commits
            1000,   // base reward per commit in CKB shannons
            1_000_000.0, // 1M hashes/sec
        );

        assert!(estimate.expected_hashes > 0);
        assert!(estimate.expected_time_secs > 0.0);
    }

    #[test]
    fn test_track_difficulty_stable() {
        let transitions = vec![100, 105, 110, 115, 120];
        let new_diff = track_difficulty(16, &transitions, 5);
        assert_eq!(new_diff, 16); // 5 blocks apart = target
    }

    #[test]
    fn test_track_difficulty_too_fast() {
        let transitions = vec![100, 101, 102, 103, 104];
        let new_diff = track_difficulty(16, &transitions, 5);
        assert!(new_diff > 16); // 1 block apart = too fast
    }

    // ============ Mining Edge Cases ============

    #[test]
    fn test_mine_high_difficulty_fails() {
        let pair_id = [0x42; 32];
        let prev_hash = [0u8; 32];

        // Difficulty 255 with only 100 iterations — should fail
        let proof = mine_for_cell(&pair_id, 0, &prev_hash, 255, 100);
        assert!(proof.is_none());
    }

    #[test]
    fn test_mine_difficulty_zero_instant() {
        let pair_id = [0xFF; 32];
        let prev_hash = [0xAA; 32];

        // Difficulty 0 should succeed on first try (all hashes pass)
        let proof = mine_for_cell(&pair_id, 0, &prev_hash, 0, 1);
        assert!(proof.is_some());
    }

    #[test]
    fn test_mine_different_batch_ids_yield_different_challenges() {
        let pair_id = [0x42; 32];
        let prev_hash = [0u8; 32];

        let proof_0 = mine_for_cell(&pair_id, 0, &prev_hash, 4, 100_000).unwrap();
        let proof_1 = mine_for_cell(&pair_id, 1, &prev_hash, 4, 100_000).unwrap();

        // Different batch_id → different challenge
        assert_ne!(proof_0.challenge, proof_1.challenge);
    }

    #[test]
    fn test_mine_proof_is_verifiable() {
        let pair_id = [0x42; 32];
        let prev_hash = [0xBB; 32];

        for difficulty in [1, 4, 8, 12] {
            let proof = mine_for_cell(&pair_id, 5, &prev_hash, difficulty, 1_000_000);
            if let Some(p) = proof {
                assert!(vibeswap_pow::verify(&p, difficulty),
                    "Proof should verify at difficulty {}", difficulty);
                // Should fail at higher difficulty (probabilistically)
                // Don't assert — it *could* pass by luck
            }
        }
    }

    // ============ Aggregation Transaction Tests ============

    fn test_deployment() -> super::super::DeploymentInfo {
        super::super::DeploymentInfo {
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
            prediction_position_type_code_hash: [0x0E; 32],
            script_dep_tx_hash: [0x10; 32],
            script_dep_index: 0,
        }
    }

    fn test_miner_lock() -> super::super::Script {
        super::super::Script {
            code_hash: [0x99; 32],
            hash_type: super::super::HashType::Type,
            args: vec![0x01; 20],
        }
    }

    fn test_auction() -> AuctionCellData {
        AuctionCellData {
            phase: PHASE_COMMIT,
            batch_id: 0,
            pair_id: [0x01; 32],
            ..Default::default()
        }
    }

    fn make_commit(id: u8) -> PendingCommit {
        PendingCommit {
            commit_data: CommitCellData {
                order_hash: [id; 32],
                batch_id: 0,
                deposit_ckb: 100_000_000,
                token_type_hash: [0x02; 32],
                token_amount: vibeswap_math::PRECISION,
                block_number: 10 + id as u64,
                sender_lock_hash: [id; 32],
            },
            outpoint_tx_hash: [id; 32],
            outpoint_index: 0,
        }
    }

    #[test]
    fn test_aggregation_zero_commits() {
        let auction = test_auction();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };

        let tx = build_aggregation_tx(
            &auction, &[], None, &proof,
            &test_deployment(), &test_miner_lock(),
        );

        // 1 auction cell input, 0 commits
        assert_eq!(tx.inputs.len(), 1);
        assert_eq!(tx.outputs.len(), 1);
    }

    #[test]
    fn test_aggregation_many_commits() {
        let auction = test_auction();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };

        let commits: Vec<PendingCommit> = (1..=20).map(|i| make_commit(i)).collect();

        let tx = build_aggregation_tx(
            &auction, &commits, None, &proof,
            &test_deployment(), &test_miner_lock(),
        );

        // 1 auction + 20 commits = 21 inputs
        assert_eq!(tx.inputs.len(), 21);
        assert_eq!(tx.outputs.len(), 1);
        // Verify witness still has PoW proof
        assert_eq!(tx.witnesses[0].len(), 64);
    }

    #[test]
    fn test_aggregation_preserves_pair_id() {
        let mut auction = test_auction();
        auction.pair_id = [0xDD; 32];
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };

        let tx = build_aggregation_tx(
            &auction, &[make_commit(1)], None, &proof,
            &test_deployment(), &test_miner_lock(),
        );

        // Output type script args should contain the pair_id
        let type_script = tx.outputs[0].type_script.as_ref().unwrap();
        assert_eq!(type_script.args, auction.pair_id.to_vec());
    }

    #[test]
    fn test_aggregation_updates_commit_count() {
        let auction = test_auction();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };
        let commits: Vec<PendingCommit> = (1..=5).map(|i| make_commit(i)).collect();

        let tx = build_aggregation_tx(
            &auction, &commits, None, &proof,
            &test_deployment(), &test_miner_lock(),
        );

        // Deserialize the output data to verify commit_count updated
        let output_data = &tx.outputs[0].data;
        let new_auction = AuctionCellData::deserialize(output_data).unwrap();
        assert_eq!(new_auction.commit_count, 5);
    }

    #[test]
    fn test_aggregation_with_compliance_includes_all() {
        let auction = test_auction();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };
        let commits: Vec<PendingCommit> = (1..=3).map(|i| make_commit(i)).collect();

        // Compliance data present but current impl includes all
        let compliance = ComplianceCellData {
            blocked_merkle_root: [0xCC; 32],
            tier_merkle_root: [0xDD; 32],
            jurisdiction_root: [0xEE; 32],
            last_updated: 100,
            version: 1,
        };

        let tx = build_aggregation_tx(
            &auction, &commits, Some(&compliance), &proof,
            &test_deployment(), &test_miner_lock(),
        );

        // All 3 commits + 1 auction = 4 inputs
        assert_eq!(tx.inputs.len(), 4);
    }

    #[test]
    fn test_aggregation_mmr_root_differs_per_commit_set() {
        let auction = test_auction();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };

        let tx1 = build_aggregation_tx(
            &auction, &[make_commit(1)], None, &proof,
            &test_deployment(), &test_miner_lock(),
        );
        let tx2 = build_aggregation_tx(
            &auction, &[make_commit(2)], None, &proof,
            &test_deployment(), &test_miner_lock(),
        );

        let data1 = &tx1.outputs[0].data;
        let data2 = &tx2.outputs[0].data;
        let auction1 = AuctionCellData::deserialize(data1).unwrap();
        let auction2 = AuctionCellData::deserialize(data2).unwrap();

        // Different commits → different MMR roots
        assert_ne!(auction1.commit_mmr_root, auction2.commit_mmr_root);
    }

    // ============ Profitability Tests ============

    #[test]
    fn test_profitability_zero_commits_no_reward() {
        let estimate = estimate_profitability(16, 0, 1000, 1_000_000.0);
        assert_eq!(estimate.expected_reward_ckb, 0);
        assert!(!estimate.is_profitable);
    }

    #[test]
    fn test_profitability_scales_with_commits() {
        let est_1 = estimate_profitability(8, 1, 1000, 1_000_000.0);
        let est_10 = estimate_profitability(8, 10, 1000, 1_000_000.0);

        // More commits = more reward
        assert!(est_10.expected_reward_ckb > est_1.expected_reward_ckb);
    }

    #[test]
    fn test_profitability_high_difficulty_costs_more() {
        let est_low = estimate_profitability(4, 10, 1000, 1_000_000.0);
        let est_high = estimate_profitability(20, 10, 1000, 1_000_000.0);

        // Higher difficulty = more hashes = higher cost
        assert!(est_high.expected_hashes > est_low.expected_hashes);
        assert!(est_high.expected_time_secs > est_low.expected_time_secs);
    }

    // ============ Difficulty Tracking Tests ============

    #[test]
    fn test_track_difficulty_single_transition() {
        // Only 1 transition point — not enough data
        let transitions = vec![100];
        let new_diff = track_difficulty(16, &transitions, 5);
        assert_eq!(new_diff, 16); // No change
    }

    #[test]
    fn test_track_difficulty_empty_transitions() {
        let transitions: Vec<u64> = vec![];
        let new_diff = track_difficulty(16, &transitions, 5);
        assert_eq!(new_diff, 16); // No change
    }

    #[test]
    fn test_track_difficulty_too_slow() {
        // 20 blocks apart when target is 5 — mining too slow, decrease difficulty
        let transitions = vec![100, 120, 140, 160, 180];
        let new_diff = track_difficulty(16, &transitions, 5);
        assert!(new_diff < 16, "Slow mining should decrease difficulty: {}", new_diff);
    }

    #[test]
    fn test_track_difficulty_exactly_on_target() {
        // Exactly on target — no change
        let transitions = vec![100, 110, 120, 130, 140];
        let new_diff = track_difficulty(16, &transitions, 10);
        assert_eq!(new_diff, 16);
    }

    // ============ Auction Hash Determinism ============

    #[test]
    fn test_auction_hash_deterministic() {
        let auction = test_auction();
        let hash1 = compute_auction_hash(&auction);
        let hash2 = compute_auction_hash(&auction);
        assert_eq!(hash1, hash2, "Same input must produce same hash");
    }

    #[test]
    fn test_auction_hash_changes_with_state() {
        let mut auction1 = test_auction();
        let mut auction2 = test_auction();
        auction2.batch_id = 1;

        let hash1 = compute_auction_hash(&auction1);
        let hash2 = compute_auction_hash(&auction2);
        assert_ne!(hash1, hash2, "Different state must produce different hash");

        // Changing commit count also changes hash
        auction1.commit_count = 5;
        let hash3 = compute_auction_hash(&auction1);
        assert_ne!(hash1, hash3);
    }

    // ============ New Hardening Tests ============

    #[test]
    fn test_mine_max_batch_id_boundary() {
        // Verify mining works at the u64 boundary for batch_id
        let pair_id = [0x77; 32];
        let prev_hash = [0x88; 32];

        let proof = mine_for_cell(&pair_id, u64::MAX, &prev_hash, 4, 100_000);
        assert!(proof.is_some(), "Mining should succeed at max batch_id");

        let p = proof.unwrap();
        assert!(vibeswap_pow::verify(&p, 4));

        // Challenge should differ from batch_id = 0
        let proof_zero = mine_for_cell(&pair_id, 0, &prev_hash, 4, 100_000).unwrap();
        assert_ne!(p.challenge, proof_zero.challenge,
            "Max batch_id must produce different challenge than batch_id 0");
    }

    #[test]
    fn test_mine_zero_iterations_returns_none() {
        let pair_id = [0x42; 32];
        let prev_hash = [0u8; 32];

        // Zero iterations means no work is done — always returns None
        let proof = mine_for_cell(&pair_id, 0, &prev_hash, 4, 0);
        assert!(proof.is_none(), "Zero iterations must return None");
    }

    #[test]
    fn test_mine_single_iteration_low_difficulty() {
        // At difficulty 0, even a single iteration should succeed
        let pair_id = [0xAB; 32];
        let prev_hash = [0xCD; 32];

        let proof = mine_for_cell(&pair_id, 42, &prev_hash, 0, 1);
        assert!(proof.is_some(), "Difficulty 0 should succeed in 1 iteration");
        assert!(vibeswap_pow::verify(&proof.unwrap(), 0));
    }

    #[test]
    fn test_aggregation_prev_state_hash_is_current_auction_hash() {
        // Verify the new auction state's prev_state_hash is the hash of the input auction
        let auction = test_auction();
        let expected_hash = compute_auction_hash(&auction);
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };

        let tx = build_aggregation_tx(
            &auction, &[make_commit(1)], None, &proof,
            &test_deployment(), &test_miner_lock(),
        );

        let output_data = &tx.outputs[0].data;
        let new_auction = AuctionCellData::deserialize(output_data).unwrap();
        assert_eq!(new_auction.prev_state_hash, expected_hash,
            "New auction's prev_state_hash must be the hash of the input auction state");
    }

    #[test]
    fn test_aggregation_commit_inputs_preserve_outpoints() {
        // Verify that commit outpoints are faithfully transferred to tx inputs
        let auction = test_auction();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };

        let mut commit = make_commit(0xAA);
        commit.outpoint_tx_hash = [0xBE; 32];
        commit.outpoint_index = 7;

        let tx = build_aggregation_tx(
            &auction, &[commit], None, &proof,
            &test_deployment(), &test_miner_lock(),
        );

        // Input[0] is auction cell, Input[1] is the commit cell
        assert_eq!(tx.inputs[1].tx_hash, [0xBE; 32]);
        assert_eq!(tx.inputs[1].index, 7);
        assert_eq!(tx.inputs[1].since, 0);
    }

    #[test]
    fn test_aggregation_output_lock_script_uses_pow_lock() {
        // Output auction cell must use the PoW lock with correct code_hash and args
        let auction = test_auction();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };
        let deployment = test_deployment();

        let tx = build_aggregation_tx(
            &auction, &[], None, &proof,
            &deployment, &test_miner_lock(),
        );

        let lock = &tx.outputs[0].lock_script;
        assert_eq!(lock.code_hash, deployment.pow_lock_code_hash,
            "Output lock must use PoW lock code hash");

        // Deserialize the lock args to verify pair_id and min_difficulty
        let args = PoWLockArgs::deserialize(&lock.args).unwrap();
        assert_eq!(args.pair_id, auction.pair_id);
        assert_eq!(args.min_difficulty, DEFAULT_MIN_POW_DIFFICULTY);
    }

    #[test]
    fn test_aggregation_witness_contains_challenge_and_nonce() {
        // Verify witness bytes are exactly challenge || nonce
        let auction = test_auction();
        let challenge = [0xAA; 32];
        let nonce = [0xBB; 32];
        let proof = PoWProof { challenge, nonce };

        let tx = build_aggregation_tx(
            &auction, &[], None, &proof,
            &test_deployment(), &test_miner_lock(),
        );

        let witness = &tx.witnesses[0];
        assert_eq!(&witness[0..32], &challenge, "First 32 bytes must be challenge");
        assert_eq!(&witness[32..64], &nonce, "Last 32 bytes must be nonce");
    }

    #[test]
    fn test_profitability_zero_hash_rate_infinite_time() {
        // With zero hash rate, expected time should be infinity
        let estimate = estimate_profitability(8, 10, 1000, 0.0_f64.max(f64::MIN_POSITIVE));
        // At essentially zero hash rate, time is astronomically large
        assert!(estimate.expected_time_secs > 1e10,
            "Near-zero hash rate should produce enormous time estimate");
    }

    #[test]
    fn test_profitability_zero_base_reward() {
        // Zero base reward means zero reward regardless of commit count
        let estimate = estimate_profitability(8, 100, 0, 1_000_000.0);
        assert_eq!(estimate.expected_reward_ckb, 0);
        assert!(!estimate.is_profitable, "Zero reward should never be profitable");
    }

    #[test]
    fn test_track_difficulty_two_transitions_minimal() {
        // Exactly two transitions — the minimum for adjustment
        let transitions = vec![100, 105];
        let new_diff = track_difficulty(16, &transitions, 5);
        // actual_avg = 5, target = 5 → no change
        assert_eq!(new_diff, 16);

        // Two transitions, too fast
        let fast = vec![100, 101];
        let fast_diff = track_difficulty(16, &fast, 5);
        assert!(fast_diff > 16, "Fast transitions should increase difficulty: {}", fast_diff);

        // Two transitions, too slow
        let slow = vec![100, 130];
        let slow_diff = track_difficulty(16, &slow, 5);
        assert!(slow_diff < 16, "Slow transitions should decrease difficulty: {}", slow_diff);
    }

    #[test]
    fn test_mine_then_aggregate_integration() {
        // Full pipeline: mine a valid proof, then build an aggregation tx with it
        let pair_id = [0x42; 32];
        let auction = AuctionCellData {
            phase: PHASE_COMMIT,
            batch_id: 7,
            pair_id,
            ..Default::default()
        };
        let prev_state_hash = compute_auction_hash(&auction);

        // Step 1: Mine a valid proof
        let proof = mine_for_cell(&pair_id, 7, &prev_state_hash, 4, 100_000)
            .expect("Should mine successfully at difficulty 4");
        assert!(vibeswap_pow::verify(&proof, 4));

        // Step 2: Build aggregation tx with 3 commits
        let commits: Vec<PendingCommit> = (1..=3).map(|i| {
            let mut c = make_commit(i);
            c.commit_data.batch_id = 7;
            c
        }).collect();

        let tx = build_aggregation_tx(
            &auction, &commits, None, &proof,
            &test_deployment(), &test_miner_lock(),
        );

        // Verify structural integrity
        assert_eq!(tx.inputs.len(), 4, "1 auction + 3 commits");
        assert_eq!(tx.outputs.len(), 1);
        assert_eq!(tx.witnesses[0].len(), 64);

        // Verify output auction state
        let new_auction = AuctionCellData::deserialize(&tx.outputs[0].data).unwrap();
        assert_eq!(new_auction.commit_count, 3);
        assert_eq!(new_auction.prev_state_hash, prev_state_hash);
        assert_ne!(new_auction.commit_mmr_root, [0u8; 32],
            "MMR root should be non-zero with commits");

        // Verify the proof in the witness matches what we mined
        assert_eq!(&tx.witnesses[0][0..32], &proof.challenge);
        assert_eq!(&tx.witnesses[0][32..64], &proof.nonce);
    }

    // ============ Additional Hardening Tests ============

    #[test]
    fn test_mine_different_pair_ids_yield_different_challenges() {
        // Same batch_id and prev_hash but different pair_ids must produce different challenges
        let prev_hash = [0xAA; 32];
        let batch_id = 5;

        let proof_a = mine_for_cell(&[0x01; 32], batch_id, &prev_hash, 4, 100_000).unwrap();
        let proof_b = mine_for_cell(&[0x02; 32], batch_id, &prev_hash, 4, 100_000).unwrap();

        assert_ne!(proof_a.challenge, proof_b.challenge,
            "Different pair_ids must produce different challenges");
    }

    #[test]
    fn test_mine_different_prev_hashes_yield_different_challenges() {
        // Same pair_id and batch_id but different prev_state_hash must produce different challenges
        let pair_id = [0x42; 32];
        let batch_id = 0;

        let proof_a = mine_for_cell(&pair_id, batch_id, &[0x00; 32], 4, 100_000).unwrap();
        let proof_b = mine_for_cell(&pair_id, batch_id, &[0xFF; 32], 4, 100_000).unwrap();

        assert_ne!(proof_a.challenge, proof_b.challenge,
            "Different prev_state_hashes must produce different challenges");
    }

    #[test]
    fn test_mine_proof_nonce_is_nonzero() {
        // A mined proof should have a non-zero nonce (the PoW library hashes iterations)
        let pair_id = [0x42; 32];
        let prev_hash = [0u8; 32];

        let proof = mine_for_cell(&pair_id, 0, &prev_hash, 4, 100_000).unwrap();
        assert_ne!(proof.nonce, [0u8; 32],
            "Mined nonce should not be all zeros");
    }

    #[test]
    fn test_aggregation_cumulative_commit_count() {
        // If auction already has commits, new commits should add to the existing count
        let mut auction = test_auction();
        auction.commit_count = 10; // Already has 10 commits from previous aggregation
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };

        let commits: Vec<PendingCommit> = (1..=3).map(|i| make_commit(i)).collect();

        let tx = build_aggregation_tx(
            &auction, &commits, None, &proof,
            &test_deployment(), &test_miner_lock(),
        );

        let output_data = &tx.outputs[0].data;
        let new_auction = AuctionCellData::deserialize(output_data).unwrap();
        assert_eq!(new_auction.commit_count, 13,
            "commit_count should be 10 (existing) + 3 (new) = 13");
    }

    #[test]
    fn test_aggregation_cell_deps_structure() {
        // Verify cell_deps contains the script dep from deployment info
        let auction = test_auction();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };
        let deployment = test_deployment();

        let tx = build_aggregation_tx(
            &auction, &[], None, &proof,
            &deployment, &test_miner_lock(),
        );

        assert_eq!(tx.cell_deps.len(), 1, "Should have exactly 1 cell dep");
        assert_eq!(tx.cell_deps[0].tx_hash, deployment.script_dep_tx_hash);
        assert_eq!(tx.cell_deps[0].index, deployment.script_dep_index);
    }

    #[test]
    fn test_aggregation_output_type_script_code_hash() {
        // Verify the output type script uses the batch_auction_type code hash
        let auction = test_auction();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };
        let deployment = test_deployment();

        let tx = build_aggregation_tx(
            &auction, &[make_commit(1)], None, &proof,
            &deployment, &test_miner_lock(),
        );

        let type_script = tx.outputs[0].type_script.as_ref().unwrap();
        assert_eq!(type_script.code_hash, deployment.batch_auction_type_code_hash,
            "Output type script must use batch_auction_type code hash");
        assert!(matches!(type_script.hash_type, super::super::HashType::Type));
    }

    #[test]
    fn test_aggregation_with_reveal_phase_auction() {
        // Build aggregation from a REVEAL phase auction state (not just COMMIT)
        let mut auction = test_auction();
        auction.phase = PHASE_REVEAL;
        auction.batch_id = 42;
        auction.reveal_count = 5;
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };

        let tx = build_aggregation_tx(
            &auction, &[make_commit(1)], None, &proof,
            &test_deployment(), &test_miner_lock(),
        );

        // Should still produce a valid transaction structure
        assert_eq!(tx.inputs.len(), 2);
        assert_eq!(tx.outputs.len(), 1);

        let new_auction = AuctionCellData::deserialize(&tx.outputs[0].data).unwrap();
        // prev_state_hash should be hash of the REVEAL phase auction
        let expected_hash = compute_auction_hash(&auction);
        assert_eq!(new_auction.prev_state_hash, expected_hash);
    }

    #[test]
    fn test_aggregation_mmr_root_empty_vs_nonempty() {
        // Zero commits should produce a different MMR root than one commit
        let auction = test_auction();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };

        let tx_empty = build_aggregation_tx(
            &auction, &[], None, &proof,
            &test_deployment(), &test_miner_lock(),
        );
        let tx_one = build_aggregation_tx(
            &auction, &[make_commit(1)], None, &proof,
            &test_deployment(), &test_miner_lock(),
        );

        let auction_empty = AuctionCellData::deserialize(&tx_empty.outputs[0].data).unwrap();
        let auction_one = AuctionCellData::deserialize(&tx_one.outputs[0].data).unwrap();

        assert_ne!(auction_empty.commit_mmr_root, auction_one.commit_mmr_root,
            "Empty commit set should produce different MMR root than single commit");
    }

    #[test]
    fn test_aggregation_sequential_builds_chain_prev_state_hash() {
        // Simulate two sequential aggregations: the second should reference the first's output hash
        let auction = test_auction();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };

        // First aggregation
        let tx1 = build_aggregation_tx(
            &auction, &[make_commit(1)], None, &proof,
            &test_deployment(), &test_miner_lock(),
        );
        let auction_after_1 = AuctionCellData::deserialize(&tx1.outputs[0].data).unwrap();

        // Second aggregation uses the output of the first
        let tx2 = build_aggregation_tx(
            &auction_after_1, &[make_commit(2)], None, &proof,
            &test_deployment(), &test_miner_lock(),
        );
        let auction_after_2 = AuctionCellData::deserialize(&tx2.outputs[0].data).unwrap();

        // The second auction's prev_state_hash should be the hash of the first auction's output
        let expected_prev = compute_auction_hash(&auction_after_1);
        assert_eq!(auction_after_2.prev_state_hash, expected_prev,
            "Chained aggregation must link prev_state_hash correctly");

        // And commit counts should be cumulative
        assert_eq!(auction_after_1.commit_count, 1);
        assert_eq!(auction_after_2.commit_count, 2);
    }

    #[test]
    fn test_profitability_very_high_difficulty_caps_hashes() {
        // Difficulty > 63 should produce u64::MAX expected hashes
        let estimate = estimate_profitability(64, 10, 1000, 1_000_000.0);
        assert_eq!(estimate.expected_hashes, u64::MAX,
            "Difficulty 64+ should cap expected_hashes at u64::MAX");
    }

    #[test]
    fn test_profitability_reward_equals_base_times_commits() {
        // Verify the exact reward calculation: base_reward * commit_count
        let estimate = estimate_profitability(4, 7, 500, 1_000_000.0);
        assert_eq!(estimate.expected_reward_ckb, 3500,
            "Reward should be 500 * 7 = 3500");
    }

    #[test]
    fn test_profitability_very_high_hash_rate_low_time() {
        // Very fast miner should have near-zero time estimate at low difficulty
        let estimate = estimate_profitability(4, 10, 1000, 1e15);
        assert!(estimate.expected_time_secs < 1.0,
            "1 petahash/sec should solve difficulty 4 in well under 1 second, got {}",
            estimate.expected_time_secs);
    }

    #[test]
    fn test_track_difficulty_minimum_floor() {
        // Even with extremely slow mining, difficulty should not drop below 1
        // (the PoW library's adjust_difficulty clamps to min 1)
        let transitions = vec![0, 1_000_000];
        let new_diff = track_difficulty(2, &transitions, 5);
        assert!(new_diff >= 1,
            "Difficulty should never drop below 1, got {}", new_diff);
    }

    #[test]
    fn test_auction_hash_phase_change_produces_different_hash() {
        // Changing only the phase should produce a different hash
        let mut auction_commit = test_auction();
        auction_commit.phase = PHASE_COMMIT;

        let mut auction_reveal = test_auction();
        auction_reveal.phase = PHASE_REVEAL;

        let hash_commit = compute_auction_hash(&auction_commit);
        let hash_reveal = compute_auction_hash(&auction_reveal);
        assert_ne!(hash_commit, hash_reveal,
            "Different phases must produce different auction hashes");
    }

    #[test]
    fn test_auction_hash_is_32_bytes() {
        // Sanity: compute_auction_hash always returns exactly 32 bytes (SHA-256)
        let auction = test_auction();
        let hash = compute_auction_hash(&auction);
        assert_eq!(hash.len(), 32);
        // Non-trivial: hash of non-zero data should not be all zeros
        assert_ne!(hash, [0u8; 32], "Hash of non-trivial auction should not be all zeros");
    }

    // ============ New Edge Case & Boundary Tests ============

    #[test]
    fn test_mine_all_zero_pair_id_and_prev_hash() {
        // All-zero inputs should still produce a valid proof at low difficulty
        let pair_id = [0u8; 32];
        let prev_hash = [0u8; 32];

        let proof = mine_for_cell(&pair_id, 0, &prev_hash, 4, 100_000);
        assert!(proof.is_some(), "All-zero inputs should still allow mining");
        assert!(vibeswap_pow::verify(&proof.unwrap(), 4));
    }

    #[test]
    fn test_mine_all_ff_pair_id_and_prev_hash() {
        // All-FF inputs should produce a valid proof
        let pair_id = [0xFF; 32];
        let prev_hash = [0xFF; 32];

        let proof = mine_for_cell(&pair_id, u64::MAX, &prev_hash, 4, 100_000);
        assert!(proof.is_some(), "All-FF inputs should still allow mining");
        assert!(vibeswap_pow::verify(&proof.unwrap(), 4));
    }

    #[test]
    fn test_aggregation_single_commit_outpoint_index_varies() {
        // Verify different outpoint_index values are correctly preserved
        let auction = test_auction();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };

        for idx in [0u32, 1, 42, u32::MAX] {
            let mut commit = make_commit(1);
            commit.outpoint_index = idx;

            let tx = build_aggregation_tx(
                &auction, &[commit], None, &proof,
                &test_deployment(), &test_miner_lock(),
            );

            assert_eq!(tx.inputs[1].index, idx,
                "Outpoint index {} must be preserved in tx input", idx);
        }
    }

    #[test]
    fn test_aggregation_commit_ordering_preserved() {
        // Commits should appear as inputs in the same order they are passed
        let auction = test_auction();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };

        let commits: Vec<PendingCommit> = (1..=5).map(|i| {
            let mut c = make_commit(i);
            c.outpoint_index = i as u32 * 10; // Unique index per commit
            c
        }).collect();

        let tx = build_aggregation_tx(
            &auction, &commits, None, &proof,
            &test_deployment(), &test_miner_lock(),
        );

        // inputs[0] is auction cell, inputs[1..6] are commits in order
        for (i, commit) in commits.iter().enumerate() {
            assert_eq!(tx.inputs[i + 1].tx_hash, commit.outpoint_tx_hash,
                "Commit {} tx_hash should match", i);
            assert_eq!(tx.inputs[i + 1].index, commit.outpoint_index,
                "Commit {} index should match", i);
        }
    }

    #[test]
    fn test_aggregation_output_has_type_script() {
        // Verify the output cell always has a type_script (it should never be None)
        let auction = test_auction();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };

        let tx = build_aggregation_tx(
            &auction, &[], None, &proof,
            &test_deployment(), &test_miner_lock(),
        );

        assert!(tx.outputs[0].type_script.is_some(),
            "Output auction cell must have a type script");
    }

    #[test]
    fn test_profitability_one_commit() {
        // Single commit profitability should exactly equal base_reward
        let estimate = estimate_profitability(4, 1, 5_000, 1_000_000.0);
        assert_eq!(estimate.expected_reward_ckb, 5_000,
            "1 commit * 5000 base = 5000 reward");
    }

    #[test]
    fn test_profitability_max_commits() {
        // Very high commit count should scale reward linearly
        let estimate = estimate_profitability(4, u32::MAX, 1, 1_000_000.0);
        assert_eq!(estimate.expected_reward_ckb, u32::MAX as u64,
            "u32::MAX commits * 1 base = u32::MAX reward");
    }

    #[test]
    fn test_track_difficulty_large_gap_between_transitions() {
        // Very large gap between transitions (e.g., 10 million blocks apart)
        let transitions = vec![100, 10_000_100];
        let new_diff = track_difficulty(16, &transitions, 5);
        // actual_avg = 10_000_000, target = 5 → way too slow → decrease
        assert!(new_diff < 16,
            "Extremely slow transitions should decrease difficulty, got {}", new_diff);
    }

    #[test]
    fn test_aggregation_mmr_root_same_commit_set_deterministic() {
        // Same commits should always produce the same MMR root
        let auction = test_auction();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };
        let commits: Vec<PendingCommit> = (1..=3).map(|i| make_commit(i)).collect();

        let tx1 = build_aggregation_tx(
            &auction, &commits, None, &proof,
            &test_deployment(), &test_miner_lock(),
        );
        let tx2 = build_aggregation_tx(
            &auction, &commits, None, &proof,
            &test_deployment(), &test_miner_lock(),
        );

        let a1 = AuctionCellData::deserialize(&tx1.outputs[0].data).unwrap();
        let a2 = AuctionCellData::deserialize(&tx2.outputs[0].data).unwrap();
        assert_eq!(a1.commit_mmr_root, a2.commit_mmr_root,
            "Same commit set must produce identical MMR root");
    }

    #[test]
    fn test_auction_hash_all_fields_contribute() {
        // Changing each individual field should produce a different hash
        let base = test_auction();

        let mut varied_pair_id = base.clone();
        varied_pair_id.pair_id = [0xFF; 32];

        let mut varied_reveal = base.clone();
        varied_reveal.reveal_count = 99;

        let hash_base = compute_auction_hash(&base);
        let hash_pair = compute_auction_hash(&varied_pair_id);
        let hash_reveal = compute_auction_hash(&varied_reveal);

        assert_ne!(hash_base, hash_pair, "Changing pair_id should change hash");
        assert_ne!(hash_base, hash_reveal, "Changing reveal_count should change hash");
        assert_ne!(hash_pair, hash_reveal, "Different fields should produce different hashes");
    }

    // ============ New Tests: Coverage Expansion (Batch 4) ============

    #[test]
    fn test_miner_config_fields_accessible() {
        let config = MinerConfig {
            max_iterations: 500_000,
            ckb_rpc_url: "http://localhost:8114".to_string(),
            indexer_rpc_url: "http://localhost:8116".to_string(),
            miner_lock: test_miner_lock(),
            pair_ids: vec![[0x01; 32], [0x02; 32]],
            min_reward_ckb: 1_000_000,
        };

        assert_eq!(config.max_iterations, 500_000);
        assert_eq!(config.ckb_rpc_url, "http://localhost:8114");
        assert_eq!(config.indexer_rpc_url, "http://localhost:8116");
        assert_eq!(config.pair_ids.len(), 2);
        assert_eq!(config.min_reward_ckb, 1_000_000);
    }

    #[test]
    fn test_miner_state_initialization() {
        let state = MinerState {
            difficulties: vec![([0x01; 32], 16), ([0x02; 32], 20)],
            pending_commits: vec![make_commit(1), make_commit(2)],
            auction_states: vec![([0x01; 32], test_auction())],
            stats: MiningStats::default(),
        };

        assert_eq!(state.difficulties.len(), 2);
        assert_eq!(state.pending_commits.len(), 2);
        assert_eq!(state.auction_states.len(), 1);
        assert_eq!(state.stats.total_hashes, 0);
        assert_eq!(state.stats.blocks_mined, 0);
    }

    #[test]
    fn test_mining_stats_default_all_zero() {
        let stats = MiningStats::default();
        assert_eq!(stats.total_hashes, 0);
        assert_eq!(stats.blocks_mined, 0);
        assert_eq!(stats.total_commits_aggregated, 0);
        assert_eq!(stats.total_reward_ckb, 0);
        assert_eq!(stats.avg_hash_rate, 0.0);
    }

    #[test]
    fn test_mine_challenge_deterministic_same_inputs() {
        // Identical inputs must produce the same challenge every time
        let pair_id = [0x42; 32];
        let prev_hash = [0xAB; 32];
        let batch_id = 99;

        let proof1 = mine_for_cell(&pair_id, batch_id, &prev_hash, 4, 100_000).unwrap();
        let proof2 = mine_for_cell(&pair_id, batch_id, &prev_hash, 4, 100_000).unwrap();

        assert_eq!(proof1.challenge, proof2.challenge,
            "Same inputs must always produce the same challenge");
    }

    #[test]
    fn test_profitability_unprofitable_high_difficulty_low_reward() {
        // Very high difficulty with minimal reward should be unprofitable
        let estimate = estimate_profitability(32, 1, 1, 1_000.0);
        // At difficulty 32, expected hashes ~ 2^32 = ~4 billion
        // At 1000 H/s, that's ~4 million seconds
        // Energy cost = 4_000_000_000 / 1_000_000 * 0.1 = 400 CKB
        // Reward = 1 * 1 = 1 CKB
        // Profit = 1 - 400 = -399 (negative)
        assert!(!estimate.is_profitable,
            "High difficulty + low reward should be unprofitable");
        assert_eq!(estimate.estimated_profit_ckb, 0,
            "Negative profit should be clamped to 0");
    }

    #[test]
    fn test_aggregation_output_data_roundtrip() {
        // Build aggregation, deserialize output, verify all fields are consistent
        let mut auction = test_auction();
        auction.batch_id = 77;
        auction.phase = PHASE_COMMIT;
        auction.pair_id = [0xAB; 32];
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };

        let commits: Vec<PendingCommit> = (1..=4).map(|i| make_commit(i)).collect();

        let tx = build_aggregation_tx(
            &auction, &commits, None, &proof,
            &test_deployment(), &test_miner_lock(),
        );

        let output_data = &tx.outputs[0].data;
        let new_auction = AuctionCellData::deserialize(output_data).unwrap();

        // Verify fields are set correctly
        assert_eq!(new_auction.commit_count, auction.commit_count + 4);
        assert_eq!(new_auction.prev_state_hash, compute_auction_hash(&auction));
        assert_ne!(new_auction.commit_mmr_root, [0u8; 32]);

        // Serialize again and verify it matches
        let re_serialized = new_auction.serialize();
        let re_deserialized = AuctionCellData::deserialize(&re_serialized).unwrap();
        assert_eq!(re_deserialized.commit_count, new_auction.commit_count);
        assert_eq!(re_deserialized.prev_state_hash, new_auction.prev_state_hash);
        assert_eq!(re_deserialized.commit_mmr_root, new_auction.commit_mmr_root);
    }

    #[test]
    fn test_aggregation_with_duplicate_commits() {
        // Two commits with the same outpoint — SDK builds the tx, on-chain validation catches dupes
        let auction = test_auction();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };

        let commit = make_commit(1);
        let commits = vec![commit.clone(), commit.clone()];

        let tx = build_aggregation_tx(
            &auction, &commits, None, &proof,
            &test_deployment(), &test_miner_lock(),
        );

        // SDK should faithfully include both — on-chain script rejects dupes
        assert_eq!(tx.inputs.len(), 3); // auction + 2 duplicate commits
        assert_eq!(tx.inputs[1].tx_hash, tx.inputs[2].tx_hash);
    }

    #[test]
    fn test_track_difficulty_boundary_value_one() {
        // Difficulty 1 is the minimum floor
        let fast = vec![100, 101, 102, 103, 104];
        let new_diff = track_difficulty(1, &fast, 5);
        // Mining too fast at difficulty 1 should increase
        assert!(new_diff >= 1, "Difficulty must stay >= 1, got {}", new_diff);
    }

    #[test]
    fn test_track_difficulty_boundary_value_max() {
        // At max difficulty (255), even fast mining shouldn't overflow
        let fast = vec![100, 101, 102];
        let new_diff = track_difficulty(255, &fast, 5);
        // Already at max — can't go higher, stays at 255
        assert!(new_diff <= 255, "Difficulty must fit in u8, got {}", new_diff);
    }

    #[test]
    fn test_profitability_estimate_struct_fields_consistent() {
        // Verify all fields of MiningEstimate are consistent with each other
        let estimate = estimate_profitability(8, 5, 2000, 500_000.0);

        // expected_time = expected_hashes / hash_rate
        let computed_time = estimate.expected_hashes as f64 / 500_000.0;
        let diff = (estimate.expected_time_secs - computed_time).abs();
        assert!(diff < 0.001,
            "expected_time_secs should match expected_hashes / hash_rate: {} vs {}",
            estimate.expected_time_secs, computed_time);

        // reward = base * commits
        assert_eq!(estimate.expected_reward_ckb, 10_000,
            "Reward should be 2000 * 5 = 10000");

        // is_profitable should match profit > 0
        if estimate.estimated_profit_ckb > 0 {
            assert!(estimate.is_profitable);
        }
    }

    #[test]
    fn test_aggregation_large_commit_count_overflow_safety() {
        // Start with near-max commit_count and add more
        let mut auction = test_auction();
        auction.commit_count = u32::MAX - 2;
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };

        let commits: Vec<PendingCommit> = (1..=2).map(|i| make_commit(i)).collect();

        let tx = build_aggregation_tx(
            &auction, &commits, None, &proof,
            &test_deployment(), &test_miner_lock(),
        );

        let new_auction = AuctionCellData::deserialize(&tx.outputs[0].data).unwrap();
        assert_eq!(new_auction.commit_count, u32::MAX,
            "commit_count should reach u32::MAX without panic");
    }

    // ============ New Tests: Edge Cases & Boundaries (Batch 5) ============

    #[test]
    fn test_mine_batch_id_one_yields_unique_challenge() {
        // batch_id=1 vs batch_id=2 — adjacent values must differ
        let pair_id = [0x42; 32];
        let prev_hash = [0u8; 32];

        let proof_1 = mine_for_cell(&pair_id, 1, &prev_hash, 4, 100_000).unwrap();
        let proof_2 = mine_for_cell(&pair_id, 2, &prev_hash, 4, 100_000).unwrap();

        assert_ne!(proof_1.challenge, proof_2.challenge,
            "Adjacent batch_ids must produce different challenges");
    }

    #[test]
    fn test_mine_u64_max_minus_one_batch_id() {
        // Test the penultimate batch_id value
        let pair_id = [0x42; 32];
        let prev_hash = [0u8; 32];

        let proof = mine_for_cell(&pair_id, u64::MAX - 1, &prev_hash, 4, 100_000);
        assert!(proof.is_some(), "u64::MAX - 1 batch_id should allow mining");

        // Should differ from u64::MAX
        let proof_max = mine_for_cell(&pair_id, u64::MAX, &prev_hash, 4, 100_000).unwrap();
        assert_ne!(proof.unwrap().challenge, proof_max.challenge,
            "u64::MAX-1 and u64::MAX must produce different challenges");
    }

    #[test]
    fn test_mine_difficulty_one_succeeds_quickly() {
        // Difficulty 1 means 50% chance per hash — should succeed within a few tries
        let pair_id = [0x42; 32];
        let prev_hash = [0u8; 32];

        let proof = mine_for_cell(&pair_id, 0, &prev_hash, 1, 100);
        assert!(proof.is_some(), "Difficulty 1 should succeed within 100 iterations");
        assert!(vibeswap_pow::verify(&proof.unwrap(), 1));
    }

    #[test]
    fn test_mine_proof_verifies_at_claimed_difficulty_not_higher() {
        // A proof mined at difficulty 4 verifies at 4 but may not verify at 20
        let pair_id = [0x42; 32];
        let prev_hash = [0u8; 32];

        let proof = mine_for_cell(&pair_id, 0, &prev_hash, 4, 100_000).unwrap();
        assert!(vibeswap_pow::verify(&proof, 4), "Must verify at mined difficulty");
        // Note: can't assert it fails at higher difficulty since it might exceed 4 by luck
        // But we can assert it passes at lower difficulty
        assert!(vibeswap_pow::verify(&proof, 0), "Must verify at difficulty 0");
        assert!(vibeswap_pow::verify(&proof, 1), "Must verify at difficulty 1");
    }

    #[test]
    fn test_estimate_profitability_difficulty_zero() {
        // Difficulty 0 means 1 expected hash
        let estimate = estimate_profitability(0, 10, 1000, 1_000_000.0);
        assert_eq!(estimate.expected_hashes, 1,
            "Difficulty 0 should require exactly 1 hash");
        assert!(estimate.expected_time_secs < 0.001,
            "1 hash at 1M H/s should take microseconds");
        assert!(estimate.is_profitable,
            "Difficulty 0 with reward should be profitable");
    }

    #[test]
    fn test_estimate_profitability_difficulty_one() {
        // Difficulty 1 means 2 expected hashes
        let estimate = estimate_profitability(1, 10, 1000, 1_000_000.0);
        assert_eq!(estimate.expected_hashes, 2,
            "Difficulty 1 should require 2 expected hashes");
    }

    #[test]
    fn test_estimate_profitability_difficulty_63() {
        // Difficulty 63 is the max before u64::MAX kicks in
        let estimate = estimate_profitability(63, 10, 1000, 1_000_000.0);
        assert_eq!(estimate.expected_hashes, 1u64 << 63,
            "Difficulty 63 should require 2^63 expected hashes");
    }

    #[test]
    fn test_estimate_profitability_large_base_reward() {
        // Very large base reward with many commits — check no overflow in reward calc
        let estimate = estimate_profitability(4, 1000, 1_000_000, 1_000_000.0);
        assert_eq!(estimate.expected_reward_ckb, 1_000_000_000u64,
            "1000 commits * 1M base = 1B reward");
    }

    #[test]
    fn test_estimate_profitability_energy_cost_scales_with_difficulty() {
        let est_low = estimate_profitability(4, 10, 1000, 1_000_000.0);
        let est_high = estimate_profitability(30, 10, 1000, 1_000_000.0);
        assert!(est_high.estimated_cost_ckb >= est_low.estimated_cost_ckb,
            "Higher difficulty should have higher or equal energy cost");
    }

    #[test]
    fn test_track_difficulty_three_transitions() {
        // Three transitions — enough data for adjustment
        let transitions = vec![100, 110, 120];
        let new_diff = track_difficulty(16, &transitions, 10);
        // actual_avg = (120-100)/2 = 10, target = 10 → no change
        assert_eq!(new_diff, 16);
    }

    #[test]
    fn test_track_difficulty_many_transitions_stable() {
        // 100 transitions, perfectly on target
        let transitions: Vec<u64> = (0..100).map(|i| 1000 + i * 5).collect();
        let new_diff = track_difficulty(16, &transitions, 5);
        assert_eq!(new_diff, 16, "Perfectly timed transitions should keep difficulty stable");
    }

    #[test]
    fn test_track_difficulty_descending_from_high() {
        // Start at difficulty 200 with slow transitions — should decrease
        let transitions = vec![100, 200, 300];
        let new_diff = track_difficulty(200, &transitions, 5);
        assert!(new_diff < 200,
            "Slow transitions at high difficulty should decrease, got {}", new_diff);
    }

    #[test]
    fn test_track_difficulty_ascending_from_low() {
        // Start at difficulty 2 with fast transitions — should increase
        let transitions = vec![100, 101, 102, 103, 104];
        let new_diff = track_difficulty(2, &transitions, 10);
        assert!(new_diff > 2,
            "Fast transitions at low difficulty should increase, got {}", new_diff);
    }

    #[test]
    fn test_track_difficulty_consecutive_blocks() {
        // Transitions happening every single block (fastest possible)
        let transitions = vec![100, 101, 102, 103, 104, 105, 106, 107, 108, 109];
        let new_diff = track_difficulty(16, &transitions, 10);
        assert!(new_diff > 16,
            "1-block transitions with target 10 should increase difficulty, got {}", new_diff);
    }

    #[test]
    fn test_compute_auction_hash_default_state() {
        // Hash of a default auction state should be non-zero and deterministic
        let default_auction = AuctionCellData::default();
        let hash = compute_auction_hash(&default_auction);
        assert_ne!(hash, [0u8; 32], "Hash of default auction should not be all zeros");
        let hash2 = compute_auction_hash(&default_auction);
        assert_eq!(hash, hash2, "Hash must be deterministic");
    }

    #[test]
    fn test_compute_auction_hash_clearing_price_change() {
        let mut auction1 = test_auction();
        auction1.clearing_price = 0;
        let mut auction2 = test_auction();
        auction2.clearing_price = 1_000_000_000_000_000_000; // 1e18

        let hash1 = compute_auction_hash(&auction1);
        let hash2 = compute_auction_hash(&auction2);
        assert_ne!(hash1, hash2,
            "Different clearing_price must produce different hash");
    }

    #[test]
    fn test_compute_auction_hash_xor_seed_change() {
        let mut auction1 = test_auction();
        auction1.xor_seed = [0u8; 32];
        let mut auction2 = test_auction();
        auction2.xor_seed = [0xFF; 32];

        let hash1 = compute_auction_hash(&auction1);
        let hash2 = compute_auction_hash(&auction2);
        assert_ne!(hash1, hash2,
            "Different xor_seed must produce different hash");
    }

    #[test]
    fn test_aggregation_all_phases() {
        // Build aggregation from every phase — should work structurally for all
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };

        for phase in [PHASE_COMMIT, PHASE_REVEAL, PHASE_SETTLING, PHASE_SETTLED] {
            let mut auction = test_auction();
            auction.phase = phase;

            let tx = build_aggregation_tx(
                &auction, &[make_commit(1)], None, &proof,
                &test_deployment(), &test_miner_lock(),
            );

            assert_eq!(tx.inputs.len(), 2,
                "Phase {} should produce 2 inputs", phase);
            assert_eq!(tx.outputs.len(), 1,
                "Phase {} should produce 1 output", phase);
        }
    }

    #[test]
    fn test_aggregation_max_outpoint_index() {
        // u32::MAX outpoint index should be preserved
        let auction = test_auction();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };

        let mut commit = make_commit(1);
        commit.outpoint_index = u32::MAX;

        let tx = build_aggregation_tx(
            &auction, &[commit], None, &proof,
            &test_deployment(), &test_miner_lock(),
        );

        assert_eq!(tx.inputs[1].index, u32::MAX,
            "u32::MAX outpoint_index must be preserved");
    }

    #[test]
    fn test_aggregation_different_pair_ids_produce_different_outputs() {
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };

        let mut auction_a = test_auction();
        auction_a.pair_id = [0xAA; 32];
        let mut auction_b = test_auction();
        auction_b.pair_id = [0xBB; 32];

        let tx_a = build_aggregation_tx(
            &auction_a, &[make_commit(1)], None, &proof,
            &test_deployment(), &test_miner_lock(),
        );
        let tx_b = build_aggregation_tx(
            &auction_b, &[make_commit(1)], None, &proof,
            &test_deployment(), &test_miner_lock(),
        );

        // Different pair_ids → different output data (different prev_state_hash, MMR root same but pair_id differs)
        assert_ne!(tx_a.outputs[0].data, tx_b.outputs[0].data,
            "Different pair_ids should produce different output data");

        // Type script args should differ
        let type_a = tx_a.outputs[0].type_script.as_ref().unwrap();
        let type_b = tx_b.outputs[0].type_script.as_ref().unwrap();
        assert_ne!(type_a.args, type_b.args, "Type script args should contain different pair_ids");
    }

    #[test]
    fn test_aggregation_compliance_data_does_not_filter() {
        // Current implementation includes all commits regardless of compliance data
        let auction = test_auction();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };
        let commits: Vec<PendingCommit> = (1..=5).map(|i| make_commit(i)).collect();

        let compliance = ComplianceCellData {
            blocked_merkle_root: [0xFF; 32], // "full" blocklist
            tier_merkle_root: [0xDD; 32],
            jurisdiction_root: [0xEE; 32],
            last_updated: 999,
            version: 2,
        };

        let tx_without = build_aggregation_tx(
            &auction, &commits, None, &proof,
            &test_deployment(), &test_miner_lock(),
        );
        let tx_with = build_aggregation_tx(
            &auction, &commits, Some(&compliance), &proof,
            &test_deployment(), &test_miner_lock(),
        );

        // Both should have same number of inputs since compliance doesn't filter yet
        assert_eq!(tx_without.inputs.len(), tx_with.inputs.len(),
            "Compliance data should not change input count in current impl");
    }

    #[test]
    fn test_aggregation_auction_input_since_is_zero() {
        // The auction cell input should always have since=0
        let auction = test_auction();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };

        let tx = build_aggregation_tx(
            &auction, &[make_commit(1)], None, &proof,
            &test_deployment(), &test_miner_lock(),
        );

        assert_eq!(tx.inputs[0].since, 0, "Auction cell input since must be 0");
    }

    #[test]
    fn test_aggregation_cell_dep_type_is_dep_group() {
        let auction = test_auction();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };

        let tx = build_aggregation_tx(
            &auction, &[], None, &proof,
            &test_deployment(), &test_miner_lock(),
        );

        assert!(matches!(tx.cell_deps[0].dep_type, super::super::DepType::DepGroup),
            "Cell dep type must be DepGroup");
    }

    #[test]
    fn test_miner_config_clone() {
        let config = MinerConfig {
            max_iterations: 1_000_000,
            ckb_rpc_url: "http://localhost:8114".to_string(),
            indexer_rpc_url: "http://localhost:8116".to_string(),
            miner_lock: test_miner_lock(),
            pair_ids: vec![[0x01; 32]],
            min_reward_ckb: 500,
        };

        let cloned = config.clone();
        assert_eq!(cloned.max_iterations, config.max_iterations);
        assert_eq!(cloned.ckb_rpc_url, config.ckb_rpc_url);
        assert_eq!(cloned.min_reward_ckb, config.min_reward_ckb);
        assert_eq!(cloned.pair_ids.len(), config.pair_ids.len());
    }

    #[test]
    fn test_miner_state_clone() {
        let state = MinerState {
            difficulties: vec![([0x01; 32], 16)],
            pending_commits: vec![make_commit(1)],
            auction_states: vec![([0x01; 32], test_auction())],
            stats: MiningStats {
                total_hashes: 1_000_000,
                blocks_mined: 5,
                total_commits_aggregated: 50,
                total_reward_ckb: 500_000,
                avg_hash_rate: 100_000.0,
            },
        };

        let cloned = state.clone();
        assert_eq!(cloned.stats.total_hashes, 1_000_000);
        assert_eq!(cloned.stats.blocks_mined, 5);
        assert_eq!(cloned.stats.total_commits_aggregated, 50);
        assert_eq!(cloned.stats.total_reward_ckb, 500_000);
        assert_eq!(cloned.stats.avg_hash_rate, 100_000.0);
    }

    #[test]
    fn test_pending_commit_clone() {
        let commit = make_commit(0xAB);
        let cloned = commit.clone();

        assert_eq!(cloned.commit_data.order_hash, commit.commit_data.order_hash);
        assert_eq!(cloned.outpoint_tx_hash, commit.outpoint_tx_hash);
        assert_eq!(cloned.outpoint_index, commit.outpoint_index);
        assert_eq!(cloned.commit_data.deposit_ckb, commit.commit_data.deposit_ckb);
    }

    #[test]
    fn test_mining_estimate_clone() {
        let estimate = estimate_profitability(8, 5, 1000, 1_000_000.0);
        let cloned = estimate.clone();

        assert_eq!(cloned.expected_hashes, estimate.expected_hashes);
        assert_eq!(cloned.expected_time_secs, estimate.expected_time_secs);
        assert_eq!(cloned.expected_reward_ckb, estimate.expected_reward_ckb);
        assert_eq!(cloned.estimated_cost_ckb, estimate.estimated_cost_ckb);
        assert_eq!(cloned.estimated_profit_ckb, estimate.estimated_profit_ckb);
        assert_eq!(cloned.is_profitable, estimate.is_profitable);
    }

    #[test]
    fn test_aggregation_output_lock_hash_type_is_type() {
        let auction = test_auction();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };

        let tx = build_aggregation_tx(
            &auction, &[], None, &proof,
            &test_deployment(), &test_miner_lock(),
        );

        assert!(matches!(tx.outputs[0].lock_script.hash_type, super::super::HashType::Type),
            "Output lock script hash_type must be Type");
    }

    #[test]
    fn test_aggregation_output_capacity_is_zero() {
        // The build_aggregation_tx sets capacity to 0 (placeholder)
        let auction = test_auction();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };

        let tx = build_aggregation_tx(
            &auction, &[], None, &proof,
            &test_deployment(), &test_miner_lock(),
        );

        assert_eq!(tx.outputs[0].capacity, 0,
            "Output capacity should be 0 (placeholder)");
    }

    #[test]
    fn test_aggregation_pow_lock_args_min_difficulty() {
        // Verify the PoW lock args always use DEFAULT_MIN_POW_DIFFICULTY
        let auction = test_auction();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };

        let tx = build_aggregation_tx(
            &auction, &[], None, &proof,
            &test_deployment(), &test_miner_lock(),
        );

        let args = PoWLockArgs::deserialize(&tx.outputs[0].lock_script.args).unwrap();
        assert_eq!(args.min_difficulty, DEFAULT_MIN_POW_DIFFICULTY,
            "PoW lock args min_difficulty must be DEFAULT_MIN_POW_DIFFICULTY ({})",
            DEFAULT_MIN_POW_DIFFICULTY);
    }

    #[test]
    fn test_profitability_borderline_profitable() {
        // Find parameters where profit is exactly on the boundary
        // At difficulty 4, expected_hashes = 16
        // energy_cost = 16 / 1_000_000 * 0.1 = 0.0000016 (rounds to 0 in u64)
        // So reward = base * commits, and if base*commits > 0, it's profitable
        let estimate = estimate_profitability(4, 1, 1, 1_000_000.0);
        assert_eq!(estimate.expected_reward_ckb, 1);
        assert_eq!(estimate.estimated_cost_ckb, 0, "Very low energy cost rounds to 0");
        assert!(estimate.is_profitable,
            "Reward of 1 with cost of 0 should be profitable");
    }

    #[test]
    fn test_track_difficulty_target_one_block() {
        // Target of 1 block per transition with exactly 1-block spacing
        let transitions = vec![100, 101, 102, 103, 104];
        let new_diff = track_difficulty(16, &transitions, 1);
        assert_eq!(new_diff, 16, "On-target spacing should keep difficulty stable");
    }

    #[test]
    fn test_track_difficulty_very_large_target() {
        // Very large target blocks per transition
        let transitions = vec![0, 100];
        let new_diff = track_difficulty(16, &transitions, 1_000_000);
        // actual_avg = 100, target = 1_000_000 → way too fast → increase
        assert!(new_diff > 16,
            "Much faster than large target should increase difficulty, got {}", new_diff);
    }

    #[test]
    fn test_aggregation_255_commits() {
        // Test with u8::MAX commits to stress input vector
        let auction = test_auction();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };

        let commits: Vec<PendingCommit> = (0..=254).map(|i| make_commit(i as u8)).collect();
        assert_eq!(commits.len(), 255);

        let tx = build_aggregation_tx(
            &auction, &commits, None, &proof,
            &test_deployment(), &test_miner_lock(),
        );

        assert_eq!(tx.inputs.len(), 256, "1 auction + 255 commits = 256 inputs");
        let new_auction = AuctionCellData::deserialize(&tx.outputs[0].data).unwrap();
        assert_eq!(new_auction.commit_count, 255);
    }

    // ============ Batch 6: Hardening to 120+ Tests ============

    #[test]
    fn test_mine_difficulty_two_succeeds_within_many_iterations() {
        // Difficulty 2 means 25% chance per hash — should succeed within 1000
        let pair_id = [0x42; 32];
        let prev_hash = [0u8; 32];
        let proof = mine_for_cell(&pair_id, 0, &prev_hash, 2, 1000);
        assert!(proof.is_some(), "Difficulty 2 should succeed within 1000 iterations");
        assert!(vibeswap_pow::verify(&proof.unwrap(), 2));
    }

    #[test]
    fn test_mine_u64_max_batch_id() {
        // Extreme batch_id value should still produce a valid challenge
        let pair_id = [0x42; 32];
        let prev_hash = [0u8; 32];
        let proof = mine_for_cell(&pair_id, u64::MAX, &prev_hash, 4, 100_000);
        assert!(proof.is_some(), "u64::MAX batch_id should still allow mining");
    }

    #[test]
    fn test_mine_zero_batch_id() {
        // batch_id = 0 should work normally
        let pair_id = [0x42; 32];
        let prev_hash = [0xCC; 32];
        let proof = mine_for_cell(&pair_id, 0, &prev_hash, 4, 100_000);
        assert!(proof.is_some());
    }

    #[test]
    fn test_aggregation_output_data_is_serializable() {
        // The output data should always be deserializable back to AuctionCellData
        let auction = test_auction();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };
        let commits: Vec<PendingCommit> = (1..=7).map(|i| make_commit(i)).collect();

        let tx = build_aggregation_tx(
            &auction, &commits, None, &proof,
            &test_deployment(), &test_miner_lock(),
        );

        let parsed = AuctionCellData::deserialize(&tx.outputs[0].data);
        assert!(parsed.is_some(), "Output data must be valid AuctionCellData");
    }

    #[test]
    fn test_aggregation_empty_commits_zero_mmr_root_is_consistent() {
        // Two builds with empty commits should produce identical output
        let auction = test_auction();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };

        let tx1 = build_aggregation_tx(
            &auction, &[], None, &proof,
            &test_deployment(), &test_miner_lock(),
        );
        let tx2 = build_aggregation_tx(
            &auction, &[], None, &proof,
            &test_deployment(), &test_miner_lock(),
        );

        assert_eq!(tx1.outputs[0].data, tx2.outputs[0].data,
            "Same inputs must produce identical output data");
    }

    #[test]
    fn test_aggregation_different_commits_different_mmr() {
        // Different commit sets should produce different MMR roots
        let auction = test_auction();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };

        let tx1 = build_aggregation_tx(
            &auction, &[make_commit(1)], None, &proof,
            &test_deployment(), &test_miner_lock(),
        );
        let tx2 = build_aggregation_tx(
            &auction, &[make_commit(2)], None, &proof,
            &test_deployment(), &test_miner_lock(),
        );

        let a1 = AuctionCellData::deserialize(&tx1.outputs[0].data).unwrap();
        let a2 = AuctionCellData::deserialize(&tx2.outputs[0].data).unwrap();
        assert_ne!(a1.commit_mmr_root, a2.commit_mmr_root,
            "Different commits must produce different MMR roots");
    }

    #[test]
    fn test_profitability_zero_commits() {
        // Zero pending commits → zero reward
        let estimate = estimate_profitability(8, 0, 1000, 1_000_000.0);
        assert_eq!(estimate.expected_reward_ckb, 0);
        assert!(!estimate.is_profitable);
    }

    #[test]
    fn test_profitability_difficulty_two() {
        // Difficulty 2 → 4 expected hashes
        let estimate = estimate_profitability(2, 10, 1000, 1_000_000.0);
        assert_eq!(estimate.expected_hashes, 4);
    }

    #[test]
    fn test_profitability_difficulty_eight() {
        // Difficulty 8 → 256 expected hashes
        let estimate = estimate_profitability(8, 10, 1000, 1_000_000.0);
        assert_eq!(estimate.expected_hashes, 256);
    }

    #[test]
    fn test_track_difficulty_no_transitions_returns_current() {
        // Empty transitions list → return current difficulty unchanged
        let new_diff = track_difficulty(16, &[], 5);
        assert_eq!(new_diff, 16);
    }

    #[test]
    fn test_track_difficulty_one_transition_returns_current() {
        // Single transition → return current difficulty unchanged (need >= 2)
        let new_diff = track_difficulty(16, &[100], 5);
        assert_eq!(new_diff, 16);
    }

    #[test]
    fn test_compute_auction_hash_deterministic() {
        let auction = test_auction();
        let hash1 = compute_auction_hash(&auction);
        let hash2 = compute_auction_hash(&auction);
        assert_eq!(hash1, hash2, "Hash must be deterministic");
    }

    #[test]
    fn test_compute_auction_hash_batch_id_change() {
        let mut auction1 = test_auction();
        auction1.batch_id = 0;
        let mut auction2 = test_auction();
        auction2.batch_id = 1;

        let hash1 = compute_auction_hash(&auction1);
        let hash2 = compute_auction_hash(&auction2);
        assert_ne!(hash1, hash2, "Different batch_id must produce different hash");
    }

    #[test]
    fn test_compute_auction_hash_commit_count_change() {
        let mut auction1 = test_auction();
        auction1.commit_count = 0;
        let mut auction2 = test_auction();
        auction2.commit_count = 100;

        let hash1 = compute_auction_hash(&auction1);
        let hash2 = compute_auction_hash(&auction2);
        assert_ne!(hash1, hash2, "Different commit_count must produce different hash");
    }

    #[test]
    fn test_aggregation_input_since_all_zero() {
        // All inputs (auction + commits) should have since=0
        let auction = test_auction();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };
        let commits: Vec<PendingCommit> = (1..=3).map(|i| make_commit(i)).collect();

        let tx = build_aggregation_tx(
            &auction, &commits, None, &proof,
            &test_deployment(), &test_miner_lock(),
        );

        for (i, input) in tx.inputs.iter().enumerate() {
            assert_eq!(input.since, 0, "Input {} since must be 0", i);
        }
    }

    #[test]
    fn test_miner_state_empty_fields() {
        let state = MinerState {
            difficulties: vec![],
            pending_commits: vec![],
            auction_states: vec![],
            stats: MiningStats::default(),
        };
        assert!(state.difficulties.is_empty());
        assert!(state.pending_commits.is_empty());
        assert!(state.auction_states.is_empty());
    }

    #[test]
    fn test_miner_config_empty_pair_ids() {
        let config = MinerConfig {
            max_iterations: 1000,
            ckb_rpc_url: String::new(),
            indexer_rpc_url: String::new(),
            miner_lock: test_miner_lock(),
            pair_ids: vec![],
            min_reward_ckb: 0,
        };
        assert!(config.pair_ids.is_empty());
        assert_eq!(config.min_reward_ckb, 0);
    }

    #[test]
    fn test_aggregation_pair_id_in_lock_args() {
        // Verify the PoW lock args contain the correct pair_id
        let mut auction = test_auction();
        auction.pair_id = [0xAB; 32];
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };

        let tx = build_aggregation_tx(
            &auction, &[], None, &proof,
            &test_deployment(), &test_miner_lock(),
        );

        let args = PoWLockArgs::deserialize(&tx.outputs[0].lock_script.args).unwrap();
        assert_eq!(args.pair_id, [0xAB; 32],
            "Lock args must contain the auction's pair_id");
    }

    // ============ Batch 7: Hardening to 145+ Tests ============

    #[test]
    fn test_mine_difficulty_three_succeeds() {
        // Difficulty 3 means ~12.5% chance per hash
        let pair_id = [0x42; 32];
        let prev_hash = [0u8; 32];
        let proof = mine_for_cell(&pair_id, 0, &prev_hash, 3, 100_000);
        assert!(proof.is_some(), "Difficulty 3 should succeed within 100k iterations");
        assert!(vibeswap_pow::verify(&proof.unwrap(), 3));
    }

    #[test]
    fn test_mine_difficulty_eight_succeeds() {
        // Difficulty 8 means expected ~256 hashes
        let pair_id = [0x42; 32];
        let prev_hash = [0u8; 32];
        let proof = mine_for_cell(&pair_id, 0, &prev_hash, 8, 1_000_000);
        assert!(proof.is_some(), "Difficulty 8 should succeed within 1M iterations");
        assert!(vibeswap_pow::verify(&proof.unwrap(), 8));
    }

    #[test]
    fn test_mine_sequential_batch_ids_produce_unique_challenges() {
        // Verify 10 sequential batch_ids all produce unique challenges
        let pair_id = [0x42; 32];
        let prev_hash = [0u8; 32];
        let mut challenges = std::collections::HashSet::new();

        for batch_id in 0..10u64 {
            let proof = mine_for_cell(&pair_id, batch_id, &prev_hash, 0, 1).unwrap();
            challenges.insert(proof.challenge);
        }
        assert_eq!(challenges.len(), 10,
            "10 sequential batch_ids must produce 10 unique challenges");
    }

    #[test]
    fn test_mine_proof_challenge_length_always_32() {
        // Regardless of inputs, challenge should always be exactly 32 bytes
        for pair_byte in [0x00, 0x42, 0xFF] {
            let pair_id = [pair_byte; 32];
            let prev_hash = [pair_byte; 32];
            let proof = mine_for_cell(&pair_id, 0, &prev_hash, 0, 1).unwrap();
            assert_eq!(proof.challenge.len(), 32,
                "Challenge must always be 32 bytes for pair_byte {}", pair_byte);
            assert_eq!(proof.nonce.len(), 32,
                "Nonce must always be 32 bytes for pair_byte {}", pair_byte);
        }
    }

    #[test]
    fn test_aggregation_single_commit_mmr_root_nonzero() {
        // A single commit should produce a non-zero MMR root
        let auction = test_auction();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };

        let tx = build_aggregation_tx(
            &auction, &[make_commit(1)], None, &proof,
            &test_deployment(), &test_miner_lock(),
        );

        let new_auction = AuctionCellData::deserialize(&tx.outputs[0].data).unwrap();
        assert_ne!(new_auction.commit_mmr_root, [0u8; 32],
            "Single commit should produce non-zero MMR root");
    }

    #[test]
    fn test_aggregation_commit_count_starts_from_auction_count() {
        // Verify commit count accumulates properly from various starting points
        for start_count in [0u32, 1, 100, 1000, u32::MAX - 5] {
            let mut auction = test_auction();
            auction.commit_count = start_count;
            let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };
            let commits: Vec<PendingCommit> = (1..=3).map(|i| make_commit(i)).collect();

            let tx = build_aggregation_tx(
                &auction, &commits, None, &proof,
                &test_deployment(), &test_miner_lock(),
            );

            let new_auction = AuctionCellData::deserialize(&tx.outputs[0].data).unwrap();
            assert_eq!(new_auction.commit_count, start_count + 3,
                "commit_count should be {} + 3 = {}", start_count, start_count + 3);
        }
    }

    #[test]
    fn test_aggregation_two_commits_ordering_in_mmr() {
        // Order of commits should matter for MMR root (append order is significant)
        let auction = test_auction();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };

        let commits_ab = vec![make_commit(1), make_commit(2)];
        let commits_ba = vec![make_commit(2), make_commit(1)];

        let tx_ab = build_aggregation_tx(
            &auction, &commits_ab, None, &proof,
            &test_deployment(), &test_miner_lock(),
        );
        let tx_ba = build_aggregation_tx(
            &auction, &commits_ba, None, &proof,
            &test_deployment(), &test_miner_lock(),
        );

        let a_ab = AuctionCellData::deserialize(&tx_ab.outputs[0].data).unwrap();
        let a_ba = AuctionCellData::deserialize(&tx_ba.outputs[0].data).unwrap();

        // MMR is order-dependent (append order matters)
        assert_ne!(a_ab.commit_mmr_root, a_ba.commit_mmr_root,
            "Different commit order should produce different MMR root");
    }

    #[test]
    fn test_aggregation_output_batch_id_preserved() {
        // The output auction should preserve batch_id from input (it's not modified by build_aggregation_tx)
        for batch_id in [0u64, 1, 42, u64::MAX] {
            let mut auction = test_auction();
            auction.batch_id = batch_id;
            let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };

            let tx = build_aggregation_tx(
                &auction, &[], None, &proof,
                &test_deployment(), &test_miner_lock(),
            );

            let new_auction = AuctionCellData::deserialize(&tx.outputs[0].data).unwrap();
            // batch_id is cloned from the input auction, so it should remain the same
            assert_eq!(new_auction.batch_id, batch_id,
                "batch_id should be preserved in output");
        }
    }

    #[test]
    fn test_profitability_difficulty_16_expected_hashes() {
        // Difficulty 16 → 2^16 = 65536 expected hashes
        let estimate = estimate_profitability(16, 1, 1000, 1_000_000.0);
        assert_eq!(estimate.expected_hashes, 65536,
            "Difficulty 16 should require 2^16 = 65536 expected hashes");
    }

    #[test]
    fn test_profitability_difficulty_32_expected_hashes() {
        // Difficulty 32 → 2^32 = 4294967296 expected hashes
        let estimate = estimate_profitability(32, 1, 1000, 1_000_000.0);
        assert_eq!(estimate.expected_hashes, 1u64 << 32,
            "Difficulty 32 should require 2^32 expected hashes");
    }

    #[test]
    fn test_profitability_is_profitable_with_high_reward() {
        // Very high reward should always be profitable even at moderate difficulty
        let estimate = estimate_profitability(16, 100, 1_000_000, 1_000_000.0);
        assert!(estimate.is_profitable,
            "100 commits * 1M base reward at difficulty 16 should be profitable");
        assert!(estimate.expected_reward_ckb > estimate.estimated_cost_ckb,
            "Reward should exceed cost");
    }

    #[test]
    fn test_profitability_time_inversely_proportional_to_hash_rate() {
        // Doubling hash rate should halve the time
        let est_slow = estimate_profitability(16, 10, 1000, 500_000.0);
        let est_fast = estimate_profitability(16, 10, 1000, 1_000_000.0);

        let ratio = est_slow.expected_time_secs / est_fast.expected_time_secs;
        assert!((ratio - 2.0).abs() < 0.01,
            "2x hash rate should halve time, ratio was {}", ratio);
    }

    #[test]
    fn test_track_difficulty_half_target_speed() {
        // Transitions at half the target speed → mining twice as fast → increase difficulty
        let transitions = vec![100, 105, 110, 115, 120];
        let new_diff = track_difficulty(16, &transitions, 10); // target = 10 blocks apart, actual = 5
        assert!(new_diff > 16,
            "Mining at half the target interval should increase difficulty, got {}", new_diff);
    }

    #[test]
    fn test_track_difficulty_double_target_speed() {
        // Transitions at double the target speed → mining twice as slow → decrease difficulty
        let transitions = vec![100, 120, 140, 160, 180];
        let new_diff = track_difficulty(16, &transitions, 10); // target = 10 blocks apart, actual = 20
        assert!(new_diff < 16,
            "Mining at double the target interval should decrease difficulty, got {}", new_diff);
    }

    #[test]
    fn test_track_difficulty_symmetric_around_target() {
        // Half speed and double speed adjustments should move difficulty in opposite directions
        let fast_transitions = vec![100, 102, 104, 106, 108]; // 2-block intervals
        let slow_transitions = vec![100, 108, 116, 124, 132]; // 8-block intervals

        let fast_diff = track_difficulty(16, &fast_transitions, 4); // target 4, actual 2
        let slow_diff = track_difficulty(16, &slow_transitions, 4); // target 4, actual 8

        assert!(fast_diff > 16, "Fast should increase, got {}", fast_diff);
        assert!(slow_diff < 16, "Slow should decrease, got {}", slow_diff);
    }

    #[test]
    fn test_compute_auction_hash_mmr_root_change() {
        let mut auction1 = test_auction();
        auction1.commit_mmr_root = [0u8; 32];
        let mut auction2 = test_auction();
        auction2.commit_mmr_root = [0xAA; 32];

        let hash1 = compute_auction_hash(&auction1);
        let hash2 = compute_auction_hash(&auction2);
        assert_ne!(hash1, hash2,
            "Different commit_mmr_root must produce different hash");
    }

    #[test]
    fn test_compute_auction_hash_prev_state_hash_change() {
        let mut auction1 = test_auction();
        auction1.prev_state_hash = [0u8; 32];
        let mut auction2 = test_auction();
        auction2.prev_state_hash = [0xFF; 32];

        let hash1 = compute_auction_hash(&auction1);
        let hash2 = compute_auction_hash(&auction2);
        assert_ne!(hash1, hash2,
            "Different prev_state_hash must produce different hash");
    }

    #[test]
    fn test_aggregation_ten_commits_correct_count() {
        let auction = test_auction();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };
        let commits: Vec<PendingCommit> = (1..=10).map(|i| make_commit(i)).collect();

        let tx = build_aggregation_tx(
            &auction, &commits, None, &proof,
            &test_deployment(), &test_miner_lock(),
        );

        assert_eq!(tx.inputs.len(), 11, "1 auction + 10 commits = 11 inputs");
        let new_auction = AuctionCellData::deserialize(&tx.outputs[0].data).unwrap();
        assert_eq!(new_auction.commit_count, 10);
    }

    #[test]
    fn test_aggregation_auction_cell_input_is_first() {
        // The auction cell should always be the first input (index 0)
        let auction = test_auction();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };
        let commits: Vec<PendingCommit> = (1..=3).map(|i| make_commit(i)).collect();

        let tx = build_aggregation_tx(
            &auction, &commits, None, &proof,
            &test_deployment(), &test_miner_lock(),
        );

        // First input should be the auction cell (all zeros tx_hash, index 0)
        assert_eq!(tx.inputs[0].tx_hash, [0u8; 32],
            "First input must be the auction cell placeholder");
        assert_eq!(tx.inputs[0].index, 0);
    }

    #[test]
    fn test_mining_stats_field_ranges() {
        // Test MiningStats with boundary values
        let stats = MiningStats {
            total_hashes: u64::MAX,
            blocks_mined: u64::MAX,
            total_commits_aggregated: u64::MAX,
            total_reward_ckb: u64::MAX,
            avg_hash_rate: f64::MAX,
        };
        assert_eq!(stats.total_hashes, u64::MAX);
        assert_eq!(stats.blocks_mined, u64::MAX);
        assert_eq!(stats.total_commits_aggregated, u64::MAX);
        assert_eq!(stats.total_reward_ckb, u64::MAX);
        assert_eq!(stats.avg_hash_rate, f64::MAX);
    }

    #[test]
    fn test_miner_config_multiple_pair_ids() {
        // Config with many pair_ids
        let pair_ids: Vec<[u8; 32]> = (0..50).map(|i| [i as u8; 32]).collect();
        let config = MinerConfig {
            max_iterations: 1_000_000,
            ckb_rpc_url: "http://localhost:8114".to_string(),
            indexer_rpc_url: "http://localhost:8116".to_string(),
            miner_lock: test_miner_lock(),
            pair_ids: pair_ids.clone(),
            min_reward_ckb: 100,
        };
        assert_eq!(config.pair_ids.len(), 50);
        assert_eq!(config.pair_ids[0], [0u8; 32]);
        assert_eq!(config.pair_ids[49], [49u8; 32]);
    }

    #[test]
    fn test_pending_commit_different_block_numbers() {
        // Commits with different block numbers should have different commit_data
        let c1 = PendingCommit {
            commit_data: CommitCellData {
                order_hash: [0x01; 32],
                batch_id: 0,
                deposit_ckb: 100_000_000,
                token_type_hash: [0x02; 32],
                token_amount: vibeswap_math::PRECISION,
                block_number: 100,
                sender_lock_hash: [0x03; 32],
            },
            outpoint_tx_hash: [0x04; 32],
            outpoint_index: 0,
        };
        let c2 = PendingCommit {
            commit_data: CommitCellData {
                block_number: 200,
                ..c1.commit_data.clone()
            },
            outpoint_tx_hash: [0x04; 32],
            outpoint_index: 0,
        };
        assert_ne!(c1.commit_data.block_number, c2.commit_data.block_number);
    }

    #[test]
    fn test_profitability_energy_cost_calculation() {
        // Verify energy cost formula: expected_hashes / 1_000_000 * 0.1
        let estimate = estimate_profitability(20, 10, 1000, 1_000_000.0);
        let expected_cost = (estimate.expected_hashes as f64 / 1_000_000.0 * 0.1) as u64;
        assert_eq!(estimate.estimated_cost_ckb, expected_cost,
            "Energy cost should follow the formula: hashes / 1M * 0.1");
    }
}
