// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/financial/VibeLiquidStaking.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock VIBE Token ============

contract MockStakingVIBE is ERC20 {
    constructor() ERC20("VIBE", "VIBE") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Unit Tests ============

contract VibeLiquidStakingTest is Test {
    VibeLiquidStaking public staking;
    MockStakingVIBE public vibe;

    address oracle = address(0xAA);
    address alice = address(0xA1);
    address bob = address(0xB0);
    address operator1 = address(0xC1);
    address operator2 = address(0xC2);
    address operator3 = address(0xC3);
    address treasury = address(0xDD);

    function setUp() public {
        vibe = new MockStakingVIBE();

        // Deploy via UUPS proxy
        VibeLiquidStaking impl = new VibeLiquidStaking();
        bytes memory initData = abi.encodeCall(
            VibeLiquidStaking.initialize,
            (oracle, address(vibe))
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        staking = VibeLiquidStaking(payable(address(proxy)));

        // Fund test accounts
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);

        // Mint VIBE for testing
        vibe.mint(alice, 1_000_000e18);
        vibe.mint(bob, 1_000_000e18);

        // Approve VIBE spending
        vm.prank(alice);
        vibe.approve(address(staking), type(uint256).max);
        vm.prank(bob);
        vibe.approve(address(staking), type(uint256).max);
    }

    // ============ Initialization ============

    function test_initialization() public view {
        assertEq(staking.name(), "Staked VIBE");
        assertEq(staking.symbol(), "stVIBE");
        assertEq(staking.oracle(), oracle);
        assertEq(address(staking.vibeToken()), address(vibe));
        assertEq(staking.totalPooledEther(), 0);
        assertEq(staking.insurancePool(), 0);
        assertEq(staking.nextRequestId(), 1);
        assertEq(staking.totalSupply(), 0);
    }

    function test_revertReinitialize() public {
        vm.expectRevert();
        staking.initialize(oracle, address(vibe));
    }

    function test_revertZeroOracleOnInit() public {
        VibeLiquidStaking impl2 = new VibeLiquidStaking();
        vm.expectRevert(VibeLiquidStaking.ZeroAddress.selector);
        new ERC1967Proxy(
            address(impl2),
            abi.encodeCall(VibeLiquidStaking.initialize, (address(0), address(vibe)))
        );
    }

    function test_initWithoutVibeToken() public {
        VibeLiquidStaking impl2 = new VibeLiquidStaking();
        ERC1967Proxy proxy2 = new ERC1967Proxy(
            address(impl2),
            abi.encodeCall(VibeLiquidStaking.initialize, (oracle, address(0)))
        );
        VibeLiquidStaking s2 = VibeLiquidStaking(payable(address(proxy2)));
        assertEq(address(s2.vibeToken()), address(0));
    }

    // ============ ETH Staking ============

    function test_stakeETH() public {
        vm.prank(alice);
        uint256 shares = staking.stake{value: 10 ether}();

        assertEq(shares, 10 ether); // First deposit is 1:1
        assertEq(staking.balanceOf(alice), 10 ether);
        assertEq(staking.totalPooledEther(), 10 ether);
        assertEq(staking.totalSupply(), 10 ether);
    }

    function test_stakeETHMultipleUsers() public {
        // Alice stakes first — 1:1
        vm.prank(alice);
        staking.stake{value: 10 ether}();

        // Bob stakes second — same rate (no rewards yet)
        vm.prank(bob);
        uint256 bobShares = staking.stake{value: 5 ether}();

        assertEq(bobShares, 5 ether);
        assertEq(staking.totalPooledEther(), 15 ether);
        assertEq(staking.totalSupply(), 15 ether);
    }

    function test_stakeETHAfterRewardsGetFewerShares() public {
        // Alice stakes 10 ETH (gets 10 shares)
        vm.prank(alice);
        staking.stake{value: 10 ether}();

        // Oracle reports 1 ETH rewards → pool = 10.95 ETH (after 5% insurance)
        vm.prank(oracle);
        staking.reportRewards(1 ether);

        uint256 poolAfterRewards = staking.totalPooledEther();
        assertGt(poolAfterRewards, 10 ether);

        // Bob stakes 10 ETH — gets fewer shares because share price increased
        vm.prank(bob);
        uint256 bobShares = staking.stake{value: 10 ether}();

        assertLt(bobShares, 10 ether);
        assertEq(staking.balanceOf(bob), bobShares);
    }

    function test_revertStakeZeroETH() public {
        vm.prank(alice);
        vm.expectRevert(VibeLiquidStaking.NoETHSent.selector);
        staking.stake{value: 0}();
    }

    function test_stakeUpdatesLastStakeTimestamp() public {
        vm.warp(1000);
        vm.prank(alice);
        staking.stake{value: 1 ether}();
        assertEq(staking.lastStakeTimestamp(alice), 1000);
    }

    // ============ VIBE Staking ============

    function test_stakeVibe() public {
        uint256 amount = 1000e18;
        vm.prank(alice);
        uint256 shares = staking.stakeVibe(amount);

        assertEq(shares, amount); // First deposit 1:1
        assertEq(staking.balanceOf(alice), amount);
        assertEq(staking.totalPooledEther(), amount);
        assertEq(staking.totalVibeStaked(), amount);
    }

    function test_revertStakeVibeZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(VibeLiquidStaking.ZeroAmount.selector);
        staking.stakeVibe(0);
    }

    function test_revertStakeVibeNoVibeToken() public {
        // Deploy staking without VIBE token
        VibeLiquidStaking impl2 = new VibeLiquidStaking();
        ERC1967Proxy proxy2 = new ERC1967Proxy(
            address(impl2),
            abi.encodeCall(VibeLiquidStaking.initialize, (oracle, address(0)))
        );
        VibeLiquidStaking noVibe = VibeLiquidStaking(payable(address(proxy2)));

        vm.prank(alice);
        vm.expectRevert(VibeLiquidStaking.OnlyVibeMode.selector);
        noVibe.stakeVibe(1000e18);
    }

    function test_stakeVibeTransfersTokens() public {
        uint256 balanceBefore = vibe.balanceOf(alice);
        uint256 amount = 5000e18;

        vm.prank(alice);
        staking.stakeVibe(amount);

        assertEq(vibe.balanceOf(alice), balanceBefore - amount);
        assertEq(vibe.balanceOf(address(staking)), amount);
    }

    // ============ Withdrawal Queue ============

    function test_requestWithdrawal() public {
        // Stake first
        vm.prank(alice);
        staking.stake{value: 10 ether}();

        // Request withdrawal
        vm.prank(alice);
        uint256 requestId = staking.requestWithdrawal(5 ether);

        assertEq(requestId, 1);
        assertEq(staking.balanceOf(alice), 5 ether); // Shares burned
        assertEq(staking.totalPooledEther(), 5 ether);
        assertEq(staking.pendingWithdrawalETH(), 5 ether);
        assertEq(staking.nextRequestId(), 2);

        (address owner, uint128 shares, uint128 ethAmount, uint40 claimableAt, bool claimed) =
            staking.getWithdrawalRequest(requestId);

        assertEq(owner, alice);
        assertEq(shares, 5 ether);
        assertEq(ethAmount, 5 ether);
        assertEq(claimableAt, block.timestamp + 7 days);
        assertFalse(claimed);
    }

    function test_claimWithdrawal() public {
        vm.prank(alice);
        staking.stake{value: 10 ether}();

        vm.prank(alice);
        uint256 requestId = staking.requestWithdrawal(5 ether);

        // Fast forward past unbonding
        vm.warp(block.timestamp + 7 days);

        uint256 balanceBefore = alice.balance;
        vm.prank(alice);
        staking.claimWithdrawal(requestId);

        assertEq(alice.balance, balanceBefore + 5 ether);
        assertEq(staking.pendingWithdrawalETH(), 0);

        (, , , , bool claimed) = staking.getWithdrawalRequest(requestId);
        assertTrue(claimed);
    }

    function test_revertClaimBeforeUnbonding() public {
        vm.prank(alice);
        staking.stake{value: 10 ether}();

        vm.prank(alice);
        uint256 requestId = staking.requestWithdrawal(5 ether);

        // Try to claim before unbonding period
        vm.prank(alice);
        vm.expectRevert(VibeLiquidStaking.WithdrawalNotReady.selector);
        staking.claimWithdrawal(requestId);
    }

    function test_revertClaimWrongOwner() public {
        vm.prank(alice);
        staking.stake{value: 10 ether}();

        vm.prank(alice);
        uint256 requestId = staking.requestWithdrawal(5 ether);

        vm.warp(block.timestamp + 7 days);

        // Bob tries to claim Alice's withdrawal
        vm.prank(bob);
        vm.expectRevert(VibeLiquidStaking.InsufficientShares.selector);
        staking.claimWithdrawal(requestId);
    }

    function test_revertClaimAlreadyClaimed() public {
        vm.prank(alice);
        staking.stake{value: 10 ether}();

        vm.prank(alice);
        uint256 requestId = staking.requestWithdrawal(5 ether);

        vm.warp(block.timestamp + 7 days);

        vm.prank(alice);
        staking.claimWithdrawal(requestId);

        // Try to claim again
        vm.prank(alice);
        vm.expectRevert(VibeLiquidStaking.WithdrawalAlreadyClaimed.selector);
        staking.claimWithdrawal(requestId);
    }

    function test_revertRequestZeroShares() public {
        vm.prank(alice);
        vm.expectRevert(VibeLiquidStaking.ZeroAmount.selector);
        staking.requestWithdrawal(0);
    }

    function test_revertRequestInsufficientShares() public {
        vm.prank(alice);
        staking.stake{value: 5 ether}();

        vm.prank(alice);
        vm.expectRevert(VibeLiquidStaking.InsufficientShares.selector);
        staking.requestWithdrawal(10 ether);
    }

    function test_multipleWithdrawalRequests() public {
        vm.prank(alice);
        staking.stake{value: 10 ether}();

        vm.prank(alice);
        uint256 id1 = staking.requestWithdrawal(3 ether);
        vm.prank(alice);
        uint256 id2 = staking.requestWithdrawal(3 ether);

        assertEq(id1, 1);
        assertEq(id2, 2);
        assertEq(staking.pendingWithdrawalETH(), 6 ether);
        assertEq(staking.balanceOf(alice), 4 ether);
    }

    // ============ Instant Unstake ============

    function test_instantUnstake() public {
        vm.warp(1000);
        vm.prank(alice);
        staking.stake{value: 10 ether}();

        // Fast forward past hold period
        vm.warp(1000 + 1 days);

        uint256 balanceBefore = alice.balance;
        vm.prank(alice);
        uint256 ethReturned = staking.instantUnstake(5 ether);

        // 5 ETH minus 0.5% fee = 4.975 ETH
        uint256 expectedFee = (5 ether * 50) / 10_000;
        uint256 expectedReturn = 5 ether - expectedFee;

        assertEq(ethReturned, expectedReturn);
        assertEq(alice.balance, balanceBefore + expectedReturn);
        assertEq(staking.accumulatedFees(), expectedFee);
        assertEq(staking.balanceOf(alice), 5 ether);
    }

    function test_instantUnstakeFeeCalculation() public {
        vm.warp(1000);
        vm.prank(alice);
        staking.stake{value: 100 ether}();

        vm.warp(1000 + 1 days);

        vm.prank(alice);
        uint256 ethReturned = staking.instantUnstake(100 ether);

        // 100 ETH * 0.5% = 0.5 ETH fee
        assertEq(staking.accumulatedFees(), 0.5 ether);
        assertEq(ethReturned, 99.5 ether);
    }

    function test_revertInstantUnstakeHoldPeriod() public {
        vm.warp(1000);
        vm.prank(alice);
        staking.stake{value: 10 ether}();

        // Try to instant unstake before 1 day hold period
        vm.warp(1000 + 12 hours);
        vm.prank(alice);
        vm.expectRevert("Must hold stVIBE for 1 day before instant unstake");
        staking.instantUnstake(5 ether);
    }

    function test_revertInstantUnstakeZeroShares() public {
        vm.prank(alice);
        vm.expectRevert(VibeLiquidStaking.ZeroAmount.selector);
        staking.instantUnstake(0);
    }

    function test_revertInstantUnstakeInsufficientShares() public {
        vm.warp(1000);
        vm.prank(alice);
        staking.stake{value: 5 ether}();

        vm.warp(1000 + 1 days);

        vm.prank(alice);
        vm.expectRevert(VibeLiquidStaking.InsufficientShares.selector);
        staking.instantUnstake(10 ether);
    }

    // ============ Oracle Rewards ============

    function test_reportRewards() public {
        // Need pool > 0
        vm.prank(alice);
        staking.stake{value: 100 ether}();

        uint256 rewards = 1 ether;
        vm.prank(oracle);
        staking.reportRewards(rewards);

        // Insurance: 5% of 1 ETH = 0.05 ETH
        // Net: 0.95 ETH added to pool (minus any operator commissions)
        assertEq(staking.insurancePool(), 0.05 ether);
        // No operators → full net goes to pool
        assertEq(staking.totalPooledEther(), 100.95 ether);
        assertEq(staking.lastReportTimestamp(), block.timestamp);
    }

    function test_reportRewardsInsuranceCut() public {
        vm.prank(alice);
        staking.stake{value: 50 ether}();

        vm.prank(oracle);
        staking.reportRewards(5 ether);

        // 5% of 5 ETH = 0.25 ETH to insurance
        assertEq(staking.insurancePool(), 0.25 ether);
    }

    function test_reportRewardsWithOperators() public {
        vm.prank(alice);
        staking.stake{value: 100 ether}();

        // Add operator with 5% commission, 10 validators
        staking.addOperator(operator1, "Node1", 500);
        staking.setValidatorCount(operator1, 10);

        uint256 rewards = 10 ether;
        vm.prank(oracle);
        staking.reportRewards(rewards);

        // Insurance: 5% of 10 = 0.5 ETH
        // Net: 9.5 ETH
        // Operator commission: 5% of 9.5 ETH = 0.475 ETH (operator has 100% of validators)
        // Staker rewards: 9.5 - 0.475 = 9.025 ETH
        assertEq(staking.insurancePool(), 0.5 ether);

        (, , , , , uint256 opRewards) = staking.getOperator(operator1);
        assertEq(opRewards, 0.475 ether);

        assertEq(staking.totalPooledEther(), 100 ether + 9.025 ether);
    }

    function test_reportRewardsMultipleOperators() public {
        vm.prank(alice);
        staking.stake{value: 100 ether}();

        // Op1: 5% commission, 10 validators
        // Op2: 10% commission, 10 validators
        staking.addOperator(operator1, "Node1", 500);
        staking.setValidatorCount(operator1, 10);
        staking.addOperator(operator2, "Node2", 1000);
        staking.setValidatorCount(operator2, 10);

        vm.prank(oracle);
        staking.reportRewards(10 ether);

        // Net = 9.5 ETH (after 5% insurance)
        // Each operator gets 50% of net (equal validators)
        // Op1 commission: 5% of 4.75 = 0.2375 ETH
        // Op2 commission: 10% of 4.75 = 0.475 ETH
        (, , , , , uint256 op1Rewards) = staking.getOperator(operator1);
        (, , , , , uint256 op2Rewards) = staking.getOperator(operator2);

        assertEq(op1Rewards, 0.2375 ether);
        assertEq(op2Rewards, 0.475 ether);
    }

    function test_revertRewardsUnauthorized() public {
        vm.prank(alice);
        staking.stake{value: 10 ether}();

        vm.prank(alice);
        vm.expectRevert(VibeLiquidStaking.UnauthorizedOracle.selector);
        staking.reportRewards(1 ether);
    }

    function test_revertRewardsZero() public {
        vm.prank(oracle);
        vm.expectRevert(VibeLiquidStaking.ZeroAmount.selector);
        staking.reportRewards(0);
    }

    function test_revertRewardsTooLarge() public {
        vm.prank(alice);
        staking.stake{value: 10 ether}();

        // Max reward = 10% of 10 ETH = 1 ETH
        vm.prank(oracle);
        vm.expectRevert(VibeLiquidStaking.RewardTooLarge.selector);
        staking.reportRewards(2 ether);
    }

    function test_reportRewardsAtMaxBoundary() public {
        vm.prank(alice);
        staking.stake{value: 10 ether}();

        // Exactly 10% should work
        vm.prank(oracle);
        staking.reportRewards(1 ether);

        // Pool grew, so verify it was accepted
        assertGt(staking.totalPooledEther(), 10 ether);
    }

    // ============ Node Operators ============

    function test_addOperator() public {
        staking.addOperator(operator1, "TestNode", 500);

        (address rewardAddr, string memory name, uint64 valCount, uint16 commission, bool active, uint256 earned) =
            staking.getOperator(operator1);

        assertEq(rewardAddr, operator1);
        assertEq(name, "TestNode");
        assertEq(valCount, 0);
        assertEq(commission, 500);
        assertTrue(active);
        assertEq(earned, 0);
        assertEq(staking.getOperatorCount(), 1);
        assertEq(staking.getOperatorByIndex(0), operator1);
    }

    function test_removeOperator() public {
        staking.addOperator(operator1, "Node1", 500);
        staking.addOperator(operator2, "Node2", 300);

        assertEq(staking.getOperatorCount(), 2);

        staking.removeOperator(operator1);
        assertEq(staking.getOperatorCount(), 1);
        // Swap-and-pop: operator2 moves to index 0
        assertEq(staking.getOperatorByIndex(0), operator2);
    }

    function test_setOperatorActive() public {
        staking.addOperator(operator1, "Node1", 500);

        staking.setOperatorActive(operator1, false);
        (, , , , bool active, ) = staking.getOperator(operator1);
        assertFalse(active);

        staking.setOperatorActive(operator1, true);
        (, , , , active, ) = staking.getOperator(operator1);
        assertTrue(active);
    }

    function test_setOperatorCommission() public {
        staking.addOperator(operator1, "Node1", 500);

        staking.setOperatorCommission(operator1, 800);
        (, , , uint16 commission, , ) = staking.getOperator(operator1);
        assertEq(commission, 800);
    }

    function test_setValidatorCount() public {
        staking.addOperator(operator1, "Node1", 500);

        staking.setValidatorCount(operator1, 32);
        (, , uint64 valCount, , , ) = staking.getOperator(operator1);
        assertEq(valCount, 32);
    }

    function test_revertAddDuplicateOperator() public {
        staking.addOperator(operator1, "Node1", 500);

        vm.expectRevert(VibeLiquidStaking.OperatorAlreadyRegistered.selector);
        staking.addOperator(operator1, "Node1Again", 500);
    }

    function test_revertAddZeroAddressOperator() public {
        vm.expectRevert(VibeLiquidStaking.ZeroAddress.selector);
        staking.addOperator(address(0), "Bad", 500);
    }

    function test_revertInvalidCommission() public {
        // > 10% (1000 BPS)
        vm.expectRevert(VibeLiquidStaking.InvalidCommission.selector);
        staking.addOperator(operator1, "Greedy", 1001);
    }

    function test_revertSetInvalidCommission() public {
        staking.addOperator(operator1, "Node1", 500);

        vm.expectRevert(VibeLiquidStaking.InvalidCommission.selector);
        staking.setOperatorCommission(operator1, 1001);
    }

    function test_revertRemoveUnregisteredOperator() public {
        vm.expectRevert(VibeLiquidStaking.OperatorNotRegistered.selector);
        staking.removeOperator(operator1);
    }

    function test_revertSetActiveUnregisteredOperator() public {
        vm.expectRevert(VibeLiquidStaking.OperatorNotRegistered.selector);
        staking.setOperatorActive(operator1, false);
    }

    function test_revertSetCommissionUnregisteredOperator() public {
        vm.expectRevert(VibeLiquidStaking.OperatorNotRegistered.selector);
        staking.setOperatorCommission(operator1, 500);
    }

    function test_revertSetValidatorsUnregisteredOperator() public {
        vm.expectRevert(VibeLiquidStaking.OperatorNotRegistered.selector);
        staking.setValidatorCount(operator1, 10);
    }

    function test_operatorOnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        staking.addOperator(operator1, "Bad", 500);
    }

    function test_inactiveOperatorDoesNotEarnCommission() public {
        vm.prank(alice);
        staking.stake{value: 100 ether}();

        staking.addOperator(operator1, "Node1", 1000);
        staking.setValidatorCount(operator1, 10);
        staking.setOperatorActive(operator1, false);

        vm.prank(oracle);
        staking.reportRewards(1 ether);

        // Inactive operator earns nothing
        (, , , , , uint256 opRewards) = staking.getOperator(operator1);
        assertEq(opRewards, 0);
        // Full net rewards go to stakers
        assertEq(staking.totalPooledEther(), 100.95 ether);
    }

    // ============ Insurance ============

    function test_coverSlashing() public {
        // Build insurance via rewards
        vm.prank(alice);
        staking.stake{value: 100 ether}();

        vm.prank(oracle);
        staking.reportRewards(10 ether);

        uint256 insurance = staking.insurancePool(); // 0.5 ETH
        uint256 poolBefore = staking.totalPooledEther();

        staking.coverSlashing(insurance);

        assertEq(staking.insurancePool(), 0);
        assertEq(staking.totalPooledEther(), poolBefore + insurance);
    }

    function test_revertCoverSlashingInsufficientFunds() public {
        vm.expectRevert(VibeLiquidStaking.InsuranceInsufficientFunds.selector);
        staking.coverSlashing(1 ether);
    }

    function test_withdrawInsurance() public {
        vm.prank(alice);
        staking.stake{value: 100 ether}();

        vm.prank(oracle);
        staking.reportRewards(10 ether);

        uint256 insurance = staking.insurancePool();
        uint256 treasuryBefore = treasury.balance;

        staking.withdrawInsurance(treasury, insurance);

        assertEq(staking.insurancePool(), 0);
        assertEq(treasury.balance, treasuryBefore + insurance);
    }

    function test_revertWithdrawInsuranceZeroAddress() public {
        vm.prank(alice);
        staking.stake{value: 100 ether}();
        vm.prank(oracle);
        staking.reportRewards(1 ether);

        vm.expectRevert(VibeLiquidStaking.ZeroAddress.selector);
        staking.withdrawInsurance(address(0), 1);
    }

    function test_revertWithdrawInsuranceInsufficientFunds() public {
        vm.expectRevert(VibeLiquidStaking.InsuranceInsufficientFunds.selector);
        staking.withdrawInsurance(treasury, 1 ether);
    }

    function test_coverSlashingOnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        staking.coverSlashing(0);
    }

    // ============ Admin ============

    function test_setOracle() public {
        address newOracle = address(0xBBBB);
        staking.setOracle(newOracle);
        assertEq(staking.oracle(), newOracle);
    }

    function test_revertSetOracleZeroAddress() public {
        vm.expectRevert(VibeLiquidStaking.ZeroAddress.selector);
        staking.setOracle(address(0));
    }

    function test_setVibeToken() public {
        MockStakingVIBE newVibe = new MockStakingVIBE();
        staking.setVibeToken(address(newVibe));
        assertEq(address(staking.vibeToken()), address(newVibe));
    }

    function test_revertSetVibeTokenZeroAddress() public {
        vm.expectRevert(VibeLiquidStaking.ZeroAddress.selector);
        staking.setVibeToken(address(0));
    }

    function test_withdrawFees() public {
        // Generate fees via instant unstake
        vm.warp(1000);
        vm.prank(alice);
        staking.stake{value: 100 ether}();
        vm.warp(1000 + 1 days);
        vm.prank(alice);
        staking.instantUnstake(100 ether);

        uint256 fees = staking.accumulatedFees();
        assertGt(fees, 0);

        uint256 treasuryBefore = treasury.balance;
        staking.withdrawFees(treasury);

        assertEq(staking.accumulatedFees(), 0);
        assertEq(treasury.balance, treasuryBefore + fees);
    }

    function test_revertWithdrawFeesNothingToClaim() public {
        vm.expectRevert(VibeLiquidStaking.NothingToClaim.selector);
        staking.withdrawFees(treasury);
    }

    function test_revertWithdrawFeesZeroAddress() public {
        // Generate some fees first
        vm.warp(1000);
        vm.prank(alice);
        staking.stake{value: 10 ether}();
        vm.warp(1000 + 1 days);
        vm.prank(alice);
        staking.instantUnstake(10 ether);

        vm.expectRevert(VibeLiquidStaking.ZeroAddress.selector);
        staking.withdrawFees(address(0));
    }

    // ============ Views ============

    function test_getSharePriceInitial() public view {
        // No deposits — default 1:1
        assertEq(staking.getSharePrice(), 1e18);
    }

    function test_getSharePriceAfterDeposit() public {
        vm.prank(alice);
        staking.stake{value: 10 ether}();
        assertEq(staking.getSharePrice(), 1e18); // Still 1:1
    }

    function test_getSharePriceAfterRewards() public {
        vm.prank(alice);
        staking.stake{value: 100 ether}();

        vm.prank(oracle);
        staking.reportRewards(10 ether);

        // Pool grew to 109.5 ETH (10 rewards - 5% insurance = 9.5 net, no operators)
        // Share price = 109.5 / 100 = 1.095e18
        uint256 price = staking.getSharePrice();
        assertGt(price, 1e18);
        assertEq(price, (109.5 ether * 1e18) / 100 ether);
    }

    function test_getPooledEthByShares() public {
        vm.prank(alice);
        staking.stake{value: 10 ether}();

        assertEq(staking.getPooledEthByShares(5 ether), 5 ether);
    }

    function test_getSharesForDeposit() public {
        vm.prank(alice);
        staking.stake{value: 10 ether}();

        assertEq(staking.getSharesForDeposit(5 ether), 5 ether);
    }

    function test_totalValueLocked() public {
        vm.prank(alice);
        staking.stake{value: 20 ether}();

        // Request withdrawal for 5 ETH
        vm.prank(alice);
        staking.requestWithdrawal(5 ether);

        // Report rewards
        vm.prank(oracle);
        staking.reportRewards(1 ether);

        // TVL = pooledEther + pendingWithdrawals + insurance
        uint256 tvl = staking.totalValueLocked();
        uint256 expected = staking.totalPooledEther() + staking.pendingWithdrawalETH() + staking.insurancePool();
        assertEq(tvl, expected);
    }

    // ============ Integration: Full Lifecycle ============

    function test_fullStakeRewardUnstakeLifecycle() public {
        // 1. Alice stakes 50 ETH
        vm.warp(1000);
        vm.prank(alice);
        staking.stake{value: 50 ether}();
        assertEq(staking.balanceOf(alice), 50 ether);

        // 2. Bob stakes 50 ETH
        vm.prank(bob);
        staking.stake{value: 50 ether}();
        assertEq(staking.totalPooledEther(), 100 ether);

        // 3. Oracle reports 10 ETH rewards (simulate validator rewards arriving first)
        vm.deal(address(staking), address(staking).balance + 10 ether);
        vm.prank(oracle);
        staking.reportRewards(10 ether);

        // Pool: 109.5 ETH (after 5% insurance)
        // Insurance: 0.5 ETH
        assertEq(staking.totalPooledEther(), 109.5 ether);
        assertEq(staking.insurancePool(), 0.5 ether);

        // 4. Share price increased — both hold same shares, proportional value
        uint256 aliceValue = staking.getPooledEthByShares(staking.balanceOf(alice));
        uint256 bobValue = staking.getPooledEthByShares(staking.balanceOf(bob));
        assertEq(aliceValue, bobValue); // Equal shares → equal value
        assertGt(aliceValue, 50 ether); // More than initial stake

        // 5. Alice instant unstakes (after hold period)
        vm.warp(1000 + 1 days);
        uint256 aliceShares = staking.balanceOf(alice);
        vm.prank(alice);
        uint256 aliceReturned = staking.instantUnstake(aliceShares);
        assertGt(aliceReturned, 49 ether); // Profit minus 0.5% fee

        // 6. Bob requests standard withdrawal
        uint256 bobShares = staking.balanceOf(bob);
        vm.prank(bob);
        uint256 requestId = staking.requestWithdrawal(bobShares);

        // 7. Bob claims after unbonding
        vm.warp(block.timestamp + 7 days);
        uint256 bobBefore = bob.balance;
        vm.prank(bob);
        staking.claimWithdrawal(requestId);
        uint256 bobReturned = bob.balance - bobBefore;
        assertGt(bobReturned, 50 ether); // Full value, no fee

        // 8. Verify pool is essentially empty
        assertEq(staking.totalSupply(), 0);
        assertEq(staking.totalPooledEther(), 0);
    }

    function test_sharePriceMonotonicallyIncreases() public {
        vm.prank(alice);
        staking.stake{value: 100 ether}();

        uint256 price1 = staking.getSharePrice();

        // Report rewards 3 times
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(oracle);
            staking.reportRewards(1 ether);

            uint256 newPrice = staking.getSharePrice();
            assertGt(newPrice, price1, "Share price must increase after rewards");
            price1 = newPrice;
        }
    }

    function test_withdrawalQueueDoesNotAffectSharePrice() public {
        vm.prank(alice);
        staking.stake{value: 100 ether}();

        uint256 priceBefore = staking.getSharePrice();

        // Alice withdraws half
        vm.prank(alice);
        staking.requestWithdrawal(50 ether);

        uint256 priceAfter = staking.getSharePrice();
        assertEq(priceAfter, priceBefore, "Withdrawal should not affect share price");
    }

    // ============ Edge Cases ============

    function test_receiveETH() public {
        // Contract can receive ETH directly (validator rewards)
        vm.deal(address(this), 1 ether);
        (bool ok, ) = address(staking).call{value: 1 ether}("");
        assertTrue(ok);
    }

    function test_stakeVibeAndETHSameUser() public {
        vm.warp(1000);

        // Stake ETH
        vm.prank(alice);
        uint256 ethShares = staking.stake{value: 10 ether}();

        // Stake VIBE
        vm.prank(alice);
        uint256 vibeShares = staking.stakeVibe(10e18);

        assertEq(staking.balanceOf(alice), ethShares + vibeShares);
        assertEq(staking.totalVibeStaked(), 10e18);
    }

    function test_operatorWithZeroValidatorsEarnsNothing() public {
        vm.prank(alice);
        staking.stake{value: 100 ether}();

        staking.addOperator(operator1, "Node1", 1000);
        // validatorCount stays 0

        vm.prank(oracle);
        staking.reportRewards(1 ether);

        (, , , , , uint256 opRewards) = staking.getOperator(operator1);
        assertEq(opRewards, 0);
    }

    function test_rewardsWithEmptyPoolAllowed() public {
        // Edge: if totalPooledEther is 0, maxReward is 0, but rewards > 0 check passes
        // and rewards > maxReward check: rewards > 0 && totalPooledEther > 0 → the second condition is false
        // So it should pass through
        vm.prank(oracle);
        staking.reportRewards(1 ether);
        // Pool increases by net rewards
        assertGt(staking.totalPooledEther(), 0);
    }
}
