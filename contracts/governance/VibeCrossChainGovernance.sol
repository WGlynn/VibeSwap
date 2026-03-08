// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title VibeCrossChainGovernance
 * @notice VSOS cross-chain governance module — proposals and voting that span multiple chains
 * @dev Validators relay aggregated vote tallies from remote chains. Quorum is calculated
 *      across total voting power on all participating chains. Execution occurs on the
 *      home chain after the deadline passes with quorum met and majority in favor.
 *
 *      Flow:
 *      1. Proposer calls createProposal() specifying participating chainIds
 *      2. Each chain runs its own local voting (off-chain or via paired contracts)
 *      3. Validators relay aggregated results via submitChainVotes()
 *      4. After deadline, anyone can call executeProposal() if quorum + majority met
 */
contract VibeCrossChainGovernance is
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    // ============ Structs ============

    struct CrossChainProposal {
        uint256 proposalId;
        address proposer;
        bytes32 descriptionHash;
        uint256[] chainIds;
        uint256 quorum;
        uint256 deadline;
        bool executed;
        bool passed;
    }

    struct ChainVoteAggregate {
        uint256 votesFor;
        uint256 votesAgainst;
        bool submitted;
    }

    // ============ Constants ============

    /// @notice Minimum voting period (1 day)
    uint256 public constant MIN_VOTING_PERIOD = 1 days;

    /// @notice Maximum voting period (30 days)
    uint256 public constant MAX_VOTING_PERIOD = 30 days;

    /// @notice Maximum number of chains per proposal
    uint256 public constant MAX_CHAINS = 20;

    // ============ State ============

    /// @notice Total proposals created
    uint256 public proposalCount;

    /// @notice Proposal ID => CrossChainProposal
    mapping(uint256 => CrossChainProposal) private _proposals;

    /// @notice Proposal ID => chain ID => ChainVoteAggregate
    mapping(uint256 => mapping(uint256 => ChainVoteAggregate)) private _chainVotes;

    /// @notice Authorized vote relay validators
    mapping(address => bool) public validators;

    /// @notice Number of active validators
    uint256 public validatorCount;

    /// @notice Minimum validators required to attest a chain vote submission
    uint256 public minValidatorAttestations;

    /// @notice Proposal ID => chain ID => validator => attested
    mapping(uint256 => mapping(uint256 => mapping(address => bool))) public validatorAttestations;

    /// @notice Proposal ID => chain ID => attestation count
    mapping(uint256 => mapping(uint256 => uint256)) public attestationCounts;

    // ============ Events ============

    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        bytes32 descriptionHash,
        uint256[] chainIds,
        uint256 quorum,
        uint256 deadline
    );

    event ChainVotesSubmitted(
        uint256 indexed proposalId,
        uint256 indexed chainId,
        uint256 votesFor,
        uint256 votesAgainst,
        address indexed validator
    );

    event ChainVotesFinalized(
        uint256 indexed proposalId,
        uint256 indexed chainId,
        uint256 votesFor,
        uint256 votesAgainst
    );

    event ProposalExecuted(uint256 indexed proposalId, bool passed);

    event ValidatorAdded(address indexed validator);
    event ValidatorRemoved(address indexed validator);
    event MinAttestationsUpdated(uint256 oldMin, uint256 newMin);

    // ============ Errors ============

    error InvalidVotingPeriod();
    error TooManyChains();
    error NoChains();
    error ZeroQuorum();
    error ProposalNotFound();
    error ProposalAlreadyExecuted();
    error VotingNotEnded();
    error ChainNotInProposal();
    error VotesAlreadyFinalized();
    error NotValidator();
    error AlreadyValidator();
    error AlreadyAttested();
    error InsufficientAttestations();
    error ValidatorRequired();
    error InvalidMinAttestations();

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, uint256 minAttestations_) external initializer {
        __Ownable_init(owner_);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
        minValidatorAttestations = minAttestations_ > 0 ? minAttestations_ : 1;
    }

    // ============ Proposal Management ============

    /**
     * @notice Create a cross-chain governance proposal
     * @param descriptionHash Keccak256 hash of the proposal description (stored off-chain)
     * @param chainIds Array of chain IDs that participate in voting
     * @param quorum Minimum total votes (for + against) across all chains to reach quorum
     * @param votingPeriod Duration in seconds for the voting window
     * @return proposalId The ID of the newly created proposal
     */
    function createProposal(
        bytes32 descriptionHash,
        uint256[] calldata chainIds,
        uint256 quorum,
        uint256 votingPeriod
    ) external returns (uint256 proposalId) {
        if (votingPeriod < MIN_VOTING_PERIOD || votingPeriod > MAX_VOTING_PERIOD)
            revert InvalidVotingPeriod();
        if (chainIds.length == 0) revert NoChains();
        if (chainIds.length > MAX_CHAINS) revert TooManyChains();
        if (quorum == 0) revert ZeroQuorum();

        proposalId = ++proposalCount;

        CrossChainProposal storage p = _proposals[proposalId];
        p.proposalId = proposalId;
        p.proposer = msg.sender;
        p.descriptionHash = descriptionHash;
        p.chainIds = chainIds;
        p.quorum = quorum;
        p.deadline = block.timestamp + votingPeriod;

        emit ProposalCreated(proposalId, msg.sender, descriptionHash, chainIds, quorum, p.deadline);
    }

    // ============ Vote Relay ============

    /**
     * @notice Validator attests aggregated votes from a remote chain
     * @dev Once minValidatorAttestations validators submit matching votes, the tally is finalized.
     *      All attestors must submit identical vote counts — the first submission sets the values
     *      and subsequent attestors confirm them.
     * @param proposalId The proposal being voted on
     * @param chainId The source chain ID
     * @param votesFor Total votes in favor on that chain
     * @param votesAgainst Total votes against on that chain
     */
    function submitChainVotes(
        uint256 proposalId,
        uint256 chainId,
        uint256 votesFor,
        uint256 votesAgainst
    ) external nonReentrant {
        if (!validators[msg.sender]) revert NotValidator();
        if (proposalId == 0 || proposalId > proposalCount) revert ProposalNotFound();

        CrossChainProposal storage p = _proposals[proposalId];
        if (p.executed) revert ProposalAlreadyExecuted();
        if (!_isChainInProposal(p, chainId)) revert ChainNotInProposal();

        ChainVoteAggregate storage agg = _chainVotes[proposalId][chainId];
        if (agg.submitted) revert VotesAlreadyFinalized();
        if (validatorAttestations[proposalId][chainId][msg.sender]) revert AlreadyAttested();

        // First attestor sets the values; subsequent must match
        if (attestationCounts[proposalId][chainId] == 0) {
            agg.votesFor = votesFor;
            agg.votesAgainst = votesAgainst;
        } else {
            require(
                agg.votesFor == votesFor && agg.votesAgainst == votesAgainst,
                "Vote mismatch with prior attestation"
            );
        }

        validatorAttestations[proposalId][chainId][msg.sender] = true;
        attestationCounts[proposalId][chainId]++;

        emit ChainVotesSubmitted(proposalId, chainId, votesFor, votesAgainst, msg.sender);

        // Finalize once threshold met
        if (attestationCounts[proposalId][chainId] >= minValidatorAttestations) {
            agg.submitted = true;
            emit ChainVotesFinalized(proposalId, chainId, votesFor, votesAgainst);
        }
    }

    // ============ Execution ============

    /**
     * @notice Execute a proposal after its voting deadline
     * @dev Checks quorum across all chains and determines pass/fail by simple majority
     * @param proposalId The proposal to execute
     */
    function executeProposal(uint256 proposalId) external nonReentrant {
        if (proposalId == 0 || proposalId > proposalCount) revert ProposalNotFound();

        CrossChainProposal storage p = _proposals[proposalId];
        if (p.executed) revert ProposalAlreadyExecuted();
        if (block.timestamp < p.deadline) revert VotingNotEnded();

        uint256 totalFor;
        uint256 totalAgainst;

        for (uint256 i = 0; i < p.chainIds.length; i++) {
            ChainVoteAggregate storage agg = _chainVotes[proposalId][p.chainIds[i]];
            totalFor += agg.votesFor;
            totalAgainst += agg.votesAgainst;
        }

        bool quorumMet = (totalFor + totalAgainst) >= p.quorum;
        bool majorityFor = totalFor > totalAgainst;

        p.executed = true;
        p.passed = quorumMet && majorityFor;

        emit ProposalExecuted(proposalId, p.passed);
    }

    // ============ Validator Management ============

    function addValidator(address validator) external onlyOwner {
        if (validator == address(0)) revert ValidatorRequired();
        if (validators[validator]) revert AlreadyValidator();

        validators[validator] = true;
        validatorCount++;

        emit ValidatorAdded(validator);
    }

    function removeValidator(address validator) external onlyOwner {
        if (!validators[validator]) revert NotValidator();

        validators[validator] = false;
        validatorCount--;

        emit ValidatorRemoved(validator);
    }

    function setMinValidatorAttestations(uint256 newMin) external onlyOwner {
        if (newMin == 0) revert InvalidMinAttestations();

        uint256 oldMin = minValidatorAttestations;
        minValidatorAttestations = newMin;

        emit MinAttestationsUpdated(oldMin, newMin);
    }

    // ============ Views ============

    function getProposal(uint256 proposalId)
        external
        view
        returns (CrossChainProposal memory)
    {
        if (proposalId == 0 || proposalId > proposalCount) revert ProposalNotFound();
        return _proposals[proposalId];
    }

    function getChainVotes(uint256 proposalId, uint256 chainId)
        external
        view
        returns (uint256 votesFor, uint256 votesAgainst, bool finalized)
    {
        ChainVoteAggregate storage agg = _chainVotes[proposalId][chainId];
        return (agg.votesFor, agg.votesAgainst, agg.submitted);
    }

    function hasQuorum(uint256 proposalId) external view returns (bool) {
        if (proposalId == 0 || proposalId > proposalCount) revert ProposalNotFound();

        CrossChainProposal storage p = _proposals[proposalId];
        uint256 totalVotes;

        for (uint256 i = 0; i < p.chainIds.length; i++) {
            ChainVoteAggregate storage agg = _chainVotes[proposalId][p.chainIds[i]];
            totalVotes += agg.votesFor + agg.votesAgainst;
        }

        return totalVotes >= p.quorum;
    }

    function getProposalCount() external view returns (uint256) {
        return proposalCount;
    }

    // ============ Internal ============

    function _isChainInProposal(
        CrossChainProposal storage p,
        uint256 chainId
    ) internal view returns (bool) {
        for (uint256 i = 0; i < p.chainIds.length; i++) {
            if (p.chainIds[i] == chainId) return true;
        }
        return false;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
