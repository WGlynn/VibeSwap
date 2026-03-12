// ============ Serde Cell Module ============
// CKB Cell Data Serialization — encoding and decoding all VibeSwap protocol
// cell types to/from compact byte representations. On CKB, cell data must be
// serialized into raw bytes for on-chain storage.
//
// All serialization is **little-endian** (CKB convention).
// Fixed-size encoding for deterministic cell capacity calculation.
//
// Cell types and sizes:
//   PoolCellData       — 184 bytes
//   VaultCellData      — 104 bytes
//   OracleCellData     —  76 bytes
//   GovernanceCellData — 113 bytes
//   StakeCellData      — 112 bytes
//   BatchCellData      —  73 bytes
//   CommitCellData     —  88 bytes
//   EscrowCellData     — 121 bytes
//
// Functions:
//   serialize_*/deserialize_*   — roundtrip for each cell type
//   *_cell_size()               — constant size for each cell type
//   write_*/read_*              — primitive helpers (u8, u32, u64, u128, bytes32)
//   compute_checksum()          — first 4 bytes of SHA-256
//   validate_*()                — field validation
//   minimum_capacity()          — CKB capacity formula
//   detect_cell_type()          — guess type from byte length
//   roundtrip_verify_pool()     — serialize then deserialize and compare

use sha2::{Digest, Sha256};

// ============ Constants ============

/// Pool cell serialized size in bytes
pub const POOL_CELL_SIZE: usize = 184;

/// Vault cell serialized size in bytes
pub const VAULT_CELL_SIZE: usize = 104;

/// Oracle cell serialized size in bytes
pub const ORACLE_CELL_SIZE: usize = 76;

/// Governance cell serialized size in bytes
pub const GOVERNANCE_CELL_SIZE: usize = 113;

/// Stake cell serialized size in bytes
pub const STAKE_CELL_SIZE: usize = 112;

/// Batch cell serialized size in bytes
pub const BATCH_CELL_SIZE: usize = 73;

/// Commit cell serialized size in bytes
pub const COMMIT_CELL_SIZE: usize = 88;

/// Escrow cell serialized size in bytes
pub const ESCROW_CELL_SIZE: usize = 121;

/// CKB shannons per CKByte (1 CKB = 10^8 shannons)
const SHANNONS_PER_CKB: u64 = 100_000_000;

/// Cell overhead: 33 bytes (lock script min) + 8 bytes (capacity)
const CELL_OVERHEAD: usize = 41;

// ============ Error Types ============

#[derive(Debug, Clone, PartialEq)]
pub enum SerdeError {
    BufferTooShort { expected: usize, actual: usize },
    BufferTooLong { expected: usize, actual: usize },
    InvalidStatus(u8),
    InvalidPhase(u8),
    ChecksumMismatch,
    InvalidVersion(u8),
    Overflow,
    ZeroPoolId,
    InvalidFieldValue,
}

// ============ Data Types ============

#[derive(Debug, Clone, PartialEq)]
pub struct PoolCellData {
    pub pool_id: [u8; 32],
    pub token_a: [u8; 32],
    pub token_b: [u8; 32],
    pub reserve_a: u64,
    pub reserve_b: u64,
    pub total_lp: u64,
    pub fee_rate_bps: u32,
    pub protocol_fee_bps: u32,
    pub k_last: u128,
    pub cumulative_price_a: u128,
    pub cumulative_price_b: u128,
    pub last_update_block: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct VaultCellData {
    pub owner: [u8; 32],
    pub pool_id: [u8; 32],
    pub collateral_amount: u64,
    pub debt_shares: u64,
    pub deposit_shares: u64,
    pub last_accrual_block: u64,
    pub health_factor: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct OracleCellData {
    pub oracle_id: [u8; 32],
    pub price: u64,
    pub confidence: u32,
    pub timestamp: u64,
    pub block_height: u64,
    pub source_count: u32,
    pub twap_price: u64,
    pub volatility_bps: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct GovernanceCellData {
    pub proposal_id: u64,
    pub proposer: [u8; 32],
    pub start_block: u64,
    pub end_block: u64,
    pub for_votes: u64,
    pub against_votes: u64,
    pub quorum: u64,
    pub status: u8,
    pub action_hash: [u8; 32],
}

#[derive(Debug, Clone, PartialEq)]
pub struct StakeCellData {
    pub staker: [u8; 32],
    pub amount: u64,
    pub lock_start: u64,
    pub lock_end: u64,
    pub voting_power: u64,
    pub reward_debt: u64,
    pub accumulated_reward: u64,
    pub delegate: Option<[u8; 32]>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BatchCellData {
    pub batch_id: u64,
    pub pool_id: [u8; 32],
    pub phase: u8,
    pub start_time: u64,
    pub commit_count: u32,
    pub reveal_count: u32,
    pub total_deposits: u64,
    pub clearing_price: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CommitCellData {
    pub commit_hash: [u8; 32],
    pub depositor: [u8; 32],
    pub deposit_amount: u64,
    pub batch_id: u64,
    pub timestamp: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct EscrowCellData {
    pub escrow_id: u64,
    pub depositor: [u8; 32],
    pub recipient: [u8; 32],
    pub amount: u64,
    pub hash_lock: [u8; 32],
    pub deadline: u64,
    pub status: u8,
}

// ============ Primitive Write Helpers ============

pub fn write_u8(buf: &mut Vec<u8>, val: u8) {
    buf.push(val);
}

pub fn write_u32_le(buf: &mut Vec<u8>, val: u32) {
    buf.extend_from_slice(&val.to_le_bytes());
}

pub fn write_u64_le(buf: &mut Vec<u8>, val: u64) {
    buf.extend_from_slice(&val.to_le_bytes());
}

pub fn write_u128_le(buf: &mut Vec<u8>, val: u128) {
    buf.extend_from_slice(&val.to_le_bytes());
}

pub fn write_bytes32(buf: &mut Vec<u8>, val: &[u8; 32]) {
    buf.extend_from_slice(val);
}

// ============ Primitive Read Helpers ============

pub fn read_u8(bytes: &[u8], offset: usize) -> Result<u8, SerdeError> {
    if offset >= bytes.len() {
        return Err(SerdeError::BufferTooShort {
            expected: offset + 1,
            actual: bytes.len(),
        });
    }
    Ok(bytes[offset])
}

pub fn read_u32_le(bytes: &[u8], offset: usize) -> Result<u32, SerdeError> {
    if offset + 4 > bytes.len() {
        return Err(SerdeError::BufferTooShort {
            expected: offset + 4,
            actual: bytes.len(),
        });
    }
    let arr: [u8; 4] = bytes[offset..offset + 4].try_into().unwrap();
    Ok(u32::from_le_bytes(arr))
}

pub fn read_u64_le(bytes: &[u8], offset: usize) -> Result<u64, SerdeError> {
    if offset + 8 > bytes.len() {
        return Err(SerdeError::BufferTooShort {
            expected: offset + 8,
            actual: bytes.len(),
        });
    }
    let arr: [u8; 8] = bytes[offset..offset + 8].try_into().unwrap();
    Ok(u64::from_le_bytes(arr))
}

pub fn read_u128_le(bytes: &[u8], offset: usize) -> Result<u128, SerdeError> {
    if offset + 16 > bytes.len() {
        return Err(SerdeError::BufferTooShort {
            expected: offset + 16,
            actual: bytes.len(),
        });
    }
    let arr: [u8; 16] = bytes[offset..offset + 16].try_into().unwrap();
    Ok(u128::from_le_bytes(arr))
}

pub fn read_bytes32(bytes: &[u8], offset: usize) -> Result<[u8; 32], SerdeError> {
    if offset + 32 > bytes.len() {
        return Err(SerdeError::BufferTooShort {
            expected: offset + 32,
            actual: bytes.len(),
        });
    }
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&bytes[offset..offset + 32]);
    Ok(arr)
}

// ============ Pool Cell ============

pub fn pool_cell_size() -> usize {
    POOL_CELL_SIZE
}

pub fn serialize_pool(data: &PoolCellData) -> Vec<u8> {
    let mut buf = Vec::with_capacity(POOL_CELL_SIZE);
    write_bytes32(&mut buf, &data.pool_id);       // 0..32
    write_bytes32(&mut buf, &data.token_a);        // 32..64
    write_bytes32(&mut buf, &data.token_b);        // 64..96
    write_u64_le(&mut buf, data.reserve_a);        // 96..104
    write_u64_le(&mut buf, data.reserve_b);        // 104..112
    write_u64_le(&mut buf, data.total_lp);         // 112..120
    write_u32_le(&mut buf, data.fee_rate_bps);     // 120..124
    write_u32_le(&mut buf, data.protocol_fee_bps); // 124..128
    write_u128_le(&mut buf, data.k_last);          // 128..144
    write_u128_le(&mut buf, data.cumulative_price_a); // 144..160
    write_u128_le(&mut buf, data.cumulative_price_b); // 160..176
    write_u64_le(&mut buf, data.last_update_block);   // 176..184
    buf
}

pub fn deserialize_pool(bytes: &[u8]) -> Result<PoolCellData, SerdeError> {
    if bytes.len() < POOL_CELL_SIZE {
        return Err(SerdeError::BufferTooShort {
            expected: POOL_CELL_SIZE,
            actual: bytes.len(),
        });
    }
    if bytes.len() > POOL_CELL_SIZE {
        return Err(SerdeError::BufferTooLong {
            expected: POOL_CELL_SIZE,
            actual: bytes.len(),
        });
    }
    Ok(PoolCellData {
        pool_id: read_bytes32(bytes, 0)?,
        token_a: read_bytes32(bytes, 32)?,
        token_b: read_bytes32(bytes, 64)?,
        reserve_a: read_u64_le(bytes, 96)?,
        reserve_b: read_u64_le(bytes, 104)?,
        total_lp: read_u64_le(bytes, 112)?,
        fee_rate_bps: read_u32_le(bytes, 120)?,
        protocol_fee_bps: read_u32_le(bytes, 124)?,
        k_last: read_u128_le(bytes, 128)?,
        cumulative_price_a: read_u128_le(bytes, 144)?,
        cumulative_price_b: read_u128_le(bytes, 160)?,
        last_update_block: read_u64_le(bytes, 176)?,
    })
}

// ============ Vault Cell ============

pub fn vault_cell_size() -> usize {
    VAULT_CELL_SIZE
}

pub fn serialize_vault(data: &VaultCellData) -> Vec<u8> {
    let mut buf = Vec::with_capacity(VAULT_CELL_SIZE);
    write_bytes32(&mut buf, &data.owner);           // 0..32
    write_bytes32(&mut buf, &data.pool_id);          // 32..64
    write_u64_le(&mut buf, data.collateral_amount);  // 64..72
    write_u64_le(&mut buf, data.debt_shares);        // 72..80
    write_u64_le(&mut buf, data.deposit_shares);     // 80..88
    write_u64_le(&mut buf, data.last_accrual_block); // 88..96
    write_u64_le(&mut buf, data.health_factor);      // 96..104
    buf
}

pub fn deserialize_vault(bytes: &[u8]) -> Result<VaultCellData, SerdeError> {
    if bytes.len() < VAULT_CELL_SIZE {
        return Err(SerdeError::BufferTooShort {
            expected: VAULT_CELL_SIZE,
            actual: bytes.len(),
        });
    }
    if bytes.len() > VAULT_CELL_SIZE {
        return Err(SerdeError::BufferTooLong {
            expected: VAULT_CELL_SIZE,
            actual: bytes.len(),
        });
    }
    Ok(VaultCellData {
        owner: read_bytes32(bytes, 0)?,
        pool_id: read_bytes32(bytes, 32)?,
        collateral_amount: read_u64_le(bytes, 64)?,
        debt_shares: read_u64_le(bytes, 72)?,
        deposit_shares: read_u64_le(bytes, 80)?,
        last_accrual_block: read_u64_le(bytes, 88)?,
        health_factor: read_u64_le(bytes, 96)?,
    })
}

// ============ Oracle Cell ============

pub fn oracle_cell_size() -> usize {
    ORACLE_CELL_SIZE
}

pub fn serialize_oracle(data: &OracleCellData) -> Vec<u8> {
    let mut buf = Vec::with_capacity(ORACLE_CELL_SIZE);
    write_bytes32(&mut buf, &data.oracle_id);    // 0..32
    write_u64_le(&mut buf, data.price);          // 32..40
    write_u32_le(&mut buf, data.confidence);     // 40..44
    write_u64_le(&mut buf, data.timestamp);      // 44..52
    write_u64_le(&mut buf, data.block_height);   // 52..60
    write_u32_le(&mut buf, data.source_count);   // 60..64
    write_u64_le(&mut buf, data.twap_price);     // 64..72
    write_u32_le(&mut buf, data.volatility_bps); // 72..76
    buf
}

pub fn deserialize_oracle(bytes: &[u8]) -> Result<OracleCellData, SerdeError> {
    if bytes.len() < ORACLE_CELL_SIZE {
        return Err(SerdeError::BufferTooShort {
            expected: ORACLE_CELL_SIZE,
            actual: bytes.len(),
        });
    }
    if bytes.len() > ORACLE_CELL_SIZE {
        return Err(SerdeError::BufferTooLong {
            expected: ORACLE_CELL_SIZE,
            actual: bytes.len(),
        });
    }
    Ok(OracleCellData {
        oracle_id: read_bytes32(bytes, 0)?,
        price: read_u64_le(bytes, 32)?,
        confidence: read_u32_le(bytes, 40)?,
        timestamp: read_u64_le(bytes, 44)?,
        block_height: read_u64_le(bytes, 52)?,
        source_count: read_u32_le(bytes, 60)?,
        twap_price: read_u64_le(bytes, 64)?,
        volatility_bps: read_u32_le(bytes, 72)?,
    })
}

// ============ Governance Cell ============

pub fn governance_cell_size() -> usize {
    GOVERNANCE_CELL_SIZE
}

pub fn serialize_governance(data: &GovernanceCellData) -> Vec<u8> {
    let mut buf = Vec::with_capacity(GOVERNANCE_CELL_SIZE);
    write_u64_le(&mut buf, data.proposal_id);    // 0..8
    write_bytes32(&mut buf, &data.proposer);     // 8..40
    write_u64_le(&mut buf, data.start_block);    // 40..48
    write_u64_le(&mut buf, data.end_block);      // 48..56
    write_u64_le(&mut buf, data.for_votes);      // 56..64
    write_u64_le(&mut buf, data.against_votes);  // 64..72
    write_u64_le(&mut buf, data.quorum);         // 72..80
    write_u8(&mut buf, data.status);             // 80
    write_bytes32(&mut buf, &data.action_hash);  // 81..113
    buf
}

pub fn deserialize_governance(bytes: &[u8]) -> Result<GovernanceCellData, SerdeError> {
    if bytes.len() < GOVERNANCE_CELL_SIZE {
        return Err(SerdeError::BufferTooShort {
            expected: GOVERNANCE_CELL_SIZE,
            actual: bytes.len(),
        });
    }
    if bytes.len() > GOVERNANCE_CELL_SIZE {
        return Err(SerdeError::BufferTooLong {
            expected: GOVERNANCE_CELL_SIZE,
            actual: bytes.len(),
        });
    }
    let status = read_u8(bytes, 80)?;
    if status > 4 {
        return Err(SerdeError::InvalidStatus(status));
    }
    Ok(GovernanceCellData {
        proposal_id: read_u64_le(bytes, 0)?,
        proposer: read_bytes32(bytes, 8)?,
        start_block: read_u64_le(bytes, 40)?,
        end_block: read_u64_le(bytes, 48)?,
        for_votes: read_u64_le(bytes, 56)?,
        against_votes: read_u64_le(bytes, 64)?,
        quorum: read_u64_le(bytes, 72)?,
        status,
        action_hash: read_bytes32(bytes, 81)?,
    })
}

// ============ Stake Cell ============

pub fn stake_cell_size() -> usize {
    STAKE_CELL_SIZE
}

pub fn serialize_stake(data: &StakeCellData) -> Vec<u8> {
    let mut buf = Vec::with_capacity(STAKE_CELL_SIZE);
    write_bytes32(&mut buf, &data.staker);            // 0..32
    write_u64_le(&mut buf, data.amount);              // 32..40
    write_u64_le(&mut buf, data.lock_start);          // 40..48
    write_u64_le(&mut buf, data.lock_end);            // 48..56
    write_u64_le(&mut buf, data.voting_power);        // 56..64
    write_u64_le(&mut buf, data.reward_debt);         // 64..72
    write_u64_le(&mut buf, data.accumulated_reward);  // 72..80
    // delegate: None encoded as [0u8; 32]
    let delegate_bytes = data.delegate.unwrap_or([0u8; 32]);
    write_bytes32(&mut buf, &delegate_bytes);         // 80..112
    buf
}

pub fn deserialize_stake(bytes: &[u8]) -> Result<StakeCellData, SerdeError> {
    if bytes.len() < STAKE_CELL_SIZE {
        return Err(SerdeError::BufferTooShort {
            expected: STAKE_CELL_SIZE,
            actual: bytes.len(),
        });
    }
    if bytes.len() > STAKE_CELL_SIZE {
        return Err(SerdeError::BufferTooLong {
            expected: STAKE_CELL_SIZE,
            actual: bytes.len(),
        });
    }
    let delegate_raw = read_bytes32(bytes, 80)?;
    let delegate = if delegate_raw == [0u8; 32] {
        None
    } else {
        Some(delegate_raw)
    };
    Ok(StakeCellData {
        staker: read_bytes32(bytes, 0)?,
        amount: read_u64_le(bytes, 32)?,
        lock_start: read_u64_le(bytes, 40)?,
        lock_end: read_u64_le(bytes, 48)?,
        voting_power: read_u64_le(bytes, 56)?,
        reward_debt: read_u64_le(bytes, 64)?,
        accumulated_reward: read_u64_le(bytes, 72)?,
        delegate,
    })
}

// ============ Batch Cell ============

pub fn batch_cell_size() -> usize {
    BATCH_CELL_SIZE
}

pub fn serialize_batch(data: &BatchCellData) -> Vec<u8> {
    let mut buf = Vec::with_capacity(BATCH_CELL_SIZE);
    write_u64_le(&mut buf, data.batch_id);       // 0..8
    write_bytes32(&mut buf, &data.pool_id);      // 8..40
    write_u8(&mut buf, data.phase);              // 40
    write_u64_le(&mut buf, data.start_time);     // 41..49
    write_u32_le(&mut buf, data.commit_count);   // 49..53
    write_u32_le(&mut buf, data.reveal_count);   // 53..57
    write_u64_le(&mut buf, data.total_deposits); // 57..65
    write_u64_le(&mut buf, data.clearing_price); // 65..73
    buf
}

pub fn deserialize_batch(bytes: &[u8]) -> Result<BatchCellData, SerdeError> {
    if bytes.len() < BATCH_CELL_SIZE {
        return Err(SerdeError::BufferTooShort {
            expected: BATCH_CELL_SIZE,
            actual: bytes.len(),
        });
    }
    if bytes.len() > BATCH_CELL_SIZE {
        return Err(SerdeError::BufferTooLong {
            expected: BATCH_CELL_SIZE,
            actual: bytes.len(),
        });
    }
    let phase = read_u8(bytes, 40)?;
    if phase > 3 {
        return Err(SerdeError::InvalidPhase(phase));
    }
    Ok(BatchCellData {
        batch_id: read_u64_le(bytes, 0)?,
        pool_id: read_bytes32(bytes, 8)?,
        phase,
        start_time: read_u64_le(bytes, 41)?,
        commit_count: read_u32_le(bytes, 49)?,
        reveal_count: read_u32_le(bytes, 53)?,
        total_deposits: read_u64_le(bytes, 57)?,
        clearing_price: read_u64_le(bytes, 65)?,
    })
}

// ============ Commit Cell ============

pub fn commit_cell_size() -> usize {
    COMMIT_CELL_SIZE
}

pub fn serialize_commit(data: &CommitCellData) -> Vec<u8> {
    let mut buf = Vec::with_capacity(COMMIT_CELL_SIZE);
    write_bytes32(&mut buf, &data.commit_hash);    // 0..32
    write_bytes32(&mut buf, &data.depositor);      // 32..64
    write_u64_le(&mut buf, data.deposit_amount);   // 64..72
    write_u64_le(&mut buf, data.batch_id);         // 72..80
    write_u64_le(&mut buf, data.timestamp);        // 80..88
    buf
}

pub fn deserialize_commit(bytes: &[u8]) -> Result<CommitCellData, SerdeError> {
    if bytes.len() < COMMIT_CELL_SIZE {
        return Err(SerdeError::BufferTooShort {
            expected: COMMIT_CELL_SIZE,
            actual: bytes.len(),
        });
    }
    if bytes.len() > COMMIT_CELL_SIZE {
        return Err(SerdeError::BufferTooLong {
            expected: COMMIT_CELL_SIZE,
            actual: bytes.len(),
        });
    }
    Ok(CommitCellData {
        commit_hash: read_bytes32(bytes, 0)?,
        depositor: read_bytes32(bytes, 32)?,
        deposit_amount: read_u64_le(bytes, 64)?,
        batch_id: read_u64_le(bytes, 72)?,
        timestamp: read_u64_le(bytes, 80)?,
    })
}

// ============ Escrow Cell ============

pub fn escrow_cell_size() -> usize {
    ESCROW_CELL_SIZE
}

pub fn serialize_escrow(data: &EscrowCellData) -> Vec<u8> {
    let mut buf = Vec::with_capacity(ESCROW_CELL_SIZE);
    write_u64_le(&mut buf, data.escrow_id);    // 0..8
    write_bytes32(&mut buf, &data.depositor);  // 8..40
    write_bytes32(&mut buf, &data.recipient);  // 40..72
    write_u64_le(&mut buf, data.amount);       // 72..80
    write_bytes32(&mut buf, &data.hash_lock);  // 80..112
    write_u64_le(&mut buf, data.deadline);     // 112..120
    write_u8(&mut buf, data.status);           // 120
    buf
}

pub fn deserialize_escrow(bytes: &[u8]) -> Result<EscrowCellData, SerdeError> {
    if bytes.len() < ESCROW_CELL_SIZE {
        return Err(SerdeError::BufferTooShort {
            expected: ESCROW_CELL_SIZE,
            actual: bytes.len(),
        });
    }
    if bytes.len() > ESCROW_CELL_SIZE {
        return Err(SerdeError::BufferTooLong {
            expected: ESCROW_CELL_SIZE,
            actual: bytes.len(),
        });
    }
    let status = read_u8(bytes, 120)?;
    if status > 2 {
        return Err(SerdeError::InvalidStatus(status));
    }
    Ok(EscrowCellData {
        escrow_id: read_u64_le(bytes, 0)?,
        depositor: read_bytes32(bytes, 8)?,
        recipient: read_bytes32(bytes, 40)?,
        amount: read_u64_le(bytes, 72)?,
        hash_lock: read_bytes32(bytes, 80)?,
        deadline: read_u64_le(bytes, 112)?,
        status,
    })
}

// ============ Checksums & Validation ============

/// Compute checksum as first 4 bytes of SHA-256 hash
pub fn compute_checksum(data: &[u8]) -> [u8; 4] {
    let hash = Sha256::digest(data);
    let mut out = [0u8; 4];
    out.copy_from_slice(&hash[..4]);
    out
}

/// Validate pool cell data — non-zero pool_id, reasonable fee values
pub fn validate_pool(data: &PoolCellData) -> Result<(), SerdeError> {
    if data.pool_id == [0u8; 32] {
        return Err(SerdeError::ZeroPoolId);
    }
    if data.fee_rate_bps > 10_000 {
        return Err(SerdeError::InvalidFieldValue);
    }
    if data.protocol_fee_bps > 10_000 {
        return Err(SerdeError::InvalidFieldValue);
    }
    // k_last should be consistent if reserves are set
    if data.reserve_a > 0 && data.reserve_b > 0 {
        let product = (data.reserve_a as u128).checked_mul(data.reserve_b as u128);
        if product.is_none() {
            return Err(SerdeError::Overflow);
        }
    }
    Ok(())
}

/// Validate vault cell data
pub fn validate_vault(data: &VaultCellData) -> Result<(), SerdeError> {
    if data.pool_id == [0u8; 32] {
        return Err(SerdeError::ZeroPoolId);
    }
    if data.owner == [0u8; 32] {
        return Err(SerdeError::InvalidFieldValue);
    }
    Ok(())
}

/// Validate oracle cell data — confidence must be <= 10000 bps
pub fn validate_oracle(data: &OracleCellData) -> Result<(), SerdeError> {
    if data.confidence > 10_000 {
        return Err(SerdeError::InvalidFieldValue);
    }
    if data.volatility_bps > 10_000 {
        return Err(SerdeError::InvalidFieldValue);
    }
    if data.source_count == 0 {
        return Err(SerdeError::InvalidFieldValue);
    }
    Ok(())
}

// ============ Capacity Calculation ============

/// CKB minimum capacity formula: (data_size + 33 + 8) * 100_000_000 shannons
/// 33 = minimum lock script size, 8 = capacity field itself
pub fn minimum_capacity(data_size: usize) -> u64 {
    let total = data_size + CELL_OVERHEAD;
    (total as u64).saturating_mul(SHANNONS_PER_CKB)
}

pub fn pool_minimum_capacity() -> u64 {
    minimum_capacity(POOL_CELL_SIZE)
}

pub fn vault_minimum_capacity() -> u64 {
    minimum_capacity(VAULT_CELL_SIZE)
}

// ============ Cell Type Detection ============

/// Guess cell type from byte length. Returns None if length doesn't match any known type.
/// Note: some sizes could theoretically collide; this is a best-effort heuristic.
pub fn detect_cell_type(bytes: &[u8]) -> Option<&'static str> {
    match bytes.len() {
        POOL_CELL_SIZE => Some("Pool"),
        VAULT_CELL_SIZE => Some("Vault"),
        ORACLE_CELL_SIZE => Some("Oracle"),
        GOVERNANCE_CELL_SIZE => Some("Governance"),
        STAKE_CELL_SIZE => Some("Stake"),
        BATCH_CELL_SIZE => Some("Batch"),
        COMMIT_CELL_SIZE => Some("Commit"),
        ESCROW_CELL_SIZE => Some("Escrow"),
        _ => None,
    }
}

/// Return all cell type names and their sizes
pub fn cell_type_sizes() -> Vec<(&'static str, usize)> {
    vec![
        ("Batch", BATCH_CELL_SIZE),
        ("Commit", COMMIT_CELL_SIZE),
        ("Escrow", ESCROW_CELL_SIZE),
        ("Governance", GOVERNANCE_CELL_SIZE),
        ("Oracle", ORACLE_CELL_SIZE),
        ("Pool", POOL_CELL_SIZE),
        ("Stake", STAKE_CELL_SIZE),
        ("Vault", VAULT_CELL_SIZE),
    ]
}

// ============ Roundtrip Verification ============

/// Serialize then deserialize a PoolCellData and check equality
pub fn roundtrip_verify_pool(data: &PoolCellData) -> bool {
    let bytes = serialize_pool(data);
    match deserialize_pool(&bytes) {
        Ok(recovered) => recovered == *data,
        Err(_) => false,
    }
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // ============ Test Helpers ============

    fn sample_pool_id() -> [u8; 32] {
        let mut id = [0u8; 32];
        id[0] = 0xAA;
        id[31] = 0xBB;
        id
    }

    fn sample_bytes32(fill: u8) -> [u8; 32] {
        [fill; 32]
    }

    fn all_ones_bytes32() -> [u8; 32] {
        [0xFF; 32]
    }

    fn zero_bytes32() -> [u8; 32] {
        [0u8; 32]
    }

    fn sample_pool() -> PoolCellData {
        PoolCellData {
            pool_id: sample_pool_id(),
            token_a: sample_bytes32(0x11),
            token_b: sample_bytes32(0x22),
            reserve_a: 1_000_000,
            reserve_b: 2_000_000,
            total_lp: 1_414_213,
            fee_rate_bps: 30,
            protocol_fee_bps: 5,
            k_last: 2_000_000_000_000,
            cumulative_price_a: 100_000_000_000_000_000,
            cumulative_price_b: 200_000_000_000_000_000,
            last_update_block: 12345,
        }
    }

    fn sample_vault() -> VaultCellData {
        VaultCellData {
            owner: sample_bytes32(0x01),
            pool_id: sample_pool_id(),
            collateral_amount: 5_000_000,
            debt_shares: 1_000_000,
            deposit_shares: 3_000_000,
            last_accrual_block: 9999,
            health_factor: 150_000_000, // 1.5 scaled by 1e8
        }
    }

    fn sample_oracle() -> OracleCellData {
        OracleCellData {
            oracle_id: sample_bytes32(0x0A),
            price: 3_500_000_000_00, // $3500.00 scaled by 1e8
            confidence: 9500,
            timestamp: 1700000000,
            block_height: 50000,
            source_count: 5,
            twap_price: 3_490_000_000_00,
            volatility_bps: 250,
        }
    }

    fn sample_governance() -> GovernanceCellData {
        GovernanceCellData {
            proposal_id: 42,
            proposer: sample_bytes32(0x33),
            start_block: 100_000,
            end_block: 200_000,
            for_votes: 1_000_000,
            against_votes: 500_000,
            quorum: 750_000,
            status: 1, // Active
            action_hash: sample_bytes32(0x44),
        }
    }

    fn sample_stake() -> StakeCellData {
        StakeCellData {
            staker: sample_bytes32(0x55),
            amount: 10_000_000,
            lock_start: 1700000000,
            lock_end: 1700000000 + 86400 * 365,
            voting_power: 20_000_000,
            reward_debt: 500_000,
            accumulated_reward: 100_000,
            delegate: Some(sample_bytes32(0x66)),
        }
    }

    fn sample_batch() -> BatchCellData {
        BatchCellData {
            batch_id: 1001,
            pool_id: sample_pool_id(),
            phase: 0,
            start_time: 1700000000,
            commit_count: 15,
            reveal_count: 12,
            total_deposits: 50_000_000,
            clearing_price: 3_500_000_000,
        }
    }

    fn sample_commit() -> CommitCellData {
        CommitCellData {
            commit_hash: sample_bytes32(0x77),
            depositor: sample_bytes32(0x88),
            deposit_amount: 1_000_000,
            batch_id: 1001,
            timestamp: 1700000000,
        }
    }

    fn sample_escrow() -> EscrowCellData {
        EscrowCellData {
            escrow_id: 500,
            depositor: sample_bytes32(0x99),
            recipient: sample_bytes32(0xAA),
            amount: 2_000_000,
            hash_lock: sample_bytes32(0xBB),
            deadline: 1700086400,
            status: 0, // Active
        }
    }

    // ============ Primitive Helper Tests ============

    #[test]
    fn test_write_read_u8() {
        let mut buf = Vec::new();
        write_u8(&mut buf, 0);
        write_u8(&mut buf, 127);
        write_u8(&mut buf, 255);
        assert_eq!(read_u8(&buf, 0).unwrap(), 0);
        assert_eq!(read_u8(&buf, 1).unwrap(), 127);
        assert_eq!(read_u8(&buf, 2).unwrap(), 255);
    }

    #[test]
    fn test_read_u8_out_of_bounds() {
        let buf = vec![0x42];
        assert_eq!(
            read_u8(&buf, 1),
            Err(SerdeError::BufferTooShort { expected: 2, actual: 1 })
        );
    }

    #[test]
    fn test_read_u8_empty_buffer() {
        let buf: Vec<u8> = vec![];
        assert_eq!(
            read_u8(&buf, 0),
            Err(SerdeError::BufferTooShort { expected: 1, actual: 0 })
        );
    }

    #[test]
    fn test_write_read_u32_le() {
        let mut buf = Vec::new();
        write_u32_le(&mut buf, 0x01020304);
        assert_eq!(buf, vec![0x04, 0x03, 0x02, 0x01]); // little-endian
        assert_eq!(read_u32_le(&buf, 0).unwrap(), 0x01020304);
    }

    #[test]
    fn test_write_read_u32_le_zero() {
        let mut buf = Vec::new();
        write_u32_le(&mut buf, 0);
        assert_eq!(read_u32_le(&buf, 0).unwrap(), 0);
    }

    #[test]
    fn test_write_read_u32_le_max() {
        let mut buf = Vec::new();
        write_u32_le(&mut buf, u32::MAX);
        assert_eq!(read_u32_le(&buf, 0).unwrap(), u32::MAX);
    }

    #[test]
    fn test_read_u32_le_too_short() {
        let buf = vec![0x01, 0x02, 0x03];
        assert_eq!(
            read_u32_le(&buf, 0),
            Err(SerdeError::BufferTooShort { expected: 4, actual: 3 })
        );
    }

    #[test]
    fn test_read_u32_le_offset_too_far() {
        let buf = vec![0x01, 0x02, 0x03, 0x04, 0x05];
        assert_eq!(
            read_u32_le(&buf, 3),
            Err(SerdeError::BufferTooShort { expected: 7, actual: 5 })
        );
    }

    #[test]
    fn test_write_read_u64_le() {
        let mut buf = Vec::new();
        write_u64_le(&mut buf, 0x0102030405060708);
        assert_eq!(buf, vec![0x08, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01]);
        assert_eq!(read_u64_le(&buf, 0).unwrap(), 0x0102030405060708);
    }

    #[test]
    fn test_write_read_u64_le_zero() {
        let mut buf = Vec::new();
        write_u64_le(&mut buf, 0);
        assert_eq!(read_u64_le(&buf, 0).unwrap(), 0);
    }

    #[test]
    fn test_write_read_u64_le_max() {
        let mut buf = Vec::new();
        write_u64_le(&mut buf, u64::MAX);
        assert_eq!(read_u64_le(&buf, 0).unwrap(), u64::MAX);
    }

    #[test]
    fn test_read_u64_le_too_short() {
        let buf = vec![0u8; 7];
        assert_eq!(
            read_u64_le(&buf, 0),
            Err(SerdeError::BufferTooShort { expected: 8, actual: 7 })
        );
    }

    #[test]
    fn test_write_read_u128_le() {
        let mut buf = Vec::new();
        let val: u128 = 0x0102030405060708090A0B0C0D0E0F10;
        write_u128_le(&mut buf, val);
        assert_eq!(buf.len(), 16);
        assert_eq!(buf[0], 0x10); // least significant byte first
        assert_eq!(read_u128_le(&buf, 0).unwrap(), val);
    }

    #[test]
    fn test_write_read_u128_le_zero() {
        let mut buf = Vec::new();
        write_u128_le(&mut buf, 0);
        assert_eq!(read_u128_le(&buf, 0).unwrap(), 0);
    }

    #[test]
    fn test_write_read_u128_le_max() {
        let mut buf = Vec::new();
        write_u128_le(&mut buf, u128::MAX);
        assert_eq!(read_u128_le(&buf, 0).unwrap(), u128::MAX);
    }

    #[test]
    fn test_read_u128_le_too_short() {
        let buf = vec![0u8; 15];
        assert_eq!(
            read_u128_le(&buf, 0),
            Err(SerdeError::BufferTooShort { expected: 16, actual: 15 })
        );
    }

    #[test]
    fn test_write_read_bytes32() {
        let mut buf = Vec::new();
        let val = sample_bytes32(0xAB);
        write_bytes32(&mut buf, &val);
        assert_eq!(buf.len(), 32);
        assert_eq!(read_bytes32(&buf, 0).unwrap(), val);
    }

    #[test]
    fn test_write_read_bytes32_zeros() {
        let mut buf = Vec::new();
        let val = zero_bytes32();
        write_bytes32(&mut buf, &val);
        assert_eq!(read_bytes32(&buf, 0).unwrap(), val);
    }

    #[test]
    fn test_write_read_bytes32_ones() {
        let mut buf = Vec::new();
        let val = all_ones_bytes32();
        write_bytes32(&mut buf, &val);
        assert_eq!(read_bytes32(&buf, 0).unwrap(), val);
    }

    #[test]
    fn test_read_bytes32_too_short() {
        let buf = vec![0u8; 31];
        assert_eq!(
            read_bytes32(&buf, 0),
            Err(SerdeError::BufferTooShort { expected: 32, actual: 31 })
        );
    }

    #[test]
    fn test_read_bytes32_offset() {
        let mut buf = vec![0u8; 40];
        buf[8..40].copy_from_slice(&[0xCC; 32]);
        assert_eq!(read_bytes32(&buf, 8).unwrap(), [0xCC; 32]);
    }

    #[test]
    fn test_multiple_writes_sequential() {
        let mut buf = Vec::new();
        write_u8(&mut buf, 0x01);
        write_u32_le(&mut buf, 0x02030405);
        write_u64_le(&mut buf, 0x060708090A0B0C0D);
        assert_eq!(buf.len(), 1 + 4 + 8);
        assert_eq!(read_u8(&buf, 0).unwrap(), 0x01);
        assert_eq!(read_u32_le(&buf, 1).unwrap(), 0x02030405);
        assert_eq!(read_u64_le(&buf, 5).unwrap(), 0x060708090A0B0C0D);
    }

    // ============ Pool Cell Tests ============

    #[test]
    fn test_pool_cell_size() {
        assert_eq!(pool_cell_size(), 184);
    }

    #[test]
    fn test_pool_roundtrip() {
        let data = sample_pool();
        let bytes = serialize_pool(&data);
        assert_eq!(bytes.len(), POOL_CELL_SIZE);
        let recovered = deserialize_pool(&bytes).unwrap();
        assert_eq!(recovered, data);
    }

    #[test]
    fn test_pool_roundtrip_zeros() {
        let data = PoolCellData {
            pool_id: sample_pool_id(), // non-zero so it's valid
            token_a: zero_bytes32(),
            token_b: zero_bytes32(),
            reserve_a: 0,
            reserve_b: 0,
            total_lp: 0,
            fee_rate_bps: 0,
            protocol_fee_bps: 0,
            k_last: 0,
            cumulative_price_a: 0,
            cumulative_price_b: 0,
            last_update_block: 0,
        };
        let bytes = serialize_pool(&data);
        assert_eq!(deserialize_pool(&bytes).unwrap(), data);
    }

    #[test]
    fn test_pool_roundtrip_max_values() {
        let data = PoolCellData {
            pool_id: all_ones_bytes32(),
            token_a: all_ones_bytes32(),
            token_b: all_ones_bytes32(),
            reserve_a: u64::MAX,
            reserve_b: u64::MAX,
            total_lp: u64::MAX,
            fee_rate_bps: u32::MAX,
            protocol_fee_bps: u32::MAX,
            k_last: u128::MAX,
            cumulative_price_a: u128::MAX,
            cumulative_price_b: u128::MAX,
            last_update_block: u64::MAX,
        };
        let bytes = serialize_pool(&data);
        assert_eq!(deserialize_pool(&bytes).unwrap(), data);
    }

    #[test]
    fn test_pool_deserialize_too_short() {
        let buf = vec![0u8; 183];
        assert_eq!(
            deserialize_pool(&buf),
            Err(SerdeError::BufferTooShort { expected: 184, actual: 183 })
        );
    }

    #[test]
    fn test_pool_deserialize_too_long() {
        let buf = vec![0u8; 185];
        assert_eq!(
            deserialize_pool(&buf),
            Err(SerdeError::BufferTooLong { expected: 184, actual: 185 })
        );
    }

    #[test]
    fn test_pool_deserialize_empty() {
        let buf: Vec<u8> = vec![];
        assert_eq!(
            deserialize_pool(&buf),
            Err(SerdeError::BufferTooShort { expected: 184, actual: 0 })
        );
    }

    #[test]
    fn test_pool_le_byte_order() {
        let data = sample_pool();
        let bytes = serialize_pool(&data);
        // reserve_a = 1_000_000 = 0x000F4240
        let reserve_a_bytes = &bytes[96..104];
        assert_eq!(reserve_a_bytes[0], 0x40); // LSB first
        assert_eq!(reserve_a_bytes[1], 0x42);
        assert_eq!(reserve_a_bytes[2], 0x0F);
        assert_eq!(reserve_a_bytes[3], 0x00);
    }

    #[test]
    fn test_pool_serialize_deterministic() {
        let data = sample_pool();
        let bytes1 = serialize_pool(&data);
        let bytes2 = serialize_pool(&data);
        assert_eq!(bytes1, bytes2);
    }

    #[test]
    fn test_pool_field_positions() {
        let data = sample_pool();
        let bytes = serialize_pool(&data);
        // pool_id at offset 0
        assert_eq!(&bytes[0..32], &data.pool_id);
        // token_a at offset 32
        assert_eq!(&bytes[32..64], &data.token_a);
        // token_b at offset 64
        assert_eq!(&bytes[64..96], &data.token_b);
        // last_update_block at offset 176
        let block = u64::from_le_bytes(bytes[176..184].try_into().unwrap());
        assert_eq!(block, data.last_update_block);
    }

    #[test]
    fn test_roundtrip_verify_pool_true() {
        let data = sample_pool();
        assert!(roundtrip_verify_pool(&data));
    }

    #[test]
    fn test_roundtrip_verify_pool_max() {
        let data = PoolCellData {
            pool_id: all_ones_bytes32(),
            token_a: all_ones_bytes32(),
            token_b: all_ones_bytes32(),
            reserve_a: u64::MAX,
            reserve_b: u64::MAX,
            total_lp: u64::MAX,
            fee_rate_bps: u32::MAX,
            protocol_fee_bps: u32::MAX,
            k_last: u128::MAX,
            cumulative_price_a: u128::MAX,
            cumulative_price_b: u128::MAX,
            last_update_block: u64::MAX,
        };
        assert!(roundtrip_verify_pool(&data));
    }

    // ============ Vault Cell Tests ============

    #[test]
    fn test_vault_cell_size() {
        assert_eq!(vault_cell_size(), 104);
    }

    #[test]
    fn test_vault_roundtrip() {
        let data = sample_vault();
        let bytes = serialize_vault(&data);
        assert_eq!(bytes.len(), VAULT_CELL_SIZE);
        let recovered = deserialize_vault(&bytes).unwrap();
        assert_eq!(recovered, data);
    }

    #[test]
    fn test_vault_roundtrip_zeros() {
        let data = VaultCellData {
            owner: zero_bytes32(),
            pool_id: zero_bytes32(),
            collateral_amount: 0,
            debt_shares: 0,
            deposit_shares: 0,
            last_accrual_block: 0,
            health_factor: 0,
        };
        let bytes = serialize_vault(&data);
        assert_eq!(deserialize_vault(&bytes).unwrap(), data);
    }

    #[test]
    fn test_vault_roundtrip_max() {
        let data = VaultCellData {
            owner: all_ones_bytes32(),
            pool_id: all_ones_bytes32(),
            collateral_amount: u64::MAX,
            debt_shares: u64::MAX,
            deposit_shares: u64::MAX,
            last_accrual_block: u64::MAX,
            health_factor: u64::MAX,
        };
        let bytes = serialize_vault(&data);
        assert_eq!(deserialize_vault(&bytes).unwrap(), data);
    }

    #[test]
    fn test_vault_deserialize_too_short() {
        let buf = vec![0u8; 103];
        assert_eq!(
            deserialize_vault(&buf),
            Err(SerdeError::BufferTooShort { expected: 104, actual: 103 })
        );
    }

    #[test]
    fn test_vault_deserialize_too_long() {
        let buf = vec![0u8; 105];
        assert_eq!(
            deserialize_vault(&buf),
            Err(SerdeError::BufferTooLong { expected: 104, actual: 105 })
        );
    }

    #[test]
    fn test_vault_le_byte_order() {
        let data = sample_vault();
        let bytes = serialize_vault(&data);
        // health_factor = 150_000_000 = 0x08F0D180
        let hf_bytes = &bytes[96..104];
        assert_eq!(hf_bytes[0], 0x80);
        assert_eq!(hf_bytes[1], 0xD1);
        assert_eq!(hf_bytes[2], 0xF0);
        assert_eq!(hf_bytes[3], 0x08);
    }

    #[test]
    fn test_vault_field_positions() {
        let data = sample_vault();
        let bytes = serialize_vault(&data);
        assert_eq!(&bytes[0..32], &data.owner);
        assert_eq!(&bytes[32..64], &data.pool_id);
        let collateral = u64::from_le_bytes(bytes[64..72].try_into().unwrap());
        assert_eq!(collateral, data.collateral_amount);
    }

    // ============ Oracle Cell Tests ============

    #[test]
    fn test_oracle_cell_size() {
        assert_eq!(oracle_cell_size(), 76);
    }

    #[test]
    fn test_oracle_roundtrip() {
        let data = sample_oracle();
        let bytes = serialize_oracle(&data);
        assert_eq!(bytes.len(), ORACLE_CELL_SIZE);
        let recovered = deserialize_oracle(&bytes).unwrap();
        assert_eq!(recovered, data);
    }

    #[test]
    fn test_oracle_roundtrip_zeros() {
        let data = OracleCellData {
            oracle_id: zero_bytes32(),
            price: 0,
            confidence: 0,
            timestamp: 0,
            block_height: 0,
            source_count: 0,
            twap_price: 0,
            volatility_bps: 0,
        };
        let bytes = serialize_oracle(&data);
        assert_eq!(deserialize_oracle(&bytes).unwrap(), data);
    }

    #[test]
    fn test_oracle_roundtrip_max() {
        let data = OracleCellData {
            oracle_id: all_ones_bytes32(),
            price: u64::MAX,
            confidence: u32::MAX,
            timestamp: u64::MAX,
            block_height: u64::MAX,
            source_count: u32::MAX,
            twap_price: u64::MAX,
            volatility_bps: u32::MAX,
        };
        let bytes = serialize_oracle(&data);
        assert_eq!(deserialize_oracle(&bytes).unwrap(), data);
    }

    #[test]
    fn test_oracle_deserialize_too_short() {
        let buf = vec![0u8; 75];
        assert_eq!(
            deserialize_oracle(&buf),
            Err(SerdeError::BufferTooShort { expected: 76, actual: 75 })
        );
    }

    #[test]
    fn test_oracle_deserialize_too_long() {
        let buf = vec![0u8; 77];
        assert_eq!(
            deserialize_oracle(&buf),
            Err(SerdeError::BufferTooLong { expected: 76, actual: 77 })
        );
    }

    #[test]
    fn test_oracle_le_byte_order() {
        let data = sample_oracle();
        let bytes = serialize_oracle(&data);
        // confidence = 9500 = 0x0000251C
        let conf_bytes = &bytes[40..44];
        assert_eq!(conf_bytes[0], 0x1C);
        assert_eq!(conf_bytes[1], 0x25);
        assert_eq!(conf_bytes[2], 0x00);
        assert_eq!(conf_bytes[3], 0x00);
    }

    #[test]
    fn test_oracle_field_positions() {
        let data = sample_oracle();
        let bytes = serialize_oracle(&data);
        assert_eq!(&bytes[0..32], &data.oracle_id);
        let price = u64::from_le_bytes(bytes[32..40].try_into().unwrap());
        assert_eq!(price, data.price);
        let volatility = u32::from_le_bytes(bytes[72..76].try_into().unwrap());
        assert_eq!(volatility, data.volatility_bps);
    }

    // ============ Governance Cell Tests ============

    #[test]
    fn test_governance_cell_size() {
        assert_eq!(governance_cell_size(), 113);
    }

    #[test]
    fn test_governance_roundtrip() {
        let data = sample_governance();
        let bytes = serialize_governance(&data);
        assert_eq!(bytes.len(), GOVERNANCE_CELL_SIZE);
        let recovered = deserialize_governance(&bytes).unwrap();
        assert_eq!(recovered, data);
    }

    #[test]
    fn test_governance_roundtrip_all_statuses() {
        for status in 0..=4u8 {
            let data = GovernanceCellData {
                proposal_id: status as u64,
                proposer: sample_bytes32(status),
                start_block: 100,
                end_block: 200,
                for_votes: 1000,
                against_votes: 500,
                quorum: 750,
                status,
                action_hash: sample_bytes32(0xDD),
            };
            let bytes = serialize_governance(&data);
            let recovered = deserialize_governance(&bytes).unwrap();
            assert_eq!(recovered.status, status);
            assert_eq!(recovered, data);
        }
    }

    #[test]
    fn test_governance_invalid_status() {
        let data = GovernanceCellData {
            proposal_id: 1,
            proposer: sample_bytes32(0x01),
            start_block: 100,
            end_block: 200,
            for_votes: 1000,
            against_votes: 500,
            quorum: 750,
            status: 5, // invalid
            action_hash: sample_bytes32(0x02),
        };
        let bytes = serialize_governance(&data);
        assert_eq!(
            deserialize_governance(&bytes),
            Err(SerdeError::InvalidStatus(5))
        );
    }

    #[test]
    fn test_governance_invalid_status_max() {
        let data = GovernanceCellData {
            proposal_id: 1,
            proposer: sample_bytes32(0x01),
            start_block: 100,
            end_block: 200,
            for_votes: 0,
            against_votes: 0,
            quorum: 0,
            status: 255,
            action_hash: zero_bytes32(),
        };
        let bytes = serialize_governance(&data);
        assert_eq!(
            deserialize_governance(&bytes),
            Err(SerdeError::InvalidStatus(255))
        );
    }

    #[test]
    fn test_governance_roundtrip_max() {
        let data = GovernanceCellData {
            proposal_id: u64::MAX,
            proposer: all_ones_bytes32(),
            start_block: u64::MAX,
            end_block: u64::MAX,
            for_votes: u64::MAX,
            against_votes: u64::MAX,
            quorum: u64::MAX,
            status: 4, // max valid
            action_hash: all_ones_bytes32(),
        };
        let bytes = serialize_governance(&data);
        assert_eq!(deserialize_governance(&bytes).unwrap(), data);
    }

    #[test]
    fn test_governance_deserialize_too_short() {
        let buf = vec![0u8; 112];
        assert_eq!(
            deserialize_governance(&buf),
            Err(SerdeError::BufferTooShort { expected: 113, actual: 112 })
        );
    }

    #[test]
    fn test_governance_deserialize_too_long() {
        let buf = vec![0u8; 114];
        assert_eq!(
            deserialize_governance(&buf),
            Err(SerdeError::BufferTooLong { expected: 113, actual: 114 })
        );
    }

    #[test]
    fn test_governance_le_byte_order() {
        let data = sample_governance();
        let bytes = serialize_governance(&data);
        // proposal_id = 42 = 0x2A
        assert_eq!(bytes[0], 0x2A);
        assert_eq!(bytes[1], 0x00);
    }

    #[test]
    fn test_governance_status_pending() {
        let mut data = sample_governance();
        data.status = 0;
        let bytes = serialize_governance(&data);
        let recovered = deserialize_governance(&bytes).unwrap();
        assert_eq!(recovered.status, 0);
    }

    #[test]
    fn test_governance_status_executed() {
        let mut data = sample_governance();
        data.status = 4;
        let bytes = serialize_governance(&data);
        let recovered = deserialize_governance(&bytes).unwrap();
        assert_eq!(recovered.status, 4);
    }

    // ============ Stake Cell Tests ============

    #[test]
    fn test_stake_cell_size() {
        assert_eq!(stake_cell_size(), 112);
    }

    #[test]
    fn test_stake_roundtrip_with_delegate() {
        let data = sample_stake();
        assert!(data.delegate.is_some());
        let bytes = serialize_stake(&data);
        assert_eq!(bytes.len(), STAKE_CELL_SIZE);
        let recovered = deserialize_stake(&bytes).unwrap();
        assert_eq!(recovered, data);
    }

    #[test]
    fn test_stake_roundtrip_no_delegate() {
        let mut data = sample_stake();
        data.delegate = None;
        let bytes = serialize_stake(&data);
        assert_eq!(bytes.len(), STAKE_CELL_SIZE);
        let recovered = deserialize_stake(&bytes).unwrap();
        assert_eq!(recovered, data);
        assert!(recovered.delegate.is_none());
    }

    #[test]
    fn test_stake_delegate_none_encodes_as_zeros() {
        let mut data = sample_stake();
        data.delegate = None;
        let bytes = serialize_stake(&data);
        assert_eq!(&bytes[80..112], &[0u8; 32]);
    }

    #[test]
    fn test_stake_roundtrip_max() {
        let data = StakeCellData {
            staker: all_ones_bytes32(),
            amount: u64::MAX,
            lock_start: u64::MAX,
            lock_end: u64::MAX,
            voting_power: u64::MAX,
            reward_debt: u64::MAX,
            accumulated_reward: u64::MAX,
            delegate: Some(all_ones_bytes32()),
        };
        let bytes = serialize_stake(&data);
        assert_eq!(deserialize_stake(&bytes).unwrap(), data);
    }

    #[test]
    fn test_stake_roundtrip_zeros() {
        let data = StakeCellData {
            staker: zero_bytes32(),
            amount: 0,
            lock_start: 0,
            lock_end: 0,
            voting_power: 0,
            reward_debt: 0,
            accumulated_reward: 0,
            delegate: None,
        };
        let bytes = serialize_stake(&data);
        assert_eq!(deserialize_stake(&bytes).unwrap(), data);
    }

    #[test]
    fn test_stake_deserialize_too_short() {
        let buf = vec![0u8; 111];
        assert_eq!(
            deserialize_stake(&buf),
            Err(SerdeError::BufferTooShort { expected: 112, actual: 111 })
        );
    }

    #[test]
    fn test_stake_deserialize_too_long() {
        let buf = vec![0u8; 113];
        assert_eq!(
            deserialize_stake(&buf),
            Err(SerdeError::BufferTooLong { expected: 112, actual: 113 })
        );
    }

    #[test]
    fn test_stake_le_byte_order() {
        let data = sample_stake();
        let bytes = serialize_stake(&data);
        // amount = 10_000_000 = 0x00989680
        let amount_bytes = &bytes[32..40];
        assert_eq!(amount_bytes[0], 0x80);
        assert_eq!(amount_bytes[1], 0x96);
        assert_eq!(amount_bytes[2], 0x98);
        assert_eq!(amount_bytes[3], 0x00);
    }

    #[test]
    fn test_stake_field_positions() {
        let data = sample_stake();
        let bytes = serialize_stake(&data);
        assert_eq!(&bytes[0..32], &data.staker);
        let amount = u64::from_le_bytes(bytes[32..40].try_into().unwrap());
        assert_eq!(amount, data.amount);
    }

    // ============ Batch Cell Tests ============

    #[test]
    fn test_batch_cell_size() {
        assert_eq!(batch_cell_size(), 73);
    }

    #[test]
    fn test_batch_roundtrip() {
        let data = sample_batch();
        let bytes = serialize_batch(&data);
        assert_eq!(bytes.len(), BATCH_CELL_SIZE);
        let recovered = deserialize_batch(&bytes).unwrap();
        assert_eq!(recovered, data);
    }

    #[test]
    fn test_batch_roundtrip_all_phases() {
        for phase in 0..=3u8 {
            let data = BatchCellData {
                batch_id: phase as u64,
                pool_id: sample_pool_id(),
                phase,
                start_time: 1700000000,
                commit_count: 10,
                reveal_count: 8,
                total_deposits: 1_000_000,
                clearing_price: 5_000_000,
            };
            let bytes = serialize_batch(&data);
            let recovered = deserialize_batch(&bytes).unwrap();
            assert_eq!(recovered.phase, phase);
            assert_eq!(recovered, data);
        }
    }

    #[test]
    fn test_batch_invalid_phase() {
        let data = BatchCellData {
            batch_id: 1,
            pool_id: sample_pool_id(),
            phase: 4,
            start_time: 0,
            commit_count: 0,
            reveal_count: 0,
            total_deposits: 0,
            clearing_price: 0,
        };
        let bytes = serialize_batch(&data);
        assert_eq!(
            deserialize_batch(&bytes),
            Err(SerdeError::InvalidPhase(4))
        );
    }

    #[test]
    fn test_batch_invalid_phase_max() {
        let data = BatchCellData {
            batch_id: 1,
            pool_id: sample_pool_id(),
            phase: 255,
            start_time: 0,
            commit_count: 0,
            reveal_count: 0,
            total_deposits: 0,
            clearing_price: 0,
        };
        let bytes = serialize_batch(&data);
        assert_eq!(
            deserialize_batch(&bytes),
            Err(SerdeError::InvalidPhase(255))
        );
    }

    #[test]
    fn test_batch_roundtrip_max() {
        let data = BatchCellData {
            batch_id: u64::MAX,
            pool_id: all_ones_bytes32(),
            phase: 3, // max valid
            start_time: u64::MAX,
            commit_count: u32::MAX,
            reveal_count: u32::MAX,
            total_deposits: u64::MAX,
            clearing_price: u64::MAX,
        };
        let bytes = serialize_batch(&data);
        assert_eq!(deserialize_batch(&bytes).unwrap(), data);
    }

    #[test]
    fn test_batch_roundtrip_zeros() {
        let data = BatchCellData {
            batch_id: 0,
            pool_id: zero_bytes32(),
            phase: 0,
            start_time: 0,
            commit_count: 0,
            reveal_count: 0,
            total_deposits: 0,
            clearing_price: 0,
        };
        let bytes = serialize_batch(&data);
        assert_eq!(deserialize_batch(&bytes).unwrap(), data);
    }

    #[test]
    fn test_batch_deserialize_too_short() {
        let buf = vec![0u8; 72];
        assert_eq!(
            deserialize_batch(&buf),
            Err(SerdeError::BufferTooShort { expected: 73, actual: 72 })
        );
    }

    #[test]
    fn test_batch_deserialize_too_long() {
        let buf = vec![0u8; 74];
        assert_eq!(
            deserialize_batch(&buf),
            Err(SerdeError::BufferTooLong { expected: 73, actual: 74 })
        );
    }

    #[test]
    fn test_batch_le_byte_order() {
        let data = sample_batch();
        let bytes = serialize_batch(&data);
        // batch_id = 1001 = 0x03E9
        assert_eq!(bytes[0], 0xE9);
        assert_eq!(bytes[1], 0x03);
    }

    #[test]
    fn test_batch_phase_accepting() {
        let mut data = sample_batch();
        data.phase = 0;
        let bytes = serialize_batch(&data);
        let recovered = deserialize_batch(&bytes).unwrap();
        assert_eq!(recovered.phase, 0);
    }

    #[test]
    fn test_batch_phase_settled() {
        let mut data = sample_batch();
        data.phase = 3;
        let bytes = serialize_batch(&data);
        let recovered = deserialize_batch(&bytes).unwrap();
        assert_eq!(recovered.phase, 3);
    }

    // ============ Commit Cell Tests ============

    #[test]
    fn test_commit_cell_size() {
        assert_eq!(commit_cell_size(), 88);
    }

    #[test]
    fn test_commit_roundtrip() {
        let data = sample_commit();
        let bytes = serialize_commit(&data);
        assert_eq!(bytes.len(), COMMIT_CELL_SIZE);
        let recovered = deserialize_commit(&bytes).unwrap();
        assert_eq!(recovered, data);
    }

    #[test]
    fn test_commit_roundtrip_zeros() {
        let data = CommitCellData {
            commit_hash: zero_bytes32(),
            depositor: zero_bytes32(),
            deposit_amount: 0,
            batch_id: 0,
            timestamp: 0,
        };
        let bytes = serialize_commit(&data);
        assert_eq!(deserialize_commit(&bytes).unwrap(), data);
    }

    #[test]
    fn test_commit_roundtrip_max() {
        let data = CommitCellData {
            commit_hash: all_ones_bytes32(),
            depositor: all_ones_bytes32(),
            deposit_amount: u64::MAX,
            batch_id: u64::MAX,
            timestamp: u64::MAX,
        };
        let bytes = serialize_commit(&data);
        assert_eq!(deserialize_commit(&bytes).unwrap(), data);
    }

    #[test]
    fn test_commit_deserialize_too_short() {
        let buf = vec![0u8; 87];
        assert_eq!(
            deserialize_commit(&buf),
            Err(SerdeError::BufferTooShort { expected: 88, actual: 87 })
        );
    }

    #[test]
    fn test_commit_deserialize_too_long() {
        let buf = vec![0u8; 89];
        assert_eq!(
            deserialize_commit(&buf),
            Err(SerdeError::BufferTooLong { expected: 88, actual: 89 })
        );
    }

    #[test]
    fn test_commit_le_byte_order() {
        let data = sample_commit();
        let bytes = serialize_commit(&data);
        // deposit_amount = 1_000_000 = 0x000F4240
        let amount_bytes = &bytes[64..72];
        assert_eq!(amount_bytes[0], 0x40);
        assert_eq!(amount_bytes[1], 0x42);
        assert_eq!(amount_bytes[2], 0x0F);
    }

    #[test]
    fn test_commit_field_positions() {
        let data = sample_commit();
        let bytes = serialize_commit(&data);
        assert_eq!(&bytes[0..32], &data.commit_hash);
        assert_eq!(&bytes[32..64], &data.depositor);
        let batch_id = u64::from_le_bytes(bytes[72..80].try_into().unwrap());
        assert_eq!(batch_id, data.batch_id);
    }

    // ============ Escrow Cell Tests ============

    #[test]
    fn test_escrow_cell_size() {
        assert_eq!(escrow_cell_size(), 121);
    }

    #[test]
    fn test_escrow_roundtrip() {
        let data = sample_escrow();
        let bytes = serialize_escrow(&data);
        assert_eq!(bytes.len(), ESCROW_CELL_SIZE);
        let recovered = deserialize_escrow(&bytes).unwrap();
        assert_eq!(recovered, data);
    }

    #[test]
    fn test_escrow_roundtrip_all_statuses() {
        for status in 0..=2u8 {
            let data = EscrowCellData {
                escrow_id: status as u64,
                depositor: sample_bytes32(status),
                recipient: sample_bytes32(status + 0x10),
                amount: 1_000_000,
                hash_lock: sample_bytes32(0xCC),
                deadline: 1700000000,
                status,
            };
            let bytes = serialize_escrow(&data);
            let recovered = deserialize_escrow(&bytes).unwrap();
            assert_eq!(recovered.status, status);
            assert_eq!(recovered, data);
        }
    }

    #[test]
    fn test_escrow_invalid_status() {
        let mut data = sample_escrow();
        data.status = 3;
        let bytes = serialize_escrow(&data);
        assert_eq!(
            deserialize_escrow(&bytes),
            Err(SerdeError::InvalidStatus(3))
        );
    }

    #[test]
    fn test_escrow_invalid_status_max() {
        let mut data = sample_escrow();
        data.status = 255;
        let bytes = serialize_escrow(&data);
        assert_eq!(
            deserialize_escrow(&bytes),
            Err(SerdeError::InvalidStatus(255))
        );
    }

    #[test]
    fn test_escrow_roundtrip_max() {
        let data = EscrowCellData {
            escrow_id: u64::MAX,
            depositor: all_ones_bytes32(),
            recipient: all_ones_bytes32(),
            amount: u64::MAX,
            hash_lock: all_ones_bytes32(),
            deadline: u64::MAX,
            status: 2, // max valid
        };
        let bytes = serialize_escrow(&data);
        assert_eq!(deserialize_escrow(&bytes).unwrap(), data);
    }

    #[test]
    fn test_escrow_roundtrip_zeros() {
        let data = EscrowCellData {
            escrow_id: 0,
            depositor: zero_bytes32(),
            recipient: zero_bytes32(),
            amount: 0,
            hash_lock: zero_bytes32(),
            deadline: 0,
            status: 0,
        };
        let bytes = serialize_escrow(&data);
        assert_eq!(deserialize_escrow(&bytes).unwrap(), data);
    }

    #[test]
    fn test_escrow_deserialize_too_short() {
        let buf = vec![0u8; 120];
        assert_eq!(
            deserialize_escrow(&buf),
            Err(SerdeError::BufferTooShort { expected: 121, actual: 120 })
        );
    }

    #[test]
    fn test_escrow_deserialize_too_long() {
        let buf = vec![0u8; 122];
        assert_eq!(
            deserialize_escrow(&buf),
            Err(SerdeError::BufferTooLong { expected: 121, actual: 122 })
        );
    }

    #[test]
    fn test_escrow_le_byte_order() {
        let data = sample_escrow();
        let bytes = serialize_escrow(&data);
        // escrow_id = 500 = 0x01F4
        assert_eq!(bytes[0], 0xF4);
        assert_eq!(bytes[1], 0x01);
    }

    #[test]
    fn test_escrow_field_positions() {
        let data = sample_escrow();
        let bytes = serialize_escrow(&data);
        let eid = u64::from_le_bytes(bytes[0..8].try_into().unwrap());
        assert_eq!(eid, data.escrow_id);
        assert_eq!(&bytes[8..40], &data.depositor);
        assert_eq!(&bytes[40..72], &data.recipient);
        assert_eq!(bytes[120], data.status);
    }

    #[test]
    fn test_escrow_status_active() {
        let mut data = sample_escrow();
        data.status = 0;
        let bytes = serialize_escrow(&data);
        let recovered = deserialize_escrow(&bytes).unwrap();
        assert_eq!(recovered.status, 0);
    }

    #[test]
    fn test_escrow_status_released() {
        let mut data = sample_escrow();
        data.status = 1;
        let bytes = serialize_escrow(&data);
        let recovered = deserialize_escrow(&bytes).unwrap();
        assert_eq!(recovered.status, 1);
    }

    #[test]
    fn test_escrow_status_refunded() {
        let mut data = sample_escrow();
        data.status = 2;
        let bytes = serialize_escrow(&data);
        let recovered = deserialize_escrow(&bytes).unwrap();
        assert_eq!(recovered.status, 2);
    }

    // ============ Checksum Tests ============

    #[test]
    fn test_checksum_deterministic() {
        let data = vec![1, 2, 3, 4, 5];
        let c1 = compute_checksum(&data);
        let c2 = compute_checksum(&data);
        assert_eq!(c1, c2);
    }

    #[test]
    fn test_checksum_empty() {
        let data: Vec<u8> = vec![];
        let checksum = compute_checksum(&data);
        // SHA-256 of empty = e3b0c44298fc1c14...
        assert_eq!(checksum[0], 0xe3);
        assert_eq!(checksum[1], 0xb0);
        assert_eq!(checksum[2], 0xc4);
        assert_eq!(checksum[3], 0x42);
    }

    #[test]
    fn test_checksum_different_data() {
        let c1 = compute_checksum(&[1, 2, 3]);
        let c2 = compute_checksum(&[1, 2, 4]);
        assert_ne!(c1, c2);
    }

    #[test]
    fn test_checksum_single_byte() {
        let checksum = compute_checksum(&[0x00]);
        // SHA-256 of single zero byte
        assert_eq!(checksum.len(), 4);
    }

    #[test]
    fn test_checksum_pool_data() {
        let pool = sample_pool();
        let bytes = serialize_pool(&pool);
        let checksum = compute_checksum(&bytes);
        // Should be consistent
        let checksum2 = compute_checksum(&bytes);
        assert_eq!(checksum, checksum2);
    }

    #[test]
    fn test_checksum_length() {
        let checksum = compute_checksum(&[0xAA; 256]);
        assert_eq!(checksum.len(), 4);
    }

    #[test]
    fn test_checksum_single_bit_change() {
        let data1 = vec![0u8; 32];
        let mut data2 = vec![0u8; 32];
        data2[15] = 1; // flip one bit
        let c1 = compute_checksum(&data1);
        let c2 = compute_checksum(&data2);
        assert_ne!(c1, c2);
    }

    // ============ Validation Tests ============

    #[test]
    fn test_validate_pool_valid() {
        let data = sample_pool();
        assert_eq!(validate_pool(&data), Ok(()));
    }

    #[test]
    fn test_validate_pool_zero_pool_id() {
        let mut data = sample_pool();
        data.pool_id = zero_bytes32();
        assert_eq!(validate_pool(&data), Err(SerdeError::ZeroPoolId));
    }

    #[test]
    fn test_validate_pool_fee_too_high() {
        let mut data = sample_pool();
        data.fee_rate_bps = 10_001;
        assert_eq!(validate_pool(&data), Err(SerdeError::InvalidFieldValue));
    }

    #[test]
    fn test_validate_pool_protocol_fee_too_high() {
        let mut data = sample_pool();
        data.protocol_fee_bps = 10_001;
        assert_eq!(validate_pool(&data), Err(SerdeError::InvalidFieldValue));
    }

    #[test]
    fn test_validate_pool_fee_at_max() {
        let mut data = sample_pool();
        data.fee_rate_bps = 10_000;
        data.protocol_fee_bps = 10_000;
        assert_eq!(validate_pool(&data), Ok(()));
    }

    #[test]
    fn test_validate_pool_zero_reserves() {
        let mut data = sample_pool();
        data.reserve_a = 0;
        data.reserve_b = 0;
        assert_eq!(validate_pool(&data), Ok(()));
    }

    #[test]
    fn test_validate_pool_max_reserves_no_overflow() {
        let mut data = sample_pool();
        data.reserve_a = u64::MAX;
        data.reserve_b = u64::MAX;
        // u64::MAX * u64::MAX fits in u128
        assert_eq!(validate_pool(&data), Ok(()));
    }

    #[test]
    fn test_validate_vault_valid() {
        let data = sample_vault();
        assert_eq!(validate_vault(&data), Ok(()));
    }

    #[test]
    fn test_validate_vault_zero_pool_id() {
        let mut data = sample_vault();
        data.pool_id = zero_bytes32();
        assert_eq!(validate_vault(&data), Err(SerdeError::ZeroPoolId));
    }

    #[test]
    fn test_validate_vault_zero_owner() {
        let mut data = sample_vault();
        data.owner = zero_bytes32();
        assert_eq!(validate_vault(&data), Err(SerdeError::InvalidFieldValue));
    }

    #[test]
    fn test_validate_oracle_valid() {
        let data = sample_oracle();
        assert_eq!(validate_oracle(&data), Ok(()));
    }

    #[test]
    fn test_validate_oracle_confidence_too_high() {
        let mut data = sample_oracle();
        data.confidence = 10_001;
        assert_eq!(validate_oracle(&data), Err(SerdeError::InvalidFieldValue));
    }

    #[test]
    fn test_validate_oracle_confidence_at_max() {
        let mut data = sample_oracle();
        data.confidence = 10_000;
        assert_eq!(validate_oracle(&data), Ok(()));
    }

    #[test]
    fn test_validate_oracle_volatility_too_high() {
        let mut data = sample_oracle();
        data.volatility_bps = 10_001;
        assert_eq!(validate_oracle(&data), Err(SerdeError::InvalidFieldValue));
    }

    #[test]
    fn test_validate_oracle_zero_sources() {
        let mut data = sample_oracle();
        data.source_count = 0;
        assert_eq!(validate_oracle(&data), Err(SerdeError::InvalidFieldValue));
    }

    #[test]
    fn test_validate_oracle_one_source() {
        let mut data = sample_oracle();
        data.source_count = 1;
        assert_eq!(validate_oracle(&data), Ok(()));
    }

    // ============ Capacity Calculation Tests ============

    #[test]
    fn test_minimum_capacity_formula() {
        // (data_size + 33 + 8) * 100_000_000
        assert_eq!(minimum_capacity(0), 41 * 100_000_000);
    }

    #[test]
    fn test_minimum_capacity_pool() {
        // (184 + 41) * 100_000_000 = 225 * 100_000_000 = 22_500_000_000
        assert_eq!(pool_minimum_capacity(), 22_500_000_000);
        assert_eq!(pool_minimum_capacity(), minimum_capacity(POOL_CELL_SIZE));
    }

    #[test]
    fn test_minimum_capacity_vault() {
        // (104 + 41) * 100_000_000 = 145 * 100_000_000 = 14_500_000_000
        assert_eq!(vault_minimum_capacity(), 14_500_000_000);
        assert_eq!(vault_minimum_capacity(), minimum_capacity(VAULT_CELL_SIZE));
    }

    #[test]
    fn test_minimum_capacity_oracle() {
        // (76 + 41) * 100_000_000 = 117 * 100_000_000
        assert_eq!(minimum_capacity(ORACLE_CELL_SIZE), 11_700_000_000);
    }

    #[test]
    fn test_minimum_capacity_governance() {
        // (113 + 41) * 100_000_000 = 154 * 100_000_000
        assert_eq!(minimum_capacity(GOVERNANCE_CELL_SIZE), 15_400_000_000);
    }

    #[test]
    fn test_minimum_capacity_stake() {
        // (112 + 41) * 100_000_000 = 153 * 100_000_000
        assert_eq!(minimum_capacity(STAKE_CELL_SIZE), 15_300_000_000);
    }

    #[test]
    fn test_minimum_capacity_batch() {
        // (73 + 41) * 100_000_000 = 114 * 100_000_000
        assert_eq!(minimum_capacity(BATCH_CELL_SIZE), 11_400_000_000);
    }

    #[test]
    fn test_minimum_capacity_commit() {
        // (88 + 41) * 100_000_000 = 129 * 100_000_000
        assert_eq!(minimum_capacity(COMMIT_CELL_SIZE), 12_900_000_000);
    }

    #[test]
    fn test_minimum_capacity_escrow() {
        // (121 + 41) * 100_000_000 = 162 * 100_000_000
        assert_eq!(minimum_capacity(ESCROW_CELL_SIZE), 16_200_000_000);
    }

    #[test]
    fn test_minimum_capacity_one_byte() {
        assert_eq!(minimum_capacity(1), 42 * 100_000_000);
    }

    #[test]
    fn test_minimum_capacity_large_saturating() {
        // Very large data_size should saturate rather than overflow
        let cap = minimum_capacity(usize::MAX / 2);
        assert!(cap > 0); // saturating_mul prevents panic
    }

    // ============ Cell Type Detection Tests ============

    #[test]
    fn test_detect_pool() {
        let buf = vec![0u8; POOL_CELL_SIZE];
        assert_eq!(detect_cell_type(&buf), Some("Pool"));
    }

    #[test]
    fn test_detect_vault() {
        let buf = vec![0u8; VAULT_CELL_SIZE];
        assert_eq!(detect_cell_type(&buf), Some("Vault"));
    }

    #[test]
    fn test_detect_oracle() {
        let buf = vec![0u8; ORACLE_CELL_SIZE];
        assert_eq!(detect_cell_type(&buf), Some("Oracle"));
    }

    #[test]
    fn test_detect_governance() {
        let buf = vec![0u8; GOVERNANCE_CELL_SIZE];
        assert_eq!(detect_cell_type(&buf), Some("Governance"));
    }

    #[test]
    fn test_detect_stake() {
        let buf = vec![0u8; STAKE_CELL_SIZE];
        assert_eq!(detect_cell_type(&buf), Some("Stake"));
    }

    #[test]
    fn test_detect_batch() {
        let buf = vec![0u8; BATCH_CELL_SIZE];
        assert_eq!(detect_cell_type(&buf), Some("Batch"));
    }

    #[test]
    fn test_detect_commit() {
        let buf = vec![0u8; COMMIT_CELL_SIZE];
        assert_eq!(detect_cell_type(&buf), Some("Commit"));
    }

    #[test]
    fn test_detect_escrow() {
        let buf = vec![0u8; ESCROW_CELL_SIZE];
        assert_eq!(detect_cell_type(&buf), Some("Escrow"));
    }

    #[test]
    fn test_detect_unknown_size() {
        let buf = vec![0u8; 99];
        assert_eq!(detect_cell_type(&buf), None);
    }

    #[test]
    fn test_detect_empty() {
        let buf: Vec<u8> = vec![];
        assert_eq!(detect_cell_type(&buf), None);
    }

    #[test]
    fn test_detect_one_byte() {
        let buf = vec![0u8; 1];
        assert_eq!(detect_cell_type(&buf), None);
    }

    #[test]
    fn test_detect_very_large() {
        let buf = vec![0u8; 10_000];
        assert_eq!(detect_cell_type(&buf), None);
    }

    // ============ cell_type_sizes Tests ============

    #[test]
    fn test_cell_type_sizes_count() {
        let sizes = cell_type_sizes();
        assert_eq!(sizes.len(), 8);
    }

    #[test]
    fn test_cell_type_sizes_sorted_alphabetically() {
        let sizes = cell_type_sizes();
        let names: Vec<&str> = sizes.iter().map(|(n, _)| *n).collect();
        let mut sorted = names.clone();
        sorted.sort();
        assert_eq!(names, sorted);
    }

    #[test]
    fn test_cell_type_sizes_values() {
        let sizes = cell_type_sizes();
        let map: std::collections::HashMap<&str, usize> = sizes.into_iter().collect();
        assert_eq!(map["Pool"], 184);
        assert_eq!(map["Vault"], 104);
        assert_eq!(map["Oracle"], 76);
        assert_eq!(map["Governance"], 113);
        assert_eq!(map["Stake"], 112);
        assert_eq!(map["Batch"], 73);
        assert_eq!(map["Commit"], 88);
        assert_eq!(map["Escrow"], 121);
    }

    #[test]
    fn test_cell_type_sizes_unique() {
        let sizes = cell_type_sizes();
        let size_vals: Vec<usize> = sizes.iter().map(|(_, s)| *s).collect();
        let mut deduped = size_vals.clone();
        deduped.sort();
        deduped.dedup();
        assert_eq!(size_vals.len(), deduped.len(), "All cell sizes should be unique");
    }

    // ============ Cross-Cell Roundtrip Tests ============

    #[test]
    fn test_all_serialize_sizes_match_constants() {
        assert_eq!(serialize_pool(&sample_pool()).len(), POOL_CELL_SIZE);
        assert_eq!(serialize_vault(&sample_vault()).len(), VAULT_CELL_SIZE);
        assert_eq!(serialize_oracle(&sample_oracle()).len(), ORACLE_CELL_SIZE);
        assert_eq!(serialize_governance(&sample_governance()).len(), GOVERNANCE_CELL_SIZE);
        assert_eq!(serialize_stake(&sample_stake()).len(), STAKE_CELL_SIZE);
        assert_eq!(serialize_batch(&sample_batch()).len(), BATCH_CELL_SIZE);
        assert_eq!(serialize_commit(&sample_commit()).len(), COMMIT_CELL_SIZE);
        assert_eq!(serialize_escrow(&sample_escrow()).len(), ESCROW_CELL_SIZE);
    }

    #[test]
    fn test_all_cell_sizes_match_functions() {
        assert_eq!(pool_cell_size(), POOL_CELL_SIZE);
        assert_eq!(vault_cell_size(), VAULT_CELL_SIZE);
        assert_eq!(oracle_cell_size(), ORACLE_CELL_SIZE);
        assert_eq!(governance_cell_size(), GOVERNANCE_CELL_SIZE);
        assert_eq!(stake_cell_size(), STAKE_CELL_SIZE);
        assert_eq!(batch_cell_size(), BATCH_CELL_SIZE);
        assert_eq!(commit_cell_size(), COMMIT_CELL_SIZE);
        assert_eq!(escrow_cell_size(), ESCROW_CELL_SIZE);
    }

    #[test]
    fn test_pool_different_data_different_bytes() {
        let pool1 = sample_pool();
        let mut pool2 = sample_pool();
        pool2.reserve_a = 999;
        let bytes1 = serialize_pool(&pool1);
        let bytes2 = serialize_pool(&pool2);
        assert_ne!(bytes1, bytes2);
    }

    #[test]
    fn test_vault_different_data_different_bytes() {
        let vault1 = sample_vault();
        let mut vault2 = sample_vault();
        vault2.health_factor = 200_000_000;
        let bytes1 = serialize_vault(&vault1);
        let bytes2 = serialize_vault(&vault2);
        assert_ne!(bytes1, bytes2);
    }

    #[test]
    fn test_oracle_different_data_different_bytes() {
        let oracle1 = sample_oracle();
        let mut oracle2 = sample_oracle();
        oracle2.price = 4_000_000_000_00;
        let bytes1 = serialize_oracle(&oracle1);
        let bytes2 = serialize_oracle(&oracle2);
        assert_ne!(bytes1, bytes2);
    }

    #[test]
    fn test_commit_different_data_different_bytes() {
        let commit1 = sample_commit();
        let mut commit2 = sample_commit();
        commit2.deposit_amount = 999_999;
        let bytes1 = serialize_commit(&commit1);
        let bytes2 = serialize_commit(&commit2);
        assert_ne!(bytes1, bytes2);
    }

    // ============ Edge Case Tests ============

    #[test]
    fn test_pool_one_byte_short() {
        let buf = vec![0u8; POOL_CELL_SIZE - 1];
        assert!(deserialize_pool(&buf).is_err());
    }

    #[test]
    fn test_pool_one_byte_long() {
        let buf = vec![0u8; POOL_CELL_SIZE + 1];
        assert!(deserialize_pool(&buf).is_err());
    }

    #[test]
    fn test_vault_one_byte_short() {
        let buf = vec![0u8; VAULT_CELL_SIZE - 1];
        assert!(deserialize_vault(&buf).is_err());
    }

    #[test]
    fn test_oracle_one_byte_short() {
        let buf = vec![0u8; ORACLE_CELL_SIZE - 1];
        assert!(deserialize_oracle(&buf).is_err());
    }

    #[test]
    fn test_governance_one_byte_short() {
        let buf = vec![0u8; GOVERNANCE_CELL_SIZE - 1];
        assert!(deserialize_governance(&buf).is_err());
    }

    #[test]
    fn test_stake_one_byte_short() {
        let buf = vec![0u8; STAKE_CELL_SIZE - 1];
        assert!(deserialize_stake(&buf).is_err());
    }

    #[test]
    fn test_batch_one_byte_short() {
        let buf = vec![0u8; BATCH_CELL_SIZE - 1];
        assert!(deserialize_batch(&buf).is_err());
    }

    #[test]
    fn test_commit_one_byte_short() {
        let buf = vec![0u8; COMMIT_CELL_SIZE - 1];
        assert!(deserialize_commit(&buf).is_err());
    }

    #[test]
    fn test_escrow_one_byte_short() {
        let buf = vec![0u8; ESCROW_CELL_SIZE - 1];
        assert!(deserialize_escrow(&buf).is_err());
    }

    #[test]
    fn test_pool_k_last_u128_precision() {
        let mut data = sample_pool();
        data.k_last = u128::MAX - 1;
        let bytes = serialize_pool(&data);
        let recovered = deserialize_pool(&bytes).unwrap();
        assert_eq!(recovered.k_last, u128::MAX - 1);
    }

    #[test]
    fn test_pool_cumulative_prices_independent() {
        let mut data = sample_pool();
        data.cumulative_price_a = 12345678901234567890;
        data.cumulative_price_b = 98765432109876543210;
        let bytes = serialize_pool(&data);
        let recovered = deserialize_pool(&bytes).unwrap();
        assert_eq!(recovered.cumulative_price_a, 12345678901234567890);
        assert_eq!(recovered.cumulative_price_b, 98765432109876543210);
    }

    #[test]
    fn test_stake_delegate_all_ones_is_some() {
        let mut data = sample_stake();
        data.delegate = Some(all_ones_bytes32());
        let bytes = serialize_stake(&data);
        let recovered = deserialize_stake(&bytes).unwrap();
        assert_eq!(recovered.delegate, Some(all_ones_bytes32()));
    }

    #[test]
    fn test_governance_zero_votes() {
        let mut data = sample_governance();
        data.for_votes = 0;
        data.against_votes = 0;
        let bytes = serialize_governance(&data);
        let recovered = deserialize_governance(&bytes).unwrap();
        assert_eq!(recovered.for_votes, 0);
        assert_eq!(recovered.against_votes, 0);
    }

    #[test]
    fn test_batch_counts_independent() {
        let mut data = sample_batch();
        data.commit_count = 100;
        data.reveal_count = 50;
        let bytes = serialize_batch(&data);
        let recovered = deserialize_batch(&bytes).unwrap();
        assert_eq!(recovered.commit_count, 100);
        assert_eq!(recovered.reveal_count, 50);
    }

    #[test]
    fn test_escrow_hash_lock_preserved() {
        let mut data = sample_escrow();
        let mut special_hash = [0u8; 32];
        for i in 0..32 {
            special_hash[i] = i as u8;
        }
        data.hash_lock = special_hash;
        let bytes = serialize_escrow(&data);
        let recovered = deserialize_escrow(&bytes).unwrap();
        assert_eq!(recovered.hash_lock, special_hash);
    }

    #[test]
    fn test_read_u32_le_with_offset() {
        let mut buf = Vec::new();
        write_u64_le(&mut buf, 0); // 8 bytes padding
        write_u32_le(&mut buf, 42);
        assert_eq!(read_u32_le(&buf, 8).unwrap(), 42);
    }

    #[test]
    fn test_read_u64_le_with_offset() {
        let mut buf = Vec::new();
        write_u32_le(&mut buf, 0); // 4 bytes padding
        write_u64_le(&mut buf, 123456789);
        assert_eq!(read_u64_le(&buf, 4).unwrap(), 123456789);
    }

    #[test]
    fn test_read_u128_le_with_offset() {
        let mut buf = Vec::new();
        write_u8(&mut buf, 0); // 1 byte padding
        write_u128_le(&mut buf, 999_999_999_999_999);
        assert_eq!(read_u128_le(&buf, 1).unwrap(), 999_999_999_999_999);
    }

    #[test]
    fn test_pool_serialize_then_detect() {
        let bytes = serialize_pool(&sample_pool());
        assert_eq!(detect_cell_type(&bytes), Some("Pool"));
    }

    #[test]
    fn test_vault_serialize_then_detect() {
        let bytes = serialize_vault(&sample_vault());
        assert_eq!(detect_cell_type(&bytes), Some("Vault"));
    }

    #[test]
    fn test_oracle_serialize_then_detect() {
        let bytes = serialize_oracle(&sample_oracle());
        assert_eq!(detect_cell_type(&bytes), Some("Oracle"));
    }

    #[test]
    fn test_batch_serialize_then_detect() {
        let bytes = serialize_batch(&sample_batch());
        assert_eq!(detect_cell_type(&bytes), Some("Batch"));
    }

    #[test]
    fn test_commit_serialize_then_detect() {
        let bytes = serialize_commit(&sample_commit());
        assert_eq!(detect_cell_type(&bytes), Some("Commit"));
    }

    #[test]
    fn test_escrow_serialize_then_detect() {
        let bytes = serialize_escrow(&sample_escrow());
        assert_eq!(detect_cell_type(&bytes), Some("Escrow"));
    }

    #[test]
    fn test_governance_serialize_then_detect() {
        let bytes = serialize_governance(&sample_governance());
        assert_eq!(detect_cell_type(&bytes), Some("Governance"));
    }

    #[test]
    fn test_stake_serialize_then_detect() {
        let bytes = serialize_stake(&sample_stake());
        assert_eq!(detect_cell_type(&bytes), Some("Stake"));
    }

    // ============ Checksum on Serialized Data Tests ============

    #[test]
    fn test_checksum_different_pools() {
        let pool1 = sample_pool();
        let mut pool2 = sample_pool();
        pool2.reserve_a = 42;
        let c1 = compute_checksum(&serialize_pool(&pool1));
        let c2 = compute_checksum(&serialize_pool(&pool2));
        assert_ne!(c1, c2);
    }

    #[test]
    fn test_checksum_same_pool_twice() {
        let pool = sample_pool();
        let bytes = serialize_pool(&pool);
        assert_eq!(compute_checksum(&bytes), compute_checksum(&bytes));
    }

    // ============ Capacity Helpers Consistency ============

    #[test]
    fn test_pool_capacity_gt_vault_capacity() {
        assert!(pool_minimum_capacity() > vault_minimum_capacity());
    }

    #[test]
    fn test_capacity_monotonic_with_size() {
        let sizes = vec![
            BATCH_CELL_SIZE,
            ORACLE_CELL_SIZE,
            COMMIT_CELL_SIZE,
            VAULT_CELL_SIZE,
            STAKE_CELL_SIZE,
            GOVERNANCE_CELL_SIZE,
            ESCROW_CELL_SIZE,
            POOL_CELL_SIZE,
        ];
        for i in 0..sizes.len() {
            for j in 0..sizes.len() {
                if sizes[i] < sizes[j] {
                    assert!(minimum_capacity(sizes[i]) < minimum_capacity(sizes[j]));
                }
            }
        }
    }

    // ============ Error Variant Tests ============

    #[test]
    fn test_error_variants_are_distinct() {
        let errors: Vec<SerdeError> = vec![
            SerdeError::BufferTooShort { expected: 10, actual: 5 },
            SerdeError::BufferTooLong { expected: 10, actual: 15 },
            SerdeError::InvalidStatus(5),
            SerdeError::InvalidPhase(4),
            SerdeError::ChecksumMismatch,
            SerdeError::InvalidVersion(2),
            SerdeError::Overflow,
            SerdeError::ZeroPoolId,
            SerdeError::InvalidFieldValue,
        ];
        for i in 0..errors.len() {
            for j in 0..errors.len() {
                if i != j {
                    assert_ne!(errors[i], errors[j]);
                }
            }
        }
    }

    #[test]
    fn test_error_debug_format() {
        let err = SerdeError::BufferTooShort { expected: 184, actual: 100 };
        let debug = format!("{:?}", err);
        assert!(debug.contains("184"));
        assert!(debug.contains("100"));
    }

    #[test]
    fn test_error_clone() {
        let err = SerdeError::InvalidStatus(5);
        let cloned = err.clone();
        assert_eq!(err, cloned);
    }

    // ============ Serialize Determinism Tests ============

    #[test]
    fn test_vault_serialize_deterministic() {
        let data = sample_vault();
        assert_eq!(serialize_vault(&data), serialize_vault(&data));
    }

    #[test]
    fn test_oracle_serialize_deterministic() {
        let data = sample_oracle();
        assert_eq!(serialize_oracle(&data), serialize_oracle(&data));
    }

    #[test]
    fn test_governance_serialize_deterministic() {
        let data = sample_governance();
        assert_eq!(serialize_governance(&data), serialize_governance(&data));
    }

    #[test]
    fn test_stake_serialize_deterministic() {
        let data = sample_stake();
        assert_eq!(serialize_stake(&data), serialize_stake(&data));
    }

    #[test]
    fn test_batch_serialize_deterministic() {
        let data = sample_batch();
        assert_eq!(serialize_batch(&data), serialize_batch(&data));
    }

    #[test]
    fn test_commit_serialize_deterministic() {
        let data = sample_commit();
        assert_eq!(serialize_commit(&data), serialize_commit(&data));
    }

    #[test]
    fn test_escrow_serialize_deterministic() {
        let data = sample_escrow();
        assert_eq!(serialize_escrow(&data), serialize_escrow(&data));
    }

    // ============ Additional Edge Cases ============

    #[test]
    fn test_pool_single_token_id_difference() {
        let mut pool1 = sample_pool();
        let mut pool2 = sample_pool();
        pool1.token_a[0] = 0x00;
        pool2.token_a[0] = 0x01;
        let bytes1 = serialize_pool(&pool1);
        let bytes2 = serialize_pool(&pool2);
        assert_ne!(bytes1, bytes2);
        assert_eq!(bytes1[32], 0x00);
        assert_eq!(bytes2[32], 0x01);
    }

    #[test]
    fn test_vault_health_factor_boundary() {
        let mut data = sample_vault();
        data.health_factor = 100_000_000; // exactly 1.0 scaled by 1e8
        let bytes = serialize_vault(&data);
        let recovered = deserialize_vault(&bytes).unwrap();
        assert_eq!(recovered.health_factor, 100_000_000);
    }

    #[test]
    fn test_oracle_max_confidence() {
        let mut data = sample_oracle();
        data.confidence = 10_000; // 100%
        let bytes = serialize_oracle(&data);
        let recovered = deserialize_oracle(&bytes).unwrap();
        assert_eq!(recovered.confidence, 10_000);
    }

    #[test]
    fn test_oracle_zero_confidence() {
        let mut data = sample_oracle();
        data.confidence = 0;
        let bytes = serialize_oracle(&data);
        let recovered = deserialize_oracle(&bytes).unwrap();
        assert_eq!(recovered.confidence, 0);
    }

    #[test]
    fn test_batch_clearing_price_zero_before_settlement() {
        let mut data = sample_batch();
        data.phase = 0; // Accepting
        data.clearing_price = 0;
        let bytes = serialize_batch(&data);
        let recovered = deserialize_batch(&bytes).unwrap();
        assert_eq!(recovered.clearing_price, 0);
    }

    #[test]
    fn test_escrow_deadline_far_future() {
        let mut data = sample_escrow();
        data.deadline = u64::MAX;
        let bytes = serialize_escrow(&data);
        let recovered = deserialize_escrow(&bytes).unwrap();
        assert_eq!(recovered.deadline, u64::MAX);
    }

    #[test]
    fn test_commit_zero_deposit() {
        let mut data = sample_commit();
        data.deposit_amount = 0;
        let bytes = serialize_commit(&data);
        let recovered = deserialize_commit(&bytes).unwrap();
        assert_eq!(recovered.deposit_amount, 0);
    }

    #[test]
    fn test_commit_max_deposit() {
        let mut data = sample_commit();
        data.deposit_amount = u64::MAX;
        let bytes = serialize_commit(&data);
        let recovered = deserialize_commit(&bytes).unwrap();
        assert_eq!(recovered.deposit_amount, u64::MAX);
    }
}
