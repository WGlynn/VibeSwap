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
}
