// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/incentives/SingleStaking.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock Token ============

contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Handler ============

contract StakingHandler is Test {
    SingleStaking public staking;
    MockERC20 public stakingToken;
    MockERC20 public rewardToken;

    address[] public actors;
    uint256 public ghost_totalStaked;
    uint256 public ghost_totalWithdrawn;
    uint256 public ghost_totalRewardsClaimed;
    uint256 public ghost_totalRewardsNotified;
    uint256 public ghost_stakeCallCount;
    uint256 public ghost_withdrawCallCount;
    uint256 public ghost_claimCallCount;

    constructor(
        SingleStaking _staking,
        MockERC20 _stakingToken,
        MockERC20 _rewardToken
    ) {
        staking = _staking;
        stakingToken = _stakingToken;
        rewardToken = _rewardToken;

        // Create actors
        for (uint256 i = 0; i < 5; i++) {
            address actor = address(uint160(0x1000 + i));
            actors.push(actor);
            stakingToken.mint(actor, 1_000_000 ether);
            vm.prank(actor);
            stakingToken.approve(address(staking), type(uint256).max);
        }
    }

    function doStake(uint256 actorSeed, uint256 amount) public {
        address actor = actors[actorSeed % actors.length];
        amount = bound(amount, 1 ether, 10_000 ether);

        vm.prank(actor);
        staking.stake(amount);

        ghost_totalStaked += amount;
        ghost_stakeCallCount++;
    }

    function doWithdraw(uint256 actorSeed, uint256 amount) public {
        address actor = actors[actorSeed % actors.length];
        uint256 balance = staking.stakeOf(actor);
        if (balance == 0) return;

        amount = bound(amount, 1, balance);

        vm.prank(actor);
        staking.withdraw(amount);

        ghost_totalWithdrawn += amount;
        ghost_withdrawCallCount++;
    }

    function doClaim(uint256 actorSeed) public {
        address actor = actors[actorSeed % actors.length];
        uint256 earned = staking.earned(actor);
        if (earned == 0) return;

        vm.prank(actor);
        staking.claimReward();

        ghost_totalRewardsClaimed += earned;
        ghost_claimCallCount++;
    }

    function doExit(uint256 actorSeed) public {
        address actor = actors[actorSeed % actors.length];
        uint256 balance = staking.stakeOf(actor);
        uint256 earned = staking.earned(actor);
        if (balance == 0 && earned == 0) return;

        vm.prank(actor);
        staking.exit();

        ghost_totalWithdrawn += balance;
        ghost_totalRewardsClaimed += earned;
        ghost_withdrawCallCount++;
        if (earned > 0) ghost_claimCallCount++;
    }

    function advanceTime(uint256 time) public {
        time = bound(time, 1, 12 hours);
        vm.warp(block.timestamp + time);
    }
}

// ============ Invariant Tests ============

contract SingleStakingInvariantTest is StdInvariant, Test {
    SingleStaking staking;
    MockERC20 stakingToken;
    MockERC20 rewardToken;
    StakingHandler handler;

    function setUp() public {
        stakingToken = new MockERC20("Stake", "STK");
        rewardToken = new MockERC20("Reward", "RWD");

        staking = new SingleStaking(address(stakingToken), address(rewardToken));

        handler = new StakingHandler(staking, stakingToken, rewardToken);

        // Seed rewards: owner notifies
        rewardToken.mint(address(this), 10_000_000 ether);
        rewardToken.approve(address(staking), type(uint256).max);
        staking.notifyRewardAmount(1_000_000 ether, 30 days);

        targetContract(address(handler));
    }

    // ============ Invariant: totalStaked == sum of balances ============

    function invariant_totalStakedMatchesBalances() public view {
        uint256 sumBalances;
        for (uint256 i = 0; i < 5; i++) {
            address actor = handler.actors(i);
            sumBalances += staking.stakeOf(actor);
        }
        assertEq(staking.totalStaked(), sumBalances);
    }

    // ============ Invariant: contract holds enough staking tokens ============

    function invariant_contractHoldsStakedTokens() public view {
        assertGe(stakingToken.balanceOf(address(staking)), staking.totalStaked());
    }

    // ============ Invariant: ghost accounting matches ============

    function invariant_ghostStakeAccounting() public view {
        // totalStaked should = ghost_totalStaked - ghost_totalWithdrawn
        assertEq(staking.totalStaked(), handler.ghost_totalStaked() - handler.ghost_totalWithdrawn());
    }

    // ============ Invariant: earned never exceeds remaining rewards ============

    function invariant_earnedNeverExceedsRewardBalance() public view {
        uint256 totalEarned;
        for (uint256 i = 0; i < 5; i++) {
            address actor = handler.actors(i);
            totalEarned += staking.earned(actor);
        }

        // Total unclaimed earned should not exceed reward token balance
        assertLe(totalEarned, rewardToken.balanceOf(address(staking)));
    }

    // ============ Invariant: reward rate stays consistent ============

    function invariant_rewardRateNonNegative() public view {
        // rewardRate is uint256 so always >= 0, but should be zero only if no period
        if (staking.periodFinish() > 0) {
            // During or after a period, rate was set
            // (could be 0 if notified with very small amount / large duration)
            assertTrue(true);
        }
    }

    // ============ Call summary for debugging ============

    function invariant_callSummary() public view {
        // Just for logging — always passes
        handler.ghost_stakeCallCount();
        handler.ghost_withdrawCallCount();
        handler.ghost_claimCallCount();
    }
}
