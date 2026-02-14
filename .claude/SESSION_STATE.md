# Shared Session State

This file maintains continuity between Claude Code sessions across devices.

**Last Updated**: 2026-02-13 (Desktop - Claude Code Opus 4.6)
**Auto-sync**: Enabled - pull at start, push at end of each response

---

## Current Focus
- **Phase 2: Financial Primitives** — building out DeFi primitive contracts
- **550+ tests passing, 0 failures, 0 skipped** (full suite green)
- Protocol security hardening COMPLETE (7 audit passes, 35+ findings fixed)
- Frontend redesign: "Sign In" button (not "Connect Wallet"), game-like abstraction TBD

## Active Tasks
- Phase 2 Financial Primitives (next: bonds, credit delegation, synthetics, insurance, revenue share)
- Frontend: "Sign In" button change + abstraction redesign
- Testnet deployment preparation

## Recently Completed (Feb 13, 2026)
39. **Joule (JUL) — Trinomial Stability Token** (`5f86ecb`)
    - Financial Primitive #5: Replaces "Yield-Bearing Stablecoins (vsUSDC)" — single token with 3 stability mechanisms
    - **RPow Mining**: SHA-256 proportional PoW anchoring value to electricity cost (Bitcoin ASIC compatible)
    - **PI Controller**: Kp=7.5e-8, Ki=2.4e-14, 120-day leaky integrator adjusts floating rebase target
    - **Elastic Rebase**: supplyDelta = totalSupply × (price - target) / target / lag=10, ±5% equilibrium band
    - Custom ERC-20 with O(1) rebase via global scalar (externalBalance = internalBalance × scalar / 1e18)
    - Moore's Law decay (~25%/yr), difficulty adjustment every 144 blocks, dual oracle (market + electricity + CPI)
    - Anti-merge-mining: challenge includes address(this)
    - Found & worked around SHA256Verifier assembly bug (always returns 0) — uses built-in sha256() instead
    - Trinomial Stability Theorem docs updated to v2.0: one-token architecture, RPow terminology, optimal yield section (Friedman Rule)
    - 3 new files: `contracts/monetary/interfaces/IJoule.sol`, `contracts/monetary/Joule.sol`, `test/Joule.t.sol`
    - 40 tests, all passing
38. **VibeOptions — On-Chain European-Style Options** (`72f6cc0`)
    - Financial Primitive #4: calls/puts as ERC-721 NFTs, fully collateralised by writer
    - European-style, cash-settled from collateral using TWAP pricing (anti-MEV)
    - CALL collateral = token0 (underlying), PUT collateral = amount × strike / 1e18 of token1 (quote)
    - Payoff: CALL = amount × (settlement - strike) / settlement, PUT = amount × (strike - settlement) / 1e18
    - Writer sets premium; suggestPremium() view provides reference via VolatilityOracle (simplified Black-Scholes approximation)
    - Lifecycle: write → purchase → exercise (after expiry, within 24h window) → reclaim remainder (after window)
    - Cancel path: writer cancels unpurchased option, gets collateral back, NFT burned
    - 3 new files: `contracts/financial/interfaces/IVibeOptions.sol`, `contracts/financial/VibeOptions.sol`, `test/VibeOptions.t.sol`
    - 31 tests (write 6, purchase 3, exercise 8, reclaim 5, cancel 3, premium 3, integration 3), all passing
    - 106 regression tests all passing (VibeLPNFT 28, VibeStream 51, AuctionAMM 10, VibeSwap 13, MoneyFlow 4)
37. **VibeStream FundingPool — Conviction-Weighted Distribution** (`c3b1e87`)
    - Extended VibeStream.sol and IVibeStream.sol in-place with FundingPool mode
    - Conviction voting: voters stake tokens to signal for recipients, conviction = stake × time (O(1) from aggregates)
    - Lazy evaluation: allocation computed on-demand at withdrawal, not per-block
    - Pairwise fairness verified on-chain via PairwiseFairness library at withdrawal
    - Pool IDs count DOWN from type(uint256).max to avoid collision with stream NFT IDs
    - 5 core functions: createFundingPool, signalConviction, removeSignal, withdrawFromPool, cancelPool
    - 8 view functions + 3 internals, 4 new structs, 5 events, 10 errors
    - 17 new tests (51 total VibeStream), 55 regression tests all passing
    - Files modified: `contracts/financial/VibeStream.sol`, `contracts/financial/interfaces/IVibeStream.sol`, `test/VibeStream.t.sol`
36. **VibeLPNFT — LP Position NFTs** (`49ffd73`)
    - ERC-721 position manager wrapping VibeAMM (purely additive, no AMM changes)
    - Holds VibeLP ERC-20 tokens in custody, issues NFTs as transferable position receipts
    - Full lifecycle: mint → increaseLiquidity → decreaseLiquidity → collect → burn
    - Two-step withdrawal (decrease stores tokens owed, collect sends them)
    - Lightweight enumeration via _ownedTokens with O(1) swap-and-pop removal
    - Entry price from TWAP (fallback spot), weight-averaged on increase
    - 3 new files: `contracts/amm/interfaces/IVibeLPNFT.sol`, `contracts/amm/VibeLPNFT.sol`, `test/VibeLPNFT.t.sol`
    - 28 tests (25 unit + 3 integration), all passing. 0 regressions on existing 27 integration tests.
35. **wBAR — Wrapped Batch Auction Receipts** (`4c4bae0`)
    - First Phase 2 financial primitive

## Previously Completed (Feb 12, 2026)
34. **Cross-contract interaction audit + DAOTreasury slippage protection**
    - Audited all cross-contract call chains (Core→AMM, IncentiveController→sub-contracts, Auction→Core settlement, Treasury→AMM, CrossChainRouter→Core)
    - Confirmed most findings were false positives (EVM atomicity, admin-only access)
    - **HIGH**: DAOTreasury provideBackstopLiquidity had zero slippage → 95% min protection
    - **HIGH**: DAOTreasury removeBackstopLiquidity had zero slippage → caller-specified minimums
    - Updated IDAOTreasury interface and TreasuryStabilizer caller
    - Total suite: 550 tests, 0 failures
33. **SlippageGuaranteeFund daily limit fix**
    - **MEDIUM**: Daily claim limit was hardcoded to 1e18, ignoring config.userDailyLimitBps
    - Now uses configurable BPS percentage of fund reserves per user per day
    - Total suite: 550 tests, 0 failures
32. **ComplianceRegistry KYC expiry + LoyaltyRewardsManager fee-on-transfer**
    - **HIGH**: canProvideLiquidity and canUsePriorityAuction missing KYC expiry checks
    - **MEDIUM**: depositRewards now uses balance-before/after pattern for fee-on-transfer tokens
    - Total suite: 550 tests, 0 failures
31. **Medium-severity fixes (bounded loops, array limits, threshold validation)**
    - **MEDIUM**: DisputeResolver bounded arbitrator assignment loop (gas DoS prevention)
    - **MEDIUM**: ClawbackRegistry MAX_CASE_WALLETS=1000 (unbounded array growth prevention)
    - **MEDIUM**: WalletRecovery guardianThreshold validated against active guardian count
    - Total suite: 550 tests, 0 failures
30. **Peripheral Contract Audit Fixes (7 fixes across 6 contracts)**
    - **CRITICAL**: DisputeResolver excess ETH refund in escalateToTribunal + registerArbitrator
    - **CRITICAL**: WalletRecovery replaced unsafe .transfer() with .call{value:}() (3 bond paths)
    - **HIGH**: SlippageGuaranteeFund token address validation
    - **HIGH**: ClawbackRegistry executeClawback attempts actual transferFrom with try/catch
    - **HIGH**: SoulboundIdentity recovery contract change now uses 2-day timelock
    - **HIGH**: QuantumVault key exhaustion now reverts instead of just emitting
    - Full peripheral audit complete: 13 contracts reviewed, libraries clean
    - Total suite: 550 tests, 0 failures
29. **Remaining Audit Fixes: Tribunal, Vault, Insurance, Consensus (5 fixes)**
    - **CRITICAL**: DecentralizedTribunal._settleStakes() → pull pattern (one reverting juror blocked all settlements)
    - **CRITICAL**: DecentralizedTribunal.volunteerAsJuror() → SoulboundIdentity checks (sybil resistance)
    - **HIGH**: ClawbackVault.releaseTo() → zero address check (prevented permanent fund lockup)
    - **HIGH**: VolatilityInsurancePool.registerCoverage() → atomic update (prevented underflow)
    - **MEDIUM**: FederatedConsensus.setThreshold() → min 2 authorities required
    - UUPS upgrade safety verified: all 25 contracts have onlyOwner _authorizeUpgrade
    - Total suite: 550 tests, 0 failures
28. **Comprehensive Audit Fixes: 4 contracts hardened (4 fixes, 2 new tests)**
    - **CRITICAL**: IncentiveController volatility pool deposit now reverts on failure (tokens were getting stuck in controller on silent fail)
    - **HIGH**: VolatilityInsurancePool per-event claim tracking (was using shared claimedAmount across events — LPs shortchanged)
    - **HIGH**: StablecoinFlowRegistry ratio bounds [0.01, 100.0] (prevented zero-division/overflow in downstream calcs)
    - **HIGH**: FederatedConsensus vote expiry check moved before state changes (revert was undoing EXPIRED status)
    - Updated fuzz tests with bounded inputs + 2 new bounds-checking tests
    - False positives confirmed: TruePriceOracle sig validation (SecurityLib handles v/s), ComplianceRegistry daily reset (integer division is deterministic), TreasuryStabilizer (already checks balance)
    - Total suite: 550 tests, 0 failures
27. **Deploy Script Fixes (3 bugs, verification gaps)**
    - **MEDIUM**: CommitRevealAuction.initialize needs 3 params but both Deploy.s.sol and DeployProduction.s.sol only passed 2 — deployment would REVERT. Fixed.
    - **MEDIUM**: setGuardian called on VibeAMM (no such function) — moved to VibeSwapCore
    - **MEDIUM**: EmergencyPause called setGlobalPause on VibeAMM (doesn't exist) — fixed to use Core.pause()
    - Added security verification to _verifyDeployment: EOA, rate limit, guardian, flash loan, TWAP, router auth
    - Total suite: 548 tests, 0 failures
26. **Cross-Chain Security Parity + Rate Limit Bug (3 fixes, 5 new tests)**
    - **HIGH**: `commitCrossChainSwap` missing 5 security modifiers (notBlacklisted, notTainted, onlyEOAOrWhitelisted, onlySupported(tokenOut)) + rate limit + cooldown checks — all security controls bypassable via cross-chain path. Fixed.
    - **HIGH**: Rate limit `_checkAndUpdateRateLimit` was non-functional — first-time initialization wrote to memory copy but only persisted usedAmount, leaving windowDuration=0 in storage so it re-initialized every call. Fixed by writing full struct to storage on init.
    - 5 new adversarial tests: blacklist bypass, flash loan bypass, unsupported token, rate limit, cooldown
    - Full modifier consistency audit across all contracts completed
    - Total suite: 548 tests, 0 failures
25. **Contract Security Hardening (4 fixes, 6 new tests)**
    - DAOTreasury: Added `nonReentrant` to `receiveProtocolFees` (external token call reentrancy protection)
    - CrossChainRouter: Added bridged deposit expiration system (24h default, `recoverExpiredDeposit()`, `setBridgedDepositExpiry()`)
    - CrossChainRouter: Added fee remainder refund in `broadcastBatchResult` and `syncLiquidity` (integer division dust)
    - 6 new CrossChainRouter tests: expiry default, set expiry, expiry too short, recover expired deposit, auth check, no deposit revert
    - Verified 2 assessment findings as false positives (updateTokenPrice already has ACL, ShapleyDistributor already validates participants)
    - Total suite: 543 tests, 0 failures
23. **Activated Skipped Security + Cross-Chain Tests (43 new tests)**
    - CrossChainRouter.t.sol: 21 tests (peer mgmt, commit/reveal, rate limiting, replay prevention)
    - SecurityAttacks.t.sol: 22 tests (flash loan, first depositor, donation, price manipulation, circuit breakers, commit-reveal, reentrancy, fuzz)
    - Fixed: struct field mismatches, string→custom errors, CommitRevealAuction 3-param init, donation test scope
    - Total suite: 537 tests, 0 failures
24. **MoneyPathAdversarial.t.sol (18 adversarial money path tests)**
    - AMM fund safety (LP sandwich, first depositor, rounding theft, donation manipulation)
    - Auction fund safety (double spend, slash accounting, wrong secret, priority bid)
    - Treasury fund safety (double commitment, timelock, double execute, recipient immutability)
    - Reward distribution safety (double claim, overpay, non-participant)
    - Oracle/price safety (TWAP deviation, flash loan same block, trade size limit)

## Previously Completed (Feb 11, 2026)
22. **CommitRevealAuction + VibeAMM Test Fixes**
    - CommitRevealAuction: Fixed double-nonReentrant (commitOrder wrapper + commitOrderToPool both had nonReentrant)
    - CommitRevealAuction.t.sol: Updated all expectRevert to custom error selectors
    - VibeAMM.t.sol: Fixed DEFAULT_FEE_RATE (30→5), string→custom errors, fee tests for PROTOCOL_FEE_SHARE=0
    - Result: 19/19 CommitRevealAuction, 22/22 VibeAMM
21. **Backend Production Hardening (10 phases)**
    - Phase 1: Environment validation at startup (validateEnv.js)
    - Phase 2: Structured logging with pino (replaced morgan)
    - Phase 3: Input validation middleware (symbol, chainId)
    - Phase 4: WebSocket hardening (connection limits, origin check, rate limiting)
    - Phase 5: Fallback price flagging (isFallback field, no fake freshness)
    - Phase 6: Health check enhancement (priceFeed freshness, WS count)
    - Phase 7: Request timeouts + graceful shutdown
    - Phase 8: nginx CSP fix (removed unsafe-eval)
    - Phase 9: CI security checks fix (audit jobs now block merges)
    - Phase 10: Deploy script hardening (SSL required, rollback support)
    - All 7 backend tests pass, 0 npm vulnerabilities

## Previously Completed (Feb 11, 2025)
20. **Solidity Sprint Phase 3: Money Path Audit COMPLETE**
    - Audited all 4 critical contracts: VibeAMM, CommitRevealAuction, VibeSwapCore, CrossChainRouter
    - **CRITICAL FIX #6**: Double-spend via failed batch swap
      - AMM was returning unfilled tokens to trader, not VibeSwapCore
      - User could double-claim via withdrawDeposit() draining other users
      - Fixed: AMM returns to msg.sender (VibeSwapCore), deposit accounting stays consistent
    - **HIGH FIX #7**: Excess ETH not refunded in revealOrder
      - msg.value > priorityBid was kept by contract with no refund
      - Fixed: Added refund of excess ETH after recording priority bid
    - Full audit report: docs/audit/MONEY_PATH_AUDIT.md
    - All 7 security fixes verified (FIX #1 through #7)
    - forge build passes with 0 errors

## Previously Completed (Feb 11, 2025)
19. Created Epistemic Gate Archetypes (docs/ARCHETYPE_PRIMITIVES.md):
    - Seven logical archetype primitives: Glass Wall, Timestamp, Inversion, Gate, Chain, Sovereign, Cooperator
    - Lossless cognitive compression of full protocol for instant user sync
    - Archetype Test: validate any feature against all seven
    - Interface mapping: each archetype → protocol component → implementation file
    - Integrated into CKB TIER 2 as quick sync table
    - CKB bumped to v1.5
18. Integrated Provenance Trilogy into CKB as TIER 2:
    - Logical chain: Transparency Theorem → Provenance Thesis → Inversion Principle
    - Web2/Web3 synthesis: temporal demarcation (pre-gate vs post-gate)
    - Tiers renumbered (Hot/Cold→3, Wallet→4, Dev→5, Project→6, Comms→7, Session→8)
    - CKB version bumped to v1.4
17. Solidity Sprint Phase 0-2:
    - Phase 0: Frontend Hot Zone Audit (docs/audit/FRONTEND_HOT_ZONE.md)
      - 19 files touch blockchain (24% of codebase)
      - Target: reduce to ~5 files with Hot/Cold separation
    - Phase 1: Fixed compile errors
      - Forum.sol: PostLocked → PostIsLocked (duplicate identifier)
      - ClawbackResistance.t.sol, SybilResistanceIntegration.t.sol: CaseStatus fix
    - Phase 2: Test results
      - DAOTreasury: 24/24 pass (money paths secure)
      - VibeAMM: 16/22 pass (6 error format sync issues)
      - Security: 23/36 pass (13 NotActiveAuthority setup issues)
      - CommitRevealAuction: setUp failure (needs fix)

## Recently Completed (Feb 10, 2025)
12. Created formal proofs documentation:
    - VIBESWAP_FORMAL_PROOFS.md: Core formal proofs
    - VIBESWAP_FORMAL_PROOFS_ACADEMIC.md: Academic publication format
    - Title page, TOC, abstract, 8 sections, 14 references
    - Appendices: Notation, Proof Classification, Glossary, Index
    - PDF versions generated for both
13. Added Trilemmas and Quadrilemmas to PROOF_INDEX.md:
    - 5 trilemmas (Blockchain, Stablecoin, DeFi Composability, Oracle, Regulatory)
    - 4 quadrilemmas (Exchange, Liquidity, Governance, Privacy)
    - Total: 27 problems formally addressed
14. Created JarvisxWill_CKB.md (Common Knowledge Base):
    - Persistent memory across all sessions
    - 7 tiers: Knowledge Classification → Session Recovery
    - Epistemic operators from modal logic
    - Hot/Cold separation as permanent architectural constraint
15. Created "In a Cave, With a Box of Scraps" thesis:
    - Vibe coding philosophy document
    - Added to AboutPage.jsx
    - PDF and DOCX versions generated
16. Fixed personality quiz routing (added ErrorBoundary)

## Previously Completed
1. Fixed wallet detection across all pages (combined external + device wallet state)
2. BridgePage layout fixes (overflow issues resolved)
3. BridgePage "Send" button (was showing "Get Started")
4. 0% protocol fees on bridge (only LayerZero gas)
5. Created `useBalances` hook for balance tracking
6. Deployed to Vercel: https://frontend-jade-five-87.vercel.app
7. Set up auto-sync between devices (pull first, push last - no conflicts)
8. Added Will's 2018 wallet security paper as project context
9. Created wallet security axioms in CLAUDE.md (mandatory design principles)
10. Built Savings Vault feature (separation of concerns axiom)
11. Built Paper Backup feature (offline generation axiom)

## Known Issues / TODO
- Large bundle size warning (2.8MB chunk) - consider code splitting
- Need to test balance updates after real blockchain transactions

## Session Handoff Notes
When starting a new session, tell Claude:
> "Read .claude/SESSION_STATE.md for context from the last session"

When ending a session, ask Claude:
> "Update .claude/SESSION_STATE.md with current state and push to both remotes"

---

## Technical Context

### Dual Wallet Pattern
All pages must support both wallet types:
```javascript
const { isConnected: isExternalConnected } = useWallet()
const { isConnected: isDeviceConnected } = useDeviceWallet()
const isConnected = isExternalConnected || isDeviceConnected
```

### Key Files
| File | Purpose |
|------|---------|
| `frontend/src/components/HeaderMinimal.jsx` | Main header, wallet button |
| `frontend/src/hooks/useDeviceWallet.jsx` | WebAuthn/passkey wallet |
| `frontend/src/hooks/useBalances.jsx` | Balance tracking (mock + real) |
| `frontend/src/components/BridgePage.jsx` | Send money (0% fees) |
| `frontend/src/components/VaultPage.jsx` | Savings vault (separation of concerns) |
| `frontend/src/components/PaperBackup.jsx` | Offline recovery phrase backup |
| `frontend/src/components/RecoverySetup.jsx` | Account protection options |
| `docs/PROOF_INDEX.md` | Catalog of all lemmas, theorems, dilemmas |
| `docs/VIBESWAP_FORMAL_PROOFS_ACADEMIC.md` | Academic publication format |
| `.claude/JarvisxWill_CKB.md` | Common Knowledge Base (persistent soul) |
| `.claude/TOMORROW_PLAN.md` | Solidity sprint phases |
| `.claude/plans/memoized-cooking-hamster.md` | Cypherpunk redesign plan |

### Git Setup
```bash
git push origin master   # Public repo
git push stealth master  # Private repo
# Always push to both!
```

### Dev Server
```bash
cd frontend && npm run dev  # Usually port 3000-3008
```

### Deploy
```bash
cd frontend && npx vercel --prod
```
