// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./FibonacciScaling.sol";

/**
 * @title BatchMath
 * @notice Mathematical utilities for batch swap clearing price calculation
 * @dev Implements uniform clearing price for MEV-resistant execution
 *      Enhanced with Fibonacci-weighted price determination
 */
library BatchMath {
    // ============ Custom Errors ============
    error InvalidReserves();
    error InsufficientInput();
    error InsufficientLiquidity();
    error InvalidAmounts();
    error InsufficientInitialLiquidity();

    uint256 constant PRECISION = 1e18;
    uint256 constant MAX_ITERATIONS = 100;
    uint256 constant CONVERGENCE_THRESHOLD = 1e6; // 0.0001% precision

    /// @notice Golden ratio for price interpolation
    uint256 constant PHI = 1618033988749895000; // 1.618... with 18 decimals

    /**
     * @notice Calculate uniform clearing price for batch swaps
     * @dev Uses binary search to find price where supply meets demand
     * @param buyOrders Array of (amountIn, minPrice) for buy orders
     * @param sellOrders Array of (amountIn, maxPrice) for sell orders
     * @param reserve0 Current reserve of token0
     * @param reserve1 Current reserve of token1
     * @return clearingPrice Uniform price (token1 per token0, scaled by 1e18)
     * @return fillableVolume Total volume that can be filled at clearing price
     */
    function calculateClearingPrice(
        uint256[] memory buyOrders,  // [amountIn, minPrice] pairs flattened
        uint256[] memory sellOrders, // [amountIn, maxPrice] pairs flattened
        uint256 reserve0,
        uint256 reserve1
    ) internal pure returns (uint256 clearingPrice, uint256 fillableVolume) {
        if (reserve0 == 0 || reserve1 == 0) revert InvalidReserves();

        // Calculate spot price from AMM
        uint256 spotPrice = (reserve1 * PRECISION) / reserve0;

        // If no orders, return spot price
        if (buyOrders.length == 0 && sellOrders.length == 0) {
            return (spotPrice, 0);
        }

        // Find price bounds
        (uint256 minPrice, uint256 maxPrice) = findPriceBounds(
            buyOrders,
            sellOrders,
            spotPrice
        );

        // Binary search for clearing price
        uint256 low = minPrice;
        uint256 high = maxPrice;

        for (uint256 i = 0; i < MAX_ITERATIONS; i++) {
            uint256 mid = (low + high) / 2;

            (int256 netDemand, uint256 volume) = calculateNetDemand(
                buyOrders,
                sellOrders,
                mid,
                reserve0,
                reserve1
            );

            // Check convergence
            if (high - low <= CONVERGENCE_THRESHOLD) {
                return (mid, volume);
            }

            // Adjust bounds based on net demand
            if (netDemand > 0) {
                // More buyers than sellers, price should increase
                low = mid;
            } else {
                // More sellers than buyers, price should decrease
                high = mid;
            }
        }

        // Return midpoint after max iterations
        clearingPrice = (low + high) / 2;
        (, fillableVolume) = calculateNetDemand(
            buyOrders,
            sellOrders,
            clearingPrice,
            reserve0,
            reserve1
        );
    }

    /**
     * @notice Find min and max price bounds for binary search
     */
    function findPriceBounds(
        uint256[] memory buyOrders,
        uint256[] memory sellOrders,
        uint256 spotPrice
    ) internal pure returns (uint256 minPrice, uint256 maxPrice) {
        minPrice = spotPrice / 2; // Start at 50% of spot
        maxPrice = spotPrice * 2; // End at 200% of spot

        // Adjust based on order limits
        for (uint256 i = 0; i < buyOrders.length; i += 2) {
            uint256 limitPrice = buyOrders[i + 1];
            if (limitPrice > maxPrice) {
                maxPrice = limitPrice;
            }
        }

        for (uint256 i = 0; i < sellOrders.length; i += 2) {
            uint256 limitPrice = sellOrders[i + 1];
            if (limitPrice < minPrice && limitPrice > 0) {
                minPrice = limitPrice;
            }
        }
    }

    /**
     * @notice Calculate net demand at a given price
     * @return netDemand Positive if buy pressure exceeds sell pressure
     * @return fillableVolume Total fillable volume at this price
     */
    function calculateNetDemand(
        uint256[] memory buyOrders,
        uint256[] memory sellOrders,
        uint256 price,
        uint256 reserve0,
        uint256 reserve1
    ) internal pure returns (int256 netDemand, uint256 fillableVolume) {
        uint256 totalBuyVolume = 0;
        uint256 totalSellVolume = 0;

        // Sum buy orders willing to pay at least `price`
        for (uint256 i = 0; i < buyOrders.length; i += 2) {
            uint256 amount = buyOrders[i];
            uint256 minPrice = buyOrders[i + 1];

            if (price <= minPrice) {
                totalBuyVolume += amount;
            }
        }

        // Sum sell orders willing to accept at most `price`
        for (uint256 i = 0; i < sellOrders.length; i += 2) {
            uint256 amount = sellOrders[i];
            uint256 maxPrice = sellOrders[i + 1];

            if (price >= maxPrice) {
                totalSellVolume += amount;
            }
        }

        // Consider AMM liquidity constraints
        uint256 ammCapacity = calculateAMMCapacity(reserve0, reserve1, price);
        uint256 effectiveBuyVolume = totalBuyVolume > ammCapacity ? ammCapacity : totalBuyVolume;
        uint256 effectiveSellVolume = totalSellVolume > ammCapacity ? ammCapacity : totalSellVolume;

        netDemand = int256(effectiveBuyVolume) - int256(effectiveSellVolume);
        fillableVolume = effectiveBuyVolume + effectiveSellVolume;
    }

    /**
     * @notice Calculate AMM's capacity to absorb trades at a given price
     * @dev Uses geometric mean of reserves weighted by target price for more accurate capacity
     */
    function calculateAMMCapacity(
        uint256 reserve0,
        uint256 reserve1,
        uint256 targetPrice
    ) internal pure returns (uint256 capacity) {
        // Calculate how much can be traded before price moves significantly
        // Using constant product: capacity scales with sqrt(reserve0 * reserve1)
        // Weighted by how far targetPrice is from spot price
        uint256 spotPrice = (reserve1 * PRECISION) / reserve0;
        uint256 priceRatio = targetPrice > spotPrice
            ? (targetPrice * PRECISION) / spotPrice
            : (spotPrice * PRECISION) / targetPrice;

        // Base capacity is 10% of geometric mean, reduced if price is far from spot
        uint256 geometricMean = sqrt(reserve0 * reserve1);
        capacity = (geometricMean * PRECISION) / (10 * priceRatio);
    }

    /**
     * @notice Integer square root using Newton's method
     */
    function sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return y;
    }

    /**
     * @notice Calculate output amount using constant product formula
     * @param amountIn Input amount
     * @param reserveIn Input reserve
     * @param reserveOut Output reserve
     * @param feeRate Fee in basis points
     * @return amountOut Output amount after fees
     */
    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut,
        uint256 feeRate
    ) internal pure returns (uint256 amountOut) {
        if (amountIn == 0) revert InsufficientInput();
        if (reserveIn == 0 || reserveOut == 0) revert InsufficientLiquidity();

        uint256 amountInWithFee = amountIn * (10000 - feeRate);
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = (reserveIn * 10000) + amountInWithFee;

        amountOut = numerator / denominator;
    }

    /**
     * @notice Calculate input amount needed for desired output
     * @param amountOut Desired output amount
     * @param reserveIn Input reserve
     * @param reserveOut Output reserve
     * @param feeRate Fee in basis points
     * @return amountIn Required input amount
     */
    function getAmountIn(
        uint256 amountOut,
        uint256 reserveIn,
        uint256 reserveOut,
        uint256 feeRate
    ) internal pure returns (uint256 amountIn) {
        if (amountOut == 0) revert InsufficientInput();
        if (reserveIn == 0 || reserveOut == 0) revert InsufficientLiquidity();
        if (amountOut >= reserveOut) revert InsufficientLiquidity();

        uint256 numerator = reserveIn * amountOut * 10000;
        uint256 denominator = (reserveOut - amountOut) * (10000 - feeRate);

        amountIn = (numerator / denominator) + 1;
    }

    /**
     * @notice Calculate optimal liquidity amounts to maintain ratio
     * @param amount0Desired Desired token0 amount
     * @param amount1Desired Desired token1 amount
     * @param reserve0 Current token0 reserve
     * @param reserve1 Current token1 reserve
     * @return amount0 Optimal token0 amount
     * @return amount1 Optimal token1 amount
     */
    function calculateOptimalLiquidity(
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 reserve0,
        uint256 reserve1
    ) internal pure returns (uint256 amount0, uint256 amount1) {
        if (reserve0 == 0 && reserve1 == 0) {
            return (amount0Desired, amount1Desired);
        }

        uint256 amount1Optimal = (amount0Desired * reserve1) / reserve0;

        if (amount1Optimal <= amount1Desired) {
            return (amount0Desired, amount1Optimal);
        } else {
            uint256 amount0Optimal = (amount1Desired * reserve0) / reserve1;
            if (amount0Optimal > amount0Desired) revert InvalidAmounts();
            return (amount0Optimal, amount1Desired);
        }
    }

    /**
     * @notice Calculate LP tokens to mint
     * @param amount0 Token0 amount added
     * @param amount1 Token1 amount added
     * @param reserve0 Current token0 reserve
     * @param reserve1 Current token1 reserve
     * @param totalSupply Current LP token supply
     * @return liquidity LP tokens to mint
     */
    function calculateLiquidity(
        uint256 amount0,
        uint256 amount1,
        uint256 reserve0,
        uint256 reserve1,
        uint256 totalSupply
    ) internal pure returns (uint256 liquidity) {
        if (totalSupply == 0) {
            // Initial liquidity: sqrt(amount0 * amount1)
            liquidity = sqrt(amount0 * amount1);
            if (liquidity <= 1000) revert InsufficientInitialLiquidity();
            liquidity -= 1000; // Lock minimum liquidity
        } else {
            // Proportional to existing liquidity
            uint256 liquidity0 = (amount0 * totalSupply) / reserve0;
            uint256 liquidity1 = (amount1 * totalSupply) / reserve1;
            liquidity = liquidity0 < liquidity1 ? liquidity0 : liquidity1;
        }
    }

    /**
     * @notice Calculate protocol fee from swap
     * @param amount Swap amount
     * @param feeRate Fee rate in basis points
     * @param protocolShare Protocol's share of fees (in basis points)
     * @return protocolFee Fee going to protocol
     * @return lpFee Fee going to LPs
     */
    function calculateFees(
        uint256 amount,
        uint256 feeRate,
        uint256 protocolShare
    ) internal pure returns (uint256 protocolFee, uint256 lpFee) {
        uint256 totalFee = (amount * feeRate) / 10000;
        protocolFee = (totalFee * protocolShare) / 10000;
        lpFee = totalFee - protocolFee;
    }

    // ============ Fibonacci-Enhanced Price Functions ============

    /**
     * @notice Calculate clearing price with Fibonacci-weighted order aggregation
     * @dev Weights orders by Fibonacci sequence to prioritize recent/larger orders
     * @param buyOrders Array of (amountIn, maxPrice) for buy orders
     * @param sellOrders Array of (amountIn, minPrice) for sell orders
     * @param reserve0 Current reserve of token0
     * @param reserve1 Current reserve of token1
     * @return clearingPrice Fibonacci-weighted clearing price
     * @return confidence Confidence score (0-100) based on order distribution
     */
    function calculateFibonacciClearingPrice(
        uint256[] memory buyOrders,
        uint256[] memory sellOrders,
        uint256 reserve0,
        uint256 reserve1
    ) internal pure returns (uint256 clearingPrice, uint256 confidence) {
        if (reserve0 == 0 || reserve1 == 0) revert InvalidReserves();

        uint256 spotPrice = (reserve1 * PRECISION) / reserve0;

        // If no orders, return spot with low confidence
        if (buyOrders.length == 0 && sellOrders.length == 0) {
            return (spotPrice, 50);
        }

        // Extract prices and volumes for Fibonacci weighting
        uint256 buyCount = buyOrders.length / 2;
        uint256 sellCount = sellOrders.length / 2;

        if (buyCount == 0 || sellCount == 0) {
            // One-sided market - use golden ratio blend with spot
            if (buyCount > 0) {
                uint256 avgBuyPrice = _calculateAveragePrice(buyOrders);
                clearingPrice = FibonacciScaling.goldenRatioMean(avgBuyPrice, spotPrice);
                confidence = 60;
            } else {
                uint256 avgSellPrice = _calculateAveragePrice(sellOrders);
                clearingPrice = FibonacciScaling.goldenRatioMean(spotPrice, avgSellPrice);
                confidence = 60;
            }
            return (clearingPrice, confidence);
        }

        // Two-sided market - use Fibonacci weighted prices
        uint256[] memory buyPrices = new uint256[](buyCount);
        uint256[] memory buyVolumes = new uint256[](buyCount);
        uint256[] memory sellPrices = new uint256[](sellCount);
        uint256[] memory sellVolumes = new uint256[](sellCount);

        for (uint256 i = 0; i < buyCount; i++) {
            buyVolumes[i] = buyOrders[i * 2];
            buyPrices[i] = buyOrders[i * 2 + 1];
        }

        for (uint256 i = 0; i < sellCount; i++) {
            sellVolumes[i] = sellOrders[i * 2];
            sellPrices[i] = sellOrders[i * 2 + 1];
        }

        // Calculate Fibonacci-weighted average for each side
        uint256 fibBuyPrice = FibonacciScaling.fibonacciWeightedPrice(buyPrices, buyVolumes);
        uint256 fibSellPrice = FibonacciScaling.fibonacciWeightedPrice(sellPrices, sellVolumes);

        // Clearing price is golden ratio mean between bid and ask
        clearingPrice = FibonacciScaling.goldenRatioMean(fibBuyPrice, fibSellPrice);

        // Confidence based on spread (tighter = higher confidence)
        uint256 spread = fibBuyPrice > fibSellPrice
            ? ((fibBuyPrice - fibSellPrice) * 10000) / fibBuyPrice
            : ((fibSellPrice - fibBuyPrice) * 10000) / fibSellPrice;

        if (spread <= 50) {        // 0.5% spread
            confidence = 95;
        } else if (spread <= 100) { // 1% spread
            confidence = 85;
        } else if (spread <= 200) { // 2% spread
            confidence = 75;
        } else if (spread <= 500) { // 5% spread
            confidence = 60;
        } else {
            confidence = 40;
        }
    }

    /**
     * @notice Calculate average price from order array
     */
    function _calculateAveragePrice(uint256[] memory orders) private pure returns (uint256) {
        uint256 totalVolume = 0;
        uint256 totalValue = 0;

        for (uint256 i = 0; i < orders.length / 2; i++) {
            uint256 volume = orders[i * 2];
            uint256 price = orders[i * 2 + 1];
            totalVolume += volume;
            totalValue += volume * price;
        }

        if (totalVolume == 0) return 0;
        return totalValue / totalVolume;
    }

    /**
     * @notice Apply golden ratio damping to price movement
     * @dev Limits price change per batch to prevent manipulation
     * @param currentPrice Current AMM price
     * @param proposedPrice Proposed clearing price
     * @param maxDeviationBps Maximum deviation in basis points
     * @return adjustedPrice Damped price using golden ratio
     */
    function applyGoldenRatioDamping(
        uint256 currentPrice,
        uint256 proposedPrice,
        uint256 maxDeviationBps
    ) internal pure returns (uint256 adjustedPrice) {
        uint256 maxDeviation = (currentPrice * maxDeviationBps) / 10000;

        if (proposedPrice > currentPrice) {
            uint256 increase = proposedPrice - currentPrice;
            if (increase > maxDeviation) {
                // Damp using golden ratio
                uint256 dampedIncrease = (maxDeviation * PHI) / PRECISION;
                if (dampedIncrease > maxDeviation) dampedIncrease = maxDeviation;
                adjustedPrice = currentPrice + dampedIncrease;
            } else {
                adjustedPrice = proposedPrice;
            }
        } else {
            uint256 decrease = currentPrice - proposedPrice;
            if (decrease > maxDeviation) {
                // Damp using golden ratio
                uint256 dampedDecrease = (maxDeviation * PHI) / PRECISION;
                if (dampedDecrease > maxDeviation) dampedDecrease = maxDeviation;
                adjustedPrice = currentPrice - dampedDecrease;
            } else {
                adjustedPrice = proposedPrice;
            }
        }
    }

    /**
     * @notice Calculate price at Fibonacci extension level
     * @param basePrice Base price
     * @param range Price range
     * @param fibLevel Fibonacci level (236, 382, 500, 618, 786, 1000)
     * @param isExtension True for extension above, false for retracement
     * @return targetPrice Price at Fibonacci level
     */
    function getFibonacciPrice(
        uint256 basePrice,
        uint256 range,
        uint256 fibLevel,
        bool isExtension
    ) internal pure returns (uint256 targetPrice) {
        uint256 fibRatio;

        if (fibLevel == 236) fibRatio = FibonacciScaling.FIB_236;
        else if (fibLevel == 382) fibRatio = FibonacciScaling.FIB_382;
        else if (fibLevel == 500) fibRatio = FibonacciScaling.FIB_500;
        else if (fibLevel == 618) fibRatio = FibonacciScaling.FIB_618;
        else if (fibLevel == 786) fibRatio = FibonacciScaling.FIB_786;
        else fibRatio = PRECISION;

        uint256 adjustment = (range * fibRatio) / PRECISION;

        if (isExtension) {
            targetPrice = basePrice + adjustment;
        } else {
            targetPrice = basePrice > adjustment ? basePrice - adjustment : 0;
        }
    }
}
