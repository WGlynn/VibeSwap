// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IFeeRouter.sol";

/**
 * @title FeeRouter
 * @notice Collects swap fees and forwards 100% to LPs via ShapleyDistributor.
 * @dev Part of VSOS (VibeSwap Operating System) DeFi/DeFAI layer.
 *
 *      100% of swap fees go to the people who made the trade possible: LPs.
 *      Distribution is NOT pro-rata — it uses the 5 Shapley contribution factors
 *      (direct liquidity, enabling time, scarcity, stability, pioneer bonus)
 *      computed by ShapleyDistributor as FEE_DISTRIBUTION games.
 *
 *      The protocol takes no cut. No treasury split, no buyback, no redirect.
 *      Fee agnostic: fees stay in whatever token the trade generated them in.
 *
 *      "If you remove the LPs, the trade cannot happen. Their Shapley value
 *       is the highest. Pay them what they earned, in what they earned it."
 */
contract FeeRouter is IFeeRouter, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ State ============

    /// @notice ShapleyDistributor address — 100% of fees forwarded here for LP distribution
    address private _lpDistributor;

    mapping(address => bool) private _authorizedSources;
    mapping(address => TokenAccounting) private _accounting;
    address[] private _trackedTokens;
    mapping(address => bool) private _tokenTracked;

    // ============ Constructor ============

    constructor(
        address lpDistributor_
    ) Ownable(msg.sender) {
        if (lpDistributor_ == address(0)) revert ZeroAddress();
        _lpDistributor = lpDistributor_;
    }

    // ============ Fee Collection ============

    /// @notice Collect fees from authorized protocol sources (VibeAMM, etc.)
    /// @dev DISINTERMEDIATION: Grade B — authorized sources + owner can collect.
    ///      Source authorization is a security gate (prevents arbitrary fee injection).
    function collectFee(address token, uint256 amount) external nonReentrant {
        if (!_authorizedSources[msg.sender] && msg.sender != owner()) revert UnauthorizedSource();
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        _accounting[token].totalCollected += amount;
        _accounting[token].pending += amount;

        if (!_tokenTracked[token]) {
            _trackedTokens.push(token);
            _tokenTracked[token] = true;
        }

        emit FeeCollected(msg.sender, token, amount);
    }

    // ============ Distribution ============

    /// @notice Forward 100% of pending fees to ShapleyDistributor for LP distribution
    /// @dev DISINTERMEDIATION: Grade B — authorized sources + owner.
    ///      H-05 fix: permissionless distribute() was a MEV vector.
    function distribute(address token) public nonReentrant {
        require(_authorizedSources[msg.sender] || msg.sender == owner(), "Not authorized to distribute");
        uint256 pending = _accounting[token].pending;
        if (pending == 0) revert NothingToDistribute();

        _accounting[token].pending = 0;
        _accounting[token].totalDistributed += pending;

        // 100% to LPs via ShapleyDistributor. No split. No extraction.
        IERC20(token).safeTransfer(_lpDistributor, pending);

        emit FeeForwarded(token, pending, _lpDistributor);
    }

    function distributeMultiple(address[] calldata tokens) external {
        for (uint256 i; i < tokens.length; ++i) {
            if (_accounting[tokens[i]].pending > 0) {
                distribute(tokens[i]);
            }
        }
    }

    // ============ Configuration ============

    /// @notice Authorize a fee source contract
    /// @dev DISINTERMEDIATION: Grade C → Target Grade B (TimelockController).
    function authorizeSource(address source) external onlyOwner {
        if (source == address(0)) revert ZeroAddress();
        _authorizedSources[source] = true;
        emit SourceAuthorized(source);
    }

    /// @notice Revoke a fee source contract's authorization
    /// @dev DISINTERMEDIATION: Grade C → Target Grade B (TimelockController).
    function revokeSource(address source) external onlyOwner {
        _authorizedSources[source] = false;
        emit SourceRevoked(source);
    }

    /// @notice Set LP distributor (ShapleyDistributor) address
    /// @dev DISINTERMEDIATION: Grade C → Target Grade B (TimelockController).
    ///      After bootstrap, consider making this immutable (Grade A).
    function setLPDistributor(address newDistributor) external onlyOwner {
        if (newDistributor == address(0)) revert ZeroAddress();
        _lpDistributor = newDistributor;
        emit LPDistributorUpdated(newDistributor);
    }

    /// @notice Emergency recovery for stuck tokens
    /// @dev DISINTERMEDIATION: Grade C → Target Grade B (TimelockController).
    ///      Bootstrap necessity only — first function to dissolve to governance.
    function emergencyRecover(address token, uint256 amount, address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
        emit EmergencyRecovered(token, amount, to);
    }

    // ============ Views ============

    function lpDistributor() external view returns (address) { return _lpDistributor; }

    function pendingFees(address token) external view returns (uint256) {
        return _accounting[token].pending;
    }

    function totalCollected(address token) external view returns (uint256) {
        return _accounting[token].totalCollected;
    }

    function totalDistributed(address token) external view returns (uint256) {
        return _accounting[token].totalDistributed;
    }

    function isAuthorizedSource(address source) external view returns (bool) {
        return _authorizedSources[source];
    }
}
