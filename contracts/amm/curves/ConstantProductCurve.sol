// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IPoolCurve.sol";

/**
 * @title ConstantProductCurve
 * @notice x * y = k constant-product AMM curve.
 * @dev Part of VSOS (VibeSwap Operating System) Protocol Framework.
 *
 *      Extracts the proven BatchMath swap math into a pluggable curve
 *      contract for use with VibePoolFactory. The math is byte-for-byte
 *      identical to BatchMath.getAmountOut / getAmountIn.
 *
 *      curveParams: empty bytes (no extra parameters needed)
 */
contract ConstantProductCurve is IPoolCurve {
    // ============ Errors ============

    error InsufficientInput();
    error InsufficientLiquidity();

    // ============ Constants ============

    bytes32 public constant CURVE_ID = keccak256("CONSTANT_PRODUCT");

    // ============ IPoolCurve ============

    /// @inheritdoc IPoolCurve
    function curveId() external pure override returns (bytes32) {
        return CURVE_ID;
    }

    /// @inheritdoc IPoolCurve
    function curveName() external pure override returns (string memory) {
        return "Constant Product (x*y=k)";
    }

    /// @inheritdoc IPoolCurve
    /// @dev Identical to BatchMath.getAmountOut
    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut,
        uint256 feeRate,
        bytes calldata /* curveParams */
    ) external pure override returns (uint256 amountOut) {
        if (amountIn == 0) revert InsufficientInput();
        if (reserveIn == 0 || reserveOut == 0) revert InsufficientLiquidity();

        uint256 amountInWithFee = amountIn * (10000 - feeRate);
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = (reserveIn * 10000) + amountInWithFee;

        amountOut = numerator / denominator;
    }

    /// @inheritdoc IPoolCurve
    /// @dev Identical to BatchMath.getAmountIn
    function getAmountIn(
        uint256 amountOut,
        uint256 reserveIn,
        uint256 reserveOut,
        uint256 feeRate,
        bytes calldata /* curveParams */
    ) external pure override returns (uint256 amountIn) {
        if (amountOut == 0) revert InsufficientInput();
        if (reserveIn == 0 || reserveOut == 0) revert InsufficientLiquidity();
        if (amountOut >= reserveOut) revert InsufficientLiquidity();

        uint256 numerator = reserveIn * amountOut * 10000;
        uint256 denominator = (reserveOut - amountOut) * (10000 - feeRate);

        amountIn = (numerator / denominator) + 1;
    }

    /// @inheritdoc IPoolCurve
    /// @dev Constant product has no extra params — always valid
    function validateParams(bytes calldata /* curveParams */) external pure override returns (bool) {
        return true;
    }
}
