import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { api } from '../services/api'
import { SUPPORTED_CHAINS, LZ_ENDPOINTS } from '../utils/constants'

// ============ Chain Registry — Backend API + Static Fallback ============
// Primary: Backend REST API (canonical source of truth)
// Fallback: Static SUPPORTED_CHAINS from constants.js
// Cache: localStorage (5m TTL)
// RPC URLs: Always from frontend env vars (never served by backend)

const CACHE_KEY = 'vsos_chain_cache'
const CACHE_TTL = 300_000

// Frontend RPC URL map — overlaid onto backend chain data
const RPC_URLS = {
  1: import.meta.env.VITE_ETH_RPC_URL || 'https://eth.llamarpc.com',
  42161: import.meta.env.VITE_ARB_RPC_URL || 'https://arb1.arbitrum.io/rpc',
  10: import.meta.env.VITE_OP_RPC_URL || 'https://mainnet.optimism.io',
  8453: import.meta.env.VITE_BASE_RPC_URL || 'https://mainnet.base.org',
  137: import.meta.env.VITE_POLYGON_RPC_URL || 'https://polygon-rpc.com',
  11155111: import.meta.env.VITE_SEPOLIA_RPC_URL || 'https://rpc.sepolia.org',
  421614: import.meta.env.VITE_ARB_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc',
  'ckb-mainnet': import.meta.env.VITE_CKB_RPC_URL || 'https://mainnet.ckbapp.dev/rpc',
  'ckb-testnet': import.meta.env.VITE_CKB_TESTNET_RPC_URL || 'https://testnet.ckbapp.dev/rpc',
}

function getCachedChains() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const { chains, lzEndpoints, timestamp } = JSON.parse(raw)
    const age = Date.now() - timestamp
    if (age < CACHE_TTL) return { chains, lzEndpoints, fresh: true }
    if (age < CACHE_TTL * 6) return { chains, lzEndpoints, fresh: false }
    return null
  } catch {
    return null
  }
}

function setCachedChains(chains, lzEndpoints) {
  localStorage.setItem(CACHE_KEY, JSON.stringify({ chains, lzEndpoints, timestamp: Date.now() }))
}

// Overlay RPC URLs onto chain data
function enrichWithRpcUrls(chains) {
  return chains.map(c => ({
    ...c,
    rpcUrl: RPC_URLS[c.id] || c.rpcUrl || null,
  }))
}

export function useChains() {
  const [chains, setChains] = useState(() => {
    const cached = getCachedChains()
    return cached ? enrichWithRpcUrls(cached.chains) : SUPPORTED_CHAINS
  })
  const [lzEndpoints, setLzEndpoints] = useState(() => {
    const cached = getCachedChains()
    return cached?.lzEndpoints || LZ_ENDPOINTS
  })
  const [source, setSource] = useState('static')
  const fetchedRef = useRef(false)

  const fetchChains = useCallback(async () => {
    const cached = getCachedChains()
    if (cached?.fresh) {
      setChains(enrichWithRpcUrls(cached.chains))
      if (cached.lzEndpoints) setLzEndpoints(cached.lzEndpoints)
      setSource('cache')
      return
    }

    try {
      const result = await api.getChains()
      if (result?.chains?.length > 0) {
        const enriched = enrichWithRpcUrls(result.chains)
        setChains(enriched)
        if (result.lzEndpoints) setLzEndpoints(result.lzEndpoints)
        setCachedChains(result.chains, result.lzEndpoints || LZ_ENDPOINTS)
        setSource('backend')
      }
    } catch (err) {
      console.warn('[useChains] Backend unreachable, using static chains:', err.message)
      setSource('static')
    }
  }, [])

  useEffect(() => {
    if (!fetchedRef.current) {
      fetchedRef.current = true
      fetchChains()
    }
  }, [fetchChains])

  const getChainById = useCallback((chainId) => {
    return chains.find(c => c.id === chainId) || null
  }, [chains])

  const getMainnetChains = useMemo(() => {
    return chains.filter(c => !c.isTestnet)
  }, [chains])

  const getTestnetChains = useMemo(() => {
    return chains.filter(c => c.isTestnet)
  }, [chains])

  const getEVMChains = useMemo(() => {
    return chains.filter(c => !c.isCKB)
  }, [chains])

  const getCKBChains = useMemo(() => {
    return chains.filter(c => c.isCKB)
  }, [chains])

  const getLzEndpointId = useCallback((chainId) => {
    return lzEndpoints[chainId] || null
  }, [lzEndpoints])

  return {
    chains,
    lzEndpoints,
    source,
    getChainById,
    getMainnetChains,
    getTestnetChains,
    getEVMChains,
    getCKBChains,
    getLzEndpointId,
    refresh: fetchChains,
  }
}
