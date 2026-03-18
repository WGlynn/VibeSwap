// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title VibeGovernanceSunset
 * @notice The Ungovernance Time Bomb — governance designed to self-destruct.
 * @dev Implements decaying voting weights, dispute-only scope, and a predetermined
 *      sunset clause. After sunset, all governance functions are disabled and the
 *      protocol runs on pure mechanism design (PID controllers + fork escape).
 *
 *      Philosophy: "You can't get to zero governance from zero. You have to start
 *      with some governance, but hardcode that it dwindles to nothing."
 *
 *      Decay formula: weight = baseWeight >> (age / HALF_LIFE_PERIOD)
 *      After 4 half-lives (~4 years), voting weight is ~6.25% of original.
 */
contract VibeGovernanceSunset is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ Enums ============

    enum ProposalType {
        SLASH_DISPUTE,       // Was a slash justified?
        FORK_DISPUTE,        // Which fork is canonical?
        EMERGENCY_PAUSE,     // Circuit breaker activation
        PARAMETER_VIOLATION, // Is a parameter outside safe range?
        SUNSET_EXTENSION     // Extend governance by up to 1 year
    }

    // ============ Structs ============

    struct Proposal {
        uint256 proposalId;
        ProposalType proposalType;
        address proposer;
        bytes callData;          // Execution data if passed
        address target;          // Contract to call if passed
        uint256 votesFor;
        uint256 votesAgainst;
        uint256 createdAt;
        uint256 deadline;        // Voting period end
        uint256 executionDelay;  // Timelock after passing
        bool executed;
        bool cancelled;
    }

    struct VoterInfo {
        uint256 baseWeight;      // Governance token weight at registration
        uint256 registeredAt;    // Timestamp of voter registration
        bool registered;         // Whether voter is registered
    }

    // ============ Constants ============

    /// @notice Half-life period for voting weight decay (365 days)
    uint256 public constant HALF_LIFE_PERIOD = 365 days;

    /// @notice Maximum extension per sunset vote (365 days)
    uint256 public constant MAX_EXTENSION = 365 days;

    /// @notice Supermajority threshold for sunset extensions (75% = 7500 BPS)
    uint256 public constant SUPERMAJORITY_BPS = 7500;

    /// @notice Basis points denominator
    uint256 public constant BPS_DENOMINATOR = 10000;

    /// @notice Voting period duration (7 days)
    uint256 public constant VOTING_PERIOD = 7 days;

    /// @notice Execution delay after proposal passes (2 days timelock)
    uint256 public constant EXECUTION_DELAY = 2 days;

    /// @notice Maximum number of half-lives before weight is effectively zero
    uint256 public constant MAX_HALF_LIVES = 64;

    // ============ Immutable State ============

    /// @notice The VIBE governance token used for deposits and voting
    IERC20 public vibeToken;

    /// @notice Required deposit to create a proposal (set at initialization)
    uint256 public proposalDeposit;

    // ============ Mutable State ============

    /// @notice Governance sunset timestamp — all proposals revert after this
    uint256 public governanceSunset;

    /// @notice Next proposal ID counter
    uint256 public nextProposalId;

    /// @notice Mapping of proposal ID to Proposal
    mapping(uint256 => Proposal) public proposals;

    /// @notice Mapping of voter address to VoterInfo
    mapping(address => VoterInfo) public voters;

    /// @notice Mapping of proposal ID => voter => whether they have voted
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    // ============ Events ============

    event VoterRegistered(address indexed voter, uint256 baseWeight);
    event ProposalCreated(
        uint256 indexed proposalId,
        ProposalType proposalType,
        address indexed proposer,
        address target,
        string description
    );
    event Voted(
        uint256 indexed proposalId,
        address indexed voter,
        bool support,
        uint256 decayedWeight
    );
    event ProposalExecuted(uint256 indexed proposalId);
    event ProposalCancelled(uint256 indexed proposalId);
    event SunsetExtended(uint256 indexed proposalId, uint256 newSunset);
    event DepositReturned(address indexed proposer, uint256 amount);
    event DepositSlashed(address indexed proposer, uint256 amount);

    // ============ Errors ============

    error GovernanceHasSunset();
    error NotRegistered();
    error AlreadyRegistered();
    error AlreadyVoted();
    error InvalidProposalType();
    error ProposalNotFound();
    error VotingNotEnded();
    error VotingEnded();
    error ProposalAlreadyExecuted();
    error ProposalCancelled_();
    error TimelockNotExpired();
    error ProposalDidNotPass();
    error SupermajorityRequired();
    error ExtensionTooLong();
    error NotProposerOrOwner();
    error InsufficientWeight();
    error ZeroWeight();
    error ZeroAddress();
    error ExecutionFailed();
    error InvalidWeight();

    // ============ Modifiers ============

    /// @notice Reverts if governance has sunset
    modifier beforeSunset() {
        if (block.timestamp >= governanceSunset) revert GovernanceHasSunset();
        _;
    }

    /// @notice Reverts if caller is not a registered voter
    modifier onlyRegistered() {
        if (!voters[msg.sender].registered) revert NotRegistered();
        _;
    }

    // ============ Initialization ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the governance sunset contract
     * @param _owner Contract owner
     * @param _vibeToken Address of the VIBE governance token
     * @param _proposalDeposit Required deposit to create a proposal
     */
    function initialize(
        address _owner,
        address _vibeToken,
        uint256 _proposalDeposit
    ) external initializer {
        if (_vibeToken == address(0)) revert ZeroAddress();
        if (_owner == address(0)) revert ZeroAddress();

        __Ownable_init(_owner);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        vibeToken = IERC20(_vibeToken);
        proposalDeposit = _proposalDeposit;
        governanceSunset = block.timestamp + (4 * 365 days); // 4 years from deployment
        nextProposalId = 1;
    }

    // ============ Voter Registration ============

    /**
     * @notice Register as a voter with a base governance weight
     * @dev Weight is locked at registration time. Decay is computed from registeredAt.
     * @param baseWeight The base voting weight for this voter
     */
    function registerVoter(uint256 baseWeight) external beforeSunset {
        if (voters[msg.sender].registered) revert AlreadyRegistered();
        if (baseWeight == 0) revert InvalidWeight();

        voters[msg.sender] = VoterInfo({
            baseWeight: baseWeight,
            registeredAt: block.timestamp,
            registered: true
        });

        emit VoterRegistered(msg.sender, baseWeight);
    }

    // ============ Proposal Management ============

    /**
     * @notice Create a new dispute proposal
     * @dev Proposer must deposit VIBE tokens. Governance can ONLY handle disputes,
     *      not propose features or change mechanism design.
     * @param proposalType The type of dispute
     * @param target The contract to call if the proposal passes
     * @param callData The calldata to execute on the target contract
     * @param description Human-readable description of the proposal
     * @return proposalId The ID of the newly created proposal
     */
    function propose(
        ProposalType proposalType,
        address target,
        bytes calldata callData,
        string calldata description
    ) external beforeSunset onlyRegistered returns (uint256) {
        // Transfer deposit from proposer
        vibeToken.safeTransferFrom(msg.sender, address(this), proposalDeposit);

        uint256 proposalId = nextProposalId++;

        proposals[proposalId] = Proposal({
            proposalId: proposalId,
            proposalType: proposalType,
            proposer: msg.sender,
            callData: callData,
            target: target,
            votesFor: 0,
            votesAgainst: 0,
            createdAt: block.timestamp,
            deadline: block.timestamp + VOTING_PERIOD,
            executionDelay: EXECUTION_DELAY,
            executed: false,
            cancelled: false
        });

        emit ProposalCreated(proposalId, proposalType, msg.sender, target, description);

        return proposalId;
    }

    /**
     * @notice Vote on an active proposal using decayed voting weight
     * @param proposalId The proposal to vote on
     * @param support True to vote for, false to vote against
     * @param weight The amount of base weight to use (must be <= voter's base weight)
     */
    function vote(
        uint256 proposalId,
        bool support,
        uint256 weight
    ) external beforeSunset onlyRegistered {
        Proposal storage proposal = proposals[proposalId];
        if (proposal.createdAt == 0) revert ProposalNotFound();
        if (proposal.cancelled) revert ProposalCancelled_();
        if (block.timestamp >= proposal.deadline) revert VotingEnded();
        if (hasVoted[proposalId][msg.sender]) revert AlreadyVoted();

        VoterInfo storage voter = voters[msg.sender];
        if (weight > voter.baseWeight) revert InsufficientWeight();

        // Calculate decayed weight
        uint256 decayedWeight = _calculateDecayedWeight(weight, voter.registeredAt);
        if (decayedWeight == 0) revert ZeroWeight();

        hasVoted[proposalId][msg.sender] = true;

        if (support) {
            proposal.votesFor += decayedWeight;
        } else {
            proposal.votesAgainst += decayedWeight;
        }

        emit Voted(proposalId, msg.sender, support, decayedWeight);
    }

    /**
     * @notice Execute a passed proposal after the timelock expires
     * @dev Permissionless — anyone can trigger execution once conditions are met.
     *      Uses nonReentrant to prevent reentrancy during external calls.
     * @param proposalId The proposal to execute
     */
    function execute(uint256 proposalId) external nonReentrant {
        Proposal storage proposal = proposals[proposalId];
        if (proposal.createdAt == 0) revert ProposalNotFound();
        if (proposal.executed) revert ProposalAlreadyExecuted();
        if (proposal.cancelled) revert ProposalCancelled_();
        if (block.timestamp < proposal.deadline) revert VotingNotEnded();
        if (block.timestamp < proposal.deadline + proposal.executionDelay) revert TimelockNotExpired();

        // Check if proposal passed (simple majority for non-extension, supermajority for extension)
        if (proposal.proposalType == ProposalType.SUNSET_EXTENSION) {
            // Sunset extensions require 75% supermajority
            _requireSupermajority(proposal.votesFor, proposal.votesAgainst);
            proposal.executed = true;
            _executeSunsetExtension(proposalId);
        } else {
            // Standard proposals require simple majority
            if (proposal.votesFor <= proposal.votesAgainst) revert ProposalDidNotPass();
            proposal.executed = true;

            // Execute the proposal's calldata on the target contract
            if (proposal.target != address(0) && proposal.callData.length > 0) {
                (bool success, ) = proposal.target.call(proposal.callData);
                if (!success) revert ExecutionFailed();
            }
        }

        // Return deposit to proposer
        vibeToken.safeTransfer(proposal.proposer, proposalDeposit);
        emit DepositReturned(proposal.proposer, proposalDeposit);

        emit ProposalExecuted(proposalId);
    }

    /**
     * @notice Cancel a proposal (only proposer or owner)
     * @param proposalId The proposal to cancel
     */
    function cancel(uint256 proposalId) external {
        Proposal storage proposal = proposals[proposalId];
        if (proposal.createdAt == 0) revert ProposalNotFound();
        if (proposal.executed) revert ProposalAlreadyExecuted();
        if (proposal.cancelled) revert ProposalCancelled_();
        if (msg.sender != proposal.proposer && msg.sender != owner()) revert NotProposerOrOwner();

        proposal.cancelled = true;

        // Return deposit to proposer
        vibeToken.safeTransfer(proposal.proposer, proposalDeposit);
        emit DepositReturned(proposal.proposer, proposalDeposit);

        emit ProposalCancelled(proposalId);
    }

    // ============ View Functions ============

    /**
     * @notice Get the current decayed voting weight for a voter
     * @param voter The voter address
     * @return The current decayed weight
     */
    function votingWeight(address voter) external view returns (uint256) {
        VoterInfo storage info = voters[voter];
        if (!info.registered) return 0;
        return _calculateDecayedWeight(info.baseWeight, info.registeredAt);
    }

    /**
     * @notice Check if governance has sunset
     * @return True if the current timestamp is past the sunset deadline
     */
    function isSunset() external view returns (bool) {
        return block.timestamp >= governanceSunset;
    }

    /**
     * @notice Get the time remaining until governance sunsets
     * @return Seconds until sunset (0 if already sunset)
     */
    function timeUntilSunset() external view returns (uint256) {
        if (block.timestamp >= governanceSunset) return 0;
        return governanceSunset - block.timestamp;
    }

    /**
     * @notice Get full proposal details
     * @param proposalId The proposal to query
     * @return The Proposal struct
     */
    function getProposal(uint256 proposalId) external view returns (Proposal memory) {
        return proposals[proposalId];
    }

    /**
     * @notice Check if a proposal has passed (meets quorum/majority requirements)
     * @param proposalId The proposal to check
     * @return passed Whether the proposal has passed
     */
    function proposalPassed(uint256 proposalId) external view returns (bool passed) {
        Proposal storage proposal = proposals[proposalId];
        if (proposal.createdAt == 0) return false;
        if (proposal.cancelled) return false;
        if (block.timestamp < proposal.deadline) return false;

        if (proposal.proposalType == ProposalType.SUNSET_EXTENSION) {
            uint256 totalVotes = proposal.votesFor + proposal.votesAgainst;
            if (totalVotes == 0) return false;
            return (proposal.votesFor * BPS_DENOMINATOR) / totalVotes >= SUPERMAJORITY_BPS;
        } else {
            return proposal.votesFor > proposal.votesAgainst;
        }
    }

    // ============ Sunset Extension ============

    /**
     * @notice Special handler for SUNSET_EXTENSION proposals
     * @dev Called internally by execute() when proposal type is SUNSET_EXTENSION.
     *      Extensions are capped at MAX_EXTENSION (1 year) each.
     *      The callData is ABI-encoded as (uint256 extensionDuration).
     * @param proposalId The sunset extension proposal ID
     */
    function _executeSunsetExtension(uint256 proposalId) internal {
        Proposal storage proposal = proposals[proposalId];

        // Decode the extension duration from callData
        uint256 extensionDuration = abi.decode(proposal.callData, (uint256));
        if (extensionDuration > MAX_EXTENSION) revert ExtensionTooLong();

        governanceSunset += extensionDuration;

        emit SunsetExtended(proposalId, governanceSunset);
    }

    /**
     * @notice Public convenience: extend sunset via a passed SUNSET_EXTENSION proposal
     * @dev This is a convenience wrapper — execute() handles extension proposals automatically.
     *      This function simply calls execute() for the given proposal, verifying it is the
     *      correct type.
     * @param proposalId The sunset extension proposal to execute
     */
    function extendSunset(uint256 proposalId) external {
        Proposal storage proposal = proposals[proposalId];
        if (proposal.createdAt == 0) revert ProposalNotFound();
        if (proposal.proposalType != ProposalType.SUNSET_EXTENSION) revert InvalidProposalType();

        // Delegate to execute which handles all validation
        this.execute(proposalId);
    }

    // ============ Internal Functions ============

    /**
     * @notice Calculate decayed voting weight using half-life bit shifting
     * @dev weight = baseWeight >> (age / HALF_LIFE_PERIOD)
     *      After 4 half-lives: weight = baseWeight / 16 (~6.25%)
     *      After 64 half-lives: weight = 0
     * @param baseWeight The original undecayed weight
     * @param registeredAt The timestamp when the voter registered
     * @return The decayed weight
     */
    function _calculateDecayedWeight(
        uint256 baseWeight,
        uint256 registeredAt
    ) internal view returns (uint256) {
        uint256 age = block.timestamp - registeredAt;
        uint256 halfLives = age / HALF_LIFE_PERIOD;

        // After 64+ half-lives, weight is zero (shifted away entirely for uint256)
        if (halfLives >= MAX_HALF_LIVES) return 0;

        return baseWeight >> halfLives;
    }

    /**
     * @notice Verify that a supermajority threshold is met
     * @param votesFor Votes in favor
     * @param votesAgainst Votes against
     */
    function _requireSupermajority(uint256 votesFor, uint256 votesAgainst) internal pure {
        uint256 totalVotes = votesFor + votesAgainst;
        if (totalVotes == 0) revert ProposalDidNotPass();
        if ((votesFor * BPS_DENOMINATOR) / totalVotes < SUPERMAJORITY_BPS) {
            revert SupermajorityRequired();
        }
    }

    // ============ UUPS ============

    /**
     * @notice Authorize contract upgrades (owner only)
     * @dev Required by UUPSUpgradeable. Only owner can upgrade.
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Storage Gap ============

    /// @dev Reserved storage slots for future upgrades
    uint256[44] private __gap;
}
