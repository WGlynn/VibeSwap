// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/incentives/ShapleyDistributor.sol";
import "../../contracts/incentives/ISybilGuard.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockTokenSIS is ERC20 {
    constructor() ERC20("Mock", "MCK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// @dev Allowlist guard: only explicitly-approved addresses are unique identities.
contract AllowlistGuardSIS is ISybilGuard {
    mapping(address => bool) public allowed;
    function approve(address a) external { allowed[a] = true; }
    function isUniqueIdentity(address a) external view returns (bool) { return allowed[a]; }
}

/// @notice Property suite for the capital-anchored behavior-multiplier weighting
///         (FIX 2026-07-06). Locks the two load-bearing mechanism properties as
///         EXECUTABLE tests, not comments:
///
///         G1 SCALE-INVARIANCE — multiplying every participant's capital by any
///            c > 0 leaves all shares unchanged (the reason the scale-invariant
///            weighting exists: the 40/30/20/10 split must not depend on units).
///
///         G2 SPLIT-NEUTRALITY — partitioning one participant's contribution
///            vector across N identities never increases the coalition's total
///            payout. In the proportional region the split is exactly
///            value-preserving (row-local weights: sum_j d_j * m == d * m); in
///            the sub-floor region the sybil guard gates the only upside, and
///            the residual is bounded by the Lawson floor policy itself
///            (<= floorAmount per VERIFIED identity — which is the floor's
///            documented purpose, not an exploit).
contract ShapleyScaleInvariantSybilTest is Test {
    ShapleyDistributor public distributor;
    MockTokenSIS public token;
    AllowlistGuardSIS public guard;

    uint256 public constant TOTAL_VALUE = 100 ether;

    function setUp() public {
        token = new MockTokenSIS();
        guard = new AllowlistGuardSIS();

        ShapleyDistributor impl = new ShapleyDistributor();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(ShapleyDistributor.initialize.selector, address(this))
        );
        distributor = ShapleyDistributor(payable(address(proxy)));
        distributor.setAuthorizedCreator(address(this), true);
    }

    function _settle(bytes32 gid, ShapleyDistributor.Participant[] memory ps) internal {
        token.mint(address(distributor), TOTAL_VALUE);
        distributor.createGame(gid, TOTAL_VALUE, address(token), ps);
        distributor.computeShapleyValues(gid);
    }

    // ============ G1: Scale-Invariance ============

    /// @notice Multiplying every participant's directContribution by c leaves every
    ///         share BIT-IDENTICAL. Exact because w = d * m / PRECISION is integer-
    ///         exact for ether-multiple d (d divisible by PRECISION), so w(c) = c*w
    ///         and all pro-rata ratios are equal rationals. Heterogeneous behavior
    ///         scores make the property non-trivial (m differs per row).
    function testFuzz_scaleInvariance_capitalUnits(uint256 c) public {
        c = bound(c, 2, 1e12);

        address a1 = makeAddr("a1"); address b1 = makeAddr("b1");
        address a2 = makeAddr("a2"); address b2 = makeAddr("b2");

        ShapleyDistributor.Participant[] memory p1 = new ShapleyDistributor.Participant[](2);
        p1[0] = ShapleyDistributor.Participant(a1, 100 ether, 365 days, 9000, 8000);
        p1[1] = ShapleyDistributor.Participant(b1, 37 ether, 30 days, 4000, 2000);

        ShapleyDistributor.Participant[] memory p2 = new ShapleyDistributor.Participant[](2);
        p2[0] = ShapleyDistributor.Participant(a2, 100 ether * c, 365 days, 9000, 8000);
        p2[1] = ShapleyDistributor.Participant(b2, 37 ether * c, 30 days, 4000, 2000);

        _settle(keccak256(abi.encode("g1-base", c)), p1);
        _settle(keccak256(abi.encode("g1-scaled", c)), p2);

        assertEq(
            distributor.shapleyValues(keccak256(abi.encode("g1-base", c)), a1),
            distributor.shapleyValues(keccak256(abi.encode("g1-scaled", c)), a2),
            "scale variance: capital units changed the whale's share"
        );
        assertEq(
            distributor.shapleyValues(keccak256(abi.encode("g1-base", c)), b1),
            distributor.shapleyValues(keccak256(abi.encode("g1-scaled", c)), b2),
            "scale variance: capital units changed the minor LP's share"
        );
    }

    // ============ G2: Split-Neutrality (proportional region) ============

    /// @notice Splitting an above-floor identity into 4 identities with replicated
    ///         behavior scores is exactly value-preserving: sum_j d_j * m == d * m,
    ///         and no other row's weight moves (row-local weighting has no
    ///         denominator an attacker can inflate). Tolerance covers per-share
    ///         integer flooring + dust absorption only.
    function test_splitNeutrality_proportionalRegion() public {
        address alice = makeAddr("alice");
        address bob = makeAddr("bob");

        ShapleyDistributor.Participant[] memory whole = new ShapleyDistributor.Participant[](2);
        whole[0] = ShapleyDistributor.Participant(alice, 100 ether, 365 days, 9000, 9000);
        whole[1] = ShapleyDistributor.Participant(bob, 50 ether, 30 days, 5000, 5000);
        _settle(keccak256("g2-whole"), whole);
        uint256 wholeShare = distributor.shapleyValues(keccak256("g2-whole"), bob);

        ShapleyDistributor.Participant[] memory split = new ShapleyDistributor.Participant[](5);
        split[0] = whole[0];
        for (uint256 i = 0; i < 4; i++) {
            address s = address(uint160(uint256(keccak256(abi.encode("split", i)))));
            split[i + 1] = ShapleyDistributor.Participant(s, 12.5 ether, 30 days, 5000, 5000);
        }
        _settle(keccak256("g2-split"), split);

        uint256 splitTotal;
        for (uint256 i = 1; i < 5; i++) {
            splitTotal += distributor.shapleyValues(keccak256("g2-split"), split[i].participant);
        }

        assertLe(splitTotal, wholeShare + 5, "splitting must not be profitable");
        assertApproxEqAbs(splitTotal, wholeShare, 5, "replicated split should be value-preserving");
    }

    /// @notice Fuzz: any partition of a target's capital across N sybil identities
    ///         (replicated behavior scores — the attacker's best case), with the
    ///         guard rejecting the splits, earns the coalition no more than the
    ///         unsplit identity in the same (rejected) trust state. Isolates the
    ///         weight-level property from the floor policy.
    function testFuzz_splitNeutrality_totalShareNonIncreasing(
        uint256 whaleD,
        uint256 targetD,
        uint256 nSplit
    ) public {
        whaleD = bound(whaleD, 100 ether, 1e9 ether);
        targetD = bound(targetD, 1 ether, whaleD / 10);
        nSplit = bound(nSplit, 2, 5);

        address whale = makeAddr("whale");
        address target = makeAddr("target");
        distributor.setSybilGuard(address(guard));
        guard.approve(whale); // only the whale is a verified identity

        ShapleyDistributor.Participant[] memory whole = new ShapleyDistributor.Participant[](2);
        whole[0] = ShapleyDistributor.Participant(whale, whaleD, 365 days, 9000, 9000);
        whole[1] = ShapleyDistributor.Participant(target, targetD, 30 days, 7000, 6000);
        bytes32 gidW = keccak256(abi.encode("g2f-whole", whaleD, targetD, nSplit));
        _settle(gidW, whole);
        uint256 wholeShare = distributor.shapleyValues(gidW, target);

        ShapleyDistributor.Participant[] memory split =
            new ShapleyDistributor.Participant[](nSplit + 1);
        split[0] = whole[0];
        uint256 each = targetD / nSplit;
        for (uint256 i = 0; i < nSplit; i++) {
            uint256 di = i == nSplit - 1 ? targetD - each * (nSplit - 1) : each;
            address s = address(uint160(uint256(keccak256(abi.encode("sfuzz", i)))));
            split[i + 1] = ShapleyDistributor.Participant(s, di, 30 days, 7000, 6000);
        }
        bytes32 gidS = keccak256(abi.encode("g2f-split", whaleD, targetD, nSplit));
        _settle(gidS, split);

        uint256 splitTotal;
        for (uint256 i = 1; i <= nSplit; i++) {
            splitTotal += distributor.shapleyValues(gidS, split[i].participant);
        }

        assertLe(splitTotal, wholeShare + nSplit + 1, "identity split must not be profitable");
    }

    // ============ G2: Split-Neutrality (floor region) ============

    /// @notice Sub-floor dust split with the guard rejecting the split identities:
    ///         the coalition keeps only its exactly-partitioned proportional crumbs.
    ///         The MED-2 gate (guard gates the FLOOR) is again the complete defense
    ///         because sub-floor is the only region with lift upside.
    function test_splitNotProfitable_subFloorWithGuard() public {
        address whale = makeAddr("whale");
        address dust = makeAddr("dust");
        distributor.setSybilGuard(address(guard));
        guard.approve(whale);

        ShapleyDistributor.Participant[] memory whole = new ShapleyDistributor.Participant[](2);
        whole[0] = ShapleyDistributor.Participant(whale, 10000 ether, 365 days, 9000, 9000);
        whole[1] = ShapleyDistributor.Participant(dust, 1 ether, 1 days, 100, 100);
        _settle(keccak256("g2fl-whole"), whole);
        uint256 wholeShare = distributor.shapleyValues(keccak256("g2fl-whole"), dust);

        ShapleyDistributor.Participant[] memory split = new ShapleyDistributor.Participant[](3);
        split[0] = whole[0];
        split[1] = ShapleyDistributor.Participant(makeAddr("d1"), 0.5 ether, 1 days, 100, 100);
        split[2] = ShapleyDistributor.Participant(makeAddr("d2"), 0.5 ether, 1 days, 100, 100);
        _settle(keccak256("g2fl-split"), split);

        uint256 splitTotal = distributor.shapleyValues(keccak256("g2fl-split"), split[1].participant)
            + distributor.shapleyValues(keccak256("g2fl-split"), split[2].participant);

        assertLe(splitTotal, wholeShare + 2, "sub-floor sybil split must not be profitable");
        assertLt(splitTotal, TOTAL_VALUE / 100, "rejected sybils stay below the floor");
    }

    /// @notice Floor-policy residual, LOCKED as a bound: an attacker who keeps ONE
    ///         verified identity and splits the rest earns at most the unsplit
    ///         verified payout + strictly less than one floorAmount (their own
    ///         sub-floor proportional crumbs). Floor spend remains bounded by
    ///         floorAmount x verified-identity-count — the Lawson floor's designed
    ///         budget, unreachable for unverified sybils.
    function test_splitFloorHarvest_boundedByFloorPolicy() public {
        address whale = makeAddr("whale");
        address v = makeAddr("verifiedOne");
        distributor.setSybilGuard(address(guard));
        guard.approve(whale);
        guard.approve(v);

        // Unsplit + verified: lifted to exactly the floor.
        ShapleyDistributor.Participant[] memory whole = new ShapleyDistributor.Participant[](2);
        whole[0] = ShapleyDistributor.Participant(whale, 10000 ether, 365 days, 9000, 9000);
        whole[1] = ShapleyDistributor.Participant(v, 1 ether, 1 days, 100, 100);
        _settle(keccak256("g2fp-whole"), whole);
        uint256 wholeTotal = distributor.shapleyValues(keccak256("g2fp-whole"), v);

        // Split: one verified identity + 3 rejected splits carrying most capital.
        ShapleyDistributor.Participant[] memory split = new ShapleyDistributor.Participant[](5);
        split[0] = whole[0];
        split[1] = ShapleyDistributor.Participant(v, 0.25 ether, 1 days, 100, 100);
        for (uint256 i = 0; i < 3; i++) {
            address s = address(uint160(uint256(keccak256(abi.encode("fp", i)))));
            split[i + 2] = ShapleyDistributor.Participant(s, 0.25 ether, 1 days, 100, 100);
        }
        _settle(keccak256("g2fp-split"), split);

        uint256 splitTotal;
        for (uint256 i = 1; i < 5; i++) {
            splitTotal += distributor.shapleyValues(keccak256("g2fp-split"), split[i].participant);
        }

        uint256 floorAmount = TOTAL_VALUE / 100;
        assertLe(
            splitTotal,
            wholeTotal + floorAmount,
            "split residual must stay within one floorAmount per verified identity"
        );
        assertLe(splitTotal, 2 * floorAmount, "coalition cannot harvest beyond the floor budget");
    }

    // ============ Null player: behavior without capital earns zero ============

    /// @notice Zero capital + maxed behavior scores = null player. This is the
    ///         semantic that makes the behavior dimensions impossible to farm for
    ///         free (and matches SIEShapleyAdapter's zero-direct = null-player
    ///         intent). Settles with the guard unset: weight 0 is not floor-eligible.
    function test_nullPlayer_zeroCapitalMaxBehavior_earnsZero() public {
        address lp = makeAddr("lp");
        address ghost = makeAddr("ghost");

        ShapleyDistributor.Participant[] memory p = new ShapleyDistributor.Participant[](2);
        p[0] = ShapleyDistributor.Participant(lp, 100 ether, 30 days, 5000, 5000);
        p[1] = ShapleyDistributor.Participant(ghost, 0, 365 days, 10000, 10000);
        _settle(keccak256("null-player"), p);

        assertEq(
            distributor.shapleyValues(keccak256("null-player"), ghost),
            0,
            "behavior with no capital at risk must earn zero"
        );
        assertEq(
            distributor.shapleyValues(keccak256("null-player"), lp),
            TOTAL_VALUE,
            "sole capital provider takes the full pot"
        );
    }

    // ============ Behavior multiplier bound: the honest 40/30/20/10 semantic ============

    /// @notice Among equal-capital LPs, maxed behavior out-earns zero behavior by
    ///         EXACTLY 2.5x (m in [0.40, 1.00]): the 40/30/20/10 split decomposes
    ///         the effective-capital multiplier. Locks the rescoped semantic so a
    ///         future edit silently reverting to per-identity dimension budgets
    ///         (the sybil mint) fails this test.
    function test_behaviorEdge_cappedAt2_5x() public {
        address maxB = makeAddr("maxBehavior");
        address minB = makeAddr("minBehavior");

        ShapleyDistributor.Participant[] memory p = new ShapleyDistributor.Participant[](2);
        p[0] = ShapleyDistributor.Participant(maxB, 50 ether, 3650 days, 10000, 10000);
        p[1] = ShapleyDistributor.Participant(minB, 50 ether, 0, 0, 0);
        _settle(keccak256("behavior-edge"), p);

        uint256 hi = distributor.shapleyValues(keccak256("behavior-edge"), maxB);
        uint256 lo = distributor.shapleyValues(keccak256("behavior-edge"), minB);

        // m_hi = 10000e18 (time capped at PRECISION), m_lo = 4000e18 -> exactly 2.5x.
        assertApproxEqAbs(hi, (lo * 5) / 2, 5, "behavior edge must be exactly 2.5x at the extremes");
        assertLe(hi, (lo * 5) / 2 + 5, "behavior edge must never exceed 2.5x");
    }
}
