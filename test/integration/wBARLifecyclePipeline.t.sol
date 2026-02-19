// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/core/wBAR.sol";
import "../../contracts/core/interfaces/IwBAR.sol";
import "../../contracts/core/interfaces/ICommitRevealAuction.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockWBARToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// @notice Mock auction that returns configurable phase/batch data
contract MockWBARAuction {
    uint64 public currentBatchId = 1;
    ICommitRevealAuction.BatchPhase public currentPhase = ICommitRevealAuction.BatchPhase.COMMIT;

    struct Batch {
        ICommitRevealAuction.BatchPhase phase;
    }
    mapping(uint64 => Batch) public batches;

    function setCurrentBatchId(uint64 id) external { currentBatchId = id; }
    function setCurrentPhase(ICommitRevealAuction.BatchPhase phase) external { currentPhase = phase; }
    function setBatchPhase(uint64 id, ICommitRevealAuction.BatchPhase phase) external {
        batches[id] = Batch(phase);
    }

    function getCurrentBatchId() external view returns (uint64) { return currentBatchId; }
    function getCurrentPhase() external view returns (ICommitRevealAuction.BatchPhase) { return currentPhase; }

    function getBatch(uint64 batchId) external view returns (ICommitRevealAuction.Batch memory batch) {
        batch.phase = batches[batchId].phase;
    }
}

/// @notice Mock VibeSwapCore that can call wBAR.mint/settle and handle releaseFailedDeposit
contract MockVibeSwapCoreForWBAR {
    wBAR public bar;
    mapping(bytes32 => mapping(address => mapping(address => uint256))) public deposits;

    function setWBAR(address _bar) external { bar = wBAR(_bar); }

    // Simulate depositing tokenIn to core
    function depositTokens(bytes32 commitId, address tokenIn, uint256 amount, address from) external {
        IERC20(tokenIn).transferFrom(from, address(this), amount);
        deposits[commitId][from][tokenIn] = amount;
    }

    // Mint wBAR position (simulates commitSwap creating wBAR)
    function mintPosition(
        bytes32 commitId,
        uint64 batchId,
        address holder,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) external {
        bar.mint(commitId, batchId, holder, tokenIn, tokenOut, amountIn, minAmountOut);
    }

    // Settle position (simulates settlement routing output to wBAR)
    function settlePosition(bytes32 commitId, uint256 amountOut) external {
        bar.settle(commitId, amountOut);
    }

    // releaseFailedDeposit callback from wBAR.reclaimFailed
    function releaseFailedDeposit(
        bytes32 commitId,
        address to,
        address token,
        uint256 amount
    ) external {
        // Transfer original deposit to current holder
        IERC20(token).transfer(to, amount);
    }
}

// ============ Integration Test ============

/**
 * @title wBARLifecyclePipelineTest
 * @notice Tests the complete wBAR lifecycle:
 *   1. Commit → wBAR minted to committer
 *   2. Transfer during COMMIT phase → position changes holder
 *   3. Settlement → output routed to wBAR contract
 *   4. Redeem → new holder claims output tokens
 *   5. reclaimFailed → reclaim original deposit on failed swap
 */
contract wBARLifecyclePipelineTest is Test {
    wBAR bar;
    MockWBARAuction auction;
    MockVibeSwapCoreForWBAR core;
    MockWBARToken tokenIn;
    MockWBARToken tokenOut;

    address committer;
    address buyer;

    bytes32 commitId1;
    bytes32 commitId2;

    function setUp() public {
        committer = makeAddr("committer");
        buyer = makeAddr("buyer");

        // Deploy tokens
        tokenIn = new MockWBARToken("Token In", "TIN");
        tokenOut = new MockWBARToken("Token Out", "TOUT");

        // Deploy auction mock
        auction = new MockWBARAuction();

        // Deploy mock core
        core = new MockVibeSwapCoreForWBAR();

        // Deploy wBAR with core as owner
        bar = new wBAR(address(auction), address(core));
        core.setWBAR(address(bar));

        // Set up commit IDs
        commitId1 = keccak256("commit1");
        commitId2 = keccak256("commit2");

        // Fund the core with tokenIn (simulates deposit)
        tokenIn.mint(address(core), 1000 ether);

        // Fund wBAR with tokenOut (simulates settlement routing)
        tokenOut.mint(address(bar), 1000 ether);
    }

    // ============ Test: Full lifecycle — mint → transfer → settle → redeem ============

    function test_fullLifecycle_mintTransferSettleRedeem() public {
        // Phase 1: Mint wBAR for committer
        core.mintPosition(commitId1, 1, committer, address(tokenIn), address(tokenOut), 10 ether, 9 ether);

        IwBAR.Position memory pos = bar.getPosition(commitId1);
        assertEq(pos.holder, committer);
        assertEq(pos.committer, committer);
        assertEq(pos.amountIn, 10 ether);
        assertEq(bar.balanceOf(committer), 10 ether);

        // Phase 2: Transfer position to buyer during COMMIT phase
        vm.prank(committer);
        bar.transferPosition(commitId1, buyer);

        pos = bar.getPosition(commitId1);
        assertEq(pos.holder, buyer);
        assertEq(pos.committer, committer); // committer unchanged
        assertEq(bar.balanceOf(committer), 0);
        assertEq(bar.balanceOf(buyer), 10 ether);

        // Phase 3: Settle — output tokens sent to wBAR contract (already funded in setUp)
        core.settlePosition(commitId1, 9.5 ether);

        pos = bar.getPosition(commitId1);
        assertTrue(pos.settled);
        assertEq(pos.amountOut, 9.5 ether);

        // Phase 4: Buyer redeems
        vm.prank(buyer);
        bar.redeem(commitId1);

        pos = bar.getPosition(commitId1);
        assertTrue(pos.redeemed);
        assertEq(bar.balanceOf(buyer), 0);
        assertEq(tokenOut.balanceOf(buyer), 9.5 ether);
    }

    // ============ Test: Mint creates position with correct data ============

    function test_mint_createsPosition() public {
        core.mintPosition(commitId1, 1, committer, address(tokenIn), address(tokenOut), 5 ether, 4 ether);

        IwBAR.Position memory pos = bar.getPosition(commitId1);
        assertEq(pos.commitId, commitId1);
        assertEq(pos.batchId, 1);
        assertEq(pos.tokenIn, address(tokenIn));
        assertEq(pos.tokenOut, address(tokenOut));
        assertEq(pos.amountIn, 5 ether);
        assertEq(pos.minAmountOut, 4 ether);
        assertFalse(pos.settled);
        assertFalse(pos.redeemed);

        // wBAR tokens minted
        assertEq(bar.balanceOf(committer), 5 ether);
        assertEq(bar.totalSupply(), 5 ether);
    }

    // ============ Test: Only owner (core) can mint ============

    function test_mint_onlyOwner() public {
        vm.prank(committer);
        vm.expectRevert();
        bar.mint(commitId1, 1, committer, address(tokenIn), address(tokenOut), 5 ether, 4 ether);
    }

    // ============ Test: Transfer only during COMMIT phase ============

    function test_transfer_blockedDuringRevealPhase() public {
        core.mintPosition(commitId1, 1, committer, address(tokenIn), address(tokenOut), 10 ether, 9 ether);

        // Switch to REVEAL phase
        auction.setCurrentPhase(ICommitRevealAuction.BatchPhase.REVEAL);

        vm.prank(committer);
        vm.expectRevert(IwBAR.InvalidPhaseForTransfer.selector);
        bar.transferPosition(commitId1, buyer);
    }

    // ============ Test: Transfer only by position holder ============

    function test_transfer_onlyHolder() public {
        core.mintPosition(commitId1, 1, committer, address(tokenIn), address(tokenOut), 10 ether, 9 ether);

        vm.prank(buyer); // buyer doesn't hold this position
        vm.expectRevert(IwBAR.NotPositionHolder.selector);
        bar.transferPosition(commitId1, makeAddr("thief"));
    }

    // ============ Test: Cannot transfer settled position ============

    function test_transfer_blockedAfterSettlement() public {
        core.mintPosition(commitId1, 1, committer, address(tokenIn), address(tokenOut), 10 ether, 9 ether);
        core.settlePosition(commitId1, 9 ether);

        vm.prank(committer);
        vm.expectRevert(IwBAR.PositionAlreadySettled.selector);
        bar.transferPosition(commitId1, buyer);
    }

    // ============ Test: Standard ERC-20 transfer is blocked ============

    function test_standardTransfer_blocked() public {
        core.mintPosition(commitId1, 1, committer, address(tokenIn), address(tokenOut), 10 ether, 9 ether);

        vm.prank(committer);
        vm.expectRevert(IwBAR.TransferRestricted.selector);
        bar.transfer(buyer, 10 ether);
    }

    // ============ Test: Redeem only after settlement ============

    function test_redeem_beforeSettlement_reverts() public {
        core.mintPosition(commitId1, 1, committer, address(tokenIn), address(tokenOut), 10 ether, 9 ether);

        vm.prank(committer);
        vm.expectRevert(IwBAR.PositionNotSettled.selector);
        bar.redeem(commitId1);
    }

    // ============ Test: Only holder can redeem ============

    function test_redeem_onlyHolder() public {
        core.mintPosition(commitId1, 1, committer, address(tokenIn), address(tokenOut), 10 ether, 9 ether);
        core.settlePosition(commitId1, 9 ether);

        vm.prank(buyer);
        vm.expectRevert(IwBAR.NotPositionHolder.selector);
        bar.redeem(commitId1);
    }

    // ============ Test: Cannot redeem twice ============

    function test_redeem_twice_reverts() public {
        core.mintPosition(commitId1, 1, committer, address(tokenIn), address(tokenOut), 10 ether, 9 ether);
        core.settlePosition(commitId1, 9 ether);

        vm.prank(committer);
        bar.redeem(commitId1);

        vm.prank(committer);
        vm.expectRevert(IwBAR.PositionAlreadyRedeemed.selector);
        bar.redeem(commitId1);
    }

    // ============ Test: reclaimFailed path ============

    function test_reclaimFailed_returnsOriginalDeposit() public {
        core.mintPosition(commitId1, 1, committer, address(tokenIn), address(tokenOut), 10 ether, 9 ether);

        // Position not settled (swap failed or batch expired)
        // Committer reclaims their original deposit
        uint256 balBefore = tokenIn.balanceOf(committer);

        vm.prank(committer);
        bar.reclaimFailed(commitId1);

        assertEq(tokenIn.balanceOf(committer), balBefore + 10 ether);
        assertTrue(bar.getPosition(commitId1).redeemed);
        assertEq(bar.balanceOf(committer), 0);
    }

    // ============ Test: reclaimFailed by transferred holder ============

    function test_reclaimFailed_byNewHolder() public {
        core.mintPosition(commitId1, 1, committer, address(tokenIn), address(tokenOut), 10 ether, 9 ether);

        // Transfer to buyer
        vm.prank(committer);
        bar.transferPosition(commitId1, buyer);

        // Buyer reclaims (gets committer's original deposit)
        uint256 balBefore = tokenIn.balanceOf(buyer);
        vm.prank(buyer);
        bar.reclaimFailed(commitId1);

        assertEq(tokenIn.balanceOf(buyer), balBefore + 10 ether);
    }

    // ============ Test: reclaimFailed blocked after settlement ============

    function test_reclaimFailed_afterSettlement_reverts() public {
        core.mintPosition(commitId1, 1, committer, address(tokenIn), address(tokenOut), 10 ether, 9 ether);
        core.settlePosition(commitId1, 9 ether);

        vm.prank(committer);
        vm.expectRevert(IwBAR.PositionAlreadySettled.selector);
        bar.reclaimFailed(commitId1);
    }

    // ============ Test: Multiple positions tracked correctly ============

    function test_multiplePositions_trackedCorrectly() public {
        core.mintPosition(commitId1, 1, committer, address(tokenIn), address(tokenOut), 10 ether, 9 ether);
        core.mintPosition(commitId2, 1, committer, address(tokenIn), address(tokenOut), 5 ether, 4 ether);

        assertEq(bar.balanceOf(committer), 15 ether);

        bytes32[] memory held = bar.getHeldPositions(committer);
        assertEq(held.length, 2);

        // Transfer first position
        vm.prank(committer);
        bar.transferPosition(commitId1, buyer);

        held = bar.getHeldPositions(committer);
        assertEq(held.length, 1);
        assertEq(bar.balanceOf(committer), 5 ether);
        assertEq(bar.balanceOf(buyer), 10 ether);
    }

    // ============ Test: holderOf view function ============

    function test_holderOf() public {
        core.mintPosition(commitId1, 1, committer, address(tokenIn), address(tokenOut), 10 ether, 9 ether);

        assertEq(bar.holderOf(commitId1), committer);

        vm.prank(committer);
        bar.transferPosition(commitId1, buyer);

        assertEq(bar.holderOf(commitId1), buyer);
    }

    // ============ Test: Zero output settlement (failed swap) ============

    function test_settle_zeroOutput() public {
        core.mintPosition(commitId1, 1, committer, address(tokenIn), address(tokenOut), 10 ether, 9 ether);
        core.settlePosition(commitId1, 0); // zero output

        vm.prank(committer);
        bar.redeem(commitId1);

        // No tokens transferred (0 output)
        assertEq(tokenOut.balanceOf(committer), 0);
        assertEq(bar.balanceOf(committer), 0);
    }
}
