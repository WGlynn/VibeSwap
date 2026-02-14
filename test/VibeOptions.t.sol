// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/financial/VibeOptions.sol";
import "../contracts/financial/interfaces/IVibeOptions.sol";
import "../contracts/core/interfaces/IVibeAMM.sol";
import "../contracts/incentives/interfaces/IVolatilityOracle.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockOptToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockOptionsAMM {
    mapping(bytes32 => IVibeAMM.Pool) private _pools;
    mapping(bytes32 => uint256) private _spotPrices;
    mapping(bytes32 => uint256) private _twapPrices;

    function setPool(bytes32 poolId, address t0, address t1) external {
        _pools[poolId] = IVibeAMM.Pool({
            token0: t0,
            token1: t1,
            reserve0: 1000 ether,
            reserve1: 2_000_000 ether,
            totalLiquidity: 1000 ether,
            feeRate: 30,
            initialized: true
        });
    }

    function setSpotPrice(bytes32 poolId, uint256 price) external {
        _spotPrices[poolId] = price;
    }

    function setTWAP(bytes32 poolId, uint256 price) external {
        _twapPrices[poolId] = price;
    }

    function getPool(bytes32 poolId) external view returns (IVibeAMM.Pool memory) {
        return _pools[poolId];
    }

    function getSpotPrice(bytes32 poolId) external view returns (uint256) {
        return _spotPrices[poolId];
    }

    function getTWAP(bytes32 poolId, uint32) external view returns (uint256) {
        return _twapPrices[poolId];
    }
}

contract MockOptionsOracle {
    mapping(bytes32 => uint256) private _volatilities;

    function setVolatility(bytes32 poolId, uint256 vol) external {
        _volatilities[poolId] = vol;
    }

    function calculateRealizedVolatility(bytes32 poolId, uint32) external view returns (uint256) {
        return _volatilities[poolId];
    }
}

// ============ Test Contract ============

contract VibeOptionsTest is Test {
    VibeOptions public options;
    MockOptionsAMM public mockAmm;
    MockOptionsOracle public mockOracle;
    MockOptToken public token0; // WETH (underlying)
    MockOptToken public token1; // USDC (quote)

    address public alice; // writer
    address public bob;   // buyer
    address public charlie;

    bytes32 public poolId;

    uint256 constant SPOT_PRICE = 2000e18;   // 2000 USDC per WETH
    uint256 constant CALL_AMOUNT = 1 ether;  // 1 WETH
    uint256 constant CALL_STRIKE_ITM = 1800e18;
    uint256 constant CALL_STRIKE_OTM = 2200e18;
    uint256 constant CALL_PREMIUM = 0.1 ether; // in token0
    uint256 constant PUT_STRIKE_ITM = 2200e18;
    uint256 constant PUT_PREMIUM = 100e18;     // in token1

    function setUp() public {
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        charlie = makeAddr("charlie");

        token0 = new MockOptToken("Wrapped Ether", "WETH");
        token1 = new MockOptToken("USD Coin", "USDC");

        mockAmm = new MockOptionsAMM();
        mockOracle = new MockOptionsOracle();

        poolId = keccak256("WETH/USDC");
        mockAmm.setPool(poolId, address(token0), address(token1));
        mockAmm.setSpotPrice(poolId, SPOT_PRICE);
        mockAmm.setTWAP(poolId, SPOT_PRICE);
        mockOracle.setVolatility(poolId, 5000); // 50%

        options = new VibeOptions(address(mockAmm), address(mockOracle));

        // Fund users
        token0.mint(alice, 1000 ether);
        token1.mint(alice, 10_000_000 ether);
        token0.mint(bob, 1000 ether);
        token1.mint(bob, 10_000_000 ether);

        // Approve
        vm.startPrank(alice);
        token0.approve(address(options), type(uint256).max);
        token1.approve(address(options), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(bob);
        token0.approve(address(options), type(uint256).max);
        token1.approve(address(options), type(uint256).max);
        vm.stopPrank();
    }

    // ============ Helpers ============

    function _writeCall() internal returns (uint256) {
        vm.prank(alice);
        return options.writeOption(IVibeOptions.WriteParams({
            poolId: poolId,
            optionType: IVibeOptions.OptionType.CALL,
            amount: CALL_AMOUNT,
            strikePrice: CALL_STRIKE_ITM,
            premium: CALL_PREMIUM,
            expiry: uint40(block.timestamp + 30 days),
            exerciseWindow: uint40(1 days)
        }));
    }

    function _writeCallOTM() internal returns (uint256) {
        vm.prank(alice);
        return options.writeOption(IVibeOptions.WriteParams({
            poolId: poolId,
            optionType: IVibeOptions.OptionType.CALL,
            amount: CALL_AMOUNT,
            strikePrice: CALL_STRIKE_OTM,
            premium: CALL_PREMIUM,
            expiry: uint40(block.timestamp + 30 days),
            exerciseWindow: uint40(1 days)
        }));
    }

    function _writePut() internal returns (uint256) {
        vm.prank(alice);
        return options.writeOption(IVibeOptions.WriteParams({
            poolId: poolId,
            optionType: IVibeOptions.OptionType.PUT,
            amount: CALL_AMOUNT,
            strikePrice: PUT_STRIKE_ITM,
            premium: PUT_PREMIUM,
            expiry: uint40(block.timestamp + 30 days),
            exerciseWindow: uint40(1 days)
        }));
    }

    function _purchaseOption(uint256 optionId) internal {
        vm.prank(bob);
        options.purchase(optionId);
    }

    // ============ Write Tests ============

    function test_writeCall_depositsCollateral() public {
        uint256 balBefore = token0.balanceOf(alice);
        uint256 optionId = _writeCall();

        assertEq(optionId, 1);
        assertEq(options.ownerOf(optionId), alice);
        assertEq(options.totalOptions(), 1);
        assertEq(token0.balanceOf(alice), balBefore - CALL_AMOUNT);
        assertEq(token0.balanceOf(address(options)), CALL_AMOUNT);

        IVibeOptions.Option memory opt = options.getOption(optionId);
        assertEq(opt.writer, alice);
        assertEq(opt.amount, CALL_AMOUNT);
        assertEq(opt.strikePrice, CALL_STRIKE_ITM);
        assertEq(opt.collateral, CALL_AMOUNT);
        assertEq(opt.premium, CALL_PREMIUM);
        assertEq(uint8(opt.optionType), uint8(IVibeOptions.OptionType.CALL));
        assertEq(uint8(opt.state), uint8(IVibeOptions.OptionState.WRITTEN));

        uint256[] memory writerOpts = options.getOptionsByWriter(alice);
        assertEq(writerOpts.length, 1);
        assertEq(writerOpts[0], optionId);
    }

    function test_writePut_depositsCollateral() public {
        // PUT collateral = amount × strike / 1e18
        uint256 expectedCollateral = (CALL_AMOUNT * PUT_STRIKE_ITM) / 1e18; // 2200e18
        uint256 balBefore = token1.balanceOf(alice);

        uint256 optionId = _writePut();

        assertEq(token1.balanceOf(alice), balBefore - expectedCollateral);
        assertEq(token1.balanceOf(address(options)), expectedCollateral);

        IVibeOptions.Option memory opt = options.getOption(optionId);
        assertEq(opt.collateral, expectedCollateral);
        assertEq(uint8(opt.optionType), uint8(IVibeOptions.OptionType.PUT));
    }

    function test_writeOption_revertsInvalidPool() public {
        vm.prank(alice);
        vm.expectRevert(IVibeOptions.PoolNotInitialized.selector);
        options.writeOption(IVibeOptions.WriteParams({
            poolId: bytes32(uint256(0xdead)),
            optionType: IVibeOptions.OptionType.CALL,
            amount: CALL_AMOUNT,
            strikePrice: CALL_STRIKE_ITM,
            premium: CALL_PREMIUM,
            expiry: uint40(block.timestamp + 30 days),
            exerciseWindow: uint40(1 days)
        }));
    }

    function test_writeOption_revertsZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(IVibeOptions.InvalidAmount.selector);
        options.writeOption(IVibeOptions.WriteParams({
            poolId: poolId,
            optionType: IVibeOptions.OptionType.CALL,
            amount: 0,
            strikePrice: CALL_STRIKE_ITM,
            premium: CALL_PREMIUM,
            expiry: uint40(block.timestamp + 30 days),
            exerciseWindow: uint40(1 days)
        }));
    }

    function test_writeOption_revertsExpiryInPast() public {
        vm.prank(alice);
        vm.expectRevert(IVibeOptions.InvalidExpiry.selector);
        options.writeOption(IVibeOptions.WriteParams({
            poolId: poolId,
            optionType: IVibeOptions.OptionType.CALL,
            amount: CALL_AMOUNT,
            strikePrice: CALL_STRIKE_ITM,
            premium: CALL_PREMIUM,
            expiry: uint40(block.timestamp - 1),
            exerciseWindow: uint40(1 days)
        }));
    }

    function test_writeOption_revertsZeroExerciseWindow() public {
        vm.prank(alice);
        vm.expectRevert(IVibeOptions.InvalidExerciseWindow.selector);
        options.writeOption(IVibeOptions.WriteParams({
            poolId: poolId,
            optionType: IVibeOptions.OptionType.CALL,
            amount: CALL_AMOUNT,
            strikePrice: CALL_STRIKE_ITM,
            premium: CALL_PREMIUM,
            expiry: uint40(block.timestamp + 30 days),
            exerciseWindow: 0
        }));
    }

    // ============ Purchase Tests ============

    function test_purchase_transfersPremiumAndNFT() public {
        uint256 optionId = _writeCall();

        uint256 aliceBal = token0.balanceOf(alice);
        uint256 bobBal = token0.balanceOf(bob);

        _purchaseOption(optionId);

        // Premium transferred from bob to alice
        assertEq(token0.balanceOf(alice), aliceBal + CALL_PREMIUM);
        assertEq(token0.balanceOf(bob), bobBal - CALL_PREMIUM);

        // NFT transferred to bob
        assertEq(options.ownerOf(optionId), bob);

        // State updated
        IVibeOptions.Option memory opt = options.getOption(optionId);
        assertEq(uint8(opt.state), uint8(IVibeOptions.OptionState.ACTIVE));
    }

    function test_purchase_revertsAlreadyPurchased() public {
        uint256 optionId = _writeCall();
        _purchaseOption(optionId);

        vm.prank(charlie);
        vm.expectRevert(IVibeOptions.OptionAlreadyPurchased.selector);
        options.purchase(optionId);
    }

    function test_purchase_revertsExpired() public {
        uint256 optionId = _writeCall();

        vm.warp(block.timestamp + 31 days);

        vm.prank(bob);
        vm.expectRevert(IVibeOptions.OptionExpired.selector);
        options.purchase(optionId);
    }

    // ============ Exercise Tests ============

    function test_exerciseCall_ITM() public {
        uint256 optionId = _writeCall();
        _purchaseOption(optionId);

        // Warp to expiry
        vm.warp(block.timestamp + 30 days);

        // Expected payoff: amount × (settlement - strike) / settlement
        // = 1e18 × (2000e18 - 1800e18) / 2000e18 = 1e18 × 200e18 / 2000e18 = 0.1e18
        uint256 expectedPayoff = (CALL_AMOUNT * (SPOT_PRICE - CALL_STRIKE_ITM)) / SPOT_PRICE;

        uint256 bobBal = token0.balanceOf(bob);

        vm.prank(bob);
        options.exercise(optionId);

        assertEq(token0.balanceOf(bob), bobBal + expectedPayoff);

        IVibeOptions.Option memory opt = options.getOption(optionId);
        assertEq(uint8(opt.state), uint8(IVibeOptions.OptionState.EXERCISED));
        assertEq(opt.collateral, CALL_AMOUNT - expectedPayoff);
    }

    function test_exercisePut_ITM() public {
        uint256 optionId = _writePut();
        _purchaseOption(optionId);

        vm.warp(block.timestamp + 30 days);

        // Expected payoff: amount × (strike - settlement) / 1e18
        // = 1e18 × (2200e18 - 2000e18) / 1e18 = 200e18
        uint256 expectedPayoff = (CALL_AMOUNT * (PUT_STRIKE_ITM - SPOT_PRICE)) / 1e18;
        uint256 expectedCollateral = (CALL_AMOUNT * PUT_STRIKE_ITM) / 1e18;

        uint256 bobBal = token1.balanceOf(bob);

        vm.prank(bob);
        options.exercise(optionId);

        assertEq(token1.balanceOf(bob), bobBal + expectedPayoff);

        IVibeOptions.Option memory opt = options.getOption(optionId);
        assertEq(uint8(opt.state), uint8(IVibeOptions.OptionState.EXERCISED));
        assertEq(opt.collateral, expectedCollateral - expectedPayoff);
    }

    function test_exercise_revertsBeforeExpiry() public {
        uint256 optionId = _writeCall();
        _purchaseOption(optionId);

        // Don't warp — still before expiry
        vm.prank(bob);
        vm.expectRevert(IVibeOptions.OptionNotExpired.selector);
        options.exercise(optionId);
    }

    function test_exercise_revertsAfterWindow() public {
        uint256 optionId = _writeCall();
        _purchaseOption(optionId);

        // Warp past exercise window (30 days + 1 day + 1 second)
        vm.warp(block.timestamp + 31 days + 1);

        vm.prank(bob);
        vm.expectRevert(IVibeOptions.ExerciseWindowClosed.selector);
        options.exercise(optionId);
    }

    function test_exercise_revertsOTM() public {
        uint256 optionId = _writeCallOTM(); // strike 2200 > spot 2000
        _purchaseOption(optionId);

        vm.warp(block.timestamp + 30 days);

        vm.prank(bob);
        vm.expectRevert(IVibeOptions.OptionOutOfTheMoney.selector);
        options.exercise(optionId);
    }

    function test_exercise_revertsNotHolder() public {
        uint256 optionId = _writeCall();
        _purchaseOption(optionId);

        vm.warp(block.timestamp + 30 days);

        // Charlie is not the holder
        vm.prank(charlie);
        vm.expectRevert();
        options.exercise(optionId);
    }

    function test_exercise_revertsAlreadyExercised() public {
        uint256 optionId = _writeCall();
        _purchaseOption(optionId);

        vm.warp(block.timestamp + 30 days);

        vm.prank(bob);
        options.exercise(optionId);

        vm.prank(bob);
        vm.expectRevert(IVibeOptions.OptionAlreadyExercised.selector);
        options.exercise(optionId);
    }

    function test_exercise_revertsNotActive() public {
        uint256 optionId = _writeCall();
        // Don't purchase — state is WRITTEN

        vm.warp(block.timestamp + 30 days);

        vm.prank(alice); // alice owns NFT in WRITTEN state
        vm.expectRevert(IVibeOptions.OptionNotActive.selector);
        options.exercise(optionId);
    }

    // ============ Reclaim Tests ============

    function test_reclaim_unexercised_fullCollateral() public {
        uint256 optionId = _writeCall();
        _purchaseOption(optionId);

        // Warp past exercise window — bob doesn't exercise
        vm.warp(block.timestamp + 31 days + 1);

        uint256 aliceBal = token0.balanceOf(alice);

        vm.prank(alice);
        options.reclaim(optionId);

        // Alice gets full collateral back
        assertEq(token0.balanceOf(alice), aliceBal + CALL_AMOUNT);

        IVibeOptions.Option memory opt = options.getOption(optionId);
        assertEq(uint8(opt.state), uint8(IVibeOptions.OptionState.RECLAIMED));
        assertEq(opt.collateral, 0);
    }

    function test_reclaim_afterExercise_remainder() public {
        uint256 optionId = _writeCall();
        _purchaseOption(optionId);

        vm.warp(block.timestamp + 30 days);

        // Bob exercises
        vm.prank(bob);
        options.exercise(optionId);

        uint256 expectedPayoff = (CALL_AMOUNT * (SPOT_PRICE - CALL_STRIKE_ITM)) / SPOT_PRICE;
        uint256 remainder = CALL_AMOUNT - expectedPayoff;

        // Warp past exercise window
        vm.warp(block.timestamp + 1 days + 1);

        uint256 aliceBal = token0.balanceOf(alice);

        vm.prank(alice);
        options.reclaim(optionId);

        assertEq(token0.balanceOf(alice), aliceBal + remainder);
    }

    function test_reclaim_revertsBeforeWindowEnd() public {
        uint256 optionId = _writeCall();
        _purchaseOption(optionId);

        // Warp to expiry but not past exercise window
        vm.warp(block.timestamp + 30 days);

        vm.prank(alice);
        vm.expectRevert(IVibeOptions.OptionNotExpired.selector);
        options.reclaim(optionId);
    }

    function test_reclaim_revertsNotWriter() public {
        uint256 optionId = _writeCall();
        _purchaseOption(optionId);

        vm.warp(block.timestamp + 31 days + 1);

        vm.prank(bob);
        vm.expectRevert(IVibeOptions.NotOptionWriter.selector);
        options.reclaim(optionId);
    }

    function test_reclaim_revertsAlreadyReclaimed() public {
        uint256 optionId = _writeCall();
        _purchaseOption(optionId);

        vm.warp(block.timestamp + 31 days + 1);

        vm.prank(alice);
        options.reclaim(optionId);

        vm.prank(alice);
        vm.expectRevert(IVibeOptions.OptionAlreadyReclaimed.selector);
        options.reclaim(optionId);
    }

    // ============ Cancel Tests ============

    function test_cancel_unpurchased_returnsCollateral() public {
        uint256 optionId = _writeCall();
        uint256 aliceBal = token0.balanceOf(alice);

        vm.prank(alice);
        options.cancel(optionId);

        // Collateral returned
        assertEq(token0.balanceOf(alice), aliceBal + CALL_AMOUNT);
        assertEq(token0.balanceOf(address(options)), 0);

        // NFT burned
        vm.expectRevert();
        options.ownerOf(optionId);

        // Owner tracking cleared
        uint256[] memory aliceOpts = options.getOptionsByOwner(alice);
        assertEq(aliceOpts.length, 0);
    }

    function test_cancel_revertsAlreadyPurchased() public {
        uint256 optionId = _writeCall();
        _purchaseOption(optionId);

        vm.prank(alice);
        vm.expectRevert(IVibeOptions.OptionAlreadyPurchased.selector);
        options.cancel(optionId);
    }

    function test_cancel_revertsNotWriter() public {
        uint256 optionId = _writeCall();

        vm.prank(bob);
        vm.expectRevert(IVibeOptions.NotOptionWriter.selector);
        options.cancel(optionId);
    }

    // ============ Premium Suggestion Tests ============

    function test_suggestPremium_ITMCall() public view {
        // Spot 2000, strike 1800 → ITM call
        uint256 premium = options.suggestPremium(
            poolId,
            IVibeOptions.OptionType.CALL,
            1 ether,
            1800e18,
            uint40(block.timestamp + 30 days)
        );

        assertGt(premium, 0);

        // Should include intrinsic: (2000 - 1800) × 1 / 1 = 200 (in token1 scale)
        uint256 intrinsic = ((SPOT_PRICE - 1800e18) * 1 ether) / 1e18;
        assertGe(premium, intrinsic); // premium >= intrinsic
    }

    function test_suggestPremium_OTMCall_positiveTimeValue() public view {
        // Spot 2000, strike 2200 → OTM call (no intrinsic)
        uint256 premium = options.suggestPremium(
            poolId,
            IVibeOptions.OptionType.CALL,
            1 ether,
            2200e18,
            uint40(block.timestamp + 30 days)
        );

        // Should have positive time value even though OTM
        assertGt(premium, 0);
    }

    function test_suggestPremium_longerExpiry_higherPremium() public view {
        uint256 premium30d = options.suggestPremium(
            poolId,
            IVibeOptions.OptionType.CALL,
            1 ether,
            2000e18,
            uint40(block.timestamp + 30 days)
        );

        uint256 premium90d = options.suggestPremium(
            poolId,
            IVibeOptions.OptionType.CALL,
            1 ether,
            2000e18,
            uint40(block.timestamp + 90 days)
        );

        assertGt(premium90d, premium30d);
    }

    // ============ Integration Tests ============

    function test_fullLifecycle_call() public {
        // 1. Write
        uint256 optionId = _writeCall();
        assertEq(options.ownerOf(optionId), alice);
        assertEq(options.totalOptions(), 1);

        // 2. Purchase
        uint256 aliceBalAfterWrite = token0.balanceOf(alice);
        _purchaseOption(optionId);
        assertEq(options.ownerOf(optionId), bob);
        assertEq(token0.balanceOf(alice), aliceBalAfterWrite + CALL_PREMIUM);

        // 3. Warp to expiry
        vm.warp(block.timestamp + 30 days);

        // 4. Exercise
        uint256 expectedPayoff = (CALL_AMOUNT * (SPOT_PRICE - CALL_STRIKE_ITM)) / SPOT_PRICE;
        uint256 bobBal = token0.balanceOf(bob);

        vm.prank(bob);
        options.exercise(optionId);
        assertEq(token0.balanceOf(bob), bobBal + expectedPayoff);

        // 5. Warp past exercise window
        vm.warp(block.timestamp + 1 days + 1);

        // 6. Reclaim remainder
        uint256 remainder = CALL_AMOUNT - expectedPayoff;
        uint256 aliceBal = token0.balanceOf(alice);

        vm.prank(alice);
        options.reclaim(optionId);
        assertEq(token0.balanceOf(alice), aliceBal + remainder);

        // 7. Verify final state
        IVibeOptions.Option memory opt = options.getOption(optionId);
        assertEq(uint8(opt.state), uint8(IVibeOptions.OptionState.RECLAIMED));
        assertEq(opt.collateral, 0);

        // No tokens left in contract
        assertEq(token0.balanceOf(address(options)), 0);
    }

    function test_fullLifecycle_put() public {
        // 1. Write PUT
        uint256 optionId = _writePut();
        uint256 expectedCollateral = (CALL_AMOUNT * PUT_STRIKE_ITM) / 1e18;
        assertEq(token1.balanceOf(address(options)), expectedCollateral);

        // 2. Purchase
        uint256 aliceBalAfterWrite = token1.balanceOf(alice);
        _purchaseOption(optionId);
        assertEq(token1.balanceOf(alice), aliceBalAfterWrite + PUT_PREMIUM);

        // 3. Warp to expiry
        vm.warp(block.timestamp + 30 days);

        // 4. Exercise
        uint256 expectedPayoff = (CALL_AMOUNT * (PUT_STRIKE_ITM - SPOT_PRICE)) / 1e18;
        uint256 bobBal = token1.balanceOf(bob);

        vm.prank(bob);
        options.exercise(optionId);
        assertEq(token1.balanceOf(bob), bobBal + expectedPayoff);

        // 5. Warp past exercise window
        vm.warp(block.timestamp + 1 days + 1);

        // 6. Reclaim remainder
        uint256 remainder = expectedCollateral - expectedPayoff;
        uint256 aliceBal = token1.balanceOf(alice);

        vm.prank(alice);
        options.reclaim(optionId);
        assertEq(token1.balanceOf(alice), aliceBal + remainder);

        // No token1 left in contract
        assertEq(token1.balanceOf(address(options)), 0);
    }

    function test_secondaryTransfer_exercise() public {
        // 1. Write
        uint256 optionId = _writeCall();

        // 2. Purchase (bob gets NFT)
        _purchaseOption(optionId);
        assertEq(options.ownerOf(optionId), bob);

        // 3. Bob transfers NFT to charlie
        vm.prank(bob);
        options.transferFrom(bob, charlie, optionId);
        assertEq(options.ownerOf(optionId), charlie);

        // Ownership tracking updated
        assertEq(options.getOptionsByOwner(bob).length, 0);
        assertEq(options.getOptionsByOwner(charlie).length, 1);
        assertEq(options.getOptionsByOwner(charlie)[0], optionId);

        // 4. Warp to expiry
        vm.warp(block.timestamp + 30 days);

        // 5. Charlie exercises — new holder gets payoff
        uint256 expectedPayoff = (CALL_AMOUNT * (SPOT_PRICE - CALL_STRIKE_ITM)) / SPOT_PRICE;
        uint256 charlieBal = token0.balanceOf(charlie);

        vm.prank(charlie);
        options.exercise(optionId);

        assertEq(token0.balanceOf(charlie), charlieBal + expectedPayoff);
    }
}
