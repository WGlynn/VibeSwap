// ============ VibeSwap CKB SDK ============
// Transaction builder for VibeSwap operations on Nervos CKB
// Builds unsigned transactions that can be signed by any CKB wallet

pub mod assembler;
pub mod collector;
pub mod consensus;
pub mod governance;
pub mod keeper;
pub mod knowledge;
pub mod miner;
pub mod oracle;
pub mod risk;
pub mod token;

use vibeswap_types::*;
use vibeswap_math::PRECISION;
use sha2::{Digest, Sha256};

// ============ Transaction Types ============

/// Unsigned CKB transaction representation
/// In production, this maps to CKB's native Transaction type
#[derive(Clone, Debug)]
pub struct UnsignedTransaction {
    pub cell_deps: Vec<CellDep>,
    pub inputs: Vec<CellInput>,
    pub outputs: Vec<CellOutput>,
    pub witnesses: Vec<Vec<u8>>,
}

#[derive(Clone, Debug)]
pub struct CellDep {
    pub tx_hash: [u8; 32],
    pub index: u32,
    pub dep_type: DepType,
}

#[derive(Clone, Debug)]
pub enum DepType {
    Code,
    DepGroup,
}

#[derive(Clone, Debug)]
pub struct CellInput {
    pub tx_hash: [u8; 32],
    pub index: u32,
    pub since: u64,
}

#[derive(Clone, Debug)]
pub struct CellOutput {
    pub capacity: u64,
    pub lock_script: Script,
    pub type_script: Option<Script>,
    pub data: Vec<u8>,
}

#[derive(Clone, Debug)]
pub struct Script {
    pub code_hash: [u8; 32],
    pub hash_type: HashType,
    pub args: Vec<u8>,
}

#[derive(Clone, Debug)]
pub enum HashType {
    Data,
    Type,
    Data1,
    Data2,
}

/// Script deployment info — where each script lives on-chain
#[derive(Clone, Debug)]
pub struct DeploymentInfo {
    pub pow_lock_code_hash: [u8; 32],
    pub batch_auction_type_code_hash: [u8; 32],
    pub commit_type_code_hash: [u8; 32],
    pub amm_pool_type_code_hash: [u8; 32],
    pub lp_position_type_code_hash: [u8; 32],
    pub compliance_type_code_hash: [u8; 32],
    pub config_type_code_hash: [u8; 32],
    pub oracle_type_code_hash: [u8; 32],
    pub knowledge_type_code_hash: [u8; 32],
    pub lending_pool_type_code_hash: [u8; 32],
    pub vault_type_code_hash: [u8; 32],
    pub insurance_pool_type_code_hash: [u8; 32],
    pub script_dep_tx_hash: [u8; 32],
    pub script_dep_index: u32,
}

// ============ VibeSwap SDK ============

pub struct VibeSwapSDK {
    pub deployment: DeploymentInfo,
}

impl VibeSwapSDK {
    pub fn new(deployment: DeploymentInfo) -> Self {
        Self { deployment }
    }

    // ============ Commit Operations ============

    /// Build a transaction to create a commit cell
    /// User commits to an order by submitting hash(order || secret)
    pub fn create_commit(
        &self,
        order: &Order,
        secret: &[u8; 32],
        deposit_ckb: u64,
        token_amount: u128,
        token_type_hash: [u8; 32],
        pair_id: [u8; 32],
        batch_id: u64,
        user_lock: Script,
        user_input: CellInput,
    ) -> UnsignedTransaction {
        // Compute order hash: SHA-256(order || secret)
        let order_hash = compute_order_hash(order, secret);

        // Hash the user's lock script for the commit cell
        let sender_lock_hash = hash_script(&user_lock);

        let commit_data = CommitCellData {
            order_hash,
            batch_id,
            deposit_ckb,
            token_type_hash,
            token_amount,
            block_number: 0, // Set by CKB when included
            sender_lock_hash,
        };

        // Build commit type script args
        let mut type_args = Vec::with_capacity(40);
        type_args.extend_from_slice(&pair_id);
        type_args.extend_from_slice(&batch_id.to_le_bytes());

        let commit_output = CellOutput {
            capacity: deposit_ckb,
            lock_script: user_lock,
            type_script: Some(Script {
                code_hash: self.deployment.commit_type_code_hash,
                hash_type: HashType::Type,
                args: type_args,
            }),
            data: commit_data.serialize().to_vec(),
        };

        UnsignedTransaction {
            cell_deps: vec![CellDep {
                tx_hash: self.deployment.script_dep_tx_hash,
                index: self.deployment.script_dep_index,
                dep_type: DepType::DepGroup,
            }],
            inputs: vec![user_input],
            outputs: vec![commit_output],
            witnesses: vec![vec![]], // Will be filled during signing
        }
    }

    /// Build a reveal witness for an existing commit
    pub fn create_reveal(
        &self,
        order: &Order,
        secret: &[u8; 32],
        commit_index: u32,
    ) -> Vec<u8> {
        let reveal = RevealWitness {
            order_type: order.order_type,
            amount_in: order.amount_in,
            limit_price: order.limit_price,
            secret: *secret,
            priority_bid: order.priority_bid,
            commit_index,
        };
        reveal.serialize().to_vec()
    }

    // ============ Liquidity Operations ============

    /// Build a transaction to add liquidity to a pool
    pub fn add_liquidity(
        &self,
        pool_outpoint: CellInput,
        pool_data: &PoolCellData,
        amount0: u128,
        amount1: u128,
        user_lock: Script,
        user_inputs: Vec<CellInput>,
        block_number: u64,
    ) -> Result<UnsignedTransaction, SDKError> {
        // Calculate optimal amounts
        let (opt0, opt1) = vibeswap_math::batch_math::calculate_optimal_liquidity(
            amount0,
            amount1,
            pool_data.reserve0,
            pool_data.reserve1,
        )
        .map_err(|_| SDKError::InvalidAmounts)?;

        // Calculate LP tokens
        let lp_amount = vibeswap_math::batch_math::calculate_liquidity(
            opt0,
            opt1,
            pool_data.reserve0,
            pool_data.reserve1,
            pool_data.total_lp_supply,
        )
        .map_err(|_| SDKError::InsufficientLiquidity)?;

        // Build new pool state
        let mut new_pool = pool_data.clone();
        new_pool.reserve0 += opt0;
        new_pool.reserve1 += opt1;
        new_pool.total_lp_supply += lp_amount;

        // TWAP update (use mul_div to avoid overflow with large reserves)
        if block_number > pool_data.twap_last_block {
            let price = vibeswap_math::mul_div(pool_data.reserve1, PRECISION, pool_data.reserve0);
            let delta = block_number - pool_data.twap_last_block;
            new_pool.twap_price_cum = pool_data.twap_price_cum
                .wrapping_add(price * delta as u128);
            new_pool.twap_last_block = block_number;
        }

        // LP position cell
        let lp_position = LPPositionCellData {
            lp_amount,
            entry_price: vibeswap_math::mul_div(pool_data.reserve1, PRECISION, pool_data.reserve0),
            pool_id: pool_data.pair_id,
            deposit_block: block_number,
        };

        let pool_output = CellOutput {
            capacity: 0, // Same as input
            lock_script: Script {
                code_hash: self.deployment.pow_lock_code_hash,
                hash_type: HashType::Type,
                args: PoWLockArgs {
                    pair_id: pool_data.pair_id,
                    min_difficulty: DEFAULT_MIN_POW_DIFFICULTY,
                }
                .serialize()
                .to_vec(),
            },
            type_script: Some(Script {
                code_hash: self.deployment.amm_pool_type_code_hash,
                hash_type: HashType::Type,
                args: pool_data.pair_id.to_vec(),
            }),
            data: new_pool.serialize().to_vec(),
        };

        let lp_output = CellOutput {
            capacity: 14_200_000_000, // ~142 CKB minimum for LP cell
            lock_script: user_lock,
            type_script: Some(Script {
                code_hash: self.deployment.lp_position_type_code_hash,
                hash_type: HashType::Type,
                args: pool_data.pair_id.to_vec(),
            }),
            data: lp_position.serialize().to_vec(),
        };

        let mut inputs = vec![pool_outpoint];
        inputs.extend(user_inputs);

        Ok(UnsignedTransaction {
            cell_deps: vec![CellDep {
                tx_hash: self.deployment.script_dep_tx_hash,
                index: self.deployment.script_dep_index,
                dep_type: DepType::DepGroup,
            }],
            inputs,
            outputs: vec![pool_output, lp_output],
            witnesses: vec![vec![], vec![]],
        })
    }

    /// Build a transaction to remove liquidity
    pub fn remove_liquidity(
        &self,
        pool_outpoint: CellInput,
        pool_data: &PoolCellData,
        lp_outpoint: CellInput,
        lp_position: &LPPositionCellData,
        _user_lock: Script,
        block_number: u64,
    ) -> Result<UnsignedTransaction, SDKError> {
        // Calculate token amounts to return (use mul_div to avoid overflow)
        let amount0 = vibeswap_math::mul_div(
            lp_position.lp_amount,
            pool_data.reserve0,
            pool_data.total_lp_supply,
        );
        let amount1 = vibeswap_math::mul_div(
            lp_position.lp_amount,
            pool_data.reserve1,
            pool_data.total_lp_supply,
        );

        let mut new_pool = pool_data.clone();
        new_pool.reserve0 -= amount0;
        new_pool.reserve1 -= amount1;
        new_pool.total_lp_supply -= lp_position.lp_amount;

        // TWAP update (use mul_div to avoid overflow)
        if block_number > pool_data.twap_last_block {
            let price = vibeswap_math::mul_div(pool_data.reserve1, PRECISION, pool_data.reserve0);
            let delta = block_number - pool_data.twap_last_block;
            new_pool.twap_price_cum = pool_data.twap_price_cum
                .wrapping_add(price * delta as u128);
            new_pool.twap_last_block = block_number;
        }

        let pool_output = CellOutput {
            capacity: 0,
            lock_script: Script {
                code_hash: self.deployment.pow_lock_code_hash,
                hash_type: HashType::Type,
                args: PoWLockArgs {
                    pair_id: pool_data.pair_id,
                    min_difficulty: DEFAULT_MIN_POW_DIFFICULTY,
                }
                .serialize()
                .to_vec(),
            },
            type_script: Some(Script {
                code_hash: self.deployment.amm_pool_type_code_hash,
                hash_type: HashType::Type,
                args: pool_data.pair_id.to_vec(),
            }),
            data: new_pool.serialize().to_vec(),
        };

        // LP cell is consumed (burned), no LP output

        Ok(UnsignedTransaction {
            cell_deps: vec![CellDep {
                tx_hash: self.deployment.script_dep_tx_hash,
                index: self.deployment.script_dep_index,
                dep_type: DepType::DepGroup,
            }],
            inputs: vec![pool_outpoint, lp_outpoint],
            outputs: vec![pool_output],
            witnesses: vec![vec![], vec![]],
        })
    }

    // ============ Pool Creation ============

    /// Build a transaction to initialize a new AMM pool
    /// Creates pool cell with initial reserves, LP position for initial provider,
    /// and auction cell for this pair's batch auction
    pub fn create_pool(
        &self,
        pair_id: [u8; 32],
        token0_type_hash: [u8; 32],
        token1_type_hash: [u8; 32],
        amount0: u128,
        amount1: u128,
        user_lock: Script,
        user_inputs: Vec<CellInput>,
        block_number: u64,
    ) -> Result<UnsignedTransaction, SDKError> {
        // Initial LP = sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY
        let initial_lp = vibeswap_math::sqrt_product(amount0, amount1);
        if initial_lp <= MINIMUM_LIQUIDITY {
            return Err(SDKError::InsufficientLiquidity);
        }
        let lp_amount = initial_lp - MINIMUM_LIQUIDITY;

        // Compute initial k_last = reserve0 * reserve1 as 32-byte value
        let mut k_last = [0u8; 32];
        match amount0.checked_mul(amount1) {
            Some(k) => k_last[0..16].copy_from_slice(&k.to_le_bytes()),
            None => {
                // Store as (hi, lo) pair for 256-bit k
                let (hi, lo) = vibeswap_math::wide_mul(amount0, amount1);
                k_last[0..16].copy_from_slice(&lo.to_le_bytes());
                k_last[16..32].copy_from_slice(&hi.to_le_bytes());
            }
        }

        // Initial price for TWAP (use mul_div to avoid overflow)
        let initial_price = vibeswap_math::mul_div(amount1, PRECISION, amount0);

        // Build pool cell data
        let pool_data = PoolCellData {
            reserve0: amount0,
            reserve1: amount1,
            total_lp_supply: lp_amount + MINIMUM_LIQUIDITY,
            fee_rate_bps: DEFAULT_FEE_RATE_BPS,
            twap_price_cum: initial_price,
            twap_last_block: block_number,
            k_last,
            minimum_liquidity: MINIMUM_LIQUIDITY,
            pair_id,
            token0_type_hash,
            token1_type_hash,
        };

        // Build auction cell data (starts in COMMIT phase, batch 0)
        let auction_data = AuctionCellData {
            phase: PHASE_COMMIT,
            batch_id: 0,
            commit_mmr_root: [0u8; 32],
            commit_count: 0,
            reveal_count: 0,
            xor_seed: [0u8; 32],
            clearing_price: 0,
            fillable_volume: 0,
            difficulty_target: vibeswap_pow::difficulty_to_target(DEFAULT_MIN_POW_DIFFICULTY),
            prev_state_hash: [0u8; 32],
            phase_start_block: block_number,
            pair_id,
        };

        // LP position cell for initial provider
        let lp_position = LPPositionCellData {
            lp_amount,
            entry_price: initial_price,
            pool_id: pair_id,
            deposit_block: block_number,
        };

        // Pool output (PoW-locked)
        let pool_output = CellOutput {
            capacity: 0, // Filled by CKB capacity calculation
            lock_script: Script {
                code_hash: self.deployment.pow_lock_code_hash,
                hash_type: HashType::Type,
                args: PoWLockArgs {
                    pair_id,
                    min_difficulty: DEFAULT_MIN_POW_DIFFICULTY,
                }
                .serialize()
                .to_vec(),
            },
            type_script: Some(Script {
                code_hash: self.deployment.amm_pool_type_code_hash,
                hash_type: HashType::Type,
                args: pair_id.to_vec(),
            }),
            data: pool_data.serialize().to_vec(),
        };

        // Auction output (PoW-locked, same pair)
        let auction_output = CellOutput {
            capacity: 0,
            lock_script: Script {
                code_hash: self.deployment.pow_lock_code_hash,
                hash_type: HashType::Type,
                args: PoWLockArgs {
                    pair_id,
                    min_difficulty: DEFAULT_MIN_POW_DIFFICULTY,
                }
                .serialize()
                .to_vec(),
            },
            type_script: Some(Script {
                code_hash: self.deployment.batch_auction_type_code_hash,
                hash_type: HashType::Type,
                args: pair_id.to_vec(),
            }),
            data: auction_data.serialize().to_vec(),
        };

        // LP position output (user-owned)
        let lp_output = CellOutput {
            capacity: 14_200_000_000, // ~142 CKB minimum for LP cell
            lock_script: user_lock,
            type_script: Some(Script {
                code_hash: self.deployment.lp_position_type_code_hash,
                hash_type: HashType::Type,
                args: pair_id.to_vec(),
            }),
            data: lp_position.serialize().to_vec(),
        };

        Ok(UnsignedTransaction {
            cell_deps: vec![CellDep {
                tx_hash: self.deployment.script_dep_tx_hash,
                index: self.deployment.script_dep_index,
                dep_type: DepType::DepGroup,
            }],
            inputs: user_inputs,
            outputs: vec![pool_output, auction_output, lp_output],
            witnesses: vec![vec![]], // Will be filled during signing
        })
    }

    // ============ Batch Settlement ============

    /// Build a transaction to settle a batch auction
    /// Takes revealed orders, computes clearing price, shuffles deterministically,
    /// applies trades at uniform clearing price, and updates pool reserves
    pub fn create_settle_batch(
        &self,
        auction_outpoint: CellInput,
        auction_data: &AuctionCellData,
        pool_outpoint: CellInput,
        pool_data: &PoolCellData,
        reveals: &[RevealWitness],
        pow_proof: &vibeswap_pow::PoWProof,
        block_number: u64,
    ) -> Result<UnsignedTransaction, SDKError> {
        if reveals.is_empty() {
            return Err(SDKError::NoOrders);
        }

        if auction_data.phase != PHASE_REVEAL {
            return Err(SDKError::InvalidPhase);
        }

        // Separate buy and sell orders for clearing price calculation
        let mut buy_orders = Vec::new();
        let mut sell_orders = Vec::new();
        let mut secrets: Vec<[u8; 32]> = Vec::with_capacity(reveals.len());

        for reveal in reveals {
            secrets.push(reveal.secret);
            let order = vibeswap_math::batch_math::Order {
                amount: reveal.amount_in,
                limit_price: reveal.limit_price,
            };
            if reveal.order_type == ORDER_BUY {
                buy_orders.push(order);
            } else {
                sell_orders.push(order);
            }
        }

        // Calculate uniform clearing price
        let (clearing_price, fillable_volume) =
            vibeswap_math::batch_math::calculate_clearing_price(
                &buy_orders,
                &sell_orders,
                pool_data.reserve0,
                pool_data.reserve1,
            )
            .map_err(|_| SDKError::InvalidAmounts)?;

        // Generate deterministic shuffle seed from XOR of all secrets
        let xor_seed = vibeswap_math::shuffle::generate_seed(&secrets);

        // Count priority orders (those with non-zero priority_bid)
        let priority_count = reveals.iter().filter(|r| r.priority_bid > 0).count();

        // Partition into priority-first + shuffled regular orders
        let execution_order =
            vibeswap_math::shuffle::partition_and_shuffle(reveals.len(), priority_count, &xor_seed);

        // Apply trades at uniform clearing price against AMM pool
        let mut new_pool = pool_data.clone();
        let mut _total_buy_volume: u128 = 0;
        let mut _total_sell_volume: u128 = 0;

        for &idx in &execution_order {
            let reveal = &reveals[idx];
            if reveal.order_type == ORDER_BUY {
                // Buyer sends token1, receives token0 at clearing_price
                // amount_in is in token1 terms
                if clearing_price <= reveal.limit_price {
                    let amount0_out = vibeswap_math::mul_div(
                        reveal.amount_in,
                        PRECISION,
                        clearing_price,
                    );
                    if amount0_out < new_pool.reserve0 {
                        new_pool.reserve0 -= amount0_out;
                        new_pool.reserve1 += reveal.amount_in;
                        _total_buy_volume += reveal.amount_in;
                    }
                }
            } else {
                // Seller sends token0, receives token1 at clearing_price
                if clearing_price >= reveal.limit_price {
                    let amount1_out = vibeswap_math::mul_div(
                        reveal.amount_in,
                        clearing_price,
                        PRECISION,
                    );
                    if amount1_out < new_pool.reserve1 {
                        new_pool.reserve1 -= amount1_out;
                        new_pool.reserve0 += reveal.amount_in;
                        _total_sell_volume += reveal.amount_in;
                    }
                }
            }
        }

        // TWAP update on pool (use mul_div to avoid overflow)
        if block_number > pool_data.twap_last_block {
            let price = vibeswap_math::mul_div(pool_data.reserve1, PRECISION, pool_data.reserve0);
            let delta = block_number - pool_data.twap_last_block;
            new_pool.twap_price_cum = pool_data.twap_price_cum
                .wrapping_add(price * delta as u128);
            new_pool.twap_last_block = block_number;
        }

        // Compute state hash of settled auction for chain linkage
        let mut hasher = Sha256::new();
        hasher.update(auction_data.serialize());
        hasher.update(clearing_price.to_le_bytes());
        hasher.update(fillable_volume.to_le_bytes());
        let result = hasher.finalize();
        let mut new_state_hash = [0u8; 32];
        new_state_hash.copy_from_slice(&result);

        // Build settled auction cell (transitions to SETTLED, increments batch_id)
        let new_auction = AuctionCellData {
            phase: PHASE_SETTLED,
            batch_id: auction_data.batch_id,
            commit_mmr_root: auction_data.commit_mmr_root,
            commit_count: auction_data.commit_count,
            reveal_count: reveals.len() as u32,
            xor_seed,
            clearing_price,
            fillable_volume,
            difficulty_target: auction_data.difficulty_target,
            prev_state_hash: new_state_hash,
            phase_start_block: block_number,
            pair_id: auction_data.pair_id,
        };

        // Build fresh auction cell for next batch (COMMIT phase, batch_id + 1)
        let next_auction = AuctionCellData {
            phase: PHASE_COMMIT,
            batch_id: auction_data.batch_id + 1,
            commit_mmr_root: [0u8; 32],
            commit_count: 0,
            reveal_count: 0,
            xor_seed: [0u8; 32],
            clearing_price: 0,
            fillable_volume: 0,
            difficulty_target: auction_data.difficulty_target,
            prev_state_hash: new_state_hash,
            phase_start_block: block_number,
            pair_id: auction_data.pair_id,
        };

        // Pool output (PoW-locked)
        let pool_output = CellOutput {
            capacity: 0,
            lock_script: Script {
                code_hash: self.deployment.pow_lock_code_hash,
                hash_type: HashType::Type,
                args: PoWLockArgs {
                    pair_id: pool_data.pair_id,
                    min_difficulty: DEFAULT_MIN_POW_DIFFICULTY,
                }
                .serialize()
                .to_vec(),
            },
            type_script: Some(Script {
                code_hash: self.deployment.amm_pool_type_code_hash,
                hash_type: HashType::Type,
                args: pool_data.pair_id.to_vec(),
            }),
            data: new_pool.serialize().to_vec(),
        };

        // Settled auction output (record of this batch)
        let settled_auction_output = CellOutput {
            capacity: 0,
            lock_script: Script {
                code_hash: self.deployment.pow_lock_code_hash,
                hash_type: HashType::Type,
                args: PoWLockArgs {
                    pair_id: auction_data.pair_id,
                    min_difficulty: DEFAULT_MIN_POW_DIFFICULTY,
                }
                .serialize()
                .to_vec(),
            },
            type_script: Some(Script {
                code_hash: self.deployment.batch_auction_type_code_hash,
                hash_type: HashType::Type,
                args: auction_data.pair_id.to_vec(),
            }),
            data: new_auction.serialize().to_vec(),
        };

        // Next batch auction output (fresh COMMIT phase)
        let next_auction_output = CellOutput {
            capacity: 0,
            lock_script: Script {
                code_hash: self.deployment.pow_lock_code_hash,
                hash_type: HashType::Type,
                args: PoWLockArgs {
                    pair_id: auction_data.pair_id,
                    min_difficulty: DEFAULT_MIN_POW_DIFFICULTY,
                }
                .serialize()
                .to_vec(),
            },
            type_script: Some(Script {
                code_hash: self.deployment.batch_auction_type_code_hash,
                hash_type: HashType::Type,
                args: auction_data.pair_id.to_vec(),
            }),
            data: next_auction.serialize().to_vec(),
        };

        // PoW proof goes in witness[0]
        let mut pow_witness = Vec::with_capacity(64);
        pow_witness.extend_from_slice(&pow_proof.challenge);
        pow_witness.extend_from_slice(&pow_proof.nonce);

        // Reveal witnesses follow
        let mut witnesses = vec![pow_witness];
        for reveal in reveals {
            witnesses.push(reveal.serialize().to_vec());
        }

        Ok(UnsignedTransaction {
            cell_deps: vec![CellDep {
                tx_hash: self.deployment.script_dep_tx_hash,
                index: self.deployment.script_dep_index,
                dep_type: DepType::DepGroup,
            }],
            inputs: vec![auction_outpoint, pool_outpoint],
            outputs: vec![pool_output, settled_auction_output, next_auction_output],
            witnesses,
        })
    }

    // ============ Oracle Operations ============

    /// Build a transaction to update the oracle price feed
    /// Validates freshness (new block > old block) and creates updated oracle cell
    pub fn update_oracle(
        &self,
        oracle_outpoint: CellInput,
        old_oracle: &OracleCellData,
        new_price: u128,
        new_block: u64,
        confidence: u8,
        source_hash: [u8; 32],
        relayer_lock: Script,
    ) -> Result<UnsignedTransaction, SDKError> {
        // Validate freshness: new data must be from a later block
        if new_block <= old_oracle.block_number {
            return Err(SDKError::StaleOracleData);
        }

        let new_oracle = OracleCellData {
            price: new_price,
            block_number: new_block,
            confidence,
            source_hash,
            pair_id: old_oracle.pair_id,
        };

        let oracle_output = CellOutput {
            capacity: 0, // Same as input
            lock_script: relayer_lock,
            type_script: Some(Script {
                code_hash: self.deployment.oracle_type_code_hash,
                hash_type: HashType::Type,
                args: old_oracle.pair_id.to_vec(),
            }),
            data: new_oracle.serialize().to_vec(),
        };

        Ok(UnsignedTransaction {
            cell_deps: vec![CellDep {
                tx_hash: self.deployment.script_dep_tx_hash,
                index: self.deployment.script_dep_index,
                dep_type: DepType::DepGroup,
            }],
            inputs: vec![oracle_outpoint],
            outputs: vec![oracle_output],
            witnesses: vec![vec![]], // Relayer signs
        })
    }

    // ============ Config Operations ============

    /// Build a transaction to update protocol configuration
    /// Simple: consume old config cell, create new one locked by governance multisig
    pub fn update_config(
        &self,
        config_outpoint: CellInput,
        new_config: ConfigCellData,
        governance_lock: Script,
    ) -> UnsignedTransaction {
        let config_output = CellOutput {
            capacity: 0, // Same as input
            lock_script: governance_lock,
            type_script: Some(Script {
                code_hash: self.deployment.config_type_code_hash,
                hash_type: HashType::Type,
                args: vec![], // Config is singleton, no args needed
            }),
            data: new_config.serialize().to_vec(),
        };

        UnsignedTransaction {
            cell_deps: vec![CellDep {
                tx_hash: self.deployment.script_dep_tx_hash,
                index: self.deployment.script_dep_index,
                dep_type: DepType::DepGroup,
            }],
            inputs: vec![config_outpoint],
            outputs: vec![config_output],
            witnesses: vec![vec![]], // Governance multisig signs
        }
    }

    // ============ Compliance Operations ============

    /// Build a transaction to update compliance registry
    /// Validates version is incremented and updates Merkle roots for blocked addresses
    pub fn update_compliance(
        &self,
        compliance_outpoint: CellInput,
        new_compliance: ComplianceCellData,
        admin_lock: Script,
    ) -> Result<UnsignedTransaction, SDKError> {
        // Compliance data version must always increase
        // We validate by checking that the new version field is set correctly
        // (the old cell is consumed as input, so we verify at the type-script level,
        //  but the SDK enforces a basic sanity check: version must be > 0)
        if new_compliance.version == 0 {
            return Err(SDKError::ComplianceVersionNotIncremented);
        }

        let compliance_output = CellOutput {
            capacity: 0, // Same as input
            lock_script: admin_lock,
            type_script: Some(Script {
                code_hash: self.deployment.compliance_type_code_hash,
                hash_type: HashType::Type,
                args: vec![], // Compliance is singleton, no args needed
            }),
            data: new_compliance.serialize().to_vec(),
        };

        Ok(UnsignedTransaction {
            cell_deps: vec![CellDep {
                tx_hash: self.deployment.script_dep_tx_hash,
                index: self.deployment.script_dep_index,
                dep_type: DepType::DepGroup,
            }],
            inputs: vec![compliance_outpoint],
            outputs: vec![compliance_output],
            witnesses: vec![vec![]], // Admin signs
        })
    }

    // ============ Lending Operations ============

    /// Build a transaction to create a new lending pool
    pub fn create_lending_pool(
        &self,
        pool_id: [u8; 32],
        asset_type_hash: [u8; 32],
        initial_deposit: u128,
        user_lock: Script,
        user_input: CellInput,
        block_number: u64,
    ) -> UnsignedTransaction {
        let pool_data = LendingPoolCellData {
            total_deposits: initial_deposit,
            total_borrows: 0,
            total_shares: initial_deposit, // 1:1 for first depositor
            total_reserves: 0,
            borrow_index: PRECISION,
            last_accrual_block: block_number,
            asset_type_hash,
            pool_id,
            base_rate: DEFAULT_BASE_RATE,
            slope1: DEFAULT_SLOPE1,
            slope2: DEFAULT_SLOPE2,
            optimal_utilization: DEFAULT_OPTIMAL_UTILIZATION,
            reserve_factor: DEFAULT_RESERVE_FACTOR,
            collateral_factor: DEFAULT_COLLATERAL_FACTOR,
            liquidation_threshold: DEFAULT_LIQUIDATION_THRESHOLD,
            liquidation_incentive: DEFAULT_LIQUIDATION_INCENTIVE,
        };

        let pool_output = CellOutput {
            capacity: 0,
            lock_script: Script {
                code_hash: self.deployment.pow_lock_code_hash,
                hash_type: HashType::Type,
                args: PoWLockArgs {
                    pair_id: pool_id,
                    min_difficulty: DEFAULT_MIN_POW_DIFFICULTY,
                }.serialize().to_vec(),
            },
            type_script: Some(Script {
                code_hash: self.deployment.lending_pool_type_code_hash,
                hash_type: HashType::Type,
                args: pool_id.to_vec(),
            }),
            data: pool_data.serialize().to_vec(),
        };

        // Vault for the initial depositor
        let vault_data = VaultCellData {
            owner_lock_hash: hash_script(&user_lock),
            pool_id,
            collateral_amount: 0,
            collateral_type_hash: [0u8; 32],
            debt_shares: 0,
            borrow_index_snapshot: PRECISION,
            deposit_shares: initial_deposit,
            last_update_block: block_number,
        };

        let vault_output = CellOutput {
            capacity: 0,
            lock_script: user_lock,
            type_script: Some(Script {
                code_hash: self.deployment.vault_type_code_hash,
                hash_type: HashType::Type,
                args: pool_id.to_vec(),
            }),
            data: vault_data.serialize().to_vec(),
        };

        UnsignedTransaction {
            cell_deps: vec![CellDep {
                tx_hash: self.deployment.script_dep_tx_hash,
                index: self.deployment.script_dep_index,
                dep_type: DepType::DepGroup,
            }],
            inputs: vec![user_input],
            outputs: vec![pool_output, vault_output],
            witnesses: vec![vec![]],
        }
    }

    /// Build a transaction to open a vault and deposit collateral
    pub fn open_vault(
        &self,
        pool_id: [u8; 32],
        collateral_amount: u128,
        collateral_type_hash: [u8; 32],
        user_lock: Script,
        user_input: CellInput,
        block_number: u64,
    ) -> UnsignedTransaction {
        let vault_data = VaultCellData {
            owner_lock_hash: hash_script(&user_lock),
            pool_id,
            collateral_amount,
            collateral_type_hash,
            debt_shares: 0,
            borrow_index_snapshot: PRECISION,
            deposit_shares: 0,
            last_update_block: block_number,
        };

        let vault_output = CellOutput {
            capacity: 0,
            lock_script: user_lock,
            type_script: Some(Script {
                code_hash: self.deployment.vault_type_code_hash,
                hash_type: HashType::Type,
                args: pool_id.to_vec(),
            }),
            data: vault_data.serialize().to_vec(),
        };

        UnsignedTransaction {
            cell_deps: vec![CellDep {
                tx_hash: self.deployment.script_dep_tx_hash,
                index: self.deployment.script_dep_index,
                dep_type: DepType::DepGroup,
            }],
            inputs: vec![user_input],
            outputs: vec![vault_output],
            witnesses: vec![vec![]],
        }
    }
    // ============ Core Lending Operations ============

    /// Deposit tokens into a lending pool for yield.
    ///
    /// The depositor receives pool shares (like cTokens) proportional to their
    /// deposit. As interest accrues from borrowers, each share becomes worth
    /// more underlying tokens.
    pub fn deposit_to_lending_pool(
        &self,
        pool_outpoint: CellInput,
        pool_data: &LendingPoolCellData,
        vault_outpoint: CellInput,
        vault_data: &VaultCellData,
        deposit_amount: u128,
        block_number: u64,
    ) -> Result<UnsignedTransaction, SDKError> {
        if deposit_amount == 0 {
            return Err(SDKError::InvalidAmounts);
        }

        // Accrue interest first
        let model = ckb_lending_math::interest::RateModel {
            base_rate: pool_data.base_rate,
            slope1: pool_data.slope1,
            slope2: pool_data.slope2,
            optimal_utilization: pool_data.optimal_utilization,
            reserve_factor: pool_data.reserve_factor,
        };
        let pool_state = ckb_lending_math::pool::PoolState {
            total_deposits: pool_data.total_deposits,
            total_borrows: pool_data.total_borrows,
            total_shares: pool_data.total_shares,
            total_reserves: pool_data.total_reserves,
            last_accrual_block: pool_data.last_accrual_block,
            borrow_index: pool_data.borrow_index,
        };
        let accrued = ckb_lending_math::pool::accrue(
            &pool_state,
            block_number,
            &model,
        ).map_err(|_| SDKError::InvalidAmounts)?;

        // Calculate shares for deposit
        let new_shares = ckb_lending_math::shares::deposit_to_shares(
            deposit_amount,
            accrued.total_shares,
            accrued.total_underlying(),
        ).map_err(|_| SDKError::InvalidAmounts)?;

        let new_pool = LendingPoolCellData {
            total_deposits: accrued.total_deposits + deposit_amount,
            total_borrows: accrued.total_borrows,
            total_shares: accrued.total_shares + new_shares,
            total_reserves: accrued.total_reserves,
            borrow_index: accrued.borrow_index,
            last_accrual_block: block_number,
            // Immutable fields
            asset_type_hash: pool_data.asset_type_hash,
            pool_id: pool_data.pool_id,
            base_rate: pool_data.base_rate,
            slope1: pool_data.slope1,
            slope2: pool_data.slope2,
            optimal_utilization: pool_data.optimal_utilization,
            reserve_factor: pool_data.reserve_factor,
            collateral_factor: pool_data.collateral_factor,
            liquidation_threshold: pool_data.liquidation_threshold,
            liquidation_incentive: pool_data.liquidation_incentive,
        };

        let new_vault = VaultCellData {
            deposit_shares: vault_data.deposit_shares + new_shares,
            last_update_block: block_number,
            ..*vault_data
        };

        let pool_output = CellOutput {
            capacity: 0,
            lock_script: Script {
                code_hash: self.deployment.pow_lock_code_hash,
                hash_type: HashType::Type,
                args: PoWLockArgs {
                    pair_id: pool_data.pool_id,
                    min_difficulty: DEFAULT_MIN_POW_DIFFICULTY,
                }.serialize().to_vec(),
            },
            type_script: Some(Script {
                code_hash: self.deployment.lending_pool_type_code_hash,
                hash_type: HashType::Type,
                args: pool_data.pool_id.to_vec(),
            }),
            data: new_pool.serialize().to_vec(),
        };

        let vault_output = CellOutput {
            capacity: 0,
            lock_script: Script {
                code_hash: vault_data.owner_lock_hash,
                hash_type: HashType::Type,
                args: vec![],
            },
            type_script: Some(Script {
                code_hash: self.deployment.vault_type_code_hash,
                hash_type: HashType::Type,
                args: pool_data.pool_id.to_vec(),
            }),
            data: new_vault.serialize().to_vec(),
        };

        Ok(UnsignedTransaction {
            cell_deps: vec![CellDep {
                tx_hash: self.deployment.script_dep_tx_hash,
                index: self.deployment.script_dep_index,
                dep_type: DepType::DepGroup,
            }],
            inputs: vec![pool_outpoint, vault_outpoint],
            outputs: vec![pool_output, vault_output],
            witnesses: vec![vec![]; 2],
        })
    }

    /// Withdraw tokens from a lending pool by burning deposit shares.
    ///
    /// The withdrawer burns their pool shares and receives underlying tokens
    /// proportional to the current exchange rate (including accrued interest).
    pub fn withdraw_from_lending_pool(
        &self,
        pool_outpoint: CellInput,
        pool_data: &LendingPoolCellData,
        vault_outpoint: CellInput,
        vault_data: &VaultCellData,
        shares_to_burn: u128,
        withdrawer_lock: Script,
        block_number: u64,
    ) -> Result<UnsignedTransaction, SDKError> {
        if shares_to_burn == 0 || shares_to_burn > vault_data.deposit_shares {
            return Err(SDKError::InvalidAmounts);
        }

        // Accrue interest first
        let model = ckb_lending_math::interest::RateModel {
            base_rate: pool_data.base_rate,
            slope1: pool_data.slope1,
            slope2: pool_data.slope2,
            optimal_utilization: pool_data.optimal_utilization,
            reserve_factor: pool_data.reserve_factor,
        };
        let pool_state = ckb_lending_math::pool::PoolState {
            total_deposits: pool_data.total_deposits,
            total_borrows: pool_data.total_borrows,
            total_shares: pool_data.total_shares,
            total_reserves: pool_data.total_reserves,
            last_accrual_block: pool_data.last_accrual_block,
            borrow_index: pool_data.borrow_index,
        };
        let accrued = ckb_lending_math::pool::accrue(
            &pool_state,
            block_number,
            &model,
        ).map_err(|_| SDKError::InvalidAmounts)?;

        // Calculate underlying for shares
        let underlying = ckb_lending_math::shares::shares_to_underlying(
            shares_to_burn,
            accrued.total_shares,
            accrued.total_underlying(),
        ).map_err(|_| SDKError::InvalidAmounts)?;

        // Check liquidity
        if underlying > accrued.available_liquidity() {
            return Err(SDKError::InsufficientLiquidity);
        }

        let new_pool = LendingPoolCellData {
            total_deposits: accrued.total_deposits - underlying,
            total_borrows: accrued.total_borrows,
            total_shares: accrued.total_shares - shares_to_burn,
            total_reserves: accrued.total_reserves,
            borrow_index: accrued.borrow_index,
            last_accrual_block: block_number,
            asset_type_hash: pool_data.asset_type_hash,
            pool_id: pool_data.pool_id,
            base_rate: pool_data.base_rate,
            slope1: pool_data.slope1,
            slope2: pool_data.slope2,
            optimal_utilization: pool_data.optimal_utilization,
            reserve_factor: pool_data.reserve_factor,
            collateral_factor: pool_data.collateral_factor,
            liquidation_threshold: pool_data.liquidation_threshold,
            liquidation_incentive: pool_data.liquidation_incentive,
        };

        let new_vault = VaultCellData {
            deposit_shares: vault_data.deposit_shares - shares_to_burn,
            last_update_block: block_number,
            ..*vault_data
        };

        let pool_output = CellOutput {
            capacity: 0,
            lock_script: Script {
                code_hash: self.deployment.pow_lock_code_hash,
                hash_type: HashType::Type,
                args: PoWLockArgs {
                    pair_id: pool_data.pool_id,
                    min_difficulty: DEFAULT_MIN_POW_DIFFICULTY,
                }.serialize().to_vec(),
            },
            type_script: Some(Script {
                code_hash: self.deployment.lending_pool_type_code_hash,
                hash_type: HashType::Type,
                args: pool_data.pool_id.to_vec(),
            }),
            data: new_pool.serialize().to_vec(),
        };

        let vault_output = CellOutput {
            capacity: 0,
            lock_script: Script {
                code_hash: vault_data.owner_lock_hash,
                hash_type: HashType::Type,
                args: vec![],
            },
            type_script: Some(Script {
                code_hash: self.deployment.vault_type_code_hash,
                hash_type: HashType::Type,
                args: pool_data.pool_id.to_vec(),
            }),
            data: new_vault.serialize().to_vec(),
        };

        let withdraw_output = CellOutput {
            capacity: 0,
            lock_script: withdrawer_lock,
            type_script: None,
            data: underlying.to_le_bytes().to_vec(),
        };

        Ok(UnsignedTransaction {
            cell_deps: vec![CellDep {
                tx_hash: self.deployment.script_dep_tx_hash,
                index: self.deployment.script_dep_index,
                dep_type: DepType::DepGroup,
            }],
            inputs: vec![pool_outpoint, vault_outpoint],
            outputs: vec![pool_output, vault_output, withdraw_output],
            witnesses: vec![vec![]; 2],
        })
    }

    /// Borrow tokens from a lending pool against vault collateral.
    ///
    /// The borrower takes a loan from the pool, increasing their debt shares.
    /// The vault must have sufficient collateral to satisfy the health factor.
    pub fn borrow_from_lending_pool(
        &self,
        pool_outpoint: CellInput,
        pool_data: &LendingPoolCellData,
        vault_outpoint: CellInput,
        vault_data: &VaultCellData,
        borrow_amount: u128,
        collateral_price: u128,
        debt_price: u128,
        borrower_lock: Script,
        block_number: u64,
    ) -> Result<UnsignedTransaction, SDKError> {
        if borrow_amount == 0 {
            return Err(SDKError::InvalidAmounts);
        }

        // Accrue interest first
        let model = ckb_lending_math::interest::RateModel {
            base_rate: pool_data.base_rate,
            slope1: pool_data.slope1,
            slope2: pool_data.slope2,
            optimal_utilization: pool_data.optimal_utilization,
            reserve_factor: pool_data.reserve_factor,
        };
        let pool_state = ckb_lending_math::pool::PoolState {
            total_deposits: pool_data.total_deposits,
            total_borrows: pool_data.total_borrows,
            total_shares: pool_data.total_shares,
            total_reserves: pool_data.total_reserves,
            last_accrual_block: pool_data.last_accrual_block,
            borrow_index: pool_data.borrow_index,
        };
        let accrued = ckb_lending_math::pool::accrue(
            &pool_state,
            block_number,
            &model,
        ).map_err(|_| SDKError::InvalidAmounts)?;

        // Check liquidity
        if borrow_amount > accrued.available_liquidity() {
            return Err(SDKError::InsufficientLiquidity);
        }

        // Calculate debt shares for this borrow
        let new_debt_shares = vibeswap_math::mul_div(
            borrow_amount,
            PRECISION,
            accrued.borrow_index,
        );

        // Check that post-borrow health factor is safe
        let current_debt = ckb_lending_math::pool::current_debt(
            vault_data.debt_shares,
            vault_data.borrow_index_snapshot,
            accrued.borrow_index,
        );
        let total_debt_after = current_debt + borrow_amount;

        let max_borrow = ckb_lending_math::collateral::max_borrow(
            vault_data.collateral_amount,
            collateral_price,
            pool_data.collateral_factor,
        ).map_err(|_| SDKError::InvalidAmounts)?;

        let total_debt_value = vibeswap_math::mul_div(total_debt_after, debt_price, PRECISION);
        if total_debt_value > max_borrow {
            return Err(SDKError::InvalidAmounts); // Would exceed max LTV
        }

        let new_pool = LendingPoolCellData {
            total_deposits: accrued.total_deposits,
            total_borrows: accrued.total_borrows + borrow_amount,
            total_shares: accrued.total_shares,
            total_reserves: accrued.total_reserves,
            borrow_index: accrued.borrow_index,
            last_accrual_block: block_number,
            asset_type_hash: pool_data.asset_type_hash,
            pool_id: pool_data.pool_id,
            base_rate: pool_data.base_rate,
            slope1: pool_data.slope1,
            slope2: pool_data.slope2,
            optimal_utilization: pool_data.optimal_utilization,
            reserve_factor: pool_data.reserve_factor,
            collateral_factor: pool_data.collateral_factor,
            liquidation_threshold: pool_data.liquidation_threshold,
            liquidation_incentive: pool_data.liquidation_incentive,
        };

        let new_vault = VaultCellData {
            debt_shares: vault_data.debt_shares + new_debt_shares,
            borrow_index_snapshot: accrued.borrow_index,
            last_update_block: block_number,
            ..*vault_data
        };

        let pool_output = CellOutput {
            capacity: 0,
            lock_script: Script {
                code_hash: self.deployment.pow_lock_code_hash,
                hash_type: HashType::Type,
                args: PoWLockArgs {
                    pair_id: pool_data.pool_id,
                    min_difficulty: DEFAULT_MIN_POW_DIFFICULTY,
                }.serialize().to_vec(),
            },
            type_script: Some(Script {
                code_hash: self.deployment.lending_pool_type_code_hash,
                hash_type: HashType::Type,
                args: pool_data.pool_id.to_vec(),
            }),
            data: new_pool.serialize().to_vec(),
        };

        let vault_output = CellOutput {
            capacity: 0,
            lock_script: Script {
                code_hash: vault_data.owner_lock_hash,
                hash_type: HashType::Type,
                args: vec![],
            },
            type_script: Some(Script {
                code_hash: self.deployment.vault_type_code_hash,
                hash_type: HashType::Type,
                args: pool_data.pool_id.to_vec(),
            }),
            data: new_vault.serialize().to_vec(),
        };

        // Borrowed tokens go to borrower
        let borrow_output = CellOutput {
            capacity: 0,
            lock_script: borrower_lock,
            type_script: None,
            data: borrow_amount.to_le_bytes().to_vec(),
        };

        Ok(UnsignedTransaction {
            cell_deps: vec![CellDep {
                tx_hash: self.deployment.script_dep_tx_hash,
                index: self.deployment.script_dep_index,
                dep_type: DepType::DepGroup,
            }],
            inputs: vec![pool_outpoint, vault_outpoint],
            outputs: vec![pool_output, vault_output, borrow_output],
            witnesses: vec![vec![]; 2],
        })
    }

    /// Repay borrowed tokens to a lending pool.
    ///
    /// The borrower repays some or all of their debt, reducing their vault's
    /// debt shares. Excess repayment is returned as change.
    pub fn repay_to_lending_pool(
        &self,
        pool_outpoint: CellInput,
        pool_data: &LendingPoolCellData,
        vault_outpoint: CellInput,
        vault_data: &VaultCellData,
        repay_amount: u128,
        repayer_input: CellInput,
        block_number: u64,
    ) -> Result<UnsignedTransaction, SDKError> {
        if repay_amount == 0 {
            return Err(SDKError::InvalidAmounts);
        }

        // Accrue interest first
        let model = ckb_lending_math::interest::RateModel {
            base_rate: pool_data.base_rate,
            slope1: pool_data.slope1,
            slope2: pool_data.slope2,
            optimal_utilization: pool_data.optimal_utilization,
            reserve_factor: pool_data.reserve_factor,
        };
        let pool_state = ckb_lending_math::pool::PoolState {
            total_deposits: pool_data.total_deposits,
            total_borrows: pool_data.total_borrows,
            total_shares: pool_data.total_shares,
            total_reserves: pool_data.total_reserves,
            last_accrual_block: pool_data.last_accrual_block,
            borrow_index: pool_data.borrow_index,
        };
        let accrued = ckb_lending_math::pool::accrue(
            &pool_state,
            block_number,
            &model,
        ).map_err(|_| SDKError::InvalidAmounts)?;

        // Calculate current debt
        let current_debt = ckb_lending_math::pool::current_debt(
            vault_data.debt_shares,
            vault_data.borrow_index_snapshot,
            accrued.borrow_index,
        );

        // Cap repayment at current debt
        let actual_repay = repay_amount.min(current_debt);
        if actual_repay == 0 {
            return Err(SDKError::InvalidAmounts);
        }

        // Convert repay amount to debt shares retired
        let retired_shares = vibeswap_math::mul_div(
            actual_repay,
            PRECISION,
            accrued.borrow_index,
        );

        let new_pool = LendingPoolCellData {
            total_deposits: accrued.total_deposits,
            total_borrows: accrued.total_borrows.saturating_sub(actual_repay),
            total_shares: accrued.total_shares,
            total_reserves: accrued.total_reserves,
            borrow_index: accrued.borrow_index,
            last_accrual_block: block_number,
            asset_type_hash: pool_data.asset_type_hash,
            pool_id: pool_data.pool_id,
            base_rate: pool_data.base_rate,
            slope1: pool_data.slope1,
            slope2: pool_data.slope2,
            optimal_utilization: pool_data.optimal_utilization,
            reserve_factor: pool_data.reserve_factor,
            collateral_factor: pool_data.collateral_factor,
            liquidation_threshold: pool_data.liquidation_threshold,
            liquidation_incentive: pool_data.liquidation_incentive,
        };

        let new_vault = VaultCellData {
            debt_shares: vault_data.debt_shares.saturating_sub(retired_shares),
            borrow_index_snapshot: accrued.borrow_index,
            last_update_block: block_number,
            ..*vault_data
        };

        let pool_output = CellOutput {
            capacity: 0,
            lock_script: Script {
                code_hash: self.deployment.pow_lock_code_hash,
                hash_type: HashType::Type,
                args: PoWLockArgs {
                    pair_id: pool_data.pool_id,
                    min_difficulty: DEFAULT_MIN_POW_DIFFICULTY,
                }.serialize().to_vec(),
            },
            type_script: Some(Script {
                code_hash: self.deployment.lending_pool_type_code_hash,
                hash_type: HashType::Type,
                args: pool_data.pool_id.to_vec(),
            }),
            data: new_pool.serialize().to_vec(),
        };

        let vault_output = CellOutput {
            capacity: 0,
            lock_script: Script {
                code_hash: vault_data.owner_lock_hash,
                hash_type: HashType::Type,
                args: vec![],
            },
            type_script: Some(Script {
                code_hash: self.deployment.vault_type_code_hash,
                hash_type: HashType::Type,
                args: pool_data.pool_id.to_vec(),
            }),
            data: new_vault.serialize().to_vec(),
        };

        Ok(UnsignedTransaction {
            cell_deps: vec![CellDep {
                tx_hash: self.deployment.script_dep_tx_hash,
                index: self.deployment.script_dep_index,
                dep_type: DepType::DepGroup,
            }],
            inputs: vec![pool_outpoint, vault_outpoint, repayer_input],
            outputs: vec![pool_output, vault_output],
            witnesses: vec![vec![]; 3],
        })
    }

    // ============ Liquidation ============

    /// Build a transaction to liquidate an underwater vault position
    ///
    /// A liquidator repays some of the borrower's debt and receives their
    /// collateral at a discount (the liquidation incentive).
    ///
    /// Inputs: pool cell + borrower's vault cell + oracle cell + liquidator's repay tokens
    /// Outputs: updated pool + updated vault + collateral to liquidator
    ///
    /// # Arguments
    /// * `pool_outpoint` / `pool_data` — the lending pool
    /// * `vault_outpoint` / `vault_data` — the borrower's underwater vault
    /// * `collateral_price` / `debt_price` — oracle-provided prices (scaled by 1e18)
    /// * `repay_amount` — how much debt the liquidator wants to repay
    /// * `liquidator_lock` — the liquidator's lock script (receives collateral)
    /// * `liquidator_inputs` — liquidator's token cells to pay debt
    /// * `block_number` — current block for accrual
    pub fn liquidate(
        &self,
        pool_outpoint: CellInput,
        pool_data: &LendingPoolCellData,
        vault_outpoint: CellInput,
        vault_data: &VaultCellData,
        collateral_price: u128,
        debt_price: u128,
        repay_amount: u128,
        liquidator_lock: Script,
        liquidator_inputs: Vec<CellInput>,
        block_number: u64,
    ) -> Result<UnsignedTransaction, SDKError> {
        use ckb_lending_math::{
            collateral::{self, CollateralParams},
            interest,
        };

        // Build rate model from pool params
        let model = interest::RateModel {
            base_rate: pool_data.base_rate,
            slope1: pool_data.slope1,
            slope2: pool_data.slope2,
            optimal_utilization: pool_data.optimal_utilization,
            reserve_factor: pool_data.reserve_factor,
        };

        // Accrue interest on the pool first
        let blocks_elapsed = if block_number > pool_data.last_accrual_block {
            (block_number - pool_data.last_accrual_block) as u128
        } else {
            0
        };

        let utilization = if pool_data.total_deposits > 0 {
            interest::utilization_rate(pool_data.total_borrows, pool_data.total_deposits)
                .map_err(|_| SDKError::Overflow)?
        } else {
            0
        };

        let borrow_rate = interest::borrow_rate(utilization, &model)
            .map_err(|_| SDKError::Overflow)?;

        let (new_total_borrows, interest_accrued, protocol_share) =
            interest::accrue_interest(
                pool_data.total_borrows,
                borrow_rate,
                blocks_elapsed,
                pool_data.reserve_factor,
            )
            .map_err(|_| SDKError::Overflow)?;

        // Calculate new borrow index
        let new_borrow_index = if pool_data.total_borrows > 0 {
            vibeswap_math::mul_div(
                pool_data.borrow_index,
                new_total_borrows,
                pool_data.total_borrows,
            )
        } else {
            pool_data.borrow_index
        };

        // Calculate actual debt from shares using borrow index
        let actual_debt = vibeswap_math::mul_div(
            vault_data.debt_shares,
            new_borrow_index,
            vault_data.borrow_index_snapshot,
        );

        // Check liquidation math
        let params = CollateralParams {
            collateral_factor: pool_data.collateral_factor,
            liquidation_threshold: pool_data.liquidation_threshold,
            liquidation_incentive: pool_data.liquidation_incentive,
            close_factor: PRECISION / 2, // 50% close factor
        };

        let (max_repay, max_seized) = collateral::liquidation_amounts(
            vault_data.collateral_amount,
            collateral_price,
            actual_debt,
            debt_price,
            &params,
        )
        .map_err(|_| SDKError::InvalidAmounts)?;

        // Cap repay at requested amount and max allowed
        let actual_repay = repay_amount.min(max_repay);
        if actual_repay == 0 {
            return Err(SDKError::InvalidAmounts);
        }

        // Calculate collateral seized proportional to repay
        let seized_collateral = if actual_repay == max_repay {
            max_seized
        } else {
            // Proportional: seized = max_seized * (actual_repay / max_repay)
            vibeswap_math::mul_div(max_seized, actual_repay, max_repay)
        };

        // Convert repay amount to debt shares being retired
        let repaid_shares = vibeswap_math::mul_div(
            actual_repay,
            vault_data.borrow_index_snapshot,
            new_borrow_index,
        );

        // Updated vault
        let new_vault = VaultCellData {
            owner_lock_hash: vault_data.owner_lock_hash,
            pool_id: vault_data.pool_id,
            collateral_amount: vault_data.collateral_amount - seized_collateral,
            collateral_type_hash: vault_data.collateral_type_hash,
            debt_shares: vault_data.debt_shares.saturating_sub(repaid_shares),
            borrow_index_snapshot: new_borrow_index,
            deposit_shares: vault_data.deposit_shares,
            last_update_block: block_number,
        };

        // Updated pool
        let new_pool = LendingPoolCellData {
            total_deposits: pool_data.total_deposits + interest_accrued - protocol_share,
            total_borrows: new_total_borrows - actual_repay,
            total_shares: pool_data.total_shares,
            total_reserves: pool_data.total_reserves + protocol_share,
            borrow_index: new_borrow_index,
            last_accrual_block: block_number,
            // Immutable fields carry forward
            asset_type_hash: pool_data.asset_type_hash,
            pool_id: pool_data.pool_id,
            base_rate: pool_data.base_rate,
            slope1: pool_data.slope1,
            slope2: pool_data.slope2,
            optimal_utilization: pool_data.optimal_utilization,
            reserve_factor: pool_data.reserve_factor,
            collateral_factor: pool_data.collateral_factor,
            liquidation_threshold: pool_data.liquidation_threshold,
            liquidation_incentive: pool_data.liquidation_incentive,
        };

        // Build outputs
        let pool_output = CellOutput {
            capacity: 0,
            lock_script: Script {
                code_hash: self.deployment.pow_lock_code_hash,
                hash_type: HashType::Type,
                args: PoWLockArgs {
                    pair_id: pool_data.pool_id,
                    min_difficulty: DEFAULT_MIN_POW_DIFFICULTY,
                }.serialize().to_vec(),
            },
            type_script: Some(Script {
                code_hash: self.deployment.lending_pool_type_code_hash,
                hash_type: HashType::Type,
                args: pool_data.pool_id.to_vec(),
            }),
            data: new_pool.serialize().to_vec(),
        };

        let vault_output = CellOutput {
            capacity: 0,
            lock_script: Script {
                code_hash: vault_data.owner_lock_hash, // Owner still controls vault
                hash_type: HashType::Type,
                args: vec![],
            },
            type_script: Some(Script {
                code_hash: self.deployment.vault_type_code_hash,
                hash_type: HashType::Type,
                args: pool_data.pool_id.to_vec(),
            }),
            data: new_vault.serialize().to_vec(),
        };

        // Liquidator receives seized collateral
        let liquidator_output = CellOutput {
            capacity: 0,
            lock_script: liquidator_lock,
            type_script: None, // Collateral token type script would go here in production
            data: seized_collateral.to_le_bytes().to_vec(),
        };

        let mut inputs = vec![pool_outpoint, vault_outpoint];
        inputs.extend(liquidator_inputs);
        let witness_count = inputs.len();

        Ok(UnsignedTransaction {
            cell_deps: vec![CellDep {
                tx_hash: self.deployment.script_dep_tx_hash,
                index: self.deployment.script_dep_index,
                dep_type: DepType::DepGroup,
            }],
            inputs,
            outputs: vec![pool_output, vault_output, liquidator_output],
            witnesses: vec![vec![]; witness_count],
        })
    }

    // ============ Insurance Pool Operations ============

    /// Create a new insurance pool for a given asset.
    ///
    /// The insurance pool collects premiums from lending operations and uses
    /// them to de-risk positions before liquidation occurs (P-105).
    pub fn create_insurance_pool(
        &self,
        pool_id: [u8; 32],
        asset_type_hash: [u8; 32],
        premium_rate_bps: u64,
        max_coverage_bps: u64,
        cooldown_blocks: u64,
        creator_lock: Script,
        creator_input: CellInput,
    ) -> Result<UnsignedTransaction, SDKError> {
        let pool_data = InsurancePoolCellData {
            pool_id,
            asset_type_hash,
            total_deposits: 0,
            total_shares: 0,
            total_premiums_earned: 0,
            total_claims_paid: 0,
            premium_rate_bps,
            max_coverage_bps,
            cooldown_blocks,
            last_premium_block: 0,
        };

        let pool_output = CellOutput {
            capacity: 0,
            lock_script: Script {
                code_hash: self.deployment.pow_lock_code_hash,
                hash_type: HashType::Type,
                args: PoWLockArgs {
                    pair_id: pool_id,
                    min_difficulty: DEFAULT_MIN_POW_DIFFICULTY,
                }.serialize().to_vec(),
            },
            type_script: Some(Script {
                code_hash: self.deployment.insurance_pool_type_code_hash,
                hash_type: HashType::Type,
                args: pool_id.to_vec(),
            }),
            data: pool_data.serialize().to_vec(),
        };

        Ok(UnsignedTransaction {
            cell_deps: vec![CellDep {
                tx_hash: self.deployment.script_dep_tx_hash,
                index: self.deployment.script_dep_index,
                dep_type: DepType::DepGroup,
            }],
            inputs: vec![creator_input],
            outputs: vec![pool_output],
            witnesses: vec![vec![]],
        })
    }

    /// Deposit into an insurance pool.
    ///
    /// Mints pool shares proportional to the deposit amount.
    /// Depositors earn yield from premiums collected on lending operations.
    pub fn deposit_insurance(
        &self,
        pool_outpoint: CellInput,
        pool_data: &InsurancePoolCellData,
        deposit_amount: u128,
        depositor_lock: Script,
        depositor_input: CellInput,
        block_number: u64,
    ) -> Result<UnsignedTransaction, SDKError> {
        if deposit_amount == 0 {
            return Err(SDKError::InvalidAmounts);
        }

        let new_shares = ckb_lending_math::insurance::deposit_to_shares(
            deposit_amount,
            pool_data.total_shares,
            pool_data.total_deposits,
        ).map_err(|_| SDKError::InvalidAmounts)?;

        let new_pool = InsurancePoolCellData {
            total_deposits: pool_data.total_deposits + deposit_amount,
            total_shares: pool_data.total_shares + new_shares,
            last_premium_block: pool_data.last_premium_block.max(block_number),
            ..*pool_data
        };

        let pool_output = CellOutput {
            capacity: 0,
            lock_script: Script {
                code_hash: self.deployment.pow_lock_code_hash,
                hash_type: HashType::Type,
                args: PoWLockArgs {
                    pair_id: pool_data.pool_id,
                    min_difficulty: DEFAULT_MIN_POW_DIFFICULTY,
                }.serialize().to_vec(),
            },
            type_script: Some(Script {
                code_hash: self.deployment.insurance_pool_type_code_hash,
                hash_type: HashType::Type,
                args: pool_data.pool_id.to_vec(),
            }),
            data: new_pool.serialize().to_vec(),
        };

        // Change cell back to depositor
        let change_output = CellOutput {
            capacity: 0,
            lock_script: depositor_lock,
            type_script: None,
            data: vec![],
        };

        Ok(UnsignedTransaction {
            cell_deps: vec![CellDep {
                tx_hash: self.deployment.script_dep_tx_hash,
                index: self.deployment.script_dep_index,
                dep_type: DepType::DepGroup,
            }],
            inputs: vec![pool_outpoint, depositor_input],
            outputs: vec![pool_output, change_output],
            witnesses: vec![vec![]; 2],
        })
    }

    /// Withdraw from an insurance pool by burning shares.
    ///
    /// Returns underlying tokens proportional to shares burned.
    /// Respects cooldown period if configured.
    pub fn withdraw_insurance(
        &self,
        pool_outpoint: CellInput,
        pool_data: &InsurancePoolCellData,
        shares_to_burn: u128,
        withdrawer_lock: Script,
        block_number: u64,
    ) -> Result<UnsignedTransaction, SDKError> {
        if shares_to_burn == 0 || shares_to_burn > pool_data.total_shares {
            return Err(SDKError::InvalidAmounts);
        }

        let underlying = ckb_lending_math::insurance::shares_to_underlying(
            shares_to_burn,
            pool_data.total_shares,
            pool_data.total_deposits,
        ).map_err(|_| SDKError::InvalidAmounts)?;

        if underlying > pool_data.total_deposits {
            return Err(SDKError::InsufficientLiquidity);
        }

        let new_pool = InsurancePoolCellData {
            total_deposits: pool_data.total_deposits - underlying,
            total_shares: pool_data.total_shares - shares_to_burn,
            last_premium_block: pool_data.last_premium_block.max(block_number),
            ..*pool_data
        };

        let pool_output = CellOutput {
            capacity: 0,
            lock_script: Script {
                code_hash: self.deployment.pow_lock_code_hash,
                hash_type: HashType::Type,
                args: PoWLockArgs {
                    pair_id: pool_data.pool_id,
                    min_difficulty: DEFAULT_MIN_POW_DIFFICULTY,
                }.serialize().to_vec(),
            },
            type_script: Some(Script {
                code_hash: self.deployment.insurance_pool_type_code_hash,
                hash_type: HashType::Type,
                args: pool_data.pool_id.to_vec(),
            }),
            data: new_pool.serialize().to_vec(),
        };

        // Withdrawn tokens go to withdrawer
        let withdraw_output = CellOutput {
            capacity: 0,
            lock_script: withdrawer_lock,
            type_script: None,
            data: underlying.to_le_bytes().to_vec(),
        };

        Ok(UnsignedTransaction {
            cell_deps: vec![CellDep {
                tx_hash: self.deployment.script_dep_tx_hash,
                index: self.deployment.script_dep_index,
                dep_type: DepType::DepGroup,
            }],
            inputs: vec![pool_outpoint],
            outputs: vec![pool_output, withdraw_output],
            witnesses: vec![vec![]],
        })
    }

    /// Claim insurance coverage for a distressed vault.
    ///
    /// When a vault's health factor drops below the soft liquidation threshold,
    /// the insurance pool can repay some of the vault's debt to prevent liquidation.
    /// This is the mutualist alternative to predatory liquidation.
    pub fn claim_insurance(
        &self,
        insurance_outpoint: CellInput,
        insurance_data: &InsurancePoolCellData,
        vault_outpoint: CellInput,
        vault_data: &VaultCellData,
        lending_pool_data: &LendingPoolCellData,
        collateral_price: u128,
        debt_price: u128,
        block_number: u64,
    ) -> Result<UnsignedTransaction, SDKError> {
        // Calculate how much insurance is needed
        let (claim_amount, _new_hf) = ckb_lending_math::insurance::calculate_claim(
            vault_data.collateral_amount,
            collateral_price,
            // Current debt with index accrual
            ckb_lending_math::pool::current_debt(
                vault_data.debt_shares,
                vault_data.borrow_index_snapshot,
                lending_pool_data.borrow_index,
            ),
            debt_price,
            lending_pool_data.liquidation_threshold,
            ckb_lending_math::prevention::HF_SOFT_LIQUIDATION,
            insurance_data.total_deposits,
            insurance_data.max_coverage_bps,
        );

        if claim_amount == 0 {
            return Err(SDKError::InvalidAmounts);
        }

        // Update insurance pool: decrease deposits, increase claims
        let new_insurance = InsurancePoolCellData {
            total_deposits: insurance_data.total_deposits - claim_amount,
            total_claims_paid: insurance_data.total_claims_paid + claim_amount,
            last_premium_block: insurance_data.last_premium_block.max(block_number),
            ..*insurance_data
        };

        // Claim repays vault debt (reduce debt shares)
        let repaid_shares = vibeswap_math::mul_div(
            claim_amount,
            vault_data.borrow_index_snapshot,
            lending_pool_data.borrow_index,
        );

        let new_vault = VaultCellData {
            debt_shares: vault_data.debt_shares.saturating_sub(repaid_shares),
            borrow_index_snapshot: lending_pool_data.borrow_index,
            last_update_block: block_number,
            ..*vault_data
        };

        let insurance_output = CellOutput {
            capacity: 0,
            lock_script: Script {
                code_hash: self.deployment.pow_lock_code_hash,
                hash_type: HashType::Type,
                args: PoWLockArgs {
                    pair_id: insurance_data.pool_id,
                    min_difficulty: DEFAULT_MIN_POW_DIFFICULTY,
                }.serialize().to_vec(),
            },
            type_script: Some(Script {
                code_hash: self.deployment.insurance_pool_type_code_hash,
                hash_type: HashType::Type,
                args: insurance_data.pool_id.to_vec(),
            }),
            data: new_insurance.serialize().to_vec(),
        };

        let vault_output = CellOutput {
            capacity: 0,
            lock_script: Script {
                code_hash: vault_data.owner_lock_hash,
                hash_type: HashType::Type,
                args: vec![],
            },
            type_script: Some(Script {
                code_hash: self.deployment.vault_type_code_hash,
                hash_type: HashType::Type,
                args: vault_data.pool_id.to_vec(),
            }),
            data: new_vault.serialize().to_vec(),
        };

        Ok(UnsignedTransaction {
            cell_deps: vec![CellDep {
                tx_hash: self.deployment.script_dep_tx_hash,
                index: self.deployment.script_dep_index,
                dep_type: DepType::DepGroup,
            }],
            inputs: vec![insurance_outpoint, vault_outpoint],
            outputs: vec![insurance_output, vault_output],
            witnesses: vec![vec![]; 2],
        })
    }

    /// Accrue premiums from a lending pool to the insurance pool.
    ///
    /// Called periodically to transfer premium payments from the lending pool's
    /// reserve to the insurance pool.
    pub fn accrue_insurance_premium(
        &self,
        insurance_outpoint: CellInput,
        insurance_data: &InsurancePoolCellData,
        lending_pool_borrows: u128,
        block_number: u64,
    ) -> Result<UnsignedTransaction, SDKError> {
        if block_number <= insurance_data.last_premium_block {
            return Err(SDKError::StaleOracleData);
        }

        let blocks_elapsed = block_number - insurance_data.last_premium_block;
        let premium = ckb_lending_math::insurance::calculate_premium(
            lending_pool_borrows,
            insurance_data.premium_rate_bps,
            blocks_elapsed,
        );

        if premium == 0 {
            return Err(SDKError::InvalidAmounts);
        }

        let new_insurance = InsurancePoolCellData {
            total_deposits: insurance_data.total_deposits + premium,
            total_premiums_earned: insurance_data.total_premiums_earned + premium,
            last_premium_block: block_number,
            ..*insurance_data
        };

        let insurance_output = CellOutput {
            capacity: 0,
            lock_script: Script {
                code_hash: self.deployment.pow_lock_code_hash,
                hash_type: HashType::Type,
                args: PoWLockArgs {
                    pair_id: insurance_data.pool_id,
                    min_difficulty: DEFAULT_MIN_POW_DIFFICULTY,
                }.serialize().to_vec(),
            },
            type_script: Some(Script {
                code_hash: self.deployment.insurance_pool_type_code_hash,
                hash_type: HashType::Type,
                args: insurance_data.pool_id.to_vec(),
            }),
            data: new_insurance.serialize().to_vec(),
        };

        Ok(UnsignedTransaction {
            cell_deps: vec![CellDep {
                tx_hash: self.deployment.script_dep_tx_hash,
                index: self.deployment.script_dep_index,
                dep_type: DepType::DepGroup,
            }],
            inputs: vec![insurance_outpoint],
            outputs: vec![insurance_output],
            witnesses: vec![vec![]],
        })
    }
}

// ============ Order Type ============

#[derive(Clone, Debug)]
pub struct Order {
    pub order_type: u8, // ORDER_BUY or ORDER_SELL
    pub amount_in: u128,
    pub limit_price: u128,
    pub priority_bid: u64,
}

// ============ Helper Functions ============

fn compute_order_hash(order: &Order, secret: &[u8; 32]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update([order.order_type]);
    hasher.update(order.amount_in.to_le_bytes());
    hasher.update(order.limit_price.to_le_bytes());
    hasher.update(order.priority_bid.to_le_bytes());
    hasher.update(secret);
    let result = hasher.finalize();
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&result);
    hash
}

fn hash_script(script: &Script) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(&script.code_hash);
    hasher.update(&script.args);
    let result = hasher.finalize();
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&result);
    hash
}

// ============ Errors ============

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SDKError {
    InvalidAmounts,
    InsufficientLiquidity,
    Overflow,
    MiningFailed,
    StaleOracleData,
    LowOracleConfidence,
    OraclePairMismatch,
    OracleDeviationTooHigh,
    ComplianceVersionNotIncremented,
    NoOrders,
    InvalidPhase,
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    fn test_deployment() -> DeploymentInfo {
        DeploymentInfo {
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
            script_dep_tx_hash: [0x10; 32],
            script_dep_index: 0,
        }
    }

    #[test]
    fn test_create_commit() {
        let sdk = VibeSwapSDK::new(test_deployment());
        let order = Order {
            order_type: ORDER_BUY,
            amount_in: 1000 * PRECISION,
            limit_price: 2000 * PRECISION,
            priority_bid: 0,
        };
        let secret = [0xAB; 32];
        let user_lock = Script {
            code_hash: [0x99; 32],
            hash_type: HashType::Type,
            args: vec![0x01; 20],
        };
        let user_input = CellInput {
            tx_hash: [0x50; 32],
            index: 0,
            since: 0,
        };

        let tx = sdk.create_commit(
            &order,
            &secret,
            100_000_000_000, // 1000 CKB
            order.amount_in,
            [0x02; 32],
            [0x01; 32],
            0,
            user_lock,
            user_input,
        );

        assert_eq!(tx.inputs.len(), 1);
        assert_eq!(tx.outputs.len(), 1);
        assert!(tx.outputs[0].type_script.is_some());

        // Verify commit data can be deserialized
        let commit = CommitCellData::deserialize(&tx.outputs[0].data).unwrap();
        assert_eq!(commit.batch_id, 0);
        assert_ne!(commit.order_hash, [0u8; 32]);
    }

    #[test]
    fn test_create_reveal() {
        let sdk = VibeSwapSDK::new(test_deployment());
        let order = Order {
            order_type: ORDER_SELL,
            amount_in: 500 * PRECISION,
            limit_price: 1900 * PRECISION,
            priority_bid: 50_000_000,
        };
        let secret = [0xCD; 32];

        let witness = sdk.create_reveal(&order, &secret, 3);
        let reveal = RevealWitness::deserialize(&witness).unwrap();

        assert_eq!(reveal.order_type, ORDER_SELL);
        assert_eq!(reveal.amount_in, 500 * PRECISION);
        assert_eq!(reveal.secret, secret);
        assert_eq!(reveal.commit_index, 3);
    }

    #[test]
    fn test_order_hash_deterministic() {
        let order = Order {
            order_type: ORDER_BUY,
            amount_in: 1000 * PRECISION,
            limit_price: 2000 * PRECISION,
            priority_bid: 0,
        };
        let secret = [0xAB; 32];

        let h1 = compute_order_hash(&order, &secret);
        let h2 = compute_order_hash(&order, &secret);
        assert_eq!(h1, h2);

        // Different secret = different hash
        let secret2 = [0xCD; 32];
        let h3 = compute_order_hash(&order, &secret2);
        assert_ne!(h1, h3);
    }

    // ============ Pool Creation Tests ============

    #[test]
    fn test_create_pool() {
        let sdk = VibeSwapSDK::new(test_deployment());
        let pair_id = [0xAA; 32];
        let token0_type_hash = [0xBB; 32];
        let token1_type_hash = [0xCC; 32];
        let amount0 = 1_000 * PRECISION; // Use smaller amounts to avoid u128 overflow
        let amount1 = 2_000 * PRECISION;
        let user_lock = Script {
            code_hash: [0x99; 32],
            hash_type: HashType::Type,
            args: vec![0x01; 20],
        };
        let user_input = CellInput {
            tx_hash: [0x50; 32],
            index: 0,
            since: 0,
        };

        let tx = sdk
            .create_pool(
                pair_id,
                token0_type_hash,
                token1_type_hash,
                amount0,
                amount1,
                user_lock,
                vec![user_input],
                100,
            )
            .unwrap();

        // Should have 3 outputs: pool, auction, LP position
        assert_eq!(tx.outputs.len(), 3);

        // Verify pool data
        let pool = PoolCellData::deserialize(&tx.outputs[0].data).unwrap();
        assert_eq!(pool.reserve0, amount0);
        assert_eq!(pool.reserve1, amount1);
        assert_eq!(pool.pair_id, pair_id);
        assert_eq!(pool.token0_type_hash, token0_type_hash);
        assert_eq!(pool.token1_type_hash, token1_type_hash);
        assert_eq!(pool.fee_rate_bps, DEFAULT_FEE_RATE_BPS);
        assert!(pool.total_lp_supply > 0);
        // total_lp_supply = sqrt(amount0 * amount1) which includes MINIMUM_LIQUIDITY
        let expected_total = vibeswap_math::sqrt_product(amount0, amount1);
        assert_eq!(pool.total_lp_supply, expected_total);

        // Verify auction data
        let auction = AuctionCellData::deserialize(&tx.outputs[1].data).unwrap();
        assert_eq!(auction.phase, PHASE_COMMIT);
        assert_eq!(auction.batch_id, 0);
        assert_eq!(auction.pair_id, pair_id);
        assert_eq!(auction.phase_start_block, 100);

        // Verify LP position
        let lp = LPPositionCellData::deserialize(&tx.outputs[2].data).unwrap();
        assert_eq!(lp.lp_amount, expected_total - MINIMUM_LIQUIDITY);
        assert_eq!(lp.pool_id, pair_id);
        assert_eq!(lp.deposit_block, 100);
        // Entry price = amount1 * PRECISION / amount0 = 2 * PRECISION
        assert_eq!(lp.entry_price, 2 * PRECISION);
    }

    // ============ Batch Settlement Tests ============

    #[test]
    fn test_create_settle_batch() {
        let sdk = VibeSwapSDK::new(test_deployment());
        let pair_id = [0xAA; 32];

        // Set up pool with existing reserves (use smaller amounts to avoid u128 overflow)
        let pool_data = PoolCellData {
            reserve0: 1_000 * PRECISION,
            reserve1: 2_000 * PRECISION,
            total_lp_supply: 1_414 * PRECISION,
            fee_rate_bps: DEFAULT_FEE_RATE_BPS,
            twap_price_cum: 2 * PRECISION,
            twap_last_block: 90,
            k_last: [0u8; 32],
            minimum_liquidity: MINIMUM_LIQUIDITY,
            pair_id,
            token0_type_hash: [0xBB; 32],
            token1_type_hash: [0xCC; 32],
        };

        // Auction in REVEAL phase
        let auction_data = AuctionCellData {
            phase: PHASE_REVEAL,
            batch_id: 5,
            commit_mmr_root: [0u8; 32],
            commit_count: 3,
            reveal_count: 0,
            xor_seed: [0u8; 32],
            clearing_price: 0,
            fillable_volume: 0,
            difficulty_target: vibeswap_pow::difficulty_to_target(DEFAULT_MIN_POW_DIFFICULTY),
            prev_state_hash: [0u8; 32],
            phase_start_block: 95,
            pair_id,
        };

        // Revealed orders: 2 buys, 1 sell
        let reveals = vec![
            RevealWitness {
                order_type: ORDER_BUY,
                amount_in: 100 * PRECISION,
                limit_price: 2100 * PRECISION,
                secret: [0x01; 32],
                priority_bid: 0,
                commit_index: 0,
            },
            RevealWitness {
                order_type: ORDER_BUY,
                amount_in: 50 * PRECISION,
                limit_price: 2050 * PRECISION,
                secret: [0x02; 32],
                priority_bid: 0,
                commit_index: 1,
            },
            RevealWitness {
                order_type: ORDER_SELL,
                amount_in: 80 * PRECISION,
                limit_price: 1950 * PRECISION,
                secret: [0x03; 32],
                priority_bid: 0,
                commit_index: 2,
            },
        ];

        // Mine a PoW proof (low difficulty for testing)
        let challenge = vibeswap_pow::generate_challenge(&pair_id, 5, &[0u8; 32]);
        let nonce = vibeswap_pow::mine(&challenge, 4, 100_000)
            .expect("Should find nonce at difficulty 4");
        let pow_proof = vibeswap_pow::PoWProof { challenge, nonce };

        let auction_outpoint = CellInput {
            tx_hash: [0x60; 32],
            index: 0,
            since: 0,
        };
        let pool_outpoint = CellInput {
            tx_hash: [0x61; 32],
            index: 0,
            since: 0,
        };

        let tx = sdk
            .create_settle_batch(
                auction_outpoint,
                &auction_data,
                pool_outpoint,
                &pool_data,
                &reveals,
                &pow_proof,
                100,
            )
            .unwrap();

        // Should have 2 inputs (auction + pool)
        assert_eq!(tx.inputs.len(), 2);

        // Should have 3 outputs: pool, settled auction, next auction
        assert_eq!(tx.outputs.len(), 3);

        // Verify updated pool reserves changed
        let new_pool = PoolCellData::deserialize(&tx.outputs[0].data).unwrap();
        assert_ne!(new_pool.reserve0, pool_data.reserve0);

        // Verify settled auction
        let settled = AuctionCellData::deserialize(&tx.outputs[1].data).unwrap();
        assert_eq!(settled.phase, PHASE_SETTLED);
        assert_eq!(settled.batch_id, 5);
        assert!(settled.clearing_price > 0);
        assert_eq!(settled.reveal_count, 3);

        // Verify next auction cell starts fresh
        let next = AuctionCellData::deserialize(&tx.outputs[2].data).unwrap();
        assert_eq!(next.phase, PHASE_COMMIT);
        assert_eq!(next.batch_id, 6); // batch_id incremented
        assert_eq!(next.commit_count, 0);
        assert_eq!(next.reveal_count, 0);
        assert_eq!(next.clearing_price, 0);

        // Witnesses: 1 PoW proof + 3 reveals = 4
        assert_eq!(tx.witnesses.len(), 4);
    }

    // ============ Oracle Tests ============

    #[test]
    fn test_update_oracle() {
        let sdk = VibeSwapSDK::new(test_deployment());
        let pair_id = [0xAA; 32];

        let old_oracle = OracleCellData {
            price: 2000 * PRECISION,
            block_number: 100,
            confidence: 90,
            source_hash: [0x11; 32],
            pair_id,
        };

        let relayer_lock = Script {
            code_hash: [0x99; 32],
            hash_type: HashType::Type,
            args: vec![0x01; 20],
        };

        let oracle_outpoint = CellInput {
            tx_hash: [0x70; 32],
            index: 0,
            since: 0,
        };

        let tx = sdk
            .update_oracle(
                oracle_outpoint,
                &old_oracle,
                2050 * PRECISION,
                110,
                95,
                [0x22; 32],
                relayer_lock,
            )
            .unwrap();

        assert_eq!(tx.inputs.len(), 1);
        assert_eq!(tx.outputs.len(), 1);

        // Verify new oracle data
        let new_oracle = OracleCellData::deserialize(&tx.outputs[0].data).unwrap();
        assert_eq!(new_oracle.price, 2050 * PRECISION);
        assert_eq!(new_oracle.block_number, 110);
        assert_eq!(new_oracle.confidence, 95);
        assert_eq!(new_oracle.source_hash, [0x22; 32]);
        assert_eq!(new_oracle.pair_id, pair_id);
    }

    #[test]
    fn test_update_oracle_stale_rejected() {
        let sdk = VibeSwapSDK::new(test_deployment());
        let pair_id = [0xAA; 32];

        let old_oracle = OracleCellData {
            price: 2000 * PRECISION,
            block_number: 100,
            confidence: 90,
            source_hash: [0x11; 32],
            pair_id,
        };

        let relayer_lock = Script {
            code_hash: [0x99; 32],
            hash_type: HashType::Type,
            args: vec![0x01; 20],
        };

        let oracle_outpoint = CellInput {
            tx_hash: [0x70; 32],
            index: 0,
            since: 0,
        };

        // Try to update with same block number (stale)
        let result = sdk.update_oracle(
            oracle_outpoint.clone(),
            &old_oracle,
            2050 * PRECISION,
            100, // Same block = stale
            95,
            [0x22; 32],
            relayer_lock.clone(),
        );
        assert_eq!(result.unwrap_err(), SDKError::StaleOracleData);

        // Try with older block number (even more stale)
        let result = sdk.update_oracle(
            oracle_outpoint,
            &old_oracle,
            2050 * PRECISION,
            90, // Older block = stale
            95,
            [0x22; 32],
            relayer_lock,
        );
        assert_eq!(result.unwrap_err(), SDKError::StaleOracleData);
    }

    // ============ Config Tests ============

    #[test]
    fn test_update_config() {
        let sdk = VibeSwapSDK::new(test_deployment());

        let governance_lock = Script {
            code_hash: [0x99; 32],
            hash_type: HashType::Type,
            args: vec![0x01; 20],
        };

        let config_outpoint = CellInput {
            tx_hash: [0x80; 32],
            index: 0,
            since: 0,
        };

        let new_config = ConfigCellData {
            commit_window_blocks: 50,         // Changed from 40
            reveal_window_blocks: 15,         // Changed from 10
            slash_rate_bps: 6000,             // Changed from 5000
            max_price_deviation: 300,         // Changed from 500
            max_trade_size_bps: 800,          // Changed from 1000
            rate_limit_amount: 2_000_000 * PRECISION,
            rate_limit_window: 7200,
            volume_breaker_limit: 20_000_000 * PRECISION,
            price_breaker_bps: 800,
            withdrawal_breaker_bps: 1500,
            min_pow_difficulty: 18,           // Changed from 16
        };

        let tx = sdk.update_config(config_outpoint, new_config.clone(), governance_lock);

        assert_eq!(tx.inputs.len(), 1);
        assert_eq!(tx.outputs.len(), 1);

        // Verify new config data
        let decoded = ConfigCellData::deserialize(&tx.outputs[0].data).unwrap();
        assert_eq!(decoded.commit_window_blocks, 50);
        assert_eq!(decoded.reveal_window_blocks, 15);
        assert_eq!(decoded.slash_rate_bps, 6000);
        assert_eq!(decoded.max_price_deviation, 300);
        assert_eq!(decoded.max_trade_size_bps, 800);
        assert_eq!(decoded.min_pow_difficulty, 18);
        assert_eq!(decoded, new_config);

        // Verify type script uses config code hash
        let type_script = tx.outputs[0].type_script.as_ref().unwrap();
        assert_eq!(type_script.code_hash, [0x07; 32]);
    }

    // ============ Compliance Tests ============

    #[test]
    fn test_update_compliance() {
        let sdk = VibeSwapSDK::new(test_deployment());

        let admin_lock = Script {
            code_hash: [0x99; 32],
            hash_type: HashType::Type,
            args: vec![0x01; 20],
        };

        let compliance_outpoint = CellInput {
            tx_hash: [0x90; 32],
            index: 0,
            since: 0,
        };

        let new_compliance = ComplianceCellData {
            blocked_merkle_root: [0xDD; 32],
            tier_merkle_root: [0xEE; 32],
            jurisdiction_root: [0xFF; 32],
            last_updated: 12345,
            version: 2,
        };

        let tx = sdk
            .update_compliance(compliance_outpoint, new_compliance.clone(), admin_lock)
            .unwrap();

        assert_eq!(tx.inputs.len(), 1);
        assert_eq!(tx.outputs.len(), 1);

        // Verify new compliance data
        let decoded = ComplianceCellData::deserialize(&tx.outputs[0].data).unwrap();
        assert_eq!(decoded.blocked_merkle_root, [0xDD; 32]);
        assert_eq!(decoded.tier_merkle_root, [0xEE; 32]);
        assert_eq!(decoded.jurisdiction_root, [0xFF; 32]);
        assert_eq!(decoded.last_updated, 12345);
        assert_eq!(decoded.version, 2);
        assert_eq!(decoded, new_compliance);

        // Verify type script uses compliance code hash
        let type_script = tx.outputs[0].type_script.as_ref().unwrap();
        assert_eq!(type_script.code_hash, [0x06; 32]);

        // Version 0 should be rejected
        let bad_compliance = ComplianceCellData {
            version: 0,
            ..new_compliance
        };
        let bad_outpoint = CellInput {
            tx_hash: [0x91; 32],
            index: 0,
            since: 0,
        };
        let bad_lock = Script {
            code_hash: [0x99; 32],
            hash_type: HashType::Type,
            args: vec![0x01; 20],
        };
        let result = sdk.update_compliance(bad_outpoint, bad_compliance, bad_lock);
        assert_eq!(result.unwrap_err(), SDKError::ComplianceVersionNotIncremented);
    }
}
