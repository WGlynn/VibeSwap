# RSI Cycle 8 — Plan

**Status**: DRAFT (2026-04-13) — pending Will's review before implementation.

## Scope

Cycle 7 (2026-04-12) closed 4 HIGH/MED findings but deferred 4 architectural issues that require design discussion. This cycle tackles those.

## The Systemic Design Gap

Multiple contracts hold CKB-native tokens via standard ERC20 `transferFrom()`:
- **NakamotoConsensusInfinity** (`depositStake`): CKB tokens locked for validator staking
- **VibeStable** (collateral): CKB tokens locked as borrow collateral
- **JarvisComputeVault** (credits): CKB tokens locked as compute credit backing
- **DAOShelter** (shelter): CKB tokens locked for DAO insurance

Each contract tracks its own holdings internally. But `CKBNativeToken.totalOccupied` — the canonical "off-circulation" metric — only tracks tokens locked via `lock()` (called by authorized lockers for CKA cell state rent).

`SecondaryIssuanceController.distributeEpoch()` computes:
```solidity
shardShare = (emission * totalOccupied) / totalSupply
```

**Result**: Tokens staked/collateralized in the contracts above are out of circulation but invisible to the emission split. Shards get less emission than they should. The longer validators stake, the larger the under-count.

## Findings Being Fixed

| ID | Severity | Contract | Description |
|----|----------|----------|-------------|
| C7-GOV-001 | HIGH | NCI | Staking via transferFrom() invisible to issuance split |
| C7-GOV-006 | HIGH | JarvisComputeVault | Backing breaks under Joule rebase |
| C7-GOV-005 | MED | JULBridge | Rate limit in rebased amounts |
| C7-GOV-007 | MED | VibeStable | CKB-native as collateral bypasses totalOccupied |

All four share the same root: external contracts hold CKB tokens without registering them as off-circulation.

## Proposed Fix — Off-Circulation Registry

Add a whitelist-based off-circulation tracker to `CKBNativeToken` that aggregates balances from registered external holders.

### CKBNativeToken additions

```solidity
// New state
mapping(address => bool) public isOffCirculationHolder;
address[] public offCirculationHolders;

event OffCirculationHolderSet(address indexed holder, bool enabled);

// New admin function (governance-gated)
function setOffCirculationHolder(address holder, bool enabled) external onlyOwner {
    if (holder == address(0)) revert ZeroAddress();
    if (enabled && !isOffCirculationHolder[holder]) {
        isOffCirculationHolder[holder] = true;
        offCirculationHolders.push(holder);
    } else if (!enabled && isOffCirculationHolder[holder]) {
        isOffCirculationHolder[holder] = false;
        // Remove from array (O(n) but n is small — 4-10 contracts)
        uint256 len = offCirculationHolders.length;
        for (uint256 i = 0; i < len; i++) {
            if (offCirculationHolders[i] == holder) {
                offCirculationHolders[i] = offCirculationHolders[len - 1];
                offCirculationHolders.pop();
                break;
            }
        }
    }
    emit OffCirculationHolderSet(holder, enabled);
}

// New view — aggregate off-circulation
function offCirculation() external view returns (uint256) {
    uint256 total = totalOccupied;
    uint256 len = offCirculationHolders.length;
    for (uint256 i = 0; i < len; i++) {
        total += balanceOf(offCirculationHolders[i]);
    }
    return total;
}

// Updated view — circulating now excludes all off-circulation
function circulatingSupply() external view override returns (uint256) {
    return totalSupply() - this.offCirculation();
}
```

### SecondaryIssuanceController change

```solidity
// Before
uint256 totalOccupied = ckbToken.totalOccupied();

// After
uint256 totalOccupied = ckbToken.offCirculation();
```

(Rename local var to `offCirc` for clarity.)

### Deployment sequence

1. Upgrade `CKBNativeToken` proxy with new functions
2. Call `setOffCirculationHolder()` for:
   - NakamotoConsensusInfinity
   - VibeStable
   - JarvisComputeVault
   - DAOShelter (if not already tracked via `daoShelter.totalDeposited()`)
3. Upgrade `SecondaryIssuanceController` to use `offCirculation()`

## Why This Approach

**Alternative considered**: Add `stake()`/`unstake()` functions to CKBNativeToken (parallel to `lock()`/`unlock()`) and change every downstream contract to call them. Rejected because:
- Invasive: requires changing NCI/VibeStable/JCV/DAOShelter code paths
- Error-prone: easy to miss a path; if anyone uses `transferFrom()` directly, accounting breaks
- Conflates roles: the external contract already has internal accounting; duplicating it here creates dual sources of truth

**The whitelist approach**:
- Zero changes to NCI/VibeStable/JCV/DAOShelter
- Single source of truth: `balanceOf(contract)` is authoritative
- Gas cost bounded (O(n) with small n, called once per epoch)
- Failure mode is obvious: forgetting to register = under-counted emission, which is noticeable in tests

**Trade-off acknowledged**: Briefly in-flight tokens (between `transferFrom()` and internal bookkeeping) could double-count in edge cases. But CKB tokens don't move through contracts — they stay locked — so in-flight state is minimal. Acceptable.

## Tests to Add

1. `test/issuance/OffCirculation.t.sol`:
   - Register holder → balance counted
   - Unregister → balance uncounted
   - Multiple holders → sum correct
   - Token transfers update `offCirculation()` correctly
2. `test/consensus/IssuanceWithStaking.t.sol`:
   - NCI stakes 100M CKB → shard share reflects 100M + totalOccupied
   - NCI unstakes → shard share drops accordingly
3. Gas snapshot: `offCirculation()` at 10 holders should be < 20k gas

## Risks

1. **Upgrade coordination**: Must upgrade CKBNativeToken and SecondaryIssuanceController in the same epoch to avoid under-count during the transition window.
2. **New admin surface**: `setOffCirculationHolder()` is onlyOwner. If owner is compromised, attacker could register a zero-balance address (benign) or unregister a real one (under-count attack, reducing shard emission).
3. **Integration with Joule rebase** (C7-GOV-006): If Joule rebases, `balanceOf(NCI)` changes automatically via the rebase mechanism. This is correct behavior — off-circulation follows rebase. But C7-GOV-006 is about JCV's internal accounting getting out of sync, which is separate and needs JCV-specific fix.

## Phases

| Phase | Scope | Status |
|-------|-------|--------|
| 8.1 | CKBNativeToken additions + tests | pending |
| 8.2 | SecondaryIssuanceController switch + tests | pending |
| 8.3 | JCV rebase sync (C7-GOV-006) | separate, Cycle 8.5 |
| 8.4 | JULBridge rebased rate limits (C7-GOV-005) | separate, Cycle 8.5 |

## Not In Scope

- `stake()`/`unstake()` API parallel to `lock()`/`unlock()` — rejected as invasive
- Changing NCI/VibeStable/JCV internal accounting — they're correct as-is
- On-chain governance for the whitelist — keep onlyOwner for now; can migrate to Timelock later

## Implementation Checklist

- [ ] Read full `CKBNativeToken.sol` and `SecondaryIssuanceController.sol` (done, see RSI notes)
- [ ] Write `OffCirculation.t.sol` tests FIRST (TDD)
- [ ] Implement `setOffCirculationHolder` + `offCirculation()` in CKBNativeToken
- [ ] Verify upgrade-safe (storage layout unchanged, only appends)
- [ ] Switch SecondaryIssuanceController to `offCirculation()`
- [ ] Run full test suite, target: 0 regressions
- [ ] Write deployment script that registers holders after upgrade
- [ ] Update GKB glyphs with off-circulation pattern primitive
