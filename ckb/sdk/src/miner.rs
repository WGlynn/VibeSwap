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
}
