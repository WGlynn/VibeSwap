// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title VibeLiquidityLocker — LP Token Lock Service
 * @notice Trustless LP token locking for rug-pull prevention.
 *         Project teams lock LP tokens to prove liquidity commitment.
 *
 * @dev Features:
 *      - Time-locked LP tokens with cliff
 *      - Linear vesting after cliff
 *      - Extend lock (never shorten)
 *      - Transfer lock ownership
 *      - Verified lock badges for frontend
 */
contract VibeLiquidityLocker is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    // ============ Types ============

    struct Lock {
        uint256 lockId;
        address owner;
        address lpToken;
        uint256 amount;
        uint256 lockStart;
        uint256 cliffEnd;
        uint256 vestingEnd;
        uint256 amountClaimed;
        bool active;
    }

    // ============ State ============

    mapping(uint256 => Lock) public locks;
    uint256 public lockCount;

    /// @notice Locks by owner
    mapping(address => uint256[]) public ownerLocks;

    /// @notice Locks by LP token
    mapping(address => uint256[]) public tokenLocks;

    /// @notice Total locked per LP token
    mapping(address => uint256) public totalLockedPerToken;

    /// @notice Lock fee (flat ETH fee)
    uint256 public lockFee;

    /// @notice Total fees collected
    uint256 public totalFees;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event LiquidityLocked(uint256 indexed lockId, address indexed owner, address lpToken, uint256 amount, uint256 cliffEnd, uint256 vestingEnd);
    event LiquidityClaimed(uint256 indexed lockId, uint256 amount);
    event LockExtended(uint256 indexed lockId, uint256 newVestingEnd);
    event LockTransferred(uint256 indexed lockId, address indexed from, address indexed to);

    // ============ Init ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(uint256 _lockFee) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        lockFee = _lockFee;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Locking ============

    /**
     * @notice Lock LP tokens
     * @param lpToken The LP token to lock
     * @param amount Amount to lock
     * @param cliffDuration Cliff period (seconds)
     * @param vestingDuration Total vesting period after cliff (seconds)
     */
    function lockLiquidity(
        address lpToken,
        uint256 amount,
        uint256 cliffDuration,
        uint256 vestingDuration
    ) external payable nonReentrant returns (uint256) {
        require(amount > 0, "Zero amount");
        require(cliffDuration > 0, "Zero cliff");
        require(msg.value >= lockFee, "Insufficient fee");

        IERC20(lpToken).safeTransferFrom(msg.sender, address(this), amount);

        lockCount++;
        uint256 cliffEnd = block.timestamp + cliffDuration;
        uint256 vestingEnd = cliffEnd + vestingDuration;

        locks[lockCount] = Lock({
            lockId: lockCount,
            owner: msg.sender,
            lpToken: lpToken,
            amount: amount,
            lockStart: block.timestamp,
            cliffEnd: cliffEnd,
            vestingEnd: vestingEnd,
            amountClaimed: 0,
            active: true
        });

        ownerLocks[msg.sender].push(lockCount);
        tokenLocks[lpToken].push(lockCount);
        totalLockedPerToken[lpToken] += amount;
        totalFees += lockFee;

        // Refund excess
        if (msg.value > lockFee) {
            (bool ok, ) = msg.sender.call{value: msg.value - lockFee}("");
            require(ok, "Refund failed");
        }

        emit LiquidityLocked(lockCount, msg.sender, lpToken, amount, cliffEnd, vestingEnd);
        return lockCount;
    }

    /**
     * @notice Claim vested LP tokens
     */
    function claimVested(uint256 lockId) external nonReentrant {
        Lock storage lk = locks[lockId];
        require(lk.owner == msg.sender, "Not owner");
        require(lk.active, "Not active");
        require(block.timestamp >= lk.cliffEnd, "Cliff not passed");

        uint256 claimable = _getClaimable(lk);
        require(claimable > 0, "Nothing to claim");

        lk.amountClaimed += claimable;

        if (lk.amountClaimed >= lk.amount) {
            lk.active = false;
        }

        totalLockedPerToken[lk.lpToken] -= claimable;
        IERC20(lk.lpToken).safeTransfer(msg.sender, claimable);

        emit LiquidityClaimed(lockId, claimable);
    }

    /**
     * @notice Extend a lock (can never shorten)
     */
    function extendLock(uint256 lockId, uint256 newVestingEnd) external {
        Lock storage lk = locks[lockId];
        require(lk.owner == msg.sender, "Not owner");
        require(lk.active, "Not active");
        require(newVestingEnd > lk.vestingEnd, "Must extend");

        lk.vestingEnd = newVestingEnd;

        emit LockExtended(lockId, newVestingEnd);
    }

    /**
     * @notice Transfer lock ownership
     */
    function transferLock(uint256 lockId, address to) external {
        Lock storage lk = locks[lockId];
        require(lk.owner == msg.sender, "Not owner");
        require(to != address(0), "Zero address");

        address from = lk.owner;
        lk.owner = to;
        ownerLocks[to].push(lockId);

        emit LockTransferred(lockId, from, to);
    }

    // ============ Admin ============

    function setLockFee(uint256 fee) external onlyOwner {
        lockFee = fee;
    }

    function withdrawFees() external onlyOwner {
        uint256 bal = address(this).balance;
        require(bal > 0, "No fees");
        (bool ok, ) = owner().call{value: bal}("");
        require(ok, "Withdraw failed");
    }

    // ============ Internal ============

    function _getClaimable(Lock storage lk) internal view returns (uint256) {
        if (block.timestamp < lk.cliffEnd) return 0;

        uint256 totalVested;
        if (block.timestamp >= lk.vestingEnd) {
            totalVested = lk.amount;
        } else {
            uint256 vestingDuration = lk.vestingEnd - lk.cliffEnd;
            uint256 elapsed = block.timestamp - lk.cliffEnd;
            totalVested = (lk.amount * elapsed) / vestingDuration;
        }

        return totalVested - lk.amountClaimed;
    }

    // ============ View ============

    function getClaimable(uint256 lockId) external view returns (uint256) {
        return _getClaimable(locks[lockId]);
    }

    function getOwnerLocks(address owner_) external view returns (uint256[] memory) {
        return ownerLocks[owner_];
    }

    function getTokenLocks(address token) external view returns (uint256[] memory) {
        return tokenLocks[token];
    }

    function getTotalLocked(address token) external view returns (uint256) {
        return totalLockedPerToken[token];
    }

    function getLockCount() external view returns (uint256) { return lockCount; }
}
