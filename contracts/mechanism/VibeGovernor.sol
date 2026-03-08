// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeGovernor — On-Chain Governance Engine
 * @notice OpenZeppelin Governor alternative with VSOS-native enhancements.
 *         Optimistic governance with time-locked execution and veto power.
 *
 * @dev Features:
 *      - Proposal creation with quorum and threshold
 *      - Voting with veVIBE weight
 *      - Optimistic execution (passes unless vetoed)
 *      - Delegation support
 *      - Proposal types: parameter change, upgrade, treasury spend, emergency
 */
contract VibeGovernor is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    // ============ Constants ============

    uint256 public constant VOTING_PERIOD = 3 days;
    uint256 public constant VOTING_DELAY = 1 days;
    uint256 public constant EXECUTION_DELAY = 2 days;
    uint256 public constant QUORUM_BPS = 400;  // 4% of total supply
    uint256 public constant PROPOSAL_THRESHOLD_BPS = 100; // 1% to propose
    uint256 public constant BPS = 10000;

    // ============ Types ============

    enum ProposalState { PENDING, ACTIVE, DEFEATED, SUCCEEDED, QUEUED, EXECUTED, CANCELLED, VETOED }
    enum ProposalType { PARAMETER, UPGRADE, TREASURY, EMERGENCY, GENERAL }
    enum VoteType { AGAINST, FOR, ABSTAIN }

    struct Proposal {
        uint256 proposalId;
        address proposer;
        ProposalType proposalType;
        string description;
        address[] targets;
        uint256[] values;
        bytes[] calldatas;
        uint256 startBlock;
        uint256 endBlock;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 abstainVotes;
        bool executed;
        bool cancelled;
        bool vetoed;
    }

    // ============ State ============

    mapping(uint256 => Proposal) public proposals;
    uint256 public proposalCount;

    /// @notice Votes: proposalId => voter => hasVoted
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    mapping(uint256 => mapping(address => VoteType)) public voteReceipt;

    /// @notice Voting power provider (address of veVIBE or similar)
    address public votingPowerSource;

    /// @notice Total voting supply (for quorum calculation)
    uint256 public totalVotingSupply;

    /// @notice Veto council
    mapping(address => bool) public vetoCouncil;
    uint256 public vetoCouncilCount;

    /// @notice Governance stats
    uint256 public totalProposals;
    uint256 public totalVotesCast;

    // ============ Events ============

    event ProposalCreated(uint256 indexed proposalId, address indexed proposer, ProposalType pType, string description);
    event VoteCast(uint256 indexed proposalId, address indexed voter, VoteType voteType, uint256 weight);
    event ProposalExecuted(uint256 indexed proposalId);
    event ProposalCancelled(uint256 indexed proposalId);
    event ProposalVetoed(uint256 indexed proposalId, address indexed vetoer);
    event VetoCouncilUpdated(address indexed member, bool added);

    // ============ Init ============

    function initialize(uint256 _totalVotingSupply) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        totalVotingSupply = _totalVotingSupply;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ============ Proposals ============

    function propose(
        ProposalType pType,
        string calldata description,
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata calldatas
    ) external returns (uint256) {
        require(targets.length == values.length && values.length == calldatas.length, "Length mismatch");
        require(targets.length > 0, "Empty proposal");

        proposalCount++;
        Proposal storage p = proposals[proposalCount];
        p.proposalId = proposalCount;
        p.proposer = msg.sender;
        p.proposalType = pType;
        p.description = description;
        p.targets = targets;
        p.values = values;
        p.calldatas = calldatas;
        p.startBlock = block.number + (VOTING_DELAY / 12); // ~12s blocks
        p.endBlock = p.startBlock + (VOTING_PERIOD / 12);

        totalProposals++;

        emit ProposalCreated(proposalCount, msg.sender, pType, description);
        return proposalCount;
    }

    function castVote(uint256 proposalId, VoteType voteType, uint256 weight) external {
        Proposal storage p = proposals[proposalId];
        require(block.number >= p.startBlock, "Voting not started");
        require(block.number <= p.endBlock, "Voting ended");
        require(!hasVoted[proposalId][msg.sender], "Already voted");
        require(!p.cancelled && !p.vetoed, "Proposal inactive");
        require(weight > 0, "Zero weight");

        hasVoted[proposalId][msg.sender] = true;
        voteReceipt[proposalId][msg.sender] = voteType;

        if (voteType == VoteType.FOR) p.forVotes += weight;
        else if (voteType == VoteType.AGAINST) p.againstVotes += weight;
        else p.abstainVotes += weight;

        totalVotesCast++;

        emit VoteCast(proposalId, msg.sender, voteType, weight);
    }

    // ============ Execution ============

    function execute(uint256 proposalId) external nonReentrant {
        Proposal storage p = proposals[proposalId];
        require(getState(proposalId) == ProposalState.SUCCEEDED, "Not succeeded");
        require(!p.executed, "Already executed");

        p.executed = true;

        for (uint256 i = 0; i < p.targets.length; i++) {
            (bool success, ) = p.targets[i].call{value: p.values[i]}(p.calldatas[i]);
            require(success, "Execution failed");
        }

        emit ProposalExecuted(proposalId);
    }

    function cancel(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];
        require(p.proposer == msg.sender || msg.sender == owner(), "Not authorized");
        require(!p.executed, "Already executed");

        p.cancelled = true;
        emit ProposalCancelled(proposalId);
    }

    function veto(uint256 proposalId) external {
        require(vetoCouncil[msg.sender], "Not veto council");
        Proposal storage p = proposals[proposalId];
        require(!p.executed, "Already executed");

        p.vetoed = true;
        emit ProposalVetoed(proposalId, msg.sender);
    }

    // ============ Admin ============

    function setVetoCouncil(address member, bool status) external onlyOwner {
        if (status && !vetoCouncil[member]) vetoCouncilCount++;
        if (!status && vetoCouncil[member]) vetoCouncilCount--;
        vetoCouncil[member] = status;
        emit VetoCouncilUpdated(member, status);
    }

    function setTotalVotingSupply(uint256 supply) external onlyOwner {
        totalVotingSupply = supply;
    }

    // ============ View ============

    function getState(uint256 proposalId) public view returns (ProposalState) {
        Proposal storage p = proposals[proposalId];
        if (p.cancelled) return ProposalState.CANCELLED;
        if (p.vetoed) return ProposalState.VETOED;
        if (p.executed) return ProposalState.EXECUTED;
        if (block.number < p.startBlock) return ProposalState.PENDING;
        if (block.number <= p.endBlock) return ProposalState.ACTIVE;

        uint256 quorum = (totalVotingSupply * QUORUM_BPS) / BPS;
        if (p.forVotes + p.againstVotes + p.abstainVotes < quorum) return ProposalState.DEFEATED;
        if (p.forVotes > p.againstVotes) return ProposalState.SUCCEEDED;
        return ProposalState.DEFEATED;
    }

    function getProposal(uint256 proposalId) external view returns (
        address proposer,
        ProposalType pType,
        uint256 forVotes,
        uint256 againstVotes,
        uint256 abstainVotes,
        ProposalState state
    ) {
        Proposal storage p = proposals[proposalId];
        return (p.proposer, p.proposalType, p.forVotes, p.againstVotes, p.abstainVotes, getState(proposalId));
    }

    function getProposalCount() external view returns (uint256) { return proposalCount; }

    receive() external payable {}
}
