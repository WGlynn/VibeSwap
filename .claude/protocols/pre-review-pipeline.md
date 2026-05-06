# Pre-Review Automated Check Pipeline

**Status**: spec (closes B4 of `[P·augmented-dev-loops]` backlog)
**Origin**: 2026-05-06 SESSION_STATE bootstrap loop, item B4

---

## Purpose

Wrap the existing per-cycle verification steps (targeted forge tests, storage-layout diff, slither-on-changed-files) into a **single command** that runs BEFORE human review. Block-on-failure. Reduces orchestrator-judgment surface — the orchestrator stops being the "did this run pass tests?" oracle.

## Why this matters

Today, after each agent cycle, the orchestrator manually:
1. Decides which tests to run (`--match-path`)
2. Runs them
3. Eyeballs storage-layout for regressions
4. Runs slither on changed files
5. Decides whether to commit

Each step is forgettable. The orchestrator under load skips one (usually slither) and discovers the regression two cycles later. Pre-review pipeline collapses all four steps into one entry point with a strict gate.

## Pipeline contract

```bash
.claude/scripts/pre-review.sh <range>
```

Where `<range>` is a git range (`HEAD~3..HEAD`, `<sha>..HEAD`, or `staged` for unstaged-vs-staged).

Exit codes:
- `0` — all checks passed
- `1` — at least one check failed (details in stdout)
- `2` — pipeline configuration error (foundry not installed, slither missing, etc.)

## Stages

### 1. Test selection (targeted)

From the changed file list (from `git diff --name-only <range>`), derive the set of test files to run:

```
contracts/foo/Bar.sol         → test/Bar.t.sol
contracts/foo/Bar.sol         → test/foo/Bar.t.sol  (if exists)
contracts/foo/interfaces/Y.sol → tests for any contract implementing Y
```

If a changed file has no derivable test, surface it explicitly: "no tests cover X.sol — confirm or add coverage." This is informational, not a gate.

Run with default profile (no via_ir per `Foundry Performance Rules`):

```bash
forge test --match-path "test/<derived>" -vv
```

Failure → exit 1.

### 2. Storage-layout diff

For every UUPS contract in the changed set, snapshot storage layout and compare to the prior snapshot:

```bash
forge inspect <contract> storage-layout > out/<contract>.layout.json
diff out/<contract>.layout.json reference/<contract>.layout.json
```

Any non-trivial diff (slot reorder, type change, gap removal) is a regression. Pure additions to the end of the layout (with proper gap accounting) are allowed.

Failure → exit 1.

### 3. Slither on changed files

```bash
slither contracts/<changed-file> --triage-mode --filter-paths node_modules
```

Detector severity gates:
- HIGH → exit 1 always
- MEDIUM → exit 1 unless `// slither-disable-next-line` justifies
- LOW / INFO → informational, surface but don't gate

### 4. Build verification (full profile)

```bash
FOUNDRY_PROFILE=full forge build --skip test
```

Catches via_ir-only compilation issues that the default profile misses. Failure → exit 1.

### 5. Output

If all stages pass:
```
PRE-REVIEW PASS — N tests passed, 0 storage regressions, 0 high/medium slither, full build OK
```

If any stage fails, the pipeline output enumerates each failure with file path + line number + remediation hint.

## Integration

Triggered:
- Pre-commit (advisory, doesn't block by default)
- Pre-push to origin (gated, blocks if fail unless `PRE_REVIEW_OVERRIDE=1`)
- Post-cycle (orchestrator runs this before deciding clean-ship)

The pre-push hook is the load-bearing one. Pre-commit warns; pre-push blocks. This matches the asymmetric-cost gate stack — local commits cheap, pushes carry blast-radius.

## Composition with other gates

- **Changeset-hash pre-commit gate (B1)**: the manifest declares which files SHOULD be modified; pre-commit hash-checks actual modifications match. Pre-review pipeline runs AFTER changeset-hash passes — pipeline assumes the changeset is in-scope, just verifies it doesn't break things.
- **HIERO compression gate**: runs on memory writes. Orthogonal to pre-review (which runs on contract/test/doc changes).
- **session-state-commit-gate**: runs on push. Pre-review is upstream of this — pre-review checks the diff is healthy, then session-state-gate checks that SESSION_STATE/WAL reflect the diff.

## Open implementation questions

1. **Test derivation**: simple file-name mapping breaks for cross-cutting tests (integration, fuzz). Probably want a manifest declaring "this test covers these contracts."
2. **Storage-layout reference snapshots**: where do they live? Probably `reference-layouts/` checked in alongside contracts.
3. **Slither version pinning**: detector behavior changes between slither versions. Pin via `pyproject.toml` or `requirements.txt`.
4. **Performance**: full pipeline must be fast enough to run on every push. If it crosses 60s, friction wins and people disable it. Target: median 30s for typical changesets.

## Status

Spec complete; implementation pending. The companion `.claude/scripts/pre-review.sh` is a TODO. The 31 reasoning-subsystem tests passing today were run individually by hand; once this pipeline ships, those become automatic on every relevant changeset.
