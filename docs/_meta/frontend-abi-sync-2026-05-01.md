# Frontend ABI Sync Status — 2026-05-01

**Scope**: `frontend/src/abis/*.json` vs current contract API after C39/C42/C45/C47/C48 cycles.
**Verdict**: **STALE — full regeneration recommended.** All embedded ABIs date from Feb 17 2026 (`VibeAMM.json`/`VibeSwapCore.json` from Jan 31). No C39/C42/C45/C47 functions are present in any embedded ABI. Several contracts that the contract layer now ships are missing from the frontend bundle entirely.

This report is reconnaissance only. No regeneration was performed.

---

## 1. ABI directory inventory

```
frontend/src/abis/
├── CommitRevealAuction.json    33502 bytes  Feb 17
├── CrossChainRouter.json       22508 bytes  Feb 17
├── DAOTreasury.json            21002 bytes  Feb 17
├── ILProtectionVault.json      20100 bytes  Feb 17
├── ShapleyDistributor.json     33462 bytes  Feb 17
├── SlippageGuaranteeFund.json  19486 bytes  Feb 17
├── SoulboundIdentity.json      39991 bytes  Feb 17
├── VibeAMM.json                 5559 bytes  Jan 31    <-- tiny, basic AMM only
├── VibeSwapCore.json            4461 bytes  Jan 31    <-- tiny, basic core only
└── WalletRecovery.json         31420 bytes  Feb 17
```

Frontend imports them via `frontend/src/hooks/useContracts.jsx` (10 imports, see lines 6–15).

---

## 2. Missing-function scan

Searched each affected ABI for new selectors introduced by C39/C42/C45/C47:

| Contract | Function | Cycle | Present in ABI? |
|---|---|---|---|
| `VibeAMM` | `initializeC39Migration()` | C39 | NO |
| `VibeSwapCore` | `initializeC39Migration()` | C39 | NO (file is only 4.5KB — basic stub) |
| `ShapleyDistributor` | `initializeC42Defaults()` | C42 | NO |
| `ShapleyDistributor` | `commitNoveltyMultiplier(...)` | C42 | NO |
| `ShapleyDistributor` | `revealNoveltyMultiplier(...)` | C42 | NO |
| `SoulboundIdentity` | `initializeV2(address)` | C45 | NO |
| `SoulboundIdentity` | `bindSourceLineage(...)` | C45 | NO |
| `SoulboundIdentity` | `setContributionAttestor(address)` | C45 | NO |
| `ClawbackRegistry` | `initializeContestV1(...)` | C47 | N/A — no `ClawbackRegistry.json` in frontend bundle |
| `ClawbackRegistry` | `openContest(...)` | C47 | N/A — same |
| `ContributionDAG` | `tryAddVouch(...)` | (recent) | N/A — no `ContributionDAG.json` in frontend bundle |

`grep -r commitNoveltyMultiplier|bindSourceLineage|tryAddVouch|openContest|ContributionAttestor` across `frontend/src/` returned zero hits. The frontend has not been wired to consume any of the C39/C42/C45/C47/C48 surfaces yet, so the staleness is not currently breaking demo flows — but any new feature that depends on these functions will fail at the `ethers.Contract` interface boundary.

---

## 3. Missing contracts entirely

The frontend bundle has **no ABI** for these post-Feb contracts that ship in `contracts/`:

| Contract | Path | Likely needed by |
|---|---|---|
| `ClawbackRegistry` | `contracts/compliance/ClawbackRegistry.sol` | `frontend/src/hooks/useClawback.jsx` (which exists but currently has no live ABI binding) |
| `ContributionAttestor` | `contracts/identity/ContributionAttestor.sol` | C45 lineage UI |
| `ContributionDAG` | `contracts/identity/ContributionDAG.sol` | vouch/handshake UI |
| `FeeRouter`, `ProtocolFeeAdapter`, `BuybackEngine` | `contracts/core/...` | fee dashboard, treasury views |
| `FederatedConsensus`, `ClawbackVault`, `ComplianceRegistry` | `contracts/compliance/` | compliance/clawback UI |
| `ShapleyVerifier`, `BatchProver` | `contracts/settlement/` | settlement dashboards |
| `FractalShapley`, `EmissionController`, `LiquidityGauge`, `SingleStaking`, `PriorityRegistry`, `LoyaltyRewardsManager`, `VolatilityInsurancePool` | `contracts/incentives/` | rewards/incentives UI |
| `VIBEToken`, `VibeStable` | `contracts/monetary/` | token operations |
| `TruePriceOracle`, `StablecoinFlowRegistry` | `contracts/oracles/` | oracle status |

Frontend code references several of these names in component logic (`useClawback.jsx`, `ShapleyPage.jsx`, `RoadmapPage.jsx`), so the components exist but are running on stale or absent ABI bindings.

---

## 4. Suspicious size — `VibeAMM.json` and `VibeSwapCore.json`

- `VibeAMM.json` is **5559 bytes** containing only `createPool`, `addLiquidity`, `removeLiquidity`, `getPool`, `getPoolId`, `quote`, `getSpotPrice`, `getLPToken`, plus `PoolCreated`/`LiquidityAdded` events. This looks like an early hand-crafted ABI rather than a full Foundry-out artifact. The full `VibeAMM` contract is ~2000 LOC with ~150 functions including TWAP, security flags, fee routing, circuit-breaker integration — none of which are reflected.
- `VibeSwapCore.json` is **4461 bytes** — same shape, hand-curated subset.

These two are the highest-priority regenerations.

---

## 5. Recommended sync action

This is a recon report; no regeneration happened. Suggested action chain (parent decides):

1. **One-shot regen** of all 10 existing ABIs from Foundry `out/` using the default profile (no via-IR), then drop into `frontend/src/abis/` overwriting in place. This catches C39/C42/C45.
2. **Add new ABI files** for the missing contracts listed in §3, prioritized by which UI surfaces are blocked. Minimum set to unblock current `useClawback.jsx`/`ShapleyPage.jsx`: `ClawbackRegistry`, `ContributionAttestor`, `ContributionDAG`, `FeeRouter`. Defer the rest until a UI consumer lands.
3. **Verify** that `useContracts.jsx` `ABI_REGISTRY` and `CONTRACTS` address map (in `frontend/src/utils/constants.js`) include matching keys for any newly added ABI — adding an ABI without an address slot wires nothing.
4. **CI hygiene**: consider adding a script check that ABI mtime is not older than the corresponding `contracts/...sol` mtime, or generate ABIs in CI on push.

**Do NOT** ship a partial regen; mixed-vintage ABIs make later debugging harder than a clean full rebuild.

---

## 6. Risk classification

| Risk | Severity | Reason |
|---|---|---|
| Existing demo/swap flows | LOW | The 10 existing ABIs cover the basic happy path; their staleness is on new functions, not removed ones. |
| New feature wire-up (C39/C42/C45/C47) | HIGH | Any frontend code calling new selectors fails at `Contract.method` resolution. |
| Dev-only quality | MED | The two tiny ABI stubs (`VibeAMM.json`, `VibeSwapCore.json`) make local dev confusing — `ethers.Contract.interface.fragments` is wildly incomplete. |

End of report.
