// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/core/CommitRevealAuction.sol";
import "../../contracts/libraries/DeterministicShuffle.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract CommitRevealAuctionFuzzTest is Test {
    CommitRevealAuction public auction;

    address public owner;
    address public treasury;
    address public tokenA;
    address public tokenB;

    function setUp() public {
        owner = address(this);
        treasury = makeAddr("treasury");
        tokenA = makeAddr("tokenA");
        tokenB = makeAddr("tokenB");

        CommitRevealAuction impl = new CommitRevealAuction();
        bytes memory initData = abi.encodeWithSelector(
            CommitRevealAuction.initialize.selector,
            owner,
            treasury,
            address(0)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        auction = CommitRevealAuction(payable(address(proxy)));

        auction.setAuthorizedSettler(address(this), true);
    }

    // ============ Helpers ============

    function _generateCommitHash(
        address trader, address tknIn, address tknOut,
        uint256 amtIn, uint256 minOut, bytes32 secret
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(trader, tknIn, tknOut, amtIn, minOut, secret));
    }

    function _doCommit(address trader, bytes32 secret, uint256 amountIn, uint256 deposit) internal returns (bytes32) {
        bytes32 commitHash = _generateCommitHash(trader, tokenA, tokenB, amountIn, 0, secret);
        vm.prank(trader);
        return auction.commitOrder{value: deposit}(commitHash);
    }

    // ============ Fuzz: deposit >= MIN_DEPOSIT always accepted ============

    function testFuzz_depositAboveMinAccepted(uint256 deposit) public {
        deposit = bound(deposit, 0.001 ether, 10 ether);

        address trader = makeAddr("fuzzTrader");
        vm.deal(trader, deposit);

        bytes32 secret = keccak256(abi.encodePacked(deposit));
        bytes32 commitHash = _generateCommitHash(trader, tokenA, tokenB, 1 ether, 0, secret);

        vm.prank(trader);
        bytes32 commitId = auction.commitOrder{value: deposit}(commitHash);

        ICommitRevealAuction.OrderCommitment memory c = auction.getCommitment(commitId);
        assertEq(c.depositAmount, deposit);
        assertEq(uint8(c.status), uint8(ICommitRevealAuction.CommitStatus.COMMITTED));
    }

    // ============ Fuzz: deposit below MIN_DEPOSIT always reverts ============

    function testFuzz_depositBelowMinReverts(uint256 deposit) public {
        deposit = bound(deposit, 0, 0.001 ether - 1);

        address trader = makeAddr("fuzzTrader");
        vm.deal(trader, 1 ether);

        bytes32 commitHash = _generateCommitHash(trader, tokenA, tokenB, 1 ether, 0, bytes32("s"));

        vm.prank(trader);
        vm.expectRevert(CommitRevealAuction.InsufficientDeposit.selector);
        auction.commitOrder{value: deposit}(commitHash);
    }

    // ============ Fuzz: valid reveal preserves commitment ============

    function testFuzz_validRevealSucceeds(uint256 amountIn) public {
        amountIn = bound(amountIn, 1, 1000 ether);

        address trader = makeAddr("fuzzTrader");
        vm.deal(trader, 10 ether);

        bytes32 secret = keccak256(abi.encodePacked(amountIn));
        bytes32 commitHash = _generateCommitHash(trader, tokenA, tokenB, amountIn, 0, secret);

        vm.prank(trader);
        bytes32 commitId = auction.commitOrder{value: 0.01 ether}(commitHash);

        // Advance to REVEAL
        vm.warp(block.timestamp + 9);

        vm.prank(trader);
        auction.revealOrder(commitId, tokenA, tokenB, amountIn, 0, secret, 0);

        ICommitRevealAuction.OrderCommitment memory c = auction.getCommitment(commitId);
        assertEq(uint8(c.status), uint8(ICommitRevealAuction.CommitStatus.REVEALED));
    }

    // ============ Fuzz: invalid reveal slashes ============

    function testFuzz_invalidRevealSlashes(uint256 amountIn, uint256 wrongAmount) public {
        amountIn = bound(amountIn, 1 ether, 100 ether);
        wrongAmount = bound(wrongAmount, 1 ether, 100 ether);
        vm.assume(wrongAmount != amountIn);

        address trader = makeAddr("fuzzTrader");
        vm.deal(trader, 10 ether);

        bytes32 secret = bytes32("mysecret");
        bytes32 commitHash = _generateCommitHash(trader, tokenA, tokenB, amountIn, 0, secret);

        vm.prank(trader);
        bytes32 commitId = auction.commitOrder{value: 0.01 ether}(commitHash);

        vm.warp(block.timestamp + 9);

        // Reveal with wrong amount -> slashes (doesn't revert)
        vm.prank(trader);
        auction.revealOrder(commitId, tokenA, tokenB, wrongAmount, 0, secret, 0);

        ICommitRevealAuction.OrderCommitment memory c = auction.getCommitment(commitId);
        assertEq(uint8(c.status), uint8(ICommitRevealAuction.CommitStatus.SLASHED), "Invalid reveal should slash");
    }

    // ============ Fuzz: slash amount = 50% of deposit ============

    function testFuzz_slashAmountIs50Percent(uint256 deposit) public {
        deposit = bound(deposit, 0.001 ether, 5 ether);

        address trader = makeAddr("fuzzTrader");
        vm.deal(trader, deposit);

        bytes32 secret = bytes32("s1");
        bytes32 commitHash = _generateCommitHash(trader, tokenA, tokenB, 1 ether, 0, secret);

        vm.prank(trader);
        bytes32 commitId = auction.commitOrder{value: deposit}(commitHash);

        // Don't reveal - advance past reveal phase
        vm.warp(block.timestamp + 11);
        auction.advancePhase();
        auction.settleBatch();

        uint256 treasuryBefore = treasury.balance;

        auction.slashUnrevealedCommitment(commitId);

        uint256 slashed = treasury.balance - treasuryBefore;
        uint256 expected = (deposit * 5000) / 10000; // SLASH_RATE_BPS = 5000

        assertEq(slashed, expected, "Slash must be 50% of deposit");
    }

    // ============ Fuzz: priority bids accumulate correctly ============

    function testFuzz_priorityBidsAccumulate(uint256 bid1, uint256 bid2) public {
        bid1 = bound(bid1, 0, 1 ether);
        bid2 = bound(bid2, 0, 1 ether);

        address t1 = makeAddr("t1");
        address t2 = makeAddr("t2");
        vm.deal(t1, 10 ether);
        vm.deal(t2, 10 ether);

        bytes32 s1 = bytes32("s1");
        bytes32 s2 = bytes32("s2");

        // Commit phase
        vm.prank(t1);
        bytes32 c1 = auction.commitOrder{value: 0.01 ether}(
            _generateCommitHash(t1, tokenA, tokenB, 1 ether, 0, s1)
        );

        vm.roll(block.number + 1);
        vm.prank(t2);
        bytes32 c2 = auction.commitOrder{value: 0.01 ether}(
            _generateCommitHash(t2, tokenA, tokenB, 1 ether, 0, s2)
        );

        // Reveal phase
        vm.warp(block.timestamp + 9);

        vm.prank(t1);
        auction.revealOrder{value: bid1}(c1, tokenA, tokenB, 1 ether, 0, s1, bid1);

        vm.prank(t2);
        auction.revealOrder{value: bid2}(c2, tokenA, tokenB, 1 ether, 0, s2, bid2);

        ICommitRevealAuction.Batch memory b = auction.getBatch(1);
        assertEq(b.totalPriorityBids, bid1 + bid2, "Total priority bids = sum of individual bids");
    }
}
