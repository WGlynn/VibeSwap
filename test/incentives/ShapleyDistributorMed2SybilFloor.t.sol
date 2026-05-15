// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/incentives/ShapleyDistributor.sol";
import "../../contracts/incentives/ISybilGuard.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockTokenMed2 is ERC20 {
    constructor() ERC20("Mock", "MCK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// @dev MockSybilGuard with an allowlist. isUniqueIdentity returns true only for
///      addresses explicitly approved; default-false enables tests of the
///      "guard rejects participant" case.
contract MockSybilGuard is ISybilGuard {
    mapping(address => bool) public allowed;
    function approve(address a) external { allowed[a] = true; }
    function isUniqueIdentity(address a) external view returns (bool) {
        return allowed[a];
    }
}

/// @notice AA#2 MED-2 regression suite — fail-loud sybil gate on the Lawson Floor.
///
/// Behavior under test (post-fix, 2026-05-15):
///   1. floor-eligible participant + sybilGuard unset → revert SybilGuardRequiredForFloor
///   2. all participants above floor + sybilGuard unset → compute succeeds (no floor needed)
///   3. floor-eligible + sybilGuard set + participant verified → participant gets floor
///   4. floor-eligible + sybilGuard set + participant rejected → participant does NOT get floor
///   5. sum invariant preserved in every non-reverting case
///
/// Pre-fix vulnerability: sybilGuard unset → floor applied to any weight>0 → sybil split
/// (1 large LP → N tiny accounts, each captures 1% floor) was profitable
/// (200/200 adversarial-search rounds per recursive-self-improvement primitive).
contract ShapleyDistributorMed2SybilFloorTest is Test {
    ShapleyDistributor public distributor;
    MockTokenMed2 public token;
    MockSybilGuard public guard;

    address public owner;
    address public alice;
    address public bob;
    address public sybil1;
    address public sybil2;

    bytes32 public constant GAME_ID = keccak256("med2-test-game");
    uint256 public constant TOTAL_VALUE = 100 ether;

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        sybil1 = makeAddr("sybil1");
        sybil2 = makeAddr("sybil2");

        token = new MockTokenMed2();
        guard = new MockSybilGuard();

        ShapleyDistributor impl = new ShapleyDistributor();
        bytes memory initData = abi.encodeWithSelector(
            ShapleyDistributor.initialize.selector,
            owner
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        distributor = ShapleyDistributor(payable(address(proxy)));
        distributor.setAuthorizedCreator(owner, true);
    }

    /// @notice 1 large LP + N tiny sybil accounts (each below the 1% floor).
    function _buildSybilSet(uint8 sybilCount) internal view returns (
        ShapleyDistributor.Participant[] memory
    ) {
        ShapleyDistributor.Participant[] memory p =
            new ShapleyDistributor.Participant[](sybilCount + 1);

        p[0] = ShapleyDistributor.Participant({
            participant: alice,
            directContribution: 10000 ether,
            timeInPool: 365 days,
            scarcityScore: 9000,
            stabilityScore: 9000
        });

        for (uint8 i = 0; i < sybilCount; i++) {
            address s;
            if (i == 0) s = sybil1;
            else if (i == 1) s = sybil2;
            else s = address(uint160(uint256(keccak256(abi.encode("sybil", i)))));

            p[i + 1] = ShapleyDistributor.Participant({
                participant: s,
                directContribution: 1 ether,
                timeInPool: 1 days,
                scarcityScore: 100,
                stabilityScore: 100
            });
        }

        return p;
    }

    /// @notice Two balanced LPs — both above the 1% floor, neither floor-eligible.
    function _buildBalancedPair() internal view returns (
        ShapleyDistributor.Participant[] memory
    ) {
        ShapleyDistributor.Participant[] memory p =
            new ShapleyDistributor.Participant[](2);
        p[0] = ShapleyDistributor.Participant({
            participant: alice,
            directContribution: 100 ether,
            timeInPool: 30 days,
            scarcityScore: 5000,
            stabilityScore: 5000
        });
        p[1] = ShapleyDistributor.Participant({
            participant: bob,
            directContribution: 100 ether,
            timeInPool: 30 days,
            scarcityScore: 5000,
            stabilityScore: 5000
        });
        return p;
    }

    // --- Reverting cases -----------------------------------------------------

    /// @notice Floor-eligible participant + sybilGuard unset → revert.
    function test_revert_whenSybilGuardUnset_andFloorEligible() public {
        ShapleyDistributor.Participant[] memory p = _buildSybilSet(2);
        token.mint(address(distributor), TOTAL_VALUE);
        distributor.createGame(GAME_ID, TOTAL_VALUE, address(token), p);

        vm.expectRevert(ShapleyDistributor.SybilGuardRequiredForFloor.selector);
        distributor.computeShapleyValues(GAME_ID);
    }

    // --- Non-reverting cases -------------------------------------------------

    /// @notice All participants above floor + guard unset → compute succeeds (no floor needed).
    ///         Demonstrates the gate fires ONLY when the floor would actually apply.
    function test_noRevert_whenSybilGuardUnset_butNoFloorEligible() public {
        ShapleyDistributor.Participant[] memory p = _buildBalancedPair();
        token.mint(address(distributor), TOTAL_VALUE);
        distributor.createGame(GAME_ID, TOTAL_VALUE, address(token), p);
        distributor.computeShapleyValues(GAME_ID); // no revert

        uint256 aliceShare = distributor.shapleyValues(GAME_ID, alice);
        uint256 bobShare = distributor.shapleyValues(GAME_ID, bob);
        assertGt(aliceShare, 0, "alice gets a share");
        assertGt(bobShare, 0, "bob gets a share");
        assertEq(aliceShare + bobShare, TOTAL_VALUE, "sum invariant");
    }

    /// @notice Guard set, sybils not approved → sybils get sub-floor share, no revert.
    function test_floorNotApplied_whenGuardRejectsSybils() public {
        distributor.setSybilGuard(address(guard));
        // alice approved, sybils not
        guard.approve(alice);

        ShapleyDistributor.Participant[] memory p = _buildSybilSet(2);
        token.mint(address(distributor), TOTAL_VALUE);
        distributor.createGame(GAME_ID, TOTAL_VALUE, address(token), p);
        distributor.computeShapleyValues(GAME_ID);

        uint256 floorAmount = TOTAL_VALUE / 100;
        uint256 sybil1Share = distributor.shapleyValues(GAME_ID, sybil1);
        uint256 sybil2Share = distributor.shapleyValues(GAME_ID, sybil2);

        assertLt(sybil1Share, floorAmount, "sybil1 rejected by guard, no floor");
        assertLt(sybil2Share, floorAmount, "sybil2 rejected by guard, no floor");
        assertGt(sybil1Share, 0, "P-001: sybil still gets >0 proportional share");
    }

    /// @notice Guard set, two legit small LPs approved → both get floor.
    ///
    /// 3-participant layout: small LPs at indices 0,1 (both floor-eligible and
    /// verified); large alice at index 2 (dust-recipient, non-floor). This avoids
    /// the pre-existing HIGH-2 dust-recipient × axiom-5 interaction by ensuring
    /// the dust-recipient is the non-floor participant — keeping the inline
    /// axiom-5 enforcer's "shares[i] == floorAmount" skip intact.
    function test_floorApplied_whenGuardAcceptsLegitSmallLPs() public {
        distributor.setSybilGuard(address(guard));
        guard.approve(bob);
        guard.approve(sybil1); // legit small LP for this test

        ShapleyDistributor.Participant[] memory p =
            new ShapleyDistributor.Participant[](3);
        p[0] = ShapleyDistributor.Participant({
            participant: bob,
            directContribution: 1 ether,
            timeInPool: 30 days,
            scarcityScore: 5000,
            stabilityScore: 5000
        });
        p[1] = ShapleyDistributor.Participant({
            participant: sybil1,
            directContribution: 1 ether,
            timeInPool: 30 days,
            scarcityScore: 5000,
            stabilityScore: 5000
        });
        p[2] = ShapleyDistributor.Participant({
            participant: alice,
            directContribution: 1000 ether,
            timeInPool: 365 days,
            scarcityScore: 9000,
            stabilityScore: 9000
        });

        token.mint(address(distributor), TOTAL_VALUE);
        distributor.createGame(GAME_ID, TOTAL_VALUE, address(token), p);
        distributor.computeShapleyValues(GAME_ID);

        uint256 floorAmount = TOTAL_VALUE / 100;
        uint256 bobShare = distributor.shapleyValues(GAME_ID, bob);
        uint256 sybil1Share = distributor.shapleyValues(GAME_ID, sybil1);
        assertGe(bobShare, floorAmount, "verified small LP bob must receive floor");
        assertGe(sybil1Share, floorAmount, "verified small LP sybil1 must receive floor");
    }

    /// @notice Sum invariant: shares always sum to totalValue when compute succeeds.
    function test_sumInvariant_preserved_inAllNonRevertCases() public {
        // Case A: guard unset, no floor-eligible
        ShapleyDistributor.Participant[] memory pA = _buildBalancedPair();
        token.mint(address(distributor), TOTAL_VALUE);
        distributor.createGame(GAME_ID, TOTAL_VALUE, address(token), pA);
        distributor.computeShapleyValues(GAME_ID);
        assertEq(
            distributor.shapleyValues(GAME_ID, alice) +
            distributor.shapleyValues(GAME_ID, bob),
            TOTAL_VALUE,
            "sum: guard unset + balanced"
        );

        // Case B: guard set, sybils rejected, alice approved
        bytes32 gid2 = keccak256("med2-game-2");
        distributor.setSybilGuard(address(guard));
        guard.approve(alice);

        ShapleyDistributor.Participant[] memory pB = _buildSybilSet(2);
        token.mint(address(distributor), TOTAL_VALUE);
        distributor.createGame(gid2, TOTAL_VALUE, address(token), pB);
        distributor.computeShapleyValues(gid2);

        uint256 sumB = 0;
        for (uint256 i = 0; i < pB.length; i++) {
            sumB += distributor.shapleyValues(gid2, pB[i].participant);
        }
        assertEq(sumB, TOTAL_VALUE, "sum: guard set + sybils rejected");
    }
}
