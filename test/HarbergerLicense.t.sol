// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/mechanism/HarbergerLicense.sol";

// ============ Test Contract ============

contract HarbergerLicenseTest is Test {
    // ============ Re-declare events ============

    event LicenseCreated(uint256 indexed licenseId, string featureName, uint256 taxRateBps);
    event LicenseClaimed(uint256 indexed licenseId, address indexed holder, uint256 assessedValue, uint256 initialTaxDeposit);
    event ForceBuy(uint256 indexed licenseId, address indexed oldHolder, address indexed newHolder, uint256 purchasePrice);
    event TaxCollected(uint256 indexed licenseId, uint256 amount);
    event LicenseRevoked(uint256 indexed licenseId, address indexed holder);
    event AssessmentChanged(uint256 indexed licenseId, uint256 oldValue, uint256 newValue);

    // ============ State ============

    HarbergerLicense public hl;
    address public alice;
    address public bob;
    address public charlie;
    address public treasuryAddr;
    address public owner;

    uint256 constant TAX_RATE_BPS = 1000; // 10% annual
    uint256 constant ASSESSED_VALUE = 1 ether;
    uint256 constant SECONDS_PER_YEAR = 365 days;

    // ============ setUp ============

    function setUp() public {
        owner = makeAddr("owner");
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        charlie = makeAddr("charlie");
        treasuryAddr = makeAddr("treasury");

        vm.prank(owner);
        hl = new HarbergerLicense(treasuryAddr);

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(charlie, 100 ether);
    }

    // ============ Helpers ============

    function _createLicense() internal returns (uint256) {
        vm.prank(owner);
        return hl.createLicense("Featured Pool", TAX_RATE_BPS);
    }

    function _claimLicense(uint256 id, address claimer, uint256 value, uint256 deposit) internal {
        vm.prank(claimer);
        hl.claimLicense{value: deposit}(id, value);
    }

    function _computeTax(uint256 value, uint256 rate, uint256 elapsed) internal pure returns (uint256) {
        return (value * rate * elapsed) / (10000 * SECONDS_PER_YEAR);
    }

    // ============ Constructor Tests ============

    function test_constructor_setsOwner() public view {
        assertEq(hl.owner(), owner);
    }

    function test_constructor_setsTreasury() public view {
        assertEq(hl.treasury(), treasuryAddr);
        assertEq(hl.gracePeriod(), 7 days);
        assertEq(hl.minAssessedValue(), 0.01 ether);
    }

    // ============ createLicense Tests ============

    function test_createLicense_happyPath() public {
        uint256 id = _createLicense();
        assertEq(id, 1);

        IHarbergerLicense.License memory l = hl.getLicense(1);
        assertEq(l.taxRateBps, TAX_RATE_BPS);
        assertEq(uint8(l.state), uint8(IHarbergerLicense.LicenseState.VACANT));
        assertEq(l.holder, address(0));
    }

    function test_createLicense_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        hl.createLicense("Fail", TAX_RATE_BPS);
    }

    // ============ claimLicense Tests ============

    function test_claimLicense_happyPath() public {
        uint256 id = _createLicense();
        uint256 minTax = _computeTax(ASSESSED_VALUE, TAX_RATE_BPS, 7 days);

        _claimLicense(id, alice, ASSESSED_VALUE, minTax + 0.01 ether);

        IHarbergerLicense.License memory l = hl.getLicense(id);
        assertEq(l.holder, alice);
        assertEq(l.assessedValue, ASSESSED_VALUE);
        assertEq(uint8(l.state), uint8(IHarbergerLicense.LicenseState.ACTIVE));
        assertTrue(hl.isHolding(id, alice));
    }

    function test_claimLicense_revertsNotVacant() public {
        uint256 id = _createLicense();
        uint256 deposit = 0.1 ether;

        _claimLicense(id, alice, ASSESSED_VALUE, deposit);

        vm.prank(bob);
        vm.expectRevert(IHarbergerLicense.LicenseNotVacant.selector);
        hl.claimLicense{value: deposit}(id, ASSESSED_VALUE);
    }

    function test_claimLicense_revertsLowAssessment() public {
        uint256 id = _createLicense();

        vm.prank(alice);
        vm.expectRevert(IHarbergerLicense.AssessmentTooLow.selector);
        hl.claimLicense{value: 0.01 ether}(id, 0.001 ether); // below 0.01 ether min
    }

    function test_claimLicense_revertsInsufficientTaxDeposit() public {
        uint256 id = _createLicense();

        vm.prank(alice);
        vm.expectRevert(IHarbergerLicense.InsufficientTaxDeposit.selector);
        hl.claimLicense{value: 1 wei}(id, ASSESSED_VALUE);
    }

    // ============ changeAssessment Tests ============

    function test_changeAssessment_happyPath() public {
        uint256 id = _createLicense();
        _claimLicense(id, alice, ASSESSED_VALUE, 0.5 ether);

        vm.prank(alice);
        hl.changeAssessment(id, 2 ether);

        IHarbergerLicense.License memory l = hl.getLicense(id);
        assertEq(l.assessedValue, 2 ether);
    }

    function test_changeAssessment_revertsNotHolder() public {
        uint256 id = _createLicense();
        _claimLicense(id, alice, ASSESSED_VALUE, 0.5 ether);

        vm.prank(bob);
        vm.expectRevert(IHarbergerLicense.NotLicenseHolder.selector);
        hl.changeAssessment(id, 2 ether);
    }

    // ============ forceBuy Tests ============

    function test_forceBuy_happyPath() public {
        uint256 id = _createLicense();
        _claimLicense(id, alice, ASSESSED_VALUE, 0.5 ether);

        uint256 aliceBefore = alice.balance;
        uint256 minTaxNew = _computeTax(2 ether, TAX_RATE_BPS, 7 days);

        vm.prank(bob);
        hl.forceBuy{value: ASSESSED_VALUE + minTaxNew + 0.01 ether}(id, 2 ether);

        IHarbergerLicense.License memory l = hl.getLicense(id);
        assertEq(l.holder, bob);
        assertEq(l.assessedValue, 2 ether);
        assertEq(uint8(l.state), uint8(IHarbergerLicense.LicenseState.ACTIVE));

        // Alice got paid (assessed value + remaining tax balance)
        assertGt(alice.balance, aliceBefore);
    }

    function test_forceBuy_revertsCannotBuyOwn() public {
        uint256 id = _createLicense();
        _claimLicense(id, alice, ASSESSED_VALUE, 0.5 ether);

        vm.prank(alice);
        vm.expectRevert(IHarbergerLicense.CannotBuyOwnLicense.selector);
        hl.forceBuy{value: 5 ether}(id, 2 ether);
    }

    function test_forceBuy_revertsInsufficientPayment() public {
        uint256 id = _createLicense();
        _claimLicense(id, alice, ASSESSED_VALUE, 0.5 ether);

        vm.prank(bob);
        vm.expectRevert(IHarbergerLicense.InsufficientPayment.selector);
        hl.forceBuy{value: 0.5 ether}(id, 2 ether); // less than assessed value
    }

    // ============ Tax Collection Tests ============

    function test_collectTax_accruesOverTime() public {
        uint256 id = _createLicense();
        _claimLicense(id, alice, ASSESSED_VALUE, 0.5 ether);

        vm.warp(block.timestamp + 30 days);

        uint256 treasuryBefore = treasuryAddr.balance;
        hl.collectTax(id);
        uint256 treasuryAfter = treasuryAddr.balance;

        uint256 expectedTax = _computeTax(ASSESSED_VALUE, TAX_RATE_BPS, 30 days);
        assertApproxEqAbs(treasuryAfter - treasuryBefore, expectedTax, 1);
    }

    function test_depositTax_happyPath() public {
        uint256 id = _createLicense();
        _claimLicense(id, alice, ASSESSED_VALUE, 0.1 ether);

        vm.prank(bob); // anyone can deposit tax
        hl.depositTax{value: 0.5 ether}(id);

        IHarbergerLicense.License memory l = hl.getLicense(id);
        assertEq(l.taxBalance, 0.6 ether); // 0.1 + 0.5
    }

    // ============ Delinquency + Revoke Tests ============

    function test_revokeLicense_afterGracePeriod() public {
        uint256 id = _createLicense();
        uint256 minDeposit = _computeTax(ASSESSED_VALUE, TAX_RATE_BPS, 7 days);
        _claimLicense(id, alice, ASSESSED_VALUE, minDeposit + 1);

        // Warp far enough to exhaust tax balance
        vm.warp(block.timestamp + 365 days);
        hl.collectTax(id);

        // Should be delinquent now
        IHarbergerLicense.License memory l = hl.getLicense(id);
        assertEq(uint8(l.state), uint8(IHarbergerLicense.LicenseState.DELINQUENT));

        // Warp past grace period
        vm.warp(block.timestamp + 7 days + 1);
        hl.revokeLicense(id);

        l = hl.getLicense(id);
        assertEq(uint8(l.state), uint8(IHarbergerLicense.LicenseState.VACANT));
        assertEq(l.holder, address(0));
    }

    function test_revokeLicense_revertsBeforeGracePeriod() public {
        uint256 id = _createLicense();
        uint256 minDeposit = _computeTax(ASSESSED_VALUE, TAX_RATE_BPS, 7 days);
        _claimLicense(id, alice, ASSESSED_VALUE, minDeposit + 1);

        // Exhaust balance
        vm.warp(block.timestamp + 365 days);
        hl.collectTax(id);

        // Try to revoke immediately (before grace period)
        vm.expectRevert(IHarbergerLicense.GracePeriodNotExpired.selector);
        hl.revokeLicense(id);
    }

    // ============ accruedTax View ============

    function test_accruedTax_correctComputation() public {
        uint256 id = _createLicense();
        _claimLicense(id, alice, ASSESSED_VALUE, 0.5 ether);

        vm.warp(block.timestamp + 90 days);

        uint256 accrued = hl.accruedTax(id);
        uint256 expected = _computeTax(ASSESSED_VALUE, TAX_RATE_BPS, 90 days);
        assertEq(accrued, expected);
    }
}
