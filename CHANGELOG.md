# Changelog

All notable changes to VibeSwap are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Audience: external integrators and partners tracking what changed at the contract,
test, and documentation layers. Cycle codes (e.g. C39, C42) reference internal
remediation cycles tracked in `docs/_meta/rsi/` and `docs/audits/`.

---

## [Unreleased]

### Security

Audit-driven fixes shipped this session. Severity in parentheses.

- **C28-F2 (HIGH)** — `SoulboundIdentity.mintIdentity` reentrancy via `onERC721Received`
  callback. Reordered to checks-effects-interactions; receiver hook can no longer
  observe partial-mint state.
- **C-OFR-1 (HIGH)** — Cross-function reentrancy in
  `IncentiveController.onLiquidityRemoved`. Closed by promoting the shared guard
  to cover the full liquidity-event surface.
- **C49-F1 (HIGH)** — `TruePriceOracle.pullFromAggregator` accepted aggregator
  batches with stale timestamps. Now rejects any batch whose `updatedAt` is older
  than the configured staleness window.
- **C39-F1 (HIGH)** — `VibeSwapCore` and `VibeAMM` were missing the wire-up call
  for the C39 attested-resume migration. Migration is now invoked from the
  reinitializer; classification defaults are applied on upgrade.
- **C42-F1 (MED)** — `ShapleyDistributor` upgrade did not reinitialize the new
  `keeperRevealDelay` storage slot. Added a guarded reinitializer that sets the
  default and refuses re-execution.
- **C16-F1 (MED)** — `LoyaltyRewardsManager.configureTier` accepted unbounded
  multiplier and penalty values. Both are now clamped to documented protocol
  maxima before storage.
- **C16-F2 (MED)** — `ILProtectionVault` tier configuration lacked a kill-switch
  and had asymmetric active-state checks across read/write paths. Added a
  per-tier kill-switch and made the active check symmetric on both paths.
- **C7-CCS-F1 (LOW)** — `ContributionAttestor` did not enforce
  `MAX_ATTESTATIONS_PER_CLAIM` at the storage layer; bound is now checked on
  every append.

### Added

New protocol features and capabilities. Cycle codes match the audit/build log.

- **C39 — default-on attested-resume.** Security-load-bearing circuit breakers
  default to attested-resume classification on upgrade, eliminating the
  bootstrap window where breakers were silently in permissive mode.
  See `docs/concepts/primitives/classification-default-with-explicit-override.md`.
- **C42 — keeper commit-reveal.** Similarity-keeper updates to
  `ShapleyDistributor` now use a generation-isolated commit-reveal flow, closing
  the front-run/observability gap on novelty multiplier updates.
  See `docs/concepts/primitives/generation-isolated-commit-reveal.md`.
- **C45 — source-lineage binding.** `SoulboundIdentity` now binds a one-way
  source-lineage record at mint, with a post-mint lock that dissolves the
  attestor bootstrap cycle. See
  `docs/concepts/primitives/bootstrap-cycle-dissolution-via-post-mint-lock.md`.
- **C46 — cooldown observability.** `ContributionDAG` handshake cooldowns now
  emit per-pair audit-counter events, enabling external monitors to detect
  cooldown abuse without polling. See
  `docs/concepts/primitives/revert-wipes-counter-non-reverting-twin.md`.
- **C47 — bonded permissionless contest.** `ClawbackRegistry` ships a
  bonded-contest path with a self-funding bug-bounty pool and dual-path
  adjudication that preserves the existing oracle. See
  `docs/concepts/primitives/bonded-permissionless-contest.md` and
  `docs/concepts/primitives/self-funding-bug-bounty-pool.md`.
- **C48-F1 — LP gas-griefing cap.** `MicroGameFactory` now caps the LP set per
  micro-game to bound iteration costs and prevent phantom-array DoS. See
  `docs/concepts/primitives/phantom-array-cleanup-dos.md`.
- **C48-F2 — compaction pagination.** `VibeSwapCore.compactFailedExecutions`
  is now paginated; callers pass an explicit batch size and the function
  refuses unbounded sweeps.
- **C19-F1 — VWAPOracle precision fix.** Asymmetric truncation between
  cumulators that produced a dust-trade bias has been corrected. Truncation is
  now symmetric across both numerator and denominator paths.

### Documentation

- **`docs/` tree consolidation.** The legacy `DOCUMENTATION/` tree was migrated
  into `docs/{concepts,research,architecture,audits,governance,_meta,_archive,developer,marketing,partnerships}/`.
  All inter-doc links were repaired and 13 ambiguous references resolved.
- **14 new primitive docs** under `docs/concepts/primitives/` capturing
  reusable mechanism-design patterns surfaced by the C39–C48 cycles.
- **3 architecture overviews** added: `DEPLOYMENT_TOPOLOGY.md`, refreshed
  `CONTRACTS_CATALOGUE`, refreshed `SYSTEM_TAXONOMY`.
- **Deploy-script audit** at `docs/_meta/deploy-script-audit-2026-05-01.md`
  enumerates reinitializer wiring across C39/C42/C45/C47.
- **Frontend ABI regen** — all 10 existing ABIs regenerated against current
  contract API; 4 new ABIs added (`ClawbackRegistry`, `ContributionAttestor`,
  `ContributionDAG`, `FeeRouter`) and wired into `frontend/src/hooks/useContracts.jsx`.
  See `docs/_meta/frontend-abi-sync-2026-05-01.md`.
- **`SECURITY.md`** and **`CONTRIBUTING.md`** added at repo root for
  responsible disclosure and external contributor onboarding.

### Tests

- **5 new fuzz/invariant suites** covering: C39 attested-resume default-on
  classification (`C39-PROP`), C19-F1 VWAPOracle dust-trade no-op
  (`C19-F1-PROP`), C45 source-lineage immutability (`C45-PROP`), C46
  ContributionDAG cooldown audit-counter coherence (`C46-PROP`), and C47
  ClawbackRegistry contest bond accounting closure (`C47-PROP`).
- **5 integration scenarios** in `test/integration/` exercising cross-cycle
  composition: C39 / C42 / C45 / C46 / C47 / C48 in combination.

---

## Earlier history

Full per-cycle history (C1–C38, plus the pre-cycle prototype work) is tracked
in the git log and in `docs/_meta/rsi/`. A summary:

- **Cycles C1–C20** — Core protocol (commit-reveal batch auction, AMM, Shapley
  distributor, LayerZero router) and initial security pass.
- **Cycles C21–C38** — Identity & governance layer (SoulboundIdentity,
  ContributionDAG, ContributionAttestor), incentive system
  (ILProtectionVault, LoyaltyRewardsManager, FractalShapley), oracle stack
  (TruePriceOracle, VWAPOracle, TWAPOracle), and ETM-alignment audit (C38).

For commit-level detail prior to this session, see `git log --oneline` against
the contracts directory.

---

[Unreleased]: https://github.com/wglynn/vibeswap/compare/main...HEAD
