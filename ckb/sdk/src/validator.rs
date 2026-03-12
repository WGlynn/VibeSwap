// ============ Validator Module ============
// Implements Transaction Validation Pipeline for VibeSwap on CKB: validates transactions
// against all protocol rules before submission. Checks balances, signatures, rate limits,
// circuit breakers, whitelist, and protocol-specific invariants.
//
// Key capabilities:
// - Full transaction validation pipeline dispatched by tx type
// - Individual checks: balance, slippage, price impact, deadline, nonce, bounds
// - CKB cell validation: capacity rules, type/lock script matching, balance conservation
// - AMM invariant checks: k-constant, supply conservation, price bounds
// - Duplicate detection via tx hashing
// - Batch validation with aggregate analytics
// - Gas estimation and output amount preview
// - Report merging, severity scoring, success rate tracking
//
// All amounts use u64. Intermediate math uses u128. Percentages in basis points (10000 = 100%).
//
// Philosophy: Validate early, fail fast. A rejected transaction costs gas; an invalid one costs trust.

use sha2::{Digest, Sha256};

// ============ Constants ============

/// Basis points denominator
pub const BPS: u64 = 10_000;

/// Minimum CKB cell capacity in shannons (61 bytes * 10^8 shannons/byte)
pub const MIN_CELL_CAPACITY: u64 = 6_100_000_000;

/// Shannons per byte of cell data
pub const SHANNONS_PER_BYTE: u64 = 100_000_000;

/// Base gas for any transaction
pub const BASE_GAS: u64 = 50_000;

/// Gas per cell input
pub const GAS_PER_INPUT: u64 = 10_000;

/// Gas per cell output
pub const GAS_PER_OUTPUT: u64 = 8_000;

/// Default max slippage: 1%
pub const DEFAULT_MAX_SLIPPAGE_BPS: u64 = 100;

/// Default max price impact: 3%
pub const DEFAULT_MAX_PRICE_IMPACT_BPS: u64 = 300;

/// Default minimum amount
pub const DEFAULT_MIN_AMOUNT: u64 = 1_000;

/// Default maximum amount
pub const DEFAULT_MAX_AMOUNT: u64 = 1_000_000_000_000;

/// Default deadline buffer: 30 seconds
pub const DEFAULT_DEADLINE_BUFFER_MS: u64 = 30_000;

/// Default duplicate window: 60 seconds
pub const DEFAULT_DUPLICATE_WINDOW_MS: u64 = 60_000;

/// Max recent hashes for duplicate detection
pub const MAX_RECENT_HASHES: usize = 1000;

// ============ Error Types ============

#[derive(Debug, Clone, PartialEq)]
pub enum ValidationError {
    InsufficientBalance { required: u64, available: u64 },
    InvalidSignature,
    RateLimited { retry_after_ms: u64 },
    CircuitBreakerActive,
    AddressBlocked,
    TokenNotWhitelisted,
    SlippageExceeded { expected: u64, actual: u64 },
    PriceImpactTooHigh { impact_bps: u64, max_bps: u64 },
    AmountTooSmall { min: u64, actual: u64 },
    AmountTooLarge { max: u64, actual: u64 },
    DeadlineExpired { deadline: u64, now: u64 },
    InvalidNonce { expected: u64, actual: u64 },
    DuplicateTransaction,
    PoolInactive,
    InvariantViolation(String),
    InvalidCellData,
    CapacityInsufficient { required: u64, available: u64 },
    TypeScriptMismatch,
    LockScriptMismatch,
    OutputOverflow,
}

// ============ Enums ============

#[derive(Debug, Clone, PartialEq)]
pub enum ValidationResult {
    Valid,
    Invalid(Vec<ValidationError>),
    Pending,
}

#[derive(Debug, Clone, PartialEq)]
pub enum TxType {
    Swap,
    AddLiquidity,
    RemoveLiquidity,
    Stake,
    Unstake,
    Commit,
    Reveal,
    Claim,
    GovernanceVote,
    BridgeTransfer,
    ConfigUpdate,
}

// ============ Data Types ============

#[derive(Debug, Clone)]
pub struct TxInput {
    pub tx_type: TxType,
    pub sender: [u8; 32],
    pub pool_id: Option<[u8; 32]>,
    pub amount_in: u64,
    pub amount_out_min: u64,
    pub deadline: u64,
    pub nonce: u64,
    pub signature: [u8; 64],
    pub cell_deps: Vec<[u8; 32]>,
    pub inputs: Vec<CellInput>,
    pub outputs: Vec<CellOutput>,
}

#[derive(Debug, Clone)]
pub struct CellInput {
    pub out_point: [u8; 32],
    pub capacity: u64,
    pub lock_hash: [u8; 32],
    pub type_hash: Option<[u8; 32]>,
    pub data_hash: [u8; 32],
}

#[derive(Debug, Clone)]
pub struct CellOutput {
    pub capacity: u64,
    pub lock_hash: [u8; 32],
    pub type_hash: Option<[u8; 32]>,
    pub data_size: u64,
}

#[derive(Debug, Clone)]
pub struct ValidationContext {
    pub current_time: u64,
    pub block_height: u64,
    pub sender_balance: u64,
    pub sender_nonce: u64,
    pub pool_reserve_a: u64,
    pub pool_reserve_b: u64,
    pub pool_active: bool,
    pub circuit_breaker_active: bool,
    pub address_whitelisted: bool,
    pub token_whitelisted: bool,
    pub rate_limit_remaining: u64,
    pub oracle_price: u64,
    pub max_price_impact_bps: u64,
}

#[derive(Debug, Clone)]
pub struct ValidationReport {
    pub tx_type: TxType,
    pub result: ValidationResult,
    pub errors: Vec<ValidationError>,
    pub warnings: Vec<String>,
    pub gas_estimate: u64,
    pub validated_at: u64,
    pub checks_performed: u32,
}

#[derive(Debug, Clone)]
pub struct ValidatorConfig {
    pub max_slippage_bps: u64,
    pub max_price_impact_bps: u64,
    pub min_amount: u64,
    pub max_amount: u64,
    pub deadline_buffer_ms: u64,
    pub strict_mode: bool,
    pub duplicate_window_ms: u64,
}

// ============ Config ============

/// Returns a default validator configuration with standard limits.
pub fn default_validator_config() -> ValidatorConfig {
    ValidatorConfig {
        max_slippage_bps: DEFAULT_MAX_SLIPPAGE_BPS,
        max_price_impact_bps: DEFAULT_MAX_PRICE_IMPACT_BPS,
        min_amount: DEFAULT_MIN_AMOUNT,
        max_amount: DEFAULT_MAX_AMOUNT,
        deadline_buffer_ms: DEFAULT_DEADLINE_BUFFER_MS,
        strict_mode: false,
        duplicate_window_ms: DEFAULT_DUPLICATE_WINDOW_MS,
    }
}

/// Returns a strict validator configuration with tighter limits.
pub fn strict_config() -> ValidatorConfig {
    ValidatorConfig {
        max_slippage_bps: 50,
        max_price_impact_bps: 100,
        min_amount: 10_000,
        max_amount: 100_000_000_000,
        deadline_buffer_ms: 10_000,
        strict_mode: true,
        duplicate_window_ms: 120_000,
    }
}

/// Validates that a config has sane parameter values.
pub fn validate_config(config: &ValidatorConfig) -> bool {
    config.max_slippage_bps > 0
        && config.max_slippage_bps <= BPS
        && config.max_price_impact_bps > 0
        && config.max_price_impact_bps <= BPS
        && config.min_amount > 0
        && config.max_amount > config.min_amount
        && config.deadline_buffer_ms > 0
        && config.duplicate_window_ms > 0
}

// ============ Individual Checks ============

/// Checks that the sender has sufficient balance.
pub fn check_balance(required: u64, available: u64) -> Result<(), ValidationError> {
    if available >= required {
        Ok(())
    } else {
        Err(ValidationError::InsufficientBalance { required, available })
    }
}

/// Checks that actual output meets minimum slippage requirement.
pub fn check_slippage(expected_out: u64, min_out: u64, actual_out: u64) -> Result<(), ValidationError> {
    if actual_out >= min_out {
        Ok(())
    } else {
        Err(ValidationError::SlippageExceeded {
            expected: expected_out,
            actual: actual_out,
        })
    }
}

/// Checks that price impact doesn't exceed the maximum.
pub fn check_price_impact(amount_in: u64, reserve_in: u64, reserve_out: u64, max_bps: u64) -> Result<(), ValidationError> {
    if reserve_in == 0 || reserve_out == 0 {
        return Err(ValidationError::PoolInactive);
    }
    // Price impact = amount_in / (reserve_in + amount_in) in bps
    let numerator = (amount_in as u128) * (BPS as u128);
    let denominator = (reserve_in as u128) + (amount_in as u128);
    let impact_bps = (numerator / denominator) as u64;
    if impact_bps <= max_bps {
        Ok(())
    } else {
        Err(ValidationError::PriceImpactTooHigh {
            impact_bps,
            max_bps,
        })
    }
}

/// Checks that the transaction deadline has not expired.
pub fn check_deadline(deadline: u64, now: u64, buffer_ms: u64) -> Result<(), ValidationError> {
    if deadline >= now + buffer_ms {
        Ok(())
    } else {
        Err(ValidationError::DeadlineExpired { deadline, now })
    }
}

/// Checks that the nonce matches expected value.
pub fn check_nonce(expected: u64, actual: u64) -> Result<(), ValidationError> {
    if actual == expected {
        Ok(())
    } else {
        Err(ValidationError::InvalidNonce { expected, actual })
    }
}

/// Checks that amount falls within [min, max] bounds.
pub fn check_amount_bounds(amount: u64, min: u64, max: u64) -> Result<(), ValidationError> {
    if amount < min {
        Err(ValidationError::AmountTooSmall { min, actual: amount })
    } else if amount > max {
        Err(ValidationError::AmountTooLarge { max, actual: amount })
    } else {
        Ok(())
    }
}

/// Checks that the circuit breaker is not active.
pub fn check_circuit_breaker(active: bool) -> Result<(), ValidationError> {
    if active {
        Err(ValidationError::CircuitBreakerActive)
    } else {
        Ok(())
    }
}

/// Checks that rate limit allows the required amount.
pub fn check_rate_limit(remaining: u64, required: u64) -> Result<(), ValidationError> {
    if remaining >= required {
        Ok(())
    } else {
        let deficit = required - remaining;
        // Estimate retry time: 1ms per unit of deficit (simplified)
        Err(ValidationError::RateLimited {
            retry_after_ms: deficit.max(1000),
        })
    }
}

/// Checks address and token whitelist status.
pub fn check_whitelist(address_ok: bool, token_ok: bool) -> Result<(), ValidationError> {
    if !address_ok {
        Err(ValidationError::AddressBlocked)
    } else if !token_ok {
        Err(ValidationError::TokenNotWhitelisted)
    } else {
        Ok(())
    }
}

/// Checks that the pool is active.
pub fn check_pool_status(active: bool) -> Result<(), ValidationError> {
    if active {
        Ok(())
    } else {
        Err(ValidationError::PoolInactive)
    }
}

// ============ CKB Cell Validation ============

/// Validates that a cell output has sufficient capacity for its data size.
/// CKB rule: capacity >= (data_size + 61) * SHANNONS_PER_BYTE (61 bytes for minimal cell overhead).
pub fn validate_cell_capacity(output: &CellOutput) -> Result<(), ValidationError> {
    let min_cap = minimum_capacity_for_output(output.data_size);
    if output.capacity >= min_cap {
        Ok(())
    } else {
        Err(ValidationError::CapacityInsufficient {
            required: min_cap,
            available: output.capacity,
        })
    }
}

/// Validates that total output capacity does not exceed total input capacity.
pub fn validate_capacity_balance(inputs: &[CellInput], outputs: &[CellOutput]) -> Result<(), ValidationError> {
    let total_in = total_input_capacity(inputs);
    let total_out = total_output_capacity(outputs);
    if total_out <= total_in {
        Ok(())
    } else {
        Err(ValidationError::OutputOverflow)
    }
}

/// Validates that all inputs and outputs with type scripts match the expected type hash.
pub fn validate_type_scripts(
    inputs: &[CellInput],
    outputs: &[CellOutput],
    expected: &[u8; 32],
) -> Result<(), ValidationError> {
    for inp in inputs {
        if let Some(ref th) = inp.type_hash {
            if th != expected {
                return Err(ValidationError::TypeScriptMismatch);
            }
        }
    }
    for out in outputs {
        if let Some(ref th) = out.type_hash {
            if th != expected {
                return Err(ValidationError::TypeScriptMismatch);
            }
        }
    }
    Ok(())
}

/// Validates that all input lock scripts match the sender.
pub fn validate_lock_scripts(inputs: &[CellInput], sender: &[u8; 32]) -> Result<(), ValidationError> {
    for inp in inputs {
        if &inp.lock_hash != sender {
            return Err(ValidationError::LockScriptMismatch);
        }
    }
    Ok(())
}

/// Returns the total capacity of all inputs.
pub fn total_input_capacity(inputs: &[CellInput]) -> u64 {
    inputs.iter().map(|i| i.capacity).sum()
}

/// Returns the total capacity of all outputs.
pub fn total_output_capacity(outputs: &[CellOutput]) -> u64 {
    outputs.iter().map(|o| o.capacity).sum()
}

/// Returns the capacity fee (input - output), i.e. the miner fee.
pub fn capacity_fee(inputs: &[CellInput], outputs: &[CellOutput]) -> u64 {
    let total_in = total_input_capacity(inputs);
    let total_out = total_output_capacity(outputs);
    total_in.saturating_sub(total_out)
}

// ============ Invariant Checks ============

/// Checks that k = reserve_a * reserve_b has not decreased after a swap.
pub fn check_k_invariant(
    reserve_a_before: u64,
    reserve_b_before: u64,
    reserve_a_after: u64,
    reserve_b_after: u64,
) -> Result<(), ValidationError> {
    let k_before = (reserve_a_before as u128) * (reserve_b_before as u128);
    let k_after = (reserve_a_after as u128) * (reserve_b_after as u128);
    if k_after >= k_before {
        Ok(())
    } else {
        Err(ValidationError::InvariantViolation(
            format!("k decreased: {} -> {}", k_before, k_after),
        ))
    }
}

/// Checks that total_in == total_out + fees (supply conservation).
pub fn check_supply_conservation(total_in: u64, total_out: u64, fees: u64) -> Result<(), ValidationError> {
    if total_in == total_out + fees {
        Ok(())
    } else {
        Err(ValidationError::InvariantViolation(
            format!(
                "supply mismatch: in={} out={} fees={} (expected in == out + fees)",
                total_in, total_out, fees
            ),
        ))
    }
}

/// Checks that a price is within max_deviation_bps of the oracle price.
pub fn check_price_bounds(
    price: u64,
    oracle_price: u64,
    max_deviation_bps: u64,
) -> Result<(), ValidationError> {
    if oracle_price == 0 {
        return Err(ValidationError::InvariantViolation(
            "oracle price is zero".to_string(),
        ));
    }
    let diff = if price > oracle_price {
        price - oracle_price
    } else {
        oracle_price - price
    };
    let deviation_bps = (diff as u128) * (BPS as u128) / (oracle_price as u128);
    if deviation_bps <= max_deviation_bps as u128 {
        Ok(())
    } else {
        Err(ValidationError::PriceImpactTooHigh {
            impact_bps: deviation_bps as u64,
            max_bps: max_deviation_bps,
        })
    }
}

// ============ Duplicate Detection ============

/// Computes a sha256 hash of the transaction for duplicate detection.
pub fn compute_tx_hash(tx: &TxInput) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(&tx.sender);
    hasher.update(&tx.nonce.to_le_bytes());
    hasher.update(&tx.amount_in.to_le_bytes());
    hasher.update(&tx.amount_out_min.to_le_bytes());
    hasher.update(&tx.deadline.to_le_bytes());
    hasher.update(&tx.signature);
    let result = hasher.finalize();
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&result);
    hash
}

/// Checks if a tx hash is a duplicate by checking against recent hashes.
pub fn is_duplicate(tx_hash: &[u8; 32], recent_hashes: &[[u8; 32]]) -> bool {
    recent_hashes.iter().any(|h| h == tx_hash)
}

/// Adds a tx hash to the seen list, evicting oldest if at max capacity.
pub fn add_to_seen(recent: &mut Vec<[u8; 32]>, tx_hash: [u8; 32], max_size: usize) {
    if recent.len() >= max_size {
        recent.remove(0);
    }
    recent.push(tx_hash);
}

// ============ Estimation ============

/// Estimates gas cost based on tx type and cell count.
pub fn estimate_gas(tx: &TxInput) -> u64 {
    let type_multiplier: u64 = match tx.tx_type {
        TxType::Swap => 2,
        TxType::AddLiquidity => 3,
        TxType::RemoveLiquidity => 3,
        TxType::Stake => 2,
        TxType::Unstake => 2,
        TxType::Commit => 1,
        TxType::Reveal => 2,
        TxType::Claim => 1,
        TxType::GovernanceVote => 1,
        TxType::BridgeTransfer => 4,
        TxType::ConfigUpdate => 1,
    };
    let input_cost = (tx.inputs.len() as u64) * GAS_PER_INPUT;
    let output_cost = (tx.outputs.len() as u64) * GAS_PER_OUTPUT;
    BASE_GAS * type_multiplier + input_cost + output_cost
}

/// Estimates output amount for a swap given reserves and fee (for slippage preview).
/// Uses constant product formula: out = (amount_in * (BPS - fee_bps) * reserve_out) / (reserve_in * BPS + amount_in * (BPS - fee_bps))
pub fn estimate_output_amount(amount_in: u64, reserve_in: u64, reserve_out: u64, fee_bps: u64) -> u64 {
    if reserve_in == 0 || reserve_out == 0 || fee_bps >= BPS {
        return 0;
    }
    let amount_in_with_fee = (amount_in as u128) * ((BPS - fee_bps) as u128);
    let numerator = amount_in_with_fee * (reserve_out as u128);
    let denominator = (reserve_in as u128) * (BPS as u128) + amount_in_with_fee;
    if denominator == 0 {
        return 0;
    }
    (numerator / denominator) as u64
}

/// Returns the minimum CKB capacity required for a cell output with given data size.
/// CKB formula: (61 + data_size) * 10^8 shannons.
pub fn minimum_capacity_for_output(data_size: u64) -> u64 {
    (61 + data_size) * SHANNONS_PER_BYTE
}

// ============ Full Validation Pipeline ============

/// Helper: run common pre-checks shared by all tx types.
fn run_common_checks(
    tx: &TxInput,
    ctx: &ValidationContext,
    config: &ValidatorConfig,
    errors: &mut Vec<ValidationError>,
    warnings: &mut Vec<String>,
    checks: &mut u32,
) {
    // Balance
    if let Err(e) = check_balance(tx.amount_in, ctx.sender_balance) {
        errors.push(e);
    }
    *checks += 1;

    // Nonce
    if let Err(e) = check_nonce(ctx.sender_nonce, tx.nonce) {
        errors.push(e);
    }
    *checks += 1;

    // Circuit breaker
    if let Err(e) = check_circuit_breaker(ctx.circuit_breaker_active) {
        errors.push(e);
    }
    *checks += 1;

    // Rate limit
    if let Err(e) = check_rate_limit(ctx.rate_limit_remaining, tx.amount_in) {
        errors.push(e);
    }
    *checks += 1;

    // Whitelist
    if let Err(e) = check_whitelist(ctx.address_whitelisted, ctx.token_whitelisted) {
        errors.push(e);
    }
    *checks += 1;

    // Amount bounds
    if let Err(e) = check_amount_bounds(tx.amount_in, config.min_amount, config.max_amount) {
        errors.push(e);
    }
    *checks += 1;

    // Deadline
    if let Err(e) = check_deadline(tx.deadline, ctx.current_time, config.deadline_buffer_ms) {
        errors.push(e);
    }
    *checks += 1;

    // Cell capacity validation
    for output in &tx.outputs {
        if let Err(e) = validate_cell_capacity(output) {
            errors.push(e);
        }
        *checks += 1;
    }

    // Capacity balance
    if !tx.inputs.is_empty() && !tx.outputs.is_empty() {
        if let Err(e) = validate_capacity_balance(&tx.inputs, &tx.outputs) {
            errors.push(e);
        }
        *checks += 1;
    }

    // Lock script validation
    if !tx.inputs.is_empty() {
        if let Err(e) = validate_lock_scripts(&tx.inputs, &tx.sender) {
            errors.push(e);
        }
        *checks += 1;
    }

}

/// Build a ValidationReport from collected errors/warnings.
/// If strict_mode is true, warnings are promoted to errors.
fn build_report(
    tx_type: TxType,
    mut errors: Vec<ValidationError>,
    warnings: Vec<String>,
    gas: u64,
    validated_at: u64,
    checks: u32,
    strict_mode: bool,
) -> ValidationReport {
    if strict_mode && !warnings.is_empty() {
        for w in &warnings {
            errors.push(ValidationError::InvariantViolation(w.clone()));
        }
    }
    let result = if errors.is_empty() {
        ValidationResult::Valid
    } else {
        ValidationResult::Invalid(errors.clone())
    };
    ValidationReport {
        tx_type,
        result,
        errors,
        warnings,
        gas_estimate: gas,
        validated_at,
        checks_performed: checks,
    }
}

/// Validates a transaction by dispatching to the appropriate type-specific validator.
pub fn validate_transaction(
    tx: &TxInput,
    ctx: &ValidationContext,
    config: &ValidatorConfig,
) -> ValidationReport {
    match tx.tx_type {
        TxType::Swap => validate_swap(tx, ctx, config),
        TxType::AddLiquidity => validate_add_liquidity(tx, ctx, config),
        TxType::RemoveLiquidity => validate_remove_liquidity(tx, ctx, config),
        TxType::Commit => validate_commit(tx, ctx, config),
        TxType::Reveal => validate_reveal(tx, ctx, config),
        _ => {
            // Generic validation for types without specific pipeline
            let mut errors = Vec::new();
            let mut warnings = Vec::new();
            let mut checks = 0u32;
            run_common_checks(tx, ctx, config, &mut errors, &mut warnings, &mut checks);
            let gas = estimate_gas(tx);
            build_report(tx.tx_type.clone(), errors, warnings, gas, ctx.current_time, checks, config.strict_mode)
        }
    }
}

/// Validates a swap transaction including slippage and price impact checks.
pub fn validate_swap(
    tx: &TxInput,
    ctx: &ValidationContext,
    config: &ValidatorConfig,
) -> ValidationReport {
    let mut errors = Vec::new();
    let mut warnings = Vec::new();
    let mut checks = 0u32;

    run_common_checks(tx, ctx, config, &mut errors, &mut warnings, &mut checks);

    // Pool status
    if let Err(e) = check_pool_status(ctx.pool_active) {
        errors.push(e);
    }
    checks += 1;

    // Price impact
    if ctx.pool_reserve_a > 0 && ctx.pool_reserve_b > 0 {
        if let Err(e) = check_price_impact(
            tx.amount_in,
            ctx.pool_reserve_a,
            ctx.pool_reserve_b,
            config.max_price_impact_bps,
        ) {
            errors.push(e);
        }
        checks += 1;

        // Slippage check — estimate output and compare to min
        let estimated_out = estimate_output_amount(tx.amount_in, ctx.pool_reserve_a, ctx.pool_reserve_b, 30);
        if estimated_out < tx.amount_out_min && tx.amount_out_min > 0 {
            errors.push(ValidationError::SlippageExceeded {
                expected: tx.amount_out_min,
                actual: estimated_out,
            });
        }
        checks += 1;

        // Warn if output is close to minimum
        if estimated_out > 0 && tx.amount_out_min > 0 {
            let margin_bps = ((estimated_out as u128 - tx.amount_out_min.min(estimated_out) as u128) * BPS as u128)
                / estimated_out as u128;
            if margin_bps < 50 {
                warnings.push("output very close to slippage minimum".to_string());
            }
        }
    }

    let gas = estimate_gas(tx);
    build_report(TxType::Swap, errors, warnings, gas, ctx.current_time, checks, config.strict_mode)
}

/// Validates an add-liquidity transaction.
pub fn validate_add_liquidity(
    tx: &TxInput,
    ctx: &ValidationContext,
    config: &ValidatorConfig,
) -> ValidationReport {
    let mut errors = Vec::new();
    let mut warnings = Vec::new();
    let mut checks = 0u32;

    run_common_checks(tx, ctx, config, &mut errors, &mut warnings, &mut checks);

    // Pool status
    if let Err(e) = check_pool_status(ctx.pool_active) {
        errors.push(e);
    }
    checks += 1;

    // For add liquidity, amount_out_min represents minimum LP tokens
    if tx.amount_out_min == 0 {
        warnings.push("no minimum LP tokens specified".to_string());
    }
    checks += 1;

    // Warn if pool is empty (first deposit)
    if ctx.pool_reserve_a == 0 && ctx.pool_reserve_b == 0 {
        warnings.push("pool is empty — this is the initial deposit".to_string());
    }

    let gas = estimate_gas(tx);
    build_report(TxType::AddLiquidity, errors, warnings, gas, ctx.current_time, checks, config.strict_mode)
}

/// Validates a remove-liquidity transaction.
pub fn validate_remove_liquidity(
    tx: &TxInput,
    ctx: &ValidationContext,
    config: &ValidatorConfig,
) -> ValidationReport {
    let mut errors = Vec::new();
    let mut warnings = Vec::new();
    let mut checks = 0u32;

    run_common_checks(tx, ctx, config, &mut errors, &mut warnings, &mut checks);

    // Pool status
    if let Err(e) = check_pool_status(ctx.pool_active) {
        errors.push(e);
    }
    checks += 1;

    // Cannot remove from empty pool
    if ctx.pool_reserve_a == 0 || ctx.pool_reserve_b == 0 {
        errors.push(ValidationError::PoolInactive);
    }
    checks += 1;

    let gas = estimate_gas(tx);
    build_report(TxType::RemoveLiquidity, errors, warnings, gas, ctx.current_time, checks, config.strict_mode)
}

/// Validates a commit transaction (commit-reveal auction).
pub fn validate_commit(
    tx: &TxInput,
    ctx: &ValidationContext,
    config: &ValidatorConfig,
) -> ValidationReport {
    let mut errors = Vec::new();
    let mut warnings = Vec::new();
    let mut checks = 0u32;

    run_common_checks(tx, ctx, config, &mut errors, &mut warnings, &mut checks);

    // Commit must have at least one cell dep (the auction cell)
    if tx.cell_deps.is_empty() {
        errors.push(ValidationError::InvalidCellData);
    }
    checks += 1;

    // Signature must not be all zeros (basic sanity)
    if tx.signature == [0u8; 64] {
        errors.push(ValidationError::InvalidSignature);
    }
    checks += 1;

    let gas = estimate_gas(tx);
    build_report(TxType::Commit, errors, warnings, gas, ctx.current_time, checks, config.strict_mode)
}

/// Validates a reveal transaction (commit-reveal auction).
pub fn validate_reveal(
    tx: &TxInput,
    ctx: &ValidationContext,
    config: &ValidatorConfig,
) -> ValidationReport {
    let mut errors = Vec::new();
    let mut warnings = Vec::new();
    let mut checks = 0u32;

    run_common_checks(tx, ctx, config, &mut errors, &mut warnings, &mut checks);

    // Reveal must reference a commit (at least one cell dep)
    if tx.cell_deps.is_empty() {
        errors.push(ValidationError::InvalidCellData);
    }
    checks += 1;

    // Signature must not be all zeros
    if tx.signature == [0u8; 64] {
        errors.push(ValidationError::InvalidSignature);
    }
    checks += 1;

    // Pool should be active for reveal
    if let Err(e) = check_pool_status(ctx.pool_active) {
        errors.push(e);
    }
    checks += 1;

    let gas = estimate_gas(tx);
    build_report(TxType::Reveal, errors, warnings, gas, ctx.current_time, checks, config.strict_mode)
}

// ============ Batch Validation ============

/// Validates a batch of transactions, returning a report for each.
pub fn validate_batch(
    txs: &[TxInput],
    ctx: &ValidationContext,
    config: &ValidatorConfig,
) -> Vec<ValidationReport> {
    txs.iter().map(|tx| validate_transaction(tx, ctx, config)).collect()
}

/// Returns the count of valid transactions in a batch of reports.
pub fn batch_valid_count(reports: &[ValidationReport]) -> usize {
    reports.iter().filter(|r| is_valid(r)).count()
}

/// Returns a summary of error types and their counts from a batch of reports.
pub fn batch_error_summary(reports: &[ValidationReport]) -> Vec<(ValidationError, usize)> {
    let mut counts: Vec<(ValidationError, usize)> = Vec::new();
    for report in reports {
        for err in &report.errors {
            if let Some(entry) = counts.iter_mut().find(|(e, _)| e == err) {
                entry.1 += 1;
            } else {
                counts.push((err.clone(), 1));
            }
        }
    }
    counts.sort_by(|a, b| b.1.cmp(&a.1));
    counts
}

// ============ Report Analysis ============

/// Returns true if the report indicates a valid transaction.
pub fn is_valid(report: &ValidationReport) -> bool {
    matches!(report.result, ValidationResult::Valid)
}

/// Returns the number of errors in a report.
pub fn error_count(report: &ValidationReport) -> usize {
    report.errors.len()
}

/// Checks if a report contains a specific error type (by discriminant match).
pub fn has_error_type(report: &ValidationReport, error: &ValidationError) -> bool {
    report.errors.iter().any(|e| {
        std::mem::discriminant(e) == std::mem::discriminant(error)
    })
}

/// Returns the most common error across a slice of reports.
pub fn most_common_error(reports: &[ValidationReport]) -> Option<ValidationError> {
    let summary = batch_error_summary(reports);
    summary.into_iter().next().map(|(e, _)| e)
}

/// Returns the success rate as basis points (valid / total * 10000).
pub fn validation_success_rate(reports: &[ValidationReport]) -> u64 {
    if reports.is_empty() {
        return 0;
    }
    let valid = batch_valid_count(reports) as u64;
    let total = reports.len() as u64;
    valid * BPS / total
}

// ============ Utility ============

/// Merges multiple validation reports into a single combined report.
pub fn merge_reports(reports: &[ValidationReport]) -> ValidationReport {
    if reports.is_empty() {
        return ValidationReport {
            tx_type: TxType::Swap,
            result: ValidationResult::Valid,
            errors: Vec::new(),
            warnings: Vec::new(),
            gas_estimate: 0,
            validated_at: 0,
            checks_performed: 0,
        };
    }

    let mut all_errors = Vec::new();
    let mut all_warnings = Vec::new();
    let mut total_gas = 0u64;
    let mut total_checks = 0u32;
    let mut latest_time = 0u64;

    for r in reports {
        all_errors.extend(r.errors.clone());
        all_warnings.extend(r.warnings.clone());
        total_gas += r.gas_estimate;
        total_checks += r.checks_performed;
        if r.validated_at > latest_time {
            latest_time = r.validated_at;
        }
    }

    let result = if all_errors.is_empty() {
        ValidationResult::Valid
    } else {
        ValidationResult::Invalid(all_errors.clone())
    };

    ValidationReport {
        tx_type: reports[0].tx_type.clone(),
        result,
        errors: all_errors,
        warnings: all_warnings,
        gas_estimate: total_gas,
        validated_at: latest_time,
        checks_performed: total_checks,
    }
}

/// Scores the severity of a list of errors on a 0-10000 scale.
pub fn severity_score(errors: &[ValidationError]) -> u64 {
    if errors.is_empty() {
        return 0;
    }
    let mut score: u64 = 0;
    for err in errors {
        let s = match err {
            ValidationError::CircuitBreakerActive => 10000,
            ValidationError::AddressBlocked => 10000,
            ValidationError::InvalidSignature => 9000,
            ValidationError::OutputOverflow => 9000,
            ValidationError::InvariantViolation(_) => 8000,
            ValidationError::InsufficientBalance { .. } => 7000,
            ValidationError::CapacityInsufficient { .. } => 7000,
            ValidationError::TypeScriptMismatch => 7000,
            ValidationError::LockScriptMismatch => 7000,
            ValidationError::InvalidCellData => 6000,
            ValidationError::DuplicateTransaction => 5000,
            ValidationError::InvalidNonce { .. } => 5000,
            ValidationError::PoolInactive => 5000,
            ValidationError::TokenNotWhitelisted => 4000,
            ValidationError::RateLimited { .. } => 3000,
            ValidationError::DeadlineExpired { .. } => 3000,
            ValidationError::PriceImpactTooHigh { .. } => 2000,
            ValidationError::SlippageExceeded { .. } => 2000,
            ValidationError::AmountTooSmall { .. } => 1000,
            ValidationError::AmountTooLarge { .. } => 1000,
        };
        if s > score {
            score = s;
        }
    }
    score
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // ============ Test Helpers ============

    fn test_sender() -> [u8; 32] {
        [1u8; 32]
    }

    fn test_pool_id() -> [u8; 32] {
        [2u8; 32]
    }

    fn test_signature() -> [u8; 64] {
        [0xAB; 64]
    }

    fn zero_signature() -> [u8; 64] {
        [0u8; 64]
    }

    fn test_type_hash() -> [u8; 32] {
        [3u8; 32]
    }

    fn make_cell_input(capacity: u64, sender: [u8; 32]) -> CellInput {
        CellInput {
            out_point: [0u8; 32],
            capacity,
            lock_hash: sender,
            type_hash: None,
            data_hash: [0u8; 32],
        }
    }

    fn make_cell_input_typed(capacity: u64, sender: [u8; 32], type_hash: [u8; 32]) -> CellInput {
        CellInput {
            out_point: [0u8; 32],
            capacity,
            lock_hash: sender,
            type_hash: Some(type_hash),
            data_hash: [0u8; 32],
        }
    }

    fn make_cell_output(capacity: u64, data_size: u64) -> CellOutput {
        CellOutput {
            capacity,
            lock_hash: test_sender(),
            type_hash: None,
            data_size,
        }
    }

    fn make_cell_output_typed(capacity: u64, data_size: u64, type_hash: [u8; 32]) -> CellOutput {
        CellOutput {
            capacity,
            lock_hash: test_sender(),
            type_hash: Some(type_hash),
            data_size,
        }
    }

    fn make_tx(tx_type: TxType, amount_in: u64) -> TxInput {
        TxInput {
            tx_type,
            sender: test_sender(),
            pool_id: Some(test_pool_id()),
            amount_in,
            amount_out_min: 0,
            deadline: 200_000,
            nonce: 5,
            signature: test_signature(),
            cell_deps: vec![[4u8; 32]],
            inputs: vec![make_cell_input(100_000_000_000, test_sender())],
            outputs: vec![make_cell_output(90_000_000_000, 100)],
        }
    }

    fn make_valid_ctx() -> ValidationContext {
        ValidationContext {
            current_time: 100_000,
            block_height: 500,
            sender_balance: 1_000_000,
            sender_nonce: 5,
            pool_reserve_a: 10_000_000,
            pool_reserve_b: 10_000_000,
            pool_active: true,
            circuit_breaker_active: false,
            address_whitelisted: true,
            token_whitelisted: true,
            rate_limit_remaining: 5_000_000,
            oracle_price: 10_000,
            max_price_impact_bps: 300,
        }
    }

    fn make_config() -> ValidatorConfig {
        default_validator_config()
    }

    // ============ Config Tests ============

    #[test]
    fn test_default_config_values() {
        let c = default_validator_config();
        assert_eq!(c.max_slippage_bps, 100);
        assert_eq!(c.max_price_impact_bps, 300);
        assert_eq!(c.min_amount, 1_000);
        assert_eq!(c.max_amount, 1_000_000_000_000);
        assert_eq!(c.deadline_buffer_ms, 30_000);
        assert!(!c.strict_mode);
        assert_eq!(c.duplicate_window_ms, 60_000);
    }

    #[test]
    fn test_strict_config_values() {
        let c = strict_config();
        assert_eq!(c.max_slippage_bps, 50);
        assert_eq!(c.max_price_impact_bps, 100);
        assert_eq!(c.min_amount, 10_000);
        assert!(c.strict_mode);
    }

    #[test]
    fn test_validate_config_valid() {
        assert!(validate_config(&default_validator_config()));
        assert!(validate_config(&strict_config()));
    }

    #[test]
    fn test_validate_config_zero_slippage() {
        let mut c = default_validator_config();
        c.max_slippage_bps = 0;
        assert!(!validate_config(&c));
    }

    #[test]
    fn test_validate_config_slippage_over_bps() {
        let mut c = default_validator_config();
        c.max_slippage_bps = BPS + 1;
        assert!(!validate_config(&c));
    }

    #[test]
    fn test_validate_config_zero_price_impact() {
        let mut c = default_validator_config();
        c.max_price_impact_bps = 0;
        assert!(!validate_config(&c));
    }

    #[test]
    fn test_validate_config_min_greater_than_max() {
        let mut c = default_validator_config();
        c.min_amount = 1_000_000;
        c.max_amount = 999;
        assert!(!validate_config(&c));
    }

    #[test]
    fn test_validate_config_zero_min_amount() {
        let mut c = default_validator_config();
        c.min_amount = 0;
        assert!(!validate_config(&c));
    }

    #[test]
    fn test_validate_config_zero_deadline_buffer() {
        let mut c = default_validator_config();
        c.deadline_buffer_ms = 0;
        assert!(!validate_config(&c));
    }

    #[test]
    fn test_validate_config_zero_duplicate_window() {
        let mut c = default_validator_config();
        c.duplicate_window_ms = 0;
        assert!(!validate_config(&c));
    }

    // ============ Balance Check Tests ============

    #[test]
    fn test_check_balance_sufficient() {
        assert!(check_balance(100, 200).is_ok());
    }

    #[test]
    fn test_check_balance_exact() {
        assert!(check_balance(100, 100).is_ok());
    }

    #[test]
    fn test_check_balance_insufficient() {
        let err = check_balance(200, 100).unwrap_err();
        assert_eq!(err, ValidationError::InsufficientBalance { required: 200, available: 100 });
    }

    #[test]
    fn test_check_balance_zero_required() {
        assert!(check_balance(0, 100).is_ok());
    }

    #[test]
    fn test_check_balance_both_zero() {
        assert!(check_balance(0, 0).is_ok());
    }

    // ============ Slippage Check Tests ============

    #[test]
    fn test_check_slippage_ok() {
        assert!(check_slippage(100, 95, 98).is_ok());
    }

    #[test]
    fn test_check_slippage_exact_min() {
        assert!(check_slippage(100, 95, 95).is_ok());
    }

    #[test]
    fn test_check_slippage_exceeded() {
        let err = check_slippage(100, 95, 90).unwrap_err();
        assert_eq!(err, ValidationError::SlippageExceeded { expected: 100, actual: 90 });
    }

    #[test]
    fn test_check_slippage_zero_min_always_passes() {
        assert!(check_slippage(100, 0, 0).is_ok());
    }

    #[test]
    fn test_check_slippage_above_expected() {
        assert!(check_slippage(100, 95, 110).is_ok());
    }

    // ============ Price Impact Check Tests ============

    #[test]
    fn test_check_price_impact_small() {
        // 100 into 10000 reserve = ~1% impact (99 bps)
        assert!(check_price_impact(100, 10_000, 10_000, 300).is_ok());
    }

    #[test]
    fn test_check_price_impact_too_high() {
        // 5000 into 10000 reserve = ~33% impact
        let err = check_price_impact(5000, 10_000, 10_000, 300).unwrap_err();
        match err {
            ValidationError::PriceImpactTooHigh { impact_bps, max_bps } => {
                assert!(impact_bps > 300);
                assert_eq!(max_bps, 300);
            }
            _ => panic!("wrong error type"),
        }
    }

    #[test]
    fn test_check_price_impact_zero_reserve_in() {
        let err = check_price_impact(100, 0, 10_000, 300).unwrap_err();
        assert_eq!(err, ValidationError::PoolInactive);
    }

    #[test]
    fn test_check_price_impact_zero_reserve_out() {
        let err = check_price_impact(100, 10_000, 0, 300).unwrap_err();
        assert_eq!(err, ValidationError::PoolInactive);
    }

    #[test]
    fn test_check_price_impact_at_boundary() {
        // amount / (reserve + amount) * 10000 = bps
        // 300 bps = 3% => amount = 0.03 * reserve / (1 - 0.03) ≈ 309
        // 309 / (10000 + 309) = 2.998% ≈ 299 bps
        assert!(check_price_impact(309, 10_000, 10_000, 300).is_ok());
    }

    // ============ Deadline Check Tests ============

    #[test]
    fn test_check_deadline_valid() {
        assert!(check_deadline(200_000, 100_000, 30_000).is_ok());
    }

    #[test]
    fn test_check_deadline_expired() {
        let err = check_deadline(100_000, 100_000, 30_000).unwrap_err();
        assert_eq!(err, ValidationError::DeadlineExpired { deadline: 100_000, now: 100_000 });
    }

    #[test]
    fn test_check_deadline_exactly_at_buffer() {
        // deadline = now + buffer => passes
        assert!(check_deadline(130_000, 100_000, 30_000).is_ok());
    }

    #[test]
    fn test_check_deadline_just_under_buffer() {
        let err = check_deadline(129_999, 100_000, 30_000).unwrap_err();
        assert_eq!(err, ValidationError::DeadlineExpired { deadline: 129_999, now: 100_000 });
    }

    #[test]
    fn test_check_deadline_zero_buffer() {
        assert!(check_deadline(100_001, 100_000, 0).is_ok());
    }

    // ============ Nonce Check Tests ============

    #[test]
    fn test_check_nonce_match() {
        assert!(check_nonce(5, 5).is_ok());
    }

    #[test]
    fn test_check_nonce_mismatch_low() {
        let err = check_nonce(5, 4).unwrap_err();
        assert_eq!(err, ValidationError::InvalidNonce { expected: 5, actual: 4 });
    }

    #[test]
    fn test_check_nonce_mismatch_high() {
        let err = check_nonce(5, 6).unwrap_err();
        assert_eq!(err, ValidationError::InvalidNonce { expected: 5, actual: 6 });
    }

    #[test]
    fn test_check_nonce_zero() {
        assert!(check_nonce(0, 0).is_ok());
    }

    // ============ Amount Bounds Check Tests ============

    #[test]
    fn test_check_amount_bounds_within() {
        assert!(check_amount_bounds(500, 100, 1000).is_ok());
    }

    #[test]
    fn test_check_amount_bounds_at_min() {
        assert!(check_amount_bounds(100, 100, 1000).is_ok());
    }

    #[test]
    fn test_check_amount_bounds_at_max() {
        assert!(check_amount_bounds(1000, 100, 1000).is_ok());
    }

    #[test]
    fn test_check_amount_bounds_below_min() {
        let err = check_amount_bounds(50, 100, 1000).unwrap_err();
        assert_eq!(err, ValidationError::AmountTooSmall { min: 100, actual: 50 });
    }

    #[test]
    fn test_check_amount_bounds_above_max() {
        let err = check_amount_bounds(2000, 100, 1000).unwrap_err();
        assert_eq!(err, ValidationError::AmountTooLarge { max: 1000, actual: 2000 });
    }

    // ============ Circuit Breaker Check Tests ============

    #[test]
    fn test_check_circuit_breaker_inactive() {
        assert!(check_circuit_breaker(false).is_ok());
    }

    #[test]
    fn test_check_circuit_breaker_active() {
        let err = check_circuit_breaker(true).unwrap_err();
        assert_eq!(err, ValidationError::CircuitBreakerActive);
    }

    // ============ Rate Limit Check Tests ============

    #[test]
    fn test_check_rate_limit_ok() {
        assert!(check_rate_limit(1000, 500).is_ok());
    }

    #[test]
    fn test_check_rate_limit_exact() {
        assert!(check_rate_limit(500, 500).is_ok());
    }

    #[test]
    fn test_check_rate_limit_exceeded() {
        let err = check_rate_limit(100, 500).unwrap_err();
        match err {
            ValidationError::RateLimited { retry_after_ms } => {
                assert!(retry_after_ms >= 400);
            }
            _ => panic!("wrong error type"),
        }
    }

    #[test]
    fn test_check_rate_limit_zero_remaining() {
        let err = check_rate_limit(0, 100).unwrap_err();
        match err {
            ValidationError::RateLimited { retry_after_ms } => {
                assert!(retry_after_ms >= 100);
            }
            _ => panic!("wrong error type"),
        }
    }

    // ============ Whitelist Check Tests ============

    #[test]
    fn test_check_whitelist_both_ok() {
        assert!(check_whitelist(true, true).is_ok());
    }

    #[test]
    fn test_check_whitelist_address_blocked() {
        let err = check_whitelist(false, true).unwrap_err();
        assert_eq!(err, ValidationError::AddressBlocked);
    }

    #[test]
    fn test_check_whitelist_token_not_whitelisted() {
        let err = check_whitelist(true, false).unwrap_err();
        assert_eq!(err, ValidationError::TokenNotWhitelisted);
    }

    #[test]
    fn test_check_whitelist_both_bad_returns_address() {
        // Address check comes first
        let err = check_whitelist(false, false).unwrap_err();
        assert_eq!(err, ValidationError::AddressBlocked);
    }

    // ============ Pool Status Check Tests ============

    #[test]
    fn test_check_pool_status_active() {
        assert!(check_pool_status(true).is_ok());
    }

    #[test]
    fn test_check_pool_status_inactive() {
        let err = check_pool_status(false).unwrap_err();
        assert_eq!(err, ValidationError::PoolInactive);
    }

    // ============ Cell Capacity Validation Tests ============

    #[test]
    fn test_validate_cell_capacity_sufficient() {
        let output = make_cell_output(10_000_000_000, 39); // (61+39)*10^8 = 10_000_000_000
        assert!(validate_cell_capacity(&output).is_ok());
    }

    #[test]
    fn test_validate_cell_capacity_insufficient() {
        let output = make_cell_output(1_000_000_000, 100); // needs (61+100)*10^8 = 16_100_000_000
        let err = validate_cell_capacity(&output).unwrap_err();
        match err {
            ValidationError::CapacityInsufficient { required, available } => {
                assert_eq!(required, 16_100_000_000);
                assert_eq!(available, 1_000_000_000);
            }
            _ => panic!("wrong error type"),
        }
    }

    #[test]
    fn test_validate_cell_capacity_zero_data() {
        let output = make_cell_output(MIN_CELL_CAPACITY, 0);
        assert!(validate_cell_capacity(&output).is_ok());
    }

    #[test]
    fn test_validate_cell_capacity_exactly_min() {
        let output = make_cell_output(MIN_CELL_CAPACITY, 0);
        assert!(validate_cell_capacity(&output).is_ok());
    }

    #[test]
    fn test_validate_cell_capacity_one_under_min() {
        let output = make_cell_output(MIN_CELL_CAPACITY - 1, 0);
        assert!(validate_cell_capacity(&output).is_err());
    }

    // ============ Capacity Balance Tests ============

    #[test]
    fn test_validate_capacity_balance_ok() {
        let inputs = vec![make_cell_input(100, test_sender())];
        let outputs = vec![make_cell_output(90, 0)];
        assert!(validate_capacity_balance(&inputs, &outputs).is_ok());
    }

    #[test]
    fn test_validate_capacity_balance_exact() {
        let inputs = vec![make_cell_input(100, test_sender())];
        let outputs = vec![make_cell_output(100, 0)];
        assert!(validate_capacity_balance(&inputs, &outputs).is_ok());
    }

    #[test]
    fn test_validate_capacity_balance_overflow() {
        let inputs = vec![make_cell_input(100, test_sender())];
        let outputs = vec![make_cell_output(101, 0)];
        let err = validate_capacity_balance(&inputs, &outputs).unwrap_err();
        assert_eq!(err, ValidationError::OutputOverflow);
    }

    #[test]
    fn test_validate_capacity_balance_multi_inputs() {
        let inputs = vec![
            make_cell_input(50, test_sender()),
            make_cell_input(60, test_sender()),
        ];
        let outputs = vec![make_cell_output(100, 0)];
        assert!(validate_capacity_balance(&inputs, &outputs).is_ok());
    }

    #[test]
    fn test_validate_capacity_balance_multi_outputs() {
        let inputs = vec![make_cell_input(200, test_sender())];
        let outputs = vec![
            make_cell_output(100, 0),
            make_cell_output(100, 0),
        ];
        assert!(validate_capacity_balance(&inputs, &outputs).is_ok());
    }

    // ============ Type Script Validation Tests ============

    #[test]
    fn test_validate_type_scripts_match() {
        let th = test_type_hash();
        let inputs = vec![make_cell_input_typed(100, test_sender(), th)];
        let outputs = vec![make_cell_output_typed(90, 0, th)];
        assert!(validate_type_scripts(&inputs, &outputs, &th).is_ok());
    }

    #[test]
    fn test_validate_type_scripts_input_mismatch() {
        let th = test_type_hash();
        let bad = [9u8; 32];
        let inputs = vec![make_cell_input_typed(100, test_sender(), bad)];
        let outputs = vec![make_cell_output_typed(90, 0, th)];
        let err = validate_type_scripts(&inputs, &outputs, &th).unwrap_err();
        assert_eq!(err, ValidationError::TypeScriptMismatch);
    }

    #[test]
    fn test_validate_type_scripts_output_mismatch() {
        let th = test_type_hash();
        let bad = [9u8; 32];
        let inputs = vec![make_cell_input_typed(100, test_sender(), th)];
        let outputs = vec![make_cell_output_typed(90, 0, bad)];
        let err = validate_type_scripts(&inputs, &outputs, &th).unwrap_err();
        assert_eq!(err, ValidationError::TypeScriptMismatch);
    }

    #[test]
    fn test_validate_type_scripts_none_passes() {
        let th = test_type_hash();
        let inputs = vec![make_cell_input(100, test_sender())]; // type_hash = None
        let outputs = vec![make_cell_output(90, 0)]; // type_hash = None
        assert!(validate_type_scripts(&inputs, &outputs, &th).is_ok());
    }

    // ============ Lock Script Validation Tests ============

    #[test]
    fn test_validate_lock_scripts_match() {
        let sender = test_sender();
        let inputs = vec![make_cell_input(100, sender)];
        assert!(validate_lock_scripts(&inputs, &sender).is_ok());
    }

    #[test]
    fn test_validate_lock_scripts_mismatch() {
        let sender = test_sender();
        let other = [9u8; 32];
        let inputs = vec![make_cell_input(100, other)];
        let err = validate_lock_scripts(&inputs, &sender).unwrap_err();
        assert_eq!(err, ValidationError::LockScriptMismatch);
    }

    #[test]
    fn test_validate_lock_scripts_empty() {
        assert!(validate_lock_scripts(&[], &test_sender()).is_ok());
    }

    #[test]
    fn test_validate_lock_scripts_multi_all_match() {
        let sender = test_sender();
        let inputs = vec![
            make_cell_input(100, sender),
            make_cell_input(200, sender),
        ];
        assert!(validate_lock_scripts(&inputs, &sender).is_ok());
    }

    #[test]
    fn test_validate_lock_scripts_multi_one_mismatch() {
        let sender = test_sender();
        let other = [9u8; 32];
        let inputs = vec![
            make_cell_input(100, sender),
            make_cell_input(200, other),
        ];
        let err = validate_lock_scripts(&inputs, &sender).unwrap_err();
        assert_eq!(err, ValidationError::LockScriptMismatch);
    }

    // ============ Capacity Utility Tests ============

    #[test]
    fn test_total_input_capacity() {
        let inputs = vec![
            make_cell_input(100, test_sender()),
            make_cell_input(200, test_sender()),
        ];
        assert_eq!(total_input_capacity(&inputs), 300);
    }

    #[test]
    fn test_total_input_capacity_empty() {
        assert_eq!(total_input_capacity(&[]), 0);
    }

    #[test]
    fn test_total_output_capacity() {
        let outputs = vec![
            make_cell_output(100, 0),
            make_cell_output(200, 0),
        ];
        assert_eq!(total_output_capacity(&outputs), 300);
    }

    #[test]
    fn test_total_output_capacity_empty() {
        assert_eq!(total_output_capacity(&[]), 0);
    }

    #[test]
    fn test_capacity_fee_normal() {
        let inputs = vec![make_cell_input(1000, test_sender())];
        let outputs = vec![make_cell_output(900, 0)];
        assert_eq!(capacity_fee(&inputs, &outputs), 100);
    }

    #[test]
    fn test_capacity_fee_zero() {
        let inputs = vec![make_cell_input(1000, test_sender())];
        let outputs = vec![make_cell_output(1000, 0)];
        assert_eq!(capacity_fee(&inputs, &outputs), 0);
    }

    #[test]
    fn test_capacity_fee_saturates_on_overflow() {
        // Output > input should saturate to 0
        let inputs = vec![make_cell_input(100, test_sender())];
        let outputs = vec![make_cell_output(200, 0)];
        assert_eq!(capacity_fee(&inputs, &outputs), 0);
    }

    // ============ K-Invariant Tests ============

    #[test]
    fn test_check_k_invariant_maintained() {
        assert!(check_k_invariant(1000, 2000, 1100, 1900).is_ok());
        // k_before = 2_000_000, k_after = 2_090_000 — increased
    }

    #[test]
    fn test_check_k_invariant_exact() {
        assert!(check_k_invariant(1000, 2000, 2000, 1000).is_ok());
    }

    #[test]
    fn test_check_k_invariant_violated() {
        let err = check_k_invariant(1000, 2000, 500, 2000).unwrap_err();
        match err {
            ValidationError::InvariantViolation(msg) => {
                assert!(msg.contains("k decreased"));
            }
            _ => panic!("wrong error type"),
        }
    }

    #[test]
    fn test_check_k_invariant_zero_before() {
        // 0 -> anything is valid (k stays same or increases from 0)
        assert!(check_k_invariant(0, 0, 100, 100).is_ok());
    }

    #[test]
    fn test_check_k_invariant_large_values() {
        // Test u128 math doesn't overflow
        let big = u64::MAX / 2;
        assert!(check_k_invariant(big, big, big, big).is_ok());
    }

    // ============ Supply Conservation Tests ============

    #[test]
    fn test_check_supply_conservation_balanced() {
        assert!(check_supply_conservation(1000, 970, 30).is_ok());
    }

    #[test]
    fn test_check_supply_conservation_no_fees() {
        assert!(check_supply_conservation(1000, 1000, 0).is_ok());
    }

    #[test]
    fn test_check_supply_conservation_mismatch() {
        let err = check_supply_conservation(1000, 960, 30).unwrap_err();
        match err {
            ValidationError::InvariantViolation(msg) => {
                assert!(msg.contains("supply mismatch"));
            }
            _ => panic!("wrong error type"),
        }
    }

    // ============ Price Bounds Tests ============

    #[test]
    fn test_check_price_bounds_within() {
        assert!(check_price_bounds(10_100, 10_000, 300).is_ok());
    }

    #[test]
    fn test_check_price_bounds_exact() {
        assert!(check_price_bounds(10_000, 10_000, 300).is_ok());
    }

    #[test]
    fn test_check_price_bounds_exceeded_high() {
        let err = check_price_bounds(15_000, 10_000, 300).unwrap_err();
        match err {
            ValidationError::PriceImpactTooHigh { impact_bps, max_bps } => {
                assert_eq!(impact_bps, 5000);
                assert_eq!(max_bps, 300);
            }
            _ => panic!("wrong error type"),
        }
    }

    #[test]
    fn test_check_price_bounds_exceeded_low() {
        let err = check_price_bounds(5_000, 10_000, 300).unwrap_err();
        match err {
            ValidationError::PriceImpactTooHigh { impact_bps, max_bps } => {
                assert_eq!(impact_bps, 5000);
                assert_eq!(max_bps, 300);
            }
            _ => panic!("wrong error type"),
        }
    }

    #[test]
    fn test_check_price_bounds_zero_oracle() {
        let err = check_price_bounds(10_000, 0, 300).unwrap_err();
        match err {
            ValidationError::InvariantViolation(msg) => {
                assert!(msg.contains("oracle price is zero"));
            }
            _ => panic!("wrong error type"),
        }
    }

    // ============ Duplicate Detection Tests ============

    #[test]
    fn test_compute_tx_hash_deterministic() {
        let tx = make_tx(TxType::Swap, 1000);
        let h1 = compute_tx_hash(&tx);
        let h2 = compute_tx_hash(&tx);
        assert_eq!(h1, h2);
    }

    #[test]
    fn test_compute_tx_hash_different_amounts() {
        let tx1 = make_tx(TxType::Swap, 1000);
        let mut tx2 = make_tx(TxType::Swap, 2000);
        tx2.nonce = tx1.nonce;
        assert_ne!(compute_tx_hash(&tx1), compute_tx_hash(&tx2));
    }

    #[test]
    fn test_compute_tx_hash_different_nonces() {
        let tx1 = make_tx(TxType::Swap, 1000);
        let mut tx2 = make_tx(TxType::Swap, 1000);
        tx2.nonce = 99;
        assert_ne!(compute_tx_hash(&tx1), compute_tx_hash(&tx2));
    }

    #[test]
    fn test_is_duplicate_found() {
        let tx = make_tx(TxType::Swap, 1000);
        let hash = compute_tx_hash(&tx);
        let recent = vec![hash];
        assert!(is_duplicate(&hash, &recent));
    }

    #[test]
    fn test_is_duplicate_not_found() {
        let tx = make_tx(TxType::Swap, 1000);
        let hash = compute_tx_hash(&tx);
        let recent: Vec<[u8; 32]> = vec![[0u8; 32]];
        assert!(!is_duplicate(&hash, &recent));
    }

    #[test]
    fn test_is_duplicate_empty_list() {
        let hash = [1u8; 32];
        assert!(!is_duplicate(&hash, &[]));
    }

    #[test]
    fn test_add_to_seen_basic() {
        let mut recent = Vec::new();
        add_to_seen(&mut recent, [1u8; 32], 10);
        assert_eq!(recent.len(), 1);
    }

    #[test]
    fn test_add_to_seen_evicts_oldest() {
        let mut recent = vec![[1u8; 32], [2u8; 32], [3u8; 32]];
        add_to_seen(&mut recent, [4u8; 32], 3);
        assert_eq!(recent.len(), 3);
        assert_eq!(recent[0], [2u8; 32]); // oldest evicted
        assert_eq!(recent[2], [4u8; 32]); // newest added
    }

    #[test]
    fn test_add_to_seen_at_max() {
        let mut recent = vec![[1u8; 32], [2u8; 32]];
        add_to_seen(&mut recent, [3u8; 32], 2);
        assert_eq!(recent.len(), 2);
        assert_eq!(recent[0], [2u8; 32]);
        assert_eq!(recent[1], [3u8; 32]);
    }

    // ============ Gas Estimation Tests ============

    #[test]
    fn test_estimate_gas_swap() {
        let tx = make_tx(TxType::Swap, 1000);
        let gas = estimate_gas(&tx);
        // BASE_GAS * 2 + 1 input * 10000 + 1 output * 8000 = 100000 + 10000 + 8000
        assert_eq!(gas, 118_000);
    }

    #[test]
    fn test_estimate_gas_commit() {
        let tx = make_tx(TxType::Commit, 1000);
        let gas = estimate_gas(&tx);
        // BASE_GAS * 1 + 1 input * 10000 + 1 output * 8000 = 50000 + 10000 + 8000
        assert_eq!(gas, 68_000);
    }

    #[test]
    fn test_estimate_gas_bridge() {
        let tx = make_tx(TxType::BridgeTransfer, 1000);
        let gas = estimate_gas(&tx);
        // BASE_GAS * 4 = 200000 + 10000 + 8000
        assert_eq!(gas, 218_000);
    }

    #[test]
    fn test_estimate_gas_no_cells() {
        let mut tx = make_tx(TxType::Swap, 1000);
        tx.inputs.clear();
        tx.outputs.clear();
        let gas = estimate_gas(&tx);
        assert_eq!(gas, 100_000); // BASE_GAS * 2 only
    }

    #[test]
    fn test_estimate_gas_many_cells() {
        let mut tx = make_tx(TxType::Swap, 1000);
        for _ in 0..10 {
            tx.inputs.push(make_cell_input(100, test_sender()));
            tx.outputs.push(make_cell_output(90, 0));
        }
        // 11 inputs, 11 outputs
        let gas = estimate_gas(&tx);
        assert_eq!(gas, 100_000 + 11 * 10_000 + 11 * 8_000);
    }

    // ============ Output Amount Estimation Tests ============

    #[test]
    fn test_estimate_output_amount_basic() {
        // 1000 in, 10000/10000 reserves, 30 bps fee
        let out = estimate_output_amount(1000, 10_000, 10_000, 30);
        // With 0.3% fee: in_with_fee = 1000 * 9970 = 9970000
        // out = 9970000 * 10000 / (10000 * 10000 + 9970000) = 99700000000 / 109970000 ≈ 906
        assert!(out > 900 && out < 1000);
    }

    #[test]
    fn test_estimate_output_amount_zero_reserve_in() {
        assert_eq!(estimate_output_amount(1000, 0, 10_000, 30), 0);
    }

    #[test]
    fn test_estimate_output_amount_zero_reserve_out() {
        assert_eq!(estimate_output_amount(1000, 10_000, 0, 30), 0);
    }

    #[test]
    fn test_estimate_output_amount_full_fee() {
        assert_eq!(estimate_output_amount(1000, 10_000, 10_000, BPS), 0);
    }

    #[test]
    fn test_estimate_output_amount_no_fee() {
        let out = estimate_output_amount(1000, 10_000, 10_000, 0);
        // out = 1000 * 10000 * 10000 / (10000 * 10000 + 1000 * 10000) = 10^11 / 1.1*10^8 ≈ 909
        assert_eq!(out, 909);
    }

    #[test]
    fn test_estimate_output_amount_tiny() {
        let out = estimate_output_amount(1, 10_000_000, 10_000_000, 30);
        // Tiny input should give near-zero output
        assert!(out <= 1);
    }

    // ============ Minimum Capacity Tests ============

    #[test]
    fn test_minimum_capacity_for_output_zero_data() {
        assert_eq!(minimum_capacity_for_output(0), 61 * SHANNONS_PER_BYTE);
    }

    #[test]
    fn test_minimum_capacity_for_output_100_bytes() {
        assert_eq!(minimum_capacity_for_output(100), 161 * SHANNONS_PER_BYTE);
    }

    #[test]
    fn test_minimum_capacity_for_output_equals_min_cell() {
        assert_eq!(minimum_capacity_for_output(0), MIN_CELL_CAPACITY);
    }

    // ============ Full Pipeline: Swap Tests ============

    #[test]
    fn test_validate_swap_valid() {
        let tx = make_tx(TxType::Swap, 50_000);
        let ctx = make_valid_ctx();
        let config = make_config();
        let report = validate_swap(&tx, &ctx, &config);
        assert!(is_valid(&report));
        assert_eq!(report.tx_type, TxType::Swap);
        assert!(report.checks_performed > 0);
    }

    #[test]
    fn test_validate_swap_insufficient_balance() {
        let tx = make_tx(TxType::Swap, 2_000_000); // > sender_balance
        let ctx = make_valid_ctx();
        let config = make_config();
        let report = validate_swap(&tx, &ctx, &config);
        assert!(!is_valid(&report));
        assert!(has_error_type(&report, &ValidationError::InsufficientBalance { required: 0, available: 0 }));
    }

    #[test]
    fn test_validate_swap_circuit_breaker() {
        let tx = make_tx(TxType::Swap, 50_000);
        let mut ctx = make_valid_ctx();
        ctx.circuit_breaker_active = true;
        let config = make_config();
        let report = validate_swap(&tx, &ctx, &config);
        assert!(!is_valid(&report));
        assert!(has_error_type(&report, &ValidationError::CircuitBreakerActive));
    }

    #[test]
    fn test_validate_swap_pool_inactive() {
        let tx = make_tx(TxType::Swap, 50_000);
        let mut ctx = make_valid_ctx();
        ctx.pool_active = false;
        let config = make_config();
        let report = validate_swap(&tx, &ctx, &config);
        assert!(!is_valid(&report));
        assert!(has_error_type(&report, &ValidationError::PoolInactive));
    }

    #[test]
    fn test_validate_swap_deadline_expired() {
        let mut tx = make_tx(TxType::Swap, 50_000);
        tx.deadline = 100_000; // same as current_time, but need buffer
        let ctx = make_valid_ctx();
        let config = make_config();
        let report = validate_swap(&tx, &ctx, &config);
        assert!(!is_valid(&report));
        assert!(has_error_type(&report, &ValidationError::DeadlineExpired { deadline: 0, now: 0 }));
    }

    #[test]
    fn test_validate_swap_nonce_mismatch() {
        let mut tx = make_tx(TxType::Swap, 50_000);
        tx.nonce = 99;
        let ctx = make_valid_ctx();
        let config = make_config();
        let report = validate_swap(&tx, &ctx, &config);
        assert!(!is_valid(&report));
        assert!(has_error_type(&report, &ValidationError::InvalidNonce { expected: 0, actual: 0 }));
    }

    #[test]
    fn test_validate_swap_address_blocked() {
        let tx = make_tx(TxType::Swap, 50_000);
        let mut ctx = make_valid_ctx();
        ctx.address_whitelisted = false;
        let config = make_config();
        let report = validate_swap(&tx, &ctx, &config);
        assert!(!is_valid(&report));
        assert!(has_error_type(&report, &ValidationError::AddressBlocked));
    }

    #[test]
    fn test_validate_swap_token_not_whitelisted() {
        let tx = make_tx(TxType::Swap, 50_000);
        let mut ctx = make_valid_ctx();
        ctx.token_whitelisted = false;
        let config = make_config();
        let report = validate_swap(&tx, &ctx, &config);
        assert!(!is_valid(&report));
        assert!(has_error_type(&report, &ValidationError::TokenNotWhitelisted));
    }

    #[test]
    fn test_validate_swap_high_price_impact() {
        let tx = make_tx(TxType::Swap, 500_000); // 50% of reserve
        let mut ctx = make_valid_ctx();
        ctx.sender_balance = 1_000_000;
        ctx.rate_limit_remaining = 1_000_000;
        let config = make_config();
        let report = validate_swap(&tx, &ctx, &config);
        assert!(!is_valid(&report));
        assert!(has_error_type(&report, &ValidationError::PriceImpactTooHigh { impact_bps: 0, max_bps: 0 }));
    }

    #[test]
    fn test_validate_swap_gas_estimated() {
        let tx = make_tx(TxType::Swap, 50_000);
        let ctx = make_valid_ctx();
        let config = make_config();
        let report = validate_swap(&tx, &ctx, &config);
        assert!(report.gas_estimate > 0);
    }

    #[test]
    fn test_validate_swap_multiple_errors() {
        let mut tx = make_tx(TxType::Swap, 2_000_000);
        tx.nonce = 99;
        let mut ctx = make_valid_ctx();
        ctx.pool_active = false;
        ctx.circuit_breaker_active = true;
        let config = make_config();
        let report = validate_swap(&tx, &ctx, &config);
        assert!(!is_valid(&report));
        assert!(report.errors.len() >= 3);
    }

    // ============ Full Pipeline: Add Liquidity Tests ============

    #[test]
    fn test_validate_add_liquidity_valid() {
        let mut tx = make_tx(TxType::AddLiquidity, 50_000);
        tx.amount_out_min = 1000;
        let ctx = make_valid_ctx();
        let config = make_config();
        let report = validate_add_liquidity(&tx, &ctx, &config);
        assert!(is_valid(&report));
    }

    #[test]
    fn test_validate_add_liquidity_no_min_lp_warning() {
        let tx = make_tx(TxType::AddLiquidity, 50_000);
        let ctx = make_valid_ctx();
        let config = make_config();
        let report = validate_add_liquidity(&tx, &ctx, &config);
        assert!(report.warnings.iter().any(|w| w.contains("no minimum LP")));
    }

    #[test]
    fn test_validate_add_liquidity_initial_deposit_warning() {
        let tx = make_tx(TxType::AddLiquidity, 50_000);
        let mut ctx = make_valid_ctx();
        ctx.pool_reserve_a = 0;
        ctx.pool_reserve_b = 0;
        let config = make_config();
        let report = validate_add_liquidity(&tx, &ctx, &config);
        assert!(report.warnings.iter().any(|w| w.contains("initial deposit")));
    }

    #[test]
    fn test_validate_add_liquidity_pool_inactive() {
        let tx = make_tx(TxType::AddLiquidity, 50_000);
        let mut ctx = make_valid_ctx();
        ctx.pool_active = false;
        let config = make_config();
        let report = validate_add_liquidity(&tx, &ctx, &config);
        assert!(!is_valid(&report));
    }

    // ============ Full Pipeline: Remove Liquidity Tests ============

    #[test]
    fn test_validate_remove_liquidity_valid() {
        let tx = make_tx(TxType::RemoveLiquidity, 50_000);
        let ctx = make_valid_ctx();
        let config = make_config();
        let report = validate_remove_liquidity(&tx, &ctx, &config);
        assert!(is_valid(&report));
    }

    #[test]
    fn test_validate_remove_liquidity_empty_pool() {
        let tx = make_tx(TxType::RemoveLiquidity, 50_000);
        let mut ctx = make_valid_ctx();
        ctx.pool_reserve_a = 0;
        ctx.pool_reserve_b = 0;
        let config = make_config();
        let report = validate_remove_liquidity(&tx, &ctx, &config);
        assert!(!is_valid(&report));
    }

    #[test]
    fn test_validate_remove_liquidity_pool_inactive() {
        let tx = make_tx(TxType::RemoveLiquidity, 50_000);
        let mut ctx = make_valid_ctx();
        ctx.pool_active = false;
        let config = make_config();
        let report = validate_remove_liquidity(&tx, &ctx, &config);
        assert!(!is_valid(&report));
    }

    // ============ Full Pipeline: Commit Tests ============

    #[test]
    fn test_validate_commit_valid() {
        let tx = make_tx(TxType::Commit, 50_000);
        let ctx = make_valid_ctx();
        let config = make_config();
        let report = validate_commit(&tx, &ctx, &config);
        assert!(is_valid(&report));
    }

    #[test]
    fn test_validate_commit_no_cell_deps() {
        let mut tx = make_tx(TxType::Commit, 50_000);
        tx.cell_deps.clear();
        let ctx = make_valid_ctx();
        let config = make_config();
        let report = validate_commit(&tx, &ctx, &config);
        assert!(!is_valid(&report));
        assert!(has_error_type(&report, &ValidationError::InvalidCellData));
    }

    #[test]
    fn test_validate_commit_zero_signature() {
        let mut tx = make_tx(TxType::Commit, 50_000);
        tx.signature = zero_signature();
        let ctx = make_valid_ctx();
        let config = make_config();
        let report = validate_commit(&tx, &ctx, &config);
        assert!(!is_valid(&report));
        assert!(has_error_type(&report, &ValidationError::InvalidSignature));
    }

    // ============ Full Pipeline: Reveal Tests ============

    #[test]
    fn test_validate_reveal_valid() {
        let tx = make_tx(TxType::Reveal, 50_000);
        let ctx = make_valid_ctx();
        let config = make_config();
        let report = validate_reveal(&tx, &ctx, &config);
        assert!(is_valid(&report));
    }

    #[test]
    fn test_validate_reveal_no_cell_deps() {
        let mut tx = make_tx(TxType::Reveal, 50_000);
        tx.cell_deps.clear();
        let ctx = make_valid_ctx();
        let config = make_config();
        let report = validate_reveal(&tx, &ctx, &config);
        assert!(!is_valid(&report));
    }

    #[test]
    fn test_validate_reveal_pool_inactive() {
        let tx = make_tx(TxType::Reveal, 50_000);
        let mut ctx = make_valid_ctx();
        ctx.pool_active = false;
        let config = make_config();
        let report = validate_reveal(&tx, &ctx, &config);
        assert!(!is_valid(&report));
    }

    #[test]
    fn test_validate_reveal_zero_sig() {
        let mut tx = make_tx(TxType::Reveal, 50_000);
        tx.signature = zero_signature();
        let ctx = make_valid_ctx();
        let config = make_config();
        let report = validate_reveal(&tx, &ctx, &config);
        assert!(!is_valid(&report));
        assert!(has_error_type(&report, &ValidationError::InvalidSignature));
    }

    // ============ Full Pipeline: Generic Dispatch Tests ============

    #[test]
    fn test_validate_transaction_dispatches_swap() {
        let tx = make_tx(TxType::Swap, 50_000);
        let ctx = make_valid_ctx();
        let config = make_config();
        let report = validate_transaction(&tx, &ctx, &config);
        assert_eq!(report.tx_type, TxType::Swap);
    }

    #[test]
    fn test_validate_transaction_dispatches_commit() {
        let tx = make_tx(TxType::Commit, 50_000);
        let ctx = make_valid_ctx();
        let config = make_config();
        let report = validate_transaction(&tx, &ctx, &config);
        assert_eq!(report.tx_type, TxType::Commit);
    }

    #[test]
    fn test_validate_transaction_generic_stake() {
        let tx = make_tx(TxType::Stake, 50_000);
        let ctx = make_valid_ctx();
        let config = make_config();
        let report = validate_transaction(&tx, &ctx, &config);
        assert_eq!(report.tx_type, TxType::Stake);
    }

    #[test]
    fn test_validate_transaction_generic_claim() {
        let tx = make_tx(TxType::Claim, 50_000);
        let ctx = make_valid_ctx();
        let config = make_config();
        let report = validate_transaction(&tx, &ctx, &config);
        assert!(is_valid(&report));
    }

    #[test]
    fn test_validate_transaction_generic_governance() {
        let tx = make_tx(TxType::GovernanceVote, 50_000);
        let ctx = make_valid_ctx();
        let config = make_config();
        let report = validate_transaction(&tx, &ctx, &config);
        assert!(is_valid(&report));
    }

    #[test]
    fn test_validate_transaction_generic_bridge() {
        let tx = make_tx(TxType::BridgeTransfer, 50_000);
        let ctx = make_valid_ctx();
        let config = make_config();
        let report = validate_transaction(&tx, &ctx, &config);
        assert!(is_valid(&report));
    }

    #[test]
    fn test_validate_transaction_generic_config_update() {
        let tx = make_tx(TxType::ConfigUpdate, 50_000);
        let ctx = make_valid_ctx();
        let config = make_config();
        let report = validate_transaction(&tx, &ctx, &config);
        assert!(is_valid(&report));
    }

    // ============ Strict Mode Tests ============

    #[test]
    fn test_strict_mode_warnings_become_errors() {
        // Add liquidity with amount_out_min = 0 generates a warning
        let tx = make_tx(TxType::AddLiquidity, 50_000);
        let ctx = make_valid_ctx();
        let config = strict_config();
        let report = validate_add_liquidity(&tx, &ctx, &config);
        // In strict mode, the "no minimum LP tokens" warning becomes an error
        assert!(!is_valid(&report));
    }

    #[test]
    fn test_non_strict_mode_warnings_ok() {
        let tx = make_tx(TxType::AddLiquidity, 50_000);
        let ctx = make_valid_ctx();
        let mut config = make_config();
        config.strict_mode = false;
        config.min_amount = 1; // ensure amount passes
        let report = validate_add_liquidity(&tx, &ctx, &config);
        assert!(is_valid(&report));
        assert!(!report.warnings.is_empty());
    }

    // ============ Batch Validation Tests ============

    #[test]
    fn test_validate_batch_all_valid() {
        let txs = vec![
            make_tx(TxType::Swap, 50_000),
            make_tx(TxType::Commit, 50_000),
        ];
        let ctx = make_valid_ctx();
        let config = make_config();
        let reports = validate_batch(&txs, &ctx, &config);
        assert_eq!(reports.len(), 2);
        assert_eq!(batch_valid_count(&reports), 2);
    }

    #[test]
    fn test_validate_batch_mixed() {
        let good = make_tx(TxType::Swap, 50_000);
        let mut bad = make_tx(TxType::Swap, 2_000_000); // over balance
        bad.nonce = 5;
        let txs = vec![good, bad];
        let ctx = make_valid_ctx();
        let config = make_config();
        let reports = validate_batch(&txs, &ctx, &config);
        assert_eq!(reports.len(), 2);
        assert_eq!(batch_valid_count(&reports), 1);
    }

    #[test]
    fn test_validate_batch_empty() {
        let reports = validate_batch(&[], &make_valid_ctx(), &make_config());
        assert!(reports.is_empty());
    }

    #[test]
    fn test_batch_valid_count_all_invalid() {
        let tx = make_tx(TxType::Swap, 2_000_000);
        let reports = validate_batch(&[tx], &make_valid_ctx(), &make_config());
        assert_eq!(batch_valid_count(&reports), 0);
    }

    #[test]
    fn test_batch_error_summary_counts() {
        let mut ctx = make_valid_ctx();
        ctx.circuit_breaker_active = true;
        let txs = vec![
            make_tx(TxType::Swap, 50_000),
            make_tx(TxType::Commit, 50_000),
        ];
        let config = make_config();
        let reports = validate_batch(&txs, &ctx, &config);
        let summary = batch_error_summary(&reports);
        // Both should have CircuitBreakerActive
        let cb_count = summary.iter().find(|(e, _)| *e == ValidationError::CircuitBreakerActive);
        assert!(cb_count.is_some());
        assert_eq!(cb_count.unwrap().1, 2);
    }

    #[test]
    fn test_batch_error_summary_empty() {
        let summary = batch_error_summary(&[]);
        assert!(summary.is_empty());
    }

    #[test]
    fn test_batch_error_summary_no_errors() {
        let tx = make_tx(TxType::Swap, 50_000);
        let reports = validate_batch(&[tx], &make_valid_ctx(), &make_config());
        let summary = batch_error_summary(&reports);
        assert!(summary.is_empty());
    }

    // ============ Report Analysis Tests ============

    #[test]
    fn test_is_valid_true() {
        let report = ValidationReport {
            tx_type: TxType::Swap,
            result: ValidationResult::Valid,
            errors: vec![],
            warnings: vec![],
            gas_estimate: 100,
            validated_at: 1000,
            checks_performed: 5,
        };
        assert!(is_valid(&report));
    }

    #[test]
    fn test_is_valid_false() {
        let report = ValidationReport {
            tx_type: TxType::Swap,
            result: ValidationResult::Invalid(vec![ValidationError::CircuitBreakerActive]),
            errors: vec![ValidationError::CircuitBreakerActive],
            warnings: vec![],
            gas_estimate: 100,
            validated_at: 1000,
            checks_performed: 5,
        };
        assert!(!is_valid(&report));
    }

    #[test]
    fn test_is_valid_pending() {
        let report = ValidationReport {
            tx_type: TxType::Swap,
            result: ValidationResult::Pending,
            errors: vec![],
            warnings: vec![],
            gas_estimate: 0,
            validated_at: 0,
            checks_performed: 0,
        };
        assert!(!is_valid(&report));
    }

    #[test]
    fn test_error_count_zero() {
        let report = ValidationReport {
            tx_type: TxType::Swap,
            result: ValidationResult::Valid,
            errors: vec![],
            warnings: vec![],
            gas_estimate: 0,
            validated_at: 0,
            checks_performed: 0,
        };
        assert_eq!(error_count(&report), 0);
    }

    #[test]
    fn test_error_count_multiple() {
        let report = ValidationReport {
            tx_type: TxType::Swap,
            result: ValidationResult::Invalid(vec![]),
            errors: vec![
                ValidationError::CircuitBreakerActive,
                ValidationError::PoolInactive,
                ValidationError::InvalidSignature,
            ],
            warnings: vec![],
            gas_estimate: 0,
            validated_at: 0,
            checks_performed: 0,
        };
        assert_eq!(error_count(&report), 3);
    }

    #[test]
    fn test_has_error_type_found() {
        let report = ValidationReport {
            tx_type: TxType::Swap,
            result: ValidationResult::Invalid(vec![]),
            errors: vec![
                ValidationError::CircuitBreakerActive,
                ValidationError::PoolInactive,
            ],
            warnings: vec![],
            gas_estimate: 0,
            validated_at: 0,
            checks_performed: 0,
        };
        assert!(has_error_type(&report, &ValidationError::CircuitBreakerActive));
    }

    #[test]
    fn test_has_error_type_not_found() {
        let report = ValidationReport {
            tx_type: TxType::Swap,
            result: ValidationResult::Invalid(vec![]),
            errors: vec![ValidationError::CircuitBreakerActive],
            warnings: vec![],
            gas_estimate: 0,
            validated_at: 0,
            checks_performed: 0,
        };
        assert!(!has_error_type(&report, &ValidationError::PoolInactive));
    }

    #[test]
    fn test_has_error_type_discriminant_match() {
        // Same variant but different field values should match
        let report = ValidationReport {
            tx_type: TxType::Swap,
            result: ValidationResult::Invalid(vec![]),
            errors: vec![ValidationError::InsufficientBalance { required: 100, available: 50 }],
            warnings: vec![],
            gas_estimate: 0,
            validated_at: 0,
            checks_performed: 0,
        };
        assert!(has_error_type(&report, &ValidationError::InsufficientBalance { required: 999, available: 0 }));
    }

    #[test]
    fn test_most_common_error_single() {
        let reports = vec![
            ValidationReport {
                tx_type: TxType::Swap,
                result: ValidationResult::Invalid(vec![]),
                errors: vec![ValidationError::CircuitBreakerActive],
                warnings: vec![],
                gas_estimate: 0,
                validated_at: 0,
                checks_performed: 0,
            },
        ];
        assert_eq!(most_common_error(&reports), Some(ValidationError::CircuitBreakerActive));
    }

    #[test]
    fn test_most_common_error_empty() {
        assert_eq!(most_common_error(&[]), None);
    }

    #[test]
    fn test_most_common_error_no_errors() {
        let reports = vec![
            ValidationReport {
                tx_type: TxType::Swap,
                result: ValidationResult::Valid,
                errors: vec![],
                warnings: vec![],
                gas_estimate: 0,
                validated_at: 0,
                checks_performed: 0,
            },
        ];
        assert_eq!(most_common_error(&reports), None);
    }

    #[test]
    fn test_validation_success_rate_all_valid() {
        let tx = make_tx(TxType::Swap, 50_000);
        let ctx = make_valid_ctx();
        let config = make_config();
        let reports = validate_batch(&[tx.clone(), tx], &ctx, &config);
        assert_eq!(validation_success_rate(&reports), 10_000);
    }

    #[test]
    fn test_validation_success_rate_none_valid() {
        let mut ctx = make_valid_ctx();
        ctx.circuit_breaker_active = true;
        let tx = make_tx(TxType::Swap, 50_000);
        let reports = validate_batch(&[tx], &ctx, &make_config());
        assert_eq!(validation_success_rate(&reports), 0);
    }

    #[test]
    fn test_validation_success_rate_half() {
        let good = make_tx(TxType::Swap, 50_000);
        let bad = make_tx(TxType::Swap, 2_000_000);
        let ctx = make_valid_ctx();
        let config = make_config();
        let reports = validate_batch(&[good, bad], &ctx, &config);
        assert_eq!(validation_success_rate(&reports), 5_000);
    }

    #[test]
    fn test_validation_success_rate_empty() {
        assert_eq!(validation_success_rate(&[]), 0);
    }

    // ============ Merge Reports Tests ============

    #[test]
    fn test_merge_reports_empty() {
        let merged = merge_reports(&[]);
        assert!(is_valid(&merged));
        assert_eq!(merged.gas_estimate, 0);
        assert_eq!(merged.checks_performed, 0);
    }

    #[test]
    fn test_merge_reports_single() {
        let report = ValidationReport {
            tx_type: TxType::Swap,
            result: ValidationResult::Valid,
            errors: vec![],
            warnings: vec!["test".to_string()],
            gas_estimate: 100,
            validated_at: 5000,
            checks_performed: 3,
        };
        let merged = merge_reports(&[report]);
        assert!(is_valid(&merged));
        assert_eq!(merged.gas_estimate, 100);
        assert_eq!(merged.warnings.len(), 1);
    }

    #[test]
    fn test_merge_reports_combines_errors() {
        let r1 = ValidationReport {
            tx_type: TxType::Swap,
            result: ValidationResult::Invalid(vec![ValidationError::CircuitBreakerActive]),
            errors: vec![ValidationError::CircuitBreakerActive],
            warnings: vec![],
            gas_estimate: 100,
            validated_at: 1000,
            checks_performed: 2,
        };
        let r2 = ValidationReport {
            tx_type: TxType::Swap,
            result: ValidationResult::Invalid(vec![ValidationError::PoolInactive]),
            errors: vec![ValidationError::PoolInactive],
            warnings: vec![],
            gas_estimate: 200,
            validated_at: 2000,
            checks_performed: 3,
        };
        let merged = merge_reports(&[r1, r2]);
        assert!(!is_valid(&merged));
        assert_eq!(merged.errors.len(), 2);
        assert_eq!(merged.gas_estimate, 300);
        assert_eq!(merged.validated_at, 2000);
        assert_eq!(merged.checks_performed, 5);
    }

    #[test]
    fn test_merge_reports_all_valid_stays_valid() {
        let r1 = ValidationReport {
            tx_type: TxType::Swap,
            result: ValidationResult::Valid,
            errors: vec![],
            warnings: vec![],
            gas_estimate: 100,
            validated_at: 1000,
            checks_performed: 2,
        };
        let r2 = ValidationReport {
            tx_type: TxType::Swap,
            result: ValidationResult::Valid,
            errors: vec![],
            warnings: vec![],
            gas_estimate: 200,
            validated_at: 2000,
            checks_performed: 3,
        };
        let merged = merge_reports(&[r1, r2]);
        assert!(is_valid(&merged));
    }

    // ============ Severity Score Tests ============

    #[test]
    fn test_severity_score_empty() {
        assert_eq!(severity_score(&[]), 0);
    }

    #[test]
    fn test_severity_score_circuit_breaker() {
        assert_eq!(severity_score(&[ValidationError::CircuitBreakerActive]), 10000);
    }

    #[test]
    fn test_severity_score_address_blocked() {
        assert_eq!(severity_score(&[ValidationError::AddressBlocked]), 10000);
    }

    #[test]
    fn test_severity_score_invalid_signature() {
        assert_eq!(severity_score(&[ValidationError::InvalidSignature]), 9000);
    }

    #[test]
    fn test_severity_score_insufficient_balance() {
        assert_eq!(severity_score(&[ValidationError::InsufficientBalance { required: 100, available: 50 }]), 7000);
    }

    #[test]
    fn test_severity_score_slippage() {
        assert_eq!(severity_score(&[ValidationError::SlippageExceeded { expected: 100, actual: 90 }]), 2000);
    }

    #[test]
    fn test_severity_score_amount_too_small() {
        assert_eq!(severity_score(&[ValidationError::AmountTooSmall { min: 100, actual: 50 }]), 1000);
    }

    #[test]
    fn test_severity_score_takes_max() {
        // Multiple errors — should return the highest score
        let errors = vec![
            ValidationError::AmountTooSmall { min: 100, actual: 50 }, // 1000
            ValidationError::CircuitBreakerActive,                      // 10000
            ValidationError::SlippageExceeded { expected: 100, actual: 90 }, // 2000
        ];
        assert_eq!(severity_score(&errors), 10000);
    }

    #[test]
    fn test_severity_score_output_overflow() {
        assert_eq!(severity_score(&[ValidationError::OutputOverflow]), 9000);
    }

    #[test]
    fn test_severity_score_invariant_violation() {
        assert_eq!(severity_score(&[ValidationError::InvariantViolation("test".to_string())]), 8000);
    }

    #[test]
    fn test_severity_score_duplicate_transaction() {
        assert_eq!(severity_score(&[ValidationError::DuplicateTransaction]), 5000);
    }

    #[test]
    fn test_severity_score_rate_limited() {
        assert_eq!(severity_score(&[ValidationError::RateLimited { retry_after_ms: 5000 }]), 3000);
    }

    #[test]
    fn test_severity_score_deadline_expired() {
        assert_eq!(severity_score(&[ValidationError::DeadlineExpired { deadline: 100, now: 200 }]), 3000);
    }

    #[test]
    fn test_severity_score_capacity_insufficient() {
        assert_eq!(severity_score(&[ValidationError::CapacityInsufficient { required: 100, available: 50 }]), 7000);
    }

    #[test]
    fn test_severity_score_type_script_mismatch() {
        assert_eq!(severity_score(&[ValidationError::TypeScriptMismatch]), 7000);
    }

    #[test]
    fn test_severity_score_lock_script_mismatch() {
        assert_eq!(severity_score(&[ValidationError::LockScriptMismatch]), 7000);
    }

    #[test]
    fn test_severity_score_invalid_cell_data() {
        assert_eq!(severity_score(&[ValidationError::InvalidCellData]), 6000);
    }

    #[test]
    fn test_severity_score_pool_inactive() {
        assert_eq!(severity_score(&[ValidationError::PoolInactive]), 5000);
    }

    #[test]
    fn test_severity_score_token_not_whitelisted() {
        assert_eq!(severity_score(&[ValidationError::TokenNotWhitelisted]), 4000);
    }

    #[test]
    fn test_severity_score_amount_too_large() {
        assert_eq!(severity_score(&[ValidationError::AmountTooLarge { max: 1000, actual: 2000 }]), 1000);
    }

    #[test]
    fn test_severity_score_invalid_nonce() {
        assert_eq!(severity_score(&[ValidationError::InvalidNonce { expected: 5, actual: 6 }]), 5000);
    }

    #[test]
    fn test_severity_score_price_impact_too_high() {
        assert_eq!(severity_score(&[ValidationError::PriceImpactTooHigh { impact_bps: 500, max_bps: 300 }]), 2000);
    }

    // ============ Edge Case / Integration Tests ============

    #[test]
    fn test_validate_swap_amount_at_min_bound() {
        let tx = make_tx(TxType::Swap, DEFAULT_MIN_AMOUNT);
        let ctx = make_valid_ctx();
        let config = make_config();
        let report = validate_swap(&tx, &ctx, &config);
        assert!(is_valid(&report));
    }

    #[test]
    fn test_validate_swap_amount_below_min_bound() {
        let tx = make_tx(TxType::Swap, DEFAULT_MIN_AMOUNT - 1);
        let ctx = make_valid_ctx();
        let config = make_config();
        let report = validate_swap(&tx, &ctx, &config);
        assert!(!is_valid(&report));
        assert!(has_error_type(&report, &ValidationError::AmountTooSmall { min: 0, actual: 0 }));
    }

    #[test]
    fn test_validate_swap_rate_limited() {
        let tx = make_tx(TxType::Swap, 50_000);
        let mut ctx = make_valid_ctx();
        ctx.rate_limit_remaining = 10; // Way below amount_in
        let config = make_config();
        let report = validate_swap(&tx, &ctx, &config);
        assert!(!is_valid(&report));
        assert!(has_error_type(&report, &ValidationError::RateLimited { retry_after_ms: 0 }));
    }

    #[test]
    fn test_validate_with_lock_script_mismatch_on_cell() {
        let mut tx = make_tx(TxType::Swap, 50_000);
        tx.inputs = vec![make_cell_input(100_000_000_000, [9u8; 32])]; // different sender
        let ctx = make_valid_ctx();
        let config = make_config();
        let report = validate_swap(&tx, &ctx, &config);
        assert!(!is_valid(&report));
        assert!(has_error_type(&report, &ValidationError::LockScriptMismatch));
    }

    #[test]
    fn test_validate_with_output_overflow() {
        let mut tx = make_tx(TxType::Swap, 50_000);
        tx.inputs = vec![make_cell_input(10_000_000_000, test_sender())];
        tx.outputs = vec![make_cell_output(90_000_000_000, 100)]; // output > input
        let ctx = make_valid_ctx();
        let config = make_config();
        let report = validate_swap(&tx, &ctx, &config);
        assert!(!is_valid(&report));
        assert!(has_error_type(&report, &ValidationError::OutputOverflow));
    }

    #[test]
    fn test_validate_cell_capacity_insufficient_in_pipeline() {
        let mut tx = make_tx(TxType::Swap, 50_000);
        tx.outputs = vec![CellOutput {
            capacity: 1000, // way below minimum
            lock_hash: test_sender(),
            type_hash: None,
            data_size: 100,
        }];
        tx.inputs = vec![make_cell_input(100_000_000_000, test_sender())];
        let ctx = make_valid_ctx();
        let config = make_config();
        let report = validate_swap(&tx, &ctx, &config);
        assert!(!is_valid(&report));
        assert!(has_error_type(&report, &ValidationError::CapacityInsufficient { required: 0, available: 0 }));
    }

    #[test]
    fn test_report_validated_at_matches_context_time() {
        let tx = make_tx(TxType::Swap, 50_000);
        let ctx = make_valid_ctx();
        let config = make_config();
        let report = validate_swap(&tx, &ctx, &config);
        assert_eq!(report.validated_at, ctx.current_time);
    }

    #[test]
    fn test_batch_three_types() {
        let txs = vec![
            make_tx(TxType::Swap, 50_000),
            make_tx(TxType::AddLiquidity, 50_000),
            make_tx(TxType::Commit, 50_000),
        ];
        let ctx = make_valid_ctx();
        let config = make_config();
        let reports = validate_batch(&txs, &ctx, &config);
        assert_eq!(reports.len(), 3);
        assert_eq!(reports[0].tx_type, TxType::Swap);
        assert_eq!(reports[1].tx_type, TxType::AddLiquidity);
        assert_eq!(reports[2].tx_type, TxType::Commit);
    }

    #[test]
    fn test_estimate_output_large_reserves() {
        let out = estimate_output_amount(1_000_000, 1_000_000_000, 1_000_000_000, 30);
        // Small trade relative to reserves — should get close to 1:1
        assert!(out > 990_000 && out < 1_000_000);
    }

    #[test]
    fn test_k_invariant_with_fees_increases_k() {
        // Swap with fee: reserve_a goes up, reserve_b goes down, but k increases
        // 100 in, 10000/10000, 0.3% fee => actual in = 99.7
        // out = 99.7 * 10000 / (10000 + 99.7) ≈ 98.71
        // new reserves: 10100, 9901.29 => k = 100_003_029 > 100_000_000
        assert!(check_k_invariant(10000, 10000, 10100, 9902).is_ok());
    }

    #[test]
    fn test_check_price_bounds_symmetric() {
        // +2% should pass with 3% max
        assert!(check_price_bounds(10_200, 10_000, 300).is_ok());
        // -2% should also pass
        assert!(check_price_bounds(9_800, 10_000, 300).is_ok());
    }

    #[test]
    fn test_merge_reports_warnings_combined() {
        let r1 = ValidationReport {
            tx_type: TxType::Swap,
            result: ValidationResult::Valid,
            errors: vec![],
            warnings: vec!["warn1".to_string()],
            gas_estimate: 100,
            validated_at: 1000,
            checks_performed: 1,
        };
        let r2 = ValidationReport {
            tx_type: TxType::Swap,
            result: ValidationResult::Valid,
            errors: vec![],
            warnings: vec!["warn2".to_string()],
            gas_estimate: 200,
            validated_at: 2000,
            checks_performed: 2,
        };
        let merged = merge_reports(&[r1, r2]);
        assert_eq!(merged.warnings.len(), 2);
        assert!(merged.warnings.contains(&"warn1".to_string()));
        assert!(merged.warnings.contains(&"warn2".to_string()));
    }
}
