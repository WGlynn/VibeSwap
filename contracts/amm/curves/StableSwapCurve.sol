// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IPoolCurve.sol";

/**
 * @title StableSwapCurve
 * @notice Curve.fi StableSwap invariant for near-pegged token pairs.
 * @dev Part of VSOS (VibeSwap Operating System) Protocol Framework.
 *
 *      Implements the StableSwap invariant for n=2 tokens:
 *        A*n^n * sum(x_i) + D = A*D*n^n + D^(n+1) / (n^n * prod(x_i))
 *
 *      Simplified for n=2:
 *        A*4*(x + y) + D = A*D*4 + D^3 / (4*x*y)
 *
 *      The amplification coefficient A controls the curve shape:
 *        - A = 1:    behaves like constant product
 *        - A = 100:  standard stablecoin pair
 *        - A = 1000: very tight peg
 *
 *      curveParams: abi.encode(uint256 amplificationCoefficient)
 *      Valid A range: [1, 10000]
 *
 *      Uses Newton's method to solve for D and y, with max 255 iterations
 *      and convergence threshold of 1 wei.
 *
 *      Cooperative Capitalism angle: StableSwap pools enable deep liquidity
 *      for pegged assets with minimal slippage, benefiting all participants
 *      equally — the pool's low-slippage property is a public good that
 *      grows more valuable with more liquidity (positive-sum).
 */
contract StableSwapCurve is IPoolCurve {
    // ============ Errors ============

    error InsufficientInput();
    error InsufficientLiquidity();
    error InvalidAmplification();
    error ConvergenceFailed();

    // ============ Constants ============

    bytes32 public constant CURVE_ID = keccak256("STABLE_SWAP");
    uint256 public constant MIN_A = 1;
    uint256 public constant MAX_A = 10000;
    uint256 private constant MAX_ITERATIONS = 255;

    // ============ IPoolCurve ============

    /// @inheritdoc IPoolCurve
    function curveId() external pure override returns (bytes32) {
        return CURVE_ID;
    }

    /// @inheritdoc IPoolCurve
    function curveName() external pure override returns (string memory) {
        return "StableSwap (Curve.fi invariant)";
    }

    /// @inheritdoc IPoolCurve
    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut,
        uint256 feeRate,
        bytes calldata curveParams
    ) external pure override returns (uint256 amountOut) {
        if (amountIn == 0) revert InsufficientInput();
        if (reserveIn == 0 || reserveOut == 0) revert InsufficientLiquidity();

        uint256 A = _decodeA(curveParams);

        // Apply fee to input
        uint256 amountInAfterFee = amountIn * (10000 - feeRate) / 10000;

        // New reserveIn after swap
        uint256 newReserveIn = reserveIn + amountInAfterFee;

        // Compute D from current reserves
        uint256 D = _computeD(reserveIn, reserveOut, A);

        // Compute new reserveOut given newReserveIn and D
        uint256 newReserveOut = _computeY(newReserveIn, D, A);

        if (newReserveOut >= reserveOut) revert InsufficientLiquidity();

        amountOut = reserveOut - newReserveOut;
    }

    /// @inheritdoc IPoolCurve
    function getAmountIn(
        uint256 amountOut,
        uint256 reserveIn,
        uint256 reserveOut,
        uint256 feeRate,
        bytes calldata curveParams
    ) external pure override returns (uint256 amountIn) {
        if (amountOut == 0) revert InsufficientInput();
        if (reserveIn == 0 || reserveOut == 0) revert InsufficientLiquidity();
        if (amountOut >= reserveOut) revert InsufficientLiquidity();

        uint256 A = _decodeA(curveParams);

        // New reserveOut after removing amountOut
        uint256 newReserveOut = reserveOut - amountOut;

        // Compute D from current reserves
        uint256 D = _computeD(reserveIn, reserveOut, A);

        // Compute required newReserveIn given newReserveOut and D
        uint256 newReserveIn = _computeY(newReserveOut, D, A);

        if (newReserveIn <= reserveIn) revert InsufficientLiquidity();

        // amountIn before fee
        uint256 amountInBeforeFee = newReserveIn - reserveIn;

        // Reverse the fee: amountIn * (10000 - feeRate) / 10000 = amountInBeforeFee
        // => amountIn = amountInBeforeFee * 10000 / (10000 - feeRate) + 1
        amountIn = (amountInBeforeFee * 10000) / (10000 - feeRate) + 1;
    }

    /// @inheritdoc IPoolCurve
    function validateParams(bytes calldata curveParams) external pure override returns (bool) {
        if (curveParams.length != 32) return false;
        uint256 A = abi.decode(curveParams, (uint256));
        return A >= MIN_A && A <= MAX_A;
    }

    // ============ Internal Math ============

    /**
     * @notice Decode amplification coefficient from curveParams
     */
    function _decodeA(bytes calldata curveParams) internal pure returns (uint256 A) {
        A = abi.decode(curveParams, (uint256));
        if (A < MIN_A || A > MAX_A) revert InvalidAmplification();
    }

    /**
     * @notice Compute the StableSwap invariant D using Newton's method.
     * @dev For n=2: A*4*(x+y) + D = A*4*D + D^3/(4*x*y)
     *      Rearranged for Newton iteration:
     *        D_{n+1} = (A*4*S + n*D_p) * D_n / ((A*4 - 1)*D_n + (n+1)*D_p)
     *      where S = x + y, D_p = D^3 / (4*x*y)
     * @param x Reserve of token 0
     * @param y Reserve of token 1
     * @param A Amplification coefficient
     * @return D The invariant value
     */
    function _computeD(uint256 x, uint256 y, uint256 A) internal pure returns (uint256 D) {
        uint256 S = x + y;
        if (S == 0) return 0;

        // Initial guess
        D = S;

        // Ann = A * n^n = A * 4 (for n=2)
        uint256 Ann = A * 4;

        for (uint256 i = 0; i < MAX_ITERATIONS; i++) {
            // D_P = D^3 / (4 * x * y)  — computed step by step to avoid overflow
            uint256 D_P = D;
            D_P = D_P * D / (2 * x);  // D^2 / (2x)
            D_P = D_P * D / (2 * y);  // D^3 / (4xy)

            uint256 D_prev = D;

            // Numerator: (Ann * S + 2 * D_P) * D
            // Denominator: (Ann - 1) * D + 3 * D_P
            // n = 2, so n*D_P = 2*D_P and (n+1)*D_P = 3*D_P
            uint256 numerator = (Ann * S + 2 * D_P) * D;
            uint256 denominator = (Ann - 1) * D + 3 * D_P;

            D = numerator / denominator;

            // Check convergence (within 1 wei)
            if (D > D_prev) {
                if (D - D_prev <= 1) return D;
            } else {
                if (D_prev - D <= 1) return D;
            }
        }

        revert ConvergenceFailed();
    }

    /**
     * @notice Compute the other reserve given one reserve and the invariant D.
     * @dev Solves the StableSwap equation for y given x and D.
     *      For n=2: A*4*(x+y) + D = A*4*D + D^3/(4*x*y)
     *      Rearranged as quadratic in y:
     *        y^2 + (S' - D)*y = D^3/(4*A*4*x)   where S' = D/(A*4) + x
     *      Newton iteration:
     *        y_{n+1} = (y_n^2 + c) / (2*y_n + b)
     *      where c = D^3/(4*Ann*x), b = S' - D
     * @param x Known reserve
     * @param D The invariant
     * @param A Amplification coefficient
     * @return y The other reserve
     */
    function _computeY(uint256 x, uint256 D, uint256 A) internal pure returns (uint256 y) {
        uint256 Ann = A * 4; // A * n^n for n=2

        // c = D^3 / (4 * Ann * x)  — step by step
        uint256 c = D * D / (2 * x);  // D^2 / (2x)
        c = c * D / (2 * Ann);         // D^3 / (4 * Ann * x)

        // b = S' - D  where S' = D/Ann + x
        // But we need b + D = S' = D/Ann + x for the iteration
        // b = D/Ann + x - D
        // To avoid underflow, compute with offset:
        //   y_{n+1} = (y^2 + c) / (2y + b)
        //   where b = D/Ann + x - D  (can be negative conceptually, but we handle carefully)

        uint256 S_ = D / Ann + x;  // S' = D/Ann + x

        // Initial guess
        y = D;

        for (uint256 i = 0; i < MAX_ITERATIONS; i++) {
            uint256 y_prev = y;

            // y = (y^2 + c) / (2*y + S' - D)
            // Note: 2*y + S' should always be > D for valid inputs
            uint256 numerator = y * y + c;
            uint256 denominator = 2 * y + S_ - D;

            y = numerator / denominator;

            // Check convergence
            if (y > y_prev) {
                if (y - y_prev <= 1) return y;
            } else {
                if (y_prev - y <= 1) return y;
            }
        }

        revert ConvergenceFailed();
    }
}
