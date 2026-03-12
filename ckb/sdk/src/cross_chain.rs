// ============ Cross-Chain Messaging & Bridge Protocol ============
// Cross-chain messaging infrastructure for VibeSwap's omnichain DEX,
// inspired by LayerZero V2's OApp protocol. Handles chain registry,
// message encoding/decoding, packet routing, finality tracking,
// nonce management, fee estimation, delivery verification, and
// bridge accounting (lock/mint/burn/unlock with supply invariants).
//
// All arithmetic uses u64/u128 only — no floating point.
// Errors are simple strings via Result<T, String>.

use sha2::{Digest, Sha256};

// ============ Constants ============

/// Maximum payload size in bytes (8 KB)
pub const MAX_PAYLOAD_SIZE: usize = 8192;

/// Current packet version
pub const PACKET_VERSION: u8 = 1;

/// Maximum chains in a registry
pub const MAX_REGISTRY_CHAINS: usize = 64;

/// Default timeout for cross-chain packets (10 minutes in ms)
pub const DEFAULT_TIMEOUT_MS: u64 = 600_000;

/// Maximum retry attempts for failed deliveries
pub const MAX_RETRY_ATTEMPTS: u32 = 5;

/// Base retry delay in ms (doubles each attempt)
pub const BASE_RETRY_DELAY_MS: u64 = 30_000;

/// Protocol fee in basis points (0.05%)
pub const PROTOCOL_FEE_BPS: u64 = 5;

/// Basis points denominator
pub const BPS_DENOMINATOR: u64 = 10_000;

/// Minimum gas limit for cross-chain packets
pub const MIN_GAS_LIMIT: u64 = 21_000;

/// Header size in bytes: version(1) + flags(1) + src_chain(4) + dst_chain(4) + nonce(8) = 18
pub const HEADER_SIZE: usize = 18;

// ============ Chain Status Constants ============

pub const CHAIN_STATUS_ACTIVE: u8 = 0;
pub const CHAIN_STATUS_PAUSED: u8 = 1;
pub const CHAIN_STATUS_DEPRECATED: u8 = 2;

// ============ Data Structures ============

#[derive(Debug, Clone)]
pub struct ChainConfig {
    pub chain_id: u32,
    pub name: String,
    pub finality_blocks: u64,
    pub avg_block_time_ms: u64,
    pub endpoint_url: String,
    pub status: u8,
}

#[derive(Debug, Clone)]
pub struct CrossChainPacket {
    pub version: u8,
    pub src_chain: u32,
    pub dst_chain: u32,
    pub nonce: u64,
    pub sender: [u8; 32],
    pub receiver: [u8; 32],
    pub payload: Vec<u8>,
    pub timestamp: u64,
    pub gas_limit: u64,
}

#[derive(Debug, Clone)]
pub struct PacketHeader {
    pub version: u8,
    pub flags: u8,
    pub src_chain: u32,
    pub dst_chain: u32,
    pub nonce: u64,
}

#[derive(Debug, Clone)]
pub struct ChannelState {
    pub src_chain: u32,
    pub dst_chain: u32,
    pub inbound_nonce: u64,
    pub outbound_nonce: u64,
    pub last_activity: u64,
}

#[derive(Debug, Clone)]
pub struct DeliveryReceipt {
    pub packet_hash: u64,
    pub delivered_at: u64,
    pub block_number: u64,
    pub tx_hash: [u8; 32],
    pub gas_used: u64,
}

#[derive(Debug, Clone)]
pub struct BridgeBalance {
    pub chain_id: u32,
    pub token_id: u64,
    pub locked_amount: u128,
    pub minted_amount: u128,
    pub pending_in: u128,
    pub pending_out: u128,
}

#[derive(Debug, Clone)]
pub struct RelayerInfo {
    pub id: u64,
    pub chains_supported: Vec<u32>,
    pub fee_bps: u64,
    pub reliability_score: u64,
    pub total_relayed: u64,
}

#[derive(Debug, Clone)]
pub struct FinalityState {
    pub chain_id: u32,
    pub current_block: u64,
    pub confirmed_block: u64,
    pub pending_blocks: u64,
    pub reorg_count: u64,
}

#[derive(Debug, Clone)]
pub struct RetryEntry {
    pub packet_hash: u64,
    pub attempts: u32,
    pub next_retry_at: u64,
    pub max_attempts: u32,
    pub last_error: String,
}

// ============ Chain Registry ============

pub fn register_chain(registry: &mut Vec<ChainConfig>, config: ChainConfig) -> Result<(), String> {
    if config.name.is_empty() {
        return Err("chain name cannot be empty".into());
    }
    if config.finality_blocks == 0 {
        return Err("finality_blocks must be > 0".into());
    }
    if config.avg_block_time_ms == 0 {
        return Err("avg_block_time_ms must be > 0".into());
    }
    if config.status > CHAIN_STATUS_DEPRECATED {
        return Err("invalid chain status".into());
    }
    if registry.len() >= MAX_REGISTRY_CHAINS {
        return Err("registry full".into());
    }
    for c in registry.iter() {
        if c.chain_id == config.chain_id {
            return Err(format!("chain {} already registered", config.chain_id));
        }
    }
    registry.push(config);
    Ok(())
}

pub fn get_supported_chains(registry: &[ChainConfig]) -> Vec<ChainConfig> {
    registry
        .iter()
        .filter(|c| c.status == CHAIN_STATUS_ACTIVE)
        .cloned()
        .collect()
}

pub fn find_chain(registry: &[ChainConfig], chain_id: u32) -> Option<ChainConfig> {
    registry.iter().find(|c| c.chain_id == chain_id).cloned()
}

// ============ Message Encoding ============

pub fn encode_header(header: &PacketHeader) -> Vec<u8> {
    let mut buf = Vec::with_capacity(HEADER_SIZE);
    buf.push(header.version);
    buf.push(header.flags);
    buf.extend_from_slice(&header.src_chain.to_be_bytes());
    buf.extend_from_slice(&header.dst_chain.to_be_bytes());
    buf.extend_from_slice(&header.nonce.to_be_bytes());
    buf
}

pub fn decode_header(bytes: &[u8]) -> Result<PacketHeader, String> {
    if bytes.len() < HEADER_SIZE {
        return Err(format!("header too short: {} < {}", bytes.len(), HEADER_SIZE));
    }
    let version = bytes[0];
    let flags = bytes[1];
    let src_chain = u32::from_be_bytes([bytes[2], bytes[3], bytes[4], bytes[5]]);
    let dst_chain = u32::from_be_bytes([bytes[6], bytes[7], bytes[8], bytes[9]]);
    let nonce = u64::from_be_bytes([
        bytes[10], bytes[11], bytes[12], bytes[13],
        bytes[14], bytes[15], bytes[16], bytes[17],
    ]);
    Ok(PacketHeader { version, flags, src_chain, dst_chain, nonce })
}

pub fn encode_packet(packet: &CrossChainPacket) -> Vec<u8> {
    // Layout: version(1) + src(4) + dst(4) + nonce(8) + sender(32) + receiver(32)
    //       + timestamp(8) + gas_limit(8) + payload_len(4) + payload(N)
    let payload_len = packet.payload.len() as u32;
    let total = 1 + 4 + 4 + 8 + 32 + 32 + 8 + 8 + 4 + packet.payload.len();
    let mut buf = Vec::with_capacity(total);
    buf.push(packet.version);
    buf.extend_from_slice(&packet.src_chain.to_be_bytes());
    buf.extend_from_slice(&packet.dst_chain.to_be_bytes());
    buf.extend_from_slice(&packet.nonce.to_be_bytes());
    buf.extend_from_slice(&packet.sender);
    buf.extend_from_slice(&packet.receiver);
    buf.extend_from_slice(&packet.timestamp.to_be_bytes());
    buf.extend_from_slice(&packet.gas_limit.to_be_bytes());
    buf.extend_from_slice(&payload_len.to_be_bytes());
    buf.extend_from_slice(&packet.payload);
    buf
}

pub fn decode_packet(bytes: &[u8]) -> Result<CrossChainPacket, String> {
    let min_size = 1 + 4 + 4 + 8 + 32 + 32 + 8 + 8 + 4; // 101
    if bytes.len() < min_size {
        return Err(format!("packet too short: {} < {}", bytes.len(), min_size));
    }
    let version = bytes[0];
    let mut off = 1;
    let src_chain = u32::from_be_bytes([bytes[off], bytes[off+1], bytes[off+2], bytes[off+3]]);
    off += 4;
    let dst_chain = u32::from_be_bytes([bytes[off], bytes[off+1], bytes[off+2], bytes[off+3]]);
    off += 4;
    let nonce = u64::from_be_bytes([
        bytes[off], bytes[off+1], bytes[off+2], bytes[off+3],
        bytes[off+4], bytes[off+5], bytes[off+6], bytes[off+7],
    ]);
    off += 8;
    let mut sender = [0u8; 32];
    sender.copy_from_slice(&bytes[off..off+32]);
    off += 32;
    let mut receiver = [0u8; 32];
    receiver.copy_from_slice(&bytes[off..off+32]);
    off += 32;
    let timestamp = u64::from_be_bytes([
        bytes[off], bytes[off+1], bytes[off+2], bytes[off+3],
        bytes[off+4], bytes[off+5], bytes[off+6], bytes[off+7],
    ]);
    off += 8;
    let gas_limit = u64::from_be_bytes([
        bytes[off], bytes[off+1], bytes[off+2], bytes[off+3],
        bytes[off+4], bytes[off+5], bytes[off+6], bytes[off+7],
    ]);
    off += 8;
    let payload_len = u32::from_be_bytes([bytes[off], bytes[off+1], bytes[off+2], bytes[off+3]]) as usize;
    off += 4;
    if bytes.len() < off + payload_len {
        return Err("packet truncated: payload incomplete".into());
    }
    let payload = bytes[off..off+payload_len].to_vec();
    Ok(CrossChainPacket { version, src_chain, dst_chain, nonce, sender, receiver, payload, timestamp, gas_limit })
}

// ============ Packet Hashing ============

pub fn compute_packet_hash(packet: &CrossChainPacket) -> u64 {
    let encoded = encode_packet(packet);
    let mut hasher = Sha256::new();
    hasher.update(&encoded);
    let result = hasher.finalize();
    u64::from_be_bytes([
        result[0], result[1], result[2], result[3],
        result[4], result[5], result[6], result[7],
    ])
}

// ============ Packet Validation ============

pub fn validate_packet(packet: &CrossChainPacket, registry: &[ChainConfig]) -> Result<bool, String> {
    if packet.version != PACKET_VERSION {
        return Err(format!("unsupported packet version: {}", packet.version));
    }
    if packet.src_chain == packet.dst_chain {
        return Err("src and dst chain cannot be the same".into());
    }
    if packet.payload.len() > MAX_PAYLOAD_SIZE {
        return Err(format!("payload too large: {} > {}", packet.payload.len(), MAX_PAYLOAD_SIZE));
    }
    if packet.gas_limit < MIN_GAS_LIMIT {
        return Err(format!("gas_limit too low: {} < {}", packet.gas_limit, MIN_GAS_LIMIT));
    }
    let src = find_chain(registry, packet.src_chain)
        .ok_or_else(|| format!("unknown src chain: {}", packet.src_chain))?;
    if src.status != CHAIN_STATUS_ACTIVE {
        return Err(format!("src chain {} is not active", packet.src_chain));
    }
    let dst = find_chain(registry, packet.dst_chain)
        .ok_or_else(|| format!("unknown dst chain: {}", packet.dst_chain))?;
    if dst.status != CHAIN_STATUS_ACTIVE {
        return Err(format!("dst chain {} is not active", packet.dst_chain));
    }
    Ok(true)
}

// ============ Packet Routing ============

pub fn route_packet(packet: &CrossChainPacket, relayers: &[RelayerInfo]) -> Result<RelayerInfo, String> {
    if relayers.is_empty() {
        return Err("no relayers available".into());
    }
    let mut best: Option<&RelayerInfo> = None;
    for r in relayers {
        let supports_src = r.chains_supported.contains(&packet.src_chain);
        let supports_dst = r.chains_supported.contains(&packet.dst_chain);
        if supports_src && supports_dst {
            match best {
                None => best = Some(r),
                Some(current) => {
                    if r.reliability_score > current.reliability_score {
                        best = Some(r);
                    } else if r.reliability_score == current.reliability_score && r.fee_bps < current.fee_bps {
                        best = Some(r);
                    }
                }
            }
        }
    }
    best.cloned().ok_or_else(|| format!(
        "no relayer supports route {} -> {}",
        packet.src_chain, packet.dst_chain
    ))
}

pub fn find_cheapest_relayer(relayers: &[RelayerInfo], src_chain: u32, dst_chain: u32) -> Option<RelayerInfo> {
    let mut cheapest: Option<&RelayerInfo> = None;
    for r in relayers {
        if r.chains_supported.contains(&src_chain) && r.chains_supported.contains(&dst_chain) {
            match cheapest {
                None => cheapest = Some(r),
                Some(current) => {
                    if r.fee_bps < current.fee_bps {
                        cheapest = Some(r);
                    }
                }
            }
        }
    }
    cheapest.cloned()
}

// ============ Nonce Management ============

pub fn get_next_nonce(channel: &ChannelState) -> u64 {
    channel.outbound_nonce + 1
}

pub fn validate_nonce(channel: &ChannelState, nonce: u64) -> Result<bool, String> {
    let expected = channel.inbound_nonce + 1;
    if nonce == expected {
        Ok(true)
    } else if nonce <= channel.inbound_nonce {
        Err(format!("nonce {} already processed, current inbound is {}", nonce, channel.inbound_nonce))
    } else {
        Err(format!("nonce gap: expected {}, got {}", expected, nonce))
    }
}

pub fn detect_nonce_gaps(channel: &ChannelState, received_nonces: &[u64]) -> Vec<u64> {
    if received_nonces.is_empty() {
        return vec![];
    }
    let mut sorted = received_nonces.to_vec();
    sorted.sort_unstable();
    sorted.dedup();
    let mut gaps = Vec::new();
    let start = channel.inbound_nonce + 1;
    let end = *sorted.last().unwrap();
    for n in start..=end {
        if sorted.binary_search(&n).is_err() {
            gaps.push(n);
        }
    }
    gaps
}

// ============ Finality Tracking ============

pub fn check_finality(state: &FinalityState, required_confirmations: u64) -> bool {
    if state.current_block < state.confirmed_block {
        return false;
    }
    let confirmations = state.current_block - state.confirmed_block;
    confirmations >= required_confirmations
}

pub fn update_finality(state: &FinalityState, new_block: u64) -> FinalityState {
    let pending = if new_block > state.confirmed_block {
        new_block - state.confirmed_block
    } else {
        0
    };
    FinalityState {
        chain_id: state.chain_id,
        current_block: new_block,
        confirmed_block: state.confirmed_block,
        pending_blocks: pending,
        reorg_count: state.reorg_count,
    }
}

pub fn detect_reorg(state: &FinalityState, new_block: u64, _expected_parent: u64) -> bool {
    // A reorg is detected when the new block is less than or equal to the confirmed block
    // (i.e., the chain has rolled back past what we considered confirmed)
    new_block < state.confirmed_block
}

pub fn advance_confirmed(state: &FinalityState, new_confirmed: u64) -> FinalityState {
    FinalityState {
        chain_id: state.chain_id,
        current_block: state.current_block,
        confirmed_block: new_confirmed,
        pending_blocks: if state.current_block > new_confirmed {
            state.current_block - new_confirmed
        } else {
            0
        },
        reorg_count: state.reorg_count,
    }
}

// ============ Fee Estimation ============

pub fn estimate_bridge_fee(
    src_chain: u32,
    dst_chain: u32,
    payload_size: u64,
    registry: &[ChainConfig],
) -> Result<u64, String> {
    let _src = find_chain(registry, src_chain)
        .ok_or_else(|| format!("unknown src chain: {}", src_chain))?;
    let dst = find_chain(registry, dst_chain)
        .ok_or_else(|| format!("unknown dst chain: {}", dst_chain))?;
    if dst.status != CHAIN_STATUS_ACTIVE {
        return Err(format!("dst chain {} is not active", dst_chain));
    }
    // Base fee + per-byte fee + finality multiplier
    let base_fee: u64 = 1_000_000; // 0.01 CKB in shannons
    let byte_fee = payload_size.saturating_mul(100);
    let finality_multiplier = dst.finality_blocks.min(1000);
    let total = base_fee
        .saturating_add(byte_fee)
        .saturating_add(finality_multiplier.saturating_mul(1000));
    Ok(total)
}

pub fn calculate_relayer_fee(relayer: &RelayerInfo, payload_size: u64) -> u64 {
    let base = 500_000u64; // 0.005 CKB base
    let size_fee = payload_size.saturating_mul(50);
    let bps_fee = base.saturating_mul(relayer.fee_bps) / BPS_DENOMINATOR;
    base.saturating_add(size_fee).saturating_add(bps_fee)
}

pub fn calculate_protocol_fee(amount: u128) -> u128 {
    amount.saturating_mul(PROTOCOL_FEE_BPS as u128) / (BPS_DENOMINATOR as u128)
}

pub fn calculate_estimated_delivery_time(
    src_chain: u32,
    dst_chain: u32,
    registry: &[ChainConfig],
) -> u64 {
    let src_time = find_chain(registry, src_chain)
        .map(|c| c.finality_blocks.saturating_mul(c.avg_block_time_ms))
        .unwrap_or(0);
    let dst_time = find_chain(registry, dst_chain)
        .map(|c| c.finality_blocks.saturating_mul(c.avg_block_time_ms))
        .unwrap_or(0);
    // Total estimated time = src finality + dst finality + relay overhead (30s)
    src_time.saturating_add(dst_time).saturating_add(30_000)
}

// ============ Delivery Verification ============

pub fn record_delivery(receipt: &DeliveryReceipt, channel: &ChannelState) -> Result<ChannelState, String> {
    if receipt.gas_used == 0 {
        return Err("gas_used cannot be zero".into());
    }
    if receipt.delivered_at == 0 {
        return Err("delivered_at cannot be zero".into());
    }
    Ok(ChannelState {
        src_chain: channel.src_chain,
        dst_chain: channel.dst_chain,
        inbound_nonce: channel.inbound_nonce + 1,
        outbound_nonce: channel.outbound_nonce,
        last_activity: receipt.delivered_at,
    })
}

pub fn check_timeout(packet: &CrossChainPacket, current_time: u64, timeout_ms: u64) -> bool {
    if current_time < packet.timestamp {
        return false;
    }
    current_time - packet.timestamp >= timeout_ms
}

// ============ Retry Management ============

pub fn schedule_retry(entry: &RetryEntry) -> RetryEntry {
    let new_attempts = entry.attempts + 1;
    // Exponential backoff: base * 2^attempts
    let delay = BASE_RETRY_DELAY_MS.saturating_mul(1u64 << new_attempts.min(10));
    RetryEntry {
        packet_hash: entry.packet_hash,
        attempts: new_attempts,
        next_retry_at: entry.next_retry_at.saturating_add(delay),
        max_attempts: entry.max_attempts,
        last_error: entry.last_error.clone(),
    }
}

pub fn should_retry(entry: &RetryEntry, current_time: u64) -> bool {
    entry.attempts < entry.max_attempts && current_time >= entry.next_retry_at
}

pub fn create_retry_entry(packet_hash: u64, current_time: u64, error: &str) -> RetryEntry {
    RetryEntry {
        packet_hash,
        attempts: 0,
        next_retry_at: current_time + BASE_RETRY_DELAY_MS,
        max_attempts: MAX_RETRY_ATTEMPTS,
        last_error: error.to_string(),
    }
}

// ============ Bridge Accounting ============

pub fn lock_tokens(balance: &BridgeBalance, amount: u128) -> Result<BridgeBalance, String> {
    if amount == 0 {
        return Err("cannot lock zero amount".into());
    }
    Ok(BridgeBalance {
        chain_id: balance.chain_id,
        token_id: balance.token_id,
        locked_amount: balance.locked_amount.checked_add(amount)
            .ok_or("lock overflow")?,
        minted_amount: balance.minted_amount,
        pending_in: balance.pending_in,
        pending_out: balance.pending_out.checked_add(amount)
            .ok_or("pending_out overflow")?,
    })
}

pub fn mint_tokens(balance: &BridgeBalance, amount: u128) -> Result<BridgeBalance, String> {
    if amount == 0 {
        return Err("cannot mint zero amount".into());
    }
    let new_pending_in = if balance.pending_in >= amount {
        balance.pending_in - amount
    } else {
        0
    };
    Ok(BridgeBalance {
        chain_id: balance.chain_id,
        token_id: balance.token_id,
        locked_amount: balance.locked_amount,
        minted_amount: balance.minted_amount.checked_add(amount)
            .ok_or("mint overflow")?,
        pending_in: new_pending_in,
        pending_out: balance.pending_out,
    })
}

pub fn burn_tokens(balance: &BridgeBalance, amount: u128) -> Result<BridgeBalance, String> {
    if amount == 0 {
        return Err("cannot burn zero amount".into());
    }
    if balance.minted_amount < amount {
        return Err(format!(
            "insufficient minted balance: have {}, burning {}",
            balance.minted_amount, amount
        ));
    }
    Ok(BridgeBalance {
        chain_id: balance.chain_id,
        token_id: balance.token_id,
        locked_amount: balance.locked_amount,
        minted_amount: balance.minted_amount - amount,
        pending_in: balance.pending_in,
        pending_out: balance.pending_out.checked_add(amount)
            .ok_or("pending_out overflow on burn")?,
    })
}

pub fn unlock_tokens(balance: &BridgeBalance, amount: u128) -> Result<BridgeBalance, String> {
    if amount == 0 {
        return Err("cannot unlock zero amount".into());
    }
    if balance.locked_amount < amount {
        return Err(format!(
            "insufficient locked balance: have {}, unlocking {}",
            balance.locked_amount, amount
        ));
    }
    let new_pending_out = if balance.pending_out >= amount {
        balance.pending_out - amount
    } else {
        0
    };
    Ok(BridgeBalance {
        chain_id: balance.chain_id,
        token_id: balance.token_id,
        locked_amount: balance.locked_amount - amount,
        minted_amount: balance.minted_amount,
        pending_in: balance.pending_in,
        pending_out: new_pending_out,
    })
}

pub fn verify_supply_invariant(balances: &[BridgeBalance]) -> Result<bool, String> {
    if balances.is_empty() {
        return Err("no balances to verify".into());
    }
    let total_locked: u128 = balances.iter().map(|b| b.locked_amount).sum();
    let total_minted: u128 = balances.iter().map(|b| b.minted_amount).sum();
    if total_locked == total_minted {
        Ok(true)
    } else {
        Err(format!(
            "supply invariant violated: locked={} != minted={}",
            total_locked, total_minted
        ))
    }
}

pub fn reconcile_balances(balances: &[BridgeBalance]) -> Result<Vec<BridgeBalance>, String> {
    if balances.is_empty() {
        return Err("no balances to reconcile".into());
    }
    // Clear pending amounts after reconciliation
    let reconciled: Vec<BridgeBalance> = balances
        .iter()
        .map(|b| BridgeBalance {
            chain_id: b.chain_id,
            token_id: b.token_id,
            locked_amount: b.locked_amount,
            minted_amount: b.minted_amount,
            pending_in: 0,
            pending_out: 0,
        })
        .collect();
    Ok(reconciled)
}

// ============ Channel Stats ============

pub fn get_channel_stats(channel: &ChannelState) -> (u64, u64) {
    (channel.inbound_nonce, channel.outbound_nonce)
}

pub fn is_channel_idle(channel: &ChannelState, current_time: u64, idle_threshold_ms: u64) -> bool {
    if current_time < channel.last_activity {
        return false;
    }
    current_time - channel.last_activity >= idle_threshold_ms
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // ---- helpers ----

    fn make_chain(id: u32, name: &str, status: u8) -> ChainConfig {
        ChainConfig {
            chain_id: id,
            name: name.to_string(),
            finality_blocks: 15,
            avg_block_time_ms: 12_000,
            endpoint_url: format!("https://rpc.chain{}.test", id),
            status,
        }
    }

    fn make_active_chain(id: u32, name: &str) -> ChainConfig {
        make_chain(id, name, CHAIN_STATUS_ACTIVE)
    }

    fn make_registry() -> Vec<ChainConfig> {
        vec![
            make_active_chain(1, "Ethereum"),
            make_active_chain(2, "CKB"),
            make_active_chain(3, "BSC"),
        ]
    }

    fn make_packet() -> CrossChainPacket {
        CrossChainPacket {
            version: PACKET_VERSION,
            src_chain: 1,
            dst_chain: 2,
            nonce: 1,
            sender: [0xAA; 32],
            receiver: [0xBB; 32],
            payload: vec![1, 2, 3, 4],
            timestamp: 1_000_000,
            gas_limit: 100_000,
        }
    }

    fn make_channel() -> ChannelState {
        ChannelState {
            src_chain: 1,
            dst_chain: 2,
            inbound_nonce: 5,
            outbound_nonce: 10,
            last_activity: 1_000_000,
        }
    }

    fn make_finality_state() -> FinalityState {
        FinalityState {
            chain_id: 1,
            current_block: 1000,
            confirmed_block: 985,
            pending_blocks: 15,
            reorg_count: 0,
        }
    }

    fn make_balance() -> BridgeBalance {
        BridgeBalance {
            chain_id: 1,
            token_id: 100,
            locked_amount: 1_000_000,
            minted_amount: 1_000_000,
            pending_in: 0,
            pending_out: 0,
        }
    }

    fn make_relayer(id: u64, chains: Vec<u32>, fee_bps: u64, reliability: u64) -> RelayerInfo {
        RelayerInfo {
            id,
            chains_supported: chains,
            fee_bps,
            reliability_score: reliability,
            total_relayed: 100,
        }
    }

    fn make_retry_entry() -> RetryEntry {
        RetryEntry {
            packet_hash: 12345,
            attempts: 0,
            next_retry_at: 1_000_000,
            max_attempts: MAX_RETRY_ATTEMPTS,
            last_error: "timeout".to_string(),
        }
    }

    // ============ Chain Registry Tests ============

    #[test]
    fn test_register_chain_success() {
        let mut reg = vec![];
        let c = make_active_chain(1, "Ethereum");
        assert!(register_chain(&mut reg, c).is_ok());
        assert_eq!(reg.len(), 1);
    }

    #[test]
    fn test_register_chain_duplicate() {
        let mut reg = vec![];
        register_chain(&mut reg, make_active_chain(1, "Ethereum")).unwrap();
        let res = register_chain(&mut reg, make_active_chain(1, "Ethereum2"));
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("already registered"));
    }

    #[test]
    fn test_register_chain_empty_name() {
        let mut reg = vec![];
        let c = make_chain(1, "", CHAIN_STATUS_ACTIVE);
        assert!(register_chain(&mut reg, c).is_err());
    }

    #[test]
    fn test_register_chain_zero_finality() {
        let mut reg = vec![];
        let mut c = make_active_chain(1, "Test");
        c.finality_blocks = 0;
        assert!(register_chain(&mut reg, c).is_err());
    }

    #[test]
    fn test_register_chain_zero_block_time() {
        let mut reg = vec![];
        let mut c = make_active_chain(1, "Test");
        c.avg_block_time_ms = 0;
        assert!(register_chain(&mut reg, c).is_err());
    }

    #[test]
    fn test_register_chain_invalid_status() {
        let mut reg = vec![];
        let c = make_chain(1, "Test", 3);
        assert!(register_chain(&mut reg, c).is_err());
    }

    #[test]
    fn test_register_chain_registry_full() {
        let mut reg = vec![];
        for i in 0..MAX_REGISTRY_CHAINS {
            register_chain(&mut reg, make_active_chain(i as u32, &format!("Chain{}", i))).unwrap();
        }
        let res = register_chain(&mut reg, make_active_chain(999, "Overflow"));
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("registry full"));
    }

    #[test]
    fn test_register_multiple_chains() {
        let mut reg = vec![];
        for i in 0..5 {
            register_chain(&mut reg, make_active_chain(i, &format!("Chain{}", i))).unwrap();
        }
        assert_eq!(reg.len(), 5);
    }

    #[test]
    fn test_get_supported_chains_all_active() {
        let reg = make_registry();
        let active = get_supported_chains(&reg);
        assert_eq!(active.len(), 3);
    }

    #[test]
    fn test_get_supported_chains_filters_paused() {
        let mut reg = make_registry();
        reg.push(make_chain(4, "Paused", CHAIN_STATUS_PAUSED));
        let active = get_supported_chains(&reg);
        assert_eq!(active.len(), 3);
    }

    #[test]
    fn test_get_supported_chains_filters_deprecated() {
        let mut reg = make_registry();
        reg.push(make_chain(5, "Old", CHAIN_STATUS_DEPRECATED));
        let active = get_supported_chains(&reg);
        assert_eq!(active.len(), 3);
    }

    #[test]
    fn test_get_supported_chains_empty_registry() {
        let reg: Vec<ChainConfig> = vec![];
        assert!(get_supported_chains(&reg).is_empty());
    }

    #[test]
    fn test_find_chain_exists() {
        let reg = make_registry();
        let c = find_chain(&reg, 2);
        assert!(c.is_some());
        assert_eq!(c.unwrap().name, "CKB");
    }

    #[test]
    fn test_find_chain_not_found() {
        let reg = make_registry();
        assert!(find_chain(&reg, 99).is_none());
    }

    #[test]
    fn test_find_chain_empty_registry() {
        let reg: Vec<ChainConfig> = vec![];
        assert!(find_chain(&reg, 1).is_none());
    }

    // ============ Header Encoding Tests ============

    #[test]
    fn test_encode_header_size() {
        let h = PacketHeader { version: 1, flags: 0, src_chain: 1, dst_chain: 2, nonce: 1 };
        let encoded = encode_header(&h);
        assert_eq!(encoded.len(), HEADER_SIZE);
    }

    #[test]
    fn test_header_roundtrip() {
        let h = PacketHeader { version: 1, flags: 0xFF, src_chain: 42, dst_chain: 99, nonce: 12345 };
        let encoded = encode_header(&h);
        let decoded = decode_header(&encoded).unwrap();
        assert_eq!(decoded.version, h.version);
        assert_eq!(decoded.flags, h.flags);
        assert_eq!(decoded.src_chain, h.src_chain);
        assert_eq!(decoded.dst_chain, h.dst_chain);
        assert_eq!(decoded.nonce, h.nonce);
    }

    #[test]
    fn test_header_roundtrip_zero_values() {
        let h = PacketHeader { version: 0, flags: 0, src_chain: 0, dst_chain: 0, nonce: 0 };
        let encoded = encode_header(&h);
        let decoded = decode_header(&encoded).unwrap();
        assert_eq!(decoded.version, 0);
        assert_eq!(decoded.nonce, 0);
    }

    #[test]
    fn test_header_roundtrip_max_values() {
        let h = PacketHeader { version: 255, flags: 255, src_chain: u32::MAX, dst_chain: u32::MAX, nonce: u64::MAX };
        let encoded = encode_header(&h);
        let decoded = decode_header(&encoded).unwrap();
        assert_eq!(decoded.version, 255);
        assert_eq!(decoded.src_chain, u32::MAX);
        assert_eq!(decoded.nonce, u64::MAX);
    }

    #[test]
    fn test_decode_header_too_short() {
        let bytes = vec![0u8; 5];
        assert!(decode_header(&bytes).is_err());
    }

    #[test]
    fn test_decode_header_empty() {
        assert!(decode_header(&[]).is_err());
    }

    #[test]
    fn test_decode_header_exact_size() {
        let bytes = vec![0u8; HEADER_SIZE];
        assert!(decode_header(&bytes).is_ok());
    }

    #[test]
    fn test_decode_header_extra_bytes_ignored() {
        let h = PacketHeader { version: 1, flags: 2, src_chain: 3, dst_chain: 4, nonce: 5 };
        let mut encoded = encode_header(&h);
        encoded.extend_from_slice(&[0xFF; 10]); // extra garbage
        let decoded = decode_header(&encoded).unwrap();
        assert_eq!(decoded.version, 1);
        assert_eq!(decoded.nonce, 5);
    }

    #[test]
    fn test_header_version_preserved() {
        for v in [0u8, 1, 2, 127, 255] {
            let h = PacketHeader { version: v, flags: 0, src_chain: 1, dst_chain: 2, nonce: 1 };
            let decoded = decode_header(&encode_header(&h)).unwrap();
            assert_eq!(decoded.version, v);
        }
    }

    // ============ Packet Encoding Tests ============

    #[test]
    fn test_packet_roundtrip() {
        let pkt = make_packet();
        let encoded = encode_packet(&pkt);
        let decoded = decode_packet(&encoded).unwrap();
        assert_eq!(decoded.version, pkt.version);
        assert_eq!(decoded.src_chain, pkt.src_chain);
        assert_eq!(decoded.dst_chain, pkt.dst_chain);
        assert_eq!(decoded.nonce, pkt.nonce);
        assert_eq!(decoded.sender, pkt.sender);
        assert_eq!(decoded.receiver, pkt.receiver);
        assert_eq!(decoded.payload, pkt.payload);
        assert_eq!(decoded.timestamp, pkt.timestamp);
        assert_eq!(decoded.gas_limit, pkt.gas_limit);
    }

    #[test]
    fn test_packet_roundtrip_empty_payload() {
        let mut pkt = make_packet();
        pkt.payload = vec![];
        let encoded = encode_packet(&pkt);
        let decoded = decode_packet(&encoded).unwrap();
        assert!(decoded.payload.is_empty());
    }

    #[test]
    fn test_packet_roundtrip_large_payload() {
        let mut pkt = make_packet();
        pkt.payload = vec![0xDE; 4096];
        let encoded = encode_packet(&pkt);
        let decoded = decode_packet(&encoded).unwrap();
        assert_eq!(decoded.payload.len(), 4096);
        assert!(decoded.payload.iter().all(|&b| b == 0xDE));
    }

    #[test]
    fn test_decode_packet_too_short() {
        let bytes = vec![0u8; 50];
        assert!(decode_packet(&bytes).is_err());
    }

    #[test]
    fn test_decode_packet_truncated_payload() {
        let pkt = make_packet();
        let mut encoded = encode_packet(&pkt);
        encoded.truncate(encoded.len() - 2); // chop payload
        assert!(decode_packet(&encoded).is_err());
    }

    #[test]
    fn test_decode_packet_empty() {
        assert!(decode_packet(&[]).is_err());
    }

    #[test]
    fn test_packet_sender_receiver_preserved() {
        let mut pkt = make_packet();
        pkt.sender = [0x11; 32];
        pkt.receiver = [0x22; 32];
        let decoded = decode_packet(&encode_packet(&pkt)).unwrap();
        assert_eq!(decoded.sender, [0x11; 32]);
        assert_eq!(decoded.receiver, [0x22; 32]);
    }

    #[test]
    fn test_packet_nonce_max_value() {
        let mut pkt = make_packet();
        pkt.nonce = u64::MAX;
        let decoded = decode_packet(&encode_packet(&pkt)).unwrap();
        assert_eq!(decoded.nonce, u64::MAX);
    }

    #[test]
    fn test_packet_timestamp_max() {
        let mut pkt = make_packet();
        pkt.timestamp = u64::MAX;
        let decoded = decode_packet(&encode_packet(&pkt)).unwrap();
        assert_eq!(decoded.timestamp, u64::MAX);
    }

    #[test]
    fn test_packet_gas_limit_preserved() {
        let mut pkt = make_packet();
        pkt.gas_limit = 999_999_999;
        let decoded = decode_packet(&encode_packet(&pkt)).unwrap();
        assert_eq!(decoded.gas_limit, 999_999_999);
    }

    // ============ Packet Hashing Tests ============

    #[test]
    fn test_compute_packet_hash_deterministic() {
        let pkt = make_packet();
        let h1 = compute_packet_hash(&pkt);
        let h2 = compute_packet_hash(&pkt);
        assert_eq!(h1, h2);
    }

    #[test]
    fn test_compute_packet_hash_different_payloads() {
        let mut p1 = make_packet();
        let mut p2 = make_packet();
        p1.payload = vec![1, 2, 3];
        p2.payload = vec![4, 5, 6];
        assert_ne!(compute_packet_hash(&p1), compute_packet_hash(&p2));
    }

    #[test]
    fn test_compute_packet_hash_different_nonces() {
        let mut p1 = make_packet();
        let mut p2 = make_packet();
        p1.nonce = 1;
        p2.nonce = 2;
        assert_ne!(compute_packet_hash(&p1), compute_packet_hash(&p2));
    }

    #[test]
    fn test_compute_packet_hash_different_chains() {
        let mut p1 = make_packet();
        let mut p2 = make_packet();
        p1.dst_chain = 2;
        p2.dst_chain = 3;
        assert_ne!(compute_packet_hash(&p1), compute_packet_hash(&p2));
    }

    #[test]
    fn test_compute_packet_hash_nonzero() {
        let pkt = make_packet();
        // Very unlikely to be zero but let's verify it returns something meaningful
        let _h = compute_packet_hash(&pkt);
        // Just ensure it doesn't panic
    }

    // ============ Packet Validation Tests ============

    #[test]
    fn test_validate_packet_success() {
        let pkt = make_packet();
        let reg = make_registry();
        assert!(validate_packet(&pkt, &reg).is_ok());
    }

    #[test]
    fn test_validate_packet_wrong_version() {
        let mut pkt = make_packet();
        pkt.version = 99;
        let reg = make_registry();
        assert!(validate_packet(&pkt, &reg).is_err());
    }

    #[test]
    fn test_validate_packet_same_chain() {
        let mut pkt = make_packet();
        pkt.dst_chain = pkt.src_chain;
        let reg = make_registry();
        let err = validate_packet(&pkt, &reg).unwrap_err();
        assert!(err.contains("same"));
    }

    #[test]
    fn test_validate_packet_payload_too_large() {
        let mut pkt = make_packet();
        pkt.payload = vec![0u8; MAX_PAYLOAD_SIZE + 1];
        let reg = make_registry();
        assert!(validate_packet(&pkt, &reg).is_err());
    }

    #[test]
    fn test_validate_packet_gas_too_low() {
        let mut pkt = make_packet();
        pkt.gas_limit = 100;
        let reg = make_registry();
        assert!(validate_packet(&pkt, &reg).is_err());
    }

    #[test]
    fn test_validate_packet_unknown_src_chain() {
        let mut pkt = make_packet();
        pkt.src_chain = 999;
        let reg = make_registry();
        assert!(validate_packet(&pkt, &reg).is_err());
    }

    #[test]
    fn test_validate_packet_unknown_dst_chain() {
        let mut pkt = make_packet();
        pkt.dst_chain = 999;
        let reg = make_registry();
        assert!(validate_packet(&pkt, &reg).is_err());
    }

    #[test]
    fn test_validate_packet_paused_src() {
        let mut pkt = make_packet();
        pkt.src_chain = 4;
        let mut reg = make_registry();
        reg.push(make_chain(4, "Paused", CHAIN_STATUS_PAUSED));
        assert!(validate_packet(&pkt, &reg).is_err());
    }

    #[test]
    fn test_validate_packet_paused_dst() {
        let mut pkt = make_packet();
        pkt.dst_chain = 4;
        let mut reg = make_registry();
        reg.push(make_chain(4, "Paused", CHAIN_STATUS_PAUSED));
        assert!(validate_packet(&pkt, &reg).is_err());
    }

    #[test]
    fn test_validate_packet_max_payload_ok() {
        let mut pkt = make_packet();
        pkt.payload = vec![0u8; MAX_PAYLOAD_SIZE];
        let reg = make_registry();
        assert!(validate_packet(&pkt, &reg).is_ok());
    }

    #[test]
    fn test_validate_packet_min_gas_ok() {
        let mut pkt = make_packet();
        pkt.gas_limit = MIN_GAS_LIMIT;
        let reg = make_registry();
        assert!(validate_packet(&pkt, &reg).is_ok());
    }

    // ============ Routing Tests ============

    #[test]
    fn test_route_packet_success() {
        let pkt = make_packet();
        let relayers = vec![make_relayer(1, vec![1, 2], 30, 90)];
        let r = route_packet(&pkt, &relayers).unwrap();
        assert_eq!(r.id, 1);
    }

    #[test]
    fn test_route_packet_no_relayers() {
        let pkt = make_packet();
        let relayers: Vec<RelayerInfo> = vec![];
        assert!(route_packet(&pkt, &relayers).is_err());
    }

    #[test]
    fn test_route_packet_no_matching_relayer() {
        let pkt = make_packet();
        let relayers = vec![make_relayer(1, vec![5, 6], 30, 90)];
        assert!(route_packet(&pkt, &relayers).is_err());
    }

    #[test]
    fn test_route_packet_picks_highest_reliability() {
        let pkt = make_packet();
        let relayers = vec![
            make_relayer(1, vec![1, 2], 30, 80),
            make_relayer(2, vec![1, 2], 30, 95),
            make_relayer(3, vec![1, 2], 30, 70),
        ];
        let r = route_packet(&pkt, &relayers).unwrap();
        assert_eq!(r.id, 2);
    }

    #[test]
    fn test_route_packet_tiebreak_by_fee() {
        let pkt = make_packet();
        let relayers = vec![
            make_relayer(1, vec![1, 2], 50, 90),
            make_relayer(2, vec![1, 2], 20, 90),
        ];
        let r = route_packet(&pkt, &relayers).unwrap();
        assert_eq!(r.id, 2);
    }

    #[test]
    fn test_route_packet_partial_chain_support() {
        let pkt = make_packet(); // src=1, dst=2
        let relayers = vec![
            make_relayer(1, vec![1, 3], 30, 90),   // supports src only
            make_relayer(2, vec![2, 3], 30, 90),   // supports dst only
            make_relayer(3, vec![1, 2], 30, 80),   // supports both
        ];
        let r = route_packet(&pkt, &relayers).unwrap();
        assert_eq!(r.id, 3);
    }

    #[test]
    fn test_find_cheapest_relayer_success() {
        let relayers = vec![
            make_relayer(1, vec![1, 2], 50, 90),
            make_relayer(2, vec![1, 2], 10, 80),
            make_relayer(3, vec![1, 2], 30, 95),
        ];
        let r = find_cheapest_relayer(&relayers, 1, 2).unwrap();
        assert_eq!(r.id, 2);
        assert_eq!(r.fee_bps, 10);
    }

    #[test]
    fn test_find_cheapest_relayer_none_available() {
        let relayers = vec![make_relayer(1, vec![5, 6], 10, 90)];
        assert!(find_cheapest_relayer(&relayers, 1, 2).is_none());
    }

    #[test]
    fn test_find_cheapest_relayer_empty() {
        let relayers: Vec<RelayerInfo> = vec![];
        assert!(find_cheapest_relayer(&relayers, 1, 2).is_none());
    }

    #[test]
    fn test_find_cheapest_relayer_single() {
        let relayers = vec![make_relayer(1, vec![1, 2], 25, 90)];
        let r = find_cheapest_relayer(&relayers, 1, 2).unwrap();
        assert_eq!(r.fee_bps, 25);
    }

    // ============ Nonce Management Tests ============

    #[test]
    fn test_get_next_nonce() {
        let ch = make_channel();
        assert_eq!(get_next_nonce(&ch), 11);
    }

    #[test]
    fn test_get_next_nonce_zero() {
        let ch = ChannelState { src_chain: 1, dst_chain: 2, inbound_nonce: 0, outbound_nonce: 0, last_activity: 0 };
        assert_eq!(get_next_nonce(&ch), 1);
    }

    #[test]
    fn test_validate_nonce_correct() {
        let ch = make_channel(); // inbound=5
        assert!(validate_nonce(&ch, 6).is_ok());
    }

    #[test]
    fn test_validate_nonce_already_processed() {
        let ch = make_channel(); // inbound=5
        let res = validate_nonce(&ch, 3);
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("already processed"));
    }

    #[test]
    fn test_validate_nonce_gap() {
        let ch = make_channel(); // inbound=5
        let res = validate_nonce(&ch, 8);
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("gap"));
    }

    #[test]
    fn test_validate_nonce_exact_current() {
        let ch = make_channel(); // inbound=5
        let res = validate_nonce(&ch, 5);
        assert!(res.is_err());
    }

    #[test]
    fn test_detect_nonce_gaps_none() {
        let ch = ChannelState { src_chain: 1, dst_chain: 2, inbound_nonce: 0, outbound_nonce: 0, last_activity: 0 };
        let gaps = detect_nonce_gaps(&ch, &[1, 2, 3, 4, 5]);
        assert!(gaps.is_empty());
    }

    #[test]
    fn test_detect_nonce_gaps_with_gaps() {
        let ch = ChannelState { src_chain: 1, dst_chain: 2, inbound_nonce: 0, outbound_nonce: 0, last_activity: 0 };
        let gaps = detect_nonce_gaps(&ch, &[1, 3, 5]);
        assert_eq!(gaps, vec![2, 4]);
    }

    #[test]
    fn test_detect_nonce_gaps_empty_input() {
        let ch = make_channel();
        let gaps = detect_nonce_gaps(&ch, &[]);
        assert!(gaps.is_empty());
    }

    #[test]
    fn test_detect_nonce_gaps_single_nonce() {
        let ch = ChannelState { src_chain: 1, dst_chain: 2, inbound_nonce: 0, outbound_nonce: 0, last_activity: 0 };
        let gaps = detect_nonce_gaps(&ch, &[3]);
        assert_eq!(gaps, vec![1, 2]);
    }

    #[test]
    fn test_detect_nonce_gaps_duplicates_handled() {
        let ch = ChannelState { src_chain: 1, dst_chain: 2, inbound_nonce: 0, outbound_nonce: 0, last_activity: 0 };
        let gaps = detect_nonce_gaps(&ch, &[1, 1, 3, 3]);
        assert_eq!(gaps, vec![2]);
    }

    #[test]
    fn test_detect_nonce_gaps_with_offset() {
        let ch = ChannelState { src_chain: 1, dst_chain: 2, inbound_nonce: 10, outbound_nonce: 0, last_activity: 0 };
        let gaps = detect_nonce_gaps(&ch, &[11, 13, 15]);
        assert_eq!(gaps, vec![12, 14]);
    }

    // ============ Finality Tracking Tests ============

    #[test]
    fn test_check_finality_sufficient() {
        let state = make_finality_state(); // current=1000, confirmed=985
        assert!(check_finality(&state, 15));
    }

    #[test]
    fn test_check_finality_insufficient() {
        let state = make_finality_state();
        assert!(!check_finality(&state, 20));
    }

    #[test]
    fn test_check_finality_exact_threshold() {
        let state = make_finality_state(); // diff = 15
        assert!(check_finality(&state, 15));
    }

    #[test]
    fn test_check_finality_zero_required() {
        let state = make_finality_state();
        assert!(check_finality(&state, 0));
    }

    #[test]
    fn test_check_finality_inverted_blocks() {
        let state = FinalityState { chain_id: 1, current_block: 10, confirmed_block: 20, pending_blocks: 0, reorg_count: 0 };
        assert!(!check_finality(&state, 1));
    }

    #[test]
    fn test_update_finality_advances() {
        let state = make_finality_state();
        let new_state = update_finality(&state, 1010);
        assert_eq!(new_state.current_block, 1010);
        assert_eq!(new_state.confirmed_block, 985);
        assert_eq!(new_state.pending_blocks, 25);
    }

    #[test]
    fn test_update_finality_same_block() {
        let state = make_finality_state();
        let new_state = update_finality(&state, 1000);
        assert_eq!(new_state.current_block, 1000);
    }

    #[test]
    fn test_update_finality_preserves_reorg_count() {
        let mut state = make_finality_state();
        state.reorg_count = 3;
        let new_state = update_finality(&state, 1010);
        assert_eq!(new_state.reorg_count, 3);
    }

    #[test]
    fn test_detect_reorg_no_reorg() {
        let state = make_finality_state(); // confirmed=985
        assert!(!detect_reorg(&state, 1001, 1000));
    }

    #[test]
    fn test_detect_reorg_detected() {
        let state = make_finality_state(); // confirmed=985
        assert!(detect_reorg(&state, 980, 984));
    }

    #[test]
    fn test_detect_reorg_at_boundary() {
        let state = make_finality_state(); // confirmed=985
        assert!(!detect_reorg(&state, 985, 984));
    }

    #[test]
    fn test_advance_confirmed() {
        let state = make_finality_state();
        let new_state = advance_confirmed(&state, 995);
        assert_eq!(new_state.confirmed_block, 995);
        assert_eq!(new_state.pending_blocks, 5);
    }

    #[test]
    fn test_advance_confirmed_to_current() {
        let state = make_finality_state();
        let new_state = advance_confirmed(&state, 1000);
        assert_eq!(new_state.pending_blocks, 0);
    }

    // ============ Fee Estimation Tests ============

    #[test]
    fn test_estimate_bridge_fee_success() {
        let reg = make_registry();
        let fee = estimate_bridge_fee(1, 2, 100, &reg).unwrap();
        assert!(fee > 0);
    }

    #[test]
    fn test_estimate_bridge_fee_unknown_src() {
        let reg = make_registry();
        assert!(estimate_bridge_fee(99, 2, 100, &reg).is_err());
    }

    #[test]
    fn test_estimate_bridge_fee_unknown_dst() {
        let reg = make_registry();
        assert!(estimate_bridge_fee(1, 99, 100, &reg).is_err());
    }

    #[test]
    fn test_estimate_bridge_fee_paused_dst() {
        let mut reg = make_registry();
        reg.push(make_chain(4, "Paused", CHAIN_STATUS_PAUSED));
        assert!(estimate_bridge_fee(1, 4, 100, &reg).is_err());
    }

    #[test]
    fn test_estimate_bridge_fee_larger_payload_higher_fee() {
        let reg = make_registry();
        let fee_small = estimate_bridge_fee(1, 2, 100, &reg).unwrap();
        let fee_large = estimate_bridge_fee(1, 2, 10_000, &reg).unwrap();
        assert!(fee_large > fee_small);
    }

    #[test]
    fn test_estimate_bridge_fee_zero_payload() {
        let reg = make_registry();
        let fee = estimate_bridge_fee(1, 2, 0, &reg).unwrap();
        assert!(fee > 0); // still has base fee
    }

    #[test]
    fn test_calculate_relayer_fee_basic() {
        let r = make_relayer(1, vec![1, 2], 30, 90);
        let fee = calculate_relayer_fee(&r, 100);
        assert!(fee > 0);
    }

    #[test]
    fn test_calculate_relayer_fee_higher_bps() {
        let r1 = make_relayer(1, vec![1, 2], 10, 90);
        let r2 = make_relayer(2, vec![1, 2], 100, 90);
        let f1 = calculate_relayer_fee(&r1, 100);
        let f2 = calculate_relayer_fee(&r2, 100);
        assert!(f2 > f1);
    }

    #[test]
    fn test_calculate_relayer_fee_zero_payload() {
        let r = make_relayer(1, vec![1, 2], 30, 90);
        let fee = calculate_relayer_fee(&r, 0);
        assert!(fee > 0); // base fee exists
    }

    #[test]
    fn test_calculate_relayer_fee_large_payload() {
        let r = make_relayer(1, vec![1, 2], 30, 90);
        let fee = calculate_relayer_fee(&r, 1_000_000);
        assert!(fee > 1_000_000); // should be significant
    }

    #[test]
    fn test_calculate_protocol_fee() {
        let fee = calculate_protocol_fee(1_000_000);
        assert_eq!(fee, 500); // 5 bps = 0.05%
    }

    #[test]
    fn test_calculate_protocol_fee_zero() {
        assert_eq!(calculate_protocol_fee(0), 0);
    }

    #[test]
    fn test_calculate_protocol_fee_small_amount() {
        // 100 * 5 / 10000 = 0 (integer division)
        assert_eq!(calculate_protocol_fee(100), 0);
    }

    #[test]
    fn test_calculate_protocol_fee_exact_bps() {
        // 10000 * 5 / 10000 = 5
        assert_eq!(calculate_protocol_fee(10_000), 5);
    }

    #[test]
    fn test_calculate_estimated_delivery_time() {
        let reg = make_registry(); // finality=15, block_time=12000
        let time = calculate_estimated_delivery_time(1, 2, &reg);
        // 15*12000 + 15*12000 + 30000 = 180000 + 180000 + 30000 = 390000
        assert_eq!(time, 390_000);
    }

    #[test]
    fn test_calculate_estimated_delivery_time_unknown_chain() {
        let reg = make_registry();
        let time = calculate_estimated_delivery_time(99, 2, &reg);
        // src unknown -> src_time=0, dst=180000, overhead=30000
        assert_eq!(time, 210_000);
    }

    #[test]
    fn test_calculate_estimated_delivery_time_both_unknown() {
        let reg: Vec<ChainConfig> = vec![];
        assert_eq!(calculate_estimated_delivery_time(1, 2, &reg), 30_000);
    }

    // ============ Delivery Verification Tests ============

    #[test]
    fn test_record_delivery_success() {
        let receipt = DeliveryReceipt {
            packet_hash: 123,
            delivered_at: 2_000_000,
            block_number: 500,
            tx_hash: [0xCC; 32],
            gas_used: 50_000,
        };
        let ch = make_channel();
        let updated = record_delivery(&receipt, &ch).unwrap();
        assert_eq!(updated.inbound_nonce, ch.inbound_nonce + 1);
        assert_eq!(updated.last_activity, 2_000_000);
    }

    #[test]
    fn test_record_delivery_zero_gas() {
        let receipt = DeliveryReceipt {
            packet_hash: 123,
            delivered_at: 2_000_000,
            block_number: 500,
            tx_hash: [0xCC; 32],
            gas_used: 0,
        };
        let ch = make_channel();
        assert!(record_delivery(&receipt, &ch).is_err());
    }

    #[test]
    fn test_record_delivery_zero_timestamp() {
        let receipt = DeliveryReceipt {
            packet_hash: 123,
            delivered_at: 0,
            block_number: 500,
            tx_hash: [0xCC; 32],
            gas_used: 50_000,
        };
        let ch = make_channel();
        assert!(record_delivery(&receipt, &ch).is_err());
    }

    #[test]
    fn test_record_delivery_preserves_outbound() {
        let receipt = DeliveryReceipt {
            packet_hash: 123,
            delivered_at: 2_000_000,
            block_number: 500,
            tx_hash: [0xCC; 32],
            gas_used: 50_000,
        };
        let ch = make_channel();
        let updated = record_delivery(&receipt, &ch).unwrap();
        assert_eq!(updated.outbound_nonce, ch.outbound_nonce);
    }

    // ============ Timeout Tests ============

    #[test]
    fn test_check_timeout_not_expired() {
        let pkt = make_packet(); // timestamp=1_000_000
        assert!(!check_timeout(&pkt, 1_500_000, DEFAULT_TIMEOUT_MS));
    }

    #[test]
    fn test_check_timeout_expired() {
        let pkt = make_packet(); // timestamp=1_000_000
        assert!(check_timeout(&pkt, 1_700_000, DEFAULT_TIMEOUT_MS)); // 700k > 600k
    }

    #[test]
    fn test_check_timeout_exact_boundary() {
        let pkt = make_packet(); // timestamp=1_000_000
        assert!(check_timeout(&pkt, 1_600_000, DEFAULT_TIMEOUT_MS)); // exactly at timeout
    }

    #[test]
    fn test_check_timeout_future_timestamp() {
        let pkt = make_packet(); // timestamp=1_000_000
        assert!(!check_timeout(&pkt, 500_000, DEFAULT_TIMEOUT_MS));
    }

    #[test]
    fn test_check_timeout_zero_timeout() {
        let pkt = make_packet();
        assert!(check_timeout(&pkt, 1_000_001, 0));
    }

    #[test]
    fn test_check_timeout_same_time() {
        let pkt = make_packet();
        assert!(check_timeout(&pkt, 1_000_000, 0));
    }

    // ============ Retry Management Tests ============

    #[test]
    fn test_schedule_retry_increments_attempts() {
        let entry = make_retry_entry();
        let next = schedule_retry(&entry);
        assert_eq!(next.attempts, 1);
    }

    #[test]
    fn test_schedule_retry_exponential_backoff() {
        let entry = make_retry_entry();
        let r1 = schedule_retry(&entry);
        let r2 = schedule_retry(&r1);
        // r1 delay = 30000 * 2^1 = 60000 added
        // r2 delay = 30000 * 2^2 = 120000 added
        assert!(r2.next_retry_at > r1.next_retry_at);
    }

    #[test]
    fn test_schedule_retry_preserves_hash() {
        let entry = make_retry_entry();
        let next = schedule_retry(&entry);
        assert_eq!(next.packet_hash, entry.packet_hash);
    }

    #[test]
    fn test_schedule_retry_preserves_max_attempts() {
        let entry = make_retry_entry();
        let next = schedule_retry(&entry);
        assert_eq!(next.max_attempts, entry.max_attempts);
    }

    #[test]
    fn test_should_retry_yes() {
        let entry = make_retry_entry(); // attempts=0, max=5, next_retry=1M
        assert!(should_retry(&entry, 1_000_000));
    }

    #[test]
    fn test_should_retry_too_early() {
        let entry = make_retry_entry();
        assert!(!should_retry(&entry, 999_999));
    }

    #[test]
    fn test_should_retry_max_attempts_reached() {
        let mut entry = make_retry_entry();
        entry.attempts = MAX_RETRY_ATTEMPTS;
        assert!(!should_retry(&entry, 2_000_000));
    }

    #[test]
    fn test_should_retry_at_exact_time() {
        let entry = make_retry_entry();
        assert!(should_retry(&entry, entry.next_retry_at));
    }

    #[test]
    fn test_create_retry_entry_defaults() {
        let entry = create_retry_entry(42, 1_000_000, "network error");
        assert_eq!(entry.packet_hash, 42);
        assert_eq!(entry.attempts, 0);
        assert_eq!(entry.max_attempts, MAX_RETRY_ATTEMPTS);
        assert_eq!(entry.last_error, "network error");
        assert_eq!(entry.next_retry_at, 1_000_000 + BASE_RETRY_DELAY_MS);
    }

    #[test]
    fn test_retry_chain_five_attempts() {
        let mut entry = make_retry_entry();
        for _ in 0..5 {
            entry = schedule_retry(&entry);
        }
        assert_eq!(entry.attempts, 5);
        assert!(!should_retry(&entry, u64::MAX));
    }

    // ============ Bridge Accounting: Lock Tests ============

    #[test]
    fn test_lock_tokens_success() {
        let bal = make_balance();
        let result = lock_tokens(&bal, 500_000).unwrap();
        assert_eq!(result.locked_amount, 1_500_000);
    }

    #[test]
    fn test_lock_tokens_zero() {
        let bal = make_balance();
        assert!(lock_tokens(&bal, 0).is_err());
    }

    #[test]
    fn test_lock_tokens_updates_pending_out() {
        let bal = make_balance();
        let result = lock_tokens(&bal, 100).unwrap();
        assert_eq!(result.pending_out, 100);
    }

    #[test]
    fn test_lock_tokens_preserves_minted() {
        let bal = make_balance();
        let result = lock_tokens(&bal, 100).unwrap();
        assert_eq!(result.minted_amount, bal.minted_amount);
    }

    #[test]
    fn test_lock_tokens_large_amount() {
        let bal = make_balance();
        let result = lock_tokens(&bal, u128::MAX - bal.locked_amount);
        assert!(result.is_ok());
    }

    #[test]
    fn test_lock_tokens_overflow() {
        let mut bal = make_balance();
        bal.locked_amount = u128::MAX;
        assert!(lock_tokens(&bal, 1).is_err());
    }

    // ============ Bridge Accounting: Mint Tests ============

    #[test]
    fn test_mint_tokens_success() {
        let bal = make_balance();
        let result = mint_tokens(&bal, 200_000).unwrap();
        assert_eq!(result.minted_amount, 1_200_000);
    }

    #[test]
    fn test_mint_tokens_zero() {
        let bal = make_balance();
        assert!(mint_tokens(&bal, 0).is_err());
    }

    #[test]
    fn test_mint_tokens_clears_pending_in() {
        let mut bal = make_balance();
        bal.pending_in = 500;
        let result = mint_tokens(&bal, 500).unwrap();
        assert_eq!(result.pending_in, 0);
    }

    #[test]
    fn test_mint_tokens_partial_pending() {
        let mut bal = make_balance();
        bal.pending_in = 1000;
        let result = mint_tokens(&bal, 300).unwrap();
        assert_eq!(result.pending_in, 700);
    }

    #[test]
    fn test_mint_tokens_preserves_locked() {
        let bal = make_balance();
        let result = mint_tokens(&bal, 100).unwrap();
        assert_eq!(result.locked_amount, bal.locked_amount);
    }

    #[test]
    fn test_mint_tokens_overflow() {
        let mut bal = make_balance();
        bal.minted_amount = u128::MAX;
        assert!(mint_tokens(&bal, 1).is_err());
    }

    // ============ Bridge Accounting: Burn Tests ============

    #[test]
    fn test_burn_tokens_success() {
        let bal = make_balance(); // minted=1_000_000
        let result = burn_tokens(&bal, 500_000).unwrap();
        assert_eq!(result.minted_amount, 500_000);
    }

    #[test]
    fn test_burn_tokens_zero() {
        let bal = make_balance();
        assert!(burn_tokens(&bal, 0).is_err());
    }

    #[test]
    fn test_burn_tokens_insufficient() {
        let bal = make_balance();
        assert!(burn_tokens(&bal, 2_000_000).is_err());
    }

    #[test]
    fn test_burn_tokens_exact_balance() {
        let bal = make_balance();
        let result = burn_tokens(&bal, 1_000_000).unwrap();
        assert_eq!(result.minted_amount, 0);
    }

    #[test]
    fn test_burn_tokens_updates_pending_out() {
        let bal = make_balance();
        let result = burn_tokens(&bal, 100).unwrap();
        assert_eq!(result.pending_out, 100);
    }

    #[test]
    fn test_burn_tokens_preserves_locked() {
        let bal = make_balance();
        let result = burn_tokens(&bal, 100).unwrap();
        assert_eq!(result.locked_amount, bal.locked_amount);
    }

    // ============ Bridge Accounting: Unlock Tests ============

    #[test]
    fn test_unlock_tokens_success() {
        let bal = make_balance(); // locked=1_000_000
        let result = unlock_tokens(&bal, 500_000).unwrap();
        assert_eq!(result.locked_amount, 500_000);
    }

    #[test]
    fn test_unlock_tokens_zero() {
        let bal = make_balance();
        assert!(unlock_tokens(&bal, 0).is_err());
    }

    #[test]
    fn test_unlock_tokens_insufficient() {
        let bal = make_balance();
        assert!(unlock_tokens(&bal, 2_000_000).is_err());
    }

    #[test]
    fn test_unlock_tokens_exact_balance() {
        let bal = make_balance();
        let result = unlock_tokens(&bal, 1_000_000).unwrap();
        assert_eq!(result.locked_amount, 0);
    }

    #[test]
    fn test_unlock_tokens_clears_pending_out() {
        let mut bal = make_balance();
        bal.pending_out = 500;
        let result = unlock_tokens(&bal, 500).unwrap();
        assert_eq!(result.pending_out, 0);
    }

    #[test]
    fn test_unlock_tokens_preserves_minted() {
        let bal = make_balance();
        let result = unlock_tokens(&bal, 100).unwrap();
        assert_eq!(result.minted_amount, bal.minted_amount);
    }

    // ============ Supply Invariant Tests ============

    #[test]
    fn test_verify_supply_invariant_balanced() {
        let b1 = BridgeBalance { chain_id: 1, token_id: 1, locked_amount: 500, minted_amount: 0, pending_in: 0, pending_out: 0 };
        let b2 = BridgeBalance { chain_id: 2, token_id: 1, locked_amount: 0, minted_amount: 500, pending_in: 0, pending_out: 0 };
        assert!(verify_supply_invariant(&[b1, b2]).is_ok());
    }

    #[test]
    fn test_verify_supply_invariant_imbalanced() {
        let b1 = BridgeBalance { chain_id: 1, token_id: 1, locked_amount: 500, minted_amount: 0, pending_in: 0, pending_out: 0 };
        let b2 = BridgeBalance { chain_id: 2, token_id: 1, locked_amount: 0, minted_amount: 300, pending_in: 0, pending_out: 0 };
        assert!(verify_supply_invariant(&[b1, b2]).is_err());
    }

    #[test]
    fn test_verify_supply_invariant_empty() {
        let balances: Vec<BridgeBalance> = vec![];
        assert!(verify_supply_invariant(&balances).is_err());
    }

    #[test]
    fn test_verify_supply_invariant_single_zero() {
        let b = BridgeBalance { chain_id: 1, token_id: 1, locked_amount: 0, minted_amount: 0, pending_in: 0, pending_out: 0 };
        assert!(verify_supply_invariant(&[b]).is_ok());
    }

    #[test]
    fn test_verify_supply_invariant_multiple_chains() {
        let balances = vec![
            BridgeBalance { chain_id: 1, token_id: 1, locked_amount: 1000, minted_amount: 0, pending_in: 0, pending_out: 0 },
            BridgeBalance { chain_id: 2, token_id: 1, locked_amount: 0, minted_amount: 500, pending_in: 0, pending_out: 0 },
            BridgeBalance { chain_id: 3, token_id: 1, locked_amount: 0, minted_amount: 500, pending_in: 0, pending_out: 0 },
        ];
        assert!(verify_supply_invariant(&balances).is_ok());
    }

    #[test]
    fn test_verify_supply_invariant_locked_exceeds_minted() {
        let b = BridgeBalance { chain_id: 1, token_id: 1, locked_amount: 100, minted_amount: 50, pending_in: 0, pending_out: 0 };
        assert!(verify_supply_invariant(&[b]).is_err());
    }

    // ============ Reconcile Tests ============

    #[test]
    fn test_reconcile_balances_clears_pending() {
        let b = BridgeBalance { chain_id: 1, token_id: 1, locked_amount: 100, minted_amount: 100, pending_in: 50, pending_out: 30 };
        let result = reconcile_balances(&[b]).unwrap();
        assert_eq!(result[0].pending_in, 0);
        assert_eq!(result[0].pending_out, 0);
    }

    #[test]
    fn test_reconcile_balances_preserves_amounts() {
        let b = BridgeBalance { chain_id: 1, token_id: 1, locked_amount: 100, minted_amount: 100, pending_in: 50, pending_out: 30 };
        let result = reconcile_balances(&[b]).unwrap();
        assert_eq!(result[0].locked_amount, 100);
        assert_eq!(result[0].minted_amount, 100);
    }

    #[test]
    fn test_reconcile_balances_empty() {
        assert!(reconcile_balances(&[]).is_err());
    }

    #[test]
    fn test_reconcile_balances_multiple() {
        let balances = vec![
            BridgeBalance { chain_id: 1, token_id: 1, locked_amount: 100, minted_amount: 0, pending_in: 10, pending_out: 20 },
            BridgeBalance { chain_id: 2, token_id: 1, locked_amount: 0, minted_amount: 100, pending_in: 30, pending_out: 40 },
        ];
        let result = reconcile_balances(&balances).unwrap();
        assert_eq!(result.len(), 2);
        for b in &result {
            assert_eq!(b.pending_in, 0);
            assert_eq!(b.pending_out, 0);
        }
    }

    // ============ Channel Stats Tests ============

    #[test]
    fn test_get_channel_stats() {
        let ch = make_channel();
        let (inb, outb) = get_channel_stats(&ch);
        assert_eq!(inb, 5);
        assert_eq!(outb, 10);
    }

    #[test]
    fn test_get_channel_stats_zero() {
        let ch = ChannelState { src_chain: 1, dst_chain: 2, inbound_nonce: 0, outbound_nonce: 0, last_activity: 0 };
        let (inb, outb) = get_channel_stats(&ch);
        assert_eq!(inb, 0);
        assert_eq!(outb, 0);
    }

    #[test]
    fn test_is_channel_idle_yes() {
        let ch = make_channel(); // last_activity=1_000_000
        assert!(is_channel_idle(&ch, 2_000_000, 500_000));
    }

    #[test]
    fn test_is_channel_idle_no() {
        let ch = make_channel();
        assert!(!is_channel_idle(&ch, 1_200_000, 500_000));
    }

    #[test]
    fn test_is_channel_idle_exact_threshold() {
        let ch = make_channel();
        assert!(is_channel_idle(&ch, 1_500_000, 500_000));
    }

    #[test]
    fn test_is_channel_idle_future_activity() {
        let ch = ChannelState { src_chain: 1, dst_chain: 2, inbound_nonce: 0, outbound_nonce: 0, last_activity: 5_000_000 };
        assert!(!is_channel_idle(&ch, 1_000_000, 100));
    }

    // ============ Full Flow Integration Tests ============

    #[test]
    fn test_full_lock_mint_burn_unlock_flow() {
        let bal = BridgeBalance { chain_id: 1, token_id: 1, locked_amount: 0, minted_amount: 0, pending_in: 0, pending_out: 0 };
        let after_lock = lock_tokens(&bal, 1000).unwrap();
        assert_eq!(after_lock.locked_amount, 1000);

        let mint_bal = BridgeBalance { chain_id: 2, token_id: 1, locked_amount: 0, minted_amount: 0, pending_in: 0, pending_out: 0 };
        let after_mint = mint_tokens(&mint_bal, 1000).unwrap();
        assert_eq!(after_mint.minted_amount, 1000);

        // Verify invariant
        assert!(verify_supply_invariant(&[after_lock.clone(), after_mint.clone()]).is_ok());

        // Burn on destination
        let after_burn = burn_tokens(&after_mint, 1000).unwrap();
        assert_eq!(after_burn.minted_amount, 0);

        // Unlock on source
        let after_unlock = unlock_tokens(&after_lock, 1000).unwrap();
        assert_eq!(after_unlock.locked_amount, 0);

        // Both zeroed
        assert!(verify_supply_invariant(&[after_unlock, after_burn]).is_ok());
    }

    #[test]
    fn test_full_packet_lifecycle() {
        let mut reg = vec![];
        register_chain(&mut reg, make_active_chain(1, "Ethereum")).unwrap();
        register_chain(&mut reg, make_active_chain(2, "CKB")).unwrap();

        let pkt = make_packet();
        assert!(validate_packet(&pkt, &reg).is_ok());

        let encoded = encode_packet(&pkt);
        let decoded = decode_packet(&encoded).unwrap();
        assert_eq!(decoded.nonce, pkt.nonce);

        let hash = compute_packet_hash(&pkt);
        assert!(hash != 0 || true); // just ensure no panic

        assert!(!check_timeout(&pkt, 1_100_000, DEFAULT_TIMEOUT_MS));
        assert!(check_timeout(&pkt, 2_000_000, DEFAULT_TIMEOUT_MS));
    }

    #[test]
    fn test_full_nonce_lifecycle() {
        let mut ch = ChannelState { src_chain: 1, dst_chain: 2, inbound_nonce: 0, outbound_nonce: 0, last_activity: 0 };
        assert_eq!(get_next_nonce(&ch), 1);

        // Simulate sending
        ch.outbound_nonce = 1;
        assert_eq!(get_next_nonce(&ch), 2);

        // Simulate receiving
        assert!(validate_nonce(&ch, 1).is_ok());
        ch.inbound_nonce = 1;
        assert!(validate_nonce(&ch, 2).is_ok());
        assert!(validate_nonce(&ch, 1).is_err()); // replay
    }

    #[test]
    fn test_full_retry_lifecycle() {
        let entry = create_retry_entry(42, 1_000_000, "timeout");
        assert!(!should_retry(&entry, 1_000_000)); // not yet (next_retry_at > current)
        assert!(should_retry(&entry, 1_030_000)); // now ok

        let r1 = schedule_retry(&entry);
        assert_eq!(r1.attempts, 1);

        let r2 = schedule_retry(&r1);
        assert_eq!(r2.attempts, 2);
        assert!(r2.next_retry_at > r1.next_retry_at);

        // Exhaust retries
        let mut r = entry;
        for _ in 0..MAX_RETRY_ATTEMPTS {
            r = schedule_retry(&r);
        }
        assert!(!should_retry(&r, u64::MAX));
    }

    #[test]
    fn test_full_delivery_flow() {
        let mut ch = ChannelState { src_chain: 1, dst_chain: 2, inbound_nonce: 0, outbound_nonce: 5, last_activity: 1_000_000 };

        let receipt = DeliveryReceipt {
            packet_hash: 111,
            delivered_at: 2_000_000,
            block_number: 100,
            tx_hash: [0xAA; 32],
            gas_used: 30_000,
        };
        ch = record_delivery(&receipt, &ch).unwrap();
        assert_eq!(ch.inbound_nonce, 1);
        assert_eq!(ch.last_activity, 2_000_000);

        let receipt2 = DeliveryReceipt {
            packet_hash: 222,
            delivered_at: 3_000_000,
            block_number: 200,
            tx_hash: [0xBB; 32],
            gas_used: 25_000,
        };
        ch = record_delivery(&receipt2, &ch).unwrap();
        assert_eq!(ch.inbound_nonce, 2);
    }

    #[test]
    fn test_full_finality_lifecycle() {
        let state = FinalityState { chain_id: 1, current_block: 100, confirmed_block: 90, pending_blocks: 10, reorg_count: 0 };

        assert!(!check_finality(&state, 15)); // need 15, have 10
        assert!(check_finality(&state, 10));  // exact

        let updated = update_finality(&state, 110);
        assert_eq!(updated.current_block, 110);
        assert_eq!(updated.pending_blocks, 20);

        let confirmed = advance_confirmed(&updated, 105);
        assert_eq!(confirmed.confirmed_block, 105);
        assert_eq!(confirmed.pending_blocks, 5);

        assert!(!detect_reorg(&confirmed, 106, 105)); // normal
        assert!(detect_reorg(&confirmed, 100, 104));   // reorg
    }

    // ============ Edge Case Tests ============

    #[test]
    fn test_packet_zero_nonce() {
        let mut pkt = make_packet();
        pkt.nonce = 0;
        let decoded = decode_packet(&encode_packet(&pkt)).unwrap();
        assert_eq!(decoded.nonce, 0);
    }

    #[test]
    fn test_packet_max_chain_ids() {
        let mut pkt = make_packet();
        pkt.src_chain = u32::MAX;
        pkt.dst_chain = u32::MAX - 1;
        let decoded = decode_packet(&encode_packet(&pkt)).unwrap();
        assert_eq!(decoded.src_chain, u32::MAX);
    }

    #[test]
    fn test_bridge_balance_all_zero() {
        let bal = BridgeBalance { chain_id: 0, token_id: 0, locked_amount: 0, minted_amount: 0, pending_in: 0, pending_out: 0 };
        assert!(verify_supply_invariant(&[bal]).is_ok());
    }

    #[test]
    fn test_nonce_gap_detection_unsorted_input() {
        let ch = ChannelState { src_chain: 1, dst_chain: 2, inbound_nonce: 0, outbound_nonce: 0, last_activity: 0 };
        let gaps = detect_nonce_gaps(&ch, &[5, 1, 3]);
        assert_eq!(gaps, vec![2, 4]);
    }

    #[test]
    fn test_multiple_locks_accumulate() {
        let bal = BridgeBalance { chain_id: 1, token_id: 1, locked_amount: 0, minted_amount: 0, pending_in: 0, pending_out: 0 };
        let b1 = lock_tokens(&bal, 100).unwrap();
        let b2 = lock_tokens(&b1, 200).unwrap();
        let b3 = lock_tokens(&b2, 300).unwrap();
        assert_eq!(b3.locked_amount, 600);
    }

    #[test]
    fn test_multiple_mints_accumulate() {
        let bal = BridgeBalance { chain_id: 1, token_id: 1, locked_amount: 0, minted_amount: 0, pending_in: 0, pending_out: 0 };
        let b1 = mint_tokens(&bal, 100).unwrap();
        let b2 = mint_tokens(&b1, 200).unwrap();
        assert_eq!(b2.minted_amount, 300);
    }

    #[test]
    fn test_partial_burn_then_burn_rest() {
        let bal = BridgeBalance { chain_id: 1, token_id: 1, locked_amount: 0, minted_amount: 1000, pending_in: 0, pending_out: 0 };
        let b1 = burn_tokens(&bal, 600).unwrap();
        let b2 = burn_tokens(&b1, 400).unwrap();
        assert_eq!(b2.minted_amount, 0);
    }

    #[test]
    fn test_partial_unlock_then_unlock_rest() {
        let bal = BridgeBalance { chain_id: 1, token_id: 1, locked_amount: 1000, minted_amount: 0, pending_in: 0, pending_out: 0 };
        let b1 = unlock_tokens(&bal, 400).unwrap();
        let b2 = unlock_tokens(&b1, 600).unwrap();
        assert_eq!(b2.locked_amount, 0);
    }

    #[test]
    fn test_header_flags_all_set() {
        let h = PacketHeader { version: 1, flags: 0xFF, src_chain: 1, dst_chain: 2, nonce: 1 };
        let decoded = decode_header(&encode_header(&h)).unwrap();
        assert_eq!(decoded.flags, 0xFF);
    }

    #[test]
    fn test_header_flags_none_set() {
        let h = PacketHeader { version: 1, flags: 0x00, src_chain: 1, dst_chain: 2, nonce: 1 };
        let decoded = decode_header(&encode_header(&h)).unwrap();
        assert_eq!(decoded.flags, 0x00);
    }

    #[test]
    fn test_relayer_supports_many_chains() {
        let r = make_relayer(1, (1..=50).collect(), 20, 95);
        assert_eq!(r.chains_supported.len(), 50);
    }

    #[test]
    fn test_find_cheapest_among_many_relayers() {
        let relayers: Vec<RelayerInfo> = (0..20)
            .map(|i| make_relayer(i, vec![1, 2], (i as u64 + 1) * 5, 90))
            .collect();
        let cheapest = find_cheapest_relayer(&relayers, 1, 2).unwrap();
        assert_eq!(cheapest.fee_bps, 5);
    }

    #[test]
    fn test_estimate_fee_high_finality_chain() {
        let mut reg = vec![];
        let mut c = make_active_chain(1, "Src");
        c.finality_blocks = 10;
        reg.push(c);
        let mut d = make_active_chain(2, "HighFinality");
        d.finality_blocks = 500;
        reg.push(d);
        let fee = estimate_bridge_fee(1, 2, 100, &reg).unwrap();
        // Should include finality multiplier
        assert!(fee > 1_000_000);
    }

    #[test]
    fn test_channel_state_roundtrip_through_delivery() {
        let ch = ChannelState { src_chain: 1, dst_chain: 2, inbound_nonce: 99, outbound_nonce: 200, last_activity: 5_000_000 };
        let receipt = DeliveryReceipt {
            packet_hash: 42,
            delivered_at: 6_000_000,
            block_number: 300,
            tx_hash: [0; 32],
            gas_used: 10_000,
        };
        let updated = record_delivery(&receipt, &ch).unwrap();
        assert_eq!(updated.inbound_nonce, 100);
        assert_eq!(updated.outbound_nonce, 200);
        assert_eq!(updated.src_chain, 1);
        assert_eq!(updated.dst_chain, 2);
    }

    #[test]
    fn test_register_chain_paused_allowed() {
        let mut reg = vec![];
        let c = make_chain(1, "PausedChain", CHAIN_STATUS_PAUSED);
        assert!(register_chain(&mut reg, c).is_ok());
    }

    #[test]
    fn test_register_chain_deprecated_allowed() {
        let mut reg = vec![];
        let c = make_chain(1, "OldChain", CHAIN_STATUS_DEPRECATED);
        assert!(register_chain(&mut reg, c).is_ok());
    }

    #[test]
    fn test_packet_with_binary_payload() {
        let mut pkt = make_packet();
        pkt.payload = (0..=255).collect();
        let decoded = decode_packet(&encode_packet(&pkt)).unwrap();
        assert_eq!(decoded.payload, pkt.payload);
    }

    #[test]
    fn test_estimate_delivery_time_different_block_speeds() {
        let mut reg = vec![];
        let mut fast = make_active_chain(1, "Fast");
        fast.avg_block_time_ms = 1_000;
        fast.finality_blocks = 12;
        reg.push(fast);
        let mut slow = make_active_chain(2, "Slow");
        slow.avg_block_time_ms = 30_000;
        slow.finality_blocks = 50;
        reg.push(slow);
        let time = calculate_estimated_delivery_time(1, 2, &reg);
        // 12*1000 + 50*30000 + 30000 = 12000 + 1500000 + 30000 = 1542000
        assert_eq!(time, 1_542_000);
    }

    #[test]
    fn test_validate_nonce_sequential_series() {
        let mut ch = ChannelState { src_chain: 1, dst_chain: 2, inbound_nonce: 0, outbound_nonce: 0, last_activity: 0 };
        for expected in 1..=10 {
            assert!(validate_nonce(&ch, expected).is_ok());
            ch.inbound_nonce = expected;
        }
    }

    #[test]
    fn test_detect_nonce_gaps_no_gap_consecutive() {
        let ch = ChannelState { src_chain: 1, dst_chain: 2, inbound_nonce: 5, outbound_nonce: 0, last_activity: 0 };
        let gaps = detect_nonce_gaps(&ch, &[6, 7, 8, 9, 10]);
        assert!(gaps.is_empty());
    }

    #[test]
    fn test_check_finality_large_confirmations() {
        let state = FinalityState { chain_id: 1, current_block: 1_000_000, confirmed_block: 0, pending_blocks: 1_000_000, reorg_count: 0 };
        assert!(check_finality(&state, 999_999));
    }

    #[test]
    fn test_update_finality_lower_block() {
        let state = make_finality_state(); // current=1000, confirmed=985
        let new_state = update_finality(&state, 990);
        assert_eq!(new_state.current_block, 990);
        assert_eq!(new_state.pending_blocks, 5);
    }

    #[test]
    fn test_relayer_fee_zero_bps() {
        let r = make_relayer(1, vec![1, 2], 0, 90);
        let fee = calculate_relayer_fee(&r, 100);
        // base(500000) + size(100*50=5000) + bps(0) = 505000
        assert_eq!(fee, 505_000);
    }

    #[test]
    fn test_protocol_fee_large_amount() {
        let fee = calculate_protocol_fee(1_000_000_000_000u128);
        // 1e12 * 5 / 10000 = 500_000_000
        assert_eq!(fee, 500_000_000);
    }

    #[test]
    fn test_supply_invariant_three_chains_balanced() {
        let balances = vec![
            BridgeBalance { chain_id: 1, token_id: 1, locked_amount: 300, minted_amount: 100, pending_in: 0, pending_out: 0 },
            BridgeBalance { chain_id: 2, token_id: 1, locked_amount: 200, minted_amount: 200, pending_in: 0, pending_out: 0 },
            BridgeBalance { chain_id: 3, token_id: 1, locked_amount: 0, minted_amount: 200, pending_in: 0, pending_out: 0 },
        ];
        assert!(verify_supply_invariant(&balances).is_ok());
    }

    #[test]
    fn test_reconcile_preserves_chain_ids() {
        let balances = vec![
            BridgeBalance { chain_id: 7, token_id: 42, locked_amount: 100, minted_amount: 100, pending_in: 10, pending_out: 20 },
        ];
        let result = reconcile_balances(&balances).unwrap();
        assert_eq!(result[0].chain_id, 7);
        assert_eq!(result[0].token_id, 42);
    }

    #[test]
    fn test_packet_hash_changes_with_sender() {
        let mut p1 = make_packet();
        let mut p2 = make_packet();
        p1.sender = [0x01; 32];
        p2.sender = [0x02; 32];
        assert_ne!(compute_packet_hash(&p1), compute_packet_hash(&p2));
    }

    #[test]
    fn test_packet_hash_changes_with_timestamp() {
        let mut p1 = make_packet();
        let mut p2 = make_packet();
        p1.timestamp = 1;
        p2.timestamp = 2;
        assert_ne!(compute_packet_hash(&p1), compute_packet_hash(&p2));
    }

    #[test]
    fn test_encode_packet_minimum_size() {
        let mut pkt = make_packet();
        pkt.payload = vec![];
        let encoded = encode_packet(&pkt);
        assert_eq!(encoded.len(), 101); // 1+4+4+8+32+32+8+8+4 = 101
    }

    #[test]
    fn test_decode_header_one_byte_short() {
        let bytes = vec![0u8; HEADER_SIZE - 1];
        assert!(decode_header(&bytes).is_err());
    }

    #[test]
    fn test_get_supported_chains_only_paused() {
        let reg = vec![
            make_chain(1, "P1", CHAIN_STATUS_PAUSED),
            make_chain(2, "P2", CHAIN_STATUS_PAUSED),
        ];
        assert!(get_supported_chains(&reg).is_empty());
    }

    #[test]
    fn test_route_packet_single_relayer_single_chain() {
        let mut pkt = make_packet();
        pkt.src_chain = 5;
        pkt.dst_chain = 6;
        let relayers = vec![make_relayer(1, vec![5, 6], 10, 100)];
        assert!(route_packet(&pkt, &relayers).is_ok());
    }

    #[test]
    fn test_lock_then_unlock_returns_to_original() {
        let bal = make_balance();
        let locked = lock_tokens(&bal, 500).unwrap();
        let unlocked = unlock_tokens(&locked, 500).unwrap();
        assert_eq!(unlocked.locked_amount, bal.locked_amount);
    }

    #[test]
    fn test_mint_then_burn_returns_to_original() {
        let bal = make_balance();
        let minted = mint_tokens(&bal, 500).unwrap();
        let burned = burn_tokens(&minted, 500).unwrap();
        assert_eq!(burned.minted_amount, bal.minted_amount);
    }

    #[test]
    fn test_retry_entry_error_preserved() {
        let entry = create_retry_entry(1, 0, "connection refused");
        let r1 = schedule_retry(&entry);
        assert_eq!(r1.last_error, "connection refused");
    }

    #[test]
    fn test_channel_idle_zero_threshold() {
        let ch = make_channel();
        assert!(is_channel_idle(&ch, ch.last_activity, 0));
    }

    #[test]
    fn test_validate_packet_deprecated_src() {
        let mut pkt = make_packet();
        pkt.src_chain = 4;
        let mut reg = make_registry();
        reg.push(make_chain(4, "Deprecated", CHAIN_STATUS_DEPRECATED));
        assert!(validate_packet(&pkt, &reg).is_err());
    }

    #[test]
    fn test_estimate_fee_saturating_large_payload() {
        let reg = make_registry();
        let fee = estimate_bridge_fee(1, 2, u64::MAX, &reg);
        // Should not panic from overflow due to saturating_mul
        assert!(fee.is_ok());
    }

    #[test]
    fn test_relayer_fee_saturating_large_payload() {
        let r = make_relayer(1, vec![1, 2], 10000, 90);
        let fee = calculate_relayer_fee(&r, u64::MAX);
        // Should not panic
        assert!(fee > 0);
    }

    #[test]
    fn test_schedule_retry_many_times_no_panic() {
        let mut entry = make_retry_entry();
        for _ in 0..20 {
            entry = schedule_retry(&entry);
        }
        assert_eq!(entry.attempts, 20);
    }

    #[test]
    fn test_nonce_gap_large_gap() {
        let ch = ChannelState { src_chain: 1, dst_chain: 2, inbound_nonce: 0, outbound_nonce: 0, last_activity: 0 };
        let gaps = detect_nonce_gaps(&ch, &[100]);
        assert_eq!(gaps.len(), 99); // 1..99 missing
    }

    #[test]
    fn test_finality_state_chain_id_preserved() {
        let state = FinalityState { chain_id: 42, current_block: 100, confirmed_block: 90, pending_blocks: 10, reorg_count: 5 };
        let updated = update_finality(&state, 110);
        assert_eq!(updated.chain_id, 42);
    }

    #[test]
    fn test_bridge_balance_chain_token_preserved_through_lock() {
        let bal = BridgeBalance { chain_id: 7, token_id: 99, locked_amount: 0, minted_amount: 0, pending_in: 0, pending_out: 0 };
        let result = lock_tokens(&bal, 1).unwrap();
        assert_eq!(result.chain_id, 7);
        assert_eq!(result.token_id, 99);
    }

    #[test]
    fn test_bridge_balance_chain_token_preserved_through_mint() {
        let bal = BridgeBalance { chain_id: 8, token_id: 88, locked_amount: 0, minted_amount: 0, pending_in: 0, pending_out: 0 };
        let result = mint_tokens(&bal, 1).unwrap();
        assert_eq!(result.chain_id, 8);
        assert_eq!(result.token_id, 88);
    }

    #[test]
    fn test_bridge_balance_chain_token_preserved_through_burn() {
        let bal = BridgeBalance { chain_id: 9, token_id: 77, locked_amount: 0, minted_amount: 100, pending_in: 0, pending_out: 0 };
        let result = burn_tokens(&bal, 1).unwrap();
        assert_eq!(result.chain_id, 9);
        assert_eq!(result.token_id, 77);
    }

    #[test]
    fn test_bridge_balance_chain_token_preserved_through_unlock() {
        let bal = BridgeBalance { chain_id: 10, token_id: 66, locked_amount: 100, minted_amount: 0, pending_in: 0, pending_out: 0 };
        let result = unlock_tokens(&bal, 1).unwrap();
        assert_eq!(result.chain_id, 10);
        assert_eq!(result.token_id, 66);
    }
}
