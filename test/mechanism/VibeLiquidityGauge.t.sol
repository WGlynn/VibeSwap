// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/VibeLiquidityGauge.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ VibeLiquidityGauge Tests ============

contract VibeLiquidityGaugeTest is Test {
    VibeLiquidityGauge public gauge;

    address public owner;
    address public alice;
    address public bob;
    address public pool1;
    address public pool2;

    uint256 constant EMISSION_RATE = 1 ether; // 1 ETH per second total

    // ============ Events ============

    event GaugeCreated(uint256 indexed gaugeId, address indexed pool, string name);
    event GaugeKilled(uint256 indexed gaugeId);
    event Staked(uint256 indexed gaugeId, address indexed user, uint256 amount);
    event Unstaked(uint256 indexed gaugeId, address indexed user, uint256 amount);
    event RewardClaimed(uint256 indexed gaugeId, address indexed user, uint256 reward);
    event VoteCast(uint256 indexed epoch, address indexed voter, uint256 gaugeId, uint256 weight);
    event EpochAdvanced(uint256 indexed epoch);
    event EmissionRateUpdated(uint256 newRate);

    // Allow test contract (= owner) to receive ETH from claimReward / withdrawFees
    receive() external payable {}

    // ============ Setup ============

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob   = makeAddr("bob");
        pool1 = makeAddr("pool1");
        pool2 = makeAddr("pool2");

        VibeLiquidityGauge impl = new VibeLiquidityGauge();
        bytes memory initData = abi.encodeCall(VibeLiquidityGauge.initialize, (EMISSION_RATE));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        gauge = VibeLiquidityGauge(payable(address(proxy)));

        // Fund the contract with ETH for rewards
        vm.deal(address(gauge), 1_000 ether);
        vm.deal(alice, 100 ether);
        vm.deal(bob,   100 ether);
    }

    // ============ Helpers ============

    function _createGauge(address pool_, string memory name) internal returns (uint256) {
        return gauge.createGauge(pool_, name);
    }

    function _stake(address user, uint256 gaugeId, uint256 amount) internal {
        vm.prank(user);
        gauge.stake{value: amount}(gaugeId);
    }

    function _unstake(address user, uint256 gaugeId, uint256 amount) internal {
        vm.prank(user);
        gauge.unstake(gaugeId, amount);
    }

    // ============ Initialization ============

    function test_initialize_setsOwner() public view {
        assertEq(gauge.owner(), owner);
    }

    function test_initialize_setsEmissionRate() public view {
        assertEq(gauge.totalEmissionRate(), EMISSION_RATE);
    }

    function test_initialize_epochStartsAtOne() public view {
        assertEq(gauge.currentEpoch(), 1);
    }

    // ============ Gauge Management ============

    function test_createGauge_incrementsCount() public {
        assertEq(gauge.getGaugeCount(), 0);
        _createGauge(pool1, "VIBE/ETH");
        assertEq(gauge.getGaugeCount(), 1);
    }

    function test_createGauge_storesPool() public {
        uint256 gId = _createGauge(pool1, "VIBE/ETH");
        (address storedPool, , , , bool active) = gauge.getGaugeInfo(gId);
        assertEq(storedPool, pool1);
        assertTrue(active);
    }

    function test_createGauge_emitsEvent() public {
        vm.expectEmit(true, true, false, false);
        emit GaugeCreated(1, pool1, "VIBE/ETH");
        _createGauge(pool1, "VIBE/ETH");
    }

    function test_createGauge_notOwner_reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        gauge.createGauge(pool1, "VIBE/ETH");
    }

    function test_killGauge_deactivates() public {
        uint256 gId = _createGauge(pool1, "VIBE/ETH");
        gauge.killGauge(gId);

        (, , , , bool active) = gauge.getGaugeInfo(gId);
        assertFalse(active);
    }

    function test_killGauge_emitsEvent() public {
        uint256 gId = _createGauge(pool1, "VIBE/ETH");

        vm.expectEmit(true, false, false, false);
        emit GaugeKilled(gId);
        gauge.killGauge(gId);
    }

    function test_killGauge_notActive_reverts() public {
        uint256 gId = _createGauge(pool1, "VIBE/ETH");
        gauge.killGauge(gId);

        vm.expectRevert("Not active");
        gauge.killGauge(gId);
    }

    function test_killGauge_notOwner_reverts() public {
        uint256 gId = _createGauge(pool1, "VIBE/ETH");

        vm.prank(alice);
        vm.expectRevert();
        gauge.killGauge(gId);
    }

    // ============ Staking ============

    function test_stake_recordsAmount() public {
        uint256 gId = _createGauge(pool1, "VIBE/ETH");
        _stake(alice, gId, 1 ether);

        (uint256 amount, , , ) = gauge.stakes(gId, alice);
        assertEq(amount, 1 ether);
    }

    function test_stake_updatesTotalStaked() public {
        uint256 gId = _createGauge(pool1, "VIBE/ETH");
        _stake(alice, gId, 1 ether);
        _stake(bob,   gId, 2 ether);

        (, , uint256 totalStaked, , ) = gauge.getGaugeInfo(gId);
        assertEq(totalStaked, 3 ether);
    }

    function test_stake_emitsEvent() public {
        uint256 gId = _createGauge(pool1, "VIBE/ETH");

        vm.expectEmit(true, true, false, true);
        emit Staked(gId, alice, 1 ether);

        vm.prank(alice);
        gauge.stake{value: 1 ether}(gId);
    }

    function test_stake_zeroValue_reverts() public {
        uint256 gId = _createGauge(pool1, "VIBE/ETH");

        vm.prank(alice);
        vm.expectRevert("Zero amount");
        gauge.stake{value: 0}(gId);
    }

    function test_stake_killedGauge_reverts() public {
        uint256 gId = _createGauge(pool1, "VIBE/ETH");
        gauge.killGauge(gId);

        vm.prank(alice);
        vm.expectRevert("Gauge not active");
        gauge.stake{value: 1 ether}(gId);
    }

    function test_stake_multipleDeposits_accumulate() public {
        uint256 gId = _createGauge(pool1, "VIBE/ETH");
        _stake(alice, gId, 1 ether);
        _stake(alice, gId, 2 ether);

        (uint256 amount, , , ) = gauge.stakes(gId, alice);
        assertEq(amount, 3 ether);
    }

    // ============ Unstaking ============

    function test_unstake_returnsETH() public {
        uint256 gId = _createGauge(pool1, "VIBE/ETH");
        _stake(alice, gId, 1 ether);

        uint256 aliceBefore = alice.balance;
        _unstake(alice, gId, 1 ether);

        assertEq(alice.balance, aliceBefore + 1 ether);
    }

    function test_unstake_reducesStakeRecord() public {
        uint256 gId = _createGauge(pool1, "VIBE/ETH");
        _stake(alice, gId, 3 ether);
        _unstake(alice, gId, 1 ether);

        (uint256 amount, , , ) = gauge.stakes(gId, alice);
        assertEq(amount, 2 ether);
    }

    function test_unstake_reducesTotalStaked() public {
        uint256 gId = _createGauge(pool1, "VIBE/ETH");
        _stake(alice, gId, 3 ether);
        _unstake(alice, gId, 1 ether);

        (, , uint256 totalStaked, , ) = gauge.getGaugeInfo(gId);
        assertEq(totalStaked, 2 ether);
    }

    function test_unstake_emitsEvent() public {
        uint256 gId = _createGauge(pool1, "VIBE/ETH");
        _stake(alice, gId, 2 ether);

        vm.expectEmit(true, true, false, true);
        emit Unstaked(gId, alice, 1 ether);
        _unstake(alice, gId, 1 ether);
    }

    function test_unstake_insufficientStake_reverts() public {
        uint256 gId = _createGauge(pool1, "VIBE/ETH");
        _stake(alice, gId, 1 ether);

        vm.prank(alice);
        vm.expectRevert("Insufficient stake");
        gauge.unstake(gId, 2 ether);
    }

    // ============ Reward Accrual ============

    function test_pendingReward_zeroBeforeTimeElapses() public {
        uint256 gId = _createGauge(pool1, "VIBE/ETH");
        _stake(alice, gId, 1 ether);

        assertEq(gauge.getPendingReward(gId, alice), 0);
    }

    function test_pendingReward_growsWithTime() public {
        uint256 gId = _createGauge(pool1, "VIBE/ETH");

        // Set rewardRate by advancing an epoch with votes
        _stake(alice, gId, 1 ether);

        // Vote 100% to gauge 1
        VibeLiquidityGauge.GaugeVote[] memory gVotes = new VibeLiquidityGauge.GaugeVote[](1);
        gVotes[0] = VibeLiquidityGauge.GaugeVote({gaugeId: gId, weight: 10000});
        gauge.voteForGaugeWeights(gVotes);

        // Advance epoch
        vm.warp(block.timestamp + 7 days);
        gauge.advanceEpoch();

        // Warp forward — rewards should accrue
        vm.warp(block.timestamp + 1 hours);

        assertGt(gauge.getPendingReward(gId, alice), 0);
    }

    function test_claimReward_transfersETH() public {
        uint256 gId = _createGauge(pool1, "VIBE/ETH");
        _stake(alice, gId, 1 ether);

        VibeLiquidityGauge.GaugeVote[] memory gVotes = new VibeLiquidityGauge.GaugeVote[](1);
        gVotes[0] = VibeLiquidityGauge.GaugeVote({gaugeId: gId, weight: 10000});
        gauge.voteForGaugeWeights(gVotes);

        vm.warp(block.timestamp + 7 days);
        gauge.advanceEpoch();
        vm.warp(block.timestamp + 10 minutes); // short warp so reward stays within contract balance

        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        gauge.claimReward(gId);

        assertGt(alice.balance, aliceBefore);
    }

    function test_claimReward_noRewards_reverts() public {
        uint256 gId = _createGauge(pool1, "VIBE/ETH");
        _stake(alice, gId, 1 ether);

        vm.prank(alice);
        vm.expectRevert("No rewards");
        gauge.claimReward(gId);
    }

    function test_claimReward_resetsAccrual() public {
        uint256 gId = _createGauge(pool1, "VIBE/ETH");
        _stake(alice, gId, 1 ether);

        VibeLiquidityGauge.GaugeVote[] memory gVotes = new VibeLiquidityGauge.GaugeVote[](1);
        gVotes[0] = VibeLiquidityGauge.GaugeVote({gaugeId: gId, weight: 10000});
        gauge.voteForGaugeWeights(gVotes);

        vm.warp(block.timestamp + 7 days);
        gauge.advanceEpoch();
        vm.warp(block.timestamp + 10 minutes); // short warp so reward stays within contract balance

        vm.prank(alice);
        gauge.claimReward(gId);

        // Pending reward resets to 0 at the moment of claim
        assertEq(gauge.getPendingReward(gId, alice), 0);
    }

    // ============ Voting ============

    function test_vote_recordsEpochGaugeVotes() public {
        uint256 gId = _createGauge(pool1, "VIBE/ETH");

        VibeLiquidityGauge.GaugeVote[] memory gVotes = new VibeLiquidityGauge.GaugeVote[](1);
        gVotes[0] = VibeLiquidityGauge.GaugeVote({gaugeId: gId, weight: 6000});
        gauge.voteForGaugeWeights(gVotes);

        uint256 epoch = gauge.currentEpoch();
        assertEq(gauge.epochGaugeVotes(epoch, gId), 6000);
    }

    function test_vote_emitsEvent() public {
        uint256 gId = _createGauge(pool1, "VIBE/ETH");

        vm.expectEmit(true, true, false, true);
        emit VoteCast(1, owner, gId, 5000);

        VibeLiquidityGauge.GaugeVote[] memory gVotes = new VibeLiquidityGauge.GaugeVote[](1);
        gVotes[0] = VibeLiquidityGauge.GaugeVote({gaugeId: gId, weight: 5000});
        gauge.voteForGaugeWeights(gVotes);
    }

    function test_vote_totalWeightOver100Pct_reverts() public {
        uint256 gId1 = _createGauge(pool1, "VIBE/ETH");
        uint256 gId2 = _createGauge(pool2, "VIBE/USDC");

        VibeLiquidityGauge.GaugeVote[] memory gVotes = new VibeLiquidityGauge.GaugeVote[](2);
        gVotes[0] = VibeLiquidityGauge.GaugeVote({gaugeId: gId1, weight: 6000});
        gVotes[1] = VibeLiquidityGauge.GaugeVote({gaugeId: gId2, weight: 5000});

        vm.expectRevert("Total weight > 100%");
        gauge.voteForGaugeWeights(gVotes);
    }

    function test_vote_inactiveGauge_reverts() public {
        uint256 gId = _createGauge(pool1, "VIBE/ETH");
        gauge.killGauge(gId);

        VibeLiquidityGauge.GaugeVote[] memory gVotes = new VibeLiquidityGauge.GaugeVote[](1);
        gVotes[0] = VibeLiquidityGauge.GaugeVote({gaugeId: gId, weight: 5000});

        vm.expectRevert("Gauge not active");
        gauge.voteForGaugeWeights(gVotes);
    }

    function test_vote_multiGauge_splitWeight() public {
        uint256 gId1 = _createGauge(pool1, "VIBE/ETH");
        uint256 gId2 = _createGauge(pool2, "VIBE/USDC");

        VibeLiquidityGauge.GaugeVote[] memory gVotes = new VibeLiquidityGauge.GaugeVote[](2);
        gVotes[0] = VibeLiquidityGauge.GaugeVote({gaugeId: gId1, weight: 4000});
        gVotes[1] = VibeLiquidityGauge.GaugeVote({gaugeId: gId2, weight: 6000});
        gauge.voteForGaugeWeights(gVotes);

        uint256 epoch = gauge.currentEpoch();
        assertEq(gauge.epochGaugeVotes(epoch, gId1), 4000);
        assertEq(gauge.epochGaugeVotes(epoch, gId2), 6000);
        assertEq(gauge.epochTotalVotes(epoch), 10000);
    }

    // ============ Epoch Advancement ============

    function test_advanceEpoch_tooEarly_reverts() public {
        vm.expectRevert("Too early");
        gauge.advanceEpoch();
    }

    function test_advanceEpoch_incrementsEpoch() public {
        vm.warp(block.timestamp + 7 days);
        gauge.advanceEpoch();
        assertEq(gauge.currentEpoch(), 2);
    }

    function test_advanceEpoch_emitsEvent() public {
        vm.warp(block.timestamp + 7 days);

        vm.expectEmit(true, false, false, false);
        emit EpochAdvanced(2);
        gauge.advanceEpoch();
    }

    function test_advanceEpoch_appliesGaugeWeights() public {
        uint256 gId = _createGauge(pool1, "VIBE/ETH");

        // Vote 100% weight to gId
        VibeLiquidityGauge.GaugeVote[] memory gVotes = new VibeLiquidityGauge.GaugeVote[](1);
        gVotes[0] = VibeLiquidityGauge.GaugeVote({gaugeId: gId, weight: 10000});
        gauge.voteForGaugeWeights(gVotes);

        vm.warp(block.timestamp + 7 days);
        gauge.advanceEpoch();

        (, uint256 weight, , , ) = gauge.getGaugeInfo(gId);
        // Contract caps any single gauge at MAX_GAUGE_WEIGHT_BPS (35%)
        assertEq(weight, gauge.MAX_GAUGE_WEIGHT_BPS());
    }

    function test_advanceEpoch_capsWeightAt35Pct() public {
        uint256 gId1 = _createGauge(pool1, "VIBE/ETH");
        uint256 gId2 = _createGauge(pool2, "VIBE/USDC");

        // Vote 90% to gId1, 10% to gId2 — gId1 should be capped at 35%
        VibeLiquidityGauge.GaugeVote[] memory gVotes = new VibeLiquidityGauge.GaugeVote[](2);
        gVotes[0] = VibeLiquidityGauge.GaugeVote({gaugeId: gId1, weight: 9000});
        gVotes[1] = VibeLiquidityGauge.GaugeVote({gaugeId: gId2, weight: 1000});
        gauge.voteForGaugeWeights(gVotes);

        vm.warp(block.timestamp + 7 days);
        gauge.advanceEpoch();

        (, uint256 weight1, , , ) = gauge.getGaugeInfo(gId1);
        assertEq(weight1, 3500); // capped at 35%
    }

    function test_advanceEpoch_setsRewardRate() public {
        uint256 gId = _createGauge(pool1, "VIBE/ETH");

        VibeLiquidityGauge.GaugeVote[] memory gVotes = new VibeLiquidityGauge.GaugeVote[](1);
        gVotes[0] = VibeLiquidityGauge.GaugeVote({gaugeId: gId, weight: 10000});
        gauge.voteForGaugeWeights(gVotes);

        vm.warp(block.timestamp + 7 days);
        gauge.advanceEpoch();

        (, , , uint256 rewardRate, ) = gauge.getGaugeInfo(gId);
        // Single gauge is capped at MAX_GAUGE_WEIGHT_BPS (35%) so rate = EMISSION_RATE * 3500 / 10000
        uint256 expectedRate = (EMISSION_RATE * gauge.MAX_GAUGE_WEIGHT_BPS()) / gauge.BPS();
        assertEq(rewardRate, expectedRate);
    }

    function test_advanceEpoch_skippedWhenNoVotes() public {
        uint256 gId = _createGauge(pool1, "VIBE/ETH");

        vm.warp(block.timestamp + 7 days);
        gauge.advanceEpoch(); // no votes cast — weights stay 0

        (, uint256 weight, , , ) = gauge.getGaugeInfo(gId);
        assertEq(weight, 0);
    }

    // ============ Admin ============

    function test_setEmissionRate_updatesRate() public {
        gauge.setEmissionRate(2 ether);
        assertEq(gauge.totalEmissionRate(), 2 ether);
    }

    function test_setEmissionRate_emitsEvent() public {
        vm.expectEmit(false, false, false, true);
        emit EmissionRateUpdated(5 ether);
        gauge.setEmissionRate(5 ether);
    }

    function test_setEmissionRate_notOwner_reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        gauge.setEmissionRate(2 ether);
    }

    // ============ View Helpers ============

    function test_getGaugeInfo_returnsCorrectData() public {
        uint256 gId = _createGauge(pool1, "VIBE/ETH");

        (address p, uint256 weight, uint256 totalStaked, uint256 rewardRate, bool active) =
            gauge.getGaugeInfo(gId);

        assertEq(p, pool1);
        assertEq(weight, 0);
        assertEq(totalStaked, 0);
        assertEq(rewardRate, 0);
        assertTrue(active);
    }

    function test_getEpoch_returnsCurrentEpoch() public view {
        assertEq(gauge.getEpoch(), 1);
    }

    // ============ Fuzz ============

    function testFuzz_stake_unstake_roundtrip(uint96 amount) public {
        vm.assume(amount > 0 && amount <= 10 ether);
        vm.deal(alice, uint256(amount));

        uint256 gId = _createGauge(pool1, "VIBE/ETH");
        _stake(alice, gId, uint256(amount));

        (uint256 stakeAmt, , , ) = gauge.stakes(gId, alice);
        assertEq(stakeAmt, uint256(amount));

        uint256 aliceBefore = alice.balance;
        _unstake(alice, gId, uint256(amount));
        assertEq(alice.balance, aliceBefore + uint256(amount));
    }
}
