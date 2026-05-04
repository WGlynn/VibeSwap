// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../../contracts/core/VibeSwapCore.sol";
import "../../contracts/core/interfaces/ICommitRevealAuction.sol";

// ============ C15-CC-F1 — Symmetric Retry Queue for Clawback Compliance Catch ============
//
// Verifies:
//   (a) A failing clawbackRegistry.recordTransaction is queued in failedCompliances.
//   (b) retryFailedCompliance succeeds once the registry is unblocked.
//   (c) MAX_FAILED_COMPLIANCE_QUEUE cap is enforced (queue silently stops at cap).
//
// Strategy: deploy VibeSwapCore against minimal mocks, then use a test-harness subclass
// that exposes _recordCrossChainExecution as an external entry point so we can drive it
// without needing a full cross-chain settlement stack.

// ============ Minimal Mocks ============

contract _FCR_MockAuction {
    function getCurrentBatchId() external pure returns (uint64) { return 1; }
    function getCurrentPhase() external pure returns (ICommitRevealAuction.BatchPhase) {
        return ICommitRevealAuction.BatchPhase.COMMIT;
    }
}

contract _FCR_MockAMM {
    function getPoolId(address a, address b) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(a, b));
    }
}

contract _FCR_MockTreasury {}
contract _FCR_MockRouter {}

// ============ Controllable Clawback Mock ============

/// @notice Clawback registry mock whose recordTransaction reverts on demand.
contract _FCR_TogglableClawback {
    bool public shouldRevert;
    uint256 public callCount;

    function setRevert(bool _revert) external { shouldRevert = _revert; }

    function isBlocked(address) external pure returns (bool) { return false; }

    function recordTransaction(address, address, uint256, address) external {
        callCount++;
        if (shouldRevert) revert("registry unavailable");
    }
}

// ============ Test Harness ============

/// @notice Exposes _recordCrossChainExecution for direct testing without a full settlement.
contract FailedComplianceHarness is VibeSwapCore {
    /// @notice Drive the internal function directly from tests.
    function exposed_recordCrossChainExecution(
        bytes32 poolId,
        address trader,
        uint256 amountIn,
        address tokenIn,
        uint256 estimatedOut
    ) external {
        _recordCrossChainExecution(poolId, trader, amountIn, tokenIn, estimatedOut);
    }

    /// @notice Read a specific compliance queue entry (test introspection).
    function complianceAt(uint256 index) external view returns (VibeSwapCore.FailedCompliance memory) {
        return failedCompliances[index];
    }
}

// ============ Test Contract ============

contract FailedComplianceRetryTest is Test {

    FailedComplianceHarness public core;
    _FCR_TogglableClawback  public clawback;

    address public owner;
    address public trader;
    address public tokenIn;
    address public ammAddr;

    bytes32 public constant POOL_ID = keccak256("test-pool");

    // ============ Events to assert ============

    event ComplianceCheckFailed(bytes32 indexed poolId, address indexed trader, bytes reason);
    event FailedComplianceQueued(uint256 indexed index, bytes32 indexed poolId, address indexed trader);
    event FailedComplianceRetried(uint256 indexed index, bool success);

    // ============ Setup ============

    function setUp() public {
        owner   = makeAddr("owner");
        trader  = makeAddr("trader");
        tokenIn = makeAddr("tokenIn");

        address auction  = address(new _FCR_MockAuction());
        address mockAmm  = address(new _FCR_MockAMM());
        address treasury = address(new _FCR_MockTreasury());
        address router   = address(new _FCR_MockRouter());

        clawback = new _FCR_TogglableClawback();

        FailedComplianceHarness impl = new FailedComplianceHarness();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(
                VibeSwapCore.initialize.selector,
                owner, auction, mockAmm, treasury, router
            )
        );
        core = FailedComplianceHarness(payable(address(proxy)));

        // Wire the clawback registry
        vm.prank(owner);
        core.setClawbackRegistry(address(clawback));

        ammAddr = address(core.amm());

        vm.warp(1000); // avoid timestamp-zero edge cases
    }

    // ============ (a) Failing recordTransaction queues the entry ============

    function test_C15CCF1_failingRecordTransaction_queuesForRetry() public {
        clawback.setRevert(true);

        // Expect both the failure event and the queue event
        vm.expectEmit(true, true, false, false);
        emit ComplianceCheckFailed(POOL_ID, trader, bytes(""));

        vm.expectEmit(true, true, true, false);
        emit FailedComplianceQueued(0, POOL_ID, trader);

        core.exposed_recordCrossChainExecution(POOL_ID, trader, 100e18, tokenIn, 99e18);

        // Queue grew by 1
        assertEq(core.getFailedComplianceCount(), 1);

        // Entry content matches what was passed to _recordCrossChainExecution
        VibeSwapCore.FailedCompliance memory fc = core.complianceAt(0);
        assertEq(fc.poolId,   POOL_ID);
        assertEq(fc.trader,   trader);
        assertEq(fc.ammAddr,  ammAddr);
        assertEq(fc.amountIn, 100e18);
        assertEq(fc.tokenIn,  tokenIn);
        assertGt(fc.timestamp, 0);
    }

    function test_C15CCF1_successfulRecordTransaction_doesNotQueue() public {
        clawback.setRevert(false);

        core.exposed_recordCrossChainExecution(POOL_ID, trader, 100e18, tokenIn, 99e18);

        assertEq(core.getFailedComplianceCount(), 0);
        assertEq(clawback.callCount(), 1);
    }

    // ============ (b) retryFailedCompliance succeeds when registry unblocks ============

    function test_C15CCF1_retrySucceeds_whenRegistryUnblocked() public {
        // Step 1: queue a failure
        clawback.setRevert(true);
        core.exposed_recordCrossChainExecution(POOL_ID, trader, 100e18, tokenIn, 99e18);
        assertEq(core.getFailedComplianceCount(), 1);
        assertEq(clawback.callCount(), 0); // revert before increment

        // Step 2: unblock registry
        clawback.setRevert(false);

        // Step 3: permissionless retry — any address can call
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectEmit(true, false, false, true);
        emit FailedComplianceRetried(0, true);

        core.retryFailedCompliance(0);

        // Queue is now empty (swap-and-pop removed the entry)
        assertEq(core.getFailedComplianceCount(), 0);
        // recordTransaction actually executed this time
        assertEq(clawback.callCount(), 1);
    }

    function test_C15CCF1_retryFails_requeuesEntry() public {
        // Step 1: queue a failure
        clawback.setRevert(true);
        core.exposed_recordCrossChainExecution(POOL_ID, trader, 100e18, tokenIn, 99e18);
        assertEq(core.getFailedComplianceCount(), 1);

        // Step 2: retry while registry still reverts — must re-queue
        vm.expectEmit(true, false, false, true);
        emit FailedComplianceRetried(0, false);

        core.retryFailedCompliance(0);

        // Still in queue (re-queued at end)
        assertEq(core.getFailedComplianceCount(), 1);

        // Content preserved
        VibeSwapCore.FailedCompliance memory fc = core.complianceAt(0);
        assertEq(fc.trader,   trader);
        assertEq(fc.amountIn, 100e18);
        assertEq(fc.tokenIn,  tokenIn);
    }

    function test_C15CCF1_retryRevertsOnOutOfBounds() public {
        vm.expectRevert("Index out of bounds");
        core.retryFailedCompliance(0);
    }

    function test_C15CCF1_retryRevertsWhenNoRegistry() public {
        // Remove registry
        vm.prank(owner);
        core.setClawbackRegistry(address(0));

        // Queue a synthetic entry via a re-set registry temporarily
        vm.prank(owner);
        core.setClawbackRegistry(address(clawback));
        clawback.setRevert(true);
        core.exposed_recordCrossChainExecution(POOL_ID, trader, 100e18, tokenIn, 99e18);
        assertEq(core.getFailedComplianceCount(), 1);

        // Remove registry again — retry must revert
        vm.prank(owner);
        core.setClawbackRegistry(address(0));

        vm.expectRevert("No clawback registry");
        core.retryFailedCompliance(0);
    }

    // Swap-and-pop: retry of first entry swaps it with last, preserving all remaining entries.
    function test_C15CCF1_swapAndPop_removesCorrectEntry() public {
        clawback.setRevert(true);

        // Push 3 failures with distinct amountIn values for identification
        core.exposed_recordCrossChainExecution(POOL_ID, trader, 1e18, tokenIn, 0);
        core.exposed_recordCrossChainExecution(POOL_ID, trader, 2e18, tokenIn, 0);
        core.exposed_recordCrossChainExecution(POOL_ID, trader, 3e18, tokenIn, 0);
        assertEq(core.getFailedComplianceCount(), 3);

        // Unblock and retry index 0 (amountIn == 1e18)
        clawback.setRevert(false);
        core.retryFailedCompliance(0);

        // Array is now length 2 and dense — last entry (3e18) filled slot 0
        assertEq(core.getFailedComplianceCount(), 2);
        assertEq(core.complianceAt(0).amountIn, 3e18); // swap-and-pop moved last here
        assertEq(core.complianceAt(1).amountIn, 2e18); // original index 1 unchanged
    }

    // ============ (c) Cap enforcement ============

    function test_C15CCF1_capEnforced_noRevertWhenQueueFull() public {
        clawback.setRevert(true);

        uint256 cap = core.MAX_FAILED_COMPLIANCE_QUEUE();
        assertEq(cap, 1000);

        // Fill the queue to cap
        for (uint256 i = 0; i < cap; i++) {
            core.exposed_recordCrossChainExecution(POOL_ID, trader, i + 1, tokenIn, 0);
        }
        assertEq(core.getFailedComplianceCount(), cap);

        // One more should be silently dropped — no revert, no queue growth
        core.exposed_recordCrossChainExecution(POOL_ID, trader, cap + 1, tokenIn, 0);
        assertEq(core.getFailedComplianceCount(), cap); // unchanged
    }

    // ============ Constant exposure ============

    function test_C15CCF1_constantExposed() public view {
        assertEq(core.MAX_FAILED_COMPLIANCE_QUEUE(), 1000);
    }
}
