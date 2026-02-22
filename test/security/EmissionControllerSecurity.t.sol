// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../../contracts/incentives/EmissionController.sol";

// ============ ADVERSARIAL MOCK CONTRACTS ============

/// @dev Standard mock VIBE for non-attack tests
contract SecMockVIBE is ERC20 {
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

/// @dev Malicious VIBE token that attempts reentrancy on mint
contract ReentrantVIBE is ERC20 {
    uint256 public constant MAX_SUPPLY = 21_000_000e18;
    mapping(address => bool) public minters;
    address public target;
    bool public attackOnMint;

    constructor() ERC20("RVIBE", "RVIBE") {}

    function setMinter(address minter, bool authorized) external {
        minters[minter] = authorized;
    }

    function setAttack(address _target, bool _attack) external {
        target = _target;
        attackOnMint = _attack;
    }

    function mint(address to, uint256 amount) external {
        require(minters[msg.sender], "Not minter");
        require(totalSupply() + amount <= MAX_SUPPLY, "Exceeds max");
        _mint(to, amount);

        // Attempt reentrant call back into EmissionController
        if (attackOnMint && target != address(0)) {
            try EmissionController(target).drip() {} catch {}
            try EmissionController(target).fundStaking() {} catch {}
        }
    }

    function mintableSupply() external view returns (uint256) {
        return MAX_SUPPLY - totalSupply();
    }
}

/// @dev Malicious gauge that attempts reentrancy on token receive
contract ReentrantGauge {
    EmissionController public ec;
    bool public attackEnabled;

    constructor(address _ec) {
        ec = EmissionController(_ec);
    }

    function enableAttack() external {
        attackEnabled = true;
    }

    // Called when VIBE tokens are transferred to this contract (via safeTransfer callback on ERC20)
    // ERC20 doesn't have a receive hook, but we can attack if EC calls us
    fallback() external {
        if (attackEnabled) {
            try ec.drip() {} catch {}
            try ec.fundStaking() {} catch {}
        }
    }
}

/// @dev Malicious staking that attempts reentrancy during notifyRewardAmount
contract ReentrantStaking {
    address public rewardTokenAddr;
    address public stakingOwner;
    EmissionController public ec;
    bool public attackEnabled;

    constructor(address _rewardToken) {
        rewardTokenAddr = _rewardToken;
        stakingOwner = msg.sender;
    }

    function transferOwnership(address newOwner) external {
        stakingOwner = newOwner;
    }

    function setAttack(EmissionController _ec) external {
        ec = _ec;
        attackEnabled = true;
    }

    function notifyRewardAmount(uint256 amount, uint256) external {
        require(msg.sender == stakingOwner, "Not owner");
        IERC20(rewardTokenAddr).transferFrom(msg.sender, address(this), amount);

        // Attempt reentrancy
        if (attackEnabled) {
            try ec.drip() {} catch {}
            try ec.fundStaking() {} catch {}
        }
    }
}

/// @dev Malicious ShapleyDistributor that attempts reentrancy
contract ReentrantShapley {
    mapping(address => bool) public authorizedCreators;
    EmissionController public ec;
    bool public attackEnabled;

    function setAuthorizedCreator(address creator, bool authorized) external {
        authorizedCreators[creator] = authorized;
    }

    function setAttack(EmissionController _ec) external {
        ec = _ec;
        attackEnabled = true;
    }

    function createGameTyped(bytes32, uint256, address, uint8, IShapleyCreate.Participant[] calldata) external {
        require(authorizedCreators[msg.sender], "Not authorized");

        // Attempt reentrancy during game creation
        if (attackEnabled) {
            try ec.drip() {} catch {}
            IShapleyCreate.Participant[] memory p = new IShapleyCreate.Participant[](2);
            p[0] = IShapleyCreate.Participant(address(0x1), 1000e18, 1 days, 5000, 5000);
            p[1] = IShapleyCreate.Participant(address(0x2), 1000e18, 1 days, 5000, 5000);
            try ec.createContributionGame(keccak256("reentrant"), p, 1000) {} catch {}
        }
    }

    function computeShapleyValues(bytes32) external {
        require(authorizedCreators[msg.sender], "Not authorized");

        // Attempt reentrancy during settlement
        if (attackEnabled) {
            try ec.fundStaking() {} catch {}
        }
    }
}

/// @dev Staking that always reverts (simulates bricked external contract)
contract RevertingStaking {
    address public stakingOwner;

    constructor() {
        stakingOwner = msg.sender;
    }

    function transferOwnership(address newOwner) external {
        stakingOwner = newOwner;
    }

    function notifyRewardAmount(uint256, uint256) external pure {
        revert("Staking bricked");
    }
}

/// @dev Standard mock Shapley
contract SecMockShapley {
    mapping(address => bool) public authorizedCreators;
    mapping(bytes32 => bool) public gamesCreated;

    function setAuthorizedCreator(address creator, bool authorized) external {
        authorizedCreators[creator] = authorized;
    }

    function createGameTyped(bytes32 gameId, uint256, address, uint8, IShapleyCreate.Participant[] calldata) external {
        require(authorizedCreators[msg.sender], "Not authorized");
        require(!gamesCreated[gameId], "GameAlreadyExists");
        gamesCreated[gameId] = true;
    }

    function computeShapleyValues(bytes32 gameId) external view {
        require(authorizedCreators[msg.sender], "Not authorized");
        require(gamesCreated[gameId], "Game not found");
    }
}

/// @dev Standard mock staking
contract SecMockStaking {
    address public rewardTokenAddr;
    address public stakingOwner;

    constructor(address _rewardToken) {
        rewardTokenAddr = _rewardToken;
        stakingOwner = msg.sender;
    }

    function transferOwnership(address newOwner) external {
        stakingOwner = newOwner;
    }

    function notifyRewardAmount(uint256 amount, uint256) external {
        require(msg.sender == stakingOwner, "Not owner");
        IERC20(rewardTokenAddr).transferFrom(msg.sender, address(this), amount);
    }
}

// ============ SECURITY TEST SUITE ============

contract EmissionControllerSecurity is Test {
    EmissionController public ec;
    SecMockVIBE public vibe;
    SecMockShapley public shapley;
    SecMockStaking public staking;
    address public gauge;

    address public owner;
    address public drainer = address(0xD1);
    address public attacker = address(0xBAD);

    uint256 public constant BASE_RATE = 332_880_110_000_000_000;
    uint256 public constant ERA_DURATION = 31_557_600;
    uint256 public constant MAX_SUPPLY = 21_000_000e18;

    function setUp() public {
        owner = address(this);
        vibe = new SecMockVIBE();
        shapley = new SecMockShapley();
        gauge = address(0x6A06E);
        staking = new SecMockStaking(address(vibe));

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

        vibe.setMinter(address(ec), true);
        shapley.setAuthorizedCreator(address(ec), true);
        staking.transferOwnership(address(ec));
        ec.setAuthorizedDrainer(drainer, true);
    }

    // ============ 1. REENTRANCY ATTACKS ============

    /// @dev Malicious VIBE token tries to re-enter drip() during mint callback
    function testSecurityReentrancyViaMaliciousVIBEToken() public {
        // Deploy with reentrant VIBE
        ReentrantVIBE rVibe = new ReentrantVIBE();
        SecMockShapley rShapley = new SecMockShapley();
        SecMockStaking rStaking = new SecMockStaking(address(rVibe));

        EmissionController impl = new EmissionController();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(EmissionController.initialize, (
                owner,
                address(rVibe),
                address(rShapley),
                gauge,
                address(rStaking)
            ))
        );
        EmissionController ecAttack = EmissionController(address(proxy));

        rVibe.setMinter(address(ecAttack), true);
        rShapley.setAuthorizedCreator(address(ecAttack), true);
        rStaking.transferOwnership(address(ecAttack));

        // Enable attack: VIBE token will try to call drip() and fundStaking() during mint
        rVibe.setAttack(address(ecAttack), true);

        vm.warp(block.timestamp + 1 hours);

        // drip() should succeed — reentrant calls should be blocked by nonReentrant
        uint256 minted = ecAttack.drip();
        assertTrue(minted > 0);

        // Verify only one drip worth of tokens minted (no double-mint)
        assertEq(ecAttack.totalEmitted(), minted);
        assertEq(rVibe.totalSupply(), minted);
    }

    /// @dev Malicious staking contract tries to re-enter during notifyRewardAmount
    function testSecurityReentrancyViaMaliciousStaking() public {
        // Deploy with reentrant staking
        ReentrantStaking rStaking = new ReentrantStaking(address(vibe));

        EmissionController impl = new EmissionController();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(EmissionController.initialize, (
                owner,
                address(vibe),
                address(shapley),
                gauge,
                address(rStaking)
            ))
        );
        EmissionController ecAttack = EmissionController(address(proxy));

        vibe.setMinter(address(ecAttack), true);
        shapley.setAuthorizedCreator(address(ecAttack), true);
        rStaking.transferOwnership(address(ecAttack));
        ecAttack.setAuthorizedDrainer(drainer, true);

        // Enable attack: staking will try re-entry during notifyRewardAmount
        rStaking.setAttack(ecAttack);

        // Drip to fill pending
        vm.warp(block.timestamp + 1 days);
        ecAttack.drip();

        uint256 pendingBefore = ecAttack.stakingPending();
        assertTrue(pendingBefore > 0);

        // fundStaking should succeed — reentrant calls blocked
        ecAttack.fundStaking();

        assertEq(ecAttack.stakingPending(), 0);
        assertEq(ecAttack.totalStakingFunded(), pendingBefore);
    }

    /// @dev Malicious ShapleyDistributor tries to re-enter during game creation
    function testSecurityReentrancyViaMaliciousShapley() public {
        ReentrantShapley rShapley = new ReentrantShapley();

        EmissionController impl = new EmissionController();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(EmissionController.initialize, (
                owner,
                address(vibe),
                address(rShapley),
                gauge,
                address(staking)
            ))
        );
        EmissionController ecAttack = EmissionController(address(proxy));

        vibe.setMinter(address(ecAttack), true);
        rShapley.setAuthorizedCreator(address(ecAttack), true);
        staking.transferOwnership(address(ecAttack));
        ecAttack.setAuthorizedDrainer(address(this), true);

        // Enable attack
        rShapley.setAttack(ecAttack);

        vm.warp(block.timestamp + 1 days);
        ecAttack.drip();

        uint256 poolBefore = ecAttack.shapleyPool();
        uint256 drainAmount = (poolBefore * 3000) / 10_000;

        IShapleyCreate.Participant[] memory p = _makeParticipants(2);
        ecAttack.createContributionGame(keccak256("game1"), p, 3000);

        // Verify only intended drain occurred (reentrant game creation blocked)
        assertEq(ecAttack.shapleyPool(), poolBefore - drainAmount);
        assertEq(ecAttack.totalShapleyDrained(), drainAmount);
    }

    // ============ 2. GAME ID COLLISION / DOUBLE-DRAIN ============

    /// @dev Cannot use the same gameId twice to double-drain the pool
    function testSecurityGameIdCollisionBlocked() public {
        vm.warp(block.timestamp + 1 days);
        ec.drip();

        IShapleyCreate.Participant[] memory p = _makeParticipants(2);
        bytes32 gameId = keccak256("unique_game");

        // First drain succeeds
        vm.prank(drainer);
        ec.createContributionGame(gameId, p, 2000);

        // Second drain with same gameId reverts (ShapleyDistributor prevents it)
        vm.prank(drainer);
        vm.expectRevert(); // "GameAlreadyExists" from ShapleyDistributor
        ec.createContributionGame(gameId, p, 2000);
    }

    /// @dev State rollback: if ShapleyDistributor reverts, pool drain is reverted
    function testSecurityPoolNotDrainedOnShapleyRevert() public {
        vm.warp(block.timestamp + 1 days);
        ec.drip();

        uint256 poolBefore = ec.shapleyPool();
        uint256 drainedBefore = ec.totalShapleyDrained();

        // First game succeeds
        IShapleyCreate.Participant[] memory p = _makeParticipants(2);
        vm.prank(drainer);
        ec.createContributionGame(keccak256("game1"), p, 2000);

        // Second game with same ID reverts — pool should not change further
        vm.prank(drainer);
        vm.expectRevert();
        ec.createContributionGame(keccak256("game1"), p, 2000);

        // Pool reflects only the first drain
        uint256 firstDrain = (poolBefore * 2000) / 10_000;
        assertEq(ec.shapleyPool(), poolBefore - firstDrain);
        assertEq(ec.totalShapleyDrained(), drainedBefore + firstDrain);
    }

    // ============ 3. UNAUTHORIZED ACCESS ============

    /// @dev Non-drainer cannot create games
    function testSecurityUnauthorizedGameCreation() public {
        vm.warp(block.timestamp + 1 days);
        ec.drip();

        IShapleyCreate.Participant[] memory p = _makeParticipants(2);

        vm.prank(attacker);
        vm.expectRevert(EmissionController.Unauthorized.selector);
        ec.createContributionGame(keccak256("stolen"), p, 5000);
    }

    /// @dev Non-owner cannot change budget, sinks, or authorization
    function testSecurityUnauthorizedAdminFunctions() public {
        vm.startPrank(attacker);

        vm.expectRevert();
        ec.setBudget(10000, 0, 0);

        vm.expectRevert();
        ec.setMaxDrainBps(10000);

        vm.expectRevert();
        ec.setMinDrain(0, 0);

        vm.expectRevert();
        ec.setStakingRewardDuration(1);

        vm.expectRevert();
        ec.setAuthorizedDrainer(attacker, true);

        vm.expectRevert();
        ec.setLiquidityGauge(attacker);

        vm.expectRevert();
        ec.setSingleStaking(attacker);

        vm.expectRevert();
        ec.setShapleyDistributor(attacker);

        vm.stopPrank();
    }

    /// @dev Cannot re-initialize the proxy
    function testSecurityCannotReinitialize() public {
        vm.expectRevert();
        ec.initialize(attacker, address(vibe), address(shapley), gauge, address(staking));
    }

    /// @dev Non-owner cannot upgrade the proxy
    function testSecurityUnauthorizedUpgrade() public {
        EmissionController newImpl = new EmissionController();

        vm.prank(attacker);
        vm.expectRevert();
        ec.upgradeToAndCall(address(newImpl), "");
    }

    // ============ 4. ACCOUNTING INVARIANTS UNDER ADVERSARIAL CONDITIONS ============

    /// @dev Accounting identity holds when gauge is address(0)
    function testSecurityAccountingWithNoGauge() public {
        ec.setLiquidityGauge(address(0));

        vm.warp(block.timestamp + 1 days);
        uint256 minted = ec.drip();

        // gaugeShare should be redirected to shapleyPool
        uint256 shapleyShare = (minted * 5000) / 10_000;
        uint256 gaugeShare = (minted * 3500) / 10_000;
        uint256 stakingShare = minted - shapleyShare - gaugeShare;

        // shapleyPool = shapleyShare + gaugeShare (redirected)
        assertEq(ec.shapleyPool(), shapleyShare + gaugeShare);
        assertEq(ec.totalGaugeFunded(), 0);
        assertEq(ec.stakingPending(), stakingShare);

        // Accounting identity holds
        uint256 totalAccounted = ec.shapleyPool()
            + ec.totalShapleyDrained()
            + ec.totalGaugeFunded()
            + ec.stakingPending()
            + ec.totalStakingFunded();
        assertEq(totalAccounted, ec.totalEmitted());
    }

    /// @dev Accounting holds across drip + drain + fund + drain cycle
    function testSecurityAccountingFullCycle() public {
        uint256 genesis = ec.genesisTime();

        // Drip 1
        vm.warp(genesis + 1 days);
        ec.drip();

        // Drain
        IShapleyCreate.Participant[] memory p = _makeParticipants(3);
        ec.createContributionGame(keccak256("game1"), p, 3000);

        // Fund staking
        ec.fundStaking();

        // Drip 2
        vm.warp(genesis + 2 days);
        ec.drip();

        // Drain 2
        ec.createContributionGame(keccak256("game2"), p, 2000);

        // Drip 3
        vm.warp(genesis + 2 days + 12 hours);
        ec.drip();

        // Fund staking 2
        ec.fundStaking();

        // Accounting identity
        uint256 totalAccounted = ec.shapleyPool()
            + ec.totalShapleyDrained()
            + ec.totalGaugeFunded()
            + ec.stakingPending()
            + ec.totalStakingFunded();
        assertEq(totalAccounted, ec.totalEmitted());

        // Balance covers reserves
        assertGe(vibe.balanceOf(address(ec)), ec.shapleyPool() + ec.stakingPending());
    }

    /// @dev Accounting holds with budget change between drips
    function testSecurityAccountingWithBudgetChange() public {
        uint256 genesis = ec.genesisTime();

        // Drip with default 50/35/15
        vm.warp(genesis + 1 days);
        ec.drip();

        // Change budget to 80/10/10
        ec.setBudget(8000, 1000, 1000);

        // Drip with new budget
        vm.warp(genesis + 2 days);
        ec.drip();

        // Accounting identity holds across budget change
        uint256 totalAccounted = ec.shapleyPool()
            + ec.totalShapleyDrained()
            + ec.totalGaugeFunded()
            + ec.stakingPending()
            + ec.totalStakingFunded();
        assertEq(totalAccounted, ec.totalEmitted());
    }

    // ============ 5. DRAIN EDGE CASES ============

    /// @dev maxDrainBps = 0 locks the pool (admin misconfig, but not an exploit)
    function testSecurityMaxDrainZeroLocksPool() public {
        ec.setMaxDrainBps(0);

        vm.warp(block.timestamp + 1 days);
        ec.drip();

        assertTrue(ec.shapleyPool() > 0);

        IShapleyCreate.Participant[] memory p = _makeParticipants(2);
        vm.prank(drainer);
        vm.expectRevert(EmissionController.DrainTooLarge.selector);
        ec.createContributionGame(keccak256("game1"), p, 1); // even 0.01% exceeds 0 max
    }

    /// @dev minDrainBps > maxDrainBps makes drains impossible
    function testSecurityMinExceedsMaxLocksPool() public {
        ec.setMinDrain(6000, 0); // 60% minimum
        // maxDrainBps is still 5000 (50% max)

        vm.warp(block.timestamp + 1 days);
        ec.drip();

        IShapleyCreate.Participant[] memory p = _makeParticipants(2);

        // 50% drain is within max but below 60% min
        vm.prank(drainer);
        vm.expectRevert(EmissionController.DrainTooSmall.selector);
        ec.createContributionGame(keccak256("game1"), p, 5000);

        // 60% drain exceeds max
        vm.prank(drainer);
        vm.expectRevert(EmissionController.DrainTooLarge.selector);
        ec.createContributionGame(keccak256("game2"), p, 6000);
    }

    /// @dev Rapid-fire small drains — compound effect across 20 games
    function testSecurityRapidFireSmallDrains() public {
        vm.warp(block.timestamp + 30 days);
        ec.drip();

        uint256 initialPool = ec.shapleyPool();
        assertTrue(initialPool > 0);

        IShapleyCreate.Participant[] memory p = _makeParticipants(2);

        // 20 games at minimum drain (1% each)
        // Pool after each: pool * 0.99 → after 20: pool * 0.99^20 ≈ 0.818
        for (uint256 i = 0; i < 20; i++) {
            bytes32 gameId = keccak256(abi.encode("rapid", i));
            vm.prank(drainer);
            ec.createContributionGame(gameId, p, 100); // 1% = minDrainBps
        }

        // Pool should be ~81.8% of initial
        uint256 remainingPool = ec.shapleyPool();
        assertTrue(remainingPool > 0);
        assertTrue(remainingPool < initialPool);

        // All drained amounts properly tracked
        assertEq(ec.shapleyPool() + ec.totalShapleyDrained(), initialPool);
    }

    /// @dev Drain entire pool over multiple games (max drain each time)
    function testSecurityDrainPoolToNearZero() public {
        vm.warp(block.timestamp + 30 days);
        ec.drip();

        uint256 initialPool = ec.shapleyPool();
        IShapleyCreate.Participant[] memory p = _makeParticipants(2);

        // Each max drain takes 50%. After 10 games: pool * 0.5^10 ≈ 0.001 of initial
        for (uint256 i = 0; i < 10; i++) {
            uint256 pool = ec.shapleyPool();
            uint256 drainAmount = (pool * 5000) / 10_000;
            uint256 percentMin = (pool * 100) / 10_000; // 1% min
            if (drainAmount < percentMin) break; // Pool too small

            bytes32 gameId = keccak256(abi.encode("maxdrain", i));
            vm.prank(drainer);
            ec.createContributionGame(gameId, p, 5000);
        }

        // Pool should be tiny but accounting still holds
        uint256 totalAccounted = ec.shapleyPool()
            + ec.totalShapleyDrained()
            + ec.totalGaugeFunded()
            + ec.stakingPending()
            + ec.totalStakingFunded();
        assertEq(totalAccounted, ec.totalEmitted());
    }

    // ============ 6. MAX_SUPPLY BOUNDARY ============

    /// @dev Drip at exactly MAX_SUPPLY boundary
    function testSecurityDripExactlyAtMaxSupply() public {
        // Pre-mint to leave exactly 1 VIBE mintable
        vibe.setMinter(address(this), true);
        vibe.mint(address(this), MAX_SUPPLY - 1e18);

        vm.warp(block.timestamp + 1 hours); // Would emit ~1.2M VIBE but only 1 available
        uint256 minted = ec.drip();
        assertEq(minted, 1e18);
        assertEq(vibe.totalSupply(), MAX_SUPPLY);
    }

    /// @dev Drip after MAX_SUPPLY is fully minted
    function testSecurityDripAfterMaxSupplyReached() public {
        vibe.setMinter(address(this), true);
        vibe.mint(address(this), MAX_SUPPLY);

        vm.warp(block.timestamp + 1 hours);
        vm.expectRevert(EmissionController.NothingToDrip.selector);
        ec.drip();
    }

    /// @dev Multiple small drips approaching MAX_SUPPLY — no overflow
    function testSecurityIncrementalDripToMaxSupply() public {
        uint256 genesis = ec.genesisTime();

        // Drip every 90 days for 5 years — should approach MAX_SUPPLY
        uint256 totalMinted;
        for (uint256 i = 1; i <= 20; i++) {
            vm.warp(genesis + i * 90 days);
            try ec.drip() returns (uint256 minted) {
                totalMinted += minted;
            } catch {
                break; // Nothing left to mint
            }
        }

        assertLe(totalMinted, MAX_SUPPLY);
        assertLe(vibe.totalSupply(), MAX_SUPPLY);

        // Accounting identity
        uint256 totalAccounted = ec.shapleyPool()
            + ec.totalShapleyDrained()
            + ec.totalGaugeFunded()
            + ec.stakingPending()
            + ec.totalStakingFunded();
        assertEq(totalAccounted, ec.totalEmitted());
    }

    // ============ 7. CROSS-ERA OVERFLOW SAFETY ============

    /// @dev pendingEmissions doesn't overflow at extreme time ranges
    function testSecurityPendingEmissionsNoOverflow() public {
        // 200 years into the future
        vm.warp(block.timestamp + 200 * ERA_DURATION);
        uint256 pending = ec.pendingEmissions();

        // Should converge to ~MAX_SUPPLY (21M * 1e18)
        // Sum of geometric series: BASE_RATE * ERA_DURATION * 2 ≈ 21,008,798e18
        // Slightly over 21M due to rounding in BASE_RATE — VIBEToken cap prevents over-minting
        assertTrue(pending > 0);
        // Theoretical max is ~21,008,798 VIBE — within 0.05% of MAX_SUPPLY
        assertTrue(pending <= MAX_SUPPLY * 10005 / 10000);
    }

    /// @dev Cross-era calculation at era boundary is exact
    function testSecurityEraBoundaryExactness() public {
        uint256 genesis = ec.genesisTime();

        // Warp to exactly era 1 boundary
        vm.warp(genesis + ERA_DURATION);
        assertEq(ec.getCurrentEra(), 1);
        assertEq(ec.getCurrentRate(), BASE_RATE >> 1);

        uint256 pending = ec.pendingEmissions();
        // Exactly 1 full era 0 = BASE_RATE * ERA_DURATION
        assertEq(pending, BASE_RATE * ERA_DURATION);

        ec.drip();
        assertEq(ec.lastDripTime(), genesis + ERA_DURATION);

        // Warp 1 second into era 1
        vm.warp(genesis + ERA_DURATION + 1);
        uint256 pending2 = ec.pendingEmissions();
        assertEq(pending2, BASE_RATE >> 1); // 1 second at era 1 rate
    }

    // ============ 8. EXTERNAL CONTRACT FAILURE MODES ============

    /// @dev If staking contract is bricked, fundStaking reverts cleanly
    function testSecurityBrickedStakingCleansRevert() public {
        // Replace staking with reverting contract
        RevertingStaking rStaking = new RevertingStaking();
        ec.setSingleStaking(address(rStaking));
        rStaking.transferOwnership(address(ec));

        vm.warp(block.timestamp + 1 days);
        ec.drip();

        assertTrue(ec.stakingPending() > 0);

        // fundStaking should revert, but stakingPending is NOT zeroed (full tx rollback)
        vm.expectRevert("Staking bricked");
        ec.fundStaking();

        // stakingPending unchanged (tx reverted)
        assertTrue(ec.stakingPending() > 0);
    }

    /// @dev drip() still works even if staking is bricked (independent paths)
    function testSecurityDripIndependentOfStaking() public {
        ec.setSingleStaking(address(new RevertingStaking()));

        vm.warp(block.timestamp + 1 hours);
        uint256 minted = ec.drip();
        assertTrue(minted > 0);

        // drip() doesn't touch staking — independent
        assertTrue(ec.stakingPending() > 0);
    }

    /// @dev drip() still works when ShapleyDistributor is misconfigured
    function testSecurityDripIndependentOfShapley() public {
        // Shapley is not touched during drip, only during createContributionGame
        vm.warp(block.timestamp + 1 hours);
        uint256 minted = ec.drip();
        assertTrue(minted > 0);
        assertTrue(ec.shapleyPool() > 0);
    }

    // ============ 9. FRONT-RUNNING AND TIMING ATTACKS ============

    /// @dev Attacker front-runs drip() before createContributionGame — no extra gain
    function testSecurityFrontRunDripBeforeGame() public {
        vm.warp(block.timestamp + 1 days);

        // Attacker calls drip() right before legitimate game creation
        vm.prank(attacker);
        ec.drip();

        uint256 pool = ec.shapleyPool();

        // Legitimate drainer creates game — pool is correctly sized
        IShapleyCreate.Participant[] memory p = _makeParticipants(2);
        vm.prank(drainer);
        ec.createContributionGame(keccak256("legit"), p, 3000);

        // Attacker gained nothing — drip is permissionless, pool just got bigger (good for everyone)
        // The drain takes from the pool which is properly sized
        uint256 drainAmount = (pool * 3000) / 10_000;
        assertEq(ec.totalShapleyDrained(), drainAmount);
    }

    /// @dev Cannot drip() and createContributionGame() in same block to extract more than fair share
    function testSecuritySameBlockDripAndDrain() public {
        uint256 genesis = ec.genesisTime();

        // First drip at day 1
        vm.warp(genesis + 1 days);
        ec.drip();

        uint256 poolAfterFirstDrip = ec.shapleyPool();

        // Warp to day 2
        vm.warp(genesis + 2 days);

        // Drip and drain in same block
        ec.drip();
        uint256 poolAfterSecondDrip = ec.shapleyPool();
        assertTrue(poolAfterSecondDrip > poolAfterFirstDrip); // Pool grew from second drip

        IShapleyCreate.Participant[] memory p = _makeParticipants(2);
        ec.createContributionGame(keccak256("game1"), p, 5000);

        // Drain is capped at maxDrainBps (50%) of total pool — no unfair extraction
        uint256 drainAmount = (poolAfterSecondDrip * 5000) / 10_000;
        assertEq(ec.totalShapleyDrained(), drainAmount);
        assertEq(ec.shapleyPool(), poolAfterSecondDrip - drainAmount);
    }

    // ============ 10. PARAMETER BOUNDARY ATTACKS ============

    /// @dev Budget can be set to 100% on one sink
    function testSecurityBudgetAllToOneSink() public {
        // 100% to Shapley, 0% to gauge and staking
        ec.setBudget(10000, 0, 0);

        vm.warp(block.timestamp + 1 hours);
        uint256 minted = ec.drip();

        assertEq(ec.shapleyPool(), minted);
        assertEq(ec.totalGaugeFunded(), 0);
        assertEq(ec.stakingPending(), 0);

        // Accounting still holds
        uint256 totalAccounted = ec.shapleyPool()
            + ec.totalShapleyDrained()
            + ec.totalGaugeFunded()
            + ec.stakingPending()
            + ec.totalStakingFunded();
        assertEq(totalAccounted, ec.totalEmitted());
    }

    /// @dev Budget set to 100% staking — pool always empty
    function testSecurityBudgetAllToStaking() public {
        ec.setBudget(0, 0, 10000);

        vm.warp(block.timestamp + 1 hours);
        ec.drip();

        assertEq(ec.shapleyPool(), 0);
        assertEq(ec.totalGaugeFunded(), 0);
        assertTrue(ec.stakingPending() > 0);
    }

    /// @dev Cannot set budget that doesn't sum to BPS
    function testSecurityBudgetMustSumToBps() public {
        vm.expectRevert(EmissionController.InvalidBudget.selector);
        ec.setBudget(5000, 3500, 2000); // 10500

        vm.expectRevert(EmissionController.InvalidBudget.selector);
        ec.setBudget(5000, 3500, 1000); // 9500
    }

    /// @dev setMinDrainBps at max BPS — effectively locks all drains unless pool is tiny
    function testSecurityMinDrainAtMaxBps() public {
        ec.setMinDrain(10000, 0); // 100% min drain

        vm.warp(block.timestamp + 1 days);
        ec.drip();

        IShapleyCreate.Participant[] memory p = _makeParticipants(2);

        // 50% drain is less than 100% min
        vm.prank(drainer);
        vm.expectRevert(EmissionController.DrainTooSmall.selector);
        ec.createContributionGame(keccak256("game1"), p, 5000);
    }

    // ============ 11. ZERO-VALUE EDGE CASES ============

    /// @dev Drip with 0% shapley — pool stays empty
    function testSecurityDripWithZeroShapley() public {
        ec.setBudget(0, 5000, 5000);

        vm.warp(block.timestamp + 1 hours);
        ec.drip();

        assertEq(ec.shapleyPool(), 0);
    }

    /// @dev Cannot drain empty pool
    function testSecurityCannotDrainEmptyPool() public {
        // Pool is 0 (no drip yet)
        IShapleyCreate.Participant[] memory p = _makeParticipants(2);

        vm.prank(drainer);
        vm.expectRevert(EmissionController.DrainTooSmall.selector);
        ec.createContributionGame(keccak256("game1"), p, 5000);
    }

    // ============ 12. INITIALIZATION SAFETY ============

    /// @dev Cannot initialize with zero address owner
    function testSecurityCannotInitWithZeroOwner() public {
        EmissionController impl = new EmissionController();

        vm.expectRevert(EmissionController.ZeroAddress.selector);
        new ERC1967Proxy(
            address(impl),
            abi.encodeCall(EmissionController.initialize, (
                address(0),
                address(vibe),
                address(shapley),
                gauge,
                address(staking)
            ))
        );
    }

    /// @dev Cannot initialize with zero address VIBE token
    function testSecurityCannotInitWithZeroVibe() public {
        EmissionController impl = new EmissionController();

        vm.expectRevert(EmissionController.ZeroAddress.selector);
        new ERC1967Proxy(
            address(impl),
            abi.encodeCall(EmissionController.initialize, (
                owner,
                address(0),
                address(shapley),
                gauge,
                address(staking)
            ))
        );
    }

    /// @dev Implementation contract is locked (cannot initialize directly)
    function testSecurityImplContractLocked() public {
        EmissionController impl = new EmissionController();

        vm.expectRevert();
        impl.initialize(owner, address(vibe), address(shapley), gauge, address(staking));
    }

    // ============ 13. CROSS-CONTRACT TOKEN FLOW INTEGRITY ============

    /// @dev Every VIBE minted is accounted for — no token leak
    function testSecurityNoTokenLeak() public {
        uint256 genesis = ec.genesisTime();

        // Complex operation sequence
        vm.warp(genesis + 1 days);
        ec.drip();

        IShapleyCreate.Participant[] memory p = _makeParticipants(3);
        ec.createContributionGame(keccak256("g1"), p, 3000);

        vm.warp(genesis + 2 days);
        ec.drip();

        ec.fundStaking();

        ec.createContributionGame(keccak256("g2"), p, 2000);

        vm.warp(genesis + 3 days);
        ec.drip();

        ec.fundStaking();

        // Total VIBE in existence
        uint256 totalSupply = vibe.totalSupply();

        // Track every location
        uint256 inEC = vibe.balanceOf(address(ec));
        uint256 inGauge = vibe.balanceOf(gauge);
        uint256 inShapley = vibe.balanceOf(address(shapley));
        uint256 inStaking = vibe.balanceOf(address(staking));

        // All tokens are somewhere
        assertEq(inEC + inGauge + inShapley + inStaking, totalSupply);

        // EC balance = shapleyPool + stakingPending (its reserves)
        assertEq(inEC, ec.shapleyPool() + ec.stakingPending());
    }

    /// @dev Token flow integrity with gauge disabled mid-operation
    function testSecurityTokenFlowWithGaugeToggle() public {
        uint256 genesis = ec.genesisTime();

        // Drip with gauge
        vm.warp(genesis + 1 days);
        ec.drip();

        uint256 gaugeBalance1 = vibe.balanceOf(gauge);
        assertTrue(gaugeBalance1 > 0);

        // Disable gauge
        ec.setLiquidityGauge(address(0));

        // Drip without gauge
        vm.warp(genesis + 2 days);
        ec.drip();

        // Gauge balance unchanged (no new transfers)
        assertEq(vibe.balanceOf(gauge), gaugeBalance1);

        // EC balance grew (shapleyPool absorbed gaugeShare)
        // Accounting identity still holds
        uint256 totalAccounted = ec.shapleyPool()
            + ec.totalShapleyDrained()
            + ec.totalGaugeFunded()
            + ec.stakingPending()
            + ec.totalStakingFunded();
        assertEq(totalAccounted, ec.totalEmitted());
    }

    // ============ 14. UPGRADE SAFETY ============

    /// @dev Owner CAN upgrade (legitimate upgrade path)
    function testSecurityOwnerCanUpgrade() public {
        EmissionController newImpl = new EmissionController();
        ec.upgradeToAndCall(address(newImpl), "");

        // State preserved after upgrade
        assertEq(ec.genesisTime(), block.timestamp);
        assertEq(ec.shapleyBps(), 5000);
    }

    /// @dev State preserved across upgrade
    function testSecurityStatePreservedAcrossUpgrade() public {
        // Build up state
        vm.warp(block.timestamp + 1 days);
        ec.drip();

        uint256 totalEmittedBefore = ec.totalEmitted();
        uint256 shapleyPoolBefore = ec.shapleyPool();
        uint256 genesisBefore = ec.genesisTime();

        // Upgrade
        EmissionController newImpl = new EmissionController();
        ec.upgradeToAndCall(address(newImpl), "");

        // All state preserved
        assertEq(ec.totalEmitted(), totalEmittedBefore);
        assertEq(ec.shapleyPool(), shapleyPoolBefore);
        assertEq(ec.genesisTime(), genesisBefore);
    }

    // ============ 15. DRAINER REVOCATION ============

    /// @dev Revoked drainer cannot drain
    function testSecurityRevokedDrainerBlocked() public {
        vm.warp(block.timestamp + 1 days);
        ec.drip();

        // Revoke drainer
        ec.setAuthorizedDrainer(drainer, false);

        IShapleyCreate.Participant[] memory p = _makeParticipants(2);
        vm.prank(drainer);
        vm.expectRevert(EmissionController.Unauthorized.selector);
        ec.createContributionGame(keccak256("blocked"), p, 1000);
    }

    /// @dev Multiple drainers — revoking one doesn't affect others
    function testSecuritySelectiveDrainerRevocation() public {
        address drainer2 = address(0xD2);
        ec.setAuthorizedDrainer(drainer2, true);

        vm.warp(block.timestamp + 1 days);
        ec.drip();

        // Revoke drainer1, drainer2 still works
        ec.setAuthorizedDrainer(drainer, false);

        IShapleyCreate.Participant[] memory p = _makeParticipants(2);

        vm.prank(drainer);
        vm.expectRevert(EmissionController.Unauthorized.selector);
        ec.createContributionGame(keccak256("d1"), p, 1000);

        vm.prank(drainer2);
        ec.createContributionGame(keccak256("d2"), p, 1000);
        assertTrue(ec.totalShapleyDrained() > 0);
    }

    // ============ HELPERS ============

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
