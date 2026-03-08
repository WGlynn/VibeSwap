import { useState, useEffect, useCallback } from 'react'
import { ethers } from 'ethers'
import { useWallet } from './useWallet'

// ============ Real Gas Price Feed ============
// Fetches gas prices from the connected RPC or public endpoints.
// Falls back to public RPCs when no wallet connected.

const PUBLIC_RPCS = {
  1: 'https://eth.llamarpc.com',
  8453: 'https://mainnet.base.org',
  42161: 'https://arb1.arbitrum.io/rpc',
  10: 'https://mainnet.optimism.io',
  137: 'https://polygon-rpc.com',
}

const REFRESH_INTERVAL = 12_000 // 12 seconds (1 block)

export function useGasPrice() {
  const { provider, chainId } = useWallet()
  const [gasPrice, setGasPrice] = useState(null) // in gwei
  const [maxFeePerGas, setMaxFeePerGas] = useState(null)
  const [maxPriorityFee, setMaxPriorityFee] = useState(null)
  const [baseFee, setBaseFee] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [history, setHistory] = useState([]) // last 10 readings for trend

  const getProvider = useCallback(() => {
    if (provider) return provider
    const rpcUrl = PUBLIC_RPCS[chainId || 8453] || PUBLIC_RPCS[8453]
    try {
      return new ethers.JsonRpcProvider(rpcUrl)
    } catch {
      return null
    }
  }, [provider, chainId])

  const fetchGasPrice = useCallback(async () => {
    const p = getProvider()
    if (!p) return

    setIsLoading(true)
    try {
      const feeData = await p.getFeeData()

      const gasPriceGwei = feeData.gasPrice
        ? parseFloat(ethers.formatUnits(feeData.gasPrice, 'gwei'))
        : null

      const maxFeeGwei = feeData.maxFeePerGas
        ? parseFloat(ethers.formatUnits(feeData.maxFeePerGas, 'gwei'))
        : null

      const priorityGwei = feeData.maxPriorityFeePerGas
        ? parseFloat(ethers.formatUnits(feeData.maxPriorityFeePerGas, 'gwei'))
        : null

      setGasPrice(gasPriceGwei)
      setMaxFeePerGas(maxFeeGwei)
      setMaxPriorityFee(priorityGwei)

      // Base fee = maxFee - priorityFee (approximation)
      if (maxFeeGwei && priorityGwei) {
        setBaseFee(maxFeeGwei - priorityGwei)
      }

      // Track history for trend
      if (gasPriceGwei) {
        setHistory(prev => {
          const next = [...prev, { price: gasPriceGwei, timestamp: Date.now() }]
          return next.slice(-10)
        })
      }
    } catch (err) {
      console.error('[GasPrice] Fetch error:', err)
    } finally {
      setIsLoading(false)
    }
  }, [getProvider])

  useEffect(() => {
    fetchGasPrice()
    const interval = setInterval(fetchGasPrice, REFRESH_INTERVAL)
    return () => clearInterval(interval)
  }, [fetchGasPrice])

  // Gas trend: "increasing", "decreasing", or "stable"
  const trend = useCallback(() => {
    if (history.length < 3) return 'stable'
    const recent = history.slice(-3)
    const avg = recent.reduce((s, h) => s + h.price, 0) / recent.length
    const oldest = recent[0].price
    const diff = ((avg - oldest) / oldest) * 100
    if (diff > 5) return 'increasing'
    if (diff < -5) return 'decreasing'
    return 'stable'
  }, [history])

  // Estimate cost for a standard transfer (21,000 gas)
  const estimateTransferCost = useCallback((ethPrice = 2000) => {
    if (!gasPrice) return null
    const costEth = (gasPrice * 21000) / 1e9
    return {
      eth: costEth,
      usd: costEth * ethPrice,
    }
  }, [gasPrice])

  // Gas levels (slow/normal/fast/instant)
  const levels = useCallback(() => {
    const base = gasPrice || 10
    return [
      { label: 'slow', price: Math.round(base * 0.8), time: '~5 min' },
      { label: 'normal', price: Math.round(base), time: '~2 min' },
      { label: 'fast', price: Math.round(base * 1.2), time: '~30 sec' },
      { label: 'instant', price: Math.round(base * 1.5), time: '~15 sec' },
    ]
  }, [gasPrice])

  return {
    gasPrice,
    maxFeePerGas,
    maxPriorityFee,
    baseFee,
    isLoading,
    history,
    trend: trend(),
    levels: levels(),
    estimateTransferCost,
    refresh: fetchGasPrice,
  }
}
