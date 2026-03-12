// ============ Snapshot Module ============
// Protocol State Snapshots — capturing point-in-time state for governance votes,
// reward distributions, and historical analytics. On CKB's UTXO model, snapshots
// capture cell states at specific heights.
//
// Functions are pure where possible. Snapshots are built incrementally (create,
// add balances/pools, finalize) or constructed from complete data. Merkle proofs
// enable trustless verification of individual balances against the snapshot root.

use sha2::{Digest, Sha256};

// ============ Constants ============

/// Estimated bytes per BalanceRecord for storage sizing.
pub const BYTES_PER_RECORD: u64 = 160;

/// Estimated bytes per PoolSnapshot for storage sizing.
pub const BYTES_PER_POOL: u64 = 120;

/// Base overhead bytes for a Snapshot struct (fields, vec headers, merkle root).
pub const SNAPSHOT_BASE_BYTES: u64 = 256;

// ============ Error Types ============

#[derive(Debug, Clone, PartialEq)]
pub enum SnapshotError {
    NotFound,
    AlreadyExists,
    InvalidHeight,
    InvalidMerkleProof,
    EmptySnapshot,
    HeightNotReached,
    ScheduleDisabled,
    RetentionExceeded,
    InvalidDiff,
    Overflow,
    AddressNotFound,
}

// ============ Snapshot Types ============

#[derive(Debug, Clone, PartialEq)]
pub enum SnapshotType {
    /// For voting power at proposal creation
    Governance,
    /// For reward distribution calculation
    Rewards,
    /// For protocol upgrade state capture
    Migration,
    /// For historical metrics
    Analytics,
    /// Emergency state capture (circuit breaker)
    Emergency,
}

// ============ Data Structures ============

#[derive(Debug, Clone)]
pub struct BalanceRecord {
    pub address: [u8; 32],
    pub token_balance: u64,
    pub lp_shares: u64,
    pub staked_amount: u64,
    /// veVIBE power at snapshot time
    pub voting_power: u64,
    /// Lock expiry if staked
    pub locked_until: u64,
}

#[derive(Debug, Clone)]
pub struct PoolSnapshot {
    pub pool_id: [u8; 32],
    pub reserve_a: u64,
    pub reserve_b: u64,
    pub total_lp: u64,
    /// Scaled by 1e8
    pub spot_price: u64,
    pub cumulative_volume: u128,
    pub fee_rate_bps: u64,
}

#[derive(Debug, Clone)]
pub struct Snapshot {
    pub snapshot_id: u64,
    pub snapshot_type: SnapshotType,
    pub block_height: u64,
    pub timestamp: u64,
    pub balances: Vec<BalanceRecord>,
    pub pools: Vec<PoolSnapshot>,
    pub total_supply: u64,
    pub circulating_supply: u64,
    pub total_staked: u64,
    pub total_locked: u64,
    /// Root of balance merkle tree
    pub merkle_root: [u8; 32],
    /// Arbitrary context (e.g., proposal_id)
    pub metadata: u64,
}

#[derive(Debug, Clone)]
pub struct SnapshotDiff {
    pub from_id: u64,
    pub to_id: u64,
    pub new_addresses: Vec<[u8; 32]>,
    pub removed_addresses: Vec<[u8; 32]>,
    /// (address, net change as signed value)
    pub balance_changes: Vec<([u8; 32], i128)>,
    pub supply_change: i128,
    pub staked_change: i128,
    pub pool_count_change: i32,
}

#[derive(Debug, Clone)]
pub struct SnapshotSchedule {
    /// Take snapshot every N blocks
    pub interval_blocks: u64,
    pub last_snapshot_height: u64,
    pub next_snapshot_height: u64,
    pub snapshot_types: Vec<SnapshotType>,
    /// Keep last N snapshots
    pub retention_count: u64,
    pub enabled: bool,
}

#[derive(Debug, Clone)]
pub struct MerkleProof {
    pub leaf_hash: [u8; 32],
    pub siblings: Vec<[u8; 32]>,
    /// Left (false) or right (true) at each level
    pub path_bits: Vec<bool>,
}

// ============ Snapshot Creation ============

/// Create an empty snapshot at the given height.
pub fn create_snapshot(
    id: u64,
    snapshot_type: SnapshotType,
    height: u64,
    timestamp: u64,
) -> Snapshot {
    Snapshot {
        snapshot_id: id,
        snapshot_type,
        block_height: height,
        timestamp,
        balances: Vec::new(),
        pools: Vec::new(),
        total_supply: 0,
        circulating_supply: 0,
        total_staked: 0,
        total_locked: 0,
        merkle_root: [0u8; 32],
        metadata: 0,
    }
}

/// Add a balance record. Rejects duplicate addresses.
pub fn add_balance(
    snapshot: &mut Snapshot,
    record: BalanceRecord,
) -> Result<(), SnapshotError> {
    for existing in &snapshot.balances {
        if existing.address == record.address {
            return Err(SnapshotError::AlreadyExists);
        }
    }
    snapshot.balances.push(record);
    Ok(())
}

/// Add a pool snapshot. Rejects duplicate pool_ids.
pub fn add_pool(
    snapshot: &mut Snapshot,
    pool: PoolSnapshot,
) -> Result<(), SnapshotError> {
    for existing in &snapshot.pools {
        if existing.pool_id == pool.pool_id {
            return Err(SnapshotError::AlreadyExists);
        }
    }
    snapshot.pools.push(pool);
    Ok(())
}

/// Finalize a snapshot: compute totals and merkle root. Requires at least one balance.
pub fn finalize_snapshot(snapshot: &mut Snapshot) -> Result<(), SnapshotError> {
    if snapshot.balances.is_empty() {
        return Err(SnapshotError::EmptySnapshot);
    }

    let mut total_supply: u64 = 0;
    let mut total_staked: u64 = 0;
    let mut total_locked: u64 = 0;

    for b in &snapshot.balances {
        total_supply = total_supply.checked_add(b.token_balance)
            .ok_or(SnapshotError::Overflow)?;
        total_staked = total_staked.checked_add(b.staked_amount)
            .ok_or(SnapshotError::Overflow)?;
        total_locked = total_locked.checked_add(b.lp_shares)
            .ok_or(SnapshotError::Overflow)?;
    }

    snapshot.total_supply = total_supply;
    snapshot.total_staked = total_staked;
    snapshot.total_locked = total_locked;
    snapshot.circulating_supply = total_supply.saturating_sub(total_staked);

    let leaves: Vec<[u8; 32]> = snapshot
        .balances
        .iter()
        .map(|b| compute_leaf_hash(b))
        .collect();
    snapshot.merkle_root = compute_merkle_root(&leaves);

    Ok(())
}

/// Build a snapshot from complete data in one call.
pub fn from_balances(
    id: u64,
    stype: SnapshotType,
    height: u64,
    ts: u64,
    balances: Vec<BalanceRecord>,
    pools: Vec<PoolSnapshot>,
) -> Result<Snapshot, SnapshotError> {
    if balances.is_empty() {
        return Err(SnapshotError::EmptySnapshot);
    }
    // Check for duplicate addresses
    for i in 0..balances.len() {
        for j in (i + 1)..balances.len() {
            if balances[i].address == balances[j].address {
                return Err(SnapshotError::AlreadyExists);
            }
        }
    }
    // Check for duplicate pool_ids
    for i in 0..pools.len() {
        for j in (i + 1)..pools.len() {
            if pools[i].pool_id == pools[j].pool_id {
                return Err(SnapshotError::AlreadyExists);
            }
        }
    }

    let mut snap = Snapshot {
        snapshot_id: id,
        snapshot_type: stype,
        block_height: height,
        timestamp: ts,
        balances,
        pools,
        total_supply: 0,
        circulating_supply: 0,
        total_staked: 0,
        total_locked: 0,
        merkle_root: [0u8; 32],
        metadata: 0,
    };
    finalize_snapshot(&mut snap)?;
    Ok(snap)
}

// ============ Balance Queries ============

/// Look up a balance record by address.
pub fn get_balance<'a>(
    snapshot: &'a Snapshot,
    address: &[u8; 32],
) -> Option<&'a BalanceRecord> {
    snapshot.balances.iter().find(|b| &b.address == address)
}

/// Return voting power for an address, or 0 if not found.
pub fn voting_power_at(snapshot: &Snapshot, address: &[u8; 32]) -> u64 {
    get_balance(snapshot, address)
        .map(|b| b.voting_power)
        .unwrap_or(0)
}

/// Sum of all voting power across all holders.
pub fn total_voting_power(snapshot: &Snapshot) -> u128 {
    snapshot
        .balances
        .iter()
        .map(|b| b.voting_power as u128)
        .sum()
}

/// Top holders sorted by token_balance descending, limited to `count`.
pub fn top_holders(snapshot: &Snapshot, count: usize) -> Vec<&BalanceRecord> {
    let mut sorted: Vec<&BalanceRecord> = snapshot.balances.iter().collect();
    sorted.sort_by(|a, b| b.token_balance.cmp(&a.token_balance));
    sorted.truncate(count);
    sorted
}

/// Number of balance records (unique holders).
pub fn holder_count(snapshot: &Snapshot) -> usize {
    snapshot.balances.len()
}

/// Addresses with token_balance >= min_balance.
pub fn addresses_above_threshold(
    snapshot: &Snapshot,
    min_balance: u64,
) -> Vec<[u8; 32]> {
    snapshot
        .balances
        .iter()
        .filter(|b| b.token_balance >= min_balance)
        .map(|b| b.address)
        .collect()
}

/// Percentile rank of an address by token_balance (0-10000 bps).
/// Returns None if address not found.
pub fn balance_percentile(
    snapshot: &Snapshot,
    address: &[u8; 32],
) -> Option<u64> {
    let record = get_balance(snapshot, address)?;
    let balance = record.token_balance;
    let total = snapshot.balances.len() as u64;
    if total == 0 {
        return None;
    }
    let below = snapshot
        .balances
        .iter()
        .filter(|b| b.token_balance < balance)
        .count() as u64;
    Some(below * 10_000 / total)
}

// ============ Pool Queries ============

/// Look up a pool by pool_id.
pub fn get_pool<'a>(
    snapshot: &'a Snapshot,
    pool_id: &[u8; 32],
) -> Option<&'a PoolSnapshot> {
    snapshot.pools.iter().find(|p| &p.pool_id == pool_id)
}

/// Number of pools in the snapshot.
pub fn pool_count(snapshot: &Snapshot) -> usize {
    snapshot.pools.len()
}

/// Total TVL across all pools (simplified: reserve_a * 2 for each pool).
pub fn total_tvl(snapshot: &Snapshot) -> u128 {
    snapshot
        .pools
        .iter()
        .map(|p| (p.reserve_a as u128) * 2)
        .sum()
}

/// Largest pool by total reserves (reserve_a + reserve_b).
pub fn largest_pool(snapshot: &Snapshot) -> Option<&PoolSnapshot> {
    snapshot
        .pools
        .iter()
        .max_by_key(|p| (p.reserve_a as u128) + (p.reserve_b as u128))
}

// ============ Merkle Tree ============

/// Hash a balance record into a 32-byte leaf.
pub fn compute_leaf_hash(record: &BalanceRecord) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(record.address);
    hasher.update(record.token_balance.to_le_bytes());
    hasher.update(record.lp_shares.to_le_bytes());
    hasher.update(record.staked_amount.to_le_bytes());
    hasher.update(record.voting_power.to_le_bytes());
    hasher.update(record.locked_until.to_le_bytes());
    let result = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&result);
    out
}

/// Compute the merkle root of a set of leaf hashes. Empty input returns all zeros.
pub fn compute_merkle_root(leaves: &[[u8; 32]]) -> [u8; 32] {
    if leaves.is_empty() {
        return [0u8; 32];
    }
    if leaves.len() == 1 {
        return leaves[0];
    }

    let mut current_level: Vec<[u8; 32]> = leaves.to_vec();

    while current_level.len() > 1 {
        let mut next_level = Vec::new();
        let mut i = 0;
        while i < current_level.len() {
            let left = current_level[i];
            let right = if i + 1 < current_level.len() {
                current_level[i + 1]
            } else {
                // Duplicate last element for odd count
                current_level[i]
            };
            let mut hasher = Sha256::new();
            hasher.update(left);
            hasher.update(right);
            let result = hasher.finalize();
            let mut hash = [0u8; 32];
            hash.copy_from_slice(&result);
            next_level.push(hash);
            i += 2;
        }
        current_level = next_level;
    }

    current_level[0]
}

/// Generate a merkle proof for an address in the snapshot.
pub fn generate_proof(
    snapshot: &Snapshot,
    address: &[u8; 32],
) -> Result<MerkleProof, SnapshotError> {
    let idx = snapshot
        .balances
        .iter()
        .position(|b| &b.address == address)
        .ok_or(SnapshotError::AddressNotFound)?;

    let leaves: Vec<[u8; 32]> = snapshot
        .balances
        .iter()
        .map(|b| compute_leaf_hash(b))
        .collect();

    let leaf_hash = leaves[idx];
    let mut siblings = Vec::new();
    let mut path_bits = Vec::new();

    let mut current_level = leaves;
    let mut current_idx = idx;

    while current_level.len() > 1 {
        let is_right = current_idx % 2 == 1;
        path_bits.push(is_right);

        let sibling_idx = if is_right {
            current_idx - 1
        } else if current_idx + 1 < current_level.len() {
            current_idx + 1
        } else {
            current_idx // duplicate self for odd count
        };
        siblings.push(current_level[sibling_idx]);

        // Build next level
        let mut next_level = Vec::new();
        let mut i = 0;
        while i < current_level.len() {
            let left = current_level[i];
            let right = if i + 1 < current_level.len() {
                current_level[i + 1]
            } else {
                current_level[i]
            };
            let mut hasher = Sha256::new();
            hasher.update(left);
            hasher.update(right);
            let result = hasher.finalize();
            let mut hash = [0u8; 32];
            hash.copy_from_slice(&result);
            next_level.push(hash);
            i += 2;
        }
        current_level = next_level;
        current_idx /= 2;
    }

    Ok(MerkleProof {
        leaf_hash,
        siblings,
        path_bits,
    })
}

/// Verify a merkle proof against an expected root.
pub fn verify_proof(root: &[u8; 32], proof: &MerkleProof) -> bool {
    if proof.siblings.len() != proof.path_bits.len() {
        return false;
    }

    let mut current = proof.leaf_hash;

    for (sibling, &is_right) in proof.siblings.iter().zip(proof.path_bits.iter()) {
        let mut hasher = Sha256::new();
        if is_right {
            hasher.update(sibling);
            hasher.update(current);
        } else {
            hasher.update(current);
            hasher.update(sibling);
        }
        let result = hasher.finalize();
        current = [0u8; 32];
        current.copy_from_slice(&result);
    }

    current == *root
}

/// Depth of a merkle tree for `holder_count` leaves: ceil(log2(n)).
pub fn proof_depth(holder_count: usize) -> usize {
    if holder_count <= 1 {
        return 0;
    }
    let mut depth = 0;
    let mut n = holder_count - 1;
    while n > 0 {
        n >>= 1;
        depth += 1;
    }
    depth
}

// ============ Snapshot Comparison ============

/// Compute a diff between two snapshots.
pub fn diff_snapshots(old: &Snapshot, new: &Snapshot) -> SnapshotDiff {
    let old_addrs: Vec<[u8; 32]> = old.balances.iter().map(|b| b.address).collect();
    let new_addrs: Vec<[u8; 32]> = new.balances.iter().map(|b| b.address).collect();

    let new_addresses: Vec<[u8; 32]> = new_addrs
        .iter()
        .filter(|a| !old_addrs.contains(a))
        .copied()
        .collect();
    let removed_addresses: Vec<[u8; 32]> = old_addrs
        .iter()
        .filter(|a| !new_addrs.contains(a))
        .copied()
        .collect();

    let mut balance_changes = Vec::new();

    // Changes for addresses in new snapshot
    for nb in &new.balances {
        let old_bal = old
            .balances
            .iter()
            .find(|ob| ob.address == nb.address)
            .map(|ob| ob.token_balance as i128)
            .unwrap_or(0);
        let change = nb.token_balance as i128 - old_bal;
        if change != 0 {
            balance_changes.push((nb.address, change));
        }
    }
    // Addresses removed (balance went to 0)
    for ob in &old.balances {
        if !new_addrs.contains(&ob.address) {
            balance_changes.push((ob.address, -(ob.token_balance as i128)));
        }
    }

    let supply_change = new.total_supply as i128 - old.total_supply as i128;
    let staked_change = new.total_staked as i128 - old.total_staked as i128;
    let pool_count_change = new.pools.len() as i32 - old.pools.len() as i32;

    SnapshotDiff {
        from_id: old.snapshot_id,
        to_id: new.snapshot_id,
        new_addresses,
        removed_addresses,
        balance_changes,
        supply_change,
        staked_change,
        pool_count_change,
    }
}

/// Net balance change for a specific address between two snapshots.
pub fn net_balance_change(
    old: &Snapshot,
    new: &Snapshot,
    address: &[u8; 32],
) -> i128 {
    let old_bal = get_balance(old, address)
        .map(|b| b.token_balance as i128)
        .unwrap_or(0);
    let new_bal = get_balance(new, address)
        .map(|b| b.token_balance as i128)
        .unwrap_or(0);
    new_bal - old_bal
}

/// Addresses present in `new` but not in `old`.
pub fn new_holders(old: &Snapshot, new: &Snapshot) -> Vec<[u8; 32]> {
    let old_addrs: Vec<[u8; 32]> = old.balances.iter().map(|b| b.address).collect();
    new.balances
        .iter()
        .filter(|b| !old_addrs.contains(&b.address))
        .map(|b| b.address)
        .collect()
}

/// Addresses present in `old` but not in `new`.
pub fn lost_holders(old: &Snapshot, new: &Snapshot) -> Vec<[u8; 32]> {
    let new_addrs: Vec<[u8; 32]> = new.balances.iter().map(|b| b.address).collect();
    old.balances
        .iter()
        .filter(|b| !new_addrs.contains(&b.address))
        .map(|b| b.address)
        .collect()
}

/// Supply growth in basis points (can be negative).
pub fn supply_growth_bps(old: &Snapshot, new: &Snapshot) -> i64 {
    if old.total_supply == 0 {
        return 0;
    }
    let change = new.total_supply as i128 - old.total_supply as i128;
    ((change * 10_000) / old.total_supply as i128) as i64
}

// ============ Scheduling ============

/// Create a new snapshot schedule.
pub fn create_schedule(
    interval: u64,
    start_height: u64,
    types: Vec<SnapshotType>,
    retention: u64,
) -> SnapshotSchedule {
    SnapshotSchedule {
        interval_blocks: interval,
        last_snapshot_height: start_height,
        next_snapshot_height: start_height + interval,
        snapshot_types: types,
        retention_count: retention,
        enabled: true,
    }
}

/// Check if a snapshot should be taken at `current_height`.
pub fn should_snapshot(schedule: &SnapshotSchedule, current_height: u64) -> bool {
    if !schedule.enabled {
        return false;
    }
    current_height >= schedule.next_snapshot_height
}

/// Advance the schedule after taking a snapshot. Returns the new next height.
pub fn advance_schedule(schedule: &mut SnapshotSchedule) -> u64 {
    schedule.last_snapshot_height = schedule.next_snapshot_height;
    schedule.next_snapshot_height += schedule.interval_blocks;
    schedule.next_snapshot_height
}

/// Number of snapshots between now and `target_height`.
pub fn snapshots_until(schedule: &SnapshotSchedule, target_height: u64) -> u64 {
    if target_height <= schedule.next_snapshot_height || schedule.interval_blocks == 0 {
        return 0;
    }
    let remaining = target_height - schedule.next_snapshot_height;
    1 + remaining / schedule.interval_blocks
}

// ============ Retention & Storage ============

/// Prune oldest snapshots, keeping only `keep` most recent. Returns count removed.
/// Snapshots are assumed to be in chronological order (oldest first).
pub fn prune_old_snapshots(snapshots: &mut Vec<Snapshot>, keep: usize) -> usize {
    if snapshots.len() <= keep {
        return 0;
    }
    let remove = snapshots.len() - keep;
    snapshots.drain(0..remove);
    remove
}

/// Estimate storage size in bytes for a snapshot.
pub fn snapshot_size_estimate(snapshot: &Snapshot) -> u64 {
    SNAPSHOT_BASE_BYTES
        + (snapshot.balances.len() as u64) * BYTES_PER_RECORD
        + (snapshot.pools.len() as u64) * BYTES_PER_POOL
}

/// Binary search for a snapshot at exact height. Snapshots must be sorted by block_height.
pub fn find_snapshot_at_height(snapshots: &[Snapshot], height: u64) -> Option<usize> {
    snapshots
        .binary_search_by_key(&height, |s| s.block_height)
        .ok()
}

/// Find the snapshot nearest to `height`. Snapshots must be sorted by block_height.
pub fn find_nearest_snapshot(snapshots: &[Snapshot], height: u64) -> Option<usize> {
    if snapshots.is_empty() {
        return None;
    }
    match snapshots.binary_search_by_key(&height, |s| s.block_height) {
        Ok(idx) => Some(idx),
        Err(idx) => {
            if idx == 0 {
                Some(0)
            } else if idx >= snapshots.len() {
                Some(snapshots.len() - 1)
            } else {
                let diff_left = height - snapshots[idx - 1].block_height;
                let diff_right = snapshots[idx].block_height - height;
                if diff_left <= diff_right {
                    Some(idx - 1)
                } else {
                    Some(idx)
                }
            }
        }
    }
}

// ============ Reward Distribution ============

/// Compute reward shares proportional to voting power.
/// Returns (address, reward_amount) for each holder with voting_power > 0.
pub fn compute_shares(
    snapshot: &Snapshot,
    total_reward: u64,
) -> Vec<([u8; 32], u64)> {
    let total_vp = total_voting_power(snapshot);
    if total_vp == 0 {
        return Vec::new();
    }
    snapshot
        .balances
        .iter()
        .filter(|b| b.voting_power > 0)
        .map(|b| {
            let share =
                (b.voting_power as u128 * total_reward as u128) / total_vp;
            (b.address, share as u64)
        })
        .collect()
}

/// Compute reward shares only for holders above a minimum voting power.
pub fn compute_shares_with_minimum(
    snapshot: &Snapshot,
    total_reward: u64,
    min_power: u64,
) -> Vec<([u8; 32], u64)> {
    let eligible: Vec<&BalanceRecord> = snapshot
        .balances
        .iter()
        .filter(|b| b.voting_power >= min_power)
        .collect();
    let total_vp: u128 = eligible.iter().map(|b| b.voting_power as u128).sum();
    if total_vp == 0 {
        return Vec::new();
    }
    eligible
        .iter()
        .map(|b| {
            let share =
                (b.voting_power as u128 * total_reward as u128) / total_vp;
            (b.address, share as u64)
        })
        .collect()
}

/// Gini coefficient of token_balance distribution (0-10000 bps).
/// 0 = perfect equality, 10000 = maximum inequality.
pub fn gini_coefficient(snapshot: &Snapshot) -> u64 {
    let n = snapshot.balances.len();
    if n == 0 {
        return 0;
    }

    let mut balances: Vec<u64> = snapshot.balances.iter().map(|b| b.token_balance).collect();
    balances.sort();

    let total: u128 = balances.iter().map(|&b| b as u128).sum();
    if total == 0 {
        return 0;
    }

    // Gini = (2 * sum(i * x_i) - (n+1) * sum(x_i)) / (n * sum(x_i))
    // where i is 1-indexed rank (ascending order)
    let mut weighted_sum: u128 = 0;
    for (i, &b) in balances.iter().enumerate() {
        weighted_sum += (i as u128 + 1) * b as u128;
    }

    let numerator = 2 * weighted_sum;
    let n128 = n as u128;
    let subtracted = (n128 + 1) * total;

    if numerator >= subtracted {
        let gini_raw = (numerator - subtracted) * 10_000 / (n128 * total);
        gini_raw as u64
    } else {
        0
    }
}

// ============ Validation ============

/// Validate snapshot invariants (non-empty, merkle root matches).
pub fn validate_snapshot(snapshot: &Snapshot) -> Result<(), SnapshotError> {
    if snapshot.balances.is_empty() {
        return Err(SnapshotError::EmptySnapshot);
    }

    // Check for duplicate addresses
    for i in 0..snapshot.balances.len() {
        for j in (i + 1)..snapshot.balances.len() {
            if snapshot.balances[i].address == snapshot.balances[j].address {
                return Err(SnapshotError::AlreadyExists);
            }
        }
    }

    // Verify merkle root
    let leaves: Vec<[u8; 32]> = snapshot
        .balances
        .iter()
        .map(|b| compute_leaf_hash(b))
        .collect();
    let computed_root = compute_merkle_root(&leaves);
    if computed_root != snapshot.merkle_root {
        return Err(SnapshotError::InvalidMerkleProof);
    }

    Ok(())
}

/// Check that a sequence of snapshots has ascending heights and sequential IDs.
pub fn validate_snapshot_sequence(snapshots: &[Snapshot]) -> bool {
    if snapshots.len() <= 1 {
        return true;
    }
    for i in 1..snapshots.len() {
        if snapshots[i].block_height <= snapshots[i - 1].block_height {
            return false;
        }
        if snapshots[i].snapshot_id != snapshots[i - 1].snapshot_id + 1 {
            return false;
        }
    }
    true
}

/// Check if snapshot totals are consistent with sum of records.
pub fn is_consistent(snapshot: &Snapshot) -> bool {
    let sum_supply: u64 = snapshot
        .balances
        .iter()
        .map(|b| b.token_balance)
        .fold(0u64, |acc, x| acc.saturating_add(x));
    let sum_staked: u64 = snapshot
        .balances
        .iter()
        .map(|b| b.staked_amount)
        .fold(0u64, |acc, x| acc.saturating_add(x));

    sum_supply == snapshot.total_supply && sum_staked == snapshot.total_staked
}

// ============ Analytics ============

/// Concentration ratio: percentage of total supply held by top N holders (in bps).
pub fn concentration_ratio(snapshot: &Snapshot, top_n: usize) -> u64 {
    if snapshot.total_supply == 0 || snapshot.balances.is_empty() {
        return 0;
    }
    let top = top_holders(snapshot, top_n);
    let top_total: u128 = top.iter().map(|b| b.token_balance as u128).sum();
    ((top_total * 10_000) / snapshot.total_supply as u128) as u64
}

/// Nakamoto coefficient: minimum number of holders controlling >50% of voting power.
pub fn nakamoto_coefficient(snapshot: &Snapshot) -> usize {
    let total = total_voting_power(snapshot);
    if total == 0 {
        return 0;
    }
    let threshold = total / 2;

    let mut powers: Vec<u64> = snapshot.balances.iter().map(|b| b.voting_power).collect();
    powers.sort_by(|a, b| b.cmp(a)); // descending

    let mut cumulative: u128 = 0;
    for (i, &p) in powers.iter().enumerate() {
        cumulative += p as u128;
        if cumulative > threshold {
            return i + 1;
        }
    }
    powers.len()
}

/// Median token balance across all holders.
pub fn median_balance(snapshot: &Snapshot) -> u64 {
    if snapshot.balances.is_empty() {
        return 0;
    }
    let mut balances: Vec<u64> = snapshot.balances.iter().map(|b| b.token_balance).collect();
    balances.sort();
    let mid = balances.len() / 2;
    if balances.len() % 2 == 0 {
        // Average of two middle values
        (balances[mid - 1] / 2) + (balances[mid] / 2)
            + ((balances[mid - 1] % 2 + balances[mid] % 2) / 2)
    } else {
        balances[mid]
    }
}

/// Count of active stakers (staked_amount > 0 and lock not expired).
pub fn active_stakers(snapshot: &Snapshot, now: u64) -> usize {
    snapshot
        .balances
        .iter()
        .filter(|b| b.staked_amount > 0 && b.locked_until > now)
        .count()
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // ============ Test Helpers ============

    fn addr(n: u8) -> [u8; 32] {
        let mut a = [0u8; 32];
        a[0] = n;
        a
    }

    fn pool_id(n: u8) -> [u8; 32] {
        let mut a = [0u8; 32];
        a[31] = n;
        a
    }

    fn make_record(n: u8, balance: u64, vp: u64) -> BalanceRecord {
        BalanceRecord {
            address: addr(n),
            token_balance: balance,
            lp_shares: 0,
            staked_amount: 0,
            voting_power: vp,
            locked_until: 0,
        }
    }

    fn make_full_record(
        n: u8,
        balance: u64,
        lp: u64,
        staked: u64,
        vp: u64,
        locked: u64,
    ) -> BalanceRecord {
        BalanceRecord {
            address: addr(n),
            token_balance: balance,
            lp_shares: lp,
            staked_amount: staked,
            voting_power: vp,
            locked_until: locked,
        }
    }

    fn make_pool(n: u8, ra: u64, rb: u64) -> PoolSnapshot {
        PoolSnapshot {
            pool_id: pool_id(n),
            reserve_a: ra,
            reserve_b: rb,
            total_lp: ra + rb,
            spot_price: 100_000_000, // 1.0 scaled by 1e8
            cumulative_volume: 0,
            fee_rate_bps: 30,
        }
    }

    fn make_finalized_snapshot(records: Vec<BalanceRecord>) -> Snapshot {
        let mut snap = create_snapshot(1, SnapshotType::Governance, 100, 1000);
        for r in records {
            add_balance(&mut snap, r).unwrap();
        }
        finalize_snapshot(&mut snap).unwrap();
        snap
    }

    fn make_two_snapshots() -> (Snapshot, Snapshot) {
        let old = make_finalized_snapshot(vec![
            make_record(1, 1000, 100),
            make_record(2, 2000, 200),
            make_record(3, 500, 50),
        ]);

        let mut new_snap = create_snapshot(2, SnapshotType::Governance, 200, 2000);
        add_balance(&mut new_snap, make_record(1, 1500, 150)).unwrap();
        add_balance(&mut new_snap, make_record(2, 1800, 180)).unwrap();
        add_balance(&mut new_snap, make_record(4, 700, 70)).unwrap();
        finalize_snapshot(&mut new_snap).unwrap();

        (old, new_snap)
    }

    // ============ Snapshot Creation Tests ============

    #[test]
    fn test_create_snapshot_empty() {
        let snap = create_snapshot(1, SnapshotType::Governance, 100, 1000);
        assert_eq!(snap.snapshot_id, 1);
        assert_eq!(snap.snapshot_type, SnapshotType::Governance);
        assert_eq!(snap.block_height, 100);
        assert_eq!(snap.timestamp, 1000);
        assert!(snap.balances.is_empty());
        assert!(snap.pools.is_empty());
        assert_eq!(snap.total_supply, 0);
        assert_eq!(snap.merkle_root, [0u8; 32]);
    }

    #[test]
    fn test_create_snapshot_rewards_type() {
        let snap = create_snapshot(2, SnapshotType::Rewards, 200, 2000);
        assert_eq!(snap.snapshot_type, SnapshotType::Rewards);
    }

    #[test]
    fn test_create_snapshot_migration_type() {
        let snap = create_snapshot(3, SnapshotType::Migration, 300, 3000);
        assert_eq!(snap.snapshot_type, SnapshotType::Migration);
    }

    #[test]
    fn test_create_snapshot_analytics_type() {
        let snap = create_snapshot(4, SnapshotType::Analytics, 400, 4000);
        assert_eq!(snap.snapshot_type, SnapshotType::Analytics);
    }

    #[test]
    fn test_create_snapshot_emergency_type() {
        let snap = create_snapshot(5, SnapshotType::Emergency, 500, 5000);
        assert_eq!(snap.snapshot_type, SnapshotType::Emergency);
    }

    #[test]
    fn test_add_balance_single() {
        let mut snap = create_snapshot(1, SnapshotType::Governance, 100, 1000);
        let result = add_balance(&mut snap, make_record(1, 1000, 100));
        assert!(result.is_ok());
        assert_eq!(snap.balances.len(), 1);
    }

    #[test]
    fn test_add_balance_multiple() {
        let mut snap = create_snapshot(1, SnapshotType::Governance, 100, 1000);
        add_balance(&mut snap, make_record(1, 1000, 100)).unwrap();
        add_balance(&mut snap, make_record(2, 2000, 200)).unwrap();
        add_balance(&mut snap, make_record(3, 3000, 300)).unwrap();
        assert_eq!(snap.balances.len(), 3);
    }

    #[test]
    fn test_add_balance_duplicate_rejected() {
        let mut snap = create_snapshot(1, SnapshotType::Governance, 100, 1000);
        add_balance(&mut snap, make_record(1, 1000, 100)).unwrap();
        let result = add_balance(&mut snap, make_record(1, 2000, 200));
        assert_eq!(result, Err(SnapshotError::AlreadyExists));
        assert_eq!(snap.balances.len(), 1);
    }

    #[test]
    fn test_add_pool_single() {
        let mut snap = create_snapshot(1, SnapshotType::Governance, 100, 1000);
        let result = add_pool(&mut snap, make_pool(1, 1000, 2000));
        assert!(result.is_ok());
        assert_eq!(snap.pools.len(), 1);
    }

    #[test]
    fn test_add_pool_duplicate_rejected() {
        let mut snap = create_snapshot(1, SnapshotType::Governance, 100, 1000);
        add_pool(&mut snap, make_pool(1, 1000, 2000)).unwrap();
        let result = add_pool(&mut snap, make_pool(1, 3000, 4000));
        assert_eq!(result, Err(SnapshotError::AlreadyExists));
    }

    #[test]
    fn test_add_pool_different_ids() {
        let mut snap = create_snapshot(1, SnapshotType::Governance, 100, 1000);
        add_pool(&mut snap, make_pool(1, 1000, 2000)).unwrap();
        add_pool(&mut snap, make_pool(2, 3000, 4000)).unwrap();
        assert_eq!(snap.pools.len(), 2);
    }

    #[test]
    fn test_finalize_snapshot_computes_totals() {
        let mut snap = create_snapshot(1, SnapshotType::Governance, 100, 1000);
        add_balance(&mut snap, make_full_record(1, 1000, 50, 200, 100, 0)).unwrap();
        add_balance(&mut snap, make_full_record(2, 2000, 100, 300, 200, 0)).unwrap();
        finalize_snapshot(&mut snap).unwrap();

        assert_eq!(snap.total_supply, 3000);
        assert_eq!(snap.total_staked, 500);
        assert_eq!(snap.total_locked, 150); // sum of lp_shares
        assert_eq!(snap.circulating_supply, 2500); // 3000 - 500
        assert_ne!(snap.merkle_root, [0u8; 32]);
    }

    #[test]
    fn test_finalize_empty_fails() {
        let mut snap = create_snapshot(1, SnapshotType::Governance, 100, 1000);
        let result = finalize_snapshot(&mut snap);
        assert_eq!(result, Err(SnapshotError::EmptySnapshot));
    }

    #[test]
    fn test_finalize_sets_merkle_root() {
        let snap = make_finalized_snapshot(vec![make_record(1, 1000, 100)]);
        assert_ne!(snap.merkle_root, [0u8; 32]);
    }

    #[test]
    fn test_finalize_merkle_root_deterministic() {
        let snap1 = make_finalized_snapshot(vec![
            make_record(1, 1000, 100),
            make_record(2, 2000, 200),
        ]);
        let snap2 = make_finalized_snapshot(vec![
            make_record(1, 1000, 100),
            make_record(2, 2000, 200),
        ]);
        assert_eq!(snap1.merkle_root, snap2.merkle_root);
    }

    #[test]
    fn test_finalize_different_data_different_root() {
        let snap1 = make_finalized_snapshot(vec![make_record(1, 1000, 100)]);
        let snap2 = make_finalized_snapshot(vec![make_record(1, 2000, 200)]);
        assert_ne!(snap1.merkle_root, snap2.merkle_root);
    }

    #[test]
    fn test_from_balances_success() {
        let result = from_balances(
            1,
            SnapshotType::Rewards,
            100,
            1000,
            vec![make_record(1, 1000, 100), make_record(2, 2000, 200)],
            vec![make_pool(1, 500, 600)],
        );
        assert!(result.is_ok());
        let snap = result.unwrap();
        assert_eq!(snap.total_supply, 3000);
        assert_eq!(snap.pools.len(), 1);
        assert_ne!(snap.merkle_root, [0u8; 32]);
    }

    #[test]
    fn test_from_balances_empty_fails() {
        let result = from_balances(
            1,
            SnapshotType::Rewards,
            100,
            1000,
            vec![],
            vec![],
        );
        assert!(matches!(result, Err(SnapshotError::EmptySnapshot)));
    }

    #[test]
    fn test_from_balances_duplicate_address_fails() {
        let result = from_balances(
            1,
            SnapshotType::Rewards,
            100,
            1000,
            vec![make_record(1, 1000, 100), make_record(1, 2000, 200)],
            vec![],
        );
        assert!(matches!(result, Err(SnapshotError::AlreadyExists)));
    }

    #[test]
    fn test_from_balances_duplicate_pool_fails() {
        let result = from_balances(
            1,
            SnapshotType::Rewards,
            100,
            1000,
            vec![make_record(1, 1000, 100)],
            vec![make_pool(1, 500, 600), make_pool(1, 700, 800)],
        );
        assert!(matches!(result, Err(SnapshotError::AlreadyExists)));
    }

    // ============ Balance Query Tests ============

    #[test]
    fn test_get_balance_found() {
        let snap = make_finalized_snapshot(vec![
            make_record(1, 1000, 100),
            make_record(2, 2000, 200),
        ]);
        let result = get_balance(&snap, &addr(1));
        assert!(result.is_some());
        assert_eq!(result.unwrap().token_balance, 1000);
    }

    #[test]
    fn test_get_balance_not_found() {
        let snap = make_finalized_snapshot(vec![make_record(1, 1000, 100)]);
        let result = get_balance(&snap, &addr(99));
        assert!(result.is_none());
    }

    #[test]
    fn test_voting_power_at_found() {
        let snap = make_finalized_snapshot(vec![make_record(1, 1000, 500)]);
        assert_eq!(voting_power_at(&snap, &addr(1)), 500);
    }

    #[test]
    fn test_voting_power_at_not_found() {
        let snap = make_finalized_snapshot(vec![make_record(1, 1000, 500)]);
        assert_eq!(voting_power_at(&snap, &addr(99)), 0);
    }

    #[test]
    fn test_total_voting_power_single() {
        let snap = make_finalized_snapshot(vec![make_record(1, 1000, 500)]);
        assert_eq!(total_voting_power(&snap), 500);
    }

    #[test]
    fn test_total_voting_power_multiple() {
        let snap = make_finalized_snapshot(vec![
            make_record(1, 1000, 100),
            make_record(2, 2000, 200),
            make_record(3, 3000, 300),
        ]);
        assert_eq!(total_voting_power(&snap), 600);
    }

    #[test]
    fn test_total_voting_power_empty() {
        let snap = create_snapshot(1, SnapshotType::Governance, 100, 1000);
        assert_eq!(total_voting_power(&snap), 0);
    }

    #[test]
    fn test_top_holders_basic() {
        let snap = make_finalized_snapshot(vec![
            make_record(1, 100, 10),
            make_record(2, 300, 30),
            make_record(3, 200, 20),
        ]);
        let top = top_holders(&snap, 2);
        assert_eq!(top.len(), 2);
        assert_eq!(top[0].token_balance, 300);
        assert_eq!(top[1].token_balance, 200);
    }

    #[test]
    fn test_top_holders_count_exceeds_total() {
        let snap = make_finalized_snapshot(vec![make_record(1, 100, 10)]);
        let top = top_holders(&snap, 10);
        assert_eq!(top.len(), 1);
    }

    #[test]
    fn test_top_holders_zero() {
        let snap = make_finalized_snapshot(vec![make_record(1, 100, 10)]);
        let top = top_holders(&snap, 0);
        assert!(top.is_empty());
    }

    #[test]
    fn test_holder_count() {
        let snap = make_finalized_snapshot(vec![
            make_record(1, 100, 10),
            make_record(2, 200, 20),
        ]);
        assert_eq!(holder_count(&snap), 2);
    }

    #[test]
    fn test_holder_count_empty() {
        let snap = create_snapshot(1, SnapshotType::Governance, 100, 1000);
        assert_eq!(holder_count(&snap), 0);
    }

    #[test]
    fn test_addresses_above_threshold() {
        let snap = make_finalized_snapshot(vec![
            make_record(1, 100, 10),
            make_record(2, 500, 50),
            make_record(3, 200, 20),
            make_record(4, 1000, 100),
        ]);
        let result = addresses_above_threshold(&snap, 300);
        assert_eq!(result.len(), 2);
        assert!(result.contains(&addr(2)));
        assert!(result.contains(&addr(4)));
    }

    #[test]
    fn test_addresses_above_threshold_none_qualify() {
        let snap = make_finalized_snapshot(vec![make_record(1, 100, 10)]);
        let result = addresses_above_threshold(&snap, 500);
        assert!(result.is_empty());
    }

    #[test]
    fn test_addresses_above_threshold_exact_match() {
        let snap = make_finalized_snapshot(vec![make_record(1, 100, 10)]);
        let result = addresses_above_threshold(&snap, 100);
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn test_balance_percentile_highest() {
        let snap = make_finalized_snapshot(vec![
            make_record(1, 100, 10),
            make_record(2, 200, 20),
            make_record(3, 300, 30),
            make_record(4, 400, 40),
        ]);
        // addr(4) has highest balance: 3 below out of 4 total = 7500 bps
        let pct = balance_percentile(&snap, &addr(4)).unwrap();
        assert_eq!(pct, 7500);
    }

    #[test]
    fn test_balance_percentile_lowest() {
        let snap = make_finalized_snapshot(vec![
            make_record(1, 100, 10),
            make_record(2, 200, 20),
            make_record(3, 300, 30),
        ]);
        // addr(1) lowest: 0 below = 0 bps
        let pct = balance_percentile(&snap, &addr(1)).unwrap();
        assert_eq!(pct, 0);
    }

    #[test]
    fn test_balance_percentile_not_found() {
        let snap = make_finalized_snapshot(vec![make_record(1, 100, 10)]);
        assert!(balance_percentile(&snap, &addr(99)).is_none());
    }

    #[test]
    fn test_balance_percentile_single_holder() {
        let snap = make_finalized_snapshot(vec![make_record(1, 100, 10)]);
        // 0 below out of 1 = 0
        let pct = balance_percentile(&snap, &addr(1)).unwrap();
        assert_eq!(pct, 0);
    }

    // ============ Pool Query Tests ============

    #[test]
    fn test_get_pool_found() {
        let mut snap = make_finalized_snapshot(vec![make_record(1, 100, 10)]);
        add_pool(&mut snap, make_pool(1, 1000, 2000)).unwrap();
        let p = get_pool(&snap, &pool_id(1));
        assert!(p.is_some());
        assert_eq!(p.unwrap().reserve_a, 1000);
    }

    #[test]
    fn test_get_pool_not_found() {
        let snap = make_finalized_snapshot(vec![make_record(1, 100, 10)]);
        assert!(get_pool(&snap, &pool_id(99)).is_none());
    }

    #[test]
    fn test_pool_count_zero() {
        let snap = make_finalized_snapshot(vec![make_record(1, 100, 10)]);
        assert_eq!(pool_count(&snap), 0);
    }

    #[test]
    fn test_pool_count_multiple() {
        let mut snap = make_finalized_snapshot(vec![make_record(1, 100, 10)]);
        add_pool(&mut snap, make_pool(1, 1000, 2000)).unwrap();
        add_pool(&mut snap, make_pool(2, 3000, 4000)).unwrap();
        assert_eq!(pool_count(&snap), 2);
    }

    #[test]
    fn test_total_tvl() {
        let mut snap = make_finalized_snapshot(vec![make_record(1, 100, 10)]);
        add_pool(&mut snap, make_pool(1, 1000, 2000)).unwrap();
        add_pool(&mut snap, make_pool(2, 3000, 4000)).unwrap();
        // TVL = 1000*2 + 3000*2 = 8000
        assert_eq!(total_tvl(&snap), 8000);
    }

    #[test]
    fn test_total_tvl_empty() {
        let snap = make_finalized_snapshot(vec![make_record(1, 100, 10)]);
        assert_eq!(total_tvl(&snap), 0);
    }

    #[test]
    fn test_largest_pool() {
        let mut snap = make_finalized_snapshot(vec![make_record(1, 100, 10)]);
        add_pool(&mut snap, make_pool(1, 1000, 2000)).unwrap();
        add_pool(&mut snap, make_pool(2, 5000, 6000)).unwrap();
        add_pool(&mut snap, make_pool(3, 100, 200)).unwrap();
        let largest = largest_pool(&snap).unwrap();
        assert_eq!(largest.pool_id, pool_id(2));
    }

    #[test]
    fn test_largest_pool_empty() {
        let snap = make_finalized_snapshot(vec![make_record(1, 100, 10)]);
        assert!(largest_pool(&snap).is_none());
    }

    // ============ Merkle Tree Tests ============

    #[test]
    fn test_compute_leaf_hash_deterministic() {
        let r = make_record(1, 1000, 100);
        let h1 = compute_leaf_hash(&r);
        let h2 = compute_leaf_hash(&r);
        assert_eq!(h1, h2);
    }

    #[test]
    fn test_compute_leaf_hash_different_data() {
        let r1 = make_record(1, 1000, 100);
        let r2 = make_record(1, 2000, 100);
        assert_ne!(compute_leaf_hash(&r1), compute_leaf_hash(&r2));
    }

    #[test]
    fn test_compute_leaf_hash_different_address() {
        let r1 = make_record(1, 1000, 100);
        let r2 = make_record(2, 1000, 100);
        assert_ne!(compute_leaf_hash(&r1), compute_leaf_hash(&r2));
    }

    #[test]
    fn test_compute_merkle_root_empty() {
        assert_eq!(compute_merkle_root(&[]), [0u8; 32]);
    }

    #[test]
    fn test_compute_merkle_root_single_leaf() {
        let leaf = compute_leaf_hash(&make_record(1, 1000, 100));
        let root = compute_merkle_root(&[leaf]);
        assert_eq!(root, leaf);
    }

    #[test]
    fn test_compute_merkle_root_two_leaves() {
        let l1 = compute_leaf_hash(&make_record(1, 1000, 100));
        let l2 = compute_leaf_hash(&make_record(2, 2000, 200));
        let root = compute_merkle_root(&[l1, l2]);
        assert_ne!(root, l1);
        assert_ne!(root, l2);
    }

    #[test]
    fn test_compute_merkle_root_order_matters() {
        let l1 = compute_leaf_hash(&make_record(1, 1000, 100));
        let l2 = compute_leaf_hash(&make_record(2, 2000, 200));
        let root_a = compute_merkle_root(&[l1, l2]);
        let root_b = compute_merkle_root(&[l2, l1]);
        assert_ne!(root_a, root_b);
    }

    #[test]
    fn test_compute_merkle_root_odd_leaves() {
        let l1 = compute_leaf_hash(&make_record(1, 100, 10));
        let l2 = compute_leaf_hash(&make_record(2, 200, 20));
        let l3 = compute_leaf_hash(&make_record(3, 300, 30));
        let root = compute_merkle_root(&[l1, l2, l3]);
        assert_ne!(root, [0u8; 32]);
    }

    #[test]
    fn test_compute_merkle_root_four_leaves() {
        let leaves: Vec<[u8; 32]> = (1..=4)
            .map(|i| compute_leaf_hash(&make_record(i, i as u64 * 100, i as u64 * 10)))
            .collect();
        let root = compute_merkle_root(&leaves);
        assert_ne!(root, [0u8; 32]);
        // Deterministic
        let root2 = compute_merkle_root(&leaves);
        assert_eq!(root, root2);
    }

    #[test]
    fn test_generate_proof_valid() {
        let snap = make_finalized_snapshot(vec![
            make_record(1, 1000, 100),
            make_record(2, 2000, 200),
            make_record(3, 3000, 300),
            make_record(4, 4000, 400),
        ]);
        let proof = generate_proof(&snap, &addr(1)).unwrap();
        assert!(verify_proof(&snap.merkle_root, &proof));
    }

    #[test]
    fn test_generate_proof_all_addresses() {
        let snap = make_finalized_snapshot(vec![
            make_record(1, 1000, 100),
            make_record(2, 2000, 200),
            make_record(3, 3000, 300),
            make_record(4, 4000, 400),
        ]);
        for i in 1..=4u8 {
            let proof = generate_proof(&snap, &addr(i)).unwrap();
            assert!(verify_proof(&snap.merkle_root, &proof));
        }
    }

    #[test]
    fn test_generate_proof_not_found() {
        let snap = make_finalized_snapshot(vec![make_record(1, 1000, 100)]);
        let result = generate_proof(&snap, &addr(99));
        assert_eq!(result.unwrap_err(), SnapshotError::AddressNotFound);
    }

    #[test]
    fn test_verify_proof_wrong_root() {
        let snap = make_finalized_snapshot(vec![
            make_record(1, 1000, 100),
            make_record(2, 2000, 200),
        ]);
        let proof = generate_proof(&snap, &addr(1)).unwrap();
        let wrong_root = [0xFFu8; 32];
        assert!(!verify_proof(&wrong_root, &proof));
    }

    #[test]
    fn test_verify_proof_tampered_leaf() {
        let snap = make_finalized_snapshot(vec![
            make_record(1, 1000, 100),
            make_record(2, 2000, 200),
        ]);
        let mut proof = generate_proof(&snap, &addr(1)).unwrap();
        proof.leaf_hash[0] ^= 0xFF;
        assert!(!verify_proof(&snap.merkle_root, &proof));
    }

    #[test]
    fn test_verify_proof_mismatched_lengths() {
        let proof = MerkleProof {
            leaf_hash: [0u8; 32],
            siblings: vec![[1u8; 32]],
            path_bits: vec![],
        };
        assert!(!verify_proof(&[0u8; 32], &proof));
    }

    #[test]
    fn test_proof_single_holder() {
        let snap = make_finalized_snapshot(vec![make_record(1, 1000, 100)]);
        let proof = generate_proof(&snap, &addr(1)).unwrap();
        assert!(proof.siblings.is_empty());
        assert!(verify_proof(&snap.merkle_root, &proof));
    }

    #[test]
    fn test_generate_proof_three_leaves() {
        let snap = make_finalized_snapshot(vec![
            make_record(1, 1000, 100),
            make_record(2, 2000, 200),
            make_record(3, 3000, 300),
        ]);
        for i in 1..=3u8 {
            let proof = generate_proof(&snap, &addr(i)).unwrap();
            assert!(verify_proof(&snap.merkle_root, &proof));
        }
    }

    #[test]
    fn test_generate_proof_five_leaves() {
        let snap = make_finalized_snapshot(
            (1..=5).map(|i| make_record(i, i as u64 * 100, i as u64 * 10)).collect()
        );
        for i in 1..=5u8 {
            let proof = generate_proof(&snap, &addr(i)).unwrap();
            assert!(
                verify_proof(&snap.merkle_root, &proof),
                "proof failed for address {}",
                i
            );
        }
    }

    #[test]
    fn test_generate_proof_eight_leaves() {
        let snap = make_finalized_snapshot(
            (1..=8).map(|i| make_record(i, i as u64 * 100, i as u64 * 10)).collect()
        );
        for i in 1..=8u8 {
            let proof = generate_proof(&snap, &addr(i)).unwrap();
            assert!(verify_proof(&snap.merkle_root, &proof));
        }
    }

    #[test]
    fn test_proof_depth_zero() {
        assert_eq!(proof_depth(0), 0);
        assert_eq!(proof_depth(1), 0);
    }

    #[test]
    fn test_proof_depth_powers_of_two() {
        assert_eq!(proof_depth(2), 1);
        assert_eq!(proof_depth(4), 2);
        assert_eq!(proof_depth(8), 3);
        assert_eq!(proof_depth(16), 4);
    }

    #[test]
    fn test_proof_depth_non_powers() {
        assert_eq!(proof_depth(3), 2);
        assert_eq!(proof_depth(5), 3);
        assert_eq!(proof_depth(7), 3);
        assert_eq!(proof_depth(9), 4);
    }

    // ============ Snapshot Comparison Tests ============

    #[test]
    fn test_diff_snapshots_basic() {
        let (old, new) = make_two_snapshots();
        let diff = diff_snapshots(&old, &new);
        assert_eq!(diff.from_id, 1);
        assert_eq!(diff.to_id, 2);
        // addr(4) is new
        assert!(diff.new_addresses.contains(&addr(4)));
        // addr(3) is removed
        assert!(diff.removed_addresses.contains(&addr(3)));
    }

    #[test]
    fn test_diff_snapshots_balance_changes() {
        let (old, new) = make_two_snapshots();
        let diff = diff_snapshots(&old, &new);
        // addr(1): 1000 -> 1500 = +500
        let change_1 = diff
            .balance_changes
            .iter()
            .find(|(a, _)| *a == addr(1))
            .map(|(_, c)| *c);
        assert_eq!(change_1, Some(500));
        // addr(2): 2000 -> 1800 = -200
        let change_2 = diff
            .balance_changes
            .iter()
            .find(|(a, _)| *a == addr(2))
            .map(|(_, c)| *c);
        assert_eq!(change_2, Some(-200));
    }

    #[test]
    fn test_diff_snapshots_removed_address_negative() {
        let (old, new) = make_two_snapshots();
        let diff = diff_snapshots(&old, &new);
        // addr(3) removed: had 500
        let change_3 = diff
            .balance_changes
            .iter()
            .find(|(a, _)| *a == addr(3))
            .map(|(_, c)| *c);
        assert_eq!(change_3, Some(-500));
    }

    #[test]
    fn test_diff_snapshots_new_address_positive() {
        let (old, new) = make_two_snapshots();
        let diff = diff_snapshots(&old, &new);
        // addr(4) added: has 700
        let change_4 = diff
            .balance_changes
            .iter()
            .find(|(a, _)| *a == addr(4))
            .map(|(_, c)| *c);
        assert_eq!(change_4, Some(700));
    }

    #[test]
    fn test_diff_identical_snapshots() {
        let snap = make_finalized_snapshot(vec![make_record(1, 1000, 100)]);
        let diff = diff_snapshots(&snap, &snap);
        assert!(diff.new_addresses.is_empty());
        assert!(diff.removed_addresses.is_empty());
        assert!(diff.balance_changes.is_empty());
        assert_eq!(diff.supply_change, 0);
    }

    #[test]
    fn test_net_balance_change_increase() {
        let (old, new) = make_two_snapshots();
        assert_eq!(net_balance_change(&old, &new, &addr(1)), 500);
    }

    #[test]
    fn test_net_balance_change_decrease() {
        let (old, new) = make_two_snapshots();
        assert_eq!(net_balance_change(&old, &new, &addr(2)), -200);
    }

    #[test]
    fn test_net_balance_change_removed() {
        let (old, new) = make_two_snapshots();
        assert_eq!(net_balance_change(&old, &new, &addr(3)), -500);
    }

    #[test]
    fn test_net_balance_change_added() {
        let (old, new) = make_two_snapshots();
        assert_eq!(net_balance_change(&old, &new, &addr(4)), 700);
    }

    #[test]
    fn test_net_balance_change_absent_both() {
        let (old, new) = make_two_snapshots();
        assert_eq!(net_balance_change(&old, &new, &addr(99)), 0);
    }

    #[test]
    fn test_new_holders() {
        let (old, new) = make_two_snapshots();
        let nh = new_holders(&old, &new);
        assert_eq!(nh.len(), 1);
        assert!(nh.contains(&addr(4)));
    }

    #[test]
    fn test_lost_holders() {
        let (old, new) = make_two_snapshots();
        let lh = lost_holders(&old, &new);
        assert_eq!(lh.len(), 1);
        assert!(lh.contains(&addr(3)));
    }

    #[test]
    fn test_new_holders_none() {
        let snap = make_finalized_snapshot(vec![make_record(1, 1000, 100)]);
        let nh = new_holders(&snap, &snap);
        assert!(nh.is_empty());
    }

    #[test]
    fn test_supply_growth_bps_increase() {
        let old = make_finalized_snapshot(vec![make_record(1, 10000, 100)]);
        let new_snap = make_finalized_snapshot(vec![make_record(1, 11000, 100)]);
        // 1000/10000 = 10% = 1000 bps
        assert_eq!(supply_growth_bps(&old, &new_snap), 1000);
    }

    #[test]
    fn test_supply_growth_bps_decrease() {
        let old = make_finalized_snapshot(vec![make_record(1, 10000, 100)]);
        let new_snap = make_finalized_snapshot(vec![make_record(1, 9000, 100)]);
        assert_eq!(supply_growth_bps(&old, &new_snap), -1000);
    }

    #[test]
    fn test_supply_growth_bps_zero_old_supply() {
        let old = create_snapshot(1, SnapshotType::Governance, 100, 1000);
        let new_snap = make_finalized_snapshot(vec![make_record(1, 1000, 100)]);
        assert_eq!(supply_growth_bps(&old, &new_snap), 0);
    }

    #[test]
    fn test_supply_growth_bps_no_change() {
        let snap = make_finalized_snapshot(vec![make_record(1, 1000, 100)]);
        assert_eq!(supply_growth_bps(&snap, &snap), 0);
    }

    // ============ Scheduling Tests ============

    #[test]
    fn test_create_schedule() {
        let sched = create_schedule(
            100,
            1000,
            vec![SnapshotType::Governance, SnapshotType::Rewards],
            10,
        );
        assert_eq!(sched.interval_blocks, 100);
        assert_eq!(sched.last_snapshot_height, 1000);
        assert_eq!(sched.next_snapshot_height, 1100);
        assert_eq!(sched.retention_count, 10);
        assert!(sched.enabled);
        assert_eq!(sched.snapshot_types.len(), 2);
    }

    #[test]
    fn test_should_snapshot_before() {
        let sched = create_schedule(100, 1000, vec![SnapshotType::Governance], 10);
        assert!(!should_snapshot(&sched, 1050));
    }

    #[test]
    fn test_should_snapshot_exact() {
        let sched = create_schedule(100, 1000, vec![SnapshotType::Governance], 10);
        assert!(should_snapshot(&sched, 1100));
    }

    #[test]
    fn test_should_snapshot_after() {
        let sched = create_schedule(100, 1000, vec![SnapshotType::Governance], 10);
        assert!(should_snapshot(&sched, 1200));
    }

    #[test]
    fn test_should_snapshot_disabled() {
        let mut sched = create_schedule(100, 1000, vec![SnapshotType::Governance], 10);
        sched.enabled = false;
        assert!(!should_snapshot(&sched, 1200));
    }

    #[test]
    fn test_advance_schedule() {
        let mut sched = create_schedule(100, 1000, vec![SnapshotType::Governance], 10);
        let next = advance_schedule(&mut sched);
        assert_eq!(sched.last_snapshot_height, 1100);
        assert_eq!(next, 1200);
        assert_eq!(sched.next_snapshot_height, 1200);
    }

    #[test]
    fn test_advance_schedule_twice() {
        let mut sched = create_schedule(100, 1000, vec![SnapshotType::Governance], 10);
        advance_schedule(&mut sched);
        let next = advance_schedule(&mut sched);
        assert_eq!(next, 1300);
    }

    #[test]
    fn test_snapshots_until_none() {
        let sched = create_schedule(100, 1000, vec![SnapshotType::Governance], 10);
        // next is 1100, target at or before
        assert_eq!(snapshots_until(&sched, 1000), 0);
        assert_eq!(snapshots_until(&sched, 1100), 0);
    }

    #[test]
    fn test_snapshots_until_several() {
        let sched = create_schedule(100, 1000, vec![SnapshotType::Governance], 10);
        // next=1100, then 1200, 1300, 1400. Target=1400 => count from 1100: 1100,1200,1300 = 1 + (1400-1100)/100 = 1+3 = 4
        assert_eq!(snapshots_until(&sched, 1400), 4);
    }

    #[test]
    fn test_snapshots_until_one() {
        let sched = create_schedule(100, 1000, vec![SnapshotType::Governance], 10);
        // target=1101 => 1 + (1101-1100)/100 = 1 + 0 = 1
        assert_eq!(snapshots_until(&sched, 1101), 1);
    }

    // ============ Retention & Storage Tests ============

    #[test]
    fn test_prune_old_snapshots_no_prune() {
        let mut snaps = vec![
            create_snapshot(1, SnapshotType::Governance, 100, 1000),
            create_snapshot(2, SnapshotType::Governance, 200, 2000),
        ];
        let removed = prune_old_snapshots(&mut snaps, 5);
        assert_eq!(removed, 0);
        assert_eq!(snaps.len(), 2);
    }

    #[test]
    fn test_prune_old_snapshots_removes_oldest() {
        let mut snaps = vec![
            create_snapshot(1, SnapshotType::Governance, 100, 1000),
            create_snapshot(2, SnapshotType::Governance, 200, 2000),
            create_snapshot(3, SnapshotType::Governance, 300, 3000),
            create_snapshot(4, SnapshotType::Governance, 400, 4000),
        ];
        let removed = prune_old_snapshots(&mut snaps, 2);
        assert_eq!(removed, 2);
        assert_eq!(snaps.len(), 2);
        assert_eq!(snaps[0].snapshot_id, 3);
        assert_eq!(snaps[1].snapshot_id, 4);
    }

    #[test]
    fn test_prune_old_snapshots_keep_zero() {
        let mut snaps = vec![
            create_snapshot(1, SnapshotType::Governance, 100, 1000),
        ];
        let removed = prune_old_snapshots(&mut snaps, 0);
        assert_eq!(removed, 1);
        assert!(snaps.is_empty());
    }

    #[test]
    fn test_prune_old_snapshots_exact_count() {
        let mut snaps = vec![
            create_snapshot(1, SnapshotType::Governance, 100, 1000),
            create_snapshot(2, SnapshotType::Governance, 200, 2000),
        ];
        let removed = prune_old_snapshots(&mut snaps, 2);
        assert_eq!(removed, 0);
    }

    #[test]
    fn test_snapshot_size_estimate_empty() {
        let snap = create_snapshot(1, SnapshotType::Governance, 100, 1000);
        assert_eq!(snapshot_size_estimate(&snap), SNAPSHOT_BASE_BYTES);
    }

    #[test]
    fn test_snapshot_size_estimate_with_records() {
        let snap = make_finalized_snapshot(vec![
            make_record(1, 100, 10),
            make_record(2, 200, 20),
        ]);
        let expected = SNAPSHOT_BASE_BYTES + 2 * BYTES_PER_RECORD;
        assert_eq!(snapshot_size_estimate(&snap), expected);
    }

    #[test]
    fn test_snapshot_size_estimate_with_pools() {
        let mut snap = make_finalized_snapshot(vec![make_record(1, 100, 10)]);
        add_pool(&mut snap, make_pool(1, 1000, 2000)).unwrap();
        let expected = SNAPSHOT_BASE_BYTES + BYTES_PER_RECORD + BYTES_PER_POOL;
        assert_eq!(snapshot_size_estimate(&snap), expected);
    }

    #[test]
    fn test_find_snapshot_at_height_found() {
        let snaps = vec![
            create_snapshot(1, SnapshotType::Governance, 100, 1000),
            create_snapshot(2, SnapshotType::Governance, 200, 2000),
            create_snapshot(3, SnapshotType::Governance, 300, 3000),
        ];
        assert_eq!(find_snapshot_at_height(&snaps, 200), Some(1));
    }

    #[test]
    fn test_find_snapshot_at_height_not_found() {
        let snaps = vec![
            create_snapshot(1, SnapshotType::Governance, 100, 1000),
            create_snapshot(2, SnapshotType::Governance, 300, 3000),
        ];
        assert_eq!(find_snapshot_at_height(&snaps, 200), None);
    }

    #[test]
    fn test_find_snapshot_at_height_empty() {
        let snaps: Vec<Snapshot> = vec![];
        assert_eq!(find_snapshot_at_height(&snaps, 100), None);
    }

    #[test]
    fn test_find_nearest_snapshot_exact() {
        let snaps = vec![
            create_snapshot(1, SnapshotType::Governance, 100, 1000),
            create_snapshot(2, SnapshotType::Governance, 200, 2000),
            create_snapshot(3, SnapshotType::Governance, 300, 3000),
        ];
        assert_eq!(find_nearest_snapshot(&snaps, 200), Some(1));
    }

    #[test]
    fn test_find_nearest_snapshot_closer_to_left() {
        let snaps = vec![
            create_snapshot(1, SnapshotType::Governance, 100, 1000),
            create_snapshot(2, SnapshotType::Governance, 200, 2000),
        ];
        // 120 is closer to 100 than 200
        assert_eq!(find_nearest_snapshot(&snaps, 120), Some(0));
    }

    #[test]
    fn test_find_nearest_snapshot_closer_to_right() {
        let snaps = vec![
            create_snapshot(1, SnapshotType::Governance, 100, 1000),
            create_snapshot(2, SnapshotType::Governance, 200, 2000),
        ];
        // 180 is closer to 200 than 100
        assert_eq!(find_nearest_snapshot(&snaps, 180), Some(1));
    }

    #[test]
    fn test_find_nearest_snapshot_before_all() {
        let snaps = vec![
            create_snapshot(1, SnapshotType::Governance, 100, 1000),
        ];
        assert_eq!(find_nearest_snapshot(&snaps, 50), Some(0));
    }

    #[test]
    fn test_find_nearest_snapshot_after_all() {
        let snaps = vec![
            create_snapshot(1, SnapshotType::Governance, 100, 1000),
        ];
        assert_eq!(find_nearest_snapshot(&snaps, 500), Some(0));
    }

    #[test]
    fn test_find_nearest_snapshot_empty() {
        let snaps: Vec<Snapshot> = vec![];
        assert_eq!(find_nearest_snapshot(&snaps, 100), None);
    }

    // ============ Reward Distribution Tests ============

    #[test]
    fn test_compute_shares_proportional() {
        let snap = make_finalized_snapshot(vec![
            make_record(1, 1000, 100),
            make_record(2, 2000, 200),
            make_record(3, 3000, 300),
        ]);
        let shares = compute_shares(&snap, 6000);
        // total vp = 600, each gets vp/600 * 6000
        let s1 = shares.iter().find(|(a, _)| *a == addr(1)).unwrap().1;
        let s2 = shares.iter().find(|(a, _)| *a == addr(2)).unwrap().1;
        let s3 = shares.iter().find(|(a, _)| *a == addr(3)).unwrap().1;
        assert_eq!(s1, 1000);
        assert_eq!(s2, 2000);
        assert_eq!(s3, 3000);
    }

    #[test]
    fn test_compute_shares_zero_reward() {
        let snap = make_finalized_snapshot(vec![make_record(1, 1000, 100)]);
        let shares = compute_shares(&snap, 0);
        assert_eq!(shares.len(), 1);
        assert_eq!(shares[0].1, 0);
    }

    #[test]
    fn test_compute_shares_zero_voting_power() {
        let snap = make_finalized_snapshot(vec![make_record(1, 1000, 0)]);
        let shares = compute_shares(&snap, 1000);
        assert!(shares.is_empty());
    }

    #[test]
    fn test_compute_shares_excludes_zero_vp() {
        let snap = make_finalized_snapshot(vec![
            make_record(1, 1000, 100),
            make_record(2, 2000, 0),
        ]);
        let shares = compute_shares(&snap, 1000);
        assert_eq!(shares.len(), 1);
        assert_eq!(shares[0].0, addr(1));
        assert_eq!(shares[0].1, 1000);
    }

    #[test]
    fn test_compute_shares_with_minimum_filters() {
        let snap = make_finalized_snapshot(vec![
            make_record(1, 1000, 50),
            make_record(2, 2000, 100),
            make_record(3, 3000, 200),
        ]);
        let shares = compute_shares_with_minimum(&snap, 3000, 100);
        // Only addr(2) vp=100, addr(3) vp=200 qualify. Total eligible vp = 300
        assert_eq!(shares.len(), 2);
        let s2 = shares.iter().find(|(a, _)| *a == addr(2)).unwrap().1;
        let s3 = shares.iter().find(|(a, _)| *a == addr(3)).unwrap().1;
        assert_eq!(s2, 1000); // 100/300 * 3000
        assert_eq!(s3, 2000); // 200/300 * 3000
    }

    #[test]
    fn test_compute_shares_with_minimum_none_qualify() {
        let snap = make_finalized_snapshot(vec![make_record(1, 1000, 10)]);
        let shares = compute_shares_with_minimum(&snap, 1000, 100);
        assert!(shares.is_empty());
    }

    #[test]
    fn test_compute_shares_with_minimum_exact_threshold() {
        let snap = make_finalized_snapshot(vec![make_record(1, 1000, 100)]);
        let shares = compute_shares_with_minimum(&snap, 5000, 100);
        assert_eq!(shares.len(), 1);
        assert_eq!(shares[0].1, 5000);
    }

    #[test]
    fn test_gini_coefficient_perfect_equality() {
        // All same balance
        let snap = make_finalized_snapshot(vec![
            make_record(1, 1000, 100),
            make_record(2, 1000, 100),
            make_record(3, 1000, 100),
            make_record(4, 1000, 100),
        ]);
        assert_eq!(gini_coefficient(&snap), 0);
    }

    #[test]
    fn test_gini_coefficient_high_inequality() {
        // One has everything, rest have tiny amounts
        let snap = make_finalized_snapshot(vec![
            make_record(1, 1, 1),
            make_record(2, 1, 1),
            make_record(3, 1, 1),
            make_record(4, 99997, 100),
        ]);
        let gini = gini_coefficient(&snap);
        // Should be very high
        assert!(gini > 7000, "expected high gini, got {}", gini);
    }

    #[test]
    fn test_gini_coefficient_empty() {
        let snap = create_snapshot(1, SnapshotType::Governance, 100, 1000);
        assert_eq!(gini_coefficient(&snap), 0);
    }

    #[test]
    fn test_gini_coefficient_single_holder() {
        let snap = make_finalized_snapshot(vec![make_record(1, 1000, 100)]);
        assert_eq!(gini_coefficient(&snap), 0);
    }

    #[test]
    fn test_gini_coefficient_all_zero_balance() {
        let snap = make_finalized_snapshot(vec![
            make_record(1, 0, 0),
            make_record(2, 0, 0),
        ]);
        assert_eq!(gini_coefficient(&snap), 0);
    }

    // ============ Validation Tests ============

    #[test]
    fn test_validate_snapshot_valid() {
        let snap = make_finalized_snapshot(vec![
            make_record(1, 1000, 100),
            make_record(2, 2000, 200),
        ]);
        assert!(validate_snapshot(&snap).is_ok());
    }

    #[test]
    fn test_validate_snapshot_empty() {
        let snap = create_snapshot(1, SnapshotType::Governance, 100, 1000);
        assert_eq!(validate_snapshot(&snap), Err(SnapshotError::EmptySnapshot));
    }

    #[test]
    fn test_validate_snapshot_bad_merkle() {
        let mut snap = make_finalized_snapshot(vec![make_record(1, 1000, 100)]);
        snap.merkle_root = [0xFFu8; 32];
        assert_eq!(
            validate_snapshot(&snap),
            Err(SnapshotError::InvalidMerkleProof)
        );
    }

    #[test]
    fn test_validate_snapshot_duplicate_address() {
        let mut snap = make_finalized_snapshot(vec![make_record(1, 1000, 100)]);
        // Force a duplicate by pushing directly
        snap.balances.push(make_record(1, 2000, 200));
        assert_eq!(
            validate_snapshot(&snap),
            Err(SnapshotError::AlreadyExists)
        );
    }

    #[test]
    fn test_validate_snapshot_sequence_valid() {
        let snaps = vec![
            create_snapshot(1, SnapshotType::Governance, 100, 1000),
            create_snapshot(2, SnapshotType::Governance, 200, 2000),
            create_snapshot(3, SnapshotType::Governance, 300, 3000),
        ];
        assert!(validate_snapshot_sequence(&snaps));
    }

    #[test]
    fn test_validate_snapshot_sequence_empty() {
        let snaps: Vec<Snapshot> = vec![];
        assert!(validate_snapshot_sequence(&snaps));
    }

    #[test]
    fn test_validate_snapshot_sequence_single() {
        let snaps = vec![create_snapshot(1, SnapshotType::Governance, 100, 1000)];
        assert!(validate_snapshot_sequence(&snaps));
    }

    #[test]
    fn test_validate_snapshot_sequence_bad_height() {
        let snaps = vec![
            create_snapshot(1, SnapshotType::Governance, 200, 1000),
            create_snapshot(2, SnapshotType::Governance, 100, 2000),
        ];
        assert!(!validate_snapshot_sequence(&snaps));
    }

    #[test]
    fn test_validate_snapshot_sequence_equal_heights() {
        let snaps = vec![
            create_snapshot(1, SnapshotType::Governance, 100, 1000),
            create_snapshot(2, SnapshotType::Governance, 100, 2000),
        ];
        assert!(!validate_snapshot_sequence(&snaps));
    }

    #[test]
    fn test_validate_snapshot_sequence_bad_id() {
        let snaps = vec![
            create_snapshot(1, SnapshotType::Governance, 100, 1000),
            create_snapshot(3, SnapshotType::Governance, 200, 2000),
        ];
        assert!(!validate_snapshot_sequence(&snaps));
    }

    #[test]
    fn test_is_consistent_after_finalize() {
        let snap = make_finalized_snapshot(vec![
            make_record(1, 1000, 100),
            make_record(2, 2000, 200),
        ]);
        assert!(is_consistent(&snap));
    }

    #[test]
    fn test_is_consistent_tampered_supply() {
        let mut snap = make_finalized_snapshot(vec![make_record(1, 1000, 100)]);
        snap.total_supply = 9999;
        assert!(!is_consistent(&snap));
    }

    #[test]
    fn test_is_consistent_tampered_staked() {
        let mut snap = make_finalized_snapshot(vec![
            make_full_record(1, 1000, 0, 500, 100, 0),
        ]);
        snap.total_staked = 9999;
        assert!(!is_consistent(&snap));
    }

    // ============ Analytics Tests ============

    #[test]
    fn test_concentration_ratio_all_in_top() {
        let snap = make_finalized_snapshot(vec![
            make_record(1, 1000, 100),
            make_record(2, 2000, 200),
        ]);
        // top 2 of 2 = 100% = 10000 bps
        assert_eq!(concentration_ratio(&snap, 2), 10000);
    }

    #[test]
    fn test_concentration_ratio_partial() {
        let snap = make_finalized_snapshot(vec![
            make_record(1, 1000, 100),
            make_record(2, 2000, 200),
            make_record(3, 3000, 300),
            make_record(4, 4000, 400),
        ]);
        // total = 10000, top 1 = 4000 = 40% = 4000 bps
        assert_eq!(concentration_ratio(&snap, 1), 4000);
    }

    #[test]
    fn test_concentration_ratio_empty() {
        let snap = create_snapshot(1, SnapshotType::Governance, 100, 1000);
        assert_eq!(concentration_ratio(&snap, 5), 0);
    }

    #[test]
    fn test_concentration_ratio_top_two() {
        let snap = make_finalized_snapshot(vec![
            make_record(1, 1000, 100),
            make_record(2, 2000, 200),
            make_record(3, 3000, 300),
            make_record(4, 4000, 400),
        ]);
        // top 2 = 4000+3000 = 7000/10000 = 70% = 7000 bps
        assert_eq!(concentration_ratio(&snap, 2), 7000);
    }

    #[test]
    fn test_nakamoto_coefficient_basic() {
        let snap = make_finalized_snapshot(vec![
            make_record(1, 1000, 100),
            make_record(2, 2000, 200),
            make_record(3, 3000, 300),
            make_record(4, 4000, 400),
        ]);
        // Total vp = 1000. Need >500.
        // Descending: 400, 300, 200, 100. 400 < 500. 400+300=700 > 500.
        assert_eq!(nakamoto_coefficient(&snap), 2);
    }

    #[test]
    fn test_nakamoto_coefficient_single_dominant() {
        let snap = make_finalized_snapshot(vec![
            make_record(1, 1000, 900),
            make_record(2, 100, 50),
            make_record(3, 100, 50),
        ]);
        // Total vp = 1000. 900 > 500, so nakamoto = 1
        assert_eq!(nakamoto_coefficient(&snap), 1);
    }

    #[test]
    fn test_nakamoto_coefficient_zero_vp() {
        let snap = make_finalized_snapshot(vec![make_record(1, 1000, 0)]);
        assert_eq!(nakamoto_coefficient(&snap), 0);
    }

    #[test]
    fn test_nakamoto_coefficient_equal_power() {
        let snap = make_finalized_snapshot(vec![
            make_record(1, 1000, 100),
            make_record(2, 1000, 100),
            make_record(3, 1000, 100),
            make_record(4, 1000, 100),
        ]);
        // Total = 400, need >200. Each has 100. 100+100=200 not >200. 100+100+100=300 > 200.
        assert_eq!(nakamoto_coefficient(&snap), 3);
    }

    #[test]
    fn test_median_balance_odd_count() {
        let snap = make_finalized_snapshot(vec![
            make_record(1, 100, 10),
            make_record(2, 300, 30),
            make_record(3, 200, 20),
        ]);
        // Sorted: 100, 200, 300. Median = 200
        assert_eq!(median_balance(&snap), 200);
    }

    #[test]
    fn test_median_balance_even_count() {
        let snap = make_finalized_snapshot(vec![
            make_record(1, 100, 10),
            make_record(2, 200, 20),
            make_record(3, 300, 30),
            make_record(4, 400, 40),
        ]);
        // Sorted: 100, 200, 300, 400. Median = (200+300)/2 = 250
        assert_eq!(median_balance(&snap), 250);
    }

    #[test]
    fn test_median_balance_single() {
        let snap = make_finalized_snapshot(vec![make_record(1, 500, 50)]);
        assert_eq!(median_balance(&snap), 500);
    }

    #[test]
    fn test_median_balance_empty() {
        let snap = create_snapshot(1, SnapshotType::Governance, 100, 1000);
        assert_eq!(median_balance(&snap), 0);
    }

    #[test]
    fn test_median_balance_two_values() {
        let snap = make_finalized_snapshot(vec![
            make_record(1, 100, 10),
            make_record(2, 300, 30),
        ]);
        // (100+300)/2 = 200
        assert_eq!(median_balance(&snap), 200);
    }

    #[test]
    fn test_active_stakers_all_active() {
        let snap = make_finalized_snapshot(vec![
            make_full_record(1, 1000, 0, 500, 100, 2000),
            make_full_record(2, 2000, 0, 600, 200, 3000),
        ]);
        assert_eq!(active_stakers(&snap, 1000), 2);
    }

    #[test]
    fn test_active_stakers_some_expired() {
        let snap = make_finalized_snapshot(vec![
            make_full_record(1, 1000, 0, 500, 100, 2000),
            make_full_record(2, 2000, 0, 600, 200, 500),
        ]);
        // now=1000. addr(1) locked_until=2000 (active), addr(2) locked_until=500 (expired)
        assert_eq!(active_stakers(&snap, 1000), 1);
    }

    #[test]
    fn test_active_stakers_zero_staked() {
        let snap = make_finalized_snapshot(vec![
            make_full_record(1, 1000, 0, 0, 100, 5000),
        ]);
        // staked_amount = 0, so not active even if lock hasn't expired
        assert_eq!(active_stakers(&snap, 1000), 0);
    }

    #[test]
    fn test_active_stakers_none() {
        let snap = make_finalized_snapshot(vec![make_record(1, 1000, 100)]);
        assert_eq!(active_stakers(&snap, 1000), 0);
    }

    #[test]
    fn test_active_stakers_lock_equal_now() {
        let snap = make_finalized_snapshot(vec![
            make_full_record(1, 1000, 0, 500, 100, 1000),
        ]);
        // locked_until == now, NOT > now, so expired
        assert_eq!(active_stakers(&snap, 1000), 0);
    }

    // ============ Edge Case & Integration Tests ============

    #[test]
    fn test_large_snapshot_merkle_proof() {
        let records: Vec<BalanceRecord> = (1..=20u8)
            .map(|i| make_record(i, i as u64 * 1000, i as u64 * 100))
            .collect();
        let snap = make_finalized_snapshot(records);
        for i in 1..=20u8 {
            let proof = generate_proof(&snap, &addr(i)).unwrap();
            assert!(verify_proof(&snap.merkle_root, &proof));
        }
    }

    #[test]
    fn test_snapshot_roundtrip_validate() {
        let snap = from_balances(
            42,
            SnapshotType::Migration,
            5000,
            50000,
            vec![
                make_full_record(1, 1000, 50, 200, 100, 10000),
                make_full_record(2, 2000, 100, 300, 200, 20000),
                make_full_record(3, 3000, 150, 400, 300, 30000),
            ],
            vec![make_pool(1, 5000, 6000), make_pool(2, 7000, 8000)],
        )
        .unwrap();

        assert!(validate_snapshot(&snap).is_ok());
        assert!(is_consistent(&snap));
        assert_eq!(holder_count(&snap), 3);
        assert_eq!(pool_count(&snap), 2);
    }

    #[test]
    fn test_diff_and_new_lost_consistency() {
        let (old, new) = make_two_snapshots();
        let diff = diff_snapshots(&old, &new);
        let nh = new_holders(&old, &new);
        let lh = lost_holders(&old, &new);
        assert_eq!(diff.new_addresses, nh);
        assert_eq!(diff.removed_addresses, lh);
    }

    #[test]
    fn test_schedule_full_lifecycle() {
        let mut sched = create_schedule(50, 0, vec![SnapshotType::Rewards], 5);
        assert!(!should_snapshot(&sched, 25));
        assert!(should_snapshot(&sched, 50));

        let next = advance_schedule(&mut sched);
        assert_eq!(next, 100);
        assert!(!should_snapshot(&sched, 75));
        assert!(should_snapshot(&sched, 100));

        let next2 = advance_schedule(&mut sched);
        assert_eq!(next2, 150);
    }

    #[test]
    fn test_reward_shares_sum_close_to_total() {
        let snap = make_finalized_snapshot(vec![
            make_record(1, 1000, 333),
            make_record(2, 2000, 333),
            make_record(3, 3000, 334),
        ]);
        let shares = compute_shares(&snap, 10000);
        let total_distributed: u64 = shares.iter().map(|(_, s)| *s).sum();
        // Due to integer division, might lose a few
        assert!(total_distributed <= 10000);
        assert!(total_distributed >= 9990);
    }

    #[test]
    fn test_prune_then_validate_sequence() {
        let mut snaps: Vec<Snapshot> = (1..=5)
            .map(|i| create_snapshot(i, SnapshotType::Governance, i * 100, i * 1000))
            .collect();
        prune_old_snapshots(&mut snaps, 3);
        assert!(validate_snapshot_sequence(&snaps));
    }

    #[test]
    fn test_find_nearest_midpoint_favors_left() {
        let snaps = vec![
            create_snapshot(1, SnapshotType::Governance, 100, 1000),
            create_snapshot(2, SnapshotType::Governance, 200, 2000),
        ];
        // 150 is equidistant, should favor left (<=)
        assert_eq!(find_nearest_snapshot(&snaps, 150), Some(0));
    }

    #[test]
    fn test_concentration_ratio_top_exceeds_count() {
        let snap = make_finalized_snapshot(vec![
            make_record(1, 500, 50),
            make_record(2, 500, 50),
        ]);
        // top 10 of 2 = 100%
        assert_eq!(concentration_ratio(&snap, 10), 10000);
    }

    #[test]
    fn test_metadata_field_usage() {
        let mut snap = create_snapshot(1, SnapshotType::Governance, 100, 1000);
        snap.metadata = 42; // proposal_id
        assert_eq!(snap.metadata, 42);
    }

    #[test]
    fn test_snapshot_type_equality() {
        assert_eq!(SnapshotType::Governance, SnapshotType::Governance);
        assert_ne!(SnapshotType::Governance, SnapshotType::Rewards);
        assert_ne!(SnapshotType::Migration, SnapshotType::Emergency);
    }

    #[test]
    fn test_error_equality() {
        assert_eq!(SnapshotError::NotFound, SnapshotError::NotFound);
        assert_ne!(SnapshotError::NotFound, SnapshotError::AlreadyExists);
        assert_ne!(SnapshotError::Overflow, SnapshotError::EmptySnapshot);
    }

    #[test]
    fn test_diff_supply_and_staked_changes() {
        let old = make_finalized_snapshot(vec![
            make_full_record(1, 1000, 0, 200, 100, 0),
        ]);
        let new_snap = make_finalized_snapshot(vec![
            make_full_record(1, 1500, 0, 300, 150, 0),
        ]);
        let diff = diff_snapshots(&old, &new_snap);
        assert_eq!(diff.supply_change, 500);
        assert_eq!(diff.staked_change, 100);
    }

    #[test]
    fn test_diff_pool_count_change() {
        let mut old = make_finalized_snapshot(vec![make_record(1, 1000, 100)]);
        add_pool(&mut old, make_pool(1, 500, 600)).unwrap();

        let mut new_snap = make_finalized_snapshot(vec![make_record(1, 1000, 100)]);
        add_pool(&mut new_snap, make_pool(1, 500, 600)).unwrap();
        add_pool(&mut new_snap, make_pool(2, 700, 800)).unwrap();
        add_pool(&mut new_snap, make_pool(3, 900, 1000)).unwrap();

        let diff = diff_snapshots(&old, &new_snap);
        assert_eq!(diff.pool_count_change, 2);
    }

    #[test]
    fn test_circulating_supply_calculation() {
        let snap = make_finalized_snapshot(vec![
            make_full_record(1, 5000, 0, 1000, 100, 0),
            make_full_record(2, 3000, 0, 500, 200, 0),
        ]);
        // total_supply = 8000, total_staked = 1500
        // circulating = 8000 - 1500 = 6500
        assert_eq!(snap.circulating_supply, 6500);
    }

    #[test]
    fn test_proof_depth_large_values() {
        assert_eq!(proof_depth(1000), 10);
        assert_eq!(proof_depth(1024), 10);
        assert_eq!(proof_depth(1025), 11);
    }

    #[test]
    fn test_gini_two_holders_unequal() {
        let snap = make_finalized_snapshot(vec![
            make_record(1, 100, 10),
            make_record(2, 900, 90),
        ]);
        let gini = gini_coefficient(&snap);
        // Should be 4000 (0.4 * 10000)
        // Formula: (2*(1*100 + 2*900) - 3*1000) / (2*1000) = (2*1900 - 3000)/2000 = 800/2000 = 0.4
        assert_eq!(gini, 4000);
    }

    #[test]
    fn test_snapshot_size_grows_linearly() {
        let s1 = make_finalized_snapshot(vec![make_record(1, 100, 10)]);
        let s2 = make_finalized_snapshot(vec![
            make_record(1, 100, 10),
            make_record(2, 200, 20),
        ]);
        let size1 = snapshot_size_estimate(&s1);
        let size2 = snapshot_size_estimate(&s2);
        assert_eq!(size2 - size1, BYTES_PER_RECORD);
    }

    #[test]
    fn test_median_balance_all_same() {
        let snap = make_finalized_snapshot(vec![
            make_record(1, 500, 50),
            make_record(2, 500, 50),
            make_record(3, 500, 50),
        ]);
        assert_eq!(median_balance(&snap), 500);
    }

    #[test]
    fn test_nakamoto_all_equal_odd_count() {
        let snap = make_finalized_snapshot(vec![
            make_record(1, 1000, 100),
            make_record(2, 1000, 100),
            make_record(3, 1000, 100),
        ]);
        // Total = 300, need >150. Each=100. 100 not >150. 200 > 150. Nakamoto = 2.
        assert_eq!(nakamoto_coefficient(&snap), 2);
    }

    #[test]
    fn test_addresses_above_threshold_all() {
        let snap = make_finalized_snapshot(vec![
            make_record(1, 500, 50),
            make_record(2, 600, 60),
        ]);
        let addrs = addresses_above_threshold(&snap, 0);
        assert_eq!(addrs.len(), 2);
    }

    #[test]
    fn test_balance_percentile_middle() {
        let snap = make_finalized_snapshot(vec![
            make_record(1, 100, 10),
            make_record(2, 200, 20),
            make_record(3, 300, 30),
            make_record(4, 400, 40),
            make_record(5, 500, 50),
        ]);
        // addr(3) has 300, 2 below (100,200) out of 5 = 4000 bps
        let pct = balance_percentile(&snap, &addr(3)).unwrap();
        assert_eq!(pct, 4000);
    }
}
