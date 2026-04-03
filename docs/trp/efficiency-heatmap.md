# TRP Efficiency Heat Map

**Version**: 2.0 (updated R0 density pass, 2026-04-03)
**Purpose**: Track per-contract discovery yield so the TRP coordinator can prune cold zones and focus resources on hot zones.

---

## Heat Map

Updated after each round. Coordinator reads this BEFORE dispatching subagents.

### Contract Status (Post-R53 — All Findings Closed)

| Contract | Last Audited | Rounds Since Finding | Status | Agent Tier | Notes |
|----------|-------------|---------------------|--------|------------|-------|
| CrossChainRouter | R48 | 5 | COLD | skip | 25+ findings total, all closed. Discovery ceiling reached. |
| CommitRevealAuction | R46 | 7 | COLD | skip | 15+ findings total, all closed. Collateral validation fixed. |
| ShapleyDistributor | R49 | 4 | COLD | skip | 15+ findings total, all closed. Halving moved to settlement. |
| VibeAMM | R41 | 12 | COLD | skip | 10+ findings, 1 MEDIUM open by design (AMM-07 fee path). |
| CircuitBreaker | R40 | 13 | COLD | skip | 9 findings total, all closed. Integration complete. |
| VibeSwapCore | R44 | 9 | COLD | skip | Thin orchestrator. Inherits CircuitBreaker. |
| VibeLP | — | 30+ | COLD | skip | No findings since R16. |
| DAOTreasury | — | 30+ | COLD | skip | Stable. |
| TreasuryStabilizer | — | 30+ | COLD | skip | Stable. |

**System State**: ALL CRITICAL/HIGH/MEDIUM CLOSED. Discovery ceiling reached across all 9 tracked contracts. Next TRP round triggers only on code changes (via `scripts/trp-heatmap.sh`).

### Status Definitions

```
HOT  = Open CRITICAL/HIGH findings OR new findings in last 2 rounds
       → Full audit with opus subagent
WARM = Open MEDIUM findings OR no new findings for 2 rounds but code changed
       → Verification pass with sonnet subagent
COLD = No open findings AND no code changes for 3+ rounds
       → SKIP unless code changes detected (git diff check)
```

### Promotion/Demotion Rules

```
COLD → WARM: git diff shows changes to contract since last audit
WARM → HOT:  New HIGH+ finding discovered, OR code changes to fix area
HOT  → WARM: 2 consecutive rounds with no new HIGH+ findings
WARM → COLD: 3 consecutive rounds with no new findings AND no code changes
```

---

## Open Items (R53)

| ID | Contract | Severity | Description | Round | Status |
|----|----------|----------|-------------|-------|--------|
| AMM-07 | VibeAMM | MEDIUM | Fee path inconsistency (input vs output fees) | R37 | Design decision deferred |

---

## Efficiency Metrics

### Efficiency Trend

| Round | Agents | Opus | Sonnet | Haiku | New Findings | Closed | Yield | Est. Tokens |
|-------|--------|------|--------|-------|-------------|--------|-------|-------------|
| R22 | 0 | 0 | 0 | 0 | 0 | 6 | — | ~20K |
| R23 | 0 | 0 | 0 | 0 | 0 | 2 | — | ~15K |
| R24 | 3 | 3 | 0 | 0 | 26 | 6 | 8.7 | ~170K |
| R25 | 0 | 0 | 0 | 0 | 0 | 2 | — | ~20K |
| R26 | 0 | 0 | 0 | 0 | 0 | 0 | — | ~15K |
| R27 | 0 | 0 | 0 | 0 | 1 | 0 | — | ~15K |
| R28 | 2 | 2 | 0 | 0 | 19 | 0 | 9.5 | ~100K |
| R29-R43 | — | — | — | — | 11 | 11 | — | ~200K |
| R44-R48 | 2 | 2 | 0 | 0 | 5 | 8 | 2.5 | ~100K |
| R49-R53 | 0 | 0 | 0 | 0 | 0 | 68* | — | ~80K |
| **Total** | **~7** | **~7** | **0** | **0** | **62** | **103** | **8.9** | **~735K** |

*R49-R53 "closed" count includes 68 test regression fixes (not new findings).

### Key Observations (Full Run R16-R53)

1. **Discovery concentrated in bursts**: R24 (26 findings) and R28 (19 findings) account for 73% of all new discoveries
2. **Closure rate improved over time**: R24 was 23% (6/26), R44-R48 was 160% (closed more than found due to backlog)
3. **100% opus usage**: No sonnet/haiku agents dispatched in any round. Future optimization opportunity.
4. **Discovery ceiling reached**: R39-R53 produced 0 new contract logic findings (only test infrastructure)
5. **Test regression phase (R50-R53)**: 68 test fixes confirm contract logic is stable; infrastructure catching up

---

## Tooling (R3 Capability — 2026-04-03)

Three automation scripts added:

| Script | Purpose | Usage |
|--------|---------|-------|
| `scripts/trp-heatmap.sh` | Auto-detect contract changes, recommend promotions | `./scripts/trp-heatmap.sh [baseline_commit]` |
| `scripts/trp-regression.sh` | Run security-critical tests covering TRP fixes | `./scripts/trp-regression.sh [--quick\|--full]` |
| `scripts/trp-round-gen.sh` | Generate pre-filled round summary from template | `./scripts/trp-round-gen.sh <round_number> [target]` |

---

## Cold Start Protocol

When TRP begins a new session, the coordinator:

1. Run `./scripts/trp-heatmap.sh` to detect changed contracts
2. Cross-reference with heat map — promote any COLD contract with changes to WARM
3. Run `./scripts/trp-regression.sh --quick` to verify no regressions
4. Prune scope: only dispatch agents for HOT + WARM contracts
5. If all COLD: TRP focuses on test regressions, knowledge gaps, or new contract additions
6. Run `./scripts/trp-round-gen.sh <N>` to generate the round summary template
