# Storage Layout Follow-Up Audit (C22 Successor)

**Date**: 2026-05-01
**Scope**: Post-C39 / C42 / C45 / C46 / C47 storage-layout sweep.
**Audit type**: Read-only static analysis. No tests run, no `.sol` changes.
**Author**: JARVIS (TRP cycle, parent assistant reviews and commits).
**Predecessor**: C22 (initial storage-collision scan; passed). This pass verifies that
the slot additions shipped between C22 and today preserved upgrade safety.

---

## Methodology

For each of the five contracts:

1. Read full storage layout (struct order, field types, mappings, gap).
2. Verify new slots are **appended at end** (not inserted mid-block).
3. Verify gap is **reduced by exactly the number of slots consumed** (mappings = 1, structs = sum of field slots, packed primitives = 1 per word).
4. Verify reinitializer-class migration is wired correctly:
   - Concrete child calls `_initializeC<N>...` from both `initialize()` (fresh deploy) and a `reinitializer(N)` (upgrade path), OR the contract is fresh-deploy-only.
5. Verify no slot collision against parent contracts. OZ v5.0.1 parents (`OwnableUpgradeable`, `ReentrancyGuardUpgradeable`, `UUPSUpgradeable`, `ERC721Upgradeable`) use ERC-7201 namespaced storage internally, so parent ↔ child collision is structurally impossible for OZ-inherited bases.
6. Verify mapping additions don't collide with previously-used computed-slot mappings. Solidity computes `mapping[k]` as `keccak256(k . slot)`, where `slot` is the declaration index. A new mapping at a fresh slot cannot collide with a mapping at an earlier slot (different `slot` = disjoint preimage class).

**Note on storage convention**: VibeSwap uses the **legacy linear storage with `__gap` arrays** convention, NOT ERC-7201 namespaced storage. This is consistent across all 5 contracts, deliberate, and not a finding. The audit prompt's "verify ERC-7201 namespaced storage convention is preserved" is reframed as "verify the linear-`__gap` convention is preserved consistently" — which it is.

---

## Per-Contract Analysis

### 1. CircuitBreaker (`contracts/core/CircuitBreaker.sol`)

**C39 changes**: +2 slots (`attestedResumeOverridden` mapping, `c39SecurityDefaultsInitialized` bool).
**Pre-C39 gap**: 44 (after C43 consumed 6 from the original 50). **Post-C39 gap**: 42.

**Storage block (C43 + C39 region, lines 73-145)**:
| # | Slot | Type | Notes |
|---|------|------|-------|
| C43 | requiresAttestedResume | mapping(bytes32 => bool) | pre-existing C43 |
| C43 | certifiedAttestor | mapping(address => bool) | pre-existing C43 |
| C43 | resumeAttestationThreshold | uint256 | pre-existing C43 |
| C43 | resumeAttestationCount | mapping(bytes32 => uint256) | pre-existing C43 |
| C43 | tripGeneration | mapping(bytes32 => uint256) | pre-existing C43 |
| C43 | _hasAttestedResume | mapping(bytes32 => mapping(uint256 => mapping(address => bool))) | pre-existing C43 |
| **C39** | **attestedResumeOverridden** | **mapping(bytes32 => bool)** | **NEW** — appended after C43 region |
| **C39** | **c39SecurityDefaultsInitialized** | **bool** | **NEW** — appended after C43 region |
| - | __gap | uint256[42] | reduced from 44 |

- Append-at-end: ✅ — new slots are after all C43 slots and before `__gap`.
- Gap math: 50 (original) − 6 (C43) − 2 (C39) = 42. ✅
- Parent collision: parent is `OwnableUpgradeable` (OZ v5, ERC-7201 namespaced). No collision possible.

**🔴 HIGH: C39 migration is dead code on existing inheritors.**

`_initializeC39SecurityDefaults()` (CircuitBreaker line 447) is the gated migration that pins overrides on in-flight tripped security breakers so a pre-C39 proxy with an active LOSS_BREAKER or TRUE_PRICE_BREAKER trip continues on its original wall-clock semantics. The doc comment (lines 134-135) explicitly states:

> Concrete inheritors MUST call `_initializeC39SecurityDefaults()` from their own initializer (fresh deploy) and from a `reinitializer(N)` (upgrade path) to claim this slot.

Grepping the inheritors reveals **neither concrete child calls it**:

- `VibeSwapCore.initialize()` (line 426): does not call `_initializeC39SecurityDefaults()`. No `reinitializer(N)` exists in the file.
- `VibeAMM.initialize()` (line 439): does not call `_initializeC39SecurityDefaults()`. No `reinitializer(N)` exists in the file.

Consequences:
- On **fresh deploys**, no harm — no breaker is in-flight at deploy time, so the migration would no-op anyway. C39 default-on classification engages immediately for new trips. ✅
- On **upgrade-path deploys from a pre-C39 proxy**, the documented hazard fires:
  - `c39SecurityDefaultsInitialized` stays `false` forever.
  - Any LOSS_BREAKER or TRUE_PRICE_BREAKER currently tripped at upgrade time gets its semantic flipped from wall-clock auto-resume → attested-resume-required at the next `_isAttestedResumeRequired` read (because `attestedResumeOverridden[bType] == false` ⇒ falls through to `_isSecurityLoadBearing(bType) == true`).
  - The trip stays pinned past cooldown until M certified attestors arrive — but on a freshly-upgraded proxy, the certified-attestor set may not be provisioned yet ⇒ liveness lock until governance acts.

**Severity rationale**: HIGH because (a) it directly contradicts the explicit pre-condition in the contract's own NatSpec, (b) the impact is liveness-lock on a real protected breaker during the most security-critical window (post-upgrade), and (c) the fix is small and well-defined (add a `reinitializer(N)` to each child that calls `_initializeC39SecurityDefaults()`).

**Mitigation if not upgrading from pre-C39**: if VibeSwapCore and VibeAMM proxies have never been deployed in production yet (or are always deployed fresh, not upgraded), the impact is zero. Confirm deploy posture before promoting severity to MEDIUM. **This audit assumes the upgrade path is live because the pattern is shipped and documented.**

---

### 2. ShapleyDistributor (`contracts/incentives/ShapleyDistributor.sol`)

**C42 changes**: +9 slots (commit-reveal keeper machinery).
**Pre-C42 gap**: 49 (after `gameQualityWeights` consumed 1 from the original 50).
**Post-C42 gap**: 40.

**Storage block (C42 region, lines 337-378)**:
| # | Slot | Type |
|---|------|------|
| 1 | keeperCommitment | mapping(bytes32 => mapping(address => mapping(address => bytes32))) |
| 2 | keeperCommitTime | mapping(bytes32 => mapping(address => mapping(address => uint256))) |
| 3 | revealRound | mapping(bytes32 => mapping(address => uint256)) |
| 4 | _keeperRevealedValue | mapping(bytes32 => bool) |
| 5 | _revealCountByValue | mapping(bytes32 => uint256) |
| 6 | certifiedKeeper | mapping(address => bool) |
| 7 | keeperRevealThreshold | uint256 |
| 8 | keeperRevealDelay | uint256 |
| 9 | ownerSetterDisabled | bool |
| - | __gap | uint256[40] (reduced from 49) |

- Append-at-end: ✅ — new C42 slots appended after the C41 / pre-existing region, before `__gap`.
- Gap math: 50 − 1 (gameQualityWeights from earlier audit) − 9 (C42) = 40. ✅
- Parent collision: parents `OwnableUpgradeable`, `UUPSUpgradeable`, `ReentrancyGuardUpgradeable` are all ERC-7201 namespaced. No collision possible.
- Mapping-key collision: each new mapping is at a fresh declaration slot, so its `keccak256(k . slot)` preimage class is disjoint from every prior mapping. ✅

**🟡 MEDIUM: No `reinitializer(N)` for C42 — `keeperRevealDelay` defaults to 0 on upgraded proxies.**

`ShapleyDistributor.initialize()` (line 492) sets the C42 defaults inline:
```solidity
keeperRevealThreshold = 1;
keeperRevealDelay = DEFAULT_KEEPER_REVEAL_DELAY;  // 1 hour
```

But **`initialize()` is gated by `initializer` modifier and runs only once on fresh deploy.** On an upgrade from a pre-C42 proxy, the new C42 storage slots stay zero-initialized. There is no `reinitializer(N)` migration to set them.

The contract handles `keeperRevealThreshold == 0` defensively — line 1821 floors it to 1 at use-site:
```solidity
uint256 m = keeperRevealThreshold == 0 ? 1 : keeperRevealThreshold;
```

But **`keeperRevealDelay == 0` has no use-site floor.** Line 1792:
```solidity
if (block.timestamp < commitTime + keeperRevealDelay) revert RevealTooEarly();
```

When `keeperRevealDelay == 0`, a keeper can `commitNoveltyMultiplier` and `revealNoveltyMultiplier` in the **same block**. The whole point of the commit-reveal scheme — preventing a keeper from observing other reveals or post-allocation outcomes and racing a counter-commit (line 369-372 NatSpec) — collapses for the window between proxy upgrade and the first governance call to `setKeeperRevealDelay(...)`.

**Concrete attack scenario**:
1. Governance upgrades a pre-C42 proxy to the new ShapleyDistributor implementation. No reinitializer is packaged (no path exists).
2. `keeperRevealDelay = 0`, `keeperRevealThreshold = 0` (use-site floored to 1).
3. A single certified keeper (trivial because threshold=1 floor) submits a commit and a reveal in the same transaction-block, observes any other keeper's commit → reveal flow, and front-runs the agreed multiplier. The "M-of-N consensus over the similarity score" property is bypassed until governance manually sets a non-zero delay.

**Mitigation paths**:
1. Add a `reinitializer(2) initializeV2()` that sets `keeperRevealThreshold = 1` and `keeperRevealDelay = DEFAULT_KEEPER_REVEAL_DELAY`, packaged into `upgradeToAndCall`. Mirrors the SoulboundIdentity / ClawbackRegistry / JarvisComputeVault / JULBridge pattern already in this codebase.
2. Or add a use-site floor: `uint256 d = keeperRevealDelay == 0 ? DEFAULT_KEEPER_REVEAL_DELAY : keeperRevealDelay;` — same shape as the existing `keeperRevealThreshold == 0 ? 1` floor. Lower-touch fix.

**Severity rationale**: MEDIUM (not HIGH) because (a) `disableOwnerSetter()` defaults to false, so the legacy owner-only setter remains live and the keeper path is opt-in / dormant on a pre-C42 proxy; the failure mode only fires once governance starts operating the keeper path post-upgrade. (b) The fix is tiny. But the lack of a reinitializer is inconsistent with the post-upgrade-initialization-gate primitive that the rest of the codebase (SoulboundIdentity, ClawbackRegistry, JarvisComputeVault, JULBridge) follows — calling it out as MEDIUM reflects that policy gap.

---

### 3. SoulboundIdentity (`contracts/identity/SoulboundIdentity.sol`)

**C45 changes**: +4 slots (source-lineage binding).
**Pre-C45 gap**: 50. **Post-C45 gap**: 46.

**Storage block (C45 region, lines 131-146)**:
| # | Slot | Type |
|---|------|------|
| 1 | contributionAttestor | address |
| 2 | tokenLineageHash | mapping(uint256 => bytes32) |
| 3 | tokenLineageClaimId | mapping(uint256 => bytes32) |
| 4 | lineageBindingEnabled | bool |
| - | __gap | uint256[46] (reduced from 50) |

- Append-at-end: ✅ — new C45 slots after all pre-existing identity / recovery state, before `__gap`.
- Gap math: 50 − 4 = 46. ✅
- Parent collision: parents `ERC721Upgradeable`, `OwnableUpgradeable`, `UUPSUpgradeable` are all ERC-7201 namespaced. No collision possible.

**Reinitializer wiring**: ✅ correct.

`initializeV2(address _contributionAttestor) external reinitializer(2) onlyOwner` (line 241):
- Idempotent guard: `if (lineageBindingEnabled) return;` (handles fresh-deploy-already-set case).
- Wires `contributionAttestor` and sets `lineageBindingEnabled = true`.
- Comment at line 234-238 explicitly documents the `upgradeToAndCall(newImpl, abi.encodeCall(initializeV2, (...)))` packaging requirement.
- Fail-closed posture: if `upgradeTo` runs alone, `bindSourceLineage()` reverts with `LineageBindingDisabled` — security is no weaker than pre-upgrade, just unavailable until migration runs.

**INFO**: `setContributionAttestor()` (line 264) provides a fresh-deploy path that ALSO sets `lineageBindingEnabled = true` on first non-zero attestor wire-up. This is intentional — the comment at line 220-225 documents that fresh deploys wire the attestor post-deploy via `setContributionAttestor` (because the attestor and identity contracts have a circular dependency at deploy time). Both paths converge on the same end state. ✅

**INFO (addendum, in-tree change)**: At audit time, `git diff` showed an uncommitted SoulboundIdentity edit from a parallel agent that adds `ReentrancyGuardUpgradeable` to the inheritance list and adds `nonReentrant` to `mintIdentity`. **This is storage-safe**: OZ v5 `ReentrancyGuardUpgradeable` uses ERC-7201 namespaced storage (`ReentrancyGuardStorageLocation = 0x9b779b1...0becc55f00`), so adding it to the parent chain does NOT shift any sequential storage slot in the child. The C45 storage block, gap, and reinitializer wiring all remain valid post-merge. No re-audit required for storage-layout purposes — the parent assistant should still review for non-storage concerns (init order, modifier interaction with `_safeMint`, etc.).

---

### 4. ContributionDAG (`contracts/identity/ContributionDAG.sol`)

**C46 changes**: +4 slots (handshake cooldown observability).
**Status**: **NON-UPGRADEABLE** — different upgrade-safety rules apply.

```solidity
contract ContributionDAG is IContributionDAG, Ownable, ReentrancyGuard {
```

No `Initializable`, no `UUPSUpgradeable`, no `__gap`, constructor-based initialization (line 172). This is a deliberate design choice (line 27 NatSpec: "Non-upgradeable. Gas-bounded BFS: MAX_TRUST_HOPS = 6.")

**Storage block (C46 region, lines 154-168)**:
| # | Slot | Type |
|---|------|------|
| 1 | totalHandshakeAttempts | uint256 |
| 2 | totalHandshakeSuccesses | uint256 |
| 3 | totalHandshakesBlockedByCooldown | uint256 |
| 4 | lastHandshakeAt | mapping(bytes32 => uint256) |

- Append-at-end: ✅ — new C46 slots appended after `nextFounderChangeId`, before the constructor.
- Gap math: N/A (no gap, contract is non-upgradeable).
- Reinitializer: N/A. Non-upgradeable contracts get a fresh deploy per upgrade. The new fields zero-initialize in the constructor, which is the desired semantic for monotone counters.
- Parent collision: parents `Ownable`, `ReentrancyGuard` are NON-upgradeable OZ contracts. They DO use sequential storage (no ERC-7201). However, since this contract is non-upgradeable, there is no proxy delegating to a new implementation that could mismatch a child's expected slot — every deploy is a fresh storage pad. ✅

**INFO**: Because the contract is non-upgradeable, the prompt's "verify (a) appended (b) gap reduced (c) reinitializer called appropriately" criteria collapse to "appended at end" only (which holds). No upgrade-safety surface to audit.

---

### 5. ClawbackRegistry (`contracts/compliance/ClawbackRegistry.sol`)

**C47 changes**: +9 slots (bonded permissionless contest).
**Pre-C47 gap**: 50. **Post-C47 gap**: 41.

**Storage block (C47 region, lines 169-206)**:
| # | Slot | Type |
|---|------|------|
| 1 | caseContests | mapping(bytes32 => CaseContest) |
| 2 | contestBondToken | address |
| 3 | contestBondAmount | uint256 |
| 4 | contestWindow | uint64 (uses 1 slot, not packed with anything else — preceded by uint256, followed by uint256) |
| 5 | contestSuccessReward | uint256 |
| 6 | contestRewardPool | uint256 |
| 7 | contestParamsInitialized | bool |
| - | __gap | uint256[41] (reduced from 50) |

Wait — the doc comment at line 209-215 lists the breakdown as 9 slots:
```
+caseContests (1)
+contestBondToken (1) + contestBondAmount (1)
+contestWindow (1) + contestSuccessReward (1)
+contestRewardPool (1) + contestParamsInitialized (1)
Total consumed: 9 slots.
```

That's `1 + 2 + 2 + 2 + 1 = 8` enumerated, but the comment says 9. Let me recount the actual declarations between the `// ============ C47:` header and the `__gap` line:

1. enum `ContestStatus` — type-only, **0 slots**
2. struct `CaseContest` — type-only, **0 slots**
3. `mapping(bytes32 => CaseContest) public caseContests;` — 1 slot
4. `address public contestBondToken;` — 1 slot
5. `uint256 public contestBondAmount;` — 1 slot
6. `uint256 public constant MIN_CONTEST_BOND` — constant, **0 slots**
7. `uint64 public contestWindow;` — 1 slot (occupies its own word; not packed with adjacent state because adjacent state is uint256)
8. `uint64 public constant MIN_CONTEST_WINDOW` — constant, **0 slots**
9. `uint64 public constant MAX_CONTEST_WINDOW` — constant, **0 slots**
10. `uint256 public contestSuccessReward;` — 1 slot
11. `uint256 public contestRewardPool;` — 1 slot
12. `bool public contestParamsInitialized;` — 1 slot

Total mutable state slots: **8**, not 9. The doc-comment count of 9 is **off-by-one**.

**🟢 LOW: Doc-comment slot accounting is off-by-one. Gap is one slot LARGER than the doc claims, not smaller.**

`50 − 8 = 42` would be the math-correct gap. The contract declares `uint256[41]`. The contract is **safe** (over-shrinking the gap is conservative — no upgrade-collision risk), but:

- The doc comment at line 209-215 mis-counts the consumed slots (claims 9, actually 8).
- The `__gap` size of 41 reflects the doc-comment's count (which is one too many).
- An auditor who trusts the doc comment will compute "gap should be 41" and confirm. An auditor who counts the slots will compute "gap should be 42". The discrepancy is invisible because both happen to be safe (and both are off-by-one in the same direction).

**Impact**: zero functional, zero security. The contract has one fewer reserved slot for future upgrades than the canonical 50-slot convention would give, but still has 41 slots of headroom. The doc is wrong in its count. Recommend reconciling the doc to either say "8 slots consumed → 42 remain" (and updating `uint256[41] → uint256[42]`) OR "9 slots consumed → 41 remain (note: contestWindow is uint64 but allocated its own word due to adjacent uint256 state, counted conservatively)".

**Reinitializer wiring**: ✅ correct.

`initializeContestV1(...) external reinitializer(2) onlyOwner` (line 687):
- Validates inputs (`MIN_CONTEST_BOND` floor, window range, non-zero bond token).
- Sets all 6 mutable contest-param slots.
- Idempotent guard: `if (contestParamsInitialized) revert ContestAlreadyInitialized();`.
- Comment at lines 671-678 explicitly documents the `upgradeToAndCall(newImpl, abi.encodeCall(initializeContestV1, (...)))` packaging requirement.
- Fail-closed posture: if `upgradeTo` runs alone, all contest entry points (`openContest`, `upholdContest`, `dismissContest`, etc.) revert with `ContestParamsNotInitialized`. Existing clawback paths continue to function.

This is the gold-standard pattern in this codebase. ✅

- Parent collision: parents `OwnableUpgradeable`, `ReentrancyGuardUpgradeable`, `UUPSUpgradeable` are all ERC-7201 namespaced. No collision possible.

---

## Cross-Cutting Verification

### Mapping-key collision check

For each new mapping added across all 5 contracts, verify no preimage collision with previously-used computed slots:

| Contract | New Mapping | Slot Index | Collision Risk |
|----------|-------------|-----------:|----------------|
| CircuitBreaker | `attestedResumeOverridden` | end-of-pre-gap | None — fresh slot, disjoint keccak preimage class |
| ShapleyDistributor | `keeperCommitment` | end-of-pre-gap | None |
| ShapleyDistributor | `keeperCommitTime` | end-of-pre-gap+1 | None |
| ShapleyDistributor | `revealRound` | end-of-pre-gap+2 | None |
| ShapleyDistributor | `_keeperRevealedValue` | end-of-pre-gap+3 | None |
| ShapleyDistributor | `_revealCountByValue` | end-of-pre-gap+4 | None |
| ShapleyDistributor | `certifiedKeeper` | end-of-pre-gap+5 | None |
| SoulboundIdentity | `tokenLineageHash` | end-of-pre-gap+1 | None |
| SoulboundIdentity | `tokenLineageClaimId` | end-of-pre-gap+2 | None |
| ContributionDAG | `lastHandshakeAt` | end-of-state | None — non-upgradeable, fresh deploy |
| ClawbackRegistry | `caseContests` | end-of-pre-gap | None |

All new mappings live at fresh declaration slots. Solidity's storage layout makes preimage collision between mappings at distinct declaration slots structurally impossible (different `slot` operand to `keccak256(k . slot)`).

### Parent-storage collision check

OZ v5.0.1 `*Upgradeable` parents (`OwnableUpgradeable`, `ReentrancyGuardUpgradeable`, `UUPSUpgradeable`, `ERC721Upgradeable`, `Initializable`) all use ERC-7201 namespaced storage (`bytes32 private constant <Name>StorageLocation = keccak256(...)` pattern). Their state lives in pseudorandom slots derived from a namespace string, not in sequential slots 0..N. Therefore:

- A child contract using sequential storage (legacy `__gap` convention) cannot collide with any OZ parent's namespaced slot.
- A child contract using ERC-7201 namespaced storage with a different namespace string cannot collide with any other ERC-7201 storage.

VibeSwap children all use the legacy convention, OZ parents all use ERC-7201 → parent ↔ child collision is structurally impossible across the whole audit set. ✅

---

## Summary

| Contract | New Slots | Gap Before | Gap After | Append OK | Gap Math | Reinitializer | Collision Risk |
|----------|----------:|-----------:|----------:|:---------:|:--------:|:-------------:|:--------------:|
| CircuitBreaker | 2 (C39) | 44 | 42 | ✅ | ✅ | ❌ **HIGH** — child contracts never call `_initializeC39SecurityDefaults()` | None |
| ShapleyDistributor | 9 (C42) | 49 | 40 | ✅ | ✅ | ❌ **MED** — no `reinitializer(N)` for C42; `keeperRevealDelay = 0` on upgraded proxies | None |
| SoulboundIdentity | 4 (C45) | 50 | 46 | ✅ | ✅ | ✅ `initializeV2 reinitializer(2)` correct | None |
| ContributionDAG | 4 (C46) | N/A | N/A | ✅ | N/A (non-upgradeable) | N/A | None |
| ClawbackRegistry | 8 actual / 9 claimed (C47) | 50 | 41 | ✅ | ⚠ **LOW** — doc comment off-by-one (claims 9, actual 8) | ✅ `initializeContestV1 reinitializer(2)` correct | None |

**Findings count**:
- HIGH: 1 (CircuitBreaker C39 migration is dead code on inheritors)
- MEDIUM: 1 (ShapleyDistributor C42 has no reinitializer; `keeperRevealDelay` defaults to 0 on upgrade)
- LOW: 1 (ClawbackRegistry doc-comment slot accounting is off-by-one; gap is mathematically conservative, no functional impact)
- INFO: 1 (SoulboundIdentity dual-path attestor wire-up between `setContributionAttestor` fresh-deploy and `initializeV2` upgrade-path is intentional and converges)

**Storage-layout safety**: NO storage-collision risk on any of the 5 contracts. Append-at-end discipline is preserved. Gap math is correct (modulo the LOW doc discrepancy). Parent ↔ child collision is structurally impossible due to OZ v5 ERC-7201 namespacing in parents.

**Upgrade safety on existing proxies**: AT RISK on CircuitBreaker (HIGH) and ShapleyDistributor (MEDIUM) due to missing `reinitializer(N)` migrations. SoulboundIdentity and ClawbackRegistry follow the gold-standard pattern.

---

## Recommended Follow-Ups (NOT included in this audit; would need a separate fix-cycle)

1. **C39-F1** (HIGH, fix CircuitBreaker child wiring): Add a `reinitializer(N)` to both `VibeSwapCore` and `VibeAMM` that calls `_initializeC39SecurityDefaults()` and is packaged into the next `upgradeToAndCall`. Alternatively, also call `_initializeC39SecurityDefaults()` inside the existing `initialize()` functions to cover the fresh-deploy path (currently safe but inconsistent with the contract's own NatSpec).

2. **C42-F1** (MEDIUM, fix ShapleyDistributor upgrade safety): Add `initializeV2() external reinitializer(2) onlyOwner` that sets `keeperRevealThreshold = 1` and `keeperRevealDelay = DEFAULT_KEEPER_REVEAL_DELAY`. Or, lower-touch: floor `keeperRevealDelay` at use-site like `keeperRevealThreshold` already is, e.g. `uint256 d = keeperRevealDelay == 0 ? DEFAULT_KEEPER_REVEAL_DELAY : keeperRevealDelay;`.

3. **C47-F1** (LOW, doc reconciliation): Reconcile the slot count in ClawbackRegistry's `__gap` comment (lines 209-215) to match the actual 8-slot consumption. Either expand `__gap` to `uint256[42]` (recover the conservative 1 slot) and update the comment to "8 consumed", or update the comment to explain why 9 was chosen (e.g., "reserved 1 for future packing of `contestWindow` with an adjacent uint64").

---

## Suggested Commit Message

```
docs(audit): C22-F1 — storage layout follow-up audit (post-C39/C42/C45/C46/C47 sweep)

C22 was the original storage-collision scan. Since then, multiple C-cycles
shipped new storage slots via reinitializer pattern: C39 (CircuitBreaker, +2
slots), C42 (ShapleyDistributor, +9 slots), C45 (SoulboundIdentity, +4 slots),
C46 (ContributionDAG, +4 slots, non-upgradeable), C47 (ClawbackRegistry,
+8 slots actual / +9 slots claimed-by-doc).

This audit verifies: (a) all new slots are appended at end; (b) all gaps are
reduced by the correct amount; (c) reinitializer wiring is correct; (d) no
parent-child storage collisions; (e) no mapping preimage collisions.

Findings:
- HIGH (1): CircuitBreaker C39 migration is dead code — neither VibeSwapCore
  nor VibeAMM (the concrete inheritors) calls `_initializeC39SecurityDefaults()`.
  On a pre-C39 proxy upgrade with an in-flight LOSS_BREAKER or TRUE_PRICE_BREAKER
  trip, the breaker's auto-resume semantic flips mid-trip from wall-clock to
  attested-resume-required, pinning the trip until M attestors arrive.
- MED (1): ShapleyDistributor C42 has no `reinitializer(N)` migration. On
  upgrade-from-pre-C42-proxy, `keeperRevealDelay = 0` until governance manually
  sets it, defeating the commit-reveal anti-frontrunning property.
- LOW (1): ClawbackRegistry C47 doc-comment claims 9 slots consumed, actually 8.
  Gap of 41 is mathematically conservative; no functional impact, just a doc fix.
- INFO (1): SoulboundIdentity dual-path wire-up is intentional and correct.

No storage-collision risk on any of the 5 contracts. SoulboundIdentity and
ClawbackRegistry follow the gold-standard reinitializer pattern. The two
upgrade-safety findings (HIGH + MED) need follow-up fix cycles (C39-F1, C42-F1).

Audit report: docs/audits/2026-05-01-storage-layout-followup.md
```
