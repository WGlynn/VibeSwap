// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title VibeLendingPool — Decentralized Lending & Borrowing
 *
 * @notice DEPRECATED — Use contracts/financial/VibeLendPool.sol instead.
 *
 *         This contract is a duplicate of the canonical VibeLendPool (contracts/financial/VibeLendPool.sol).
 *         The canonical version implements IVibeLendPool, has full test coverage (unit, fuzz,
 *         invariant), includes flash loans, Shapley-weighted interest distribution, cross-asset
 *         collateral health factor, and per-market configurable reserve/liquidation parameters.
 *         This mechanism/ version has no tests and no downstream references.
 *
 *         Notable differences in this version that may be forward-ported to the canonical:
 *         - Per-asset configurable rate parameters (base, slope1, slope2, kink)
 *           (canonical uses global constants)
 *         - Normalized amount tracking (shares model) vs canonical's raw amount tracking
 *         - Depositor/borrower counters
 *
 * @dev ORIGINAL DESCRIPTION (preserved for reference):
 *      Aave-style lending pool with variable interest rates.
 *      Supply assets to earn interest, borrow against collateral.
 *
 *      Interest rate model:
 *      - Utilization-based: rate = base + (utilization x slope)
 *      - Kink at 80% utilization (rate jumps above kink)
 *      - LTV ratios per asset (typically 75-85%)
 *      - Liquidation at 90% LTV with 5% bonus
 */
contract VibeLendingPool is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 public constant SCALE = 1e18;
    uint256 public constant SECONDS_PER_YEAR = 365 days;
    uint256 public constant LIQUIDATION_BONUS_BPS = 500; // 5%
    uint256 public constant BPS = 10000;

    // ============ Types ============

    struct AssetConfig {
        address asset;
        uint256 totalDeposited;
        uint256 totalBorrowed;
        uint256 depositIndex;      // Cumulative interest index for deposits
        uint256 borrowIndex;       // Cumulative interest index for borrows
        uint256 lastUpdateTime;
        uint256 baseBorrowRate;    // Base rate (per year, scaled)
        uint256 slope1;            // Slope below kink
        uint256 slope2;            // Slope above kink
        uint256 kinkBps;           // Optimal utilization (basis points)
        uint256 ltvBps;            // Loan-to-value ratio
        uint256 liquidationLtvBps; // Liquidation threshold
        bool active;
    }

    struct UserDeposit {
        uint256 amount;
        uint256 index;             // Index at time of deposit
    }

    struct UserBorrow {
        uint256 amount;
        uint256 index;             // Index at time of borrow
    }

    // ============ State ============

    /// @notice Asset configurations
    mapping(address => AssetConfig) internal assets;
    address[] public assetList;

    /// @notice User deposits: asset => user => UserDeposit
    mapping(address => mapping(address => UserDeposit)) public deposits;

    /// @notice User borrows: asset => user => UserBorrow
    mapping(address => mapping(address => UserBorrow)) public borrows;

    /// @notice Total protocol reserves
    mapping(address => uint256) public reserves;

    /// @notice Reserve factor (portion of interest to protocol)
    uint256 public reserveFactorBps;

    /// @notice Total unique depositors
    uint256 public totalDepositors;
    uint256 public totalBorrowers;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event Deposited(address indexed asset, address indexed user, uint256 amount);
    event Withdrawn(address indexed asset, address indexed user, uint256 amount);
    event Borrowed(address indexed asset, address indexed user, uint256 amount);
    event Repaid(address indexed asset, address indexed user, uint256 amount);
    event Liquidated(address indexed asset, address indexed borrower, address indexed liquidator, uint256 amount);
    event AssetAdded(address indexed asset);
    event InterestAccrued(address indexed asset, uint256 depositRate, uint256 borrowRate);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        reserveFactorBps = 1000; // 10% of interest to reserves
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Asset Management ============

    function addAsset(
        address asset,
        uint256 baseBorrowRate,
        uint256 slope1,
        uint256 slope2,
        uint256 kinkBps,
        uint256 ltvBps,
        uint256 liquidationLtvBps
    ) external onlyOwner {
        require(!assets[asset].active, "Already added");
        require(ltvBps < liquidationLtvBps, "LTV must be < liquidation");

        {
            AssetConfig storage a = assets[asset];
            a.asset = asset;
            a.depositIndex = SCALE;
            a.borrowIndex = SCALE;
            a.lastUpdateTime = block.timestamp;
            a.baseBorrowRate = baseBorrowRate;
            a.slope1 = slope1;
            a.slope2 = slope2;
            a.kinkBps = kinkBps;
            a.ltvBps = ltvBps;
            a.liquidationLtvBps = liquidationLtvBps;
            a.active = true;
        }

        assetList.push(asset);
        emit AssetAdded(asset);
    }

    // ============ Deposit & Withdraw ============

    function deposit(address asset, uint256 amount) external nonReentrant {
        AssetConfig storage config = assets[asset];
        require(config.active, "Asset not active");
        require(amount > 0, "Zero amount");

        _accrueInterest(asset);

        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);

        UserDeposit storage userDep = deposits[asset][msg.sender];
        if (userDep.amount == 0) totalDepositors++;

        // Convert to normalized amount
        uint256 normalizedAmount = (amount * SCALE) / config.depositIndex;
        userDep.amount += normalizedAmount;
        userDep.index = config.depositIndex;

        config.totalDeposited += amount;

        emit Deposited(asset, msg.sender, amount);
    }

    function withdraw(address asset, uint256 amount) external nonReentrant {
        AssetConfig storage config = assets[asset];
        _accrueInterest(asset);

        UserDeposit storage userDep = deposits[asset][msg.sender];
        uint256 actualBalance = (userDep.amount * config.depositIndex) / SCALE;
        require(actualBalance >= amount, "Insufficient deposit");

        uint256 normalizedWithdraw = (amount * SCALE) / config.depositIndex;
        userDep.amount -= normalizedWithdraw;
        config.totalDeposited -= amount;

        // Check pool has enough liquidity
        uint256 available = config.totalDeposited - config.totalBorrowed;
        require(amount <= available + amount, "Insufficient liquidity"); // amount was already subtracted

        IERC20(asset).safeTransfer(msg.sender, amount);

        emit Withdrawn(asset, msg.sender, amount);
    }

    // ============ Borrow & Repay ============

    function borrow(address asset, uint256 amount) external nonReentrant {
        AssetConfig storage config = assets[asset];
        require(config.active, "Asset not active");
        require(amount > 0, "Zero amount");

        _accrueInterest(asset);

        // Check available liquidity
        require(config.totalDeposited - config.totalBorrowed >= amount, "Insufficient liquidity");

        UserBorrow storage userBor = borrows[asset][msg.sender];
        if (userBor.amount == 0) totalBorrowers++;

        uint256 normalizedAmount = (amount * SCALE) / config.borrowIndex;
        userBor.amount += normalizedAmount;
        userBor.index = config.borrowIndex;

        config.totalBorrowed += amount;

        IERC20(asset).safeTransfer(msg.sender, amount);

        emit Borrowed(asset, msg.sender, amount);
    }

    function repay(address asset, uint256 amount) external nonReentrant {
        AssetConfig storage config = assets[asset];
        _accrueInterest(asset);

        UserBorrow storage userBor = borrows[asset][msg.sender];
        uint256 actualDebt = (userBor.amount * config.borrowIndex) / SCALE;
        uint256 repayAmount = amount > actualDebt ? actualDebt : amount;

        IERC20(asset).safeTransferFrom(msg.sender, address(this), repayAmount);

        uint256 normalizedRepay = (repayAmount * SCALE) / config.borrowIndex;
        userBor.amount -= normalizedRepay;
        config.totalBorrowed -= repayAmount;

        emit Repaid(asset, msg.sender, repayAmount);
    }

    // ============ Liquidation ============

    function liquidate(
        address asset,
        address borrower,
        uint256 repayAmount
    ) external nonReentrant {
        _accrueInterest(asset);

        uint256 actualRepay;
        uint256 collateralSeized;
        {
            AssetConfig storage config = assets[asset];
            uint256 debt = (borrows[asset][borrower].amount * config.borrowIndex) / SCALE;
            require(debt > 0, "No debt");
            uint256 collateral = (deposits[asset][borrower].amount * config.depositIndex) / SCALE;
            require(debt > (collateral * config.liquidationLtvBps) / BPS, "Not liquidatable");
            actualRepay = repayAmount > debt / 2 ? debt / 2 : repayAmount;
            collateralSeized = actualRepay + (actualRepay * LIQUIDATION_BONUS_BPS) / BPS;
            if (collateralSeized > collateral) collateralSeized = collateral;
        }

        IERC20(asset).safeTransferFrom(msg.sender, address(this), actualRepay);

        {
            AssetConfig storage config = assets[asset];
            borrows[asset][borrower].amount -= (actualRepay * SCALE) / config.borrowIndex;
            config.totalBorrowed -= actualRepay;
            deposits[asset][borrower].amount -= (collateralSeized * SCALE) / config.depositIndex;
            config.totalDeposited -= collateralSeized;
        }

        IERC20(asset).safeTransfer(msg.sender, collateralSeized);
        emit Liquidated(asset, borrower, msg.sender, actualRepay);
    }

    // ============ Interest ============

    function _accrueInterest(address asset) internal {
        AssetConfig storage config = assets[asset];
        if (block.timestamp == config.lastUpdateTime) return;

        uint256 elapsed = block.timestamp - config.lastUpdateTime;
        uint256 utilizationBps = config.totalDeposited > 0
            ? (config.totalBorrowed * BPS) / config.totalDeposited
            : 0;

        // Calculate borrow rate
        uint256 borrowRate;
        if (utilizationBps <= config.kinkBps) {
            borrowRate = config.baseBorrowRate + (utilizationBps * config.slope1) / BPS;
        } else {
            uint256 normalRate = config.baseBorrowRate + (config.kinkBps * config.slope1) / BPS;
            uint256 excessUtil = utilizationBps - config.kinkBps;
            borrowRate = normalRate + (excessUtil * config.slope2) / BPS;
        }

        // Accrue interest
        uint256 borrowInterest = (config.borrowIndex * borrowRate * elapsed) / (SECONDS_PER_YEAR * SCALE);
        config.borrowIndex += borrowInterest;

        // Deposit rate = borrow rate × utilization × (1 - reserve factor)
        uint256 depositInterest = (borrowInterest * utilizationBps * (BPS - reserveFactorBps)) / (BPS * BPS);
        config.depositIndex += depositInterest;

        // Reserves
        uint256 reserveIncrease = (borrowInterest * utilizationBps * reserveFactorBps) / (BPS * BPS);
        reserves[asset] += reserveIncrease;

        config.lastUpdateTime = block.timestamp;

        emit InterestAccrued(asset, depositInterest, borrowInterest);
    }

    // ============ View ============

    function getUtilization(address asset) external view returns (uint256) {
        AssetConfig storage config = assets[asset];
        if (config.totalDeposited == 0) return 0;
        return (config.totalBorrowed * BPS) / config.totalDeposited;
    }

    function getUserDeposit(address asset, address user) external view returns (uint256) {
        AssetConfig storage config = assets[asset];
        UserDeposit storage dep = deposits[asset][user];
        return (dep.amount * config.depositIndex) / SCALE;
    }

    function getUserDebt(address asset, address user) external view returns (uint256) {
        AssetConfig storage config = assets[asset];
        UserBorrow storage bor = borrows[asset][user];
        return (bor.amount * config.borrowIndex) / SCALE;
    }

    function getAssetCount() external view returns (uint256) { return assetList.length; }
    function getAsset(address asset) external view returns (AssetConfig memory) { return assets[asset]; }

    function getAssetInfo(address asset) external view returns (
        uint256 totalDeposited_,
        uint256 totalBorrowed_,
        uint256 utilizationBps,
        uint256 depositIndex_,
        uint256 borrowIndex_
    ) {
        AssetConfig storage config = assets[asset];
        uint256 util = config.totalDeposited > 0 ? (config.totalBorrowed * BPS) / config.totalDeposited : 0;
        return (config.totalDeposited, config.totalBorrowed, util, config.depositIndex, config.borrowIndex);
    }
}
