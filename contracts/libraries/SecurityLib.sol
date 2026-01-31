// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title SecurityLib
 * @notice Security utilities for DEX protection against common exploits
 * @dev Implements defenses against flash loans, donation attacks, and price manipulation
 */
library SecurityLib {
    // ============ Flash Loan Detection ============

    /**
     * @notice Detects potential flash loan by comparing tx.origin and msg.sender
     * @dev Flash loans typically involve contract intermediaries
     * @return isFlashLoan True if transaction appears to originate from contract
     */
    function detectFlashLoan() internal view returns (bool isFlashLoan) {
        // If tx.origin != msg.sender, a contract is involved (potential flash loan)
        // Note: This is a heuristic, not foolproof
        return tx.origin != msg.sender;
    }

    /**
     * @notice Modifier-style check that reverts on suspected flash loans
     * @param allowFlashLoans Whether to allow flash loans for this operation
     */
    function requireNoFlashLoan(bool allowFlashLoans) internal view {
        if (!allowFlashLoans && tx.origin != msg.sender) {
            revert("Flash loan detected");
        }
    }

    // ============ Price Manipulation Detection ============

    /**
     * @notice Check if price deviation exceeds threshold
     * @param currentPrice Current spot price
     * @param referencePrice Reference/oracle price
     * @param maxDeviationBps Maximum allowed deviation in basis points
     * @return withinBounds True if price is within acceptable range
     */
    function checkPriceDeviation(
        uint256 currentPrice,
        uint256 referencePrice,
        uint256 maxDeviationBps
    ) internal pure returns (bool withinBounds) {
        if (referencePrice == 0) return true; // No reference, skip check

        uint256 deviation;
        if (currentPrice > referencePrice) {
            deviation = ((currentPrice - referencePrice) * 10000) / referencePrice;
        } else {
            deviation = ((referencePrice - currentPrice) * 10000) / referencePrice;
        }

        return deviation <= maxDeviationBps;
    }

    /**
     * @notice Require price to be within acceptable deviation
     */
    function requirePriceInRange(
        uint256 currentPrice,
        uint256 referencePrice,
        uint256 maxDeviationBps
    ) internal pure {
        require(
            checkPriceDeviation(currentPrice, referencePrice, maxDeviationBps),
            "Price deviation too high"
        );
    }

    // ============ Balance Manipulation Detection ============

    /**
     * @notice Check for unexpected balance changes (donation attack detection)
     * @param trackedBalance Internally tracked balance
     * @param actualBalance Actual token balance
     * @param maxDeltaBps Maximum allowed discrepancy in basis points
     * @return valid True if balances are consistent
     */
    function checkBalanceConsistency(
        uint256 trackedBalance,
        uint256 actualBalance,
        uint256 maxDeltaBps
    ) internal pure returns (bool valid) {
        if (trackedBalance == 0 && actualBalance == 0) return true;
        if (trackedBalance == 0) return false; // Unexpected tokens

        // Allow actual to be >= tracked (donations happen)
        // But flag if significantly different
        if (actualBalance < trackedBalance) {
            // Tokens missing - always invalid
            return false;
        }

        uint256 excess = actualBalance - trackedBalance;
        uint256 excessBps = (excess * 10000) / trackedBalance;

        return excessBps <= maxDeltaBps;
    }

    // ============ Slippage Protection ============

    /**
     * @notice Calculate and validate slippage
     * @param expectedAmount Expected output amount
     * @param actualAmount Actual output amount
     * @param maxSlippageBps Maximum allowed slippage in basis points
     * @return valid True if slippage is acceptable
     */
    function checkSlippage(
        uint256 expectedAmount,
        uint256 actualAmount,
        uint256 maxSlippageBps
    ) internal pure returns (bool valid) {
        if (expectedAmount == 0) return actualAmount == 0;

        if (actualAmount >= expectedAmount) return true; // Better than expected

        uint256 slippage = ((expectedAmount - actualAmount) * 10000) / expectedAmount;
        return slippage <= maxSlippageBps;
    }

    /**
     * @notice Require slippage to be within bounds
     */
    function requireSlippageInBounds(
        uint256 expectedAmount,
        uint256 actualAmount,
        uint256 maxSlippageBps
    ) internal pure {
        require(
            checkSlippage(expectedAmount, actualAmount, maxSlippageBps),
            "Slippage too high"
        );
    }

    // ============ Rate Limiting ============

    struct RateLimit {
        uint256 windowStart;
        uint256 windowDuration;
        uint256 maxAmount;
        uint256 usedAmount;
    }

    /**
     * @notice Check if amount is within rate limit
     * @param limit Rate limit configuration
     * @param amount Amount to check
     * @return allowed True if within limit
     * @return newUsedAmount Updated used amount
     */
    function checkRateLimit(
        RateLimit memory limit,
        uint256 amount
    ) internal view returns (bool allowed, uint256 newUsedAmount) {
        // Check if window has expired
        if (block.timestamp >= limit.windowStart + limit.windowDuration) {
            // New window - reset counter
            return (amount <= limit.maxAmount, amount);
        }

        // Same window - accumulate
        newUsedAmount = limit.usedAmount + amount;
        allowed = newUsedAmount <= limit.maxAmount;
    }

    // ============ Deadline Validation ============

    /**
     * @notice Validate transaction deadline hasn't passed
     * @param deadline Unix timestamp deadline
     */
    function requireNotExpired(uint256 deadline) internal view {
        require(block.timestamp <= deadline, "Transaction expired");
    }

    // ============ Safe Math Helpers ============

    /**
     * @notice Multiply then divide with full precision
     * @dev Prevents overflow in intermediate calculation
     */
    function mulDiv(
        uint256 x,
        uint256 y,
        uint256 denominator
    ) internal pure returns (uint256 result) {
        require(denominator > 0, "Division by zero");

        // 512-bit multiply
        uint256 prod0; // Least significant 256 bits of the product
        uint256 prod1; // Most significant 256 bits of the product
        assembly {
            let mm := mulmod(x, y, not(0))
            prod0 := mul(x, y)
            prod1 := sub(sub(mm, prod0), lt(mm, prod0))
        }

        // Handle non-overflow cases
        if (prod1 == 0) {
            return prod0 / denominator;
        }

        // Make sure the result is less than 2^256
        require(prod1 < denominator, "Overflow");

        // 512 by 256 division
        uint256 remainder;
        assembly {
            remainder := mulmod(x, y, denominator)
            prod1 := sub(prod1, gt(remainder, prod0))
            prod0 := sub(prod0, remainder)
        }

        // Factor powers of two out of denominator
        uint256 twos = denominator & (~denominator + 1);
        assembly {
            denominator := div(denominator, twos)
            prod0 := div(prod0, twos)
            twos := add(div(sub(0, twos), twos), 1)
        }
        prod0 |= prod1 * twos;

        // Invert denominator mod 2^256
        uint256 inverse = (3 * denominator) ^ 2;
        inverse *= 2 - denominator * inverse;
        inverse *= 2 - denominator * inverse;
        inverse *= 2 - denominator * inverse;
        inverse *= 2 - denominator * inverse;
        inverse *= 2 - denominator * inverse;
        inverse *= 2 - denominator * inverse;

        result = prod0 * inverse;
    }

    /**
     * @notice Round down division
     */
    function divDown(uint256 a, uint256 b) internal pure returns (uint256) {
        require(b > 0, "Division by zero");
        return a / b;
    }

    /**
     * @notice Round up division
     */
    function divUp(uint256 a, uint256 b) internal pure returns (uint256) {
        require(b > 0, "Division by zero");
        return a == 0 ? 0 : (a - 1) / b + 1;
    }
}
