// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title FederatedConsensus
 * @notice Off-chain authority consensus for clawback decisions
 * @dev Authorized entities (government, lawyers, courts, SEC) vote on clawback
 *      proposals. A configurable threshold must be met before execution.
 *      Time-locked grace period gives the accused wallet time to respond.
 */
contract FederatedConsensus is OwnableUpgradeable, UUPSUpgradeable {

    // ============ Enums ============

    enum AuthorityRole {
        NONE,
        GOVERNMENT,
        LEGAL,
        COURT,
        REGULATOR
    }

    enum ProposalStatus {
        PENDING,
        APPROVED,
        REJECTED,
        EXECUTED,
        EXPIRED
    }

    // ============ Structs ============

    struct Authority {
        AuthorityRole role;
        bool active;
        string jurisdiction;
        uint64 addedAt;
    }

    struct Proposal {
        bytes32 caseId;
        address proposer;
        address targetWallet;
        uint256 amount;
        address token;
        string reason;
        ProposalStatus status;
        uint64 createdAt;
        uint64 gracePeriodEnd;
        uint256 approvalCount;
        uint256 rejectionCount;
    }

    // ============ State ============

    /// @notice Registered authorities
    mapping(address => Authority) public authorities;

    /// @notice Total active authority count
    uint256 public authorityCount;

    /// @notice Approval threshold (e.g., 3 out of 5)
    uint256 public approvalThreshold;

    /// @notice Proposals by ID
    mapping(bytes32 => Proposal) public proposals;

    /// @notice Vote tracking: proposalId => authority => voted
    mapping(bytes32 => mapping(address => bool)) public hasVoted;

    /// @notice Vote tracking: proposalId => authority => approved
    mapping(bytes32 => mapping(address => bool)) public voteValue;

    /// @notice Grace period before approved proposals can execute
    uint256 public gracePeriod;

    /// @notice Proposal expiry (how long a proposal stays open for voting)
    uint256 public proposalExpiry;

    /// @notice Authorized executor (ClawbackRegistry)
    address public executor;

    /// @notice Proposal counter
    uint256 public proposalCount;

    // ============ Events ============

    event AuthorityAdded(address indexed authority, AuthorityRole role, string jurisdiction);
    event AuthorityRemoved(address indexed authority);
    event ProposalCreated(bytes32 indexed proposalId, bytes32 indexed caseId, address indexed target, uint256 amount);
    event VoteCast(bytes32 indexed proposalId, address indexed authority, bool approved);
    event ProposalApproved(bytes32 indexed proposalId, uint256 approvalCount);
    event ProposalRejected(bytes32 indexed proposalId, uint256 rejectionCount);
    event ProposalExecuted(bytes32 indexed proposalId);
    event ProposalExpired(bytes32 indexed proposalId);
    event ThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);
    event ExecutorUpdated(address indexed oldExecutor, address indexed newExecutor);

    // ============ Errors ============

    error NotAuthority();
    error NotActiveAuthority();
    error AlreadyVoted();
    error ProposalNotPending();
    error ProposalNotApproved();
    error GracePeriodActive();
    error ProposalExpiredError();
    error NotExecutor();
    error InvalidThreshold();
    error AuthorityAlreadyExists();

    // ============ Modifiers ============

    modifier onlyActiveAuthority() {
        if (!authorities[msg.sender].active) revert NotActiveAuthority();
        _;
    }

    modifier onlyExecutor() {
        if (msg.sender != executor && msg.sender != owner()) revert NotExecutor();
        _;
    }

    // ============ Initialization ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _owner,
        uint256 _approvalThreshold,
        uint256 _gracePeriod
    ) external initializer {
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();

        approvalThreshold = _approvalThreshold;
        gracePeriod = _gracePeriod;
        proposalExpiry = 30 days;
    }

    // ============ Authority Management ============

    /**
     * @notice Add an authorized entity
     * @param authority Address of the authority
     * @param role Role type (GOVERNMENT, LEGAL, COURT, REGULATOR)
     * @param jurisdiction Jurisdiction string (e.g., "US", "EU")
     */
    function addAuthority(
        address authority,
        AuthorityRole role,
        string calldata jurisdiction
    ) external onlyOwner {
        require(authority != address(0), "Zero address");
        require(role != AuthorityRole.NONE, "Invalid role");
        if (authorities[authority].active) revert AuthorityAlreadyExists();

        authorities[authority] = Authority({
            role: role,
            active: true,
            jurisdiction: jurisdiction,
            addedAt: uint64(block.timestamp)
        });

        authorityCount++;
        emit AuthorityAdded(authority, role, jurisdiction);
    }

    /**
     * @notice Remove an authority
     * @param authority Address to remove
     */
    function removeAuthority(address authority) external onlyOwner {
        require(authorities[authority].active, "Not active");

        authorities[authority].active = false;
        authorityCount--;

        emit AuthorityRemoved(authority);
    }

    // ============ Proposal Functions ============

    /**
     * @notice Create a clawback proposal
     * @param caseId Associated clawback case ID
     * @param targetWallet Wallet to claw back from
     * @param amount Amount to claw back
     * @param token Token address (address(0) for ETH)
     * @param reason Human-readable reason
     * @return proposalId Unique proposal ID
     */
    function createProposal(
        bytes32 caseId,
        address targetWallet,
        uint256 amount,
        address token,
        string calldata reason
    ) external onlyActiveAuthority returns (bytes32 proposalId) {
        proposalCount++;
        proposalId = keccak256(abi.encodePacked(caseId, targetWallet, proposalCount, block.timestamp));

        proposals[proposalId] = Proposal({
            caseId: caseId,
            proposer: msg.sender,
            targetWallet: targetWallet,
            amount: amount,
            token: token,
            reason: reason,
            status: ProposalStatus.PENDING,
            createdAt: uint64(block.timestamp),
            gracePeriodEnd: 0,
            approvalCount: 0,
            rejectionCount: 0
        });

        emit ProposalCreated(proposalId, caseId, targetWallet, amount);
    }

    /**
     * @notice Cast a vote on a proposal
     * @param proposalId Proposal to vote on
     * @param approve Whether to approve
     */
    function vote(bytes32 proposalId, bool approve) external onlyActiveAuthority {
        Proposal storage proposal = proposals[proposalId];
        if (proposal.status != ProposalStatus.PENDING) revert ProposalNotPending();
        if (hasVoted[proposalId][msg.sender]) revert AlreadyVoted();

        // Check expiry
        if (block.timestamp > proposal.createdAt + proposalExpiry) {
            proposal.status = ProposalStatus.EXPIRED;
            emit ProposalExpired(proposalId);
            revert ProposalExpiredError();
        }

        hasVoted[proposalId][msg.sender] = true;
        voteValue[proposalId][msg.sender] = approve;

        if (approve) {
            proposal.approvalCount++;
        } else {
            proposal.rejectionCount++;
        }

        emit VoteCast(proposalId, msg.sender, approve);

        // Check if threshold reached
        if (proposal.approvalCount >= approvalThreshold) {
            proposal.status = ProposalStatus.APPROVED;
            proposal.gracePeriodEnd = uint64(block.timestamp + gracePeriod);
            emit ProposalApproved(proposalId, proposal.approvalCount);
        }

        // Check if rejection is mathematically certain
        uint256 remainingVotes = authorityCount - proposal.approvalCount - proposal.rejectionCount;
        if (proposal.approvalCount + remainingVotes < approvalThreshold) {
            proposal.status = ProposalStatus.REJECTED;
            emit ProposalRejected(proposalId, proposal.rejectionCount);
        }
    }

    // ============ Execution ============

    /**
     * @notice Check if a proposal is ready for execution
     * @param proposalId Proposal ID
     * @return ready Whether the proposal can be executed
     */
    function isExecutable(bytes32 proposalId) external view returns (bool) {
        Proposal storage proposal = proposals[proposalId];
        return proposal.status == ProposalStatus.APPROVED &&
               block.timestamp >= proposal.gracePeriodEnd;
    }

    /**
     * @notice Mark proposal as executed (called by ClawbackRegistry)
     * @param proposalId Proposal ID
     */
    function markExecuted(bytes32 proposalId) external onlyExecutor {
        Proposal storage proposal = proposals[proposalId];
        if (proposal.status != ProposalStatus.APPROVED) revert ProposalNotApproved();
        if (block.timestamp < proposal.gracePeriodEnd) revert GracePeriodActive();

        proposal.status = ProposalStatus.EXECUTED;
        emit ProposalExecuted(proposalId);
    }

    // ============ View Functions ============

    /**
     * @notice Get proposal details
     */
    function getProposal(bytes32 proposalId) external view returns (Proposal memory) {
        return proposals[proposalId];
    }

    /**
     * @notice Check if an address is an active authority
     */
    function isActiveAuthority(address addr) external view returns (bool) {
        return authorities[addr].active;
    }

    // ============ Admin Functions ============

    /**
     * @notice Update approval threshold
     * @param newThreshold New threshold value
     */
    function setThreshold(uint256 newThreshold) external onlyOwner {
        if (newThreshold == 0 || newThreshold > authorityCount) revert InvalidThreshold();
        uint256 oldThreshold = approvalThreshold;
        approvalThreshold = newThreshold;
        emit ThresholdUpdated(oldThreshold, newThreshold);
    }

    /**
     * @notice Set the executor address (ClawbackRegistry)
     * @param _executor New executor address
     */
    function setExecutor(address _executor) external onlyOwner {
        emit ExecutorUpdated(executor, _executor);
        executor = _executor;
    }

    /**
     * @notice Update grace period
     * @param _gracePeriod New grace period in seconds
     */
    function setGracePeriod(uint256 _gracePeriod) external onlyOwner {
        gracePeriod = _gracePeriod;
    }

    /**
     * @notice Update proposal expiry
     * @param _proposalExpiry New expiry in seconds
     */
    function setProposalExpiry(uint256 _proposalExpiry) external onlyOwner {
        proposalExpiry = _proposalExpiry;
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
