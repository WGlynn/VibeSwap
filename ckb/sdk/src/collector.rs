// ============ Cell Collector & UTXO Management ============
// Utilities for managing CKB cells in a UTXO wallet context.
//
// In CKB's cell model, balances are spread across multiple cells.
// This module provides:
// 1. Cell selection (coin selection algorithms for spending)
// 2. Capacity calculation (CKB capacity requirements for cells)
// 3. Change cell construction
// 4. Cell merging (consolidate many small cells into fewer)
//
// These are the UTXO plumbing that makes the SDK transaction builders usable.
// Without this, users would have to manually select which cells to spend.

// ============ Live Cell Representation ============

/// A live (unspent) cell on CKB, as returned by the indexer.
#[derive(Clone, Debug)]
pub struct LiveCell {
    /// Outpoint: transaction hash + output index
    pub tx_hash: [u8; 32],
    pub index: u32,
    /// Cell capacity in shannons (1 CKB = 10^8 shannons)
    pub capacity: u64,
    /// Cell data (token amount for xUDT cells)
    pub data: Vec<u8>,
    /// Lock script on this cell
    pub lock_script: super::Script,
    /// Type script (present for typed cells like xUDT)
    pub type_script: Option<super::Script>,
}

impl LiveCell {
    /// Convert to CellInput for use in transactions
    pub fn as_input(&self) -> super::CellInput {
        super::CellInput {
            tx_hash: self.tx_hash,
            index: self.index,
            since: 0,
        }
    }

    /// Parse xUDT token amount from cell data (first 16 bytes, LE u128)
    pub fn token_amount(&self) -> Option<u128> {
        super::token::parse_token_amount(&self.data)
    }

    /// Check if this cell has a type script matching the given code_hash
    pub fn has_type_code_hash(&self, code_hash: &[u8; 32]) -> bool {
        self.type_script
            .as_ref()
            .map(|ts| ts.code_hash == *code_hash)
            .unwrap_or(false)
    }
}

// ============ Cell Selection ============

/// Result of cell selection: which cells to use and what change is needed.
#[derive(Clone, Debug)]
pub struct CellSelection {
    /// Selected cells to consume as inputs
    pub selected: Vec<LiveCell>,
    /// Total capacity of selected cells (shannons)
    pub total_capacity: u64,
    /// Total token amount in selected cells (for typed cells)
    pub total_token_amount: u128,
    /// Change in capacity to return (0 if exact)
    pub capacity_change: u64,
    /// Change in token amount to return (0 if exact)
    pub token_change: u128,
}

/// Strategy for selecting cells.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SelectionStrategy {
    /// Select smallest cells first (reduces UTXO set bloat)
    SmallestFirst,
    /// Select largest cells first (fewer inputs, lower tx size)
    LargestFirst,
    /// Select cells closest to the target amount (minimizes change)
    BestFit,
}

/// Select CKB capacity cells (plain cells without type scripts) to meet a target.
///
/// Returns the selected cells and the change amount. Fails if insufficient capacity.
pub fn select_capacity_cells(
    available: &[LiveCell],
    target_capacity: u64,
    strategy: &SelectionStrategy,
) -> Result<CellSelection, CollectorError> {
    // Filter to plain cells (no type script = pure CKB capacity)
    let mut candidates: Vec<&LiveCell> = available
        .iter()
        .filter(|c| c.type_script.is_none())
        .collect();

    sort_by_strategy(&mut candidates, strategy, |c| c.capacity as u128);

    let mut selected = Vec::new();
    let mut total: u64 = 0;

    for cell in candidates {
        if total >= target_capacity {
            break;
        }
        total = total.saturating_add(cell.capacity);
        selected.push(cell.clone());
    }

    if total < target_capacity {
        return Err(CollectorError::InsufficientCapacity {
            needed: target_capacity,
            available: total,
        });
    }

    Ok(CellSelection {
        total_capacity: total,
        total_token_amount: 0,
        capacity_change: total - target_capacity,
        token_change: 0,
        selected,
    })
}

/// Select xUDT token cells to meet a target token amount.
///
/// Only selects cells whose type script matches the given token_type_script.
/// Returns selected cells and change amounts for both tokens and capacity.
pub fn select_token_cells(
    available: &[LiveCell],
    token_code_hash: &[u8; 32],
    token_args: &[u8],
    target_amount: u128,
    strategy: &SelectionStrategy,
) -> Result<CellSelection, CollectorError> {
    let mut candidates: Vec<&LiveCell> = available
        .iter()
        .filter(|c| {
            c.type_script.as_ref().map_or(false, |ts| {
                ts.code_hash == *token_code_hash && ts.args == token_args
            })
        })
        .collect();

    sort_by_strategy(&mut candidates, strategy, |c| {
        c.token_amount().unwrap_or(0)
    });

    let mut selected = Vec::new();
    let mut total_tokens: u128 = 0;
    let mut total_capacity: u64 = 0;

    for cell in candidates {
        if total_tokens >= target_amount {
            break;
        }
        let amount = cell.token_amount().unwrap_or(0);
        total_tokens = total_tokens.saturating_add(amount);
        total_capacity = total_capacity.saturating_add(cell.capacity);
        selected.push(cell.clone());
    }

    if total_tokens < target_amount {
        return Err(CollectorError::InsufficientTokens {
            needed: target_amount,
            available: total_tokens,
        });
    }

    Ok(CellSelection {
        total_capacity,
        total_token_amount: total_tokens,
        capacity_change: 0, // Caller determines capacity handling
        token_change: total_tokens - target_amount,
        selected,
    })
}

// ============ Capacity Calculation ============

/// CKB capacity cost in shannons for a cell with the given properties.
/// CKB rule: cell capacity >= (8 + data_size + lock_script_size + type_script_size) * 10^8
///
/// Components:
/// - 8 bytes: capacity field itself
/// - data_size: cell data length
/// - lock_script: 32 (code_hash) + 1 (hash_type) + 4 (args_len) + args.len()
/// - type_script: same structure, optional
const CAPACITY_PER_BYTE: u64 = 100_000_000; // 1 CKB per byte

pub fn calculate_cell_capacity(
    data_size: usize,
    lock_args_size: usize,
    type_args_size: Option<usize>,
) -> u64 {
    let mut bytes: usize = 8; // capacity field

    // Lock script: code_hash(32) + hash_type(1) + args_len(4) + args
    bytes += 32 + 1 + 4 + lock_args_size;

    // Type script (optional): same layout
    if let Some(t_args) = type_args_size {
        bytes += 32 + 1 + 4 + t_args;
    }

    // Cell data
    bytes += data_size;

    bytes as u64 * CAPACITY_PER_BYTE
}

/// Capacity needed for a plain CKB cell (just capacity, no data, no type script).
/// Typical lock script: secp256k1 with 20-byte args.
pub fn min_plain_cell_capacity(lock_args_size: usize) -> u64 {
    calculate_cell_capacity(0, lock_args_size, None)
}

/// Capacity needed for an xUDT token cell.
/// Data: 16 bytes (u128 amount). Type script args: 36 bytes (32 lock_hash + 4 flags).
pub fn min_token_cell_capacity(lock_args_size: usize) -> u64 {
    calculate_cell_capacity(16, lock_args_size, Some(36))
}

// ============ Cell Merging ============

/// Build a transaction to merge multiple cells into one.
/// Useful for consolidating many small cells (UTXO dust) into a single cell.
///
/// For plain CKB cells: sum all capacity into one output.
/// For token cells: sum all token amounts into one output.
pub fn merge_cells(
    cells: &[LiveCell],
    recipient_lock: super::Script,
) -> Result<super::UnsignedTransaction, CollectorError> {
    if cells.is_empty() {
        return Err(CollectorError::NoCells);
    }

    let total_capacity: u64 = cells.iter().map(|c| c.capacity).sum();

    // Check if these are token cells
    let first_type = cells[0].type_script.clone();
    let is_token = first_type.is_some();

    // All cells must have the same type script (or all be plain)
    for cell in cells {
        if is_token {
            if cell.type_script.is_none() {
                return Err(CollectorError::MixedCellTypes);
            }
            let ft = first_type.as_ref().unwrap();
            let ct = cell.type_script.as_ref().unwrap();
            if ft.code_hash != ct.code_hash || ft.args != ct.args {
                return Err(CollectorError::MixedCellTypes);
            }
        } else if cell.type_script.is_some() {
            return Err(CollectorError::MixedCellTypes);
        }
    }

    let inputs: Vec<super::CellInput> = cells.iter().map(|c| c.as_input()).collect();

    let data = if is_token {
        let total_tokens: u128 = cells
            .iter()
            .filter_map(|c| c.token_amount())
            .sum();
        total_tokens.to_le_bytes().to_vec()
    } else {
        vec![]
    };

    // Reserve capacity for the output cell itself
    let output_capacity = if is_token {
        // Need capacity for the token cell structure
        let needed = min_token_cell_capacity(recipient_lock.args.len());
        if total_capacity < needed {
            return Err(CollectorError::InsufficientCapacity {
                needed,
                available: total_capacity,
            });
        }
        total_capacity
    } else {
        total_capacity
    };

    let output = super::CellOutput {
        capacity: output_capacity,
        lock_script: recipient_lock,
        type_script: first_type,
        data,
    };

    let witnesses = vec![vec![]; inputs.len()];

    Ok(super::UnsignedTransaction {
        cell_deps: vec![], // Caller adds cell deps as needed
        inputs,
        outputs: vec![output],
        witnesses,
    })
}

/// Build a transaction to split one cell into many.
/// Useful for pre-splitting a large cell into smaller ones for concurrent use.
pub fn split_cell(
    cell: &LiveCell,
    split_amounts: &[u128], // Token amounts for each output
    recipient_lock: super::Script,
) -> Result<super::UnsignedTransaction, CollectorError> {
    if split_amounts.is_empty() {
        return Err(CollectorError::NoCells);
    }

    let total_amount = cell.token_amount().unwrap_or(0);
    let split_total: u128 = split_amounts.iter().sum();

    if split_total > total_amount {
        return Err(CollectorError::InsufficientTokens {
            needed: split_total,
            available: total_amount,
        });
    }

    let type_script = cell.type_script.clone();
    let capacity_per_output = min_token_cell_capacity(recipient_lock.args.len());
    let total_capacity_needed = capacity_per_output * split_amounts.len() as u64;

    // Need extra for change cell if there's remaining tokens
    let change_amount = total_amount - split_total;
    let total_with_change = if change_amount > 0 {
        total_capacity_needed + capacity_per_output
    } else {
        total_capacity_needed
    };

    if cell.capacity < total_with_change {
        return Err(CollectorError::InsufficientCapacity {
            needed: total_with_change,
            available: cell.capacity,
        });
    }

    let mut outputs: Vec<super::CellOutput> = split_amounts
        .iter()
        .map(|amount| super::CellOutput {
            capacity: capacity_per_output,
            lock_script: recipient_lock.clone(),
            type_script: type_script.clone(),
            data: amount.to_le_bytes().to_vec(),
        })
        .collect();

    // Change cell for remaining tokens
    if change_amount > 0 {
        outputs.push(super::CellOutput {
            capacity: cell.capacity - total_capacity_needed,
            lock_script: recipient_lock,
            type_script,
            data: change_amount.to_le_bytes().to_vec(),
        });
    }

    Ok(super::UnsignedTransaction {
        cell_deps: vec![],
        inputs: vec![cell.as_input()],
        outputs,
        witnesses: vec![vec![]],
    })
}

// ============ Errors ============

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CollectorError {
    InsufficientCapacity { needed: u64, available: u64 },
    InsufficientTokens { needed: u128, available: u128 },
    NoCells,
    MixedCellTypes,
}

// ============ Helpers ============

fn sort_by_strategy<T, F: Fn(&T) -> u128>(
    items: &mut Vec<&T>,
    strategy: &SelectionStrategy,
    value_fn: F,
) {
    match strategy {
        SelectionStrategy::SmallestFirst => {
            items.sort_by_key(|c| value_fn(c));
        }
        SelectionStrategy::LargestFirst => {
            items.sort_by(|a, b| value_fn(b).cmp(&value_fn(a)));
        }
        SelectionStrategy::BestFit => {
            // Already sorted by default order, let the caller handle
        }
    }
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    fn plain_cell(capacity: u64) -> LiveCell {
        LiveCell {
            tx_hash: [0u8; 32],
            index: 0,
            capacity,
            data: vec![],
            lock_script: test_lock(0x01),
            type_script: None,
        }
    }

    fn token_cell(capacity: u64, amount: u128, token_id: u8) -> LiveCell {
        LiveCell {
            tx_hash: [token_id; 32],
            index: 0,
            capacity,
            data: amount.to_le_bytes().to_vec(),
            lock_script: test_lock(0x01),
            type_script: Some(super::super::Script {
                code_hash: [0xDD; 32],
                hash_type: super::super::HashType::Data1,
                args: vec![token_id; 36],
            }),
        }
    }

    fn test_lock(id: u8) -> super::super::Script {
        super::super::Script {
            code_hash: [id; 32],
            hash_type: super::super::HashType::Type,
            args: vec![id; 20],
        }
    }

    // ============ Capacity Selection Tests ============

    #[test]
    fn test_select_capacity_exact() {
        let cells = vec![plain_cell(500), plain_cell(300), plain_cell(200)];
        let result = select_capacity_cells(&cells, 1000, &SelectionStrategy::SmallestFirst).unwrap();
        assert_eq!(result.total_capacity, 1000);
        assert_eq!(result.capacity_change, 0);
        assert_eq!(result.selected.len(), 3);
    }

    #[test]
    fn test_select_capacity_with_change() {
        let cells = vec![plain_cell(500), plain_cell(400), plain_cell(300)];
        let result = select_capacity_cells(&cells, 600, &SelectionStrategy::SmallestFirst).unwrap();
        assert!(result.total_capacity >= 600);
        assert_eq!(result.capacity_change, result.total_capacity - 600);
    }

    #[test]
    fn test_select_capacity_insufficient() {
        let cells = vec![plain_cell(100), plain_cell(200)];
        let result = select_capacity_cells(&cells, 500, &SelectionStrategy::SmallestFirst);
        assert!(matches!(result, Err(CollectorError::InsufficientCapacity { .. })));
    }

    #[test]
    fn test_select_capacity_largest_first() {
        let cells = vec![plain_cell(100), plain_cell(500), plain_cell(300)];
        let result = select_capacity_cells(&cells, 400, &SelectionStrategy::LargestFirst).unwrap();
        // Should select the 500 cell first (largest)
        assert_eq!(result.selected.len(), 1);
        assert_eq!(result.selected[0].capacity, 500);
    }

    #[test]
    fn test_select_capacity_skips_typed_cells() {
        let mut cells = vec![plain_cell(100), plain_cell(200)];
        cells.push(token_cell(1000, 42, 0x01)); // Typed cell, should be skipped
        let result = select_capacity_cells(&cells, 250, &SelectionStrategy::SmallestFirst).unwrap();
        assert_eq!(result.total_capacity, 300); // Only plain cells: 100 + 200
        assert_eq!(result.selected.len(), 2);
    }

    // ============ Token Selection Tests ============

    #[test]
    fn test_select_token_cells() {
        let cells = vec![
            token_cell(1000, 500, 0x01),
            token_cell(1000, 300, 0x01),
            token_cell(1000, 200, 0x01),
        ];
        let result = select_token_cells(
            &cells, &[0xDD; 32], &vec![0x01; 36], 700,
            &SelectionStrategy::SmallestFirst,
        ).unwrap();
        assert!(result.total_token_amount >= 700);
        assert_eq!(result.token_change, result.total_token_amount - 700);
    }

    #[test]
    fn test_select_token_cells_insufficient() {
        let cells = vec![token_cell(1000, 100, 0x01)];
        let result = select_token_cells(
            &cells, &[0xDD; 32], &vec![0x01; 36], 500,
            &SelectionStrategy::SmallestFirst,
        );
        assert!(matches!(result, Err(CollectorError::InsufficientTokens { .. })));
    }

    #[test]
    fn test_select_token_cells_filters_by_type() {
        let cells = vec![
            token_cell(1000, 500, 0x01), // Token type 0x01
            token_cell(1000, 300, 0x02), // Different token type 0x02
        ];
        // Only select token 0x01
        let result = select_token_cells(
            &cells, &[0xDD; 32], &vec![0x01; 36], 400,
            &SelectionStrategy::SmallestFirst,
        ).unwrap();
        assert_eq!(result.total_token_amount, 500);
        assert_eq!(result.selected.len(), 1);
    }

    // ============ Capacity Calculation Tests ============

    #[test]
    fn test_calculate_cell_capacity_plain() {
        // 8 (capacity) + 32+1+4+20 (lock) = 65 bytes * 1 CKB/byte = 65 CKB
        let cap = calculate_cell_capacity(0, 20, None);
        assert_eq!(cap, 65 * CAPACITY_PER_BYTE);
    }

    #[test]
    fn test_calculate_cell_capacity_token() {
        // 8 + 32+1+4+20 (lock) + 32+1+4+36 (type) + 16 (data) = 154 bytes
        let cap = calculate_cell_capacity(16, 20, Some(36));
        assert_eq!(cap, 154 * CAPACITY_PER_BYTE);
    }

    #[test]
    fn test_min_plain_cell_capacity() {
        let cap = min_plain_cell_capacity(20);
        assert!(cap > 0);
        assert_eq!(cap, calculate_cell_capacity(0, 20, None));
    }

    #[test]
    fn test_min_token_cell_capacity() {
        let cap = min_token_cell_capacity(20);
        assert!(cap > min_plain_cell_capacity(20));
    }

    // ============ Merge Tests ============

    #[test]
    fn test_merge_plain_cells() {
        let cells = vec![plain_cell(100), plain_cell(200), plain_cell(300)];
        let tx = merge_cells(&cells, test_lock(0x02)).unwrap();
        assert_eq!(tx.inputs.len(), 3);
        assert_eq!(tx.outputs.len(), 1);
        assert_eq!(tx.outputs[0].capacity, 600);
        assert!(tx.outputs[0].data.is_empty());
    }

    #[test]
    fn test_merge_token_cells() {
        let cells = vec![
            token_cell(10_000_000_000, 1000, 0x01),
            token_cell(10_000_000_000, 2000, 0x01),
            token_cell(10_000_000_000, 3000, 0x01),
        ];
        let tx = merge_cells(&cells, test_lock(0x02)).unwrap();
        assert_eq!(tx.inputs.len(), 3);
        assert_eq!(tx.outputs.len(), 1);

        let merged_amount = super::super::token::parse_token_amount(&tx.outputs[0].data).unwrap();
        assert_eq!(merged_amount, 6000);
        assert_eq!(tx.outputs[0].capacity, 30_000_000_000);
    }

    #[test]
    fn test_merge_mixed_types_fails() {
        let cells = vec![plain_cell(100), token_cell(1000, 42, 0x01)];
        let result = merge_cells(&cells, test_lock(0x02));
        assert_eq!(result.unwrap_err(), CollectorError::MixedCellTypes);
    }

    #[test]
    fn test_merge_empty_fails() {
        let result = merge_cells(&[], test_lock(0x02));
        assert_eq!(result.unwrap_err(), CollectorError::NoCells);
    }

    #[test]
    fn test_merge_different_token_types_fails() {
        let cells = vec![
            token_cell(1000, 100, 0x01),
            token_cell(1000, 200, 0x02), // Different type args
        ];
        let result = merge_cells(&cells, test_lock(0x02));
        assert_eq!(result.unwrap_err(), CollectorError::MixedCellTypes);
    }

    // ============ Split Tests ============

    #[test]
    fn test_split_cell_even() {
        let cell = token_cell(100_000_000_000, 10000, 0x01); // 1000 CKB, 10000 tokens
        let tx = split_cell(&cell, &[2500, 2500, 2500, 2500], test_lock(0x02)).unwrap();
        assert_eq!(tx.inputs.len(), 1);
        assert_eq!(tx.outputs.len(), 4); // No change (exact split)

        let total: u128 = tx.outputs.iter()
            .filter_map(|o| super::super::token::parse_token_amount(&o.data))
            .sum();
        assert_eq!(total, 10000);
    }

    #[test]
    fn test_split_cell_with_change() {
        let cell = token_cell(100_000_000_000, 10000, 0x01);
        let tx = split_cell(&cell, &[3000, 2000], test_lock(0x02)).unwrap();
        assert_eq!(tx.outputs.len(), 3); // 2 splits + 1 change

        let amounts: Vec<u128> = tx.outputs.iter()
            .filter_map(|o| super::super::token::parse_token_amount(&o.data))
            .collect();
        assert_eq!(amounts[0], 3000);
        assert_eq!(amounts[1], 2000);
        assert_eq!(amounts[2], 5000); // Change
    }

    #[test]
    fn test_split_cell_insufficient_tokens() {
        let cell = token_cell(100_000_000_000, 1000, 0x01);
        let result = split_cell(&cell, &[600, 600], test_lock(0x02));
        assert!(matches!(result, Err(CollectorError::InsufficientTokens { .. })));
    }

    // ============ LiveCell Tests ============

    #[test]
    fn test_live_cell_as_input() {
        let cell = plain_cell(1000);
        let input = cell.as_input();
        assert_eq!(input.tx_hash, cell.tx_hash);
        assert_eq!(input.index, cell.index);
        assert_eq!(input.since, 0);
    }

    #[test]
    fn test_live_cell_token_amount() {
        let cell = token_cell(1000, 42, 0x01);
        assert_eq!(cell.token_amount(), Some(42));
    }

    #[test]
    fn test_live_cell_token_amount_plain() {
        let cell = plain_cell(1000);
        assert_eq!(cell.token_amount(), None); // No data
    }

    #[test]
    fn test_live_cell_has_type_code_hash() {
        let cell = token_cell(1000, 42, 0x01);
        assert!(cell.has_type_code_hash(&[0xDD; 32]));
        assert!(!cell.has_type_code_hash(&[0xFF; 32]));
    }

    // ============ New Edge Case & Hardening Tests ============

    #[test]
    fn test_has_type_code_hash_plain_cell_returns_false() {
        let cell = plain_cell(1000);
        // Plain cell has no type script, should always return false
        assert!(!cell.has_type_code_hash(&[0x00; 32]));
        assert!(!cell.has_type_code_hash(&[0xFF; 32]));
    }

    #[test]
    fn test_token_amount_short_data() {
        // Cell data shorter than 16 bytes should return None
        let cell = LiveCell {
            tx_hash: [0u8; 32],
            index: 0,
            capacity: 1000,
            data: vec![0x01, 0x02, 0x03], // Only 3 bytes, need 16
            lock_script: test_lock(0x01),
            type_script: None,
        };
        assert_eq!(cell.token_amount(), None);
    }

    #[test]
    fn test_select_capacity_empty_available() {
        // No cells available at all
        let result = select_capacity_cells(&[], 100, &SelectionStrategy::SmallestFirst);
        assert!(matches!(
            result,
            Err(CollectorError::InsufficientCapacity { needed: 100, available: 0 })
        ));
    }

    #[test]
    fn test_select_capacity_zero_target() {
        // Requesting zero capacity should succeed immediately with no cells selected
        let cells = vec![plain_cell(500), plain_cell(300)];
        let result = select_capacity_cells(&cells, 0, &SelectionStrategy::SmallestFirst).unwrap();
        assert_eq!(result.selected.len(), 0);
        assert_eq!(result.total_capacity, 0);
        assert_eq!(result.capacity_change, 0);
    }

    #[test]
    fn test_select_capacity_best_fit_strategy() {
        // BestFit should preserve original order (no sorting)
        let cells = vec![plain_cell(300), plain_cell(100), plain_cell(500)];
        let result = select_capacity_cells(&cells, 350, &SelectionStrategy::BestFit).unwrap();
        // BestFit preserves insertion order, so picks 300 then 100
        assert_eq!(result.selected.len(), 2);
        assert_eq!(result.total_capacity, 400);
        assert_eq!(result.capacity_change, 50);
    }

    #[test]
    fn test_select_capacity_all_cells_are_typed() {
        // When all cells have type scripts, none qualify as plain capacity cells
        let cells = vec![
            token_cell(10000, 100, 0x01),
            token_cell(20000, 200, 0x02),
        ];
        let result = select_capacity_cells(&cells, 100, &SelectionStrategy::LargestFirst);
        assert!(matches!(
            result,
            Err(CollectorError::InsufficientCapacity { needed: 100, available: 0 })
        ));
    }

    #[test]
    fn test_select_token_cells_zero_target() {
        // Requesting zero tokens should succeed immediately
        let cells = vec![token_cell(1000, 500, 0x01)];
        let result = select_token_cells(
            &cells, &[0xDD; 32], &vec![0x01; 36], 0,
            &SelectionStrategy::SmallestFirst,
        ).unwrap();
        assert_eq!(result.selected.len(), 0);
        assert_eq!(result.total_token_amount, 0);
        assert_eq!(result.token_change, 0);
    }

    #[test]
    fn test_select_token_cells_no_matching_code_hash() {
        // Cells exist but none match the requested code_hash
        let cells = vec![token_cell(1000, 500, 0x01)];
        let result = select_token_cells(
            &cells, &[0xAA; 32], &vec![0x01; 36], 100,
            &SelectionStrategy::SmallestFirst,
        );
        assert!(matches!(
            result,
            Err(CollectorError::InsufficientTokens { needed: 100, available: 0 })
        ));
    }

    #[test]
    fn test_select_token_cells_largest_first_picks_fewest() {
        // LargestFirst should pick the big cell, needing fewer inputs
        let cells = vec![
            token_cell(1000, 100, 0x01),
            token_cell(1000, 900, 0x01),
            token_cell(1000, 50, 0x01),
        ];
        let result = select_token_cells(
            &cells, &[0xDD; 32], &vec![0x01; 36], 800,
            &SelectionStrategy::LargestFirst,
        ).unwrap();
        assert_eq!(result.selected.len(), 1);
        assert_eq!(result.total_token_amount, 900);
        assert_eq!(result.token_change, 100);
    }

    #[test]
    fn test_calculate_cell_capacity_zero_lock_args() {
        // Lock script with zero-length args
        // 8 (capacity) + 32+1+4+0 (lock) = 45 bytes
        let cap = calculate_cell_capacity(0, 0, None);
        assert_eq!(cap, 45 * CAPACITY_PER_BYTE);
    }

    #[test]
    fn test_merge_single_cell() {
        // Merging a single cell is a degenerate but valid case
        let cells = vec![plain_cell(5000)];
        let tx = merge_cells(&cells, test_lock(0x03)).unwrap();
        assert_eq!(tx.inputs.len(), 1);
        assert_eq!(tx.outputs.len(), 1);
        assert_eq!(tx.outputs[0].capacity, 5000);
        // Output lock script should be the recipient's
        assert_eq!(tx.outputs[0].lock_script.args, vec![0x03; 20]);
    }

    #[test]
    fn test_split_cell_empty_amounts() {
        // Splitting with empty amounts should fail
        let cell = token_cell(100_000_000_000, 10000, 0x01);
        let result = split_cell(&cell, &[], test_lock(0x02));
        assert_eq!(result.unwrap_err(), CollectorError::NoCells);
    }

    #[test]
    fn test_split_cell_insufficient_capacity() {
        // Cell has enough tokens but not enough capacity for multiple outputs
        // Each token output needs min_token_cell_capacity(20) = 154 CKB = 15_400_000_000 shannons
        let min_per_output = min_token_cell_capacity(20);
        // Give cell barely enough capacity for 1 output, but ask for 3
        let cell = token_cell(min_per_output + 1, 10000, 0x01);
        let result = split_cell(&cell, &[3000, 3000, 3000], test_lock(0x02));
        assert!(matches!(result, Err(CollectorError::InsufficientCapacity { .. })));
    }

    // ============ Additional Edge Case & Boundary Tests ============

    #[test]
    fn test_select_capacity_single_cell_exact_match() {
        // Single cell that exactly meets the target
        let cells = vec![plain_cell(999)];
        let result = select_capacity_cells(&cells, 999, &SelectionStrategy::SmallestFirst).unwrap();
        assert_eq!(result.selected.len(), 1);
        assert_eq!(result.total_capacity, 999);
        assert_eq!(result.capacity_change, 0);
    }

    #[test]
    fn test_select_capacity_smallest_first_ordering() {
        // Verify SmallestFirst picks smallest cells first, requiring more inputs
        let cells = vec![plain_cell(100), plain_cell(50), plain_cell(200), plain_cell(25)];
        let result = select_capacity_cells(&cells, 150, &SelectionStrategy::SmallestFirst).unwrap();
        // Sorted ascending: 25, 50, 100, 200 → picks 25+50+100=175 >= 150
        assert_eq!(result.selected.len(), 3);
        assert_eq!(result.total_capacity, 175);
        assert_eq!(result.capacity_change, 25);
    }

    #[test]
    fn test_select_capacity_largest_first_fewer_inputs() {
        // LargestFirst should pick fewer cells for the same target
        let cells = vec![plain_cell(100), plain_cell(50), plain_cell(200), plain_cell(25)];
        let result_small = select_capacity_cells(&cells, 150, &SelectionStrategy::SmallestFirst).unwrap();
        let result_large = select_capacity_cells(&cells, 150, &SelectionStrategy::LargestFirst).unwrap();
        // LargestFirst should need fewer or equal inputs
        assert!(result_large.selected.len() <= result_small.selected.len());
        assert_eq!(result_large.selected[0].capacity, 200);
    }

    #[test]
    fn test_select_capacity_mixed_cells_only_picks_plain() {
        // Mix of plain and typed cells, ensure only plain cells are selected
        let cells = vec![
            plain_cell(50),
            token_cell(500, 100, 0x01),
            plain_cell(100),
            token_cell(1000, 200, 0x02),
            plain_cell(75),
        ];
        let result = select_capacity_cells(&cells, 200, &SelectionStrategy::SmallestFirst).unwrap();
        // Only plain: 50, 75, 100. All should be selected for 225 >= 200
        assert_eq!(result.total_capacity, 225);
        for cell in &result.selected {
            assert!(cell.type_script.is_none(), "Should only select plain cells");
        }
    }

    #[test]
    fn test_select_token_cells_empty_available() {
        // No cells at all
        let result = select_token_cells(
            &[], &[0xDD; 32], &vec![0x01; 36], 100,
            &SelectionStrategy::SmallestFirst,
        );
        assert!(matches!(
            result,
            Err(CollectorError::InsufficientTokens { needed: 100, available: 0 })
        ));
    }

    #[test]
    fn test_select_token_cells_exact_amount() {
        // Cells exactly match the target
        let cells = vec![
            token_cell(1000, 300, 0x01),
            token_cell(1000, 200, 0x01),
        ];
        let result = select_token_cells(
            &cells, &[0xDD; 32], &vec![0x01; 36], 500,
            &SelectionStrategy::SmallestFirst,
        ).unwrap();
        assert_eq!(result.total_token_amount, 500);
        assert_eq!(result.token_change, 0);
        assert_eq!(result.selected.len(), 2);
    }

    #[test]
    fn test_select_token_cells_ignores_plain_cells() {
        // Plain cells should be skipped when selecting token cells
        let cells = vec![
            plain_cell(5000),
            token_cell(1000, 400, 0x01),
            plain_cell(3000),
        ];
        let result = select_token_cells(
            &cells, &[0xDD; 32], &vec![0x01; 36], 300,
            &SelectionStrategy::SmallestFirst,
        ).unwrap();
        assert_eq!(result.selected.len(), 1);
        assert_eq!(result.total_token_amount, 400);
    }

    #[test]
    fn test_select_token_cells_tracks_capacity() {
        // Verify total_capacity is accumulated for selected token cells
        let cells = vec![
            token_cell(2000, 100, 0x01),
            token_cell(3000, 200, 0x01),
        ];
        let result = select_token_cells(
            &cells, &[0xDD; 32], &vec![0x01; 36], 250,
            &SelectionStrategy::SmallestFirst,
        ).unwrap();
        assert_eq!(result.total_capacity, 5000);
    }

    #[test]
    fn test_calculate_cell_capacity_large_data() {
        // Cell with large data payload
        let cap = calculate_cell_capacity(1024, 20, None);
        // 8(capacity) + 32+1+4+20(lock) + 1024(data) = 1089 bytes
        assert_eq!(cap, 1089 * CAPACITY_PER_BYTE);
    }

    #[test]
    fn test_calculate_cell_capacity_large_type_args() {
        // Type script with unusually large args
        let cap = calculate_cell_capacity(16, 20, Some(100));
        // 8(capacity) + 32+1+4+20(lock) + 32+1+4+100(type) + 16(data) = 218 bytes
        assert_eq!(cap, 218 * CAPACITY_PER_BYTE);
    }

    #[test]
    fn test_merge_token_cells_insufficient_capacity() {
        // Token cells with insufficient total capacity for the output cell
        let min_cap = min_token_cell_capacity(20);
        // Each cell has 1 shannon — total of 2 shannons, way below min_token_cell_capacity
        let cells = vec![
            token_cell(1, 100, 0x01),
            token_cell(1, 200, 0x01),
        ];
        let result = merge_cells(&cells, test_lock(0x02));
        assert!(matches!(result, Err(CollectorError::InsufficientCapacity { .. })));
    }

    #[test]
    fn test_merge_preserves_type_script_on_output() {
        // Merged token cells should carry the type script to the output
        let cells = vec![
            token_cell(10_000_000_000, 500, 0x01),
            token_cell(10_000_000_000, 300, 0x01),
        ];
        let tx = merge_cells(&cells, test_lock(0x03)).unwrap();
        assert!(tx.outputs[0].type_script.is_some());
        let ts = tx.outputs[0].type_script.as_ref().unwrap();
        assert_eq!(ts.code_hash, [0xDD; 32]);
        assert_eq!(ts.args, vec![0x01; 36]);
    }

    #[test]
    fn test_merge_plain_cells_no_type_script_on_output() {
        // Merged plain cells should NOT have type_script on output
        let cells = vec![plain_cell(5000), plain_cell(3000)];
        let tx = merge_cells(&cells, test_lock(0x03)).unwrap();
        assert!(tx.outputs[0].type_script.is_none());
        assert!(tx.outputs[0].data.is_empty());
    }

    #[test]
    fn test_merge_witness_count_matches_inputs() {
        // The witness vector should have one entry per input
        let cells = vec![plain_cell(100), plain_cell(200), plain_cell(300), plain_cell(400)];
        let tx = merge_cells(&cells, test_lock(0x02)).unwrap();
        assert_eq!(tx.witnesses.len(), tx.inputs.len());
        assert_eq!(tx.witnesses.len(), 4);
    }

    #[test]
    fn test_split_cell_single_output_exact() {
        // Split into a single output that takes all tokens — no change cell
        let cap = min_token_cell_capacity(20);
        let cell = token_cell(cap * 2, 5000, 0x01);
        let tx = split_cell(&cell, &[5000], test_lock(0x02)).unwrap();
        assert_eq!(tx.outputs.len(), 1); // No change needed
        let amount = super::super::token::parse_token_amount(&tx.outputs[0].data).unwrap();
        assert_eq!(amount, 5000);
    }

    #[test]
    fn test_split_cell_change_gets_remaining_capacity() {
        // When there's token change, the change cell should get remaining capacity
        let cap = min_token_cell_capacity(20);
        let total_cap = cap * 10; // plenty of capacity
        let cell = token_cell(total_cap, 10000, 0x01);
        let tx = split_cell(&cell, &[3000], test_lock(0x02)).unwrap();
        // 1 split output + 1 change output
        assert_eq!(tx.outputs.len(), 2);
        // Change output should get capacity = total - (1 * cap_per_output)
        assert_eq!(tx.outputs[1].capacity, total_cap - cap);
        let change_amount = super::super::token::parse_token_amount(&tx.outputs[1].data).unwrap();
        assert_eq!(change_amount, 7000);
    }

    // ============ New Edge Case & Hardening Tests (Batch 3) ============

    #[test]
    fn test_select_capacity_saturating_add() {
        // Verify cell capacities don't overflow with large values
        let cells = vec![plain_cell(u64::MAX / 2), plain_cell(u64::MAX / 2)];
        let result = select_capacity_cells(&cells, u64::MAX / 2, &SelectionStrategy::SmallestFirst).unwrap();
        assert_eq!(result.selected.len(), 1);
        assert_eq!(result.total_capacity, u64::MAX / 2);
    }

    #[test]
    fn test_select_token_cells_with_zero_amount_cells() {
        // Cells with 0 token amount should be selected but contribute 0
        let cells = vec![
            token_cell(1000, 0, 0x01),     // 0 tokens
            token_cell(1000, 500, 0x01),   // 500 tokens
        ];
        let result = select_token_cells(
            &cells, &[0xDD; 32], &vec![0x01; 36], 400,
            &SelectionStrategy::SmallestFirst,
        ).unwrap();
        // SmallestFirst: picks 0 first, then 500 → total 500
        assert_eq!(result.total_token_amount, 500);
        assert_eq!(result.selected.len(), 2);
        assert_eq!(result.token_change, 100);
    }

    #[test]
    fn test_merge_many_plain_cells() {
        // Merge 20 small cells into one large cell
        let cells: Vec<LiveCell> = (0..20).map(|_| plain_cell(1000)).collect();
        let tx = merge_cells(&cells, test_lock(0x05)).unwrap();
        assert_eq!(tx.inputs.len(), 20);
        assert_eq!(tx.outputs.len(), 1);
        assert_eq!(tx.outputs[0].capacity, 20_000);
        assert_eq!(tx.witnesses.len(), 20);
    }

    #[test]
    fn test_split_cell_many_outputs() {
        // Split into 8 equal amounts
        let cap = min_token_cell_capacity(20);
        let cell = token_cell(cap * 20, 80000, 0x01);
        let amounts = vec![10000u128; 8]; // 8 * 10000 = 80000 (exact)
        let tx = split_cell(&cell, &amounts, test_lock(0x02)).unwrap();
        assert_eq!(tx.outputs.len(), 8); // No change — exact split
        let total: u128 = tx.outputs.iter()
            .filter_map(|o| super::super::token::parse_token_amount(&o.data))
            .sum();
        assert_eq!(total, 80000);
    }

    #[test]
    fn test_live_cell_token_amount_exactly_16_bytes() {
        // Cell data is exactly 16 bytes — should parse successfully
        let cell = LiveCell {
            tx_hash: [0u8; 32],
            index: 0,
            capacity: 1000,
            data: 42u128.to_le_bytes().to_vec(),
            lock_script: test_lock(0x01),
            type_script: None,
        };
        assert_eq!(cell.token_amount(), Some(42));
    }

    #[test]
    fn test_live_cell_token_amount_more_than_16_bytes() {
        // Cell data has extra bytes after the amount (xUDT extension data)
        let mut data = 999u128.to_le_bytes().to_vec();
        data.extend_from_slice(&[0xFF; 20]); // extra extension data
        let cell = LiveCell {
            tx_hash: [0u8; 32],
            index: 0,
            capacity: 1000,
            data,
            lock_script: test_lock(0x01),
            type_script: None,
        };
        assert_eq!(cell.token_amount(), Some(999));
    }

    #[test]
    fn test_merge_token_cells_preserves_recipient_lock() {
        // Merged output should use the recipient's lock script, not the input cells' lock
        let cells = vec![
            token_cell(10_000_000_000, 500, 0x01),
            token_cell(10_000_000_000, 300, 0x01),
        ];
        let recipient = test_lock(0xAA);
        let tx = merge_cells(&cells, recipient.clone()).unwrap();
        assert_eq!(tx.outputs[0].lock_script.code_hash, recipient.code_hash);
        assert_eq!(tx.outputs[0].lock_script.args, recipient.args);
    }

    #[test]
    fn test_split_cell_all_outputs_have_correct_type_script() {
        // Every split output should carry the same type script as the input cell
        let cap = min_token_cell_capacity(20);
        let cell = token_cell(cap * 10, 6000, 0x01);
        let tx = split_cell(&cell, &[1000, 2000], test_lock(0x02)).unwrap();
        let expected_type = cell.type_script.as_ref().unwrap();
        for output in &tx.outputs {
            let ts = output.type_script.as_ref().unwrap();
            assert_eq!(ts.code_hash, expected_type.code_hash);
            assert_eq!(ts.args, expected_type.args);
        }
    }
}
