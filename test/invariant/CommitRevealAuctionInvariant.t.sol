// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/core/CommitRevealAuction.sol";
import "../../contracts/libraries/DeterministicShuffle.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Handler ============

contract CRAHandler is Test {
    CommitRevealAuction public auction;
    address public tokenA;
    address public tokenB;

    address[] public traders;
    bytes32[] public activeCommitIds;

    // Ghost variables
    uint256 public ghost_totalDeposited;
    uint256 public ghost_totalSlashed;
    uint256 public ghost_totalWithdrawn;
    uint256 public ghost_totalCommits;
    uint256 public ghost_totalReveals;
    uint256 public ghost_totalPriorityBids;

    constructor(
        CommitRevealAuction _auction,
        address _tokenA,
        address _tokenB,
        address[] memory _traders
    ) {
        auction = _auction;
        tokenA = _tokenA;
        tokenB = _tokenB;
        traders = _traders;
    }

    function commitOrder(uint256 traderSeed, uint256 deposit) public {
        deposit = bound(deposit, 0.001 ether, 0.1 ether);

        // Only commit during COMMIT phase
        if (uint8(auction.getCurrentPhase()) != uint8(ICommitRevealAuction.BatchPhase.COMMIT)) return;

        address trader = traders[traderSeed % traders.length];

        bytes32 secret = keccak256(abi.encodePacked(ghost_totalCommits, trader));
        bytes32 commitHash = keccak256(abi.encodePacked(
            trader, tokenA, tokenB, uint256(1 ether), uint256(0), secret
        ));

        vm.deal(trader, deposit + 1 ether);
        vm.roll(block.number + 1); // Avoid flash loan detection

        vm.prank(trader);
        try auction.commitOrder{value: deposit}(commitHash) returns (bytes32 commitId) {
            activeCommitIds.push(commitId);
            ghost_totalDeposited += deposit;
            ghost_totalCommits++;
        } catch {}
    }

    function advanceTime(uint256 delta) public {
        delta = bound(delta, 1, 12);
        vm.warp(block.timestamp + delta);

        // Try to advance phase
        try auction.advancePhase() {} catch {}
    }

    function settleBatch() public {
        try auction.settleBatch() {} catch {}
    }

    function slashUnrevealed(uint256 commitSeed) public {
        if (activeCommitIds.length == 0) return;

        bytes32 commitId = activeCommitIds[commitSeed % activeCommitIds.length];
        ICommitRevealAuction.OrderCommitment memory c = auction.getCommitment(commitId);

        if (c.status != ICommitRevealAuction.CommitStatus.COMMITTED) return;

        try auction.slashUnrevealedCommitment(commitId) {
            uint256 slashAmount = (c.depositAmount * 5000) / 10000;
            ghost_totalSlashed += slashAmount;
            ghost_totalWithdrawn += c.depositAmount - slashAmount;
        } catch {}
    }
}

// ============ Invariant Tests ============

contract CommitRevealAuctionInvariantTest is StdInvariant, Test {
    CommitRevealAuction public auction;
    CRAHandler public handler;

    address public treasury;
    address public tokenA;
    address public tokenB;
    address[] public traders;

    function setUp() public {
        treasury = makeAddr("treasury");
        tokenA = makeAddr("tokenA");
        tokenB = makeAddr("tokenB");

        CommitRevealAuction impl = new CommitRevealAuction();
        bytes memory initData = abi.encodeWithSelector(
            CommitRevealAuction.initialize.selector,
            address(this),
            treasury,
            address(0)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        auction = CommitRevealAuction(payable(address(proxy)));
        auction.setAuthorizedSettler(address(this), true);

        // Create traders
        for (uint256 i = 0; i < 5; i++) {
            address t = makeAddr(string(abi.encodePacked("trader", vm.toString(i))));
            traders.push(t);
            vm.deal(t, 100 ether);
        }

        handler = new CRAHandler(auction, tokenA, tokenB, traders);
        auction.setAuthorizedSettler(address(handler), true);

        targetContract(address(handler));
    }

    // ============ Invariant: ETH balance >= total deposits - withdrawn - slashed ============

    function invariant_ethBalanceSolvent() public view {
        uint256 contractBal = address(auction).balance;
        uint256 expected = handler.ghost_totalDeposited() - handler.ghost_totalWithdrawn() - handler.ghost_totalSlashed();

        // Contract should hold at least what's owed (may hold more due to priority bids)
        assertGe(
            contractBal + handler.ghost_totalSlashed() + handler.ghost_totalWithdrawn(),
            handler.ghost_totalDeposited(),
            "SOLVENCY: ETH accounting mismatch"
        );
    }

    // ============ Invariant: commits >= reveals ============

    function invariant_commitsGeReveals() public view {
        assertGe(
            handler.ghost_totalCommits(),
            handler.ghost_totalReveals(),
            "COMMIT: reveals exceed commits"
        );
    }

    // ============ Invariant: batch ID always positive ============

    function invariant_batchIdPositive() public view {
        assertGt(auction.getCurrentBatchId(), 0, "BATCH: ID must be positive");
    }

    // ============ Invariant: phase is valid ============

    function invariant_phaseValid() public view {
        uint8 phase = uint8(auction.getCurrentPhase());
        assertTrue(
            phase <= uint8(ICommitRevealAuction.BatchPhase.SETTLED),
            "PHASE: invalid phase value"
        );
    }

    // ============ Invariant: slashed + withdrawn <= deposited ============

    function invariant_flowsConsistent() public view {
        assertLe(
            handler.ghost_totalSlashed() + handler.ghost_totalWithdrawn(),
            handler.ghost_totalDeposited(),
            "FLOW: slashed + withdrawn > deposited"
        );
    }
}
