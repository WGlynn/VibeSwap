# Oracle Primitive — Cycle 12 Delivery (R3 Tuple)

**Commit**: `125b01fb` on `feature/social-dag-phase-1`
**Date**: 2026-04-18
**Status**: Shipped. Tests green. Ready for reviewer R3 pass.

---

## What C12 Closes

External audit R2 identified the gap: previous batches stopped fabricated `cellId`s; content *within* the evidence bundle could still be fabricated. C12 closes that via:

1. **Schema enforcement** — arbitrary bytes → structured EIP-712 commitments
2. **Stake-bonded issuer reputation** — economic cost to fabrication

## Files

**Contracts** (new):
- `contracts/oracles/IssuerReputationRegistry.sol` (~280 LOC)
- `contracts/oracles/interfaces/IIssuerReputationRegistry.sol`
- `contracts/oracles/interfaces/ISocialSlashingTier.sol` (stub, enabled=false)

**Contracts** (modified):
- `contracts/oracles/interfaces/ITruePriceOracle.sol` (added `EvidenceBundle` struct + `updateTruePriceBundle` function)
- `contracts/oracles/TruePriceOracle.sol` (added `EVIDENCE_BUNDLE_TYPEHASH`, `issuerRegistry` storage, `updateTruePriceBundle` implementation, `_verifyBundleSignature`, `_bundleStructHash`, `_currentStablecoinContextHash`, `setIssuerRegistry`)

**Tests** (new, 26 passing):
- `test/oracles/IssuerReputationRegistry.t.sol` — 17 tests
- `test/oracles/TruePriceOracleC12.t.sol` — 9 tests

## Evidence Bundle

```solidity
struct EvidenceBundle {
    uint8 version;                  // Schema version (= 1 for C12)
    bytes32 poolId;
    uint256 price;
    uint256 confidence;
    int256 deviationZScore;
    RegimeType regime;
    uint256 manipulationProb;
    bytes32 dataHash;
    bytes32 stablecoinContextHash;  // keccak256 snapshot at attestation
    bytes32 issuerKey;              // Registered issuer identity
}
```

EIP-712 typehash covers all fields plus `nonce` and `deadline`. Fabrication of any field invalidates signature recovery.

## IssuerReputationRegistry

Standalone contract (not an extension of ReputationOracle — semantic isolation).

**State per issuer**:
- `IssuerStatus status`: UNREGISTERED | ACTIVE | UNBONDING | SLASHED_OUT
- `address signer`: address bound to the issuerKey
- `uint256 stake`: bonded collateral
- `uint256 reputation`: 0–10000 bps, starts at 5000 (MID)
- `uint256 lastTouched`: for mean-reversion decay
- `uint256 unbondAvailableAt`: gate for `completeUnbond`

**Reputation mean-reversion**: exponential with 30-day half-life toward MID=5000. No positive-reward loop. Cap of 10 half-lives in the gas-efficient linear approximation.

**Slashing**: permissioned (owner + authorized slashers). Stake burned (not redistributed — anti-rent-extraction default). Reputation docked by the same bps. If reputation drops below `minReputation` (default 2000) OR stake drops below `minStake`, status → SLASHED_OUT and cannot re-verify.

**Anti-slash-dodge**: 7-day unbond delay. Slash still succeeds during UNBONDING. Verified by test `test_Unbond_SlashStillPossibleDuringUnbond`.

**Non-reactivation on decay**: once SLASHED_OUT, reputation decay toward MID does not re-activate. Requires explicit re-registration with fresh stake. Verified by `test_ReputationDecay_DoesNotReactivate`.

## Update Path

`updateTruePriceBundle(EvidenceBundle calldata, bytes calldata)`:
1. Version check (rejects if != BUNDLE_VERSION)
2. Registry-set check
3. StablecoinContext hash match (bundle's snapshot == live hash)
4. Signature recovery
5. `registry.verifyIssuer(bundle.issuerKey, recoveredSigner)` — must be ACTIVE + signer match
6. Nonce + deadline check
7. Price-jump check (legacy path reused)
8. Storage write + event

Legacy `updateTruePrice(bytes32, ..., bytes)` preserved for backward compat. The two paths use separate permission models — legacy uses `authorizedSigners` owner-allowlist; bundle uses the stake-bonded registry.

## Six Design Decisions (Full Autonomy Grant)

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | IssuerRepRegistry as new standalone contract | Semantic isolation; ReputationOracle tracks voter trust, a different semantic |
| 2 | Python off-chain signing deferred to Phase 2 | Solidity side is the R3 gate; off-chain keeper work parallelizable |
| 3 | StateRentVault integration deferred | Keeps C12 scope tight; mirrors C11-AUDIT-14 pattern when added |
| 4 | StablecoinContext snapshot hashed into bundle | Auditability — bundle commits to the context the issuer saw |
| 5 | Penalty-only reputation with mean-reversion | Simpler surface, no reward-gaming attack; decay is cleanup, not reinstatement |
| 6 | Social slashing stub with `enabled=false` | Default trust-minimization; governance path available but not active |

## Upgrade Path (Non-Concern)

The new `issuerRegistry` storage slot defaults to `address(0)` post-upgrade. The bundle path reverts `IssuerRegistryNotSet` when zero, so no state poisoning. Owner must call `setIssuerRegistry(address)` post-upgrade to enable the bundle path. No `reinitializer` needed because zero is a valid gate state.

Storage gap reduced: `__gap[50]` → `__gap[49]` for the new slot. Layout stable.

## Test Evidence

```
Ran 1 test suite: 17 tests passed, 0 failed  (IssuerReputationRegistry.t.sol)
Ran 1 test suite:  9 tests passed, 0 failed  (TruePriceOracleC12.t.sol)
Regression:      142 tests passed, 0 failed  (all test/oracles/*)
```

Pre-existing failures in `test/TruePriceValidation.t.sol` (DonationAttackDetected vs. TruePriceFeeSurcharge) are AMM-side ordering issues unrelated to C12. Predate the C12 work and are tracked separately.

## Open Questions for R3

1. Does evidence-bundle + issuer-reputation close the Oracle Problem seam, or does a new attack surface open?
2. Is the penalty-only reputation model too conservative? (Alternative: reward-on-honest-issuance loop.)
3. Should StateRentVault integration land in C12 or C13?
4. Social slashing stub: right deferred default, or should C13 activate it?

## Reviewer Expectation

Per R2 verdict: primitive was assessed as under active adversarial hardening, not theoretical. C12 + C13 close the remaining known gaps. Post-R3, the sequencing plan is:

**C12 + C13 ship → formal verification (Certora/Halmos) → bug bounty → mainnet.**
