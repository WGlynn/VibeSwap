// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/ICommitRevealAuction.sol";
import "./PoolComplianceConfig.sol";
import "../libraries/DeterministicShuffle.sol";
import "../libraries/ProofOfWorkLib.sol";

/// @notice Minimal interface for ComplianceRegistry tier lookups
interface IComplianceRegistry {
    function getUserProfile(address user) external view returns (
        uint8 tier,
        uint8 status,
        uint64 kycTimestamp,
        uint64 kycExpiry,
        bytes2 jurisdiction,
        uint256 dailyVolumeUsed,
        uint256 lastVolumeReset,
        string memory kycProvider,
        bytes32 kycHash
    );
    function isInGoodStanding(address user) external view returns (bool);
    function getKYCStatus(address user) external view returns (bool hasKYC, bool isValid);
    function isAccredited(address user) external view returns (bool);
}

/**
 * @title CommitRevealAuction
 * @notice Implements commit-reveal mechanism with priority auction for MEV-resistant trading
 * @dev Uses 10-second batches with 8s commit + 2s reveal phases (PROTOCOL CONSTANTS)
 */
contract CommitRevealAuction is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    ICommitRevealAuction
{
    using SafeERC20 for IERC20;
    using DeterministicShuffle for bytes32[];
    using ProofOfWorkLib for ProofOfWorkLib.PoWProof;

    // ============ Custom Errors (Gas Optimized) ============

    error NotAuthorized();
    error InvalidPhase();
    error InsufficientDeposit();
    error InvalidHash();
    error AlreadyCommitted();
    error InvalidCommitment();
    error WrongBatch();
    error NotOwner();
    error InsufficientPriorityBid();
    error InvalidPoWProof();
    error PoWAlreadyUsed();
    error BatchNotReady();
    error AlreadySettled();
    error UserTierBlocked();
    error KYCRequired();
    error UserNotInGoodStanding();
    error BatchNotSettled();
    error NotRevealed();
    error TransferFailed();
    error NotSlashable();
    error InvalidTreasury();
    error PoolNotFound();
    error PoolAlreadyExists();
    error InvalidPoolConfig();
    error UserBelowMinTier();
    error JurisdictionBlocked();
    error AccreditationRequired();
    error TradeSizeExceeded();
    error FlashLoanDetected();

    // ============ Protocol Constants (Uniform Fairness) ============
    // These are FIXED for all pools - they define HOW trading works
    // Pools can only vary WHO can trade, not the execution rules

    /// @notice Commit phase duration (PROTOCOL CONSTANT)
    uint256 public constant COMMIT_DURATION = 8; // 8 seconds

    /// @notice Reveal phase duration (PROTOCOL CONSTANT)
    uint256 public constant REVEAL_DURATION = 2; // 2 seconds

    /// @notice Total batch duration
    uint256 public constant BATCH_DURATION = COMMIT_DURATION + REVEAL_DURATION;

    /// @notice Minimum deposit required (PROTOCOL CONSTANT)
    /// @dev Same for everyone - uniform skin in the game
    uint256 public constant MIN_DEPOSIT = 0.001 ether;

    /// @notice Collateral as basis points of trade value (PROTOCOL CONSTANT)
    /// @dev 5% collateral required for all trades
    uint256 public constant COLLATERAL_BPS = 500; // 5%

    /// @notice Slash rate for invalid/unrevealed commits (PROTOCOL CONSTANT)
    /// @dev 50% penalty - strong incentive to reveal honestly
    uint256 public constant SLASH_RATE_BPS = 5000; // 50%

    /// @notice Maximum trade size as basis points of pool reserves (PROTOCOL CONSTANT)
    /// @dev 10% max to prevent excessive slippage
    uint256 public constant MAX_TRADE_SIZE_BPS = 1000; // 10%

    // ============ Pool Access Control (Immutable Per-Pool) ============
    // Pools only differ in WHO can trade, not HOW trading works

    /// @notice Immutable access control configurations per pool
    /// @dev Set once at pool creation, cannot be modified
    mapping(bytes32 => PoolComplianceConfig.Config) public poolConfigs;

    /// @notice Compliance registry for user tier/KYC lookups
    /// @dev Only used for reading user data, not for admin control
    address public complianceRegistry;

    /// @notice Pool counter for generating unique pool IDs
    uint256 public poolCount;

    /// @notice Last block each user interacted (flash loan protection - ALWAYS ON)
    mapping(address => uint256) public lastInteractionBlock;

    // ============ State ============

    /// @notice Current batch ID
    uint64 public currentBatchId;

    /// @notice Timestamp when current batch started
    uint64 public batchStartTime;

    /// @notice Mapping of batch ID to batch data
    mapping(uint64 => Batch) public batches;

    /// @notice Mapping of commit ID to commitment
    mapping(bytes32 => OrderCommitment) public commitments;

    /// @notice Mapping of batch ID to revealed orders
    mapping(uint64 => RevealedOrder[]) internal revealedOrders;

    /// @notice Mapping of batch ID to secrets (for shuffle seed)
    mapping(uint64 => bytes32[]) internal batchSecrets;

    /// @notice Mapping of batch ID to priority order indices
    mapping(uint64 => uint256[]) internal priorityOrderIndices;

    /// @notice Authorized settlers (VibeSwapCore, CrossChainRouter)
    mapping(address => bool) public authorizedSettlers;

    /// @notice DAO treasury address for slashed funds
    address public treasury;

    // ============ Proof-of-Work State ============

    /// @notice Base value per difficulty bit for PoW priority (in wei)
    uint256 public powBaseValue;

    /// @notice Mapping of used PoW proof hashes (prevents replay)
    mapping(bytes32 => bool) public usedPoWProofs;

    // ============ Security Fix #3: Shuffle Seed Entropy ============

    /// @notice Block number when reveal phase ended (for secure shuffle seed)
    mapping(uint64 => uint256) public batchRevealEndBlock;

    // ============ Security Fix #4: Slashed Funds Recovery ============

    /// @notice Slashed funds held when treasury transfer fails
    uint256 public pendingSlashedFunds;

    /// @notice Slashed amounts per user (for recovery if treasury was broken)
    mapping(address => uint256) public userSlashedAmounts;

    // ============ Security Fix #7: Excess ETH Refund ============

    event ExcessETHRefundFailed(address indexed user, uint256 amount);

    // ============ Modifiers ============

    modifier onlyAuthorizedSettler() {
        if (!authorizedSettlers[msg.sender]) revert NotAuthorized();
        _;
    }

    modifier inPhase(BatchPhase required) {
        if (getCurrentPhase() != required) revert InvalidPhase();
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
     * @param _treasury DAO treasury address
     * @param _complianceRegistry ComplianceRegistry for user tier lookups (can be address(0))
     */
    function initialize(
        address _owner,
        address _treasury,
        address _complianceRegistry
    ) external initializer {
        __Ownable_init(_owner);
        __ReentrancyGuard_init();

        treasury = _treasury;
        complianceRegistry = _complianceRegistry;
        currentBatchId = 1;
        batchStartTime = uint64(block.timestamp);
        powBaseValue = 0.0001 ether; // ~$0.25 at $2500 ETH

        // Initialize first batch
        // Note: Batch timing uses PROTOCOL CONSTANTS (COMMIT_DURATION, REVEAL_DURATION)
        batches[currentBatchId] = Batch({
            batchId: currentBatchId,
            startTimestamp: batchStartTime,
            phase: BatchPhase.COMMIT,
            shuffleSeed: bytes32(0),
            totalPriorityBids: 0,
            orderCount: 0,
            isSettled: false
        });
    }

    // ============ Pool Creation (Permissionless, Immutable) ============

    /**
     * @notice Create a new pool with a preset access control configuration
     * @dev Anyone can create a pool. Access rules are IMMUTABLE after creation.
     *      Safety parameters (collateral, slashing, timing) are PROTOCOL CONSTANTS.
     * @param preset The preset type (OPEN, RETAIL, ACCREDITED, INSTITUTIONAL)
     * @return poolId The unique pool identifier
     */
    function createPoolFromPreset(
        PoolComplianceConfig.PoolPreset preset
    ) external returns (bytes32 poolId) {
        poolId = _generatePoolId(msg.sender);
        if (poolConfigs[poolId].initialized) revert PoolAlreadyExists();

        PoolComplianceConfig.Config memory config = PoolComplianceConfig.fromPreset(preset);
        config.initialized = true;

        // Store immutable access control config
        _storePoolConfig(poolId, config);

        emit PoolComplianceConfig.PoolAccessConfigCreated(
            poolId,
            preset,
            config.poolType,
            config.minTierRequired,
            config.kycRequired,
            config.accreditationRequired
        );
    }

    /**
     * @notice Create a new pool with custom access control configuration
     * @dev Anyone can create a pool. Access rules are IMMUTABLE after creation.
     *      Safety parameters (collateral, slashing, timing) are PROTOCOL CONSTANTS.
     * @param minTierRequired Minimum user tier to trade (0=open, 2=retail, 3=accredited, 4=institutional)
     * @param kycRequired Whether KYC verification is required
     * @param accreditationRequired Whether accredited investor status is required
     * @param maxTradeSize Maximum single trade size (0 = protocol default)
     * @param blockedJurisdictions ISO country codes that cannot trade
     * @param poolType Human-readable pool type name
     * @return poolId The unique pool identifier
     */
    function createPoolWithCustomAccess(
        uint8 minTierRequired,
        bool kycRequired,
        bool accreditationRequired,
        uint256 maxTradeSize,
        bytes2[] memory blockedJurisdictions,
        string memory poolType
    ) external returns (bytes32 poolId) {
        poolId = _generatePoolId(msg.sender);
        if (poolConfigs[poolId].initialized) revert PoolAlreadyExists();

        // Store immutable access control config
        PoolComplianceConfig.Config storage config = poolConfigs[poolId];
        config.minTierRequired = minTierRequired;
        config.kycRequired = kycRequired;
        config.accreditationRequired = accreditationRequired;
        config.maxTradeSize = maxTradeSize;
        config.poolType = poolType;
        config.initialized = true;

        for (uint256 i = 0; i < blockedJurisdictions.length; i++) {
            config.blockedJurisdictions.push(blockedJurisdictions[i]);
        }

        emit PoolComplianceConfig.PoolAccessConfigCreated(
            poolId,
            PoolComplianceConfig.PoolPreset.OPEN, // Custom uses OPEN as base
            poolType,
            minTierRequired,
            kycRequired,
            accreditationRequired
        );
    }

    // ============ External Functions ============

    /**
     * @notice Commit an order hash for the current batch (legacy, uses default open pool)
     * @param commitHash Hash of (trader, tokenIn, tokenOut, amountIn, minAmountOut, secret)
     * @return commitId Unique identifier for this commitment
     */
    function commitOrder(
        bytes32 commitHash
    ) external payable returns (bytes32 commitId) {
        // Delegates to commitOrderToPool which has nonReentrant + inPhase guards
        return commitOrderToPool(bytes32(0), commitHash, 0);
    }

    /**
     * @notice Commit an order hash to a specific pool
     * @param poolId The pool to commit to (bytes32(0) for default open pool)
     * @param commitHash Hash of (trader, tokenIn, tokenOut, amountIn, minAmountOut, secret)
     * @param estimatedTradeValue Estimated trade value for collateral calculation
     * @return commitId Unique identifier for this commitment
     */
    function commitOrderToPool(
        bytes32 poolId,
        bytes32 commitHash,
        uint256 estimatedTradeValue
    ) public payable nonReentrant inPhase(BatchPhase.COMMIT) returns (bytes32 commitId) {
        if (commitHash == bytes32(0)) revert InvalidHash();

        // Get pool access config (for WHO can trade)
        PoolComplianceConfig.Config storage config = _getPoolConfig(poolId);

        // Validate user against pool ACCESS requirements
        _validateUserForPool(config, msg.sender, estimatedTradeValue);

        // Flash loan protection - ALWAYS ON (protocol constant)
        if (lastInteractionBlock[msg.sender] == block.number) {
            revert FlashLoanDetected();
        }
        lastInteractionBlock[msg.sender] = block.number;

        // Calculate required deposit using PROTOCOL CONSTANTS
        uint256 collateralRequired = (estimatedTradeValue * COLLATERAL_BPS) / 10000;
        uint256 requiredDeposit = collateralRequired > MIN_DEPOSIT ? collateralRequired : MIN_DEPOSIT;
        if (msg.value < requiredDeposit) revert InsufficientDeposit();

        // Generate unique commit ID
        commitId = keccak256(abi.encodePacked(
            msg.sender,
            commitHash,
            poolId,
            currentBatchId,
            block.timestamp
        ));

        if (commitments[commitId].status != CommitStatus.NONE) revert AlreadyCommitted();

        commitments[commitId] = OrderCommitment({
            commitHash: commitHash,
            poolId: poolId,
            batchId: currentBatchId,
            depositAmount: msg.value,
            depositor: msg.sender,
            status: CommitStatus.COMMITTED
        });

        batches[currentBatchId].orderCount++;

        emit OrderCommitted(commitId, msg.sender, currentBatchId, msg.value);
    }

    /**
     * @notice Reveal a previously committed order
     * @param commitId The commitment ID from commitOrder
     * @param tokenIn Token being sold
     * @param tokenOut Token being bought
     * @param amountIn Amount of tokenIn
     * @param minAmountOut Minimum acceptable tokenOut
     * @param secret Secret used in commitment
     * @param priorityBid Additional bid for priority execution
     */
    function revealOrder(
        bytes32 commitId,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        bytes32 secret,
        uint256 priorityBid
    ) external payable nonReentrant inPhase(BatchPhase.REVEAL) {
        OrderCommitment storage commitment = commitments[commitId];

        if (commitment.status != CommitStatus.COMMITTED) revert InvalidCommitment();
        if (commitment.batchId != currentBatchId) revert WrongBatch();
        if (commitment.depositor != msg.sender) revert NotOwner();

        // Verify commitment hash
        bytes32 expectedHash = keccak256(abi.encodePacked(
            msg.sender,
            tokenIn,
            tokenOut,
            amountIn,
            minAmountOut,
            secret
        ));

        if (expectedHash != commitment.commitHash) {
            // Invalid reveal - slash deposit
            _slashCommitment(commitId);
            return;
        }

        // Verify priority bid payment
        if (priorityBid > 0) {
            if (msg.value < priorityBid) revert InsufficientPriorityBid();
        }

        commitment.status = CommitStatus.REVEALED;

        // Store revealed order
        uint256 orderIndex = revealedOrders[currentBatchId].length;

        revealedOrders[currentBatchId].push(RevealedOrder({
            trader: msg.sender,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: amountIn,
            minAmountOut: minAmountOut,
            secret: secret,
            priorityBid: priorityBid,
            srcChainId: uint32(block.chainid)
        }));

        // Track priority orders
        if (priorityBid > 0) {
            priorityOrderIndices[currentBatchId].push(orderIndex);
            batches[currentBatchId].totalPriorityBids += priorityBid;
        }

        // Store secret for shuffle seed
        batchSecrets[currentBatchId].push(secret);

        // FIX #7: Refund excess ETH beyond priority bid
        uint256 excess = msg.value - priorityBid;
        if (excess > 0) {
            (bool refundSuccess, ) = msg.sender.call{value: excess}("");
            // If refund fails, excess stays in contract (user's problem if they use a non-receivable contract)
            if (!refundSuccess) {
                emit ExcessETHRefundFailed(msg.sender, excess);
            }
        }

        emit OrderRevealed(
            commitId,
            msg.sender,
            currentBatchId,
            tokenIn,
            tokenOut,
            amountIn,
            priorityBid
        );
    }

    /**
     * @notice Reveal a committed order with optional proof-of-work for priority
     * @dev PoW can be used instead of or in addition to ETH priority bids
     * @param commitId The commitment ID from commitOrder
     * @param tokenIn Token being sold
     * @param tokenOut Token being bought
     * @param amountIn Amount of tokenIn
     * @param minAmountOut Minimum acceptable tokenOut
     * @param secret Secret used in commitment
     * @param priorityBid Additional ETH bid for priority execution
     * @param powNonce Nonce for proof-of-work (bytes32(0) if not using PoW)
     * @param powAlgorithm 0 = Keccak256, 1 = SHA256
     * @param claimedDifficulty Difficulty bits claimed for PoW
     */
    function revealOrderWithPoW(
        bytes32 commitId,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        bytes32 secret,
        uint256 priorityBid,
        bytes32 powNonce,
        uint8 powAlgorithm,
        uint8 claimedDifficulty
    ) external payable nonReentrant inPhase(BatchPhase.REVEAL) {
        OrderCommitment storage commitment = commitments[commitId];

        if (commitment.status != CommitStatus.COMMITTED) revert InvalidCommitment();
        if (commitment.batchId != currentBatchId) revert WrongBatch();
        if (commitment.depositor != msg.sender) revert NotOwner();

        // Verify commitment hash
        bytes32 expectedHash = keccak256(abi.encodePacked(
            msg.sender,
            tokenIn,
            tokenOut,
            amountIn,
            minAmountOut,
            secret
        ));

        if (expectedHash != commitment.commitHash) {
            // Invalid reveal - slash deposit
            _slashCommitment(commitId);
            return;
        }

        // Verify ETH priority bid payment
        if (priorityBid > 0) {
            if (msg.value < priorityBid) revert InsufficientPriorityBid();
        }

        // Calculate PoW value if proof submitted
        uint256 powValue = 0;
        if (claimedDifficulty > 0 && powNonce != bytes32(0)) {
            // Generate challenge unique to this trader and batch
            bytes32 challenge = ProofOfWorkLib.generateChallenge(
                msg.sender,
                currentBatchId,
                bytes32(0) // No pool ID for priority
            );

            // Create proof struct
            ProofOfWorkLib.PoWProof memory proof = ProofOfWorkLib.PoWProof({
                challenge: challenge,
                nonce: powNonce,
                algorithm: ProofOfWorkLib.Algorithm(powAlgorithm)
            });

            // Verify the proof meets claimed difficulty
            if (!ProofOfWorkLib.verify(proof, claimedDifficulty)) revert InvalidPoWProof();

            // Prevent replay: mark proof as used
            bytes32 proofHash = ProofOfWorkLib.computeProofHash(challenge, powNonce);
            if (usedPoWProofs[proofHash]) revert PoWAlreadyUsed();
            usedPoWProofs[proofHash] = true;

            // Convert difficulty to ETH-equivalent value
            powValue = ProofOfWorkLib.difficultyToValue(claimedDifficulty, powBaseValue);

            emit PoWProofAccepted(commitId, msg.sender, claimedDifficulty, powValue);
        }

        commitment.status = CommitStatus.REVEALED;

        // Store revealed order
        uint256 orderIndex = revealedOrders[currentBatchId].length;

        revealedOrders[currentBatchId].push(RevealedOrder({
            trader: msg.sender,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: amountIn,
            minAmountOut: minAmountOut,
            secret: secret,
            priorityBid: priorityBid + powValue, // Combined ETH + PoW value
            srcChainId: uint32(block.chainid)
        }));

        // Track priority orders (if any priority from ETH or PoW)
        uint256 effectivePriority = priorityBid + powValue;
        if (effectivePriority > 0) {
            priorityOrderIndices[currentBatchId].push(orderIndex);
            batches[currentBatchId].totalPriorityBids += effectivePriority;
        }

        // Store secret for shuffle seed
        batchSecrets[currentBatchId].push(secret);

        emit OrderRevealed(
            commitId,
            msg.sender,
            currentBatchId,
            tokenIn,
            tokenOut,
            amountIn,
            effectivePriority
        );
    }

    /**
     * @notice Advance batch phase (time-based)
     */
    function advancePhase() external {
        Batch storage batch = batches[currentBatchId];
        BatchPhase currentPhase = getCurrentPhase();

        if (currentPhase != batch.phase) {
            BatchPhase oldPhase = batch.phase;
            batch.phase = currentPhase;

            emit BatchPhaseChanged(currentBatchId, oldPhase, currentPhase);

            // If moving to SETTLING, record reveal end block for secure seed generation
            if (currentPhase == BatchPhase.SETTLING && !batch.isSettled) {
                // FIX #3: Record block number for unpredictable entropy
                batchRevealEndBlock[currentBatchId] = block.number;
                // Seed will be generated in settleBatch with block entropy
            }
        }
    }

    /**
     * @notice Settle the current batch
     */
    function settleBatch() external onlyAuthorizedSettler nonReentrant {
        Batch storage batch = batches[currentBatchId];

        BatchPhase phase = getCurrentPhase();
        if (phase != BatchPhase.SETTLING && phase != BatchPhase.SETTLED) revert BatchNotReady();
        if (batch.isSettled) revert AlreadySettled();

        // FIX #3: Generate shuffle seed with unpredictable block entropy
        // This prevents last revealer from computing favorable shuffle position
        if (batch.shuffleSeed == bytes32(0)) {
            uint256 revealEndBlock = batchRevealEndBlock[currentBatchId];

            // Get block entropy from after reveal phase ended
            // If we're in the same block, use previous block hash
            bytes32 blockEntropy;
            if (revealEndBlock > 0 && block.number > revealEndBlock) {
                // Use blockhash of reveal end block (unpredictable during reveal)
                blockEntropy = blockhash(revealEndBlock);
            } else {
                // Fallback: use previous block hash + current block data
                blockEntropy = keccak256(abi.encodePacked(
                    blockhash(block.number - 1),
                    block.timestamp,
                    block.prevrandao  // Beacon chain randomness (post-merge)
                ));
            }

            batch.shuffleSeed = batchSecrets[currentBatchId].generateSeedSecure(
                blockEntropy,
                currentBatchId
            );
        }

        batch.phase = BatchPhase.SETTLED;
        batch.isSettled = true;

        emit BatchSettled(
            currentBatchId,
            revealedOrders[currentBatchId].length,
            batch.totalPriorityBids,
            batch.shuffleSeed
        );

        // Slash unrevealed commitments
        // Note: This is handled lazily when users try to withdraw

        // Start new batch
        _startNewBatch();
    }

    /**
     * @notice Get execution order for a settled batch
     * @param batchId Batch ID
     * @return indices Order indices in execution order
     */
    function getExecutionOrder(uint64 batchId) external view returns (uint256[] memory indices) {
        Batch storage batch = batches[batchId];
        if (!batch.isSettled) revert BatchNotSettled();

        uint256 totalOrders = revealedOrders[batchId].length;
        uint256[] memory priorityIndices = priorityOrderIndices[batchId];

        // Sort priority orders by bid (descending) - simplified bubble sort for small arrays
        uint256[] memory sortedPriority = _sortPriorityOrders(batchId, priorityIndices);

        // Get non-priority indices
        uint256 regularCount = totalOrders - sortedPriority.length;
        uint256[] memory regularIndices = new uint256[](regularCount);
        uint256 regularIdx = 0;

        for (uint256 i = 0; i < totalOrders; i++) {
            bool isPriority = false;
            for (uint256 j = 0; j < sortedPriority.length; j++) {
                if (sortedPriority[j] == i) {
                    isPriority = true;
                    break;
                }
            }
            if (!isPriority) {
                regularIndices[regularIdx++] = i;
            }
        }

        // Shuffle regular orders
        uint256[] memory shuffledRegular = DeterministicShuffle.shuffle(
            regularCount,
            batch.shuffleSeed
        );

        // Combine: priority first, then shuffled regular
        indices = new uint256[](totalOrders);

        for (uint256 i = 0; i < sortedPriority.length; i++) {
            indices[i] = sortedPriority[i];
        }

        for (uint256 i = 0; i < regularCount; i++) {
            indices[sortedPriority.length + i] = regularIndices[shuffledRegular[i]];
        }
    }

    /**
     * @notice Withdraw deposit after batch settlement (for revealed orders)
     * @param commitId Commitment ID
     */
    function withdrawDeposit(bytes32 commitId) external nonReentrant {
        OrderCommitment storage commitment = commitments[commitId];

        if (commitment.depositor != msg.sender) revert NotOwner();
        if (commitment.status != CommitStatus.REVEALED) revert NotRevealed();
        if (!batches[commitment.batchId].isSettled) revert BatchNotSettled();

        commitment.status = CommitStatus.EXECUTED;

        // Return deposit
        (bool success, ) = msg.sender.call{value: commitment.depositAmount}("");
        if (!success) revert TransferFailed();
    }

    /**
     * @notice Slash unrevealed commitments after batch settlement
     * @param commitId Commitment ID of unrevealed order
     */
    function slashUnrevealedCommitment(bytes32 commitId) external nonReentrant {
        OrderCommitment storage commitment = commitments[commitId];

        if (commitment.status != CommitStatus.COMMITTED) revert NotSlashable();
        if (!batches[commitment.batchId].isSettled) revert BatchNotSettled();

        // Slash the unrevealed commitment
        _slashCommitment(commitId);
    }

    /**
     * @notice Reveal order on behalf of cross-chain user (called by router)
     * @dev Skips msg.sender check for cross-chain reveals
     */
    function revealOrderCrossChain(
        bytes32 commitId,
        address originalDepositor,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        bytes32 secret,
        uint256 priorityBid
    ) external payable nonReentrant onlyAuthorizedSettler inPhase(BatchPhase.REVEAL) {
        OrderCommitment storage commitment = commitments[commitId];

        if (commitment.status != CommitStatus.COMMITTED) revert InvalidCommitment();
        if (commitment.batchId != currentBatchId) revert WrongBatch();

        // Verify commitment hash (using original depositor, not msg.sender)
        bytes32 expectedHash = keccak256(abi.encodePacked(
            originalDepositor,
            tokenIn,
            tokenOut,
            amountIn,
            minAmountOut,
            secret
        ));

        if (expectedHash != commitment.commitHash) {
            _slashCommitment(commitId);
            return;
        }

        commitment.status = CommitStatus.REVEALED;

        uint256 orderIndex = revealedOrders[currentBatchId].length;

        revealedOrders[currentBatchId].push(RevealedOrder({
            trader: originalDepositor,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: amountIn,
            minAmountOut: minAmountOut,
            secret: secret,
            priorityBid: priorityBid,
            srcChainId: uint32(block.chainid)
        }));

        if (priorityBid > 0) {
            priorityOrderIndices[currentBatchId].push(orderIndex);
            batches[currentBatchId].totalPriorityBids += priorityBid;
        }

        batchSecrets[currentBatchId].push(secret);

        emit OrderRevealed(
            commitId,
            originalDepositor,
            currentBatchId,
            tokenIn,
            tokenOut,
            amountIn,
            priorityBid
        );
    }

    // ============ View Functions ============

    /**
     * @notice Get the current batch ID
     */
    function getCurrentBatchId() external view returns (uint64) {
        return currentBatchId;
    }

    /**
     * @notice Get the current batch phase based on time
     */
    function getCurrentPhase() public view returns (BatchPhase) {
        uint256 elapsed = block.timestamp - batchStartTime;

        if (elapsed < COMMIT_DURATION) {
            return BatchPhase.COMMIT;
        } else if (elapsed < BATCH_DURATION) {
            return BatchPhase.REVEAL;
        } else {
            return BatchPhase.SETTLING;
        }
    }

    /**
     * @notice Get current batch duration (PROTOCOL CONSTANT)
     */
    function getBatchDuration() public pure returns (uint256) {
        return BATCH_DURATION;
    }

    /**
     * @notice Get batch information
     */
    function getBatch(uint64 batchId) external view returns (Batch memory) {
        return batches[batchId];
    }

    /**
     * @notice Get commitment information
     */
    function getCommitment(bytes32 commitId) external view returns (OrderCommitment memory) {
        return commitments[commitId];
    }

    /**
     * @notice Get revealed orders for a batch
     */
    function getRevealedOrders(uint64 batchId) external view returns (RevealedOrder[] memory) {
        return revealedOrders[batchId];
    }

    /**
     * @notice Get time until phase change
     */
    function getTimeUntilPhaseChange() external view returns (uint256) {
        uint256 elapsed = block.timestamp - batchStartTime;

        if (elapsed < COMMIT_DURATION) {
            return COMMIT_DURATION - elapsed;
        } else if (elapsed < BATCH_DURATION) {
            return BATCH_DURATION - elapsed;
        } else {
            return 0;
        }
    }

    // ============ Admin Functions ============

    /**
     * @notice Set authorized settler
     * @param settler Address to authorize
     * @param authorized Whether to authorize or revoke
     */
    function setAuthorizedSettler(
        address settler,
        bool authorized
    ) external onlyOwner {
        authorizedSettlers[settler] = authorized;
    }

    /**
     * @notice Update treasury address
     * @param _treasury New treasury address
     */
    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert InvalidTreasury();
        treasury = _treasury;
    }

    /**
     * @notice Set base value for PoW priority conversion
     * @param _baseValue Base value in wei per difficulty bit
     */
    function setPoWBaseValue(uint256 _baseValue) external onlyOwner {
        powBaseValue = _baseValue;
    }

    // ============ Pool View Functions ============

    /**
     * @notice Get pool configuration
     * @param poolId Pool identifier
     * @return config The immutable pool configuration
     */
    function getPoolConfig(bytes32 poolId) external view returns (PoolComplianceConfig.Config memory) {
        return poolConfigs[poolId];
    }

    /**
     * @notice Check if user can trade on a specific pool
     * @param poolId Pool to check
     * @param user User address
     * @return allowed Whether user meets pool requirements
     * @return reason Reason if not allowed
     */
    function canUserTradeOnPool(
        bytes32 poolId,
        address user
    ) external view returns (bool allowed, string memory reason) {
        PoolComplianceConfig.Config storage config = _getPoolConfig(poolId);

        // Check minimum tier
        uint8 userTier = _getUserTier(user);
        if (userTier < config.minTierRequired) {
            return (false, "User tier below minimum");
        }

        // Check KYC if required
        if (config.kycRequired) {
            if (complianceRegistry == address(0)) {
                return (false, "No compliance registry");
            }
            try IComplianceRegistry(complianceRegistry).getKYCStatus(user) returns (bool hasKYC, bool isValid) {
                if (!hasKYC || !isValid) {
                    return (false, "KYC required");
                }
            } catch {
                return (false, "KYC check failed");
            }
        }

        // Check accreditation if required
        if (config.accreditationRequired) {
            if (complianceRegistry == address(0)) {
                return (false, "No compliance registry");
            }
            try IComplianceRegistry(complianceRegistry).isAccredited(user) returns (bool accredited) {
                if (!accredited) {
                    return (false, "Accreditation required");
                }
            } catch {
                return (false, "Accreditation check failed");
            }
        }

        // Check jurisdiction if blocked list exists
        if (config.blockedJurisdictions.length > 0 && complianceRegistry != address(0)) {
            try IComplianceRegistry(complianceRegistry).getUserProfile(user) returns (
                uint8, uint8, uint64, uint64,
                bytes2 jurisdiction,
                uint256, uint256, string memory, bytes32
            ) {
                if (PoolComplianceConfig.isJurisdictionBlocked(config, jurisdiction)) {
                    return (false, "Jurisdiction blocked");
                }
            } catch {
                // If we can't check jurisdiction, allow for open pools
            }
        }

        return (true, "");
    }

    /**
     * @notice Get required deposit for a trade value (PROTOCOL CONSTANT)
     * @dev Pool ID is ignored - deposit requirements are uniform
     * @param tradeValue Estimated trade value
     * @return required Required deposit amount
     */
    function getRequiredDeposit(
        uint256 tradeValue
    ) external pure returns (uint256) {
        // Use PROTOCOL CONSTANTS - uniform for all pools
        uint256 collateralRequired = (tradeValue * COLLATERAL_BPS) / 10000;
        return collateralRequired > MIN_DEPOSIT ? collateralRequired : MIN_DEPOSIT;
    }

    // ============ Internal Functions ============

    /**
     * @notice Generate unique pool ID
     * @param creator Pool creator address
     * @return poolId Unique pool identifier
     */
    function _generatePoolId(address creator) internal returns (bytes32) {
        return keccak256(abi.encodePacked(creator, block.timestamp, ++poolCount));
    }

    /**
     * @notice Store pool access config (called only during creation)
     * @dev Copies config to storage - access rules are immutable after this
     *      Note: Safety parameters (collateral, slashing) are PROTOCOL CONSTANTS
     */
    function _storePoolConfig(bytes32 poolId, PoolComplianceConfig.Config memory config) internal {
        PoolComplianceConfig.Config storage stored = poolConfigs[poolId];
        stored.minTierRequired = config.minTierRequired;
        stored.kycRequired = config.kycRequired;
        stored.accreditationRequired = config.accreditationRequired;
        stored.maxTradeSize = config.maxTradeSize;
        stored.poolType = config.poolType;
        stored.initialized = true;

        // Copy blocked jurisdictions
        for (uint256 i = 0; i < config.blockedJurisdictions.length; i++) {
            stored.blockedJurisdictions.push(config.blockedJurisdictions[i]);
        }
    }

    /**
     * @notice Get pool config, returning default open config if pool doesn't exist
     * @param poolId Pool identifier (bytes32(0) for default)
     * @return config Pool configuration
     */
    function _getPoolConfig(bytes32 poolId) internal view returns (PoolComplianceConfig.Config storage) {
        // For default pool (0), return a pre-initialized open config
        if (poolId == bytes32(0)) {
            // Check if default pool exists, if not this will have initialized=false
            // which we handle by treating uninitialized as open
            if (!poolConfigs[poolId].initialized) {
                // Return the storage slot - caller should check initialized flag
                // For poolId=0, we treat uninitialized as "open" defaults
            }
        }
        return poolConfigs[poolId];
    }

    /**
     * @notice Get user's tier from compliance registry
     * @param user User address
     * @return tier User tier (0-5)
     */
    function _getUserTier(address user) internal view returns (uint8) {
        if (complianceRegistry == address(0)) {
            return 0; // No registry = tier 0 (open)
        }

        try IComplianceRegistry(complianceRegistry).getUserProfile(user) returns (
            uint8 tier,
            uint8,
            uint64,
            uint64,
            bytes2,
            uint256,
            uint256,
            string memory,
            bytes32
        ) {
            return tier;
        } catch {
            return 0; // Default to tier 0 on error
        }
    }

    /**
     * @notice Validate user against pool ACCESS requirements
     * @dev Only checks WHO can trade. HOW trading works uses protocol constants.
     * @param config Pool access configuration
     * @param user User address
     * @param tradeValue Estimated trade value
     */
    function _validateUserForPool(
        PoolComplianceConfig.Config storage config,
        address user,
        uint256 tradeValue
    ) internal view {
        // If pool not initialized, treat as open pool (no access restrictions)
        if (!config.initialized) {
            return; // Open access - deposit checks happen in commitOrderToPool
        }

        // Check minimum tier
        uint8 userTier = _getUserTier(user);
        if (userTier < config.minTierRequired) {
            revert UserBelowMinTier();
        }

        // Check KYC if required
        if (config.kycRequired && complianceRegistry != address(0)) {
            try IComplianceRegistry(complianceRegistry).getKYCStatus(user) returns (bool hasKYC, bool isValid) {
                if (!hasKYC || !isValid) {
                    revert KYCRequired();
                }
            } catch {
                revert KYCRequired();
            }
        }

        // Check accreditation if required
        if (config.accreditationRequired && complianceRegistry != address(0)) {
            try IComplianceRegistry(complianceRegistry).isAccredited(user) returns (bool accredited) {
                if (!accredited) {
                    revert AccreditationRequired();
                }
            } catch {
                revert AccreditationRequired();
            }
        }

        // Check trade size limit
        if (config.maxTradeSize > 0 && tradeValue > config.maxTradeSize) {
            revert TradeSizeExceeded();
        }

        // Check jurisdiction
        if (config.blockedJurisdictions.length > 0 && complianceRegistry != address(0)) {
            try IComplianceRegistry(complianceRegistry).getUserProfile(user) returns (
                uint8, uint8, uint64, uint64,
                bytes2 jurisdiction,
                uint256, uint256, string memory, bytes32
            ) {
                if (PoolComplianceConfig.isJurisdictionBlocked(config, jurisdiction)) {
                    revert JurisdictionBlocked();
                }
            } catch {
                // If we can't get jurisdiction, allow for open pools
                if (config.minTierRequired > 0) {
                    revert JurisdictionBlocked();
                }
            }
        }
    }

    /**
     * @notice Start a new batch
     */
    function _startNewBatch() internal {
        currentBatchId++;
        batchStartTime = uint64(block.timestamp);

        batches[currentBatchId] = Batch({
            batchId: currentBatchId,
            startTimestamp: batchStartTime,
            phase: BatchPhase.COMMIT,
            shuffleSeed: bytes32(0),
            totalPriorityBids: 0,
            orderCount: 0,
            isSettled: false
        });
    }

    /**
     * @notice Slash an invalid commitment
     * @dev FIX #4: Treasury failure holds funds in contract instead of refunding user
     *      Uses PROTOCOL CONSTANT slash rate (uniform for all)
     */
    function _slashCommitment(bytes32 commitId) internal {
        OrderCommitment storage commitment = commitments[commitId];

        commitment.status = CommitStatus.SLASHED;

        // Use PROTOCOL CONSTANT slash rate (uniform for all - ensures fair deterrent)
        uint256 slashAmount = (commitment.depositAmount * SLASH_RATE_BPS) / 10000;
        uint256 refundAmount = commitment.depositAmount - slashAmount;

        uint256 actualSlashed = 0;

        // FIX #4: Always slash - never refund slash amount to user
        if (slashAmount > 0) {
            if (treasury != address(0)) {
                (bool success, ) = treasury.call{value: slashAmount}("");
                if (success) {
                    actualSlashed = slashAmount;
                } else {
                    // FIX #4: Treasury failed - hold funds in contract, not refund to user
                    pendingSlashedFunds += slashAmount;
                    userSlashedAmounts[commitment.depositor] += slashAmount;
                    actualSlashed = slashAmount; // Still counts as slashed
                    emit SlashedFundsHeld(commitId, commitment.depositor, slashAmount);
                }
            } else {
                // No treasury configured - hold in contract
                pendingSlashedFunds += slashAmount;
                userSlashedAmounts[commitment.depositor] += slashAmount;
                actualSlashed = slashAmount;
                emit SlashedFundsHeld(commitId, commitment.depositor, slashAmount);
            }
        }

        // Refund non-slashed portion to user
        if (refundAmount > 0) {
            (bool success, ) = commitment.depositor.call{value: refundAmount}("");
            // If refund fails, funds stay in contract (user can try again)
            if (!success) {
                // Revert status so user can try to withdraw later
                commitment.status = CommitStatus.COMMITTED;
                return;
            }
        }

        emit OrderSlashed(commitId, commitment.depositor, actualSlashed);
    }

    /**
     * @notice Withdraw pending slashed funds to treasury (admin function)
     * @dev FIX #4: Allows retry of treasury transfer for held funds
     */
    function withdrawPendingSlashedFunds() external onlyOwner {
        require(treasury != address(0), "No treasury configured");
        require(pendingSlashedFunds > 0, "No pending funds");

        uint256 amount = pendingSlashedFunds;
        pendingSlashedFunds = 0;

        (bool success, ) = treasury.call{value: amount}("");
        if (!success) {
            // Restore the pending amount if transfer fails
            pendingSlashedFunds = amount;
            revert TransferFailed();
        }

        emit PendingSlashedFundsWithdrawn(amount);
    }

    /**
     * @notice Sort priority orders by bid amount (descending)
     * @dev Uses order index as tiebreaker (lower index = earlier reveal = higher priority)
     */
    function _sortPriorityOrders(
        uint64 batchId,
        uint256[] memory indices
    ) internal view returns (uint256[] memory sorted) {
        uint256 len = indices.length;
        if (len <= 1) return indices;

        sorted = new uint256[](len);
        for (uint256 i = 0; i < len; i++) {
            sorted[i] = indices[i];
        }

        // Simple bubble sort (fine for small arrays)
        // Sort by bid descending, with index ascending as tiebreaker
        for (uint256 i = 0; i < len - 1; i++) {
            for (uint256 j = 0; j < len - i - 1; j++) {
                uint256 bidA = revealedOrders[batchId][sorted[j]].priorityBid;
                uint256 bidB = revealedOrders[batchId][sorted[j + 1]].priorityBid;

                bool shouldSwap = false;
                if (bidA < bidB) {
                    // B has higher bid, swap
                    shouldSwap = true;
                } else if (bidA == bidB && sorted[j] > sorted[j + 1]) {
                    // Same bid but A has higher index (revealed later), swap to give priority to earlier reveal
                    shouldSwap = true;
                }

                if (shouldSwap) {
                    (sorted[j], sorted[j + 1]) = (sorted[j + 1], sorted[j]);
                }
            }
        }
    }

    /**
     * @notice Receive function for deposits
     */
    receive() external payable {}
}
