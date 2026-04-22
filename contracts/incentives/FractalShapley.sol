// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/IFractalShapley.sol";
import "../identity/interfaces/IContributionDAG.sol";

/**
 * @title FractalShapley — Recursive Attribution Through Influence DAGs
 * @author Faraday1 & JARVIS — vibeswap.org
 *
 * @notice Git commits are a lie of omission. They record WHO typed the code
 *         but not WHO INSPIRED the code. This contract fixes that.
 *
 *         Every contribution declares its parents (inspirations). When rewards
 *         flow to a contribution, credit propagates backward through the
 *         influence chain with configurable decay.
 *
 *         Architecture:
 *           [Contribution Registry]   — "this work happened, inspired by X,Y,Z"
 *                   ↓
 *           [Influence DAG]           — edges: "inspired by / builds on"
 *                   ↓
 *           [Credit Propagation]      — "Alice gets X% of Bob's reward"
 *
 * @dev UUPS upgradeable. Gas-bounded DAG walk: MAX_PROPAGATION_DEPTH = 6.
 *      Credit decay per hop is configurable (default 30%).
 *      Integrates with ContributionDAG for trust-weighted attestation validation.
 *
 * THE LAWSON CONSTANT: The greatest idea cannot be stolen, because part of it
 * is admitting who came up with it. This contract makes that admission structural.
 */
contract FractalShapley is
    IFractalShapley,
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    event MinAttestationsUpdated(uint256 previous, uint256 current);

    // ============ Constants ============

    uint256 public constant PRECISION = 1e18;
    uint256 public constant BPS = 10_000;

    /// @notice Maximum parent contributions per registration
    uint8 public constant MAX_PARENTS = 10;

    /// @notice Maximum depth for credit propagation (gas bound)
    uint8 public constant MAX_PROPAGATION_DEPTH = 6;

    /// @notice Maximum contributions in a single propagation BFS queue
    uint16 public constant MAX_QUEUE_SIZE = 256;

    /// @notice The Lawson Constant — attribution is structural
    bytes32 public constant LAWSON_CONSTANT = keccak256("FAIRNESS_ABOVE_ALL:W.GLYNN:2026");

    // ============ Custom Errors ============

    error ContributionAlreadyExists(bytes32 id);
    error ContributionNotFound(bytes32 id);
    error TooManyParents(uint256 count);
    error SelfReference();
    // CycleDetected removed — cycles are structurally impossible because
    // parents must exist before child registration (TRP R1 finding, 2026-03-27)
    error ZeroReward();
    error InvalidDecay();
    error InvalidDepth();
    error AlreadyAttested();
    error ETHTransferFailed();
    error ETHValueMismatch();
    error UnexpectedETH();

    // ============ State ============

    /// @notice Credit decay per hop in BPS (default 3000 = 30%)
    /// @dev Higher = less credit flows upstream. 3000 means each hop retains 70%.
    uint256 public propagationDecay;

    /// @notice Minimum attestations required to validate an influence edge
    uint256 public minAttestations;

    /// @notice ContributionDAG for trust score integration
    IContributionDAG public contributionDAG;

    /// @notice Contribution ID => Contribution data
    mapping(bytes32 => ContributionStorage) private _contributions;

    /// @notice Contribution ID => parent index => parent ID (separate for gas)
    mapping(bytes32 => bytes32[]) private _parents;

    /// @notice Contribution ID => children (reverse index: who was inspired by this)
    mapping(bytes32 => bytes32[]) private _children;

    /// @notice child => parent => attestation count
    mapping(bytes32 => mapping(bytes32 => uint256)) private _attestationCounts;

    /// @notice child => parent => attester => attested
    mapping(bytes32 => mapping(bytes32 => mapping(address => bool))) private _hasAttested;

    /// @notice Contributor address => total credit received across all contributions
    mapping(address => uint256) private _totalCreditReceived;

    /// @notice INT-R1-FT004: Pending ETH withdrawals for recipients that rejected push transfers.
    /// @dev A single griefing recipient (contract that reverts on receive) would block ALL
    ///      distributions for a contribution. Pull pattern ensures other recipients aren't affected.
    mapping(address => uint256) public pendingWithdrawals;

    /// @dev Internal storage struct (no dynamic arrays for gas efficiency)
    struct ContributionStorage {
        address contributor;
        uint256 timestamp;
        uint256 totalReward;
        uint256 propagatedCredit;
        bool exists;
    }

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _contributionDAG,
        uint256 _propagationDecay,
        uint256 _minAttestations
    ) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        contributionDAG = IContributionDAG(_contributionDAG);
        propagationDecay = _propagationDecay;  // 3000 = 30% decay per hop
        minAttestations = _minAttestations;    // 0 = self-declaration only (V1)
    }

    // ============ Core: Register Contribution ============

    /// @inheritdoc IFractalShapley
    function registerContribution(
        bytes32 id,
        bytes32[] calldata parents
    ) external override {
        if (_contributions[id].exists) revert ContributionAlreadyExists(id);
        if (parents.length > MAX_PARENTS) revert TooManyParents(parents.length);

        // Validate parents exist and no self-reference
        for (uint256 i; i < parents.length; ++i) {
            if (parents[i] == id) revert SelfReference();
            if (!_contributions[parents[i]].exists) revert ContributionNotFound(parents[i]);
        }

        // Store contribution
        _contributions[id] = ContributionStorage({
            contributor: msg.sender,
            timestamp: block.timestamp,
            totalReward: 0,
            propagatedCredit: 0,
            exists: true
        });

        // Store parents and build reverse index
        for (uint256 i; i < parents.length; ++i) {
            _parents[id].push(parents[i]);
            _children[parents[i]].push(id);
        }

        emit ContributionRegistered(id, msg.sender, parents, block.timestamp);
    }

    // ============ Core: Credit Propagation ============

    struct BFSState {
        bytes32[] queue;
        uint256[] credits;
        uint8[] depths;
        uint256 head;
        uint256 tail;
    }

    /// @inheritdoc IFractalShapley
    function computeCredit(
        bytes32 contributionId,
        uint256 rewardAmount
    ) public view override returns (CreditAllocation[] memory allocations) {
        if (!_contributions[contributionId].exists) revert ContributionNotFound(contributionId);
        if (rewardAmount == 0) revert ZeroReward();

        CreditAllocation[] memory buffer = new CreditAllocation[](MAX_QUEUE_SIZE);
        uint256 count;
        BFSState memory bfs;
        bfs.queue = new bytes32[](MAX_QUEUE_SIZE);
        bfs.credits = new uint256[](MAX_QUEUE_SIZE);
        bfs.depths = new uint8[](MAX_QUEUE_SIZE);

        // Seed direct contributor
        count = _seedBFS(contributionId, rewardAmount, buffer, bfs);

        // BFS walk
        while (bfs.head < bfs.tail && count < MAX_QUEUE_SIZE) {
            count = _processBFSNode(buffer, count, bfs);
        }

        // Trim buffer to actual size
        allocations = new CreditAllocation[](count);
        for (uint256 i; i < count; ++i) {
            allocations[i] = buffer[i];
        }
    }

    /// @dev Seed the BFS with the direct contributor allocation and queue parents
    function _seedBFS(
        bytes32 contributionId,
        uint256 rewardAmount,
        CreditAllocation[] memory buffer,
        BFSState memory bfs
    ) internal view returns (uint256 count) {
        uint256 propagationShare = _computePropagationShare(contributionId, rewardAmount);
        buffer[0] = CreditAllocation({
            recipient: _contributions[contributionId].contributor,
            contributionId: contributionId,
            amount: rewardAmount - propagationShare,
            depth: 0
        });
        count = 1;

        bytes32[] memory parentIds = _parents[contributionId];
        if (parentIds.length > 0 && propagationShare > 0) {
            uint256 perParent = propagationShare / parentIds.length;
            uint256 remainder = propagationShare % parentIds.length;
            for (uint256 i; i < parentIds.length && bfs.tail < MAX_QUEUE_SIZE; ++i) {
                bfs.queue[bfs.tail] = parentIds[i];
                bfs.credits[bfs.tail] = (i == 0) ? perParent + remainder : perParent;
                bfs.depths[bfs.tail] = 1;
                ++bfs.tail;
            }
        }
    }

    /// @dev Process one BFS node (extracted to reduce stack depth in main loop)
    function _processBFSNode(
        CreditAllocation[] memory buffer,
        uint256 count,
        BFSState memory bfs
    ) internal view returns (uint256 newCount) {
        newCount = count;
        bytes32 currentId = bfs.queue[bfs.head];
        uint256 currentCredit = bfs.credits[bfs.head];
        uint8 currentDepth = bfs.depths[bfs.head];
        ++bfs.head;

        if (currentCredit == 0 || currentDepth > MAX_PROPAGATION_DEPTH) return newCount;

        uint256 keepShare = currentCredit - (currentCredit * propagationDecay) / BPS;
        buffer[newCount++] = CreditAllocation({
            recipient: _contributions[currentId].contributor,
            contributionId: currentId,
            amount: keepShare,
            depth: currentDepth
        });

        uint256 upstreamShare = (currentCredit * propagationDecay) / BPS;
        bytes32[] memory grandparents = _parents[currentId];
        if (grandparents.length > 0 && upstreamShare > 0 && currentDepth < MAX_PROPAGATION_DEPTH) {
            uint256 perGp = upstreamShare / grandparents.length;
            uint256 gpRem = upstreamShare % grandparents.length;
            for (uint256 i; i < grandparents.length && bfs.tail < MAX_QUEUE_SIZE; ++i) {
                bfs.queue[bfs.tail] = grandparents[i];
                bfs.credits[bfs.tail] = (i == 0) ? perGp + gpRem : perGp;
                bfs.depths[bfs.tail] = currentDepth + 1;
                ++bfs.tail;
            }
        } else if (grandparents.length == 0 && upstreamShare > 0) {
            buffer[0].amount += upstreamShare;
        }
    }

    /// @inheritdoc IFractalShapley
    function distributeWithPropagation(
        bytes32 contributionId,
        uint256 rewardAmount,
        address token
    ) external payable override nonReentrant {
        // Validate ETH: exact match required, no locked funds
        if (token == address(0)) {
            if (msg.value != rewardAmount) revert ETHValueMismatch();
        } else {
            if (msg.value != 0) revert UnexpectedETH();
        }

        CreditAllocation[] memory allocations = computeCredit(contributionId, rewardAmount);

        // Update accounting
        _contributions[contributionId].totalReward += rewardAmount;

        for (uint256 i; i < allocations.length; ++i) {
            CreditAllocation memory alloc = allocations[i];

            if (alloc.depth > 0) {
                _contributions[alloc.contributionId].propagatedCredit += alloc.amount;
            }
            _totalCreditReceived[alloc.recipient] += alloc.amount;

            // Transfer
            if (token == address(0)) {
                // INT-R1-FT004: Use pull pattern for failed ETH transfers.
                // A single griefing recipient that reverts on receive() would block
                // ALL distributions for this contribution. Queue failed transfers
                // for later withdrawal instead of reverting the entire tx.
                (bool ok,) = alloc.recipient.call{value: alloc.amount}("");
                if (!ok) {
                    pendingWithdrawals[alloc.recipient] += alloc.amount;
                    emit ETHTransferQueued(alloc.recipient, alloc.amount);
                }
            } else {
                IERC20(token).safeTransferFrom(msg.sender, alloc.recipient, alloc.amount);
            }

            if (alloc.depth > 0) {
                emit CreditPropagated(
                    contributionId,
                    alloc.contributionId,
                    alloc.recipient,
                    alloc.amount,
                    alloc.depth
                );
            }
        }
    }

    // ============ Pull Withdrawals (INT-R1-FT004) ============

    /// @notice Withdraw pending ETH from failed push transfers
    function withdrawPending() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        if (amount == 0) revert ZeroReward();
        pendingWithdrawals[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert ETHTransferFailed();
        emit PendingWithdrawn(msg.sender, amount);
    }

    event ETHTransferQueued(address indexed recipient, uint256 amount);
    event PendingWithdrawn(address indexed recipient, uint256 amount);

    // ============ Attestation ============

    /// @inheritdoc IFractalShapley
    function attestInspiration(bytes32 childId, bytes32 parentId) external override {
        if (!_contributions[childId].exists) revert ContributionNotFound(childId);
        if (!_contributions[parentId].exists) revert ContributionNotFound(parentId);
        if (_hasAttested[childId][parentId][msg.sender]) revert AlreadyAttested();

        _hasAttested[childId][parentId][msg.sender] = true;
        _attestationCounts[childId][parentId] += 1;

        emit InspirationAttested(childId, parentId, msg.sender);
    }

    // ============ View Functions ============

    /// @inheritdoc IFractalShapley
    function getContribution(bytes32 id) external view override returns (Contribution memory) {
        ContributionStorage storage cs = _contributions[id];
        if (!cs.exists) revert ContributionNotFound(id);

        return Contribution({
            id: id,
            contributor: cs.contributor,
            parents: _parents[id],
            timestamp: cs.timestamp,
            totalReward: cs.totalReward,
            propagatedCredit: cs.propagatedCredit
        });
    }

    /// @inheritdoc IFractalShapley
    function getChildren(bytes32 id) external view override returns (bytes32[] memory) {
        return _children[id];
    }

    /// @inheritdoc IFractalShapley
    function getAttestationCount(
        bytes32 childId,
        bytes32 parentId
    ) external view override returns (uint256) {
        return _attestationCounts[childId][parentId];
    }

    /// @inheritdoc IFractalShapley
    function contributionExists(bytes32 id) external view override returns (bool) {
        return _contributions[id].exists;
    }

    /// @inheritdoc IFractalShapley
    function getTotalCreditReceived(address contributor) external view override returns (uint256) {
        return _totalCreditReceived[contributor];
    }

    // ============ Admin ============

    /// @notice Update propagation decay (Disintermediation: Grade B → DAO vote)
    function setPropagationDecay(uint256 newDecay) external onlyOwner {
        if (newDecay > BPS) revert InvalidDecay();
        uint256 old = propagationDecay;
        propagationDecay = newDecay;
        emit PropagationDecayUpdated(old, newDecay);
    }

    /// @notice Update minimum attestations required
    function setMinAttestations(uint256 _min) external onlyOwner {
        uint256 prev = minAttestations;
        minAttestations = _min;
        emit MinAttestationsUpdated(prev, _min);
    }

    // ============ Internal ============

    /// @dev Compute how much of a reward should propagate to parents
    ///      Zero parents = zero propagation. Otherwise decay rate applied to reward.
    function _computePropagationShare(
        bytes32 contributionId,
        uint256 rewardAmount
    ) internal view returns (uint256) {
        uint256 parentCount = _parents[contributionId].length;
        if (parentCount == 0) return 0;
        return (rewardAmount * propagationDecay) / BPS;
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
