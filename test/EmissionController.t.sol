// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../contracts/incentives/EmissionController.sol";

// ============ Mock Contracts ============

contract MockVIBE is ERC20 {
    uint256 public constant MAX_SUPPLY = 21_000_000e18;
    mapping(address => bool) public minters;

    constructor() ERC20("VIBE", "VIBE") {}

    function setMinter(address minter, bool authorized) external {
        minters[minter] = authorized;
    }

    function mint(address to, uint256 amount) external {
        require(minters[msg.sender], "Not minter");
        require(totalSupply() + amount <= MAX_SUPPLY, "Exceeds max");
        _mint(to, amount);
    }

    function mintableSupply() external view returns (uint256) {
        return MAX_SUPPLY - totalSupply();
    }
}

contract MockShapley {
    mapping(address => bool) public authorizedCreators;
    mapping(bytes32 => bool) public gamesCreated;
    mapping(bytes32 => bool) public gamesSettled;
    mapping(bytes32 => uint256) public gameValues;
    uint256 public gamesCount;

    function setAuthorizedCreator(address creator, bool authorized) external {
        authorizedCreators[creator] = authorized;
    }

    function createGameTyped(
        bytes32 gameId,
        uint256 totalValue,
        address,
        uint8,
        IShapleyCreate.Participant[] calldata
    ) external {
        require(authorizedCreators[msg.sender], "Not authorized");
        gamesCreated[gameId] = true;
        gameValues[gameId] = totalValue;
        gamesCount++;
    }

    function computeShapleyValues(bytes32 gameId) external {
        require(authorizedCreators[msg.sender], "Not authorized");
        require(gamesCreated[gameId], "Game not found");
        gamesSettled[gameId] = true;
    }
}

contract MockStaking {
    address public rewardTokenAddr;
    address public stakingOwner;
    uint256 public lastNotifyAmount;
    uint256 public lastNotifyDuration;
    uint256 public notifyCount;

    constructor(address _rewardToken) {
        rewardTokenAddr = _rewardToken;
        stakingOwner = msg.sender;
    }

    function transferOwnership(address newOwner) external {
        stakingOwner = newOwner;
    }

    function notifyRewardAmount(uint256 amount, uint256 duration) external {
        require(msg.sender == stakingOwner, "Not owner");
        IERC20(rewardTokenAddr).transferFrom(msg.sender, address(this), amount);
        lastNotifyAmount = amount;
        lastNotifyDuration = duration;
        notifyCount++;
    }
}

// ============ Unit Tests ============

contract EmissionControllerTest is Test {
    EmissionController public ec;
    MockVIBE public vibe;
    MockShapley public shapley;
    MockStaking public staking;
    address public gauge;

    address public owner = address(this);
    address public alice = address(0xA11CE);
    address public bob = address(0xB0B);
    address public drainer = address(0xD1);

    uint256 public constant BASE_RATE = 332_880_110_000_000_000;
    uint256 public constant ERA_DURATION = 31_557_600;

    function setUp() public {
        vibe = new MockVIBE();
        shapley = new MockShapley();
        gauge = address(0x6A06E);
        staking = new MockStaking(address(vibe));

        // Deploy via proxy
        EmissionController impl = new EmissionController();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(EmissionController.initialize, (
                owner,
                address(vibe),
                address(shapley),
                gauge,
                address(staking)
            ))
        );
        ec = EmissionController(address(proxy));

        // Configure permissions
        vibe.setMinter(address(ec), true);
        shapley.setAuthorizedCreator(address(ec), true);
        staking.transferOwnership(address(ec));
        ec.setAuthorizedDrainer(drainer, true);
    }

    // ============ Initialization ============

    function testInitialization() public view {
        assertEq(ec.genesisTime(), block.timestamp);
        assertEq(ec.lastDripTime(), block.timestamp);
        assertEq(ec.eraDuration(), ERA_DURATION);
        assertEq(ec.shapleyBps(), 5000);
        assertEq(ec.gaugeBps(), 3500);
        assertEq(ec.stakingBps(), 1500);
        assertEq(ec.maxDrainBps(), 5000);
        assertEq(ec.minDrainBps(), 100);
        assertEq(ec.minDrainAmount(), 0);
        assertEq(ec.stakingRewardDuration(), 7 days);
        assertEq(ec.totalEmitted(), 0);
        assertEq(ec.shapleyPool(), 0);
        assertEq(ec.stakingPending(), 0);
    }

    // ============ Drip ============

    function testDripBasic() public {
        // Warp 1 hour
        vm.warp(block.timestamp + 1 hours);

        uint256 expected = BASE_RATE * 1 hours;
        uint256 minted = ec.drip();

        assertEq(minted, expected);
        assertEq(ec.totalEmitted(), expected);

        // Check split: 50/35/15
        uint256 shapleyShare = (expected * 5000) / 10_000;
        uint256 gaugeShare = (expected * 3500) / 10_000;
        uint256 stakingShare = expected - shapleyShare - gaugeShare;

        assertEq(ec.shapleyPool(), shapleyShare);
        assertEq(ec.totalGaugeFunded(), gaugeShare);
        assertEq(ec.stakingPending(), stakingShare);

        // Check token balances
        assertEq(vibe.balanceOf(gauge), gaugeShare);
        assertEq(vibe.balanceOf(address(ec)), shapleyShare + stakingShare);
    }

    function testDripNothingPending() public {
        // No time elapsed
        vm.expectRevert(EmissionController.NothingToDrip.selector);
        ec.drip();
    }

    function testDripTwice() public {
        vm.warp(block.timestamp + 1 hours);
        ec.drip();

        // Immediately after — nothing pending
        vm.expectRevert(EmissionController.NothingToDrip.selector);
        ec.drip();

        // After more time
        vm.warp(block.timestamp + 30 minutes);
        uint256 expected = BASE_RATE * 30 minutes;
        uint256 minted = ec.drip();
        assertEq(minted, expected);
    }

    function testDripCrossEra() public {
        // Warp to 10 seconds before era boundary
        vm.warp(block.timestamp + ERA_DURATION - 10);
        ec.drip();

        // Warp 20 seconds (crosses era boundary)
        vm.warp(block.timestamp + 20);
        uint256 pending = ec.pendingEmissions();

        // 10 seconds at era 0 rate + 10 seconds at era 1 rate
        uint256 expected = BASE_RATE * 10 + (BASE_RATE >> 1) * 10;
        assertEq(pending, expected);

        uint256 minted = ec.drip();
        assertEq(minted, expected);
    }

    function testDripMultipleEras() public {
        // Warp through 3 full eras
        vm.warp(block.timestamp + 3 * ERA_DURATION + 100);

        uint256 pending = ec.pendingEmissions();

        // Era 0: full duration at BASE_RATE
        // Era 1: full duration at BASE_RATE/2
        // Era 2: full duration at BASE_RATE/4
        // Era 3: 100 seconds at BASE_RATE/8
        uint256 expected = BASE_RATE * ERA_DURATION
            + (BASE_RATE >> 1) * ERA_DURATION
            + (BASE_RATE >> 2) * ERA_DURATION
            + (BASE_RATE >> 3) * 100;

        assertEq(pending, expected);
    }

    function testDripCapsAtMaxSupply() public {
        // Pre-mint most of the supply directly
        vibe.setMinter(address(this), true);
        vibe.mint(address(this), 20_999_000e18); // Leave only 1000 VIBE mintable

        // Warp far enough to exceed 1000 VIBE emissions
        vm.warp(block.timestamp + 1 hours); // ~1,198,368 VIBE at base rate

        uint256 minted = ec.drip();
        assertEq(minted, 1000e18); // Capped at mintable
        assertEq(ec.totalEmitted(), 1000e18);
    }

    event Dripped(uint256 amount, uint256 shapleyShare, uint256 gaugeShare, uint256 stakingShare, uint256 era);

    function testDripEmitsEvent() public {
        vm.warp(block.timestamp + 1 hours);
        uint256 expected = BASE_RATE * 1 hours;
        uint256 shapleyShare = (expected * 5000) / 10_000;
        uint256 gaugeShare = (expected * 3500) / 10_000;
        uint256 stakingShare = expected - shapleyShare - gaugeShare;

        vm.expectEmit(false, false, false, true);
        emit Dripped(expected, shapleyShare, gaugeShare, stakingShare, 0);
        ec.drip();
    }

    function testDripNoGauge() public {
        // Set gauge to zero
        ec.setLiquidityGauge(address(0));

        vm.warp(block.timestamp + 1 hours);
        uint256 expected = BASE_RATE * 1 hours;
        ec.drip();

        // Gauge share redirected to Shapley pool (no orphaned tokens)
        assertEq(ec.totalGaugeFunded(), 0);
        uint256 shapleyShare = (expected * 5000) / 10_000;
        uint256 gaugeShare = (expected * 3500) / 10_000;
        uint256 stakingShare = expected - shapleyShare - gaugeShare;
        assertEq(vibe.balanceOf(address(ec)), expected); // nothing transferred out
        assertEq(ec.shapleyPool(), shapleyShare + gaugeShare); // gauge redirected to shapley
        assertEq(ec.stakingPending(), stakingShare);

        // Accounting identity holds
        uint256 totalAccounted = ec.shapleyPool()
            + ec.totalShapleyDrained()
            + ec.totalGaugeFunded()
            + ec.stakingPending()
            + ec.totalStakingFunded();
        assertEq(totalAccounted, ec.totalEmitted());
    }

    // ============ Create Contribution Game ============

    function testCreateContributionGame() public {
        // First drip to fill the pool
        vm.warp(block.timestamp + 1 days);
        ec.drip();

        uint256 pool = ec.shapleyPool();
        assertTrue(pool > 0);

        // Create game draining 50% of pool
        IShapleyCreate.Participant[] memory participants = _makeParticipants(3);
        uint256 drainAmount = (pool * 5000) / 10_000;

        vm.prank(drainer);
        ec.createContributionGame(keccak256("game1"), participants, 5000);

        assertEq(ec.shapleyPool(), pool - drainAmount);
        assertEq(ec.totalShapleyDrained(), drainAmount);
        assertTrue(shapley.gamesCreated(keccak256("game1")));
        assertTrue(shapley.gamesSettled(keccak256("game1")));
        assertEq(shapley.gameValues(keccak256("game1")), drainAmount);
        assertEq(vibe.balanceOf(address(shapley)), drainAmount);
    }

    function testCreateContributionGameDrainTooLarge() public {
        vm.warp(block.timestamp + 1 days);
        ec.drip();

        IShapleyCreate.Participant[] memory participants = _makeParticipants(2);

        vm.prank(drainer);
        vm.expectRevert(EmissionController.DrainTooLarge.selector);
        ec.createContributionGame(keccak256("game1"), participants, 5001); // exceeds maxDrainBps
    }

    function testCreateContributionGameDrainTooSmall() public {
        vm.warp(block.timestamp + 1 days);
        ec.drip();

        uint256 pool = ec.shapleyPool();
        // minDrainBps = 100 (1%). Draining 0.5% (50 bps) should fail if below percentage min.
        // Need drainBps < minDrainBps (100)
        IShapleyCreate.Participant[] memory participants = _makeParticipants(2);

        vm.prank(drainer);
        vm.expectRevert(EmissionController.DrainTooSmall.selector);
        ec.createContributionGame(keccak256("game1"), participants, 50); // 0.5% < 1% min
    }

    function testCreateContributionGameAbsoluteMinFloor() public {
        // Set a very high absolute min that exceeds any percentage drain
        ec.setMinDrain(1, 1_000_000_000e18); // 0.01% of pool but 1B VIBE absolute floor

        vm.warp(block.timestamp + 1 days);
        ec.drip();

        IShapleyCreate.Participant[] memory participants = _makeParticipants(2);

        // Even max drain (50%) of ~14K VIBE pool is far below 1B VIBE absolute floor
        vm.prank(drainer);
        vm.expectRevert(EmissionController.DrainTooSmall.selector);
        ec.createContributionGame(keccak256("game1"), participants, 5000);
    }

    function testCreateContributionGameUnauthorized() public {
        vm.warp(block.timestamp + 1 days);
        ec.drip();

        IShapleyCreate.Participant[] memory participants = _makeParticipants(2);

        vm.prank(alice); // not authorized
        vm.expectRevert(EmissionController.Unauthorized.selector);
        ec.createContributionGame(keccak256("game1"), participants, 1000);
    }

    function testCreateContributionGameOwnerCanDrain() public {
        vm.warp(block.timestamp + 1 days);
        ec.drip();

        IShapleyCreate.Participant[] memory participants = _makeParticipants(2);

        // Owner should be able to drain (onlyDrainer allows owner)
        ec.createContributionGame(keccak256("game1"), participants, 1000);
        assertTrue(shapley.gamesCreated(keccak256("game1")));
    }

    event ContributionGameCreated(bytes32 indexed gameId, uint256 drainAmount, uint256 participantCount);

    function testCreateContributionGameEmitsEvent() public {
        vm.warp(block.timestamp + 1 days);
        ec.drip();

        uint256 drainAmount = (ec.shapleyPool() * 2000) / 10_000;

        IShapleyCreate.Participant[] memory participants = _makeParticipants(2);

        vm.expectEmit(true, false, false, true);
        emit ContributionGameCreated(keccak256("game1"), drainAmount, 2);

        ec.createContributionGame(keccak256("game1"), participants, 2000);
    }

    // ============ Fund Staking ============

    function testFundStaking() public {
        vm.warp(block.timestamp + 1 days);
        ec.drip();

        uint256 pending = ec.stakingPending();
        assertTrue(pending > 0);

        ec.fundStaking();

        assertEq(ec.stakingPending(), 0);
        assertEq(ec.totalStakingFunded(), pending);
        assertEq(staking.lastNotifyAmount(), pending);
        assertEq(staking.lastNotifyDuration(), 7 days);
        assertEq(vibe.balanceOf(address(staking)), pending);
    }

    function testFundStakingNothingPending() public {
        vm.expectRevert(EmissionController.NothingToFund.selector);
        ec.fundStaking();
    }

    function testFundStakingMultipleDrips() public {
        uint256 t0 = block.timestamp;

        // Multiple drips accumulate staking pending
        vm.warp(t0 + 1 hours);
        ec.drip();
        uint256 pending1 = ec.stakingPending();

        vm.warp(t0 + 2 hours);
        ec.drip();
        uint256 pending2 = ec.stakingPending();

        assertTrue(pending2 > pending1); // accumulated

        ec.fundStaking();
        assertEq(ec.stakingPending(), 0);
        assertEq(ec.totalStakingFunded(), pending2);
    }

    // ============ View Functions ============

    function testGetCurrentEra() public {
        uint256 genesis = ec.genesisTime();
        assertEq(ec.getCurrentEra(), 0);

        vm.warp(genesis + ERA_DURATION);
        assertEq(ec.getCurrentEra(), 1);

        vm.warp(genesis + 2 * ERA_DURATION);
        assertEq(ec.getCurrentEra(), 2);

        // Far future — caps at MAX_ERAS
        vm.warp(genesis + 100 * ERA_DURATION);
        assertEq(ec.getCurrentEra(), 32);
    }

    function testGetCurrentRate() public {
        uint256 genesis = ec.genesisTime();
        assertEq(ec.getCurrentRate(), BASE_RATE);

        vm.warp(genesis + ERA_DURATION);
        assertEq(ec.getCurrentRate(), BASE_RATE >> 1);

        vm.warp(genesis + 2 * ERA_DURATION);
        assertEq(ec.getCurrentRate(), BASE_RATE >> 2);

        // At max eras, rate is 0
        vm.warp(genesis + 100 * ERA_DURATION);
        assertEq(ec.getCurrentRate(), 0);
    }

    function testPendingEmissions() public view {
        assertEq(ec.pendingEmissions(), 0);
    }

    function testPendingEmissionsAfterTime() public {
        vm.warp(block.timestamp + 100);
        assertEq(ec.pendingEmissions(), BASE_RATE * 100);
    }

    function testGetEmissionInfo() public {
        vm.warp(block.timestamp + 1 hours);
        ec.drip();

        (
            uint256 era,
            uint256 rate,
            uint256 pool,
            uint256 pending,
            uint256 emitted,
            uint256 remaining
        ) = ec.getEmissionInfo();

        assertEq(era, 0);
        assertEq(rate, BASE_RATE);
        assertEq(pool, ec.shapleyPool());
        assertEq(pending, 0); // just dripped
        assertEq(emitted, ec.totalEmitted());
        assertEq(remaining, vibe.mintableSupply());
    }

    // ============ Admin Functions ============

    function testSetBudget() public {
        ec.setBudget(6000, 3000, 1000);
        assertEq(ec.shapleyBps(), 6000);
        assertEq(ec.gaugeBps(), 3000);
        assertEq(ec.stakingBps(), 1000);
    }

    function testSetBudgetInvalidTotal() public {
        vm.expectRevert(EmissionController.InvalidBudget.selector);
        ec.setBudget(5000, 3500, 2000); // sum = 10500
    }

    function testSetBudgetOnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        ec.setBudget(6000, 3000, 1000);
    }

    function testSetMaxDrainBps() public {
        ec.setMaxDrainBps(3000);
        assertEq(ec.maxDrainBps(), 3000);
    }

    function testSetMaxDrainBpsInvalid() public {
        vm.expectRevert(EmissionController.InvalidBps.selector);
        ec.setMaxDrainBps(10001);
    }

    function testSetMinDrain() public {
        ec.setMinDrain(200, 50e18);
        assertEq(ec.minDrainBps(), 200);
        assertEq(ec.minDrainAmount(), 50e18);
    }

    function testSetStakingRewardDuration() public {
        ec.setStakingRewardDuration(14 days);
        assertEq(ec.stakingRewardDuration(), 14 days);
    }

    function testSetStakingRewardDurationZero() public {
        vm.expectRevert(EmissionController.InvalidDuration.selector);
        ec.setStakingRewardDuration(0);
    }

    function testSetAuthorizedDrainer() public {
        ec.setAuthorizedDrainer(alice, true);
        assertTrue(ec.authorizedDrainers(alice));

        ec.setAuthorizedDrainer(alice, false);
        assertFalse(ec.authorizedDrainers(alice));
    }

    function testSetAuthorizedDrainerZeroAddress() public {
        vm.expectRevert(EmissionController.ZeroAddress.selector);
        ec.setAuthorizedDrainer(address(0), true);
    }

    function testSetSinks() public {
        ec.setLiquidityGauge(alice);
        assertEq(ec.liquidityGauge(), alice);

        ec.setSingleStaking(bob);
        assertEq(address(ec.singleStaking()), bob);

        ec.setShapleyDistributor(alice);
        assertEq(ec.shapleyDistributor(), alice);
    }

    function testSetShapleyDistributorZero() public {
        vm.expectRevert(EmissionController.ZeroAddress.selector);
        ec.setShapleyDistributor(address(0));
    }

    // ============ Long Time Gap ============

    function testDripAfterLongTime() public {
        // 10 years — crosses many eras
        vm.warp(block.timestamp + 10 * ERA_DURATION);

        uint256 pending = ec.pendingEmissions();
        assertTrue(pending > 0);

        uint256 minted = ec.drip();
        assertEq(minted, pending);
        assertEq(ec.totalEmitted(), pending);
    }

    // ============ Accounting Invariant ============

    function testAccountingInvariantAfterDripAndDrain() public {
        // Drip
        vm.warp(block.timestamp + 1 days);
        ec.drip();

        // Drain
        IShapleyCreate.Participant[] memory participants = _makeParticipants(2);
        ec.createContributionGame(keccak256("game1"), participants, 2000);

        // Fund staking
        ec.fundStaking();

        // Invariant: all allocated amounts sum to totalEmitted
        uint256 totalAccounted = ec.shapleyPool()
            + ec.totalShapleyDrained()
            + ec.totalGaugeFunded()
            + ec.stakingPending()
            + ec.totalStakingFunded();
        assertEq(totalAccounted, ec.totalEmitted());
    }

    // ============ Helpers ============

    function _makeParticipants(uint256 count) internal pure returns (IShapleyCreate.Participant[] memory) {
        IShapleyCreate.Participant[] memory p = new IShapleyCreate.Participant[](count);
        for (uint256 i = 0; i < count; i++) {
            p[i] = IShapleyCreate.Participant({
                participant: address(uint160(0x1000 + i)),
                directContribution: 1000e18,
                timeInPool: 1 days,
                scarcityScore: 5000,
                stabilityScore: 5000
            });
        }
        return p;
    }
}
