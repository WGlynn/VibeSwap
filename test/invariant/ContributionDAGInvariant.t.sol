// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/identity/ContributionDAG.sol";

// ============ Handler ============

contract ContributionDAGHandler is Test {
    ContributionDAG public dag;
    address public founder;

    // Ghost variables
    uint256 public ghost_vouchesAdded;
    uint256 public ghost_vouchesRevoked;
    uint256 public ghost_handshakesFormed;
    uint256 public ghost_recalculations;
    uint256 public ghost_foundersAdded;

    // Track unique users for bound checking
    address[] public allUsers;
    mapping(address => bool) public isUser;

    constructor(ContributionDAG _dag, address _founder) {
        dag = _dag;
        founder = _founder;
        allUsers.push(_founder);
        isUser[_founder] = true;
    }

    function _getOrCreateUser(uint256 seed) internal returns (address) {
        address user = address(uint160(bound(seed, 100, 10000)));
        if (!isUser[user]) {
            allUsers.push(user);
            isUser[user] = true;
        }
        return user;
    }

    function addVouch(uint256 fromSeed, uint256 toSeed) public {
        address from = _getOrCreateUser(fromSeed);
        address to = _getOrCreateUser(toSeed);
        if (from == to) return;

        vm.prank(from);
        try dag.addVouch(to, bytes32(0)) {
            ghost_vouchesAdded++;

            // Check if handshake formed
            if (dag.hasHandshake(from, to)) {
                ghost_handshakesFormed++;
            }
        } catch {}
    }

    function revokeVouch(uint256 fromSeed, uint256 toSeed) public {
        address from = _getOrCreateUser(fromSeed);
        address to = _getOrCreateUser(toSeed);

        vm.prank(from);
        try dag.revokeVouch(to) {
            ghost_vouchesRevoked++;
        } catch {}
    }

    function recalculateTrust() public {
        try dag.recalculateTrustScores() {
            ghost_recalculations++;
        } catch {}
    }

    function addFounder(uint256 seed) public {
        address user = _getOrCreateUser(seed);
        try dag.addFounder(user) {
            ghost_foundersAdded++;
        } catch {}
    }

    function getUserCount() external view returns (uint256) {
        return allUsers.length;
    }

    function getUserAt(uint256 index) external view returns (address) {
        return allUsers[index];
    }
}

// ============ Invariant Tests ============

contract ContributionDAGInvariantTest is StdInvariant, Test {
    ContributionDAG public dag;
    ContributionDAGHandler public handler;

    address public alice;

    function setUp() public {
        alice = makeAddr("alice");
        dag = new ContributionDAG(address(0));
        dag.addFounder(alice);

        handler = new ContributionDAGHandler(dag, alice);
        targetContract(address(handler));
    }

    // ============ Invariant: trust scores always in [0, 1e18] ============

    function invariant_trustScoresBounded() public view {
        uint256 userCount = handler.getUserCount();
        for (uint256 i = 0; i < userCount && i < 50; i++) {
            address user = handler.getUserAt(i);
            (uint256 score,,,,) = dag.getTrustScore(user);
            assertLe(score, 1e18, "INVARIANT: trust score must be <= 1e18");
        }
    }

    // ============ Invariant: founders always have score = 1e18 after recalc ============

    function invariant_founderScoreMaxAfterRecalc() public view {
        if (handler.ghost_recalculations() == 0) return;

        address[] memory founders = dag.getFounders();
        for (uint256 i = 0; i < founders.length; i++) {
            (uint256 score,,,,) = dag.getTrustScore(founders[i]);
            assertEq(score, 1e18, "INVARIANT: founder score must be 1e18 after recalc");
        }
    }

    // ============ Invariant: handshake symmetry ============

    function invariant_handshakeSymmetry() public view {
        uint256 userCount = handler.getUserCount();
        for (uint256 i = 0; i < userCount && i < 30; i++) {
            for (uint256 j = i + 1; j < userCount && j < 30; j++) {
                address a = handler.getUserAt(i);
                address b = handler.getUserAt(j);
                assertEq(
                    dag.hasHandshake(a, b),
                    dag.hasHandshake(b, a),
                    "INVARIANT: handshake must be symmetric"
                );
            }
        }
    }

    // ============ Invariant: vouch count never exceeds max ============

    function invariant_vouchCountBounded() public view {
        uint256 userCount = handler.getUserCount();
        for (uint256 i = 0; i < userCount && i < 50; i++) {
            address user = handler.getUserAt(i);
            assertLe(
                dag.getVouchesFrom(user).length,
                10,
                "INVARIANT: vouches from any user must be <= MAX_VOUCH_PER_USER"
            );
        }
    }

    // ============ Invariant: founders count never exceeds max ============

    function invariant_founderCountBounded() public view {
        assertLe(dag.getFounders().length, 20, "INVARIANT: founders must be <= MAX_FOUNDERS");
    }

    // ============ Invariant: multiplier always in valid range ============

    function invariant_multiplierInRange() public view {
        uint256 userCount = handler.getUserCount();
        for (uint256 i = 0; i < userCount && i < 50; i++) {
            address user = handler.getUserAt(i);
            uint256 multiplier = dag.getVotingPowerMultiplier(user);
            // Multiplier must be one of: 30000 (founder), 20000 (trusted), 15000 (partial), 10000 (low), 5000 (untrusted)
            assertTrue(
                multiplier == 30000 || multiplier == 20000 || multiplier == 15000 ||
                multiplier == 10000 || multiplier == 5000,
                "INVARIANT: multiplier must be a valid tier value"
            );
        }
    }

    // ============ Invariant: ghost accounting ============

    function invariant_ghostAccounting() public view {
        assertGe(
            handler.ghost_vouchesAdded(),
            handler.ghost_handshakesFormed(),
            "INVARIANT: handshakes formed must be <= vouches added"
        );
    }
}
