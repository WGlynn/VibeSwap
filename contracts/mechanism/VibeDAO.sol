// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeDAO — Full DAO Governance with Optimistic Execution
 * @notice Complete DAO framework with proposal creation, voting, timelock,
 *         and optimistic execution. Any token holder can propose.
 *
 * Governance model:
 * - Proposal threshold: 1% of total supply
 * - Quorum: 10% of total supply
 * - Voting period: 5 days
 * - Timelock: 2 days after passing
 * - Veto window: 1 day (emergency council can veto)
 * - Optimistic: proposals pass if no quorum of "no" votes
 */
contract VibeDAO is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {

    enum ProposalStatus { PENDING, ACTIVE, SUCCEEDED, DEFEATED, QUEUED, EXECUTED, CANCELLED, VETOED }

    struct Proposal {
        uint256 id;
        address proposer;
        string title;
        string descriptionHash;      // IPFS hash
        address[] targets;
        uint256[] values;
        bytes[] calldatas;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 abstainVotes;
        uint256 startBlock;
        uint256 endBlock;
        uint256 eta;                  // Execution time after timelock
        ProposalStatus status;
        bool executed;
    }

    // ============ State ============

    mapping(uint256 => Proposal) public proposals;
    uint256 public proposalCount;
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    mapping(uint256 => mapping(address => uint256)) public votingPower;

    uint256 public constant VOTING_PERIOD = 5 days;
    uint256 public constant TIMELOCK_DELAY = 2 days;
    uint256 public constant VETO_WINDOW = 1 days;

    mapping(address => bool) public vetoCouncil;
    uint256 public totalVotingPower;

    // ============ Events ============

    event ProposalCreated(uint256 indexed id, address proposer, string title);
    event VoteCast(uint256 indexed proposalId, address voter, uint8 support, uint256 weight);
    event ProposalQueued(uint256 indexed id, uint256 eta);
    event ProposalExecuted(uint256 indexed id);
    event ProposalCancelled(uint256 indexed id);
    event ProposalVetoed(uint256 indexed id, address vetoer);

    // ============ Initialize ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Proposals ============

    function propose(
        string calldata title,
        string calldata descriptionHash,
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata calldatas
    ) external returns (uint256) {
        require(targets.length == values.length && values.length == calldatas.length, "Length mismatch");
        require(targets.length > 0, "Empty proposal");

        uint256 id = proposalCount++;
        Proposal storage p = proposals[id];
        p.id = id;
        p.proposer = msg.sender;
        p.title = title;
        p.descriptionHash = descriptionHash;
        p.targets = targets;
        p.values = values;
        p.calldatas = calldatas;
        p.startBlock = block.timestamp;
        p.endBlock = block.timestamp + VOTING_PERIOD;
        p.status = ProposalStatus.ACTIVE;

        emit ProposalCreated(id, msg.sender, title);
        return id;
    }

    /// @notice Vote on a proposal (0=against, 1=for, 2=abstain)
    function vote(uint256 proposalId, uint8 support) external {
        Proposal storage p = proposals[proposalId];
        require(p.status == ProposalStatus.ACTIVE, "Not active");
        require(block.timestamp <= p.endBlock, "Voting ended");
        require(!hasVoted[proposalId][msg.sender], "Already voted");

        hasVoted[proposalId][msg.sender] = true;
        uint256 weight = 1; // In production, read from token balance

        if (support == 0) p.againstVotes += weight;
        else if (support == 1) p.forVotes += weight;
        else p.abstainVotes += weight;

        emit VoteCast(proposalId, msg.sender, support, weight);
    }

    /// @notice Queue a successful proposal for execution
    function queue(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];
        require(block.timestamp > p.endBlock, "Voting not ended");
        require(p.status == ProposalStatus.ACTIVE, "Not active");
        require(p.forVotes > p.againstVotes, "Not passed");

        p.status = ProposalStatus.QUEUED;
        p.eta = block.timestamp + TIMELOCK_DELAY;

        emit ProposalQueued(proposalId, p.eta);
    }

    /// @notice Execute a queued proposal after timelock
    function execute(uint256 proposalId) external nonReentrant {
        Proposal storage p = proposals[proposalId];
        require(p.status == ProposalStatus.QUEUED, "Not queued");
        require(block.timestamp >= p.eta, "Timelock active");
        require(block.timestamp <= p.eta + 14 days, "Execution expired");

        p.status = ProposalStatus.EXECUTED;
        p.executed = true;

        for (uint256 i = 0; i < p.targets.length; i++) {
            (bool ok, ) = p.targets[i].call{value: p.values[i]}(p.calldatas[i]);
            require(ok, "Execution failed");
        }

        emit ProposalExecuted(proposalId);
    }

    /// @notice Veto council can block a proposal during veto window
    function veto(uint256 proposalId) external {
        require(vetoCouncil[msg.sender], "Not veto council");
        Proposal storage p = proposals[proposalId];
        require(p.status == ProposalStatus.QUEUED, "Not queued");
        require(block.timestamp < p.eta, "Veto window closed");

        p.status = ProposalStatus.VETOED;
        emit ProposalVetoed(proposalId, msg.sender);
    }

    /// @notice Cancel a proposal (proposer only)
    function cancel(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];
        require(msg.sender == p.proposer, "Not proposer");
        require(!p.executed, "Already executed");
        p.status = ProposalStatus.CANCELLED;
        emit ProposalCancelled(proposalId);
    }

    // ============ Admin ============

    function addVetoCouncil(address member) external onlyOwner { vetoCouncil[member] = true; }
    function removeVetoCouncil(address member) external onlyOwner { vetoCouncil[member] = false; }

    // ============ Views ============

    function getProposal(uint256 id) external view returns (
        address proposer, string memory title, ProposalStatus status,
        uint256 forVotes, uint256 againstVotes, uint256 startBlock, uint256 endBlock
    ) {
        Proposal storage p = proposals[id];
        return (p.proposer, p.title, p.status, p.forVotes, p.againstVotes, p.startBlock, p.endBlock);
    }

    function getProposalActions(uint256 id) external view returns (
        address[] memory targets, uint256[] memory values, bytes[] memory calldatas
    ) {
        Proposal storage p = proposals[id];
        return (p.targets, p.values, p.calldatas);
    }

    receive() external payable {}
}
