// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/financial/VibeInsurancePool.sol";

contract VibeInsurancePoolTest is Test {
    VibeInsurancePool public pool;

    address alice = address(0xA1);
    address bob = address(0xB0);
    address voter1 = address(0xC1);
    address voter2 = address(0xC2);
    address voter3 = address(0xC3);

    function setUp() public {
        pool = new VibeInsurancePool();
        pool.initialize();

        vm.deal(alice, 1000 ether);
        vm.deal(bob, 1000 ether);
    }

    function _seedPool(uint256 amount) internal {
        pool.underwrite{value: amount}();
    }

    function _buyPolicy(address holder, uint256 coverage, uint256 durationDays)
        internal
        returns (uint256 policyId)
    {
        uint256 premium = (coverage * 250 * durationDays) / (10000 * 365); // Smart contract rate
        vm.deal(holder, holder.balance + premium + 1 ether);
        vm.prank(holder);
        policyId = pool.purchaseCoverage{value: premium}(
            VibeInsurancePool.RiskCategory.SMART_CONTRACT,
            coverage,
            durationDays
        );
    }

    // ============ Initialization ============

    function test_initialization() public view {
        assertEq(pool.maxCoverageRatioBps(), 5000);
        assertEq(pool.totalUnderwritten(), 0);
        assertEq(pool.totalShares(), 0);
        assertEq(pool.premiumRateBps(VibeInsurancePool.RiskCategory.SMART_CONTRACT), 250);
        assertEq(pool.premiumRateBps(VibeInsurancePool.RiskCategory.BRIDGE), 400);
        assertEq(pool.premiumRateBps(VibeInsurancePool.RiskCategory.DEPEGGING), 500);
    }

    // ============ Underwriting ============

    function test_underwrite() public {
        pool.underwrite{value: 100 ether}();

        assertEq(pool.totalUnderwritten(), 100 ether);
        assertEq(pool.totalShares(), 100 ether); // First deposit 1:1
    }

    function test_underwriteMultiple() public {
        pool.underwrite{value: 100 ether}();

        vm.prank(alice);
        pool.underwrite{value: 50 ether}();

        assertEq(pool.totalUnderwritten(), 150 ether);
    }

    function test_revertUnderwriteZero() public {
        vm.expectRevert("Zero deposit");
        pool.underwrite{value: 0}();
    }

    function test_withdrawUnderwriting() public {
        pool.underwrite{value: 100 ether}();

        vm.warp(block.timestamp + 30 days);

        uint256 balanceBefore = address(this).balance;
        pool.withdrawUnderwriting(100 ether);

        assertEq(address(this).balance, balanceBefore + 100 ether);
        assertEq(pool.totalUnderwritten(), 0);
    }

    function test_revertWithdrawBeforeLockPeriod() public {
        pool.underwrite{value: 100 ether}();

        vm.expectRevert("Lock period");
        pool.withdrawUnderwriting(50 ether);
    }

    function test_revertWithdrawExceedsCoverageRatio() public {
        pool.underwrite{value: 100 ether}();

        // Buy coverage for 50 ETH (max 50% of pool)
        _buyPolicy(alice, 40 ether, 30);

        vm.warp(block.timestamp + 30 days);

        // Try to withdraw all — would leave pool under active coverage
        vm.expectRevert("Would exceed coverage ratio");
        pool.withdrawUnderwriting(100 ether);
    }

    function test_revertWithdrawInsufficientShares() public {
        pool.underwrite{value: 100 ether}();

        vm.warp(block.timestamp + 30 days);

        vm.expectRevert("Insufficient shares");
        pool.withdrawUnderwriting(200 ether);
    }

    // ============ Coverage ============

    function test_purchaseCoverage() public {
        _seedPool(100 ether);

        uint256 policyId = _buyPolicy(alice, 10 ether, 30);

        assertEq(policyId, 1);
        assertEq(pool.policyCount(), 1);
        assertGt(pool.totalPremiums(), 0);
    }

    function test_purchaseCoverageRefundsExcess() public {
        _seedPool(100 ether);

        uint256 coverage = 10 ether;
        uint256 premium = (coverage * 250 * 30) / (10000 * 365);

        uint256 overpay = premium + 5 ether;
        uint256 balanceBefore = alice.balance;

        vm.prank(alice);
        pool.purchaseCoverage{value: overpay}(
            VibeInsurancePool.RiskCategory.SMART_CONTRACT,
            coverage,
            30
        );

        // Alice should have been refunded the excess
        assertEq(alice.balance, balanceBefore - premium);
    }

    function test_revertCoverageExceedsCapacity() public {
        _seedPool(100 ether);

        // Max coverage = 50% of 100 = 50 ETH
        vm.expectRevert("Exceeds capacity");
        _buyPolicy(alice, 60 ether, 30);
    }

    function test_revertCoverageInsufficientPremium() public {
        _seedPool(100 ether);

        vm.prank(alice);
        vm.expectRevert("Insufficient premium");
        pool.purchaseCoverage{value: 1 wei}(
            VibeInsurancePool.RiskCategory.BRIDGE,
            10 ether,
            30
        );
    }

    function test_coverageDifferentCategories() public {
        _seedPool(1000 ether);

        _buyPolicy(alice, 10 ether, 30); // SMART_CONTRACT

        // Bridge coverage
        uint256 bridgeCoverage = 5 ether;
        uint256 bridgePremium = (bridgeCoverage * 400 * 30) / (10000 * 365);
        vm.deal(bob, bob.balance + bridgePremium);
        vm.prank(bob);
        pool.purchaseCoverage{value: bridgePremium}(
            VibeInsurancePool.RiskCategory.BRIDGE,
            5 ether,
            30
        );

        assertEq(pool.activeCoverage(VibeInsurancePool.RiskCategory.SMART_CONTRACT), 10 ether);
        assertEq(pool.activeCoverage(VibeInsurancePool.RiskCategory.BRIDGE), 5 ether);
    }

    // ============ Claims ============

    function test_fileClaim() public {
        _seedPool(100 ether);
        uint256 policyId = _buyPolicy(alice, 10 ether, 30);

        vm.prank(alice);
        uint256 claimId = pool.fileClaim(policyId, 5 ether, "ipfs://evidence");

        assertEq(claimId, 1);
        assertEq(pool.claimCount(), 1);
    }

    function test_revertFileClaimNotHolder() public {
        _seedPool(100 ether);
        uint256 policyId = _buyPolicy(alice, 10 ether, 30);

        vm.prank(bob);
        vm.expectRevert("Not policy holder");
        pool.fileClaim(policyId, 5 ether, "ipfs://fake");
    }

    function test_revertFileClaimExceedsCoverage() public {
        _seedPool(100 ether);
        uint256 policyId = _buyPolicy(alice, 10 ether, 30);

        vm.prank(alice);
        vm.expectRevert("Exceeds coverage");
        pool.fileClaim(policyId, 20 ether, "ipfs://evidence");
    }

    function test_revertFileClaimExpiredPolicy() public {
        _seedPool(100 ether);
        uint256 policyId = _buyPolicy(alice, 10 ether, 30);

        vm.warp(block.timestamp + 31 days);

        vm.prank(alice);
        vm.expectRevert("Policy expired");
        pool.fileClaim(policyId, 5 ether, "ipfs://evidence");
    }

    // ============ Voting ============

    function test_voteOnClaim() public {
        _seedPool(100 ether);
        uint256 policyId = _buyPolicy(alice, 10 ether, 30);

        vm.prank(alice);
        uint256 claimId = pool.fileClaim(policyId, 5 ether, "ipfs://evidence");

        vm.prank(voter1);
        pool.voteOnClaim(claimId, true);

        vm.prank(voter2);
        pool.voteOnClaim(claimId, false);

        (,,,,, uint256 votesFor, uint256 votesAgainst, , , ) = pool.claims(claimId);
        assertEq(votesFor, 1);
        assertEq(votesAgainst, 1);
    }

    function test_revertDoubleVote() public {
        _seedPool(100 ether);
        uint256 policyId = _buyPolicy(alice, 10 ether, 30);

        vm.prank(alice);
        uint256 claimId = pool.fileClaim(policyId, 5 ether, "ipfs://evidence");

        vm.prank(voter1);
        pool.voteOnClaim(claimId, true);

        vm.prank(voter1);
        vm.expectRevert("Already voted");
        pool.voteOnClaim(claimId, true);
    }

    function test_revertVoteAfterDeadline() public {
        _seedPool(100 ether);
        uint256 policyId = _buyPolicy(alice, 10 ether, 30);

        vm.prank(alice);
        uint256 claimId = pool.fileClaim(policyId, 5 ether, "ipfs://evidence");

        vm.warp(block.timestamp + 8 days);

        vm.prank(voter1);
        vm.expectRevert("Deadline passed");
        pool.voteOnClaim(claimId, true);
    }

    // ============ Claim Resolution ============

    function test_resolveClaimApproved() public {
        _seedPool(100 ether);
        uint256 policyId = _buyPolicy(alice, 10 ether, 30);

        vm.prank(alice);
        uint256 claimId = pool.fileClaim(policyId, 5 ether, "ipfs://evidence");

        // 2 votes for, 1 against
        vm.prank(voter1);
        pool.voteOnClaim(claimId, true);
        vm.prank(voter2);
        pool.voteOnClaim(claimId, true);
        vm.prank(voter3);
        pool.voteOnClaim(claimId, false);

        vm.warp(block.timestamp + 8 days);

        uint256 aliceBefore = alice.balance;
        pool.resolveClaim(claimId);

        assertEq(alice.balance, aliceBefore + 5 ether);
        assertEq(pool.totalPayouts(), 5 ether);
    }

    function test_resolveClaimRejected() public {
        _seedPool(100 ether);
        uint256 policyId = _buyPolicy(alice, 10 ether, 30);

        vm.prank(alice);
        uint256 claimId = pool.fileClaim(policyId, 5 ether, "ipfs://evidence");

        // 2 votes against, 1 for
        vm.prank(voter1);
        pool.voteOnClaim(claimId, false);
        vm.prank(voter2);
        pool.voteOnClaim(claimId, false);
        vm.prank(voter3);
        pool.voteOnClaim(claimId, true);

        vm.warp(block.timestamp + 8 days);

        uint256 aliceBefore = alice.balance;
        pool.resolveClaim(claimId);

        assertEq(alice.balance, aliceBefore); // No payout
        assertEq(pool.totalPayouts(), 0);
    }

    function test_revertResolveBeforeDeadline() public {
        _seedPool(100 ether);
        uint256 policyId = _buyPolicy(alice, 10 ether, 30);

        vm.prank(alice);
        uint256 claimId = pool.fileClaim(policyId, 5 ether, "ipfs://evidence");

        vm.expectRevert("Voting ongoing");
        pool.resolveClaim(claimId);
    }

    function test_revertResolveAlreadyResolved() public {
        _seedPool(100 ether);
        uint256 policyId = _buyPolicy(alice, 10 ether, 30);

        vm.prank(alice);
        uint256 claimId = pool.fileClaim(policyId, 5 ether, "ipfs://evidence");

        vm.warp(block.timestamp + 8 days);
        pool.resolveClaim(claimId);

        vm.expectRevert("Already resolved");
        pool.resolveClaim(claimId);
    }

    function test_approvedClaimDeactivatesPolicy() public {
        _seedPool(100 ether);
        uint256 policyId = _buyPolicy(alice, 10 ether, 30);

        vm.prank(alice);
        uint256 claimId = pool.fileClaim(policyId, 5 ether, "ipfs://evidence");

        vm.prank(voter1);
        pool.voteOnClaim(claimId, true);

        vm.warp(block.timestamp + 8 days);
        pool.resolveClaim(claimId);

        (, , , , , , , bool active, bool claimed) = pool.policies(policyId);
        assertFalse(active);
        assertTrue(claimed);
    }

    function test_approvedClaimReducesCoverage() public {
        _seedPool(100 ether);
        uint256 policyId = _buyPolicy(alice, 10 ether, 30);

        uint256 coverageBefore = pool.activeCoverage(VibeInsurancePool.RiskCategory.SMART_CONTRACT);

        vm.prank(alice);
        uint256 claimId = pool.fileClaim(policyId, 5 ether, "ipfs://evidence");

        vm.prank(voter1);
        pool.voteOnClaim(claimId, true);

        vm.warp(block.timestamp + 8 days);
        pool.resolveClaim(claimId);

        uint256 coverageAfter = pool.activeCoverage(VibeInsurancePool.RiskCategory.SMART_CONTRACT);
        assertEq(coverageAfter, coverageBefore - 10 ether);
    }

    // ============ Admin ============

    function test_setPremiumRate() public {
        pool.setPremiumRate(VibeInsurancePool.RiskCategory.BRIDGE, 600);
        assertEq(pool.premiumRateBps(VibeInsurancePool.RiskCategory.BRIDGE), 600);
    }

    function test_setMaxCoverageRatio() public {
        pool.setMaxCoverageRatio(7500);
        assertEq(pool.maxCoverageRatioBps(), 7500);
    }

    function test_revertSetMaxCoverageRatioInvalid() public {
        vm.expectRevert("Invalid ratio");
        pool.setMaxCoverageRatio(10001);
    }

    function test_adminOnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        pool.setPremiumRate(VibeInsurancePool.RiskCategory.BRIDGE, 600);
    }

    // ============ Views ============

    function test_getPoolHealth() public {
        _seedPool(100 ether);
        _buyPolicy(alice, 10 ether, 30);

        (uint256 poolSize, uint256 activeCov, uint256 utilBps, uint256 premiums, uint256 payouts) =
            pool.getPoolHealth();

        assertEq(poolSize, 100 ether);
        assertEq(activeCov, 10 ether);
        assertEq(utilBps, 1000); // 10%
        assertGt(premiums, 0);
        assertEq(payouts, 0);
    }

    function test_getShareValue() public {
        pool.underwrite{value: 100 ether}();

        assertEq(pool.getShareValue(address(this)), 100 ether);
    }

    function test_getShareValueAfterPayout() public {
        pool.underwrite{value: 100 ether}();
        uint256 policyId = _buyPolicy(alice, 10 ether, 30);

        vm.prank(alice);
        uint256 claimId = pool.fileClaim(policyId, 5 ether, "ipfs://evidence");

        vm.prank(voter1);
        pool.voteOnClaim(claimId, true);

        vm.warp(block.timestamp + 8 days);
        pool.resolveClaim(claimId);

        // Pool shrunk by 5 ETH
        uint256 shareValue = pool.getShareValue(address(this));
        assertLt(shareValue, 100 ether);
    }

    // ============ Receive ============

    function test_receiveETHIncreasesPool() public {
        (bool ok, ) = address(pool).call{value: 10 ether}("");
        assertTrue(ok);
        assertEq(pool.totalUnderwritten(), 10 ether);
    }

    receive() external payable {}
}
