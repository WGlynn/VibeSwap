// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/financial/VibeOptions.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockOptToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockAMM {
    bytes32 public testPoolId;
    address public token0;
    address public token1;
    uint256 public spotPrice;
    uint256 public twapPrice;

    function setup(address _t0, address _t1, uint256 _spot) external {
        token0 = _t0;
        token1 = _t1;
        testPoolId = keccak256(abi.encodePacked(_t0, _t1));
        spotPrice = _spot;
        twapPrice = _spot;
    }

    function setSpot(uint256 price) external { spotPrice = price; }
    function setTWAP(uint256 price) external { twapPrice = price; }

    function getPool(bytes32) external view returns (IVibeAMM.Pool memory) {
        return IVibeAMM.Pool({
            token0: token0,
            token1: token1,
            reserve0: 1000e18,
            reserve1: 2_000_000e18,
            totalLiquidity: 1000e18,
            feeRate: 30,
            initialized: true
        });
    }

    function getSpotPrice(bytes32) external view returns (uint256) { return spotPrice; }
    function getTWAP(bytes32, uint32) external view returns (uint256) { return twapPrice; }
}

contract MockVolOracle {
    uint256 public vol = 5000; // 50%

    function setVol(uint256 v) external { vol = v; }

    function calculateRealizedVolatility(bytes32, uint32) external view returns (uint256) {
        return vol;
    }
    function getDynamicFeeMultiplier(bytes32) external pure returns (uint256) { return 1e18; }
    function getVolatilityTier(bytes32) external pure returns (uint8) { return 0; }
    function updateVolatility(bytes32) external {}
    function getVolatilityData(bytes32) external view returns (uint256, uint8, uint64) {
        return (vol, 0, uint64(block.timestamp));
    }
}

// ============ Tests ============

contract VibeOptionsTest is Test {
    VibeOptions public options;
    MockAMM public amm;
    MockVolOracle public volOracle;
    MockOptToken public weth;  // token0 (call collateral)
    MockOptToken public usdc;  // token1 (put collateral)

    address alice = address(0xA1); // writer
    address bob = address(0xB0);   // buyer
    address owner;

    bytes32 poolId;
    uint256 constant SPOT_PRICE = 2000e18;
    uint256 constant STRIKE_CALL = 2100e18; // OTM call
    uint256 constant STRIKE_PUT = 1900e18;  // OTM put
    uint40 expiry;

    function setUp() public {
        owner = address(this);
        vm.warp(1000);

        weth = new MockOptToken("WETH", "WETH");
        usdc = new MockOptToken("USDC", "USDC");

        amm = new MockAMM();
        amm.setup(address(weth), address(usdc), SPOT_PRICE);
        poolId = amm.testPoolId();

        volOracle = new MockVolOracle();

        options = new VibeOptions(address(amm), address(volOracle));

        expiry = uint40(block.timestamp) + 30 days;

        // Fund users
        weth.mint(alice, 1000e18);
        weth.mint(bob, 1000e18);
        usdc.mint(alice, 10_000_000e18);
        usdc.mint(bob, 10_000_000e18);

        vm.prank(alice);
        weth.approve(address(options), type(uint256).max);
        vm.prank(alice);
        usdc.approve(address(options), type(uint256).max);
        vm.prank(bob);
        weth.approve(address(options), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(options), type(uint256).max);
    }

    // ============ Helpers ============

    function _writeCall(address writer, uint256 amount, uint256 strike, uint256 premium)
        internal returns (uint256)
    {
        vm.prank(writer);
        return options.writeOption(IVibeOptions.WriteParams({
            poolId: poolId,
            optionType: IVibeOptions.OptionType.CALL,
            amount: amount,
            strikePrice: strike,
            premium: premium,
            expiry: expiry,
            exerciseWindow: 7 days
        }));
    }

    function _writePut(address writer, uint256 amount, uint256 strike, uint256 premium)
        internal returns (uint256)
    {
        vm.prank(writer);
        return options.writeOption(IVibeOptions.WriteParams({
            poolId: poolId,
            optionType: IVibeOptions.OptionType.PUT,
            amount: amount,
            strikePrice: strike,
            premium: premium,
            expiry: expiry,
            exerciseWindow: 7 days
        }));
    }

    // ============ Constructor ============

    function test_constructor() public view {
        assertEq(address(options.amm()), address(amm));
        assertEq(address(options.volatilityOracle()), address(volOracle));
        assertEq(options.totalOptions(), 0);
    }

    // ============ Write Option ============

    function test_writeCall() public {
        uint256 optId = _writeCall(alice, 1e18, STRIKE_CALL, 0.1e18);

        IVibeOptions.Option memory opt = options.getOption(optId);
        assertEq(opt.writer, alice);
        assertEq(opt.amount, 1e18);
        assertEq(opt.strikePrice, STRIKE_CALL);
        assertEq(opt.collateral, 1e18); // CALL: collateral = amount
        assertTrue(opt.optionType == IVibeOptions.OptionType.CALL);
        assertTrue(opt.state == IVibeOptions.OptionState.WRITTEN);
    }

    function test_writePut() public {
        uint256 optId = _writePut(alice, 1e18, STRIKE_PUT, 50e18);

        IVibeOptions.Option memory opt = options.getOption(optId);
        assertEq(opt.writer, alice);
        assertTrue(opt.optionType == IVibeOptions.OptionType.PUT);
        // PUT collateral = amount * strike / 1e18 = 1 * 1900 = 1900
        assertEq(opt.collateral, 1900e18);
    }

    function test_writeCallDepositsCollateral() public {
        uint256 balBefore = weth.balanceOf(alice);
        _writeCall(alice, 5e18, STRIKE_CALL, 0);
        assertEq(weth.balanceOf(alice), balBefore - 5e18);
    }

    function test_writePutDepositsCollateral() public {
        uint256 balBefore = usdc.balanceOf(alice);
        _writePut(alice, 1e18, STRIKE_PUT, 0);
        assertEq(usdc.balanceOf(alice), balBefore - 1900e18);
    }

    function test_revertWriteZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(IVibeOptions.InvalidAmount.selector);
        options.writeOption(IVibeOptions.WriteParams({
            poolId: poolId, optionType: IVibeOptions.OptionType.CALL,
            amount: 0, strikePrice: STRIKE_CALL, premium: 0,
            expiry: expiry, exerciseWindow: 7 days
        }));
    }

    function test_revertWriteZeroStrike() public {
        vm.prank(alice);
        vm.expectRevert(IVibeOptions.InvalidStrikePrice.selector);
        options.writeOption(IVibeOptions.WriteParams({
            poolId: poolId, optionType: IVibeOptions.OptionType.CALL,
            amount: 1e18, strikePrice: 0, premium: 0,
            expiry: expiry, exerciseWindow: 7 days
        }));
    }

    function test_revertWritePastExpiry() public {
        vm.prank(alice);
        vm.expectRevert(IVibeOptions.InvalidExpiry.selector);
        options.writeOption(IVibeOptions.WriteParams({
            poolId: poolId, optionType: IVibeOptions.OptionType.CALL,
            amount: 1e18, strikePrice: STRIKE_CALL, premium: 0,
            expiry: uint40(block.timestamp) - 1, exerciseWindow: 7 days
        }));
    }

    function test_revertWriteZeroExerciseWindow() public {
        vm.prank(alice);
        vm.expectRevert(IVibeOptions.InvalidExerciseWindow.selector);
        options.writeOption(IVibeOptions.WriteParams({
            poolId: poolId, optionType: IVibeOptions.OptionType.CALL,
            amount: 1e18, strikePrice: STRIKE_CALL, premium: 0,
            expiry: expiry, exerciseWindow: 0
        }));
    }

    // ============ Purchase ============

    function test_purchase() public {
        uint256 optId = _writeCall(alice, 1e18, STRIKE_CALL, 0.1e18);

        uint256 aliceBal = weth.balanceOf(alice);
        vm.prank(bob);
        options.purchase(optId);

        IVibeOptions.Option memory opt = options.getOption(optId);
        assertTrue(opt.state == IVibeOptions.OptionState.ACTIVE);
        assertEq(options.ownerOf(optId), bob);
        // Alice received premium
        assertEq(weth.balanceOf(alice), aliceBal + 0.1e18);
    }

    function test_purchaseZeroPremium() public {
        uint256 optId = _writeCall(alice, 1e18, STRIKE_CALL, 0);
        vm.prank(bob);
        options.purchase(optId);
        assertTrue(options.getOption(optId).state == IVibeOptions.OptionState.ACTIVE);
    }

    function test_revertPurchaseAlreadyPurchased() public {
        uint256 optId = _writeCall(alice, 1e18, STRIKE_CALL, 0);
        vm.prank(bob);
        options.purchase(optId);
        vm.prank(bob);
        vm.expectRevert(IVibeOptions.OptionAlreadyPurchased.selector);
        options.purchase(optId);
    }

    function test_revertPurchaseExpired() public {
        uint256 optId = _writeCall(alice, 1e18, STRIKE_CALL, 0);
        vm.warp(expiry);
        vm.prank(bob);
        vm.expectRevert(IVibeOptions.OptionExpired.selector);
        options.purchase(optId);
    }

    // ============ Exercise ============

    function test_exerciseCallITM() public {
        uint256 optId = _writeCall(alice, 1e18, 1800e18, 0); // ITM strike
        vm.prank(bob);
        options.purchase(optId);

        // At expiry, price = 2000 > strike = 1800 → ITM
        vm.warp(expiry);
        amm.setTWAP(SPOT_PRICE);

        uint256 bobBal = weth.balanceOf(bob);
        vm.prank(bob);
        options.exercise(optId);

        // Payoff = amount * (settlement - strike) / settlement
        // = 1e18 * (2000 - 1800) / 2000 = 0.1e18
        assertEq(weth.balanceOf(bob) - bobBal, 0.1e18);

        IVibeOptions.Option memory opt = options.getOption(optId);
        assertTrue(opt.state == IVibeOptions.OptionState.EXERCISED);
    }

    function test_exercisePutITM() public {
        // Put with strike 2100, spot will be 2000 → ITM
        uint256 optId = _writePut(alice, 1e18, 2100e18, 0);
        vm.prank(bob);
        options.purchase(optId);

        vm.warp(expiry);
        amm.setTWAP(SPOT_PRICE); // 2000 < 2100 → put ITM

        uint256 bobBal = usdc.balanceOf(bob);
        vm.prank(bob);
        options.exercise(optId);

        // PUT payoff = amount * (strike - settlement) / 1e18
        // = 1e18 * (2100 - 2000) / 1e18 = 100e18
        assertEq(usdc.balanceOf(bob) - bobBal, 100e18);
    }

    function test_revertExerciseOTM() public {
        uint256 optId = _writeCall(alice, 1e18, STRIKE_CALL, 0); // strike 2100
        vm.prank(bob);
        options.purchase(optId);

        vm.warp(expiry);
        amm.setTWAP(SPOT_PRICE); // 2000 < 2100 → OTM

        vm.prank(bob);
        vm.expectRevert(IVibeOptions.OptionOutOfTheMoney.selector);
        options.exercise(optId);
    }

    function test_revertExerciseBeforeExpiry() public {
        uint256 optId = _writeCall(alice, 1e18, 1800e18, 0);
        vm.prank(bob);
        options.purchase(optId);

        vm.prank(bob);
        vm.expectRevert(IVibeOptions.OptionNotExpired.selector);
        options.exercise(optId);
    }

    function test_revertExerciseAfterWindow() public {
        uint256 optId = _writeCall(alice, 1e18, 1800e18, 0);
        vm.prank(bob);
        options.purchase(optId);

        vm.warp(uint256(expiry) + 7 days + 1);

        vm.prank(bob);
        vm.expectRevert(IVibeOptions.ExerciseWindowClosed.selector);
        options.exercise(optId);
    }

    function test_revertExerciseNotActive() public {
        uint256 optId = _writeCall(alice, 1e18, 1800e18, 0);
        // Not purchased yet (WRITTEN state)
        vm.warp(expiry);
        vm.prank(alice);
        vm.expectRevert(IVibeOptions.OptionNotActive.selector);
        options.exercise(optId);
    }

    // ============ Cancel ============

    function test_cancel() public {
        uint256 optId = _writeCall(alice, 1e18, STRIKE_CALL, 0);

        uint256 aliceBal = weth.balanceOf(alice);
        vm.prank(alice);
        options.cancel(optId);

        assertEq(weth.balanceOf(alice), aliceBal + 1e18); // collateral returned

        // NFT burned
        vm.expectRevert();
        options.ownerOf(optId);
    }

    function test_revertCancelAlreadyPurchased() public {
        uint256 optId = _writeCall(alice, 1e18, STRIKE_CALL, 0);
        vm.prank(bob);
        options.purchase(optId);

        vm.prank(alice);
        vm.expectRevert(IVibeOptions.OptionAlreadyPurchased.selector);
        options.cancel(optId);
    }

    function test_revertCancelNotWriter() public {
        uint256 optId = _writeCall(alice, 1e18, STRIKE_CALL, 0);
        vm.prank(bob);
        vm.expectRevert(IVibeOptions.NotOptionWriter.selector);
        options.cancel(optId);
    }

    // ============ Reclaim ============

    function test_reclaimAfterExercise() public {
        uint256 optId = _writeCall(alice, 1e18, 1800e18, 0);
        vm.prank(bob);
        options.purchase(optId);

        vm.warp(expiry);
        amm.setTWAP(SPOT_PRICE);
        vm.prank(bob);
        options.exercise(optId);

        // Wait for exercise window to close
        vm.warp(uint256(expiry) + 7 days + 1);

        uint256 aliceBal = weth.balanceOf(alice);
        vm.prank(alice);
        options.reclaim(optId);

        // Remaining collateral = 1e18 - 0.1e18 payoff = 0.9e18
        assertEq(weth.balanceOf(alice) - aliceBal, 0.9e18);
    }

    function test_reclaimUnexercised() public {
        uint256 optId = _writeCall(alice, 1e18, STRIKE_CALL, 0);
        vm.prank(bob);
        options.purchase(optId);

        // Expire without exercise
        vm.warp(uint256(expiry) + 7 days + 1);

        uint256 aliceBal = weth.balanceOf(alice);
        vm.prank(alice);
        options.reclaim(optId);

        assertEq(weth.balanceOf(alice) - aliceBal, 1e18); // full collateral
    }

    function test_revertReclaimNotWriter() public {
        uint256 optId = _writeCall(alice, 1e18, STRIKE_CALL, 0);
        vm.prank(bob);
        options.purchase(optId);

        vm.warp(uint256(expiry) + 7 days + 1);

        vm.prank(bob);
        vm.expectRevert(IVibeOptions.NotOptionWriter.selector);
        options.reclaim(optId);
    }

    function test_revertReclaimBeforeWindowClosed() public {
        uint256 optId = _writeCall(alice, 1e18, STRIKE_CALL, 0);
        vm.prank(bob);
        options.purchase(optId);

        vm.warp(expiry + 1);

        vm.prank(alice);
        vm.expectRevert(IVibeOptions.OptionNotExpired.selector);
        options.reclaim(optId);
    }

    // ============ View Functions ============

    function test_isITM() public {
        // OTM call: strike 2100, spot 2000
        uint256 optId = _writeCall(alice, 1e18, 2100e18, 0);
        assertFalse(options.isITM(optId));

        // ITM call: strike 1800, spot 2000
        uint256 optId2 = _writeCall(alice, 1e18, 1800e18, 0);
        assertTrue(options.isITM(optId2));
    }

    function test_getPayoff() public {
        uint256 optId = _writeCall(alice, 1e18, 1800e18, 0);
        uint256 payoff = options.getPayoff(optId);
        // (2000 - 1800) / 2000 * 1e18 = 0.1e18
        assertEq(payoff, 0.1e18);
    }

    function test_suggestPremium() public view {
        uint256 premium = options.suggestPremium(
            poolId,
            IVibeOptions.OptionType.CALL,
            1e18,
            STRIKE_CALL,
            expiry
        );
        assertGt(premium, 0);
    }

    function test_getOptionsByWriter() public {
        _writeCall(alice, 1e18, STRIKE_CALL, 0);
        _writeCall(alice, 1e18, 1800e18, 0);

        uint256[] memory ids = options.getOptionsByWriter(alice);
        assertEq(ids.length, 2);
    }

    function test_totalOptions() public {
        _writeCall(alice, 1e18, STRIKE_CALL, 0);
        assertEq(options.totalOptions(), 1);
    }

    // ============ Full Lifecycle ============

    function test_callLifecycle() public {
        // 1. Alice writes ITM call (strike 1800)
        uint256 optId = _writeCall(alice, 5e18, 1800e18, 0.5e18);

        // 2. Bob purchases
        vm.prank(bob);
        options.purchase(optId);

        // 3. Price moves to 2200 at expiry
        vm.warp(expiry);
        amm.setTWAP(2200e18);

        // 4. Bob exercises
        uint256 bobBal = weth.balanceOf(bob);
        vm.prank(bob);
        options.exercise(optId);

        // Payoff = 5 * (2200-1800)/2200 = 5 * 400/2200 ≈ 0.909e18
        uint256 payoff = weth.balanceOf(bob) - bobBal;
        assertGt(payoff, 0);

        // 5. Alice reclaims remaining after window
        vm.warp(uint256(expiry) + 7 days + 1);
        uint256 aliceBal = weth.balanceOf(alice);
        vm.prank(alice);
        options.reclaim(optId);
        assertEq(weth.balanceOf(alice) - aliceBal, 5e18 - payoff);
    }

    function test_putLifecycle() public {
        // 1. Alice writes put (strike 2200)
        uint256 optId = _writePut(alice, 2e18, 2200e18, 10e18);

        // 2. Bob purchases
        vm.prank(bob);
        options.purchase(optId);

        // 3. Price drops to 1800
        vm.warp(expiry);
        amm.setTWAP(1800e18);

        // 4. Bob exercises
        uint256 bobBal = usdc.balanceOf(bob);
        vm.prank(bob);
        options.exercise(optId);

        // PUT payoff = 2 * (2200-1800) / 1e18 * 1e18 = 800e18
        assertEq(usdc.balanceOf(bob) - bobBal, 800e18);
    }

    function test_otmExpiry() public {
        // Call expires OTM → writer gets full collateral back
        uint256 optId = _writeCall(alice, 1e18, STRIKE_CALL, 0);
        vm.prank(bob);
        options.purchase(optId);

        vm.warp(uint256(expiry) + 7 days + 1);

        uint256 aliceBal = weth.balanceOf(alice);
        vm.prank(alice);
        options.reclaim(optId);
        assertEq(weth.balanceOf(alice) - aliceBal, 1e18);
    }

    // ERC-721 receiver
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }
}
