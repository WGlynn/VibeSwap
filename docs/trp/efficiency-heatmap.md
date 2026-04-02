# TRP Efficiency Heat Map

**Version**: 1.0
**Purpose**: Track per-contract, per-section discovery yield so the TRP coordinator can prune cold zones and focus resources on hot zones.

---

## Heat Map

Updated after each round. Coordinator reads this BEFORE dispatching subagents.

### Contract Status

| Contract | Last Audited | Rounds Since Finding | Status | Agent Tier | Notes |
|----------|-------------|---------------------|--------|------------|-------|
| CrossChainRouter | R27 | 0 | HOT | opus | NEW-01 CRITICAL still open. Architectural redesign needed. |
| CommitRevealAuction | R26 | 0 | HOT | opus | Collateral underpricing still open. R1 found 9 new findings. |
| ShapleyDistributor | R24 | 0 | WARM | sonnet | N03 HIGH open. Others medium/low. Discovery yield declining. |
| CircuitBreaker | R25 | 1 | WARM | sonnet | CB-02/04/05 open but known. New discovery unlikely without code change. |
| VibeAMM | R25 | 0 | HOT | opus | R1 subagent found AMM-01 CRITICAL (batch swap k-invariant). 10 findings. |
| VibeSwapCore | R27 | 0 | WARM | sonnet | Integration gap (CB-02), but contract itself is thin orchestrator. |
| VibeLP | — | 3+ | COLD | skip | No findings since R16 settlement pipeline fixes. |
| DAOTreasury | — | 5+ | COLD | skip | Stable. No recent changes. |
| TreasuryStabilizer | — | 5+ | COLD | skip | Stable. No recent changes. |

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

## Efficiency Metrics (Per Round)

Track these in each round summary going forward:

```yaml
efficiency:
  agents_spawned: N          # count of subagents dispatched
  agent_tiers:               # breakdown by model
    opus: N
    sonnet: N
    haiku: N
  contracts_audited: N       # number of contracts in scope
  contracts_skipped: N       # number of COLD contracts pruned
  findings_new: N            # newly discovered
  findings_closed: N         # fixed this round
  closure_rate: N%           # closed / (open at start + new)
  yield: N                   # new findings per agent spawned
  estimated_tokens: N        # rough estimate (small=5K, medium=20K, large=50K per agent)
```

### Efficiency Trend

| Round | Agents | Opus | Sonnet | Haiku | New Findings | Closed | Yield | Est. Tokens |
|-------|--------|------|--------|-------|-------------|--------|-------|-------------|
| R22 | 0 | 0 | 0 | 0 | 0 | 6 | — | ~20K (coordinator only) |
| R23 | 0 | 0 | 0 | 0 | 0 | 2 | — | ~15K (coordinator only) |
| R24 | 3 | 3 | 0 | 0 | 26 | 6 | 8.7 | ~170K |
| R25 | 0 | 0 | 0 | 0 | 0 | 2 | — | ~20K (coordinator only) |
| R26 | 0 | 0 | 0 | 0 | 0 | 0 | — | ~15K (verification) |
| R27 | 0 | 0 | 0 | 0 | 1 | 0 | — | ~15K (integration) |
| R1-late | 2 | 2 | 0 | 0 | 19 | 0 | 9.5 | ~100K |
| **Total** | **5** | **5** | **0** | **0** | **46** | **16** | **9.2** | **~355K** |

### Observations (R22-R27)

1. **100% opus** — every subagent ran on opus. Verification rounds (R25, R26) could have used sonnet.
2. **Zero haiku usage** — cleanup tasks (dead imports, NatSpec) dispatched to opus. Waste.
3. **Discovery concentrated in R24** — 26 of 46 findings came from one round (3 agents). High-yield rounds should be identified and replicated.
4. **Diminishing returns per contract** — CrossChainRouter: R22 found 0 new (cure only), R24 found 11 (fresh scope). Suggests: fresh scope > re-audit.
5. **Closure rate 35%** (16/46) — below the 50% target in TRP Runner v2.0 scoring.

---

## Cold Start Protocol

When TRP begins a new session, the coordinator:

1. `git diff <last_audited_commit>..<HEAD> -- contracts/` to detect changed files
2. Cross-reference with heat map — promote any COLD contract with changes to WARM
3. Prune scope: only dispatch agents for HOT + WARM contracts
4. Estimate total agent count — if > 2, serialize (rate limit constraint)
5. Log skipped contracts and reason in round summary
