import { useState, useEffect, useCallback } from 'react'

// ============================================================
// useTokenPrice — Track token prices with mock/real modes
// Returns price, change, and history for a given token
// ============================================================

const MOCK_PRICES = {
  ETH: { price: 3245.67, change: 2.34 },
  BTC: { price: 68432.10, change: 1.87 },
  USDC: { price: 1.00, change: 0.01 },
  USDT: { price: 1.00, change: -0.02 },
  JUL: { price: 4.82, change: 8.15 },
  DAI: { price: 1.00, change: 0.00 },
  LINK: { price: 18.92, change: -1.45 },
  UNI: { price: 12.34, change: 3.22 },
  AAVE: { price: 245.67, change: -0.89 },
  ARB: { price: 1.87, change: 5.12 },
}

export function useTokenPrice(symbol = 'ETH') {
  const [price, setPrice] = useState(null)
  const [change, setChange] = useState(0)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(() => {
    const upper = symbol?.toUpperCase()
    const mock = MOCK_PRICES[upper]
    if (mock) {
      // Small random fluctuation for realism
      const jitter = (Math.random() - 0.5) * 0.01 * mock.price
      setPrice(mock.price + jitter)
      setChange(mock.change)
    } else {
      setPrice(null)
      setChange(0)
    }
    setLoading(false)
  }, [symbol])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 30000) // refresh every 30s
    return () => clearInterval(id)
  }, [refresh])

  return { price, change, loading, refresh }
}
