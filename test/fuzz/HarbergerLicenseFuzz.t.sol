// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/HarbergerLicense.sol";

// ============ Fuzz Tests ============

contract HarbergerLicenseFuzzTest is Test {
    HarbergerLicense public hl;
    address public alice;
    address public bob;
    address public treasuryAddr;

    uint256 constant SECONDS_PER_YEAR = 365 days;

    function setUp() public {
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        treasuryAddr = makeAddr("treasury");

        hl = new HarbergerLicense(treasuryAddr);

        vm.deal(alice, 1000 ether);
        vm.deal(bob, 1000 ether);
    }

    function _computeTax(uint256 value, uint256 rate, uint256 elapsed) internal pure returns (uint256) {
        return (value * rate * elapsed) / (10000 * SECONDS_PER_YEAR);
    }

    // ============ Fuzz: tax accrual formula correct ============

    function testFuzz_taxAccrualCorrect(uint256 assessedValue, uint256 taxRateBps, uint256 elapsed) public {
        assessedValue = bound(assessedValue, 0.01 ether, 100 ether);
        taxRateBps = bound(taxRateBps, 1, 5000);
        elapsed = bound(elapsed, 1, 365 days);

        hl.createLicense("Fuzz Feature", taxRateBps);

        uint256 minTax = _computeTax(assessedValue, taxRateBps, 7 days);
        uint256 deposit = minTax + 100 ether; // generous deposit

        vm.prank(alice);
        hl.claimLicense{value: deposit}(1, assessedValue);

        vm.warp(block.timestamp + elapsed);

        uint256 accrued = hl.accruedTax(1);
        uint256 expected = _computeTax(assessedValue, taxRateBps, elapsed);

        assertEq(accrued, expected, "Tax accrual must match formula");
    }

    // ============ Fuzz: force buy pays exactly assessed value to holder ============

    function testFuzz_forceBuyPaysAssessedValue(uint256 assessedValue) public {
        assessedValue = bound(assessedValue, 0.01 ether, 10 ether);

        hl.createLicense("Fuzz Feature", 1000);

        uint256 deposit = 5 ether;
        vm.prank(alice);
        hl.claimLicense{value: deposit}(1, assessedValue);

        uint256 aliceBefore = alice.balance;

        uint256 newAssess = assessedValue * 2;
        uint256 minTax = _computeTax(newAssess, 1000, 7 days);
        uint256 totalPayment = assessedValue + minTax + 0.1 ether;

        vm.prank(bob);
        hl.forceBuy{value: totalPayment}(1, newAssess);

        uint256 aliceAfter = alice.balance;

        // Alice receives assessed value + remaining tax balance
        // At minimum she gets the assessed value
        assertGe(aliceAfter - aliceBefore, assessedValue, "Holder must receive at least assessed value");
    }

    // ============ Fuzz: tax deposit increases tax balance ============

    function testFuzz_depositIncreasesTaxBalance(uint256 deposit1, uint256 deposit2) public {
        deposit1 = bound(deposit1, 0.01 ether, 10 ether);
        deposit2 = bound(deposit2, 0.001 ether, 10 ether);

        hl.createLicense("Fuzz Feature", 1000);

        vm.prank(alice);
        hl.claimLicense{value: deposit1}(1, 1 ether);

        IHarbergerLicense.License memory l1 = hl.getLicense(1);
        uint256 bal1 = l1.taxBalance;

        vm.prank(bob);
        hl.depositTax{value: deposit2}(1);

        IHarbergerLicense.License memory l2 = hl.getLicense(1);
        assertEq(l2.taxBalance, bal1 + deposit2, "Tax balance must increase by deposit");
    }

    // ============ Fuzz: delinquency triggers when tax exhausted ============

    function testFuzz_delinquencyOnExhaustedTax(uint256 assessedValue) public {
        assessedValue = bound(assessedValue, 0.1 ether, 10 ether);

        hl.createLicense("Fuzz Feature", 1000);

        // Deposit just barely enough
        uint256 minTax = _computeTax(assessedValue, 1000, 7 days);
        uint256 deposit = minTax + 1;

        vm.prank(alice);
        hl.claimLicense{value: deposit}(1, assessedValue);

        // Warp far enough to exhaust balance
        vm.warp(block.timestamp + 365 days);
        hl.collectTax(1);

        IHarbergerLicense.License memory l = hl.getLicense(1);
        assertEq(uint8(l.state), uint8(IHarbergerLicense.LicenseState.DELINQUENT));
    }

    // ============ Fuzz: self-assessment always >= min ============

    function testFuzz_assessmentBelowMinReverts(uint256 value) public {
        value = bound(value, 0, 0.01 ether - 1);

        hl.createLicense("Fuzz Feature", 1000);

        vm.prank(alice);
        vm.expectRevert(IHarbergerLicense.AssessmentTooLow.selector);
        hl.claimLicense{value: 1 ether}(1, value);
    }

    // ============ Fuzz: treasury receives collected tax ============

    function testFuzz_treasuryReceivesTax(uint256 elapsed) public {
        elapsed = bound(elapsed, 1 days, 180 days);

        hl.createLicense("Fuzz Feature", 1000);

        vm.prank(alice);
        hl.claimLicense{value: 50 ether}(1, 1 ether);

        vm.warp(block.timestamp + elapsed);

        uint256 treasuryBefore = treasuryAddr.balance;
        hl.collectTax(1);
        uint256 treasuryAfter = treasuryAddr.balance;

        uint256 expectedTax = _computeTax(1 ether, 1000, elapsed);
        assertApproxEqAbs(
            treasuryAfter - treasuryBefore,
            expectedTax,
            1,
            "Treasury must receive correct tax amount"
        );
    }
}
