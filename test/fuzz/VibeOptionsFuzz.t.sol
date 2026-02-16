// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/financial/VibeOptions.sol";
import "../../contracts/financial/interfaces/IVibeOptions.sol";
import "../../contracts/core/interfaces/IVibeAMM.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockOptFToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockOptFAMM {
    mapping(bytes32 => IVibeAMM.Pool) private _pools;
    mapping(bytes32 => uint256) private _spotPrices;
    mapping(bytes32 => uint256) private _twapPrices;

    function setPool(bytes32 poolId, address t0, address t1) external {
        _pools[poolId] = IVibeAMM.Pool({
            token0: t0, token1: t1,
            reserve0: 1000 ether, reserve1: 2_000_000 ether,
            totalLiquidity: 1000 ether, feeRate: 30, initialized: true
        });
    }

    function setSpotPrice(bytes32 poolId, uint256 price) external { _spotPrices[poolId] = price; }
    function setTWAP(bytes32 poolId, uint256 price) external { _twapPrices[poolId] = price; }
    function getPool(bytes32 poolId) external view returns (IVibeAMM.Pool memory) { return _pools[poolId]; }
    function getSpotPrice(bytes32 poolId) external view returns (uint256) { return _spotPrices[poolId]; }
    function getTWAP(bytes32 poolId, uint32) external view returns (uint256) { return _twapPrices[poolId]; }
}

contract MockOptFOracle {
    function calculateRealizedVolatility(bytes32, uint32) external pure returns (uint256) { return 5000; }
}

// ============ Fuzz Tests ============

contract VibeOptionsFuzzTest is Test {
    VibeOptions public options;
    MockOptFAMM public mockAmm;
    MockOptFOracle public mockOracle;
    MockOptFToken public token0;
    MockOptFToken public token1;

    address public writer;
    address public buyer;
    bytes32 public poolId;

    uint256 constant SPOT_PRICE = 2000e18;

    function setUp() public {
        writer = makeAddr("writer");
        buyer = makeAddr("buyer");

        token0 = new MockOptFToken("WETH", "WETH");
        token1 = new MockOptFToken("USDC", "USDC");

        mockAmm = new MockOptFAMM();
        mockOracle = new MockOptFOracle();

        poolId = keccak256("WETH/USDC");
        mockAmm.setPool(poolId, address(token0), address(token1));
        mockAmm.setSpotPrice(poolId, SPOT_PRICE);
        mockAmm.setTWAP(poolId, SPOT_PRICE);

        options = new VibeOptions(address(mockAmm), address(mockOracle));

        token0.mint(writer, 100_000 ether);
        token1.mint(writer, 1_000_000_000 ether);
        token0.mint(buyer, 100_000 ether);
        token1.mint(buyer, 1_000_000_000 ether);

        vm.startPrank(writer);
        token0.approve(address(options), type(uint256).max);
        token1.approve(address(options), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(buyer);
        token0.approve(address(options), type(uint256).max);
        token1.approve(address(options), type(uint256).max);
        vm.stopPrank();
    }

    // ============ Fuzz: CALL collateral = amount ============

    function testFuzz_callCollateralEqualsAmount(uint256 amount) public {
        amount = bound(amount, 0.001 ether, 100 ether);

        uint256 writerBal = token0.balanceOf(writer);

        vm.prank(writer);
        uint256 optionId = options.writeOption(IVibeOptions.WriteParams({
            poolId: poolId,
            optionType: IVibeOptions.OptionType.CALL,
            amount: amount,
            strikePrice: 2000e18,
            premium: 0,
            expiry: uint40(block.timestamp + 30 days),
            exerciseWindow: uint40(1 days)
        }));

        assertEq(token0.balanceOf(writer), writerBal - amount, "CALL collateral must equal amount");

        IVibeOptions.Option memory opt = options.getOption(optionId);
        assertEq(opt.collateral, amount, "Stored collateral must equal amount");
    }

    // ============ Fuzz: PUT collateral = amount * strike / 1e18 ============

    function testFuzz_putCollateralCorrect(uint256 amount, uint256 strike) public {
        amount = bound(amount, 0.001 ether, 10 ether);
        strike = bound(strike, 100e18, 10000e18);

        uint256 expectedCollateral = (amount * strike) / 1e18;
        if (expectedCollateral == 0) return;

        token1.mint(writer, expectedCollateral);

        uint256 writerBal = token1.balanceOf(writer);

        vm.prank(writer);
        uint256 optionId = options.writeOption(IVibeOptions.WriteParams({
            poolId: poolId,
            optionType: IVibeOptions.OptionType.PUT,
            amount: amount,
            strikePrice: strike,
            premium: 0,
            expiry: uint40(block.timestamp + 30 days),
            exerciseWindow: uint40(1 days)
        }));

        assertEq(token1.balanceOf(writer), writerBal - expectedCollateral, "PUT collateral formula");

        IVibeOptions.Option memory opt = options.getOption(optionId);
        assertEq(opt.collateral, expectedCollateral, "Stored PUT collateral");
    }

    // ============ Fuzz: CALL payoff capped at collateral ============

    function testFuzz_callPayoffCappedAtCollateral(uint256 amount, uint256 settlement) public {
        amount = bound(amount, 0.1 ether, 10 ether);
        uint256 strike = 1800e18;
        settlement = bound(settlement, strike + 1, 100_000e18);

        vm.prank(writer);
        uint256 optionId = options.writeOption(IVibeOptions.WriteParams({
            poolId: poolId,
            optionType: IVibeOptions.OptionType.CALL,
            amount: amount,
            strikePrice: strike,
            premium: 0,
            expiry: uint40(block.timestamp + 30 days),
            exerciseWindow: uint40(1 days)
        }));

        // Purchase
        vm.prank(buyer);
        options.purchase(optionId);

        // Set settlement price and warp past expiry
        mockAmm.setTWAP(poolId, settlement);
        mockAmm.setSpotPrice(poolId, settlement);
        vm.warp(block.timestamp + 30 days);

        IVibeOptions.Option memory opt = options.getOption(optionId);
        uint256 payoff = options.getPayoff(optionId);

        assertLe(payoff, opt.collateral, "Payoff must never exceed collateral");
    }

    // ============ Fuzz: OTM options have zero payoff ============

    function testFuzz_otmCallZeroPayoff(uint256 amount, uint256 settlement) public {
        amount = bound(amount, 0.1 ether, 10 ether);
        uint256 strike = 2200e18;
        settlement = bound(settlement, 100e18, strike);

        vm.prank(writer);
        uint256 optionId = options.writeOption(IVibeOptions.WriteParams({
            poolId: poolId,
            optionType: IVibeOptions.OptionType.CALL,
            amount: amount,
            strikePrice: strike,
            premium: 0,
            expiry: uint40(block.timestamp + 30 days),
            exerciseWindow: uint40(1 days)
        }));

        mockAmm.setTWAP(poolId, settlement);
        mockAmm.setSpotPrice(poolId, settlement);

        uint256 payoff = options.getPayoff(optionId);
        assertEq(payoff, 0, "OTM call must have zero payoff");
    }

    // ============ Fuzz: cancel returns full collateral to writer ============

    function testFuzz_cancelReturnsCollateral(uint256 amount) public {
        amount = bound(amount, 0.01 ether, 50 ether);

        uint256 balBefore = token0.balanceOf(writer);

        vm.prank(writer);
        uint256 optionId = options.writeOption(IVibeOptions.WriteParams({
            poolId: poolId,
            optionType: IVibeOptions.OptionType.CALL,
            amount: amount,
            strikePrice: 2000e18,
            premium: 0,
            expiry: uint40(block.timestamp + 30 days),
            exerciseWindow: uint40(1 days)
        }));

        vm.prank(writer);
        options.cancel(optionId);

        assertEq(token0.balanceOf(writer), balBefore, "Cancel must return full collateral");
    }

    // ============ Fuzz: reclaim after exercise window returns remaining ============

    function testFuzz_reclaimReturnsRemaining(uint256 amount) public {
        amount = bound(amount, 0.1 ether, 10 ether);
        uint256 strike = 1800e18;

        vm.prank(writer);
        uint256 optionId = options.writeOption(IVibeOptions.WriteParams({
            poolId: poolId,
            optionType: IVibeOptions.OptionType.CALL,
            amount: amount,
            strikePrice: strike,
            premium: 0,
            expiry: uint40(block.timestamp + 30 days),
            exerciseWindow: uint40(1 days)
        }));

        // Purchase by buyer (transfer from writer to buyer)
        vm.prank(buyer);
        options.purchase(optionId);

        // Exercise ITM
        mockAmm.setTWAP(poolId, SPOT_PRICE);
        mockAmm.setSpotPrice(poolId, SPOT_PRICE);
        vm.warp(block.timestamp + 30 days);

        uint256 payoff = options.getPayoff(optionId);

        vm.prank(buyer);
        options.exercise(optionId);

        // Warp past exercise window
        vm.warp(block.timestamp + 2 days);

        uint256 writerBefore = token0.balanceOf(writer);

        vm.prank(writer);
        options.reclaim(optionId);

        uint256 reclaimed = token0.balanceOf(writer) - writerBefore;
        assertEq(reclaimed, amount - payoff, "Writer reclaims collateral minus payoff");
    }
}
