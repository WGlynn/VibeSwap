// ============ Cache Module ============
// Protocol Data Caching — in-memory caching for frequently accessed data
// (pool reserves, oracle prices, user balances) with TTL expiry, LRU eviction,
// and cache invalidation. Reduces on-chain cell reads.

// ============ Error Types ============

#[derive(Debug, Clone, PartialEq)]
pub enum CacheError {
    KeyNotFound,
    CacheFull,
    Expired,
    InvalidKey,
    InvalidTtl,
    DirtyWriteConflict,
    VersionMismatch,
    EmptyCache,
}

// ============ Data Types ============

#[derive(Debug, Clone, PartialEq)]
pub enum EvictionPolicy {
    Lru,
    Lfu,
    Fifo,
    Ttl,
}

#[derive(Debug, Clone)]
pub struct CacheEntry {
    pub key: [u8; 32],
    pub value: u64,
    pub secondary_value: u64,
    pub created_at: u64,
    pub last_accessed: u64,
    pub access_count: u64,
    pub ttl_ms: u64,
    pub dirty: bool,
    pub version: u32,
}

#[derive(Debug, Clone)]
pub struct Cache {
    pub entries: Vec<CacheEntry>,
    pub max_entries: usize,
    pub policy: EvictionPolicy,
    pub default_ttl_ms: u64,
    pub hits: u64,
    pub misses: u64,
    pub evictions: u64,
    pub invalidations: u64,
}

#[derive(Debug, Clone)]
pub struct CacheStats {
    pub total_entries: u64,
    pub capacity: u64,
    pub hit_rate_bps: u64,
    pub avg_ttl_remaining_ms: u64,
    pub dirty_count: u64,
    pub evictions: u64,
    pub invalidations: u64,
    pub avg_access_count: u64,
    pub memory_estimate: u64,
    pub oldest_entry_age_ms: u64,
}

// ============ Constants ============

/// Default maximum number of cache entries
const DEFAULT_MAX_ENTRIES: usize = 1000;

/// Default TTL in milliseconds (60 seconds)
const DEFAULT_TTL_MS: u64 = 60_000;

/// Estimated memory per entry in bytes
const BYTES_PER_ENTRY: u64 = 160;

// ============ Cache Creation ============

/// Create a new cache with the given capacity, eviction policy, and default TTL.
pub fn create_cache(max_entries: usize, policy: EvictionPolicy, default_ttl: u64) -> Cache {
    Cache {
        entries: Vec::new(),
        max_entries,
        policy,
        default_ttl_ms: default_ttl,
        hits: 0,
        misses: 0,
        evictions: 0,
        invalidations: 0,
    }
}

/// Create a default cache: 1000 entries, LRU policy, 60s TTL.
pub fn default_cache() -> Cache {
    create_cache(DEFAULT_MAX_ENTRIES, EvictionPolicy::Lru, DEFAULT_TTL_MS)
}

// ============ Core Operations ============

/// Get the value pair for a key, updating access stats. Returns None if expired or missing.
pub fn get(cache: &mut Cache, key: &[u8; 32], now: u64) -> Option<(u64, u64)> {
    let idx = find_index(cache, key);
    match idx {
        None => {
            cache.misses += 1;
            None
        }
        Some(i) => {
            if is_expired(&cache.entries[i], now) {
                cache.misses += 1;
                // Remove expired entry
                cache.entries.remove(i);
                None
            } else {
                cache.hits += 1;
                cache.entries[i].last_accessed = now;
                cache.entries[i].access_count += 1;
                let entry = &cache.entries[i];
                Some((entry.value, entry.secondary_value))
            }
        }
    }
}

/// Read-only get — no stat updates. Returns None if expired or missing.
pub fn get_if_fresh(cache: &Cache, key: &[u8; 32], now: u64) -> Option<(u64, u64)> {
    for entry in &cache.entries {
        if entry.key == *key {
            if is_expired(entry, now) {
                return None;
            }
            return Some((entry.value, entry.secondary_value));
        }
    }
    None
}

/// Insert or update a cache entry. Evicts if full.
pub fn put(cache: &mut Cache, key: [u8; 32], value: u64, secondary: u64, now: u64) -> Result<(), CacheError> {
    let ttl = cache.default_ttl_ms;
    put_with_ttl(cache, key, value, secondary, ttl, now)
}

/// Insert or update a cache entry with a specific TTL.
pub fn put_with_ttl(
    cache: &mut Cache,
    key: [u8; 32],
    value: u64,
    secondary: u64,
    ttl_ms: u64,
    now: u64,
) -> Result<(), CacheError> {
    // Check if key already exists — update in place
    if let Some(i) = find_index(cache, &key) {
        cache.entries[i].value = value;
        cache.entries[i].secondary_value = secondary;
        cache.entries[i].last_accessed = now;
        cache.entries[i].ttl_ms = ttl_ms;
        cache.entries[i].version += 1;
        cache.entries[i].created_at = now;
        return Ok(());
    }

    // If full, try to evict
    if cache.entries.len() >= cache.max_entries {
        let evicted = evict_one(cache, now);
        if evicted.is_none() {
            return Err(CacheError::CacheFull);
        }
    }

    let entry = CacheEntry {
        key,
        value,
        secondary_value: secondary,
        created_at: now,
        last_accessed: now,
        access_count: 0,
        ttl_ms,
        dirty: false,
        version: 1,
    };
    cache.entries.push(entry);
    Ok(())
}

/// Remove an entry by key. Returns the removed entry if found.
pub fn remove(cache: &mut Cache, key: &[u8; 32]) -> Option<CacheEntry> {
    if let Some(i) = find_index(cache, key) {
        Some(cache.entries.remove(i))
    } else {
        None
    }
}

/// Check if a key is present and not expired.
pub fn contains(cache: &Cache, key: &[u8; 32], now: u64) -> bool {
    for entry in &cache.entries {
        if entry.key == *key {
            return !is_expired(entry, now);
        }
    }
    false
}

/// Update the value of an existing entry. Returns the new version number.
pub fn update_value(
    cache: &mut Cache,
    key: &[u8; 32],
    value: u64,
    secondary: u64,
    now: u64,
) -> Result<u32, CacheError> {
    if let Some(i) = find_index(cache, key) {
        if is_expired(&cache.entries[i], now) {
            cache.entries.remove(i);
            return Err(CacheError::Expired);
        }
        cache.entries[i].value = value;
        cache.entries[i].secondary_value = secondary;
        cache.entries[i].last_accessed = now;
        cache.entries[i].version += 1;
        Ok(cache.entries[i].version)
    } else {
        Err(CacheError::KeyNotFound)
    }
}

// ============ Eviction ============

/// Evict one entry according to the cache's eviction policy.
pub fn evict_one(cache: &mut Cache, now: u64) -> Option<CacheEntry> {
    if cache.entries.is_empty() {
        return None;
    }

    // First, try to evict any expired entry
    for i in 0..cache.entries.len() {
        if is_expired(&cache.entries[i], now) {
            cache.evictions += 1;
            return Some(cache.entries.remove(i));
        }
    }

    // Then evict based on policy
    let result = match cache.policy {
        EvictionPolicy::Lru => evict_lru(cache),
        EvictionPolicy::Lfu => evict_lfu(cache),
        EvictionPolicy::Fifo => evict_fifo(cache),
        EvictionPolicy::Ttl => evict_by_ttl_remaining(cache, now),
    };

    if result.is_some() {
        cache.evictions += 1;
    }
    result
}

/// Evict the least recently used entry.
pub fn evict_lru(cache: &mut Cache) -> Option<CacheEntry> {
    if cache.entries.is_empty() {
        return None;
    }
    let mut oldest_idx = 0;
    let mut oldest_access = cache.entries[0].last_accessed;
    for (i, entry) in cache.entries.iter().enumerate().skip(1) {
        if entry.last_accessed < oldest_access {
            oldest_access = entry.last_accessed;
            oldest_idx = i;
        }
    }
    Some(cache.entries.remove(oldest_idx))
}

/// Evict the least frequently used entry.
pub fn evict_lfu(cache: &mut Cache) -> Option<CacheEntry> {
    if cache.entries.is_empty() {
        return None;
    }
    let mut min_idx = 0;
    let mut min_count = cache.entries[0].access_count;
    for (i, entry) in cache.entries.iter().enumerate().skip(1) {
        if entry.access_count < min_count {
            min_count = entry.access_count;
            min_idx = i;
        }
    }
    Some(cache.entries.remove(min_idx))
}

/// Evict the oldest entry (FIFO — first in, first out).
pub fn evict_fifo(cache: &mut Cache) -> Option<CacheEntry> {
    if cache.entries.is_empty() {
        return None;
    }
    let mut oldest_idx = 0;
    let mut oldest_created = cache.entries[0].created_at;
    for (i, entry) in cache.entries.iter().enumerate().skip(1) {
        if entry.created_at < oldest_created {
            oldest_created = entry.created_at;
            oldest_idx = i;
        }
    }
    Some(cache.entries.remove(oldest_idx))
}

/// Evict all expired entries. Returns the count removed.
pub fn evict_expired(cache: &mut Cache, now: u64) -> usize {
    let before = cache.entries.len();
    cache.entries.retain(|e| !is_expired(e, now));
    let removed = before - cache.entries.len();
    cache.evictions += removed as u64;
    removed
}

/// Return the index of the next eviction candidate (without removing).
pub fn eviction_candidate(cache: &Cache, now: u64) -> Option<usize> {
    if cache.entries.is_empty() {
        return None;
    }

    // Prefer expired entries
    for (i, entry) in cache.entries.iter().enumerate() {
        if is_expired(entry, now) {
            return Some(i);
        }
    }

    // Then follow policy
    match cache.policy {
        EvictionPolicy::Lru => {
            let mut oldest_idx = 0;
            let mut oldest_access = cache.entries[0].last_accessed;
            for (i, entry) in cache.entries.iter().enumerate().skip(1) {
                if entry.last_accessed < oldest_access {
                    oldest_access = entry.last_accessed;
                    oldest_idx = i;
                }
            }
            Some(oldest_idx)
        }
        EvictionPolicy::Lfu => {
            let mut min_idx = 0;
            let mut min_count = cache.entries[0].access_count;
            for (i, entry) in cache.entries.iter().enumerate().skip(1) {
                if entry.access_count < min_count {
                    min_count = entry.access_count;
                    min_idx = i;
                }
            }
            Some(min_idx)
        }
        EvictionPolicy::Fifo => {
            let mut oldest_idx = 0;
            let mut oldest_created = cache.entries[0].created_at;
            for (i, entry) in cache.entries.iter().enumerate().skip(1) {
                if entry.created_at < oldest_created {
                    oldest_created = entry.created_at;
                    oldest_idx = i;
                }
            }
            Some(oldest_idx)
        }
        EvictionPolicy::Ttl => {
            let mut best_idx = 0;
            let mut best_remaining = ttl_remaining(&cache.entries[0], now);
            for (i, entry) in cache.entries.iter().enumerate().skip(1) {
                let rem = ttl_remaining(entry, now);
                if rem < best_remaining {
                    best_remaining = rem;
                    best_idx = i;
                }
            }
            Some(best_idx)
        }
    }
}

// ============ TTL Management ============

/// Check if a cache entry has expired.
pub fn is_expired(entry: &CacheEntry, now: u64) -> bool {
    if entry.ttl_ms == 0 {
        return false;
    }
    now > entry.created_at.saturating_add(entry.ttl_ms)
}

/// Return remaining TTL in ms. 0 if expired or no TTL set.
pub fn time_to_live(entry: &CacheEntry, now: u64) -> u64 {
    if entry.ttl_ms == 0 {
        return 0;
    }
    let expiry = entry.created_at.saturating_add(entry.ttl_ms);
    if now >= expiry {
        0
    } else {
        expiry - now
    }
}

/// Refresh an entry's TTL — reset created_at to now so TTL restarts.
pub fn refresh_ttl(cache: &mut Cache, key: &[u8; 32], now: u64) -> Result<(), CacheError> {
    if let Some(i) = find_index(cache, key) {
        cache.entries[i].created_at = now;
        Ok(())
    } else {
        Err(CacheError::KeyNotFound)
    }
}

/// Extend an entry's TTL by the given number of milliseconds.
pub fn extend_ttl(cache: &mut Cache, key: &[u8; 32], extra_ms: u64) -> Result<(), CacheError> {
    if let Some(i) = find_index(cache, key) {
        cache.entries[i].ttl_ms = cache.entries[i].ttl_ms.saturating_add(extra_ms);
        Ok(())
    } else {
        Err(CacheError::KeyNotFound)
    }
}

/// Set a specific TTL for an entry.
pub fn set_ttl(cache: &mut Cache, key: &[u8; 32], ttl_ms: u64) -> Result<(), CacheError> {
    if let Some(i) = find_index(cache, key) {
        cache.entries[i].ttl_ms = ttl_ms;
        Ok(())
    } else {
        Err(CacheError::KeyNotFound)
    }
}

// ============ Invalidation ============

/// Remove an entry by key. Returns true if an entry was removed.
pub fn invalidate(cache: &mut Cache, key: &[u8; 32]) -> bool {
    if let Some(i) = find_index(cache, key) {
        cache.entries.remove(i);
        cache.invalidations += 1;
        true
    } else {
        false
    }
}

/// Remove all entries. Returns the count removed.
pub fn invalidate_all(cache: &mut Cache) -> usize {
    let count = cache.entries.len();
    cache.entries.clear();
    cache.invalidations += count as u64;
    count
}

/// Remove entries whose key starts with the given prefix. Returns count removed.
pub fn invalidate_by_prefix(cache: &mut Cache, prefix: &[u8]) -> usize {
    let before = cache.entries.len();
    cache.entries.retain(|e| !e.key.starts_with(prefix));
    let removed = before - cache.entries.len();
    cache.invalidations += removed as u64;
    removed
}

/// Remove entries older than the given age. Returns count removed.
pub fn invalidate_older_than(cache: &mut Cache, age_ms: u64, now: u64) -> usize {
    let before = cache.entries.len();
    cache.entries.retain(|e| {
        let age = now.saturating_sub(e.created_at);
        age <= age_ms
    });
    let removed = before - cache.entries.len();
    cache.invalidations += removed as u64;
    removed
}

/// Remove all dirty entries. Returns count removed.
pub fn invalidate_dirty(cache: &mut Cache) -> usize {
    let before = cache.entries.len();
    cache.entries.retain(|e| !e.dirty);
    let removed = before - cache.entries.len();
    cache.invalidations += removed as u64;
    removed
}

// ============ Dirty Tracking ============

/// Mark an entry as dirty (modified but not written back).
pub fn mark_dirty(cache: &mut Cache, key: &[u8; 32]) -> Result<(), CacheError> {
    if let Some(i) = find_index(cache, key) {
        cache.entries[i].dirty = true;
        Ok(())
    } else {
        Err(CacheError::KeyNotFound)
    }
}

/// Mark an entry as clean.
pub fn mark_clean(cache: &mut Cache, key: &[u8; 32]) -> Result<(), CacheError> {
    if let Some(i) = find_index(cache, key) {
        cache.entries[i].dirty = false;
        Ok(())
    } else {
        Err(CacheError::KeyNotFound)
    }
}

/// Return references to all dirty entries.
pub fn dirty_entries(cache: &Cache) -> Vec<&CacheEntry> {
    cache.entries.iter().filter(|e| e.dirty).collect()
}

/// Return the number of dirty entries.
pub fn dirty_count(cache: &Cache) -> usize {
    cache.entries.iter().filter(|e| e.dirty).count()
}

/// Extract all dirty entries, marking them clean. Returns the dirty entries.
pub fn flush_dirty(cache: &mut Cache) -> Vec<CacheEntry> {
    let mut flushed = Vec::new();
    for entry in &mut cache.entries {
        if entry.dirty {
            flushed.push(entry.clone());
            entry.dirty = false;
        }
    }
    flushed
}

// ============ Batch Operations ============

/// Get multiple values by key. Returns a Vec of Option results in the same order.
pub fn multi_get(cache: &mut Cache, keys: &[[u8; 32]], now: u64) -> Vec<Option<(u64, u64)>> {
    keys.iter().map(|k| get(cache, k, now)).collect()
}

/// Put multiple entries. Returns the count of successfully inserted entries.
pub fn multi_put(
    cache: &mut Cache,
    entries: &[([u8; 32], u64, u64)],
    now: u64,
) -> Result<usize, CacheError> {
    let mut count = 0;
    for &(key, val, sec) in entries {
        put(cache, key, val, sec, now)?;
        count += 1;
    }
    Ok(count)
}

/// Bulk load entries, skipping keys that already exist. Returns count of new entries added.
pub fn warm_cache(
    cache: &mut Cache,
    entries: &[([u8; 32], u64, u64)],
    now: u64,
) -> usize {
    let mut count = 0;
    for &(key, val, sec) in entries {
        if find_index(cache, &key).is_none() {
            if put(cache, key, val, sec, now).is_ok() {
                count += 1;
            }
        }
    }
    count
}

// ============ Analytics ============

/// Compute comprehensive cache statistics.
pub fn compute_stats(cache: &Cache, now: u64) -> CacheStats {
    let total = cache.entries.len() as u64;
    let total_lookups = cache.hits + cache.misses;
    let hit_rate = if total_lookups > 0 {
        (cache.hits as u128 * 10_000 / total_lookups as u128) as u64
    } else {
        0
    };

    let avg_ttl_remaining = if total > 0 {
        let sum: u64 = cache.entries.iter().map(|e| time_to_live(e, now)).sum();
        sum / total
    } else {
        0
    };

    let dc = dirty_count(cache) as u64;

    let avg_ac = if total > 0 {
        let sum: u64 = cache.entries.iter().map(|e| e.access_count).sum();
        sum / total
    } else {
        0
    };

    let oldest_age = if total > 0 {
        cache.entries.iter().map(|e| now.saturating_sub(e.created_at)).max().unwrap_or(0)
    } else {
        0
    };

    CacheStats {
        total_entries: total,
        capacity: cache.max_entries as u64,
        hit_rate_bps: hit_rate,
        avg_ttl_remaining_ms: avg_ttl_remaining,
        dirty_count: dc,
        evictions: cache.evictions,
        invalidations: cache.invalidations,
        avg_access_count: avg_ac,
        memory_estimate: total * BYTES_PER_ENTRY,
        oldest_entry_age_ms: oldest_age,
    }
}

/// Hit rate in basis points (hits / total lookups * 10000).
pub fn hit_rate_bps(cache: &Cache) -> u64 {
    let total = cache.hits + cache.misses;
    if total == 0 {
        return 0;
    }
    (cache.hits as u128 * 10_000 / total as u128) as u64
}

/// Cache utilization in basis points (entries / max * 10000).
pub fn utilization_bps(cache: &Cache) -> u64 {
    if cache.max_entries == 0 {
        return 0;
    }
    (cache.entries.len() as u128 * 10_000 / cache.max_entries as u128) as u64
}

/// Average access count across all entries.
pub fn avg_access_count(cache: &Cache) -> u64 {
    if cache.entries.is_empty() {
        return 0;
    }
    let sum: u64 = cache.entries.iter().map(|e| e.access_count).sum();
    sum / cache.entries.len() as u64
}

/// Return the most-accessed entries (hot entries), up to `count`.
pub fn most_accessed(cache: &Cache, count: usize) -> Vec<&CacheEntry> {
    let mut indices: Vec<usize> = (0..cache.entries.len()).collect();
    indices.sort_by(|&a, &b| cache.entries[b].access_count.cmp(&cache.entries[a].access_count));
    indices.iter().take(count).map(|&i| &cache.entries[i]).collect()
}

/// Return the least-accessed entries (cold entries), up to `count`.
pub fn least_accessed(cache: &Cache, count: usize) -> Vec<&CacheEntry> {
    let mut indices: Vec<usize> = (0..cache.entries.len()).collect();
    indices.sort_by(|&a, &b| cache.entries[a].access_count.cmp(&cache.entries[b].access_count));
    indices.iter().take(count).map(|&i| &cache.entries[i]).collect()
}

/// Estimated memory usage in bytes (~160 bytes per entry).
pub fn memory_estimate(cache: &Cache) -> u64 {
    cache.entries.len() as u64 * BYTES_PER_ENTRY
}

// ============ Version Control ============

/// Get the version of an entry by key.
pub fn get_version(cache: &Cache, key: &[u8; 32]) -> Option<u32> {
    for entry in &cache.entries {
        if entry.key == *key {
            return Some(entry.version);
        }
    }
    None
}

/// Compare-and-swap: update only if the current version matches `expected_version`.
/// Returns the new version on success.
pub fn compare_and_swap(
    cache: &mut Cache,
    key: &[u8; 32],
    expected_version: u32,
    new_value: u64,
    new_secondary: u64,
    now: u64,
) -> Result<u32, CacheError> {
    if let Some(i) = find_index(cache, key) {
        if is_expired(&cache.entries[i], now) {
            cache.entries.remove(i);
            return Err(CacheError::Expired);
        }
        if cache.entries[i].version != expected_version {
            return Err(CacheError::VersionMismatch);
        }
        cache.entries[i].value = new_value;
        cache.entries[i].secondary_value = new_secondary;
        cache.entries[i].last_accessed = now;
        cache.entries[i].version += 1;
        Ok(cache.entries[i].version)
    } else {
        Err(CacheError::KeyNotFound)
    }
}

// ============ Utility ============

/// Return the number of entries in the cache.
pub fn entry_count(cache: &Cache) -> usize {
    cache.entries.len()
}

/// Check if the cache is at capacity.
pub fn is_full(cache: &Cache) -> bool {
    cache.entries.len() >= cache.max_entries
}

// ============ Internal Helpers ============

/// Find the index of an entry by key.
fn find_index(cache: &Cache, key: &[u8; 32]) -> Option<usize> {
    cache.entries.iter().position(|e| e.key == *key)
}

/// Remaining TTL for an entry (internal helper for TTL-based eviction).
fn ttl_remaining(entry: &CacheEntry, now: u64) -> u64 {
    if entry.ttl_ms == 0 {
        return u64::MAX; // Never expires — least evictable
    }
    let expiry = entry.created_at.saturating_add(entry.ttl_ms);
    if now >= expiry {
        0
    } else {
        expiry - now
    }
}

/// Evict the entry with the least remaining TTL (for TTL policy).
fn evict_by_ttl_remaining(cache: &mut Cache, now: u64) -> Option<CacheEntry> {
    if cache.entries.is_empty() {
        return None;
    }
    let mut best_idx = 0;
    let mut best_remaining = ttl_remaining(&cache.entries[0], now);
    for (i, entry) in cache.entries.iter().enumerate().skip(1) {
        let rem = ttl_remaining(entry, now);
        if rem < best_remaining {
            best_remaining = rem;
            best_idx = i;
        }
    }
    Some(cache.entries.remove(best_idx))
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // Helper to create a key from a single byte
    fn key(b: u8) -> [u8; 32] {
        let mut k = [0u8; 32];
        k[0] = b;
        k
    }

    // Helper to create a key with a specific prefix
    fn key_prefix(prefix: &[u8], suffix: u8) -> [u8; 32] {
        let mut k = [0u8; 32];
        for (i, &b) in prefix.iter().enumerate() {
            if i < 32 {
                k[i] = b;
            }
        }
        if prefix.len() < 32 {
            k[prefix.len()] = suffix;
        }
        k
    }

    // ============ Cache Creation Tests ============

    #[test]
    fn test_create_cache_basic() {
        let c = create_cache(100, EvictionPolicy::Lru, 5000);
        assert_eq!(c.max_entries, 100);
        assert_eq!(c.policy, EvictionPolicy::Lru);
        assert_eq!(c.default_ttl_ms, 5000);
        assert_eq!(c.hits, 0);
        assert_eq!(c.misses, 0);
        assert_eq!(c.evictions, 0);
        assert_eq!(c.invalidations, 0);
        assert!(c.entries.is_empty());
    }

    #[test]
    fn test_create_cache_lfu_policy() {
        let c = create_cache(50, EvictionPolicy::Lfu, 1000);
        assert_eq!(c.policy, EvictionPolicy::Lfu);
        assert_eq!(c.max_entries, 50);
    }

    #[test]
    fn test_create_cache_fifo_policy() {
        let c = create_cache(200, EvictionPolicy::Fifo, 30_000);
        assert_eq!(c.policy, EvictionPolicy::Fifo);
    }

    #[test]
    fn test_create_cache_ttl_policy() {
        let c = create_cache(10, EvictionPolicy::Ttl, 10_000);
        assert_eq!(c.policy, EvictionPolicy::Ttl);
    }

    #[test]
    fn test_create_cache_zero_ttl() {
        let c = create_cache(10, EvictionPolicy::Lru, 0);
        assert_eq!(c.default_ttl_ms, 0);
    }

    #[test]
    fn test_default_cache() {
        let c = default_cache();
        assert_eq!(c.max_entries, 1000);
        assert_eq!(c.policy, EvictionPolicy::Lru);
        assert_eq!(c.default_ttl_ms, 60_000);
        assert!(c.entries.is_empty());
    }

    // ============ Core Operation Tests — put & get ============

    #[test]
    fn test_put_and_get_basic() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 100, 200, 1000).unwrap();
        let v = get(&mut c, &key(1), 1500);
        assert_eq!(v, Some((100, 200)));
    }

    #[test]
    fn test_put_updates_existing() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 100, 200, 1000).unwrap();
        put(&mut c, key(1), 300, 400, 2000).unwrap();
        assert_eq!(entry_count(&c), 1);
        let v = get(&mut c, &key(1), 2500);
        assert_eq!(v, Some((300, 400)));
    }

    #[test]
    fn test_put_version_increments_on_update() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 100, 200, 1000).unwrap();
        assert_eq!(get_version(&c, &key(1)), Some(1));
        put(&mut c, key(1), 300, 400, 2000).unwrap();
        assert_eq!(get_version(&c, &key(1)), Some(2));
    }

    #[test]
    fn test_get_miss_increments_misses() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        let v = get(&mut c, &key(99), 1000);
        assert_eq!(v, None);
        assert_eq!(c.misses, 1);
        assert_eq!(c.hits, 0);
    }

    #[test]
    fn test_get_hit_increments_hits() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 100, 200, 1000).unwrap();
        let _ = get(&mut c, &key(1), 1500);
        assert_eq!(c.hits, 1);
        assert_eq!(c.misses, 0);
    }

    #[test]
    fn test_get_updates_last_accessed() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 100, 200, 1000).unwrap();
        let _ = get(&mut c, &key(1), 5000);
        assert_eq!(c.entries[0].last_accessed, 5000);
    }

    #[test]
    fn test_get_updates_access_count() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 100, 200, 1000).unwrap();
        let _ = get(&mut c, &key(1), 1500);
        let _ = get(&mut c, &key(1), 2000);
        let _ = get(&mut c, &key(1), 2500);
        assert_eq!(c.entries[0].access_count, 3);
    }

    #[test]
    fn test_get_expired_returns_none() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 1000);
        put(&mut c, key(1), 100, 200, 1000).unwrap();
        // TTL=1000, created_at=1000, expires at 2000
        let v = get(&mut c, &key(1), 3000);
        assert_eq!(v, None);
        assert_eq!(c.misses, 1);
    }

    #[test]
    fn test_get_expired_removes_entry() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 1000);
        put(&mut c, key(1), 100, 200, 1000).unwrap();
        let _ = get(&mut c, &key(1), 3000);
        assert_eq!(entry_count(&c), 0);
    }

    #[test]
    fn test_put_with_ttl() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put_with_ttl(&mut c, key(1), 100, 200, 500, 1000).unwrap();
        // Still alive at 1400
        assert_eq!(get(&mut c, &key(1), 1400), Some((100, 200)));
        // Expired at 1600
        assert_eq!(get(&mut c, &key(1), 1600), None);
    }

    #[test]
    fn test_put_with_zero_ttl_never_expires() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put_with_ttl(&mut c, key(1), 100, 200, 0, 1000).unwrap();
        assert_eq!(get(&mut c, &key(1), u64::MAX - 1), Some((100, 200)));
    }

    #[test]
    fn test_put_evicts_when_full() {
        let mut c = create_cache(2, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 10, 20, 1000).unwrap();
        put(&mut c, key(2), 30, 40, 2000).unwrap();
        // Cache is full; putting a third should evict one
        put(&mut c, key(3), 50, 60, 3000).unwrap();
        assert_eq!(entry_count(&c), 2);
        // key(1) was LRU — should have been evicted
        assert!(!contains(&c, &key(1), 3000));
        assert!(contains(&c, &key(3), 3000));
    }

    // ============ get_if_fresh Tests ============

    #[test]
    fn test_get_if_fresh_basic() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 100, 200, 1000).unwrap();
        let v = get_if_fresh(&c, &key(1), 1500);
        assert_eq!(v, Some((100, 200)));
    }

    #[test]
    fn test_get_if_fresh_no_stat_update() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 100, 200, 1000).unwrap();
        let _ = get_if_fresh(&c, &key(1), 1500);
        assert_eq!(c.hits, 0);
        assert_eq!(c.misses, 0);
        assert_eq!(c.entries[0].access_count, 0);
    }

    #[test]
    fn test_get_if_fresh_expired() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 1000);
        put(&mut c, key(1), 100, 200, 1000).unwrap();
        assert_eq!(get_if_fresh(&c, &key(1), 3000), None);
    }

    #[test]
    fn test_get_if_fresh_missing() {
        let c = create_cache(10, EvictionPolicy::Lru, 10_000);
        assert_eq!(get_if_fresh(&c, &key(99), 1000), None);
    }

    // ============ remove Tests ============

    #[test]
    fn test_remove_existing() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 100, 200, 1000).unwrap();
        let removed = remove(&mut c, &key(1));
        assert!(removed.is_some());
        assert_eq!(removed.unwrap().value, 100);
        assert_eq!(entry_count(&c), 0);
    }

    #[test]
    fn test_remove_missing() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        let removed = remove(&mut c, &key(99));
        assert!(removed.is_none());
    }

    // ============ contains Tests ============

    #[test]
    fn test_contains_present() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 100, 200, 1000).unwrap();
        assert!(contains(&c, &key(1), 1500));
    }

    #[test]
    fn test_contains_expired() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 1000);
        put(&mut c, key(1), 100, 200, 1000).unwrap();
        assert!(!contains(&c, &key(1), 3000));
    }

    #[test]
    fn test_contains_missing() {
        let c = create_cache(10, EvictionPolicy::Lru, 10_000);
        assert!(!contains(&c, &key(99), 1000));
    }

    // ============ update_value Tests ============

    #[test]
    fn test_update_value_basic() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 100, 200, 1000).unwrap();
        let v = update_value(&mut c, &key(1), 300, 400, 2000).unwrap();
        assert_eq!(v, 2);
        assert_eq!(get(&mut c, &key(1), 2500), Some((300, 400)));
    }

    #[test]
    fn test_update_value_missing() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        let r = update_value(&mut c, &key(99), 100, 200, 1000);
        assert_eq!(r, Err(CacheError::KeyNotFound));
    }

    #[test]
    fn test_update_value_expired() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 1000);
        put(&mut c, key(1), 100, 200, 1000).unwrap();
        let r = update_value(&mut c, &key(1), 300, 400, 5000);
        assert_eq!(r, Err(CacheError::Expired));
        assert_eq!(entry_count(&c), 0);
    }

    #[test]
    fn test_update_value_updates_last_accessed() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 100, 200, 1000).unwrap();
        update_value(&mut c, &key(1), 300, 400, 5000).unwrap();
        assert_eq!(c.entries[0].last_accessed, 5000);
    }

    // ============ Eviction Tests ============

    #[test]
    fn test_evict_one_empty() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        assert!(evict_one(&mut c, 1000).is_none());
    }

    #[test]
    fn test_evict_one_prefers_expired() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 1000);
        put_with_ttl(&mut c, key(1), 10, 20, 5000, 1000).unwrap();
        put_with_ttl(&mut c, key(2), 30, 40, 100, 1000).unwrap(); // Expires at 1100
        // Access key(2) more recently so LRU wouldn't pick it
        let _ = get(&mut c, &key(2), 1050);
        let evicted = evict_one(&mut c, 2000);
        assert!(evicted.is_some());
        assert_eq!(evicted.unwrap().key, key(2));
    }

    #[test]
    fn test_evict_lru_basic() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 10, 20, 1000).unwrap();
        put(&mut c, key(2), 30, 40, 2000).unwrap();
        // Access key(1) more recently
        let _ = get(&mut c, &key(1), 5000);
        let evicted = evict_lru(&mut c);
        assert_eq!(evicted.unwrap().key, key(2));
    }

    #[test]
    fn test_evict_lru_empty() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        assert!(evict_lru(&mut c).is_none());
    }

    #[test]
    fn test_evict_lfu_basic() {
        let mut c = create_cache(10, EvictionPolicy::Lfu, 10_000);
        put(&mut c, key(1), 10, 20, 1000).unwrap();
        put(&mut c, key(2), 30, 40, 1000).unwrap();
        // Access key(1) 3 times
        let _ = get(&mut c, &key(1), 1100);
        let _ = get(&mut c, &key(1), 1200);
        let _ = get(&mut c, &key(1), 1300);
        // key(2) has 0 accesses — should be evicted
        let evicted = evict_lfu(&mut c);
        assert_eq!(evicted.unwrap().key, key(2));
    }

    #[test]
    fn test_evict_lfu_empty() {
        let mut c = create_cache(10, EvictionPolicy::Lfu, 10_000);
        assert!(evict_lfu(&mut c).is_none());
    }

    #[test]
    fn test_evict_fifo_basic() {
        let mut c = create_cache(10, EvictionPolicy::Fifo, 10_000);
        put(&mut c, key(1), 10, 20, 1000).unwrap();
        put(&mut c, key(2), 30, 40, 2000).unwrap();
        put(&mut c, key(3), 50, 60, 3000).unwrap();
        let evicted = evict_fifo(&mut c);
        assert_eq!(evicted.unwrap().key, key(1));
    }

    #[test]
    fn test_evict_fifo_empty() {
        let mut c = create_cache(10, EvictionPolicy::Fifo, 10_000);
        assert!(evict_fifo(&mut c).is_none());
    }

    #[test]
    fn test_evict_expired_basic() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 1000);
        put(&mut c, key(1), 10, 20, 1000).unwrap();
        put(&mut c, key(2), 30, 40, 1000).unwrap();
        put_with_ttl(&mut c, key(3), 50, 60, 5000, 1000).unwrap();
        // At now=3000, key(1) and key(2) expired (ttl=1000, created=1000)
        let removed = evict_expired(&mut c, 3000);
        assert_eq!(removed, 2);
        assert_eq!(entry_count(&c), 1);
        assert!(contains(&c, &key(3), 3000));
    }

    #[test]
    fn test_evict_expired_none_expired() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 10, 20, 1000).unwrap();
        let removed = evict_expired(&mut c, 1500);
        assert_eq!(removed, 0);
    }

    #[test]
    fn test_evict_expired_increments_counter() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 100);
        put(&mut c, key(1), 10, 20, 1000).unwrap();
        put(&mut c, key(2), 30, 40, 1000).unwrap();
        evict_expired(&mut c, 5000);
        assert_eq!(c.evictions, 2);
    }

    #[test]
    fn test_eviction_candidate_empty() {
        let c = create_cache(10, EvictionPolicy::Lru, 10_000);
        assert_eq!(eviction_candidate(&c, 1000), None);
    }

    #[test]
    fn test_eviction_candidate_prefers_expired() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put_with_ttl(&mut c, key(1), 10, 20, 10_000, 1000).unwrap();
        put_with_ttl(&mut c, key(2), 30, 40, 100, 1000).unwrap();
        let idx = eviction_candidate(&c, 2000);
        assert_eq!(idx, Some(1)); // key(2) expired
    }

    #[test]
    fn test_eviction_candidate_lru() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 10, 20, 1000).unwrap();
        put(&mut c, key(2), 30, 40, 2000).unwrap();
        let _ = get(&mut c, &key(1), 5000);
        // key(2) last_accessed=2000 < key(1) last_accessed=5000
        let idx = eviction_candidate(&c, 5500);
        assert_eq!(idx, Some(1));
    }

    #[test]
    fn test_eviction_candidate_lfu() {
        let mut c = create_cache(10, EvictionPolicy::Lfu, 10_000);
        put(&mut c, key(1), 10, 20, 1000).unwrap();
        put(&mut c, key(2), 30, 40, 1000).unwrap();
        let _ = get(&mut c, &key(1), 1100);
        let _ = get(&mut c, &key(1), 1200);
        // key(2) has 0 accesses
        let idx = eviction_candidate(&c, 1300);
        assert_eq!(idx, Some(1));
    }

    #[test]
    fn test_eviction_candidate_fifo() {
        let mut c = create_cache(10, EvictionPolicy::Fifo, 10_000);
        put(&mut c, key(1), 10, 20, 1000).unwrap();
        put(&mut c, key(2), 30, 40, 2000).unwrap();
        let idx = eviction_candidate(&c, 3000);
        assert_eq!(idx, Some(0)); // key(1) oldest
    }

    #[test]
    fn test_eviction_candidate_ttl_policy() {
        let mut c = create_cache(10, EvictionPolicy::Ttl, 10_000);
        put_with_ttl(&mut c, key(1), 10, 20, 5000, 1000).unwrap();
        put_with_ttl(&mut c, key(2), 30, 40, 500, 1000).unwrap();
        // key(2) has less remaining TTL
        let idx = eviction_candidate(&c, 1200);
        assert_eq!(idx, Some(1));
    }

    // ============ TTL Tests ============

    #[test]
    fn test_is_expired_not_expired() {
        let entry = CacheEntry {
            key: key(1), value: 100, secondary_value: 200,
            created_at: 1000, last_accessed: 1000, access_count: 0,
            ttl_ms: 5000, dirty: false, version: 1,
        };
        assert!(!is_expired(&entry, 2000));
    }

    #[test]
    fn test_is_expired_expired() {
        let entry = CacheEntry {
            key: key(1), value: 100, secondary_value: 200,
            created_at: 1000, last_accessed: 1000, access_count: 0,
            ttl_ms: 1000, dirty: false, version: 1,
        };
        assert!(is_expired(&entry, 3000));
    }

    #[test]
    fn test_is_expired_zero_ttl_never_expires() {
        let entry = CacheEntry {
            key: key(1), value: 100, secondary_value: 200,
            created_at: 1000, last_accessed: 1000, access_count: 0,
            ttl_ms: 0, dirty: false, version: 1,
        };
        assert!(!is_expired(&entry, u64::MAX - 1));
    }

    #[test]
    fn test_is_expired_boundary_not_expired() {
        let entry = CacheEntry {
            key: key(1), value: 100, secondary_value: 200,
            created_at: 1000, last_accessed: 1000, access_count: 0,
            ttl_ms: 2000, dirty: false, version: 1,
        };
        // Exactly at expiry boundary (created_at + ttl = 3000, now = 3000)
        assert!(!is_expired(&entry, 3000));
    }

    #[test]
    fn test_is_expired_boundary_just_expired() {
        let entry = CacheEntry {
            key: key(1), value: 100, secondary_value: 200,
            created_at: 1000, last_accessed: 1000, access_count: 0,
            ttl_ms: 2000, dirty: false, version: 1,
        };
        assert!(is_expired(&entry, 3001));
    }

    #[test]
    fn test_time_to_live_remaining() {
        let entry = CacheEntry {
            key: key(1), value: 100, secondary_value: 200,
            created_at: 1000, last_accessed: 1000, access_count: 0,
            ttl_ms: 5000, dirty: false, version: 1,
        };
        assert_eq!(time_to_live(&entry, 3000), 3000);
    }

    #[test]
    fn test_time_to_live_expired() {
        let entry = CacheEntry {
            key: key(1), value: 100, secondary_value: 200,
            created_at: 1000, last_accessed: 1000, access_count: 0,
            ttl_ms: 1000, dirty: false, version: 1,
        };
        assert_eq!(time_to_live(&entry, 5000), 0);
    }

    #[test]
    fn test_time_to_live_zero_ttl() {
        let entry = CacheEntry {
            key: key(1), value: 100, secondary_value: 200,
            created_at: 1000, last_accessed: 1000, access_count: 0,
            ttl_ms: 0, dirty: false, version: 1,
        };
        assert_eq!(time_to_live(&entry, 5000), 0);
    }

    #[test]
    fn test_refresh_ttl() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 1000);
        put(&mut c, key(1), 100, 200, 1000).unwrap();
        // Would expire at 2001, refresh at 1800
        refresh_ttl(&mut c, &key(1), 1800).unwrap();
        // Now created_at=1800, ttl=1000, expires at 2801
        assert!(contains(&c, &key(1), 2500));
    }

    #[test]
    fn test_refresh_ttl_missing() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 1000);
        assert_eq!(refresh_ttl(&mut c, &key(99), 1000), Err(CacheError::KeyNotFound));
    }

    #[test]
    fn test_extend_ttl() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 1000);
        put(&mut c, key(1), 100, 200, 1000).unwrap();
        extend_ttl(&mut c, &key(1), 5000).unwrap();
        // ttl is now 6000, created_at=1000, expires at 7001
        assert!(contains(&c, &key(1), 6000));
    }

    #[test]
    fn test_extend_ttl_missing() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 1000);
        assert_eq!(extend_ttl(&mut c, &key(99), 5000), Err(CacheError::KeyNotFound));
    }

    #[test]
    fn test_set_ttl() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 1000);
        put(&mut c, key(1), 100, 200, 1000).unwrap();
        set_ttl(&mut c, &key(1), 50_000).unwrap();
        assert_eq!(c.entries[0].ttl_ms, 50_000);
    }

    #[test]
    fn test_set_ttl_missing() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 1000);
        assert_eq!(set_ttl(&mut c, &key(99), 5000), Err(CacheError::KeyNotFound));
    }

    #[test]
    fn test_set_ttl_to_zero_makes_immortal() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 1000);
        put(&mut c, key(1), 100, 200, 1000).unwrap();
        set_ttl(&mut c, &key(1), 0).unwrap();
        assert!(contains(&c, &key(1), u64::MAX - 1));
    }

    // ============ Invalidation Tests ============

    #[test]
    fn test_invalidate_existing() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 100, 200, 1000).unwrap();
        assert!(invalidate(&mut c, &key(1)));
        assert_eq!(entry_count(&c), 0);
        assert_eq!(c.invalidations, 1);
    }

    #[test]
    fn test_invalidate_missing() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        assert!(!invalidate(&mut c, &key(99)));
        assert_eq!(c.invalidations, 0);
    }

    #[test]
    fn test_invalidate_all() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 10, 20, 1000).unwrap();
        put(&mut c, key(2), 30, 40, 1000).unwrap();
        put(&mut c, key(3), 50, 60, 1000).unwrap();
        let count = invalidate_all(&mut c);
        assert_eq!(count, 3);
        assert_eq!(entry_count(&c), 0);
        assert_eq!(c.invalidations, 3);
    }

    #[test]
    fn test_invalidate_all_empty() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        assert_eq!(invalidate_all(&mut c), 0);
    }

    #[test]
    fn test_invalidate_by_prefix() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key_prefix(b"pool", 1), 10, 20, 1000).unwrap();
        put(&mut c, key_prefix(b"pool", 2), 30, 40, 1000).unwrap();
        put(&mut c, key_prefix(b"user", 1), 50, 60, 1000).unwrap();
        let removed = invalidate_by_prefix(&mut c, b"pool");
        assert_eq!(removed, 2);
        assert_eq!(entry_count(&c), 1);
    }

    #[test]
    fn test_invalidate_by_prefix_no_match() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key_prefix(b"user", 1), 10, 20, 1000).unwrap();
        let removed = invalidate_by_prefix(&mut c, b"pool");
        assert_eq!(removed, 0);
    }

    #[test]
    fn test_invalidate_by_prefix_empty_prefix_matches_all() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 10, 20, 1000).unwrap();
        put(&mut c, key(2), 30, 40, 1000).unwrap();
        let removed = invalidate_by_prefix(&mut c, b"");
        assert_eq!(removed, 2);
    }

    #[test]
    fn test_invalidate_older_than() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 100_000);
        put(&mut c, key(1), 10, 20, 1000).unwrap();
        put(&mut c, key(2), 30, 40, 3000).unwrap();
        put(&mut c, key(3), 50, 60, 5000).unwrap();
        // Remove entries older than 3000ms at now=6000
        // key(1): age=5000 > 3000 => removed
        // key(2): age=3000 <= 3000 => kept
        // key(3): age=1000 <= 3000 => kept
        let removed = invalidate_older_than(&mut c, 3000, 6000);
        assert_eq!(removed, 1);
        assert_eq!(entry_count(&c), 2);
    }

    #[test]
    fn test_invalidate_older_than_none_old() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 100_000);
        put(&mut c, key(1), 10, 20, 5000).unwrap();
        let removed = invalidate_older_than(&mut c, 10_000, 6000);
        assert_eq!(removed, 0);
    }

    #[test]
    fn test_invalidate_dirty() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 10, 20, 1000).unwrap();
        put(&mut c, key(2), 30, 40, 1000).unwrap();
        put(&mut c, key(3), 50, 60, 1000).unwrap();
        mark_dirty(&mut c, &key(1)).unwrap();
        mark_dirty(&mut c, &key(3)).unwrap();
        let removed = invalidate_dirty(&mut c);
        assert_eq!(removed, 2);
        assert_eq!(entry_count(&c), 1);
        assert!(contains(&c, &key(2), 1500));
    }

    #[test]
    fn test_invalidate_dirty_none_dirty() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 10, 20, 1000).unwrap();
        let removed = invalidate_dirty(&mut c);
        assert_eq!(removed, 0);
    }

    // ============ Dirty Tracking Tests ============

    #[test]
    fn test_mark_dirty() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 100, 200, 1000).unwrap();
        assert!(!c.entries[0].dirty);
        mark_dirty(&mut c, &key(1)).unwrap();
        assert!(c.entries[0].dirty);
    }

    #[test]
    fn test_mark_dirty_missing() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        assert_eq!(mark_dirty(&mut c, &key(99)), Err(CacheError::KeyNotFound));
    }

    #[test]
    fn test_mark_clean() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 100, 200, 1000).unwrap();
        mark_dirty(&mut c, &key(1)).unwrap();
        mark_clean(&mut c, &key(1)).unwrap();
        assert!(!c.entries[0].dirty);
    }

    #[test]
    fn test_mark_clean_missing() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        assert_eq!(mark_clean(&mut c, &key(99)), Err(CacheError::KeyNotFound));
    }

    #[test]
    fn test_dirty_entries() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 10, 20, 1000).unwrap();
        put(&mut c, key(2), 30, 40, 1000).unwrap();
        put(&mut c, key(3), 50, 60, 1000).unwrap();
        mark_dirty(&mut c, &key(1)).unwrap();
        mark_dirty(&mut c, &key(3)).unwrap();
        let dirty = dirty_entries(&c);
        assert_eq!(dirty.len(), 2);
    }

    #[test]
    fn test_dirty_entries_none() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 10, 20, 1000).unwrap();
        assert_eq!(dirty_entries(&c).len(), 0);
    }

    #[test]
    fn test_dirty_count() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 10, 20, 1000).unwrap();
        put(&mut c, key(2), 30, 40, 1000).unwrap();
        mark_dirty(&mut c, &key(2)).unwrap();
        assert_eq!(dirty_count(&c), 1);
    }

    #[test]
    fn test_flush_dirty() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 10, 20, 1000).unwrap();
        put(&mut c, key(2), 30, 40, 1000).unwrap();
        put(&mut c, key(3), 50, 60, 1000).unwrap();
        mark_dirty(&mut c, &key(1)).unwrap();
        mark_dirty(&mut c, &key(3)).unwrap();
        let flushed = flush_dirty(&mut c);
        assert_eq!(flushed.len(), 2);
        assert_eq!(dirty_count(&c), 0);
        // Entries still exist but are clean
        assert_eq!(entry_count(&c), 3);
    }

    #[test]
    fn test_flush_dirty_returns_correct_entries() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 10, 20, 1000).unwrap();
        put(&mut c, key(2), 30, 40, 1000).unwrap();
        mark_dirty(&mut c, &key(1)).unwrap();
        let flushed = flush_dirty(&mut c);
        assert_eq!(flushed.len(), 1);
        assert_eq!(flushed[0].value, 10);
    }

    #[test]
    fn test_flush_dirty_empty() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 10, 20, 1000).unwrap();
        let flushed = flush_dirty(&mut c);
        assert_eq!(flushed.len(), 0);
    }

    // ============ Batch Operation Tests ============

    #[test]
    fn test_multi_get_basic() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 10, 20, 1000).unwrap();
        put(&mut c, key(2), 30, 40, 1000).unwrap();
        let keys = [key(1), key(2), key(3)];
        let results = multi_get(&mut c, &keys, 1500);
        assert_eq!(results.len(), 3);
        assert_eq!(results[0], Some((10, 20)));
        assert_eq!(results[1], Some((30, 40)));
        assert_eq!(results[2], None);
    }

    #[test]
    fn test_multi_get_empty_keys() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        let results = multi_get(&mut c, &[], 1000);
        assert!(results.is_empty());
    }

    #[test]
    fn test_multi_get_hit_miss_stats() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 10, 20, 1000).unwrap();
        let keys = [key(1), key(2)];
        let _ = multi_get(&mut c, &keys, 1500);
        assert_eq!(c.hits, 1);
        assert_eq!(c.misses, 1);
    }

    #[test]
    fn test_multi_put_basic() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        let entries = vec![(key(1), 10, 20), (key(2), 30, 40), (key(3), 50, 60)];
        let count = multi_put(&mut c, &entries, 1000).unwrap();
        assert_eq!(count, 3);
        assert_eq!(entry_count(&c), 3);
    }

    #[test]
    fn test_multi_put_partial_capacity() {
        // Cache capacity=2, try to put 3
        let mut c = create_cache(2, EvictionPolicy::Lru, 10_000);
        let entries = vec![(key(1), 10, 20), (key(2), 30, 40), (key(3), 50, 60)];
        // With LRU eviction, the third put will evict one, so all 3 succeed
        let count = multi_put(&mut c, &entries, 1000).unwrap();
        assert_eq!(count, 3);
        assert_eq!(entry_count(&c), 2); // Only 2 fit
    }

    #[test]
    fn test_warm_cache_basic() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        let entries = vec![(key(1), 10, 20), (key(2), 30, 40)];
        let added = warm_cache(&mut c, &entries, 1000);
        assert_eq!(added, 2);
    }

    #[test]
    fn test_warm_cache_skips_existing() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 100, 200, 1000).unwrap();
        let entries = vec![(key(1), 10, 20), (key(2), 30, 40)];
        let added = warm_cache(&mut c, &entries, 2000);
        assert_eq!(added, 1);
        // key(1) should still have its original value
        assert_eq!(get(&mut c, &key(1), 2500), Some((100, 200)));
    }

    #[test]
    fn test_warm_cache_empty() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        let added = warm_cache(&mut c, &[], 1000);
        assert_eq!(added, 0);
    }

    #[test]
    fn test_warm_cache_respects_capacity() {
        let mut c = create_cache(2, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 10, 20, 1000).unwrap();
        put(&mut c, key(2), 30, 40, 1000).unwrap();
        // Cache is full — warm_cache will evict to make room
        let entries = vec![(key(3), 50, 60)];
        let added = warm_cache(&mut c, &entries, 2000);
        assert_eq!(added, 1);
        assert_eq!(entry_count(&c), 2);
    }

    // ============ Analytics Tests ============

    #[test]
    fn test_compute_stats_empty() {
        let c = create_cache(10, EvictionPolicy::Lru, 10_000);
        let stats = compute_stats(&c, 1000);
        assert_eq!(stats.total_entries, 0);
        assert_eq!(stats.capacity, 10);
        assert_eq!(stats.hit_rate_bps, 0);
        assert_eq!(stats.dirty_count, 0);
        assert_eq!(stats.memory_estimate, 0);
    }

    #[test]
    fn test_compute_stats_with_entries() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 10, 20, 1000).unwrap();
        put(&mut c, key(2), 30, 40, 2000).unwrap();
        let _ = get(&mut c, &key(1), 3000);
        let _ = get(&mut c, &key(99), 3000); // miss
        mark_dirty(&mut c, &key(1)).unwrap();
        let stats = compute_stats(&c, 3000);
        assert_eq!(stats.total_entries, 2);
        assert_eq!(stats.capacity, 10);
        assert_eq!(stats.hit_rate_bps, 5000); // 1 hit / 2 total = 50%
        assert_eq!(stats.dirty_count, 1);
        assert_eq!(stats.memory_estimate, 2 * BYTES_PER_ENTRY);
    }

    #[test]
    fn test_compute_stats_oldest_entry_age() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 100_000);
        put(&mut c, key(1), 10, 20, 1000).unwrap();
        put(&mut c, key(2), 30, 40, 3000).unwrap();
        let stats = compute_stats(&c, 5000);
        assert_eq!(stats.oldest_entry_age_ms, 4000); // 5000 - 1000
    }

    #[test]
    fn test_hit_rate_bps_zero_lookups() {
        let c = create_cache(10, EvictionPolicy::Lru, 10_000);
        assert_eq!(hit_rate_bps(&c), 0);
    }

    #[test]
    fn test_hit_rate_bps_all_hits() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 10, 20, 1000).unwrap();
        let _ = get(&mut c, &key(1), 1500);
        let _ = get(&mut c, &key(1), 2000);
        assert_eq!(hit_rate_bps(&c), 10_000);
    }

    #[test]
    fn test_hit_rate_bps_all_misses() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        let _ = get(&mut c, &key(99), 1000);
        assert_eq!(hit_rate_bps(&c), 0);
    }

    #[test]
    fn test_hit_rate_bps_mixed() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 10, 20, 1000).unwrap();
        let _ = get(&mut c, &key(1), 1500); // hit
        let _ = get(&mut c, &key(1), 2000); // hit
        let _ = get(&mut c, &key(1), 2500); // hit
        let _ = get(&mut c, &key(99), 3000); // miss
        // 3 hits / 4 total = 75% = 7500 bps
        assert_eq!(hit_rate_bps(&c), 7500);
    }

    #[test]
    fn test_utilization_bps_empty() {
        let c = create_cache(10, EvictionPolicy::Lru, 10_000);
        assert_eq!(utilization_bps(&c), 0);
    }

    #[test]
    fn test_utilization_bps_half() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        for i in 0..5 {
            put(&mut c, key(i), i as u64 * 10, 0, 1000).unwrap();
        }
        assert_eq!(utilization_bps(&c), 5000);
    }

    #[test]
    fn test_utilization_bps_full() {
        let mut c = create_cache(3, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 10, 20, 1000).unwrap();
        put(&mut c, key(2), 30, 40, 1000).unwrap();
        put(&mut c, key(3), 50, 60, 1000).unwrap();
        assert_eq!(utilization_bps(&c), 10_000);
    }

    #[test]
    fn test_utilization_bps_zero_capacity() {
        let c = create_cache(0, EvictionPolicy::Lru, 10_000);
        assert_eq!(utilization_bps(&c), 0);
    }

    #[test]
    fn test_avg_access_count_empty() {
        let c = create_cache(10, EvictionPolicy::Lru, 10_000);
        assert_eq!(avg_access_count(&c), 0);
    }

    #[test]
    fn test_avg_access_count_basic() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 10, 20, 1000).unwrap();
        put(&mut c, key(2), 30, 40, 1000).unwrap();
        let _ = get(&mut c, &key(1), 1100);
        let _ = get(&mut c, &key(1), 1200);
        let _ = get(&mut c, &key(1), 1300);
        let _ = get(&mut c, &key(2), 1400);
        // key(1) = 3 accesses, key(2) = 1 access, avg = 2
        assert_eq!(avg_access_count(&c), 2);
    }

    #[test]
    fn test_most_accessed_basic() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 10, 20, 1000).unwrap();
        put(&mut c, key(2), 30, 40, 1000).unwrap();
        put(&mut c, key(3), 50, 60, 1000).unwrap();
        // Access key(3) 5 times, key(1) 2 times, key(2) 0 times
        for t in 0..5 { let _ = get(&mut c, &key(3), 1100 + t); }
        for t in 0..2 { let _ = get(&mut c, &key(1), 1200 + t); }
        let hot = most_accessed(&c, 2);
        assert_eq!(hot.len(), 2);
        assert_eq!(hot[0].key, key(3));
        assert_eq!(hot[1].key, key(1));
    }

    #[test]
    fn test_most_accessed_more_than_entries() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 10, 20, 1000).unwrap();
        let hot = most_accessed(&c, 5);
        assert_eq!(hot.len(), 1);
    }

    #[test]
    fn test_least_accessed_basic() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 10, 20, 1000).unwrap();
        put(&mut c, key(2), 30, 40, 1000).unwrap();
        put(&mut c, key(3), 50, 60, 1000).unwrap();
        for t in 0..5 { let _ = get(&mut c, &key(3), 1100 + t); }
        for t in 0..2 { let _ = get(&mut c, &key(1), 1200 + t); }
        let cold = least_accessed(&c, 2);
        assert_eq!(cold.len(), 2);
        assert_eq!(cold[0].key, key(2)); // 0 accesses
        assert_eq!(cold[1].key, key(1)); // 2 accesses
    }

    #[test]
    fn test_least_accessed_more_than_entries() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 10, 20, 1000).unwrap();
        let cold = least_accessed(&c, 5);
        assert_eq!(cold.len(), 1);
    }

    #[test]
    fn test_memory_estimate_empty() {
        let c = create_cache(10, EvictionPolicy::Lru, 10_000);
        assert_eq!(memory_estimate(&c), 0);
    }

    #[test]
    fn test_memory_estimate_with_entries() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 10, 20, 1000).unwrap();
        put(&mut c, key(2), 30, 40, 1000).unwrap();
        assert_eq!(memory_estimate(&c), 2 * BYTES_PER_ENTRY);
    }

    // ============ Version Control Tests ============

    #[test]
    fn test_get_version_exists() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 100, 200, 1000).unwrap();
        assert_eq!(get_version(&c, &key(1)), Some(1));
    }

    #[test]
    fn test_get_version_missing() {
        let c = create_cache(10, EvictionPolicy::Lru, 10_000);
        assert_eq!(get_version(&c, &key(99)), None);
    }

    #[test]
    fn test_get_version_after_update() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 100, 200, 1000).unwrap();
        update_value(&mut c, &key(1), 300, 400, 2000).unwrap();
        assert_eq!(get_version(&c, &key(1)), Some(2));
    }

    #[test]
    fn test_compare_and_swap_success() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 100, 200, 1000).unwrap();
        let new_v = compare_and_swap(&mut c, &key(1), 1, 300, 400, 2000).unwrap();
        assert_eq!(new_v, 2);
        assert_eq!(get(&mut c, &key(1), 2500), Some((300, 400)));
    }

    #[test]
    fn test_compare_and_swap_version_mismatch() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 100, 200, 1000).unwrap();
        let r = compare_and_swap(&mut c, &key(1), 99, 300, 400, 2000);
        assert_eq!(r, Err(CacheError::VersionMismatch));
        // Value unchanged
        assert_eq!(get(&mut c, &key(1), 2500), Some((100, 200)));
    }

    #[test]
    fn test_compare_and_swap_missing() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        let r = compare_and_swap(&mut c, &key(99), 1, 300, 400, 2000);
        assert_eq!(r, Err(CacheError::KeyNotFound));
    }

    #[test]
    fn test_compare_and_swap_expired() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 1000);
        put(&mut c, key(1), 100, 200, 1000).unwrap();
        let r = compare_and_swap(&mut c, &key(1), 1, 300, 400, 5000);
        assert_eq!(r, Err(CacheError::Expired));
    }

    #[test]
    fn test_compare_and_swap_sequential() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 100_000);
        put(&mut c, key(1), 100, 200, 1000).unwrap();
        let v2 = compare_and_swap(&mut c, &key(1), 1, 300, 400, 2000).unwrap();
        assert_eq!(v2, 2);
        let v3 = compare_and_swap(&mut c, &key(1), 2, 500, 600, 3000).unwrap();
        assert_eq!(v3, 3);
        assert_eq!(get(&mut c, &key(1), 3500), Some((500, 600)));
    }

    #[test]
    fn test_compare_and_swap_updates_last_accessed() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 100_000);
        put(&mut c, key(1), 100, 200, 1000).unwrap();
        compare_and_swap(&mut c, &key(1), 1, 300, 400, 7777).unwrap();
        assert_eq!(c.entries[0].last_accessed, 7777);
    }

    // ============ Utility Tests ============

    #[test]
    fn test_entry_count_empty() {
        let c = create_cache(10, EvictionPolicy::Lru, 10_000);
        assert_eq!(entry_count(&c), 0);
    }

    #[test]
    fn test_entry_count_after_puts() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 10, 20, 1000).unwrap();
        put(&mut c, key(2), 30, 40, 1000).unwrap();
        assert_eq!(entry_count(&c), 2);
    }

    #[test]
    fn test_is_full_empty() {
        let c = create_cache(10, EvictionPolicy::Lru, 10_000);
        assert!(!is_full(&c));
    }

    #[test]
    fn test_is_full_at_capacity() {
        let mut c = create_cache(2, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 10, 20, 1000).unwrap();
        put(&mut c, key(2), 30, 40, 1000).unwrap();
        assert!(is_full(&c));
    }

    #[test]
    fn test_is_full_below_capacity() {
        let mut c = create_cache(3, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 10, 20, 1000).unwrap();
        assert!(!is_full(&c));
    }

    // ============ Integration / Scenario Tests ============

    #[test]
    fn test_pool_reserve_caching_scenario() {
        // Simulates caching pool reserves (reserve_a in value, reserve_b in secondary)
        let mut c = create_cache(100, EvictionPolicy::Lru, 10_000);
        let pool_key = key_prefix(b"pool", 1);

        // Cache initial reserves
        put(&mut c, pool_key, 1_000_000, 2_000_000, 1000).unwrap();

        // Read reserves
        let (ra, rb) = get(&mut c, &pool_key, 1500).unwrap();
        assert_eq!(ra, 1_000_000);
        assert_eq!(rb, 2_000_000);

        // After a swap, update reserves
        update_value(&mut c, &pool_key, 1_100_000, 1_818_182, 2000).unwrap();
        mark_dirty(&mut c, &pool_key).unwrap();

        // Flush dirty to write back
        let dirty = flush_dirty(&mut c);
        assert_eq!(dirty.len(), 1);
        assert_eq!(dirty[0].value, 1_100_000);
    }

    #[test]
    fn test_oracle_price_caching_scenario() {
        // Short TTL for oracle prices (2 seconds)
        let mut c = create_cache(50, EvictionPolicy::Ttl, 2000);
        let price_key = key_prefix(b"oracle", 1);

        put(&mut c, price_key, 42_000_00, 0, 10_000).unwrap();
        assert_eq!(get(&mut c, &price_key, 11_000), Some((42_000_00, 0)));

        // Price expires after 2s
        assert_eq!(get(&mut c, &price_key, 13_000), None);
    }

    #[test]
    fn test_lru_eviction_order() {
        let mut c = create_cache(3, EvictionPolicy::Lru, 100_000);
        put(&mut c, key(1), 10, 0, 1000).unwrap();
        put(&mut c, key(2), 20, 0, 2000).unwrap();
        put(&mut c, key(3), 30, 0, 3000).unwrap();

        // Access key(1) to make it recently used
        let _ = get(&mut c, &key(1), 5000);

        // Insert key(4) — should evict key(2) (LRU, last_accessed=2000)
        put(&mut c, key(4), 40, 0, 6000).unwrap();
        assert!(!contains(&c, &key(2), 6000));
        assert!(contains(&c, &key(1), 6000));
        assert!(contains(&c, &key(3), 6000));
        assert!(contains(&c, &key(4), 6000));
    }

    #[test]
    fn test_lfu_eviction_order() {
        let mut c = create_cache(3, EvictionPolicy::Lfu, 100_000);
        put(&mut c, key(1), 10, 0, 1000).unwrap();
        put(&mut c, key(2), 20, 0, 1000).unwrap();
        put(&mut c, key(3), 30, 0, 1000).unwrap();

        // Access key(1) 5 times, key(3) 3 times, key(2) 0 times
        for t in 0..5 { let _ = get(&mut c, &key(1), 1100 + t); }
        for t in 0..3 { let _ = get(&mut c, &key(3), 1200 + t); }

        // Insert key(4) — should evict key(2) (least frequently used)
        put(&mut c, key(4), 40, 0, 2000).unwrap();
        assert!(!contains(&c, &key(2), 2000));
        assert!(contains(&c, &key(1), 2000));
    }

    #[test]
    fn test_fifo_eviction_order() {
        let mut c = create_cache(3, EvictionPolicy::Fifo, 100_000);
        put(&mut c, key(1), 10, 0, 1000).unwrap();
        put(&mut c, key(2), 20, 0, 2000).unwrap();
        put(&mut c, key(3), 30, 0, 3000).unwrap();

        // Even if we access key(1), FIFO should still evict it (oldest created)
        let _ = get(&mut c, &key(1), 5000);

        put(&mut c, key(4), 40, 0, 6000).unwrap();
        assert!(!contains(&c, &key(1), 6000));
    }

    #[test]
    fn test_ttl_eviction_order() {
        let mut c = create_cache(3, EvictionPolicy::Ttl, 10_000);
        put_with_ttl(&mut c, key(1), 10, 0, 50_000, 1000).unwrap(); // expires at 51000
        put_with_ttl(&mut c, key(2), 20, 0, 1000, 1000).unwrap();   // expires at 2000
        put_with_ttl(&mut c, key(3), 30, 0, 20_000, 1000).unwrap(); // expires at 21000

        // Insert key(4) — should evict key(2) (least remaining TTL)
        put(&mut c, key(4), 40, 0, 1500).unwrap();
        assert!(!contains(&c, &key(2), 1500));
        assert!(contains(&c, &key(1), 1500));
    }

    #[test]
    fn test_cache_stress_many_entries() {
        let mut c = create_cache(100, EvictionPolicy::Lru, 100_000);
        for i in 0u8..100 {
            put(&mut c, key(i), i as u64, i as u64 * 2, 1000).unwrap();
        }
        assert_eq!(entry_count(&c), 100);
        assert!(is_full(&c));

        // Insert one more — triggers eviction
        put(&mut c, key(200), 999, 0, 5000).unwrap();
        assert_eq!(entry_count(&c), 100);
    }

    #[test]
    fn test_cache_eviction_counter_increments() {
        let mut c = create_cache(2, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 10, 0, 1000).unwrap();
        put(&mut c, key(2), 20, 0, 2000).unwrap();
        put(&mut c, key(3), 30, 0, 3000).unwrap(); // Triggers eviction
        assert!(c.evictions >= 1);
    }

    #[test]
    fn test_invalidation_counter_increments() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 10, 0, 1000).unwrap();
        put(&mut c, key(2), 20, 0, 1000).unwrap();
        invalidate(&mut c, &key(1));
        invalidate(&mut c, &key(2));
        assert_eq!(c.invalidations, 2);
    }

    #[test]
    fn test_multiple_puts_same_key_no_duplicates() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        for i in 0..10 {
            put(&mut c, key(1), i, 0, 1000 + i).unwrap();
        }
        assert_eq!(entry_count(&c), 1);
        assert_eq!(get(&mut c, &key(1), 2000), Some((9, 0)));
    }

    #[test]
    fn test_evict_one_increments_evictions_counter() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 10, 0, 1000).unwrap();
        evict_one(&mut c, 2000);
        assert_eq!(c.evictions, 1);
    }

    #[test]
    fn test_get_after_remove() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 100, 200, 1000).unwrap();
        remove(&mut c, &key(1));
        assert_eq!(get(&mut c, &key(1), 1500), None);
    }

    #[test]
    fn test_dirty_write_then_flush_cycle() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 100_000);
        put(&mut c, key(1), 100, 200, 1000).unwrap();
        put(&mut c, key(2), 300, 400, 1000).unwrap();

        // Mark both dirty
        mark_dirty(&mut c, &key(1)).unwrap();
        mark_dirty(&mut c, &key(2)).unwrap();
        assert_eq!(dirty_count(&c), 2);

        // Flush
        let flushed = flush_dirty(&mut c);
        assert_eq!(flushed.len(), 2);
        assert_eq!(dirty_count(&c), 0);

        // Entries still in cache and clean
        assert!(contains(&c, &key(1), 2000));
        assert!(contains(&c, &key(2), 2000));
    }

    #[test]
    fn test_invalidate_older_than_exact_boundary() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 100_000);
        put(&mut c, key(1), 10, 0, 1000).unwrap();
        // age = 4000 - 1000 = 3000, threshold = 3000 => 3000 <= 3000, NOT removed
        let removed = invalidate_older_than(&mut c, 3000, 4000);
        assert_eq!(removed, 0);
        assert_eq!(entry_count(&c), 1);
    }

    #[test]
    fn test_multi_put_empty() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        let count = multi_put(&mut c, &[], 1000).unwrap();
        assert_eq!(count, 0);
        assert_eq!(entry_count(&c), 0);
    }

    #[test]
    fn test_warm_then_get() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        let data = vec![
            (key(1), 100, 200),
            (key(2), 300, 400),
            (key(3), 500, 600),
        ];
        warm_cache(&mut c, &data, 1000);
        assert_eq!(get(&mut c, &key(1), 1500), Some((100, 200)));
        assert_eq!(get(&mut c, &key(2), 1500), Some((300, 400)));
        assert_eq!(get(&mut c, &key(3), 1500), Some((500, 600)));
    }

    #[test]
    fn test_refresh_ttl_extends_life() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 2000);
        put(&mut c, key(1), 100, 200, 1000).unwrap();
        // Would expire at 3001 without refresh
        refresh_ttl(&mut c, &key(1), 2500).unwrap();
        // Now created_at=2500, expires at 4501
        assert!(contains(&c, &key(1), 4000));
        assert!(!contains(&c, &key(1), 5000));
    }

    #[test]
    fn test_extend_ttl_adds_time() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 2000);
        put(&mut c, key(1), 100, 200, 1000).unwrap();
        // Original: created_at=1000, ttl=2000, expires at 3001
        extend_ttl(&mut c, &key(1), 3000).unwrap();
        // New ttl=5000, expires at 6001
        assert!(contains(&c, &key(1), 5500));
    }

    #[test]
    fn test_version_increments_through_operations() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 100_000);
        put(&mut c, key(1), 10, 20, 1000).unwrap();
        assert_eq!(get_version(&c, &key(1)), Some(1));

        update_value(&mut c, &key(1), 30, 40, 2000).unwrap();
        assert_eq!(get_version(&c, &key(1)), Some(2));

        compare_and_swap(&mut c, &key(1), 2, 50, 60, 3000).unwrap();
        assert_eq!(get_version(&c, &key(1)), Some(3));

        // put on existing also increments version
        put(&mut c, key(1), 70, 80, 4000).unwrap();
        assert_eq!(get_version(&c, &key(1)), Some(4));
    }

    #[test]
    fn test_cas_prevents_race_condition() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 100_000);
        put(&mut c, key(1), 100, 200, 1000).unwrap();

        // First CAS succeeds (version 1 -> 2)
        compare_and_swap(&mut c, &key(1), 1, 300, 400, 2000).unwrap();

        // Second CAS with stale version 1 fails
        let r = compare_and_swap(&mut c, &key(1), 1, 500, 600, 3000);
        assert_eq!(r, Err(CacheError::VersionMismatch));

        // Value is still 300/400
        assert_eq!(get(&mut c, &key(1), 3500), Some((300, 400)));
    }

    #[test]
    fn test_invalidate_by_prefix_preserves_other() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key_prefix(b"A", 1), 10, 0, 1000).unwrap();
        put(&mut c, key_prefix(b"A", 2), 20, 0, 1000).unwrap();
        put(&mut c, key_prefix(b"B", 1), 30, 0, 1000).unwrap();
        put(&mut c, key_prefix(b"B", 2), 40, 0, 1000).unwrap();
        put(&mut c, key_prefix(b"C", 1), 50, 0, 1000).unwrap();

        invalidate_by_prefix(&mut c, b"A");
        assert_eq!(entry_count(&c), 3);
        assert!(!contains(&c, &key_prefix(b"A", 1), 1500));
        assert!(contains(&c, &key_prefix(b"B", 1), 1500));
        assert!(contains(&c, &key_prefix(b"C", 1), 1500));
    }

    #[test]
    fn test_evict_expired_with_mixed_ttls() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put_with_ttl(&mut c, key(1), 10, 0, 100, 1000).unwrap();   // expires at 1100
        put_with_ttl(&mut c, key(2), 20, 0, 500, 1000).unwrap();   // expires at 1500
        put_with_ttl(&mut c, key(3), 30, 0, 0, 1000).unwrap();     // never expires
        put_with_ttl(&mut c, key(4), 40, 0, 2000, 1000).unwrap();  // expires at 3000

        let removed = evict_expired(&mut c, 2000);
        assert_eq!(removed, 2); // key(1) and key(2)
        assert_eq!(entry_count(&c), 2);
        assert!(contains(&c, &key(3), 2000));
        assert!(contains(&c, &key(4), 2000));
    }

    #[test]
    fn test_multi_get_with_expired() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put_with_ttl(&mut c, key(1), 10, 20, 500, 1000).unwrap();
        put_with_ttl(&mut c, key(2), 30, 40, 5000, 1000).unwrap();

        let keys = [key(1), key(2)];
        let results = multi_get(&mut c, &keys, 2000);
        assert_eq!(results[0], None);          // expired
        assert_eq!(results[1], Some((30, 40))); // still valid
    }

    #[test]
    fn test_stats_avg_ttl_remaining() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put_with_ttl(&mut c, key(1), 10, 0, 5000, 1000).unwrap(); // 4000 remaining at 2000
        put_with_ttl(&mut c, key(2), 20, 0, 3000, 1000).unwrap(); // 2000 remaining at 2000
        let stats = compute_stats(&c, 2000);
        assert_eq!(stats.avg_ttl_remaining_ms, 3000); // (4000 + 2000) / 2
    }

    #[test]
    fn test_invalidate_older_than_all() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 100_000);
        put(&mut c, key(1), 10, 0, 1000).unwrap();
        put(&mut c, key(2), 20, 0, 2000).unwrap();
        let removed = invalidate_older_than(&mut c, 0, 10_000);
        assert_eq!(removed, 2);
    }

    #[test]
    fn test_dirty_entries_returns_refs() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 10, 20, 1000).unwrap();
        put(&mut c, key(2), 30, 40, 1000).unwrap();
        mark_dirty(&mut c, &key(2)).unwrap();
        let dirty = dirty_entries(&c);
        assert_eq!(dirty.len(), 1);
        assert_eq!(dirty[0].value, 30);
    }

    #[test]
    fn test_most_accessed_empty_cache() {
        let c = create_cache(10, EvictionPolicy::Lru, 10_000);
        let hot = most_accessed(&c, 5);
        assert!(hot.is_empty());
    }

    #[test]
    fn test_least_accessed_empty_cache() {
        let c = create_cache(10, EvictionPolicy::Lru, 10_000);
        let cold = least_accessed(&c, 5);
        assert!(cold.is_empty());
    }

    #[test]
    fn test_put_zero_capacity_cache() {
        let mut c = create_cache(0, EvictionPolicy::Lru, 10_000);
        let r = put(&mut c, key(1), 10, 20, 1000);
        assert_eq!(r, Err(CacheError::CacheFull));
    }

    #[test]
    fn test_default_cache_holds_entries() {
        let mut c = default_cache();
        for i in 0u8..10 {
            put(&mut c, key(i), i as u64, 0, 1000).unwrap();
        }
        assert_eq!(entry_count(&c), 10);
    }

    #[test]
    fn test_compute_stats_avg_access_count() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 100_000);
        put(&mut c, key(1), 10, 0, 1000).unwrap();
        put(&mut c, key(2), 20, 0, 1000).unwrap();
        let _ = get(&mut c, &key(1), 1100);
        let _ = get(&mut c, &key(1), 1200);
        let _ = get(&mut c, &key(1), 1300);
        // key(1) = 3 accesses, key(2) = 0, avg = 1 (integer division)
        let stats = compute_stats(&c, 1500);
        assert_eq!(stats.avg_access_count, 1);
    }

    #[test]
    fn test_time_to_live_exact_boundary() {
        let entry = CacheEntry {
            key: key(1), value: 100, secondary_value: 200,
            created_at: 1000, last_accessed: 1000, access_count: 0,
            ttl_ms: 5000, dirty: false, version: 1,
        };
        // Exactly at boundary: created_at + ttl_ms = 6000, now = 6000
        assert_eq!(time_to_live(&entry, 6000), 0);
    }

    #[test]
    fn test_saturating_ttl_no_overflow() {
        let entry = CacheEntry {
            key: key(1), value: 100, secondary_value: 200,
            created_at: u64::MAX - 100, last_accessed: u64::MAX - 100, access_count: 0,
            ttl_ms: 200, dirty: false, version: 1,
        };
        // created_at + ttl_ms would overflow without saturating
        assert!(!is_expired(&entry, u64::MAX - 50));
    }

    #[test]
    fn test_extend_ttl_saturating() {
        let mut c = create_cache(10, EvictionPolicy::Lru, u64::MAX - 10);
        put(&mut c, key(1), 10, 0, 1000).unwrap();
        extend_ttl(&mut c, &key(1), u64::MAX).unwrap();
        assert_eq!(c.entries[0].ttl_ms, u64::MAX);
    }

    #[test]
    fn test_multi_put_all_same_key() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        let entries = vec![(key(1), 10, 20), (key(1), 30, 40), (key(1), 50, 60)];
        let count = multi_put(&mut c, &entries, 1000).unwrap();
        assert_eq!(count, 3);
        assert_eq!(entry_count(&c), 1);
        assert_eq!(get(&mut c, &key(1), 1500), Some((50, 60)));
    }

    #[test]
    fn test_invalidate_by_prefix_single_byte() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        let mut k1 = [0u8; 32]; k1[0] = 0xAA;
        let mut k2 = [0u8; 32]; k2[0] = 0xAA; k2[1] = 0xBB;
        let mut k3 = [0u8; 32]; k3[0] = 0xCC;
        put(&mut c, k1, 10, 0, 1000).unwrap();
        put(&mut c, k2, 20, 0, 1000).unwrap();
        put(&mut c, k3, 30, 0, 1000).unwrap();
        let removed = invalidate_by_prefix(&mut c, &[0xAA]);
        assert_eq!(removed, 2);
        assert_eq!(entry_count(&c), 1);
    }

    #[test]
    fn test_evict_one_lfu_policy() {
        let mut c = create_cache(3, EvictionPolicy::Lfu, 100_000);
        put(&mut c, key(1), 10, 0, 1000).unwrap();
        put(&mut c, key(2), 20, 0, 1000).unwrap();
        put(&mut c, key(3), 30, 0, 1000).unwrap();
        // Access key(1) and key(3) but not key(2)
        let _ = get(&mut c, &key(1), 1100);
        let _ = get(&mut c, &key(3), 1200);
        // Evict one — should pick key(2) (0 accesses)
        let evicted = evict_one(&mut c, 1300);
        assert_eq!(evicted.unwrap().key, key(2));
    }

    #[test]
    fn test_evict_one_fifo_policy() {
        let mut c = create_cache(3, EvictionPolicy::Fifo, 100_000);
        put(&mut c, key(1), 10, 0, 1000).unwrap();
        put(&mut c, key(2), 20, 0, 2000).unwrap();
        put(&mut c, key(3), 30, 0, 3000).unwrap();
        let evicted = evict_one(&mut c, 4000);
        assert_eq!(evicted.unwrap().key, key(1)); // Oldest created
    }

    #[test]
    fn test_evict_one_ttl_policy() {
        let mut c = create_cache(3, EvictionPolicy::Ttl, 100_000);
        put_with_ttl(&mut c, key(1), 10, 0, 50_000, 1000).unwrap();
        put_with_ttl(&mut c, key(2), 20, 0, 1_000, 1000).unwrap(); // Least remaining
        put_with_ttl(&mut c, key(3), 30, 0, 20_000, 1000).unwrap();
        let evicted = evict_one(&mut c, 1500);
        assert_eq!(evicted.unwrap().key, key(2));
    }

    #[test]
    fn test_get_if_fresh_does_not_remove_expired() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 1000);
        put(&mut c, key(1), 100, 200, 1000).unwrap();
        // Read-only: does not remove expired entry
        assert_eq!(get_if_fresh(&c, &key(1), 5000), None);
        assert_eq!(entry_count(&c), 1); // Still there
    }

    #[test]
    fn test_remove_returns_correct_entry() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 100, 200, 1000).unwrap();
        put(&mut c, key(2), 300, 400, 1000).unwrap();
        let removed = remove(&mut c, &key(2)).unwrap();
        assert_eq!(removed.value, 300);
        assert_eq!(removed.secondary_value, 400);
        assert_eq!(removed.key, key(2));
    }

    #[test]
    fn test_put_with_ttl_update_resets_created_at() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put_with_ttl(&mut c, key(1), 100, 200, 5000, 1000).unwrap();
        put_with_ttl(&mut c, key(1), 300, 400, 5000, 3000).unwrap();
        assert_eq!(c.entries[0].created_at, 3000);
    }

    #[test]
    fn test_compute_stats_memory_estimate() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 10, 0, 1000).unwrap();
        put(&mut c, key(2), 20, 0, 1000).unwrap();
        put(&mut c, key(3), 30, 0, 1000).unwrap();
        let stats = compute_stats(&c, 2000);
        assert_eq!(stats.memory_estimate, 3 * 160);
    }

    #[test]
    fn test_compute_stats_evictions_and_invalidations() {
        let mut c = create_cache(2, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 10, 0, 1000).unwrap();
        put(&mut c, key(2), 20, 0, 2000).unwrap();
        put(&mut c, key(3), 30, 0, 3000).unwrap(); // eviction
        invalidate(&mut c, &key(3));
        let stats = compute_stats(&c, 4000);
        assert!(stats.evictions >= 1);
        assert_eq!(stats.invalidations, 1);
    }

    #[test]
    fn test_multi_get_all_miss() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        let keys = [key(1), key(2), key(3)];
        let results = multi_get(&mut c, &keys, 1000);
        assert!(results.iter().all(|r| r.is_none()));
        assert_eq!(c.misses, 3);
    }

    #[test]
    fn test_multi_get_all_hit() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 10, 0, 1000).unwrap();
        put(&mut c, key(2), 20, 0, 1000).unwrap();
        let keys = [key(1), key(2)];
        let results = multi_get(&mut c, &keys, 1500);
        assert!(results.iter().all(|r| r.is_some()));
        assert_eq!(c.hits, 2);
    }

    #[test]
    fn test_warm_cache_full_cache_with_eviction() {
        let mut c = create_cache(2, EvictionPolicy::Fifo, 10_000);
        put(&mut c, key(1), 10, 0, 1000).unwrap();
        put(&mut c, key(2), 20, 0, 2000).unwrap();
        let entries = vec![(key(3), 30, 0), (key(4), 40, 0)];
        let added = warm_cache(&mut c, &entries, 3000);
        assert_eq!(added, 2);
        assert_eq!(entry_count(&c), 2); // Still max 2
    }

    #[test]
    fn test_update_value_increments_version_consistently() {
        let mut c = create_cache(10, EvictionPolicy::Lru, 100_000);
        put(&mut c, key(1), 10, 0, 1000).unwrap();
        for i in 0..5 {
            update_value(&mut c, &key(1), 10 + i, 0, 2000 + i).unwrap();
        }
        assert_eq!(get_version(&c, &key(1)), Some(6)); // 1 (initial) + 5 updates
    }

    #[test]
    fn test_is_full_after_eviction() {
        let mut c = create_cache(2, EvictionPolicy::Lru, 10_000);
        put(&mut c, key(1), 10, 0, 1000).unwrap();
        put(&mut c, key(2), 20, 0, 2000).unwrap();
        assert!(is_full(&c));
        remove(&mut c, &key(1));
        assert!(!is_full(&c));
    }
}
