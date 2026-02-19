// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IVestingSchedule
 * @notice Token vesting with cliff + linear unlock for team/contributors.
 *         Part of VSOS (VibeSwap Operating System) financial layer.
 */
interface IVestingSchedule {
    // ============ Structs ============

    struct Schedule {
        address beneficiary;
        address token;
        uint256 totalAmount;
        uint256 claimed;
        uint256 startTime;
        uint256 cliffDuration;
        uint256 vestingDuration;
        bool revocable;
        bool revoked;
    }

    // ============ Events ============

    event ScheduleCreated(
        uint256 indexed scheduleId,
        address indexed beneficiary,
        address indexed token,
        uint256 totalAmount,
        uint256 startTime,
        uint256 cliffDuration,
        uint256 vestingDuration,
        bool revocable
    );
    event TokensClaimed(uint256 indexed scheduleId, address indexed beneficiary, uint256 amount);
    event ScheduleRevoked(uint256 indexed scheduleId, uint256 unvested, address indexed returnTo);
    event EmergencyRecovered(address indexed token, uint256 amount, address indexed to);

    // ============ Errors ============

    error ZeroAddress();
    error ZeroAmount();
    error ZeroDuration();
    error CliffExceedsVesting();
    error NotBeneficiary();
    error NothingToClaim();
    error NotRevocable();
    error AlreadyRevoked();
    error ScheduleNotFound();
    error InsufficientFunding(uint256 required, uint256 available);

    // ============ Views ============

    function getSchedule(uint256 id) external view returns (Schedule memory);
    function scheduleCount() external view returns (uint256);
    function vestedAmount(uint256 scheduleId) external view returns (uint256);
    function claimableAmount(uint256 scheduleId) external view returns (uint256);
    function schedulesOf(address beneficiary) external view returns (uint256[] memory);

    // ============ Actions ============

    function createSchedule(
        address beneficiary,
        address token,
        uint256 totalAmount,
        uint256 startTime,
        uint256 cliffDuration,
        uint256 vestingDuration,
        bool revocable
    ) external returns (uint256 scheduleId);

    function claim(uint256 scheduleId) external;
    function revoke(uint256 scheduleId) external;
    function emergencyRecover(address token, uint256 amount, address to) external;
}
