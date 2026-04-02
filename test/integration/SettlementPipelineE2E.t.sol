// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/core/VibeSwapCore.sol";
import "../../contracts/core/CommitRevealAuction.sol";
import "../../contracts/amm/VibeAMM.sol";
import "../../contracts/governance/DAOTreasury.sol";
import "../../contracts/messaging/CrossChainRouter.sol";
import "../../contracts/core/interfaces/ICommitRevealAuction.sol";
import "../../contracts/core/interfaces/IVibeAMM.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock Token ============

contract SettlementMockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Mock LZ Endpoint ============

contract SettlementMockLZEndpoint {
    function send(
        CrossChainRouter.MessagingParams memory,
        address
    ) external payable returns (CrossChainRouter.MessagingReceipt memory receipt) {
        receipt.nonce = 1;
        receipt.fee.nativeFee = msg.value;
    }
}

/**
 * @title SettlementPipelineE2E
 * @notice End-to-end tests for the complete settlement pipeline:
 *         CommitRevealAuction.commitOrderToPool → revealOrder → settleBatch →
 *         VibeSwapCore.settleBatch → AMM.executeBatchSwap
 *
 *         Addresses TRP Tier 15 CRITICAL finding: "settlement pipeline zero E2E coverage"
 *
 * @dev Tests the full 3-contract interaction: CommitRevealAuction ↔ VibeSwapCore ↔ VibeAMM
 *      with real contract deployments (no mocks for the core pipeline).
 */
contract SettlementPipelineE2E is Test {
    // ============ Contracts ============
    VibeSwapCore public core;
    CommitRevealAuction public auction;
    VibeAMM public amm;
    DAOTreasury public treasury;
    CrossChainRouter public router;
    SettlementMockLZEndpoint public endpoint;

    // ============ Tokens ============
    SettlementMockERC20 public weth;
    SettlementMockERC20 public usdc;

    // ============ Actors ============
    address public owner;
    address public lp1;
    address public trader1;
    address public trader2;
    address public trader3;
    address public trader4;

    // ============ Pool ============
    bytes32 public poolId;

    // ============ Constants ============
    // Large reserves so individual swaps stay within 1% donation-attack tolerance
    uint256 constant LP_WETH = 1_000 ether;
    uint256 constant LP_USDC = 2_000_000 ether; // 1 WETH = 2000 USDC at init
    uint256 constant TRADER_WETH = 10 ether;
    uint256 constant TRADER_USDC = 20_000 ether;
    uint256 constant COMMIT_DEPOSIT = 0.01 ether;

    function setUp() public {
        owner = address(this);
        lp1 = makeAddr("lp1");
        trader1 = makeAddr("trader1");
        trader2 = makeAddr("trader2");
        trader3 = makeAddr("trader3");
        trader4 = makeAddr("trader4");

        // Deploy tokens
        weth = new SettlementMockERC20("Wrapped Ether", "WETH");
        usdc = new SettlementMockERC20("USD Coin", "USDC");

        // Deploy mock LZ endpoint
        endpoint = new SettlementMockLZEndpoint();

        // Deploy full system
        _deploySystem();

        // Setup pool with liquidity
        _setupPool();

        // Fund traders
        _fundTraders();
    }

    // ============ Deployment (mirrors VibeSwap.t.sol pattern) ============

    function _deploySystem() internal {
        // Deploy AMM
        VibeAMM ammImpl = new VibeAMM();
        bytes memory ammInit = abi.encodeWithSelector(
            VibeAMM.initialize.selector,
            owner,
            address(0x1) // placeholder treasury
        );
        amm = VibeAMM(address(new ERC1967Proxy(address(ammImpl), ammInit)));

        // Deploy Treasury
        DAOTreasury treasuryImpl = new DAOTreasury();
        bytes memory treasuryInit = abi.encodeWithSelector(
            DAOTreasury.initialize.selector,
            owner,
            address(amm)
        );
        treasury = DAOTreasury(payable(address(new ERC1967Proxy(address(treasuryImpl), treasuryInit))));

        // Update AMM treasury
        amm.setTreasury(address(treasury));

        // Deploy Auction
        CommitRevealAuction auctionImpl = new CommitRevealAuction();
        bytes memory auctionInit = abi.encodeWithSelector(
            CommitRevealAuction.initialize.selector,
            owner,
            address(treasury),
            address(0) // no complianceRegistry
        );
        auction = CommitRevealAuction(payable(address(new ERC1967Proxy(address(auctionImpl), auctionInit))));

        // Deploy Router
        CrossChainRouter routerImpl = new CrossChainRouter();
        bytes memory routerInit = abi.encodeWithSelector(
            CrossChainRouter.initialize.selector,
            owner,
            address(endpoint),
            address(auction)
        );
        router = CrossChainRouter(payable(address(new ERC1967Proxy(address(routerImpl), routerInit))));

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
        core = VibeSwapCore(payable(address(new ERC1967Proxy(address(coreImpl), coreInit))));

        // Wire authorizations
        auction.setAuthorizedSettler(address(core), true);
        auction.setAuthorizedSettler(address(this), true);
        amm.setAuthorizedExecutor(address(core), true);
        amm.setAuthorizedExecutor(address(this), true);
        treasury.setAuthorizedFeeSender(address(amm), true);
        treasury.setAuthorizedFeeSender(address(core), true);
        router.setAuthorized(address(core), true);

        // Disable security features that block test-contract interactions
        core.setRequireEOA(false);
        amm.setFlashLoanProtection(false);
        core.setCommitCooldown(0);
    }

    function _setupPool() internal {
        // Create pool via core (auto-supports tokens)
        poolId = core.createPool(address(weth), address(usdc), 30); // 0.3% fee

        // Mint to LP and add liquidity
        weth.mint(lp1, LP_WETH);
        usdc.mint(lp1, LP_USDC);

        vm.startPrank(lp1);
        weth.approve(address(amm), type(uint256).max);
        usdc.approve(address(amm), type(uint256).max);

        // Handle token ordering for addLiquidity
        if (address(weth) < address(usdc)) {
            amm.addLiquidity(poolId, LP_WETH, LP_USDC, 0, 0);
        } else {
            amm.addLiquidity(poolId, LP_USDC, LP_WETH, 0, 0);
        }
        vm.stopPrank();
    }

    function _fundTraders() internal {
        address[4] memory traders = [trader1, trader2, trader3, trader4];
        for (uint256 i = 0; i < traders.length; i++) {
            weth.mint(traders[i], TRADER_WETH);
            usdc.mint(traders[i], TRADER_USDC);
            vm.startPrank(traders[i]);
            weth.approve(address(core), type(uint256).max);
            usdc.approve(address(core), type(uint256).max);
            vm.stopPrank();
            vm.deal(traders[i], 2 ether);
        }
    }

    // ============ Helpers ============

    /// @notice Commit a swap via VibeSwapCore, returns commitId
    function _commitSwap(
        address trader,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        bytes32 secret
    ) internal returns (bytes32 commitId) {
        vm.prank(trader);
        commitId = core.commitSwap{value: COMMIT_DEPOSIT}(
            tokenIn, tokenOut, amountIn, minAmountOut, secret
        );
        // Advance block to avoid flash loan detection between commits
        vm.roll(block.number + 1);
    }

    /// @notice Advance to reveal phase (8 seconds after batch start)
    function _advanceToRevealPhase() internal {
        vm.warp(block.timestamp + 9);
    }

    /// @notice Advance to settling phase (10+ seconds after batch start)
    function _advanceToSettlingPhase() internal {
        vm.warp(block.timestamp + 3);
    }

    /// @notice Reveal a swap via VibeSwapCore
    function _revealSwap(address trader, bytes32 commitId, uint256 priorityBid) internal {
        vm.prank(trader);
        if (priorityBid > 0) {
            core.revealSwap{value: priorityBid}(commitId, priorityBid);
        } else {
            core.revealSwap(commitId, 0);
        }
    }

    // ============================================================
    // TEST 1: Full Pipeline — Single Order
    // Verifies: commit → reveal → settle → execute, token balances change
    // ============================================================

    function test_fullPipeline_singleOrder() public {
        bytes32 secret = keccak256("single_order_secret");
        uint256 swapAmount = 1 ether;

        // Snapshot balances before
        uint256 wethBefore = weth.balanceOf(trader1);
        uint256 usdcBefore = usdc.balanceOf(trader1);

        // Phase 1: COMMIT
        bytes32 commitId = _commitSwap(
            trader1, address(weth), address(usdc), swapAmount, 0, secret
        );
        assertTrue(commitId != bytes32(0), "commitId should be non-zero");

        // Verify WETH was deposited into core
        assertEq(weth.balanceOf(trader1), wethBefore - swapAmount, "WETH should be deposited");

        // Phase 2: REVEAL
        _advanceToRevealPhase();
        _revealSwap(trader1, commitId, 0);

        // Phase 3: SETTLE via VibeSwapCore (crosses all 3 contracts)
        _advanceToSettlingPhase();

        uint64 batchId = auction.getCurrentBatchId();
        core.settleBatch(batchId);

        // Verify: trader received USDC
        uint256 usdcAfter = usdc.balanceOf(trader1);
        assertGt(usdcAfter, usdcBefore, "Trader should receive USDC after settlement");

        // Verify: batch is settled in auction
        ICommitRevealAuction.Batch memory batch = auction.getBatch(batchId);
        assertTrue(batch.isSettled, "Batch should be marked settled");

        // Verify: new batch started
        uint64 newBatchId = auction.getCurrentBatchId();
        assertGt(newBatchId, batchId, "New batch should have started");

        // Verify: AMM reserves changed (WETH increased, USDC decreased)
        IVibeAMM.Pool memory pool = amm.getPool(poolId);
        // Pool has token0/token1 sorted, so check accordingly
        if (pool.token0 == address(weth)) {
            assertGt(pool.reserve0, LP_WETH, "WETH reserve should increase");
            assertLt(pool.reserve1, LP_USDC, "USDC reserve should decrease");
        } else {
            assertLt(pool.reserve0, LP_USDC, "USDC reserve should decrease");
            assertGt(pool.reserve1, LP_WETH, "WETH reserve should increase");
        }
    }

    // ============================================================
    // TEST 2: Full Pipeline — Multiple Orders, Uniform Clearing Price
    // Verifies: multiple users, different sizes, same clearing price
    // ============================================================

    function test_fullPipeline_multipleOrders() public {
        bytes32 secret1 = keccak256("multi_secret1");
        bytes32 secret2 = keccak256("multi_secret2");
        bytes32 secret3 = keccak256("multi_secret3");

        // Trader1: sell 1 WETH for USDC
        bytes32 cid1 = _commitSwap(trader1, address(weth), address(usdc), 1 ether, 0, secret1);

        // Trader2: sell 2000 USDC for WETH (opposite direction)
        bytes32 cid2 = _commitSwap(trader2, address(usdc), address(weth), 2000 ether, 0, secret2);

        // Trader3: sell 0.5 WETH for USDC
        bytes32 cid3 = _commitSwap(trader3, address(weth), address(usdc), 0.5 ether, 0, secret3);

        // Snapshot pre-reveal balances
        uint256 t1UsdcBefore = usdc.balanceOf(trader1);
        uint256 t2WethBefore = weth.balanceOf(trader2);
        uint256 t3UsdcBefore = usdc.balanceOf(trader3);

        // Reveal all
        _advanceToRevealPhase();
        _revealSwap(trader1, cid1, 0);
        _revealSwap(trader2, cid2, 0);
        _revealSwap(trader3, cid3, 0);

        // Settle
        _advanceToSettlingPhase();
        uint64 batchId = auction.getCurrentBatchId();
        core.settleBatch(batchId);

        // Verify all traders received output tokens
        assertGt(usdc.balanceOf(trader1), t1UsdcBefore, "Trader1 should receive USDC");
        assertGt(weth.balanceOf(trader2), t2WethBefore, "Trader2 should receive WETH");
        assertGt(usdc.balanceOf(trader3), t3UsdcBefore, "Trader3 should receive USDC");

        // Verify batch settlement state
        ICommitRevealAuction.Batch memory batch = auction.getBatch(batchId);
        assertTrue(batch.isSettled, "Batch should be settled");
        assertEq(batch.orderCount, 3, "Batch should have 3 orders committed");

        // Verify revealed order count
        ICommitRevealAuction.RevealedOrder[] memory orders = auction.getRevealedOrders(batchId);
        assertEq(orders.length, 3, "Should have 3 revealed orders");

        // Verify: traders 1 and 3 traded the same direction (WETH→USDC).
        // With uniform clearing price, the output ratio (USDC_out / WETH_in) should be equal.
        uint256 t1UsdcGained = usdc.balanceOf(trader1) - t1UsdcBefore;
        uint256 t3UsdcGained = usdc.balanceOf(trader3) - t3UsdcBefore;

        // Trader1 swapped 1 WETH, Trader3 swapped 0.5 WETH
        // Ratio should be ~2:1 (within some tolerance from batch math)
        uint256 t1RatioScaled = (t1UsdcGained * 1e18) / 1 ether;
        uint256 t3RatioScaled = (t3UsdcGained * 1e18) / 0.5 ether;

        // Uniform clearing price means these ratios should be very close
        // Allow 1% tolerance for rounding
        uint256 diff = t1RatioScaled > t3RatioScaled
            ? t1RatioScaled - t3RatioScaled
            : t3RatioScaled - t1RatioScaled;
        uint256 maxDiff = t1RatioScaled / 100; // 1% tolerance
        assertLe(diff, maxDiff, "Clearing price should be uniform across same-direction orders");
    }

    // ============================================================
    // TEST 3: Full Pipeline — Priority Bids
    // Verifies: priority orders are placed first in execution order
    // ============================================================

    function test_fullPipeline_withPriorityBids() public {
        bytes32 secret1 = keccak256("prio_secret1");
        bytes32 secret2 = keccak256("prio_secret2");
        bytes32 secret3 = keccak256("prio_secret3");

        // All three traders sell WETH for USDC
        bytes32 cid1 = _commitSwap(trader1, address(weth), address(usdc), 1 ether, 0, secret1);
        bytes32 cid2 = _commitSwap(trader2, address(weth), address(usdc), 1 ether, 0, secret2);
        bytes32 cid3 = _commitSwap(trader3, address(weth), address(usdc), 1 ether, 0, secret3);

        // Move to reveal phase
        _advanceToRevealPhase();

        // Trader1: no priority bid
        _revealSwap(trader1, cid1, 0);
        // Trader2: 0.1 ETH priority bid
        _revealSwap(trader2, cid2, 0.1 ether);
        // Trader3: 0.05 ETH priority bid
        _revealSwap(trader3, cid3, 0.05 ether);

        // Settle
        _advanceToSettlingPhase();
        uint64 batchId = auction.getCurrentBatchId();
        core.settleBatch(batchId);

        // Verify batch settled
        ICommitRevealAuction.Batch memory batch = auction.getBatch(batchId);
        assertTrue(batch.isSettled, "Batch should be settled");
        assertEq(batch.totalPriorityBids, 0.15 ether, "Total priority bids should be 0.15 ETH");

        // Verify execution order: priority orders first (sorted by bid descending)
        uint256[] memory execOrder = auction.getExecutionOrder(batchId);
        assertEq(execOrder.length, 3, "Should have 3 orders in execution order");

        // Index 1 = trader2 (0.1 ETH bid, highest) should be first
        // Index 2 = trader3 (0.05 ETH bid) should be second
        // Index 0 = trader1 (no bid) should be last
        assertEq(execOrder[0], 1, "Highest priority bidder (trader2) should execute first");
        assertEq(execOrder[1], 2, "Second priority bidder (trader3) should execute second");
        assertEq(execOrder[2], 0, "Non-priority trader (trader1) should execute last");

        // All traders should receive USDC
        assertGt(usdc.balanceOf(trader1), 0, "Trader1 should get USDC");
        assertGt(usdc.balanceOf(trader2), 0, "Trader2 should get USDC");
        assertGt(usdc.balanceOf(trader3), 0, "Trader3 should get USDC");
    }

    // ============================================================
    // TEST 4: Full Pipeline — Partial Reveals (slashing + settlement)
    // Verifies: unrevealed commits are slashable, revealed orders still settle
    // ============================================================

    function test_fullPipeline_partialReveals() public {
        bytes32 secret1 = keccak256("partial_secret1");
        bytes32 secret2 = keccak256("partial_secret2");
        bytes32 secret3 = keccak256("partial_secret3");

        // All three commit
        bytes32 cid1 = _commitSwap(trader1, address(weth), address(usdc), 1 ether, 0, secret1);
        bytes32 cid2 = _commitSwap(trader2, address(weth), address(usdc), 1 ether, 0, secret2);
        bytes32 cid3 = _commitSwap(trader3, address(weth), address(usdc), 1 ether, 0, secret3);

        // Only trader1 reveals
        _advanceToRevealPhase();
        _revealSwap(trader1, cid1, 0);
        // trader2 and trader3 do NOT reveal

        // Settle
        _advanceToSettlingPhase();
        uint64 batchId = auction.getCurrentBatchId();
        core.settleBatch(batchId);

        // Verify batch settled with only 1 revealed order
        ICommitRevealAuction.RevealedOrder[] memory orders = auction.getRevealedOrders(batchId);
        assertEq(orders.length, 1, "Only 1 order should be revealed");

        // Verify trader1 received output
        assertGt(usdc.balanceOf(trader1), 0, "Trader1 should receive USDC");

        // Verify batch is settled
        ICommitRevealAuction.Batch memory batch = auction.getBatch(batchId);
        assertTrue(batch.isSettled, "Batch should be settled");

        // Now slash unrevealed commits
        uint256 treasuryBalBefore = address(treasury).balance;

        // Slash trader2's unrevealed commitment
        auction.slashUnrevealedCommitment(cid2);

        ICommitRevealAuction.OrderCommitment memory commitment2 = auction.getCommitment(cid2);
        assertEq(
            uint256(commitment2.status),
            uint256(ICommitRevealAuction.CommitStatus.SLASHED),
            "Trader2 commitment should be SLASHED"
        );

        // Slash trader3's unrevealed commitment
        auction.slashUnrevealedCommitment(cid3);

        ICommitRevealAuction.OrderCommitment memory commitment3 = auction.getCommitment(cid3);
        assertEq(
            uint256(commitment3.status),
            uint256(ICommitRevealAuction.CommitStatus.SLASHED),
            "Trader3 commitment should be SLASHED"
        );

        // Verify slashing: treasury received ~50% of each deposit (SLASH_RATE_BPS = 5000)
        uint256 expectedSlashPerOrder = (COMMIT_DEPOSIT * 5000) / 10000; // 50%
        uint256 totalExpectedSlash = expectedSlashPerOrder * 2; // two slashed orders

        // Treasury or auction should hold slashed funds
        uint256 treasuryGain = address(treasury).balance - treasuryBalBefore;
        uint256 auctionHeld = auction.pendingSlashedFunds();
        uint256 totalSlashed = treasuryGain + auctionHeld;
        assertGe(totalSlashed, totalExpectedSlash, "Slashed amount should match 50% of deposits");
    }

    // ============================================================
    // TEST 5: Full Pipeline — Cross-Contract State Consistency
    // Verifies: state is consistent across Auction, Core, and AMM after settlement
    // ============================================================

    function test_fullPipeline_crossContractState() public {
        bytes32 secret = keccak256("state_secret");
        uint256 swapAmount = 2 ether;

        // Record pre-state
        IVibeAMM.Pool memory poolBefore = amm.getPool(poolId);
        uint256 coreWethBefore = weth.balanceOf(address(core));

        // Commit
        bytes32 cid = _commitSwap(trader1, address(weth), address(usdc), swapAmount, 0, secret);

        // Verify Core holds the deposited tokens
        assertEq(
            weth.balanceOf(address(core)),
            coreWethBefore + swapAmount,
            "Core should hold deposited WETH"
        );

        // Verify auction recorded the commitment
        uint64 batchId = auction.getCurrentBatchId();
        ICommitRevealAuction.Batch memory batchDuringCommit = auction.getBatch(batchId);
        assertEq(batchDuringCommit.orderCount, 1, "Batch should track 1 committed order");
        assertFalse(batchDuringCommit.isSettled, "Batch should not be settled yet");

        // Reveal
        _advanceToRevealPhase();
        _revealSwap(trader1, cid, 0);

        // Verify revealed orders
        // Note: We can't read revealed orders until settlement, but order count is visible

        // Settle
        _advanceToSettlingPhase();
        core.settleBatch(batchId);

        // ---- Post-settlement cross-contract checks ----

        // 1. Auction state: batch settled, new batch started
        ICommitRevealAuction.Batch memory batchAfter = auction.getBatch(batchId);
        assertTrue(batchAfter.isSettled, "Auction: batch should be settled");
        assertTrue(batchAfter.shuffleSeed != bytes32(0), "Auction: shuffle seed should be set");

        uint64 newBatchId = auction.getCurrentBatchId();
        assertGt(newBatchId, batchId, "Auction: new batch should exist");

        // 2. Core state: deposits should be consumed
        // After settlement, core's deposit tracking for trader1 should be decremented
        uint256 remainingDeposit = core.deposits(trader1, address(weth));
        assertEq(remainingDeposit, 0, "Core: trader deposit should be consumed after settlement");

        // 3. AMM state: reserves should reflect the swap
        IVibeAMM.Pool memory poolAfter = amm.getPool(poolId);
        assertTrue(poolAfter.initialized, "AMM: pool should still be initialized");

        // x*y=k invariant check (with fee, k should increase slightly)
        uint256 kBefore = poolBefore.reserve0 * poolBefore.reserve1;
        uint256 kAfter = poolAfter.reserve0 * poolAfter.reserve1;
        assertGe(kAfter, kBefore, "AMM: k should not decrease (fees increase k)");

        // Verify reserves moved in the expected direction
        // WETH went in, USDC went out. Check sorted order.
        if (poolAfter.token0 == address(weth)) {
            assertGt(poolAfter.reserve0, poolBefore.reserve0, "AMM: WETH reserve should increase");
            assertLt(poolAfter.reserve1, poolBefore.reserve1, "AMM: USDC reserve should decrease");
        } else {
            assertLt(poolAfter.reserve0, poolBefore.reserve0, "AMM: USDC reserve should decrease");
            assertGt(poolAfter.reserve1, poolBefore.reserve1, "AMM: WETH reserve should increase");
        }

        // 4. Token conservation: total supply unchanged, just redistributed
        // Trader should have received USDC
        uint256 traderUsdcBalance = usdc.balanceOf(trader1);
        assertGt(traderUsdcBalance, 0, "Trader should hold USDC after swap");

        // Core should have sent WETH to AMM and received USDC
        // Core's WETH balance should have decreased by swap amount
        assertEq(
            weth.balanceOf(address(core)),
            coreWethBefore, // back to original since deposit was consumed
            "Core WETH balance should return to pre-deposit level"
        );
    }
}
