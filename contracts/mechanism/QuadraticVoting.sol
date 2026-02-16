// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/IQuadraticVoting.sol";
import "../oracle/IReputationOracle.sol";

/// @notice Minimal SoulboundIdentity interface for Sybil checks
interface ISoulboundIdentityQV {
    function hasIdentity(address addr) external view returns (bool);
}

/**
 * @title QuadraticVoting
 * @notice Whale-resistant governance via quadratic vote pricing
 * @dev Cost of N votes = N^2 JUL tokens, locked until proposal finalization.
 *      Incremental cost to add K votes when you have M = (M+K)^2 - M^2.
 *      Cooperative Capitalism: amplifies community voice, prevents plutocracy.
 */
contract QuadraticVoting is Ownable, ReentrancyGuard, IQuadraticVoting {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 public constant MAX_VOTING_DURATION = 30 days;
    uint256 public constant MIN_VOTING_DURATION = 1 hours;

    // ============ State ============

    /// @notice JUL token used for voting
    IERC20 public immutable julToken;

    /// @notice ReputationOracle for proposer eligibility
    IReputationOracle public immutable reputationOracle;

    /// @notice SoulboundIdentity for Sybil resistance
    ISoulboundIdentityQV public immutable soulboundIdentity;

    /// @notice Number of proposals created
    uint256 public proposalCount;

    /// @notice Minimum JUL balance to create a proposal
    uint256 public proposalThreshold;

    /// @notice Minimum votes (sum of for + against) for a proposal to be valid
    uint256 public quorumVotes;

    /// @notice Minimum reputation tier to create proposals
    uint8 public minProposerTier;

    /// @notice Duration of the voting period
    uint256 public votingDuration;

    /// @notice Proposals by ID (1-indexed)
    mapping(uint256 => Proposal) internal _proposals;

    /// @notice Voter positions: proposalId => voter => position
    mapping(uint256 => mapping(address => VoterPosition)) internal _voterPositions;

    // ============ Constructor ============

    constructor(
        address _julToken,
        address _reputationOracle,
        address _soulboundIdentity
    ) Ownable(msg.sender) {
        julToken = IERC20(_julToken);
        reputationOracle = IReputationOracle(_reputationOracle);
        soulboundIdentity = ISoulboundIdentityQV(_soulboundIdentity);

        proposalThreshold = 100 ether; // 100 JUL to propose
        quorumVotes = 10;              // 10 total votes minimum
        minProposerTier = 1;           // Tier 1+ can propose
        votingDuration = 3 days;       // 3-day voting window
    }

    // ============ Core Functions ============

    /// @inheritdoc IQuadraticVoting
    function createProposal(
        string calldata description,
        bytes32 ipfsHash
    ) external returns (uint256 proposalId) {
        // Sybil check
        if (!soulboundIdentity.hasIdentity(msg.sender)) revert NoIdentity();

        // Reputation gate
        if (!reputationOracle.isEligible(msg.sender, minProposerTier)) {
            revert InsufficientReputation();
        }

        // Token threshold
        if (julToken.balanceOf(msg.sender) < proposalThreshold) {
            revert BelowProposalThreshold();
        }

        proposalId = ++proposalCount;

        uint64 startTime = uint64(block.timestamp);
        uint64 endTime = uint64(block.timestamp + votingDuration);

        _proposals[proposalId] = Proposal({
            proposer: msg.sender,
            description: description,
            ipfsHash: ipfsHash,
            startTime: startTime,
            endTime: endTime,
            forVotes: 0,
            againstVotes: 0,
            totalTokensLocked: 0,
            state: ProposalState.ACTIVE
        });

        emit ProposalCreated(proposalId, msg.sender, description, ipfsHash, startTime, endTime);
    }

    /// @inheritdoc IQuadraticVoting
    function castVote(
        uint256 proposalId,
        bool support,
        uint256 numVotes
    ) external nonReentrant {
        if (numVotes == 0) revert ZeroVotes();

        Proposal storage proposal = _proposals[proposalId];
        if (proposal.proposer == address(0)) revert ProposalNotFound();
        if (proposal.state != ProposalState.ACTIVE) revert ProposalNotActive();
        if (block.timestamp >= proposal.endTime) revert VotingEnded();

        // Sybil check
        if (!soulboundIdentity.hasIdentity(msg.sender)) revert NoIdentity();

        VoterPosition storage position = _voterPositions[proposalId][msg.sender];

        // Calculate incremental cost
        // If voter has M existing votes in this direction, adding K costs (M+K)^2 - M^2
        uint256 existingVotes = support ? position.votesFor : position.votesAgainst;
        uint256 newTotal = existingVotes + numVotes;
        uint256 incrementalCost = (newTotal * newTotal) - (existingVotes * existingVotes);

        // Transfer JUL from voter
        julToken.safeTransferFrom(msg.sender, address(this), incrementalCost);

        // Update position
        if (support) {
            position.votesFor += numVotes;
            proposal.forVotes += numVotes;
        } else {
            position.votesAgainst += numVotes;
            proposal.againstVotes += numVotes;
        }
        position.tokensLocked += incrementalCost;
        proposal.totalTokensLocked += incrementalCost;

        emit VoteCast(proposalId, msg.sender, support, numVotes, incrementalCost);
    }

    /// @inheritdoc IQuadraticVoting
    function finalizeProposal(uint256 proposalId) external {
        Proposal storage proposal = _proposals[proposalId];
        if (proposal.proposer == address(0)) revert ProposalNotFound();
        if (proposal.state != ProposalState.ACTIVE) revert ProposalAlreadyFinalized();
        if (block.timestamp < proposal.endTime) revert VotingNotEnded();

        uint256 totalVotes = proposal.forVotes + proposal.againstVotes;

        if (totalVotes < quorumVotes) {
            proposal.state = ProposalState.DEFEATED;
        } else if (proposal.forVotes > proposal.againstVotes) {
            proposal.state = ProposalState.SUCCEEDED;
        } else {
            proposal.state = ProposalState.DEFEATED;
        }

        emit ProposalFinalized(proposalId, proposal.state);
    }

    /// @inheritdoc IQuadraticVoting
    function withdrawTokens(uint256 proposalId) external nonReentrant {
        Proposal storage proposal = _proposals[proposalId];
        if (proposal.proposer == address(0)) revert ProposalNotFound();

        ProposalState state = proposal.state;
        if (
            state != ProposalState.DEFEATED &&
            state != ProposalState.SUCCEEDED &&
            state != ProposalState.EXECUTED &&
            state != ProposalState.EXPIRED
        ) {
            revert ProposalNotFinalized();
        }

        VoterPosition storage position = _voterPositions[proposalId][msg.sender];
        if (position.withdrawn) revert AlreadyWithdrawn();
        if (position.tokensLocked == 0) revert NoTokensToWithdraw();

        position.withdrawn = true;
        uint256 amount = position.tokensLocked;

        julToken.safeTransfer(msg.sender, amount);

        emit TokensWithdrawn(proposalId, msg.sender, amount);
    }

    // ============ View Functions ============

    /// @inheritdoc IQuadraticVoting
    function voteCost(uint256 numVotes) external pure returns (uint256) {
        return numVotes * numVotes;
    }

    /// @inheritdoc IQuadraticVoting
    function getProposal(uint256 proposalId) external view returns (Proposal memory) {
        return _proposals[proposalId];
    }

    /// @inheritdoc IQuadraticVoting
    function getVoterPosition(
        uint256 proposalId,
        address voter
    ) external view returns (VoterPosition memory) {
        return _voterPositions[proposalId][voter];
    }

    // ============ Admin Functions ============

    function setQuorum(uint256 _quorumVotes) external onlyOwner {
        uint256 old = quorumVotes;
        quorumVotes = _quorumVotes;
        emit QuorumUpdated(old, _quorumVotes);
    }

    function setMinProposerTier(uint8 _tier) external onlyOwner {
        uint8 old = minProposerTier;
        minProposerTier = _tier;
        emit MinProposerTierUpdated(old, _tier);
    }

    function setProposalThreshold(uint256 _threshold) external onlyOwner {
        uint256 old = proposalThreshold;
        proposalThreshold = _threshold;
        emit ProposalThresholdUpdated(old, _threshold);
    }

    function setVotingDuration(uint256 _duration) external onlyOwner {
        require(_duration >= MIN_VOTING_DURATION && _duration <= MAX_VOTING_DURATION, "Invalid duration");
        uint256 old = votingDuration;
        votingDuration = _duration;
        emit VotingDurationUpdated(old, _duration);
    }
}
