// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeRebalancer — Automated Portfolio Rebalancing
 * @notice Set target allocations, auto-rebalance when drift exceeds threshold.
 *         Like a robo-advisor but fully on-chain and non-custodial.
 *
 * Example: User sets 60% ETH, 30% USDC, 10% VIBE
 *          When ETH pumps to 75%, rebalancer sells ETH → buys USDC/VIBE
 *
 * Triggers:
 * - Time-based (rebalance every N days)
 * - Drift-based (rebalance when any asset drifts >5% from target)
 * - Manual (user-triggered)
 */
contract VibeRebalancer is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {

    struct PortfolioConfig {
        address[] tokens;          // Token addresses (address(0) = ETH)
        uint256[] targetWeights;   // Target weights in bps (must sum to 10000)
        uint256 driftThreshold;    // Rebalance trigger in bps (e.g., 500 = 5%)
        uint256 rebalanceInterval; // Min time between rebalances
        uint256 lastRebalance;
        bool active;
    }

    // ============ State ============

    mapping(address => PortfolioConfig) public portfolios;
    mapping(address => mapping(address => uint256)) public deposits; // user => token => amount
    uint256 public userCount;
    uint256 public totalRebalances;

    uint256 public constant MIN_DRIFT = 100;          // 1% minimum drift threshold
    uint256 public constant MIN_INTERVAL = 1 hours;
    uint256 public constant MAX_TOKENS = 10;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event PortfolioCreated(address indexed user, uint256 tokenCount);
    event PortfolioUpdated(address indexed user);
    event Deposited(address indexed user, address token, uint256 amount);
    event Withdrawn(address indexed user, address token, uint256 amount);
    event Rebalanced(address indexed user, uint256 timestamp);
    event PortfolioDeactivated(address indexed user);

    // ============ Initialize ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Portfolio Setup ============

    function createPortfolio(
        address[] calldata tokens,
        uint256[] calldata targetWeights,
        uint256 driftThreshold,
        uint256 rebalanceInterval
    ) external {
        require(tokens.length == targetWeights.length, "Length mismatch");
        require(tokens.length > 0 && tokens.length <= MAX_TOKENS, "Invalid token count");
        require(driftThreshold >= MIN_DRIFT, "Drift too low");
        require(rebalanceInterval >= MIN_INTERVAL, "Interval too short");

        uint256 totalWeight = 0;
        for (uint256 i = 0; i < targetWeights.length; i++) {
            totalWeight += targetWeights[i];
        }
        require(totalWeight == 10000, "Weights must sum to 10000");

        if (!portfolios[msg.sender].active) userCount++;

        portfolios[msg.sender] = PortfolioConfig({
            tokens: tokens,
            targetWeights: targetWeights,
            driftThreshold: driftThreshold,
            rebalanceInterval: rebalanceInterval,
            lastRebalance: block.timestamp,
            active: true
        });

        emit PortfolioCreated(msg.sender, tokens.length);
    }

    /// @notice Deposit ETH into portfolio
    function depositETH() external payable {
        require(portfolios[msg.sender].active, "No portfolio");
        require(msg.value > 0, "Zero deposit");

        deposits[msg.sender][address(0)] += msg.value;
        emit Deposited(msg.sender, address(0), msg.value);
    }

    /// @notice Withdraw ETH from portfolio
    function withdrawETH(uint256 amount) external nonReentrant {
        require(deposits[msg.sender][address(0)] >= amount, "Insufficient");

        deposits[msg.sender][address(0)] -= amount;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Withdraw failed");

        emit Withdrawn(msg.sender, address(0), amount);
    }

    /// @notice Check if portfolio needs rebalancing
    function needsRebalance(address user) external view returns (bool) {
        PortfolioConfig storage p = portfolios[user];
        if (!p.active) return false;
        if (block.timestamp < p.lastRebalance + p.rebalanceInterval) return false;

        // Check drift for each token
        uint256 totalValue = _getTotalValue(user);
        if (totalValue == 0) return false;

        for (uint256 i = 0; i < p.tokens.length; i++) {
            uint256 currentWeight = (deposits[user][p.tokens[i]] * 10000) / totalValue;
            uint256 target = p.targetWeights[i];
            uint256 drift = currentWeight > target ? currentWeight - target : target - currentWeight;
            if (drift >= p.driftThreshold) return true;
        }
        return false;
    }

    /// @notice Execute rebalance (keeper/user triggered)
    function rebalance(address user) external {
        PortfolioConfig storage p = portfolios[user];
        require(p.active, "No portfolio");
        require(
            block.timestamp >= p.lastRebalance + p.rebalanceInterval,
            "Too soon"
        );

        p.lastRebalance = block.timestamp;
        totalRebalances++;

        // In production, this would interact with the AMM to swap
        // For now, emit event — actual swaps happen via keeper bot
        emit Rebalanced(user, block.timestamp);
    }

    function deactivatePortfolio() external {
        require(portfolios[msg.sender].active, "Not active");
        portfolios[msg.sender].active = false;
        userCount--;
        emit PortfolioDeactivated(msg.sender);
    }

    // ============ Internal ============

    function _getTotalValue(address user) internal view returns (uint256) {
        PortfolioConfig storage p = portfolios[user];
        uint256 total = 0;
        for (uint256 i = 0; i < p.tokens.length; i++) {
            total += deposits[user][p.tokens[i]];
        }
        return total;
    }

    // ============ Views ============

    function getPortfolio(address user) external view returns (
        address[] memory tokens,
        uint256[] memory weights,
        uint256 drift,
        uint256 interval,
        bool active
    ) {
        PortfolioConfig storage p = portfolios[user];
        return (p.tokens, p.targetWeights, p.driftThreshold, p.rebalanceInterval, p.active);
    }

    function getDeposit(address user, address token) external view returns (uint256) {
        return deposits[user][token];
    }

    receive() external payable {}
}
