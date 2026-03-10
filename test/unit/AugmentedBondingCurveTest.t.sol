// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/AugmentedBondingCurve.sol";
import "../../contracts/mechanism/HatchManager.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock Tokens ============

contract MockReserve is ERC20 {
    constructor() ERC20("Reserve DAI", "DAI") {
        _mint(msg.sender, 100_000_000e18);
    }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockCommunityToken is ERC20 {
    address public controller;
    constructor() ERC20("Community Token", "VIBE") {}
    function setController(address _controller) external { controller = _controller; }
    function mint(address to, uint256 amount) external {
        require(msg.sender == controller, "Not controller");
        _mint(to, amount);
    }
    function burnFrom(address from, uint256 amount) external {
        require(msg.sender == controller, "Not controller");
        _burn(from, amount);
    }
}

// ============ AugmentedBondingCurve Tests ============

contract AugmentedBondingCurveTest is Test {
    AugmentedBondingCurve public abc;
    HatchManager public hatch;
    MockReserve public dai;
    MockCommunityToken public vibe;

    address public owner;
    address public alice;
    address public bob;
    address public governance;

    uint256 constant PRECISION = 1e18;
    uint256 constant KAPPA = 6; // Power function exponent

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        governance = makeAddr("governance");

        // Deploy tokens
        dai = new MockReserve();
        vibe = new MockCommunityToken();

        // Deploy ABC
        abc = new AugmentedBondingCurve(
            address(dai),
            address(vibe),
            address(vibe), // vibe is its own controller for test
            KAPPA,
            500,  // 5% entry tribute
            1000  // 10% exit tribute
        );

        // Set vibe controller to ABC
        vibe.setController(address(abc));

        // Fund users
        dai.mint(alice, 10_000_000e18);
        dai.mint(bob, 10_000_000e18);
        dai.mint(governance, 10_000_000e18);

        // Approve
        vm.prank(alice);
        dai.approve(address(abc), type(uint256).max);
        vm.prank(bob);
        dai.approve(address(abc), type(uint256).max);
        vm.prank(governance);
        dai.approve(address(abc), type(uint256).max);

        // Setup allocator
        abc.setAllocator(governance, true);
    }

    // ============ Helper: open curve with initial state ============

    function _openCurve(uint256 reserveAmount, uint256 fundingAmount, uint256 supply) internal {
        // Mint initial supply to ABC (simulating hatch)
        vibe.setController(address(this));
        vibe.mint(address(abc), supply); // tokens held by ABC for hatchers
        vibe.setController(address(abc)); // set back

        // Actually we need the tokens to be in circulation for totalSupply
        // Mint to a holder instead
        vibe.setController(address(this));
        // Burn the ABC tokens
        // Actually let's simplify: mint directly to alice as "hatch tokens"
        // and fund the ABC contract with reserve
        vibe.setController(address(abc));

        // Fund ABC with reserve
        dai.mint(address(abc), reserveAmount + fundingAmount);

        // Open the curve
        abc.openCurve(reserveAmount, fundingAmount, supply);
    }

    function _openCurveWithMintedSupply() internal returns (uint256 initSupply) {
        initSupply = 500_000_000e18; // S₀ = 500M tokens
        uint256 reserveAmount = 3_000_000e18; // R₀ = 3M DAI
        uint256 fundingAmount = 2_000_000e18; // F₀ = 2M DAI

        // Mint initial supply (simulating hatch distribution)
        vibe.setController(address(this));
        vibe.mint(alice, initSupply / 2);
        vibe.mint(bob, initSupply / 2);
        vibe.setController(address(abc));

        // Fund ABC with reserve
        dai.mint(address(abc), reserveAmount + fundingAmount);

        // Open
        abc.openCurve(reserveAmount, fundingAmount, initSupply);
    }

    // ============ Initialization Tests ============

    function test_constructor() public view {
        assertEq(address(abc.reserveToken()), address(dai));
        assertEq(address(abc.communityToken()), address(vibe));
        assertEq(abc.kappa(), KAPPA);
        assertEq(abc.entryTributeBps(), 500);
        assertEq(abc.exitTributeBps(), 1000);
        assertFalse(abc.isOpen());
    }

    function test_openCurve() public {
        uint256 supply = _openCurveWithMintedSupply();
        assertTrue(abc.isOpen());
        assertEq(abc.reserve(), 3_000_000e18);
        assertEq(abc.fundingPool(), 2_000_000e18);
        assertGt(abc.invariantV0(), 0);

        // Spot price should be κ × R / S = 6 × 3M / 500M = 0.036 DAI/token
        uint256 expectedPrice = (KAPPA * 3_000_000e18 * PRECISION) / supply;
        assertEq(abc.spotPrice(), expectedPrice);
    }

    function test_openCurve_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(AugmentedBondingCurve.NotHatchManager.selector);
        abc.openCurve(1e18, 1e18, 1e18);
    }

    function test_openCurve_cannotOpenTwice() public {
        _openCurveWithMintedSupply();
        vm.expectRevert(AugmentedBondingCurve.AlreadyOpen.selector);
        abc.openCurve(1e18, 1e18, 1e18);
    }

    // ============ Bond-to-Mint Tests ============

    function test_bondToMint() public {
        _openCurveWithMintedSupply();

        uint256 depositAmount = 100_000e18; // 100K DAI
        uint256 aliceTokensBefore = vibe.balanceOf(alice);

        vm.prank(alice);
        uint256 minted = abc.bondToMint(depositAmount, 0);

        assertGt(minted, 0, "Should mint tokens");
        assertEq(vibe.balanceOf(alice), aliceTokensBefore + minted);

        // Entry tribute should have gone to funding pool
        uint256 expectedTribute = (depositAmount * 500) / 10000; // 5%
        assertEq(abc.fundingPool(), 2_000_000e18 + expectedTribute);

        // Reserve should have increased by deposit minus tribute
        assertEq(abc.reserve(), 3_000_000e18 + depositAmount - expectedTribute);
    }

    function test_bondToMint_slippageProtection() public {
        _openCurveWithMintedSupply();

        vm.prank(alice);
        vm.expectRevert(AugmentedBondingCurve.SlippageExceeded.selector);
        abc.bondToMint(100_000e18, type(uint256).max); // impossible min tokens
    }

    function test_bondToMint_notOpen() public {
        vm.prank(alice);
        vm.expectRevert(AugmentedBondingCurve.NotOpen.selector);
        abc.bondToMint(100_000e18, 0);
    }

    function test_bondToMint_zeroAmount() public {
        _openCurveWithMintedSupply();
        vm.prank(alice);
        vm.expectRevert(AugmentedBondingCurve.ZeroAmount.selector);
        abc.bondToMint(0, 0);
    }

    function test_bondToMint_priceIncreases() public {
        _openCurveWithMintedSupply();

        uint256 priceBefore = abc.spotPrice();

        vm.prank(alice);
        abc.bondToMint(1_000_000e18, 0); // 1M DAI deposit

        uint256 priceAfter = abc.spotPrice();
        assertGt(priceAfter, priceBefore, "Price should increase after buy");
    }

    // ============ Burn-to-Withdraw Tests ============

    function test_burnToWithdraw() public {
        _openCurveWithMintedSupply();

        uint256 burnAmount = 10_000_000e18; // 10M tokens
        uint256 aliceDaiBefore = dai.balanceOf(alice);

        // Approve ABC to burn tokens
        vm.prank(alice);
        vibe.approve(address(abc), burnAmount);

        vm.prank(alice);
        uint256 returned = abc.burnToWithdraw(burnAmount, 0);

        assertGt(returned, 0, "Should return reserve");
        assertEq(dai.balanceOf(alice), aliceDaiBefore + returned);

        // Exit tribute should have increased funding pool
        assertGt(abc.fundingPool(), 2_000_000e18);
    }

    function test_burnToWithdraw_slippageProtection() public {
        _openCurveWithMintedSupply();

        vm.prank(alice);
        vibe.approve(address(abc), 10_000_000e18);

        vm.prank(alice);
        vm.expectRevert(AugmentedBondingCurve.SlippageExceeded.selector);
        abc.burnToWithdraw(10_000_000e18, type(uint256).max);
    }

    function test_burnToWithdraw_priceDecreases() public {
        _openCurveWithMintedSupply();

        uint256 priceBefore = abc.spotPrice();

        vm.prank(alice);
        vibe.approve(address(abc), 10_000_000e18);

        vm.prank(alice);
        abc.burnToWithdraw(10_000_000e18, 0);

        uint256 priceAfter = abc.spotPrice();
        assertLt(priceAfter, priceBefore, "Price should decrease after sell");
    }

    function test_burnToWithdraw_exitTributeFundsCommons() public {
        _openCurveWithMintedSupply();

        uint256 fundingBefore = abc.fundingPool();

        vm.prank(alice);
        vibe.approve(address(abc), 50_000_000e18);

        vm.prank(alice);
        abc.burnToWithdraw(50_000_000e18, 0);

        assertGt(abc.fundingPool(), fundingBefore, "Exit tribute should fund commons");
    }

    // ============ Allocate-with-Rebond Tests ============

    function test_allocateWithRebond() public {
        _openCurveWithMintedSupply();

        uint256 allocAmount = 500_000e18; // 500K from funding pool
        uint256 fundingBefore = abc.fundingPool();
        uint256 reserveBefore = abc.reserve();

        vm.prank(governance);
        uint256 minted = abc.allocateWithRebond(allocAmount, bob);

        assertGt(minted, 0, "Should mint tokens to recipient");
        assertEq(abc.fundingPool(), fundingBefore - allocAmount);
        assertEq(abc.reserve(), reserveBefore + allocAmount);
    }

    function test_allocateWithRebond_onlyAllocator() public {
        _openCurveWithMintedSupply();

        vm.prank(alice);
        vm.expectRevert(AugmentedBondingCurve.NotAllocator.selector);
        abc.allocateWithRebond(100e18, alice);
    }

    function test_allocateWithRebond_insufficientFunding() public {
        _openCurveWithMintedSupply();

        vm.prank(governance);
        vm.expectRevert(AugmentedBondingCurve.InsufficientFunding.selector);
        abc.allocateWithRebond(100_000_000e18, bob); // more than funding pool
    }

    // ============ External Deposit Tests ============

    function test_deposit() public {
        _openCurveWithMintedSupply();

        uint256 depositAmount = 100_000e18;
        uint256 fundingBefore = abc.fundingPool();
        uint256 reserveBefore = abc.reserve();

        vm.prank(alice);
        abc.deposit(depositAmount);

        // Funding pool increases, reserve unchanged
        assertEq(abc.fundingPool(), fundingBefore + depositAmount);
        assertEq(abc.reserve(), reserveBefore, "Reserve unchanged on deposit");
    }

    // ============ Conservation Invariant Tests ============

    function test_invariantPreservedAfterBond() public {
        _openCurveWithMintedSupply();

        uint256 v0 = abc.invariantV0();

        vm.prank(alice);
        abc.bondToMint(500_000e18, 0);

        uint256 v1 = abc.currentInvariant();

        // Should be within 0.01% tolerance
        uint256 tolerance = v0 / 10000;
        assertApproxEqAbs(v1, v0, tolerance, "Invariant preserved after bond");
    }

    function test_invariantPreservedAfterBurn() public {
        _openCurveWithMintedSupply();

        uint256 v0 = abc.invariantV0();

        vm.prank(alice);
        vibe.approve(address(abc), 10_000_000e18);
        vm.prank(alice);
        abc.burnToWithdraw(10_000_000e18, 0);

        uint256 v1 = abc.currentInvariant();

        uint256 tolerance = v0 / 10000;
        assertApproxEqAbs(v1, v0, tolerance, "Invariant preserved after burn");
    }

    function test_invariantPreservedAfterAllocate() public {
        _openCurveWithMintedSupply();

        uint256 v0 = abc.invariantV0();

        vm.prank(governance);
        abc.allocateWithRebond(100_000e18, bob);

        uint256 v1 = abc.currentInvariant();

        uint256 tolerance = v0 / 10000;
        assertApproxEqAbs(v1, v0, tolerance, "Invariant preserved after allocate");
    }

    // ============ Quote Tests ============

    function test_quoteBondToMint() public {
        _openCurveWithMintedSupply();

        (uint256 quotedTokens, uint256 quotedTribute) = abc.quoteBondToMint(100_000e18);

        vm.prank(alice);
        uint256 actualTokens = abc.bondToMint(100_000e18, 0);

        // Quote should match actual (within rounding)
        assertApproxEqAbs(quotedTokens, actualTokens, 1e18, "Quote should match actual");
        assertEq(quotedTribute, (100_000e18 * 500) / 10000, "Tribute should be 5%");
    }

    function test_quoteBurnToWithdraw() public {
        _openCurveWithMintedSupply();

        uint256 burnAmount = 10_000_000e18;
        (uint256 quotedReserve, uint256 quotedTribute) = abc.quoteBurnToWithdraw(burnAmount);

        vm.prank(alice);
        vibe.approve(address(abc), burnAmount);
        vm.prank(alice);
        uint256 actualReserve = abc.burnToWithdraw(burnAmount, 0);

        assertApproxEqAbs(quotedReserve, actualReserve, 1e18, "Quote should match actual");
        assertGt(quotedTribute, 0, "Should have exit tribute");
    }

    // ============ Curve State Tests ============

    function test_getCurveState() public {
        _openCurveWithMintedSupply();

        (uint256 r, uint256 f, uint256 s, uint256 p, uint256 v, bool open) = abc.getCurveState();

        assertEq(r, 3_000_000e18);
        assertEq(f, 2_000_000e18);
        assertEq(s, 500_000_000e18);
        assertGt(p, 0);
        assertGt(v, 0);
        assertTrue(open);
    }

    // ============ Admin Tests ============

    function test_setTributes() public {
        abc.setTributes(1000, 2000);
        assertEq(abc.entryTributeBps(), 1000);
        assertEq(abc.exitTributeBps(), 2000);
    }

    function test_setTributes_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        abc.setTributes(1000, 2000);
    }

    function test_setTributes_maxEnforced() public {
        vm.expectRevert();
        abc.setTributes(5001, 0); // over 50%
    }

    function test_setAllocator() public {
        abc.setAllocator(alice, true);
        assertTrue(abc.allocators(alice));

        abc.setAllocator(alice, false);
        assertFalse(abc.allocators(alice));
    }

    // ============ Lawson Constant ============

    function test_lawsonConstant() public view {
        assertEq(
            abc.LAWSON_CONSTANT(),
            keccak256("FAIRNESS_ABOVE_ALL:W.GLYNN:2026"),
            "Lawson Constant must be correct"
        );
    }

    // ============ Edge Cases ============

    function test_largeBond() public {
        _openCurveWithMintedSupply();

        // Large deposit: 5M DAI
        vm.prank(alice);
        uint256 minted = abc.bondToMint(5_000_000e18, 0);
        assertGt(minted, 0, "Should handle large bond");
    }

    function test_smallBond() public {
        _openCurveWithMintedSupply();

        // Small deposit: 1 DAI
        vm.prank(alice);
        uint256 minted = abc.bondToMint(1e18, 0);
        assertGt(minted, 0, "Should handle small bond");
    }

    function test_multipleBondsAndBurns() public {
        _openCurveWithMintedSupply();

        // Buy
        vm.prank(alice);
        uint256 minted1 = abc.bondToMint(100_000e18, 0);

        // Buy again
        vm.prank(bob);
        uint256 minted2 = abc.bondToMint(100_000e18, 0);

        // Price should have increased, so bob gets fewer tokens
        assertLt(minted2, minted1, "Later buyers get fewer tokens (higher price)");

        // Sell
        vm.prank(alice);
        vibe.approve(address(abc), minted1);
        vm.prank(alice);
        abc.burnToWithdraw(minted1, 0);

        // Invariant should still hold
        uint256 v = abc.currentInvariant();
        uint256 tolerance = abc.invariantV0() / 10000;
        assertApproxEqAbs(v, abc.invariantV0(), tolerance, "Invariant after multiple ops");
    }

    function test_buyersPayMoreThanSpot() public {
        _openCurveWithMintedSupply();

        uint256 spotBefore = abc.spotPrice();
        uint256 depositAmount = 100_000e18;

        vm.prank(alice);
        uint256 minted = abc.bondToMint(depositAmount, 0);

        // Realized price = deposit / tokens (before tribute)
        uint256 netDeposit = depositAmount - (depositAmount * 500 / 10000);
        uint256 realizedPrice = (netDeposit * PRECISION) / minted;

        // Realized price should exceed spot price before purchase (Lemma 1)
        assertGt(realizedPrice, spotBefore, "Realized buy price > spot (Lemma 1)");
    }
}
