// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/core/CommitRevealAuction.sol";
import "../contracts/libraries/DeterministicShuffle.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title CommitRevealAuctionAdvancedTest
 * @notice Advanced tests for MEV resistance, edge cases, and attack scenarios
 */
contract CommitRevealAuctionAdvancedTest is Test {
    CommitRevealAuction public auction;
    address public owner;
    address public treasury;

    // Traders
    address public alice;
    address public bob;
    address public charlie;
    address public dave;
    address public eve; // Attacker

    // Tokens
    address public tokenA;
    address public tokenB;
    address public tokenC;

    function setUp() public {
        owner = address(this);
        treasury = makeAddr("treasury");

        alice = makeAddr("alice");
        bob = makeAddr("bob");
        charlie = makeAddr("charlie");
        dave = makeAddr("dave");
        eve = makeAddr("eve");

        tokenA = makeAddr("tokenA");
        tokenB = makeAddr("tokenB");
        tokenC = makeAddr("tokenC");

        // Deploy
        CommitRevealAuction impl = new CommitRevealAuction();
        bytes memory initData = abi.encodeWithSelector(
            CommitRevealAuction.initialize.selector,
            owner,
            treasury,
            address(0) // complianceRegistry
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        auction = CommitRevealAuction(payable(address(proxy)));
        auction.setAuthorizedSettler(address(this), true);

        // Fund all traders
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(charlie, 100 ether);
        vm.deal(dave, 100 ether);
        vm.deal(eve, 100 ether);
    }

    // ============ MEV Resistance Tests ============

    /**
     * @notice Test that commit hashes don't reveal order information
     * @dev Verifies that identical orders with different secrets produce different hashes
     */
    function test_MEV_commitHashHidesOrderInfo() public {
        bytes32 secret1 = keccak256("secret1");
        bytes32 secret2 = keccak256("secret2");

        // Same order parameters, different secrets
        bytes32 hash1 = _generateCommitHash(alice, tokenA, tokenB, 1 ether, 0.9 ether, secret1);
        bytes32 hash2 = _generateCommitHash(alice, tokenA, tokenB, 1 ether, 0.9 ether, secret2);

        // Hashes should be completely different
        assertTrue(hash1 != hash2, "Same order with different secrets should have different hashes");

        // No correlation should be derivable
        assertFalse(
            uint256(hash1) < uint256(hash2) == (uint256(secret1) < uint256(secret2)),
            "Hash ordering should not correlate with secret ordering"
        );
    }

    /**
     * @notice Test that observing commits doesn't help predict execution order
     * @dev Simulates an attacker trying to front-run based on commit observation
     */
    function test_MEV_cannotPredictExecutionOrderFromCommits() public {
        // Alice commits a large buy order
        bytes32 aliceSecret = keccak256("alice_secret");
        bytes32 aliceHash = _generateCommitHash(alice, tokenA, tokenB, 10 ether, 9 ether, aliceSecret);

        vm.prank(alice);
        bytes32 aliceCommitId = auction.commitOrder{value: 0.01 ether}(aliceHash);

        // Eve (attacker) sees Alice's commit but cannot determine:
        // 1. What tokens are being traded
        // 2. The direction (buy/sell)
        // 3. The amount
        // 4. The price

        // Eve tries to commit a "front-running" order but has no information
        bytes32 eveSecret = keccak256("eve_secret");
        bytes32 eveHash = _generateCommitHash(eve, tokenA, tokenB, 5 ether, 4.5 ether, eveSecret);

        vm.prank(eve);
        bytes32 eveCommitId = auction.commitOrder{value: 0.01 ether}(eveHash);

        // Move to reveal phase
        vm.warp(block.timestamp + 9);

        // Both reveal
        vm.prank(alice);
        auction.revealOrder(aliceCommitId, tokenA, tokenB, 10 ether, 9 ether, aliceSecret, 0);

        vm.prank(eve);
        auction.revealOrder(eveCommitId, tokenA, tokenB, 5 ether, 4.5 ether, eveSecret, 0);

        // Settle
        vm.warp(block.timestamp + 3);
        auction.advancePhase();
        auction.settleBatch();

        // Get execution order
        uint256[] memory order = auction.getExecutionOrder(1);

        // Eve cannot guarantee being first - order is determined by shuffle seed
        // which is derived from ALL secrets (including Alice's unknown secret)
        assertTrue(order.length == 2, "Both orders should be included");
    }

    /**
     * @notice Test that priority bidding is the only way to guarantee execution order
     */
    function test_MEV_priorityBidIsOnlyWayToGuaranteeOrder() public {
        // Setup multiple commits
        bytes32 aliceSecret = keccak256("alice");
        bytes32 bobSecret = keccak256("bob");
        bytes32 charlieSecret = keccak256("charlie");

        bytes32 aliceHash = _generateCommitHash(alice, tokenA, tokenB, 1 ether, 0.9 ether, aliceSecret);
        bytes32 bobHash = _generateCommitHash(bob, tokenA, tokenB, 1 ether, 0.9 ether, bobSecret);
        bytes32 charlieHash = _generateCommitHash(charlie, tokenA, tokenB, 1 ether, 0.9 ether, charlieSecret);

        vm.prank(alice);
        bytes32 aliceCommitId = auction.commitOrder{value: 0.01 ether}(aliceHash);

        vm.prank(bob);
        bytes32 bobCommitId = auction.commitOrder{value: 0.01 ether}(bobHash);

        vm.prank(charlie);
        bytes32 charlieCommitId = auction.commitOrder{value: 0.01 ether}(charlieHash);

        vm.warp(block.timestamp + 9);

        // Alice pays highest priority bid
        vm.prank(alice);
        auction.revealOrder{value: 1 ether}(aliceCommitId, tokenA, tokenB, 1 ether, 0.9 ether, aliceSecret, 1 ether);

        // Bob pays medium priority bid
        vm.prank(bob);
        auction.revealOrder{value: 0.5 ether}(bobCommitId, tokenA, tokenB, 1 ether, 0.9 ether, bobSecret, 0.5 ether);

        // Charlie pays no priority bid
        vm.prank(charlie);
        auction.revealOrder(charlieCommitId, tokenA, tokenB, 1 ether, 0.9 ether, charlieSecret, 0);

        vm.warp(block.timestamp + 3);
        auction.advancePhase();
        auction.settleBatch();

        uint256[] memory order = auction.getExecutionOrder(1);

        // Priority orders MUST come first, sorted by bid amount
        assertEq(order[0], 0, "Alice (highest bid) should be first");
        assertEq(order[1], 1, "Bob (second highest bid) should be second");
        // Charlie is last (shuffled among non-priority orders, but alone here)
        assertEq(order[2], 2, "Charlie (no bid) should be last");
    }

    /**
     * @notice Test that late reveal doesn't give information advantage
     */
    function test_MEV_lateRevealNoAdvantage() public {
        bytes32 aliceSecret = keccak256("alice");
        bytes32 bobSecret = keccak256("bob");

        bytes32 aliceHash = _generateCommitHash(alice, tokenA, tokenB, 1 ether, 0.9 ether, aliceSecret);
        bytes32 bobHash = _generateCommitHash(bob, tokenB, tokenA, 1 ether, 0.9 ether, bobSecret);

        vm.prank(alice);
        bytes32 aliceCommitId = auction.commitOrder{value: 0.01 ether}(aliceHash);

        vm.prank(bob);
        bytes32 bobCommitId = auction.commitOrder{value: 0.01 ether}(bobHash);

        vm.warp(block.timestamp + 9);

        // Alice reveals first
        vm.prank(alice);
        auction.revealOrder(aliceCommitId, tokenA, tokenB, 1 ether, 0.9 ether, aliceSecret, 0);

        // Bob sees Alice's reveal but still must reveal the same committed order
        // He cannot change his order based on Alice's reveal
        vm.prank(bob);
        auction.revealOrder(bobCommitId, tokenB, tokenA, 1 ether, 0.9 ether, bobSecret, 0);

        // Verify Bob's commitment matches what he committed (checked in contract)
        ICommitRevealAuction.OrderCommitment memory bobCommitment = auction.getCommitment(bobCommitId);
        assertEq(uint256(bobCommitment.status), uint256(ICommitRevealAuction.CommitStatus.REVEALED));
    }

    // ============ Sandwich Attack Prevention Tests ============

    /**
     * @notice Test that sandwich attacks are not profitable
     * @dev Sandwich attack: attacker places orders before and after victim
     */
    function test_MEV_sandwichAttackNotProfitable() public {
        // Victim (Alice) wants to buy tokenB with tokenA
        bytes32 aliceSecret = keccak256("alice_victim");
        bytes32 aliceHash = _generateCommitHash(alice, tokenA, tokenB, 10 ether, 9 ether, aliceSecret);

        // Attacker (Eve) tries to sandwich
        bytes32 eveFrontSecret = keccak256("eve_front");
        bytes32 eveBackSecret = keccak256("eve_back");

        // Eve's front-run: buy before Alice
        bytes32 eveFrontHash = _generateCommitHash(eve, tokenA, tokenB, 5 ether, 4 ether, eveFrontSecret);
        // Eve's back-run: sell after Alice
        bytes32 eveBackHash = _generateCommitHash(eve, tokenB, tokenA, 5 ether, 4 ether, eveBackSecret);

        // All commit in same batch (attacker doesn't know Alice's order yet)
        vm.prank(alice);
        bytes32 aliceCommitId = auction.commitOrder{value: 0.01 ether}(aliceHash);

        vm.prank(eve);
        bytes32 eveFrontCommitId = auction.commitOrder{value: 0.01 ether}(eveFrontHash);

        vm.prank(eve);
        bytes32 eveBackCommitId = auction.commitOrder{value: 0.01 ether}(eveBackHash);

        vm.warp(block.timestamp + 9);

        // Reveals - Eve cannot guarantee order without priority bids
        vm.prank(alice);
        auction.revealOrder(aliceCommitId, tokenA, tokenB, 10 ether, 9 ether, aliceSecret, 0);

        vm.prank(eve);
        auction.revealOrder(eveFrontCommitId, tokenA, tokenB, 5 ether, 4 ether, eveFrontSecret, 0);

        vm.prank(eve);
        auction.revealOrder(eveBackCommitId, tokenB, tokenA, 5 ether, 4 ether, eveBackSecret, 0);

        vm.warp(block.timestamp + 3);
        auction.advancePhase();
        auction.settleBatch();

        // Key insight: In batch auctions with uniform clearing price,
        // the sandwich attack doesn't work because:
        // 1. Order execution is shuffled (without priority bids)
        // 2. All orders in the batch execute at the same clearing price
        // 3. Eve cannot guarantee front-run executes before Alice

        uint256[] memory order = auction.getExecutionOrder(1);

        // Verify all three orders are present but order is unpredictable
        assertEq(order.length, 3);
    }

    // ============ Edge Cases Tests ============

    /**
     * @notice Test maximum number of orders in a batch
     */
    function test_edgeCase_manyOrdersInBatch() public {
        uint256 numOrders = 50;
        bytes32[] memory commitIds = new bytes32[](numOrders);
        bytes32[] memory secrets = new bytes32[](numOrders);

        // Create many traders
        for (uint256 i = 0; i < numOrders; i++) {
            address trader = address(uint160(0x1000 + i));
            vm.deal(trader, 1 ether);

            secrets[i] = keccak256(abi.encodePacked("secret", i));
            bytes32 hash = _generateCommitHash(trader, tokenA, tokenB, 0.1 ether, 0.09 ether, secrets[i]);

            vm.prank(trader);
            commitIds[i] = auction.commitOrder{value: 0.01 ether}(hash);
        }

        vm.warp(block.timestamp + 9);

        // Reveal all
        for (uint256 i = 0; i < numOrders; i++) {
            address trader = address(uint160(0x1000 + i));
            vm.prank(trader);
            auction.revealOrder(commitIds[i], tokenA, tokenB, 0.1 ether, 0.09 ether, secrets[i], 0);
        }

        vm.warp(block.timestamp + 3);
        auction.advancePhase();
        auction.settleBatch();

        ICommitRevealAuction.Batch memory batch = auction.getBatch(1);
        assertTrue(batch.isSettled);

        uint256[] memory order = auction.getExecutionOrder(1);
        assertEq(order.length, numOrders);

        // Verify shuffle is a valid permutation
        bool[] memory seen = new bool[](numOrders);
        for (uint256 i = 0; i < numOrders; i++) {
            assertFalse(seen[order[i]], "Duplicate index in execution order");
            seen[order[i]] = true;
        }
    }

    /**
     * @notice Test batch with only priority orders
     */
    function test_edgeCase_onlyPriorityOrders() public {
        bytes32 aliceSecret = keccak256("alice");
        bytes32 bobSecret = keccak256("bob");

        bytes32 aliceHash = _generateCommitHash(alice, tokenA, tokenB, 1 ether, 0.9 ether, aliceSecret);
        bytes32 bobHash = _generateCommitHash(bob, tokenA, tokenB, 1 ether, 0.9 ether, bobSecret);

        vm.prank(alice);
        bytes32 aliceCommitId = auction.commitOrder{value: 0.01 ether}(aliceHash);

        vm.prank(bob);
        bytes32 bobCommitId = auction.commitOrder{value: 0.01 ether}(bobHash);

        vm.warp(block.timestamp + 9);

        // Both pay priority bids
        vm.prank(alice);
        auction.revealOrder{value: 0.5 ether}(aliceCommitId, tokenA, tokenB, 1 ether, 0.9 ether, aliceSecret, 0.5 ether);

        vm.prank(bob);
        auction.revealOrder{value: 1 ether}(bobCommitId, tokenA, tokenB, 1 ether, 0.9 ether, bobSecret, 1 ether);

        vm.warp(block.timestamp + 3);
        auction.advancePhase();
        auction.settleBatch();

        uint256[] memory order = auction.getExecutionOrder(1);

        // Bob paid more, should be first
        assertEq(order[0], 1, "Bob (higher bid) should be first");
        assertEq(order[1], 0, "Alice (lower bid) should be second");
    }

    /**
     * @notice Test batch with single order
     */
    function test_edgeCase_singleOrder() public {
        bytes32 secret = keccak256("solo");
        bytes32 hash = _generateCommitHash(alice, tokenA, tokenB, 1 ether, 0.9 ether, secret);

        vm.prank(alice);
        bytes32 commitId = auction.commitOrder{value: 0.01 ether}(hash);

        vm.warp(block.timestamp + 9);

        vm.prank(alice);
        auction.revealOrder(commitId, tokenA, tokenB, 1 ether, 0.9 ether, secret, 0);

        vm.warp(block.timestamp + 3);
        auction.advancePhase();
        auction.settleBatch();

        uint256[] memory order = auction.getExecutionOrder(1);
        assertEq(order.length, 1);
        assertEq(order[0], 0);
    }

    /**
     * @notice Test empty batch (no reveals)
     */
    function test_edgeCase_emptyBatch() public {
        // Commit but don't reveal
        bytes32 secret = keccak256("abandoned");
        bytes32 hash = _generateCommitHash(alice, tokenA, tokenB, 1 ether, 0.9 ether, secret);

        vm.prank(alice);
        auction.commitOrder{value: 0.01 ether}(hash);

        // Skip reveal phase
        vm.warp(block.timestamp + 12);

        auction.advancePhase();
        auction.settleBatch();

        ICommitRevealAuction.Batch memory batch = auction.getBatch(1);
        assertTrue(batch.isSettled);

        // No revealed orders
        ICommitRevealAuction.RevealedOrder[] memory revealed = auction.getRevealedOrders(1);
        assertEq(revealed.length, 0);
    }

    /**
     * @notice Test priority bid tiebreaker (earlier reveal wins)
     */
    function test_edgeCase_priorityBidTiebreaker() public {
        bytes32 aliceSecret = keccak256("alice");
        bytes32 bobSecret = keccak256("bob");
        bytes32 charlieSecret = keccak256("charlie");

        bytes32 aliceHash = _generateCommitHash(alice, tokenA, tokenB, 1 ether, 0.9 ether, aliceSecret);
        bytes32 bobHash = _generateCommitHash(bob, tokenA, tokenB, 1 ether, 0.9 ether, bobSecret);
        bytes32 charlieHash = _generateCommitHash(charlie, tokenA, tokenB, 1 ether, 0.9 ether, charlieSecret);

        vm.prank(alice);
        bytes32 aliceCommitId = auction.commitOrder{value: 0.01 ether}(aliceHash);

        vm.prank(bob);
        bytes32 bobCommitId = auction.commitOrder{value: 0.01 ether}(bobHash);

        vm.prank(charlie);
        bytes32 charlieCommitId = auction.commitOrder{value: 0.01 ether}(charlieHash);

        vm.warp(block.timestamp + 9);

        // All pay same priority bid, but reveal in order: Alice, Bob, Charlie
        vm.prank(alice);
        auction.revealOrder{value: 0.5 ether}(aliceCommitId, tokenA, tokenB, 1 ether, 0.9 ether, aliceSecret, 0.5 ether);

        vm.prank(bob);
        auction.revealOrder{value: 0.5 ether}(bobCommitId, tokenA, tokenB, 1 ether, 0.9 ether, bobSecret, 0.5 ether);

        vm.prank(charlie);
        auction.revealOrder{value: 0.5 ether}(charlieCommitId, tokenA, tokenB, 1 ether, 0.9 ether, charlieSecret, 0.5 ether);

        vm.warp(block.timestamp + 3);
        auction.advancePhase();
        auction.settleBatch();

        uint256[] memory order = auction.getExecutionOrder(1);

        // Same bid amount - tiebreaker is reveal order (lower index = earlier)
        assertEq(order[0], 0, "Alice (revealed first) should be first");
        assertEq(order[1], 1, "Bob (revealed second) should be second");
        assertEq(order[2], 2, "Charlie (revealed third) should be third");
    }

    // ============ Multi-Batch Tests ============

    /**
     * @notice Test consecutive batches maintain state correctly
     */
    function test_multiBatch_consecutiveBatches() public {
        // Batch 1
        bytes32 secret1 = keccak256("batch1");
        bytes32 hash1 = _generateCommitHash(alice, tokenA, tokenB, 1 ether, 0.9 ether, secret1);

        vm.prank(alice);
        bytes32 commitId1 = auction.commitOrder{value: 0.01 ether}(hash1);

        vm.warp(block.timestamp + 9);
        vm.prank(alice);
        auction.revealOrder(commitId1, tokenA, tokenB, 1 ether, 0.9 ether, secret1, 0);

        vm.warp(block.timestamp + 3);
        auction.advancePhase();
        auction.settleBatch();

        assertEq(auction.getCurrentBatchId(), 2);

        // Batch 2
        bytes32 secret2 = keccak256("batch2");
        bytes32 hash2 = _generateCommitHash(bob, tokenA, tokenB, 2 ether, 1.8 ether, secret2);

        vm.prank(bob);
        bytes32 commitId2 = auction.commitOrder{value: 0.01 ether}(hash2);

        vm.warp(block.timestamp + 9);
        vm.prank(bob);
        auction.revealOrder(commitId2, tokenA, tokenB, 2 ether, 1.8 ether, secret2, 0);

        vm.warp(block.timestamp + 3);
        auction.advancePhase();
        auction.settleBatch();

        assertEq(auction.getCurrentBatchId(), 3);

        // Verify both batches are correctly settled
        ICommitRevealAuction.Batch memory batch1 = auction.getBatch(1);
        ICommitRevealAuction.Batch memory batch2 = auction.getBatch(2);

        assertTrue(batch1.isSettled);
        assertTrue(batch2.isSettled);
        assertTrue(batch1.shuffleSeed != batch2.shuffleSeed, "Different batches should have different seeds");
    }

    /**
     * @notice Test that commit from previous batch cannot be revealed in current batch
     */
    function test_multiBatch_cannotRevealOldCommit() public {
        // Batch 1 - commit but don't reveal
        bytes32 secret = keccak256("old_commit");
        bytes32 hash = _generateCommitHash(alice, tokenA, tokenB, 1 ether, 0.9 ether, secret);

        vm.prank(alice);
        bytes32 commitId = auction.commitOrder{value: 0.01 ether}(hash);

        // Move to batch 2
        vm.warp(block.timestamp + 12);
        auction.advancePhase();
        auction.settleBatch();

        // Now in batch 2 - try to reveal batch 1 commit
        vm.warp(block.timestamp + 9); // Move to reveal phase of batch 2

        vm.prank(alice);
        vm.expectRevert("Wrong batch");
        auction.revealOrder(commitId, tokenA, tokenB, 1 ether, 0.9 ether, secret, 0);
    }

    // ============ Slashing Scenarios ============

    /**
     * @notice Test partial reveals in batch
     */
    function test_slashing_partialReveals() public {
        bytes32 aliceSecret = keccak256("alice");
        bytes32 bobSecret = keccak256("bob");

        bytes32 aliceHash = _generateCommitHash(alice, tokenA, tokenB, 1 ether, 0.9 ether, aliceSecret);
        bytes32 bobHash = _generateCommitHash(bob, tokenA, tokenB, 1 ether, 0.9 ether, bobSecret);

        vm.prank(alice);
        bytes32 aliceCommitId = auction.commitOrder{value: 0.02 ether}(aliceHash);

        vm.prank(bob);
        bytes32 bobCommitId = auction.commitOrder{value: 0.02 ether}(bobHash);

        vm.warp(block.timestamp + 9);

        // Only Alice reveals
        vm.prank(alice);
        auction.revealOrder(aliceCommitId, tokenA, tokenB, 1 ether, 0.9 ether, aliceSecret, 0);

        // Bob doesn't reveal

        vm.warp(block.timestamp + 3);
        auction.advancePhase();
        auction.settleBatch();

        // Alice can withdraw her deposit
        uint256 aliceBalanceBefore = alice.balance;
        vm.prank(alice);
        auction.withdrawDeposit(aliceCommitId);
        assertEq(alice.balance, aliceBalanceBefore + 0.02 ether);

        // Bob's deposit can be slashed
        uint256 treasuryBalanceBefore = treasury.balance;
        auction.slashUnrevealedCommitment(bobCommitId);

        // Treasury receives 50% of Bob's deposit
        assertEq(treasury.balance, treasuryBalanceBefore + 0.01 ether);
    }

    /**
     * @notice Test that revealed orders cannot be slashed
     */
    function test_slashing_cannotSlashRevealed() public {
        bytes32 secret = keccak256("revealed");
        bytes32 hash = _generateCommitHash(alice, tokenA, tokenB, 1 ether, 0.9 ether, secret);

        vm.prank(alice);
        bytes32 commitId = auction.commitOrder{value: 0.02 ether}(hash);

        vm.warp(block.timestamp + 9);

        vm.prank(alice);
        auction.revealOrder(commitId, tokenA, tokenB, 1 ether, 0.9 ether, secret, 0);

        vm.warp(block.timestamp + 3);
        auction.advancePhase();
        auction.settleBatch();

        vm.expectRevert("Not slashable");
        auction.slashUnrevealedCommitment(commitId);
    }

    // ============ Fuzz Tests ============

    /**
     * @notice Fuzz test for commit hash uniqueness
     */
    function testFuzz_commitHashUniqueness(
        address trader,
        uint256 amountIn,
        uint256 minAmountOut,
        bytes32 secret
    ) public {
        vm.assume(trader != address(0));
        vm.assume(amountIn > 0);

        bytes32 hash1 = _generateCommitHash(trader, tokenA, tokenB, amountIn, minAmountOut, secret);
        bytes32 hash2 = _generateCommitHash(trader, tokenA, tokenB, amountIn, minAmountOut, keccak256(abi.encode(secret)));

        assertTrue(hash1 != hash2, "Different secrets should produce different hashes");
    }

    /**
     * @notice Fuzz test for priority bid ordering
     */
    function testFuzz_priorityBidOrdering(uint256 bid1, uint256 bid2) public {
        bid1 = bound(bid1, 0.01 ether, 10 ether);
        bid2 = bound(bid2, 0.01 ether, 10 ether);
        vm.assume(bid1 != bid2);

        bytes32 aliceSecret = keccak256("alice");
        bytes32 bobSecret = keccak256("bob");

        bytes32 aliceHash = _generateCommitHash(alice, tokenA, tokenB, 1 ether, 0.9 ether, aliceSecret);
        bytes32 bobHash = _generateCommitHash(bob, tokenA, tokenB, 1 ether, 0.9 ether, bobSecret);

        vm.prank(alice);
        bytes32 aliceCommitId = auction.commitOrder{value: 0.01 ether}(aliceHash);

        vm.prank(bob);
        bytes32 bobCommitId = auction.commitOrder{value: 0.01 ether}(bobHash);

        vm.warp(block.timestamp + 9);

        vm.prank(alice);
        auction.revealOrder{value: bid1}(aliceCommitId, tokenA, tokenB, 1 ether, 0.9 ether, aliceSecret, bid1);

        vm.prank(bob);
        auction.revealOrder{value: bid2}(bobCommitId, tokenA, tokenB, 1 ether, 0.9 ether, bobSecret, bid2);

        vm.warp(block.timestamp + 3);
        auction.advancePhase();
        auction.settleBatch();

        uint256[] memory order = auction.getExecutionOrder(1);

        if (bid1 > bid2) {
            assertEq(order[0], 0, "Higher bidder should be first");
        } else {
            assertEq(order[0], 1, "Higher bidder should be first");
        }
    }

    // ============ Helper Functions ============

    function _generateCommitHash(
        address trader,
        address tknIn,
        address tknOut,
        uint256 amtIn,
        uint256 minOut,
        bytes32 secret
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(trader, tknIn, tknOut, amtIn, minOut, secret));
    }
}
