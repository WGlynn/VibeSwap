// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/IConvictionGovernance.sol";
import "../oracle/IReputationOracle.sol";

/// @notice Minimal SoulboundIdentity interface for Sybil checks
interface ISoulboundIdentityCG {
    function hasIdentity(address addr) external view returns (bool);
}

/**
 * @title ConvictionGovernance
 * @notice Time-weighted preference signaling for governance proposals
 * @dev Conviction = stake x duration (O(1) math from VibeStream).
 *      conviction(T) = effectiveT * totalStake - stakeTimeProd
 *      Dynamic threshold: threshold = baseThreshold + requestedAmount * multiplierBps / 10000
 *      Cooperative Capitalism: long-term holders shape governance, flash-loan resistant.
 */
contract ConvictionGovernance is Ownable, ReentrancyGuard, IConvictionGovernance {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 public constant MAX_PROPOSAL_DURATION = 90 days;
    uint256 public constant MIN_PROPOSAL_DURATION = 1 days;

    // ============ State ============

    /// @notice JUL token for staking
    IERC20 public immutable julToken;

    /// @notice ReputationOracle for proposer eligibility
    IReputationOracle public immutable reputationOracle;

    /// @notice SoulboundIdentity for Sybil resistance
    ISoulboundIdentityCG public immutable soulboundIdentity;

    /// @notice Number of proposals created
    uint256 public proposalCount;

    /// @notice Base conviction threshold (before scaling by requested amount)
    uint256 public baseThreshold;

    /// @notice Multiplier for requested amount scaling (bps)
    uint256 public thresholdMultiplierBps;

    /// @notice Default max duration for proposals
    uint256 public defaultMaxDuration;

    /// @notice Minimum reputation tier to create proposals
    uint8 public minProposerTier;

    /// @notice Authorized resolvers who can execute passed proposals
    mapping(address => bool) public resolvers;

    /// @notice Proposals by ID (1-indexed)
    mapping(uint256 => GovernanceProposal) internal _proposals;

    /// @notice Conviction aggregates per proposal (O(1) pattern from VibeStream)
    mapping(uint256 => ConvictionState) internal _convictionStates;

    /// @notice Staker positions: proposalId => staker => position
    mapping(uint256 => mapping(address => StakerPosition)) internal _stakerPositions;

    // ============ Constructor ============

    constructor(
        address _julToken,
        address _reputationOracle,
        address _soulboundIdentity
    ) Ownable(msg.sender) {
        julToken = IERC20(_julToken);
        reputationOracle = IReputationOracle(_reputationOracle);
        soulboundIdentity = ISoulboundIdentityCG(_soulboundIdentity);

        baseThreshold = 1000 ether;        // 1000 JUL-seconds base
        thresholdMultiplierBps = 100;       // 1% of requested amount added per unit
        defaultMaxDuration = 30 days;
        minProposerTier = 1;
    }

    // ============ Core Functions ============

    /// @inheritdoc IConvictionGovernance
    function createProposal(
        string calldata description,
        bytes32 ipfsHash,
        uint256 requestedAmount
    ) external returns (uint256 proposalId) {
        if (requestedAmount == 0) revert ZeroRequestedAmount();

        // Sybil check
        if (!soulboundIdentity.hasIdentity(msg.sender)) revert NoIdentity();

        // Reputation gate
        if (!reputationOracle.isEligible(msg.sender, minProposerTier)) {
            revert InsufficientReputation();
        }

        proposalId = ++proposalCount;

        _proposals[proposalId] = GovernanceProposal({
            proposer: msg.sender,
            description: description,
            ipfsHash: ipfsHash,
            startTime: uint64(block.timestamp),
            maxDuration: uint64(defaultMaxDuration),
            requestedAmount: requestedAmount,
            state: GovernanceProposalState.ACTIVE
        });

        emit ProposalCreated(
            proposalId,
            msg.sender,
            description,
            requestedAmount,
            uint64(defaultMaxDuration)
        );
    }

    /// @inheritdoc IConvictionGovernance
    function signalConviction(uint256 proposalId, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        GovernanceProposal storage proposal = _proposals[proposalId];
        if (proposal.proposer == address(0)) revert ProposalNotFound();
        if (proposal.state != GovernanceProposalState.ACTIVE) revert ProposalNotActive();

        // Reject signals after deadline (would corrupt conviction math)
        uint256 deadline = uint256(proposal.startTime) + uint256(proposal.maxDuration);
        if (block.timestamp >= deadline) revert ProposalNotActive();

        // Sybil check
        if (!soulboundIdentity.hasIdentity(msg.sender)) revert NoIdentity();

        StakerPosition storage position = _stakerPositions[proposalId][msg.sender];
        if (position.amount != 0) revert AlreadyStaking();

        // Pull JUL from staker
        julToken.safeTransferFrom(msg.sender, address(this), amount);

        // Update conviction aggregates (O(1) — from VibeStream pattern)
        ConvictionState storage cs = _convictionStates[proposalId];
        cs.totalStake += amount;
        cs.stakeTimeProd += amount * block.timestamp;

        // Store staker position
        position.amount = amount;
        position.signalTime = uint64(block.timestamp);

        emit ConvictionSignaled(proposalId, msg.sender, amount);
    }

    /// @inheritdoc IConvictionGovernance
    function removeSignal(uint256 proposalId) external nonReentrant {
        GovernanceProposal storage proposal = _proposals[proposalId];
        if (proposal.proposer == address(0)) revert ProposalNotFound();

        StakerPosition storage position = _stakerPositions[proposalId][msg.sender];
        if (position.amount == 0) revert NotStaking();

        uint256 stakeAmount = position.amount;

        // Update conviction aggregates
        ConvictionState storage cs = _convictionStates[proposalId];
        cs.totalStake -= stakeAmount;
        cs.stakeTimeProd -= stakeAmount * uint256(position.signalTime);

        // Clear position
        delete _stakerPositions[proposalId][msg.sender];

        // Return staked tokens
        julToken.safeTransfer(msg.sender, stakeAmount);

        emit ConvictionRemoved(proposalId, msg.sender, stakeAmount);
    }

    /// @inheritdoc IConvictionGovernance
    function triggerPass(uint256 proposalId) external {
        GovernanceProposal storage proposal = _proposals[proposalId];
        if (proposal.proposer == address(0)) revert ProposalNotFound();
        if (proposal.state != GovernanceProposalState.ACTIVE) revert ProposalNotActive();

        uint256 conviction = _getConviction(proposalId);
        uint256 threshold = _getThreshold(proposalId);

        if (conviction < threshold) revert ThresholdNotMet();

        proposal.state = GovernanceProposalState.PASSED;

        emit ProposalPassed(proposalId, conviction, threshold);
    }

    /// @inheritdoc IConvictionGovernance
    function executeProposal(uint256 proposalId) external {
        GovernanceProposal storage proposal = _proposals[proposalId];
        if (proposal.proposer == address(0)) revert ProposalNotFound();
        if (proposal.state != GovernanceProposalState.PASSED) revert ProposalNotPassed();
        if (!resolvers[msg.sender] && msg.sender != owner()) revert NotResolver();

        proposal.state = GovernanceProposalState.EXECUTED;

        emit ProposalExecuted(proposalId);
    }

    /// @inheritdoc IConvictionGovernance
    function expireProposal(uint256 proposalId) external {
        GovernanceProposal storage proposal = _proposals[proposalId];
        if (proposal.proposer == address(0)) revert ProposalNotFound();
        if (proposal.state != GovernanceProposalState.ACTIVE) revert ProposalNotActive();

        uint256 deadline = uint256(proposal.startTime) + uint256(proposal.maxDuration);
        if (block.timestamp < deadline) revert ProposalNotExpired();

        proposal.state = GovernanceProposalState.EXPIRED;

        emit ProposalExpired(proposalId);
    }

    // ============ Internal Functions ============

    /**
     * @notice Compute conviction at current time (O(1))
     * @dev conviction = effectiveT * totalStake - stakeTimeProd
     *      Copied from VibeStream._getConviction()
     */
    function _getConviction(uint256 proposalId) internal view returns (uint256) {
        ConvictionState storage cs = _convictionStates[proposalId];
        if (cs.totalStake == 0) return 0;

        GovernanceProposal storage proposal = _proposals[proposalId];
        uint256 deadline = uint256(proposal.startTime) + uint256(proposal.maxDuration);
        uint256 effectiveT = block.timestamp < deadline ? block.timestamp : deadline;

        return effectiveT * cs.totalStake - cs.stakeTimeProd;
    }

    /**
     * @notice Compute dynamic threshold for a proposal
     * @dev threshold = baseThreshold + requestedAmount * multiplierBps / 10000
     *      Bigger asks need more conviction to pass.
     */
    function _getThreshold(uint256 proposalId) internal view returns (uint256) {
        GovernanceProposal storage proposal = _proposals[proposalId];
        return baseThreshold + (proposal.requestedAmount * thresholdMultiplierBps) / 10000;
    }

    // ============ View Functions ============

    /// @inheritdoc IConvictionGovernance
    function getConviction(uint256 proposalId) external view returns (uint256) {
        return _getConviction(proposalId);
    }

    /// @inheritdoc IConvictionGovernance
    function getThreshold(uint256 proposalId) external view returns (uint256) {
        return _getThreshold(proposalId);
    }

    /// @inheritdoc IConvictionGovernance
    function getProposal(uint256 proposalId) external view returns (GovernanceProposal memory) {
        return _proposals[proposalId];
    }

    /// @inheritdoc IConvictionGovernance
    function getStakerPosition(
        uint256 proposalId,
        address staker
    ) external view returns (StakerPosition memory) {
        return _stakerPositions[proposalId][staker];
    }

    // ============ Admin Functions ============

    function setBaseThreshold(uint256 _baseThreshold) external onlyOwner {
        uint256 old = baseThreshold;
        baseThreshold = _baseThreshold;
        emit BaseThresholdUpdated(old, _baseThreshold);
    }

    function setThresholdMultiplier(uint256 _multiplierBps) external onlyOwner {
        uint256 old = thresholdMultiplierBps;
        thresholdMultiplierBps = _multiplierBps;
        emit ThresholdMultiplierUpdated(old, _multiplierBps);
    }

    function setDefaultMaxDuration(uint256 _duration) external onlyOwner {
        require(
            _duration >= MIN_PROPOSAL_DURATION && _duration <= MAX_PROPOSAL_DURATION,
            "Invalid duration"
        );
        uint256 old = defaultMaxDuration;
        defaultMaxDuration = _duration;
        emit MaxDurationUpdated(old, _duration);
    }

    function setMinProposerTier(uint8 _tier) external onlyOwner {
        minProposerTier = _tier;
    }

    function addResolver(address resolver) external onlyOwner {
        resolvers[resolver] = true;
    }

    function removeResolver(address resolver) external onlyOwner {
        resolvers[resolver] = false;
    }
}
