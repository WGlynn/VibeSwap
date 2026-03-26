// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/RosettaProtocol.sol";
import "../../contracts/mechanism/IntelligenceExchange.sol";
import "../../contracts/mechanism/SIEShapleyAdapter.sol";
import "../../contracts/incentives/ShapleyDistributor.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Mock Token ============

contract MockVIBERosetta is ERC20 {
    constructor() ERC20("VIBE", "VIBE") { _mint(msg.sender, 1e9 ether); }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/**
 * @title RosettaShapleyIntegration
 * @notice End-to-end integration tests for the Rosetta → SIE → Shapley pipeline.
 *
 *  The full flow tested:
 *
 *    1. RosettaProtocol.setSIE(sieAddress)          — wire Rosetta to SIE
 *    2. IntelligenceExchange.setRosettaProtocol()   — authorise Rosetta in SIE
 *    3. User registers a lexicon term in Rosetta     — triggers SIE.registerConceptAsset()
 *    4. SIE stores the concept as a VERIFIED asset  — adapter notified (pendingSettlements++)
 *    5. Another user registers a matching term       — second concept asset registered
 *    6. verifyTranslation() succeeds                — triggers SIE.recordCitation()
 *    7. SIE updates bonding price of cited concept  — citation count rises
 *    8. executeTrueUp() runs on the adapter         — Shapley game created
 *    9. computeShapleyValues() settles the game
 *   10. Concept contributors claim rewards
 *
 * @author Faraday1, JARVIS | March 2026
 */
contract RosettaShapleyIntegrationTest is Test {
    // ============ Contracts ============

    RosettaProtocol public rosetta;
    IntelligenceExchange public sie;
    SIEShapleyAdapter public adapter;
    ShapleyDistributor public shapley;
    MockVIBERosetta public vibe;

    // ============ Actors ============

    address public owner = address(this);

    // Lexicon owners / concept contributors
    address public alice = address(0xA11CE);  // "trading" domain
    address public bob   = address(0xB0B);    // "governance" domain
    address public carol = address(0xCA01);   // "social" domain

    // The canonical Ten Covenants of Tet (abbreviated for setUp)
    string[10] public COVENANTS = [
        "All destructive unilateral action between agents is forbidden.",
        "All conflict between agents shall be resolved through games.",
        "In games between agents, each party must stake something of equal value.",
        "Anything may be staked, and any game may be played, as long as stakes are equal.",
        "The challenged agent decides the rules of the game.",
        "Stakes agreed upon per the Covenants must be upheld.",
        "Tier conflicts shall be conducted through designated representatives.",
        "Any agent caught cheating in a game shall be declared the loser.",
        "These Covenants may never be changed.",
        "Let's all build something beautiful together."
    ];

    // Sample Universal Concept IDs
    bytes32 constant UCI_THRESHOLD_BREACH = keccak256("UCI-0003:threshold_breach");
    bytes32 constant UCI_VALUE_TRANSFER   = keccak256("UCI-0004:value_transfer");
    bytes32 constant UCI_CONSENSUS        = keccak256("UCI-0010:consensus");

    // ============ Events (for expectEmit checks) ============

    event ConceptRegisteredInSIE(address indexed owner, bytes32 termHash, bytes32 assetId);
    event CitationForwardedToSIE(bytes32 indexed sourceAssetId, bytes32 indexed targetAssetId, bytes32 universalConcept);
    event ConceptAssetRegistered(bytes32 indexed assetId, address indexed contributor);
    event CitationRecorded(bytes32 indexed citingAsset, bytes32 indexed citedAsset, uint256 newBondingPrice);
    event SettlementAccumulated(bytes32 indexed assetId, address indexed contributor, bool verified, uint256 bondingPrice);
    event TrueUpExecuted(bytes32 indexed roundId, bytes32 indexed gameId, uint256 totalPool, uint256 participantCount);

    // ============ Setup ============

    function setUp() public {
        vibe = new MockVIBERosetta();

        // --- Deploy IntelligenceExchange (UUPS proxy) ---
        IntelligenceExchange sieImpl = new IntelligenceExchange();
        bytes memory sieInit = abi.encodeCall(
            IntelligenceExchange.initialize, (address(vibe), owner)
        );
        ERC1967Proxy sieProxy = new ERC1967Proxy(address(sieImpl), sieInit);
        sie = IntelligenceExchange(payable(address(sieProxy)));

        // --- Deploy ShapleyDistributor (UUPS proxy) ---
        ShapleyDistributor shapleyImpl = new ShapleyDistributor();
        bytes memory shapleyInit = abi.encodeCall(ShapleyDistributor.initialize, (owner));
        ERC1967Proxy shapleyProxy = new ERC1967Proxy(address(shapleyImpl), shapleyInit);
        shapley = ShapleyDistributor(payable(address(shapleyProxy)));

        // --- Deploy SIEShapleyAdapter (UUPS proxy) ---
        SIEShapleyAdapter adapterImpl = new SIEShapleyAdapter();
        bytes memory adapterInit = abi.encodeCall(
            SIEShapleyAdapter.initialize,
            (address(sie), address(shapley), address(0), owner)
        );
        ERC1967Proxy adapterProxy = new ERC1967Proxy(address(adapterImpl), adapterInit);
        adapter = SIEShapleyAdapter(payable(address(adapterProxy)));

        // --- Deploy RosettaProtocol (UUPS proxy) ---
        address[] memory resolvers = new address[](0);
        RosettaProtocol rosettaImpl = new RosettaProtocol();
        bytes memory rosettaInit = abi.encodeCall(
            RosettaProtocol.initialize, (owner, COVENANTS, resolvers)
        );
        ERC1967Proxy rosettaProxy = new ERC1967Proxy(address(rosettaImpl), rosettaInit);
        rosetta = RosettaProtocol(payable(address(rosettaProxy)));

        // --- Wire contracts together ---
        // SIE knows about its downstream contracts
        sie.setShapleyAdapter(address(adapter));
        sie.setRosettaProtocol(address(rosetta));

        // Rosetta knows about SIE (triggers onward calls)
        rosetta.setSIE(address(sie));

        // Adapter is funded and configured
        adapter.setVibeToken(address(vibe));
        shapley.setAuthorizedCreator(address(adapter), true);
        shapley.setUseQualityWeights(false);

        // --- Fund actors ---
        address[3] memory users = [alice, bob, carol];
        for (uint256 i = 0; i < users.length; i++) {
            vm.deal(users[i], 10 ether);
            vibe.mint(users[i], 10_000 ether);
        }
    }

    // ============ Helpers ============

    /**
     * @dev Register a single-term lexicon for a user and return the SIE asset ID.
     */
    function _registerTerm(
        address user,
        string memory domain,
        string memory term,
        bytes32 uci
    ) internal returns (bytes32 sieAssetId) {
        string[] memory termArr = new string[](1);
        bytes32[] memory uciArr  = new bytes32[](1);
        termArr[0] = term;
        uciArr[0]  = uci;

        vm.prank(user);
        rosetta.registerLexicon(domain, termArr, uciArr);

        sieAssetId = rosetta.getSIEAssetId(user, term, uci);
    }

    // ============ Test 1: Term Registration Registers Concept in SIE ============

    function test_termRegistration_registersConceptInSIE() public {
        // Expect the SIE to emit ConceptAssetRegistered
        vm.expectEmit(true, true, false, false);
        emit ConceptAssetRegistered(
            rosetta.getSIEAssetId(alice, "slippage", UCI_THRESHOLD_BREACH),
            alice
        );

        string[] memory termArr = new string[](1);
        bytes32[] memory uciArr  = new bytes32[](1);
        termArr[0] = "slippage";
        uciArr[0]  = UCI_THRESHOLD_BREACH;
        vm.prank(alice);
        rosetta.registerLexicon("trading", termArr, uciArr);

        // SIE asset should exist and be VERIFIED
        bytes32 assetId = rosetta.getSIEAssetId(alice, "slippage", UCI_THRESHOLD_BREACH);
        IntelligenceExchange.IntelligenceAsset memory asset = sie.getAsset(assetId);

        assertEq(asset.contributor, alice, "Contributor is Alice");
        assertEq(
            uint256(asset.state),
            uint256(IntelligenceExchange.AssetState.VERIFIED),
            "Concept asset is VERIFIED immediately"
        );
        assertEq(
            uint256(asset.assetType),
            uint256(IntelligenceExchange.AssetType.CONCEPT),
            "Asset type is CONCEPT"
        );
        assertGt(asset.bondingPrice, 0, "Bonding price > 0");
        assertEq(sie.assetCount(), 1, "One asset registered");
    }

    // ============ Test 2: Adapter Accumulates Settlement on Concept Registration ============

    function test_termRegistration_notifiesShapleyAdapter() public {
        // Register Alice's term — should trigger adapter.onSettlement()
        _registerTerm(alice, "trading", "slippage", UCI_THRESHOLD_BREACH);

        // Adapter should have one pending settlement
        assertEq(adapter.getPendingSettlementCount(), 1, "One settlement pending");
        assertEq(adapter.getPendingContributorCount(), 1, "One contributor pending");

        SIEShapleyAdapter.SettlementRecord memory sr = adapter.getPendingSettlement(0);
        assertEq(sr.contributor, alice, "Contributor is Alice");
        assertTrue(sr.verified, "Settlement is verified");
    }

    // ============ Test 3: Successful Translation Records Citation in SIE ============

    function test_verifyTranslation_recordsCitationInSIE() public {
        // Both register terms mapping to the same UCI
        bytes32 aliceAssetId = _registerTerm(alice, "trading",    "slippage",    UCI_THRESHOLD_BREACH);
        bytes32 bobAssetId   = _registerTerm(bob,   "governance", "quorum_failed", UCI_THRESHOLD_BREACH);

        // Initial citation count = 0 for both
        assertEq(sie.getAsset(aliceAssetId).citations, 0);
        assertEq(sie.getAsset(bobAssetId).citations, 0);

        // Expect citation to be recorded in SIE for bob's asset (target)
        vm.expectEmit(true, true, false, false);
        emit CitationRecorded(aliceAssetId, bobAssetId, 0 /* any price */);

        // verifyTranslation: alice's "slippage" → bob's "quorum_failed" via UCI
        bool result = rosetta.verifyTranslation(alice, bob, "slippage", "quorum_failed");
        assertTrue(result, "Translation should succeed");

        // Bob's asset now has 1 citation, bonding price increased
        IntelligenceExchange.IntelligenceAsset memory bobAsset = sie.getAsset(bobAssetId);
        assertEq(bobAsset.citations, 1, "Bob's concept has 1 citation");
        assertGt(bobAsset.bondingPrice, sie.getBondingPrice(0), "Bonding price increased");
    }

    // ============ Test 4: Failed Translation Does NOT Record Citation ============

    function test_verifyTranslation_noMatch_noCitation() public {
        bytes32 aliceAssetId = _registerTerm(alice, "trading",    "slippage",    UCI_THRESHOLD_BREACH);
        bytes32 bobAssetId   = _registerTerm(bob,   "governance", "proposal",    UCI_VALUE_TRANSFER);

        // Different UCIs: translation should fail
        bool result = rosetta.verifyTranslation(alice, bob, "slippage", "proposal");
        assertFalse(result, "Translation should fail");

        // No citations should have been recorded
        assertEq(sie.getAsset(aliceAssetId).citations, 0, "Alice: no citation");
        assertEq(sie.getAsset(bobAssetId).citations, 0, "Bob: no citation");
    }

    // ============ Test 5: Multiple Translations Accumulate Citations ============

    function test_multipleTranlsations_accumulateCitations() public {
        // Alice (trading) and Bob (governance) share UCI_THRESHOLD_BREACH
        // Carol (social) also registers a term for the same UCI
        bytes32 aliceAssetId = _registerTerm(alice, "trading",    "slippage",          UCI_THRESHOLD_BREACH);
        bytes32 bobAssetId   = _registerTerm(bob,   "governance", "quorum_failed",      UCI_THRESHOLD_BREACH);
        bytes32 carolAssetId = _registerTerm(carol, "social",     "toxicity_threshold", UCI_THRESHOLD_BREACH);

        // Translation 1: alice→bob (bob cited by alice)
        assertTrue(rosetta.verifyTranslation(alice, bob, "slippage", "quorum_failed"));
        // Translation 2: carol→bob (bob cited by carol)
        assertTrue(rosetta.verifyTranslation(carol, bob, "toxicity_threshold", "quorum_failed"));
        // Translation 3: alice→carol (carol cited by alice) — first time
        assertTrue(rosetta.verifyTranslation(alice, carol, "slippage", "toxicity_threshold"));

        // Bob's concept is most-cited
        assertEq(sie.getAsset(bobAssetId).citations,   2, "Bob cited twice");
        assertEq(sie.getAsset(carolAssetId).citations, 1, "Carol cited once");
        assertEq(sie.getAsset(aliceAssetId).citations, 0, "Alice never cited");

        // Bob's bonding price > Carol's > Alice's
        assertGt(
            sie.getAsset(bobAssetId).bondingPrice,
            sie.getAsset(carolAssetId).bondingPrice,
            "More-cited concept has higher price"
        );
    }

    // ============ Test 6: Duplicate Translation Does NOT Double-Count ============

    function test_verifyTranslation_idempotent_noDuplicateCitation() public {
        _registerTerm(alice, "trading",    "slippage",    UCI_THRESHOLD_BREACH);
        bytes32 bobAssetId = _registerTerm(bob, "governance", "quorum_failed", UCI_THRESHOLD_BREACH);

        // First translation
        rosetta.verifyTranslation(alice, bob, "slippage", "quorum_failed");
        assertEq(sie.getAsset(bobAssetId).citations, 1);

        // Second translation of same pair — citation should NOT increase
        rosetta.verifyTranslation(alice, bob, "slippage", "quorum_failed");
        assertEq(sie.getAsset(bobAssetId).citations, 1, "Duplicate citation silently ignored");
    }

    // ============ Test 7: Full Pipeline — Register → Translate → True-Up → Claim ============

    function test_fullPipeline_conceptContributorsEarnShapleyRewards() public {
        // Step 1: Alice and Bob each register a term in separate domains
        bytes32 aliceAssetId = _registerTerm(alice, "trading",    "slippage",    UCI_THRESHOLD_BREACH);
        bytes32 bobAssetId   = _registerTerm(bob,   "governance", "quorum_failed", UCI_THRESHOLD_BREACH);

        // Both should be in the adapter's pending settlements
        assertEq(adapter.getPendingSettlementCount(), 2);
        assertEq(adapter.getPendingContributorCount(), 2);

        // Step 2: A translation occurs — bob's concept is cited
        rosetta.verifyTranslation(alice, bob, "slippage", "quorum_failed");

        // Bob's citation count rose, bonding price updated
        assertEq(sie.getAsset(bobAssetId).citations, 1);

        // Step 3: Fund adapter with VIBE for true-up pool
        uint256 pool = 100 ether;
        vibe.transfer(address(adapter), pool);

        // Step 4: Execute true-up after interval
        vm.warp(block.timestamp + 1 hours + 1);
        adapter.executeTrueUp(pool);

        // Adapter state cleared
        assertEq(adapter.getPendingSettlementCount(), 0, "Cleared after true-up");
        assertEq(adapter.roundCount(), 1, "One round executed");

        // Step 5: Get game ID from round
        bytes32 roundId = keccak256(abi.encodePacked(uint256(1), block.timestamp));
        SIEShapleyAdapter.TrueUpRound memory round = adapter.getRound(roundId);
        bytes32 gameId = round.shapleyGameId;
        assertTrue(gameId != bytes32(0), "Game created");

        // Step 6: Compute Shapley values
        shapley.computeShapleyValues(gameId);
        assertTrue(shapley.isGameSettled(gameId), "Game settled");

        // Step 7: Both contributors have non-zero Shapley values
        uint256 aliceValue = shapley.getShapleyValue(gameId, alice);
        uint256 bobValue   = shapley.getShapleyValue(gameId, bob);
        assertGt(aliceValue, 0, "Alice has Shapley value");
        assertGt(bobValue, 0, "Bob has Shapley value");

        // Efficiency axiom: total == pool
        assertEq(aliceValue + bobValue, pool, "Shapley efficiency: sum == pool");

        // Step 8: Contributors claim
        uint256 aliceBefore = vibe.balanceOf(alice);
        vm.prank(alice);
        shapley.claimReward(gameId);
        assertEq(vibe.balanceOf(alice) - aliceBefore, aliceValue, "Alice received correct amount");

        uint256 bobBefore = vibe.balanceOf(bob);
        vm.prank(bob);
        shapley.claimReward(gameId);
        assertEq(vibe.balanceOf(bob) - bobBefore, bobValue, "Bob received correct amount");
    }

    // ============ Test 8: Rosetta Without SIE (No SIE Set) ============

    function test_withoutSIE_termRegistrationSucceeds() public {
        // Disconnect SIE
        rosetta.setSIE(address(0));

        // Term registration should still succeed
        string[] memory termArr = new string[](1);
        bytes32[] memory uciArr  = new bytes32[](1);
        termArr[0] = "slippage";
        uciArr[0]  = UCI_THRESHOLD_BREACH;
        vm.prank(alice);
        rosetta.registerLexicon("trading", termArr, uciArr);

        // Term is in Rosetta lexicon
        bytes32 uci = rosetta.getUniversalConcept(alice, "slippage");
        assertEq(uci, UCI_THRESHOLD_BREACH, "Term stored in Rosetta");

        // SIE has no assets (nothing forwarded)
        assertEq(sie.assetCount(), 0, "No SIE asset when SIE not connected");

        // Adapter has no pending settlements
        assertEq(adapter.getPendingSettlementCount(), 0, "No settlements without SIE");
    }

    // ============ Test 9: SIE Failure Does NOT Block Term Registration ============

    function test_brokenSIE_doesNotBlockTermRegistration() public {
        // Point Rosetta to a broken SIE address (non-contract)
        rosetta.setSIE(address(0xDEAD));

        // Term registration should not revert
        string[] memory termArr = new string[](1);
        bytes32[] memory uciArr  = new bytes32[](1);
        termArr[0] = "slippage";
        uciArr[0]  = UCI_THRESHOLD_BREACH;
        vm.prank(alice);
        rosetta.registerLexicon("trading", termArr, uciArr);

        // Term is in Rosetta lexicon — Rosetta is the source of truth
        bytes32 uci = rosetta.getUniversalConcept(alice, "slippage");
        assertEq(uci, UCI_THRESHOLD_BREACH, "Term stored in Rosetta despite SIE failure");
    }

    // ============ Test 10: SIE Failure Does NOT Block verifyTranslation ============

    function test_brokenSIE_doesNotBlockVerifyTranslation() public {
        // Register terms with a working SIE first
        _registerTerm(alice, "trading",    "slippage",    UCI_THRESHOLD_BREACH);
        _registerTerm(bob,   "governance", "quorum_failed", UCI_THRESHOLD_BREACH);

        // Now break the SIE connection on Rosetta
        rosetta.setSIE(address(0xDEAD));

        // Translation should still succeed and return correct result
        bool result = rosetta.verifyTranslation(alice, bob, "slippage", "quorum_failed");
        assertTrue(result, "Translation works even when SIE is broken");
    }

    // ============ Test 11: getSIEAssetId Is Deterministic ============

    function test_getSIEAssetId_isDeterministic() public view {
        bytes32 id1 = rosetta.getSIEAssetId(alice, "slippage", UCI_THRESHOLD_BREACH);
        bytes32 id2 = rosetta.getSIEAssetId(alice, "slippage", UCI_THRESHOLD_BREACH);
        assertEq(id1, id2, "Same inputs produce same asset ID");

        // Different owner → different ID
        bytes32 id3 = rosetta.getSIEAssetId(bob, "slippage", UCI_THRESHOLD_BREACH);
        assertTrue(id1 != id3, "Different owner → different ID");

        // Different term → different ID
        bytes32 id4 = rosetta.getSIEAssetId(alice, "other_term", UCI_THRESHOLD_BREACH);
        assertTrue(id1 != id4, "Different term → different ID");
    }

    // ============ Test 12: setSIE Access Control ============

    function test_setSIE_revertsForNonOwner() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                OwnableUpgradeable.OwnableUnauthorizedAccount.selector,
                alice
            )
        );
        rosetta.setSIE(address(0xBEEF));
    }

    function test_setSIE_ownerCanUpdate() public {
        rosetta.setSIE(address(0xBEEF));
        assertEq(rosetta.sieAddress(), address(0xBEEF), "SIE address updated");
    }

    // ============ Test 13: setRosettaProtocol Access Control in SIE ============

    function test_setRosettaProtocol_revertsForNonOwner() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                OwnableUpgradeable.OwnableUnauthorizedAccount.selector,
                alice
            )
        );
        sie.setRosettaProtocol(address(0xBEEF));
    }

    function test_registerConceptAsset_revertsForNonRosetta() public {
        bytes32 fakeId = keccak256("fake");
        vm.prank(alice);
        vm.expectRevert(IntelligenceExchange.NotRosettaProtocol.selector);
        sie.registerConceptAsset(fakeId, alice);
    }

    function test_recordCitation_revertsForNonRosetta() public {
        vm.prank(alice);
        vm.expectRevert(IntelligenceExchange.NotRosettaProtocol.selector);
        sie.recordCitation(keccak256("a"), keccak256("b"));
    }

    // ============ Test 14: Three-Domain Ecosystem with True-Up ============

    function test_threeDomain_shapleyRewardsProportional() public {
        // Alice, Bob, Carol each register a term for UCI_THRESHOLD_BREACH
        // Bob and Carol's terms get cited; Alice's does not
        bytes32 aliceId = _registerTerm(alice, "trading",    "slippage",          UCI_THRESHOLD_BREACH);
        bytes32 bobId   = _registerTerm(bob,   "governance", "quorum_failed",      UCI_THRESHOLD_BREACH);
        bytes32 carolId = _registerTerm(carol, "social",     "toxicity_threshold", UCI_THRESHOLD_BREACH);

        // alice→bob (bob cited once)
        rosetta.verifyTranslation(alice, bob, "slippage", "quorum_failed");
        // alice→carol (carol cited once)
        rosetta.verifyTranslation(alice, carol, "slippage", "toxicity_threshold");
        // carol→bob (bob cited twice)
        rosetta.verifyTranslation(carol, bob, "toxicity_threshold", "quorum_failed");

        assertEq(sie.getAsset(bobId).citations,   2, "Bob cited twice");
        assertEq(sie.getAsset(carolId).citations, 1, "Carol cited once");
        assertEq(sie.getAsset(aliceId).citations, 0, "Alice never cited");

        // All three have settlements (concept registration notified adapter)
        assertEq(adapter.getPendingSettlementCount(), 3);
        assertEq(adapter.getPendingContributorCount(), 3);

        // Run true-up
        uint256 pool = 300 ether;
        vibe.transfer(address(adapter), pool);
        vm.warp(block.timestamp + 1 hours + 1);
        adapter.executeTrueUp(pool);

        bytes32 roundId = keccak256(abi.encodePacked(uint256(1), block.timestamp));
        bytes32 gameId = adapter.getRound(roundId).shapleyGameId;
        shapley.computeShapleyValues(gameId);

        uint256 aliceValue = shapley.getShapleyValue(gameId, alice);
        uint256 bobValue   = shapley.getShapleyValue(gameId, bob);
        uint256 carolValue = shapley.getShapleyValue(gameId, carol);

        // All non-zero
        assertGt(aliceValue, 0, "Alice has value");
        assertGt(bobValue, 0, "Bob has value");
        assertGt(carolValue, 0, "Carol has value");

        // Efficiency axiom
        assertEq(aliceValue + bobValue + carolValue, pool, "Efficiency axiom holds");
    }

    // ============ Test 15: addTerm After Lexicon Registration Also Registers in SIE ============

    function test_addTerm_alsoRegistersInSIE() public {
        // Register lexicon with zero initial terms
        string[] memory emptyTerms = new string[](0);
        bytes32[] memory emptyUCIs  = new bytes32[](0);
        vm.prank(alice);
        rosetta.registerLexicon("trading", emptyTerms, emptyUCIs);

        assertEq(sie.assetCount(), 0, "No assets yet");

        // Now add a term via addTerm()
        vm.prank(alice);
        rosetta.addTerm("slippage", UCI_THRESHOLD_BREACH);

        bytes32 assetId = rosetta.getSIEAssetId(alice, "slippage", UCI_THRESHOLD_BREACH);
        IntelligenceExchange.IntelligenceAsset memory asset = sie.getAsset(assetId);

        assertEq(sie.assetCount(), 1, "One asset registered via addTerm");
        assertEq(asset.contributor, alice, "Contributor is Alice");
        assertEq(
            uint256(asset.state),
            uint256(IntelligenceExchange.AssetState.VERIFIED),
            "Term from addTerm is VERIFIED"
        );
    }

    // ============ Fuzz: Term Registration Always Creates SIE Asset ============

    function testFuzz_termRegistration_alwaysCreatesAsset(
        string calldata domain,
        string calldata term,
        bytes32 uci
    ) public {
        vm.assume(bytes(domain).length > 0);
        vm.assume(bytes(term).length > 0);
        vm.assume(uci != bytes32(0));

        address user = address(uint160(uint256(keccak256(bytes(domain)))));
        vm.deal(user, 1 ether);

        string[] memory termArr = new string[](1);
        bytes32[] memory uciArr  = new bytes32[](1);
        termArr[0] = term;
        uciArr[0]  = uci;

        vm.prank(user);
        rosetta.registerLexicon(domain, termArr, uciArr);

        bytes32 assetId = rosetta.getSIEAssetId(user, term, uci);
        IntelligenceExchange.IntelligenceAsset memory asset = sie.getAsset(assetId);

        assertEq(asset.contributor, user, "Contributor matches lexicon owner");
        assertEq(
            uint256(asset.state),
            uint256(IntelligenceExchange.AssetState.VERIFIED),
            "Concept asset always VERIFIED on registration"
        );
    }
}
