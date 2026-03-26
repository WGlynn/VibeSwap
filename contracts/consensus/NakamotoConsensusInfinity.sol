// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./INakamotoConsensusInfinity.sol";

/**
 * @title NakamotoConsensusInfinity — Three-Dimensional Consensus
 * @author Faraday1 & JARVIS
 * @notice Implements Nakamoto Consensus ∞ (NCI) — the first consensus mechanism
 *         that uses three dimensions of security: Proof of Work (computational),
 *         Proof of Stake (economic), and Proof of Mind (cognitive).
 *
 * Core formula:
 *   W(node) = 0.10 × PoW(node) + 0.30 × PoS(node) + 0.60 × PoM(node)
 *
 * Key properties:
 *   - Attack cost = hashpower + stake + TIME_OF_GENUINE_WORK
 *   - Time cannot be purchased or accelerated
 *   - The only way to attack the system is to contribute to it
 *   - Security grows monotonically with network age
 *   - lim(t→∞) Attack_cost(t) = ∞
 *
 * Integration points:
 *   - Joule.sol       → PoW pillar (SHA-256 mining, difficulty adjustment)
 *   - VIBEToken.sol   → PoS pillar (21M cap, Shapley distribution)
 *   - SoulboundIdentity + ContributionDAG + VibeCode + AgentReputation → PoM pillar
 *
 * @dev UUPS upgradeable. Uses logarithmic scaling on PoW and PoM to prevent
 *      plutocracy of compute or expertise. Stake is linear — capital has
 *      diminishing marginal utility in the combined weight.
 *
 * See: docs/papers/nakamoto-consensus-infinite.md (Knowledge Primitive P-027)
 */
contract NakamotoConsensusInfinity is
    INakamotoConsensusInfinity,
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    // ============ Dimension Weight Constants (BPS) ============

    uint256 public constant POW_WEIGHT_BPS = 1000;    // 10%
    uint256 public constant POS_WEIGHT_BPS = 3000;    // 30%
    uint256 public constant POM_WEIGHT_BPS = 6000;    // 60%
    uint256 public constant BPS = 10000;

    // ============ Scaling Constants ============

    uint256 public constant WAD = 1e18;

    /// @notice log₂ scale for PoW weight (prevents compute plutocracy)
    /// @dev PoW_weight = log₂(1 + cumulative_valid_solutions) * POW_SCALE
    uint256 public constant POW_SCALE = 1e18;

    /// @notice PoM scale factor for mind score → weight conversion
    /// @dev Mind_weight = log₂(1 + mind_score) * POM_SCALE
    uint256 public constant POM_SCALE = 1e18;

    /// @notice PoS normalization — 1 VIBE staked = 1e18 weight units
    /// @dev Stake_weight = stakedVibe (linear, no log transform)
    uint256 public constant POS_SCALE = 1; // 1:1 (VIBE is already 18 decimals)

    // ============ Slashing Constants ============

    uint256 public constant EQUIVOCATION_STAKE_SLASH_BPS = 5000;  // 50% of stake
    uint256 public constant EQUIVOCATION_MIND_SLASH_BPS = 7500;   // 75% of mind score

    // ============ Trinity / Liveness Constants ============

    uint256 public constant MIN_TRINITY_NODES = 2;    // BFT minimum
    uint256 public constant HEARTBEAT_INTERVAL = 24 hours;
    uint256 public constant HEARTBEAT_GRACE = 48 hours; // Auto-deactivate after 2x missed

    // ============ Epoch Constants ============

    uint256 public constant EPOCH_DURATION = 10;       // 10 seconds (matches batch auction)
    uint256 public constant FINALIZATION_THRESHOLD_BPS = 6667; // 2/3 supermajority
    uint256 public constant PROPOSAL_EXPIRY = 60;      // 60 seconds

    // ============ PoW Difficulty ============

    uint128 public constant POW_DIFFICULTY = 1 << 12;  // Lighter than Joule's main mining

    // ============ State: Validators ============

    mapping(address => Validator) private _validators;
    address[] public validatorList;
    mapping(address => uint256) private _validatorIndex; // addr => index+1 in validatorList

    uint256 public activeValidatorCount;
    uint256 public totalStaked;
    uint256 public totalPoWSubmissions;

    // ============ State: Trinity ============

    address[] public trinityNodes;
    mapping(address => bool) public trinityStatus;

    // ============ State: Epochs ============

    mapping(uint256 => EpochInfo) private _epochs;
    uint256 public currentEpochNumber;
    uint256 public epochStartTime;

    // ============ State: Proposals ============

    mapping(uint256 => Proposal) private _proposals;
    uint256 public proposalCount;
    mapping(uint256 => mapping(address => bool)) public hasVotedOn;

    // Equivocation detection: epoch => voter => proposal hashes voted for
    mapping(uint256 => mapping(address => bytes32[])) private _epochVotes;

    // ============ State: External Contracts ============

    IERC20 public vibeToken;

    /// @notice SoulboundIdentity — human identity (contributions, reputation, XP)
    address public soulboundIdentity;

    /// @notice ContributionDAG — trust graph (BFS scoring, founder-rooted)
    address public contributionDAG;

    /// @notice VibeCode — behavioral fingerprint (builder/funder/ideator/community)
    address public vibeCode;

    /// @notice VibeAgentReputation — AI agent multi-dimensional reputation
    address public agentReputation;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _vibeToken,
        address _soulboundIdentity,
        address _contributionDAG,
        address _vibeCode,
        address _agentReputation
    ) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        vibeToken = IERC20(_vibeToken);
        soulboundIdentity = _soulboundIdentity;
        contributionDAG = _contributionDAG;
        vibeCode = _vibeCode;
        agentReputation = _agentReputation;

        // Initialize epoch 0
        currentEpochNumber = 0;
        epochStartTime = block.timestamp;
        _epochs[0] = EpochInfo({
            epochNumber: 0,
            startTime: block.timestamp,
            finalizedHash: bytes32(0),
            finalized: false
        });
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Validator Registration ============

    /// @inheritdoc INakamotoConsensusInfinity
    function registerValidator(NodeType nodeType, uint256 stakeAmount) external nonReentrant {
        if (_validators[msg.sender].registeredAt != 0) revert AlreadyRegistered();

        // Authority nodes require Trinity approval (must already be a trinity node)
        if (nodeType == NodeType.AUTHORITY) {
            if (!trinityStatus[msg.sender]) revert NotTrinityNode();
        }

        // Transfer VIBE stake
        if (stakeAmount > 0) {
            vibeToken.transferFrom(msg.sender, address(this), stakeAmount);
        }

        _validators[msg.sender] = Validator({
            addr: msg.sender,
            nodeType: nodeType,
            cumulativePoW: 0,
            stakedVibe: stakeAmount,
            mindScore: 0,
            powWeight: 0,
            posWeight: stakeAmount * POS_SCALE,
            pomWeight: 0,
            totalWeight: 0,
            lastHeartbeat: block.timestamp,
            active: true,
            slashed: false,
            registeredAt: block.timestamp
        });

        validatorList.push(msg.sender);
        _validatorIndex[msg.sender] = validatorList.length; // 1-indexed
        activeValidatorCount++;
        totalStaked += stakeAmount;

        // Compute initial weights
        _recalculateWeights(msg.sender);

        emit ValidatorRegistered(msg.sender, nodeType, stakeAmount);
    }

    // ============ Staking ============

    /// @inheritdoc INakamotoConsensusInfinity
    function depositStake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Validator storage v = _validators[msg.sender];
        if (v.registeredAt == 0) revert NotRegistered();
        if (v.slashed) revert ValidatorSlashedErr();

        vibeToken.transferFrom(msg.sender, address(this), amount);
        v.stakedVibe += amount;
        totalStaked += amount;

        _recalculateWeights(msg.sender);

        emit StakeDeposited(msg.sender, amount, v.stakedVibe);
    }

    /// @inheritdoc INakamotoConsensusInfinity
    function withdrawStake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Validator storage v = _validators[msg.sender];
        if (v.registeredAt == 0) revert NotRegistered();
        if (v.stakedVibe < amount) revert InsufficientStake();

        v.stakedVibe -= amount;
        totalStaked -= amount;

        vibeToken.transfer(msg.sender, amount);

        _recalculateWeights(msg.sender);

        emit StakeWithdrawn(msg.sender, amount, v.stakedVibe);
    }

    // ============ Proof of Work ============

    /// @inheritdoc INakamotoConsensusInfinity
    function submitPoW(bytes32 nonce) external {
        Validator storage v = _validators[msg.sender];
        if (v.registeredAt == 0) revert NotRegistered();
        if (!v.active) revert NotActive();

        // Generate challenge unique to this validator + epoch
        bytes32 challenge = keccak256(abi.encodePacked(
            address(this),
            msg.sender,
            currentEpochNumber,
            block.chainid
        ));

        // Verify SHA-256 PoW
        bytes32 hash = sha256(abi.encodePacked(challenge, nonce));
        uint256 hashValue = uint256(hash);
        if (hashValue >= type(uint256).max / POW_DIFFICULTY) revert InvalidPoW();

        v.cumulativePoW++;
        totalPoWSubmissions++;

        _recalculateWeights(msg.sender);

        emit PoWSubmitted(msg.sender, v.cumulativePoW, v.powWeight);
    }

    // ============ Proof of Mind ============

    /// @inheritdoc INakamotoConsensusInfinity
    function refreshMindScore() external {
        Validator storage v = _validators[msg.sender];
        if (v.registeredAt == 0) revert NotRegistered();

        uint256 newMindScore = _aggregateMindScore(msg.sender);
        v.mindScore = newMindScore;

        _recalculateWeights(msg.sender);

        emit MindScoreUpdated(msg.sender, newMindScore, v.pomWeight);
    }

    /// @notice Aggregate mind score from all PoM sources for a given address
    /// @dev Queries SoulboundIdentity, ContributionDAG, VibeCode, AgentReputation
    ///      Each sub-call is isolated in its own function to avoid stack-too-deep.
    function _aggregateMindScore(address addr) internal view returns (uint256 score) {
        score += _getMindFromIdentity(addr);
        score += _getMindFromDAG(addr);
        score += _getMindFromVibeCode(addr);
        score += _getMindFromAgentRep(addr);
    }

    /// @dev SoulboundIdentity contribution: level, XP, contributions, reputation
    function _getMindFromIdentity(address addr) internal view returns (uint256) {
        if (soulboundIdentity == address(0)) return 0;

        (bool ok, bytes memory data) = soulboundIdentity.staticcall(
            abi.encodeWithSignature("hasIdentity(address)", addr)
        );
        if (!ok || data.length < 32 || !abi.decode(data, (bool))) return 0;

        (bool ok2, bytes memory data2) = soulboundIdentity.staticcall(
            abi.encodeWithSignature("addressToTokenId(address)", addr)
        );
        if (!ok2 || data2.length < 32) return 0;

        uint256 tokenId = abi.decode(data2, (uint256));
        if (tokenId == 0) return 0;

        (bool ok3, bytes memory data3) = soulboundIdentity.staticcall(
            abi.encodeWithSignature("identities(uint256)", tokenId)
        );
        if (!ok3 || data3.length < 256) return 0;

        // Decode partial struct: username(string), level, xp, alignment, contributions, reputation
        (, uint256 level, uint256 xp,, uint256 contributions, uint256 reputation,,) =
            abi.decode(data3, (string, uint256, uint256, int256, uint256, uint256, uint256, uint256));
        return level * 100 + xp + contributions * 50 + reputation * 200;
    }

    /// @dev ContributionDAG: trust multiplier (BPS scale, founder=30000)
    function _getMindFromDAG(address addr) internal view returns (uint256) {
        if (contributionDAG == address(0)) return 0;
        (bool ok, bytes memory data) = contributionDAG.staticcall(
            abi.encodeWithSignature("getVotingPowerMultiplier(address)", addr)
        );
        if (!ok || data.length < 32) return 0;
        return abi.decode(data, (uint256));
    }

    /// @dev VibeCode: composite score (0-10000), scaled 10x
    function _getMindFromVibeCode(address addr) internal view returns (uint256) {
        if (vibeCode == address(0)) return 0;
        (bool ok, bytes memory data) = vibeCode.staticcall(
            abi.encodeWithSignature("getProfile(address)", addr)
        );
        if (!ok || data.length < 256) return 0;
        (, uint256 totalScore) = abi.decode(data, (bytes32, uint256));
        return totalScore * 10;
    }

    /// @dev AgentReputation: composite score (0-10000) for AI agents, scaled 10x
    function _getMindFromAgentRep(address addr) internal view returns (uint256) {
        if (agentReputation == address(0)) return 0;
        bytes32 agentId = keccak256(abi.encodePacked(addr));
        (bool ok, bytes memory data) = agentReputation.staticcall(
            abi.encodeWithSignature("getCompositeScore(bytes32)", agentId)
        );
        if (!ok || data.length < 32) return 0;
        return abi.decode(data, (uint256)) * 10;
    }

    // ============ Heartbeat / Liveness ============

    /// @inheritdoc INakamotoConsensusInfinity
    function heartbeat() external {
        Validator storage v = _validators[msg.sender];
        if (v.registeredAt == 0) revert NotRegistered();

        v.lastHeartbeat = block.timestamp;

        // Reactivate if previously deactivated by missed heartbeat
        if (!v.active && !v.slashed) {
            v.active = true;
            activeValidatorCount++;
        }

        emit HeartbeatReceived(msg.sender, block.timestamp);
    }

    /// @inheritdoc INakamotoConsensusInfinity
    function deactivateValidator() external {
        Validator storage v = _validators[msg.sender];
        if (v.registeredAt == 0) revert NotRegistered();
        if (!v.active) revert NotActive();

        v.active = false;
        activeValidatorCount--;

        emit ValidatorDeactivated(msg.sender);
    }

    // ============ Consensus: Proposals ============

    /// @inheritdoc INakamotoConsensusInfinity
    function propose(bytes32 dataHash) external returns (uint256 proposalId) {
        Validator storage v = _validators[msg.sender];
        if (v.registeredAt == 0) revert NotRegistered();
        if (!v.active) revert NotActive();

        proposalId = proposalCount++;

        _proposals[proposalId] = Proposal({
            proposalId: proposalId,
            epochNumber: currentEpochNumber,
            dataHash: dataHash,
            proposer: msg.sender,
            weightFor: 0,
            weightAgainst: 0,
            status: ProposalStatus.VOTING,
            createdAt: block.timestamp,
            finalizedAt: 0
        });

        emit ProposalCreated(proposalId, currentEpochNumber, msg.sender, dataHash);
    }

    /// @inheritdoc INakamotoConsensusInfinity
    function vote(uint256 proposalId, bool support) external {
        Proposal storage p = _proposals[proposalId];
        if (p.status != ProposalStatus.VOTING) revert ProposalNotVoting();

        Validator storage v = _validators[msg.sender];
        if (v.registeredAt == 0) revert NotRegistered();
        if (!v.active) revert NotActive();
        if (hasVotedOn[proposalId][msg.sender]) revert AlreadyVoted();

        // Check for expired proposal
        if (block.timestamp > p.createdAt + PROPOSAL_EXPIRY) {
            p.status = ProposalStatus.EXPIRED;
            revert ProposalNotVoting();
        }

        hasVotedOn[proposalId][msg.sender] = true;

        uint256 weight = v.totalWeight;

        if (support) {
            p.weightFor += weight;
        } else {
            p.weightAgainst += weight;
        }

        // Track votes for equivocation detection
        _epochVotes[p.epochNumber][msg.sender].push(p.dataHash);

        // Check for equivocation: voting for conflicting proposals in same epoch
        bytes32[] storage votes = _epochVotes[p.epochNumber][msg.sender];
        if (votes.length > 1) {
            // Check if any two votes are for different data hashes
            for (uint256 i = 0; i < votes.length - 1; i++) {
                if (votes[i] != votes[votes.length - 1]) {
                    _slashEquivocator(msg.sender, p.epochNumber, votes[i], votes[votes.length - 1]);
                    break;
                }
            }
        }

        emit VoteCast(proposalId, msg.sender, support, weight);
    }

    /// @inheritdoc INakamotoConsensusInfinity
    function finalizeProposal(uint256 proposalId) external {
        Proposal storage p = _proposals[proposalId];
        if (p.status != ProposalStatus.VOTING) revert ProposalNotVoting();

        uint256 totalWeight = _getTotalActiveWeight();

        // Check 2/3 supermajority
        uint256 threshold = (totalWeight * FINALIZATION_THRESHOLD_BPS) / BPS;

        if (p.weightFor >= threshold) {
            p.status = ProposalStatus.FINALIZED;
            p.finalizedAt = block.timestamp;

            // Update epoch with finalized hash
            _epochs[p.epochNumber].finalizedHash = p.dataHash;
            _epochs[p.epochNumber].finalized = true;

            emit ProposalFinalized(proposalId, p.dataHash, true);
        } else if (p.weightAgainst > totalWeight - threshold) {
            // Cannot reach threshold even with remaining votes
            p.status = ProposalStatus.REJECTED;
            p.finalizedAt = block.timestamp;

            emit ProposalFinalized(proposalId, p.dataHash, false);
        } else if (block.timestamp > p.createdAt + PROPOSAL_EXPIRY) {
            p.status = ProposalStatus.EXPIRED;
            p.finalizedAt = block.timestamp;

            emit ProposalFinalized(proposalId, p.dataHash, false);
        }
        // else: not enough votes yet, do nothing
    }

    // ============ Epoch Management ============

    /// @inheritdoc INakamotoConsensusInfinity
    function advanceEpoch() external {
        if (block.timestamp < epochStartTime + EPOCH_DURATION) revert EpochNotReady();

        currentEpochNumber++;
        epochStartTime = block.timestamp;

        _epochs[currentEpochNumber] = EpochInfo({
            epochNumber: currentEpochNumber,
            startTime: block.timestamp,
            finalizedHash: bytes32(0),
            finalized: false
        });

        // Check for stale validators (missed heartbeat)
        _checkHeartbeats();

        emit EpochAdvanced(currentEpochNumber, bytes32(0));
    }

    // ============ Trinity Management ============

    /// @inheritdoc INakamotoConsensusInfinity
    function addTrinityNode(address node) external onlyOwner {
        require(!trinityStatus[node], "Already trinity");
        trinityStatus[node] = true;
        trinityNodes.push(node);

        // If they're an existing validator, upgrade to authority
        if (_validators[node].registeredAt != 0) {
            _validators[node].nodeType = NodeType.AUTHORITY;
        }

        emit TrinityNodeAdded(node);
    }

    /// @inheritdoc INakamotoConsensusInfinity
    function removeTrinityNode(address node) external onlyOwner {
        if (!trinityStatus[node]) revert NotTrinityNode();
        if (trinityNodes.length <= MIN_TRINITY_NODES) revert MinTrinityNodes();

        trinityStatus[node] = false;
        _removeFromArray(trinityNodes, node);

        // Downgrade to meta if they're a validator
        if (_validators[node].registeredAt != 0) {
            _validators[node].nodeType = NodeType.META;
        }

        emit TrinityNodeRemoved(node);
    }

    // ============ Admin: Update External Contracts ============

    function setSoulboundIdentity(address addr) external onlyOwner {
        soulboundIdentity = addr;
    }

    function setContributionDAG(address addr) external onlyOwner {
        contributionDAG = addr;
    }

    function setVibeCode(address addr) external onlyOwner {
        vibeCode = addr;
    }

    function setAgentReputation(address addr) external onlyOwner {
        agentReputation = addr;
    }

    // ============ View Functions ============

    /// @inheritdoc INakamotoConsensusInfinity
    function getValidator(address addr) external view returns (Validator memory) {
        return _validators[addr];
    }

    /// @inheritdoc INakamotoConsensusInfinity
    function getVoteWeight(address addr) external view returns (uint256) {
        return _validators[addr].totalWeight;
    }

    /// @inheritdoc INakamotoConsensusInfinity
    function getDimensionWeights(address addr) external view returns (
        uint256 powWeight, uint256 posWeight, uint256 pomWeight
    ) {
        Validator storage v = _validators[addr];
        return (v.powWeight, v.posWeight, v.pomWeight);
    }

    /// @inheritdoc INakamotoConsensusInfinity
    function getTotalNetworkWeight() external view returns (uint256) {
        return _getTotalActiveWeight();
    }

    /// @inheritdoc INakamotoConsensusInfinity
    function getProposal(uint256 proposalId) external view returns (Proposal memory) {
        return _proposals[proposalId];
    }

    /// @inheritdoc INakamotoConsensusInfinity
    function getCurrentEpoch() external view returns (EpochInfo memory) {
        return _epochs[currentEpochNumber];
    }

    /// @inheritdoc INakamotoConsensusInfinity
    function getActiveValidatorCount() external view returns (uint256) {
        return activeValidatorCount;
    }

    /// @inheritdoc INakamotoConsensusInfinity
    function getTrinityNodeCount() external view returns (uint256) {
        return trinityNodes.length;
    }

    /// @inheritdoc INakamotoConsensusInfinity
    function isTrinity(address addr) external view returns (bool) {
        return trinityStatus[addr];
    }

    /// @inheritdoc INakamotoConsensusInfinity
    function calculatePoWWeight(uint256 cumulativePoW) public pure returns (uint256) {
        // _log2 already returns result scaled by WAD (1e18)
        return _log2(1 + cumulativePoW);
    }

    /// @inheritdoc INakamotoConsensusInfinity
    function calculatePoMWeight(uint256 mindScore) public pure returns (uint256) {
        // _log2 already returns result scaled by WAD (1e18)
        return _log2(1 + mindScore);
    }

    // ============ Internal: Weight Calculation ============

    function _recalculateWeights(address addr) internal {
        Validator storage v = _validators[addr];

        // PoW weight: log₂(1 + cumulative_valid_solutions) * POW_SCALE
        v.powWeight = calculatePoWWeight(v.cumulativePoW);

        // PoS weight: linear stake (VIBE is 18 decimals)
        v.posWeight = v.stakedVibe * POS_SCALE;

        // PoM weight: log₂(1 + mind_score) * POM_SCALE
        v.pomWeight = calculatePoMWeight(v.mindScore);

        // Combined: W(node) = 0.10 × PoW + 0.30 × PoS + 0.60 × PoM
        v.totalWeight = (
            v.powWeight * POW_WEIGHT_BPS +
            v.posWeight * POS_WEIGHT_BPS +
            v.pomWeight * POM_WEIGHT_BPS
        ) / BPS;

        emit WeightsRecalculated(addr, v.powWeight, v.posWeight, v.pomWeight, v.totalWeight);
    }

    function _getTotalActiveWeight() internal view returns (uint256 total) {
        for (uint256 i = 0; i < validatorList.length; i++) {
            Validator storage v = _validators[validatorList[i]];
            if (v.active && !v.slashed) {
                total += v.totalWeight;
            }
        }
    }

    // ============ Internal: Equivocation & Slashing ============

    function _slashEquivocator(
        address validator,
        uint256 epochNumber,
        bytes32 hash1,
        bytes32 hash2
    ) internal {
        Validator storage v = _validators[validator];
        if (v.slashed) return; // Already slashed

        // Slash 50% of stake
        uint256 stakeSlash = (v.stakedVibe * EQUIVOCATION_STAKE_SLASH_BPS) / BPS;
        if (stakeSlash > 0) {
            v.stakedVibe -= stakeSlash;
            totalStaked -= stakeSlash;
            // Slashed stake stays in contract (redistributable by governance)
        }

        // Slash 75% of mind score
        uint256 mindSlash = (v.mindScore * EQUIVOCATION_MIND_SLASH_BPS) / BPS;
        v.mindScore -= mindSlash;

        v.slashed = true;
        v.active = false;
        activeValidatorCount--;

        _recalculateWeights(validator);

        emit EquivocationDetected(validator, epochNumber, hash1, hash2);
        emit ValidatorSlashed(validator, stakeSlash, mindSlash, "equivocation");
    }

    // ============ Internal: Heartbeat Checks ============

    function _checkHeartbeats() internal {
        for (uint256 i = 0; i < validatorList.length; i++) {
            Validator storage v = _validators[validatorList[i]];
            if (v.active && !v.slashed) {
                if (block.timestamp > v.lastHeartbeat + HEARTBEAT_GRACE) {
                    v.active = false;
                    activeValidatorCount--;
                    emit ValidatorDeactivated(validatorList[i]);
                }
            }
        }
    }

    // ============ Internal: Math ============

    /// @notice Integer log₂ approximation — returns floor(log₂(x)) * 1e18
    /// @dev Returns 0 for x <= 1. For x > 1, uses bit scanning.
    ///      This gives logarithmic scaling that prevents compute/expertise plutocracy.
    ///      Accurate to integer part only (sufficient for consensus weight calculation).
    function _log2(uint256 x) internal pure returns (uint256) {
        if (x <= 1) return 0;

        uint256 result = 0;

        // Find the highest set bit position (integer log₂)
        if (x >= 1 << 128) { x >>= 128; result += 128; }
        if (x >= 1 << 64)  { x >>= 64;  result += 64;  }
        if (x >= 1 << 32)  { x >>= 32;  result += 32;  }
        if (x >= 1 << 16)  { x >>= 16;  result += 16;  }
        if (x >= 1 << 8)   { x >>= 8;   result += 8;   }
        if (x >= 1 << 4)   { x >>= 4;   result += 4;   }
        if (x >= 1 << 2)   { x >>= 2;   result += 2;   }
        if (x >= 1 << 1)   { result += 1;               }

        // Scale to WAD (18 decimals)
        return result * WAD;
    }

    // ============ Internal: Array Helpers ============

    function _removeFromArray(address[] storage arr, address target) internal {
        for (uint256 i = 0; i < arr.length; i++) {
            if (arr[i] == target) {
                arr[i] = arr[arr.length - 1];
                arr.pop();
                return;
            }
        }
    }

    // ============ Receive ============

    receive() external payable {}
}
