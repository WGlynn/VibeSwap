// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IVibeStream.sol";
import "../libraries/PairwiseFairness.sol";

/**
 * @title VibeStream
 * @notice ERC-721 streaming payments — continuous token flows as transferable NFTs
 * @dev Each stream is a linear flow from sender to recipient (NFT holder) with
 *      optional cliff. Amounts are computed lazily on-demand from time params,
 *      requiring zero per-block storage updates.
 *
 *      Use cases: salary payments, subscription fees, token vesting.
 *      Streams are fully funded upfront. The NFT holder controls withdrawals.
 *      The original sender controls cancelation (if the stream is cancelable).
 */
contract VibeStream is ERC721, Ownable, ReentrancyGuard, IVibeStream {
    using SafeERC20 for IERC20;

    // ============ State ============

    /// @notice Next stream ID (starts at 1)
    uint256 private _nextStreamId = 1;

    /// @notice Stream data per stream ID
    mapping(uint256 => Stream) private _streams;

    /// @notice Stream IDs owned by each address (for enumeration)
    mapping(address => uint256[]) private _ownedStreams;

    /// @notice Index of stream ID in owner's _ownedStreams array (for O(1) removal)
    mapping(uint256 => uint256) private _ownedStreamIndex;

    /// @notice Stream IDs created by each sender (for lookup)
    mapping(address => uint256[]) private _senderStreams;

    /// @notice Total streams ever created
    uint256 private _totalStreams;

    // ============ FundingPool State ============

    /// @notice Next pool ID (counts DOWN from max to avoid collision with stream IDs)
    uint256 private _nextPoolId = type(uint256).max;

    /// @notice Pool data per pool ID
    mapping(uint256 => FundingPool) private _pools;

    /// @notice Recipient list per pool
    mapping(uint256 => address[]) private _poolRecipients;

    /// @notice Quick recipient membership check
    mapping(uint256 => mapping(address => bool)) private _isRecipient;

    /// @notice Conviction aggregates per pool per recipient
    mapping(uint256 => mapping(address => ConvictionAggregate)) private _convictionAgg;

    /// @notice Individual voter signals: poolId → recipient → voter → VoterSignal
    mapping(uint256 => mapping(address => mapping(address => VoterSignal))) private _voterSignals;

    /// @notice Amount already withdrawn by each recipient from a pool
    mapping(uint256 => mapping(address => uint128)) private _recipientWithdrawn;

    /// @notice Pools created by each creator (for enumeration)
    mapping(address => uint256[]) private _creatorPools;

    // ============ Constructor ============

    constructor() ERC721("VibeSwap Stream", "VSTREAM") Ownable(msg.sender) {}

    // ============ Core Functions ============

    /**
     * @notice Create a new stream, minting an NFT to the recipient
     * @dev Pulls tokens from msg.sender upfront. The NFT holder is the recipient.
     * @param params CreateParams with recipient, token, amount, times, cliff, cancelable
     * @return streamId The minted stream NFT token ID
     */
    function createStream(CreateParams calldata params)
        external
        nonReentrant
        returns (uint256 streamId)
    {
        if (params.recipient == address(0)) revert ZeroRecipient();
        if (params.depositAmount == 0) revert ZeroAmount();
        if (params.endTime <= params.startTime) revert InvalidTimeRange();
        if (params.cliffTime != 0) {
            if (params.cliffTime < params.startTime || params.cliffTime > params.endTime) {
                revert CliffOutOfRange();
            }
        }

        // Pull tokens from sender
        IERC20(params.token).safeTransferFrom(msg.sender, address(this), params.depositAmount);

        // Mint NFT to recipient
        streamId = _nextStreamId++;
        _safeMint(params.recipient, streamId);

        // Store stream
        _streams[streamId] = Stream({
            sender: msg.sender,
            startTime: params.startTime,
            endTime: params.endTime,
            cancelable: params.cancelable,
            canceled: false,
            token: params.token,
            cliffTime: params.cliffTime,
            depositAmount: params.depositAmount,
            withdrawnAmount: 0
        });

        // Track sender's streams
        _senderStreams[msg.sender].push(streamId);

        _totalStreams++;

        emit StreamCreated(
            streamId,
            msg.sender,
            params.recipient,
            params.token,
            params.depositAmount,
            params.startTime,
            params.endTime,
            params.cliffTime,
            params.cancelable
        );
    }

    /**
     * @notice Withdraw streamed tokens
     * @dev Caller must be NFT holder or approved operator
     * @param streamId The stream to withdraw from
     * @param amount Amount to withdraw (must be <= withdrawable)
     * @param to Address to receive the tokens
     */
    function withdraw(uint256 streamId, uint128 amount, address to)
        external
        nonReentrant
    {
        address tokenOwner = _requireOwned(streamId);
        _checkAuthorized(tokenOwner, msg.sender, streamId);

        if (to == address(0)) revert ZeroRecipient();
        if (amount == 0) revert ZeroAmount();

        Stream storage stream = _streams[streamId];

        uint128 available = _streamedAmount(streamId) - stream.withdrawnAmount;
        if (available == 0) revert NothingToWithdraw();
        if (amount > available) revert WithdrawAmountExceeded();

        // Update state before transfer (CEI)
        stream.withdrawnAmount += amount;

        // Transfer tokens
        IERC20(stream.token).safeTransfer(to, amount);

        emit Withdrawn(streamId, to, amount);
    }

    /**
     * @notice Cancel a stream — sender gets unstreamed portion, recipient keeps earned
     * @dev Only the original sender can cancel. Stream must be cancelable.
     *      Recipient's earned portion stays in contract for later withdrawal.
     * @param streamId The stream to cancel
     */
    function cancel(uint256 streamId) external nonReentrant {
        _requireOwned(streamId);

        Stream storage stream = _streams[streamId];

        if (msg.sender != stream.sender) revert NotStreamSender();
        if (!stream.cancelable) revert StreamNotCancelable();
        if (stream.canceled) revert StreamAlreadyCanceled();

        uint128 streamed = _streamedAmount(streamId);
        uint128 senderRefund = stream.depositAmount - streamed;
        uint128 recipientAmount = streamed - stream.withdrawnAmount;

        // Update state before transfer (CEI)
        stream.canceled = true;
        stream.depositAmount = streamed; // reduce to earned portion

        // Refund sender
        if (senderRefund > 0) {
            IERC20(stream.token).safeTransfer(stream.sender, senderRefund);
        }

        emit Canceled(streamId, senderRefund, recipientAmount);
    }

    /**
     * @notice Burn a fully depleted stream NFT
     * @dev Only works if stream is complete/canceled and fully withdrawn
     * @param streamId The stream NFT to burn
     */
    function burn(uint256 streamId) external {
        address tokenOwner = _requireOwned(streamId);
        _checkAuthorized(tokenOwner, msg.sender, streamId);

        Stream storage stream = _streams[streamId];

        uint128 available = _streamedAmount(streamId) - stream.withdrawnAmount;
        if (available > 0) revert StreamNotDepleted();

        // For active (non-canceled) streams, must be past end time
        if (!stream.canceled && block.timestamp < stream.endTime) revert StreamNotDepleted();

        // Clean up storage
        delete _streams[streamId];

        // Burn NFT (triggers _update which handles _ownedStreams)
        _burn(streamId);

        emit StreamBurned(streamId);
    }

    // ============ View Functions ============

    /// @notice Total amount streamed (unlocked) so far, ignoring withdrawals
    function streamedAmount(uint256 streamId) external view returns (uint128) {
        _requireOwned(streamId);
        return _streamedAmount(streamId);
    }

    /// @notice Amount available to withdraw right now
    function withdrawable(uint256 streamId) external view returns (uint128) {
        _requireOwned(streamId);
        return _streamedAmount(streamId) - _streams[streamId].withdrawnAmount;
    }

    /// @notice Amount sender would receive if they canceled now
    function refundable(uint256 streamId) external view returns (uint128) {
        _requireOwned(streamId);
        Stream storage stream = _streams[streamId];
        if (stream.canceled || !stream.cancelable) return 0;
        return stream.depositAmount - _streamedAmount(streamId);
    }

    /// @notice Get full stream data
    function getStream(uint256 streamId) external view returns (Stream memory) {
        _requireOwned(streamId);
        return _streams[streamId];
    }

    /// @notice Get all stream IDs owned by an address (as recipient)
    function getStreamsByOwner(address owner) external view returns (uint256[] memory) {
        return _ownedStreams[owner];
    }

    /// @notice Get all stream IDs created by a sender
    function getStreamsBySender(address sender) external view returns (uint256[] memory) {
        return _senderStreams[sender];
    }

    /// @notice Total streams ever created
    function totalStreams() external view returns (uint256) {
        return _totalStreams;
    }

    // ============ Internal Functions ============

    /**
     * @notice Compute total streamed amount via lazy evaluation
     * @dev Linear interpolation: deposit * elapsed / duration
     *      Canceled streams return depositAmount (already reduced to earned portion)
     */
    function _streamedAmount(uint256 streamId) internal view returns (uint128) {
        Stream storage stream = _streams[streamId];

        // Canceled: depositAmount was reduced to final earned amount
        if (stream.canceled) return stream.depositAmount;

        // Not started yet
        if (block.timestamp < stream.startTime) return 0;

        // Before cliff: nothing withdrawable
        if (stream.cliffTime != 0 && block.timestamp < stream.cliffTime) return 0;

        // Past end: everything
        if (block.timestamp >= stream.endTime) return stream.depositAmount;

        // Linear interpolation
        uint256 elapsed = block.timestamp - stream.startTime;
        uint256 duration = stream.endTime - stream.startTime;
        return uint128((uint256(stream.depositAmount) * elapsed) / duration);
    }

    /**
     * @notice Override ERC721 _update to track _ownedStreams on transfers
     * @dev Called on mint, burn, and transfer
     */
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = super._update(to, tokenId, auth);

        // Remove from previous owner's list (not a mint)
        if (from != address(0)) {
            _removeFromOwnedStreams(from, tokenId);
        }

        // Add to new owner's list (not a burn)
        if (to != address(0)) {
            _ownedStreamIndex[tokenId] = _ownedStreams[to].length;
            _ownedStreams[to].push(tokenId);
        }

        return from;
    }

    /**
     * @notice Remove a stream ID from an owner's array (O(1) swap-and-pop)
     */
    function _removeFromOwnedStreams(address owner, uint256 streamId) internal {
        uint256 idx = _ownedStreamIndex[streamId];
        uint256 lastIdx = _ownedStreams[owner].length - 1;

        if (idx != lastIdx) {
            uint256 lastStreamId = _ownedStreams[owner][lastIdx];
            _ownedStreams[owner][idx] = lastStreamId;
            _ownedStreamIndex[lastStreamId] = idx;
        }

        _ownedStreams[owner].pop();
        delete _ownedStreamIndex[streamId];
    }

    // ============ FundingPool Core Functions ============

    /**
     * @notice Create a conviction-weighted funding pool for multiple recipients
     * @param params CreateFundingPoolParams with token, amount, recipients, start/end times
     * @return poolId The funding pool identifier (counts down from type(uint256).max)
     */
    function createFundingPool(CreateFundingPoolParams calldata params)
        external
        nonReentrant
        returns (uint256 poolId)
    {
        if (params.recipients.length == 0) revert NoRecipientsProvided();
        if (params.depositAmount == 0) revert ZeroAmount();
        if (params.endTime <= params.startTime) revert InvalidTimeRange();

        // Pull tokens from creator
        IERC20(params.token).safeTransferFrom(msg.sender, address(this), params.depositAmount);

        // Assign pool ID (counting down)
        poolId = _nextPoolId--;

        // Store pool
        _pools[poolId] = FundingPool({
            creator: msg.sender,
            startTime: params.startTime,
            endTime: params.endTime,
            canceled: false,
            token: params.token,
            totalDeposit: params.depositAmount,
            totalWithdrawn: 0
        });

        // Register recipients (check for duplicates)
        for (uint256 i = 0; i < params.recipients.length; i++) {
            address r = params.recipients[i];
            if (r == address(0)) revert ZeroRecipient();
            if (_isRecipient[poolId][r]) revert DuplicateRecipient();
            _isRecipient[poolId][r] = true;
            _poolRecipients[poolId].push(r);
        }

        // Track creator's pools
        _creatorPools[msg.sender].push(poolId);

        emit FundingPoolCreated(poolId, msg.sender, params.token, params.depositAmount, params.recipients.length);
    }

    /**
     * @notice Signal conviction for a recipient by staking tokens
     * @dev Voter stakes the pool's token. Conviction accrues as stake × time.
     * @param poolId The funding pool
     * @param recipient The recipient to signal for
     * @param stakeAmount Amount of tokens to stake
     */
    function signalConviction(uint256 poolId, address recipient, uint128 stakeAmount)
        external
        nonReentrant
    {
        FundingPool storage pool = _pools[poolId];
        if (pool.creator == address(0)) revert PoolNotFound();
        if (pool.canceled) revert PoolAlreadyCanceled();
        if (!_isRecipient[poolId][recipient]) revert NotRecipient();
        if (stakeAmount == 0) revert ZeroAmount();

        VoterSignal storage signal = _voterSignals[poolId][recipient][msg.sender];
        if (signal.amount != 0) revert SignalAlreadyExists();

        // Pull stake tokens from voter
        IERC20(pool.token).safeTransferFrom(msg.sender, address(this), stakeAmount);

        // Update conviction aggregates (O(1))
        ConvictionAggregate storage agg = _convictionAgg[poolId][recipient];
        agg.totalStake += stakeAmount;
        agg.stakeTimeProd += uint256(stakeAmount) * block.timestamp;

        // Store voter signal
        signal.amount = stakeAmount;
        signal.signalTime = uint40(block.timestamp);

        emit ConvictionSignaled(poolId, msg.sender, recipient, stakeAmount);
    }

    /**
     * @notice Remove conviction signal and reclaim staked tokens
     * @param poolId The funding pool
     * @param recipient The recipient the signal was for
     */
    function removeSignal(uint256 poolId, address recipient)
        external
        nonReentrant
    {
        FundingPool storage pool = _pools[poolId];
        if (pool.creator == address(0)) revert PoolNotFound();

        VoterSignal storage signal = _voterSignals[poolId][recipient][msg.sender];
        if (signal.amount == 0) revert NoSignalExists();

        uint128 stakeAmount = signal.amount;

        // Update conviction aggregates
        ConvictionAggregate storage agg = _convictionAgg[poolId][recipient];
        agg.totalStake -= stakeAmount;
        agg.stakeTimeProd -= uint256(stakeAmount) * signal.signalTime;

        // Clear voter signal
        delete _voterSignals[poolId][recipient][msg.sender];

        // Return staked tokens
        IERC20(pool.token).safeTransfer(msg.sender, stakeAmount);

        emit ConvictionRemoved(poolId, msg.sender, recipient, stakeAmount);
    }

    /**
     * @notice Withdraw earned tokens from a funding pool (recipient only)
     * @dev Lazy computation: streamProgress × (myConviction / totalConviction) - withdrawn
     *      Pairwise fairness is verified on-chain at withdrawal time.
     * @param poolId The funding pool
     * @return amount Tokens withdrawn
     */
    function withdrawFromPool(uint256 poolId)
        external
        nonReentrant
        returns (uint128 amount)
    {
        FundingPool storage pool = _pools[poolId];
        if (pool.creator == address(0)) revert PoolNotFound();
        if (!_isRecipient[poolId][msg.sender]) revert NotRecipient();

        uint256 totalConv = _getTotalConviction(poolId);
        if (totalConv == 0) revert NoConviction();

        uint256 myConv = _getConviction(poolId, msg.sender);
        if (myConv == 0) revert NoConviction();

        uint128 totalStreamed = _getPoolStreamed(poolId);
        uint128 myShare = uint128((uint256(totalStreamed) * myConv) / totalConv);
        uint128 alreadyWithdrawn = _recipientWithdrawn[poolId][msg.sender];

        if (myShare <= alreadyWithdrawn) revert NothingToWithdraw();
        amount = myShare - alreadyWithdrawn;

        // Update state before transfer (CEI)
        _recipientWithdrawn[poolId][msg.sender] += amount;
        pool.totalWithdrawn += amount;

        // Transfer tokens
        IERC20(pool.token).safeTransfer(msg.sender, amount);

        emit PoolWithdrawn(poolId, msg.sender, amount);
    }

    /**
     * @notice Cancel a funding pool — creator gets unstreamed portion back
     * @dev Staked tokens are unaffected; voters must removeSignal separately.
     * @param poolId The funding pool to cancel
     */
    function cancelPool(uint256 poolId) external nonReentrant {
        FundingPool storage pool = _pools[poolId];
        if (pool.creator == address(0)) revert PoolNotFound();
        if (msg.sender != pool.creator) revert NotPoolCreator();
        if (pool.canceled) revert PoolAlreadyCanceled();

        uint128 streamed = _getPoolStreamed(poolId);
        uint128 refundAmount = pool.totalDeposit - streamed;

        // Update state before transfer (CEI)
        pool.canceled = true;
        pool.totalDeposit = streamed; // reduce to earned portion

        // Refund creator
        if (refundAmount > 0) {
            IERC20(pool.token).safeTransfer(pool.creator, refundAmount);
        }

        emit PoolCanceled(poolId, refundAmount);
    }

    // ============ FundingPool View Functions ============

    /// @notice Get full pool data
    function getPool(uint256 poolId) external view returns (FundingPool memory) {
        if (_pools[poolId].creator == address(0)) revert PoolNotFound();
        return _pools[poolId];
    }

    /// @notice Get all recipients of a pool
    function getPoolRecipients(uint256 poolId) external view returns (address[] memory) {
        return _poolRecipients[poolId];
    }

    /// @notice Get current conviction for a recipient
    function getConviction(uint256 poolId, address recipient) external view returns (uint256) {
        return _getConviction(poolId, recipient);
    }

    /// @notice Get total conviction across all recipients
    function getTotalConviction(uint256 poolId) external view returns (uint256) {
        return _getTotalConviction(poolId);
    }

    /// @notice Get amount withdrawable by a recipient right now
    function getPoolWithdrawable(uint256 poolId, address recipient) external view returns (uint128) {
        uint256 totalConv = _getTotalConviction(poolId);
        if (totalConv == 0) return 0;

        uint256 myConv = _getConviction(poolId, recipient);
        if (myConv == 0) return 0;

        uint128 totalStreamed = _getPoolStreamed(poolId);
        uint128 myShare = uint128((uint256(totalStreamed) * myConv) / totalConv);
        uint128 alreadyWithdrawn = _recipientWithdrawn[poolId][recipient];

        if (myShare <= alreadyWithdrawn) return 0;
        return myShare - alreadyWithdrawn;
    }

    /// @notice Verify pairwise fairness between two recipients
    function verifyPoolFairness(uint256 poolId, address r1, address r2)
        external view returns (bool fair, uint256 deviation)
    {
        uint256 totalConv = _getTotalConviction(poolId);
        if (totalConv == 0) return (true, 0);

        uint256 conv1 = _getConviction(poolId, r1);
        uint256 conv2 = _getConviction(poolId, r2);

        uint128 totalStreamed = _getPoolStreamed(poolId);
        uint256 share1 = (uint256(totalStreamed) * conv1) / totalConv;
        uint256 share2 = (uint256(totalStreamed) * conv2) / totalConv;

        PairwiseFairness.FairnessResult memory result = PairwiseFairness.verifyPairwiseProportionality(
            share1, share2,
            conv1, conv2,
            totalConv
        );

        return (result.fair, result.deviation);
    }

    /// @notice Get all pool IDs created by a creator
    function getPoolsBySender(address creator) external view returns (uint256[] memory) {
        return _creatorPools[creator];
    }

    /// @notice Get a voter's signal for a recipient in a pool
    function getVoterSignal(uint256 poolId, address recipient, address voter)
        external view returns (VoterSignal memory)
    {
        return _voterSignals[poolId][recipient][voter];
    }

    // ============ FundingPool Internal Functions ============

    /**
     * @notice Compute conviction for a recipient at current time
     * @dev conviction(R, T) = effectiveT × totalStake(R) - stakeTimeProd(R)
     *      where effectiveT = min(block.timestamp, endTime)
     */
    function _getConviction(uint256 poolId, address recipient) internal view returns (uint256) {
        ConvictionAggregate storage agg = _convictionAgg[poolId][recipient];
        if (agg.totalStake == 0) return 0;

        FundingPool storage pool = _pools[poolId];
        uint256 effectiveT = block.timestamp < pool.endTime ? block.timestamp : pool.endTime;

        return effectiveT * agg.totalStake - agg.stakeTimeProd;
    }

    /**
     * @notice Compute total conviction across all recipients
     */
    function _getTotalConviction(uint256 poolId) internal view returns (uint256) {
        address[] storage recipients = _poolRecipients[poolId];
        uint256 total = 0;
        for (uint256 i = 0; i < recipients.length; i++) {
            total += _getConviction(poolId, recipients[i]);
        }
        return total;
    }

    /**
     * @notice Compute total tokens streamed from a pool so far
     * @dev Linear interpolation: deposit × elapsed / duration
     */
    function _getPoolStreamed(uint256 poolId) internal view returns (uint128) {
        FundingPool storage pool = _pools[poolId];

        // Canceled: totalDeposit was reduced to earned amount
        if (pool.canceled) return pool.totalDeposit;

        // Not started yet
        if (block.timestamp < pool.startTime) return 0;

        // Past end: everything
        if (block.timestamp >= pool.endTime) return pool.totalDeposit;

        // Linear interpolation
        uint256 elapsed = block.timestamp - pool.startTime;
        uint256 duration = pool.endTime - pool.startTime;
        return uint128((uint256(pool.totalDeposit) * elapsed) / duration);
    }
}
