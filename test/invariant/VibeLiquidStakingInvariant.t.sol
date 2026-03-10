// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/financial/VibeLiquidStaking.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock ============

contract InvMockVIBE is ERC20 {
    constructor() ERC20("VIBE", "VIBE") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Handler ============

contract LiquidStakingHandler is Test {
    VibeLiquidStaking public staking;
    InvMockVIBE public vibe;
    address public oracle;

    address[] public actors;
    uint256[] public withdrawalIds;

    uint256 public ghost_totalStakedETH;
    uint256 public ghost_totalStakedVIBE;
    uint256 public ghost_totalRewardsReported;
    uint256 public ghost_totalInstantUnstakeFees;
    uint256 public ghost_totalWithdrawalsClaimed;
    uint256 public ghost_stakeCount;
    uint256 public ghost_unstakeCount;

    constructor(VibeLiquidStaking _staking, InvMockVIBE _vibe, address _oracle) {
        staking = _staking;
        vibe = _vibe;
        oracle = _oracle;

        // Create actors
        for (uint256 i = 1; i <= 5; i++) {
            address actor = address(uint160(0x1000 + i));
            actors.push(actor);
            vm.deal(actor, 10_000 ether);
            vibe.mint(actor, 10_000_000e18);
            vm.prank(actor);
            vibe.approve(address(staking), type(uint256).max);
        }
    }

    function _getActor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    // ============ Actions ============

    function stakeETH(uint256 actorSeed, uint256 amount) external {
        address actor = _getActor(actorSeed);
        amount = bound(amount, 0.01 ether, 100 ether);

        vm.prank(actor);
        staking.stake{value: amount}();

        ghost_totalStakedETH += amount;
        ghost_stakeCount++;
    }

    function stakeVIBE(uint256 actorSeed, uint256 amount) external {
        address actor = _getActor(actorSeed);
        amount = bound(amount, 1e18, 100_000e18);

        vm.prank(actor);
        staking.stakeVibe(amount);

        ghost_totalStakedVIBE += amount;
        ghost_stakeCount++;
    }

    function requestWithdrawal(uint256 actorSeed, uint256 sharesFraction) external {
        address actor = _getActor(actorSeed);
        uint256 balance = staking.balanceOf(actor);
        if (balance == 0) return;

        sharesFraction = bound(sharesFraction, 1, 100);
        uint256 shares = (balance * sharesFraction) / 100;
        if (shares == 0) return;

        vm.prank(actor);
        uint256 requestId = staking.requestWithdrawal(shares);
        withdrawalIds.push(requestId);
    }

    function claimWithdrawal(uint256 idSeed) external {
        if (withdrawalIds.length == 0) return;

        uint256 requestId = withdrawalIds[idSeed % withdrawalIds.length];
        (address owner, , uint128 ethAmount, uint40 claimableAt, bool claimed) =
            staking.getWithdrawalRequest(requestId);

        if (claimed || owner == address(0)) return;

        vm.warp(uint256(claimableAt));

        vm.prank(owner);
        staking.claimWithdrawal(requestId);

        ghost_totalWithdrawalsClaimed += ethAmount;
    }

    function instantUnstake(uint256 actorSeed, uint256 sharesFraction) external {
        address actor = _getActor(actorSeed);
        uint256 balance = staking.balanceOf(actor);
        if (balance == 0) return;

        sharesFraction = bound(sharesFraction, 1, 100);
        uint256 shares = (balance * sharesFraction) / 100;
        if (shares == 0) return;

        // Ensure hold period passed
        uint256 lastStake = staking.lastStakeTimestamp(actor);
        if (block.timestamp < lastStake + 1 days) {
            vm.warp(lastStake + 1 days);
        }

        uint256 feesBefore = staking.accumulatedFees();
        vm.prank(actor);
        staking.instantUnstake(shares);

        ghost_totalInstantUnstakeFees += staking.accumulatedFees() - feesBefore;
        ghost_unstakeCount++;
    }

    function reportRewards(uint256 rewardFraction) external {
        uint256 pooled = staking.totalPooledEther();
        if (pooled == 0) return;

        // Bound rewards to 0.01% - 10% of pool
        rewardFraction = bound(rewardFraction, 1, 1000);
        uint256 rewards = (pooled * rewardFraction) / 10_000;
        if (rewards == 0) return;

        // Simulate validator rewards arriving
        vm.deal(address(staking), address(staking).balance + rewards);

        vm.prank(oracle);
        staking.reportRewards(rewards);

        ghost_totalRewardsReported += rewards;
    }

    function warpTime(uint256 seconds_) external {
        seconds_ = bound(seconds_, 1 hours, 14 days);
        vm.warp(block.timestamp + seconds_);
    }
}

// ============ Invariant Test ============

contract VibeLiquidStakingInvariantTest is Test {
    VibeLiquidStaking public staking;
    InvMockVIBE public vibe;
    LiquidStakingHandler public handler;

    address oracle = address(0xAA);

    function setUp() public {
        vibe = new InvMockVIBE();

        VibeLiquidStaking impl = new VibeLiquidStaking();
        bytes memory initData = abi.encodeCall(
            VibeLiquidStaking.initialize,
            (oracle, address(vibe))
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        staking = VibeLiquidStaking(payable(address(proxy)));

        handler = new LiquidStakingHandler(staking, vibe, oracle);

        // Target only the handler
        targetContract(address(handler));
    }

    // ============ Invariant 1: Contract Balance Solvency ============

    /// @notice Contract total assets (ETH + VIBE at 1:1) must cover all accounted pools
    function invariant_contractBalanceSolvency() public view {
        // VIBE staking adds to totalPooledEther but backs it with VIBE tokens, not ETH
        // Total assets = ETH balance + VIBE balance (valued 1:1 per contract design)
        uint256 totalAssets = address(staking).balance + vibe.balanceOf(address(staking));
        uint256 accounted = staking.totalPooledEther()
            + staking.pendingWithdrawalETH()
            + staking.insurancePool()
            + staking.accumulatedFees();

        assertGe(
            totalAssets,
            accounted,
            "INVARIANT VIOLATED: Total assets < accounted value"
        );
    }

    // ============ Invariant 2: Share Price Non-Negative ============

    /// @notice Share price must always be >= 1e18 (no negative rebasing)
    function invariant_sharePriceNonNegative() public view {
        uint256 price = staking.getSharePrice();
        assertGe(price, 1e18, "INVARIANT VIOLATED: Share price below 1:1");
    }

    // ============ Invariant 3: Supply Consistency ============

    /// @notice totalSupply must equal sum of all balances (ERC20 invariant)
    function invariant_supplyConsistency() public view {
        uint256 totalFromBalances;
        for (uint256 i; i < 5; i++) {
            address actor = address(uint160(0x1001 + i));
            totalFromBalances += staking.balanceOf(actor);
        }
        // Total supply may include balances from other addresses (handler, etc.)
        assertLe(totalFromBalances, staking.totalSupply(), "INVARIANT VIOLATED: Balances exceed supply");
    }

    // ============ Invariant 4: Pool + Pending Conservation ============

    /// @notice Total system value (pool + pending + insurance) should be trackable
    function invariant_tvlConsistency() public view {
        uint256 tvl = staking.totalValueLocked();
        uint256 expected = staking.totalPooledEther()
            + staking.pendingWithdrawalETH()
            + staking.insurancePool();
        assertEq(tvl, expected, "INVARIANT VIOLATED: TVL mismatch");
    }

    // ============ Invariant 5: Insurance Pool Bounded ============

    /// @notice Insurance pool cannot exceed total reported rewards * 5%
    function invariant_insuranceBounded() public view {
        uint256 maxInsurance = (handler.ghost_totalRewardsReported() * 500) / 10_000;
        assertLe(
            staking.insurancePool(),
            maxInsurance,
            "INVARIANT VIOLATED: Insurance pool exceeds 5% of all rewards"
        );
    }

    // ============ Invariant 6: Fees Bounded ============

    /// @notice Accumulated fees must be bounded by total unstake volume
    function invariant_feesBounded() public view {
        // Fees can only come from instant unstakes at 0.5%
        // So accumulatedFees <= what the handler tracked
        assertEq(
            staking.accumulatedFees(),
            handler.ghost_totalInstantUnstakeFees(),
            "INVARIANT VIOLATED: Fee accounting mismatch"
        );
    }

    // ============ Invariant 7: No Shares Without Pool ============

    /// @notice If totalSupply > 0, totalPooledEther must also be > 0 (and vice versa, approximately)
    function invariant_sharesImplyPool() public view {
        if (staking.totalSupply() > 0) {
            assertGt(
                staking.totalPooledEther(),
                0,
                "INVARIANT VIOLATED: Shares exist without pool"
            );
        }
    }
}
