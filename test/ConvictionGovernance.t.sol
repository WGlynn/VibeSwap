// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/mechanism/ConvictionGovernance.sol";

// ============ Mocks ============

contract MockCGToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient");
        require(allowance[from][msg.sender] >= amount, "Allowance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        allowance[from][msg.sender] -= amount;
        return true;
    }
}

contract MockCGReputation {
    mapping(address => uint8) public tiers;
    function setTier(address user, uint8 tier) external { tiers[user] = tier; }
    function getTrustScore(address user) external view returns (uint256) { return uint256(tiers[user]) * 100; }
    function getTrustTier(address user) external view returns (uint8) { return tiers[user]; }
    function isEligible(address user, uint8 requiredTier) external view returns (bool) { return tiers[user] >= requiredTier; }
}

contract MockCGIdentity {
    mapping(address => bool) public identities;
    function grantIdentity(address user) external { identities[user] = true; }
    function hasIdentity(address addr) external view returns (bool) { return identities[addr]; }
}

// ============ Test Contract ============

contract ConvictionGovernanceTest is Test {
    // ============ Re-declare events ============

    event ProposalCreated(uint256 indexed proposalId, address indexed proposer, string description, uint256 requestedAmount, uint64 maxDuration);
    event ConvictionSignaled(uint256 indexed proposalId, address indexed staker, uint256 amount);
    event ConvictionRemoved(uint256 indexed proposalId, address indexed staker, uint256 amount);
    event ProposalPassed(uint256 indexed proposalId, uint256 conviction, uint256 threshold);
    event ProposalExecuted(uint256 indexed proposalId);
    event ProposalExpired(uint256 indexed proposalId);

    // ============ State ============

    ConvictionGovernance public cg;
    MockCGToken public jul;
    MockCGReputation public reputation;
    MockCGIdentity public identity;

    address public alice;
    address public bob;
    address public charlie;
    address public owner;

    uint256 constant BALANCE = 100_000 ether;

    // ============ setUp ============

    function setUp() public {
        owner = makeAddr("owner");
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        charlie = makeAddr("charlie");

        jul = new MockCGToken();
        reputation = new MockCGReputation();
        identity = new MockCGIdentity();

        vm.prank(owner);
        cg = new ConvictionGovernance(address(jul), address(reputation), address(identity));

        identity.grantIdentity(alice);
        identity.grantIdentity(bob);
        identity.grantIdentity(charlie);
        reputation.setTier(alice, 2);
        reputation.setTier(bob, 2);
        reputation.setTier(charlie, 2);

        jul.mint(alice, BALANCE);
        jul.mint(bob, BALANCE);
        jul.mint(charlie, BALANCE);

        vm.prank(alice);
        jul.approve(address(cg), type(uint256).max);
        vm.prank(bob);
        jul.approve(address(cg), type(uint256).max);
        vm.prank(charlie);
        jul.approve(address(cg), type(uint256).max);

        // Lower thresholds for testing
        vm.startPrank(owner);
        cg.setBaseThreshold(100);
        cg.setThresholdMultiplier(0);
        vm.stopPrank();
    }

    function _createProposal(uint256 amount) internal returns (uint256) {
        vm.prank(alice);
        return cg.createProposal("Test Proposal", bytes32("ipfs"), amount);
    }

    // ============ Constructor Tests ============

    function test_constructor_setsOwner() public view {
        assertEq(cg.owner(), owner);
    }

    function test_constructor_setsDeps() public view {
        assertEq(address(cg.julToken()), address(jul));
        assertEq(address(cg.reputationOracle()), address(reputation));
        assertEq(address(cg.soulboundIdentity()), address(identity));
    }

    // ============ createProposal Tests ============

    function test_createProposal_happyPath() public {
        uint256 id = _createProposal(1000 ether);
        assertEq(id, 1);

        IConvictionGovernance.GovernanceProposal memory p = cg.getProposal(1);
        assertEq(p.proposer, alice);
        assertEq(p.requestedAmount, 1000 ether);
        assertEq(uint8(p.state), uint8(IConvictionGovernance.GovernanceProposalState.ACTIVE));
    }

    function test_createProposal_revertsZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(IConvictionGovernance.ZeroRequestedAmount.selector);
        cg.createProposal("Fail", bytes32(0), 0);
    }

    function test_createProposal_revertsNoIdentity() public {
        address noId = makeAddr("noId");
        reputation.setTier(noId, 2);
        vm.prank(noId);
        vm.expectRevert(IConvictionGovernance.NoIdentity.selector);
        cg.createProposal("Fail", bytes32(0), 100 ether);
    }

    // ============ signalConviction Tests ============

    function test_signalConviction_happyPath() public {
        uint256 id = _createProposal(1000 ether);

        uint256 balBefore = jul.balanceOf(bob);
        vm.prank(bob);
        cg.signalConviction(id, 500 ether);
        uint256 balAfter = jul.balanceOf(bob);

        assertEq(balBefore - balAfter, 500 ether);

        IConvictionGovernance.StakerPosition memory pos = cg.getStakerPosition(id, bob);
        assertEq(pos.amount, 500 ether);
    }

    function test_signalConviction_revertsAlreadyStaking() public {
        uint256 id = _createProposal(1000 ether);

        vm.prank(bob);
        cg.signalConviction(id, 100 ether);

        vm.prank(bob);
        vm.expectRevert(IConvictionGovernance.AlreadyStaking.selector);
        cg.signalConviction(id, 100 ether);
    }

    function test_signalConviction_revertsZeroAmount() public {
        uint256 id = _createProposal(1000 ether);

        vm.prank(bob);
        vm.expectRevert(IConvictionGovernance.ZeroAmount.selector);
        cg.signalConviction(id, 0);
    }

    // ============ removeSignal Tests ============

    function test_removeSignal_returnsTokens() public {
        uint256 id = _createProposal(1000 ether);

        vm.prank(bob);
        cg.signalConviction(id, 500 ether);

        uint256 balBefore = jul.balanceOf(bob);
        vm.prank(bob);
        cg.removeSignal(id);
        uint256 balAfter = jul.balanceOf(bob);

        assertEq(balAfter - balBefore, 500 ether);
    }

    function test_removeSignal_revertsNotStaking() public {
        uint256 id = _createProposal(1000 ether);

        vm.prank(bob);
        vm.expectRevert(IConvictionGovernance.NotStaking.selector);
        cg.removeSignal(id);
    }

    // ============ Conviction Math Tests ============

    function test_conviction_growsOverTime() public {
        uint256 id = _createProposal(1000 ether);

        vm.prank(bob);
        cg.signalConviction(id, 100 ether);

        uint256 conv1 = cg.getConviction(id);

        vm.warp(block.timestamp + 1 days);
        uint256 conv2 = cg.getConviction(id);

        assertGt(conv2, conv1, "Conviction must grow over time");
    }

    function test_conviction_proportionalToStake() public {
        uint256 id1 = _createProposal(1000 ether);
        uint256 id2 = _createProposal(1000 ether);

        vm.prank(bob);
        cg.signalConviction(id1, 100 ether);
        vm.prank(charlie);
        cg.signalConviction(id2, 200 ether);

        vm.warp(block.timestamp + 10 days);

        uint256 conv1 = cg.getConviction(id1);
        uint256 conv2 = cg.getConviction(id2);

        // conv2 should be ~2x conv1 (same time, 2x stake)
        assertApproxEqRel(conv2, conv1 * 2, 0.01e18, "Double stake should give double conviction");
    }

    function test_conviction_capsAtDeadline() public {
        uint256 id = _createProposal(1000 ether);

        vm.prank(bob);
        cg.signalConviction(id, 100 ether);

        // Warp to exactly deadline
        IConvictionGovernance.GovernanceProposal memory p = cg.getProposal(id);
        uint256 deadline = uint256(p.startTime) + uint256(p.maxDuration);
        vm.warp(deadline);
        uint256 convAtDeadline = cg.getConviction(id);

        // Warp past deadline
        vm.warp(deadline + 30 days);
        uint256 convPastDeadline = cg.getConviction(id);

        assertEq(convPastDeadline, convAtDeadline, "Conviction must cap at deadline");
    }

    // ============ triggerPass Tests ============

    function test_triggerPass_succeeds() public {
        uint256 id = _createProposal(1000 ether);

        vm.prank(bob);
        cg.signalConviction(id, 1000 ether);

        // Warp to accumulate conviction past threshold
        vm.warp(block.timestamp + 10 days);

        cg.triggerPass(id);

        IConvictionGovernance.GovernanceProposal memory p = cg.getProposal(id);
        assertEq(uint8(p.state), uint8(IConvictionGovernance.GovernanceProposalState.PASSED));
    }

    function test_triggerPass_revertsThresholdNotMet() public {
        uint256 id = _createProposal(1000 ether);

        // No staking, no conviction
        vm.expectRevert(IConvictionGovernance.ThresholdNotMet.selector);
        cg.triggerPass(id);
    }

    // ============ executeProposal Tests ============

    function test_executeProposal_byOwner() public {
        uint256 id = _createProposal(1000 ether);
        vm.prank(bob);
        cg.signalConviction(id, 1000 ether);
        vm.warp(block.timestamp + 10 days);
        cg.triggerPass(id);

        vm.prank(owner);
        cg.executeProposal(id);

        IConvictionGovernance.GovernanceProposal memory p = cg.getProposal(id);
        assertEq(uint8(p.state), uint8(IConvictionGovernance.GovernanceProposalState.EXECUTED));
    }

    // ============ expireProposal Tests ============

    function test_expireProposal_afterDeadline() public {
        uint256 id = _createProposal(1000 ether);

        IConvictionGovernance.GovernanceProposal memory p = cg.getProposal(id);
        vm.warp(uint256(p.startTime) + uint256(p.maxDuration) + 1);

        cg.expireProposal(id);

        p = cg.getProposal(id);
        assertEq(uint8(p.state), uint8(IConvictionGovernance.GovernanceProposalState.EXPIRED));
    }

    function test_expireProposal_revertsBeforeDeadline() public {
        uint256 id = _createProposal(1000 ether);

        vm.expectRevert(IConvictionGovernance.ProposalNotExpired.selector);
        cg.expireProposal(id);
    }

    // ============ Dynamic Threshold Test ============

    function test_threshold_scalesWithRequestedAmount() public {
        vm.prank(owner);
        cg.setThresholdMultiplier(1000); // 10%

        uint256 id1 = _createProposal(100 ether);
        uint256 id2 = _createProposal(1000 ether);

        uint256 t1 = cg.getThreshold(id1);
        uint256 t2 = cg.getThreshold(id2);

        assertGt(t2, t1, "Bigger ask needs more conviction");
    }
}
