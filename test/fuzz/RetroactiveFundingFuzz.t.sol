// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/RetroactiveFunding.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

// ============ Mocks ============

contract MockRFFToken {
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

contract MockRFFReputation {
    function getTrustScore(address) external pure returns (uint256) { return 200; }
    function getTrustTier(address) external pure returns (uint8) { return 2; }
    function isEligible(address, uint8) external pure returns (bool) { return true; }
}

contract MockRFFIdentity {
    function hasIdentity(address) external pure returns (bool) { return true; }
}

// ============ Fuzz Tests ============

contract RetroactiveFundingFuzzTest is Test {
    RetroactiveFunding public rf;
    MockRFFToken public token;

    address public owner;
    address public alice;
    address public bob;
    address public beneficiary;

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        beneficiary = makeAddr("beneficiary");

        token = new MockRFFToken();
        MockRFFReputation rep = new MockRFFReputation();
        MockRFFIdentity id = new MockRFFIdentity();

        rf = new RetroactiveFunding(address(rep), address(id));

        token.mint(owner, type(uint128).max);
        token.approve(address(rf), type(uint256).max);

        token.mint(alice, type(uint128).max);
        vm.prank(alice);
        token.approve(address(rf), type(uint256).max);

        token.mint(bob, type(uint128).max);
        vm.prank(bob);
        token.approve(address(rf), type(uint256).max);
    }

    // ============ Fuzz: total distributed <= match pool ============

    function testFuzz_totalDistributedLeqMatchPool(uint256 matchPool, uint256 c1, uint256 c2) public {
        matchPool = bound(matchPool, 1 ether, 1_000_000 ether);
        c1 = bound(c1, 0.01 ether, 10_000 ether);
        c2 = bound(c2, 0.01 ether, 10_000 ether);

        uint256 start = block.timestamp;
        uint256 roundId = rf.createRound(
            address(token),
            matchPool,
            uint64(start + 7 days),
            uint64(start + 14 days)
        );

        rf.nominateProject(roundId, beneficiary, bytes32("ipfs1"));
        rf.nominateProject(roundId, makeAddr("ben2"), bytes32("ipfs2"));

        vm.warp(start + 7 days);

        vm.prank(alice);
        rf.contribute(roundId, 1, c1);
        vm.prank(bob);
        rf.contribute(roundId, 2, c2);

        vm.warp(start + 14 days);

        rf.finalizeRound(roundId);

        IRetroactiveFunding.FundingRound memory r = rf.getRound(roundId);
        assertLe(r.totalDistributed, r.matchPool, "Distributed must be <= match pool");
    }

    // ============ Fuzz: more unique contributors = higher QF match ============

    function testFuzz_moreContributorsHigherMatch(uint256 amount) public {
        amount = bound(amount, 1 ether, 100_000 ether);

        uint256 start = block.timestamp;
        uint256 roundId = rf.createRound(
            address(token),
            100 ether,
            uint64(start + 7 days),
            uint64(start + 14 days)
        );

        address ben1 = makeAddr("ben1");
        address ben2 = makeAddr("ben2");
        rf.nominateProject(roundId, ben1, bytes32("p1"));
        rf.nominateProject(roundId, ben2, bytes32("p2"));

        vm.warp(start + 7 days);

        // Project 1: 2 contributors split amount equally
        uint256 half = amount / 2;
        if (half == 0) half = 1;
        vm.prank(alice);
        rf.contribute(roundId, 1, half);
        vm.prank(bob);
        rf.contribute(roundId, 1, half);

        // Project 2: 1 contributor with same total
        address solo = makeAddr("solo");
        token.mint(solo, amount);
        vm.prank(solo);
        token.approve(address(rf), type(uint256).max);
        vm.prank(solo);
        rf.contribute(roundId, 2, half * 2);

        vm.warp(start + 14 days);
        rf.finalizeRound(roundId);

        IRetroactiveFunding.Project memory p1 = rf.getProject(roundId, 1);
        IRetroactiveFunding.Project memory p2 = rf.getProject(roundId, 2);

        // QF: 2 contributors of half each -> sqrtSum = 2*sqrt(half)
        // vs 1 contributor of full -> sqrtSum = sqrt(2*half)
        // 2*sqrt(half) > sqrt(2*half) always, so p1 match > p2 match
        assertGe(p1.matchedAmount, p2.matchedAmount, "Split contributions should get >= match");
    }

    // ============ Fuzz: contribution increases project score ============

    function testFuzz_contributionIncreasesScore(uint256 c1, uint256 c2) public {
        c1 = bound(c1, 0.01 ether, 100_000 ether);
        c2 = bound(c2, 0.01 ether, 100_000 ether);

        uint256 start = block.timestamp;
        uint256 roundId = rf.createRound(
            address(token),
            100 ether,
            uint64(start + 7 days),
            uint64(start + 14 days)
        );

        rf.nominateProject(roundId, beneficiary, bytes32("ipfs"));

        vm.warp(start + 7 days);

        vm.prank(alice);
        rf.contribute(roundId, 1, c1);

        IRetroactiveFunding.Project memory pBefore = rf.getProject(roundId, 1);
        uint256 sqrtSumBefore = pBefore.sqrtSum;

        vm.prank(bob);
        rf.contribute(roundId, 1, c2);

        IRetroactiveFunding.Project memory pAfter = rf.getProject(roundId, 1);
        assertGt(pAfter.sqrtSum, sqrtSumBefore, "New contributor must increase sqrtSum");
    }

    // ============ Fuzz: claim returns exact matched + community ============

    function testFuzz_claimReturnsExactAmount(uint256 matchPool, uint256 contribution) public {
        matchPool = bound(matchPool, 1 ether, 1_000_000 ether);
        contribution = bound(contribution, 0.01 ether, 10_000 ether);

        uint256 start = block.timestamp;
        uint256 roundId = rf.createRound(
            address(token),
            matchPool,
            uint64(start + 7 days),
            uint64(start + 14 days)
        );

        rf.nominateProject(roundId, beneficiary, bytes32("ipfs"));

        vm.warp(start + 7 days);
        vm.prank(alice);
        rf.contribute(roundId, 1, contribution);

        vm.warp(start + 14 days);
        rf.finalizeRound(roundId);

        IRetroactiveFunding.Project memory p = rf.getProject(roundId, 1);
        uint256 expectedClaim = p.matchedAmount + p.communityContributions;

        uint256 balBefore = token.balanceOf(beneficiary);
        vm.prank(beneficiary);
        rf.claimFunds(roundId, 1);
        uint256 balAfter = token.balanceOf(beneficiary);

        assertEq(balAfter - balBefore, expectedClaim, "Claim must return exact amount");
    }

    // ============ Fuzz: repeat contributor sqrt handled correctly ============

    function testFuzz_repeatContributorSqrt(uint256 c1, uint256 c2) public {
        c1 = bound(c1, 0.01 ether, 100_000 ether);
        c2 = bound(c2, 0.01 ether, 100_000 ether);

        uint256 start = block.timestamp;
        uint256 roundId = rf.createRound(
            address(token),
            100 ether,
            uint64(start + 7 days),
            uint64(start + 14 days)
        );

        rf.nominateProject(roundId, beneficiary, bytes32("ipfs"));

        vm.warp(start + 7 days);

        // Contribute twice from same person
        vm.prank(alice);
        rf.contribute(roundId, 1, c1);
        vm.prank(alice);
        rf.contribute(roundId, 1, c2);

        IRetroactiveFunding.Project memory p = rf.getProject(roundId, 1);

        // sqrtSum should be sqrt(c1 + c2), not sqrt(c1) + sqrt(c2)
        uint256 expectedSqrt = Math.sqrt(c1 + c2);
        assertEq(p.sqrtSum, expectedSqrt, "Repeat contributor: sqrtSum = sqrt(total)");
        assertEq(p.contributorCount, 1, "Should count as 1 contributor");
    }
}
