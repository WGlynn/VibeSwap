// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/financial/VibeRevShare.sol";
import "../../contracts/financial/interfaces/IVibeRevShare.sol";
import "../../contracts/oracle/IReputationOracle.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockRevInvToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockRevInvOracle is IReputationOracle {
    mapping(address => uint8) public tiers;
    function setTier(address user, uint8 tier) external { tiers[user] = tier; }
    function getTrustScore(address user) external view returns (uint256) { return uint256(tiers[user]) * 2500; }
    function getTrustTier(address user) external view returns (uint8) { return tiers[user]; }
    function isEligible(address user, uint8 requiredTier) external view returns (bool) { return tiers[user] >= requiredTier; }
}

// ============ Handler ============

contract RevShareHandler is Test {
    VibeRevShare public rev;
    MockRevInvToken public usdc;
    MockRevInvOracle public oracle;
    address public source;

    address[] public actors;

    // Ghost variables
    uint256 public ghost_totalStaked;
    uint256 public ghost_totalRevenue;
    uint256 public ghost_totalClaimed;
    uint256 public ghost_stakeCount;
    uint256 public ghost_claimCount;
    uint256 public ghost_unstakeRequestCount;
    uint256 public ghost_unstakeCompleteCount;

    mapping(address => uint256) public ghost_userStaked;

    constructor(
        VibeRevShare _rev,
        MockRevInvToken _usdc,
        MockRevInvOracle _oracle,
        address _source
    ) {
        rev = _rev;
        usdc = _usdc;
        oracle = _oracle;
        source = _source;

        for (uint256 i = 0; i < 10; i++) {
            address actor = address(uint160(i + 3000));
            actors.push(actor);
            oracle.setTier(actor, uint8(i % 5));
        }
    }

    function stake(uint256 actorSeed, uint256 amount) public {
        address actor = actors[actorSeed % actors.length];
        uint256 balance = rev.balanceOf(actor);
        if (balance == 0) return;

        amount = bound(amount, 1, balance);

        vm.prank(actor);
        try rev.stake(amount) {
            ghost_totalStaked += amount;
            ghost_userStaked[actor] += amount;
            ghost_stakeCount++;
        } catch {}
    }

    function depositRevenue(uint256 amount) public {
        amount = bound(amount, 1, 100_000 ether);

        vm.prank(source);
        try rev.depositRevenue(amount) {
            ghost_totalRevenue += amount;
        } catch {}
    }

    function claimRevenue(uint256 actorSeed) public {
        address actor = actors[actorSeed % actors.length];

        vm.prank(actor);
        try rev.claimRevenue() {
            ghost_claimCount++;
        } catch {}
    }

    function requestUnstake(uint256 actorSeed, uint256 amount) public {
        address actor = actors[actorSeed % actors.length];
        uint256 staked = rev.stakedBalanceOf(actor);
        if (staked == 0) return;

        amount = bound(amount, 1, staked);

        vm.prank(actor);
        try rev.requestUnstake(amount) {
            ghost_totalStaked -= amount;
            ghost_userStaked[actor] -= amount;
            ghost_unstakeRequestCount++;
        } catch {}
    }

    function completeUnstake(uint256 actorSeed) public {
        address actor = actors[actorSeed % actors.length];

        IVibeRevShare.StakeInfo memory info = rev.getStakeInfo(actor);
        if (info.unstakeRequestAmount == 0) return;

        // Warp past cooldown
        uint256 cooldown = rev.effectiveCooldown(actor);
        vm.warp(block.timestamp + cooldown + 1);

        vm.prank(actor);
        try rev.completeUnstake() {
            ghost_unstakeCompleteCount++;
        } catch {}
    }

    function cancelUnstake(uint256 actorSeed) public {
        address actor = actors[actorSeed % actors.length];

        IVibeRevShare.StakeInfo memory info = rev.getStakeInfo(actor);
        if (info.unstakeRequestAmount == 0) return;

        vm.prank(actor);
        try rev.cancelUnstake() {
            ghost_totalStaked += info.unstakeRequestAmount;
            ghost_userStaked[actor] += info.unstakeRequestAmount;
        } catch {}
    }
}

// ============ Invariant Tests ============

contract RevShareInvariantTest is StdInvariant, Test {
    VibeRevShare public rev;
    MockRevInvToken public usdc;
    MockRevInvToken public jul;
    MockRevInvOracle public oracle;
    RevShareHandler public handler;
    address public source;

    function setUp() public {
        source = makeAddr("source");

        jul = new MockRevInvToken("JUL", "JUL");
        usdc = new MockRevInvToken("USDC", "USDC");
        oracle = new MockRevInvOracle();

        rev = new VibeRevShare(address(jul), address(oracle), address(usdc));
        rev.setRevenueSource(source, true);

        // Fund source with revenue tokens
        usdc.mint(source, type(uint128).max);
        vm.prank(source);
        usdc.approve(address(rev), type(uint256).max);

        handler = new RevShareHandler(rev, usdc, oracle, source);

        // Mint VREV to actors and approve
        for (uint256 i = 0; i < 10; i++) {
            address actor = address(uint160(i + 3000));
            rev.mint(actor, 10_000_000 ether);
            vm.prank(actor);
            rev.approve(address(rev), type(uint256).max);
        }

        targetContract(address(handler));
    }

    // ============ Solvency Invariants ============

    /**
     * @notice CRITICAL: Revenue token balance covers all unclaimed revenue.
     */
    function invariant_revenueSolvency() public view {
        uint256 contractBalance = usdc.balanceOf(address(rev));
        uint256 totalDeposited = rev.totalRevenueDeposited();
        uint256 totalClaimed = rev.totalRevenueClaimed();

        if (totalDeposited >= totalClaimed) {
            assertGe(
                contractBalance,
                totalDeposited - totalClaimed,
                "SOLVENCY VIOLATION: revenue balance insufficient"
            );
        }
    }

    /**
     * @notice Total claimed never exceeds total deposited.
     */
    function invariant_claimsNotExceedDeposits() public view {
        assertLe(
            rev.totalRevenueClaimed(),
            rev.totalRevenueDeposited(),
            "CLAIM VIOLATION: claimed > deposited"
        );
    }

    // ============ Accounting Invariants ============

    /**
     * @notice totalStaked matches the contract's view.
     */
    function invariant_stakedMatchesGhost() public view {
        assertEq(
            rev.totalStaked(),
            handler.ghost_totalStaked(),
            "Staked accounting mismatch"
        );
    }

    /**
     * @notice Total revenue deposited matches ghost tracking.
     */
    function invariant_revenueMatchesGhost() public view {
        assertEq(
            rev.totalRevenueDeposited(),
            handler.ghost_totalRevenue(),
            "Revenue accounting mismatch"
        );
    }

    /**
     * @notice VREV total supply is constant (no unauthorized minting/burning).
     */
    function invariant_totalSupplyConstant() public view {
        // We minted 10M to each of 10 actors = 100M total
        assertEq(rev.totalSupply(), 10_000_000 ether * 10);
    }

    // ============ State Invariants ============

    /**
     * @notice Cooldown is always >= MIN_COOLDOWN (2 days).
     */
    function invariant_cooldownBounded() public view {
        for (uint256 i = 0; i < 10; i++) {
            address actor = address(uint160(i + 3000));
            assertGe(
                rev.effectiveCooldown(actor),
                2 days,
                "Cooldown below minimum"
            );
        }
    }

    // ============ Call Summary ============

    function invariant_callSummary() public view {
        console.log("--- RevShare Invariant Summary ---");
        console.log("Stakes:", handler.ghost_stakeCount());
        console.log("Total staked:", handler.ghost_totalStaked());
        console.log("Revenue deposited:", handler.ghost_totalRevenue());
        console.log("Claims:", handler.ghost_claimCount());
        console.log("Unstake requests:", handler.ghost_unstakeRequestCount());
        console.log("Unstake completions:", handler.ghost_unstakeCompleteCount());
    }
}
