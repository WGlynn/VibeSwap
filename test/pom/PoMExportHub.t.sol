// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {PoMOperatorRegistry} from "../../contracts/pom/PoMOperatorRegistry.sol";
import {PoMReward} from "../../contracts/pom/PoMReward.sol";
import {PoMExportHub} from "../../contracts/pom/PoMExportHub.sol";
import {IPoMExportHub} from "../../contracts/pom/interfaces/IPoMExportHub.sol";
import {IPoMOperatorRegistry} from "../../contracts/pom/interfaces/IPoMOperatorRegistry.sol";

contract MockBond is ERC20 {
    constructor() ERC20("Bond", "BOND") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/**
 * @title PoMExportHub end-to-end (MindCoin meta-block subsidy)
 * @notice A bonded operator PROPOSES a PoM standing; it FINALIZES optimistically, emitting a
 *         Bitcoin-form meta-block subsidy split 91/6/3; contributors CLAIM their delta-priced
 *         share by Merkle proof. Plus the adversarial paths (challenge-freeze, dispute slashing,
 *         budget-drawn challenger bounty) and the guards (theta-pinning, delta-guard, cap).
 */
contract PoMExportHubTest is Test {
    MockBond bond;
    PoMReward reward;
    PoMOperatorRegistry registry;
    PoMExportHub hub;

    address owner = makeAddr("owner");
    address resolver = makeAddr("resolver");
    address proposer = makeAddr("proposer");
    address challenger = makeAddr("challenger");
    address rando = makeAddr("rando");
    address payToA = makeAddr("payToA");
    address payToB = makeAddr("payToB");

    uint64  constant WINDOW = 1 hours;
    uint64  constant RESOLUTION_WINDOW = 1 days;
    uint96  constant CHALLENGER_REWARD = 50e18;   // per-dispute draw size (bounded by budget)
    uint96  constant SLASH_AMOUNT = 0.5 ether;
    uint96  constant BOND = 1 ether;              // == DEFAULT_BOND_FLOOR

    // Subsidy at meta-block 0 and its 91/6/3 split (mirrors the hub constants).
    uint256 constant SUBSIDY_0 = 3.125e18;
    uint256 constant PROPOSER_CUT_0 = SUBSIDY_0 * 600 / 10_000;   // 6%
    uint256 constant TRANCHE_0 = SUBSIDY_0 * 300 / 10_000;        // 3%
    uint256 constant POOL_0 = SUBSIDY_0 - PROPOSER_CUT_0 - TRANCHE_0; // 91%

    // --- shared scores Merkle vector (cross-language pinned) ---
    bytes32 contribA = keccak256("alice");
    bytes32 contribB = keccak256("bob");
    uint256 constant VAL_A = 1000;
    uint256 constant VAL_B = 500;
    bytes32 root;
    bytes32[] proofA;

    // --- per-block payout Merkle vector (contributor claim) ---
    uint256 constant PAY_A = 1e18;
    uint256 constant PAY_B = 1e18; // PAY_A + PAY_B < POOL_0 (solvent)
    bytes32 payoutRoot;
    bytes32[] payoutProofA;

    function setUp() public {
        bond = new MockBond();
        reward = new PoMReward(owner);

        PoMOperatorRegistry regImpl = new PoMOperatorRegistry();
        registry = PoMOperatorRegistry(address(new ERC1967Proxy(
            address(regImpl),
            abi.encodeCall(PoMOperatorRegistry.initialize, (address(bond), owner))
        )));

        PoMExportHub hubImpl = new PoMExportHub();
        hub = PoMExportHub(address(new ERC1967Proxy(
            address(hubImpl),
            abi.encodeCall(PoMExportHub.initialize, (
                address(registry),
                address(reward),
                resolver,
                owner,
                WINDOW,
                RESOLUTION_WINDOW,
                CHALLENGER_REWARD,
                SLASH_AMOUNT
            ))
        )));

        vm.startPrank(owner);
        registry.setSlasher(address(hub));
        reward.setMinter(address(hub));
        vm.stopPrank();

        _registerOperator(proposer);
        _registerOperator(challenger);
        vm.warp(block.timestamp + registry.activationDelay() + 1);

        // Scores root (lifetime cumulative) + a per-block payout root (delta payouts).
        root = _hashPair(_leaf(contribA, VAL_A), _leaf(contribB, VAL_B));
        proofA.push(_leaf(contribB, VAL_B));

        payoutRoot = _hashPair(_payLeaf(contribA, payToA, PAY_A), _payLeaf(contribB, payToB, PAY_B));
        payoutProofA.push(_payLeaf(contribB, payToB, PAY_B));
    }

    function _registerOperator(address who) internal {
        bond.mint(who, BOND);
        vm.startPrank(who);
        bond.approve(address(registry), type(uint256).max);
        registry.register(who, BOND);
        vm.stopPrank();
    }

    function _standing(uint256 nonce) internal view returns (IPoMExportHub.PomStanding memory) {
        return IPoMExportHub.PomStanding({
            nonce: nonce,
            noesisHeight: uint64(nonce + 1),          // strictly advancing canonical prefix
            thetaSimQ16: 62259,
            thetaEntQ16: 62259,
            total: VAL_A + VAL_B + nonce * 1000,      // strictly increasing (delta guard)
            scoresRoot: root,
            payoutRoot: payoutRoot,
            inputCommitment: keccak256("canonical-inputs")
        });
    }

    function _leaf(bytes32 c, uint256 v) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(c, v))));
    }

    function _payLeaf(bytes32 c, address payTo, uint256 amt) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(c, payTo, amt))));
    }

    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    function _finalizeBlock(uint256 nonce) internal returns (uint256 id) {
        vm.prank(proposer);
        id = hub.propose(_standing(nonce));
        vm.warp(block.timestamp + WINDOW + 1);
        hub.finalize(id);
    }

    // =========================================================================
    // Happy path: propose -> finalize -> subsidy split -> consume
    // =========================================================================

    function test_HappyPath_ProposeFinalizeConsume() public {
        vm.prank(proposer);
        uint256 id = hub.propose(_standing(0));
        assertEq(id, 1);
        assertEq(hub.pendingProposalId(), 1);

        vm.expectRevert(abi.encodeWithSelector(IPoMExportHub.ChallengeWindowOpen.selector, id));
        hub.finalize(id);

        vm.warp(block.timestamp + WINDOW + 1);
        hub.finalize(id);

        IPoMExportHub.PomStanding memory s = hub.currentStanding();
        assertEq(s.total, VAL_A + VAL_B, "standing total consumed");
        assertEq(s.scoresRoot, root, "scores root consumed");
        assertEq(hub.nextNonce(), 1, "nonce advanced");
        assertEq(hub.pendingProposalId(), 0, "no longer pending");

        // Subsidy split at finalize: proposer gets the 6% cut; the 91% pool + 3% tranche accrue.
        assertEq(reward.balanceOf(registry.payoutOf(proposer)), PROPOSER_CUT_0, "proposer cut = 6%");
        assertEq(hub.blockPool(0), POOL_0, "contributor pool = 91%");
        assertEq(hub.securityBudget(), TRANCHE_0, "security tranche = 3%");
        assertEq(hub.emissionCommitted(), SUBSIDY_0, "full subsidy committed");

        // The value-router consumer reads a contributor's score via Merkle proof.
        assertTrue(hub.verifyContributionScore(contribA, VAL_A, proofA), "honest score verifies");
        assertFalse(hub.verifyContributionScore(contribA, VAL_A + 1, proofA), "tampered value rejected");
    }

    // =========================================================================
    // Contributor claim: delta-priced pool routed by Merkle proof
    // =========================================================================

    function test_ClaimContributorReward() public {
        _finalizeBlock(0);

        // Permissionless: anyone submits, funds route to the in-leaf payTo.
        vm.prank(rando);
        hub.claimContributorReward(0, contribA, payToA, PAY_A, payoutProofA);

        assertEq(reward.balanceOf(payToA), PAY_A, "contributor paid to committed payTo");
        assertEq(hub.blockClaimed(0), PAY_A, "block claim accounted");

        // Replay is rejected.
        vm.expectRevert(abi.encodeWithSelector(IPoMExportHub.AlreadyClaimed.selector, uint256(0), contribA));
        hub.claimContributorReward(0, contribA, payToA, PAY_A, payoutProofA);
    }

    function test_Claim_RejectsBadProof() public {
        _finalizeBlock(0);
        // Wrong amount => leaf not in the tree.
        vm.expectRevert(IPoMExportHub.InvalidClaimProof.selector);
        hub.claimContributorReward(0, contribA, payToA, PAY_A + 1, payoutProofA);
    }

    function test_Claim_RejectsUnknownNonce() public {
        vm.expectRevert(abi.encodeWithSelector(IPoMExportHub.UnknownPayoutRoot.selector, uint256(7)));
        hub.claimContributorReward(7, contribA, payToA, PAY_A, payoutProofA);
    }

    // =========================================================================
    // Schedule + split
    // =========================================================================

    function test_MetaBlockSubsidy_Schedule() public view {
        uint256 h = hub.HALVING_INTERVAL();
        assertEq(hub.metaBlockSubsidy(0), SUBSIDY_0, "epoch 0 = 3.125");
        assertEq(hub.metaBlockSubsidy(h - 1), SUBSIDY_0, "still epoch 0 at the boundary");
        assertEq(hub.metaBlockSubsidy(h), SUBSIDY_0 / 2, "first halving");
        assertEq(hub.metaBlockSubsidy(61 * h), 1, "epoch 61 = 1 wei");
        assertEq(hub.metaBlockSubsidy(62 * h), 0, "epoch 62 = 0");
        assertEq(hub.metaBlockSubsidy(64 * h), 0, "epoch>=64 guard = 0");
    }

    function test_DeltaGuard_RejectsNoNewInformation() public {
        _finalizeBlock(0); // current.total == 1500
        IPoMExportHub.PomStanding memory stale = _standing(1);
        stale.total = VAL_A + VAL_B; // == current.total, not strictly greater
        vm.prank(proposer);
        vm.expectRevert(abi.encodeWithSelector(
            IPoMExportHub.NoNewInformation.selector, VAL_A + VAL_B, VAL_A + VAL_B
        ));
        hub.propose(stale);
    }

    function test_ThetaMismatch_Rejected() public {
        IPoMExportHub.PomStanding memory bad = _standing(0);
        bad.thetaEntQ16 = 0; // must equal the canonical entropy floor
        vm.prank(proposer);
        vm.expectRevert(IPoMExportHub.ThetaMismatch.selector);
        hub.propose(bad);
    }

    // ============ Anti selective-inclusion: canonical-prefix must strictly advance ============

    function test_PrefixNotAdvancing_Rejected() public {
        _finalizeBlock(0); // current.noesisHeight == 1
        IPoMExportHub.PomStanding memory stale = _standing(1);
        stale.noesisHeight = 1; // == current: does NOT advance the covered Noesis prefix
        vm.prank(proposer);
        vm.expectRevert(abi.encodeWithSelector(IPoMExportHub.PrefixNotAdvancing.selector, uint64(1), uint64(1)));
        hub.propose(stale);
    }

    function test_TipHashMissing_Rejected() public {
        IPoMExportHub.PomStanding memory bad = _standing(0);
        bad.inputCommitment = bytes32(0); // no tip => "which prefix" undefined => cannot challenge omission
        vm.prank(proposer);
        vm.expectRevert(IPoMExportHub.TipHashMissing.selector);
        hub.propose(bad);
    }

    // =========================================================================
    // Safety + dispute resolution
    // =========================================================================

    function test_Challenge_FreezesStanding() public {
        vm.prank(proposer);
        uint256 id = hub.propose(_standing(0));
        vm.prank(challenger);
        hub.challenge(id);

        assertEq(uint256(hub.getProposal(id).status), uint256(IPoMExportHub.ProposalStatus.Challenged));

        vm.warp(block.timestamp + WINDOW + 1);
        vm.expectRevert(abi.encodeWithSelector(IPoMExportHub.NotPending.selector, id));
        hub.finalize(id);

        assertEq(hub.currentStanding().total, 0, "no standing consumed under challenge");
    }

    function test_Resolve_ProposerWins_SlashesChallenger() public {
        vm.prank(proposer);
        uint256 id = hub.propose(_standing(0));
        vm.prank(challenger);
        hub.challenge(id);

        vm.prank(resolver);
        hub.resolveDispute(id, true);

        assertEq(registry.bondOf(challenger), BOND - SLASH_AMOUNT, "frivolous challenger slashed");
        // Frivolous-challenger slash routes the WHOLE amount to the governance pool (no slice out).
        assertEq(registry.slashedPool(), SLASH_AMOUNT, "frivolous slash fully pooled, no beneficiary");
        assertEq(uint256(hub.getProposal(id).status), uint256(IPoMExportHub.ProposalStatus.Rejected));
        assertEq(hub.currentStanding().total, 0, "resolver cannot push a challenged standing live");
        assertEq(hub.nextNonce(), 0, "nonce slot reopened");

        // The vindicated proposer re-proposes and finalizes; NOW the subsidy pays.
        _finalizeBlock(0);
        assertEq(hub.currentStanding().total, VAL_A + VAL_B, "re-proposed standing goes live");
        assertEq(reward.balanceOf(registry.payoutOf(proposer)), PROPOSER_CUT_0);
    }

    function test_Resolve_ChallengerWins_GenesisBudgetEmpty() public {
        // No block has finalized, so the MIND security budget is empty. The challenger's MIND
        // bounty is 0 at genesis — but they are NO LONGER empty-handed: a slice of the liar's
        // slashed BOND is routed to them immediately (item-3 genesis fix), plus the freeze.
        vm.prank(proposer);
        uint256 id = hub.propose(_standing(0));
        vm.prank(challenger);
        hub.challenge(id);

        vm.prank(resolver);
        hub.resolveDispute(id, false);

        assertEq(registry.bondOf(proposer), BOND - SLASH_AMOUNT, "proposer bond slashed");
        assertEq(hub.currentStanding().total, 0, "false standing discarded");
        assertEq(reward.balanceOf(challenger), 0, "genesis: empty budget => 0 MIND bounty");

        // The genesis fix: a 50% slice of the slashed bond pays the challenger in the BOND token.
        uint96 expectedSlice = uint96(uint256(SLASH_AMOUNT) * 5000 / 10_000);
        assertEq(bond.balanceOf(registry.payoutOf(challenger)), expectedSlice, "challenger gets bond slice at genesis");
        assertEq(registry.slashedPool(), SLASH_AMOUNT - expectedSlice, "remainder to governance pool");
    }

    function test_Resolve_ChallengerWins_PaidFromBudget() public {
        _finalizeBlock(0); // accrues the 3% tranche
        assertEq(hub.securityBudget(), TRANCHE_0);

        vm.prank(proposer);
        uint256 id = hub.propose(_standing(1));
        vm.prank(challenger);
        hub.challenge(id);
        vm.prank(resolver);
        hub.resolveDispute(id, false);

        // Draw = min(CHALLENGER_REWARD, tranche) = tranche (tranche < 50e18).
        assertEq(reward.balanceOf(registry.payoutOf(challenger)), TRANCHE_0, "challenger paid from budget");
        assertEq(hub.securityBudget(), 0, "budget drawn down");
    }

    // =========================================================================
    // Genesis challenger slash-slice (item 3): registry primitive + bounds
    // =========================================================================

    function test_SlashToBeneficiary_SplitsAndBounds() public {
        // Point the slasher at this test contract to exercise the registry primitive directly.
        vm.prank(owner);
        registry.setSlasher(address(this));

        // bps > 100% rejected.
        vm.expectRevert(abi.encodeWithSelector(IPoMOperatorRegistry.BeneficiaryBpsTooHigh.selector, uint16(10_001)));
        registry.slashToBeneficiary(proposer, keccak256("X"), SLASH_AMOUNT, payToA, 10_001);

        // 40% slice to payToA, 60% to the governance pool.
        (uint96 slashed, uint96 toBen) =
            registry.slashToBeneficiary(proposer, keccak256("X"), SLASH_AMOUNT, payToA, 4000);
        assertEq(slashed, SLASH_AMOUNT, "full slash amount");
        assertEq(toBen, uint96(uint256(SLASH_AMOUNT) * 4000 / 10_000), "40% slice computed");
        assertEq(bond.balanceOf(payToA), toBen, "beneficiary paid the slice");
        assertEq(registry.slashedPool(), SLASH_AMOUNT - toBen, "remainder pooled");

        // beneficiary == 0 folds the slice back into the pool (nothing stranded).
        uint96 poolBefore = registry.slashedPool();
        (, uint96 toBen2) =
            registry.slashToBeneficiary(challenger, keccak256("Y"), 0.1 ether, address(0), 5000);
        assertEq(toBen2, 0, "no beneficiary => no slice");
        assertEq(registry.slashedPool(), poolBefore + 0.1 ether, "whole amount folded to pool");
    }

    function test_SetChallengerSlashSliceBps_RejectsAbove100() public {
        vm.prank(owner);
        vm.expectRevert(bytes("bps>100%"));
        hub.setChallengerSlashSliceBps(10_001);
    }

    function test_ChallengerSlashSliceBps_LockedAtChallenge() public {
        // The bond-slice rate is snapshotted at challenge() time; a later governance change cannot
        // retroactively alter the bounty of an already-committed challenger (who can no longer exit).
        vm.prank(proposer);
        uint256 id = hub.propose(_standing(0));
        vm.prank(challenger);
        hub.challenge(id); // snapshots 5000 bps

        // Owner zeroes the slice AFTER the challenge is locked in.
        vm.prank(owner);
        hub.setChallengerSlashSliceBps(0);

        vm.prank(resolver);
        hub.resolveDispute(id, false);

        // Challenger still receives the 50% slice snapshotted at challenge, not the new 0%.
        uint96 expectedSlice = uint96(uint256(SLASH_AMOUNT) * 5000 / 10_000);
        assertEq(bond.balanceOf(registry.payoutOf(challenger)), expectedSlice, "slice locked at challenge-time bps");
    }

    // =========================================================================
    // Guards
    // =========================================================================

    function test_WrongNonce_Reverts() public {
        vm.prank(proposer);
        vm.expectRevert(abi.encodeWithSelector(IPoMExportHub.WrongNonce.selector, uint256(1), uint256(0)));
        hub.propose(_standing(1));
    }

    function test_UnbondedCannotPropose() public {
        vm.prank(rando);
        vm.expectRevert(abi.encodeWithSelector(IPoMExportHub.NotBondedOperator.selector, rando));
        hub.propose(_standing(0));
    }

    function test_OnlyResolverCanResolve() public {
        vm.prank(proposer);
        uint256 id = hub.propose(_standing(0));
        vm.prank(challenger);
        hub.challenge(id);

        vm.prank(rando);
        vm.expectRevert(abi.encodeWithSelector(IPoMExportHub.NotResolver.selector, rando));
        hub.resolveDispute(id, true);
    }

    function test_OneStandingInFlight() public {
        vm.prank(proposer);
        hub.propose(_standing(0));

        vm.prank(challenger);
        vm.expectRevert(abi.encodeWithSelector(IPoMExportHub.ProposalPending.selector, uint256(1)));
        hub.propose(_standing(0));
    }

    function test_ProposerCannotChallengeSelf() public {
        vm.prank(proposer);
        uint256 id = hub.propose(_standing(0));

        vm.prank(proposer);
        vm.expectRevert(IPoMExportHub.ProposerCannotChallengeSelf.selector);
        hub.challenge(id);
    }

    function test_CannotChallengeAfterWindow() public {
        vm.prank(proposer);
        uint256 id = hub.propose(_standing(0));
        vm.warp(block.timestamp + WINDOW + 1);

        vm.prank(challenger);
        vm.expectRevert(abi.encodeWithSelector(IPoMExportHub.ChallengeWindowClosed.selector, id));
        hub.challenge(id);
    }

    // =========================================================================
    // Liveness: resolver is not a single point of failure
    // =========================================================================

    function test_ExpireChallenge_ReopensSlotWithoutResolver() public {
        vm.prank(proposer);
        uint256 id = hub.propose(_standing(0));
        vm.prank(challenger);
        hub.challenge(id);

        vm.warp(block.timestamp + RESOLUTION_WINDOW + 1);
        hub.expireChallenge(id);

        assertEq(uint256(hub.getProposal(id).status), uint256(IPoMExportHub.ProposalStatus.Rejected));
        assertEq(hub.pendingProposalId(), 0, "slot reopened without a resolver");
        assertEq(registry.bondOf(proposer), BOND);
        assertEq(registry.bondOf(challenger), BOND);
    }

    function test_ExpireChallenge_RevertsBeforeWindow() public {
        vm.prank(proposer);
        uint256 id = hub.propose(_standing(0));
        vm.prank(challenger);
        hub.challenge(id);

        vm.expectRevert(abi.encodeWithSelector(IPoMExportHub.ResolutionWindowOpen.selector, id));
        hub.expireChallenge(id);
    }

    // =========================================================================
    // Admin bounds + cross-language conformance
    // =========================================================================

    function test_SetChallengeWindow_RejectsBelowFloor() public {
        uint64 minWindow = hub.MIN_CHALLENGE_WINDOW();
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(
            IPoMExportHub.ChallengeWindowTooShort.selector, uint64(0), minWindow
        ));
        hub.setChallengeWindow(0);
    }

    function test_SetResolutionWindow_RejectsTooLong() public {
        uint64 maxWindow = hub.MAX_RESOLUTION_WINDOW();
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(
            IPoMExportHub.ResolutionWindowTooLong.selector, maxWindow + 1, maxWindow
        ));
        hub.setResolutionWindow(maxWindow + 1);
    }

    function test_SetSplit_CannotTouchContributorShare() public {
        vm.prank(owner);
        vm.expectRevert(bytes("split != 9%"));
        hub.setSplit(500, 500); // sums to 10%, would dip into the 91%
    }

    // The Rust pom_export::tests::merkle_conformance_vector pins this exact root over the SAME
    // vector (keccak("alice"),1000)/(keccak("bob"),500). Either side drifting breaks both.
    function test_MerkleRoot_MatchesRustVector() public view {
        assertEq(
            root,
            bytes32(0xdaf99dca546152568a24c92ce244b1cdc50a8d893b491485e740811609d38bc0),
            "Solidity root must equal the pinned Rust pom_export root"
        );
    }

    // Cross-language PAYOUT-tree conformance (item 1): the Rust pom_export::tests::
    // payout_conformance_vector pins this exact delta-priced root over the SAME genesis vector —
    // prev=[], curr=[(alice,1000),(bob,500)], pool = 91% of the 3.125-MIND block-0 subsidy,
    // alice->0xA1 / bob->0xB2 — with amounts floor(pool*delta/1500). Then an end-to-end claim
    // proves the on-chain path consumes a root the Rust producer emits, byte-for-byte.
    function test_PayoutRoot_MatchesRustVector() public {
        address payToVecA = address(uint160(0xA1));
        address payToVecB = address(uint160(0xB2));
        uint256 amtA = 1_895_833_333_333_333_333; // floor(POOL_0 * 1000 / 1500)
        uint256 amtB =   947_916_666_666_666_666; // floor(POOL_0 *  500 / 1500)

        bytes32 leafA = _payLeaf(contribA, payToVecA, amtA);
        bytes32 leafB = _payLeaf(contribB, payToVecB, amtB);
        bytes32 vecRoot = _hashPair(leafA, leafB);

        assertEq(
            vecRoot,
            bytes32(0xc6abf3071c75118de31c207fec9f98a7198f97403165a0b45dd20b99b315536e),
            "Solidity payout root must equal the pinned Rust pom_export payout vector"
        );
        assertLe(amtA + amtB, POOL_0, "vector is solvent against the block-0 pool");

        // End-to-end: finalize a block carrying this exact payout root, then claim alice's share.
        IPoMExportHub.PomStanding memory s = _standing(0);
        s.payoutRoot = vecRoot;
        vm.prank(proposer);
        uint256 id = hub.propose(s);
        vm.warp(block.timestamp + WINDOW + 1);
        hub.finalize(id);

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = leafB; // sibling of alice's leaf
        hub.claimContributorReward(0, contribA, payToVecA, amtA, proof);
        assertEq(reward.balanceOf(payToVecA), amtA, "alice claims her Rust-derived delta share");
    }
}
