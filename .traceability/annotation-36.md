### 🔗 Traceability annotation (retroactive)

Per [`DOCUMENTATION/CONTRIBUTION_TRACEABILITY.md`](../blob/feature/social-dag-phase-1/DOCUMENTATION/CONTRIBUTION_TRACEABILITY.md), this closed issue is receiving a retroactive annotation in the canonical Chat-to-DAG closing-comment format. **This issue is the root of the entire traceability-infrastructure rollout** — it's the one that asked "how do non-code contributions earn DAG credit?", and the answer is the full Chat-to-DAG loop now shipped.

---

Closing — Capturing non-code protocol contributions materialized as the **canonical Chat-to-DAG Traceability loop**: chat → issue → solution → on-chain claimId. Full process spec + tooling shipped.

**Solution**:
- `DOCUMENTATION/CONTRIBUTION_TRACEABILITY.md` — canonical spec (this is the doc form of the answer to this issue).
- `memory/primitive_chat-to-dag-traceability.md` — primitive form (load-bearing for future sessions).
- `.github/ISSUE_TEMPLATE/dialogue.md` + `bug.md` + `feat.md` + `audit.md` + `config.yml` — templates enforce the Source + Resolution Hooks structure at issue-open time.
- `scripts/mint-attestation.sh` — canonical minter wrapping `ContributionAttestor.submitClaim` with the `(issueNumber, commitSHA, sourceTimestamp)` evidenceHash construction.
- `.github/workflows/dag-attribution-sweep.yml` — CI sweep that detects `DAG-ATTRIBUTION: pending` commits and surfaces them as a queue.
- `contracts/identity/ContributionAttestor.sol` — already-deployed attestation substrate this routes into.

**DAG Attribution**: `pending`  *(deferred — self-referential: this is the first issue whose closure bootstrapped the minting process itself. Will be minted in the first batch after `ContributionAttestor` deploys.)*
**Source**: Telegram / @Willwillwillwillwill in VibeSwap Telegram Community / 2026-04-16
**Lineage**: parent of `#34` (governance transparency); upstream of the entire traceability infrastructure rollout.
**Issue-body evidence hash**: `804fc7b4adbc4162`

**ContributionType** (when minted): `Inspiration` (enum 7) — the question that surfaced the loop itself. Pure dialogue → infrastructure.
**Initial value hint**: 5e18 (Design base — root issue of a multi-artifact rollout)

<sub>Backfill annotation #6/6. Closes the loop by closing the loop on the loop-closing work. (ETM's recursion property in action.)</sub>
