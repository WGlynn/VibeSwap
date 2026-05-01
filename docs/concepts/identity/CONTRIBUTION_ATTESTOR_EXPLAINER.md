# ContributionAttestor — The 3-Branch Attestation Flow

**Status**: Deployed substrate. `contracts/identity/ContributionAttestor.sol`.
**Audience**: First-encounter OK. Walked claim-flow through all three branches.

---

## Follow a claim from birth to resolution

Let's trace an actual claim through the Attestor. Alice submits a contribution claim on behalf of Bob. What happens?

### Step 1 — The submission

Alice calls:

```solidity
submitClaim(
    contributor: 0xBob...,
    contribType: ContributionType.Security,
    evidenceHash: keccak256(auditReport),
    description: "Oracle manipulation vulnerability report",
    value: 5e18  // 5 VIBE initial weight hint
)
```

On-chain state changes:
- `_claims[newClaimId]` populated with claim data.
- `_contributorClaims[0xBob...]` appends newClaimId.
- `_claimNonce` increments.
- Event `ClaimSubmitted(claimId, 0xBob..., Alice, Security, 5e18)` emitted.

The claim is now `Pending` status. `expiresAt = now + 1 day` (default TTL).

### Step 2 — The attestation window opens

For the next 24 hours (claimTTL), other users can attest or contest.

### Step 3 — Carol attests

Carol, a Trusted user (trust 0.8, multiplier 2.0x), reviews the audit. She thinks it's valid.

She calls `attest(claimId)`.

**What happens**:
- `_hasAttested[claimId][Carol] = true` (prevents double-attestation).
- Attestation created with `weight = 0.8 × 2.0 × 1e18 = 1.6e18`.
- `_attestations[claimId]` appended.
- `claim.netWeight += 1.6e18`.
- `claim.attestationCount++`.
- Event `Attested(claimId, Carol, 1.6e18)` emitted.

`netWeight` is now 1.6e18 (1.6 PRECISION). The acceptance threshold is 2e18 (2.0 PRECISION default). We're still below threshold.

### Step 4 — Dave attests

Dave, another Trusted user (trust 0.75, multiplier 2.0x), attests.

- Dave's weight: 0.75 × 2.0 × 1e18 = 1.5e18.
- `claim.netWeight += 1.5e18 = 3.1e18`.

Now above threshold (2e18).

### Step 5 — Auto-acceptance

A subsequent on-chain call (anyone's) triggers the threshold check:

```solidity
if (claim.netWeight >= acceptanceThreshold) {
    claim.status = ClaimStatus.Accepted;
    claim.resolvedBy = ResolutionSource.Executive;
    emit ClaimAccepted(claimId, ResolutionSource.Executive);
}
```

Claim accepted via executive branch.

Bob now has one accepted Security contribution in the DAG. It's ready to feed into Shapley distribution.

That's the happy path. Two attestations from Trusted users are enough. No tribunal needed.

## Follow a contested claim

Now let's see what happens when a claim is contested.

### Step 1 — Submission + attestations (same as before)

Alice submits. Carol attests. Dave starts to attest but notices something suspicious.

### Step 2 — Dave contests

Dave calls `contest(claimId, reasonHash)`.

- `reasonHash = keccak256("Evidence insufficient — report doesn't show working exploit")`
- Dave's negative weight: `-1.5e18` (same magnitude, opposite sign).
- `claim.netWeight = 1.6e18 - 1.5e18 = 0.1e18`.

Below threshold. Claim stays Pending.

### Step 3 — Escalation to tribunal

Alice (claim submitter) or any party with sufficient stake can escalate:

```solidity
escalateToTribunal(claimId, trialId)
```

where `trialId` is a pre-existing DecentralizedTribunal case.

- `claim.status = ClaimStatus.Escalated`.
- `claimTrialIds[claimId] = trialId`.

The tribunal now has jurisdiction. Random jury selected from high-trust users.

### Step 4 — Tribunal deliberation

Per the tribunal's internal process:
- JURY_SELECTION phase.
- EVIDENCE phase (jury reviews the audit + disputing evidence).
- DELIBERATION phase.
- VERDICT phase.

Suppose the jury verdict is GUILTY — meaning the claim was legitimate (Dave's contest was unfounded).

### Step 5 — Tribunal resolution

Anyone can call:

```solidity
resolveByTribunal(claimId)
```

- Contract queries tribunal: `ITribunal(tribunal).getTrial(trialId).verdict`.
- If GUILTY: `claim.status = Accepted`, `resolvedBy = Judicial`.
- If NOT_GUILTY: `claim.status = Rejected`, `resolvedBy = Judicial`.

Tribunal verdicts override executive-branch status. Even though executive had the claim at Pending, Judicial branch's verdict is binding.

### What happens to Dave's negative attestation?

Not reversed. Dave's contest was a legitimate action — he was WRONG but not punished. The tribunal verdict just overrides the aggregate.

## Follow a governance-escalated claim

Rarely, a claim is exceptional enough to warrant legislative override.

### Step 1 — Governance takes it up

A governance member opens a proposal referencing the claim:

```solidity
escalateToGovernance(claimId, proposalId)
```

- `claim.status = ClaimStatus.GovernanceReview`.
- `claimProposalIds[claimId] = proposalId`.

### Step 2 — Governance vote

The `QuadraticVoting` contract runs its voting cycle on the proposal. Vote yes/no on whether the claim should be accepted or rejected.

### Step 3 — Governance resolution

Anyone can call:

```solidity
resolveByGovernance(claimId)
```

- Contract queries governance: the proposal's outcome.
- If passed: `claim.status = Accepted`, `resolvedBy = Legislative`.
- If rejected: `claim.status = Rejected`, `resolvedBy = Legislative`.

Governance resolutions override BOTH executive and tribunal. Supreme authority.

## The flow diagram

```
submitClaim → Pending
    │
    ├─── netWeight ≥ threshold → Accepted (Executive)
    │                            ↓
    │                           (Can still be overridden)
    │
    ├─── contested → Escalated (to Tribunal)
    │              ↓
    │         resolveByTribunal → Accepted/Rejected (Judicial, binding)
    │                            ↓
    │                           (Can still be overridden by Legislative)
    │
    └─── escalateToGovernance → GovernanceReview
                ↓
         resolveByGovernance → Accepted/Rejected (Legislative, supreme)
```

Three resolution paths; ascending authority.

## Why three branches, not one

If only Executive (peer attestation):
- Cheap to run (no tribunal overhead).
- Collusion attack: coordinate attestations to pass any claim.
- Single-branch capture vulnerable.

If only Judicial (tribunal every time):
- Fair but slow.
- Every claim blocks on jury selection + trial.
- Scaling: every claim can't be a trial.

If only Legislative (governance every time):
- Slow and expensive.
- Governance capture vulnerable.
- Scaling: DAO can't vote on every attestation.

Three-branch composition: most claims auto-accept via executive (low-friction); contested claims escalate to tribunal; exceptional claims escalate to governance.

Each branch handles a specific scope. Together: fairness-at-scale.

## ContributionType enum

Nine values:

| Int | Name | Typical claim |
|---|---|---|
| 0 | Code | Solidity, frontend, infrastructure commit |
| 1 | Design | UI/UX, branding, architectural pattern |
| 2 | Research | Whitepaper, mechanism memo, analysis |
| 3 | Community | Moderation, onboarding, Telegram support |
| 4 | Marketing | Tweet, article, outreach |
| 5 | Security | Audit, bug report, fuzzing output |
| 6 | Governance | Proposal drafting, voting facilitation |
| 7 | Inspiration | Cultural, philosophical, dialogue |
| 8 | Other | Catch-all |

Different contribution types may have different acceptance patterns. Research claims might typically need more attestations than Code claims because Research is harder to evaluate.

See [`CONTRIBUTION_TRACEABILITY.md`](./CONTRIBUTION_TRACEABILITY.md) for how GitHub issue labels map to these enum values.

## Gas bounds

Cost per operation (approximate):

- `submitClaim`: ~150K gas.
- `attest`: ~80K gas.
- `contest`: ~80K gas.
- `escalateToTribunal`: ~100K gas.
- `resolveByTribunal`: ~120K gas.
- `escalateToGovernance`: ~100K gas.

For 100 claims/day × 3 attestations/claim average = 300 transactions/day.
300 × 80K gas × $20/Mgas = $480/day. Moderate cost at scale.

Hard limits:
- `MAX_ATTESTATIONS_PER_CLAIM = 50` — gas-bounded.
- `MIN_CLAIM_TTL = 1 day` — prevents claim-spam churn.

## The evidenceHash field

The evidenceHash is opaque to the contract. It's a commitment to external content (commit SHA, document hash, off-chain proof).

[`CONTRIBUTION_TRACEABILITY.md`](./CONTRIBUTION_TRACEABILITY.md) specifies the canonical construction:

```
evidenceHash = keccak256(abi.encode(
    issueNumber,
    commitSha,
    sourceTimestamp
))
```

This commits all three layers (GitHub issue, commit, source). Changing any one changes the hash, breaking the commitment.

The contract doesn't verify the hash matches claim description. That's an off-chain concern; the commitment preserves evidence integrity without requiring on-chain validation.

## The value field

`value` is an initial weight hint. It flows downstream:

- [`ShapleyDistributor`](../shapley/SHAPLEY_REWARD_SYSTEM.md) reads accepted claims via `getClaimsByContributor(addr)`.
- Uses `claim.value` as a marginal-contribution estimate input.
- Final Shapley value is computed per the distribution math.

Higher `value` at submission means the claim is indicating significant expected contribution. But the final reward depends on Shapley, not just `value`.

## Integration with Shapley

Flow:

1. Claim submitted with proposed value.
2. Peer attestations accumulate weight.
3. Threshold → Accepted (or escalation to tribunal → Accepted/Rejected).
4. Shapley distributor queries accepted claims.
5. Shapley computation uses claims as input; produces per-contributor rewards.
6. Rewards distributed (possibly via Optimistic Shapley for scale — see [`OPTIMISTIC_SHAPLEY.md`](../shapley/OPTIMISTIC_SHAPLEY.md)).

Attestor produces the "who contributed what" data. Shapley produces the "how much each gets." Different concerns; clean separation.

## What ContributionAttestor does NOT do

Careful to distinguish:

- **Does NOT provide trust-scores.** That's [`ContributionDAG`](./CONTRIBUTION_DAG_EXPLAINER.md). Attestor QUERIES DAG for trust-weights.
- **Does NOT distribute rewards.** That's `ShapleyDistributor`. Attestor provides claim data; Shapley does the distribution.
- **Does NOT run tribunals.** That's `DecentralizedTribunal`. Attestor escalates to it.
- **Does NOT host governance votes.** That's `QuadraticVoting`. Attestor escalates to it.

Attestor is the claim substrate. Everything else queries or coordinates with it.

## Architecture position

```
ContributionDAG (trust) → ContributionAttestor (claims) → ShapleyDistributor (rewards)
                                      ↓
                          DecentralizedTribunal (disputes)
                          QuadraticVoting (governance escalations)
```

Attestor is the middleware between trust-substrate and distribution. Every claim flows through it.

## For students

Exercise: simulate a claim's journey. 

Setup: you're Alice. You want to attest Bob's contribution. Three scenarios:

**Scenario A**: happy path. Alice attests. Carol (another trusted user) attests. Claim auto-accepts via executive.

**Scenario B**: contested path. Alice attests. Carol contests. Escalate to tribunal. Tribunal verdict GUILTY. Accepted via judicial.

**Scenario C**: governance override. Previous tribunal verdict rejected. Alice escalates to governance. Proposal passes. Accepted via legislative.

Walk through each step. Write down:
- The function calls.
- The state changes.
- Who pays gas.

This exercise teaches the three-branch flow hands-on.

## Relationship to other primitives

- **Parent**: [`ECONOMIC_THEORY_OF_MIND.md`](../etm/ECONOMIC_THEORY_OF_MIND.md) — multi-agent consensus via three-branch heterogeneity.
- **Uses**: [`ContributionDAG`](./CONTRIBUTION_DAG_EXPLAINER.md) for trust-weights.
- **Fed by**: [`CONTRIBUTION_TRACEABILITY.md`](./CONTRIBUTION_TRACEABILITY.md) — canonical source-to-claim format.
- **Feeds**: [`ShapleyDistributor`] for rewards, [`QuadraticVoting`] for voting weight.

## One-line summary

*ContributionAttestor is the claim substrate with three-branch resolution: Executive (peer attestations via trust-weights; auto-accepts at threshold 2.0 PRECISION) → Judicial (tribunal for contested claims) → Legislative (governance for supreme override). Walked claim journey (Alice submits Bob's audit, Carol+Dave attest, Tom contests, escalation to tribunal, verdict GUILTY, resolved Judicial) makes the flow tangible. Gas-bounded, three-branch capture-resistant, ETM-aligned.*
