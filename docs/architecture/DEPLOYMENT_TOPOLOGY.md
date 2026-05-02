# Deployment Topology

> How the VibeSwap contracts compose at deploy time. Audience: auditors, partners, integrators.
>
> Last updated: 2026-05-01 (covers C39 / C42 / C45 / C46 / C47 / C48).

This is descriptive — it reflects what the shipped `script/Deploy*.s.sol` does today. For known gaps, see `docs/_meta/deploy-script-audit-2026-05-01.md`. For storage safety, see `docs/audits/2026-05-01-storage-layout-followup.md`.

---

## 1. Deployment order

Five staged scripts. Order is enforced by env-var dependencies (`vm.envAddress`), not by script-side orchestration.

| Stage | Script | Deploys | Exports |
|---|---|---|---|
| 1 — root substrate | `DeployTokenomics.s.sol` | `VIBEToken` (UUPS), `ShapleyDistributor` (UUPS), `EmissionController` (UUPS) | `VIBE_TOKEN`, `SHAPLEY_DISTRIBUTOR` |
| 2 — identity + trust | `DeployIdentity.s.sol` | `SoulboundIdentity` (UUPS), `AgentRegistry` (UUPS), `ContributionDAG` (ctor), `VibeCode` (ctor), `RewardLedger` (ctor), `ContributionAttestor` (ctor); ★ wires SBI→Attestor (C45) | `SOULBOUND_IDENTITY`, `CONTRIBUTION_DAG`, `CONTRIBUTION_ATTESTOR` |
| 3 — DEX core | `DeployProduction.s.sol` | `VibeAMM`/`Lite`, `CommitRevealAuction`, `CrossChainRouter` (UUPS) ★, `DAOTreasury`, `FeeRouter` + pipeline, `CircuitBreaker` (per child), `VibeSwapCore` (UUPS) | `VIBESWAP_CORE` |
| 4 — incentives | `DeployIncentives.s.sol` | `IncentiveController` (UUPS), `ILProtectionVault`, `LoyaltyRewardsManager`, `SlippageGuaranteeFund`, `VolatilityInsurancePool`, `LiquidityGauge`, `SingleStaking`, `PriorityRegistry` | — |
| 5 — compliance | `DeployCompliance.s.sol` | `FederatedConsensus`, `ClawbackVault` (UUPS), `ClawbackRegistry` (UUPS) ★, `ComplianceRegistry` | — |

Independent surfaces (consume Stage 1–3 exports, no order among themselves): `DeployAgents`, `DeployFinancial`, `DeployFinancialV2`, `DeployGovernance`, `DeploySettlement`, `DeploySIE`, `DeployVSOSKernel`, `DeployCoreSecurity`.

Post-deploy: `ConfigurePeers.s.sol` (LZ peers per chain), `GenesisContributions.s.sol` (founder contributions), `SetupMVP.s.sol` (testnet aggregator), `VerifyDeployment.s.sol` (read-only audit).

★ = stages with cross-reference wires that need post-deploy attention (§2 and §3).

---

## 2. Wiring — post-deploy `set*` calls

A clean deploy ≠ a live deploy. Several contracts ship with cross-references that must be wired after the fact, either because constructors can't reference not-yet-deployed addresses or because the wiring is intentionally separated to break a circular dependency.

| Wire | Where | Failure mode if not wired |
|---|---|---|
| `SoulboundIdentity.setContributionAttestor(attestor)` | `DeployIdentity` Step 6.5 (since C48) | `bindSourceLineage()` reverts with `LineageBindingDisabled` — C45 dead post-deploy |
| `CrossChainRouter.setPeer(remoteEid, remoteAddress)` per remote chain | `ConfigurePeers.s.sol` | Cross-chain orders silently dropped at remote LZ endpoint |
| `FeeRouter` recipient routes (LPs / DAOTreasury / etc.) | `DeployProduction._deployFeePipeline()` | Fees pile up unrouted; LP rewards stall |
| `ProtocolFeeAdapter.authorizeSource(feeContract)` per fee-emitting venue | per-venue, post-Stage-3 | Upstream venue can't forward fees |
| `CommitRevealAuction.setCore(VibeSwapCore)` | `DeployProduction` | Settlement aborts (auction can't dispatch fills to core) |
| `IncentiveController` registered on each reward child (`ILProtectionVault.setIncentiveController`, `LoyaltyRewardsManager.setIncentiveController`, `SlippageGuaranteeFund.setIncentiveController`, `VolatilityInsurancePool.setIncentiveController`) | `DeployIncentives` | Children stop receiving fee allocations and reward signals |
| `VibeAMM.setIncentiveController(...)` | `DeployIncentives` (or post-deploy) | LPs miss Shapley-weighted reward splits |
| `CircuitBreaker._initializeC39SecurityDefaults()` from each concrete child's reinitializer (VibeSwapCore, VibeAMM) | **NOT WIRED** — see §3 | C39 default-on attested-resume sits dormant on upgraded proxies (HIGH) |
| `ClawbackRegistry.initializeContestV1(...)` | **NOT INVOKED by Deploy script** (intentional fail-closed) — see §3 | C47 contest entry points revert with `ContestParamsNotInitialized`; clawback path itself still works |

Constructor-set wires (cannot be mis-wired): `ContributionAttestor → ContributionDAG`; `RewardLedger → (VIBEToken, ContributionDAG)`.

`script/VerifyDeployment.s.sol` is the canonical read-only post-deploy audit — walks the wiring graph and asserts each cross-reference resolves to a code-bearing address.

---

## 3. Reinitializer migrations

The codebase uses **storage append + `reinitializer(N)`** for all upgradeable post-launch additions. For each, the upgrade transaction MUST package the reinitializer call into `upgradeToAndCall(newImpl, abi.encodeCall(...))`. Otherwise the new storage stays zero-initialized and cycle behavior is silently disabled — or, in fail-closed designs, all entry points revert.

| Cycle | Contract | Reinitializer | Required `upgradeToAndCall` payload | Status |
|---|---|---|---|---|
| **C39** | `core/CircuitBreaker` (called from concrete child) | child wraps `_initializeC39SecurityDefaults()` in its own `reinitializer(N) initializeXxx()` | `abi.encodeCall(child.initializeXxx, ())` | **MISSING on VibeSwapCore + VibeAMM** (HIGH) |
| **C42** | `incentives/ShapleyDistributor` | `initializeC42Defaults() reinitializer(2)` | `abi.encodeCall(ShapleyDistributor.initializeC42Defaults, ())` | **`UpgradePostLaunch.s.sol` and `UpgradeShapleyABC.s.sol` ship bare `upgradeToAndCall(impl, "")`** — NatSpec violation (deploy audit §6) |
| **C45** | `identity/SoulboundIdentity` | `initializeV2(attestor) reinitializer(2)` | `abi.encodeCall(SoulboundIdentity.initializeV2, (attestorAddr))` | No upgrade script packages it; fresh deploys covered by `setContributionAttestor` in `DeployIdentity` Step 6.5 (C48) — both paths converge |
| **C46** | `identity/ContributionDAG` | N/A — non-upgradeable, fresh deploy per upgrade | — | New fields zero-init in constructor (the desired semantic for monotone counters) |
| **C47** | `compliance/ClawbackRegistry` | `initializeContestV1(bondToken, bondAmount, window, successReward) reinitializer(2)` | `abi.encodeCall(ClawbackRegistry.initializeContestV1, (token, amount, window, reward))` | Not invoked by `DeployCompliance.s.sol` (intentionally — fail-closed); owner runs separately |

**General rule for upgraders**: every `reinitializer(N)` claims a version slot. Skipping it leaves the slot open — a subsequent upgrade attempting `reinitializer(N)` for a different cycle could collide. Always package the reinitializer.

Pattern references: `docs/concepts/primitives/two-layer-migration-idempotency.md`, `docs/concepts/primitives/fail-closed-on-upgrade.md`.

---

## 4. Per-chain considerations

### LayerZero EIDs

Canonical constants in `script/ConfigurePeers.s.sol`:

| Chain | EID | | Chain | EID |
|---|---:|---|---|---:|
| Ethereum | 30101 | | Sepolia | 40161 |
| BSC | 30102 | | Arb Sepolia | 40231 |
| Avalanche | 30106 | | Base Sepolia | 40245 |
| Polygon | 30109 | | | |
| Arbitrum | 30110 | | | |
| Optimism | 30111 | | | |
| Base | 30184 | | | |

`CrossChainRouter.initialize(owner, lzEndpoint, auction, localEid)` requires `_localEid > 0`. The local EID comes from a chainId → EID resolver. At time of writing, `script/DeployProduction.s.sol` passes only 3 args, causing the initializer to revert (deploy audit §2 — BLOCKING). Fix shape: add `_getLocalEid(uint256 chainId)` mirroring `EID_*` constants.

### Native gas + WETH

Deploy scripts treat native gas abstractly — fees flow through `FeeRouter` in `address(0)` form for native and ERC-20 form for tokens. `_getWETH(chainId)` resolves wrapped-native per chain (env-overridable via `WETH_ADDRESS`; missing from `.env.example`, see deploy audit §7).

### Deployment vs initialization split

- **Concrete UUPS** (`SoulboundIdentity`, `AgentRegistry`, `VibeSwapCore`, ...): impl + `ERC1967Proxy(impl, initData)` in two broadcast actions.
- **Concrete non-upgradeable** (`ContributionDAG`, `VibeCode`, `RewardLedger`, `ContributionAttestor`): single `new Contract(args)` constructor call.
- **Abstract** (`CircuitBreaker`): never deployed standalone; lives only as parent of `VibeSwapCore` / `VibeAMM`.

---

## 5. Verification checklist

Run in order to confirm a healthy install. Most are mechanized in `script/VerifyDeployment.s.sol`.

**Code-presence**: `require(addr.code.length > 0)` for every deployed address. Built into each Deploy script's `_verify()`.

**Wiring (post-deploy)**:
- [ ] `SoulboundIdentity.contributionAttestor() == ContributionAttestor.address`
- [ ] `SoulboundIdentity.lineageBindingEnabled() == true`
- [ ] `CrossChainRouter.localEid() > 0` and matches the chain you deployed to
- [ ] `CrossChainRouter.peers(remoteEid)` set for every other deployed chain
- [ ] `FeeRouter.recipientShares()` sums to 10000 bps
- [ ] `IncentiveController` registered on every reward child
- [ ] `ContributionAttestor.dag() == ContributionDAG.address`
- [ ] `RewardLedger.token() == VIBEToken.address` and `RewardLedger.dag() == ContributionDAG.address`

**Cycle migrations (upgrade path only)**:
- [ ] On any pre-C39 proxy of `VibeSwapCore` / `VibeAMM`: child's `c39SecurityDefaultsInitialized() == true` post-upgrade (currently HIGH gap — child reinitializers don't exist)
- [ ] On any pre-C42 proxy of `ShapleyDistributor`: `keeperRevealDelay() != 0` post-upgrade
- [ ] On `SoulboundIdentity` upgrade: `initializeV2(attestor)` packaged in `upgradeToAndCall`
- [ ] On `ClawbackRegistry`: `initializeContestV1(...)` invoked exactly once (idempotent guard via `contestParamsInitialized`)

**Operational sanity**:
- [ ] `VibeSwapCore.paused() == false` (or expected staged-launch state)
- [ ] `CircuitBreaker.attestedResumeOverridden(LOSS_BREAKER) == false` (default-on engaged)
- [ ] `CircuitBreaker.attestedResumeOverridden(TRUE_PRICE_BREAKER) == false`
- [ ] `ContributionDAG.totalHandshakeAttempts()` is monotonically increasing after first vouch (sanity ping)

**Address book**: every Deploy script's `_outputSummary()` logs `KEY=0x...` lines for paste into `.env` (consumed by next stage's `vm.envAddress`). `MAINNET_DEPLOYMENT.md` updated with deployed addresses per chain.

---

## 6. Known deploy-script gaps (as of 2026-05-01)

Two BLOCKING bugs in `script/DeployProduction.s.sol` await design decisions:

1. `CrossChainRouter.initialize` 4-arg drift — script passes 3 args; initializer needs 4 (`_localEid`). Reverts at Stage 3.
2. `BuybackEngine` referenced but never deployed — verify step reverts because `buybackEngine == address(0)`. Either remove references (matches stated "no buyback, 100% to LPs" philosophy) or actually deploy.

Full audit and fix shapes: `docs/_meta/deploy-script-audit-2026-05-01.md`. The C45 wire (C48 sub-task 1) is patched in `script/DeployIdentity.s.sol` Step 6.5; other gaps remain open pending parent decision.

---

## Cross-references

- `script/Deploy*.s.sol`, `script/Upgrade*.s.sol`, `script/ConfigurePeers.s.sol`, `script/VerifyDeployment.s.sol`
- `docs/_meta/deploy-script-audit-2026-05-01.md` — known gaps and fix shapes
- `docs/audits/2026-05-01-storage-layout-followup.md` — storage-slot accounting per cycle
- `docs/developer/CONTRACTS_CATALOGUE.md` — per-contract API reference (refreshed for C39–C48 in C48)
- `script/MAINNET_DEPLOYMENT.md` — operational runbook
