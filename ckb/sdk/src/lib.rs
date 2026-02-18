// ============ VibeSwap CKB SDK ============
// Transaction builder for VibeSwap operations on Nervos CKB
// Builds unsigned transactions that can be signed by any CKB wallet

pub mod miner;

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

        // TWAP update
        if block_number > pool_data.twap_last_block {
            let price = pool_data.reserve1
                .checked_mul(PRECISION)
                .ok_or(SDKError::Overflow)?
                / pool_data.reserve0;
            let delta = block_number - pool_data.twap_last_block;
            new_pool.twap_price_cum = pool_data.twap_price_cum
                .wrapping_add(price * delta as u128);
            new_pool.twap_last_block = block_number;
        }

        // LP position cell
        let lp_position = LPPositionCellData {
            lp_amount,
            entry_price: pool_data.reserve1
                .checked_mul(PRECISION)
                .ok_or(SDKError::Overflow)?
                / pool_data.reserve0,
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
        // Calculate token amounts to return
        let amount0 = lp_position
            .lp_amount
            .checked_mul(pool_data.reserve0)
            .ok_or(SDKError::Overflow)?
            / pool_data.total_lp_supply;
        let amount1 = lp_position
            .lp_amount
            .checked_mul(pool_data.reserve1)
            .ok_or(SDKError::Overflow)?
            / pool_data.total_lp_supply;

        let mut new_pool = pool_data.clone();
        new_pool.reserve0 -= amount0;
        new_pool.reserve1 -= amount1;
        new_pool.total_lp_supply -= lp_position.lp_amount;

        // TWAP update
        if block_number > pool_data.twap_last_block {
            let price = pool_data.reserve1
                .checked_mul(PRECISION)
                .ok_or(SDKError::Overflow)?
                / pool_data.reserve0;
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
}
