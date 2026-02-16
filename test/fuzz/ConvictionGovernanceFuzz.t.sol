// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/ConvictionGovernance.sol";

// ============ Mocks ============

contract MockCGFToken {
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
        require(balanceOf[msg.sender] >= amount);
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount);
        require(allowance[from][msg.sender] >= amount);
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        allowance[from][msg.sender] -= amount;
        return true;
    }
}

contract MockCGFReputation {
    function getTrustScore(address) external pure returns (uint256) { return 200; }
    function getTrustTier(address) external pure returns (uint8) { return 2; }
    function isEligible(address, uint8) external pure returns (bool) { return true; }
}

contract MockCGFIdentity {
    function hasIdentity(address) external pure returns (bool) { return true; }
}

// ============ Fuzz Tests ============

contract ConvictionGovernanceFuzzTest is Test {
    ConvictionGovernance public cg;
    MockCGFToken public jul;

    address public alice;
    address public bob;

    function setUp() public {
        alice = makeAddr("alice");
        bob = makeAddr("bob");

        jul = new MockCGFToken();
        MockCGFReputation rep = new MockCGFReputation();
        MockCGFIdentity id = new MockCGFIdentity();

        cg = new ConvictionGovernance(address(jul), address(rep), address(id));
        cg.setBaseThreshold(100);
        cg.setThresholdMultiplier(0);

        jul.mint(alice, type(uint128).max);
        jul.mint(bob, type(uint128).max);
        vm.prank(alice);
        jul.approve(address(cg), type(uint256).max);
        vm.prank(bob);
        jul.approve(address(cg), type(uint256).max);
    }

    // ============ Fuzz: conviction monotonically increases with time ============

    function testFuzz_convictionMonotonicWithTime(uint256 stake, uint256 timeElapsed) public {
        stake = bound(stake, 1 ether, 1_000_000 ether);
        timeElapsed = bound(timeElapsed, 1, 30 days);

        vm.prank(alice);
        uint256 id = cg.createProposal("Fuzz", bytes32("ipfs"), 1000 ether);

        vm.prank(bob);
        cg.signalConviction(id, stake);

        uint256 conv1 = cg.getConviction(id);

        vm.warp(block.timestamp + timeElapsed);
        uint256 conv2 = cg.getConviction(id);

        assertGe(conv2, conv1, "Conviction must be monotonically non-decreasing");
    }

    // ============ Fuzz: conviction proportional to stake ============

    function testFuzz_convictionProportionalToStake(uint256 stake1, uint256 timeElapsed) public {
        stake1 = bound(stake1, 1 ether, 500_000 ether);
        uint256 stake2 = stake1 * 2;
        timeElapsed = bound(timeElapsed, 1 days, 15 days);

        vm.prank(alice);
        uint256 id1 = cg.createProposal("P1", bytes32("ipfs"), 1000 ether);
        vm.prank(alice);
        uint256 id2 = cg.createProposal("P2", bytes32("ipfs2"), 1000 ether);

        vm.prank(alice);
        cg.signalConviction(id1, stake1);
        vm.prank(bob);
        cg.signalConviction(id2, stake2);

        vm.warp(block.timestamp + timeElapsed);

        uint256 conv1 = cg.getConviction(id1);
        uint256 conv2 = cg.getConviction(id2);

        // conv2 should be ~2x conv1
        assertApproxEqRel(conv2, conv1 * 2, 0.01e18, "Double stake should give double conviction");
    }

    // ============ Fuzz: removal restores exact token balance ============

    function testFuzz_removeSignalRestoresBalance(uint256 stake) public {
        stake = bound(stake, 1 ether, 1_000_000 ether);

        vm.prank(alice);
        uint256 id = cg.createProposal("Fuzz", bytes32("ipfs"), 1000 ether);

        uint256 balBefore = jul.balanceOf(bob);
        vm.prank(bob);
        cg.signalConviction(id, stake);

        vm.warp(block.timestamp + 5 days);

        vm.prank(bob);
        cg.removeSignal(id);
        uint256 balAfter = jul.balanceOf(bob);

        assertEq(balAfter, balBefore, "Remove signal must return exact stake");
    }

    // ============ Fuzz: conviction zero after removing all stake ============

    function testFuzz_convictionZeroAfterRemoval(uint256 stake) public {
        stake = bound(stake, 1 ether, 1_000_000 ether);

        vm.prank(alice);
        uint256 id = cg.createProposal("Fuzz", bytes32("ipfs"), 1000 ether);

        vm.prank(bob);
        cg.signalConviction(id, stake);

        vm.warp(block.timestamp + 5 days);

        vm.prank(bob);
        cg.removeSignal(id);

        uint256 conv = cg.getConviction(id);
        assertEq(conv, 0, "Conviction must be 0 after all stake removed");
    }

    // ============ Fuzz: dynamic threshold scales with requested amount ============

    function testFuzz_thresholdScalesWithAmount(uint256 amount1, uint256 multiplier) public {
        amount1 = bound(amount1, 1 ether, 1_000_000 ether);
        multiplier = bound(multiplier, 1, 10000);
        uint256 amount2 = amount1 * 2;

        cg.setThresholdMultiplier(multiplier);

        vm.prank(alice);
        uint256 id1 = cg.createProposal("P1", bytes32("ipfs"), amount1);
        vm.prank(alice);
        uint256 id2 = cg.createProposal("P2", bytes32("ipfs2"), amount2);

        uint256 t1 = cg.getThreshold(id1);
        uint256 t2 = cg.getThreshold(id2);

        if (multiplier > 0) {
            assertGt(t2, t1, "Larger ask -> higher threshold");
        }
    }

    // ============ Fuzz: conviction caps at proposal deadline ============

    function testFuzz_convictionCapsAtDeadline(uint256 stake, uint256 extraTime) public {
        stake = bound(stake, 1 ether, 1_000_000 ether);
        extraTime = bound(extraTime, 1, 365 days);

        vm.prank(alice);
        uint256 id = cg.createProposal("Fuzz", bytes32("ipfs"), 1000 ether);

        vm.prank(bob);
        cg.signalConviction(id, stake);

        IConvictionGovernance.GovernanceProposal memory p = cg.getProposal(id);
        uint256 deadline = uint256(p.startTime) + uint256(p.maxDuration);

        vm.warp(deadline);
        uint256 convAtDeadline = cg.getConviction(id);

        vm.warp(deadline + extraTime);
        uint256 convAfter = cg.getConviction(id);

        assertEq(convAfter, convAtDeadline, "Conviction must cap at deadline");
    }
}
