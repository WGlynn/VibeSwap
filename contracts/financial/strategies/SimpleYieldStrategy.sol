// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IStrategyVault.sol";

/**
 * @title SimpleYieldStrategy
 * @notice Reference IStrategy implementation — holds assets with yield injection.
 * @dev Part of VSOS (VibeSwap Operating System) DeFi/DeFAI layer.
 *
 *      This is the simplest possible working strategy for StrategyVault:
 *        - Receives assets from vault via deposit()
 *        - Holds assets in the contract
 *        - Owner (or authorized keeper) can inject yield via injectYield()
 *        - harvest() reports and transfers injected yield to vault
 *
 *      Use cases:
 *        - Default "safe" strategy for new vaults
 *        - Manual yield from off-chain sources (OTC deals, airdrops)
 *        - Template for building more complex strategies
 *        - Testing strategy vault architecture
 *
 *      The yield injection model is intentionally simple:
 *        - Anyone can send the asset token to this contract
 *        - injectYield() records the surplus as harvestable profit
 *        - harvest() transfers profit to vault
 */
contract SimpleYieldStrategy is IStrategy, Ownable {
    using SafeERC20 for IERC20;

    // ============ State ============

    address private _asset;
    address private _vault;
    uint256 private _deployed;     // Assets deposited by vault
    uint256 private _pendingYield; // Yield waiting for harvest

    // ============ Events ============

    event YieldInjected(uint256 amount, address indexed from);
    event Deposited(uint256 amount);
    event Withdrawn(uint256 amount);
    event Harvested(uint256 profit);
    event EmergencyWithdrawn(uint256 recovered);

    // ============ Errors ============

    error OnlyVault();
    error ZeroAddress();
    error ZeroAmount();
    error InsufficientBalance();

    // ============ Constructor ============

    constructor(address asset_, address vault_) Ownable(msg.sender) {
        if (asset_ == address(0)) revert ZeroAddress();
        if (vault_ == address(0)) revert ZeroAddress();

        _asset = asset_;
        _vault = vault_;
    }

    // ============ Modifiers ============

    modifier onlyVault() {
        if (msg.sender != _vault) revert OnlyVault();
        _;
    }

    // ============ IStrategy Implementation ============

    function asset() external view override returns (address) {
        return _asset;
    }

    function vault() external view override returns (address) {
        return _vault;
    }

    function totalAssets() external view override returns (uint256) {
        return _deployed + _pendingYield;
    }

    function deposit(uint256 amount) external override onlyVault {
        // Vault already transferred tokens to us via safeTransfer
        _deployed += amount;
        emit Deposited(amount);
    }

    function withdraw(uint256 amount) external override onlyVault returns (uint256 actualWithdrawn) {
        if (amount > _deployed) {
            actualWithdrawn = _deployed;
        } else {
            actualWithdrawn = amount;
        }

        _deployed -= actualWithdrawn;
        IERC20(_asset).safeTransfer(_vault, actualWithdrawn);

        emit Withdrawn(actualWithdrawn);
    }

    function harvest() external override onlyVault returns (uint256 profit) {
        profit = _pendingYield;
        if (profit == 0) return 0;

        _pendingYield = 0;
        IERC20(_asset).safeTransfer(_vault, profit);

        emit Harvested(profit);
    }

    function emergencyWithdraw() external override onlyVault returns (uint256 recovered) {
        recovered = IERC20(_asset).balanceOf(address(this));
        _deployed = 0;
        _pendingYield = 0;

        if (recovered > 0) {
            IERC20(_asset).safeTransfer(_vault, recovered);
        }

        emit EmergencyWithdrawn(recovered);
    }

    // ============ Yield Injection ============

    /**
     * @notice Inject yield into the strategy.
     * @dev Call this after sending asset tokens to the strategy.
     *      The yield becomes harvestable by the vault.
     * @param amount The amount of yield to record
     */
    function injectYield(uint256 amount) external onlyOwner {
        if (amount == 0) revert ZeroAmount();

        // Verify we actually have the tokens
        uint256 balance = IERC20(_asset).balanceOf(address(this));
        if (balance < _deployed + _pendingYield + amount) revert InsufficientBalance();

        _pendingYield += amount;

        emit YieldInjected(amount, msg.sender);
    }

    // ============ Views ============

    function deployed() external view returns (uint256) { return _deployed; }
    function pendingYield() external view returns (uint256) { return _pendingYield; }
}
