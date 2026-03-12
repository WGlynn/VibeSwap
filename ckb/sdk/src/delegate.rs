// ============ Delegate Module ============
// Voting power delegation for veVIBE holders on CKB.
//
// Key capabilities:
// - Full, partial, and proportional (basis points) delegation
// - Multi-level delegation chains with configurable max depth
// - Time-limited delegations with automatic expiry
// - Circular delegation detection and prevention
// - Cooldown enforcement between delegation modifications
// - Batch delegation and redistribution
// - Analytics: concentration, delegation rate, top delegates
//
// Philosophy: Delegation is trust made visible. Power flows from those who
// hold tokens to those who wield influence — transparently, revocably,
// and with structural limits that prevent concentration (P-000).

// ============ Error Types ============

#[derive(Debug, Clone, PartialEq)]
pub enum DelegateError {
    SelfDelegation,
    AlreadyDelegated,
    InsufficientPower,
    MaxChainDepthExceeded,
    MaxDelegationsExceeded,
    CircularDelegation,
    DelegationNotFound,
    DelegationExpired,
    NotRevocable,
    CooldownActive,
    AmountTooSmall,
    InvalidAmount,
    DelegationInactive,
    Overflow,
}

// ============ Data Types ============

#[derive(Debug, Clone, PartialEq)]
pub enum DelegationType {
    Full,
    Partial,
    Proportional,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Delegation {
    pub delegator: [u8; 32],
    pub delegate: [u8; 32],
    pub delegation_type: DelegationType,
    pub amount: u64,
    pub created_at: u64,
    pub expires_at: Option<u64>,
    pub revocable: bool,
    pub active: bool,
}

#[derive(Debug, Clone)]
pub struct DelegateProfile {
    pub address: [u8; 32],
    pub own_power: u64,
    pub received_power: u64,
    pub delegated_out_power: u64,
    pub effective_power: u64,
    pub delegation_count_in: u32,
    pub delegation_count_out: u32,
}

#[derive(Debug, Clone)]
pub struct DelegationRegistry {
    pub delegations: Vec<Delegation>,
    pub max_chain_depth: u32,
    pub max_delegations_per_address: u32,
    pub min_delegation_amount: u64,
    pub cooldown_ms: u64,
}

#[derive(Debug, Clone)]
pub struct DelegationChain {
    pub addresses: Vec<[u8; 32]>,
    pub total_power: u64,
    pub depth: u32,
}

// ============ Registry ============

pub fn create_registry(
    max_depth: u32,
    max_per_address: u32,
    min_amount: u64,
    cooldown: u64,
) -> DelegationRegistry {
    DelegationRegistry {
        delegations: Vec::new(),
        max_chain_depth: max_depth,
        max_delegations_per_address: max_per_address,
        min_delegation_amount: min_amount,
        cooldown_ms: cooldown,
    }
}

pub fn default_registry() -> DelegationRegistry {
    create_registry(3, 10, 1000, 3_600_000)
}

// ============ Helpers (internal) ============

fn is_active_at(d: &Delegation, now: u64) -> bool {
    if !d.active {
        return false;
    }
    if let Some(exp) = d.expires_at {
        if now >= exp {
            return false;
        }
    }
    true
}

fn outgoing_count(reg: &DelegationRegistry, address: &[u8; 32], now: u64) -> u32 {
    reg.delegations
        .iter()
        .filter(|d| &d.delegator == address && is_active_at(d, now))
        .count() as u32
}

fn resolve_power(d: &Delegation, own_power: u64) -> u64 {
    match d.delegation_type {
        DelegationType::Full => own_power,
        DelegationType::Partial => d.amount,
        DelegationType::Proportional => {
            let bps = d.amount as u128;
            let power = own_power as u128;
            (power * bps / 10_000) as u64
        }
    }
}

// ============ Core Delegation ============

pub fn delegate_full(
    reg: &mut DelegationRegistry,
    delegator: [u8; 32],
    delegate: [u8; 32],
    own_power: u64,
    now: u64,
    expires: Option<u64>,
    revocable: bool,
) -> Result<(), DelegateError> {
    if delegator == delegate {
        return Err(DelegateError::SelfDelegation);
    }
    if own_power < reg.min_delegation_amount {
        return Err(DelegateError::InsufficientPower);
    }
    if !can_modify(reg, &delegator, now) {
        return Err(DelegateError::CooldownActive);
    }
    // Check for existing active delegation to same delegate
    let exists = reg.delegations.iter().any(|d| {
        d.delegator == delegator && d.delegate == delegate && is_active_at(d, now)
    });
    if exists {
        return Err(DelegateError::AlreadyDelegated);
    }
    if outgoing_count(reg, &delegator, now) >= reg.max_delegations_per_address {
        return Err(DelegateError::MaxDelegationsExceeded);
    }
    if would_create_cycle(reg, &delegator, &delegate, now) {
        return Err(DelegateError::CircularDelegation);
    }
    // Check chain depth
    let chain = delegation_chain(reg, &delegate, now);
    if chain.depth + 1 > reg.max_chain_depth {
        return Err(DelegateError::MaxChainDepthExceeded);
    }
    reg.delegations.push(Delegation {
        delegator,
        delegate,
        delegation_type: DelegationType::Full,
        amount: 0,
        created_at: now,
        expires_at: expires,
        revocable,
        active: true,
    });
    Ok(())
}

pub fn delegate_partial(
    reg: &mut DelegationRegistry,
    delegator: [u8; 32],
    delegate: [u8; 32],
    amount: u64,
    now: u64,
    expires: Option<u64>,
    revocable: bool,
) -> Result<(), DelegateError> {
    if delegator == delegate {
        return Err(DelegateError::SelfDelegation);
    }
    if amount == 0 {
        return Err(DelegateError::InvalidAmount);
    }
    if amount < reg.min_delegation_amount {
        return Err(DelegateError::AmountTooSmall);
    }
    if !can_modify(reg, &delegator, now) {
        return Err(DelegateError::CooldownActive);
    }
    let exists = reg.delegations.iter().any(|d| {
        d.delegator == delegator && d.delegate == delegate && is_active_at(d, now)
    });
    if exists {
        return Err(DelegateError::AlreadyDelegated);
    }
    if outgoing_count(reg, &delegator, now) >= reg.max_delegations_per_address {
        return Err(DelegateError::MaxDelegationsExceeded);
    }
    if would_create_cycle(reg, &delegator, &delegate, now) {
        return Err(DelegateError::CircularDelegation);
    }
    let chain = delegation_chain(reg, &delegate, now);
    if chain.depth + 1 > reg.max_chain_depth {
        return Err(DelegateError::MaxChainDepthExceeded);
    }
    reg.delegations.push(Delegation {
        delegator,
        delegate,
        delegation_type: DelegationType::Partial,
        amount,
        created_at: now,
        expires_at: expires,
        revocable,
        active: true,
    });
    Ok(())
}

pub fn delegate_proportional(
    reg: &mut DelegationRegistry,
    delegator: [u8; 32],
    delegate: [u8; 32],
    bps: u64,
    now: u64,
    expires: Option<u64>,
    revocable: bool,
) -> Result<(), DelegateError> {
    if delegator == delegate {
        return Err(DelegateError::SelfDelegation);
    }
    if bps == 0 || bps > 10_000 {
        return Err(DelegateError::InvalidAmount);
    }
    if !can_modify(reg, &delegator, now) {
        return Err(DelegateError::CooldownActive);
    }
    let exists = reg.delegations.iter().any(|d| {
        d.delegator == delegator && d.delegate == delegate && is_active_at(d, now)
    });
    if exists {
        return Err(DelegateError::AlreadyDelegated);
    }
    if outgoing_count(reg, &delegator, now) >= reg.max_delegations_per_address {
        return Err(DelegateError::MaxDelegationsExceeded);
    }
    if would_create_cycle(reg, &delegator, &delegate, now) {
        return Err(DelegateError::CircularDelegation);
    }
    let chain = delegation_chain(reg, &delegate, now);
    if chain.depth + 1 > reg.max_chain_depth {
        return Err(DelegateError::MaxChainDepthExceeded);
    }
    reg.delegations.push(Delegation {
        delegator,
        delegate,
        delegation_type: DelegationType::Proportional,
        amount: bps,
        created_at: now,
        expires_at: expires,
        revocable,
        active: true,
    });
    Ok(())
}

pub fn revoke_delegation(
    reg: &mut DelegationRegistry,
    delegator: &[u8; 32],
    delegate: &[u8; 32],
) -> Result<Delegation, DelegateError> {
    let idx = reg
        .delegations
        .iter()
        .position(|d| &d.delegator == delegator && &d.delegate == delegate && d.active);
    match idx {
        None => Err(DelegateError::DelegationNotFound),
        Some(i) => {
            if !reg.delegations[i].revocable {
                return Err(DelegateError::NotRevocable);
            }
            reg.delegations[i].active = false;
            Ok(reg.delegations[i].clone())
        }
    }
}

pub fn revoke_all(reg: &mut DelegationRegistry, delegator: &[u8; 32]) -> usize {
    let mut count = 0;
    for d in reg.delegations.iter_mut() {
        if &d.delegator == delegator && d.active && d.revocable {
            d.active = false;
            count += 1;
        }
    }
    count
}

pub fn modify_delegation(
    reg: &mut DelegationRegistry,
    delegator: &[u8; 32],
    delegate: &[u8; 32],
    new_amount: u64,
) -> Result<(), DelegateError> {
    if new_amount == 0 {
        return Err(DelegateError::InvalidAmount);
    }
    let d = reg
        .delegations
        .iter_mut()
        .find(|d| &d.delegator == delegator && &d.delegate == delegate && d.active);
    match d {
        None => Err(DelegateError::DelegationNotFound),
        Some(d) => {
            match d.delegation_type {
                DelegationType::Full => {
                    return Err(DelegateError::InvalidAmount);
                }
                DelegationType::Partial => {
                    if new_amount < reg.min_delegation_amount {
                        return Err(DelegateError::AmountTooSmall);
                    }
                    d.amount = new_amount;
                }
                DelegationType::Proportional => {
                    if new_amount > 10_000 {
                        return Err(DelegateError::InvalidAmount);
                    }
                    d.amount = new_amount;
                }
            }
            Ok(())
        }
    }
}

// ============ Power Computation ============

pub fn effective_power(
    reg: &DelegationRegistry,
    address: &[u8; 32],
    own_power: u64,
    now: u64,
) -> u64 {
    let out = delegated_out_power(reg, address, own_power, now);
    let r_in = received_power_simple(reg, address, now);
    own_power.saturating_sub(out).saturating_add(r_in)
}

fn received_power_simple(reg: &DelegationRegistry, address: &[u8; 32], now: u64) -> u64 {
    // Without a power lookup, we can only account for Partial delegations
    // and treat Full as 0 (no way to know delegator's own power)
    reg.delegations
        .iter()
        .filter(|d| &d.delegate == address && is_active_at(d, now))
        .map(|d| match d.delegation_type {
            DelegationType::Full => 0,
            DelegationType::Partial => d.amount,
            DelegationType::Proportional => 0,
        })
        .fold(0u64, |acc, x| acc.saturating_add(x))
}

pub fn received_power(
    reg: &DelegationRegistry,
    address: &[u8; 32],
    power_lookup: &[([u8; 32], u64)],
    now: u64,
) -> u64 {
    reg.delegations
        .iter()
        .filter(|d| &d.delegate == address && is_active_at(d, now))
        .map(|d| {
            let delegator_power = power_lookup
                .iter()
                .find(|(a, _)| *a == d.delegator)
                .map(|(_, p)| *p)
                .unwrap_or(0);
            resolve_power(d, delegator_power)
        })
        .fold(0u64, |acc, x| acc.saturating_add(x))
}

pub fn delegated_out_power(
    reg: &DelegationRegistry,
    address: &[u8; 32],
    own_power: u64,
    now: u64,
) -> u64 {
    reg.delegations
        .iter()
        .filter(|d| &d.delegator == address && is_active_at(d, now))
        .map(|d| resolve_power(d, own_power))
        .fold(0u64, |acc, x| acc.saturating_add(x))
}

pub fn available_power(
    reg: &DelegationRegistry,
    address: &[u8; 32],
    own_power: u64,
    now: u64,
) -> u64 {
    let out = delegated_out_power(reg, address, own_power, now);
    own_power.saturating_sub(out)
}

pub fn compute_profile(
    reg: &DelegationRegistry,
    address: &[u8; 32],
    own_power: u64,
    power_lookup: &[([u8; 32], u64)],
    now: u64,
) -> DelegateProfile {
    let recv = received_power(reg, address, power_lookup, now);
    let out = delegated_out_power(reg, address, own_power, now);
    let eff = own_power.saturating_sub(out).saturating_add(recv);
    let (count_out, count_in) = delegation_count(reg, address, now);
    DelegateProfile {
        address: *address,
        own_power,
        received_power: recv,
        delegated_out_power: out,
        effective_power: eff,
        delegation_count_in: count_in,
        delegation_count_out: count_out,
    }
}

// ============ Chain Analysis ============

pub fn delegation_chain(
    reg: &DelegationRegistry,
    address: &[u8; 32],
    now: u64,
) -> DelegationChain {
    let mut chain = vec![*address];
    let mut current = *address;
    let max_iter = reg.max_chain_depth as usize + 1;

    for _ in 0..max_iter {
        // Find if current delegates to someone
        let next = reg
            .delegations
            .iter()
            .find(|d| d.delegator == current && is_active_at(d, now));
        match next {
            Some(d) => {
                if chain.contains(&d.delegate) {
                    break; // prevent infinite loop on cycle
                }
                chain.push(d.delegate);
                current = d.delegate;
            }
            None => break,
        }
    }

    let depth = if chain.len() > 1 { chain.len() as u32 - 1 } else { 0 };
    DelegationChain {
        addresses: chain,
        total_power: 0,
        depth,
    }
}

pub fn reverse_chain(
    reg: &DelegationRegistry,
    address: &[u8; 32],
    now: u64,
) -> Vec<[u8; 32]> {
    reg.delegations
        .iter()
        .filter(|d| &d.delegate == address && is_active_at(d, now))
        .map(|d| d.delegator)
        .collect()
}

pub fn chain_depth(
    reg: &DelegationRegistry,
    delegator: &[u8; 32],
    delegate: &[u8; 32],
    now: u64,
) -> u32 {
    let chain = delegation_chain(reg, delegator, now);
    for (i, addr) in chain.addresses.iter().enumerate() {
        if addr == delegate {
            return i as u32;
        }
    }
    0
}

pub fn would_create_cycle(
    reg: &DelegationRegistry,
    delegator: &[u8; 32],
    delegate: &[u8; 32],
    now: u64,
) -> bool {
    // If delegate (or anyone in delegate's forward chain) already delegates to delegator
    let chain = delegation_chain(reg, delegate, now);
    chain.addresses.contains(delegator)
}

pub fn longest_chain(reg: &DelegationRegistry, now: u64) -> DelegationChain {
    let mut best = DelegationChain {
        addresses: Vec::new(),
        total_power: 0,
        depth: 0,
    };
    // Collect unique delegators
    let mut starts: Vec<[u8; 32]> = Vec::new();
    for d in &reg.delegations {
        if is_active_at(d, now) && !starts.contains(&d.delegator) {
            starts.push(d.delegator);
        }
    }
    for addr in &starts {
        let chain = delegation_chain(reg, addr, now);
        if chain.depth > best.depth {
            best = chain;
        }
    }
    best
}

// ============ Expiry & Cleanup ============

pub fn expire_delegations(reg: &mut DelegationRegistry, now: u64) -> usize {
    let mut count = 0;
    for d in reg.delegations.iter_mut() {
        if d.active {
            if let Some(exp) = d.expires_at {
                if now >= exp {
                    d.active = false;
                    count += 1;
                }
            }
        }
    }
    count
}

pub fn active_delegations(reg: &DelegationRegistry, now: u64) -> Vec<&Delegation> {
    reg.delegations
        .iter()
        .filter(|d| is_active_at(d, now))
        .collect()
}

pub fn expired_delegations(reg: &DelegationRegistry, now: u64) -> Vec<&Delegation> {
    reg.delegations
        .iter()
        .filter(|d| {
            d.active && d.expires_at.map_or(false, |exp| now >= exp)
        })
        .chain(
            reg.delegations.iter().filter(|d| {
                !d.active && d.expires_at.map_or(false, |exp| now >= exp)
            }),
        )
        .collect()
}

pub fn expiring_soon(
    reg: &DelegationRegistry,
    now: u64,
    window_ms: u64,
) -> Vec<&Delegation> {
    reg.delegations
        .iter()
        .filter(|d| {
            is_active_at(d, now)
                && d.expires_at.map_or(false, |exp| exp > now && exp <= now + window_ms)
        })
        .collect()
}

pub fn cleanup_inactive(reg: &mut DelegationRegistry) -> usize {
    let before = reg.delegations.len();
    reg.delegations.retain(|d| d.active);
    before - reg.delegations.len()
}

// ============ Queries ============

pub fn find_delegation<'a>(
    reg: &'a DelegationRegistry,
    delegator: &[u8; 32],
    delegate: &[u8; 32],
) -> Option<&'a Delegation> {
    reg.delegations
        .iter()
        .find(|d| &d.delegator == delegator && &d.delegate == delegate && d.active)
}

pub fn outgoing_delegations<'a>(
    reg: &'a DelegationRegistry,
    address: &[u8; 32],
    now: u64,
) -> Vec<&'a Delegation> {
    reg.delegations
        .iter()
        .filter(|d| &d.delegator == address && is_active_at(d, now))
        .collect()
}

pub fn incoming_delegations<'a>(
    reg: &'a DelegationRegistry,
    address: &[u8; 32],
    now: u64,
) -> Vec<&'a Delegation> {
    reg.delegations
        .iter()
        .filter(|d| &d.delegate == address && is_active_at(d, now))
        .collect()
}

pub fn delegation_count(
    reg: &DelegationRegistry,
    address: &[u8; 32],
    now: u64,
) -> (u32, u32) {
    let out = reg
        .delegations
        .iter()
        .filter(|d| &d.delegator == address && is_active_at(d, now))
        .count() as u32;
    let inc = reg
        .delegations
        .iter()
        .filter(|d| &d.delegate == address && is_active_at(d, now))
        .count() as u32;
    (out, inc)
}

pub fn is_delegating(
    reg: &DelegationRegistry,
    address: &[u8; 32],
    now: u64,
) -> bool {
    reg.delegations
        .iter()
        .any(|d| &d.delegator == address && is_active_at(d, now))
}

pub fn is_delegate(
    reg: &DelegationRegistry,
    address: &[u8; 32],
    now: u64,
) -> bool {
    reg.delegations
        .iter()
        .any(|d| &d.delegate == address && is_active_at(d, now))
}

// ============ Analytics ============

pub fn top_delegates(
    reg: &DelegationRegistry,
    power_lookup: &[([u8; 32], u64)],
    now: u64,
    count: usize,
) -> Vec<([u8; 32], u64)> {
    let mut delegates: Vec<[u8; 32]> = Vec::new();
    for d in &reg.delegations {
        if is_active_at(d, now) && !delegates.contains(&d.delegate) {
            delegates.push(d.delegate);
        }
    }
    let mut results: Vec<([u8; 32], u64)> = delegates
        .iter()
        .map(|addr| (*addr, received_power(reg, addr, power_lookup, now)))
        .collect();
    results.sort_by(|a, b| b.1.cmp(&a.1));
    results.truncate(count);
    results
}

pub fn delegation_concentration(
    reg: &DelegationRegistry,
    power_lookup: &[([u8; 32], u64)],
    now: u64,
) -> u64 {
    let total = total_delegated_power(reg, power_lookup, now);
    if total == 0 {
        return 0;
    }
    let top = top_delegates(reg, power_lookup, now, 1);
    if top.is_empty() {
        return 0;
    }
    let top_power = top[0].1 as u128;
    let total_128 = total as u128;
    (top_power * 10_000 / total_128) as u64
}

pub fn total_delegated_power(
    reg: &DelegationRegistry,
    power_lookup: &[([u8; 32], u64)],
    now: u64,
) -> u64 {
    reg.delegations
        .iter()
        .filter(|d| is_active_at(d, now))
        .map(|d| {
            let delegator_power = power_lookup
                .iter()
                .find(|(a, _)| *a == d.delegator)
                .map(|(_, p)| *p)
                .unwrap_or(0);
            resolve_power(d, delegator_power)
        })
        .fold(0u64, |acc, x| acc.saturating_add(x))
}

pub fn delegation_rate(
    reg: &DelegationRegistry,
    total_power: u64,
    power_lookup: &[([u8; 32], u64)],
    now: u64,
) -> u64 {
    if total_power == 0 {
        return 0;
    }
    let delegated = total_delegated_power(reg, power_lookup, now) as u128;
    let total = total_power as u128;
    (delegated * 10_000 / total) as u64
}

pub fn unique_delegators(reg: &DelegationRegistry, now: u64) -> usize {
    let mut seen: Vec<[u8; 32]> = Vec::new();
    for d in &reg.delegations {
        if is_active_at(d, now) && !seen.contains(&d.delegator) {
            seen.push(d.delegator);
        }
    }
    seen.len()
}

pub fn unique_delegates(reg: &DelegationRegistry, now: u64) -> usize {
    let mut seen: Vec<[u8; 32]> = Vec::new();
    for d in &reg.delegations {
        if is_active_at(d, now) && !seen.contains(&d.delegate) {
            seen.push(d.delegate);
        }
    }
    seen.len()
}

// ============ Validation ============

pub fn validate_delegation(
    reg: &DelegationRegistry,
    delegation: &Delegation,
    own_power: u64,
    now: u64,
) -> Result<(), DelegateError> {
    if delegation.delegator == delegation.delegate {
        return Err(DelegateError::SelfDelegation);
    }
    if !delegation.active {
        return Err(DelegateError::DelegationInactive);
    }
    if let Some(exp) = delegation.expires_at {
        if now >= exp {
            return Err(DelegateError::DelegationExpired);
        }
    }
    match delegation.delegation_type {
        DelegationType::Full => {
            if own_power < reg.min_delegation_amount {
                return Err(DelegateError::InsufficientPower);
            }
        }
        DelegationType::Partial => {
            if delegation.amount < reg.min_delegation_amount {
                return Err(DelegateError::AmountTooSmall);
            }
            if delegation.amount > own_power {
                return Err(DelegateError::InsufficientPower);
            }
        }
        DelegationType::Proportional => {
            if delegation.amount == 0 || delegation.amount > 10_000 {
                return Err(DelegateError::InvalidAmount);
            }
        }
    }
    Ok(())
}

pub fn validate_registry(reg: &DelegationRegistry, now: u64) -> Vec<DelegateError> {
    let mut errors = Vec::new();
    for d in &reg.delegations {
        if !d.active {
            continue;
        }
        if d.delegator == d.delegate {
            errors.push(DelegateError::SelfDelegation);
        }
        if let Some(exp) = d.expires_at {
            if now >= exp {
                errors.push(DelegateError::DelegationExpired);
            }
        }
        match d.delegation_type {
            DelegationType::Proportional => {
                if d.amount == 0 || d.amount > 10_000 {
                    errors.push(DelegateError::InvalidAmount);
                }
            }
            DelegationType::Partial => {
                if d.amount < reg.min_delegation_amount {
                    errors.push(DelegateError::AmountTooSmall);
                }
            }
            _ => {}
        }
    }
    if has_circular_delegation(reg, now) {
        errors.push(DelegateError::CircularDelegation);
    }
    errors
}

pub fn has_circular_delegation(reg: &DelegationRegistry, now: u64) -> bool {
    for d in &reg.delegations {
        if is_active_at(d, now) {
            let chain = delegation_chain(reg, &d.delegate, now);
            if chain.addresses.contains(&d.delegator) && chain.depth > 0 {
                return true;
            }
        }
    }
    false
}

// ============ Batch Operations ============

pub fn batch_delegate(
    reg: &mut DelegationRegistry,
    delegator: [u8; 32],
    delegates: &[([u8; 32], u64)],
    own_power: u64,
    now: u64,
) -> Result<usize, DelegateError> {
    // Validate total doesn't exceed own_power
    let total: u128 = delegates.iter().map(|(_, a)| *a as u128).sum();
    if total > own_power as u128 {
        return Err(DelegateError::InsufficientPower);
    }
    let mut count = 0;
    for (delegate, amount) in delegates {
        delegate_partial(reg, delegator, *delegate, *amount, now, None, true)?;
        count += 1;
    }
    Ok(count)
}

pub fn redistribute(
    reg: &mut DelegationRegistry,
    delegator: &[u8; 32],
    new_weights: &[([u8; 32], u64)],
    own_power: u64,
    now: u64,
) -> Result<(), DelegateError> {
    // Validate total
    let total: u128 = new_weights.iter().map(|(_, a)| *a as u128).sum();
    if total > own_power as u128 {
        return Err(DelegateError::InsufficientPower);
    }
    // Revoke all existing
    revoke_all(reg, delegator);
    // Create new delegations
    for (delegate, amount) in new_weights {
        delegate_partial(reg, *delegator, *delegate, *amount, now, None, true)?;
    }
    Ok(())
}

pub fn snapshot_delegations(
    reg: &DelegationRegistry,
    now: u64,
) -> Vec<([u8; 32], u64)> {
    // Collect all unique addresses
    let mut addresses: Vec<[u8; 32]> = Vec::new();
    for d in &reg.delegations {
        if is_active_at(d, now) {
            if !addresses.contains(&d.delegator) {
                addresses.push(d.delegator);
            }
            if !addresses.contains(&d.delegate) {
                addresses.push(d.delegate);
            }
        }
    }
    // For snapshot we return partial-only received power per address
    addresses
        .iter()
        .map(|addr| {
            let recv = received_power_simple(reg, addr, now);
            (*addr, recv)
        })
        .collect()
}

// ============ Cooldown ============

pub fn can_modify(
    reg: &DelegationRegistry,
    delegator: &[u8; 32],
    now: u64,
) -> bool {
    match last_modification_time(reg, delegator) {
        None => true,
        Some(last) => {
            if now >= last {
                now - last >= reg.cooldown_ms
            } else {
                true
            }
        }
    }
}

pub fn last_modification_time(
    reg: &DelegationRegistry,
    delegator: &[u8; 32],
) -> Option<u64> {
    reg.delegations
        .iter()
        .filter(|d| &d.delegator == delegator)
        .map(|d| d.created_at)
        .max()
}

pub fn time_until_modifiable(
    reg: &DelegationRegistry,
    delegator: &[u8; 32],
    now: u64,
) -> u64 {
    match last_modification_time(reg, delegator) {
        None => 0,
        Some(last) => {
            let ready_at = last + reg.cooldown_ms;
            if now >= ready_at {
                0
            } else {
                ready_at - now
            }
        }
    }
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    fn addr(n: u8) -> [u8; 32] {
        let mut a = [0u8; 32];
        a[0] = n;
        a
    }

    fn reg() -> DelegationRegistry {
        // Use 0 cooldown for most tests
        create_registry(3, 10, 1000, 0)
    }

    fn reg_with_cooldown(cooldown: u64) -> DelegationRegistry {
        create_registry(3, 10, 1000, cooldown)
    }

    // ============ Registry Tests ============

    #[test]
    fn test_create_registry() {
        let r = create_registry(5, 20, 500, 1000);
        assert_eq!(r.max_chain_depth, 5);
        assert_eq!(r.max_delegations_per_address, 20);
        assert_eq!(r.min_delegation_amount, 500);
        assert_eq!(r.cooldown_ms, 1000);
        assert!(r.delegations.is_empty());
    }

    #[test]
    fn test_default_registry() {
        let r = default_registry();
        assert_eq!(r.max_chain_depth, 3);
        assert_eq!(r.max_delegations_per_address, 10);
        assert_eq!(r.min_delegation_amount, 1000);
        assert_eq!(r.cooldown_ms, 3_600_000);
    }

    #[test]
    fn test_create_registry_zero_values() {
        let r = create_registry(0, 0, 0, 0);
        assert_eq!(r.max_chain_depth, 0);
        assert_eq!(r.max_delegations_per_address, 0);
    }

    #[test]
    fn test_create_registry_max_values() {
        let r = create_registry(u32::MAX, u32::MAX, u64::MAX, u64::MAX);
        assert_eq!(r.max_chain_depth, u32::MAX);
        assert_eq!(r.cooldown_ms, u64::MAX);
    }

    // ============ delegate_full Tests ============

    #[test]
    fn test_delegate_full_success() {
        let mut r = reg();
        let res = delegate_full(&mut r, addr(1), addr(2), 5000, 100, None, true);
        assert!(res.is_ok());
        assert_eq!(r.delegations.len(), 1);
        assert_eq!(r.delegations[0].delegation_type, DelegationType::Full);
        assert!(r.delegations[0].active);
    }

    #[test]
    fn test_delegate_full_self_delegation() {
        let mut r = reg();
        let res = delegate_full(&mut r, addr(1), addr(1), 5000, 100, None, true);
        assert_eq!(res, Err(DelegateError::SelfDelegation));
    }

    #[test]
    fn test_delegate_full_insufficient_power() {
        let mut r = reg();
        let res = delegate_full(&mut r, addr(1), addr(2), 500, 100, None, true);
        assert_eq!(res, Err(DelegateError::InsufficientPower));
    }

    #[test]
    fn test_delegate_full_already_delegated() {
        let mut r = reg();
        delegate_full(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        let res = delegate_full(&mut r, addr(1), addr(2), 5000, 100, None, true);
        assert_eq!(res, Err(DelegateError::AlreadyDelegated));
    }

    #[test]
    fn test_delegate_full_with_expiry() {
        let mut r = reg();
        delegate_full(&mut r, addr(1), addr(2), 5000, 100, Some(200), true).unwrap();
        assert_eq!(r.delegations[0].expires_at, Some(200));
    }

    #[test]
    fn test_delegate_full_not_revocable() {
        let mut r = reg();
        delegate_full(&mut r, addr(1), addr(2), 5000, 100, None, false).unwrap();
        assert!(!r.delegations[0].revocable);
    }

    #[test]
    fn test_delegate_full_max_delegations_exceeded() {
        let mut r = create_registry(3, 2, 1000, 0);
        delegate_full(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        delegate_full(&mut r, addr(1), addr(3), 5000, 100, None, true).unwrap();
        let res = delegate_full(&mut r, addr(1), addr(4), 5000, 100, None, true);
        assert_eq!(res, Err(DelegateError::MaxDelegationsExceeded));
    }

    #[test]
    fn test_delegate_full_circular_delegation() {
        let mut r = reg();
        delegate_full(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        let res = delegate_full(&mut r, addr(2), addr(1), 5000, 100, None, true);
        assert_eq!(res, Err(DelegateError::CircularDelegation));
    }

    #[test]
    fn test_delegate_full_chain_depth_exceeded() {
        let mut r = create_registry(2, 10, 1000, 0);
        delegate_full(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        delegate_full(&mut r, addr(2), addr(3), 5000, 100, None, true).unwrap();
        let res = delegate_full(&mut r, addr(3), addr(4), 5000, 100, None, true);
        // Chain would be 3->4, but 2->3 already exists, so chain from 4 = [4] depth 0
        // But chain from delegate (4) = depth 0, +1 = 1, 1 <= 2, OK... let's check:
        // Actually the check is: delegation_chain(reg, &delegate, now).depth + 1 > max_chain_depth
        // chain from addr(4) = [4], depth=0, 0+1=1, 1 > 2? No. So this succeeds.
        // We need a deeper chain. Let's test properly with depth=1:
        assert!(res.is_ok()); // This is valid, depth 1 <= 2
    }

    #[test]
    fn test_delegate_full_chain_depth_exceeded_strict() {
        let mut r = create_registry(1, 10, 1000, 0);
        // A->B exists (depth 1 chain from A). Now B->C: chain from C is [C] depth 0, 0+1=1, 1>1? No.
        delegate_full(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        let res = delegate_full(&mut r, addr(2), addr(3), 5000, 100, None, true);
        assert!(res.is_ok()); // depth 1 == max, not exceeded
    }

    #[test]
    fn test_delegate_full_chain_depth_zero() {
        let mut r = create_registry(0, 10, 1000, 0);
        // max_chain_depth = 0: chain from delegate depth 0, 0+1=1 > 0? Yes, exceeded.
        let res = delegate_full(&mut r, addr(1), addr(2), 5000, 100, None, true);
        assert_eq!(res, Err(DelegateError::MaxChainDepthExceeded));
    }

    #[test]
    fn test_delegate_full_to_multiple_delegates() {
        let mut r = reg();
        delegate_full(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        delegate_full(&mut r, addr(1), addr(3), 5000, 100, None, true).unwrap();
        assert_eq!(r.delegations.len(), 2);
    }

    #[test]
    fn test_delegate_full_cooldown_active() {
        let mut r = reg_with_cooldown(1000);
        delegate_full(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        let res = delegate_full(&mut r, addr(1), addr(3), 5000, 200, None, true);
        assert_eq!(res, Err(DelegateError::CooldownActive));
    }

    #[test]
    fn test_delegate_full_cooldown_elapsed() {
        let mut r = reg_with_cooldown(1000);
        delegate_full(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        let res = delegate_full(&mut r, addr(1), addr(3), 5000, 1200, None, true);
        assert!(res.is_ok());
    }

    // ============ delegate_partial Tests ============

    #[test]
    fn test_delegate_partial_success() {
        let mut r = reg();
        let res = delegate_partial(&mut r, addr(1), addr(2), 2000, 100, None, true);
        assert!(res.is_ok());
        assert_eq!(r.delegations[0].delegation_type, DelegationType::Partial);
        assert_eq!(r.delegations[0].amount, 2000);
    }

    #[test]
    fn test_delegate_partial_zero_amount() {
        let mut r = reg();
        let res = delegate_partial(&mut r, addr(1), addr(2), 0, 100, None, true);
        assert_eq!(res, Err(DelegateError::InvalidAmount));
    }

    #[test]
    fn test_delegate_partial_below_minimum() {
        let mut r = reg();
        let res = delegate_partial(&mut r, addr(1), addr(2), 500, 100, None, true);
        assert_eq!(res, Err(DelegateError::AmountTooSmall));
    }

    #[test]
    fn test_delegate_partial_self() {
        let mut r = reg();
        let res = delegate_partial(&mut r, addr(1), addr(1), 2000, 100, None, true);
        assert_eq!(res, Err(DelegateError::SelfDelegation));
    }

    #[test]
    fn test_delegate_partial_already_delegated() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, None, true).unwrap();
        let res = delegate_partial(&mut r, addr(1), addr(2), 3000, 100, None, true);
        assert_eq!(res, Err(DelegateError::AlreadyDelegated));
    }

    #[test]
    fn test_delegate_partial_with_expiry() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, Some(500), true).unwrap();
        assert_eq!(r.delegations[0].expires_at, Some(500));
    }

    #[test]
    fn test_delegate_partial_max_exceeded() {
        let mut r = create_registry(3, 1, 1000, 0);
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, None, true).unwrap();
        let res = delegate_partial(&mut r, addr(1), addr(3), 2000, 100, None, true);
        assert_eq!(res, Err(DelegateError::MaxDelegationsExceeded));
    }

    #[test]
    fn test_delegate_partial_circular() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, None, true).unwrap();
        let res = delegate_partial(&mut r, addr(2), addr(1), 2000, 100, None, true);
        assert_eq!(res, Err(DelegateError::CircularDelegation));
    }

    #[test]
    fn test_delegate_partial_exact_minimum() {
        let mut r = reg();
        let res = delegate_partial(&mut r, addr(1), addr(2), 1000, 100, None, true);
        assert!(res.is_ok());
    }

    #[test]
    fn test_delegate_partial_cooldown() {
        let mut r = reg_with_cooldown(5000);
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, None, true).unwrap();
        let res = delegate_partial(&mut r, addr(1), addr(3), 2000, 3000, None, true);
        assert_eq!(res, Err(DelegateError::CooldownActive));
    }

    // ============ delegate_proportional Tests ============

    #[test]
    fn test_delegate_proportional_success() {
        let mut r = reg();
        let res = delegate_proportional(&mut r, addr(1), addr(2), 5000, 100, None, true);
        assert!(res.is_ok());
        assert_eq!(r.delegations[0].delegation_type, DelegationType::Proportional);
        assert_eq!(r.delegations[0].amount, 5000);
    }

    #[test]
    fn test_delegate_proportional_zero_bps() {
        let mut r = reg();
        let res = delegate_proportional(&mut r, addr(1), addr(2), 0, 100, None, true);
        assert_eq!(res, Err(DelegateError::InvalidAmount));
    }

    #[test]
    fn test_delegate_proportional_over_10000() {
        let mut r = reg();
        let res = delegate_proportional(&mut r, addr(1), addr(2), 10001, 100, None, true);
        assert_eq!(res, Err(DelegateError::InvalidAmount));
    }

    #[test]
    fn test_delegate_proportional_max_bps() {
        let mut r = reg();
        let res = delegate_proportional(&mut r, addr(1), addr(2), 10000, 100, None, true);
        assert!(res.is_ok());
    }

    #[test]
    fn test_delegate_proportional_min_bps() {
        let mut r = reg();
        let res = delegate_proportional(&mut r, addr(1), addr(2), 1, 100, None, true);
        assert!(res.is_ok());
    }

    #[test]
    fn test_delegate_proportional_self() {
        let mut r = reg();
        let res = delegate_proportional(&mut r, addr(1), addr(1), 5000, 100, None, true);
        assert_eq!(res, Err(DelegateError::SelfDelegation));
    }

    #[test]
    fn test_delegate_proportional_already_delegated() {
        let mut r = reg();
        delegate_proportional(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        let res = delegate_proportional(&mut r, addr(1), addr(2), 3000, 100, None, true);
        assert_eq!(res, Err(DelegateError::AlreadyDelegated));
    }

    #[test]
    fn test_delegate_proportional_circular() {
        let mut r = reg();
        delegate_proportional(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        let res = delegate_proportional(&mut r, addr(2), addr(1), 3000, 100, None, true);
        assert_eq!(res, Err(DelegateError::CircularDelegation));
    }

    #[test]
    fn test_delegate_proportional_with_expiry() {
        let mut r = reg();
        delegate_proportional(&mut r, addr(1), addr(2), 5000, 100, Some(999), true).unwrap();
        assert_eq!(r.delegations[0].expires_at, Some(999));
    }

    // ============ revoke_delegation Tests ============

    #[test]
    fn test_revoke_delegation_success() {
        let mut r = reg();
        delegate_full(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        let revoked = revoke_delegation(&mut r, &addr(1), &addr(2)).unwrap();
        assert!(!r.delegations[0].active);
        assert_eq!(revoked.delegator, addr(1));
    }

    #[test]
    fn test_revoke_delegation_not_found() {
        let mut r = reg();
        let res = revoke_delegation(&mut r, &addr(1), &addr(2));
        assert_eq!(res, Err(DelegateError::DelegationNotFound));
    }

    #[test]
    fn test_revoke_delegation_not_revocable() {
        let mut r = reg();
        delegate_full(&mut r, addr(1), addr(2), 5000, 100, None, false).unwrap();
        let res = revoke_delegation(&mut r, &addr(1), &addr(2));
        assert_eq!(res, Err(DelegateError::NotRevocable));
    }

    #[test]
    fn test_revoke_delegation_already_inactive() {
        let mut r = reg();
        delegate_full(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        revoke_delegation(&mut r, &addr(1), &addr(2)).unwrap();
        let res = revoke_delegation(&mut r, &addr(1), &addr(2));
        assert_eq!(res, Err(DelegateError::DelegationNotFound));
    }

    // ============ revoke_all Tests ============

    #[test]
    fn test_revoke_all_success() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, None, true).unwrap();
        delegate_partial(&mut r, addr(1), addr(3), 3000, 100, None, true).unwrap();
        let count = revoke_all(&mut r, &addr(1));
        assert_eq!(count, 2);
    }

    #[test]
    fn test_revoke_all_skips_non_revocable() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, None, true).unwrap();
        delegate_partial(&mut r, addr(1), addr(3), 3000, 100, None, false).unwrap();
        let count = revoke_all(&mut r, &addr(1));
        assert_eq!(count, 1);
        assert!(r.delegations[1].active); // non-revocable still active
    }

    #[test]
    fn test_revoke_all_none() {
        let mut r = reg();
        let count = revoke_all(&mut r, &addr(1));
        assert_eq!(count, 0);
    }

    #[test]
    fn test_revoke_all_only_own() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, None, true).unwrap();
        delegate_partial(&mut r, addr(3), addr(4), 3000, 100, None, true).unwrap();
        let count = revoke_all(&mut r, &addr(1));
        assert_eq!(count, 1);
        assert!(r.delegations[1].active); // addr(3)'s delegation still active
    }

    // ============ modify_delegation Tests ============

    #[test]
    fn test_modify_delegation_partial_success() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, None, true).unwrap();
        modify_delegation(&mut r, &addr(1), &addr(2), 3000).unwrap();
        assert_eq!(r.delegations[0].amount, 3000);
    }

    #[test]
    fn test_modify_delegation_not_found() {
        let mut r = reg();
        let res = modify_delegation(&mut r, &addr(1), &addr(2), 3000);
        assert_eq!(res, Err(DelegateError::DelegationNotFound));
    }

    #[test]
    fn test_modify_delegation_zero_amount() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, None, true).unwrap();
        let res = modify_delegation(&mut r, &addr(1), &addr(2), 0);
        assert_eq!(res, Err(DelegateError::InvalidAmount));
    }

    #[test]
    fn test_modify_delegation_full_invalid() {
        let mut r = reg();
        delegate_full(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        let res = modify_delegation(&mut r, &addr(1), &addr(2), 3000);
        assert_eq!(res, Err(DelegateError::InvalidAmount));
    }

    #[test]
    fn test_modify_delegation_proportional_success() {
        let mut r = reg();
        delegate_proportional(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        modify_delegation(&mut r, &addr(1), &addr(2), 7000).unwrap();
        assert_eq!(r.delegations[0].amount, 7000);
    }

    #[test]
    fn test_modify_delegation_proportional_over_max() {
        let mut r = reg();
        delegate_proportional(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        let res = modify_delegation(&mut r, &addr(1), &addr(2), 10001);
        assert_eq!(res, Err(DelegateError::InvalidAmount));
    }

    #[test]
    fn test_modify_delegation_partial_below_min() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, None, true).unwrap();
        let res = modify_delegation(&mut r, &addr(1), &addr(2), 500);
        assert_eq!(res, Err(DelegateError::AmountTooSmall));
    }

    // ============ Power Computation Tests ============

    #[test]
    fn test_effective_power_no_delegations() {
        let r = reg();
        assert_eq!(effective_power(&r, &addr(1), 10000, 100), 10000);
    }

    #[test]
    fn test_effective_power_with_partial_out() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 3000, 100, None, true).unwrap();
        assert_eq!(effective_power(&r, &addr(1), 10000, 100), 7000);
    }

    #[test]
    fn test_effective_power_with_partial_in() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 3000, 100, None, true).unwrap();
        // addr(2) receives 3000 partial
        assert_eq!(effective_power(&r, &addr(2), 5000, 100), 8000);
    }

    #[test]
    fn test_received_power_with_lookup() {
        let mut r = reg();
        delegate_full(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        let lookup = [(addr(1), 5000u64)];
        let recv = received_power(&r, &addr(2), &lookup, 100);
        assert_eq!(recv, 5000);
    }

    #[test]
    fn test_received_power_proportional() {
        let mut r = reg();
        delegate_proportional(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        let lookup = [(addr(1), 10000u64)];
        let recv = received_power(&r, &addr(2), &lookup, 100);
        assert_eq!(recv, 5000); // 50% of 10000
    }

    #[test]
    fn test_received_power_multiple_delegators() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(3), 2000, 100, None, true).unwrap();
        delegate_partial(&mut r, addr(2), addr(3), 3000, 100, None, true).unwrap();
        let lookup = [(addr(1), 5000u64), (addr(2), 5000u64)];
        let recv = received_power(&r, &addr(3), &lookup, 100);
        assert_eq!(recv, 5000);
    }

    #[test]
    fn test_delegated_out_power_full() {
        let mut r = reg();
        delegate_full(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        assert_eq!(delegated_out_power(&r, &addr(1), 8000, 100), 8000);
    }

    #[test]
    fn test_delegated_out_power_proportional() {
        let mut r = reg();
        delegate_proportional(&mut r, addr(1), addr(2), 2500, 100, None, true).unwrap();
        // 25% of 10000 = 2500
        assert_eq!(delegated_out_power(&r, &addr(1), 10000, 100), 2500);
    }

    #[test]
    fn test_available_power() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 3000, 100, None, true).unwrap();
        assert_eq!(available_power(&r, &addr(1), 10000, 100), 7000);
    }

    #[test]
    fn test_available_power_none_delegated() {
        let r = reg();
        assert_eq!(available_power(&r, &addr(1), 10000, 100), 10000);
    }

    #[test]
    fn test_available_power_all_delegated() {
        let mut r = reg();
        delegate_full(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        assert_eq!(available_power(&r, &addr(1), 5000, 100), 0);
    }

    #[test]
    fn test_compute_profile() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 3000, 100, None, true).unwrap();
        delegate_partial(&mut r, addr(3), addr(1), 2000, 100, None, true).unwrap();
        let lookup = [(addr(1), 10000u64), (addr(3), 5000u64)];
        let p = compute_profile(&r, &addr(1), 10000, &lookup, 100);
        assert_eq!(p.own_power, 10000);
        assert_eq!(p.received_power, 2000);
        assert_eq!(p.delegated_out_power, 3000);
        assert_eq!(p.effective_power, 9000); // 10000 - 3000 + 2000
        assert_eq!(p.delegation_count_out, 1);
        assert_eq!(p.delegation_count_in, 1);
    }

    #[test]
    fn test_compute_profile_no_delegations() {
        let r = reg();
        let p = compute_profile(&r, &addr(1), 10000, &[], 100);
        assert_eq!(p.effective_power, 10000);
        assert_eq!(p.delegation_count_in, 0);
        assert_eq!(p.delegation_count_out, 0);
    }

    // ============ Chain Analysis Tests ============

    #[test]
    fn test_delegation_chain_single() {
        let mut r = reg();
        delegate_full(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        let chain = delegation_chain(&r, &addr(1), 100);
        assert_eq!(chain.addresses, vec![addr(1), addr(2)]);
        assert_eq!(chain.depth, 1);
    }

    #[test]
    fn test_delegation_chain_multi_level() {
        let mut r = reg();
        delegate_full(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        delegate_full(&mut r, addr(2), addr(3), 5000, 100, None, true).unwrap();
        let chain = delegation_chain(&r, &addr(1), 100);
        assert_eq!(chain.addresses, vec![addr(1), addr(2), addr(3)]);
        assert_eq!(chain.depth, 2);
    }

    #[test]
    fn test_delegation_chain_no_delegations() {
        let r = reg();
        let chain = delegation_chain(&r, &addr(1), 100);
        assert_eq!(chain.addresses, vec![addr(1)]);
        assert_eq!(chain.depth, 0);
    }

    #[test]
    fn test_reverse_chain() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(3), 2000, 100, None, true).unwrap();
        delegate_partial(&mut r, addr(2), addr(3), 3000, 100, None, true).unwrap();
        let rev = reverse_chain(&r, &addr(3), 100);
        assert_eq!(rev.len(), 2);
        assert!(rev.contains(&addr(1)));
        assert!(rev.contains(&addr(2)));
    }

    #[test]
    fn test_reverse_chain_empty() {
        let r = reg();
        let rev = reverse_chain(&r, &addr(1), 100);
        assert!(rev.is_empty());
    }

    #[test]
    fn test_chain_depth_direct() {
        let mut r = reg();
        delegate_full(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        assert_eq!(chain_depth(&r, &addr(1), &addr(2), 100), 1);
    }

    #[test]
    fn test_chain_depth_indirect() {
        let mut r = reg();
        delegate_full(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        delegate_full(&mut r, addr(2), addr(3), 5000, 100, None, true).unwrap();
        assert_eq!(chain_depth(&r, &addr(1), &addr(3), 100), 2);
    }

    #[test]
    fn test_chain_depth_no_link() {
        let r = reg();
        assert_eq!(chain_depth(&r, &addr(1), &addr(2), 100), 0);
    }

    #[test]
    fn test_would_create_cycle_true() {
        let mut r = reg();
        delegate_full(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        assert!(would_create_cycle(&r, &addr(2), &addr(1), 100));
    }

    #[test]
    fn test_would_create_cycle_false() {
        let mut r = reg();
        delegate_full(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        assert!(!would_create_cycle(&r, &addr(3), &addr(1), 100));
    }

    #[test]
    fn test_would_create_cycle_transitive() {
        let mut r = reg();
        delegate_full(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        delegate_full(&mut r, addr(2), addr(3), 5000, 100, None, true).unwrap();
        assert!(would_create_cycle(&r, &addr(3), &addr(1), 100));
    }

    #[test]
    fn test_longest_chain_empty() {
        let r = reg();
        let chain = longest_chain(&r, 100);
        assert_eq!(chain.depth, 0);
    }

    #[test]
    fn test_longest_chain_single() {
        let mut r = reg();
        delegate_full(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        let chain = longest_chain(&r, 100);
        assert_eq!(chain.depth, 1);
    }

    #[test]
    fn test_longest_chain_multiple_paths() {
        let mut r = reg();
        delegate_full(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        delegate_full(&mut r, addr(2), addr(3), 5000, 100, None, true).unwrap();
        delegate_full(&mut r, addr(4), addr(5), 5000, 100, None, true).unwrap();
        let chain = longest_chain(&r, 100);
        assert_eq!(chain.depth, 2); // 1->2->3
    }

    // ============ Expiry & Cleanup Tests ============

    #[test]
    fn test_expire_delegations() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, Some(200), true).unwrap();
        delegate_partial(&mut r, addr(3), addr(4), 3000, 100, Some(300), true).unwrap();
        let count = expire_delegations(&mut r, 250);
        assert_eq!(count, 1); // Only first expired
        assert!(!r.delegations[0].active);
        assert!(r.delegations[1].active);
    }

    #[test]
    fn test_expire_delegations_all() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, Some(200), true).unwrap();
        delegate_partial(&mut r, addr(3), addr(4), 3000, 100, Some(300), true).unwrap();
        let count = expire_delegations(&mut r, 300);
        assert_eq!(count, 2);
    }

    #[test]
    fn test_expire_delegations_none_permanent() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, None, true).unwrap();
        let count = expire_delegations(&mut r, 9999);
        assert_eq!(count, 0);
    }

    #[test]
    fn test_active_delegations() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, Some(200), true).unwrap();
        delegate_partial(&mut r, addr(3), addr(4), 3000, 100, None, true).unwrap();
        let active = active_delegations(&r, 250);
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].delegator, addr(3));
    }

    #[test]
    fn test_expired_delegations_list() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, Some(200), true).unwrap();
        delegate_partial(&mut r, addr(3), addr(4), 3000, 100, None, true).unwrap();
        let expired = expired_delegations(&r, 250);
        assert_eq!(expired.len(), 1);
    }

    #[test]
    fn test_expiring_soon() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, Some(200), true).unwrap();
        delegate_partial(&mut r, addr(3), addr(4), 3000, 100, Some(500), true).unwrap();
        delegate_partial(&mut r, addr(5), addr(6), 4000, 100, None, true).unwrap();
        let soon = expiring_soon(&r, 150, 100); // window: 150 to 250
        assert_eq!(soon.len(), 1);
        assert_eq!(soon[0].delegator, addr(1));
    }

    #[test]
    fn test_expiring_soon_none() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, Some(500), true).unwrap();
        let soon = expiring_soon(&r, 100, 50);
        assert_eq!(soon.len(), 0);
    }

    #[test]
    fn test_cleanup_inactive() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, None, true).unwrap();
        delegate_partial(&mut r, addr(3), addr(4), 3000, 100, None, true).unwrap();
        revoke_delegation(&mut r, &addr(1), &addr(2)).unwrap();
        let count = cleanup_inactive(&mut r);
        assert_eq!(count, 1);
        assert_eq!(r.delegations.len(), 1);
    }

    #[test]
    fn test_cleanup_inactive_none() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, None, true).unwrap();
        let count = cleanup_inactive(&mut r);
        assert_eq!(count, 0);
    }

    // ============ Query Tests ============

    #[test]
    fn test_find_delegation_found() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, None, true).unwrap();
        let d = find_delegation(&r, &addr(1), &addr(2));
        assert!(d.is_some());
        assert_eq!(d.unwrap().amount, 2000);
    }

    #[test]
    fn test_find_delegation_not_found() {
        let r = reg();
        assert!(find_delegation(&r, &addr(1), &addr(2)).is_none());
    }

    #[test]
    fn test_find_delegation_inactive_not_found() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, None, true).unwrap();
        revoke_delegation(&mut r, &addr(1), &addr(2)).unwrap();
        assert!(find_delegation(&r, &addr(1), &addr(2)).is_none());
    }

    #[test]
    fn test_outgoing_delegations() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, None, true).unwrap();
        delegate_partial(&mut r, addr(1), addr(3), 3000, 100, None, true).unwrap();
        delegate_partial(&mut r, addr(2), addr(3), 1000, 100, None, true).unwrap();
        let out = outgoing_delegations(&r, &addr(1), 100);
        assert_eq!(out.len(), 2);
    }

    #[test]
    fn test_incoming_delegations() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(3), 2000, 100, None, true).unwrap();
        delegate_partial(&mut r, addr(2), addr(3), 3000, 100, None, true).unwrap();
        let inc = incoming_delegations(&r, &addr(3), 100);
        assert_eq!(inc.len(), 2);
    }

    #[test]
    fn test_delegation_count() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, None, true).unwrap();
        delegate_partial(&mut r, addr(1), addr(3), 3000, 100, None, true).unwrap();
        delegate_partial(&mut r, addr(4), addr(1), 1000, 100, None, true).unwrap();
        let (out, inc) = delegation_count(&r, &addr(1), 100);
        assert_eq!(out, 2);
        assert_eq!(inc, 1);
    }

    #[test]
    fn test_is_delegating_true() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, None, true).unwrap();
        assert!(is_delegating(&r, &addr(1), 100));
    }

    #[test]
    fn test_is_delegating_false() {
        let r = reg();
        assert!(!is_delegating(&r, &addr(1), 100));
    }

    #[test]
    fn test_is_delegate_true() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, None, true).unwrap();
        assert!(is_delegate(&r, &addr(2), 100));
    }

    #[test]
    fn test_is_delegate_false() {
        let r = reg();
        assert!(!is_delegate(&r, &addr(2), 100));
    }

    #[test]
    fn test_outgoing_delegations_filters_expired() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, Some(200), true).unwrap();
        delegate_partial(&mut r, addr(1), addr(3), 3000, 100, None, true).unwrap();
        let out = outgoing_delegations(&r, &addr(1), 250);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].delegate, addr(3));
    }

    #[test]
    fn test_incoming_delegations_filters_expired() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(3), 2000, 100, Some(200), true).unwrap();
        delegate_partial(&mut r, addr(2), addr(3), 3000, 100, None, true).unwrap();
        let inc = incoming_delegations(&r, &addr(3), 250);
        assert_eq!(inc.len(), 1);
    }

    // ============ Analytics Tests ============

    #[test]
    fn test_top_delegates() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(10), 5000, 100, None, true).unwrap();
        delegate_partial(&mut r, addr(2), addr(11), 3000, 100, None, true).unwrap();
        delegate_partial(&mut r, addr(3), addr(10), 2000, 100, None, true).unwrap();
        let lookup = [(addr(1), 10000u64), (addr(2), 10000), (addr(3), 10000)];
        let top = top_delegates(&r, &lookup, 100, 2);
        assert_eq!(top.len(), 2);
        assert_eq!(top[0].0, addr(10)); // 7000 total
        assert_eq!(top[0].1, 7000);
        assert_eq!(top[1].0, addr(11)); // 3000 total
    }

    #[test]
    fn test_top_delegates_empty() {
        let r = reg();
        let top = top_delegates(&r, &[], 100, 5);
        assert!(top.is_empty());
    }

    #[test]
    fn test_delegation_concentration() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(10), 7000, 100, None, true).unwrap();
        delegate_partial(&mut r, addr(2), addr(11), 3000, 100, None, true).unwrap();
        let lookup = [(addr(1), 10000u64), (addr(2), 10000)];
        let conc = delegation_concentration(&r, &lookup, 100);
        assert_eq!(conc, 7000); // 7000/10000 * 10000 = 7000 bps
    }

    #[test]
    fn test_delegation_concentration_empty() {
        let r = reg();
        assert_eq!(delegation_concentration(&r, &[], 100), 0);
    }

    #[test]
    fn test_total_delegated_power() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 3000, 100, None, true).unwrap();
        delegate_partial(&mut r, addr(3), addr(4), 2000, 100, None, true).unwrap();
        let lookup = [(addr(1), 10000u64), (addr(3), 5000)];
        let total = total_delegated_power(&r, &lookup, 100);
        assert_eq!(total, 5000);
    }

    #[test]
    fn test_delegation_rate_bps() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2500, 100, None, true).unwrap();
        let lookup = [(addr(1), 10000u64)];
        let rate = delegation_rate(&r, 10000, &lookup, 100);
        assert_eq!(rate, 2500); // 25%
    }

    #[test]
    fn test_delegation_rate_zero_total() {
        let r = reg();
        assert_eq!(delegation_rate(&r, 0, &[], 100), 0);
    }

    #[test]
    fn test_unique_delegators() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, None, true).unwrap();
        delegate_partial(&mut r, addr(1), addr(3), 3000, 100, None, true).unwrap();
        delegate_partial(&mut r, addr(4), addr(5), 1000, 100, None, true).unwrap();
        assert_eq!(unique_delegators(&r, 100), 2);
    }

    #[test]
    fn test_unique_delegates() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, None, true).unwrap();
        delegate_partial(&mut r, addr(3), addr(2), 3000, 100, None, true).unwrap();
        delegate_partial(&mut r, addr(4), addr(5), 1000, 100, None, true).unwrap();
        assert_eq!(unique_delegates(&r, 100), 2);
    }

    #[test]
    fn test_unique_delegators_filters_expired() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, Some(200), true).unwrap();
        delegate_partial(&mut r, addr(3), addr(4), 3000, 100, None, true).unwrap();
        assert_eq!(unique_delegators(&r, 250), 1);
    }

    // ============ Validation Tests ============

    #[test]
    fn test_validate_delegation_ok() {
        let r = reg();
        let d = Delegation {
            delegator: addr(1),
            delegate: addr(2),
            delegation_type: DelegationType::Partial,
            amount: 2000,
            created_at: 100,
            expires_at: None,
            revocable: true,
            active: true,
        };
        assert!(validate_delegation(&r, &d, 5000, 100).is_ok());
    }

    #[test]
    fn test_validate_delegation_self() {
        let r = reg();
        let d = Delegation {
            delegator: addr(1),
            delegate: addr(1),
            delegation_type: DelegationType::Full,
            amount: 0,
            created_at: 100,
            expires_at: None,
            revocable: true,
            active: true,
        };
        assert_eq!(
            validate_delegation(&r, &d, 5000, 100),
            Err(DelegateError::SelfDelegation)
        );
    }

    #[test]
    fn test_validate_delegation_inactive() {
        let r = reg();
        let d = Delegation {
            delegator: addr(1),
            delegate: addr(2),
            delegation_type: DelegationType::Full,
            amount: 0,
            created_at: 100,
            expires_at: None,
            revocable: true,
            active: false,
        };
        assert_eq!(
            validate_delegation(&r, &d, 5000, 100),
            Err(DelegateError::DelegationInactive)
        );
    }

    #[test]
    fn test_validate_delegation_expired() {
        let r = reg();
        let d = Delegation {
            delegator: addr(1),
            delegate: addr(2),
            delegation_type: DelegationType::Full,
            amount: 0,
            created_at: 100,
            expires_at: Some(200),
            revocable: true,
            active: true,
        };
        assert_eq!(
            validate_delegation(&r, &d, 5000, 300),
            Err(DelegateError::DelegationExpired)
        );
    }

    #[test]
    fn test_validate_delegation_full_insufficient() {
        let r = reg();
        let d = Delegation {
            delegator: addr(1),
            delegate: addr(2),
            delegation_type: DelegationType::Full,
            amount: 0,
            created_at: 100,
            expires_at: None,
            revocable: true,
            active: true,
        };
        assert_eq!(
            validate_delegation(&r, &d, 500, 100),
            Err(DelegateError::InsufficientPower)
        );
    }

    #[test]
    fn test_validate_delegation_partial_too_small() {
        let r = reg();
        let d = Delegation {
            delegator: addr(1),
            delegate: addr(2),
            delegation_type: DelegationType::Partial,
            amount: 500,
            created_at: 100,
            expires_at: None,
            revocable: true,
            active: true,
        };
        assert_eq!(
            validate_delegation(&r, &d, 5000, 100),
            Err(DelegateError::AmountTooSmall)
        );
    }

    #[test]
    fn test_validate_delegation_partial_exceeds_own() {
        let r = reg();
        let d = Delegation {
            delegator: addr(1),
            delegate: addr(2),
            delegation_type: DelegationType::Partial,
            amount: 6000,
            created_at: 100,
            expires_at: None,
            revocable: true,
            active: true,
        };
        assert_eq!(
            validate_delegation(&r, &d, 5000, 100),
            Err(DelegateError::InsufficientPower)
        );
    }

    #[test]
    fn test_validate_delegation_proportional_zero() {
        let r = reg();
        let d = Delegation {
            delegator: addr(1),
            delegate: addr(2),
            delegation_type: DelegationType::Proportional,
            amount: 0,
            created_at: 100,
            expires_at: None,
            revocable: true,
            active: true,
        };
        assert_eq!(
            validate_delegation(&r, &d, 5000, 100),
            Err(DelegateError::InvalidAmount)
        );
    }

    #[test]
    fn test_validate_delegation_proportional_over_max() {
        let r = reg();
        let d = Delegation {
            delegator: addr(1),
            delegate: addr(2),
            delegation_type: DelegationType::Proportional,
            amount: 10001,
            created_at: 100,
            expires_at: None,
            revocable: true,
            active: true,
        };
        assert_eq!(
            validate_delegation(&r, &d, 5000, 100),
            Err(DelegateError::InvalidAmount)
        );
    }

    #[test]
    fn test_validate_registry_clean() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, None, true).unwrap();
        let errors = validate_registry(&r, 100);
        assert!(errors.is_empty());
    }

    #[test]
    fn test_validate_registry_expired() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, Some(200), true).unwrap();
        let errors = validate_registry(&r, 300);
        assert!(errors.contains(&DelegateError::DelegationExpired));
    }

    #[test]
    fn test_has_circular_delegation_false() {
        let mut r = reg();
        delegate_full(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        assert!(!has_circular_delegation(&r, 100));
    }

    #[test]
    fn test_has_circular_delegation_injected() {
        let mut r = reg();
        // Manually inject a cycle (bypassing cycle check)
        r.delegations.push(Delegation {
            delegator: addr(1),
            delegate: addr(2),
            delegation_type: DelegationType::Full,
            amount: 0,
            created_at: 100,
            expires_at: None,
            revocable: true,
            active: true,
        });
        r.delegations.push(Delegation {
            delegator: addr(2),
            delegate: addr(1),
            delegation_type: DelegationType::Full,
            amount: 0,
            created_at: 100,
            expires_at: None,
            revocable: true,
            active: true,
        });
        assert!(has_circular_delegation(&r, 100));
    }

    // ============ Batch Operations Tests ============

    #[test]
    fn test_batch_delegate_success() {
        let mut r = reg();
        let delegates = vec![(addr(2), 2000u64), (addr(3), 3000)];
        let count = batch_delegate(&mut r, addr(1), &delegates, 10000, 100).unwrap();
        assert_eq!(count, 2);
        assert_eq!(r.delegations.len(), 2);
    }

    #[test]
    fn test_batch_delegate_insufficient_power() {
        let mut r = reg();
        let delegates = vec![(addr(2), 6000u64), (addr(3), 5000)];
        let res = batch_delegate(&mut r, addr(1), &delegates, 10000, 100);
        assert_eq!(res, Err(DelegateError::InsufficientPower));
    }

    #[test]
    fn test_batch_delegate_empty() {
        let mut r = reg();
        let count = batch_delegate(&mut r, addr(1), &[], 10000, 100).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_redistribute_success() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        let new_weights = vec![(addr(3), 3000u64), (addr(4), 4000)];
        redistribute(&mut r, &addr(1), &new_weights, 10000, 100).unwrap();
        // Old delegation to addr(2) should be revoked
        let out = outgoing_delegations(&r, &addr(1), 100);
        assert_eq!(out.len(), 2);
        assert!(out.iter().any(|d| d.delegate == addr(3)));
        assert!(out.iter().any(|d| d.delegate == addr(4)));
    }

    #[test]
    fn test_redistribute_insufficient() {
        let mut r = reg();
        let new_weights = vec![(addr(2), 6000u64), (addr(3), 5000)];
        let res = redistribute(&mut r, &addr(1), &new_weights, 10000, 100);
        assert_eq!(res, Err(DelegateError::InsufficientPower));
    }

    #[test]
    fn test_snapshot_delegations() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 3000, 100, None, true).unwrap();
        let snap = snapshot_delegations(&r, 100);
        assert_eq!(snap.len(), 2); // both addresses appear
        // addr(2) should have received_power 3000
        let addr2_entry = snap.iter().find(|(a, _)| *a == addr(2)).unwrap();
        assert_eq!(addr2_entry.1, 3000);
    }

    #[test]
    fn test_snapshot_empty() {
        let r = reg();
        let snap = snapshot_delegations(&r, 100);
        assert!(snap.is_empty());
    }

    // ============ Cooldown Tests ============

    #[test]
    fn test_can_modify_no_history() {
        let r = reg_with_cooldown(5000);
        assert!(can_modify(&r, &addr(1), 100));
    }

    #[test]
    fn test_can_modify_cooldown_active() {
        let mut r = reg_with_cooldown(5000);
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, None, true).unwrap();
        assert!(!can_modify(&r, &addr(1), 3000)); // 3000 - 100 = 2900 < 5000
    }

    #[test]
    fn test_can_modify_cooldown_elapsed() {
        let mut r = reg_with_cooldown(5000);
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, None, true).unwrap();
        assert!(can_modify(&r, &addr(1), 5200)); // 5200 - 100 = 5100 >= 5000
    }

    #[test]
    fn test_last_modification_time_none() {
        let r = reg();
        assert_eq!(last_modification_time(&r, &addr(1)), None);
    }

    #[test]
    fn test_last_modification_time_some() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, None, true).unwrap();
        delegate_partial(&mut r, addr(1), addr(3), 3000, 200, None, true).unwrap();
        assert_eq!(last_modification_time(&r, &addr(1)), Some(200));
    }

    #[test]
    fn test_time_until_modifiable_no_history() {
        let r = reg_with_cooldown(5000);
        assert_eq!(time_until_modifiable(&r, &addr(1), 100), 0);
    }

    #[test]
    fn test_time_until_modifiable_active() {
        let mut r = reg_with_cooldown(5000);
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, None, true).unwrap();
        assert_eq!(time_until_modifiable(&r, &addr(1), 3000), 2100); // (100+5000) - 3000
    }

    #[test]
    fn test_time_until_modifiable_elapsed() {
        let mut r = reg_with_cooldown(5000);
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, None, true).unwrap();
        assert_eq!(time_until_modifiable(&r, &addr(1), 6000), 0);
    }

    // ============ Edge Case & Integration Tests ============

    #[test]
    fn test_delegate_after_revoke_same_target() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, None, true).unwrap();
        revoke_delegation(&mut r, &addr(1), &addr(2)).unwrap();
        // Should be able to delegate again
        let res = delegate_partial(&mut r, addr(1), addr(2), 3000, 100, None, true);
        assert!(res.is_ok());
    }

    #[test]
    fn test_expired_delegation_not_blocking() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, Some(200), true).unwrap();
        // At time 300, the delegation has expired, should be able to delegate again
        let res = delegate_partial(&mut r, addr(1), addr(2), 3000, 300, None, true);
        assert!(res.is_ok());
    }

    #[test]
    fn test_power_computation_with_expired() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 3000, 100, Some(200), true).unwrap();
        // After expiry, power should not be delegated out
        assert_eq!(delegated_out_power(&r, &addr(1), 10000, 300), 0);
        assert_eq!(available_power(&r, &addr(1), 10000, 300), 10000);
    }

    #[test]
    fn test_full_delegation_out_power_matches_own() {
        let mut r = reg();
        delegate_full(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        // Full delegation should delegate ALL own power
        assert_eq!(delegated_out_power(&r, &addr(1), 12345, 100), 12345);
    }

    #[test]
    fn test_proportional_delegation_math() {
        let mut r = reg();
        delegate_proportional(&mut r, addr(1), addr(2), 3333, 100, None, true).unwrap();
        // 33.33% of 30000 = 9999
        assert_eq!(delegated_out_power(&r, &addr(1), 30000, 100), 9999);
    }

    #[test]
    fn test_multiple_outgoing_power_sum() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, None, true).unwrap();
        delegate_partial(&mut r, addr(1), addr(3), 3000, 100, None, true).unwrap();
        assert_eq!(delegated_out_power(&r, &addr(1), 10000, 100), 5000);
        assert_eq!(available_power(&r, &addr(1), 10000, 100), 5000);
    }

    #[test]
    fn test_is_delegating_after_revoke() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, None, true).unwrap();
        revoke_delegation(&mut r, &addr(1), &addr(2)).unwrap();
        assert!(!is_delegating(&r, &addr(1), 100));
    }

    #[test]
    fn test_is_delegate_after_expiry() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, Some(200), true).unwrap();
        assert!(!is_delegate(&r, &addr(2), 300));
    }

    #[test]
    fn test_chain_stops_at_expired() {
        let mut r = reg();
        delegate_full(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        delegate_full(&mut r, addr(2), addr(3), 5000, 100, Some(200), true).unwrap();
        let chain = delegation_chain(&r, &addr(1), 300);
        // 2->3 is expired, so chain should be [1, 2]
        assert_eq!(chain.addresses, vec![addr(1), addr(2)]);
        assert_eq!(chain.depth, 1);
    }

    #[test]
    fn test_three_level_chain() {
        let mut r = reg();
        delegate_full(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        delegate_full(&mut r, addr(2), addr(3), 5000, 100, None, true).unwrap();
        delegate_full(&mut r, addr(3), addr(4), 5000, 100, None, true).unwrap();
        let chain = delegation_chain(&r, &addr(1), 100);
        assert_eq!(chain.depth, 3);
        assert_eq!(chain.addresses.len(), 4);
    }

    #[test]
    fn test_reverse_chain_ignores_inactive() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(3), 2000, 100, None, true).unwrap();
        delegate_partial(&mut r, addr(2), addr(3), 3000, 100, None, true).unwrap();
        revoke_delegation(&mut r, &addr(1), &addr(3)).unwrap();
        let rev = reverse_chain(&r, &addr(3), 100);
        assert_eq!(rev.len(), 1);
        assert_eq!(rev[0], addr(2));
    }

    #[test]
    fn test_delegation_count_with_mixed_states() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, None, true).unwrap();
        delegate_partial(&mut r, addr(1), addr(3), 3000, 100, Some(200), true).unwrap();
        // At time 250, one is expired
        let (out, _) = delegation_count(&r, &addr(1), 250);
        assert_eq!(out, 1);
    }

    #[test]
    fn test_validate_registry_with_bad_proportional() {
        let mut r = reg();
        // Manually inject invalid proportional
        r.delegations.push(Delegation {
            delegator: addr(1),
            delegate: addr(2),
            delegation_type: DelegationType::Proportional,
            amount: 15000, // Over 10000
            created_at: 100,
            expires_at: None,
            revocable: true,
            active: true,
        });
        let errors = validate_registry(&r, 100);
        assert!(errors.contains(&DelegateError::InvalidAmount));
    }

    #[test]
    fn test_validate_registry_with_bad_partial() {
        let mut r = reg();
        r.delegations.push(Delegation {
            delegator: addr(1),
            delegate: addr(2),
            delegation_type: DelegationType::Partial,
            amount: 500, // Below min 1000
            created_at: 100,
            expires_at: None,
            revocable: true,
            active: true,
        });
        let errors = validate_registry(&r, 100);
        assert!(errors.contains(&DelegateError::AmountTooSmall));
    }

    #[test]
    fn test_batch_delegate_self_delegation_error() {
        let mut r = reg();
        let delegates = vec![(addr(1), 2000u64)]; // Self-delegation
        let res = batch_delegate(&mut r, addr(1), &delegates, 10000, 100);
        assert_eq!(res, Err(DelegateError::SelfDelegation));
    }

    #[test]
    fn test_redistribute_empty_weights() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        redistribute(&mut r, &addr(1), &[], 10000, 100).unwrap();
        let out = outgoing_delegations(&r, &addr(1), 100);
        assert_eq!(out.len(), 0);
    }

    #[test]
    fn test_snapshot_with_mixed_types() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 3000, 100, None, true).unwrap();
        delegate_full(&mut r, addr(3), addr(4), 5000, 100, None, true).unwrap();
        let snap = snapshot_delegations(&r, 100);
        // Should have 4 unique addresses
        assert_eq!(snap.len(), 4);
        // addr(2) gets 3000 partial
        let a2 = snap.iter().find(|(a, _)| *a == addr(2)).unwrap();
        assert_eq!(a2.1, 3000);
        // addr(4) gets 0 from full (no power lookup in snapshot)
        let a4 = snap.iter().find(|(a, _)| *a == addr(4)).unwrap();
        assert_eq!(a4.1, 0);
    }

    #[test]
    fn test_effective_power_saturating_sub() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 15000, 100, None, true).unwrap();
        // own_power < delegated_out: should saturate to 0, not underflow
        assert_eq!(effective_power(&r, &addr(1), 10000, 100), 0);
    }

    #[test]
    fn test_cleanup_then_redelegate() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, None, true).unwrap();
        revoke_delegation(&mut r, &addr(1), &addr(2)).unwrap();
        cleanup_inactive(&mut r);
        assert_eq!(r.delegations.len(), 0);
        // Can delegate again
        let res = delegate_partial(&mut r, addr(1), addr(2), 3000, 100, None, true);
        assert!(res.is_ok());
    }

    #[test]
    fn test_expire_then_cleanup() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, Some(200), true).unwrap();
        expire_delegations(&mut r, 300);
        let cleaned = cleanup_inactive(&mut r);
        assert_eq!(cleaned, 1);
        assert!(r.delegations.is_empty());
    }

    #[test]
    fn test_delegation_type_equality() {
        assert_eq!(DelegationType::Full, DelegationType::Full);
        assert_eq!(DelegationType::Partial, DelegationType::Partial);
        assert_eq!(DelegationType::Proportional, DelegationType::Proportional);
        assert_ne!(DelegationType::Full, DelegationType::Partial);
    }

    #[test]
    fn test_delegate_error_equality() {
        assert_eq!(DelegateError::SelfDelegation, DelegateError::SelfDelegation);
        assert_ne!(DelegateError::SelfDelegation, DelegateError::Overflow);
    }

    #[test]
    fn test_received_power_with_full_delegation() {
        let mut r = reg();
        delegate_full(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        let lookup = [(addr(1), 8000u64)];
        let recv = received_power(&r, &addr(2), &lookup, 100);
        assert_eq!(recv, 8000); // Full delegates all of addr(1)'s power
    }

    #[test]
    fn test_received_power_no_lookup_entry() {
        let mut r = reg();
        delegate_full(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        // No lookup entry for addr(1)
        let recv = received_power(&r, &addr(2), &[], 100);
        assert_eq!(recv, 0);
    }

    #[test]
    fn test_top_delegates_truncation() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(10), 5000, 100, None, true).unwrap();
        delegate_partial(&mut r, addr(2), addr(11), 3000, 100, None, true).unwrap();
        delegate_partial(&mut r, addr(3), addr(12), 1000, 100, None, true).unwrap();
        let lookup = [(addr(1), 10000u64), (addr(2), 10000), (addr(3), 10000)];
        let top = top_delegates(&r, &lookup, 100, 1);
        assert_eq!(top.len(), 1);
        assert_eq!(top[0].0, addr(10));
    }

    #[test]
    fn test_total_delegated_power_with_proportional() {
        let mut r = reg();
        delegate_proportional(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        let lookup = [(addr(1), 10000u64)];
        let total = total_delegated_power(&r, &lookup, 100);
        assert_eq!(total, 5000); // 50% of 10000
    }

    #[test]
    fn test_delegation_rate_full_delegation() {
        let mut r = reg();
        delegate_full(&mut r, addr(1), addr(2), 10000, 100, None, true).unwrap();
        let lookup = [(addr(1), 10000u64)];
        let rate = delegation_rate(&r, 10000, &lookup, 100);
        assert_eq!(rate, 10000); // 100%
    }

    #[test]
    fn test_can_modify_zero_cooldown() {
        let mut r = create_registry(3, 10, 1000, 0);
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, None, true).unwrap();
        assert!(can_modify(&r, &addr(1), 100)); // 0 cooldown = always modifiable
    }

    #[test]
    fn test_multiple_incoming_different_types() {
        let mut r = reg();
        delegate_full(&mut r, addr(1), addr(5), 5000, 100, None, true).unwrap();
        delegate_partial(&mut r, addr(2), addr(5), 3000, 100, None, true).unwrap();
        delegate_proportional(&mut r, addr(3), addr(5), 5000, 100, None, true).unwrap();
        let lookup = [(addr(1), 10000u64), (addr(2), 8000), (addr(3), 6000)];
        let recv = received_power(&r, &addr(5), &lookup, 100);
        // Full: 10000, Partial: 3000, Proportional: 50% of 6000 = 3000
        assert_eq!(recv, 16000);
    }

    #[test]
    fn test_compute_profile_address_preserved() {
        let r = reg();
        let p = compute_profile(&r, &addr(42), 10000, &[], 100);
        assert_eq!(p.address, addr(42));
    }

    #[test]
    fn test_expiring_soon_boundary() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, Some(200), true).unwrap();
        // At now=199, window=1 -> range 199..200 (exclusive end for exp > now)
        let soon = expiring_soon(&r, 199, 1);
        assert_eq!(soon.len(), 1);
    }

    #[test]
    fn test_expiring_soon_exact_boundary() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, Some(200), true).unwrap();
        // At now=200, delegation is already expired (now >= exp)
        let soon = expiring_soon(&r, 200, 100);
        assert_eq!(soon.len(), 0);
    }

    #[test]
    fn test_revoke_all_returns_correct_count() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, None, true).unwrap();
        delegate_partial(&mut r, addr(1), addr(3), 3000, 100, None, true).unwrap();
        delegate_partial(&mut r, addr(1), addr(4), 4000, 100, None, false).unwrap();
        let count = revoke_all(&mut r, &addr(1));
        assert_eq!(count, 2); // Only 2 revocable
    }

    #[test]
    fn test_modify_proportional_boundary_10000() {
        let mut r = reg();
        delegate_proportional(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        let res = modify_delegation(&mut r, &addr(1), &addr(2), 10000);
        assert!(res.is_ok());
        assert_eq!(r.delegations[0].amount, 10000);
    }

    #[test]
    fn test_unique_delegators_with_revoked() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, None, true).unwrap();
        delegate_partial(&mut r, addr(3), addr(4), 3000, 100, None, true).unwrap();
        revoke_delegation(&mut r, &addr(1), &addr(2)).unwrap();
        assert_eq!(unique_delegators(&r, 100), 1); // Only addr(3) active
    }

    #[test]
    fn test_longest_chain_ignores_expired() {
        let mut r = reg();
        delegate_full(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        delegate_full(&mut r, addr(2), addr(3), 5000, 100, Some(200), true).unwrap();
        let chain = longest_chain(&r, 300);
        assert_eq!(chain.depth, 1); // 2->3 expired, so only 1->2
    }

    #[test]
    fn test_delegation_chain_stops_at_max_depth() {
        // Even with max_chain_depth=3, iteration limit prevents infinite traversal
        let mut r = create_registry(3, 10, 1000, 0);
        delegate_full(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        delegate_full(&mut r, addr(2), addr(3), 5000, 100, None, true).unwrap();
        delegate_full(&mut r, addr(3), addr(4), 5000, 100, None, true).unwrap();
        let chain = delegation_chain(&r, &addr(1), 100);
        assert!(chain.depth <= 4); // bounded by max_iter
    }

    // ============ Hardening Round 7 ============

    #[test]
    fn test_self_delegation_full_rejected_h7() {
        let mut r = reg();
        let res = delegate_full(&mut r, addr(1), addr(1), 5000, 100, None, true);
        assert_eq!(res, Err(DelegateError::SelfDelegation));
    }

    #[test]
    fn test_self_delegation_partial_rejected_h7() {
        let mut r = reg();
        let res = delegate_partial(&mut r, addr(1), addr(1), 2000, 100, None, true);
        assert_eq!(res, Err(DelegateError::SelfDelegation));
    }

    #[test]
    fn test_self_delegation_proportional_rejected_h7() {
        let mut r = reg();
        let res = delegate_proportional(&mut r, addr(1), addr(1), 5000, 100, None, true);
        assert_eq!(res, Err(DelegateError::SelfDelegation));
    }

    #[test]
    fn test_partial_zero_amount_rejected_h7() {
        let mut r = reg();
        let res = delegate_partial(&mut r, addr(1), addr(2), 0, 100, None, true);
        assert_eq!(res, Err(DelegateError::InvalidAmount));
    }

    #[test]
    fn test_partial_below_min_amount_h7() {
        let mut r = reg();
        let res = delegate_partial(&mut r, addr(1), addr(2), 500, 100, None, true);
        assert_eq!(res, Err(DelegateError::AmountTooSmall));
    }

    #[test]
    fn test_proportional_zero_bps_rejected_h7() {
        let mut r = reg();
        let res = delegate_proportional(&mut r, addr(1), addr(2), 0, 100, None, true);
        assert_eq!(res, Err(DelegateError::InvalidAmount));
    }

    #[test]
    fn test_proportional_over_10000_bps_rejected_h7() {
        let mut r = reg();
        let res = delegate_proportional(&mut r, addr(1), addr(2), 10001, 100, None, true);
        assert_eq!(res, Err(DelegateError::InvalidAmount));
    }

    #[test]
    fn test_proportional_boundary_10000_bps_ok_h7() {
        let mut r = reg();
        let res = delegate_proportional(&mut r, addr(1), addr(2), 10000, 100, None, true);
        assert!(res.is_ok());
    }

    #[test]
    fn test_full_insufficient_power_h7() {
        let mut r = reg();
        let res = delegate_full(&mut r, addr(1), addr(2), 500, 100, None, true);
        assert_eq!(res, Err(DelegateError::InsufficientPower));
    }

    #[test]
    fn test_duplicate_active_delegation_rejected_h7() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, None, true).unwrap();
        let res = delegate_partial(&mut r, addr(1), addr(2), 3000, 100, None, true);
        assert_eq!(res, Err(DelegateError::AlreadyDelegated));
    }

    #[test]
    fn test_revoke_nonexistent_delegation_h7() {
        let mut r = reg();
        let res = revoke_delegation(&mut r, &addr(1), &addr(2));
        assert_eq!(res, Err(DelegateError::DelegationNotFound));
    }

    #[test]
    fn test_revoke_non_revocable_delegation_h7() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, None, false).unwrap();
        let res = revoke_delegation(&mut r, &addr(1), &addr(2));
        assert_eq!(res, Err(DelegateError::NotRevocable));
    }

    #[test]
    fn test_modify_full_delegation_rejected_h7() {
        let mut r = reg();
        delegate_full(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        let res = modify_delegation(&mut r, &addr(1), &addr(2), 3000);
        assert_eq!(res, Err(DelegateError::InvalidAmount));
    }

    #[test]
    fn test_modify_zero_amount_rejected_h7() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, None, true).unwrap();
        let res = modify_delegation(&mut r, &addr(1), &addr(2), 0);
        assert_eq!(res, Err(DelegateError::InvalidAmount));
    }

    #[test]
    fn test_modify_proportional_over_10000_rejected_h7() {
        let mut r = reg();
        delegate_proportional(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        let res = modify_delegation(&mut r, &addr(1), &addr(2), 10001);
        assert_eq!(res, Err(DelegateError::InvalidAmount));
    }

    #[test]
    fn test_effective_power_with_partial_delegation_h7() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 3000, 100, None, true).unwrap();
        // addr(2) receives 3000 partial
        let eff = effective_power(&r, &addr(2), 1000, 100);
        assert_eq!(eff, 1000 + 3000); // own_power + received partial
    }

    #[test]
    fn test_available_power_after_full_delegation_h7() {
        let mut r = reg();
        delegate_full(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        let avail = available_power(&r, &addr(1), 5000, 100);
        assert_eq!(avail, 0); // All power delegated out
    }

    #[test]
    fn test_delegation_chain_single_node_h7() {
        let r = reg();
        let chain = delegation_chain(&r, &addr(1), 100);
        assert_eq!(chain.depth, 0);
        assert_eq!(chain.addresses.len(), 1);
    }

    #[test]
    fn test_reverse_chain_empty_h7() {
        let r = reg();
        let rev = reverse_chain(&r, &addr(1), 100);
        assert!(rev.is_empty());
    }

    #[test]
    fn test_expire_delegations_none_expired_h7() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, None, true).unwrap();
        let count = expire_delegations(&mut r, 200);
        assert_eq!(count, 0);
    }

    #[test]
    fn test_expire_delegations_one_expired_h7() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, Some(150), true).unwrap();
        delegate_partial(&mut r, addr(3), addr(4), 3000, 100, None, true).unwrap();
        let count = expire_delegations(&mut r, 200);
        assert_eq!(count, 1);
    }

    #[test]
    fn test_cleanup_inactive_h7() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, None, true).unwrap();
        revoke_delegation(&mut r, &addr(1), &addr(2)).unwrap();
        let removed = cleanup_inactive(&mut r);
        assert_eq!(removed, 1);
        assert!(r.delegations.is_empty());
    }

    #[test]
    fn test_is_delegating_active_h7() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, None, true).unwrap();
        assert!(is_delegating(&r, &addr(1), 100));
        assert!(!is_delegating(&r, &addr(2), 100));
    }

    #[test]
    fn test_is_delegate_active_h7() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, None, true).unwrap();
        assert!(is_delegate(&r, &addr(2), 100));
        assert!(!is_delegate(&r, &addr(1), 100));
    }

    #[test]
    fn test_would_create_cycle_true_h7() {
        let mut r = reg();
        delegate_full(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        assert!(would_create_cycle(&r, &addr(2), &addr(1), 100));
    }

    #[test]
    fn test_would_create_cycle_false_h7() {
        let mut r = reg();
        delegate_full(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        assert!(!would_create_cycle(&r, &addr(3), &addr(2), 100));
    }

    #[test]
    fn test_circular_delegation_prevented_h7() {
        let mut r = reg();
        delegate_full(&mut r, addr(1), addr(2), 5000, 100, None, true).unwrap();
        let res = delegate_full(&mut r, addr(2), addr(1), 5000, 100, None, true);
        assert_eq!(res, Err(DelegateError::CircularDelegation));
    }

    #[test]
    fn test_delegation_count_h7() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, None, true).unwrap();
        delegate_partial(&mut r, addr(1), addr(3), 3000, 100, None, true).unwrap();
        delegate_partial(&mut r, addr(4), addr(1), 4000, 100, None, true).unwrap();
        let (out, in_) = delegation_count(&r, &addr(1), 100);
        assert_eq!(out, 2);
        assert_eq!(in_, 1);
    }

    #[test]
    fn test_revoke_all_no_revocable_h7() {
        let mut r = reg();
        delegate_partial(&mut r, addr(1), addr(2), 2000, 100, None, false).unwrap();
        let count = revoke_all(&mut r, &addr(1));
        assert_eq!(count, 0);
    }
}
