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
| PoW in invariant handlers | SHA-256 brute force × 128K calls = days of compute | Cap iteration count to 50K in invariant handlers |
| Testing `assertGe(uint256, 0)` | Always true for unsigned integers | Don't test trivially true properties |

### Coverage Metrics to Track
- **First-try compile rate** — are we writing correct Solidity?
- **First-try test pass rate** — are our invariants and fuzz ranges correct?
- **Bugs found per session** — are we catching real issues?
- **Time per test suite** — are handler designs efficient enough?

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
