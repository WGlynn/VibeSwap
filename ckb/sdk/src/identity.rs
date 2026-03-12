// ============ Identity — User Identity, Reputation Scoring & Address Management ============
// Implements user identity management for the VibeSwap protocol on CKB: reputation scoring
// based on protocol participation, address linking (external + device wallets), and
// trust-level analytics.
//
// Key capabilities:
// - Identity creation from public key hash (SHA-256)
// - Multi-address linking: primary, device (WebAuthn/passkey), hardware, multisig, recovery
// - Reputation scoring with per-activity boosts and penalties
// - Epoch-based reputation decay (0.5% per epoch)
// - Tiered reputation system: Newcomer → Participant → Contributor → Veteran → Elder → Legend
// - Trust level computation from reputation + account age + activity
// - Identity merging for address consolidation
// - Leaderboard generation sorted by reputation
// - Fee discounts proportional to reputation (max 5%)
// - Hash-based address ownership verification
//
// Philosophy: Cooperative Capitalism — positive-sum participation is rewarded,
// extractive behaviour is penalised. Long-term contributors earn priority access
// and fee discounts, aligning individual incentives with protocol health.

use sha2::{Digest, Sha256};
use vibeswap_math::mul_div;

// ============ Constants ============

/// Basis points denominator
pub const BPS: u128 = 10_000;

/// Maximum reputation score
pub const MAX_REPUTATION: u64 = 10_000;

/// Starting reputation for new identities
pub const INITIAL_REPUTATION: u64 = 1_000;

/// Reputation decay per epoch in basis points (0.5%)
pub const REPUTATION_DECAY_BPS: u16 = 50;

/// Minimum reputation required for priority features
pub const MIN_REPUTATION_FOR_PRIORITY: u64 = 5_000;

/// Maximum linked addresses per identity
pub const MAX_LINKED_ADDRESSES: usize = 10;

/// Activity tracking window in blocks
pub const ACTIVITY_WINDOW_BLOCKS: u64 = 100_000;

/// Reputation boost per successful trade
pub const REPUTATION_BOOST_TRADE: u64 = 10;

/// Reputation boost per liquidity provision
pub const REPUTATION_BOOST_LP: u64 = 25;

/// Reputation boost per governance vote
pub const REPUTATION_BOOST_GOVERNANCE: u64 = 50;

/// Reputation penalty for failed reveal in commit-reveal auction
pub const REPUTATION_PENALTY_FAILED_REVEAL: u64 = 100;

/// Reputation penalty for getting liquidated
pub const REPUTATION_PENALTY_LIQUIDATED: u64 = 200;

/// Maximum fee discount in basis points (5%)
pub const MAX_FEE_DISCOUNT_BPS: u16 = 500;

/// Weight multiplier for LP activity in activity score
pub const LP_ACTIVITY_WEIGHT: u64 = 3;

/// Weight multiplier for governance activity in activity score
pub const GOVERNANCE_ACTIVITY_WEIGHT: u64 = 5;

/// Weight multiplier for trade activity in activity score (base = 1)
pub const TRADE_ACTIVITY_WEIGHT: u64 = 1;

// ============ Error Types ============

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum IdentityError {
    /// Address is already linked to this identity
    AddressAlreadyLinked,
    /// Identity has reached the maximum number of linked addresses
    MaxAddressesReached,
    /// Address not found in linked addresses
    AddressNotFound,
    /// Reputation is below the required threshold
    InsufficientReputation,
    /// Ownership proof verification failed
    InvalidProof,
    /// Identity with the given hash was not found
    IdentityNotFound,
    /// An identity with this hash already exists
    DuplicateIdentity,
    /// Reputation increase would exceed MAX_REPUTATION
    ReputationOverflow,
    /// Reputation decrease would go below zero
    ReputationUnderflow,
    /// Activity type is not recognized
    InvalidActivityType,
    /// Identity hash is all zeros
    ZeroHash,
    /// Arithmetic overflow
    Overflow,
}

// ============ Data Types ============

/// A user identity on the VibeSwap protocol, anchored by a public key hash.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Identity {
    /// SHA-256 hash of the primary public key
    pub id_hash: [u8; 32],
    /// Current reputation score (0 to MAX_REPUTATION)
    pub reputation: u64,
    /// Fixed array of linked address hashes; unused slots are [0; 32]
    pub linked_addresses: [[u8; 32]; 10],
    /// Number of addresses currently linked
    pub address_count: u8,
    /// Block number when this identity was created
    pub created_block: u64,
    /// Block number of the most recent activity
    pub last_active_block: u64,
    /// Cumulative count of successful trades
    pub total_trades: u64,
    /// Cumulative count of LP provision/withdrawal actions
    pub total_lp_actions: u64,
    /// Cumulative count of governance votes cast
    pub total_governance_votes: u64,
    /// Cumulative count of penalties received
    pub total_penalties: u64,
}

/// Types of protocol activity that affect reputation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ActivityType {
    /// Successful trade execution
    Trade,
    /// Liquidity provision or withdrawal
    LiquidityProvision,
    /// Governance vote cast
    GovernanceVote,
    /// Failed to reveal in commit-reveal auction (penalty)
    FailedReveal,
    /// Position was liquidated (penalty)
    Liquidated,
    /// Staking position created (neutral — tracked only)
    StakeCreated,
    /// Staking position withdrawn (neutral — tracked only)
    StakeWithdrawn,
}

/// A record of a reputation change from a single activity.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReputationChange {
    /// Reputation before the activity
    pub old_reputation: u64,
    /// Reputation after the activity
    pub new_reputation: u64,
    /// Activity that caused the change
    pub reason: ActivityType,
    /// Block at which the change occurred
    pub block_number: u64,
}

/// Full identity profile with computed analytics.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct IdentityProfile {
    /// Underlying identity data
    pub identity: Identity,
    /// Tier based on current reputation
    pub reputation_tier: ReputationTier,
    /// Whether the identity was active within ACTIVITY_WINDOW_BLOCKS
    pub is_active: bool,
    /// Weighted activity count across all tracked actions
    pub activity_score: u64,
    /// Trust level in basis points (0-10000) based on reputation + history
    pub trust_level_bps: u16,
}

/// Reputation tier derived from score ranges.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ReputationTier {
    /// Reputation 0–999
    Newcomer,
    /// Reputation 1000–2999
    Participant,
    /// Reputation 3000–4999
    Contributor,
    /// Reputation 5000–7499
    Veteran,
    /// Reputation 7500–9999
    Elder,
    /// Reputation 10000 (maximum)
    Legend,
}

/// Metadata for a single linked address.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AddressLink {
    /// Hash of the linked address
    pub address_hash: [u8; 32],
    /// Block when this address was linked
    pub linked_block: u64,
    /// Type of wallet/key this address represents
    pub link_type: LinkType,
}

/// Classification of linked address wallet types.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LinkType {
    /// Primary wallet (first address)
    Primary,
    /// Device wallet (WebAuthn/passkey — key in Secure Element)
    Device,
    /// Hardware wallet (Ledger, Trezor, etc.)
    Hardware,
    /// Multisig wallet
    Multisig,
    /// Recovery address
    Recovery,
}

/// Entry in a reputation leaderboard.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LeaderboardEntry {
    /// Identity hash
    pub id_hash: [u8; 32],
    /// Current reputation score
    pub reputation: u64,
    /// Position in the leaderboard (1-indexed)
    pub rank: u32,
    /// Weighted activity score
    pub activity_score: u64,
}

// ============ Core Functions ============

/// Create a new identity from a public key hash.
///
/// Initialises reputation to INITIAL_REPUTATION, sets the primary address
/// as the first linked address, and zeroes all counters.
///
/// Returns `ZeroHash` if the public key hash is all zeros.
pub fn create_identity(public_key_hash: [u8; 32], current_block: u64) -> Result<Identity, IdentityError> {
    if public_key_hash == [0u8; 32] {
        return Err(IdentityError::ZeroHash);
    }

    let mut linked_addresses = [[0u8; 32]; 10];
    linked_addresses[0] = public_key_hash;

    Ok(Identity {
        id_hash: public_key_hash,
        reputation: INITIAL_REPUTATION,
        linked_addresses,
        address_count: 1,
        created_block: current_block,
        last_active_block: current_block,
        total_trades: 0,
        total_lp_actions: 0,
        total_governance_votes: 0,
        total_penalties: 0,
    })
}

/// Link a new address to an existing identity.
///
/// Validates:
/// - Address is not already linked
/// - Identity has not reached MAX_LINKED_ADDRESSES
///
/// Returns a new `Identity` with the address appended.
pub fn link_address(
    identity: &Identity,
    address_hash: [u8; 32],
    _link_type: LinkType,
    _current_block: u64,
) -> Result<Identity, IdentityError> {
    // Check for duplicate
    if find_address(identity, address_hash).is_some() {
        return Err(IdentityError::AddressAlreadyLinked);
    }

    // Check capacity
    if identity.address_count as usize >= MAX_LINKED_ADDRESSES {
        return Err(IdentityError::MaxAddressesReached);
    }

    let mut new_identity = identity.clone();
    new_identity.linked_addresses[new_identity.address_count as usize] = address_hash;
    new_identity.address_count += 1;

    Ok(new_identity)
}

/// Remove a linked address from an identity.
///
/// Shifts remaining addresses to fill the gap. The primary address (index 0)
/// cannot be unlinked — it is the identity anchor.
///
/// Returns `AddressNotFound` if the address is not linked.
pub fn unlink_address(identity: &Identity, address_hash: [u8; 32]) -> Result<Identity, IdentityError> {
    let idx = find_address(identity, address_hash)
        .ok_or(IdentityError::AddressNotFound)?;

    // Prevent unlinking primary address (index 0 = id_hash)
    if idx == 0 {
        return Err(IdentityError::AddressNotFound);
    }

    let mut new_identity = identity.clone();
    let count = new_identity.address_count as usize;

    // Shift addresses down to fill the gap
    let mut i = idx;
    while i < count - 1 {
        new_identity.linked_addresses[i] = new_identity.linked_addresses[i + 1];
        i += 1;
    }
    // Zero out the last slot
    new_identity.linked_addresses[count - 1] = [0u8; 32];
    new_identity.address_count -= 1;

    Ok(new_identity)
}

/// Record a protocol activity and update reputation accordingly.
///
/// Positive activities (Trade, LiquidityProvision, GovernanceVote) boost reputation.
/// Negative activities (FailedReveal, Liquidated) penalise reputation.
/// Neutral activities (StakeCreated, StakeWithdrawn) are tracked but do not change reputation.
///
/// Reputation is clamped to [0, MAX_REPUTATION].
pub fn record_activity(
    identity: &Identity,
    activity: ActivityType,
    current_block: u64,
) -> Result<(Identity, ReputationChange), IdentityError> {
    let old_reputation = identity.reputation;
    let mut new_identity = identity.clone();
    new_identity.last_active_block = current_block;

    let new_reputation = match &activity {
        ActivityType::Trade => {
            new_identity.total_trades = new_identity.total_trades.saturating_add(1);
            core::cmp::min(old_reputation.saturating_add(REPUTATION_BOOST_TRADE), MAX_REPUTATION)
        }
        ActivityType::LiquidityProvision => {
            new_identity.total_lp_actions = new_identity.total_lp_actions.saturating_add(1);
            core::cmp::min(old_reputation.saturating_add(REPUTATION_BOOST_LP), MAX_REPUTATION)
        }
        ActivityType::GovernanceVote => {
            new_identity.total_governance_votes = new_identity.total_governance_votes.saturating_add(1);
            core::cmp::min(old_reputation.saturating_add(REPUTATION_BOOST_GOVERNANCE), MAX_REPUTATION)
        }
        ActivityType::FailedReveal => {
            new_identity.total_penalties = new_identity.total_penalties.saturating_add(1);
            old_reputation.saturating_sub(REPUTATION_PENALTY_FAILED_REVEAL)
        }
        ActivityType::Liquidated => {
            new_identity.total_penalties = new_identity.total_penalties.saturating_add(1);
            old_reputation.saturating_sub(REPUTATION_PENALTY_LIQUIDATED)
        }
        ActivityType::StakeCreated | ActivityType::StakeWithdrawn => {
            // Neutral — no reputation change
            old_reputation
        }
    };

    new_identity.reputation = new_reputation;

    let change = ReputationChange {
        old_reputation,
        new_reputation,
        reason: activity,
        block_number: current_block,
    };

    Ok((new_identity, change))
}

/// Apply reputation decay for elapsed epochs.
///
/// Each epoch decays reputation by REPUTATION_DECAY_BPS (0.5%).
/// Decay is applied iteratively: `rep = rep - rep * decay_bps / BPS` per epoch.
/// Returns a new identity with decayed reputation (floors at 0).
pub fn apply_decay(identity: &Identity, epochs_elapsed: u64) -> Identity {
    let mut new_identity = identity.clone();
    let mut rep = identity.reputation as u128;

    let mut i = 0u64;
    while i < epochs_elapsed {
        let decay = mul_div(rep, REPUTATION_DECAY_BPS as u128, BPS as u128);
        if decay == 0 && rep > 0 {
            // At least 1 unit of decay if reputation is non-zero
            rep = rep.saturating_sub(1);
        } else {
            rep = rep.saturating_sub(decay);
        }
        if rep == 0 {
            break;
        }
        i += 1;
    }

    new_identity.reputation = rep as u64;
    new_identity
}

/// Map a reputation score to its tier.
pub fn compute_reputation_tier(reputation: u64) -> ReputationTier {
    if reputation >= MAX_REPUTATION {
        ReputationTier::Legend
    } else if reputation >= 7_500 {
        ReputationTier::Elder
    } else if reputation >= 5_000 {
        ReputationTier::Veteran
    } else if reputation >= 3_000 {
        ReputationTier::Contributor
    } else if reputation >= 1_000 {
        ReputationTier::Participant
    } else {
        ReputationTier::Newcomer
    }
}

/// Check whether an identity has enough reputation for priority access.
pub fn has_priority_access(identity: &Identity) -> bool {
    identity.reputation >= MIN_REPUTATION_FOR_PRIORITY
}

/// Compute a trust level in basis points (0–10000) based on reputation, account age, and activity.
///
/// Weighting:
/// - 50% from reputation ratio (reputation / MAX_REPUTATION)
/// - 30% from account age (capped at ACTIVITY_WINDOW_BLOCKS)
/// - 20% from activity score (capped at 1000 activities)
pub fn compute_trust_level(identity: &Identity, current_block: u64) -> u16 {
    // Reputation component: 50% weight
    let rep_bps = mul_div(identity.reputation as u128, 5_000, MAX_REPUTATION as u128);

    // Age component: 30% weight (capped at ACTIVITY_WINDOW_BLOCKS)
    let age = if current_block >= identity.created_block {
        current_block - identity.created_block
    } else {
        0
    };
    let capped_age = core::cmp::min(age, ACTIVITY_WINDOW_BLOCKS);
    let age_bps = mul_div(capped_age as u128, 3_000, ACTIVITY_WINDOW_BLOCKS as u128);

    // Activity component: 20% weight (capped at 1000 total activities)
    let activity = compute_activity_score(identity);
    let capped_activity = core::cmp::min(activity, 1_000);
    let activity_bps = mul_div(capped_activity as u128, 2_000, 1_000);

    let total = rep_bps + age_bps + activity_bps;
    core::cmp::min(total, BPS) as u16
}

/// Build a full profile for an identity at a given block.
pub fn build_profile(identity: &Identity, current_block: u64) -> IdentityProfile {
    let reputation_tier = compute_reputation_tier(identity.reputation);
    let active = is_active(identity, current_block);
    let activity_score = compute_activity_score(identity);
    let trust_level_bps = compute_trust_level(identity, current_block);

    IdentityProfile {
        identity: identity.clone(),
        reputation_tier,
        is_active: active,
        activity_score,
        trust_level_bps,
    }
}

/// Check whether the identity was active within the ACTIVITY_WINDOW_BLOCKS window.
pub fn is_active(identity: &Identity, current_block: u64) -> bool {
    if current_block < identity.last_active_block {
        return true; // Shouldn't happen, but treat as active
    }
    (current_block - identity.last_active_block) <= ACTIVITY_WINDOW_BLOCKS
}

/// Compute a weighted activity score across all tracked actions.
///
/// Score = trades * TRADE_WEIGHT + lp_actions * LP_WEIGHT + governance_votes * GOV_WEIGHT
pub fn compute_activity_score(identity: &Identity) -> u64 {
    let trade_score = identity.total_trades.saturating_mul(TRADE_ACTIVITY_WEIGHT);
    let lp_score = identity.total_lp_actions.saturating_mul(LP_ACTIVITY_WEIGHT);
    let gov_score = identity.total_governance_votes.saturating_mul(GOVERNANCE_ACTIVITY_WEIGHT);
    trade_score.saturating_add(lp_score).saturating_add(gov_score)
}

/// Find the index of a linked address, or None if not found.
pub fn find_address(identity: &Identity, address_hash: [u8; 32]) -> Option<usize> {
    let count = identity.address_count as usize;
    let mut i = 0;
    while i < count {
        if identity.linked_addresses[i] == address_hash {
            return Some(i);
        }
        i += 1;
    }
    None
}

/// Merge two identities into one.
///
/// The primary identity retains its id_hash. Reputation is summed, capped at MAX_REPUTATION.
/// Addresses from the secondary identity are merged (duplicates skipped, capacity checked).
/// Activity counters are summed. The earlier created_block is kept.
pub fn merge_identities(primary: &Identity, secondary: &Identity) -> Result<Identity, IdentityError> {
    let mut merged = primary.clone();

    // Sum reputation, cap at MAX_REPUTATION
    merged.reputation = core::cmp::min(
        primary.reputation.saturating_add(secondary.reputation),
        MAX_REPUTATION,
    );

    // Merge addresses from secondary
    let sec_count = secondary.address_count as usize;
    let mut i = 0;
    while i < sec_count {
        let addr = secondary.linked_addresses[i];
        if addr == [0u8; 32] {
            i += 1;
            continue;
        }
        // Skip if already linked
        if find_address(&merged, addr).is_some() {
            i += 1;
            continue;
        }
        // Check capacity
        if merged.address_count as usize >= MAX_LINKED_ADDRESSES {
            return Err(IdentityError::MaxAddressesReached);
        }
        merged.linked_addresses[merged.address_count as usize] = addr;
        merged.address_count += 1;
        i += 1;
    }

    // Sum counters
    merged.total_trades = primary.total_trades.saturating_add(secondary.total_trades);
    merged.total_lp_actions = primary.total_lp_actions.saturating_add(secondary.total_lp_actions);
    merged.total_governance_votes = primary.total_governance_votes.saturating_add(secondary.total_governance_votes);
    merged.total_penalties = primary.total_penalties.saturating_add(secondary.total_penalties);

    // Keep the earlier created_block
    merged.created_block = core::cmp::min(primary.created_block, secondary.created_block);

    // Keep the later last_active_block
    merged.last_active_block = core::cmp::max(primary.last_active_block, secondary.last_active_block);

    Ok(merged)
}

/// Build a leaderboard sorted by reputation (descending), limited to `top_n` entries.
///
/// Uses a fixed-size array of 32 entries maximum. If fewer identities are provided,
/// the returned Vec will be shorter.
pub fn build_leaderboard(identities: &[Identity], top_n: usize) -> Vec<LeaderboardEntry> {
    // Cap to 32 entries maximum (fixed-size processing)
    let cap = core::cmp::min(top_n, 32);
    let count = identities.len();

    if count == 0 || cap == 0 {
        return Vec::new();
    }

    // Build entries into a fixed buffer
    let mut buffer: [Option<LeaderboardEntry>; 32] = [
        None, None, None, None, None, None, None, None,
        None, None, None, None, None, None, None, None,
        None, None, None, None, None, None, None, None,
        None, None, None, None, None, None, None, None,
    ];

    let fill_count = core::cmp::min(count, cap);

    // Fill buffer with first `fill_count` entries
    let mut i = 0;
    while i < fill_count {
        buffer[i] = Some(LeaderboardEntry {
            id_hash: identities[i].id_hash,
            reputation: identities[i].reputation,
            rank: 0, // Set after sorting
            activity_score: compute_activity_score(&identities[i]),
        });
        i += 1;
    }

    // For remaining identities, insert if better than worst in buffer
    i = fill_count;
    while i < count {
        // Find minimum reputation in buffer
        let mut min_idx = 0;
        let mut min_rep = u64::MAX;
        let mut j = 0;
        while j < fill_count {
            if let Some(ref entry) = buffer[j] {
                if entry.reputation < min_rep {
                    min_rep = entry.reputation;
                    min_idx = j;
                }
            }
            j += 1;
        }

        if identities[i].reputation > min_rep {
            buffer[min_idx] = Some(LeaderboardEntry {
                id_hash: identities[i].id_hash,
                reputation: identities[i].reputation,
                rank: 0,
                activity_score: compute_activity_score(&identities[i]),
            });
        }
        i += 1;
    }

    // Collect non-None entries
    let mut entries: Vec<LeaderboardEntry> = Vec::new();
    i = 0;
    while i < fill_count {
        if let Some(entry) = buffer[i].take() {
            entries.push(entry);
        }
        i += 1;
    }

    // Sort by reputation descending (simple insertion sort for small arrays)
    let len = entries.len();
    let mut a = 1;
    while a < len {
        let mut b = a;
        while b > 0 && entries[b].reputation > entries[b - 1].reputation {
            entries.swap(b, b - 1);
            b -= 1;
        }
        a += 1;
    }

    // Assign ranks (1-indexed)
    i = 0;
    while i < entries.len() {
        entries[i].rank = (i as u32) + 1;
        i += 1;
    }

    entries
}

/// Verify address ownership using a hash-based proof.
///
/// The proof is valid if SHA-256(id_hash || address_hash) == proof.
/// This is a simplified verification; in production, cryptographic signatures
/// or ZK proofs would be used.
pub fn verify_address_ownership(
    identity: &Identity,
    address_hash: [u8; 32],
    proof: &[u8; 32],
) -> Result<bool, IdentityError> {
    // Address must be linked to identity
    if find_address(identity, address_hash).is_none() {
        return Err(IdentityError::AddressNotFound);
    }

    // Compute expected proof: SHA-256(id_hash || address_hash)
    let mut hasher = Sha256::new();
    hasher.update(&identity.id_hash);
    hasher.update(&address_hash);
    let result = hasher.finalize();
    let mut expected = [0u8; 32];
    expected.copy_from_slice(&result);

    Ok(expected == *proof)
}

/// Compute a fee discount in basis points based on reputation.
///
/// Linear scaling from 0 BPS (reputation 0) to MAX_FEE_DISCOUNT_BPS (reputation MAX_REPUTATION).
/// Returns a u16 in [0, MAX_FEE_DISCOUNT_BPS].
pub fn reputation_to_fee_discount_bps(reputation: u64) -> u16 {
    if reputation == 0 {
        return 0;
    }
    if reputation >= MAX_REPUTATION {
        return MAX_FEE_DISCOUNT_BPS;
    }
    let discount = mul_div(reputation as u128, MAX_FEE_DISCOUNT_BPS as u128, MAX_REPUTATION as u128);
    discount as u16
}

// ============ Internal Helpers ============

/// Compute SHA-256(a || b) for two 32-byte inputs.
fn sha256_concat(a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(a);
    hasher.update(b);
    let result = hasher.finalize();
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&result);
    hash
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // ============ Test Helpers ============

    fn test_hash(seed: u8) -> [u8; 32] {
        let mut h = [0u8; 32];
        h[0] = seed;
        h[31] = seed;
        h
    }

    fn default_identity() -> Identity {
        create_identity(test_hash(1), 1000).unwrap()
    }

    fn identity_with_reputation(rep: u64) -> Identity {
        let mut id = default_identity();
        id.reputation = rep;
        id
    }

    fn identity_with_trades(n: u64) -> Identity {
        let mut id = default_identity();
        id.total_trades = n;
        id
    }

    fn identity_with_all_activities(trades: u64, lp: u64, gov: u64) -> Identity {
        let mut id = default_identity();
        id.total_trades = trades;
        id.total_lp_actions = lp;
        id.total_governance_votes = gov;
        id
    }

    fn fully_linked_identity() -> Identity {
        let mut id = default_identity();
        let mut i = 1u8;
        while (id.address_count as usize) < MAX_LINKED_ADDRESSES {
            i += 1;
            id = link_address(&id, test_hash(i), LinkType::Device, 1000).unwrap();
        }
        id
    }

    fn compute_expected_proof(id_hash: &[u8; 32], addr_hash: &[u8; 32]) -> [u8; 32] {
        sha256_concat(id_hash, addr_hash)
    }

    // ============ Identity Creation Tests ============

    #[test]
    fn test_create_identity_valid() {
        let id = create_identity(test_hash(1), 100).unwrap();
        assert_eq!(id.id_hash, test_hash(1));
        assert_eq!(id.reputation, INITIAL_REPUTATION);
        assert_eq!(id.address_count, 1);
        assert_eq!(id.linked_addresses[0], test_hash(1));
        assert_eq!(id.created_block, 100);
        assert_eq!(id.last_active_block, 100);
        assert_eq!(id.total_trades, 0);
        assert_eq!(id.total_lp_actions, 0);
        assert_eq!(id.total_governance_votes, 0);
        assert_eq!(id.total_penalties, 0);
    }

    #[test]
    fn test_create_identity_zero_hash_rejected() {
        let result = create_identity([0u8; 32], 100);
        assert_eq!(result, Err(IdentityError::ZeroHash));
    }

    #[test]
    fn test_create_identity_at_block_zero() {
        let id = create_identity(test_hash(42), 0).unwrap();
        assert_eq!(id.created_block, 0);
        assert_eq!(id.last_active_block, 0);
    }

    #[test]
    fn test_create_identity_at_large_block() {
        let id = create_identity(test_hash(1), u64::MAX).unwrap();
        assert_eq!(id.created_block, u64::MAX);
    }

    #[test]
    fn test_create_identity_different_hashes() {
        let id1 = create_identity(test_hash(1), 0).unwrap();
        let id2 = create_identity(test_hash(2), 0).unwrap();
        assert_ne!(id1.id_hash, id2.id_hash);
    }

    #[test]
    fn test_create_identity_primary_address_is_id_hash() {
        let id = create_identity(test_hash(99), 500).unwrap();
        assert_eq!(id.linked_addresses[0], id.id_hash);
    }

    #[test]
    fn test_create_identity_unused_slots_are_zero() {
        let id = create_identity(test_hash(1), 0).unwrap();
        for i in 1..10 {
            assert_eq!(id.linked_addresses[i], [0u8; 32]);
        }
    }

    #[test]
    fn test_create_identity_initial_reputation() {
        let id = create_identity(test_hash(1), 0).unwrap();
        assert_eq!(id.reputation, INITIAL_REPUTATION);
        assert_eq!(id.reputation, 1_000);
    }

    // ============ Address Linking Tests ============

    #[test]
    fn test_link_address_valid() {
        let id = default_identity();
        let new_id = link_address(&id, test_hash(2), LinkType::Device, 2000).unwrap();
        assert_eq!(new_id.address_count, 2);
        assert_eq!(new_id.linked_addresses[1], test_hash(2));
    }

    #[test]
    fn test_link_address_duplicate_rejected() {
        let id = default_identity();
        let result = link_address(&id, test_hash(1), LinkType::Device, 2000);
        assert_eq!(result, Err(IdentityError::AddressAlreadyLinked));
    }

    #[test]
    fn test_link_address_max_reached() {
        let id = fully_linked_identity();
        assert_eq!(id.address_count as usize, MAX_LINKED_ADDRESSES);
        let result = link_address(&id, test_hash(99), LinkType::Recovery, 2000);
        assert_eq!(result, Err(IdentityError::MaxAddressesReached));
    }

    #[test]
    fn test_link_address_all_types() {
        let id = default_identity();
        let types = vec![
            LinkType::Device,
            LinkType::Hardware,
            LinkType::Multisig,
            LinkType::Recovery,
            LinkType::Primary,
        ];
        let mut current = id;
        for (i, lt) in types.iter().enumerate() {
            current = link_address(&current, test_hash((i + 2) as u8), lt.clone(), 2000).unwrap();
        }
        assert_eq!(current.address_count, 6);
    }

    #[test]
    fn test_link_address_preserves_existing() {
        let id = default_identity();
        let id2 = link_address(&id, test_hash(2), LinkType::Device, 2000).unwrap();
        let id3 = link_address(&id2, test_hash(3), LinkType::Hardware, 3000).unwrap();
        assert_eq!(id3.linked_addresses[0], test_hash(1));
        assert_eq!(id3.linked_addresses[1], test_hash(2));
        assert_eq!(id3.linked_addresses[2], test_hash(3));
    }

    #[test]
    fn test_link_address_does_not_modify_reputation() {
        let id = default_identity();
        let new_id = link_address(&id, test_hash(2), LinkType::Device, 2000).unwrap();
        assert_eq!(new_id.reputation, id.reputation);
    }

    #[test]
    fn test_link_fill_all_slots() {
        let id = fully_linked_identity();
        assert_eq!(id.address_count as usize, MAX_LINKED_ADDRESSES);
        for i in 0..MAX_LINKED_ADDRESSES {
            assert_ne!(id.linked_addresses[i], [0u8; 32]);
        }
    }

    // ============ Address Unlinking Tests ============

    #[test]
    fn test_unlink_address_valid() {
        let id = default_identity();
        let id2 = link_address(&id, test_hash(2), LinkType::Device, 2000).unwrap();
        let id3 = unlink_address(&id2, test_hash(2)).unwrap();
        assert_eq!(id3.address_count, 1);
        assert_eq!(id3.linked_addresses[1], [0u8; 32]);
    }

    #[test]
    fn test_unlink_address_not_found() {
        let id = default_identity();
        let result = unlink_address(&id, test_hash(99));
        assert_eq!(result, Err(IdentityError::AddressNotFound));
    }

    #[test]
    fn test_unlink_primary_address_rejected() {
        let id = default_identity();
        let result = unlink_address(&id, test_hash(1));
        assert_eq!(result, Err(IdentityError::AddressNotFound));
    }

    #[test]
    fn test_unlink_shifts_addresses() {
        let id = default_identity();
        let id2 = link_address(&id, test_hash(2), LinkType::Device, 2000).unwrap();
        let id3 = link_address(&id2, test_hash(3), LinkType::Hardware, 3000).unwrap();
        // Unlink middle address
        let id4 = unlink_address(&id3, test_hash(2)).unwrap();
        assert_eq!(id4.address_count, 2);
        assert_eq!(id4.linked_addresses[0], test_hash(1));
        assert_eq!(id4.linked_addresses[1], test_hash(3));
        assert_eq!(id4.linked_addresses[2], [0u8; 32]);
    }

    #[test]
    fn test_unlink_and_relink() {
        let id = default_identity();
        let id2 = link_address(&id, test_hash(2), LinkType::Device, 2000).unwrap();
        let id3 = unlink_address(&id2, test_hash(2)).unwrap();
        let id4 = link_address(&id3, test_hash(2), LinkType::Hardware, 4000).unwrap();
        assert_eq!(id4.address_count, 2);
        assert_eq!(find_address(&id4, test_hash(2)), Some(1));
    }

    #[test]
    fn test_unlink_last_linked() {
        let id = default_identity();
        let id2 = link_address(&id, test_hash(2), LinkType::Device, 2000).unwrap();
        let id3 = link_address(&id2, test_hash(3), LinkType::Hardware, 3000).unwrap();
        // Unlink last
        let id4 = unlink_address(&id3, test_hash(3)).unwrap();
        assert_eq!(id4.address_count, 2);
        assert_eq!(id4.linked_addresses[2], [0u8; 32]);
    }

    #[test]
    fn test_unlink_does_not_modify_reputation() {
        let id = default_identity();
        let id2 = link_address(&id, test_hash(2), LinkType::Device, 2000).unwrap();
        let id3 = unlink_address(&id2, test_hash(2)).unwrap();
        assert_eq!(id3.reputation, id.reputation);
    }

    // ============ Activity Recording Tests — Trade ============

    #[test]
    fn test_record_trade() {
        let id = default_identity();
        let (new_id, change) = record_activity(&id, ActivityType::Trade, 2000).unwrap();
        assert_eq!(new_id.reputation, INITIAL_REPUTATION + REPUTATION_BOOST_TRADE);
        assert_eq!(new_id.total_trades, 1);
        assert_eq!(change.old_reputation, INITIAL_REPUTATION);
        assert_eq!(change.new_reputation, INITIAL_REPUTATION + REPUTATION_BOOST_TRADE);
        assert_eq!(change.block_number, 2000);
    }

    #[test]
    fn test_record_multiple_trades() {
        let mut id = default_identity();
        for i in 0..5 {
            let (new_id, _) = record_activity(&id, ActivityType::Trade, 2000 + i).unwrap();
            id = new_id;
        }
        assert_eq!(id.total_trades, 5);
        assert_eq!(id.reputation, INITIAL_REPUTATION + 5 * REPUTATION_BOOST_TRADE);
    }

    #[test]
    fn test_record_trade_updates_last_active() {
        let id = default_identity();
        let (new_id, _) = record_activity(&id, ActivityType::Trade, 5000).unwrap();
        assert_eq!(new_id.last_active_block, 5000);
    }

    // ============ Activity Recording Tests — LP ============

    #[test]
    fn test_record_lp() {
        let id = default_identity();
        let (new_id, change) = record_activity(&id, ActivityType::LiquidityProvision, 2000).unwrap();
        assert_eq!(new_id.reputation, INITIAL_REPUTATION + REPUTATION_BOOST_LP);
        assert_eq!(new_id.total_lp_actions, 1);
        assert_eq!(change.new_reputation, INITIAL_REPUTATION + REPUTATION_BOOST_LP);
    }

    #[test]
    fn test_record_multiple_lp() {
        let mut id = default_identity();
        for _ in 0..10 {
            let (new_id, _) = record_activity(&id, ActivityType::LiquidityProvision, 3000).unwrap();
            id = new_id;
        }
        assert_eq!(id.total_lp_actions, 10);
        assert_eq!(id.reputation, INITIAL_REPUTATION + 10 * REPUTATION_BOOST_LP);
    }

    // ============ Activity Recording Tests — Governance ============

    #[test]
    fn test_record_governance_vote() {
        let id = default_identity();
        let (new_id, change) = record_activity(&id, ActivityType::GovernanceVote, 2000).unwrap();
        assert_eq!(new_id.reputation, INITIAL_REPUTATION + REPUTATION_BOOST_GOVERNANCE);
        assert_eq!(new_id.total_governance_votes, 1);
        assert_eq!(change.new_reputation, INITIAL_REPUTATION + REPUTATION_BOOST_GOVERNANCE);
    }

    #[test]
    fn test_record_multiple_governance_votes() {
        let mut id = default_identity();
        for _ in 0..3 {
            let (new_id, _) = record_activity(&id, ActivityType::GovernanceVote, 3000).unwrap();
            id = new_id;
        }
        assert_eq!(id.total_governance_votes, 3);
        assert_eq!(id.reputation, INITIAL_REPUTATION + 3 * REPUTATION_BOOST_GOVERNANCE);
    }

    // ============ Activity Recording Tests — Penalties ============

    #[test]
    fn test_record_failed_reveal() {
        let id = default_identity();
        let (new_id, change) = record_activity(&id, ActivityType::FailedReveal, 2000).unwrap();
        assert_eq!(new_id.reputation, INITIAL_REPUTATION - REPUTATION_PENALTY_FAILED_REVEAL);
        assert_eq!(new_id.total_penalties, 1);
        assert_eq!(change.old_reputation, INITIAL_REPUTATION);
        assert_eq!(change.new_reputation, INITIAL_REPUTATION - REPUTATION_PENALTY_FAILED_REVEAL);
    }

    #[test]
    fn test_record_liquidated() {
        let id = default_identity();
        let (new_id, change) = record_activity(&id, ActivityType::Liquidated, 2000).unwrap();
        assert_eq!(new_id.reputation, INITIAL_REPUTATION - REPUTATION_PENALTY_LIQUIDATED);
        assert_eq!(new_id.total_penalties, 1);
        assert_eq!(change.new_reputation, INITIAL_REPUTATION - REPUTATION_PENALTY_LIQUIDATED);
    }

    #[test]
    fn test_penalty_floors_at_zero() {
        let id = identity_with_reputation(50);
        let (new_id, change) = record_activity(&id, ActivityType::FailedReveal, 2000).unwrap();
        assert_eq!(new_id.reputation, 0); // 50 - 100 saturates to 0
        assert_eq!(change.new_reputation, 0);
    }

    #[test]
    fn test_penalty_liquidated_floors_at_zero() {
        let id = identity_with_reputation(100);
        let (new_id, _) = record_activity(&id, ActivityType::Liquidated, 2000).unwrap();
        assert_eq!(new_id.reputation, 0); // 100 - 200 saturates to 0
    }

    #[test]
    fn test_penalty_from_zero_reputation() {
        let id = identity_with_reputation(0);
        let (new_id, change) = record_activity(&id, ActivityType::FailedReveal, 2000).unwrap();
        assert_eq!(new_id.reputation, 0);
        assert_eq!(change.old_reputation, 0);
        assert_eq!(change.new_reputation, 0);
    }

    #[test]
    fn test_multiple_penalties_accumulate() {
        let id = default_identity(); // 1000 rep
        let (id2, _) = record_activity(&id, ActivityType::FailedReveal, 2000).unwrap(); // -100 = 900
        let (id3, _) = record_activity(&id2, ActivityType::FailedReveal, 2001).unwrap(); // -100 = 800
        let (id4, _) = record_activity(&id3, ActivityType::Liquidated, 2002).unwrap();   // -200 = 600
        assert_eq!(id4.reputation, 600);
        assert_eq!(id4.total_penalties, 3);
    }

    // ============ Activity Recording Tests — Neutral Activities ============

    #[test]
    fn test_record_stake_created_neutral() {
        let id = default_identity();
        let (new_id, change) = record_activity(&id, ActivityType::StakeCreated, 2000).unwrap();
        assert_eq!(new_id.reputation, INITIAL_REPUTATION);
        assert_eq!(change.old_reputation, change.new_reputation);
    }

    #[test]
    fn test_record_stake_withdrawn_neutral() {
        let id = default_identity();
        let (new_id, change) = record_activity(&id, ActivityType::StakeWithdrawn, 2000).unwrap();
        assert_eq!(new_id.reputation, INITIAL_REPUTATION);
        assert_eq!(change.old_reputation, change.new_reputation);
    }

    // ============ Activity Recording Tests — Overflow/Underflow ============

    #[test]
    fn test_reputation_capped_at_max() {
        let id = identity_with_reputation(MAX_REPUTATION - 5);
        let (new_id, _) = record_activity(&id, ActivityType::Trade, 2000).unwrap();
        assert_eq!(new_id.reputation, MAX_REPUTATION); // 9995 + 10 capped at 10000
    }

    #[test]
    fn test_reputation_at_max_stays_at_max() {
        let id = identity_with_reputation(MAX_REPUTATION);
        let (new_id, change) = record_activity(&id, ActivityType::Trade, 2000).unwrap();
        assert_eq!(new_id.reputation, MAX_REPUTATION);
        assert_eq!(change.old_reputation, MAX_REPUTATION);
        assert_eq!(change.new_reputation, MAX_REPUTATION);
    }

    #[test]
    fn test_reputation_governance_caps_at_max() {
        let id = identity_with_reputation(MAX_REPUTATION - 10);
        let (new_id, _) = record_activity(&id, ActivityType::GovernanceVote, 2000).unwrap();
        assert_eq!(new_id.reputation, MAX_REPUTATION); // 9990 + 50 capped
    }

    #[test]
    fn test_reputation_lp_caps_at_max() {
        let id = identity_with_reputation(MAX_REPUTATION - 1);
        let (new_id, _) = record_activity(&id, ActivityType::LiquidityProvision, 2000).unwrap();
        assert_eq!(new_id.reputation, MAX_REPUTATION);
    }

    // ============ Decay Tests ============

    #[test]
    fn test_decay_single_epoch() {
        let id = identity_with_reputation(10_000);
        let decayed = apply_decay(&id, 1);
        // 10000 - 10000 * 50 / 10000 = 10000 - 50 = 9950
        assert_eq!(decayed.reputation, 9_950);
    }

    #[test]
    fn test_decay_two_epochs() {
        let id = identity_with_reputation(10_000);
        let decayed = apply_decay(&id, 2);
        // Epoch 1: 10000 - 50 = 9950
        // Epoch 2: 9950 - 49 = 9901 (9950 * 50 / 10000 = 49.75, truncated to 49)
        assert_eq!(decayed.reputation, 9_901);
    }

    #[test]
    fn test_decay_zero_epochs() {
        let id = identity_with_reputation(5_000);
        let decayed = apply_decay(&id, 0);
        assert_eq!(decayed.reputation, 5_000);
    }

    #[test]
    fn test_decay_floors_at_zero() {
        let id = identity_with_reputation(1);
        let decayed = apply_decay(&id, 100);
        assert_eq!(decayed.reputation, 0);
    }

    #[test]
    fn test_decay_from_zero() {
        let id = identity_with_reputation(0);
        let decayed = apply_decay(&id, 10);
        assert_eq!(decayed.reputation, 0);
    }

    #[test]
    fn test_decay_many_epochs() {
        let id = identity_with_reputation(10_000);
        let decayed = apply_decay(&id, 100);
        // After 100 epochs of 0.5% decay, should be substantially reduced
        assert!(decayed.reputation < 7_000);
        assert!(decayed.reputation > 0);
    }

    #[test]
    fn test_decay_small_reputation() {
        let id = identity_with_reputation(10);
        let decayed = apply_decay(&id, 1);
        // 10 * 50 / 10000 = 0, but minimum decay of 1
        assert_eq!(decayed.reputation, 9);
    }

    #[test]
    fn test_decay_preserves_other_fields() {
        let mut id = default_identity();
        id.total_trades = 42;
        id.total_lp_actions = 7;
        let decayed = apply_decay(&id, 5);
        assert_eq!(decayed.total_trades, 42);
        assert_eq!(decayed.total_lp_actions, 7);
        assert_eq!(decayed.id_hash, id.id_hash);
    }

    #[test]
    fn test_decay_initial_reputation() {
        let id = default_identity(); // 1000 rep
        let decayed = apply_decay(&id, 1);
        // 1000 * 50 / 10000 = 5
        assert_eq!(decayed.reputation, 995);
    }

    #[test]
    fn test_decay_large_epoch_count() {
        let id = identity_with_reputation(MAX_REPUTATION);
        let decayed = apply_decay(&id, 10_000);
        // Should eventually reach zero
        assert_eq!(decayed.reputation, 0);
    }

    // ============ Reputation Tier Tests ============

    #[test]
    fn test_tier_newcomer_zero() {
        assert_eq!(compute_reputation_tier(0), ReputationTier::Newcomer);
    }

    #[test]
    fn test_tier_newcomer_999() {
        assert_eq!(compute_reputation_tier(999), ReputationTier::Newcomer);
    }

    #[test]
    fn test_tier_participant_1000() {
        assert_eq!(compute_reputation_tier(1_000), ReputationTier::Participant);
    }

    #[test]
    fn test_tier_participant_2999() {
        assert_eq!(compute_reputation_tier(2_999), ReputationTier::Participant);
    }

    #[test]
    fn test_tier_contributor_3000() {
        assert_eq!(compute_reputation_tier(3_000), ReputationTier::Contributor);
    }

    #[test]
    fn test_tier_contributor_4999() {
        assert_eq!(compute_reputation_tier(4_999), ReputationTier::Contributor);
    }

    #[test]
    fn test_tier_veteran_5000() {
        assert_eq!(compute_reputation_tier(5_000), ReputationTier::Veteran);
    }

    #[test]
    fn test_tier_veteran_7499() {
        assert_eq!(compute_reputation_tier(7_499), ReputationTier::Veteran);
    }

    #[test]
    fn test_tier_elder_7500() {
        assert_eq!(compute_reputation_tier(7_500), ReputationTier::Elder);
    }

    #[test]
    fn test_tier_elder_9999() {
        assert_eq!(compute_reputation_tier(9_999), ReputationTier::Elder);
    }

    #[test]
    fn test_tier_legend_10000() {
        assert_eq!(compute_reputation_tier(10_000), ReputationTier::Legend);
    }

    #[test]
    fn test_tier_above_max() {
        // Even if somehow above max, still Legend
        assert_eq!(compute_reputation_tier(u64::MAX), ReputationTier::Legend);
    }

    // ============ Trust Level Tests ============

    #[test]
    fn test_trust_level_new_identity() {
        let id = create_identity(test_hash(1), 1000).unwrap();
        let trust = compute_trust_level(&id, 1000);
        // Rep: 1000/10000 * 5000 = 500
        // Age: 0
        // Activity: 0
        assert_eq!(trust, 500);
    }

    #[test]
    fn test_trust_level_veteran() {
        let mut id = create_identity(test_hash(1), 0).unwrap();
        id.reputation = 5_000;
        id.total_trades = 100;
        id.total_lp_actions = 20;
        id.total_governance_votes = 5;
        let trust = compute_trust_level(&id, ACTIVITY_WINDOW_BLOCKS);
        // Rep: 5000/10000 * 5000 = 2500
        // Age: 100000/100000 * 3000 = 3000
        // Activity: min(100 + 60 + 25, 1000) = 185; 185/1000 * 2000 = 370
        assert_eq!(trust, 5870);
    }

    #[test]
    fn test_trust_level_legend_max_everything() {
        let mut id = create_identity(test_hash(1), 0).unwrap();
        id.reputation = MAX_REPUTATION;
        id.total_trades = 500;
        id.total_lp_actions = 200;
        id.total_governance_votes = 100;
        let trust = compute_trust_level(&id, ACTIVITY_WINDOW_BLOCKS * 2);
        // Rep: 10000/10000 * 5000 = 5000
        // Age: capped at 100000, 100000/100000 * 3000 = 3000
        // Activity: min(500 + 600 + 500, 1000) = 1000; 1000/1000 * 2000 = 2000
        assert_eq!(trust, 10_000);
    }

    #[test]
    fn test_trust_level_inactive_zero_rep() {
        let id = identity_with_reputation(0);
        let trust = compute_trust_level(&id, 1000);
        // Rep: 0
        // Age: 0 (created at 1000, current 1000)
        // Activity: 0
        assert_eq!(trust, 0);
    }

    #[test]
    fn test_trust_level_max_age_only() {
        let mut id = create_identity(test_hash(1), 0).unwrap();
        id.reputation = 0;
        let trust = compute_trust_level(&id, ACTIVITY_WINDOW_BLOCKS);
        // Rep: 0
        // Age: 100000/100000 * 3000 = 3000
        // Activity: 0
        assert_eq!(trust, 3000);
    }

    #[test]
    fn test_trust_level_max_activity_only() {
        let mut id = default_identity();
        id.reputation = 0;
        id.total_trades = 1000;
        let trust = compute_trust_level(&id, 1000); // created_block = 1000, same as current
        // Rep: 0
        // Age: 0
        // Activity: min(1000, 1000) = 1000; 1000/1000 * 2000 = 2000
        assert_eq!(trust, 2000);
    }

    #[test]
    fn test_trust_level_partial_age() {
        let mut id = create_identity(test_hash(1), 0).unwrap();
        id.reputation = 0;
        let trust = compute_trust_level(&id, ACTIVITY_WINDOW_BLOCKS / 2);
        // Age: 50000/100000 * 3000 = 1500
        assert_eq!(trust, 1500);
    }

    // ============ Profile Tests ============

    #[test]
    fn test_build_profile_active() {
        let id = default_identity();
        let profile = build_profile(&id, 1500);
        assert!(profile.is_active);
        assert_eq!(profile.reputation_tier, ReputationTier::Participant);
        assert_eq!(profile.activity_score, 0);
        assert_eq!(profile.identity.id_hash, id.id_hash);
    }

    #[test]
    fn test_build_profile_inactive() {
        let id = default_identity(); // created at block 1000
        let profile = build_profile(&id, 1000 + ACTIVITY_WINDOW_BLOCKS + 1);
        assert!(!profile.is_active);
    }

    #[test]
    fn test_build_profile_all_fields() {
        let mut id = default_identity();
        id.reputation = 8_000;
        id.total_trades = 50;
        id.total_lp_actions = 20;
        id.total_governance_votes = 10;
        let profile = build_profile(&id, 2000);
        assert_eq!(profile.reputation_tier, ReputationTier::Elder);
        assert!(profile.is_active);
        // activity = 50*1 + 20*3 + 10*5 = 50 + 60 + 50 = 160
        assert_eq!(profile.activity_score, 160);
        assert!(profile.trust_level_bps > 0);
    }

    #[test]
    fn test_build_profile_newcomer() {
        let id = identity_with_reputation(0);
        let profile = build_profile(&id, 1000);
        assert_eq!(profile.reputation_tier, ReputationTier::Newcomer);
    }

    #[test]
    fn test_build_profile_legend() {
        let id = identity_with_reputation(MAX_REPUTATION);
        let profile = build_profile(&id, 1000);
        assert_eq!(profile.reputation_tier, ReputationTier::Legend);
    }

    // ============ Active Check Tests ============

    #[test]
    fn test_is_active_same_block() {
        let id = default_identity();
        assert!(is_active(&id, 1000));
    }

    #[test]
    fn test_is_active_within_window() {
        let id = default_identity(); // last_active = 1000
        assert!(is_active(&id, 1000 + ACTIVITY_WINDOW_BLOCKS));
    }

    #[test]
    fn test_is_active_just_outside_window() {
        let id = default_identity(); // last_active = 1000
        assert!(!is_active(&id, 1000 + ACTIVITY_WINDOW_BLOCKS + 1));
    }

    #[test]
    fn test_is_active_far_future() {
        let id = default_identity();
        assert!(!is_active(&id, 1_000_000_000));
    }

    #[test]
    fn test_is_active_block_before_last_active() {
        let id = default_identity(); // last_active = 1000
        assert!(is_active(&id, 500)); // Shouldn't happen, but treated as active
    }

    // ============ Activity Score Tests ============

    #[test]
    fn test_activity_score_zero() {
        let id = default_identity();
        assert_eq!(compute_activity_score(&id), 0);
    }

    #[test]
    fn test_activity_score_trades_only() {
        let id = identity_with_trades(100);
        assert_eq!(compute_activity_score(&id), 100 * TRADE_ACTIVITY_WEIGHT);
    }

    #[test]
    fn test_activity_score_lp_only() {
        let mut id = default_identity();
        id.total_lp_actions = 50;
        assert_eq!(compute_activity_score(&id), 50 * LP_ACTIVITY_WEIGHT);
    }

    #[test]
    fn test_activity_score_governance_only() {
        let mut id = default_identity();
        id.total_governance_votes = 10;
        assert_eq!(compute_activity_score(&id), 10 * GOVERNANCE_ACTIVITY_WEIGHT);
    }

    #[test]
    fn test_activity_score_combined() {
        let id = identity_with_all_activities(100, 50, 10);
        // 100*1 + 50*3 + 10*5 = 100 + 150 + 50 = 300
        assert_eq!(compute_activity_score(&id), 300);
    }

    #[test]
    fn test_activity_score_large_values() {
        let id = identity_with_all_activities(u64::MAX / 10, u64::MAX / 10, u64::MAX / 10);
        let score = compute_activity_score(&id);
        // Should saturate rather than overflow
        assert!(score > 0);
    }

    // ============ Find Address Tests ============

    #[test]
    fn test_find_address_primary() {
        let id = default_identity();
        assert_eq!(find_address(&id, test_hash(1)), Some(0));
    }

    #[test]
    fn test_find_address_linked() {
        let id = default_identity();
        let id2 = link_address(&id, test_hash(2), LinkType::Device, 2000).unwrap();
        assert_eq!(find_address(&id2, test_hash(2)), Some(1));
    }

    #[test]
    fn test_find_address_not_found() {
        let id = default_identity();
        assert_eq!(find_address(&id, test_hash(99)), None);
    }

    #[test]
    fn test_find_address_zero_hash_not_found() {
        let id = default_identity();
        assert_eq!(find_address(&id, [0u8; 32]), None);
    }

    #[test]
    fn test_find_address_multiple() {
        let id = default_identity();
        let id2 = link_address(&id, test_hash(2), LinkType::Device, 2000).unwrap();
        let id3 = link_address(&id2, test_hash(3), LinkType::Hardware, 3000).unwrap();
        assert_eq!(find_address(&id3, test_hash(1)), Some(0));
        assert_eq!(find_address(&id3, test_hash(2)), Some(1));
        assert_eq!(find_address(&id3, test_hash(3)), Some(2));
    }

    // ============ Merge Identity Tests ============

    #[test]
    fn test_merge_normal() {
        let id1 = identity_with_reputation(3_000);
        let mut id2 = create_identity(test_hash(2), 500).unwrap();
        id2.reputation = 2_000;
        let merged = merge_identities(&id1, &id2).unwrap();
        assert_eq!(merged.reputation, 5_000);
        assert_eq!(merged.id_hash, id1.id_hash); // Primary retains id
    }

    #[test]
    fn test_merge_reputation_capped() {
        let id1 = identity_with_reputation(8_000);
        let mut id2 = create_identity(test_hash(2), 500).unwrap();
        id2.reputation = 5_000;
        let merged = merge_identities(&id1, &id2).unwrap();
        assert_eq!(merged.reputation, MAX_REPUTATION); // 8000 + 5000 capped at 10000
    }

    #[test]
    fn test_merge_addresses_combined() {
        let id1 = default_identity(); // has test_hash(1)
        let id2 = create_identity(test_hash(2), 500).unwrap(); // has test_hash(2)
        let merged = merge_identities(&id1, &id2).unwrap();
        assert_eq!(merged.address_count, 2);
        assert_eq!(find_address(&merged, test_hash(1)), Some(0));
        assert_eq!(find_address(&merged, test_hash(2)), Some(1));
    }

    #[test]
    fn test_merge_duplicate_addresses_skipped() {
        let id1 = default_identity();
        let id2 = create_identity(test_hash(1), 500).unwrap(); // Same primary as id1
        let merged = merge_identities(&id1, &id2).unwrap();
        assert_eq!(merged.address_count, 1); // Duplicate skipped
    }

    #[test]
    fn test_merge_address_overflow() {
        let id1 = fully_linked_identity(); // 10 addresses
        let id2 = create_identity(test_hash(99), 500).unwrap(); // 1 unique address
        let result = merge_identities(&id1, &id2);
        assert_eq!(result, Err(IdentityError::MaxAddressesReached));
    }

    #[test]
    fn test_merge_counters_summed() {
        let mut id1 = default_identity();
        id1.total_trades = 100;
        id1.total_lp_actions = 50;
        id1.total_governance_votes = 10;
        id1.total_penalties = 2;

        let mut id2 = create_identity(test_hash(2), 500).unwrap();
        id2.total_trades = 200;
        id2.total_lp_actions = 30;
        id2.total_governance_votes = 5;
        id2.total_penalties = 1;

        let merged = merge_identities(&id1, &id2).unwrap();
        assert_eq!(merged.total_trades, 300);
        assert_eq!(merged.total_lp_actions, 80);
        assert_eq!(merged.total_governance_votes, 15);
        assert_eq!(merged.total_penalties, 3);
    }

    #[test]
    fn test_merge_keeps_earlier_created_block() {
        let id1 = create_identity(test_hash(1), 1000).unwrap();
        let id2 = create_identity(test_hash(2), 500).unwrap();
        let merged = merge_identities(&id1, &id2).unwrap();
        assert_eq!(merged.created_block, 500);
    }

    #[test]
    fn test_merge_keeps_later_last_active() {
        let mut id1 = create_identity(test_hash(1), 1000).unwrap();
        id1.last_active_block = 5000;
        let mut id2 = create_identity(test_hash(2), 500).unwrap();
        id2.last_active_block = 8000;
        let merged = merge_identities(&id1, &id2).unwrap();
        assert_eq!(merged.last_active_block, 8000);
    }

    #[test]
    fn test_merge_zero_reputation() {
        let id1 = identity_with_reputation(0);
        let mut id2 = create_identity(test_hash(2), 500).unwrap();
        id2.reputation = 0;
        let merged = merge_identities(&id1, &id2).unwrap();
        assert_eq!(merged.reputation, 0);
    }

    #[test]
    fn test_merge_with_self() {
        let id = default_identity();
        let merged = merge_identities(&id, &id).unwrap();
        assert_eq!(merged.reputation, core::cmp::min(id.reputation * 2, MAX_REPUTATION));
        assert_eq!(merged.address_count, 1); // Duplicates skipped
    }

    // ============ Leaderboard Tests ============

    #[test]
    fn test_leaderboard_empty() {
        let entries = build_leaderboard(&[], 10);
        assert!(entries.is_empty());
    }

    #[test]
    fn test_leaderboard_single() {
        let ids = vec![default_identity()];
        let entries = build_leaderboard(&ids, 10);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].rank, 1);
        assert_eq!(entries[0].reputation, INITIAL_REPUTATION);
    }

    #[test]
    fn test_leaderboard_sorted_by_reputation() {
        let ids = vec![
            identity_with_reputation(100),
            identity_with_reputation(5000),
            identity_with_reputation(3000),
        ];
        let entries = build_leaderboard(&ids, 10);
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].reputation, 5000);
        assert_eq!(entries[1].reputation, 3000);
        assert_eq!(entries[2].reputation, 100);
    }

    #[test]
    fn test_leaderboard_ranks_correct() {
        let ids = vec![
            identity_with_reputation(100),
            identity_with_reputation(5000),
            identity_with_reputation(3000),
        ];
        let entries = build_leaderboard(&ids, 10);
        assert_eq!(entries[0].rank, 1);
        assert_eq!(entries[1].rank, 2);
        assert_eq!(entries[2].rank, 3);
    }

    #[test]
    fn test_leaderboard_top_n_limits() {
        let ids = vec![
            identity_with_reputation(100),
            identity_with_reputation(5000),
            identity_with_reputation(3000),
            identity_with_reputation(7000),
        ];
        let entries = build_leaderboard(&ids, 2);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].reputation, 7000);
        assert_eq!(entries[1].reputation, 5000);
    }

    #[test]
    fn test_leaderboard_ties() {
        let ids = vec![
            identity_with_reputation(5000),
            identity_with_reputation(5000),
            identity_with_reputation(5000),
        ];
        let entries = build_leaderboard(&ids, 10);
        assert_eq!(entries.len(), 3);
        // All same reputation — ranks still assigned 1,2,3
        for entry in &entries {
            assert_eq!(entry.reputation, 5000);
        }
    }

    #[test]
    fn test_leaderboard_zero_top_n() {
        let ids = vec![default_identity()];
        let entries = build_leaderboard(&ids, 0);
        assert!(entries.is_empty());
    }

    #[test]
    fn test_leaderboard_with_activity_scores() {
        let mut id = default_identity();
        id.total_trades = 50;
        id.total_lp_actions = 20;
        let ids = vec![id.clone()];
        let entries = build_leaderboard(&ids, 10);
        // 50*1 + 20*3 = 110
        assert_eq!(entries[0].activity_score, 110);
    }

    #[test]
    fn test_leaderboard_replaces_lower_reputation() {
        // More identities than top_n
        let mut ids = Vec::new();
        for i in 0..10 {
            ids.push(identity_with_reputation((i + 1) * 1000));
        }
        let entries = build_leaderboard(&ids, 3);
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].reputation, 10_000);
        assert_eq!(entries[1].reputation, 9_000);
        assert_eq!(entries[2].reputation, 8_000);
    }

    // ============ Priority Access Tests ============

    #[test]
    fn test_priority_below_threshold() {
        let id = identity_with_reputation(MIN_REPUTATION_FOR_PRIORITY - 1);
        assert!(!has_priority_access(&id));
    }

    #[test]
    fn test_priority_at_threshold() {
        let id = identity_with_reputation(MIN_REPUTATION_FOR_PRIORITY);
        assert!(has_priority_access(&id));
    }

    #[test]
    fn test_priority_above_threshold() {
        let id = identity_with_reputation(MIN_REPUTATION_FOR_PRIORITY + 1);
        assert!(has_priority_access(&id));
    }

    #[test]
    fn test_priority_max_reputation() {
        let id = identity_with_reputation(MAX_REPUTATION);
        assert!(has_priority_access(&id));
    }

    #[test]
    fn test_priority_zero_reputation() {
        let id = identity_with_reputation(0);
        assert!(!has_priority_access(&id));
    }

    // ============ Fee Discount Tests ============

    #[test]
    fn test_fee_discount_zero_rep() {
        assert_eq!(reputation_to_fee_discount_bps(0), 0);
    }

    #[test]
    fn test_fee_discount_max_rep() {
        assert_eq!(reputation_to_fee_discount_bps(MAX_REPUTATION), MAX_FEE_DISCOUNT_BPS);
    }

    #[test]
    fn test_fee_discount_half_rep() {
        let discount = reputation_to_fee_discount_bps(MAX_REPUTATION / 2);
        assert_eq!(discount, MAX_FEE_DISCOUNT_BPS / 2);
    }

    #[test]
    fn test_fee_discount_quarter_rep() {
        let discount = reputation_to_fee_discount_bps(MAX_REPUTATION / 4);
        assert_eq!(discount, MAX_FEE_DISCOUNT_BPS / 4);
    }

    #[test]
    fn test_fee_discount_above_max_rep() {
        // Even above MAX_REPUTATION, discount is capped
        assert_eq!(reputation_to_fee_discount_bps(MAX_REPUTATION + 1000), MAX_FEE_DISCOUNT_BPS);
    }

    #[test]
    fn test_fee_discount_linear_scaling() {
        // Check linearity at several points
        let d1 = reputation_to_fee_discount_bps(1000);
        let d2 = reputation_to_fee_discount_bps(2000);
        let d3 = reputation_to_fee_discount_bps(3000);
        // d2 should be approximately 2 * d1, d3 approximately 3 * d1
        assert_eq!(d2, d1 * 2);
        assert_eq!(d3, d1 * 3);
    }

    #[test]
    fn test_fee_discount_small_rep() {
        let discount = reputation_to_fee_discount_bps(1);
        // 1 * 500 / 10000 = 0 (truncated)
        assert_eq!(discount, 0);
    }

    #[test]
    fn test_fee_discount_minimum_nonzero() {
        // Find smallest rep that gives nonzero discount
        // 500 / 10000 = need rep * 500 / 10000 >= 1 => rep >= 20
        let discount = reputation_to_fee_discount_bps(20);
        assert_eq!(discount, 1);
    }

    // ============ Address Ownership Verification Tests ============

    #[test]
    fn test_verify_ownership_valid_proof() {
        let id = default_identity();
        let addr = test_hash(1);
        let proof = compute_expected_proof(&id.id_hash, &addr);
        let result = verify_address_ownership(&id, addr, &proof).unwrap();
        assert!(result);
    }

    #[test]
    fn test_verify_ownership_invalid_proof() {
        let id = default_identity();
        let addr = test_hash(1);
        let bad_proof = [0xFFu8; 32];
        let result = verify_address_ownership(&id, addr, &bad_proof).unwrap();
        assert!(!result);
    }

    #[test]
    fn test_verify_ownership_address_not_linked() {
        let id = default_identity();
        let addr = test_hash(99);
        let proof = [0u8; 32];
        let result = verify_address_ownership(&id, addr, &proof);
        assert_eq!(result, Err(IdentityError::AddressNotFound));
    }

    #[test]
    fn test_verify_ownership_second_address() {
        let id = default_identity();
        let id2 = link_address(&id, test_hash(2), LinkType::Device, 2000).unwrap();
        let proof = compute_expected_proof(&id2.id_hash, &test_hash(2));
        let result = verify_address_ownership(&id2, test_hash(2), &proof).unwrap();
        assert!(result);
    }

    #[test]
    fn test_verify_ownership_wrong_id_proof() {
        let id1 = default_identity();
        let id2 = create_identity(test_hash(2), 500).unwrap();
        // Proof generated with id2's hash but verified against id1
        let addr = test_hash(1); // linked to id1
        let wrong_proof = compute_expected_proof(&id2.id_hash, &addr);
        let result = verify_address_ownership(&id1, addr, &wrong_proof).unwrap();
        assert!(!result);
    }

    // ============ Integration Tests ============

    #[test]
    fn test_full_lifecycle() {
        // Create identity
        let id = create_identity(test_hash(1), 100).unwrap();

        // Link device wallet
        let id = link_address(&id, test_hash(2), LinkType::Device, 200).unwrap();

        // Trade a few times
        let (id, _) = record_activity(&id, ActivityType::Trade, 300).unwrap();
        let (id, _) = record_activity(&id, ActivityType::Trade, 400).unwrap();

        // Provide liquidity
        let (id, _) = record_activity(&id, ActivityType::LiquidityProvision, 500).unwrap();

        // Vote
        let (id, _) = record_activity(&id, ActivityType::GovernanceVote, 600).unwrap();

        // Check state
        assert_eq!(id.total_trades, 2);
        assert_eq!(id.total_lp_actions, 1);
        assert_eq!(id.total_governance_votes, 1);
        assert_eq!(id.reputation, INITIAL_REPUTATION + 2 * 10 + 25 + 50);
        assert_eq!(id.address_count, 2);

        // Build profile
        let profile = build_profile(&id, 700);
        assert!(profile.is_active);
        assert_eq!(profile.reputation_tier, ReputationTier::Participant);

        // Apply decay
        let decayed = apply_decay(&id, 5);
        assert!(decayed.reputation < id.reputation);
    }

    #[test]
    fn test_penalty_then_recovery() {
        let id = default_identity(); // 1000
        let (id, _) = record_activity(&id, ActivityType::FailedReveal, 2000).unwrap(); // 900
        let (id, _) = record_activity(&id, ActivityType::Liquidated, 2001).unwrap(); // 700
        assert_eq!(id.reputation, 700);

        // Recover through activity
        let mut id = id;
        for _ in 0..30 {
            let (new_id, _) = record_activity(&id, ActivityType::Trade, 3000).unwrap();
            id = new_id;
        }
        assert_eq!(id.reputation, 1000); // 700 + 30*10 = 1000
    }

    #[test]
    fn test_merge_and_profile() {
        let mut id1 = default_identity();
        id1.total_trades = 50;
        id1.reputation = 3_000;

        let mut id2 = create_identity(test_hash(2), 500).unwrap();
        id2.total_lp_actions = 30;
        id2.reputation = 4_000;

        let merged = merge_identities(&id1, &id2).unwrap();
        let profile = build_profile(&merged, 2000);

        assert_eq!(profile.reputation_tier, ReputationTier::Veteran);
        assert_eq!(profile.identity.total_trades, 50);
        assert_eq!(profile.identity.total_lp_actions, 30);
        // activity = 50*1 + 30*3 = 140
        assert_eq!(profile.activity_score, 140);
    }

    #[test]
    fn test_leaderboard_after_activities() {
        let mut ids = Vec::new();
        for i in 0..5u8 {
            let mut id = create_identity(test_hash(i + 1), 0).unwrap();
            id.reputation = (i as u64 + 1) * 2_000;
            id.total_trades = (i as u64 + 1) * 10;
            ids.push(id);
        }
        let board = build_leaderboard(&ids, 3);
        assert_eq!(board.len(), 3);
        assert_eq!(board[0].reputation, 10_000);
        assert_eq!(board[1].reputation, 8_000);
        assert_eq!(board[2].reputation, 6_000);
        assert_eq!(board[0].rank, 1);
    }

    #[test]
    fn test_fee_discount_after_climbing_tiers() {
        let mut id = default_identity(); // 1000 rep
        // Trade a lot to climb
        for _ in 0..400 {
            let (new_id, _) = record_activity(&id, ActivityType::Trade, 5000).unwrap();
            id = new_id;
        }
        // 1000 + 400*10 = 5000
        assert_eq!(id.reputation, 5_000);
        let discount = reputation_to_fee_discount_bps(id.reputation);
        assert_eq!(discount, 250); // 5000/10000 * 500 = 250 BPS
    }

    #[test]
    fn test_decay_then_check_priority() {
        let id = identity_with_reputation(MIN_REPUTATION_FOR_PRIORITY); // 5000
        assert!(has_priority_access(&id));

        // Decay 10 epochs: each decays 0.5%
        let decayed = apply_decay(&id, 10);
        // After 10 epochs of 0.5%, 5000 * (0.995^10) ≈ 4756
        assert!(!has_priority_access(&decayed));
    }

    #[test]
    fn test_address_link_unlink_verify() {
        let id = default_identity();
        let id = link_address(&id, test_hash(5), LinkType::Hardware, 200).unwrap();

        // Verify ownership of new address
        let proof = compute_expected_proof(&id.id_hash, &test_hash(5));
        assert!(verify_address_ownership(&id, test_hash(5), &proof).unwrap());

        // Unlink it
        let id = unlink_address(&id, test_hash(5)).unwrap();

        // Can no longer verify
        let result = verify_address_ownership(&id, test_hash(5), &proof);
        assert_eq!(result, Err(IdentityError::AddressNotFound));
    }

    #[test]
    fn test_reputation_tier_after_mixed_activities() {
        let id = default_identity(); // 1000 rep, Participant
        assert_eq!(compute_reputation_tier(id.reputation), ReputationTier::Participant);

        // Penalty knocks to Newcomer
        let (id, _) = record_activity(&id, ActivityType::Liquidated, 2000).unwrap();
        assert_eq!(id.reputation, 800);
        assert_eq!(compute_reputation_tier(id.reputation), ReputationTier::Newcomer);

        // Recover through governance (high boost)
        let (id, _) = record_activity(&id, ActivityType::GovernanceVote, 3000).unwrap();
        let (id, _) = record_activity(&id, ActivityType::GovernanceVote, 3001).unwrap();
        let (id, _) = record_activity(&id, ActivityType::GovernanceVote, 3002).unwrap();
        let (id, _) = record_activity(&id, ActivityType::GovernanceVote, 3003).unwrap();
        // 800 + 4*50 = 1000
        assert_eq!(id.reputation, 1000);
        assert_eq!(compute_reputation_tier(id.reputation), ReputationTier::Participant);
    }

    // ============ Edge Case Tests ============

    #[test]
    fn test_identity_with_all_max_values() {
        let mut id = default_identity();
        id.reputation = MAX_REPUTATION;
        id.total_trades = u64::MAX;
        id.total_lp_actions = u64::MAX;
        id.total_governance_votes = u64::MAX;
        id.total_penalties = u64::MAX;
        id.last_active_block = u64::MAX;

        let profile = build_profile(&id, u64::MAX);
        assert!(profile.is_active);
        assert_eq!(profile.reputation_tier, ReputationTier::Legend);
    }

    #[test]
    fn test_decay_single_unit_reputation() {
        let id = identity_with_reputation(1);
        let decayed = apply_decay(&id, 1);
        // 1 * 50 / 10000 = 0, minimum decay of 1
        assert_eq!(decayed.reputation, 0);
    }

    #[test]
    fn test_decay_two_unit_reputation() {
        let id = identity_with_reputation(2);
        let decayed = apply_decay(&id, 1);
        // 2 * 50 / 10000 = 0, minimum decay of 1
        assert_eq!(decayed.reputation, 1);
    }

    #[test]
    fn test_leaderboard_more_than_32() {
        let mut ids = Vec::new();
        for i in 0..50u64 {
            ids.push(identity_with_reputation(i * 100));
        }
        // Only top 32 possible
        let board = build_leaderboard(&ids, 32);
        assert_eq!(board.len(), 32);
        assert_eq!(board[0].reputation, 4900);
    }

    #[test]
    fn test_trust_level_capped_at_10000() {
        let mut id = create_identity(test_hash(1), 0).unwrap();
        id.reputation = MAX_REPUTATION;
        id.total_trades = 10_000;
        id.total_lp_actions = 10_000;
        id.total_governance_votes = 10_000;
        let trust = compute_trust_level(&id, ACTIVITY_WINDOW_BLOCKS * 100);
        assert!(trust <= 10_000);
    }

    #[test]
    fn test_sha256_concat_deterministic() {
        let a = test_hash(1);
        let b = test_hash(2);
        let h1 = sha256_concat(&a, &b);
        let h2 = sha256_concat(&a, &b);
        assert_eq!(h1, h2);
    }

    #[test]
    fn test_sha256_concat_order_matters() {
        let a = test_hash(1);
        let b = test_hash(2);
        let h1 = sha256_concat(&a, &b);
        let h2 = sha256_concat(&b, &a);
        assert_ne!(h1, h2);
    }

    #[test]
    fn test_constants_consistency() {
        assert_eq!(BPS, 10_000);
        assert_eq!(MAX_REPUTATION, 10_000);
        assert_eq!(INITIAL_REPUTATION, 1_000);
        assert!(INITIAL_REPUTATION < MAX_REPUTATION);
        assert!(MIN_REPUTATION_FOR_PRIORITY <= MAX_REPUTATION);
        assert!(REPUTATION_BOOST_TRADE < REPUTATION_BOOST_LP);
        assert!(REPUTATION_BOOST_LP < REPUTATION_BOOST_GOVERNANCE);
        assert!(REPUTATION_PENALTY_FAILED_REVEAL < REPUTATION_PENALTY_LIQUIDATED);
    }

    #[test]
    fn test_create_and_immediately_profile() {
        let id = create_identity(test_hash(1), 0).unwrap();
        let profile = build_profile(&id, 0);
        assert_eq!(profile.reputation_tier, ReputationTier::Participant);
        assert!(profile.is_active);
        assert_eq!(profile.activity_score, 0);
    }

    #[test]
    fn test_multiple_link_unlink_cycles() {
        let mut id = default_identity();
        for cycle in 0..5u8 {
            let addr = test_hash(100 + cycle);
            id = link_address(&id, addr, LinkType::Device, 2000).unwrap();
            id = unlink_address(&id, addr).unwrap();
        }
        assert_eq!(id.address_count, 1); // Only primary remains
    }

    #[test]
    fn test_find_after_unlink_middle() {
        let id = default_identity();
        let id = link_address(&id, test_hash(2), LinkType::Device, 2000).unwrap();
        let id = link_address(&id, test_hash(3), LinkType::Hardware, 3000).unwrap();
        let id = link_address(&id, test_hash(4), LinkType::Recovery, 4000).unwrap();
        let id = unlink_address(&id, test_hash(3)).unwrap();

        assert_eq!(find_address(&id, test_hash(1)), Some(0));
        assert_eq!(find_address(&id, test_hash(2)), Some(1));
        assert_eq!(find_address(&id, test_hash(4)), Some(2));
        assert_eq!(find_address(&id, test_hash(3)), None);
    }

    #[test]
    fn test_merge_both_zero_reputation() {
        let id1 = identity_with_reputation(0);
        let mut id2 = create_identity(test_hash(2), 0).unwrap();
        id2.reputation = 0;
        let merged = merge_identities(&id1, &id2).unwrap();
        assert_eq!(merged.reputation, 0);
    }

    #[test]
    fn test_merge_both_max_reputation() {
        let id1 = identity_with_reputation(MAX_REPUTATION);
        let mut id2 = create_identity(test_hash(2), 0).unwrap();
        id2.reputation = MAX_REPUTATION;
        let merged = merge_identities(&id1, &id2).unwrap();
        assert_eq!(merged.reputation, MAX_REPUTATION);
    }

    #[test]
    fn test_activity_updates_last_active_block() {
        let id = default_identity(); // last_active = 1000
        let (id, _) = record_activity(&id, ActivityType::Trade, 5000).unwrap();
        assert_eq!(id.last_active_block, 5000);
        let (id, _) = record_activity(&id, ActivityType::StakeCreated, 8000).unwrap();
        assert_eq!(id.last_active_block, 8000);
    }

    #[test]
    fn test_decay_then_trade_recovery() {
        let id = identity_with_reputation(1_000);
        let decayed = apply_decay(&id, 10); // Loses some rep
        let (recovered, _) = record_activity(&decayed, ActivityType::GovernanceVote, 5000).unwrap();
        assert!(recovered.reputation > decayed.reputation);
    }

    #[test]
    fn test_verify_all_linked_addresses() {
        let id = default_identity();
        let id = link_address(&id, test_hash(2), LinkType::Device, 2000).unwrap();
        let id = link_address(&id, test_hash(3), LinkType::Hardware, 3000).unwrap();

        for i in 1..=3u8 {
            let addr = test_hash(i);
            let proof = compute_expected_proof(&id.id_hash, &addr);
            assert!(verify_address_ownership(&id, addr, &proof).unwrap());
        }
    }

    #[test]
    fn test_fee_discount_at_priority_threshold() {
        let discount = reputation_to_fee_discount_bps(MIN_REPUTATION_FOR_PRIORITY);
        // 5000/10000 * 500 = 250
        assert_eq!(discount, 250);
    }

    #[test]
    fn test_leaderboard_preserves_id_hash() {
        let ids = vec![
            create_identity(test_hash(42), 0).unwrap(),
        ];
        let board = build_leaderboard(&ids, 10);
        assert_eq!(board[0].id_hash, test_hash(42));
    }

    #[test]
    fn test_merge_many_addresses_partial() {
        // Primary has 8 addresses, secondary has 3 (2 unique) = 10 total
        let mut id1 = default_identity();
        for i in 2..=8u8 {
            id1 = link_address(&id1, test_hash(i), LinkType::Device, 1000).unwrap();
        }
        assert_eq!(id1.address_count, 8);

        let mut id2 = create_identity(test_hash(20), 0).unwrap();
        id2 = link_address(&id2, test_hash(21), LinkType::Device, 0).unwrap();
        // id2 has 2 unique addresses (20, 21)

        let merged = merge_identities(&id1, &id2).unwrap();
        assert_eq!(merged.address_count, 10);
    }

    #[test]
    fn test_merge_addresses_exceed_capacity() {
        // Primary has 9 addresses, secondary has 2 unique = would be 11 > MAX
        let mut id1 = default_identity();
        for i in 2..=9u8 {
            id1 = link_address(&id1, test_hash(i), LinkType::Device, 1000).unwrap();
        }
        assert_eq!(id1.address_count, 9);

        let mut id2 = create_identity(test_hash(20), 0).unwrap();
        id2 = link_address(&id2, test_hash(21), LinkType::Device, 0).unwrap();

        let result = merge_identities(&id1, &id2);
        // First unique addr (20) fits (10), second (21) would be 11 -> error
        assert_eq!(result, Err(IdentityError::MaxAddressesReached));
    }

    // ============ Hardening Tests v6 ============

    #[test]
    fn test_create_identity_sets_counters_to_zero_v6() {
        let id = create_identity(test_hash(1), 100).unwrap();
        assert_eq!(id.total_trades, 0);
        assert_eq!(id.total_lp_actions, 0);
        assert_eq!(id.total_governance_votes, 0);
        assert_eq!(id.total_penalties, 0);
    }

    #[test]
    fn test_create_identity_block_zero_v6() {
        let id = create_identity(test_hash(1), 0).unwrap();
        assert_eq!(id.created_block, 0);
        assert_eq!(id.last_active_block, 0);
    }

    #[test]
    fn test_create_identity_max_block_v6() {
        let id = create_identity(test_hash(1), u64::MAX).unwrap();
        assert_eq!(id.created_block, u64::MAX);
    }

    #[test]
    fn test_link_address_zero_hash_v6() {
        // Linking a zero hash — should succeed (zero is a valid address hash, just unusual)
        let id = create_identity(test_hash(1), 100).unwrap();
        let result = link_address(&id, [0u8; 32], LinkType::Device, 100);
        assert!(result.is_ok());
    }

    #[test]
    fn test_link_all_types_distinct_v6() {
        let mut id = create_identity(test_hash(1), 100).unwrap();
        id = link_address(&id, test_hash(2), LinkType::Device, 100).unwrap();
        id = link_address(&id, test_hash(3), LinkType::Hardware, 100).unwrap();
        id = link_address(&id, test_hash(4), LinkType::Multisig, 100).unwrap();
        id = link_address(&id, test_hash(5), LinkType::Recovery, 100).unwrap();
        assert_eq!(id.address_count, 5);
    }

    #[test]
    fn test_unlink_middle_address_shifts_correctly_v6() {
        let mut id = create_identity(test_hash(1), 100).unwrap();
        id = link_address(&id, test_hash(2), LinkType::Device, 100).unwrap();
        id = link_address(&id, test_hash(3), LinkType::Hardware, 100).unwrap();
        id = link_address(&id, test_hash(4), LinkType::Recovery, 100).unwrap();
        // Unlink middle (test_hash(3))
        id = unlink_address(&id, test_hash(3)).unwrap();
        assert_eq!(id.address_count, 3);
        assert_eq!(find_address(&id, test_hash(4)), Some(2));
    }

    #[test]
    fn test_record_trade_increments_counter_v6() {
        let id = create_identity(test_hash(1), 100).unwrap();
        let (updated, _) = record_activity(&id, ActivityType::Trade, 200).unwrap();
        assert_eq!(updated.total_trades, 1);
    }

    #[test]
    fn test_record_lp_increments_counter_v6() {
        let id = create_identity(test_hash(1), 100).unwrap();
        let (updated, _) = record_activity(&id, ActivityType::LiquidityProvision, 200).unwrap();
        assert_eq!(updated.total_lp_actions, 1);
    }

    #[test]
    fn test_record_governance_increments_counter_v6() {
        let id = create_identity(test_hash(1), 100).unwrap();
        let (updated, _) = record_activity(&id, ActivityType::GovernanceVote, 200).unwrap();
        assert_eq!(updated.total_governance_votes, 1);
    }

    #[test]
    fn test_record_failed_reveal_increments_penalties_v6() {
        let id = create_identity(test_hash(1), 100).unwrap();
        let (updated, _) = record_activity(&id, ActivityType::FailedReveal, 200).unwrap();
        assert_eq!(updated.total_penalties, 1);
    }

    #[test]
    fn test_record_liquidated_increments_penalties_v6() {
        let id = create_identity(test_hash(1), 100).unwrap();
        let (updated, _) = record_activity(&id, ActivityType::Liquidated, 200).unwrap();
        assert_eq!(updated.total_penalties, 1);
    }

    #[test]
    fn test_record_stake_created_no_rep_change_v6() {
        let id = create_identity(test_hash(1), 100).unwrap();
        let (updated, change) = record_activity(&id, ActivityType::StakeCreated, 200).unwrap();
        assert_eq!(change.old_reputation, change.new_reputation);
        assert_eq!(updated.reputation, INITIAL_REPUTATION);
    }

    #[test]
    fn test_record_stake_withdrawn_no_rep_change_v6() {
        let id = create_identity(test_hash(1), 100).unwrap();
        let (updated, change) = record_activity(&id, ActivityType::StakeWithdrawn, 200).unwrap();
        assert_eq!(change.old_reputation, change.new_reputation);
        assert_eq!(updated.reputation, INITIAL_REPUTATION);
    }

    #[test]
    fn test_decay_preserves_address_count_v6() {
        let mut id = create_identity(test_hash(1), 100).unwrap();
        id = link_address(&id, test_hash(2), LinkType::Device, 100).unwrap();
        let decayed = apply_decay(&id, 5);
        assert_eq!(decayed.address_count, 2);
    }

    #[test]
    fn test_decay_100_epochs_from_initial_v6() {
        let id = create_identity(test_hash(1), 100).unwrap();
        let decayed = apply_decay(&id, 100);
        assert!(decayed.reputation < INITIAL_REPUTATION);
        assert!(decayed.reputation > 0, "100 epochs of 0.5% decay shouldn't reach zero from 1000");
    }

    #[test]
    fn test_decay_1000_epochs_reaches_zero_v6() {
        let id = create_identity(test_hash(1), 100).unwrap();
        let decayed = apply_decay(&id, 10000);
        assert_eq!(decayed.reputation, 0);
    }

    #[test]
    fn test_tier_boundaries_exact_v6() {
        assert_eq!(compute_reputation_tier(0), ReputationTier::Newcomer);
        assert_eq!(compute_reputation_tier(999), ReputationTier::Newcomer);
        assert_eq!(compute_reputation_tier(1000), ReputationTier::Participant);
        assert_eq!(compute_reputation_tier(2999), ReputationTier::Participant);
        assert_eq!(compute_reputation_tier(3000), ReputationTier::Contributor);
        assert_eq!(compute_reputation_tier(4999), ReputationTier::Contributor);
        assert_eq!(compute_reputation_tier(5000), ReputationTier::Veteran);
        assert_eq!(compute_reputation_tier(7499), ReputationTier::Veteran);
        assert_eq!(compute_reputation_tier(7500), ReputationTier::Elder);
        assert_eq!(compute_reputation_tier(9999), ReputationTier::Elder);
        assert_eq!(compute_reputation_tier(10000), ReputationTier::Legend);
    }

    #[test]
    fn test_trust_level_zero_everything_v6() {
        let mut id = create_identity(test_hash(1), 0).unwrap();
        id.reputation = 0;
        let trust = compute_trust_level(&id, 0);
        assert_eq!(trust, 0);
    }

    #[test]
    fn test_trust_level_max_reputation_only_v6() {
        let mut id = create_identity(test_hash(1), 0).unwrap();
        id.reputation = MAX_REPUTATION;
        // At block 0, age is 0, activity is 0
        let trust = compute_trust_level(&id, 0);
        assert_eq!(trust, 5000); // 50% from reputation only
    }

    #[test]
    fn test_has_priority_at_exactly_threshold_v6() {
        let mut id = create_identity(test_hash(1), 100).unwrap();
        id.reputation = MIN_REPUTATION_FOR_PRIORITY;
        assert!(has_priority_access(&id));
    }

    #[test]
    fn test_has_priority_one_below_threshold_v6() {
        let mut id = create_identity(test_hash(1), 100).unwrap();
        id.reputation = MIN_REPUTATION_FOR_PRIORITY - 1;
        assert!(!has_priority_access(&id));
    }

    #[test]
    fn test_is_active_at_exact_boundary_v6() {
        let mut id = create_identity(test_hash(1), 0).unwrap();
        id.last_active_block = 0;
        // At block == ACTIVITY_WINDOW_BLOCKS, should still be active
        assert!(is_active(&id, ACTIVITY_WINDOW_BLOCKS));
        // One more block — inactive
        assert!(!is_active(&id, ACTIVITY_WINDOW_BLOCKS + 1));
    }

    #[test]
    fn test_activity_score_all_max_u64_v6() {
        let mut id = create_identity(test_hash(1), 0).unwrap();
        id.total_trades = u64::MAX;
        id.total_lp_actions = u64::MAX;
        id.total_governance_votes = u64::MAX;
        // Should saturate, not overflow
        let score = compute_activity_score(&id);
        assert_eq!(score, u64::MAX);
    }

    #[test]
    fn test_merge_preserves_primary_id_hash_v6() {
        let id1 = create_identity(test_hash(1), 0).unwrap();
        let id2 = create_identity(test_hash(2), 0).unwrap();
        let merged = merge_identities(&id1, &id2).unwrap();
        assert_eq!(merged.id_hash, test_hash(1));
    }

    #[test]
    fn test_merge_sums_trades_v6() {
        let mut id1 = create_identity(test_hash(1), 0).unwrap();
        let mut id2 = create_identity(test_hash(2), 0).unwrap();
        id1.total_trades = 100;
        id2.total_trades = 200;
        let merged = merge_identities(&id1, &id2).unwrap();
        assert_eq!(merged.total_trades, 300);
    }

    #[test]
    fn test_merge_keeps_earlier_created_v6() {
        let id1 = create_identity(test_hash(1), 100).unwrap();
        let id2 = create_identity(test_hash(2), 50).unwrap();
        let merged = merge_identities(&id1, &id2).unwrap();
        assert_eq!(merged.created_block, 50);
    }

    #[test]
    fn test_merge_keeps_later_active_v6() {
        let mut id1 = create_identity(test_hash(1), 0).unwrap();
        let mut id2 = create_identity(test_hash(2), 0).unwrap();
        id1.last_active_block = 500;
        id2.last_active_block = 1000;
        let merged = merge_identities(&id1, &id2).unwrap();
        assert_eq!(merged.last_active_block, 1000);
    }

    #[test]
    fn test_leaderboard_correct_rank_assignment_v6() {
        let mut id1 = create_identity(test_hash(1), 0).unwrap();
        let mut id2 = create_identity(test_hash(2), 0).unwrap();
        let mut id3 = create_identity(test_hash(3), 0).unwrap();
        id1.reputation = 9000;
        id2.reputation = 5000;
        id3.reputation = 7000;
        let lb = build_leaderboard(&[id1, id2, id3], 10);
        assert_eq!(lb[0].rank, 1);
        assert_eq!(lb[0].reputation, 9000);
        assert_eq!(lb[1].rank, 2);
        assert_eq!(lb[1].reputation, 7000);
        assert_eq!(lb[2].rank, 3);
        assert_eq!(lb[2].reputation, 5000);
    }

    #[test]
    fn test_leaderboard_top_1_v6() {
        let mut id1 = create_identity(test_hash(1), 0).unwrap();
        let mut id2 = create_identity(test_hash(2), 0).unwrap();
        id1.reputation = 9000;
        id2.reputation = 5000;
        let lb = build_leaderboard(&[id1, id2], 1);
        assert_eq!(lb.len(), 1);
        assert_eq!(lb[0].reputation, 9000);
    }

    #[test]
    fn test_build_profile_returns_correct_tier_v6() {
        let mut id = create_identity(test_hash(1), 0).unwrap();
        id.reputation = 7500;
        let profile = build_profile(&id, 100);
        assert_eq!(profile.reputation_tier, ReputationTier::Elder);
    }

    #[test]
    fn test_build_profile_is_active_flag_v6() {
        let id = create_identity(test_hash(1), 100).unwrap();
        let profile = build_profile(&id, 100);
        assert!(profile.is_active);
        let profile_inactive = build_profile(&id, 100 + ACTIVITY_WINDOW_BLOCKS + 1);
        assert!(!profile_inactive.is_active);
    }

    #[test]
    fn test_reputation_change_records_block_v6() {
        let id = create_identity(test_hash(1), 0).unwrap();
        let (_, change) = record_activity(&id, ActivityType::Trade, 999).unwrap();
        assert_eq!(change.block_number, 999);
    }

    #[test]
    fn test_multiple_penalties_floor_at_zero_v6() {
        let mut id = create_identity(test_hash(1), 0).unwrap();
        id.reputation = 150; // Below one FailedReveal penalty
        let (updated, _) = record_activity(&id, ActivityType::FailedReveal, 100).unwrap();
        assert_eq!(updated.reputation, 50);
        let (updated2, _) = record_activity(&updated, ActivityType::FailedReveal, 200).unwrap();
        assert_eq!(updated2.reputation, 0);
    }

    #[test]
    fn test_find_address_returns_none_for_unlisted_v6() {
        let id = create_identity(test_hash(1), 0).unwrap();
        assert_eq!(find_address(&id, test_hash(99)), None);
    }

    #[test]
    fn test_find_address_returns_zero_for_primary_v6() {
        let id = create_identity(test_hash(1), 0).unwrap();
        assert_eq!(find_address(&id, test_hash(1)), Some(0));
    }

    // ============ Hardening Round 9 ============

    #[test]
    fn test_create_identity_zero_hash_h9() {
        let result = create_identity([0u8; 32], 100);
        assert_eq!(result, Err(IdentityError::ZeroHash));
    }

    #[test]
    fn test_create_identity_initial_state_h9() {
        let id = create_identity(test_hash(1), 500).unwrap();
        assert_eq!(id.reputation, INITIAL_REPUTATION);
        assert_eq!(id.address_count, 1);
        assert_eq!(id.created_block, 500);
        assert_eq!(id.last_active_block, 500);
        assert_eq!(id.total_trades, 0);
        assert_eq!(id.total_lp_actions, 0);
        assert_eq!(id.total_governance_votes, 0);
        assert_eq!(id.total_penalties, 0);
    }

    #[test]
    fn test_link_address_duplicate_h9() {
        let id = create_identity(test_hash(1), 0).unwrap();
        let result = link_address(&id, test_hash(1), LinkType::Device, 100);
        assert_eq!(result, Err(IdentityError::AddressAlreadyLinked));
    }

    #[test]
    fn test_link_address_success_h9() {
        let id = create_identity(test_hash(1), 0).unwrap();
        let updated = link_address(&id, test_hash(2), LinkType::Device, 100).unwrap();
        assert_eq!(updated.address_count, 2);
        assert_eq!(find_address(&updated, test_hash(2)), Some(1));
    }

    #[test]
    fn test_link_address_max_reached_h9() {
        let id = fully_linked_identity();
        let result = link_address(&id, test_hash(99), LinkType::Recovery, 100);
        assert_eq!(result, Err(IdentityError::MaxAddressesReached));
    }

    #[test]
    fn test_unlink_primary_fails_h9() {
        let id = create_identity(test_hash(1), 0).unwrap();
        let result = unlink_address(&id, test_hash(1));
        assert_eq!(result, Err(IdentityError::AddressNotFound));
    }

    #[test]
    fn test_unlink_nonexistent_fails_h9() {
        let id = create_identity(test_hash(1), 0).unwrap();
        let result = unlink_address(&id, test_hash(99));
        assert_eq!(result, Err(IdentityError::AddressNotFound));
    }

    #[test]
    fn test_unlink_address_shifts_remaining_h9() {
        let id = create_identity(test_hash(1), 0).unwrap();
        let id = link_address(&id, test_hash(2), LinkType::Device, 100).unwrap();
        let id = link_address(&id, test_hash(3), LinkType::Hardware, 200).unwrap();
        let updated = unlink_address(&id, test_hash(2)).unwrap();
        assert_eq!(updated.address_count, 2);
        assert_eq!(find_address(&updated, test_hash(3)), Some(1));
    }

    #[test]
    fn test_record_activity_trade_h9() {
        let id = create_identity(test_hash(1), 0).unwrap();
        let (updated, change) = record_activity(&id, ActivityType::Trade, 100).unwrap();
        assert_eq!(updated.reputation, INITIAL_REPUTATION + REPUTATION_BOOST_TRADE);
        assert_eq!(updated.total_trades, 1);
        assert_eq!(change.old_reputation, INITIAL_REPUTATION);
        assert_eq!(change.new_reputation, INITIAL_REPUTATION + REPUTATION_BOOST_TRADE);
    }

    #[test]
    fn test_record_activity_lp_h9() {
        let id = create_identity(test_hash(1), 0).unwrap();
        let (updated, _) = record_activity(&id, ActivityType::LiquidityProvision, 100).unwrap();
        assert_eq!(updated.reputation, INITIAL_REPUTATION + REPUTATION_BOOST_LP);
        assert_eq!(updated.total_lp_actions, 1);
    }

    #[test]
    fn test_record_activity_governance_h9() {
        let id = create_identity(test_hash(1), 0).unwrap();
        let (updated, _) = record_activity(&id, ActivityType::GovernanceVote, 100).unwrap();
        assert_eq!(updated.reputation, INITIAL_REPUTATION + REPUTATION_BOOST_GOVERNANCE);
        assert_eq!(updated.total_governance_votes, 1);
    }

    #[test]
    fn test_record_activity_failed_reveal_h9() {
        let id = create_identity(test_hash(1), 0).unwrap();
        let (updated, _) = record_activity(&id, ActivityType::FailedReveal, 100).unwrap();
        assert_eq!(updated.reputation, INITIAL_REPUTATION - REPUTATION_PENALTY_FAILED_REVEAL);
        assert_eq!(updated.total_penalties, 1);
    }

    #[test]
    fn test_record_activity_reputation_capped_h9() {
        let mut id = create_identity(test_hash(1), 0).unwrap();
        id.reputation = MAX_REPUTATION - 5;
        let (updated, _) = record_activity(&id, ActivityType::Trade, 100).unwrap();
        assert_eq!(updated.reputation, MAX_REPUTATION); // Capped
    }

    #[test]
    fn test_record_activity_reputation_floor_zero_h9() {
        let mut id = create_identity(test_hash(1), 0).unwrap();
        id.reputation = 50;
        let (updated, _) = record_activity(&id, ActivityType::Liquidated, 100).unwrap();
        assert_eq!(updated.reputation, 0); // 50 - 200 saturates to 0
    }

    #[test]
    fn test_record_activity_neutral_h9() {
        let id = create_identity(test_hash(1), 0).unwrap();
        let (updated, _) = record_activity(&id, ActivityType::StakeCreated, 100).unwrap();
        assert_eq!(updated.reputation, INITIAL_REPUTATION); // No change
    }

    #[test]
    fn test_apply_decay_zero_epochs_h9() {
        let id = create_identity(test_hash(1), 0).unwrap();
        let decayed = apply_decay(&id, 0);
        assert_eq!(decayed.reputation, id.reputation);
    }

    #[test]
    fn test_apply_decay_single_epoch_h9() {
        let id = create_identity(test_hash(1), 0).unwrap();
        let decayed = apply_decay(&id, 1);
        // 0.5% decay: 1000 - 5 = 995
        assert_eq!(decayed.reputation, 995);
    }

    #[test]
    fn test_apply_decay_many_epochs_to_zero_h9() {
        let id = create_identity(test_hash(1), 0).unwrap();
        let decayed = apply_decay(&id, 10_000);
        assert_eq!(decayed.reputation, 0);
    }

    #[test]
    fn test_compute_reputation_tier_boundaries_h9() {
        assert_eq!(compute_reputation_tier(0), ReputationTier::Newcomer);
        assert_eq!(compute_reputation_tier(999), ReputationTier::Newcomer);
        assert_eq!(compute_reputation_tier(1_000), ReputationTier::Participant);
        assert_eq!(compute_reputation_tier(2_999), ReputationTier::Participant);
        assert_eq!(compute_reputation_tier(3_000), ReputationTier::Contributor);
        assert_eq!(compute_reputation_tier(5_000), ReputationTier::Veteran);
        assert_eq!(compute_reputation_tier(7_500), ReputationTier::Elder);
        assert_eq!(compute_reputation_tier(MAX_REPUTATION), ReputationTier::Legend);
    }

    #[test]
    fn test_has_priority_access_h9() {
        assert!(!has_priority_access(&identity_with_reputation(4_999)));
        assert!(has_priority_access(&identity_with_reputation(5_000)));
        assert!(has_priority_access(&identity_with_reputation(10_000)));
    }

    #[test]
    fn test_compute_trust_level_new_identity_h9() {
        let id = create_identity(test_hash(1), 1000).unwrap();
        let trust = compute_trust_level(&id, 1000);
        // Rep component: 1000/10000 * 5000 = 500
        // Age component: 0/100000 * 3000 = 0
        // Activity: 0 -> 0
        assert_eq!(trust, 500);
    }

    #[test]
    fn test_compute_activity_score_h9() {
        let id = identity_with_all_activities(10, 5, 2);
        let score = compute_activity_score(&id);
        // 10*1 + 5*3 + 2*5 = 10+15+10 = 35
        assert_eq!(score, 35);
    }

    #[test]
    fn test_is_active_within_window_h9() {
        let mut id = create_identity(test_hash(1), 0).unwrap();
        id.last_active_block = 500;
        assert!(is_active(&id, 500 + ACTIVITY_WINDOW_BLOCKS));
        assert!(!is_active(&id, 500 + ACTIVITY_WINDOW_BLOCKS + 1));
    }

    #[test]
    fn test_build_profile_h9() {
        let id = identity_with_reputation(5_000);
        let profile = build_profile(&id, 2000);
        assert_eq!(profile.reputation_tier, ReputationTier::Veteran);
    }

    #[test]
    fn test_merge_identities_reputation_capped_h9() {
        let a = identity_with_reputation(8_000);
        let b = identity_with_reputation(8_000);
        let merged = merge_identities(&a, &b).unwrap();
        assert_eq!(merged.reputation, MAX_REPUTATION);
    }

    #[test]
    fn test_merge_identities_addresses_combined_h9() {
        let a = create_identity(test_hash(1), 0).unwrap();
        let b = create_identity(test_hash(2), 0).unwrap();
        let merged = merge_identities(&a, &b).unwrap();
        // a has hash(1), b has hash(2) -> merged has both
        assert_eq!(merged.address_count, 2);
        assert!(find_address(&merged, test_hash(1)).is_some());
        assert!(find_address(&merged, test_hash(2)).is_some());
    }

    #[test]
    fn test_reputation_to_fee_discount_zero_h9() {
        assert_eq!(reputation_to_fee_discount_bps(0), 0);
    }

    #[test]
    fn test_reputation_to_fee_discount_max_h9() {
        assert_eq!(reputation_to_fee_discount_bps(MAX_REPUTATION), MAX_FEE_DISCOUNT_BPS);
    }

    #[test]
    fn test_reputation_to_fee_discount_mid_h9() {
        let discount = reputation_to_fee_discount_bps(5_000);
        // 5000/10000 * 500 = 250
        assert_eq!(discount, 250);
    }

    #[test]
    fn test_build_leaderboard_empty_h9() {
        let lb = build_leaderboard(&[], 10);
        assert!(lb.is_empty());
    }

    #[test]
    fn test_build_leaderboard_sorted_h9() {
        let a = identity_with_reputation(500);
        let b = identity_with_reputation(9_000);
        let c = identity_with_reputation(3_000);
        let lb = build_leaderboard(&[a, b, c], 10);
        assert_eq!(lb.len(), 3);
        assert_eq!(lb[0].reputation, 9_000);
        assert_eq!(lb[1].reputation, 3_000);
        assert_eq!(lb[2].reputation, 500);
        assert_eq!(lb[0].rank, 1);
    }
}
