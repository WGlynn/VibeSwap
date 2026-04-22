// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title VibeVault
 * @notice Generalized multi-asset vault for the VSOS DeFi operating system.
 * @dev ERC-4626 tokenized vault with tiered withdrawal fees, health monitoring,
 *      keeper-driven rebalancing, time-weighted share pricing, TVL caps, and
 *      emergency mode. Upgradeable via UUPS proxy pattern.
 *
 *      Cooperative capitalism mechanics:
 *        - Early exit fees discourage mercenary capital, rewarding long-term LPs
 *        - Concentration limits prevent single-asset dominance
 *        - Keeper integration enables decentralised rebalancing (VibeKeeperNetwork)
 *        - Emergency mode protects depositors while preserving withdrawal rights
 *        - Time-weighted share price prevents sandwich attacks on entry/exit
 *
 *      The vault accepts a primary asset (ERC-4626 standard) plus additional
 *      whitelisted tokens which are valued via an external price feed for
 *      multi-asset deposit support.
 */
contract VibeVault is
    Initializable,
    ERC4626Upgradeable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    event ConcentrationCapUpdated(address indexed token, uint256 previous, uint256 current);

    // ============ Constants ============

    uint256 private constant BPS = 10_000;
    uint256 private constant EARLY_EXIT_FEE_BPS = 50; // 0.5%
    uint256 private constant MATURITY_PERIOD = 30 days;
    uint256 private constant MAX_CONCENTRATION_BPS = 4000; // 40% max single-asset
    uint256 private constant TWAP_PERIOD = 1 hours;
    uint256 private constant MAX_ASSETS = 20;
    uint256 private constant REBALANCE_COOLDOWN = 1 hours;

    // ============ Structs ============

    struct AssetConfig {
        bool whitelisted;
        address priceFeed;        // returns price in primary asset terms (18 decimals)
        uint256 concentrationCap; // max BPS of total vault value this asset can represent
        uint256 balance;          // tracked balance of this asset in vault
    }

    struct DepositRecord {
        uint256 shares;
        uint256 depositTime;
    }

    struct SharePriceSnapshot {
        uint256 price;      // share price (18 decimals)
        uint256 timestamp;
    }

    struct RebalanceOrder {
        address tokenFrom;
        address tokenTo;
        uint256 amount;
        uint256 minReceived;
    }

    // ============ State ============

    /// @notice TVL cap in primary asset terms (0 = unlimited)
    uint256 public tvlCap;

    /// @notice Whether emergency mode is active (deposits paused, withdrawals open)
    bool public emergencyMode;

    /// @notice Keeper address authorized for rebalancing
    address public keeper;

    /// @notice Fee recipient for early exit fees
    address public feeRecipient;

    /// @notice Last rebalance timestamp
    uint256 public lastRebalanceTime;

    /// @notice Whitelisted secondary assets
    address[] public secondaryAssets;

    /// @notice Asset config by token address
    mapping(address => AssetConfig) public assetConfigs;

    /// @notice Deposit records per user (append-only for FIFO fee calculation)
    mapping(address => DepositRecord[]) public depositRecords;

    /// @notice Rolling share price snapshots for TWAP
    SharePriceSnapshot[] public priceSnapshots;

    /// @notice Total value denominated in primary asset (cached, updated on state changes)
    uint256 public cachedTotalValue;

    /// @notice Timestamp of last total value update
    uint256 public lastValueUpdate;

    // ============ Events ============

    event AssetWhitelisted(address indexed token, address priceFeed, uint256 concentrationCap);
    event AssetRemoved(address indexed token);
    event SecondaryDeposit(address indexed user, address indexed token, uint256 amount, uint256 sharesReceived);
    event EarlyExitFeeCharged(address indexed user, uint256 feeAmount);
    event EmergencyModeActivated(address indexed activator);
    event EmergencyModeDeactivated(address indexed deactivator);
    event KeeperUpdated(address indexed oldKeeper, address indexed newKeeper);
    event Rebalanced(address indexed keeper, uint256 ordersExecuted);
    event TvlCapUpdated(uint256 oldCap, uint256 newCap);
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
    event SharePriceRecorded(uint256 price, uint256 timestamp);
    event SecondaryWithdrawal(address indexed user, address indexed token, uint256 amount);

    // ============ Errors ============

    error AssetNotWhitelisted(address token);
    error AssetAlreadyWhitelisted(address token);
    error TvlCapExceeded(uint256 currentTvl, uint256 cap);
    error ConcentrationLimitExceeded(address token, uint256 currentBps, uint256 capBps);
    error EmergencyModeActive();
    error EmergencyModeNotActive();
    error NotKeeper();
    error RebalanceCooldown();
    error ZeroAddress();
    error ZeroAmount();
    error MaxAssetsReached();
    error InvalidConcentrationCap();
    error InsufficientSecondaryBalance(address token, uint256 requested, uint256 available);
    error SlippageExceeded();

    // ============ Modifiers ============

    modifier onlyKeeper() {
        if (msg.sender != keeper && msg.sender != owner()) revert NotKeeper();
        _;
    }

    modifier notEmergency() {
        if (emergencyMode) revert EmergencyModeActive();
        _;
    }

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the vault
     * @param asset_ Primary vault asset (ERC-4626 denomination)
     * @param name_ Vault share token name
     * @param symbol_ Vault share token symbol
     * @param owner_ Contract owner
     * @param keeper_ Keeper address for rebalancing
     * @param feeRecipient_ Recipient of early exit fees
     * @param tvlCap_ Maximum TVL in primary asset terms (0 = unlimited)
     */
    function initialize(
        IERC20 asset_,
        string memory name_,
        string memory symbol_,
        address owner_,
        address keeper_,
        address feeRecipient_,
        uint256 tvlCap_
    ) external initializer {
        if (owner_ == address(0)) revert ZeroAddress();
        if (feeRecipient_ == address(0)) revert ZeroAddress();

        __ERC4626_init(asset_);
        __ERC20_init(name_, symbol_);
        __Ownable_init(owner_);
        __ReentrancyGuard_init();
        __Pausable_init();
        __UUPSUpgradeable_init();

        keeper = keeper_;
        feeRecipient = feeRecipient_;
        tvlCap = tvlCap_;
        lastValueUpdate = block.timestamp;

        // Record initial share price
        _recordSharePrice();
    }

    // ============ Multi-Asset Management ============

    /**
     * @notice Whitelist a secondary asset for deposits
     * @param token Token address to whitelist
     * @param priceFeed Address that implements price oracle (returns price in primary asset terms)
     * @param concentrationCap Max BPS this asset can represent of total vault value
     */
    function whitelistAsset(
        address token,
        address priceFeed,
        uint256 concentrationCap
    ) external onlyOwner {
        if (token == address(0) || priceFeed == address(0)) revert ZeroAddress();
        if (token == asset()) revert AssetAlreadyWhitelisted(token);
        if (assetConfigs[token].whitelisted) revert AssetAlreadyWhitelisted(token);
        if (concentrationCap == 0 || concentrationCap > MAX_CONCENTRATION_BPS) {
            revert InvalidConcentrationCap();
        }
        if (secondaryAssets.length >= MAX_ASSETS) revert MaxAssetsReached();

        assetConfigs[token] = AssetConfig({
            whitelisted: true,
            priceFeed: priceFeed,
            concentrationCap: concentrationCap,
            balance: 0
        });
        secondaryAssets.push(token);

        emit AssetWhitelisted(token, priceFeed, concentrationCap);
    }

    /**
     * @notice Remove a secondary asset from the whitelist
     * @dev Does not force-withdraw existing balances; keeper should rebalance first
     * @param token Token address to remove
     */
    function removeAsset(address token) external onlyOwner {
        if (!assetConfigs[token].whitelisted) revert AssetNotWhitelisted(token);

        assetConfigs[token].whitelisted = false;

        // Remove from array (swap-and-pop)
        uint256 len = secondaryAssets.length;
        for (uint256 i = 0; i < len; i++) {
            if (secondaryAssets[i] == token) {
                secondaryAssets[i] = secondaryAssets[len - 1];
                secondaryAssets.pop();
                break;
            }
        }

        emit AssetRemoved(token);
    }

    /**
     * @notice Deposit a secondary (non-primary) asset into the vault
     * @param token The whitelisted secondary token
     * @param amount Amount of the secondary token to deposit
     * @param minShares Minimum shares to receive (slippage protection)
     * @return shares Amount of vault shares minted
     */
    function depositSecondary(
        address token,
        uint256 amount,
        uint256 minShares
    ) external nonReentrant notEmergency whenNotPaused returns (uint256 shares) {
        if (amount == 0) revert ZeroAmount();
        AssetConfig storage config = assetConfigs[token];
        if (!config.whitelisted) revert AssetNotWhitelisted(token);

        // Get value in primary asset terms
        uint256 primaryValue = _getAssetValue(token, amount);

        // Check TVL cap
        uint256 currentTvl = totalVaultValue();
        if (tvlCap > 0 && currentTvl + primaryValue > tvlCap) {
            revert TvlCapExceeded(currentTvl + primaryValue, tvlCap);
        }

        // Calculate shares based on primary-asset-equivalent value
        shares = _convertToShares(primaryValue);
        if (shares < minShares) revert SlippageExceeded();

        // Transfer token in
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        config.balance += amount;

        // Check concentration limit after deposit
        _checkConcentration(token);

        // Mint shares
        _mint(msg.sender, shares);

        // Record deposit for fee calculation
        depositRecords[msg.sender].push(DepositRecord({
            shares: shares,
            depositTime: block.timestamp
        }));

        // Update cached value and price snapshot
        _updateCachedValue();
        _recordSharePrice();

        emit SecondaryDeposit(msg.sender, token, amount, shares);
    }

    /**
     * @notice Withdraw a specific secondary asset proportional to shares
     * @param token The secondary token to withdraw
     * @param shares Amount of vault shares to burn
     * @param minAmount Minimum token amount to receive
     * @return amount Amount of secondary token returned
     */
    function withdrawSecondary(
        address token,
        uint256 shares,
        uint256 minAmount
    ) external nonReentrant whenNotPaused returns (uint256 amount) {
        if (shares == 0) revert ZeroAmount();
        AssetConfig storage config = assetConfigs[token];
        if (!config.whitelisted && config.balance == 0) revert AssetNotWhitelisted(token);

        // Calculate proportional amount of secondary token
        uint256 totalVal = totalVaultValue();
        if (totalVal == 0) revert ZeroAmount();

        uint256 shareValue = (shares * totalVal) / totalSupply();
        amount = _getTokenAmount(token, shareValue);

        if (amount > config.balance) {
            revert InsufficientSecondaryBalance(token, amount, config.balance);
        }

        // Apply early exit fee
        uint256 fee = _calculateEarlyExitFee(msg.sender, shares);
        if (fee > 0) {
            uint256 feeTokens = (amount * fee) / BPS;
            amount -= feeTokens;
            // Fee stays in vault (benefits remaining holders)
            emit EarlyExitFeeCharged(msg.sender, feeTokens);
        }

        if (amount < minAmount) revert SlippageExceeded();

        // Burn shares and update records
        _burn(msg.sender, shares);
        _consumeDepositRecords(msg.sender, shares);
        config.balance -= amount;

        // Transfer out
        IERC20(token).safeTransfer(msg.sender, amount);

        _updateCachedValue();
        _recordSharePrice();

        emit SecondaryWithdrawal(msg.sender, token, amount);
    }

    // ============ ERC-4626 Overrides ============

    /**
     * @notice Override deposit to enforce TVL cap, emergency mode, and record deposits
     */
    function deposit(uint256 assets, address receiver)
        public
        virtual
        override
        nonReentrant
        notEmergency
        whenNotPaused
        returns (uint256 shares)
    {
        if (assets == 0) revert ZeroAmount();

        // Check TVL cap
        uint256 currentTvl = totalVaultValue();
        if (tvlCap > 0 && currentTvl + assets > tvlCap) {
            revert TvlCapExceeded(currentTvl + assets, tvlCap);
        }

        shares = super.deposit(assets, receiver);

        // Record deposit for fee tracking
        depositRecords[receiver].push(DepositRecord({
            shares: shares,
            depositTime: block.timestamp
        }));

        _updateCachedValue();
        _recordSharePrice();
    }

    /**
     * @notice Override mint to enforce TVL cap and emergency mode
     */
    function mint(uint256 shares, address receiver)
        public
        virtual
        override
        nonReentrant
        notEmergency
        whenNotPaused
        returns (uint256 assets)
    {
        if (shares == 0) revert ZeroAmount();

        uint256 assetsNeeded = previewMint(shares);
        uint256 currentTvl = totalVaultValue();
        if (tvlCap > 0 && currentTvl + assetsNeeded > tvlCap) {
            revert TvlCapExceeded(currentTvl + assetsNeeded, tvlCap);
        }

        assets = super.mint(shares, receiver);

        depositRecords[receiver].push(DepositRecord({
            shares: shares,
            depositTime: block.timestamp
        }));

        _updateCachedValue();
        _recordSharePrice();
    }

    /**
     * @notice Override withdraw to apply early exit fee
     */
    function withdraw(uint256 assets, address receiver, address _owner)
        public
        virtual
        override
        nonReentrant
        whenNotPaused
        returns (uint256 shares)
    {
        if (assets == 0) revert ZeroAmount();

        shares = previewWithdraw(assets);

        uint256 fee = _calculateEarlyExitFee(_owner, shares);
        if (fee > 0) {
            // Increase shares burned to account for fee
            uint256 feeShares = (shares * fee) / BPS;
            shares += feeShares;
            // Fee shares value stays in vault
            emit EarlyExitFeeCharged(_owner, feeShares);
        }

        // Handle allowance if caller != owner
        if (msg.sender != _owner) {
            _spendAllowance(_owner, msg.sender, shares);
        }

        _burn(_owner, shares);
        _consumeDepositRecords(_owner, shares);

        IERC20(asset()).safeTransfer(receiver, assets);

        _updateCachedValue();
        _recordSharePrice();

        emit Withdraw(msg.sender, receiver, _owner, assets, shares);
    }

    /**
     * @notice Override redeem to apply early exit fee
     */
    function redeem(uint256 shares, address receiver, address _owner)
        public
        virtual
        override
        nonReentrant
        whenNotPaused
        returns (uint256 assets)
    {
        if (shares == 0) revert ZeroAmount();

        uint256 fee = _calculateEarlyExitFee(_owner, shares);
        uint256 effectiveShares = shares;

        if (fee > 0) {
            uint256 feeShares = (shares * fee) / BPS;
            effectiveShares = shares - feeShares;
            // feeShares worth of assets stay in vault
            emit EarlyExitFeeCharged(_owner, feeShares);
        }

        assets = _convertToAssets(effectiveShares);

        if (msg.sender != _owner) {
            _spendAllowance(_owner, msg.sender, shares);
        }

        _burn(_owner, shares);
        _consumeDepositRecords(_owner, shares);

        IERC20(asset()).safeTransfer(receiver, assets);

        _updateCachedValue();
        _recordSharePrice();

        emit Withdraw(msg.sender, receiver, _owner, assets, shares);
    }

    /**
     * @notice Total assets includes primary asset balance only (ERC-4626 standard)
     * @dev For full multi-asset value, use totalVaultValue()
     */
    function totalAssets() public view virtual override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }

    // ============ Vault Health ============

    /**
     * @notice Total vault value in primary asset terms (includes all assets)
     * @return value Total value denominated in primary asset
     */
    function totalVaultValue() public view returns (uint256 value) {
        value = IERC20(asset()).balanceOf(address(this));

        uint256 len = secondaryAssets.length;
        for (uint256 i = 0; i < len; i++) {
            address token = secondaryAssets[i];
            uint256 bal = assetConfigs[token].balance;
            if (bal > 0) {
                value += _getAssetValue(token, bal);
            }
        }
    }

    /**
     * @notice Utilization ratio: how much of TVL cap is used
     * @return ratio Utilization in BPS (0-10000). Returns 0 if no cap.
     */
    function utilizationRatio() external view returns (uint256 ratio) {
        if (tvlCap == 0) return 0;
        uint256 totalVal = totalVaultValue();
        ratio = (totalVal * BPS) / tvlCap;
        if (ratio > BPS) ratio = BPS;
    }

    /**
     * @notice Get concentration of a specific asset in BPS of total vault value
     * @param token Token to check
     * @return bps Concentration in basis points
     */
    function assetConcentration(address token) public view returns (uint256 bps) {
        uint256 totalVal = totalVaultValue();
        if (totalVal == 0) return 0;

        uint256 assetVal;
        if (token == asset()) {
            assetVal = IERC20(asset()).balanceOf(address(this));
        } else {
            assetVal = _getAssetValue(token, assetConfigs[token].balance);
        }

        bps = (assetVal * BPS) / totalVal;
    }

    /**
     * @notice Check if the vault is healthy (all concentration limits respected)
     * @return healthy True if all assets are within concentration limits
     */
    function isHealthy() external view returns (bool healthy) {
        healthy = true;
        uint256 len = secondaryAssets.length;
        for (uint256 i = 0; i < len; i++) {
            address token = secondaryAssets[i];
            uint256 conc = assetConcentration(token);
            if (conc > assetConfigs[token].concentrationCap) {
                healthy = false;
                break;
            }
        }
    }

    // ============ Time-Weighted Share Price ============

    /**
     * @notice Get the time-weighted average share price over the TWAP period
     * @return twapPrice The TWAP share price (18 decimals)
     */
    function twapSharePrice() external view returns (uint256 twapPrice) {
        uint256 len = priceSnapshots.length;
        if (len == 0) return _currentSharePrice();

        uint256 cutoff = block.timestamp > TWAP_PERIOD ? block.timestamp - TWAP_PERIOD : 0;
        uint256 totalWeight;
        uint256 weightedSum;

        for (uint256 i = len; i > 0; i--) {
            SharePriceSnapshot memory snap = priceSnapshots[i - 1];
            if (snap.timestamp < cutoff) break;

            uint256 weight = 1; // equal weight per snapshot
            weightedSum += snap.price * weight;
            totalWeight += weight;
        }

        if (totalWeight == 0) return _currentSharePrice();
        twapPrice = weightedSum / totalWeight;
    }

    /**
     * @notice Number of price snapshots stored
     */
    function priceSnapshotCount() external view returns (uint256) {
        return priceSnapshots.length;
    }

    // ============ Keeper Rebalancing ============

    /**
     * @notice Execute rebalancing orders (keeper only)
     * @dev Keeper supplies pre-computed orders. The vault validates concentration
     *      limits are improved or maintained after execution.
     * @param orders Array of rebalance orders to execute
     */
    function rebalance(RebalanceOrder[] calldata orders) external onlyKeeper nonReentrant {
        if (block.timestamp < lastRebalanceTime + REBALANCE_COOLDOWN) {
            revert RebalanceCooldown();
        }

        uint256 executed;
        for (uint256 i = 0; i < orders.length; i++) {
            RebalanceOrder calldata order = orders[i];

            // Validate assets
            bool fromIsPrimary = order.tokenFrom == asset();
            bool toIsPrimary = order.tokenTo == asset();

            if (!fromIsPrimary && !assetConfigs[order.tokenFrom].whitelisted) continue;
            if (!toIsPrimary && !assetConfigs[order.tokenTo].whitelisted) continue;

            // Update balances (actual swap must happen externally via approved DEX)
            if (fromIsPrimary) {
                // Primary -> Secondary: approve and track
                IERC20(order.tokenFrom).forceApprove(msg.sender, order.amount);
            } else {
                AssetConfig storage fromConfig = assetConfigs[order.tokenFrom];
                if (fromConfig.balance < order.amount) continue;
                fromConfig.balance -= order.amount;
                IERC20(order.tokenFrom).forceApprove(msg.sender, order.amount);
            }

            executed++;
        }

        lastRebalanceTime = block.timestamp;
        _updateCachedValue();
        _recordSharePrice();

        emit Rebalanced(msg.sender, executed);
    }

    /**
     * @notice Callback for keeper to report received tokens after rebalance swap
     * @param token The token received
     * @param amount The amount received
     */
    function reportRebalanceReceived(address token, uint256 amount) external onlyKeeper {
        if (token == asset()) {
            // Primary asset received — no tracking needed, balance updates automatically
        } else {
            assetConfigs[token].balance += amount;
        }
        _updateCachedValue();
    }

    // ============ Emergency Mode ============

    /**
     * @notice Activate emergency mode: pause deposits, keep withdrawals open
     * @dev Only owner can activate. Once active, no new deposits are accepted.
     */
    function activateEmergencyMode() external onlyOwner {
        if (emergencyMode) revert EmergencyModeActive();
        emergencyMode = true;
        emit EmergencyModeActivated(msg.sender);
    }

    /**
     * @notice Deactivate emergency mode: resume normal operations
     */
    function deactivateEmergencyMode() external onlyOwner {
        if (!emergencyMode) revert EmergencyModeNotActive();
        emergencyMode = false;
        emit EmergencyModeDeactivated(msg.sender);
    }

    // ============ Admin ============

    /**
     * @notice Update the keeper address
     * @param newKeeper New keeper address
     */
    function setKeeper(address newKeeper) external onlyOwner {
        emit KeeperUpdated(keeper, newKeeper);
        keeper = newKeeper;
    }

    /**
     * @notice Update fee recipient
     * @param newRecipient New fee recipient address
     */
    function setFeeRecipient(address newRecipient) external onlyOwner {
        if (newRecipient == address(0)) revert ZeroAddress();
        emit FeeRecipientUpdated(feeRecipient, newRecipient);
        feeRecipient = newRecipient;
    }

    /**
     * @notice Update TVL cap
     * @param newCap New TVL cap (0 = unlimited)
     */
    function setTvlCap(uint256 newCap) external onlyOwner {
        emit TvlCapUpdated(tvlCap, newCap);
        tvlCap = newCap;
    }

    /**
     * @notice Update concentration cap for a whitelisted asset
     * @param token Asset address
     * @param newCap New concentration cap in BPS
     */
    function setConcentrationCap(address token, uint256 newCap) external onlyOwner {
        if (!assetConfigs[token].whitelisted) revert AssetNotWhitelisted(token);
        if (newCap == 0 || newCap > MAX_CONCENTRATION_BPS) revert InvalidConcentrationCap();
        uint256 prev = assetConfigs[token].concentrationCap;
        assetConfigs[token].concentrationCap = newCap;
        emit ConcentrationCapUpdated(token, prev, newCap);
    }

    /**
     * @notice Pause all vault operations (owner-level circuit breaker)
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause vault operations
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    // ============ View Helpers ============

    /**
     * @notice Get all secondary asset addresses
     * @return assets Array of whitelisted secondary asset addresses
     */
    function getSecondaryAssets() external view returns (address[] memory) {
        return secondaryAssets;
    }

    /**
     * @notice Get deposit history for a user
     * @param user User address
     * @return records Array of deposit records
     */
    function getDepositRecords(address user) external view returns (DepositRecord[] memory) {
        return depositRecords[user];
    }

    /**
     * @notice Preview the early exit fee for a user redeeming shares
     * @param user User address
     * @param shares Number of shares to redeem
     * @return feeBps Effective fee in basis points
     */
    function previewExitFee(address user, uint256 shares) external view returns (uint256 feeBps) {
        return _calculateEarlyExitFee(user, shares);
    }

    // ============ Internal ============

    /**
     * @notice Calculate early exit fee based on FIFO deposit matching
     * @dev Shares deposited > MATURITY_PERIOD ago have 0% fee.
     *      Shares deposited within MATURITY_PERIOD incur EARLY_EXIT_FEE_BPS.
     *      Uses weighted average across matched deposit tranches.
     * @param user User address
     * @param sharesToRedeem Number of shares being redeemed
     * @return feeBps Weighted average fee in BPS
     */
    function _calculateEarlyExitFee(address user, uint256 sharesToRedeem)
        internal
        view
        returns (uint256 feeBps)
    {
        DepositRecord[] storage records = depositRecords[user];
        uint256 len = records.length;
        if (len == 0) return 0;

        uint256 remaining = sharesToRedeem;
        uint256 earlyShares;

        // FIFO: match oldest deposits first
        for (uint256 i = 0; i < len && remaining > 0; i++) {
            uint256 tranche = records[i].shares;
            if (tranche == 0) continue;

            uint256 matched = tranche < remaining ? tranche : remaining;
            remaining -= matched;

            if (block.timestamp < records[i].depositTime + MATURITY_PERIOD) {
                earlyShares += matched;
            }
        }

        if (earlyShares == 0) return 0;
        // Weighted fee: proportion of early shares * fee rate
        feeBps = (earlyShares * EARLY_EXIT_FEE_BPS) / sharesToRedeem;
    }

    /**
     * @notice Consume deposit records in FIFO order after shares are burned
     * @param user User address
     * @param shares Shares being burned
     */
    function _consumeDepositRecords(address user, uint256 shares) internal {
        DepositRecord[] storage records = depositRecords[user];
        uint256 remaining = shares;

        for (uint256 i = 0; i < records.length && remaining > 0; i++) {
            if (records[i].shares == 0) continue;

            if (records[i].shares <= remaining) {
                remaining -= records[i].shares;
                records[i].shares = 0;
            } else {
                records[i].shares -= remaining;
                remaining = 0;
            }
        }
    }

    /**
     * @notice Get the value of a secondary asset amount in primary asset terms
     * @param token Secondary token address
     * @param amount Amount of secondary token
     * @return value Value in primary asset terms
     */
    function _getAssetValue(address token, uint256 amount) internal view returns (uint256 value) {
        address feed = assetConfigs[token].priceFeed;
        // Price feed returns: 1 token = X primary asset units (18 decimals)
        // solhint-disable-next-line avoid-low-level-calls
        (bool success, bytes memory data) = feed.staticcall(
            abi.encodeWithSignature("getPrice(address)", token)
        );
        require(success && data.length >= 32, "VibeVault: price feed failed");
        uint256 price = abi.decode(data, (uint256));
        value = (amount * price) / 1e18;
    }

    /**
     * @notice Convert a primary-asset-denominated value to token amount
     * @param token Secondary token address
     * @param primaryValue Value in primary asset terms
     * @return amount Amount of secondary token
     */
    function _getTokenAmount(address token, uint256 primaryValue) internal view returns (uint256 amount) {
        address feed = assetConfigs[token].priceFeed;
        (bool success, bytes memory data) = feed.staticcall(
            abi.encodeWithSignature("getPrice(address)", token)
        );
        require(success && data.length >= 32, "VibeVault: price feed failed");
        uint256 price = abi.decode(data, (uint256));
        require(price > 0, "VibeVault: zero price");
        amount = (primaryValue * 1e18) / price;
    }

    /**
     * @notice Check that a token's concentration is within limits
     * @param token Token to check
     */
    function _checkConcentration(address token) internal view {
        uint256 conc = assetConcentration(token);
        uint256 cap = assetConfigs[token].concentrationCap;
        if (conc > cap) {
            revert ConcentrationLimitExceeded(token, conc, cap);
        }
    }

    /**
     * @notice Convert primary asset amount to shares (for secondary deposits)
     * @param primaryAmount Amount in primary asset terms
     * @return shares Number of vault shares
     */
    function _convertToShares(uint256 primaryAmount) internal view returns (uint256 shares) {
        uint256 supply = totalSupply();
        if (supply == 0) {
            shares = primaryAmount; // 1:1 for first deposit
        } else {
            uint256 totalVal = totalVaultValue();
            shares = (primaryAmount * supply) / totalVal;
        }
    }

    /**
     * @notice Convert shares to primary asset value (for secondary withdrawals)
     * @param shares Number of shares
     * @return assets Value in primary asset terms
     */
    function _convertToAssets(uint256 shares) internal view returns (uint256 assets) {
        uint256 supply = totalSupply();
        if (supply == 0) return shares;
        assets = (shares * totalAssets()) / supply;
    }

    /**
     * @notice Get current share price (18 decimals)
     */
    function _currentSharePrice() internal view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return 1e18;
        return (totalVaultValue() * 1e18) / supply;
    }

    /**
     * @notice Record a share price snapshot for TWAP calculation
     */
    function _recordSharePrice() internal {
        uint256 price = _currentSharePrice();
        priceSnapshots.push(SharePriceSnapshot({
            price: price,
            timestamp: block.timestamp
        }));
        emit SharePriceRecorded(price, block.timestamp);
    }

    /**
     * @notice Update the cached total vault value
     */
    function _updateCachedValue() internal {
        cachedTotalValue = totalVaultValue();
        lastValueUpdate = block.timestamp;
    }

    /**
     * @notice UUPS authorization — only owner can upgrade
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Storage Gap ============

    /**
     * @dev Reserved storage gap for future upgrades
     */
    uint256[40] private __gap;
}
