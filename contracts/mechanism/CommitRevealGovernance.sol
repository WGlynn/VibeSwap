// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/ICommitRevealGovernance.sol";
import "../oracle/IReputationOracle.sol";

/// @notice Minimal SoulboundIdentity interface for Sybil checks
interface ISoulboundIdentityCRG {
    function hasIdentity(address addr) external view returns (bool);
}

/// @notice Minimal DAOTreasury interface for slashed fund deposits
interface IDAOTreasuryCRG {
    function deposit(address token, uint256 amount) external;
}

/**
 * @title CommitRevealGovernance
 * @notice Commit-reveal voting applied to governance decisions
 * @dev Mirrors CommitRevealAuction's commit/reveal/slash lifecycle but operates
 *      on governance timescales (days instead of seconds).
 *      Vote weight = JUL balance at commit time (snapshot).
 *      50% slash for unrevealed commits (matching CommitRevealAuction).
 *      Cooperative Capitalism: authentic preference revelation, no bandwagoning.
 */
contract CommitRevealGovernance is Ownable, ReentrancyGuard, ICommitRevealGovernance {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 public constant MIN_DEPOSIT = 0.001 ether;
    uint256 public constant MAX_SLASH_RATE_BPS = 10000;

    // ============ State ============

    /// @notice JUL token for vote weight snapshots
    IERC20 public immutable julToken;

    /// @notice ReputationOracle for proposer eligibility
    IReputationOracle public immutable reputationOracle;

    /// @notice SoulboundIdentity for Sybil resistance
    ISoulboundIdentityCRG public immutable soulboundIdentity;

    /// @notice DAO treasury receives slashed deposits
    address public treasury;

    /// @notice Number of votes created
    uint256 public voteCount;

    /// @notice Minimum ETH deposit per commitment
    uint256 public minDeposit;

    /// @notice Slash rate for unrevealed commits (bps, 5000 = 50%)
    uint256 public slashRateBps;

    /// @notice Minimum vote weight (sum) for a vote to pass
    uint256 public quorumWeight;

    /// @notice Default commit phase duration
    uint256 public defaultCommitDuration;

    /// @notice Default reveal phase duration
    uint256 public defaultRevealDuration;

    /// @notice Minimum reputation tier to create votes
    uint8 public minProposerTier;

    /// @notice Authorized resolvers who can execute passed votes
    mapping(address => bool) public resolvers;

    /// @notice Votes by ID (1-indexed)
    mapping(uint256 => GovernanceVote) internal _votes;

    /// @notice Commitments by commit ID
    mapping(bytes32 => VoteCommitment) internal _commitments;

    /// @notice Track whether a voter has committed on a vote: voteId => voter => bool
    mapping(uint256 => mapping(address => bool)) public hasCommitted;

    /// @notice Nonce for commit ID generation
    uint256 internal _commitNonce;

    // ============ Constructor ============

    constructor(
        address _julToken,
        address _reputationOracle,
        address _soulboundIdentity,
        address _treasury
    ) Ownable(msg.sender) {
        julToken = IERC20(_julToken);
        reputationOracle = IReputationOracle(_reputationOracle);
        soulboundIdentity = ISoulboundIdentityCRG(_soulboundIdentity);
        treasury = _treasury;

        minDeposit = MIN_DEPOSIT;
        slashRateBps = 5000;               // 50% slash (matching CommitRevealAuction)
        quorumWeight = 1000 ether;          // 1000 JUL weight minimum
        defaultCommitDuration = 2 days;
        defaultRevealDuration = 1 days;
        minProposerTier = 1;
    }

    // ============ Core Functions ============

    /// @inheritdoc ICommitRevealGovernance
    function createVote(
        string calldata description,
        bytes32 ipfsHash
    ) external returns (uint256 voteId) {
        // Sybil check
        if (!soulboundIdentity.hasIdentity(msg.sender)) revert NoIdentity();

        // Reputation gate
        if (!reputationOracle.isEligible(msg.sender, minProposerTier)) {
            revert InsufficientReputation();
        }

        voteId = ++voteCount;

        uint64 commitEnd = uint64(block.timestamp + defaultCommitDuration);
        uint64 revealEnd = uint64(block.timestamp + defaultCommitDuration + defaultRevealDuration);

        _votes[voteId] = GovernanceVote({
            proposer: msg.sender,
            description: description,
            ipfsHash: ipfsHash,
            phase: VotePhase.COMMIT,
            commitEnd: commitEnd,
            revealEnd: revealEnd,
            forWeight: 0,
            againstWeight: 0,
            abstainWeight: 0,
            commitCount: 0,
            revealCount: 0,
            slashedDeposits: 0,
            executed: false
        });

        emit VoteCreated(voteId, msg.sender, description, commitEnd, revealEnd);
    }

    /// @inheritdoc ICommitRevealGovernance
    function commitVote(
        uint256 voteId,
        bytes32 commitHash
    ) external payable nonReentrant returns (bytes32 commitId) {
        GovernanceVote storage vote = _votes[voteId];
        if (vote.proposer == address(0)) revert VoteNotFound();

        // Phase check: must be in commit phase
        _updatePhase(voteId);
        if (vote.phase != VotePhase.COMMIT) revert WrongPhase();

        // Sybil check
        if (!soulboundIdentity.hasIdentity(msg.sender)) revert NoIdentity();

        // One commit per voter per vote
        if (hasCommitted[voteId][msg.sender]) revert AlreadyCommitted();

        // Deposit check
        if (msg.value < minDeposit) revert InsufficientDeposit();

        // Generate commit ID
        commitId = _generateCommitId(msg.sender, voteId);

        // Snapshot vote weight at commit time
        uint256 weight = julToken.balanceOf(msg.sender);

        _commitments[commitId] = VoteCommitment({
            commitHash: commitHash,
            deposit: msg.value,
            voter: msg.sender,
            revealed: false,
            choice: VoteChoice.NONE,
            weight: weight
        });

        hasCommitted[voteId][msg.sender] = true;
        vote.commitCount++;

        emit VoteCommitted(voteId, commitId, msg.sender, msg.value);
    }

    /// @inheritdoc ICommitRevealGovernance
    function revealVote(
        uint256 voteId,
        bytes32 commitId,
        VoteChoice choice,
        bytes32 secret
    ) external nonReentrant {
        GovernanceVote storage vote = _votes[voteId];
        if (vote.proposer == address(0)) revert VoteNotFound();

        // Phase check
        _updatePhase(voteId);
        if (vote.phase != VotePhase.REVEAL) revert WrongPhase();

        VoteCommitment storage commitment = _commitments[commitId];
        if (commitment.voter == address(0)) revert CommitmentNotFound();
        if (commitment.revealed) revert AlreadyRevealed();
        if (commitment.voter != msg.sender) revert CommitmentNotFound();

        // Verify hash: keccak256(abi.encodePacked(voter, voteId, choice, secret))
        bytes32 expectedHash = keccak256(
            abi.encodePacked(msg.sender, voteId, choice, secret)
        );

        if (expectedHash != commitment.commitHash) revert InvalidReveal();

        commitment.revealed = true;
        commitment.choice = choice;
        vote.revealCount++;

        // Apply weight to vote tally
        if (choice == VoteChoice.FOR) {
            vote.forWeight += commitment.weight;
        } else if (choice == VoteChoice.AGAINST) {
            vote.againstWeight += commitment.weight;
        } else if (choice == VoteChoice.ABSTAIN) {
            vote.abstainWeight += commitment.weight;
        }

        // Refund deposit on valid reveal
        (bool success, ) = msg.sender.call{value: commitment.deposit}("");
        require(success, "Refund failed");

        emit VoteRevealed(voteId, commitId, msg.sender, choice, commitment.weight);
    }

    /// @inheritdoc ICommitRevealGovernance
    function tallyVotes(uint256 voteId) external {
        GovernanceVote storage vote = _votes[voteId];
        if (vote.proposer == address(0)) revert VoteNotFound();

        _updatePhase(voteId);
        if (vote.phase != VotePhase.TALLY) revert WrongPhase();
        if (vote.executed) revert AlreadyExecuted();

        uint256 totalWeight = vote.forWeight + vote.againstWeight + vote.abstainWeight;
        bool passed = totalWeight >= quorumWeight && vote.forWeight > vote.againstWeight;

        if (passed) {
            vote.phase = VotePhase.EXECUTED;
        }

        emit VoteTallied(voteId, vote.forWeight, vote.againstWeight, vote.abstainWeight, passed);
    }

    /// @inheritdoc ICommitRevealGovernance
    function slashUnrevealed(uint256 voteId, bytes32 commitId) external nonReentrant {
        GovernanceVote storage vote = _votes[voteId];
        if (vote.proposer == address(0)) revert VoteNotFound();

        // Can only slash after reveal phase ends
        _updatePhase(voteId);
        if (vote.phase != VotePhase.TALLY && vote.phase != VotePhase.EXECUTED) {
            revert WrongPhase();
        }

        VoteCommitment storage commitment = _commitments[commitId];
        if (commitment.voter == address(0)) revert CommitmentNotFound();
        if (commitment.revealed) revert NotSlashable();
        if (commitment.deposit == 0) revert NotSlashable();

        // Mark as revealed to prevent double-slash
        commitment.revealed = true;
        commitment.choice = VoteChoice.NONE;

        uint256 slashAmount = (commitment.deposit * slashRateBps) / 10000;
        uint256 refundAmount = commitment.deposit - slashAmount;
        commitment.deposit = 0;

        vote.slashedDeposits += slashAmount;

        // Send slash to treasury
        if (slashAmount > 0 && treasury != address(0)) {
            (bool success, ) = treasury.call{value: slashAmount}("");
            require(success, "Treasury transfer failed");
        }

        // Refund remainder to voter
        if (refundAmount > 0) {
            (bool success, ) = commitment.voter.call{value: refundAmount}("");
            require(success, "Refund failed");
        }

        emit UnrevealedSlashed(voteId, commitId, commitment.voter, slashAmount);
    }

    /// @inheritdoc ICommitRevealGovernance
    function executeVote(uint256 voteId) external {
        GovernanceVote storage vote = _votes[voteId];
        if (vote.proposer == address(0)) revert VoteNotFound();
        if (vote.phase != VotePhase.EXECUTED) revert VoteNotPassed();
        if (vote.executed) revert AlreadyExecuted();
        if (!resolvers[msg.sender] && msg.sender != owner()) revert NotResolver();

        vote.executed = true;

        emit VoteExecuted(voteId);
    }

    // ============ Internal Functions ============

    function _generateCommitId(address voter, uint256 voteId) internal returns (bytes32) {
        return keccak256(abi.encodePacked(voter, voteId, block.timestamp, ++_commitNonce));
    }

    function _updatePhase(uint256 voteId) internal {
        GovernanceVote storage vote = _votes[voteId];
        if (vote.phase == VotePhase.EXECUTED) return;

        if (block.timestamp >= vote.revealEnd) {
            if (vote.phase != VotePhase.TALLY && vote.phase != VotePhase.EXECUTED) {
                vote.phase = VotePhase.TALLY;
            }
        } else if (block.timestamp >= vote.commitEnd) {
            if (vote.phase == VotePhase.COMMIT) {
                vote.phase = VotePhase.REVEAL;
            }
        }
    }

    // ============ View Functions ============

    /// @inheritdoc ICommitRevealGovernance
    function getVote(uint256 voteId) external view returns (GovernanceVote memory) {
        return _votes[voteId];
    }

    /// @inheritdoc ICommitRevealGovernance
    function getCommitment(bytes32 commitId) external view returns (VoteCommitment memory) {
        return _commitments[commitId];
    }

    // ============ Admin Functions ============

    function setMinDeposit(uint256 _minDeposit) external onlyOwner {
        uint256 old = minDeposit;
        minDeposit = _minDeposit;
        emit MinDepositUpdated(old, _minDeposit);
    }

    function setSlashRate(uint256 _slashRateBps) external onlyOwner {
        require(_slashRateBps <= MAX_SLASH_RATE_BPS, "Rate too high");
        uint256 old = slashRateBps;
        slashRateBps = _slashRateBps;
        emit SlashRateUpdated(old, _slashRateBps);
    }

    function setQuorum(uint256 _quorumWeight) external onlyOwner {
        uint256 old = quorumWeight;
        quorumWeight = _quorumWeight;
        emit QuorumUpdated(old, _quorumWeight);
    }

    function setDefaultDurations(
        uint256 _commitDuration,
        uint256 _revealDuration
    ) external onlyOwner {
        require(_commitDuration > 0 && _revealDuration > 0, "Zero duration");
        defaultCommitDuration = _commitDuration;
        defaultRevealDuration = _revealDuration;
        emit DefaultDurationsUpdated(_commitDuration, _revealDuration);
    }

    function setMinProposerTier(uint8 _tier) external onlyOwner {
        minProposerTier = _tier;
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    function addResolver(address resolver) external onlyOwner {
        resolvers[resolver] = true;
        emit ResolverAdded(resolver);
    }

    function removeResolver(address resolver) external onlyOwner {
        resolvers[resolver] = false;
        emit ResolverRemoved(resolver);
    }

    receive() external payable {}
}
