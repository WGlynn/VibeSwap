// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/core/VibeSwapCore.sol";
import "../../contracts/core/CommitRevealAuction.sol";
import "../../contracts/amm/VibeAMM.sol";
import "../../contracts/governance/DAOTreasury.sol";
import "../../contracts/messaging/CrossChainRouter.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockLZEndpoint {
    function send(
        CrossChainRouter.MessagingParams memory,
        address
    ) external payable returns (CrossChainRouter.MessagingReceipt memory receipt) {
        receipt.nonce = 1;
        receipt.fee.nativeFee = msg.value;
    }
}

/**
 * @title VibeSwapIntegrationTest
 * @notice End-to-end integration tests for the complete VibeSwap system
 */
contract VibeSwapIntegrationTest is Test {
    // Contracts
    VibeSwapCore public core;
    CommitRevealAuction public auction;
    VibeAMM public amm;
    DAOTreasury public treasury;
    CrossChainRouter public router;
    MockLZEndpoint public endpoint;

    // Tokens
    MockERC20 public weth;
    MockERC20 public usdc;
    MockERC20 public wbtc;

    // Actors
    address public owner;
    address public lp1;
    address public lp2;
    address public trader1;
    address public trader2;
    address public trader3;

    // Pool IDs
    bytes32 public ethUsdcPool;
    bytes32 public btcUsdcPool;

    function setUp() public {
        owner = address(this);
        lp1 = makeAddr("lp1");
        lp2 = makeAddr("lp2");
        trader1 = makeAddr("trader1");
        trader2 = makeAddr("trader2");
        trader3 = makeAddr("trader3");

        // Deploy tokens
        weth = new MockERC20("Wrapped Ether", "WETH");
        usdc = new MockERC20("USD Coin", "USDC");
        wbtc = new MockERC20("Wrapped Bitcoin", "WBTC");

        // Deploy mock endpoint
        endpoint = new MockLZEndpoint();

        // Deploy system
        _deploySystem();

        // Setup pools and liquidity
        _setupPools();

        // Fund traders
        _fundTraders();
    }

    function _deploySystem() internal {
        // Deploy Treasury
        DAOTreasury treasuryImpl = new DAOTreasury();

        // Deploy AMM first (Treasury needs it)
        VibeAMM ammImpl = new VibeAMM();
        bytes memory ammInit = abi.encodeWithSelector(
            VibeAMM.initialize.selector,
            owner,
            address(0x1) // Placeholder, will update
        );
        ERC1967Proxy ammProxy = new ERC1967Proxy(address(ammImpl), ammInit);
        amm = VibeAMM(address(ammProxy));

        // Deploy Treasury
        bytes memory treasuryInit = abi.encodeWithSelector(
            DAOTreasury.initialize.selector,
            owner,
            address(amm)
        );
        ERC1967Proxy treasuryProxy = new ERC1967Proxy(address(treasuryImpl), treasuryInit);
        treasury = DAOTreasury(payable(address(treasuryProxy)));

        // Update AMM treasury
        amm.setTreasury(address(treasury));

        // Deploy Auction
        CommitRevealAuction auctionImpl = new CommitRevealAuction();
        bytes memory auctionInit = abi.encodeWithSelector(
            CommitRevealAuction.initialize.selector,
            owner,
            address(treasury)
        );
        ERC1967Proxy auctionProxy = new ERC1967Proxy(address(auctionImpl), auctionInit);
        auction = CommitRevealAuction(payable(address(auctionProxy)));

        // Deploy Router
        CrossChainRouter routerImpl = new CrossChainRouter();
        bytes memory routerInit = abi.encodeWithSelector(
            CrossChainRouter.initialize.selector,
            owner,
            address(endpoint),
            address(auction)
        );
        ERC1967Proxy routerProxy = new ERC1967Proxy(address(routerImpl), routerInit);
        router = CrossChainRouter(payable(address(routerProxy)));

        // Deploy Core
        VibeSwapCore coreImpl = new VibeSwapCore();
        bytes memory coreInit = abi.encodeWithSelector(
            VibeSwapCore.initialize.selector,
            owner,
            address(auction),
            address(amm),
            address(treasury),
            address(router)
        );
        ERC1967Proxy coreProxy = new ERC1967Proxy(address(coreImpl), coreInit);
        core = VibeSwapCore(payable(address(coreProxy)));

        // Setup authorizations
        auction.setAuthorizedSettler(address(core), true);
        amm.setAuthorizedExecutor(address(core), true);
        treasury.setAuthorizedFeeSender(address(amm), true);
        treasury.setAuthorizedFeeSender(address(core), true);
        router.setAuthorized(address(core), true);
    }

    function _setupPools() internal {
        // Create ETH/USDC pool
        ethUsdcPool = core.createPool(address(weth), address(usdc), 30);

        // Create BTC/USDC pool
        btcUsdcPool = core.createPool(address(wbtc), address(usdc), 30);

        // Mint tokens to LPs
        weth.mint(lp1, 100 ether);
        usdc.mint(lp1, 200000e6);
        wbtc.mint(lp1, 10e8);

        weth.mint(lp2, 50 ether);
        usdc.mint(lp2, 100000e6);

        // Add initial liquidity
        vm.startPrank(lp1);
        weth.approve(address(amm), type(uint256).max);
        usdc.approve(address(amm), type(uint256).max);
        wbtc.approve(address(amm), type(uint256).max);

        amm.addLiquidity(ethUsdcPool, 100 ether, 200000e6, 0, 0);
        amm.addLiquidity(btcUsdcPool, 10e8, 400000e6, 0, 0);
        vm.stopPrank();
    }

    function _fundTraders() internal {
        // Fund trader1 with WETH
        weth.mint(trader1, 10 ether);
        vm.prank(trader1);
        weth.approve(address(core), type(uint256).max);
        vm.deal(trader1, 1 ether);

        // Fund trader2 with USDC
        usdc.mint(trader2, 10000e6);
        vm.prank(trader2);
        usdc.approve(address(core), type(uint256).max);
        vm.deal(trader2, 1 ether);

        // Fund trader3 with both
        weth.mint(trader3, 5 ether);
        usdc.mint(trader3, 5000e6);
        vm.startPrank(trader3);
        weth.approve(address(core), type(uint256).max);
        usdc.approve(address(core), type(uint256).max);
        vm.stopPrank();
        vm.deal(trader3, 1 ether);
    }

    // ============ Integration Tests ============

    function test_fullSwapFlow_singleOrder() public {
        bytes32 secret = keccak256("secret1");

        // Commit phase
        vm.prank(trader1);
        bytes32 commitId = core.commitSwap{value: 0.01 ether}(
            address(weth),
            address(usdc),
            1 ether,
            1900e6, // Expect ~1900 USDC (with slippage)
            secret
        );

        // Move to reveal phase
        vm.warp(block.timestamp + 9);

        // Reveal
        vm.prank(trader1);
        core.revealSwap(commitId, 0);

        // Move to settling phase
        vm.warp(block.timestamp + 3);

        uint256 usdcBefore = usdc.balanceOf(trader1);

        // Settle batch
        core.settleBatch(1);

        uint256 usdcAfter = usdc.balanceOf(trader1);
        assertGt(usdcAfter, usdcBefore);
    }

    function test_fullSwapFlow_multipleOrders() public {
        bytes32 secret1 = keccak256("secret1");
        bytes32 secret2 = keccak256("secret2");
        bytes32 secret3 = keccak256("secret3");

        // Trader1: Sell 1 WETH for USDC
        vm.prank(trader1);
        bytes32 commitId1 = core.commitSwap{value: 0.01 ether}(
            address(weth),
            address(usdc),
            1 ether,
            1800e6,
            secret1
        );

        // Trader2: Buy WETH with 2000 USDC
        vm.prank(trader2);
        bytes32 commitId2 = core.commitSwap{value: 0.01 ether}(
            address(usdc),
            address(weth),
            2000e6,
            0.9 ether,
            secret2
        );

        // Trader3: Sell 0.5 WETH
        vm.prank(trader3);
        bytes32 commitId3 = core.commitSwap{value: 0.01 ether}(
            address(weth),
            address(usdc),
            0.5 ether,
            900e6,
            secret3
        );

        // Move to reveal phase
        vm.warp(block.timestamp + 9);

        // Reveals
        vm.prank(trader1);
        core.revealSwap(commitId1, 0);

        vm.prank(trader2);
        core.revealSwap{value: 0.05 ether}(commitId2, 0.05 ether); // Priority bid

        vm.prank(trader3);
        core.revealSwap(commitId3, 0);

        // Move to settling and settle
        vm.warp(block.timestamp + 3);
        core.settleBatch(1);

        // Verify all traders received tokens
        assertGt(usdc.balanceOf(trader1), 0); // Got USDC
        assertGt(weth.balanceOf(trader2), 0); // Got WETH
        assertGt(usdc.balanceOf(trader3), 0); // Got USDC
    }

    function test_priorityBidOrdering() public {
        bytes32 secret1 = keccak256("secret1");
        bytes32 secret2 = keccak256("secret2");

        // Both traders want to swap WETH for USDC
        vm.prank(trader1);
        bytes32 commitId1 = core.commitSwap{value: 0.01 ether}(
            address(weth),
            address(usdc),
            1 ether,
            0,
            secret1
        );

        vm.prank(trader3);
        bytes32 commitId2 = core.commitSwap{value: 0.01 ether}(
            address(weth),
            address(usdc),
            1 ether,
            0,
            secret2
        );

        vm.warp(block.timestamp + 9);

        // Trader1 reveals with no priority bid
        vm.prank(trader1);
        core.revealSwap(commitId1, 0);

        // Trader3 reveals with priority bid
        vm.prank(trader3);
        core.revealSwap{value: 0.1 ether}(commitId2, 0.1 ether);

        vm.warp(block.timestamp + 3);

        // Get execution order before settling
        core.settleBatch(1);

        uint256[] memory order = auction.getExecutionOrder(1);
        // Trader3 (index 1) should be first due to priority bid
        assertEq(order[0], 1);
        assertEq(order[1], 0);
    }

    function test_invalidReveal_slashes() public {
        bytes32 secret = keccak256("secret1");

        vm.prank(trader1);
        bytes32 commitId = core.commitSwap{value: 0.01 ether}(
            address(weth),
            address(usdc),
            1 ether,
            1900e6,
            secret
        );

        vm.warp(block.timestamp + 9);

        uint256 treasuryBefore = address(treasury).balance;

        // Reveal with wrong parameters (directly to auction to test slashing)
        vm.prank(trader1);
        auction.revealOrder(
            commitId,
            address(weth),
            address(usdc),
            2 ether, // Wrong amount
            1900e6,
            secret,
            0
        );

        // Treasury should receive slashed funds
        assertGt(address(treasury).balance, treasuryBefore);
    }

    function test_liquidityProviderFlow() public {
        uint256 wethBefore = weth.balanceOf(lp2);
        uint256 usdcBefore = usdc.balanceOf(lp2);

        // Add liquidity
        vm.startPrank(lp2);
        weth.approve(address(amm), type(uint256).max);
        usdc.approve(address(amm), type(uint256).max);

        (uint256 amount0, uint256 amount1, uint256 liquidity) = amm.addLiquidity(
            ethUsdcPool,
            10 ether,
            20000e6,
            0,
            0
        );
        vm.stopPrank();

        assertGt(liquidity, 0);

        // Some swaps occur (generate fees)
        bytes32 secret = keccak256("s");
        vm.prank(trader1);
        bytes32 cid = core.commitSwap{value: 0.01 ether}(address(weth), address(usdc), 1 ether, 0, secret);

        vm.warp(block.timestamp + 9);
        vm.prank(trader1);
        core.revealSwap(cid, 0);

        vm.warp(block.timestamp + 3);
        core.settleBatch(1);

        // Remove liquidity
        vm.prank(lp2);
        (uint256 out0, uint256 out1) = amm.removeLiquidity(ethUsdcPool, liquidity, 0, 0);

        // Should get back roughly what was deposited (plus fees)
        assertGt(out0, 0);
        assertGt(out1, 0);
    }

    function test_treasuryReceivesFees() public {
        uint256 treasuryBalanceBefore = address(treasury).balance;

        // Execute multiple swaps with priority bids
        bytes32 secret = keccak256("s");

        vm.prank(trader1);
        bytes32 cid = core.commitSwap{value: 0.01 ether}(address(weth), address(usdc), 1 ether, 0, secret);

        vm.warp(block.timestamp + 9);

        vm.prank(trader1);
        core.revealSwap{value: 0.1 ether}(cid, 0.1 ether);

        vm.warp(block.timestamp + 3);
        core.settleBatch(1);

        // Treasury should have received priority bid
        assertGt(address(treasury).balance, treasuryBalanceBefore);
    }

    function test_batchPhaseTransitions() public {
        // Initial state
        (uint64 batchId, ICommitRevealAuction.BatchPhase phase,) = core.getCurrentBatch();
        assertEq(batchId, 1);
        assertEq(uint256(phase), uint256(ICommitRevealAuction.BatchPhase.COMMIT));

        // After 800ms
        vm.warp(block.timestamp + 8);
        (, phase,) = core.getCurrentBatch();
        assertEq(uint256(phase), uint256(ICommitRevealAuction.BatchPhase.REVEAL));

        // After 1000ms
        vm.warp(block.timestamp + 3);
        (, phase,) = core.getCurrentBatch();
        assertEq(uint256(phase), uint256(ICommitRevealAuction.BatchPhase.SETTLING));

        // After settlement
        core.settleBatch(1);
        (batchId,,) = core.getCurrentBatch();
        assertEq(batchId, 2); // New batch started
    }

    function test_quoteAccuracy() public view {
        uint256 quoted = core.getQuote(address(weth), address(usdc), 1 ether);

        // With 100 WETH and 200000 USDC reserves, 1 WETH should get ~1980 USDC
        // (accounting for 0.3% fee and slippage)
        assertGt(quoted, 1900e6);
        assertLt(quoted, 2000e6);
    }

    function test_poolInfo() public view {
        VibeSwapCore.PoolInfo memory info = core.getPoolInfo(address(weth), address(usdc));

        assertEq(info.poolId, ethUsdcPool);
        assertEq(info.reserve0, 100 ether);
        assertEq(info.reserve1, 200000e6);
        assertEq(info.feeRate, 30);
        assertGt(info.spotPrice, 0);
    }

    function test_pauseUnpause() public {
        core.pause();

        bytes32 secret = keccak256("s");

        vm.prank(trader1);
        vm.expectRevert(VibeSwapCore.ContractPaused.selector);
        core.commitSwap{value: 0.01 ether}(address(weth), address(usdc), 1 ether, 0, secret);

        core.unpause();

        vm.prank(trader1);
        core.commitSwap{value: 0.01 ether}(address(weth), address(usdc), 1 ether, 0, secret);
    }

    function test_unsupportedToken() public {
        MockERC20 unsupported = new MockERC20("Bad", "BAD");
        unsupported.mint(trader1, 100 ether);

        vm.prank(trader1);
        unsupported.approve(address(core), type(uint256).max);

        vm.prank(trader1);
        vm.expectRevert(VibeSwapCore.UnsupportedToken.selector);
        core.commitSwap{value: 0.01 ether}(address(unsupported), address(usdc), 1 ether, 0, keccak256("s"));
    }

    function test_deterministicShuffleConsistency() public {
        // Two batches with same secrets should produce same shuffle
        bytes32 secret1 = keccak256("a");
        bytes32 secret2 = keccak256("b");

        // First batch
        vm.prank(trader1);
        bytes32 cid1 = core.commitSwap{value: 0.01 ether}(address(weth), address(usdc), 1 ether, 0, secret1);

        vm.prank(trader3);
        bytes32 cid2 = core.commitSwap{value: 0.01 ether}(address(weth), address(usdc), 0.5 ether, 0, secret2);

        vm.warp(block.timestamp + 9);

        vm.prank(trader1);
        core.revealSwap(cid1, 0);

        vm.prank(trader3);
        core.revealSwap(cid2, 0);

        vm.warp(block.timestamp + 3);
        core.settleBatch(1);

        ICommitRevealAuction.Batch memory batch1 = auction.getBatch(1);
        bytes32 seed1 = batch1.shuffleSeed;

        // The seed should be deterministic based on secrets
        assertTrue(seed1 != bytes32(0));

        // Verify shuffle is reproducible
        uint256[] memory order = auction.getExecutionOrder(1);
        assertEq(order.length, 2);
    }

    function test_constantProductInvariant() public {
        IVibeAMM.Pool memory poolBefore = amm.getPool(ethUsdcPool);
        uint256 kBefore = poolBefore.reserve0 * poolBefore.reserve1;

        // Execute a swap
        bytes32 secret = keccak256("s");
        vm.prank(trader1);
        bytes32 cid = core.commitSwap{value: 0.01 ether}(address(weth), address(usdc), 1 ether, 0, secret);

        vm.warp(block.timestamp + 9);
        vm.prank(trader1);
        core.revealSwap(cid, 0);

        vm.warp(block.timestamp + 3);
        core.settleBatch(1);

        IVibeAMM.Pool memory poolAfter = amm.getPool(ethUsdcPool);
        uint256 kAfter = poolAfter.reserve0 * poolAfter.reserve1;

        // k should only increase (due to fees)
        assertGe(kAfter, kBefore);
    }
}
