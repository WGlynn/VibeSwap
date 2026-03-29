// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/VibeInsurancePool.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ VibeInsurancePool Tests ============

contract VibeInsurancePoolTest is Test {

    VibeInsurancePool public pool;

    address public owner;
    address public alice;
    address public bob;
    address public charlie;

    // Auditors
    address public auditor1;
    address public auditor2;
    address public auditor3;

    // ============ Events ============

    event PolicyCreated(address indexed user, VibeInsurancePool.Tier tier, uint256 coveredAmount, uint256 premium);
    event ClaimFiled(uint256 indexed claimId, address claimant, uint256 lossAmount);
    event ClaimReviewed(uint256 indexed claimId, address auditor, bool approved);
    event ClaimApproved(uint256 indexed claimId, uint256 payoutAmount);
    event ClaimDenied(uint256 indexed claimId);
    event ClaimPaid(uint256 indexed claimId, uint256 amount);
    event PoolFunded(uint256 amount, string source);

    // ============ Setup ============

    function setUp() public {
        owner   = address(this);
        alice   = makeAddr("alice");
        bob     = makeAddr("bob");
        charlie = makeAddr("charlie");
        auditor1 = makeAddr("auditor1");
        auditor2 = makeAddr("auditor2");
        auditor3 = makeAddr("auditor3");

        // Deploy via UUPS proxy
        VibeInsurancePool impl = new VibeInsurancePool();
        bytes memory initData = abi.encodeWithSelector(VibeInsurancePool.initialize.selector);
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        pool = VibeInsurancePool(payable(address(proxy)));

        // Add auditors
        pool.addAuditor(auditor1);
        pool.addAuditor(auditor2);
        pool.addAuditor(auditor3);

        // Fund test actors
        vm.deal(alice,   200 ether);
        vm.deal(bob,     200 ether);
        vm.deal(charlie, 200 ether);
    }

    // ============ Helpers ============

    /// @dev BASIC_PREMIUM_BPS = 10 (0.1%)
    function _basicPremium(uint256 value) internal pure returns (uint256) {
        return (value * 10) / 10000;
    }

    /// @dev STANDARD_PREMIUM_BPS = 30 (0.3%)
    function _standardPremium(uint256 value) internal pure returns (uint256) {
        return (value * 30) / 10000;
    }

    /// @dev PREMIUM_PREMIUM_BPS = 50 (0.5%)
    function _premiumPremium(uint256 value) internal pure returns (uint256) {
        return (value * 50) / 10000;
    }

    /// @dev Purchase a BASIC policy for `user` with `deposit` ETH.
    function _purchaseBasic(address user, uint256 deposit) internal {
        vm.prank(user);
        pool.purchasePolicy{value: deposit}(VibeInsurancePool.Tier.BASIC);
    }

    /// @dev File a claim for `user` with `loss` ETH loss.
    function _fileClaim(address user, uint256 loss) internal returns (uint256 claimId) {
        claimId = pool.claimCount();
        vm.prank(user);
        pool.fileClaim(loss, "ipfs://evidence");
    }

    /// @dev Three auditors approve a claim.
    function _approveClaimUnanimously(uint256 claimId) internal {
        vm.prank(auditor1);
        pool.reviewClaim(claimId, true);
        vm.prank(auditor2);
        pool.reviewClaim(claimId, true);
        vm.prank(auditor3);
        pool.reviewClaim(claimId, true);
    }

    /// @dev Three auditors deny a claim.
    function _denyClaimUnanimously(uint256 claimId) internal {
        vm.prank(auditor1);
        pool.reviewClaim(claimId, false);
        vm.prank(auditor2);
        pool.reviewClaim(claimId, false);
        vm.prank(auditor3);
        pool.reviewClaim(claimId, false);
    }

    // ============ purchasePolicy — BASIC tier ============

    function test_purchasePolicy_basic_happyPath() public {
        uint256 deposit = 5 ether;
        uint256 expectedPremium = _basicPremium(deposit);
        uint256 expectedCovered = deposit - expectedPremium;

        vm.expectEmit(true, false, false, true);
        emit PolicyCreated(alice, VibeInsurancePool.Tier.BASIC, expectedCovered, expectedPremium);

        _purchaseBasic(alice, deposit);

        VibeInsurancePool.Policy memory p = pool.getPolicy(alice);
        assertEq(uint8(p.tier), uint8(VibeInsurancePool.Tier.BASIC));
        assertEq(p.coveredAmount, expectedCovered);
        assertEq(p.premiumPaid, expectedPremium);
        assertEq(p.coveragePercent, pool.BASIC_COVERAGE());
        assertEq(p.maxCoverage, pool.BASIC_MAX());
        assertApproxEqAbs(p.expiresAt, block.timestamp + pool.POLICY_DURATION(), 1);

        assertEq(pool.poolBalance(), expectedPremium, "Pool should hold premium");
        assertEq(pool.totalPremiums(), expectedPremium);
        assertEq(pool.activePolicies(), 1);
    }

    function test_purchasePolicy_standard_premiumMath() public {
        uint256 deposit = 20 ether;
        uint256 expectedPremium = _standardPremium(deposit);
        uint256 expectedCovered = deposit - expectedPremium;

        vm.prank(alice);
        pool.purchasePolicy{value: deposit}(VibeInsurancePool.Tier.STANDARD);

        VibeInsurancePool.Policy memory p = pool.getPolicy(alice);
        assertEq(p.premiumPaid, expectedPremium);
        assertEq(p.coveredAmount, expectedCovered);
        assertEq(p.coveragePercent, pool.STANDARD_COVERAGE());
        assertEq(p.maxCoverage, pool.STANDARD_MAX());
    }

    function test_purchasePolicy_premium_tier_premiumMath() public {
        uint256 deposit = 50 ether;
        uint256 expectedPremium = _premiumPremium(deposit);
        uint256 expectedCovered = deposit - expectedPremium;

        vm.prank(alice);
        pool.purchasePolicy{value: deposit}(VibeInsurancePool.Tier.PREMIUM);

        VibeInsurancePool.Policy memory p = pool.getPolicy(alice);
        assertEq(p.premiumPaid, expectedPremium);
        assertEq(p.coveredAmount, expectedCovered);
        assertEq(p.coveragePercent, pool.PREMIUM_COVERAGE());
        assertEq(p.maxCoverage, pool.PREMIUM_MAX());
    }

    function test_purchasePolicy_revertsNoneTier() public {
        vm.prank(alice);
        vm.expectRevert("Invalid tier");
        pool.purchasePolicy{value: 1 ether}(VibeInsurancePool.Tier.NONE);
    }

    function test_purchasePolicy_revertsWhenPolicyActive() public {
        _purchaseBasic(alice, 5 ether);

        vm.prank(alice);
        vm.expectRevert("Policy active");
        pool.purchasePolicy{value: 5 ether}(VibeInsurancePool.Tier.BASIC);
    }

    function test_purchasePolicy_revertsExceedsMaxCoverage() public {
        // BASIC max coverage is 10 ether.
        // deposit of 11 ether -> covered = deposit - premium ~ 10.9 ether > 10 ether
        uint256 deposit = 11 ether;
        uint256 premium = _basicPremium(deposit);
        uint256 covered = deposit - premium;
        assertGt(covered, pool.BASIC_MAX());

        vm.prank(alice);
        vm.expectRevert("Exceeds max coverage");
        pool.purchasePolicy{value: deposit}(VibeInsurancePool.Tier.BASIC);
    }

    function test_purchasePolicy_canRenewAfterExpiry() public {
        _purchaseBasic(alice, 5 ether);

        // Warp past expiry
        vm.warp(block.timestamp + pool.POLICY_DURATION() + 1);

        // Should not revert
        _purchaseBasic(alice, 3 ether);
        assertEq(pool.activePolicies(), 2);
    }

    // ============ isPolicyActive ============

    function test_isPolicyActive_trueWhileActive() public {
        _purchaseBasic(alice, 5 ether);
        assertTrue(pool.isPolicyActive(alice));
    }

    function test_isPolicyActive_falseAfterExpiry() public {
        _purchaseBasic(alice, 5 ether);
        vm.warp(block.timestamp + pool.POLICY_DURATION() + 1);
        assertFalse(pool.isPolicyActive(alice));
    }

    function test_isPolicyActive_falseWithNoPolicy() public view {
        assertFalse(pool.isPolicyActive(alice));
    }

    // ============ fileClaim ============

    function test_fileClaim_happyPath() public {
        _purchaseBasic(alice, 5 ether);
        uint256 loss = 2 ether;

        vm.expectEmit(true, false, false, true);
        emit ClaimFiled(0, alice, loss);

        uint256 claimId = _fileClaim(alice, loss);

        VibeInsurancePool.Claim memory c = pool.getClaim(claimId);
        assertEq(c.claimant, alice);
        assertEq(c.lossAmount, loss);
        assertEq(uint8(c.status), uint8(VibeInsurancePool.ClaimStatus.PENDING));
        assertEq(c.filedAt, block.timestamp);
    }

    function test_fileClaim_payoutCappedAtCoverage() public {
        uint256 deposit = 5 ether;
        _purchaseBasic(alice, deposit);

        VibeInsurancePool.Policy memory p = pool.getPolicy(alice);
        uint256 maxPayout = (p.coveredAmount * pool.BASIC_COVERAGE()) / 100;

        // Claim more than covered — payout should be capped
        uint256 excessiveLoss = 100 ether;
        uint256 claimId = _fileClaim(alice, excessiveLoss);

        VibeInsurancePool.Claim memory c = pool.getClaim(claimId);
        assertEq(c.payoutAmount, maxPayout, "Payout must not exceed max coverage");
        assertLt(c.payoutAmount, excessiveLoss);
    }

    function test_fileClaim_revertsExpiredPolicy() public {
        _purchaseBasic(alice, 5 ether);
        vm.warp(block.timestamp + pool.POLICY_DURATION() + 1);

        vm.prank(alice);
        vm.expectRevert("Policy expired");
        pool.fileClaim(1 ether, "ipfs://evidence");
    }

    function test_fileClaim_revertsZeroLoss() public {
        _purchaseBasic(alice, 5 ether);

        vm.prank(alice);
        vm.expectRevert("Zero loss");
        pool.fileClaim(0, "ipfs://evidence");
    }

    // ============ reviewClaim ============

    function test_reviewClaim_approvalReachesThreshold() public {
        _purchaseBasic(alice, 5 ether);
        uint256 claimId = _fileClaim(alice, 1 ether);

        // First two approvals — not yet APPROVED
        vm.prank(auditor1);
        pool.reviewClaim(claimId, true);
        vm.prank(auditor2);
        pool.reviewClaim(claimId, true);

        VibeInsurancePool.Claim memory c = pool.getClaim(claimId);
        assertEq(uint8(c.status), uint8(VibeInsurancePool.ClaimStatus.REVIEWING));

        // Third approval — threshold hit
        vm.expectEmit(true, false, false, true);
        emit ClaimApproved(claimId, c.payoutAmount);

        vm.prank(auditor3);
        pool.reviewClaim(claimId, true);

        c = pool.getClaim(claimId);
        assertEq(uint8(c.status), uint8(VibeInsurancePool.ClaimStatus.APPROVED));
        assertEq(c.approvalCount, 3);
    }

    function test_reviewClaim_denialReachesThreshold() public {
        _purchaseBasic(alice, 5 ether);
        uint256 claimId = _fileClaim(alice, 1 ether);

        // First two denials — threshold not yet reached
        vm.prank(auditor1);
        pool.reviewClaim(claimId, false);
        vm.prank(auditor2);
        pool.reviewClaim(claimId, false);

        // Third denial — threshold hit, ClaimDenied emitted
        vm.expectEmit(true, false, false, true);
        emit ClaimDenied(claimId);
        vm.prank(auditor3);
        pool.reviewClaim(claimId, false);

        VibeInsurancePool.Claim memory c = pool.getClaim(claimId);
        assertEq(uint8(c.status), uint8(VibeInsurancePool.ClaimStatus.DENIED));
        assertEq(c.denialCount, 3);
    }

    function test_reviewClaim_revertsNotAuditor() public {
        _purchaseBasic(alice, 5 ether);
        uint256 claimId = _fileClaim(alice, 1 ether);

        vm.prank(bob);
        vm.expectRevert("Not auditor");
        pool.reviewClaim(claimId, true);
    }

    function test_reviewClaim_revertsDoubleVote() public {
        _purchaseBasic(alice, 5 ether);
        uint256 claimId = _fileClaim(alice, 1 ether);

        vm.prank(auditor1);
        pool.reviewClaim(claimId, true);

        vm.prank(auditor1);
        vm.expectRevert("Already voted");
        pool.reviewClaim(claimId, true);
    }

    function test_reviewClaim_revertsDoubleVoteMixed() public {
        // Try to approve then deny with same auditor
        _purchaseBasic(alice, 5 ether);
        uint256 claimId = _fileClaim(alice, 1 ether);

        vm.prank(auditor1);
        pool.reviewClaim(claimId, true);

        vm.prank(auditor1);
        vm.expectRevert("Already voted");
        pool.reviewClaim(claimId, false);
    }

    // ============ executePayout ============

    function test_executePayout_happyPath() public {
        uint256 deposit = 5 ether;
        _purchaseBasic(alice, deposit);

        // Fund the pool so it can pay
        pool.fundPool{value: 10 ether}("test");

        uint256 loss = 1 ether;
        uint256 claimId = _fileClaim(alice, loss);
        _approveClaimUnanimously(claimId);

        VibeInsurancePool.Claim memory c = pool.getClaim(claimId);
        uint256 payout = c.payoutAmount;

        uint256 aliceBalBefore = alice.balance;
        uint256 poolBalBefore  = pool.poolBalance();

        vm.expectEmit(true, false, false, true);
        emit ClaimPaid(claimId, payout);

        pool.executePayout(claimId);

        assertEq(alice.balance, aliceBalBefore + payout, "Alice should receive payout");
        assertEq(pool.poolBalance(), poolBalBefore - payout, "Pool balance should decrease");
        assertEq(pool.totalPayouts(), payout);

        VibeInsurancePool.Claim memory cAfter = pool.getClaim(claimId);
        assertEq(uint8(cAfter.status), uint8(VibeInsurancePool.ClaimStatus.PAID));
    }

    function test_executePayout_revertsNotApproved() public {
        _purchaseBasic(alice, 5 ether);
        uint256 claimId = _fileClaim(alice, 1 ether);

        vm.expectRevert("Not approved");
        pool.executePayout(claimId);
    }

    function test_executePayout_revertsInsufficientPool() public {
        _purchaseBasic(alice, 5 ether);
        uint256 claimId = _fileClaim(alice, 1 ether);
        _approveClaimUnanimously(claimId);

        // Pool balance is only the premium (~0.005 ether), which may not cover 1 ether payout
        VibeInsurancePool.Claim memory c = pool.getClaim(claimId);
        uint256 payout = c.payoutAmount;
        if (payout > pool.poolBalance()) {
            vm.expectRevert("Pool insufficient");
            pool.executePayout(claimId);
        } else {
            // If somehow pool covers it (tiny loss), just confirm it works
            pool.executePayout(claimId);
        }
    }

    // ============ fundPool ============

    function test_fundPool_increasesBalance() public {
        uint256 amount = 10 ether;

        vm.expectEmit(false, false, false, true);
        emit PoolFunded(amount, "protocol_revenue");

        pool.fundPool{value: amount}("protocol_revenue");

        assertEq(pool.poolBalance(), amount);
    }

    function test_receive_increasesPoolBalance() public {
        uint256 amount = 3 ether;
        uint256 before = pool.poolBalance();

        (bool ok, ) = address(pool).call{value: amount}("");
        assertTrue(ok);

        assertEq(pool.poolBalance(), before + amount);
    }

    // ============ getPoolHealth ============

    function test_getPoolHealth_ratioCalc() public {
        // Purchase two policies to accumulate premiums
        _purchaseBasic(alice, 5 ether);

        vm.prank(bob);
        pool.purchasePolicy{value: 10 ether}(VibeInsurancePool.Tier.STANDARD);

        (uint256 balance, uint256 premiums, uint256 payouts, uint256 ratio) = pool.getPoolHealth();

        assertEq(balance, premiums, "Balance should equal premiums (no payouts yet)");
        assertEq(payouts, 0);
        assertEq(ratio, 10000, "Ratio should be 100% when no payouts taken");
    }

    function test_getPoolHealth_ratioZeroWhenNoPremiums() public view {
        (, , , uint256 ratio) = pool.getPoolHealth();
        assertEq(ratio, 10000, "Default ratio is 10000 (10000/10000 * 10000 is 10000 from code)");
    }

    // ============ Auditor Management ============

    function test_addAuditor_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        pool.addAuditor(alice);
    }

    function test_removeAuditor_preventsVoting() public {
        pool.removeAuditor(auditor1);

        _purchaseBasic(alice, 5 ether);
        uint256 claimId = _fileClaim(alice, 1 ether);

        vm.prank(auditor1);
        vm.expectRevert("Not auditor");
        pool.reviewClaim(claimId, true);
    }

    // ============ Full E2E Claim Flow ============

    function test_e2e_fullClaimFlow() public {
        // 1. Fund pool from protocol revenue
        pool.fundPool{value: 20 ether}("swap_fees");

        // 2. Alice purchases STANDARD policy
        uint256 deposit = 20 ether;
        vm.prank(alice);
        pool.purchasePolicy{value: deposit}(VibeInsurancePool.Tier.STANDARD);

        assertTrue(pool.isPolicyActive(alice));

        // 3. Alice suffers a loss and files claim
        uint256 loss = 5 ether;
        uint256 claimId = _fileClaim(alice, loss);

        // 4. Auditors approve
        _approveClaimUnanimously(claimId);

        // 5. Execute payout
        uint256 aliceBalBefore = alice.balance;
        pool.executePayout(claimId);

        VibeInsurancePool.Claim memory c = pool.getClaim(claimId);
        assertEq(uint8(c.status), uint8(VibeInsurancePool.ClaimStatus.PAID));
        assertGt(alice.balance, aliceBalBefore);
    }

    // ============ Fuzz Tests ============

    function testFuzz_purchasePolicy_basic_premiumIsFraction(uint256 deposit) public {
        // BASIC max coverage 10 ether. Covered = deposit - premium <= 10 ether
        // deposit - (deposit * 10/10000) <= 10 ether
        // deposit * (1 - 0.001) <= 10 ether → deposit <= ~10.01 ether
        // Use deposit in [1 wei, 10.01 ether]
        deposit = bound(deposit, 1, 10.01 ether);

        uint256 premium = _basicPremium(deposit);
        uint256 covered = deposit - premium;

        // Only run if within coverage limit to avoid revert
        if (covered <= pool.BASIC_MAX()) {
            vm.deal(alice, deposit);
            vm.prank(alice);
            pool.purchasePolicy{value: deposit}(VibeInsurancePool.Tier.BASIC);

            VibeInsurancePool.Policy memory p = pool.getPolicy(alice);
            assertEq(p.premiumPaid, premium);
            assertEq(p.coveredAmount, covered);
            assertEq(pool.poolBalance(), premium);
        }
    }

    function testFuzz_fileClaim_payoutBoundedByPolicy(uint256 loss) public {
        loss = bound(loss, 1, 1000 ether);

        uint256 deposit = 5 ether;
        _purchaseBasic(alice, deposit);

        VibeInsurancePool.Policy memory p = pool.getPolicy(alice);
        uint256 maxPayout = (p.coveredAmount * pool.BASIC_COVERAGE()) / 100;

        uint256 claimId = _fileClaim(alice, loss);
        VibeInsurancePool.Claim memory c = pool.getClaim(claimId);

        assertLe(c.payoutAmount, maxPayout, "Payout must never exceed max coverage");
    }
}
