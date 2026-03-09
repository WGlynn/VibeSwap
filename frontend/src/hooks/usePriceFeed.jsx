import { useState, useEffect, useCallback, useRef } from 'react'
import { api, PriceWebSocket } from '../services/api'

// ============ Price Feed — Backend API + WebSocket ============
// Primary: Backend REST API (server-side CoinGecko cache, no CORS issues)
// Real-time: WebSocket push (10s broadcast interval)
// Fallback: Direct CoinGecko (only if backend unreachable)
// Cache: localStorage (survives page reload, 5m stale TTL)

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
  JUL: null,
  VIBE: null,
}

const CACHE_KEY = 'vsos_price_cache'
const CACHE_TTL = 30_000
const STALE_TTL = 300_000
const WS_RECONNECT_DELAY = 5_000

function getCachedPrices() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const { prices, changes, timestamp } = JSON.parse(raw)
    const age = Date.now() - timestamp
    if (age < STALE_TTL) return { prices, changes, timestamp, isStale: age > CACHE_TTL }
    return null
  } catch {
    return null
  }
}

function setCachedPrices(prices, changes) {
  localStorage.setItem(CACHE_KEY, JSON.stringify({ prices, changes, timestamp: Date.now() }))
}

// ============ Backend API fetch ============
async function fetchFromBackend() {
  const result = await api.getPrices()
  const prices = {}
  const changes = {}

  for (const [symbol, data] of Object.entries(result.prices || {})) {
    prices[symbol] = data.price
    changes[symbol] = data.change24h || 0
  }

  return { prices, changes, source: 'backend' }
}

// ============ Direct CoinGecko fallback ============
async function fetchFromCoinGecko(symbols) {
  const ids = symbols.map(s => COINGECKO_IDS[s]).filter(Boolean)
  if (ids.length === 0) return null

  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_change=true`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`)

  const data = await res.json()
  const prices = {}
  const changes = {}

  for (const symbol of symbols) {
    const geckoId = COINGECKO_IDS[symbol]
    if (geckoId && data[geckoId]) {
      prices[symbol] = data[geckoId].usd
      changes[symbol] = data[geckoId].usd_24h_change || 0
    }
  }

  return { prices, changes, source: 'coingecko' }
}

// ============ Inject custom token placeholders ============
function injectCustomTokens(prices, changes, prevPrices) {
  // Stablecoins
  for (const stable of ['USDC', 'USDT', 'DAI']) {
    if (!prices[stable]) { prices[stable] = 1; changes[stable] = 0 }
  }
  // Custom tokens — placeholder until TruePriceOracle deployed
  if (!prices.JUL) { prices.JUL = prevPrices.JUL || 0.042; changes.JUL = 0 }
  if (!prices.VIBE) { prices.VIBE = prevPrices.VIBE || 0.85; changes.VIBE = 0 }
}

export function usePriceFeed(symbols = ['ETH', 'USDC', 'WBTC', 'ARB', 'OP']) {
  const [prices, setPrices] = useState(() => {
    const cached = getCachedPrices()
    return cached?.prices || {}
  })
  const [changes24h, setChanges24h] = useState(() => {
    const cached = getCachedPrices()
    return cached?.changes || {}
  })
  const [isLoading, setIsLoading] = useState(false)
  const [isStale, setIsStale] = useState(false)
  const [error, setError] = useState(null)
  const [source, setSource] = useState(null)
  const fetchRef = useRef(false)
  const wsRef = useRef(null)
  const pricesRef = useRef(prices)
  pricesRef.current = prices

  // ============ Fetch prices: backend → CoinGecko fallback ============
  const fetchPrices = useCallback(async () => {
    if (fetchRef.current) return
    fetchRef.current = true

    // Check cache
    const cached = getCachedPrices()
    if (cached && !cached.isStale) {
      setPrices(cached.prices)
      setChanges24h(cached.changes || {})
      setIsStale(false)
      fetchRef.current = false
      return
    }

    if (cached?.isStale) {
      setPrices(cached.prices)
      setChanges24h(cached.changes || {})
      setIsStale(true)
    }

    setIsLoading(true)
    setError(null)

    try {
      // Primary: backend API (server-side cached, no CORS)
      let result = null
      try {
        result = await fetchFromBackend()
      } catch {
        // Backend unreachable — fall back to direct CoinGecko
        result = await fetchFromCoinGecko(symbols)
      }

      if (result) {
        injectCustomTokens(result.prices, result.changes, pricesRef.current)
        setPrices(result.prices)
        setChanges24h(result.changes)
        setCachedPrices(result.prices, result.changes)
        setIsStale(false)
        setSource(result.source)
        window.__vibePriceCache = { ...window.__vibePriceCache, ...result.prices }
      }
    } catch (err) {
      console.error('[PriceFeed] Error:', err)
      setError(err.message)
    } finally {
      setIsLoading(false)
      fetchRef.current = false
    }
  }, [symbols.join(',')])

  // ============ WebSocket for real-time price pushes ============
  useEffect(() => {
    const ws = new PriceWebSocket((msg) => {
      if (msg.type === 'prices' && msg.data?.prices) {
        const newPrices = {}
        const newChanges = {}

        for (const [symbol, data] of Object.entries(msg.data.prices)) {
          newPrices[symbol] = data.price
          newChanges[symbol] = data.change24h || 0
        }

        injectCustomTokens(newPrices, newChanges, pricesRef.current)
        setPrices(newPrices)
        setChanges24h(newChanges)
        setCachedPrices(newPrices, newChanges)
        setIsStale(false)
        setSource('websocket')
        window.__vibePriceCache = { ...window.__vibePriceCache, ...newPrices }
      }
    })

    ws.connect()
    wsRef.current = ws

    return () => {
      ws.disconnect()
      wsRef.current = null
    }
  }, [])

  // ============ Polling fallback (if WebSocket disconnects) ============
  useEffect(() => {
    fetchPrices()
    const interval = setInterval(fetchPrices, CACHE_TTL)
    return () => clearInterval(interval)
  }, [fetchPrices])

  const getPrice = useCallback((symbol) => {
    return prices[symbol] || 0
  }, [prices])

  const getChange = useCallback((symbol) => {
    return changes24h[symbol] || 0
  }, [changes24h])

  const getRate = useCallback((from, to) => {
    const fromPrice = prices[from]
    const toPrice = prices[to]
    if (!fromPrice || !toPrice) return null
    return fromPrice / toPrice
  }, [prices])

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
    source,
    getPrice,
    getChange,
    getRate,
    formatUsd,
    refresh: fetchPrices,
  }
}
