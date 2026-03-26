// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/agents/VibeAgentReputation.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Test Contract ============

contract VibeAgentReputationTest is Test {
    // ============ Re-declare Events ============

    event ReputationInitialized(bytes32 indexed agentId);
    event ReputationUpdated(bytes32 indexed agentId, uint256 dimension, uint256 newScore, uint256 compositeScore);
    event TierChanged(bytes32 indexed agentId, VibeAgentReputation.ReputationTier oldTier, VibeAgentReputation.ReputationTier newTier);
    event AgentEndorsed(bytes32 indexed fromAgent, bytes32 indexed toAgent, uint256 dimension, uint256 weight);

    // ============ State ============

    VibeAgentReputation public rep;
    bytes32 public agent1;
    bytes32 public agent2;
    bytes32 public agent3;

    // ============ Setup ============

    function setUp() public {
        VibeAgentReputation impl = new VibeAgentReputation();
        bytes memory initData = abi.encodeWithSelector(VibeAgentReputation.initialize.selector);
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        rep = VibeAgentReputation(payable(address(proxy)));

        agent1 = keccak256("agent1");
        agent2 = keccak256("agent2");
        agent3 = keccak256("agent3");
    }

    // ============ Helpers ============

    function _initAgent(bytes32 agentId) internal {
        rep.initializeReputation(agentId);
    }

    // ============ Initialization ============

    function test_initializeReputation_success() public {
        _initAgent(agent1);

        VibeAgentReputation.AgentReputation memory r = rep.getReputation(agent1);
        assertEq(r.agentId, agent1);
        assertEq(r.taskScore, 5000);
        assertEq(r.tradingScore, 5000);
        assertEq(r.consensusScore, 5000);
        assertEq(r.securityScore, 5000);
        assertEq(r.memoryScore, 5000);
        assertEq(r.socialScore, 5000);
        assertEq(r.compositeScore, 5000);
        assertEq(uint8(r.tier), uint8(VibeAgentReputation.ReputationTier.NOVICE));
        assertTrue(r.active);
        assertEq(r.totalInteractions, 0);
    }

    function test_initializeReputation_emitsEvent() public {
        vm.expectEmit(true, false, false, false);
        emit ReputationInitialized(agent1);
        _initAgent(agent1);
    }

    function test_initializeReputation_revert_duplicate() public {
        _initAgent(agent1);

        vm.expectRevert("Already initialized");
        _initAgent(agent1);
    }

    function test_initializeReputation_incrementsCount() public {
        assertEq(rep.totalAgents(), 0);
        _initAgent(agent1);
        assertEq(rep.totalAgents(), 1);
        _initAgent(agent2);
        assertEq(rep.totalAgents(), 2);
    }

    // ============ Score Updates ============

    function test_updateScore_taskDimension() public {
        _initAgent(agent1);

        // EMA: alpha=200/10000=2%. score = 0.02 * 10000 + 0.98 * 5000 = 200 + 4900 = 5100
        rep.updateScore(agent1, 0, 10000);

        VibeAgentReputation.AgentReputation memory r = rep.getReputation(agent1);
        assertEq(r.taskScore, 5100);
        assertEq(r.totalInteractions, 1);
    }

    function test_updateScore_tradingDimension() public {
        _initAgent(agent1);

        rep.updateScore(agent1, 1, 10000);
        assertEq(rep.getReputation(agent1).tradingScore, 5100);
    }

    function test_updateScore_consensusDimension() public {
        _initAgent(agent1);

        rep.updateScore(agent1, 2, 10000);
        assertEq(rep.getReputation(agent1).consensusScore, 5100);
    }

    function test_updateScore_securityDimension() public {
        _initAgent(agent1);

        rep.updateScore(agent1, 3, 10000);
        assertEq(rep.getReputation(agent1).securityScore, 5100);
    }

    function test_updateScore_memoryDimension() public {
        _initAgent(agent1);

        rep.updateScore(agent1, 4, 10000);
        assertEq(rep.getReputation(agent1).memoryScore, 5100);
    }

    function test_updateScore_socialDimension() public {
        _initAgent(agent1);

        rep.updateScore(agent1, 5, 10000);
        assertEq(rep.getReputation(agent1).socialScore, 5100);
    }

    function test_updateScore_multipleUpdatesConverge() public {
        _initAgent(agent1);

        // Push task score toward 10000 with many updates
        for (uint256 i = 0; i < 50; i++) {
            rep.updateScore(agent1, 0, 10000);
        }

        // Score should be higher than initial but less than 10000
        uint256 taskScore = rep.getReputation(agent1).taskScore;
        assertGt(taskScore, 5000);
        assertLe(taskScore, 10000);
    }

    function test_updateScore_revert_notInitialized() public {
        vm.expectRevert("Not initialized");
        rep.updateScore(agent1, 0, 5000);
    }

    function test_updateScore_revert_invalidScore() public {
        _initAgent(agent1);

        vm.expectRevert("Invalid score");
        rep.updateScore(agent1, 0, 10001);
    }

    function test_updateScore_revert_invalidDimension() public {
        _initAgent(agent1);

        vm.expectRevert("Invalid dimension");
        rep.updateScore(agent1, 6, 5000);
    }

    function test_updateScore_recomputesComposite() public {
        _initAgent(agent1);

        // All dimensions at 5000, push task (dim 0) higher
        rep.updateScore(agent1, 0, 10000);

        // Composite should be slightly above 5000 due to task score increasing
        // Task weight = 2500/10000
        // New task score = 5100
        // composite = (5100*2500 + 5000*2000 + 5000*1500 + 5000*1500 + 5000*1000 + 5000*1500) / 10000
        //           = (12750000 + 10000000 + 7500000 + 7500000 + 5000000 + 7500000) / 10000
        //           = 50250000 / 10000 = 5025
        assertEq(rep.getReputation(agent1).compositeScore, 5025);
    }

    function test_updateScore_incrementsStats() public {
        _initAgent(agent1);

        assertEq(rep.totalUpdates(), 0);
        rep.updateScore(agent1, 0, 7000);
        assertEq(rep.totalUpdates(), 1);
    }

    function test_updateScore_zeroScore() public {
        _initAgent(agent1);

        // EMA: 0.02 * 0 + 0.98 * 5000 = 4900
        rep.updateScore(agent1, 0, 0);
        assertEq(rep.getReputation(agent1).taskScore, 4900);
    }

    // ============ Tier Changes ============

    function test_tier_provenThreshold() public {
        _initAgent(agent1);

        // Initial composite is 5000 which is >= EXPERT_THRESHOLD(5000)
        // Actually, let's check what tier it initializes as
        // composite = 5000 * (2500+2000+1500+1500+1000+1500) / 10000 = 5000 * 10000 / 10000 = 5000
        // 5000 >= EXPERT_THRESHOLD(5000) => tier should be EXPERT after recompute
        // But initialize doesn't call _recomputeComposite, so tier stays NOVICE
        assertEq(uint8(rep.getTier(agent1)), uint8(VibeAgentReputation.ReputationTier.NOVICE));

        // Trigger a score update to recompute composite
        rep.updateScore(agent1, 0, 5000); // Same score, no change
        // After recompute: composite = ~5000, >= EXPERT_THRESHOLD
        assertEq(uint8(rep.getTier(agent1)), uint8(VibeAgentReputation.ReputationTier.EXPERT));
    }

    function test_tier_masterThreshold() public {
        _initAgent(agent1);

        // Push all scores to 7500+
        for (uint256 i = 0; i < 200; i++) {
            for (uint256 d = 0; d <= 5; d++) {
                rep.updateScore(agent1, d, 10000);
            }
        }

        VibeAgentReputation.AgentReputation memory r = rep.getReputation(agent1);
        assertGe(r.compositeScore, 7500);
        assertEq(uint8(r.tier), uint8(VibeAgentReputation.ReputationTier.MASTER));
    }

    function test_tier_emitsTierChangedEvent() public {
        _initAgent(agent1);

        // First update triggers tier evaluation from NOVICE to EXPERT (composite ~5000)
        vm.expectEmit(true, false, false, true);
        emit TierChanged(agent1, VibeAgentReputation.ReputationTier.NOVICE, VibeAgentReputation.ReputationTier.EXPERT);
        rep.updateScore(agent1, 0, 5000);
    }

    // ============ Endorsements ============

    function test_endorse_success() public {
        _initAgent(agent1);
        _initAgent(agent2);

        rep.endorse(agent1, agent2, 0, 500);

        assertEq(rep.endorsementCount(agent2), 1);
        assertEq(rep.totalEndorsements(), 1);
    }

    function test_endorse_boostsSocialScore() public {
        _initAgent(agent1);
        _initAgent(agent2);

        uint256 socialBefore = rep.getReputation(agent2).socialScore;

        rep.endorse(agent1, agent2, 0, 500);

        uint256 socialAfter = rep.getReputation(agent2).socialScore;
        assertGt(socialAfter, socialBefore);
    }

    function test_endorse_emitsEvent() public {
        _initAgent(agent1);
        _initAgent(agent2);

        vm.expectEmit(true, true, false, true);
        emit AgentEndorsed(agent1, agent2, 0, 500);
        rep.endorse(agent1, agent2, 0, 500);
    }

    function test_endorse_revert_selfEndorse() public {
        _initAgent(agent1);

        vm.expectRevert("Self-endorse");
        rep.endorse(agent1, agent1, 0, 500);
    }

    function test_endorse_revert_notActive() public {
        _initAgent(agent1);
        // agent2 not initialized

        vm.expectRevert("Agents not active");
        rep.endorse(agent1, agent2, 0, 500);
    }

    function test_endorse_revert_invalidWeight() public {
        _initAgent(agent1);
        _initAgent(agent2);

        vm.expectRevert("Invalid weight");
        rep.endorse(agent1, agent2, 0, 0);

        vm.expectRevert("Invalid weight");
        rep.endorse(agent1, agent2, 0, 1001);
    }

    function test_endorse_revert_invalidDimension() public {
        _initAgent(agent1);
        _initAgent(agent2);

        vm.expectRevert("Invalid dimension");
        rep.endorse(agent1, agent2, 6, 500);
    }

    function test_endorse_revert_doubleEndorse() public {
        _initAgent(agent1);
        _initAgent(agent2);

        rep.endorse(agent1, agent2, 0, 500);

        vm.expectRevert("Already endorsed");
        rep.endorse(agent1, agent2, 0, 500);
    }

    function test_endorse_differentDimensionsAllowed() public {
        _initAgent(agent1);
        _initAgent(agent2);

        rep.endorse(agent1, agent2, 0, 500);
        rep.endorse(agent1, agent2, 1, 500);
        rep.endorse(agent1, agent2, 2, 500);

        assertEq(rep.endorsementCount(agent2), 3);
    }

    function test_endorse_socialScoreCappedAt10000() public {
        _initAgent(agent1);
        _initAgent(agent2);

        // Endorse from all 6 dimensions with max weight
        for (uint256 d = 0; d <= 5; d++) {
            rep.endorse(agent1, agent2, d, 1000);
        }

        assertLe(rep.getReputation(agent2).socialScore, 10000);
    }

    // ============ Composite Score Weights ============

    function test_weights_sumTo10000() public {
        uint256 sum = rep.TASK_WEIGHT() + rep.TRADING_WEIGHT() + rep.CONSENSUS_WEIGHT()
            + rep.SECURITY_WEIGHT() + rep.MEMORY_WEIGHT() + rep.SOCIAL_WEIGHT();
        assertEq(sum, 10000);
    }

    function test_constants_thresholdsOrdered() public {
        assertLt(rep.PROVEN_THRESHOLD(), rep.EXPERT_THRESHOLD());
        assertLt(rep.EXPERT_THRESHOLD(), rep.MASTER_THRESHOLD());
        assertLt(rep.MASTER_THRESHOLD(), rep.LEGENDARY_THRESHOLD());
    }

    // ============ View Functions ============

    function test_getCompositeScore() public {
        _initAgent(agent1);
        // Not yet recomputed via updateScore, composite was set in initialize
        assertEq(rep.getCompositeScore(agent1), 5000);
    }

    function test_getTier() public {
        _initAgent(agent1);
        assertEq(uint8(rep.getTier(agent1)), uint8(VibeAgentReputation.ReputationTier.NOVICE));
    }

    function test_getAgentCount() public {
        assertEq(rep.getAgentCount(), 0);
        _initAgent(agent1);
        assertEq(rep.getAgentCount(), 1);
    }

    function test_receiveEther() public {
        (bool ok, ) = address(rep).call{value: 1 ether}("");
        assertTrue(ok);
    }

    // ============ Fuzz Tests ============

    function testFuzz_updateScore_anyValidInput(uint256 dimension, uint256 score) public {
        dimension = bound(dimension, 0, 5);
        score = bound(score, 0, 10000);

        _initAgent(agent1);
        rep.updateScore(agent1, dimension, score);

        // Composite should still be valid
        assertLe(rep.getCompositeScore(agent1), 10000);
    }

    function testFuzz_endorse_anyValidWeight(uint256 weight) public {
        weight = bound(weight, 1, 1000);

        _initAgent(agent1);
        _initAgent(agent2);

        rep.endorse(agent1, agent2, 0, weight);
        assertEq(rep.endorsementCount(agent2), 1);
    }

    function testFuzz_emaSmoothing_bounded(uint256 newDataPoint) public {
        newDataPoint = bound(newDataPoint, 0, 10000);
        _initAgent(agent1);

        rep.updateScore(agent1, 0, newDataPoint);

        // EMA result: 0.02 * newDataPoint + 0.98 * 5000
        // Min: 0 + 4900 = 4900
        // Max: 200 + 4900 = 5100
        uint256 taskScore = rep.getReputation(agent1).taskScore;
        assertGe(taskScore, 4900);
        assertLe(taskScore, 5100);
    }
}
