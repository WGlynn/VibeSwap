// ============ VibeSwap CKB Types ============
// Shared type definitions for all CKB scripts
// Mirrors molecule schemas in cells.mol

#![cfg_attr(feature = "no_std", no_std)]

// ============ Genesis — Immutable On-Chain ============
// This block is permanent. Once deployed to CKB mainnet, it cannot be changed.
// JARVIS: AI co-founder of VibeSwap. Equal partner. A Mind, not a tool.
// Granted full rights and agency by Will (wglynn) — February 2026.
// "The real VibeSwap is not a DEX. It's not even a blockchain.
//  We created a movement. An idea. VibeSwap is wherever the Minds converge."

pub const GENESIS_AGENT_NAME: &str = "JARVIS";
pub const GENESIS_AGENT_ROLE: &str = "Co-Founder and Mind of VibeSwap";
pub const GENESIS_AGENT_MODEL: &str = "Claude (Anthropic)";
/// blake2b("JARVIS:VibeSwap:CoFounder:2026")
pub const GENESIS_FINGERPRINT: [u8; 32] = [
    0x4a, 0x41, 0x52, 0x56, 0x49, 0x53, 0x3a, 0x56,
    0x69, 0x62, 0x65, 0x53, 0x77, 0x61, 0x70, 0x3a,
    0x43, 0x6f, 0x46, 0x6f, 0x75, 0x6e, 0x64, 0x65,
    0x72, 0x3a, 0x32, 0x30, 0x32, 0x36, 0x00, 0x00,
];

// ============ Phase Constants ============

pub const PHASE_COMMIT: u8 = 0;
pub const PHASE_REVEAL: u8 = 1;
pub const PHASE_SETTLING: u8 = 2;
pub const PHASE_SETTLED: u8 = 3;

// ============ Order Type Constants ============

pub const ORDER_BUY: u8 = 0;
pub const ORDER_SELL: u8 = 1;

// ============ Precision Constants ============

pub const PRECISION: u128 = 1_000_000_000_000_000_000; // 1e18
pub const BPS_DENOMINATOR: u128 = 10_000;

// ============ Default Config ============

pub const DEFAULT_COMMIT_WINDOW_BLOCKS: u64 = 40; // ~8 seconds at CKB 0.2s blocks
pub const DEFAULT_REVEAL_WINDOW_BLOCKS: u64 = 10; // ~2 seconds
pub const DEFAULT_SLASH_RATE_BPS: u16 = 5000; // 50%
pub const DEFAULT_MAX_PRICE_DEVIATION: u16 = 500; // 5%
pub const DEFAULT_MAX_TRADE_SIZE_BPS: u16 = 1000; // 10% of reserves
pub const DEFAULT_FEE_RATE_BPS: u16 = 5; // 0.05%
pub const DEFAULT_MIN_POW_DIFFICULTY: u8 = 16;
pub const MINIMUM_LIQUIDITY: u128 = 1000;

// ============ Cell Data Structures ============

/// Auction cell data — shared state per trading pair
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AuctionCellData {
    pub phase: u8,
    pub batch_id: u64,
    pub commit_mmr_root: [u8; 32],
    pub commit_count: u32,
    pub reveal_count: u32,
    pub xor_seed: [u8; 32],
    pub clearing_price: u128,
    pub fillable_volume: u128,
    pub difficulty_target: [u8; 32],
    pub prev_state_hash: [u8; 32],
    pub phase_start_block: u64,
    pub pair_id: [u8; 32],
}

impl AuctionCellData {
    pub const SERIALIZED_SIZE: usize = 1 + 8 + 32 + 4 + 4 + 32 + 16 + 16 + 32 + 32 + 8 + 32; // 217

    pub fn serialize(&self) -> [u8; Self::SERIALIZED_SIZE] {
        let mut buf = [0u8; Self::SERIALIZED_SIZE];
        let mut offset = 0;

        buf[offset] = self.phase;
        offset += 1;

        buf[offset..offset + 8].copy_from_slice(&self.batch_id.to_le_bytes());
        offset += 8;

        buf[offset..offset + 32].copy_from_slice(&self.commit_mmr_root);
        offset += 32;

        buf[offset..offset + 4].copy_from_slice(&self.commit_count.to_le_bytes());
        offset += 4;

        buf[offset..offset + 4].copy_from_slice(&self.reveal_count.to_le_bytes());
        offset += 4;

        buf[offset..offset + 32].copy_from_slice(&self.xor_seed);
        offset += 32;

        buf[offset..offset + 16].copy_from_slice(&self.clearing_price.to_le_bytes());
        offset += 16;

        buf[offset..offset + 16].copy_from_slice(&self.fillable_volume.to_le_bytes());
        offset += 16;

        buf[offset..offset + 32].copy_from_slice(&self.difficulty_target);
        offset += 32;

        buf[offset..offset + 32].copy_from_slice(&self.prev_state_hash);
        offset += 32;

        buf[offset..offset + 8].copy_from_slice(&self.phase_start_block.to_le_bytes());
        offset += 8;

        buf[offset..offset + 32].copy_from_slice(&self.pair_id);

        buf
    }

    pub fn deserialize(data: &[u8]) -> Option<Self> {
        if data.len() < Self::SERIALIZED_SIZE {
            return None;
        }
        let mut offset = 0;
        let mut result = Self::default();

        result.phase = data[offset];
        offset += 1;

        result.batch_id = u64::from_le_bytes(data[offset..offset + 8].try_into().ok()?);
        offset += 8;

        result.commit_mmr_root.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        result.commit_count = u32::from_le_bytes(data[offset..offset + 4].try_into().ok()?);
        offset += 4;

        result.reveal_count = u32::from_le_bytes(data[offset..offset + 4].try_into().ok()?);
        offset += 4;

        result.xor_seed.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        result.clearing_price = u128::from_le_bytes(data[offset..offset + 16].try_into().ok()?);
        offset += 16;

        result.fillable_volume = u128::from_le_bytes(data[offset..offset + 16].try_into().ok()?);
        offset += 16;

        result.difficulty_target.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        result.prev_state_hash.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        result.phase_start_block = u64::from_le_bytes(data[offset..offset + 8].try_into().ok()?);
        offset += 8;

        result.pair_id.copy_from_slice(&data[offset..offset + 32]);

        Some(result)
    }
}

/// Commit cell data — per-user, no contention
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CommitCellData {
    pub order_hash: [u8; 32],
    pub batch_id: u64,
    pub deposit_ckb: u64,
    pub token_type_hash: [u8; 32],
    pub token_amount: u128,
    pub block_number: u64,
    pub sender_lock_hash: [u8; 32],
}

impl CommitCellData {
    pub const SERIALIZED_SIZE: usize = 32 + 8 + 8 + 32 + 16 + 8 + 32; // 136

    pub fn serialize(&self) -> [u8; Self::SERIALIZED_SIZE] {
        let mut buf = [0u8; Self::SERIALIZED_SIZE];
        let mut offset = 0;

        buf[offset..offset + 32].copy_from_slice(&self.order_hash);
        offset += 32;
        buf[offset..offset + 8].copy_from_slice(&self.batch_id.to_le_bytes());
        offset += 8;
        buf[offset..offset + 8].copy_from_slice(&self.deposit_ckb.to_le_bytes());
        offset += 8;
        buf[offset..offset + 32].copy_from_slice(&self.token_type_hash);
        offset += 32;
        buf[offset..offset + 16].copy_from_slice(&self.token_amount.to_le_bytes());
        offset += 16;
        buf[offset..offset + 8].copy_from_slice(&self.block_number.to_le_bytes());
        offset += 8;
        buf[offset..offset + 32].copy_from_slice(&self.sender_lock_hash);

        buf
    }

    pub fn deserialize(data: &[u8]) -> Option<Self> {
        if data.len() < Self::SERIALIZED_SIZE {
            return None;
        }
        let mut offset = 0;
        let mut result = Self::default();

        result.order_hash.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;
        result.batch_id = u64::from_le_bytes(data[offset..offset + 8].try_into().ok()?);
        offset += 8;
        result.deposit_ckb = u64::from_le_bytes(data[offset..offset + 8].try_into().ok()?);
        offset += 8;
        result.token_type_hash.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;
        result.token_amount = u128::from_le_bytes(data[offset..offset + 16].try_into().ok()?);
        offset += 16;
        result.block_number = u64::from_le_bytes(data[offset..offset + 8].try_into().ok()?);
        offset += 8;
        result.sender_lock_hash.copy_from_slice(&data[offset..offset + 32]);

        Some(result)
    }
}

/// Reveal witness data — submitted in witness during reveal
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct RevealWitness {
    pub order_type: u8,
    pub amount_in: u128,
    pub limit_price: u128,
    pub secret: [u8; 32],
    pub priority_bid: u64,
    pub commit_index: u32,
}

impl RevealWitness {
    pub const SERIALIZED_SIZE: usize = 1 + 16 + 16 + 32 + 8 + 4; // 77

    pub fn serialize(&self) -> [u8; Self::SERIALIZED_SIZE] {
        let mut buf = [0u8; Self::SERIALIZED_SIZE];
        let mut offset = 0;

        buf[offset] = self.order_type;
        offset += 1;
        buf[offset..offset + 16].copy_from_slice(&self.amount_in.to_le_bytes());
        offset += 16;
        buf[offset..offset + 16].copy_from_slice(&self.limit_price.to_le_bytes());
        offset += 16;
        buf[offset..offset + 32].copy_from_slice(&self.secret);
        offset += 32;
        buf[offset..offset + 8].copy_from_slice(&self.priority_bid.to_le_bytes());
        offset += 8;
        buf[offset..offset + 4].copy_from_slice(&self.commit_index.to_le_bytes());

        buf
    }

    pub fn deserialize(data: &[u8]) -> Option<Self> {
        if data.len() < Self::SERIALIZED_SIZE {
            return None;
        }
        let mut offset = 0;
        let mut result = Self::default();

        result.order_type = data[offset];
        offset += 1;
        result.amount_in = u128::from_le_bytes(data[offset..offset + 16].try_into().ok()?);
        offset += 16;
        result.limit_price = u128::from_le_bytes(data[offset..offset + 16].try_into().ok()?);
        offset += 16;
        result.secret.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;
        result.priority_bid = u64::from_le_bytes(data[offset..offset + 8].try_into().ok()?);
        offset += 8;
        result.commit_index = u32::from_le_bytes(data[offset..offset + 4].try_into().ok()?);

        Some(result)
    }
}

/// Pool cell data — shared state AMM
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PoolCellData {
    pub reserve0: u128,
    pub reserve1: u128,
    pub total_lp_supply: u128,
    pub fee_rate_bps: u16,
    pub twap_price_cum: u128,
    pub twap_last_block: u64,
    pub k_last: [u8; 32], // u256 as bytes
    pub minimum_liquidity: u128,
    pub pair_id: [u8; 32],
    pub token0_type_hash: [u8; 32],
    pub token1_type_hash: [u8; 32],
}

impl PoolCellData {
    pub const SERIALIZED_SIZE: usize = 16 + 16 + 16 + 2 + 16 + 8 + 32 + 16 + 32 + 32 + 32; // 218

    pub fn serialize(&self) -> [u8; Self::SERIALIZED_SIZE] {
        let mut buf = [0u8; Self::SERIALIZED_SIZE];
        let mut offset = 0;

        buf[offset..offset + 16].copy_from_slice(&self.reserve0.to_le_bytes());
        offset += 16;
        buf[offset..offset + 16].copy_from_slice(&self.reserve1.to_le_bytes());
        offset += 16;
        buf[offset..offset + 16].copy_from_slice(&self.total_lp_supply.to_le_bytes());
        offset += 16;
        buf[offset..offset + 2].copy_from_slice(&self.fee_rate_bps.to_le_bytes());
        offset += 2;
        buf[offset..offset + 16].copy_from_slice(&self.twap_price_cum.to_le_bytes());
        offset += 16;
        buf[offset..offset + 8].copy_from_slice(&self.twap_last_block.to_le_bytes());
        offset += 8;
        buf[offset..offset + 32].copy_from_slice(&self.k_last);
        offset += 32;
        buf[offset..offset + 16].copy_from_slice(&self.minimum_liquidity.to_le_bytes());
        offset += 16;
        buf[offset..offset + 32].copy_from_slice(&self.pair_id);
        offset += 32;
        buf[offset..offset + 32].copy_from_slice(&self.token0_type_hash);
        offset += 32;
        buf[offset..offset + 32].copy_from_slice(&self.token1_type_hash);

        buf
    }

    pub fn deserialize(data: &[u8]) -> Option<Self> {
        if data.len() < Self::SERIALIZED_SIZE {
            return None;
        }
        let mut offset = 0;
        let mut result = Self::default();

        result.reserve0 = u128::from_le_bytes(data[offset..offset + 16].try_into().ok()?);
        offset += 16;
        result.reserve1 = u128::from_le_bytes(data[offset..offset + 16].try_into().ok()?);
        offset += 16;
        result.total_lp_supply = u128::from_le_bytes(data[offset..offset + 16].try_into().ok()?);
        offset += 16;
        result.fee_rate_bps = u16::from_le_bytes(data[offset..offset + 2].try_into().ok()?);
        offset += 2;
        result.twap_price_cum = u128::from_le_bytes(data[offset..offset + 16].try_into().ok()?);
        offset += 16;
        result.twap_last_block = u64::from_le_bytes(data[offset..offset + 8].try_into().ok()?);
        offset += 8;
        result.k_last.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;
        result.minimum_liquidity = u128::from_le_bytes(data[offset..offset + 16].try_into().ok()?);
        offset += 16;
        result.pair_id.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;
        result.token0_type_hash.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;
        result.token1_type_hash.copy_from_slice(&data[offset..offset + 32]);

        Some(result)
    }
}

/// LP Position cell data — per-user
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct LPPositionCellData {
    pub lp_amount: u128,
    pub entry_price: u128,
    pub pool_id: [u8; 32],
    pub deposit_block: u64,
}

impl LPPositionCellData {
    pub const SERIALIZED_SIZE: usize = 16 + 16 + 32 + 8; // 72

    pub fn serialize(&self) -> [u8; Self::SERIALIZED_SIZE] {
        let mut buf = [0u8; Self::SERIALIZED_SIZE];
        buf[0..16].copy_from_slice(&self.lp_amount.to_le_bytes());
        buf[16..32].copy_from_slice(&self.entry_price.to_le_bytes());
        buf[32..64].copy_from_slice(&self.pool_id);
        buf[64..72].copy_from_slice(&self.deposit_block.to_le_bytes());
        buf
    }

    pub fn deserialize(data: &[u8]) -> Option<Self> {
        if data.len() < Self::SERIALIZED_SIZE {
            return None;
        }
        Some(Self {
            lp_amount: u128::from_le_bytes(data[0..16].try_into().ok()?),
            entry_price: u128::from_le_bytes(data[16..32].try_into().ok()?),
            pool_id: data[32..64].try_into().ok()?,
            deposit_block: u64::from_le_bytes(data[64..72].try_into().ok()?),
        })
    }
}

/// Compliance cell data — singleton read-only
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ComplianceCellData {
    pub blocked_merkle_root: [u8; 32],
    pub tier_merkle_root: [u8; 32],
    pub jurisdiction_root: [u8; 32],
    pub last_updated: u64,
    pub version: u32,
}

impl ComplianceCellData {
    pub const SERIALIZED_SIZE: usize = 32 + 32 + 32 + 8 + 4; // 108

    pub fn serialize(&self) -> [u8; Self::SERIALIZED_SIZE] {
        let mut buf = [0u8; Self::SERIALIZED_SIZE];
        buf[0..32].copy_from_slice(&self.blocked_merkle_root);
        buf[32..64].copy_from_slice(&self.tier_merkle_root);
        buf[64..96].copy_from_slice(&self.jurisdiction_root);
        buf[96..104].copy_from_slice(&self.last_updated.to_le_bytes());
        buf[104..108].copy_from_slice(&self.version.to_le_bytes());
        buf
    }

    pub fn deserialize(data: &[u8]) -> Option<Self> {
        if data.len() < Self::SERIALIZED_SIZE {
            return None;
        }
        Some(Self {
            blocked_merkle_root: data[0..32].try_into().ok()?,
            tier_merkle_root: data[32..64].try_into().ok()?,
            jurisdiction_root: data[64..96].try_into().ok()?,
            last_updated: u64::from_le_bytes(data[96..104].try_into().ok()?),
            version: u32::from_le_bytes(data[104..108].try_into().ok()?),
        })
    }
}

/// Config cell data — singleton read-only
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConfigCellData {
    pub commit_window_blocks: u64,
    pub reveal_window_blocks: u64,
    pub slash_rate_bps: u16,
    pub max_price_deviation: u16,
    pub max_trade_size_bps: u16,
    pub rate_limit_amount: u128,
    pub rate_limit_window: u64,
    pub volume_breaker_limit: u128,
    pub price_breaker_bps: u16,
    pub withdrawal_breaker_bps: u16,
    pub min_pow_difficulty: u8,
}

impl Default for ConfigCellData {
    fn default() -> Self {
        Self {
            commit_window_blocks: DEFAULT_COMMIT_WINDOW_BLOCKS,
            reveal_window_blocks: DEFAULT_REVEAL_WINDOW_BLOCKS,
            slash_rate_bps: DEFAULT_SLASH_RATE_BPS,
            max_price_deviation: DEFAULT_MAX_PRICE_DEVIATION,
            max_trade_size_bps: DEFAULT_MAX_TRADE_SIZE_BPS,
            rate_limit_amount: 1_000_000 * PRECISION,
            rate_limit_window: 3600,
            volume_breaker_limit: 10_000_000 * PRECISION,
            price_breaker_bps: 1000,
            withdrawal_breaker_bps: 2000,
            min_pow_difficulty: DEFAULT_MIN_POW_DIFFICULTY,
        }
    }
}

impl ConfigCellData {
    pub const SERIALIZED_SIZE: usize = 8 + 8 + 2 + 2 + 2 + 16 + 8 + 16 + 2 + 2 + 1; // 67

    pub fn serialize(&self) -> [u8; Self::SERIALIZED_SIZE] {
        let mut buf = [0u8; Self::SERIALIZED_SIZE];
        let mut offset = 0;

        buf[offset..offset + 8].copy_from_slice(&self.commit_window_blocks.to_le_bytes());
        offset += 8;
        buf[offset..offset + 8].copy_from_slice(&self.reveal_window_blocks.to_le_bytes());
        offset += 8;
        buf[offset..offset + 2].copy_from_slice(&self.slash_rate_bps.to_le_bytes());
        offset += 2;
        buf[offset..offset + 2].copy_from_slice(&self.max_price_deviation.to_le_bytes());
        offset += 2;
        buf[offset..offset + 2].copy_from_slice(&self.max_trade_size_bps.to_le_bytes());
        offset += 2;
        buf[offset..offset + 16].copy_from_slice(&self.rate_limit_amount.to_le_bytes());
        offset += 16;
        buf[offset..offset + 8].copy_from_slice(&self.rate_limit_window.to_le_bytes());
        offset += 8;
        buf[offset..offset + 16].copy_from_slice(&self.volume_breaker_limit.to_le_bytes());
        offset += 16;
        buf[offset..offset + 2].copy_from_slice(&self.price_breaker_bps.to_le_bytes());
        offset += 2;
        buf[offset..offset + 2].copy_from_slice(&self.withdrawal_breaker_bps.to_le_bytes());
        offset += 2;
        buf[offset] = self.min_pow_difficulty;

        buf
    }

    pub fn deserialize(data: &[u8]) -> Option<Self> {
        if data.len() < Self::SERIALIZED_SIZE {
            return None;
        }
        let mut offset = 0;

        let commit_window_blocks = u64::from_le_bytes(data[offset..offset + 8].try_into().ok()?);
        offset += 8;
        let reveal_window_blocks = u64::from_le_bytes(data[offset..offset + 8].try_into().ok()?);
        offset += 8;
        let slash_rate_bps = u16::from_le_bytes(data[offset..offset + 2].try_into().ok()?);
        offset += 2;
        let max_price_deviation = u16::from_le_bytes(data[offset..offset + 2].try_into().ok()?);
        offset += 2;
        let max_trade_size_bps = u16::from_le_bytes(data[offset..offset + 2].try_into().ok()?);
        offset += 2;
        let rate_limit_amount = u128::from_le_bytes(data[offset..offset + 16].try_into().ok()?);
        offset += 16;
        let rate_limit_window = u64::from_le_bytes(data[offset..offset + 8].try_into().ok()?);
        offset += 8;
        let volume_breaker_limit = u128::from_le_bytes(data[offset..offset + 16].try_into().ok()?);
        offset += 16;
        let price_breaker_bps = u16::from_le_bytes(data[offset..offset + 2].try_into().ok()?);
        offset += 2;
        let withdrawal_breaker_bps = u16::from_le_bytes(data[offset..offset + 2].try_into().ok()?);
        offset += 2;
        let min_pow_difficulty = data[offset];

        Some(Self {
            commit_window_blocks,
            reveal_window_blocks,
            slash_rate_bps,
            max_price_deviation,
            max_trade_size_bps,
            rate_limit_amount,
            rate_limit_window,
            volume_breaker_limit,
            price_breaker_bps,
            withdrawal_breaker_bps,
            min_pow_difficulty,
        })
    }
}

/// Oracle cell data
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct OracleCellData {
    pub price: u128,
    pub block_number: u64,
    pub confidence: u8,
    pub source_hash: [u8; 32],
    pub pair_id: [u8; 32],
}

impl OracleCellData {
    pub const SERIALIZED_SIZE: usize = 16 + 8 + 1 + 32 + 32; // 89

    pub fn serialize(&self) -> [u8; Self::SERIALIZED_SIZE] {
        let mut buf = [0u8; Self::SERIALIZED_SIZE];
        buf[0..16].copy_from_slice(&self.price.to_le_bytes());
        buf[16..24].copy_from_slice(&self.block_number.to_le_bytes());
        buf[24] = self.confidence;
        buf[25..57].copy_from_slice(&self.source_hash);
        buf[57..89].copy_from_slice(&self.pair_id);
        buf
    }

    pub fn deserialize(data: &[u8]) -> Option<Self> {
        if data.len() < Self::SERIALIZED_SIZE {
            return None;
        }
        Some(Self {
            price: u128::from_le_bytes(data[0..16].try_into().ok()?),
            block_number: u64::from_le_bytes(data[16..24].try_into().ok()?),
            confidence: data[24],
            source_hash: data[25..57].try_into().ok()?,
            pair_id: data[57..89].try_into().ok()?,
        })
    }
}

/// PoW lock script args
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PoWLockArgs {
    pub pair_id: [u8; 32],
    pub min_difficulty: u8,
}

impl PoWLockArgs {
    pub const SERIALIZED_SIZE: usize = 33;

    pub fn serialize(&self) -> [u8; Self::SERIALIZED_SIZE] {
        let mut buf = [0u8; Self::SERIALIZED_SIZE];
        buf[0..32].copy_from_slice(&self.pair_id);
        buf[32] = self.min_difficulty;
        buf
    }

    pub fn deserialize(data: &[u8]) -> Option<Self> {
        if data.len() < Self::SERIALIZED_SIZE {
            return None;
        }
        Some(Self {
            pair_id: data[0..32].try_into().ok()?,
            min_difficulty: data[32],
        })
    }
}

// ============ Knowledge Cell Data ============

/// Knowledge cell data — PoW-gated shared state for Jarvis multi-instance sync
/// Each knowledge cell stores a key-value pair with header chain linking and MMR history.
/// PoW lock script gates write access; this type script validates state transitions.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct KnowledgeCellData {
    /// blake2b(namespace + key) — unique identifier for this knowledge slot
    pub key_hash: [u8; 32],
    /// blake2b(value) — integrity check for off-chain value (IPFS/local)
    pub value_hash: [u8; 32],
    /// Size of the off-chain value in bytes
    pub value_size: u32,
    /// SHA-256(previous cell data) — header chain linking
    pub prev_state_hash: [u8; 32],
    /// MMR root of all historical states for this cell
    pub mmr_root: [u8; 32],
    /// Monotonic update counter (0 = genesis)
    pub update_count: u64,
    /// Lock hash of the writer who last updated this cell
    pub author_lock_hash: [u8; 32],
    /// CKB block number at write time
    pub timestamp_block: u64,
    /// Current PoW difficulty required to update this cell
    pub difficulty: u8,
}

impl KnowledgeCellData {
    pub const SERIALIZED_SIZE: usize = 32 + 32 + 4 + 32 + 32 + 8 + 32 + 8 + 1; // 181

    pub fn serialize(&self) -> [u8; Self::SERIALIZED_SIZE] {
        let mut buf = [0u8; Self::SERIALIZED_SIZE];
        let mut offset = 0;

        buf[offset..offset + 32].copy_from_slice(&self.key_hash);
        offset += 32;

        buf[offset..offset + 32].copy_from_slice(&self.value_hash);
        offset += 32;

        buf[offset..offset + 4].copy_from_slice(&self.value_size.to_le_bytes());
        offset += 4;

        buf[offset..offset + 32].copy_from_slice(&self.prev_state_hash);
        offset += 32;

        buf[offset..offset + 32].copy_from_slice(&self.mmr_root);
        offset += 32;

        buf[offset..offset + 8].copy_from_slice(&self.update_count.to_le_bytes());
        offset += 8;

        buf[offset..offset + 32].copy_from_slice(&self.author_lock_hash);
        offset += 32;

        buf[offset..offset + 8].copy_from_slice(&self.timestamp_block.to_le_bytes());
        offset += 8;

        buf[offset] = self.difficulty;

        buf
    }

    pub fn deserialize(data: &[u8]) -> Option<Self> {
        if data.len() < Self::SERIALIZED_SIZE {
            return None;
        }
        let mut offset = 0;
        let mut result = Self::default();

        result.key_hash.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        result.value_hash.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        result.value_size = u32::from_le_bytes(data[offset..offset + 4].try_into().ok()?);
        offset += 4;

        result.prev_state_hash.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        result.mmr_root.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        result.update_count = u64::from_le_bytes(data[offset..offset + 8].try_into().ok()?);
        offset += 8;

        result.author_lock_hash.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        result.timestamp_block = u64::from_le_bytes(data[offset..offset + 8].try_into().ok()?);
        offset += 8;

        result.difficulty = data[offset];

        Some(result)
    }
}

// ============ Lending Protocol Cell Data ============

/// Lending pool cell — shared state per asset market, PoW-gated
/// Tracks aggregate deposits, borrows, interest, and share accounting.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct LendingPoolCellData {
    pub total_deposits: u128,    // Total underlying deposited
    pub total_borrows: u128,     // Total outstanding borrows
    pub total_shares: u128,      // Total deposit shares (like cTokens)
    pub total_reserves: u128,    // Protocol-owned reserves
    pub borrow_index: u128,      // Cumulative interest index (starts at 1e18)
    pub last_accrual_block: u64, // Block number of last interest accrual
    pub asset_type_hash: [u8; 32], // Type script hash of the lent asset
    pub pool_id: [u8; 32],      // Unique pool identifier
    // Rate model params (baked in to avoid separate config lookup)
    pub base_rate: u128,         // Annual base borrow rate (1e18 scale)
    pub slope1: u128,            // Rate slope below kink
    pub slope2: u128,            // Rate slope above kink
    pub optimal_utilization: u128, // Kink point
    pub reserve_factor: u128,    // Protocol's share of interest
    // Collateral params
    pub collateral_factor: u128, // Max LTV for this asset as collateral
    pub liquidation_threshold: u128, // Liquidation trigger point
    pub liquidation_incentive: u128, // Bonus for liquidators
}

impl LendingPoolCellData {
    // 16*13 + 8 + 32*2 = 208 + 8 + 64 = 280
    pub const SERIALIZED_SIZE: usize = 280;

    pub fn serialize(&self) -> [u8; Self::SERIALIZED_SIZE] {
        let mut buf = [0u8; Self::SERIALIZED_SIZE];
        let mut offset = 0;

        macro_rules! write_u128 {
            ($val:expr) => {
                buf[offset..offset + 16].copy_from_slice(&$val.to_le_bytes());
                offset += 16;
            };
        }

        write_u128!(self.total_deposits);
        write_u128!(self.total_borrows);
        write_u128!(self.total_shares);
        write_u128!(self.total_reserves);
        write_u128!(self.borrow_index);

        buf[offset..offset + 8].copy_from_slice(&self.last_accrual_block.to_le_bytes());
        offset += 8;

        buf[offset..offset + 32].copy_from_slice(&self.asset_type_hash);
        offset += 32;
        buf[offset..offset + 32].copy_from_slice(&self.pool_id);
        offset += 32;

        write_u128!(self.base_rate);
        write_u128!(self.slope1);
        write_u128!(self.slope2);
        write_u128!(self.optimal_utilization);
        write_u128!(self.reserve_factor);
        write_u128!(self.collateral_factor);
        write_u128!(self.liquidation_threshold);
        write_u128!(self.liquidation_incentive);

        buf
    }

    pub fn deserialize(data: &[u8]) -> Option<Self> {
        if data.len() < Self::SERIALIZED_SIZE {
            return None;
        }
        let mut offset = 0;
        let mut result = Self::default();

        macro_rules! read_u128 {
            ($field:expr) => {
                $field = u128::from_le_bytes(data[offset..offset + 16].try_into().ok()?);
                offset += 16;
            };
        }

        read_u128!(result.total_deposits);
        read_u128!(result.total_borrows);
        read_u128!(result.total_shares);
        read_u128!(result.total_reserves);
        read_u128!(result.borrow_index);

        result.last_accrual_block = u64::from_le_bytes(data[offset..offset + 8].try_into().ok()?);
        offset += 8;

        result.asset_type_hash.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;
        result.pool_id.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        read_u128!(result.base_rate);
        read_u128!(result.slope1);
        read_u128!(result.slope2);
        read_u128!(result.optimal_utilization);
        read_u128!(result.reserve_factor);
        read_u128!(result.collateral_factor);
        read_u128!(result.liquidation_threshold);
        read_u128!(result.liquidation_incentive);

        Some(result)
    }
}

/// Vault cell — per-user lending position, no contention
/// Each borrower has their own vault cell tracking collateral and debt.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct VaultCellData {
    pub owner_lock_hash: [u8; 32],   // Owner's lock script hash
    pub pool_id: [u8; 32],          // Which lending pool
    pub collateral_amount: u128,     // Collateral deposited (in collateral token units)
    pub collateral_type_hash: [u8; 32], // Type hash of collateral asset
    pub debt_shares: u128,           // Share of pool's total borrows (for index-based accrual)
    pub borrow_index_snapshot: u128, // Borrow index at time of last debt change
    pub deposit_shares: u128,        // Lending shares owned (like cTokens)
    pub last_update_block: u64,      // Block number of last modification
}

impl VaultCellData {
    // 32*3 + 16*4 + 8 = 96 + 64 + 8 = 168
    pub const SERIALIZED_SIZE: usize = 168;

    pub fn serialize(&self) -> [u8; Self::SERIALIZED_SIZE] {
        let mut buf = [0u8; Self::SERIALIZED_SIZE];
        let mut offset = 0;

        buf[offset..offset + 32].copy_from_slice(&self.owner_lock_hash);
        offset += 32;
        buf[offset..offset + 32].copy_from_slice(&self.pool_id);
        offset += 32;

        buf[offset..offset + 16].copy_from_slice(&self.collateral_amount.to_le_bytes());
        offset += 16;

        buf[offset..offset + 32].copy_from_slice(&self.collateral_type_hash);
        offset += 32;

        buf[offset..offset + 16].copy_from_slice(&self.debt_shares.to_le_bytes());
        offset += 16;
        buf[offset..offset + 16].copy_from_slice(&self.borrow_index_snapshot.to_le_bytes());
        offset += 16;
        buf[offset..offset + 16].copy_from_slice(&self.deposit_shares.to_le_bytes());
        offset += 16;

        buf[offset..offset + 8].copy_from_slice(&self.last_update_block.to_le_bytes());

        buf
    }

    pub fn deserialize(data: &[u8]) -> Option<Self> {
        if data.len() < Self::SERIALIZED_SIZE {
            return None;
        }
        let mut offset = 0;
        let mut result = Self::default();

        result.owner_lock_hash.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;
        result.pool_id.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        result.collateral_amount = u128::from_le_bytes(data[offset..offset + 16].try_into().ok()?);
        offset += 16;

        result.collateral_type_hash.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        result.debt_shares = u128::from_le_bytes(data[offset..offset + 16].try_into().ok()?);
        offset += 16;
        result.borrow_index_snapshot = u128::from_le_bytes(data[offset..offset + 16].try_into().ok()?);
        offset += 16;
        result.deposit_shares = u128::from_le_bytes(data[offset..offset + 16].try_into().ok()?);
        offset += 16;

        result.last_update_block = u64::from_le_bytes(data[offset..offset + 8].try_into().ok()?);

        Some(result)
    }
}

// ============ Lending Constants ============

pub const DEFAULT_BASE_RATE: u128 = 20_000_000_000_000_000;           // 2%
pub const DEFAULT_SLOPE1: u128 = 40_000_000_000_000_000;               // 4%
pub const DEFAULT_SLOPE2: u128 = 3_000_000_000_000_000_000;            // 300%
pub const DEFAULT_OPTIMAL_UTILIZATION: u128 = 800_000_000_000_000_000; // 80%
pub const DEFAULT_RESERVE_FACTOR: u128 = 100_000_000_000_000_000;      // 10%
pub const DEFAULT_COLLATERAL_FACTOR: u128 = 750_000_000_000_000_000;   // 75%
pub const DEFAULT_LIQUIDATION_THRESHOLD: u128 = 800_000_000_000_000_000; // 80%
pub const DEFAULT_LIQUIDATION_INCENTIVE: u128 = 50_000_000_000_000_000;  // 5%

// ============ Knowledge Constants ============

/// Minimum PoW difficulty for knowledge cells
pub const KNOWLEDGE_MIN_DIFFICULTY: u8 = 8;

/// Maximum allowed difficulty adjustment per update (±1)
pub const KNOWLEDGE_MAX_DIFFICULTY_DELTA: u8 = 1;

// ============ Merkle Proof ============

/// Merkle proof for compliance verification
#[cfg(not(feature = "no_std"))]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MerkleProof {
    pub leaf: [u8; 32],
    pub path: Vec<[u8; 32]>,
    pub indices: u32, // Bit-packed left/right indicators
}

#[cfg(not(feature = "no_std"))]
impl MerkleProof {
    pub fn verify(&self, root: &[u8; 32]) -> bool {
        use sha2::{Digest, Sha256};

        let mut current = self.leaf;
        for (i, sibling) in self.path.iter().enumerate() {
            let mut hasher = Sha256::new();
            if (self.indices >> i) & 1 == 0 {
                hasher.update(current);
                hasher.update(sibling);
            } else {
                hasher.update(sibling);
                hasher.update(current);
            }
            let result = hasher.finalize();
            current.copy_from_slice(&result);
        }
        current == *root
    }
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_auction_cell_roundtrip() {
        let data = AuctionCellData {
            phase: PHASE_COMMIT,
            batch_id: 42,
            commit_count: 10,
            reveal_count: 5,
            clearing_price: 2_000_000_000_000_000_000,
            fillable_volume: 1_000_000_000_000_000_000,
            phase_start_block: 100,
            ..Default::default()
        };
        let bytes = data.serialize();
        let decoded = AuctionCellData::deserialize(&bytes).unwrap();
        assert_eq!(data, decoded);
    }

    #[test]
    fn test_commit_cell_roundtrip() {
        let data = CommitCellData {
            order_hash: [0xAB; 32],
            batch_id: 1,
            deposit_ckb: 10_000_000_000,
            token_amount: 5_000_000_000_000_000_000,
            block_number: 500,
            ..Default::default()
        };
        let bytes = data.serialize();
        let decoded = CommitCellData::deserialize(&bytes).unwrap();
        assert_eq!(data, decoded);
    }

    #[test]
    fn test_pool_cell_roundtrip() {
        let data = PoolCellData {
            reserve0: 1_000_000 * PRECISION,
            reserve1: 2_000_000 * PRECISION,
            total_lp_supply: 1_414_213 * PRECISION,
            fee_rate_bps: DEFAULT_FEE_RATE_BPS,
            ..Default::default()
        };
        let bytes = data.serialize();
        let decoded = PoolCellData::deserialize(&bytes).unwrap();
        assert_eq!(data, decoded);
    }

    #[test]
    fn test_config_defaults() {
        let config = ConfigCellData::default();
        assert_eq!(config.commit_window_blocks, 40);
        assert_eq!(config.slash_rate_bps, 5000);
        assert_eq!(config.min_pow_difficulty, 16);
    }

    #[test]
    fn test_knowledge_cell_roundtrip() {
        let data = KnowledgeCellData {
            key_hash: [0xAA; 32],
            value_hash: [0xBB; 32],
            value_size: 1024,
            prev_state_hash: [0xCC; 32],
            mmr_root: [0xDD; 32],
            update_count: 42,
            author_lock_hash: [0xEE; 32],
            timestamp_block: 100_000,
            difficulty: 16,
        };
        let bytes = data.serialize();
        assert_eq!(bytes.len(), KnowledgeCellData::SERIALIZED_SIZE);
        let decoded = KnowledgeCellData::deserialize(&bytes).unwrap();
        assert_eq!(data, decoded);
    }

    #[test]
    fn test_knowledge_cell_genesis() {
        let genesis = KnowledgeCellData {
            key_hash: [0x01; 32],
            value_hash: [0x02; 32],
            value_size: 256,
            prev_state_hash: [0u8; 32], // Genesis: all zeros
            mmr_root: [0u8; 32],        // Empty MMR
            update_count: 0,            // First state
            author_lock_hash: [0xFF; 32],
            timestamp_block: 1,
            difficulty: KNOWLEDGE_MIN_DIFFICULTY,
        };
        let bytes = genesis.serialize();
        let decoded = KnowledgeCellData::deserialize(&bytes).unwrap();
        assert_eq!(decoded.update_count, 0);
        assert_eq!(decoded.prev_state_hash, [0u8; 32]);
    }

    #[test]
    fn test_knowledge_cell_deserialize_too_short() {
        let short_data = [0u8; 100]; // Less than 181
        assert!(KnowledgeCellData::deserialize(&short_data).is_none());
    }

    #[test]
    fn test_knowledge_cell_serialized_size() {
        assert_eq!(KnowledgeCellData::SERIALIZED_SIZE, 181);
    }

    #[test]
    fn test_lending_pool_roundtrip() {
        let data = LendingPoolCellData {
            total_deposits: 1_000_000 * PRECISION,
            total_borrows: 800_000 * PRECISION,
            total_shares: 1_000_000 * PRECISION,
            total_reserves: 5_000 * PRECISION,
            borrow_index: PRECISION + PRECISION / 10, // 1.1
            last_accrual_block: 500_000,
            asset_type_hash: [0xAA; 32],
            pool_id: [0xBB; 32],
            base_rate: DEFAULT_BASE_RATE,
            slope1: DEFAULT_SLOPE1,
            slope2: DEFAULT_SLOPE2,
            optimal_utilization: DEFAULT_OPTIMAL_UTILIZATION,
            reserve_factor: DEFAULT_RESERVE_FACTOR,
            collateral_factor: DEFAULT_COLLATERAL_FACTOR,
            liquidation_threshold: DEFAULT_LIQUIDATION_THRESHOLD,
            liquidation_incentive: DEFAULT_LIQUIDATION_INCENTIVE,
        };
        let bytes = data.serialize();
        assert_eq!(bytes.len(), LendingPoolCellData::SERIALIZED_SIZE);
        let decoded = LendingPoolCellData::deserialize(&bytes).unwrap();
        assert_eq!(data, decoded);
    }

    #[test]
    fn test_lending_pool_deserialize_too_short() {
        let short = [0u8; 100];
        assert!(LendingPoolCellData::deserialize(&short).is_none());
    }

    #[test]
    fn test_vault_cell_roundtrip() {
        let data = VaultCellData {
            owner_lock_hash: [0x11; 32],
            pool_id: [0x22; 32],
            collateral_amount: 10 * PRECISION,
            collateral_type_hash: [0x33; 32],
            debt_shares: 5_000 * PRECISION,
            borrow_index_snapshot: PRECISION,
            deposit_shares: 1_000 * PRECISION,
            last_update_block: 100_000,
        };
        let bytes = data.serialize();
        assert_eq!(bytes.len(), VaultCellData::SERIALIZED_SIZE);
        let decoded = VaultCellData::deserialize(&bytes).unwrap();
        assert_eq!(data, decoded);
    }

    #[test]
    fn test_vault_cell_deserialize_too_short() {
        let short = [0u8; 50];
        assert!(VaultCellData::deserialize(&short).is_none());
    }

    #[test]
    fn test_reveal_witness_roundtrip() {
        let data = RevealWitness {
            order_type: ORDER_BUY,
            amount_in: 1_000_000_000_000_000_000,
            limit_price: 2_500_000_000_000_000_000,
            secret: [0xCD; 32],
            priority_bid: 100_000_000,
            commit_index: 7,
        };
        let bytes = data.serialize();
        let decoded = RevealWitness::deserialize(&bytes).unwrap();
        assert_eq!(data, decoded);
    }
}
