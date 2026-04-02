// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import "../../contracts/amm/VibeAMM.sol";
import "../../contracts/core/ProtocolFeeAdapter.sol";
import "../../contracts/core/FeeRouter.sol";

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
 *         VibeAMM → ProtocolFeeAdapter → FeeRouter → ShapleyDistributor (100% to LPs)
 *
 *         100% of swap fees go to LPs. No split. No extraction.
 */
contract FeePipelineIntegrationTest is Test {
    // ============ Contracts ============

    VibeAMM amm;
    ProtocolFeeAdapter adapter;
    FeeRouter router;

    // ============ Tokens ============

    MockToken tokenA;
    MockToken tokenB;

    // ============ Addresses ============

    address deployer = address(this);
    address trader = address(0xBEEF);
    address lpDistributor = address(0x5BAD); // ShapleyDistributor in production

    // ============ Pool ============

    bytes32 poolId;
    uint256 constant INITIAL_LIQUIDITY = 100_000e18;
    uint256 constant TRADE_AMOUNT = 1_000e18;

    // ============ Setup ============

    function setUp() public {
        tokenA = new MockToken("Token A", "TKA");
        tokenB = new MockToken("Token B", "TKB");

        if (address(tokenA) > address(tokenB)) {
            (tokenA, tokenB) = (tokenB, tokenA);
        }

        // FeeRouter: 100% to LP distributor
        router = new FeeRouter(lpDistributor);

        // ProtocolFeeAdapter bridges VibeAMM → FeeRouter
        MockFPWETH weth = new MockFPWETH();
        adapter = new ProtocolFeeAdapter(address(router), address(weth));

        router.authorizeSource(address(adapter));

        // Deploy VibeAMM via proxy
        VibeAMM ammImpl = new VibeAMM();
        bytes memory initData = abi.encodeCall(
            VibeAMM.initialize,
            (address(this), address(adapter))
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(ammImpl), initData);
        amm = VibeAMM(address(proxy));

        amm.setProtocolFeeShare(1000); // 10% of swap fees go to protocol

        poolId = amm.createPool(address(tokenA), address(tokenB), 5); // 5 bps

        tokenA.approve(address(amm), type(uint256).max);
        tokenB.approve(address(amm), type(uint256).max);
        amm.addLiquidity(poolId, INITIAL_LIQUIDITY, INITIAL_LIQUIDITY, 0, 0);

        tokenA.transfer(trader, 100_000e18);
        tokenB.transfer(trader, 100_000e18);
    }

    // ============ Test: Full Pipeline — 100% to LPs ============

    function test_fullPipeline_100pctToLPs() public {
        // Swap → fees accumulate
        vm.startPrank(trader);
        tokenA.approve(address(amm), TRADE_AMOUNT);
        amm.swap(poolId, address(tokenA), TRADE_AMOUNT, 0, trader);
        vm.stopPrank();

        uint256 accFees = amm.accumulatedFees(address(tokenA));
        assertGt(accFees, 0, "Fees should accumulate after swap");

        // Collect → adapter
        amm.collectFees(address(tokenA));
        assertEq(tokenA.balanceOf(address(adapter)), accFees);

        // Forward → router
        adapter.forwardFees(address(tokenA));
        assertEq(router.pendingFees(address(tokenA)), accFees);

        // Distribute → 100% to LP distributor
        router.distribute(address(tokenA));
        assertEq(tokenA.balanceOf(lpDistributor), accFees, "100% of fees to LP distributor");
        assertEq(tokenA.balanceOf(address(router)), 0, "Router holds nothing");
    }

    // ============ Test: Protocol Fee Share = 0 means no accumulation ============

    function test_zeroFeeShare_noAccumulation() public {
        amm.setProtocolFeeShare(0);

        vm.startPrank(trader);
        tokenA.approve(address(amm), TRADE_AMOUNT);
        amm.swap(poolId, address(tokenA), TRADE_AMOUNT, 0, trader);
        vm.stopPrank();

        assertEq(amm.accumulatedFees(address(tokenA)), 0, "No fees should accumulate with 0% share");
    }

    // ============ Test: Multiple swaps accumulate before collection ============

    function test_multipleSwaps_accumulateBeforeCollect() public {
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

        amm.collectFees(address(tokenA));
        assertEq(tokenA.balanceOf(address(adapter)), totalAccumulated, "Single collect gets all accumulated");
    }

    // ============ Test: Bidirectional swaps — fee agnostic ============

    function test_bidirectionalSwaps_feeAgnostic() public {
        vm.startPrank(trader);

        tokenA.approve(address(amm), TRADE_AMOUNT);
        amm.swap(poolId, address(tokenA), TRADE_AMOUNT, 0, trader);

        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 12);

        tokenB.approve(address(amm), TRADE_AMOUNT);
        amm.swap(poolId, address(tokenB), TRADE_AMOUNT, 0, trader);

        vm.stopPrank();

        uint256 feesA = amm.accumulatedFees(address(tokenA));
        uint256 feesB = amm.accumulatedFees(address(tokenB));
        assertGt(feesA, 0, "Fees in tokenA from A->B swap");
        assertGt(feesB, 0, "Fees in tokenB from B->A swap");

        // Collect, forward, distribute both
        amm.collectFees(address(tokenA));
        amm.collectFees(address(tokenB));
        adapter.forwardFees(address(tokenA));
        adapter.forwardFees(address(tokenB));
        router.distribute(address(tokenA));
        router.distribute(address(tokenB));

        // LP distributor receives both tokens in their native denomination
        assertEq(tokenA.balanceOf(lpDistributor), feesA, "LP gets tokenA fees in tokenA");
        assertEq(tokenB.balanceOf(lpDistributor), feesB, "LP gets tokenB fees in tokenB");
    }

    // ============ Test: setProtocolFeeShare respects max cap ============

    function test_setProtocolFeeShare_maxCap() public {
        amm.setProtocolFeeShare(2500);
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

    // ============ Test: Fee accounting consistency ============

    function test_feeAccounting_consistent() public {
        vm.startPrank(trader);
        tokenA.approve(address(amm), TRADE_AMOUNT);
        amm.swap(poolId, address(tokenA), TRADE_AMOUNT, 0, trader);
        vm.stopPrank();

        uint256 accFees = amm.accumulatedFees(address(tokenA));

        amm.collectFees(address(tokenA));
        adapter.forwardFees(address(tokenA));
        router.distribute(address(tokenA));

        assertEq(router.totalCollected(address(tokenA)), accFees, "Router collected matches AMM fees");
        assertEq(router.totalDistributed(address(tokenA)), accFees, "Router distributed matches collected");
        assertEq(router.pendingFees(address(tokenA)), 0, "No pending after distribution");
    }

    // ============ Test: Adapter forwardFees reverts on zero balance ============

    function test_adapter_forwardFees_revertsOnZero() public {
        vm.expectRevert(IProtocolFeeAdapter.ZeroAmount.selector);
        adapter.forwardFees(address(tokenA));
    }

    // ============ Test: Higher protocolFeeShare means more revenue ============

    function test_higherFeeShare_moreRevenue() public {
        amm.setProtocolFeeShare(1000); // 10%
        vm.startPrank(trader);
        tokenA.approve(address(amm), TRADE_AMOUNT);
        amm.swap(poolId, address(tokenA), TRADE_AMOUNT, 0, trader);
        vm.stopPrank();
        uint256 fees10 = amm.accumulatedFees(address(tokenA));
        amm.collectFees(address(tokenA));

        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 12);

        amm.setProtocolFeeShare(2500); // 25%
        vm.startPrank(trader);
        tokenA.approve(address(amm), TRADE_AMOUNT);
        amm.swap(poolId, address(tokenA), TRADE_AMOUNT, 0, trader);
        vm.stopPrank();
        uint256 fees25 = amm.accumulatedFees(address(tokenA));

        assertGt(fees25, fees10, "25% share should yield more protocol fees than 10%");
    }
}
