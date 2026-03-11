// ============ Cell Indexer & Query SDK ============
// Provides helpers for querying CKB on-chain state, building search filters,
// parsing cell data, and working with live cells from the indexer.
//
// Every SDK operation depends on finding the right cells — this module
// abstracts the indexer interaction:
// 1. Search filter construction (type scripts, lock scripts, capacity/data/block ranges)
// 2. Cell classification (identify VibeSwap cell types by code hash)
// 3. Filtering, sorting, pagination, and deduplication of cell results
// 4. Sync status tracking (is the indexer caught up to tip?)
// 5. Pool and user cell discovery
//
// All percentages are expressed in basis points (bps, 10000 = 100%).

use vibeswap_math::PRECISION;
use vibeswap_math::mul_div;

// ============ Constants ============

/// Default page size for paginated queries
pub const DEFAULT_PAGE_SIZE: u32 = 100;

/// Maximum allowed page size to prevent excessive memory usage
pub const MAX_PAGE_SIZE: u32 = 1000;

/// Number of blocks behind tip that is still considered "synced"
pub const SYNC_TOLERANCE_BLOCKS: u64 = 10;

/// Maximum cell age in blocks before it's considered stale (~4.6 days at 4s/block)
pub const MAX_CELL_AGE_BLOCKS: u64 = 100_000;

/// Basis points denominator (10000 = 100%)
pub const BPS_DENOMINATOR: u64 = 10_000;

// ============ Error Types ============

/// Errors that can occur during indexer operations
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum IndexerError {
    /// No cell matching the search criteria was found
    CellNotFound,
    /// The search filter is invalid or malformed
    InvalidFilter,
    /// Query returned more results than the limit allows
    TooManyResults,
    /// Failed to parse cell data
    ParseError,
    /// Indexer data is behind the chain tip beyond tolerance
    StaleData,
    /// Script fields are invalid
    InvalidScript,
    /// Capacity value is invalid (e.g., zero or below minimum)
    InvalidCapacity,
    /// Query timed out
    Timeout,
    /// Query returned zero results when at least one was expected
    EmptyResult,
}

// ============ Sort & Order ============

/// Sort order for cell results
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SortOrder {
    /// Ascending (smallest/oldest first)
    Asc,
    /// Descending (largest/newest first)
    Desc,
}

/// Field to sort cells by
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SortBy {
    /// Sort by cell capacity in shannons
    Capacity,
    /// Sort by block number (creation time)
    BlockNumber,
    /// Sort by cell data length
    DataLen,
    /// Sort by output index within transaction
    Index,
}

// ============ Cell Type Classification ============

/// Tags identifying the type of a VibeSwap cell
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CellTypeTag {
    /// AMM liquidity pool cell
    Pool,
    /// Commit-reveal auction commit cell
    Commit,
    /// LP position token cell
    LpPosition,
    /// Lending pool cell
    LendingPool,
    /// Vault cell
    Vault,
    /// Insurance pool cell
    Insurance,
    /// Prediction market cell
    Prediction,
    /// Oracle data cell
    Oracle,
    /// Knowledge base cell
    Knowledge,
    /// Protocol configuration cell
    Config,
    /// Unrecognized cell type
    Unknown,
}

// ============ Core Data Types ============

/// Filter for matching scripts (lock or type) on cells
#[derive(Clone, Debug)]
pub struct ScriptFilter {
    /// The code hash of the script to match
    pub code_hash: [u8; 32],
    /// The hash type byte (0=Data, 1=Type, 2=Data1, 4=Data2)
    pub hash_type: u8,
    /// Optional prefix to match against script args
    pub args_prefix: Option<Vec<u8>>,
}

/// Search filter for querying cells from the indexer
#[derive(Clone, Debug)]
pub struct SearchFilter {
    /// Script filter (lock or type)
    pub script: Option<ScriptFilter>,
    /// Capacity range in shannons: (min, max)
    pub capacity_range: Option<(u64, u64)>,
    /// Data prefix to match against cell data
    pub data_prefix: Option<Vec<u8>>,
    /// Block number range: (from, to)
    pub block_range: Option<(u64, u64)>,
    /// Maximum number of results to return
    pub limit: u32,
    /// Sort order of results
    pub order: SortOrder,
}

/// Compact representation of a cell from the indexer
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CellInfo {
    /// Transaction hash containing this cell
    pub tx_hash: [u8; 32],
    /// Output index within the transaction
    pub index: u32,
    /// Cell capacity in shannons
    pub capacity: u64,
    /// Hash of the lock script
    pub lock_hash: [u8; 32],
    /// Hash of the type script (None if no type script)
    pub type_hash: Option<[u8; 32]>,
    /// Length of cell data in bytes
    pub data_len: u32,
    /// Block number where this cell was created
    pub block_number: u64,
}

/// Paginated page of cell results
#[derive(Clone, Debug)]
pub struct CellPage {
    /// Cells in this page
    pub cells: Vec<CellInfo>,
    /// Total number of cells matching the query
    pub total: u64,
    /// Whether more pages exist after this one
    pub has_more: bool,
    /// Cursor for fetching the next page
    pub cursor: Option<u64>,
}

/// Query parameters for finding AMM pool cells
#[derive(Clone, Debug)]
pub struct PoolQuery {
    /// Filter by specific pair ID
    pub pair_id: Option<[u8; 32]>,
    /// Filter by token0 type hash
    pub token0: Option<[u8; 32]>,
    /// Filter by token1 type hash
    pub token1: Option<[u8; 32]>,
    /// Minimum TVL (total value locked) in the pool
    pub min_tvl: Option<u128>,
}

/// Indexer synchronization statistics
#[derive(Clone, Debug)]
pub struct IndexerStats {
    /// Total number of cells ever indexed
    pub total_cells: u64,
    /// Number of currently live (unspent) cells
    pub live_cells: u64,
    /// Number of dead (spent) cells
    pub dead_cells: u64,
    /// Chain tip block number
    pub tip_block: u64,
    /// Last block the indexer has processed
    pub indexed_block: u64,
    /// Sync progress in basis points (10000 = fully synced)
    pub sync_progress_bps: u16,
}

/// Mapping of known VibeSwap cell type code hashes for classification
#[derive(Clone, Debug)]
pub struct CellTypeMap {
    /// AMM pool type script code hash
    pub pool_code_hash: [u8; 32],
    /// Commit cell type script code hash
    pub commit_code_hash: [u8; 32],
    /// LP position type script code hash
    pub lp_code_hash: [u8; 32],
    /// Lending pool type script code hash
    pub lending_code_hash: [u8; 32],
    /// Vault type script code hash
    pub vault_code_hash: [u8; 32],
    /// Insurance pool type script code hash
    pub insurance_code_hash: [u8; 32],
    /// Prediction market type script code hash
    pub prediction_code_hash: [u8; 32],
    /// Oracle data type script code hash
    pub oracle_code_hash: [u8; 32],
    /// Knowledge base type script code hash
    pub knowledge_code_hash: [u8; 32],
    /// Config cell type script code hash
    pub config_code_hash: [u8; 32],
}

// ============ Filter Builders ============

/// Build a script filter for matching type scripts on cells.
///
/// # Arguments
/// * `code_hash` - The code hash of the type script to match
/// * `args_prefix` - Optional prefix to match against script args
///
/// Returns a `ScriptFilter` with `hash_type = 1` (Type).
pub fn build_type_filter(code_hash: &[u8; 32], args_prefix: Option<&[u8]>) -> ScriptFilter {
    ScriptFilter {
        code_hash: *code_hash,
        hash_type: 1, // Type
        args_prefix: args_prefix.map(|p| p.to_vec()),
    }
}

/// Build a script filter for matching lock scripts on cells.
///
/// # Arguments
/// * `code_hash` - The code hash of the lock script to match
/// * `args_prefix` - Optional prefix to match against script args
///
/// Returns a `ScriptFilter` with `hash_type = 0` (Data).
pub fn build_lock_filter(code_hash: &[u8; 32], args_prefix: Option<&[u8]>) -> ScriptFilter {
    ScriptFilter {
        code_hash: *code_hash,
        hash_type: 0, // Data
        args_prefix: args_prefix.map(|p| p.to_vec()),
    }
}

// ============ Cell Classification ============

/// Classify a cell by its type script code hash against known VibeSwap types.
///
/// Compares the given code hash against all known hashes in the `CellTypeMap`
/// and returns the appropriate `CellTypeTag`. Returns `Unknown` if no match.
pub fn classify_cell(type_code_hash: &[u8; 32], known_hashes: &CellTypeMap) -> CellTypeTag {
    if *type_code_hash == known_hashes.pool_code_hash {
        CellTypeTag::Pool
    } else if *type_code_hash == known_hashes.commit_code_hash {
        CellTypeTag::Commit
    } else if *type_code_hash == known_hashes.lp_code_hash {
        CellTypeTag::LpPosition
    } else if *type_code_hash == known_hashes.lending_code_hash {
        CellTypeTag::LendingPool
    } else if *type_code_hash == known_hashes.vault_code_hash {
        CellTypeTag::Vault
    } else if *type_code_hash == known_hashes.insurance_code_hash {
        CellTypeTag::Insurance
    } else if *type_code_hash == known_hashes.prediction_code_hash {
        CellTypeTag::Prediction
    } else if *type_code_hash == known_hashes.oracle_code_hash {
        CellTypeTag::Oracle
    } else if *type_code_hash == known_hashes.knowledge_code_hash {
        CellTypeTag::Knowledge
    } else if *type_code_hash == known_hashes.config_code_hash {
        CellTypeTag::Config
    } else {
        CellTypeTag::Unknown
    }
}

// ============ Cell Filtering ============

/// Filter cells by capacity range (inclusive).
///
/// Returns references to cells whose capacity is within [min, max].
pub fn filter_by_capacity<'a>(cells: &'a [CellInfo], min: u64, max: u64) -> Vec<&'a CellInfo> {
    cells
        .iter()
        .filter(|c| c.capacity >= min && c.capacity <= max)
        .collect()
}

/// Filter cells by data length range (inclusive).
///
/// Returns references to cells whose data_len is within [min, max].
pub fn filter_by_data_len<'a>(cells: &'a [CellInfo], min: u32, max: u32) -> Vec<&'a CellInfo> {
    cells
        .iter()
        .filter(|c| c.data_len >= min && c.data_len <= max)
        .collect()
}

/// Filter cells by block number range (inclusive).
///
/// Returns references to cells created in blocks [from, to].
pub fn filter_by_block_range<'a>(cells: &'a [CellInfo], from: u64, to: u64) -> Vec<&'a CellInfo> {
    cells
        .iter()
        .filter(|c| c.block_number >= from && c.block_number <= to)
        .collect()
}

// ============ Sorting ============

/// Sort cells in-place by the given field and order.
///
/// # Arguments
/// * `cells` - Mutable slice of cells to sort
/// * `by` - Which field to sort by
/// * `order` - Ascending or descending
pub fn sort_cells(cells: &mut [CellInfo], by: SortBy, order: SortOrder) {
    cells.sort_by(|a, b| {
        let cmp = match by {
            SortBy::Capacity => a.capacity.cmp(&b.capacity),
            SortBy::BlockNumber => a.block_number.cmp(&b.block_number),
            SortBy::DataLen => a.data_len.cmp(&b.data_len),
            SortBy::Index => a.index.cmp(&b.index),
        };
        match order {
            SortOrder::Asc => cmp,
            SortOrder::Desc => cmp.reverse(),
        }
    });
}

// ============ Pagination ============

/// Paginate a slice of cells into a `CellPage`.
///
/// Pages are 0-indexed. If `page_size` is 0 or exceeds `MAX_PAGE_SIZE`,
/// it is clamped to `DEFAULT_PAGE_SIZE` or `MAX_PAGE_SIZE` respectively.
///
/// # Arguments
/// * `cells` - Full set of cells to paginate
/// * `page` - Zero-based page index
/// * `page_size` - Number of cells per page
pub fn paginate(cells: &[CellInfo], page: u32, page_size: u32) -> CellPage {
    let effective_size = if page_size == 0 {
        DEFAULT_PAGE_SIZE
    } else if page_size > MAX_PAGE_SIZE {
        MAX_PAGE_SIZE
    } else {
        page_size
    };

    let total = cells.len() as u64;
    let start = (page as usize) * (effective_size as usize);

    if start >= cells.len() {
        return CellPage {
            cells: Vec::new(),
            total,
            has_more: false,
            cursor: None,
        };
    }

    let end = (start + effective_size as usize).min(cells.len());
    let page_cells: Vec<CellInfo> = cells[start..end].to_vec();
    let has_more = end < cells.len();
    let cursor = if has_more { Some(end as u64) } else { None };

    CellPage {
        cells: page_cells,
        total,
        has_more,
        cursor,
    }
}

// ============ Deduplication ============

/// Remove duplicate cells (cells with the same tx_hash + index).
///
/// Preserves the order of first occurrence. Two cells are considered
/// duplicates if they share both the same `tx_hash` and `index`.
pub fn deduplicate<'a>(cells: &'a [CellInfo]) -> Vec<&'a CellInfo> {
    let mut seen: Vec<([u8; 32], u32)> = Vec::new();
    let mut result: Vec<&CellInfo> = Vec::new();

    for cell in cells {
        let key = (cell.tx_hash, cell.index);
        if !seen.contains(&key) {
            seen.push(key);
            result.push(cell);
        }
    }

    result
}

// ============ Cell Discovery ============

/// Find AMM pool cells from a set of cells.
///
/// A cell is considered a pool cell if its type hash matches the pool code hash
/// when classified against the known hashes map.
pub fn find_pool_cells<'a>(
    cells: &'a [CellInfo],
    pool_code_hash: &[u8; 32],
    known_hashes: &CellTypeMap,
) -> Vec<&'a CellInfo> {
    cells
        .iter()
        .filter(|c| {
            if let Some(ref th) = c.type_hash {
                // The cell's type_hash is the hash of the type script.
                // For pool cells, we match against the pool_code_hash in known_hashes.
                classify_cell(th, known_hashes) == CellTypeTag::Pool
            } else {
                false
            }
        })
        .collect()
}

/// Find cells owned by a specific user (matching lock hash).
///
/// Returns references to all cells whose `lock_hash` matches the given hash.
pub fn find_user_cells<'a>(cells: &'a [CellInfo], lock_hash: &[u8; 32]) -> Vec<&'a CellInfo> {
    cells
        .iter()
        .filter(|c| c.lock_hash == *lock_hash)
        .collect()
}

// ============ Sync Status ============

/// Calculate sync progress in basis points (0-10000).
///
/// Uses `mul_div` from vibeswap_math to safely compute:
///   progress = (indexed_block * 10000) / tip_block
///
/// Returns 10000 if tip_block is 0 (no chain data) or if indexed >= tip.
pub fn sync_progress(indexed_block: u64, tip_block: u64) -> u16 {
    if tip_block == 0 {
        return BPS_DENOMINATOR as u16;
    }
    if indexed_block >= tip_block {
        return BPS_DENOMINATOR as u16;
    }
    let progress = mul_div(
        indexed_block as u128,
        BPS_DENOMINATOR as u128,
        tip_block as u128,
    );
    progress as u16
}

/// Check whether the indexer is synced within the given tolerance.
///
/// The indexer is considered synced if:
///   tip_block <= indexed_block + tolerance
///
/// In other words, the indexer is at most `tolerance` blocks behind.
pub fn is_synced(indexed_block: u64, tip_block: u64, tolerance: u64) -> bool {
    if indexed_block >= tip_block {
        return true;
    }
    tip_block - indexed_block <= tolerance
}

// ============ Cell Age ============

/// Calculate the age of a cell in blocks.
///
/// Returns `current_block - cell_block`, or 0 if `cell_block > current_block`
/// (can happen briefly during reorgs).
pub fn cell_age_blocks(cell_block: u64, current_block: u64) -> u64 {
    current_block.saturating_sub(cell_block)
}

// ============ Estimation ============

/// Estimate the number of cells that will match a filter given the total
/// cell count and the filter's selectivity in basis points.
///
/// Uses `mul_div` for safe arithmetic:
///   estimate = (total * selectivity_bps) / 10000
///
/// A selectivity of 10000 bps means "matches everything" (100%).
/// A selectivity of 100 bps means "matches 1%".
pub fn estimate_cell_count(total: u64, filter_selectivity_bps: u16) -> u64 {
    if filter_selectivity_bps == 0 {
        return 0;
    }
    if filter_selectivity_bps >= BPS_DENOMINATOR as u16 {
        return total;
    }
    let result = mul_div(
        total as u128,
        filter_selectivity_bps as u128,
        BPS_DENOMINATOR as u128,
    );
    result as u64
}

// ============ Page Merging ============

/// Merge two `CellPage` results into one.
///
/// Concatenates cells from both pages, sums totals, and recalculates
/// `has_more` and `cursor`. The resulting page has `has_more = true` if
/// either input had `has_more = true`. The cursor is taken from `b` if
/// it exists, otherwise from `a`.
pub fn merge_pages(a: &CellPage, b: &CellPage) -> CellPage {
    let mut merged_cells = a.cells.clone();
    merged_cells.extend(b.cells.clone());

    let total = a.total + b.total;
    let has_more = a.has_more || b.has_more;
    let cursor = b.cursor.or(a.cursor);

    CellPage {
        cells: merged_cells,
        total,
        has_more,
        cursor,
    }
}

// ============ Stats Summary ============

/// Summarize indexer stats into a (is_synced, progress_bps) tuple.
///
/// Convenience function that combines `is_synced` (with default tolerance)
/// and `sync_progress` into a single call.
pub fn stats_summary(stats: &IndexerStats) -> (bool, u16) {
    let synced = is_synced(stats.indexed_block, stats.tip_block, SYNC_TOLERANCE_BLOCKS);
    let progress = sync_progress(stats.indexed_block, stats.tip_block);
    (synced, progress)
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // ============ Test Helpers ============

    fn make_cell(tx_byte: u8, index: u32, capacity: u64, block: u64, data_len: u32) -> CellInfo {
        CellInfo {
            tx_hash: [tx_byte; 32],
            index,
            capacity,
            lock_hash: [0xAA; 32],
            type_hash: None,
            data_len,
            block_number: block,
        }
    }

    fn make_cell_with_lock(
        tx_byte: u8,
        index: u32,
        capacity: u64,
        block: u64,
        lock_byte: u8,
    ) -> CellInfo {
        CellInfo {
            tx_hash: [tx_byte; 32],
            index,
            capacity,
            lock_hash: [lock_byte; 32],
            type_hash: None,
            data_len: 0,
            block_number: block,
        }
    }

    fn make_cell_with_type(
        tx_byte: u8,
        index: u32,
        capacity: u64,
        block: u64,
        type_byte: u8,
    ) -> CellInfo {
        CellInfo {
            tx_hash: [tx_byte; 32],
            index,
            capacity,
            lock_hash: [0xAA; 32],
            type_hash: Some([type_byte; 32]),
            data_len: 0,
            block_number: block,
        }
    }

    fn make_type_map() -> CellTypeMap {
        CellTypeMap {
            pool_code_hash: [0x01; 32],
            commit_code_hash: [0x02; 32],
            lp_code_hash: [0x03; 32],
            lending_code_hash: [0x04; 32],
            vault_code_hash: [0x05; 32],
            insurance_code_hash: [0x06; 32],
            prediction_code_hash: [0x07; 32],
            oracle_code_hash: [0x08; 32],
            knowledge_code_hash: [0x09; 32],
            config_code_hash: [0x0A; 32],
        }
    }

    fn make_stats(indexed: u64, tip: u64) -> IndexerStats {
        IndexerStats {
            total_cells: 1000,
            live_cells: 800,
            dead_cells: 200,
            tip_block: tip,
            indexed_block: indexed,
            sync_progress_bps: sync_progress(indexed, tip),
        }
    }

    // ============ build_type_filter Tests ============

    #[test]
    fn test_build_type_filter_no_args() {
        let hash = [0x11; 32];
        let filter = build_type_filter(&hash, None);
        assert_eq!(filter.code_hash, hash);
        assert_eq!(filter.hash_type, 1);
        assert!(filter.args_prefix.is_none());
    }

    #[test]
    fn test_build_type_filter_with_args() {
        let hash = [0x22; 32];
        let args = [0xAB, 0xCD, 0xEF];
        let filter = build_type_filter(&hash, Some(&args));
        assert_eq!(filter.code_hash, hash);
        assert_eq!(filter.hash_type, 1);
        assert_eq!(filter.args_prefix.unwrap(), vec![0xAB, 0xCD, 0xEF]);
    }

    #[test]
    fn test_build_type_filter_empty_args() {
        let hash = [0x33; 32];
        let filter = build_type_filter(&hash, Some(&[]));
        assert_eq!(filter.code_hash, hash);
        assert_eq!(filter.hash_type, 1);
        assert_eq!(filter.args_prefix.unwrap(), Vec::<u8>::new());
    }

    #[test]
    fn test_build_type_filter_long_args() {
        let hash = [0x44; 32];
        let args = vec![0xFF; 64];
        let filter = build_type_filter(&hash, Some(&args));
        assert_eq!(filter.args_prefix.unwrap().len(), 64);
    }

    // ============ build_lock_filter Tests ============

    #[test]
    fn test_build_lock_filter_no_args() {
        let hash = [0x55; 32];
        let filter = build_lock_filter(&hash, None);
        assert_eq!(filter.code_hash, hash);
        assert_eq!(filter.hash_type, 0);
        assert!(filter.args_prefix.is_none());
    }

    #[test]
    fn test_build_lock_filter_with_args() {
        let hash = [0x66; 32];
        let args = [0x01, 0x02];
        let filter = build_lock_filter(&hash, Some(&args));
        assert_eq!(filter.code_hash, hash);
        assert_eq!(filter.hash_type, 0);
        assert_eq!(filter.args_prefix.unwrap(), vec![0x01, 0x02]);
    }

    #[test]
    fn test_build_lock_filter_empty_args() {
        let hash = [0x77; 32];
        let filter = build_lock_filter(&hash, Some(&[]));
        assert_eq!(filter.hash_type, 0);
        assert_eq!(filter.args_prefix.unwrap().len(), 0);
    }

    #[test]
    fn test_build_lock_filter_single_byte_args() {
        let hash = [0x88; 32];
        let filter = build_lock_filter(&hash, Some(&[0x42]));
        assert_eq!(filter.args_prefix.unwrap(), vec![0x42]);
    }

    // ============ classify_cell Tests ============

    #[test]
    fn test_classify_pool() {
        let map = make_type_map();
        assert_eq!(classify_cell(&[0x01; 32], &map), CellTypeTag::Pool);
    }

    #[test]
    fn test_classify_commit() {
        let map = make_type_map();
        assert_eq!(classify_cell(&[0x02; 32], &map), CellTypeTag::Commit);
    }

    #[test]
    fn test_classify_lp_position() {
        let map = make_type_map();
        assert_eq!(classify_cell(&[0x03; 32], &map), CellTypeTag::LpPosition);
    }

    #[test]
    fn test_classify_lending_pool() {
        let map = make_type_map();
        assert_eq!(classify_cell(&[0x04; 32], &map), CellTypeTag::LendingPool);
    }

    #[test]
    fn test_classify_vault() {
        let map = make_type_map();
        assert_eq!(classify_cell(&[0x05; 32], &map), CellTypeTag::Vault);
    }

    #[test]
    fn test_classify_insurance() {
        let map = make_type_map();
        assert_eq!(classify_cell(&[0x06; 32], &map), CellTypeTag::Insurance);
    }

    #[test]
    fn test_classify_prediction() {
        let map = make_type_map();
        assert_eq!(classify_cell(&[0x07; 32], &map), CellTypeTag::Prediction);
    }

    #[test]
    fn test_classify_oracle() {
        let map = make_type_map();
        assert_eq!(classify_cell(&[0x08; 32], &map), CellTypeTag::Oracle);
    }

    #[test]
    fn test_classify_knowledge() {
        let map = make_type_map();
        assert_eq!(classify_cell(&[0x09; 32], &map), CellTypeTag::Knowledge);
    }

    #[test]
    fn test_classify_config() {
        let map = make_type_map();
        assert_eq!(classify_cell(&[0x0A; 32], &map), CellTypeTag::Config);
    }

    #[test]
    fn test_classify_unknown() {
        let map = make_type_map();
        assert_eq!(classify_cell(&[0xFF; 32], &map), CellTypeTag::Unknown);
    }

    #[test]
    fn test_classify_zero_hash() {
        let map = make_type_map();
        assert_eq!(classify_cell(&[0x00; 32], &map), CellTypeTag::Unknown);
    }

    // ============ filter_by_capacity Tests ============

    #[test]
    fn test_filter_capacity_within_range() {
        let cells = vec![
            make_cell(1, 0, 100, 1, 0),
            make_cell(2, 0, 200, 1, 0),
            make_cell(3, 0, 300, 1, 0),
        ];
        let result = filter_by_capacity(&cells, 150, 250);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].capacity, 200);
    }

    #[test]
    fn test_filter_capacity_all_match() {
        let cells = vec![
            make_cell(1, 0, 100, 1, 0),
            make_cell(2, 0, 200, 1, 0),
        ];
        let result = filter_by_capacity(&cells, 0, 1000);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_filter_capacity_none_match() {
        let cells = vec![
            make_cell(1, 0, 100, 1, 0),
            make_cell(2, 0, 200, 1, 0),
        ];
        let result = filter_by_capacity(&cells, 500, 1000);
        assert_eq!(result.len(), 0);
    }

    #[test]
    fn test_filter_capacity_below_min() {
        let cells = vec![make_cell(1, 0, 50, 1, 0)];
        let result = filter_by_capacity(&cells, 100, 200);
        assert_eq!(result.len(), 0);
    }

    #[test]
    fn test_filter_capacity_above_max() {
        let cells = vec![make_cell(1, 0, 500, 1, 0)];
        let result = filter_by_capacity(&cells, 100, 200);
        assert_eq!(result.len(), 0);
    }

    #[test]
    fn test_filter_capacity_empty_input() {
        let cells: Vec<CellInfo> = vec![];
        let result = filter_by_capacity(&cells, 0, u64::MAX);
        assert_eq!(result.len(), 0);
    }

    #[test]
    fn test_filter_capacity_single_cell_match() {
        let cells = vec![make_cell(1, 0, 150, 1, 0)];
        let result = filter_by_capacity(&cells, 100, 200);
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn test_filter_capacity_boundary_min() {
        let cells = vec![make_cell(1, 0, 100, 1, 0)];
        let result = filter_by_capacity(&cells, 100, 200);
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn test_filter_capacity_boundary_max() {
        let cells = vec![make_cell(1, 0, 200, 1, 0)];
        let result = filter_by_capacity(&cells, 100, 200);
        assert_eq!(result.len(), 1);
    }

    // ============ filter_by_data_len Tests ============

    #[test]
    fn test_filter_data_len_within_range() {
        let cells = vec![
            make_cell(1, 0, 100, 1, 10),
            make_cell(2, 0, 100, 1, 50),
            make_cell(3, 0, 100, 1, 100),
        ];
        let result = filter_by_data_len(&cells, 20, 80);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].data_len, 50);
    }

    #[test]
    fn test_filter_data_len_none_match() {
        let cells = vec![
            make_cell(1, 0, 100, 1, 10),
            make_cell(2, 0, 100, 1, 20),
        ];
        let result = filter_by_data_len(&cells, 50, 100);
        assert_eq!(result.len(), 0);
    }

    #[test]
    fn test_filter_data_len_all_match() {
        let cells = vec![
            make_cell(1, 0, 100, 1, 10),
            make_cell(2, 0, 100, 1, 20),
        ];
        let result = filter_by_data_len(&cells, 0, 100);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_filter_data_len_empty() {
        let cells: Vec<CellInfo> = vec![];
        let result = filter_by_data_len(&cells, 0, 100);
        assert_eq!(result.len(), 0);
    }

    #[test]
    fn test_filter_data_len_zero() {
        let cells = vec![make_cell(1, 0, 100, 1, 0)];
        let result = filter_by_data_len(&cells, 0, 0);
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn test_filter_data_len_boundary() {
        let cells = vec![make_cell(1, 0, 100, 1, 32)];
        let result = filter_by_data_len(&cells, 32, 32);
        assert_eq!(result.len(), 1);
    }

    // ============ filter_by_block_range Tests ============

    #[test]
    fn test_filter_block_range_within() {
        let cells = vec![
            make_cell(1, 0, 100, 100, 0),
            make_cell(2, 0, 100, 200, 0),
            make_cell(3, 0, 100, 300, 0),
        ];
        let result = filter_by_block_range(&cells, 150, 250);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].block_number, 200);
    }

    #[test]
    fn test_filter_block_range_before() {
        let cells = vec![make_cell(1, 0, 100, 50, 0)];
        let result = filter_by_block_range(&cells, 100, 200);
        assert_eq!(result.len(), 0);
    }

    #[test]
    fn test_filter_block_range_after() {
        let cells = vec![make_cell(1, 0, 100, 500, 0)];
        let result = filter_by_block_range(&cells, 100, 200);
        assert_eq!(result.len(), 0);
    }

    #[test]
    fn test_filter_block_range_at_boundaries() {
        let cells = vec![
            make_cell(1, 0, 100, 100, 0),
            make_cell(2, 0, 100, 200, 0),
        ];
        let result = filter_by_block_range(&cells, 100, 200);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_filter_block_range_empty() {
        let cells: Vec<CellInfo> = vec![];
        let result = filter_by_block_range(&cells, 0, 1000);
        assert_eq!(result.len(), 0);
    }

    #[test]
    fn test_filter_block_range_single_block() {
        let cells = vec![
            make_cell(1, 0, 100, 500, 0),
            make_cell(2, 0, 100, 500, 0),
            make_cell(3, 0, 100, 600, 0),
        ];
        let result = filter_by_block_range(&cells, 500, 500);
        assert_eq!(result.len(), 2);
    }

    // ============ sort_cells Tests ============

    #[test]
    fn test_sort_by_capacity_asc() {
        let mut cells = vec![
            make_cell(1, 0, 300, 1, 0),
            make_cell(2, 0, 100, 1, 0),
            make_cell(3, 0, 200, 1, 0),
        ];
        sort_cells(&mut cells, SortBy::Capacity, SortOrder::Asc);
        assert_eq!(cells[0].capacity, 100);
        assert_eq!(cells[1].capacity, 200);
        assert_eq!(cells[2].capacity, 300);
    }

    #[test]
    fn test_sort_by_capacity_desc() {
        let mut cells = vec![
            make_cell(1, 0, 100, 1, 0),
            make_cell(2, 0, 300, 1, 0),
            make_cell(3, 0, 200, 1, 0),
        ];
        sort_cells(&mut cells, SortBy::Capacity, SortOrder::Desc);
        assert_eq!(cells[0].capacity, 300);
        assert_eq!(cells[1].capacity, 200);
        assert_eq!(cells[2].capacity, 100);
    }

    #[test]
    fn test_sort_by_block_number_asc() {
        let mut cells = vec![
            make_cell(1, 0, 100, 300, 0),
            make_cell(2, 0, 100, 100, 0),
            make_cell(3, 0, 100, 200, 0),
        ];
        sort_cells(&mut cells, SortBy::BlockNumber, SortOrder::Asc);
        assert_eq!(cells[0].block_number, 100);
        assert_eq!(cells[1].block_number, 200);
        assert_eq!(cells[2].block_number, 300);
    }

    #[test]
    fn test_sort_by_block_number_desc() {
        let mut cells = vec![
            make_cell(1, 0, 100, 100, 0),
            make_cell(2, 0, 100, 300, 0),
            make_cell(3, 0, 100, 200, 0),
        ];
        sort_cells(&mut cells, SortBy::BlockNumber, SortOrder::Desc);
        assert_eq!(cells[0].block_number, 300);
        assert_eq!(cells[1].block_number, 200);
        assert_eq!(cells[2].block_number, 100);
    }

    #[test]
    fn test_sort_by_data_len_asc() {
        let mut cells = vec![
            make_cell(1, 0, 100, 1, 50),
            make_cell(2, 0, 100, 1, 10),
            make_cell(3, 0, 100, 1, 30),
        ];
        sort_cells(&mut cells, SortBy::DataLen, SortOrder::Asc);
        assert_eq!(cells[0].data_len, 10);
        assert_eq!(cells[1].data_len, 30);
        assert_eq!(cells[2].data_len, 50);
    }

    #[test]
    fn test_sort_by_data_len_desc() {
        let mut cells = vec![
            make_cell(1, 0, 100, 1, 10),
            make_cell(2, 0, 100, 1, 50),
            make_cell(3, 0, 100, 1, 30),
        ];
        sort_cells(&mut cells, SortBy::DataLen, SortOrder::Desc);
        assert_eq!(cells[0].data_len, 50);
        assert_eq!(cells[1].data_len, 30);
        assert_eq!(cells[2].data_len, 10);
    }

    #[test]
    fn test_sort_by_index_asc() {
        let mut cells = vec![
            make_cell(1, 3, 100, 1, 0),
            make_cell(1, 1, 100, 1, 0),
            make_cell(1, 2, 100, 1, 0),
        ];
        sort_cells(&mut cells, SortBy::Index, SortOrder::Asc);
        assert_eq!(cells[0].index, 1);
        assert_eq!(cells[1].index, 2);
        assert_eq!(cells[2].index, 3);
    }

    #[test]
    fn test_sort_by_index_desc() {
        let mut cells = vec![
            make_cell(1, 1, 100, 1, 0),
            make_cell(1, 3, 100, 1, 0),
            make_cell(1, 2, 100, 1, 0),
        ];
        sort_cells(&mut cells, SortBy::Index, SortOrder::Desc);
        assert_eq!(cells[0].index, 3);
        assert_eq!(cells[1].index, 2);
        assert_eq!(cells[2].index, 1);
    }

    #[test]
    fn test_sort_empty_slice() {
        let mut cells: Vec<CellInfo> = vec![];
        sort_cells(&mut cells, SortBy::Capacity, SortOrder::Asc);
        assert!(cells.is_empty());
    }

    #[test]
    fn test_sort_single_element() {
        let mut cells = vec![make_cell(1, 0, 100, 1, 0)];
        sort_cells(&mut cells, SortBy::Capacity, SortOrder::Asc);
        assert_eq!(cells.len(), 1);
        assert_eq!(cells[0].capacity, 100);
    }

    #[test]
    fn test_sort_ties_stable() {
        let mut cells = vec![
            make_cell(1, 0, 100, 1, 0),
            make_cell(2, 0, 100, 2, 0),
            make_cell(3, 0, 100, 3, 0),
        ];
        sort_cells(&mut cells, SortBy::Capacity, SortOrder::Asc);
        // All same capacity — stable sort preserves original order
        assert_eq!(cells[0].tx_hash[0], 1);
        assert_eq!(cells[1].tx_hash[0], 2);
        assert_eq!(cells[2].tx_hash[0], 3);
    }

    // ============ paginate Tests ============

    #[test]
    fn test_paginate_first_page() {
        let cells: Vec<CellInfo> = (0..10).map(|i| make_cell(i, 0, 100, 1, 0)).collect();
        let page = paginate(&cells, 0, 3);
        assert_eq!(page.cells.len(), 3);
        assert_eq!(page.total, 10);
        assert!(page.has_more);
        assert_eq!(page.cursor, Some(3));
    }

    #[test]
    fn test_paginate_middle_page() {
        let cells: Vec<CellInfo> = (0..10).map(|i| make_cell(i, 0, 100, 1, 0)).collect();
        let page = paginate(&cells, 1, 3);
        assert_eq!(page.cells.len(), 3);
        assert_eq!(page.total, 10);
        assert!(page.has_more);
        assert_eq!(page.cursor, Some(6));
    }

    #[test]
    fn test_paginate_last_page() {
        let cells: Vec<CellInfo> = (0..10).map(|i| make_cell(i, 0, 100, 1, 0)).collect();
        let page = paginate(&cells, 3, 3);
        assert_eq!(page.cells.len(), 1);
        assert_eq!(page.total, 10);
        assert!(!page.has_more);
        assert!(page.cursor.is_none());
    }

    #[test]
    fn test_paginate_beyond_end() {
        let cells: Vec<CellInfo> = (0..5).map(|i| make_cell(i, 0, 100, 1, 0)).collect();
        let page = paginate(&cells, 10, 3);
        assert_eq!(page.cells.len(), 0);
        assert_eq!(page.total, 5);
        assert!(!page.has_more);
        assert!(page.cursor.is_none());
    }

    #[test]
    fn test_paginate_page_size_larger_than_total() {
        let cells: Vec<CellInfo> = (0..3).map(|i| make_cell(i, 0, 100, 1, 0)).collect();
        let page = paginate(&cells, 0, 100);
        assert_eq!(page.cells.len(), 3);
        assert_eq!(page.total, 3);
        assert!(!page.has_more);
        assert!(page.cursor.is_none());
    }

    #[test]
    fn test_paginate_empty_input() {
        let cells: Vec<CellInfo> = vec![];
        let page = paginate(&cells, 0, 10);
        assert_eq!(page.cells.len(), 0);
        assert_eq!(page.total, 0);
        assert!(!page.has_more);
    }

    #[test]
    fn test_paginate_zero_page_size_defaults() {
        let cells: Vec<CellInfo> = (0..5).map(|i| make_cell(i, 0, 100, 1, 0)).collect();
        let page = paginate(&cells, 0, 0);
        // Should default to DEFAULT_PAGE_SIZE (100), which is > 5
        assert_eq!(page.cells.len(), 5);
        assert!(!page.has_more);
    }

    #[test]
    fn test_paginate_over_max_page_size_clamped() {
        let cells: Vec<CellInfo> = (0..5).map(|i| make_cell(i, 0, 100, 1, 0)).collect();
        let page = paginate(&cells, 0, MAX_PAGE_SIZE + 100);
        // Clamped to MAX_PAGE_SIZE (1000), still > 5
        assert_eq!(page.cells.len(), 5);
    }

    #[test]
    fn test_paginate_exact_page_boundary() {
        let cells: Vec<CellInfo> = (0..6).map(|i| make_cell(i, 0, 100, 1, 0)).collect();
        let page = paginate(&cells, 1, 3);
        assert_eq!(page.cells.len(), 3);
        assert!(!page.has_more);
        assert!(page.cursor.is_none());
    }

    #[test]
    fn test_paginate_single_cell_single_page() {
        let cells = vec![make_cell(1, 0, 100, 1, 0)];
        let page = paginate(&cells, 0, 10);
        assert_eq!(page.cells.len(), 1);
        assert_eq!(page.total, 1);
        assert!(!page.has_more);
    }

    // ============ deduplicate Tests ============

    #[test]
    fn test_deduplicate_no_dups() {
        let cells = vec![
            make_cell(1, 0, 100, 1, 0),
            make_cell(2, 0, 100, 1, 0),
            make_cell(3, 0, 100, 1, 0),
        ];
        let result = deduplicate(&cells);
        assert_eq!(result.len(), 3);
    }

    #[test]
    fn test_deduplicate_with_dups() {
        let cells = vec![
            make_cell(1, 0, 100, 1, 0),
            make_cell(1, 0, 200, 2, 0), // same tx_hash+index, different capacity
            make_cell(2, 0, 100, 1, 0),
        ];
        let result = deduplicate(&cells);
        assert_eq!(result.len(), 2);
        // First occurrence preserved
        assert_eq!(result[0].capacity, 100);
        assert_eq!(result[1].tx_hash[0], 2);
    }

    #[test]
    fn test_deduplicate_all_same() {
        let cells = vec![
            make_cell(1, 0, 100, 1, 0),
            make_cell(1, 0, 100, 1, 0),
            make_cell(1, 0, 100, 1, 0),
        ];
        let result = deduplicate(&cells);
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn test_deduplicate_empty() {
        let cells: Vec<CellInfo> = vec![];
        let result = deduplicate(&cells);
        assert_eq!(result.len(), 0);
    }

    #[test]
    fn test_deduplicate_same_tx_different_index() {
        let cells = vec![
            make_cell(1, 0, 100, 1, 0),
            make_cell(1, 1, 200, 1, 0),
            make_cell(1, 2, 300, 1, 0),
        ];
        let result = deduplicate(&cells);
        assert_eq!(result.len(), 3); // Different indices = different cells
    }

    #[test]
    fn test_deduplicate_preserves_order() {
        let cells = vec![
            make_cell(3, 0, 100, 1, 0),
            make_cell(1, 0, 100, 1, 0),
            make_cell(2, 0, 100, 1, 0),
            make_cell(1, 0, 100, 1, 0), // dup
        ];
        let result = deduplicate(&cells);
        assert_eq!(result.len(), 3);
        assert_eq!(result[0].tx_hash[0], 3);
        assert_eq!(result[1].tx_hash[0], 1);
        assert_eq!(result[2].tx_hash[0], 2);
    }

    // ============ find_pool_cells Tests ============

    #[test]
    fn test_find_pool_cells_found() {
        let map = make_type_map();
        let cells = vec![
            make_cell_with_type(1, 0, 100, 1, 0x01), // pool
            make_cell_with_type(2, 0, 100, 1, 0x02), // commit
            make_cell_with_type(3, 0, 100, 1, 0x01), // pool
        ];
        let result = find_pool_cells(&cells, &map.pool_code_hash, &map);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_find_pool_cells_none() {
        let map = make_type_map();
        let cells = vec![
            make_cell_with_type(1, 0, 100, 1, 0x02), // commit
            make_cell_with_type(2, 0, 100, 1, 0x03), // lp
        ];
        let result = find_pool_cells(&cells, &map.pool_code_hash, &map);
        assert_eq!(result.len(), 0);
    }

    #[test]
    fn test_find_pool_cells_no_type_script() {
        let map = make_type_map();
        let cells = vec![
            make_cell(1, 0, 100, 1, 0), // no type hash
        ];
        let result = find_pool_cells(&cells, &map.pool_code_hash, &map);
        assert_eq!(result.len(), 0);
    }

    #[test]
    fn test_find_pool_cells_mixed_types() {
        let map = make_type_map();
        let cells = vec![
            make_cell_with_type(1, 0, 100, 1, 0x01), // pool
            make_cell(2, 0, 100, 1, 0),                // no type
            make_cell_with_type(3, 0, 100, 1, 0xFF),  // unknown
            make_cell_with_type(4, 0, 100, 1, 0x01),  // pool
        ];
        let result = find_pool_cells(&cells, &map.pool_code_hash, &map);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_find_pool_cells_empty() {
        let map = make_type_map();
        let cells: Vec<CellInfo> = vec![];
        let result = find_pool_cells(&cells, &map.pool_code_hash, &map);
        assert_eq!(result.len(), 0);
    }

    // ============ find_user_cells Tests ============

    #[test]
    fn test_find_user_cells_found() {
        let lock = [0xBB; 32];
        let cells = vec![
            make_cell_with_lock(1, 0, 100, 1, 0xBB),
            make_cell_with_lock(2, 0, 200, 1, 0xCC),
            make_cell_with_lock(3, 0, 300, 1, 0xBB),
        ];
        let result = find_user_cells(&cells, &lock);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].capacity, 100);
        assert_eq!(result[1].capacity, 300);
    }

    #[test]
    fn test_find_user_cells_none() {
        let lock = [0xDD; 32];
        let cells = vec![
            make_cell_with_lock(1, 0, 100, 1, 0xBB),
            make_cell_with_lock(2, 0, 200, 1, 0xCC),
        ];
        let result = find_user_cells(&cells, &lock);
        assert_eq!(result.len(), 0);
    }

    #[test]
    fn test_find_user_cells_all_match() {
        let lock = [0xEE; 32];
        let cells = vec![
            make_cell_with_lock(1, 0, 100, 1, 0xEE),
            make_cell_with_lock(2, 0, 200, 1, 0xEE),
        ];
        let result = find_user_cells(&cells, &lock);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_find_user_cells_empty() {
        let lock = [0xFF; 32];
        let cells: Vec<CellInfo> = vec![];
        let result = find_user_cells(&cells, &lock);
        assert_eq!(result.len(), 0);
    }

    // ============ sync_progress Tests ============

    #[test]
    fn test_sync_progress_zero_tip() {
        assert_eq!(sync_progress(0, 0), 10000);
    }

    #[test]
    fn test_sync_progress_fully_synced() {
        assert_eq!(sync_progress(1000, 1000), 10000);
    }

    #[test]
    fn test_sync_progress_over_tip() {
        // Can happen briefly during reorganization
        assert_eq!(sync_progress(1100, 1000), 10000);
    }

    #[test]
    fn test_sync_progress_half() {
        assert_eq!(sync_progress(500, 1000), 5000);
    }

    #[test]
    fn test_sync_progress_quarter() {
        assert_eq!(sync_progress(250, 1000), 2500);
    }

    #[test]
    fn test_sync_progress_near_zero() {
        assert_eq!(sync_progress(1, 10000), 1);
    }

    #[test]
    fn test_sync_progress_one_behind() {
        // 999/1000 = 9990 bps
        assert_eq!(sync_progress(999, 1000), 9990);
    }

    #[test]
    fn test_sync_progress_ten_percent() {
        assert_eq!(sync_progress(100, 1000), 1000);
    }

    // ============ is_synced Tests ============

    #[test]
    fn test_is_synced_exact() {
        assert!(is_synced(1000, 1000, 10));
    }

    #[test]
    fn test_is_synced_ahead() {
        assert!(is_synced(1005, 1000, 10));
    }

    #[test]
    fn test_is_synced_within_tolerance() {
        assert!(is_synced(995, 1000, 10));
    }

    #[test]
    fn test_is_synced_at_tolerance_boundary() {
        assert!(is_synced(990, 1000, 10));
    }

    #[test]
    fn test_is_synced_beyond_tolerance() {
        assert!(!is_synced(989, 1000, 10));
    }

    #[test]
    fn test_is_synced_far_behind() {
        assert!(!is_synced(0, 1000, 10));
    }

    #[test]
    fn test_is_synced_zero_tolerance() {
        assert!(is_synced(1000, 1000, 0));
        assert!(!is_synced(999, 1000, 0));
    }

    #[test]
    fn test_is_synced_large_tolerance() {
        assert!(is_synced(0, 1000, 1000));
    }

    // ============ cell_age_blocks Tests ============

    #[test]
    fn test_cell_age_normal() {
        assert_eq!(cell_age_blocks(100, 200), 100);
    }

    #[test]
    fn test_cell_age_fresh() {
        assert_eq!(cell_age_blocks(1000, 1000), 0);
    }

    #[test]
    fn test_cell_age_very_old() {
        assert_eq!(cell_age_blocks(0, MAX_CELL_AGE_BLOCKS), MAX_CELL_AGE_BLOCKS);
    }

    #[test]
    fn test_cell_age_future_block_saturates() {
        // Cell appears to be from the future (reorg scenario)
        assert_eq!(cell_age_blocks(200, 100), 0);
    }

    #[test]
    fn test_cell_age_at_boundary() {
        assert_eq!(cell_age_blocks(1, MAX_CELL_AGE_BLOCKS + 1), MAX_CELL_AGE_BLOCKS);
    }

    #[test]
    fn test_cell_age_zero_blocks() {
        assert_eq!(cell_age_blocks(0, 0), 0);
    }

    // ============ estimate_cell_count Tests ============

    #[test]
    fn test_estimate_full_selectivity() {
        assert_eq!(estimate_cell_count(1000, 10000), 1000);
    }

    #[test]
    fn test_estimate_half_selectivity() {
        assert_eq!(estimate_cell_count(1000, 5000), 500);
    }

    #[test]
    fn test_estimate_one_percent() {
        assert_eq!(estimate_cell_count(10000, 100), 100);
    }

    #[test]
    fn test_estimate_zero_selectivity() {
        assert_eq!(estimate_cell_count(1000, 0), 0);
    }

    #[test]
    fn test_estimate_zero_total() {
        assert_eq!(estimate_cell_count(0, 5000), 0);
    }

    #[test]
    fn test_estimate_over_100_percent() {
        // Selectivity > 10000 should be clamped to total
        assert_eq!(estimate_cell_count(1000, 15000), 1000);
    }

    #[test]
    fn test_estimate_small_selectivity() {
        // 1 bps = 0.01%
        assert_eq!(estimate_cell_count(10000, 1), 1);
    }

    #[test]
    fn test_estimate_large_total() {
        assert_eq!(estimate_cell_count(1_000_000, 5000), 500_000);
    }

    // ============ merge_pages Tests ============

    #[test]
    fn test_merge_disjoint_pages() {
        let a = CellPage {
            cells: vec![make_cell(1, 0, 100, 1, 0)],
            total: 5,
            has_more: true,
            cursor: Some(1),
        };
        let b = CellPage {
            cells: vec![make_cell(2, 0, 200, 1, 0)],
            total: 3,
            has_more: false,
            cursor: None,
        };
        let merged = merge_pages(&a, &b);
        assert_eq!(merged.cells.len(), 2);
        assert_eq!(merged.total, 8);
        assert!(merged.has_more); // a.has_more was true
        assert_eq!(merged.cursor, Some(1)); // b has no cursor, falls back to a
    }

    #[test]
    fn test_merge_both_has_more() {
        let a = CellPage {
            cells: vec![make_cell(1, 0, 100, 1, 0)],
            total: 5,
            has_more: true,
            cursor: Some(1),
        };
        let b = CellPage {
            cells: vec![make_cell(2, 0, 200, 1, 0)],
            total: 5,
            has_more: true,
            cursor: Some(2),
        };
        let merged = merge_pages(&a, &b);
        assert_eq!(merged.cells.len(), 2);
        assert_eq!(merged.total, 10);
        assert!(merged.has_more);
        assert_eq!(merged.cursor, Some(2)); // b's cursor takes priority
    }

    #[test]
    fn test_merge_empty_pages() {
        let a = CellPage {
            cells: vec![],
            total: 0,
            has_more: false,
            cursor: None,
        };
        let b = CellPage {
            cells: vec![],
            total: 0,
            has_more: false,
            cursor: None,
        };
        let merged = merge_pages(&a, &b);
        assert_eq!(merged.cells.len(), 0);
        assert_eq!(merged.total, 0);
        assert!(!merged.has_more);
        assert!(merged.cursor.is_none());
    }

    #[test]
    fn test_merge_one_empty() {
        let a = CellPage {
            cells: vec![make_cell(1, 0, 100, 1, 0), make_cell(2, 0, 200, 1, 0)],
            total: 2,
            has_more: false,
            cursor: None,
        };
        let b = CellPage {
            cells: vec![],
            total: 0,
            has_more: false,
            cursor: None,
        };
        let merged = merge_pages(&a, &b);
        assert_eq!(merged.cells.len(), 2);
        assert_eq!(merged.total, 2);
    }

    #[test]
    fn test_merge_preserves_cell_order() {
        let a = CellPage {
            cells: vec![make_cell(1, 0, 100, 1, 0)],
            total: 1,
            has_more: false,
            cursor: None,
        };
        let b = CellPage {
            cells: vec![make_cell(2, 0, 200, 1, 0)],
            total: 1,
            has_more: false,
            cursor: None,
        };
        let merged = merge_pages(&a, &b);
        assert_eq!(merged.cells[0].tx_hash[0], 1);
        assert_eq!(merged.cells[1].tx_hash[0], 2);
    }

    // ============ stats_summary Tests ============

    #[test]
    fn test_stats_summary_synced() {
        let stats = make_stats(1000, 1000);
        let (synced, progress) = stats_summary(&stats);
        assert!(synced);
        assert_eq!(progress, 10000);
    }

    #[test]
    fn test_stats_summary_behind() {
        let stats = make_stats(500, 1000);
        let (synced, progress) = stats_summary(&stats);
        assert!(!synced);
        assert_eq!(progress, 5000);
    }

    #[test]
    fn test_stats_summary_within_tolerance() {
        let stats = make_stats(995, 1000);
        let (synced, progress) = stats_summary(&stats);
        assert!(synced);
        assert_eq!(progress, 9950);
    }

    #[test]
    fn test_stats_summary_just_outside_tolerance() {
        let stats = make_stats(989, 1000);
        let (synced, progress) = stats_summary(&stats);
        assert!(!synced);
        assert_eq!(progress, 9890);
    }

    // ============ SearchFilter Construction Tests ============

    #[test]
    fn test_search_filter_defaults() {
        let filter = SearchFilter {
            script: None,
            capacity_range: None,
            data_prefix: None,
            block_range: None,
            limit: DEFAULT_PAGE_SIZE,
            order: SortOrder::Asc,
        };
        assert!(filter.script.is_none());
        assert!(filter.capacity_range.is_none());
        assert_eq!(filter.limit, 100);
    }

    #[test]
    fn test_search_filter_with_all_fields() {
        let sf = build_type_filter(&[0x11; 32], Some(&[0xAB]));
        let filter = SearchFilter {
            script: Some(sf),
            capacity_range: Some((100, 1000)),
            data_prefix: Some(vec![0x01, 0x02]),
            block_range: Some((50, 200)),
            limit: 50,
            order: SortOrder::Desc,
        };
        assert!(filter.script.is_some());
        assert_eq!(filter.capacity_range, Some((100, 1000)));
        assert_eq!(filter.data_prefix.as_ref().unwrap().len(), 2);
        assert_eq!(filter.block_range, Some((50, 200)));
        assert_eq!(filter.limit, 50);
        assert_eq!(filter.order, SortOrder::Desc);
    }

    // ============ CellInfo Construction Tests ============

    #[test]
    fn test_cell_info_no_type_hash() {
        let cell = make_cell(1, 0, 100, 50, 32);
        assert!(cell.type_hash.is_none());
        assert_eq!(cell.data_len, 32);
        assert_eq!(cell.block_number, 50);
    }

    #[test]
    fn test_cell_info_with_type_hash() {
        let cell = make_cell_with_type(1, 0, 100, 50, 0x01);
        assert!(cell.type_hash.is_some());
        assert_eq!(cell.type_hash.unwrap(), [0x01; 32]);
    }

    // ============ PoolQuery Construction Tests ============

    #[test]
    fn test_pool_query_empty() {
        let q = PoolQuery {
            pair_id: None,
            token0: None,
            token1: None,
            min_tvl: None,
        };
        assert!(q.pair_id.is_none());
        assert!(q.token0.is_none());
    }

    #[test]
    fn test_pool_query_full() {
        let q = PoolQuery {
            pair_id: Some([0x11; 32]),
            token0: Some([0x22; 32]),
            token1: Some([0x33; 32]),
            min_tvl: Some(1_000_000),
        };
        assert_eq!(q.pair_id.unwrap(), [0x11; 32]);
        assert_eq!(q.min_tvl.unwrap(), 1_000_000);
    }

    // ============ IndexerStats Tests ============

    #[test]
    fn test_indexer_stats_consistency() {
        let stats = IndexerStats {
            total_cells: 1000,
            live_cells: 800,
            dead_cells: 200,
            tip_block: 5000,
            indexed_block: 4990,
            sync_progress_bps: sync_progress(4990, 5000),
        };
        assert_eq!(stats.total_cells, stats.live_cells + stats.dead_cells);
        assert_eq!(stats.sync_progress_bps, 9980);
    }

    // ============ CellTypeMap Tests ============

    #[test]
    fn test_cell_type_map_all_unique() {
        let map = make_type_map();
        let hashes = [
            map.pool_code_hash,
            map.commit_code_hash,
            map.lp_code_hash,
            map.lending_code_hash,
            map.vault_code_hash,
            map.insurance_code_hash,
            map.prediction_code_hash,
            map.oracle_code_hash,
            map.knowledge_code_hash,
            map.config_code_hash,
        ];
        // All should be unique
        for i in 0..hashes.len() {
            for j in (i + 1)..hashes.len() {
                assert_ne!(hashes[i], hashes[j], "hashes {} and {} collide", i, j);
            }
        }
    }

    // ============ Edge Case Tests ============

    #[test]
    fn test_filter_capacity_min_equals_max() {
        let cells = vec![
            make_cell(1, 0, 100, 1, 0),
            make_cell(2, 0, 200, 1, 0),
        ];
        let result = filter_by_capacity(&cells, 100, 100);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].capacity, 100);
    }

    #[test]
    fn test_filter_block_range_max_u64() {
        let cells = vec![make_cell(1, 0, 100, u64::MAX, 0)];
        let result = filter_by_block_range(&cells, 0, u64::MAX);
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn test_sort_already_sorted() {
        let mut cells = vec![
            make_cell(1, 0, 100, 1, 0),
            make_cell(2, 0, 200, 1, 0),
            make_cell(3, 0, 300, 1, 0),
        ];
        sort_cells(&mut cells, SortBy::Capacity, SortOrder::Asc);
        assert_eq!(cells[0].capacity, 100);
        assert_eq!(cells[2].capacity, 300);
    }

    #[test]
    fn test_sort_reverse_sorted() {
        let mut cells = vec![
            make_cell(1, 0, 300, 1, 0),
            make_cell(2, 0, 200, 1, 0),
            make_cell(3, 0, 100, 1, 0),
        ];
        sort_cells(&mut cells, SortBy::Capacity, SortOrder::Asc);
        assert_eq!(cells[0].capacity, 100);
        assert_eq!(cells[2].capacity, 300);
    }

    #[test]
    fn test_deduplicate_different_index_same_tx() {
        let cells = vec![
            make_cell(0xAA, 0, 100, 1, 0),
            make_cell(0xAA, 1, 200, 1, 0),
        ];
        let result = deduplicate(&cells);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_cell_age_one_block() {
        assert_eq!(cell_age_blocks(99, 100), 1);
    }

    #[test]
    fn test_estimate_ninety_nine_percent() {
        assert_eq!(estimate_cell_count(10000, 9900), 9900);
    }

    #[test]
    fn test_estimate_exact_bps() {
        // 3333 bps of 30000 = 9999
        assert_eq!(estimate_cell_count(30000, 3333), 9999);
    }

    #[test]
    fn test_sync_progress_large_blocks() {
        // Regression: large block numbers should not overflow
        let progress = sync_progress(9_999_990, 10_000_000);
        assert_eq!(progress, 9999); // 99.99%
    }

    #[test]
    fn test_is_synced_both_zero() {
        assert!(is_synced(0, 0, 0));
    }

    #[test]
    fn test_merge_pages_cursor_from_b() {
        let a = CellPage {
            cells: vec![],
            total: 0,
            has_more: false,
            cursor: Some(5),
        };
        let b = CellPage {
            cells: vec![],
            total: 0,
            has_more: false,
            cursor: Some(10),
        };
        let merged = merge_pages(&a, &b);
        assert_eq!(merged.cursor, Some(10));
    }

    #[test]
    fn test_merge_pages_cursor_from_a_when_b_none() {
        let a = CellPage {
            cells: vec![],
            total: 0,
            has_more: false,
            cursor: Some(5),
        };
        let b = CellPage {
            cells: vec![],
            total: 0,
            has_more: false,
            cursor: None,
        };
        let merged = merge_pages(&a, &b);
        assert_eq!(merged.cursor, Some(5));
    }

    #[test]
    fn test_paginate_page_1_of_1() {
        let cells = vec![make_cell(1, 0, 100, 1, 0)];
        let page = paginate(&cells, 0, 1);
        assert_eq!(page.cells.len(), 1);
        assert!(!page.has_more);
        assert_eq!(page.total, 1);
    }

    #[test]
    fn test_filter_data_len_large_range() {
        let cells = vec![
            make_cell(1, 0, 100, 1, 0),
            make_cell(2, 0, 100, 1, u32::MAX),
        ];
        let result = filter_by_data_len(&cells, 0, u32::MAX);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_classify_cell_all_tags_covered() {
        let map = make_type_map();
        // Verify each tag is reachable
        let tags = vec![
            (map.pool_code_hash, CellTypeTag::Pool),
            (map.commit_code_hash, CellTypeTag::Commit),
            (map.lp_code_hash, CellTypeTag::LpPosition),
            (map.lending_code_hash, CellTypeTag::LendingPool),
            (map.vault_code_hash, CellTypeTag::Vault),
            (map.insurance_code_hash, CellTypeTag::Insurance),
            (map.prediction_code_hash, CellTypeTag::Prediction),
            (map.oracle_code_hash, CellTypeTag::Oracle),
            (map.knowledge_code_hash, CellTypeTag::Knowledge),
            (map.config_code_hash, CellTypeTag::Config),
        ];
        for (hash, expected) in tags {
            assert_eq!(classify_cell(&hash, &map), expected);
        }
        assert_eq!(classify_cell(&[0xFF; 32], &map), CellTypeTag::Unknown);
    }
}
