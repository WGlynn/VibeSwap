// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/oracle/ReputationOracle.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Fuzz Tests ============

contract ReputationOracleFuzzTest is Test {
    ReputationOracle public oracle;

    address public owner;
    address public generator;
    address public treasury;

    address public alice;
    address public bob;
    address public voter;

    function setUp() public {
        owner = address(this);
        generator = makeAddr("generator");
        treasury = makeAddr("treasury");
        alice = makeAddr("alice");
        bob = makeAddr("bob");
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

        // Disable soulbound requirement for fuzz simplicity
        oracle.setSoulboundIdentity(address(0));

        vm.deal(voter, 100 ether);
    }

    // ============ Helpers ============

    function _runComparison(uint8 consensus) internal {
        vm.prank(generator);
        bytes32 compId = oracle.createComparison(alice, bob);

        bytes32 secret = keccak256(abi.encodePacked(block.timestamp, consensus));
        bytes32 commitment = keccak256(abi.encodePacked(consensus, secret));

        vm.prank(voter);
        oracle.commitVote{value: 0.001 ether}(compId, commitment);

        vm.warp(block.timestamp + 301);

        vm.prank(voter);
        oracle.revealVote(compId, consensus, secret);

        vm.warp(block.timestamp + 121);
        oracle.settleComparison(compId);
    }

    // ============ Fuzz: score always bounded [0, 10000] after N rounds ============

    function testFuzz_scoreAlwaysBounded(uint256 numRounds, uint256 outcomeSeed) public {
        numRounds = bound(numRounds, 1, 30);

        for (uint256 i = 0; i < numRounds; i++) {
            uint8 consensus = uint8((outcomeSeed >> i) % 3) + 1; // 1, 2, or 3
            _runComparison(consensus);
        }

        ReputationOracle.TrustProfile memory profileA = oracle.getTrustProfile(alice);
        ReputationOracle.TrustProfile memory profileB = oracle.getTrustProfile(bob);

        assertLe(profileA.score, 10000, "Score A must be <= 10000");
        assertLe(profileB.score, 10000, "Score B must be <= 10000");
    }

    // ============ Fuzz: tier consistent with score thresholds ============

    function testFuzz_tierConsistentWithScore(uint256 numRounds, uint256 outcomeSeed) public {
        numRounds = bound(numRounds, 1, 20);

        for (uint256 i = 0; i < numRounds; i++) {
            uint8 consensus = uint8((outcomeSeed >> i) % 3) + 1;
            _runComparison(consensus);
        }

        ReputationOracle.TrustProfile memory profile = oracle.getTrustProfile(alice);
        uint8 expectedTier;

        if (profile.score >= 8000) expectedTier = 4;
        else if (profile.score >= 6000) expectedTier = 3;
        else if (profile.score >= 4000) expectedTier = 2;
        else if (profile.score >= 2000) expectedTier = 1;
        else expectedTier = 0;

        assertEq(profile.tier, expectedTier, "Tier must match score thresholds");
    }

    // ============ Fuzz: commit-reveal integrity for any choice+secret ============

    function testFuzz_commitRevealIntegrity(uint8 choice, bytes32 secret) public {
        choice = uint8(bound(choice, 1, 3));

        vm.prank(generator);
        bytes32 compId = oracle.createComparison(alice, bob);

        bytes32 commitment = keccak256(abi.encodePacked(choice, secret));
        vm.prank(voter);
        oracle.commitVote{value: 0.001 ether}(compId, commitment);

        vm.warp(block.timestamp + 301);

        vm.prank(voter);
        oracle.revealVote(compId, choice, secret);

        ReputationOracle.Comparison memory comp = oracle.getComparison(compId);
        assertEq(comp.totalVotes, 1, "Total votes must be 1");
    }

    // ============ Fuzz: slash calculation correct ============

    function testFuzz_slashCalculation(uint256 deposit) public {
        deposit = bound(deposit, 0.0005 ether, 1 ether);

        vm.prank(generator);
        bytes32 compId = oracle.createComparison(alice, bob);

        // Commit but don't reveal
        bytes32 commitment = keccak256(abi.encodePacked(uint8(1), bytes32("secret")));
        vm.prank(voter);
        oracle.commitVote{value: deposit}(compId, commitment);

        // Skip reveal, settle
        vm.warp(block.timestamp + 301 + 121);

        uint256 treasuryBefore = treasury.balance;
        oracle.settleComparison(compId);

        uint256 expectedSlash = (deposit * 5000) / 10000; // 50%
        assertEq(treasury.balance - treasuryBefore, expectedSlash, "Slash must be 50% of deposit");
    }

    // ============ Fuzz: win always increases score (unless at cap) ============

    function testFuzz_winIncreasesScore(uint256 numPriorLosses) public {
        numPriorLosses = bound(numPriorLosses, 0, 40);

        // Give bob losses to lower his score
        for (uint256 i = 0; i < numPriorLosses; i++) {
            _runComparison(1); // A wins → bob loses
        }

        uint256 scoreBefore = oracle.getTrustProfile(alice).score;

        // Alice wins one more
        _runComparison(1);

        uint256 scoreAfter = oracle.getTrustProfile(alice).score;

        if (scoreBefore < 10000) {
            assertGt(scoreAfter, scoreBefore, "Win must increase score when below cap");
        } else {
            assertEq(scoreAfter, 10000, "Score must stay at cap");
        }
    }

    // ============ Fuzz: decay moves score toward mean ============

    function testFuzz_decayTowardMean(uint256 numWins, uint256 decayPeriods) public {
        numWins = bound(numWins, 1, 15);
        decayPeriods = bound(decayPeriods, 1, 12);

        // Give alice wins to raise score above mean (5000)
        for (uint256 i = 0; i < numWins; i++) {
            _runComparison(1);
        }

        uint256 scoreBeforeDecay = oracle.getTrustProfile(alice).score;

        // Advance time for decay
        vm.warp(block.timestamp + decayPeriods * 30 days);

        // Trigger decay via new comparison
        _runComparison(3); // Equivalent — no score change from comparison itself

        uint256 scoreAfterDecay = oracle.getTrustProfile(alice).score;

        if (scoreBeforeDecay > 5000) {
            assertLe(scoreAfterDecay, scoreBeforeDecay, "Score above mean must decrease or stay after decay");
        }
    }
}
