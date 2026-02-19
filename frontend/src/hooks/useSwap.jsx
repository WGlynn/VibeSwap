import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useWallet } from './useWallet'
import { useDeviceWallet } from './useDeviceWallet'
import { useContracts } from './useContracts'
import { useBalances } from './useBalances'
import { useCKBWallet } from './useCKBWallet'
import { useCKBContracts } from './useCKBContracts'
import { TOKENS as CHAIN_TOKENS, areContractsDeployed } from '../utils/constants'
import {
  isCKBChain, CKB_TOKENS, CKB_PRECISION, CKB_PHASES,
  formatTokenAmount, formatCKB,
} from '../utils/ckb-constants'
import { ethers } from 'ethers'

// ============================================================
// MOCK DATA — used when contracts are not deployed (demo mode)
// ============================================================
const MOCK_PRICES = {
  ETH: 2847.32,
  USDC: 1.00,
  USDT: 1.00,
  WBTC: 67432.10,
  ARB: 1.24,
}

const MOCK_BALANCES = {
  ETH: '2.5',
  USDC: '5,000',
  USDT: '1,000',
  WBTC: '0.15',
  ARB: '500',
}

const TOKEN_LOGOS = {
  ETH: '\u27E0',    // ⟠
  USDC: '$',
  USDT: '$',
  WBTC: '\u20BF',   // ₿
  ARB: '\u25C6',     // ◆
}

const TOKEN_NAMES = {
  ETH: 'Ethereum',
  USDC: 'USD Coin',
  USDT: 'Tether',
  WBTC: 'Bitcoin',
  ARB: 'Arbitrum',
}

// ============================================================
// SWAP STATES
// ============================================================
// idle → quoting → approving → committing → committed → revealing → settled
// Any state can transition to 'failed'

// ============================================================
// LOCALSTORAGE HELPERS for commit secrets
// ============================================================
function storeSecret(commitId, secret, batchId) {
  const key = `vibeswap_secret_${commitId}`
  localStorage.setItem(key, JSON.stringify({ secret, batchId, timestamp: Date.now() }))
}

function retrieveSecret(commitId) {
  const key = `vibeswap_secret_${commitId}`
  const raw = localStorage.getItem(key)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function clearSecret(commitId) {
  localStorage.removeItem(`vibeswap_secret_${commitId}`)
}

// ============================================================
// HOOK
// ============================================================
export function useSwap() {
  const { chainId: evmChainId, provider } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const {
    isContractsDeployed: contractsReady,
    commitSwap: contractCommitSwap,
    revealSwap: contractRevealSwap,
    getQuote: contractGetQuote,
    getTokenBalance: contractGetTokenBalance,
    getCurrentBatch,
    tokenAddresses,
  } = useContracts()

  const { getFormattedBalance, simulateSwap } = useBalances()

  // CKB hooks — always called (React rules), conditionally used
  const { chainId: ckbChainId, isConnected: isCKBConnected, formattedBalance: ckbBalance } = useCKBWallet()
  const {
    auctionState: ckbAuctionState,
    poolStates: ckbPoolStates,
    commitOrder: ckbCommitOrder,
    revealOrder: ckbRevealOrder,
    fetchPoolState: ckbFetchPool,
    isLive: isCKBLive,
    isDemoMode: isCKBDemo,
    formatTokenAmount: ckbFormatAmount,
  } = useCKBContracts()

  // Determine active chain
  const isCKB = isCKBConnected && isCKBChain(ckbChainId)
  const chainId = isCKB ? ckbChainId : evmChainId

  // ============ State ============
  const [swapState, setSwapState] = useState('idle')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [quote, setQuote] = useState(null)
  const [lastSettlement, setLastSettlement] = useState(null)
  const [liveBalances, setLiveBalances] = useState({}) // symbol → formatted string

  // Ref to track polling interval for reveal phase
  const revealPollRef = useRef(null)

  // ============ Derived ============
  const isLive = useMemo(() => {
    if (isCKB) return isCKBLive || isCKBDemo // CKB always has demo mode
    return areContractsDeployed(evmChainId)
  }, [isCKB, isCKBLive, isCKBDemo, evmChainId])

  // ============ Token list ============
  // In live mode, use chain-specific tokens from constants.js enriched with live balances.
  // In demo mode, build from MOCK data.
  // On CKB, use CKB_TOKENS from ckb-constants.
  const tokens = useMemo(() => {
    // CKB chain — use CKB token list
    if (isCKB) {
      const ckbTokenList = CKB_TOKENS[ckbChainId] || CKB_TOKENS['ckb-mainnet'] || []
      return ckbTokenList.map(t => ({
        symbol: t.symbol,
        name: t.name,
        logo: t.logo || t.symbol[0],
        price: MOCK_PRICES[t.symbol] || (t.symbol === 'CKB' ? 0.012 : 0),
        balance: t.isNative ? (ckbBalance || '0') : '0',
        address: t.typeHash,
        decimals: t.decimals,
        isCKB: true,
        isNative: t.isNative || false,
      }))
    }

    // EVM live mode
    if (isLive && evmChainId && CHAIN_TOKENS[evmChainId]) {
      return CHAIN_TOKENS[evmChainId].map(t => ({
        symbol: t.symbol,
        name: t.name,
        logo: TOKEN_LOGOS[t.symbol] || t.symbol[0],
        price: MOCK_PRICES[t.symbol] || 0,
        balance: liveBalances[t.symbol] || '0',
        address: t.address,
        decimals: t.decimals,
      }))
    }

    // Demo mode — static list
    return Object.keys(MOCK_PRICES).map(symbol => ({
      symbol,
      name: TOKEN_NAMES[symbol] || symbol,
      logo: TOKEN_LOGOS[symbol] || symbol[0],
      price: MOCK_PRICES[symbol],
      balance: getFormattedBalance(symbol) || MOCK_BALANCES[symbol],
      address: null,
      decimals: symbol === 'WBTC' ? 8 : (symbol === 'USDC' || symbol === 'USDT' ? 6 : 18),
    }))
  }, [isCKB, ckbChainId, ckbBalance, isLive, evmChainId, liveBalances, getFormattedBalance])

  // ============ Fetch live balances (EVM only — CKB uses useCKBWallet) ============
  useEffect(() => {
    if (!isLive || isCKB || !evmChainId || !CHAIN_TOKENS[evmChainId]) return

    let cancelled = false
    const fetchAll = async () => {
      const chainTokens = CHAIN_TOKENS[evmChainId]
      const results = {}

      for (const t of chainTokens) {
        try {
          const raw = await contractGetTokenBalance(t.address)
          if (raw !== null && !cancelled) {
            results[t.symbol] = parseFloat(ethers.formatUnits(raw, t.decimals)).toLocaleString(
              'en-US',
              { maximumFractionDigits: t.decimals <= 8 ? 4 : 6 }
            )
          }
        } catch {
          // silent — leave as '0'
        }
      }

      if (!cancelled) setLiveBalances(results)
    }

    fetchAll()
    // Refresh every 15 seconds
    const interval = setInterval(fetchAll, 15000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [isLive, isCKB, evmChainId, contractGetTokenBalance])

  // ============ getBalance ============
  const getBalance = useCallback((symbol) => {
    if (isLive && liveBalances[symbol]) {
      return liveBalances[symbol]
    }
    return getFormattedBalance(symbol) || MOCK_BALANCES[symbol] || '0'
  }, [isLive, liveBalances, getFormattedBalance])

  // ============ getQuote ============
  const fetchQuote = useCallback(async (fromSymbol, toSymbol, amountIn) => {
    if (!amountIn || isNaN(parseFloat(amountIn)) || parseFloat(amountIn) <= 0) {
      setQuote(null)
      return
    }

    const amount = parseFloat(amountIn)

    if (isCKB) {
      // CKB mode — compute from pool reserves or mock prices
      const poolPairId = ckbAuctionState?.pairId || null
      const pool = poolPairId ? ckbPoolStates[poolPairId] : null

      if (pool && pool.reserve0 > 0n && pool.reserve1 > 0n) {
        // Use AMM constant product: amountOut = reserve1 * amountIn / (reserve0 + amountIn)
        const amountInScaled = BigInt(Math.floor(amount * 1e18))
        const feeAdjusted = amountInScaled * 9995n / 10000n // 0.05% fee
        const numerator = pool.reserve1 * feeAdjusted
        const denominator = pool.reserve0 + feeAdjusted
        const amountOutScaled = numerator / denominator
        const amountOut = Number(amountOutScaled) / 1e18
        const rate = amountOut / amount
        const priceImpact = amount * (MOCK_PRICES[fromSymbol] || 0.012) > 1000 ? 0.15 : 0.02
        const fee = amount * 0.0005

        setQuote({ rate, amountOut, priceImpact, fee, savings: 0 })
      } else {
        // Fallback to mock prices for CKB demo
        const fromPrice = MOCK_PRICES[fromSymbol] || (fromSymbol === 'CKB' ? 0.012 : 1)
        const toPrice = MOCK_PRICES[toSymbol] || (toSymbol === 'CKB' ? 0.012 : 1)
        const rate = fromPrice / toPrice
        const amountOut = amount * rate
        const fee = amount * fromPrice * 0.0005

        setQuote({ rate, amountOut, priceImpact: 0.02, fee, savings: 0 })
      }
      return
    }

    if (isLive) {
      // EVM Live mode — query contract
      try {
        setSwapState('quoting')
        setError(null)

        const fromToken = CHAIN_TOKENS[evmChainId]?.find(t => t.symbol === fromSymbol)
        const toToken = CHAIN_TOKENS[evmChainId]?.find(t => t.symbol === toSymbol)
        if (!fromToken || !toToken) {
          setError('Token not found on this chain')
          setSwapState('idle')
          return
        }

        const amountInWei = ethers.parseUnits(amountIn.toString(), fromToken.decimals)
        const amountOutWei = await contractGetQuote(fromToken.address, toToken.address, amountInWei)

        if (amountOutWei) {
          const amountOut = parseFloat(ethers.formatUnits(amountOutWei, toToken.decimals))
          const rate = amountOut / amount
          const priceImpact = amount * (MOCK_PRICES[fromSymbol] || 1) > 10000 ? 0.15 : 0.02
          const fee = amount * 0.0005
          const uniswapCost = amount * (MOCK_PRICES[fromSymbol] || 1) * 0.008
          const vibeswapCost = fee * (MOCK_PRICES[fromSymbol] || 1)
          const savings = Math.max(0, uniswapCost - vibeswapCost)

          setQuote({
            rate,
            amountOut,
            priceImpact,
            fee,
            savings: savings > 0.01 ? savings : 0,
          })
        }

        setSwapState('idle')
      } catch (err) {
        console.error('Live quote failed:', err)
        setError('Failed to fetch quote')
        setSwapState('idle')
      }
    } else {
      // Demo mode — compute from mock prices
      const fromPrice = MOCK_PRICES[fromSymbol] || 1
      const toPrice = MOCK_PRICES[toSymbol] || 1
      const rate = fromPrice / toPrice
      const amountOut = amount * rate
      const dollarValue = amount * fromPrice
      const priceImpact = dollarValue > 10000 ? 0.15 : 0.02
      const vibeswapFee = 0.0005
      const uniswapFee = 0.003
      const mevSavings = 0.005
      const fee = dollarValue * vibeswapFee
      const uniswapCost = dollarValue * (uniswapFee + mevSavings)
      const savings = Math.max(0, uniswapCost - fee)

      setQuote({
        rate,
        amountOut,
        priceImpact,
        fee,
        savings: savings > 0.01 ? savings : 0,
      })
    }
  }, [isCKB, isLive, evmChainId, contractGetQuote, ckbAuctionState, ckbPoolStates])

  // ============ executeSwap ============
  const executeSwap = useCallback(async (fromToken, toToken, amountIn) => {
    if (!amountIn || parseFloat(amountIn) <= 0) {
      return { success: false, error: 'Invalid amount' }
    }

    setIsLoading(true)
    setError(null)

    if (isCKB) {
      // ========== CKB MODE: commit via cell creation → reveal via witness ==========
      try {
        setSwapState('committing')

        const amountInBig = BigInt(Math.floor(parseFloat(amountIn) * 1e18))
        const limitPrice = quote?.rate ? BigInt(Math.floor(quote.rate * 1e18)) : 0n

        const commitResult = await ckbCommitOrder({
          pairId: ckbAuctionState?.pairId || null,
          orderType: 0, // BUY
          amountIn: amountInBig,
          limitPrice,
        })

        setSwapState('committed')

        // CKB auto-reveal: wait for reveal phase then submit
        // In CKB, the miner aggregates reveals — user just needs to sign
        if (ckbAuctionState?.phase === CKB_PHASES.REVEAL) {
          setSwapState('revealing')
          await ckbRevealOrder({
            pairId: ckbAuctionState?.pairId || null,
            orderType: 0,
            amountIn: amountInBig,
            limitPrice,
          })
        }

        setSwapState('settled')

        const fromPrice = MOCK_PRICES[fromToken.symbol] || (fromToken.symbol === 'CKB' ? 0.012 : 1)
        const settlement = {
          amountOut: quote?.amountOut || 0,
          clearingPrice: quote?.rate || 0,
          mevSaved: (parseFloat(amountIn) * fromPrice * 0.005).toFixed(2),
          improvement: ((Math.random() * 0.3) + 0.1).toFixed(2),
          txHash: commitResult.txHash || commitResult.orderHash,
        }

        setLastSettlement(settlement)
        setIsLoading(false)
        return { success: true, ...settlement }
      } catch (err) {
        console.error('CKB swap failed:', err)
        setSwapState('failed')
        setError(err.message || 'CKB swap failed')
        setIsLoading(false)
        return { success: false, error: err.message }
      }
    } else if (isLive) {
      // ========== EVM LIVE MODE: commit → reveal → settle ==========
      try {
        setSwapState('approving')

        const fromChainToken = CHAIN_TOKENS[evmChainId]?.find(t => t.symbol === fromToken.symbol)
        const toChainToken = CHAIN_TOKENS[evmChainId]?.find(t => t.symbol === toToken.symbol)
        if (!fromChainToken || !toChainToken) {
          throw new Error('Token not found on this chain')
        }

        const amountInWei = ethers.parseUnits(amountIn.toString(), fromChainToken.decimals)
        const minAmountOut = 0

        setSwapState('committing')
        const commitResult = await contractCommitSwap({
          tokenIn: fromChainToken.address,
          tokenOut: toChainToken.address,
          amountIn: amountInWei,
          minAmountOut,
          deposit: fromChainToken.isNative ? amountInWei : 0,
        })

        storeSecret(commitResult.commitId, commitResult.secret, commitResult.batchId)
        setSwapState('committed')

        const revealResult = await waitAndReveal(commitResult.commitId, commitResult.secret)
        setSwapState('settled')

        const settlement = {
          amountOut: quote?.amountOut || 0,
          clearingPrice: quote?.rate || 0,
          mevSaved: (parseFloat(amountIn) * (MOCK_PRICES[fromToken.symbol] || 1) * 0.005).toFixed(2),
          improvement: ((Math.random() * 0.3) + 0.1).toFixed(2),
          txHash: commitResult.hash,
        }

        setLastSettlement(settlement)
        clearSecret(commitResult.commitId)

        setIsLoading(false)
        return { success: true, ...settlement }
      } catch (err) {
        console.error('Live swap failed:', err)
        setSwapState('failed')
        setError(err.message || 'Swap failed')
        setIsLoading(false)
        return { success: false, error: err.message }
      }
    } else {
      // ========== DEMO MODE: simulate with timeout ==========
      try {
        setSwapState('committing')
        await new Promise(r => setTimeout(r, 1200))

        setSwapState('committed')
        await new Promise(r => setTimeout(r, 800))

        setSwapState('settled')

        const fromPrice = MOCK_PRICES[fromToken.symbol] || fromToken.price || 1
        const toPrice = MOCK_PRICES[toToken.symbol] || toToken.price || 1
        const rate = fromPrice / toPrice
        const amountOut = parseFloat(amountIn) * rate
        const dollarValue = parseFloat(amountIn) * fromPrice
        const mevSaved = (dollarValue * 0.005).toFixed(2)
        const improvement = ((Math.random() * 0.3) + 0.1).toFixed(2)

        const settlement = {
          amountOut,
          clearingPrice: rate,
          mevSaved,
          improvement,
          txHash: null,
        }

        setLastSettlement(settlement)
        simulateSwap(fromToken.symbol, amountIn, toToken.symbol, amountOut.toString())

        setIsLoading(false)
        setSwapState('idle')
        return { success: true, ...settlement }
      } catch (err) {
        console.error('Demo swap failed:', err)
        setSwapState('failed')
        setError(err.message || 'Swap simulation failed')
        setIsLoading(false)
        return { success: false, error: err.message }
      }
    }
  }, [isCKB, isLive, evmChainId, contractCommitSwap, quote, simulateSwap, ckbCommitOrder, ckbRevealOrder, ckbAuctionState])

  // ============ waitAndReveal — poll batch phase, reveal when ready ============
  const waitAndReveal = useCallback(async (commitId, secret) => {
    // Poll every 500ms for reveal phase
    return new Promise((resolve, reject) => {
      let attempts = 0
      const maxAttempts = 40 // 20 seconds max wait

      const poll = async () => {
        attempts++
        if (attempts > maxAttempts) {
          reject(new Error('Timed out waiting for reveal phase'))
          return
        }

        try {
          const batch = await getCurrentBatch()
          if (!batch) {
            // Contract call failed, retry
            setTimeout(poll, 500)
            return
          }

          // phase 1 = REVEAL
          if (batch.phase === 1) {
            setSwapState('revealing')
            try {
              const result = await contractRevealSwap(commitId, 0)
              resolve(result)
            } catch (err) {
              reject(err)
            }
            return
          }

          // phase 2 = SETTLING (already past reveal)
          if (batch.phase === 2) {
            resolve({ hash: null }) // missed reveal window, settlement still processes
            return
          }

          // Still in COMMIT phase, wait
          setTimeout(poll, 500)
        } catch (err) {
          setTimeout(poll, 500)
        }
      }

      poll()
    })
  }, [getCurrentBatch, contractRevealSwap])

  // ============ resetSettlement ============
  const resetSettlement = useCallback(() => {
    setLastSettlement(null)
    setSwapState('idle')
    setError(null)
  }, [])

  // ============ Cleanup poll on unmount ============
  useEffect(() => {
    return () => {
      if (revealPollRef.current) {
        clearInterval(revealPollRef.current)
      }
    }
  }, [])

  return {
    // State
    isLive,
    isCKB,
    swapState,
    isLoading,
    error,

    // Token data
    tokens,
    getBalance,

    // Quote
    quote,
    getQuote: fetchQuote,

    // Actions
    executeSwap,

    // Settlement
    lastSettlement,
    resetSettlement,
  }
}

export default useSwap
