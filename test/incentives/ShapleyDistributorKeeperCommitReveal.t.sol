// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/incentives/ShapleyDistributor.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Local mock — ShapleyDistributor.t.sol declares a contract-private MockToken,
///      so we redefine here to keep this file self-contained and avoid cross-file
///      coupling on test fixtures.
contract C42MockToken is ERC20 {
    constructor() ERC20("C42 Mock", "C42M") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @title ShapleyDistributor — C42 Similarity Keeper Commit-Reveal
/// @notice Tests the M-of-N keeper-attested commit-reveal flow that replaces the
///         C41 owner-only `setNoveltyMultiplier` path. Mirrors the structural
///         shape of CircuitBreaker.t.sol C43 attestor tests.
contract ShapleyDistributorKeeperCommitRevealTest is Test {
    ShapleyDistributor public distributor;
    C42MockToken public token;

    address public owner;
    address public alice;
    address public bob;
    address public charlie;
    address public unauthorized;

    address public keeper1;
    address public keeper2;
    address public keeper3;

    bytes32 public constant GAME_ID = keccak256("c42-test-game");

    // Re-declared events for vm.expectEmit — must mirror contract signatures.
    event NoveltyMultiplierSet(bytes32 indexed gameId, address indexed participant, uint256 multiplierBps);
    event KeeperCertified(address indexed keeper, bool status);
    event KeeperRevealThresholdSet(uint256 threshold);
    event KeeperRevealDelaySet(uint256 delay);
    event NoveltyCommitmentSubmitted(
        bytes32 indexed gameId,
        address indexed participant,
        address indexed keeper,
        bytes32 commitment,
        uint256 round
    );
    event NoveltyCommitmentRevealed(
        bytes32 indexed gameId,
        address indexed participant,
        address indexed keeper,
        uint256 multiplierBps,
        uint256 round,
        uint256 agreementCount
    );
    event NoveltyMultiplierAttested(
        bytes32 indexed gameId,
        address indexed participant,
        uint256 multiplierBps,
        uint256 round,
        uint256 attestorsAgreed
    );
    event OwnerSetterDisabled();

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        charlie = makeAddr("charlie");
        unauthorized = makeAddr("unauthorized");
        keeper1 = makeAddr("keeper-1");
        keeper2 = makeAddr("keeper-2");
        keeper3 = makeAddr("keeper-3");

        token = new C42MockToken();

        ShapleyDistributor impl = new ShapleyDistributor();
        bytes memory initData = abi.encodeWithSelector(
            ShapleyDistributor.initialize.selector,
            owner
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        distributor = ShapleyDistributor(payable(address(proxy)));

        distributor.setAuthorizedCreator(owner, true);

        // Seed a game so reveals have a target. We do NOT computeShapleyValues
        // here — settlement locks the multiplier path, and individual tests need
        // the un-settled state.
        token.mint(address(distributor), 100 ether);
        distributor.createGame(GAME_ID, 100 ether, address(token), _createParticipants());
    }

    function _createParticipants() internal view returns (ShapleyDistributor.Participant[] memory) {
        ShapleyDistributor.Participant[] memory participants = new ShapleyDistributor.Participant[](3);
        participants[0] = ShapleyDistributor.Participant({
            participant: alice,
            directContribution: 100 ether,
            timeInPool: 7 days,
            scarcityScore: 6000,
            stabilityScore: 8000
        });
        participants[1] = ShapleyDistributor.Participant({
            participant: bob,
            directContribution: 50 ether,
            timeInPool: 14 days,
            scarcityScore: 5000,
            stabilityScore: 5000
        });
        participants[2] = ShapleyDistributor.Participant({
            participant: charlie,
            directContribution: 75 ether,
            timeInPool: 3 days,
            scarcityScore: 4000,
            stabilityScore: 9000
        });
        return participants;
    }

    function _certifyKeepers() internal {
        distributor.setCertifiedKeeper(keeper1, true);
        distributor.setCertifiedKeeper(keeper2, true);
        distributor.setCertifiedKeeper(keeper3, true);
    }

    // ============ Initialization defaults ============

    function test_C42_defaults_thresholdOneAndDelaySet() public view {
        assertEq(distributor.keeperRevealThreshold(), 1, "default threshold = 1");
        assertEq(
            distributor.keeperRevealDelay(),
            distributor.DEFAULT_KEEPER_REVEAL_DELAY(),
            "default delay = constant"
        );
        assertFalse(distributor.ownerSetterDisabled(), "owner setter starts ENABLED");
    }

    // ============ Admin: keeper certification + threshold + delay ============

    function test_C42_setCertifiedKeeper_emitsAndStores() public {
        vm.expectEmit(true, false, false, true);
        emit KeeperCertified(keeper1, true);
        distributor.setCertifiedKeeper(keeper1, true);
        assertTrue(distributor.certifiedKeeper(keeper1));

        // Revoke
        vm.expectEmit(true, false, false, true);
        emit KeeperCertified(keeper1, false);
        distributor.setCertifiedKeeper(keeper1, false);
        assertFalse(distributor.certifiedKeeper(keeper1));
    }

    function test_C42_setCertifiedKeeper_zeroAddressReverts() public {
        vm.expectRevert(ShapleyDistributor.ZeroAddress.selector);
        distributor.setCertifiedKeeper(address(0), true);
    }

    function test_C42_setCertifiedKeeper_nonOwnerReverts() public {
        vm.prank(unauthorized);
        vm.expectRevert();
        distributor.setCertifiedKeeper(keeper1, true);
    }

    function test_C42_setKeeperRevealThreshold_zeroReverts() public {
        vm.expectRevert(ShapleyDistributor.KeeperRevealThresholdZero.selector);
        distributor.setKeeperRevealThreshold(0);
    }

    function test_C42_setKeeperRevealThreshold_emits() public {
        vm.expectEmit(false, false, false, true);
        emit KeeperRevealThresholdSet(3);
        distributor.setKeeperRevealThreshold(3);
        assertEq(distributor.keeperRevealThreshold(), 3);
    }

    function test_C42_setKeeperRevealDelay_emits() public {
        vm.expectEmit(false, false, false, true);
        emit KeeperRevealDelaySet(2 hours);
        distributor.setKeeperRevealDelay(2 hours);
        assertEq(distributor.keeperRevealDelay(), 2 hours);
    }

    // ============ Owner setter disable (one-way graduation) ============

    function test_C42_disableOwnerSetter_blocksLegacyPath() public {
        // Pre-disable: setNoveltyMultiplier works (C41 baseline preserved).
        distributor.setNoveltyMultiplier(GAME_ID, alice, 15000);
        assertEq(distributor.getNoveltyMultiplier(GAME_ID, alice), 15000);

        // Disable the legacy path — one-way.
        vm.expectEmit(false, false, false, false);
        emit OwnerSetterDisabled();
        distributor.disableOwnerSetter();
        assertTrue(distributor.ownerSetterDisabled());

        // Subsequent owner sets revert.
        vm.expectRevert(ShapleyDistributor.OwnerSetterIsDisabled.selector);
        distributor.setNoveltyMultiplier(GAME_ID, bob, 15000);
    }

    function test_C42_disableOwnerSetter_idempotentReverts() public {
        distributor.disableOwnerSetter();
        vm.expectRevert(ShapleyDistributor.OwnerSetterAlreadyDisabled.selector);
        distributor.disableOwnerSetter();
    }

    // ============ Commit phase ============

    function test_C42_commit_nonCertifiedKeeperReverts() public {
        bytes32 commit = keccak256("anything");
        vm.prank(unauthorized);
        vm.expectRevert(ShapleyDistributor.NotCertifiedKeeper.selector);
        distributor.commitNoveltyMultiplier(GAME_ID, alice, commit);
    }

    function test_C42_commit_emitsAndStores() public {
        _certifyKeepers();
        bytes32 salt = keccak256("salt-1");
        bytes32 commit = distributor.computeNoveltyCommitment(GAME_ID, alice, 15000, salt, 0);

        vm.expectEmit(true, true, true, true);
        emit NoveltyCommitmentSubmitted(GAME_ID, alice, keeper1, commit, 0);
        vm.prank(keeper1);
        distributor.commitNoveltyMultiplier(GAME_ID, alice, commit);

        assertEq(distributor.keeperCommitment(GAME_ID, alice, keeper1), commit);
        assertEq(distributor.keeperCommitTime(GAME_ID, alice, keeper1), block.timestamp);
    }

    function test_C42_commit_doubleCommitInRoundReverts() public {
        _certifyKeepers();
        bytes32 commit = distributor.computeNoveltyCommitment(GAME_ID, alice, 15000, keccak256("s"), 0);
        vm.prank(keeper1);
        distributor.commitNoveltyMultiplier(GAME_ID, alice, commit);

        vm.prank(keeper1);
        vm.expectRevert(ShapleyDistributor.CommitmentAlreadyExists.selector);
        distributor.commitNoveltyMultiplier(GAME_ID, alice, commit);
    }

    function test_C42_commit_settledGameReverts() public {
        _certifyKeepers();
        distributor.computeShapleyValues(GAME_ID); // settles
        bytes32 commit = distributor.computeNoveltyCommitment(GAME_ID, alice, 15000, keccak256("s"), 0);
        vm.prank(keeper1);
        vm.expectRevert(bytes("Game already settled"));
        distributor.commitNoveltyMultiplier(GAME_ID, alice, commit);
    }

    // ============ Reveal phase — happy path ============

    function test_C42_reveal_singleKeeperThreshold1_appliesAndBumpsRound() public {
        _certifyKeepers();
        // threshold defaults to 1 — single keeper agreement is sufficient.
        bytes32 salt = keccak256("salt-single");
        uint256 mult = 15000;
        bytes32 commit = distributor.computeNoveltyCommitment(GAME_ID, alice, mult, salt, 0);

        vm.prank(keeper1);
        distributor.commitNoveltyMultiplier(GAME_ID, alice, commit);

        vm.warp(block.timestamp + distributor.DEFAULT_KEEPER_REVEAL_DELAY() + 1);

        // The reveal should emit Revealed + NoveltyMultiplierSet + Attested.
        vm.expectEmit(true, true, true, true);
        emit NoveltyCommitmentRevealed(GAME_ID, alice, keeper1, mult, 0, 1);
        vm.expectEmit(true, true, false, true);
        emit NoveltyMultiplierSet(GAME_ID, alice, mult);
        vm.expectEmit(true, true, false, true);
        emit NoveltyMultiplierAttested(GAME_ID, alice, mult, 0, 1);

        vm.prank(keeper1);
        distributor.revealNoveltyMultiplier(GAME_ID, alice, mult, salt);

        assertEq(distributor.getNoveltyMultiplier(GAME_ID, alice), mult);
        assertEq(distributor.getRevealRound(GAME_ID, alice), 1, "round bumps after application");
        // Commitment cleared
        assertEq(distributor.keeperCommitment(GAME_ID, alice, keeper1), bytes32(0));
    }

    function test_C42_reveal_MofN_reachesThresholdOnAgreement() public {
        _certifyKeepers();
        distributor.setKeeperRevealThreshold(2);

        uint256 mult = 20000;
        bytes32 salt1 = keccak256("salt-k1");
        bytes32 salt2 = keccak256("salt-k2");
        bytes32 c1 = distributor.computeNoveltyCommitment(GAME_ID, bob, mult, salt1, 0);
        bytes32 c2 = distributor.computeNoveltyCommitment(GAME_ID, bob, mult, salt2, 0);

        vm.prank(keeper1);
        distributor.commitNoveltyMultiplier(GAME_ID, bob, c1);
        vm.prank(keeper2);
        distributor.commitNoveltyMultiplier(GAME_ID, bob, c2);

        vm.warp(block.timestamp + distributor.DEFAULT_KEEPER_REVEAL_DELAY() + 1);

        // First reveal: count -> 1, no application yet (threshold=2).
        vm.prank(keeper1);
        distributor.revealNoveltyMultiplier(GAME_ID, bob, mult, salt1);
        assertEq(distributor.getNoveltyMultiplier(GAME_ID, bob), 10000, "default before threshold");
        assertEq(distributor.getRevealRound(GAME_ID, bob), 0);
        assertEq(distributor.getRevealCountForValue(GAME_ID, bob, 0, mult), 1);

        // Second matching reveal: count -> 2 == threshold, applies.
        vm.prank(keeper2);
        distributor.revealNoveltyMultiplier(GAME_ID, bob, mult, salt2);
        assertEq(distributor.getNoveltyMultiplier(GAME_ID, bob), mult);
        assertEq(distributor.getRevealRound(GAME_ID, bob), 1, "round bumps");
    }

    function test_C42_reveal_MofN_disagreementDoesNotApply() public {
        _certifyKeepers();
        distributor.setKeeperRevealThreshold(2);

        // Two keepers commit to DIFFERENT values — neither should reach threshold.
        bytes32 salt1 = keccak256("salt-disagree-1");
        bytes32 salt2 = keccak256("salt-disagree-2");
        bytes32 c1 = distributor.computeNoveltyCommitment(GAME_ID, charlie, 15000, salt1, 0);
        bytes32 c2 = distributor.computeNoveltyCommitment(GAME_ID, charlie, 25000, salt2, 0);

        vm.prank(keeper1);
        distributor.commitNoveltyMultiplier(GAME_ID, charlie, c1);
        vm.prank(keeper2);
        distributor.commitNoveltyMultiplier(GAME_ID, charlie, c2);

        vm.warp(block.timestamp + distributor.DEFAULT_KEEPER_REVEAL_DELAY() + 1);

        vm.prank(keeper1);
        distributor.revealNoveltyMultiplier(GAME_ID, charlie, 15000, salt1);
        vm.prank(keeper2);
        distributor.revealNoveltyMultiplier(GAME_ID, charlie, 25000, salt2);

        // Neither value crossed threshold (each has count=1 < 2).
        assertEq(distributor.getNoveltyMultiplier(GAME_ID, charlie), 10000, "default - no agreement");
        assertEq(distributor.getRevealRound(GAME_ID, charlie), 0, "round did not bump");
        assertEq(distributor.getRevealCountForValue(GAME_ID, charlie, 0, 15000), 1);
        assertEq(distributor.getRevealCountForValue(GAME_ID, charlie, 0, 25000), 1);
    }

    function test_C42_reveal_3of3agreementApplies() public {
        _certifyKeepers();
        distributor.setKeeperRevealThreshold(3);

        uint256 mult = 25000;
        bytes32[] memory salts = new bytes32[](3);
        salts[0] = keccak256("s1");
        salts[1] = keccak256("s2");
        salts[2] = keccak256("s3");
        address[] memory ks = new address[](3);
        ks[0] = keeper1;
        ks[1] = keeper2;
        ks[2] = keeper3;

        for (uint256 i = 0; i < 3; i++) {
            bytes32 c = distributor.computeNoveltyCommitment(GAME_ID, alice, mult, salts[i], 0);
            vm.prank(ks[i]);
            distributor.commitNoveltyMultiplier(GAME_ID, alice, c);
        }

        vm.warp(block.timestamp + distributor.DEFAULT_KEEPER_REVEAL_DELAY() + 1);

        for (uint256 i = 0; i < 3; i++) {
            vm.prank(ks[i]);
            distributor.revealNoveltyMultiplier(GAME_ID, alice, mult, salts[i]);
        }

        assertEq(distributor.getNoveltyMultiplier(GAME_ID, alice), mult);
        assertEq(distributor.getRevealRound(GAME_ID, alice), 1);
    }

    // ============ Reveal phase — failure modes ============

    function test_C42_reveal_nonCertifiedKeeperReverts() public {
        // No certification — direct reveal must reject.
        vm.prank(unauthorized);
        vm.expectRevert(ShapleyDistributor.NotCertifiedKeeper.selector);
        distributor.revealNoveltyMultiplier(GAME_ID, alice, 15000, keccak256("s"));
    }

    function test_C42_reveal_noActiveCommitmentReverts() public {
        _certifyKeepers();
        vm.prank(keeper1);
        vm.expectRevert(ShapleyDistributor.NoActiveCommitment.selector);
        distributor.revealNoveltyMultiplier(GAME_ID, alice, 15000, keccak256("s"));
    }

    function test_C42_reveal_tooEarlyReverts() public {
        _certifyKeepers();
        bytes32 salt = keccak256("s-early");
        bytes32 commit = distributor.computeNoveltyCommitment(GAME_ID, alice, 15000, salt, 0);
        vm.prank(keeper1);
        distributor.commitNoveltyMultiplier(GAME_ID, alice, commit);

        // Reveal in the same block (no warp) — must revert.
        vm.prank(keeper1);
        vm.expectRevert(ShapleyDistributor.RevealTooEarly.selector);
        distributor.revealNoveltyMultiplier(GAME_ID, alice, 15000, salt);

        // Warp partial delay — still reverts.
        vm.warp(block.timestamp + distributor.DEFAULT_KEEPER_REVEAL_DELAY() - 1);
        vm.prank(keeper1);
        vm.expectRevert(ShapleyDistributor.RevealTooEarly.selector);
        distributor.revealNoveltyMultiplier(GAME_ID, alice, 15000, salt);
    }

    function test_C42_reveal_commitmentMismatchReverts() public {
        _certifyKeepers();
        bytes32 commit = distributor.computeNoveltyCommitment(GAME_ID, alice, 15000, keccak256("right-salt"), 0);
        vm.prank(keeper1);
        distributor.commitNoveltyMultiplier(GAME_ID, alice, commit);

        vm.warp(block.timestamp + distributor.DEFAULT_KEEPER_REVEAL_DELAY() + 1);

        // Reveal with the wrong salt.
        vm.prank(keeper1);
        vm.expectRevert(ShapleyDistributor.CommitmentMismatch.selector);
        distributor.revealNoveltyMultiplier(GAME_ID, alice, 15000, keccak256("wrong-salt"));

        // Reveal with the wrong multiplier.
        vm.prank(keeper1);
        vm.expectRevert(ShapleyDistributor.CommitmentMismatch.selector);
        distributor.revealNoveltyMultiplier(GAME_ID, alice, 20000, keccak256("right-salt"));
    }

    function test_C42_reveal_outOfRangeReverts() public {
        _certifyKeepers();
        bytes32 salt = keccak256("s-oor");
        // Build a valid commitment but reveal will fail bounds check before hash check.
        bytes32 commit = distributor.computeNoveltyCommitment(GAME_ID, alice, 4999, salt, 0);
        vm.prank(keeper1);
        distributor.commitNoveltyMultiplier(GAME_ID, alice, commit);
        vm.warp(block.timestamp + distributor.DEFAULT_KEEPER_REVEAL_DELAY() + 1);

        vm.prank(keeper1);
        vm.expectRevert(bytes("Multiplier out of range"));
        distributor.revealNoveltyMultiplier(GAME_ID, alice, 4999, salt);
    }

    function test_C42_reveal_settledGameReverts() public {
        _certifyKeepers();
        bytes32 salt = keccak256("s-settled");
        bytes32 commit = distributor.computeNoveltyCommitment(GAME_ID, alice, 15000, salt, 0);
        vm.prank(keeper1);
        distributor.commitNoveltyMultiplier(GAME_ID, alice, commit);

        vm.warp(block.timestamp + distributor.DEFAULT_KEEPER_REVEAL_DELAY() + 1);
        // Settle the game between commit and reveal.
        distributor.computeShapleyValues(GAME_ID);

        vm.prank(keeper1);
        vm.expectRevert(bytes("Game already settled"));
        distributor.revealNoveltyMultiplier(GAME_ID, alice, 15000, salt);
    }

    // ============ Round isolation ============

    function test_C42_round_staleRoundCommitmentRejectedAfterApplication() public {
        // Keeper commits in round 0 with a salt + value, but does not reveal in
        // time. Another set of keepers applies a multiplier (round bumps to 1).
        // Now the stale keeper tries to reveal — `currentRound` is 1 so the
        // commitment hash (built against round 0) MUST NOT match.
        _certifyKeepers();
        distributor.setKeeperRevealThreshold(1);

        // First, keeper3 makes a stale commitment for round 0 (mult=12000).
        bytes32 staleSalt = keccak256("stale-salt");
        bytes32 staleCommit = distributor.computeNoveltyCommitment(GAME_ID, alice, 12000, staleSalt, 0);
        vm.prank(keeper3);
        distributor.commitNoveltyMultiplier(GAME_ID, alice, staleCommit);

        // Meanwhile, keeper1 commits + reveals a different value, applies it.
        bytes32 winnerSalt = keccak256("winner-salt");
        bytes32 winnerCommit = distributor.computeNoveltyCommitment(GAME_ID, alice, 18000, winnerSalt, 0);
        vm.prank(keeper1);
        distributor.commitNoveltyMultiplier(GAME_ID, alice, winnerCommit);

        vm.warp(block.timestamp + distributor.DEFAULT_KEEPER_REVEAL_DELAY() + 1);

        vm.prank(keeper1);
        distributor.revealNoveltyMultiplier(GAME_ID, alice, 18000, winnerSalt);
        assertEq(distributor.getRevealRound(GAME_ID, alice), 1, "winner bumped round");
        assertEq(distributor.getNoveltyMultiplier(GAME_ID, alice), 18000);

        // keeper3's stale reveal: commitment was built for round 0, currentRound is 1.
        // Commitment hash will be recomputed against round 1 and will not match.
        vm.prank(keeper3);
        vm.expectRevert(ShapleyDistributor.CommitmentMismatch.selector);
        distributor.revealNoveltyMultiplier(GAME_ID, alice, 12000, staleSalt);
    }

    function test_C42_round_recommitAfterApplicationSucceeds() public {
        _certifyKeepers();
        distributor.setKeeperRevealThreshold(1);

        // Round 0: keeper1 commits + reveals.
        bytes32 salt0 = keccak256("salt-r0");
        bytes32 c0 = distributor.computeNoveltyCommitment(GAME_ID, alice, 15000, salt0, 0);
        vm.prank(keeper1);
        distributor.commitNoveltyMultiplier(GAME_ID, alice, c0);
        vm.warp(block.timestamp + distributor.DEFAULT_KEEPER_REVEAL_DELAY() + 1);
        vm.prank(keeper1);
        distributor.revealNoveltyMultiplier(GAME_ID, alice, 15000, salt0);
        assertEq(distributor.getRevealRound(GAME_ID, alice), 1);

        // Round 1: keeper1's prior commitment was deleted on reveal — they can re-commit.
        bytes32 salt1 = keccak256("salt-r1");
        bytes32 c1 = distributor.computeNoveltyCommitment(GAME_ID, alice, 22000, salt1, 1);
        vm.prank(keeper1);
        distributor.commitNoveltyMultiplier(GAME_ID, alice, c1);
        vm.warp(block.timestamp + distributor.DEFAULT_KEEPER_REVEAL_DELAY() + 1);
        vm.prank(keeper1);
        distributor.revealNoveltyMultiplier(GAME_ID, alice, 22000, salt1);

        assertEq(distributor.getNoveltyMultiplier(GAME_ID, alice), 22000);
        assertEq(distributor.getRevealRound(GAME_ID, alice), 2);
    }

    // ============ Integration — keeper-attested multiplier flows through Shapley ============

    function test_C42_integration_keeperRevealedMultiplierShiftsRewards() public {
        _certifyKeepers();
        distributor.setKeeperRevealThreshold(2);

        // Pin alice to 2.0x and charlie to 0.5x via keeper consensus.
        _agreeOnMultiplier(GAME_ID, alice, 20000, keeper1, keeper2);
        _agreeOnMultiplier(GAME_ID, charlie, 5000, keeper1, keeper2);

        distributor.computeShapleyValues(GAME_ID);

        // Alice should outweigh her contribution baseline; charlie's share dampened.
        // We test the structural property — efficiency and ordering — without
        // over-specifying numerical values (already covered by C41 baseline tests).
        uint256 aliceShare = distributor.shapleyValues(GAME_ID, alice);
        uint256 bobShare = distributor.shapleyValues(GAME_ID, bob);
        uint256 charlieShare = distributor.shapleyValues(GAME_ID, charlie);

        assertEq(aliceShare + bobShare + charlieShare, 100 ether, "efficiency preserved");
        assertGt(aliceShare, charlieShare, "alice (2.0x) > charlie (0.5x) under keeper-attested mults");
    }

    /// @dev Two-of-two agreement helper: two keepers each commit + reveal the
    ///      same multiplier value, applying it via the M-of-N path.
    function _agreeOnMultiplier(
        bytes32 gameId,
        address participant,
        uint256 mult,
        address k1,
        address k2
    ) internal {
        bytes32 saltA = keccak256(abi.encode("salt-a", participant, mult));
        bytes32 saltB = keccak256(abi.encode("salt-b", participant, mult));
        uint256 round = distributor.getRevealRound(gameId, participant);

        bytes32 commitA = distributor.computeNoveltyCommitment(gameId, participant, mult, saltA, round);
        bytes32 commitB = distributor.computeNoveltyCommitment(gameId, participant, mult, saltB, round);

        vm.prank(k1);
        distributor.commitNoveltyMultiplier(gameId, participant, commitA);
        vm.prank(k2);
        distributor.commitNoveltyMultiplier(gameId, participant, commitB);

        vm.warp(block.timestamp + distributor.DEFAULT_KEEPER_REVEAL_DELAY() + 1);

        vm.prank(k1);
        distributor.revealNoveltyMultiplier(gameId, participant, mult, saltA);
        vm.prank(k2);
        distributor.revealNoveltyMultiplier(gameId, participant, mult, saltB);
    }
}
