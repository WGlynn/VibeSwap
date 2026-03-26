// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/governance/VibeProtocolTreasury.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockTreasuryToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Test Contract ============

contract VibeProtocolTreasuryTest is Test {
    VibeProtocolTreasury public treasury;
    MockTreasuryToken public token;

    // ============ Actors ============

    address public owner;
    address public council1;
    address public council2;
    address public council3;
    address public council4;
    address public council5;
    address public recipient;
    address public nobody;

    // ============ Re-declared Events ============

    event ProposalCreated(uint256 indexed proposalId, address indexed proposer, VibeProtocolTreasury.Category category, uint256 amount);
    event ProposalApproved(uint256 indexed proposalId, address indexed approver, uint256 totalApprovals);
    event ProposalExecuted(uint256 indexed proposalId, address indexed recipient, uint256 amount);
    event CouncilMemberAdded(address indexed member);
    event CouncilMemberRemoved(address indexed member);
    event MonthlyLimitSet(VibeProtocolTreasury.Category indexed category, uint256 limit);
    event ThresholdUpdated(uint256 newThreshold);
    event RevenueReceived(address indexed token, address indexed from, uint256 amount);

    // ============ Constants ============

    uint256 constant PROPOSAL_DURATION = 7 days;

    function setUp() public {
        owner = makeAddr("owner");
        council1 = makeAddr("council1");
        council2 = makeAddr("council2");
        council3 = makeAddr("council3");
        council4 = makeAddr("council4");
        council5 = makeAddr("council5");
        recipient = makeAddr("recipient");
        nobody = makeAddr("nobody");

        // Deploy token
        token = new MockTreasuryToken("USDC", "USDC");

        // Deploy treasury via proxy (3-of-5 multisig)
        address[] memory council = new address[](5);
        council[0] = council1;
        council[1] = council2;
        council[2] = council3;
        council[3] = council4;
        council[4] = council5;

        VibeProtocolTreasury impl = new VibeProtocolTreasury();
        bytes memory initData = abi.encodeCall(
            VibeProtocolTreasury.initialize,
            (owner, council, 3) // 3-of-5 threshold
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        treasury = VibeProtocolTreasury(payable(address(proxy)));

        // Fund treasury with ETH and tokens
        vm.deal(address(treasury), 100 ether);
        token.mint(address(treasury), 1_000_000 ether);

        // Set monthly limits
        vm.startPrank(owner);
        treasury.setMonthlyLimit(VibeProtocolTreasury.Category.Development, 100 ether);
        treasury.setMonthlyLimit(VibeProtocolTreasury.Category.Marketing, 50 ether);
        treasury.setMonthlyLimit(VibeProtocolTreasury.Category.Grants, 200 ether);
        treasury.setMonthlyLimit(VibeProtocolTreasury.Category.Insurance, 500 ether);
        treasury.setMonthlyLimit(VibeProtocolTreasury.Category.Buyback, 300 ether);
        vm.stopPrank();
    }

    // ============ Helpers ============

    function _proposeSpending(
        address _council,
        address _recipient,
        uint256 _amount,
        address _token,
        VibeProtocolTreasury.Category _category
    ) internal returns (uint256 proposalId) {
        vm.prank(_council);
        proposalId = treasury.proposeSpending(
            _recipient,
            _amount,
            _token,
            _category,
            keccak256("description")
        );
    }

    function _proposeEthSpending(uint256 _amount) internal returns (uint256 proposalId) {
        return _proposeSpending(council1, recipient, _amount, address(0), VibeProtocolTreasury.Category.Development);
    }

    function _proposeTokenSpending(uint256 _amount) internal returns (uint256 proposalId) {
        return _proposeSpending(council1, recipient, _amount, address(token), VibeProtocolTreasury.Category.Development);
    }

    function _approveProposal(uint256 proposalId, address approver) internal {
        vm.prank(approver);
        treasury.approveSpending(proposalId);
    }

    // ============ Initialization ============

    function test_initialize_setsState() public view {
        assertEq(treasury.owner(), owner);
        assertEq(treasury.approvalThreshold(), 3);
        assertEq(treasury.getCouncilSize(), 5);
        assertTrue(treasury.isCouncilMember(council1));
        assertTrue(treasury.isCouncilMember(council2));
        assertTrue(treasury.isCouncilMember(council3));
        assertTrue(treasury.isCouncilMember(council4));
        assertTrue(treasury.isCouncilMember(council5));
    }

    function test_initialize_revertsCouncilTooSmall() public {
        VibeProtocolTreasury impl = new VibeProtocolTreasury();
        address[] memory council = new address[](1);
        council[0] = council1;
        bytes memory initData = abi.encodeCall(VibeProtocolTreasury.initialize, (owner, council, 2));
        vm.expectRevert(VibeProtocolTreasury.CouncilTooSmall.selector);
        new ERC1967Proxy(address(impl), initData);
    }

    function test_initialize_revertsInvalidThreshold() public {
        VibeProtocolTreasury impl = new VibeProtocolTreasury();
        address[] memory council = new address[](3);
        council[0] = council1;
        council[1] = council2;
        council[2] = council3;
        // Threshold 1 < MIN_THRESHOLD (2)
        bytes memory initData = abi.encodeCall(VibeProtocolTreasury.initialize, (owner, council, 1));
        vm.expectRevert(VibeProtocolTreasury.InvalidThreshold.selector);
        new ERC1967Proxy(address(impl), initData);
    }

    function test_initialize_revertsThresholdAboveCouncilSize() public {
        VibeProtocolTreasury impl = new VibeProtocolTreasury();
        address[] memory council = new address[](3);
        council[0] = council1;
        council[1] = council2;
        council[2] = council3;
        // Threshold 4 > council size 3
        bytes memory initData = abi.encodeCall(VibeProtocolTreasury.initialize, (owner, council, 4));
        vm.expectRevert(VibeProtocolTreasury.InvalidThreshold.selector);
        new ERC1967Proxy(address(impl), initData);
    }

    function test_initialize_revertsDuplicateCouncilMember() public {
        VibeProtocolTreasury impl = new VibeProtocolTreasury();
        address[] memory council = new address[](3);
        council[0] = council1;
        council[1] = council2;
        council[2] = council1; // Duplicate
        bytes memory initData = abi.encodeCall(VibeProtocolTreasury.initialize, (owner, council, 2));
        vm.expectRevert(VibeProtocolTreasury.AlreadyCouncilMember.selector);
        new ERC1967Proxy(address(impl), initData);
    }

    function test_initialize_revertsZeroAddressInCouncil() public {
        VibeProtocolTreasury impl = new VibeProtocolTreasury();
        address[] memory council = new address[](3);
        council[0] = council1;
        council[1] = address(0);
        council[2] = council3;
        bytes memory initData = abi.encodeCall(VibeProtocolTreasury.initialize, (owner, council, 2));
        vm.expectRevert(VibeProtocolTreasury.InvalidRecipient.selector);
        new ERC1967Proxy(address(impl), initData);
    }

    // ============ Council Management ============

    function test_addCouncilMember_works() public {
        address newMember = makeAddr("newMember");
        vm.prank(owner);
        treasury.addCouncilMember(newMember);

        assertTrue(treasury.isCouncilMember(newMember));
        assertEq(treasury.getCouncilSize(), 6);
    }

    function test_addCouncilMember_revertsAlreadyMember() public {
        vm.prank(owner);
        vm.expectRevert(VibeProtocolTreasury.AlreadyCouncilMember.selector);
        treasury.addCouncilMember(council1);
    }

    function test_addCouncilMember_revertsNotOwner() public {
        vm.prank(nobody);
        vm.expectRevert();
        treasury.addCouncilMember(makeAddr("new"));
    }

    function test_addCouncilMember_revertsZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(VibeProtocolTreasury.InvalidRecipient.selector);
        treasury.addCouncilMember(address(0));
    }

    function test_removeCouncilMember_works() public {
        vm.prank(owner);
        treasury.removeCouncilMember(council5);

        assertFalse(treasury.isCouncilMember(council5));
        assertEq(treasury.getCouncilSize(), 4);
    }

    function test_removeCouncilMember_revertsNotAMember() public {
        vm.prank(owner);
        vm.expectRevert(VibeProtocolTreasury.NotACouncilMember.selector);
        treasury.removeCouncilMember(nobody);
    }

    function test_removeCouncilMember_revertsCouncilTooSmall() public {
        // Remove until council size would go below threshold (3)
        vm.startPrank(owner);
        treasury.removeCouncilMember(council5);
        treasury.removeCouncilMember(council4);
        // Now council = 3, threshold = 3. Removing another would make council < threshold.
        vm.expectRevert(VibeProtocolTreasury.CouncilTooSmall.selector);
        treasury.removeCouncilMember(council3);
        vm.stopPrank();
    }

    function test_setApprovalThreshold_works() public {
        vm.prank(owner);
        treasury.setApprovalThreshold(4);
        assertEq(treasury.approvalThreshold(), 4);
    }

    function test_setApprovalThreshold_revertsInvalid() public {
        // Below MIN_THRESHOLD
        vm.prank(owner);
        vm.expectRevert(VibeProtocolTreasury.InvalidThreshold.selector);
        treasury.setApprovalThreshold(1);

        // Above council size
        vm.prank(owner);
        vm.expectRevert(VibeProtocolTreasury.InvalidThreshold.selector);
        treasury.setApprovalThreshold(6);
    }

    // ============ Spending Proposal Creation ============

    function test_proposeSpending_createsProposal() public {
        uint256 proposalId = _proposeEthSpending(10 ether);
        assertEq(proposalId, 1);

        VibeProtocolTreasury.SpendingProposal memory p = treasury.getProposal(proposalId);
        assertEq(p.recipient, recipient);
        assertEq(p.amount, 10 ether);
        assertEq(p.token, address(0));
        assertEq(uint8(p.category), uint8(VibeProtocolTreasury.Category.Development));
        assertEq(p.approvals, 1); // Proposer auto-approves
        assertFalse(p.executed);
    }

    function test_proposeSpending_autoApprovesProposer() public {
        uint256 proposalId = _proposeEthSpending(10 ether);
        assertTrue(treasury.hasApproved(proposalId, council1));
    }

    function test_proposeSpending_revertsNotCouncilMember() public {
        vm.prank(nobody);
        vm.expectRevert(VibeProtocolTreasury.NotCouncilMember.selector);
        treasury.proposeSpending(recipient, 10 ether, address(0), VibeProtocolTreasury.Category.Development, bytes32(0));
    }

    function test_proposeSpending_revertsZeroRecipient() public {
        vm.prank(council1);
        vm.expectRevert(VibeProtocolTreasury.InvalidRecipient.selector);
        treasury.proposeSpending(address(0), 10 ether, address(0), VibeProtocolTreasury.Category.Development, bytes32(0));
    }

    function test_proposeSpending_revertsZeroAmount() public {
        vm.prank(council1);
        vm.expectRevert(VibeProtocolTreasury.InvalidAmount.selector);
        treasury.proposeSpending(recipient, 0, address(0), VibeProtocolTreasury.Category.Development, bytes32(0));
    }

    // ============ Spending Approval ============

    function test_approveSpending_incrementsApprovals() public {
        uint256 proposalId = _proposeEthSpending(10 ether);

        _approveProposal(proposalId, council2);

        VibeProtocolTreasury.SpendingProposal memory p = treasury.getProposal(proposalId);
        assertEq(p.approvals, 2); // proposer + council2
    }

    function test_approveSpending_revertsDoubleApproval() public {
        uint256 proposalId = _proposeEthSpending(10 ether);

        vm.prank(council1); // Already auto-approved as proposer
        vm.expectRevert(VibeProtocolTreasury.AlreadyApproved.selector);
        treasury.approveSpending(proposalId);
    }

    function test_approveSpending_revertsNotCouncilMember() public {
        uint256 proposalId = _proposeEthSpending(10 ether);

        vm.prank(nobody);
        vm.expectRevert(VibeProtocolTreasury.NotCouncilMember.selector);
        treasury.approveSpending(proposalId);
    }

    function test_approveSpending_revertsExpiredProposal() public {
        uint256 proposalId = _proposeEthSpending(10 ether);

        vm.warp(block.timestamp + PROPOSAL_DURATION + 1);

        vm.prank(council2);
        vm.expectRevert(VibeProtocolTreasury.ProposalExpired.selector);
        treasury.approveSpending(proposalId);
    }

    function test_approveSpending_revertsProposalNotFound() public {
        vm.prank(council1);
        vm.expectRevert(VibeProtocolTreasury.ProposalNotFound.selector);
        treasury.approveSpending(999);
    }

    function test_approveSpending_revertsAlreadyExecuted() public {
        uint256 proposalId = _proposeEthSpending(10 ether);
        _approveProposal(proposalId, council2);
        _approveProposal(proposalId, council3);

        vm.prank(council1);
        treasury.executeSpending(proposalId);

        vm.prank(council4);
        vm.expectRevert(VibeProtocolTreasury.AlreadyExecuted.selector);
        treasury.approveSpending(proposalId);
    }

    // ============ Spending Execution ============

    function test_executeSpending_sendsEth() public {
        uint256 proposalId = _proposeEthSpending(10 ether);
        _approveProposal(proposalId, council2);
        _approveProposal(proposalId, council3);

        uint256 recipientBefore = recipient.balance;

        vm.prank(council1);
        treasury.executeSpending(proposalId);

        assertEq(recipient.balance, recipientBefore + 10 ether);
    }

    function test_executeSpending_sendsTokens() public {
        uint256 proposalId = _proposeTokenSpending(1000 ether);
        _approveProposal(proposalId, council2);
        _approveProposal(proposalId, council3);

        uint256 recipientBefore = token.balanceOf(recipient);

        vm.prank(council1);
        treasury.executeSpending(proposalId);

        assertEq(token.balanceOf(recipient), recipientBefore + 1000 ether);
    }

    function test_executeSpending_revertsInsufficientApprovals() public {
        uint256 proposalId = _proposeEthSpending(10 ether);
        _approveProposal(proposalId, council2);
        // Only 2 approvals, need 3

        vm.prank(council1);
        vm.expectRevert(VibeProtocolTreasury.ThresholdNotMet.selector);
        treasury.executeSpending(proposalId);
    }

    function test_executeSpending_revertsAlreadyExecuted() public {
        uint256 proposalId = _proposeEthSpending(10 ether);
        _approveProposal(proposalId, council2);
        _approveProposal(proposalId, council3);

        vm.prank(council1);
        treasury.executeSpending(proposalId);

        vm.prank(council1);
        vm.expectRevert(VibeProtocolTreasury.AlreadyExecuted.selector);
        treasury.executeSpending(proposalId);
    }

    function test_executeSpending_revertsExpired() public {
        uint256 proposalId = _proposeEthSpending(10 ether);
        _approveProposal(proposalId, council2);
        _approveProposal(proposalId, council3);

        vm.warp(block.timestamp + PROPOSAL_DURATION + 1);

        vm.prank(council1);
        vm.expectRevert(VibeProtocolTreasury.ProposalExpired.selector);
        treasury.executeSpending(proposalId);
    }

    function test_executeSpending_revertsNotCouncilMember() public {
        uint256 proposalId = _proposeEthSpending(10 ether);
        _approveProposal(proposalId, council2);
        _approveProposal(proposalId, council3);

        vm.prank(nobody);
        vm.expectRevert(VibeProtocolTreasury.NotCouncilMember.selector);
        treasury.executeSpending(proposalId);
    }

    // ============ Monthly Spending Limits ============

    function test_monthlyLimit_enforced() public {
        // Development limit is 100 ether
        uint256 proposalId = _proposeEthSpending(90 ether);
        _approveProposal(proposalId, council2);
        _approveProposal(proposalId, council3);
        vm.prank(council1);
        treasury.executeSpending(proposalId);

        // Second spending pushes over limit (90 + 20 > 100)
        uint256 proposalId2 = _proposeSpending(
            council2, recipient, 20 ether, address(0), VibeProtocolTreasury.Category.Development
        );
        _approveProposal(proposalId2, council3);
        _approveProposal(proposalId2, council4);

        vm.prank(council2);
        vm.expectRevert(VibeProtocolTreasury.MonthlyLimitExceeded.selector);
        treasury.executeSpending(proposalId2);
    }

    function test_monthlyLimit_resetsNextMonth() public {
        // Spend 90 of 100 limit
        uint256 proposalId = _proposeEthSpending(90 ether);
        _approveProposal(proposalId, council2);
        _approveProposal(proposalId, council3);
        vm.prank(council1);
        treasury.executeSpending(proposalId);

        // Advance to next month (30 days)
        vm.warp(block.timestamp + 30 days);

        // Should work again with fresh limit
        uint256 proposalId2 = _proposeSpending(
            council2, recipient, 90 ether, address(0), VibeProtocolTreasury.Category.Development
        );
        _approveProposal(proposalId2, council3);
        _approveProposal(proposalId2, council4);

        // Re-fund treasury
        vm.deal(address(treasury), 100 ether);

        vm.prank(council2);
        treasury.executeSpending(proposalId2);

        assertEq(treasury.getMonthlySpent(VibeProtocolTreasury.Category.Development), 90 ether);
    }

    function test_monthlyLimit_zeroLimitMeansNoLimit() public {
        // Set Marketing limit to 0 (no limit)
        vm.prank(owner);
        treasury.setMonthlyLimit(VibeProtocolTreasury.Category.Marketing, 0);

        // Should allow any amount
        uint256 proposalId = _proposeSpending(
            council1, recipient, 50 ether, address(0), VibeProtocolTreasury.Category.Marketing
        );
        _approveProposal(proposalId, council2);
        _approveProposal(proposalId, council3);

        vm.prank(council1);
        treasury.executeSpending(proposalId);
    }

    function test_monthlyLimit_perCategoryIndependence() public {
        // Fill up Development limit
        uint256 proposalId = _proposeEthSpending(100 ether);
        _approveProposal(proposalId, council2);
        _approveProposal(proposalId, council3);
        vm.prank(council1);
        treasury.executeSpending(proposalId);

        // Grants category should still work
        vm.deal(address(treasury), 100 ether);
        uint256 proposalId2 = _proposeSpending(
            council2, recipient, 50 ether, address(0), VibeProtocolTreasury.Category.Grants
        );
        _approveProposal(proposalId2, council3);
        _approveProposal(proposalId2, council4);

        vm.prank(council2);
        treasury.executeSpending(proposalId2);
    }

    // ============ Revenue Tracking ============

    function test_receiveEth_tracksRevenue() public {
        vm.deal(nobody, 5 ether);
        vm.prank(nobody);
        (bool success,) = address(treasury).call{value: 5 ether}("");
        assertTrue(success);

        assertEq(treasury.totalRevenue(address(0)), 5 ether);
    }

    function test_recordRevenue_tracksTokenRevenue() public {
        token.mint(nobody, 1000 ether);
        vm.startPrank(nobody);
        token.approve(address(treasury), 1000 ether);
        treasury.recordRevenue(address(token), 1000 ether);
        vm.stopPrank();

        assertEq(treasury.totalRevenue(address(token)), 1000 ether);
    }

    function test_recordRevenue_revertsZeroAmount() public {
        vm.prank(nobody);
        vm.expectRevert(VibeProtocolTreasury.InvalidAmount.selector);
        treasury.recordRevenue(address(token), 0);
    }

    // ============ Treasury Balance ============

    function test_getTreasuryBalance_eth() public view {
        assertEq(treasury.getTreasuryBalance(address(0)), 100 ether);
    }

    function test_getTreasuryBalance_token() public view {
        assertEq(treasury.getTreasuryBalance(address(token)), 1_000_000 ether);
    }

    // ============ Emergency Pause ============

    function test_pause_blocksProposals() public {
        vm.prank(owner);
        treasury.pause();

        vm.prank(council1);
        vm.expectRevert();
        treasury.proposeSpending(recipient, 10 ether, address(0), VibeProtocolTreasury.Category.Development, bytes32(0));
    }

    function test_pause_blocksApprovals() public {
        uint256 proposalId = _proposeEthSpending(10 ether);

        vm.prank(owner);
        treasury.pause();

        vm.prank(council2);
        vm.expectRevert();
        treasury.approveSpending(proposalId);
    }

    function test_pause_blocksExecution() public {
        uint256 proposalId = _proposeEthSpending(10 ether);
        _approveProposal(proposalId, council2);
        _approveProposal(proposalId, council3);

        vm.prank(owner);
        treasury.pause();

        vm.prank(council1);
        vm.expectRevert();
        treasury.executeSpending(proposalId);
    }

    function test_unpause_resumesOperations() public {
        vm.prank(owner);
        treasury.pause();

        vm.prank(owner);
        treasury.unpause();

        // Should work again
        uint256 proposalId = _proposeEthSpending(10 ether);
        assertTrue(proposalId > 0);
    }

    function test_pause_onlyOwner() public {
        vm.prank(nobody);
        vm.expectRevert();
        treasury.pause();
    }

    // ============ View Functions ============

    function test_getCouncilMembers_returnsAll() public view {
        address[] memory members = treasury.getCouncilMembers();
        assertEq(members.length, 5);
    }

    function test_getProposal_returnsCorrectly() public {
        uint256 proposalId = _proposeEthSpending(10 ether);
        VibeProtocolTreasury.SpendingProposal memory p = treasury.getProposal(proposalId);
        assertEq(p.proposalId, proposalId);
        assertEq(p.amount, 10 ether);
    }

    // ============ Full Lifecycle ============

    function test_fullLifecycle_proposeApproveExecuteEth() public {
        // 1. Council1 proposes
        uint256 proposalId = _proposeEthSpending(5 ether);
        assertEq(treasury.getProposal(proposalId).approvals, 1);

        // 2. Council2 approves
        _approveProposal(proposalId, council2);
        assertEq(treasury.getProposal(proposalId).approvals, 2);

        // 3. Council3 approves (threshold met: 3-of-5)
        _approveProposal(proposalId, council3);
        assertEq(treasury.getProposal(proposalId).approvals, 3);

        // 4. Council4 executes (any council member can execute after threshold)
        uint256 recipientBefore = recipient.balance;
        vm.prank(council4);
        treasury.executeSpending(proposalId);

        // 5. Verify
        assertEq(recipient.balance, recipientBefore + 5 ether);
        assertTrue(treasury.getProposal(proposalId).executed);
    }

    function test_fullLifecycle_proposeApproveExecuteToken() public {
        uint256 proposalId = _proposeTokenSpending(500 ether);
        _approveProposal(proposalId, council2);
        _approveProposal(proposalId, council3);

        uint256 recipientBefore = token.balanceOf(recipient);
        vm.prank(council1);
        treasury.executeSpending(proposalId);

        assertEq(token.balanceOf(recipient), recipientBefore + 500 ether);
    }

    // ============ Fuzz Tests ============

    function testFuzz_monthlyLimit_cannotExceed(uint256 amount1, uint256 amount2) public {
        amount1 = bound(amount1, 1 ether, 50 ether);
        amount2 = bound(amount2, 1 ether, 100 ether);

        // Fund treasury
        vm.deal(address(treasury), amount1 + amount2);

        // First spend
        uint256 pid1 = _proposeEthSpending(amount1);
        _approveProposal(pid1, council2);
        _approveProposal(pid1, council3);
        vm.prank(council1);
        treasury.executeSpending(pid1);

        // Second spend
        uint256 pid2 = _proposeSpending(
            council2, recipient, amount2, address(0), VibeProtocolTreasury.Category.Development
        );
        _approveProposal(pid2, council3);
        _approveProposal(pid2, council4);

        // If combined exceeds limit (100 ether), should revert
        vm.prank(council2);
        if (amount1 + amount2 > 100 ether) {
            vm.expectRevert(VibeProtocolTreasury.MonthlyLimitExceeded.selector);
            treasury.executeSpending(pid2);
        } else {
            treasury.executeSpending(pid2);
        }
    }

    function testFuzz_proposalExpiry(uint256 timeDelta) public {
        timeDelta = bound(timeDelta, 0, 30 days);

        uint256 proposalId = _proposeEthSpending(1 ether);

        vm.warp(block.timestamp + timeDelta);

        if (timeDelta > PROPOSAL_DURATION) {
            vm.prank(council2);
            vm.expectRevert(VibeProtocolTreasury.ProposalExpired.selector);
            treasury.approveSpending(proposalId);
        } else {
            _approveProposal(proposalId, council2);
            assertEq(treasury.getProposal(proposalId).approvals, 2);
        }
    }

    function testFuzz_approvalThreshold(uint256 threshold) public {
        threshold = bound(threshold, 2, 5); // MIN_THRESHOLD to council size

        vm.prank(owner);
        treasury.setApprovalThreshold(threshold);

        uint256 proposalId = _proposeEthSpending(1 ether);

        // Approve up to threshold - 1 (remember proposer auto-approves = 1)
        address[4] memory otherCouncil = [council2, council3, council4, council5];
        for (uint256 i = 0; i < threshold - 1; i++) {
            _approveProposal(proposalId, otherCouncil[i]);
        }

        // Should be executable now
        vm.prank(council1);
        treasury.executeSpending(proposalId);
        assertTrue(treasury.getProposal(proposalId).executed);
    }
}
