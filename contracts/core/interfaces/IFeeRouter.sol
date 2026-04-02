// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IFeeRouter
 * @notice Collects swap fees and forwards 100% to LPs via ShapleyDistributor.
 *         Part of VSOS DeFi/DeFAI layer.
 *
 *         Design principle: LPs provide the capital that makes every trade
 *         possible. Their Shapley value in any swap is the highest — without
 *         their liquidity the trade cannot happen. 100% of the fees they
 *         generate go back to them, distributed by the 5 Shapley contribution
 *         factors (direct, enabling, scarcity, stability, pioneer).
 *
 *         The protocol takes nothing. No treasury cut, no buyback, no redirect.
 *         Fee agnostic: fees stay in whatever token the trade generated them in.
 */
interface IFeeRouter {
    // ============ Structs ============

    struct TokenAccounting {
        uint256 totalCollected;
        uint256 totalDistributed;
        uint256 pending;
    }

    // ============ Events ============

    event FeeCollected(address indexed source, address indexed token, uint256 amount);
    event FeeForwarded(address indexed token, uint256 amount, address indexed lpDistributor);
    event SourceAuthorized(address indexed source);
    event SourceRevoked(address indexed source);
    event LPDistributorUpdated(address indexed newDistributor);
    event EmergencyRecovered(address indexed token, uint256 amount, address indexed to);

    // ============ Errors ============

    error ZeroAddress();
    error ZeroAmount();
    error UnauthorizedSource();
    error NothingToDistribute();
    error TransferFailed();

    // ============ Views ============

    function lpDistributor() external view returns (address);
    function pendingFees(address token) external view returns (uint256);
    function totalCollected(address token) external view returns (uint256);
    function totalDistributed(address token) external view returns (uint256);
    function isAuthorizedSource(address source) external view returns (bool);

    // ============ Actions ============

    function collectFee(address token, uint256 amount) external;
    function distribute(address token) external;
    function distributeMultiple(address[] calldata tokens) external;
    function authorizeSource(address source) external;
    function revokeSource(address source) external;
    function setLPDistributor(address newDistributor) external;
    function emergencyRecover(address token, uint256 amount, address to) external;
}
