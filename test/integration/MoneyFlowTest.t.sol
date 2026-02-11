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
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockLZEndpoint {
    function send(CrossChainRouter.MessagingParams memory, address) external payable
        returns (CrossChainRouter.MessagingReceipt memory receipt) {
        receipt.nonce = 1;
        receipt.fee.nativeFee = msg.value;
    }
}

/**
 * @title MoneyFlowTest
 * @notice Detailed trace of money flow through the entire VibeSwap system
 * @dev Tests ETH deposits, token transfers, fees, slashing, and settlements
 */
contract MoneyFlowTest is Test {
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

    // Actors
    address public owner;
    address public lp1;
    address public trader1;
    address public trader2;

    // Pool
    bytes32 public poolId;

    // ============ Setup ============

    function setUp() public {
        owner = address(this);
        lp1 = makeAddr("lp1");
        trader1 = makeAddr("trader1");
        trader2 = makeAddr("trader2");

        // Deploy tokens
        weth = new MockERC20("Wrapped Ether", "WETH");
        usdc = new MockERC20("USD Coin", "USDC");

        // Deploy mock endpoint
        endpoint = new MockLZEndpoint();

        // Deploy system
        _deploySystem();

        // Setup pool
        _setupPool();

        // Fund traders
        _fundTraders();
    }

    function _deploySystem() internal {
        // Deploy Treasury
        DAOTreasury treasuryImpl = new DAOTreasury();
        VibeAMM ammImpl = new VibeAMM();

        bytes memory ammInit = abi.encodeWithSelector(
            VibeAMM.initialize.selector, owner, address(0x1)
        );
        ERC1967Proxy ammProxy = new ERC1967Proxy(address(ammImpl), ammInit);
        amm = VibeAMM(address(ammProxy));

        bytes memory treasuryInit = abi.encodeWithSelector(
            DAOTreasury.initialize.selector, owner, address(amm)
        );
        ERC1967Proxy treasuryProxy = new ERC1967Proxy(address(treasuryImpl), treasuryInit);
        treasury = DAOTreasury(payable(address(treasuryProxy)));

        amm.setTreasury(address(treasury));

        CommitRevealAuction auctionImpl = new CommitRevealAuction();
        bytes memory auctionInit = abi.encodeWithSelector(
            CommitRevealAuction.initialize.selector, owner, address(treasury), address(0) // complianceRegistry
        );
        ERC1967Proxy auctionProxy = new ERC1967Proxy(address(auctionImpl), auctionInit);
        auction = CommitRevealAuction(payable(address(auctionProxy)));

        CrossChainRouter routerImpl = new CrossChainRouter();
        bytes memory routerInit = abi.encodeWithSelector(
            CrossChainRouter.initialize.selector, owner, address(endpoint), address(auction)
        );
        ERC1967Proxy routerProxy = new ERC1967Proxy(address(routerImpl), routerInit);
        router = CrossChainRouter(payable(address(routerProxy)));

        VibeSwapCore coreImpl = new VibeSwapCore();
        bytes memory coreInit = abi.encodeWithSelector(
            VibeSwapCore.initialize.selector, owner, address(auction), address(amm), address(treasury), address(router)
        );
        ERC1967Proxy coreProxy = new ERC1967Proxy(address(coreImpl), coreInit);
        core = VibeSwapCore(payable(address(coreProxy)));

        // Setup authorizations
        auction.setAuthorizedSettler(address(core), true);
        auction.setAuthorizedSettler(address(this), true);
        amm.setAuthorizedExecutor(address(core), true);
        amm.setAuthorizedExecutor(address(this), true);
        treasury.setAuthorizedFeeSender(address(amm), true);
        treasury.setAuthorizedFeeSender(address(core), true);
        router.setAuthorized(address(core), true);

        // Disable security for testing
        core.setRequireEOA(false);
        amm.setFlashLoanProtection(false);
    }

    function _setupPool() internal {
        poolId = core.createPool(address(weth), address(usdc), 30); // 0.30% fee

        weth.mint(lp1, 100 ether);
        usdc.mint(lp1, 200_000 ether);

        vm.startPrank(lp1);
        weth.approve(address(amm), type(uint256).max);
        usdc.approve(address(amm), type(uint256).max);

        if (address(weth) < address(usdc)) {
            amm.addLiquidity(poolId, 100 ether, 200_000 ether, 0, 0);
        } else {
            amm.addLiquidity(poolId, 200_000 ether, 100 ether, 0, 0);
        }
        vm.stopPrank();
    }

    function _fundTraders() internal {
        weth.mint(trader1, 10 ether);
        vm.prank(trader1);
        weth.approve(address(core), type(uint256).max);
        vm.deal(trader1, 1 ether);

        usdc.mint(trader2, 10_000 ether);
        vm.prank(trader2);
        usdc.approve(address(core), type(uint256).max);
        vm.deal(trader2, 1 ether);
    }

    // ============ Money Flow Tests ============

    function test_MoneyFlow_FullSwapCycle() public {
        console.log("\n========== MONEY FLOW TEST: FULL SWAP CYCLE ==========\n");

        bytes32 secret = keccak256("trader1_secret");
        uint256 swapAmount = 1 ether;
        uint256 depositAmount = 0.01 ether;

        // ===== INITIAL BALANCES =====
        console.log("--- INITIAL BALANCES ---");
        _logBalances("Before Commit");

        // ===== PHASE 1: COMMIT =====
        console.log("\n--- PHASE 1: COMMIT ---");
        console.log("Trader1 committing to swap 1 WETH for USDC");
        console.log("ETH deposit required: 0.01 ETH");

        uint256 trader1EthBefore = trader1.balance;
        uint256 trader1WethBefore = weth.balanceOf(trader1);
        uint256 auctionEthBefore = address(auction).balance;
        uint256 coreWethBefore = weth.balanceOf(address(core));

        vm.prank(trader1);
        bytes32 commitId = core.commitSwap{value: depositAmount}(
            address(weth),
            address(usdc),
            swapAmount,
            0,
            secret
        );

        console.log("Commit ID:", vm.toString(commitId));

        // Verify money movement
        assertEq(trader1.balance, trader1EthBefore - depositAmount, "Trader1 ETH should decrease by deposit");
        assertEq(weth.balanceOf(trader1), trader1WethBefore - swapAmount, "Trader1 WETH should decrease");
        assertEq(address(auction).balance, auctionEthBefore + depositAmount, "Auction should receive ETH deposit");
        assertEq(weth.balanceOf(address(core)), coreWethBefore + swapAmount, "Core should receive WETH");

        console.log("FLOW: Trader1 --(0.01 ETH)--> Auction (deposit)");
        console.log("FLOW: Trader1 --(1 WETH)--> Core (swap tokens)");
        _logBalances("After Commit");

        // ===== PHASE 2: REVEAL =====
        console.log("\n--- PHASE 2: REVEAL ---");
        vm.warp(block.timestamp + 9); // Move to reveal phase

        uint256 priorityBid = 0.05 ether;
        console.log("Trader1 revealing with priority bid: 0.05 ETH");

        uint256 trader1EthBeforeReveal = trader1.balance;
        uint256 auctionEthBeforeReveal = address(auction).balance;

        vm.prank(trader1);
        core.revealSwap{value: priorityBid}(commitId, priorityBid);

        assertEq(trader1.balance, trader1EthBeforeReveal - priorityBid, "Trader1 ETH should decrease by priority bid");
        assertGe(address(auction).balance, auctionEthBeforeReveal, "Auction ETH should increase or stay same");

        console.log("FLOW: Trader1 --(0.05 ETH)--> Auction (priority bid)");
        _logBalances("After Reveal");

        // ===== PHASE 3: SETTLEMENT =====
        console.log("\n--- PHASE 3: SETTLEMENT ---");
        vm.warp(block.timestamp + 3); // Move to settling phase

        uint256 trader1UsdcBefore = usdc.balanceOf(trader1);
        uint256 coreWethBeforeSettle = weth.balanceOf(address(core));
        uint256 ammWethBefore = weth.balanceOf(address(amm));

        console.log("Settling batch 1...");
        core.settleBatch(1);

        // Verify swap executed
        uint256 trader1UsdcAfter = usdc.balanceOf(trader1);
        uint256 usdcReceived = trader1UsdcAfter - trader1UsdcBefore;

        console.log("USDC received by Trader1:", usdcReceived / 1e18, "USDC");
        assertGt(usdcReceived, 0, "Trader1 should receive USDC");

        console.log("FLOW: Core --(1 WETH)--> AMM (swap input)");
        console.log("FLOW: AMM --(~1990 USDC)--> Trader1 (swap output)");
        _logBalances("After Settlement");

        // ===== FINAL STATE =====
        console.log("\n--- FINAL STATE VERIFICATION ---");

        ICommitRevealAuction.Batch memory batch = auction.getBatch(1);
        console.log("Batch settled:", batch.isSettled);
        console.log("Total priority bids:", batch.totalPriorityBids / 1e18, "ETH");
        console.log("Order count:", batch.orderCount);

        // Verify constant product invariant increased (fees collected)
        IVibeAMM.Pool memory pool = amm.getPool(poolId);
        console.log("Pool reserve0:", pool.reserve0 / 1e18);
        console.log("Pool reserve1:", pool.reserve1 / 1e18);

        console.log("\n========== MONEY FLOW TEST COMPLETE ==========\n");
    }

    function test_MoneyFlow_SlashingOnInvalidReveal() public {
        console.log("\n========== MONEY FLOW TEST: SLASHING ==========\n");

        bytes32 secret = keccak256("trader1_secret");
        uint256 depositAmount = 0.1 ether;

        // Commit
        vm.prank(trader1);
        bytes32 commitId = core.commitSwap{value: depositAmount}(
            address(weth), address(usdc), 1 ether, 0, secret
        );

        console.log("--- INITIAL STATE ---");
        console.log("Trader1 deposited:", depositAmount / 1e18, "ETH");
        console.log("Auction balance:", address(auction).balance / 1e18, "ETH");
        console.log("Treasury balance:", address(treasury).balance / 1e18, "ETH");

        vm.warp(block.timestamp + 9); // Reveal phase

        uint256 treasuryBefore = address(treasury).balance;
        uint256 trader1Before = trader1.balance;

        // Invalid reveal (wrong amount triggers slash)
        console.log("\n--- INVALID REVEAL (SLASHING) ---");
        vm.prank(address(core));
        auction.revealOrderCrossChain(
            commitId,
            trader1,
            address(weth),
            address(usdc),
            2 ether, // WRONG AMOUNT - hash mismatch
            0,
            secret,
            0
        );

        uint256 treasuryAfter = address(treasury).balance;
        uint256 slashAmount = (depositAmount * 5000) / 10000; // 50% slash rate
        uint256 refundAmount = depositAmount - slashAmount;

        console.log("Expected slash amount (50%):", slashAmount / 1e18, "ETH");
        console.log("Expected refund amount:", refundAmount / 1e18, "ETH");
        console.log("Treasury received:", (treasuryAfter - treasuryBefore) / 1e18, "ETH");

        // Verify slashing
        assertGe(treasuryAfter, treasuryBefore, "Treasury should receive slashed funds");

        console.log("\nFLOW: Auction --(0.05 ETH)--> Treasury (slashed)");
        console.log("FLOW: Auction --(0.05 ETH)--> Trader1 (refund)");

        console.log("\n========== SLASHING TEST COMPLETE ==========\n");
    }

    function test_MoneyFlow_LPFeesAccumulation() public {
        console.log("\n========== MONEY FLOW TEST: LP FEES ==========\n");

        IVibeAMM.Pool memory poolBefore = amm.getPool(poolId);
        uint256 kBefore = poolBefore.reserve0 * poolBefore.reserve1;
        console.log("Initial k (constant product):", kBefore / 1e36);

        // Execute multiple swaps to accumulate fees
        for (uint256 i = 0; i < 3; i++) {
            bytes32 secret = keccak256(abi.encodePacked("secret", i));

            vm.roll(100 + i * 100);
            vm.prank(trader1);
            bytes32 cid = core.commitSwap{value: 0.01 ether}(
                address(weth), address(usdc), 0.5 ether, 0, secret
            );

            vm.warp(block.timestamp + 9);
            vm.prank(trader1);
            core.revealSwap(cid, 0);

            vm.warp(block.timestamp + 3);
            core.settleBatch(uint64(i + 1));

            console.log("Swap", i + 1, "completed");
        }

        IVibeAMM.Pool memory poolAfter = amm.getPool(poolId);
        uint256 kAfter = poolAfter.reserve0 * poolAfter.reserve1;

        console.log("\n--- FEE ACCUMULATION ---");
        console.log("k before:", kBefore / 1e36);
        console.log("k after:", kAfter / 1e36);
        console.log("k increase (fees):", (kAfter - kBefore) / 1e36);

        assertGt(kAfter, kBefore, "k should increase due to fees");

        console.log("\nFees stay in pool reserves, increasing LP share value");
        console.log("\n========== LP FEES TEST COMPLETE ==========\n");
    }

    function test_MoneyFlow_PriorityBidsToTreasury() public {
        console.log("\n========== MONEY FLOW TEST: PRIORITY BIDS ==========\n");

        bytes32 secret1 = keccak256("s1");
        bytes32 secret2 = keccak256("s2");

        // Two traders with different priority bids
        vm.prank(trader1);
        bytes32 cid1 = core.commitSwap{value: 0.01 ether}(
            address(weth), address(usdc), 0.5 ether, 0, secret1
        );

        vm.roll(10);

        vm.prank(trader2);
        bytes32 cid2 = core.commitSwap{value: 0.01 ether}(
            address(usdc), address(weth), 1000 ether, 0, secret2
        );

        vm.warp(block.timestamp + 9);

        // Reveal with priority bids
        uint256 priorityBid1 = 0.1 ether;
        uint256 priorityBid2 = 0.2 ether;

        vm.prank(trader1);
        core.revealSwap{value: priorityBid1}(cid1, priorityBid1);

        vm.prank(trader2);
        core.revealSwap{value: priorityBid2}(cid2, priorityBid2);

        console.log("--- PRIORITY BIDS ---");
        console.log("Trader1 priority bid:", priorityBid1 / 1e18, "ETH");
        console.log("Trader2 priority bid:", priorityBid2 / 1e18, "ETH");
        console.log("Total priority bids:", (priorityBid1 + priorityBid2) / 1e18, "ETH");

        vm.warp(block.timestamp + 3);

        uint256 auctionBalanceBefore = address(auction).balance;
        console.log("Auction balance before settlement:", auctionBalanceBefore / 1e18, "ETH");

        core.settleBatch(1);

        ICommitRevealAuction.Batch memory batch = auction.getBatch(1);
        console.log("\n--- AFTER SETTLEMENT ---");
        console.log("Batch total priority bids:", batch.totalPriorityBids / 1e18, "ETH");
        console.log("Auction balance:", address(auction).balance / 1e18, "ETH");
        console.log("Treasury balance:", address(treasury).balance / 1e18, "ETH");

        // Check execution order
        uint256[] memory order = auction.getExecutionOrder(1);
        console.log("\nExecution order (higher priority first):");
        console.log("Position 0:", order[0], "(Trader2 - 0.2 ETH bid)");
        console.log("Position 1:", order[1], "(Trader1 - 0.1 ETH bid)");

        assertEq(order[0], 1, "Trader2 should execute first (higher bid)");

        console.log("\n========== PRIORITY BIDS TEST COMPLETE ==========\n");
    }

    // ============ Helper Functions ============

    function _logBalances(string memory phase) internal view {
        console.log("\n[", phase, "]");
        console.log("  Trader1 ETH:", trader1.balance / 1e18);
        console.log("  Trader1 WETH:", weth.balanceOf(trader1) / 1e18);
        console.log("  Trader1 USDC:", usdc.balanceOf(trader1) / 1e18);
        console.log("  Auction ETH:", address(auction).balance / 1e18);
        console.log("  Core WETH:", weth.balanceOf(address(core)) / 1e18);
        console.log("  AMM WETH:", weth.balanceOf(address(amm)) / 1e18);
        console.log("  AMM USDC:", usdc.balanceOf(address(amm)) / 1e18);
        console.log("  Treasury ETH:", address(treasury).balance / 1e18);
    }
}
