// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../../contracts/core/VibeSwapCore.sol";
import "../../contracts/core/interfaces/ICommitRevealAuction.sol";
import "../../contracts/core/interfaces/IVibeAMM.sol";
import "../../contracts/core/interfaces/IDAOTreasury.sol";
import "../../contracts/libraries/SecurityLib.sol";

// ============ Mock Tokens ============

contract MockCCERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Mock Auction ============

contract MockCCAuction {
    uint64 public currentBatchId = 1;
    ICommitRevealAuction.BatchPhase public currentPhase = ICommitRevealAuction.BatchPhase.COMMIT;
    uint256 public commitCount;

    function commitOrder(bytes32) external payable returns (bytes32) {
        commitCount++;
        return keccak256(abi.encodePacked("commit", commitCount));
    }

    function revealOrderCrossChain(
        bytes32, address, address, address, uint256, uint256, bytes32, uint256
    ) external payable {}

    function advancePhase() external {}
    function settleBatch() external {}
    function getCurrentBatchId() external view returns (uint64) { return currentBatchId; }
    function getCurrentPhase() external view returns (ICommitRevealAuction.BatchPhase) { return currentPhase; }
    function getTimeUntilPhaseChange() external pure returns (uint256) { return 5; }

    function getRevealedOrders(uint64) external pure returns (ICommitRevealAuction.RevealedOrder[] memory) {
        return new ICommitRevealAuction.RevealedOrder[](0);
    }

    function getExecutionOrder(uint64) external pure returns (uint256[] memory) {
        return new uint256[](0);
    }

    function getBatch(uint64) external pure returns (ICommitRevealAuction.Batch memory batch) {
        return batch;
    }
}

// ============ Mock AMM ============

contract MockCCAMM {
    function getPoolId(address tokenA, address tokenB) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(tokenA, tokenB));
    }

    function getPool(bytes32) external pure returns (IVibeAMM.Pool memory pool) {
        pool.token0 = address(1);
        pool.token1 = address(2);
        pool.reserve0 = 1000e18;
        pool.reserve1 = 1000e18;
        pool.feeRate = 30;
        pool.initialized = true;
    }
}

// ============ Mock Treasury ============

contract MockCCTreasury {
    function receiveAuctionProceeds(uint64) external payable {}
    receive() external payable {}
}

// ============ Mock Router ============

contract MockCCRouter {
    bytes32 public lastCommitHash;
    uint32 public lastDstChainId;

    function sendCommit(uint32 dstChainId, bytes32 commitHash, uint256, bytes calldata, address) external payable {
        lastCommitHash = commitHash;
        lastDstChainId = dstChainId;
    }

    receive() external payable {}
}

// ============ Test Contract ============

/**
 * @title CrossChainTimeoutTest
 * @notice Security tests for cross-chain order timeout and refund mechanism
 * @dev Validates the CrossChainOrder lifecycle: creation, expiry refund, and settlement
 *
 * DISINTERMEDIATION: These tests verify Grade A (DISSOLVED) behavior —
 * refundExpiredCrossChain is permissionless after the 2-hour timeout.
 */
contract CrossChainTimeoutTest is Test {
    VibeSwapCore public core;
    MockCCAuction public auction;
    MockCCAMM public amm;
    MockCCTreasury public treasury;
    MockCCRouter public router;
    MockCCERC20 public tokenA;
    MockCCERC20 public tokenB;

    address public owner;
    address public trader;
    address public anyoneElse;

    uint32 constant DST_CHAIN_ID = 30101; // Example LayerZero endpoint ID
    uint256 constant SWAP_AMOUNT = 1000e18;
    uint256 constant MIN_AMOUNT_OUT = 900e18;
    bytes32 constant SECRET = keccak256("test_secret");
    bytes constant LZ_OPTIONS = hex"0003010011010000000000000000000000000000ea60";

    // Events for assertion
    event CrossChainOrderCreated(
        bytes32 indexed commitHash,
        address indexed trader,
        uint32 destinationChain,
        address tokenIn,
        uint256 depositAmount
    );
    event CrossChainOrderRefunded(
        bytes32 indexed commitHash,
        address indexed trader,
        address tokenIn,
        uint256 depositAmount
    );
    event CrossChainOrderSettled(bytes32 indexed commitHash);

    function setUp() public {
        owner = makeAddr("owner");
        trader = makeAddr("trader");
        anyoneElse = makeAddr("anyoneElse");

        auction = new MockCCAuction();
        amm = new MockCCAMM();
        treasury = new MockCCTreasury();
        router = new MockCCRouter();

        tokenA = new MockCCERC20("Token A", "TKA");
        tokenB = new MockCCERC20("Token B", "TKB");

        // Deploy VibeSwapCore behind UUPS proxy
        VibeSwapCore impl = new VibeSwapCore();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(
                VibeSwapCore.initialize.selector,
                owner,
                address(auction),
                address(amm),
                address(treasury),
                address(router)
            )
        );
        core = VibeSwapCore(payable(address(proxy)));

        // Setup: support tokens, disable cooldown and EOA check for testing
        vm.startPrank(owner);
        core.setSupportedToken(address(tokenA), true);
        core.setSupportedToken(address(tokenB), true);
        core.setCommitCooldown(0);
        core.setRequireEOA(false);
        vm.stopPrank();

        // Mint tokens to trader and approve
        tokenA.mint(trader, 10_000_000e18);
        tokenB.mint(trader, 10_000_000e18);

        vm.prank(trader);
        tokenA.approve(address(core), type(uint256).max);
        vm.prank(trader);
        tokenB.approve(address(core), type(uint256).max);

        vm.warp(100); // Avoid timestamp-zero edge cases
    }

    // ============ Helpers ============

    /// @dev Compute the same commitHash that VibeSwapCore generates internally
    function _computeCommitHash(
        address _trader,
        address _tokenIn,
        address _tokenOut,
        uint256 _amountIn,
        uint256 _minAmountOut,
        bytes32 _secret
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(
            _trader,
            _tokenIn,
            _tokenOut,
            _amountIn,
            _minAmountOut,
            _secret
        ));
    }

    /// @dev Submit a cross-chain order as `trader` and return the commitHash
    function _commitCrossChain() internal returns (bytes32 commitHash) {
        commitHash = _computeCommitHash(
            trader, address(tokenA), address(tokenB),
            SWAP_AMOUNT, MIN_AMOUNT_OUT, SECRET
        );

        vm.prank(trader);
        core.commitCrossChainSwap(
            DST_CHAIN_ID,
            address(tokenA),
            address(tokenB),
            SWAP_AMOUNT,
            MIN_AMOUNT_OUT,
            SECRET,
            LZ_OPTIONS,
            address(0)
        );
    }

    // ============ Test 1: Cross-chain orders are properly tracked ============

    function test_crossChainOrderTrackedOnCommit() public {
        bytes32 commitHash = _commitCrossChain();

        // Verify the order is stored in the mapping
        (
            uint256 commitTimestamp,
            uint32 destinationChain,
            bytes32 storedCommitHash,
            uint256 depositAmount,
            address tokenIn,
            address storedTrader,
            bool settled
        ) = core.crossChainOrders(commitHash);

        assertEq(commitTimestamp, block.timestamp, "commitTimestamp mismatch");
        assertEq(destinationChain, DST_CHAIN_ID, "destinationChain mismatch");
        assertEq(storedCommitHash, commitHash, "commitHash mismatch");
        assertEq(depositAmount, SWAP_AMOUNT, "depositAmount mismatch");
        assertEq(tokenIn, address(tokenA), "tokenIn mismatch");
        assertEq(storedTrader, trader, "trader mismatch");
        assertFalse(settled, "should not be settled");
    }

    function test_crossChainOrderEmitsEvent() public {
        bytes32 commitHash = _computeCommitHash(
            trader, address(tokenA), address(tokenB),
            SWAP_AMOUNT, MIN_AMOUNT_OUT, SECRET
        );

        vm.expectEmit(true, true, false, true);
        emit CrossChainOrderCreated(commitHash, trader, DST_CHAIN_ID, address(tokenA), SWAP_AMOUNT);

        vm.prank(trader);
        core.commitCrossChainSwap(
            DST_CHAIN_ID,
            address(tokenA),
            address(tokenB),
            SWAP_AMOUNT,
            MIN_AMOUNT_OUT,
            SECRET,
            LZ_OPTIONS,
            address(0)
        );
    }

    function test_crossChainOrderDepositsTokens() public {
        uint256 traderBalanceBefore = tokenA.balanceOf(trader);
        uint256 coreBalanceBefore = tokenA.balanceOf(address(core));

        _commitCrossChain();

        assertEq(tokenA.balanceOf(trader), traderBalanceBefore - SWAP_AMOUNT, "trader balance not decreased");
        assertEq(tokenA.balanceOf(address(core)), coreBalanceBefore + SWAP_AMOUNT, "core balance not increased");
    }

    function test_crossChainOrderForwardsToRouter() public {
        bytes32 commitHash = _commitCrossChain();

        assertEq(router.lastCommitHash(), commitHash, "router did not receive commitHash");
        assertEq(router.lastDstChainId(), DST_CHAIN_ID, "router did not receive dstChainId");
    }

    // ============ Test 2: Refund reverts before 2-hour timeout ============

    function test_refundRevertsBeforeTimeout() public {
        bytes32 commitHash = _commitCrossChain();

        // Immediately after commit — should revert
        vm.expectRevert(VibeSwapCore.CrossChainOrderNotExpired.selector);
        core.refundExpiredCrossChain(commitHash);
    }

    function test_refundRevertsAt1HourBeforeTimeout() public {
        bytes32 commitHash = _commitCrossChain();

        // Warp 1 hour — still within the 2-hour window
        vm.warp(block.timestamp + 1 hours);

        vm.expectRevert(VibeSwapCore.CrossChainOrderNotExpired.selector);
        core.refundExpiredCrossChain(commitHash);
    }

    function test_refundRevertsAtExactly2Hours() public {
        bytes32 commitHash = _commitCrossChain();

        // Warp exactly to the 2-hour mark (uses <=, so this should still revert)
        vm.warp(block.timestamp + 2 hours);

        vm.expectRevert(VibeSwapCore.CrossChainOrderNotExpired.selector);
        core.refundExpiredCrossChain(commitHash);
    }

    // ============ Test 3: Refund succeeds after 2 hours ============

    function test_refundSucceedsAfterTimeout() public {
        bytes32 commitHash = _commitCrossChain();

        uint256 traderBalanceBefore = tokenA.balanceOf(trader);

        // Warp past the 2-hour window
        vm.warp(block.timestamp + 2 hours + 1);

        core.refundExpiredCrossChain(commitHash);

        // Trader gets deposit back
        assertEq(tokenA.balanceOf(trader), traderBalanceBefore + SWAP_AMOUNT, "trader not refunded");
    }

    function test_refundEmitsEvent() public {
        bytes32 commitHash = _commitCrossChain();

        vm.warp(block.timestamp + 2 hours + 1);

        vm.expectEmit(true, true, false, true);
        emit CrossChainOrderRefunded(commitHash, trader, address(tokenA), SWAP_AMOUNT);

        core.refundExpiredCrossChain(commitHash);
    }

    function test_refundMarksOrderAsSettled() public {
        bytes32 commitHash = _commitCrossChain();

        vm.warp(block.timestamp + 2 hours + 1);
        core.refundExpiredCrossChain(commitHash);

        (,,,,, , bool settled) = core.crossChainOrders(commitHash);
        assertTrue(settled, "order should be settled after refund");
    }

    function test_refundCanBeCalledByAnyone() public {
        bytes32 commitHash = _commitCrossChain();

        uint256 traderBalanceBefore = tokenA.balanceOf(trader);

        vm.warp(block.timestamp + 2 hours + 1);

        // Anyone can trigger the refund (Grade A — permissionless)
        vm.prank(anyoneElse);
        core.refundExpiredCrossChain(commitHash);

        // But funds go to the original trader, not the caller
        assertEq(tokenA.balanceOf(trader), traderBalanceBefore + SWAP_AMOUNT, "funds should go to trader");
        assertEq(tokenA.balanceOf(anyoneElse), 0, "caller should not receive funds");
    }

    function test_refundReducesDepositsMapping() public {
        bytes32 commitHash = _commitCrossChain();

        uint256 depositBefore = core.deposits(trader, address(tokenA));
        assertEq(depositBefore, SWAP_AMOUNT, "deposit not tracked");

        vm.warp(block.timestamp + 2 hours + 1);
        core.refundExpiredCrossChain(commitHash);

        uint256 depositAfter = core.deposits(trader, address(tokenA));
        assertEq(depositAfter, 0, "deposit not cleared after refund");
    }

    // ============ Test 4: Refund reverts for already-settled orders ============

    function test_refundRevertsAfterAlreadyRefunded() public {
        bytes32 commitHash = _commitCrossChain();

        vm.warp(block.timestamp + 2 hours + 1);
        core.refundExpiredCrossChain(commitHash);

        // Second refund attempt should revert
        vm.expectRevert(VibeSwapCore.CrossChainOrderAlreadySettled.selector);
        core.refundExpiredCrossChain(commitHash);
    }

    function test_refundRevertsAfterMarkedSettled() public {
        bytes32 commitHash = _commitCrossChain();

        // Owner marks as settled (simulating successful cross-chain delivery)
        vm.prank(owner);
        core.markCrossChainSettled(commitHash);

        // Now even after timeout, refund should revert
        vm.warp(block.timestamp + 2 hours + 1);

        vm.expectRevert(VibeSwapCore.CrossChainOrderAlreadySettled.selector);
        core.refundExpiredCrossChain(commitHash);
    }

    // ============ Test 5: markCrossChainSettled proper behavior ============

    function test_markSettledByOwner() public {
        bytes32 commitHash = _commitCrossChain();

        vm.prank(owner);
        core.markCrossChainSettled(commitHash);

        (,,,,, , bool settled) = core.crossChainOrders(commitHash);
        assertTrue(settled, "order should be settled");
    }

    function test_markSettledByRouter() public {
        bytes32 commitHash = _commitCrossChain();

        vm.prank(address(router));
        core.markCrossChainSettled(commitHash);

        (,,,,, , bool settled) = core.crossChainOrders(commitHash);
        assertTrue(settled, "order should be settled");
    }

    function test_markSettledEmitsEvent() public {
        bytes32 commitHash = _commitCrossChain();

        vm.expectEmit(true, false, false, true);
        emit CrossChainOrderSettled(commitHash);

        vm.prank(owner);
        core.markCrossChainSettled(commitHash);
    }

    function test_markSettledRevertsForUnauthorized() public {
        bytes32 commitHash = _commitCrossChain();

        vm.prank(anyoneElse);
        vm.expectRevert("Only owner or router");
        core.markCrossChainSettled(commitHash);
    }

    function test_markSettledRevertsForTrader() public {
        bytes32 commitHash = _commitCrossChain();

        vm.prank(trader);
        vm.expectRevert("Only owner or router");
        core.markCrossChainSettled(commitHash);
    }

    function test_markSettledPreventsDoubleSettling() public {
        bytes32 commitHash = _commitCrossChain();

        vm.prank(owner);
        core.markCrossChainSettled(commitHash);

        // Second settle should revert
        vm.prank(owner);
        vm.expectRevert(VibeSwapCore.CrossChainOrderAlreadySettled.selector);
        core.markCrossChainSettled(commitHash);
    }

    // ============ Test 6: markCrossChainSettled reverts for non-existent orders ============

    function test_markSettledRevertsForNonExistentOrder() public {
        bytes32 fakeHash = keccak256("does_not_exist");

        vm.prank(owner);
        vm.expectRevert(VibeSwapCore.CrossChainOrderNotFound.selector);
        core.markCrossChainSettled(fakeHash);
    }

    function test_refundRevertsForNonExistentOrder() public {
        bytes32 fakeHash = keccak256("does_not_exist");

        vm.warp(block.timestamp + 3 hours);
        vm.expectRevert(VibeSwapCore.CrossChainOrderNotFound.selector);
        core.refundExpiredCrossChain(fakeHash);
    }

    // ============ Edge Cases ============

    function test_settledOrderCannotBeRefundedEvenLater() public {
        bytes32 commitHash = _commitCrossChain();

        // Settle immediately
        vm.prank(owner);
        core.markCrossChainSettled(commitHash);

        // Warp far past timeout
        vm.warp(block.timestamp + 24 hours);

        vm.expectRevert(VibeSwapCore.CrossChainOrderAlreadySettled.selector);
        core.refundExpiredCrossChain(commitHash);
    }

    function test_refundedOrderCannotBeSettled() public {
        bytes32 commitHash = _commitCrossChain();

        vm.warp(block.timestamp + 2 hours + 1);
        core.refundExpiredCrossChain(commitHash);

        // Try to settle after refund — should revert (already settled via refund)
        vm.prank(owner);
        vm.expectRevert(VibeSwapCore.CrossChainOrderAlreadySettled.selector);
        core.markCrossChainSettled(commitHash);
    }
}
