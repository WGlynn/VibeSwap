// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IHatchManager
 * @author Faraday1 & JARVIS -- vibeswap.org
 * @notice Interface for ABC hatch phase management with trust-gated contributions
 */
interface IHatchManager {
    // ============ Types ============

    enum HatchPhase { PENDING, OPEN, CLOSED, COMPLETED, CANCELLED }

    struct HatchConfig {
        uint256 minRaise;
        uint256 maxRaise;
        uint256 hatchPrice;
        uint16 thetaBps;
        uint256 vestingHalfLife;
        uint256 hatchDeadline;
    }

    struct HatcherInfo {
        uint256 contributed;
        uint256 tokensAllocated;
        uint256 tokensVested;
        bool isApproved;
    }

    // ============ Events ============

    event HatchStarted(uint256 minRaise, uint256 maxRaise, uint256 deadline);
    event HatcherApproved(address indexed hatcher);
    event HatcherRevoked(address indexed hatcher);
    event Contributed(address indexed hatcher, uint256 amount, uint256 tokensAllocated);
    event HatchCompleted(uint256 totalRaised, uint256 totalTokens, uint256 reservePool, uint256 fundingPool);
    event HatchCancelled(uint256 totalRaised);
    event TokensVested(address indexed hatcher, uint256 amount);
    event Refunded(address indexed hatcher, uint256 amount);
    event GovernanceScoreUpdated(address indexed hatcher, uint256 score);

    // ============ Core ============

    function startHatch() external;
    function contribute(uint256 amount) external;
    function completeHatch() external;
    function cancelHatch() external;
    function claimVestedTokens() external;
    function claimRefund() external;

    // ============ Admin ============

    function approveHatcher(address hatcher) external;
    function approveHatchers(address[] calldata _hatchers) external;
    function revokeHatcher(address hatcher) external;
    function updateGovernanceScore(address hatcher, uint256 score) external;

    // ============ Views ============

    function phase() external view returns (HatchPhase);
    function totalRaised() external view returns (uint256);
    function totalHatchTokens() external view returns (uint256);
    function vestedAmount(address hatcher) external view returns (uint256);
    function claimableTokens(address hatcher) external view returns (uint256);
    function getHatcher(address hatcher) external view returns (HatcherInfo memory);
    function hatcherCount() external view returns (uint256);
    function getHatchConfig() external view returns (HatchConfig memory);
    function expectedReturnRate() external view returns (uint256);
}
