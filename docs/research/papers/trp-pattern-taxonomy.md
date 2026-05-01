# TRP Pattern Taxonomy — 53 Rounds of Adversarial Review

*Extracted via R2 (Knowledge) loop of Full Stack RSI, 2026-04-03*

## Overview

53 rounds of Trinity Recursion Protocol adversarial review on VibeSwap's core contracts produced 128+ findings across 9 contracts. This document extracts the **12 recurring vulnerability patterns** — the underlying architectural weaknesses that surface findings cluster around.

These patterns are generalizable beyond VibeSwap. They apply to any DeFi protocol with batch processing, cross-chain messaging, game-theoretic incentives, or proxy architectures.

---

## The 12 Patterns

### 1. Deposit Identity Propagation (10+ findings)

**Contracts**: CrossChainRouter (primary), CommitRevealAuction
**Rounds**: R21, R24, R34-R36, R48

When a proxy contract acts on behalf of a user, `msg.sender` becomes the proxy — not the user. Every downstream operation that records "who deposited" captures the wrong address.

**Root cause**: No unified depositor identity model. Cross-chain router acts as intermediary but doesn't thread original user address through every hop.

**Architectural fix**: Every deposit-accepting function takes an explicit `address depositor` parameter. Recovery functions send to recorded depositor, not current caller.

---

### 2. Settlement-Time Binding (3 findings)

**Contracts**: ShapleyDistributor, CommitRevealAuction
**Rounds**: R19, R24, R49

Parameters that affect economic outcomes (halving schedule, quality weights, fee rates) were bound at game/auction creation time. This creates a manipulation window between creation and settlement.

**Root cause**: TOCTOU (time-of-check to time-of-use) applied to economic parameters.

**Architectural fix**: Read economic parameters at settlement time, or snapshot at commitment time. Never allow mutable parameters bound at creation time.

---

### 3. Rate-of-Change Guards (3 findings)

**Contracts**: CrossChainRouter, VibeAMM, CircuitBreaker
**Rounds**: R41, R48, R24

Absolute bounds on state variables aren't sufficient. An attacker can swing a value from -MAX to +MAX in one transaction if there's no velocity limit.

**Root cause**: Value bounds without velocity bounds.

**Architectural fix**: For every externally-observable state variable, define `|dx/dt| < RATE`. TWAP oracles: per-window drift caps. Liquidity sync: percentage change limits per message. Circuit breakers: reset accumulation after cooldown.

---

### 4. Collateral Path Independence (3 findings)

**Contracts**: CommitRevealAuction
**Rounds**: R46, R38

Multiple code paths can reach the same state change (direct reveal, batch reveal via Core, cross-chain reveal via Router). If only one path validates collateral, the others are bypass vectors.

**Root cause**: Shared validation assumption ("the caller must have checked").

**Architectural fix**: Every path that touches user funds validates independently. Defense in depth at the leaf function, not the entry point.

---

### 5. Batch Invariant Verification (3 findings)

**Contracts**: VibeAMM, CommitRevealAuction
**Rounds**: R16, R28

Sequential operations within a batch create ordering advantages and can temporarily violate invariants. If invariants are checked mid-batch against partially-updated state, false positives/negatives result.

**Root cause**: Invariant checks inside the batch loop instead of at batch boundaries.

**Architectural fix**: Snapshot before batch. Execute all operations. Verify invariant after batch. For ordering fairness: uniform clearing price.

---

### 6. State Accounting Invariants (9 findings)

**Contracts**: ShapleyDistributor, CrossChainRouter, CircuitBreaker
**Rounds**: R16, R19, R24

Single counters that track aggregate state break when the system has multiple entities (multi-token games, multi-chain deposits). Phantom balances, silent under-tracking, and stuck states result.

**Root cause**: Shared accumulator for per-entity accounting.

**Architectural fix**: Per-entity tracking (per-token, per-chain, per-game). Explicit invariant: `sum(individual) == aggregate` verified on every mutation.

---

### 7. Parameter Validation (7 findings)

**Contracts**: ShapleyDistributor, CrossChainRouter, CircuitBreaker
**Rounds**: R19, R21, R24

Admin setter functions that accept `0` as a valid value enable denial-of-service (rate limit = 0 means no messages, breaker threshold = 0 means always tripped).

**Root cause**: Missing bounds on configuration parameters.

**Architectural fix**: Every admin setter validates: non-zero where applicable, within documented range, with explicit min/max constants.

---

### 8. Proxy Pattern Consistency (4 findings)

**Contracts**: VibeAMM, CommitRevealAuction, CrossChainRouter
**Rounds**: R16, R21, R24, R27

Contracts that use `Initializable` without inheriting `UUPSUpgradeable` can be initialized but never upgraded — or worse, upgraded by anyone.

**Root cause**: Inconsistent application of proxy pattern across the codebase.

**Architectural fix**: Enforce uniform pattern: all upgradeable contracts inherit UUPS, implement `_authorizeUpgrade`, and are deployed behind ERC1967 proxies.

---

### 9. Emergency Recovery Paths (4 findings)

**Contracts**: CrossChainRouter, ShapleyDistributor
**Rounds**: R19, R21

Contracts that hold user funds without explicit withdrawal/recovery mechanisms create stuck-fund scenarios when unexpected states occur.

**Root cause**: Happy-path-only design.

**Architectural fix**: Every contract holding funds must have: emergency withdrawal (owner-gated with timelock), stale game cancellation, expired deposit recovery.

---

### 10. Documentation Contradictions (8+ findings)

**Contracts**: All
**Rounds**: R16, R19, R21

NatSpec comments, interface definitions, and catalogue entries that contradict actual code behavior. Comments claim sliding windows but code uses fixed windows. Interfaces miss 14+ public functions.

**Root cause**: Documentation written once and not updated with code.

**Architectural fix**: Generate docs from code where possible. Periodic cross-reference audits. Interface definitions must match implementation exactly.

---

### 11. Integration Convergence (3 findings)

**Contracts**: CircuitBreaker + VibeSwapCore, CrossChainRouter + CommitRevealAuction
**Rounds**: R24, R25

Contracts that reference shared infrastructure (circuit breakers, proxies) but integrate it differently. One contract uses modifiers, another uses inline checks, a third imports but doesn't inherit.

**Root cause**: No integration standard.

**Architectural fix**: Single code path for critical operations. Base contracts enforce the pattern; child contracts inherit without reimplementing.

---

### 12. Discovery Ceiling (meta-pattern)

**Signal**: R39, R40, R42, R44, R47 — all verification-only rounds (0 new findings)

When adversarial review produces 0 new findings across 3+ consecutive rounds on the same target, that target has reached discovery ceiling. R50-R53 shifting entirely to test infrastructure (not contract logic) confirmed system-wide ceiling.

**Application**: Recognize saturation and reallocate effort. This is the stopping criterion for R1 (adversarial code review) and the trigger for R2-R3 (knowledge extraction, capability building).

---

## Severity Distribution (R16-R53)

| Severity | Found | Closed | Open | Closure Rate |
|----------|-------|--------|------|-------------|
| CRITICAL | 3 | 3 | 0 | 100% |
| HIGH | 27 | 27 | 0 | 100% |
| MEDIUM | 48 | 47 | 1* | 98% |
| LOW | 18 | 18 | 0 | 100% |

*AMM-07 (fee path inconsistency) intentionally deferred — design decision, not bug.

## Contract Heat Map (Discovery Density)

| Contract | Total Findings | Discovery Ceiling Round | Status |
|----------|---------------|------------------------|--------|
| CrossChainRouter | 25+ | R48 | Saturated |
| CommitRevealAuction | 15+ | R46 | Saturated |
| ShapleyDistributor | 15+ | R43 | Saturated |
| VibeAMM | 10+ | R41 | Saturated (1 design defer) |
| CircuitBreaker | 9 | R40 | Saturated |
| FeeController | 3 | R17 | Saturated |
| VibeSwapCore | 2 | R25 | Saturated |

## Cross-Pattern Relationships

```
Deposit Identity ←→ Collateral Path Independence
  (identity loss enables collateral bypass)

Settlement-Time Binding ←→ Rate-of-Change Guards
  (both address temporal manipulation windows)

Batch Invariant ←→ State Accounting
  (batch processing amplifies accounting errors)

Integration Convergence ←→ Proxy Pattern Consistency
  (both address cross-contract uniformity)

Discovery Ceiling ←→ ALL
  (meta-pattern that governs when to stop looking)
```

---

*53 rounds. 128+ findings. 12 patterns. The patterns are the knowledge. The findings are the evidence.*

*Built in a cave, with a box of scraps.*

---

## See Also

- [TRP Core Spec](../../concepts/ai-native/TRINITY_RECURSION_PROTOCOL.md) — Full protocol specification
- [TRP Empirical RSI](trp-empirical-rsi.md) — 53-round empirical evidence (companion paper)
- [TRP Runner Paper](trp-runner/trp-runner-paper.md) — Crash-resilient recursive improvement
- [Efficiency Heat Map](../../_meta/trp-existing/efficiency-heatmap.md) — Per-contract discovery yield tracking
- [Loop 1: Adversarial](../../_meta/trp-existing/loop-1-adversarial-verification.md) — The loop that generated these patterns
- [Loop 2: Knowledge](../../_meta/trp-existing/loop-2-common-knowledge.md) — The loop that extracted these patterns
