// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/framework/VibeIntentRouter.sol";
import "../contracts/framework/interfaces/IVibeIntentRouter.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// @notice Mock AMM that implements swap(), quote(), getPoolId(), getPool(), getLPToken()
contract MockAMM {
    struct Pool {
        address token0;
        address token1;
        uint256 reserve0;
        uint256 reserve1;
        uint256 totalLiquidity;
        uint256 feeRate;
        bool initialized;
    }

    mapping(bytes32 => Pool) public pools;
    uint256 public feeRate;

    function createPool(address t0, address t1, uint256 _feeRate) external returns (bytes32 poolId) {
        (address token0, address token1) = t0 < t1 ? (t0, t1) : (t1, t0);
        poolId = keccak256(abi.encodePacked(token0, token1));
        pools[poolId] = Pool(token0, token1, 0, 0, 0, _feeRate, true);
        feeRate = _feeRate;
    }

    function seedPool(bytes32 poolId, uint256 r0, uint256 r1) external {
        pools[poolId].reserve0 = r0;
        pools[poolId].reserve1 = r1;
        pools[poolId].totalLiquidity = r0; // simplified
    }

    function getPoolId(address tokenA, address tokenB) external pure returns (bytes32) {
        (address t0, address t1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return keccak256(abi.encodePacked(t0, t1));
    }

    function getPool(bytes32 poolId) external view returns (Pool memory) {
        return pools[poolId];
    }

    function getLPToken(bytes32 poolId) external view returns (address) {
        return address(0); // not needed for intent router tests
    }

    function quote(bytes32 poolId, address, uint256 amountIn) external view returns (uint256 amountOut) {
        Pool storage pool = pools[poolId];
        if (!pool.initialized) revert("Pool not found");
        if (pool.reserve0 == 0 || pool.reserve1 == 0) return 0;
        // Constant product: amountOut = (amountIn * reserve1) / (reserve0 + amountIn) less fee
        uint256 amountInWithFee = amountIn * (10000 - pool.feeRate);
        amountOut = (amountInWithFee * pool.reserve1) / (pool.reserve0 * 10000 + amountInWithFee);
    }

    function swap(
        bytes32 poolId,
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient
    ) external returns (uint256 amountOut) {
        Pool storage pool = pools[poolId];
        require(pool.initialized, "Pool not found");

        // Calculate output
        uint256 amountInWithFee = amountIn * (10000 - pool.feeRate);
        amountOut = (amountInWithFee * pool.reserve1) / (pool.reserve0 * 10000 + amountInWithFee);
        require(amountOut >= minAmountOut, "Insufficient output");

        // Transfer tokenIn from caller
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);

        // Determine tokenOut
        address tokenOut = tokenIn == pool.token0 ? pool.token1 : pool.token0;
        IERC20(tokenOut).transfer(recipient, amountOut);

        // Update reserves
        if (tokenIn == pool.token0) {
            pool.reserve0 += amountIn;
            pool.reserve1 -= amountOut;
        } else {
            pool.reserve1 += amountIn;
            pool.reserve0 -= amountOut;
        }
    }
}

contract MockAuction {
    uint256 public commitCount;
    mapping(bytes32 => bool) public committed;

    function commitOrder(bytes32 commitHash) external payable returns (bytes32 commitId) {
        commitId = keccak256(abi.encodePacked(commitHash, ++commitCount));
        committed[commitId] = true;
    }

    function revealOrder(
        bytes32 commitId,
        address, address, uint256, uint256,
        bytes32, uint256
    ) external payable {
        require(committed[commitId], "Not committed");
    }
}

contract MockCrossChainRouter {
    bool public lastCallSuccess;

    function sendCommit(uint32, bytes32, bytes calldata) external payable {
        lastCallSuccess = true;
    }
}

contract MockPoolFactory {
    mapping(bytes32 => uint256) public quoteResults;

    function setQuoteResult(bytes32 poolId, uint256 result) external {
        quoteResults[poolId] = result;
    }

    function getPoolId(address tokenA, address tokenB, bytes32 curveId) external pure returns (bytes32) {
        (address t0, address t1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return keccak256(abi.encodePacked(t0, t1, curveId));
    }

    function quoteAmountOut(bytes32 poolId, uint256) external view returns (uint256) {
        return quoteResults[poolId];
    }
}

// ============ Unit Tests ============

/**
 * @title VibeIntentRouter Unit Tests
 * @notice Tests for intent-based order routing across AMM, auction,
 *         cross-chain, and factory pool venues.
 *         Part of VSOS mandatory verification layer.
 */
contract VibeIntentRouterTest is Test {
    VibeIntentRouter public router;
    MockAMM public amm;
    MockAuction public auction;
    MockCrossChainRouter public ccRouter;
    MockPoolFactory public factory;
    MockToken public tokenA;
    MockToken public tokenB;

    address public alice;
    address public bob;
    bytes32 public poolId;

    uint256 constant INIT_BALANCE = 1_000_000 ether;
    uint256 constant RESERVE = 100_000 ether;

    function setUp() public {
        alice = makeAddr("alice");
        bob = makeAddr("bob");

        tokenA = new MockToken("Token A", "TKA");
        tokenB = new MockToken("Token B", "TKB");

        amm = new MockAMM();
        auction = new MockAuction();
        ccRouter = new MockCrossChainRouter();
        factory = new MockPoolFactory();

        router = new VibeIntentRouter(
            address(amm),
            address(auction),
            address(ccRouter),
            address(factory)
        );

        // Create and seed AMM pool
        poolId = amm.createPool(address(tokenA), address(tokenB), 30); // 0.3%
        amm.seedPool(poolId, RESERVE, RESERVE);

        // Fund the AMM with tokenB for payouts
        tokenB.mint(address(amm), RESERVE);

        // Fund alice
        tokenA.mint(alice, INIT_BALANCE);
        tokenB.mint(alice, INIT_BALANCE);
        vm.prank(alice);
        tokenA.approve(address(router), type(uint256).max);
        vm.prank(alice);
        tokenB.approve(address(router), type(uint256).max);

        // Fund bob
        tokenA.mint(bob, INIT_BALANCE);
        vm.prank(bob);
        tokenA.approve(address(router), type(uint256).max);
    }

    // ============ Constructor Tests ============

    function test_constructor_ownerSet() public view {
        assertEq(router.owner(), address(this));
    }

    function test_constructor_dependenciesWired() public view {
        assertEq(router.vibeAMM(), address(amm));
        assertEq(router.auction(), address(auction));
        assertEq(router.crossChainRouter(), address(ccRouter));
        assertEq(router.poolFactory(), address(factory));
    }

    function test_constructor_routesEnabled() public view {
        assertTrue(router.isRouteEnabled(IVibeIntentRouter.ExecutionPath.AMM_DIRECT));
        assertTrue(router.isRouteEnabled(IVibeIntentRouter.ExecutionPath.BATCH_AUCTION));
        assertTrue(router.isRouteEnabled(IVibeIntentRouter.ExecutionPath.CROSS_CHAIN));
        assertTrue(router.isRouteEnabled(IVibeIntentRouter.ExecutionPath.FACTORY_POOL));
    }

    // ============ quoteIntent Tests ============

    function test_quoteIntent_ammQuote() public view {
        IVibeIntentRouter.Intent memory intent = IVibeIntentRouter.Intent({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 1000 ether,
            minAmountOut: 0,
            deadline: 0,
            preferredPath: IVibeIntentRouter.ExecutionPath.AMM_DIRECT,
            extraData: ""
        });

        IVibeIntentRouter.RouteQuote[] memory quotes = router.quoteIntent(intent);
        assertTrue(quotes.length >= 1);
        // AMM should be first (highest expectedOut for direct swap)
        assertTrue(quotes[0].expectedOut > 0);
    }

    function test_quoteIntent_sortedDescending() public view {
        IVibeIntentRouter.Intent memory intent = IVibeIntentRouter.Intent({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 1000 ether,
            minAmountOut: 0,
            deadline: 0,
            preferredPath: IVibeIntentRouter.ExecutionPath.AMM_DIRECT,
            extraData: ""
        });

        IVibeIntentRouter.RouteQuote[] memory quotes = router.quoteIntent(intent);
        for (uint256 i = 1; i < quotes.length; i++) {
            assertTrue(quotes[i - 1].expectedOut >= quotes[i].expectedOut);
        }
    }

    function test_quoteIntent_reverts_zeroAmount() public {
        IVibeIntentRouter.Intent memory intent = IVibeIntentRouter.Intent({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 0,
            minAmountOut: 0,
            deadline: 0,
            preferredPath: IVibeIntentRouter.ExecutionPath.AMM_DIRECT,
            extraData: ""
        });

        vm.expectRevert(IVibeIntentRouter.ZeroAmount.selector);
        router.quoteIntent(intent);
    }

    function test_quoteIntent_reverts_sameToken() public {
        IVibeIntentRouter.Intent memory intent = IVibeIntentRouter.Intent({
            tokenIn: address(tokenA),
            tokenOut: address(tokenA),
            amountIn: 1000 ether,
            minAmountOut: 0,
            deadline: 0,
            preferredPath: IVibeIntentRouter.ExecutionPath.AMM_DIRECT,
            extraData: ""
        });

        vm.expectRevert(IVibeIntentRouter.SameToken.selector);
        router.quoteIntent(intent);
    }

    function test_quoteIntent_auctionEstimate() public view {
        IVibeIntentRouter.Intent memory intent = IVibeIntentRouter.Intent({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 1000 ether,
            minAmountOut: 0,
            deadline: 0,
            preferredPath: IVibeIntentRouter.ExecutionPath.AMM_DIRECT,
            extraData: ""
        });

        IVibeIntentRouter.RouteQuote[] memory quotes = router.quoteIntent(intent);

        // Find auction quote
        bool foundAuction;
        uint256 auctionOut;
        uint256 ammOut;
        for (uint256 i = 0; i < quotes.length; i++) {
            if (quotes[i].path == IVibeIntentRouter.ExecutionPath.BATCH_AUCTION) {
                foundAuction = true;
                auctionOut = quotes[i].expectedOut;
            }
            if (quotes[i].path == IVibeIntentRouter.ExecutionPath.AMM_DIRECT) {
                ammOut = quotes[i].expectedOut;
            }
        }

        assertTrue(foundAuction, "Auction quote should be present");
        // Auction estimate = AMM * 99.5%
        assertEq(auctionOut, (ammOut * 9950) / 10000);
    }

    // ============ submitIntent — AMM Path ============

    function test_submitIntent_amm_success() public {
        IVibeIntentRouter.Intent memory intent = IVibeIntentRouter.Intent({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 1000 ether,
            minAmountOut: 1,
            deadline: block.timestamp + 1 hours,
            preferredPath: IVibeIntentRouter.ExecutionPath.AMM_DIRECT,
            extraData: ""
        });

        uint256 aliceTokenBBefore = tokenB.balanceOf(alice);
        uint256 aliceTokenABefore = tokenA.balanceOf(alice);

        vm.prank(alice);
        bytes32 intentId = router.submitIntent(intent);

        assertTrue(intentId != bytes32(0));
        assertGt(tokenB.balanceOf(alice), aliceTokenBBefore, "Alice should receive tokenB");
        assertLt(tokenA.balanceOf(alice), aliceTokenABefore, "Alice should spend tokenA");
    }

    function test_submitIntent_amm_minAmountOutEnforced() public {
        IVibeIntentRouter.Intent memory intent = IVibeIntentRouter.Intent({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 1000 ether,
            minAmountOut: type(uint256).max, // impossibly high
            deadline: 0,
            preferredPath: IVibeIntentRouter.ExecutionPath.AMM_DIRECT,
            extraData: ""
        });

        vm.prank(alice);
        vm.expectRevert(IVibeIntentRouter.InsufficientOutput.selector);
        router.submitIntent(intent);
    }

    function test_submitIntent_amm_deadlineEnforced() public {
        vm.warp(1000); // advance time so deadline can be in the past

        IVibeIntentRouter.Intent memory intent = IVibeIntentRouter.Intent({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 1000 ether,
            minAmountOut: 0,
            deadline: 500, // expired (current time is 1000)
            preferredPath: IVibeIntentRouter.ExecutionPath.AMM_DIRECT,
            extraData: ""
        });

        vm.prank(alice);
        vm.expectRevert(IVibeIntentRouter.DeadlineExpired.selector);
        router.submitIntent(intent);
    }

    function test_submitIntent_amm_tokenTransferCorrect() public {
        uint256 swapAmount = 5000 ether;
        IVibeIntentRouter.Intent memory intent = IVibeIntentRouter.Intent({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: swapAmount,
            minAmountOut: 1,
            deadline: 0,
            preferredPath: IVibeIntentRouter.ExecutionPath.AMM_DIRECT,
            extraData: ""
        });

        uint256 beforeA = tokenA.balanceOf(alice);

        vm.prank(alice);
        router.submitIntent(intent);

        assertEq(tokenA.balanceOf(alice), beforeA - swapAmount);
        // Router should have no tokens stuck
        assertEq(tokenA.balanceOf(address(router)), 0);
        assertEq(tokenB.balanceOf(address(router)), 0);
    }

    // ============ submitIntent — Auction Path ============

    function test_submitIntent_auction_commitCreated() public {
        // Disable AMM so auction wins
        router.setRouteEnabled(IVibeIntentRouter.ExecutionPath.AMM_DIRECT, false);
        router.setRouteEnabled(IVibeIntentRouter.ExecutionPath.FACTORY_POOL, false);

        IVibeIntentRouter.Intent memory intent = IVibeIntentRouter.Intent({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 1000 ether,
            minAmountOut: 1,
            deadline: 0,
            preferredPath: IVibeIntentRouter.ExecutionPath.BATCH_AUCTION,
            extraData: ""
        });

        vm.prank(alice);
        vm.deal(alice, 1 ether);
        bytes32 intentId = router.submitIntent{value: 0.1 ether}(intent);

        IVibeIntentRouter.PendingIntent memory pi = router.getPendingIntent(intentId);
        assertEq(pi.submitter, alice);
        assertFalse(pi.executed);
        assertFalse(pi.cancelled);
        assertTrue(pi.commitId != bytes32(0));
    }

    function test_submitIntent_auction_pendingIntentStored() public {
        router.setRouteEnabled(IVibeIntentRouter.ExecutionPath.AMM_DIRECT, false);
        router.setRouteEnabled(IVibeIntentRouter.ExecutionPath.FACTORY_POOL, false);

        IVibeIntentRouter.Intent memory intent = IVibeIntentRouter.Intent({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 2000 ether,
            minAmountOut: 1,
            deadline: 0,
            preferredPath: IVibeIntentRouter.ExecutionPath.BATCH_AUCTION,
            extraData: ""
        });

        vm.prank(alice);
        bytes32 intentId = router.submitIntent(intent);

        IVibeIntentRouter.PendingIntent memory pi = router.getPendingIntent(intentId);
        assertEq(pi.intent.amountIn, 2000 ether);
        assertEq(pi.intent.tokenIn, address(tokenA));
    }

    function test_submitIntent_auction_canRevealLater() public {
        router.setRouteEnabled(IVibeIntentRouter.ExecutionPath.AMM_DIRECT, false);
        router.setRouteEnabled(IVibeIntentRouter.ExecutionPath.FACTORY_POOL, false);

        IVibeIntentRouter.Intent memory intent = IVibeIntentRouter.Intent({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 1000 ether,
            minAmountOut: 1,
            deadline: 0,
            preferredPath: IVibeIntentRouter.ExecutionPath.BATCH_AUCTION,
            extraData: ""
        });

        vm.prank(alice);
        bytes32 intentId = router.submitIntent(intent);

        // Reveal should mark as executed
        vm.prank(alice);
        router.revealPendingIntent(intentId, bytes32("secret"), 0);

        IVibeIntentRouter.PendingIntent memory pi = router.getPendingIntent(intentId);
        assertTrue(pi.executed);
    }

    // ============ submitIntent — Cross-chain ============

    function test_submitIntent_crossChain_success() public {
        // Disable other routes to force cross-chain
        router.setRouteEnabled(IVibeIntentRouter.ExecutionPath.AMM_DIRECT, false);
        router.setRouteEnabled(IVibeIntentRouter.ExecutionPath.BATCH_AUCTION, false);
        router.setRouteEnabled(IVibeIntentRouter.ExecutionPath.FACTORY_POOL, false);

        bytes memory extraData = abi.encode(uint32(101), bytes("options"));

        IVibeIntentRouter.Intent memory intent = IVibeIntentRouter.Intent({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 1000 ether,
            minAmountOut: 0, // cross-chain can't know output
            deadline: 0,
            preferredPath: IVibeIntentRouter.ExecutionPath.CROSS_CHAIN,
            extraData: extraData
        });

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        bytes32 intentId = router.submitIntent{value: 0.5 ether}(intent);

        assertTrue(intentId != bytes32(0));
        assertTrue(ccRouter.lastCallSuccess());
    }

    function test_submitIntent_crossChain_forwardsMsgValue() public {
        router.setRouteEnabled(IVibeIntentRouter.ExecutionPath.AMM_DIRECT, false);
        router.setRouteEnabled(IVibeIntentRouter.ExecutionPath.BATCH_AUCTION, false);
        router.setRouteEnabled(IVibeIntentRouter.ExecutionPath.FACTORY_POOL, false);

        bytes memory extraData = abi.encode(uint32(101), bytes("options"));

        IVibeIntentRouter.Intent memory intent = IVibeIntentRouter.Intent({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 1000 ether,
            minAmountOut: 0,
            deadline: 0,
            preferredPath: IVibeIntentRouter.ExecutionPath.CROSS_CHAIN,
            extraData: extraData
        });

        vm.deal(alice, 2 ether);
        vm.prank(alice);
        router.submitIntent{value: 1 ether}(intent);

        // Cross-chain router should have received the ETH
        assertEq(address(ccRouter).balance, 1 ether);
    }

    // ============ cancelIntent ============

    function test_cancelIntent_success() public {
        router.setRouteEnabled(IVibeIntentRouter.ExecutionPath.AMM_DIRECT, false);
        router.setRouteEnabled(IVibeIntentRouter.ExecutionPath.FACTORY_POOL, false);

        IVibeIntentRouter.Intent memory intent = IVibeIntentRouter.Intent({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 1000 ether,
            minAmountOut: 1,
            deadline: 0,
            preferredPath: IVibeIntentRouter.ExecutionPath.BATCH_AUCTION,
            extraData: ""
        });

        vm.prank(alice);
        bytes32 intentId = router.submitIntent(intent);

        vm.prank(alice);
        router.cancelIntent(intentId);

        IVibeIntentRouter.PendingIntent memory pi = router.getPendingIntent(intentId);
        assertTrue(pi.cancelled);
    }

    function test_cancelIntent_notOwner_reverts() public {
        router.setRouteEnabled(IVibeIntentRouter.ExecutionPath.AMM_DIRECT, false);
        router.setRouteEnabled(IVibeIntentRouter.ExecutionPath.FACTORY_POOL, false);

        IVibeIntentRouter.Intent memory intent = IVibeIntentRouter.Intent({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 1000 ether,
            minAmountOut: 1,
            deadline: 0,
            preferredPath: IVibeIntentRouter.ExecutionPath.BATCH_AUCTION,
            extraData: ""
        });

        vm.prank(alice);
        bytes32 intentId = router.submitIntent(intent);

        vm.prank(bob);
        vm.expectRevert(IVibeIntentRouter.NotIntentOwner.selector);
        router.cancelIntent(intentId);
    }

    // ============ Admin Tests ============

    function test_admin_setDependencies_onlyOwner() public {
        router.setVibeAMM(address(1));
        assertEq(router.vibeAMM(), address(1));

        vm.prank(alice);
        vm.expectRevert();
        router.setVibeAMM(address(2));
    }

    function test_admin_enableDisableRoutes() public {
        router.setRouteEnabled(IVibeIntentRouter.ExecutionPath.AMM_DIRECT, false);
        assertFalse(router.isRouteEnabled(IVibeIntentRouter.ExecutionPath.AMM_DIRECT));

        router.setRouteEnabled(IVibeIntentRouter.ExecutionPath.AMM_DIRECT, true);
        assertTrue(router.isRouteEnabled(IVibeIntentRouter.ExecutionPath.AMM_DIRECT));
    }

    function test_admin_disabledRouteNotQuoted() public {
        router.setRouteEnabled(IVibeIntentRouter.ExecutionPath.AMM_DIRECT, false);
        router.setRouteEnabled(IVibeIntentRouter.ExecutionPath.BATCH_AUCTION, false);
        router.setRouteEnabled(IVibeIntentRouter.ExecutionPath.CROSS_CHAIN, false);
        router.setRouteEnabled(IVibeIntentRouter.ExecutionPath.FACTORY_POOL, false);

        IVibeIntentRouter.Intent memory intent = IVibeIntentRouter.Intent({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 1000 ether,
            minAmountOut: 0,
            deadline: 0,
            preferredPath: IVibeIntentRouter.ExecutionPath.AMM_DIRECT,
            extraData: ""
        });

        IVibeIntentRouter.RouteQuote[] memory quotes = router.quoteIntent(intent);
        assertEq(quotes.length, 0);
    }

    function test_admin_onlyOwnerToggleRoute() public {
        vm.prank(alice);
        vm.expectRevert();
        router.setRouteEnabled(IVibeIntentRouter.ExecutionPath.AMM_DIRECT, false);
    }

    // ============ Edge Cases ============

    function test_edge_zeroAmount_reverts() public {
        IVibeIntentRouter.Intent memory intent = IVibeIntentRouter.Intent({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 0,
            minAmountOut: 0,
            deadline: 0,
            preferredPath: IVibeIntentRouter.ExecutionPath.AMM_DIRECT,
            extraData: ""
        });

        vm.prank(alice);
        vm.expectRevert(IVibeIntentRouter.ZeroAmount.selector);
        router.submitIntent(intent);
    }

    function test_edge_sameToken_reverts() public {
        IVibeIntentRouter.Intent memory intent = IVibeIntentRouter.Intent({
            tokenIn: address(tokenA),
            tokenOut: address(tokenA),
            amountIn: 1000 ether,
            minAmountOut: 0,
            deadline: 0,
            preferredPath: IVibeIntentRouter.ExecutionPath.AMM_DIRECT,
            extraData: ""
        });

        vm.prank(alice);
        vm.expectRevert(IVibeIntentRouter.SameToken.selector);
        router.submitIntent(intent);
    }

    function test_edge_noValidRoute_allDisabled() public {
        router.setRouteEnabled(IVibeIntentRouter.ExecutionPath.AMM_DIRECT, false);
        router.setRouteEnabled(IVibeIntentRouter.ExecutionPath.BATCH_AUCTION, false);
        router.setRouteEnabled(IVibeIntentRouter.ExecutionPath.CROSS_CHAIN, false);
        router.setRouteEnabled(IVibeIntentRouter.ExecutionPath.FACTORY_POOL, false);

        IVibeIntentRouter.Intent memory intent = IVibeIntentRouter.Intent({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 1000 ether,
            minAmountOut: 0,
            deadline: 0,
            preferredPath: IVibeIntentRouter.ExecutionPath.AMM_DIRECT,
            extraData: ""
        });

        vm.prank(alice);
        vm.expectRevert(IVibeIntentRouter.NoValidRoute.selector);
        router.submitIntent(intent);
    }

    function test_edge_routerHoldsNoTokens() public {
        IVibeIntentRouter.Intent memory intent = IVibeIntentRouter.Intent({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 1000 ether,
            minAmountOut: 1,
            deadline: 0,
            preferredPath: IVibeIntentRouter.ExecutionPath.AMM_DIRECT,
            extraData: ""
        });

        vm.prank(alice);
        router.submitIntent(intent);

        assertEq(tokenA.balanceOf(address(router)), 0, "Router should hold no tokenA");
        assertEq(tokenB.balanceOf(address(router)), 0, "Router should hold no tokenB");
    }

    function test_edge_cancelNonexistent_reverts() public {
        vm.expectRevert(IVibeIntentRouter.IntentNotFound.selector);
        router.cancelIntent(bytes32("nonexistent"));
    }

    function test_edge_revealCancelledIntent_reverts() public {
        router.setRouteEnabled(IVibeIntentRouter.ExecutionPath.AMM_DIRECT, false);
        router.setRouteEnabled(IVibeIntentRouter.ExecutionPath.FACTORY_POOL, false);

        IVibeIntentRouter.Intent memory intent = IVibeIntentRouter.Intent({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 1000 ether,
            minAmountOut: 1,
            deadline: 0,
            preferredPath: IVibeIntentRouter.ExecutionPath.BATCH_AUCTION,
            extraData: ""
        });

        vm.prank(alice);
        bytes32 intentId = router.submitIntent(intent);

        vm.prank(alice);
        router.cancelIntent(intentId);

        vm.prank(alice);
        vm.expectRevert(IVibeIntentRouter.IntentAlreadyCancelled.selector);
        router.revealPendingIntent(intentId, bytes32("secret"), 0);
    }
}
