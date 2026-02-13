// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IVibeLPNFT
 * @notice Interface for LP Position NFTs — ERC-721 receipts for VibeAMM liquidity positions
 */
interface IVibeLPNFT {
    // ============ Structs ============

    struct Position {
        bytes32 poolId;
        uint256 liquidity;          // VibeLP tokens held in custody
        uint256 amount0Deposited;   // Cumulative token0 deposited (adjusted on decrease)
        uint256 amount1Deposited;   // Cumulative token1 deposited (adjusted on decrease)
        uint256 entryPrice;         // Weight-averaged entry price (token1/token0, 1e18)
        uint64  createdAt;
        uint64  lastModifiedAt;
    }

    struct MintParams {
        bytes32 poolId;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    struct IncreaseLiquidityParams {
        uint256 tokenId;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    struct DecreaseLiquidityParams {
        uint256 tokenId;
        uint256 liquidityAmount;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    struct CollectParams {
        uint256 tokenId;
        address recipient;
    }

    // ============ Events ============

    event PositionMinted(
        uint256 indexed tokenId,
        bytes32 indexed poolId,
        address indexed recipient,
        uint256 liquidity,
        uint256 amount0,
        uint256 amount1
    );

    event LiquidityIncreased(
        uint256 indexed tokenId,
        uint256 liquidity,
        uint256 amount0,
        uint256 amount1
    );

    event LiquidityDecreased(
        uint256 indexed tokenId,
        uint256 liquidity,
        uint256 amount0,
        uint256 amount1
    );

    event TokensCollected(
        uint256 indexed tokenId,
        address indexed recipient,
        uint256 amount0,
        uint256 amount1
    );

    event PositionBurned(uint256 indexed tokenId);

    // ============ Errors ============

    error DeadlineExpired();
    error InvalidPool();
    error ZeroRecipient();
    error ZeroLiquidity();
    error ExceedsPositionLiquidity();
    error PositionNotEmpty();
    error TokensStillOwed();
    error NoTokensOwed();

    // ============ Functions ============

    function mint(MintParams calldata params)
        external
        returns (uint256 tokenId, uint256 liquidity, uint256 amount0, uint256 amount1);

    function increaseLiquidity(IncreaseLiquidityParams calldata params)
        external
        returns (uint256 liquidity, uint256 amount0, uint256 amount1);

    function decreaseLiquidity(DecreaseLiquidityParams calldata params)
        external
        returns (uint256 amount0, uint256 amount1);

    function collect(CollectParams calldata params)
        external
        returns (uint256 amount0, uint256 amount1);

    function burn(uint256 tokenId) external;

    // ============ View Functions ============

    function getPosition(uint256 tokenId) external view returns (Position memory);

    function getPositionValue(uint256 tokenId) external view returns (uint256 amount0, uint256 amount1);

    function getFeesEarned(uint256 tokenId) external view returns (uint256 fees0, uint256 fees1);

    function getPositionsByOwner(address owner) external view returns (uint256[] memory);

    function getTokensOwed(uint256 tokenId) external view returns (uint256 amount0Owed, uint256 amount1Owed);

    function totalPositions() external view returns (uint256);
}
