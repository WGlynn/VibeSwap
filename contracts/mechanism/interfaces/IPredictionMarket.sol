// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IPredictionMarket {

    // ============ Enums ============

    enum MarketOutcome { UNRESOLVED, YES, NO }
    enum MarketPhase { OPEN, LOCKED, RESOLVED }

    // ============ Structs ============

    struct PredictionMarketData {
        bytes32 question;
        address collateralToken;
        address creator;
        uint64 lockTime;
        uint64 resolutionDeadline;
        MarketPhase phase;
        MarketOutcome outcome;
        uint256 yPool;
        uint256 nPool;
        uint256 totalSets;
        uint256 liquidityParam;
    }

    struct Position {
        uint256 yesShares;
        uint256 noShares;
        bool claimed;
    }

    // ============ Events ============

    event MarketCreated(uint256 indexed marketId, bytes32 question, address indexed creator, uint64 lockTime);
    event SharesBought(uint256 indexed marketId, address indexed buyer, bool isYes, uint256 shares, uint256 cost);
    event SharesSold(uint256 indexed marketId, address indexed seller, bool isYes, uint256 shares, uint256 proceeds);
    event MarketResolved(uint256 indexed marketId, MarketOutcome outcome);
    event WinningsClaimed(uint256 indexed marketId, address indexed user, uint256 amount);
    event LiquidityReclaimed(uint256 indexed marketId, address indexed creator, uint256 amount);

    // ============ Errors ============

    error ZeroAmount();
    error ZeroAddress();
    error MarketNotOpen();
    error MarketNotResolved();
    error MarketNotLocked();
    error NotResolver();
    error AlreadyClaimed();
    error NoWinnings();
    error InsufficientTokens();
    error SlippageExceeded();
    error InvalidParams();
    error InvalidOutcome();
    error MarketAlreadyResolved();
    error NotCreator();
    error DeadlineNotReached();

    // ============ Core ============

    function createMarket(
        bytes32 question,
        address collateralToken,
        uint256 liquidityParam,
        uint64 lockTime,
        uint64 resolutionDeadline
    ) external returns (uint256 marketId);

    function buyShares(uint256 marketId, bool isYes, uint256 collateralAmount, uint256 minShares) external;
    function sellShares(uint256 marketId, bool isYes, uint256 shareAmount, uint256 minProceeds) external;
    function resolveMarket(uint256 marketId, MarketOutcome outcome) external;
    function claimWinnings(uint256 marketId) external;
    function reclaimLiquidity(uint256 marketId) external;

    // ============ Views ============

    function getPrice(uint256 marketId, bool isYes) external view returns (uint256);
    function getMarket(uint256 marketId) external view returns (PredictionMarketData memory);
    function getPosition(uint256 marketId, address user) external view returns (Position memory);
    function marketCount() external view returns (uint256);
}
