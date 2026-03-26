// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/IntelligenceExchange.sol";
import "../../contracts/mechanism/CognitiveConsensusMarket.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract MockVIBECCM is ERC20 {
    constructor() ERC20("VIBE", "VIBE") { _mint(msg.sender, 1e9 ether); }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/**
 * @title SIECognitiveConsensusIntegration
 * @notice End-to-end tests for IntelligenceExchange <-> CognitiveConsensusMarket wiring.
 *         Tests the full lifecycle: submit -> request evaluation -> evaluate -> settle.
 */
contract SIECognitiveConsensusIntegrationTest is Test {
    IntelligenceExchange public sie;
    CognitiveConsensusMarket public ccm;
    MockVIBECCM public vibe;

    address public owner = address(this);
    address public alice = address(0xA11CE);   // Knowledge contributor
    address public eval1 = address(0xE1);      // Evaluator 1
    address public eval2 = address(0xE2);      // Evaluator 2
    address public eval3 = address(0xE3);      // Evaluator 3

    bytes32 constant CONTENT_HASH = keccak256("research-paper-quantum-mev");
    string constant METADATA_URI = "ipfs://QmQuantumMEV";

    function setUp() public {
        vibe = new MockVIBECCM();

        // Deploy IntelligenceExchange (UUPS proxy)
        IntelligenceExchange impl = new IntelligenceExchange();
        bytes memory initData = abi.encodeCall(
            IntelligenceExchange.initialize, (address(vibe), owner)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        sie = IntelligenceExchange(payable(address(proxy)));

        // Deploy CognitiveConsensusMarket (uses same vibe token for staking)
        ccm = new CognitiveConsensusMarket(address(vibe));

        // Wire them together
        sie.setCognitiveConsensusMarket(address(ccm));

        // Authorize evaluators
        ccm.setAuthorizedEvaluator(eval1, true);
        ccm.setAuthorizedEvaluator(eval2, true);
        ccm.setAuthorizedEvaluator(eval3, true);

        // Fund everyone
        address[4] memory users = [alice, eval1, eval2, eval3];
        for (uint256 i = 0; i < users.length; i++) {
            vm.deal(users[i], 10 ether);
            vibe.mint(users[i], 10_000 ether);
            vm.prank(users[i]);
            vibe.approve(address(sie), type(uint256).max);
            vm.prank(users[i]);
            vibe.approve(address(ccm), type(uint256).max);
        }
    }

    // ============ Full Lifecycle: Submit -> Evaluate -> Verify ============

    function test_fullLifecycle_verified() public {
        bytes32[] memory noCites = new bytes32[](0);

        // Step 1: Alice submits intelligence
        vm.prank(alice);
        bytes32 assetId = sie.submitIntelligence{value: 0.01 ether}(
            CONTENT_HASH, METADATA_URI,
            IntelligenceExchange.AssetType.RESEARCH, noCites
        );

        // Verify initial state
        IntelligenceExchange.IntelligenceAsset memory asset = sie.getAsset(assetId);
        assertEq(uint256(asset.state), uint256(IntelligenceExchange.AssetState.SUBMITTED));

        // Step 2: Alice requests evaluation with 1 VIBE bounty
        uint256 bounty = 1 ether;
        vm.prank(alice);
        sie.requestEvaluation(assetId, 3, bounty);

        // Verify state changed to EVALUATING
        asset = sie.getAsset(assetId);
        assertEq(uint256(asset.state), uint256(IntelligenceExchange.AssetState.EVALUATING));

        // Verify claim was created in CCM
        uint256 claimId = sie.assetToClaimId(assetId);
        assertGt(claimId, 0, "Claim ID should be > 0");
        assertEq(sie.claimToAsset(claimId), assetId, "claimToAsset mapping should match");

        // Step 3: Evaluators commit verdicts (all TRUE)
        bytes32 salt1 = keccak256("salt1");
        bytes32 salt2 = keccak256("salt2");
        bytes32 salt3 = keccak256("salt3");
        bytes32 reasoningHash = keccak256("reasoning-ipfs-cid");

        bytes32 commit1 = keccak256(abi.encodePacked(CognitiveConsensusMarket.Verdict.TRUE, reasoningHash, salt1));
        bytes32 commit2 = keccak256(abi.encodePacked(CognitiveConsensusMarket.Verdict.TRUE, reasoningHash, salt2));
        bytes32 commit3 = keccak256(abi.encodePacked(CognitiveConsensusMarket.Verdict.TRUE, reasoningHash, salt3));

        vm.prank(eval1);
        ccm.commitEvaluation(claimId, commit1, 0.1 ether);
        vm.prank(eval2);
        ccm.commitEvaluation(claimId, commit2, 0.1 ether);
        vm.prank(eval3);
        ccm.commitEvaluation(claimId, commit3, 0.1 ether);

        // Step 4: Advance past commit deadline, reveal verdicts
        vm.warp(block.timestamp + 1 days + 1);

        vm.prank(eval1);
        ccm.revealEvaluation(claimId, CognitiveConsensusMarket.Verdict.TRUE, reasoningHash, salt1);
        vm.prank(eval2);
        ccm.revealEvaluation(claimId, CognitiveConsensusMarket.Verdict.TRUE, reasoningHash, salt2);
        vm.prank(eval3);
        ccm.revealEvaluation(claimId, CognitiveConsensusMarket.Verdict.TRUE, reasoningHash, salt3);

        // Step 5: Advance past reveal deadline and resolve
        vm.warp(block.timestamp + 12 hours + 1);
        ccm.resolveClaim(claimId);

        // Step 6: Settle evaluation in SIE
        sie.settleEvaluation(claimId);

        // Verify asset is now VERIFIED
        asset = sie.getAsset(assetId);
        assertEq(uint256(asset.state), uint256(IntelligenceExchange.AssetState.VERIFIED));
    }

    // ============ Disputed: Evaluators Reject ============

    function test_fullLifecycle_disputed() public {
        bytes32[] memory noCites = new bytes32[](0);

        vm.prank(alice);
        bytes32 assetId = sie.submitIntelligence{value: 0.01 ether}(
            CONTENT_HASH, METADATA_URI,
            IntelligenceExchange.AssetType.RESEARCH, noCites
        );

        vm.prank(alice);
        sie.requestEvaluation(assetId, 3, 1 ether);

        uint256 claimId = sie.assetToClaimId(assetId);

        // Evaluators vote FALSE (claim rejected)
        bytes32 reasoningHash = keccak256("bad-research");
        bytes32 salt1 = keccak256("s1");
        bytes32 salt2 = keccak256("s2");
        bytes32 salt3 = keccak256("s3");

        bytes32 commit1 = keccak256(abi.encodePacked(CognitiveConsensusMarket.Verdict.FALSE, reasoningHash, salt1));
        bytes32 commit2 = keccak256(abi.encodePacked(CognitiveConsensusMarket.Verdict.FALSE, reasoningHash, salt2));
        bytes32 commit3 = keccak256(abi.encodePacked(CognitiveConsensusMarket.Verdict.FALSE, reasoningHash, salt3));

        vm.prank(eval1);
        ccm.commitEvaluation(claimId, commit1, 0.1 ether);
        vm.prank(eval2);
        ccm.commitEvaluation(claimId, commit2, 0.1 ether);
        vm.prank(eval3);
        ccm.commitEvaluation(claimId, commit3, 0.1 ether);

        vm.warp(block.timestamp + 1 days + 1);

        vm.prank(eval1);
        ccm.revealEvaluation(claimId, CognitiveConsensusMarket.Verdict.FALSE, reasoningHash, salt1);
        vm.prank(eval2);
        ccm.revealEvaluation(claimId, CognitiveConsensusMarket.Verdict.FALSE, reasoningHash, salt2);
        vm.prank(eval3);
        ccm.revealEvaluation(claimId, CognitiveConsensusMarket.Verdict.FALSE, reasoningHash, salt3);

        vm.warp(block.timestamp + 12 hours + 1);
        ccm.resolveClaim(claimId);

        sie.settleEvaluation(claimId);

        // Verify asset is DISPUTED
        IntelligenceExchange.IntelligenceAsset memory asset = sie.getAsset(assetId);
        assertEq(uint256(asset.state), uint256(IntelligenceExchange.AssetState.DISPUTED));
    }

    // ============ Expired: Not Enough Evaluators ============

    function test_evaluationExpired_revertsToSubmitted() public {
        bytes32[] memory noCites = new bytes32[](0);

        vm.prank(alice);
        bytes32 assetId = sie.submitIntelligence{value: 0.01 ether}(
            CONTENT_HASH, METADATA_URI,
            IntelligenceExchange.AssetType.RESEARCH, noCites
        );

        vm.prank(alice);
        sie.requestEvaluation(assetId, 3, 1 ether);

        uint256 claimId = sie.assetToClaimId(assetId);

        // Only 1 evaluator commits (need 3)
        bytes32 commit = keccak256(abi.encodePacked(
            CognitiveConsensusMarket.Verdict.TRUE,
            keccak256("reasoning"),
            keccak256("salt")
        ));
        vm.prank(eval1);
        ccm.commitEvaluation(claimId, commit, 0.1 ether);

        // Advance past both deadlines
        vm.warp(block.timestamp + 1 days + 12 hours + 1);

        // Resolve will expire the claim
        ccm.resolveClaim(claimId);

        // Settle should revert asset to SUBMITTED
        sie.settleEvaluation(claimId);

        IntelligenceExchange.IntelligenceAsset memory asset = sie.getAsset(assetId);
        assertEq(uint256(asset.state), uint256(IntelligenceExchange.AssetState.SUBMITTED));
    }

    // ============ Guard: Cannot Request Evaluation Twice ============

    function test_cannotRequestEvaluationTwice() public {
        bytes32[] memory noCites = new bytes32[](0);

        vm.prank(alice);
        bytes32 assetId = sie.submitIntelligence{value: 0.01 ether}(
            CONTENT_HASH, METADATA_URI,
            IntelligenceExchange.AssetType.RESEARCH, noCites
        );

        vm.prank(alice);
        sie.requestEvaluation(assetId, 3, 1 ether);

        // Second request should revert
        vm.prank(alice);
        vm.expectRevert(IntelligenceExchange.InvalidAssetState.selector);
        sie.requestEvaluation(assetId, 3, 1 ether);
    }

    // ============ Guard: Only Contributor Can Request ============

    function test_onlyContributorCanRequestEvaluation() public {
        bytes32[] memory noCites = new bytes32[](0);

        vm.prank(alice);
        bytes32 assetId = sie.submitIntelligence{value: 0.01 ether}(
            CONTENT_HASH, METADATA_URI,
            IntelligenceExchange.AssetType.RESEARCH, noCites
        );

        // eval1 tries to request evaluation for Alice's asset
        vm.prank(eval1);
        vm.expectRevert(IntelligenceExchange.NotAssetContributor.selector);
        sie.requestEvaluation(assetId, 3, 1 ether);
    }

    // ============ Guard: Cannot Settle Before Resolution ============

    function test_cannotSettleBeforeResolution() public {
        bytes32[] memory noCites = new bytes32[](0);

        vm.prank(alice);
        bytes32 assetId = sie.submitIntelligence{value: 0.01 ether}(
            CONTENT_HASH, METADATA_URI,
            IntelligenceExchange.AssetType.RESEARCH, noCites
        );

        vm.prank(alice);
        sie.requestEvaluation(assetId, 3, 1 ether);

        uint256 claimId = sie.assetToClaimId(assetId);

        // Try to settle immediately (claim is still OPEN)
        vm.expectRevert(IntelligenceExchange.ClaimNotResolved.selector);
        sie.settleEvaluation(claimId);
    }

    // ============ Owner Verify Still Works (Fallback Path) ============

    function test_ownerVerifyStillWorks() public {
        bytes32[] memory noCites = new bytes32[](0);

        vm.prank(alice);
        bytes32 assetId = sie.submitIntelligence{value: 0.01 ether}(
            CONTENT_HASH, METADATA_URI,
            IntelligenceExchange.AssetType.RESEARCH, noCites
        );

        // Owner can still verify directly without CCM
        sie.verifyAsset(assetId);

        IntelligenceExchange.IntelligenceAsset memory asset = sie.getAsset(assetId);
        assertEq(uint256(asset.state), uint256(IntelligenceExchange.AssetState.VERIFIED));
    }

    // ============ CCM Not Set Guard ============

    function test_cannotRequestEvaluationWithoutCCM() public {
        // Deploy fresh SIE without CCM wiring
        IntelligenceExchange impl2 = new IntelligenceExchange();
        bytes memory initData = abi.encodeCall(
            IntelligenceExchange.initialize, (address(vibe), owner)
        );
        ERC1967Proxy proxy2 = new ERC1967Proxy(address(impl2), initData);
        IntelligenceExchange sie2 = IntelligenceExchange(payable(address(proxy2)));

        // Fund alice for sie2
        vm.prank(alice);
        vibe.approve(address(sie2), type(uint256).max);

        bytes32[] memory noCites = new bytes32[](0);
        vm.prank(alice);
        bytes32 assetId = sie2.submitIntelligence{value: 0.01 ether}(
            CONTENT_HASH, METADATA_URI,
            IntelligenceExchange.AssetType.RESEARCH, noCites
        );

        vm.prank(alice);
        vm.expectRevert(IntelligenceExchange.CognitiveConsensusMarketNotSet.selector);
        sie2.requestEvaluation(assetId, 3, 1 ether);
    }
}
