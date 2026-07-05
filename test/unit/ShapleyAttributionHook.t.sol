// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/hooks/ShapleyAttributionHook.sol";

/**
 * @title ShapleyAttributionHookTest
 * @notice Verifies the axiom-verifier-as-router behaviour. The numbers are the worked
 *         example from the reward-divergence writeup: capital shares 50/30/12.5/7.5 (bps),
 *         with the weighted (non-additive) allocation that reorders them.
 */
contract ShapleyAttributionHookTest is Test {
    ShapleyAttributionHook hook;
    address attributor = address(0xA11CE);
    bytes32 constant POOL = keccak256("pool");
    uint8 constant FLAG_AFTER_SWAP = 32;

    function setUp() public {
        // routingTolerance = totalWeight = 10_000 (the neutral setting per PairwiseFairness).
        hook = new ShapleyAttributionHook(10_000, attributor);
    }

    function _weights() internal pure returns (uint256[] memory w) {
        w = new uint256[](4);
        w[0] = 5000; // whale
        w[1] = 3000; // mercenary
        w[2] = 1250; // steady
        w[3] = 750;  // bootstrapper
    }

    // Weighted (non-additive) allocation, README worked example x100. Sums to 10_000.
    function _nonAdditiveRewards() internal pure returns (uint256[] memory r) {
        r = new uint256[](4);
        r[0] = 3023;
        r[1] = 1909;
        r[2] = 2366;
        r[3] = 2702;
    }

    function test_HookFlags_AfterSwapOnly() public view {
        assertEq(hook.getHookFlags(), FLAG_AFTER_SWAP);
    }

    function test_AdditiveWorkUnit_SettlesOnChain() public {
        // Pro-rata rewards proportional to weights => every pair deviation 0 => fair => settle.
        uint256[] memory w = _weights();
        uint256[] memory r = new uint256[](4);
        r[0] = 5000;
        r[1] = 3000;
        r[2] = 1250;
        r[3] = 750;

        bytes32 sig = keccak256("wu-additive");
        (bool escalate,) = abi.decode(hook.afterSwap(POOL, abi.encode(sig, r, w)), (bool, uint256));

        assertFalse(escalate);
        assertTrue(hook.settledAdditive(sig));
        assertFalse(hook.isEscalated(sig));
    }

    function test_NonAdditiveWorkUnit_Escalates() public {
        uint256[] memory w = _weights();
        uint256[] memory r = _nonAdditiveRewards();

        bytes32 sig = keccak256("wu-nonadditive");
        (bool escalate, uint256 worstDeviation) =
            abi.decode(hook.afterSwap(POOL, abi.encode(sig, r, w)), (bool, uint256));

        assertTrue(escalate);
        assertGt(worstDeviation, 10_000); // deviation exceeds routingTolerance
        assertTrue(hook.isEscalated(sig));
        assertFalse(hook.settledAdditive(sig));
    }

    function test_previewRoute_DetectsNonAdditivity() public view {
        (bool escalate,,,) = hook.previewRoute(_nonAdditiveRewards(), _weights());
        assertTrue(escalate);
    }

    function test_SubmitExact_ConsumesEscalation() public {
        uint256[] memory w = _weights();
        bytes32 sig = keccak256("wu-exact");
        hook.afterSwap(POOL, abi.encode(sig, _nonAdditiveRewards(), w));
        assertTrue(hook.isEscalated(sig));

        // Exact allocation: efficient (sums to 10_000), NOT re-checked for proportionality.
        uint256[] memory ex = _nonAdditiveRewards();
        vm.prank(attributor);
        hook.submitExactAllocation(POOL, sig, ex, w, 10_000, 4);

        assertFalse(hook.isEscalated(sig));
        assertTrue(hook.resolvedExact(sig));
    }

    function test_SubmitExact_RevertsIfNotAttributor() public {
        uint256[] memory w = _weights();
        bytes32 sig = keccak256("wu-a");
        hook.afterSwap(POOL, abi.encode(sig, _nonAdditiveRewards(), w));

        vm.expectRevert(ShapleyAttributionHook.NotAttributor.selector);
        hook.submitExactAllocation(POOL, sig, _nonAdditiveRewards(), w, 10_000, 4);
    }

    function test_SubmitExact_RevertsIfInefficient() public {
        uint256[] memory w = _weights();
        bytes32 sig = keccak256("wu-b");
        hook.afterSwap(POOL, abi.encode(sig, _nonAdditiveRewards(), w));

        uint256[] memory bad = new uint256[](4); // sums to 4, not 10_000
        bad[0] = 1;
        bad[1] = 1;
        bad[2] = 1;
        bad[3] = 1;

        vm.prank(attributor);
        vm.expectRevert(ShapleyAttributionHook.ExactAllocationInefficient.selector);
        hook.submitExactAllocation(POOL, sig, bad, w, 10_000, 4);
    }

    function test_SubmitExact_RevertsIfNotEscalated() public {
        uint256[] memory w = _weights();
        vm.prank(attributor);
        vm.expectRevert(ShapleyAttributionHook.NotEscalated.selector);
        hook.submitExactAllocation(POOL, keccak256("never"), _nonAdditiveRewards(), w, 10_000, 4);
    }
}
