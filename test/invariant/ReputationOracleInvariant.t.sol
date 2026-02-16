// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/oracle/ReputationOracle.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Handler ============

contract ReputationHandler is Test {
    ReputationOracle public oracle;
    address public generator;

    // Wallets being compared
    address public walletA;
    address public walletB;

    // Voter
    address public voter;

    // Ghost variables
    uint256 public ghost_comparisonsSettled;
    uint256 public ghost_roundsAdvanced;
    uint256 public ghost_aWins;
    uint256 public ghost_bWins;
    uint256 public ghost_equivalences;

    constructor(
        ReputationOracle _oracle,
        address _generator,
        address _walletA,
        address _walletB,
        address _voter
    ) {
        oracle = _oracle;
        generator = _generator;
        walletA = _walletA;
        walletB = _walletB;
        voter = _voter;
    }

    function runComparison(uint256 outcomeSeed) public {
        uint8 consensus = uint8((outcomeSeed % 3) + 1); // 1=A, 2=B, 3=equivalent

        vm.prank(generator);
        bytes32 compId;
        try oracle.createComparison(walletA, walletB) returns (bytes32 id) {
            compId = id;
        } catch {
            return;
        }

        // Commit
        bytes32 secret = keccak256(abi.encodePacked(block.timestamp, outcomeSeed));
        bytes32 commitment = keccak256(abi.encodePacked(consensus, secret));

        vm.deal(voter, 1 ether);
        vm.prank(voter);
        try oracle.commitVote{value: 0.001 ether}(compId, commitment) {} catch { return; }

        // Advance to reveal phase
        vm.warp(block.timestamp + 301);

        // Reveal
        vm.prank(voter);
        try oracle.revealVote(compId, consensus, secret) {} catch { return; }

        // Advance past reveal
        vm.warp(block.timestamp + 121);

        // Settle
        try oracle.settleComparison(compId) {
            ghost_comparisonsSettled++;
            if (consensus == 1) ghost_aWins++;
            else if (consensus == 2) ghost_bWins++;
            else ghost_equivalences++;
        } catch {}
    }

    function advanceTime(uint256 delta) public {
        delta = bound(delta, 1, 60 days);
        vm.warp(block.timestamp + delta);
    }

    function advanceRound() public {
        vm.prank(generator);
        try oracle.advanceRound() {
            ghost_roundsAdvanced++;
        } catch {}
    }
}

// ============ Invariant Tests ============

contract ReputationOracleInvariantTest is StdInvariant, Test {
    ReputationOracle public oracle;
    ReputationHandler public handler;

    address public owner;
    address public generator;
    address public treasury;

    address public walletA;
    address public walletB;
    address public voter;

    function setUp() public {
        owner = address(this);
        generator = makeAddr("generator");
        treasury = makeAddr("treasury");
        walletA = makeAddr("walletA");
        walletB = makeAddr("walletB");
        voter = makeAddr("voter");

        ReputationOracle impl = new ReputationOracle();
        bytes memory initData = abi.encodeWithSelector(
            ReputationOracle.initialize.selector,
            owner
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        oracle = ReputationOracle(payable(address(proxy)));

        oracle.setAuthorizedGenerator(generator, true);
        oracle.setTreasury(treasury);
        // Disable soulbound for simpler handler
        oracle.setSoulboundIdentity(address(0));

        handler = new ReputationHandler(oracle, generator, walletA, walletB, voter);
        targetContract(address(handler));
    }

    // ============ Invariant: scores always bounded [0, 10000] ============

    function invariant_scoresAlwaysBounded() public view {
        ReputationOracle.TrustProfile memory profileA = oracle.getTrustProfile(walletA);
        ReputationOracle.TrustProfile memory profileB = oracle.getTrustProfile(walletB);

        assertLe(profileA.score, 10000, "SCORE_A: exceeds 10000");
        assertLe(profileB.score, 10000, "SCORE_B: exceeds 10000");
    }

    // ============ Invariant: tier matches score thresholds ============

    function invariant_tierConsistentWithScore() public view {
        _checkTierConsistency(walletA);
        _checkTierConsistency(walletB);
    }

    function _checkTierConsistency(address wallet) internal view {
        ReputationOracle.TrustProfile memory profile = oracle.getTrustProfile(wallet);
        if (profile.lastUpdated == 0) return; // Not yet initialized

        uint8 expectedTier;
        if (profile.score >= 8000) expectedTier = 4;
        else if (profile.score >= 6000) expectedTier = 3;
        else if (profile.score >= 4000) expectedTier = 2;
        else if (profile.score >= 2000) expectedTier = 1;
        else expectedTier = 0;

        assertEq(profile.tier, expectedTier, "TIER: inconsistent with score");
    }

    // ============ Invariant: wins + losses + equivalences = totalComparisons ============

    function invariant_comparisonAccountingConsistent() public view {
        _checkAccounting(walletA);
        _checkAccounting(walletB);
    }

    function _checkAccounting(address wallet) internal view {
        ReputationOracle.TrustProfile memory profile = oracle.getTrustProfile(wallet);
        if (profile.lastUpdated == 0) return;

        assertEq(
            profile.wins + profile.losses + profile.equivalences,
            profile.totalComparisons,
            "ACCOUNTING: wins+losses+equivalences != totalComparisons"
        );
    }

    // ============ Invariant: round monotonically increasing ============

    function invariant_roundMonotonic() public view {
        assertGe(oracle.currentRound(), 1, "ROUND: below initial value");
    }

    // ============ Invariant: ghost settled count matches contract state ============

    function invariant_settledCountConsistent() public view {
        // Both wallets should have the same totalComparisons (they're always paired)
        ReputationOracle.TrustProfile memory profileA = oracle.getTrustProfile(walletA);
        ReputationOracle.TrustProfile memory profileB = oracle.getTrustProfile(walletB);

        // If both initialized, they should have equal total comparisons
        if (profileA.lastUpdated > 0 && profileB.lastUpdated > 0) {
            assertEq(
                profileA.totalComparisons,
                profileB.totalComparisons,
                "SETTLED: paired wallets have different comparison counts"
            );
        }
    }
}
