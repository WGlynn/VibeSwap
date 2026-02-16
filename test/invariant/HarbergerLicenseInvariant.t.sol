// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/mechanism/HarbergerLicense.sol";

// ============ Handler ============

contract HLHandler is Test {
    HarbergerLicense public hl;

    address[] public actors;
    uint256 public activeLicenseId;

    // Ghost variables
    uint256 public ghost_totalTaxDeposited;
    uint256 public ghost_totalTaxCollected;
    uint256 public ghost_totalForceBuyPayments;
    uint256 public ghost_claimCount;
    uint256 public ghost_forceBuyCount;
    bool public ghost_revoked;

    constructor(HarbergerLicense _hl, address[] memory _actors) {
        hl = _hl;
        actors = _actors;
    }

    function setLicense(uint256 id) external {
        activeLicenseId = id;
    }

    function claimLicense(uint256 actorSeed, uint256 assessedValue) public {
        if (activeLicenseId == 0) return;
        if (ghost_claimCount > 0 && !ghost_revoked) return; // already claimed

        address actor = actors[actorSeed % actors.length];
        assessedValue = bound(assessedValue, 0.01 ether, 10 ether);

        uint256 deposit = 5 ether;

        vm.prank(actor);
        try hl.claimLicense{value: deposit}(activeLicenseId, assessedValue) {
            ghost_totalTaxDeposited += deposit;
            ghost_claimCount++;
            ghost_revoked = false;
        } catch {}
    }

    function depositTax(uint256 actorSeed, uint256 amount) public {
        if (activeLicenseId == 0) return;

        address actor = actors[actorSeed % actors.length];
        amount = bound(amount, 0.001 ether, 1 ether);

        vm.prank(actor);
        try hl.depositTax{value: amount}(activeLicenseId) {
            ghost_totalTaxDeposited += amount;
        } catch {}
    }

    function collectTax() public {
        if (activeLicenseId == 0) return;

        uint256 treasuryBefore = hl.treasury().balance;
        try hl.collectTax(activeLicenseId) {
            uint256 treasuryAfter = hl.treasury().balance;
            ghost_totalTaxCollected += (treasuryAfter - treasuryBefore);
        } catch {}
    }

    function forceBuy(uint256 actorSeed, uint256 newAssessedValue) public {
        if (activeLicenseId == 0) return;

        address actor = actors[actorSeed % actors.length];
        newAssessedValue = bound(newAssessedValue, 0.01 ether, 10 ether);

        IHarbergerLicense.License memory l = hl.getLicense(activeLicenseId);
        if (l.holder == actor) return; // can't buy own
        if (l.holder == address(0)) return; // vacant

        uint256 totalPayment = l.assessedValue + 5 ether;

        vm.prank(actor);
        try hl.forceBuy{value: totalPayment}(activeLicenseId, newAssessedValue) {
            ghost_forceBuyCount++;
        } catch {}
    }

    function changeAssessment(uint256 actorSeed, uint256 newValue) public {
        if (activeLicenseId == 0) return;

        address actor = actors[actorSeed % actors.length];
        newValue = bound(newValue, 0.01 ether, 50 ether);

        vm.prank(actor);
        try hl.changeAssessment(activeLicenseId, newValue) {} catch {}
    }

    function advanceTime(uint256 delta) public {
        delta = bound(delta, 1, 30 days);
        vm.warp(block.timestamp + delta);
    }
}

// ============ Invariant Tests ============

contract HarbergerLicenseInvariantTest is StdInvariant, Test {
    HarbergerLicense public hl;
    HLHandler public handler;
    address public treasuryAddr;

    address[] public actors;

    function setUp() public {
        treasuryAddr = makeAddr("treasury");
        hl = new HarbergerLicense(treasuryAddr);

        for (uint256 i = 0; i < 5; i++) {
            address actor = makeAddr(string(abi.encodePacked("actor", vm.toString(i))));
            actors.push(actor);
            vm.deal(actor, 100 ether);
        }

        // Create a license
        uint256 licenseId = hl.createLicense("Invariant Feature", 1000);

        handler = new HLHandler(hl, actors);
        handler.setLicense(licenseId);

        targetContract(address(handler));
    }

    // ============ Invariant: contract ETH balance solvent ============

    function invariant_ethBalanceSolvent() public view {
        // Contract should always have enough ETH to cover remaining tax balances
        IHarbergerLicense.License memory l = hl.getLicense(1);
        uint256 contractBal = address(hl).balance;

        assertGe(
            contractBal,
            l.taxBalance,
            "SOLVENCY VIOLATION: contract ETH < tax balance"
        );
    }

    // ============ Invariant: license state consistency ============

    function invariant_stateConsistency() public view {
        IHarbergerLicense.License memory l = hl.getLicense(1);

        if (l.state == IHarbergerLicense.LicenseState.VACANT) {
            assertEq(l.holder, address(0), "STATE VIOLATION: vacant license has holder");
        }

        if (l.state == IHarbergerLicense.LicenseState.ACTIVE) {
            assertTrue(l.holder != address(0), "STATE VIOLATION: active license has no holder");
            assertGe(l.assessedValue, hl.minAssessedValue(), "STATE VIOLATION: assessment below min");
        }
    }

    // ============ Invariant: treasury received all collected tax ============

    function invariant_treasuryReceivedTax() public view {
        assertGe(
            treasuryAddr.balance,
            handler.ghost_totalTaxCollected(),
            "TREASURY VIOLATION: treasury balance < collected tax"
        );
    }

    // ============ Invariant: assessed value always >= min ============

    function invariant_assessedValueAboveMin() public view {
        IHarbergerLicense.License memory l = hl.getLicense(1);
        if (l.holder != address(0)) {
            assertGe(
                l.assessedValue,
                hl.minAssessedValue(),
                "ASSESSMENT VIOLATION: below minimum"
            );
        }
    }

    // ============ Invariant: force buy count bounded ============

    function invariant_forceBuyBounded() public view {
        // Just a sanity check
        assertLe(handler.ghost_forceBuyCount(), 1000, "Too many force buys");
    }
}
