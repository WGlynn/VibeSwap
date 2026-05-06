# Changeset-Hash Pre-Commit Gate

**Status**: spec (closes B1 of `[P·augmented-dev-loops]` backlog)
**Origin**: 2026-05-06 SESSION_STATE bootstrap loop, item B1

---

## Purpose

Closes the silent-scope-drift failure mode. An agent declares its expected file list and invariant claims in a manifest BEFORE work starts. A pre-commit hook hashes the actual changeset and refuses commit if it drifts from the declaration.

Forces honest scoping: agents can't quietly extend into adjacent files mid-cycle without explicit acknowledgement.

## Why this matters

Today an agent says "I'm going to fix the storage layout in `ContractA.sol`" and ends up modifying `ContractA.sol`, `ContractB.sol`, and `IContractA.sol` because the fix required interface changes. The drift is real work, sometimes correct, sometimes a quiet expansion of scope.

Without a gate, drift is invisible until human review — and human review is exactly the surface this primitive should reduce. A changeset-hash gate makes drift fail-loud at the boundary where it can still be cheaply corrected (re-declare scope, re-run cycle).

## Manifest format

```yaml
# .claude/manifests/<cycle-id>.yaml
cycle_id: W4-storage-regression
agent: sonnet-medium
declared_at: 2026-05-06T14:32:00Z

scope:
  files_modified:
    - contracts/governance/ReasoningVerifier.sol
    - contracts/governance/interfaces/IReasoningVerifier.sol
  files_created:
    - test/ReasoningVerifier.t.sol
  files_deleted: []

invariants:
  - "no .sol modified outside contracts/governance/"
  - "no test file deleted"
  - "no breaking storage-layout change to existing UUPS contracts"

intent_summary: "Wire IStateOracle into ReasoningVerifier.verifyTruth path."
```

Each manifest is named by `cycle_id` and stored in `.claude/manifests/`. The agent writes this BEFORE making any edits.

## Pre-commit hook flow

```
git commit
    │
    ▼
pre-commit hook fires
    │
    ▼
read .claude/manifests/<latest>.yaml (or fail-loud if absent)
    │
    ▼
compute actual changeset:
    git diff --name-only --cached
    + classify each into modified | created | deleted
    │
    ▼
compare actual ⇄ declared:
    files_modified mismatch        → BLOCK with diff message
    files_created  mismatch        → BLOCK with diff message
    files_deleted  mismatch        → BLOCK with diff message
    invariant violated             → BLOCK with violating file path
    │
    ▼
all match → ALLOW commit
```

Override path: `git commit --no-verify` bypasses (standard git behavior). The hook does NOT block via `--no-verify`; that is reserved for genuine emergencies and prints a warning logged to `.claude/lessons.md`.

## Drift-vs-correction distinction

When the actual changeset DIFFERS from declared, two cases:

1. **Drift**: agent extended scope without recognizing it. Block forces a STOP, re-declaration, and resumed work.
2. **Correction**: declared scope was wrong; actual scope is right. Agent must update the manifest first (`.claude/manifests/<cycle-id>.yaml`), THEN commit. Manifest update itself is a recorded event.

Both cases produce a manifest update record. The history of (declared → actual → final) per cycle is the input to lessons.md retrospective rows.

## Invariant predicates

Common predicates the gate recognizes:

| Predicate | Meaning |
|-----------|---------|
| `no .sol modified outside contracts/X/` | path-scope assertion |
| `no test file deleted` | safety: tests don't disappear silently |
| `no breaking storage-layout change to UUPS contract Y` | runs `forge inspect` diff |
| `no production contract modified without companion test` | requires `test/X.t.sol` change in same commit |
| `no doc deleted without companion in _archive` | softer — doc moves are tracked |

Custom predicates: an invariant string starting with `script:<path>` invokes a script that returns 0 (pass) or 1 (fail with stdout reason). Lets cycle-specific assertions plug in without modifying the gate.

## Integration with other gates

```
git commit
    │
    ▼
1. changeset-hash gate     ← THIS
    declared scope vs actual → block on drift
    │
    ▼
2. pre-review pipeline (B4)
    forge tests + storage-layout diff + slither + full-build
    │
    ▼
3. session-state-commit-gate
    SESSION_STATE.md and WAL.md reflect this commit
    │
    ▼
commit lands
    │
    ▼
git push
    │
    ▼
4. partner-facing-additive-gate
    push commit messages don't introduce retrospective framing
```

Each gate runs only if the previous succeeded. They're cheap individually; the asymmetric-cost-of-stacking principle applies.

## Implementation files (planned)

- `.claude/scripts/changeset-hash-precommit.sh` — git hook entry point
- `.claude/scripts/manifest-validator.py` — parses YAML, runs predicates
- `.claude/manifests/` — directory of cycle manifests (gitignored)
- `.claude/lessons.md` — receives manifest-vs-actual rows on drift events

## Open implementation questions

1. **Manifest write trigger**: who writes the manifest? Orchestrator at cycle start? Agent itself? Both — orchestrator scaffolds, agent confirms.
2. **Cycle-id derivation**: `<date>-<intent-summary-slug>`? Auto-incremented? Manual? Probably manual + checked.
3. **Multi-cycle commits**: when one commit spans multiple cycles (rare), how does the gate resolve? Probably reject — force one commit per cycle.
4. **Manifest archival**: keep all manifests forever (lessons.md will grow), or rotate? Probably keep — disk is cheap, retrospective value is high.
5. **Override telemetry**: `--no-verify` events should be logged to `.claude/lessons.md` automatically, NOT silently allowed. Implementation needs a wrapper that intercepts `git commit --no-verify`.

## Status

Spec complete; implementation pending. Companion to B4 (pre-review pipeline). Both close together — neither is useful without the other if the orchestrator isn't running them as a package.
