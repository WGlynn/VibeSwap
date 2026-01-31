// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/ICommitRevealAuction.sol";
import "../libraries/DeterministicShuffle.sol";

/**
 * @title CommitRevealAuction
 * @notice Implements commit-reveal mechanism with priority auction for MEV-resistant trading
 * @dev Uses 1-second batches with 800ms commit + 200ms reveal phases
 */
contract CommitRevealAuction is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    ICommitRevealAuction
{
    using SafeERC20 for IERC20;
    using DeterministicShuffle for bytes32[];

    // ============ Constants ============

    /// @notice Duration of commit phase (800ms = 0.8 seconds, but we use 8 seconds for block time safety)
    uint256 public constant COMMIT_DURATION = 8;

    /// @notice Duration of reveal phase (200ms = 0.2 seconds, but we use 2 seconds for block time safety)
    uint256 public constant REVEAL_DURATION = 2;

    /// @notice Total batch duration (10 seconds per batch)
    uint256 public constant BATCH_DURATION = COMMIT_DURATION + REVEAL_DURATION;

    /// @notice Minimum deposit required to commit
    uint256 public constant MIN_DEPOSIT = 0.001 ether;

    /// @notice Slashing percentage for invalid reveals (basis points)
    uint256 public constant SLASH_RATE = 5000; // 50%

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

    // ============ Modifiers ============

    modifier onlyAuthorizedSettler() {
        require(authorizedSettlers[msg.sender], "Not authorized");
        _;
    }

    modifier inPhase(BatchPhase required) {
        require(getCurrentPhase() == required, "Invalid phase");
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
     */
    function initialize(
        address _owner,
        address _treasury
    ) external initializer {
        __Ownable_init(_owner);
        __ReentrancyGuard_init();

        treasury = _treasury;
        currentBatchId = 1;
        batchStartTime = uint64(block.timestamp);

        // Initialize first batch
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

    // ============ External Functions ============

    /**
     * @notice Commit an order hash for the current batch
     * @param commitHash Hash of (trader, tokenIn, tokenOut, amountIn, minAmountOut, secret)
     * @return commitId Unique identifier for this commitment
     */
    function commitOrder(
        bytes32 commitHash
    ) external payable nonReentrant inPhase(BatchPhase.COMMIT) returns (bytes32 commitId) {
        require(msg.value >= MIN_DEPOSIT, "Insufficient deposit");
        require(commitHash != bytes32(0), "Invalid hash");

        // Generate unique commit ID
        commitId = keccak256(abi.encodePacked(
            msg.sender,
            commitHash,
            currentBatchId,
            block.timestamp
        ));

        require(commitments[commitId].status == CommitStatus.NONE, "Already committed");

        commitments[commitId] = OrderCommitment({
            commitHash: commitHash,
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

        require(commitment.status == CommitStatus.COMMITTED, "Invalid commitment");
        require(commitment.batchId == currentBatchId, "Wrong batch");
        require(commitment.depositor == msg.sender, "Not owner");

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
            require(msg.value >= priorityBid, "Insufficient priority bid");
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
     * @notice Advance batch phase (time-based)
     */
    function advancePhase() external {
        Batch storage batch = batches[currentBatchId];
        BatchPhase currentPhase = getCurrentPhase();

        if (currentPhase != batch.phase) {
            BatchPhase oldPhase = batch.phase;
            batch.phase = currentPhase;

            emit BatchPhaseChanged(currentBatchId, oldPhase, currentPhase);

            // If moving to SETTLING, generate shuffle seed
            if (currentPhase == BatchPhase.SETTLING && !batch.isSettled) {
                batch.shuffleSeed = batchSecrets[currentBatchId].generateSeed();
            }
        }
    }

    /**
     * @notice Settle the current batch
     */
    function settleBatch() external onlyAuthorizedSettler nonReentrant {
        Batch storage batch = batches[currentBatchId];

        require(
            getCurrentPhase() == BatchPhase.SETTLING ||
            getCurrentPhase() == BatchPhase.SETTLED,
            "Cannot settle yet"
        );
        require(!batch.isSettled, "Already settled");

        // Generate shuffle seed if not done
        if (batch.shuffleSeed == bytes32(0)) {
            batch.shuffleSeed = batchSecrets[currentBatchId].generateSeed();
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
        require(batch.isSettled, "Batch not settled");

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

        require(commitment.depositor == msg.sender, "Not owner");
        require(commitment.status == CommitStatus.REVEALED, "Not revealed");
        require(batches[commitment.batchId].isSettled, "Batch not settled");

        commitment.status = CommitStatus.EXECUTED;

        // Return deposit
        (bool success, ) = msg.sender.call{value: commitment.depositAmount}("");
        require(success, "Transfer failed");
    }

    /**
     * @notice Slash unrevealed commitments after batch settlement
     * @param commitId Commitment ID of unrevealed order
     */
    function slashUnrevealedCommitment(bytes32 commitId) external nonReentrant {
        OrderCommitment storage commitment = commitments[commitId];

        require(commitment.status == CommitStatus.COMMITTED, "Not slashable");
        require(batches[commitment.batchId].isSettled, "Batch not settled");

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

        require(commitment.status == CommitStatus.COMMITTED, "Invalid commitment");
        require(commitment.batchId == currentBatchId, "Wrong batch");

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
        require(_treasury != address(0), "Invalid treasury");
        treasury = _treasury;
    }

    // ============ Internal Functions ============

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
     * @dev Treasury transfer failure doesn't block user refund
     */
    function _slashCommitment(bytes32 commitId) internal {
        OrderCommitment storage commitment = commitments[commitId];

        commitment.status = CommitStatus.SLASHED;

        uint256 slashAmount = (commitment.depositAmount * SLASH_RATE) / 10000;
        uint256 refundAmount = commitment.depositAmount - slashAmount;

        uint256 actualSlashed = 0;

        // Send slashed amount to treasury (don't revert if fails, track actual amount)
        if (slashAmount > 0 && treasury != address(0)) {
            (bool success, ) = treasury.call{value: slashAmount}("");
            if (success) {
                actualSlashed = slashAmount;
            } else {
                // If treasury transfer fails, refund the slash amount to user
                refundAmount += slashAmount;
            }
        } else {
            // No treasury configured, refund to user
            refundAmount += slashAmount;
        }

        // Refund remainder to user
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
