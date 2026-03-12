// ============ Accounting — Double-Entry Bookkeeping & Reconciliation ============
// Protocol-wide financial integrity layer for VibeSwap on CKB.
// Every token movement — emission, fee, reward, stake, bridge — is tracked as
// a balanced journal entry where total debits always equal total credits.
//
// Key capabilities:
// - Double-entry bookkeeping with five account categories (Asset, Liability,
//   Revenue, Expense, Equity)
// - Journal entry creation with automatic debit/credit balance validation
// - Trial balance generation and the accounting equation check
// - Balance sheet synthesis across all protocol accounts
// - Reconciliation of on-chain balances against ledger expectations
// - Full audit trail generation per account
// - Emission and fee revenue helpers that produce pre-balanced entries
// - Period summaries for governance reporting
//
// Philosophy: "Every debit has a credit." Financial integrity is a prerequisite
// for Cooperative Capitalism — you cannot share what you cannot count.

use vibeswap_math::PRECISION;
use vibeswap_math::mul_div;

// ============ Constants ============

/// Basis points denominator
pub const BPS: u128 = 10_000;

/// Maximum journal entries tracked in a single context
pub const MAX_JOURNAL_ENTRIES: usize = 100;

/// Maximum accounts tracked in a single context
pub const MAX_ACCOUNTS: usize = 50;

/// Rounding tolerance for reconciliation (1 wei)
pub const RECONCILIATION_TOLERANCE: u128 = 1;

// ============ Error Types ============

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AccountingError {
    /// Total debits do not equal total credits in a journal entry
    UnbalancedEntry,
    /// Referenced account ID was not found in the accounts array
    AccountNotFound,
    /// An account with the same ID already exists
    DuplicateAccount,
    /// Cannot add another account — MAX_ACCOUNTS reached
    MaxAccountsReached,
    /// Cannot add another journal entry — MAX_JOURNAL_ENTRIES reached
    MaxEntriesReached,
    /// Debit would cause the account's net balance to go negative
    InsufficientBalance,
    /// Computed net balance is negative (internal consistency failure)
    NegativeBalance,
    /// Reconciliation found a difference exceeding tolerance
    ReconciliationFailed,
    /// Amount parameter is invalid (e.g. exceeds capacity)
    InvalidAmount,
    /// Amount is zero where a non-zero value is required
    ZeroAmount,
    /// Arithmetic overflow
    Overflow,
    /// Account category is not valid for this operation
    InvalidCategory,
}

// ============ Data Types ============

/// Classification of an account following standard double-entry conventions.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AccountCategory {
    /// Protocol-owned tokens, LP positions
    Asset,
    /// Unvested allocations, pending withdrawals
    Liability,
    /// Fees earned, emission received
    Revenue,
    /// Rewards distributed, IL coverage paid
    Expense,
    /// Net protocol value
    Equity,
}

/// A single account in the general ledger.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Account {
    /// Unique identifier (e.g. CKB lock hash or deterministic hash)
    pub id: [u8; 32],
    /// Hash of the human-readable account name
    pub name_hash: [u8; 32],
    /// Classification of this account
    pub category: AccountCategory,
    /// Sum of all debits ever posted to this account
    pub debit_balance: u128,
    /// Sum of all credits ever posted to this account
    pub credit_balance: u128,
    /// Block at which the account was created
    pub created_block: u64,
    /// Block of the most recent journal entry touching this account
    pub last_entry_block: u64,
    /// Number of journal entries that have touched this account
    pub entry_count: u64,
}

/// A single debit or credit line within a journal entry.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LedgerLine {
    /// Account affected by this line
    pub account_id: [u8; 32],
    /// Amount debited or credited
    pub amount: u128,
}

/// A balanced journal entry — the atomic unit of double-entry bookkeeping.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct JournalEntry {
    /// Unique sequential identifier
    pub entry_id: u64,
    /// Block at which this entry was recorded
    pub block_number: u64,
    /// Hash of a human-readable description
    pub description_hash: [u8; 32],
    /// Debit lines (max 5)
    pub debits: [LedgerLine; 5],
    /// Credit lines (max 5)
    pub credits: [LedgerLine; 5],
    /// Number of active debit lines
    pub debit_count: u8,
    /// Number of active credit lines
    pub credit_count: u8,
    /// Total amount (sum of debits, which must equal sum of credits)
    pub total_amount: u128,
}

/// Result of a trial balance computation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TrialBalance {
    /// Sum of all debit balances across all accounts
    pub total_debits: u128,
    /// Sum of all credit balances across all accounts
    pub total_credits: u128,
    /// Whether debits equal credits
    pub is_balanced: bool,
    /// Absolute difference between debits and credits
    pub difference: u128,
    /// Number of accounts included
    pub account_count: u32,
}

/// Snapshot of the protocol's financial position.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BalanceSheet {
    /// Total net balances of Asset accounts
    pub total_assets: u128,
    /// Total net balances of Liability accounts
    pub total_liabilities: u128,
    /// Total net balances of Equity accounts
    pub total_equity: u128,
    /// Total net balances of Revenue accounts
    pub total_revenue: u128,
    /// Total net balances of Expense accounts
    pub total_expenses: u128,
    /// Revenue minus Expenses (can be negative)
    pub net_income: i128,
    /// Whether the accounting equation holds: Assets = Liabilities + Equity + Net Income
    pub is_balanced: bool,
}

/// Result of reconciling an account against an expected on-chain balance.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReconciliationResult {
    /// What the on-chain balance should be
    pub expected_balance: u128,
    /// What the on-chain balance actually is
    pub actual_balance: u128,
    /// Absolute difference
    pub difference: u128,
    /// Whether the difference is within tolerance
    pub is_reconciled: bool,
    /// Tolerance that was applied
    pub tolerance_used: u128,
}

/// Full audit trail for a single account.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AuditTrail {
    /// Account being audited
    pub account_id: [u8; 32],
    /// Balance at the start of the audit period (zero for new accounts)
    pub opening_balance: u128,
    /// Sum of all debits in the period
    pub total_debits: u128,
    /// Sum of all credits in the period
    pub total_credits: u128,
    /// Computed closing balance
    pub closing_balance: u128,
    /// Number of entries in the period
    pub entry_count: u64,
    /// Whether the trail is internally consistent
    pub is_consistent: bool,
}

// ============ Functions ============

/// Create a new account with zero balances.
pub fn create_account(
    id: [u8; 32],
    name_hash: [u8; 32],
    category: AccountCategory,
    block: u64,
) -> Account {
    Account {
        id,
        name_hash,
        category,
        debit_balance: 0,
        credit_balance: 0,
        created_block: block,
        last_entry_block: block,
        entry_count: 0,
    }
}

/// Compute the net balance of an account following normal balance conventions.
/// - Asset and Expense accounts have a normal debit balance: debit - credit.
/// - Liability, Revenue, and Equity accounts have a normal credit balance: credit - debit.
/// Returns 0 if the account is in a contra state (debit < credit for asset, etc.).
pub fn net_balance(account: &Account) -> u128 {
    match account.category {
        AccountCategory::Asset | AccountCategory::Expense => {
            account.debit_balance.saturating_sub(account.credit_balance)
        }
        AccountCategory::Liability | AccountCategory::Revenue | AccountCategory::Equity => {
            account.credit_balance.saturating_sub(account.debit_balance)
        }
    }
}

/// Create a balanced journal entry from debit and credit line slices.
///
/// Validates:
/// - At least one debit and one credit line
/// - No more than 5 debit lines and 5 credit lines
/// - No zero-amount lines
/// - Sum of debits equals sum of credits
pub fn create_journal_entry(
    entry_id: u64,
    block: u64,
    desc_hash: [u8; 32],
    debits: &[([u8; 32], u128)],
    credits: &[([u8; 32], u128)],
) -> Result<JournalEntry, AccountingError> {
    if debits.is_empty() || credits.is_empty() {
        return Err(AccountingError::InvalidAmount);
    }
    if debits.len() > 5 || credits.len() > 5 {
        return Err(AccountingError::MaxEntriesReached);
    }

    let mut total_debits: u128 = 0;
    let mut total_credits: u128 = 0;

    let empty_line = LedgerLine {
        account_id: [0u8; 32],
        amount: 0,
    };

    let mut debit_lines = [
        empty_line.clone(),
        empty_line.clone(),
        empty_line.clone(),
        empty_line.clone(),
        empty_line.clone(),
    ];
    let mut credit_lines = [
        empty_line.clone(),
        empty_line.clone(),
        empty_line.clone(),
        empty_line.clone(),
        empty_line.clone(),
    ];

    for (i, (id, amount)) in debits.iter().enumerate() {
        if *amount == 0 {
            return Err(AccountingError::ZeroAmount);
        }
        total_debits = total_debits
            .checked_add(*amount)
            .ok_or(AccountingError::Overflow)?;
        debit_lines[i] = LedgerLine {
            account_id: *id,
            amount: *amount,
        };
    }

    for (i, (id, amount)) in credits.iter().enumerate() {
        if *amount == 0 {
            return Err(AccountingError::ZeroAmount);
        }
        total_credits = total_credits
            .checked_add(*amount)
            .ok_or(AccountingError::Overflow)?;
        credit_lines[i] = LedgerLine {
            account_id: *id,
            amount: *amount,
        };
    }

    if total_debits != total_credits {
        return Err(AccountingError::UnbalancedEntry);
    }

    Ok(JournalEntry {
        entry_id,
        block_number: block,
        description_hash: desc_hash,
        debits: debit_lines,
        credits: credit_lines,
        debit_count: debits.len() as u8,
        credit_count: credits.len() as u8,
        total_amount: total_debits,
    })
}

/// Post a journal entry to accounts, updating debit/credit balances and metadata.
///
/// Returns a new Vec of accounts with the entry applied.
/// Fails if any referenced account is not found.
pub fn post_entry(
    accounts: &[Account],
    entry: &JournalEntry,
) -> Result<Vec<Account>, AccountingError> {
    let mut result: Vec<Account> = accounts.to_vec();

    // Apply debits
    for i in 0..(entry.debit_count as usize) {
        let line = &entry.debits[i];
        let idx = find_account(&result, line.account_id)
            .ok_or(AccountingError::AccountNotFound)?;
        result[idx].debit_balance = result[idx]
            .debit_balance
            .checked_add(line.amount)
            .ok_or(AccountingError::Overflow)?;
        result[idx].last_entry_block = entry.block_number;
        result[idx].entry_count += 1;
    }

    // Apply credits
    for i in 0..(entry.credit_count as usize) {
        let line = &entry.credits[i];
        let idx = find_account(&result, line.account_id)
            .ok_or(AccountingError::AccountNotFound)?;
        result[idx].credit_balance = result[idx]
            .credit_balance
            .checked_add(line.amount)
            .ok_or(AccountingError::Overflow)?;
        result[idx].last_entry_block = entry.block_number;
        result[idx].entry_count += 1;
    }

    Ok(result)
}

/// Compute the trial balance across all accounts.
pub fn trial_balance(accounts: &[Account]) -> TrialBalance {
    let mut total_debits: u128 = 0;
    let mut total_credits: u128 = 0;

    for acct in accounts.iter() {
        total_debits = total_debits.saturating_add(acct.debit_balance);
        total_credits = total_credits.saturating_add(acct.credit_balance);
    }

    let difference = if total_debits >= total_credits {
        total_debits - total_credits
    } else {
        total_credits - total_debits
    };

    TrialBalance {
        total_debits,
        total_credits,
        is_balanced: total_debits == total_credits,
        difference,
        account_count: accounts.len() as u32,
    }
}

/// Generate a balance sheet from the current account state.
///
/// The accounting equation: Assets = Liabilities + Equity + (Revenue - Expenses)
pub fn balance_sheet(accounts: &[Account]) -> BalanceSheet {
    let total_assets = category_total(accounts, AccountCategory::Asset);
    let total_liabilities = category_total(accounts, AccountCategory::Liability);
    let total_equity = category_total(accounts, AccountCategory::Equity);
    let total_revenue = category_total(accounts, AccountCategory::Revenue);
    let total_expenses = category_total(accounts, AccountCategory::Expense);

    let net_income = (total_revenue as i128) - (total_expenses as i128);

    // Assets = Liabilities + Equity + Net Income
    let rhs = (total_liabilities as i128) + (total_equity as i128) + net_income;
    let is_balanced = (total_assets as i128) == rhs;

    BalanceSheet {
        total_assets,
        total_liabilities,
        total_equity,
        total_revenue,
        total_expenses,
        net_income,
        is_balanced,
    }
}

/// Reconcile an account's net balance against an expected on-chain balance.
pub fn reconcile(account: &Account, expected_balance: u128) -> ReconciliationResult {
    let actual = net_balance(account);
    let difference = if actual >= expected_balance {
        actual - expected_balance
    } else {
        expected_balance - actual
    };

    ReconciliationResult {
        expected_balance,
        actual_balance: actual,
        difference,
        is_reconciled: difference <= RECONCILIATION_TOLERANCE,
        tolerance_used: RECONCILIATION_TOLERANCE,
    }
}

/// Build an audit trail for a specific account across a set of journal entries.
///
/// Opening balance is the account's current debit/credit state *minus* entries in
/// the provided slice (i.e. we reconstruct movements from the entries).
pub fn audit_trail(account: &Account, entries: &[JournalEntry]) -> AuditTrail {
    let mut total_debits: u128 = 0;
    let mut total_credits: u128 = 0;
    let mut entry_count: u64 = 0;

    for entry in entries.iter() {
        for i in 0..(entry.debit_count as usize) {
            if entry.debits[i].account_id == account.id {
                total_debits = total_debits.saturating_add(entry.debits[i].amount);
                entry_count += 1;
            }
        }
        for i in 0..(entry.credit_count as usize) {
            if entry.credits[i].account_id == account.id {
                total_credits = total_credits.saturating_add(entry.credits[i].amount);
                entry_count += 1;
            }
        }
    }

    // The current balance IS the closing balance.
    let closing_balance = net_balance(account);

    // Opening balance: reverse the effect of the entries.
    // For asset/expense (normal debit): closing = opening + debits - credits
    //   => opening = closing - debits + credits
    // For liability/revenue/equity (normal credit): closing = opening + credits - debits
    //   => opening = closing - credits + debits
    let opening_balance = match account.category {
        AccountCategory::Asset | AccountCategory::Expense => {
            closing_balance
                .saturating_add(total_credits)
                .saturating_sub(total_debits)
        }
        AccountCategory::Liability | AccountCategory::Revenue | AccountCategory::Equity => {
            closing_balance
                .saturating_add(total_debits)
                .saturating_sub(total_credits)
        }
    };

    // Verify consistency: recompute closing from opening + movements
    let recomputed = match account.category {
        AccountCategory::Asset | AccountCategory::Expense => {
            opening_balance
                .saturating_add(total_debits)
                .saturating_sub(total_credits)
        }
        AccountCategory::Liability | AccountCategory::Revenue | AccountCategory::Equity => {
            opening_balance
                .saturating_add(total_credits)
                .saturating_sub(total_debits)
        }
    };
    let is_consistent = recomputed == closing_balance;

    AuditTrail {
        account_id: account.id,
        opening_balance,
        total_debits,
        total_credits,
        closing_balance,
        entry_count,
        is_consistent,
    }
}

/// Validate the accounting equation: Assets = Liabilities + Equity + (Revenue - Expenses).
pub fn validate_accounting_equation(accounts: &[Account]) -> bool {
    let sheet = balance_sheet(accounts);
    sheet.is_balanced
}

/// Find the index of an account by its ID. Returns `None` if not found.
pub fn find_account(accounts: &[Account], id: [u8; 32]) -> Option<usize> {
    accounts.iter().position(|a| a.id == id)
}

/// Sum net balances of all accounts in a given category.
pub fn category_total(accounts: &[Account], category: AccountCategory) -> u128 {
    let mut total: u128 = 0;
    for acct in accounts.iter() {
        if acct.category == category {
            total = total.saturating_add(net_balance(acct));
        }
    }
    total
}

/// Create a journal entry recording fee revenue.
///
/// Debits the asset account (cash/token received), credits the revenue account.
/// Returns a balanced journal entry ready to be posted.
pub fn record_fee_revenue(
    asset_account_id: [u8; 32],
    revenue_account_id: [u8; 32],
    amount: u128,
    block: u64,
    entry_id: u64,
) -> Result<JournalEntry, AccountingError> {
    if amount == 0 {
        return Err(AccountingError::ZeroAmount);
    }

    let desc_hash = [0xFEu8; 32]; // deterministic description hash for fee entries

    create_journal_entry(
        entry_id,
        block,
        desc_hash,
        &[(asset_account_id, amount)],
        &[(revenue_account_id, amount)],
    )
}

/// Create a journal entry recording a 3-way emission split.
///
/// Debits the treasury/emission source, credits Shapley, Gauge, and Staking sinks.
/// Uses the remainder pattern: staking gets `emission_amount - shapley_share - gauge_share`
/// to avoid dust from BPS rounding.
pub fn record_emission(
    treasury_id: [u8; 32],
    emission_amount: u128,
    shapley_id: [u8; 32],
    gauge_id: [u8; 32],
    staking_id: [u8; 32],
    shapley_bps: u16,
    gauge_bps: u16,
    block: u64,
) -> Result<JournalEntry, AccountingError> {
    if emission_amount == 0 {
        return Err(AccountingError::ZeroAmount);
    }

    // BPS must sum to <= 10000 (staking gets the remainder)
    let total_bps = (shapley_bps as u128) + (gauge_bps as u128);
    if total_bps > BPS {
        return Err(AccountingError::InvalidAmount);
    }

    let shapley_share = mul_div(emission_amount, shapley_bps as u128, BPS);
    let gauge_share = mul_div(emission_amount, gauge_bps as u128, BPS);
    let staking_share = emission_amount - shapley_share - gauge_share;

    // All three must be non-zero for a valid 3-way entry
    if shapley_share == 0 || gauge_share == 0 || staking_share == 0 {
        return Err(AccountingError::ZeroAmount);
    }

    let desc_hash = [0xE0u8; 32]; // deterministic description hash for emission entries

    create_journal_entry(
        0, // entry_id assigned by caller
        block,
        desc_hash,
        &[(treasury_id, emission_amount)],
        &[
            (shapley_id, shapley_share),
            (gauge_id, gauge_share),
            (staking_id, staking_share),
        ],
    )
}

/// Summarise journal entries within a block range.
///
/// Returns (total_volume, entry_count) for entries where `from_block <= block_number <= to_block`.
pub fn period_summary(
    entries: &[JournalEntry],
    from_block: u64,
    to_block: u64,
) -> (u128, u32) {
    let mut total_volume: u128 = 0;
    let mut entry_count: u32 = 0;

    for entry in entries.iter() {
        if entry.block_number >= from_block && entry.block_number <= to_block {
            total_volume = total_volume.saturating_add(entry.total_amount);
            entry_count += 1;
        }
    }

    (total_volume, entry_count)
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // ---- Helpers ----

    fn id(byte: u8) -> [u8; 32] {
        [byte; 32]
    }

    fn make_asset(byte: u8, block: u64) -> Account {
        create_account(id(byte), id(byte + 100), AccountCategory::Asset, block)
    }

    fn make_liability(byte: u8, block: u64) -> Account {
        create_account(id(byte), id(byte + 100), AccountCategory::Liability, block)
    }

    fn make_revenue(byte: u8, block: u64) -> Account {
        create_account(id(byte), id(byte + 100), AccountCategory::Revenue, block)
    }

    fn make_expense(byte: u8, block: u64) -> Account {
        create_account(id(byte), id(byte + 100), AccountCategory::Expense, block)
    }

    fn make_equity(byte: u8, block: u64) -> Account {
        create_account(id(byte), id(byte + 100), AccountCategory::Equity, block)
    }

    /// Post a simple debit/credit pair and return updated accounts.
    fn post_simple(
        accounts: &[Account],
        debit_id: [u8; 32],
        credit_id: [u8; 32],
        amount: u128,
        block: u64,
    ) -> Vec<Account> {
        let entry = create_journal_entry(
            1, block, [0u8; 32],
            &[(debit_id, amount)],
            &[(credit_id, amount)],
        ).unwrap();
        post_entry(accounts, &entry).unwrap()
    }

    // ============ Account Creation Tests ============

    #[test]
    fn test_create_asset_account() {
        let acct = make_asset(1, 100);
        assert_eq!(acct.id, id(1));
        assert_eq!(acct.category, AccountCategory::Asset);
        assert_eq!(acct.debit_balance, 0);
        assert_eq!(acct.credit_balance, 0);
        assert_eq!(acct.created_block, 100);
        assert_eq!(acct.entry_count, 0);
    }

    #[test]
    fn test_create_liability_account() {
        let acct = make_liability(2, 200);
        assert_eq!(acct.category, AccountCategory::Liability);
        assert_eq!(acct.created_block, 200);
    }

    #[test]
    fn test_create_revenue_account() {
        let acct = make_revenue(3, 300);
        assert_eq!(acct.category, AccountCategory::Revenue);
    }

    #[test]
    fn test_create_expense_account() {
        let acct = make_expense(4, 400);
        assert_eq!(acct.category, AccountCategory::Expense);
    }

    #[test]
    fn test_create_equity_account() {
        let acct = make_equity(5, 500);
        assert_eq!(acct.category, AccountCategory::Equity);
    }

    #[test]
    fn test_create_account_zero_block() {
        let acct = create_account(id(0), id(0), AccountCategory::Asset, 0);
        assert_eq!(acct.created_block, 0);
        assert_eq!(acct.last_entry_block, 0);
    }

    #[test]
    fn test_create_account_max_block() {
        let acct = create_account(id(1), id(1), AccountCategory::Equity, u64::MAX);
        assert_eq!(acct.created_block, u64::MAX);
    }

    #[test]
    fn test_account_initial_entry_count_zero() {
        let acct = make_asset(10, 50);
        assert_eq!(acct.entry_count, 0);
    }

    #[test]
    fn test_account_name_hash_stored() {
        let acct = create_account(id(1), id(99), AccountCategory::Asset, 0);
        assert_eq!(acct.name_hash, id(99));
    }

    // ============ Net Balance Tests ============

    #[test]
    fn test_net_balance_asset_debit_greater() {
        let mut acct = make_asset(1, 0);
        acct.debit_balance = 1000;
        acct.credit_balance = 300;
        assert_eq!(net_balance(&acct), 700);
    }

    #[test]
    fn test_net_balance_asset_credit_greater() {
        let mut acct = make_asset(1, 0);
        acct.debit_balance = 100;
        acct.credit_balance = 500;
        // Contra asset: saturating sub returns 0
        assert_eq!(net_balance(&acct), 0);
    }

    #[test]
    fn test_net_balance_asset_equal() {
        let mut acct = make_asset(1, 0);
        acct.debit_balance = 1000;
        acct.credit_balance = 1000;
        assert_eq!(net_balance(&acct), 0);
    }

    #[test]
    fn test_net_balance_liability_credit_greater() {
        let mut acct = make_liability(2, 0);
        acct.credit_balance = 5000;
        acct.debit_balance = 2000;
        assert_eq!(net_balance(&acct), 3000);
    }

    #[test]
    fn test_net_balance_liability_debit_greater() {
        let mut acct = make_liability(2, 0);
        acct.debit_balance = 3000;
        acct.credit_balance = 1000;
        assert_eq!(net_balance(&acct), 0);
    }

    #[test]
    fn test_net_balance_revenue_normal() {
        let mut acct = make_revenue(3, 0);
        acct.credit_balance = 10000;
        acct.debit_balance = 0;
        assert_eq!(net_balance(&acct), 10000);
    }

    #[test]
    fn test_net_balance_expense_normal() {
        let mut acct = make_expense(4, 0);
        acct.debit_balance = 7500;
        acct.credit_balance = 0;
        assert_eq!(net_balance(&acct), 7500);
    }

    #[test]
    fn test_net_balance_equity_normal() {
        let mut acct = make_equity(5, 0);
        acct.credit_balance = 100 * PRECISION;
        acct.debit_balance = 0;
        assert_eq!(net_balance(&acct), 100 * PRECISION);
    }

    #[test]
    fn test_net_balance_zero_zero() {
        let acct = make_asset(1, 0);
        assert_eq!(net_balance(&acct), 0);
    }

    #[test]
    fn test_net_balance_large_values() {
        let mut acct = make_asset(1, 0);
        acct.debit_balance = u128::MAX;
        acct.credit_balance = 0;
        assert_eq!(net_balance(&acct), u128::MAX);
    }

    // ============ Journal Entry Tests ============

    #[test]
    fn test_create_journal_entry_single_line() {
        let entry = create_journal_entry(
            1, 100, [0u8; 32],
            &[(id(1), 500)],
            &[(id(2), 500)],
        ).unwrap();
        assert_eq!(entry.entry_id, 1);
        assert_eq!(entry.block_number, 100);
        assert_eq!(entry.debit_count, 1);
        assert_eq!(entry.credit_count, 1);
        assert_eq!(entry.total_amount, 500);
    }

    #[test]
    fn test_create_journal_entry_multi_line() {
        let entry = create_journal_entry(
            2, 200, [0u8; 32],
            &[(id(1), 300), (id(2), 200)],
            &[(id(3), 500)],
        ).unwrap();
        assert_eq!(entry.debit_count, 2);
        assert_eq!(entry.credit_count, 1);
        assert_eq!(entry.total_amount, 500);
    }

    #[test]
    fn test_create_journal_entry_multi_credit() {
        let entry = create_journal_entry(
            3, 300, [0u8; 32],
            &[(id(1), 1000)],
            &[(id(2), 400), (id(3), 600)],
        ).unwrap();
        assert_eq!(entry.credit_count, 2);
        assert_eq!(entry.total_amount, 1000);
    }

    #[test]
    fn test_create_journal_entry_max_lines() {
        let entry = create_journal_entry(
            4, 400, [0u8; 32],
            &[(id(1), 100), (id(2), 100), (id(3), 100), (id(4), 100), (id(5), 100)],
            &[(id(6), 100), (id(7), 100), (id(8), 100), (id(9), 100), (id(10), 100)],
        ).unwrap();
        assert_eq!(entry.debit_count, 5);
        assert_eq!(entry.credit_count, 5);
        assert_eq!(entry.total_amount, 500);
    }

    #[test]
    fn test_create_journal_entry_unbalanced() {
        let result = create_journal_entry(
            1, 100, [0u8; 32],
            &[(id(1), 500)],
            &[(id(2), 499)],
        );
        assert_eq!(result, Err(AccountingError::UnbalancedEntry));
    }

    #[test]
    fn test_create_journal_entry_zero_debit() {
        let result = create_journal_entry(
            1, 100, [0u8; 32],
            &[(id(1), 0)],
            &[(id(2), 0)],
        );
        assert_eq!(result, Err(AccountingError::ZeroAmount));
    }

    #[test]
    fn test_create_journal_entry_zero_credit() {
        let result = create_journal_entry(
            1, 100, [0u8; 32],
            &[(id(1), 100)],
            &[(id(2), 0)],
        );
        assert_eq!(result, Err(AccountingError::ZeroAmount));
    }

    #[test]
    fn test_create_journal_entry_empty_debits() {
        let result = create_journal_entry(
            1, 100, [0u8; 32],
            &[],
            &[(id(2), 100)],
        );
        assert_eq!(result, Err(AccountingError::InvalidAmount));
    }

    #[test]
    fn test_create_journal_entry_empty_credits() {
        let result = create_journal_entry(
            1, 100, [0u8; 32],
            &[(id(1), 100)],
            &[],
        );
        assert_eq!(result, Err(AccountingError::InvalidAmount));
    }

    #[test]
    fn test_create_journal_entry_too_many_debits() {
        let result = create_journal_entry(
            1, 100, [0u8; 32],
            &[(id(1), 100), (id(2), 100), (id(3), 100), (id(4), 100), (id(5), 100), (id(6), 100)],
            &[(id(7), 600)],
        );
        assert_eq!(result, Err(AccountingError::MaxEntriesReached));
    }

    #[test]
    fn test_create_journal_entry_too_many_credits() {
        let result = create_journal_entry(
            1, 100, [0u8; 32],
            &[(id(1), 600)],
            &[(id(2), 100), (id(3), 100), (id(4), 100), (id(5), 100), (id(6), 100), (id(7), 100)],
        );
        assert_eq!(result, Err(AccountingError::MaxEntriesReached));
    }

    #[test]
    fn test_create_journal_entry_large_amount() {
        let half = u128::MAX / 2;
        let entry = create_journal_entry(
            1, 100, [0u8; 32],
            &[(id(1), half)],
            &[(id(2), half)],
        ).unwrap();
        assert_eq!(entry.total_amount, half);
    }

    #[test]
    fn test_create_journal_entry_overflow_debits() {
        let result = create_journal_entry(
            1, 100, [0u8; 32],
            &[(id(1), u128::MAX), (id(2), 1)],
            &[(id(3), u128::MAX)],
        );
        assert_eq!(result, Err(AccountingError::Overflow));
    }

    #[test]
    fn test_create_journal_entry_description_hash_preserved() {
        let desc = [0xAB; 32];
        let entry = create_journal_entry(
            1, 100, desc,
            &[(id(1), 100)],
            &[(id(2), 100)],
        ).unwrap();
        assert_eq!(entry.description_hash, desc);
    }

    #[test]
    fn test_create_journal_entry_three_way_split() {
        let entry = create_journal_entry(
            1, 100, [0u8; 32],
            &[(id(1), 1000)],
            &[(id(2), 500), (id(3), 300), (id(4), 200)],
        ).unwrap();
        assert_eq!(entry.credit_count, 3);
        assert_eq!(entry.total_amount, 1000);
    }

    // ============ Post Entry Tests ============

    #[test]
    fn test_post_entry_simple() {
        let accounts = vec![make_asset(1, 0), make_revenue(2, 0)];
        let entry = create_journal_entry(
            1, 10, [0u8; 32],
            &[(id(1), 1000)],
            &[(id(2), 1000)],
        ).unwrap();
        let result = post_entry(&accounts, &entry).unwrap();
        assert_eq!(result[0].debit_balance, 1000);
        assert_eq!(result[1].credit_balance, 1000);
    }

    #[test]
    fn test_post_entry_updates_block() {
        let accounts = vec![make_asset(1, 0), make_liability(2, 0)];
        let entry = create_journal_entry(
            1, 42, [0u8; 32],
            &[(id(1), 500)],
            &[(id(2), 500)],
        ).unwrap();
        let result = post_entry(&accounts, &entry).unwrap();
        assert_eq!(result[0].last_entry_block, 42);
        assert_eq!(result[1].last_entry_block, 42);
    }

    #[test]
    fn test_post_entry_increments_count() {
        let accounts = vec![make_asset(1, 0), make_liability(2, 0)];
        let entry = create_journal_entry(
            1, 10, [0u8; 32],
            &[(id(1), 100)],
            &[(id(2), 100)],
        ).unwrap();
        let result = post_entry(&accounts, &entry).unwrap();
        assert_eq!(result[0].entry_count, 1);
        assert_eq!(result[1].entry_count, 1);
    }

    #[test]
    fn test_post_entry_multiple_sequential() {
        let accounts = vec![make_asset(1, 0), make_revenue(2, 0)];
        let e1 = create_journal_entry(1, 10, [0u8; 32], &[(id(1), 100)], &[(id(2), 100)]).unwrap();
        let e2 = create_journal_entry(2, 20, [0u8; 32], &[(id(1), 200)], &[(id(2), 200)]).unwrap();
        let r1 = post_entry(&accounts, &e1).unwrap();
        let r2 = post_entry(&r1, &e2).unwrap();
        assert_eq!(r2[0].debit_balance, 300);
        assert_eq!(r2[1].credit_balance, 300);
        assert_eq!(r2[0].entry_count, 2);
    }

    #[test]
    fn test_post_entry_account_not_found() {
        let accounts = vec![make_asset(1, 0)];
        let entry = create_journal_entry(
            1, 10, [0u8; 32],
            &[(id(1), 100)],
            &[(id(99), 100)], // id(99) not in accounts
        ).unwrap();
        let result = post_entry(&accounts, &entry);
        assert_eq!(result, Err(AccountingError::AccountNotFound));
    }

    #[test]
    fn test_post_entry_debit_account_not_found() {
        let accounts = vec![make_revenue(2, 0)];
        let entry = create_journal_entry(
            1, 10, [0u8; 32],
            &[(id(99), 100)],
            &[(id(2), 100)],
        ).unwrap();
        let result = post_entry(&accounts, &entry);
        assert_eq!(result, Err(AccountingError::AccountNotFound));
    }

    #[test]
    fn test_post_entry_multi_line() {
        let accounts = vec![
            make_asset(1, 0),
            make_asset(2, 0),
            make_liability(3, 0),
        ];
        let entry = create_journal_entry(
            1, 10, [0u8; 32],
            &[(id(1), 300), (id(2), 200)],
            &[(id(3), 500)],
        ).unwrap();
        let result = post_entry(&accounts, &entry).unwrap();
        assert_eq!(result[0].debit_balance, 300);
        assert_eq!(result[1].debit_balance, 200);
        assert_eq!(result[2].credit_balance, 500);
    }

    #[test]
    fn test_post_entry_same_account_debit_and_credit() {
        // An account can appear on both sides (e.g. reclassification)
        let accounts = vec![make_asset(1, 0), make_asset(2, 0)];
        let entry = create_journal_entry(
            1, 10, [0u8; 32],
            &[(id(1), 100)],
            &[(id(2), 100)],
        ).unwrap();
        let result = post_entry(&accounts, &entry).unwrap();
        assert_eq!(result[0].debit_balance, 100);
        assert_eq!(result[1].credit_balance, 100);
    }

    #[test]
    fn test_post_entry_does_not_mutate_original() {
        let accounts = vec![make_asset(1, 0), make_revenue(2, 0)];
        let entry = create_journal_entry(
            1, 10, [0u8; 32],
            &[(id(1), 100)],
            &[(id(2), 100)],
        ).unwrap();
        let _result = post_entry(&accounts, &entry).unwrap();
        // Original unchanged
        assert_eq!(accounts[0].debit_balance, 0);
    }

    // ============ Trial Balance Tests ============

    #[test]
    fn test_trial_balance_balanced() {
        let accounts = vec![make_asset(1, 0), make_revenue(2, 0)];
        let accounts = post_simple(&accounts, id(1), id(2), 1000, 10);
        let tb = trial_balance(&accounts);
        assert!(tb.is_balanced);
        assert_eq!(tb.total_debits, 1000);
        assert_eq!(tb.total_credits, 1000);
        assert_eq!(tb.difference, 0);
    }

    #[test]
    fn test_trial_balance_empty() {
        let tb = trial_balance(&[]);
        assert!(tb.is_balanced);
        assert_eq!(tb.total_debits, 0);
        assert_eq!(tb.total_credits, 0);
        assert_eq!(tb.account_count, 0);
    }

    #[test]
    fn test_trial_balance_single_account() {
        let accounts = vec![make_asset(1, 0)];
        let tb = trial_balance(&accounts);
        assert!(tb.is_balanced);
        assert_eq!(tb.account_count, 1);
    }

    #[test]
    fn test_trial_balance_unbalanced_manual() {
        // Manually create an unbalanced state (wouldn't happen through post_entry)
        let mut acct1 = make_asset(1, 0);
        acct1.debit_balance = 500;
        let acct2 = make_revenue(2, 0); // no credits
        let tb = trial_balance(&[acct1, acct2]);
        assert!(!tb.is_balanced);
        assert_eq!(tb.difference, 500);
    }

    #[test]
    fn test_trial_balance_many_accounts() {
        let mut accounts = Vec::new();
        for i in 0..10u8 {
            accounts.push(make_asset(i, 0));
        }
        for i in 10..20u8 {
            accounts.push(make_revenue(i, 0));
        }
        // Post entries pairing assets to revenues
        let mut current = accounts;
        for i in 0..10u8 {
            current = post_simple(&current, id(i), id(i + 10), 100, 10);
        }
        let tb = trial_balance(&current);
        assert!(tb.is_balanced);
        assert_eq!(tb.total_debits, 1000);
        assert_eq!(tb.account_count, 20);
    }

    #[test]
    fn test_trial_balance_account_count() {
        let accounts = vec![make_asset(1, 0), make_asset(2, 0), make_liability(3, 0)];
        let tb = trial_balance(&accounts);
        assert_eq!(tb.account_count, 3);
    }

    // ============ Balance Sheet Tests ============

    #[test]
    fn test_balance_sheet_simple_balanced() {
        // Asset 1000, Equity 1000 => Assets = Liabilities(0) + Equity(1000) + NetIncome(0)
        let mut asset = make_asset(1, 0);
        asset.debit_balance = 1000;
        let mut equity = make_equity(2, 0);
        equity.credit_balance = 1000;

        let bs = balance_sheet(&[asset, equity]);
        assert!(bs.is_balanced);
        assert_eq!(bs.total_assets, 1000);
        assert_eq!(bs.total_equity, 1000);
        assert_eq!(bs.net_income, 0);
    }

    #[test]
    fn test_balance_sheet_with_revenue_and_expense() {
        // Asset 1500, Liability 500, Revenue 2000, Expense 1000
        // Net income = 2000 - 1000 = 1000
        // Equation: 1500 = 500 + 0 + 1000 => balanced
        let mut asset = make_asset(1, 0);
        asset.debit_balance = 1500;
        let mut liability = make_liability(2, 0);
        liability.credit_balance = 500;
        let mut revenue = make_revenue(3, 0);
        revenue.credit_balance = 2000;
        let mut expense = make_expense(4, 0);
        expense.debit_balance = 1000;

        let bs = balance_sheet(&[asset, liability, revenue, expense]);
        assert!(bs.is_balanced);
        assert_eq!(bs.total_assets, 1500);
        assert_eq!(bs.total_liabilities, 500);
        assert_eq!(bs.total_revenue, 2000);
        assert_eq!(bs.total_expenses, 1000);
        assert_eq!(bs.net_income, 1000);
    }

    #[test]
    fn test_balance_sheet_negative_net_income() {
        // Asset 500, Expense 800, Revenue 300, Equity 1000
        // Net income = 300 - 800 = -500
        // Equation: 500 = 0 + 1000 + (-500) = 500 => balanced
        let mut asset = make_asset(1, 0);
        asset.debit_balance = 500;
        let mut expense = make_expense(2, 0);
        expense.debit_balance = 800;
        let mut revenue = make_revenue(3, 0);
        revenue.credit_balance = 300;
        let mut equity = make_equity(4, 0);
        equity.credit_balance = 1000;

        let bs = balance_sheet(&[asset, expense, revenue, equity]);
        assert!(bs.is_balanced);
        assert_eq!(bs.net_income, -500);
    }

    #[test]
    fn test_balance_sheet_empty() {
        let bs = balance_sheet(&[]);
        assert!(bs.is_balanced);
        assert_eq!(bs.total_assets, 0);
        assert_eq!(bs.net_income, 0);
    }

    #[test]
    fn test_balance_sheet_all_categories() {
        // A = 3000, L = 500, Eq = 1000, Rev = 2000, Exp = 500
        // Net income = 2000 - 500 = 1500
        // 3000 = 500 + 1000 + 1500 => balanced
        let mut a = make_asset(1, 0);
        a.debit_balance = 3000;
        let mut l = make_liability(2, 0);
        l.credit_balance = 500;
        let mut eq = make_equity(3, 0);
        eq.credit_balance = 1000;
        let mut rev = make_revenue(4, 0);
        rev.credit_balance = 2000;
        let mut exp = make_expense(5, 0);
        exp.debit_balance = 500;

        let bs = balance_sheet(&[a, l, eq, rev, exp]);
        assert!(bs.is_balanced);
        assert_eq!(bs.total_assets, 3000);
        assert_eq!(bs.total_liabilities, 500);
        assert_eq!(bs.total_equity, 1000);
        assert_eq!(bs.total_revenue, 2000);
        assert_eq!(bs.total_expenses, 500);
        assert_eq!(bs.net_income, 1500);
    }

    #[test]
    fn test_balance_sheet_unbalanced() {
        let mut a = make_asset(1, 0);
        a.debit_balance = 1000;
        // No equity/liability/revenue to balance
        let bs = balance_sheet(&[a]);
        assert!(!bs.is_balanced);
    }

    // ============ Reconciliation Tests ============

    #[test]
    fn test_reconcile_exact_match() {
        let mut acct = make_asset(1, 0);
        acct.debit_balance = 5000;
        let result = reconcile(&acct, 5000);
        assert!(result.is_reconciled);
        assert_eq!(result.difference, 0);
        assert_eq!(result.actual_balance, 5000);
    }

    #[test]
    fn test_reconcile_within_tolerance() {
        let mut acct = make_asset(1, 0);
        acct.debit_balance = 1001;
        let result = reconcile(&acct, 1000);
        assert!(result.is_reconciled);
        assert_eq!(result.difference, 1);
    }

    #[test]
    fn test_reconcile_outside_tolerance() {
        let mut acct = make_asset(1, 0);
        acct.debit_balance = 1003;
        let result = reconcile(&acct, 1000);
        assert!(!result.is_reconciled);
        assert_eq!(result.difference, 3);
    }

    #[test]
    fn test_reconcile_actual_less_than_expected() {
        let mut acct = make_asset(1, 0);
        acct.debit_balance = 999;
        let result = reconcile(&acct, 1000);
        assert!(result.is_reconciled); // difference = 1 <= tolerance
        assert_eq!(result.difference, 1);
    }

    #[test]
    fn test_reconcile_actual_far_less() {
        let mut acct = make_asset(1, 0);
        acct.debit_balance = 500;
        let result = reconcile(&acct, 1000);
        assert!(!result.is_reconciled);
        assert_eq!(result.difference, 500);
    }

    #[test]
    fn test_reconcile_zero_expected() {
        let acct = make_asset(1, 0);
        let result = reconcile(&acct, 0);
        assert!(result.is_reconciled);
        assert_eq!(result.difference, 0);
    }

    #[test]
    fn test_reconcile_zero_actual_nonzero_expected() {
        let acct = make_asset(1, 0);
        let result = reconcile(&acct, 100);
        assert!(!result.is_reconciled);
        assert_eq!(result.difference, 100);
    }

    #[test]
    fn test_reconcile_liability() {
        let mut acct = make_liability(2, 0);
        acct.credit_balance = 3000;
        let result = reconcile(&acct, 3000);
        assert!(result.is_reconciled);
        assert_eq!(result.actual_balance, 3000);
    }

    #[test]
    fn test_reconcile_tolerance_used() {
        let acct = make_asset(1, 0);
        let result = reconcile(&acct, 0);
        assert_eq!(result.tolerance_used, RECONCILIATION_TOLERANCE);
    }

    // ============ Audit Trail Tests ============

    #[test]
    fn test_audit_trail_no_entries() {
        let acct = make_asset(1, 0);
        let trail = audit_trail(&acct, &[]);
        assert_eq!(trail.opening_balance, 0);
        assert_eq!(trail.closing_balance, 0);
        assert_eq!(trail.total_debits, 0);
        assert_eq!(trail.total_credits, 0);
        assert_eq!(trail.entry_count, 0);
        assert!(trail.is_consistent);
    }

    #[test]
    fn test_audit_trail_single_debit() {
        // Post a debit to an asset account
        let mut acct = make_asset(1, 0);
        acct.debit_balance = 1000;
        let entry = create_journal_entry(
            1, 10, [0u8; 32],
            &[(id(1), 1000)],
            &[(id(2), 1000)],
        ).unwrap();
        let trail = audit_trail(&acct, &[entry]);
        assert_eq!(trail.closing_balance, 1000); // debit - credit = 1000 - 0
        assert_eq!(trail.total_debits, 1000);
        assert_eq!(trail.total_credits, 0);
        assert_eq!(trail.opening_balance, 0); // 1000 - 1000 + 0 = 0
        assert!(trail.is_consistent);
    }

    #[test]
    fn test_audit_trail_single_credit_revenue() {
        let mut acct = make_revenue(2, 0);
        acct.credit_balance = 500;
        let entry = create_journal_entry(
            1, 10, [0u8; 32],
            &[(id(1), 500)],
            &[(id(2), 500)],
        ).unwrap();
        let trail = audit_trail(&acct, &[entry]);
        assert_eq!(trail.closing_balance, 500);
        assert_eq!(trail.total_credits, 500);
        assert_eq!(trail.total_debits, 0);
        assert_eq!(trail.opening_balance, 0);
        assert!(trail.is_consistent);
    }

    #[test]
    fn test_audit_trail_multiple_entries() {
        let mut acct = make_asset(1, 0);
        acct.debit_balance = 300; // 100 + 200
        let e1 = create_journal_entry(1, 10, [0u8; 32], &[(id(1), 100)], &[(id(2), 100)]).unwrap();
        let e2 = create_journal_entry(2, 20, [0u8; 32], &[(id(1), 200)], &[(id(2), 200)]).unwrap();
        let trail = audit_trail(&acct, &[e1, e2]);
        assert_eq!(trail.total_debits, 300);
        assert_eq!(trail.closing_balance, 300);
        assert_eq!(trail.opening_balance, 0);
        assert_eq!(trail.entry_count, 2);
        assert!(trail.is_consistent);
    }

    #[test]
    fn test_audit_trail_debit_and_credit_same_account() {
        let mut acct = make_asset(1, 0);
        acct.debit_balance = 1000;
        acct.credit_balance = 300;
        // Entry 1: debit 1000
        let e1 = create_journal_entry(1, 10, [0u8; 32], &[(id(1), 1000)], &[(id(2), 1000)]).unwrap();
        // Entry 2: credit 300 (e.g. partial withdrawal)
        let e2 = create_journal_entry(2, 20, [0u8; 32], &[(id(2), 300)], &[(id(1), 300)]).unwrap();
        let trail = audit_trail(&acct, &[e1, e2]);
        assert_eq!(trail.closing_balance, 700);
        assert_eq!(trail.total_debits, 1000);
        assert_eq!(trail.total_credits, 300);
        assert_eq!(trail.opening_balance, 0);
        assert!(trail.is_consistent);
    }

    #[test]
    fn test_audit_trail_consistency_check() {
        // Consistent: opening + debits - credits = closing (asset)
        let mut acct = make_asset(1, 0);
        acct.debit_balance = 500;
        acct.credit_balance = 200;
        let e1 = create_journal_entry(1, 10, [0u8; 32], &[(id(1), 500)], &[(id(2), 500)]).unwrap();
        let e2 = create_journal_entry(2, 20, [0u8; 32], &[(id(2), 200)], &[(id(1), 200)]).unwrap();
        let trail = audit_trail(&acct, &[e1, e2]);
        assert!(trail.is_consistent);
        assert_eq!(trail.closing_balance, 300);
    }

    #[test]
    fn test_audit_trail_account_id_correct() {
        let acct = make_asset(42, 0);
        let trail = audit_trail(&acct, &[]);
        assert_eq!(trail.account_id, id(42));
    }

    // ============ Validate Accounting Equation Tests ============

    #[test]
    fn test_validate_equation_balanced() {
        let mut a = make_asset(1, 0);
        a.debit_balance = 1000;
        let mut eq = make_equity(2, 0);
        eq.credit_balance = 1000;
        assert!(validate_accounting_equation(&[a, eq]));
    }

    #[test]
    fn test_validate_equation_unbalanced() {
        let mut a = make_asset(1, 0);
        a.debit_balance = 1000;
        assert!(!validate_accounting_equation(&[a]));
    }

    #[test]
    fn test_validate_equation_empty() {
        assert!(validate_accounting_equation(&[]));
    }

    #[test]
    fn test_validate_equation_with_all_categories() {
        let mut a = make_asset(1, 0);
        a.debit_balance = 5000;
        let mut l = make_liability(2, 0);
        l.credit_balance = 1000;
        let mut eq = make_equity(3, 0);
        eq.credit_balance = 2000;
        let mut rev = make_revenue(4, 0);
        rev.credit_balance = 3000;
        let mut exp = make_expense(5, 0);
        exp.debit_balance = 1000;
        // A(5000) = L(1000) + Eq(2000) + (Rev(3000) - Exp(1000)) = 1000 + 2000 + 2000 = 5000
        assert!(validate_accounting_equation(&[a, l, eq, rev, exp]));
    }

    #[test]
    fn test_validate_equation_net_income_negative() {
        let mut a = make_asset(1, 0);
        a.debit_balance = 500;
        let mut eq = make_equity(2, 0);
        eq.credit_balance = 1000;
        let mut exp = make_expense(3, 0);
        exp.debit_balance = 500;
        // A(500) = Eq(1000) + (Rev(0) - Exp(500)) = 1000 - 500 = 500
        assert!(validate_accounting_equation(&[a, eq, exp]));
    }

    // ============ Find Account Tests ============

    #[test]
    fn test_find_account_exists() {
        let accounts = vec![make_asset(1, 0), make_asset(2, 0), make_asset(3, 0)];
        assert_eq!(find_account(&accounts, id(2)), Some(1));
    }

    #[test]
    fn test_find_account_first() {
        let accounts = vec![make_asset(1, 0), make_asset(2, 0)];
        assert_eq!(find_account(&accounts, id(1)), Some(0));
    }

    #[test]
    fn test_find_account_last() {
        let accounts = vec![make_asset(1, 0), make_asset(2, 0), make_asset(3, 0)];
        assert_eq!(find_account(&accounts, id(3)), Some(2));
    }

    #[test]
    fn test_find_account_not_found() {
        let accounts = vec![make_asset(1, 0), make_asset(2, 0)];
        assert_eq!(find_account(&accounts, id(99)), None);
    }

    #[test]
    fn test_find_account_empty() {
        assert_eq!(find_account(&[], id(1)), None);
    }

    // ============ Category Total Tests ============

    #[test]
    fn test_category_total_assets() {
        let mut a1 = make_asset(1, 0);
        a1.debit_balance = 1000;
        let mut a2 = make_asset(2, 0);
        a2.debit_balance = 2000;
        let mut l = make_liability(3, 0);
        l.credit_balance = 500;
        assert_eq!(category_total(&[a1, a2, l], AccountCategory::Asset), 3000);
    }

    #[test]
    fn test_category_total_liabilities() {
        let mut l1 = make_liability(1, 0);
        l1.credit_balance = 400;
        let mut l2 = make_liability(2, 0);
        l2.credit_balance = 600;
        assert_eq!(category_total(&[l1, l2], AccountCategory::Liability), 1000);
    }

    #[test]
    fn test_category_total_empty() {
        assert_eq!(category_total(&[], AccountCategory::Revenue), 0);
    }

    #[test]
    fn test_category_total_no_matching() {
        let a = make_asset(1, 0);
        assert_eq!(category_total(&[a], AccountCategory::Revenue), 0);
    }

    #[test]
    fn test_category_total_single() {
        let mut r = make_revenue(1, 0);
        r.credit_balance = 7777;
        assert_eq!(category_total(&[r], AccountCategory::Revenue), 7777);
    }

    // ============ Record Fee Revenue Tests ============

    #[test]
    fn test_record_fee_revenue_basic() {
        let entry = record_fee_revenue(id(1), id(2), 1000, 10, 1).unwrap();
        assert_eq!(entry.total_amount, 1000);
        assert_eq!(entry.debit_count, 1);
        assert_eq!(entry.credit_count, 1);
        assert_eq!(entry.debits[0].account_id, id(1));
        assert_eq!(entry.credits[0].account_id, id(2));
    }

    #[test]
    fn test_record_fee_revenue_zero_amount() {
        let result = record_fee_revenue(id(1), id(2), 0, 10, 1);
        assert_eq!(result, Err(AccountingError::ZeroAmount));
    }

    #[test]
    fn test_record_fee_revenue_large_amount() {
        let entry = record_fee_revenue(id(1), id(2), u128::MAX / 2, 10, 1).unwrap();
        assert_eq!(entry.total_amount, u128::MAX / 2);
    }

    #[test]
    fn test_record_fee_revenue_precision_amount() {
        let entry = record_fee_revenue(id(1), id(2), PRECISION, 10, 1).unwrap();
        assert_eq!(entry.total_amount, PRECISION);
    }

    #[test]
    fn test_record_fee_revenue_description_hash() {
        let entry = record_fee_revenue(id(1), id(2), 100, 10, 1).unwrap();
        assert_eq!(entry.description_hash, [0xFEu8; 32]);
    }

    #[test]
    fn test_record_fee_revenue_post_and_verify() {
        let accounts = vec![make_asset(1, 0), make_revenue(2, 0)];
        let entry = record_fee_revenue(id(1), id(2), 500, 10, 1).unwrap();
        let result = post_entry(&accounts, &entry).unwrap();
        assert_eq!(net_balance(&result[0]), 500); // asset increased
        assert_eq!(net_balance(&result[1]), 500); // revenue increased
    }

    // ============ Record Emission Tests ============

    #[test]
    fn test_record_emission_default_split() {
        // 50% Shapley, 35% Gauge, 15% Staking
        let entry = record_emission(
            id(1), 10000, id(2), id(3), id(4),
            5000, 3500, 100,
        ).unwrap();
        assert_eq!(entry.total_amount, 10000);
        assert_eq!(entry.debit_count, 1);
        assert_eq!(entry.credit_count, 3);
        // Shapley: 10000 * 5000 / 10000 = 5000
        assert_eq!(entry.credits[0].amount, 5000);
        // Gauge: 10000 * 3500 / 10000 = 3500
        assert_eq!(entry.credits[1].amount, 3500);
        // Staking: 10000 - 5000 - 3500 = 1500 (remainder)
        assert_eq!(entry.credits[2].amount, 1500);
    }

    #[test]
    fn test_record_emission_remainder_goes_to_staking() {
        // Use amounts that cause rounding
        let entry = record_emission(
            id(1), 10001, id(2), id(3), id(4),
            5000, 3500, 100,
        ).unwrap();
        let shapley = mul_div(10001, 5000, BPS); // 5000
        let gauge = mul_div(10001, 3500, BPS);   // 3500
        let staking = 10001 - shapley - gauge;    // remainder
        assert_eq!(entry.credits[0].amount, shapley);
        assert_eq!(entry.credits[1].amount, gauge);
        assert_eq!(entry.credits[2].amount, staking);
        // Sum must equal total
        assert_eq!(shapley + gauge + staking, 10001);
    }

    #[test]
    fn test_record_emission_zero_amount() {
        let result = record_emission(
            id(1), 0, id(2), id(3), id(4),
            5000, 3500, 100,
        );
        assert_eq!(result, Err(AccountingError::ZeroAmount));
    }

    #[test]
    fn test_record_emission_bps_exceed_10000() {
        let result = record_emission(
            id(1), 10000, id(2), id(3), id(4),
            6000, 5000, 100, // 11000 > 10000
        );
        assert_eq!(result, Err(AccountingError::InvalidAmount));
    }

    #[test]
    fn test_record_emission_zero_shapley_bps() {
        // If shapley_bps = 0, shapley_share = 0 => ZeroAmount
        let result = record_emission(
            id(1), 10000, id(2), id(3), id(4),
            0, 3500, 100,
        );
        assert_eq!(result, Err(AccountingError::ZeroAmount));
    }

    #[test]
    fn test_record_emission_zero_gauge_bps() {
        let result = record_emission(
            id(1), 10000, id(2), id(3), id(4),
            5000, 0, 100,
        );
        assert_eq!(result, Err(AccountingError::ZeroAmount));
    }

    #[test]
    fn test_record_emission_zero_staking_remainder() {
        // If shapley + gauge = 10000 bps, staking gets 0 => ZeroAmount
        let result = record_emission(
            id(1), 10000, id(2), id(3), id(4),
            5000, 5000, 100,
        );
        assert_eq!(result, Err(AccountingError::ZeroAmount));
    }

    #[test]
    fn test_record_emission_large_amount() {
        let amount = 1_000_000 * PRECISION;
        let entry = record_emission(
            id(1), amount, id(2), id(3), id(4),
            5000, 3500, 100,
        ).unwrap();
        assert_eq!(entry.total_amount, amount);
    }

    #[test]
    fn test_record_emission_equal_split() {
        // 3333 + 3333 + remainder(3334) = 10000
        let entry = record_emission(
            id(1), 10000, id(2), id(3), id(4),
            3333, 3333, 100,
        ).unwrap();
        let shapley = mul_div(10000, 3333, BPS);
        let gauge = mul_div(10000, 3333, BPS);
        let staking = 10000 - shapley - gauge;
        assert_eq!(entry.credits[0].amount, shapley);
        assert_eq!(entry.credits[1].amount, gauge);
        assert_eq!(entry.credits[2].amount, staking);
        assert_eq!(shapley + gauge + staking, 10000);
    }

    #[test]
    fn test_record_emission_description_hash() {
        let entry = record_emission(
            id(1), 10000, id(2), id(3), id(4),
            5000, 3500, 100,
        ).unwrap();
        assert_eq!(entry.description_hash, [0xE0u8; 32]);
    }

    #[test]
    fn test_record_emission_account_ids() {
        let entry = record_emission(
            id(10), 10000, id(20), id(30), id(40),
            5000, 3500, 100,
        ).unwrap();
        assert_eq!(entry.debits[0].account_id, id(10));
        assert_eq!(entry.credits[0].account_id, id(20));
        assert_eq!(entry.credits[1].account_id, id(30));
        assert_eq!(entry.credits[2].account_id, id(40));
    }

    #[test]
    fn test_record_emission_post_and_verify() {
        let accounts = vec![
            make_expense(1, 0),   // treasury/emission source
            make_asset(2, 0),     // shapley
            make_asset(3, 0),     // gauge
            make_asset(4, 0),     // staking
        ];
        let entry = record_emission(
            id(1), 10000, id(2), id(3), id(4),
            5000, 3500, 100,
        ).unwrap();
        let result = post_entry(&accounts, &entry).unwrap();
        // Source debited
        assert_eq!(result[0].debit_balance, 10000);
        // Sinks credited
        assert_eq!(result[1].credit_balance, 5000);
        assert_eq!(result[2].credit_balance, 3500);
        assert_eq!(result[3].credit_balance, 1500);
    }

    // ============ Period Summary Tests ============

    #[test]
    fn test_period_summary_full_range() {
        let e1 = create_journal_entry(1, 10, [0u8; 32], &[(id(1), 100)], &[(id(2), 100)]).unwrap();
        let e2 = create_journal_entry(2, 20, [0u8; 32], &[(id(1), 200)], &[(id(2), 200)]).unwrap();
        let e3 = create_journal_entry(3, 30, [0u8; 32], &[(id(1), 300)], &[(id(2), 300)]).unwrap();
        let (vol, count) = period_summary(&[e1, e2, e3], 0, 100);
        assert_eq!(vol, 600);
        assert_eq!(count, 3);
    }

    #[test]
    fn test_period_summary_partial_range() {
        let e1 = create_journal_entry(1, 10, [0u8; 32], &[(id(1), 100)], &[(id(2), 100)]).unwrap();
        let e2 = create_journal_entry(2, 20, [0u8; 32], &[(id(1), 200)], &[(id(2), 200)]).unwrap();
        let e3 = create_journal_entry(3, 30, [0u8; 32], &[(id(1), 300)], &[(id(2), 300)]).unwrap();
        let (vol, count) = period_summary(&[e1, e2, e3], 15, 25);
        assert_eq!(vol, 200);
        assert_eq!(count, 1);
    }

    #[test]
    fn test_period_summary_empty() {
        let (vol, count) = period_summary(&[], 0, 100);
        assert_eq!(vol, 0);
        assert_eq!(count, 0);
    }

    #[test]
    fn test_period_summary_no_match() {
        let e1 = create_journal_entry(1, 10, [0u8; 32], &[(id(1), 100)], &[(id(2), 100)]).unwrap();
        let (vol, count) = period_summary(&[e1], 50, 100);
        assert_eq!(vol, 0);
        assert_eq!(count, 0);
    }

    #[test]
    fn test_period_summary_inclusive_boundaries() {
        let e1 = create_journal_entry(1, 10, [0u8; 32], &[(id(1), 100)], &[(id(2), 100)]).unwrap();
        let e2 = create_journal_entry(2, 20, [0u8; 32], &[(id(1), 200)], &[(id(2), 200)]).unwrap();
        // Both boundaries inclusive
        let (vol, count) = period_summary(&[e1, e2], 10, 20);
        assert_eq!(vol, 300);
        assert_eq!(count, 2);
    }

    #[test]
    fn test_period_summary_single_block() {
        let e1 = create_journal_entry(1, 50, [0u8; 32], &[(id(1), 999)], &[(id(2), 999)]).unwrap();
        let (vol, count) = period_summary(&[e1], 50, 50);
        assert_eq!(vol, 999);
        assert_eq!(count, 1);
    }

    // ============ Edge Case Tests ============

    #[test]
    fn test_precision_amount_entry() {
        let entry = create_journal_entry(
            1, 100, [0u8; 32],
            &[(id(1), PRECISION)],
            &[(id(2), PRECISION)],
        ).unwrap();
        assert_eq!(entry.total_amount, PRECISION);
    }

    #[test]
    fn test_large_balance_reconciliation() {
        let mut acct = make_asset(1, 0);
        acct.debit_balance = u128::MAX;
        let result = reconcile(&acct, u128::MAX);
        assert!(result.is_reconciled);
        assert_eq!(result.difference, 0);
    }

    #[test]
    fn test_max_minus_one_reconciliation() {
        let mut acct = make_asset(1, 0);
        acct.debit_balance = u128::MAX - 1;
        let result = reconcile(&acct, u128::MAX);
        assert!(result.is_reconciled); // difference = 1 <= tolerance
    }

    #[test]
    fn test_many_accounts_category_total() {
        let mut accounts = Vec::new();
        for i in 0..MAX_ACCOUNTS {
            let mut a = make_asset(i as u8, 0);
            a.debit_balance = 100;
            accounts.push(a);
        }
        assert_eq!(category_total(&accounts, AccountCategory::Asset), 100 * MAX_ACCOUNTS as u128);
    }

    #[test]
    fn test_journal_entry_1_wei() {
        let entry = create_journal_entry(
            1, 100, [0u8; 32],
            &[(id(1), 1)],
            &[(id(2), 1)],
        ).unwrap();
        assert_eq!(entry.total_amount, 1);
    }

    // ============ Integration / End-to-End Tests ============

    #[test]
    fn test_full_lifecycle() {
        // Create accounts
        let asset = make_asset(1, 0);
        let revenue = make_revenue(2, 0);
        let equity = make_equity(3, 0);
        let accounts = vec![asset, revenue, equity];

        // Record initial equity investment
        let e1 = create_journal_entry(1, 10, [0u8; 32], &[(id(1), 10000)], &[(id(3), 10000)]).unwrap();
        let accounts = post_entry(&accounts, &e1).unwrap();

        // Record fee revenue
        let e2 = record_fee_revenue(id(1), id(2), 500, 20, 2).unwrap();
        let accounts = post_entry(&accounts, &e2).unwrap();

        // Trial balance should be balanced
        let tb = trial_balance(&accounts);
        assert!(tb.is_balanced);
        assert_eq!(tb.total_debits, 10500);

        // Balance sheet should be balanced
        let bs = balance_sheet(&accounts);
        assert!(bs.is_balanced);
        assert_eq!(bs.total_assets, 10500);
        assert_eq!(bs.total_equity, 10000);
        assert_eq!(bs.total_revenue, 500);
        assert_eq!(bs.net_income, 500);

        // Accounting equation
        assert!(validate_accounting_equation(&accounts));
    }

    #[test]
    fn test_emission_lifecycle() {
        // Treasury, Shapley, Gauge, Staking
        let treasury = make_expense(1, 0);
        let shapley = make_asset(2, 0);
        let gauge = make_asset(3, 0);
        let staking = make_asset(4, 0);
        let accounts = vec![treasury, shapley, gauge, staking];

        let entry = record_emission(
            id(1), 100 * PRECISION, id(2), id(3), id(4),
            5000, 3500, 10,
        ).unwrap();
        let accounts = post_entry(&accounts, &entry).unwrap();

        let _shapley_bal = net_balance(&accounts[1]);
        let _gauge_bal = net_balance(&accounts[2]);
        let _staking_bal = net_balance(&accounts[3]);

        // Sum of sinks = 0 because these are asset accounts that got credits
        // Actually: assets are credited => they're contra-assets (credit > debit)
        // net_balance returns 0 for contra-assets.
        // Let's check raw balances instead.
        assert_eq!(accounts[1].credit_balance, 50 * PRECISION);
        assert_eq!(accounts[2].credit_balance, 35 * PRECISION);
        assert_eq!(accounts[3].credit_balance, 15 * PRECISION);
        assert_eq!(
            accounts[1].credit_balance + accounts[2].credit_balance + accounts[3].credit_balance,
            100 * PRECISION
        );
    }

    #[test]
    fn test_audit_trail_full_lifecycle() {
        let asset = make_asset(1, 0);
        let revenue = make_revenue(2, 0);
        let accounts = vec![asset, revenue];

        let e1 = create_journal_entry(1, 10, [0u8; 32], &[(id(1), 1000)], &[(id(2), 1000)]).unwrap();
        let e2 = create_journal_entry(2, 20, [0u8; 32], &[(id(1), 500)], &[(id(2), 500)]).unwrap();
        let accounts = post_entry(&accounts, &e1).unwrap();
        let accounts = post_entry(&accounts, &e2).unwrap();

        let trail = audit_trail(&accounts[0], &[e1, e2]);
        assert_eq!(trail.opening_balance, 0);
        assert_eq!(trail.total_debits, 1500);
        assert_eq!(trail.total_credits, 0);
        assert_eq!(trail.closing_balance, 1500);
        assert!(trail.is_consistent);
    }

    #[test]
    fn test_period_summary_with_emission() {
        let e1 = record_emission(
            id(1), 10000, id(2), id(3), id(4),
            5000, 3500, 10,
        ).unwrap();
        let e2 = record_fee_revenue(id(5), id(6), 500, 20, 2).unwrap();

        let (vol, count) = period_summary(&[e1, e2], 0, 100);
        assert_eq!(vol, 10500);
        assert_eq!(count, 2);
    }

    #[test]
    fn test_reconcile_after_multiple_entries() {
        let asset = make_asset(1, 0);
        let revenue = make_revenue(2, 0);
        let accounts = vec![asset, revenue];

        let e1 = create_journal_entry(1, 10, [0u8; 32], &[(id(1), 1000)], &[(id(2), 1000)]).unwrap();
        let e2 = create_journal_entry(2, 20, [0u8; 32], &[(id(2), 300)], &[(id(1), 300)]).unwrap();
        let accounts = post_entry(&accounts, &e1).unwrap();
        let accounts = post_entry(&accounts, &e2).unwrap();

        // Asset: debit 1000, credit 300 => net 700
        let result = reconcile(&accounts[0], 700);
        assert!(result.is_reconciled);
        assert_eq!(result.difference, 0);
    }

    #[test]
    fn test_balance_sheet_after_full_cycle() {
        // Create a full set of accounts
        let asset = make_asset(1, 0);
        let liability = make_liability(2, 0);
        let equity = make_equity(3, 0);
        let revenue = make_revenue(4, 0);
        let expense = make_expense(5, 0);
        let accounts = vec![asset, liability, equity, revenue, expense];

        // Initial equity: debit asset, credit equity
        let e1 = create_journal_entry(1, 10, [0u8; 32], &[(id(1), 10000)], &[(id(3), 10000)]).unwrap();
        let accounts = post_entry(&accounts, &e1).unwrap();

        // Take on liability: debit asset, credit liability
        let e2 = create_journal_entry(2, 20, [0u8; 32], &[(id(1), 5000)], &[(id(2), 5000)]).unwrap();
        let accounts = post_entry(&accounts, &e2).unwrap();

        // Earn revenue: debit asset, credit revenue
        let e3 = create_journal_entry(3, 30, [0u8; 32], &[(id(1), 2000)], &[(id(4), 2000)]).unwrap();
        let accounts = post_entry(&accounts, &e3).unwrap();

        // Pay expense: debit expense, credit asset
        let e4 = create_journal_entry(4, 40, [0u8; 32], &[(id(5), 800)], &[(id(1), 800)]).unwrap();
        let accounts = post_entry(&accounts, &e4).unwrap();

        let bs = balance_sheet(&accounts);
        // Asset: debit 17000, credit 800 => net 16200
        assert_eq!(bs.total_assets, 16200);
        // Liability: 5000
        assert_eq!(bs.total_liabilities, 5000);
        // Equity: 10000
        assert_eq!(bs.total_equity, 10000);
        // Revenue: 2000
        assert_eq!(bs.total_revenue, 2000);
        // Expense: 800
        assert_eq!(bs.total_expenses, 800);
        // Net Income: 2000 - 800 = 1200
        assert_eq!(bs.net_income, 1200);
        // 16200 = 5000 + 10000 + 1200 = 16200
        assert!(bs.is_balanced);
    }

    #[test]
    fn test_find_account_multiple_same_category() {
        let accounts = vec![
            make_asset(10, 0),
            make_asset(20, 0),
            make_asset(30, 0),
        ];
        assert_eq!(find_account(&accounts, id(20)), Some(1));
        assert_eq!(find_account(&accounts, id(10)), Some(0));
        assert_eq!(find_account(&accounts, id(30)), Some(2));
    }

    #[test]
    fn test_category_total_mixed() {
        let mut a = make_asset(1, 0);
        a.debit_balance = 1000;
        let mut l = make_liability(2, 0);
        l.credit_balance = 500;
        let mut r = make_revenue(3, 0);
        r.credit_balance = 200;
        let mut e = make_expense(4, 0);
        e.debit_balance = 100;
        let mut eq = make_equity(5, 0);
        eq.credit_balance = 300;

        assert_eq!(category_total(&[a.clone(), l.clone(), r.clone(), e.clone(), eq.clone()], AccountCategory::Asset), 1000);
        assert_eq!(category_total(&[a.clone(), l.clone(), r.clone(), e.clone(), eq.clone()], AccountCategory::Liability), 500);
        assert_eq!(category_total(&[a.clone(), l.clone(), r.clone(), e.clone(), eq.clone()], AccountCategory::Revenue), 200);
        assert_eq!(category_total(&[a.clone(), l.clone(), r.clone(), e.clone(), eq.clone()], AccountCategory::Expense), 100);
        assert_eq!(category_total(&[a, l, r, e, eq], AccountCategory::Equity), 300);
    }

    #[test]
    fn test_net_balance_precision_values() {
        let mut acct = make_asset(1, 0);
        acct.debit_balance = 100 * PRECISION;
        acct.credit_balance = 30 * PRECISION;
        assert_eq!(net_balance(&acct), 70 * PRECISION);
    }

    #[test]
    fn test_trial_balance_precision_amounts() {
        let accounts = vec![make_asset(1, 0), make_revenue(2, 0)];
        let accounts = post_simple(&accounts, id(1), id(2), 100 * PRECISION, 10);
        let tb = trial_balance(&accounts);
        assert!(tb.is_balanced);
        assert_eq!(tb.total_debits, 100 * PRECISION);
    }

    #[test]
    fn test_reconcile_precision() {
        let mut acct = make_asset(1, 0);
        acct.debit_balance = 50 * PRECISION;
        let result = reconcile(&acct, 50 * PRECISION);
        assert!(result.is_reconciled);
    }

    #[test]
    fn test_record_emission_precision_amounts() {
        let entry = record_emission(
            id(1), 1000 * PRECISION, id(2), id(3), id(4),
            5000, 3500, 100,
        ).unwrap();
        assert_eq!(entry.credits[0].amount, 500 * PRECISION);
        assert_eq!(entry.credits[1].amount, 350 * PRECISION);
        assert_eq!(entry.credits[2].amount, 150 * PRECISION);
    }

    #[test]
    fn test_post_entry_overflow_protection() {
        let mut acct = make_asset(1, 0);
        acct.debit_balance = u128::MAX - 10;
        let rev = make_revenue(2, 0);
        let entry = create_journal_entry(
            1, 10, [0u8; 32],
            &[(id(1), 100)],
            &[(id(2), 100)],
        ).unwrap();
        let result = post_entry(&[acct, rev], &entry);
        assert_eq!(result, Err(AccountingError::Overflow));
    }

    #[test]
    fn test_audit_trail_entry_count_ignores_unrelated() {
        let acct = make_asset(1, 0);
        // Entry that doesn't touch account 1
        let entry = create_journal_entry(
            1, 10, [0u8; 32],
            &[(id(99), 100)],
            &[(id(98), 100)],
        ).unwrap();
        let trail = audit_trail(&acct, &[entry]);
        assert_eq!(trail.entry_count, 0);
        assert_eq!(trail.total_debits, 0);
        assert_eq!(trail.total_credits, 0);
    }

    #[test]
    fn test_balance_sheet_large_values() {
        let mut a = make_asset(1, 0);
        a.debit_balance = u128::MAX / 4;
        let mut eq = make_equity(2, 0);
        eq.credit_balance = u128::MAX / 4;
        let bs = balance_sheet(&[a, eq]);
        assert!(bs.is_balanced);
    }

    #[test]
    fn test_create_journal_entry_same_account_both_sides() {
        // Same account on debit and credit side is valid (reclassification)
        let entry = create_journal_entry(
            1, 100, [0u8; 32],
            &[(id(1), 500)],
            &[(id(1), 500)],
        ).unwrap();
        assert_eq!(entry.total_amount, 500);
    }

    #[test]
    fn test_record_emission_odd_amounts() {
        // 7777 tokens, 3333 bps shapley, 3333 bps gauge, rest to staking
        let entry = record_emission(
            id(1), 7777, id(2), id(3), id(4),
            3333, 3333, 100,
        ).unwrap();
        let s = entry.credits[0].amount;
        let g = entry.credits[1].amount;
        let st = entry.credits[2].amount;
        assert_eq!(s + g + st, 7777);
    }

    #[test]
    fn test_record_emission_1_wei() {
        // Very small emission — might cause zero shares
        let result = record_emission(
            id(1), 1, id(2), id(3), id(4),
            5000, 3500, 100,
        );
        // 1 * 5000 / 10000 = 0 => ZeroAmount
        assert_eq!(result, Err(AccountingError::ZeroAmount));
    }

    #[test]
    fn test_record_emission_minimum_viable() {
        // Minimum amount that produces non-zero for all 3 sinks
        // Need: shapley >= 1, gauge >= 1, staking >= 1
        // With 5000/3500: need amount >= 3 (5000/10000*3=1, 3500/10000*3=1, remainder=1)
        let entry = record_emission(
            id(1), 3, id(2), id(3), id(4),
            5000, 3500, 100,
        ).unwrap();
        assert_eq!(entry.credits[0].amount + entry.credits[1].amount + entry.credits[2].amount, 3);
    }

    #[test]
    fn test_period_summary_block_zero() {
        let e1 = create_journal_entry(1, 0, [0u8; 32], &[(id(1), 100)], &[(id(2), 100)]).unwrap();
        let (vol, count) = period_summary(&[e1], 0, 0);
        assert_eq!(vol, 100);
        assert_eq!(count, 1);
    }

    #[test]
    fn test_period_summary_max_block() {
        let e1 = create_journal_entry(1, u64::MAX, [0u8; 32], &[(id(1), 100)], &[(id(2), 100)]).unwrap();
        let (vol, count) = period_summary(&[e1], u64::MAX, u64::MAX);
        assert_eq!(vol, 100);
        assert_eq!(count, 1);
    }

    #[test]
    fn test_multiple_fee_revenues() {
        let accounts = vec![make_asset(1, 0), make_revenue(2, 0)];
        let e1 = record_fee_revenue(id(1), id(2), 100, 10, 1).unwrap();
        let e2 = record_fee_revenue(id(1), id(2), 200, 20, 2).unwrap();
        let e3 = record_fee_revenue(id(1), id(2), 300, 30, 3).unwrap();
        let accounts = post_entry(&accounts, &e1).unwrap();
        let accounts = post_entry(&accounts, &e2).unwrap();
        let accounts = post_entry(&accounts, &e3).unwrap();
        assert_eq!(net_balance(&accounts[0]), 600);
        assert_eq!(net_balance(&accounts[1]), 600);
    }

    #[test]
    fn test_validate_equation_revenue_heavy() {
        // Lots of revenue, no expense
        let mut a = make_asset(1, 0);
        a.debit_balance = 5000;
        let mut r = make_revenue(2, 0);
        r.credit_balance = 5000;
        assert!(validate_accounting_equation(&[a, r]));
    }

    #[test]
    fn test_validate_equation_expense_heavy() {
        // Expense > Revenue => negative net income
        let mut a = make_asset(1, 0);
        a.debit_balance = 200;
        let mut eq = make_equity(2, 0);
        eq.credit_balance = 1000;
        let mut exp = make_expense(3, 0);
        exp.debit_balance = 800;
        // A = 200, Eq = 1000, NI = 0 - 800 = -800
        // 200 = 1000 + (-800) = 200 => balanced
        assert!(validate_accounting_equation(&[a, eq, exp]));
    }

    // ============ Hardening Batch v4 ============

    #[test]
    fn test_net_balance_expense_contra_v4() {
        // Expense with credit > debit (contra expense) saturates to 0
        let mut acct = make_expense(4, 0);
        acct.debit_balance = 50;
        acct.credit_balance = 200;
        assert_eq!(net_balance(&acct), 0);
    }

    #[test]
    fn test_net_balance_equity_contra_v4() {
        // Equity with debit > credit (contra equity) saturates to 0
        let mut acct = make_equity(5, 0);
        acct.debit_balance = 9000;
        acct.credit_balance = 1000;
        assert_eq!(net_balance(&acct), 0);
    }

    #[test]
    fn test_net_balance_revenue_contra_v4() {
        // Revenue with debit > credit (contra revenue) saturates to 0
        let mut acct = make_revenue(3, 0);
        acct.debit_balance = 5000;
        acct.credit_balance = 2000;
        assert_eq!(net_balance(&acct), 0);
    }

    #[test]
    fn test_net_balance_max_u128_saturating_v4() {
        // Verify saturating_sub works at max boundary
        let mut acct = make_liability(2, 0);
        acct.credit_balance = u128::MAX;
        acct.debit_balance = 1;
        assert_eq!(net_balance(&acct), u128::MAX - 1);
    }

    #[test]
    fn test_create_journal_entry_overflow_credits_v4() {
        // Credits overflow u128
        let result = create_journal_entry(
            1, 100, [0u8; 32],
            &[(id(1), u128::MAX)],
            &[(id(2), u128::MAX), (id(3), 1)],
        );
        assert_eq!(result, Err(AccountingError::Overflow));
    }

    #[test]
    fn test_create_journal_entry_five_debit_five_credit_balanced_v4() {
        // 5x5 with different amounts that balance
        let entry = create_journal_entry(
            99, 500, [0xABu8; 32],
            &[(id(1), 10), (id(2), 20), (id(3), 30), (id(4), 40), (id(5), 50)],
            &[(id(6), 50), (id(7), 40), (id(8), 30), (id(9), 20), (id(10), 10)],
        ).unwrap();
        assert_eq!(entry.total_amount, 150);
        assert_eq!(entry.debit_count, 5);
        assert_eq!(entry.credit_count, 5);
        assert_eq!(entry.entry_id, 99);
        assert_eq!(entry.block_number, 500);
    }

    #[test]
    fn test_post_entry_overflow_debit_balance_v4() {
        // Posting a debit that overflows the account's debit_balance
        let mut acct = make_asset(1, 0);
        acct.debit_balance = u128::MAX;
        let revenue = make_revenue(2, 0);
        let entry = create_journal_entry(
            1, 10, [0u8; 32],
            &[(id(1), 1)],
            &[(id(2), 1)],
        ).unwrap();
        let result = post_entry(&[acct, revenue], &entry);
        assert_eq!(result, Err(AccountingError::Overflow));
    }

    #[test]
    fn test_post_entry_overflow_credit_balance_v4() {
        // Posting a credit that overflows the account's credit_balance
        let asset = make_asset(1, 0);
        let mut revenue = make_revenue(2, 0);
        revenue.credit_balance = u128::MAX;
        let entry = create_journal_entry(
            1, 10, [0u8; 32],
            &[(id(1), 1)],
            &[(id(2), 1)],
        ).unwrap();
        let result = post_entry(&[asset, revenue], &entry);
        assert_eq!(result, Err(AccountingError::Overflow));
    }

    #[test]
    fn test_trial_balance_saturating_add_v4() {
        // Trial balance uses saturating_add; verify it doesn't panic with large values
        let mut a1 = make_asset(1, 0);
        a1.debit_balance = u128::MAX / 2;
        let mut a2 = make_asset(2, 0);
        a2.debit_balance = u128::MAX / 2;
        let mut r = make_revenue(3, 0);
        r.credit_balance = u128::MAX;
        let tb = trial_balance(&[a1, a2, r]);
        // Debits saturated, credits = MAX → not balanced (MAX-1 vs MAX)
        assert!(!tb.is_balanced);
    }

    #[test]
    fn test_balance_sheet_only_revenue_v4() {
        // Only revenue accounts → assets=0, net_income = revenue
        let mut r = make_revenue(1, 0);
        r.credit_balance = 5000;
        let bs = balance_sheet(&[r]);
        assert!(!bs.is_balanced); // 0 != 0 + 0 + 5000
        assert_eq!(bs.total_revenue, 5000);
        assert_eq!(bs.net_income, 5000);
    }

    #[test]
    fn test_balance_sheet_only_expenses_v4() {
        // Only expense accounts
        let mut e = make_expense(1, 0);
        e.debit_balance = 3000;
        let bs = balance_sheet(&[e]);
        assert!(!bs.is_balanced); // 0 != 0 + 0 + (-3000)
        assert_eq!(bs.total_expenses, 3000);
        assert_eq!(bs.net_income, -3000);
    }

    #[test]
    fn test_reconcile_large_difference_v4() {
        // Large difference between actual and expected
        let mut acct = make_asset(1, 0);
        acct.debit_balance = 0;
        let result = reconcile(&acct, u128::MAX);
        assert!(!result.is_reconciled);
        assert_eq!(result.difference, u128::MAX);
    }

    #[test]
    fn test_reconcile_liability_contra_v4() {
        // Liability in contra state (debit > credit) → net balance 0
        let mut acct = make_liability(2, 0);
        acct.debit_balance = 5000;
        acct.credit_balance = 1000;
        let result = reconcile(&acct, 0);
        assert!(result.is_reconciled);
        assert_eq!(result.actual_balance, 0);
    }

    #[test]
    fn test_audit_trail_liability_account_v4() {
        // Audit trail for a liability account (normal credit balance)
        let mut acct = make_liability(2, 0);
        acct.credit_balance = 1500;
        acct.debit_balance = 500;
        let e1 = create_journal_entry(1, 10, [0u8; 32], &[(id(1), 1500)], &[(id(2), 1500)]).unwrap();
        let e2 = create_journal_entry(2, 20, [0u8; 32], &[(id(2), 500)], &[(id(1), 500)]).unwrap();
        let trail = audit_trail(&acct, &[e1, e2]);
        assert_eq!(trail.closing_balance, 1000); // credit(1500) - debit(500)
        assert_eq!(trail.total_credits, 1500);
        assert_eq!(trail.total_debits, 500);
        assert!(trail.is_consistent);
    }

    #[test]
    fn test_audit_trail_equity_v4() {
        let mut acct = make_equity(5, 0);
        acct.credit_balance = 10000;
        let e1 = create_journal_entry(1, 10, [0u8; 32], &[(id(1), 10000)], &[(id(5), 10000)]).unwrap();
        let trail = audit_trail(&acct, &[e1]);
        assert_eq!(trail.closing_balance, 10000);
        assert_eq!(trail.opening_balance, 0);
        assert!(trail.is_consistent);
    }

    #[test]
    fn test_audit_trail_irrelevant_entries_v4() {
        // Entries that don't reference this account should not contribute
        let acct = make_asset(1, 0);
        let e1 = create_journal_entry(1, 10, [0u8; 32], &[(id(99), 1000)], &[(id(98), 1000)]).unwrap();
        let trail = audit_trail(&acct, &[e1]);
        assert_eq!(trail.total_debits, 0);
        assert_eq!(trail.total_credits, 0);
        assert_eq!(trail.entry_count, 0);
        assert!(trail.is_consistent);
    }

    #[test]
    fn test_category_total_mixed_contra_v4() {
        // Mix of normal and contra accounts in same category
        let mut a1 = make_asset(1, 0);
        a1.debit_balance = 1000;
        a1.credit_balance = 0; // normal: net = 1000
        let mut a2 = make_asset(2, 0);
        a2.debit_balance = 100;
        a2.credit_balance = 500; // contra: net = 0 (saturating)
        assert_eq!(category_total(&[a1, a2], AccountCategory::Asset), 1000);
    }

    #[test]
    fn test_record_emission_minimum_valid_amount_v4() {
        // Smallest amount that yields all three non-zero shares
        // With 1/1 bps split, we need at least BPS / gcd which is complex
        // Use 5000/4999 → shapley=floor(amount*5000/10000), gauge=floor(amount*4999/10000)
        // For amount=2: shapley=1, gauge=0 → zero gauge → fail
        // For amount=3: shapley=1, gauge=1, staking=1 → ok with 3334/3333 split
        let result = record_emission(
            id(1), 3, id(2), id(3), id(4),
            3334, 3333, 100,
        );
        // shapley = mul_div(3, 3334, 10000) = 1, gauge = mul_div(3, 3333, 10000) = 0 → ZeroAmount
        assert_eq!(result, Err(AccountingError::ZeroAmount));
    }

    #[test]
    fn test_record_emission_bps_exactly_10000_v4() {
        // shapley + gauge = 10000 → staking = 0 → ZeroAmount
        let result = record_emission(
            id(1), 10000, id(2), id(3), id(4),
            7000, 3000, 100,
        );
        assert_eq!(result, Err(AccountingError::ZeroAmount));
    }

    #[test]
    fn test_record_fee_revenue_entry_id_preserved_v4() {
        let entry = record_fee_revenue(id(1), id(2), 500, 10, 42).unwrap();
        assert_eq!(entry.entry_id, 42);
    }

    #[test]
    fn test_record_fee_revenue_block_preserved_v4() {
        let entry = record_fee_revenue(id(1), id(2), 500, 999, 1).unwrap();
        assert_eq!(entry.block_number, 999);
    }

    #[test]
    fn test_period_summary_many_entries_v4() {
        let mut entries = Vec::new();
        for i in 0..50u64 {
            let e = create_journal_entry(i, i * 10, [0u8; 32], &[(id(1), 100)], &[(id(2), 100)]).unwrap();
            entries.push(e);
        }
        let (vol, count) = period_summary(&entries, 0, 500);
        assert_eq!(count, 50);
        assert_eq!(vol, 5000);
    }

    #[test]
    fn test_find_account_duplicate_ids_returns_first_v4() {
        // Two accounts with same id — find_account returns first occurrence
        let a1 = make_asset(1, 10);
        let a2 = make_asset(1, 20);
        assert_eq!(find_account(&[a1, a2], id(1)), Some(0));
    }

    #[test]
    fn test_full_lifecycle_with_emission_v4() {
        // Create all 5 account types and post emission + fee entries
        let treasury = make_expense(1, 0);
        let shapley = make_asset(2, 0);
        let gauge = make_asset(3, 0);
        let staking = make_asset(4, 0);
        let equity = make_equity(5, 0);
        let accounts = vec![treasury, shapley, gauge, staking, equity];

        // Initial equity
        let eq_entry = create_journal_entry(1, 10, [0u8; 32], &[(id(2), 50000)], &[(id(5), 50000)]).unwrap();
        let accounts = post_entry(&accounts, &eq_entry).unwrap();

        // Emission
        let em_entry = record_emission(id(1), 10000, id(2), id(3), id(4), 5000, 3500, 20).unwrap();
        let accounts = post_entry(&accounts, &em_entry).unwrap();

        let tb = trial_balance(&accounts);
        assert!(tb.is_balanced);
    }

    #[test]
    fn test_balance_sheet_large_precision_values_v4() {
        // Use PRECISION-scaled values (realistic DeFi scenario)
        let mut a = make_asset(1, 0);
        a.debit_balance = 1_000_000 * PRECISION;
        let mut l = make_liability(2, 0);
        l.credit_balance = 300_000 * PRECISION;
        let mut eq = make_equity(3, 0);
        eq.credit_balance = 200_000 * PRECISION;
        let mut rev = make_revenue(4, 0);
        rev.credit_balance = 600_000 * PRECISION;
        let mut exp = make_expense(5, 0);
        exp.debit_balance = 100_000 * PRECISION;
        // A(1M) = L(300K) + Eq(200K) + NI(600K - 100K = 500K) = 1M
        let bs = balance_sheet(&[a, l, eq, rev, exp]);
        assert!(bs.is_balanced);
        assert_eq!(bs.total_assets, 1_000_000 * PRECISION);
    }

    #[test]
    fn test_post_entry_entry_count_increments_both_sides_v4() {
        // Account appears on both debit and credit side of same entry
        let accounts = vec![make_asset(1, 0), make_asset(2, 0)];
        // Transfer between two asset accounts
        let e1 = create_journal_entry(1, 10, [0u8; 32], &[(id(1), 100)], &[(id(2), 100)]).unwrap();
        let result = post_entry(&accounts, &e1).unwrap();
        assert_eq!(result[0].entry_count, 1); // debited
        assert_eq!(result[1].entry_count, 1); // credited
    }

    #[test]
    fn test_create_journal_entry_same_account_both_sides_v4() {
        // Same account on both debit and credit (reclassification)
        let entry = create_journal_entry(
            1, 100, [0u8; 32],
            &[(id(1), 500)],
            &[(id(1), 500)],
        ).unwrap();
        assert_eq!(entry.total_amount, 500);
    }

    #[test]
    fn test_post_same_account_both_sides_v4() {
        // Post entry where same account is debited and credited
        let accounts = vec![make_asset(1, 0)];
        let entry = create_journal_entry(
            1, 10, [0u8; 32],
            &[(id(1), 1000)],
            &[(id(1), 1000)],
        ).unwrap();
        let result = post_entry(&accounts, &entry).unwrap();
        assert_eq!(result[0].debit_balance, 1000);
        assert_eq!(result[0].credit_balance, 1000);
        assert_eq!(net_balance(&result[0]), 0); // Net zero
        assert_eq!(result[0].entry_count, 2); // Counted twice (debit + credit)
    }

    // ============ Hardening Round 5 Tests ============

    #[test]
    fn test_create_account_all_categories_have_zero_balances_h5() {
        for cat in [AccountCategory::Asset, AccountCategory::Liability,
                    AccountCategory::Revenue, AccountCategory::Expense,
                    AccountCategory::Equity] {
            let acct = create_account(id(1), id(2), cat, 0);
            assert_eq!(acct.debit_balance, 0);
            assert_eq!(acct.credit_balance, 0);
            assert_eq!(net_balance(&acct), 0);
        }
    }

    #[test]
    fn test_net_balance_asset_large_debit_h5() {
        let mut acct = make_asset(1, 0);
        acct.debit_balance = 1_000_000 * PRECISION;
        acct.credit_balance = 500_000 * PRECISION;
        assert_eq!(net_balance(&acct), 500_000 * PRECISION);
    }

    #[test]
    fn test_net_balance_liability_large_credit_h5() {
        let mut acct = make_liability(1, 0);
        acct.credit_balance = 1_000_000;
        acct.debit_balance = 300_000;
        assert_eq!(net_balance(&acct), 700_000);
    }

    #[test]
    fn test_net_balance_revenue_zero_both_h5() {
        let acct = make_revenue(1, 0);
        assert_eq!(net_balance(&acct), 0);
    }

    #[test]
    fn test_create_journal_entry_one_debit_one_credit_h5() {
        let entry = create_journal_entry(
            1, 100, [0u8; 32],
            &[(id(1), 5000)],
            &[(id(2), 5000)],
        ).unwrap();
        assert_eq!(entry.total_amount, 5000);
        assert_eq!(entry.debit_count, 1);
        assert_eq!(entry.credit_count, 1);
    }

    #[test]
    fn test_create_journal_entry_two_debits_one_credit_h5() {
        let entry = create_journal_entry(
            1, 100, [0u8; 32],
            &[(id(1), 3000), (id(2), 2000)],
            &[(id(3), 5000)],
        ).unwrap();
        assert_eq!(entry.total_amount, 5000);
        assert_eq!(entry.debit_count, 2);
        assert_eq!(entry.credit_count, 1);
    }

    #[test]
    fn test_create_journal_entry_zero_debit_amount_fails_h5() {
        let result = create_journal_entry(
            1, 100, [0u8; 32],
            &[(id(1), 0)],
            &[(id(2), 0)],
        );
        assert_eq!(result, Err(AccountingError::ZeroAmount));
    }

    #[test]
    fn test_create_journal_entry_unbalanced_by_one_h5() {
        let result = create_journal_entry(
            1, 100, [0u8; 32],
            &[(id(1), 1001)],
            &[(id(2), 1000)],
        );
        assert_eq!(result, Err(AccountingError::UnbalancedEntry));
    }

    #[test]
    fn test_create_journal_entry_six_debits_fails_h5() {
        let result = create_journal_entry(
            1, 100, [0u8; 32],
            &[(id(1), 100), (id(2), 100), (id(3), 100),
              (id(4), 100), (id(5), 100), (id(6), 100)],
            &[(id(7), 600)],
        );
        assert_eq!(result, Err(AccountingError::MaxEntriesReached));
    }

    #[test]
    fn test_post_entry_updates_last_entry_block_h5() {
        let accounts = vec![make_asset(1, 0), make_revenue(2, 0)];
        let entry = create_journal_entry(
            1, 500, [0u8; 32],
            &[(id(1), 1000)],
            &[(id(2), 1000)],
        ).unwrap();
        let result = post_entry(&accounts, &entry).unwrap();
        assert_eq!(result[0].last_entry_block, 500);
        assert_eq!(result[1].last_entry_block, 500);
    }

    #[test]
    fn test_post_entry_increments_entry_count_h5() {
        let accounts = vec![make_asset(1, 0), make_liability(2, 0)];
        let entry = create_journal_entry(
            1, 100, [0u8; 32],
            &[(id(1), 1000)],
            &[(id(2), 1000)],
        ).unwrap();
        let result = post_entry(&accounts, &entry).unwrap();
        assert_eq!(result[0].entry_count, 1);
        assert_eq!(result[1].entry_count, 1);
    }

    #[test]
    fn test_post_entry_missing_debit_account_h5() {
        let accounts = vec![make_revenue(2, 0)]; // Only credit account exists
        let entry = create_journal_entry(
            1, 100, [0u8; 32],
            &[(id(1), 1000)],
            &[(id(2), 1000)],
        ).unwrap();
        let result = post_entry(&accounts, &entry);
        assert_eq!(result, Err(AccountingError::AccountNotFound));
    }

    #[test]
    fn test_trial_balance_two_balanced_accounts_h5() {
        let accounts = vec![make_asset(1, 0), make_revenue(2, 0)];
        let accounts = post_simple(&accounts, id(1), id(2), 5000, 100);
        let tb = trial_balance(&accounts);
        assert!(tb.is_balanced);
        assert_eq!(tb.difference, 0);
        assert_eq!(tb.account_count, 2);
    }

    #[test]
    fn test_trial_balance_empty_accounts_h5() {
        let tb = trial_balance(&[]);
        assert!(tb.is_balanced);
        assert_eq!(tb.total_debits, 0);
        assert_eq!(tb.total_credits, 0);
        assert_eq!(tb.account_count, 0);
    }

    #[test]
    fn test_balance_sheet_asset_equals_equity_h5() {
        let accounts = vec![make_asset(1, 0), make_equity(2, 0)];
        let accounts = post_simple(&accounts, id(1), id(2), 10_000, 100);
        let sheet = balance_sheet(&accounts);
        assert_eq!(sheet.total_assets, 10_000);
        assert_eq!(sheet.total_equity, 10_000);
        assert!(sheet.is_balanced);
    }

    #[test]
    fn test_balance_sheet_revenue_and_expense_h5() {
        let accounts = vec![
            make_asset(1, 0),
            make_revenue(2, 0),
            make_expense(3, 0),
            make_asset(4, 0),
        ];
        let accounts = post_simple(&accounts, id(1), id(2), 5000, 100);
        let accounts = post_simple(&accounts, id(3), id(4), 2000, 200);
        let sheet = balance_sheet(&accounts);
        assert_eq!(sheet.total_revenue, 5000);
        assert_eq!(sheet.total_expenses, 2000);
        assert_eq!(sheet.net_income, 3000);
    }

    #[test]
    fn test_reconcile_exact_match_h5() {
        let mut acct = make_asset(1, 0);
        acct.debit_balance = 5000;
        let result = reconcile(&acct, 5000);
        assert!(result.is_reconciled);
        assert_eq!(result.difference, 0);
    }

    #[test]
    fn test_reconcile_off_by_one_within_tolerance_h5() {
        let mut acct = make_asset(1, 0);
        acct.debit_balance = 5001;
        let result = reconcile(&acct, 5000);
        assert!(result.is_reconciled); // Within RECONCILIATION_TOLERANCE of 1
        assert_eq!(result.difference, 1);
    }

    #[test]
    fn test_reconcile_off_by_two_fails_h5() {
        let mut acct = make_asset(1, 0);
        acct.debit_balance = 5002;
        let result = reconcile(&acct, 5000);
        assert!(!result.is_reconciled);
        assert_eq!(result.difference, 2);
    }

    #[test]
    fn test_audit_trail_no_entries_h5() {
        let acct = make_asset(1, 0);
        let trail = audit_trail(&acct, &[]);
        assert_eq!(trail.entry_count, 0);
        assert_eq!(trail.total_debits, 0);
        assert_eq!(trail.total_credits, 0);
        assert!(trail.is_consistent);
    }

    #[test]
    fn test_audit_trail_single_debit_entry_h5() {
        let mut acct = make_asset(1, 0);
        acct.debit_balance = 1000;
        let entry = create_journal_entry(
            1, 100, [0u8; 32],
            &[(id(1), 1000)],
            &[(id(2), 1000)],
        ).unwrap();
        let trail = audit_trail(&acct, &[entry]);
        assert_eq!(trail.total_debits, 1000);
        assert_eq!(trail.total_credits, 0);
        assert_eq!(trail.entry_count, 1);
    }

    #[test]
    fn test_validate_equation_empty_accounts_h5() {
        assert!(validate_accounting_equation(&[]));
    }

    #[test]
    fn test_validate_equation_balanced_h5() {
        let accounts = vec![make_asset(1, 0), make_equity(2, 0)];
        let accounts = post_simple(&accounts, id(1), id(2), 1000, 100);
        assert!(validate_accounting_equation(&accounts));
    }

    #[test]
    fn test_find_account_exists_h5() {
        let accounts = vec![make_asset(1, 0), make_asset(2, 0)];
        assert_eq!(find_account(&accounts, id(1)), Some(0));
        assert_eq!(find_account(&accounts, id(2)), Some(1));
    }

    #[test]
    fn test_find_account_not_found_h5() {
        let accounts = vec![make_asset(1, 0)];
        assert_eq!(find_account(&accounts, id(99)), None);
    }

    #[test]
    fn test_category_total_mixed_h5() {
        let mut a1 = make_asset(1, 0);
        a1.debit_balance = 5000;
        let mut a2 = make_asset(2, 0);
        a2.debit_balance = 3000;
        let mut l1 = make_liability(3, 0);
        l1.credit_balance = 2000;
        let total = category_total(&[a1, a2, l1], AccountCategory::Asset);
        assert_eq!(total, 8000);
    }

    #[test]
    fn test_record_fee_revenue_basic_h5() {
        let entry = record_fee_revenue(id(1), id(2), 1000, 100, 1).unwrap();
        assert_eq!(entry.total_amount, 1000);
        assert_eq!(entry.debit_count, 1);
        assert_eq!(entry.credit_count, 1);
    }

    #[test]
    fn test_record_fee_revenue_zero_fails_h5() {
        let result = record_fee_revenue(id(1), id(2), 0, 100, 1);
        assert_eq!(result, Err(AccountingError::ZeroAmount));
    }

    #[test]
    fn test_record_emission_valid_split_h5() {
        let entry = record_emission(
            id(1), 10_000, id(2), id(3), id(4),
            3000, 3000, 100, // 30% shapley, 30% gauge, 40% staking
        ).unwrap();
        assert_eq!(entry.total_amount, 10_000);
        assert_eq!(entry.debit_count, 1);
        assert_eq!(entry.credit_count, 3);
    }

    #[test]
    fn test_record_emission_zero_amount_fails_h5() {
        let result = record_emission(id(1), 0, id(2), id(3), id(4), 3000, 3000, 100);
        assert_eq!(result, Err(AccountingError::ZeroAmount));
    }

    #[test]
    fn test_record_emission_bps_exceed_10000_fails_h5() {
        let result = record_emission(id(1), 10_000, id(2), id(3), id(4), 6000, 5000, 100);
        assert_eq!(result, Err(AccountingError::InvalidAmount));
    }

    #[test]
    fn test_period_summary_all_entries_in_range_h5() {
        let e1 = create_journal_entry(1, 100, [0u8; 32], &[(id(1), 500)], &[(id(2), 500)]).unwrap();
        let e2 = create_journal_entry(2, 200, [0u8; 32], &[(id(1), 300)], &[(id(2), 300)]).unwrap();
        let (vol, count) = period_summary(&[e1, e2], 50, 250);
        assert_eq!(vol, 800);
        assert_eq!(count, 2);
    }

    #[test]
    fn test_period_summary_partial_range_h5() {
        let e1 = create_journal_entry(1, 100, [0u8; 32], &[(id(1), 500)], &[(id(2), 500)]).unwrap();
        let e2 = create_journal_entry(2, 200, [0u8; 32], &[(id(1), 300)], &[(id(2), 300)]).unwrap();
        let (vol, count) = period_summary(&[e1, e2], 150, 250);
        assert_eq!(vol, 300);
        assert_eq!(count, 1);
    }

    #[test]
    fn test_period_summary_no_entries_in_range_h5() {
        let e1 = create_journal_entry(1, 100, [0u8; 32], &[(id(1), 500)], &[(id(2), 500)]).unwrap();
        let (vol, count) = period_summary(&[e1], 200, 300);
        assert_eq!(vol, 0);
        assert_eq!(count, 0);
    }

    #[test]
    fn test_net_balance_expense_contra_position_h5() {
        // Expense account with more credits than debits → saturating_sub → 0
        let mut acct = make_expense(1, 0);
        acct.debit_balance = 100;
        acct.credit_balance = 500;
        assert_eq!(net_balance(&acct), 0);
    }

    #[test]
    fn test_net_balance_equity_contra_position_h5() {
        // Equity with more debits than credits → saturating_sub → 0
        let mut acct = make_equity(1, 0);
        acct.debit_balance = 500;
        acct.credit_balance = 100;
        assert_eq!(net_balance(&acct), 0);
    }

    #[test]
    fn test_balance_sheet_empty_is_balanced_h5() {
        let sheet = balance_sheet(&[]);
        assert!(sheet.is_balanced);
        assert_eq!(sheet.net_income, 0);
    }

    #[test]
    fn test_create_journal_entry_preserves_entry_id_h5() {
        let entry = create_journal_entry(
            42, 100, [0u8; 32],
            &[(id(1), 1000)],
            &[(id(2), 1000)],
        ).unwrap();
        assert_eq!(entry.entry_id, 42);
    }

    #[test]
    fn test_create_journal_entry_preserves_block_h5() {
        let entry = create_journal_entry(
            1, 9999, [0u8; 32],
            &[(id(1), 1000)],
            &[(id(2), 1000)],
        ).unwrap();
        assert_eq!(entry.block_number, 9999);
    }
}
