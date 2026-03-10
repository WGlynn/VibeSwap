// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/HatchManager.sol";
import "../../contracts/mechanism/AugmentedBondingCurve.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock Tokens ============

contract MockHMFReserve is ERC20 {
    constructor() ERC20("Reserve", "DAI") {
        _mint(msg.sender, 1_000_000_000e18);
    }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockHMFToken is ERC20 {
    address public controller;
    constructor() ERC20("Community", "VIBE") {}
    function setController(address _c) external { controller = _c; }
    function mint(address to, uint256 amount) external {
        require(msg.sender == controller, "Not controller");
        _mint(to, amount);
    }
    function burnFrom(address from, uint256 amount) external {
        require(msg.sender == controller, "Not controller");
        _burn(from, amount);
    }
}

// ============ Fuzz Test Suite ============

contract HatchManagerFuzzTest is Test {
    MockHMFReserve public dai;
    MockHMFToken public vibe;
    AugmentedBondingCurve public abc;

    uint256 constant KAPPA = 6;
    uint256 constant PRECISION = 1e18;

    function setUp() public {
        dai = new MockHMFReserve();
        vibe = new MockHMFToken();

        abc = new AugmentedBondingCurve(
            address(dai),
            address(vibe),
            address(vibe),
            KAPPA,
            500,
            1000
        );
    }

    // ============ Fuzz: Contribution accounting ============

    function testFuzz_contributionTrackingAccurate(uint256 amount) public {
        amount = bound(amount, 1e18, 500_000e18);

        (HatchManager hatch,) = _createHatch(100_000e18, 1_000_000e18, 0.01e18, 4000);
        hatch.approveHatcher(address(this));
        hatch.startHatch();

        dai.approve(address(hatch), amount);
        hatch.contribute(amount);

        assertEq(hatch.totalRaised(), amount);

        uint256 expectedTokens = (amount * PRECISION) / 0.01e18;
        (uint256 contributed, uint256 tokensAllocated,,) = hatch.hatchers(address(this));
        assertEq(contributed, amount);
        assertEq(tokensAllocated, expectedTokens);
    }

    // ============ Fuzz: Theta split is exact ============

    function testFuzz_thetaSplitExact(uint16 thetaBps) public {
        thetaBps = uint16(bound(uint256(thetaBps), 1000, 8000));

        uint256 contribution = 500_000e18;

        (HatchManager hatch, AugmentedBondingCurve freshAbc) = _createHatch(100_000e18, 1_000_000e18, 0.01e18, thetaBps);
        hatch.approveHatcher(address(this));
        hatch.startHatch();

        dai.approve(address(hatch), contribution);
        hatch.contribute(contribution);

        vibe.setController(address(hatch));
        hatch.completeHatch();

        uint256 expectedFunding = (contribution * thetaBps) / 10000;
        uint256 expectedReserve = contribution - expectedFunding;

        assertEq(freshAbc.fundingPool(), expectedFunding, "Funding split incorrect");
        assertEq(freshAbc.reserve(), expectedReserve, "Reserve split incorrect");
        assertEq(expectedFunding + expectedReserve, contribution, "Split doesn't sum to total");
    }

    // ============ Fuzz: Token allocation proportional to contribution ============

    function testFuzz_tokenAllocationProportional(uint256 price) public {
        price = bound(price, 0.001e18, 100e18);

        uint256 contribution = 200_000e18;

        (HatchManager hatch,) = _createHatch(100_000e18, 1_000_000e18, price, 4000);
        hatch.approveHatcher(address(this));
        hatch.startHatch();

        dai.approve(address(hatch), contribution);
        hatch.contribute(contribution);

        (,uint256 tokensAllocated,,) = hatch.hatchers(address(this));
        uint256 expected = (contribution * PRECISION) / price;
        assertEq(tokensAllocated, expected, "Token allocation doesn't match price");
    }

    // ============ Fuzz: Multiple contributors total matches ============

    function testFuzz_multipleContributorsTotal(uint256 a1, uint256 a2) public {
        a1 = bound(a1, 50_000e18, 400_000e18);
        a2 = bound(a2, 50_000e18, 400_000e18);

        // Ensure total doesn't exceed max
        if (a1 + a2 > 800_000e18) a2 = 800_000e18 - a1;

        (HatchManager hatch,) = _createHatch(100_000e18, 1_000_000e18, 0.01e18, 4000);
        address alice = address(0xA1);
        address bob = address(0xB0);

        hatch.approveHatcher(alice);
        hatch.approveHatcher(bob);
        hatch.startHatch();

        dai.mint(alice, a1);
        dai.mint(bob, a2);

        vm.prank(alice);
        dai.approve(address(hatch), a1);
        vm.prank(alice);
        hatch.contribute(a1);

        vm.prank(bob);
        dai.approve(address(hatch), a2);
        vm.prank(bob);
        hatch.contribute(a2);

        assertEq(hatch.totalRaised(), a1 + a2, "Total raised should be sum of contributions");
        assertEq(hatch.hatcherCount(), 2, "Should have 2 hatchers");
    }

    // ============ Fuzz: Refund returns exact amount ============

    function testFuzz_refundReturnsExact(uint256 amount) public {
        amount = bound(amount, 1e18, 50_000e18); // Below min raise to allow cancellation

        (HatchManager hatch,) = _createHatch(100_000e18, 1_000_000e18, 0.01e18, 4000);
        hatch.approveHatcher(address(this));
        hatch.startHatch();

        uint256 balBefore = dai.balanceOf(address(this));
        dai.approve(address(hatch), amount);
        hatch.contribute(amount);

        assertEq(dai.balanceOf(address(this)), balBefore - amount);

        vm.roll(block.number + 101); // Past deadline
        hatch.cancelHatch();
        hatch.claimRefund();

        assertEq(dai.balanceOf(address(this)), balBefore, "Refund should return exact amount");
    }

    // ============ Fuzz: Return rate validation ============

    function testFuzz_returnRateValidation(uint16 thetaBps) public {
        thetaBps = uint16(bound(uint256(thetaBps), 1000, 8000));

        // ρ = κ × (1-θ) = 6 × (10000 - thetaBps) / 10000
        uint256 returnRate = (KAPPA * (10000 - uint256(thetaBps))) / 10000;

        (HatchManager hatch, AugmentedBondingCurve freshAbc) = _createHatch(100_000e18, 1_000_000e18, 0.01e18, thetaBps);
        hatch.approveHatcher(address(this));
        hatch.startHatch();

        dai.approve(address(hatch), 200_000e18);
        hatch.contribute(200_000e18);

        vibe.setController(address(hatch));

        if (returnRate > 5) {
            vm.expectRevert(HatchManager.ReturnRateTooHigh.selector);
            hatch.completeHatch();
        } else {
            hatch.completeHatch();
            assertTrue(freshAbc.isOpen(), "Curve should be open after valid hatch");
        }
    }

    // ============ Fuzz: Vesting monotonically increases ============

    function testFuzz_vestingMonotonicallyIncreases(uint256 blocks1, uint256 blocks2) public {
        blocks1 = bound(blocks1, 1, 5000);
        blocks2 = bound(blocks2, 1, 5000);
        // Ensure blocks2 > blocks1
        if (blocks2 <= blocks1) blocks2 = blocks1 + 1;

        (HatchManager hatch,) = _createHatch(100_000e18, 1_000_000e18, 0.01e18, 4000);
        hatch.approveHatcher(address(this));
        hatch.startHatch();

        dai.approve(address(hatch), 200_000e18);
        hatch.contribute(200_000e18);

        vibe.setController(address(hatch));
        hatch.completeHatch();

        uint256 startBlock = block.number;

        vm.roll(startBlock + blocks1);
        uint256 vested1 = hatch.vestedAmount(address(this));

        vm.roll(startBlock + blocks2);
        uint256 vested2 = hatch.vestedAmount(address(this));

        assertGe(vested2, vested1, "Vesting should monotonically increase over time");
    }

    // ============ Fuzz: Governance boost accelerates vesting ============

    function testFuzz_governanceBoostAcceleratesVesting(uint256 score) public {
        score = bound(score, 1, 100);

        (HatchManager hatch,) = _createHatch(100_000e18, 1_000_000e18, 0.01e18, 4000);
        hatch.approveHatcher(address(this));
        hatch.startHatch();

        dai.approve(address(hatch), 200_000e18);
        hatch.contribute(200_000e18);

        vibe.setController(address(hatch));
        hatch.completeHatch();

        // Get vested without boost
        vm.roll(block.number + 500);
        uint256 vestedNoBoost = hatch.vestedAmount(address(this));

        // Apply governance boost
        hatch.updateGovernanceScore(address(this), score);
        uint256 vestedWithBoost = hatch.vestedAmount(address(this));

        assertGe(vestedWithBoost, vestedNoBoost, "Governance boost should not decrease vesting");
    }

    // ============ Fuzz: Vested amount never exceeds allocation ============

    function testFuzz_vestedNeverExceedsAllocation(uint256 blocks) public {
        blocks = bound(blocks, 0, 100_000);

        (HatchManager hatch,) = _createHatch(100_000e18, 1_000_000e18, 0.01e18, 4000);
        hatch.approveHatcher(address(this));
        hatch.startHatch();

        dai.approve(address(hatch), 200_000e18);
        hatch.contribute(200_000e18);

        vibe.setController(address(hatch));
        hatch.completeHatch();

        // Max governance boost
        hatch.updateGovernanceScore(address(this), 100);

        vm.roll(block.number + blocks);

        (,uint256 allocated,,) = hatch.hatchers(address(this));
        uint256 vested = hatch.vestedAmount(address(this));

        assertLe(vested, allocated, "Vested amount should never exceed allocation");
    }

    // ============ Helpers ============

    function _createHatch(
        uint256 minRaise,
        uint256 maxRaise,
        uint256 hatchPrice,
        uint16 thetaBps
    ) internal returns (HatchManager, AugmentedBondingCurve) {
        // Need a fresh ABC for each test since openCurve is one-time
        AugmentedBondingCurve freshAbc = new AugmentedBondingCurve(
            address(dai),
            address(vibe),
            address(vibe),
            KAPPA,
            500,
            1000
        );

        HatchManager.HatchConfig memory cfg = HatchManager.HatchConfig({
            minRaise: minRaise,
            maxRaise: maxRaise,
            hatchPrice: hatchPrice,
            thetaBps: thetaBps,
            vestingHalfLife: 1000,
            hatchDeadline: block.number + 100
        });

        HatchManager h = new HatchManager(
            address(freshAbc),
            address(dai),
            address(vibe),
            address(vibe),
            cfg
        );

        freshAbc.setHatchManager(address(h));
        return (h, freshAbc);
    }
}
