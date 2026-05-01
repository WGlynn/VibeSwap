# Contribution Traceability — The Chat-to-DAG Closed Loop

**Status**: Canonical process. Authoritative.
**Author**: Will Glynn & JARVIS
**Origin**: Session 2026-04-21 closing insight.
**Primitive**: [`memory/primitive_chat-to-dag-traceability.md`](../memory/primitive_chat-to-dag-traceability.md) <!-- FIXME: ../memory/primitive_chat-to-dag-traceability.md — target lives outside docs/ tree (e.g., ~/.claude/, sibling repo). Verify intent. -->
**Related docs**:
- [MASTER_INDEX](../../INDEX.md) — repo encyclopedia
- [PROOF_OF_CONTRIBUTION](./PROOF_OF_CONTRIBUTION.md) — PoM weight function fed by this DAG
- [THE_CONTRIBUTION_COMPACT](../../research/essays/THE_CONTRIBUTION_COMPACT.md) — economic substrate
- [PRIMITIVE_EXTRACTION_PROTOCOL](../PRIMITIVE_EXTRACTION_PROTOCOL.md) — sibling workflow (JARVIS's internal memory)

---

## Start with a familiar scene

You're in a Telegram group chat. Someone types: *"What if oracle updates could be commit-reveal to prevent last-mover advantage?"*

Conversation happens. The idea gets refined. Someone asks clarifying questions. A design takes shape.

Weeks later, engineer Sarah ships the implementation. Her commit is in git. Her name is on the contributor list.

But who came up with the idea? The person in Telegram. The one whose offhand question started the whole chain.

In most projects, their contribution is UNCOMPENSATED. They're not in git. They don't get credit. Their idea became infrastructure, and the infrastructure forgets them.

This is the gap the Chat-to-DAG Traceability loop closes. Every step in the chain — from the original Telegram question through the GitHub issue to Sarah's commit to the on-chain DAG attestation — becomes a first-class traceable path.

## Why this document exists

VibeSwap's founding thesis — that the mind functions as an economy, and that blockchain is the substrate where that economy becomes legible, composable, and multi-participant — collapses if the *workflow* that produces contributions isn't traceable onto the chain. If the only contributions the on-chain DAG sees are `git commit` objects, then the DAG reflects code, not cognition. The upstream provenance (the chat message, the design question, the framing that unlocked a solution) goes uncredited, which is the exact failure mode VibeSwap exists to fix.

This document is the canonical spec for the closed loop:

```
RAW SOURCE (chat / Telegram / Discord / Twitter / conversation / direct prompt)
     │
     ▼
GITHUB ISSUE              ← formalization layer (preserves source attribution)
     │
     ▼
SOLUTION ARTIFACT         ← commit / doc / contract / spec / test (references #N)
     │
     ▼
CONTRIBUTION DAG ID       ← on-chain credit anchored to original contributor
     │                     (ContributionAttestor.submitClaim → claimId)
     ▼
CLOSING COMMENT           ← canonical format, closes the loop back at the issue
```

Every link references the previous. Given any node, the full lineage is recoverable.

> *"this needs to be standardized process so we can canonically trace contributions from chat to github issue to solution to dag attribution ID. from the chat to the contract level closed loop"* — Will, 2026-04-21

---

## Scope

**In scope**: any contribution whose origin is non-code or whose code origin has upstream provenance (idea, design question, framing, audit prompt, debugging help). Typical examples: Telegram dialogue that surfaces a design flaw, Twitter DM suggesting a mechanism, a call where Will articulates a new primitive, an external reviewer's offhand observation.

**Out of scope (for now)**: pure internal cleanup commits with no external prompt and no design dimension. These still get recorded in the DAG via the standard `GitHubContributionTracker` path — they don't need the upstream-Source layer because there isn't one.

**Decision rule**: if you can name a human (or agent) whose words caused the work, traceability applies. If the work arose entirely from the assistant's own pattern-matching with no human prompt, it's internal improvement and the Source layer is "Internal / JARVIS autonomous".

---

## Architecture — what each layer does

### Layer 0 — The raw source

Whatever existed before GitHub: a chat log, a voice memo transcript, a quoted tweet, a call summary. This layer is the ground truth of *who said what first*.

Constraints:
- The source must be durable enough that an auditor could, in principle, retrieve and verify it. A Telegram link, a screenshot committed to a private archive, or a quoted text-block in the issue body all qualify.
- If the source is NDA-protected (per [MEMORY.md NDA material](../memory/MEMORY.md)), the issue body carries a redacted marker (`Source: private — NDA-counterparty-X / see off-repo archive`) rather than the raw text. The attribution chain still works because `Contributor` and `Date` are preserved. <!-- FIXME: ../memory/MEMORY.md — target lives outside docs/ tree (e.g., ~/.claude/, sibling repo). Verify intent. -->

### Layer 1 — The GitHub issue

This is the formalization step. A raw message becomes a first-class work unit the moment a GitHub issue is opened with the canonical body format.

The issue body MUST contain two canonical sections:

```markdown
## Source
- **Channel**: Telegram | Discord | Twitter | Call | Conversation | RSS | Direct
- **Contributor**: @handle (chain-bound address 0x... if known)
- **Date**: YYYY-MM-DD
- **Original**: <link or quoted text — redacted marker OK for NDA material>

## Resolution Hooks
- [ ] Solution artifact (commit SHA / file path / spec URL)
- [ ] ContributionDAG attribution-ID (claimId from ContributionAttestor)
- [ ] Closing comment with chain references
```

Title prefix identifies the kind of issue:
- `[Dialogue]` — raw idea or open-ended discussion
- `[Bug]` — defect report
- `[Feat]` — feature request
- `[Audit]` — security finding
- `[Design]` — mechanism design question
- `[Meta]` — process / tooling change (this doc started as a `[Meta]`)

Labels add a second axis (they feed the ContributionType mapping in Stage 3): `type:code`, `type:research`, `type:security`, `type:governance`, `type:inspiration`, `type:community`, `type:design`, `type:marketing`, `type:other`.

The GitHub issue template at `.github/ISSUE_TEMPLATE/dialogue.md` pre-bakes this structure so the discipline doesn't depend on memory.

### Layer 2 — The solution artifact

The solution can be:
- A code commit (most common)
- A doc file (like this one)
- A spec / memo / roadmap
- A test suite
- A governance proposal
- A design memo extracted to `DOCUMENTATION/`
- A primitive extracted to `memory/primitive_*.md`

The commit message carries the canonical closure tokens:

```
<type>: <short title>

<body — explain the what/why as usual>

Closes #<N> — <one-line issue summary>
SOURCE: <Channel> / @<Contributor> / <Date>
DAG-ATTRIBUTION: pending
```

Two grep-able tokens: `SOURCE:` and `DAG-ATTRIBUTION:`.

- `SOURCE:` mirrors the issue body's Stage-1 Source block in one line. It's redundant with the issue, but redundancy is the point — a commit is independently greppable without fetching issues.
- `DAG-ATTRIBUTION:` carries one of three values:
  - `pending` — the commit is shipping, but the on-chain mint hasn't happened yet. The CI sweep (Layer 4) picks these up.
  - `0x<claimId>` — the mint has already happened (can occur when work is batched).
  - `n/a` — the commit is not traceability-scoped (pure internal cleanup, see Scope above).

### Layer 3 — The ContributionDAG attribution

The on-chain mint call is:

```solidity
ContributionAttestor.submitClaim(
    address contributor,          // chain-bound address of the Stage-1 Contributor
    ContributionType contribType, // derived from issue label — see mapping below
    bytes32 evidenceHash,         // keccak256(abi.encode(issueNumber, commitSHA, sourceTimestamp))
    string description,           // canonical: "Issue #N — <title>"
    uint256 value                 // initial weight hint; see weight rules below
) external returns (bytes32 claimId);
```

The returned `claimId` IS the DAG attribution ID. It is:
- Unique per submission (derived from `contributor`, `msg.sender`, nonce, and block timestamp).
- Queryable via `ContributionAttestor.getClaim(claimId)`.
- Subject to the executive/judicial/legislative branches of attestation (see `ContributionAttestor.sol` for the separation-of-powers flow).

**Issue label → ContributionType mapping** (matches `IContributionAttestor.ContributionType`):

| Issue label | Enum value | Int |
|---|---|---|
| `type:code` | `Code` | 0 |
| `type:design` | `Design` | 1 |
| `type:research` | `Research` | 2 |
| `type:community` | `Community` | 3 |
| `type:marketing` | `Marketing` | 4 |
| `type:security` | `Security` | 5 |
| `type:governance` | `Governance` | 6 |
| `type:inspiration` | `Inspiration` | 7 |
| `type:other` | `Other` | 8 |

`[Dialogue]` issues default to `type:inspiration` unless a more specific label is applied. `[Audit]` issues default to `type:security`. `[Feat]` and `[Bug]` default to `type:code`.

**Evidence-hash canonical construction**:

```solidity
evidenceHash = keccak256(
    abi.encode(
        uint256(issueNumber),
        bytes32(commitShaAsBytes32),      // first 20 bytes of SHA zero-padded
        uint64(sourceTimestamp)           // unix seconds when the raw source was created
    )
)
```

This commits the three layers together: GitHub issue number (Layer 1), solution commit (Layer 2), and source timestamp (Layer 0). Any later audit can recompute the hash and verify the on-chain record matches.

**Value hint (initial weight)**:

The `value` parameter is an initial weight hint, not the final weight. Final weight is determined by the attestation branches. A sensible default formula for Layer-2 minting:

```
value = base[issueType] * recencyBoost(sourceTimestamp) * firstRespondentBonus
```

where:
- `base[Dialogue]` = 1e18, `base[Bug]` = 2e18, `base[Feat]` = 3e18, `base[Audit]` = 5e18, `base[Design]` = 5e18, `base[Meta]` = 2e18
- `recencyBoost(t) = max(0.5, 1 - (now - t) / 365 days)`
- `firstRespondentBonus = 1.25` if the closer is the first non-author to engage, else 1.0

The mint script uses the base values directly for V1 and defers the multipliers to governance tuning. Conservative: over-crediting is harder to reverse than under-crediting (though both are possible via the governance branch).

### Layer 4 — The closing comment

Once the mint returns a `claimId`, the GitHub issue gets a closing comment in the canonical format:

```markdown
Closing — <one-line resolution summary>.

**Solution**:
- <artifact 1: commit URL or file path>
- <artifact 2: commit URL or file path if multi-commit>

**DAG Attribution**: `0x<claimId>` ([explorer link if deployed])
**Source**: <Channel> / @<Contributor> / <Date>
**Lineage**: <parent claimIds that this builds on, if any>

<optional: 1-2 line reflection on how the solution addresses the source>
```

The issue is then closed.

This completes the loop: the Source field at the top of the issue body and the DAG Attribution line in the closing comment are the two endpoints of the chain. Navigating from either end recovers the whole.

---

## Process — step by step

### A new dialogue or idea surfaces in chat

1. **Open an issue** with the canonical title prefix (`[Dialogue]`, `[Bug]`, `[Feat]`, `[Audit]`, `[Design]`, `[Meta]`).
2. **Fill the Source section** with Channel / Contributor / Date / Original.
3. **Fill the Resolution Hooks section** as a TODO checklist.
4. **Apply a `type:*` label** (maps to ContributionType).

If no work ships immediately, the issue sits open. That's fine — the Source field is already the on-chain-ready upstream anchor. The issue exists so that when work eventually ships (potentially months later), the Source is still retrievable.

### Work that addresses an open issue ships

1. **Write the solution** (commit / doc / spec / whatever).
2. **Commit message** includes the canonical closure tokens:
   ```
   <type>: <title>

   <body>

   Closes #<N> — <issue title>
   SOURCE: <Channel> / @<Contributor> / <Date>
   DAG-ATTRIBUTION: pending
   ```
3. **Push**. The commit is now live on the branch.
4. **Mint the on-chain attestation** via `scripts/mint-attestation.sh <issue-number> <commit-sha>`. This reads the source timestamp from the issue body, computes the evidenceHash, and calls `ContributionAttestor.submitClaim`. It returns the `claimId`.
5. **Append the closing comment** using the canonical format, including the `claimId`.
6. **Close the issue** (either manually or automatically via the `Closes #N` commit token on merge).
7. **Optionally** update the original commit with the real `DAG-ATTRIBUTION: 0x<claimId>` via an amend-and-rebase IF the commit hasn't been merged yet. After merge, don't amend — the `DAG-ATTRIBUTION: pending` marker stays in git history and the CI sweep's resolution tracker is the source of truth.

### Retroactive backfill

For already-closed issues without DAG attribution, the process is:

1. **Open a follow-up comment** on the closed issue (issue stays closed).
2. **Use the canonical closing-comment format** — reconstruct Source from the issue body or the linked commit.
3. **Mint the attestation** via `scripts/mint-attestation.sh` — the script accepts a `--backfill` flag that takes the current timestamp as the mint time but uses the historical `sourceTimestamp`.
4. **Post the attestation ID** in the follow-up comment.
5. **Do not reopen the issue** — the closed state is correct; the comment is a chain-of-custody annotation.

The 6 issues closed on 2026-04-21 (`#28`, `#29`, `#30`, `#33`, `#34`, `#36`) are the first batch to receive this backfill. See the "Backfill log" section at the bottom of this document.

### When a commit ships with `DAG-ATTRIBUTION: pending` and never gets minted

This is a known-debt state. The CI sweep (Layer 4 tooling — `.github/workflows/dag-attribution-sweep.yml`) periodically scans merged commits and surfaces pending entries to a queue. Unresolved entries after 14 days trigger a `TRACEABILITY-DEBT-N` row in `memory/project_rsi-backlog.md` with the missing stage(s) flagged.

Periodic backfill sweeps heal debt. Debt is visible (not silent), so the system stays honest about its own completeness.

### When the chain breaks (missing Stage)

- **No Source field in the issue**: reject the issue at triage; add a comment asking the opener to add the Source block. If external contributor unfamiliar with the format, the triager fills it on their behalf.
- **No `DAG-ATTRIBUTION:` token in the commit**: grep as part of pre-push hook (optional, not yet wired). Without the hook, the CI sweep catches it post-merge.
- **No closing comment**: the issue bot (future work) can auto-template the closing comment from commit metadata when an issue transitions to closed state.

---

## Tooling

### `.github/ISSUE_TEMPLATE/dialogue.md` (shipped)

The issue template enforces Source + Resolution Hooks. GitHub's native template system pre-populates new-issue drafts. Users can bypass by clicking "Open a blank issue" — that's fine for maintainer-convenience, but triage rejects open-blank issues without the Source block.

### `scripts/mint-attestation.sh` (shipped)

Wraps `cast send` with the canonical argument construction:

```bash
scripts/mint-attestation.sh <issue-number> <commit-sha> [--backfill]
```

Reads:
- `$CONTRIBUTION_ATTESTOR_ADDRESS` (env)
- `$RPC_URL` (env)
- `$MINTER_PRIVATE_KEY` (env — the keeper or project-account key that pays gas)
- Issue body via `gh issue view <N> --json body,title,labels,createdAt`
- Commit metadata via `git log -1 <sha> --format=...`

Computes `evidenceHash`, maps issue label to `ContributionType`, derives `value` from the issue type, and submits the claim.

Output: the returned `claimId` is printed on stdout; the script also emits a suggested closing-comment markdown to `.traceability/closing-comment-<N>.md` for copy-paste.

### `.github/workflows/dag-attribution-sweep.yml` (shipped)

Runs on `push` to `master` and on a 6-hour cron. Greps merged commits for `DAG-ATTRIBUTION: pending`, deduplicates against an on-chain query of `getClaimsByContributor` per known contributor (future work), and writes the unresolved queue to `.traceability/pending-attestations.json` as a workflow artifact. Also comments on any open PR whose HEAD commit has `pending` — a nudge, not a block.

V2 (deferred): the workflow could auto-mint for commits by known contributors whose mapping-to-chain-address is trusted. For now, mint is manual; the sweep is observational.

### Future tooling (not shipped yet)

- **Pre-push hook** that refuses to push commits containing `Closes #N` without a `DAG-ATTRIBUTION:` line. Would turn the discipline into a gate. Queued for after the workflow settles.
- **GitHub Action that validates issue Source block on `issues: opened`**. Posts a bot comment if the Source section is missing or malformed.
- **Dashboard** at `frontend/src/pages/Traceability.jsx` that walks the chain — pick any claimId → see the issue → see the source → see downstream attestations. Visualizes the contribution graph per contributor (feeds PoM page).
- **Merge-queue bot** that auto-amends commits with the claimId once minted, closing the `pending → resolved` gap automatically.

---

## Design choices — what this spec deliberately does and doesn't do

### It doesn't replace git or GitHub

Per [Augmented Mechanism Design](../memory/feedback_augmented-mechanism-design-paper.md), this is augmentation, not replacement. Git remains the canonical source of code. GitHub remains the canonical discussion surface. `ContributionAttestor` remains the canonical on-chain DAG. This spec adds structured fields at the boundaries so the three layers compose. <!-- FIXME: ../memory/feedback_augmented-mechanism-design-paper.md — target lives outside docs/ tree (e.g., ~/.claude/, sibling repo). Verify intent. -->

### It doesn't require the raw source to be public

The Source section can carry a redacted marker for NDA material. The `Contributor`, `Date`, and `Channel` fields preserve attribution; the `Original` field links to an off-repo private archive when needed. The on-chain mint records `evidenceHash` which is a commitment, not a public disclosure — so even the hash preserves no private content.

### It uses `pending → minted` not `atomic mint-at-commit`

Minting on-chain requires gas, a funded signer, and a deployed `ContributionAttestor`. V1 deliberately separates the commit step from the mint step so that:
- Commits can ship even when the chain isn't live or the signer is offline.
- Batching mints reduces per-transaction gas overhead.
- The CI sweep turns mints into a queue, which can be processed on a predictable cadence rather than blocking every commit.

V2 can add atomic minting (hook into CI post-merge) once mainnet deploy is stable.

### It uses `ContributionAttestor.submitClaim` as the on-chain entry point

The primitive document originally named the entry point as `ContributionDAG.attestContribution(...)` — the actual contract in the repo is `ContributionAttestor`, with `submitClaim`. `ContributionDAG` is the web-of-trust / vouching layer, a related but distinct mechanism. `ContributionAttestor.submitClaim` is the correct entry point for new claims (it later queries `ContributionDAG` for trust-weighted attestation weights under the executive branch).

This document is the canonical reference; if the primitive's wording drifts in future sessions, this doc takes precedence for the implementation details.

### Weight defaults are conservative

`value` on `submitClaim` is an initial weight hint, not a final reward. Final weight emerges from the three-branch attestation flow. Over-crediting via an inflated initial hint is recoverable via the executive branch (attestations can accumulate negatively) or the judicial branch (tribunal trial) or the legislative branch (governance override). We err conservative on initial values so governance doesn't need to fire for routine entries.

### The Source field is load-bearing

The [Lawson Constant](../memory/primitive_economic-theory-of-mind.md) — *"the greatest idea cannot be stolen, because part of it is admitting who came up with it"* — lives in the contract as `LAWSON_CONSTANT = keccak256("FAIRNESS_ABOVE_ALL:W.GLYNN:2026")`. The Source field is the Lawson Constant applied to the workflow: attribution is a first-class field, not decorative metadata. Issues without a Source field fail the canonical form. <!-- FIXME: ../memory/primitive_economic-theory-of-mind.md — target lives outside docs/ tree (e.g., ~/.claude/, sibling repo). Verify intent. -->

---

## Why this matters — the big picture

### Without this loop

The on-chain DAG reflects code commits. The hard-to-measure contributions (dialogue, design, framing, audit intuition, emotional labor of keeping the group together) never reach the chain. Governance and reward distribution, which both feed off the DAG, become systematically biased toward code-visible contributions. The project's thesis (*externalize the cognitive economy*) degrades to (*externalize the coding economy*) — which is what every prior dev-reward-DAO has done, and which consistently fails to pay off the actual insight work.

### With this loop

Every category of contribution is legible to the chain. Dialogue prompts that unlock design decisions earn DAG weight. Design memos that become architecture earn DAG weight. Audit prompts that catch bugs earn DAG weight. The chain reflects the full cognitive economy, not a proxy of it.

The loop being closed means an auditor can sit with the on-chain attestations and walk backward to the original Telegram message, recovering not just *what* was done but *whose idea* caused it. That's the Lawson Constant enforced at the infrastructure level, not by anyone's discipline.

### Relationship to ETM (Economic Theory of Mind)

[ETM](../memory/primitive_economic-theory-of-mind.md) says the mind functions as an economy and blockchain is the legible externalization of that pattern. This spec is the workflow-layer companion to ETM: without canonical traceability, the externalization is incomplete — the chain records only the tail of the process, not the whole pattern. With it, the chain is a faithful mirror. <!-- FIXME: ../memory/primitive_economic-theory-of-mind.md — target lives outside docs/ tree (e.g., ~/.claude/, sibling repo). Verify intent. -->

The recursion: this document itself was produced via the loop. The closing insight from 2026-04-21 → primitive captured → SESSION_STATE Top Priority → this doc shipped → commit with `DAG-ATTRIBUTION: pending` → backfill mint → `claimId` recorded below. Proving the loop by closing the loop on the loop-closing work.

---

## Integration points

### With `memory/project_rsi-backlog.md`

Traceability debt (commits with `DAG-ATTRIBUTION: pending` unresolved > 14 days) surfaces as `TRACEABILITY-DEBT-N` rows. The backlog tracker is the authoritative debt ledger; the CI sweep is the detector.

### With `MEMORY.md` and `memory/primitive_*.md`

Every primitive extracted to `memory/` is itself a contribution. Primitive extractions get issues opened (`[Meta] Primitive extracted: <name>`), Source field pointing to the originating session, and closing comments with the `claimId`. Feeds `PRIMITIVE_EXTRACTION_PROTOCOL.md`'s extraction counter.

### With `DOCUMENTATION/PROOF_OF_CONTRIBUTION.md`

PoM weight = `f(attestations)`. Attestations come from this loop. When the PoM page shows a contributor's score, hovering any component reveals the underlying claim(s) → issue(s) → source(s). Transparency by construction.

### With `contracts/identity/ContributionAttestor.sol`

This doc is the off-chain complement. The contract is the on-chain ledger. The script `mint-attestation.sh` is the bridge. Together they're a complete stack.

### With Telegram / Discord bots (Jarvis)

Future work: the Jarvis bot family (`jarvis-bot/`) can auto-open issues when Will (or an opted-in contributor) flags a message as `/contribute`. The bot pre-fills the Source block from the message metadata. The contributor can still edit before submitting, but the discipline is automated.

---

## Backfill log

The following issues were closed on 2026-04-21 without DAG attribution. Each requires a follow-up annotation comment carrying the canonical closing-comment format with `DAG-ATTRIBUTION: pending` (on-chain mint deferred until `ContributionAttestor` is deployed on the active network).

| # | Title | Type label | Closed | Annotation status | Mint status |
|---|---|---|---|---|---|
| 28 | Cooperative Game Theory in MEV | `type:research` | 2026-04-21 | pending | deferred (post-deploy) |
| 29 | Verifiable Solver Fairness | `type:research` | 2026-04-21 | pending | deferred (post-deploy) |
| 30 | Externalized Idempotent Overlay | `type:design` | 2026-04-21 | pending | deferred (post-deploy) |
| 33 | Oracle Security (FAT-AUDIT-2) | `type:security` | 2026-04-21 | pending | deferred (post-deploy) |
| 34 | Transparency in Decentralized Governance | `type:governance` | 2026-04-21 | pending | deferred (post-deploy) |
| 36 | Capturing Non-Code Protocol Contributions | `type:inspiration` | 2026-04-21 | pending | deferred (post-deploy) |

The annotation sweep runs via `scripts/mint-attestation.sh --backfill-annotation <N>` which generates the closing-comment markdown and posts it via `gh issue comment`. Mints will fire when the `ContributionAttestor` deployment address is published to `deployments/<chain>.json` and `$MINTER_PRIVATE_KEY` is loaded.

Annotation status transitions `pending → annotated → minted`. The `annotated` state means the closing-comment markdown is live on the issue but the on-chain mint is deferred; `DAG-ATTRIBUTION:` in the comment is held as `pending` until the deploy unlocks the mint.

---

## Versioning

**V1** — this document. The manual process is live; tooling is scaffolded.

**V1.1 (next, queued)** — pre-push hook gate. Refuse commits with `Closes #N` lacking `DAG-ATTRIBUTION:`. Would eliminate accidental "forgot to add the token" drift.

**V2 (post-mainnet-deploy)** — atomic minting. CI post-merge triggers the mint automatically for commits by known-mapped contributors. `pending` becomes a transient state rather than a persistent one.

**V3 (long arc)** — dashboard visualization at `/traceability` with full graph walks per contributor. Feeds the PoM page hover UI.

---

## One-line summary

*Every contribution gets one canonical chain — chat → issue → solution → DAG-ID — so informal upstream provenance becomes first-class on-chain credit, and the cognitive economy actually externalizes as ETM claims it should.*
