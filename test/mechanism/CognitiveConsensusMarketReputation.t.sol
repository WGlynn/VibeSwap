// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/CognitiveConsensusMarket.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Mock stake token for testing
contract MockStakeToken is ERC20 {
    constructor() ERC20("STAKE", "STK") {
        _mint(msg.sender, 10_000_000 ether);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/**
 * @title CognitiveConsensusMarketReputationTest
 * @notice Tests for the reputation system: EvaluatorProfile, _updateReputation,
 *         reputation-weighted voting, sqrt anti-domination, and slashing effects.
 * @author JARVIS | March 2026
 */
contract CognitiveConsensusMarketReputationTest is Test {
    CognitiveConsensusMarket public market;
    MockStakeToken public token;

    address public owner = address(this);
    address public proposer = address(0xBEEF);
    address public alice = address(0xA11CE);
    address public bob = address(0xB0B);
    address public carol = address(0xCA201);
    address public dave = address(0xDA7E);
    address public eve = address(0xE7E);

    uint256 constant BOUNTY = 1 ether;
    uint256 constant STAKE = 0.1 ether;
    uint256 constant BPS = 10_000;

    // ============ Setup ============

    function setUp() public {
        token = new MockStakeToken();
        market = new CognitiveConsensusMarket(address(token));

        // Fund accounts
        token.mint(proposer, 100 ether);
        token.mint(alice, 100 ether);
        token.mint(bob, 100 ether);
        token.mint(carol, 100 ether);
        token.mint(dave, 100 ether);
        token.mint(eve, 100 ether);

        // Approve market to spend tokens
        vm.prank(proposer);
        token.approve(address(market), type(uint256).max);
        vm.prank(alice);
        token.approve(address(market), type(uint256).max);
        vm.prank(bob);
        token.approve(address(market), type(uint256).max);
        vm.prank(carol);
        token.approve(address(market), type(uint256).max);
        vm.prank(dave);
        token.approve(address(market), type(uint256).max);
        vm.prank(eve);
        token.approve(address(market), type(uint256).max);

        // Authorize evaluators
        market.setAuthorizedEvaluator(alice, true);
        market.setAuthorizedEvaluator(bob, true);
        market.setAuthorizedEvaluator(carol, true);
        market.setAuthorizedEvaluator(dave, true);
        market.setAuthorizedEvaluator(eve, true);
    }

    // ============ Test 1: New Evaluators Start with Default Reputation ============

    function test_newEvaluatorDefaultReputation() public view {
        // Before any evaluations, profile should be zeroed out
        CognitiveConsensusMarket.EvaluatorProfile memory profile = market.getProfile(alice);
        assertEq(profile.totalEvaluations, 0, "New evaluator should have 0 evaluations");
        assertEq(profile.correctEvaluations, 0, "New evaluator should have 0 correct");
        assertEq(profile.reputationScore, 0, "New evaluator stored score starts at 0");
        assertEq(profile.totalEarned, 0, "New evaluator should have 0 earned");
        assertEq(profile.totalSlashed, 0, "New evaluator should have 0 slashed");
    }

    function test_newEvaluatorGetsDefaultReputationWeight() public {
        // When committing, a new evaluator (reputationScore == 0) gets sqrt(BPS) = sqrt(10000) = 100
        uint256 claimId = _submitClaim();

        bytes32 salt = keccak256("salt-alice");
        bytes32 reasoningHash = keccak256("reasoning-alice");
        CognitiveConsensusMarket.Verdict verdict = CognitiveConsensusMarket.Verdict.TRUE;
        bytes32 commitHash = keccak256(abi.encodePacked(verdict, reasoningHash, salt));

        vm.prank(alice);
        market.commitEvaluation(claimId, commitHash, STAKE);

        // Check the evaluation's reputation weight = sqrt(10000) = 100
        (, , , , uint256 repWeight, , ) = market.evaluations(claimId, alice);
        assertEq(repWeight, 100, "Default rep weight should be sqrt(10000) = 100");
    }

    // ============ Test 2: Correct Evaluations Increase Accuracy ============

    function test_correctEvaluationIncreasesAccuracy() public {
        // Run a claim where alice votes correctly
        _runClaimToResolution(
            CognitiveConsensusMarket.Verdict.TRUE,  // alice votes TRUE
            CognitiveConsensusMarket.Verdict.TRUE,  // bob votes TRUE
            CognitiveConsensusMarket.Verdict.FALSE   // carol votes FALSE (minority)
        );

        // Alice voted with the majority (TRUE), so she should be marked correct
        CognitiveConsensusMarket.EvaluatorProfile memory aliceProfile = market.getProfile(alice);
        assertEq(aliceProfile.totalEvaluations, 1, "Alice should have 1 evaluation");
        assertEq(aliceProfile.correctEvaluations, 1, "Alice should have 1 correct");
        // Reputation: (1/1) * 10000 = 10000
        assertEq(aliceProfile.reputationScore, 10000, "Alice rep should be 10000 (100% accuracy)");
    }

    function test_multipleCorrectEvaluationsMaintainHighAccuracy() public {
        // Run two claims, alice correct in both
        _runClaimToResolution(
            CognitiveConsensusMarket.Verdict.TRUE,
            CognitiveConsensusMarket.Verdict.TRUE,
            CognitiveConsensusMarket.Verdict.FALSE
        );

        _runClaimToResolution(
            CognitiveConsensusMarket.Verdict.FALSE,
            CognitiveConsensusMarket.Verdict.FALSE,
            CognitiveConsensusMarket.Verdict.TRUE
        );

        CognitiveConsensusMarket.EvaluatorProfile memory aliceProfile = market.getProfile(alice);
        assertEq(aliceProfile.totalEvaluations, 2, "Alice should have 2 evaluations");
        assertEq(aliceProfile.correctEvaluations, 2, "Alice should have 2 correct");
        assertEq(aliceProfile.reputationScore, 10000, "Alice rep should remain 10000");
    }

    // ============ Test 3: Incorrect Evaluations Decrease Accuracy, Floor at 1000 ============

    function test_incorrectEvaluationDecreasesAccuracy() public {
        // Carol is in the minority (FALSE when consensus is TRUE)
        _runClaimToResolution(
            CognitiveConsensusMarket.Verdict.TRUE,
            CognitiveConsensusMarket.Verdict.TRUE,
            CognitiveConsensusMarket.Verdict.FALSE
        );

        CognitiveConsensusMarket.EvaluatorProfile memory carolProfile = market.getProfile(carol);
        assertEq(carolProfile.totalEvaluations, 1, "Carol should have 1 evaluation");
        assertEq(carolProfile.correctEvaluations, 0, "Carol should have 0 correct");
        // Reputation: (0/1) * 10000 = 0, but floor = 1000
        assertEq(carolProfile.reputationScore, 1000, "Carol rep should floor at 1000 (10%)");
    }

    function test_reputationFloorAt1000() public {
        // Run 5 claims where carol is always wrong
        for (uint256 i = 0; i < 5; i++) {
            _runClaimToResolution(
                CognitiveConsensusMarket.Verdict.TRUE,
                CognitiveConsensusMarket.Verdict.TRUE,
                CognitiveConsensusMarket.Verdict.FALSE
            );
        }

        CognitiveConsensusMarket.EvaluatorProfile memory carolProfile = market.getProfile(carol);
        assertEq(carolProfile.totalEvaluations, 5, "Carol should have 5 evaluations");
        assertEq(carolProfile.correctEvaluations, 0, "Carol should have 0 correct");
        assertEq(carolProfile.reputationScore, 1000, "Floor remains 1000 after many incorrect evals");
    }

    function test_mixedAccuracyReputationCalculation() public {
        // Claim 1: alice correct
        _runClaimToResolution(
            CognitiveConsensusMarket.Verdict.TRUE,
            CognitiveConsensusMarket.Verdict.TRUE,
            CognitiveConsensusMarket.Verdict.FALSE
        );

        // Claim 2: alice incorrect (she votes TRUE, consensus is FALSE)
        _runClaimToResolution(
            CognitiveConsensusMarket.Verdict.TRUE,   // alice votes TRUE (wrong)
            CognitiveConsensusMarket.Verdict.FALSE,   // bob votes FALSE
            CognitiveConsensusMarket.Verdict.FALSE    // carol votes FALSE
        );

        CognitiveConsensusMarket.EvaluatorProfile memory aliceProfile = market.getProfile(alice);
        assertEq(aliceProfile.totalEvaluations, 2, "Alice should have 2 evaluations");
        assertEq(aliceProfile.correctEvaluations, 1, "Alice should have 1 correct");
        // Reputation: (1/2) * 10000 = 5000
        assertEq(aliceProfile.reputationScore, 5000, "Alice rep = 50% accuracy = 5000 BPS");
    }

    // ============ Test 4: Reputation Weight Uses Sqrt for Anti-Domination ============

    function test_sqrtReputationWeight() public {
        // Verify the sqrt function behavior via reputation weights during commit
        // A new evaluator with default rep (10000 BPS) gets sqrt(10000) = 100
        uint256 claimId = _submitClaim();

        bytes32 salt = keccak256("salt-new");
        bytes32 reasoningHash = keccak256("reasoning-new");
        CognitiveConsensusMarket.Verdict verdict = CognitiveConsensusMarket.Verdict.TRUE;
        bytes32 commitHash = keccak256(abi.encodePacked(verdict, reasoningHash, salt));

        vm.prank(alice);
        market.commitEvaluation(claimId, commitHash, STAKE);

        (, , , , uint256 repWeight, , ) = market.evaluations(claimId, alice);
        assertEq(repWeight, 100, "sqrt(10000) = 100");
    }

    function test_sqrtPreventsDomination() public {
        // After one correct evaluation, alice has rep 10000 -> sqrt = 100
        // After one incorrect evaluation, carol has rep 1000 -> sqrt = 31
        // The 10x reputation difference becomes roughly 3x in voting weight
        _runClaimToResolution(
            CognitiveConsensusMarket.Verdict.TRUE,
            CognitiveConsensusMarket.Verdict.TRUE,
            CognitiveConsensusMarket.Verdict.FALSE
        );

        CognitiveConsensusMarket.EvaluatorProfile memory aliceProfile = market.getProfile(alice);
        CognitiveConsensusMarket.EvaluatorProfile memory carolProfile = market.getProfile(carol);

        assertEq(aliceProfile.reputationScore, 10000, "Alice: 10000 rep");
        assertEq(carolProfile.reputationScore, 1000, "Carol: 1000 rep (floor)");

        // Now submit a new claim and have both commit to see their weights
        uint256 claimId = _submitClaim();

        bytes32 aliceSalt = keccak256("alice-salt-2");
        bytes32 aliceReasoning = keccak256("alice-reasoning-2");
        bytes32 aliceCommit = keccak256(abi.encodePacked(
            CognitiveConsensusMarket.Verdict.TRUE, aliceReasoning, aliceSalt
        ));

        bytes32 carolSalt = keccak256("carol-salt-2");
        bytes32 carolReasoning = keccak256("carol-reasoning-2");
        bytes32 carolCommit = keccak256(abi.encodePacked(
            CognitiveConsensusMarket.Verdict.TRUE, carolReasoning, carolSalt
        ));

        vm.prank(alice);
        market.commitEvaluation(claimId, aliceCommit, STAKE);
        vm.prank(carol);
        market.commitEvaluation(claimId, carolCommit, STAKE);

        (, , , , uint256 aliceWeight, , ) = market.evaluations(claimId, alice);
        (, , , , uint256 carolWeight, , ) = market.evaluations(claimId, carol);

        // sqrt(10000) = 100, sqrt(1000) = 31
        assertEq(aliceWeight, 100, "Alice weight = sqrt(10000) = 100");
        assertEq(carolWeight, 31, "Carol weight = sqrt(1000) = 31");

        // Anti-domination: 10x rep difference -> ~3.2x weight difference (not 10x)
        assertTrue(
            aliceWeight < carolWeight * 4,
            "High rep should NOT have proportional weight advantage (sqrt dampens)"
        );
        assertTrue(
            aliceWeight > carolWeight,
            "High rep should still have SOME advantage"
        );
    }

    // ============ Test 5: High-Rep Vote Carries More Weight But Not Proportionally ============

    function test_highRepVoteWeightInResolution() public {
        // Build reputations: alice always correct, carol always wrong
        _runClaimToResolution(
            CognitiveConsensusMarket.Verdict.TRUE,
            CognitiveConsensusMarket.Verdict.TRUE,
            CognitiveConsensusMarket.Verdict.FALSE
        );

        // Now alice (10000 rep) and carol (1000 rep) have different rep
        // Submit a new claim where they participate with a third evaluator
        uint256 claimId = _submitClaim();

        // alice: TRUE, carol: FALSE, dave: TRUE (dave is new, default rep)
        bytes32 aliceSalt = keccak256("a-salt-hr");
        bytes32 aliceRH = keccak256("a-reason-hr");
        bytes32 carolSalt = keccak256("c-salt-hr");
        bytes32 carolRH = keccak256("c-reason-hr");
        bytes32 daveSalt = keccak256("d-salt-hr");
        bytes32 daveRH = keccak256("d-reason-hr");

        CognitiveConsensusMarket.Verdict vTrue = CognitiveConsensusMarket.Verdict.TRUE;
        CognitiveConsensusMarket.Verdict vFalse = CognitiveConsensusMarket.Verdict.FALSE;

        // Commit
        vm.prank(alice);
        market.commitEvaluation(claimId,
            keccak256(abi.encodePacked(vTrue, aliceRH, aliceSalt)), STAKE);
        vm.prank(carol);
        market.commitEvaluation(claimId,
            keccak256(abi.encodePacked(vFalse, carolRH, carolSalt)), STAKE);
        vm.prank(dave);
        market.commitEvaluation(claimId,
            keccak256(abi.encodePacked(vTrue, daveRH, daveSalt)), STAKE);

        // Warp past commit deadline
        vm.warp(block.timestamp + 1 days + 1);

        // Reveal
        vm.prank(alice);
        market.revealEvaluation(claimId, vTrue, aliceRH, aliceSalt);
        vm.prank(carol);
        market.revealEvaluation(claimId, vFalse, carolRH, carolSalt);
        vm.prank(dave);
        market.revealEvaluation(claimId, vTrue, daveRH, daveSalt);

        // Check the tallied reputation-weighted votes
        (, , , , , , , , uint256 trueVotes, uint256 falseVotes, , , ) = market.claims(claimId);

        // alice weight = sqrt(10000) = 100, dave weight = sqrt(10000) = 100 (default)
        // carol weight = sqrt(1000) = 31
        // trueVotes = 100 + 100 = 200, falseVotes = 31
        assertEq(trueVotes, 200, "TRUE votes = alice(100) + dave(100)");
        assertEq(falseVotes, 31, "FALSE votes = carol(31)");

        // Verify carol's low rep reduced her influence but didn't eliminate it
        assertTrue(falseVotes > 0, "Low-rep evaluator still has influence");
        assertTrue(trueVotes > falseVotes, "High-rep side wins");
    }

    // ============ Test 6: Slashed Evaluators Have Reduced Reputation ============

    function test_slashedEvaluatorReducedReputation() public {
        // Carol gets slashed in first claim (incorrect vote)
        _runClaimToResolution(
            CognitiveConsensusMarket.Verdict.TRUE,
            CognitiveConsensusMarket.Verdict.TRUE,
            CognitiveConsensusMarket.Verdict.FALSE
        );

        CognitiveConsensusMarket.EvaluatorProfile memory carolProfile = market.getProfile(carol);
        assertTrue(carolProfile.totalSlashed > 0, "Carol should have been slashed");
        assertEq(carolProfile.reputationScore, 1000, "Carol rep floored after incorrect eval");

        // Carol's reduced reputation affects her future commitment weight
        uint256 claimId = _submitClaim();

        bytes32 salt = keccak256("carol-future");
        bytes32 rh = keccak256("carol-reason-future");
        bytes32 commit = keccak256(abi.encodePacked(
            CognitiveConsensusMarket.Verdict.TRUE, rh, salt
        ));

        vm.prank(carol);
        market.commitEvaluation(claimId, commit, STAKE);

        (, , , , uint256 carolWeight, , ) = market.evaluations(claimId, carol);
        // sqrt(1000) = 31 (reduced from sqrt(10000) = 100 for a new evaluator)
        assertEq(carolWeight, 31, "Slashed evaluator gets reduced weight sqrt(1000) = 31");

        // Compare with a fresh evaluator (eve, never evaluated)
        bytes32 eveSalt = keccak256("eve-fresh");
        bytes32 eveRH = keccak256("eve-reason-fresh");
        bytes32 eveCommit = keccak256(abi.encodePacked(
            CognitiveConsensusMarket.Verdict.TRUE, eveRH, eveSalt
        ));

        vm.prank(eve);
        market.commitEvaluation(claimId, eveCommit, STAKE);

        (, , , , uint256 eveWeight, , ) = market.evaluations(claimId, eve);
        assertEq(eveWeight, 100, "Fresh evaluator gets default weight sqrt(10000) = 100");

        // Slashed evaluator has significantly less influence than a fresh one
        assertTrue(carolWeight < eveWeight, "Slashed evaluator has less weight than fresh");
    }

    function test_reputationRecoveryAfterCorrectEvals() public {
        // Carol gets one wrong
        _runClaimToResolution(
            CognitiveConsensusMarket.Verdict.TRUE,
            CognitiveConsensusMarket.Verdict.TRUE,
            CognitiveConsensusMarket.Verdict.FALSE
        );

        CognitiveConsensusMarket.EvaluatorProfile memory carolBefore = market.getProfile(carol);
        assertEq(carolBefore.reputationScore, 1000, "Carol at floor after first eval");

        // Carol gets one right (she votes FALSE, majority is FALSE)
        _runClaimToResolution(
            CognitiveConsensusMarket.Verdict.FALSE,   // alice (wrong this time)
            CognitiveConsensusMarket.Verdict.TRUE,     // bob (wrong)
            CognitiveConsensusMarket.Verdict.FALSE     // carol (right? no - need majority FALSE)
        );

        // Wait -- alice=FALSE, bob=TRUE, carol=FALSE. FALSE has more rep-weight.
        // Alice: sqrt(10000)=100, Bob: sqrt(10000)=100, Carol: sqrt(1000)=31
        // FALSE votes: alice(100) + carol(31) = 131, TRUE votes: bob(100)
        // Consensus = FALSE. Carol is correct this time!
        CognitiveConsensusMarket.EvaluatorProfile memory carolAfter = market.getProfile(carol);
        assertEq(carolAfter.totalEvaluations, 2, "Carol has 2 evals");
        assertEq(carolAfter.correctEvaluations, 1, "Carol now has 1 correct");
        // Reputation: (1/2) * 10000 = 5000
        assertEq(carolAfter.reputationScore, 5000, "Carol recovers to 5000 after 1/2 correct");
    }

    function test_unreveledEvaluatorSlashedButNoReputationChange() public {
        uint256 claimId = _submitClaim();

        CognitiveConsensusMarket.Verdict vTrue = CognitiveConsensusMarket.Verdict.TRUE;
        CognitiveConsensusMarket.Verdict vFalse = CognitiveConsensusMarket.Verdict.FALSE;

        // alice, bob, carol commit. dave commits but won't reveal.
        _commitEval(claimId, alice, vTrue, "a-salt-unr", "a-rh-unr");
        _commitEval(claimId, bob, vTrue, "b-salt-unr", "b-rh-unr");
        _commitEval(claimId, carol, vFalse, "c-salt-unr", "c-rh-unr");
        _commitEval(claimId, dave, vTrue, "d-salt-unr", "d-rh-unr");

        // Warp past commit deadline
        vm.warp(block.timestamp + 1 days + 1);

        // Only alice, bob, carol reveal. Dave does NOT.
        _revealEval(claimId, alice, vTrue, "a-rh-unr", "a-salt-unr");
        _revealEval(claimId, bob, vTrue, "b-rh-unr", "b-salt-unr");
        _revealEval(claimId, carol, vFalse, "c-rh-unr", "c-salt-unr");

        // Warp past reveal deadline and resolve
        vm.warp(block.timestamp + 12 hours + 1);
        market.resolveClaim(claimId);

        // Dave was slashed for not revealing
        CognitiveConsensusMarket.EvaluatorProfile memory daveProfile = market.getProfile(dave);
        assertTrue(daveProfile.totalSlashed > 0, "Dave slashed for not revealing");
        // But dave's totalEvaluations should be 0 (unrevealed doesn't count)
        assertEq(daveProfile.totalEvaluations, 0, "Unrevealed doesn't increment totalEvaluations");
        // Reputation stays at default (0 stored, treated as BPS when committing)
        assertEq(daveProfile.reputationScore, 0, "Unrevealed doesn't update reputation score");
    }

    // ============ Helpers ============

    /// @dev Submit a claim from the proposer with standard params
    function _submitClaim() internal returns (uint256 claimId) {
        vm.prank(proposer);
        claimId = market.submitClaim(
            keccak256(abi.encodePacked("test-claim-", block.timestamp, block.number)),
            BOUNTY,
            3 // minEvaluators
        );
    }

    /// @dev Commit an evaluation for an evaluator
    function _commitEval(
        uint256 claimId,
        address evaluator,
        CognitiveConsensusMarket.Verdict verdict,
        string memory saltStr,
        string memory reasonStr
    ) internal {
        bytes32 salt = keccak256(bytes(saltStr));
        bytes32 reasoningHash = keccak256(bytes(reasonStr));
        bytes32 commitHash = keccak256(abi.encodePacked(verdict, reasoningHash, salt));

        vm.prank(evaluator);
        market.commitEvaluation(claimId, commitHash, STAKE);
    }

    /// @dev Reveal an evaluation for an evaluator
    function _revealEval(
        uint256 claimId,
        address evaluator,
        CognitiveConsensusMarket.Verdict verdict,
        string memory reasonStr,
        string memory saltStr
    ) internal {
        bytes32 salt = keccak256(bytes(saltStr));
        bytes32 reasoningHash = keccak256(bytes(reasonStr));

        vm.prank(evaluator);
        market.revealEvaluation(claimId, verdict, reasoningHash, salt);
    }

    /// @dev Run a full claim lifecycle (submit, commit, reveal, resolve) with 3 evaluators
    ///      aliceVerdict, bobVerdict, carolVerdict are the verdicts each evaluator submits
    function _runClaimToResolution(
        CognitiveConsensusMarket.Verdict aliceVerdict,
        CognitiveConsensusMarket.Verdict bobVerdict,
        CognitiveConsensusMarket.Verdict carolVerdict
    ) internal {
        uint256 claimId = _submitClaim();

        // Generate unique salts using claimId to avoid collisions across calls
        string memory suffix = string(abi.encodePacked(vm.toString(claimId)));

        string memory aliceSaltStr = string(abi.encodePacked("alice-salt-", suffix));
        string memory aliceReasonStr = string(abi.encodePacked("alice-reason-", suffix));
        string memory bobSaltStr = string(abi.encodePacked("bob-salt-", suffix));
        string memory bobReasonStr = string(abi.encodePacked("bob-reason-", suffix));
        string memory carolSaltStr = string(abi.encodePacked("carol-salt-", suffix));
        string memory carolReasonStr = string(abi.encodePacked("carol-reason-", suffix));

        // Commit phase
        _commitEval(claimId, alice, aliceVerdict, aliceSaltStr, aliceReasonStr);
        _commitEval(claimId, bob, bobVerdict, bobSaltStr, bobReasonStr);
        _commitEval(claimId, carol, carolVerdict, carolSaltStr, carolReasonStr);

        // Warp past commit deadline
        vm.warp(block.timestamp + 1 days + 1);

        // Reveal phase
        _revealEval(claimId, alice, aliceVerdict, aliceReasonStr, aliceSaltStr);
        _revealEval(claimId, bob, bobVerdict, bobReasonStr, bobSaltStr);
        _revealEval(claimId, carol, carolVerdict, carolReasonStr, carolSaltStr);

        // Warp past reveal deadline
        vm.warp(block.timestamp + 12 hours + 1);

        // Resolve
        market.resolveClaim(claimId);
    }
}
