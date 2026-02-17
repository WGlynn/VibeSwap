// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "../libraries/IncrementalMerkleTree.sol";
import "./interfaces/IContributionDAG.sol";

/**
 * @title ContributionDAG
 * @notice On-chain trust DAG (Web of Trust) — direct port of trustChain.js.
 *         Users vouch for each other; bidirectional vouches form handshakes.
 *         BFS from founders computes distance-based trust scores with 15% decay per hop.
 *
 * Integration:
 * - Reads SoulboundIdentity.hasIdentity() — must have identity to vouch
 * - Feeds trust multipliers into ShapleyDistributor quality weights
 * - Feeds trust chains into RewardLedger for Shapley distribution
 *
 * @dev Non-upgradeable. Gas-bounded BFS: MAX_TRUST_HOPS = 6.
 */
contract ContributionDAG is IContributionDAG, Ownable, ReentrancyGuard {
    using IncrementalMerkleTree for IncrementalMerkleTree.Tree;

    // ============ Constants (from TRUST_CONFIG) ============

    uint256 public constant PRECISION = 1e18;
    uint256 public constant BPS = 10000;

    uint256 public constant MAX_VOUCH_PER_USER = 10;
    uint256 public constant MIN_VOUCHES_FOR_TRUSTED = 2;
    uint256 public constant TRUST_DECAY_PER_HOP = 1500;       // 15% in BPS
    uint8   public constant MAX_TRUST_HOPS = 6;
    uint256 public constant HANDSHAKE_COOLDOWN = 1 days;
    uint256 public constant MAX_FOUNDERS = 20;

    // Voting power multipliers (BPS: 10000 = 1.0x)
    uint256 public constant FOUNDER_MULTIPLIER = 30000;        // 3.0x
    uint256 public constant TRUSTED_MULTIPLIER = 20000;        // 2.0x
    uint256 public constant PARTIAL_TRUST_MULTIPLIER = 15000;  // 1.5x
    uint256 public constant UNTRUSTED_MULTIPLIER = 5000;       // 0.5x

    // Trust level thresholds (PRECISION scale)
    uint256 public constant TRUSTED_THRESHOLD = 7e17;          // 0.7
    uint256 public constant PARTIAL_THRESHOLD = 3e17;          // 0.3

    // ============ State ============

    /// @notice SoulboundIdentity contract (optional — address(0) disables check)
    address public soulboundIdentity;

    // Directed vouch edges: from => to => Vouch
    mapping(address => mapping(address => Vouch)) private _vouches;

    // Outgoing vouch lists (who I vouched for)
    mapping(address => address[]) private _vouchesFrom;

    // Reverse index (who vouched for me) — needed for BFS
    mapping(address => address[]) private _vouchedBy;

    // Handshakes (confirmed bidirectional pairs)
    Handshake[] private _handshakes;

    // BFS-computed trust scores
    mapping(address => TrustScore) private _trustScores;

    // Founder addresses (root nodes of the DAG)
    address[] private _founders;
    mapping(address => bool) private _isFounder;

    // Track all scored users for recalculation
    address[] private _scoredUsers;

    // Merkle-compressed vouch audit trail
    IncrementalMerkleTree.Tree private _vouchTree;
    bool private _vouchTreeInitialized;

    // ============ Constructor ============

    constructor(address _soulbound) Ownable(msg.sender) {
        soulboundIdentity = _soulbound;
        _vouchTree.init(20);
        _vouchTreeInitialized = true;
    }

    // ============ Modifiers ============

    modifier requiresIdentity(address user) {
        if (soulboundIdentity != address(0)) {
            // Call hasIdentity(address) on SoulboundIdentity
            (bool ok, bytes memory data) = soulboundIdentity.staticcall(
                abi.encodeWithSignature("hasIdentity(address)", user)
            );
            if (!ok || (data.length >= 32 && !abi.decode(data, (bool)))) {
                revert NoIdentity();
            }
        }
        _;
    }

    // ============ Core Functions ============

    /// @inheritdoc IContributionDAG
    function addVouch(
        address to,
        bytes32 messageHash
    ) external requiresIdentity(msg.sender) returns (bool isHandshake_) {
        if (msg.sender == to) revert CannotVouchSelf();

        // Check vouch limit
        if (_vouchesFrom[msg.sender].length >= MAX_VOUCH_PER_USER) {
            revert MaxVouchesReached();
        }

        // Check if already vouched
        Vouch storage existing = _vouches[msg.sender][to];
        if (existing.timestamp != 0) {
            // Cooldown check for re-vouching
            uint256 elapsed = block.timestamp - existing.timestamp;
            if (elapsed < HANDSHAKE_COOLDOWN) {
                revert VouchCooldown(HANDSHAKE_COOLDOWN - elapsed);
            }
            // Update existing vouch (no need to push to arrays again)
            existing.timestamp = block.timestamp;
            existing.messageHash = messageHash;

            emit VouchAdded(msg.sender, to, messageHash);

            // Check for handshake (already may exist)
            isHandshake_ = _vouches[to][msg.sender].timestamp != 0;
            return isHandshake_;
        }

        // New vouch
        _vouches[msg.sender][to] = Vouch({
            timestamp: block.timestamp,
            messageHash: messageHash
        });
        _vouchesFrom[msg.sender].push(to);
        _vouchedBy[to].push(msg.sender);

        // Insert vouch into Merkle audit trail
        if (_vouchTreeInitialized) {
            bytes32 vouchLeaf = keccak256(abi.encodePacked(
                msg.sender, to, block.timestamp, messageHash
            ));
            _vouchTree.insert(vouchLeaf);
        }

        emit VouchAdded(msg.sender, to, messageHash);

        // Check if this creates a handshake (reverse vouch exists)
        isHandshake_ = _vouches[to][msg.sender].timestamp != 0;
        if (isHandshake_) {
            // Check handshake doesn't already exist
            if (!_handshakeExists(msg.sender, to)) {
                _handshakes.push(Handshake({
                    user1: msg.sender,
                    user2: to,
                    timestamp: block.timestamp
                }));
                emit HandshakeConfirmed(msg.sender, to);
            }
        }
    }

    /// @inheritdoc IContributionDAG
    function revokeVouch(address to) external {
        if (_vouches[msg.sender][to].timestamp == 0) revert NoVouchExists();

        // Clear vouch
        delete _vouches[msg.sender][to];

        // Remove from outgoing list
        _removeFromArray(_vouchesFrom[msg.sender], to);

        // Remove from reverse index
        _removeFromArray(_vouchedBy[to], msg.sender);

        emit VouchRevoked(msg.sender, to);

        // Remove handshake if it existed
        _removeHandshake(msg.sender, to);
    }

    /// @inheritdoc IContributionDAG
    function recalculateTrustScores() external {
        // Clear all existing scores
        for (uint256 i = 0; i < _scoredUsers.length; i++) {
            delete _trustScores[_scoredUsers[i]];
        }
        delete _scoredUsers;

        // Initialize founders with max trust
        for (uint256 i = 0; i < _founders.length; i++) {
            address founder = _founders[i];
            address[] memory chain = new address[](1);
            chain[0] = founder;

            _trustScores[founder] = TrustScore({
                score: PRECISION,
                hopsFromFounder: 0,
                isFounder: true,
                trustChain: chain
            });
            _scoredUsers.push(founder);
        }

        // BFS from founders
        // Use a simple queue via dynamic array
        uint256 queueHead = 0;
        // Queue entries: packed as [user, hops, chainStartIndex]
        // We'll use a separate array approach for gas efficiency

        // Build BFS queue starting from founders
        address[] memory queueUsers = new address[](256); // max BFS nodes
        uint8[] memory queueHops = new uint8[](256);
        uint256 queueTail = 0;

        for (uint256 i = 0; i < _founders.length; i++) {
            queueUsers[queueTail] = _founders[i];
            queueHops[queueTail] = 0;
            queueTail++;
        }

        // Track visited (founders already visited)
        mapping(address => bool) storage visited = _isFounder;
        // We need a separate visited tracking that doesn't corrupt _isFounder
        // Use a temporary approach: score existence check
        // If _trustScores[user].score > 0 || _trustScores[user].isFounder, they're visited

        while (queueHead < queueTail) {
            address user = queueUsers[queueHead];
            uint8 hops = queueHops[queueHead];
            queueHead++;

            // Find all users this person has vouched for
            address[] storage outgoing = _vouchesFrom[user];

            for (uint256 i = 0; i < outgoing.length; i++) {
                address vouchedUser = outgoing[i];

                // Only traverse handshakes (bidirectional trust)
                if (_vouches[vouchedUser][user].timestamp == 0) continue;

                // Skip already visited
                if (_trustScores[vouchedUser].score > 0 || _trustScores[vouchedUser].isFounder) continue;

                uint8 newHops = hops + 1;
                if (newHops > MAX_TRUST_HOPS) continue;

                // Calculate trust score with decay: (1 - 0.15)^hops
                // In BPS: ((BPS - TRUST_DECAY_PER_HOP) / BPS)^hops
                uint256 trustScore = PRECISION;
                uint256 decayFactor = BPS - TRUST_DECAY_PER_HOP; // 8500
                for (uint8 h = 0; h < newHops; h++) {
                    trustScore = (trustScore * decayFactor) / BPS;
                }

                // Build trust chain by extending parent's chain
                address[] memory parentChain = _trustScores[user].trustChain;
                address[] memory newChain = new address[](parentChain.length + 1);
                for (uint256 j = 0; j < parentChain.length; j++) {
                    newChain[j] = parentChain[j];
                }
                newChain[parentChain.length] = vouchedUser;

                _trustScores[vouchedUser] = TrustScore({
                    score: trustScore,
                    hopsFromFounder: newHops,
                    isFounder: false,
                    trustChain: newChain
                });
                _scoredUsers.push(vouchedUser);

                // Add to BFS queue
                if (queueTail < 256) {
                    queueUsers[queueTail] = vouchedUser;
                    queueHops[queueTail] = newHops;
                    queueTail++;
                }
            }
        }

        emit TrustScoresRecalculated(queueTail);
    }

    // ============ View Functions ============

    /// @inheritdoc IContributionDAG
    function getTrustScore(address user) external view returns (
        uint256 score,
        string memory level,
        uint256 multiplier,
        uint8 hops,
        address[] memory trustChain
    ) {
        TrustScore storage ts = _trustScores[user];

        if (ts.score == 0 && !ts.isFounder) {
            // Not in trust network
            return (0, "UNTRUSTED", UNTRUSTED_MULTIPLIER, type(uint8).max, new address[](0));
        }

        score = ts.score;
        hops = ts.hopsFromFounder;
        trustChain = ts.trustChain;

        if (ts.isFounder) {
            level = "FOUNDER";
            multiplier = FOUNDER_MULTIPLIER;
        } else if (ts.score >= TRUSTED_THRESHOLD) {
            level = "TRUSTED";
            multiplier = TRUSTED_MULTIPLIER;
        } else if (ts.score >= PARTIAL_THRESHOLD) {
            level = "PARTIAL_TRUST";
            multiplier = PARTIAL_TRUST_MULTIPLIER;
        } else {
            level = "LOW_TRUST";
            multiplier = BPS; // 1.0x
        }
    }

    /// @inheritdoc IContributionDAG
    function getVotingPowerMultiplier(address user) external view returns (uint256) {
        TrustScore storage ts = _trustScores[user];

        if (ts.score == 0 && !ts.isFounder) return UNTRUSTED_MULTIPLIER;
        if (ts.isFounder) return FOUNDER_MULTIPLIER;
        if (ts.score >= TRUSTED_THRESHOLD) return TRUSTED_MULTIPLIER;
        if (ts.score >= PARTIAL_THRESHOLD) return PARTIAL_TRUST_MULTIPLIER;
        return BPS; // 1.0x for LOW_TRUST
    }

    /// @inheritdoc IContributionDAG
    function calculateReferralQuality(address user) external view returns (
        uint256 score,
        uint256 penalty
    ) {
        address[] storage outgoing = _vouchesFrom[user];
        if (outgoing.length == 0) {
            return (PRECISION, 0); // No vouches = no penalty
        }

        // Average trust score of referrals
        uint256 totalRefScore = 0;
        uint256 badReferrals = 0;

        for (uint256 i = 0; i < outgoing.length; i++) {
            uint256 refScore = _trustScores[outgoing[i]].score;
            totalRefScore += refScore;
            // Bad referral threshold: score < 0.2 (2e17)
            if (refScore < 2e17) {
                badReferrals++;
            }
        }

        // Bad referral ratio penalty: each bad referral costs up to 50% max
        // penalty = min(0.5, badRatio * 0.5) in PRECISION scale
        uint256 badRatio = (badReferrals * PRECISION) / outgoing.length;
        penalty = (badRatio * PRECISION) / (2 * PRECISION); // badRatio * 0.5
        if (penalty > PRECISION / 2) {
            penalty = PRECISION / 2;
        }

        score = PRECISION - penalty;
    }

    /// @inheritdoc IContributionDAG
    function calculateDiversityScore(address user) external view returns (
        uint256 score,
        uint256 penalty
    ) {
        address[] storage incoming = _vouchedBy[user];
        if (incoming.length == 0) {
            return (0, 0); // No vouchers = no diversity
        }

        // Count mutual vouches vs one-way inward
        uint256 mutualCount = 0;
        for (uint256 i = 0; i < incoming.length; i++) {
            // Check if I also vouch for them (mutual)
            if (_vouches[user][incoming[i]].timestamp != 0) {
                mutualCount++;
            }
        }

        uint256 inwardOnly = incoming.length - mutualCount;

        // Diversity = ratio of non-mutual to total vouches received
        uint256 diversity = (inwardOnly * PRECISION) / incoming.length;

        // Insularity = 1 - diversity
        uint256 insularity = PRECISION - diversity;

        // Penalty kicks in at 80% insularity
        uint256 insularityThreshold = (PRECISION * 80) / 100; // 0.8
        if (insularity > insularityThreshold) {
            // penalty = (insularity - 0.8) * 2
            penalty = (insularity - insularityThreshold) * 2;
            if (penalty > PRECISION) penalty = PRECISION;
        }

        score = penalty > PRECISION ? 0 : PRECISION - penalty;
    }

    /// @inheritdoc IContributionDAG
    function hasVouch(address from, address to) external view returns (bool) {
        return _vouches[from][to].timestamp != 0;
    }

    /// @inheritdoc IContributionDAG
    function hasHandshake(address user1, address user2) external view returns (bool) {
        return _handshakeExists(user1, user2);
    }

    /// @inheritdoc IContributionDAG
    function getVouchesFrom(address user) external view returns (address[] memory) {
        return _vouchesFrom[user];
    }

    /// @inheritdoc IContributionDAG
    function getVouchesFor(address user) external view returns (address[] memory) {
        return _vouchedBy[user];
    }

    /// @inheritdoc IContributionDAG
    function isFounder(address user) external view returns (bool) {
        return _isFounder[user];
    }

    /// @inheritdoc IContributionDAG
    function getFounders() external view returns (address[] memory) {
        return _founders;
    }

    /// @inheritdoc IContributionDAG
    function getHandshakeCount() external view returns (uint256) {
        return _handshakes.length;
    }

    // ============ Merkle Vouch Audit Trail ============

    /// @notice Get the Merkle root of all vouches (compressed audit trail)
    function getVouchTreeRoot() external view returns (bytes32) {
        return _vouchTree.getRoot();
    }

    /// @notice Verify a vouch exists in the Merkle tree
    function verifyVouch(
        bytes32[] calldata proof,
        address from,
        address to,
        uint256 timestamp,
        bytes32 messageHash
    ) external view returns (bool) {
        bytes32 leaf = keccak256(abi.encodePacked(from, to, timestamp, messageHash));
        return _vouchTree.verify(proof, leaf)
            || _vouchTree.isKnownRoot(_recomputeRoot(proof, leaf));
    }

    /// @notice Check if a root is in the vouch tree's recent history
    function isKnownVouchRoot(bytes32 root) external view returns (bool) {
        return _vouchTree.isKnownRoot(root);
    }

    /// @notice Get the number of vouches recorded in the Merkle tree
    function getVouchTreeCount() external view returns (uint256) {
        return _vouchTree.getNextIndex();
    }

    // ============ Admin Functions ============

    /// @notice Add a founder (root of trust DAG)
    function addFounder(address founder) external onlyOwner {
        if (_isFounder[founder]) revert AlreadyFounder();
        if (_founders.length >= MAX_FOUNDERS) revert MaxFoundersReached();

        _isFounder[founder] = true;
        _founders.push(founder);

        emit FounderAdded(founder);
    }

    /// @notice Remove a founder
    function removeFounder(address founder) external onlyOwner {
        if (!_isFounder[founder]) revert NotFounder();

        _isFounder[founder] = false;
        _removeFromArray(_founders, founder);

        emit FounderRemoved(founder);
    }

    /// @notice Set SoulboundIdentity contract (address(0) to disable check)
    function setSoulboundIdentity(address _soulbound) external onlyOwner {
        soulboundIdentity = _soulbound;
    }

    // ============ Internal Helpers ============

    function _handshakeExists(address a, address b) internal view returns (bool) {
        for (uint256 i = 0; i < _handshakes.length; i++) {
            Handshake storage h = _handshakes[i];
            if ((h.user1 == a && h.user2 == b) || (h.user1 == b && h.user2 == a)) {
                return true;
            }
        }
        return false;
    }

    function _removeHandshake(address a, address b) internal {
        for (uint256 i = 0; i < _handshakes.length; i++) {
            Handshake storage h = _handshakes[i];
            if ((h.user1 == a && h.user2 == b) || (h.user1 == b && h.user2 == a)) {
                emit HandshakeRevoked(h.user1, h.user2);
                // Swap with last and pop
                _handshakes[i] = _handshakes[_handshakes.length - 1];
                _handshakes.pop();
                return;
            }
        }
    }

    function _removeFromArray(address[] storage arr, address target) internal {
        for (uint256 i = 0; i < arr.length; i++) {
            if (arr[i] == target) {
                arr[i] = arr[arr.length - 1];
                arr.pop();
                return;
            }
        }
    }

    /// @dev Recompute Merkle root from proof + leaf (for historical root verification)
    function _recomputeRoot(
        bytes32[] calldata proof,
        bytes32 leaf
    ) internal pure returns (bytes32) {
        bytes32 computedHash = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            computedHash = IncrementalMerkleTree._hashPair(computedHash, proof[i]);
        }
        return computedHash;
    }
}
