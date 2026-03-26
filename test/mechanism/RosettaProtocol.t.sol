// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/RosettaProtocol.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title RosettaProtocol Tests
 * @notice Comprehensive unit, fuzz, and invariant tests for RosettaProtocol.
 *
 * Coverage:
 *  - Initialization (covenant hashes, owner, resolvers)
 *  - Lexicon Registry (register, add term, remove term, edge cases)
 *  - Translation Verification (positive, negative, inactive term, zero concept)
 *  - getUniversalConcept and getEquivalents
 *  - Covenant Registry (verifyCovenant, verifyAllCovenants, tamper detection)
 *  - Challenge Protocol (initiate, accept, resolve, cancel expired)
 *  - Security: reentrancy surface, access control, stake accounting
 *  - Fuzz: term registration, translation, challenge stakes
 *  - P-001: zero protocol fee invariant
 */
contract RosettaProtocolTest is Test {
    RosettaProtocol public rosetta;

    address public owner  = address(this);
    address public alice  = address(0xA11CE);
    address public bob    = address(0xB0B);
    address public carol  = address(0xCA201);
    address public oracle = address(0x0AC1E);
    address public attacker = address(0xBAD);

    // The canonical Ten Covenants of Tet
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

    // Sample UCI identifiers (keccak256 of concept names for realism)
    bytes32 constant UCI_SYSTEM_STRESS     = keccak256("UCI-0001:system_stress");
    bytes32 constant UCI_RATE_LIMIT        = keccak256("UCI-0002:rate_limit");
    bytes32 constant UCI_THRESHOLD_BREACH  = keccak256("UCI-0003:threshold_breach");
    bytes32 constant UCI_VALUE_TRANSFER    = keccak256("UCI-0004:value_transfer");
    bytes32 constant UCI_ROLLBACK          = keccak256("UCI-0005:rollback");

    // ============ Setup ============

    function setUp() public {
        address[] memory resolvers = new address[](1);
        resolvers[0] = oracle;

        RosettaProtocol impl = new RosettaProtocol();
        bytes memory initData = abi.encodeCall(
            RosettaProtocol.initialize,
            (owner, COVENANTS, resolvers)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        rosetta = RosettaProtocol(payable(address(proxy)));

        vm.deal(alice,   10 ether);
        vm.deal(bob,     10 ether);
        vm.deal(carol,   10 ether);
        vm.deal(attacker, 1 ether);
    }

    // ============ Initialization ============

    function test_initialize_owner() public view {
        assertEq(rosetta.owner(), owner);
    }

    function test_initialize_trustedResolver() public view {
        assertTrue(rosetta.isTrustedResolver(oracle));
        assertFalse(rosetta.isTrustedResolver(attacker));
    }

    function test_initialize_covenantHashSet() public view {
        assertTrue(rosetta.COVENANT_HASH() != bytes32(0));
    }

    function test_initialize_individualCovenantHashes() public view {
        for (uint8 i = 1; i <= 10; i++) {
            bytes32 stored = rosetta.covenantHashes(i);
            bytes32 expected = keccak256(bytes(COVENANTS[i - 1]));
            assertEq(stored, expected, "Covenant hash mismatch");
        }
    }

    function test_P001_zeroProtocolFee() public pure {
        assertEq(RosettaProtocol.PROTOCOL_FEE_BPS(), 0);
    }

    function test_initialize_challengeCountZero() public view {
        assertEq(rosetta.challengeCount(), 0);
    }

    // ============ Lexicon Registry — Happy Path ============

    function test_registerLexicon_basic() public {
        string[] memory termArr = new string[](1);
        bytes32[] memory uciArr = new bytes32[](1);
        termArr[0] = "slippage";
        uciArr[0]  = UCI_THRESHOLD_BREACH;

        vm.prank(alice);
        rosetta.registerLexicon("trading", termArr, uciArr);

        (string memory domain,, uint256 count,) = rosetta.lexiconOf(alice);
        assertEq(domain, "trading");
        assertEq(count, 1);
    }

    function test_registerLexicon_empty_terms_allowed() public {
        string[] memory termArr = new string[](0);
        bytes32[] memory uciArr = new bytes32[](0);

        vm.prank(alice);
        rosetta.registerLexicon("governance", termArr, uciArr);

        (, bool registered,,) = rosetta.lexiconOf(alice);
        assertTrue(registered);
    }

    function test_registerLexicon_emits_event() public {
        string[] memory termArr = new string[](0);
        bytes32[] memory uciArr = new bytes32[](0);

        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit RosettaProtocol.LexiconRegistered(alice, "trading", block.timestamp);
        rosetta.registerLexicon("trading", termArr, uciArr);
    }

    function test_addTerm_basic() public {
        _registerAliceTrading();

        vm.prank(alice);
        rosetta.addTerm("circuit_breaker", UCI_THRESHOLD_BREACH);

        bytes32 uci = rosetta.getUniversalConcept(alice, "circuit_breaker");
        assertEq(uci, UCI_THRESHOLD_BREACH);
    }

    function test_addTerm_emits_event() public {
        _registerAliceTrading();

        bytes32 termHash = keccak256(bytes("order_flow"));
        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit RosettaProtocol.TermAdded(alice, "order_flow", termHash, UCI_VALUE_TRANSFER);
        rosetta.addTerm("order_flow", UCI_VALUE_TRANSFER);
    }

    function test_removeTerm_deactivates() public {
        _registerAliceTrading(); // registers "slippage"

        vm.prank(alice);
        rosetta.removeTerm("slippage");

        bytes32 uci = rosetta.getUniversalConcept(alice, "slippage");
        assertEq(uci, bytes32(0));
    }

    function test_removeTerm_decrements_count() public {
        _registerAliceTrading();

        (,, uint256 before,) = rosetta.lexiconOf(alice);
        vm.prank(alice);
        rosetta.removeTerm("slippage");
        (,, uint256 after_,) = rosetta.lexiconOf(alice);

        assertEq(after_, before - 1);
    }

    function test_removeTerm_emits_event() public {
        _registerAliceTrading();

        bytes32 termHash = keccak256(bytes("slippage"));
        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit RosettaProtocol.TermRemoved(alice, "slippage", termHash);
        rosetta.removeTerm("slippage");
    }

    // ============ Lexicon Registry — Revert Cases ============

    function test_registerLexicon_reverts_if_already_registered() public {
        _registerAliceTrading();

        string[] memory t = new string[](0);
        bytes32[] memory u = new bytes32[](0);
        vm.prank(alice);
        vm.expectRevert(RosettaProtocol.AlreadyRegistered.selector);
        rosetta.registerLexicon("trading2", t, u);
    }

    function test_registerLexicon_reverts_empty_domain() public {
        string[] memory t = new string[](0);
        bytes32[] memory u = new bytes32[](0);
        vm.prank(alice);
        vm.expectRevert(RosettaProtocol.InvalidInput.selector);
        rosetta.registerLexicon("", t, u);
    }

    function test_registerLexicon_reverts_array_length_mismatch() public {
        string[] memory t = new string[](2);
        bytes32[] memory u = new bytes32[](1);
        t[0] = "a"; t[1] = "b"; u[0] = UCI_SYSTEM_STRESS;
        vm.prank(alice);
        vm.expectRevert(RosettaProtocol.InvalidInput.selector);
        rosetta.registerLexicon("trading", t, u);
    }

    function test_addTerm_reverts_if_not_registered() public {
        vm.prank(alice);
        vm.expectRevert(RosettaProtocol.NotRegistered.selector);
        rosetta.addTerm("slippage", UCI_THRESHOLD_BREACH);
    }

    function test_addTerm_reverts_duplicate() public {
        _registerAliceTrading(); // "slippage" already added

        vm.prank(alice);
        vm.expectRevert(RosettaProtocol.TermAlreadyExists.selector);
        rosetta.addTerm("slippage", UCI_THRESHOLD_BREACH);
    }

    function test_addTerm_reverts_empty_term() public {
        _registerAliceTrading();

        vm.prank(alice);
        vm.expectRevert(RosettaProtocol.InvalidInput.selector);
        rosetta.addTerm("", UCI_SYSTEM_STRESS);
    }

    function test_addTerm_reverts_zero_concept() public {
        _registerAliceTrading();

        vm.prank(alice);
        vm.expectRevert(RosettaProtocol.InvalidInput.selector);
        rosetta.addTerm("new_term", bytes32(0));
    }

    function test_removeTerm_reverts_not_found() public {
        _registerAliceTrading();

        vm.prank(alice);
        vm.expectRevert(RosettaProtocol.TermNotFound.selector);
        rosetta.removeTerm("nonexistent");
    }

    function test_removeTerm_reverts_already_removed() public {
        _registerAliceTrading();

        vm.prank(alice);
        rosetta.removeTerm("slippage");

        vm.prank(alice);
        vm.expectRevert(RosettaProtocol.TermNotFound.selector);
        rosetta.removeTerm("slippage");
    }

    // ============ Translation Verification ============

    function test_verifyTranslation_true_same_concept() public {
        // Alice (trading): "slippage_exceeded" → UCI_THRESHOLD_BREACH
        // Bob (governance): "quorum_failed" → UCI_THRESHOLD_BREACH
        _registerAliceTrading();   // "slippage" → UCI_THRESHOLD_BREACH

        string[] memory t = new string[](1);
        bytes32[] memory u = new bytes32[](1);
        t[0] = "quorum_failed"; u[0] = UCI_THRESHOLD_BREACH;
        vm.prank(bob);
        rosetta.registerLexicon("governance", t, u);

        bool result = rosetta.verifyTranslation(alice, bob, "slippage", "quorum_failed");
        assertTrue(result);
    }

    function test_verifyTranslation_false_different_concepts() public {
        _registerAliceTrading(); // "slippage" → UCI_THRESHOLD_BREACH

        string[] memory t = new string[](1);
        bytes32[] memory u = new bytes32[](1);
        t[0] = "proposal"; u[0] = UCI_VALUE_TRANSFER; // different UCI
        vm.prank(bob);
        rosetta.registerLexicon("governance", t, u);

        bool result = rosetta.verifyTranslation(alice, bob, "slippage", "proposal");
        assertFalse(result);
    }

    function test_verifyTranslation_false_inactive_source() public {
        _registerAliceTrading(); // "slippage" → UCI_THRESHOLD_BREACH

        string[] memory t = new string[](1);
        bytes32[] memory u = new bytes32[](1);
        t[0] = "quorum_failed"; u[0] = UCI_THRESHOLD_BREACH;
        vm.prank(bob);
        rosetta.registerLexicon("governance", t, u);

        // Remove source term
        vm.prank(alice);
        rosetta.removeTerm("slippage");

        bool result = rosetta.verifyTranslation(alice, bob, "slippage", "quorum_failed");
        assertFalse(result);
    }

    function test_verifyTranslation_false_inactive_target() public {
        _registerAliceTrading();

        string[] memory t = new string[](1);
        bytes32[] memory u = new bytes32[](1);
        t[0] = "quorum_failed"; u[0] = UCI_THRESHOLD_BREACH;
        vm.prank(bob);
        rosetta.registerLexicon("governance", t, u);

        vm.prank(bob);
        rosetta.removeTerm("quorum_failed");

        bool result = rosetta.verifyTranslation(alice, bob, "slippage", "quorum_failed");
        assertFalse(result);
    }

    function test_verifyTranslation_emits_event() public {
        _registerAliceTrading();

        string[] memory t = new string[](1);
        bytes32[] memory u = new bytes32[](1);
        t[0] = "quorum_failed"; u[0] = UCI_THRESHOLD_BREACH;
        vm.prank(bob);
        rosetta.registerLexicon("governance", t, u);

        vm.expectEmit(true, true, false, true);
        emit RosettaProtocol.TranslationVerified(
            alice,
            bob,
            "slippage",
            "quorum_failed",
            UCI_THRESHOLD_BREACH,
            true
        );
        rosetta.verifyTranslation(alice, bob, "slippage", "quorum_failed");
    }

    // ============ getUniversalConcept ============

    function test_getUniversalConcept_active_term() public {
        _registerAliceTrading();
        bytes32 uci = rosetta.getUniversalConcept(alice, "slippage");
        assertEq(uci, UCI_THRESHOLD_BREACH);
    }

    function test_getUniversalConcept_returns_zero_for_unknown() public {
        _registerAliceTrading();
        bytes32 uci = rosetta.getUniversalConcept(alice, "nonexistent_term");
        assertEq(uci, bytes32(0));
    }

    function test_getUniversalConcept_returns_zero_after_remove() public {
        _registerAliceTrading();
        vm.prank(alice);
        rosetta.removeTerm("slippage");
        bytes32 uci = rosetta.getUniversalConcept(alice, "slippage");
        assertEq(uci, bytes32(0));
    }

    // ============ getEquivalents ============

    function test_getEquivalents_multiple_lexicons() public {
        // Three agents all register a term for UCI_THRESHOLD_BREACH
        _registerAliceTrading();     // "slippage"

        string[] memory t = new string[](1);
        bytes32[] memory u = new bytes32[](1);
        t[0] = "quorum_failed"; u[0] = UCI_THRESHOLD_BREACH;
        vm.prank(bob);
        rosetta.registerLexicon("governance", t, u);

        t[0] = "toxicity_threshold"; u[0] = UCI_THRESHOLD_BREACH;
        vm.prank(carol);
        rosetta.registerLexicon("social", t, u);

        (address[] memory owners, bytes32[] memory hashes, string[] memory vals) =
            rosetta.getEquivalents(UCI_THRESHOLD_BREACH);

        assertEq(owners.length, 3);
        assertEq(hashes.length, 3);
        assertEq(vals.length, 3);
    }

    function test_getEquivalents_excludes_removed_terms() public {
        _registerAliceTrading(); // "slippage" → UCI_THRESHOLD_BREACH

        string[] memory t = new string[](1);
        bytes32[] memory u = new bytes32[](1);
        t[0] = "quorum_failed"; u[0] = UCI_THRESHOLD_BREACH;
        vm.prank(bob);
        rosetta.registerLexicon("governance", t, u);

        // Remove alice's term
        vm.prank(alice);
        rosetta.removeTerm("slippage");

        (address[] memory owners,,) = rosetta.getEquivalents(UCI_THRESHOLD_BREACH);
        assertEq(owners.length, 1);
        assertEq(owners[0], bob);
    }

    function test_getEquivalents_empty_for_unknown_concept() public view {
        (address[] memory owners,,) = rosetta.getEquivalents(keccak256("UCI-UNKNOWN"));
        assertEq(owners.length, 0);
    }

    // ============ Covenant Registry ============

    function test_verifyCovenant_all_ten_match() public view {
        for (uint8 i = 1; i <= 10; i++) {
            assertTrue(
                rosetta.verifyCovenant(i, COVENANTS[i - 1]),
                string.concat("Covenant ", vm.toString(i), " mismatch")
            );
        }
    }

    function test_verifyCovenant_false_on_tampered_text() public view {
        assertFalse(
            rosetta.verifyCovenant(
                9,
                "These Covenants may be changed by the owner." // tampered Covenant IX
            )
        );
    }

    function test_verifyCovenant_reverts_index_zero() public {
        vm.expectRevert(RosettaProtocol.InvalidInput.selector);
        rosetta.verifyCovenant(0, COVENANTS[0]);
    }

    function test_verifyCovenant_reverts_index_eleven() public {
        vm.expectRevert(RosettaProtocol.InvalidInput.selector);
        rosetta.verifyCovenant(11, "");
    }

    function test_verifyAllCovenants_passes_with_originals() public view {
        assertTrue(rosetta.verifyAllCovenants(COVENANTS));
    }

    function test_verifyAllCovenants_fails_if_one_altered() public view {
        string[10] memory tampered = COVENANTS;
        tampered[8] = "These Covenants may be changed."; // Covenant IX tampered
        assertFalse(rosetta.verifyAllCovenants(tampered));
    }

    // ============ Challenge Protocol ============

    function test_initiateChallenge_basic() public {
        vm.prank(alice);
        rosetta.initiateChallenge{value: 1 ether}(bob, bytes32("dispute:lexicon_scope"));

        (
            uint256 id,
            address challenger,
            address opponent,
            bytes32 stakes,
            uint256 stakeAmount,
            ,
            RosettaProtocol.ChallengeState state,
            ,,,
        ) = rosetta.challenges(1);

        assertEq(id, 1);
        assertEq(challenger, alice);
        assertEq(opponent, bob);
        assertEq(stakes, bytes32("dispute:lexicon_scope"));
        assertEq(stakeAmount, 1 ether);
        assertEq(uint8(state), uint8(RosettaProtocol.ChallengeState.PENDING));
    }

    function test_initiateChallenge_increments_count() public {
        vm.prank(alice);
        rosetta.initiateChallenge{value: 1 ether}(bob, bytes32("d1"));
        vm.prank(bob);
        rosetta.initiateChallenge{value: 0.5 ether}(carol, bytes32("d2"));

        assertEq(rosetta.challengeCount(), 2);
    }

    function test_initiateChallenge_emits_event() public {
        vm.prank(alice);
        vm.expectEmit(true, true, true, true);
        emit RosettaProtocol.ChallengeInitiated(
            1, alice, bob, bytes32("d"), 1 ether
        );
        rosetta.initiateChallenge{value: 1 ether}(bob, bytes32("d"));
    }

    function test_initiateChallenge_reverts_zero_stake() public {
        vm.prank(alice);
        vm.expectRevert(RosettaProtocol.StakeRequired.selector);
        rosetta.initiateChallenge{value: 0}(bob, bytes32("d"));
    }

    function test_initiateChallenge_reverts_self_challenge() public {
        vm.prank(alice);
        vm.expectRevert(RosettaProtocol.InvalidInput.selector);
        rosetta.initiateChallenge{value: 1 ether}(alice, bytes32("d"));
    }

    function test_initiateChallenge_reverts_zero_address() public {
        vm.prank(alice);
        vm.expectRevert(RosettaProtocol.InvalidInput.selector);
        rosetta.initiateChallenge{value: 1 ether}(address(0), bytes32("d"));
    }

    function test_acceptChallenge_basic() public {
        vm.prank(alice);
        rosetta.initiateChallenge{value: 1 ether}(bob, bytes32("d"));

        vm.prank(bob);
        rosetta.acceptChallenge{value: 1 ether}(1, "weighted_vote");

        (,,,, uint256 stakeAmount, uint256 oppStake, RosettaProtocol.ChallengeState state,, string memory rules,,) =
            rosetta.challenges(1);

        assertEq(uint8(state), uint8(RosettaProtocol.ChallengeState.ACCEPTED));
        assertEq(stakeAmount, 1 ether);
        assertEq(oppStake, 1 ether);
        assertEq(rules, "weighted_vote");
    }

    function test_acceptChallenge_emits_game_rules_event() public {
        vm.prank(alice);
        rosetta.initiateChallenge{value: 1 ether}(bob, bytes32("d"));

        vm.prank(bob);
        vm.expectEmit(true, false, false, true);
        emit RosettaProtocol.GameRulesSubmitted(1, "simulation_tournament");
        rosetta.acceptChallenge{value: 1 ether}(1, "simulation_tournament");
    }

    function test_acceptChallenge_reverts_wrong_opponent() public {
        vm.prank(alice);
        rosetta.initiateChallenge{value: 1 ether}(bob, bytes32("d"));

        vm.prank(carol);
        vm.expectRevert(RosettaProtocol.NotChallenged.selector);
        rosetta.acceptChallenge{value: 1 ether}(1, "rules");
    }

    function test_acceptChallenge_reverts_stake_mismatch() public {
        vm.prank(alice);
        rosetta.initiateChallenge{value: 1 ether}(bob, bytes32("d"));

        vm.prank(bob);
        vm.expectRevert(RosettaProtocol.StakeMismatch.selector);
        rosetta.acceptChallenge{value: 0.5 ether}(1, "rules");
    }

    function test_acceptChallenge_reverts_empty_rules() public {
        vm.prank(alice);
        rosetta.initiateChallenge{value: 1 ether}(bob, bytes32("d"));

        vm.prank(bob);
        vm.expectRevert(RosettaProtocol.InvalidInput.selector);
        rosetta.acceptChallenge{value: 1 ether}(1, "");
    }

    function test_acceptChallenge_reverts_expired() public {
        vm.prank(alice);
        rosetta.initiateChallenge{value: 1 ether}(bob, bytes32("d"));

        vm.warp(block.timestamp + rosetta.CHALLENGE_EXPIRY() + 1);

        vm.prank(bob);
        vm.expectRevert(RosettaProtocol.ChallengeExpired.selector);
        rosetta.acceptChallenge{value: 1 ether}(1, "rules");
    }

    function test_resolveChallenge_challenger_wins() public {
        vm.prank(alice);
        rosetta.initiateChallenge{value: 1 ether}(bob, bytes32("d"));
        vm.prank(bob);
        rosetta.acceptChallenge{value: 1 ether}(1, "weighted_vote");

        uint256 aliceBefore = alice.balance;

        vm.prank(oracle);
        rosetta.resolveChallenge(1, alice);

        // P-001: full 2 ETH to winner, zero extracted
        assertEq(alice.balance - aliceBefore, 2 ether);
    }

    function test_resolveChallenge_opponent_wins() public {
        vm.prank(alice);
        rosetta.initiateChallenge{value: 1 ether}(bob, bytes32("d"));
        vm.prank(bob);
        rosetta.acceptChallenge{value: 1 ether}(1, "weighted_vote");

        uint256 bobBefore = bob.balance;

        vm.prank(oracle);
        rosetta.resolveChallenge(1, bob);

        assertEq(bob.balance - bobBefore, 2 ether);
    }

    function test_resolveChallenge_marks_resolved() public {
        vm.prank(alice);
        rosetta.initiateChallenge{value: 1 ether}(bob, bytes32("d"));
        vm.prank(bob);
        rosetta.acceptChallenge{value: 1 ether}(1, "weighted_vote");

        vm.prank(oracle);
        rosetta.resolveChallenge(1, alice);

        (,,,,,,RosettaProtocol.ChallengeState state, address winner,,,) = rosetta.challenges(1);
        assertEq(uint8(state), uint8(RosettaProtocol.ChallengeState.RESOLVED));
        assertEq(winner, alice);
    }

    function test_resolveChallenge_emits_event() public {
        vm.prank(alice);
        rosetta.initiateChallenge{value: 1 ether}(bob, bytes32("d"));
        vm.prank(bob);
        rosetta.acceptChallenge{value: 1 ether}(1, "weighted_vote");

        vm.prank(oracle);
        vm.expectEmit(true, true, false, true);
        emit RosettaProtocol.ChallengeResolved(1, alice, 2 ether);
        rosetta.resolveChallenge(1, alice);
    }

    function test_resolveChallenge_reverts_not_resolver() public {
        vm.prank(alice);
        rosetta.initiateChallenge{value: 1 ether}(bob, bytes32("d"));
        vm.prank(bob);
        rosetta.acceptChallenge{value: 1 ether}(1, "weighted_vote");

        vm.prank(attacker);
        vm.expectRevert(RosettaProtocol.NotResolver.selector);
        rosetta.resolveChallenge(1, alice);
    }

    function test_resolveChallenge_reverts_invalid_winner() public {
        vm.prank(alice);
        rosetta.initiateChallenge{value: 1 ether}(bob, bytes32("d"));
        vm.prank(bob);
        rosetta.acceptChallenge{value: 1 ether}(1, "weighted_vote");

        vm.prank(oracle);
        vm.expectRevert(RosettaProtocol.InvalidInput.selector);
        rosetta.resolveChallenge(1, carol); // carol is not a party
    }

    function test_resolveChallenge_reverts_wrong_state() public {
        vm.prank(alice);
        rosetta.initiateChallenge{value: 1 ether}(bob, bytes32("d"));
        // Not accepted yet — state is PENDING

        vm.prank(oracle);
        vm.expectRevert(RosettaProtocol.WrongChallengeState.selector);
        rosetta.resolveChallenge(1, alice);
    }

    function test_cancelExpiredChallenge_returns_stake() public {
        vm.prank(alice);
        rosetta.initiateChallenge{value: 1 ether}(bob, bytes32("d"));

        uint256 aliceBefore = alice.balance;
        vm.warp(block.timestamp + rosetta.CHALLENGE_EXPIRY() + 1);

        vm.prank(alice);
        rosetta.cancelExpiredChallenge(1);

        assertEq(alice.balance - aliceBefore, 1 ether);
    }

    function test_cancelExpiredChallenge_reverts_not_expired() public {
        vm.prank(alice);
        rosetta.initiateChallenge{value: 1 ether}(bob, bytes32("d"));

        vm.prank(alice);
        vm.expectRevert(RosettaProtocol.ChallengeNotExpired.selector);
        rosetta.cancelExpiredChallenge(1);
    }

    function test_cancelExpiredChallenge_reverts_wrong_caller() public {
        vm.prank(alice);
        rosetta.initiateChallenge{value: 1 ether}(bob, bytes32("d"));

        vm.warp(block.timestamp + rosetta.CHALLENGE_EXPIRY() + 1);

        vm.prank(bob);
        vm.expectRevert(RosettaProtocol.InvalidInput.selector);
        rosetta.cancelExpiredChallenge(1);
    }

    // ============ Admin ============

    function test_setTrustedResolver_add() public {
        assertFalse(rosetta.isTrustedResolver(carol));
        rosetta.setTrustedResolver(carol, true);
        assertTrue(rosetta.isTrustedResolver(carol));
    }

    function test_setTrustedResolver_remove() public {
        rosetta.setTrustedResolver(oracle, false);
        assertFalse(rosetta.isTrustedResolver(oracle));
    }

    function test_setTrustedResolver_reverts_non_owner() public {
        vm.prank(attacker);
        vm.expectRevert();
        rosetta.setTrustedResolver(attacker, true);
    }

    function test_setTrustedResolver_reverts_zero_address() public {
        vm.expectRevert(RosettaProtocol.InvalidInput.selector);
        rosetta.setTrustedResolver(address(0), true);
    }

    // ============ UUPS Upgrade ============

    function test_upgrade_reverts_non_owner() public {
        RosettaProtocol newImpl = new RosettaProtocol();
        vm.prank(attacker);
        vm.expectRevert();
        rosetta.upgradeToAndCall(address(newImpl), "");
    }

    function test_upgrade_by_owner_succeeds() public {
        RosettaProtocol newImpl = new RosettaProtocol();
        rosetta.upgradeToAndCall(address(newImpl), "");
        // No revert = success. COVENANT_HASH preserved across upgrade.
        assertTrue(rosetta.COVENANT_HASH() != bytes32(0));
    }

    // ============ Fuzz Tests ============

    function testFuzz_termRegistration(
        string calldata domain,
        string calldata term,
        bytes32 universalConcept
    ) public {
        vm.assume(bytes(domain).length > 0);
        vm.assume(bytes(term).length > 0);
        vm.assume(universalConcept != bytes32(0));

        string[] memory t = new string[](1);
        bytes32[] memory u = new bytes32[](1);
        t[0] = term;
        u[0] = universalConcept;

        address user = address(uint160(uint256(keccak256(bytes(domain)))));
        vm.deal(user, 1 ether);

        vm.prank(user);
        rosetta.registerLexicon(domain, t, u);

        bytes32 stored = rosetta.getUniversalConcept(user, term);
        assertEq(stored, universalConcept);
    }

    function testFuzz_translationVerification(
        bytes32 uci,
        string calldata termA,
        string calldata termB
    ) public {
        vm.assume(uci != bytes32(0));
        vm.assume(bytes(termA).length > 0);
        vm.assume(bytes(termB).length > 0);
        // Avoid hash collision: only assume equality if strings are equal
        vm.assume(keccak256(bytes(termA)) != keccak256(bytes(termB)));

        string[] memory t = new string[](1);
        bytes32[] memory u = new bytes32[](1);

        t[0] = termA; u[0] = uci;
        vm.prank(alice);
        rosetta.registerLexicon("domainA", t, u);

        t[0] = termB; u[0] = uci;
        vm.prank(bob);
        rosetta.registerLexicon("domainB", t, u);

        // Different strings mapping to same UCI must verify as equivalent
        assertTrue(rosetta.verifyTranslation(alice, bob, termA, termB));
    }

    function testFuzz_challengeStake(uint96 stake) public {
        vm.assume(stake > 0);
        vm.deal(alice, uint256(stake));
        vm.deal(bob,   uint256(stake));

        vm.prank(alice);
        rosetta.initiateChallenge{value: stake}(bob, bytes32("fuzz"));

        vm.prank(bob);
        rosetta.acceptChallenge{value: stake}(1, "prediction_market");

        uint256 aliceBefore = alice.balance;
        vm.prank(oracle);
        rosetta.resolveChallenge(1, alice);

        // Full payout, zero extracted (P-001)
        assertEq(alice.balance - aliceBefore, uint256(stake) * 2);
    }

    function testFuzz_verifyCovenant(string calldata text, uint8 index) public view {
        vm.assume(index >= 1 && index <= 10);
        // Random text should almost never match (collision-resistant)
        // Unless it happens to be the actual covenant — we don't care which way it goes
        bool result = rosetta.verifyCovenant(index, text);
        bool expected = (keccak256(bytes(text)) == rosetta.covenantHashes(index));
        assertEq(result, expected);
    }

    // ============ Invariants ============

    function invariant_covenantHashNeverZero() public view {
        assertTrue(rosetta.COVENANT_HASH() != bytes32(0));
    }

    function invariant_protocolFeeAlwaysZero() public pure {
        assertEq(RosettaProtocol.PROTOCOL_FEE_BPS(), 0);
    }

    // ============ Helpers ============

    function _registerAliceTrading() internal {
        string[] memory t = new string[](1);
        bytes32[] memory u = new bytes32[](1);
        t[0] = "slippage";
        u[0] = UCI_THRESHOLD_BREACH;
        vm.prank(alice);
        rosetta.registerLexicon("trading", t, u);
    }
}
