// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/VibeLiquidStaking.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ VibeLiquidStaking Tests ============

contract VibeLiquidStakingTest is Test {
    VibeLiquidStaking public staking;

    address public owner;
    address public alice;
    address public bob;

    // ============ Events ============

    event Staked(address indexed user, uint256 ethAmount, uint256 vsEthMinted);
    event Unstaked(address indexed user, uint256 vsEthBurned, uint256 ethReturned);
    event RewardsDistributed(uint256 rewards, uint256 protocolFee);
    event BufferReplenished(uint256 amount);

    // Allow test contract (= owner) to receive ETH from withdrawProtocolFees / unstake
    receive() external payable {}

    // ============ Setup ============

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob   = makeAddr("bob");

        VibeLiquidStaking impl = new VibeLiquidStaking();
        bytes memory initData = abi.encodeCall(VibeLiquidStaking.initialize, ());
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        staking = VibeLiquidStaking(payable(address(proxy)));

        vm.deal(alice, 100 ether);
        vm.deal(bob,   100 ether);
        vm.deal(owner, 100 ether);
    }

    // ============ Helpers ============

    function _stakeAs(address user, uint256 amount) internal {
        vm.prank(user);
        staking.stake{value: amount}();
    }

    function _warpPastHold() internal {
        vm.warp(block.timestamp + 1 days + 1);
    }

    /// @dev Replenish buffer so full unstakes are possible (buffer only holds 5% from stake)
    function _fillBuffer() internal {
        uint256 pooled = staking.totalPooledEth();
        uint256 buf = staking.liquidityBuffer();
        if (pooled > buf) {
            staking.replenishBuffer{value: pooled - buf}();
        }
    }

    // ============ Initialization ============

    function test_initialize_setsOwner() public view {
        assertEq(staking.owner(), owner);
    }

    function test_initialize_zeroTotalVsEth() public view {
        assertEq(staking.totalVsEth(), 0);
    }

    function test_initialize_exchangeRateIsOne() public view {
        assertEq(staking.getExchangeRate(), 1 ether);
    }

    // ============ Stake ============

    function test_stake_initialMint11() public {
        _stakeAs(alice, 1 ether);
        assertEq(staking.vsEthBalance(alice), 1 ether);
        assertEq(staking.totalVsEth(), 1 ether);
        assertEq(staking.totalPooledEth(), 1 ether);
    }

    function test_stake_updatesStakerCount() public {
        assertEq(staking.stakerCount(), 0);
        _stakeAs(alice, 1 ether);
        assertEq(staking.stakerCount(), 1);
    }

    function test_stake_secondStakerCountsCorrectly() public {
        _stakeAs(alice, 1 ether);
        _stakeAs(bob,   1 ether);
        assertEq(staking.stakerCount(), 2);
    }

    function test_stake_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit Staked(alice, 1 ether, 1 ether);
        _stakeAs(alice, 1 ether);
    }

    function test_stake_belowMinimum_reverts() public {
        vm.prank(alice);
        vm.expectRevert("Below minimum");
        staking.stake{value: 0.001 ether}(); // below 0.01 ether
    }

    function test_stake_setsStakedAt() public {
        uint256 t = block.timestamp;
        _stakeAs(alice, 1 ether);
        assertEq(staking.stakedAt(alice), t);
    }

    function test_stake_allocatesToBuffer() public {
        _stakeAs(alice, 1 ether);
        // 5% of 1 ether = 0.05 ether
        assertEq(staking.liquidityBuffer(), 0.05 ether);
    }

    function test_stake_multipleStakers_mintProportionally() public {
        _stakeAs(alice, 1 ether); // 1 vsETH minted, rate = 1:1

        // Distribute rewards → rate increases
        staking.distributeRewards{value: 1 ether}(); // total pooled = 1 + 0.9 = 1.9, vsETH = 1

        // Bob stakes 1 ether; should get less than 1 vsETH
        _stakeAs(bob, 1 ether);
        assertLt(staking.vsEthBalance(bob), 1 ether);
    }

    // ============ Unstake ============

    function test_unstake_returnsEth() public {
        _stakeAs(alice, 1 ether);
        _fillBuffer();
        _warpPastHold();

        uint256 aliceBefore = alice.balance;
        uint256 vsEthAmount = staking.vsEthBalance(alice);

        vm.prank(alice);
        staking.unstake(vsEthAmount);

        assertGt(alice.balance, aliceBefore);
    }

    function test_unstake_burnsVsEth() public {
        _stakeAs(alice, 1 ether);
        _fillBuffer();
        _warpPastHold();

        uint256 vsEthAmount = staking.vsEthBalance(alice);
        vm.prank(alice);
        staking.unstake(vsEthAmount);

        assertEq(staking.vsEthBalance(alice), 0);
        assertEq(staking.totalVsEth(), 0);
    }

    function test_unstake_decreasesStakerCount() public {
        _stakeAs(alice, 1 ether);
        _fillBuffer();
        _warpPastHold();

        assertEq(staking.stakerCount(), 1);
        uint256 bal = staking.vsEthBalance(alice);
        vm.prank(alice);
        staking.unstake(bal);
        assertEq(staking.stakerCount(), 0);
    }

    function test_unstake_emitsEvent() public {
        _stakeAs(alice, 1 ether);
        _fillBuffer();
        _warpPastHold();

        uint256 vsEthAmount = staking.vsEthBalance(alice);
        uint256 ethToReturn = (vsEthAmount * staking.totalPooledEth()) / staking.totalVsEth();

        vm.expectEmit(true, false, false, true);
        emit Unstaked(alice, vsEthAmount, ethToReturn);
        vm.prank(alice);
        staking.unstake(vsEthAmount);
    }

    function test_unstake_holdPeriodActive_reverts() public {
        _stakeAs(alice, 1 ether);
        // No time warp — still in hold period

        uint256 bal = staking.vsEthBalance(alice);
        vm.prank(alice);
        vm.expectRevert("Hold period active");
        staking.unstake(bal);
    }

    function test_unstake_zeroAmount_reverts() public {
        _stakeAs(alice, 1 ether);
        _warpPastHold();

        vm.prank(alice);
        vm.expectRevert("Zero amount");
        staking.unstake(0);
    }

    function test_unstake_insufficientVsEth_reverts() public {
        _stakeAs(alice, 1 ether);
        _warpPastHold();

        uint256 bal = staking.vsEthBalance(alice);
        vm.prank(alice);
        vm.expectRevert("Insufficient vsETH");
        staking.unstake(bal + 1);
    }

    function test_unstake_insufficientLiquidity_reverts() public {
        _stakeAs(alice, 1 ether);
        _warpPastHold();

        // Drain the buffer by replenishing then ignoring — actually, buffer is only 5% of stake
        // Try to unstake more than buffer holds
        // alice has 1 vsETH = 1 ETH, but buffer = 0.05 ETH
        // Partial unstake within buffer
        uint256 bal = staking.vsEthBalance(alice);
        vm.prank(alice);
        vm.expectRevert("Insufficient liquidity");
        staking.unstake(bal); // 1 ETH > 0.05 ETH buffer
    }

    function test_unstake_withinBuffer_succeeds() public {
        _stakeAs(alice, 10 ether); // buffer = 0.5 ETH
        _warpPastHold();

        // Unstake 0.05 vsETH → 0.05 ETH (well within 0.5 ETH buffer)
        vm.prank(alice);
        staking.unstake(0.05 ether);
        // No revert = success
    }

    // ============ Rewards ============

    function test_distributeRewards_increasesExchangeRate() public {
        _stakeAs(alice, 1 ether);
        uint256 rateBefore = staking.getExchangeRate();

        staking.distributeRewards{value: 1 ether}();

        assertGt(staking.getExchangeRate(), rateBefore);
    }

    function test_distributeRewards_deductsProtocolFee() public {
        _stakeAs(alice, 1 ether);

        uint256 rewards = 1 ether;
        uint256 expectedProtocolFee = (rewards * 1000) / 10000; // 10%
        uint256 expectedNet = rewards - expectedProtocolFee;

        uint256 pooledBefore = staking.totalPooledEth();
        staking.distributeRewards{value: rewards}();

        assertEq(staking.totalPooledEth(), pooledBefore + expectedNet);
        assertEq(staking.protocolFees(), expectedProtocolFee);
    }

    function test_distributeRewards_accumulatesTotalDistributed() public {
        _stakeAs(alice, 1 ether);
        staking.distributeRewards{value: 1 ether}();
        staking.distributeRewards{value: 1 ether}();

        uint256 expected = (1 ether * 9000 / 10000) * 2;
        assertEq(staking.totalRewardsDistributed(), expected);
    }

    function test_distributeRewards_emitsEvent() public {
        _stakeAs(alice, 1 ether);

        uint256 fee = (1 ether * 1000) / 10000;
        uint256 net = 1 ether - fee;

        vm.expectEmit(false, false, false, true);
        emit RewardsDistributed(net, fee);
        staking.distributeRewards{value: 1 ether}();
    }

    function test_distributeRewards_zeroAmount_reverts() public {
        _stakeAs(alice, 1 ether);

        vm.expectRevert("Zero rewards");
        staking.distributeRewards{value: 0}();
    }

    function test_distributeRewards_noStakers_reverts() public {
        vm.expectRevert("No stakers");
        staking.distributeRewards{value: 1 ether}();
    }

    function test_distributeRewards_notOwner_reverts() public {
        _stakeAs(alice, 1 ether);

        vm.prank(alice);
        vm.expectRevert();
        staking.distributeRewards{value: 1 ether}();
    }

    // ============ Protocol Fees ============

    function test_withdrawProtocolFees_sendsToOwner() public {
        _stakeAs(alice, 1 ether);
        staking.distributeRewards{value: 1 ether}();

        uint256 fees = staking.protocolFees();
        uint256 ownerBefore = owner.balance;

        staking.withdrawProtocolFees();

        assertEq(owner.balance, ownerBefore + fees);
        assertEq(staking.protocolFees(), 0);
    }

    function test_withdrawProtocolFees_notOwner_reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        staking.withdrawProtocolFees();
    }

    // ============ Buffer ============

    function test_replenishBuffer_increasesBuffer() public {
        uint256 bufferBefore = staking.liquidityBuffer();
        staking.replenishBuffer{value: 1 ether}();
        assertEq(staking.liquidityBuffer(), bufferBefore + 1 ether);
    }

    function test_replenishBuffer_emitsEvent() public {
        vm.expectEmit(false, false, false, true);
        emit BufferReplenished(1 ether);
        staking.replenishBuffer{value: 1 ether}();
    }

    function test_replenishBuffer_notOwner_reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        staking.replenishBuffer{value: 1 ether}();
    }

    // ============ Exchange Rate & Views ============

    function test_getExchangeRate_oneToOneInitially() public view {
        assertEq(staking.getExchangeRate(), 1 ether);
    }

    function test_getExchangeRate_appreciatesAfterRewards() public {
        _stakeAs(alice, 1 ether);
        staking.distributeRewards{value: 0.1 ether}();

        // Net reward = 0.09 ETH. total pooled = 1.09, vsETH = 1 → rate > 1
        uint256 rate = staking.getExchangeRate();
        assertGt(rate, 1 ether);
    }

    function test_getEthValue_correctAtOneToOne() public {
        _stakeAs(alice, 1 ether);
        assertEq(staking.getEthValue(alice), 1 ether);
    }

    function test_getEthValue_appreciatesWithRewards() public {
        _stakeAs(alice, 1 ether);
        staking.distributeRewards{value: 1 ether}();

        assertGt(staking.getEthValue(alice), 1 ether);
    }

    function test_getBufferUtilization_correctRatio() public {
        _stakeAs(alice, 1 ether); // buffer = 0.05, pooled = 1
        uint256 util = staking.getBufferUtilization();
        assertEq(util, 500); // 5% in BPS
    }

    // ============ Full Lifecycle ============

    function test_lifecycle_stakeRewardUnstake() public {
        // Alice stakes 10 ether
        _stakeAs(alice, 10 ether);

        // Rewards distributed — rate increases
        staking.distributeRewards{value: 2 ether}();

        // Replenish buffer so alice can unstake
        staking.replenishBuffer{value: 10 ether}();

        _warpPastHold();

        // Alice's vsETH is worth more than 1:1
        assertGt(staking.getEthValue(alice), 10 ether);

        // Unstake half of alice's position
        uint256 halfVsEth = staking.vsEthBalance(alice) / 2;
        uint256 aliceBefore = alice.balance;

        vm.prank(alice);
        staking.unstake(halfVsEth);

        assertGt(alice.balance, aliceBefore);
    }

    // ============ Fuzz ============

    function testFuzz_stake_proportionalMint(uint256 amount) public {
        amount = bound(amount, 0.01 ether, 50 ether);

        _stakeAs(alice, amount);

        // First staker always gets 1:1
        assertEq(staking.vsEthBalance(alice), amount);
    }

    function testFuzz_distributeRewards_rateAlwaysIncreases(uint256 rewards) public {
        rewards = bound(rewards, 1 wei, 10 ether);
        _stakeAs(alice, 1 ether);

        uint256 rateBefore = staking.getExchangeRate();
        staking.distributeRewards{value: rewards}();

        assertGe(staking.getExchangeRate(), rateBefore);
    }
}
