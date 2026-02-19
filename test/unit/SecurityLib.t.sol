// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/libraries/SecurityLib.sol";

// Wrapper to expose library functions (internal → external)
contract SecurityLibWrapper {
    function detectFlashLoan() external view returns (bool) {
        return SecurityLib.detectFlashLoan();
    }

    function requireNoFlashLoan(bool allowFlashLoans) external view {
        SecurityLib.requireNoFlashLoan(allowFlashLoans);
    }

    function checkPriceDeviation(uint256 current, uint256 ref_, uint256 maxBps)
        external pure returns (bool)
    {
        return SecurityLib.checkPriceDeviation(current, ref_, maxBps);
    }

    function requirePriceInRange(uint256 current, uint256 ref_, uint256 maxBps) external pure {
        SecurityLib.requirePriceInRange(current, ref_, maxBps);
    }

    function checkBalanceConsistency(uint256 tracked, uint256 actual, uint256 maxDeltaBps)
        external pure returns (bool)
    {
        return SecurityLib.checkBalanceConsistency(tracked, actual, maxDeltaBps);
    }

    function checkSlippage(uint256 expected, uint256 actual, uint256 maxSlippageBps)
        external pure returns (bool)
    {
        return SecurityLib.checkSlippage(expected, actual, maxSlippageBps);
    }

    function requireSlippageInBounds(uint256 expected, uint256 actual, uint256 maxSlippageBps)
        external pure
    {
        SecurityLib.requireSlippageInBounds(expected, actual, maxSlippageBps);
    }

    function checkRateLimit(SecurityLib.RateLimit memory limit, uint256 amount)
        external view returns (bool, uint256)
    {
        return SecurityLib.checkRateLimit(limit, amount);
    }

    function requireNotExpired(uint256 deadline) external view {
        SecurityLib.requireNotExpired(deadline);
    }

    function mulDiv(uint256 x, uint256 y, uint256 d) external pure returns (uint256) {
        return SecurityLib.mulDiv(x, y, d);
    }

    function divDown(uint256 a, uint256 b) external pure returns (uint256) {
        return SecurityLib.divDown(a, b);
    }

    function divUp(uint256 a, uint256 b) external pure returns (uint256) {
        return SecurityLib.divUp(a, b);
    }

    function requireNonZeroAddress(address addr) external pure {
        SecurityLib.requireNonZeroAddress(addr);
    }

    function isContract(address addr) external view returns (bool) {
        return SecurityLib.isContract(addr);
    }

    function requireValidBps(uint256 bps) external pure {
        SecurityLib.requireValidBps(bps);
    }

    function requireInRange(uint256 value, uint256 min, uint256 max) external pure {
        SecurityLib.requireInRange(value, min, max);
    }

    function bpsOf(uint256 amount, uint256 bps) external pure returns (uint256) {
        return SecurityLib.bpsOf(amount, bps);
    }

    function recoverSigner(bytes32 hash, uint8 v, bytes32 r, bytes32 s)
        external pure returns (address)
    {
        return SecurityLib.recoverSigner(hash, v, r, s);
    }

    function toTypedDataHash(bytes32 domainSeparator, bytes32 structHash)
        external pure returns (bytes32)
    {
        return SecurityLib.toTypedDataHash(domainSeparator, structHash);
    }

    function interactionKey(address user, bytes32 poolId, uint256 blockNum)
        external pure returns (bytes32)
    {
        return SecurityLib.interactionKey(user, poolId, blockNum);
    }
}

// Helper contract to call wrapper (simulates contract-originated call)
contract FlashLoanCaller {
    SecurityLibWrapper wrapper;
    constructor(SecurityLibWrapper _w) { wrapper = _w; }

    function callDetect() external view returns (bool) {
        return wrapper.detectFlashLoan();
    }

    function callRequireNoFlashLoan(bool allow) external view {
        wrapper.requireNoFlashLoan(allow);
    }
}

contract SecurityLibTest is Test {
    SecurityLibWrapper lib;
    FlashLoanCaller caller;

    function setUp() public {
        lib = new SecurityLibWrapper();
        caller = new FlashLoanCaller(lib);
    }

    // ============ Flash Loan Detection ============

    function test_detectFlashLoan_contractCall_true() public view {
        // In Foundry, test contract calls wrapper → tx.origin != msg.sender → detected
        assertTrue(lib.detectFlashLoan());
    }

    function test_detectFlashLoan_throughIntermediary() public view {
        // Extra hop: test → caller → wrapper → still detected
        assertTrue(caller.callDetect());
    }

    function test_requireNoFlashLoan_allowed() public view {
        // When allowFlashLoans = true, never reverts even from contract
        caller.callRequireNoFlashLoan(true);
    }

    function test_requireNoFlashLoan_reverts() public {
        vm.expectRevert("Flash loan detected");
        caller.callRequireNoFlashLoan(false);
    }

    function test_requireNoFlashLoan_allowedDirectly() public view {
        // allowFlashLoans = true bypasses the check
        lib.requireNoFlashLoan(true);
    }

    // ============ Price Deviation ============

    function test_checkPriceDeviation_withinBounds() public view {
        // 1% deviation, 5% max → OK
        assertTrue(lib.checkPriceDeviation(101, 100, 500));
    }

    function test_checkPriceDeviation_exactBoundary() public view {
        // 5% deviation, 5% max → OK (<=)
        assertTrue(lib.checkPriceDeviation(105, 100, 500));
    }

    function test_checkPriceDeviation_exceeds() public view {
        // 6% deviation, 5% max → fail
        assertFalse(lib.checkPriceDeviation(106, 100, 500));
    }

    function test_checkPriceDeviation_belowReference() public view {
        // Current < reference, 5% deviation
        assertTrue(lib.checkPriceDeviation(95, 100, 500));
        assertFalse(lib.checkPriceDeviation(94, 100, 500));
    }

    function test_checkPriceDeviation_zeroReference() public view {
        // Zero reference → skip check, return true
        assertTrue(lib.checkPriceDeviation(100, 0, 500));
    }

    function test_checkPriceDeviation_equal() public view {
        assertTrue(lib.checkPriceDeviation(100, 100, 0));
    }

    function test_requirePriceInRange_reverts() public {
        vm.expectRevert("Price deviation too high");
        lib.requirePriceInRange(200, 100, 500);
    }

    // ============ Balance Consistency ============

    function test_checkBalanceConsistency_bothZero() public view {
        assertTrue(lib.checkBalanceConsistency(0, 0, 100));
    }

    function test_checkBalanceConsistency_trackedZero_actualNonZero() public view {
        // Unexpected tokens
        assertFalse(lib.checkBalanceConsistency(0, 100, 100));
    }

    function test_checkBalanceConsistency_actualLessThanTracked() public view {
        // Tokens missing
        assertFalse(lib.checkBalanceConsistency(100, 90, 100));
    }

    function test_checkBalanceConsistency_withinDelta() public view {
        // 1% excess, 5% max → OK
        assertTrue(lib.checkBalanceConsistency(100, 101, 500));
    }

    function test_checkBalanceConsistency_exceedsDelta() public view {
        // 10% excess, 5% max → fail
        assertFalse(lib.checkBalanceConsistency(100, 110, 500));
    }

    function test_checkBalanceConsistency_exactMatch() public view {
        assertTrue(lib.checkBalanceConsistency(100, 100, 0));
    }

    // ============ Slippage Protection ============

    function test_checkSlippage_betterThanExpected() public view {
        // actual > expected → always OK
        assertTrue(lib.checkSlippage(100, 110, 0));
    }

    function test_checkSlippage_withinBounds() public view {
        // 2% slippage, 5% max → OK
        assertTrue(lib.checkSlippage(100, 98, 500));
    }

    function test_checkSlippage_exceeds() public view {
        // 10% slippage, 5% max → fail
        assertFalse(lib.checkSlippage(100, 90, 500));
    }

    function test_checkSlippage_zeroExpected() public view {
        assertTrue(lib.checkSlippage(0, 0, 500));
        assertFalse(lib.checkSlippage(0, 1, 500));
    }

    function test_requireSlippageInBounds_reverts() public {
        vm.expectRevert("Slippage too high");
        lib.requireSlippageInBounds(100, 80, 500);
    }

    // ============ Rate Limiting ============

    function test_checkRateLimit_withinLimit() public {
        vm.warp(1000);
        SecurityLib.RateLimit memory limit = SecurityLib.RateLimit({
            windowStart: 1000,
            windowDuration: 3600,
            maxAmount: 100 ether,
            usedAmount: 0
        });
        (bool allowed, uint256 used) = lib.checkRateLimit(limit, 50 ether);
        assertTrue(allowed);
        assertEq(used, 50 ether);
    }

    function test_checkRateLimit_exceedsLimit() public {
        vm.warp(1000);
        SecurityLib.RateLimit memory limit = SecurityLib.RateLimit({
            windowStart: 1000,
            windowDuration: 3600,
            maxAmount: 100 ether,
            usedAmount: 60 ether
        });
        (bool allowed,) = lib.checkRateLimit(limit, 50 ether);
        assertFalse(allowed);
    }

    function test_checkRateLimit_windowExpired_resets() public {
        vm.warp(5000);
        SecurityLib.RateLimit memory limit = SecurityLib.RateLimit({
            windowStart: 1000,
            windowDuration: 3600,
            maxAmount: 100 ether,
            usedAmount: 90 ether
        });
        // Window expired (5000 >= 1000 + 3600), counter resets
        (bool allowed, uint256 used) = lib.checkRateLimit(limit, 50 ether);
        assertTrue(allowed);
        assertEq(used, 50 ether);
    }

    // ============ Deadline ============

    function test_requireNotExpired_valid() public {
        vm.warp(1000);
        lib.requireNotExpired(2000);
    }

    function test_requireNotExpired_exact() public {
        vm.warp(1000);
        lib.requireNotExpired(1000); // <= so equal is OK
    }

    function test_requireNotExpired_reverts() public {
        vm.warp(2000);
        vm.expectRevert("Transaction expired");
        lib.requireNotExpired(1000);
    }

    // ============ mulDiv ============

    function test_mulDiv_basic() public view {
        assertEq(lib.mulDiv(10, 20, 5), 40);
    }

    function test_mulDiv_fullPrecision() public view {
        // Large numbers that would overflow with naive mul
        uint256 x = 1e36;
        uint256 y = 1e36;
        uint256 d = 1e36;
        assertEq(lib.mulDiv(x, y, d), 1e36);
    }

    function test_mulDiv_revertsZeroDenom() public {
        vm.expectRevert("Division by zero");
        lib.mulDiv(10, 20, 0);
    }

    function test_mulDiv_zeroNumerator() public view {
        assertEq(lib.mulDiv(0, 100, 50), 0);
    }

    // ============ divDown / divUp ============

    function test_divDown_basic() public view {
        assertEq(lib.divDown(10, 3), 3);
    }

    function test_divDown_exact() public view {
        assertEq(lib.divDown(9, 3), 3);
    }

    function test_divDown_revertsZero() public {
        vm.expectRevert("Division by zero");
        lib.divDown(10, 0);
    }

    function test_divUp_basic() public view {
        assertEq(lib.divUp(10, 3), 4); // ceil(10/3) = 4
    }

    function test_divUp_exact() public view {
        assertEq(lib.divUp(9, 3), 3);
    }

    function test_divUp_zero() public view {
        assertEq(lib.divUp(0, 5), 0);
    }

    function test_divUp_revertsZero() public {
        vm.expectRevert("Division by zero");
        lib.divUp(10, 0);
    }

    // ============ Address Validation ============

    function test_requireNonZeroAddress_valid() public view {
        lib.requireNonZeroAddress(address(1));
    }

    function test_requireNonZeroAddress_reverts() public {
        vm.expectRevert("Zero address");
        lib.requireNonZeroAddress(address(0));
    }

    function test_isContract_eoa() public view {
        assertFalse(lib.isContract(address(0x1234)));
    }

    function test_isContract_contract() public view {
        assertTrue(lib.isContract(address(lib)));
    }

    // ============ Bounds Validation ============

    function test_requireValidBps_valid() public view {
        lib.requireValidBps(5000);
        lib.requireValidBps(10000);
        lib.requireValidBps(0);
    }

    function test_requireValidBps_reverts() public {
        vm.expectRevert("Invalid BPS");
        lib.requireValidBps(10001);
    }

    function test_requireInRange_valid() public view {
        lib.requireInRange(50, 10, 100);
        lib.requireInRange(10, 10, 100);
        lib.requireInRange(100, 10, 100);
    }

    function test_requireInRange_reverts() public {
        vm.expectRevert("Value out of range");
        lib.requireInRange(9, 10, 100);
    }

    function test_bpsOf_basic() public view {
        // 10% of 1000 = 100
        assertEq(lib.bpsOf(1000, 1000), 100);
    }

    function test_bpsOf_full() public view {
        assertEq(lib.bpsOf(1000, 10000), 1000);
    }

    function test_bpsOf_zero() public view {
        assertEq(lib.bpsOf(1000, 0), 0);
    }

    // ============ Signature Recovery ============

    function test_recoverSigner_valid() public {
        uint256 pk = 0xBEEF;
        address signer = vm.addr(pk);
        bytes32 hash = keccak256("test message");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, hash);

        address recovered = lib.recoverSigner(hash, v, r, s);
        assertEq(recovered, signer);
    }

    function test_recoverSigner_invalidV() public {
        vm.expectRevert("Invalid signature v value");
        lib.recoverSigner(keccak256("test"), 26, bytes32(uint256(1)), bytes32(uint256(1)));
    }

    function test_recoverSigner_highS() public {
        // s value above the curve order / 2
        bytes32 highS = bytes32(0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A1);
        vm.expectRevert("Invalid signature s value");
        lib.recoverSigner(keccak256("test"), 27, bytes32(uint256(1)), highS);
    }

    // ============ EIP-712 ============

    function test_toTypedDataHash() public view {
        bytes32 domain = keccak256("domain");
        bytes32 structH = keccak256("struct");
        bytes32 result = lib.toTypedDataHash(domain, structH);

        bytes32 expected = keccak256(abi.encodePacked("\x19\x01", domain, structH));
        assertEq(result, expected);
    }

    // ============ Interaction Key ============

    function test_interactionKey_deterministic() public view {
        address user = address(0xBEEF);
        bytes32 poolId = keccak256("pool1");
        uint256 blockNum = 12345;

        bytes32 k1 = lib.interactionKey(user, poolId, blockNum);
        bytes32 k2 = lib.interactionKey(user, poolId, blockNum);
        assertEq(k1, k2);
    }

    function test_interactionKey_different() public view {
        address user = address(0xBEEF);
        bytes32 poolId = keccak256("pool1");

        bytes32 k1 = lib.interactionKey(user, poolId, 100);
        bytes32 k2 = lib.interactionKey(user, poolId, 200);
        assertNotEq(k1, k2);
    }
}
