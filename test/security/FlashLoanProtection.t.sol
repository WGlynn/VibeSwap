// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/core/CommitRevealAuction.sol";
import "../../contracts/core/interfaces/ICommitRevealAuction.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Attacker Contracts ============

/**
 * @title SameBlockAttacker
 * @notice Attempts to commit and reveal in the same block (same tx).
 *         This simulates the core flash loan attack: borrow funds, commit,
 *         immediately reveal, then repay — all atomically.
 */
contract SameBlockAttacker {
    CommitRevealAuction public auction;
    bool public attackSucceeded;

    constructor(address _auction) {
        auction = CommitRevealAuction(payable(_auction));
    }

    /// @notice Attempt to commit and then immediately commit again in the same tx
    ///         The second commit should revert with FlashLoanDetected
    function attemptDoubleCommit(
        bytes32 commitHash1,
        bytes32 commitHash2
    ) external payable {
        // First commit succeeds
        auction.commitOrder{value: msg.value / 2}(commitHash1);

        // Second commit in same block should revert
        try auction.commitOrder{value: msg.value / 2}(commitHash2) {
            attackSucceeded = true; // BAD: attack succeeded
        } catch {
            attackSucceeded = false; // GOOD: blocked by same-block guard
        }
    }

    /// @notice Attempt to commit, then withdraw deposit in the same tx
    ///         Simulates: flash loan -> commit (lock funds) -> withdraw -> repay
    function attemptCommitAndWithdraw(bytes32 commitHash) external payable {
        bytes32 commitId = auction.commitOrder{value: msg.value}(commitHash);

        // Try to withdraw the deposit immediately (same block)
        // This should fail because batch hasn't settled
        try auction.withdrawDeposit(commitId) {
            attackSucceeded = true; // BAD: got funds back in same tx
        } catch {
            attackSucceeded = false; // GOOD: cannot withdraw unsettled batch
        }
    }

    receive() external payable {}
}

/**
 * @title FlashLoanSimulator
 * @notice Simulates a flash loan provider that funds an attacker contract
 *         to commit with borrowed ETH, attempting to manipulate the batch.
 */
contract FlashLoanSimulator {
    /// @notice Execute flash loan attack: lend ETH, attacker commits, expects repayment
    function executeFlashLoanAttack(
        address payable attacker,
        bytes calldata attackCalldata
    ) external payable {
        uint256 balanceBefore = address(this).balance;

        // "Lend" ETH to attacker
        (bool sent,) = attacker.call{value: msg.value}("");
        require(sent, "Failed to send ETH");

        // Execute attack
        (bool success,) = attacker.call(attackCalldata);
        require(success, "Attack call failed");

        // Verify repayment (flash loan invariant)
        require(
            address(this).balance >= balanceBefore,
            "Flash loan not repaid"
        );
    }

    receive() external payable {}
}

/**
 * @title FlashLoanBorrower
 * @notice Attacker that borrows via flash loan, commits to auction, then
 *         tries to extract funds before repaying the loan.
 *         The same-block guard prevents any follow-up interaction.
 */
contract FlashLoanBorrower {
    CommitRevealAuction public auction;
    bool public commitSucceeded;
    bool public secondActionBlocked;

    constructor(address _auction) {
        auction = CommitRevealAuction(payable(_auction));
    }

    /// @notice Called by FlashLoanSimulator: commit with borrowed funds,
    ///         then try to interact again in the same block
    function attackCommitTwice(
        bytes32 commitHash1,
        bytes32 commitHash2
    ) external payable {
        // Commit with borrowed funds
        auction.commitOrder{value: msg.value / 2}(commitHash1);
        commitSucceeded = true;

        // Try second commit — should be blocked by same-block guard
        try auction.commitOrder{value: msg.value / 2}(commitHash2) {
            secondActionBlocked = false; // BAD
        } catch {
            secondActionBlocked = true; // GOOD: flash loan attack mitigated
        }

        // Return remaining ETH to flash loan provider
        (bool sent,) = msg.sender.call{value: address(this).balance}("");
        require(sent, "Repay failed");
    }

    receive() external payable {}
}

/**
 * @title RapidFireAttacker
 * @notice Attempts rapid-fire commits from the same address in the same block.
 *         The same-block interaction guard (lastInteractionBlock) acts as a
 *         per-block cooldown: only one commit per address per block.
 */
contract RapidFireAttacker {
    CommitRevealAuction public auction;
    uint256 public successfulCommits;

    constructor(address _auction) {
        auction = CommitRevealAuction(payable(_auction));
    }

    /// @notice Try to commit N times in the same block
    function attemptRapidCommits(
        bytes32[] calldata commitHashes,
        uint256 depositPerCommit
    ) external payable {
        successfulCommits = 0;

        for (uint256 i = 0; i < commitHashes.length; i++) {
            try auction.commitOrder{value: depositPerCommit}(commitHashes[i]) {
                successfulCommits++;
            } catch {
                // Blocked by same-block guard after first commit
            }
        }
    }

    receive() external payable {}
}

// ============ Test Contract ============

/**
 * @title FlashLoanProtectionTest
 * @author Faraday1 & JARVIS — vibeswap.org
 * @notice Proves the CommitRevealAuction's flash loan protection mechanisms:
 *         1. Same-block interaction guard blocks commit+reveal in one block
 *         2. Contract callers are blocked by the same-block guard equally
 *         3. Flash loan attackers cannot manipulate batches
 *         4. Per-block cooldown prevents rapid-fire commits from the same user
 *
 * @dev The core protection is `lastInteractionBlock[msg.sender] == block.number`
 *      in commitOrderToPool(). This single check defeats multiple attack vectors:
 *      - Flash loan borrow+commit+withdraw in one tx
 *      - Rapid-fire commit spam to dominate a batch
 *      - Contract-based batch manipulation
 */
contract FlashLoanProtectionTest is Test {
    CommitRevealAuction public auction;

    address public owner;
    address public treasury;
    address public trader1;
    address public trader2;

    address public tokenA;
    address public tokenB;

    // ============ Setup ============

    function setUp() public {
        owner = address(this);
        treasury = makeAddr("treasury");
        trader1 = makeAddr("trader1");
        trader2 = makeAddr("trader2");
        tokenA = makeAddr("tokenA");
        tokenB = makeAddr("tokenB");

        // Deploy implementation + proxy (UUPS pattern)
        CommitRevealAuction impl = new CommitRevealAuction();
        bytes memory initData = abi.encodeWithSelector(
            CommitRevealAuction.initialize.selector,
            owner,
            treasury,
            address(0) // No compliance registry for these tests
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        auction = CommitRevealAuction(payable(address(proxy)));

        // Authorize this test contract as settler
        auction.setAuthorizedSettler(address(this), true);

        // Fund traders
        vm.deal(trader1, 100 ether);
        vm.deal(trader2, 100 ether);
    }

    // ============ Test 1: Same-Block Commit Guard ============

    /// @notice Proves a user cannot commit twice in the same block.
    ///         This is the foundation of flash loan protection: if you can only
    ///         interact once per block, you cannot borrow+commit+withdraw atomically.
    function test_sameBlockDoubleCommit_reverts() public {
        bytes32 secret1 = keccak256("secret1");
        bytes32 secret2 = keccak256("secret2");
        bytes32 commitHash1 = _generateCommitHash(trader1, tokenA, tokenB, 1 ether, 0.9 ether, secret1);
        bytes32 commitHash2 = _generateCommitHash(trader1, tokenA, tokenB, 2 ether, 1.8 ether, secret2);

        vm.startPrank(trader1);

        // First commit succeeds
        auction.commitOrder{value: 0.01 ether}(commitHash1);

        // Second commit in same block reverts with FlashLoanDetected
        vm.expectRevert(CommitRevealAuction.FlashLoanDetected.selector);
        auction.commitOrder{value: 0.01 ether}(commitHash2);

        vm.stopPrank();
    }

    /// @notice Proves the same-block guard resets across blocks.
    ///         After advancing one block, the same user CAN commit again.
    function test_differentBlockCommits_succeed() public {
        bytes32 secret1 = keccak256("secret1");
        bytes32 secret2 = keccak256("secret2");
        bytes32 commitHash1 = _generateCommitHash(trader1, tokenA, tokenB, 1 ether, 0.9 ether, secret1);
        bytes32 commitHash2 = _generateCommitHash(trader1, tokenA, tokenB, 2 ether, 1.8 ether, secret2);

        vm.prank(trader1);
        auction.commitOrder{value: 0.01 ether}(commitHash1);

        // Advance one block (same timestamp to stay in COMMIT phase)
        vm.roll(block.number + 1);

        vm.prank(trader1);
        // Second commit succeeds because it's a different block
        auction.commitOrder{value: 0.01 ether}(commitHash2);

        // Verify both commits recorded
        ICommitRevealAuction.Batch memory batch = auction.getBatch(1);
        assertEq(batch.orderCount, 2, "Both commits should be recorded");
    }

    /// @notice Proves two DIFFERENT users CAN commit in the same block.
    ///         The guard is per-address, not per-block globally.
    function test_differentUsersSameBlock_succeed() public {
        bytes32 secret1 = keccak256("secret1");
        bytes32 secret2 = keccak256("secret2");
        bytes32 commitHash1 = _generateCommitHash(trader1, tokenA, tokenB, 1 ether, 0.9 ether, secret1);
        bytes32 commitHash2 = _generateCommitHash(trader2, tokenA, tokenB, 2 ether, 1.8 ether, secret2);

        vm.prank(trader1);
        auction.commitOrder{value: 0.01 ether}(commitHash1);

        vm.prank(trader2);
        auction.commitOrder{value: 0.01 ether}(commitHash2);

        ICommitRevealAuction.Batch memory batch = auction.getBatch(1);
        assertEq(batch.orderCount, 2, "Both users should commit successfully");
    }

    // ============ Test 2: Contract Caller Restrictions ============

    /// @notice Proves a contract can commit (once per block) but is subject
    ///         to the same-block guard. The guard prevents any contract from
    ///         performing atomic commit+withdraw (flash loan pattern).
    function test_contractCanCommitOnce_butBlockedOnSecond() public {
        SameBlockAttacker attacker = new SameBlockAttacker(address(auction));
        vm.deal(address(attacker), 10 ether);

        bytes32 secret1 = keccak256("secret1");
        bytes32 secret2 = keccak256("secret2");
        bytes32 commitHash1 = _generateCommitHash(
            address(attacker), tokenA, tokenB, 1 ether, 0.9 ether, secret1
        );
        bytes32 commitHash2 = _generateCommitHash(
            address(attacker), tokenA, tokenB, 2 ether, 1.8 ether, secret2
        );

        // Contract attempts double commit in one tx
        attacker.attemptDoubleCommit{value: 2 ether}(commitHash1, commitHash2);

        // Second commit should have been blocked
        assertFalse(attacker.attackSucceeded(), "Double commit should be blocked by same-block guard");
    }

    /// @notice Proves a contract cannot commit and then withdraw in the same tx.
    ///         This blocks the flash loan pattern: borrow -> commit -> withdraw -> repay.
    function test_contractCannotCommitAndWithdrawSameTx() public {
        SameBlockAttacker attacker = new SameBlockAttacker(address(auction));
        vm.deal(address(attacker), 10 ether);

        bytes32 secret = keccak256("secret");
        bytes32 commitHash = _generateCommitHash(
            address(attacker), tokenA, tokenB, 1 ether, 0.9 ether, secret
        );

        attacker.attemptCommitAndWithdraw{value: 1 ether}(commitHash);

        // Withdrawal should have failed (batch not settled)
        assertFalse(attacker.attackSucceeded(), "Commit+withdraw in same tx should be blocked");
    }

    /// @notice Proves EOA users are protected by the same per-block guard.
    ///         Even if an EOA sends two txs that get included in the same block,
    ///         only the first succeeds.
    function test_EOA_sameBlockDoubleCommit_reverts() public {
        bytes32 secret1 = keccak256("secret1");
        bytes32 secret2 = keccak256("secret2");
        bytes32 commitHash1 = _generateCommitHash(trader1, tokenA, tokenB, 1 ether, 0.9 ether, secret1);
        bytes32 commitHash2 = _generateCommitHash(trader1, tokenA, tokenB, 2 ether, 1.8 ether, secret2);

        // Simulate two txs from same EOA included in same block
        vm.prank(trader1);
        auction.commitOrder{value: 0.01 ether}(commitHash1);

        // Same block, same user — blocked
        vm.prank(trader1);
        vm.expectRevert(CommitRevealAuction.FlashLoanDetected.selector);
        auction.commitOrder{value: 0.01 ether}(commitHash2);
    }

    // ============ Test 3: Flash Loan Attack Simulation ============

    /// @notice Full flash loan attack simulation: a flash loan provider lends ETH
    ///         to a borrower contract, which commits to the auction. The borrower
    ///         then tries a second commit (or any follow-up action) but is blocked.
    function test_flashLoanAttack_secondCommitBlocked() public {
        FlashLoanSimulator flashLender = new FlashLoanSimulator();
        FlashLoanBorrower borrower = new FlashLoanBorrower(address(auction));

        vm.deal(address(flashLender), 100 ether);

        bytes32 secret1 = keccak256("secret1");
        bytes32 secret2 = keccak256("secret2");
        bytes32 commitHash1 = _generateCommitHash(
            address(borrower), tokenA, tokenB, 1 ether, 0.9 ether, secret1
        );
        bytes32 commitHash2 = _generateCommitHash(
            address(borrower), tokenA, tokenB, 2 ether, 1.8 ether, secret2
        );

        // Execute the flash loan attack
        bytes memory attackCalldata = abi.encodeWithSelector(
            FlashLoanBorrower.attackCommitTwice.selector,
            commitHash1,
            commitHash2
        );

        flashLender.executeFlashLoanAttack{value: 10 ether}(
            payable(address(borrower)),
            attackCalldata
        );

        // Verify: first commit worked, second was blocked
        assertTrue(borrower.commitSucceeded(), "First commit should succeed");
        assertTrue(borrower.secondActionBlocked(), "Second action in same block must be blocked");

        // The attacker only got ONE commit, not the batch-dominating many they wanted
        ICommitRevealAuction.Batch memory batch = auction.getBatch(1);
        assertEq(batch.orderCount, 1, "Only one commit should exist from attacker");
    }

    /// @notice Proves that a flash loan attacker's committed funds are LOCKED.
    ///         Even with one successful commit, the deposit cannot be recovered
    ///         until the batch settles and the order is properly revealed.
    ///         The attacker cannot repay the flash loan from the deposit.
    function test_flashLoanAttacker_fundsLocked() public {
        FlashLoanBorrower borrower = new FlashLoanBorrower(address(auction));
        vm.deal(address(borrower), 10 ether);

        bytes32 secret = keccak256("secret");
        bytes32 commitHash = _generateCommitHash(
            address(borrower), tokenA, tokenB, 1 ether, 0.9 ether, secret
        );

        // Borrower commits
        vm.prank(address(borrower));
        bytes32 commitId = auction.commitOrder{value: 1 ether}(commitHash);

        // Deposit is locked — cannot withdraw before settlement
        vm.prank(address(borrower));
        vm.expectRevert(CommitRevealAuction.NotRevealed.selector);
        auction.withdrawDeposit(commitId);

        // Verify commitment exists and funds are in the auction contract
        ICommitRevealAuction.OrderCommitment memory commitment = auction.getCommitment(commitId);
        assertEq(commitment.depositAmount, 1 ether, "Deposit should be locked");
        assertEq(
            uint256(commitment.status),
            uint256(ICommitRevealAuction.CommitStatus.COMMITTED),
            "Status should be COMMITTED"
        );
    }

    /// @notice Proves that even if a flash loan attacker commits successfully,
    ///         failing to reveal results in 50% slashing of the deposit.
    ///         The attacker loses half their borrowed funds — a devastating penalty.
    function test_flashLoanAttacker_slashedIfNoReveal() public {
        // Attacker commits
        vm.prank(trader1);
        bytes32 secret = keccak256("secret");
        bytes32 commitHash = _generateCommitHash(trader1, tokenA, tokenB, 1 ether, 0.9 ether, secret);
        bytes32 commitId = auction.commitOrder{value: 1 ether}(commitHash);

        // Advance to SETTLING phase (past commit + reveal)
        vm.warp(block.timestamp + auction.BATCH_DURATION() + 1);

        // Settle the batch
        auction.settleBatch();

        // Anyone can slash the unrevealed commitment
        uint256 treasuryBalBefore = treasury.balance;

        auction.slashUnrevealedCommitment(commitId);

        // 50% slashed to treasury (SLASH_RATE_BPS = 5000)
        uint256 slashAmount = (1 ether * 5000) / 10000; // 0.5 ether
        assertEq(
            treasury.balance - treasuryBalBefore,
            slashAmount,
            "Treasury should receive 50% slash"
        );

        // Commitment is now SLASHED — funds partially lost
        ICommitRevealAuction.OrderCommitment memory commitment = auction.getCommitment(commitId);
        assertEq(
            uint256(commitment.status),
            uint256(ICommitRevealAuction.CommitStatus.SLASHED),
            "Status should be SLASHED"
        );
    }

    // ============ Test 4: Per-Block Cooldown (Rapid-Fire Prevention) ============

    /// @notice Proves the same-block guard acts as a per-block cooldown.
    ///         A contract attempting N rapid-fire commits in one block
    ///         can only land exactly ONE.
    function test_rapidFireCommits_onlyFirstSucceeds() public {
        RapidFireAttacker attacker = new RapidFireAttacker(address(auction));
        vm.deal(address(attacker), 100 ether);

        // Generate 5 unique commit hashes
        bytes32[] memory hashes = new bytes32[](5);
        for (uint256 i = 0; i < 5; i++) {
            bytes32 secret = keccak256(abi.encodePacked("rapid_secret_", i));
            hashes[i] = _generateCommitHash(
                address(attacker), tokenA, tokenB,
                (i + 1) * 1 ether, (i + 1) * 0.9 ether, secret
            );
        }

        // Attempt 5 rapid-fire commits
        attacker.attemptRapidCommits{value: 50 ether}(hashes, 0.01 ether);

        // Only the first should succeed
        assertEq(attacker.successfulCommits(), 1, "Only first rapid-fire commit should succeed");

        // Batch should only have 1 order
        ICommitRevealAuction.Batch memory batch = auction.getBatch(1);
        assertEq(batch.orderCount, 1, "Batch should have exactly 1 order from rapid-fire attempt");
    }

    /// @notice Proves the cooldown resets each block, allowing legitimate users
    ///         to commit once per block without penalty.
    function test_cooldownResetsPerBlock() public {
        bytes32[] memory commitIds = new bytes32[](3);

        for (uint256 i = 0; i < 3; i++) {
            bytes32 secret = keccak256(abi.encodePacked("cooldown_", i));
            bytes32 commitHash = _generateCommitHash(
                trader1, tokenA, tokenB,
                (i + 1) * 1 ether, (i + 1) * 0.9 ether, secret
            );

            vm.prank(trader1);
            commitIds[i] = auction.commitOrder{value: 0.01 ether}(commitHash);

            // Advance one block (stay within COMMIT phase)
            vm.roll(block.number + 1);
        }

        // All 3 commits should succeed (one per block)
        ICommitRevealAuction.Batch memory batch = auction.getBatch(1);
        assertEq(batch.orderCount, 3, "Three commits in three blocks should all succeed");

        // Verify each commitment is valid
        for (uint256 i = 0; i < 3; i++) {
            ICommitRevealAuction.OrderCommitment memory c = auction.getCommitment(commitIds[i]);
            assertEq(
                uint256(c.status),
                uint256(ICommitRevealAuction.CommitStatus.COMMITTED),
                "Each commitment should be in COMMITTED status"
            );
        }
    }

    /// @notice Proves the same-block guard tracks per-user independently.
    ///         User A committing does not block User B in the same block.
    function test_cooldownPerUser_notGlobal() public {
        address trader3 = makeAddr("trader3");
        address trader4 = makeAddr("trader4");
        vm.deal(trader3, 10 ether);
        vm.deal(trader4, 10 ether);

        bytes32 secret1 = keccak256("user3_secret");
        bytes32 secret2 = keccak256("user4_secret");
        bytes32 commitHash1 = _generateCommitHash(trader3, tokenA, tokenB, 1 ether, 0.9 ether, secret1);
        bytes32 commitHash2 = _generateCommitHash(trader4, tokenA, tokenB, 1 ether, 0.9 ether, secret2);

        // Both commit in the same block
        vm.prank(trader3);
        auction.commitOrder{value: 0.01 ether}(commitHash1);

        vm.prank(trader4);
        auction.commitOrder{value: 0.01 ether}(commitHash2);

        // But each is blocked from a second commit in that same block
        bytes32 secret3 = keccak256("user3_secret2");
        bytes32 commitHash3 = _generateCommitHash(trader3, tokenA, tokenB, 2 ether, 1.8 ether, secret3);

        vm.prank(trader3);
        vm.expectRevert(CommitRevealAuction.FlashLoanDetected.selector);
        auction.commitOrder{value: 0.01 ether}(commitHash3);

        bytes32 secret4 = keccak256("user4_secret2");
        bytes32 commitHash4 = _generateCommitHash(trader4, tokenA, tokenB, 2 ether, 1.8 ether, secret4);

        vm.prank(trader4);
        vm.expectRevert(CommitRevealAuction.FlashLoanDetected.selector);
        auction.commitOrder{value: 0.01 ether}(commitHash4);
    }

    /// @notice Proves lastInteractionBlock is updated on commit, providing
    ///         verifiable on-chain evidence of the guard state.
    function test_lastInteractionBlockUpdated() public {
        uint256 blockBefore = auction.lastInteractionBlock(trader1);
        assertEq(blockBefore, 0, "Should start at zero");

        vm.prank(trader1);
        bytes32 secret = keccak256("secret");
        bytes32 commitHash = _generateCommitHash(trader1, tokenA, tokenB, 1 ether, 0.9 ether, secret);
        auction.commitOrder{value: 0.01 ether}(commitHash);

        uint256 blockAfter = auction.lastInteractionBlock(trader1);
        assertEq(blockAfter, block.number, "Should be updated to current block");
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
