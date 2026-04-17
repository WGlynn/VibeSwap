// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../core/interfaces/ICommitRevealAuction.sol";

/// @notice Interface for settlement confirmation callbacks to VibeSwapCore
interface IVibeSwapCoreSettlement {
    function markCrossChainSettled(bytes32 commitHash) external;
    function settleCrossChainOrder(bytes32 commitHash, bytes32 poolId, uint256 estimatedOut) external;
}

/**
 * @title CrossChainRouter
 * @author Faraday1 & JARVIS -- vibeswap.org
 * @notice LayerZero V2 compatible cross-chain router for order submission and liquidity sync
 * @dev Implements unified liquidity across chains with message rate limiting
 */
contract CrossChainRouter is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
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
        ASSET_TRANSFER,
        SETTLEMENT_CONFIRM  // XC-003: Dest→source confirmation that batch settled
    }

    struct CrossChainCommit {
        bytes32 commitHash;
        address depositor;
        uint256 depositAmount;
        uint32 srcChainId;
        uint32 dstChainId;    // FIX #1: Destination chain for replay prevention
        uint256 srcTimestamp; // Timestamp from source chain for consistent commit ID
        address destinationRecipient; // XC-005: Where tokens/refunds go on dest chain (smart wallet safe)
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
        bytes32[] filledCommitHashes; // XC-003: Source-chain commitHashes for settlement confirmation
    }

    /// @notice XC-003: Settlement confirmation sent from dest chain back to source chain
    struct SettlementConfirm {
        bytes32[] commitHashes;  // Original commit hashes (source chain uses these to mark settled)
        uint64 batchId;
        uint32 settledOnChain;   // Which chain settled the batch
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

    /// @notice C24-F2: Per-message cap on settlement array length. Bounds the
    ///         inbound loop inside _handleBatchResult / _handleSettlementConfirm.
    ///         A peer (malicious or compromised) sending oversized payloads would
    ///         otherwise burn the LZ gas budget iterating, potentially bricking
    ///         the channel for that srcEid.
    uint256 public constant MAX_SETTLEMENT_BATCH = 256;

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
    /// @dev TRP-R34-NEW01: Tracks funding status separately from deposit amount
    mapping(bytes32 => bool) public bridgedDepositFunded;

    /// @notice Total bridged deposits actually funded and held by this contract
    /// @dev TRP-R34-NEW01: Only incremented when real ETH arrives via fundBridgedDeposit(),
    ///      NEVER in _handleCommit(). Prevents phantom deposit inflation.
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

    /// @notice INT-R1-XC001: Maps routerCommitId → CRA commitId after funding.
    /// @dev The Router and CRA derive commitIds from different inputs. After fundBridgedDeposit
    ///      calls CRA.commitOrderCrossChain, the CRA returns its own commitId. We store the
    ///      mapping so _handleReveal can translate and call CRA with the correct ID.
    mapping(bytes32 => bytes32) public craCommitIds;

    /// @notice XC-003: VibeSwapCore address for settlement confirmation callbacks
    address public vibeSwapCore;

    /// @notice C15-AUDIT-1: Commits whose source-chain settlement callback reverted.
    ///         Tracks BatchResult.filledCommitHashes entries that failed on
    ///         `settleCrossChainOrder` or `markCrossChainSettled`. Because the outer
    ///         catch swallowed the revert for LZ-channel safety, the source chain's
    ///         `deposits[trader][token]` never decremented — letting the trader call
    ///         `VibeSwapCore.withdrawDeposit(token)` to reclaim the input while
    ///         having already received output on destination (double-spend).
    ///         Setter path: `_handleBatchResult` / `_handleSettlementConfirm` catch.
    ///         Resolver path: permissionless `retrySettlement*`.
    ///
    ///         Remaining surface (deferred): VibeSwapCore.withdrawDeposit does not
    ///         currently block on this flag. Until that layer is added, the
    ///         double-spend window is [BatchResult-received -> next retry]. Making
    ///         retry permissionless keeps that window tight.
    mapping(bytes32 => bool) public settlementFailed;

    /// @notice C15-AUDIT-1: Cached estimatedOut from the original BatchResult so
    ///         `retrySettlement` can re-invoke settleCrossChainOrder with the same
    ///         accounting data. poolId is paired via `failedSettlementPoolId`.
    mapping(bytes32 => uint256) public failedSettlementEstimatedOut;
    mapping(bytes32 => bytes32) public failedSettlementPoolId;

    /// @dev Reserved storage gap for future upgrades (reduced by 3 for settlementFailed maps)
    uint256[43] private __gap;

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
    /// @notice TRP-R34-NEW01: Emitted when a cross-chain commit is received but awaiting funding.
    event BridgedCommitPendingFunding(bytes32 indexed commitId, uint256 expectedAmount);
    /// @notice NEW-04: Emitted when an unfunded commit expires. Depositor must reclaim on srcChainId.
    event CrossChainCommitExpired(
        bytes32 indexed commitId,
        address indexed depositor,
        uint32  indexed srcChainId,
        uint256 depositAmount
    );
    /// @notice NEW-04: Emitted when funded-deposit ETH is escrowed after expiry.
    event ClaimableDepositStored(bytes32 indexed commitId, address indexed depositor, uint256 amount);
    /// @notice XC-003: Emitted when settlement confirmation is received from hub chain
    event SettlementConfirmReceived(uint64 indexed batchId, uint32 indexed srcEid, uint256 traderCount);
    /// @notice XC-003: Emitted when settlement confirmation is sent to source chain
    event SettlementConfirmSent(uint64 indexed batchId, uint32 indexed dstEid);
    /// @notice NEW-04: Emitted when escrowed ETH is claimed by the depositor on this chain.
    event ClaimableDepositClaimed(bytes32 indexed commitId, address indexed recipient, uint256 amount);

    /// @notice XC-003: Emitted when markCrossChainSettled fails (observability for silent try-catch)
    event SettlementMarkFailed(bytes32 indexed commitHash, bytes reason);

    /// @notice C15-AUDIT-1: Emitted when a previously-failed settlement is successfully retried.
    ///         Off-chain monitors can use this to close their alert on SettlementMarkFailed.
    event SettlementRetrySucceeded(bytes32 indexed commitHash);

    /// @dev TRP-R48-NEW05: Emitted when a liquidity sync is rejected for exceeding rate-of-change limits
    event LiquiditySyncRejected(bytes32 indexed poolId, uint32 indexed srcEid, uint256 maxDelta);

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
    error BatchTooLarge();

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
        __UUPSUpgradeable_init();

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
    /// @dev TRP-R48-NEW10: Added `depositor` parameter so VibeSwapCore can pass the
    ///      actual user address instead of recording itself (authorized caller) as depositor.
    /// @param destinationRecipient XC-005: Where tokens/refunds go on dest chain. Use depositor's
    ///        address if they control the same key on both chains, or a different address for
    ///        smart contract wallets (Gnosis Safe, AA) that differ across chains.
    function sendCommit(
        uint32 dstEid,
        bytes32 commitHash,
        uint256 depositAmount,
        bytes calldata options,
        address depositor,
        address destinationRecipient
    ) external payable nonReentrant onlyAuthorized {
        bytes32 peer = peers[dstEid];
        if (peer == bytes32(0)) revert InvalidPeer();
        require(depositor != address(0), "Invalid depositor");
        // XC-005: Default to depositor if no explicit recipient (backwards compatible for EOAs)
        if (destinationRecipient == address(0)) destinationRecipient = depositor;

        uint256 srcTimestamp = block.timestamp;

        // FIX #1 + TRP-R22-NEW02: Use localEid (not block.chainid) to match destination's commitId reconstruction.
        // block.chainid != localEid (EVM chain ID vs LayerZero endpoint ID).
        bytes32 commitId = keccak256(abi.encodePacked(
            depositor,
            commitHash,
            localEid,         // Must match _handleCommit's use of commit.srcChainId
            dstEid,           // Destination chain prevents replay on other chains
            srcTimestamp
        ));

        CrossChainCommit memory commit = CrossChainCommit({
            commitHash: commitHash,
            depositor: depositor,
            depositAmount: depositAmount,  // TRP-R22-H03: Explicit deposit, not msg.value
            srcChainId: localEid,
            dstChainId: dstEid,
            srcTimestamp: srcTimestamp,
            destinationRecipient: destinationRecipient
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
     * @notice XC-003: Send lightweight settlement confirmation to a specific source chain
     * @dev Used after batch settlement to prevent double-spend via timeout refund.
     *      Lighter than broadcastBatchResult when only commit hashes are needed.
     * @param confirm Settlement confirmation data
     * @param dstEid Source chain to notify
     * @param options LayerZero options
     */
    function sendSettlementConfirm(
        SettlementConfirm calldata confirm,
        uint32 dstEid,
        bytes calldata options
    ) external payable nonReentrant onlyAuthorized {
        bytes32 peer = peers[dstEid];
        require(peer != bytes32(0), "No peer for destination");

        bytes memory message = abi.encode(
            MessageType.SETTLEMENT_CONFIRM,
            abi.encode(confirm)
        );

        MessagingParams memory params = MessagingParams({
            dstEid: dstEid,
            receiver: peer,
            message: message,
            options: options,
            payInLzToken: false
        });

        _lzSend(params, msg.value);
        emit SettlementConfirmSent(confirm.batchId, dstEid);
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
        } else if (msgType == MessageType.SETTLEMENT_CONFIRM) {
            _handleSettlementConfirm(payload, _origin.srcEid);
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

        // TRP-R34-NEW01: Record expected deposit amount but do NOT credit totalBridgedDeposits.
        // No ETH has arrived yet — the message came via LayerZero without value transfer.
        // totalBridgedDeposits is only incremented in fundBridgedDeposit() when real ETH arrives.
        bridgedDeposits[commitId] = commit.depositAmount;
        bridgedDepositTimestamp[commitId] = block.timestamp;

        emit BridgedCommitPendingFunding(commitId, commit.depositAmount);
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
        require(!bridgedDepositFunded[commitId], "Already funded");

        // Cache deposit amount before state changes (CEI pattern)
        uint256 depositAmount = commit.depositAmount;
        uint256 excess = msg.value - depositAmount;

        // TRP-R34-NEW01: Mark as funded and clear pending state BEFORE external calls (CEI)
        bridgedDepositFunded[commitId] = true;
        bridgedDeposits[commitId] = 0;
        bridgedDepositTimestamp[commitId] = 0;
        // INT-R1-XC002: Do NOT delete pendingCommits here. _handleReveal needs commit.depositor
        // for ownership verification. The bridgedDepositFunded flag prevents double-funding.

        // TRP-R35-NEW03: Use commitOrderCrossChain to preserve original user as depositor
        // INT-R1-XC001: Capture CRA's commitId (derived from batchId + block.timestamp)
        // and store the mapping so _handleReveal can translate routerCommitId → craCommitId.
        // XC-005: Pass destinationRecipient so CRA stores it for settlement recipient override.
        bytes32 craCommitId = ICommitRevealAuction(auction).commitOrderCrossChain{value: depositAmount}(
            commit.depositor,
            commit.commitHash,
            commit.destinationRecipient
        );
        craCommitIds[commitId] = craCommitId;

        emit BridgedDepositFunded(commitId, depositAmount);

        // Refund excess
        if (excess > 0) {
            (bool success, ) = msg.sender.call{value: excess}("");
            require(success, "Refund failed");
        }
    }

    function _handleReveal(bytes memory payload, uint32 srcEid) internal {
        CrossChainReveal memory reveal = abi.decode(payload, (CrossChainReveal));

        // INT-R1-XC002: Get depositor from pendingCommits (no longer deleted in fundBridgedDeposit)
        CrossChainCommit memory commit = pendingCommits[reveal.commitId];

        // Verify commit exists and has been funded
        if (commit.depositor == address(0)) {
            emit CrossChainRevealFailed(reveal.commitId, srcEid, "Unknown commit");
            return;
        }
        if (!bridgedDepositFunded[reveal.commitId]) {
            emit CrossChainRevealFailed(reveal.commitId, srcEid, "Commit not yet funded");
            return;
        }

        // INT-R1-XC001: Translate routerCommitId → CRA commitId for the reveal call.
        // The CRA stores commitments under its own derived ID, not the router's.
        bytes32 craCommitId = craCommitIds[reveal.commitId];
        if (craCommitId == bytes32(0)) {
            emit CrossChainRevealFailed(reveal.commitId, srcEid, "No CRA commit mapping");
            return;
        }

        // TRP-R48-NEW07: Cross-chain priority bids are not supported until explicit
        // user pre-funding is implemented. Previously, the router silently used its
        // surplus ETH balance for priority bids the user never paid for.
        uint256 priorityBidToSend = 0;

        ICommitRevealAuction auctionContract = ICommitRevealAuction(auction);

        // Use revealOrderCrossChain with the CRA's commitId (not the router's)
        try auctionContract.revealOrderCrossChain{value: priorityBidToSend}(
            craCommitId,          // INT-R1-XC001: Use CRA's commitId
            commit.depositor,     // Original depositor from our records
            reveal.tokenIn,
            reveal.tokenOut,
            reveal.amountIn,
            reveal.minAmountOut,
            reveal.secret,
            priorityBidToSend
        ) {
            // Clean up pendingCommits after successful reveal (not before)
            delete pendingCommits[reveal.commitId];
        } catch {
            // If reveal fails, log but don't revert the whole message
            emit CrossChainRevealFailed(reveal.commitId, srcEid, "Reveal rejected");
        }

        emit CrossChainRevealReceived(reveal.commitId, srcEid);
    }

    /// @notice XC-003/XC-004: Process batch settlement results from hub chain.
    ///      Settles cross-chain orders on the source chain: marks settled, decrements deposits,
    ///      and records execution for incentive/compliance tracking.
    ///      XC-003: Blocks timeout refunds for filled orders (double-spend prevention).
    ///      XC-004: Decrements deposits so traders can't withdrawDeposit() after settlement.
    ///
    ///      Asset transfers (OFT/bridge) back to source chain are handled separately by the
    ///      bridge operator after verifying the batch result. This function handles state only.
    function _handleBatchResult(bytes memory payload, uint32 srcEid) internal {
        BatchResult memory result = abi.decode(payload, (BatchResult));
        // C24-F2: cap attacker-supplied array length to bound iteration gas
        if (result.filledCommitHashes.length > MAX_SETTLEMENT_BATCH) revert BatchTooLarge();

        if (vibeSwapCore != address(0) && result.filledCommitHashes.length > 0) {
            for (uint256 i = 0; i < result.filledCommitHashes.length;) {
                // XC-004: Full settlement with execution recording.
                // filledAmounts[i] = estimated output for this order from the destination chain.
                uint256 estimatedOut = i < result.filledAmounts.length ? result.filledAmounts[i] : 0;
                bytes32 commitHash = result.filledCommitHashes[i];

                try IVibeSwapCoreSettlement(vibeSwapCore).settleCrossChainOrder(
                    commitHash,
                    result.poolId,
                    estimatedOut
                ) {
                    // Success — if a prior retry had been queued, clear it.
                    if (settlementFailed[commitHash]) {
                        settlementFailed[commitHash] = false;
                        delete failedSettlementEstimatedOut[commitHash];
                        delete failedSettlementPoolId[commitHash];
                    }
                } catch (bytes memory reason) {
                    // C15-AUDIT-1: record failure + cache retry args. Without this, a
                    // transient revert (paused core, OOG within the lz gas budget,
                    // CrossChainOrderAlreadySettled replay) silently left the source-side
                    // deposit un-decremented. Trader could then withdrawDeposit(token)
                    // on source while already holding output on destination.
                    settlementFailed[commitHash] = true;
                    failedSettlementEstimatedOut[commitHash] = estimatedOut;
                    failedSettlementPoolId[commitHash] = result.poolId;
                    emit SettlementMarkFailed(commitHash, reason);
                }
                unchecked { ++i; }
            }
        }

        emit BatchResultReceived(result.batchId, srcEid);
        emit SettlementConfirmReceived(result.batchId, srcEid, result.filledCommitHashes.length);
    }

    /// @notice XC-003: Handle direct settlement confirmation from hub chain
    /// @dev Used when hub sends a lightweight confirmation without full batch results
    function _handleSettlementConfirm(bytes memory payload, uint32 srcEid) internal {
        SettlementConfirm memory confirm = abi.decode(payload, (SettlementConfirm));
        // C24-F2: cap attacker-supplied array length to bound iteration gas
        if (confirm.commitHashes.length > MAX_SETTLEMENT_BATCH) revert BatchTooLarge();

        if (vibeSwapCore != address(0)) {
            for (uint256 i = 0; i < confirm.commitHashes.length;) {
                bytes32 commitHash = confirm.commitHashes[i];
                try IVibeSwapCoreSettlement(vibeSwapCore).markCrossChainSettled(
                    commitHash
                ) {
                    if (settlementFailed[commitHash]) {
                        settlementFailed[commitHash] = false;
                        delete failedSettlementEstimatedOut[commitHash];
                        delete failedSettlementPoolId[commitHash];
                    }
                } catch (bytes memory reason) {
                    // C15-AUDIT-1: record failure for retry. Unlike the BatchResult path,
                    // the lightweight confirmation does NOT carry poolId/estimatedOut — the
                    // retry routes through markCrossChainSettled (no execution recording).
                    // estimatedOut stays 0 to signal the lightweight-retry path.
                    settlementFailed[commitHash] = true;
                    emit SettlementMarkFailed(commitHash, reason);
                }
                unchecked { ++i; }
            }
        }

        emit SettlementConfirmReceived(confirm.batchId, srcEid, confirm.commitHashes.length);
    }

    /// @notice C15-AUDIT-1: Permissionless retry for a settlement that caught during
    ///         BatchResult processing. Uses the cached poolId + estimatedOut recorded
    ///         when the original call reverted. Anyone observing SettlementMarkFailed
    ///         can trigger this to close the double-spend window.
    /// @dev    Emits SettlementRetrySucceeded on success. On revert, propagates so the
    ///         caller sees the underlying cause (pause, replay, etc.). The
    ///         `settlementFailed` flag stays set until a successful retry or
    ///         subsequent BatchResult/Confirm receipt clears it.
    function retrySettlementOrder(bytes32 commitHash) external nonReentrant {
        require(vibeSwapCore != address(0), "No core");
        require(settlementFailed[commitHash], "Not pending");
        bytes32 poolId = failedSettlementPoolId[commitHash];
        uint256 estimatedOut = failedSettlementEstimatedOut[commitHash];
        // Clear BEFORE the external call (CEI) — on success we stay cleared;
        // on revert the tx rolls back and the flag reappears naturally.
        settlementFailed[commitHash] = false;
        delete failedSettlementEstimatedOut[commitHash];
        delete failedSettlementPoolId[commitHash];
        IVibeSwapCoreSettlement(vibeSwapCore).settleCrossChainOrder(
            commitHash,
            poolId,
            estimatedOut
        );
        emit SettlementRetrySucceeded(commitHash);
    }

    /// @notice C15-AUDIT-1: Permissionless retry for the lightweight SettlementConfirm
    ///         path (markCrossChainSettled only, no execution recording).
    function retrySettlementMark(bytes32 commitHash) external nonReentrant {
        require(vibeSwapCore != address(0), "No core");
        require(settlementFailed[commitHash], "Not pending");
        // Only the lightweight path caches estimatedOut == 0; the full-settle path
        // caches the real value. If the retry caller intends the lightweight path
        // they should use this function; if the BatchResult path, they should use
        // retrySettlementOrder. Choosing the wrong path is harmless — wrong retry
        // reverts or no-ops.
        settlementFailed[commitHash] = false;
        delete failedSettlementEstimatedOut[commitHash];
        delete failedSettlementPoolId[commitHash];
        IVibeSwapCoreSettlement(vibeSwapCore).markCrossChainSettled(commitHash);
        emit SettlementRetrySucceeded(commitHash);
    }

    /// @dev TRP-R48-NEW05: Rate-of-change validation prevents spoofed liquidity from a compromised peer.
    ///      Rejects syncs where either reserve changes by >50% in a single update.
    ///      First sync for a pool is accepted unconditionally.
    function _handleLiquiditySync(bytes memory payload, uint32 srcEid) internal {
        LiquiditySync memory sync = abi.decode(payload, (LiquiditySync));

        LiquiditySync storage current = liquidityState[sync.poolId];

        // If pool already has state, validate rate of change
        if (current.totalLiquidity > 0) {
            // Reject >50% change in either reserve (compromised peer protection)
            uint256 maxDelta0 = current.reserve0 / 2;
            uint256 maxDelta1 = current.reserve1 / 2;
            uint256 delta0 = sync.reserve0 > current.reserve0
                ? sync.reserve0 - current.reserve0
                : current.reserve0 - sync.reserve0;
            uint256 delta1 = sync.reserve1 > current.reserve1
                ? sync.reserve1 - current.reserve1
                : current.reserve1 - sync.reserve1;

            if (delta0 > maxDelta0 || delta1 > maxDelta1) {
                emit LiquiditySyncRejected(
                    sync.poolId, srcEid,
                    delta0 > delta1 ? delta0 : delta1
                );
                return; // Silently reject — don't revert the LZ message
            }
        }

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

    /// @notice XC-003: Set VibeSwapCore address for settlement confirmation callbacks
    function setVibeSwapCore(address _core) external onlyOwner {
        require(_core != address(0), "Invalid core");
        vibeSwapCore = _core;
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
            // XC-005: Use destinationRecipient instead of source-chain depositor address.
            // The depositor address may not exist or be controlled by a different party
            // on this chain (smart contract wallets). destinationRecipient was explicitly
            // chosen by the user at commit time for this chain.
            address escrowOwner = commit.destinationRecipient != address(0)
                ? commit.destinationRecipient
                : commit.depositor; // Backwards compat: fallback to depositor
            claimableDepositOwner[commitId] = escrowOwner;
            emit ClaimableDepositStored(commitId, escrowOwner, depositAmount);
        } else {
            // UNFUNDED: ETH never arrived — only clean up accounting.
            // The depositor must reclaim on srcChainId.
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

    // ============ UUPS Upgrade Authorization ============

    /// @dev TRP-R45-INT01: Required for UUPSUpgradeable. Only owner can authorize upgrades.
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
