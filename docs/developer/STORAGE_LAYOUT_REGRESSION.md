# Storage Layout Regression Testing

## Why this matters

VibeSwap contracts are UUPS-upgradeable (OpenZeppelin `UUPSUpgradeable`). On upgrade, the
new implementation contract is swapped in-place. The proxy's storage is **not** migrated —
it is reused as-is.

If a new implementation inserts a variable in the middle of the storage layout, every slot
after that insertion shifts by one. The contract silently reads the wrong data. Funds can be
lost with no on-chain error. This is the most common irreversible bug class in upgrade-pattern
contracts.

The fix: commit a snapshot of each contract's storage layout. CI re-generates the layout and
diffs against the snapshot on every push. Any drift fails the build.

## Storage layout snapshots

Committed at `.storage-layouts/<ContractName>.json` (one file per UUPS contract). Each file
contains a normalized JSON array of storage slots: `label`, `slot`, `offset`, `type` — with
AST node IDs stripped so the snapshot is stable across recompilations.

Contracts with duplicate names (e.g. `VibeInsurancePool` in both `financial/` and
`mechanism/`) use a double-underscore path qualifier:
- `financial__VibeInsurancePool.json` → `contracts/financial/VibeInsurancePool.sol`

## Running locally

```bash
# Check all contracts with committed snapshots:
./script/check-storage-layout.sh

# Check specific contracts:
CONTRACTS="CommitRevealAuction VibeAMM" ./script/check-storage-layout.sh

# Update snapshots after an intentional layout change:
./script/check-storage-layout.sh --update
```

## Workflow for intentional layout changes

The only safe layout change is **appending** a new field to the end of a contract's storage
(before `__gap`). Insertions or deletions are always breaking.

1. Make your change (add the new field at the end).
2. Verify: `CONTRACTS="YourContract" ./script/check-storage-layout.sh` — this should show
   DRIFT but ONLY for the new appended field.
3. Confirm that all pre-existing slots (slot numbers 0 through N-1) are unchanged in the diff.
4. If safe: `./script/check-storage-layout.sh --update` to regenerate the snapshot.
5. Include the updated `.storage-layouts/YourContract.json` **in the same commit** as the
   contract change. Do not separate them — the snapshot is the proof of intent.

## Adding a new UUPS contract to the registry

When you add a new `UUPSUpgradeable` contract:

```bash
# Generate a snapshot for the new contract:
forge inspect YourNewContract storageLayout --json | \
  python3 script/normalize-storage-layout.py \
  > .storage-layouts/YourNewContract.json

# Verify it looks correct:
cat .storage-layouts/YourNewContract.json

# Stage both files together:
git add contracts/path/YourNewContract.sol .storage-layouts/YourNewContract.json
```

For contracts with duplicate names across directories, use the path-qualified specifier and
the double-underscore filename convention:

```bash
forge inspect contracts/financial/VibeInsurancePool.sol:VibeInsurancePool storageLayout --json | \
  python3 script/normalize-storage-layout.py \
  > .storage-layouts/financial__VibeInsurancePool.json
```

## CI integration

The check runs as a step in the `contracts` job in `.github/workflows/ci.yml`, after unit
tests and before job completion. It is a hard failure — `continue-on-error` is intentionally
not set. A layout drift blocks the merge.

## Contracts covered

Snapshots are maintained for core security-critical contracts:

| Directory | Contracts |
|-----------|-----------|
| `core/` | `CommitRevealAuction`, `VibeSwapCore`, `VSOSKernel` |
| `amm/` | `VibeAMM`, `VibeLimitOrder`, `VibeRouter` |
| `messaging/` | `CrossChainRouter` |
| `governance/` | `TreasuryStabilizer`, `VibeGovernanceHub`, `VibeProtocolTreasury` |
| `incentives/` | `ShapleyDistributor`, `ILProtectionVault` |
| `financial/` | `VibeVault`, `VibeStaking`, `VibeLendPool`, `financial__VibeInsurancePool`, `financial__VibeLiquidStaking` |

Contracts in `agents/`, `mechanism/`, `community/` and other peripheral directories are
excluded from the baseline snapshot set. To add them, generate a snapshot and commit it;
the CI script will automatically include any `.json` file in `.storage-layouts/`.
