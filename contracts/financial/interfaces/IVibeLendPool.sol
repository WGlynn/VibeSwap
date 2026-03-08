// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IFlashLoanReceiver {
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 fee,
        bytes calldata data
    ) external returns (bool);
}

interface IVibeLendPool {
    // ============ Structs ============

    struct Market {
        address asset;
        uint256 totalDeposits;
        uint256 totalBorrows;
        uint256 reserveFactor;        // BPS — portion to insurance
        uint256 ltvBps;               // Loan-to-value ratio
        uint256 liquidationThreshold; // BPS — threshold for liquidation
        uint256 liquidationBonus;     // BPS — bonus for liquidators
        uint256 lastAccrual;
        uint256 borrowIndex;          // Accumulator for interest
        uint256 supplyIndex;          // Accumulator for yield
        bool active;
    }

    struct UserPosition {
        uint256 deposited;
        uint256 borrowed;
        uint256 borrowIndex;  // snapshot at last interaction
        uint256 supplyIndex;  // snapshot at last interaction
    }

    // ============ Events ============

    event MarketCreated(address indexed asset, uint256 ltvBps, uint256 liquidationThreshold);
    event Deposit(address indexed user, address indexed asset, uint256 amount);
    event Withdraw(address indexed user, address indexed asset, uint256 amount);
    event Borrow(address indexed user, address indexed asset, uint256 amount);
    event Repay(address indexed user, address indexed asset, uint256 amount);
    event Liquidation(
        address indexed liquidator,
        address indexed borrower,
        address collateralAsset,
        address debtAsset,
        uint256 debtRepaid,
        uint256 collateralSeized
    );
    event FlashLoan(address indexed receiver, address indexed asset, uint256 amount, uint256 fee);
    event ReservesCollected(address indexed asset, uint256 amount);

    // ============ Functions ============

    function createMarket(
        address asset,
        uint256 ltvBps,
        uint256 liquidationThreshold,
        uint256 liquidationBonus,
        uint256 reserveFactor
    ) external;

    function deposit(address asset, uint256 amount) external;
    function withdraw(address asset, uint256 amount) external;
    function borrow(address asset, uint256 amount) external;
    function repay(address asset, uint256 amount) external;

    function liquidate(
        address borrower,
        address collateralAsset,
        address debtAsset
    ) external;

    function flashLoan(
        address asset,
        uint256 amount,
        bytes calldata data
    ) external;

    function getHealthFactor(address user) external view returns (uint256);
    function getUtilization(address asset) external view returns (uint256);
    function getInterestRate(address asset) external view returns (uint256);
}
