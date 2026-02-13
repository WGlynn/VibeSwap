// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IwBAR
 * @notice Interface for Wrapped Batch Auction Receipts
 * @dev wBAR tokens represent pending auction positions. Tradeable during COMMIT phase,
 *      redeemable for output tokens after settlement.
 */
interface IwBAR {
    // ============ Structs ============

    struct Position {
        bytes32 commitId;
        uint64 batchId;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minAmountOut;
        address holder;
        address committer;
        bool settled;
        bool redeemed;
        uint256 amountOut;
    }

    // ============ Events ============

    event PositionMinted(bytes32 indexed commitId, address indexed holder, uint64 indexed batchId, uint256 amountIn);
    event PositionTransferred(bytes32 indexed commitId, address indexed from, address indexed to);
    event PositionSettled(bytes32 indexed commitId, uint256 amountOut);
    event PositionRedeemed(bytes32 indexed commitId, address indexed holder, uint256 amountOut);
    event PositionReclaimed(bytes32 indexed commitId, address indexed holder, uint256 amountIn);

    // ============ Errors ============

    error TransferRestricted();
    error NotPositionHolder();
    error PositionNotSettled();
    error PositionAlreadyRedeemed();
    error PositionAlreadySettled();
    error InvalidPhaseForTransfer();
    error PositionDoesNotExist();

    // ============ Functions ============

    function mint(
        bytes32 commitId,
        uint64 batchId,
        address holder,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) external;

    function settle(bytes32 commitId, uint256 amountOut) external;

    function redeem(bytes32 commitId) external;

    function reclaimFailed(bytes32 commitId) external;

    function transferPosition(bytes32 commitId, address to) external;

    function getPosition(bytes32 commitId) external view returns (Position memory);

    function getHeldPositions(address holder) external view returns (bytes32[] memory);

    function holderOf(bytes32 commitId) external view returns (address);
}
