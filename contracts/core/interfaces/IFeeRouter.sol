// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IFeeRouter
 * @notice Central protocol fee collector and distributor.
 *         Part of VSOS DeFi/DeFAI layer.
 */
interface IFeeRouter {
    // ============ Structs ============

    struct FeeConfig {
        uint16 treasuryBps;   // % to DAOTreasury
        uint16 insuranceBps;  // % to insurance pools
        uint16 revShareBps;   // % to JUL stakers (VibeRevShare)
        uint16 buybackBps;    // % for protocol buyback-and-burn
    }

    struct TokenAccounting {
        uint256 totalCollected;
        uint256 totalDistributed;
        uint256 pending;
    }

    // ============ Events ============

    event FeeCollected(address indexed source, address indexed token, uint256 amount);
    event FeeDistributed(
        address indexed token,
        uint256 toTreasury,
        uint256 toInsurance,
        uint256 toRevShare,
        uint256 toBuyback
    );
    event ConfigUpdated(uint16 treasuryBps, uint16 insuranceBps, uint16 revShareBps, uint16 buybackBps);
    event SourceAuthorized(address indexed source);
    event SourceRevoked(address indexed source);
    event TreasuryUpdated(address indexed newTreasury);
    event InsuranceUpdated(address indexed newInsurance);
    event RevShareUpdated(address indexed newRevShare);
    event BuybackTargetUpdated(address indexed newTarget);
    event BuybackExecuted(address indexed token, uint256 amount, address indexed target);
    event EmergencyRecovered(address indexed token, uint256 amount, address indexed to);

    // ============ Errors ============

    error ZeroAddress();
    error ZeroAmount();
    error UnauthorizedSource();
    error InvalidConfig();
    error NothingToDistribute();
    error TransferFailed();

    // ============ Views ============

    function config() external view returns (FeeConfig memory);
    function treasury() external view returns (address);
    function insurance() external view returns (address);
    function revShare() external view returns (address);
    function buybackTarget() external view returns (address);
    function pendingFees(address token) external view returns (uint256);
    function totalCollected(address token) external view returns (uint256);
    function totalDistributed(address token) external view returns (uint256);
    function isAuthorizedSource(address source) external view returns (bool);

    // ============ Actions ============

    function collectFee(address token, uint256 amount) external;
    function distribute(address token) external;
    function distributeMultiple(address[] calldata tokens) external;
    function updateConfig(FeeConfig calldata newConfig) external;
    function authorizeSource(address source) external;
    function revokeSource(address source) external;
    function setTreasury(address newTreasury) external;
    function setInsurance(address newInsurance) external;
    function setRevShare(address newRevShare) external;
    function setBuybackTarget(address newTarget) external;
    function emergencyRecover(address token, uint256 amount, address to) external;
}
