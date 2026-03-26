import { useState, useEffect, useCallback } from 'react'

// ============================================================
// useTokenPrice — Track token prices from global price cache
// Reads from window.__vibePriceCache (populated by usePriceFeed)
// Falls back to CoinGecko direct if cache empty
// ============================================================

const FALLBACK_PRICES = {
  ETH: { price: 3245.67, change: 2.34 },
  BTC: { price: 68432.10, change: 1.87 },
  USDC: { price: 1.00, change: 0.01 },
  USDT: { price: 1.00, change: -0.02 },
  DAI: { price: 1.00, change: 0.00 },
  JUL: { price: 0.042, change: 0 },
  VIBE: { price: 0.85, change: 0 },
}

const COINGECKO_IDS = {
  ETH: 'ethereum', BTC: 'bitcoin', WBTC: 'wrapped-bitcoin',
  USDC: 'usd-coin', USDT: 'tether', DAI: 'dai',
  ARB: 'arbitrum', OP: 'optimism', SOL: 'solana',
  LINK: 'chainlink', MATIC: 'matic-network',
}

export function useTokenPrice(symbol = 'ETH') {
  const [price, setPrice] = useState(null)
  const [change, setChange] = useState(0)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const upper = symbol?.toUpperCase()

    // 1. Try global price cache (populated by usePriceFeed WebSocket)
    const cache = window.__vibePriceCache
    if (cache?.[upper]) {
      setPrice(cache[upper])
      // Try localStorage for 24h change
      try {
        const stored = JSON.parse(localStorage.getItem('vsos_price_cache') || '{}')
        setChange(stored.changes?.[upper] || 0)
      } catch { /* ignore */ }
      setLoading(false)
      return
    }

    // 2. Try direct CoinGecko fetch for this token
    const geckoId = COINGECKO_IDS[upper]
    if (geckoId) {
      try {
        const res = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${geckoId}&vs_currencies=usd&include_24hr_change=true`
        )
        if (res.ok) {
          const data = await res.json()
          if (data[geckoId]) {
            setPrice(data[geckoId].usd)
            setChange(data[geckoId].usd_24h_change || 0)
            setLoading(false)
            return
          }
        }
      } catch { /* fall through to fallback */ }
    }

    // 3. Fallback to static prices (only for tokens without CoinGecko ID)
    const fb = FALLBACK_PRICES[upper]
    if (fb) {
      setPrice(fb.price)
      setChange(fb.change)
    } else {
      setPrice(null)
      setChange(0)
    }
    setLoading(false)
  }, [symbol])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 30000)
    return () => clearInterval(id)
  }, [refresh])

  return { price, change, loading, refresh }
}
