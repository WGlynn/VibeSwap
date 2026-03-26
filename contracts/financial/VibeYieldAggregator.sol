// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../incentives/interfaces/IShapleyDistributor.sol";
import "./interfaces/IStrategyVault.sol";

/**
 * @title VibeYieldAggregator
 * @notice Yearn-style yield aggregator for the VSOS DeFi operating system.
 *         Multi-strategy vaults that auto-compound yield across VSOS protocols.
 * @dev Part of VSOS (VibeSwap Operating System) Financial Primitives.
 *
 *      Architecture:
 *        - Each vault wraps a single ERC-20 asset
 *        - Multiple strategies per vault, ranked by expected APY
 *        - Harvester compounds profits and rotates capital to best strategy
 *        - ERC-4626-compatible share accounting (deposit/withdraw/mint/redeem)
 *        - Performance fees split via Shapley distribution
 *
 *      Cooperative capitalism mechanics:
 *        - Performance fees fund the cooperative (Shapley-distributed)
 *        - Harvesters earn keeper tips (incentivized maintenance)
 *        - Emergency withdrawal always available (no lock-ups)
 *        - Strategy migration with timelock (community can react)
 *        - Transparent on-chain accounting
 *
 *      UUPS upgradeable for protocol evolution.
 */
contract VibeYieldAggregator is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 private constant BPS = 10_000;
    uint256 private constant MAX_PERFORMANCE_FEE = 3000;    // 30%
    uint256 private constant MAX_MANAGEMENT_FEE = 500;      // 5%
    uint256 private constant MAX_STRATEGIES_PER_VAULT = 20;
    uint256 private constant MIGRATION_TIMELOCK = 2 days;
    uint256 private constant MAX_VAULTS = 100;

    // ============ Structs ============

    struct VaultConfig {
        address asset;                  // Underlying ERC-20 token
        string name;                    // Vault display name
        uint256 totalShares;            // Total shares outstanding
        uint256 totalDeposited;         // Total assets tracked (excluding strategy gains)
        uint256 depositCap;             // Max total deposits (0 = unlimited)
        uint256 performanceFeeBps;      // Fee on profits
        uint256 managementFeeBps;       // Annual fee on AUM
        uint256 lastHarvestTime;        // Timestamp of last harvest
        uint256 accumulatedFees;        // Fees awaiting distribution
        bool emergencyShutdown;         // Pause deposits, allow withdrawals
        bool exists;                    // Vault exists flag
    }

    struct StrategySlot {
        address strategy;               // IStrategy implementation
        uint256 debtRatio;              // BPS of vault capital allocated (max 10000 total)
        uint256 totalDebt;              // Assets currently deployed
        uint256 totalGain;              // Lifetime gains reported
        uint256 totalLoss;              // Lifetime losses reported
        uint256 lastReport;             // Last harvest timestamp
        bool active;                    // Can receive new capital
    }

    struct PendingMigration {
        uint256 vaultId;
        uint256 strategyIndex;
        address newStrategy;
        uint256 executeAfter;
    }

    // ============ State ============

    uint256 private _vaultCount;
    mapping(uint256 => VaultConfig) private _vaults;
    mapping(uint256 => mapping(address => uint256)) private _shares;          // vaultId => user => shares
    mapping(uint256 => StrategySlot[]) private _strategies;                   // vaultId => strategy slots
    mapping(uint256 => mapping(address => uint256)) private _strategyIndex;   // vaultId => strategy => index+1

    uint256 private _migrationNonce;
    mapping(uint256 => PendingMigration) private _pendingMigrations;

    IShapleyDistributor public shapleyDistributor;
    address public keeper;              // Authorized harvester
    uint256 public keeperTip;           // Tip per harvest (in asset tokens)


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event VaultCreated(uint256 indexed vaultId, address indexed asset, string name);
    event Deposited(uint256 indexed vaultId, address indexed user, uint256 assets, uint256 shares);
    event Withdrawn(uint256 indexed vaultId, address indexed user, uint256 assets, uint256 shares);
    event EmergencyWithdrawn(uint256 indexed vaultId, address indexed user, uint256 assets);
    event StrategyAdded(uint256 indexed vaultId, address indexed strategy, uint256 debtRatio);
    event StrategyRevoked(uint256 indexed vaultId, address indexed strategy);
    event StrategyDebtRatioUpdated(uint256 indexed vaultId, address indexed strategy, uint256 newRatio);
    event Harvested(uint256 indexed vaultId, address indexed strategy, uint256 profit, uint256 loss, uint256 fee);
    event MigrationQueued(uint256 indexed migrationId, uint256 vaultId, address oldStrategy, address newStrategy);
    event MigrationExecuted(uint256 indexed migrationId);
    event MigrationCancelled(uint256 indexed migrationId);
    event EmergencyShutdownToggled(uint256 indexed vaultId, bool active);
    event FeesDistributed(uint256 indexed vaultId, uint256 amount);
    event KeeperUpdated(address indexed newKeeper);
    event KeeperTipUpdated(uint256 newTip);

    // ============ Errors ============

    error VaultNotFound();
    error VaultShutdown();
    error VaultNotShutdown();
    error ZeroAddress();
    error ZeroAmount();
    error ZeroShares();
    error DepositCapExceeded();
    error TooManyStrategies();
    error TooManyVaults();
    error StrategyAlreadyAdded();
    error StrategyNotFound();
    error StrategyNotActive();
    error DebtRatioExceeded();
    error StrategyAssetMismatch();
    error InsufficientShares();
    error MigrationNotFound();
    error MigrationTimelockActive();
    error ExcessiveFee();
    error NotKeeperOrOwner();
    error NothingToHarvest();

    // ============ Modifiers ============

    modifier vaultExists(uint256 vaultId) {
        if (!_vaults[vaultId].exists) revert VaultNotFound();
        _;
    }

    modifier notShutdown(uint256 vaultId) {
        if (_vaults[vaultId].emergencyShutdown) revert VaultShutdown();
        _;
    }

    modifier onlyKeeperOrOwner() {
        if (msg.sender != keeper && msg.sender != owner()) revert NotKeeperOrOwner();
        _;
    }

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _shapleyDistributor, address _keeper) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        if (_keeper == address(0)) revert ZeroAddress();
        shapleyDistributor = IShapleyDistributor(_shapleyDistributor);
        keeper = _keeper;
        keeperTip = 0.001 ether;
    }

    // ============ Vault Management ============

    /**
     * @notice Create a new yield vault for an asset.
     * @param asset_ The ERC-20 token this vault accepts
     * @param name_ Human-readable vault name
     * @param depositCap_ Max total deposits (0 = unlimited)
     * @param performanceFeeBps_ Fee on profits in BPS
     * @param managementFeeBps_ Annual fee on AUM in BPS
     */
    function createVault(
        address asset_,
        string calldata name_,
        uint256 depositCap_,
        uint256 performanceFeeBps_,
        uint256 managementFeeBps_
    ) external onlyOwner returns (uint256 vaultId) {
        if (asset_ == address(0)) revert ZeroAddress();
        if (performanceFeeBps_ > MAX_PERFORMANCE_FEE) revert ExcessiveFee();
        if (managementFeeBps_ > MAX_MANAGEMENT_FEE) revert ExcessiveFee();
        if (_vaultCount >= MAX_VAULTS) revert TooManyVaults();

        vaultId = _vaultCount++;

        VaultConfig storage v = _vaults[vaultId];
        v.asset = asset_;
        v.name = name_;
        v.depositCap = depositCap_;
        v.performanceFeeBps = performanceFeeBps_;
        v.managementFeeBps = managementFeeBps_;
        v.lastHarvestTime = block.timestamp;
        v.exists = true;

        emit VaultCreated(vaultId, asset_, name_);
    }

    // ============ Deposit / Withdraw (ERC-4626 Compatible) ============

    /**
     * @notice Deposit assets into a vault and receive shares.
     * @param vaultId The vault to deposit into
     * @param assets Amount of underlying tokens to deposit
     * @return shares Shares minted to the depositor
     */
    function deposit(uint256 vaultId, uint256 assets)
        external
        nonReentrant
        vaultExists(vaultId)
        notShutdown(vaultId)
        returns (uint256 shares)
    {
        if (assets == 0) revert ZeroAmount();

        VaultConfig storage v = _vaults[vaultId];
        uint256 totalAssets_ = _totalVaultAssets(vaultId);

        if (v.depositCap > 0 && totalAssets_ + assets > v.depositCap) {
            revert DepositCapExceeded();
        }

        // Calculate shares: first depositor gets 1:1, then proportional
        if (v.totalShares == 0) {
            shares = assets;
        } else {
            shares = (assets * v.totalShares) / totalAssets_;
        }
        if (shares == 0) revert ZeroShares();

        v.totalShares += shares;
        v.totalDeposited += assets;
        _shares[vaultId][msg.sender] += shares;

        IERC20(v.asset).safeTransferFrom(msg.sender, address(this), assets);

        emit Deposited(vaultId, msg.sender, assets, shares);
    }

    /**
     * @notice Withdraw assets by burning shares.
     * @param vaultId The vault to withdraw from
     * @param shares Number of shares to burn
     * @return assets Amount of underlying tokens returned
     */
    function withdraw(uint256 vaultId, uint256 shares)
        external
        nonReentrant
        vaultExists(vaultId)
        returns (uint256 assets)
    {
        if (shares == 0) revert ZeroAmount();
        if (_shares[vaultId][msg.sender] < shares) revert InsufficientShares();

        VaultConfig storage v = _vaults[vaultId];
        uint256 totalAssets_ = _totalVaultAssets(vaultId);

        assets = (shares * totalAssets_) / v.totalShares;

        v.totalShares -= shares;
        _shares[vaultId][msg.sender] -= shares;

        // Pull from idle balance first, then strategies
        uint256 idle = IERC20(v.asset).balanceOf(address(this));
        // Note: idle includes all vault assets held here; for multi-vault we track totalDeposited
        if (assets > idle) {
            _pullFromStrategies(vaultId, assets - idle);
        }

        // Update tracked deposits (proportional reduction)
        uint256 depositReduction = shares * v.totalDeposited / (v.totalShares + shares);
        if (depositReduction > v.totalDeposited) {
            v.totalDeposited = 0;
        } else {
            v.totalDeposited -= depositReduction;
        }

        IERC20(v.asset).safeTransfer(msg.sender, assets);

        emit Withdrawn(vaultId, msg.sender, assets, shares);
    }

    /**
     * @notice Emergency withdraw — no fees, just get out.
     *         Burns all user shares and returns proportional assets.
     * @param vaultId The vault to exit
     */
    function emergencyWithdraw(uint256 vaultId)
        external
        nonReentrant
        vaultExists(vaultId)
    {
        uint256 userShares = _shares[vaultId][msg.sender];
        if (userShares == 0) revert ZeroAmount();

        VaultConfig storage v = _vaults[vaultId];
        uint256 totalAssets_ = _totalVaultAssets(vaultId);
        uint256 assets = (userShares * totalAssets_) / v.totalShares;

        v.totalShares -= userShares;
        _shares[vaultId][msg.sender] = 0;

        if (v.totalDeposited > assets) {
            v.totalDeposited -= assets;
        } else {
            v.totalDeposited = 0;
        }

        // Pull everything needed from strategies
        uint256 idle = IERC20(v.asset).balanceOf(address(this));
        if (assets > idle) {
            _pullFromStrategies(vaultId, assets - idle);
        }

        // Transfer whatever we actually have (may be less if strategies have losses)
        uint256 available = IERC20(v.asset).balanceOf(address(this));
        uint256 toSend = assets < available ? assets : available;

        IERC20(v.asset).safeTransfer(msg.sender, toSend);

        emit EmergencyWithdrawn(vaultId, msg.sender, toSend);
    }

    // ============ Strategy Management ============

    /**
     * @notice Add a strategy to a vault.
     * @param vaultId The vault
     * @param strategy Address of IStrategy implementation
     * @param debtRatio BPS of vault capital to allocate (total across all must <= 10000)
     */
    function addStrategy(uint256 vaultId, address strategy, uint256 debtRatio)
        external
        onlyOwner
        vaultExists(vaultId)
    {
        if (strategy == address(0)) revert ZeroAddress();
        if (_strategyIndex[vaultId][strategy] != 0) revert StrategyAlreadyAdded();
        if (_strategies[vaultId].length >= MAX_STRATEGIES_PER_VAULT) revert TooManyStrategies();
        if (IStrategy(strategy).asset() != _vaults[vaultId].asset) revert StrategyAssetMismatch();

        uint256 totalRatio = _totalDebtRatio(vaultId) + debtRatio;
        if (totalRatio > BPS) revert DebtRatioExceeded();

        _strategies[vaultId].push(StrategySlot({
            strategy: strategy,
            debtRatio: debtRatio,
            totalDebt: 0,
            totalGain: 0,
            totalLoss: 0,
            lastReport: block.timestamp,
            active: true
        }));

        _strategyIndex[vaultId][strategy] = _strategies[vaultId].length; // 1-indexed

        emit StrategyAdded(vaultId, strategy, debtRatio);
    }

    /**
     * @notice Revoke a strategy — set debt ratio to 0, preventing new capital flow.
     *         Existing capital is withdrawn on next harvest.
     */
    function revokeStrategy(uint256 vaultId, address strategy)
        external
        onlyOwner
        vaultExists(vaultId)
    {
        uint256 idx = _getStrategyIndex(vaultId, strategy);
        _strategies[vaultId][idx].active = false;
        _strategies[vaultId][idx].debtRatio = 0;

        emit StrategyRevoked(vaultId, strategy);
    }

    /**
     * @notice Update debt ratio for a strategy.
     */
    function updateDebtRatio(uint256 vaultId, address strategy, uint256 newRatio)
        external
        onlyOwner
        vaultExists(vaultId)
    {
        uint256 idx = _getStrategyIndex(vaultId, strategy);
        if (!_strategies[vaultId][idx].active) revert StrategyNotActive();

        uint256 oldRatio = _strategies[vaultId][idx].debtRatio;
        uint256 totalRatio = _totalDebtRatio(vaultId) - oldRatio + newRatio;
        if (totalRatio > BPS) revert DebtRatioExceeded();

        _strategies[vaultId][idx].debtRatio = newRatio;

        emit StrategyDebtRatioUpdated(vaultId, strategy, newRatio);
    }

    // ============ Harvest & Compounding ============

    /**
     * @notice Harvest a specific strategy — collect profits, pay fees, rebalance.
     * @param vaultId The vault
     * @param strategy The strategy to harvest
     * @return profit Net profit after fees
     */
    function harvest(uint256 vaultId, address strategy)
        external
        nonReentrant
        onlyKeeperOrOwner
        vaultExists(vaultId)
        returns (uint256 profit)
    {
        uint256 idx = _getStrategyIndex(vaultId, strategy);
        StrategySlot storage slot = _strategies[vaultId][idx];
        VaultConfig storage v = _vaults[vaultId];

        // Harvest profit from strategy
        uint256 rawProfit = IStrategy(strategy).harvest();

        if (rawProfit > 0) {
            // Performance fee
            uint256 perfFee = (rawProfit * v.performanceFeeBps) / BPS;

            // Management fee (pro-rated since last harvest)
            uint256 elapsed = block.timestamp - slot.lastReport;
            uint256 mgmtFee = (slot.totalDebt * v.managementFeeBps * elapsed) / (BPS * 365.25 days);

            uint256 totalFee = perfFee + mgmtFee;
            if (totalFee > rawProfit) totalFee = rawProfit;

            v.accumulatedFees += totalFee;
            profit = rawProfit - totalFee;

            slot.totalGain += rawProfit;

            emit Harvested(vaultId, strategy, rawProfit, 0, totalFee);
        }

        slot.lastReport = block.timestamp;
        v.lastHarvestTime = block.timestamp;

        // Rebalance: push or pull capital to match debt ratio
        _rebalanceStrategy(vaultId, idx);

        return profit;
    }

    /**
     * @notice Harvest all strategies in a vault.
     * @param vaultId The vault to harvest
     */
    function harvestAll(uint256 vaultId)
        external
        nonReentrant
        onlyKeeperOrOwner
        vaultExists(vaultId)
    {
        StrategySlot[] storage slots = _strategies[vaultId];
        VaultConfig storage v = _vaults[vaultId];

        for (uint256 i = 0; i < slots.length; i++) {
            if (!slots[i].active && slots[i].totalDebt == 0) continue;

            StrategySlot storage slot = slots[i];
            uint256 rawProfit = IStrategy(slot.strategy).harvest();

            if (rawProfit > 0) {
                uint256 perfFee = (rawProfit * v.performanceFeeBps) / BPS;
                uint256 elapsed = block.timestamp - slot.lastReport;
                uint256 mgmtFee = (slot.totalDebt * v.managementFeeBps * elapsed) / (BPS * 365.25 days);

                uint256 totalFee = perfFee + mgmtFee;
                if (totalFee > rawProfit) totalFee = rawProfit;

                v.accumulatedFees += totalFee;
                slot.totalGain += rawProfit;

                emit Harvested(vaultId, slot.strategy, rawProfit, 0, totalFee);
            }

            slot.lastReport = block.timestamp;
            _rebalanceStrategy(vaultId, i);
        }

        v.lastHarvestTime = block.timestamp;
    }

    // ============ Strategy Migration ============

    /**
     * @notice Queue a strategy migration (subject to timelock).
     * @param vaultId The vault
     * @param oldStrategy Strategy to migrate from
     * @param newStrategy Strategy to migrate to
     */
    function queueMigration(uint256 vaultId, address oldStrategy, address newStrategy)
        external
        onlyOwner
        vaultExists(vaultId)
        returns (uint256 migrationId)
    {
        if (newStrategy == address(0)) revert ZeroAddress();
        uint256 idx = _getStrategyIndex(vaultId, oldStrategy);
        if (IStrategy(newStrategy).asset() != _vaults[vaultId].asset) revert StrategyAssetMismatch();

        migrationId = _migrationNonce++;
        _pendingMigrations[migrationId] = PendingMigration({
            vaultId: vaultId,
            strategyIndex: idx,
            newStrategy: newStrategy,
            executeAfter: block.timestamp + MIGRATION_TIMELOCK
        });

        emit MigrationQueued(migrationId, vaultId, oldStrategy, newStrategy);
    }

    /**
     * @notice Execute a queued migration after timelock expires.
     */
    function executeMigration(uint256 migrationId)
        external
        nonReentrant
        onlyOwner
    {
        PendingMigration storage m = _pendingMigrations[migrationId];
        if (m.newStrategy == address(0)) revert MigrationNotFound();
        if (block.timestamp < m.executeAfter) revert MigrationTimelockActive();

        uint256 vaultId = m.vaultId;
        StrategySlot storage slot = _strategies[vaultId][m.strategyIndex];
        address oldStrategy = slot.strategy;

        // Pull all funds from old strategy
        uint256 recovered = IStrategy(oldStrategy).emergencyWithdraw();

        // Remove old strategy from index
        _strategyIndex[vaultId][oldStrategy] = 0;

        // Deploy to new strategy
        uint256 debtRatio = slot.debtRatio;
        slot.strategy = m.newStrategy;
        slot.totalDebt = 0;
        slot.totalGain = 0;
        slot.totalLoss = 0;
        slot.lastReport = block.timestamp;
        slot.active = true;

        _strategyIndex[vaultId][m.newStrategy] = m.strategyIndex + 1;

        // Send recovered funds to new strategy
        if (recovered > 0) {
            IERC20(_vaults[vaultId].asset).safeTransfer(m.newStrategy, recovered);
            IStrategy(m.newStrategy).deposit(recovered);
            slot.totalDebt = recovered;
        }

        // Cleanup
        delete _pendingMigrations[migrationId];

        emit MigrationExecuted(migrationId);
    }

    /**
     * @notice Cancel a pending migration.
     */
    function cancelMigration(uint256 migrationId) external onlyOwner {
        if (_pendingMigrations[migrationId].newStrategy == address(0)) revert MigrationNotFound();
        delete _pendingMigrations[migrationId];
        emit MigrationCancelled(migrationId);
    }

    // ============ Fee Distribution ============

    /**
     * @notice Distribute accumulated fees via Shapley distribution.
     * @param vaultId The vault whose fees to distribute
     * @param gameId Shapley game ID for this distribution round
     * @param participants Shapley participants (strategists, keepers, protocol)
     */
    function distributeFees(
        uint256 vaultId,
        bytes32 gameId,
        IShapleyDistributor.Participant[] calldata participants
    )
        external
        onlyOwner
        vaultExists(vaultId)
    {
        VaultConfig storage v = _vaults[vaultId];
        uint256 fees = v.accumulatedFees;
        if (fees == 0) revert ZeroAmount();

        v.accumulatedFees = 0;

        // If Shapley distributor is set, create a cooperative game
        if (address(shapleyDistributor) != address(0)) {
            IERC20(v.asset).approve(address(shapleyDistributor), fees);
            shapleyDistributor.createGame(gameId, fees, v.asset, participants);
        } else {
            // Fallback: send fees to owner
            IERC20(v.asset).safeTransfer(owner(), fees);
        }

        emit FeesDistributed(vaultId, fees);
    }

    // ============ Emergency ============

    /**
     * @notice Toggle emergency shutdown for a vault.
     *         When active: deposits blocked, withdrawals still work.
     */
    function setEmergencyShutdown(uint256 vaultId, bool active)
        external
        onlyOwner
        vaultExists(vaultId)
    {
        _vaults[vaultId].emergencyShutdown = active;

        // On shutdown, pull all funds from strategies
        if (active) {
            StrategySlot[] storage slots = _strategies[vaultId];
            for (uint256 i = 0; i < slots.length; i++) {
                if (slots[i].totalDebt > 0) {
                    uint256 recovered = IStrategy(slots[i].strategy).emergencyWithdraw();
                    slots[i].totalDebt = 0;
                    slots[i].active = false;
                }
            }
        }

        emit EmergencyShutdownToggled(vaultId, active);
    }

    // ============ Admin ============

    function setKeeper(address newKeeper) external onlyOwner {
        if (newKeeper == address(0)) revert ZeroAddress();
        keeper = newKeeper;
        emit KeeperUpdated(newKeeper);
    }

    function setKeeperTip(uint256 newTip) external onlyOwner {
        keeperTip = newTip;
        emit KeeperTipUpdated(newTip);
    }

    function setShapleyDistributor(address _distributor) external onlyOwner {
        shapleyDistributor = IShapleyDistributor(_distributor);
    }

    function setVaultFees(uint256 vaultId, uint256 perfBps, uint256 mgmtBps)
        external
        onlyOwner
        vaultExists(vaultId)
    {
        if (perfBps > MAX_PERFORMANCE_FEE) revert ExcessiveFee();
        if (mgmtBps > MAX_MANAGEMENT_FEE) revert ExcessiveFee();
        _vaults[vaultId].performanceFeeBps = perfBps;
        _vaults[vaultId].managementFeeBps = mgmtBps;
    }

    function setDepositCap(uint256 vaultId, uint256 cap)
        external
        onlyOwner
        vaultExists(vaultId)
    {
        _vaults[vaultId].depositCap = cap;
    }

    // ============ View Functions ============

    /// @notice Total assets in a vault (idle + deployed across strategies)
    function totalVaultAssets(uint256 vaultId) external view returns (uint256) {
        return _totalVaultAssets(vaultId);
    }

    /// @notice Price per share (scaled to 1e18)
    function pricePerShare(uint256 vaultId) external view vaultExists(vaultId) returns (uint256) {
        VaultConfig storage v = _vaults[vaultId];
        if (v.totalShares == 0) return 1e18;
        return (_totalVaultAssets(vaultId) * 1e18) / v.totalShares;
    }

    /// @notice User's share balance
    function balanceOf(uint256 vaultId, address user) external view returns (uint256) {
        return _shares[vaultId][user];
    }

    /// @notice Convert shares to assets
    function convertToAssets(uint256 vaultId, uint256 shares) external view vaultExists(vaultId) returns (uint256) {
        VaultConfig storage v = _vaults[vaultId];
        if (v.totalShares == 0) return shares;
        return (shares * _totalVaultAssets(vaultId)) / v.totalShares;
    }

    /// @notice Convert assets to shares
    function convertToShares(uint256 vaultId, uint256 assets) external view vaultExists(vaultId) returns (uint256) {
        VaultConfig storage v = _vaults[vaultId];
        if (v.totalShares == 0) return assets;
        return (assets * v.totalShares) / _totalVaultAssets(vaultId);
    }

    /// @notice Get vault configuration
    function getVault(uint256 vaultId) external view returns (VaultConfig memory) {
        return _vaults[vaultId];
    }

    /// @notice Get all strategies for a vault
    function getStrategies(uint256 vaultId) external view returns (StrategySlot[] memory) {
        return _strategies[vaultId];
    }

    /// @notice Get strategy count for a vault
    function strategyCount(uint256 vaultId) external view returns (uint256) {
        return _strategies[vaultId].length;
    }

    /// @notice Total vault count
    function vaultCount() external view returns (uint256) {
        return _vaultCount;
    }

    /// @notice Get pending migration details
    function getPendingMigration(uint256 migrationId) external view returns (PendingMigration memory) {
        return _pendingMigrations[migrationId];
    }

    // ============ Internal Functions ============

    function _totalVaultAssets(uint256 vaultId) internal view returns (uint256 total) {
        VaultConfig storage v = _vaults[vaultId];

        // Idle balance held by this contract attributable to this vault
        // Simplified: track via totalDeposited + gains - deployed
        total = v.totalDeposited + v.accumulatedFees;

        // Add all strategy debts (deployed capital + unreported gains)
        StrategySlot[] storage slots = _strategies[vaultId];
        for (uint256 i = 0; i < slots.length; i++) {
            total += slots[i].totalDebt;
        }

        // Subtract fees (they belong to the protocol, not depositors)
        if (total > v.accumulatedFees) {
            total -= v.accumulatedFees;
        }
    }

    function _totalDebtRatio(uint256 vaultId) internal view returns (uint256 total) {
        StrategySlot[] storage slots = _strategies[vaultId];
        for (uint256 i = 0; i < slots.length; i++) {
            total += slots[i].debtRatio;
        }
    }

    function _getStrategyIndex(uint256 vaultId, address strategy) internal view returns (uint256) {
        uint256 idx = _strategyIndex[vaultId][strategy];
        if (idx == 0) revert StrategyNotFound();
        return idx - 1; // Convert from 1-indexed
    }

    function _pullFromStrategies(uint256 vaultId, uint256 needed) internal {
        StrategySlot[] storage slots = _strategies[vaultId];

        // Pull from strategies in reverse order (last added first)
        for (uint256 i = slots.length; i > 0 && needed > 0; i--) {
            StrategySlot storage slot = slots[i - 1];
            if (slot.totalDebt == 0) continue;

            uint256 toPull = needed < slot.totalDebt ? needed : slot.totalDebt;
            uint256 actual = IStrategy(slot.strategy).withdraw(toPull);

            slot.totalDebt -= actual;
            if (actual > needed) {
                needed = 0;
            } else {
                needed -= actual;
            }
        }
    }

    function _rebalanceStrategy(uint256 vaultId, uint256 idx) internal {
        StrategySlot storage slot = _strategies[vaultId][idx];
        uint256 totalAssets_ = _totalVaultAssets(vaultId);

        uint256 targetDebt = (totalAssets_ * slot.debtRatio) / BPS;

        if (slot.totalDebt < targetDebt) {
            // Need to deploy more capital
            uint256 toDeposit = targetDebt - slot.totalDebt;
            uint256 idle = IERC20(_vaults[vaultId].asset).balanceOf(address(this));
            if (toDeposit > idle) toDeposit = idle;

            if (toDeposit > 0) {
                IERC20(_vaults[vaultId].asset).safeTransfer(slot.strategy, toDeposit);
                IStrategy(slot.strategy).deposit(toDeposit);
                slot.totalDebt += toDeposit;
            }
        } else if (slot.totalDebt > targetDebt && !slot.active) {
            // Revoked strategy — pull excess
            uint256 excess = slot.totalDebt - targetDebt;
            uint256 actual = IStrategy(slot.strategy).withdraw(excess);
            slot.totalDebt -= actual;
        }
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }
}
