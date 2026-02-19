// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IVestingSchedule.sol";

/**
 * @title VestingSchedule
 * @notice Token vesting with cliff + linear unlock for team/contributors.
 * @dev Part of VSOS (VibeSwap Operating System) financial layer.
 *
 *      Supports multiple vesting schedules per beneficiary:
 *        - Configurable cliff period (tokens locked until cliff ends)
 *        - Linear unlock after cliff (tokens vest continuously)
 *        - Optional revocability (owner can revoke unvested tokens)
 *        - Any ERC-20 token
 *
 *      Timeline:
 *        startTime ──── cliff ──── linear vesting ──── fully vested
 *        [locked]       [0%]       [0% → 100%]         [100%]
 *
 *      Use cases:
 *        - Team token vesting (4-year vest, 1-year cliff)
 *        - Contributor rewards (6-month vest, no cliff)
 *        - Advisor allocation (2-year vest, 6-month cliff)
 *        - AI agent vesting (VibeCode-linked, governance-revocable)
 *
 *      Cooperative capitalism:
 *        - Transparent: all schedules visible on-chain
 *        - Fair: beneficiaries can claim vested tokens anytime
 *        - Accountable: revocable schedules keep team aligned
 *        - Composable: works with any ERC-20 (JUL, VIBE, etc.)
 */
contract VestingSchedule is IVestingSchedule, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ State ============

    Schedule[] private _schedules;
    mapping(address => uint256[]) private _beneficiarySchedules;

    // ============ Constructor ============

    constructor() Ownable(msg.sender) {}

    // ============ Schedule Management ============

    function createSchedule(
        address beneficiary,
        address token,
        uint256 totalAmount,
        uint256 startTime,
        uint256 cliffDuration,
        uint256 vestingDuration,
        bool revocable
    ) external onlyOwner nonReentrant returns (uint256 scheduleId) {
        if (beneficiary == address(0)) revert ZeroAddress();
        if (token == address(0)) revert ZeroAddress();
        if (totalAmount == 0) revert ZeroAmount();
        if (vestingDuration == 0) revert ZeroDuration();
        if (cliffDuration > vestingDuration) revert CliffExceedsVesting();

        // Transfer tokens from creator
        uint256 balBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), totalAmount);
        uint256 received = IERC20(token).balanceOf(address(this)) - balBefore;
        if (received < totalAmount) revert InsufficientFunding(totalAmount, received);

        scheduleId = _schedules.length;
        _schedules.push(Schedule({
            beneficiary: beneficiary,
            token: token,
            totalAmount: totalAmount,
            claimed: 0,
            startTime: startTime,
            cliffDuration: cliffDuration,
            vestingDuration: vestingDuration,
            revocable: revocable,
            revoked: false
        }));

        _beneficiarySchedules[beneficiary].push(scheduleId);

        emit ScheduleCreated(
            scheduleId,
            beneficiary,
            token,
            totalAmount,
            startTime,
            cliffDuration,
            vestingDuration,
            revocable
        );
    }

    // ============ Claiming ============

    function claim(uint256 scheduleId) external nonReentrant {
        if (scheduleId >= _schedules.length) revert ScheduleNotFound();
        Schedule storage schedule = _schedules[scheduleId];

        if (msg.sender != schedule.beneficiary) revert NotBeneficiary();

        uint256 claimable = _claimableAmount(schedule);
        if (claimable == 0) revert NothingToClaim();

        schedule.claimed += claimable;
        IERC20(schedule.token).safeTransfer(schedule.beneficiary, claimable);

        emit TokensClaimed(scheduleId, schedule.beneficiary, claimable);
    }

    // ============ Revocation ============

    function revoke(uint256 scheduleId) external onlyOwner nonReentrant {
        if (scheduleId >= _schedules.length) revert ScheduleNotFound();
        Schedule storage schedule = _schedules[scheduleId];

        if (!schedule.revocable) revert NotRevocable();
        if (schedule.revoked) revert AlreadyRevoked();

        // Calculate unvested amount
        uint256 vested = _vestedAmount(schedule);
        uint256 unvested = schedule.totalAmount - vested;

        schedule.revoked = true;
        // Set totalAmount to vested so beneficiary can still claim what's vested
        schedule.totalAmount = vested;

        if (unvested > 0) {
            IERC20(schedule.token).safeTransfer(owner(), unvested);
        }

        emit ScheduleRevoked(scheduleId, unvested, owner());
    }

    // ============ Admin ============

    function emergencyRecover(address token, uint256 amount, address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
        emit EmergencyRecovered(token, amount, to);
    }

    // ============ Internal ============

    function _vestedAmount(Schedule storage schedule) internal view returns (uint256) {
        if (schedule.revoked) return schedule.totalAmount; // Already adjusted on revoke
        if (block.timestamp < schedule.startTime + schedule.cliffDuration) return 0;
        if (block.timestamp >= schedule.startTime + schedule.vestingDuration) return schedule.totalAmount;

        uint256 elapsed = block.timestamp - schedule.startTime;
        return (schedule.totalAmount * elapsed) / schedule.vestingDuration;
    }

    function _claimableAmount(Schedule storage schedule) internal view returns (uint256) {
        return _vestedAmount(schedule) - schedule.claimed;
    }

    // ============ Views ============

    function getSchedule(uint256 id) external view returns (Schedule memory) {
        return _schedules[id];
    }

    function scheduleCount() external view returns (uint256) {
        return _schedules.length;
    }

    function vestedAmount(uint256 scheduleId) external view returns (uint256) {
        if (scheduleId >= _schedules.length) return 0;
        return _vestedAmount(_schedules[scheduleId]);
    }

    function claimableAmount(uint256 scheduleId) external view returns (uint256) {
        if (scheduleId >= _schedules.length) return 0;
        return _claimableAmount(_schedules[scheduleId]);
    }

    function schedulesOf(address beneficiary) external view returns (uint256[] memory) {
        return _beneficiarySchedules[beneficiary];
    }
}
