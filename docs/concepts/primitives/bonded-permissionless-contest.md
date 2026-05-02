# Bonded Permissionless Contest

**Status**: shipped (cycle C47, OCR V2a)
**First instance**: `OperatorCellRegistry.challengeAssignment` / `claimAssignmentSlash`; generalized in `ClawbackRegistry.openContest` / `resolveExpiredContest`
**Convergence with**: `self-funding-bug-bounty-pool.md`, `dual-path-adjudication-preserving-existing-oracle.md`, `fail-closed-on-upgrade.md`

## The pattern

A protocol has an action that is finalized by an authority (an off-chain regulator, a federated consensus, an operator's own response, etc.). Naively, the action is irreversible once the authority signs off — and the only recourse for an aggrieved party is off-chain (sue, complain, fork). The bonded-permissionless-contest pattern inserts a **finite contest window** between the action's commit and its finalization. Anyone can post a **bond** within that window to dispute the action. The dispute is adjudicated either by the existing authority (`uphold` / `dismiss`) or by **permissionless default-on-expiry** (a deadline-driven default outcome that anyone can trigger if the authority falls silent).

```solidity
function openContest(bytes32 caseId, string calldata evidenceURI) external {
    // Pull bond, snapshot deadline, mark contest ACTIVE.
}
function upholdContest(bytes32 caseId) external onlyAuthority {
    // Authority sides with contestant: bond + reward returned, action voided.
}
function dismissContest(bytes32 caseId) external onlyAuthority {
    // Authority rejects contest: bond forfeited to pool, action proceeds.
}
function resolveExpiredContest(bytes32 caseId) external {
    // Permissionless: deadline passed, default outcome applies, bond forfeited.
}
```

The pattern converts "trust the authority absolutely" into "the authority must engage on a math-enforced timeline, and the math defaults a sensible outcome on silence." Bond size + window length tune the cost of frivolous disputes vs. the cost of authority capture.

## Why it works

Three independent properties combine.

**Skin-in-the-game gates noise.** Without a bond, a contest channel becomes spam. The bond floor (`MIN_CONTEST_BOND`, `MIN_BOND_PER_CELL`) ensures every contest carries economic weight; trivial disputes self-filter.

**A deadline forces engagement.** An authority that never resolves a contest used to be invisible. With a deadline + permissionless `resolveExpiredContest`, silence is punished structurally: the default-on-expiry outcome fires whether the authority shows up or not. The authority cannot deadlock a case by ignoring it — anyone can call the resolver.

**Default-on-expiry encodes the burden of proof.** A contest is a *claim* that must be substantiated, not a presumption. So default-on-expiry favors the standing action and forfeits the contestant's bond. (The mirror could be inverted — default-favors-contestant — for actions where the burden of proof is on the authority. The point is that *some* deterministic default must exist.)

## Concrete example

From `contracts/compliance/ClawbackRegistry.sol`:

```solidity
function openContest(bytes32 caseId, string calldata evidenceURI) external nonReentrant {
    if (!contestParamsInitialized) revert ContestParamsNotInitialized();
    ClawbackCase storage c = cases[caseId];
    if (c.status != CaseStatus.OPEN && c.status != CaseStatus.VOTING) {
        revert InvalidCaseStatus();
    }
    CaseContest storage ct = caseContests[caseId];
    if (ct.status == ContestStatus.ACTIVE) revert ContestActive();

    uint256 bond = contestBondAmount;
    IERC20(contestBondToken).safeTransferFrom(msg.sender, address(this), bond);

    ct.contestant  = msg.sender;
    ct.bond        = bond;
    ct.bondToken   = contestBondToken;          // snapshot — guards bondToken rotation
    ct.openedAt    = uint64(block.timestamp);
    ct.deadline    = uint64(block.timestamp) + contestWindow;
    ct.status      = ContestStatus.ACTIVE;
    ct.evidenceURI = evidenceURI;
    emit ContestOpened(caseId, msg.sender, bond, ct.deadline, evidenceURI);
}

function resolveExpiredContest(bytes32 caseId) external nonReentrant {
    CaseContest storage ct = caseContests[caseId];
    if (ct.status != ContestStatus.ACTIVE) revert NoActiveContest();
    if (block.timestamp <= ct.deadline) revert ContestNotExpired();
    ct.status = ContestStatus.EXPIRED;
    if (ct.bondToken == contestBondToken) {
        contestRewardPool += ct.bond;             // forfeit on silence
    }
    emit ContestExpired(caseId, ct.contestant, ct.bond);
}
```

Original instance, `contracts/consensus/OperatorCellRegistry.sol`:

```solidity
function challengeAssignment(bytes32 cellId, bytes32 nonce) external nonReentrant {
    // Permissionless probe: anyone with ASSIGNMENT_CHALLENGE_BOND can demand a liveness response.
    ckbToken.safeTransferFrom(msg.sender, address(this), ASSIGNMENT_CHALLENGE_BOND);
    c.deadline = block.timestamp + ASSIGNMENT_CHALLENGE_RESPONSE_WINDOW;
    // ... operator must echo nonce in respondToAssignmentChallenge before deadline.
}
function claimAssignmentSlash(bytes32 cellId) external nonReentrant {
    // Permissionless default: deadline passed, slash fires regardless of authority engagement.
    if (block.timestamp <= c.deadline) revert ChallengeNotExpired();
    // ... split slashed bond into challenger payout + slashPool.
}
```

Both instances share the same shape: bond + window + adjudication entry + permissionless default-on-expiry.

## When to use

- A finalized action has potential adversarial-error modes that the authority alone cannot reliably catch (regulatory mistake, operator misclassification, adverse selection in voting).
- The authority is structurally appropriate for the dispute (regulator for regulatory adjudication, operator for liveness response) but has incentive to be slow / silent.
- The protocol can tolerate a contest-window delay between commit and finalization.
- A meaningful bond floor exists in the relevant asset (CKB, JUL, USDC).

## When NOT to use

- The action is time-critical and a contest window introduces unacceptable latency (e.g., real-time price oracle update, MEV-sensitive settlement).
- No party with adverse interest exists to pay the bond — the contest channel will be empty and is dead weight.
- The authority's response time is already math-enforced by other means (e.g., a cryptographic deadline embedded in the action itself).

## Related primitives

- [`self-funding-bug-bounty-pool.md`](./self-funding-bug-bounty-pool.md) — sibling: forfeited bonds bootstrap rewards for future contestants without external treasury subsidy.
- [`dual-path-adjudication-preserving-existing-oracle.md`](./dual-path-adjudication-preserving-existing-oracle.md) — meta: the contest does NOT replace the existing authority; it gates the authority's inputs/outputs on a deadline.
- [`fail-closed-on-upgrade.md`](./fail-closed-on-upgrade.md) — contest entry-points revert with `ContestParamsNotInitialized` until `initializeContestV1` runs, so an upgrade with un-tuned bond/window cannot be exploited.
