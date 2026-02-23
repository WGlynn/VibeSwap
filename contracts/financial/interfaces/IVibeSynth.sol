// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IVibeSynth
 * @notice Interface for ERC-721 synthetic asset positions — collateralized exposure
 *         to any asset (BTC, gold, TSLA, etc.) priced via oracle infrastructure.
 *
 *         Part of VSOS (VibeSwap Operating System) Financial Primitives.
 *
 *         Co-op capitalist innovation: ReputationOracle trust tiers gate collateral
 *         requirements — higher reputation = lower minimum C-ratio. Democratizes
 *         access to synthetic asset exposure without traditional brokerages.
 *
 *         Position NFTs are transferable, creating a secondary market for synthetic
 *         exposure. Liquidation penalties flow to the protocol (mutualized), not
 *         to extractive liquidation bots.
 */
interface IVibeSynth {
    // ============ Enums ============

    enum PositionState {
        ACTIVE,       // Position open, can mint/burn
        CLOSED,       // Fully unwound by minter
        LIQUIDATED    // Forcibly closed due to undercollateralization
    }

    // ============ Structs ============

    /// @notice Registered synthetic asset definition
    struct SynthAsset {
        string name;                    // e.g., "Synthetic Bitcoin"
        string symbol;                  // e.g., "vBTC"
        uint256 currentPrice;           // price in collateral units, 1e18
        uint256 totalMinted;            // total synth units outstanding
        uint16 minCRatioBps;            // minimum collateral ratio (15000 = 150%)
        uint16 liquidationCRatioBps;    // liquidation threshold (12000 = 120%)
        uint16 liquidationPenaltyBps;   // penalty on liquidation (1000 = 10%)
        uint40 lastPriceUpdate;         // timestamp of last oracle update
        bool active;                    // can mint new positions
    }

    /// @notice Synthetic position data — storage-packed
    struct SynthPosition {
        // Slot 0 (22/32 bytes)
        address minter;             // 20 bytes — position owner
        PositionState state;        // 1 byte
        uint8 synthAssetId;         // 1 byte — which synth asset

        // Slot 1 (10/32 bytes)
        uint40 createdAt;           // 5 bytes
        uint40 lastUpdate;          // 5 bytes

        // Slot 2 (32/32 bytes)
        uint256 collateralAmount;   // collateral deposited

        // Slot 3 (32/32 bytes)
        uint256 mintedAmount;       // synth units minted (= debt)
    }

    /// @notice Parameters for registering a new synth asset
    struct RegisterSynthParams {
        string name;
        string symbol;
        uint256 initialPrice;
        uint16 minCRatioBps;
        uint16 liquidationCRatioBps;
        uint16 liquidationPenaltyBps;
    }

    // ============ Events ============

    event SynthAssetRegistered(
        uint8 indexed synthAssetId,
        string name,
        string symbol,
        uint16 minCRatioBps,
        uint16 liquidationCRatioBps
    );

    event SynthAssetDeactivated(uint8 indexed synthAssetId);

    event PriceUpdated(
        uint8 indexed synthAssetId,
        uint256 oldPrice,
        uint256 newPrice
    );

    event PositionOpened(
        uint256 indexed positionId,
        address indexed minter,
        uint8 indexed synthAssetId,
        uint256 collateralAmount
    );

    event SynthMinted(
        uint256 indexed positionId,
        uint256 amount,
        uint256 newDebt
    );

    event SynthBurned(
        uint256 indexed positionId,
        uint256 amount,
        uint256 newDebt
    );

    event CollateralAdded(
        uint256 indexed positionId,
        uint256 amount,
        uint256 newCollateral
    );

    event CollateralWithdrawn(
        uint256 indexed positionId,
        uint256 amount,
        uint256 newCollateral
    );

    event PositionClosed(
        uint256 indexed positionId,
        address indexed minter,
        uint256 collateralReturned
    );

    event PositionLiquidated(
        uint256 indexed positionId,
        address indexed liquidator,
        address indexed minter,
        uint256 debtValue,
        uint256 penalty,
        uint256 collateralReturned
    );

    event JulRewardsDeposited(address indexed depositor, uint256 amount);
    event PriceSetterUpdated(address indexed setter, bool authorized);
    event MaxPriceJumpUpdated(uint16 oldBps, uint16 newBps);

    // ============ Errors ============

    error ZeroAddress();
    error ZeroAmount();
    error InvalidCRatio();
    error InvalidLiquidationParams();
    error InvalidPrice();
    error SynthAssetNotActive();
    error MaxSynthAssetsReached();
    error NotPositionOwner();
    error NotActivePosition();
    error BelowMinCRatio();
    error ExceedsMintedAmount();
    error NotLiquidatable();
    error HasOutstandingDebt();
    error NotAuthorizedPriceSetter();
    error InvalidSynthAsset();
    error PriceJumpExceeded();
    error InvalidJumpLimit();

    // ============ Admin Functions ============

    function registerSynthAsset(RegisterSynthParams calldata params) external returns (uint8 synthAssetId);
    function deactivateSynthAsset(uint8 synthAssetId) external;
    function updatePrice(uint8 synthAssetId, uint256 newPrice) external;
    function setPriceSetter(address setter, bool authorized) external;
    function setMaxPriceJump(uint16 bps) external;
    function depositJulRewards(uint256 amount) external;
    function withdrawProtocolRevenue(uint256 amount) external;

    // ============ User Functions ============

    function openPosition(uint8 synthAssetId, uint256 collateralAmount) external returns (uint256 positionId);
    function mintSynth(uint256 positionId, uint256 synthAmount) external;
    function burnSynth(uint256 positionId, uint256 synthAmount) external;
    function addCollateral(uint256 positionId, uint256 amount) external;
    function withdrawCollateral(uint256 positionId, uint256 amount) external;
    function closePosition(uint256 positionId) external;

    // ============ Keeper Functions ============

    function liquidate(uint256 positionId) external;

    // ============ View Functions ============

    function getPosition(uint256 positionId) external view returns (SynthPosition memory);
    function getSynthAsset(uint8 synthAssetId) external view returns (SynthAsset memory);
    function collateralRatio(uint256 positionId) external view returns (uint256);
    function isLiquidatable(uint256 positionId) external view returns (bool);
    function effectiveMinCRatio(uint8 synthAssetId, address user) external view returns (uint256);
    function totalPositions() external view returns (uint256);
    function totalSynthAssets() external view returns (uint8);
}
