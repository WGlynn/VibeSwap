# VibeSwap Test Coverage Methodology

## Purpose

This document defines how we systematically build and improve fuzz + invariant test coverage for VibeSwap contracts. It serves as both a reference and a self-improvement framework — each session teaches us something, and those lessons feed back into the methodology itself.

---

## 1. Contract Selection: Prioritized Risk Ordering

We don't test contracts in arbitrary order. Selection follows a risk-weighted priority system:

### Priority Tiers

| Tier | Criteria | Examples |
|------|----------|----------|
| **P0 — Critical** | User funds at direct risk, core protocol logic | CommitRevealAuction, VibeAMM, VibeCredit, VibeSynth |
| **P1 — High** | User funds at indirect risk, financial instruments | VibeLPNFT, VibeStream, VibeOptions, VibeBonds, DAOTreasury |
| **P2 — Medium** | Protocol fairness/economics, governance | ShapleyDistributor, Joule, QuadraticVoting, ConvictionGovernance |
| **P3 — Low** | Infrastructure, identity, compliance | CircuitBreaker, SoulboundIdentity, ComplianceRegistry |

### Selection Rules per Session
1. Pick 2-4 contracts from the **highest untested tier**
2. Prefer contracts that compose on each other (test interactions implicitly)
3. Skip contracts with excessive system dependencies that would need 5+ mocks — revisit when integration test harnesses exist
4. Never mix contract selection with contract writing in the same session (build OR test, not both)

### Pre-Session Checklist
- Check which contracts already have fuzz/invariant coverage (avoid duplicating)
- Read the unit test file first — understand the contract's interface and setUp pattern
- Read the contract itself — identify state machines, mathematical invariants, and authorization boundaries

---

## 2. Test Design: Three Distinct Layers

Each test layer targets a different class of bugs. **They are NOT redundant.**

### Layer 1: Unit Tests (existing)
- **What they catch**: Single-function correctness, happy path, revert conditions
- **Pattern**: `test_functionName_scenario()`
- **Already exist** for most contracts — we don't duplicate these

### Layer 2: Fuzz Tests
- **What they catch**: Boundary conditions, edge cases, mathematical properties under random inputs
- **Pattern**: `testFuzz_propertyName(uint256 input1, uint256 input2)`
- **Design principle**: Each test asserts a **mathematical property** that must hold for ALL valid inputs

#### Fuzz Test Categories (pick the relevant ones per contract)
| Category | Description | Example |
|----------|-------------|---------|
| **Boundary enforcement** | Admin params stay within declared bounds | `timelockDuration ∈ [MIN, MAX]` |
| **Accumulation correctness** | Cumulative trackers match sum of operations | `totalFees = Σ individual fees` |
| **State machine transitions** | Operations produce correct state changes | `cancel → prevents execute` |
| **Mathematical properties** | Domain-specific math holds under all inputs | `EMA output ∈ [min(price1, price2), max(price1, price2)]` |
| **Conservation laws** | Something is preserved across operations | `transfer preserves totalSupply` |
| **Monotonicity** | A function is increasing/decreasing in the right direction | `Moore's Law factor decreases over time` |
| **Cooldown/timing** | Time-based gates work correctly | `rebase reverts before cooldown expires` |

### Layer 3: Invariant Tests
- **What they catch**: Multi-operation sequence bugs that emerge from random composition
- **Pattern**: Handler contract with state-modifying functions + invariant assertions
- **Design principle**: Invariants describe properties that must hold **after any sequence** of valid operations

#### Invariant Test Categories (pick the relevant ones per contract)
| Category | Description | Example |
|----------|-------------|---------|
| **Accounting consistency** | Ghost variables match on-chain state | `nextRequestId = ghost_count + 1` |
| **Conservation** | Sum of parts equals the whole | `executed + cancelled + pending = total` |
| **Solvency** | Contract never owes more than it has | `token.balanceOf(contract) >= obligations` |
| **Range bounds** | State variables stay within declared ranges | `difficulty > 0 always` |
| **Monotonicity** | Counters never decrease | `totalGamesCreated only increases` |
| **Axiom verification** | Domain-specific mathematical axioms | `Σ shapleyValues = totalValue (efficiency)` |
| **State immutability** | Once a state is final, it doesn't change | `settled games stay settled` |

---

## 3. Handler Design: The Art of Meaningful Randomness

The handler is the most important part of invariant testing. Bad handlers produce useless coverage.

### Handler Design Rules
1. **Each handler function = one user action** (not a composite)
2. **Use `bound()` for all fuzzed inputs** — constrain to realistic ranges
3. **Use ghost variables** to track expected state independently from the contract
4. **Handle failures gracefully** — `try/catch` around external calls, `if (precondition) return;` for invalid states
5. **Include time advancement** as a handler function — many bugs only appear after time passes
6. **Keep the search space manageable** — cap iterations in loops, limit array sizes to `&& i < 5` in invariant assertions
7. **Track active entities** — maintain arrays of active positions/requests/games for the handler to randomly select from

### Mock Design Rules
1. **Unique prefix per file** — `MockTreasuryFToken`, `MockJouleIOracle`, etc. (prevents Solidity name collisions)
2. **Minimal surface** — only implement functions the contract actually calls
3. **Configurable returns** — use `set*()` functions for test-driven behavior
4. **Copy setUp from unit tests** — they've already figured out the dependency wiring

---

## 4. Self-Improvement Protocol

### After Each Session
1. **Record bugs found** — what the invariant caught that unit tests missed
2. **Record false positives** — tests that failed due to test-side issues, not contract bugs
3. **Record test design mistakes** — invariants that were trivially true or never triggered
4. **Update this document** if a new pattern or anti-pattern emerged

### Known Anti-Patterns (learned from experience)
| Anti-Pattern | What Happened | Fix |
|--------------|---------------|-----|
| `assertGt` for BPS-precision math | Integer division makes small changes invisible | Use `assertGe` when rounding can make values equal |
| Ghost tracking interest-bearing amounts | `repaid > borrowed` because interest accrues | Track interest separately, don't compare raw amounts |
| `type(uint256).max` pre-approval in setUp | Contract calls `safeIncreaseAllowance`, overflows | Let contracts manage their own approvals |
| PoW in invariant handlers | SHA-256 brute force × 128K calls = days of compute | Pre-mine in setUp, handler only exercises non-PoW functions |
| Testing `assertGe(uint256, 0)` | Always true for unsigned integers | Don't test trivially true properties |
| Ghost double-counting idempotent ops | Contract allows `deactivateRecord()` on already-inactive record (no revert). Ghost counter increments on every success → `ghost_deactivations > ghost_records`. | Track which unique keys have been counted with a `mapping(bytes32 => bool)`. Only increment ghost on first occurrence. **General rule**: Any contract op that is idempotent (succeeds silently on re-call) needs deduplication tracking in the handler. |

### Coverage Metrics to Track
- **First-try compile rate** — are we writing correct Solidity?
- **First-try test pass rate** — are our invariants and fuzz ranges correct?
- **Bugs found per session** — are we catching real issues?
- **Time per test suite** — are handler designs efficient enough?

### Iterative Learning Log (Proof of Mind)

Every bug, false positive, or design mistake is a learning event. Each entry below represents genuine reasoning evolution — not just fixes, but *why* the fix was needed and what generalizable principle was extracted. This log is append-only and provides a traceable chain of cognitive improvement.

| Session | Bug/Issue | Root Cause | Principle Extracted | Files Affected |
|---------|-----------|------------|---------------------|----------------|
| S8 | VibeSynth fuzz overflow on synth price calc | BPS-precision division with very small collateral values | Always `bound()` collateral to ≥ 1 ether when price math involves division | VibeSynthFuzz.t.sol |
| S9 | Joule invariant timeout (10+ min) | SHA-256 PoW in handler × 128K calls | Never put computationally expensive ops in handlers. Pre-compute in setUp. | JouleInvariant.t.sol |
| S10 | PriorityRegistry ghost accounting mismatch | `deactivateRecord()` is idempotent — succeeds on re-call without revert. Ghost counter incremented on every success. | **Idempotent operations need deduplication tracking.** Any contract function that succeeds silently on repeated calls will inflate ghost counters. Track `seen` state with mappings. | PriorityRegistryInvariant.t.sol |
| S12 | CYT multi-stream overspend: totalStreamed > totalFunding | `_settleStream` capped `claimable` against `idea.totalFunding - stream.totalStreamed` (per-stream), but multiple streams each independently capped against the full idea funding, allowing collective overspend. | **When multiple entities share a global resource pool, cap against the global aggregate, not per-entity maximums.** Use `_totalStreamedForIdea()` not `stream.totalStreamed`. This is the streaming analogue of the double-spend — each stream "sees" the full pool independently. | ContributionYieldTokenizer.sol, ContributionYieldTokenizerInvariant.t.sol |
| S14 | vm.expectRevert consumed wrong call (getter instead of target function) | `vm.expectRevert()` consumes the NEXT external call. If you call `cb.VOLUME_BREAKER()` between `expectRevert` and the target call, the getter absorbs the revert expectation. | **Always pre-compute any values BEFORE `vm.expectRevert()`.** The line immediately after `expectRevert` must be the call you expect to revert — no getter calls, no view functions, nothing in between. | CircuitBreaker.t.sol |
| S14 | CircuitBreaker abstract contract needs no proxy | Deployed abstract `CircuitBreaker` (inherits `OwnableUpgradeable` only, not `UUPSUpgradeable`) through `ERC1967Proxy`. While it technically works, it adds unnecessary complexity. | **Abstract contracts that inherit `OwnableUpgradeable` but NOT `UUPSUpgradeable` can be deployed directly without a proxy.** Only use ERC1967Proxy when the contract explicitly inherits UUPSUpgradeable. | CircuitBreaker.t.sol, CircuitBreakerFuzz.t.sol |
| S14 | Fuzz arithmetic underflow: `threshold / numUpdates - 1` when quotient is 0 | `bound(value, 0, threshold / n - 1)` underflows when `threshold < n`. The division produces 0, then subtracting 1 wraps. | **In fuzz bound calculations involving division, always check the quotient is > 0 before subtracting.** Use `if (maxPerUpdate == 0) return;` to skip degenerate cases. | CircuitBreakerFuzz.t.sol |
| S19 | UI overhaul broke Web3Modal: social login → blank page, third-party modal inputs unstyled | Three global CSS rules polluted third-party components: (1) `z-index: 9999` noise overlay above modals, (2) `*, *::before, *::after` transition timing applied to ALL elements including Web3Modal internals, (3) `input:focus { !important }` overrode Web3Modal input styles. Also: Web3Modal v5 shows social login buttons by default even when WalletConnect Cloud isn't configured for email auth. | **CSS Isolation Primitive: Never use unscoped global selectors (`*`, `input`, `select`) when third-party components render in the same DOM tree. Always scope to `#root` or a component class. Never set z-index > 50 on decorative overlays — modals use z-50. Never enable Web3Modal features (email, socials) without verifying WalletConnect Cloud configuration.** | index.css, useWallet.jsx, SwapCore.jsx |
| S28 | CKB SDK `checked_mul(PRECISION)` overflow in TWAP/price calculations | `reserve.checked_mul(PRECISION)` overflows u128 when reserve > ~340 tokens (340 * 1e18 * 1e18 > 2^128). All 4 TWAP update sites and 2 entry_price calculations used this pattern. Tests passed at small amounts but would fail in production with any non-trivial pool. | **Never use `checked_mul(PRECISION)` for prices derived from reserves. Always use `mul_div(a, b, c)` which computes `a * b / c` using 256-bit intermediate arithmetic. This applies to ANY u128 math where two 1e18-scaled values are multiplied.** The `wide_mul` → `mul_div` pattern exists for exactly this reason. | sdk/src/lib.rs (add_liquidity, remove_liquidity, create_pool, create_settle_batch) |

**Rules for this log:**
1. Every entry must include the generalizable principle, not just the fix
2. Principles must be actionable — another agent reading this should know exactly what to do differently
3. Before writing any new handler, scan this table for applicable anti-patterns
4. This log serves as **proof of iterative cognitive improvement** — each entry demonstrates reasoning that didn't exist before the error

### When to Revisit a Contract
- After a contract is modified (new functions, changed logic)
- When a new integration is added (e.g., DAOTreasury gets a new authorized caller)
- When a related contract's invariant test finds a bug (check if the same bug class applies)

---

## 5. Current Coverage Status

Updated after each session. See `build-recommendations.md` for per-session details.

### Coverage Tiers
- **Full (unit + fuzz + invariant)**: The contract is production-ready from a testing perspective
- **Unit only**: The contract has basic correctness tests but hasn't been stress-tested with random inputs
- **Zero**: The contract has no tests at all — prioritize based on risk tier

### Decision: When is a Contract "Done"?
A contract is considered test-complete when:
1. All unit tests pass
2. Fuzz tests cover every mathematical property and boundary condition
3. Invariant tests verify all conservation laws, accounting invariants, and solvency conditions
4. The invariant handler exercises all state-modifying functions
5. Ghost variables independently verify all cumulative counters

---

## 6. Tooling Reference

```bash
# Run specific test suite
forge test --match-contract "ContractNameFuzz" -vvv

# Run with traces for debugging failures
forge test --match-test "testFuzz_specificTest" -vvvv

# Regression (full suite)
forge test --match-contract "AuctionAMMIntegration|MoneyFlow|VibeSwap|VibeLPNFT|..." -vv

# Invariant tuning (in foundry.toml)
[invariant]
runs = 256
depth = 500
```

### Debugging Protocol (from testing-patterns.md)
1. Run failing test with `-vvvv` (single test, max verbosity)
2. If all contract calls succeed in trace → overflow is in test code, not contract
3. Check ghost variable arithmetic for overflow
4. Check `bound()` ranges — are they producing valid inputs?
5. Check mock return values — are they configured correctly for the test scenario?
