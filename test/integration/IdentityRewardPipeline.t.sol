// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/identity/SoulboundIdentity.sol";
import "../../contracts/identity/ContributionDAG.sol";
import "../../contracts/identity/RewardLedger.sol";
import "../../contracts/identity/VibeCode.sol";
import "../../contracts/incentives/ShapleyDistributor.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock Token ============

contract RewardToken is ERC20 {
    constructor() ERC20("Reward", "RWD") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Identity -> Contribution -> Reward Pipeline Integration Test ============

contract IdentityRewardPipelineTest is Test {
    SoulboundIdentity soulbound;
    ContributionDAG dag;
    RewardLedger ledger;
    VibeCode vibeCode;
    ShapleyDistributor shapley;
    RewardToken rewardToken;

    address owner = address(this);
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address charlie = makeAddr("charlie");
    address dave = makeAddr("dave");

    function setUp() public {
        // 1. Deploy reward token
        rewardToken = new RewardToken();

        // 2. Deploy SoulboundIdentity (UUPS proxy)
        SoulboundIdentity soulImpl = new SoulboundIdentity();
        ERC1967Proxy soulProxy = new ERC1967Proxy(
            address(soulImpl),
            abi.encodeCall(SoulboundIdentity.initialize, ())
        );
        soulbound = SoulboundIdentity(address(soulProxy));

        // 3. Deploy ContributionDAG
        dag = new ContributionDAG(address(soulbound));

        // 4. Deploy RewardLedger
        ledger = new RewardLedger(address(rewardToken), address(dag));

        // 5. Deploy VibeCode
        vibeCode = new VibeCode();

        // 6. Deploy ShapleyDistributor (UUPS proxy)
        ShapleyDistributor shapleyImpl = new ShapleyDistributor();
        ERC1967Proxy shapleyProxy = new ERC1967Proxy(
            address(shapleyImpl),
            abi.encodeCall(ShapleyDistributor.initialize, (owner))
        );
        shapley = ShapleyDistributor(payable(address(shapleyProxy)));

        // Wire up authorizations
        soulbound.setAuthorizedRecorder(owner, true);
        ledger.setAuthorizedCaller(owner, true);
        vibeCode.setAuthorizedSource(owner, true);
        shapley.setAuthorizedCreator(owner, true);

        // Add alice as founder
        dag.addFounder(alice);

        // Fund the ledger with reward tokens for claim payouts
        rewardToken.mint(address(ledger), 10_000 ether);

        // Mint identities for all users
        vm.prank(alice);
        soulbound.mintIdentity("alice_dev");
        vm.prank(bob);
        soulbound.mintIdentity("bob_builder");
        vm.prank(charlie);
        soulbound.mintIdentity("charlie_code");
        vm.prank(dave);
        soulbound.mintIdentity("dave_design");
    }

    // ============ E2E: Full pipeline from identity to reward claim ============
    function test_fullPipeline_identityToReward() public {
        // Step 1: Build trust graph (alice -> bob, bob -> alice = handshake)
        vm.prank(alice);
        dag.addVouch(bob, keccak256("alice vouches for bob"));
        vm.warp(block.timestamp + 1 days + 1); // handshake cooldown
        vm.prank(bob);
        dag.addVouch(alice, keccak256("bob vouches for alice"));

        // Bob -> Charlie (not a handshake yet)
        vm.prank(bob);
        dag.addVouch(charlie, keccak256("bob vouches for charlie"));

        // Recalculate trust scores
        dag.recalculateTrustScores();

        // Step 2: Record contributions to VibeCode
        vibeCode.recordContribution(alice, IVibeCode.ContributionCategory.CODE, 100e18, keccak256("commit-abc"));
        vibeCode.recordContribution(bob, IVibeCode.ContributionCategory.REVIEW, 50e18, keccak256("review-def"));
        vibeCode.recordContribution(charlie, IVibeCode.ContributionCategory.IDEA, 30e18, keccak256("idea-ghi"));

        // Refresh vibe codes
        vibeCode.refreshVibeCode(alice);
        vibeCode.refreshVibeCode(bob);
        vibeCode.refreshVibeCode(charlie);

        // Verify vibe codes are set
        assertNotEq(vibeCode.getVibeCode(alice), bytes32(0), "Alice should have vibe code");
        assertNotEq(vibeCode.getVibeCode(bob), bytes32(0), "Bob should have vibe code");
        assertNotEq(vibeCode.getVibeCode(charlie), bytes32(0), "Charlie should have vibe code");

        // Step 3: Record value event with bob as actor
        // distributeEvent uses DAG trust chain (not the one passed here)
        // Bob's DAG chain: [alice, bob] (founder→bob), so both get rewards
        address[] memory trustChain = new address[](2);
        trustChain[0] = alice;
        trustChain[1] = bob;

        bytes32 eventId = ledger.recordValueEvent(
            bob,
            1000 ether,
            IRewardLedger.EventType.CODE,
            trustChain
        );

        // Step 4: Distribute event rewards via Shapley along DAG trust chain
        ledger.distributeEvent(eventId);

        // Step 5: Claim rewards
        vm.prank(bob);
        ledger.claimActive();

        vm.prank(alice);
        ledger.claimActive();

        // Bob (actor) should get more (50% base), alice (enabler/founder) gets remainder
        uint256 bobBal = rewardToken.balanceOf(bob);
        uint256 aliceBal = rewardToken.balanceOf(alice);
        assertGt(bobBal, 0, "Bob (actor) should receive rewards");
        assertGt(aliceBal, 0, "Alice (enabler) should receive rewards");
        assertGt(bobBal, aliceBal, "Actor should receive more than enabler");
    }

    // ============ E2E: Soulbound identity required for trust graph ============
    function test_identityRequired_forVouch() public {
        address noIdentity = makeAddr("noId");

        vm.expectRevert(IContributionDAG.NoIdentity.selector);
        vm.prank(noIdentity);
        dag.addVouch(alice, keccak256("should fail"));
    }

    // ============ E2E: Trust score affects reward distribution ============
    function test_trustScore_affectsDistribution() public {
        // Build trust: alice (founder) -> bob (handshake) -> charlie (one-way)
        vm.prank(alice);
        dag.addVouch(bob, keccak256("v1"));
        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(bob);
        dag.addVouch(alice, keccak256("v2"));
        vm.prank(bob);
        dag.addVouch(charlie, keccak256("v3"));

        dag.recalculateTrustScores();

        // Check trust scores exist
        (uint256 aliceScore,,,,) = dag.getTrustScore(alice);
        (uint256 bobScore,,,,) = dag.getTrustScore(bob);
        assertGt(aliceScore, 0, "Founder should have trust score");
        assertGt(bobScore, 0, "Vouched-by-founder should have trust score");

        // Alice as founder should have highest trust
        assertGe(aliceScore, bobScore, "Founder should have >= trust than vouched");
    }

    // ============ E2E: VibeCode scores reflect contribution categories ============
    function test_vibeCode_reflectsContributions() public {
        // Alice: heavy coder, Bob: heavy reviewer
        // Values must be in PRECISION (1e18) units for log2 scoring
        for (uint256 i = 0; i < 5; i++) {
            vibeCode.recordContribution(
                alice,
                IVibeCode.ContributionCategory.CODE,
                100e18,
                keccak256(abi.encodePacked("code", i))
            );
        }
        for (uint256 i = 0; i < 5; i++) {
            vibeCode.recordContribution(
                bob,
                IVibeCode.ContributionCategory.REVIEW,
                100e18,
                keccak256(abi.encodePacked("review", i))
            );
        }

        vibeCode.refreshVibeCode(alice);
        vibeCode.refreshVibeCode(bob);

        // Both should have reputation scores
        uint256 aliceRep = vibeCode.getReputationScore(alice);
        uint256 bobRep = vibeCode.getReputationScore(bob);
        assertGt(aliceRep, 0, "Alice should have reputation");
        assertGt(bobRep, 0, "Bob should have reputation");

        // Different vibe codes (different contribution profiles)
        assertNotEq(vibeCode.getVibeCode(alice), vibeCode.getVibeCode(bob), "Different profiles should have different codes");
    }

    // ============ E2E: Shapley game distributes proportionally ============
    function test_shapleyGame_distributesProportionally() public {
        bytes32 gameId = keccak256("test-game");
        uint256 totalValue = 100 ether;

        // Fund shapley with tokens
        rewardToken.mint(address(shapley), totalValue);

        // Create game with participants
        ShapleyDistributor.Participant[] memory participants = new ShapleyDistributor.Participant[](3);
        participants[0] = ShapleyDistributor.Participant({
            participant: alice,
            directContribution: 50,
            timeInPool: 100,
            scarcityScore: 8000,
            stabilityScore: 9000
        });
        participants[1] = ShapleyDistributor.Participant({
            participant: bob,
            directContribution: 30,
            timeInPool: 80,
            scarcityScore: 6000,
            stabilityScore: 7000
        });
        participants[2] = ShapleyDistributor.Participant({
            participant: charlie,
            directContribution: 20,
            timeInPool: 60,
            scarcityScore: 4000,
            stabilityScore: 5000
        });

        shapley.createGame(gameId, totalValue, address(rewardToken), participants);
        shapley.computeShapleyValues(gameId);

        // All should be able to claim
        vm.prank(alice);
        uint256 aliceReward = shapley.claimReward(gameId);
        vm.prank(bob);
        uint256 bobReward = shapley.claimReward(gameId);
        vm.prank(charlie);
        uint256 charlieReward = shapley.claimReward(gameId);

        // Higher contributor should get more
        assertGt(aliceReward, 0, "Alice should receive shapley reward");
        assertGt(bobReward, 0, "Bob should receive shapley reward");
        assertGt(charlieReward, 0, "Charlie should receive shapley reward");
        assertGt(aliceReward, charlieReward, "Higher contributor should get more");

        // Total distributed should approximate totalValue
        uint256 totalDistributed = aliceReward + bobReward + charlieReward;
        assertGe(totalDistributed, (totalValue * 95) / 100, "Should distribute most of the value");
        assertLe(totalDistributed, totalValue, "Should not distribute more than total");
    }

    // ============ E2E: Retroactive rewards before finalization ============
    function test_retroactiveRewards_claimAfterFinalize() public {
        // Record retroactive contributions (pre-launch simulation)
        ledger.recordRetroactiveContribution(alice, 500 ether, IRewardLedger.EventType.MECHANISM_DESIGN, keccak256("design-work"));
        ledger.recordRetroactiveContribution(bob, 300 ether, IRewardLedger.EventType.CODE, keccak256("code-work"));

        // Cannot claim before finalization
        vm.prank(alice);
        vm.expectRevert(IRewardLedger.RetroactiveNotFinalized.selector);
        ledger.claimRetroactive();

        // Finalize
        ledger.finalizeRetroactive();

        // Now claims work
        vm.prank(alice);
        ledger.claimRetroactive();
        vm.prank(bob);
        ledger.claimRetroactive();

        assertEq(rewardToken.balanceOf(alice), 500 ether, "Alice retroactive reward");
        assertEq(rewardToken.balanceOf(bob), 300 ether, "Bob retroactive reward");
    }

    // ============ E2E: No double claiming ============
    function test_noDoubleClaim_retroactive() public {
        ledger.recordRetroactiveContribution(alice, 100 ether, IRewardLedger.EventType.CODE, keccak256("work"));
        ledger.finalizeRetroactive();

        vm.prank(alice);
        ledger.claimRetroactive();

        vm.prank(alice);
        vm.expectRevert(IRewardLedger.NothingToClaim.selector);
        ledger.claimRetroactive();
    }

    // ============ E2E: Identity blocks soulbound transfer ============
    function test_soulbound_cannotTransfer() public {
        uint256 tokenId = soulbound.addressToTokenId(alice);
        assertGt(tokenId, 0, "Alice should have token");

        vm.prank(alice);
        vm.expectRevert(SoulboundIdentity.SoulboundNoTransfer.selector);
        soulbound.transferFrom(alice, bob, tokenId);
    }

    // ============ E2E: XP awards update identity level ============
    function test_xpAwards_updateLevel() public {
        // Award a lot of XP to alice
        soulbound.awardXP(alice, 500, "massive contribution");

        SoulboundIdentity.Identity memory id = soulbound.getIdentity(alice);
        assertGt(id.xp, 0, "Alice should have XP");
        // Level depends on XP thresholds: 100, 300, 600, 1000, ...
        // 500 XP should reach level 2 (threshold 300)
        assertGe(id.level, 2, "Alice should be at least level 2 with 500 XP");
    }

    // ============ E2E: Full lifecycle — identity mint, contribute, trust, reward, claim ============
    function test_fullLifecycle_fourUsers() public {
        // Build a trust web
        vm.prank(alice);
        dag.addVouch(bob, keccak256("v1"));
        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(bob);
        dag.addVouch(alice, keccak256("v2")); // handshake
        vm.prank(alice);
        dag.addVouch(charlie, keccak256("v3"));
        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(charlie);
        dag.addVouch(alice, keccak256("v4")); // handshake
        vm.prank(bob);
        dag.addVouch(dave, keccak256("v5"));

        dag.recalculateTrustScores();

        // All 4 users contribute to VibeCode
        vibeCode.recordContribution(alice, IVibeCode.ContributionCategory.CODE, 200e18, keccak256("c1"));
        vibeCode.recordContribution(bob, IVibeCode.ContributionCategory.CODE, 150e18, keccak256("c2"));
        vibeCode.recordContribution(charlie, IVibeCode.ContributionCategory.IDEA, 100e18, keccak256("c3"));
        vibeCode.recordContribution(dave, IVibeCode.ContributionCategory.COMMUNITY, 50e18, keccak256("c4"));

        vibeCode.refreshVibeCode(alice);
        vibeCode.refreshVibeCode(bob);
        vibeCode.refreshVibeCode(charlie);
        vibeCode.refreshVibeCode(dave);

        // All should have unique vibe codes
        bytes32 ac = vibeCode.getVibeCode(alice);
        bytes32 bc = vibeCode.getVibeCode(bob);
        bytes32 cc = vibeCode.getVibeCode(charlie);
        bytes32 dc = vibeCode.getVibeCode(dave);
        assertTrue(ac != bytes32(0) && bc != bytes32(0) && cc != bytes32(0) && dc != bytes32(0),
            "All users should have vibe codes");

        // Record retroactive contributions and distribute
        ledger.recordRetroactiveContribution(alice, 400 ether, IRewardLedger.EventType.MECHANISM_DESIGN, keccak256("r1"));
        ledger.recordRetroactiveContribution(bob, 300 ether, IRewardLedger.EventType.CODE, keccak256("r2"));
        ledger.recordRetroactiveContribution(charlie, 200 ether, IRewardLedger.EventType.CONTRIBUTION, keccak256("r3"));
        ledger.recordRetroactiveContribution(dave, 100 ether, IRewardLedger.EventType.GOVERNANCE, keccak256("r4"));

        ledger.finalizeRetroactive();

        // All claim
        vm.prank(alice);
        ledger.claimRetroactive();
        vm.prank(bob);
        ledger.claimRetroactive();
        vm.prank(charlie);
        ledger.claimRetroactive();
        vm.prank(dave);
        ledger.claimRetroactive();

        // Verify all got their retroactive amounts
        assertEq(rewardToken.balanceOf(alice), 400 ether);
        assertEq(rewardToken.balanceOf(bob), 300 ether);
        assertEq(rewardToken.balanceOf(charlie), 200 ether);
        assertEq(rewardToken.balanceOf(dave), 100 ether);
    }
}
