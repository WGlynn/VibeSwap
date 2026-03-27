// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title VibeStable (vUSD)
 * @notice Stablecoin merging MakerDAO's CDP pattern with Reserve Rights'
 *         multi-collateral basket and VibeSwap's PID auto-stabilization.
 *
 * @dev Key innovations over MakerDAO:
 *   - PID-controlled stability fee: automatically adjusts based on peg deviation,
 *     no governance votes needed for rate changes.
 *   - Multi-collateral from day one: ETH, WBTC, USDC each with independent
 *     collateral ratios, debt ceilings, and oracle feeds.
 *   - PSM (Peg Stability Module): 1:1 swap vUSD <-> USDC for direct arbitrage.
 *   - Dutch auction liquidations: fair price discovery (no extractive instant seizure).
 *   - Surplus/deficit buffer: excess stability fees absorb bad debt before socializing losses.
 *
 *   Cooperative Capitalism: stability through mechanism design, not human governance.
 */
contract VibeStable is
    ERC20Upgradeable,
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 public constant BPS = 10_000;
    uint256 public constant SECONDS_PER_YEAR = 365 days;
    uint256 public constant WAD = 1e18;

    /// @notice PID gain: proportional (BPS)
    uint256 public constant KP = 500;
    /// @notice PID gain: integral (BPS)
    uint256 public constant KI = 50;
    /// @notice PID gain: derivative (BPS)
    uint256 public constant KD = 100;

    /// @notice Minimum annual stability fee (0.5%)
    uint256 public constant MIN_FEE = 0.005e18;
    /// @notice Maximum annual stability fee (20%)
    uint256 public constant MAX_FEE = 0.20e18;

    /// @notice PSM fee in BPS (e.g., 10 = 0.1%)
    uint256 public constant PSM_FEE_BPS = 10;

    /// @notice Liquidation penalty in BPS (13% — matches MakerDAO)
    uint256 public constant LIQUIDATION_PENALTY_BPS = 1300;

    /// @notice Dutch auction duration
    uint256 public constant AUCTION_DURATION = 30 minutes;

    // ============ Structs ============

    struct CollateralType {
        address token;
        uint256 minCollateralRatio;   // BPS — e.g., 15000 = 150%
        uint256 stabilityFee;         // Annual rate, 18 decimals (PID-adjusted)
        uint256 debtCeiling;          // Max vUSD mintable against this collateral
        uint256 totalDebt;            // Current vUSD minted against this collateral
        address priceFeed;            // Oracle address (Chainlink-compatible)
        bool active;
    }

    struct Vault {
        address owner;
        address collateralToken;
        uint256 collateralAmount;
        uint256 debtAmount;           // vUSD owed (includes accrued stability fee)
        uint256 lastAccrual;          // Timestamp of last fee accrual
    }

    struct LiquidationAuction {
        uint256 vaultId;
        uint256 collateralAmount;
        address collateralToken;
        uint256 debtToRaise;          // vUSD needed to cover debt + penalty
        uint256 startTime;
        uint256 startPrice;           // 150% of fair value
        uint256 endPrice;             // 80% of fair value
        bool settled;
    }

    // ============ State ============

    /// @notice Registered collateral types (token address => CollateralType)
    mapping(address => CollateralType) public collateralTypes;

    /// @notice All registered collateral token addresses
    address[] public collateralList;

    /// @notice Vaults by ID (1-indexed)
    mapping(uint256 => Vault) public vaults;

    /// @notice Next vault ID
    uint256 public nextVaultId;

    /// @notice Liquidation auctions by ID (1-indexed)
    mapping(uint256 => LiquidationAuction) public auctions;

    /// @notice Next auction ID
    uint256 public nextAuctionId;

    // ============ PID State ============

    /// @notice vUSD price oracle (returns price in 18 decimals, 1e18 = $1.00)
    address public vusdPriceFeed;

    /// @notice Accumulated integral error for PID
    int256 public pidIntegral;

    /// @notice Previous error for PID derivative
    int256 public pidPrevError;

    /// @notice Last PID adjustment timestamp
    uint256 public pidLastUpdate;

    // ============ PSM State ============

    /// @notice USDC token address for PSM
    address public psmToken;

    /// @notice USDC decimals (6 for USDC)
    uint8 public psmTokenDecimals;

    // ============ Buffer ============

    /// @notice Surplus buffer (excess stability fees)
    uint256 public surplusBuffer;

    /// @notice Bad debt (deficit from under-collateralized liquidations)
    uint256 public badDebt;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event CollateralTypeAdded(address indexed token, uint256 minCollateralRatio, uint256 debtCeiling, address priceFeed);
    event VaultOpened(uint256 indexed vaultId, address indexed owner, address collateral, uint256 collateralAmount, uint256 debtAmount);
    event CollateralAdded(uint256 indexed vaultId, uint256 amount);
    event CollateralRemoved(uint256 indexed vaultId, uint256 amount);
    event DebtMinted(uint256 indexed vaultId, uint256 amount);
    event DebtRepaid(uint256 indexed vaultId, uint256 amount);
    event VaultLiquidated(uint256 indexed vaultId, uint256 auctionId);
    event AuctionSettled(uint256 indexed auctionId, address indexed buyer, uint256 price);
    event PSMSwapIn(address indexed user, uint256 usdcAmount, uint256 vusdAmount, uint256 fee);
    event PSMSwapOut(address indexed user, uint256 vusdAmount, uint256 usdcAmount, uint256 fee);
    event StabilityFeeAdjusted(address indexed collateral, uint256 oldFee, uint256 newFee);
    event BadDebtRecorded(uint256 amount);
    event SurplusBufferIncreased(uint256 amount);

    // ============ Errors ============

    error CollateralAlreadyExists();
    error CollateralNotActive();
    error CollateralNotFound();
    error InsufficientCollateralRatio();
    error DebtCeilingExceeded();
    error NotVaultOwner();
    error VaultNotLiquidatable();
    error AuctionNotActive();
    error AuctionExpired();
    error ZeroAmount();
    error ZeroAddress();
    error InsufficientDebt();
    error PSMNotConfigured();

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _vusdPriceFeed) external initializer {
        __ERC20_init("VibeSwap USD", "vUSD");
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        if (_vusdPriceFeed == address(0)) revert ZeroAddress();
        vusdPriceFeed = _vusdPriceFeed;
        nextVaultId = 1;
        nextAuctionId = 1;
        pidLastUpdate = block.timestamp;
    }

    // ============ Admin ============

    function addCollateralType(
        address token,
        uint256 minCollateralRatio,
        uint256 debtCeiling,
        address priceFeed
    ) external onlyOwner {
        if (token == address(0) || priceFeed == address(0)) revert ZeroAddress();
        if (collateralTypes[token].token != address(0)) revert CollateralAlreadyExists();

        collateralTypes[token] = CollateralType({
            token: token,
            minCollateralRatio: minCollateralRatio,
            stabilityFee: 0.02e18, // Default 2% annual
            debtCeiling: debtCeiling,
            totalDebt: 0,
            priceFeed: priceFeed,
            active: true
        });
        collateralList.push(token);

        emit CollateralTypeAdded(token, minCollateralRatio, debtCeiling, priceFeed);
    }

    /// @notice Configure the PSM stablecoin (USDC)
    function configurePSM(address _psmToken, uint8 _decimals) external onlyOwner {
        if (_psmToken == address(0)) revert ZeroAddress();
        psmToken = _psmToken;
        psmTokenDecimals = _decimals;
    }

    /// @notice Update the vUSD price oracle
    function setVusdPriceFeed(address _feed) external onlyOwner {
        if (_feed == address(0)) revert ZeroAddress();
        vusdPriceFeed = _feed;
    }

    /// @notice Toggle collateral type active/inactive
    function setCollateralActive(address token, bool active) external onlyOwner {
        if (collateralTypes[token].token == address(0)) revert CollateralNotFound();
        collateralTypes[token].active = active;
    }

    /// @notice Update debt ceiling for a collateral type
    function setDebtCeiling(address token, uint256 newCeiling) external onlyOwner {
        if (collateralTypes[token].token == address(0)) revert CollateralNotFound();
        collateralTypes[token].debtCeiling = newCeiling;
    }

    // ============ Vault Operations ============

    /// @notice Open a new vault: deposit collateral and mint vUSD
    function openVault(
        address collateral,
        uint256 collateralAmount,
        uint256 debtAmount
    ) external nonReentrant returns (uint256 vaultId) {
        if (collateralAmount == 0) revert ZeroAmount();
        CollateralType storage ct = collateralTypes[collateral];
        if (!ct.active) revert CollateralNotActive();

        // Check debt ceiling
        if (ct.totalDebt + debtAmount > ct.debtCeiling) revert DebtCeilingExceeded();

        // Transfer collateral in
        IERC20(collateral).safeTransferFrom(msg.sender, address(this), collateralAmount);

        // Create vault
        vaultId = nextVaultId++;
        vaults[vaultId] = Vault({
            owner: msg.sender,
            collateralToken: collateral,
            collateralAmount: collateralAmount,
            debtAmount: debtAmount,
            lastAccrual: block.timestamp
        });

        // Update total debt
        ct.totalDebt += debtAmount;

        // Check collateral ratio AFTER state update
        if (debtAmount > 0) {
            uint256 ratio = getCollateralRatio(vaultId);
            if (ratio < ct.minCollateralRatio) revert InsufficientCollateralRatio();

            // Mint vUSD to user
            _mint(msg.sender, debtAmount);
        }

        emit VaultOpened(vaultId, msg.sender, collateral, collateralAmount, debtAmount);
    }

    /// @notice Add more collateral to an existing vault
    function addCollateral(uint256 vaultId, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Vault storage v = vaults[vaultId];
        if (v.owner != msg.sender) revert NotVaultOwner();

        _accrueStabilityFee(vaultId);

        IERC20(v.collateralToken).safeTransferFrom(msg.sender, address(this), amount);
        v.collateralAmount += amount;

        emit CollateralAdded(vaultId, amount);
    }

    /// @notice Withdraw excess collateral (must maintain minimum ratio)
    function removeCollateral(uint256 vaultId, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Vault storage v = vaults[vaultId];
        if (v.owner != msg.sender) revert NotVaultOwner();

        _accrueStabilityFee(vaultId);

        v.collateralAmount -= amount; // Underflow reverts naturally

        // Must still be above minimum ratio (or have zero debt)
        if (v.debtAmount > 0) {
            CollateralType storage ct = collateralTypes[v.collateralToken];
            uint256 ratio = getCollateralRatio(vaultId);
            if (ratio < ct.minCollateralRatio) revert InsufficientCollateralRatio();
        }

        IERC20(v.collateralToken).safeTransfer(msg.sender, amount);

        emit CollateralRemoved(vaultId, amount);
    }

    /// @notice Mint additional vUSD against an existing vault
    function mintMore(uint256 vaultId, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Vault storage v = vaults[vaultId];
        if (v.owner != msg.sender) revert NotVaultOwner();

        _accrueStabilityFee(vaultId);

        CollateralType storage ct = collateralTypes[v.collateralToken];
        if (ct.totalDebt + amount > ct.debtCeiling) revert DebtCeilingExceeded();

        v.debtAmount += amount;
        ct.totalDebt += amount;

        uint256 ratio = getCollateralRatio(vaultId);
        if (ratio < ct.minCollateralRatio) revert InsufficientCollateralRatio();

        _mint(msg.sender, amount);

        emit DebtMinted(vaultId, amount);
    }

    /// @notice Repay vUSD debt (burns vUSD from caller)
    function repay(uint256 vaultId, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Vault storage v = vaults[vaultId];

        _accrueStabilityFee(vaultId);

        // Cap repayment at outstanding debt
        uint256 repayAmount = amount > v.debtAmount ? v.debtAmount : amount;

        v.debtAmount -= repayAmount;
        collateralTypes[v.collateralToken].totalDebt -= repayAmount;

        _burn(msg.sender, repayAmount);

        // If fully repaid, return all collateral to vault owner
        if (v.debtAmount == 0 && v.collateralAmount > 0) {
            uint256 col = v.collateralAmount;
            v.collateralAmount = 0;
            IERC20(v.collateralToken).safeTransfer(v.owner, col);
        }

        emit DebtRepaid(vaultId, repayAmount);
    }

    // ============ Liquidation ============

    /// @notice Liquidate an underwater vault via Dutch auction
    function liquidate(uint256 vaultId) external nonReentrant returns (uint256 auctionId) {
        Vault storage v = vaults[vaultId];
        if (v.debtAmount == 0) revert ZeroAmount();

        _accrueStabilityFee(vaultId);

        CollateralType storage ct = collateralTypes[v.collateralToken];
        uint256 ratio = getCollateralRatio(vaultId);
        if (ratio >= ct.minCollateralRatio) revert VaultNotLiquidatable();

        // Calculate debt + liquidation penalty
        uint256 totalDebtWithPenalty = v.debtAmount + (v.debtAmount * LIQUIDATION_PENALTY_BPS / BPS);

        // Get collateral price for auction pricing
        uint256 collateralPrice = _getPrice(ct.priceFeed);
        uint256 fairValue = v.collateralAmount * collateralPrice / WAD;

        // Create Dutch auction
        auctionId = nextAuctionId++;
        auctions[auctionId] = LiquidationAuction({
            vaultId: vaultId,
            collateralAmount: v.collateralAmount,
            collateralToken: v.collateralToken,
            debtToRaise: totalDebtWithPenalty,
            startTime: block.timestamp,
            startPrice: fairValue * 150 / 100,  // 150% of fair value
            endPrice: fairValue * 80 / 100,      // 80% of fair value
            settled: false
        });

        // Clear vault debt from global accounting
        ct.totalDebt -= v.debtAmount;

        // Zero out vault (collateral now in auction)
        v.collateralAmount = 0;
        v.debtAmount = 0;

        emit VaultLiquidated(vaultId, auctionId);
    }

    /// @notice Bid on a liquidation auction at the current Dutch auction price
    function bidAuction(uint256 auctionId) external nonReentrant {
        LiquidationAuction storage a = auctions[auctionId];
        if (a.settled) revert AuctionNotActive();
        if (block.timestamp > a.startTime + AUCTION_DURATION) revert AuctionExpired();

        // Current price descends linearly
        uint256 elapsed = block.timestamp - a.startTime;
        uint256 currentPrice = a.startPrice - (
            (a.startPrice - a.endPrice) * elapsed / AUCTION_DURATION
        );

        // Buyer pays in vUSD
        _burn(msg.sender, currentPrice);
        a.settled = true;

        // Transfer collateral to buyer
        IERC20(a.collateralToken).safeTransfer(msg.sender, a.collateralAmount);

        // Handle surplus / deficit
        if (currentPrice >= a.debtToRaise) {
            // Surplus goes to buffer
            uint256 surplus = currentPrice - a.debtToRaise;
            surplusBuffer += surplus;
            emit SurplusBufferIncreased(surplus);
        } else {
            // Deficit = bad debt
            uint256 deficit = a.debtToRaise - currentPrice;
            if (surplusBuffer >= deficit) {
                surplusBuffer -= deficit;
            } else {
                badDebt += deficit - surplusBuffer;
                surplusBuffer = 0;
                emit BadDebtRecorded(deficit);
            }
        }

        emit AuctionSettled(auctionId, msg.sender, currentPrice);
    }

    // ============ Peg Stability Module ============

    /// @notice Swap USDC for vUSD 1:1 (minus fee)
    function psmSwapIn(uint256 usdcAmount) external nonReentrant {
        if (psmToken == address(0)) revert PSMNotConfigured();
        if (usdcAmount == 0) revert ZeroAmount();

        uint256 fee = usdcAmount * PSM_FEE_BPS / BPS;
        uint256 netAmount = usdcAmount - fee;

        // Scale USDC (6 decimals) to vUSD (18 decimals)
        uint256 vusdAmount = netAmount * 10 ** (18 - psmTokenDecimals);
        uint256 feeScaled = fee * 10 ** (18 - psmTokenDecimals);

        IERC20(psmToken).safeTransferFrom(msg.sender, address(this), usdcAmount);
        _mint(msg.sender, vusdAmount);

        // Fee goes to surplus buffer
        surplusBuffer += feeScaled;

        emit PSMSwapIn(msg.sender, usdcAmount, vusdAmount, fee);
    }

    /// @notice Swap vUSD for USDC 1:1 (minus fee)
    function psmSwapOut(uint256 vusdAmount) external nonReentrant {
        if (psmToken == address(0)) revert PSMNotConfigured();
        if (vusdAmount == 0) revert ZeroAmount();

        // Scale vUSD (18 decimals) to USDC (6 decimals)
        uint256 usdcAmountGross = vusdAmount / 10 ** (18 - psmTokenDecimals);
        uint256 fee = usdcAmountGross * PSM_FEE_BPS / BPS;
        uint256 usdcAmountNet = usdcAmountGross - fee;

        _burn(msg.sender, vusdAmount);

        // Fee portion stays as USDC in contract, tracked as surplus
        uint256 feeScaled = fee * 10 ** (18 - psmTokenDecimals);
        surplusBuffer += feeScaled;

        IERC20(psmToken).safeTransfer(msg.sender, usdcAmountNet);

        emit PSMSwapOut(msg.sender, vusdAmount, usdcAmountNet, fee);
    }

    // ============ PID Controller ============

    /// @notice Adjust stability fees for all collateral types based on peg deviation
    /// @dev Anyone can call — permissionless, incentive-aligned
    function adjustStabilityFee() external {
        uint256 vusdPrice = _getPrice(vusdPriceFeed); // 18 decimals, 1e18 = $1.00
        int256 error = int256(WAD) - int256(vusdPrice); // positive = below peg

        uint256 dt = block.timestamp - pidLastUpdate;
        if (dt == 0) return;

        // Update integral (clamped to prevent windup)
        pidIntegral += error * int256(dt);
        int256 maxIntegral = int256(WAD) * 365 * 24 * 3600; // 1 year * WAD
        if (pidIntegral > maxIntegral) pidIntegral = maxIntegral;
        if (pidIntegral < -maxIntegral) pidIntegral = -maxIntegral;

        // Derivative
        int256 derivative = (error - pidPrevError) * int256(WAD) / int256(dt);

        // PID output (scaled by BPS gains)
        int256 adjustment = (
            int256(KP) * error / int256(BPS) +
            int256(KI) * pidIntegral / (int256(BPS) * int256(SECONDS_PER_YEAR)) +
            int256(KD) * derivative / int256(BPS)
        );

        pidPrevError = error;
        pidLastUpdate = block.timestamp;

        // Apply adjustment to all active collateral types
        for (uint256 i = 0; i < collateralList.length; i++) {
            CollateralType storage ct = collateralTypes[collateralList[i]];
            if (!ct.active) continue;

            uint256 oldFee = ct.stabilityFee;
            int256 newFee = int256(oldFee) + adjustment;

            // Clamp to bounds
            if (newFee < int256(MIN_FEE)) newFee = int256(MIN_FEE);
            if (newFee > int256(MAX_FEE)) newFee = int256(MAX_FEE);

            ct.stabilityFee = uint256(newFee);

            emit StabilityFeeAdjusted(ct.token, oldFee, uint256(newFee));
        }
    }

    // ============ View Functions ============

    /// @notice Get the current collateral ratio of a vault in BPS
    /// @return ratio Collateral ratio in BPS (15000 = 150%)
    function getCollateralRatio(uint256 vaultId) public view returns (uint256 ratio) {
        Vault storage v = vaults[vaultId];
        if (v.debtAmount == 0) return type(uint256).max;

        CollateralType storage ct = collateralTypes[v.collateralToken];
        uint256 collateralPrice = _getPrice(ct.priceFeed);

        // collateralValue = collateralAmount * price / WAD (both 18-decimal)
        uint256 collateralValue = v.collateralAmount * collateralPrice / WAD;

        // ratio = collateralValue / debtAmount * BPS
        ratio = collateralValue * BPS / v.debtAmount;
    }

    /// @notice Get number of registered collateral types
    function collateralCount() external view returns (uint256) {
        return collateralList.length;
    }

    function getCollateralType(address token) external view returns (CollateralType memory) { return collateralTypes[token]; }
    function getVault(uint256 vaultId) external view returns (Vault memory) { return vaults[vaultId]; }
    function getAuction(uint256 auctionId) external view returns (LiquidationAuction memory) { return auctions[auctionId]; }

    /// @notice Get the current Dutch auction price for an active auction
    function getAuctionPrice(uint256 auctionId) external view returns (uint256) {
        LiquidationAuction storage a = auctions[auctionId];
        if (a.settled || block.timestamp > a.startTime + AUCTION_DURATION) return 0;

        uint256 elapsed = block.timestamp - a.startTime;
        return a.startPrice - ((a.startPrice - a.endPrice) * elapsed / AUCTION_DURATION);
    }

    // ============ Internal ============

    /// @notice Accrue stability fee on a vault's debt
    function _accrueStabilityFee(uint256 vaultId) internal {
        Vault storage v = vaults[vaultId];
        if (v.debtAmount == 0 || v.lastAccrual == block.timestamp) return;

        CollateralType storage ct = collateralTypes[v.collateralToken];
        uint256 elapsed = block.timestamp - v.lastAccrual;

        // Simple interest: fee = debt * rate * elapsed / SECONDS_PER_YEAR
        uint256 fee = v.debtAmount * ct.stabilityFee * elapsed / (WAD * SECONDS_PER_YEAR);

        if (fee > 0) {
            v.debtAmount += fee;
            ct.totalDebt += fee;
            surplusBuffer += fee;
            emit SurplusBufferIncreased(fee);
        }

        v.lastAccrual = block.timestamp;
    }

    /// @notice Get price from a Chainlink-compatible oracle (18 decimals)
    function _getPrice(address feed) internal view returns (uint256) {
        // Chainlink returns (roundId, answer, startedAt, updatedAt, answeredInRound)
        // answer has `decimals()` precision — we normalize to 18
        (, int256 answer,,,) = IChainlinkFeed(feed).latestRoundData();
        require(answer > 0, "VibeStable: invalid price");

        uint8 feedDecimals = IChainlinkFeed(feed).decimals();
        if (feedDecimals < 18) {
            return uint256(answer) * 10 ** (18 - feedDecimals);
        } else if (feedDecimals > 18) {
            return uint256(answer) / 10 ** (feedDecimals - 18);
        }
        return uint256(answer);
    }

    /// @notice UUPS authorization — only owner can upgrade
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }
}

// ============ Interfaces ============

interface IChainlinkFeed {
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
    function decimals() external view returns (uint8);
}
