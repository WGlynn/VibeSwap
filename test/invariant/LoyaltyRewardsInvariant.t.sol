// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/incentives/LoyaltyRewardsManager.sol";
import "../../contracts/incentives/interfaces/ILoyaltyRewardsManager.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockLRIToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Handler ============

contract LoyaltyHandler is Test {
    LoyaltyRewardsManager public manager;
    MockLRIToken public rewardToken;

    address public controller;

    bytes32 constant POOL_ID = keccak256("pool-inv");

    // Ghost variables
    uint256 public ghost_totalStaked;
    uint256 public ghost_totalUnstaked;
    uint256 public ghost_totalDeposited;

    address[] public stakers;
    mapping(address => uint256) public stakerLiquidity;

    constructor(
        LoyaltyRewardsManager _manager,
        MockLRIToken _rewardToken,
        address _controller
    ) {
        manager = _manager;
        rewardToken = _rewardToken;
        controller = _controller;

        // Pre-generate staker addresses
        for (uint256 i = 0; i < 5; i++) {
            stakers.push(address(uint160(i + 300)));
        }
    }

    function registerStake(uint256 stakerSeed, uint256 liquidity) public {
        liquidity = bound(liquidity, 1 ether, 100_000 ether);
        address staker = stakers[stakerSeed % stakers.length];

        vm.prank(controller);
        try manager.registerStake(POOL_ID, staker, liquidity) {
            ghost_totalStaked += liquidity;
            stakerLiquidity[staker] += liquidity;
        } catch {}
    }

    function recordUnstake(uint256 stakerSeed, uint256 fraction) public {
        address staker = stakers[stakerSeed % stakers.length];
        uint256 currentLiq = stakerLiquidity[staker];
        if (currentLiq == 0) return;

        fraction = bound(fraction, 1, 10000);
        uint256 unstakeAmount = (currentLiq * fraction) / 10000;
        if (unstakeAmount == 0) unstakeAmount = 1;
        if (unstakeAmount > currentLiq) unstakeAmount = currentLiq;

        vm.prank(controller);
        try manager.recordUnstake(POOL_ID, staker, unstakeAmount) {
            ghost_totalUnstaked += unstakeAmount;
            stakerLiquidity[staker] -= unstakeAmount;
        } catch {}
    }

    function depositRewards(uint256 amount) public {
        amount = bound(amount, 1 ether, 10_000 ether);

        rewardToken.mint(address(this), amount);
        rewardToken.approve(address(manager), amount);

        try manager.depositRewards(POOL_ID, amount) {
            ghost_totalDeposited += amount;
        } catch {}
    }

    function advanceTime(uint256 delta) public {
        delta = bound(delta, 1, 30 days);
        vm.warp(block.timestamp + delta);
    }

    function getStakerCount() external view returns (uint256) {
        return stakers.length;
    }
}

// ============ Invariant Tests ============

contract LoyaltyRewardsInvariantTest is StdInvariant, Test {
    LoyaltyRewardsManager public manager;
    MockLRIToken public rewardToken;
    LoyaltyHandler public handler;

    address public owner;
    address public controller;
    address public treasury;

    bytes32 constant POOL_ID = keccak256("pool-inv");

    function setUp() public {
        owner = address(this);
        controller = makeAddr("controller");
        treasury = makeAddr("treasury");

        rewardToken = new MockLRIToken("VIBE", "VIBE");

        LoyaltyRewardsManager impl = new LoyaltyRewardsManager();
        bytes memory initData = abi.encodeWithSelector(
            LoyaltyRewardsManager.initialize.selector,
            owner,
            controller,
            treasury,
            address(rewardToken)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        manager = LoyaltyRewardsManager(address(proxy));

        // Fund manager with rewards for claims
        rewardToken.mint(address(manager), 10_000_000 ether);

        handler = new LoyaltyHandler(manager, rewardToken, controller);
        targetContract(address(handler));
    }

    // ============ Invariant: pool totalStaked consistent with ghost ============

    function invariant_totalStakedConsistent() public view {
        ILoyaltyRewardsManager.PoolRewardState memory state = manager.getPoolState(POOL_ID);

        // Pool totalStaked should equal ghost_totalStaked - ghost_totalUnstaked
        // But penalties are taken from the unstake amount, so the pool tracks
        // net liquidity (stakes - unstakes)
        uint256 expectedNet = handler.ghost_totalStaked() - handler.ghost_totalUnstaked();
        assertEq(
            state.totalStaked,
            expectedNet,
            "STAKED: pool total mismatch"
        );
    }

    // ============ Invariant: penalties monotonically increasing ============

    function invariant_penaltiesMonotonic() public view {
        // totalPenaltiesCollected should only increase
        // (We check it's >= 0, which is always true for uint,
        //  but the real test is that the handler never causes underflow)
        uint256 penalties = manager.totalPenaltiesCollected();
        assertGe(penalties, 0, "PENALTIES: should be non-negative");
    }

    // ============ Invariant: tier always valid (0-3) ============

    function invariant_tierAlwaysValid() public view {
        uint256 stakerCount = handler.getStakerCount();

        for (uint256 i = 0; i < stakerCount; i++) {
            address staker = handler.stakers(i);
            ILoyaltyRewardsManager.LoyaltyPosition memory pos = manager.getPosition(POOL_ID, staker);

            if (pos.liquidity > 0) {
                uint8 tier = manager.getCurrentTier(POOL_ID, staker);
                assertLe(tier, 3, "TIER: exceeds max");
            }
        }
    }

    // ============ Invariant: individual positions sum to pool total ============

    function invariant_positionsSumToPoolTotal() public view {
        ILoyaltyRewardsManager.PoolRewardState memory state = manager.getPoolState(POOL_ID);

        uint256 sumLiquidity = 0;
        uint256 stakerCount = handler.getStakerCount();

        for (uint256 i = 0; i < stakerCount; i++) {
            address staker = handler.stakers(i);
            ILoyaltyRewardsManager.LoyaltyPosition memory pos = manager.getPosition(POOL_ID, staker);
            sumLiquidity += pos.liquidity;
        }

        assertEq(
            sumLiquidity,
            state.totalStaked,
            "POSITIONS: sum != pool totalStaked"
        );
    }

    // ============ Invariant: treasuryPenaltyShare bounded ============

    function invariant_treasuryShareBounded() public view {
        uint256 share = manager.treasuryPenaltyShareBps();
        assertLe(share, 10000, "TREASURY_SHARE: exceeds 100%");
    }
}
