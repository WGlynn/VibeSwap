// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/IVibeLendPool.sol";

/**
 * @title VibeLendPool
 * @notice AAVE-style lending pool with Shapley-weighted interest distribution.
 * @dev Merges patterns from AAVE (flash loans, health factor, variable rates),
 *      MakerDAO (CDP stability), and Reserve Rights (multi-collateral baskets).
 *
 *      Interest rate model uses a kink curve:
 *        - Below optimal utilization (80%): base + (u / optimal) * slope1
 *        - Above optimal: base + slope1 + ((u - optimal) / (1 - optimal)) * slope2
 *
 *      Shapley weighting: lenders who deposited earlier and through higher-utilization
 *      periods receive a stability bonus on top of proportional yield.
 *
 *      Part of VSOS (VibeSwap Operating System) Financial Primitives.
 */
contract VibeLendPool is
    IVibeLendPool,
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 private constant WAD = 1e18;
    uint256 private constant BPS = 10_000;
    uint256 private constant SECONDS_PER_YEAR = 31_557_600;

    /// @dev Flash loan fee: 0.05% = 5 BPS
    uint256 public constant FLASH_LOAN_FEE_BPS = 5;

    // ============ Interest Rate Model ============

    /// @dev Optimal utilization: 80% (WAD-scaled)
    uint256 public constant OPTIMAL_UTILIZATION = 0.80e18;

    /// @dev Base rate: 2% annual (WAD-scaled)
    uint256 public constant BASE_RATE = 0.02e18;

    /// @dev Slope 1: 4% annual at optimal utilization
    uint256 public constant SLOPE_1 = 0.04e18;

    /// @dev Slope 2: 75% annual above optimal (steep kink)
    uint256 public constant SLOPE_2 = 0.75e18;

    // ============ Shapley Constants ============

    /// @dev Portion of yield allocated to Shapley stability bonus (10%)
    uint256 public constant SHAPLEY_BONUS_BPS = 1000;

    // ============ State ============

    /// @dev asset => Market
    mapping(address => Market) public markets;

    /// @dev List of all market assets for iteration
    address[] public marketAssets;

    /// @dev asset => user => UserPosition
    mapping(address => mapping(address => UserPosition)) public positions;

    /// @dev asset => accumulated reserves (insurance fund)
    mapping(address => uint256) public reserves;

    /// @dev asset => user => Shapley weight accumulator (deposit * time-weighted utilization)
    mapping(address => mapping(address => uint256)) public shapleyWeights;

    /// @dev asset => total Shapley weight across all depositors
    mapping(address => uint256) public totalShapleyWeight;

    /// @dev asset => user => last Shapley accrual timestamp
    mapping(address => mapping(address => uint256)) public shapleyLastUpdate;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    // ============ Admin ============

    function createMarket(
        address asset,
        uint256 ltvBps,
        uint256 liquidationThreshold,
        uint256 liquidationBonus,
        uint256 reserveFactor
    ) external onlyOwner {
        require(asset != address(0), "LendPool: zero address");
        require(!markets[asset].active, "LendPool: market exists");
        require(ltvBps <= BPS, "LendPool: ltv > 100%");
        require(liquidationThreshold <= BPS, "LendPool: liq threshold > 100%");
        require(liquidationThreshold >= ltvBps, "LendPool: threshold < ltv");
        require(liquidationBonus <= 5000, "LendPool: bonus too high");
        require(reserveFactor <= 5000, "LendPool: reserve too high");

        markets[asset] = Market({
            asset: asset,
            totalDeposits: 0,
            totalBorrows: 0,
            reserveFactor: reserveFactor,
            ltvBps: ltvBps,
            liquidationThreshold: liquidationThreshold,
            liquidationBonus: liquidationBonus,
            lastAccrual: block.timestamp,
            borrowIndex: WAD,
            supplyIndex: WAD,
            active: true
        });

        marketAssets.push(asset);

        emit MarketCreated(asset, ltvBps, liquidationThreshold);
    }

    // ============ Core: Deposit ============

    function deposit(address asset, uint256 amount) external nonReentrant {
        Market storage market = markets[asset];
        require(market.active, "LendPool: market inactive");
        require(amount > 0, "LendPool: zero amount");

        _accrueInterest(asset);
        _accrueShapley(asset, msg.sender);

        UserPosition storage pos = positions[asset][msg.sender];

        // Settle any pending yield before updating position
        if (pos.deposited > 0) {
            uint256 pendingYield = _pendingSupplyYield(pos, market.supplyIndex);
            if (pendingYield > 0) {
                pos.deposited += pendingYield;
                // Yield stays in the pool as increased deposit
            }
        }

        pos.deposited += amount;
        pos.supplyIndex = market.supplyIndex;
        market.totalDeposits += amount;

        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);

        emit Deposit(msg.sender, asset, amount);
    }

    // ============ Core: Withdraw ============

    function withdraw(address asset, uint256 amount) external nonReentrant {
        Market storage market = markets[asset];
        require(market.active, "LendPool: market inactive");

        _accrueInterest(asset);
        _accrueShapley(asset, msg.sender);

        UserPosition storage pos = positions[asset][msg.sender];

        // Settle pending yield
        uint256 pendingYield = _pendingSupplyYield(pos, market.supplyIndex);
        if (pendingYield > 0) {
            pos.deposited += pendingYield;
        }
        pos.supplyIndex = market.supplyIndex;

        // Apply Shapley bonus
        uint256 bonus = _claimShapleyBonus(asset, msg.sender);
        if (bonus > 0) {
            pos.deposited += bonus;
        }

        require(amount <= pos.deposited, "LendPool: insufficient deposit");

        uint256 available = market.totalDeposits - market.totalBorrows;
        require(amount <= available, "LendPool: insufficient liquidity");

        pos.deposited -= amount;
        market.totalDeposits -= amount;

        // Check that withdrawal doesn't make user position unhealthy
        if (_hasDebt(msg.sender)) {
            require(_healthFactor(msg.sender) >= WAD, "LendPool: unhealthy after withdraw");
        }

        IERC20(asset).safeTransfer(msg.sender, amount);

        emit Withdraw(msg.sender, asset, amount);
    }

    // ============ Core: Borrow ============

    function borrow(address asset, uint256 amount) external nonReentrant {
        Market storage market = markets[asset];
        require(market.active, "LendPool: market inactive");
        require(amount > 0, "LendPool: zero amount");

        _accrueInterest(asset);

        UserPosition storage pos = positions[asset][msg.sender];

        // Settle pending interest before updating
        if (pos.borrowed > 0) {
            uint256 pendingDebt = _pendingBorrowInterest(pos, market.borrowIndex);
            pos.borrowed += pendingDebt;
        }

        pos.borrowed += amount;
        pos.borrowIndex = market.borrowIndex;
        market.totalBorrows += amount;

        uint256 available = market.totalDeposits - (market.totalBorrows - amount);
        require(amount <= available, "LendPool: insufficient liquidity");

        // Health check after borrow
        require(_healthFactor(msg.sender) >= WAD, "LendPool: unhealthy position");

        IERC20(asset).safeTransfer(msg.sender, amount);

        emit Borrow(msg.sender, asset, amount);
    }

    // ============ Core: Repay ============

    function repay(address asset, uint256 amount) external nonReentrant {
        Market storage market = markets[asset];
        require(market.active, "LendPool: market inactive");
        require(amount > 0, "LendPool: zero amount");

        _accrueInterest(asset);

        UserPosition storage pos = positions[asset][msg.sender];

        // Settle pending interest
        if (pos.borrowed > 0) {
            uint256 pendingDebt = _pendingBorrowInterest(pos, market.borrowIndex);
            pos.borrowed += pendingDebt;
        }
        pos.borrowIndex = market.borrowIndex;

        uint256 repayAmount = amount > pos.borrowed ? pos.borrowed : amount;
        require(repayAmount > 0, "LendPool: nothing to repay");

        pos.borrowed -= repayAmount;
        market.totalBorrows -= repayAmount;

        IERC20(asset).safeTransferFrom(msg.sender, address(this), repayAmount);

        emit Repay(msg.sender, asset, repayAmount);
    }

    // ============ Liquidation ============

    function liquidate(
        address borrower,
        address collateralAsset,
        address debtAsset
    ) external nonReentrant {
        require(borrower != msg.sender, "LendPool: self-liquidation");

        _accrueInterest(collateralAsset);
        _accrueInterest(debtAsset);

        // Settle borrower's pending interest on debt
        UserPosition storage debtPos = positions[debtAsset][borrower];
        Market storage debtMarket = markets[debtAsset];
        if (debtPos.borrowed > 0) {
            uint256 pendingDebt = _pendingBorrowInterest(debtPos, debtMarket.borrowIndex);
            debtPos.borrowed += pendingDebt;
        }
        debtPos.borrowIndex = debtMarket.borrowIndex;

        // Settle borrower's pending yield on collateral
        UserPosition storage collPos = positions[collateralAsset][borrower];
        Market storage collMarket = markets[collateralAsset];
        if (collPos.deposited > 0) {
            uint256 pendingYield = _pendingSupplyYield(collPos, collMarket.supplyIndex);
            collPos.deposited += pendingYield;
        }
        collPos.supplyIndex = collMarket.supplyIndex;

        require(_healthFactor(borrower) < WAD, "LendPool: position healthy");

        // Repay 50% of debt (close factor)
        uint256 debtToRepay = debtPos.borrowed / 2;
        if (debtToRepay == 0) debtToRepay = debtPos.borrowed;

        // Calculate collateral to seize: debtToRepay * (1 + liquidationBonus)
        // Simplified: assumes 1:1 price (real impl would use oracle)
        uint256 collateralToSeize = (debtToRepay * (BPS + collMarket.liquidationBonus)) / BPS;
        if (collateralToSeize > collPos.deposited) {
            collateralToSeize = collPos.deposited;
        }

        // Update state
        debtPos.borrowed -= debtToRepay;
        debtMarket.totalBorrows -= debtToRepay;

        collPos.deposited -= collateralToSeize;
        collMarket.totalDeposits -= collateralToSeize;

        // Transfer: liquidator pays debt, receives collateral
        IERC20(debtAsset).safeTransferFrom(msg.sender, address(this), debtToRepay);
        IERC20(collateralAsset).safeTransfer(msg.sender, collateralToSeize);

        emit Liquidation(
            msg.sender,
            borrower,
            collateralAsset,
            debtAsset,
            debtToRepay,
            collateralToSeize
        );
    }

    // ============ Flash Loans ============

    function flashLoan(
        address asset,
        uint256 amount,
        bytes calldata data
    ) external nonReentrant {
        Market storage market = markets[asset];
        require(market.active, "LendPool: market inactive");
        require(amount > 0, "LendPool: zero amount");

        uint256 balanceBefore = IERC20(asset).balanceOf(address(this));
        require(amount <= balanceBefore, "LendPool: insufficient liquidity");

        uint256 fee = (amount * FLASH_LOAN_FEE_BPS) / BPS;

        IERC20(asset).safeTransfer(msg.sender, amount);

        bool success = IFlashLoanReceiver(msg.sender).executeOperation(
            asset,
            amount,
            fee,
            data
        );
        require(success, "LendPool: flash loan callback failed");

        uint256 balanceAfter = IERC20(asset).balanceOf(address(this));
        require(balanceAfter >= balanceBefore + fee, "LendPool: flash loan not repaid");

        // Distribute fee: reserve portion + rest to depositors via supply index
        uint256 reservePortion = (fee * market.reserveFactor) / BPS;
        reserves[asset] += reservePortion;

        // Remaining fee increases total deposits (distributed to lenders via index)
        uint256 lenderFee = fee - reservePortion;
        market.totalDeposits += lenderFee;

        emit FlashLoan(msg.sender, asset, amount, fee);
    }

    // ============ View Functions ============

    function getHealthFactor(address user) external view returns (uint256) {
        return _healthFactor(user);
    }

    function getUtilization(address asset) external view returns (uint256) {
        return _utilization(asset);
    }

    function getInterestRate(address asset) external view returns (uint256) {
        return _interestRate(_utilization(asset));
    }

    function getMarket(address asset) external view returns (Market memory) {
        return markets[asset];
    }

    function getUserPosition(address asset, address user) external view returns (UserPosition memory) {
        return positions[asset][user];
    }

    function getMarketCount() external view returns (uint256) {
        return marketAssets.length;
    }

    // ============ Internal: Interest Accrual ============

    function _accrueInterest(address asset) internal {
        Market storage market = markets[asset];
        if (market.totalBorrows == 0) {
            market.lastAccrual = block.timestamp;
            return;
        }

        uint256 elapsed = block.timestamp - market.lastAccrual;
        if (elapsed == 0) return;

        uint256 utilization = _utilization(asset);
        uint256 annualRate = _interestRate(utilization);

        // Interest accrued = totalBorrows * rate * elapsed / SECONDS_PER_YEAR
        uint256 interestAccrued = (market.totalBorrows * annualRate * elapsed)
            / (WAD * SECONDS_PER_YEAR);

        if (interestAccrued == 0) {
            market.lastAccrual = block.timestamp;
            return;
        }

        // Update borrow index: newIndex = oldIndex * (1 + interest / totalBorrows)
        uint256 borrowIndexDelta = (interestAccrued * WAD) / market.totalBorrows;
        market.borrowIndex += (market.borrowIndex * borrowIndexDelta) / WAD;

        // Reserve cut
        uint256 reserveCut = (interestAccrued * market.reserveFactor) / BPS;
        reserves[asset] += reserveCut;

        uint256 lenderInterest = interestAccrued - reserveCut;

        // Update supply index: newIndex = oldIndex * (1 + lenderInterest / totalDeposits)
        if (market.totalDeposits > 0) {
            // Shapley bonus allocation: portion of lender interest goes to Shapley pool
            uint256 shapleyAlloc = (lenderInterest * SHAPLEY_BONUS_BPS) / BPS;
            uint256 proportionalInterest = lenderInterest - shapleyAlloc;

            uint256 supplyIndexDelta = (proportionalInterest * WAD) / market.totalDeposits;
            market.supplyIndex += (market.supplyIndex * supplyIndexDelta) / WAD;

            // Shapley allocation stays in reserves for weighted distribution
            reserves[asset] += shapleyAlloc;
        }

        market.totalBorrows += interestAccrued;
        market.totalDeposits += lenderInterest;
        market.lastAccrual = block.timestamp;
    }

    // ============ Internal: Interest Rate Model ============

    function _utilization(address asset) internal view returns (uint256) {
        Market storage market = markets[asset];
        if (market.totalDeposits == 0) return 0;
        return (market.totalBorrows * WAD) / market.totalDeposits;
    }

    function _interestRate(uint256 utilization) internal pure returns (uint256) {
        if (utilization <= OPTIMAL_UTILIZATION) {
            // base + (utilization / optimal) * slope1
            return BASE_RATE + (utilization * SLOPE_1) / OPTIMAL_UTILIZATION;
        } else {
            // base + slope1 + ((utilization - optimal) / (1 - optimal)) * slope2
            uint256 excessUtil = utilization - OPTIMAL_UTILIZATION;
            uint256 maxExcess = WAD - OPTIMAL_UTILIZATION;
            return BASE_RATE + SLOPE_1 + (excessUtil * SLOPE_2) / maxExcess;
        }
    }

    // ============ Internal: Pending Yield / Debt ============

    function _pendingSupplyYield(
        UserPosition storage pos,
        uint256 currentSupplyIndex
    ) internal view returns (uint256) {
        if (pos.supplyIndex == 0 || pos.deposited == 0) return 0;
        uint256 indexDelta = currentSupplyIndex - pos.supplyIndex;
        return (pos.deposited * indexDelta) / WAD;
    }

    function _pendingBorrowInterest(
        UserPosition storage pos,
        uint256 currentBorrowIndex
    ) internal view returns (uint256) {
        if (pos.borrowIndex == 0 || pos.borrowed == 0) return 0;
        uint256 indexDelta = currentBorrowIndex - pos.borrowIndex;
        return (pos.borrowed * indexDelta) / WAD;
    }

    // ============ Internal: Health Factor ============

    function _healthFactor(address user) internal view returns (uint256) {
        uint256 totalCollateralWeighted = 0;
        uint256 totalDebt = 0;

        for (uint256 i = 0; i < marketAssets.length; i++) {
            address asset = marketAssets[i];
            Market storage market = markets[asset];
            UserPosition storage pos = positions[asset][user];

            if (pos.deposited > 0) {
                // Collateral value weighted by liquidation threshold
                // Simplified: assumes 1:1 asset pricing (real impl uses oracle)
                totalCollateralWeighted += (pos.deposited * market.liquidationThreshold) / BPS;
            }

            if (pos.borrowed > 0) {
                // Include pending interest in debt calculation
                uint256 pendingDebt = _pendingBorrowInterest(pos, market.borrowIndex);
                totalDebt += pos.borrowed + pendingDebt;
            }
        }

        if (totalDebt == 0) return type(uint256).max;

        // healthFactor = totalCollateralWeighted / totalDebt (WAD-scaled)
        return (totalCollateralWeighted * WAD) / totalDebt;
    }

    function _hasDebt(address user) internal view returns (bool) {
        for (uint256 i = 0; i < marketAssets.length; i++) {
            if (positions[marketAssets[i]][user].borrowed > 0) return true;
        }
        return false;
    }

    // ============ Internal: Shapley Weighting ============

    /// @dev Accrue Shapley weight for a user: weight += deposit * elapsed * utilization
    function _accrueShapley(address asset, address user) internal {
        UserPosition storage pos = positions[asset][user];
        uint256 lastUpdate = shapleyLastUpdate[asset][user];

        if (lastUpdate > 0 && pos.deposited > 0) {
            uint256 elapsed = block.timestamp - lastUpdate;
            uint256 utilization = _utilization(asset);

            // Weight = deposit * time * utilization (higher util = more stability contribution)
            uint256 weight = (pos.deposited * elapsed * utilization) / WAD;

            shapleyWeights[asset][user] += weight;
            totalShapleyWeight[asset] += weight;
        }

        shapleyLastUpdate[asset][user] = block.timestamp;
    }

    /// @dev Claim Shapley bonus from reserves
    function _claimShapleyBonus(address asset, address user) internal returns (uint256) {
        uint256 userWeight = shapleyWeights[asset][user];
        uint256 totalWeight = totalShapleyWeight[asset];

        if (userWeight == 0 || totalWeight == 0) return 0;

        // User's share of the Shapley reserve pool
        uint256 shapleyReserve = reserves[asset];
        if (shapleyReserve == 0) return 0;

        // Only distribute a portion of reserves (cap at 50% to maintain buffer)
        uint256 distributable = shapleyReserve / 2;
        uint256 bonus = (distributable * userWeight) / totalWeight;

        if (bonus > 0) {
            reserves[asset] -= bonus;
            // Reset user's weight after claim
            totalShapleyWeight[asset] -= userWeight;
            shapleyWeights[asset][user] = 0;
        }

        return bonus;
    }

    // ============ Admin: Reserve Management ============

    function collectReserves(address asset, uint256 amount) external onlyOwner nonReentrant {
        require(amount <= reserves[asset], "LendPool: insufficient reserves");
        reserves[asset] -= amount;
        IERC20(asset).safeTransfer(msg.sender, amount);
        emit ReservesCollected(asset, amount);
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }
}
