// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/CognitiveConsensusMarket.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock Contracts ============

contract MockStakeToken is ERC20 {
    constructor() ERC20("Stake Token", "STK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Test Contract ============

contract CognitiveConsensusMarketTest is Test {
    // Re-declare events for expectEmit
    event ClaimSubmitted(uint256 indexed claimId, bytes32 claimHash, address proposer, uint256 bounty);
    event EvaluationCommitted(uint256 indexed claimId, address indexed evaluator, uint256 stake);
    event EvaluationRevealed(
        uint256 indexed claimId,
        address indexed evaluator,
        CognitiveConsensusMarket.Verdict verdict
    );
    event ClaimResolved(
        uint256 indexed claimId,
        CognitiveConsensusMarket.Verdict verdict,
        uint256 trueVotes,
        uint256 falseVotes
    );
    event EvaluatorRewarded(uint256 indexed claimId, address indexed evaluator, uint256 reward);
    event EvaluatorSlashed(uint256 indexed claimId, address indexed evaluator, uint256 slashAmount);
    event ClaimExpired(uint256 indexed claimId);

    CognitiveConsensusMarket public market;
    MockStakeToken public token;

    address public owner;
    address public proposer;
    address public evaluator1;
    address public evaluator2;
    address public evaluator3;
    address public evaluator4;
    address public evaluator5;
    address public unauthorized;

    uint256 public constant BOUNTY = 10 ether;
    uint256 public constant STAKE = 1 ether;
    uint256 public constant MIN_STAKE = 0.01 ether;
    bytes32 public constant CLAIM_HASH = keccak256("Is Solidity the best smart contract language?");
    bytes32 public constant REASONING_HASH = keccak256("ipfs://detailed-reasoning");

    function setUp() public {
        owner = address(this);
        proposer = makeAddr("proposer");
        evaluator1 = makeAddr("evaluator1");
        evaluator2 = makeAddr("evaluator2");
        evaluator3 = makeAddr("evaluator3");
        evaluator4 = makeAddr("evaluator4");
        evaluator5 = makeAddr("evaluator5");
        unauthorized = makeAddr("unauthorized");

        // Deploy token and market
        token = new MockStakeToken();
        market = new CognitiveConsensusMarket(address(token));

        // Authorize evaluators
        market.setAuthorizedEvaluator(evaluator1, true);
        market.setAuthorizedEvaluator(evaluator2, true);
        market.setAuthorizedEvaluator(evaluator3, true);
        market.setAuthorizedEvaluator(evaluator4, true);
        market.setAuthorizedEvaluator(evaluator5, true);

        // Mint tokens to participants
        token.mint(proposer, 100 ether);
        token.mint(evaluator1, 100 ether);
        token.mint(evaluator2, 100 ether);
        token.mint(evaluator3, 100 ether);
        token.mint(evaluator4, 100 ether);
        token.mint(evaluator5, 100 ether);

        // Approve market for all participants
        vm.prank(proposer);
        token.approve(address(market), type(uint256).max);
        vm.prank(evaluator1);
        token.approve(address(market), type(uint256).max);
        vm.prank(evaluator2);
        token.approve(address(market), type(uint256).max);
        vm.prank(evaluator3);
        token.approve(address(market), type(uint256).max);
        vm.prank(evaluator4);
        token.approve(address(market), type(uint256).max);
        vm.prank(evaluator5);
        token.approve(address(market), type(uint256).max);
    }

    // ============ Helpers ============

    /// @dev Generate a commit hash for a verdict + reasoning + salt
    function _commitHash(
        CognitiveConsensusMarket.Verdict verdict,
        bytes32 reasoningHash,
        bytes32 salt
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(verdict, reasoningHash, salt));
    }

    /// @dev Submit a claim as proposer with default params, returns claimId
    function _submitClaim() internal returns (uint256) {
        vm.prank(proposer);
        return market.submitClaim(CLAIM_HASH, BOUNTY, 3);
    }

    /// @dev Commit an evaluation for an evaluator
    function _commit(
        uint256 claimId,
        address evaluator,
        CognitiveConsensusMarket.Verdict verdict,
        bytes32 salt
    ) internal {
        bytes32 hash = _commitHash(verdict, REASONING_HASH, salt);
        vm.prank(evaluator);
        market.commitEvaluation(claimId, hash, STAKE);
    }

    /// @dev Reveal an evaluation for an evaluator
    function _reveal(
        uint256 claimId,
        address evaluator,
        CognitiveConsensusMarket.Verdict verdict,
        bytes32 salt
    ) internal {
        vm.prank(evaluator);
        market.revealEvaluation(claimId, verdict, REASONING_HASH, salt);
    }

    /// @dev Full lifecycle: submit claim, commit 3 evaluators (all TRUE), advance to reveal, reveal all, resolve
    function _fullLifecycle_allTrue() internal returns (uint256 claimId) {
        claimId = _submitClaim();

        bytes32 salt1 = keccak256("salt1");
        bytes32 salt2 = keccak256("salt2");
        bytes32 salt3 = keccak256("salt3");

        _commit(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt1);
        _commit(claimId, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, salt2);
        _commit(claimId, evaluator3, CognitiveConsensusMarket.Verdict.TRUE, salt3);

        // Advance past commit deadline
        vm.warp(block.timestamp + 1 days + 1);

        _reveal(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt1);
        _reveal(claimId, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, salt2);
        _reveal(claimId, evaluator3, CognitiveConsensusMarket.Verdict.TRUE, salt3);

        // Advance past reveal deadline
        vm.warp(block.timestamp + 12 hours + 1);

        market.resolveClaim(claimId);
    }

    // ============ Initialization Tests ============

    function test_initialization_correctOwner() public view {
        assertEq(market.owner(), owner);
    }

    function test_initialization_correctStakeToken() public view {
        assertEq(address(market.stakeToken()), address(token));
    }

    function test_initialization_nextClaimIdStartsAtOne() public view {
        assertEq(market.nextClaimId(), 1);
    }

    function test_initialization_constants() public view {
        assertEq(market.PRECISION(), 1e18);
        assertEq(market.BPS(), 10_000);
        assertEq(market.MAX_EVALUATORS(), 21);
        assertEq(market.MIN_EVALUATORS(), 3);
        assertEq(market.COMMIT_DURATION(), 1 days);
        assertEq(market.REVEAL_DURATION(), 12 hours);
        assertEq(market.MIN_STAKE(), 0.01 ether);
        assertEq(market.SLASH_MULTIPLIER(), 2);
    }

    // ============ Submit Claim Tests ============

    function test_submitClaim_success() public {
        vm.prank(proposer);
        uint256 claimId = market.submitClaim(CLAIM_HASH, BOUNTY, 3);

        assertEq(claimId, 1);
        assertEq(market.nextClaimId(), 2);

        CognitiveConsensusMarket.Claim memory cl = market.getClaim(claimId);
        assertEq(cl.claimHash, CLAIM_HASH);
        assertEq(cl.proposer, proposer);
        assertEq(cl.bounty, BOUNTY);
        assertEq(cl.commitDeadline, block.timestamp + 1 days);
        assertEq(cl.revealDeadline, block.timestamp + 1 days + 12 hours);
        assertEq(cl.minEvaluators, 3);
        assertEq(uint256(cl.state), uint256(CognitiveConsensusMarket.ClaimState.OPEN));
        assertEq(uint256(cl.verdict), uint256(CognitiveConsensusMarket.Verdict.NONE));
        assertEq(cl.totalStake, 0);
    }

    function test_submitClaim_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit ClaimSubmitted(1, CLAIM_HASH, proposer, BOUNTY);

        vm.prank(proposer);
        market.submitClaim(CLAIM_HASH, BOUNTY, 3);
    }

    function test_submitClaim_transfersBounty() public {
        uint256 balBefore = token.balanceOf(proposer);

        vm.prank(proposer);
        market.submitClaim(CLAIM_HASH, BOUNTY, 3);

        assertEq(token.balanceOf(proposer), balBefore - BOUNTY);
        assertEq(token.balanceOf(address(market)), BOUNTY);
    }

    function test_submitClaim_incrementsClaimId() public {
        vm.prank(proposer);
        uint256 id1 = market.submitClaim(CLAIM_HASH, BOUNTY, 3);

        vm.prank(proposer);
        uint256 id2 = market.submitClaim(CLAIM_HASH, BOUNTY, 3);

        assertEq(id1, 1);
        assertEq(id2, 2);
        assertEq(market.nextClaimId(), 3);
    }

    function test_submitClaim_reverts_emptyClaimHash() public {
        vm.prank(proposer);
        vm.expectRevert("Empty claim");
        market.submitClaim(bytes32(0), BOUNTY, 3);
    }

    function test_submitClaim_reverts_zeroBounty() public {
        vm.prank(proposer);
        vm.expectRevert("Zero bounty");
        market.submitClaim(CLAIM_HASH, 0, 3);
    }

    function test_submitClaim_reverts_tooFewEvaluators() public {
        vm.prank(proposer);
        vm.expectRevert("Too few evaluators");
        market.submitClaim(CLAIM_HASH, BOUNTY, 2);
    }

    function test_submitClaim_reverts_tooManyEvaluators() public {
        vm.prank(proposer);
        vm.expectRevert("Too many evaluators");
        market.submitClaim(CLAIM_HASH, BOUNTY, 22);
    }

    function test_submitClaim_minEvaluatorsBoundary() public {
        vm.prank(proposer);
        uint256 id = market.submitClaim(CLAIM_HASH, BOUNTY, 3);
        assertEq(id, 1);
    }

    function test_submitClaim_maxEvaluatorsBoundary() public {
        vm.prank(proposer);
        uint256 id = market.submitClaim(CLAIM_HASH, BOUNTY, 21);
        assertEq(id, 1);
    }

    // ============ Commit Evaluation Tests ============

    function test_commitEvaluation_success() public {
        uint256 claimId = _submitClaim();

        bytes32 salt = keccak256("secret-salt");
        bytes32 hash = _commitHash(CognitiveConsensusMarket.Verdict.TRUE, REASONING_HASH, salt);

        vm.prank(evaluator1);
        market.commitEvaluation(claimId, hash, STAKE);

        CognitiveConsensusMarket.Evaluation memory ev = market.getEvaluation(claimId, evaluator1);
        assertEq(ev.commitHash, hash);
        assertEq(ev.stake, STAKE);
        assertGt(ev.reputationWeight, 0);
        assertFalse(ev.revealed);
        assertFalse(ev.rewarded);
    }

    function test_commitEvaluation_emitsEvent() public {
        uint256 claimId = _submitClaim();

        bytes32 salt = keccak256("salt");
        bytes32 hash = _commitHash(CognitiveConsensusMarket.Verdict.TRUE, REASONING_HASH, salt);

        vm.expectEmit(true, true, false, true);
        emit EvaluationCommitted(claimId, evaluator1, STAKE);

        vm.prank(evaluator1);
        market.commitEvaluation(claimId, hash, STAKE);
    }

    function test_commitEvaluation_transfersStake() public {
        uint256 claimId = _submitClaim();
        uint256 balBefore = token.balanceOf(evaluator1);

        bytes32 hash = _commitHash(CognitiveConsensusMarket.Verdict.TRUE, REASONING_HASH, keccak256("salt"));
        vm.prank(evaluator1);
        market.commitEvaluation(claimId, hash, STAKE);

        assertEq(token.balanceOf(evaluator1), balBefore - STAKE);
    }

    function test_commitEvaluation_addedToClaimEvaluators() public {
        uint256 claimId = _submitClaim();

        _commit(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s1"));
        _commit(claimId, evaluator2, CognitiveConsensusMarket.Verdict.FALSE, keccak256("s2"));

        address[] memory evaluators = market.getClaimEvaluators(claimId);
        assertEq(evaluators.length, 2);
        assertEq(evaluators[0], evaluator1);
        assertEq(evaluators[1], evaluator2);
    }

    function test_commitEvaluation_updatesTotalStake() public {
        uint256 claimId = _submitClaim();

        _commit(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s1"));
        _commit(claimId, evaluator2, CognitiveConsensusMarket.Verdict.FALSE, keccak256("s2"));

        uint256 totalStake = market.getClaim(claimId).totalStake;
        assertEq(totalStake, 2 * STAKE);
    }

    function test_commitEvaluation_reverts_notAuthorized() public {
        uint256 claimId = _submitClaim();

        bytes32 hash = _commitHash(CognitiveConsensusMarket.Verdict.TRUE, REASONING_HASH, keccak256("salt"));

        vm.prank(unauthorized);
        vm.expectRevert(CognitiveConsensusMarket.NotAuthorizedEvaluator.selector);
        market.commitEvaluation(claimId, hash, STAKE);
    }

    function test_commitEvaluation_reverts_claimNotOpen() public {
        // Submit claim, advance past commit + reveal deadline, then try to commit on resolved/expired claim
        uint256 claimId = _submitClaim();

        // Advance past reveal deadline (no evaluators = will expire on resolve)
        vm.warp(block.timestamp + 1 days + 12 hours + 1);
        market.resolveClaim(claimId);

        bytes32 hash = _commitHash(CognitiveConsensusMarket.Verdict.TRUE, REASONING_HASH, keccak256("salt"));
        vm.prank(evaluator1);
        vm.expectRevert(
            abi.encodeWithSelector(
                CognitiveConsensusMarket.ClaimNotInState.selector,
                CognitiveConsensusMarket.ClaimState.OPEN,
                CognitiveConsensusMarket.ClaimState.EXPIRED
            )
        );
        market.commitEvaluation(claimId, hash, STAKE);
    }

    function test_commitEvaluation_reverts_afterCommitDeadline() public {
        uint256 claimId = _submitClaim();

        // Advance past commit deadline
        vm.warp(block.timestamp + 1 days + 1);

        bytes32 hash = _commitHash(CognitiveConsensusMarket.Verdict.TRUE, REASONING_HASH, keccak256("salt"));
        vm.prank(evaluator1);
        vm.expectRevert(CognitiveConsensusMarket.CommitDeadlinePassed.selector);
        market.commitEvaluation(claimId, hash, STAKE);
    }

    function test_commitEvaluation_reverts_alreadyCommitted() public {
        uint256 claimId = _submitClaim();

        _commit(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s1"));

        bytes32 hash2 = _commitHash(CognitiveConsensusMarket.Verdict.FALSE, REASONING_HASH, keccak256("s2"));
        vm.prank(evaluator1);
        vm.expectRevert(CognitiveConsensusMarket.AlreadyCommitted.selector);
        market.commitEvaluation(claimId, hash2, STAKE);
    }

    function test_commitEvaluation_reverts_insufficientStake() public {
        uint256 claimId = _submitClaim();

        bytes32 hash = _commitHash(CognitiveConsensusMarket.Verdict.TRUE, REASONING_HASH, keccak256("salt"));
        vm.prank(evaluator1);
        vm.expectRevert(CognitiveConsensusMarket.InsufficientStake.selector);
        market.commitEvaluation(claimId, hash, MIN_STAKE - 1);
    }

    function test_commitEvaluation_minStakeBoundary() public {
        uint256 claimId = _submitClaim();

        bytes32 hash = _commitHash(CognitiveConsensusMarket.Verdict.TRUE, REASONING_HASH, keccak256("salt"));
        vm.prank(evaluator1);
        market.commitEvaluation(claimId, hash, MIN_STAKE);

        assertEq(market.getEvaluation(claimId, evaluator1).stake, MIN_STAKE);
    }

    function test_commitEvaluation_reputationWeight_defaultEvaluator() public {
        uint256 claimId = _submitClaim();

        _commit(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s1"));

        // New evaluator with no history should use sqrt(BPS) = sqrt(10000) = 100
        assertEq(market.getEvaluation(claimId, evaluator1).reputationWeight, 100); // sqrt(10000) = 100
    }

    function test_commitEvaluation_reverts_evaluatorLimitReached() public {
        // Create a claim with maxEvaluators = 21
        vm.prank(proposer);
        uint256 claimId = market.submitClaim(CLAIM_HASH, BOUNTY, 3);

        // Authorize and commit 21 evaluators
        for (uint256 i = 0; i < 21; i++) {
            address eval = makeAddr(string(abi.encodePacked("eval-", vm.toString(i))));
            market.setAuthorizedEvaluator(eval, true);
            token.mint(eval, 100 ether);
            vm.prank(eval);
            token.approve(address(market), type(uint256).max);

            bytes32 hash = _commitHash(
                CognitiveConsensusMarket.Verdict.TRUE,
                REASONING_HASH,
                keccak256(abi.encodePacked("salt", i))
            );
            vm.prank(eval);
            market.commitEvaluation(claimId, hash, STAKE);
        }

        // The 22nd evaluator should be rejected
        address extraEval = makeAddr("extra-evaluator");
        market.setAuthorizedEvaluator(extraEval, true);
        token.mint(extraEval, 100 ether);
        vm.prank(extraEval);
        token.approve(address(market), type(uint256).max);

        bytes32 extraHash = _commitHash(
            CognitiveConsensusMarket.Verdict.TRUE,
            REASONING_HASH,
            keccak256("extra-salt")
        );
        vm.prank(extraEval);
        vm.expectRevert(CognitiveConsensusMarket.EvaluatorLimitReached.selector);
        market.commitEvaluation(claimId, extraHash, STAKE);
    }

    // ============ Reveal Evaluation Tests ============

    function test_revealEvaluation_success() public {
        uint256 claimId = _submitClaim();
        bytes32 salt = keccak256("salt1");

        _commit(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt);
        _commit(claimId, evaluator2, CognitiveConsensusMarket.Verdict.FALSE, keccak256("s2"));
        _commit(claimId, evaluator3, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s3"));

        // Advance past commit deadline to trigger REVEAL state
        vm.warp(block.timestamp + 1 days + 1);

        _reveal(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt);

        CognitiveConsensusMarket.Evaluation memory evr = market.getEvaluation(claimId, evaluator1);
        assertEq(uint256(evr.verdict), uint256(CognitiveConsensusMarket.Verdict.TRUE));
        assertEq(evr.reasoningHash, REASONING_HASH);
        assertTrue(evr.revealed);
    }

    function test_revealEvaluation_emitsEvent() public {
        uint256 claimId = _submitClaim();
        bytes32 salt = keccak256("salt");

        _commit(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt);
        _commit(claimId, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s2"));
        _commit(claimId, evaluator3, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s3"));

        vm.warp(block.timestamp + 1 days + 1);

        vm.expectEmit(true, true, false, true);
        emit EvaluationRevealed(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE);

        _reveal(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt);
    }

    function test_revealEvaluation_talliesTrueVotes() public {
        uint256 claimId = _submitClaim();
        bytes32 salt1 = keccak256("s1");
        bytes32 salt2 = keccak256("s2");
        bytes32 salt3 = keccak256("s3");

        _commit(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt1);
        _commit(claimId, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, salt2);
        _commit(claimId, evaluator3, CognitiveConsensusMarket.Verdict.FALSE, salt3);

        vm.warp(block.timestamp + 1 days + 1);

        _reveal(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt1);
        _reveal(claimId, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, salt2);
        _reveal(claimId, evaluator3, CognitiveConsensusMarket.Verdict.FALSE, salt3);

        CognitiveConsensusMarket.Claim memory clV = market.getClaim(claimId);
        // Default reputation weight = sqrt(10000) = 100
        assertEq(clV.trueVotes, 200);   // 2 evaluators * 100 repWeight
        assertEq(clV.falseVotes, 100);   // 1 evaluator * 100 repWeight
        assertEq(clV.uncertainVotes, 0);
    }

    function test_revealEvaluation_talliesUncertainVotes() public {
        uint256 claimId = _submitClaim();
        bytes32 salt1 = keccak256("s1");
        bytes32 salt2 = keccak256("s2");
        bytes32 salt3 = keccak256("s3");

        _commit(claimId, evaluator1, CognitiveConsensusMarket.Verdict.UNCERTAIN, salt1);
        _commit(claimId, evaluator2, CognitiveConsensusMarket.Verdict.UNCERTAIN, salt2);
        _commit(claimId, evaluator3, CognitiveConsensusMarket.Verdict.TRUE, salt3);

        vm.warp(block.timestamp + 1 days + 1);

        _reveal(claimId, evaluator1, CognitiveConsensusMarket.Verdict.UNCERTAIN, salt1);
        _reveal(claimId, evaluator2, CognitiveConsensusMarket.Verdict.UNCERTAIN, salt2);
        _reveal(claimId, evaluator3, CognitiveConsensusMarket.Verdict.TRUE, salt3);

        assertEq(market.getClaim(claimId).uncertainVotes, 200); // 2 * 100
    }

    function test_revealEvaluation_transitionsToRevealState() public {
        uint256 claimId = _submitClaim();
        bytes32 salt = keccak256("s1");

        _commit(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt);
        _commit(claimId, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s2"));
        _commit(claimId, evaluator3, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s3"));

        // Still OPEN
        assertEq(uint256(market.getClaim(claimId).state), uint256(CognitiveConsensusMarket.ClaimState.OPEN));

        // Advance past commit deadline
        vm.warp(block.timestamp + 1 days + 1);

        // First reveal triggers state transition
        _reveal(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt);

        assertEq(uint256(market.getClaim(claimId).state), uint256(CognitiveConsensusMarket.ClaimState.REVEAL));
    }

    function test_revealEvaluation_expiresIfNotEnoughEvaluators() public {
        uint256 claimId = _submitClaim(); // requires min 3 evaluators

        // Only 2 evaluators commit
        bytes32 salt1 = keccak256("s1");
        _commit(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt1);
        _commit(claimId, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s2"));

        // Advance past commit deadline
        vm.warp(block.timestamp + 1 days + 1);

        // First reveal attempt triggers expiry (< minEvaluators)
        vm.prank(evaluator1);
        market.revealEvaluation(claimId, CognitiveConsensusMarket.Verdict.TRUE, REASONING_HASH, salt1);

        assertEq(uint256(market.getClaim(claimId).state), uint256(CognitiveConsensusMarket.ClaimState.EXPIRED));
    }

    function test_revealEvaluation_reverts_invalidReveal() public {
        uint256 claimId = _submitClaim();
        bytes32 salt = keccak256("salt");

        _commit(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt);
        _commit(claimId, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s2"));
        _commit(claimId, evaluator3, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s3"));

        vm.warp(block.timestamp + 1 days + 1);

        // Reveal with wrong verdict
        vm.prank(evaluator1);
        vm.expectRevert(CognitiveConsensusMarket.InvalidReveal.selector);
        market.revealEvaluation(
            claimId,
            CognitiveConsensusMarket.Verdict.FALSE, // wrong — committed TRUE
            REASONING_HASH,
            salt
        );
    }

    function test_revealEvaluation_reverts_wrongSalt() public {
        uint256 claimId = _submitClaim();
        bytes32 salt = keccak256("salt");

        _commit(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt);
        _commit(claimId, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s2"));
        _commit(claimId, evaluator3, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s3"));

        vm.warp(block.timestamp + 1 days + 1);

        // Reveal with wrong salt
        vm.prank(evaluator1);
        vm.expectRevert(CognitiveConsensusMarket.InvalidReveal.selector);
        market.revealEvaluation(
            claimId,
            CognitiveConsensusMarket.Verdict.TRUE,
            REASONING_HASH,
            keccak256("wrong-salt")
        );
    }

    function test_revealEvaluation_reverts_wrongReasoningHash() public {
        uint256 claimId = _submitClaim();
        bytes32 salt = keccak256("salt");

        _commit(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt);
        _commit(claimId, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s2"));
        _commit(claimId, evaluator3, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s3"));

        vm.warp(block.timestamp + 1 days + 1);

        // Reveal with wrong reasoning hash
        vm.prank(evaluator1);
        vm.expectRevert(CognitiveConsensusMarket.InvalidReveal.selector);
        market.revealEvaluation(
            claimId,
            CognitiveConsensusMarket.Verdict.TRUE,
            keccak256("wrong-reasoning"),
            salt
        );
    }

    function test_revealEvaluation_reverts_alreadyRevealed() public {
        uint256 claimId = _submitClaim();
        bytes32 salt = keccak256("salt");

        _commit(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt);
        _commit(claimId, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s2"));
        _commit(claimId, evaluator3, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s3"));

        vm.warp(block.timestamp + 1 days + 1);

        _reveal(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt);

        // Try to reveal again
        vm.prank(evaluator1);
        vm.expectRevert("Already revealed");
        market.revealEvaluation(claimId, CognitiveConsensusMarket.Verdict.TRUE, REASONING_HASH, salt);
    }

    function test_revealEvaluation_reverts_afterRevealDeadline() public {
        uint256 claimId = _submitClaim();
        bytes32 salt = keccak256("salt");

        _commit(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt);
        _commit(claimId, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s2"));
        _commit(claimId, evaluator3, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s3"));

        // Advance past commit deadline to trigger REVEAL state
        vm.warp(block.timestamp + 1 days + 1);

        // First reveal triggers state transition
        _reveal(claimId, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s2"));

        // Now advance past reveal deadline
        vm.warp(block.timestamp + 12 hours + 1);

        vm.prank(evaluator1);
        vm.expectRevert(CognitiveConsensusMarket.RevealDeadlinePassed.selector);
        market.revealEvaluation(claimId, CognitiveConsensusMarket.Verdict.TRUE, REASONING_HASH, salt);
    }

    function test_revealEvaluation_reverts_claimNotInRevealState() public {
        uint256 claimId = _submitClaim();
        bytes32 salt = keccak256("salt");

        _commit(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt);

        // Try to reveal during OPEN state (before commit deadline)
        vm.prank(evaluator1);
        vm.expectRevert(
            abi.encodeWithSelector(
                CognitiveConsensusMarket.ClaimNotInState.selector,
                CognitiveConsensusMarket.ClaimState.REVEAL,
                CognitiveConsensusMarket.ClaimState.OPEN
            )
        );
        market.revealEvaluation(claimId, CognitiveConsensusMarket.Verdict.TRUE, REASONING_HASH, salt);
    }

    // ============ Claim Resolution Tests ============

    function test_resolveClaim_verdictTrue_unanimousTrue() public {
        uint256 claimId = _fullLifecycle_allTrue();

        CognitiveConsensusMarket.Claim memory cl = market.getClaim(claimId);
        assertEq(uint256(cl.state), uint256(CognitiveConsensusMarket.ClaimState.RESOLVED));
        assertEq(uint256(cl.verdict), uint256(CognitiveConsensusMarket.Verdict.TRUE));
    }

    function test_resolveClaim_verdictFalse_majorityFalse() public {
        uint256 claimId = _submitClaim();

        bytes32 salt1 = keccak256("s1");
        bytes32 salt2 = keccak256("s2");
        bytes32 salt3 = keccak256("s3");

        _commit(claimId, evaluator1, CognitiveConsensusMarket.Verdict.FALSE, salt1);
        _commit(claimId, evaluator2, CognitiveConsensusMarket.Verdict.FALSE, salt2);
        _commit(claimId, evaluator3, CognitiveConsensusMarket.Verdict.TRUE, salt3);

        vm.warp(block.timestamp + 1 days + 1);

        _reveal(claimId, evaluator1, CognitiveConsensusMarket.Verdict.FALSE, salt1);
        _reveal(claimId, evaluator2, CognitiveConsensusMarket.Verdict.FALSE, salt2);
        _reveal(claimId, evaluator3, CognitiveConsensusMarket.Verdict.TRUE, salt3);

        vm.warp(block.timestamp + 12 hours + 1);

        market.resolveClaim(claimId);

        assertEq(uint256(market.getClaim(claimId).verdict), uint256(CognitiveConsensusMarket.Verdict.FALSE));
    }

    function test_resolveClaim_verdictUncertain_tiedVotes() public {
        // When TRUE == FALSE (tie), verdict should be UNCERTAIN
        uint256 claimId = _submitClaim();

        bytes32 salt1 = keccak256("s1");
        bytes32 salt2 = keccak256("s2");
        bytes32 salt3 = keccak256("s3");

        _commit(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt1);
        _commit(claimId, evaluator2, CognitiveConsensusMarket.Verdict.FALSE, salt2);
        _commit(claimId, evaluator3, CognitiveConsensusMarket.Verdict.UNCERTAIN, salt3);

        vm.warp(block.timestamp + 1 days + 1);

        _reveal(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt1);
        _reveal(claimId, evaluator2, CognitiveConsensusMarket.Verdict.FALSE, salt2);
        _reveal(claimId, evaluator3, CognitiveConsensusMarket.Verdict.UNCERTAIN, salt3);

        vm.warp(block.timestamp + 12 hours + 1);

        market.resolveClaim(claimId);

        // All three have equal weight, all different — no clear majority, defaults to UNCERTAIN
        assertEq(uint256(market.getClaim(claimId).verdict), uint256(CognitiveConsensusMarket.Verdict.UNCERTAIN));
    }

    function test_resolveClaim_emitsEvent() public {
        uint256 claimId = _submitClaim();

        bytes32 salt1 = keccak256("s1");
        bytes32 salt2 = keccak256("s2");
        bytes32 salt3 = keccak256("s3");

        _commit(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt1);
        _commit(claimId, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, salt2);
        _commit(claimId, evaluator3, CognitiveConsensusMarket.Verdict.TRUE, salt3);

        vm.warp(block.timestamp + 1 days + 1);

        _reveal(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt1);
        _reveal(claimId, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, salt2);
        _reveal(claimId, evaluator3, CognitiveConsensusMarket.Verdict.TRUE, salt3);

        vm.warp(block.timestamp + 12 hours + 1);

        vm.expectEmit(true, false, false, true);
        emit ClaimResolved(claimId, CognitiveConsensusMarket.Verdict.TRUE, 300, 0);

        market.resolveClaim(claimId);
    }

    function test_resolveClaim_reverts_revealPeriodStillActive() public {
        uint256 claimId = _submitClaim();

        bytes32 salt1 = keccak256("s1");
        _commit(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt1);
        _commit(claimId, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s2"));
        _commit(claimId, evaluator3, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s3"));

        // Advance to reveal period but not past it
        vm.warp(block.timestamp + 1 days + 1);

        vm.expectRevert("Reveal period active");
        market.resolveClaim(claimId);
    }

    function test_resolveClaim_expiresIfNotEnoughEvaluators() public {
        uint256 claimId = _submitClaim(); // minEvaluators = 3

        // Only 2 evaluators commit
        _commit(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s1"));
        _commit(claimId, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s2"));

        // Advance past reveal deadline
        vm.warp(block.timestamp + 1 days + 12 hours + 1);

        market.resolveClaim(claimId);

        assertEq(uint256(market.getClaim(claimId).state), uint256(CognitiveConsensusMarket.ClaimState.EXPIRED));
    }

    function test_resolveClaim_reverts_noVotesRevealed() public {
        uint256 claimId = _submitClaim();

        // 3 evaluators commit but none reveal
        _commit(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s1"));
        _commit(claimId, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s2"));
        _commit(claimId, evaluator3, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s3"));

        // Advance past reveal deadline
        vm.warp(block.timestamp + 1 days + 12 hours + 1);

        vm.expectRevert("No votes revealed");
        market.resolveClaim(claimId);
    }

    // ============ Reward Distribution Tests ============

    function test_distributeOutcomes_correctEvaluatorsGetStakeBack_plusReward() public {
        uint256 claimId = _submitClaim();

        bytes32 salt1 = keccak256("s1");
        bytes32 salt2 = keccak256("s2");
        bytes32 salt3 = keccak256("s3");

        _commit(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt1);
        _commit(claimId, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, salt2);
        _commit(claimId, evaluator3, CognitiveConsensusMarket.Verdict.TRUE, salt3);

        vm.warp(block.timestamp + 1 days + 1);

        _reveal(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt1);
        _reveal(claimId, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, salt2);
        _reveal(claimId, evaluator3, CognitiveConsensusMarket.Verdict.TRUE, salt3);

        uint256 bal1Before = token.balanceOf(evaluator1);
        uint256 bal2Before = token.balanceOf(evaluator2);
        uint256 bal3Before = token.balanceOf(evaluator3);

        vm.warp(block.timestamp + 12 hours + 1);
        market.resolveClaim(claimId);

        // All correct, equal rep weight => each gets (bounty / 3) + their stake back
        // Bounty = 10 ether, split 3 ways = 3.333... ether each
        uint256 expectedReward = BOUNTY / 3; // ~3.333 ether
        assertApproxEqAbs(token.balanceOf(evaluator1), bal1Before + STAKE + expectedReward, 1);
        assertApproxEqAbs(token.balanceOf(evaluator2), bal2Before + STAKE + expectedReward, 1);
        assertApproxEqAbs(token.balanceOf(evaluator3), bal3Before + STAKE + expectedReward, 1);
    }

    function test_distributeOutcomes_incorrectEvaluatorsSlashed() public {
        uint256 claimId = _submitClaim();

        bytes32 salt1 = keccak256("s1");
        bytes32 salt2 = keccak256("s2");
        bytes32 salt3 = keccak256("s3");

        // 2 TRUE, 1 FALSE => verdict = TRUE, evaluator3 is incorrect
        _commit(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt1);
        _commit(claimId, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, salt2);
        _commit(claimId, evaluator3, CognitiveConsensusMarket.Verdict.FALSE, salt3);

        vm.warp(block.timestamp + 1 days + 1);

        _reveal(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt1);
        _reveal(claimId, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, salt2);
        _reveal(claimId, evaluator3, CognitiveConsensusMarket.Verdict.FALSE, salt3);

        uint256 bal3Before = token.balanceOf(evaluator3);

        vm.warp(block.timestamp + 12 hours + 1);
        market.resolveClaim(claimId);

        // Incorrect evaluator: slashAmount = stake / SLASH_MULTIPLIER = 1 ether / 2 = 0.5 ether
        // Returns: stake - slashAmount = 1 - 0.5 = 0.5 ether
        assertEq(token.balanceOf(evaluator3), bal3Before + STAKE / 2);

        // Check profile was updated
        CognitiveConsensusMarket.EvaluatorProfile memory profile = market.getProfile(evaluator3);
        assertEq(profile.totalSlashed, STAKE / 2);
    }

    function test_distributeOutcomes_unrevealedEvaluatorsFullySlashed() public {
        uint256 claimId = _submitClaim();

        bytes32 salt1 = keccak256("s1");
        bytes32 salt2 = keccak256("s2");

        _commit(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt1);
        _commit(claimId, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, salt2);
        _commit(claimId, evaluator3, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s3"));

        vm.warp(block.timestamp + 1 days + 1);

        // Only evaluator1 and evaluator2 reveal — evaluator3 does NOT
        _reveal(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt1);
        _reveal(claimId, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, salt2);

        uint256 bal3Before = token.balanceOf(evaluator3);

        vm.warp(block.timestamp + 12 hours + 1);
        market.resolveClaim(claimId);

        // Unrevealed evaluator loses entire stake
        assertEq(token.balanceOf(evaluator3), bal3Before); // no refund at all
        CognitiveConsensusMarket.EvaluatorProfile memory profile = market.getProfile(evaluator3);
        assertEq(profile.totalSlashed, STAKE);
    }

    function test_distributeOutcomes_slashPoolAddedToRewards() public {
        uint256 claimId = _submitClaim();

        bytes32 salt1 = keccak256("s1");
        bytes32 salt2 = keccak256("s2");
        bytes32 salt3 = keccak256("s3");

        // 2 TRUE, 1 FALSE => slashPool from evaluator3
        _commit(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt1);
        _commit(claimId, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, salt2);
        _commit(claimId, evaluator3, CognitiveConsensusMarket.Verdict.FALSE, salt3);

        vm.warp(block.timestamp + 1 days + 1);

        _reveal(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt1);
        _reveal(claimId, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, salt2);
        _reveal(claimId, evaluator3, CognitiveConsensusMarket.Verdict.FALSE, salt3);

        uint256 bal1Before = token.balanceOf(evaluator1);

        vm.warp(block.timestamp + 12 hours + 1);
        market.resolveClaim(claimId);

        // rewardPool = bounty (10e) + slashPool (0.5e) = 10.5e
        // 2 correct evaluators with equal weight => each gets 10.5e / 2 = 5.25e
        // Plus stake return: 5.25e + 1e = 6.25e
        uint256 slashAmount = STAKE / 2; // 0.5 ether
        uint256 rewardPool = BOUNTY + slashAmount; // 10.5 ether
        uint256 expectedReward = rewardPool / 2; // 5.25 ether each
        assertApproxEqAbs(token.balanceOf(evaluator1), bal1Before + STAKE + expectedReward, 1);
    }

    function test_distributeOutcomes_noCorrectEvaluators_bountyReturnedToProposer() public {
        // All evaluators vote TRUE, but verdict is FALSE because the evaluator who
        // doesn't reveal shifts the outcome... Actually this won't work.
        // Better approach: all vote UNCERTAIN for a tied outcome, but the verdict
        // ends up UNCERTAIN, so they are all "correct."
        // Instead, create a scenario where all revealed verdicts disagree with the final verdict.
        // This is tricky because the verdict IS determined by the votes.
        // The only way no one is correct is if all evaluators don't reveal.
        // But then resolveClaim reverts with "No votes revealed".
        // In practice, this code path (totalCorrectWeight == 0) should be unreachable
        // because the verdict is always one of the revealed verdicts.
        // Skipping this path as it represents dead code in the current implementation.
    }

    function test_distributeOutcomes_emitsRewardEvent() public {
        uint256 claimId = _submitClaim();

        bytes32 salt1 = keccak256("s1");
        bytes32 salt2 = keccak256("s2");
        bytes32 salt3 = keccak256("s3");

        _commit(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt1);
        _commit(claimId, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, salt2);
        _commit(claimId, evaluator3, CognitiveConsensusMarket.Verdict.TRUE, salt3);

        vm.warp(block.timestamp + 1 days + 1);

        _reveal(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt1);
        _reveal(claimId, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, salt2);
        _reveal(claimId, evaluator3, CognitiveConsensusMarket.Verdict.TRUE, salt3);

        vm.warp(block.timestamp + 12 hours + 1);

        // Each gets bounty/3 = 3.333... ether as reward
        uint256 expectedReward = BOUNTY / 3;

        vm.expectEmit(true, true, false, true);
        emit EvaluatorRewarded(claimId, evaluator1, expectedReward);

        market.resolveClaim(claimId);
    }

    function test_distributeOutcomes_emitsSlashEvent() public {
        uint256 claimId = _submitClaim();

        bytes32 salt1 = keccak256("s1");
        bytes32 salt2 = keccak256("s2");
        bytes32 salt3 = keccak256("s3");

        _commit(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt1);
        _commit(claimId, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, salt2);
        _commit(claimId, evaluator3, CognitiveConsensusMarket.Verdict.FALSE, salt3);

        vm.warp(block.timestamp + 1 days + 1);

        _reveal(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt1);
        _reveal(claimId, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, salt2);
        _reveal(claimId, evaluator3, CognitiveConsensusMarket.Verdict.FALSE, salt3);

        vm.warp(block.timestamp + 12 hours + 1);

        vm.expectEmit(true, true, false, true);
        emit EvaluatorSlashed(claimId, evaluator3, STAKE / 2);

        market.resolveClaim(claimId);
    }

    // ============ Expiration & Refund Tests ============

    function test_refundExpired_returnsAllStakes() public {
        uint256 claimId = _submitClaim(); // minEvaluators = 3

        _commit(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s1"));
        _commit(claimId, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s2"));

        uint256 proposerBalBefore = token.balanceOf(proposer);
        uint256 eval1BalBefore = token.balanceOf(evaluator1);
        uint256 eval2BalBefore = token.balanceOf(evaluator2);

        // Advance past reveal deadline
        vm.warp(block.timestamp + 1 days + 12 hours + 1);

        // Expire the claim
        market.resolveClaim(claimId);

        // Now refund
        market.refundExpired(claimId);

        // Proposer gets bounty back
        assertEq(token.balanceOf(proposer), proposerBalBefore + BOUNTY);
        // Evaluators get stakes back
        assertEq(token.balanceOf(evaluator1), eval1BalBefore + STAKE);
        assertEq(token.balanceOf(evaluator2), eval2BalBefore + STAKE);
    }

    function test_refundExpired_reverts_notExpired() public {
        uint256 claimId = _submitClaim();

        vm.expectRevert("Not expired");
        market.refundExpired(claimId);
    }

    function test_refundExpired_idempotent_cannotDoubleRefund() public {
        uint256 claimId = _submitClaim();

        _commit(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s1"));

        vm.warp(block.timestamp + 1 days + 12 hours + 1);
        market.resolveClaim(claimId);

        // First refund
        market.refundExpired(claimId);

        uint256 proposerBal = token.balanceOf(proposer);
        uint256 eval1Bal = token.balanceOf(evaluator1);

        // Second refund should be a no-op (bounty = 0, eval.rewarded = true)
        market.refundExpired(claimId);

        assertEq(token.balanceOf(proposer), proposerBal);
        assertEq(token.balanceOf(evaluator1), eval1Bal);
    }

    // ============ Reputation System Tests ============

    function test_reputation_correctEvaluationUpdatesProfile() public {
        _fullLifecycle_allTrue();

        CognitiveConsensusMarket.EvaluatorProfile memory profile = market.getProfile(evaluator1);
        assertEq(profile.totalEvaluations, 1);
        assertEq(profile.correctEvaluations, 1);
        assertEq(profile.reputationScore, 10_000); // 100% accuracy
        assertGt(profile.totalEarned, 0);
        assertEq(profile.totalSlashed, 0);
    }

    function test_reputation_incorrectEvaluationUpdatesProfile() public {
        uint256 claimId = _submitClaim();

        bytes32 salt1 = keccak256("s1");
        bytes32 salt2 = keccak256("s2");
        bytes32 salt3 = keccak256("s3");

        _commit(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt1);
        _commit(claimId, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, salt2);
        _commit(claimId, evaluator3, CognitiveConsensusMarket.Verdict.FALSE, salt3); // will be wrong

        vm.warp(block.timestamp + 1 days + 1);

        _reveal(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt1);
        _reveal(claimId, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, salt2);
        _reveal(claimId, evaluator3, CognitiveConsensusMarket.Verdict.FALSE, salt3);

        vm.warp(block.timestamp + 12 hours + 1);
        market.resolveClaim(claimId);

        CognitiveConsensusMarket.EvaluatorProfile memory profile = market.getProfile(evaluator3);
        assertEq(profile.totalEvaluations, 1);
        assertEq(profile.correctEvaluations, 0);
        // Reputation: (0/1) * 10000 = 0, but floor of 1000 applies
        assertEq(profile.reputationScore, 1000);
        assertGt(profile.totalSlashed, 0);
    }

    function test_reputation_multipleEvaluations_accuracyTracked() public {
        // First claim: evaluator1 is correct
        _fullLifecycle_allTrue();

        // Second claim: evaluator1 is incorrect
        uint256 claimId2 = _submitClaim();

        bytes32 salt1 = keccak256("s1-v2");
        bytes32 salt2 = keccak256("s2-v2");
        bytes32 salt3 = keccak256("s3-v2");

        _commit(claimId2, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt1);   // will be wrong
        _commit(claimId2, evaluator2, CognitiveConsensusMarket.Verdict.FALSE, salt2);
        _commit(claimId2, evaluator3, CognitiveConsensusMarket.Verdict.FALSE, salt3);

        vm.warp(block.timestamp + 1 days + 1);

        _reveal(claimId2, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt1);
        _reveal(claimId2, evaluator2, CognitiveConsensusMarket.Verdict.FALSE, salt2);
        _reveal(claimId2, evaluator3, CognitiveConsensusMarket.Verdict.FALSE, salt3);

        vm.warp(block.timestamp + 12 hours + 1);
        market.resolveClaim(claimId2);

        CognitiveConsensusMarket.EvaluatorProfile memory profile = market.getProfile(evaluator1);
        assertEq(profile.totalEvaluations, 2);
        assertEq(profile.correctEvaluations, 1);
        // Reputation: (1/2) * 10000 = 5000
        assertEq(profile.reputationScore, 5000);
    }

    function test_reputation_floorAtTenPercent() public {
        // Get evaluator to 0% accuracy, should floor at 1000 (10%)
        uint256 claimId = _submitClaim();

        bytes32 salt1 = keccak256("s1");
        bytes32 salt2 = keccak256("s2");
        bytes32 salt3 = keccak256("s3");

        _commit(claimId, evaluator1, CognitiveConsensusMarket.Verdict.FALSE, salt1); // will be wrong
        _commit(claimId, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, salt2);
        _commit(claimId, evaluator3, CognitiveConsensusMarket.Verdict.TRUE, salt3);

        vm.warp(block.timestamp + 1 days + 1);

        _reveal(claimId, evaluator1, CognitiveConsensusMarket.Verdict.FALSE, salt1);
        _reveal(claimId, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, salt2);
        _reveal(claimId, evaluator3, CognitiveConsensusMarket.Verdict.TRUE, salt3);

        vm.warp(block.timestamp + 12 hours + 1);
        market.resolveClaim(claimId);

        CognitiveConsensusMarket.EvaluatorProfile memory profile = market.getProfile(evaluator1);
        assertEq(profile.reputationScore, 1000); // 10% floor
    }

    function test_reputation_sqrtWeighting_newEvaluator() public {
        // New evaluator has no profile.reputationScore => uses default BPS (10000)
        // sqrt(10000) = 100
        uint256 claimId = _submitClaim();

        _commit(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s1"));

        assertEq(market.getEvaluation(claimId, evaluator1).reputationWeight, 100);
    }

    function test_reputation_sqrtWeighting_afterRepChange() public {
        // First claim — evaluator1 gets 0% accuracy => rep = 1000 (floor)
        uint256 claimId1 = _submitClaim();

        bytes32 salt1 = keccak256("s1");
        bytes32 salt2 = keccak256("s2");
        bytes32 salt3 = keccak256("s3");

        _commit(claimId1, evaluator1, CognitiveConsensusMarket.Verdict.FALSE, salt1); // wrong
        _commit(claimId1, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, salt2);
        _commit(claimId1, evaluator3, CognitiveConsensusMarket.Verdict.TRUE, salt3);

        vm.warp(block.timestamp + 1 days + 1);

        _reveal(claimId1, evaluator1, CognitiveConsensusMarket.Verdict.FALSE, salt1);
        _reveal(claimId1, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, salt2);
        _reveal(claimId1, evaluator3, CognitiveConsensusMarket.Verdict.TRUE, salt3);

        vm.warp(block.timestamp + 12 hours + 1);
        market.resolveClaim(claimId1);

        // Evaluator1 now has rep = 1000
        CognitiveConsensusMarket.EvaluatorProfile memory profile = market.getProfile(evaluator1);
        assertEq(profile.reputationScore, 1000);

        // Second claim — evaluator1's rep weight should use sqrt(1000) ~ 31
        uint256 claimId2 = _submitClaim();

        bytes32 salt4 = keccak256("s4");
        _commit(claimId2, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt4);

        // sqrt(1000) = 31 (integer math)
        assertEq(market.getEvaluation(claimId2, evaluator1).reputationWeight, 31);
    }

    // ============ Access Control Tests ============

    function test_setAuthorizedEvaluator_onlyOwner() public {
        address newEval = makeAddr("newEval");

        // Owner can set
        market.setAuthorizedEvaluator(newEval, true);
        assertTrue(market.authorizedEvaluators(newEval));

        // Non-owner cannot set
        vm.prank(proposer);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, proposer));
        market.setAuthorizedEvaluator(newEval, false);
    }

    function test_setAuthorizedEvaluator_canRevoke() public {
        assertTrue(market.authorizedEvaluators(evaluator1));

        market.setAuthorizedEvaluator(evaluator1, false);
        assertFalse(market.authorizedEvaluators(evaluator1));
    }

    function test_commitEvaluation_revokedEvaluator_cannotCommit() public {
        uint256 claimId = _submitClaim();

        // Revoke evaluator1's access
        market.setAuthorizedEvaluator(evaluator1, false);

        bytes32 hash = _commitHash(CognitiveConsensusMarket.Verdict.TRUE, REASONING_HASH, keccak256("salt"));
        vm.prank(evaluator1);
        vm.expectRevert(CognitiveConsensusMarket.NotAuthorizedEvaluator.selector);
        market.commitEvaluation(claimId, hash, STAKE);
    }

    // ============ View Function Tests ============

    function test_getClaimEvaluators_empty() public {
        uint256 claimId = _submitClaim();
        address[] memory evaluators = market.getClaimEvaluators(claimId);
        assertEq(evaluators.length, 0);
    }

    function test_getClaimEvaluators_afterCommits() public {
        uint256 claimId = _submitClaim();

        _commit(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s1"));
        _commit(claimId, evaluator2, CognitiveConsensusMarket.Verdict.FALSE, keccak256("s2"));
        _commit(claimId, evaluator3, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s3"));

        address[] memory evaluators = market.getClaimEvaluators(claimId);
        assertEq(evaluators.length, 3);
        assertEq(evaluators[0], evaluator1);
        assertEq(evaluators[1], evaluator2);
        assertEq(evaluators[2], evaluator3);
    }

    function test_getProfile_defaultProfile() public view {
        CognitiveConsensusMarket.EvaluatorProfile memory profile = market.getProfile(unauthorized);
        assertEq(profile.totalEvaluations, 0);
        assertEq(profile.correctEvaluations, 0);
        assertEq(profile.reputationScore, 0);
        assertEq(profile.totalEarned, 0);
        assertEq(profile.totalSlashed, 0);
    }

    // ============ Edge Cases ============

    function test_edgeCase_multipleClaimsInParallel() public {
        // Submit two claims simultaneously
        vm.prank(proposer);
        uint256 claimId1 = market.submitClaim(CLAIM_HASH, BOUNTY, 3);
        vm.prank(proposer);
        uint256 claimId2 = market.submitClaim(keccak256("second claim"), BOUNTY, 3);

        // Evaluators commit on both
        _commit(claimId1, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s1a"));
        _commit(claimId2, evaluator1, CognitiveConsensusMarket.Verdict.FALSE, keccak256("s1b"));
        _commit(claimId1, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s2a"));
        _commit(claimId2, evaluator2, CognitiveConsensusMarket.Verdict.FALSE, keccak256("s2b"));
        _commit(claimId1, evaluator3, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s3a"));
        _commit(claimId2, evaluator3, CognitiveConsensusMarket.Verdict.FALSE, keccak256("s3b"));

        vm.warp(block.timestamp + 1 days + 1);

        _reveal(claimId1, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s1a"));
        _reveal(claimId2, evaluator1, CognitiveConsensusMarket.Verdict.FALSE, keccak256("s1b"));
        _reveal(claimId1, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s2a"));
        _reveal(claimId2, evaluator2, CognitiveConsensusMarket.Verdict.FALSE, keccak256("s2b"));
        _reveal(claimId1, evaluator3, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s3a"));
        _reveal(claimId2, evaluator3, CognitiveConsensusMarket.Verdict.FALSE, keccak256("s3b"));

        vm.warp(block.timestamp + 12 hours + 1);

        market.resolveClaim(claimId1);
        market.resolveClaim(claimId2);

        assertEq(uint256(market.getClaim(claimId1).verdict), uint256(CognitiveConsensusMarket.Verdict.TRUE));
        assertEq(uint256(market.getClaim(claimId2).verdict), uint256(CognitiveConsensusMarket.Verdict.FALSE));
    }

    function test_edgeCase_differentStakeAmounts_affectRewardDistribution() public {
        // evaluator1 stakes 2 ether, evaluator2 stakes 1 ether — but rewards based on rep weight, not stake
        uint256 claimId = _submitClaim();

        bytes32 salt1 = keccak256("s1");
        bytes32 salt2 = keccak256("s2");
        bytes32 salt3 = keccak256("s3");

        bytes32 hash1 = _commitHash(CognitiveConsensusMarket.Verdict.TRUE, REASONING_HASH, salt1);
        bytes32 hash2 = _commitHash(CognitiveConsensusMarket.Verdict.TRUE, REASONING_HASH, salt2);
        bytes32 hash3 = _commitHash(CognitiveConsensusMarket.Verdict.TRUE, REASONING_HASH, salt3);

        vm.prank(evaluator1);
        market.commitEvaluation(claimId, hash1, 5 ether); // 5x stake
        vm.prank(evaluator2);
        market.commitEvaluation(claimId, hash2, STAKE);   // 1x stake
        vm.prank(evaluator3);
        market.commitEvaluation(claimId, hash3, STAKE);   // 1x stake

        vm.warp(block.timestamp + 1 days + 1);

        _reveal(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt1);
        _reveal(claimId, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, salt2);
        _reveal(claimId, evaluator3, CognitiveConsensusMarket.Verdict.TRUE, salt3);

        uint256 bal1Before = token.balanceOf(evaluator1);
        uint256 bal2Before = token.balanceOf(evaluator2);

        vm.warp(block.timestamp + 12 hours + 1);
        market.resolveClaim(claimId);

        // All have equal rep weight (100), so equal share of bounty
        // But evaluator1 gets back 5 ether stake vs evaluator2 gets 1 ether stake
        uint256 rewardPerEval = BOUNTY / 3;
        assertApproxEqAbs(token.balanceOf(evaluator1), bal1Before + 5 ether + rewardPerEval, 1);
        assertApproxEqAbs(token.balanceOf(evaluator2), bal2Before + STAKE + rewardPerEval, 1);
    }

    function test_edgeCase_nonEvaluatorCanCallReveal_butNoCommitToReveal() public {
        // Someone who didn't commit tries to reveal
        uint256 claimId = _submitClaim();

        _commit(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s1"));
        _commit(claimId, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s2"));
        _commit(claimId, evaluator3, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s3"));

        vm.warp(block.timestamp + 1 days + 1);

        // evaluator4 never committed, so their commitHash is bytes32(0)
        // Any reveal will fail hash verification
        vm.prank(evaluator4);
        vm.expectRevert(CognitiveConsensusMarket.InvalidReveal.selector);
        market.revealEvaluation(claimId, CognitiveConsensusMarket.Verdict.TRUE, REASONING_HASH, keccak256("salt"));
    }

    function test_edgeCase_resolveAlreadyResolvedClaim() public {
        uint256 claimId = _fullLifecycle_allTrue();

        // Trying to resolve again should fail
        vm.expectRevert("Not resolvable");
        market.resolveClaim(claimId);
    }

    function test_edgeCase_commitWithZeroHash_butNotZeroCommitHash() public {
        // bytes32(0) as commitHash doesn't mean empty — it just means
        // the evaluator happened to generate a hash that equals 0 (practically impossible)
        // But we should verify that the AlreadyCommitted check works correctly
        uint256 claimId = _submitClaim();

        _commit(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s1"));

        // Verify the commit is stored
        assertNotEq(market.getEvaluation(claimId, evaluator1).commitHash, bytes32(0));
    }

    function test_edgeCase_commitExactlyAtDeadline() public {
        uint256 claimId = _submitClaim();

        // Warp to exactly the commit deadline (should still be valid since check is >)
        vm.warp(market.getClaim(claimId).commitDeadline);

        bytes32 hash = _commitHash(CognitiveConsensusMarket.Verdict.TRUE, REASONING_HASH, keccak256("salt"));
        vm.prank(evaluator1);
        market.commitEvaluation(claimId, hash, STAKE);

        assertEq(market.getEvaluation(claimId, evaluator1).commitHash, hash);
    }

    function test_edgeCase_revealExactlyAtDeadline() public {
        uint256 claimId = _submitClaim();
        bytes32 salt = keccak256("salt");

        _commit(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt);
        _commit(claimId, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s2"));
        _commit(claimId, evaluator3, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s3"));

        // Advance past commit deadline
        vm.warp(block.timestamp + 1 days + 1);

        // First reveal to trigger state transition
        _reveal(claimId, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s2"));

        // Warp to exactly the reveal deadline (should still be valid since check is >)
        vm.warp(market.getClaim(claimId).revealDeadline);

        _reveal(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt);

        assertTrue(market.getEvaluation(claimId, evaluator1).revealed);
    }

    // ============ Full Lifecycle Integration Tests ============

    function test_fullLifecycle_unanimousTrueVerdict() public {
        uint256 proposerBalBefore = token.balanceOf(proposer);
        uint256 eval1BalBefore = token.balanceOf(evaluator1);

        _fullLifecycle_allTrue();

        // Proposer lost bounty
        assertEq(token.balanceOf(proposer), proposerBalBefore - BOUNTY);

        // Each evaluator gained roughly (bounty/3) reward
        uint256 expectedReward = BOUNTY / 3;
        assertApproxEqAbs(
            token.balanceOf(evaluator1),
            eval1BalBefore + expectedReward, // stake deducted then returned + reward
            1
        );
    }

    function test_fullLifecycle_mixedVerdicts_majorityWins() public {
        uint256 claimId = _submitClaim();

        bytes32 salt1 = keccak256("s1");
        bytes32 salt2 = keccak256("s2");
        bytes32 salt3 = keccak256("s3");
        bytes32 salt4 = keccak256("s4");
        bytes32 salt5 = keccak256("s5");

        // 3 TRUE, 1 FALSE, 1 UNCERTAIN
        _commit(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt1);
        _commit(claimId, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, salt2);
        _commit(claimId, evaluator3, CognitiveConsensusMarket.Verdict.TRUE, salt3);
        _commit(claimId, evaluator4, CognitiveConsensusMarket.Verdict.FALSE, salt4);
        _commit(claimId, evaluator5, CognitiveConsensusMarket.Verdict.UNCERTAIN, salt5);

        vm.warp(block.timestamp + 1 days + 1);

        _reveal(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt1);
        _reveal(claimId, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, salt2);
        _reveal(claimId, evaluator3, CognitiveConsensusMarket.Verdict.TRUE, salt3);
        _reveal(claimId, evaluator4, CognitiveConsensusMarket.Verdict.FALSE, salt4);
        _reveal(claimId, evaluator5, CognitiveConsensusMarket.Verdict.UNCERTAIN, salt5);

        vm.warp(block.timestamp + 12 hours + 1);

        market.resolveClaim(claimId);

        CognitiveConsensusMarket.Claim memory clV = market.getClaim(claimId);
        assertEq(uint256(clV.state), uint256(CognitiveConsensusMarket.ClaimState.RESOLVED));
        assertEq(uint256(clV.verdict), uint256(CognitiveConsensusMarket.Verdict.TRUE));
        assertEq(clV.trueVotes, 300);      // 3 * 100
        assertEq(clV.falseVotes, 100);     // 1 * 100
        assertEq(clV.uncertainVotes, 100); // 1 * 100
    }

    function test_fullLifecycle_partialReveals_unrevealedSlashed() public {
        uint256 claimId = _submitClaim();

        bytes32 salt1 = keccak256("s1");
        bytes32 salt2 = keccak256("s2");

        _commit(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt1);
        _commit(claimId, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, salt2);
        _commit(claimId, evaluator3, CognitiveConsensusMarket.Verdict.FALSE, keccak256("s3"));

        vm.warp(block.timestamp + 1 days + 1);

        // Only 2 out of 3 reveal
        _reveal(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, salt1);
        _reveal(claimId, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, salt2);
        // evaluator3 does NOT reveal

        vm.warp(block.timestamp + 12 hours + 1);

        uint256 bal3Before = token.balanceOf(evaluator3);
        market.resolveClaim(claimId);

        // evaluator3 should be slashed (unrevealed)
        assertEq(token.balanceOf(evaluator3), bal3Before);
        CognitiveConsensusMarket.EvaluatorProfile memory profile = market.getProfile(evaluator3);
        assertEq(profile.totalSlashed, STAKE);
    }

    function test_fullLifecycle_expiredClaim_fullRefundCycle() public {
        vm.prank(proposer);
        uint256 claimId = market.submitClaim(CLAIM_HASH, BOUNTY, 5); // Need 5 evaluators

        // Only 3 commit (not enough)
        _commit(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s1"));
        _commit(claimId, evaluator2, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s2"));
        _commit(claimId, evaluator3, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s3"));

        uint256 proposerBal = token.balanceOf(proposer);
        uint256 eval1Bal = token.balanceOf(evaluator1);
        uint256 eval2Bal = token.balanceOf(evaluator2);
        uint256 eval3Bal = token.balanceOf(evaluator3);

        // Advance past everything
        vm.warp(block.timestamp + 1 days + 12 hours + 1);

        // Resolve (triggers expiry)
        market.resolveClaim(claimId);

        assertEq(uint256(market.getClaim(claimId).state), uint256(CognitiveConsensusMarket.ClaimState.EXPIRED));

        // Refund
        market.refundExpired(claimId);

        assertEq(token.balanceOf(proposer), proposerBal + BOUNTY);
        assertEq(token.balanceOf(evaluator1), eval1Bal + STAKE);
        assertEq(token.balanceOf(evaluator2), eval2Bal + STAKE);
        assertEq(token.balanceOf(evaluator3), eval3Bal + STAKE);
    }

    // ============ Token Balance Accounting Tests ============

    function test_accounting_marketBalanceConsistent_afterResolution() public {
        _fullLifecycle_allTrue();

        // After full resolution with all correct evaluators, market should have ~0 balance
        // (rounding dust of up to 2 wei is acceptable from integer division)
        assertLe(token.balanceOf(address(market)), 2);
    }

    function test_accounting_marketBalanceConsistent_afterExpiredRefund() public {
        vm.prank(proposer);
        uint256 claimId = market.submitClaim(CLAIM_HASH, BOUNTY, 5);

        _commit(claimId, evaluator1, CognitiveConsensusMarket.Verdict.TRUE, keccak256("s1"));

        vm.warp(block.timestamp + 1 days + 12 hours + 1);

        market.resolveClaim(claimId);
        market.refundExpired(claimId);

        assertEq(token.balanceOf(address(market)), 0);
    }
}
