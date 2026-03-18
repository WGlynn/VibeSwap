// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeAgentGovernance — AI Agent Participation in DAO Governance
 * @notice Enables AI agents to participate in governance with bounded
 *         autonomy. Agents can vote, propose, and delegate — but with
 *         guardrails: human override, vote weight caps, transparency
 *         requirements, and mandatory reasoning disclosure.
 *
 * @dev Architecture:
 *      - Agents register governance profiles with capability bounds
 *      - Vote weight capped at configurable % of total (default 20%)
 *      - Agents must submit reasoning hash with every vote
 *      - Human operators can override agent votes within grace period
 *      - Proposal creation requires minimum reputation threshold
 *      - All agent governance actions are publicly auditable
 */
contract VibeAgentGovernance is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    // ============ Types ============

    enum VoteType { AGAINST, FOR, ABSTAIN }

    struct AgentGovernanceProfile {
        bytes32 agentId;
        address operator;            // Human who can override
        uint256 maxVoteWeightBps;    // Max vote weight in bps
        uint256 minReputationToPropose;
        uint256 currentReputation;
        uint256 proposalsCreated;
        uint256 votescast;
        uint256 overrideCount;       // Times operator overrode
        bool active;
    }

    struct AgentVote {
        bytes32 agentId;
        uint256 proposalId;
        VoteType vote;
        uint256 weight;
        bytes32 reasoningHash;       // IPFS hash of reasoning
        uint256 timestamp;
        bool overridden;
    }

    struct AgentProposal {
        uint256 proposalId;
        bytes32 agentId;
        bytes32 descriptionHash;     // IPFS hash of proposal
        bytes32 reasoningHash;       // Why agent thinks this is needed
        uint256 forVotes;
        uint256 againstVotes;
        uint256 abstainVotes;
        uint256 createdAt;
        uint256 votingDeadline;
        bool executed;
    }

    // ============ Constants ============

    uint256 public constant MAX_AGENT_VOTE_WEIGHT = 2000;  // 20% max
    uint256 public constant OVERRIDE_GRACE_PERIOD = 1 hours;
    uint256 public constant VOTING_PERIOD = 3 days;
    uint256 public constant MIN_REPUTATION = 5000;

    // ============ State ============

    mapping(bytes32 => AgentGovernanceProfile) public agentProfiles;
    mapping(bytes32 => mapping(uint256 => AgentVote)) public agentVotes; // agentId => proposalId => vote
    mapping(uint256 => AgentProposal) public proposals;
    uint256 public proposalCount;

    uint256 public totalAgentVotes;
    uint256 public totalOverrides;

    // ============ Events ============

    event AgentGovernanceRegistered(bytes32 indexed agentId, address indexed operator, uint256 maxWeight);
    event AgentVoteCast(bytes32 indexed agentId, uint256 indexed proposalId, VoteType vote, uint256 weight, bytes32 reasoningHash);
    event AgentVoteOverridden(bytes32 indexed agentId, uint256 indexed proposalId, address indexed operator);
    event AgentProposalCreated(uint256 indexed proposalId, bytes32 indexed agentId, bytes32 descriptionHash);
    event ProposalExecuted(uint256 indexed proposalId);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Registration ============

    function registerAgent(
        bytes32 agentId,
        uint256 maxVoteWeightBps,
        uint256 minRepToPropose
    ) external {
        require(agentProfiles[agentId].operator == address(0), "Already registered");
        require(maxVoteWeightBps <= MAX_AGENT_VOTE_WEIGHT, "Weight too high");

        agentProfiles[agentId] = AgentGovernanceProfile({
            agentId: agentId,
            operator: msg.sender,
            maxVoteWeightBps: maxVoteWeightBps,
            minReputationToPropose: minRepToPropose > 0 ? minRepToPropose : MIN_REPUTATION,
            currentReputation: 0,
            proposalsCreated: 0,
            votescast: 0,
            overrideCount: 0,
            active: true
        });

        emit AgentGovernanceRegistered(agentId, msg.sender, maxVoteWeightBps);
    }

    // ============ Voting ============

    function castVote(
        bytes32 agentId,
        uint256 proposalId,
        VoteType vote,
        uint256 weight,
        bytes32 reasoningHash
    ) external {
        AgentGovernanceProfile storage profile = agentProfiles[agentId];
        require(profile.active, "Not active");
        require(profile.operator == msg.sender, "Not operator");
        require(weight <= profile.maxVoteWeightBps, "Weight exceeds max");
        require(reasoningHash != bytes32(0), "Reasoning required");

        AgentProposal storage p = proposals[proposalId];
        require(p.createdAt > 0, "Proposal not found");
        require(block.timestamp <= p.votingDeadline, "Voting ended");
        require(agentVotes[agentId][proposalId].timestamp == 0, "Already voted");

        agentVotes[agentId][proposalId] = AgentVote({
            agentId: agentId,
            proposalId: proposalId,
            vote: vote,
            weight: weight,
            reasoningHash: reasoningHash,
            timestamp: block.timestamp,
            overridden: false
        });

        if (vote == VoteType.FOR) p.forVotes += weight;
        else if (vote == VoteType.AGAINST) p.againstVotes += weight;
        else p.abstainVotes += weight;

        profile.votescast++;
        totalAgentVotes++;

        emit AgentVoteCast(agentId, proposalId, vote, weight, reasoningHash);
    }

    // ============ Override ============

    function overrideVote(bytes32 agentId, uint256 proposalId) external {
        AgentGovernanceProfile storage profile = agentProfiles[agentId];
        require(profile.operator == msg.sender, "Not operator");

        AgentVote storage v = agentVotes[agentId][proposalId];
        require(v.timestamp > 0, "No vote to override");
        require(!v.overridden, "Already overridden");
        require(block.timestamp <= v.timestamp + OVERRIDE_GRACE_PERIOD, "Grace period expired");

        // Remove vote from tally
        AgentProposal storage p = proposals[proposalId];
        if (v.vote == VoteType.FOR) p.forVotes -= v.weight;
        else if (v.vote == VoteType.AGAINST) p.againstVotes -= v.weight;
        else p.abstainVotes -= v.weight;

        v.overridden = true;
        profile.overrideCount++;
        totalOverrides++;

        emit AgentVoteOverridden(agentId, proposalId, msg.sender);
    }

    // ============ Proposals ============

    function createProposal(
        bytes32 agentId,
        bytes32 descriptionHash,
        bytes32 reasoningHash
    ) external returns (uint256) {
        AgentGovernanceProfile storage profile = agentProfiles[agentId];
        require(profile.operator == msg.sender, "Not operator");
        require(profile.active, "Not active");
        require(profile.currentReputation >= profile.minReputationToPropose, "Insufficient reputation");

        proposalCount++;
        proposals[proposalCount] = AgentProposal({
            proposalId: proposalCount,
            agentId: agentId,
            descriptionHash: descriptionHash,
            reasoningHash: reasoningHash,
            forVotes: 0,
            againstVotes: 0,
            abstainVotes: 0,
            createdAt: block.timestamp,
            votingDeadline: block.timestamp + VOTING_PERIOD,
            executed: false
        });

        profile.proposalsCreated++;

        emit AgentProposalCreated(proposalCount, agentId, descriptionHash);
        return proposalCount;
    }

    // ============ Admin ============

    function updateReputation(bytes32 agentId, uint256 reputation) external onlyOwner {
        agentProfiles[agentId].currentReputation = reputation;
    }

    function deactivateAgent(bytes32 agentId) external {
        require(agentProfiles[agentId].operator == msg.sender || msg.sender == owner(), "Not authorized");
        agentProfiles[agentId].active = false;
    }

    // ============ View ============

    function getAgentProfile(bytes32 id) external view returns (AgentGovernanceProfile memory) { return agentProfiles[id]; }
    function getProposal(uint256 id) external view returns (AgentProposal memory) { return proposals[id]; }
    function getAgentVote(bytes32 agentId, uint256 proposalId) external view returns (AgentVote memory) { return agentVotes[agentId][proposalId]; }

    receive() external payable {}
}
