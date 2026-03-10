// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/AugmentedBondingCurve.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock Tokens (reuse pattern from unit tests) ============

contract MockReserveFuzz is ERC20 {
    constructor() ERC20("Reserve DAI", "DAI") {
        _mint(msg.sender, 1_000_000_000e18);
    }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockCommunityTokenFuzz is ERC20 {
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

// ============ AugmentedBondingCurve Fuzz Tests ============

/**
 * @title AugmentedBondingCurve Fuzz Tests
 * @notice Fuzz testing for ABC conservation invariant, monotonic pricing,
 *         tribute accounting, no-free-tokens property, supply consistency,
 *         and slippage bounds (Lemma 1 & 2 from Zargham et al.).
 * @dev Six property-based test families, bounded inputs, vm.assume filters.
 */
contract AugmentedBondingCurveFuzzTest is Test {
    AugmentedBondingCurve public abc;
    MockReserveFuzz public dai;
    MockCommunityTokenFuzz public vibe;

    address public owner;
    address public alice;
    address public bob;
    address public governance;

    uint256 constant PRECISION = 1e18;
    uint256 constant KAPPA = 6;

    // Initial curve state (from _openCurveWithMintedSupply)
    uint256 constant INIT_SUPPLY = 500_000_000e18;   // S₀ = 500M tokens
    uint256 constant INIT_RESERVE = 3_000_000e18;     // R₀ = 3M DAI
    uint256 constant INIT_FUNDING = 2_000_000e18;     // F₀ = 2M DAI

    // Fuzz input bounds
    uint256 constant MIN_DEPOSIT = 1e15;               // 0.001 tokens
    uint256 constant MAX_DEPOSIT = 1_000_000e18;       // 1M tokens
    uint256 constant MIN_BURN = 1e15;                  // 0.001 tokens
    uint256 constant MAX_BURN = 50_000_000e18;         // up to 10% of supply

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        governance = makeAddr("governance");

        // Deploy tokens
        dai = new MockReserveFuzz();
        vibe = new MockCommunityTokenFuzz();

        // Deploy ABC: kappa=6, 5% entry tribute, 10% exit tribute
        abc = new AugmentedBondingCurve(
            address(dai),
            address(vibe),
            address(vibe), // vibe is its own controller for tests
            KAPPA,
            500,  // 5% entry tribute
            1000  // 10% exit tribute
        );

        // Set vibe controller to ABC
        vibe.setController(address(abc));

        // Fund users generously for fuzz ranges
        dai.mint(alice, 100_000_000e18);
        dai.mint(bob, 100_000_000e18);
        dai.mint(governance, 100_000_000e18);

        // Approve
        vm.prank(alice);
        dai.approve(address(abc), type(uint256).max);
        vm.prank(bob);
        dai.approve(address(abc), type(uint256).max);
        vm.prank(governance);
        dai.approve(address(abc), type(uint256).max);

        // Setup allocator
        abc.setAllocator(governance, true);

        // Open curve with minted supply
        _openCurveWithMintedSupply();
    }

    // ============ Helper: open curve with initial state ============

    function _openCurveWithMintedSupply() internal {
        // Mint initial supply (simulating hatch distribution)
        vibe.setController(address(this));
        vibe.mint(alice, INIT_SUPPLY / 2);
        vibe.mint(bob, INIT_SUPPLY / 2);
        vibe.setController(address(abc));

        // Fund ABC with reserve + funding pool
        dai.mint(address(abc), INIT_RESERVE + INIT_FUNDING);

        // Open
        abc.openCurve(INIT_RESERVE, INIT_FUNDING, INIT_SUPPLY);
    }

    // ============ 1. Invariant Conservation: V(R,S) = V₀ after bondToMint ============

    function testFuzz_invariantConservedAfterBond(uint256 depositAmount) public {
        depositAmount = bound(depositAmount, MIN_DEPOSIT, MAX_DEPOSIT);

        uint256 v0 = abc.invariantV0();

        vm.prank(alice);
        abc.bondToMint(depositAmount, 0);

        uint256 v1 = abc.currentInvariant();

        // Contract allows 0.01% tolerance — we verify the same
        uint256 tolerance = v0 / 10000;
        if (tolerance == 0) tolerance = 1;
        assertApproxEqAbs(v1, v0, tolerance, "Invariant V(R,S) must equal V0 after bond");
    }

    function testFuzz_invariantConservedAfterBurn(uint256 burnAmount) public {
        burnAmount = bound(burnAmount, MIN_BURN, MAX_BURN);

        uint256 aliceBalance = vibe.balanceOf(alice);
        vm.assume(burnAmount <= aliceBalance);

        // Ensure we don't burn the entire supply
        uint256 totalSupply = vibe.totalSupply();
        vm.assume(burnAmount < totalSupply);

        uint256 v0 = abc.invariantV0();

        vm.prank(alice);
        vibe.approve(address(abc), burnAmount);
        vm.prank(alice);
        abc.burnToWithdraw(burnAmount, 0);

        uint256 v1 = abc.currentInvariant();

        uint256 tolerance = v0 / 10000;
        if (tolerance == 0) tolerance = 1;
        assertApproxEqAbs(v1, v0, tolerance, "Invariant V(R,S) must equal V0 after burn");
    }

    function testFuzz_invariantConservedAfterAllocate(uint256 allocAmount) public {
        allocAmount = bound(allocAmount, MIN_DEPOSIT, INIT_FUNDING - 1);

        uint256 v0 = abc.invariantV0();

        vm.prank(governance);
        abc.allocateWithRebond(allocAmount, bob);

        uint256 v1 = abc.currentInvariant();

        uint256 tolerance = v0 / 10000;
        if (tolerance == 0) tolerance = 1;
        assertApproxEqAbs(v1, v0, tolerance, "Invariant V(R,S) must equal V0 after allocate");
    }

    // ============ 2. Monotonic Price: bond increases, burn decreases ============

    function testFuzz_bondToMintIncreasesSpotPrice(uint256 depositAmount) public {
        depositAmount = bound(depositAmount, MIN_DEPOSIT, MAX_DEPOSIT);

        uint256 priceBefore = abc.spotPrice();

        vm.prank(alice);
        abc.bondToMint(depositAmount, 0);

        uint256 priceAfter = abc.spotPrice();
        assertGt(priceAfter, priceBefore, "Spot price must increase after bondToMint");
    }

    function testFuzz_burnToWithdrawDecreasesSpotPrice(uint256 burnAmount) public {
        burnAmount = bound(burnAmount, MIN_BURN, MAX_BURN);

        uint256 aliceBalance = vibe.balanceOf(alice);
        vm.assume(burnAmount <= aliceBalance);

        uint256 totalSupply = vibe.totalSupply();
        vm.assume(burnAmount < totalSupply);

        uint256 priceBefore = abc.spotPrice();

        vm.prank(alice);
        vibe.approve(address(abc), burnAmount);
        vm.prank(alice);
        abc.burnToWithdraw(burnAmount, 0);

        uint256 priceAfter = abc.spotPrice();
        assertLt(priceAfter, priceBefore, "Spot price must decrease after burnToWithdraw");
    }

    function testFuzz_consecutiveBondsMonotonicallyIncreasePrice(
        uint256 deposit1,
        uint256 deposit2
    ) public {
        deposit1 = bound(deposit1, MIN_DEPOSIT, MAX_DEPOSIT / 2);
        deposit2 = bound(deposit2, MIN_DEPOSIT, MAX_DEPOSIT / 2);

        uint256 price0 = abc.spotPrice();

        vm.prank(alice);
        abc.bondToMint(deposit1, 0);
        uint256 price1 = abc.spotPrice();

        vm.prank(bob);
        abc.bondToMint(deposit2, 0);
        uint256 price2 = abc.spotPrice();

        assertGt(price1, price0, "Price must increase after first bond");
        assertGt(price2, price1, "Price must increase after second bond");
    }

    // ============ 3. Tribute Accounting: entry/exit tributes go to funding pool ============

    function testFuzz_entryTributeGoesToFundingPool(uint256 depositAmount) public {
        depositAmount = bound(depositAmount, MIN_DEPOSIT, MAX_DEPOSIT);

        uint256 fundingBefore = abc.fundingPool();
        uint256 expectedTribute = (depositAmount * abc.entryTributeBps()) / 10000;

        vm.prank(alice);
        abc.bondToMint(depositAmount, 0);

        uint256 fundingAfter = abc.fundingPool();
        assertEq(
            fundingAfter,
            fundingBefore + expectedTribute,
            "Entry tribute must go exactly to funding pool"
        );
    }

    function testFuzz_exitTributeGoesToFundingPool(uint256 burnAmount) public {
        burnAmount = bound(burnAmount, MIN_BURN, MAX_BURN);

        uint256 aliceBalance = vibe.balanceOf(alice);
        vm.assume(burnAmount <= aliceBalance);
        uint256 totalSupply = vibe.totalSupply();
        vm.assume(burnAmount < totalSupply);

        uint256 fundingBefore = abc.fundingPool();
        uint256 reserveBefore = abc.reserve();

        vm.prank(alice);
        vibe.approve(address(abc), burnAmount);
        vm.prank(alice);
        uint256 reserveReturned = abc.burnToWithdraw(burnAmount, 0);

        uint256 reserveAfter = abc.reserve();
        uint256 grossReserveOut = reserveBefore - reserveAfter;
        uint256 expectedTribute = (grossReserveOut * abc.exitTributeBps()) / 10000;
        uint256 fundingAfter = abc.fundingPool();

        // Verify tribute = gross - net
        assertEq(
            grossReserveOut - reserveReturned,
            expectedTribute,
            "Exit tribute = gross - net returned"
        );
        assertEq(
            fundingAfter,
            fundingBefore + expectedTribute,
            "Exit tribute must go exactly to funding pool"
        );
    }

    function testFuzz_noTributeLeakage(uint256 depositAmount) public {
        depositAmount = bound(depositAmount, MIN_DEPOSIT, MAX_DEPOSIT);

        uint256 reserveBefore = abc.reserve();
        uint256 fundingBefore = abc.fundingPool();

        vm.prank(alice);
        abc.bondToMint(depositAmount, 0);

        uint256 reserveAfter = abc.reserve();
        uint256 fundingAfter = abc.fundingPool();

        // Total accounting: reserveDelta + fundingDelta must equal depositAmount
        uint256 reserveDelta = reserveAfter - reserveBefore;
        uint256 fundingDelta = fundingAfter - fundingBefore;
        assertEq(
            reserveDelta + fundingDelta,
            depositAmount,
            "Reserve + funding delta must equal deposit (no leakage)"
        );
    }

    // ============ 4. No Free Tokens: roundtrip always loses to tributes ============

    function testFuzz_noFreeTokensRoundtrip(uint256 depositAmount) public {
        depositAmount = bound(depositAmount, 1e16, MAX_DEPOSIT);

        uint256 aliceDaiBefore = dai.balanceOf(alice);

        // Buy tokens
        vm.prank(alice);
        uint256 minted = abc.bondToMint(depositAmount, 0);

        vm.assume(minted > 0);

        // Immediately sell all minted tokens
        vm.prank(alice);
        vibe.approve(address(abc), minted);
        vm.prank(alice);
        uint256 returned = abc.burnToWithdraw(minted, 0);

        uint256 aliceDaiAfter = dai.balanceOf(alice);

        // Alice must have less DAI than she started with (entry + exit tributes + slippage)
        assertLt(aliceDaiAfter, aliceDaiBefore, "Roundtrip must lose to tributes");
        assertLt(returned, depositAmount, "Reserve returned must be less than deposited");
    }

    function testFuzz_noFreeTokensTwoUserRoundtrip(
        uint256 aliceDeposit,
        uint256 bobDeposit
    ) public {
        aliceDeposit = bound(aliceDeposit, 1e16, MAX_DEPOSIT / 2);
        bobDeposit = bound(bobDeposit, 1e16, MAX_DEPOSIT / 2);

        uint256 aliceDaiBefore = dai.balanceOf(alice);
        uint256 bobDaiBefore = dai.balanceOf(bob);

        // Alice buys
        vm.prank(alice);
        uint256 aliceMinted = abc.bondToMint(aliceDeposit, 0);

        // Bob buys
        vm.prank(bob);
        uint256 bobMinted = abc.bondToMint(bobDeposit, 0);

        vm.assume(aliceMinted > 0 && bobMinted > 0);

        // Both sell
        vm.prank(alice);
        vibe.approve(address(abc), aliceMinted);
        vm.prank(alice);
        abc.burnToWithdraw(aliceMinted, 0);

        vm.prank(bob);
        vibe.approve(address(abc), bobMinted);
        vm.prank(bob);
        abc.burnToWithdraw(bobMinted, 0);

        uint256 aliceDaiAfter = dai.balanceOf(alice);
        uint256 bobDaiAfter = dai.balanceOf(bob);

        // Neither user should profit from the roundtrip
        assertLt(aliceDaiAfter, aliceDaiBefore, "Alice must lose on roundtrip");
        assertLt(bobDaiAfter, bobDaiBefore, "Bob must lose on roundtrip");
    }

    // ============ 5. Supply Consistency: totalSupply matches reserve through invariant ============

    function testFuzz_supplyConsistentWithReserveAfterBond(uint256 depositAmount) public {
        depositAmount = bound(depositAmount, MIN_DEPOSIT, MAX_DEPOSIT);

        vm.prank(alice);
        abc.bondToMint(depositAmount, 0);

        uint256 currentReserve = abc.reserve();
        uint256 currentSupply = vibe.totalSupply();
        uint256 v0 = abc.invariantV0();

        // Verify: S^kappa / R ≈ V0
        // We recompute using the same _pow logic the contract uses
        // The contract's _checkInvariant already verified this on-chain,
        // but we verify the view function agrees
        uint256 computedV = abc.currentInvariant();
        uint256 tolerance = v0 / 10000;
        if (tolerance == 0) tolerance = 1;

        assertApproxEqAbs(computedV, v0, tolerance, "Supply must be consistent with reserve via invariant");

        // Also verify: spot price = kappa * R / S (derived, not stored)
        uint256 expectedPrice = (KAPPA * currentReserve * PRECISION) / currentSupply;
        assertEq(abc.spotPrice(), expectedPrice, "Spot price must be derived from R and S");
    }

    function testFuzz_supplyConsistentWithReserveAfterBurn(uint256 burnAmount) public {
        burnAmount = bound(burnAmount, MIN_BURN, MAX_BURN);

        uint256 aliceBalance = vibe.balanceOf(alice);
        vm.assume(burnAmount <= aliceBalance);
        uint256 totalSupply = vibe.totalSupply();
        vm.assume(burnAmount < totalSupply);

        vm.prank(alice);
        vibe.approve(address(abc), burnAmount);
        vm.prank(alice);
        abc.burnToWithdraw(burnAmount, 0);

        uint256 currentReserve = abc.reserve();
        uint256 currentSupply = vibe.totalSupply();
        uint256 v0 = abc.invariantV0();

        uint256 computedV = abc.currentInvariant();
        uint256 tolerance = v0 / 10000;
        if (tolerance == 0) tolerance = 1;

        assertApproxEqAbs(computedV, v0, tolerance, "Supply consistent with reserve after burn");

        uint256 expectedPrice = (KAPPA * currentReserve * PRECISION) / currentSupply;
        assertEq(abc.spotPrice(), expectedPrice, "Spot price derived after burn");
    }

    function testFuzz_supplyConsistentAfterMultipleOps(
        uint256 deposit1,
        uint256 deposit2,
        uint256 burnAmount
    ) public {
        deposit1 = bound(deposit1, MIN_DEPOSIT, MAX_DEPOSIT / 3);
        deposit2 = bound(deposit2, MIN_DEPOSIT, MAX_DEPOSIT / 3);
        burnAmount = bound(burnAmount, MIN_BURN, MAX_BURN / 4);

        // Bond twice
        vm.prank(alice);
        abc.bondToMint(deposit1, 0);

        vm.prank(bob);
        abc.bondToMint(deposit2, 0);

        // Burn some
        uint256 aliceBalance = vibe.balanceOf(alice);
        vm.assume(burnAmount <= aliceBalance);
        uint256 totalSupply = vibe.totalSupply();
        vm.assume(burnAmount < totalSupply);

        vm.prank(alice);
        vibe.approve(address(abc), burnAmount);
        vm.prank(alice);
        abc.burnToWithdraw(burnAmount, 0);

        // Verify invariant still holds after mixed operations
        uint256 v0 = abc.invariantV0();
        uint256 computedV = abc.currentInvariant();
        uint256 tolerance = v0 / 10000;
        if (tolerance == 0) tolerance = 1;

        assertApproxEqAbs(computedV, v0, tolerance, "Invariant holds after mixed bond+burn ops");
    }

    // ============ 6. Slippage Bounds: realized price worse than spot (Lemma 1 & 2) ============

    function testFuzz_buyerPaysMoreThanSpotPrice(uint256 depositAmount) public {
        depositAmount = bound(depositAmount, 1e16, MAX_DEPOSIT);

        uint256 spotBefore = abc.spotPrice();

        vm.prank(alice);
        uint256 minted = abc.bondToMint(depositAmount, 0);

        vm.assume(minted > 0);

        // Net deposit (after entry tribute) is what actually enters the curve
        uint256 netDeposit = depositAmount - (depositAmount * abc.entryTributeBps()) / 10000;

        // Realized price = netDeposit / tokensMinted (in PRECISION scale)
        uint256 realizedPrice = (netDeposit * PRECISION) / minted;

        // Lemma 1 (Zargham et al.): For a convex bonding curve (kappa >= 2),
        // the average price paid is always GREATER than the spot price before the trade.
        // This is because the integral under the curve exceeds the rectangle at the start price.
        assertGt(
            realizedPrice,
            spotBefore,
            "Lemma 1: Buyer realized price must exceed pre-trade spot price"
        );
    }

    function testFuzz_buyerPaysLessThanPostSpot(uint256 depositAmount) public {
        depositAmount = bound(depositAmount, 1e16, MAX_DEPOSIT);

        vm.prank(alice);
        uint256 minted = abc.bondToMint(depositAmount, 0);

        vm.assume(minted > 0);

        uint256 spotAfter = abc.spotPrice();

        uint256 netDeposit = depositAmount - (depositAmount * abc.entryTributeBps()) / 10000;
        uint256 realizedPrice = (netDeposit * PRECISION) / minted;

        // Lemma 1 corollary: average price is between pre-spot and post-spot.
        // So realized price must be LESS than post-trade spot price.
        assertLt(
            realizedPrice,
            spotAfter,
            "Lemma 1 corollary: Buyer realized price must be less than post-trade spot"
        );
    }

    function testFuzz_sellerReceivesLessThanSpotPrice(uint256 burnAmount) public {
        burnAmount = bound(burnAmount, MIN_BURN, MAX_BURN);

        uint256 aliceBalance = vibe.balanceOf(alice);
        vm.assume(burnAmount <= aliceBalance);
        uint256 totalSupply = vibe.totalSupply();
        vm.assume(burnAmount < totalSupply);

        uint256 spotBefore = abc.spotPrice();

        vm.prank(alice);
        vibe.approve(address(abc), burnAmount);
        vm.prank(alice);
        uint256 reserveReturned = abc.burnToWithdraw(burnAmount, 0);

        // Realized sell price = reserveReturned / burnAmount (in PRECISION scale)
        // Note: reserveReturned already has exit tribute deducted
        uint256 realizedPrice = (reserveReturned * PRECISION) / burnAmount;

        // Lemma 2 (Zargham et al.): For a convex bonding curve,
        // the average price received is always LESS than the spot price before the trade.
        // The seller moves down the curve, receiving less per token as supply shrinks.
        // Additionally, exit tribute makes it even worse for the seller.
        assertLt(
            realizedPrice,
            spotBefore,
            "Lemma 2: Seller realized price must be less than pre-trade spot price"
        );
    }

    function testFuzz_sellerReceivesMoreThanPostSpot(uint256 burnAmount) public {
        burnAmount = bound(burnAmount, MIN_BURN, MAX_BURN);

        uint256 aliceBalance = vibe.balanceOf(alice);
        vm.assume(burnAmount <= aliceBalance);
        uint256 totalSupply = vibe.totalSupply();
        vm.assume(burnAmount < totalSupply);

        uint256 reserveBefore = abc.reserve();

        vm.prank(alice);
        vibe.approve(address(abc), burnAmount);
        vm.prank(alice);
        uint256 reserveReturned = abc.burnToWithdraw(burnAmount, 0);

        uint256 spotAfter = abc.spotPrice();
        uint256 reserveAfter = abc.reserve();

        // Gross reserve out (before exit tribute)
        uint256 grossReserveOut = reserveBefore - reserveAfter;

        // Gross realized price (before exit tribute)
        uint256 grossRealizedPrice = (grossReserveOut * PRECISION) / burnAmount;

        // Lemma 2 corollary: the gross average sell price is between post-spot and pre-spot.
        // So gross realized price must be GREATER than post-trade spot price.
        assertGt(
            grossRealizedPrice,
            spotAfter,
            "Lemma 2 corollary: Gross sell price must exceed post-trade spot"
        );
    }

    // ============ Bonus: Quote Accuracy Under Fuzz ============

    function testFuzz_bondQuoteMatchesExecution(uint256 depositAmount) public {
        depositAmount = bound(depositAmount, MIN_DEPOSIT, MAX_DEPOSIT);

        (uint256 quotedTokens, uint256 quotedTribute) = abc.quoteBondToMint(depositAmount);

        vm.prank(alice);
        uint256 actualTokens = abc.bondToMint(depositAmount, 0);

        // Quote and actual should match exactly (same code path)
        assertApproxEqAbs(quotedTokens, actualTokens, 1, "Bond quote must match execution");

        uint256 expectedTribute = (depositAmount * abc.entryTributeBps()) / 10000;
        assertEq(quotedTribute, expectedTribute, "Quoted tribute must be exact");
    }

    function testFuzz_burnQuoteMatchesExecution(uint256 burnAmount) public {
        burnAmount = bound(burnAmount, MIN_BURN, MAX_BURN);

        uint256 aliceBalance = vibe.balanceOf(alice);
        vm.assume(burnAmount <= aliceBalance);
        uint256 totalSupply = vibe.totalSupply();
        vm.assume(burnAmount < totalSupply);

        (uint256 quotedReserve, uint256 quotedTribute) = abc.quoteBurnToWithdraw(burnAmount);

        vm.prank(alice);
        vibe.approve(address(abc), burnAmount);
        vm.prank(alice);
        uint256 actualReserve = abc.burnToWithdraw(burnAmount, 0);

        assertApproxEqAbs(quotedReserve, actualReserve, 1, "Burn quote must match execution");
        assertGt(quotedTribute, 0, "Exit tribute must be positive");
    }

    // ============ Bonus: Deposit Does Not Affect Curve ============

    function testFuzz_externalDepositNoEffect(uint256 depositAmount) public {
        depositAmount = bound(depositAmount, MIN_DEPOSIT, MAX_DEPOSIT);

        uint256 reserveBefore = abc.reserve();
        uint256 supplyBefore = vibe.totalSupply();
        uint256 priceBefore = abc.spotPrice();
        uint256 invariantBefore = abc.currentInvariant();

        vm.prank(alice);
        abc.deposit(depositAmount);

        // Reserve, supply, price, invariant must all be unchanged
        assertEq(abc.reserve(), reserveBefore, "Reserve unchanged after deposit");
        assertEq(vibe.totalSupply(), supplyBefore, "Supply unchanged after deposit");
        assertEq(abc.spotPrice(), priceBefore, "Price unchanged after deposit");
        assertEq(abc.currentInvariant(), invariantBefore, "Invariant unchanged after deposit");

        // Only funding pool changes
        assertEq(abc.fundingPool(), INIT_FUNDING + depositAmount, "Funding pool increased by deposit");
    }

    // ============ Bonus: Later Buyers Get Fewer Tokens (Convexity) ============

    function testFuzz_laterBuyerGetsFewerTokens(uint256 depositAmount) public {
        depositAmount = bound(depositAmount, 1e16, MAX_DEPOSIT / 2);

        // Alice buys first
        vm.prank(alice);
        uint256 aliceMinted = abc.bondToMint(depositAmount, 0);

        // Bob buys the exact same amount second
        vm.prank(bob);
        uint256 bobMinted = abc.bondToMint(depositAmount, 0);

        // Bob must get fewer tokens (price is higher after Alice's purchase)
        assertLt(bobMinted, aliceMinted, "Later buyer must get fewer tokens for same deposit");
    }
}
