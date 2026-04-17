// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeYieldAggregator — Auto-Compounding Multi-Strategy Vault
 * @notice Yearn-style yield aggregator that automatically routes deposits
 *         to the highest-yielding strategy and compounds returns.
 *
 * Strategies:
 * 1. VibeSwap LP provision (earn swap fees)
 * 2. Lending market supply (earn interest)
 * 3. Staking (earn protocol rewards)
 * 4. Insurance pool provision (earn premiums)
 *
 * Key features:
 * - Auto-rebalance across strategies every epoch
 * - Gas-socialized compounding (one harvest benefits all depositors)
 * - Performance fee: 10% of yield (not principal)
 * - Management fee: 0% (cooperative capitalism)
 * - No lock period (withdraw anytime)
 */
contract VibeYieldAggregator is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {

    struct Strategy {
        string name;
        address target;              // Contract to interact with
        uint256 allocation;          // Basis points (e.g., 5000 = 50%)
        uint256 deployed;            // Amount currently deployed
        uint256 historicalYield;     // Cumulative yield earned
        bool active;
    }

    struct UserDeposit {
        uint256 shares;
        uint256 depositedAt;
        uint256 lastHarvest;
    }

    // ============ State ============

    Strategy[] public strategies;
    mapping(address => UserDeposit) public deposits;

    uint256 public totalShares;
    uint256 public totalAssets;
    uint256 public totalYieldEarned;

    uint256 public constant PERFORMANCE_FEE_BPS = 1000; // 10% of yield
    uint256 public constant EPOCH_DURATION = 1 days;
    uint256 public lastRebalance;
    uint256 public lastHarvest;

    address public treasury; // Performance fee recipient


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event Deposited(address indexed user, uint256 amount, uint256 shares);
    event Withdrawn(address indexed user, uint256 amount, uint256 shares);
    event Harvested(uint256 totalYield, uint256 performanceFee);
    event Rebalanced(uint256 timestamp);
    event StrategyAdded(uint256 indexed id, string name, address target);
    event StrategyUpdated(uint256 indexed id, uint256 newAllocation);

    // ============ Initialize ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _treasury) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        treasury = _treasury;
        lastRebalance = block.timestamp;
        lastHarvest = block.timestamp;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Deposits & Withdrawals ============

    /// @notice Deposit ETH into the yield aggregator
    function deposit() external payable nonReentrant {
        require(msg.value > 0, "Zero deposit");

        uint256 shares;
        if (totalShares == 0 || totalAssets == 0) {
            shares = msg.value;
        } else {
            shares = (msg.value * totalShares) / totalAssets;
        }

        deposits[msg.sender].shares += shares;
        deposits[msg.sender].depositedAt = block.timestamp;

        totalShares += shares;
        totalAssets += msg.value;

        emit Deposited(msg.sender, msg.value, shares);
    }

    /// @notice Withdraw from the vault
    function withdraw(uint256 shares) external nonReentrant {
        require(shares > 0, "Zero shares");
        require(deposits[msg.sender].shares >= shares, "Insufficient shares");

        uint256 amount = (shares * totalAssets) / totalShares;

        deposits[msg.sender].shares -= shares;
        totalShares -= shares;
        totalAssets -= amount;

        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Withdraw failed");

        emit Withdrawn(msg.sender, amount, shares);
    }

    // ============ Strategy Management ============

    function addStrategy(string calldata name, address target, uint256 allocation) external onlyOwner {
        strategies.push(Strategy({
            name: name,
            target: target,
            allocation: allocation,
            deployed: 0,
            historicalYield: 0,
            active: true
        }));
        emit StrategyAdded(strategies.length - 1, name, target);
    }

    function updateAllocation(uint256 strategyId, uint256 newAllocation) external onlyOwner {
        require(strategyId < strategies.length, "Invalid strategy");
        strategies[strategyId].allocation = newAllocation;
        emit StrategyUpdated(strategyId, newAllocation);
    }

    function deactivateStrategy(uint256 strategyId) external onlyOwner {
        require(strategyId < strategies.length, "Invalid strategy");
        strategies[strategyId].active = false;
        strategies[strategyId].allocation = 0;
    }

    // ============ Yield Operations ============

    /// @notice Harvest yield from all strategies (anyone can call)
    function harvest() external nonReentrant {
        require(block.timestamp >= lastHarvest + 1 hours, "Too soon");

        uint256 totalYield = 0;

        // In production, this would call each strategy's harvest function
        // and collect yield. For now, yield comes from protocol revenue
        // deposited directly into this contract.
        uint256 currentBalance = address(this).balance;
        if (currentBalance > totalAssets) {
            totalYield = currentBalance - totalAssets;
        }

        if (totalYield > 0) {
            uint256 performanceFee = (totalYield * PERFORMANCE_FEE_BPS) / 10000;
            uint256 netYield = totalYield - performanceFee;

            totalAssets += netYield;
            totalYieldEarned += netYield;

            if (performanceFee > 0 && treasury != address(0)) {
                (bool ok, ) = treasury.call{value: performanceFee}("");
                if (!ok) {
                    // If treasury transfer fails, add to pool
                    totalAssets += performanceFee;
                }
            }

            emit Harvested(totalYield, performanceFee);
        }

        lastHarvest = block.timestamp;
    }

    /// @notice Rebalance across strategies (owner or keeper)
    function rebalance() external {
        require(
            msg.sender == owner() || block.timestamp >= lastRebalance + EPOCH_DURATION,
            "Not authorized or too soon"
        );
        // In production: withdraw from overweight strategies,
        // deploy to underweight strategies based on allocation targets.
        lastRebalance = block.timestamp;
        emit Rebalanced(block.timestamp);
    }

    // ============ Views ============

    function pricePerShare() public view returns (uint256) {
        if (totalShares == 0) return 1 ether;
        return (totalAssets * 1 ether) / totalShares;
    }

    function balanceOf(address user) external view returns (uint256) {
        return (deposits[user].shares * totalAssets) / (totalShares > 0 ? totalShares : 1);
    }

    function sharesOf(address user) external view returns (uint256) {
        return deposits[user].shares;
    }

    function getAPY() external view returns (uint256) {
        // Simple APY calculation based on historical yield
        if (totalAssets == 0 || totalYieldEarned == 0) return 0;
        uint256 duration = block.timestamp - lastRebalance;
        if (duration == 0) return 0;
        // Annualized: (yield / assets) * (365 days / duration) * 10000 for bps
        return (totalYieldEarned * 365 days * 10000) / (totalAssets * duration);
    }

    function getStrategyCount() external view returns (uint256) {
        return strategies.length;
    }

    receive() external payable {}
}
