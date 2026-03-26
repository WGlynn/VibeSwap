// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/settlement/BatchPriceVerifier.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract BatchPriceVerifierTest is Test {
    BatchPriceVerifier public verifier;

    address public owner;
    address public alice;
    address public bob;

    uint256 public constant BOND_AMOUNT = 0.1 ether;
    uint64 public constant DISPUTE_WINDOW = 1 hours;

    event BatchPriceSubmitted(uint64 indexed batchId, address indexed submitter, uint256 clearingPrice, bytes32 orderRoot);
    event BatchPriceFinalized(uint64 indexed batchId, uint256 clearingPrice);
    event BatchPriceDisputed(uint64 indexed batchId, address indexed disputer, address indexed submitter, uint256 slashedBond);

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");

        // Deploy with UUPS proxy
        BatchPriceVerifier impl = new BatchPriceVerifier();
        bytes memory initData = abi.encodeWithSelector(
            BatchPriceVerifier.initialize.selector, owner, BOND_AMOUNT, DISPUTE_WINDOW
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        verifier = BatchPriceVerifier(payable(address(proxy)));

        // Fund test actors
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
    }

    // ============ Helpers ============

    function _submitBatch(
        address submitter,
        uint64 batchId,
        uint256 price,
        bytes32 orderRoot,
        uint256 buyVol,
        uint256 sellVol
    ) internal {
        vm.prank(submitter);
        verifier.submitBatchPrice{value: BOND_AMOUNT}(batchId, price, orderRoot, buyVol, sellVol);
    }

    function _defaultSubmit(uint64 batchId) internal {
        _submitBatch(alice, batchId, 1000, keccak256("orders"), 500, 400);
    }

    // ============ Initialization ============

    function test_initialize_setsOwner() public view {
        assertEq(verifier.owner(), owner);
    }

    function test_initialize_setsBondAmount() public view {
        assertEq(verifier.bondAmount(), BOND_AMOUNT);
    }

    function test_initialize_setsDisputeWindow() public view {
        assertEq(verifier.disputeWindow(), DISPUTE_WINDOW);
    }

    function test_initialize_cannotReinitialize() public {
        vm.expectRevert();
        verifier.initialize(owner, BOND_AMOUNT, DISPUTE_WINDOW);
    }

    // ============ Submit Batch Price ============

    function test_submitBatchPrice_succeeds() public {
        uint64 batchId = 1;
        bytes32 orderRoot = keccak256("orders");

        vm.expectEmit(true, true, false, true);
        emit BatchPriceSubmitted(batchId, alice, 1000, orderRoot);

        _submitBatch(alice, batchId, 1000, orderRoot, 500, 400);

        (uint256 price, bool finalized) = verifier.getBatchPrice(batchId);
        assertEq(price, 1000);
        assertFalse(finalized);
    }

    function test_submitBatchPrice_storesAllFields() public {
        uint64 batchId = 1;
        bytes32 orderRoot = keccak256("orders");
        _submitBatch(alice, batchId, 2000, orderRoot, 1000, 800);

        (
            uint256 clearingPrice,
            bytes32 storedRoot,
            uint256 buyVol,
            uint256 sellVol,
            address submitter,
            uint64 submittedAt,
            bool finalized
        ) = verifier.batches(batchId);

        assertEq(clearingPrice, 2000);
        assertEq(storedRoot, orderRoot);
        assertEq(buyVol, 1000);
        assertEq(sellVol, 800);
        assertEq(submitter, alice);
        assertEq(submittedAt, uint64(block.timestamp));
        assertFalse(finalized);
    }

    function test_submitBatchPrice_revert_alreadySubmitted() public {
        _defaultSubmit(1);

        vm.expectRevert(abi.encodeWithSelector(BatchPriceVerifier.BatchAlreadySubmitted.selector, uint64(1)));
        _submitBatch(bob, 1, 2000, keccak256("orders2"), 600, 500);
    }

    function test_submitBatchPrice_revert_insufficientBond() public {
        vm.prank(alice);
        vm.expectRevert(BatchPriceVerifier.InsufficientBond.selector);
        verifier.submitBatchPrice{value: BOND_AMOUNT - 1}(1, 1000, keccak256("orders"), 500, 400);
    }

    function test_submitBatchPrice_revert_zeroPrice() public {
        vm.prank(alice);
        vm.expectRevert(BatchPriceVerifier.MarketDoesNotClear.selector);
        verifier.submitBatchPrice{value: BOND_AMOUNT}(1, 0, keccak256("orders"), 500, 400);
    }

    function test_submitBatchPrice_revert_buyLessThanSell() public {
        vm.prank(alice);
        vm.expectRevert(BatchPriceVerifier.MarketDoesNotClear.selector);
        verifier.submitBatchPrice{value: BOND_AMOUNT}(1, 1000, keccak256("orders"), 300, 500);
    }

    function test_submitBatchPrice_equalVolumes() public {
        // buyVolume == sellVolume is valid (perfect clearing)
        _submitBatch(alice, 1, 1000, keccak256("orders"), 500, 500);
        (uint256 price,) = verifier.getBatchPrice(1);
        assertEq(price, 1000);
    }

    function test_submitBatchPrice_excessBondAccepted() public {
        // Excess ETH beyond bondAmount is accepted
        uint256 excess = 0.05 ether;
        vm.prank(alice);
        verifier.submitBatchPrice{value: BOND_AMOUNT + excess}(1, 1000, keccak256("orders"), 500, 400);

        (uint256 price,) = verifier.getBatchPrice(1);
        assertEq(price, 1000);
    }

    // ============ Finalize Batch ============

    function test_finalizeBatch_succeeds() public {
        _defaultSubmit(1);

        // Warp past dispute window
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);

        uint256 aliceBalBefore = alice.balance;

        vm.expectEmit(true, false, false, true);
        emit BatchPriceFinalized(1, 1000);

        verifier.finalizeBatch(1);

        (, bool finalized) = verifier.getBatchPrice(1);
        assertTrue(finalized);

        // Bond returned to submitter
        assertEq(alice.balance, aliceBalBefore + BOND_AMOUNT);
    }

    function test_finalizeBatch_revert_notFound() public {
        vm.expectRevert(abi.encodeWithSelector(BatchPriceVerifier.BatchNotFound.selector, uint64(99)));
        verifier.finalizeBatch(99);
    }

    function test_finalizeBatch_revert_alreadyFinalized() public {
        _defaultSubmit(1);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        verifier.finalizeBatch(1);

        vm.expectRevert(abi.encodeWithSelector(BatchPriceVerifier.BatchAlreadyFinalized.selector, uint64(1)));
        verifier.finalizeBatch(1);
    }

    function test_finalizeBatch_revert_disputeWindowActive() public {
        _defaultSubmit(1);

        // Still within dispute window
        vm.warp(block.timestamp + DISPUTE_WINDOW - 1);

        vm.expectRevert(abi.encodeWithSelector(BatchPriceVerifier.DisputeWindowActive.selector, uint64(1)));
        verifier.finalizeBatch(1);
    }

    function test_finalizeBatch_exactWindowBoundary() public {
        _defaultSubmit(1);

        // Exactly at window end should still revert (block.timestamp < submittedAt + disputeWindow)
        vm.warp(block.timestamp + DISPUTE_WINDOW);

        // At exactly submittedAt + disputeWindow the condition is:
        // block.timestamp < batch.submittedAt + disputeWindow → false (equal, not less)
        // So finalization should succeed
        verifier.finalizeBatch(1);
        (, bool finalized) = verifier.getBatchPrice(1);
        assertTrue(finalized);
    }

    function test_finalizeBatch_anyoneCanCall() public {
        _defaultSubmit(1);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);

        // Bob (non-submitter) can finalize
        vm.prank(bob);
        verifier.finalizeBatch(1);

        (, bool finalized) = verifier.getBatchPrice(1);
        assertTrue(finalized);
    }

    // ============ Dispute Batch ============

    function test_disputeBatch_succeeds() public {
        _defaultSubmit(1);

        uint256 bobBalBefore = bob.balance;

        // Dispute with volumes that fail clearing (buyVol < sellVol)
        vm.expectEmit(true, true, true, true);
        emit BatchPriceDisputed(1, bob, alice, BOND_AMOUNT);

        vm.prank(bob);
        verifier.disputeBatch(1, 200, 500);

        // Bond goes to disputer
        assertEq(bob.balance, bobBalBefore + BOND_AMOUNT);

        // Batch is deleted
        (uint256 price,) = verifier.getBatchPrice(1);
        assertEq(price, 0);
    }

    function test_disputeBatch_revert_notFound() public {
        vm.expectRevert(abi.encodeWithSelector(BatchPriceVerifier.BatchNotFound.selector, uint64(99)));
        vm.prank(bob);
        verifier.disputeBatch(99, 200, 500);
    }

    function test_disputeBatch_revert_alreadyFinalized() public {
        _defaultSubmit(1);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        verifier.finalizeBatch(1);

        vm.expectRevert(abi.encodeWithSelector(BatchPriceVerifier.BatchAlreadyFinalized.selector, uint64(1)));
        vm.prank(bob);
        verifier.disputeBatch(1, 200, 500);
    }

    function test_disputeBatch_revert_windowExpired() public {
        _defaultSubmit(1);
        vm.warp(block.timestamp + DISPUTE_WINDOW);

        vm.expectRevert(abi.encodeWithSelector(BatchPriceVerifier.DisputeWindowExpired.selector, uint64(1)));
        vm.prank(bob);
        verifier.disputeBatch(1, 200, 500);
    }

    function test_disputeBatch_revert_clearingConditionHolds() public {
        _defaultSubmit(1);

        // If actual volumes still pass clearing, dispute should fail
        vm.expectRevert(BatchPriceVerifier.InvalidClearingCondition.selector);
        vm.prank(bob);
        verifier.disputeBatch(1, 600, 400);
    }

    function test_disputeBatch_zeroPrice() public {
        _defaultSubmit(1);

        // Zero buy volume makes clearing fail
        vm.prank(bob);
        verifier.disputeBatch(1, 0, 100);

        (uint256 price,) = verifier.getBatchPrice(1);
        assertEq(price, 0); // Deleted
    }

    function test_disputeBatch_selfDispute() public {
        _defaultSubmit(1);

        // Alice disputes her own submission — allowed by the contract
        uint256 aliceBalBefore = alice.balance;
        vm.prank(alice);
        verifier.disputeBatch(1, 100, 500);

        // Bond returned to alice as disputer
        assertEq(alice.balance, aliceBalBefore + BOND_AMOUNT);
    }

    // ============ Admin ============

    function test_setBondAmount_onlyOwner() public {
        verifier.setBondAmount(0.5 ether);
        assertEq(verifier.bondAmount(), 0.5 ether);
    }

    function test_setBondAmount_revert_nonOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        verifier.setBondAmount(0.5 ether);
    }

    function test_setDisputeWindow_onlyOwner() public {
        verifier.setDisputeWindow(2 hours);
        assertEq(verifier.disputeWindow(), 2 hours);
    }

    function test_setDisputeWindow_revert_nonOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        verifier.setDisputeWindow(2 hours);
    }

    // ============ View Functions ============

    function test_getBatchPrice_defaultValues() public view {
        (uint256 price, bool finalized) = verifier.getBatchPrice(999);
        assertEq(price, 0);
        assertFalse(finalized);
    }

    // ============ Fuzz Tests ============

    function testFuzz_submitBatchPrice_validVolumes(
        uint64 batchId,
        uint256 price,
        uint256 buyVol,
        uint256 sellVol
    ) public {
        vm.assume(price > 0);
        vm.assume(buyVol >= sellVol);
        vm.assume(batchId > 0);

        vm.prank(alice);
        verifier.submitBatchPrice{value: BOND_AMOUNT}(batchId, price, keccak256("root"), buyVol, sellVol);

        (uint256 storedPrice,) = verifier.getBatchPrice(batchId);
        assertEq(storedPrice, price);
    }

    function testFuzz_submitBatchPrice_revert_invalidClearing(
        uint64 batchId,
        uint256 buyVol,
        uint256 sellVol
    ) public {
        vm.assume(buyVol < sellVol);
        vm.assume(batchId > 0);

        vm.prank(alice);
        vm.expectRevert(BatchPriceVerifier.MarketDoesNotClear.selector);
        verifier.submitBatchPrice{value: BOND_AMOUNT}(batchId, 1000, keccak256("root"), buyVol, sellVol);
    }

    function testFuzz_finalizeBatch_afterWindow(uint64 warpSeconds) public {
        vm.assume(warpSeconds > DISPUTE_WINDOW);
        vm.assume(warpSeconds < 365 days); // Reasonable bound

        _defaultSubmit(1);
        vm.warp(block.timestamp + warpSeconds);

        verifier.finalizeBatch(1);
        (, bool finalized) = verifier.getBatchPrice(1);
        assertTrue(finalized);
    }

    // ============ Edge Cases ============

    function test_multipleBatches_independent() public {
        _submitBatch(alice, 1, 1000, keccak256("a"), 500, 400);
        _submitBatch(bob, 2, 2000, keccak256("b"), 800, 700);

        (uint256 price1,) = verifier.getBatchPrice(1);
        (uint256 price2,) = verifier.getBatchPrice(2);
        assertEq(price1, 1000);
        assertEq(price2, 2000);
    }

    function test_disputeThenResubmit() public {
        _defaultSubmit(1);

        // Dispute succeeds — batch deleted
        vm.prank(bob);
        verifier.disputeBatch(1, 100, 500);

        // Now same batchId can be resubmitted
        _submitBatch(bob, 1, 1500, keccak256("new-orders"), 600, 500);

        (uint256 price,) = verifier.getBatchPrice(1);
        assertEq(price, 1500);
    }
}
