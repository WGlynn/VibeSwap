// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/incentives/MicroGameFactory.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Mock Contracts ============

contract MockUtilizationAccumulator {
    struct EpochPoolData {
        uint128 totalVolumeIn;
        uint128 totalVolumeOut;
        uint64 buyVolume;
        uint64 sellVolume;
        uint32 batchCount;
        uint8 maxVolatilityTier;
        bool finalized;
    }

    mapping(uint256 => mapping(bytes32 => EpochPoolData)) public epochData;
    mapping(bytes32 => address[]) public poolLPs;
    mapping(bytes32 => mapping(address => uint128)) public snapshots;
    uint256 public currentEpochId;

    function setEpochPoolData(
        uint256 epochId,
        bytes32 poolId,
        uint128 volIn,
        uint128 volOut,
        uint64 buyVol,
        uint64 sellVol,
        uint32 batchCount,
        uint8 volatilityTier,
        bool finalized
    ) external {
        epochData[epochId][poolId] = EpochPoolData({
            totalVolumeIn: volIn,
            totalVolumeOut: volOut,
            buyVolume: buyVol,
            sellVolume: sellVol,
            batchCount: batchCount,
            maxVolatilityTier: volatilityTier,
            finalized: finalized
        });
    }

    function addPoolLP(bytes32 poolId, address lp, uint128 snapshot) external {
        poolLPs[poolId].push(lp);
        snapshots[poolId][lp] = snapshot;
    }

    function getEpochPoolData(
        uint256 epochId,
        bytes32 poolId
    ) external view returns (EpochPoolData memory) {
        return epochData[epochId][poolId];
    }

    function getPoolLPs(bytes32 poolId) external view returns (address[] memory) {
        return poolLPs[poolId];
    }

    function getLPSnapshot(bytes32 poolId, address lp) external view returns (uint128) {
        return snapshots[poolId][lp];
    }
}

contract MockEmissionController {
    struct Participant {
        address participant;
        uint256 directContribution;
        uint256 timeInPool;
        uint256 scarcityScore;
        uint256 stabilityScore;
    }

    struct GameRecord {
        bytes32 gameId;
        Participant[] participants;
        uint256 drainBps;
        bool created;
    }

    mapping(bytes32 => GameRecord) public games;
    bytes32 public lastGameId;
    uint256 public lastDrainBps;
    uint256 public lastParticipantCount;
    uint256 public gameCount;

    function createContributionGame(
        bytes32 gameId,
        Participant[] calldata participants,
        uint256 drainBps
    ) external {
        GameRecord storage record = games[gameId];
        record.gameId = gameId;
        record.drainBps = drainBps;
        record.created = true;
        for (uint256 i = 0; i < participants.length; i++) {
            record.participants.push(participants[i]);
        }

        lastGameId = gameId;
        lastDrainBps = drainBps;
        lastParticipantCount = participants.length;
        gameCount++;
    }

    function getGame(bytes32 gameId) external view returns (
        uint256 participantCount,
        uint256 drainBps,
        bool created
    ) {
        GameRecord storage g = games[gameId];
        return (g.participants.length, g.drainBps, g.created);
    }

    function getParticipant(bytes32 gameId, uint256 index) external view returns (
        address participant,
        uint256 directContribution,
        uint256 timeInPool,
        uint256 scarcityScore,
        uint256 stabilityScore
    ) {
        Participant storage p = games[gameId].participants[index];
        return (p.participant, p.directContribution, p.timeInPool, p.scarcityScore, p.stabilityScore);
    }
}

contract MockLoyaltyRewards {
    mapping(bytes32 => mapping(address => uint256)) public stakeTimestamps;

    function setStakeTimestamp(bytes32 poolId, address lp, uint256 timestamp) external {
        stakeTimestamps[poolId][lp] = timestamp;
    }

    function getStakeTimestamp(bytes32 poolId, address lp) external view returns (uint256) {
        return stakeTimestamps[poolId][lp];
    }
}

// ============ MicroGameFactory Tests ============

contract MicroGameFactoryTest is Test {
    MicroGameFactory public factory;
    MockUtilizationAccumulator public mockAccumulator;
    MockEmissionController public mockEmission;
    MockLoyaltyRewards public mockLoyalty;

    address public owner;
    address public alice;
    address public bob;
    address public carol;
    address public dave;
    address public unauthorized;

    bytes32 public constant POOL_A = keccak256("pool-A");
    bytes32 public constant POOL_B = keccak256("pool-B");

    // ============ Events (re-declared for expectEmit) ============

    event MicroGameCreated(
        bytes32 indexed poolId,
        uint256 indexed epochId,
        bytes32 gameId,
        uint256 participantCount
    );

    function setUp() public {
        // Warp to a realistic timestamp so `block.timestamp - N days` never underflows
        vm.warp(1_735_689_600); // 2025-01-01 00:00:00 UTC

        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        carol = makeAddr("carol");
        dave = makeAddr("dave");
        unauthorized = makeAddr("unauthorized");

        // Deploy mocks
        mockAccumulator = new MockUtilizationAccumulator();
        mockEmission = new MockEmissionController();
        mockLoyalty = new MockLoyaltyRewards();

        // Deploy factory behind UUPS proxy
        MicroGameFactory impl = new MicroGameFactory();
        bytes memory initData = abi.encodeWithSelector(
            MicroGameFactory.initialize.selector,
            owner,
            address(mockAccumulator),
            address(mockEmission),
            address(mockLoyalty)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        factory = MicroGameFactory(address(proxy));
    }

    // ============ Helper ============

    function _setupFinalizedEpoch(
        bytes32 poolId,
        uint256 epochId,
        uint128 totalVolIn,
        uint8 volatilityTier
    ) internal {
        mockAccumulator.setEpochPoolData(
            epochId, poolId,
            totalVolIn, totalVolIn * 95 / 100, // volOut ~95% of volIn
            uint64(totalVolIn / 2e10), uint64(totalVolIn / 2e10),
            10, // batchCount
            volatilityTier,
            true // finalized
        );
    }

    function _addLP(bytes32 poolId, address lp, uint128 snapshot, uint256 stakeTime) internal {
        mockAccumulator.addPoolLP(poolId, lp, snapshot);
        if (stakeTime > 0) {
            mockLoyalty.setStakeTimestamp(poolId, lp, stakeTime);
        }
    }

    // ============ Initialization ============

    function test_initialize_setsOwner() public view {
        assertEq(factory.owner(), owner);
    }

    function test_initialize_setsContracts() public view {
        assertEq(address(factory.accumulator()), address(mockAccumulator));
        assertEq(address(factory.emissionController()), address(mockEmission));
        assertEq(address(factory.loyaltyRewards()), address(mockLoyalty));
    }

    function test_initialize_setsDefaults() public view {
        assertEq(factory.drainBps(), 500);
        assertEq(factory.maxParticipants(), 100);
        assertEq(factory.minLiquidity(), 0);
    }

    function test_initialize_revertsZeroOwner() public {
        MicroGameFactory impl = new MicroGameFactory();
        bytes memory initData = abi.encodeWithSelector(
            MicroGameFactory.initialize.selector,
            address(0),
            address(mockAccumulator),
            address(mockEmission),
            address(mockLoyalty)
        );
        vm.expectRevert(MicroGameFactory.ZeroAddress.selector);
        new ERC1967Proxy(address(impl), initData);
    }

    function test_initialize_revertsZeroAccumulator() public {
        MicroGameFactory impl = new MicroGameFactory();
        bytes memory initData = abi.encodeWithSelector(
            MicroGameFactory.initialize.selector,
            owner,
            address(0),
            address(mockEmission),
            address(mockLoyalty)
        );
        vm.expectRevert(MicroGameFactory.ZeroAddress.selector);
        new ERC1967Proxy(address(impl), initData);
    }

    function test_initialize_revertsZeroEmissionController() public {
        MicroGameFactory impl = new MicroGameFactory();
        bytes memory initData = abi.encodeWithSelector(
            MicroGameFactory.initialize.selector,
            owner,
            address(mockAccumulator),
            address(0),
            address(mockLoyalty)
        );
        vm.expectRevert(MicroGameFactory.ZeroAddress.selector);
        new ERC1967Proxy(address(impl), initData);
    }

    function test_initialize_cannotReinitialize() public {
        vm.expectRevert();
        factory.initialize(owner, address(mockAccumulator), address(mockEmission), address(mockLoyalty));
    }

    // ============ Core: createMicroGame ============

    function test_createMicroGame_basicFlow() public {
        _setupFinalizedEpoch(POOL_A, 1, 1000e18, 1);
        _addLP(POOL_A, alice, 3000e18, block.timestamp - 7 days);
        _addLP(POOL_A, bob, 7000e18, block.timestamp - 14 days);

        factory.createMicroGame(POOL_A, 1);

        // Verify game was created in emission controller
        assertEq(mockEmission.gameCount(), 1);
        assertEq(mockEmission.lastParticipantCount(), 2);
        assertEq(mockEmission.lastDrainBps(), 500);
    }

    function test_createMicroGame_permissionless() public {
        _setupFinalizedEpoch(POOL_A, 1, 1000e18, 0);
        _addLP(POOL_A, alice, 5000e18, block.timestamp - 1 days);

        // Anyone can call this
        vm.prank(unauthorized);
        factory.createMicroGame(POOL_A, 1);

        assertEq(mockEmission.gameCount(), 1);
    }

    function test_createMicroGame_emitsEvent() public {
        _setupFinalizedEpoch(POOL_A, 1, 1000e18, 0);
        _addLP(POOL_A, alice, 5000e18, block.timestamp - 1 days);

        bytes32 expectedGameId = keccak256(abi.encodePacked("micro", POOL_A, uint256(1)));

        vm.expectEmit(true, true, false, true);
        emit MicroGameCreated(POOL_A, 1, expectedGameId, 1);
        factory.createMicroGame(POOL_A, 1);
    }

    function test_createMicroGame_updatesLastSettledEpoch() public {
        _setupFinalizedEpoch(POOL_A, 1, 1000e18, 0);
        _addLP(POOL_A, alice, 5000e18, block.timestamp - 1 days);

        factory.createMicroGame(POOL_A, 1);
        assertEq(factory.lastSettledEpoch(POOL_A), 1);
    }

    function test_createMicroGame_revertsEpochNotFinalized() public {
        // Set non-finalized epoch
        mockAccumulator.setEpochPoolData(1, POOL_A, 1000e18, 950e18, 50e8, 50e8, 10, 0, false);
        _addLP(POOL_A, alice, 5000e18, block.timestamp - 1 days);

        vm.expectRevert(MicroGameFactory.EpochNotFinalized.selector);
        factory.createMicroGame(POOL_A, 1);
    }

    function test_createMicroGame_revertsEpochAlreadySettled() public {
        _setupFinalizedEpoch(POOL_A, 1, 1000e18, 0);
        _addLP(POOL_A, alice, 5000e18, block.timestamp - 1 days);

        // Settle epoch 1
        factory.createMicroGame(POOL_A, 1);

        // Try to settle again
        vm.expectRevert(MicroGameFactory.EpochAlreadySettled.selector);
        factory.createMicroGame(POOL_A, 1);
    }

    function test_createMicroGame_revertsNoQualifiedParticipants_noLPs() public {
        _setupFinalizedEpoch(POOL_A, 1, 1000e18, 0);
        // No LPs added

        vm.expectRevert(MicroGameFactory.NoQualifiedParticipants.selector);
        factory.createMicroGame(POOL_A, 1);
    }

    function test_createMicroGame_revertsNoQualifiedParticipants_belowMinLiquidity() public {
        _setupFinalizedEpoch(POOL_A, 1, 1000e18, 0);
        _addLP(POOL_A, alice, 50e18, block.timestamp - 1 days);

        // Set minLiquidity above alice's snapshot
        factory.setMinLiquidity(100e18);

        vm.expectRevert(MicroGameFactory.NoQualifiedParticipants.selector);
        factory.createMicroGame(POOL_A, 1);
    }

    // ============ Contribution Scoring ============

    function test_createMicroGame_directContributionProportionalToSnapshot() public {
        _setupFinalizedEpoch(POOL_A, 1, 1000e18, 0);
        // Alice: 30%, Bob: 70% of pool
        _addLP(POOL_A, alice, 3000e18, block.timestamp - 1 days);
        _addLP(POOL_A, bob, 7000e18, block.timestamp - 1 days);

        factory.createMicroGame(POOL_A, 1);

        bytes32 gameId = keccak256(abi.encodePacked("micro", POOL_A, uint256(1)));

        // Bob should be first (higher contribution, sorted descending)
        (address p0, uint256 dc0,,, ) = mockEmission.getParticipant(gameId, 0);
        (address p1, uint256 dc1,,, ) = mockEmission.getParticipant(gameId, 1);

        assertEq(p0, bob);
        assertEq(p1, alice);

        // directContribution = snapshot * totalVolumeIn / totalPoolLiquidity
        // bob: 7000e18 * 1000e18 / 10000e18 = 700e18
        // alice: 3000e18 * 1000e18 / 10000e18 = 300e18
        assertEq(dc0, 700e18);
        assertEq(dc1, 300e18);
    }

    function test_createMicroGame_stabilityScoreBaseCase() public {
        // volatilityTier = 0 → stability = 5000
        _setupFinalizedEpoch(POOL_A, 1, 1000e18, 0);
        _addLP(POOL_A, alice, 5000e18, block.timestamp - 1 days);

        factory.createMicroGame(POOL_A, 1);

        bytes32 gameId = keccak256(abi.encodePacked("micro", POOL_A, uint256(1)));
        (,,,, uint256 stability) = mockEmission.getParticipant(gameId, 0);
        assertEq(stability, 5000);
    }

    function test_createMicroGame_stabilityScoreHighVolatility() public {
        // volatilityTier = 2 (HIGH) → stability = 7500
        _setupFinalizedEpoch(POOL_A, 1, 1000e18, 2);
        _addLP(POOL_A, alice, 5000e18, block.timestamp - 1 days);

        factory.createMicroGame(POOL_A, 1);

        bytes32 gameId = keccak256(abi.encodePacked("micro", POOL_A, uint256(1)));
        (,,,, uint256 stability) = mockEmission.getParticipant(gameId, 0);
        assertEq(stability, 7500);
    }

    function test_createMicroGame_stabilityScoreExtremeVolatility() public {
        // volatilityTier = 3 (EXTREME) → stability = 10000
        _setupFinalizedEpoch(POOL_A, 1, 1000e18, 3);
        _addLP(POOL_A, alice, 5000e18, block.timestamp - 1 days);

        factory.createMicroGame(POOL_A, 1);

        bytes32 gameId = keccak256(abi.encodePacked("micro", POOL_A, uint256(1)));
        (,,,, uint256 stability) = mockEmission.getParticipant(gameId, 0);
        assertEq(stability, 10000);
    }

    function test_createMicroGame_stabilityScoreAboveExtreme() public {
        // volatilityTier = 5 (above EXTREME) → still 10000
        _setupFinalizedEpoch(POOL_A, 1, 1000e18, 5);
        _addLP(POOL_A, alice, 5000e18, block.timestamp - 1 days);

        factory.createMicroGame(POOL_A, 1);

        bytes32 gameId = keccak256(abi.encodePacked("micro", POOL_A, uint256(1)));
        (,,,, uint256 stability) = mockEmission.getParticipant(gameId, 0);
        assertEq(stability, 10000);
    }

    function test_createMicroGame_scarcityScoreAlways5000() public {
        _setupFinalizedEpoch(POOL_A, 1, 1000e18, 0);
        _addLP(POOL_A, alice, 5000e18, block.timestamp - 1 days);
        _addLP(POOL_A, bob, 5000e18, block.timestamp - 30 days);

        factory.createMicroGame(POOL_A, 1);

        bytes32 gameId = keccak256(abi.encodePacked("micro", POOL_A, uint256(1)));
        (,,, uint256 scarcity0, ) = mockEmission.getParticipant(gameId, 0);
        (,,, uint256 scarcity1, ) = mockEmission.getParticipant(gameId, 1);
        assertEq(scarcity0, 5000);
        assertEq(scarcity1, 5000);
    }

    function test_createMicroGame_timeInPoolFromLoyaltyRewards() public {
        uint256 stakeTime = block.timestamp - 10 days;
        _setupFinalizedEpoch(POOL_A, 1, 1000e18, 0);
        _addLP(POOL_A, alice, 5000e18, stakeTime);

        factory.createMicroGame(POOL_A, 1);

        bytes32 gameId = keccak256(abi.encodePacked("micro", POOL_A, uint256(1)));
        (,, uint256 timeInPool,, ) = mockEmission.getParticipant(gameId, 0);
        assertEq(timeInPool, block.timestamp - stakeTime);
    }

    function test_createMicroGame_timeInPoolDefaultFallback() public {
        _setupFinalizedEpoch(POOL_A, 1, 1000e18, 0);
        // Don't set stake timestamp (defaults to 0)
        _addLP(POOL_A, alice, 5000e18, 0);

        factory.createMicroGame(POOL_A, 1);

        bytes32 gameId = keccak256(abi.encodePacked("micro", POOL_A, uint256(1)));
        (,, uint256 timeInPool,, ) = mockEmission.getParticipant(gameId, 0);
        assertEq(timeInPool, 1 days); // fallback value
    }

    // ============ Sorting & Capping ============

    function test_createMicroGame_sortedByDirectContributionDescending() public {
        _setupFinalizedEpoch(POOL_A, 1, 1000e18, 0);
        // Deliberately add in ascending order
        _addLP(POOL_A, alice, 1000e18, block.timestamp - 1 days); // smallest
        _addLP(POOL_A, bob, 5000e18, block.timestamp - 1 days);   // middle
        _addLP(POOL_A, carol, 4000e18, block.timestamp - 1 days); // second

        factory.createMicroGame(POOL_A, 1);

        bytes32 gameId = keccak256(abi.encodePacked("micro", POOL_A, uint256(1)));

        (address p0,,,, ) = mockEmission.getParticipant(gameId, 0);
        (address p1,,,, ) = mockEmission.getParticipant(gameId, 1);
        (address p2,,,, ) = mockEmission.getParticipant(gameId, 2);

        assertEq(p0, bob);   // 5000 → highest
        assertEq(p1, carol); // 4000
        assertEq(p2, alice); // 1000 → lowest
    }

    function test_createMicroGame_cappedAtMaxParticipants() public {
        factory.setMaxParticipants(2);

        _setupFinalizedEpoch(POOL_A, 1, 1000e18, 0);
        _addLP(POOL_A, alice, 1000e18, block.timestamp - 1 days);
        _addLP(POOL_A, bob, 3000e18, block.timestamp - 1 days);
        _addLP(POOL_A, carol, 6000e18, block.timestamp - 1 days);

        factory.createMicroGame(POOL_A, 1);

        // Only top 2 should be included
        assertEq(mockEmission.lastParticipantCount(), 2);

        bytes32 gameId = keccak256(abi.encodePacked("micro", POOL_A, uint256(1)));
        (address p0,,,, ) = mockEmission.getParticipant(gameId, 0);
        (address p1,,,, ) = mockEmission.getParticipant(gameId, 1);

        assertEq(p0, carol); // 6000 → highest
        assertEq(p1, bob);   // 3000 → second
    }

    // ============ MinLiquidity Filter ============

    function test_createMicroGame_filtersOutBelowMinLiquidity() public {
        factory.setMinLiquidity(2000e18);

        _setupFinalizedEpoch(POOL_A, 1, 1000e18, 0);
        _addLP(POOL_A, alice, 1000e18, block.timestamp - 1 days); // below min
        _addLP(POOL_A, bob, 5000e18, block.timestamp - 1 days);   // above min
        _addLP(POOL_A, carol, 4000e18, block.timestamp - 1 days); // above min

        factory.createMicroGame(POOL_A, 1);

        // Only bob and carol qualify
        assertEq(mockEmission.lastParticipantCount(), 2);

        bytes32 gameId = keccak256(abi.encodePacked("micro", POOL_A, uint256(1)));
        (address p0,,,, ) = mockEmission.getParticipant(gameId, 0);
        (address p1,,,, ) = mockEmission.getParticipant(gameId, 1);

        assertEq(p0, bob);
        assertEq(p1, carol);
    }

    // ============ Batch Creation ============

    function test_createMicroGamesForEpoch_multiplePoolsAtOnce() public {
        _setupFinalizedEpoch(POOL_A, 1, 1000e18, 0);
        _addLP(POOL_A, alice, 5000e18, block.timestamp - 1 days);

        _setupFinalizedEpoch(POOL_B, 1, 2000e18, 1);
        _addLP(POOL_B, bob, 8000e18, block.timestamp - 3 days);

        bytes32[] memory poolIds = new bytes32[](2);
        poolIds[0] = POOL_A;
        poolIds[1] = POOL_B;

        factory.createMicroGamesForEpoch(poolIds, 1);

        assertEq(mockEmission.gameCount(), 2);
        assertEq(factory.lastSettledEpoch(POOL_A), 1);
        assertEq(factory.lastSettledEpoch(POOL_B), 1);
    }

    // ============ Sequential Epochs ============

    function test_createMicroGame_sequentialEpochsWork() public {
        _setupFinalizedEpoch(POOL_A, 1, 1000e18, 0);
        _addLP(POOL_A, alice, 5000e18, block.timestamp - 1 days);

        factory.createMicroGame(POOL_A, 1);
        assertEq(factory.lastSettledEpoch(POOL_A), 1);

        // Epoch 2
        _setupFinalizedEpoch(POOL_A, 2, 2000e18, 1);
        factory.createMicroGame(POOL_A, 2);
        assertEq(factory.lastSettledEpoch(POOL_A), 2);

        assertEq(mockEmission.gameCount(), 2);
    }

    function test_createMicroGame_cannotSettleOlderEpochAfterNewer() public {
        // Settle epoch 5 first
        _setupFinalizedEpoch(POOL_A, 5, 1000e18, 0);
        _addLP(POOL_A, alice, 5000e18, block.timestamp - 1 days);
        factory.createMicroGame(POOL_A, 5);

        // Try to settle epoch 3 (older)
        _setupFinalizedEpoch(POOL_A, 3, 500e18, 0);
        vm.expectRevert(MicroGameFactory.EpochAlreadySettled.selector);
        factory.createMicroGame(POOL_A, 3);
    }

    // ============ Game ID Determinism ============

    function test_createMicroGame_gameIdIsDeterministic() public {
        _setupFinalizedEpoch(POOL_A, 1, 1000e18, 0);
        _addLP(POOL_A, alice, 5000e18, block.timestamp - 1 days);

        factory.createMicroGame(POOL_A, 1);

        bytes32 expectedGameId = keccak256(abi.encodePacked("micro", POOL_A, uint256(1)));
        assertEq(mockEmission.lastGameId(), expectedGameId);
    }

    // ============ Admin Functions ============

    function test_setDrainBps_updates() public {
        factory.setDrainBps(1000);
        assertEq(factory.drainBps(), 1000);
    }

    function test_setDrainBps_revertsAboveBPS() public {
        vm.expectRevert(MicroGameFactory.InvalidBps.selector);
        factory.setDrainBps(10001);
    }

    function test_setDrainBps_allowsMaxBPS() public {
        factory.setDrainBps(10000);
        assertEq(factory.drainBps(), 10000);
    }

    function test_setDrainBps_onlyOwner() public {
        vm.prank(unauthorized);
        vm.expectRevert();
        factory.setDrainBps(1000);
    }

    function test_setMaxParticipants_updates() public {
        factory.setMaxParticipants(50);
        assertEq(factory.maxParticipants(), 50);
    }

    function test_setMaxParticipants_onlyOwner() public {
        vm.prank(unauthorized);
        vm.expectRevert();
        factory.setMaxParticipants(50);
    }

    function test_setMinLiquidity_updates() public {
        factory.setMinLiquidity(1000e18);
        assertEq(factory.minLiquidity(), 1000e18);
    }

    function test_setMinLiquidity_onlyOwner() public {
        vm.prank(unauthorized);
        vm.expectRevert();
        factory.setMinLiquidity(1000e18);
    }

    function test_setDrainBps_usedInGameCreation() public {
        factory.setDrainBps(1500); // 15%

        _setupFinalizedEpoch(POOL_A, 1, 1000e18, 0);
        _addLP(POOL_A, alice, 5000e18, block.timestamp - 1 days);

        factory.createMicroGame(POOL_A, 1);

        assertEq(mockEmission.lastDrainBps(), 1500);
    }

    // ============ Fuzz Tests ============

    function testFuzz_createMicroGame_directContributionSumsToTotalVolume(
        uint128 snapshot1,
        uint128 snapshot2,
        uint128 totalVol
    ) public {
        // Bound to avoid overflow and zero division
        snapshot1 = uint128(bound(snapshot1, 1, 1e30));
        snapshot2 = uint128(bound(snapshot2, 1, 1e30));
        totalVol = uint128(bound(totalVol, 1, 1e30));

        _setupFinalizedEpoch(POOL_A, 1, totalVol, 0);
        _addLP(POOL_A, alice, snapshot1, block.timestamp - 1 days);
        _addLP(POOL_A, bob, snapshot2, block.timestamp - 1 days);

        factory.createMicroGame(POOL_A, 1);

        bytes32 gameId = keccak256(abi.encodePacked("micro", POOL_A, uint256(1)));

        (, uint256 dc0,,, ) = mockEmission.getParticipant(gameId, 0);
        (, uint256 dc1,,, ) = mockEmission.getParticipant(gameId, 1);

        // Due to integer division, sum may be slightly less than totalVol
        // but should never exceed it
        assertLe(dc0 + dc1, uint256(totalVol));
    }

    function testFuzz_setDrainBps_boundedByBPS(uint256 bps) public {
        if (bps > 10000) {
            vm.expectRevert(MicroGameFactory.InvalidBps.selector);
            factory.setDrainBps(bps);
        } else {
            factory.setDrainBps(bps);
            assertEq(factory.drainBps(), bps);
        }
    }
}
