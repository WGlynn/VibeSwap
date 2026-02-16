// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IPoolCurve
 * @notice Pluggable curve interface for VibePoolFactory.
 * @dev Part of VSOS (VibeSwap Operating System) Protocol Framework.
 *
 *      Curves are stateless pure-math contracts. The factory stores pool
 *      state (reserves, fees); curves only compute swap amounts.
 *
 *      Each curve implementation:
 *        - Returns a unique `curveId` (keccak256 of its canonical name)
 *        - Decodes its own `curveParams` format from generic `bytes`
 *        - Validates params via `validateParams`
 *        - Computes getAmountOut / getAmountIn given reserves + fee
 */
interface IPoolCurve {
    // ============ Identification ============

    /// @notice Unique identifier for this curve type
    /// @return Keccak256 hash of the curve's canonical name
    function curveId() external pure returns (bytes32);

    /// @notice Human-readable name for this curve
    function curveName() external pure returns (string memory);

    // ============ Swap Math ============

    /// @notice Calculate output amount for a given input
    /// @param amountIn Input token amount
    /// @param reserveIn Reserve of input token
    /// @param reserveOut Reserve of output token
    /// @param feeRate Fee in basis points (e.g. 5 = 0.05%)
    /// @param curveParams Curve-specific parameters (decoded by implementation)
    /// @return amountOut Output token amount after fees
    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut,
        uint256 feeRate,
        bytes calldata curveParams
    ) external pure returns (uint256 amountOut);

    /// @notice Calculate input amount needed for a desired output
    /// @param amountOut Desired output token amount
    /// @param reserveIn Reserve of input token
    /// @param reserveOut Reserve of output token
    /// @param feeRate Fee in basis points
    /// @param curveParams Curve-specific parameters
    /// @return amountIn Required input token amount
    function getAmountIn(
        uint256 amountOut,
        uint256 reserveIn,
        uint256 reserveOut,
        uint256 feeRate,
        bytes calldata curveParams
    ) external pure returns (uint256 amountIn);

    // ============ Validation ============

    /// @notice Validate curve-specific parameters
    /// @param curveParams Encoded parameters to validate
    /// @return valid True if params are acceptable for this curve
    function validateParams(bytes calldata curveParams) external pure returns (bool valid);
}
