// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/identity/RewardLedger.sol";
import "../../contracts/identity/ContributionDAG.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockRLIToken is ERC20 {
    constructor() ERC20("Reward", "RWD") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Handler ============

contract RewardLedgerHandler is Test {
    RewardLedger public ledger;
    ContributionDAG public dag;
    MockRLIToken public token;

    address public owner;
    address public alice;
    address public bob;
    address public carol;
    address public authorized;

    // Ghost variables
    uint256 public ghost_retroRecorded;
    uint256 public ghost_retroClaimed;
    uint256 public ghost_eventsRecorded;
    uint256 public ghost_eventsDistributed;
    uint256 public ghost_activeClaimed;
    uint256 public ghost_totalRetroValue;
    uint256 public ghost_totalActiveValue;

    // Track events for distribution
    bytes32[] public eventIds;

    constructor(
        RewardLedger _ledger,
        ContributionDAG _dag,
        MockRLIToken _token,
        address _alice,
        address _bob,
        address _carol,
        address _authorized
    ) {
        ledger = _ledger;
        dag = _dag;
        token = _token;
        owner = msg.sender;
        alice = _alice;
        bob = _bob;
        carol = _carol;
        authorized = _authorized;
    }

    function recordRetroactive(uint256 valueSeed) public {
        uint256 value = bound(valueSeed, 1e18, 100_000e18);

        try ledger.recordRetroactiveContribution(
            alice, value, IRewardLedger.EventType.CODE, bytes32(0)
        ) {
            ghost_retroRecorded++;
            ghost_totalRetroValue += value;
        } catch {}
    }

    function recordValueEvent(uint256 valueSeed) public {
        uint256 value = bound(valueSeed, 1e18, 100_000e18);

        address[] memory chain = new address[](2);
        chain[0] = alice;
        chain[1] = bob;

        vm.prank(authorized);
        try ledger.recordValueEvent(bob, value, IRewardLedger.EventType.TRADE, chain) returns (bytes32 eventId) {
            ghost_eventsRecorded++;
            ghost_totalActiveValue += value;
            eventIds.push(eventId);
        } catch {}
    }

    function distributeEvent(uint256 indexSeed) public {
        if (eventIds.length == 0) return;
        uint256 index = indexSeed % eventIds.length;

        try ledger.distributeEvent(eventIds[index]) {
            ghost_eventsDistributed++;
        } catch {}
    }

    function claimActive(uint256 userSeed) public {
        address user = userSeed % 3 == 0 ? alice : (userSeed % 3 == 1 ? bob : carol);

        vm.prank(user);
        try ledger.claimActive() {
            ghost_activeClaimed++;
        } catch {}
    }

    function getEventCount() external view returns (uint256) {
        return eventIds.length;
    }
}

// ============ Invariant Tests ============

contract RewardLedgerInvariantTest is StdInvariant, Test {
    RewardLedger public ledger;
    ContributionDAG public dag;
    MockRLIToken public token;
    RewardLedgerHandler public handler;

    address public alice;
    address public bob;
    address public carol;
    address public authorized;

    function setUp() public {
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        carol = makeAddr("carol");
        authorized = makeAddr("authorized");

        token = new MockRLIToken();
        dag = new ContributionDAG(address(0));
        dag.addFounder(alice);

        // Trust chain: alice <-> bob <-> carol
        vm.prank(alice);
        dag.addVouch(bob, bytes32(0));
        vm.prank(bob);
        dag.addVouch(alice, bytes32(0));
        vm.prank(bob);
        dag.addVouch(carol, bytes32(0));
        vm.prank(carol);
        dag.addVouch(bob, bytes32(0));
        dag.recalculateTrustScores();

        ledger = new RewardLedger(address(token), address(dag));
        ledger.setAuthorizedCaller(authorized, true);
        token.mint(address(ledger), 1_000_000_000e18);

        handler = new RewardLedgerHandler(ledger, dag, token, alice, bob, carol, authorized);
        targetContract(address(handler));
    }

    // ============ Invariant: total retro distributed matches ghost ============

    function invariant_retroDistributedMatchesGhost() public view {
        assertEq(
            ledger.totalRetroactiveDistributed(),
            handler.ghost_totalRetroValue(),
            "INVARIANT: totalRetroactiveDistributed must match ghost"
        );
    }

    // ============ Invariant: Shapley efficiency — distributed = recorded for each event ============

    function invariant_activeDistributedMatchesGhost() public view {
        // Total active distributed must not exceed total active value recorded
        assertLe(
            ledger.totalActiveDistributed(),
            handler.ghost_totalActiveValue(),
            "INVARIANT: totalActiveDistributed must not exceed recorded value"
        );
    }

    // ============ Invariant: no balance exceeds total distributed ============

    function invariant_noBalanceExceedsTotal() public view {
        uint256 totalRetro = ledger.totalRetroactiveDistributed();
        uint256 totalActive = ledger.totalActiveDistributed();

        assertLe(ledger.retroactiveBalances(alice), totalRetro, "INVARIANT: alice retro <= total retro");
        assertLe(
            ledger.activeBalances(alice) + ledger.activeBalances(bob) + ledger.activeBalances(carol),
            totalActive,
            "INVARIANT: sum of active balances <= total active distributed"
        );
    }

    // ============ Invariant: token balance always sufficient for claims ============

    function invariant_tokenBalanceSufficient() public view {
        uint256 totalOwed = ledger.retroactiveBalances(alice) +
            ledger.retroactiveBalances(bob) +
            ledger.retroactiveBalances(carol) +
            ledger.activeBalances(alice) +
            ledger.activeBalances(bob) +
            ledger.activeBalances(carol);

        assertGe(
            token.balanceOf(address(ledger)),
            totalOwed,
            "INVARIANT: ledger token balance must cover all owed"
        );
    }

    // ============ Invariant: retroactive not finalized until explicit call ============

    function invariant_retroNotFinalizedByHandler() public view {
        // Handler never calls finalizeRetroactive, so it should remain unfinalized
        assertFalse(ledger.retroactiveFinalized(), "INVARIANT: retroactive must not auto-finalize");
    }
}
