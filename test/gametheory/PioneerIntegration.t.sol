// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/incentives/ShapleyDistributor.sol";
import "../../contracts/incentives/PriorityRegistry.sol";
import "../../contracts/libraries/PairwiseFairness.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor() ERC20("Mock", "MCK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/**
 * @title Pioneer Integration Tests
 * @notice Proves that pioneer bonus integrates correctly with Shapley distribution:
 *         - Pioneers get higher rewards through measured impact
 *         - Pairwise proportionality is preserved
 *         - Time neutrality is preserved
 *         - Non-pioneers are unaffected when no registry/scope is set
 */
contract PioneerIntegrationTest is Test {
    ShapleyDistributor public distributor;
    PriorityRegistry public registry;
    MockToken public token;

    address public owner;
    address public authorizedCreator;

    bytes32 constant SCOPE_ETH_USDC = keccak256("ETH/USDC");
    uint256 constant PRECISION = 1e18;

    function setUp() public {
        owner = address(this);
        authorizedCreator = makeAddr("authorizedCreator");

        token = new MockToken();

        // Deploy PriorityRegistry
        PriorityRegistry registryImpl = new PriorityRegistry();
        bytes memory registryInit = abi.encodeWithSelector(
            PriorityRegistry.initialize.selector, owner
        );
        ERC1967Proxy registryProxy = new ERC1967Proxy(address(registryImpl), registryInit);
        registry = PriorityRegistry(address(registryProxy));

        // Deploy ShapleyDistributor
        ShapleyDistributor distImpl = new ShapleyDistributor();
        bytes memory distInit = abi.encodeWithSelector(
            ShapleyDistributor.initialize.selector, owner
        );
        ERC1967Proxy distProxy = new ERC1967Proxy(address(distImpl), distInit);
        distributor = ShapleyDistributor(payable(address(distProxy)));

        // Wire up
        distributor.setAuthorizedCreator(authorizedCreator, true);
        distributor.setPriorityRegistry(address(registry));
        registry.setAuthorizedRecorder(owner, true);
    }

    // ============ Helpers ============

    function _twoParticipants(
        address a, uint256 contribA,
        address b, uint256 contribB
    ) internal pure returns (ShapleyDistributor.Participant[] memory) {
        ShapleyDistributor.Participant[] memory p = new ShapleyDistributor.Participant[](2);
        p[0] = ShapleyDistributor.Participant(a, contribA, 30 days, 5000, 5000);
        p[1] = ShapleyDistributor.Participant(b, contribB, 30 days, 5000, 5000);
        return p;
    }

    function _createAndSettleFull(
        bytes32 gameId,
        uint256 totalValue,
        bytes32 scopeId,
        ShapleyDistributor.Participant[] memory participants
    ) internal {
        token.mint(address(distributor), totalValue);

        vm.prank(authorizedCreator);
        distributor.createGameFull(
            gameId, totalValue, address(token),
            ShapleyDistributor.GameType.FEE_DISTRIBUTION,
            scopeId, participants
        );

        vm.prank(authorizedCreator);
        distributor.computeShapleyValues(gameId);
    }

    function _createAndSettle(
        bytes32 gameId,
        uint256 totalValue,
        ShapleyDistributor.Participant[] memory participants
    ) internal {
        token.mint(address(distributor), totalValue);

        vm.prank(authorizedCreator);
        distributor.createGame(gameId, totalValue, address(token), participants);

        vm.prank(authorizedCreator);
        distributor.computeShapleyValues(gameId);
    }

    // ============ Pioneer Gets Bonus Through Impact ============

    /**
     * @notice Pioneer with identical base contribution gets more than non-pioneer
     * @dev The bonus comes from measured impact (PriorityRegistry score),
     *      not from a time-biased reward curve
     */
    function test_pioneer_gets_bonus_through_impact() public {
        address pioneer = makeAddr("pioneer");
        address regular = makeAddr("regular");

        // Register pioneer for ETH/USDC pool creation
        registry.recordPriority(SCOPE_ETH_USDC, PriorityRegistry.Category.POOL_CREATION, pioneer);

        // Both have IDENTICAL base contributions
        ShapleyDistributor.Participant[] memory p = _twoParticipants(
            pioneer, 10 ether,
            regular, 10 ether
        );

        _createAndSettleFull(keccak256("pioneer_test"), 100 ether, SCOPE_ETH_USDC, p);

        uint256 pioneerReward = distributor.getShapleyValue(keccak256("pioneer_test"), pioneer);
        uint256 regularReward = distributor.getShapleyValue(keccak256("pioneer_test"), regular);

        // Pioneer gets more due to bonus multiplier
        assertGt(pioneerReward, regularReward, "Pioneer should earn more from impact bonus");

        // But total is still fully distributed (efficiency axiom)
        assertEq(pioneerReward + regularReward, 100 ether, "Total must be fully distributed");

        // Pioneer weight should be higher
        uint256 pioneerWeight = distributor.getWeightedContribution(keccak256("pioneer_test"), pioneer);
        uint256 regularWeight = distributor.getWeightedContribution(keccak256("pioneer_test"), regular);
        assertGt(pioneerWeight, regularWeight, "Pioneer weight should be higher");
    }

    /**
     * @notice Pioneer bonus scales with pioneer score
     */
    function test_pioneer_bonus_is_proportional() public {
        address poolCreator = makeAddr("poolCreator");
        address fullPioneer = makeAddr("fullPioneer");
        address regular = makeAddr("regular");

        // poolCreator: only POOL_CREATION (score = 10000)
        registry.recordPriority(SCOPE_ETH_USDC, PriorityRegistry.Category.POOL_CREATION, poolCreator);

        // fullPioneer: POOL_CREATION + LIQUIDITY_BOOTSTRAP (score = 17500)
        bytes32 scope2 = keccak256("OTHER/PAIR");
        registry.recordPriority(scope2, PriorityRegistry.Category.POOL_CREATION, fullPioneer);
        registry.recordPriority(scope2, PriorityRegistry.Category.LIQUIDITY_BOOTSTRAP, fullPioneer);

        // Game 1: poolCreator vs regular in ETH/USDC scope
        ShapleyDistributor.Participant[] memory p1 = _twoParticipants(
            poolCreator, 10 ether, regular, 10 ether
        );
        _createAndSettleFull(keccak256("proportional_1"), 100 ether, SCOPE_ETH_USDC, p1);

        // Game 2: fullPioneer vs regular in OTHER/PAIR scope
        ShapleyDistributor.Participant[] memory p2 = _twoParticipants(
            fullPioneer, 10 ether, regular, 10 ether
        );
        _createAndSettleFull(keccak256("proportional_2"), 100 ether, scope2, p2);

        uint256 poolCreatorReward = distributor.getShapleyValue(keccak256("proportional_1"), poolCreator);
        uint256 fullPioneerReward = distributor.getShapleyValue(keccak256("proportional_2"), fullPioneer);

        // fullPioneer with higher score gets more than single-category pioneer
        assertGt(fullPioneerReward, poolCreatorReward, "Higher pioneer score should yield higher bonus");
    }

    // ============ Backward Compatibility ============

    /**
     * @notice When registry is address(0), no pioneer effect
     */
    function test_no_registry_no_bonus() public {
        address alice = makeAddr("alice");
        address bob = makeAddr("bob");

        // Remove registry
        distributor.setPriorityRegistry(address(0));

        // Register alice as pioneer (in registry, but distributor doesn't see it)
        registry.recordPriority(SCOPE_ETH_USDC, PriorityRegistry.Category.POOL_CREATION, alice);

        // Create game WITH scope
        ShapleyDistributor.Participant[] memory p = _twoParticipants(alice, 10 ether, bob, 10 ether);
        _createAndSettleFull(keccak256("no_registry"), 100 ether, SCOPE_ETH_USDC, p);

        // Equal contributions → equal rewards (no pioneer effect)
        uint256 aliceReward = distributor.getShapleyValue(keccak256("no_registry"), alice);
        uint256 bobReward = distributor.getShapleyValue(keccak256("no_registry"), bob);

        assertApproxEqAbs(aliceReward, bobReward, 1, "Without registry, equal contributions should get equal rewards");
    }

    /**
     * @notice When scopeId is bytes32(0), no pioneer effect
     */
    function test_no_scope_no_bonus() public {
        address alice = makeAddr("alice");
        address bob = makeAddr("bob");

        // Register alice as pioneer
        registry.recordPriority(SCOPE_ETH_USDC, PriorityRegistry.Category.POOL_CREATION, alice);

        // Create game WITHOUT scope (regular createGame)
        ShapleyDistributor.Participant[] memory p = _twoParticipants(alice, 10 ether, bob, 10 ether);
        _createAndSettle(keccak256("no_scope"), 100 ether, p);

        // Equal contributions → equal rewards
        uint256 aliceReward = distributor.getShapleyValue(keccak256("no_scope"), alice);
        uint256 bobReward = distributor.getShapleyValue(keccak256("no_scope"), bob);

        assertApproxEqAbs(aliceReward, bobReward, 1, "Without scope, equal contributions should get equal rewards");
    }

    // ============ Fairness Preservation ============

    /**
     * @notice Pairwise proportionality holds even with pioneer bonus
     * @dev Pioneer multiplier scales all weight components equally,
     *      so the ratio between weighted contributions remains proportional
     */
    function test_pioneer_still_pairwise_proportional() public {
        address pioneer = makeAddr("pioneer");
        address regular = makeAddr("regular");

        registry.recordPriority(SCOPE_ETH_USDC, PriorityRegistry.Category.POOL_CREATION, pioneer);

        // Different base contributions
        ShapleyDistributor.Participant[] memory p = _twoParticipants(
            pioneer, 20 ether,
            regular, 5 ether
        );

        bytes32 gameId = keccak256("pairwise_pioneer");
        _createAndSettleFull(gameId, 100 ether, SCOPE_ETH_USDC, p);

        // Use on-chain verification
        (bool fair, uint256 deviation) = distributor.verifyPairwiseFairness(gameId, pioneer, regular);
        assertTrue(fair, "Pairwise proportionality must hold with pioneer bonus");
    }

    /**
     * @notice Time neutrality holds: same pioneer in different eras gets same bonus
     */
    function test_pioneer_bonus_compatible_with_time_neutrality() public {
        address pioneer = makeAddr("pioneer");
        address regular = makeAddr("regular");

        registry.recordPriority(SCOPE_ETH_USDC, PriorityRegistry.Category.POOL_CREATION, pioneer);

        // Game 1: early
        ShapleyDistributor.Participant[] memory p1 = _twoParticipants(pioneer, 10 ether, regular, 5 ether);
        _createAndSettleFull(keccak256("tn_pioneer_1"), 50 ether, SCOPE_ETH_USDC, p1);

        // Game 2: later (same params)
        ShapleyDistributor.Participant[] memory p2 = _twoParticipants(pioneer, 10 ether, regular, 5 ether);
        _createAndSettleFull(keccak256("tn_pioneer_2"), 50 ether, SCOPE_ETH_USDC, p2);

        // Same pioneer, same contribution, same total → same reward
        uint256 reward1 = distributor.getShapleyValue(keccak256("tn_pioneer_1"), pioneer);
        uint256 reward2 = distributor.getShapleyValue(keccak256("tn_pioneer_2"), pioneer);

        assertEq(reward1, reward2, "TIME NEUTRALITY VIOLATED: pioneer got different reward in different game");
    }

    /**
     * @notice Existing createGame path produces identical results (no regression)
     */
    function test_nonPioneer_rewards_unchanged() public {
        address alice = makeAddr("alice");
        address bob = makeAddr("bob");

        // Game via old path (createGame, no scope)
        ShapleyDistributor.Participant[] memory p1 = _twoParticipants(alice, 10 ether, bob, 5 ether);
        _createAndSettle(keccak256("old_path"), 100 ether, p1);

        // Game via new path (createGameFull, but no scope)
        ShapleyDistributor.Participant[] memory p2 = _twoParticipants(alice, 10 ether, bob, 5 ether);
        _createAndSettleFull(keccak256("new_path"), 100 ether, bytes32(0), p2);

        // Rewards should be identical
        uint256 alice1 = distributor.getShapleyValue(keccak256("old_path"), alice);
        uint256 alice2 = distributor.getShapleyValue(keccak256("new_path"), alice);
        uint256 bob1 = distributor.getShapleyValue(keccak256("old_path"), bob);
        uint256 bob2 = distributor.getShapleyValue(keccak256("new_path"), bob);

        assertEq(alice1, alice2, "Old and new path should produce identical Alice rewards");
        assertEq(bob1, bob2, "Old and new path should produce identical Bob rewards");
    }
}
