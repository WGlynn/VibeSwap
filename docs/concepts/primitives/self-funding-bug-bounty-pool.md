# Self-Funding Bug-Bounty Pool

**Status**: shipped (cycle C47, OCR V2a)
**First instance**: `OperatorCellRegistry.slashPool`; generalized in `ClawbackRegistry.contestRewardPool`
**Convergence with**: `bonded-permissionless-contest.md`

## The pattern

A protocol pays rewards to parties who successfully expose adversarial behavior — failed authority decisions, unresponsive operators, mis-classified clawback cases. The naive shape funds these rewards from an external treasury subsidy: governance must keep topping up a budget. The self-funding shape closes the loop: **forfeited losing bonds from the same dispute mechanism bootstrap the reward pool.** No external subsidy is required after the seed phase, because the population of adversarial events itself produces the funding.

```solidity
uint256 public contestRewardPool;          // pull-based, internal accounting

function dismissContest(bytes32 caseId) external onlyAuthority {
    // Contest loses: bond credited to the same pool that pays winners.
    contestRewardPool += ct.bond;
}

function upholdContest(bytes32 caseId) external onlyAuthority {
    // Contest wins: bond returned + reward paid FROM the pool, capped at balance.
    uint256 reward = contestSuccessReward;
    if (reward > contestRewardPool) reward = contestRewardPool;
    contestRewardPool -= reward;
    IERC20(token).safeTransfer(contestant, ct.bond + reward);
}
```

Failed contests fund successful ones. The pool is a moving balance, never an unbounded liability. Governance can optionally seed the pool early via `fundContestRewardPool` to bootstrap the first round of winners before any forfeitures have accrued.

## Why it works

The economics of the pool are self-balancing in the long run. If the authority is well-calibrated and most contests are frivolous, dismissed bonds dominate the inflow and the pool grows. If the authority is poorly calibrated and most contests are upheld, the pool drains — but the cap-at-balance pay logic means the protocol never owes more than it has, so the worst case is "rewards taper to zero," not "treasury insolvency." Either regime is bounded.

The pool also self-incentivizes calibration: a regularly-draining pool signals authority error; a regularly-growing pool signals frivolous-contest spam. Treasury operators get a single observable metric (pool delta) that summarizes the dispute channel's health.

The cap-at-balance rule is load-bearing. Without it, an upheld contest could underflow the pool (if `successReward > contestRewardPool`) and either revert (denying the contestant their bond return — a bigger problem than denied reward) or trigger an external treasury draw the mechanism cannot guarantee. Capping at the current pool balance means uphold always succeeds, with degraded reward at worst.

## Concrete example

From `contracts/compliance/ClawbackRegistry.sol`:

```solidity
/// @notice Pool of forfeited bonds + governance-seeded funds, used to pay
///         success rewards. Pull-based via internal accounting; tokens sit
///         in this contract until claimed. Mirrors OCR `slashPool`.
uint256 public contestRewardPool;

function upholdContest(bytes32 caseId) external nonReentrant {
    // ... authority check + status checks ...
    uint256 reward = contestSuccessReward;
    if (reward > contestRewardPool) {
        reward = contestRewardPool;            // cap at current pool balance
    }
    if (reward > 0) {
        contestRewardPool -= reward;
    }
    ct.status = ContestStatus.UPHELD;
    // ... case dismissal logic ...
    IERC20(bondToken_).safeTransfer(contestant_, bond + reward);
    emit ContestUpheld(caseId, contestant_, bond, reward);
}

function dismissContest(bytes32 caseId) external nonReentrant {
    // ... authority check + status checks ...
    ct.status = ContestStatus.DISMISSED;
    if (bondToken_ == contestBondToken) {
        contestRewardPool += bond;            // forfeit feeds the pool
    }
    emit ContestDismissed(caseId, contestant_, bond);
}

function fundContestRewardPool(uint256 amount) external nonReentrant {
    // Bootstrap path: governance / insurance / donors seed the pool before forfeitures accrue.
    IERC20(contestBondToken).safeTransferFrom(msg.sender, address(this), amount);
    contestRewardPool += amount;
}
```

Original instance from `contracts/consensus/OperatorCellRegistry.sol`:

```solidity
/// @notice Accumulated slashed bonds awaiting sweep to treasury. Mirrors C29.
uint256 public slashPool;
// On claimAssignmentSlash:
//   slashPoolAdd = slashAmount - challengerPayout;     // 50% of slashed bond
//   slashPool += slashPoolAdd;
```

Both use the same shape: bond inflow on losses, capped pay-out on wins, optional governance seed.

## When to use

- The protocol already has a bonded-dispute mechanism (see `bonded-permissionless-contest.md`).
- Dispute outcomes are frequent enough that the pool reaches steady-state in a reasonable time horizon (months, not decades).
- The reward currency matches the bond currency, or governance is willing to maintain a pool-token snapshot per dispute.
- The protocol prefers structural funding over recurring treasury votes.

## When NOT to use

- Disputes are rare and high-stakes (a once-per-year regulatory case). The pool will not accrue meaningfully; an explicit treasury allocation is more honest.
- Bond denomination is volatile (e.g., a memecoin chosen by governance), so the pool's purchasing power for rewards is unstable. Use a stable bond token (CKB, JUL).
- The dispute channel is structurally one-sided (e.g., always upheld). The pool will drain to zero and the structure no longer self-funds — re-evaluate calibration before adding subsidy.

## Related primitives

- [`bonded-permissionless-contest.md`](./bonded-permissionless-contest.md) — parent: the dispute mechanism that produces the bond inflows. The pool is meaningless without it.
