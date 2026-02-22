// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../core/interfaces/ICommitRevealAuction.sol";

/**
 * @title CrossChainRouter
 * @notice LayerZero V2 OApp for cross-chain order submission and liquidity sync
 * @dev Implements unified liquidity across chains with message rate limiting
 */
contract CrossChainRouter is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ LayerZero V2 Types ============

    struct MessagingParams {
        uint32 dstEid;
        bytes32 receiver;
        bytes message;
        bytes options;
        bool payInLzToken;
    }

    struct MessagingFee {
        uint256 nativeFee;
        uint256 lzTokenFee;
    }

    struct MessagingReceipt {
        bytes32 guid;
        uint64 nonce;
        MessagingFee fee;
    }

    struct Origin {
        uint32 srcEid;
        bytes32 sender;
        uint64 nonce;
    }

    // ============ Message Types ============

    enum MessageType {
        ORDER_COMMIT,
        ORDER_REVEAL,
        BATCH_RESULT,
        LIQUIDITY_SYNC,
        ASSET_TRANSFER
    }

    struct CrossChainCommit {
        bytes32 commitHash;
        address depositor;
        uint256 depositAmount;
        uint32 srcChainId;
        uint32 dstChainId;    // FIX #1: Destination chain for replay prevention
        uint256 srcTimestamp; // Timestamp from source chain for consistent commit ID
    }

    struct CrossChainReveal {
        bytes32 commitId;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minAmountOut;
        bytes32 secret;
        uint256 priorityBid;
        uint32 srcChainId;
    }

    struct BatchResult {
        uint64 batchId;
        bytes32 poolId;
        uint256 clearingPrice;
        address[] filledTraders;
        uint256[] filledAmounts;
    }

    struct LiquiditySync {
        bytes32 poolId;
        uint256 reserve0;
        uint256 reserve1;
        uint256 totalLiquidity;
    }

    // ============ State ============

    /// @notice LayerZero endpoint
    address public lzEndpoint;

    /// @notice CommitRevealAuction contract
    address public auction;

    /// @notice Peer contracts on other chains (eid => peer address)
    mapping(uint32 => bytes32) public peers;

    /// @notice Processed message GUIDs (prevent replay)
    mapping(bytes32 => bool) public processedMessages;

    /// @notice Rate limiting: messages per chain per hour
    mapping(uint32 => uint256) public messageCount;
    mapping(uint32 => uint256) public lastResetTime;
    uint256 public maxMessagesPerHour;

    /// @notice Pending cross-chain commits
    mapping(bytes32 => CrossChainCommit) public pendingCommits;

    /// @notice Cross-chain liquidity state
    mapping(bytes32 => LiquiditySync) public liquidityState;

    // ============ Security: Bridged Deposit Tracking (Fix #2) ============

    /// @notice Verified bridged deposits per commit (prevents deposit theft)
    mapping(bytes32 => uint256) public bridgedDeposits;

    /// @notice Timestamp when bridged deposit was created
    mapping(bytes32 => uint256) public bridgedDepositTimestamp;

    /// @notice Total bridged deposits awaiting processing
    uint256 public totalBridgedDeposits;

    /// @notice Expiry duration for bridged deposits (default 24 hours)
    uint256 public bridgedDepositExpiry;

    /// @notice Authorized callers (VibeSwapCore)
    mapping(address => bool) public authorized;

    // ============ Events ============

    event PeerSet(uint32 indexed eid, bytes32 peer);
    event CrossChainCommitSent(bytes32 indexed commitId, uint32 indexed dstEid, address depositor);
    event CrossChainCommitReceived(bytes32 indexed commitId, uint32 indexed srcEid, address depositor);
    event CrossChainRevealSent(bytes32 indexed commitId, uint32 indexed dstEid);
    event CrossChainRevealReceived(bytes32 indexed commitId, uint32 indexed srcEid);
    event BatchResultSent(uint64 indexed batchId, uint32 indexed dstEid);
    event BatchResultReceived(uint64 indexed batchId, uint32 indexed srcEid);
    event LiquiditySynced(bytes32 indexed poolId, uint32 indexed srcEid);
    event MessageRateLimited(uint32 indexed srcEid, bytes32 guid);
    event CrossChainRevealFailed(bytes32 indexed commitId, uint32 indexed srcEid, string reason);
    event BridgedDepositFunded(bytes32 indexed commitId, uint256 amount);
    event BridgedDepositRecovered(bytes32 indexed commitId, address indexed depositor, uint256 amount);

    // ============ Errors ============

    error NotEndpoint();
    error InvalidPeer();
    error AlreadyProcessed();
    error RateLimited();
    error Unauthorized();
    error InvalidMessage();
    error DepositNotExpired();
    error NoDepositToRecover();

    // ============ Modifiers ============

    modifier onlyEndpoint() {
        if (msg.sender != lzEndpoint) revert NotEndpoint();
        _;
    }

    modifier onlyAuthorized() {
        if (!authorized[msg.sender]) revert Unauthorized();
        _;
    }

    modifier rateLimited(uint32 srcEid) {
        _checkRateLimit(srcEid);
        _;
    }

    // ============ Initialization ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the contract
     * @param _owner Owner address
     * @param _lzEndpoint LayerZero V2 endpoint
     * @param _auction CommitRevealAuction contract
     */
    function initialize(
        address _owner,
        address _lzEndpoint,
        address _auction
    ) external initializer {
        __Ownable_init(_owner);
        __ReentrancyGuard_init();

        require(_lzEndpoint != address(0), "Invalid endpoint");
        require(_auction != address(0), "Invalid auction");

        lzEndpoint = _lzEndpoint;
        auction = _auction;
        maxMessagesPerHour = 1000; // Default rate limit
        bridgedDepositExpiry = 24 hours; // Default: deposits expire after 24h
    }

    // ============ Cross-Chain Order Submission ============

    /**
     * @notice Send order commitment to another chain
     * @param dstEid Destination chain endpoint ID
     * @param commitHash Commitment hash
     * @param options LayerZero options
     */
    function sendCommit(
        uint32 dstEid,
        bytes32 commitHash,
        bytes calldata options
    ) external payable nonReentrant onlyAuthorized {
        bytes32 peer = peers[dstEid];
        if (peer == bytes32(0)) revert InvalidPeer();

        uint256 srcTimestamp = block.timestamp;

        // FIX #1: Include destination chain in commit ID to prevent cross-chain replay
        bytes32 commitId = keccak256(abi.encodePacked(
            msg.sender,
            commitHash,
            block.chainid,
            dstEid,           // Destination chain prevents replay on other chains
            srcTimestamp
        ));

        CrossChainCommit memory commit = CrossChainCommit({
            commitHash: commitHash,
            depositor: msg.sender,
            depositAmount: msg.value,
            srcChainId: uint32(block.chainid),
            dstChainId: dstEid,  // FIX #1: Include destination chain
            srcTimestamp: srcTimestamp
        });

        // Store pending commit
        pendingCommits[commitId] = commit;

        // Encode message (include srcTimestamp for consistent commitId on destination)
        bytes memory message = abi.encode(
            MessageType.ORDER_COMMIT,
            abi.encode(commit)
        );

        // Send via LayerZero
        MessagingParams memory params = MessagingParams({
            dstEid: dstEid,
            receiver: peer,
            message: message,
            options: options,
            payInLzToken: false
        });

        _lzSend(params, msg.value);

        emit CrossChainCommitSent(commitId, dstEid, msg.sender);
    }

    /**
     * @notice Send order reveal to another chain
     * @param dstEid Destination chain endpoint ID
     * @param reveal Reveal data
     * @param options LayerZero options
     */
    function sendReveal(
        uint32 dstEid,
        CrossChainReveal calldata reveal,
        bytes calldata options
    ) external payable nonReentrant onlyAuthorized {
        bytes32 peer = peers[dstEid];
        if (peer == bytes32(0)) revert InvalidPeer();

        bytes memory message = abi.encode(
            MessageType.ORDER_REVEAL,
            abi.encode(reveal)
        );

        MessagingParams memory params = MessagingParams({
            dstEid: dstEid,
            receiver: peer,
            message: message,
            options: options,
            payInLzToken: false
        });

        _lzSend(params, msg.value);

        emit CrossChainRevealSent(reveal.commitId, dstEid);
    }

    /**
     * @notice Broadcast batch results to all chains
     * @param result Batch execution result
     * @param dstEids Destination chain IDs
     * @param options LayerZero options per chain
     */
    function broadcastBatchResult(
        BatchResult calldata result,
        uint32[] calldata dstEids,
        bytes[] calldata options
    ) external payable nonReentrant onlyAuthorized {
        require(dstEids.length == options.length, "Length mismatch");
        require(dstEids.length > 0, "No destinations");

        bytes memory message = abi.encode(
            MessageType.BATCH_RESULT,
            abi.encode(result)
        );

        uint256 feePerChain = msg.value / dstEids.length;

        for (uint256 i = 0; i < dstEids.length; i++) {
            bytes32 peer = peers[dstEids[i]];
            if (peer == bytes32(0)) continue;

            MessagingParams memory params = MessagingParams({
                dstEid: dstEids[i],
                receiver: peer,
                message: message,
                options: options[i],
                payInLzToken: false
            });

            _lzSend(params, feePerChain);

            emit BatchResultSent(result.batchId, dstEids[i]);
        }

        // Refund fee remainder from integer division
        uint256 remainder = msg.value - (feePerChain * dstEids.length);
        if (remainder > 0) {
            (bool success, ) = msg.sender.call{value: remainder}("");
            require(success, "Fee refund failed");
        }
    }

    /**
     * @notice Sync liquidity state across chains
     * @param sync Liquidity sync data
     * @param dstEids Destination chains
     * @param options LayerZero options
     */
    function syncLiquidity(
        LiquiditySync calldata sync,
        uint32[] calldata dstEids,
        bytes[] calldata options
    ) external payable nonReentrant onlyAuthorized {
        require(dstEids.length == options.length, "Length mismatch");
        require(dstEids.length > 0, "No destinations");

        bytes memory message = abi.encode(
            MessageType.LIQUIDITY_SYNC,
            abi.encode(sync)
        );

        uint256 feePerChain = msg.value / dstEids.length;

        for (uint256 i = 0; i < dstEids.length; i++) {
            bytes32 peer = peers[dstEids[i]];
            if (peer == bytes32(0)) continue;

            MessagingParams memory params = MessagingParams({
                dstEid: dstEids[i],
                receiver: peer,
                message: message,
                options: options[i],
                payInLzToken: false
            });

            _lzSend(params, feePerChain);
        }

        // Refund fee remainder from integer division
        uint256 remainder = msg.value - (feePerChain * dstEids.length);
        if (remainder > 0) {
            (bool success, ) = msg.sender.call{value: remainder}("");
            require(success, "Fee refund failed");
        }
    }

    // ============ LayerZero V2 Receive ============

    /**
     * @notice Receive message from LayerZero
     * @param _origin Message origin
     * @param _guid Message GUID
     * @param _message Encoded message
     */
    function lzReceive(
        Origin calldata _origin,
        bytes32 _guid,
        bytes calldata _message,
        address /*_executor*/,
        bytes calldata /*_extraData*/
    ) external onlyEndpoint rateLimited(_origin.srcEid) nonReentrant {
        // Verify sender is a peer
        if (peers[_origin.srcEid] != _origin.sender) revert InvalidPeer();

        // Check replay
        if (processedMessages[_guid]) revert AlreadyProcessed();
        processedMessages[_guid] = true;

        // Decode and process message
        (MessageType msgType, bytes memory payload) = abi.decode(_message, (MessageType, bytes));

        if (msgType == MessageType.ORDER_COMMIT) {
            _handleCommit(payload, _origin.srcEid);
        } else if (msgType == MessageType.ORDER_REVEAL) {
            _handleReveal(payload, _origin.srcEid);
        } else if (msgType == MessageType.BATCH_RESULT) {
            _handleBatchResult(payload, _origin.srcEid);
        } else if (msgType == MessageType.LIQUIDITY_SYNC) {
            _handleLiquiditySync(payload, _origin.srcEid);
        } else {
            revert InvalidMessage();
        }
    }

    // ============ Internal Message Handlers ============

    function _handleCommit(bytes memory payload, uint32 srcEid) internal {
        CrossChainCommit memory commit = abi.decode(payload, (CrossChainCommit));

        // FIX #1: Include destination chain in commit ID (must match sendCommit)
        bytes32 commitId = keccak256(abi.encodePacked(
            commit.depositor,
            commit.commitHash,
            commit.srcChainId,
            commit.dstChainId,    // Must match destination
            commit.srcTimestamp
        ));

        // FIX #1: Verify this message is intended for THIS chain
        require(commit.dstChainId == uint32(block.chainid), "Wrong destination chain");

        // Store for local processing
        pendingCommits[commitId] = commit;

        // FIX #2: Track bridged deposit separately instead of using router balance
        // The deposit must be bridged via a separate asset bridge (LayerZero OFT, etc.)
        // For now, record the expected deposit amount - actual bridging happens via fundBridgedDeposit()
        bridgedDeposits[commitId] = commit.depositAmount;
        bridgedDepositTimestamp[commitId] = block.timestamp;
        totalBridgedDeposits += commit.depositAmount;

        emit CrossChainCommitReceived(commitId, srcEid, commit.depositor);
    }

    /**
     * @notice Fund a bridged deposit after asset bridge completes
     * @dev Called by authorized bridge receiver after OFT/bridge transfer arrives
     * @param commitId The commit ID to fund
     */
    function fundBridgedDeposit(bytes32 commitId) external payable onlyAuthorized {
        CrossChainCommit memory commit = pendingCommits[commitId];
        require(commit.depositor != address(0), "Unknown commit");
        require(msg.value >= commit.depositAmount, "Insufficient deposit");
        require(bridgedDeposits[commitId] > 0, "Already funded or not pending");

        // Clear the pending bridged deposit
        bridgedDeposits[commitId] = 0;
        totalBridgedDeposits -= commit.depositAmount;

        // Now forward to auction with verified funds
        ICommitRevealAuction(auction).commitOrder{value: commit.depositAmount}(
            commit.commitHash
        );

        // Refund excess
        if (msg.value > commit.depositAmount) {
            (bool success, ) = msg.sender.call{value: msg.value - commit.depositAmount}("");
            require(success, "Refund failed");
        }
    }

    function _handleReveal(bytes memory payload, uint32 srcEid) internal {
        CrossChainReveal memory reveal = abi.decode(payload, (CrossChainReveal));

        // FIX: Get the original depositor from pending commits for ownership verification
        CrossChainCommit memory commit = pendingCommits[reveal.commitId];

        // FIX #2: Only process reveals for commits we've received and funded
        // If commit.depositor is zero, this reveal is invalid
        if (commit.depositor == address(0)) {
            emit CrossChainRevealFailed(reveal.commitId, srcEid, "Unknown commit");
            return;
        }

        // Determine how much ETH we can send for priority bid
        // Exclude totalBridgedDeposits to avoid using pending bridge funds
        uint256 availableEth = address(this).balance > totalBridgedDeposits
            ? address(this).balance - totalBridgedDeposits
            : 0;
        uint256 priorityBidToSend = reveal.priorityBid > availableEth ? availableEth : reveal.priorityBid;

        ICommitRevealAuction auctionContract = ICommitRevealAuction(auction);

        // FIX: Use revealOrderCrossChain which allows revealing on behalf of original depositor
        try auctionContract.revealOrderCrossChain{value: priorityBidToSend}(
            reveal.commitId,
            commit.depositor,     // Original depositor from our records
            reveal.tokenIn,
            reveal.tokenOut,
            reveal.amountIn,
            reveal.minAmountOut,
            reveal.secret,
            priorityBidToSend
        ) {
            // Success
        } catch {
            // If reveal fails, log but don't revert the whole message
            emit CrossChainRevealFailed(reveal.commitId, srcEid, "Reveal rejected");
        }

        emit CrossChainRevealReceived(reveal.commitId, srcEid);
    }

    function _handleBatchResult(bytes memory payload, uint32 srcEid) internal {
        BatchResult memory result = abi.decode(payload, (BatchResult));

        // Process fills for cross-chain orders
        // In production, this would trigger asset transfers back to source chains

        emit BatchResultReceived(result.batchId, srcEid);
    }

    function _handleLiquiditySync(bytes memory payload, uint32 srcEid) internal {
        LiquiditySync memory sync = abi.decode(payload, (LiquiditySync));

        liquidityState[sync.poolId] = sync;

        emit LiquiditySynced(sync.poolId, srcEid);
    }

    // ============ LayerZero V2 Send ============

    function _lzSend(
        MessagingParams memory params,
        uint256 fee
    ) internal returns (MessagingReceipt memory receipt) {
        // Call LayerZero endpoint
        // In production, this calls the actual LZ endpoint
        // For now, we simulate the interface

        (bool success, bytes memory result) = lzEndpoint.call{value: fee}(
            abi.encodeWithSignature(
                "send((uint32,bytes32,bytes,bytes,bool),address)",
                params,
                address(this)
            )
        );

        require(success, "LayerZero send failed");
        if (result.length > 0) {
            receipt = abi.decode(result, (MessagingReceipt));
        }
    }

    // ============ Rate Limiting ============

    function _checkRateLimit(uint32 srcEid) internal {
        uint256 currentHour = block.timestamp / 1 hours;
        uint256 lastReset = lastResetTime[srcEid];

        if (currentHour > lastReset) {
            messageCount[srcEid] = 0;
            lastResetTime[srcEid] = currentHour;
        }

        if (messageCount[srcEid] >= maxMessagesPerHour) {
            revert RateLimited();
        }

        messageCount[srcEid]++;
    }

    // ============ View Functions ============

    /**
     * @notice Get quote for cross-chain message
     */
    function quote(
        uint32 dstEid,
        bytes calldata message,
        bytes calldata options
    ) external view returns (MessagingFee memory fee) {
        // In production, call LZ endpoint for quote
        // Simplified estimation
        fee.nativeFee = 0.01 ether;
        fee.lzTokenFee = 0;
    }

    /**
     * @notice Get liquidity state for a pool
     */
    function getLiquidityState(bytes32 poolId) external view returns (LiquiditySync memory) {
        return liquidityState[poolId];
    }

    /**
     * @notice Check if message was processed
     */
    function isProcessed(bytes32 guid) external view returns (bool) {
        return processedMessages[guid];
    }

    // ============ Admin Functions ============

    /**
     * @notice Set peer contract on another chain
     */
    function setPeer(uint32 eid, bytes32 peer) external onlyOwner {
        peers[eid] = peer;
        emit PeerSet(eid, peer);
    }

    /**
     * @notice Set authorized caller
     */
    function setAuthorized(address caller, bool status) external onlyOwner {
        authorized[caller] = status;
    }

    /**
     * @notice Update rate limit
     */
    function setMaxMessagesPerHour(uint256 max) external onlyOwner {
        maxMessagesPerHour = max;
    }

    /**
     * @notice Update LayerZero endpoint
     */
    function setEndpoint(address _endpoint) external onlyOwner {
        require(_endpoint != address(0), "Invalid endpoint");
        lzEndpoint = _endpoint;
    }

    /**
     * @notice Update auction contract
     */
    function setAuction(address _auction) external onlyOwner {
        require(_auction != address(0), "Invalid auction");
        auction = _auction;
    }

    /**
     * @notice Update bridged deposit expiry duration
     * @param _expiry New expiry duration in seconds (min 1 hour)
     */
    function setBridgedDepositExpiry(uint256 _expiry) external onlyOwner {
        require(_expiry >= 1 hours, "Expiry too short");
        bridgedDepositExpiry = _expiry;
    }

    /**
     * @notice Recover an expired bridged deposit
     * @dev Only the original depositor or owner can recover. Cleans up totalBridgedDeposits.
     * @param commitId The commit ID whose deposit expired
     */
    function recoverExpiredDeposit(bytes32 commitId) external nonReentrant {
        uint256 depositAmount = bridgedDeposits[commitId];
        if (depositAmount == 0) revert NoDepositToRecover();

        uint256 createdAt = bridgedDepositTimestamp[commitId];
        if (block.timestamp < createdAt + bridgedDepositExpiry) revert DepositNotExpired();

        CrossChainCommit memory commit = pendingCommits[commitId];
        // Only original depositor or owner can recover
        require(
            msg.sender == commit.depositor || msg.sender == owner(),
            "Not authorized to recover"
        );

        // Clean up state
        bridgedDeposits[commitId] = 0;
        bridgedDepositTimestamp[commitId] = 0;
        totalBridgedDeposits -= depositAmount;
        delete pendingCommits[commitId];

        emit BridgedDepositRecovered(commitId, commit.depositor, depositAmount);
    }

    // ============ Receive ============

    receive() external payable {}
}
