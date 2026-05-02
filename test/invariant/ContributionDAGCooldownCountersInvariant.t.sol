// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/identity/ContributionDAG.sol";

// ============ Handler ============
//
// Drives every code path that touches the cooldown counters:
//   - addVouch (reverts on cooldown — does NOT increment blocked counter)
//   - tryAddVouch (does increment blocked counter on cooldown hit)
//   - re-vouch attempts at varying time deltas (force cooldown hits + cooldown-clears)
//   - new-pair vouches (drive successes)
//
// Property: counter coherence holds globally regardless of which entry point
// callers used. Specifically:
//
//   totalHandshakeAttempts >= totalHandshakeSuccesses + totalHandshakesBlockedByCooldown
//
// Both successes and blocked-by-cooldown are subsets of attempts; they are
// disjoint (a single call cannot both succeed and be blocked); and the
// remaining "attempts - successes - blocked" slack covers one-way new vouches
// that didn't form a handshake, refresh-vouches that succeeded, and reverting
// addVouch attempts that incremented attempts before reverting on a non-
// cooldown error path. Counter coherence is therefore monotone +
// non-decreasing in all three counters.
contract DAGCooldownHandler is Test {
    ContributionDAG public dag;
    address[] public users;
    mapping(address => bool) public hasIdentityPlaced; // mirrors no-op identity contract

    uint256 public ghost_addVouchCalls;
    uint256 public ghost_tryAddVouchCalls;
    uint256 public ghost_observedBlockedReverts; // addVouch reverts on cooldown
    uint256 public ghost_observedTrySuccesses;
    uint256 public ghost_observedTryBlocked;

    constructor(ContributionDAG _dag, address[] memory _users) {
        dag = _dag;
        users = _users;
    }

    function _pickUser(uint256 seed) internal view returns (address) {
        return users[seed % users.length];
    }

    /// @notice addVouch reverts on cooldown but increments attempts BEFORE the
    ///         cooldown check (the increment is wiped by the revert). For
    ///         non-cooldown reverts (self-vouch, max-vouches), the revert
    ///         happens BEFORE the attempt counter increment.
    function addVouch(uint256 fromSeed, uint256 toSeed, bytes32 messageHash) external {
        address from = _pickUser(fromSeed);
        address to = _pickUser(toSeed);
        if (from == to) return;
        ghost_addVouchCalls++;

        vm.prank(from);
        try dag.addVouch(to, messageHash) returns (bool) {
            // success path increments attempts and (maybe) successes
        } catch {
            ghost_observedBlockedReverts++;
        }
    }

    /// @notice tryAddVouch never reverts on cooldown, so its block counter
    ///         survives. We use the return enum to ghost-track outcomes.
    function tryAddVouch(uint256 fromSeed, uint256 toSeed, bytes32 messageHash) external {
        address from = _pickUser(fromSeed);
        address to = _pickUser(toSeed);
        if (from == to) return;
        ghost_tryAddVouchCalls++;

        vm.prank(from);
        (ContributionDAG.VouchStatus status,,) = dag.tryAddVouch(to, messageHash);
        if (status == ContributionDAG.VouchStatus.Success) {
            ghost_observedTrySuccesses++;
        } else if (status == ContributionDAG.VouchStatus.BlockedByCooldown) {
            ghost_observedTryBlocked++;
        }
    }

    /// @notice Advance time by a bounded amount so cooldowns can clear.
    ///         Window: [0, 2 days] — bracketing the 1-day HANDSHAKE_COOLDOWN.
    function warpTime(uint256 dt) external {
        dt = bound(dt, 0, 2 days);
        vm.warp(block.timestamp + dt);
    }

    function userCount() external view returns (uint256) {
        return users.length;
    }
}

// ============ Invariant Test ============

contract ContributionDAGCooldownCountersInvariant is StdInvariant, Test {
    ContributionDAG public dag;
    DAGCooldownHandler public handler;
    address[] public users;

    function setUp() public {
        // soulboundIdentity = address(0) → identity check is skipped.
        dag = new ContributionDAG(address(0));

        // 6 users (small set so collisions force re-vouch / cooldown paths).
        for (uint256 i = 0; i < 6; i++) {
            users.push(address(uint160(0x4600 + i)));
        }

        handler = new DAGCooldownHandler(dag, users);
        targetContract(address(handler));

        bytes4[] memory selectors = new bytes4[](3);
        selectors[0] = handler.addVouch.selector;
        selectors[1] = handler.tryAddVouch.selector;
        selectors[2] = handler.warpTime.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    // ============ CORE INVARIANT ============

    /// @notice Counter coherence: attempts >= successes + blocked-by-cooldown.
    ///         A given call may increment 0 or 1 of {success, blocked}; both
    ///         live as subsets of attempts.
    function invariant_counterCoherence() public view {
        uint256 attempts = dag.totalHandshakeAttempts();
        uint256 successes = dag.totalHandshakeSuccesses();
        uint256 blocked = dag.totalHandshakesBlockedByCooldown();

        assertGe(
            attempts,
            successes + blocked,
            "C46 violated: attempts < successes + blocked"
        );
    }

    /// @notice Successes are bounded above by attempts.
    function invariant_successesBoundedByAttempts() public view {
        assertGe(
            dag.totalHandshakeAttempts(),
            dag.totalHandshakeSuccesses(),
            "successes > attempts (impossible)"
        );
    }

    /// @notice Blocks are bounded above by attempts.
    function invariant_blocksBoundedByAttempts() public view {
        assertGe(
            dag.totalHandshakeAttempts(),
            dag.totalHandshakesBlockedByCooldown(),
            "blocks > attempts (impossible)"
        );
    }

    /// @notice The composite snapshot accessor agrees with direct reads.
    function invariant_snapshotMatchesDirectReads() public view {
        (uint256 attempts, uint256 successes, uint256 blocked) =
            dag.getCooldownAuditCounters();
        assertEq(attempts, dag.totalHandshakeAttempts(), "snapshot drift on attempts");
        assertEq(successes, dag.totalHandshakeSuccesses(), "snapshot drift on successes");
        assertEq(blocked, dag.totalHandshakesBlockedByCooldown(), "snapshot drift on blocked");
    }

    /// @notice Counters are monotone non-decreasing — no path mutates them
    ///         downward. Sanity gate: no underflow / decrement bug exists.
    uint256 lastAttempts;
    uint256 lastSuccesses;
    uint256 lastBlocked;

    function invariant_countersMonotone() public {
        uint256 attempts = dag.totalHandshakeAttempts();
        uint256 successes = dag.totalHandshakeSuccesses();
        uint256 blocked = dag.totalHandshakesBlockedByCooldown();

        assertGe(attempts, lastAttempts, "attempts decreased");
        assertGe(successes, lastSuccesses, "successes decreased");
        assertGe(blocked, lastBlocked, "blocked decreased");

        lastAttempts = attempts;
        lastSuccesses = successes;
        lastBlocked = blocked;
    }
}
