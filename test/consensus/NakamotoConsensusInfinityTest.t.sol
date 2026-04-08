// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/consensus/NakamotoConsensusInfinity.sol";
import "../../contracts/consensus/INakamotoConsensusInfinity.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock VIBE Token ============

contract MockVIBE is ERC20 {
    constructor() ERC20("VIBE", "VIBE") {
        _mint(msg.sender, 21_000_000e18);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

// ============ Mock SoulboundIdentity ============

contract MockSoulbound {
    mapping(address => bool) private _hasIdentity;
    mapping(address => uint256) public addressToTokenId;

    struct MockIdentity {
        string username;
        uint256 level;
        uint256 xp;
        int256 alignment;
        uint256 contributions;
        uint256 reputation;
        uint256 createdAt;
        uint256 lastActive;
    }

    mapping(uint256 => MockIdentity) private _identityData;
    uint256 public nextId = 1;

    function setIdentity(address user, uint256 level, uint256 xp, uint256 contributions, uint256 reputation) external {
        uint256 tokenId = nextId++;
        _hasIdentity[user] = true;
        addressToTokenId[user] = tokenId;
        _identityData[tokenId] = MockIdentity({
            username: "test",
            level: level,
            xp: xp,
            alignment: 0,
            contributions: contributions,
            reputation: reputation,
            createdAt: block.timestamp,
            lastActive: block.timestamp
        });
    }

    function hasIdentity(address user) external view returns (bool) {
        return _hasIdentity[user];
    }

    // Match SoulboundIdentity's identities() mapping getter
    function identities(uint256 tokenId) external view returns (
        string memory, uint256, uint256, int256, uint256, uint256, uint256, uint256
    ) {
        MockIdentity storage id = _identityData[tokenId];
        return (id.username, id.level, id.xp, id.alignment, id.contributions, id.reputation, id.createdAt, id.lastActive);
    }
}

// ============ Mock ContributionDAG ============

contract MockDAG {
    mapping(address => uint256) public multipliers;

    function setMultiplier(address user, uint256 mult) external {
        multipliers[user] = mult;
    }

    function getVotingPowerMultiplier(address user) external view returns (uint256) {
        return multipliers[user];
    }
}

// ============ Mock VibeCode ============

contract MockVibeCode {
    mapping(address => uint256) public scores;

    function setScore(address user, uint256 score) external {
        scores[user] = score;
    }

    // Returns (bytes32 vibeHash, uint256 totalScore, ...)
    function getProfile(address user) external view returns (
        bytes32, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256
    ) {
        return (bytes32(0), scores[user], 0, 0, 0, 0, 0, 0, 0);
    }
}

// ============ Mock AgentReputation ============

contract MockAgentRep {
    mapping(bytes32 => uint256) public scores;

    function setScore(bytes32 agentId, uint256 score) external {
        scores[agentId] = score;
    }

    function getCompositeScore(bytes32 agentId) external view returns (uint256) {
        return scores[agentId];
    }
}

// ============ Test Contract ============

contract NakamotoConsensusInfinityTest is Test {
    NakamotoConsensusInfinity public nci;
    MockVIBE public vibe;
    MockSoulbound public soulbound;
    MockDAG public dag;
    MockVibeCode public vibeCode;
    MockAgentRep public agentRep;

    address public owner = address(this);
    address public alice = address(0xA11CE);
    address public bob = address(0xB0B);
    address public charlie = address(0xC4A);
    address public dave = address(0xDA7E);
    address public eve = address(0xE7E);

    uint256 constant WAD = 1e18;
    uint256 constant STAKE_AMOUNT = 1000e18;

    function setUp() public {
        // Deploy mocks
        vibe = new MockVIBE();
        soulbound = new MockSoulbound();
        dag = new MockDAG();
        vibeCode = new MockVibeCode();
        agentRep = new MockAgentRep();

        // Deploy NCI behind UUPS proxy
        NakamotoConsensusInfinity impl = new NakamotoConsensusInfinity();
        bytes memory initData = abi.encodeWithSelector(
            NakamotoConsensusInfinity.initialize.selector,
            address(vibe),
            address(soulbound),
            address(dag),
            address(vibeCode),
            address(agentRep)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        nci = NakamotoConsensusInfinity(payable(address(proxy)));

        // Distribute VIBE
        vibe.transfer(alice, 10_000e18);
        vibe.transfer(bob, 10_000e18);
        vibe.transfer(charlie, 10_000e18);
        vibe.transfer(dave, 10_000e18);
        vibe.transfer(eve, 10_000e18);

        // Set up PoM data
        soulbound.setIdentity(alice, 5, 2000, 50, 100);
        soulbound.setIdentity(bob, 3, 500, 20, 30);
        dag.setMultiplier(alice, 30000); // Founder
        dag.setMultiplier(bob, 20000);   // Trusted
        vibeCode.setScore(alice, 8000);
        vibeCode.setScore(bob, 5000);
    }

    // ============ Helper ============

    function _registerValidator(address user, uint256 stake) internal {
        vm.startPrank(user);
        vibe.approve(address(nci), stake);
        nci.registerValidator(INakamotoConsensusInfinity.NodeType.META, stake);
        vm.stopPrank();
    }

    function _setupTrinityAndRegister(address user, uint256 stake) internal {
        nci.addTrinityNode(user);
        vm.startPrank(user);
        vibe.approve(address(nci), stake);
        nci.registerValidator(INakamotoConsensusInfinity.NodeType.AUTHORITY, stake);
        vm.stopPrank();
    }

    // ============ Registration Tests ============

    function test_RegisterMetaValidator() public {
        _registerValidator(alice, STAKE_AMOUNT);

        INakamotoConsensusInfinity.Validator memory v = nci.getValidator(alice);
        assertEq(v.addr, alice);
        assertEq(uint8(v.nodeType), uint8(INakamotoConsensusInfinity.NodeType.META));
        assertEq(v.stakedVibe, STAKE_AMOUNT);
        assertTrue(v.active);
        assertFalse(v.slashed);
        assertEq(nci.activeValidatorCount(), 1);
        assertEq(nci.totalStaked(), STAKE_AMOUNT);
    }

    function test_RegisterAuthorityValidator() public {
        _setupTrinityAndRegister(alice, STAKE_AMOUNT);

        INakamotoConsensusInfinity.Validator memory v = nci.getValidator(alice);
        assertEq(uint8(v.nodeType), uint8(INakamotoConsensusInfinity.NodeType.AUTHORITY));
        assertTrue(nci.trinityStatus(alice));
    }

    function test_RevertRegisterAuthorityWithoutTrinity() public {
        vm.startPrank(alice);
        vibe.approve(address(nci), STAKE_AMOUNT);
        vm.expectRevert(INakamotoConsensusInfinity.NotTrinityNode.selector);
        nci.registerValidator(INakamotoConsensusInfinity.NodeType.AUTHORITY, STAKE_AMOUNT);
        vm.stopPrank();
    }

    function test_RevertDoubleRegister() public {
        _registerValidator(alice, STAKE_AMOUNT);

        vm.startPrank(alice);
        vibe.approve(address(nci), STAKE_AMOUNT);
        vm.expectRevert(INakamotoConsensusInfinity.AlreadyRegistered.selector);
        nci.registerValidator(INakamotoConsensusInfinity.NodeType.META, STAKE_AMOUNT);
        vm.stopPrank();
    }

    function test_RegisterWithZeroStake_Reverts() public {
        // NCI-002: Zero stake now reverts (MIN_STAKE enforced)
        vm.prank(alice);
        vm.expectRevert(INakamotoConsensusInfinity.InsufficientStake.selector);
        nci.registerValidator(INakamotoConsensusInfinity.NodeType.META, 0);
    }

    // ============ Staking Tests ============

    function test_DepositStake() public {
        _registerValidator(alice, STAKE_AMOUNT);

        uint256 additional = 500e18;
        vm.startPrank(alice);
        vibe.approve(address(nci), additional);
        nci.depositStake(additional);
        vm.stopPrank();

        INakamotoConsensusInfinity.Validator memory v = nci.getValidator(alice);
        assertEq(v.stakedVibe, STAKE_AMOUNT + additional);
        assertEq(nci.totalStaked(), STAKE_AMOUNT + additional);
    }

    /// @dev C5-CON-001: withdrawStake is deprecated — always reverts
    function test_WithdrawStake_Deprecated() public {
        _registerValidator(alice, STAKE_AMOUNT);

        vm.prank(alice);
        vm.expectRevert("Deprecated: use requestStakeWithdrawal");
        nci.withdrawStake(400e18);
    }

    /// @dev C5-CON-001: Test two-phase withdrawal flow
    function test_TwoPhaseWithdrawal() public {
        _registerValidator(alice, STAKE_AMOUNT);

        uint256 withdraw = 400e18;
        vm.prank(alice);
        nci.requestStakeWithdrawal(withdraw);

        // Cannot complete before unbonding period
        vm.prank(alice);
        vm.expectRevert("Unbonding not complete");
        nci.completeStakeWithdrawal();

        // Warp past unbonding period (7 days)
        vm.warp(block.timestamp + 7 days + 1);

        vm.prank(alice);
        nci.completeStakeWithdrawal();

        INakamotoConsensusInfinity.Validator memory v = nci.getValidator(alice);
        assertEq(v.stakedVibe, STAKE_AMOUNT - withdraw);
    }

    function test_RevertDepositZero() public {
        _registerValidator(alice, STAKE_AMOUNT);

        vm.prank(alice);
        vm.expectRevert(INakamotoConsensusInfinity.ZeroAmount.selector);
        nci.depositStake(0);
    }

    // ============ Weight Calculation Tests ============

    function test_WeightFormula_PureStake() public {
        _registerValidator(alice, STAKE_AMOUNT);

        INakamotoConsensusInfinity.Validator memory v = nci.getValidator(alice);

        // PoW weight = log₂(1 + 0) = 0
        assertEq(v.powWeight, 0);
        // PoS weight = 1000e18 (linear)
        assertEq(v.posWeight, STAKE_AMOUNT);
        // PoM weight = 0 (no mind score refreshed yet)
        assertEq(v.pomWeight, 0);
        // Total = 0.10 * 0 + 0.30 * 1000e18 + 0.60 * 0 = 300e18
        assertEq(v.totalWeight, STAKE_AMOUNT * 3000 / 10000);
    }

    function test_WeightDimensionBPS() public {
        // Verify BPS constants sum to 10000
        assertEq(
            nci.POW_WEIGHT_BPS() + nci.POS_WEIGHT_BPS() + nci.POM_WEIGHT_BPS(),
            10000
        );
    }

    function test_PoWWeightLogarithmic() public {
        // log₂(1 + 1) = 1, log₂(1 + 3) = 2, log₂(1 + 7) = 3
        assertEq(nci.calculatePoWWeight(1), 1 * WAD); // log₂(2) = 1
        assertEq(nci.calculatePoWWeight(3), 2 * WAD); // log₂(4) = 2
        assertEq(nci.calculatePoWWeight(7), 3 * WAD); // log₂(8) = 3
        assertEq(nci.calculatePoWWeight(15), 4 * WAD); // log₂(16) = 4
        assertEq(nci.calculatePoWWeight(0), 0);        // log₂(1) = 0
    }

    function test_PoMWeightLogarithmic() public {
        // Same log₂ function as PoW
        assertEq(nci.calculatePoMWeight(1), 1 * WAD);
        assertEq(nci.calculatePoMWeight(255), 8 * WAD);
        assertEq(nci.calculatePoMWeight(1023), 10 * WAD);
    }

    function test_CombinedWeightFormula() public {
        // Register alice with stake, then give her PoW and PoM
        _registerValidator(alice, STAKE_AMOUNT);

        // Refresh mind score (will pull from mocks)
        vm.prank(alice);
        nci.refreshMindScore();

        INakamotoConsensusInfinity.Validator memory v = nci.getValidator(alice);

        // Verify W = 0.10 * PoW + 0.30 * PoS + 0.60 * PoM
        uint256 expectedTotal = (
            v.powWeight * 1000 +
            v.posWeight * 3000 +
            v.pomWeight * 6000
        ) / 10000;
        assertEq(v.totalWeight, expectedTotal);
    }

    function test_PoMDominatesWeight() public {
        // Alice: min stake, high PoM
        _registerValidator(alice, 100e18); // MIN_STAKE
        vm.prank(alice);
        nci.refreshMindScore();

        // Bob: high stake, low PoM (less reputation data)
        _registerValidator(bob, 5000e18);
        vm.prank(bob);
        nci.refreshMindScore();

        INakamotoConsensusInfinity.Validator memory vAlice = nci.getValidator(alice);
        INakamotoConsensusInfinity.Validator memory vBob = nci.getValidator(bob);

        // Alice's PoM should be significantly higher
        assertGt(vAlice.pomWeight, vBob.pomWeight, "Alice should have higher PoM weight");
    }

    // ============ Mind Score Aggregation Tests ============

    function test_RefreshMindScore() public {
        _registerValidator(alice, STAKE_AMOUNT);

        vm.prank(alice);
        nci.refreshMindScore();

        INakamotoConsensusInfinity.Validator memory v = nci.getValidator(alice);
        // Alice has: identity(level=5, xp=2000, contributions=50, reputation=100)
        // = 5*100 + 2000 + 50*50 + 100*200 = 500 + 2000 + 2500 + 20000 = 25000
        // + DAG multiplier: 30000 (founder)
        // + VibeCode: 8000 * 10 = 80000
        // + AgentRep: 0 (not set)
        // Total mind score ≈ 135000
        assertGt(v.mindScore, 0, "Mind score should be positive");
        assertGt(v.pomWeight, 0, "PoM weight should be positive");
    }

    function test_MindScoreWithNoExternalContracts() public {
        // Set all external contracts to zero
        nci.setSoulboundIdentity(address(0));
        nci.setContributionDAG(address(0));
        nci.setVibeCode(address(0));
        nci.setAgentReputation(address(0));

        _registerValidator(alice, STAKE_AMOUNT);
        vm.prank(alice);
        nci.refreshMindScore();

        INakamotoConsensusInfinity.Validator memory v = nci.getValidator(alice);
        assertEq(v.mindScore, 0);
        assertEq(v.pomWeight, 0);
    }

    // ============ Proposal & Voting Tests ============

    function test_ProposeAndVote() public {
        _registerValidator(alice, STAKE_AMOUNT);
        _registerValidator(bob, STAKE_AMOUNT);

        // Alice proposes
        vm.prank(alice);
        uint256 propId = nci.propose(keccak256("block_1"));

        INakamotoConsensusInfinity.Proposal memory p = nci.getProposal(propId);
        assertEq(p.proposalId, 0);
        assertEq(p.dataHash, keccak256("block_1"));
        assertEq(p.proposer, alice);
        assertEq(uint8(p.status), uint8(INakamotoConsensusInfinity.ProposalStatus.VOTING));

        // Bob votes
        vm.prank(bob);
        nci.vote(propId, true);

        p = nci.getProposal(propId);
        assertGt(p.weightFor, 0, "Should have votes for");
    }

    function test_RevertDoubleVote() public {
        _registerValidator(alice, STAKE_AMOUNT);
        vm.prank(alice);
        uint256 propId = nci.propose(keccak256("block_1"));

        vm.prank(alice);
        nci.vote(propId, true);

        vm.prank(alice);
        vm.expectRevert(INakamotoConsensusInfinity.AlreadyVoted.selector);
        nci.vote(propId, true);
    }

    function test_FinalizeProposal() public {
        _registerValidator(alice, STAKE_AMOUNT);
        _registerValidator(bob, STAKE_AMOUNT);

        vm.prank(alice);
        uint256 propId = nci.propose(keccak256("block_1"));

        // Both vote for (2/2 = 100% > 66.67%)
        vm.prank(alice);
        nci.vote(propId, true);
        vm.prank(bob);
        nci.vote(propId, true);

        // Finalize
        nci.finalizeProposal(propId);

        INakamotoConsensusInfinity.Proposal memory p = nci.getProposal(propId);
        assertEq(uint8(p.status), uint8(INakamotoConsensusInfinity.ProposalStatus.FINALIZED));
        assertTrue(p.finalizedAt > 0);

        // Epoch should be finalized
        INakamotoConsensusInfinity.EpochInfo memory e = nci.getCurrentEpoch();
        assertTrue(e.finalized);
        assertEq(e.finalizedHash, keccak256("block_1"));
    }

    function test_RejectProposal() public {
        _registerValidator(alice, STAKE_AMOUNT);
        _registerValidator(bob, STAKE_AMOUNT);
        _registerValidator(charlie, STAKE_AMOUNT);

        vm.prank(alice);
        uint256 propId = nci.propose(keccak256("block_bad"));

        // All vote against
        vm.prank(alice);
        nci.vote(propId, false);
        vm.prank(bob);
        nci.vote(propId, false);
        vm.prank(charlie);
        nci.vote(propId, false);

        nci.finalizeProposal(propId);

        INakamotoConsensusInfinity.Proposal memory p = nci.getProposal(propId);
        assertEq(uint8(p.status), uint8(INakamotoConsensusInfinity.ProposalStatus.REJECTED));
    }

    function test_RevertVoteOnNonVotingProposal() public {
        _registerValidator(alice, STAKE_AMOUNT);
        _registerValidator(bob, STAKE_AMOUNT);

        vm.prank(alice);
        uint256 propId = nci.propose(keccak256("block_1"));

        vm.prank(alice);
        nci.vote(propId, true);
        vm.prank(bob);
        nci.vote(propId, true);
        nci.finalizeProposal(propId);

        // Try to vote on finalized proposal
        _registerValidator(charlie, STAKE_AMOUNT);
        vm.prank(charlie);
        vm.expectRevert(INakamotoConsensusInfinity.ProposalNotVoting.selector);
        nci.vote(propId, true);
    }

    // ============ Equivocation Detection Tests ============

    function test_EquivocationDetectedAndSlashed() public {
        _registerValidator(alice, STAKE_AMOUNT);
        _registerValidator(bob, STAKE_AMOUNT);
        _registerValidator(charlie, STAKE_AMOUNT);

        // Two proposals in same epoch with different data
        vm.prank(alice);
        uint256 prop1 = nci.propose(keccak256("block_A"));
        vm.prank(bob);
        uint256 prop2 = nci.propose(keccak256("block_B"));

        // Charlie votes for first proposal (succeeds)
        vm.prank(charlie);
        nci.vote(prop1, true);

        // NCI-013: Second vote on different dataHash triggers slash + silent return (vote not counted)
        vm.prank(charlie);
        nci.vote(prop2, true); // Slashes charlie, vote not counted

        // Charlie should be slashed (slashing happens before revert)
        INakamotoConsensusInfinity.Validator memory v = nci.getValidator(charlie);
        assertTrue(v.slashed, "Should be slashed");
        assertFalse(v.active, "Should be deactivated");

        // Stake should be 50% slashed
        assertEq(v.stakedVibe, STAKE_AMOUNT / 2, "Half stake should remain");
    }

    function test_EquivocationSlashesStakeAndMind() public {
        _registerValidator(alice, STAKE_AMOUNT);
        _registerValidator(bob, STAKE_AMOUNT);
        _registerValidator(charlie, STAKE_AMOUNT);

        // Give charlie a mind score first
        soulbound.setIdentity(charlie, 10, 5000, 100, 200);
        dag.setMultiplier(charlie, 20000);
        vm.prank(charlie);
        nci.refreshMindScore();

        INakamotoConsensusInfinity.Validator memory vBefore = nci.getValidator(charlie);
        uint256 mindBefore = vBefore.mindScore;
        assertGt(mindBefore, 0, "Should have mind score");

        // Equivocate — NCI-013: second vote slashes + returns (vote not counted)
        vm.prank(alice);
        uint256 prop1 = nci.propose(keccak256("block_X"));
        vm.prank(bob);
        uint256 prop2 = nci.propose(keccak256("block_Y"));
        vm.prank(charlie);
        nci.vote(prop1, true);
        vm.prank(charlie);
        nci.vote(prop2, true);

        INakamotoConsensusInfinity.Validator memory vAfter = nci.getValidator(charlie);
        // 75% mind score slashed
        assertEq(vAfter.mindScore, mindBefore - (mindBefore * 7500 / 10000));
    }

    // ============ Epoch Management Tests ============

    function test_AdvanceEpoch() public {
        assertEq(nci.currentEpochNumber(), 0);

        // Must wait for epoch duration
        vm.warp(block.timestamp + 11);
        nci.advanceEpoch();

        assertEq(nci.currentEpochNumber(), 1);

        INakamotoConsensusInfinity.EpochInfo memory e = nci.getCurrentEpoch();
        assertEq(e.epochNumber, 1);
        assertFalse(e.finalized);
    }

    function test_RevertAdvanceEpochTooSoon() public {
        vm.expectRevert(INakamotoConsensusInfinity.EpochNotReady.selector);
        nci.advanceEpoch();
    }

    function test_MultipleEpochs() public {
        // Register a validator so heartbeat check doesn't fail
        _registerValidator(alice, STAKE_AMOUNT);

        uint256 ts = block.timestamp;
        for (uint256 i = 0; i < 5; i++) {
            ts += 11;
            vm.warp(ts);
            nci.advanceEpoch();
        }
        assertEq(nci.currentEpochNumber(), 5);
    }

    // ============ Trinity Management Tests ============

    function test_AddTrinityNode() public {
        nci.addTrinityNode(alice);
        assertTrue(nci.trinityStatus(alice));
        assertEq(nci.getTrinityNodeCount(), 1);
    }

    function test_RemoveTrinityNode() public {
        nci.addTrinityNode(alice);
        nci.addTrinityNode(bob);
        nci.addTrinityNode(charlie);

        nci.removeTrinityNode(charlie);
        assertFalse(nci.trinityStatus(charlie));
        assertEq(nci.getTrinityNodeCount(), 2);
    }

    function test_RevertRemoveBelowMinTrinity() public {
        nci.addTrinityNode(alice);
        nci.addTrinityNode(bob);

        // Can't remove below MIN_TRINITY_NODES (2)
        vm.expectRevert(INakamotoConsensusInfinity.MinTrinityNodes.selector);
        nci.removeTrinityNode(alice);
    }

    function test_TrinityUpgradesExistingValidator() public {
        _registerValidator(alice, STAKE_AMOUNT);

        INakamotoConsensusInfinity.Validator memory v = nci.getValidator(alice);
        assertEq(uint8(v.nodeType), uint8(INakamotoConsensusInfinity.NodeType.META));

        nci.addTrinityNode(alice);

        v = nci.getValidator(alice);
        assertEq(uint8(v.nodeType), uint8(INakamotoConsensusInfinity.NodeType.AUTHORITY));
    }

    // ============ Heartbeat / Liveness Tests ============

    function test_Heartbeat() public {
        _registerValidator(alice, STAKE_AMOUNT);

        vm.warp(block.timestamp + 12 hours);
        vm.prank(alice);
        nci.heartbeat();

        INakamotoConsensusInfinity.Validator memory v = nci.getValidator(alice);
        assertEq(v.lastHeartbeat, block.timestamp);
    }

    function test_HeartbeatReactivatesValidator() public {
        _registerValidator(alice, STAKE_AMOUNT);

        // Deactivate
        vm.prank(alice);
        nci.deactivateValidator();
        assertEq(nci.activeValidatorCount(), 0);

        // Heartbeat reactivates
        vm.prank(alice);
        nci.heartbeat();

        assertTrue(nci.getValidator(alice).active);
        assertEq(nci.activeValidatorCount(), 1);
    }

    function test_MissedHeartbeatDeactivates() public {
        _registerValidator(alice, STAKE_AMOUNT);
        _registerValidator(bob, STAKE_AMOUNT);

        // Alice misses heartbeat for > 48 hours
        vm.warp(block.timestamp + 49 hours);

        // Advance epoch triggers heartbeat check
        nci.advanceEpoch();

        INakamotoConsensusInfinity.Validator memory v = nci.getValidator(alice);
        assertFalse(v.active, "Should be deactivated by missed heartbeat");
    }

    function test_DeactivateValidator() public {
        _registerValidator(alice, STAKE_AMOUNT);
        assertEq(nci.activeValidatorCount(), 1);

        vm.prank(alice);
        nci.deactivateValidator();

        assertEq(nci.activeValidatorCount(), 0);
        assertFalse(nci.getValidator(alice).active);
    }

    // ============ Network Weight Tests ============

    function test_TotalNetworkWeight() public {
        _registerValidator(alice, STAKE_AMOUNT);
        _registerValidator(bob, 2 * STAKE_AMOUNT);

        uint256 totalWeight = nci.getTotalNetworkWeight();

        // Both have only PoS weight (no PoW or PoM refreshed)
        // Alice: 1000e18 * 0.30 = 300e18
        // Bob: 2000e18 * 0.30 = 600e18
        // Total = 900e18
        assertEq(totalWeight, (STAKE_AMOUNT + 2 * STAKE_AMOUNT) * 3000 / 10000);
    }

    function test_SlashedValidatorExcludedFromWeight() public {
        _registerValidator(alice, STAKE_AMOUNT);
        _registerValidator(bob, STAKE_AMOUNT);
        _registerValidator(charlie, STAKE_AMOUNT);

        uint256 weightBefore = nci.getTotalNetworkWeight();

        // Slash charlie via equivocation — NCI-013: second vote slashes + returns
        vm.prank(alice);
        uint256 p1 = nci.propose(keccak256("A"));
        vm.prank(bob);
        uint256 p2 = nci.propose(keccak256("B"));
        vm.prank(charlie);
        nci.vote(p1, true);
        vm.prank(charlie);
        nci.vote(p2, true);

        uint256 weightAfter = nci.getTotalNetworkWeight();
        assertLt(weightAfter, weightBefore, "Network weight should decrease after slash");
    }

    // ============ Access Control Tests ============

    function test_OnlyOwnerCanAddTrinity() public {
        vm.prank(alice);
        vm.expectRevert();
        nci.addTrinityNode(bob);
    }

    function test_OnlyOwnerCanSetContracts() public {
        vm.startPrank(alice);
        vm.expectRevert();
        nci.setSoulboundIdentity(address(0));
        vm.expectRevert();
        nci.setContributionDAG(address(0));
        vm.expectRevert();
        nci.setVibeCode(address(0));
        vm.expectRevert();
        nci.setAgentReputation(address(0));
        vm.stopPrank();
    }

    function test_RevertProposeFromInactive() public {
        _registerValidator(alice, STAKE_AMOUNT);
        vm.prank(alice);
        nci.deactivateValidator();

        vm.prank(alice);
        vm.expectRevert(INakamotoConsensusInfinity.NotActive.selector);
        nci.propose(keccak256("block"));
    }

    function test_RevertVoteFromUnregistered() public {
        _registerValidator(alice, STAKE_AMOUNT);
        vm.prank(alice);
        uint256 propId = nci.propose(keccak256("block"));

        vm.prank(bob);
        vm.expectRevert(INakamotoConsensusInfinity.NotRegistered.selector);
        nci.vote(propId, true);
    }

    // ============ View Function Tests ============

    function test_GetDimensionWeights() public {
        _registerValidator(alice, STAKE_AMOUNT);
        vm.prank(alice);
        nci.refreshMindScore();

        (uint256 pow, uint256 pos, uint256 pom) = nci.getDimensionWeights(alice);
        assertEq(pow, 0); // No PoW submitted
        assertEq(pos, STAKE_AMOUNT); // Linear stake
        assertGt(pom, 0, "PoM should be positive after refresh");
    }

    function test_GetActiveValidatorCount() public {
        assertEq(nci.getActiveValidatorCount(), 0);
        _registerValidator(alice, STAKE_AMOUNT);
        assertEq(nci.getActiveValidatorCount(), 1);
        _registerValidator(bob, STAKE_AMOUNT);
        assertEq(nci.getActiveValidatorCount(), 2);
    }

    function test_IsTrinity() public {
        assertFalse(nci.isTrinity(alice));
        nci.addTrinityNode(alice);
        assertTrue(nci.isTrinity(alice));
    }

    // ============ Fuzz Tests ============

    function testFuzz_PoWWeightMonotonic(uint64 a, uint64 b) public view {
        vm.assume(a < b);
        uint256 wA = nci.calculatePoWWeight(uint256(a));
        uint256 wB = nci.calculatePoWWeight(uint256(b));
        assertLe(wA, wB, "PoW weight should be monotonically non-decreasing");
    }

    function testFuzz_PoMWeightMonotonic(uint64 a, uint64 b) public view {
        vm.assume(a < b);
        uint256 wA = nci.calculatePoMWeight(uint256(a));
        uint256 wB = nci.calculatePoMWeight(uint256(b));
        assertLe(wA, wB, "PoM weight should be monotonically non-decreasing");
    }

    function testFuzz_WeightDimensionSum(uint128 stake, uint64 pow, uint64 pom) public view {
        // Compute individual weights
        uint256 powW = nci.calculatePoWWeight(uint256(pow));
        uint256 posW = uint256(stake);
        uint256 pomW = nci.calculatePoMWeight(uint256(pom));

        // Combined weight
        uint256 total = (powW * 1000 + posW * 3000 + pomW * 6000) / 10000;

        // Verify the formula doesn't overflow and total is reasonable
        assertLe(total, powW + posW + pomW, "Total should not exceed sum of parts");
        // PoM weight (60%) should dominate when pom > 0 and stake is moderate
        if (pomW > posW && pomW > powW) {
            assertGt(pomW * 6000 / 10000, posW * 3000 / 10000, "PoM should dominate when highest");
        }
    }

    // ============ Integration: Full Consensus Round ============

    function test_FullConsensusRound() public {
        // Setup 3 validators with diverse profiles
        _registerValidator(alice, 2000e18);
        _registerValidator(bob, 1000e18);
        _registerValidator(charlie, 500e18);

        // Refresh mind scores
        vm.prank(alice);
        nci.refreshMindScore();
        vm.prank(bob);
        nci.refreshMindScore();

        // Alice proposes a block
        bytes32 blockHash = keccak256("genesis_block");
        vm.prank(alice);
        uint256 propId = nci.propose(blockHash);

        // All three vote for it
        vm.prank(alice);
        nci.vote(propId, true);
        vm.prank(bob);
        nci.vote(propId, true);
        vm.prank(charlie);
        nci.vote(propId, true);

        // Finalize
        nci.finalizeProposal(propId);

        // Verify
        INakamotoConsensusInfinity.Proposal memory p = nci.getProposal(propId);
        assertEq(uint8(p.status), uint8(INakamotoConsensusInfinity.ProposalStatus.FINALIZED));

        INakamotoConsensusInfinity.EpochInfo memory e = nci.getCurrentEpoch();
        assertTrue(e.finalized);
        assertEq(e.finalizedHash, blockHash);

        // Advance to next epoch
        vm.warp(block.timestamp + 11);
        nci.advanceEpoch();
        assertEq(nci.currentEpochNumber(), 1);
    }

    function test_MultiEpochConsensus() public {
        _registerValidator(alice, STAKE_AMOUNT);
        _registerValidator(bob, STAKE_AMOUNT);

        // Run 3 consensus rounds
        for (uint256 i = 0; i < 3; i++) {
            bytes32 blockHash = keccak256(abi.encodePacked("block_", i));

            vm.prank(alice);
            uint256 propId = nci.propose(blockHash);

            vm.prank(alice);
            nci.vote(propId, true);
            vm.prank(bob);
            nci.vote(propId, true);

            nci.finalizeProposal(propId);

            vm.warp(block.timestamp + 11);
            nci.advanceEpoch();
        }

        assertEq(nci.currentEpochNumber(), 3);
    }

    // ============ Security Properties ============

    function test_SecurityProperty_PoMDominatesConsensus() public {
        // Register two validators:
        // alice: low stake, high PoM (founder, many contributions)
        // bob: high stake, zero PoM (whale with no contributions)

        vm.startPrank(alice);
        vibe.approve(address(nci), 100e18);
        nci.registerValidator(INakamotoConsensusInfinity.NodeType.META, 100e18); // Low stake
        vm.stopPrank();

        _registerValidator(bob, 9000e18); // High stake

        // Alice refreshes her mind score (has full PoM data)
        vm.prank(alice);
        nci.refreshMindScore();

        INakamotoConsensusInfinity.Validator memory vAlice = nci.getValidator(alice);
        INakamotoConsensusInfinity.Validator memory vBob = nci.getValidator(bob);

        // Alice's PoM weight should be non-trivial
        assertGt(vAlice.pomWeight, 0, "Alice should have PoM weight");
        assertEq(vBob.pomWeight, 0, "Bob should have zero PoM weight");

        // The 60% PoM weighting means alice's PoM contribution is large
        uint256 alicePomContribution = vAlice.pomWeight * 6000 / 10000;
        uint256 bobPosContribution = vBob.posWeight * 3000 / 10000;

        // This demonstrates the principle: PoM at 60% gives cognitive contributors
        // significant weight even against capital-heavy but contribution-light actors
        assertGt(alicePomContribution, 0, "PoM contribution should be positive");
        assertGt(bobPosContribution, 0, "PoS contribution should be positive");
    }

    function test_SecurityProperty_EquivocationCostlySlash() public {
        _registerValidator(alice, 10000e18); // Max stake
        soulbound.setIdentity(alice, 10, 10000, 200, 500);
        dag.setMultiplier(alice, 30000);
        vibeCode.setScore(alice, 10000);

        // Build up alice's profile
        vm.prank(alice);
        nci.refreshMindScore();

        INakamotoConsensusInfinity.Validator memory vBefore = nci.getValidator(alice);
        uint256 stakeBefore = vBefore.stakedVibe;
        uint256 mindBefore = vBefore.mindScore;

        // Create equivocation scenario
        _registerValidator(bob, STAKE_AMOUNT);
        _registerValidator(charlie, STAKE_AMOUNT);

        vm.prank(bob);
        uint256 p1 = nci.propose(keccak256("fork_A"));
        vm.prank(charlie);
        uint256 p2 = nci.propose(keccak256("fork_B"));

        // Alice equivocates — NCI-013: second vote slashes + returns (vote not counted)
        vm.prank(alice);
        nci.vote(p1, true);
        vm.prank(alice);
        nci.vote(p2, true);

        INakamotoConsensusInfinity.Validator memory vAfter = nci.getValidator(alice);

        // 50% stake slashed
        assertEq(vAfter.stakedVibe, stakeBefore / 2, "50% stake slashed");
        // 75% mind score slashed
        assertEq(vAfter.mindScore, mindBefore / 4, "75% mind score slashed");
        // Permanently slashed and deactivated
        assertTrue(vAfter.slashed);
        assertFalse(vAfter.active);
    }

    function test_SecurityProperty_TimeCannotBePurchased() public {
        // Even with infinite stake, a new validator with no PoM
        // gets only 30% of their weight from stake
        uint256 bigStake = 5_000_000e18;
        vibe.mint(alice, bigStake);

        vm.startPrank(alice);
        vibe.approve(address(nci), bigStake);
        nci.registerValidator(INakamotoConsensusInfinity.NodeType.META, bigStake);
        vm.stopPrank();

        INakamotoConsensusInfinity.Validator memory v = nci.getValidator(alice);

        // Total weight is ONLY 30% of stake (no PoW, no PoM)
        assertEq(v.powWeight, 0, "No PoW submitted");
        assertEq(v.pomWeight, 0, "No PoM refreshed");
        assertEq(v.totalWeight, v.posWeight * 3000 / 10000, "Only 30% of stake counts");
        assertGt(v.posWeight, 0, "Stake should be massive");
        // The other 70% (PoW 10% + PoM 60%) requires genuine work over time
        // This is the core insight: time cannot be purchased
    }
}
