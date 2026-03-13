// ============================================================
// defi — DeFi-specific calculation utilities
// Used for IL, APY, price impact, slippage calculations
// ============================================================

/**
 * Calculate impermanent loss given price ratio change
 * @param {number} priceRatio - new price / old price
 * @returns {number} IL as a decimal (0.057 = 5.7% loss)
 */
export function impermanentLoss(priceRatio) {
  const sqrtR = Math.sqrt(priceRatio)
  return (2 * sqrtR) / (1 + priceRatio) - 1
}

/**
 * Calculate price impact for constant product AMM (x*y=k)
 * @param {number} amountIn - amount being traded
 * @param {number} reserveIn - reserve of input token
 * @param {number} fee - fee percentage (0.003 = 0.3%)
 * @returns {number} price impact as decimal
 */
export function priceImpact(amountIn, reserveIn, fee = 0.003) {
  const amountWithFee = amountIn * (1 - fee)
  return amountWithFee / (reserveIn + amountWithFee)
}

/**
 * Calculate output amount for constant product AMM
 * @param {number} amountIn
 * @param {number} reserveIn
 * @param {number} reserveOut
 * @param {number} fee - fee percentage (0.003 = 0.3%)
 * @returns {number} output amount
 */
export function getAmountOut(amountIn, reserveIn, reserveOut, fee = 0.003) {
  const amountWithFee = amountIn * (1 - fee)
  return (amountWithFee * reserveOut) / (reserveIn + amountWithFee)
}

/**
 * Convert APR to APY given compounding frequency
 * @param {number} apr - annual percentage rate as decimal
 * @param {number} n - compounding periods per year
 * @returns {number} APY as decimal
 */
export function aprToApy(apr, n = 365) {
  return Math.pow(1 + apr / n, n) - 1
}

/**
 * Calculate LP token value
 * @param {number} totalSupply - total LP supply
 * @param {number} reserve0 - reserve of token 0
 * @param {number} reserve1 - reserve of token 1
 * @param {number} price0 - price of token 0 in USD
 * @param {number} price1 - price of token 1 in USD
 * @param {number} lpBalance - user's LP balance
 * @returns {object} { token0Amount, token1Amount, usdValue }
 */
export function lpTokenValue(totalSupply, reserve0, reserve1, price0, price1, lpBalance) {
  const share = lpBalance / totalSupply
  const token0Amount = reserve0 * share
  const token1Amount = reserve1 * share
  const usdValue = token0Amount * price0 + token1Amount * price1
  return { token0Amount, token1Amount, usdValue }
}

/**
 * Calculate minimum output with slippage tolerance
 * @param {number} amount
 * @param {number} slippage - tolerance as decimal (0.005 = 0.5%)
 * @returns {number}
 */
export function minOutput(amount, slippage = 0.005) {
  return amount * (1 - slippage)
}

/**
 * Estimate gas cost in USD
 * @param {number} gasUnits
 * @param {number} gasPriceGwei
 * @param {number} ethPriceUsd
 * @returns {number}
 */
export function gasCostUsd(gasUnits, gasPriceGwei, ethPriceUsd) {
  return (gasUnits * gasPriceGwei * 1e-9) * ethPriceUsd
}
