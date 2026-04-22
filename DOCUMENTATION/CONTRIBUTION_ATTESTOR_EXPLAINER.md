# ContributionAttestor — The 3-Branch Attestation Flow

**Status**: Deployed substrate. `contracts/identity/ContributionAttestor.sol`.
**Function**: Attestation (minting) layer. Where [Chat-to-DAG Traceability](./CONTRIBUTION_TRACEABILITY.md) lands claims on-chain.

---

## What it is

The primary on-chain entry point for contribution claims. Every attestation goes through a three-branch "separation of powers" flow where claims can be accepted by executive (peer attestation), judicial (tribunal verdict), or legislative (governance override) branches.

## Why three branches

Single-branch attestation systems have capture modes:

- **Executive only** (peer attestation) → can be bought by accumulating cheap attestations from low-trust peers.
- **Judicial only** (tribunal) → bottlenecks on tribunal capacity; every claim requires a trial.
- **Legislative only** (DAO vote) → slow, expensive, and prone to governance capture.

Three branches with their own thresholds, and clear escalation paths between them, resist any single capture mode:

- Most claims auto-accept via executive (low-friction happy path).
- Contested claims escalate to judicial (tribunal trial).
- Exceptional claims escalate to legislative (DAO supreme authority).

## Executive branch — trust-weighted peer attestation

Flow:

1. `submitClaim(contributor, contribType, evidenceHash, description, value)` — any caller can submit a claim on behalf of a contributor.
2. The claim enters `Pending` status with a TTL (default 1 day).
3. Peers call `attest(claimId)` or `contest(claimId, reasonHash)` to weigh in.
4. Each attestation's weight = `trust_score × trust_multiplier` from [ContributionDAG](./CONTRIBUTION_DAG_EXPLAINER.md).
5. When `netWeight ≥ acceptanceThreshold` (default 2.0 PRECISION), the claim auto-accepts.
6. When TTL expires without acceptance, the claim lapses.

Attestation math:

```
netWeight = Σ(positive_attestations_weight) - Σ(negative_contestations_weight)
```

Each attestation or contestation weight = `PRECISION * trust_score * voting_multiplier`. Founders (3.0x) * full trust (PRECISION = 1) = 3.0 PRECISION per attestation. Three founders agreeing = 9.0 PRECISION, far above the 2.0 threshold.

Untrusted wallets (0.5x) * low trust score = fractional weight per attestation. Many untrusted attestations still can't overcome a single founder's dissent.

## Judicial branch — tribunal for contested claims

When a claim is contested (net-weighted against, or flagged by the claimant), it can be escalated to the `DecentralizedTribunal`:

1. `escalateToTribunal(claimId, trialId)` — claimant or any party can link the claim to a tribunal case.
2. The claim status shifts to `Escalated`.
3. The tribunal runs its own phases (JURY_SELECTION, EVIDENCE, DELIBERATION, VERDICT, APPEAL).
4. The verdict is binding: `resolveByTribunal(claimId)` accepts or rejects based on the tribunal's `GUILTY | NOT_GUILTY`.

Tribunal verdicts override executive outcomes. A claim the executive accepted but the tribunal later rejects is now rejected.

## Legislative branch — governance override

Supreme authority:

1. `escalateToGovernance(claimId, proposalId)` — links the claim to a `QuadraticVoting` proposal.
2. The claim status shifts to `GovernanceReview`.
3. The governance vote resolves via `resolveByGovernance(claimId)`.
4. Legislative outcomes override both executive and judicial.

This branch is slow and expensive; it fires for the highest-stakes or most-contested claims (e.g., a tribunal verdict that the community broadly disagrees with, or a claim involving a core-protocol parameter).

## Flow diagram

```
submitClaim → Pending
      │
      ├─── netWeight ≥ threshold ─── ACCEPTED (resolvedBy: Executive)
      │
      ├─── contested → escalateToTribunal → Escalated
      │         │
      │         └─── tribunal verdict → resolveByTribunal → ACCEPTED/REJECTED (Judicial)
      │
      └─── escalateToGovernance → GovernanceReview
                │
                └─── governance vote → resolveByGovernance → ACCEPTED/REJECTED (Legislative)
```

## The ContributionType enum

9 values, covering the full contribution surface:

| Int | Name | Use case |
|---|---|---|
| 0 | Code | Smart-contract, frontend, infrastructure commits |
| 1 | Design | UI/UX, branding, logo, architectural patterns |
| 2 | Research | Whitepapers, mechanism-design memos, analysis |
| 3 | Community | Moderation, support, onboarding |
| 4 | Marketing | Tweets, articles, outreach |
| 5 | Security | Audits, bug reports, fuzzing outputs |
| 6 | Governance | Proposal drafting, voting facilitation |
| 7 | Inspiration | Cultural contribution, philosophy, dialogue |
| 8 | Other | Catch-all |

[Contribution Traceability](./CONTRIBUTION_TRACEABILITY.md) maps GitHub issue labels to these enum values — see the label → int table there.

## Gas bounds

- `MAX_ATTESTATIONS_PER_CLAIM = 50` — attestation array is capped to prevent unbounded gas.
- `MIN_CLAIM_TTL = 1 days` — claims must have at least a 1-day TTL.
- Attestation arrays stored in mapping-per-claim, not a single global array.

## The evidenceHash field

Opaque to the contract — it's a commitment to external artifacts (commit SHA, document hash, off-chain proof). [Contribution Traceability](./CONTRIBUTION_TRACEABILITY.md) specifies the canonical construction: `keccak256(abi.encode(issueNumber, commitSHA, sourceTimestamp))`.

The contract doesn't verify the hash matches the description — that's an off-chain concern. The hash's value is in its commitment: changing the underlying artifacts changes the hash, and the on-chain record becomes disprovable.

## What NOT to confuse

- **ContributionAttestor ≠ ContributionDAG.** The DAG is trust; the Attestor is claims. They talk to each other.
- **submitClaim ≠ mint a token.** Claims are records, not fungible assets.
- **Acceptance ≠ Reward.** Accepted claims feed into `ShapleyDistributor` via the value field, but the distributor computes actual reward separately.

## Relationship to Shapley

Accepted claims carry a `value` field (initial weight hint). `ShapleyDistributor` reads accepted claims via `getClaimsByContributor` and folds them into the cooperative-game Shapley computation for reward distribution.

## One-line summary

*Three-branch attestation (executive peer + judicial tribunal + legislative governance) that makes single-branch capture impossible while keeping most claims on the low-friction auto-accept path.*
