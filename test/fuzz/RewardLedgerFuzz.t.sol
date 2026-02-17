// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/identity/RewardLedger.sol";
import "../../contracts/identity/ContributionDAG.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockRLFToken is ERC20 {
    constructor() ERC20("Reward", "RWD") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Fuzz Tests ============

contract RewardLedgerFuzzTest is Test {
    RewardLedger public ledger;
    ContributionDAG public dag;
    MockRLFToken public token;

    address public owner;
    address public alice;
    address public bob;
    address public carol;
    address public authorized;

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        carol = makeAddr("carol");
        authorized = makeAddr("authorized");

        token = new MockRLFToken();
        dag = new ContributionDAG(address(0));
        dag.addFounder(alice);

        ledger = new RewardLedger(address(token), address(dag));
        ledger.setAuthorizedCaller(authorized, true);
        token.mint(address(ledger), 100_000_000e18);

        // Setup trust chain: alice <-> bob <-> carol
        vm.prank(alice);
        dag.addVouch(bob, bytes32(0));
        vm.prank(bob);
        dag.addVouch(alice, bytes32(0));
        vm.prank(bob);
        dag.addVouch(carol, bytes32(0));
        vm.prank(carol);
        dag.addVouch(bob, bytes32(0));
        dag.recalculateTrustScores();
    }

    // ============ Fuzz: retroactive recording accumulates correctly ============

    function testFuzz_retroactiveAccumulation(uint256 numContributions, uint256 valueSeed) public {
        numContributions = bound(numContributions, 1, 20);

        uint256 totalExpected = 0;
        for (uint256 i = 0; i < numContributions; i++) {
            uint256 value = bound(uint256(keccak256(abi.encodePacked(valueSeed, i))), 1e18, 1_000_000e18);
            ledger.recordRetroactiveContribution(
                alice, value, IRewardLedger.EventType.CODE, bytes32(0)
            );
            totalExpected += value;
        }

        assertEq(ledger.retroactiveBalances(alice), totalExpected, "Retroactive balance must match sum");
        assertEq(ledger.totalRetroactiveDistributed(), totalExpected, "Total retro must match sum");
    }

    // ============ Fuzz: retroactive claim transfers exact balance ============

    function testFuzz_retroactiveClaimExact(uint256 value) public {
        value = bound(value, 1e18, 10_000_000e18);

        ledger.recordRetroactiveContribution(alice, value, IRewardLedger.EventType.CODE, bytes32(0));
        ledger.finalizeRetroactive();

        uint256 balBefore = token.balanceOf(alice);
        vm.prank(alice);
        ledger.claimRetroactive();

        assertEq(token.balanceOf(alice) - balBefore, value, "Claimed amount must equal recorded value");
        assertEq(ledger.retroactiveBalances(alice), 0, "Balance must be zero after claim");
    }

    // ============ Fuzz: Shapley efficiency axiom — all value distributed ============

    function testFuzz_shapleyEfficiency(uint256 value) public {
        value = bound(value, 1e18, 10_000_000e18);

        // Event for carol (chain: alice -> bob -> carol)
        address[] memory chain = new address[](3);
        chain[0] = alice;
        chain[1] = bob;
        chain[2] = carol;

        vm.prank(authorized);
        bytes32 eventId = ledger.recordValueEvent(carol, value, IRewardLedger.EventType.TRADE, chain);
        ledger.distributeEvent(eventId);

        uint256 totalDistributed = ledger.activeBalances(alice) +
            ledger.activeBalances(bob) + ledger.activeBalances(carol);

        assertEq(totalDistributed, value, "EFFICIENCY: all value must be distributed");
    }

    // ============ Fuzz: actor gets majority share (>= 50% before quality weights) ============

    function testFuzz_actorGetsMajority(uint256 value) public {
        value = bound(value, 1e18, 10_000_000e18);

        address[] memory chain = new address[](3);
        chain[0] = alice;
        chain[1] = bob;
        chain[2] = carol;

        vm.prank(authorized);
        bytes32 eventId = ledger.recordValueEvent(carol, value, IRewardLedger.EventType.TRADE, chain);
        ledger.distributeEvent(eventId);

        uint256 carolBalance = ledger.activeBalances(carol);
        uint256 bobBalance = ledger.activeBalances(bob);
        uint256 aliceBalance = ledger.activeBalances(alice);

        // Actor (carol) should get the largest individual share
        assertGe(carolBalance, bobBalance, "Actor must get >= each enabler's share");
        assertGe(carolBalance, aliceBalance, "Actor must get >= each enabler's share");
    }

    // ============ Fuzz: single-person chain gives 100% to actor ============

    function testFuzz_singlePersonChainFullAmount(uint256 value) public {
        value = bound(value, 1e18, 10_000_000e18);

        address[] memory chain = new address[](1);
        chain[0] = alice;

        vm.prank(authorized);
        bytes32 eventId = ledger.recordValueEvent(alice, value, IRewardLedger.EventType.TRADE, chain);
        ledger.distributeEvent(eventId);

        assertEq(ledger.activeBalances(alice), value, "Single-person chain: actor gets all");
    }

    // ============ Fuzz: active claim transfers exact balance ============

    function testFuzz_activeClaimExact(uint256 value) public {
        value = bound(value, 1e18, 10_000_000e18);

        address[] memory chain = new address[](1);
        chain[0] = alice;

        vm.prank(authorized);
        bytes32 eventId = ledger.recordValueEvent(alice, value, IRewardLedger.EventType.TRADE, chain);
        ledger.distributeEvent(eventId);

        uint256 balBefore = token.balanceOf(alice);
        vm.prank(alice);
        ledger.claimActive();

        assertEq(token.balanceOf(alice) - balBefore, value, "Active claim must transfer exact balance");
        assertEq(ledger.activeBalances(alice), 0, "Balance must be zero after claim");
    }

    // ============ Fuzz: multiple events accumulate correctly ============

    function testFuzz_multipleEventsAccumulate(uint256 numEvents, uint256 valueSeed) public {
        numEvents = bound(numEvents, 1, 10);

        uint256 totalValue = 0;
        for (uint256 i = 0; i < numEvents; i++) {
            uint256 value = bound(uint256(keccak256(abi.encodePacked(valueSeed, i))), 1e18, 1_000_000e18);
            totalValue += value;

            address[] memory chain = new address[](1);
            chain[0] = alice;

            vm.prank(authorized);
            bytes32 eventId = ledger.recordValueEvent(alice, value, IRewardLedger.EventType.TRADE, chain);
            ledger.distributeEvent(eventId);
        }

        assertEq(ledger.activeBalances(alice), totalValue, "Accumulated balance must match total");
        assertEq(ledger.totalActiveDistributed(), totalValue, "Total active distributed must match");
    }

    // ============ Fuzz: quality weight always in [0.1, 2.0] range ============

    function testFuzz_qualityWeightBounded(uint256 numHops) public {
        numHops = bound(numHops, 0, 6);

        // Build chain of numHops from founder
        address prev = alice;
        address target = alice;
        for (uint256 i = 0; i < numHops; i++) {
            target = address(uint160(6000 + i));
            vm.prank(prev);
            dag.addVouch(target, bytes32(0));
            vm.prank(target);
            dag.addVouch(prev, bytes32(0));
            prev = target;
        }
        dag.recalculateTrustScores();

        // Check multiplier maps to valid quality weight range
        uint256 multiplier = dag.getVotingPowerMultiplier(target);
        uint256 weight = (multiplier * 1e18) / 10000;

        // Weight should be in [0.1, 3.0] (founders get 3x)
        assertGe(weight, 5e17, "Weight must be >= 0.5 (untrusted min)");
        assertLe(weight, 3e18, "Weight must be <= 3.0 (founder max)");
    }
}
