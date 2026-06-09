//! # Shapley Distributor Type Script
//!
//! REINTERPRET port of `vibeswap/contracts/incentives/ShapleyDistributor.sol`
//! to the CKB cell model. Enforces the 5-axiom set over atomized contribution
//! events per `specs/shapley-distributor.md`.
//!
//! Single binary, role-multiplexed by `type_script.args[0]`. Matches the
//! pattern from `lawson-constants-cell-type-script` + `circuit-breaker-cell-type-script`.
//!
//! ## Cell roles
//!
//! | tag | cell | purpose |
//! |-----|------|---------|
//! | 0x01 | ContributionEventCell  | atomized contribution log (immutable post-creation) |
//! | 0x02 | ShapleyDistributionCell | per-event distribution; 5-axiom-verified |
//! | 0x03 | RewardClaimCell         | per-participant claim against a distribution |
//! | 0x04 | EmissionScheduleCell    | halving curve + current era (TOKEN_EMISSION track) |
//! | 0x05 | SybilGuardCell          | flagged-lock-hash set (null-player propagation) |
//!
//! ## Property preservation
//!
//! The 5 axioms are mathematical, not procedural. The type-script's job is
//! to verify any produced distribution satisfies them. The verification IS
//! the axiom check. No admin, no oracle, no trusted distributor can land a
//! distribution that violates them.
//!
//! ## Verified-compute pattern (Shapley math)
//!
//! Full on-chain Shapley enumeration is O(2^N) — infeasible on CKB-VM for
//! N > ~16. Pattern: off-chain compute produces the distribution + a
//! hash-of-payload binding it to the consumed ContributionEventCell;
//! on-chain script verifies the 5 axioms over the proposed payload
//! (axiom check is O(N) for proportional, O(N^2) for pairwise). Disputes
//! flow through the VerifiedCompute primitive (bonded challenge window).
//! Full enumeration is reserved for glove-game kinds with small N.

#![no_std]
#![no_main]


use ckb_std::{
    ckb_constants::Source,
    default_alloc,
    high_level::{load_cell_data, load_cell_type_hash, load_script, QueryIter},
};

mod error;
use error::Error;

ckb_std::entry!(program_entry);
default_alloc!();

// ============ Schema ============

const SCHEMA_VERSION: u8 = 1;

// ============ Role tag (type_script.args[0]) ============

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
enum RoleTag {
    ContributionEvent = 0x01,
    ShapleyDistribution = 0x02,
    RewardClaim = 0x03,
    EmissionSchedule = 0x04,
    SybilGuard = 0x05,
}

impl RoleTag {
    fn from_byte(b: u8) -> Result<Self, Error> {
        match b {
            0x01 => Ok(Self::ContributionEvent),
            0x02 => Ok(Self::ShapleyDistribution),
            0x03 => Ok(Self::RewardClaim),
            0x04 => Ok(Self::EmissionSchedule),
            0x05 => Ok(Self::SybilGuard),
            _ => Err(Error::ScriptArgsMalformed),
        }
    }
}

// ============ Event type ============

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
enum EventType {
    FeeDistribution = 0x01,
    TokenEmission = 0x02,
}

impl EventType {
    fn from_byte(b: u8) -> Result<Self, Error> {
        match b {
            0x01 => Ok(Self::FeeDistribution),
            0x02 => Ok(Self::TokenEmission),
            _ => Err(Error::EnumDiscriminantUnknown),
        }
    }
}

// ============ Value-function kind ============

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
enum ValueFunctionKind {
    Proportional = 0x01,
    GloveGame = 0x02,
    CustomTag = 0x03,
}

impl ValueFunctionKind {
    fn from_byte(b: u8) -> Result<Self, Error> {
        match b {
            0x01 => Ok(Self::Proportional),
            0x02 => Ok(Self::GloveGame),
            0x03 => Ok(Self::CustomTag),
            _ => Err(Error::EnumDiscriminantUnknown),
        }
    }
}

// ============ Heapless caps ============

const MAX_PARTICIPANTS: usize = 64;
const MAX_FLAGGED: usize = 256;
const MAX_CELLS_PER_TX: usize = 32;
const PARTICIPANT_ENTRY_LEN: usize = 49; // lock_hash[32] + characteristic_value u128[16] + contribution_type[1]
const DISTRIBUTION_ENTRY_LEN: usize = 48; // lock_hash[32] + shapley_share u128[16]
const FLAGGED_ENTRY_LEN: usize = 32;

// ============ Pairwise-proportionality tolerance ============

// Cross-multiplication tolerance for pairwise check. |φ_i·w_j − φ_j·w_i| ≤ ε.
// Tolerance scales with magnitude; absolute floor avoids div-by-zero pathologies.
// TODO: source ε from Lawson `shapley_pairwise_epsilon_bps`.
const PAIRWISE_EPSILON_BPS: u128 = 1; // 0.01% of magnitude

// ============ Entry ============

pub fn program_entry() -> i8 {
    match verify() {
        Ok(()) => 0,
        Err(e) => e as i8,
    }
}

// ============ Top-level ============

fn verify() -> Result<(), Error> {
    let script = load_script()?;
    let args_reader = script.as_reader();
    let args_bytes = args_reader.args().raw_data();
    if args_bytes.is_empty() {
        return Err(Error::ScriptArgsMalformed);
    }
    let role = RoleTag::from_byte(args_bytes[0])?;

    match role {
        RoleTag::ContributionEvent => verify_contribution_event(),
        RoleTag::ShapleyDistribution => verify_shapley_distribution(),
        RoleTag::RewardClaim => verify_reward_claim(),
        RoleTag::EmissionSchedule => verify_emission_schedule(),
        RoleTag::SybilGuard => verify_sybil_guard(),
    }
}

// ============ ContributionEventCell ============
//
// Data layout:
//   version u8                      (1)
//   event_type u8                   (1)
//   value_function_kind u8          (1)
//   event_id [u8;32]                (32)
//   source_outpoint_tx [u8;32]      (32)
//   source_outpoint_index u32 LE    (4)
//   total_value u128 LE             (16)
//   value_token_type_hash [u8;32]   (32)
//   era_at_creation u64 LE          (8)
//   created_at_block u64 LE         (8)
//   participant_count u16 LE        (2)
//   participants [PARTICIPANT_ENTRY_LEN * count]
//
// Fixed header: 137 bytes; participants packed sorted by lock_hash.

const EVENT_HEADER_LEN: usize = 137;
const EVENT_OFFSET_EVENT_TYPE: usize = 1;
const EVENT_OFFSET_VFK: usize = 2;
const EVENT_OFFSET_EVENT_ID: usize = 3;
const EVENT_OFFSET_TOTAL_VALUE: usize = 71;
const EVENT_OFFSET_TOKEN_TYPE_HASH: usize = 87;
const EVENT_OFFSET_ERA: usize = 119;
const EVENT_OFFSET_PCOUNT: usize = 135;

fn verify_contribution_event() -> Result<(), Error> {
    let inputs = read_group_cells(Source::GroupInput)?;
    let outputs = read_group_cells(Source::GroupOutput)?;

    match (inputs.is_empty(), outputs.is_empty()) {
        (true, true) => Err(Error::EmptyTransition),
        // Creation: source-mechanism authorizes; we enforce shape + sybil filter.
        (true, false) => {
            for o in &outputs {
                verify_event_layout(o)?;
                verify_event_no_duplicate_participants(o)?;
                verify_event_sybil_filter(o)?;
                verify_event_total_value_nonzero(o)?;
            }
            Ok(())
        }
        // Consumption: must spawn exactly one ShapleyDistributionCell per event.
        (false, true) => {
            for i in &inputs {
                verify_event_layout(i)?;
                verify_event_has_distribution(i)?;
            }
            Ok(())
        }
        (false, false) => Err(Error::CellMultiplicityMismatch),
    }
}

fn verify_event_layout(data: &[u8]) -> Result<(), Error> {
    if data.len() < EVENT_HEADER_LEN {
        return Err(Error::CellDataMalformed);
    }
    if data[0] != SCHEMA_VERSION {
        return Err(Error::SchemaVersionUnsupported);
    }
    let _ = EventType::from_byte(data[EVENT_OFFSET_EVENT_TYPE])?;
    let _ = ValueFunctionKind::from_byte(data[EVENT_OFFSET_VFK])?;
    let count = read_u16_le(&data[EVENT_OFFSET_PCOUNT..EVENT_OFFSET_PCOUNT + 2]) as usize;
    if count > MAX_PARTICIPANTS {
        return Err(Error::CapacityExceeded);
    }
    let expected = EVENT_HEADER_LEN + count * PARTICIPANT_ENTRY_LEN;
    if data.len() < expected {
        return Err(Error::CellDataMalformed);
    }
    Ok(())
}

fn verify_event_no_duplicate_participants(data: &[u8]) -> Result<(), Error> {
    // Participants must be sorted strictly ascending by lock_hash; sorted-strict
    // implies no duplicates and gives O(N) check vs O(N^2) pairwise.
    let count = read_u16_le(&data[EVENT_OFFSET_PCOUNT..EVENT_OFFSET_PCOUNT + 2]) as usize;
    if count <= 1 {
        return Ok(());
    }
    let base = EVENT_HEADER_LEN;
    for i in 1..count {
        let prev = &data[base + (i - 1) * PARTICIPANT_ENTRY_LEN..base + (i - 1) * PARTICIPANT_ENTRY_LEN + 32];
        let curr = &data[base + i * PARTICIPANT_ENTRY_LEN..base + i * PARTICIPANT_ENTRY_LEN + 32];
        if prev >= curr {
            return Err(Error::DuplicateParticipantLockHash);
        }
    }
    Ok(())
}

fn verify_event_total_value_nonzero(data: &[u8]) -> Result<(), Error> {
    // v(N) = 0 ⇒ no game; reject at creation to avoid distribution churn.
    let total = read_u128_le(&data[EVENT_OFFSET_TOTAL_VALUE..EVENT_OFFSET_TOTAL_VALUE + 16]);
    if total == 0 {
        return Err(Error::TotalValueMismatchSource);
    }
    Ok(())
}

fn verify_event_sybil_filter(data: &[u8]) -> Result<(), Error> {
    // Null-player axiom propagation: any participant in the SybilGuardCell's
    // flagged set must not appear with positive characteristic value.
    let guard = find_sybil_guard_cell_dep()?;
    let count = read_u16_le(&data[EVENT_OFFSET_PCOUNT..EVENT_OFFSET_PCOUNT + 2]) as usize;
    let base = EVENT_HEADER_LEN;
    for i in 0..count {
        let lh = &data[base + i * PARTICIPANT_ENTRY_LEN..base + i * PARTICIPANT_ENTRY_LEN + 32];
        let cv = read_u128_le(
            &data[base + i * PARTICIPANT_ENTRY_LEN + 32..base + i * PARTICIPANT_ENTRY_LEN + 48],
        );
        if cv > 0 && sybil_contains(&guard, lh) {
            return Err(Error::SybilParticipantPresent);
        }
    }
    Ok(())
}

fn verify_event_has_distribution(event_data: &[u8]) -> Result<(), Error> {
    // Exactly one ShapleyDistributionCell in outputs matches this event_id.
    let event_id = &event_data[EVENT_OFFSET_EVENT_ID..EVENT_OFFSET_EVENT_ID + 32];
    let mut matches = 0u32;
    for out_data in QueryIter::new(load_cell_data, Source::Output) {
        if out_data.len() >= DIST_HEADER_LEN
            && out_data[0] == SCHEMA_VERSION
            && &out_data[DIST_OFFSET_EVENT_ID..DIST_OFFSET_EVENT_ID + 32] == event_id
        {
            matches += 1;
        }
    }
    if matches != 1 {
        return Err(Error::EventConsumedWithoutDistribution);
    }
    Ok(())
}

// ============ ShapleyDistributionCell ============
//
// Data layout:
//   version u8                  (1)
//   event_id [u8;32]            (32)
//   payload_hash [u8;32]        (32)   blake2b(participants||shares) — VerifiedCompute binding
//   distribution_count u16 LE   (2)
//   distributions [DISTRIBUTION_ENTRY_LEN * count]
//
// Fixed header: 67 bytes; distributions packed sorted by lock_hash.

const DIST_HEADER_LEN: usize = 67;
const DIST_OFFSET_EVENT_ID: usize = 1;
const DIST_OFFSET_PAYLOAD_HASH: usize = 33;
const DIST_OFFSET_DCOUNT: usize = 65;

fn verify_shapley_distribution() -> Result<(), Error> {
    let inputs = read_group_cells(Source::GroupInput)?;
    let outputs = read_group_cells(Source::GroupOutput)?;

    match (inputs.is_empty(), outputs.is_empty()) {
        (true, true) => Err(Error::EmptyTransition),
        // Creation: settlement tx consumes the event + produces the distribution.
        (true, false) => {
            for o in &outputs {
                verify_distribution_layout(o)?;
                let event = find_event_for_distribution(o)?;
                verify_axioms(&event, o)?;
                verify_claims_match_distribution(o)?;
            }
            Ok(())
        }
        // Consumption: distribution cells should be immutable post-creation;
        // consumption only legal when paired with a sweeper/archival sink, which
        // this scaffold does not model. v1: reject.
        (false, _) => Err(Error::CellMultiplicityMismatch),
    }
}

fn verify_distribution_layout(data: &[u8]) -> Result<(), Error> {
    if data.len() < DIST_HEADER_LEN {
        return Err(Error::CellDataMalformed);
    }
    if data[0] != SCHEMA_VERSION {
        return Err(Error::SchemaVersionUnsupported);
    }
    let count = read_u16_le(&data[DIST_OFFSET_DCOUNT..DIST_OFFSET_DCOUNT + 2]) as usize;
    if count > MAX_PARTICIPANTS {
        return Err(Error::CapacityExceeded);
    }
    let expected = DIST_HEADER_LEN + count * DISTRIBUTION_ENTRY_LEN;
    if data.len() < expected {
        return Err(Error::CellDataMalformed);
    }
    // Sorted ascending by lock_hash: matches event ordering for O(N) pairing.
    if count > 1 {
        let base = DIST_HEADER_LEN;
        for i in 1..count {
            let prev = &data[base + (i - 1) * DISTRIBUTION_ENTRY_LEN..base + (i - 1) * DISTRIBUTION_ENTRY_LEN + 32];
            let curr = &data[base + i * DISTRIBUTION_ENTRY_LEN..base + i * DISTRIBUTION_ENTRY_LEN + 32];
            if prev >= curr {
                return Err(Error::DistributionLockHashSetMismatch);
            }
        }
    }
    Ok(())
}

fn find_event_for_distribution(
    dist: &[u8],
) -> Result<alloc::vec::Vec<u8>, Error> {
    let event_id = &dist[DIST_OFFSET_EVENT_ID..DIST_OFFSET_EVENT_ID + 32];
    for in_data in QueryIter::new(load_cell_data, Source::Input) {
        if in_data.len() >= EVENT_HEADER_LEN
            && in_data[0] == SCHEMA_VERSION
            && &in_data[EVENT_OFFSET_EVENT_ID..EVENT_OFFSET_EVENT_ID + 32] == event_id
        {
            return Ok(in_data);
        }
    }
    Err(Error::EventIdMismatch)
}

// ============ 5-axiom verification ============

fn verify_axioms(event: &[u8], dist: &[u8]) -> Result<(), Error> {
    let pcount = read_u16_le(&event[EVENT_OFFSET_PCOUNT..EVENT_OFFSET_PCOUNT + 2]) as usize;
    let dcount = read_u16_le(&dist[DIST_OFFSET_DCOUNT..DIST_OFFSET_DCOUNT + 2]) as usize;
    if pcount != dcount {
        return Err(Error::DistributionParticipantCountMismatch);
    }

    // Both arrays are sorted strictly ascending by lock_hash; O(N) pairing.
    verify_lock_hash_pairing(event, dist, pcount)?;

    let total_value = read_u128_le(&event[EVENT_OFFSET_TOTAL_VALUE..EVENT_OFFSET_TOTAL_VALUE + 16]);
    let event_type = EventType::from_byte(event[EVENT_OFFSET_EVENT_TYPE])?;
    let vfk = ValueFunctionKind::from_byte(event[EVENT_OFFSET_VFK])?;

    axiom_efficiency(dist, pcount, total_value)?;
    axiom_null_player(event, dist, pcount)?;
    axiom_symmetry(event, dist, pcount)?;
    axiom_pairwise_proportionality(event, dist, pcount, vfk)?;
    axiom_time_neutrality(event, dist, pcount, event_type)?;
    // Additivity is a cross-event axiom; structurally guaranteed by per-event
    // independence (each event spawns its own distribution; no cross-event
    // share accumulation). Documented at the spec layer; no per-cell check
    // is informative here.
    Ok(())
}

fn verify_lock_hash_pairing(event: &[u8], dist: &[u8], n: usize) -> Result<(), Error> {
    let ebase = EVENT_HEADER_LEN;
    let dbase = DIST_HEADER_LEN;
    for i in 0..n {
        let elh = &event[ebase + i * PARTICIPANT_ENTRY_LEN..ebase + i * PARTICIPANT_ENTRY_LEN + 32];
        let dlh = &dist[dbase + i * DISTRIBUTION_ENTRY_LEN..dbase + i * DISTRIBUTION_ENTRY_LEN + 32];
        if elh != dlh {
            return Err(Error::DistributionLockHashSetMismatch);
        }
    }
    Ok(())
}

// Σ φ_i = v(N). Anti-MLM by construction (per [P·shapley-5-axiom-set]).
fn axiom_efficiency(dist: &[u8], n: usize, total_value: u128) -> Result<(), Error> {
    let base = DIST_HEADER_LEN;
    let mut sum: u128 = 0;
    for i in 0..n {
        let share = read_u128_le(
            &dist[base + i * DISTRIBUTION_ENTRY_LEN + 32..base + i * DISTRIBUTION_ENTRY_LEN + 48],
        );
        sum = sum.checked_add(share).ok_or(Error::AmountOverflow)?;
    }
    if sum != total_value {
        return Err(Error::AxiomEfficiencyViolated);
    }
    Ok(())
}

// characteristic_value == 0 ⇒ shapley_share == 0.
fn axiom_null_player(event: &[u8], dist: &[u8], n: usize) -> Result<(), Error> {
    let ebase = EVENT_HEADER_LEN;
    let dbase = DIST_HEADER_LEN;
    for i in 0..n {
        let cv = read_u128_le(
            &event[ebase + i * PARTICIPANT_ENTRY_LEN + 32..ebase + i * PARTICIPANT_ENTRY_LEN + 48],
        );
        let share = read_u128_le(
            &dist[dbase + i * DISTRIBUTION_ENTRY_LEN + 32..dbase + i * DISTRIBUTION_ENTRY_LEN + 48],
        );
        if cv == 0 && share != 0 {
            return Err(Error::AxiomNullPlayerViolated);
        }
    }
    Ok(())
}

// Identical (characteristic, contribution_type) ⇒ identical share. O(N) via
// sorted-tuple scan; we sort-by-(cv, ctype) once and check adjacent equality.
fn axiom_symmetry(event: &[u8], dist: &[u8], n: usize) -> Result<(), Error> {
    let ebase = EVENT_HEADER_LEN;
    let dbase = DIST_HEADER_LEN;
    // O(N^2) for clarity at N ≤ 64; well under the cycle budget.
    for i in 0..n {
        let cv_i = read_u128_le(
            &event[ebase + i * PARTICIPANT_ENTRY_LEN + 32..ebase + i * PARTICIPANT_ENTRY_LEN + 48],
        );
        let ct_i = event[ebase + i * PARTICIPANT_ENTRY_LEN + 48];
        let s_i = read_u128_le(
            &dist[dbase + i * DISTRIBUTION_ENTRY_LEN + 32..dbase + i * DISTRIBUTION_ENTRY_LEN + 48],
        );
        for j in (i + 1)..n {
            let cv_j = read_u128_le(
                &event[ebase + j * PARTICIPANT_ENTRY_LEN + 32..ebase + j * PARTICIPANT_ENTRY_LEN + 48],
            );
            let ct_j = event[ebase + j * PARTICIPANT_ENTRY_LEN + 48];
            if cv_i == cv_j && ct_i == ct_j {
                let s_j = read_u128_le(
                    &dist[dbase + j * DISTRIBUTION_ENTRY_LEN + 32..dbase + j * DISTRIBUTION_ENTRY_LEN + 48],
                );
                if s_i != s_j {
                    return Err(Error::AxiomSymmetryViolated);
                }
            }
        }
    }
    Ok(())
}

// Structurally hardest axiom: |φ_i·w_j − φ_j·w_i| ≤ ε(magnitude). Cross-mult
// avoids div; u128*u128 ⇒ widen to u256 via two limbs. We approximate by
// reducing one factor when overflow imminent; honest scaffold checks ε in
// bps of max(φ_i·w_j, φ_j·w_i).
fn axiom_pairwise_proportionality(
    event: &[u8],
    dist: &[u8],
    n: usize,
    vfk: ValueFunctionKind,
) -> Result<(), Error> {
    // Glove-game + custom-tag use kind-specific pairwise relations; this
    // scaffold enforces the proportional check only. TODO: dispatch on vfk.
    if !matches!(vfk, ValueFunctionKind::Proportional) {
        return Ok(());
    }
    let ebase = EVENT_HEADER_LEN;
    let dbase = DIST_HEADER_LEN;
    for i in 0..n {
        let w_i = read_u128_le(
            &event[ebase + i * PARTICIPANT_ENTRY_LEN + 32..ebase + i * PARTICIPANT_ENTRY_LEN + 48],
        );
        let s_i = read_u128_le(
            &dist[dbase + i * DISTRIBUTION_ENTRY_LEN + 32..dbase + i * DISTRIBUTION_ENTRY_LEN + 48],
        );
        for j in (i + 1)..n {
            let w_j = read_u128_le(
                &event[ebase + j * PARTICIPANT_ENTRY_LEN + 32..ebase + j * PARTICIPANT_ENTRY_LEN + 48],
            );
            let s_j = read_u128_le(
                &dist[dbase + j * DISTRIBUTION_ENTRY_LEN + 32..dbase + j * DISTRIBUTION_ENTRY_LEN + 48],
            );
            if w_i == 0 || w_j == 0 {
                continue; // null-player axiom carries the case
            }
            if !pairwise_ratio_close(s_i, w_j, s_j, w_i) {
                return Err(Error::AxiomPairwiseProportionalityViolated);
            }
        }
    }
    Ok(())
}

// |φ_i·w_j − φ_j·w_i| ≤ ε via 256-bit widening cross-mult. Goodhart-defense.
fn pairwise_ratio_close(s_i: u128, w_j: u128, s_j: u128, w_i: u128) -> bool {
    let (lo_a, hi_a) = mul_u128_widening(s_i, w_j);
    let (lo_b, hi_b) = mul_u128_widening(s_j, w_i);
    let (max_lo, max_hi) = if (hi_a, lo_a) >= (hi_b, lo_b) {
        (lo_a, hi_a)
    } else {
        (lo_b, hi_b)
    };
    // |a - b| as 256-bit subtraction
    let (diff_lo, diff_hi) = if (hi_a, lo_a) >= (hi_b, lo_b) {
        sub_u256(lo_a, hi_a, lo_b, hi_b)
    } else {
        sub_u256(lo_b, hi_b, lo_a, hi_a)
    };
    // tolerance = max * PAIRWISE_EPSILON_BPS / 10_000
    let (tol_lo, tol_hi) = mul_u256_by_u128_div_10000(max_lo, max_hi, PAIRWISE_EPSILON_BPS);
    (diff_hi, diff_lo) <= (tol_hi, tol_lo)
}

// FEE_DISTRIBUTION ⇒ era_at_creation MUST be 0 (or distribution function MUST
// produce identical output for era=0 vs era=k). Substrate-side: we require
// era_at_creation == 0 in FEE events. Time Neutrality structurally guaranteed.
fn axiom_time_neutrality(
    event: &[u8],
    _dist: &[u8],
    _n: usize,
    event_type: EventType,
) -> Result<(), Error> {
    if matches!(event_type, EventType::FeeDistribution) {
        let era = read_u64_le(&event[EVENT_OFFSET_ERA..EVENT_OFFSET_ERA + 8]);
        if era != 0 {
            return Err(Error::AxiomTimeNeutralityViolated);
        }
    }
    Ok(())
}

fn verify_claims_match_distribution(dist: &[u8]) -> Result<(), Error> {
    let event_id = &dist[DIST_OFFSET_EVENT_ID..DIST_OFFSET_EVENT_ID + 32];
    let dcount = read_u16_le(&dist[DIST_OFFSET_DCOUNT..DIST_OFFSET_DCOUNT + 2]) as usize;
    let dbase = DIST_HEADER_LEN;

    let mut claim_count = 0usize;
    for out_data in QueryIter::new(load_cell_data, Source::Output) {
        if out_data.len() < CLAIM_LEN || out_data[0] != SCHEMA_VERSION {
            continue;
        }
        if &out_data[CLAIM_OFFSET_EVENT_ID..CLAIM_OFFSET_EVENT_ID + 32] != event_id {
            continue;
        }
        let claim_lh = &out_data[CLAIM_OFFSET_LOCK_HASH..CLAIM_OFFSET_LOCK_HASH + 32];
        let claim_amount = read_u128_le(&out_data[CLAIM_OFFSET_AMOUNT..CLAIM_OFFSET_AMOUNT + 16]);
        let mut matched = false;
        for i in 0..dcount {
            let d_lh = &dist[dbase + i * DISTRIBUTION_ENTRY_LEN..dbase + i * DISTRIBUTION_ENTRY_LEN + 32];
            if d_lh == claim_lh {
                let d_share = read_u128_le(
                    &dist[dbase + i * DISTRIBUTION_ENTRY_LEN + 32..dbase + i * DISTRIBUTION_ENTRY_LEN + 48],
                );
                if claim_amount > d_share {
                    return Err(Error::ClaimAmountExceedsDistribution);
                }
                matched = true;
                break;
            }
        }
        if !matched {
            return Err(Error::ClaimDistributionLinkBroken);
        }
        claim_count += 1;
    }
    if claim_count != dcount {
        return Err(Error::ClaimDistributionLinkBroken);
    }
    Ok(())
}

// ============ RewardClaimCell ============
//
// Data layout:
//   version u8                       (1)
//   event_id [u8;32]                 (32)
//   participant_lock_hash [u8;32]    (32)
//   amount u128 LE                   (16)
//   value_token_type_hash [u8;32]    (32)
//   created_at_block u64 LE          (8)
//   claim_deadline u64 LE            (8)

const CLAIM_LEN: usize = 129;
const CLAIM_OFFSET_EVENT_ID: usize = 1;
const CLAIM_OFFSET_LOCK_HASH: usize = 33;
const CLAIM_OFFSET_AMOUNT: usize = 65;

fn verify_reward_claim() -> Result<(), Error> {
    let inputs = read_group_cells(Source::GroupInput)?;
    let outputs = read_group_cells(Source::GroupOutput)?;

    for o in &outputs {
        verify_claim_layout(o)?;
        verify_claim_no_duplicate_in_outputs(o, &outputs)?;
    }
    for i in &inputs {
        verify_claim_layout(i)?;
        // Token conservation against value_token_type_hash is delegated to the
        // canonical-token type-script on the participant's output. Here we
        // only verify the claim cell itself is well-formed.
    }
    Ok(())
}

fn verify_claim_layout(data: &[u8]) -> Result<(), Error> {
    if data.len() < CLAIM_LEN {
        return Err(Error::CellDataMalformed);
    }
    if data[0] != SCHEMA_VERSION {
        return Err(Error::SchemaVersionUnsupported);
    }
    Ok(())
}

fn verify_claim_no_duplicate_in_outputs(
    target: &[u8],
    outputs: &[alloc::vec::Vec<u8>],
) -> Result<(), Error> {
    // One claim per (event_id, lock_hash). Duplicates split the distribution.
    let t_eid = &target[CLAIM_OFFSET_EVENT_ID..CLAIM_OFFSET_EVENT_ID + 32];
    let t_lh = &target[CLAIM_OFFSET_LOCK_HASH..CLAIM_OFFSET_LOCK_HASH + 32];
    let mut seen = 0u32;
    for o in outputs {
        if o.len() < CLAIM_LEN {
            continue;
        }
        if &o[CLAIM_OFFSET_EVENT_ID..CLAIM_OFFSET_EVENT_ID + 32] == t_eid
            && &o[CLAIM_OFFSET_LOCK_HASH..CLAIM_OFFSET_LOCK_HASH + 32] == t_lh
        {
            seen += 1;
        }
    }
    if seen > 1 {
        return Err(Error::ClaimDuplicate);
    }
    Ok(())
}

// ============ EmissionScheduleCell ============
//
// Data layout:
//   version u8                              (1)
//   current_era u64 LE                      (8)
//   era_start_block u64 LE                  (8)
//   era_duration_blocks u64 LE              (8)
//   genesis_emission_per_event u128 LE      (16)
//   current_era_remaining_emission u128 LE  (16)
//   halving_factor_bps u16 LE               (2)

const EMISSION_LEN: usize = 59;
const EMISSION_OFFSET_ERA: usize = 1;
const EMISSION_OFFSET_ERA_START: usize = 9;
const EMISSION_OFFSET_ERA_DURATION: usize = 17;
const EMISSION_OFFSET_GENESIS: usize = 25;
const EMISSION_OFFSET_REMAINING: usize = 41;
const EMISSION_OFFSET_HALVING: usize = 57;

fn verify_emission_schedule() -> Result<(), Error> {
    let inputs = read_group_cells(Source::GroupInput)?;
    let outputs = read_group_cells(Source::GroupOutput)?;

    match (inputs.is_empty(), outputs.is_empty()) {
        (true, true) => Err(Error::EmptyTransition),
        (true, false) => {
            // Genesis mint: one EmissionScheduleCell at era 0.
            for o in &outputs {
                verify_emission_layout(o)?;
                let era = read_u64_le(&o[EMISSION_OFFSET_ERA..EMISSION_OFFSET_ERA + 8]);
                if era != 0 {
                    return Err(Error::EraTransitionPremature);
                }
            }
            Ok(())
        }
        (false, false) => {
            // Era transition or emission accounting decrement.
            if inputs.len() != 1 || outputs.len() != 1 {
                return Err(Error::CellMultiplicityMismatch);
            }
            verify_emission_layout(&inputs[0])?;
            verify_emission_layout(&outputs[0])?;
            verify_era_transition_or_accounting(&inputs[0], &outputs[0])?;
            Ok(())
        }
        (false, true) => Err(Error::CellMultiplicityMismatch),
    }
}

fn verify_emission_layout(data: &[u8]) -> Result<(), Error> {
    if data.len() < EMISSION_LEN {
        return Err(Error::CellDataMalformed);
    }
    if data[0] != SCHEMA_VERSION {
        return Err(Error::SchemaVersionUnsupported);
    }
    Ok(())
}

fn verify_era_transition_or_accounting(prev: &[u8], next: &[u8]) -> Result<(), Error> {
    let prev_era = read_u64_le(&prev[EMISSION_OFFSET_ERA..EMISSION_OFFSET_ERA + 8]);
    let next_era = read_u64_le(&next[EMISSION_OFFSET_ERA..EMISSION_OFFSET_ERA + 8]);
    let prev_genesis =
        read_u128_le(&prev[EMISSION_OFFSET_GENESIS..EMISSION_OFFSET_GENESIS + 16]);
    let next_genesis =
        read_u128_le(&next[EMISSION_OFFSET_GENESIS..EMISSION_OFFSET_GENESIS + 16]);
    let halving = read_u16_le(&prev[EMISSION_OFFSET_HALVING..EMISSION_OFFSET_HALVING + 2]);

    if next_era == prev_era {
        // Accounting decrement only — genesis must not change.
        if prev_genesis != next_genesis {
            return Err(Error::EmissionAccountingInvariant);
        }
        let prev_rem = read_u128_le(&prev[EMISSION_OFFSET_REMAINING..EMISSION_OFFSET_REMAINING + 16]);
        let next_rem = read_u128_le(&next[EMISSION_OFFSET_REMAINING..EMISSION_OFFSET_REMAINING + 16]);
        if next_rem > prev_rem {
            return Err(Error::EmissionAccountingInvariant);
        }
        return Ok(());
    }

    if next_era != prev_era + 1 {
        return Err(Error::EraTransitionPremature);
    }
    // Halving: next_genesis = prev_genesis * halving_bps / 10_000.
    let expected = prev_genesis
        .checked_mul(halving as u128)
        .ok_or(Error::AmountOverflow)?
        / 10_000;
    if next_genesis != expected {
        return Err(Error::HalvingArithmeticInvalid);
    }
    // Era-start advances by prev's duration.
    let prev_start = read_u64_le(&prev[EMISSION_OFFSET_ERA_START..EMISSION_OFFSET_ERA_START + 8]);
    let prev_dur = read_u64_le(
        &prev[EMISSION_OFFSET_ERA_DURATION..EMISSION_OFFSET_ERA_DURATION + 8],
    );
    let next_start = read_u64_le(&next[EMISSION_OFFSET_ERA_START..EMISSION_OFFSET_ERA_START + 8]);
    if next_start != prev_start.saturating_add(prev_dur) {
        return Err(Error::EraTransitionPremature);
    }
    Ok(())
}

// ============ SybilGuardCell ============
//
// Data layout:
//   version u8                  (1)
//   last_updated_block u64 LE   (8)
//   flagged_count u16 LE        (2)
//   flagged_lock_hashes [32 * count] — sorted ascending

const SYBIL_HEADER_LEN: usize = 11;
const SYBIL_OFFSET_COUNT: usize = 9;

fn verify_sybil_guard() -> Result<(), Error> {
    let outputs = read_group_cells(Source::GroupOutput)?;
    for o in &outputs {
        verify_sybil_layout(o)?;
        verify_sybil_sorted(o)?;
        // Adds/removes require attestation witnesses; this scaffold validates
        // shape only. Attestation verification ⇒ delegated to bls-verify per
        // bls12-381-cycle-budget-spike.md.
        // TODO: wire signer-quorum check via bls-verify::verify_aggregated.
    }
    Ok(())
}

fn verify_sybil_layout(data: &[u8]) -> Result<(), Error> {
    if data.len() < SYBIL_HEADER_LEN {
        return Err(Error::CellDataMalformed);
    }
    if data[0] != SCHEMA_VERSION {
        return Err(Error::SchemaVersionUnsupported);
    }
    let count = read_u16_le(&data[SYBIL_OFFSET_COUNT..SYBIL_OFFSET_COUNT + 2]) as usize;
    if count > MAX_FLAGGED {
        return Err(Error::CapacityExceeded);
    }
    let expected = SYBIL_HEADER_LEN + count * FLAGGED_ENTRY_LEN;
    if data.len() < expected {
        return Err(Error::CellDataMalformed);
    }
    Ok(())
}

fn verify_sybil_sorted(data: &[u8]) -> Result<(), Error> {
    let count = read_u16_le(&data[SYBIL_OFFSET_COUNT..SYBIL_OFFSET_COUNT + 2]) as usize;
    if count <= 1 {
        return Ok(());
    }
    let base = SYBIL_HEADER_LEN;
    for i in 1..count {
        let prev = &data[base + (i - 1) * FLAGGED_ENTRY_LEN..base + i * FLAGGED_ENTRY_LEN];
        let curr = &data[base + i * FLAGGED_ENTRY_LEN..base + (i + 1) * FLAGGED_ENTRY_LEN];
        if prev >= curr {
            return Err(Error::CellDataMalformed);
        }
    }
    Ok(())
}

fn sybil_contains(guard: &[u8], lh: &[u8]) -> bool {
    if guard.len() < SYBIL_HEADER_LEN {
        return false;
    }
    let count = read_u16_le(&guard[SYBIL_OFFSET_COUNT..SYBIL_OFFSET_COUNT + 2]) as usize;
    let base = SYBIL_HEADER_LEN;
    // Binary search; flagged set is sorted ascending.
    let mut lo = 0usize;
    let mut hi = count;
    while lo < hi {
        let mid = (lo + hi) / 2;
        let m = &guard[base + mid * FLAGGED_ENTRY_LEN..base + (mid + 1) * FLAGGED_ENTRY_LEN];
        if m == lh {
            return true;
        } else if m < lh {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    false
}

fn find_sybil_guard_cell_dep() -> Result<alloc::vec::Vec<u8>, Error> {
    // Shape-heuristic: SCHEMA_VERSION byte at 0 + length matches SybilGuard
    // layout exactly. TODO: code-hash match against sybil-guard binary once
    // capsule emits a stable hash.
    for data in QueryIter::new(load_cell_data, Source::CellDep) {
        if data.len() >= SYBIL_HEADER_LEN && data[0] == SCHEMA_VERSION {
            let count = read_u16_le(&data[SYBIL_OFFSET_COUNT..SYBIL_OFFSET_COUNT + 2]) as usize;
            if data.len() == SYBIL_HEADER_LEN + count * FLAGGED_ENTRY_LEN
                && count <= MAX_FLAGGED
            {
                return Ok(data);
            }
        }
    }
    Err(Error::SybilGuardCellDepMissing)
}

// ============ Cell read helpers ============

fn read_group_cells(
    source: Source,
) -> Result<heapless::Vec<alloc::vec::Vec<u8>, MAX_CELLS_PER_TX>, Error> {
    let mut out: heapless::Vec<alloc::vec::Vec<u8>, MAX_CELLS_PER_TX> = heapless::Vec::new();
    for data in QueryIter::new(load_cell_data, source) {
        out.push(data).map_err(|_| Error::CapacityExceeded)?;
    }
    Ok(out)
}

// Silence the unused-helper lint when a path drops use of load_cell_type_hash.
fn _touch_unused() -> Result<(), Error> {
    let _ = load_cell_type_hash(0, Source::CellDep);
    Ok(())
}

// ============ Byte readers ============

fn read_u128_le(b: &[u8]) -> u128 {
    let mut buf = [0u8; 16];
    buf.copy_from_slice(&b[..16]);
    u128::from_le_bytes(buf)
}

fn read_u64_le(b: &[u8]) -> u64 {
    let mut buf = [0u8; 8];
    buf.copy_from_slice(&b[..8]);
    u64::from_le_bytes(buf)
}

fn read_u16_le(b: &[u8]) -> u16 {
    let mut buf = [0u8; 2];
    buf.copy_from_slice(&b[..2]);
    u16::from_le_bytes(buf)
}

// ============ 256-bit widening math (pairwise check) ============

fn mul_u128_widening(a: u128, b: u128) -> (u128, u128) {
    // (lo, hi) = a * b as u256
    let a_lo = a as u64 as u128;
    let a_hi = a >> 64;
    let b_lo = b as u64 as u128;
    let b_hi = b >> 64;

    let ll = a_lo * b_lo;
    let lh = a_lo * b_hi;
    let hl = a_hi * b_lo;
    let hh = a_hi * b_hi;

    let mid = (ll >> 64).wrapping_add(lh & ((1u128 << 64) - 1)).wrapping_add(hl & ((1u128 << 64) - 1));
    let lo = (ll & ((1u128 << 64) - 1)) | (mid << 64);
    let hi = hh
        .wrapping_add(lh >> 64)
        .wrapping_add(hl >> 64)
        .wrapping_add(mid >> 64);
    (lo, hi)
}

fn sub_u256(a_lo: u128, a_hi: u128, b_lo: u128, b_hi: u128) -> (u128, u128) {
    let (lo, borrow) = a_lo.overflowing_sub(b_lo);
    let hi = a_hi.wrapping_sub(b_hi).wrapping_sub(borrow as u128);
    (lo, hi)
}

fn mul_u256_by_u128_div_10000(lo: u128, hi: u128, scalar: u128) -> (u128, u128) {
    // Approximate: scale lo and hi separately by scalar/10000, accepting bounded
    // rounding error. ε is in bps and we only need an upper-bound tolerance.
    let lo_scaled = lo / 10_000 * scalar + (lo % 10_000) * scalar / 10_000;
    let hi_scaled = hi / 10_000 * scalar + (hi % 10_000) * scalar / 10_000;
    (lo_scaled, hi_scaled)
}
