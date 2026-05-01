# First-Available Trap — Stack Audit v1 (2026-04-21)

**Subject**: VibeSwap core mechanisms, audited against the framework in `FIRST_AVAILABLE_TRAP.md`.

**Method**: four-step framework — (1) decompose threat to predicate, (2) identify which clause mechanism negates, (3) adversarial reduction, (4) prefer elimination over mitigation. Applied to mechanisms in the stack where first-available framings have real pull.

**Skipped (already proven mechanism-fit in prior analysis)**: commit-reveal batch auction, Shamir-3-of-5 persistence, VibeSwap XOR-of-revealed-secrets randomness beacon, memory tier externalization, UUPS proxy + reinitializer gates (C29/C30), priority auction with LP redistribution, Fisher-Yates deterministic shuffle.

---

## Findings summary

| Mechanism | Verdict | Action |
|-----------|---------|--------|
| IL Protection Vault | **Candidate for simplification** — may be insurance against a risk the batch-auction already attenuates | Measure post-mainnet; consider retirement |
| TWAP + 5% deviation gate | **Honest mitigation** — continuum defense, adequate for non-existential use | Queue commit-reveal oracle aggregation for R3 |
| Circuit breakers | **Honest mitigation** — admitted policy-level safety floor | Invest in adaptive fee curves to reduce firing domain |
| Fibonacci rate limiter | **Mechanism-fit from inception** — progressive throughput damping designed deliberately, not defaulted; Sybil-at-address-granularity gap is consciously-accepted residual bounded by batch-auction impact pricing | Documentation drift fix only |

No pure First-Available Traps in the audited surface. Two candidates for simplification (IL Vault, rate limiter if documentation implies crude cap). The batch-auction primitive is load-bearing enough that several downstream defenses lean on it — this is the expected signature of a Path B mechanism choice.

---

## Audit 1 — IL Protection Vault

**Threat predicate**: ∃ LP L, ∃ price trajectory π, such that L's realized return at withdrawal < L's would-be return from holding outside the pool by a margin δ > 0 sufficient to deter entry.

**Current mechanism**: tiered coverage (25%/50%/80% by stake duration) funded by priority bid revenue + early-exit penalties.

**Clause negated**: none — pays LPs *after* IL occurs, does not prevent it. Cost is transferred to another pool, not eliminated.

**Adversarial reduction**: the "adversary" is market dynamics; high volatility + trending price drains the Vault. Cost to adversary: zero (it's not a rational actor). No structural block — finite-depth pool facing unbounded IL generation.

**Elimination alternatives**:
1. Oracle-priced / solver-model AMM (LPs passive, trades settle against oracle ± solver fee)
2. LVR-minimizing curves (McMenamin et al. 2023)
3. **Batch-auction with uniform clearing** — already deployed: LPs don't face continuous adversarial repricing
4. Concentrated liquidity with active LP management (Uniswap v3)

**Verdict**: **First-Available-Trap candidate, medium-high confidence.** The Vault is insurance against a symptom; the batch-auction primitive already partially eliminates the source. Post-mainnet, if claim incidence is low, the Vault is legacy and its revenue flows (priority bid % + early-exit penalty %) can be routed directly to LPs — simpler, cheaper, same user outcome.

**Action**: empirical — instrument Vault claim frequency and IL incidence on mainnet launch. Re-audit post-volume. If data supports retirement, merge Vault revenue streams into general LP compensation.

---

## Audit 2 — TWAP oracle with 5% deviation gate

**Threat predicate**: ∃ adversary A, ∃ moment t, such that A can cause reported price p̂(t) to differ from true market price p(t) by > ε sufficient to unlock extractable value from downstream mechanisms.

**Current mechanism**: time-weighted average over window, 5% per-update deviation rejection.

**Clause negated**: attenuates (not eliminates) the "can cause price divergence" clause. Both TWAP smoothing and the 5% gate are **continuum defenses** — attacker pays more (sustained pressure, capital at risk) to push through.

**Adversarial reduction**: adversary with sufficient capital holds price off-market across the TWAP window. Cost scales with window length × liquidity depth, finite not infinite.

**Elimination alternatives**:
1. Multi-source median oracle (Chainlink-style) — requires quorum corruption
2. **Commit-reveal oracle updates** — exact pattern as batch auction: oracles commit prices, reveal together, median computed. No source knows others' submissions until after commit.
3. zk-proof of external attested price
4. Eliminate price-dependence entirely where possible (collateral-ratio thresholds over absolute prices)

**Verdict**: **Honest mitigation**. TWAP + 5% gate is defensible engineering — cheap, standard, works for most paths. For existential dependencies (VibeStable liquidation per `C7-GOV-008`), the 5% gate alone is thin.

**Action**: queue for R3 of Oracle Audit Rounds: extend commit-reveal primitive one layer up into oracle aggregation. Priority: moderate. Mechanism-fit debt, not security-critical.

---

## Audit 3 — Circuit breakers (volume / price / withdrawal thresholds)

**Threat predicate**: ∃ market event E such that unconstrained execution of pending orders + withdrawals during E produces cascading insolvency or guarantee-breaching pricing.

**Current mechanism**: threshold-based halts on abnormal volume / price moves / withdrawal volume.

**Clause negated**: none — halt *defers* execution; queued imbalance persists. This is policy-level mitigation.

**Adversarial reduction**: attacker knows thresholds. Strategies: stay just under volume threshold (persistent low-rate drain); drive price to halt, wait, resume from off-balance state; front-run the halt (enter right before expected breaker trip).

**Elimination alternatives**:
1. Adaptive fee curves — fee grows superlinearly with volume/price-move → cascade profit motive drops organically
2. Dynamic reserves — Treasury Stabilizer expanded to auto-provide liquidity during stress rather than halting (partial version already exists for bear markets)
3. Graceful throughput degradation rather than binary halt
4. Make pathological state structurally impossible via invariants

**Verdict**: **Honest mitigation, conscious admission**. Circuit breakers are safety-floor mechanisms — humans need response time. Not a trap because the designer presumably knew it was mitigation.

**Action**: invest in #1 + #2 above as preventive measures; let breakers remain as last-resort. Reduce firing frequency over time rather than removing the mechanism. Lower the policy-to-mechanism ratio progressively.

---

## Audit 4 — Fibonacci-scaled rate limiter

**Threat predicate**: ∃ adversary A such that A can extract δ > 0 by making many rapid interactions with a single pool (drain, spam, repeated arbitrage of stale state).

**Current mechanism** (`contracts/libraries/FibonacciScaling.sol:200`, `contracts/amm/VibeAMM.sol:1683`): per-user per-pool volume tracking over a 1-hour window. As user utilization rises, marginal capacity damps along Fibonacci retracement levels (23.6% / 38.2% / 50% / 61.8%). At saturation, cooldown = window × 1/φ. Fibonacci sequence governs tier progression.

**Clause negated**: attenuates the "many rapid interactions" clause with a progressive impact-pricing curve. Not a binary elimination, but also not a flat cap — the curve is mechanism-designed. **Will confirms**: Fibonacci scaling was designed from day 1, not imported from a default library.

**Adversarial reduction**:
- Single-address drain: Fibonacci damping kicks in; attacker cost rises non-linearly.
- Sybil-split across N addresses: N × full bandwidth available. The per-address granularity does not block this.
- Within-batch drain: batch-auction structural impact pricing independently prices large orders against themselves (uniform clearing price moves).

**Verdict**: **Mechanism-fit from inception.** Fibonacci scaling is a deliberately-designed curve matching the throughput-damping shape wanted, not a first-available flat cap. The address-granularity Sybil gap is a **consciously-accepted residual** bounded by the batch-auction's own structural impact pricing: even N Sybil addresses moving aggregate volume will move the clearing price against themselves and pay the impact cost.

**Action**: documentation only. Fix CLAUDE.md stale reference ("100K tokens/hour/user" → "Fibonacci-scaled throughput tiers, 1-hour window, per-user per-pool"). No code change.

---

## What the audit reveals about Path B choice

The consistent pattern across the audit: mechanisms chosen after batch-auction + uniform clearing were designed **deliberately** (Fibonacci scaling, Shapley distribution, priority-auction-with-redistribution). Mechanisms that predate or sit outside that structural choice (IL Vault, TWAP, circuit breakers) are more mitigation-shaped.

This is the signature of a Path B mechanism choice propagating downstream: the structural primitive (uniform clearing) absorbs a lot of what would otherwise need defensive mitigation. Post-mainnet, the stack can likely simplify by leaning harder on the batch-auction primitive and retiring downstream defenses that are redundant with it.

---

## Outstanding items to track

1. **Post-mainnet: measure IL incidence** — decide Vault retirement based on data (Audit 1).
2. **R3 Oracle Audit Rounds: commit-reveal oracle aggregation** — TWAP hardening (Audit 2).
3. **Future cycle: adaptive fee curves + expanded Treasury Stabilizer** — reduce circuit-breaker firing domain (Audit 3).
4. **Documentation fix: CLAUDE.md rate-limiter description** — no code change, stale prose (Audit 4).

All four added to `memory/project_rsi-backlog.md`.

---

*VibeSwap Protocol — First-Available Trap Stack Audit v1 — 2026-04-21*
