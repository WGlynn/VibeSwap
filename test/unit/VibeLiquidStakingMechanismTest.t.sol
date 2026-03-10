// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/VibeLiquidStaking.sol";

/// @title Unit tests for mechanism/VibeLiquidStaking (vsETH — simple liquid staking)
contract VibeLiquidStakingMechanismTest is Test {
    VibeLiquidStaking public staking;

    address alice = address(0xA1);
    address bob = address(0xB0);

    function setUp() public {
        staking = new VibeLiquidStaking();
        staking.initialize();

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
    }

    // ============ Initialization ============

    function test_initialization() public view {
        assertEq(staking.totalVsEth(), 0);
        assertEq(staking.totalPooledEth(), 0);
        assertEq(staking.liquidityBuffer(), 0);
        assertEq(staking.stakerCount(), 0);
    }

    // ============ Staking ============

    function test_stakeFirstDeposit1to1() public {
        vm.prank(alice);
        staking.stake{value: 10 ether}();

        assertEq(staking.vsEthBalance(alice), 10 ether);
        assertEq(staking.totalVsEth(), 10 ether);
        assertEq(staking.totalPooledEth(), 10 ether);
        assertEq(staking.stakerCount(), 1);
    }

    function test_stakeBufferAllocation() public {
        vm.prank(alice);
        staking.stake{value: 10 ether}();

        // Buffer should be 5% of stake
        assertEq(staking.liquidityBuffer(), 0.5 ether);
    }

    function test_stakeMultipleUsers() public {
        vm.prank(alice);
        staking.stake{value: 10 ether}();

        vm.prank(bob);
        staking.stake{value: 5 ether}();

        assertEq(staking.totalVsEth(), 15 ether);
        assertEq(staking.totalPooledEth(), 15 ether);
        assertEq(staking.stakerCount(), 2);
    }

    function test_stakeAfterRewardsGetFewerVsEth() public {
        vm.prank(alice);
        staking.stake{value: 10 ether}();

        // Distribute 1 ETH rewards
        staking.distributeRewards{value: 1 ether}();

        // Bob stakes 10 ETH — should get fewer vsETH
        vm.prank(bob);
        staking.stake{value: 10 ether}();

        assertLt(staking.vsEthBalance(bob), 10 ether);
    }

    function test_revertStakeBelowMinimum() public {
        vm.prank(alice);
        vm.expectRevert("Below minimum");
        staking.stake{value: 0.001 ether}();
    }

    function test_stakeUpdatesStakedAt() public {
        vm.warp(5000);
        vm.prank(alice);
        staking.stake{value: 1 ether}();

        assertEq(staking.stakedAt(alice), 5000);
    }

    function test_stakeIncreasesStakerCountOnce() public {
        vm.prank(alice);
        staking.stake{value: 1 ether}();
        assertEq(staking.stakerCount(), 1);

        // Stake again — count should not increase
        vm.prank(alice);
        staking.stake{value: 1 ether}();
        assertEq(staking.stakerCount(), 1);
    }

    // ============ Unstaking ============

    function test_unstake() public {
        vm.warp(1000);
        vm.prank(alice);
        staking.stake{value: 10 ether}();

        vm.warp(1000 + 1 days);

        uint256 balanceBefore = alice.balance;
        // Buffer = 0.5 ETH, so can only unstake up to 0.5 ETH worth
        uint256 maxUnstakeVsEth = (staking.liquidityBuffer() * staking.totalVsEth()) / staking.totalPooledEth();
        vm.prank(alice);
        staking.unstake(maxUnstakeVsEth);

        assertGt(alice.balance, balanceBefore);
    }

    function test_unstakeDecreasesStakerCount() public {
        vm.warp(1000);
        vm.prank(alice);
        staking.stake{value: 1 ether}();

        vm.warp(1000 + 1 days);

        // Replenish buffer to allow full unstake
        staking.replenishBuffer{value: 10 ether}();

        uint256 aliceVsEth = staking.vsEthBalance(alice);
        vm.prank(alice);
        staking.unstake(aliceVsEth);

        assertEq(staking.stakerCount(), 0);
    }

    function test_revertUnstakeHoldPeriod() public {
        vm.warp(1000);
        vm.prank(alice);
        staking.stake{value: 1 ether}();

        vm.warp(1000 + 12 hours);

        vm.prank(alice);
        vm.expectRevert("Hold period active");
        staking.unstake(1);
    }

    function test_revertUnstakeZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert("Zero amount");
        staking.unstake(0);
    }

    function test_revertUnstakeInsufficientBalance() public {
        vm.prank(alice);
        vm.expectRevert("Insufficient vsETH");
        staking.unstake(1 ether);
    }

    function test_revertUnstakeInsufficientLiquidity() public {
        vm.warp(1000);
        vm.prank(alice);
        staking.stake{value: 10 ether}();

        vm.warp(1000 + 1 days);

        // Try to unstake more than buffer allows
        vm.prank(alice);
        vm.expectRevert("Insufficient liquidity");
        staking.unstake(10 ether);
    }

    // ============ Rewards ============

    function test_distributeRewards() public {
        vm.prank(alice);
        staking.stake{value: 10 ether}();

        staking.distributeRewards{value: 1 ether}();

        // 10% protocol fee = 0.1 ETH
        assertEq(staking.protocolFees(), 0.1 ether);
        assertEq(staking.totalRewardsDistributed(), 0.9 ether);
        // Pool increased by net rewards
        assertEq(staking.totalPooledEth(), 10.9 ether);
    }

    function test_distributeRewardsBuffer() public {
        vm.prank(alice);
        staking.stake{value: 10 ether}();

        uint256 bufferBefore = staking.liquidityBuffer();
        staking.distributeRewards{value: 1 ether}();

        // Buffer should increase by 5% of net rewards
        uint256 bufferAdd = (0.9 ether * 500) / 10000;
        assertEq(staking.liquidityBuffer(), bufferBefore + bufferAdd);
    }

    function test_revertRewardsZero() public {
        vm.prank(alice);
        staking.stake{value: 1 ether}();

        vm.expectRevert("Zero rewards");
        staking.distributeRewards{value: 0}();
    }

    function test_revertRewardsNoStakers() public {
        vm.expectRevert("No stakers");
        staking.distributeRewards{value: 1 ether}();
    }

    function test_revertRewardsNotOwner() public {
        vm.prank(alice);
        staking.stake{value: 1 ether}();

        vm.prank(alice);
        vm.expectRevert();
        staking.distributeRewards{value: 1 ether}();
    }

    // ============ Admin ============

    function test_withdrawProtocolFees() public {
        vm.prank(alice);
        staking.stake{value: 10 ether}();
        staking.distributeRewards{value: 1 ether}();

        uint256 fees = staking.protocolFees();
        uint256 ownerBefore = address(this).balance;

        staking.withdrawProtocolFees();

        assertEq(staking.protocolFees(), 0);
        assertEq(address(this).balance, ownerBefore + fees);
    }

    function test_replenishBuffer() public {
        uint256 bufferBefore = staking.liquidityBuffer();
        staking.replenishBuffer{value: 5 ether}();

        assertEq(staking.liquidityBuffer(), bufferBefore + 5 ether);
    }

    // ============ Views ============

    function test_getExchangeRateInitial() public view {
        assertEq(staking.getExchangeRate(), 1 ether);
    }

    function test_getExchangeRateAfterRewards() public {
        vm.prank(alice);
        staking.stake{value: 10 ether}();
        staking.distributeRewards{value: 1 ether}();

        uint256 rate = staking.getExchangeRate();
        assertGt(rate, 1 ether);
    }

    function test_getEthValue() public {
        vm.prank(alice);
        staking.stake{value: 10 ether}();

        assertEq(staking.getEthValue(alice), 10 ether);

        staking.distributeRewards{value: 1 ether}();
        assertGt(staking.getEthValue(alice), 10 ether);
    }

    function test_getBufferUtilization() public {
        vm.prank(alice);
        staking.stake{value: 10 ether}();

        uint256 util = staking.getBufferUtilization();
        assertEq(util, 500); // 5% = 500 BPS
    }

    function test_getBufferUtilizationEmpty() public view {
        assertEq(staking.getBufferUtilization(), 0);
    }

    // ============ Integration ============

    function test_exchangeRateMonotonicallyIncreases() public {
        vm.prank(alice);
        staking.stake{value: 10 ether}();

        uint256 rate1 = staking.getExchangeRate();

        for (uint256 i = 0; i < 3; i++) {
            staking.distributeRewards{value: 0.5 ether}();
            uint256 newRate = staking.getExchangeRate();
            assertGt(newRate, rate1, "Rate must increase after rewards");
            rate1 = newRate;
        }
    }

    function test_receiveETH() public {
        (bool ok, ) = address(staking).call{value: 1 ether}("");
        assertTrue(ok);
    }

    // Allow receiving ETH for fee withdrawals
    receive() external payable {}
}
