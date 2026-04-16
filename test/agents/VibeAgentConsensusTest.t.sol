// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/agents/VibeAgentConsensus.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Test Contract ============

contract VibeAgentConsensusTest is Test {
    // ============ Re-declare Events ============

    event RoundCreated(uint256 indexed roundId, bytes32 topic, uint256 commitDeadline);
    event AgentCommitted(uint256 indexed roundId, bytes32 indexed agentId);
    event AgentRevealed(uint256 indexed roundId, bytes32 indexed agentId, uint256 value);
    event ConsensusReached(uint256 indexed roundId, uint256 consensusValue, uint256 participantCount);
    event RoundTimedOut(uint256 indexed roundId);
    event AgentSlashed(uint256 indexed roundId, bytes32 indexed agentId, uint256 amount);
    event ReliabilityUpdated(bytes32 indexed agentId, uint256 newScore);

    // ============ State ============

    VibeAgentConsensus public consensus;
    address public owner;
    address public agent1Addr;
    address public agent2Addr;
    address public agent3Addr;

    bytes32 public constant AGENT1 = keccak256("agent-1");
    bytes32 public constant AGENT2 = keccak256("agent-2");
    bytes32 public constant AGENT3 = keccak256("agent-3");
    bytes32 public constant TOPIC = keccak256("price-oracle-btc-usd");

    uint256 public constant MIN_STAKE = 0.1 ether;
    // Set difficulty to max so any PoW hash passes — avoids brute forcing in tests
    uint256 public constant POW_DIFFICULTY = type(uint256).max;

    uint256 public constant COMMIT_DURATION = 30;
    uint256 public constant REVEAL_DURATION = 30;

    // ============ Setup ============

    function setUp() public {
        owner = address(this);
        agent1Addr = makeAddr("agent1Addr");
        agent2Addr = makeAddr("agent2Addr");
        agent3Addr = makeAddr("agent3Addr");

        vm.deal(agent1Addr, 100 ether);
        vm.deal(agent2Addr, 100 ether);
        vm.deal(agent3Addr, 100 ether);
        vm.deal(address(this), 100 ether);

        VibeAgentConsensus impl = new VibeAgentConsensus();
        bytes memory initData = abi.encodeWithSelector(
            VibeAgentConsensus.initialize.selector,
            MIN_STAKE,
            POW_DIFFICULTY
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        consensus = VibeAgentConsensus(payable(address(proxy)));
    }

    // ============ Helpers ============

    /// @dev Build a valid commit hash for (value, salt)
    function _commitHash(uint256 value, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(value, salt));
    }

    /// @dev Find a powNonce that satisfies the difficulty (trivial with difficulty = max)
    function _validPoWNonce(uint256 roundId, bytes32 agentId, uint256 value) internal pure returns (uint256) {
        // With POW_DIFFICULTY == type(uint256).max, nonce 0 always passes
        return 0;
    }

    function _createRound() internal returns (uint256 roundId) {
        roundId = consensus.createRound(TOPIC);
    }

    function _commitAgent(
        uint256 roundId,
        address sender,
        bytes32 agentId,
        uint256 value,
        bytes32 salt
    ) internal {
        bytes32 ch = _commitHash(value, salt);
        vm.prank(sender);
        consensus.commit{value: MIN_STAKE}(roundId, agentId, ch, 5000);
    }

    function _revealAgent(
        uint256 roundId,
        address sender,
        bytes32 agentId,
        uint256 value,
        bytes32 salt
    ) internal {
        uint256 nonce = _validPoWNonce(roundId, agentId, value);
        vm.prank(sender);
        consensus.reveal(roundId, agentId, value, salt, nonce);
    }

    // ============ Round Management ============

    function test_CreateRound() public {
        uint256 expectedDeadline = block.timestamp + COMMIT_DURATION;

        vm.expectEmit(true, false, false, true);
        emit RoundCreated(1, TOPIC, expectedDeadline);

        uint256 roundId = _createRound();
        assertEq(roundId, 1);
        assertEq(consensus.roundCount(), 1);

        VibeAgentConsensus.ConsensusRound memory r = consensus.getRound(roundId);
        assertEq(r.roundId, 1);
        assertEq(r.topic, TOPIC);
        assertEq(r.commitDeadline, expectedDeadline);
        assertEq(r.revealDeadline, expectedDeadline + REVEAL_DURATION);
        assertEq(r.participantCount, 0);
        assertEq(r.revealCount, 0);
        assertEq(uint8(r.status), uint8(VibeAgentConsensus.RoundStatus.COMMIT));
        assertFalse(r.finalized);
    }

    function test_CreateMultipleRounds() public {
        consensus.createRound(TOPIC);
        consensus.createRound(keccak256("another-topic"));
        assertEq(consensus.roundCount(), 2);
    }

    // ============ Commit Phase ============

    function test_Commit_Basic() public {
        uint256 roundId = _createRound();
        bytes32 salt = keccak256("secret-salt-1");
        uint256 value = 50000e18; // $50k BTC price

        vm.expectEmit(true, true, false, false);
        emit AgentCommitted(roundId, AGENT1);

        _commitAgent(roundId, agent1Addr, AGENT1, value, salt);

        VibeAgentConsensus.ConsensusRound memory r = consensus.getRound(roundId);
        assertEq(r.participantCount, 1);

        bytes32[] memory participants = consensus.getRoundParticipants(roundId);
        assertEq(participants.length, 1);
        assertEq(participants[0], AGENT1);
    }

    function test_Commit_MultipleAgents() public {
        uint256 roundId = _createRound();

        _commitAgent(roundId, agent1Addr, AGENT1, 50000e18, keccak256("salt1"));
        _commitAgent(roundId, agent2Addr, AGENT2, 51000e18, keccak256("salt2"));
        _commitAgent(roundId, agent3Addr, AGENT3, 49000e18, keccak256("salt3"));

        assertEq(consensus.getRound(roundId).participantCount, 3);
        assertEq(consensus.getRoundParticipants(roundId).length, 3);
    }

    function test_Commit_RejectsAfterDeadline() public {
        uint256 roundId = _createRound();
        vm.warp(block.timestamp + COMMIT_DURATION + 1);

        bytes32 ch = _commitHash(50000e18, keccak256("salt"));
        vm.prank(agent1Addr);
        vm.expectRevert("Commit phase ended");
        consensus.commit{value: MIN_STAKE}(roundId, AGENT1, ch, 5000);
    }

    function test_Commit_RejectsInsufficientStake() public {
        uint256 roundId = _createRound();

        bytes32 ch = _commitHash(50000e18, keccak256("salt"));
        vm.prank(agent1Addr);
        vm.expectRevert("Insufficient stake");
        consensus.commit{value: MIN_STAKE - 1}(roundId, AGENT1, ch, 5000);
    }

    function test_Commit_RejectsDuplicateCommit() public {
        uint256 roundId = _createRound();
        bytes32 salt = keccak256("salt");

        _commitAgent(roundId, agent1Addr, AGENT1, 50000e18, salt);

        bytes32 ch = _commitHash(50000e18, salt);
        vm.prank(agent1Addr);
        vm.expectRevert("Already committed");
        consensus.commit{value: MIN_STAKE}(roundId, AGENT1, ch, 5000);
    }

    // ============ Reveal Phase ============

    function test_Reveal_Basic() public {
        uint256 roundId = _createRound();
        uint256 value = 50000e18;
        bytes32 salt = keccak256("salt1");

        _commitAgent(roundId, agent1Addr, AGENT1, value, salt);

        // Advance past commit deadline
        vm.warp(block.timestamp + COMMIT_DURATION + 1);

        vm.expectEmit(true, true, false, true);
        emit AgentRevealed(roundId, AGENT1, value);

        _revealAgent(roundId, agent1Addr, AGENT1, value, salt);

        VibeAgentConsensus.ConsensusRound memory r = consensus.getRound(roundId);
        assertEq(r.revealCount, 1);

        // Reliability updated
        assertEq(consensus.getReliability(AGENT1).roundsCompleted, 1);
    }

    function test_Reveal_RejectsDuringCommitPhase() public {
        uint256 roundId = _createRound();
        uint256 value = 50000e18;
        bytes32 salt = keccak256("salt1");

        _commitAgent(roundId, agent1Addr, AGENT1, value, salt);

        // Still in commit phase
        vm.prank(agent1Addr);
        vm.expectRevert("Commit phase active");
        consensus.reveal(roundId, AGENT1, value, salt, 0);
    }

    function test_Reveal_RejectsAfterRevealDeadline() public {
        uint256 roundId = _createRound();
        uint256 value = 50000e18;
        bytes32 salt = keccak256("salt1");

        _commitAgent(roundId, agent1Addr, AGENT1, value, salt);

        // Advance past both commit and reveal deadlines
        vm.warp(block.timestamp + COMMIT_DURATION + REVEAL_DURATION + 1);

        vm.prank(agent1Addr);
        vm.expectRevert("Reveal phase ended");
        consensus.reveal(roundId, AGENT1, value, salt, 0);
    }

    function test_Reveal_RejectsWithoutCommit() public {
        uint256 roundId = _createRound();
        vm.warp(block.timestamp + COMMIT_DURATION + 1);

        vm.prank(agent1Addr);
        vm.expectRevert("Not committed");
        consensus.reveal(roundId, AGENT1, 50000e18, keccak256("salt"), 0);
    }

    function test_Reveal_RejectsInvalidHash() public {
        uint256 roundId = _createRound();
        uint256 value = 50000e18;
        bytes32 salt = keccak256("salt1");

        _commitAgent(roundId, agent1Addr, AGENT1, value, salt);
        vm.warp(block.timestamp + COMMIT_DURATION + 1);

        vm.prank(agent1Addr);
        vm.expectRevert("Invalid reveal");
        // Reveal with wrong value
        consensus.reveal(roundId, AGENT1, value + 1, salt, 0);
    }

    function test_Reveal_RejectsDoubleReveal() public {
        uint256 roundId = _createRound();
        uint256 value = 50000e18;
        bytes32 salt = keccak256("salt1");

        _commitAgent(roundId, agent1Addr, AGENT1, value, salt);
        vm.warp(block.timestamp + COMMIT_DURATION + 1);

        _revealAgent(roundId, agent1Addr, AGENT1, value, salt);

        vm.prank(agent1Addr);
        vm.expectRevert("Already revealed");
        consensus.reveal(roundId, AGENT1, value, salt, 0);
    }

    function test_Reveal_InvalidPoW() public {
        // Deploy a new consensus with non-trivial difficulty
        VibeAgentConsensus impl2 = new VibeAgentConsensus();
        bytes memory initData2 = abi.encodeWithSelector(
            VibeAgentConsensus.initialize.selector,
            MIN_STAKE,
            uint256(1) // extremely tight difficulty: only passes if hash < 1 (essentially impossible)
        );
        ERC1967Proxy proxy2 = new ERC1967Proxy(address(impl2), initData2);
        VibeAgentConsensus strictConsensus = VibeAgentConsensus(payable(address(proxy2)));

        uint256 roundId = strictConsensus.createRound(TOPIC);
        uint256 value = 50000e18;
        bytes32 salt = keccak256("salt1");
        bytes32 ch = _commitHash(value, salt);

        vm.prank(agent1Addr);
        strictConsensus.commit{value: MIN_STAKE}(roundId, AGENT1, ch, 5000);

        vm.warp(block.timestamp + COMMIT_DURATION + 1);

        vm.prank(agent1Addr);
        vm.expectRevert("Invalid PoW");
        strictConsensus.reveal(roundId, AGENT1, value, salt, 0);
    }

    // ============ Finalization ============

    function test_Finalize_SingleAgent() public {
        uint256 roundId = _createRound();
        uint256 value = 50000e18;
        bytes32 salt = keccak256("salt1");

        _commitAgent(roundId, agent1Addr, AGENT1, value, salt);
        vm.warp(block.timestamp + COMMIT_DURATION + 1);
        _revealAgent(roundId, agent1Addr, AGENT1, value, salt);

        // Advance past reveal deadline
        vm.warp(block.timestamp + REVEAL_DURATION + 1);

        vm.expectEmit(true, false, false, true);
        emit ConsensusReached(roundId, value, 1);

        consensus.finalize(roundId);

        VibeAgentConsensus.ConsensusRound memory r = consensus.getRound(roundId);
        assertTrue(r.finalized);
        assertEq(uint8(r.status), uint8(VibeAgentConsensus.RoundStatus.COMPLETE));
        assertEq(r.consensusValue, value);
        assertEq(consensus.totalRoundsCompleted(), 1);
    }

    function test_Finalize_MultipleAgents_WeightedConsensus() public {
        uint256 roundId = _createRound();

        uint256 val1 = 50000e18;
        uint256 val2 = 52000e18;
        bytes32 salt1 = keccak256("salt1");
        bytes32 salt2 = keccak256("salt2");

        _commitAgent(roundId, agent1Addr, AGENT1, val1, salt1);
        _commitAgent(roundId, agent2Addr, AGENT2, val2, salt2);

        vm.warp(block.timestamp + COMMIT_DURATION + 1);

        _revealAgent(roundId, agent1Addr, AGENT1, val1, salt1);
        _revealAgent(roundId, agent2Addr, AGENT2, val2, salt2);

        vm.warp(block.timestamp + REVEAL_DURATION + 1);

        consensus.finalize(roundId);

        VibeAgentConsensus.ConsensusRound memory r = consensus.getRound(roundId);
        // Consensus value should be between val1 and val2 (weighted average)
        assertGt(r.consensusValue, 0);
        assertGe(r.consensusValue, val1);
        assertLe(r.consensusValue, val2);
    }

    function test_Finalize_Timeout_NoReveals() public {
        uint256 roundId = _createRound();
        bytes32 salt = keccak256("salt1");

        // Commit but do NOT reveal
        _commitAgent(roundId, agent1Addr, AGENT1, 50000e18, salt);

        // Advance past both phases
        vm.warp(block.timestamp + COMMIT_DURATION + REVEAL_DURATION + 1);

        vm.expectEmit(true, false, false, false);
        emit RoundTimedOut(roundId);

        consensus.finalize(roundId);

        VibeAgentConsensus.ConsensusRound memory r = consensus.getRound(roundId);
        assertTrue(r.finalized);
        assertEq(uint8(r.status), uint8(VibeAgentConsensus.RoundStatus.TIMEOUT));
        assertEq(consensus.totalRoundsTimedOut(), 1);
    }

    function test_Finalize_SlashesNonRevealers() public {
        uint256 roundId = _createRound();

        bytes32 salt1 = keccak256("salt1");
        bytes32 salt2 = keccak256("salt2");

        // Agent1 commits and reveals; Agent2 commits but does NOT reveal
        _commitAgent(roundId, agent1Addr, AGENT1, 50000e18, salt1);
        _commitAgent(roundId, agent2Addr, AGENT2, 51000e18, salt2);

        vm.warp(block.timestamp + COMMIT_DURATION + 1);
        _revealAgent(roundId, agent1Addr, AGENT1, 50000e18, salt1);
        // Agent2 does not reveal

        vm.warp(block.timestamp + REVEAL_DURATION + 1);

        // Should slash AGENT2
        vm.expectEmit(true, true, false, false);
        emit AgentSlashed(roundId, AGENT2, (MIN_STAKE * 1000) / 10000);

        consensus.finalize(roundId);

        assertGt(consensus.totalSlashed(), 0);
        assertEq(consensus.getReliability(AGENT2).roundsTimedOut, 1);
    }

    function test_Finalize_RejectsDuringRevealPhase() public {
        uint256 roundId = _createRound();
        uint256 value = 50000e18;
        bytes32 salt = keccak256("salt1");

        _commitAgent(roundId, agent1Addr, AGENT1, value, salt);
        vm.warp(block.timestamp + COMMIT_DURATION + 1);
        _revealAgent(roundId, agent1Addr, AGENT1, value, salt);

        // Still in reveal phase
        vm.expectRevert("Reveal phase active");
        consensus.finalize(roundId);
    }

    function test_Finalize_RejectsDoubleFinalization() public {
        uint256 roundId = _createRound();
        uint256 value = 50000e18;
        bytes32 salt = keccak256("salt1");

        _commitAgent(roundId, agent1Addr, AGENT1, value, salt);
        vm.warp(block.timestamp + COMMIT_DURATION + 1);
        _revealAgent(roundId, agent1Addr, AGENT1, value, salt);
        vm.warp(block.timestamp + REVEAL_DURATION + 1);

        consensus.finalize(roundId);

        vm.expectRevert("Already finalized");
        consensus.finalize(roundId);
    }

    // ============ Reliability Tracking ============

    function test_ReliabilityScore_PerfectParticipation() public {
        // Agent reveals in two rounds → reliability = 100%
        for (uint256 i = 0; i < 2; i++) {
            uint256 roundId = consensus.createRound(TOPIC);
            bytes32 salt = keccak256(abi.encodePacked("salt", i));
            uint256 value = 50000e18;

            _commitAgent(roundId, agent1Addr, AGENT1, value, salt);
            vm.warp(block.timestamp + COMMIT_DURATION + 1);
            _revealAgent(roundId, agent1Addr, AGENT1, value, salt);
            vm.warp(block.timestamp + REVEAL_DURATION + 1);
            consensus.finalize(roundId);

            // Re-set time for next round
            vm.warp(block.timestamp + 1);
        }

        VibeAgentConsensus.AgentReliability memory rel = consensus.getReliability(AGENT1);
        assertEq(rel.roundsParticipated, 2);
        assertEq(rel.roundsCompleted, 2);
        assertEq(rel.reliabilityScore, 10000); // 100%
    }

    function test_ReliabilityScore_AfterSlash() public {
        // Commit but never reveal → timed out
        uint256 roundId = _createRound();
        bytes32 salt = keccak256("salt1");
        _commitAgent(roundId, agent1Addr, AGENT1, 50000e18, salt);

        vm.warp(block.timestamp + COMMIT_DURATION + REVEAL_DURATION + 1);
        consensus.finalize(roundId);

        VibeAgentConsensus.AgentReliability memory rel = consensus.getReliability(AGENT1);
        assertEq(rel.roundsTimedOut, 1);
        // participated=1, completed=0 → reliability=0
        assertEq(rel.reliabilityScore, 0);
    }

    // ============ Admin ============

    function test_SetPowDifficulty() public {
        consensus.setPowDifficulty(12345);
        assertEq(consensus.powDifficulty(), 12345);
    }

    function test_SetPowDifficulty_OnlyOwner() public {
        vm.prank(agent1Addr);
        vm.expectRevert();
        consensus.setPowDifficulty(12345);
    }

    function test_SetMinStake() public {
        consensus.setMinStake(1 ether);
        assertEq(consensus.minStake(), 1 ether);
    }

    function test_SetSlashBps() public {
        consensus.setSlashBps(2000);
        assertEq(consensus.slashBps(), 2000);
    }

    function test_SetSlashBps_RejectsOver5000() public {
        vm.expectRevert();
        consensus.setSlashBps(5001);
    }

    // ============ View Functions ============

    function test_GetRoundCount() public {
        assertEq(consensus.getRoundCount(), 0);
        consensus.createRound(TOPIC);
        assertEq(consensus.getRoundCount(), 1);
    }

    function test_GetRoundParticipants_Empty() public {
        uint256 roundId = _createRound();
        bytes32[] memory participants = consensus.getRoundParticipants(roundId);
        assertEq(participants.length, 0);
    }

    function test_GetReliability_DefaultValues() public view {
        VibeAgentConsensus.AgentReliability memory rel = consensus.getReliability(AGENT1);
        assertEq(rel.roundsParticipated, 0);
        assertEq(rel.roundsCompleted, 0);
        assertEq(rel.reliabilityScore, 0);
    }

    // ============ Stake Return — Regression tests for C12-AUDIT-1 (CRIT) ============
    //
    // Previously _returnStakes sent ALL revealed-agent stakes to msg.sender of finalize()
    // instead of to the committer. Any finalizer could drain the full batch.

    function test_StakeReturn_GoesToCommitter_NotFinalizer() public {
        uint256 roundId = _createRound();
        uint256 value = 50000e18;
        bytes32 salt = keccak256("salt-1");

        uint256 committerStart = agent1Addr.balance;

        _commitAgent(roundId, agent1Addr, AGENT1, value, salt);
        vm.warp(block.timestamp + COMMIT_DURATION + 1);
        _revealAgent(roundId, agent1Addr, AGENT1, value, salt);
        vm.warp(block.timestamp + REVEAL_DURATION + 1);

        // Some unrelated EOA finalizes. Prior to fix, this address would have received the stake.
        address finalizer = makeAddr("opportunistic-finalizer");
        vm.deal(finalizer, 0);

        vm.prank(finalizer);
        consensus.finalize(roundId);

        assertEq(finalizer.balance, 0, "finalizer must NOT receive stake");
        assertEq(agent1Addr.balance, committerStart, "committer must be made whole");
    }

    function test_StakeReturn_MultipleCommitters_EachGetsOwnStake() public {
        uint256 roundId = _createRound();
        bytes32 salt1 = keccak256("s1");
        bytes32 salt2 = keccak256("s2");

        uint256 start1 = agent1Addr.balance;
        uint256 start2 = agent2Addr.balance;

        _commitAgent(roundId, agent1Addr, AGENT1, 50000e18, salt1);
        _commitAgent(roundId, agent2Addr, AGENT2, 51000e18, salt2);

        vm.warp(block.timestamp + COMMIT_DURATION + 1);
        _revealAgent(roundId, agent1Addr, AGENT1, 50000e18, salt1);
        _revealAgent(roundId, agent2Addr, AGENT2, 51000e18, salt2);
        vm.warp(block.timestamp + REVEAL_DURATION + 1);

        address finalizer = makeAddr("finalizer");
        vm.prank(finalizer);
        consensus.finalize(roundId);

        assertEq(agent1Addr.balance, start1, "agent1 whole");
        assertEq(agent2Addr.balance, start2, "agent2 whole");
        assertEq(finalizer.balance, 0, "finalizer gets nothing");
    }

    function test_StakeReturn_SlashedAgent_NotRefunded() public {
        uint256 roundId = _createRound();
        bytes32 salt1 = keccak256("s1");
        bytes32 salt2 = keccak256("s2");

        uint256 start2 = agent2Addr.balance;

        _commitAgent(roundId, agent1Addr, AGENT1, 50000e18, salt1);
        _commitAgent(roundId, agent2Addr, AGENT2, 51000e18, salt2);

        vm.warp(block.timestamp + COMMIT_DURATION + 1);
        _revealAgent(roundId, agent1Addr, AGENT1, 50000e18, salt1);
        // agent2 does NOT reveal
        vm.warp(block.timestamp + REVEAL_DURATION + 1);

        consensus.finalize(roundId);

        // agent2 stake is locked by the slash — stays in contract, does not flow back
        assertEq(agent2Addr.balance, start2 - MIN_STAKE, "non-revealer stays short");
    }

    // ============ Fuzz ============

    function testFuzz_Commit_StakeRange(uint256 stake) public {
        stake = bound(stake, MIN_STAKE, 10 ether);
        vm.deal(agent1Addr, stake + 1 ether);

        uint256 roundId = _createRound();
        bytes32 ch = _commitHash(50000e18, keccak256("salt"));

        vm.prank(agent1Addr);
        consensus.commit{value: stake}(roundId, AGENT1, ch, 5000);

        assertEq(consensus.getRound(roundId).participantCount, 1);
    }

    function testFuzz_ConsensusValue_SingleAgent(uint256 value) public {
        value = bound(value, 1, type(uint128).max); // avoid overflow in weighted sum

        uint256 roundId = _createRound();
        bytes32 salt = keccak256("fuzz-salt");

        _commitAgent(roundId, agent1Addr, AGENT1, value, salt);
        vm.warp(block.timestamp + COMMIT_DURATION + 1);
        _revealAgent(roundId, agent1Addr, AGENT1, value, salt);
        vm.warp(block.timestamp + REVEAL_DURATION + 1);

        consensus.finalize(roundId);

        // Single agent: consensus == their value
        assertEq(consensus.getRound(roundId).consensusValue, value);
    }
}
