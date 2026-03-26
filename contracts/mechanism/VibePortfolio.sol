// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title VibePortfolio — Automated Portfolio Management
 * @notice Index funds and automated rebalancing for DeFi portfolios.
 *         Users create portfolios with target allocations, keepers rebalance.
 *
 * @dev Architecture:
 *      - Custom portfolio creation with target weights
 *      - Threshold-based rebalancing (e.g., >5% drift triggers rebalance)
 *      - Social portfolios: follow and copy other users' allocations
 *      - Performance tracking and leaderboard
 */
contract VibePortfolio is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 public constant BPS = 10000;
    uint256 public constant MAX_ASSETS = 20;
    uint256 public constant DEFAULT_REBALANCE_THRESHOLD_BPS = 500; // 5%

    // ============ Types ============

    struct Portfolio {
        uint256 portfolioId;
        address owner;
        string name;
        address[] assets;
        uint256[] targetWeightsBps;      // Target allocation per asset
        uint256 rebalanceThresholdBps;
        uint256 totalValue;              // Estimated total value
        uint256 lastRebalanced;
        uint256 createdAt;
        bool isPublic;                   // Others can copy
        bool active;
    }

    struct PortfolioMetrics {
        uint256 totalDeposited;
        uint256 totalWithdrawn;
        uint256 rebalanceCount;
        uint256 followerCount;
    }

    // ============ State ============

    mapping(uint256 => Portfolio) public portfolios;
    uint256 public portfolioCount;

    /// @notice Portfolio metrics
    mapping(uint256 => PortfolioMetrics) public metrics;

    /// @notice User portfolio balances: portfolioId => asset => balance
    mapping(uint256 => mapping(address => uint256)) public portfolioBalances;

    /// @notice User's portfolios
    mapping(address => uint256[]) public userPortfolios;

    /// @notice Followers: portfolioId => follower[]
    mapping(uint256 => address[]) public followers;
    mapping(uint256 => mapping(address => bool)) public isFollowing;

    /// @notice Platform stats
    uint256 public totalValueLocked;
    uint256 public totalPortfolios;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event PortfolioCreated(uint256 indexed portfolioId, address indexed owner, string name);
    event Deposited(uint256 indexed portfolioId, address indexed asset, uint256 amount);
    event Withdrawn(uint256 indexed portfolioId, address indexed asset, uint256 amount);
    event Rebalanced(uint256 indexed portfolioId, uint256 timestamp);
    event PortfolioFollowed(uint256 indexed portfolioId, address indexed follower);
    event PortfolioUnfollowed(uint256 indexed portfolioId, address indexed follower);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Portfolio Management ============

    /**
     * @notice Create a new portfolio with target allocations
     */
    function createPortfolio(
        string calldata name,
        address[] calldata assets,
        uint256[] calldata targetWeightsBps,
        bool isPublic
    ) external returns (uint256) {
        require(assets.length > 0 && assets.length <= MAX_ASSETS, "Invalid asset count");
        require(assets.length == targetWeightsBps.length, "Length mismatch");

        uint256 totalWeight;
        for (uint256 i = 0; i < targetWeightsBps.length; i++) {
            totalWeight += targetWeightsBps[i];
        }
        require(totalWeight == BPS, "Weights must sum to 10000");

        portfolioCount++;
        Portfolio storage p = portfolios[portfolioCount];
        p.portfolioId = portfolioCount;
        p.owner = msg.sender;
        p.name = name;
        p.assets = assets;
        p.targetWeightsBps = targetWeightsBps;
        p.rebalanceThresholdBps = DEFAULT_REBALANCE_THRESHOLD_BPS;
        p.createdAt = block.timestamp;
        p.isPublic = isPublic;
        p.active = true;

        userPortfolios[msg.sender].push(portfolioCount);
        totalPortfolios++;

        emit PortfolioCreated(portfolioCount, msg.sender, name);
        return portfolioCount;
    }

    /**
     * @notice Deposit an asset into a portfolio
     */
    function depositToPortfolio(
        uint256 portfolioId,
        address asset,
        uint256 amount
    ) external nonReentrant {
        Portfolio storage p = portfolios[portfolioId];
        require(p.active, "Not active");
        require(p.owner == msg.sender, "Not owner");
        require(_isPortfolioAsset(p, asset), "Not a portfolio asset");

        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        portfolioBalances[portfolioId][asset] += amount;
        p.totalValue += amount; // Simplified — in production use oracle pricing
        totalValueLocked += amount;
        metrics[portfolioId].totalDeposited += amount;

        emit Deposited(portfolioId, asset, amount);
    }

    /**
     * @notice Withdraw an asset from a portfolio
     */
    function withdrawFromPortfolio(
        uint256 portfolioId,
        address asset,
        uint256 amount
    ) external nonReentrant {
        Portfolio storage p = portfolios[portfolioId];
        require(p.owner == msg.sender, "Not owner");
        require(portfolioBalances[portfolioId][asset] >= amount, "Insufficient balance");

        portfolioBalances[portfolioId][asset] -= amount;
        p.totalValue -= amount;
        totalValueLocked -= amount;
        metrics[portfolioId].totalWithdrawn += amount;

        IERC20(asset).safeTransfer(msg.sender, amount);

        emit Withdrawn(portfolioId, asset, amount);
    }

    // ============ Social ============

    function followPortfolio(uint256 portfolioId) external {
        Portfolio storage p = portfolios[portfolioId];
        require(p.isPublic, "Not public");
        require(!isFollowing[portfolioId][msg.sender], "Already following");

        isFollowing[portfolioId][msg.sender] = true;
        followers[portfolioId].push(msg.sender);
        metrics[portfolioId].followerCount++;

        emit PortfolioFollowed(portfolioId, msg.sender);
    }

    function unfollowPortfolio(uint256 portfolioId) external {
        require(isFollowing[portfolioId][msg.sender], "Not following");
        isFollowing[portfolioId][msg.sender] = false;
        metrics[portfolioId].followerCount--;

        emit PortfolioUnfollowed(portfolioId, msg.sender);
    }

    // ============ Rebalancing ============

    /**
     * @notice Mark a rebalance event (actual swap logic handled off-chain by keepers)
     */
    function recordRebalance(uint256 portfolioId) external {
        Portfolio storage p = portfolios[portfolioId];
        require(p.owner == msg.sender || msg.sender == owner(), "Not authorized");

        p.lastRebalanced = block.timestamp;
        metrics[portfolioId].rebalanceCount++;

        emit Rebalanced(portfolioId, block.timestamp);
    }

    /**
     * @notice Update portfolio target weights
     */
    function updateWeights(
        uint256 portfolioId,
        uint256[] calldata newWeightsBps
    ) external {
        Portfolio storage p = portfolios[portfolioId];
        require(p.owner == msg.sender, "Not owner");
        require(newWeightsBps.length == p.assets.length, "Length mismatch");

        uint256 total;
        for (uint256 i = 0; i < newWeightsBps.length; i++) {
            total += newWeightsBps[i];
        }
        require(total == BPS, "Must sum to 10000");

        p.targetWeightsBps = newWeightsBps;
    }

    // ============ Internal ============

    function _isPortfolioAsset(Portfolio storage p, address asset) internal view returns (bool) {
        for (uint256 i = 0; i < p.assets.length; i++) {
            if (p.assets[i] == asset) return true;
        }
        return false;
    }

    // ============ View ============

    function getPortfolioAssets(uint256 portfolioId) external view returns (
        address[] memory assets,
        uint256[] memory weights,
        uint256[] memory balances
    ) {
        Portfolio storage p = portfolios[portfolioId];
        assets = p.assets;
        weights = p.targetWeightsBps;
        balances = new uint256[](assets.length);
        for (uint256 i = 0; i < assets.length; i++) {
            balances[i] = portfolioBalances[portfolioId][assets[i]];
        }
    }

    function getUserPortfolios(address user) external view returns (uint256[] memory) {
        return userPortfolios[user];
    }

    function getFollowerCount(uint256 portfolioId) external view returns (uint256) {
        return metrics[portfolioId].followerCount;
    }

    function getPortfolioCount() external view returns (uint256) { return portfolioCount; }
}
