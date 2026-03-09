// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/compute/ComputeSubsidyManager.sol";
import "../../contracts/compute/IComputeSubsidy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Mock JOULE Token ============
contract MockJoule is ERC20 {
    constructor() ERC20("Joule", "JUL") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Mock Reputation Oracle ============
contract MockReputationOracle {
    mapping(address => uint256) public scores;

    function setScore(address user, uint256 score) external { scores[user] = score; }
    function getTrustScore(address user) external view returns (uint256) { return scores[user]; }
    function getTrustTier(address user) external view returns (uint8) {
        uint256 s = scores[user];
        if (s >= 8000) return 4;
        if (s >= 6000) return 3;
        if (s >= 4000) return 2;
        if (s >= 2000) return 1;
        return 0;
    }
    function isEligible(address user, uint8 requiredTier) external view returns (bool) {
        return this.getTrustTier(user) >= requiredTier;
    }
}

// ============ Tests ============
contract ComputeSubsidyTest is Test {
    ComputeSubsidyManager public manager;
    MockJoule public joule;
    MockReputationOracle public oracle;

    address public owner = address(0xCAFE);
    address public agent1 = address(0x1);
    address public agent2 = address(0x2);
    address public rater = address(0x3);
    address public funder = address(0x4);

    uint256 constant WAD = 1e18;
    uint256 constant BASE_COST = 100 * WAD; // 100 JOULE per job

    function setUp() public {
        joule = new MockJoule();
        oracle = new MockReputationOracle();

        // Deploy implementation + proxy
        ComputeSubsidyManager impl = new ComputeSubsidyManager();
        bytes memory initData = abi.encodeWithSelector(
            ComputeSubsidyManager.initialize.selector,
            address(joule),
            address(oracle),
            address(0), // no agent registry for tests
            owner
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        manager = ComputeSubsidyManager(address(proxy));

        // Setup rater
        vm.prank(owner);
        manager.setAuthorizedRater(rater, true);

        // Fund agents with JOULE
        joule.mint(agent1, 10_000 * WAD);
        joule.mint(agent2, 10_000 * WAD);
        joule.mint(funder, 100_000 * WAD);

        // Approve manager
        vm.prank(agent1);
        joule.approve(address(manager), type(uint256).max);
        vm.prank(agent2);
        joule.approve(address(manager), type(uint256).max);
        vm.prank(funder);
        joule.approve(address(manager), type(uint256).max);

        // Fund the subsidy pool
        vm.prank(funder);
        manager.fundPool(50_000 * WAD);
    }

    // ============ Subsidy Curve Tests ============

    function test_subsidyMultiplier_zeroRep() public view {
        uint256 mult = manager.getSubsidyMultiplier(0);
        assertEq(mult, WAD, "0 rep should be 1.0x (full price)");
    }

    function test_subsidyMultiplier_maxRep() public view {
        uint256 mult = manager.getSubsidyMultiplier(10_000);
        assertEq(mult, WAD / 10, "Max rep should be 0.1x (90% subsidy)");
    }

    function test_subsidyMultiplier_midRep() public view {
        uint256 mult = manager.getSubsidyMultiplier(5_000);
        // At rep=5000 (50%), should be ~0.55x (45% subsidy)
        // Allow 10% tolerance for integer approximation
        assertGt(mult, WAD * 20 / 100, "Mid rep should be > 0.20x");
        assertLt(mult, WAD * 70 / 100, "Mid rep should be < 0.70x");
    }

    function test_subsidyMultiplier_monotonic() public view {
        uint256 prev = manager.getSubsidyMultiplier(0);
        for (uint256 rep = 1000; rep <= 10_000; rep += 1000) {
            uint256 curr = manager.getSubsidyMultiplier(rep);
            assertLt(curr, prev, "Multiplier should decrease as rep increases");
            prev = curr;
        }
    }

    function test_subsidyMultiplier_logarithmicShape() public view {
        // Verify logarithmic shape: early reputation gains yield bigger subsidies
        uint256 mult0 = manager.getSubsidyMultiplier(0);
        uint256 mult2500 = manager.getSubsidyMultiplier(2500);
        uint256 mult5000 = manager.getSubsidyMultiplier(5000);
        uint256 mult7500 = manager.getSubsidyMultiplier(7500);

        // First 25% of rep should yield more subsidy than last 25%
        uint256 earlyGain = mult0 - mult2500;
        uint256 lateGain = mult5000 - mult7500;
        assertGt(earlyGain, lateGain, "Logarithmic: early rep gains should yield bigger subsidies");
    }

    // ============ Job Lifecycle Tests ============

    function test_submitJob_noRep() public {
        // Agent with 0 rep pays full price
        oracle.setScore(agent1, 0);

        uint256 balBefore = joule.balanceOf(agent1);
        vm.prank(agent1);
        bytes32 jobId = manager.submitJob(BASE_COST);

        uint256 balAfter = joule.balanceOf(agent1);
        assertEq(balBefore - balAfter, BASE_COST, "Should pay full cost with 0 rep");

        IComputeSubsidy.ComputeJob memory job = manager.getJob(jobId);
        assertEq(uint8(job.status), uint8(IComputeSubsidy.JobStatus.ACTIVE));
        assertEq(job.baseCost, BASE_COST);
        assertEq(job.subsidyAmount, 0);
    }

    function test_submitJob_withRep() public {
        // Agent with 5000 rep gets ~45% subsidy
        oracle.setScore(agent1, 5000);

        uint256 balBefore = joule.balanceOf(agent1);
        uint256 poolBefore = manager.getPoolState().balance;

        vm.prank(agent1);
        bytes32 jobId = manager.submitJob(BASE_COST);

        uint256 balAfter = joule.balanceOf(agent1);
        uint256 poolAfter = manager.getPoolState().balance;
        uint256 paid = balBefore - balAfter;

        // Should pay significantly less than full cost
        assertLt(paid, BASE_COST, "Should pay less with 5000 rep");
        assertGt(paid, BASE_COST / 5, "Should still pay something");

        // Pool should decrease by subsidy amount
        IComputeSubsidy.ComputeJob memory job = manager.getJob(jobId);
        assertEq(poolBefore - poolAfter, job.subsidyAmount, "Pool should decrease by subsidy");
        assertEq(paid, job.subsidizedCost, "Agent paid should equal subsidized cost");
    }

    function test_submitJob_maxRep() public {
        // Agent with max rep pays 10% (90% subsidized)
        oracle.setScore(agent1, 10_000);

        uint256 balBefore = joule.balanceOf(agent1);
        vm.prank(agent1);
        manager.submitJob(BASE_COST);
        uint256 paid = balBefore - joule.balanceOf(agent1);

        assertEq(paid, BASE_COST / 10, "Max rep should pay 10%");
    }

    function test_completeJob() public {
        oracle.setScore(agent1, 3000);

        vm.prank(agent1);
        bytes32 jobId = manager.submitJob(BASE_COST);

        vm.prank(rater);
        manager.completeJob(jobId, 85);

        IComputeSubsidy.ComputeJob memory job = manager.getJob(jobId);
        assertEq(uint8(job.status), uint8(IComputeSubsidy.JobStatus.COMPLETED));
        assertEq(job.qualityRating, 85);

        IComputeSubsidy.AgentComputeProfile memory profile = manager.getAgentProfile(agent1);
        assertEq(profile.totalJobsCompleted, 1);
    }

    function test_failJob() public {
        oracle.setScore(agent1, 3000);

        vm.prank(agent1);
        bytes32 jobId = manager.submitJob(BASE_COST);

        vm.prank(rater);
        manager.failJob(jobId);

        IComputeSubsidy.ComputeJob memory job = manager.getJob(jobId);
        assertEq(uint8(job.status), uint8(IComputeSubsidy.JobStatus.FAILED));

        IComputeSubsidy.AgentComputeProfile memory profile = manager.getAgentProfile(agent1);
        assertEq(profile.totalJobsFailed, 1);
    }

    // ============ Revenue Clawback Tests ============

    function test_revenueClawback() public {
        oracle.setScore(agent1, 8000); // High rep → high subsidy → high clawback rate

        vm.prank(agent1);
        bytes32 jobId = manager.submitJob(BASE_COST);

        vm.prank(rater);
        manager.completeJob(jobId, 90);

        // Report revenue
        uint256 revenue = 500 * WAD;
        uint256 poolBefore = manager.getPoolState().balance;

        vm.prank(rater);
        manager.reportRevenue(jobId, revenue);

        uint256 poolAfter = manager.getPoolState().balance;
        assertGt(poolAfter, poolBefore, "Pool should increase from clawback");

        IComputeSubsidy.AgentComputeProfile memory profile = manager.getAgentProfile(agent1);
        assertGt(profile.totalClawbackPaid, 0, "Agent should have paid clawback");
        assertEq(profile.totalRevenueGenerated, revenue, "Revenue should be tracked");
    }

    function test_noClawback_noSubsidy() public {
        oracle.setScore(agent1, 0); // 0 rep → 0 subsidy

        vm.prank(agent1);
        bytes32 jobId = manager.submitJob(BASE_COST);

        vm.prank(rater);
        manager.completeJob(jobId, 90);

        // No subsidy was given, so no clawback
        IComputeSubsidy.ComputeJob memory job = manager.getJob(jobId);
        assertEq(job.subsidyAmount, 0, "No subsidy at 0 rep");

        vm.prank(rater);
        vm.expectRevert(IComputeSubsidy.NothingToClawback.selector);
        manager.reportRevenue(jobId, 100 * WAD);
    }

    function test_clawbackRate_scales() public view {
        // 0% subsidy → 0% clawback
        assertEq(manager.getClawbackRate(0), 0);

        // 90% subsidy (9000 bps) → 50% clawback (5000 bps)
        assertEq(manager.getClawbackRate(9000), 5000);

        // 45% subsidy (4500 bps) → 25% clawback (2500 bps)
        assertEq(manager.getClawbackRate(4500), 2500);
    }

    // ============ Staking Tests ============

    function test_stakeForReputation() public {
        oracle.setScore(agent1, 3000);

        uint256 stakeAmount = 100 * WAD; // 100 JOULE staked
        vm.prank(agent1);
        manager.stakeForReputation(stakeAmount);

        IComputeSubsidy.AgentComputeProfile memory profile = manager.getAgentProfile(agent1);
        assertEq(profile.totalStaked, stakeAmount);

        // Effective rep should be higher than base
        uint256 effectiveRep = manager.getEffectiveReputation(agent1);
        assertGt(effectiveRep, 3000, "Staking should boost reputation");
        assertLe(effectiveRep, 10_000, "Should not exceed max");
    }

    function test_stakeSlashedOnFailure() public {
        oracle.setScore(agent1, 3000);

        // Stake first
        uint256 stakeAmount = 100 * WAD;
        vm.prank(agent1);
        manager.stakeForReputation(stakeAmount);

        // Submit job (will have stakedBoost recorded)
        vm.prank(agent1);
        bytes32 jobId = manager.submitJob(BASE_COST);

        uint256 poolBefore = manager.getPoolState().balance;

        // Fail the job → stake gets slashed
        vm.prank(rater);
        manager.failJob(jobId);

        IComputeSubsidy.AgentComputeProfile memory profile = manager.getAgentProfile(agent1);
        assertLt(profile.totalStaked, stakeAmount, "Stake should be reduced");

        uint256 poolAfter = manager.getPoolState().balance;
        assertGt(poolAfter, poolBefore, "Pool should receive portion of slash");
    }

    function test_unstakeReputation() public {
        uint256 stakeAmount = 50 * WAD;
        vm.prank(agent1);
        manager.stakeForReputation(stakeAmount);

        vm.prank(agent1);
        manager.unstakeReputation(stakeAmount);

        IComputeSubsidy.AgentComputeProfile memory profile = manager.getAgentProfile(agent1);
        assertEq(profile.totalStaked, 0);
    }

    // ============ Inactivity Decay Tests ============

    function test_inactivityDecay() public {
        oracle.setScore(agent1, 5000);

        // Record initial activity
        vm.prank(agent1);
        manager.submitJob(BASE_COST);

        uint256 repBefore = manager.getEffectiveReputation(agent1);

        // Warp 60 days (30 day grace + 30 days decay)
        vm.warp(block.timestamp + 60 days);

        uint256 repAfter = manager.getEffectiveReputation(agent1);
        assertLt(repAfter, repBefore, "Rep should decay after inactivity");

        // 30 days of decay at 50/day = -1500
        assertApproxEqAbs(repBefore - repAfter, 1500, 50, "Should decay ~1500 in 30 days");
    }

    // ============ Pool Tests ============

    function test_fundPool() public {
        uint256 amount = 10_000 * WAD;
        uint256 poolBefore = manager.getPoolState().balance;

        vm.prank(funder);
        manager.fundPool(amount);

        IComputeSubsidy.SubsidyPool memory state = manager.getPoolState();
        assertEq(state.balance, poolBefore + amount);
    }

    function test_insufficientPool() public {
        oracle.setScore(agent1, 10_000); // Max rep = 90% subsidy

        // Drain the pool
        // Need to somehow deplete it — submit many jobs
        // Or deploy a fresh contract with empty pool
        ComputeSubsidyManager impl2 = new ComputeSubsidyManager();
        bytes memory initData = abi.encodeWithSelector(
            ComputeSubsidyManager.initialize.selector,
            address(joule), address(oracle), address(0), owner
        );
        ERC1967Proxy proxy2 = new ERC1967Proxy(address(impl2), initData);
        ComputeSubsidyManager emptyManager = ComputeSubsidyManager(address(proxy2));

        vm.prank(agent1);
        joule.approve(address(emptyManager), type(uint256).max);

        vm.prank(agent1);
        vm.expectRevert(IComputeSubsidy.InsufficientPoolBalance.selector);
        emptyManager.submitJob(BASE_COST);
    }

    // ============ Access Control Tests ============

    function test_onlyRaterCanComplete() public {
        oracle.setScore(agent1, 3000);
        vm.prank(agent1);
        bytes32 jobId = manager.submitJob(BASE_COST);

        vm.prank(agent2); // Not a rater
        vm.expectRevert(IComputeSubsidy.Unauthorized.selector);
        manager.completeJob(jobId, 90);
    }

    function test_onlyRaterCanFail() public {
        oracle.setScore(agent1, 3000);
        vm.prank(agent1);
        bytes32 jobId = manager.submitJob(BASE_COST);

        vm.prank(agent2);
        vm.expectRevert(IComputeSubsidy.Unauthorized.selector);
        manager.failJob(jobId);
    }

    function test_cannotCompleteNonActiveJob() public {
        oracle.setScore(agent1, 3000);
        vm.prank(agent1);
        bytes32 jobId = manager.submitJob(BASE_COST);

        vm.prank(rater);
        manager.completeJob(jobId, 90);

        // Try to complete again
        vm.prank(rater);
        vm.expectRevert(IComputeSubsidy.JobNotActive.selector);
        manager.completeJob(jobId, 95);
    }

    // ============ Fuzz Tests ============

    function testFuzz_subsidyMultiplier_bounded(uint256 rep) public view {
        rep = bound(rep, 0, 10_000);
        uint256 mult = manager.getSubsidyMultiplier(rep);

        assertGe(mult, WAD / 10, "Multiplier should be >= 0.1x");
        assertLe(mult, WAD, "Multiplier should be <= 1.0x");
    }

    function testFuzz_clawbackRate_bounded(uint256 subsidyBps) public view {
        subsidyBps = bound(subsidyBps, 0, 10_000);
        uint256 clawback = manager.getClawbackRate(subsidyBps);

        assertLe(clawback, 5000, "Clawback should be <= 50%");
    }

    function testFuzz_submitJob_costInvariant(uint256 rep) public {
        rep = bound(rep, 0, 10_000);
        oracle.setScore(agent1, rep);

        uint256 agentBefore = joule.balanceOf(agent1);
        uint256 poolBefore = manager.getPoolState().balance;

        vm.prank(agent1);
        bytes32 jobId = manager.submitJob(BASE_COST);

        uint256 agentPaid = agentBefore - joule.balanceOf(agent1);
        uint256 poolSpent = poolBefore - manager.getPoolState().balance;

        // Invariant: agentPaid + poolSpent = baseCost
        assertEq(agentPaid + poolSpent, BASE_COST, "Agent payment + subsidy must equal base cost");
    }
}
