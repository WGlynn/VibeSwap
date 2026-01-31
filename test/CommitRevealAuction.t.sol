// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/core/CommitRevealAuction.sol";
import "../contracts/libraries/DeterministicShuffle.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract CommitRevealAuctionTest is Test {
    CommitRevealAuction public auction;
    address public owner;
    address public treasury;
    address public trader1;
    address public trader2;
    address public trader3;

    address public tokenA;
    address public tokenB;

    event OrderCommitted(
        bytes32 indexed commitId,
        address indexed trader,
        uint64 indexed batchId,
        uint256 depositAmount
    );

    event OrderRevealed(
        bytes32 indexed commitId,
        address indexed trader,
        uint64 indexed batchId,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 priorityBid
    );

    event BatchSettled(
        uint64 indexed batchId,
        uint256 orderCount,
        uint256 totalPriorityBids,
        bytes32 shuffleSeed
    );

    function setUp() public {
        owner = address(this);
        treasury = makeAddr("treasury");
        trader1 = makeAddr("trader1");
        trader2 = makeAddr("trader2");
        trader3 = makeAddr("trader3");
        tokenA = makeAddr("tokenA");
        tokenB = makeAddr("tokenB");

        // Deploy implementation
        CommitRevealAuction impl = new CommitRevealAuction();

        // Deploy proxy
        bytes memory initData = abi.encodeWithSelector(
            CommitRevealAuction.initialize.selector,
            owner,
            treasury
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        auction = CommitRevealAuction(payable(address(proxy)));

        // Authorize this contract as settler
        auction.setAuthorizedSettler(address(this), true);

        // Fund traders
        vm.deal(trader1, 10 ether);
        vm.deal(trader2, 10 ether);
        vm.deal(trader3, 10 ether);
    }

    // ============ Initialization Tests ============

    function test_initialization() public view {
        assertEq(auction.treasury(), treasury);
        assertEq(auction.getCurrentBatchId(), 1);
        assertEq(uint256(auction.getCurrentPhase()), uint256(ICommitRevealAuction.BatchPhase.COMMIT));
    }

    // ============ Commit Phase Tests ============

    function test_commitOrder() public {
        bytes32 secret = keccak256("secret1");
        bytes32 commitHash = _generateCommitHash(trader1, tokenA, tokenB, 1 ether, 0.9 ether, secret);

        vm.prank(trader1);
        vm.expectEmit(false, true, true, true);
        emit OrderCommitted(bytes32(0), trader1, 1, 0.01 ether);

        bytes32 commitId = auction.commitOrder{value: 0.01 ether}(commitHash);

        ICommitRevealAuction.OrderCommitment memory commitment = auction.getCommitment(commitId);
        assertEq(commitment.commitHash, commitHash);
        assertEq(commitment.batchId, 1);
        assertEq(commitment.depositAmount, 0.01 ether);
        assertEq(commitment.depositor, trader1);
        assertEq(uint256(commitment.status), uint256(ICommitRevealAuction.CommitStatus.COMMITTED));
    }

    function test_commitOrder_insufficientDeposit() public {
        bytes32 commitHash = keccak256("hash");

        vm.prank(trader1);
        vm.expectRevert("Insufficient deposit");
        auction.commitOrder{value: 0.0001 ether}(commitHash);
    }

    function test_commitOrder_zeroHash() public {
        vm.prank(trader1);
        vm.expectRevert("Invalid hash");
        auction.commitOrder{value: 0.01 ether}(bytes32(0));
    }

    function test_commitOrder_wrongPhase() public {
        // Move to reveal phase
        vm.warp(block.timestamp + 9);

        bytes32 commitHash = keccak256("hash");

        vm.prank(trader1);
        vm.expectRevert("Invalid phase");
        auction.commitOrder{value: 0.01 ether}(commitHash);
    }

    // ============ Reveal Phase Tests ============

    function test_revealOrder() public {
        // Commit first
        bytes32 secret = keccak256("secret1");
        bytes32 commitHash = _generateCommitHash(trader1, tokenA, tokenB, 1 ether, 0.9 ether, secret);

        vm.prank(trader1);
        bytes32 commitId = auction.commitOrder{value: 0.01 ether}(commitHash);

        // Move to reveal phase
        vm.warp(block.timestamp + 9);

        // Reveal
        vm.prank(trader1);
        auction.revealOrder(
            commitId,
            tokenA,
            tokenB,
            1 ether,
            0.9 ether,
            secret,
            0 // no priority bid
        );

        ICommitRevealAuction.OrderCommitment memory commitment = auction.getCommitment(commitId);
        assertEq(uint256(commitment.status), uint256(ICommitRevealAuction.CommitStatus.REVEALED));
    }

    function test_revealOrder_withPriorityBid() public {
        bytes32 secret = keccak256("secret1");
        bytes32 commitHash = _generateCommitHash(trader1, tokenA, tokenB, 1 ether, 0.9 ether, secret);

        vm.prank(trader1);
        bytes32 commitId = auction.commitOrder{value: 0.01 ether}(commitHash);

        vm.warp(block.timestamp + 9);

        vm.prank(trader1);
        auction.revealOrder{value: 0.1 ether}(
            commitId,
            tokenA,
            tokenB,
            1 ether,
            0.9 ether,
            secret,
            0.1 ether // priority bid
        );

        ICommitRevealAuction.Batch memory batch = auction.getBatch(1);
        assertEq(batch.totalPriorityBids, 0.1 ether);
    }

    function test_revealOrder_invalidHash_slashes() public {
        bytes32 secret = keccak256("secret1");
        bytes32 commitHash = _generateCommitHash(trader1, tokenA, tokenB, 1 ether, 0.9 ether, secret);

        vm.prank(trader1);
        bytes32 commitId = auction.commitOrder{value: 0.01 ether}(commitHash);

        vm.warp(block.timestamp + 9);

        uint256 treasuryBalanceBefore = treasury.balance;

        // Reveal with wrong data
        vm.prank(trader1);
        auction.revealOrder(
            commitId,
            tokenA,
            tokenB,
            2 ether, // wrong amount
            0.9 ether,
            secret,
            0
        );

        // Check slashed
        ICommitRevealAuction.OrderCommitment memory commitment = auction.getCommitment(commitId);
        assertEq(uint256(commitment.status), uint256(ICommitRevealAuction.CommitStatus.SLASHED));

        // Treasury should receive slashed funds (50%)
        assertEq(treasury.balance, treasuryBalanceBefore + 0.005 ether);
    }

    function test_revealOrder_wrongPhase() public {
        bytes32 secret = keccak256("secret1");
        bytes32 commitHash = _generateCommitHash(trader1, tokenA, tokenB, 1 ether, 0.9 ether, secret);

        vm.prank(trader1);
        bytes32 commitId = auction.commitOrder{value: 0.01 ether}(commitHash);

        // Still in commit phase
        vm.prank(trader1);
        vm.expectRevert("Invalid phase");
        auction.revealOrder(commitId, tokenA, tokenB, 1 ether, 0.9 ether, secret, 0);
    }

    // ============ Settlement Tests ============

    function test_settleBatch() public {
        // Multiple commits
        bytes32 secret1 = keccak256("secret1");
        bytes32 secret2 = keccak256("secret2");
        bytes32 secret3 = keccak256("secret3");

        bytes32 commitHash1 = _generateCommitHash(trader1, tokenA, tokenB, 1 ether, 0.9 ether, secret1);
        bytes32 commitHash2 = _generateCommitHash(trader2, tokenA, tokenB, 2 ether, 1.8 ether, secret2);
        bytes32 commitHash3 = _generateCommitHash(trader3, tokenB, tokenA, 1.5 ether, 1.3 ether, secret3);

        vm.prank(trader1);
        bytes32 commitId1 = auction.commitOrder{value: 0.01 ether}(commitHash1);

        vm.prank(trader2);
        bytes32 commitId2 = auction.commitOrder{value: 0.01 ether}(commitHash2);

        vm.prank(trader3);
        bytes32 commitId3 = auction.commitOrder{value: 0.01 ether}(commitHash3);

        // Move to reveal phase
        vm.warp(block.timestamp + 9);

        // Reveals
        vm.prank(trader1);
        auction.revealOrder(commitId1, tokenA, tokenB, 1 ether, 0.9 ether, secret1, 0);

        vm.prank(trader2);
        auction.revealOrder{value: 0.05 ether}(commitId2, tokenA, tokenB, 2 ether, 1.8 ether, secret2, 0.05 ether);

        vm.prank(trader3);
        auction.revealOrder(commitId3, tokenB, tokenA, 1.5 ether, 1.3 ether, secret3, 0);

        // Move to settling phase
        vm.warp(block.timestamp + 3);

        // Settle
        auction.advancePhase();
        auction.settleBatch();

        ICommitRevealAuction.Batch memory batch = auction.getBatch(1);
        assertTrue(batch.isSettled);
        assertEq(uint256(batch.phase), uint256(ICommitRevealAuction.BatchPhase.SETTLED));
        assertTrue(batch.shuffleSeed != bytes32(0));

        // Verify new batch started
        assertEq(auction.getCurrentBatchId(), 2);
    }

    function test_getExecutionOrder() public {
        // Setup batch with priority and regular orders
        bytes32 secret1 = keccak256("secret1");
        bytes32 secret2 = keccak256("secret2");
        bytes32 secret3 = keccak256("secret3");

        bytes32 commitHash1 = _generateCommitHash(trader1, tokenA, tokenB, 1 ether, 0.9 ether, secret1);
        bytes32 commitHash2 = _generateCommitHash(trader2, tokenA, tokenB, 2 ether, 1.8 ether, secret2);
        bytes32 commitHash3 = _generateCommitHash(trader3, tokenB, tokenA, 1.5 ether, 1.3 ether, secret3);

        vm.prank(trader1);
        bytes32 commitId1 = auction.commitOrder{value: 0.01 ether}(commitHash1);

        vm.prank(trader2);
        bytes32 commitId2 = auction.commitOrder{value: 0.01 ether}(commitHash2);

        vm.prank(trader3);
        bytes32 commitId3 = auction.commitOrder{value: 0.01 ether}(commitHash3);

        vm.warp(block.timestamp + 9);

        // trader2 has highest priority bid
        vm.prank(trader1);
        auction.revealOrder(commitId1, tokenA, tokenB, 1 ether, 0.9 ether, secret1, 0);

        vm.prank(trader2);
        auction.revealOrder{value: 0.1 ether}(commitId2, tokenA, tokenB, 2 ether, 1.8 ether, secret2, 0.1 ether);

        vm.prank(trader3);
        auction.revealOrder{value: 0.05 ether}(commitId3, tokenB, tokenA, 1.5 ether, 1.3 ether, secret3, 0.05 ether);

        vm.warp(block.timestamp + 3);
        auction.advancePhase();
        auction.settleBatch();

        uint256[] memory order = auction.getExecutionOrder(1);

        // Priority orders first (trader2 has highest bid, then trader3)
        assertEq(order[0], 1); // trader2 (index 1, highest priority)
        assertEq(order[1], 2); // trader3 (index 2, second priority)
        // trader1 (index 0) comes last as regular order
        assertEq(order[2], 0);
    }

    // ============ Phase Timing Tests ============

    function test_phaseTransitions() public {
        // Initial phase is COMMIT
        assertEq(uint256(auction.getCurrentPhase()), uint256(ICommitRevealAuction.BatchPhase.COMMIT));

        // After 8 seconds, should be REVEAL
        vm.warp(block.timestamp + 8);
        assertEq(uint256(auction.getCurrentPhase()), uint256(ICommitRevealAuction.BatchPhase.REVEAL));

        // After 10 seconds total, should be SETTLING
        vm.warp(block.timestamp + 2);
        assertEq(uint256(auction.getCurrentPhase()), uint256(ICommitRevealAuction.BatchPhase.SETTLING));
    }

    function test_getTimeUntilPhaseChange() public view {
        uint256 timeLeft = auction.getTimeUntilPhaseChange();
        assertEq(timeLeft, 8); // Full commit phase remaining (8 seconds)
    }

    // ============ Deterministic Shuffle Tests ============

    function test_deterministicShuffle_consistency() public pure {
        bytes32[] memory secrets = new bytes32[](3);
        secrets[0] = keccak256("a");
        secrets[1] = keccak256("b");
        secrets[2] = keccak256("c");

        bytes32 seed = DeterministicShuffle.generateSeed(secrets);

        uint256[] memory shuffle1 = DeterministicShuffle.shuffle(5, seed);
        uint256[] memory shuffle2 = DeterministicShuffle.shuffle(5, seed);

        // Same seed should produce same shuffle
        for (uint256 i = 0; i < 5; i++) {
            assertEq(shuffle1[i], shuffle2[i]);
        }
    }

    function test_deterministicShuffle_differentSeeds() public pure {
        bytes32 seed1 = keccak256("seed1");
        bytes32 seed2 = keccak256("seed2");

        uint256[] memory shuffle1 = DeterministicShuffle.shuffle(10, seed1);
        uint256[] memory shuffle2 = DeterministicShuffle.shuffle(10, seed2);

        // Different seeds should (likely) produce different shuffles
        bool allSame = true;
        for (uint256 i = 0; i < 10; i++) {
            if (shuffle1[i] != shuffle2[i]) {
                allSame = false;
                break;
            }
        }
        assertFalse(allSame);
    }

    function test_deterministicShuffle_verifyShuffle() public pure {
        bytes32 seed = keccak256("test");
        uint256[] memory shuffled = DeterministicShuffle.shuffle(5, seed);

        assertTrue(DeterministicShuffle.verifyShuffle(5, shuffled, seed));
    }

    // ============ Slash Unrevealed Tests ============

    function test_slashUnrevealedCommitment() public {
        bytes32 secret = keccak256("secret1");
        bytes32 commitHash = _generateCommitHash(trader1, tokenA, tokenB, 1 ether, 0.9 ether, secret);

        vm.prank(trader1);
        bytes32 commitId = auction.commitOrder{value: 0.01 ether}(commitHash);

        // Move past reveal phase and settle without revealing
        vm.warp(block.timestamp + 12); // Past both commit and reveal phases

        auction.advancePhase();
        auction.settleBatch();

        uint256 treasuryBalanceBefore = treasury.balance;

        // Anyone can slash unrevealed commitments
        auction.slashUnrevealedCommitment(commitId);

        // Treasury should receive 50% of deposit
        assertEq(treasury.balance, treasuryBalanceBefore + 0.005 ether);

        // Commitment should be marked as slashed
        ICommitRevealAuction.OrderCommitment memory commitment = auction.getCommitment(commitId);
        assertEq(uint256(commitment.status), uint256(ICommitRevealAuction.CommitStatus.SLASHED));
    }

    function test_slashUnrevealedCommitment_cannotSlashRevealed() public {
        bytes32 secret = keccak256("secret1");
        bytes32 commitHash = _generateCommitHash(trader1, tokenA, tokenB, 1 ether, 0.9 ether, secret);

        vm.prank(trader1);
        bytes32 commitId = auction.commitOrder{value: 0.01 ether}(commitHash);

        vm.warp(block.timestamp + 9);

        vm.prank(trader1);
        auction.revealOrder(commitId, tokenA, tokenB, 1 ether, 0.9 ether, secret, 0);

        vm.warp(block.timestamp + 3);
        auction.advancePhase();
        auction.settleBatch();

        // Should fail because it was revealed
        vm.expectRevert("Not slashable");
        auction.slashUnrevealedCommitment(commitId);
    }

    function test_slashUnrevealedCommitment_cannotSlashBeforeSettlement() public {
        bytes32 secret = keccak256("secret1");
        bytes32 commitHash = _generateCommitHash(trader1, tokenA, tokenB, 1 ether, 0.9 ether, secret);

        vm.prank(trader1);
        bytes32 commitId = auction.commitOrder{value: 0.01 ether}(commitHash);

        // Try to slash before batch is settled
        vm.expectRevert("Batch not settled");
        auction.slashUnrevealedCommitment(commitId);
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
