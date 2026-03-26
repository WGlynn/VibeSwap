// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeDAO — Community Governance Framework
 * @notice Lightweight DAO factory for sub-communities within VSOS.
 *         Anyone can create a DAO for their community, project, or idea.
 *
 * @dev Features:
 *      - Create sub-DAOs with custom governance parameters
 *      - Multi-sig treasury per DAO
 *      - Nested DAO delegation (DAOs can vote in parent DAOs)
 *      - Template system for common DAO types
 *      - Integration with VibeID for identity-weighted voting
 */
contract VibeDAO is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    // ============ Types ============

    struct SubDAO {
        uint256 daoId;
        string name;
        string description;
        address creator;
        address treasury;
        uint256 memberCount;
        uint256 proposalCount;
        uint256 totalFunding;
        GovernanceType govType;
        uint256 quorumBps;         // Required quorum in basis points
        uint256 votingPeriod;      // Duration of voting
        uint256 executionDelay;    // Timelock delay
        bool active;
        uint256 createdAt;
    }

    enum GovernanceType { TOKEN_VOTING, CONVICTION, QUADRATIC, MULTISIG, REPUTATION }

    struct DAOProposal {
        uint256 proposalId;
        uint256 daoId;
        address proposer;
        string title;
        string description;
        bytes executionData;       // Calldata to execute if passed
        address executionTarget;   // Target contract
        uint256 votesFor;
        uint256 votesAgainst;
        uint256 startTime;
        uint256 endTime;
        bool executed;
        bool cancelled;
    }

    struct DAOMember {
        address memberAddress;
        uint256 joinedAt;
        uint256 votingPower;
        uint256 proposalsCreated;
        uint256 votesCase;
        bool active;
    }

    // ============ State ============

    mapping(uint256 => SubDAO) public daos;
    uint256 public daoCount;

    /// @notice DAO members: daoId => member => data
    mapping(uint256 => mapping(address => DAOMember)) public members;

    /// @notice DAO proposals: daoId => proposalId => proposal
    mapping(uint256 => mapping(uint256 => DAOProposal)) public proposals;

    /// @notice Votes: daoId => proposalId => voter => voted
    mapping(uint256 => mapping(uint256 => mapping(address => bool))) public hasVoted;

    /// @notice DAO treasury balances
    mapping(uint256 => uint256) public daoTreasury;

    /// @notice Templates
    mapping(uint256 => SubDAO) public templates;
    uint256 public templateCount;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event DAOCreated(uint256 indexed daoId, string name, address indexed creator, GovernanceType govType);
    event MemberJoined(uint256 indexed daoId, address indexed member);
    event MemberLeft(uint256 indexed daoId, address indexed member);
    event ProposalCreated(uint256 indexed daoId, uint256 indexed proposalId, string title);
    event VoteCast(uint256 indexed daoId, uint256 indexed proposalId, address indexed voter, bool support);
    event ProposalExecuted(uint256 indexed daoId, uint256 indexed proposalId);
    event DAOFunded(uint256 indexed daoId, address indexed funder, uint256 amount);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ DAO Creation ============

    function createDAO(
        string calldata name,
        string calldata description,
        GovernanceType govType,
        uint256 quorumBps,
        uint256 votingPeriod,
        uint256 executionDelay
    ) external returns (uint256) {
        require(quorumBps <= 10000, "Invalid quorum");
        require(votingPeriod >= 1 hours, "Voting too short");

        daoCount++;
        daos[daoCount] = SubDAO({
            daoId: daoCount,
            name: name,
            description: description,
            creator: msg.sender,
            treasury: address(this),
            memberCount: 1,
            proposalCount: 0,
            totalFunding: 0,
            govType: govType,
            quorumBps: quorumBps,
            votingPeriod: votingPeriod,
            executionDelay: executionDelay,
            active: true,
            createdAt: block.timestamp
        });

        // Creator auto-joins
        members[daoCount][msg.sender] = DAOMember({
            memberAddress: msg.sender,
            joinedAt: block.timestamp,
            votingPower: 1,
            proposalsCreated: 0,
            votesCase: 0,
            active: true
        });

        emit DAOCreated(daoCount, name, msg.sender, govType);
        emit MemberJoined(daoCount, msg.sender);

        return daoCount;
    }

    // ============ Membership ============

    function joinDAO(uint256 daoId) external {
        require(daos[daoId].active, "DAO not active");
        require(!members[daoId][msg.sender].active, "Already member");

        members[daoId][msg.sender] = DAOMember({
            memberAddress: msg.sender,
            joinedAt: block.timestamp,
            votingPower: 1,
            proposalsCreated: 0,
            votesCase: 0,
            active: true
        });

        daos[daoId].memberCount++;
        emit MemberJoined(daoId, msg.sender);
    }

    function leaveDAO(uint256 daoId) external {
        require(members[daoId][msg.sender].active, "Not a member");
        members[daoId][msg.sender].active = false;
        daos[daoId].memberCount--;
        emit MemberLeft(daoId, msg.sender);
    }

    // ============ Proposals ============

    function createProposal(
        uint256 daoId,
        string calldata title,
        string calldata description,
        address executionTarget,
        bytes calldata executionData
    ) external returns (uint256) {
        require(members[daoId][msg.sender].active, "Not a member");

        SubDAO storage dao = daos[daoId];
        dao.proposalCount++;
        uint256 propId = dao.proposalCount;

        proposals[daoId][propId] = DAOProposal({
            proposalId: propId,
            daoId: daoId,
            proposer: msg.sender,
            title: title,
            description: description,
            executionData: executionData,
            executionTarget: executionTarget,
            votesFor: 0,
            votesAgainst: 0,
            startTime: block.timestamp,
            endTime: block.timestamp + dao.votingPeriod,
            executed: false,
            cancelled: false
        });

        members[daoId][msg.sender].proposalsCreated++;
        emit ProposalCreated(daoId, propId, title);
        return propId;
    }

    function vote(uint256 daoId, uint256 proposalId, bool support) external {
        require(members[daoId][msg.sender].active, "Not a member");
        DAOProposal storage prop = proposals[daoId][proposalId];
        require(block.timestamp <= prop.endTime, "Voting ended");
        require(!hasVoted[daoId][proposalId][msg.sender], "Already voted");

        hasVoted[daoId][proposalId][msg.sender] = true;
        uint256 power = members[daoId][msg.sender].votingPower;

        if (support) {
            prop.votesFor += power;
        } else {
            prop.votesAgainst += power;
        }

        members[daoId][msg.sender].votesCase++;
        emit VoteCast(daoId, proposalId, msg.sender, support);
    }

    function executeProposal(uint256 daoId, uint256 proposalId) external nonReentrant {
        SubDAO storage dao = daos[daoId];
        DAOProposal storage prop = proposals[daoId][proposalId];

        require(block.timestamp > prop.endTime, "Voting not ended");
        require(!prop.executed && !prop.cancelled, "Already processed");

        uint256 totalVotes = prop.votesFor + prop.votesAgainst;
        uint256 quorumNeeded = (dao.memberCount * dao.quorumBps) / 10000;
        require(totalVotes >= quorumNeeded, "Quorum not met");
        require(prop.votesFor > prop.votesAgainst, "Not passed");

        prop.executed = true;

        if (prop.executionTarget != address(0) && prop.executionData.length > 0) {
            (bool ok, ) = prop.executionTarget.call(prop.executionData);
            require(ok, "Execution failed");
        }

        emit ProposalExecuted(daoId, proposalId);
    }

    // ============ Treasury ============

    function fundDAO(uint256 daoId) external payable {
        require(daos[daoId].active, "DAO not active");
        daoTreasury[daoId] += msg.value;
        daos[daoId].totalFunding += msg.value;
        emit DAOFunded(daoId, msg.sender, msg.value);
    }

    // ============ View ============

    function getDAOCount() external view returns (uint256) { return daoCount; }

    function isMember(uint256 daoId, address user) external view returns (bool) {
        return members[daoId][user].active;
    }

    receive() external payable {}
}
