// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/incentives/ShapleyDistributor.sol";
import "../../contracts/incentives/ISybilGuard.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/**
 * @notice Mock sybil guard: returns true for registered addresses.
 */
contract MockSybilGuard is ISybilGuard {
    mapping(address => bool) public verified;

    function setVerified(address addr, bool status) external {
        verified[addr] = status;
    }

    function isUniqueIdentity(address addr) external view override returns (bool) {
        return verified[addr];
    }
}

/**
 * @title Sybil Guard Test — Proves Lawson Floor sybil fix works
 * @notice Found by adversarial search: 200/200 rounds showed splitting into
 *         2 accounts doubles the floor subsidy. This test proves the fix:
 *         only verified identities get the floor boost.
 */
contract SybilGuardTest is Test {
    ShapleyDistributor public distributor;
    MockToken public rewardToken;
    MockSybilGuard public guard;

    address public owner;
    address public creator;

    uint256 constant PRECISION = 1e18;

    function setUp() public {
        owner = address(this);
        creator = makeAddr("creator");

        rewardToken = new MockToken("Reward", "RWD");
        guard = new MockSybilGuard();

        ShapleyDistributor impl = new ShapleyDistributor();
        bytes memory initData = abi.encodeWithSelector(
            ShapleyDistributor.initialize.selector,
            owner
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        distributor = ShapleyDistributor(payable(address(proxy)));

        distributor.setAuthorizedCreator(creator, true);
    }

    // ============ Without Sybil Guard (original behavior) ============

    function test_withoutGuard_sybilGetsDoubleFloor() public {
        // No guard set — original behavior

        uint256 totalValue = 100 * PRECISION;

        // Single honest account
        bytes32 gameId1 = keccak256("honest");
        rewardToken.mint(address(distributor), totalValue);

        address whale = makeAddr("whale");
        address honest = makeAddr("honest");

        ShapleyDistributor.Participant[] memory ps1 = new ShapleyDistributor.Participant[](2);
        ps1[0] = ShapleyDistributor.Participant(whale, 10000 * PRECISION, 365 days, 10000, 10000);
        ps1[1] = ShapleyDistributor.Participant(honest, 1 * PRECISION, 1 days, 100, 100);

        vm.prank(creator);
        distributor.createGame(gameId1, totalValue, address(rewardToken), ps1);
        distributor.computeShapleyValues(gameId1);

        uint256 honestShare = distributor.getShapleyValue(gameId1, honest);

        // Sybil: same person splits into 2 accounts
        bytes32 gameId2 = keccak256("sybil");
        rewardToken.mint(address(distributor), totalValue);

        address sybil1 = makeAddr("sybil1");
        address sybil2 = makeAddr("sybil2");

        ShapleyDistributor.Participant[] memory ps2 = new ShapleyDistributor.Participant[](3);
        ps2[0] = ShapleyDistributor.Participant(whale, 10000 * PRECISION, 365 days, 10000, 10000);
        ps2[1] = ShapleyDistributor.Participant(sybil1, 1 * PRECISION / 2, 1 days, 100, 100);
        ps2[2] = ShapleyDistributor.Participant(sybil2, 1 * PRECISION / 2, 1 days, 100, 100);

        vm.prank(creator);
        distributor.createGame(gameId2, totalValue, address(rewardToken), ps2);
        distributor.computeShapleyValues(gameId2);

        uint256 sybilTotal = distributor.getShapleyValue(gameId2, sybil1) +
                             distributor.getShapleyValue(gameId2, sybil2);

        // Without guard: sybil gets more than honest (exploiting floor)
        assertGt(sybilTotal, honestShare, "Without guard: sybil should profit from splitting");
    }

    // ============ With Sybil Guard (fixed behavior) ============

    function test_withGuard_unverifiedSybilNoFloor() public {
        // Enable guard
        distributor.setSybilGuard(address(guard));

        // Verify whale and honest, but NOT sybil accounts
        address whale = makeAddr("whale");
        address honest = makeAddr("honest");
        address sybil1 = makeAddr("sybil1");
        address sybil2 = makeAddr("sybil2");

        guard.setVerified(whale, true);
        guard.setVerified(honest, true);
        guard.setVerified(sybil1, false);  // Not verified
        guard.setVerified(sybil2, false);  // Not verified

        uint256 totalValue = 100 * PRECISION;

        // Honest game (with guard, honest IS verified)
        bytes32 gameId1 = keccak256("honest_guarded");
        rewardToken.mint(address(distributor), totalValue);

        ShapleyDistributor.Participant[] memory ps1 = new ShapleyDistributor.Participant[](2);
        ps1[0] = ShapleyDistributor.Participant(whale, 10000 * PRECISION, 365 days, 10000, 10000);
        ps1[1] = ShapleyDistributor.Participant(honest, 1 * PRECISION, 1 days, 100, 100);

        vm.prank(creator);
        distributor.createGame(gameId1, totalValue, address(rewardToken), ps1);
        distributor.computeShapleyValues(gameId1);

        uint256 honestShare = distributor.getShapleyValue(gameId1, honest);

        // Sybil game (with guard, sybil accounts NOT verified)
        bytes32 gameId2 = keccak256("sybil_guarded");
        rewardToken.mint(address(distributor), totalValue);

        ShapleyDistributor.Participant[] memory ps2 = new ShapleyDistributor.Participant[](3);
        ps2[0] = ShapleyDistributor.Participant(whale, 10000 * PRECISION, 365 days, 10000, 10000);
        ps2[1] = ShapleyDistributor.Participant(sybil1, 1 * PRECISION / 2, 1 days, 100, 100);
        ps2[2] = ShapleyDistributor.Participant(sybil2, 1 * PRECISION / 2, 1 days, 100, 100);

        vm.prank(creator);
        distributor.createGame(gameId2, totalValue, address(rewardToken), ps2);
        distributor.computeShapleyValues(gameId2);

        uint256 sybilTotal = distributor.getShapleyValue(gameId2, sybil1) +
                             distributor.getShapleyValue(gameId2, sybil2);

        // With guard: unverified sybil accounts DON'T get floor boost
        // They should get less than or equal to honest (no floor exploitation)
        assertLe(sybilTotal, honestShare, "With guard: sybil should NOT profit from splitting");
    }

    // ============ Conservation still holds with guard ============

    function test_withGuard_efficiencyPreserved() public {
        distributor.setSybilGuard(address(guard));

        address a = makeAddr("a");
        address b = makeAddr("b");
        address c = makeAddr("c");

        guard.setVerified(a, true);
        guard.setVerified(b, false);  // Unverified
        guard.setVerified(c, true);

        uint256 totalValue = 100 * PRECISION;
        bytes32 gameId = keccak256("efficiency_guard");
        rewardToken.mint(address(distributor), totalValue);

        ShapleyDistributor.Participant[] memory ps = new ShapleyDistributor.Participant[](3);
        ps[0] = ShapleyDistributor.Participant(a, 50 * PRECISION, 30 days, 7000, 7000);
        ps[1] = ShapleyDistributor.Participant(b, 1 * PRECISION,  1 days,  100,  100);
        ps[2] = ShapleyDistributor.Participant(c, 30 * PRECISION, 14 days, 5000, 5000);

        vm.prank(creator);
        distributor.createGame(gameId, totalValue, address(rewardToken), ps);
        distributor.computeShapleyValues(gameId);

        uint256 total = distributor.getShapleyValue(gameId, a) +
                        distributor.getShapleyValue(gameId, b) +
                        distributor.getShapleyValue(gameId, c);

        assertEq(total, totalValue, "Efficiency violated with sybil guard active");
    }
}
