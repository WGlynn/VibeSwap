// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/incentives/ShapleyDistributor.sol";
import "../contracts/mechanism/AugmentedBondingCurve.sol";
import "../contracts/mechanism/IABCHealthCheck.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock Contracts ============

contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function burnFrom(address from, uint256 amount) external { _burn(from, amount); }
}

/// @dev Mock ABC that always reports unhealthy (drift > 5%)
contract MockUnhealthyABC is IABCHealthCheck {
    bool public isOpen = true;
    uint256 public driftToReport;

    constructor(uint256 _driftBps) {
        driftToReport = _driftBps;
    }

    function isHealthy() external view returns (bool healthy, uint256 driftBps) {
        return (false, driftToReport);
    }
}

/// @dev Mock ABC that always reports healthy
contract MockHealthyABC is IABCHealthCheck {
    bool public isOpen = true;

    function isHealthy() external pure returns (bool healthy, uint256 driftBps) {
        return (true, 0);
    }
}

/// @dev Mock ABC that is not open (simulates unopened curve)
contract MockClosedABC is IABCHealthCheck {
    bool public isOpen = false;

    function isHealthy() external pure returns (bool healthy, uint256 driftBps) {
        return (false, 10000);
    }
}

// ============ Test Contract ============

contract ShapleyABCSealTest is Test {
    ShapleyDistributor public distributor;
    AugmentedBondingCurve public abc;
    MockToken public reserveToken;
    MockToken public communityToken;
    MockToken public rewardToken;

    address public owner;
    address public alice;
    address public bob;
    address public nonOwner;

    uint256 constant INITIAL_RESERVE = 1000e18;
    uint256 constant INITIAL_SUPPLY = 10000e18;
    uint256 constant INITIAL_FUNDING = 100e18;

    // Events (must re-declare for vm.expectEmit)
    event BondingCurveSealed(address indexed bondingCurve);
    event ABCHealthGate(bytes32 indexed gameId, bool healthy, uint256 driftBps);
    event GameCreated(bytes32 indexed gameId, uint256 totalValue, address token, uint256 participantCount);

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        nonOwner = makeAddr("nonOwner");

        // Deploy tokens
        reserveToken = new MockToken("Reserve", "RSV");
        communityToken = new MockToken("Community", "COM");
        rewardToken = new MockToken("Reward", "RWD");

        // Deploy AugmentedBondingCurve
        abc = new AugmentedBondingCurve(
            address(reserveToken),
            address(communityToken),
            address(communityToken), // tokenController = communityToken (has mint/burnFrom)
            6,    // kappa
            200,  // 2% entry tribute
            500   // 5% exit tribute
        );

        // Mint initial tokens and open curve
        reserveToken.mint(address(abc), INITIAL_RESERVE);
        communityToken.mint(address(this), INITIAL_SUPPLY);
        abc.openCurve(INITIAL_RESERVE, INITIAL_FUNDING, INITIAL_SUPPLY);

        // Deploy ShapleyDistributor behind UUPS proxy
        ShapleyDistributor impl = new ShapleyDistributor();
        bytes memory initData = abi.encodeWithSelector(
            ShapleyDistributor.initialize.selector,
            owner
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        distributor = ShapleyDistributor(payable(address(proxy)));

        // Authorize test contract as game creator
        distributor.setAuthorizedCreator(address(this), true);
    }

    // ============ Helpers ============

    function _makeParticipants() internal view returns (ShapleyDistributor.Participant[] memory) {
        ShapleyDistributor.Participant[] memory p = new ShapleyDistributor.Participant[](2);
        p[0] = ShapleyDistributor.Participant({
            participant: alice,
            directContribution: 50e18,
            timeInPool: 7 days,
            scarcityScore: 5000,
            stabilityScore: 8000
        });
        p[1] = ShapleyDistributor.Participant({
            participant: bob,
            directContribution: 50e18,
            timeInPool: 7 days,
            scarcityScore: 5000,
            stabilityScore: 8000
        });
        return p;
    }

    function _createDefaultGame(bytes32 gameId) internal {
        ShapleyDistributor.Participant[] memory participants = _makeParticipants();
        rewardToken.mint(address(distributor), 100e18);
        distributor.createGame(gameId, 100e18, address(rewardToken), participants);
    }

    // ============ Test 1: sealBondingCurve works ============

    function test_sealBondingCurve() public {
        assertFalse(distributor.bondingCurveSealed(), "Should not be sealed initially");

        vm.expectEmit(true, false, false, false);
        emit BondingCurveSealed(address(abc));

        distributor.sealBondingCurve(address(abc));

        assertTrue(distributor.bondingCurveSealed(), "Should be sealed after call");
        assertEq(address(distributor.bondingCurve()), address(abc), "bondingCurve should match");
    }

    // ============ Test 2: Only owner can seal ============

    function test_sealBondingCurve_onlyOwner() public {
        vm.prank(nonOwner);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", nonOwner));
        distributor.sealBondingCurve(address(abc));
    }

    // ============ Test 3: Cannot seal twice (irreversible) ============

    function test_sealBondingCurve_irreversible() public {
        distributor.sealBondingCurve(address(abc));

        // Deploy a second healthy ABC to try sealing with a different address
        MockHealthyABC abc2 = new MockHealthyABC();

        vm.expectRevert(ShapleyDistributor.BondingCurveAlreadySealed.selector);
        distributor.sealBondingCurve(address(abc2));
    }

    // ============ Test 4: Cannot seal with unopened ABC ============

    function test_sealBondingCurve_requiresOpenCurve() public {
        MockClosedABC closedAbc = new MockClosedABC();

        vm.expectRevert("ABC not open");
        distributor.sealBondingCurve(address(closedAbc));
    }

    // ============ Test 5: createGame passes when ABC is healthy ============

    function test_createGame_passesWhenABCHealthy() public {
        // Seal with real healthy ABC
        distributor.sealBondingCurve(address(abc));

        // Verify ABC is healthy
        (bool healthy,) = abc.isHealthy();
        assertTrue(healthy, "ABC should be healthy");

        // Create game — should succeed
        bytes32 gameId = keccak256("healthy-game");
        ShapleyDistributor.Participant[] memory participants = _makeParticipants();
        rewardToken.mint(address(distributor), 100e18);

        distributor.createGame(gameId, 100e18, address(rewardToken), participants);

        // Verify game was created
        (bytes32 storedId, uint256 totalValue,,,,) = distributor.games(gameId);
        assertEq(storedId, gameId, "Game ID should match");
        assertEq(totalValue, 100e18, "Total value should match");
    }

    // ============ Test 6: createGame reverts when ABC is unhealthy ============

    function test_createGame_revertsWhenABCUnhealthy() public {
        // Seal with mock unhealthy ABC (drift = 600 bps = 6%, above 5% threshold)
        MockUnhealthyABC unhealthyAbc = new MockUnhealthyABC(600);
        distributor.sealBondingCurve(address(unhealthyAbc));

        bytes32 gameId = keccak256("unhealthy-game");
        ShapleyDistributor.Participant[] memory participants = _makeParticipants();
        rewardToken.mint(address(distributor), 100e18);

        vm.expectRevert(abi.encodeWithSelector(ShapleyDistributor.ABCUnhealthy.selector, 600));
        distributor.createGame(gameId, 100e18, address(rewardToken), participants);
    }

    // ============ Test 7: computeShapley passes when ABC is healthy ============

    function test_computeShapley_passesWhenABCHealthy() public {
        // Seal with real healthy ABC
        distributor.sealBondingCurve(address(abc));

        // Create game (ABC is healthy, so creation works)
        bytes32 gameId = keccak256("settle-healthy");
        ShapleyDistributor.Participant[] memory participants = _makeParticipants();
        rewardToken.mint(address(distributor), 100e18);
        distributor.createGame(gameId, 100e18, address(rewardToken), participants);

        // Compute Shapley values — should succeed
        distributor.computeShapleyValues(gameId);

        // Verify settlement occurred
        (,,,, bool settled, ) = distributor.games(gameId);
        assertTrue(settled, "Game should be settled");

        // Verify Shapley values are assigned
        uint256 aliceShare = distributor.shapleyValues(gameId, alice);
        uint256 bobShare = distributor.shapleyValues(gameId, bob);
        assertGt(aliceShare, 0, "Alice should have a Shapley value");
        assertGt(bobShare, 0, "Bob should have a Shapley value");
        assertEq(aliceShare + bobShare, 100e18, "Shares should sum to total value");
    }

    // ============ Test 8: computeShapley reverts when ABC is unhealthy ============

    function test_computeShapley_revertsWhenABCUnhealthy() public {
        // Use a mock healthy ABC first so we can create the game
        MockHealthyABC healthyMock = new MockHealthyABC();
        distributor.sealBondingCurve(address(healthyMock));

        // Create game while healthy
        bytes32 gameId = keccak256("settle-unhealthy");
        ShapleyDistributor.Participant[] memory participants = _makeParticipants();
        rewardToken.mint(address(distributor), 100e18);
        distributor.createGame(gameId, 100e18, address(rewardToken), participants);

        // Now we need the ABC to become unhealthy for settlement.
        // Since bondingCurve is sealed and immutable, we use vm.mockCall to
        // simulate the ABC returning unhealthy on the next isHealthy() call.
        vm.mockCall(
            address(healthyMock),
            abi.encodeWithSelector(IABCHealthCheck.isHealthy.selector),
            abi.encode(false, uint256(700))
        );

        vm.expectRevert(abi.encodeWithSelector(ShapleyDistributor.ABCUnhealthy.selector, 700));
        distributor.computeShapleyValues(gameId);

        // Clear mock
        vm.clearMockedCalls();
    }

    // ============ Test 9: Pre-sealing, games work without ABC check ============

    function test_preSealing_noGate() public {
        // Do NOT seal the bonding curve — bondingCurveSealed is false
        assertFalse(distributor.bondingCurveSealed(), "Should not be sealed");

        // Create game — should work fine without any ABC check
        bytes32 gameId = keccak256("pre-seal-game");
        ShapleyDistributor.Participant[] memory participants = _makeParticipants();
        rewardToken.mint(address(distributor), 100e18);
        distributor.createGame(gameId, 100e18, address(rewardToken), participants);

        // Compute Shapley values — should also work without ABC check
        distributor.computeShapleyValues(gameId);

        (,,,, bool settled, ) = distributor.games(gameId);
        assertTrue(settled, "Game should be settled without ABC seal");
    }

    // ============ Test 10: ABCHealthGate event is emitted ============

    function test_ABCHealthGateEvent() public {
        // Seal with real healthy ABC
        distributor.sealBondingCurve(address(abc));

        bytes32 gameId = keccak256("event-test-game");
        ShapleyDistributor.Participant[] memory participants = _makeParticipants();
        rewardToken.mint(address(distributor), 100e18);

        // Expect ABCHealthGate event with healthy=true, driftBps=0
        vm.expectEmit(true, false, false, true);
        emit ABCHealthGate(gameId, true, 0);

        distributor.createGame(gameId, 100e18, address(rewardToken), participants);
    }
}
