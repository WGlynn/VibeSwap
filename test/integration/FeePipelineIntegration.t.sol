// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import "../../contracts/amm/VibeAMM.sol";
import "../../contracts/core/ProtocolFeeAdapter.sol";
import "../../contracts/core/FeeRouter.sol";
import "../../contracts/core/BuybackEngine.sol";

// ============ Mock Tokens ============

contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 1_000_000_000e18);
    }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockFPWETH is ERC20 {
    constructor() ERC20("Wrapped ETH", "WETH") {}
    function deposit() external payable { _mint(msg.sender, msg.value); }
    function withdraw(uint256 amount) external { _burn(msg.sender, amount); payable(msg.sender).transfer(amount); }
}

// ============ Fee Pipeline Integration Test ============

/**
 * @title FeePipelineIntegrationTest
 * @notice End-to-end test of the fee revenue pipeline:
 *         VibeAMM → ProtocolFeeAdapter → FeeRouter → [Treasury, Insurance, RevShare, BuybackEngine]
 *
 *         Verifies that when protocolFeeShare > 0, swap fees flow through the entire
 *         cooperative distribution system correctly.
 */
contract FeePipelineIntegrationTest is Test {
    // ============ Contracts ============

    VibeAMM amm;
    ProtocolFeeAdapter adapter;
    FeeRouter router;
    BuybackEngine buyback;

    // ============ Tokens ============

    MockToken tokenA;
    MockToken tokenB;

    // ============ Addresses ============

    address deployer = address(this);
    address trader = address(0xBEEF);
    address treasuryWallet = address(0xDA0);
    address insuranceWallet = address(0x1115);
    address revShareWallet = address(0x5EED);

    // ============ Pool ============

    bytes32 poolId;
    uint256 constant INITIAL_LIQUIDITY = 100_000e18;
    uint256 constant TRADE_AMOUNT = 1_000e18;

    // ============ Setup ============

    function setUp() public {
        // Deploy tokens
        tokenA = new MockToken("Token A", "TKA");
        tokenB = new MockToken("Token B", "TKB");

        // Ensure tokenA < tokenB for consistent pool ordering
        if (address(tokenA) > address(tokenB)) {
            (tokenA, tokenB) = (tokenB, tokenA);
        }

        // Deploy FeeRouter (needs destination addresses)
        // BuybackEngine address unknown yet, use placeholder then update
        router = new FeeRouter(
            treasuryWallet,
            insuranceWallet,
            revShareWallet,
            address(0xDEAD) // placeholder for buyback — updated after deploy
        );

        // Deploy ProtocolFeeAdapter pointing at FeeRouter
        MockFPWETH weth = new MockFPWETH();
        adapter = new ProtocolFeeAdapter(address(router), address(weth));

        // Authorize adapter as a fee source on FeeRouter
        router.authorizeSource(address(adapter));

        // Deploy VibeAMM via proxy
        VibeAMM ammImpl = new VibeAMM();
        bytes memory initData = abi.encodeCall(
            VibeAMM.initialize,
            (address(this), address(adapter)) // owner, adapter as treasury
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(ammImpl), initData);
        amm = VibeAMM(address(proxy));

        // Enable protocol fee share (10% = 1000 bps of the 5 bps fee goes to protocol)
        amm.setProtocolFeeShare(1000);

        // Deploy BuybackEngine
        buyback = new BuybackEngine(
            address(amm),
            address(tokenB), // protocol token = tokenB
            500,             // 5% slippage tolerance
            0                // no cooldown for testing
        );

        // Update FeeRouter buyback target
        router.setBuybackTarget(address(buyback));

        // Create pool on VibeAMM (createPool takes token0, token1, feeRate)
        poolId = amm.createPool(address(tokenA), address(tokenB), 5); // 5 bps

        // Add initial liquidity
        tokenA.approve(address(amm), type(uint256).max);
        tokenB.approve(address(amm), type(uint256).max);
        amm.addLiquidity(poolId, INITIAL_LIQUIDITY, INITIAL_LIQUIDITY, 0, 0);

        // Fund trader
        tokenA.transfer(trader, 100_000e18);
        tokenB.transfer(trader, 100_000e18);
    }

    // ============ Test: Full Pipeline Flow ============

    function test_fullPipeline_swapToDistribution() public {
        // Step 1: Trader swaps → fees accumulate in VibeAMM
        vm.startPrank(trader);
        tokenA.approve(address(amm), TRADE_AMOUNT);
        amm.swap(poolId, address(tokenA), TRADE_AMOUNT, 0, trader);
        vm.stopPrank();

        // Verify fees accumulated
        uint256 accFees = amm.accumulatedFees(address(tokenA));
        assertGt(accFees, 0, "Fees should accumulate after swap");

        // Step 2: Collect fees → tokens move to ProtocolFeeAdapter (treasury)
        uint256 adapterBalBefore = tokenA.balanceOf(address(adapter));
        amm.collectFees(address(tokenA));
        uint256 adapterBalAfter = tokenA.balanceOf(address(adapter));
        assertEq(adapterBalAfter - adapterBalBefore, accFees, "Adapter should receive all accumulated fees");

        // Verify VibeAMM fees are now zero
        assertEq(amm.accumulatedFees(address(tokenA)), 0, "Accumulated fees should be zero after collect");

        // Step 3: Forward fees through adapter → FeeRouter
        uint256 routerBalBefore = tokenA.balanceOf(address(router));
        adapter.forwardFees(address(tokenA));
        uint256 routerBalAfter = tokenA.balanceOf(address(router));
        assertEq(routerBalAfter - routerBalBefore, accFees, "Router should receive forwarded fees");

        // Verify adapter tracking
        assertEq(adapter.totalForwarded(address(tokenA)), accFees, "Adapter should track forwarded amount");

        // Step 4: Distribute through FeeRouter → 4 destinations
        uint256 treasuryBefore = tokenA.balanceOf(treasuryWallet);
        uint256 insuranceBefore = tokenA.balanceOf(insuranceWallet);
        uint256 revShareBefore = tokenA.balanceOf(revShareWallet);
        uint256 buybackBefore = tokenA.balanceOf(address(buyback));

        router.distribute(address(tokenA));

        uint256 toTreasury = tokenA.balanceOf(treasuryWallet) - treasuryBefore;
        uint256 toInsurance = tokenA.balanceOf(insuranceWallet) - insuranceBefore;
        uint256 toRevShare = tokenA.balanceOf(revShareWallet) - revShareBefore;
        uint256 toBuyback = tokenA.balanceOf(address(buyback)) - buybackBefore;

        // Default split: 40/20/30/10
        assertEq(toTreasury, (accFees * 4000) / 10000, "Treasury should get 40%");
        assertEq(toInsurance, (accFees * 2000) / 10000, "Insurance should get 20%");
        assertEq(toRevShare, (accFees * 3000) / 10000, "RevShare should get 30%");
        // Buyback gets dust: pending - treasury - insurance - revShare
        uint256 expectedBuyback = accFees - toTreasury - toInsurance - toRevShare;
        assertEq(toBuyback, expectedBuyback, "Buyback should get remainder (~10%)");

        // Total distributed should equal total collected
        assertEq(toTreasury + toInsurance + toRevShare + toBuyback, accFees, "All fees distributed");
    }

    // ============ Test: Protocol Fee Share = 0 means no accumulation ============

    function test_zeroFeeShare_noAccumulation() public {
        // Set protocol fee share to 0
        amm.setProtocolFeeShare(0);

        vm.startPrank(trader);
        tokenA.approve(address(amm), TRADE_AMOUNT);
        amm.swap(poolId, address(tokenA), TRADE_AMOUNT, 0, trader);
        vm.stopPrank();

        assertEq(amm.accumulatedFees(address(tokenA)), 0, "No fees should accumulate with 0% share");
    }

    // ============ Test: Multiple swaps accumulate before collection ============

    function test_multipleSwaps_accumulateBeforeCollect() public {
        // Do 5 swaps (warp between each to avoid SameBlockInteraction)
        vm.startPrank(trader);
        for (uint256 i = 0; i < 5; i++) {
            vm.roll(block.number + 1);
            vm.warp(block.timestamp + 12);
            tokenA.approve(address(amm), TRADE_AMOUNT);
            amm.swap(poolId, address(tokenA), TRADE_AMOUNT, 0, trader);
        }
        vm.stopPrank();

        uint256 totalAccumulated = amm.accumulatedFees(address(tokenA));
        assertGt(totalAccumulated, 0, "Fees accumulated from 5 swaps");

        // Single collect gets all of them
        amm.collectFees(address(tokenA));
        assertEq(tokenA.balanceOf(address(adapter)), totalAccumulated, "Single collect gets all accumulated");
    }

    // ============ Test: Bidirectional swaps accumulate fees in both tokens ============

    function test_bidirectionalSwaps_feesInBothTokens() public {
        vm.startPrank(trader);

        // Swap A -> B
        tokenA.approve(address(amm), TRADE_AMOUNT);
        amm.swap(poolId, address(tokenA), TRADE_AMOUNT, 0, trader);

        // Advance block to avoid SameBlockInteraction
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 12);

        // Swap B -> A
        tokenB.approve(address(amm), TRADE_AMOUNT);
        amm.swap(poolId, address(tokenB), TRADE_AMOUNT, 0, trader);

        vm.stopPrank();

        uint256 feesA = amm.accumulatedFees(address(tokenA));
        uint256 feesB = amm.accumulatedFees(address(tokenB));
        assertGt(feesA, 0, "Fees in tokenA from A->B swap");
        assertGt(feesB, 0, "Fees in tokenB from B->A swap");

        // Collect and forward both
        amm.collectFees(address(tokenA));
        amm.collectFees(address(tokenB));
        adapter.forwardFees(address(tokenA));
        adapter.forwardFees(address(tokenB));

        assertEq(router.pendingFees(address(tokenA)), feesA, "Router pending tokenA");
        assertEq(router.pendingFees(address(tokenB)), feesB, "Router pending tokenB");
    }

    // ============ Test: setProtocolFeeShare respects max cap ============

    function test_setProtocolFeeShare_maxCap() public {
        amm.setProtocolFeeShare(2500); // Max allowed
        assertEq(amm.protocolFeeShare(), 2500);

        vm.expectRevert("Fee share too high");
        amm.setProtocolFeeShare(2501);
    }

    // ============ Test: Only treasury/owner can collectFees ============

    function test_collectFees_onlyAuthorized() public {
        vm.startPrank(trader);
        tokenA.approve(address(amm), TRADE_AMOUNT);
        amm.swap(poolId, address(tokenA), TRADE_AMOUNT, 0, trader);

        vm.expectRevert(VibeAMM.NotAuthorized.selector);
        amm.collectFees(address(tokenA));
        vm.stopPrank();
    }

    // ============ Test: FeeRouter rejects unauthorized sources ============

    function test_feeRouter_rejectsUnauthorized() public {
        tokenA.transfer(address(0xBAD), 1000e18);

        vm.startPrank(address(0xBAD));
        tokenA.approve(address(router), 1000e18);
        vm.expectRevert(IFeeRouter.UnauthorizedSource.selector);
        router.collectFee(address(tokenA), 1000e18);
        vm.stopPrank();
    }

    // ============ Test: Custom fee split ============

    function test_customFeeSplit() public {
        // Change to 50/10/30/10
        router.updateConfig(IFeeRouter.FeeConfig({
            treasuryBps: 5000,
            insuranceBps: 1000,
            revShareBps: 3000,
            buybackBps: 1000
        }));

        // Generate fees
        vm.startPrank(trader);
        tokenA.approve(address(amm), TRADE_AMOUNT);
        amm.swap(poolId, address(tokenA), TRADE_AMOUNT, 0, trader);
        vm.stopPrank();

        uint256 fees = amm.accumulatedFees(address(tokenA));
        amm.collectFees(address(tokenA));
        adapter.forwardFees(address(tokenA));

        uint256 treasuryBefore = tokenA.balanceOf(treasuryWallet);
        router.distribute(address(tokenA));
        uint256 toTreasury = tokenA.balanceOf(treasuryWallet) - treasuryBefore;

        assertEq(toTreasury, (fees * 5000) / 10000, "Treasury should get 50% with custom split");
    }

    // ============ Test: Fee accounting consistency ============

    function test_feeAccounting_consistent() public {
        // Do a swap
        vm.startPrank(trader);
        tokenA.approve(address(amm), TRADE_AMOUNT);
        amm.swap(poolId, address(tokenA), TRADE_AMOUNT, 0, trader);
        vm.stopPrank();

        uint256 accFees = amm.accumulatedFees(address(tokenA));

        // Collect → forward → distribute
        amm.collectFees(address(tokenA));
        adapter.forwardFees(address(tokenA));
        router.distribute(address(tokenA));

        // Verify FeeRouter accounting
        assertEq(router.totalCollected(address(tokenA)), accFees, "Router collected matches AMM fees");
        assertEq(router.totalDistributed(address(tokenA)), accFees, "Router distributed matches collected");
        assertEq(router.pendingFees(address(tokenA)), 0, "No pending after distribution");
    }

    // ============ Test: Adapter forwardFees reverts on zero balance ============

    function test_adapter_forwardFees_revertsOnZero() public {
        vm.expectRevert(IProtocolFeeAdapter.ZeroAmount.selector);
        adapter.forwardFees(address(tokenA));
    }

    // ============ Test: Higher protocolFeeShare means more protocol revenue ============

    function test_higherFeeShare_moreRevenue() public {
        // Swap with 10% protocol share
        amm.setProtocolFeeShare(1000); // 10%
        vm.startPrank(trader);
        tokenA.approve(address(amm), TRADE_AMOUNT);
        amm.swap(poolId, address(tokenA), TRADE_AMOUNT, 0, trader);
        vm.stopPrank();
        uint256 fees10 = amm.accumulatedFees(address(tokenA));
        amm.collectFees(address(tokenA));

        // Advance block to avoid SameBlockInteraction
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 12);

        // Swap with 25% protocol share
        amm.setProtocolFeeShare(2500); // 25%
        vm.startPrank(trader);
        tokenA.approve(address(amm), TRADE_AMOUNT);
        amm.swap(poolId, address(tokenA), TRADE_AMOUNT, 0, trader);
        vm.stopPrank();
        uint256 fees25 = amm.accumulatedFees(address(tokenA));

        assertGt(fees25, fees10, "25% share should yield more protocol fees than 10%");
    }
}
