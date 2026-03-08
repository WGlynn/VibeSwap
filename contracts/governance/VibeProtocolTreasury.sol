// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title VibeProtocolTreasury
 * @notice VSOS protocol treasury — manages protocol-owned funds with governance controls
 * @dev Multi-sig council approval with monthly spending limits per category
 */
contract VibeProtocolTreasury is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ Enums ============

    enum Category {
        Development,
        Marketing,
        Grants,
        Insurance,
        Buyback
    }

    // ============ Structs ============

    struct SpendingProposal {
        uint256 proposalId;
        address recipient;
        uint256 amount;
        address token; // address(0) for ETH
        Category category;
        bytes32 descriptionHash;
        uint256 approvals;
        bool executed;
        uint256 deadline;
    }

    // ============ Constants ============

    /// @notice Number of spending categories
    uint256 public constant NUM_CATEGORIES = 5;

    /// @notice Minimum approval threshold
    uint256 public constant MIN_THRESHOLD = 2;

    /// @notice Maximum council size
    uint256 public constant MAX_COUNCIL_SIZE = 20;

    /// @notice Proposal validity period
    uint256 public constant PROPOSAL_DURATION = 7 days;

    // ============ State ============

    /// @notice Next proposal ID
    uint256 public nextProposalId;

    /// @notice Approval threshold (e.g., 3-of-5)
    uint256 public approvalThreshold;

    /// @notice Council members
    address[] public councilMembers;

    /// @notice Whether an address is a council member
    mapping(address => bool) public isCouncilMember;

    /// @notice Monthly spending limits per category (in wei / token units)
    mapping(Category => uint256) public monthlyLimit;

    /// @notice Monthly spending per category: month => category => amount spent
    mapping(uint256 => mapping(Category => uint256)) public monthlySpent;

    /// @notice Proposals by ID
    mapping(uint256 => SpendingProposal) public proposals;

    /// @notice Whether a council member has approved a proposal
    mapping(uint256 => mapping(address => bool)) public hasApproved;

    /// @notice Total revenue received per token (address(0) for ETH)
    mapping(address => uint256) public totalRevenue;

    // ============ Events ============

    event ProposalCreated(uint256 indexed proposalId, address indexed proposer, Category category, uint256 amount);
    event ProposalApproved(uint256 indexed proposalId, address indexed approver, uint256 totalApprovals);
    event ProposalExecuted(uint256 indexed proposalId, address indexed recipient, uint256 amount);
    event CouncilMemberAdded(address indexed member);
    event CouncilMemberRemoved(address indexed member);
    event MonthlyLimitSet(Category indexed category, uint256 limit);
    event ThresholdUpdated(uint256 newThreshold);
    event RevenueReceived(address indexed token, address indexed from, uint256 amount);

    // ============ Errors ============

    error NotCouncilMember();
    error AlreadyCouncilMember();
    error NotACouncilMember();
    error InvalidThreshold();
    error InvalidRecipient();
    error InvalidAmount();
    error ProposalNotFound();
    error AlreadyApproved();
    error AlreadyExecuted();
    error ThresholdNotMet();
    error ProposalExpired();
    error MonthlyLimitExceeded();
    error CouncilTooSmall();
    error CouncilTooLarge();
    error TransferFailed();

    // ============ Modifiers ============

    modifier onlyCouncil() {
        if (!isCouncilMember[msg.sender]) revert NotCouncilMember();
        _;
    }

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the protocol treasury
     * @param _owner Contract owner (can manage council)
     * @param _councilMembers Initial council members
     * @param _threshold Approval threshold
     */
    function initialize(
        address _owner,
        address[] calldata _councilMembers,
        uint256 _threshold
    ) external initializer {
        __Ownable_init(_owner);
        __ReentrancyGuard_init();
        __Pausable_init();
        __UUPSUpgradeable_init();

        if (_councilMembers.length < MIN_THRESHOLD) revert CouncilTooSmall();
        if (_councilMembers.length > MAX_COUNCIL_SIZE) revert CouncilTooLarge();
        if (_threshold < MIN_THRESHOLD || _threshold > _councilMembers.length) revert InvalidThreshold();

        for (uint256 i = 0; i < _councilMembers.length; i++) {
            address member = _councilMembers[i];
            if (member == address(0)) revert InvalidRecipient();
            if (isCouncilMember[member]) revert AlreadyCouncilMember();
            isCouncilMember[member] = true;
            councilMembers.push(member);
        }

        approvalThreshold = _threshold;
        nextProposalId = 1;
    }

    // ============ Council Management (Owner Only) ============

    function addCouncilMember(address _member) external onlyOwner {
        if (_member == address(0)) revert InvalidRecipient();
        if (isCouncilMember[_member]) revert AlreadyCouncilMember();
        if (councilMembers.length >= MAX_COUNCIL_SIZE) revert CouncilTooLarge();

        isCouncilMember[_member] = true;
        councilMembers.push(_member);

        emit CouncilMemberAdded(_member);
    }

    function removeCouncilMember(address _member) external onlyOwner {
        if (!isCouncilMember[_member]) revert NotACouncilMember();
        if (councilMembers.length - 1 < approvalThreshold) revert CouncilTooSmall();

        isCouncilMember[_member] = false;

        // Swap and pop
        for (uint256 i = 0; i < councilMembers.length; i++) {
            if (councilMembers[i] == _member) {
                councilMembers[i] = councilMembers[councilMembers.length - 1];
                councilMembers.pop();
                break;
            }
        }

        emit CouncilMemberRemoved(_member);
    }

    function setApprovalThreshold(uint256 _threshold) external onlyOwner {
        if (_threshold < MIN_THRESHOLD || _threshold > councilMembers.length) revert InvalidThreshold();
        approvalThreshold = _threshold;
        emit ThresholdUpdated(_threshold);
    }

    // ============ Budget Configuration (Owner Only) ============

    function setMonthlyLimit(Category _category, uint256 _limit) external onlyOwner {
        monthlyLimit[_category] = _limit;
        emit MonthlyLimitSet(_category, _limit);
    }

    // ============ Spending Proposals ============

    /**
     * @notice Propose a spending transaction
     * @param _recipient Recipient address
     * @param _amount Amount to send
     * @param _token Token address (address(0) for ETH)
     * @param _category Spending category
     * @param _descriptionHash IPFS hash or keccak256 of description
     */
    function proposeSpending(
        address _recipient,
        uint256 _amount,
        address _token,
        Category _category,
        bytes32 _descriptionHash
    ) external onlyCouncil whenNotPaused returns (uint256 proposalId) {
        if (_recipient == address(0)) revert InvalidRecipient();
        if (_amount == 0) revert InvalidAmount();

        proposalId = nextProposalId++;

        proposals[proposalId] = SpendingProposal({
            proposalId: proposalId,
            recipient: _recipient,
            amount: _amount,
            token: _token,
            category: _category,
            descriptionHash: _descriptionHash,
            approvals: 1, // Proposer auto-approves
            executed: false,
            deadline: block.timestamp + PROPOSAL_DURATION
        });

        hasApproved[proposalId][msg.sender] = true;

        emit ProposalCreated(proposalId, msg.sender, _category, _amount);
    }

    /**
     * @notice Approve a spending proposal
     * @param _proposalId Proposal to approve
     */
    function approveSpending(uint256 _proposalId) external onlyCouncil whenNotPaused {
        SpendingProposal storage proposal = proposals[_proposalId];
        if (proposal.proposalId == 0) revert ProposalNotFound();
        if (proposal.executed) revert AlreadyExecuted();
        if (block.timestamp > proposal.deadline) revert ProposalExpired();
        if (hasApproved[_proposalId][msg.sender]) revert AlreadyApproved();

        hasApproved[_proposalId][msg.sender] = true;
        proposal.approvals++;

        emit ProposalApproved(_proposalId, msg.sender, proposal.approvals);
    }

    /**
     * @notice Execute an approved spending proposal
     * @param _proposalId Proposal to execute
     */
    function executeSpending(uint256 _proposalId) external onlyCouncil nonReentrant whenNotPaused {
        SpendingProposal storage proposal = proposals[_proposalId];
        if (proposal.proposalId == 0) revert ProposalNotFound();
        if (proposal.executed) revert AlreadyExecuted();
        if (block.timestamp > proposal.deadline) revert ProposalExpired();
        if (proposal.approvals < approvalThreshold) revert ThresholdNotMet();

        // Check monthly limit
        uint256 currentMonth = _getCurrentMonth();
        uint256 spent = monthlySpent[currentMonth][proposal.category];
        uint256 limit = monthlyLimit[proposal.category];
        if (limit > 0 && spent + proposal.amount > limit) revert MonthlyLimitExceeded();

        proposal.executed = true;
        monthlySpent[currentMonth][proposal.category] = spent + proposal.amount;

        // Transfer funds
        if (proposal.token == address(0)) {
            (bool success,) = proposal.recipient.call{value: proposal.amount}("");
            if (!success) revert TransferFailed();
        } else {
            IERC20(proposal.token).safeTransfer(proposal.recipient, proposal.amount);
        }

        emit ProposalExecuted(_proposalId, proposal.recipient, proposal.amount);
    }

    // ============ Revenue Tracking ============

    /**
     * @notice Record incoming ERC20 protocol fees
     * @param _token Token address
     * @param _amount Amount received
     */
    function recordRevenue(address _token, uint256 _amount) external nonReentrant {
        if (_amount == 0) revert InvalidAmount();
        IERC20(_token).safeTransferFrom(msg.sender, address(this), _amount);
        totalRevenue[_token] += _amount;
        emit RevenueReceived(_token, msg.sender, _amount);
    }

    /// @notice Accept ETH and track as revenue
    receive() external payable {
        totalRevenue[address(0)] += msg.value;
        emit RevenueReceived(address(0), msg.sender, msg.value);
    }

    // ============ Emergency ============

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ============ Views ============

    function getTreasuryBalance(address _token) external view returns (uint256) {
        if (_token == address(0)) {
            return address(this).balance;
        }
        return IERC20(_token).balanceOf(address(this));
    }

    function getMonthlySpent(Category _category) external view returns (uint256) {
        return monthlySpent[_getCurrentMonth()][_category];
    }

    function getProposal(uint256 _proposalId) external view returns (SpendingProposal memory) {
        return proposals[_proposalId];
    }

    function getCouncilMembers() external view returns (address[] memory) {
        return councilMembers;
    }

    function getCouncilSize() external view returns (uint256) {
        return councilMembers.length;
    }

    // ============ Internal ============

    function _getCurrentMonth() internal view returns (uint256) {
        return block.timestamp / 30 days;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
