// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ICreatorLiquidityLock
 * @notice Anti-rug mechanism: creator deposits liquidity with time-lock.
 *         Slashed funds flow to LP reward pool. Fix #3 from the memecoin
 *         intent market paper.
 *
 *      Paper: docs/papers/memecoin-intent-market-seed.md §3
 *      "Creator commits liquidity with a time-lock. Reveal phase shows
 *       the full tokenomics. Slashing for early withdrawal."
 */
interface ICreatorLiquidityLock {
    // ============ Structs ============

    struct LiquidityLock {
        address creator;
        address token;           // reserve token locked (address(0) = ETH)
        uint256 amount;
        uint64 lockStart;
        uint64 lockDuration;
        uint256 launchId;        // memecoin launch this secures
        bool slashed;
        bool withdrawn;
    }

    // ============ Events ============

    event LiquidityLocked(
        uint256 indexed lockId,
        address indexed creator,
        address token,
        uint256 amount,
        uint64 lockDuration,
        uint256 indexed launchId
    );

    event LiquiditySlashed(
        uint256 indexed lockId,
        address indexed creator,
        uint256 slashedAmount,
        address lpRewardPool
    );

    event LiquidityWithdrawn(
        uint256 indexed lockId,
        address indexed creator,
        uint256 amount
    );

    // ============ Errors ============

    error NotAuthorizedSlasher();
    error LockNotExpired();
    error AlreadySlashed();
    error AlreadyWithdrawn();
    error DurationTooShort();
    error DurationTooLong();
    error InsufficientAmount();
    error NotLockCreator();

    // ============ Functions ============

    function lock(
        address creator,
        address token,
        uint256 amount,
        uint64 duration,
        uint256 launchId
    ) external payable returns (uint256 lockId);

    function slash(uint256 lockId) external;
    function withdraw(uint256 lockId) external;
    function isLocked(uint256 lockId) external view returns (bool);
    function getLock(uint256 lockId) external view returns (LiquidityLock memory);
}
