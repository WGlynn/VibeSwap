// ============ Trading — Autonomous DEX Trading on Base ============
//
// Executes swaps via Uniswap V3 on Base using the bot's hot wallet.
// All trades tracked in JSONL for P&L analysis that feeds into
// the self-improvement loop. Market performance = objective truth.
//
// Safety:
//   - Inherits wallet.js spending limits ($50/day, $20/tx)
//   - Slippage protection (1% default)
//   - Only WETH↔USDC pair (blue-chip, deep liquidity)
//   - All trades logged to data/trades.jsonl
//   - Wallet must be unlocked + router whitelisted
//
// "The market is the ultimate judge. You can't bullshit a P&L."
// ============

import { ethers } from 'ethers'
import { appendFile, readFile } from 'fs/promises'
import { join } from 'path'
import {
  sendTransaction,
  callContract,
  addToWhitelist,
  getWalletInfo,
} from './wallet.js'

// ============ Constants ============

const BASE_RPC = 'https://mainnet.base.org'
const provider = new ethers.JsonRpcProvider(BASE_RPC)

// Uniswap V3 on Base (canonical deployment)
const SWAP_ROUTER = '0x2626664c2603336E57B271c5C0b26F421741e481'
const QUOTER_V2 = '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a'

// Tokens
const TOKENS = {
  WETH: { address: '0x4200000000000000000000000000000000000006', decimals: 18, symbol: 'WETH' },
  USDC: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6, symbol: 'USDC' },
}

const FEE_TIER = 500        // 0.05% — WETH/USDC on Base (deepest liquidity)
const SLIPPAGE_BPS = 100    // 1%
const DATA_DIR = process.env.DATA_DIR || './data'
const TRADE_LOG = join(DATA_DIR, 'trades.jsonl')

// ============ ABI Fragments ============

const QUOTER_ABI = [
  'function quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
]

const ROUTER_ABI = [
  'function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)',
  'function multicall(uint256 deadline, bytes[] data) external payable returns (bytes[] results)',
  'function unwrapWETH9(uint256 amountMinimum, address recipient) external payable',
]

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address, uint256) returns (bool)',
  'function allowance(address, address) view returns (uint256)',
]

const quoterIface = new ethers.Interface(QUOTER_ABI)
const routerIface = new ethers.Interface(ROUTER_ABI)

// ============ State ============

let tradeCount = 0

// ============ Init ============

export async function initTrading() {
  try {
    const data = await readFile(TRADE_LOG, 'utf-8')
    tradeCount = data.trim().split('\n').filter(Boolean).length
    console.log(`[trading] Loaded ${tradeCount} historical trades`)
  } catch {
    console.log('[trading] No trade history — starting fresh')
  }
}

// ============ Setup (whitelist router) ============

export function setupTrading() {
  const result = addToWhitelist(SWAP_ROUTER)
  console.log('[trading] Uniswap SwapRouter02 whitelisted for Base')
  return { success: true, router: SWAP_ROUTER, ...result }
}

// ============ Price & Quotes ============

export async function getQuote(tokenIn, tokenOut, amountIn) {
  const calldata = quoterIface.encodeFunctionData('quoteExactInputSingle', [{
    tokenIn,
    tokenOut,
    amountIn,
    fee: FEE_TIER,
    sqrtPriceLimitX96: 0n,
  }])

  const result = await provider.call({ to: QUOTER_V2, data: calldata })
  const decoded = quoterIface.decodeFunctionResult('quoteExactInputSingle', result)
  return {
    amountOut: decoded[0],
    sqrtPriceX96After: decoded[1],
    gasEstimate: decoded[3],
  }
}

export async function getEthPrice() {
  try {
    const quote = await getQuote(
      TOKENS.WETH.address,
      TOKENS.USDC.address,
      ethers.parseEther('1')
    )
    return Number(quote.amountOut) / 1e6
  } catch (err) {
    console.warn(`[trading] Price fetch failed: ${err.message}`)
    return 0
  }
}

export async function getTokenBalance(tokenAddress, walletAddress) {
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider)
  return token.balanceOf(walletAddress)
}

// ============ Core: Swap ============

/**
 * Execute a swap on Uniswap V3 (Base).
 * @param {'buy'|'sell'} direction - 'buy' = USDC→ETH, 'sell' = ETH→USDC
 * @param {string|number} amount - Amount of ETH (sell) or USDC (buy)
 * @param {string} reasoning - Why this trade (logged for self-improvement)
 */
export async function swap(direction, amount, reasoning = '') {
  const walletInfo = getWalletInfo()
  if (!walletInfo.address) return { error: 'Wallet not initialized. Create or unlock first.' }
  if (walletInfo.locked) return { error: 'Wallet is locked. Unlock first.' }

  const walletAddress = walletInfo.address
  const ethPrice = await getEthPrice()
  if (!ethPrice) return { error: 'Could not fetch ETH price.' }

  if (direction === 'sell') {
    return sellEth(amount, walletAddress, ethPrice, reasoning)
  } else if (direction === 'buy') {
    return buyEth(amount, walletAddress, ethPrice, reasoning)
  }
  return { error: `Invalid direction: ${direction}. Use 'buy' or 'sell'.` }
}

// ============ ETH → USDC ============

async function sellEth(amountEth, walletAddress, ethPrice, reasoning) {
  const amountWei = ethers.parseEther(amountEth.toString())
  const usdValue = parseFloat(amountEth) * ethPrice

  // Quote
  const quote = await getQuote(TOKENS.WETH.address, TOKENS.USDC.address, amountWei)
  const minOut = quote.amountOut * BigInt(10000 - SLIPPAGE_BPS) / 10000n
  const expectedUsdc = Number(quote.amountOut) / 1e6

  // Encode swap inside multicall (deadline protection)
  const swapCalldata = routerIface.encodeFunctionData('exactInputSingle', [{
    tokenIn: TOKENS.WETH.address,
    tokenOut: TOKENS.USDC.address,
    fee: FEE_TIER,
    recipient: walletAddress,
    amountIn: amountWei,
    amountOutMinimum: minOut,
    sqrtPriceLimitX96: 0n,
  }])
  const deadline = Math.floor(Date.now() / 1000) + 120
  const data = routerIface.encodeFunctionData('multicall', [deadline, [swapCalldata]])

  // Execute
  const result = await sendTransaction({
    to: SWAP_ROUTER,
    value: amountEth.toString(),
    data,
    chain: 'base',
    usdValue,
  })

  if (result.error) return result

  const trade = {
    timestamp: new Date().toISOString(),
    direction: 'sell',
    tokenIn: 'ETH', tokenOut: 'USDC',
    amountIn: amountEth.toString(),
    amountOutExpected: expectedUsdc.toFixed(2),
    ethPrice, txHash: result.hash, reasoning,
  }
  await logTrade(trade)
  return { ...result, trade }
}

// ============ USDC → ETH ============

async function buyEth(amountUsdc, walletAddress, ethPrice, reasoning) {
  const usdcRaw = ethers.parseUnits(amountUsdc.toString(), 6)

  // Quote
  const quote = await getQuote(TOKENS.USDC.address, TOKENS.WETH.address, usdcRaw)
  const minEthOut = quote.amountOut * BigInt(10000 - SLIPPAGE_BPS) / 10000n
  const expectedEth = Number(quote.amountOut) / 1e18

  // Ensure USDC approved for router
  await ensureApproval(TOKENS.USDC.address, SWAP_ROUTER, usdcRaw, walletAddress)

  // Swap USDC → WETH (recipient = router, it holds WETH temporarily)
  const swapCalldata = routerIface.encodeFunctionData('exactInputSingle', [{
    tokenIn: TOKENS.USDC.address,
    tokenOut: TOKENS.WETH.address,
    fee: FEE_TIER,
    recipient: SWAP_ROUTER,
    amountIn: usdcRaw,
    amountOutMinimum: minEthOut,
    sqrtPriceLimitX96: 0n,
  }])

  // Unwrap WETH → ETH and send to wallet
  const unwrapCalldata = routerIface.encodeFunctionData('unwrapWETH9', [minEthOut, walletAddress])

  // Multicall: [swap, unwrap] with deadline
  const deadline = Math.floor(Date.now() / 1000) + 120
  const data = routerIface.encodeFunctionData('multicall', [deadline, [swapCalldata, unwrapCalldata]])

  const result = await sendTransaction({
    to: SWAP_ROUTER,
    data,
    chain: 'base',
    usdValue: parseFloat(amountUsdc),
  })

  if (result.error) return result

  const trade = {
    timestamp: new Date().toISOString(),
    direction: 'buy',
    tokenIn: 'USDC', tokenOut: 'ETH',
    amountIn: amountUsdc.toString(),
    amountOutExpected: expectedEth.toFixed(6),
    ethPrice, txHash: result.hash, reasoning,
  }
  await logTrade(trade)
  return { ...result, trade }
}

// ============ Approval ============

async function ensureApproval(tokenAddress, spender, amount, walletAddress) {
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider)
  const allowance = await token.allowance(walletAddress, spender)
  if (allowance >= amount) return { already: true }

  console.log(`[trading] Approving ${tokenAddress} for ${spender}`)
  return callContract({
    chain: 'base',
    contractAddress: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [spender, ethers.MaxUint256],
  })
}

// ============ Trade Journal ============

async function logTrade(trade) {
  try {
    await appendFile(TRADE_LOG, JSON.stringify(trade) + '\n')
    tradeCount++
    console.log(`[trading] Trade #${tradeCount}: ${trade.direction} ${trade.amountIn} ${trade.tokenIn} → ${trade.tokenOut}`)
  } catch (err) {
    console.warn(`[trading] Failed to log trade: ${err.message}`)
  }
}

export async function getTradeHistory(count = 20) {
  try {
    const data = await readFile(TRADE_LOG, 'utf-8')
    return data.trim().split('\n').filter(Boolean).map(l => JSON.parse(l)).slice(-count)
  } catch {
    return []
  }
}

// ============ P&L ============

export async function getPnL() {
  const trades = await getTradeHistory(1000)
  if (trades.length === 0) return { trades: 0, realized: 0, message: 'No trades yet.' }

  let totalEthBought = 0, totalUsdcSpent = 0
  let totalEthSold = 0, totalUsdcReceived = 0

  for (const t of trades) {
    if (t.direction === 'buy') {
      totalEthBought += parseFloat(t.amountOutExpected || 0)
      totalUsdcSpent += parseFloat(t.amountIn || 0)
    } else {
      totalEthSold += parseFloat(t.amountIn || 0)
      totalUsdcReceived += parseFloat(t.amountOutExpected || 0)
    }
  }

  const avgBuyPrice = totalEthBought > 0 ? totalUsdcSpent / totalEthBought : 0
  const avgSellPrice = totalEthSold > 0 ? totalUsdcReceived / totalEthSold : 0
  const currentPrice = await getEthPrice()
  const matchedEth = Math.min(totalEthBought, totalEthSold)
  const realizedPnl = matchedEth > 0 ? matchedEth * (avgSellPrice - avgBuyPrice) : 0
  const netEthPosition = totalEthBought - totalEthSold
  const unrealizedPnl = netEthPosition > 0 ? netEthPosition * (currentPrice - avgBuyPrice) : 0

  return {
    trades: trades.length,
    totalEthBought: totalEthBought.toFixed(6),
    totalEthSold: totalEthSold.toFixed(6),
    totalUsdcSpent: totalUsdcSpent.toFixed(2),
    totalUsdcReceived: totalUsdcReceived.toFixed(2),
    avgBuyPrice: avgBuyPrice.toFixed(2),
    avgSellPrice: avgSellPrice.toFixed(2),
    currentPrice: currentPrice.toFixed(2),
    netEthPosition: netEthPosition.toFixed(6),
    realizedPnl: realizedPnl.toFixed(2),
    unrealizedPnl: unrealizedPnl.toFixed(2),
    totalPnl: (realizedPnl + unrealizedPnl).toFixed(2),
  }
}

// ============ Portfolio Snapshot ============

export async function getPortfolio() {
  const walletInfo = getWalletInfo()
  if (!walletInfo.address) return { error: 'No wallet.' }

  const [ethBal, usdcBal, ethPrice] = await Promise.all([
    provider.getBalance(walletInfo.address),
    getTokenBalance(TOKENS.USDC.address, walletInfo.address),
    getEthPrice(),
  ])

  const ethAmount = Number(ethBal) / 1e18
  const usdcAmount = Number(usdcBal) / 1e6
  const totalUsd = ethAmount * ethPrice + usdcAmount

  return {
    address: walletInfo.address,
    eth: ethAmount.toFixed(6),
    usdc: usdcAmount.toFixed(2),
    ethPrice: ethPrice.toFixed(2),
    totalUsd: totalUsd.toFixed(2),
    locked: walletInfo.locked,
  }
}

// ============ LLM Tools ============

export const TRADING_TOOLS = [
  {
    name: 'trade_status',
    description: 'Get trading portfolio: ETH/USDC balances on Base, current ETH price, P&L from trade history. Use before making trade decisions.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'trade_quote',
    description: 'Get a Uniswap V3 quote for a potential ETH↔USDC swap on Base. Returns expected output amount.',
    input_schema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['buy', 'sell'], description: 'buy = USDC→ETH, sell = ETH→USDC' },
        amount: { type: 'string', description: 'Amount of ETH (sell) or USDC (buy)' },
      },
      required: ['direction', 'amount'],
    },
  },
  {
    name: 'trade_execute',
    description: 'Execute an ETH↔USDC swap on Uniswap V3 (Base). Requires wallet unlocked and router whitelisted. Spending limits enforced ($50/day, $20/tx). Always check trade_status first.',
    input_schema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['buy', 'sell'], description: 'buy = USDC→ETH, sell = ETH→USDC' },
        amount: { type: 'string', description: 'Amount of ETH (sell) or USDC (buy)' },
        reasoning: { type: 'string', description: 'Why you are making this trade — logged for self-improvement analysis' },
      },
      required: ['direction', 'amount', 'reasoning'],
    },
  },
]

export async function handleTradingTool(name, input) {
  switch (name) {
    case 'trade_status': {
      const [portfolio, pnl] = await Promise.all([getPortfolio(), getPnL()])
      return JSON.stringify({ portfolio, pnl })
    }
    case 'trade_quote': {
      const { direction, amount } = input
      if (direction === 'sell') {
        const quote = await getQuote(TOKENS.WETH.address, TOKENS.USDC.address, ethers.parseEther(amount))
        return JSON.stringify({ direction, amountIn: `${amount} ETH`, amountOut: `${(Number(quote.amountOut) / 1e6).toFixed(2)} USDC`, gasEstimate: quote.gasEstimate.toString() })
      } else {
        const quote = await getQuote(TOKENS.USDC.address, TOKENS.WETH.address, ethers.parseUnits(amount, 6))
        return JSON.stringify({ direction, amountIn: `${amount} USDC`, amountOut: `${(Number(quote.amountOut) / 1e18).toFixed(6)} ETH`, gasEstimate: quote.gasEstimate.toString() })
      }
    }
    case 'trade_execute': {
      return JSON.stringify(await swap(input.direction, input.amount, input.reasoning))
    }
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` })
  }
}

// ============ Telegram Formatting ============

export async function formatTradeStatus() {
  const portfolio = await getPortfolio()
  const pnl = await getPnL()

  if (portfolio.error) return `⚠️ ${portfolio.error}`

  let msg = `📊 Trading Portfolio (Base)\n`
  msg += `━━━━━━━━━━━━━━━━\n`
  msg += `ETH: ${portfolio.eth} ($${(parseFloat(portfolio.eth) * parseFloat(portfolio.ethPrice)).toFixed(2)})\n`
  msg += `USDC: $${portfolio.usdc}\n`
  msg += `Total: $${portfolio.totalUsd}\n`
  msg += `ETH Price: $${portfolio.ethPrice}\n`
  msg += `━━━━━━━━━━━━━━━━\n`

  if (pnl.trades > 0) {
    msg += `Trades: ${pnl.trades}\n`
    msg += `Realized P&L: $${pnl.realizedPnl}\n`
    msg += `Unrealized: $${pnl.unrealizedPnl}\n`
    msg += `Total P&L: $${pnl.totalPnl}\n`
  } else {
    msg += `No trades yet.\n`
  }

  msg += `Wallet: ${portfolio.locked ? '🔒 Locked' : '🔓 Unlocked'}`
  return msg
}
