// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/libraries/SecurityLib.sol";

/**
 * @title SecurityLibHarness
 * @notice Thin wrapper so tests can call SecurityLib functions via an external call,
 *         which is required for vm.expectRevert to work (the revert must happen at a
 *         lower call depth than the cheatcode call depth).
 */
contract SecurityLibHarness {
    // ---- view functions (need block.timestamp / extcodesize context) ----

    function checkRateLimit(
        SecurityLib.RateLimit memory limit,
        uint256 amount
    ) external view returns (bool allowed, uint256 newUsed) {
        return SecurityLib.checkRateLimit(limit, amount);
    }

    function requireNotExpired(uint256 deadline) external view {
        SecurityLib.requireNotExpired(deadline);
    }

    function isContract(address addr) external view returns (bool) {
        return SecurityLib.isContract(addr);
    }

    // ---- pure functions wrapped for vm.expectRevert compatibility ----

    function requirePriceInRange(
        uint256 currentPrice,
        uint256 referencePrice,
        uint256 maxDeviationBps
    ) external pure {
        SecurityLib.requirePriceInRange(currentPrice, referencePrice, maxDeviationBps);
    }

    function requireSlippageInBounds(
        uint256 expectedAmount,
        uint256 actualAmount,
        uint256 maxSlippageBps
    ) external pure {
        SecurityLib.requireSlippageInBounds(expectedAmount, actualAmount, maxSlippageBps);
    }

    function mulDiv(uint256 x, uint256 y, uint256 denominator) external pure returns (uint256) {
        return SecurityLib.mulDiv(x, y, denominator);
    }

    function divDown(uint256 a, uint256 b) external pure returns (uint256) {
        return SecurityLib.divDown(a, b);
    }

    function divUp(uint256 a, uint256 b) external pure returns (uint256) {
        return SecurityLib.divUp(a, b);
    }

    function requireValidBps(uint256 bps) external pure {
        SecurityLib.requireValidBps(bps);
    }

    function requireInRange(uint256 value, uint256 min, uint256 max) external pure {
        SecurityLib.requireInRange(value, min, max);
    }

    function requireNonZeroAddress(address addr) external pure {
        SecurityLib.requireNonZeroAddress(addr);
    }

    function recoverSigner(
        bytes32 hash,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external pure returns (address) {
        return SecurityLib.recoverSigner(hash, v, r, s);
    }
}

/**
 * @title SecurityLibTest
 * @notice Unit tests for SecurityLib — price deviation, slippage, rate limits,
 *         mulDiv, address validation, signature recovery, and more.
 */
contract SecurityLibTest is Test {
    SecurityLibHarness harness;

    function setUp() public {
        harness = new SecurityLibHarness();
    }

    // ============ checkPriceDeviation ============

    function test_priceDeviation_withinBounds() public pure {
        // 1% deviation, max 200 bps (2%)
        assertTrue(SecurityLib.checkPriceDeviation(1010e18, 1000e18, 200));
    }

    function test_priceDeviation_exactBoundary() public pure {
        // exactly 200 bps above
        assertTrue(SecurityLib.checkPriceDeviation(1020e18, 1000e18, 200));
    }

    function test_priceDeviation_exceedsBound() public pure {
        // 300 bps above, max 200 bps
        assertFalse(SecurityLib.checkPriceDeviation(1030e18, 1000e18, 200));
    }

    function test_priceDeviation_belowReference() public pure {
        // 100 bps below
        assertTrue(SecurityLib.checkPriceDeviation(990e18, 1000e18, 200));
        assertFalse(SecurityLib.checkPriceDeviation(970e18, 1000e18, 200));
    }

    function test_priceDeviation_zeroReference_alwaysTrue() public pure {
        // Zero reference → no check, returns true
        assertTrue(SecurityLib.checkPriceDeviation(1000e18, 0, 0));
        assertTrue(SecurityLib.checkPriceDeviation(0, 0, 0));
    }

    function test_priceDeviation_equalPrices() public pure {
        assertTrue(SecurityLib.checkPriceDeviation(1000e18, 1000e18, 0));
    }

    function test_requirePriceInRange_reverts() public {
        vm.expectRevert("Price deviation too high");
        harness.requirePriceInRange(1500e18, 1000e18, 200); // 50% deviation, max 2%
    }

    function testFuzz_priceDeviation_symmetric(
        uint128 basePrice,
        uint128 delta,
        uint128 maxBps
    ) public pure {
        vm.assume(basePrice > 0);
        vm.assume(delta <= basePrice); // avoid underflow on subtract
        vm.assume(uint256(basePrice) + delta < type(uint128).max);

        bool above = SecurityLib.checkPriceDeviation(basePrice + delta, basePrice, maxBps);
        bool below = SecurityLib.checkPriceDeviation(basePrice - delta, basePrice, maxBps);
        // Deviation is symmetric — both must agree
        assertEq(above, below);
    }

    // ============ checkBalanceConsistency ============

    function test_balanceConsistency_bothZero() public pure {
        assertTrue(SecurityLib.checkBalanceConsistency(0, 0, 100));
    }

    function test_balanceConsistency_trackedZeroActualNonZero() public pure {
        // Unexpected tokens appeared when tracked=0
        assertFalse(SecurityLib.checkBalanceConsistency(0, 100, 100));
    }

    function test_balanceConsistency_missingTokens() public pure {
        // actual < tracked → always invalid
        assertFalse(SecurityLib.checkBalanceConsistency(1000, 999, 100));
    }

    function test_balanceConsistency_exactMatch() public pure {
        assertTrue(SecurityLib.checkBalanceConsistency(1000, 1000, 0));
    }

    function test_balanceConsistency_smallExcess_withinDelta() public pure {
        // 1% excess, max 200 bps
        assertTrue(SecurityLib.checkBalanceConsistency(10000, 10100, 200));
    }

    function test_balanceConsistency_largeExcess_exceedsDelta() public pure {
        // 5% excess, max 200 bps
        assertFalse(SecurityLib.checkBalanceConsistency(10000, 10500, 200));
    }

    // ============ checkSlippage ============

    function test_slippage_betterThanExpected() public pure {
        // actual > expected → always valid
        assertTrue(SecurityLib.checkSlippage(1000, 1100, 50));
    }

    function test_slippage_exactExpected() public pure {
        assertTrue(SecurityLib.checkSlippage(1000, 1000, 0));
    }

    function test_slippage_withinBound() public pure {
        // 1% slippage, max 200 bps
        assertTrue(SecurityLib.checkSlippage(1000, 990, 200));
    }

    function test_slippage_exceedsBound() public pure {
        // 3% slippage, max 200 bps
        assertFalse(SecurityLib.checkSlippage(1000, 970, 200));
    }

    function test_slippage_zeroExpected_zeroActual() public pure {
        assertTrue(SecurityLib.checkSlippage(0, 0, 100));
    }

    function test_slippage_zeroExpected_nonzeroActual() public pure {
        // 0 expected but got something — shouldn't happen normally, but logic says true
        // checkSlippage: if expectedAmount == 0 return actualAmount == 0 → false here
        assertFalse(SecurityLib.checkSlippage(0, 1, 100));
    }

    function test_requireSlippageInBounds_reverts() public {
        vm.expectRevert("Slippage too high");
        harness.requireSlippageInBounds(1000, 900, 50); // 10% slip, max 0.5%
    }

    // ============ checkRateLimit ============

    function test_rateLimit_newWindow_withinMax() public {
        vm.warp(1000);
        SecurityLib.RateLimit memory limit = SecurityLib.RateLimit({
            windowStart: 0,
            windowDuration: 1 hours,
            maxAmount: 1000,
            usedAmount: 0
        });
        (bool allowed, uint256 newUsed) = harness.checkRateLimit(limit, 500);
        assertTrue(allowed);
        assertEq(newUsed, 500);
    }

    function test_rateLimit_newWindow_exceedsMax() public {
        vm.warp(1000);
        SecurityLib.RateLimit memory limit = SecurityLib.RateLimit({
            windowStart: 0,
            windowDuration: 1 hours,
            maxAmount: 1000,
            usedAmount: 0
        });
        (bool allowed,) = harness.checkRateLimit(limit, 1001);
        assertFalse(allowed);
    }

    function test_rateLimit_sameWindow_accumulates() public {
        uint256 now_ = 1_000_000;
        vm.warp(now_);
        SecurityLib.RateLimit memory limit = SecurityLib.RateLimit({
            windowStart: now_,
            windowDuration: 1 hours,
            maxAmount: 1000,
            usedAmount: 600
        });
        (bool allowed, uint256 newUsed) = harness.checkRateLimit(limit, 400);
        assertTrue(allowed);
        assertEq(newUsed, 1000);

        // One more would exceed
        (bool tooMuch,) = harness.checkRateLimit(limit, 401);
        assertFalse(tooMuch);
    }

    function test_rateLimit_expiredWindow_resets() public {
        uint256 now_ = 1_000_000;
        vm.warp(now_);
        SecurityLib.RateLimit memory limit = SecurityLib.RateLimit({
            windowStart: now_ - 2 hours,  // window expired
            windowDuration: 1 hours,
            maxAmount: 1000,
            usedAmount: 999  // was nearly full
        });
        (bool allowed, uint256 newUsed) = harness.checkRateLimit(limit, 500);
        // New window → reset, 500 <= 1000
        assertTrue(allowed);
        assertEq(newUsed, 500);
    }

    // ============ requireNotExpired ============

    function test_requireNotExpired_valid() public {
        vm.warp(1000);
        harness.requireNotExpired(1001); // deadline in future
    }

    function test_requireNotExpired_atDeadline() public {
        vm.warp(1000);
        harness.requireNotExpired(1000); // deadline == now is valid
    }

    function test_requireNotExpired_expired() public {
        vm.warp(1001);
        vm.expectRevert("Transaction expired");
        harness.requireNotExpired(1000);
    }

    // ============ mulDiv ============

    function test_mulDiv_basic() public pure {
        assertEq(SecurityLib.mulDiv(100, 3, 4), 75);
    }

    function test_mulDiv_exactDivision() public pure {
        assertEq(SecurityLib.mulDiv(120, 5, 6), 100);
    }

    function test_mulDiv_large_noOverflow() public pure {
        // (2^128 - 1)^2 / 2^128 — large product that fits via mulDiv
        uint256 x = type(uint128).max;
        uint256 y = type(uint128).max;
        uint256 d = uint256(type(uint128).max) + 1; // 2^128, must cast to uint256 before adding
        uint256 result = SecurityLib.mulDiv(x, y, d);
        // (2^128-1)^2 / 2^128 = 2^128 - 2 = type(uint128).max - 1
        assertEq(result, uint256(type(uint128).max) - 1);
    }

    function test_mulDiv_revertsOnZeroDenominator() public {
        vm.expectRevert("Division by zero");
        harness.mulDiv(100, 100, 0);
    }

    function test_mulDiv_revertsOnOverflow() public {
        // Result cannot fit in uint256 — mulDiv reverts with arithmetic panic (0x11)
        // when the intermediate computation overflows. Use bytes(0) to match any revert.
        vm.expectRevert();
        harness.mulDiv(type(uint256).max, 2, 3);
    }

    function testFuzz_mulDiv_matchesSimple(uint64 x, uint64 y, uint64 d) public pure {
        vm.assume(d > 0);
        uint256 result = SecurityLib.mulDiv(x, y, d);
        uint256 expected = (uint256(x) * uint256(y)) / uint256(d);
        assertEq(result, expected);
    }

    // ============ divDown / divUp ============

    function test_divDown_exact() public pure {
        assertEq(SecurityLib.divDown(100, 5), 20);
    }

    function test_divDown_truncates() public pure {
        assertEq(SecurityLib.divDown(101, 5), 20);
    }

    function test_divDown_revertsOnZero() public {
        vm.expectRevert("Division by zero");
        harness.divDown(1, 0);
    }

    function test_divUp_exact() public pure {
        assertEq(SecurityLib.divUp(100, 5), 20);
    }

    function test_divUp_roundsUp() public pure {
        assertEq(SecurityLib.divUp(101, 5), 21);
        assertEq(SecurityLib.divUp(1, 5), 1);
    }

    function test_divUp_zero() public pure {
        assertEq(SecurityLib.divUp(0, 5), 0);
    }

    function test_divUp_revertsOnZero() public {
        vm.expectRevert("Division by zero");
        harness.divUp(1, 0);
    }

    function testFuzz_divUp_greaterOrEqualDivDown(uint128 a, uint64 b) public pure {
        vm.assume(b > 0);
        assertGe(SecurityLib.divUp(a, b), SecurityLib.divDown(a, b));
    }

    // ============ requireValidBps ============

    function test_requireValidBps_valid() public pure {
        SecurityLib.requireValidBps(0);
        SecurityLib.requireValidBps(5000);
        SecurityLib.requireValidBps(10000);
    }

    function test_requireValidBps_reverts() public {
        vm.expectRevert("Invalid BPS");
        harness.requireValidBps(10001);
    }

    // ============ requireInRange ============

    function test_requireInRange_valid() public pure {
        SecurityLib.requireInRange(50, 0, 100);
        SecurityLib.requireInRange(0, 0, 100);
        SecurityLib.requireInRange(100, 0, 100);
    }

    function test_requireInRange_tooLow() public {
        vm.expectRevert("Value out of range");
        harness.requireInRange(0, 1, 100);
    }

    function test_requireInRange_tooHigh() public {
        vm.expectRevert("Value out of range");
        harness.requireInRange(101, 0, 100);
    }

    // ============ bpsOf ============

    function test_bpsOf_basic() public pure {
        // 1% of 10000 = 100
        assertEq(SecurityLib.bpsOf(10000, 100), 100);
        // 50% of 1000 = 500
        assertEq(SecurityLib.bpsOf(1000, 5000), 500);
        // 100% of anything
        assertEq(SecurityLib.bpsOf(777, 10000), 777);
    }

    function test_bpsOf_zero() public pure {
        assertEq(SecurityLib.bpsOf(0, 5000), 0);
        assertEq(SecurityLib.bpsOf(1000, 0), 0);
    }

    // ============ requireNonZeroAddress ============

    function test_requireNonZeroAddress_valid() public pure {
        SecurityLib.requireNonZeroAddress(address(0x1));
    }

    function test_requireNonZeroAddress_reverts() public {
        vm.expectRevert("Zero address");
        harness.requireNonZeroAddress(address(0));
    }

    // ============ isContract ============

    function test_isContract_contractAddress() public {
        // The harness itself is a contract
        assertTrue(harness.isContract(address(harness)));
    }

    function test_isContract_EOA() public {
        address eoa = address(0xBEEF);
        assertFalse(harness.isContract(eoa));
    }

    // ============ toTypedDataHash ============

    function test_toTypedDataHash_knownOutput() public pure {
        bytes32 domain = keccak256("domain");
        bytes32 structH = keccak256("struct");
        bytes32 result = SecurityLib.toTypedDataHash(domain, structH);
        bytes32 expected = keccak256(abi.encodePacked("\x19\x01", domain, structH));
        assertEq(result, expected);
    }

    function testFuzz_toTypedDataHash_uniqueForDifferentInputs(
        bytes32 d1,
        bytes32 d2,
        bytes32 s1,
        bytes32 s2
    ) public pure {
        vm.assume(d1 != d2 || s1 != s2);
        bytes32 h1 = SecurityLib.toTypedDataHash(d1, s1);
        bytes32 h2 = SecurityLib.toTypedDataHash(d2, s2);
        assertTrue(h1 != h2);
    }

    // ============ interactionKey ============

    function test_interactionKey_deterministicAndUnique() public pure {
        address user = address(0xABCD);
        bytes32 poolId = keccak256("pool1");

        bytes32 k1 = SecurityLib.interactionKey(user, poolId, 100);
        bytes32 k2 = SecurityLib.interactionKey(user, poolId, 100);
        bytes32 k3 = SecurityLib.interactionKey(user, poolId, 101); // different block

        assertEq(k1, k2);
        assertNotEq(k1, k3);
    }

    function testFuzz_interactionKey_uniquePerBlock(
        address user,
        bytes32 poolId,
        uint256 block1,
        uint256 block2
    ) public pure {
        vm.assume(block1 != block2);
        bytes32 k1 = SecurityLib.interactionKey(user, poolId, block1);
        bytes32 k2 = SecurityLib.interactionKey(user, poolId, block2);
        assertNotEq(k1, k2);
    }

    // ============ recoverSigner ============

    function test_recoverSigner_validSignature() public pure {
        // Sign a known hash with a known private key
        uint256 privKey = 0xA11CE;
        address expectedSigner = vm.addr(privKey);
        bytes32 hash = keccak256("test message");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privKey, hash);

        address recovered = SecurityLib.recoverSigner(hash, v, r, s);
        assertEq(recovered, expectedSigner);
    }

    function test_recoverSigner_revertsOnBadV() public {
        bytes32 hash = keccak256("msg");
        vm.expectRevert("Invalid signature v value");
        harness.recoverSigner(hash, 26, bytes32(0), bytes32(0));
    }

    function test_recoverSigner_revertsOnHighS() public {
        bytes32 hash = keccak256("msg");
        // s value above the limit
        bytes32 highS = bytes32(uint256(0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A1));
        vm.expectRevert("Invalid signature s value");
        harness.recoverSigner(hash, 27, bytes32(0), highS);
    }
}
