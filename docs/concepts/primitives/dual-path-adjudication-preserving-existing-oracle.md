# Dual-Path Adjudication — Preserving the Existing Oracle

**Status**: shipped (cycle C47)
**First instance**: `ClawbackRegistry` C47 contest path layered on `FederatedConsensus` authority-vote path
**Convergence with**: `bonded-permissionless-contest.md`, `self-funding-bug-bounty-pool.md`, `fail-closed-on-upgrade.md`

## The pattern

A protocol has an off-chain oracle that is structurally the *right* authority for a class of decision: a regulator for regulatory adjudication, a security council for emergency response, a federated consensus for jurisdiction-aware rules. The oracle is appropriate for the job, but it has failure modes — slow response, partial capture, silent denial — that math-only mechanisms could not have invented but can mitigate.

The naive instinct is to **replace** the oracle with an on-chain mechanism (e.g., a fully-permissionless dispute market). This routinely fails: the new mechanism cannot reproduce the regulatory legitimacy the oracle provided, and the protocol now has a worse-shaped authority surface than before. Authority-substitution is the failure mode.

Dual-path adjudication preserves the oracle as the **primary** decision-maker and gates its inputs/outputs on a math-enforced **timeline**. The on-chain mechanism does not adjudicate the case; it constrains *when* the oracle must speak, and supplies a deterministic default-on-expiry if the oracle never does. Math becomes the *clock*, not the *judge*.

```solidity
// PRESERVED: existing authority is still the dispute-resolution oracle.
function upholdContest(bytes32 caseId) external {
    require(
        consensus.isActiveAuthority(msg.sender) || msg.sender == owner(),
        "Not authorized"
    );
    // ... authority's ruling is recorded ...
}

// ADDED: math-enforced deadline + permissionless default-on-expiry.
function resolveExpiredContest(bytes32 caseId) external {
    if (block.timestamp <= ct.deadline) revert ContestNotExpired();
    // Default outcome fires regardless of authority engagement.
}
```

The authority's substantive role is unchanged. What is added is structural accountability: the authority must engage by the deadline or the math defaults a sensible outcome. Capture-by-silence is foreclosed.

## Why it works

Three failure-modes of authority-substitution are sidestepped at once.

**Legitimacy is preserved.** Regulatory rulings, security-council pauses, and federated-consensus votes carry institutional weight that an on-chain mechanism cannot reproduce. Replacing the oracle with a market discards that legitimacy. Gating it on a timeline does not.

**Domain expertise is preserved.** The oracle's input set is richer than the chain's. A regulator considers off-chain evidence packages, jurisdictional context, prior rulings. The on-chain mechanism cannot evaluate evidence; it can only enforce a deadline. Keep the substantive judgment with the authority that has the substantive context.

**Math fills the gap the authority cannot.** The authority's failure mode is silence-by-capture or silence-by-overload. Math is uniquely good at deadlines: a `block.timestamp` comparison runs whether anyone engages or not. The on-chain mechanism's contribution is exactly what the off-chain oracle is bad at — running the clock — and nothing more.

The pattern also creates a feedback channel. If the default-on-expiry path fires repeatedly, the authority is failing structurally; governance has an observable signal to act. If the authority resolves consistently before deadline, the dual-path is silently doing nothing — also fine, also observable.

## Concrete example

From `contracts/compliance/ClawbackRegistry.sol`. A regulator's clawback rulings are the existing authority path; the C47 contest layer adds a deadline + permissionless default without substituting the authority:

```solidity
// Authority path is PRESERVED. FederatedConsensus authorities remain the
// dispute-resolution oracle (right authority for regulatory adjudication).
FederatedConsensus public consensus;

// Authority resolves on-deadline.
function upholdContest(bytes32 caseId) external nonReentrant {
    require(
        consensus.isActiveAuthority(msg.sender) || msg.sender == owner(),
        "Not authorized"
    );
    CaseContest storage ct = caseContests[caseId];
    if (ct.status != ContestStatus.ACTIVE) revert NoActiveContest();
    if (block.timestamp > ct.deadline) revert ContestExpiredError();
    // ... authority ruling fires: case dismissed, bond + reward returned ...
}

function dismissContest(bytes32 caseId) external nonReentrant {
    require(
        consensus.isActiveAuthority(msg.sender) || msg.sender == owner(),
        "Not authorized"
    );
    // ... authority ruling fires the other way: bond forfeited ...
}

// Math-enforced default: if authority never engages, anyone may resolve.
function resolveExpiredContest(bytes32 caseId) external nonReentrant {
    CaseContest storage ct = caseContests[caseId];
    if (ct.status != ContestStatus.ACTIVE) revert NoActiveContest();
    if (block.timestamp <= ct.deadline) revert ContestNotExpired();
    // Default-on-expiry favors the standing case (contest must be proven, not assumed).
    ct.status = ContestStatus.EXPIRED;
    if (ct.bondToken == contestBondToken) {
        contestRewardPool += ct.bond;
    }
    emit ContestExpired(caseId, ct.contestant, ct.bond);
}
```

The storage block makes the design choice explicit:

> Adjudication: FederatedConsensus authorities REMAIN the dispute-resolution
> oracle (right authority for regulatory adjudication). What changes:
> - Authority must engage with the contest on a math-enforced timeline.
> - During the active contest window, `executeClawback` is GATED.
> - If neither uphold nor dismiss happens before window expiry, anyone may
>   call `resolveExpiredContest`.

The contest does not vote against the regulator; it runs a clock the regulator must beat.

## When to use

- An off-chain authority is structurally appropriate for the decision class (regulators, security councils, federated consensus, KYC providers).
- The authority's failure modes are predominantly *temporal* (slow response, silent denial) rather than *substantive* (wrong rulings).
- The protocol can articulate a sensible default outcome that fires when the authority is silent (default-favors-standing-action, default-favors-claim, default-to-snapshot, etc.).
- The deadline length can be calibrated to give the authority realistic engagement time without locking the protocol up indefinitely.

## When NOT to use

- The authority's substantive rulings are themselves the failure mode. Then the right move is either (a) replace the authority outright, or (b) constrain its rulings via a separate oracle, not via a deadline.
- No sensible default-on-expiry exists — the decision is genuinely high-context and any deterministic default is wrong. Use a longer authority deadline + an escalation hatch instead.
- The authority operates entirely off-chain with no on-chain hook; there is nothing to gate. (In that case the dual-path is built between two on-chain mechanisms, not between an oracle and math.)

## Related primitives

- [`bonded-permissionless-contest.md`](./bonded-permissionless-contest.md) — the on-chain side of the pattern: bond + window + permissionless default-on-expiry. Dual-path-adjudication is the *meta-rule* for how that mechanism interacts with the existing authority.
- [`self-funding-bug-bounty-pool.md`](./self-funding-bug-bounty-pool.md) — funds the contestant rewards using forfeited bonds, so adding the dual-path does not require a recurring treasury subsidy.
- [`fail-closed-on-upgrade.md`](./fail-closed-on-upgrade.md) — until the contest parameters are initialized via `initializeContestV1`, the new path reverts; the existing authority path is unchanged. The dual-path is added without a window of reduced safety.
