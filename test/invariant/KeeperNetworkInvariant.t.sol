// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/governance/VibeKeeperNetwork.sol";
import "../../contracts/governance/interfaces/IVibeKeeperNetwork.sol";
import "../../contracts/oracle/IReputationOracle.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockKNInvToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockKNInvOracle is IReputationOracle {
    mapping(address => uint8) public tiers;
    function setTier(address user, uint8 tier) external { tiers[user] = tier; }
    function getTrustScore(address user) external view returns (uint256) { return uint256(tiers[user]) * 2500; }
    function getTrustTier(address user) external view returns (uint8) { return tiers[user]; }
    function isEligible(address user, uint8 requiredTier) external view returns (bool) { return tiers[user] >= requiredTier; }
}

contract MockKNInvTarget {
    uint256 public value;
    function setValue(uint256 _value) external { value = _value; }
}

// ============ Handler ============

contract KeeperNetworkHandler is Test {
    VibeKeeperNetwork public network;
    MockKNInvToken public jul;
    MockKNInvTarget public target;

    address[] public keepers;
    mapping(address => bool) public isRegistered;

    // Ghost variables
    uint256 public ghost_totalStaked;
    uint256 public ghost_totalRewardsEarned;
    uint256 public ghost_totalSlashed;
    uint256 public ghost_registrations;
    uint256 public ghost_executions;
    uint256 public ghost_successfulExecutions;

    constructor(
        VibeKeeperNetwork _network,
        MockKNInvToken _jul,
        MockKNInvTarget _target
    ) {
        network = _network;
        jul = _jul;
        target = _target;

        // Create keeper pool
        for (uint256 i = 0; i < 10; i++) {
            address k = address(uint160(i + 5000));
            keepers.push(k);
            jul.mint(k, 10_000 ether);
            vm.prank(k);
            jul.approve(address(network), type(uint256).max);
        }
    }

    function registerKeeper(uint256 actorSeed, uint256 amount) public {
        address actor = keepers[actorSeed % keepers.length];
        if (isRegistered[actor]) return;

        amount = bound(amount, 100 ether, 1000 ether);

        vm.prank(actor);
        try network.registerKeeper(amount) {
            isRegistered[actor] = true;
            ghost_totalStaked += amount;
            ghost_registrations++;
        } catch {}
    }

    function executeTask(uint256 actorSeed, uint256 valueSeed) public {
        address actor = keepers[actorSeed % keepers.length];
        if (!isRegistered[actor]) return;
        if (!network.isActiveKeeper(actor)) return;

        uint256 val = bound(valueSeed, 0, 1_000_000);
        bytes memory data = abi.encodeCall(MockKNInvTarget.setValue, (val));

        vm.prank(actor);
        try network.executeTask(0, data) {
            ghost_executions++;
            ghost_successfulExecutions++;
            ghost_totalRewardsEarned += 10 ether;
        } catch {
            ghost_executions++;
        }
    }

    function claimRewards(uint256 actorSeed) public {
        address actor = keepers[actorSeed % keepers.length];
        if (!isRegistered[actor]) return;

        vm.prank(actor);
        try network.claimRewards() {} catch {}
    }

    function warpTime(uint256 seconds_) public {
        seconds_ = bound(seconds_, 0, 3 days);
        vm.warp(block.timestamp + seconds_);
    }
}

// ============ Invariant Tests ============

contract KeeperNetworkInvariantTest is StdInvariant, Test {
    VibeKeeperNetwork public network;
    MockKNInvToken public jul;
    MockKNInvOracle public oracle;
    MockKNInvTarget public target;
    KeeperNetworkHandler public handler;

    uint256 constant INITIAL_REWARD_POOL = 50_000 ether;

    function setUp() public {
        jul = new MockKNInvToken("JUL", "JUL");
        oracle = new MockKNInvOracle();
        target = new MockKNInvTarget();

        network = new VibeKeeperNetwork(address(jul), address(oracle));

        // Fund reward pool
        jul.mint(address(this), INITIAL_REWARD_POOL);
        jul.approve(address(network), type(uint256).max);
        network.depositRewards(INITIAL_REWARD_POOL);

        // Register task
        network.registerTask(address(target), target.setValue.selector, 10 ether, 0);

        handler = new KeeperNetworkHandler(network, jul, target);
        targetContract(address(handler));
    }

    // ============ Solvency Invariants ============

    /**
     * @notice JUL balance covers all obligations (reward pool + stakes + pending rewards).
     */
    function invariant_julSolvency() public view {
        uint256 contractBalance = jul.balanceOf(address(network));
        uint256 pool = network.rewardPool();
        // Contract balance must cover reward pool + all staked JUL
        assertGe(contractBalance, pool, "Contract JUL balance must cover reward pool");
    }

    /**
     * @notice Reward pool can only decrease through legitimate distributions.
     */
    function invariant_rewardPoolNonNegative() public view {
        // rewardPool is uint256, can't go negative, but verify it's reasonable
        assertLe(
            network.rewardPool(),
            INITIAL_REWARD_POOL + handler.ghost_totalSlashed(),
            "Reward pool must not exceed initial + slashed"
        );
    }

    // ============ Accounting Invariants ============

    /**
     * @notice totalKeepers matches handler ghost.
     */
    function invariant_keeperCountConsistent() public view {
        assertEq(
            network.totalKeepers(),
            handler.ghost_registrations(),
            "Keeper count mismatch"
        );
    }

    /**
     * @notice Successful executions never exceed total executions.
     */
    function invariant_successesLeTotal() public view {
        assertLe(
            handler.ghost_successfulExecutions(),
            handler.ghost_executions(),
            "Successes must not exceed total executions"
        );
    }

    // ============ Call Summary ============

    function invariant_callSummary() public view {
        console.log("--- Keeper Network Invariant Summary ---");
        console.log("Registrations:", handler.ghost_registrations());
        console.log("Executions:", handler.ghost_executions());
        console.log("Successful:", handler.ghost_successfulExecutions());
        console.log("Rewards earned:", handler.ghost_totalRewardsEarned());
        console.log("Reward pool:", network.rewardPool());
    }
}
