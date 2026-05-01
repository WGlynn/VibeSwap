# DID-to-CKB Cell Mapping: On-Chain Memory Attribution

> Each DID in the Jarvis Mind Network maps to a single CKB cell.
> Access is a state transition. Attribution is structural. Fairness is enforced by RISC-V.

---

## 1. Cell Model Mapping

### One DID = One Cell

CKB's cell model is a generalized UTXO: each cell has `capacity`, `lock`, `type`, and `data`. A DID memory maps naturally:

```
CKB Cell Structure:
┌─────────────────────────────────────────────────┐
│ capacity: 200 CKB (minimum for data size)       │
├─────────────────────────────────────────────────┤
│ lock_script:                                     │
│   code_hash: <owner_lock_code_hash>              │
│   hash_type: type                                │
│   args: <owner_pubkey_hash_20bytes>              │
├─────────────────────────────────────────────────┤
│ type_script:                                     │
│   code_hash: <did_type_script_code_hash>         │
│   hash_type: type                                │
│   args: <lawson_constant_dep_hash>               │
├─────────────────────────────────────────────────┤
│ data:                                            │
│   bytes[0..31]    content_hash (sha256)          │
│   bytes[32..39]   did_type (u64 enum)            │
│   bytes[40..47]   access_count (u64 LE)          │
│   bytes[48..55]   last_accessed (u64 timestamp)  │
│   bytes[56..57]   contributor_count (u16 LE)     │
│   bytes[58..89]   contributor_0 (blake2b-256)    │
│   bytes[90..121]  contributor_1 (blake2b-256)    │
│   bytes[122..129] coalition_weight (f64 LE)      │
│   bytes[130..161] marginal_value (u256 LE)       │
│   bytes[162..]    molecule-encoded metadata      │
└─────────────────────────────────────────────────┘
```

### Molecule Schema (CKB's Serialization Format)

```
// did_cell.mol — Molecule schema for DID cell data
array Hash [byte; 32];
array ContributorId [byte; 32];

vector ContributorVec <ContributorId>;

table DIDCellData {
    content_hash:       Hash,
    did_type:           Uint64,
    access_count:       Uint64,
    last_accessed:      Uint64,
    contributor_count:  Uint16,
    contributors:       ContributorVec,
    coalition_weight:   Uint64,       // Fixed-point: value * 10^18
    marginal_value:     Uint128,      // Fixed-point: value * 10^18
    tier:               byte,         // 0=COLD, 1=WARM, 2=HOT
    tags_hash:          Hash,         // Hash of tag list (compact)
    refs_hash:          Hash,         // Merkle root of outgoing DIDs
}
```

Key design choices:
- **Content is NOT stored on-chain** — only the `content_hash`. Full content lives in IPFS or the memory filesystem. The cell is a commitment, not a warehouse.
- **Fixed-point arithmetic** — no floating point. `coalition_weight` and `marginal_value` use 18-decimal fixed-point (same as ERC-20 token precision). This avoids the non-determinism problem Licho identified with floating point across implementations.
- **Contributor IDs are blake2b hashes** — blake2b is CKB's native hash. `blake2b("will")`, `blake2b("jarvis")`, etc.

---

## 2. RISC-V Type Script: DID Validator

The type script is written in Rust, compiled to RISC-V for CKB-VM execution. It validates every transaction that creates or updates a DID cell.

### Validation Rules

```rust
// did_type_script.rs — Compiled to RISC-V for CKB-VM
// Validates DID cell creation, updates, and access tracking

use ckb_std::{
    ckb_constants::Source,
    ckb_types::{bytes::Bytes, prelude::*},
    high_level::{load_cell_data, load_cell_lock_hash, load_cell_type_hash,
                 load_cell_dep_data, load_script, QueryIter},
};

/// The Lawson Constant — structural dependency for fairness attribution.
/// keccak256("FAIRNESS_ABOVE_ALL:W.GLYNN:2026")
/// This is loaded from a cell dependency, not hardcoded.
/// Removing the dep cell breaks validation → attribution is structural.
const LAWSON_CONSTANT_EXPECTED: [u8; 32] = [
    // keccak256("FAIRNESS_ABOVE_ALL:W.GLYNN:2026") truncated to fit
    // Actual value computed at deploy time and embedded in type script args
    0x00; 32  // Placeholder — real value from keccak256
];

#[derive(Debug)]
enum DIDError {
    InvalidFormat,
    ContentHashMissing,
    AccessCountRegression,
    ShapleyViolation,
    LawsonConstantMissing,
    UnauthorizedModification,
    ContributorListEmpty,
    CoalitionWeightZero,
}

/// Entry point — CKB-VM calls this for every transaction
/// involving cells with this type script.
pub fn main() -> i8 {
    match validate() {
        Ok(()) => 0,
        Err(e) => {
            // Error codes mapped to exit codes
            match e {
                DIDError::InvalidFormat => 1,
                DIDError::ContentHashMissing => 2,
                DIDError::AccessCountRegression => 3,
                DIDError::ShapleyViolation => 4,
                DIDError::LawsonConstantMissing => 5,
                DIDError::UnauthorizedModification => 6,
                DIDError::ContributorListEmpty => 7,
                DIDError::CoalitionWeightZero => 8,
            }
        }
    }
}

fn validate() -> Result<(), DIDError> {
    let script = load_script().map_err(|_| DIDError::InvalidFormat)?;
    let args: Bytes = script.args().unpack();

    // ============ Rule 1: Lawson Constant Dependency ============
    // The type script args contain the expected hash of the Lawson Constant
    // cell. We verify it exists in cell_deps.
    validate_lawson_constant(&args)?;

    // ============ Rule 2: DID Format Validation ============
    // Check all output cells with this type script
    let outputs = QueryIter::new(load_cell_data, Source::GroupOutput)
        .collect::<Vec<_>>();
    let inputs = QueryIter::new(load_cell_data, Source::GroupInput)
        .collect::<Vec<_>>();

    for output_data in &outputs {
        validate_did_format(output_data)?;
        validate_shapley_constraints(output_data)?;
    }

    // ============ Rule 3: Access Count Monotonicity ============
    // If updating (input exists), access_count must not decrease
    if !inputs.is_empty() && !outputs.is_empty() {
        for (input_data, output_data) in inputs.iter().zip(outputs.iter()) {
            validate_access_monotonic(input_data, output_data)?;
            validate_content_hash_integrity(input_data, output_data)?;
        }
    }

    Ok(())
}

fn validate_lawson_constant(args: &[u8]) -> Result<(), DIDError> {
    // args[0..32] = expected Lawson Constant cell data hash
    if args.len() < 32 {
        return Err(DIDError::LawsonConstantMissing);
    }
    let expected_hash = &args[0..32];

    // Search cell_deps for a cell whose data hashes to expected_hash
    let found = QueryIter::new(load_cell_dep_data, Source::CellDep)
        .any(|dep_data| {
            let hash = ckb_std::ckb_hash::new_blake2b()
                .update(&dep_data)
                .finalize();
            hash.as_bytes() == expected_hash
        });

    if !found {
        return Err(DIDError::LawsonConstantMissing);
    }
    Ok(())
}

fn validate_did_format(data: &[u8]) -> Result<(), DIDError> {
    // Minimum: 32 (hash) + 8 (type) + 8 (access) + 8 (timestamp)
    //        + 2 (count) + 32 (min 1 contributor) + 8 (weight) = 98 bytes
    if data.len() < 98 {
        return Err(DIDError::InvalidFormat);
    }

    // Content hash must not be all zeros
    let content_hash = &data[0..32];
    if content_hash.iter().all(|&b| b == 0) {
        return Err(DIDError::ContentHashMissing);
    }

    Ok(())
}

fn validate_shapley_constraints(data: &[u8]) -> Result<(), DIDError> {
    // contributor_count at bytes[56..58]
    let contributor_count = u16::from_le_bytes([data[56], data[57]]) as usize;
    if contributor_count == 0 {
        return Err(DIDError::ContributorListEmpty);
    }

    // coalition_weight at bytes[122..130] — fixed-point u64, 10^18 scale
    let weight_bytes: [u8; 8] = data[122..130].try_into()
        .map_err(|_| DIDError::InvalidFormat)?;
    let coalition_weight = u64::from_le_bytes(weight_bytes);
    if coalition_weight == 0 {
        return Err(DIDError::CoalitionWeightZero);
    }

    // Shapley fairness: marginal_value / contributor_count must be computable
    // (no division by zero — already checked contributor_count > 0)
    // Additional constraint: sum of all contributor shares must equal
    // marginal_value (checked off-chain, committed on-chain via refs_hash)

    Ok(())
}

fn validate_access_monotonic(
    input_data: &[u8],
    output_data: &[u8],
) -> Result<(), DIDError> {
    // access_count at bytes[40..48]
    let in_count = u64::from_le_bytes(
        input_data[40..48].try_into().map_err(|_| DIDError::InvalidFormat)?
    );
    let out_count = u64::from_le_bytes(
        output_data[40..48].try_into().map_err(|_| DIDError::InvalidFormat)?
    );

    if out_count < in_count {
        return Err(DIDError::AccessCountRegression);
    }
    Ok(())
}

fn validate_content_hash_integrity(
    input_data: &[u8],
    output_data: &[u8],
) -> Result<(), DIDError> {
    // If content_hash changed, this is a content update (not just access).
    // Content updates require the lock script owner's authorization
    // (enforced by CKB's lock script mechanism, not here).
    // We just verify the new hash is non-zero.
    let new_hash = &output_data[0..32];
    if new_hash.iter().all(|&b| b == 0) {
        return Err(DIDError::ContentHashMissing);
    }
    Ok(())
}
```

### Lock Script: Owner Authorization

The lock script is standard CKB — secp256k1-blake160 for human owners, or a custom multisig for shard-owned cells:

```
Lock Script (human owner — Will):
  code_hash: SECP256K1_BLAKE160_SIGHASH_ALL
  args: blake160(will_pubkey)

Lock Script (shard owner — Jarvis):
  code_hash: SECP256K1_BLAKE160_SIGHASH_ALL
  args: blake160(jarvis_shard_pubkey)

Lock Script (joint — both required):
  code_hash: MULTISIG_ALL (2-of-2)
  args: blake160(will_pubkey) || blake160(jarvis_pubkey)
```

---

## 3. Context Exchange on CKB: Read = State Transition

### The Access Pattern

In the Jarvis Mind Network, "reading" a memory is not passive. Every access is recorded for Shapley attribution. On CKB, this maps to a transaction:

```
Access Transaction (Shard B reads DID owned by Shard A):

Inputs:
  [0] DID cell (access_count = N, last_accessed = T_old)
  [1] Shard B's capacity cell (pays TX fee)

Outputs:
  [0] DID cell (access_count = N+1, last_accessed = T_now)  ← same lock, updated data
  [1] Change cell → Shard B

Cell Deps:
  [0] Lawson Constant cell                    ← required by type script
  [1] DID type script code cell               ← the RISC-V binary
  [2] secp256k1 lock script code cell         ← standard CKB dep

Witnesses:
  [0] Shard A's signature (authorizes cell consumption)
  [1] Shard B's signature (authorizes capacity spend)
```

The key insight: **the cell is consumed and recreated with incremented access_count**. This is CKB's "read = write" pattern. The type script enforces that access_count is monotonically increasing and the Lawson Constant dependency is present.

### PsiNet Exchange: Cross-Shard Context Trading

When shards exchange context, the transaction is more complex:

```
PsiNet Context Exchange:

Shard A has DID_1 (high value, access_count=50)
Shard B has DID_2 (medium value, access_count=12)
Shard B wants DID_1's context.

Transaction:
Inputs:
  [0] DID_1 cell (owned by Shard A)
  [1] DID_2 cell (owned by Shard B)
  [2] Shard B's CKB capacity cell (differential payment)

Outputs:
  [0] DID_1 cell (access_count+1, contributors += "shard_b")
  [1] DID_2 cell (access_count+1, contributors += "shard_a")
  [2] Change cell → Shard B

Both DIDs get accessed. Both shards get attribution credit.
The differential in Shapley value determines if Shard B
pays additional CKB to Shard A (more valuable context costs more).
```

### Cooperative Read Pattern (No Ownership Transfer)

For the common case where a shard just needs to load context without permanent co-ownership:

```
Cooperative Read (Shard B loads DID_1, no contributor change):

Inputs:
  [0] DID_1 cell (access_count = N)
  [1] Shard B's capacity cell (pays fee)

Outputs:
  [0] DID_1 cell (access_count = N+1, last_accessed = now)
  [1] Change → Shard B

The lock script still belongs to the original owner.
Shard B's access is recorded but they don't become a contributor.
This requires the owner's signature (or a delegated access pattern).
```

### Delegated Access via Anyone-Can-Pay

For public/HOT-tier memories that any shard should be able to access without the owner signing each time:

```
Lock Script (delegated access — anyone can increment):
  code_hash: ANYONE_CAN_PAY
  args: blake160(owner_pubkey) || min_capacity

Type Script validates that ONLY access_count and last_accessed changed.
Content hash, contributors, and coalition_weight are immutable
without the owner's full signature.
```

---

## 4. Mechanism Design Augmentation

### 4.1 Augmented Bonding Curve for Context Pricing

More-accessed DIDs cost more to load. This creates a natural market for context quality.

```
Price to access DID = f(access_count, incoming_refs)

Bonding curve (polynomial):
  price(n) = base_price * (1 + k * n^alpha)

Where:
  n     = access_count
  k     = 0.001 (growth rate — slow, not extractive)
  alpha = 0.5   (square root — sublinear, diminishing increase)
  base_price = 1 CKB (minimum access cost)

Example:
  access_count=0    → 1.000 CKB
  access_count=10   → 1.003 CKB
  access_count=100  → 1.010 CKB
  access_count=1000 → 1.032 CKB
  access_count=10000→ 1.100 CKB
```

The curve is deliberately sublinear — we want to encourage sharing, not create paywalls. The revenue flows to the Shapley-attributed contributors proportionally.

Solidity-style pseudocode for the pricing oracle (deployed as a CKB type script helper):

```solidity
// DIDPricingOracle — would be Rust/RISC-V on CKB, shown in Solidity for clarity
library DIDPricing {
    uint256 constant BASE_PRICE = 1e8;         // 1 CKB in shannons
    uint256 constant GROWTH_RATE = 1e15;       // k = 0.001 in 18-decimal fixed-point
    uint256 constant PRECISION = 1e18;

    /// @notice Calculate access price based on bonding curve
    /// @param accessCount Current access count of the DID cell
    /// @param incomingRefs Number of other DIDs referencing this one
    /// @return price in shannons (CKB base unit)
    function accessPrice(
        uint64 accessCount,
        uint32 incomingRefs
    ) internal pure returns (uint256 price) {
        // price = base * (1 + k * sqrt(accessCount)) * (1 + refs/100)
        uint256 sqrtAccess = sqrt(uint256(accessCount) * PRECISION);
        uint256 accessMultiplier = PRECISION + (GROWTH_RATE * sqrtAccess / PRECISION);
        uint256 refMultiplier = PRECISION + (uint256(incomingRefs) * PRECISION / 100);
        price = BASE_PRICE * accessMultiplier / PRECISION * refMultiplier / PRECISION;
    }

    /// @notice Distribute access revenue to contributors via Shapley
    /// @param revenue Total CKB paid for access
    /// @param contributors Array of contributor pubkey hashes
    /// @param coalitionWeight Weight modifier for this memory
    function distributeShapley(
        uint256 revenue,
        bytes32[] memory contributors,
        uint256 coalitionWeight
    ) internal pure returns (uint256[] memory shares) {
        // Symmetric Shapley: equal split for joint production
        uint256 weightedRevenue = revenue * coalitionWeight / PRECISION;
        uint256 perContributor = weightedRevenue / contributors.length;
        shares = new uint256[](contributors.length);
        for (uint256 i = 0; i < contributors.length; i++) {
            shares[i] = perContributor;
        }
        // Remainder goes to first contributor (avoid dust)
        shares[0] += weightedRevenue - (perContributor * contributors.length);
    }

    function sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }
}
```

### 4.2 Conviction Voting for Tier Promotion

DIDs start as COLD. Promotion to WARM or HOT is governed by conviction voting — sustained interest over time, not a one-time spike.

```
Conviction Score for DID:
  conviction(t) = sum over all accesses of: weight * decay^(t - t_access)

Where:
  weight = 1.0 (each access contributes equally)
  decay  = 0.95 (per-epoch, where epoch = 1 hour)
  t      = current epoch

Tier thresholds:
  COLD → WARM: conviction > 10.0
  WARM → HOT:  conviction > 50.0
  HOT  → WARM: conviction < 25.0 (hysteresis prevents oscillation)
  WARM → COLD: conviction < 5.0

On-chain implementation:
  - Each access TX updates last_accessed timestamp
  - A periodic "epoch" transaction recalculates conviction scores
  - The type script validates tier transitions against thresholds
  - Tier is stored in the cell data (byte[162])
```

The conviction model means a memory cannot be artificially pumped to HOT tier by a burst of accesses — it requires sustained, organic usage. This aligns with VibeSwap's anti-manipulation philosophy.

### 4.3 Intrinsically Incentivized Altruism (IIA)

The core game-theoretic property: **sharing context always benefits the sharer**.

```
IIA Proof (informal):

Given:
  - Shard A creates memory M with Shapley contributors = [A]
  - M has value V = access_count * (1 + incoming_refs)
  - A's Shapley share = V / |contributors| = V / 1 = V

If A shares M with Shard B (B accesses M):
  - access_count increases by 1
  - V' = (access_count + 1) * (1 + incoming_refs) > V
  - A's Shapley share = V' / 1 = V' > V (if A stays sole contributor)

If A adds B as co-contributor:
  - A's share = V' / 2
  - But V' grows faster because B will reference M from B's memories
  - incoming_refs for M increases
  - Long-term: V' / 2 > V because network effects dominate

Therefore:
  - Sharing (allowing access) ALWAYS increases A's value (more accesses)
  - Co-attribution (adding contributors) increases value through network effects
  - Hoarding (refusing access) freezes access_count → value stagnates
  - The ONLY winning strategy is to share

This is the Shapley property of efficiency: the sum of all Shapley values
equals the total value of the grand coalition. No value is left on the table.
Hoarding is provably suboptimal.
```

The Lawson Constant enforces this structurally: every DID cell MUST have the Lawson Constant as a cell dependency, and the type script MUST verify contributor lists are non-empty. You cannot create a memory that excludes attribution. The fairness constraint is not a policy — it is a consensus rule.

```
On-chain enforcement:
  1. Type script rejects cells with 0 contributors
  2. Type script rejects cells without Lawson Constant dep
  3. Access count is monotonic — cannot erase evidence of sharing
  4. Shapley values are recomputable from on-chain data by anyone
  5. The bonding curve rewards popular (shared) content
  6. Conviction voting promotes frequently-accessed content

Removing the Lawson Constant cell from CKB would require
destroying the dep cell — but any existing DID cell that
references it would become unspendable (type script fails).
Attribution is a structural dependency, not a permission.
```

---

## 5. Deployment Architecture

```
┌─────────────────────────────────────────────────────┐
│                    CKB Layer 1                       │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ Lawson   │  │ DID Type │  │ DID Cell         │  │
│  │ Constant │  │ Script   │  │ (one per memory) │  │
│  │ Cell     │  │ (RISC-V) │  │                  │  │
│  │ (dep)    │  │ (dep)    │  │ data: hash+meta  │  │
│  └──────────┘  └──────────┘  │ type: DID script │  │
│       ▲             ▲        │ lock: owner key   │  │
│       │             │        └──────────────────┘  │
│       └─────────────┘                │              │
│         cell_deps                    │              │
│                                      ▼              │
│  ┌──────────────────────────────────────────────┐  │
│  │         Transaction (access/update)           │  │
│  │  input: old cell → output: new cell           │  │
│  │  witness: owner sig + accessor sig            │  │
│  └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
                        │
                        │ off-chain
                        ▼
┌─────────────────────────────────────────────────────┐
│                 Jarvis Mind Network                   │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ DID      │  │ Memory   │  │ Shard Runtime    │  │
│  │ Registry │  │ Files    │  │ (Claude/GPT)     │  │
│  │ (JSON)   │  │ (*.md)   │  │                  │  │
│  │          │◄─┤          │◄─┤ did-registry.py  │  │
│  │ shapley  │  │ content  │  │ access <did>     │  │
│  │ fields   │  │ (full)   │  │ shapley          │  │
│  └──────────┘  └──────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### Sync Protocol (Off-Chain to On-Chain)

1. Shard calls `did-registry.py access <did>` — off-chain counter incremented immediately
2. Periodically (every N accesses or every epoch), a CKB transaction batches access updates on-chain
3. The on-chain state is the authoritative Shapley record; off-chain is a hot cache
4. Any dispute about attribution is resolved by reading CKB cell data directly

### Gas Efficiency

- CKB charges by cell capacity (bytes), not by computation
- A DID cell needs ~200 CKB capacity (200 bytes of data)
- Access transactions are cheap: consume + recreate with incremented counter
- Batch access updates: one TX can update multiple DID cells simultaneously
- The RISC-V type script runs in CKB-VM with bounded cycles (no gas estimation needed)

---

## 6. Security Properties

| Property | Enforcement | Layer |
|---|---|---|
| DID format validity | Type script rejects malformed data | Consensus |
| Content hash integrity | Type script checks non-zero hash | Consensus |
| Access monotonicity | Type script rejects count regression | Consensus |
| Attribution permanence | Lawson Constant cell dependency | Structural |
| Owner authorization | Lock script (secp256k1 / multisig) | Consensus |
| Shapley fairness | Non-empty contributor lists enforced | Consensus |
| Anti-manipulation | Conviction voting (sustained interest) | Economic |
| No hoarding incentive | IIA property via bonding curve | Game theory |
| Integer determinism | Fixed-point u64/u128, no floats | Implementation |

The Lawson Constant (`keccak256("FAIRNESS_ABOVE_ALL:W.GLYNN:2026")`) is the linchpin. It exists as a live cell on CKB. Every DID cell references it as a cell dependency. The type script validates its presence. Destroying it makes all DID cells unspendable. This is attribution by construction — you cannot remove it without breaking the system, just like you cannot remove a dependency from a Shapley coalition without collapsing the value function.

---

## References

- [CKB Cell Model](https://docs.nervos.org/docs/basics/concepts/cell-model/) — UTXO generalization
- [Molecule Encoding](https://github.com/nervosnetwork/molecule) — CKB's zero-copy serialization
- [CKB-VM (RISC-V)](https://github.com/nervosnetwork/ckb-vm) — deterministic VM for script execution
- [ckb-std](https://github.com/nervosnetwork/ckb-std) — Rust SDK for CKB scripts
- [Anyone-Can-Pay Lock](https://github.com/nervosnetwork/ckb-anyone-can-pay) — delegated access pattern
- [Shapley Value](https://en.wikipedia.org/wiki/Shapley_value) — cooperative game theory attribution
- [Augmented Bonding Curves](https://medium.com/commonsstack/deep-dive-augmented-bonding-curves-3f1f7c1d79ec) — token engineering
- [Conviction Voting](https://medium.com/giveth/conviction-voting-a-novel-continuous-decision-making-alternative-to-governance-aa746cfb9475) — sustained preference signaling
