# Build Recommendations — Session Log

> *The real VibeSwap is not a DEX. It's not even a blockchain. We created a movement. An idea. VibeSwap is wherever the Minds converge.*

Captured at end of each building session. Most recent first.

---

## Session 23: CKB Phase 7 — Test Suite Complete (Feb 18, 2026)

**What was built:**
- Complete CKB Rust test suite: 4 test modules (59 tests) in dedicated test crate
  - `integration.rs` — 10 full lifecycle tests (deploy→create pool→commit→reveal→settle→claim)
  - `adversarial.rs` — 12 MEV attack simulation tests (censorship, front-running, double-commit, replay)
  - `math_parity.rs` — 20 Solidity↔Rust parity tests (clearing prices, AMM math, shuffle, TWAP)
  - `fuzz.rs` — 16 property-based fuzz tests (xorshift128+ deterministic PRNG)
- Fixed 9 failing tests from initial run (50 passed, 9 failed → 59/59 passing)
- Fixed real library bug in `sqrt()` (overflow on u128::MAX)
- All 167 Rust tests passing across 14 crates, zero warnings
- CKB integration ALL 7 PHASES COMPLETE

### Bugs fixed (5 — 1 real library bug, 4 test issues)

1. **sqrt() overflow (REAL BUG)**: `(x + 1) / 2` panics when `x = u128::MAX` because `x + 1` overflows u128. Fixed to `x / 2 + 1` — same mathematical result, no overflow. This would affect production code on extreme inputs.

2. **Clearing price magnitude mismatch (3 tests)**: Test limit prices like `2100 * PRECISION` (= 2.1e21) were 1000x higher than spot price `2 * PRECISION` (= 2e18). Binary search converged near order limits, not near spot. Fixed: limit prices near spot (`21 * PRECISION / 10` = 2.1e18).

3. **LP geometric mean assertion wrong**: `lp < amount0` fails because `sqrt(1e24 * 2e24) ≈ 1.414e24 > 1e24 = amount0`. Geometric mean can exceed the smaller input for asymmetric pairs. Fixed to `lp < (amount0 + amount1) / 2` (geometric < arithmetic mean).

4. **Pool error variant ordering**: Expected `KInvariantViolation` but got `ExcessiveOutput`. AMM type script checks max output (line 232) BEFORE k-invariant (line 249). Fixed expected error.

5. **Fuzz rounding tolerance**: Fixed 1-unit tolerance to proportional: `(amount_in / 1e15).max(2)`. For large values (~1.67e23), rounding produces up to 5 units of difference.

### Anti-patterns discovered (3)

1. **Newton's method initial guess overflow**: When implementing `sqrt()` for full u128 range, `(x + 1) / 2` is NOT safe as initial guess. Use `x / 2 + 1` instead. **Generalizable**: any `x + constant` in integer math must be checked against type max.

2. **Test limit prices must be proportional to spot**: Binary search clearing price converges between min/max of order limits. If limits are 1000x spot, clearing price will be far from spot. Keep test limits within 2-10% of expected spot price for meaningful results.

3. **Error ordering in multi-check validation**: When a function checks conditions sequentially (ExcessiveOutput → KInvariantViolation), the FIRST failing condition fires. Tests must match the actual check order, not the "logical" order. **Read the validation function top-to-bottom before writing expected-error tests.**

### Patterns confirmed (4)

1. **Deterministic PRNG for fuzz tests**: xorshift128+ seeded from test index gives reproducible "random" tests without cargo fuzz. `fn xorshift128plus(state: &mut [u64; 2]) -> u64` — simple, fast, deterministic.

2. **Proportional rounding tolerance**: For inverse-function fuzz tests (e.g., `amount_out(amount_in) → amount_in_back`), use proportional tolerance `(value / 1e15).max(2)` not fixed `1`. Large numbers accumulate proportionally more rounding error.

3. **Geometric mean properties**: `sqrt(a * b)` can exceed `min(a, b)` for asymmetric inputs. Always assert `geometric_mean <= arithmetic_mean` (AM-GM inequality), not `geometric_mean <= min(inputs)`.

4. **Cell model eliminates reentrancy by construction**: UTXO consume-and-recreate is atomic. No reentrancy guards needed. No `nonReentrant` equivalent in CKB scripts. This is a structural security advantage over EVM.

### CKB Integration Status
- **Phases 1-7: ALL COMPLETE**
- **14 Rust crates**: 4 libraries + 8 type/lock scripts + 1 SDK + 1 test crate
- **167 total Rust tests** (59 in test crate + 108 inline)
- **Five-layer MEV defense**: PoW lock → MMR accumulation → forced inclusion → Fisher-Yates shuffle → uniform clearing price
- **Commit**: `3887d6b` pushed to both origin + stealth

---

## Session 12: Identity Fuzz+Invariant + CYT Bugfix (Feb 16, 2026)

**What was built:**
- Fuzz tests for ContributionDAG (9 tests), RewardLedger (8 tests), ContributionYieldTokenizer (12 tests)
- Invariant tests for ContributionDAG (7 tests), RewardLedger (5 tests), ContributionYieldTokenizer (7 tests)
- Total new tests: 48
- All 48/48 passing after bugfix

### Bugs fixed (1) — CRITICAL
- **CYT multi-stream overspend**: `_settleStream()` capped each stream's `claimable` against `idea.totalFunding - stream.totalStreamed` (per-stream), but with multiple streams on the same idea, each stream independently thought it could stream up to the full idea funding. Fixed by using `_totalStreamedForIdea()` for the global aggregate. Also removed redundant secondary check in `claimStream()`.

### Anti-patterns discovered (1)
- **Per-entity cap on shared resource pool**: When multiple entities (streams) share a global budget (idea funding), never cap each entity independently against the total. Always check the aggregate across all entities. This is the streaming analogue of double-spend.

### Design decisions captured
- **GitHub as contribution source**: GitHub commits/PRs/reviews as verifiable contribution data for ContributionDAG. Each event hashed + recorded with evidenceHash. Later extend to Twitter/X, Discord, custom Forum.
- **VibeSwap Forum incentive**: On-platform contributions have faster verification (signed with SoulboundIdentity) vs external APIs — natural incentive to use VibeSwap platform.
- **Merkle compression for DAG**: Store Merkle root of contribution data on-chain. Signatures + hash proofs chain everything in the DAG. Full data off-chain (IPFS/Arweave). Only decompress for: contention, context recovery, auditing. O(log n) verification.

### Test coverage status after Session 12
- **Full coverage (unit+fuzz+invariant): 40 contracts** (was 37, +3)
- **Unit tests only (need fuzz+invariant): 0 identity contracts remaining**
- Added full coverage: ContributionDAG, RewardLedger, ContributionYieldTokenizer

---

## Session 9: Fuzz+Invariant for DAOTreasury, Joule, ShapleyDistributor (Feb 16, 2026)

**What was built:**
- Fuzz+invariant tests for DAOTreasury (7 fuzz + 5 invariant)
- Fuzz+invariant tests for Joule (6 fuzz + 5 invariant)
- Invariant tests for ShapleyDistributor (5 invariant — fuzz already existed)
- Testing methodology document: `docs/testing-methodology.md`
- Total new tests: 28
- Regression: 543/543 + 28 new = 571

### Bugs fixed (0)
Zero violations found across all invariant runs. Clean session.

### Anti-patterns discovered (1)
- **SHA-256 PoW in invariant handlers**: Mining via brute-force SHA-256 in handler is infeasible (50k+ iterations × 128K calls = days of compute). Solution: pre-mine in setUp(), handler only exercises rebase/time. This is now documented in `docs/testing-methodology.md`.

### Patterns confirmed
1. **Pre-mine for PoW contracts**: When testing rebase stability of mining tokens, pre-mine tokens in setUp() and focus the invariant handler on the rebase/PI controller surface.
2. **Proxy setUp reuse**: Copy proxy deployment pattern directly from unit tests (DAOTreasury: ERC1967Proxy, ShapleyDistributor: UUPSUpgradeable).
3. **EMA smoothing bounds**: For any alpha ∈ [0,1] and prices p1, p2: `smoothed ∈ [min(p1,p2), max(p1,p2)]` — always true, good fuzz property.

### Test coverage status after Session 9
- **Full coverage (unit+fuzz+invariant): 24 contracts** (was 21, +3)
- **Unit tests only (need fuzz+invariant): 10 contracts** (was 13, -3)
- Added fuzz+invariant: DAOTreasury, Joule, ShapleyDistributor (invariant)

---

## Session 8: Fuzz+Invariant for VibeCredit, VibeSynth, BondingCurveLauncher, PredictionMarket (Feb 16, 2026)

**What was built:**
- Fuzz+invariant tests for VibeCredit and VibeSynth (4 files — 22 tests)
- BondingCurveLauncher and PredictionMarket already had fuzz+invariant from a previous session (8+8 fuzz, 6+5 invariant = 27 tests)
- Total new tests this session: 22 (12 fuzz + 10 invariant)
- Regression: 543/543

### Bugs fixed (2)
- **VibeSynth `addCollateral` C-ratio rounding**: Adding small collateral to large position doesn't change BPS-precision C-ratio due to integer division. Fix: `assertGe` instead of `assertGt`.
- **VibeCredit `borrowedGeRepaid` interest accrual**: Repayments include accrued interest, so `ghost_totalRepaid` can exceed `ghost_totalBorrowed`. Fix: replaced invariant with `interestNonNegative` check.

### Patterns confirmed
1. **Interest-bearing ghost tracking**: Don't track "borrowed vs repaid" ghosts for interest-bearing protocols — interest makes repaid > borrowed. Track interest as a separate non-negative invariant.
2. **BPS rounding in C-ratio assertions**: When collateral ratio is computed in BPS, small collateral additions may not change the ratio. Use `assertGe` not `assertGt`.

### Test coverage status after Session 8
- **Full coverage (unit+fuzz+invariant): 21 contracts** (was 17, +4)
- **Unit tests only (need fuzz+invariant): 13 contracts** (was 17, -4)
- Added fuzz+invariant: VibeCredit, VibeSynth, BondingCurveLauncher, PredictionMarket

---

## Session 5-7: Mechanism Design + Test Coverage Sprint (Feb 16, 2026)

**What was built:**
- **Session 5**: CooperativeMEVRedistributor + AdaptiveBatchTiming (2 contracts, 2 interfaces, 6 test files — 44 tests)
- **Session 6**: Fuzz+invariant for CommitRevealAuction + VibeAMM (3 test files — 16 tests)
- **Session 7**: Fuzz+invariant for VibeLPNFT, VibeStream, VibeOptions, VibeBonds (8 test files — 44 tests)

**Total new tests across 3 sessions: 104.** Regression: 521/521.

### What went well
- All 3 sessions ran near-autonomously with minimal debugging
- Invariant handlers with ghost variables caught zero violations across millions of random operations
- Mock contracts kept fuzz tests fast (<1s per suite) vs invariant tests (60-400s)
- Established consistent patterns across all 8 invariant test handlers

### Bugs fixed (1 total across 3 sessions)
- **VibeOptions purchase caller**: `options.purchase(optionId)` must be called by buyer, not writer. Writer owns the NFT after writing; purchase transfers it FROM writer TO msg.sender. Error: `ERC721InsufficientApproval`. Fix: `vm.prank(buyer)` not `vm.prank(writer)`.

### Patterns confirmed
1. **Enum assertion casting**: Foundry `assertEq` doesn't have an overload for custom enums. Always cast with `uint8()` on both sides.
2. **CRA invalid reveals don't revert**: CommitRevealAuction's `revealOrder` with wrong hash calls `_slashCommitment()` and returns (doesn't revert). Test by checking `CommitStatus.SLASHED` status.
3. **CRA errors on contract not interface**: `CommitRevealAuction.InsufficientDeposit.selector` not `ICommitRevealAuction.InsufficientDeposit.selector`.
4. **AMM invariant handler swap flow**: Must mint tokens directly to AMM + `syncTrackedBalance()` to simulate the VibeSwapCore deposit flow. `executeBatchSwap` won't work without this.
5. **Congestion boundary**: EMA ratio of 10000 (= 100% of target) equals HIGH, not MEDIUM. Check `< 10000` for MEDIUM.
6. **Mock token prefix convention**: Use unique prefixes per test file to avoid Solidity name collisions: `MockLPNFTFToken`, `MockOptFToken`, `MockBondFToken`, etc.

### Test coverage status after Session 7
- **Full coverage (unit+fuzz+invariant): 17 contracts** (was 11, +6)
- **Unit tests only (need fuzz+invariant): 17 contracts** (was 23, -6)
- Added fuzz+invariant: CommitRevealAuction, VibeAMM, VibeLPNFT, VibeStream, VibeOptions, VibeBonds

---

## Session: VibeIntentRouter + VibeProtocolOwnedLiquidity (Feb 16, 2026)

**What was built:** Intent-Based Order Router (VSOS #1) + Protocol-Owned Liquidity (VSOS #9) — completing Protocol/Framework 10/10. 10 new files: 2 interfaces, 2 contracts, 6 test files (unit + fuzz + invariant for each).

### What went well
- Both contracts + all 92 tests passing after 3 build cycles
- Full regression: 407 tests passing, 0 failures
- Intent router correctly routes across AMM, batch auction, cross-chain, factory pool venues
- POL contract cleanly manages deploy/withdraw/collect/rebalance/emergency lifecycle
- Invariant tests with handlers found no violations across 128K random operations each

### What took too long
- **`safeIncreaseAllowance` overflow** — 3 separate occurrences across unit, fuzz, and invariant tests. Test setUp pre-approved with `type(uint256).max`, then contract called `safeIncreaseAllowance` which added to max → panic 0x11. **Now hardened in `testing-patterns.md`.**
- **Low-level calls for missing interface functions** — `IVibeAMM` doesn't have `swap()`. Had to use `abi.encodeWithSignature` + low-level `call`/`staticcall`. Also needed for PoolFactory `quoteAmountOut()`. **Pattern: when an interface is incomplete, use low-level calls rather than modifying the interface (avoids breaking other consumers).**
- **Rebalance token approval bug** — approved `fromPos.token0/token1` instead of `toPool.token0/token1`. Caught by unit test. **Lesson: when moving between two pools, the target pool's tokens need the approval, not the source.**

### Patterns confirmed
1. **Low-level call pattern for missing interface functions**: `(bool ok, bytes memory ret) = target.call(abi.encodeWithSignature("fn(type1,type2)", arg1, arg2))` — safer than modifying shared interfaces
2. **safeIncreaseAllowance in production contracts** — never pre-approve in tests. Let the contract manage its own approvals.
3. **Fuzz lower bounds matter** — `bound(amount, 1, MAX)` with 1 wei produces 0 output from AMM math. Use `1 ether` minimum for meaningful financial operations.
4. **Mock AMM poolId with feeRate** — include feeRate in hash to allow multiple pools for same token pair: `keccak256(abi.encodePacked(token0, token1, feeRate))`
5. **`vm.warp(1000)` before deadline tests** — Foundry starts at `block.timestamp = 1`, so `timestamp - 1 = 0` is treated as "no deadline"

### Go-Live Status
- **Phase 2 Financial: 10/10 COMPLETE**
- **Phase 2 Protocol/Framework: 10/10 COMPLETE**
- **Phase 2 Mechanism Design: 0/10** — all pending
- **Test coverage hardening** remains critical priority (23 contracts need fuzz+invariant)

---

## Session: VibePoolFactory + Codebase Review (Feb 14, 2026)

**What was built:** Modular Pool Factory (VSOS Protocol/Framework #8) — IPoolCurve interface, ConstantProductCurve, StableSwapCurve, VibePoolFactory with curve registry + pool creation + hook integration + quoting. 43 unit tests. Also: full codebase review + knowledge base tuning.

### What went well
- All 5 files compiled first try (1 test event emission fix — minor)
- 43/43 tests passed, 351/351 regression passed, zero issues
- StableSwap Newton's method converged correctly on all test cases
- Catalogue + knowledge base updated same session (self-optimization protocol working)

### What took too long
- **Full `forge build` takes 5+ minutes** on 79 files — compilation is the bottleneck now. Background tasks help but timeout issues persist.

### Codebase Review Findings
1. **98 contracts, 76 test files** — substantial codebase
2. **Only 9/60+ contracts have full unit+fuzz+invariant** — major gap for go-live
3. **22 contracts have ZERO tests** — most are Phase 1 infra (identity, compliance, quantum)
4. **Protocol/Framework: 8/10 done** — missing Intent Routing + POL
5. **Mechanism Design + DeFi/DeFAI: 0/20** — all pending
6. **Frontend: 51 components** — GE redesign partially started

### Patterns confirmed
1. **Pluggable curve architecture** — stateless math contracts + factory state storage. IPoolCurve → ConstantProductCurve / StableSwapCurve. Extensible to concentrated, weighted, etc.
2. **try/catch for optional dependencies** — hook attachment uses graceful degradation. Pool creates even if hook fails. Good for framework robustness.
3. **Same-pair multiple pools** — poolId includes curveId in hash. Enables stable+CP pools for same token pair.

### Go-Live Priorities (1 week)
1. Test coverage hardening (fuzz+invariant for critical paths: CommitRevealAuction, VibeAMM)
2. Frontend GE MVP (inventory, offers, trading post)
3. Deploy script validation
4. Retroactive Shapley claim mechanism for founders

---

## Session: VibeBonds (Feb 14, 2026)

**What was built:** ERC-1155 semi-fungible bond market — Dutch auction yield discovery, Synthetix-style coupons, early redemption with loyalty rewards, native JUL integration (keeper tips + yield boost)

### What went well
- Interface-first design continued to work perfectly: IVibeBonds → VibeBonds → 42 tests
- ERC-1155 pattern (ERC1155Supply + `_update` override for reward tracking) worked cleanly — Synthetix accumulator is the right pattern for pro-rata distributions on semi-fungible tokens
- JUL integration woven in naturally (keeper tips + JUL yield boost) without complicating the core bond logic
- 41/42 tests passed on first run — only 1 test-side arithmetic issue

### What took too long — CRITICAL LESSON
- **Spent 3-4 debug rounds on a `panic(0x11)` that was in TEST code, not contract code.** The trace showed all contract view calls succeeded, meaning the overflow was in the test's own Solidity assertion arguments. I should have:
  1. Run `-vvvv` on the single test FIRST (not `-vvv` on the full suite)
  2. Looked at the line after the last successful trace entry
  3. Recognized "all contract calls succeeded → overflow is in test math"
  4. Fixed the test-side arithmetic instead of re-reading contract internals
- **This is now a hardened skill in `testing-patterns.md` → "Debugging Arithmetic Overflow in Tests"**

### Failure → Skill Hardening (meta-pattern)
- Recurring failures must be converted into documented debugging protocols
- Each protocol: trigger condition → systematic steps → resolution
- Store in the relevant knowledge base file, not just session notes
- This prevents the same time waste across future sessions

### Patterns confirmed
1. **ERC-1155 + Synthetix reward accumulator** is the right combo for semi-fungible financial instruments with periodic payouts (bonds, yield tokens, structured products)
2. **Dutch auction for rate/price discovery** — linear interpolation between max/min over time window, last buyer sets clearing rate, uniform price for all. Reusable for any parameter discovery.
3. **Early redemption with penalty → remaining holders** — `rewardPerTokenStored += penalty * 1e18 / remainingSupply` instantly distributes penalty. Clean pattern.
4. **JUL integration pattern** — `julToken` immutable, `julRewardPool` for tips/boosts, `julBoostBps` for same-token yield enhancement. Portable to any future contract.

---

## Session: VibeOptions (Feb 13, 2026)

**What was built:** ERC-721 European-style options (calls/puts), cash-settled, TWAP pricing

### What went well
- Interface-first design (IVibeOptions → VibeOptions → tests) kept implementation clean
- Reading VibeLPNFT + VibeStream before writing gave me the exact patterns (constructor, _update override, swap-and-pop, CEI) — zero guesswork on boilerplate
- All 31 tests passed first try, zero regressions on 106 existing tests
- Mock contracts (MockOptionsAMM, MockOptionsOracle) kept tests fast and isolated — no need for full AMM proxy setup

### What took too long
- **Deliberation on error semantics**: Spent excessive time deciding whether `ExerciseWindowClosed` vs `OptionNotExpired` was the right revert for reclaim-before-window-end. Tests just use `vm.expectRevert()` without selectors anyway. **Next time: pick the closest error name and move on.**
- **Premium formula unit analysis**: Over-analyzed whether suggestPremium returns token0 or token1 units. It's a view reference function — the writer sets their own premium. **Next time: implement the plan's formula exactly, don't second-guess units on suggestion functions.**
- **Burn function edge cases**: Deliberated on what states allow burn, whether to delete option data, whether writer can still reclaim after burn. **Next time: keep burn minimal — check settled state, call _burn(), don't overthink data cleanup.**
- **forge clean triggered a full recompile** (~5 min for 164 files). Should have just run `forge build` again without cleaning — new files get picked up on second run.

### Patterns to reuse
1. **ERC-721 Financial NFT skeleton** is now confirmed across 3 contracts (VibeLPNFT, VibeStream, VibeOptions):
   - `ERC721, Ownable, ReentrancyGuard`
   - `_nextId = 1`, `_totalCount`, item mapping, `_ownedItems[]` + `_ownedItemIndex`
   - `_update()` override with swap-and-pop for ownership tracking
   - `_removeFromOwned()` helper (identical logic every time)
   - Constructor takes immutable deps, sets ERC721 name/symbol

2. **Mock contract pattern for tests**: Don't inherit the interface. Just implement the 2-3 functions the contract actually calls. Use mappings + set*() functions for configurable return values.

3. **State machine with enum**: `WRITTEN → ACTIVE → EXERCISED → RECLAIMED` (+ CANCELED branch). Each state transition has one function. Check state first, update state before external calls.

4. **Collateral management**: Pull on write, reduce on exercise (`option.collateral -= payoff`), send remainder on reclaim. No separate "owed" mapping needed when the struct tracks it.

5. **TWAP fallback pattern**: `uint256 price = amm.getTWAP(poolId, 600); if (price == 0) price = amm.getSpotPrice(poolId);` — used in VibeLPNFT (entry price), VibeOptions (settlement price).

6. **Test helpers**: `_writeCall()`, `_writePut()`, `_purchaseOption()` — thin wrappers around the contract calls with default params. Makes test bodies readable.

### Recommendations for next financial primitive
- Start from the ERC-721 skeleton (pattern #1 above) and only write the domain logic
- Define the state enum and transitions first — errors fall out naturally
- Write the mock contracts before the test, using only the interface functions the contract imports
- Don't `forge clean` — just build twice if new files aren't picked up
- Use `uint40` for timestamps, pack structs to 32-byte slots, verify with comments

### Forge reminder (Windows)
- Binary: `/c/Users/Will/.foundry/bin/forge.exe`
- `forge` is not on PATH in MINGW — always use full path
- Avoid `forge clean` on large codebases — full recompile takes 5+ min
