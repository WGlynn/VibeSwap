// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IVibeCredit
 * @notice Interface for P2P reputation-gated credit delegation — ERC-721 NFTs
 *         representing transferable credit line positions.
 *
 *         Part of the VSOS (VibeSwap Operating System) Financial Primitives layer.
 *
 *         Delegators deposit tokens and set borrowing terms. Borrowers draw funds
 *         up to a credit limit determined by their ReputationOracle trust tier.
 *         Higher tier = higher LTV = more borrowing power.
 *
 *         Key innovation: undercollateralised lending gated by on-chain reputation
 *         instead of overcollateralisation (Aave/Compound model).
 */
interface IVibeCredit {
    // ============ Enums ============

    enum CreditState {
        ACTIVE,     // Credit line open, borrower can draw
        REPAID,     // Fully repaid by borrower
        DEFAULTED,  // Liquidated due to trust drop / debt exceeded / maturity
        CLOSED      // Delegator reclaimed after repay/expiry
    }

    // ============ Structs ============

    /// @notice Credit line data — storage-packed
    struct CreditLine {
        // Slot 0 (22/32 bytes)
        address delegator;          // 20 bytes — lender who deposits collateral
        CreditState state;          // 1 byte
        uint8 minTrustTier;         // 1 byte — required borrower reputation tier

        // Slot 1 (30/32 bytes)
        address borrower;           // 20 bytes — who can borrow
        uint40 createdAt;           // 5 bytes
        uint40 maturity;            // 5 bytes — expiry timestamp

        // Slot 2 (27/32 bytes)
        address token;              // 20 bytes — denomination ERC-20
        uint40 lastAccrual;         // 5 bytes — last interest computation
        uint16 interestRate;        // 2 bytes — annual rate in BPS (max 655%)

        // Slot 3 (32/32 bytes)
        uint256 principal;          // initial deposit by delegator (immutable)

        // Slot 4 (32/32 bytes)
        uint256 borrowed;           // current debt (increases with interest)

        // Slot 5 (32/32 bytes)
        uint256 tokensHeld;         // actual tokens in contract for this line
    }

    /// @notice Parameters for creating a new credit line
    struct CreateCreditLineParams {
        address borrower;           // who can borrow
        address token;              // ERC-20 denomination
        uint256 amount;             // deposit amount (becomes principal)
        uint16 interestRate;        // annual rate in BPS
        uint8 minTrustTier;         // minimum borrower tier (0-4)
        uint40 maturity;            // expiry timestamp
    }

    // ============ Events ============

    event CreditLineCreated(
        uint256 indexed creditLineId,
        address indexed delegator,
        address indexed borrower,
        address token,
        uint256 principal,
        uint16 interestRate,
        uint8 minTrustTier,
        uint40 maturity
    );

    event Borrowed(
        uint256 indexed creditLineId,
        address indexed borrower,
        uint256 amount
    );

    event Repaid(
        uint256 indexed creditLineId,
        address indexed borrower,
        uint256 amount,
        uint256 remainingDebt
    );

    event CreditLineRepaid(uint256 indexed creditLineId);

    event CreditLineLiquidated(
        uint256 indexed creditLineId,
        address indexed liquidator,
        address indexed borrower,
        uint256 remainingTokens,
        uint256 badDebt
    );

    event CreditLineClosed(uint256 indexed creditLineId, address indexed delegator);

    event CollateralReclaimed(
        uint256 indexed creditLineId,
        address indexed delegator,
        uint256 amount
    );

    event InterestAccrued(
        uint256 indexed creditLineId,
        uint256 interest,
        uint256 newDebt
    );

    event JulRewardsDeposited(address indexed depositor, uint256 amount);

    // ============ Errors ============

    error ZeroAddress();
    error ZeroAmount();
    error InvalidMaturity();
    error InvalidTier();
    error InvalidInterestRate();
    error NotBorrower();
    error NotDelegator();
    error NotActiveState();
    error ExceedsCreditLimit();
    error InsufficientReputation();
    error AlreadyRepaid();
    error NotLiquidatable();
    error NotRepaidOrDefaulted();
    error HasOutstandingDebt();
    error PastMaturity();
    error InsufficientJulRewards();
    error NothingToRepay();

    // ============ Delegator Functions ============

    function createCreditLine(CreateCreditLineParams calldata params) external returns (uint256 creditLineId);
    function reclaimCollateral(uint256 creditLineId) external;
    function closeCreditLine(uint256 creditLineId) external;

    // ============ Borrower Functions ============

    function borrow(uint256 creditLineId, uint256 amount) external;
    function repay(uint256 creditLineId, uint256 amount) external;

    // ============ Keeper Functions ============

    function liquidate(uint256 creditLineId) external;

    // ============ Admin Functions ============

    function depositJulRewards(uint256 amount) external;

    // ============ View Functions ============

    function getCreditLine(uint256 creditLineId) external view returns (CreditLine memory);
    function creditLimit(uint256 creditLineId) external view returns (uint256);
    function totalDebt(uint256 creditLineId) external view returns (uint256);
    function accruedInterest(uint256 creditLineId) external view returns (uint256);
    function isLiquidatable(uint256 creditLineId) external view returns (bool);
    function borrowerDefaults(address borrower) external view returns (uint256);
    function ltvForTier(uint8 tier) external pure returns (uint256);
    function totalCreditLines() external view returns (uint256);
}
