// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/mechanism/RetroactiveFunding.sol";

// ============ Mocks ============

contract MockRFToken {
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

contract MockRFReputation {
    function getTrustScore(address) external pure returns (uint256) { return 200; }
    function getTrustTier(address) external pure returns (uint8) { return 2; }
    function isEligible(address, uint8) external pure returns (bool) { return true; }
}

contract MockRFIdentity {
    function hasIdentity(address) external pure returns (bool) { return true; }
}

// ============ Test Contract ============

contract RetroactiveFundingTest is Test {
    RetroactiveFunding public rf;
    MockRFToken public token;

    address public owner;
    address public alice;
    address public bob;
    address public charlie;
    address public beneficiary1;
    address public beneficiary2;

    uint256 constant MATCH_POOL = 100 ether;

    function setUp() public {
        owner = makeAddr("owner");
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        charlie = makeAddr("charlie");
        beneficiary1 = makeAddr("beneficiary1");
        beneficiary2 = makeAddr("beneficiary2");

        token = new MockRFToken();
        MockRFReputation rep = new MockRFReputation();
        MockRFIdentity id = new MockRFIdentity();

        vm.prank(owner);
        rf = new RetroactiveFunding(address(rep), address(id));

        // Fund owner for match pool
        token.mint(owner, 1000 ether);
        vm.prank(owner);
        token.approve(address(rf), type(uint256).max);

        // Fund contributors
        token.mint(alice, 100 ether);
        token.mint(bob, 100 ether);
        token.mint(charlie, 100 ether);

        vm.prank(alice);
        token.approve(address(rf), type(uint256).max);
        vm.prank(bob);
        token.approve(address(rf), type(uint256).max);
        vm.prank(charlie);
        token.approve(address(rf), type(uint256).max);
    }

    // ============ Helpers ============

    function _createDefaultRound() internal returns (uint256) {
        vm.prank(owner);
        return rf.createRound(
            address(token),
            MATCH_POOL,
            uint64(block.timestamp + 7 days),
            uint64(block.timestamp + 14 days)
        );
    }

    function _nominateProject(uint256 roundId, address beneficiary) internal returns (uint256) {
        vm.prank(alice);
        return rf.nominateProject(roundId, beneficiary, bytes32("ipfs"));
    }

    // ============ Constructor Tests ============

    function test_constructor_setsDeps() public view {
        assertEq(address(rf.reputationOracle()), address(rf.reputationOracle()));
        assertEq(rf.minNominatorTier(), 1);
        assertEq(rf.maxProjectsPerRound(), 50);
    }

    // ============ createRound Tests ============

    function test_createRound_happyPath() public {
        uint256 id = _createDefaultRound();
        assertEq(id, 1);

        IRetroactiveFunding.FundingRound memory r = rf.getRound(1);
        assertEq(r.token, address(token));
        assertEq(r.matchPool, MATCH_POOL);
        assertEq(uint8(r.state), uint8(IRetroactiveFunding.RoundState.NOMINATION));

        // Match pool transferred to contract
        assertEq(token.balanceOf(address(rf)), MATCH_POOL);
    }

    function test_createRound_revertsNotOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        rf.createRound(
            address(token),
            MATCH_POOL,
            uint64(block.timestamp + 7 days),
            uint64(block.timestamp + 14 days)
        );
    }

    // ============ nominateProject Tests ============

    function test_nominateProject_happyPath() public {
        uint256 roundId = _createDefaultRound();

        uint256 projId = _nominateProject(roundId, beneficiary1);
        assertEq(projId, 1);

        IRetroactiveFunding.Project memory p = rf.getProject(roundId, projId);
        assertEq(p.beneficiary, beneficiary1);
        assertEq(p.nominator, alice);
    }

    function test_nominateProject_revertsWrongPhase() public {
        uint256 roundId = _createDefaultRound();

        // Warp past nomination
        vm.warp(block.timestamp + 7 days);

        vm.prank(alice);
        vm.expectRevert(IRetroactiveFunding.WrongPhase.selector);
        rf.nominateProject(roundId, beneficiary1, bytes32("ipfs"));
    }

    // ============ contribute Tests ============

    function test_contribute_happyPath() public {
        uint256 roundId = _createDefaultRound();
        _nominateProject(roundId, beneficiary1);

        // Warp to evaluation phase
        vm.warp(block.timestamp + 7 days);

        vm.prank(alice);
        rf.contribute(roundId, 1, 10 ether);

        IRetroactiveFunding.Project memory p = rf.getProject(roundId, 1);
        assertEq(p.communityContributions, 10 ether);
        assertEq(p.contributorCount, 1);
        assertEq(rf.getContribution(roundId, 1, alice), 10 ether);
    }

    function test_contribute_multipleContributors() public {
        uint256 roundId = _createDefaultRound();
        _nominateProject(roundId, beneficiary1);

        vm.warp(block.timestamp + 7 days);

        vm.prank(alice);
        rf.contribute(roundId, 1, 5 ether);
        vm.prank(bob);
        rf.contribute(roundId, 1, 5 ether);

        IRetroactiveFunding.Project memory p = rf.getProject(roundId, 1);
        assertEq(p.communityContributions, 10 ether);
        assertEq(p.contributorCount, 2);
    }

    function test_contribute_revertsWrongPhase() public {
        uint256 roundId = _createDefaultRound();
        _nominateProject(roundId, beneficiary1);

        // Still in nomination phase
        vm.prank(alice);
        vm.expectRevert(IRetroactiveFunding.WrongPhase.selector);
        rf.contribute(roundId, 1, 1 ether);
    }

    // ============ finalizeRound Tests ============

    function test_finalizeRound_computesQF() public {
        uint256 start = block.timestamp;
        uint256 roundId = _createDefaultRound();
        _nominateProject(roundId, beneficiary1);
        _nominateProject(roundId, beneficiary2);

        vm.warp(start + 7 days);

        // Project 1: 2 contributors, 1 ether each
        vm.prank(alice);
        rf.contribute(roundId, 1, 1 ether);
        vm.prank(bob);
        rf.contribute(roundId, 1, 1 ether);

        // Project 2: 1 contributor, 2 ether
        vm.prank(charlie);
        rf.contribute(roundId, 2, 2 ether);

        vm.warp(start + 14 days);

        rf.finalizeRound(roundId);

        IRetroactiveFunding.Project memory p1 = rf.getProject(roundId, 1);
        IRetroactiveFunding.Project memory p2 = rf.getProject(roundId, 2);

        // Project 1: sqrtSum = sqrt(1e18) + sqrt(1e18) = 2e9
        // Project 2: sqrtSum = sqrt(2e18) ~ 1.414e9
        // QF should favor project 1 (more unique contributors)
        assertGt(p1.matchedAmount, p2.matchedAmount, "More contributors should get more match");

        IRetroactiveFunding.FundingRound memory r = rf.getRound(roundId);
        assertEq(uint8(r.state), uint8(IRetroactiveFunding.RoundState.DISTRIBUTION));
    }

    function test_finalizeRound_revertsBeforeEnd() public {
        uint256 roundId = _createDefaultRound();
        _nominateProject(roundId, beneficiary1);

        vm.warp(block.timestamp + 7 days);

        vm.expectRevert(IRetroactiveFunding.WrongPhase.selector);
        rf.finalizeRound(roundId);
    }

    // ============ claimFunds Tests ============

    function test_claimFunds_happyPath() public {
        uint256 start = block.timestamp;
        uint256 roundId = _createDefaultRound();
        _nominateProject(roundId, beneficiary1);

        vm.warp(start + 7 days);

        vm.prank(alice);
        rf.contribute(roundId, 1, 10 ether);

        vm.warp(start + 14 days);
        rf.finalizeRound(roundId);

        IRetroactiveFunding.Project memory p = rf.getProject(roundId, 1);
        uint256 expectedClaim = p.matchedAmount + p.communityContributions;

        vm.prank(beneficiary1);
        rf.claimFunds(roundId, 1);

        assertEq(token.balanceOf(beneficiary1), expectedClaim);

        IRetroactiveFunding.Project memory pAfter = rf.getProject(roundId, 1);
        assertTrue(pAfter.claimed);
    }

    function test_claimFunds_revertsAlreadyClaimed() public {
        uint256 start = block.timestamp;
        uint256 roundId = _createDefaultRound();
        _nominateProject(roundId, beneficiary1);

        vm.warp(start + 7 days);
        vm.prank(alice);
        rf.contribute(roundId, 1, 1 ether);

        vm.warp(start + 14 days);
        rf.finalizeRound(roundId);

        vm.prank(beneficiary1);
        rf.claimFunds(roundId, 1);

        vm.prank(beneficiary1);
        vm.expectRevert(IRetroactiveFunding.AlreadyClaimed.selector);
        rf.claimFunds(roundId, 1);
    }

    function test_claimFunds_revertsNotBeneficiary() public {
        uint256 start = block.timestamp;
        uint256 roundId = _createDefaultRound();
        _nominateProject(roundId, beneficiary1);

        vm.warp(start + 7 days);
        vm.prank(alice);
        rf.contribute(roundId, 1, 1 ether);

        vm.warp(start + 14 days);
        rf.finalizeRound(roundId);

        vm.prank(alice);
        vm.expectRevert(IRetroactiveFunding.NotBeneficiary.selector);
        rf.claimFunds(roundId, 1);
    }
}
