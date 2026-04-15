# Proposals Ledger

Canonical store for options/alternatives proposed to Will for decision. Survives session crashes.
Appended by `~/.claude/session-chain/proposal-scraper.py` (Stop hook) and by the Propose→Persist primitive.

Format per entry:
```
## <topic> — <timestamp>
**Session**: <session-id>
**Status**: proposed | acted-on | superseded

<options content>
```

---

## Full-Stack RSI — Cycle 11 options — 2026-04-15 04:54 UTC (RECOVERED)

**Session**: `5ba12ced-49bc-424a-9145-a73ee63cbeb6` (crashed on API 500)
**Status**: acted-on — Will chose A + D before crash
**Recovered by**: transcript-mining on 2026-04-15 from JSONL line 1120

- **C11-A**: Fresh scope — audit NCI again (rebase-invariant accounting may have crept into consensus paths)
- **C11-B**: Property-based fuzzing — offCirculation invariants under registration churn, challenge-response edge cases
- **C11-C**: Meta-audit — review the C9/C10 fixes themselves for regressions (the adversarial-recursion pattern)
- **C11-D**: Extend challenge-response pattern to other self-reported metrics (TWAP, uptime, fee multipliers) — generalization loop

**Will's selection**: A + D (parallel — fresh scope + generalization loop)
