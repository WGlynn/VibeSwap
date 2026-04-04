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

    function sendCommit(uint32 dstEid, bytes32 commitHash, uint256, bytes calldata, address, address) external payable {
        lastCommitHash = commitHash;
        lastDstChainId = dstEid;
    }

    receive() external payable {}
}

// ============ Test Contract ============

/**
 * @title CrossChainTimeoutTest
 * @notice Security tests for XC-003 two-phase cross-chain refund mechanism
 * @dev Validates the CrossChainOrder state machine:
 *      PENDING → REFUND_REQUESTED → REFUNDED (normal refund path)
 *      PENDING → SETTLED (settlement arrived before timeout)
 *      REFUND_REQUESTED → SETTLED (settlement arrived during challenge window)
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

    uint32 constant DST_CHAIN_ID = 30101;
    uint256 constant SWAP_AMOUNT = 1000e18;
    uint256 constant MIN_AMOUNT_OUT = 900e18;
    bytes32 constant SECRET = keccak256("test_secret");
    bytes constant LZ_OPTIONS = hex"0003010011010000000000000000000000000000ea60";

    event CrossChainOrderCreated(
        bytes32 indexed commitHash, address indexed trader,
        uint32 destinationChain, address tokenIn, uint256 depositAmount
    );
    event CrossChainOrderRefunded(
        bytes32 indexed commitHash, address indexed trader,
        address tokenIn, uint256 depositAmount
    );
    event CrossChainOrderSettled(bytes32 indexed commitHash);
    event CrossChainRefundRequested(bytes32 indexed commitHash, address indexed trader);
    event CrossChainDepositReleased(
        bytes32 indexed commitHash, address indexed trader,
        address tokenIn, uint256 amount
    );

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

        VibeSwapCore impl = new VibeSwapCore();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(
                VibeSwapCore.initialize.selector,
                owner, address(auction), address(amm),
                address(treasury), address(router)
            )
        );
        core = VibeSwapCore(payable(address(proxy)));

        vm.startPrank(owner);
        core.setSupportedToken(address(tokenA), true);
        core.setSupportedToken(address(tokenB), true);
        core.setCommitCooldown(0);
        core.setRequireEOA(false);
        vm.stopPrank();

        tokenA.mint(trader, 10_000_000e18);
        tokenB.mint(trader, 10_000_000e18);
        vm.prank(trader);
        tokenA.approve(address(core), type(uint256).max);
        vm.prank(trader);
        tokenB.approve(address(core), type(uint256).max);

        vm.warp(100);
    }

    // ============ Helpers ============

    function _computeCommitHash(
        address _trader, address _tokenIn, address _tokenOut,
        uint256 _amountIn, uint256 _minAmountOut, bytes32 _secret
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(_trader, _tokenIn, _tokenOut, _amountIn, _minAmountOut, _secret));
    }

    function _commitCrossChain() internal returns (bytes32 commitHash) {
        commitHash = _computeCommitHash(trader, address(tokenA), address(tokenB), SWAP_AMOUNT, MIN_AMOUNT_OUT, SECRET);
        vm.prank(trader);
        core.commitCrossChainSwap(
            DST_CHAIN_ID, address(tokenA), address(tokenB),
            SWAP_AMOUNT, MIN_AMOUNT_OUT, SECRET, LZ_OPTIONS, address(0)
        );
    }

    function _getOrderStatus(bytes32 commitHash) internal view returns (VibeSwapCore.CrossChainStatus) {
        (,,,,,, VibeSwapCore.CrossChainStatus status,) = core.crossChainOrders(commitHash);
        return status;
    }

    // ============ Order Creation ============

    function test_crossChainOrderTrackedOnCommit() public {
        bytes32 commitHash = _commitCrossChain();
        (
            uint256 commitTimestamp, uint32 destinationChain, bytes32 storedHash,
            uint256 depositAmount, address tokenIn, address storedTrader,
            VibeSwapCore.CrossChainStatus status, uint256 refundRequestTime
        ) = core.crossChainOrders(commitHash);

        assertEq(commitTimestamp, block.timestamp);
        assertEq(destinationChain, DST_CHAIN_ID);
        assertEq(storedHash, commitHash);
        assertEq(depositAmount, SWAP_AMOUNT);
        assertEq(tokenIn, address(tokenA));
        assertEq(storedTrader, trader);
        assertTrue(status == VibeSwapCore.CrossChainStatus.PENDING);
        assertEq(refundRequestTime, 0);
    }

    function test_crossChainOrderEmitsEvent() public {
        bytes32 commitHash = _computeCommitHash(trader, address(tokenA), address(tokenB), SWAP_AMOUNT, MIN_AMOUNT_OUT, SECRET);
        vm.expectEmit(true, true, false, true);
        emit CrossChainOrderCreated(commitHash, trader, DST_CHAIN_ID, address(tokenA), SWAP_AMOUNT);
        vm.prank(trader);
        core.commitCrossChainSwap(DST_CHAIN_ID, address(tokenA), address(tokenB), SWAP_AMOUNT, MIN_AMOUNT_OUT, SECRET, LZ_OPTIONS, address(0));
    }

    // ============ Phase 1: Request Refund ============

    function test_requestRefundRevertsBeforeTimeout() public {
        bytes32 commitHash = _commitCrossChain();
        vm.expectRevert(VibeSwapCore.CrossChainOrderNotExpired.selector);
        core.requestCrossChainRefund(commitHash);
    }

    function test_requestRefundRevertsAtExactly2Hours() public {
        bytes32 commitHash = _commitCrossChain();
        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert(VibeSwapCore.CrossChainOrderNotExpired.selector);
        core.requestCrossChainRefund(commitHash);
    }

    function test_requestRefundSucceedsAfterTimeout() public {
        bytes32 commitHash = _commitCrossChain();
        vm.warp(block.timestamp + 2 hours + 1);
        core.requestCrossChainRefund(commitHash);
        assertTrue(_getOrderStatus(commitHash) == VibeSwapCore.CrossChainStatus.REFUND_REQUESTED);
    }

    function test_requestRefundEmitsEvent() public {
        bytes32 commitHash = _commitCrossChain();
        vm.warp(block.timestamp + 2 hours + 1);
        vm.expectEmit(true, true, false, true);
        emit CrossChainRefundRequested(commitHash, trader);
        core.requestCrossChainRefund(commitHash);
    }

    function test_requestRefundSetsRefundRequestTime() public {
        bytes32 commitHash = _commitCrossChain();
        vm.warp(block.timestamp + 2 hours + 1);
        core.requestCrossChainRefund(commitHash);
        (,,,,,,, uint256 refundRequestTime) = core.crossChainOrders(commitHash);
        assertEq(refundRequestTime, block.timestamp);
    }

    function test_requestRefundIsPermissionless() public {
        bytes32 commitHash = _commitCrossChain();
        vm.warp(block.timestamp + 2 hours + 1);
        vm.prank(anyoneElse);
        core.requestCrossChainRefund(commitHash);
        assertTrue(_getOrderStatus(commitHash) == VibeSwapCore.CrossChainStatus.REFUND_REQUESTED);
    }

    function test_requestRefundRevertsIfAlreadyRequested() public {
        bytes32 commitHash = _commitCrossChain();
        vm.warp(block.timestamp + 2 hours + 1);
        core.requestCrossChainRefund(commitHash);
        vm.expectRevert(VibeSwapCore.CrossChainOrderNotPending.selector);
        core.requestCrossChainRefund(commitHash);
    }

    function test_requestRefundRevertsIfSettled() public {
        bytes32 commitHash = _commitCrossChain();
        vm.prank(owner);
        core.markCrossChainSettled(commitHash);
        vm.warp(block.timestamp + 2 hours + 1);
        vm.expectRevert(VibeSwapCore.CrossChainOrderNotPending.selector);
        core.requestCrossChainRefund(commitHash);
    }

    // ============ Phase 2: Execute Refund ============

    function test_executeRefundRevertsDuringChallengeWindow() public {
        bytes32 commitHash = _commitCrossChain();
        vm.warp(block.timestamp + 2 hours + 1);
        core.requestCrossChainRefund(commitHash);

        // Immediately after request — challenge window still active
        vm.expectRevert(VibeSwapCore.CrossChainChallengeWindowActive.selector);
        core.executeCrossChainRefund(commitHash);
    }

    function test_executeRefundRevertsAtExactlyChallengeEnd() public {
        bytes32 commitHash = _commitCrossChain();
        vm.warp(block.timestamp + 2 hours + 1);
        core.requestCrossChainRefund(commitHash);

        vm.warp(block.timestamp + 1 hours); // Exactly at challenge end (uses <=)
        vm.expectRevert(VibeSwapCore.CrossChainChallengeWindowActive.selector);
        core.executeCrossChainRefund(commitHash);
    }

    function test_executeRefundSucceedsAfterChallengeWindow() public {
        bytes32 commitHash = _commitCrossChain();
        uint256 traderBalanceBefore = tokenA.balanceOf(trader);

        vm.warp(block.timestamp + 2 hours + 1);
        core.requestCrossChainRefund(commitHash);

        vm.warp(block.timestamp + 1 hours + 1);
        core.executeCrossChainRefund(commitHash);

        assertEq(tokenA.balanceOf(trader), traderBalanceBefore + SWAP_AMOUNT);
        assertTrue(_getOrderStatus(commitHash) == VibeSwapCore.CrossChainStatus.REFUNDED);
    }

    function test_executeRefundEmitsEvent() public {
        bytes32 commitHash = _commitCrossChain();
        vm.warp(block.timestamp + 2 hours + 1);
        core.requestCrossChainRefund(commitHash);
        vm.warp(block.timestamp + 1 hours + 1);

        vm.expectEmit(true, true, false, true);
        emit CrossChainOrderRefunded(commitHash, trader, address(tokenA), SWAP_AMOUNT);
        core.executeCrossChainRefund(commitHash);
    }

    function test_executeRefundIsPermissionless() public {
        bytes32 commitHash = _commitCrossChain();
        uint256 traderBalanceBefore = tokenA.balanceOf(trader);
        vm.warp(block.timestamp + 2 hours + 1);
        core.requestCrossChainRefund(commitHash);
        vm.warp(block.timestamp + 1 hours + 1);

        vm.prank(anyoneElse);
        core.executeCrossChainRefund(commitHash);

        // Funds go to trader, not caller
        assertEq(tokenA.balanceOf(trader), traderBalanceBefore + SWAP_AMOUNT);
        assertEq(tokenA.balanceOf(anyoneElse), 0);
    }

    function test_executeRefundRevertsWithoutRequest() public {
        bytes32 commitHash = _commitCrossChain();
        vm.warp(block.timestamp + 24 hours);
        vm.expectRevert(VibeSwapCore.CrossChainOrderNotRequested.selector);
        core.executeCrossChainRefund(commitHash);
    }

    // ============ XC-003: Challenge Window Override ============
    // The critical test: settlement confirmation arriving during challenge window cancels the refund

    function test_settlementCancelsRefundDuringChallengeWindow() public {
        bytes32 commitHash = _commitCrossChain();

        // Phase 1: Request refund after timeout
        vm.warp(block.timestamp + 2 hours + 1);
        core.requestCrossChainRefund(commitHash);
        assertTrue(_getOrderStatus(commitHash) == VibeSwapCore.CrossChainStatus.REFUND_REQUESTED);

        // Settlement confirmation arrives during challenge window
        vm.prank(owner);
        core.markCrossChainSettled(commitHash);
        assertTrue(_getOrderStatus(commitHash) == VibeSwapCore.CrossChainStatus.SETTLED);

        // Phase 2: Execute refund should now revert
        vm.warp(block.timestamp + 1 hours + 1);
        vm.expectRevert(VibeSwapCore.CrossChainOrderNotRequested.selector);
        core.executeCrossChainRefund(commitHash);
    }

    function test_settlementByRouterCancelsRefundDuringChallengeWindow() public {
        bytes32 commitHash = _commitCrossChain();

        vm.warp(block.timestamp + 2 hours + 1);
        core.requestCrossChainRefund(commitHash);

        // Router marks settlement (simulating LayerZero callback)
        vm.prank(address(router));
        core.markCrossChainSettled(commitHash);
        assertTrue(_getOrderStatus(commitHash) == VibeSwapCore.CrossChainStatus.SETTLED);
    }

    function test_doubleSpendPreventedByTwoPhase() public {
        bytes32 commitHash = _commitCrossChain();
        uint256 traderBalanceBefore = tokenA.balanceOf(trader);

        // Refund requested after timeout
        vm.warp(block.timestamp + 2 hours + 1);
        core.requestCrossChainRefund(commitHash);

        // Settlement arrives before challenge window expires
        vm.prank(owner);
        core.markCrossChainSettled(commitHash);

        // Challenge window expires — but order is SETTLED, not REFUND_REQUESTED
        vm.warp(block.timestamp + 1 hours + 1);

        // Execute refund reverts — double-spend prevented
        vm.expectRevert(VibeSwapCore.CrossChainOrderNotRequested.selector);
        core.executeCrossChainRefund(commitHash);

        // Trader does NOT get deposit back
        assertEq(tokenA.balanceOf(trader), traderBalanceBefore);
    }

    // ============ Settlement ============

    function test_markSettledByOwner() public {
        bytes32 commitHash = _commitCrossChain();
        vm.prank(owner);
        core.markCrossChainSettled(commitHash);
        assertTrue(_getOrderStatus(commitHash) == VibeSwapCore.CrossChainStatus.SETTLED);
    }

    function test_markSettledByRouter() public {
        bytes32 commitHash = _commitCrossChain();
        vm.prank(address(router));
        core.markCrossChainSettled(commitHash);
        assertTrue(_getOrderStatus(commitHash) == VibeSwapCore.CrossChainStatus.SETTLED);
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

    function test_markSettledPreventsDoubleSettling() public {
        bytes32 commitHash = _commitCrossChain();
        vm.prank(owner);
        core.markCrossChainSettled(commitHash);
        vm.prank(owner);
        vm.expectRevert(VibeSwapCore.CrossChainOrderAlreadySettled.selector);
        core.markCrossChainSettled(commitHash);
    }

    function test_markSettledRevertsAfterRefund() public {
        bytes32 commitHash = _commitCrossChain();
        vm.warp(block.timestamp + 2 hours + 1);
        core.requestCrossChainRefund(commitHash);
        vm.warp(block.timestamp + 1 hours + 1);
        core.executeCrossChainRefund(commitHash);

        vm.prank(owner);
        vm.expectRevert(VibeSwapCore.CrossChainOrderAlreadySettled.selector);
        core.markCrossChainSettled(commitHash);
    }

    // ============ Edge Cases ============

    function test_markSettledRevertsForNonExistentOrder() public {
        bytes32 fakeHash = keccak256("does_not_exist");
        vm.prank(owner);
        vm.expectRevert(VibeSwapCore.CrossChainOrderNotFound.selector);
        core.markCrossChainSettled(fakeHash);
    }

    function test_requestRefundRevertsForNonExistentOrder() public {
        bytes32 fakeHash = keccak256("does_not_exist");
        vm.warp(block.timestamp + 3 hours);
        vm.expectRevert(VibeSwapCore.CrossChainOrderNotFound.selector);
        core.requestCrossChainRefund(fakeHash);
    }

    function test_settledOrderCannotBeRefundedEvenLater() public {
        bytes32 commitHash = _commitCrossChain();
        vm.prank(owner);
        core.markCrossChainSettled(commitHash);
        vm.warp(block.timestamp + 24 hours);
        vm.expectRevert(VibeSwapCore.CrossChainOrderNotPending.selector);
        core.requestCrossChainRefund(commitHash);
    }

    function test_refundedOrderCannotBeSettled() public {
        bytes32 commitHash = _commitCrossChain();
        vm.warp(block.timestamp + 2 hours + 1);
        core.requestCrossChainRefund(commitHash);
        vm.warp(block.timestamp + 1 hours + 1);
        core.executeCrossChainRefund(commitHash);

        vm.prank(owner);
        vm.expectRevert(VibeSwapCore.CrossChainOrderAlreadySettled.selector);
        core.markCrossChainSettled(commitHash);
    }

    function test_depositsReducedOnRefundExecute() public {
        bytes32 commitHash = _commitCrossChain();
        assertEq(core.deposits(trader, address(tokenA)), SWAP_AMOUNT);

        vm.warp(block.timestamp + 2 hours + 1);
        core.requestCrossChainRefund(commitHash);
        // Deposits still held during challenge window
        assertEq(core.deposits(trader, address(tokenA)), SWAP_AMOUNT);

        vm.warp(block.timestamp + 1 hours + 1);
        core.executeCrossChainRefund(commitHash);
        assertEq(core.deposits(trader, address(tokenA)), 0);
    }

    // ============ XC-004: Deposit Decrement on Settlement ============

    function test_depositsDecrementedOnSettlement() public {
        bytes32 commitHash = _commitCrossChain();
        assertEq(core.deposits(trader, address(tokenA)), SWAP_AMOUNT);

        vm.prank(owner);
        core.markCrossChainSettled(commitHash);
        assertEq(core.deposits(trader, address(tokenA)), 0);
    }

    function test_withdrawBlockedAfterSettlement() public {
        bytes32 commitHash = _commitCrossChain();

        vm.prank(owner);
        core.markCrossChainSettled(commitHash);

        vm.prank(trader);
        vm.expectRevert("No deposit");
        core.withdrawDeposit(address(tokenA));
    }

    function test_doubleSpendViaWithdrawalPrevented() public {
        bytes32 commitHash = _commitCrossChain();
        uint256 traderBalanceBefore = tokenA.balanceOf(trader);

        // Settlement arrives — deposits decremented
        vm.prank(owner);
        core.markCrossChainSettled(commitHash);

        // Trader cannot withdraw deposited tokens
        vm.prank(trader);
        vm.expectRevert("No deposit");
        core.withdrawDeposit(address(tokenA));

        // Balance unchanged (no tokens returned)
        assertEq(tokenA.balanceOf(trader), traderBalanceBefore);
    }

    function test_depositReleasedEventOnSettlement() public {
        bytes32 commitHash = _commitCrossChain();

        vm.expectEmit(true, true, false, true);
        emit CrossChainDepositReleased(commitHash, trader, address(tokenA), SWAP_AMOUNT);
        vm.prank(owner);
        core.markCrossChainSettled(commitHash);
    }

    // ============ XC-004: settleCrossChainOrder ============

    function test_settleCrossChainOrderByOwner() public {
        bytes32 commitHash = _commitCrossChain();
        bytes32 poolId = keccak256(abi.encodePacked(address(tokenA), address(tokenB)));

        vm.prank(owner);
        core.settleCrossChainOrder(commitHash, poolId, 950e18);

        assertTrue(_getOrderStatus(commitHash) == VibeSwapCore.CrossChainStatus.SETTLED);
        assertEq(core.deposits(trader, address(tokenA)), 0);
    }

    function test_settleCrossChainOrderByRouter() public {
        bytes32 commitHash = _commitCrossChain();
        bytes32 poolId = keccak256(abi.encodePacked(address(tokenA), address(tokenB)));

        vm.prank(address(router));
        core.settleCrossChainOrder(commitHash, poolId, 950e18);

        assertTrue(_getOrderStatus(commitHash) == VibeSwapCore.CrossChainStatus.SETTLED);
    }

    function test_settleCrossChainOrderRevertsUnauthorized() public {
        bytes32 commitHash = _commitCrossChain();
        bytes32 poolId = keccak256(abi.encodePacked(address(tokenA), address(tokenB)));

        vm.prank(anyoneElse);
        vm.expectRevert("Only owner or router");
        core.settleCrossChainOrder(commitHash, poolId, 950e18);
    }

    function test_settleCrossChainOrderRevertsDoubleSettle() public {
        bytes32 commitHash = _commitCrossChain();
        bytes32 poolId = keccak256(abi.encodePacked(address(tokenA), address(tokenB)));

        vm.prank(owner);
        core.settleCrossChainOrder(commitHash, poolId, 950e18);

        vm.prank(owner);
        vm.expectRevert(VibeSwapCore.CrossChainOrderAlreadySettled.selector);
        core.settleCrossChainOrder(commitHash, poolId, 950e18);
    }

    function test_settleCrossChainOrderCancelsRefund() public {
        bytes32 commitHash = _commitCrossChain();
        bytes32 poolId = keccak256(abi.encodePacked(address(tokenA), address(tokenB)));

        // Request refund after timeout
        vm.warp(block.timestamp + 2 hours + 1);
        core.requestCrossChainRefund(commitHash);

        // Full settlement arrives during challenge window
        vm.prank(owner);
        core.settleCrossChainOrder(commitHash, poolId, 950e18);

        assertTrue(_getOrderStatus(commitHash) == VibeSwapCore.CrossChainStatus.SETTLED);
        assertEq(core.deposits(trader, address(tokenA)), 0);

        // Execute refund reverts
        vm.warp(block.timestamp + 1 hours + 1);
        vm.expectRevert(VibeSwapCore.CrossChainOrderNotRequested.selector);
        core.executeCrossChainRefund(commitHash);
    }

    // ============ Constants Verification ============

    function test_refundTimeoutIs2Hours() public view {
        assertEq(core.REFUND_TIMEOUT(), 2 hours);
    }

    function test_challengeWindowIs1Hour() public view {
        assertEq(core.CHALLENGE_WINDOW(), 1 hours);
    }
}
