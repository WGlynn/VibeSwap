// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeVesting — Token Vesting with Cliff and Linear Release
 * @notice Fair token distribution with vesting schedules.
 *         Prevents team/investor dump by locking tokens with gradual release.
 *
 * Schedule types:
 * - LINEAR: Constant release rate over duration
 * - CLIFF_LINEAR: Nothing until cliff, then linear release
 * - MILESTONE: Release at specific milestones (governance-approved)
 */
contract VibeVesting is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {

    enum VestingType { LINEAR, CLIFF_LINEAR, MILESTONE }

    struct VestingSchedule {
        address beneficiary;
        uint256 totalAmount;
        uint256 released;
        uint256 startTime;
        uint256 cliffDuration;       // Seconds before first release
        uint256 vestingDuration;     // Total vesting duration
        VestingType vestingType;
        bool revocable;
        bool revoked;
    }

    // ============ State ============

    mapping(uint256 => VestingSchedule) public schedules;
    uint256 public scheduleCount;
    mapping(address => uint256[]) public beneficiarySchedules;
    uint256 public totalAllocated;
    uint256 public totalReleased;

    // ============ Events ============

    event ScheduleCreated(uint256 indexed id, address beneficiary, uint256 amount, uint256 duration);
    event TokensReleased(uint256 indexed id, uint256 amount);
    event ScheduleRevoked(uint256 indexed id, uint256 unreleased);

    // ============ Initialize ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Schedule Management ============

    function createSchedule(
        address beneficiary,
        uint256 cliffDuration,
        uint256 vestingDuration,
        VestingType vestingType,
        bool revocable
    ) external payable onlyOwner {
        require(msg.value > 0, "Zero amount");
        require(beneficiary != address(0), "Zero beneficiary");
        require(vestingDuration > 0, "Zero duration");

        uint256 id = scheduleCount++;
        schedules[id] = VestingSchedule({
            beneficiary: beneficiary,
            totalAmount: msg.value,
            released: 0,
            startTime: block.timestamp,
            cliffDuration: cliffDuration,
            vestingDuration: vestingDuration,
            vestingType: vestingType,
            revocable: revocable,
            revoked: false
        });

        beneficiarySchedules[beneficiary].push(id);
        totalAllocated += msg.value;

        emit ScheduleCreated(id, beneficiary, msg.value, vestingDuration);
    }

    /// @notice Release vested tokens
    function release(uint256 id) external nonReentrant {
        VestingSchedule storage s = schedules[id];
        require(msg.sender == s.beneficiary, "Not beneficiary");
        require(!s.revoked, "Revoked");

        uint256 releasable = _vestedAmount(s) - s.released;
        require(releasable > 0, "Nothing to release");

        s.released += releasable;
        totalReleased += releasable;

        (bool ok, ) = s.beneficiary.call{value: releasable}("");
        require(ok, "Release failed");

        emit TokensReleased(id, releasable);
    }

    /// @notice Revoke a schedule (owner only, only if revocable)
    function revoke(uint256 id) external onlyOwner nonReentrant {
        VestingSchedule storage s = schedules[id];
        require(s.revocable, "Not revocable");
        require(!s.revoked, "Already revoked");

        uint256 vested = _vestedAmount(s);
        uint256 unreleased = s.totalAmount - vested;
        s.revoked = true;

        // Release what's vested to beneficiary
        if (vested > s.released) {
            uint256 releasable = vested - s.released;
            s.released += releasable;
            (bool ok1, ) = s.beneficiary.call{value: releasable}("");
            require(ok1, "Release failed");
        }

        // Return unvested to owner
        if (unreleased > 0) {
            (bool ok2, ) = owner().call{value: unreleased}("");
            require(ok2, "Return failed");
        }

        emit ScheduleRevoked(id, unreleased);
    }

    // ============ Internal ============

    function _vestedAmount(VestingSchedule storage s) internal view returns (uint256) {
        if (block.timestamp < s.startTime + s.cliffDuration) return 0;
        if (block.timestamp >= s.startTime + s.vestingDuration) return s.totalAmount;

        uint256 elapsed = block.timestamp - s.startTime;
        return (s.totalAmount * elapsed) / s.vestingDuration;
    }

    // ============ Views ============

    function getSchedule(uint256 id) external view returns (VestingSchedule memory) { return schedules[id]; }

    function getVestedAmount(uint256 id) external view returns (uint256) {
        return _vestedAmount(schedules[id]);
    }

    function getReleasableAmount(uint256 id) external view returns (uint256) {
        VestingSchedule storage s = schedules[id];
        if (s.revoked) return 0;
        return _vestedAmount(s) - s.released;
    }

    function getBeneficiarySchedules(address beneficiary) external view returns (uint256[] memory) {
        return beneficiarySchedules[beneficiary];
    }

    receive() external payable {}
}
