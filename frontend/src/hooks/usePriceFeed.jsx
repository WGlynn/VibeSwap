import { useState, useEffect, useCallback, useRef } from 'react'

// ============ Real Price Feed — CoinGecko Free API ============
// No API key needed. Rate limit: 10-30 calls/min on free tier.
// Caches aggressively to avoid rate limits.

const COINGECKO_IDS = {
  ETH: 'ethereum',
  WBTC: 'wrapped-bitcoin',
  BTC: 'bitcoin',
  USDC: 'usd-coin',
  USDT: 'tether',
  DAI: 'dai',
  ARB: 'arbitrum',
  OP: 'optimism',
  SOL: 'solana',
  LINK: 'chainlink',
  MATIC: 'matic-network',
  JUL: null, // Not on CoinGecko — derive from on-chain
  VIBE: null,
}

const CACHE_KEY = 'vsos_price_cache'
const CACHE_TTL = 30_000 // 30 seconds
const STALE_TTL = 300_000 // 5 minutes — show stale data rather than nothing

function getCachedPrices() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const { prices, timestamp } = JSON.parse(raw)
    const age = Date.now() - timestamp
    if (age < STALE_TTL) return { prices, timestamp, isStale: age > CACHE_TTL }
    return null
  } catch {
    return null
  }
}

function setCachedPrices(prices) {
  localStorage.setItem(CACHE_KEY, JSON.stringify({ prices, timestamp: Date.now() }))
}

export function usePriceFeed(symbols = ['ETH', 'USDC', 'WBTC', 'ARB', 'OP']) {
  const [prices, setPrices] = useState(() => {
    const cached = getCachedPrices()
    return cached?.prices || {}
  })
  const [changes24h, setChanges24h] = useState({})
  const [isLoading, setIsLoading] = useState(false)
  const [isStale, setIsStale] = useState(false)
  const [error, setError] = useState(null)
  const fetchRef = useRef(false)

  const fetchPrices = useCallback(async () => {
    // Prevent concurrent fetches
    if (fetchRef.current) return
    fetchRef.current = true

    // Check cache first
    const cached = getCachedPrices()
    if (cached && !cached.isStale) {
      setPrices(cached.prices)
      setIsStale(false)
      fetchRef.current = false
      return
    }

    // Show stale data while fetching fresh
    if (cached?.isStale) {
      setPrices(cached.prices)
      setIsStale(true)
    }

    const ids = symbols
      .map(s => COINGECKO_IDS[s])
      .filter(Boolean)

    if (ids.length === 0) {
      fetchRef.current = false
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`
      const res = await fetch(url)

      if (!res.ok) {
        if (res.status === 429) {
          // Rate limited — use cached data if available
          setError('Rate limited — using cached prices')
          fetchRef.current = false
          setIsLoading(false)
          return
        }
        throw new Error(`CoinGecko API error: ${res.status}`)
      }

      const data = await res.json()

      const newPrices = {}
      const newChanges = {}

      for (const symbol of symbols) {
        const geckoId = COINGECKO_IDS[symbol]
        if (geckoId && data[geckoId]) {
          newPrices[symbol] = data[geckoId].usd
          newChanges[symbol] = data[geckoId].usd_24h_change || 0
        } else if (symbol === 'USDC' || symbol === 'USDT' || symbol === 'DAI') {
          // Stablecoins — always $1
          newPrices[symbol] = 1
          newChanges[symbol] = 0
        }
      }

      // JUL/VIBE — not on CoinGecko, use placeholder from on-chain oracle
      // Will be replaced when TruePriceOracle is deployed
      if (symbols.includes('JUL') && !newPrices.JUL) {
        newPrices.JUL = prices.JUL || 0.042
        newChanges.JUL = 0
      }
      if (symbols.includes('VIBE') && !newPrices.VIBE) {
        newPrices.VIBE = prices.VIBE || 0.85
        newChanges.VIBE = 0
      }

      setPrices(newPrices)
      setChanges24h(newChanges)
      setCachedPrices(newPrices)
      setIsStale(false)
      // Publish to global cache for non-hook consumers (e.g. usePool TVL calculations)
      window.__vibePriceCache = { ...window.__vibePriceCache, ...newPrices }
    } catch (err) {
      console.error('[PriceFeed] Error:', err)
      setError(err.message)
    } finally {
      setIsLoading(false)
      fetchRef.current = false
    }
  }, [symbols.join(',')])

  // Auto-refresh every 30 seconds
  useEffect(() => {
    fetchPrices()
    const interval = setInterval(fetchPrices, CACHE_TTL)
    return () => clearInterval(interval)
  }, [fetchPrices])

  // Get price for a symbol
  const getPrice = useCallback((symbol) => {
    return prices[symbol] || 0
  }, [prices])

  // Get 24h change for a symbol
  const getChange = useCallback((symbol) => {
    return changes24h[symbol] || 0
  }, [changes24h])

  // Get exchange rate between two tokens
  const getRate = useCallback((from, to) => {
    const fromPrice = prices[from]
    const toPrice = prices[to]
    if (!fromPrice || !toPrice) return null
    return fromPrice / toPrice
  }, [prices])

  // Format USD value
  const formatUsd = useCallback((amount, symbol) => {
    const price = prices[symbol]
    if (!price || !amount) return null
    const value = parseFloat(amount) * price
    return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
  }, [prices])

  return {
    prices,
    changes24h,
    isLoading,
    isStale,
    error,
    getPrice,
    getChange,
    getRate,
    formatUsd,
    refresh: fetchPrices,
  }
}
