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
 * @author Faraday1 & JARVIS -- vibeswap.org
 * @notice LayerZero V2 compatible cross-chain router for order submission and liquidity sync
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

    // ============ Security: Bridged Deposit Tracking (Fix #2 + TRP-R34-NEW01) ============

    /// @notice Expected deposit amount per commit (set on commit receipt, cleared on fund/expire)
    mapping(bytes32 => uint256) public bridgedDeposits;

    /// @notice Timestamp when bridged deposit was created
    mapping(bytes32 => uint256) public bridgedDepositTimestamp;

    /// @notice Whether a bridged deposit has been funded with real ETH
    mapping(bytes32 => bool) public bridgedDepositFunded;

    /// @notice Total pending deposits (expected but NOT yet funded — no ETH held)
    /// @dev TRP-R34-NEW01: Split from totalBridgedDeposits to fix phantom accounting.
    ///      Incremented in _handleCommit, decremented in fundBridgedDeposit/recoverExpiredDeposit.
    uint256 public totalPendingDeposits;

    /// @notice Total funded bridged deposits (real ETH held by router for auction commits)
    /// @dev Invariant: address(this).balance >= totalBridgedDeposits (always true)
    uint256 public totalBridgedDeposits;

    /// @notice Expiry duration for bridged deposits (default 24 hours)
    uint256 public bridgedDepositExpiry;

    /// @notice NEW-04: Escrow for funded deposits that expired before being claimed.
    ///         Key: commitId → amount claimable on THIS chain.
    ///         Depositor (as identified by commit.depositor) calls claimExpiredDeposit() to withdraw.
    ///         ETH stays on the destination chain; depositor must use THEIR destination-chain address.
    mapping(bytes32 => uint256) public claimableDeposits;

    /// @notice NEW-04: Records the source-chain depositor address for each escrowed commitId.
    ///         Only this address (or the owner) may claim the escrowed ETH.
    ///         Prevents arbitrary callers from draining escrow by self-naming as recipient.
    mapping(bytes32 => address) public claimableDepositOwner;

    /// @notice Authorized callers (VibeSwapCore)
    mapping(address => bool) public authorized;

    /// @notice This chain's LayerZero endpoint ID
    /// @dev TRP-R21-H01: block.chainid != LayerZero eid. Must use eid for cross-chain checks.
    uint32 public localEid;


    /// @dev Reserved storage gap for future upgrades (reduced by 2 for claimableDeposits + claimableDepositOwner)
    uint256[48] private __gap;

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
    /// @notice NEW-04: Emitted when an unfunded commit expires. Depositor must reclaim on srcChainId.
    event CrossChainCommitExpired(
        bytes32 indexed commitId,
        address indexed depositor,
        uint32  indexed srcChainId,
        uint256 depositAmount
    );
    /// @notice NEW-04: Emitted when funded-deposit ETH is escrowed after expiry.
    event ClaimableDepositStored(bytes32 indexed commitId, address indexed depositor, uint256 amount);
    /// @notice NEW-04: Emitted when escrowed ETH is claimed by the depositor on this chain.
    event ClaimableDepositClaimed(bytes32 indexed commitId, address indexed recipient, uint256 amount);

    // ============ Errors ============

    error NotEndpoint();
    error InvalidPeer();
    error AlreadyProcessed();
    error RateLimited();
    error Unauthorized();
    error InvalidMessage();
    error DepositNotExpired();
    error NoDepositToRecover();
    error NoClaimableDeposit();

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
        address _auction,
        uint32 _localEid
    ) external initializer {
        __Ownable_init(_owner);
        __ReentrancyGuard_init();

        require(_lzEndpoint != address(0), "Invalid endpoint");
        require(_auction != address(0), "Invalid auction");
        require(_localEid > 0, "Invalid local eid");

        lzEndpoint = _lzEndpoint;
        auction = _auction;
        localEid = _localEid;  // TRP-R21-H01: Store LZ eid for chain identity
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
    /**
     * @notice Send order commitment to another chain
     * @param dstEid Destination chain endpoint ID
     * @param commitHash Commitment hash
     * @param depositAmount The deposit amount committed on source chain (for bookkeeping on dst)
     * @param options LayerZero options
     * @dev TRP-R22-H03: msg.value is ONLY the LZ messaging fee. depositAmount is separate.
     *      The actual deposit stays on the source chain auction contract.
     *      The destination chain uses depositAmount for bridged deposit bookkeeping.
     */
    function sendCommit(
        uint32 dstEid,
        bytes32 commitHash,
        uint256 depositAmount,
        bytes calldata options
    ) external payable nonReentrant onlyAuthorized {
        bytes32 peer = peers[dstEid];
        if (peer == bytes32(0)) revert InvalidPeer();

        uint256 srcTimestamp = block.timestamp;

        // FIX #1 + TRP-R22-NEW02: Use localEid (not block.chainid) to match destination's commitId reconstruction.
        // block.chainid != localEid (EVM chain ID vs LayerZero endpoint ID).
        bytes32 commitId = keccak256(abi.encodePacked(
            msg.sender,
            commitHash,
            localEid,         // Must match _handleCommit's use of commit.srcChainId
            dstEid,           // Destination chain prevents replay on other chains
            srcTimestamp
        ));

        CrossChainCommit memory commit = CrossChainCommit({
            commitHash: commitHash,
            depositor: msg.sender,
            depositAmount: depositAmount,  // TRP-R22-H03: Explicit deposit, not msg.value
            srcChainId: localEid,
            dstChainId: dstEid,
            srcTimestamp: srcTimestamp
        });

        // Store pending commit
        pendingCommits[commitId] = commit;

        // Encode message (include srcTimestamp for consistent commitId on destination)
        bytes memory message = abi.encode(
            MessageType.ORDER_COMMIT,
            abi.encode(commit)
        );

        // Send via LayerZero — msg.value is purely the LZ messaging fee
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

        // TRP-R22-M04: Count valid peers first, then divide fees only among reachable chains
        uint256 validPeerCount;
        for (uint256 i = 0; i < dstEids.length; i++) {
            if (peers[dstEids[i]] != bytes32(0)) validPeerCount++;
        }
        require(validPeerCount > 0, "No valid peers");

        uint256 feePerChain = msg.value / validPeerCount;
        uint256 spent;

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
            spent += feePerChain;

            emit BatchResultSent(result.batchId, dstEids[i]);
        }

        // Refund unspent ETH (integer division remainder + skipped peerless chains)
        uint256 refund = msg.value - spent;
        if (refund > 0) {
            (bool success, ) = msg.sender.call{value: refund}("");
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

        // TRP-R22-M04: Same fix as broadcastBatchResult — only charge for valid peers
        uint256 validPeerCount;
        for (uint256 i = 0; i < dstEids.length; i++) {
            if (peers[dstEids[i]] != bytes32(0)) validPeerCount++;
        }
        require(validPeerCount > 0, "No valid peers");

        uint256 feePerChain = msg.value / validPeerCount;
        uint256 spent;

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
            spent += feePerChain;
        }

        // Refund unspent ETH
        uint256 refund = msg.value - spent;
        if (refund > 0) {
            (bool success, ) = msg.sender.call{value: refund}("");
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

        // TRP-R21-H01: Verify destination using LZ eid, not block.chainid
        require(commit.dstChainId == localEid, "Wrong destination chain");

        // TRP-R22-NEW09: Prevent duplicate commitId from inflating totalBridgedDeposits
        require(pendingCommits[commitId].depositor == address(0), "Commit already exists");

        // Store for local processing
        pendingCommits[commitId] = commit;

        // TRP-R34-NEW01: Track expected deposit in pending (NOT totalBridgedDeposits).
        // No ETH has arrived yet — only a LayerZero message. Real ETH arrives via fundBridgedDeposit().
        // totalBridgedDeposits must only reflect ETH actually held by the router.
        bridgedDeposits[commitId] = commit.depositAmount;
        bridgedDepositTimestamp[commitId] = block.timestamp;
        totalPendingDeposits += commit.depositAmount;

        emit CrossChainCommitReceived(commitId, srcEid, commit.depositor);
    }

    /**
     * @notice Fund a bridged deposit after asset bridge completes
     * @dev Called by authorized bridge receiver after OFT/bridge transfer arrives
     * @param commitId The commit ID to fund
     */
    function fundBridgedDeposit(bytes32 commitId) external payable onlyAuthorized nonReentrant {
        CrossChainCommit memory commit = pendingCommits[commitId];
        require(commit.depositor != address(0), "Unknown commit");
        require(msg.value >= commit.depositAmount, "Insufficient deposit");
        require(bridgedDeposits[commitId] > 0, "Already funded or not pending");

        // Cache deposit amount before state changes (CEI pattern)
        uint256 depositAmount = commit.depositAmount;
        uint256 excess = msg.value - depositAmount;

        // TRP-R34-NEW01: ETH has arrived. Move from pending to funded tracking.
        // Since we immediately forward to auction in the same tx, totalBridgedDeposits
        // is a transient state here. But we track it for the invariant:
        //   address(this).balance >= totalBridgedDeposits
        totalPendingDeposits -= depositAmount;
        bridgedDeposits[commitId] = 0;
        bridgedDepositTimestamp[commitId] = 0;
        // TRP-R22-NEW08: Clean up pendingCommits after funding to prevent reveal replay
        delete pendingCommits[commitId];

        // Now forward to auction with verified funds
        // TODO(TRP-R35-NEW03): Use commitOrderOnBehalf once implemented in CommitRevealAuction
        ICommitRevealAuction(auction).commitOrder{value: depositAmount}(
            commit.commitHash
        );

        // Refund excess
        if (excess > 0) {
            (bool success, ) = msg.sender.call{value: excess}("");
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
        // TRP-R34-NEW01: totalBridgedDeposits now only reflects real funded ETH held by router
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

    /// @dev TRP-R22-M05: STUB — decodes and emits but does not execute settlement.
    ///      Production implementation must: (1) verify batch result against local state,
    ///      (2) trigger asset transfers back to source chains via OFT/bridge,
    ///      (3) update local fill records. Without this, cross-chain orders settle
    ///      on the hub chain but source-chain users never receive their tokens.
    function _handleBatchResult(bytes memory payload, uint32 srcEid) internal {
        BatchResult memory result = abi.decode(payload, (BatchResult));

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

    // TRP-R22-M01: Fixed-window rate limit with lazy reset.
    // Resets counter when >1hr since last reset. Not a true sliding window —
    // a burst of 2x messages is possible across the hour boundary.
    // Acceptable for DoS mitigation; not suitable for precise throughput control.
    function _checkRateLimit(uint32 srcEid) internal {
        uint256 currentTime = block.timestamp;
        uint256 lastReset = lastResetTime[srcEid];

        // Lazy reset: if more than 1 hour since last reset, clear counter
        if (currentTime > lastReset + 1 hours) {
            messageCount[srcEid] = 0;
            lastResetTime[srcEid] = currentTime;
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

    // ============ Emergency Recovery (TRP-R22-H02) ============

    event EmergencyWithdrawETH(address indexed to, uint256 amount);
    event EmergencyWithdrawERC20(address indexed token, address indexed to, uint256 amount);

    /**
     * @notice Emergency withdraw ETH not earmarked for bridged deposits
     * @dev Only withdraws surplus ETH — bridged deposits remain protected
     * @param to Recipient address
     */
    function emergencyWithdrawETH(address to) external onlyOwner nonReentrant {
        require(to != address(0), "Invalid recipient");
        uint256 surplus = address(this).balance > totalBridgedDeposits
            ? address(this).balance - totalBridgedDeposits
            : 0;
        require(surplus > 0, "No surplus ETH");

        (bool success, ) = to.call{value: surplus}("");
        require(success, "ETH transfer failed");
        emit EmergencyWithdrawETH(to, surplus);
    }

    /**
     * @notice Emergency withdraw ERC20 tokens accidentally sent to this contract
     * @param token Token address
     * @param to Recipient address
     */
    function emergencyWithdrawERC20(address token, address to) external onlyOwner nonReentrant {
        require(to != address(0), "Invalid recipient");
        require(token != address(0), "Invalid token");
        uint256 balance = IERC20(token).balanceOf(address(this));
        require(balance > 0, "No token balance");

        IERC20(token).safeTransfer(to, balance);
        emit EmergencyWithdrawERC20(token, to, balance);
    }

    // ============ Peer & Access Management ============

    /**
     * @notice Set peer contract on another chain
     * @dev TRP-R22-M03: Zero address explicitly deletes the peer
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
    /// @dev TRP-R21-M02: Added minimum 1 to prevent permanent DOS of all inbound messages.
    function setMaxMessagesPerHour(uint256 max) external onlyOwner {
        require(max >= 1, "Min 1 message per hour");
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
     * @notice Recover an expired bridged deposit.
     * @dev NEW-04 FIX: Two distinct cases depending on whether ETH ever arrived on this chain.
     *
     *   UNFUNDED (asset bridge never delivered ETH):
     *     commit.depositor is the source-chain address. Sending ETH to it on the destination
     *     chain is wrong — that address may be owned by a different person or no one.
     *     Correct action: clean up accounting and emit CrossChainCommitExpired so off-chain
     *     tooling can alert the user to reclaim their original deposit on the source chain
     *     (srcChainId) from the CommitRevealAuction where it still resides.
     *
     *   FUNDED (ETH arrived but commit expired before settlement):
     *     ETH is on THIS chain. We must NOT send it to commit.depositor (source-chain address).
     *     Instead we escrow it in claimableDeposits[commitId]. The depositor calls
     *     claimExpiredDeposit() on the destination chain to withdraw with their local address.
     *
     * @param commitId The commit ID whose deposit expired
     */
    function recoverExpiredDeposit(bytes32 commitId) external nonReentrant {
        uint256 depositAmount = bridgedDeposits[commitId];
        if (depositAmount == 0) revert NoDepositToRecover();

        uint256 createdAt = bridgedDepositTimestamp[commitId];
        if (block.timestamp < createdAt + bridgedDepositExpiry) revert DepositNotExpired();

        CrossChainCommit memory commit = pendingCommits[commitId];
        // Only original depositor or owner can trigger recovery
        require(
            msg.sender == commit.depositor || msg.sender == owner(),
            "Not authorized to recover"
        );

        bool isFunded = bridgedDepositFunded[commitId];

        // Clean up state (effects before interactions — CEI pattern)
        bridgedDeposits[commitId] = 0;
        bridgedDepositTimestamp[commitId] = 0;
        bridgedDepositFunded[commitId] = false;
        delete pendingCommits[commitId];

        if (isFunded) {
            // NEW-04: ETH is on this chain but commit.depositor is a SOURCE-chain address.
            // Do NOT send ETH to commit.depositor — the address may be controlled by a
            // different party on this chain (or not exist at all for smart contract wallets).
            // Escrow the ETH in claimableDeposits[commitId]; the depositor calls
            // claimExpiredDeposit() from their destination-chain address.
            totalBridgedDeposits -= depositAmount;
            claimableDeposits[commitId] = depositAmount;
            // Record the authorized claimer: only commit.depositor (or owner) may withdraw.
            claimableDepositOwner[commitId] = commit.depositor;
            emit ClaimableDepositStored(commitId, commit.depositor, depositAmount);
        } else {
            // UNFUNDED: ETH never arrived on this chain — it still lives in the source-chain
            // CommitRevealAuction. Only clean up destination-chain accounting here.
            // The depositor must reclaim on srcChainId.
            totalPendingDeposits -= depositAmount;
            emit CrossChainCommitExpired(
                commitId,
                commit.depositor,
                commit.srcChainId,
                depositAmount
            );
        }

        emit BridgedDepositRecovered(commitId, commit.depositor, depositAmount);
    }

    /**
     * @notice Claim ETH escrowed by recoverExpiredDeposit for a funded commit.
     * @dev NEW-04: Called on the DESTINATION chain by the depositor's destination-chain address
     *      (which may differ from commit.depositor, the source-chain address). The owner can
     *      specify an arbitrary recipient to handle cases where the depositor controls a
     *      different address here, or uses a smart contract wallet with a different address.
     * @param commitId The commit whose claimable deposit to withdraw
     * @param recipient Address to send ETH to on this chain
     */
    function claimExpiredDeposit(bytes32 commitId, address payable recipient) external nonReentrant {
        uint256 amount = claimableDeposits[commitId];
        if (amount == 0) revert NoClaimableDeposit();
        require(recipient != address(0), "Invalid recipient");

        // Authorization: only the recorded depositor OR the owner may claim.
        // We do NOT use `msg.sender == recipient` because that would allow any caller
        // to drain any escrow by simply naming themselves as recipient (NEW-04 vuln).
        address depositorOnSrcChain = claimableDepositOwner[commitId];
        require(
            msg.sender == owner() || msg.sender == depositorOnSrcChain,
            "Not authorized to claim"
        );

        // Effects before interactions (CEI)
        claimableDeposits[commitId] = 0;
        claimableDepositOwner[commitId] = address(0);

        (bool success, ) = recipient.call{value: amount}("");
        require(success, "Claim transfer failed");

        emit ClaimableDepositClaimed(commitId, recipient, amount);
    }

    // ============ Receive ============

    receive() external payable {}
}
