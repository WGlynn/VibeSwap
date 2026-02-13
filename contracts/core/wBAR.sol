// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IwBAR.sol";
import "./interfaces/ICommitRevealAuction.sol";

/**
 * @title wBAR - Wrapped Batch Auction Receipts
 * @notice ERC-20 token representing a pending auction position
 * @dev When a user commits a swap, they receive wBAR tokens. These are tradeable
 *      during the COMMIT phase, creating a pre-settlement market. After settlement,
 *      the wBAR holder redeems for the output tokens.
 *
 *      Standard ERC-20 transfer() is disabled. Positions must be transferred via
 *      transferPosition(commitId, to) which enforces phase restrictions.
 */
contract wBAR is ERC20, Ownable, ReentrancyGuard, IwBAR {
    using SafeERC20 for IERC20;

    // ============ State ============

    /// @notice Position data per commitId
    mapping(bytes32 => Position) public positions;

    /// @notice CommitIds held per address
    mapping(address => bytes32[]) internal _heldPositions;

    /// @notice Index of commitId in holder's array (for O(1) removal)
    mapping(bytes32 => uint256) internal _positionIndex;

    /// @notice Auction contract for phase checks
    ICommitRevealAuction public immutable auction;

    /// @notice VibeSwapCore address (for reclaimFailed callbacks)
    address public immutable vibeSwapCore;

    // ============ Internal Tracking ============

    /// @notice Flag to allow mint/burn operations to bypass transfer restriction
    bool private _minting;

    // ============ Constructor ============

    constructor(
        address _auction,
        address _vibeSwapCore
    ) ERC20("Wrapped Batch Auction Receipt", "wBAR") Ownable(_vibeSwapCore) {
        require(_auction != address(0), "Invalid auction");
        require(_vibeSwapCore != address(0), "Invalid core");
        auction = ICommitRevealAuction(_auction);
        vibeSwapCore = _vibeSwapCore;
    }

    // ============ ERC-20 Override ============

    /**
     * @notice Override _update to block standard ERC-20 transfers
     * @dev Only allows mint (from == 0) and burn (to == 0) operations.
     *      All position transfers must go through transferPosition().
     */
    function _update(address from, address to, uint256 value) internal override {
        if (!_minting) {
            revert TransferRestricted();
        }
        super._update(from, to, value);
    }

    // ============ Core Functions ============

    /**
     * @notice Mint wBAR for a new auction commitment
     * @param commitId Unique commitment ID
     * @param batchId Batch this position belongs to
     * @param holder Initial holder (the committer)
     * @param tokenIn Token being sold
     * @param tokenOut Token being bought
     * @param amountIn Amount of tokenIn committed
     * @param minAmountOut Minimum acceptable output
     */
    function mint(
        bytes32 commitId,
        uint64 batchId,
        address holder,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) external onlyOwner {
        require(positions[commitId].holder == address(0), "Already minted");

        positions[commitId] = Position({
            commitId: commitId,
            batchId: batchId,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: amountIn,
            minAmountOut: minAmountOut,
            holder: holder,
            committer: holder,
            settled: false,
            redeemed: false,
            amountOut: 0
        });

        // Track in holder's array
        _positionIndex[commitId] = _heldPositions[holder].length;
        _heldPositions[holder].push(commitId);

        // Mint ERC-20 tokens
        _minting = true;
        _mint(holder, amountIn);
        _minting = false;

        emit PositionMinted(commitId, holder, batchId, amountIn);
    }

    /**
     * @notice Transfer a position to a new holder
     * @dev Only allowed during COMMIT phase for the position's batch.
     *      Burns wBAR from sender, mints to receiver.
     * @param commitId Position to transfer
     * @param to New holder
     */
    function transferPosition(bytes32 commitId, address to) external nonReentrant {
        Position storage pos = positions[commitId];
        if (pos.holder == address(0)) revert PositionDoesNotExist();
        if (pos.holder != msg.sender) revert NotPositionHolder();
        if (pos.settled || pos.redeemed) revert PositionAlreadySettled();
        require(to != address(0), "Invalid recipient");
        require(to != msg.sender, "Self transfer");

        // Phase check: only allow during COMMIT phase
        _requireCommitPhase(pos.batchId);

        uint256 amount = pos.amountIn;

        // Update position holder
        pos.holder = to;

        // Update held positions arrays
        _removeFromHeldPositions(msg.sender, commitId);
        _positionIndex[commitId] = _heldPositions[to].length;
        _heldPositions[to].push(commitId);

        // Burn from sender, mint to receiver
        _minting = true;
        _burn(msg.sender, amount);
        _mint(to, amount);
        _minting = false;

        emit PositionTransferred(commitId, msg.sender, to);
    }

    /**
     * @notice Record settlement output for a position
     * @dev Called by VibeSwapCore after AMM execution. The tokenOut is already
     *      held by this contract (AMM sends it here when holder != committer).
     * @param commitId Position that was settled
     * @param amountOut Amount of tokenOut received
     */
    function settle(bytes32 commitId, uint256 amountOut) external onlyOwner {
        Position storage pos = positions[commitId];
        if (pos.holder == address(0)) revert PositionDoesNotExist();
        if (pos.settled) revert PositionAlreadySettled();

        pos.settled = true;
        pos.amountOut = amountOut;

        emit PositionSettled(commitId, amountOut);
    }

    /**
     * @notice Redeem settled position for output tokens
     * @dev Burns wBAR, transfers tokenOut from this contract to holder.
     * @param commitId Position to redeem
     */
    function redeem(bytes32 commitId) external nonReentrant {
        Position storage pos = positions[commitId];
        if (pos.holder == address(0)) revert PositionDoesNotExist();
        if (pos.holder != msg.sender) revert NotPositionHolder();
        if (!pos.settled) revert PositionNotSettled();
        if (pos.redeemed) revert PositionAlreadyRedeemed();

        pos.redeemed = true;
        uint256 amountOut = pos.amountOut;

        // Burn the wBAR tokens
        _minting = true;
        _burn(msg.sender, pos.amountIn);
        _minting = false;

        // Remove from held positions
        _removeFromHeldPositions(msg.sender, commitId);

        // Transfer output tokens
        if (amountOut > 0) {
            IERC20(pos.tokenOut).safeTransfer(msg.sender, amountOut);
        }

        emit PositionRedeemed(commitId, msg.sender, amountOut);
    }

    /**
     * @notice Reclaim tokenIn for a failed swap
     * @dev Burns wBAR, calls VibeSwapCore to release the original deposit.
     * @param commitId Position to reclaim
     */
    function reclaimFailed(bytes32 commitId) external nonReentrant {
        Position storage pos = positions[commitId];
        if (pos.holder == address(0)) revert PositionDoesNotExist();
        if (pos.holder != msg.sender) revert NotPositionHolder();
        if (pos.settled) revert PositionAlreadySettled();
        if (pos.redeemed) revert PositionAlreadyRedeemed();

        pos.redeemed = true;

        // Burn the wBAR tokens
        _minting = true;
        _burn(msg.sender, pos.amountIn);
        _minting = false;

        // Remove from held positions
        _removeFromHeldPositions(msg.sender, commitId);

        // Call VibeSwapCore to release the original deposit to the current holder
        IVibeSwapCoreRelease(vibeSwapCore).releaseFailedDeposit(
            commitId,
            msg.sender,
            pos.tokenIn,
            pos.amountIn
        );

        emit PositionReclaimed(commitId, msg.sender, pos.amountIn);
    }

    // ============ View Functions ============

    function getPosition(bytes32 commitId) external view returns (Position memory) {
        return positions[commitId];
    }

    function getHeldPositions(address holder) external view returns (bytes32[] memory) {
        return _heldPositions[holder];
    }

    function holderOf(bytes32 commitId) external view returns (address) {
        return positions[commitId].holder;
    }

    // ============ Internal Functions ============

    /**
     * @notice Check that the position's batch is in COMMIT phase
     */
    function _requireCommitPhase(uint64 batchId) internal view {
        uint64 currentBatchId = auction.getCurrentBatchId();

        if (batchId == currentBatchId) {
            // Current batch — must be in COMMIT phase
            ICommitRevealAuction.BatchPhase phase = auction.getCurrentPhase();
            if (phase != ICommitRevealAuction.BatchPhase.COMMIT) {
                revert InvalidPhaseForTransfer();
            }
        } else if (batchId < currentBatchId) {
            // Older batch — check it's fully settled
            ICommitRevealAuction.Batch memory batch = auction.getBatch(batchId);
            if (batch.phase != ICommitRevealAuction.BatchPhase.SETTLED) {
                revert InvalidPhaseForTransfer();
            }
        } else {
            // Future batch — shouldn't happen
            revert InvalidPhaseForTransfer();
        }
    }

    /**
     * @notice Remove a commitId from a holder's array (O(1) swap-and-pop)
     */
    function _removeFromHeldPositions(address holder, bytes32 commitId) internal {
        uint256 idx = _positionIndex[commitId];
        uint256 lastIdx = _heldPositions[holder].length - 1;

        if (idx != lastIdx) {
            bytes32 lastCommitId = _heldPositions[holder][lastIdx];
            _heldPositions[holder][idx] = lastCommitId;
            _positionIndex[lastCommitId] = idx;
        }

        _heldPositions[holder].pop();
        delete _positionIndex[commitId];
    }
}

/**
 * @notice Minimal interface for VibeSwapCore's releaseFailedDeposit
 */
interface IVibeSwapCoreRelease {
    function releaseFailedDeposit(bytes32 commitId, address to, address token, uint256 amount) external;
}
