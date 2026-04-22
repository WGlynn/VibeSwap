// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
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
 *
 * ============================================================================
 * Design rationale — why NCI lives in a smart contract, not a new L1
 * ============================================================================
 *
 * NCI is a novel consensus protocol. The canonical move would be to launch a
 * greenfield L1 chain that runs it natively. We explicitly chose the opposite:
 * implement NCI as an upgradeable smart contract on an existing EVM chain
 * (with LayerZero omnichain messaging for cross-chain liveness). The reasons:
 *
 * 1. Augmentation over replacement (Augmented Mechanism Design).
 *    The VibeSwap thesis is to augment existing markets/chains with
 *    math-enforced invariants, not to replace them. A smart-contract
 *    consensus primitive augments the EVM ecosystem with a new accountability
 *    layer; a greenfield L1 would fragment it.
 *
 * 2. Game-theory validation before network investment.
 *    Standing up an L1 (p2p networking, state sync, block gossip, client
 *    diversity, node operator acquisition) is years of infrastructure. The
 *    game theory of PoW+PoS+PoM weighting can be stress-tested on-contract
 *    in weeks. If the three-dimensional security model doesn't hold up to
 *    real adversarial conditions, we learn that before committing to a
 *    full-stack chain build. If it does, the contract becomes a reference
 *    implementation for a future L1 or rollup port.
 *
 * 3. Inherited economic security.
 *    A greenfield L1 starts with zero economic security and a cold-start
 *    validator bootstrap problem — the #1 killer of novel consensus projects.
 *    Running inside an existing chain inherits that chain's security budget
 *    for the data-availability and ordering substrate. NCI only needs to
 *    secure its own weighting logic, not block production from scratch.
 *
 * 4. Upgradeable iteration.
 *    Consensus rules evolve with observed attack patterns. On an L1, changing
 *    the rules requires a coordinated hard fork — a political event. Here,
 *    a UUPS proxy upgrade is a governance transaction. Fast iteration at
 *    the mechanism layer is existential while the design is young.
 *
 * 5. Composability with VibeSwap primitives.
 *    NCI validators earn Shapley-distributed rewards from the same treasury
 *    that pays LPs and operators. Slashing routes through the same slash-pool
 *    sweep pattern as C29/C30. Cross-chain would force bridges between NCI
 *    and its own incentive layer, defeating the economic coupling that gives
 *    the math its teeth.
 *
 * 6. Observation cost.
 *    Smart-contract execution is fully introspectable — every validator
 *    weight recompute, every slash, every Trinity node change emits an event
 *    indexable from a standard subgraph. An L1's consensus state lives in
 *    untrusted node logs. The contract form lets us prove the mechanism
 *    works in public before asking anyone to run a client.
 *
 * The tradeoff: gas cost per operation is higher than native consensus. We
 * accept that because the information we need to ship NCI credibly — real
 * validator behavior under real adversarial pressure with real money at
 * stake — is only extractable from a live deployment. The contract gets us
 * there in weeks, not years.
 *
 * ----------------------------------------------------------------------------
 * Two things the contract form is NOT
 * ----------------------------------------------------------------------------
 *
 * It is not just a prototype. Contract-based abstraction consensus — running
 * a novel consensus weighting layer inside smart contracts on top of an
 * existing chain's ordering substrate — may prove to be a durable paradigm
 * in its own right. Other protocols with economic-security-at-a-layer-above
 * requirements could pattern-match. The experience of shipping NCI this way
 * is an artifact worth publishing regardless of VibeSwap's eventual L1 path.
 *
 * Prior art worth acknowledging: Chainlink pioneered the general shape of
 * contract-layer staked operator networks — off-chain compute with on-chain
 * collateral, economic penalties enforced by aggregator contracts, a service
 * surface callable by other protocols. Their work demonstrated the paradigm
 * is viable at production scale. NCI is adjacent-but-deeper: we use the same
 * contract-layer staking+slashing primitive but run *consensus weighting*
 * rather than *data-feed aggregation*, and we add Proof of Mind — a
 * time-accumulated, unbuyable cognitive dimension with no analogue in the
 * Chainlink operator-reputation model (theirs is a scoring heuristic over
 * an honest-majority-of-operators trust assumption; PoM is a protocol
 * invariant over a time-of-genuine-work trust assumption). Think of it as:
 * Chainlink showed *that* you can run stake-backed services at the contract
 * layer; NCI explores *how far the primitive stretches* when you push it
 * into the consensus-weighting role and add a third security dimension.
 *
 * It is not the permanent home. VibeSwap's security structure is
 * fundamentally different from any existing chain. Proof of Mind is a
 * time-accumulated, unbuyable weighting primitive; its dependencies
 * (SoulboundIdentity, ContributionDAG, VibeCode, AgentReputation) are
 * first-class protocol state, not contract reads from oracles. At native
 * scale these become chain-level primitives — the block header commits to
 * the identity/reputation/contribution ledger, consensus reads them
 * directly, and the PoM weighting becomes a protocol invariant rather than
 * a contract invariant. No EVM chain can host this natively because EVM
 * chains don't track PoM state at the base layer. The move to our own
 * network is a when, not an if — driven by substrate necessity, not by
 * "graduation" from the contract form.
 */
contract NakamotoConsensusInfinity is
    INakamotoConsensusInfinity,
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

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

    // ============ Staking Constants ============

    uint256 public constant MIN_STAKE = 100e18;  // NCI-002: Minimum stake to register
    uint256 public constant UNBONDING_PERIOD = 7 days;  // NCI-009: Unbonding delay
    uint256 public constant MAX_VALIDATORS = 10_000;  // C24-F1: DoS cap on validatorList (iteration bound)

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

    // Equivocation detection: epoch => voter => dataHash => voted (O(1) lookup)
    mapping(uint256 => mapping(address => mapping(bytes32 => bool))) private _epochVoteHashes;
    // Track if validator voted for any hash this epoch (for equivocation detection)
    mapping(uint256 => mapping(address => bytes32)) private _epochFirstVoteHash;

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

    // ============ 3-Token NCI State ============

    /// @notice CKB-native token — PoS dimension (30% weight)
    /// @dev Replaces vibeToken for staking. VIBE remains for PoM (governance/contribution).
    IERC20 public ckbNativeToken;

    /// @notice Joule token — PoW dimension (10% weight)
    /// @dev Read cumulative mining stats from Joule for PoW weight calculation
    address public jouleToken;

    // NCI-001: Track used nonces per validator per epoch (prevents PoW replay)
    mapping(address => mapping(uint256 => mapping(bytes32 => bool))) private _usedNonces;

    // NCI-007/008: Running total of active weight (O(1) instead of O(n) loop)
    uint256 public totalActiveWeight;

    // NCI-009: Unbonding state
    mapping(address => uint256) public unbondingAmount;
    mapping(address => uint256) public unbondingUnlockTime;

    /// @dev Reserved storage gap for future upgrades (44 remaining)
    uint256[44] private __gap;

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
        // NCI-002: Require minimum stake to prevent Sybil + gas DoS
        if (stakeAmount < MIN_STAKE) revert InsufficientStake();
        // C24-F1: Hard cap on active validator list to bound _checkHeartbeats iteration
        if (validatorList.length >= MAX_VALIDATORS) revert MaxValidatorsReached();

        // Authority nodes require Trinity approval (must already be a trinity node)
        if (nodeType == NodeType.AUTHORITY) {
            if (!trinityStatus[msg.sender]) revert NotTrinityNode();
        }

        // Transfer CKB-native stake (PoS dimension)
        // Falls back to vibeToken if ckbNativeToken not set (backwards compatible)
        IERC20 stakeToken = address(ckbNativeToken) != address(0) ? ckbNativeToken : vibeToken;
        // NCI-004: SafeERC20 for tokens that return false instead of reverting
        stakeToken.safeTransferFrom(msg.sender, address(this), stakeAmount);

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

        // Compute initial weights and update running total
        _recalculateWeights(msg.sender);
        // NCI-007: Track totalActiveWeight incrementally
        totalActiveWeight += _validators[msg.sender].totalWeight;

        emit ValidatorRegistered(msg.sender, nodeType, stakeAmount);
    }

    // ============ Staking ============

    /// @inheritdoc INakamotoConsensusInfinity
    function depositStake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Validator storage v = _validators[msg.sender];
        if (v.registeredAt == 0) revert NotRegistered();
        if (v.slashed) revert ValidatorSlashedErr();

        IERC20 stakeToken = address(ckbNativeToken) != address(0) ? ckbNativeToken : vibeToken;
        stakeToken.safeTransferFrom(msg.sender, address(this), amount);
        v.stakedVibe += amount;
        totalStaked += amount;

        // NCI-007: Update running total
        uint256 oldWeight = v.totalWeight;
        _recalculateWeights(msg.sender);
        if (v.active && !v.slashed) {
            totalActiveWeight = totalActiveWeight - oldWeight + v.totalWeight;
        }

        emit StakeDeposited(msg.sender, amount, v.stakedVibe);
    }

    /// @notice NCI-009: Two-phase withdrawal. Request starts unbonding period.
    /// @dev NCI-010: Slashed validators cannot withdraw.
    function requestStakeWithdrawal(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Validator storage v = _validators[msg.sender];
        if (v.registeredAt == 0) revert NotRegistered();
        if (v.slashed) revert ValidatorSlashedErr();
        if (v.stakedVibe < amount) revert InsufficientStake();

        uint256 oldWeight = v.totalWeight;
        v.stakedVibe -= amount;
        totalStaked -= amount;

        _recalculateWeights(msg.sender);
        if (v.active && !v.slashed) {
            totalActiveWeight = totalActiveWeight - oldWeight + v.totalWeight;
        }

        unbondingAmount[msg.sender] += amount;
        // C7-GOV-009: Only set timelock on first request — don't reset on subsequent.
        // Same pattern as DAOShelter C5-CON-005. Prevents timer-reset griefing where
        // a tiny additional request delays an already-almost-mature withdrawal.
        if (unbondingUnlockTime[msg.sender] == 0 || block.timestamp >= unbondingUnlockTime[msg.sender]) {
            unbondingUnlockTime[msg.sender] = block.timestamp + UNBONDING_PERIOD;
        }

        emit StakeWithdrawn(msg.sender, amount, v.stakedVibe);
    }

    /// @notice Complete stake withdrawal after unbonding period
    /// @dev C7-GOV-010: Slashed validators can still withdraw their (reduced) unbonding.
    ///      The slash already deducted the penalty in _slashEquivocator.
    function completeStakeWithdrawal() external nonReentrant {
        uint256 amount = unbondingAmount[msg.sender];
        require(amount > 0, "Nothing unbonding");
        require(block.timestamp >= unbondingUnlockTime[msg.sender], "Unbonding not complete");

        unbondingAmount[msg.sender] = 0;
        unbondingUnlockTime[msg.sender] = 0;

        IERC20 stakeToken = address(ckbNativeToken) != address(0) ? ckbNativeToken : vibeToken;
        stakeToken.safeTransfer(msg.sender, amount);
    }

    /// @notice C5-CON-001: Legacy withdrawStake REMOVED — bypassed 7-day unbonding.
    /// @dev Use requestStakeWithdrawal() + completeStakeWithdrawal() instead.
    ///      Keeping function signature to avoid interface breakage; it always reverts.
    function withdrawStake(uint256) external pure {
        revert("Deprecated: use requestStakeWithdrawal");
    }

    // ============ Proof of Work ============

    /// @inheritdoc INakamotoConsensusInfinity
    /// @dev NCI-001: Nonce replay prevention. Each nonce is tracked per (validator, epoch).
    function submitPoW(bytes32 nonce) external {
        Validator storage v = _validators[msg.sender];
        if (v.registeredAt == 0) revert NotRegistered();
        if (!v.active) revert NotActive();

        // NCI-001: Prevent nonce replay within the same epoch
        require(!_usedNonces[msg.sender][currentEpochNumber][nonce], "Nonce already used");
        _usedNonces[msg.sender][currentEpochNumber][nonce] = true;

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

        uint256 oldWeight = v.totalWeight;
        v.cumulativePoW++;
        totalPoWSubmissions++;

        _recalculateWeights(msg.sender);
        // NCI-007: Update running total
        if (v.active && !v.slashed) {
            totalActiveWeight = totalActiveWeight - oldWeight + v.totalWeight;
        }

        emit PoWSubmitted(msg.sender, v.cumulativePoW, v.powWeight);
    }

    // ============ Proof of Mind ============

    /// @inheritdoc INakamotoConsensusInfinity
    function refreshMindScore() external {
        Validator storage v = _validators[msg.sender];
        if (v.registeredAt == 0) revert NotRegistered();

        uint256 newMindScore = _aggregateMindScore(msg.sender);
        v.mindScore = newMindScore;

        uint256 oldWeight = v.totalWeight;
        _recalculateWeights(msg.sender);
        if (v.active && !v.slashed) {
            totalActiveWeight = totalActiveWeight - oldWeight + v.totalWeight;
        }

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
            totalActiveWeight += v.totalWeight;
        }

        emit HeartbeatReceived(msg.sender, block.timestamp);
    }

    /// @inheritdoc INakamotoConsensusInfinity
    function deactivateValidator() external {
        Validator storage v = _validators[msg.sender];
        if (v.registeredAt == 0) revert NotRegistered();
        if (!v.active) revert NotActive();

        totalActiveWeight -= v.totalWeight;
        v.active = false;
        activeValidatorCount--;
        // C24-F1: Remove from iteration list to keep _checkHeartbeats bounded
        _removeFromValidatorList(msg.sender);

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

        // NCI-013: Check equivocation BEFORE counting vote weight.
        // If equivocating, slash and return — vote is NOT counted, slash persists.
        bytes32 firstHash = _epochFirstVoteHash[p.epochNumber][msg.sender];
        if (firstHash != bytes32(0) && firstHash != p.dataHash) {
            // Equivocation detected — slash, don't count the vote, return (no revert)
            _slashEquivocator(msg.sender, p.epochNumber, firstHash, p.dataHash);
            return; // Vote not counted, slashing persists
        }

        // Track vote hash (O(1) instead of unbounded array)
        if (firstHash == bytes32(0)) {
            _epochFirstVoteHash[p.epochNumber][msg.sender] = p.dataHash;
        }
        _epochVoteHashes[p.epochNumber][msg.sender][p.dataHash] = true;

        hasVotedOn[proposalId][msg.sender] = true;

        uint256 weight = v.totalWeight;

        if (support) {
            p.weightFor += weight;
        } else {
            p.weightAgainst += weight;
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

    /// @dev C36-F2: emits old→new for admin-action observability.
    function setSoulboundIdentity(address addr) external onlyOwner {
        address old = soulboundIdentity;
        soulboundIdentity = addr;
        emit SoulboundIdentityUpdated(old, addr);
    }

    /// @dev C36-F2.
    function setContributionDAG(address addr) external onlyOwner {
        address old = contributionDAG;
        contributionDAG = addr;
        emit ContributionDAGUpdated(old, addr);
    }

    /// @dev C36-F2.
    function setVibeCode(address addr) external onlyOwner {
        address old = vibeCode;
        vibeCode = addr;
        emit VibeCodeUpdated(old, addr);
    }

    /// @dev C36-F2.
    function setAgentReputation(address addr) external onlyOwner {
        address old = agentReputation;
        agentReputation = addr;
        emit AgentReputationUpdated(old, addr);
    }

    /// @notice Set the CKB-native token for PoS staking
    /// @dev C36-F2.
    function setCKBNativeToken(address addr) external onlyOwner {
        address old = address(ckbNativeToken);
        ckbNativeToken = IERC20(addr);
        emit CKBNativeTokenUpdated(old, addr);
    }

    /// @notice Set the Joule token address for PoW weight lookups
    /// @dev C36-F2.
    function setJouleToken(address addr) external onlyOwner {
        address old = jouleToken;
        jouleToken = addr;
        emit JouleTokenUpdated(old, addr);
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

    // ============ Cognitive Retention (α = 1.6 convex decay) ============

    /// @notice Retention horizon constants. RETENTION_HORIZON_DEFAULT is the
    ///         full-decay time T used when calling `calculateRetentionWeight`
    ///         without an explicit horizon. α = 1.6 per paper §6.4 (Ebbinghaus).
    uint256 public constant RETENTION_HORIZON_DEFAULT = 365 days;
    uint256 public constant RETENTION_ALPHA_BPS = 16000; // α = 1.6 (documentary; value is hardcoded in polynomial)

    /// @notice Compute cognitive-retention weight `1 − (t/T)^1.6` in basis points.
    /// @dev Convex decay matching cognitive substrate (Ebbinghaus retention + §6.4).
    ///      α = 1.6 is encoded into the cubic polynomial `0.1744·x + 1.116·x² − 0.2904·x³`
    ///      fitted to `x^1.6` on [0,1]. Max error ~3%, sufficient for consensus weighting.
    ///
    ///      Retention applies to PoW and PoM pillars only (work + mind — both historical
    ///      records whose relevance fades). PoS is present-tense locked capital and is
    ///      NOT subject to retention decay.
    ///
    ///      This is a CORRECTNESS-PROOF primitive. Integration into _recalculateWeights
    ///      is gated on six design decisions — see NCI_WEIGHT_FUNCTION.md (C40b).
    /// @param elapsedSec Seconds since the reference timestamp (contribution / PoW submission / attestation).
    /// @param horizonSec Full-decay horizon T, in seconds. Pass 0 to use RETENTION_HORIZON_DEFAULT.
    /// @return weightBps Retention weight in basis points: BPS = fresh, 0 = fully decayed.
    function calculateRetentionWeight(uint256 elapsedSec, uint256 horizonSec)
        public
        pure
        returns (uint256 weightBps)
    {
        uint256 horizon = horizonSec == 0 ? RETENTION_HORIZON_DEFAULT : horizonSec;
        if (elapsedSec >= horizon) return 0;

        // ratio = (t / T) expressed in BPS (0 … BPS). Always < BPS here.
        uint256 ratioBps = (elapsedSec * BPS) / horizon;

        // decay = (t/T)^1.6 in BPS, via the cubic approximation.
        uint256 decayBps = _pow16Bps(ratioBps);

        // weight = 1 - decay. Clamp: polynomial error can push decay slightly above BPS
        // near x=1; treat as fully decayed in that pathological case.
        return decayBps >= BPS ? 0 : BPS - decayBps;
    }

    /// @dev Approximates `x^1.6` for x in [0, BPS] using the cubic
    ///      p(x) = 0.1744·x + 1.116·x² − 0.2904·x³ (least-squares fit through
    ///      (0,0), (0.25, 0.1088), (0.5, 0.3299), (0.75, 0.6339), (1,1)).
    ///      Coefficients scaled by 10 for integer arithmetic: 1744, 11160, 2904 → /10000.
    ///      Input and output both in BPS. `x >= BPS` clamps to BPS (i.e. x^1.6 for x≥1 saturates).
    function _pow16Bps(uint256 xBps) internal pure returns (uint256) {
        if (xBps == 0) return 0;
        if (xBps >= BPS) return BPS;

        uint256 x2 = (xBps * xBps) / BPS;       // x² in BPS
        uint256 x3 = (x2 * xBps) / BPS;         // x³ in BPS

        // positive terms: 0.1744·x + 1.116·x²
        uint256 pos = (1744 * xBps) + (11160 * x2);
        // negative term: 0.2904·x³
        uint256 neg = 2904 * x3;

        // Guard: the polynomial can produce `pos < neg` only when coefficients
        // or inputs are out of expected range. For valid x ∈ [0, BPS] this never
        // fires, but defensive bound keeps the view function total.
        if (neg > pos) return 0;

        // Scale back down by 10000 (coefficients were ×10000 for integer arithmetic).
        return (pos - neg) / BPS;
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

    /// @dev NCI-007/008: O(1) — returns running total instead of iterating validatorList.
    function _getTotalActiveWeight() internal view returns (uint256) {
        return totalActiveWeight;
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

        // NCI-007: Remove weight BEFORE modifying state
        if (v.active) {
            totalActiveWeight -= v.totalWeight;
        }

        // Slash 50% of stake
        uint256 stakeSlash = (v.stakedVibe * EQUIVOCATION_STAKE_SLASH_BPS) / BPS;
        if (stakeSlash > 0) {
            v.stakedVibe -= stakeSlash;
            totalStaked -= stakeSlash;
            // Slashed stake stays in contract (redistributable by governance)
        }

        // C7-GOV-010: Also slash unbonding amount — prevents validator from
        // requesting withdrawal THEN equivocating to avoid the penalty.
        uint256 unbondSlash = (unbondingAmount[validator] * EQUIVOCATION_STAKE_SLASH_BPS) / BPS;
        if (unbondSlash > 0) {
            unbondingAmount[validator] -= unbondSlash;
            // Slashed unbonding also stays in contract
        }

        // Slash 75% of mind score
        uint256 mindSlash = (v.mindScore * EQUIVOCATION_MIND_SLASH_BPS) / BPS;
        v.mindScore -= mindSlash;

        v.slashed = true;
        v.active = false;
        activeValidatorCount--;
        // C24-F1: Remove from iteration list to keep _checkHeartbeats bounded
        _removeFromValidatorList(validator);

        _recalculateWeights(validator);
        // Weight is now 0 (slashed + inactive) — no need to re-add to totalActiveWeight

        emit EquivocationDetected(validator, epochNumber, hash1, hash2);
        emit ValidatorSlashed(validator, stakeSlash, mindSlash, "equivocation");
    }

    // ============ Internal: Heartbeat Checks ============

    /// @dev NCI-008 + C24-F1: Iterates validatorList; on deactivation, swap-and-pop
    ///      to keep the list bounded. With MAX_VALIDATORS cap on registration and
    ///      active-only membership, this loop is bounded by MAX_VALIDATORS at worst
    ///      and by activeValidatorCount in practice.
    function _checkHeartbeats() internal {
        uint256 i = 0;
        while (i < validatorList.length) {
            address addr = validatorList[i];
            Validator storage v = _validators[addr];
            if (v.active && !v.slashed && block.timestamp > v.lastHeartbeat + HEARTBEAT_GRACE) {
                totalActiveWeight -= v.totalWeight;
                v.active = false;
                activeValidatorCount--;
                _removeFromValidatorList(addr);
                emit ValidatorDeactivated(addr);
                // Do not increment i — the slot now holds a different validator (or shrank).
                continue;
            }
            unchecked { ++i; }
        }
    }

    /// @dev C24-F1: Swap-and-pop removal from validatorList + clear index.
    ///      Caller is responsible for all other state updates (active flag, counters).
    ///      No-op if addr is not in the list (defensive).
    function _removeFromValidatorList(address addr) internal {
        uint256 indexPlusOne = _validatorIndex[addr];
        if (indexPlusOne == 0) return;
        uint256 idx = indexPlusOne - 1;
        uint256 lastIdx = validatorList.length - 1;
        if (idx != lastIdx) {
            address lastAddr = validatorList[lastIdx];
            validatorList[idx] = lastAddr;
            _validatorIndex[lastAddr] = idx + 1;
        }
        validatorList.pop();
        _validatorIndex[addr] = 0;
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
