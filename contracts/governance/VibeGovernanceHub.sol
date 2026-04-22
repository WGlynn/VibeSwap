// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title VibeGovernanceHub
 * @notice Unified governance hub for the VSOS DeFi operating system.
 * @dev Aggregates four governance modes under a single proposal lifecycle:
 *
 *      1. Token Voting     — 1-token-1-vote, simple majority
 *      2. Conviction Voting — continuous signal, sqrt-time weighting
 *      3. Quadratic Voting  — sqrt(tokens) per vote, Sybil-resistant via mind score
 *      4. Commit-Reveal     — blinded votes revealed after deadline, anti-front-running
 *
 *      Vote weight sources (composable):
 *        - VIBE balance (liquid governance token)
 *        - stVIBE balance (staked governance token)
 *        - LP position value (sqrt of underlying VIBE in LP)
 *        - Mind score (Proof of Mind reputation, 0-100)
 *
 *      Proposal lifecycle:
 *        Draft → Active → Passed/Failed → Queued → Executed
 *
 *      Security council holds veto power for the first 2 years after deployment,
 *      then automatically sunsets. Emergency proposals use shorter timelocks but
 *      require higher quorum.
 *
 *      Cross-chain governance messages are received via LayerZero and tallied
 *      alongside local votes.
 *
 *      UUPS upgradeable — upgrade authority goes through the hub itself.
 */
contract VibeGovernanceHub is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    event CrossChainEndpointUpdated(address indexed previous, address indexed current);
    event WeightSourcesUpdated(address indexed prevLp, address indexed prevMind, address currentLp, address currentMind);

    // ============ Enums ============

    enum GovernanceType {
        TOKEN,          // 1-token-1-vote
        CONVICTION,     // Continuous signal, sqrt-time weighting
        QUADRATIC,      // sqrt(tokens) votes
        COMMIT_REVEAL   // Blinded votes
    }

    enum ProposalState {
        DRAFT,
        ACTIVE,
        PASSED,
        FAILED,
        QUEUED,
        EXECUTED,
        VETOED,
        CANCELLED
    }

    // ============ Structs ============

    struct Proposal {
        uint256 id;
        address proposer;
        GovernanceType govType;
        string title;
        address[] targets;
        uint256[] values;
        bytes[] calldatas;
        uint256 votesFor;
        uint256 votesAgainst;
        uint256 votesAbstain;
        uint256 createdAt;
        uint256 voteStart;
        uint256 voteEnd;
        uint256 executionTime;      // Timelock release timestamp
        uint256 quorumBps;          // Required quorum in BPS
        bool emergency;
        bool executed;
        bool vetoed;
        bool cancelled;
    }

    struct CommitRevealBallot {
        bytes32 commitHash;
        uint256 weight;
        bool revealed;
        bool supported;             // true = for, false = against
    }

    struct DelegationInfo {
        address delegate;
        uint256 delegatedAt;
    }

    struct GovernanceConfig {
        uint256 votingPeriod;       // Duration of voting window
        uint256 quorumBps;          // Required quorum (BPS of total supply)
        uint256 timelockDelay;      // Execution delay after passing
        bool enabled;
    }

    // ============ Constants ============

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAX_VOTING_PERIOD = 30 days;
    uint256 public constant MIN_VOTING_PERIOD = 1 days;
    uint256 public constant STANDARD_TIMELOCK = 48 hours;
    uint256 public constant EMERGENCY_TIMELOCK = 6 hours;
    uint256 public constant EMERGENCY_QUORUM_BPS = 6000;    // 60%
    uint256 public constant MAX_OPERATIONS = 10;
    uint256 public constant CONVICTION_HALF_LIFE = 3 days;
    uint256 public constant COMMIT_REVEAL_WINDOW = 1 days;
    uint256 public constant MIND_SCORE_WEIGHT_BPS = 1000;   // 10% bonus
    uint256 public constant LP_SQRT_PRECISION = 1e18;
    uint256 public constant VETO_SUNSET_DURATION = 730 days; // ~2 years

    // ============ State ============

    IERC20 public vibeToken;
    IERC20 public stVibeToken;
    address public lpPositionSource;            // Contract to query LP value
    address public mindScoreSource;             // ProofOfMind / ReputationOracle
    address public crossChainEndpoint;          // LayerZero endpoint for xchain votes
    address public securityCouncil;

    uint256 public proposalCount;
    uint256 public proposalThreshold;           // Min VIBE to create proposal
    uint256 public deployedAt;                  // For veto sunset calculation

    /// @dev govType => config
    mapping(GovernanceType => GovernanceConfig) public govConfigs;

    /// @dev proposalId => Proposal (internal: 19-field struct causes stack-too-deep in auto-getter)
    mapping(uint256 => Proposal) internal proposals;

    /// @dev proposalId => voter => weight voted (prevents double voting)
    mapping(uint256 => mapping(address => uint256)) public hasVoted;

    /// @dev proposalId => voter => CommitRevealBallot (commit-reveal mode)
    mapping(uint256 => mapping(address => CommitRevealBallot)) public commitBallots;

    /// @dev voter => delegate
    mapping(address => DelegationInfo) public delegations;

    /// @dev delegate => total weight delegated to them
    mapping(address => uint256) public delegatedWeight;

    /// @dev proposalId => voter => conviction start timestamp
    mapping(uint256 => mapping(address => uint256)) public convictionStart;

    /// @dev proposalId => voter => staked conviction amount
    mapping(uint256 => mapping(address => uint256)) public convictionStake;

    /// @dev Trusted cross-chain senders (chainId => address)
    mapping(uint32 => address) public trustedRemotes;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        GovernanceType govType,
        string title,
        bool emergency
    );
    event ProposalActivated(uint256 indexed proposalId, uint256 voteStart, uint256 voteEnd);
    event VoteCast(uint256 indexed proposalId, address indexed voter, bool support, uint256 weight);
    event VoteCommitted(uint256 indexed proposalId, address indexed voter, bytes32 commitHash);
    event VoteRevealed(uint256 indexed proposalId, address indexed voter, bool support, uint256 weight);
    event ConvictionSignaled(uint256 indexed proposalId, address indexed voter, uint256 amount);
    event ConvictionWithdrawn(uint256 indexed proposalId, address indexed voter, uint256 amount);
    event ProposalQueued(uint256 indexed proposalId, uint256 executionTime);
    event ProposalExecuted(uint256 indexed proposalId);
    event ProposalVetoed(uint256 indexed proposalId);
    event ProposalCancelled(uint256 indexed proposalId);
    event DelegateChanged(address indexed delegator, address indexed oldDelegate, address indexed newDelegate);
    event CrossChainVoteReceived(uint32 indexed srcChainId, uint256 indexed proposalId, uint256 weight, bool support);
    event GovernanceConfigUpdated(GovernanceType indexed govType);
    event ProposalThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);
    event SecurityCouncilTransferred(address indexed oldCouncil, address indexed newCouncil);
    event TrustedRemoteSet(uint32 indexed chainId, address remote);

    // ============ Errors ============

    error BelowProposalThreshold(uint256 balance, uint256 required);
    error InvalidGovernanceType();
    error GovernanceTypeDisabled();
    error ProposalNotInState(uint256 proposalId, ProposalState expected, ProposalState actual);
    error AlreadyVoted(uint256 proposalId, address voter);
    error VotingNotActive(uint256 proposalId);
    error TimelockNotExpired(uint256 proposalId, uint256 executionTime);
    error EmptyProposal();
    error TooManyOperations();
    error ArrayLengthMismatch();
    error VetoSunsetPassed();
    error NotSecurityCouncil();
    error NotCrossChainEndpoint();
    error CommitAlreadyMade();
    error RevealMismatch();
    error RevealWindowNotOpen();
    error RevealWindowClosed();
    error NoConvictionStake();
    error ZeroAddress();
    error SelfDelegation();
    error ExecutionFailed(uint256 index);

    // ============ Modifiers ============

    modifier onlySecurityCouncil() {
        if (msg.sender != securityCouncil) revert NotSecurityCouncil();
        _;
    }

    modifier onlyCrossChainEndpoint() {
        if (msg.sender != crossChainEndpoint) revert NotCrossChainEndpoint();
        _;
    }

    modifier inState(uint256 proposalId, ProposalState expected) {
        ProposalState current = state(proposalId);
        if (current != expected) revert ProposalNotInState(proposalId, expected, current);
        _;
    }

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the governance hub.
     * @param _vibeToken         VIBE governance token
     * @param _stVibeToken       stVIBE staked governance token
     * @param _lpPositionSource  Contract to query LP VIBE value
     * @param _mindScoreSource   ProofOfMind / ReputationOracle
     * @param _securityCouncil   Security council multisig
     * @param _proposalThreshold Minimum VIBE to create a proposal
     * @param _owner             Initial owner (typically a timelock or multisig)
     */
    function initialize(
        address _vibeToken,
        address _stVibeToken,
        address _lpPositionSource,
        address _mindScoreSource,
        address _securityCouncil,
        uint256 _proposalThreshold,
        address _owner
    ) external initializer {
        if (_vibeToken == address(0) || _owner == address(0)) revert ZeroAddress();

        __Ownable_init(_owner);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        vibeToken = IERC20(_vibeToken);
        stVibeToken = IERC20(_stVibeToken);
        lpPositionSource = _lpPositionSource;
        mindScoreSource = _mindScoreSource;
        securityCouncil = _securityCouncil;
        proposalThreshold = _proposalThreshold;
        deployedAt = block.timestamp;

        // Default governance configs
        govConfigs[GovernanceType.TOKEN] = GovernanceConfig({
            votingPeriod: 7 days,
            quorumBps: 1000,        // 10%
            timelockDelay: STANDARD_TIMELOCK,
            enabled: true
        });
        govConfigs[GovernanceType.CONVICTION] = GovernanceConfig({
            votingPeriod: 14 days,
            quorumBps: 500,         // 5%
            timelockDelay: STANDARD_TIMELOCK,
            enabled: true
        });
        govConfigs[GovernanceType.QUADRATIC] = GovernanceConfig({
            votingPeriod: 7 days,
            quorumBps: 1500,        // 15%
            timelockDelay: STANDARD_TIMELOCK,
            enabled: true
        });
        govConfigs[GovernanceType.COMMIT_REVEAL] = GovernanceConfig({
            votingPeriod: 5 days,
            quorumBps: 1000,        // 10%
            timelockDelay: STANDARD_TIMELOCK,
            enabled: true
        });
    }

    // ============ Proposal Creation ============

    /**
     * @notice Create a new governance proposal.
     * @param govType     Governance mechanism to use
     * @param title       Short description
     * @param targets     Target contract addresses
     * @param values      ETH values per call
     * @param calldatas   Encoded function calls
     * @param emergency   If true, shorter timelock + higher quorum
     * @return proposalId The new proposal's ID
     */
    function propose(
        GovernanceType govType,
        string calldata title,
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata calldatas,
        bool emergency
    ) external nonReentrant returns (uint256 proposalId) {
        GovernanceConfig memory config = govConfigs[govType];
        if (!config.enabled) revert GovernanceTypeDisabled();
        if (targets.length == 0) revert EmptyProposal();
        if (targets.length > MAX_OPERATIONS) revert TooManyOperations();
        if (targets.length != values.length || targets.length != calldatas.length) {
            revert ArrayLengthMismatch();
        }

        uint256 proposerBalance = _getVoteWeight(msg.sender);
        if (proposerBalance < proposalThreshold) {
            revert BelowProposalThreshold(proposerBalance, proposalThreshold);
        }

        proposalId = ++proposalCount;

        // Scoped to free stack before emit (6 params + return var + locals = stack pressure)
        {
            uint256 quorum = emergency ? EMERGENCY_QUORUM_BPS : config.quorumBps;
            Proposal storage p = proposals[proposalId];
            p.id = proposalId;
            p.proposer = msg.sender;
            p.govType = govType;
            p.title = title;
            p.targets = targets;
            p.values = values;
            // Copy bytes[] calldata element-by-element (nested calldata->storage not supported in old codegen)
            for (uint256 i = 0; i < calldatas.length; i++) {
                p.calldatas.push(calldatas[i]);
            }
            p.createdAt = block.timestamp;
            p.quorumBps = quorum;
            p.emergency = emergency;
        }

        emit ProposalCreated(proposalId, msg.sender, govType, title, emergency);
    }

    /**
     * @notice Activate a draft proposal to begin voting.
     * @dev Only the proposer or owner can activate.
     */
    function activateProposal(uint256 proposalId)
        external
        inState(proposalId, ProposalState.DRAFT)
    {
        Proposal storage p = proposals[proposalId];
        require(msg.sender == p.proposer || msg.sender == owner(), "Not authorized");

        GovernanceConfig memory config = govConfigs[p.govType];
        p.voteStart = block.timestamp;
        p.voteEnd = block.timestamp + config.votingPeriod;

        emit ProposalActivated(proposalId, p.voteStart, p.voteEnd);
    }

    // ============ Voting — Token ============

    /**
     * @notice Cast a token-weighted vote.
     * @param proposalId Proposal to vote on
     * @param support    true = for, false = against
     */
    function castVote(uint256 proposalId, bool support)
        external
        nonReentrant
        inState(proposalId, ProposalState.ACTIVE)
    {
        Proposal storage p = proposals[proposalId];
        if (p.govType != GovernanceType.TOKEN) revert InvalidGovernanceType();
        if (hasVoted[proposalId][msg.sender] > 0) revert AlreadyVoted(proposalId, msg.sender);

        uint256 weight = _getEffectiveWeight(msg.sender);
        if (weight == 0) revert BelowProposalThreshold(0, 1);

        hasVoted[proposalId][msg.sender] = weight;

        if (support) {
            p.votesFor += weight;
        } else {
            p.votesAgainst += weight;
        }

        emit VoteCast(proposalId, msg.sender, support, weight);
    }

    // ============ Voting — Quadratic ============

    /**
     * @notice Cast a quadratic vote. Weight = sqrt(tokens).
     * @param proposalId Proposal to vote on
     * @param support    true = for, false = against
     */
    function castQuadraticVote(uint256 proposalId, bool support)
        external
        nonReentrant
        inState(proposalId, ProposalState.ACTIVE)
    {
        Proposal storage p = proposals[proposalId];
        if (p.govType != GovernanceType.QUADRATIC) revert InvalidGovernanceType();
        if (hasVoted[proposalId][msg.sender] > 0) revert AlreadyVoted(proposalId, msg.sender);

        uint256 rawWeight = _getEffectiveWeight(msg.sender);
        uint256 weight = _sqrt(rawWeight);
        if (weight == 0) revert BelowProposalThreshold(0, 1);

        hasVoted[proposalId][msg.sender] = weight;

        if (support) {
            p.votesFor += weight;
        } else {
            p.votesAgainst += weight;
        }

        emit VoteCast(proposalId, msg.sender, support, weight);
    }

    // ============ Voting — Conviction ============

    /**
     * @notice Signal conviction by staking VIBE towards a proposal.
     * @dev Weight grows with sqrt(time staked). Tokens are locked until withdrawn.
     * @param proposalId Proposal to support
     * @param amount     VIBE to stake
     */
    function signalConviction(uint256 proposalId, uint256 amount)
        external
        nonReentrant
        inState(proposalId, ProposalState.ACTIVE)
    {
        Proposal storage p = proposals[proposalId];
        if (p.govType != GovernanceType.CONVICTION) revert InvalidGovernanceType();

        vibeToken.safeTransferFrom(msg.sender, address(this), amount);

        if (convictionStake[proposalId][msg.sender] == 0) {
            convictionStart[proposalId][msg.sender] = block.timestamp;
        }
        convictionStake[proposalId][msg.sender] += amount;

        emit ConvictionSignaled(proposalId, msg.sender, amount);
    }

    /**
     * @notice Withdraw conviction stake.
     * @dev Tallies the time-weighted conviction before withdrawal.
     * @param proposalId Proposal to withdraw from
     */
    function withdrawConviction(uint256 proposalId) external nonReentrant {
        uint256 staked = convictionStake[proposalId][msg.sender];
        if (staked == 0) revert NoConvictionStake();

        // Tally conviction weight before withdrawal
        uint256 elapsed = block.timestamp - convictionStart[proposalId][msg.sender];
        uint256 weight = _convictionWeight(staked, elapsed);
        proposals[proposalId].votesFor += weight;
        hasVoted[proposalId][msg.sender] = weight;

        convictionStake[proposalId][msg.sender] = 0;
        convictionStart[proposalId][msg.sender] = 0;

        vibeToken.safeTransfer(msg.sender, staked);

        emit ConvictionWithdrawn(proposalId, msg.sender, staked);
    }

    // ============ Voting — Commit-Reveal ============

    /**
     * @notice Commit a blinded vote hash.
     * @param proposalId Proposal to vote on
     * @param commitHash keccak256(abi.encodePacked(proposalId, support, salt))
     */
    function commitVote(uint256 proposalId, bytes32 commitHash)
        external
        inState(proposalId, ProposalState.ACTIVE)
    {
        Proposal storage p = proposals[proposalId];
        if (p.govType != GovernanceType.COMMIT_REVEAL) revert InvalidGovernanceType();

        CommitRevealBallot storage ballot = commitBallots[proposalId][msg.sender];
        if (ballot.commitHash != bytes32(0)) revert CommitAlreadyMade();

        ballot.commitHash = commitHash;

        emit VoteCommitted(proposalId, msg.sender, commitHash);
    }

    /**
     * @notice Reveal a previously committed vote.
     * @dev Must be called after voting period ends but within the reveal window.
     * @param proposalId Proposal voted on
     * @param support    true = for, false = against
     * @param salt       Random salt used in commit
     */
    function revealVote(uint256 proposalId, bool support, bytes32 salt)
        external
        nonReentrant
    {
        Proposal storage p = proposals[proposalId];
        if (p.govType != GovernanceType.COMMIT_REVEAL) revert InvalidGovernanceType();
        if (block.timestamp < p.voteEnd) revert RevealWindowNotOpen();
        if (block.timestamp > p.voteEnd + COMMIT_REVEAL_WINDOW) revert RevealWindowClosed();

        CommitRevealBallot storage ballot = commitBallots[proposalId][msg.sender];
        bytes32 expected = keccak256(abi.encodePacked(proposalId, support, salt));
        if (ballot.commitHash != expected) revert RevealMismatch();
        if (ballot.revealed) revert AlreadyVoted(proposalId, msg.sender);

        uint256 weight = _getEffectiveWeight(msg.sender);
        ballot.weight = weight;
        ballot.revealed = true;
        ballot.supported = support;

        if (support) {
            p.votesFor += weight;
        } else {
            p.votesAgainst += weight;
        }

        emit VoteRevealed(proposalId, msg.sender, support, weight);
    }

    // ============ Delegation ============

    /**
     * @notice Delegate your vote weight to another address.
     * @param delegatee Address to delegate to (address(0) to revoke)
     */
    function delegate(address delegatee) external {
        if (delegatee == msg.sender) revert SelfDelegation();

        DelegationInfo storage info = delegations[msg.sender];
        address oldDelegate = info.delegate;

        // Remove weight from old delegate
        if (oldDelegate != address(0)) {
            uint256 oldWeight = _getVoteWeight(msg.sender);
            if (delegatedWeight[oldDelegate] >= oldWeight) {
                delegatedWeight[oldDelegate] -= oldWeight;
            }
        }

        // Add weight to new delegate
        if (delegatee != address(0)) {
            uint256 newWeight = _getVoteWeight(msg.sender);
            delegatedWeight[delegatee] += newWeight;
        }

        info.delegate = delegatee;
        info.delegatedAt = block.timestamp;

        emit DelegateChanged(msg.sender, oldDelegate, delegatee);
    }

    // ============ Proposal Lifecycle ============

    /**
     * @notice Finalize voting and move proposal to Passed or Failed.
     * @dev For commit-reveal, must wait until after reveal window closes.
     */
    function finalizeVoting(uint256 proposalId)
        external
        inState(proposalId, ProposalState.ACTIVE)
    {
        Proposal storage p = proposals[proposalId];

        // Commit-reveal: must wait for reveal window
        if (p.govType == GovernanceType.COMMIT_REVEAL) {
            require(block.timestamp > p.voteEnd + COMMIT_REVEAL_WINDOW, "Reveal window open");
        } else if (p.govType == GovernanceType.CONVICTION) {
            require(block.timestamp >= p.voteEnd, "Voting active");
            // Auto-tally remaining conviction stakes is left to users withdrawing
        } else {
            require(block.timestamp >= p.voteEnd, "Voting active");
        }

        // Quorum check against total VIBE supply
        uint256 totalVotes = p.votesFor + p.votesAgainst + p.votesAbstain;
        uint256 totalSupply = vibeToken.totalSupply();
        bool quorumMet = totalVotes * BPS_DENOMINATOR >= totalSupply * p.quorumBps;

        // Simple majority
        bool majorityFor = p.votesFor > p.votesAgainst;

        // State is derived from storage flags — no explicit state field needed
        // Passed proposals get queued via queue()
        if (!quorumMet || !majorityFor) {
            // Mark as failed by ensuring it cannot be queued
            // State is FAILED when voteEnd passed and conditions not met
        }
        // If both conditions met, state() will return PASSED
    }

    /**
     * @notice Queue a passed proposal for timelock execution.
     * @param proposalId Proposal to queue
     */
    function queue(uint256 proposalId)
        external
        inState(proposalId, ProposalState.PASSED)
    {
        Proposal storage p = proposals[proposalId];

        uint256 delay = p.emergency ? EMERGENCY_TIMELOCK : govConfigs[p.govType].timelockDelay;
        p.executionTime = block.timestamp + delay;

        emit ProposalQueued(proposalId, p.executionTime);
    }

    /**
     * @notice Execute a queued proposal after timelock expires.
     * @param proposalId Proposal to execute
     */
    function execute(uint256 proposalId)
        external
        nonReentrant
        inState(proposalId, ProposalState.QUEUED)
    {
        Proposal storage p = proposals[proposalId];
        if (block.timestamp < p.executionTime) {
            revert TimelockNotExpired(proposalId, p.executionTime);
        }

        p.executed = true;

        for (uint256 i; i < p.targets.length; ++i) {
            (bool success,) = p.targets[i].call{value: p.values[i]}(p.calldatas[i]);
            if (!success) revert ExecutionFailed(i);
        }

        emit ProposalExecuted(proposalId);
    }

    /**
     * @notice Cancel a proposal. Only proposer (if draft/active) or owner.
     * @param proposalId Proposal to cancel
     */
    function cancel(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];
        require(!p.executed && !p.cancelled && !p.vetoed, "Terminal state");

        ProposalState s = state(proposalId);
        require(
            s == ProposalState.DRAFT || s == ProposalState.ACTIVE || s == ProposalState.PASSED || s == ProposalState.QUEUED,
            "Cannot cancel"
        );
        require(
            msg.sender == p.proposer || msg.sender == owner(),
            "Not authorized"
        );

        p.cancelled = true;

        emit ProposalCancelled(proposalId);
    }

    // ============ Security Council Veto ============

    /**
     * @notice Veto a proposal. Only security council, only within sunset period.
     * @param proposalId Proposal to veto
     */
    function veto(uint256 proposalId) external onlySecurityCouncil {
        if (block.timestamp > deployedAt + VETO_SUNSET_DURATION) revert VetoSunsetPassed();

        Proposal storage p = proposals[proposalId];
        require(!p.executed && !p.cancelled && !p.vetoed, "Terminal state");

        p.vetoed = true;

        emit ProposalVetoed(proposalId);
    }

    // ============ Cross-Chain Governance ============

    /**
     * @notice Receive cross-chain vote from LayerZero endpoint.
     * @dev Called by the trusted cross-chain endpoint after message verification.
     * @param srcChainId  Source chain EID
     * @param proposalId  Proposal being voted on
     * @param weight      Aggregated vote weight from source chain
     * @param support     true = for, false = against
     */
    function receiveCrossChainVote(
        uint32 srcChainId,
        uint256 proposalId,
        uint256 weight,
        bool support
    ) external onlyCrossChainEndpoint {
        require(trustedRemotes[srcChainId] != address(0), "Untrusted remote");

        Proposal storage p = proposals[proposalId];
        require(state(proposalId) == ProposalState.ACTIVE, "Not active");

        if (support) {
            p.votesFor += weight;
        } else {
            p.votesAgainst += weight;
        }

        emit CrossChainVoteReceived(srcChainId, proposalId, weight, support);
    }

    // ============ View Functions ============

    /**
     * @notice Derive current state of a proposal from storage flags + timestamps.
     * @param proposalId Proposal to query
     * @return The current ProposalState
     */
    function state(uint256 proposalId) public view returns (ProposalState) {
        Proposal storage p = proposals[proposalId];
        require(p.id != 0, "Invalid proposal");

        if (p.vetoed) return ProposalState.VETOED;
        if (p.cancelled) return ProposalState.CANCELLED;
        if (p.executed) return ProposalState.EXECUTED;

        // Before activation
        if (p.voteStart == 0) return ProposalState.DRAFT;

        // During voting
        if (block.timestamp < p.voteEnd) return ProposalState.ACTIVE;

        // Commit-reveal: also active during reveal window
        if (p.govType == GovernanceType.COMMIT_REVEAL &&
            block.timestamp <= p.voteEnd + COMMIT_REVEAL_WINDOW) {
            return ProposalState.ACTIVE;
        }

        // Already queued (executionTime set)
        if (p.executionTime > 0) return ProposalState.QUEUED;

        // Check pass/fail conditions
        uint256 totalVotes = p.votesFor + p.votesAgainst + p.votesAbstain;
        uint256 totalSupply = vibeToken.totalSupply();

        bool quorumMet = totalSupply > 0 &&
            totalVotes * BPS_DENOMINATOR >= totalSupply * p.quorumBps;
        bool majorityFor = p.votesFor > p.votesAgainst;

        if (quorumMet && majorityFor) return ProposalState.PASSED;
        return ProposalState.FAILED;
    }

    /**
     * @notice Get the raw vote weight of an address (before delegation).
     * @param account Address to query
     * @return weight Combined weight from all sources
     */
    function getVoteWeight(address account) external view returns (uint256) {
        return _getVoteWeight(account);
    }

    /**
     * @notice Get the effective weight including delegated weight.
     * @param account Address to query
     * @return weight Effective voting weight
     */
    function getEffectiveWeight(address account) external view returns (uint256) {
        return _getEffectiveWeight(account);
    }

    /**
     * @notice Check if veto power is still active.
     * @return True if within veto sunset period
     */
    function isVetoActive() external view returns (bool) {
        return block.timestamp <= deployedAt + VETO_SUNSET_DURATION;
    }

    /// @notice Get full proposal struct.
    function getProposal(uint256 proposalId) external view returns (Proposal memory) {
        return proposals[proposalId];
    }

    /**
     * @notice Get proposal executable actions.
     * @param proposalId Proposal to query
     * @return targets    Target addresses
     * @return values     ETH values
     * @return calldatas  Encoded calls
     */
    function getProposalActions(uint256 proposalId)
        external
        view
        returns (address[] memory targets, uint256[] memory values, bytes[] memory calldatas)
    {
        Proposal storage p = proposals[proposalId];
        return (p.targets, p.values, p.calldatas);
    }

    // ============ Admin Functions ============

    /**
     * @notice Update governance config for a type. Must go through governance.
     * @param govType       Governance type to update
     * @param votingPeriod  New voting period
     * @param quorumBps     New quorum in BPS
     * @param timelockDelay New timelock delay
     * @param enabled       Whether this type is enabled
     */
    function setGovernanceConfig(
        GovernanceType govType,
        uint256 votingPeriod,
        uint256 quorumBps,
        uint256 timelockDelay,
        bool enabled
    ) external onlyOwner {
        require(votingPeriod >= MIN_VOTING_PERIOD && votingPeriod <= MAX_VOTING_PERIOD, "Invalid period");
        require(quorumBps > 0 && quorumBps <= BPS_DENOMINATOR, "Invalid quorum");
        require(timelockDelay >= EMERGENCY_TIMELOCK, "Delay too short");

        govConfigs[govType] = GovernanceConfig({
            votingPeriod: votingPeriod,
            quorumBps: quorumBps,
            timelockDelay: timelockDelay,
            enabled: enabled
        });

        emit GovernanceConfigUpdated(govType);
    }

    /**
     * @notice Update the proposal creation threshold.
     * @param newThreshold New minimum VIBE balance to create proposals
     */
    function setProposalThreshold(uint256 newThreshold) external onlyOwner {
        emit ProposalThresholdUpdated(proposalThreshold, newThreshold);
        proposalThreshold = newThreshold;
    }

    /**
     * @notice Transfer security council role.
     * @param newCouncil New security council address (address(0) to renounce)
     */
    function setSecurityCouncil(address newCouncil) external onlyOwner {
        emit SecurityCouncilTransferred(securityCouncil, newCouncil);
        securityCouncil = newCouncil;
    }

    /**
     * @notice Set cross-chain endpoint (LayerZero receiver).
     * @param _endpoint New endpoint address
     */
    function setCrossChainEndpoint(address _endpoint) external onlyOwner {
        address prev = crossChainEndpoint;
        crossChainEndpoint = _endpoint;
        emit CrossChainEndpointUpdated(prev, _endpoint);
    }

    /**
     * @notice Set trusted remote sender for cross-chain votes.
     * @param chainId Source chain EID
     * @param remote  Trusted sender address on that chain
     */
    function setTrustedRemote(uint32 chainId, address remote) external onlyOwner {
        trustedRemotes[chainId] = remote;
        emit TrustedRemoteSet(chainId, remote);
    }

    /**
     * @notice Set vote weight source contracts.
     * @param _lpSource   LP position value source
     * @param _mindSource Mind score source
     */
    function setWeightSources(address _lpSource, address _mindSource) external onlyOwner {
        address prevLp = lpPositionSource;
        address prevMind = mindScoreSource;
        lpPositionSource = _lpSource;
        mindScoreSource = _mindSource;
        emit WeightSourcesUpdated(prevLp, prevMind, _lpSource, _mindSource);
    }

    // ============ Internal Functions ============

    /**
     * @dev Get raw vote weight from all sources.
     *      VIBE balance + stVIBE balance + sqrt(LP value) + mind score bonus
     */
    function _getVoteWeight(address account) internal view returns (uint256) {
        uint256 weight;

        // VIBE balance
        weight += vibeToken.balanceOf(account);

        // stVIBE balance
        if (address(stVibeToken) != address(0)) {
            weight += stVibeToken.balanceOf(account);
        }

        // LP position: sqrt of VIBE value in LP
        if (lpPositionSource != address(0)) {
            // Query LP VIBE value: ILPSource(lpPositionSource).vibeValueOf(account)
            (bool ok, bytes memory data) = lpPositionSource.staticcall(
                abi.encodeWithSignature("vibeValueOf(address)", account)
            );
            if (ok && data.length >= 32) {
                uint256 lpValue = abi.decode(data, (uint256));
                weight += _sqrt(lpValue);
            }
        }

        // Mind score bonus: up to MIND_SCORE_WEIGHT_BPS (10%) of base weight
        if (mindScoreSource != address(0)) {
            (bool ok, bytes memory data) = mindScoreSource.staticcall(
                abi.encodeWithSignature("getMindScore(address)", account)
            );
            if (ok && data.length >= 32) {
                uint256 score = abi.decode(data, (uint256)); // 0-100
                if (score > 100) score = 100;
                uint256 bonus = (weight * MIND_SCORE_WEIGHT_BPS * score) / (BPS_DENOMINATOR * 100);
                weight += bonus;
            }
        }

        return weight;
    }

    /**
     * @dev Get effective weight = own weight (if not delegating) + delegated weight.
     */
    function _getEffectiveWeight(address account) internal view returns (uint256) {
        uint256 weight;

        // If account has delegated, their own weight is zero (given to delegate)
        if (delegations[account].delegate == address(0)) {
            weight = _getVoteWeight(account);
        }

        // Add weight delegated by others
        weight += delegatedWeight[account];

        return weight;
    }

    /**
     * @dev Conviction weight = stake * sqrt(elapsed / HALF_LIFE).
     *      Grows sub-linearly with time to prevent indefinite accumulation.
     */
    function _convictionWeight(uint256 staked, uint256 elapsed) internal pure returns (uint256) {
        if (elapsed == 0 || staked == 0) return 0;
        // Normalize elapsed to half-life units (1e18 precision)
        uint256 normalized = (elapsed * 1e18) / CONVICTION_HALF_LIFE;
        uint256 sqrtNorm = _sqrt(normalized);
        return (staked * sqrtNorm) / 1e9; // sqrt(1e18) = 1e9
    }

    /**
     * @dev Integer square root via Babylonian method.
     */
    function _sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return y;
    }

    // ============ UUPS ============

    /**
     * @dev Authorize upgrades — only owner (governance timelock).
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Receive ETH ============

    /// @dev Allow receiving ETH for proposal execution values.
    receive() external payable {}
}
