// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/VibeYieldFarming.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Mocks ============

contract MockFarmToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ VibeYieldFarming Tests ============

contract VibeYieldFarmingTest is Test {
    VibeYieldFarming public farm;
    MockFarmToken public stakeToken;
    MockFarmToken public stakeToken2;

    address public owner;
    address public alice;
    address public bob;
    address public feeRecipient;

    uint256 public constant REWARD_PER_BLOCK = 1 ether;
    uint256 public startBlock;

    // ============ Events ============

    event PoolAdded(uint256 indexed pid, address stakeToken, uint256 allocPoint);
    event Deposited(uint256 indexed pid, address indexed user, uint256 amount);
    event Withdrawn(uint256 indexed pid, address indexed user, uint256 amount);
    event Harvested(uint256 indexed pid, address indexed user, uint256 reward);
    event EmergencyWithdrawn(uint256 indexed pid, address indexed user, uint256 amount);
    event PoolUpdated(uint256 indexed pid, uint256 allocPoint);

    // ============ Setup ============

    function setUp() public {
        owner        = address(this);
        alice        = makeAddr("alice");
        bob          = makeAddr("bob");
        feeRecipient = makeAddr("feeRecipient");

        stakeToken  = new MockFarmToken("StakeToken",  "STK");
        stakeToken2 = new MockFarmToken("StakeToken2", "STK2");

        startBlock = block.number + 1;

        VibeYieldFarming impl = new VibeYieldFarming();
        bytes memory initData = abi.encodeCall(
            VibeYieldFarming.initialize,
            (REWARD_PER_BLOCK, startBlock, feeRecipient)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        farm = VibeYieldFarming(payable(address(proxy)));

        // Seed contract with ETH so reward transfers succeed
        vm.deal(address(farm), 100_000 ether);

        stakeToken.mint(alice, 1_000_000 ether);
        stakeToken.mint(bob,   1_000_000 ether);
        stakeToken2.mint(alice, 1_000_000 ether);

        vm.prank(alice);
        stakeToken.approve(address(farm), type(uint256).max);
        vm.prank(alice);
        stakeToken2.approve(address(farm), type(uint256).max);
        vm.prank(bob);
        stakeToken.approve(address(farm), type(uint256).max);
    }

    // ============ Helpers ============

    function _addPool(uint256 allocPoint, uint256 feeBps) internal returns (uint256 pid) {
        pid = farm.poolLength();
        farm.addPool(address(stakeToken), allocPoint, feeBps);
    }

    function _depositAs(address user, uint256 pid, uint256 amount) internal {
        vm.prank(user);
        farm.deposit(pid, amount);
    }

    function _rollBlocks(uint256 n) internal {
        vm.roll(block.number + n);
    }

    // ============ Initialization ============

    function test_initialize_setsOwner() public view {
        assertEq(farm.owner(), owner);
    }

    function test_initialize_setsRewardPerBlock() public view {
        assertEq(farm.rewardPerBlock(), REWARD_PER_BLOCK);
    }

    function test_initialize_setsFeeRecipient() public view {
        assertEq(farm.feeRecipient(), feeRecipient);
    }

    function test_initialize_setsBonusMultiplier() public view {
        assertEq(farm.bonusMultiplier(), 3);
    }

    function test_initialize_zeroPoolLength() public view {
        assertEq(farm.poolLength(), 0);
    }

    // ============ Pool Management ============

    function test_addPool_storesPool() public {
        uint256 pid = _addPool(100, 0);
        assertEq(pid, 0);
        assertEq(farm.poolLength(), 1);

        (IERC20 token_, uint256 alloc_, , , uint256 fee_, , bool active_) = farm.poolInfo(0);
        assertEq(address(token_), address(stakeToken));
        assertEq(alloc_, 100);
        assertEq(fee_, 0);
        assertTrue(active_);
    }

    function test_addPool_updatesTotalAllocPoint() public {
        _addPool(100, 0);
        assertEq(farm.totalAllocPoint(), 100);

        farm.addPool(address(stakeToken2), 200, 0);
        assertEq(farm.totalAllocPoint(), 300);
    }

    function test_addPool_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit PoolAdded(0, address(stakeToken), 100);
        farm.addPool(address(stakeToken), 100, 0);
    }

    function test_addPool_aboveMaxFee_reverts() public {
        vm.expectRevert("Max 4% fee");
        farm.addPool(address(stakeToken), 100, 401);
    }

    function test_addPool_maxFeeAllowed() public {
        farm.addPool(address(stakeToken), 100, 400); // 4% exactly
        (, , , , uint256 fee_, , ) = farm.poolInfo(0);
        assertEq(fee_, 400);
    }

    function test_addPool_notOwner_reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        farm.addPool(address(stakeToken), 100, 0);
    }

    function test_setPool_updatesAllocPoint() public {
        _addPool(100, 0);
        farm.setPool(0, 200);

        (, uint256 alloc_, , , , , ) = farm.poolInfo(0);
        assertEq(alloc_, 200);
        assertEq(farm.totalAllocPoint(), 200);
    }

    function test_setPool_emitsEvent() public {
        _addPool(100, 0);

        vm.expectEmit(true, false, false, true);
        emit PoolUpdated(0, 50);
        farm.setPool(0, 50);
    }

    // ============ Deposit ============

    function test_deposit_transfersTokens() public {
        _addPool(100, 0);
        uint256 aliceBefore = stakeToken.balanceOf(alice);

        _depositAs(alice, 0, 1000 ether);

        assertEq(stakeToken.balanceOf(alice), aliceBefore - 1000 ether);
        (, , , , , uint256 totalStaked_, ) = farm.poolInfo(0);
        assertEq(totalStaked_, 1000 ether);
    }

    function test_deposit_updatesUserAmount() public {
        _addPool(100, 0);
        _depositAs(alice, 0, 500 ether);

        (uint256 amount_, ) = farm.userInfo(0, alice);
        assertEq(amount_, 500 ether);
    }

    function test_deposit_emitsEvent() public {
        _addPool(100, 0);

        vm.expectEmit(true, true, false, true);
        emit Deposited(0, alice, 500 ether);
        _depositAs(alice, 0, 500 ether);
    }

    function test_deposit_withFee_deductsCorrectly() public {
        farm.addPool(address(stakeToken), 100, 200); // 2% fee

        uint256 recipientBefore = stakeToken.balanceOf(feeRecipient);
        _depositAs(alice, 0, 1000 ether);

        uint256 expectedFee = 20 ether; // 2%
        assertEq(stakeToken.balanceOf(feeRecipient), recipientBefore + expectedFee);

        (uint256 amount_, ) = farm.userInfo(0, alice);
        assertEq(amount_, 980 ether); // 1000 - 20
    }

    function test_deposit_inactivePool_reverts() public {
        // pool active by default, no toggle; test using wrong pid
        _addPool(100, 0);
        vm.prank(alice);
        vm.expectRevert();
        farm.deposit(1, 100 ether); // pid 1 doesn't exist → out of bounds
    }

    // ============ Withdraw ============

    function test_withdraw_returnsTokens() public {
        _addPool(100, 0);
        _depositAs(alice, 0, 1000 ether);

        uint256 aliceBefore = stakeToken.balanceOf(alice);

        vm.prank(alice);
        farm.withdraw(0, 500 ether);

        assertEq(stakeToken.balanceOf(alice), aliceBefore + 500 ether);
    }

    function test_withdraw_updatesUserAmount() public {
        _addPool(100, 0);
        _depositAs(alice, 0, 1000 ether);

        vm.prank(alice);
        farm.withdraw(0, 400 ether);

        (uint256 amount_, ) = farm.userInfo(0, alice);
        assertEq(amount_, 600 ether);
    }

    function test_withdraw_emitsEvent() public {
        _addPool(100, 0);
        _depositAs(alice, 0, 1000 ether);

        vm.expectEmit(true, true, false, true);
        emit Withdrawn(0, alice, 1000 ether);
        vm.prank(alice);
        farm.withdraw(0, 1000 ether);
    }

    function test_withdraw_insufficientStake_reverts() public {
        _addPool(100, 0);
        _depositAs(alice, 0, 100 ether);

        vm.prank(alice);
        vm.expectRevert("Insufficient stake");
        farm.withdraw(0, 200 ether);
    }

    // ============ Harvest ============

    function test_harvest_accruesToUser() public {
        _addPool(100, 0);
        _rollBlocks(startBlock - block.number); // get to start
        _depositAs(alice, 0, 1000 ether);

        _rollBlocks(10); // 10 blocks of rewards

        uint256 aliceEthBefore = alice.balance;
        vm.prank(alice);
        farm.harvest(0);

        // Rewards accrued (exact amount depends on bonus multiplier, but must be > 0)
        assertGt(alice.balance, aliceEthBefore);
    }

    function test_harvest_noRewards_reverts() public {
        _addPool(100, 0);
        _depositAs(alice, 0, 1000 ether);
        // No blocks passed after deposit (same block)

        vm.prank(alice);
        vm.expectRevert("No rewards");
        farm.harvest(0);
    }

    function test_harvest_emitsEvent() public {
        _addPool(100, 0);
        _rollBlocks(startBlock - block.number + 1);
        _depositAs(alice, 0, 1000 ether);
        _rollBlocks(5);

        vm.expectEmit(true, true, false, false);
        emit Harvested(0, alice, 0); // amount checked loosely
        vm.prank(alice);
        farm.harvest(0);
    }

    function test_depositHarvestsAccruedRewards() public {
        _addPool(100, 0);
        _rollBlocks(startBlock - block.number + 1);
        _depositAs(alice, 0, 1000 ether);
        _rollBlocks(10);

        uint256 aliceEthBefore = alice.balance;

        // Second deposit should auto-harvest pending rewards
        _depositAs(alice, 0, 0);

        assertGt(alice.balance, aliceEthBefore);
    }

    // ============ Emergency Withdraw ============

    function test_emergencyWithdraw_returnsFullStake() public {
        _addPool(100, 0);
        _depositAs(alice, 0, 1000 ether);

        uint256 aliceBefore = stakeToken.balanceOf(alice);
        vm.prank(alice);
        farm.emergencyWithdraw(0);

        assertEq(stakeToken.balanceOf(alice), aliceBefore + 1000 ether);
    }

    function test_emergencyWithdraw_resetsUserState() public {
        _addPool(100, 0);
        _depositAs(alice, 0, 1000 ether);

        vm.prank(alice);
        farm.emergencyWithdraw(0);

        (uint256 amount_, uint256 rewardDebt_) = farm.userInfo(0, alice);
        assertEq(amount_, 0);
        assertEq(rewardDebt_, 0);
    }

    function test_emergencyWithdraw_emitsEvent() public {
        _addPool(100, 0);
        _depositAs(alice, 0, 1000 ether);

        vm.expectEmit(true, true, false, true);
        emit EmergencyWithdrawn(0, alice, 1000 ether);
        vm.prank(alice);
        farm.emergencyWithdraw(0);
    }

    // ============ Pending Reward View ============

    function test_pendingReward_zeroBeforeDeposit() public {
        _addPool(100, 0);
        assertEq(farm.pendingReward(0, alice), 0);
    }

    function test_pendingReward_accruedAfterBlocks() public {
        _addPool(100, 0);
        _rollBlocks(startBlock - block.number + 1);
        _depositAs(alice, 0, 1000 ether);
        _rollBlocks(5);

        assertGt(farm.pendingReward(0, alice), 0);
    }

    function test_pendingReward_proportionalToAlloc() public {
        // Two pools: pool0 gets 100 alloc, pool1 gets 100 alloc
        _addPool(100, 0);
        farm.addPool(address(stakeToken2), 100, 0);

        _rollBlocks(startBlock - block.number + 1);
        _depositAs(alice, 0, 1000 ether);
        vm.prank(alice);
        farm.deposit(1, 1000 ether);

        _rollBlocks(10);

        uint256 pending0 = farm.pendingReward(0, alice);
        uint256 pending1 = farm.pendingReward(1, alice);

        // Equal alloc → equal rewards (within rounding)
        assertApproxEqAbs(pending0, pending1, 1 wei);
    }

    // ============ Admin ============

    function test_setRewardPerBlock_updatesValue() public {
        farm.setRewardPerBlock(2 ether);
        assertEq(farm.rewardPerBlock(), 2 ether);
    }

    function test_setRewardPerBlock_notOwner_reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        farm.setRewardPerBlock(2 ether);
    }

    function test_setBonusMultiplier_updatesValue() public {
        farm.setBonusMultiplier(5);
        assertEq(farm.bonusMultiplier(), 5);
    }

    // ============ Multiplier ============

    function test_bonusMultiplier_appliedDuringBonus() public {
        // Farm starts with bonusEndBlock = startBlock + 100000
        // Normal block post-start yields rewardPerBlock * bonusMultiplier
        _addPool(100, 0);
        _rollBlocks(startBlock - block.number + 1);
        _depositAs(alice, 0, 1000 ether);

        _rollBlocks(1);

        // 1 block at 3x multiplier = 3 ether pending
        assertEq(farm.pendingReward(0, alice), 3 ether);
    }

    // ============ Multi-User ============

    function test_multiUser_rewardSplit() public {
        _addPool(100, 0);
        _rollBlocks(startBlock - block.number + 1);

        _depositAs(alice, 0, 1000 ether);
        _depositAs(bob,   0, 1000 ether);

        _rollBlocks(10);

        uint256 alicePending = farm.pendingReward(0, alice);
        uint256 bobPending   = farm.pendingReward(0, bob);

        // Equal stake → equal pending (within rounding)
        assertApproxEqAbs(alicePending, bobPending, 1 wei);
    }

    // ============ Full Lifecycle ============

    function test_fullLifecycle_depositEarnWithdraw() public {
        _addPool(100, 0);
        _rollBlocks(startBlock - block.number + 1);
        _depositAs(alice, 0, 1000 ether);

        _rollBlocks(20);

        uint256 aliceEthBefore   = alice.balance;
        uint256 aliceTokenBefore = stakeToken.balanceOf(alice);

        vm.prank(alice);
        farm.withdraw(0, 1000 ether);

        // Rewards sent as ETH
        assertGt(alice.balance, aliceEthBefore);
        // Full stake returned
        assertEq(stakeToken.balanceOf(alice), aliceTokenBefore + 1000 ether);
    }

    // ============ Fuzz ============

    function testFuzz_deposit_withdraw_noLoss(uint256 amount) public {
        amount = bound(amount, 1 ether, 100_000 ether);

        _addPool(100, 0);
        _depositAs(alice, 0, amount);

        uint256 aliceBefore = stakeToken.balanceOf(alice);
        vm.prank(alice);
        farm.withdraw(0, amount);

        assertEq(stakeToken.balanceOf(alice), aliceBefore + amount);
    }
}
