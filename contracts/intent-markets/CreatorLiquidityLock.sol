// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./interfaces/ICreatorLiquidityLock.sol";

/**
 * @title CreatorLiquidityLock — Anti-Rug Mechanism
 * @author Faraday1 & JARVIS — vibeswap.org
 * @notice Creator deposits liquidity with time-lock to back their memecoin launch.
 *         Slashing for protocol violation sends 50% to LP reward pool.
 *         "The creator's deposit is their skin in the game. Rug = slashed."
 *
 * @dev Fix #3 from the memecoin intent market paper.
 *      Paper: docs/papers/memecoin-intent-market-seed.md §3
 *      P-000: Fairness Above All.
 */
contract CreatorLiquidityLock is
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable,
    ICreatorLiquidityLock
{
    using SafeERC20 for IERC20;

    // ============ Constants ============

    /// @notice 50% slash rate — matches CommitRevealAuction.SLASH_RATE_BPS
    uint256 public constant SLASH_RATE_BPS = 5000;
    uint256 public constant BASIS_POINTS = 10000;

    // ============ State ============

    uint256 private _lockCount;

    /// @notice lock ID => LiquidityLock
    mapping(uint256 => LiquidityLock) private _locks;

    /// @notice Where slashed funds go (LP reward pool)
    address public lpRewardPool;

    /// @notice Minimum lock duration (default: 30 days)
    uint64 public minLockDuration;

    /// @notice Maximum lock duration (default: 365 days)
    uint64 public maxLockDuration;

    /// @notice Minimum creator deposit amount
    uint256 public minLockAmount;

    /// @notice Addresses authorized to slash (MemecoinLaunchAuction, governance)
    mapping(address => bool) public authorizedSlashers;

    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Constructor ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // ============ Init ============

    function initialize(
        address _lpRewardPool,
        uint64 _minLockDuration,
        uint64 _maxLockDuration,
        uint256 _minLockAmount
    ) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        lpRewardPool = _lpRewardPool;
        minLockDuration = _minLockDuration;
        maxLockDuration = _maxLockDuration;
        minLockAmount = _minLockAmount;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Admin ============

    function authorizeSlasher(address slasher) external onlyOwner {
        authorizedSlashers[slasher] = true;
    }

    function revokeSlasher(address slasher) external onlyOwner {
        authorizedSlashers[slasher] = false;
    }

    function setLpRewardPool(address _lpRewardPool) external onlyOwner {
        lpRewardPool = _lpRewardPool;
    }

    // ============ Core ============

    /// @inheritdoc ICreatorLiquidityLock
    function lock(
        address creator,
        address token,
        uint256 amount,
        uint64 duration,
        uint256 launchId
    ) external payable override nonReentrant returns (uint256 lockId) {
        if (duration < minLockDuration) revert DurationTooShort();
        if (duration > maxLockDuration) revert DurationTooLong();
        if (amount < minLockAmount) revert InsufficientAmount();

        lockId = ++_lockCount;

        if (token == address(0)) {
            // ETH lock
            require(msg.value == amount, "ETH amount mismatch");
        } else {
            // ERC20 lock
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        }

        _locks[lockId] = LiquidityLock({
            creator: creator,
            token: token,
            amount: amount,
            lockStart: uint64(block.timestamp),
            lockDuration: duration,
            launchId: launchId,
            slashed: false,
            withdrawn: false
        });

        emit LiquidityLocked(lockId, creator, token, amount, duration, launchId);
    }

    /// @inheritdoc ICreatorLiquidityLock
    function slash(uint256 lockId) external override nonReentrant {
        if (!authorizedSlashers[msg.sender]) revert NotAuthorizedSlasher();

        LiquidityLock storage lk = _locks[lockId];
        if (lk.slashed) revert AlreadySlashed();
        if (lk.withdrawn) revert AlreadyWithdrawn();

        lk.slashed = true;
        uint256 slashAmount = (lk.amount * SLASH_RATE_BPS) / BASIS_POINTS;

        if (lk.token == address(0)) {
            (bool ok, ) = lpRewardPool.call{value: slashAmount}("");
            require(ok, "ETH transfer failed");
        } else {
            IERC20(lk.token).safeTransfer(lpRewardPool, slashAmount);
        }

        emit LiquiditySlashed(lockId, lk.creator, slashAmount, lpRewardPool);
    }

    /// @inheritdoc ICreatorLiquidityLock
    function withdraw(uint256 lockId) external override nonReentrant {
        LiquidityLock storage lk = _locks[lockId];
        if (msg.sender != lk.creator) revert NotLockCreator();
        if (lk.slashed) revert AlreadySlashed();
        if (lk.withdrawn) revert AlreadyWithdrawn();
        if (block.timestamp < lk.lockStart + lk.lockDuration) revert LockNotExpired();

        lk.withdrawn = true;

        if (lk.token == address(0)) {
            (bool ok, ) = lk.creator.call{value: lk.amount}("");
            require(ok, "ETH transfer failed");
        } else {
            IERC20(lk.token).safeTransfer(lk.creator, lk.amount);
        }

        emit LiquidityWithdrawn(lockId, lk.creator, lk.amount);
    }

    // ============ Views ============

    /// @inheritdoc ICreatorLiquidityLock
    function isLocked(uint256 lockId) external view override returns (bool) {
        LiquidityLock storage lk = _locks[lockId];
        return !lk.slashed && !lk.withdrawn && block.timestamp < lk.lockStart + lk.lockDuration;
    }

    /// @inheritdoc ICreatorLiquidityLock
    function getLock(uint256 lockId) external view override returns (LiquidityLock memory) {
        return _locks[lockId];
    }

    /// @notice Total number of locks created
    function lockCount() external view returns (uint256) {
        return _lockCount;
    }

    receive() external payable {}
}
