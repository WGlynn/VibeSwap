// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/financial/VibeLiquidStaking.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock ============

contract FuzzMockVIBE is ERC20 {
    constructor() ERC20("VIBE", "VIBE") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Fuzz Tests ============

contract VibeLiquidStakingFuzzTest is Test {
    VibeLiquidStaking public staking;
    FuzzMockVIBE public vibe;

    address oracle = address(0xAA);
    address alice = address(0xA1);

    function setUp() public {
        vibe = new FuzzMockVIBE();

        VibeLiquidStaking impl = new VibeLiquidStaking();
        bytes memory initData = abi.encodeCall(
            VibeLiquidStaking.initialize,
            (oracle, address(vibe))
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        staking = VibeLiquidStaking(payable(address(proxy)));

        vm.deal(alice, type(uint128).max);
        vibe.mint(alice, type(uint128).max);

        vm.prank(alice);
        vibe.approve(address(staking), type(uint256).max);
    }

    // ============ Staking Accounting ============

    /// @notice Shares issued must be proportional to deposit relative to pool
    function testFuzz_stakeSharesProportional(uint256 amount) public {
        amount = bound(amount, 1, 1_000_000 ether);

        // Seed the pool first
        vm.deal(address(this), 100 ether);
        vm.prank(alice);
        staking.stake{value: 100 ether}();

        uint256 expectedShares = (amount * staking.totalSupply()) / staking.totalPooledEther();
        vm.deal(address(0xBB), amount);
        vm.prank(address(0xBB));
        uint256 shares = staking.stake{value: amount}();

        assertEq(shares, expectedShares, "Shares must be proportional to deposit");
    }

    /// @notice First depositor always gets 1:1 shares
    function testFuzz_firstDepositAlways1to1(uint256 amount) public {
        amount = bound(amount, 1, 1_000_000 ether);

        vm.prank(alice);
        uint256 shares = staking.stake{value: amount}();

        assertEq(shares, amount, "First deposit must be 1:1");
    }

    /// @notice Total pooled ETH must increase by exactly the staked amount
    function testFuzz_totalPooledIncreasesByStakeAmount(uint256 amount) public {
        amount = bound(amount, 1, 1_000_000 ether);

        uint256 poolBefore = staking.totalPooledEther();
        vm.prank(alice);
        staking.stake{value: amount}();

        assertEq(staking.totalPooledEther(), poolBefore + amount, "Pool must increase by exact stake amount");
    }

    // ============ VIBE Staking ============

    /// @notice VIBE staking tracks totalVibeStaked correctly
    function testFuzz_vibeStakingAccounting(uint256 amount) public {
        amount = bound(amount, 1, 1_000_000e18);

        vm.prank(alice);
        uint256 shares = staking.stakeVibe(amount);

        assertEq(staking.totalVibeStaked(), amount, "totalVibeStaked must equal deposited amount");
        assertEq(staking.totalPooledEther(), amount, "Pool must track VIBE 1:1");
        assertEq(shares, amount, "First VIBE deposit is 1:1");
    }

    // ============ Exchange Rate ============

    /// @notice Share price must never decrease after rewards (no operator commissions)
    function testFuzz_sharePriceNeverDecreasesAfterRewards(uint256 stakeAmount, uint256 rewards) public {
        stakeAmount = bound(stakeAmount, 1 ether, 1_000_000 ether);
        rewards = bound(rewards, 1, (stakeAmount * 1000) / 10_000); // Up to 10% of pool

        vm.prank(alice);
        staking.stake{value: stakeAmount}();

        uint256 priceBefore = staking.getSharePrice();

        // Simulate validator rewards arriving
        vm.deal(address(staking), address(staking).balance + rewards);
        vm.prank(oracle);
        staking.reportRewards(rewards);

        uint256 priceAfter = staking.getSharePrice();
        assertGe(priceAfter, priceBefore, "Share price must never decrease after rewards");
    }

    /// @notice getPooledEthByShares and getSharesForDeposit are inverse operations
    function testFuzz_sharesAndEthAreInverses(uint256 stakeAmount, uint256 checkAmount) public {
        stakeAmount = bound(stakeAmount, 1 ether, 1_000_000 ether);

        vm.prank(alice);
        staking.stake{value: stakeAmount}();

        checkAmount = bound(checkAmount, 1, stakeAmount);

        // shares → eth → shares should return same or close (rounding)
        uint256 eth = staking.getPooledEthByShares(checkAmount);
        uint256 sharesBack = staking.getSharesForDeposit(eth);

        // Allow 1 wei rounding error
        assertApproxEqAbs(sharesBack, checkAmount, 1, "Shares<->ETH conversion must be near-inverse");
    }

    // ============ Instant Unstake Fee ============

    /// @notice Instant unstake fee is always exactly 0.5% (50 BPS)
    function testFuzz_instantUnstakeFeeExact(uint256 amount) public {
        amount = bound(amount, 1 ether, 100_000 ether);

        vm.warp(1000);
        vm.prank(alice);
        staking.stake{value: amount}();

        vm.warp(1000 + 1 days);

        uint256 feesBefore = staking.accumulatedFees();
        vm.prank(alice);
        uint256 ethReturned = staking.instantUnstake(amount);

        uint256 fee = staking.accumulatedFees() - feesBefore;
        uint256 expectedFee = (amount * 50) / 10_000;

        assertEq(fee, expectedFee, "Fee must be exactly 0.5%");
        assertEq(ethReturned, amount - expectedFee, "Returned must be amount minus fee");
    }

    // ============ Withdrawal Queue ============

    /// @notice Withdrawal request preserves exact ETH value at time of request
    function testFuzz_withdrawalPreservesValue(uint256 stakeAmount, uint256 withdrawShares) public {
        stakeAmount = bound(stakeAmount, 1 ether, 1_000_000 ether);

        vm.prank(alice);
        staking.stake{value: stakeAmount}();

        withdrawShares = bound(withdrawShares, 1, staking.balanceOf(alice));

        uint256 expectedEth = staking.getPooledEthByShares(withdrawShares);

        vm.prank(alice);
        uint256 requestId = staking.requestWithdrawal(withdrawShares);

        (, , uint128 ethAmount, , ) = staking.getWithdrawalRequest(requestId);
        assertEq(uint256(ethAmount), expectedEth, "Withdrawal ETH must match share value at request time");
    }

    /// @notice Pending withdrawal ETH tracking is exact
    function testFuzz_pendingWithdrawalETHTracking(uint256 stakeAmount, uint256 numWithdrawals) public {
        stakeAmount = bound(stakeAmount, 10 ether, 100_000 ether);
        numWithdrawals = bound(numWithdrawals, 1, 10);

        vm.prank(alice);
        staking.stake{value: stakeAmount}();

        uint256 totalPending;
        uint256 sharesPer = staking.balanceOf(alice) / numWithdrawals;
        if (sharesPer == 0) return;

        for (uint256 i; i < numWithdrawals; i++) {
            uint256 sharesToWithdraw = (i == numWithdrawals - 1)
                ? staking.balanceOf(alice)
                : sharesPer;
            if (sharesToWithdraw == 0) break;

            uint256 ethValue = staking.getPooledEthByShares(sharesToWithdraw);
            vm.prank(alice);
            staking.requestWithdrawal(sharesToWithdraw);
            totalPending += ethValue;
        }

        assertEq(staking.pendingWithdrawalETH(), totalPending, "Pending ETH must equal sum of all requests");
    }

    // ============ Oracle Rewards ============

    /// @notice Insurance always gets exactly 5% of rewards
    function testFuzz_insuranceCutExact(uint256 stakeAmount, uint256 rewards) public {
        stakeAmount = bound(stakeAmount, 10 ether, 1_000_000 ether);
        rewards = bound(rewards, 1, (stakeAmount * 1000) / 10_000);

        vm.prank(alice);
        staking.stake{value: stakeAmount}();

        uint256 insuranceBefore = staking.insurancePool();
        vm.deal(address(staking), address(staking).balance + rewards);
        vm.prank(oracle);
        staking.reportRewards(rewards);

        uint256 insuranceCut = staking.insurancePool() - insuranceBefore;
        uint256 expectedCut = (rewards * 500) / 10_000;

        assertEq(insuranceCut, expectedCut, "Insurance must receive exactly 5% of rewards");
    }

    /// @notice Rewards exceeding 10% of pool must revert
    function testFuzz_rewardCapEnforced(uint256 stakeAmount) public {
        stakeAmount = bound(stakeAmount, 1 ether, 1_000_000 ether);

        vm.prank(alice);
        staking.stake{value: stakeAmount}();

        uint256 tooMuch = (stakeAmount * 1001) / 10_000; // 10.01%

        vm.prank(oracle);
        vm.expectRevert(VibeLiquidStaking.RewardTooLarge.selector);
        staking.reportRewards(tooMuch);
    }

    // ============ Operator Commissions ============

    /// @notice Operator commission must not exceed their proportional share
    function testFuzz_operatorCommissionBounded(uint16 commission, uint64 validators) public {
        commission = uint16(bound(commission, 1, 1000)); // 0.01% to 10%
        validators = uint64(bound(validators, 1, 100));

        vm.prank(alice);
        staking.stake{value: 100 ether}();

        staking.addOperator(address(0xC1), "Op1", commission);
        staking.setValidatorCount(address(0xC1), validators);

        uint256 rewards = 1 ether;
        vm.deal(address(staking), address(staking).balance + rewards);
        vm.prank(oracle);
        staking.reportRewards(rewards);

        (, , , , , uint256 opRewards) = staking.getOperator(address(0xC1));

        // Commission = (netRewards * commission) / BPS
        uint256 netRewards = rewards - (rewards * 500) / 10_000; // 95%
        uint256 maxCommission = (netRewards * commission) / 10_000;

        assertLe(opRewards, maxCommission, "Operator commission must not exceed their proportional share");
    }

    // ============ Conservation ============

    /// @notice Total ETH in system (pool + pending + insurance + fees) should equal contract balance
    function testFuzz_conservationOfETH(uint256 stakeAmount, uint256 rewards) public {
        stakeAmount = bound(stakeAmount, 1 ether, 100_000 ether);
        rewards = bound(rewards, 0, (stakeAmount * 1000) / 10_000);

        vm.warp(1000);
        vm.prank(alice);
        staking.stake{value: stakeAmount}();

        if (rewards > 0) {
            vm.deal(address(staking), address(staking).balance + rewards);
            vm.prank(oracle);
            staking.reportRewards(rewards);
        }

        // Instant unstake some
        vm.warp(1000 + 1 days);
        uint256 unstakeShares = staking.balanceOf(alice) / 3;
        if (unstakeShares > 0) {
            vm.prank(alice);
            staking.instantUnstake(unstakeShares);
        }

        // Conservation: contract balance >= pooled + pending + insurance + fees
        // (>= because receive() can accept direct ETH without accounting)
        uint256 accounted = staking.totalPooledEther()
            + staking.pendingWithdrawalETH()
            + staking.insurancePool()
            + staking.accumulatedFees();

        assertGe(
            address(staking).balance,
            accounted,
            "Contract balance must cover all accounted ETH"
        );
    }
}
