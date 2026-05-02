# Deploy Script Consistency Audit — 2026-05-01

**Scope**: `script/Deploy*.s.sol` and `script/Configure*.s.sol` vs current contract API.
**Cycles in scope**: C39 (default-on attested-resume), C42 (keeper commit-reveal defaults), C45 (lineage binding), C47 (bonded permissionless contest), plus general constructor/`initialize()` drift since the ABI snapshot dated Feb 17.

**Verdict**: **NOT clean pass.** Two blocking breaks in `script/DeployProduction.s.sol` (guaranteed revert), one missing post-deploy wire in `script/DeployIdentity.s.sol`, and two upgrade-script NatSpec violations regarding C42. Fresh-deploy paths are otherwise consistent.

---

## 1. Entry-point map

| Script | Status | Comment |
|---|---|---|
| `script/Deploy.s.sol` | **DEPRECATED** (per its own header) | Uses `VibeAMMLite`. Header explicitly redirects to `DeployProduction.s.sol`. Constructor/init signatures still match `VibeAMMLite`/`DAOTreasury`/`CrossChainRouter` *except* `CrossChainRouter.initialize` (see #2 below). Not patched here because the file is sign-posted as deprecated; flagged for awareness. |
| `script/DeployProduction.s.sol` | **BROKEN** | See findings #2 and #3. |
| `script/DeployIdentity.s.sol` | **WIRE GAP** | See finding #4. |
| `script/DeployCompliance.s.sol` | OK with caveat | C47 contest path is fail-closed by design until owner runs `initializeContestV1`; this is a feature, not a bug. See finding #5. |
| `script/DeployTokenomics.s.sol` | OK | `ShapleyDistributor.initialize(owner)` matches; C42 defaults set in `initialize()` already. |
| `script/DeployIncentives.s.sol`, `DeployAgents.s.sol`, `DeploySettlement.s.sol`, `DeployFinancial*.s.sol`, `DeploySIE.s.sol`, `DeployVSOSKernel.s.sol`, `DeployGovernance.s.sol` | Not exhaustively audited | Outside the C39/C42/C45/C47 scope. Spot-checked: `initialize()` arity matches in scripts that touch the cycles above. |
| `script/UpgradePostLaunch.s.sol` | **VIOLATES C42 NatSpec** | See finding #6. |
| `script/UpgradeShapleyABC.s.sol` | **VIOLATES C42 NatSpec** | See finding #6. |
| `script/ConfigurePeers.s.sol` | OK | Reads only `ROUTER_*` env vars, no init args. |
| `script/VerifyDeployment.s.sol` | Not audited | Read-only — out of scope for break-finding. |

---

## 2. BLOCKING — `CrossChainRouter.initialize` arity mismatch

**File**: `script/DeployProduction.s.sol` lines 225–231.
**Also**: `script/Deploy.s.sol` lines 96–102 (deprecated).

The contract signature is:

```solidity
// contracts/messaging/CrossChainRouter.sol:304
function initialize(
    address _owner,
    address _lzEndpoint,
    address _auction,
    uint32  _localEid     // <-- required, > 0 enforced
) external initializer {
    ...
    require(_localEid > 0, "Invalid local eid");
    ...
    localEid = _localEid;  // TRP-R21-H01: Store LZ eid for chain identity
}
```

`DeployProduction.s.sol` passes only three args:

```solidity
bytes memory routerInit = abi.encodeWithSelector(
    CrossChainRouter.initialize.selector,
    owner,
    lzEndpoint,
    auction
);
```

**Impact**: The `initialize` call decodes into the 4-arg signature with `_localEid = 0` (truncated/missing slot) → `require(_localEid > 0)` reverts → ERC1967Proxy construction reverts → the entire `DeployProduction` script aborts at Step 3.

**Fresh deploy**: blocking.
**Upgrade**: N/A (initializer is one-shot).

**Fix shape** (NOT applied here — see "scope" note below):
- Add a chainId → LZ EID mapping helper in `DeployProduction.s.sol` mirroring the `EID_*` constants in `ConfigurePeers.s.sol`.
- Pass the resolved `_localEid` as the 4th arg.

---

## 3. BLOCKING — `BuybackEngine` referenced but never deployed

**File**: `script/DeployProduction.s.sol`.

Storage slot `address public buybackEngine;` is declared (line 50) and three downstream consumers reference it:

- Line 403: `require(buybackEngine.code.length > 0, "BuybackEngine has no code");`
- Line 439: `console.log("  BUYBACK_ENGINE=", buybackEngine);`
- Line 469: `console.log(string(abi.encodePacked("BUYBACK_ENGINE=", vm.toString(buybackEngine))));`

But `_deployFeePipeline()` (lines 269–297) does NOT instantiate it. The function comment even reads "Deploy BuybackEngine (swaps + burns via VibeAMM) // Wire up: Authorize ProtocolFeeAdapter as FeeRouter source" — the Deploy line was apparently dropped during a refactor while the verify check remained. `BuybackEngine`'s constructor takes `(address amm, address protocolToken, uint256 slippageBps, uint256 cooldown)` — non-trivial and dependent on the not-yet-deployed VIBE token, which is consistent with the surrounding posture ("100% to LPs, no buyback").

**Impact**: Even if finding #2 were fixed, `_verifyDeployment()` reverts at line 403 because `buybackEngine == address(0)` and `address(0).code.length == 0`. Whole script aborts post-deployment.

**Two valid fix shapes** (caller decides — not applied here):
1. Remove the `buybackEngine` references entirely (lines 50, 401–403, 437–439, 469). This matches the script's stated "no buyback, 100% to LPs" posture and is the correct fix if BuybackEngine is intentionally out of the production path for now.
2. Actually deploy `BuybackEngine` in `_deployFeePipeline()` (requires VIBE token address — would need to be passed or env-supplied).

Given the comment block at line 270 ("FeeRouter forwards 100% of swap fees to LPs… No buyback. No extraction."), option (1) is the correct fix and matches the in-line stated philosophy.

---

## 4. WIRE GAP — `SoulboundIdentity.setContributionAttestor` not called post-deploy

**File**: `script/DeployIdentity.s.sol`.

The script deploys `SoulboundIdentity` (Step 1) and `ContributionAttestor` (Step 6) but never wires them. Per `SoulboundIdentity.sol:222–227`, fresh deploys take this exact path:

```solidity
// C45 — lineage binding starts disabled. Owner wires the attestor and enables
// it via setContributionAttestor(). This avoids a circular dependency at deploy
// time (attestor and identity contract may be deployed in either order).
// Fresh deploys with no legacy proxies will simply call setContributionAttestor()
// post-deploy as part of the standard wire-up script.
lineageBindingEnabled = false;
```

The deploy script ends after Step 7 verify; nothing calls `setContributionAttestor`. Per the contract's own NatSpec on line 222–227 ("standard wire-up script"), this script is the standard wire-up script.

**Impact**: Until owner runs `SoulboundIdentity.setContributionAttestor(contributionAttestor)` manually, `bindSourceLineage()` reverts. C45 functionality is not live.

**Fresh deploy**: wire gap (functional break for C45).
**Upgrade**: covered by `initializeV2(attestor)` reinitializer — but no script packages it; same gap.

**Fix shape**: Add a Step 6.5 in `DeployIdentity.s.sol`:
```solidity
SoulboundIdentity(soulboundIdentity).setContributionAttestor(contributionAttestor);
```
right after `contributionAttestor` is deployed. This satisfies the C45 design.

Not applied here because it's outside the originally-flagged scope (`Deploy.s.sol` / `Configure*.s.sol`); flagging for parent decision.

---

## 5. NON-BLOCKING — C47 fail-closed posture in `DeployCompliance.s.sol`

`DeployCompliance.s.sol` calls `ClawbackRegistry.initialize(owner, federatedConsensus, 5, 1e15)` — the 4-arg `initializer` path. This zeroes the contest params (`contestBondToken`, `contestBondAmount`, `contestWindow`, `contestSuccessReward`) by default.

Per `ClawbackRegistry.initializeContestV1` NatSpec (lines 681–687):
> "Calling upgradeTo alone leaves contest params zeroed and contest entry functions revert with `ContestParamsNotInitialized` — fail-closed posture (security is no weaker than pre-upgrade, just unavailable until migration runs)."

This is by design for upgrades, but it also applies to fresh deploys: `openContest` reverts with `ContestParamsNotInitialized` until owner calls `initializeContestV1` manually. There's no break, just an additional manual step.

**Suggested**: Add a comment in `DeployCompliance.s.sol` explicitly noting "post-deploy: owner must call `ClawbackRegistry.initializeContestV1(bondToken, bondAmount, window, successReward)` to enable contest path" so a future deployer doesn't miss it. Or invoke it during deploy with sensible defaults if bond token is known. Not applied here — flagged.

---

## 6. UPGRADE NATSPEC VIOLATION — `upgradeToAndCall(impl, "")` does not package C42 reinitializer

**Files**:
- `script/UpgradePostLaunch.s.sol:98`
- `script/UpgradeShapleyABC.s.sol:79`

Both upgrade `ShapleyDistributor` via `upgradeToAndCall(newShapleyImpl, "")`.

Per `ShapleyDistributor.initializeC42Defaults` NatSpec (lines 518–524):
> "MUST be packaged into `upgradeToAndCall(newImpl, abi.encodeCall(initializeC42Defaults, ()))`."

The `MUST` is mitigated by:
1. `initialize()` already sets `keeperRevealThreshold = 1` and `keeperRevealDelay = DEFAULT_KEEPER_REVEAL_DELAY` for fresh deploys, so any pre-existing proxy that ran `initialize()` already has these values set non-zero.
2. `initializeC42Defaults` is itself idempotent (only writes when the slot is zero).
3. There is also a use-site floor in `revealNoveltyMultiplier` per the same NatSpec.

So the upgrade scripts are likely safe in practice for any proxy that was deployed via the v1 `initialize()`. But they violate the documented contract — and they will NOT claim the version-2 reinitializer slot, leaving it open. Same drift exists for VibeAMM/VibeSwapCore C39 and SoulboundIdentity C45 / ClawbackRegistry C47, but no upgrade script currently invokes them so there's no script-side violation to record.

**Suggested**: Replace each `upgradeToAndCall(newShapleyImpl, "")` with:
```solidity
ShapleyDistributor(payable(shapleyDistributor)).upgradeToAndCall(
    newShapleyImpl,
    abi.encodeCall(ShapleyDistributor.initializeC42Defaults, ())
);
```

Not applied here — outside the originally-flagged scope and impact is non-blocking due to the idempotent design.

---

## 7. ENV-VAR alignment with `.env.example`

Spot-checked the recently-expanded `.env.example` against `DeployProduction.s.sol`'s `vm.envOr` / `vm.envAddress` reads:

| Var | In `.env.example` | Read by `DeployProduction` | Status |
|---|---|---|---|
| `PRIVATE_KEY` | yes | `vm.envUint("PRIVATE_KEY")` | OK |
| `OWNER_ADDRESS` | yes | `vm.envOr("OWNER_ADDRESS", deployer)` | OK |
| `GUARDIAN_ADDRESS` | not in `.env.example` | `vm.envAddress("GUARDIAN_ADDRESS")` (mainnet) / `vm.envOr` (testnet) | **MISSING from `.env.example`** |
| `MULTISIG_ADDRESS` | yes | `vm.envAddress("MULTISIG_ADDRESS")` (mainnet) / `vm.envOr(... , address(0))` (testnet) | OK |
| `ORACLE_SIGNER` | not in `.env.example` | `vm.envAddress("ORACLE_SIGNER")` (mainnet) | **MISSING from `.env.example`** |
| `WETH_ADDRESS` | not in `.env.example` | `vm.envOr("WETH_ADDRESS", ...)` in `_getWETH()` | **MISSING from `.env.example`** (only consulted for testnets/local) |
| `ETHERSCAN_API_KEY` | yes | indirectly via `--verify` | OK |

Other Deploy*.s.sol scripts read `VIBE_TOKEN`, `VIBESWAP_CORE`, `CONTRIBUTION_DAG`, `EMISSION_CONTROLLER`, `SHAPLEY_DISTRIBUTOR`, `LIQUIDITY_GAUGE`, `SINGLE_STAKING`, `PRIORITY_REGISTRY`, `FRACTAL_SHAPLEY` — most of these are either in `.env.example` already or are written to the env post-deploy and consumed by later scripts, which matches the staged-deploy intent.

**Suggested follow-up** (not applied here — out of scope): Add `GUARDIAN_ADDRESS`, `ORACLE_SIGNER`, and `WETH_ADDRESS` to `.env.example`.

---

## 8. Summary table — by class

| # | Class | Script | Symptom |
|---|---|---|---|
| 2 | blocking | `DeployProduction.s.sol` | `CrossChainRouter.initialize` 4-arg drift → revert at Step 3 |
| 3 | blocking | `DeployProduction.s.sol` | `buybackEngine` referenced but not deployed → revert at `_verifyDeployment` |
| 4 | post-deploy-only | `DeployIdentity.s.sol` | `setContributionAttestor` never called → `bindSourceLineage` reverts |
| 5 | post-deploy-only | `DeployCompliance.s.sol` | `initializeContestV1` not invoked → C47 fail-closed (by design) |
| 6 | upgrade-only NatSpec | `UpgradePostLaunch.s.sol`, `UpgradeShapleyABC.s.sol` | Bare `upgradeToAndCall(impl, "")` doesn't package C42 reinit |
| 7 | env drift | `.env.example` | Missing `GUARDIAN_ADDRESS`, `ORACLE_SIGNER`, `WETH_ADDRESS` |

---

## 9. What was applied in this audit

**Nothing.** Per the task scope, only `script/` is in-scope for code edits, and the two blocking bugs in `DeployProduction.s.sol` (#2, #3) are intertwined: fixing #2 requires picking an LZ EID resolver pattern, fixing #3 requires deciding remove-vs-deploy for `BuybackEngine`. Both are non-trivial design calls that should be parent-reviewed rather than auto-patched. Patches sketched under each finding.

**Recommended next session**: ship a single `fix(deploy): align Deploy.s.sol with shipped reinitializers` commit that
- adds `_getLocalEid(uint256 chainId)` helper and threads it into `routerInit`,
- removes the `buybackEngine` references (option 1, matching the in-line "no buyback" stated philosophy),
- (optional) adds `setContributionAttestor` wire in `DeployIdentity.s.sol`.

End of audit.
