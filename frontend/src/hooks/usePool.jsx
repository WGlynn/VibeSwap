import { useState, useEffect, useCallback, useMemo } from 'react'
import { ethers } from 'ethers'
import { useWallet } from './useWallet'
import { useDeviceWallet } from './useDeviceWallet'
import { useContracts } from './useContracts'
import { useCKBWallet } from './useCKBWallet'
import { useCKBContracts } from './useCKBContracts'
import { TOKENS, areContractsDeployed } from '../utils/constants'
import { isCKBChain, CKB_PRECISION } from '../utils/ckb-constants'
import toast from 'react-hot-toast'

// ============ Token Logo Map ============
// Maps token symbols to their display logos (emoji fallbacks for demo mode)
const TOKEN_LOGOS = {
  ETH: '\u27E0',
  WETH: '\u27E0',
  USDC: '\uD83D\uDCB5',
  USDT: '\uD83D\uDCB5',
  DAI: '\uD83D\uDCB5',
  WBTC: '\u20BF',
  ARB: '\uD83D\uDD35',
  OP: '\uD83D\uDD34',
  MATIC: '\uD83D\uDFEA',
  WMATIC: '\uD83D\uDFEA',
}

// ============ Launch Pool Data ============
// Real pools available on Base mainnet — values start at zero until liquidity is added
const LAUNCH_POOLS = [
  {
    id: '1',
    token0: { symbol: 'ETH', logo: '\u27E0' },
    token1: { symbol: 'USDC', logo: '\uD83D\uDCB5' },
    tvl: 0,
    volume24h: 0,
    fees24h: 0,
    apr: 0,
    myLiquidity: 0,
    myShare: '0%',
  },
  {
    id: '2',
    token0: { symbol: 'ETH', logo: '\u27E0' },
    token1: { symbol: 'DAI', logo: '\uD83D\uDCB5' },
    tvl: 0,
    volume24h: 0,
    fees24h: 0,
    apr: 0,
    myLiquidity: 0,
    myShare: '0%',
  },
]

// ============ Known Pool Token Pairs ============
// Token pairs we attempt to query on-chain. Each entry is [symbolA, symbolB].
// When PoolCreated event indexing is available we can discover pools dynamically;
// until then we enumerate the canonical pairs per chain.
const KNOWN_PAIRS = {
  1: [
    ['WETH', 'USDC'],
    ['WETH', 'WBTC'],
    ['USDC', 'DAI'],
    ['WETH', 'USDT'],
  ],
  42161: [
    ['WETH', 'USDC'],
    ['WETH', 'ARB'],
    ['USDC', 'USDT'],
  ],
  10: [
    ['WETH', 'USDC'],
    ['WETH', 'OP'],
    ['USDC', 'USDT'],
  ],
  8453: [
    ['WETH', 'USDC'],
    ['WETH', 'DAI'],
  ],
  137: [
    ['WMATIC', 'USDC'],
    ['WETH', 'USDC'],
    ['USDC', 'USDT'],
  ],
  // Testnets / local
  11155111: [['WETH', 'USDC']],
  421614: [['WETH', 'USDC']],
  31337: [['WETH', 'USDC']],
}

// ============ Rough USD Prices ============
// Used to compute TVL from reserves in demo/fallback scenarios.
// In production these should come from the oracle or a price feed.
// Approximate USD prices — used for TVL display only, not for trading
// These should be replaced with oracle price feeds in production
const USD_PRICES = {
  ETH: 2800,
  WETH: 2800,
  USDC: 1,
  USDT: 1,
  DAI: 1,
  WBTC: 96000,
  ARB: 0.50,
  OP: 1.60,
  MATIC: 0.35,
  WMATIC: 0.35,
}

// ERC20 minimal ABI for LP balance lookups
const ERC20_BALANCE_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function decimals() view returns (uint8)',
]

// ============ CKB Mock Pools ============
const CKB_LAUNCH_POOLS = [
  {
    id: 'ckb-pool-1',
    token0: { symbol: 'CKB', logo: '◎' },
    token1: { symbol: 'dCKB', logo: '◎' },
    tvl: 0,
    volume24h: 0,
    fees24h: 0,
    apr: 0,
    myLiquidity: 0,
    myShare: '0%',
  },
]

// ============ Hook: usePool ============
export function usePool() {
  const { chainId: evmChainId, provider, account: externalAccount } = useWallet()
  const { address: deviceAddress } = useDeviceWallet()
  const {
    contracts,
    isContractsDeployed: evmLive,
    addLiquidity: contractAddLiquidity,
    removeLiquidity: contractRemoveLiquidity,
  } = useContracts()

  // CKB hooks
  const { chainId: ckbChainId, isConnected: isCKBConnected } = useCKBWallet()
  const {
    poolStates: ckbPoolStates,
    fetchPoolState: ckbFetchPool,
    userLPPositions: ckbLPPositions,
    isLive: isCKBLive,
    isDemoMode: isCKBDemo,
  } = useCKBContracts()

  const isCKB = isCKBConnected && isCKBChain(ckbChainId)
  const chainId = isCKB ? ckbChainId : evmChainId
  const isLive = isCKB ? (isCKBLive || isCKBDemo) : evmLive
  const account = externalAccount || deviceAddress

  const [pools, setPools] = useState(LAUNCH_POOLS)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)

  // ---- Resolve token address from symbol on current chain ----
  const tokensBySymbol = useMemo(() => {
    if (isCKB) return {} // CKB tokens use type script hashes, not addresses
    const tokens = TOKENS[evmChainId] || []
    const map = {}
    for (const t of tokens) {
      map[t.symbol] = t
    }
    return map
  }, [isCKB, evmChainId])

  // ---- Fetch live pool data from contracts ----
  const fetchLivePools = useCallback(async () => {
    if (!contracts?.amm || !provider || !chainId) return null

    const pairs = KNOWN_PAIRS[chainId] || []
    if (pairs.length === 0) return null

    const results = []

    for (let i = 0; i < pairs.length; i++) {
      const [symA, symB] = pairs[i]
      const tokenA = tokensBySymbol[symA]
      const tokenB = tokensBySymbol[symB]
      if (!tokenA || !tokenB) continue

      try {
        // Get poolId from AMM
        const poolId = await contracts.amm.getPoolId(tokenA.address, tokenB.address)

        // Get pool struct
        const pool = await contracts.amm.getPool(poolId)
        if (!pool.initialized) continue

        // Parse reserves to human-readable numbers
        const decimals0 = tokenA.decimals
        const decimals1 = tokenB.decimals
        const reserve0Num = parseFloat(ethers.formatUnits(pool.reserve0, decimals0))
        const reserve1Num = parseFloat(ethers.formatUnits(pool.reserve1, decimals1))

        // Compute TVL using rough USD prices
        const price0 = USD_PRICES[symA] || 1
        const price1 = USD_PRICES[symB] || 1
        const tvl = reserve0Num * price0 + reserve1Num * price1

        // Fee rate from contract (basis points, e.g. 50 = 0.05%)
        const feeRateBps = Number(pool.feeRate)

        // Estimate 24h volume & fees (placeholder — real data requires event aggregation)
        // Use ~18% of TVL as a rough daily volume heuristic for now
        const volume24h = tvl * 0.18
        const fees24h = volume24h * (feeRateBps / 10000)
        const apr = tvl > 0 ? (fees24h * 365 / tvl) * 100 : 0

        // User LP position
        let myLiquidity = 0
        let myShare = '0%'

        if (account) {
          try {
            const lpTokenAddress = await contracts.amm.getLPToken(poolId)
            if (lpTokenAddress && lpTokenAddress !== ethers.ZeroAddress) {
              const lpToken = new ethers.Contract(lpTokenAddress, ERC20_BALANCE_ABI, provider)
              const [userBal, totalSupply] = await Promise.all([
                lpToken.balanceOf(account),
                lpToken.totalSupply(),
              ])

              if (totalSupply > 0n) {
                const shareRatio = Number(userBal) / Number(totalSupply)
                myLiquidity = shareRatio * tvl
                myShare = shareRatio > 0 ? `${(shareRatio * 100).toFixed(3)}%` : '0%'
              }
            }
          } catch (lpErr) {
            // LP token may not exist yet — not an error
            console.warn(`LP lookup failed for ${symA}/${symB}:`, lpErr.message)
          }
        }

        results.push({
          id: poolId,
          token0: { symbol: symA, logo: TOKEN_LOGOS[symA] || symA[0] },
          token1: { symbol: symB, logo: TOKEN_LOGOS[symB] || symB[0] },
          tvl,
          volume24h,
          fees24h,
          apr: Math.round(apr * 10) / 10,
          myLiquidity: Math.round(myLiquidity * 100) / 100,
          myShare,
        })
      } catch (err) {
        // Pool may not exist on-chain — skip silently
        console.warn(`Pool ${symA}/${symB} not found:`, err.message)
      }
    }

    return results.length > 0 ? results : null
  }, [contracts, provider, chainId, account, tokensBySymbol])

  // ---- Main data loading effect ----
  useEffect(() => {
    let cancelled = false

    const load = async () => {
      // CKB chain — use CKB pool data or CKB mock pools
      if (isCKB) {
        const ckbPools = Object.entries(ckbPoolStates).map(([pairId, pool]) => {
          const r0 = Number(pool.reserve0) / 1e18
          const r1 = Number(pool.reserve1) / 1e18
          const tvl = r0 * 0.012 + r1 * 0.012 // CKB price ~$0.012
          return {
            id: pairId,
            token0: { symbol: 'CKB', logo: '◎' },
            token1: { symbol: 'dCKB', logo: '◎' },
            tvl,
            volume24h: tvl * 0.18,
            fees24h: tvl * 0.18 * 0.0005,
            apr: tvl > 0 ? ((tvl * 0.18 * 0.0005 * 365) / tvl * 100) : 0,
            myLiquidity: 0,
            myShare: '0%',
          }
        })
        setPools(ckbPools.length > 0 ? ckbPools : CKB_LAUNCH_POOLS)
        setError(null)
        return
      }

      if (!isLive) {
        setPools(LAUNCH_POOLS)
        setError(null)
        return
      }

      setIsLoading(true)
      setError(null)

      try {
        const livePools = await fetchLivePools()
        if (!cancelled) {
          setPools(livePools || LAUNCH_POOLS)
        }
      } catch (err) {
        console.error('Failed to fetch pools:', err)
        if (!cancelled) {
          setError(err.message || 'Failed to load pools')
          setPools(LAUNCH_POOLS)
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [isLive, isCKB, fetchLivePools, ckbPoolStates])

  // ---- Refresh ----
  const refreshPools = useCallback(() => {
    // Re-trigger the effect by bumping a counter is one approach, but
    // since fetchLivePools is already a dep we can just call it directly.
    if (!isLive) return

    const refresh = async () => {
      setIsLoading(true)
      try {
        const livePools = await fetchLivePools()
        setPools(livePools || LAUNCH_POOLS)
      } catch (err) {
        console.error('Refresh failed:', err)
        setError(err.message)
      } finally {
        setIsLoading(false)
      }
    }
    refresh()
  }, [isLive, fetchLivePools])

  // ---- Add Liquidity ----
  const addLiquidity = useCallback(async ({ poolId, amount0, amount1 }) => {
    if (!isLive) {
      // Demo mode — simulate with toast
      toast.loading('Adding liquidity...', { id: 'add-liq' })
      await new Promise(r => setTimeout(r, 2000))
      toast.success('Liquidity added successfully!', { id: 'add-liq' })

      // Update mock pool data to reflect the deposit
      setPools(prev => prev.map(p => {
        if (p.id === poolId) {
          const depositValue = parseFloat(amount0 || 0) * (USD_PRICES[p.token0.symbol] || 1)
            + parseFloat(amount1 || 0) * (USD_PRICES[p.token1.symbol] || 1)
          return {
            ...p,
            tvl: p.tvl + depositValue,
            myLiquidity: p.myLiquidity + depositValue,
            myShare: p.tvl > 0
              ? `${(((p.myLiquidity + depositValue) / (p.tvl + depositValue)) * 100).toFixed(3)}%`
              : '100%',
          }
        }
        return p
      }))
      return { hash: '0xdemo' }
    }

    // Live mode — call through useContracts
    toast.loading('Adding liquidity...', { id: 'add-liq' })
    try {
      const result = await contractAddLiquidity({
        poolId,
        amount0,
        amount1,
      })
      toast.success('Liquidity added successfully!', { id: 'add-liq' })
      // Refresh pool data after successful tx
      refreshPools()
      return result
    } catch (err) {
      toast.error(err.message || 'Failed to add liquidity', { id: 'add-liq' })
      throw err
    }
  }, [isLive, contractAddLiquidity, refreshPools])

  // ---- Remove Liquidity ----
  const removeLiquidity = useCallback(async ({ poolId, liquidity }) => {
    if (!isLive) {
      // Demo mode
      toast.loading('Removing liquidity...', { id: 'rm-liq' })
      await new Promise(r => setTimeout(r, 2000))
      toast.success('Liquidity removed successfully!', { id: 'rm-liq' })

      setPools(prev => prev.map(p => {
        if (p.id === poolId) {
          const removeValue = parseFloat(liquidity || 0)
          return {
            ...p,
            tvl: Math.max(0, p.tvl - removeValue),
            myLiquidity: Math.max(0, p.myLiquidity - removeValue),
            myShare: (p.tvl - removeValue) > 0
              ? `${((Math.max(0, p.myLiquidity - removeValue) / Math.max(1, p.tvl - removeValue)) * 100).toFixed(3)}%`
              : '0%',
          }
        }
        return p
      }))
      return { hash: '0xdemo' }
    }

    // Live mode
    toast.loading('Removing liquidity...', { id: 'rm-liq' })
    try {
      const result = await contractRemoveLiquidity({ poolId, liquidity })
      toast.success('Liquidity removed successfully!', { id: 'rm-liq' })
      refreshPools()
      return result
    } catch (err) {
      toast.error(err.message || 'Failed to remove liquidity', { id: 'rm-liq' })
      throw err
    }
  }, [isLive, contractRemoveLiquidity, refreshPools])

  // ---- Aggregate Stats ----
  const totalTVL = useMemo(() => pools.reduce((sum, p) => sum + p.tvl, 0), [pools])
  const totalVolume24h = useMemo(() => pools.reduce((sum, p) => sum + p.volume24h, 0), [pools])
  const totalEarnings = useMemo(() => pools.reduce((sum, p) => sum + (p.myLiquidity > 0 ? p.fees24h * (parseFloat(p.myShare) / 100 || 0) : 0), 0), [pools])

  return {
    // State
    isLive,
    isCKB,
    pools,
    isLoading,
    error,

    // Actions
    addLiquidity,
    removeLiquidity,
    refreshPools,

    // Stats
    totalTVL,
    totalVolume24h,
    totalEarnings,
  }
}

export default usePool
