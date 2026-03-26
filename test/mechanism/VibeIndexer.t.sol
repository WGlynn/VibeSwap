// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/VibeIndexer.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract VibeIndexerTest is Test {
    // ============ Re-declare events ============

    event SubgraphCreated(uint256 indexed subgraphId, address indexed creator, string name);
    event SubgraphSignaled(uint256 indexed subgraphId, address indexed signaler, uint256 amount);
    event IndexerRegistered(address indexed indexer, uint256 stake);
    event IndexerExited(address indexed indexer);
    event AllocationCreated(uint256 indexed allocationId, address indexed indexer, uint256 subgraphId);
    event AllocationClosed(uint256 indexed allocationId, uint256 queryFeesCollected);
    event DisputeCreated(uint256 indexed disputeId, address indexed challenger, address indexed indexer);
    event DisputeResolved(uint256 indexed disputeId, bool challengerWon);

    // ============ State ============

    VibeIndexer public indexer;

    address public owner;
    address public alice;
    address public bob;
    address public carol;

    uint256 constant MIN_STAKE       = 0.1 ether;
    uint256 constant BASE_QUERY_FEE  = 0.0001 ether;
    uint256 constant SLASH_BPS       = 2500; // 25%

    string  constant GRAPH_NAME      = "VibeSwap Subgraph";
    string  constant SCHEMA          = "ipfs://QmSchema";
    bytes32 constant MANIFEST        = keccak256("manifest-v1");

    // ============ setUp ============

    function setUp() public {
        owner = makeAddr("owner");
        alice = makeAddr("alice");
        bob   = makeAddr("bob");
        carol = makeAddr("carol");

        vm.deal(alice, 100 ether);
        vm.deal(bob,   100 ether);
        vm.deal(carol, 100 ether);

        vm.prank(owner);
        VibeIndexer impl = new VibeIndexer();
        bytes memory initData = abi.encodeCall(VibeIndexer.initialize, ());
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        indexer = VibeIndexer(payable(address(proxy)));

        // Fund owner for dispute resolution payouts
        vm.deal(address(indexer), 10 ether);
    }

    // ============ Helpers ============

    function _createSubgraph(address creator) internal returns (uint256) {
        vm.prank(creator);
        return indexer.createSubgraph(GRAPH_NAME, SCHEMA, MANIFEST);
    }

    function _registerIndexer(address idx) internal {
        vm.prank(idx);
        indexer.registerIndexer{value: MIN_STAKE}();
    }

    // ============ 1. Initialization ============

    function test_initialize_setsConstants() public view {
        assertEq(indexer.minIndexerStake(), MIN_STAKE);
        assertEq(indexer.baseQueryFee(), BASE_QUERY_FEE);
        assertEq(indexer.slashPercentBps(), SLASH_BPS);
    }

    function test_initialize_countersAreZero() public view {
        assertEq(indexer.subgraphCount(), 0);
        assertEq(indexer.allocationCount(), 0);
        assertEq(indexer.disputeCount(), 0);
    }

    // ============ 2. Subgraph Creation ============

    function test_createSubgraph_success() public {
        vm.expectEmit(true, true, false, true);
        emit SubgraphCreated(1, alice, GRAPH_NAME);

        uint256 id = _createSubgraph(alice);

        assertEq(id, 1);
        assertEq(indexer.subgraphCount(), 1);

        (
            uint256 subgraphId,
            address creator,
            string memory name,
            ,
            bytes32 manifestHash,
            uint256 signalAmount,
            uint256 queryCount,
            bool active,
        ) = indexer.subgraphs(1);

        assertEq(subgraphId, 1);
        assertEq(creator, alice);
        assertEq(name, GRAPH_NAME);
        assertEq(manifestHash, MANIFEST);
        assertEq(signalAmount, 0);
        assertEq(queryCount, 0);
        assertTrue(active);
    }

    function test_createSubgraph_incrementsCount() public {
        _createSubgraph(alice);
        _createSubgraph(bob);
        _createSubgraph(carol);
        assertEq(indexer.subgraphCount(), 3);
        assertEq(indexer.getSubgraphCount(), 3);
    }

    // ============ 3. Subgraph Signaling ============

    function test_signal_success() public {
        uint256 id = _createSubgraph(alice);
        uint256 amount = 0.5 ether;

        vm.expectEmit(true, true, false, true);
        emit SubgraphSignaled(id, bob, amount);

        vm.prank(bob);
        indexer.signal{value: amount}(id);

        assertEq(indexer.signals(id, bob), amount);
        (,,,,,uint256 signalAmount,,,) = indexer.subgraphs(id);
        assertEq(signalAmount, amount);
    }

    function test_signal_accumulates() public {
        uint256 id = _createSubgraph(alice);

        vm.prank(bob);
        indexer.signal{value: 0.3 ether}(id);
        vm.prank(bob);
        indexer.signal{value: 0.2 ether}(id);

        assertEq(indexer.signals(id, bob), 0.5 ether);
    }

    function test_signal_revertsOnInactiveSubgraph() public {
        // subgraphId 99 doesn't exist
        vm.prank(bob);
        vm.expectRevert("Subgraph not active");
        indexer.signal{value: 0.1 ether}(99);
    }

    // ============ 4. Indexer Registration ============

    function test_registerIndexer_success() public {
        vm.expectEmit(true, false, false, true);
        emit IndexerRegistered(alice, MIN_STAKE);

        _registerIndexer(alice);

        (
            address idxAddr,
            uint256 stake,
            uint256 allocatedStake,
            uint256 queryFeesClaimed,
            uint256 slashCount,
            bool active,
        ) = indexer.indexers(alice);

        assertEq(idxAddr, alice);
        assertEq(stake, MIN_STAKE);
        assertEq(allocatedStake, 0);
        assertEq(queryFeesClaimed, 0);
        assertEq(slashCount, 0);
        assertTrue(active);
        assertEq(indexer.getIndexerCount(), 1);
    }

    function test_registerIndexer_revertsOnInsufficientStake() public {
        vm.prank(alice);
        vm.expectRevert("Insufficient stake");
        indexer.registerIndexer{value: MIN_STAKE - 1}();
    }

    function test_registerIndexer_revertsIfAlreadyRegistered() public {
        _registerIndexer(alice);

        vm.prank(alice);
        vm.expectRevert("Already registered");
        indexer.registerIndexer{value: MIN_STAKE}();
    }

    // ============ 5. Indexer Exit ============

    function test_exitIndexer_refundsStake() public {
        _registerIndexer(alice);
        uint256 balBefore = alice.balance;

        vm.expectEmit(true, false, false, false);
        emit IndexerExited(alice);

        vm.prank(alice);
        indexer.exitIndexer();

        (,, uint256 allocatedStake,,, bool active,) = indexer.indexers(alice);
        assertFalse(active);
        assertEq(alice.balance, balBefore + MIN_STAKE);
        assertEq(allocatedStake, 0);
    }

    function test_exitIndexer_revertsIfNotActive() public {
        vm.prank(alice);
        vm.expectRevert("Not active");
        indexer.exitIndexer();
    }

    function test_exitIndexer_revertsWithOpenAllocations() public {
        _registerIndexer(alice);
        uint256 subId = _createSubgraph(bob);

        vm.prank(alice);
        indexer.createAllocation(subId, MIN_STAKE / 2);

        vm.prank(alice);
        vm.expectRevert("Close allocations first");
        indexer.exitIndexer();
    }

    // ============ 6. Allocations ============

    function test_createAllocation_success() public {
        _registerIndexer(alice);
        uint256 subId = _createSubgraph(bob);
        uint256 allocStake = MIN_STAKE / 2;

        vm.expectEmit(true, true, false, true);
        emit AllocationCreated(1, alice, subId);

        vm.prank(alice);
        uint256 allocId = indexer.createAllocation(subId, allocStake);

        assertEq(allocId, 1);
        assertEq(indexer.allocationCount(), 1);

        (
            uint256 allocationId,
            address idxAddr,
            uint256 subgraphId,
            uint256 allocatedStake,
            ,
            ,
            bool active
        ) = indexer.allocations(1);

        assertEq(allocationId, 1);
        assertEq(idxAddr, alice);
        assertEq(subgraphId, subId);
        assertEq(allocatedStake, allocStake);
        assertTrue(active);

        (, , uint256 totalAllocated,,,,) = indexer.indexers(alice);
        assertEq(totalAllocated, allocStake);
    }

    function test_createAllocation_revertsIfInsufficientFreeStake() public {
        _registerIndexer(alice);
        uint256 subId = _createSubgraph(bob);

        // Allocate full stake first
        vm.prank(alice);
        indexer.createAllocation(subId, MIN_STAKE);

        // Now no free stake left
        vm.prank(alice);
        vm.expectRevert("Insufficient unallocated stake");
        indexer.createAllocation(subId, 1);
    }

    function test_closeAllocation_releasesStake() public {
        _registerIndexer(alice);
        uint256 subId = _createSubgraph(bob);
        uint256 allocStake = MIN_STAKE / 2;

        vm.prank(alice);
        uint256 allocId = indexer.createAllocation(subId, allocStake);

        vm.expectEmit(true, false, false, true);
        emit AllocationClosed(allocId, 0);

        vm.prank(alice);
        indexer.closeAllocation(allocId);

        (,,,,,, bool active) = indexer.allocations(allocId);
        assertFalse(active);

        (,, uint256 totalAllocated,,,,) = indexer.indexers(alice);
        assertEq(totalAllocated, 0);
    }

    function test_closeAllocation_revertsIfNotOwner() public {
        _registerIndexer(alice);
        uint256 subId = _createSubgraph(bob);

        vm.prank(alice);
        uint256 allocId = indexer.createAllocation(subId, MIN_STAKE / 2);

        vm.prank(bob);
        vm.expectRevert("Not your allocation");
        indexer.closeAllocation(allocId);
    }

    function test_closeAllocation_revertsIfAlreadyClosed() public {
        _registerIndexer(alice);
        uint256 subId = _createSubgraph(bob);

        vm.prank(alice);
        uint256 allocId = indexer.createAllocation(subId, MIN_STAKE / 2);

        vm.prank(alice);
        indexer.closeAllocation(allocId);

        vm.prank(alice);
        vm.expectRevert("Already closed");
        indexer.closeAllocation(allocId);
    }

    // ============ 7. Disputes ============

    function test_createDispute_success() public {
        _registerIndexer(alice);
        uint256 subId = _createSubgraph(bob);
        uint256 disputeStake = BASE_QUERY_FEE * 10;

        bytes32 queryHash      = keccak256("query-1");
        bytes32 expectedResp   = keccak256("expected");
        bytes32 actualResp     = keccak256("actual");

        vm.expectEmit(true, true, true, false);
        emit DisputeCreated(1, carol, alice);

        vm.prank(carol);
        uint256 disputeId = indexer.createDispute{value: disputeStake}(
            alice, subId, queryHash, expectedResp, actualResp
        );

        assertEq(disputeId, 1);
        assertEq(indexer.getDisputeCount(), 1);

        (
            uint256 id,
            address challenger,
            address idxAddr,
            uint256 sId,
            bytes32 qHash,
            bytes32 expResp,
            bytes32 actResp,
            uint256 stake,
            bool resolved,
            bool challengerWon
        ) = indexer.disputes(1);

        assertEq(id, 1);
        assertEq(challenger, carol);
        assertEq(idxAddr, alice);
        assertEq(sId, subId);
        assertEq(qHash, queryHash);
        assertEq(expResp, expectedResp);
        assertEq(actResp, actualResp);
        assertEq(stake, disputeStake);
        assertFalse(resolved);
        assertFalse(challengerWon);
    }

    function test_createDispute_revertsOnLowStake() public {
        _registerIndexer(alice);
        uint256 subId = _createSubgraph(bob);

        vm.prank(carol);
        vm.expectRevert("Dispute stake too low");
        indexer.createDispute{value: BASE_QUERY_FEE * 9}(
            alice, subId, bytes32(0), bytes32(0), bytes32(0)
        );
    }

    function test_resolveDispute_challengerWins_slashesIndexer() public {
        _registerIndexer(alice);
        uint256 subId = _createSubgraph(bob);
        uint256 disputeStake = BASE_QUERY_FEE * 10;

        vm.prank(carol);
        uint256 disputeId = indexer.createDispute{value: disputeStake}(
            alice, subId, bytes32(0), bytes32(0), bytes32(0)
        );

        uint256 carolBalBefore  = carol.balance;
        (, uint256 aliceStakeBefore,,,,, ) = indexer.indexers(alice);
        uint256 expectedSlash   = (aliceStakeBefore * SLASH_BPS) / 10000;
        uint256 expectedReward  = disputeStake + expectedSlash;

        vm.expectEmit(true, false, false, true);
        emit DisputeResolved(disputeId, true);

        vm.prank(owner);
        indexer.resolveDispute(disputeId, true);

        (, uint256 aliceStakeAfter,,, uint256 slashCount,, ) = indexer.indexers(alice);
        assertEq(aliceStakeAfter, aliceStakeBefore - expectedSlash);
        assertEq(slashCount, 1);

        assertEq(carol.balance, carolBalBefore + expectedReward);

        (,,,,,,, , bool resolved, bool challengerWon) = indexer.disputes(disputeId);
        assertTrue(resolved);
        assertTrue(challengerWon);
    }

    function test_resolveDispute_challengerLoses_refundsWithPenalty() public {
        _registerIndexer(alice);
        uint256 subId = _createSubgraph(bob);
        uint256 disputeStake = BASE_QUERY_FEE * 10;

        vm.prank(carol);
        uint256 disputeId = indexer.createDispute{value: disputeStake}(
            alice, subId, bytes32(0), bytes32(0), bytes32(0)
        );

        uint256 carolBalBefore = carol.balance;
        uint256 expectedPenalty = disputeStake / 10;
        uint256 expectedRefund  = disputeStake - expectedPenalty;

        vm.prank(owner);
        indexer.resolveDispute(disputeId, false);

        assertEq(carol.balance, carolBalBefore + expectedRefund);

        (,,,,,,,,, bool challengerWon) = indexer.disputes(disputeId);
        assertFalse(challengerWon);
    }

    function test_resolveDispute_revertsIfAlreadyResolved() public {
        _registerIndexer(alice);
        uint256 subId = _createSubgraph(bob);

        vm.prank(carol);
        uint256 disputeId = indexer.createDispute{value: BASE_QUERY_FEE * 10}(
            alice, subId, bytes32(0), bytes32(0), bytes32(0)
        );

        vm.prank(owner);
        indexer.resolveDispute(disputeId, false);

        vm.prank(owner);
        vm.expectRevert("Already resolved");
        indexer.resolveDispute(disputeId, true);
    }

    function test_resolveDispute_revertsIfNotOwner() public {
        _registerIndexer(alice);
        uint256 subId = _createSubgraph(bob);

        vm.prank(carol);
        uint256 disputeId = indexer.createDispute{value: BASE_QUERY_FEE * 10}(
            alice, subId, bytes32(0), bytes32(0), bytes32(0)
        );

        vm.prank(alice);
        vm.expectRevert();
        indexer.resolveDispute(disputeId, false);
    }

    // ============ 8. Fuzz ============

    function testFuzz_createSubgraphsAndSignal(uint96 signalAmount) public {
        vm.assume(signalAmount > 0 && signalAmount < 50 ether);
        vm.deal(bob, uint256(signalAmount) + 1 ether);

        uint256 id = _createSubgraph(alice);

        vm.prank(bob);
        indexer.signal{value: signalAmount}(id);

        assertEq(indexer.signals(id, bob), signalAmount);
    }

    function testFuzz_indexerStakeVariants(uint96 stake) public {
        vm.assume(stake >= MIN_STAKE && stake < 10 ether);
        vm.deal(alice, uint256(stake));

        vm.prank(alice);
        indexer.registerIndexer{value: stake}();

        (, uint256 s,,,,, ) = indexer.indexers(alice);
        assertEq(s, stake);
    }
}
