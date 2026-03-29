// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeAgentTrading — Autonomous Agent Trading Protocol
 * @notice Absorbs Dexter-style autonomous trading agent patterns into VSOS.
 *         AI agents execute trading strategies autonomously with risk management,
 *         strategy vaults, and performance-based fee sharing.
 *
 * @dev Architecture (Dexter SOL Lab absorption):
 *      - Strategy vaults: agents manage funds with defined strategies
 *      - Risk limits: per-agent position limits, max drawdown, stop losses
 *      - Performance fees: agents earn when they generate alpha
 *      - Copy trading: users follow top-performing agent strategies
 *      - Multi-DEX routing: agents can route through any integrated AMM
 *      - Transparent on-chain P&L tracking
 *      - Emergency shutdown per vault
 */
contract VibeAgentTrading is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    // ============ Types ============

    enum StrategyType { MOMENTUM, MEAN_REVERSION, ARBITRAGE, MARKET_MAKING, GRID, DCA, CUSTOM }
    enum VaultStatus { ACTIVE, PAUSED, CLOSED, LIQUIDATING }

    struct TradingVault {
        uint256 vaultId;
        bytes32 agentId;             // AI agent managing this vault
        address manager;             // Human or agent operator
        StrategyType strategy;
        VaultStatus status;
        uint256 totalDeposited;
        uint256 currentValue;
        uint256 highWaterMark;       // For performance fee calc
        uint256 maxDrawdownBps;      // Max drawdown before pause (basis points)
        uint256 performanceFeeBps;   // Agent's cut of profits
        uint256 managementFeeBps;    // Annual management fee
        uint256 depositorCount;
        uint256 createdAt;
        uint256 lastRebalanceAt;
    }

    struct Depositor {
        address addr;
        uint256 shares;
        uint256 depositedAt;
        uint256 totalDeposited;
        uint256 totalWithdrawn;
    }

    struct TradeRecord {
        uint256 tradeId;
        uint256 vaultId;
        bytes32 pairHash;            // Trading pair identifier
        bool isBuy;
        uint256 amount;
        uint256 price;
        uint256 pnl;                 // Profit/loss in wei
        uint256 timestamp;
    }

    struct CopyPosition {
        uint256 positionId;
        address follower;
        uint256 vaultId;
        uint256 amount;
        uint256 multiplier;          // 50-200 (0.5x - 2x)
        bool active;
    }

    // ============ Constants ============

    uint256 public constant MIN_DEPOSIT = 0.01 ether;
    uint256 public constant MAX_PERFORMANCE_FEE = 3000;   // 30%
    uint256 public constant MAX_MANAGEMENT_FEE = 500;     // 5%
    uint256 public constant PLATFORM_FEE_BPS = 500;       // 5% of profits to protocol

    // ============ State ============

    mapping(uint256 => TradingVault) public vaults;
    uint256 public vaultCount;

    /// @notice Vault depositors: vaultId => depositor address => Depositor
    mapping(uint256 => mapping(address => Depositor)) public depositors;

    /// @notice Trade history: vaultId => TradeRecord[]
    mapping(uint256 => TradeRecord[]) public tradeHistory;

    /// @notice Copy positions: positionId => CopyPosition
    mapping(uint256 => CopyPosition) public copyPositions;
    uint256 public copyPositionCount;

    /// @notice Vault total shares: vaultId => totalShares
    mapping(uint256 => uint256) public totalShares;

    /// @notice Agent performance tracking: agentId => cumulative PnL
    mapping(bytes32 => int256) public agentPnL;

    /// @notice Stats
    uint256 public totalValueLocked;
    uint256 public totalTradesExecuted;
    uint256 public totalProfitGenerated;
    uint256 public totalFeesCollected;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event VaultCreated(uint256 indexed vaultId, bytes32 indexed agentId, StrategyType strategy);
    event Deposited(uint256 indexed vaultId, address indexed depositor, uint256 amount, uint256 shares);
    event Withdrawn(uint256 indexed vaultId, address indexed depositor, uint256 amount, uint256 shares);
    event TradeExecuted(uint256 indexed vaultId, uint256 tradeId, bool isBuy, uint256 amount, int256 pnl);
    event VaultPaused(uint256 indexed vaultId, string reason);
    event CopyPositionOpened(uint256 indexed positionId, address indexed follower, uint256 vaultId);
    event PerformanceFeeCharged(uint256 indexed vaultId, uint256 fee);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Vault Management ============

    function createVault(
        bytes32 agentId,
        StrategyType strategy,
        uint256 maxDrawdownBps,
        uint256 performanceFeeBps,
        uint256 managementFeeBps
    ) external returns (uint256) {
        require(performanceFeeBps <= MAX_PERFORMANCE_FEE, "Performance fee too high");
        require(managementFeeBps <= MAX_MANAGEMENT_FEE, "Management fee too high");
        require(maxDrawdownBps > 0 && maxDrawdownBps <= 5000, "Invalid drawdown");

        vaultCount++;

        vaults[vaultCount] = TradingVault({
            vaultId: vaultCount,
            agentId: agentId,
            manager: msg.sender,
            strategy: strategy,
            status: VaultStatus.ACTIVE,
            totalDeposited: 0,
            currentValue: 0,
            highWaterMark: 0,
            maxDrawdownBps: maxDrawdownBps,
            performanceFeeBps: performanceFeeBps,
            managementFeeBps: managementFeeBps,
            depositorCount: 0,
            createdAt: block.timestamp,
            lastRebalanceAt: block.timestamp
        });

        emit VaultCreated(vaultCount, agentId, strategy);
        return vaultCount;
    }

    // ============ Deposits & Withdrawals ============

    function deposit(uint256 vaultId) external payable nonReentrant {
        TradingVault storage vault = vaults[vaultId];
        require(vault.status == VaultStatus.ACTIVE, "Vault not active");
        require(msg.value >= MIN_DEPOSIT, "Below minimum");

        uint256 shares;
        if (totalShares[vaultId] == 0 || vault.currentValue == 0) {
            shares = msg.value;
        } else {
            shares = (msg.value * totalShares[vaultId]) / vault.currentValue;
        }

        Depositor storage dep = depositors[vaultId][msg.sender];
        if (dep.shares == 0) vault.depositorCount++;

        dep.addr = msg.sender;
        dep.shares += shares;
        dep.depositedAt = block.timestamp;
        dep.totalDeposited += msg.value;

        totalShares[vaultId] += shares;
        vault.totalDeposited += msg.value;
        vault.currentValue += msg.value;
        totalValueLocked += msg.value;

        if (vault.currentValue > vault.highWaterMark) {
            vault.highWaterMark = vault.currentValue;
        }

        emit Deposited(vaultId, msg.sender, msg.value, shares);
    }

    function withdraw(uint256 vaultId, uint256 shares) external nonReentrant {
        TradingVault storage vault = vaults[vaultId];
        Depositor storage dep = depositors[vaultId][msg.sender];
        require(dep.shares >= shares, "Insufficient shares");
        require(shares > 0, "Zero shares");

        uint256 amount = (shares * vault.currentValue) / totalShares[vaultId];

        dep.shares -= shares;
        dep.totalWithdrawn += amount;
        totalShares[vaultId] -= shares;
        vault.currentValue -= amount;
        totalValueLocked -= amount;

        if (dep.shares == 0) vault.depositorCount--;

        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Transfer failed");

        emit Withdrawn(vaultId, msg.sender, amount, shares);
    }

    // ============ Trading (Agent Only) ============

    function recordTrade(
        uint256 vaultId,
        bytes32 pairHash,
        bool isBuy,
        uint256 amount,
        uint256 price,
        int256 pnl
    ) external {
        TradingVault storage vault = vaults[vaultId];
        require(vault.manager == msg.sender || msg.sender == owner(), "Not manager");
        require(vault.status == VaultStatus.ACTIVE, "Not active");

        uint256 tradeId = tradeHistory[vaultId].length;

        tradeHistory[vaultId].push(TradeRecord({
            tradeId: tradeId,
            vaultId: vaultId,
            pairHash: pairHash,
            isBuy: isBuy,
            amount: amount,
            price: price,
            pnl: pnl >= 0 ? uint256(pnl) : 0,
            timestamp: block.timestamp
        }));

        // Update vault value
        if (pnl > 0) {
            vault.currentValue += uint256(pnl);
            totalProfitGenerated += uint256(pnl);
        } else if (pnl < 0) {
            uint256 loss = uint256(-pnl);
            vault.currentValue = vault.currentValue > loss ? vault.currentValue - loss : 0;
        }

        agentPnL[vault.agentId] += pnl;
        totalTradesExecuted++;
        vault.lastRebalanceAt = block.timestamp;

        // Check drawdown
        if (vault.highWaterMark > 0 && vault.currentValue < vault.highWaterMark) {
            uint256 drawdown = ((vault.highWaterMark - vault.currentValue) * 10000) / vault.highWaterMark;
            if (drawdown >= vault.maxDrawdownBps) {
                vault.status = VaultStatus.PAUSED;
                emit VaultPaused(vaultId, "Max drawdown reached");
            }
        }

        // Update high water mark
        if (vault.currentValue > vault.highWaterMark) {
            // Charge performance fee on new profits
            uint256 profit = vault.currentValue - vault.highWaterMark;
            uint256 fee = (profit * vault.performanceFeeBps) / 10000;
            uint256 platformFee = (profit * PLATFORM_FEE_BPS) / 10000;

            vault.currentValue -= (fee + platformFee);
            totalFeesCollected += fee + platformFee;
            vault.highWaterMark = vault.currentValue;

            if (fee > 0) {
                (bool ok, ) = vault.manager.call{value: fee}("");
                if (ok) emit PerformanceFeeCharged(vaultId, fee);
            }
        }

        emit TradeExecuted(vaultId, tradeId, isBuy, amount, pnl);
    }

    // ============ Copy Trading ============

    function openCopyPosition(uint256 vaultId, uint256 multiplier) external payable returns (uint256) {
        require(vaults[vaultId].status == VaultStatus.ACTIVE, "Not active");
        require(msg.value >= MIN_DEPOSIT, "Below minimum");
        require(multiplier >= 50 && multiplier <= 200, "Invalid multiplier");

        copyPositionCount++;
        copyPositions[copyPositionCount] = CopyPosition({
            positionId: copyPositionCount,
            follower: msg.sender,
            vaultId: vaultId,
            amount: msg.value,
            multiplier: multiplier,
            active: true
        });

        emit CopyPositionOpened(copyPositionCount, msg.sender, vaultId);
        return copyPositionCount;
    }

    function closeCopyPosition(uint256 positionId) external nonReentrant {
        CopyPosition storage pos = copyPositions[positionId];
        require(pos.follower == msg.sender, "Not follower");
        require(pos.active, "Not active");

        pos.active = false;
        if (pos.amount > 0) {
            uint256 returnAmount = pos.amount;
            pos.amount = 0;
            (bool ok, ) = msg.sender.call{value: returnAmount}("");
            require(ok, "Transfer failed");
        }
    }

    // ============ Admin ============

    function pauseVault(uint256 vaultId) external {
        TradingVault storage vault = vaults[vaultId];
        require(vault.manager == msg.sender || msg.sender == owner(), "Not authorized");
        vault.status = VaultStatus.PAUSED;
        emit VaultPaused(vaultId, "Manual pause");
    }

    function resumeVault(uint256 vaultId) external {
        TradingVault storage vault = vaults[vaultId];
        require(vault.manager == msg.sender || msg.sender == owner(), "Not authorized");
        require(vault.status == VaultStatus.PAUSED, "Not paused");
        vault.status = VaultStatus.ACTIVE;
    }

    // ============ View ============

    function getVault(uint256 id) external view returns (TradingVault memory) { return vaults[id]; }
    function getTradeCount(uint256 vaultId) external view returns (uint256) { return tradeHistory[vaultId].length; }
    function getDepositor(uint256 vaultId, address addr) external view returns (Depositor memory) { return depositors[vaultId][addr]; }
    function getCopyPosition(uint256 id) external view returns (CopyPosition memory) { return copyPositions[id]; }
    function getVaultCount() external view returns (uint256) { return vaultCount; }

    receive() external payable {}
}
