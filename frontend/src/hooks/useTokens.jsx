import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../services/api'
import { TOKENS } from '../utils/constants'

// ============ Token Registry — Backend API + Static Fallback ============
// Primary: Backend REST API (canonical source of truth)
// Fallback: Static TOKENS from constants.js (instant, no network required)
// Cache: localStorage (survives page reload, 5m stale TTL)

const CACHE_KEY = 'vsos_token_cache'
const CACHE_TTL = 300_000 // 5 minutes

function getCachedTokens() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const { tokens, timestamp } = JSON.parse(raw)
    const age = Date.now() - timestamp
    if (age < CACHE_TTL) return { tokens, fresh: true }
    // Return stale data but flag it for refresh
    if (age < CACHE_TTL * 6) return { tokens, fresh: false }
    return null
  } catch {
    return null
  }
}

function setCachedTokens(tokens) {
  localStorage.setItem(CACHE_KEY, JSON.stringify({ tokens, timestamp: Date.now() }))
}

export function useTokens() {
  const [tokens, setTokens] = useState(() => {
    const cached = getCachedTokens()
    return cached?.tokens || TOKENS
  })
  const [isLoading, setIsLoading] = useState(false)
  const [source, setSource] = useState('static')
  const fetchedRef = useRef(false)

  const fetchTokens = useCallback(async () => {
    // Check cache first
    const cached = getCachedTokens()
    if (cached?.fresh) {
      setTokens(cached.tokens)
      setSource('cache')
      return
    }

    setIsLoading(true)
    try {
      const result = await api.getTokens()
      if (result?.tokens && Object.keys(result.tokens).length > 0) {
        // Merge backend tokens with static — backend wins for shared chains,
        // static provides chains backend doesn't know about (CKB, testnets)
        const merged = { ...TOKENS }
        for (const [chainId, chainTokens] of Object.entries(result.tokens)) {
          merged[chainId] = chainTokens
        }
        setTokens(merged)
        setCachedTokens(merged)
        setSource('backend')
      }
    } catch (err) {
      console.warn('[useTokens] Backend unreachable, using static tokens:', err.message)
      // Keep current tokens (static fallback or stale cache)
      setSource('static')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!fetchedRef.current) {
      fetchedRef.current = true
      fetchTokens()
    }
  }, [fetchTokens])

  // Get tokens for a specific chain
  const getChainTokens = useCallback((chainId) => {
    return tokens[chainId] || []
  }, [tokens])

  // Find a token by symbol on a given chain
  const getToken = useCallback((chainId, symbol) => {
    const chainTokens = tokens[chainId] || []
    return chainTokens.find(t => t.symbol === symbol) || null
  }, [tokens])

  return {
    tokens,
    isLoading,
    source,
    getChainTokens,
    getToken,
    refresh: fetchTokens,
  }
}
