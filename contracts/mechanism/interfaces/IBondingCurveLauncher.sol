// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IBondingCurveLauncher {

    // ============ Enums ============

    enum LaunchState { ACTIVE, GRADUATED, FAILED }

    // ============ Structs ============

    struct TokenLaunch {
        address token;
        address reserveToken;
        address creator;
        uint256 initialPrice;
        uint256 curveSlope;
        uint256 tokensSold;
        uint256 reserveBalance;
        uint256 graduationTarget;
        uint256 maxSupply;
        uint16 creatorFeeBps;
        LaunchState state;
    }

    // ============ Events ============

    event LaunchCreated(uint256 indexed launchId, address indexed token, address indexed creator, uint256 graduationTarget);
    event TokensBought(uint256 indexed launchId, address indexed buyer, uint256 amount, uint256 cost);
    event TokensSold(uint256 indexed launchId, address indexed seller, uint256 amount, uint256 proceeds);
    event LaunchGraduated(uint256 indexed launchId, uint256 reserveBalance);
    event LaunchFailed(uint256 indexed launchId);
    event RefundClaimed(uint256 indexed launchId, address indexed user, uint256 amount);

    // ============ Errors ============

    error ZeroAmount();
    error ZeroAddress();
    error LaunchNotActive();
    error LaunchNotFailed();
    error LaunchNotGraduated();
    error ExceedsMaxSupply();
    error InsufficientTokens();
    error FeeTooHigh();
    error NothingToRefund();
    error AlreadyGraduated();
    error SlippageExceeded();
    error InvalidParams();

    // ============ Core ============

    function createLaunch(
        address token,
        address reserveToken,
        uint256 initialPrice,
        uint256 curveSlope,
        uint256 graduationTarget,
        uint256 maxSupply,
        uint16 creatorFeeBps
    ) external returns (uint256 launchId);

    function buy(uint256 launchId, uint256 tokenAmount, uint256 maxCost) external;
    function sell(uint256 launchId, uint256 tokenAmount, uint256 minProceeds) external;
    function graduate(uint256 launchId) external;
    function refund(uint256 launchId) external;

    // ============ Views ============

    function currentPrice(uint256 launchId) external view returns (uint256);
    function buyQuote(uint256 launchId, uint256 tokenAmount) external view returns (uint256 cost);
    function sellQuote(uint256 launchId, uint256 tokenAmount) external view returns (uint256 proceeds);
    function getLaunch(uint256 launchId) external view returns (TokenLaunch memory);
    function getUserDeposit(uint256 launchId, address user) external view returns (uint256);
    function launchCount() external view returns (uint256);
}
