import { useState, useCallback, useEffect, createContext, useContext } from 'react'
import { useWallet } from './useWallet'
import { useDeviceWallet } from './useDeviceWallet'
import { useCKBWallet } from './useCKBWallet'
import { ethers } from 'ethers'
import { isCKBChain, CKB_TOKENS, formatCKB } from '../utils/ckb-constants'

// ============ Initial Mock Balances ============
const INITIAL_BALANCES = {
  ETH: 2.5,
  USDC: 5000,
  USDT: 1000,
  WBTC: 0.15,
  ARB: 2500,
  OP: 1800,
}

// CKB mock balances for demo mode
const CKB_MOCK_BALANCES = {
  CKB: 50000,
  dCKB: 10000,
}

// ERC20 ABI for balance fetching
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
]

// Token addresses per chain
const TOKEN_ADDRESSES = {
  1: { // Ethereum Mainnet
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
  },
  8453: { // Base
    USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    USDT: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
  },
  42161: { // Arbitrum
    USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    WBTC: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
    ARB: '0x912CE59144191C1204E64559FE8253a0e49E6548',
  },
}

const BalanceContext = createContext(null)

export function BalanceProvider({ children }) {
  const { provider, account: externalAccount, chainId } = useWallet()
  const { address: deviceAddress } = useDeviceWallet()
  const { isConnected: isCKBConnected, chainId: ckbChainId, address: ckbAddress, balance: ckbBalance } = useCKBWallet()

  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isAnyWalletConnected = isExternalConnected || isDeviceConnected || isCKBConnected

  const isCKB = isCKBConnected && isCKBChain(ckbChainId)
  const account = isCKB ? ckbAddress : (externalAccount || deviceAddress)

  // Mock balances state (for demo mode ONLY — when no wallet connected)
  const [mockBalances, setMockBalances] = useState(INITIAL_BALANCES)

  // Real balances from blockchain
  const [realBalances, setRealBalances] = useState({})

  // Whether we're using real blockchain data
  const [isRealMode, setIsRealMode] = useState(false)

  // Loading state
  const [isLoading, setIsLoading] = useState(false)

  // Get a provider — use wallet provider if available, else fall back to public RPC
  const getProvider = useCallback(() => {
    if (provider) return provider
    // Fallback to public RPC for device wallets or when wallet provider isn't ready
    const rpcUrl = import.meta.env.VITE_RPC_URL || 'https://mainnet.base.org'
    try {
      return new ethers.JsonRpcProvider(rpcUrl)
    } catch {
      return null
    }
  }, [provider])

  // Fetch real balance for a token
  const fetchRealBalance = useCallback(async (symbol) => {
    const activeProvider = getProvider()
    if (!activeProvider || !account) return null

    try {
      if (symbol === 'ETH') {
        const balance = await activeProvider.getBalance(account)
        return parseFloat(ethers.formatEther(balance))
      }

      // Determine which chain to query token addresses for
      const activeChainId = chainId || 8453 // Default to Base
      const addresses = TOKEN_ADDRESSES[activeChainId]
      if (!addresses || !addresses[symbol]) return null

      const token = new ethers.Contract(addresses[symbol], ERC20_ABI, activeProvider)
      const decimals = await token.decimals()
      const balance = await token.balanceOf(account)
      return parseFloat(ethers.formatUnits(balance, decimals))
    } catch (error) {
      console.error(`Error fetching ${symbol} balance:`, error)
      return null
    }
  }, [getProvider, account, chainId])

  // Fetch all real balances
  const fetchAllBalances = useCallback(async () => {
    if (!account) return
    const activeProvider = getProvider()
    if (!activeProvider) return

    setIsLoading(true)
    const balances = {}

    // Fetch ETH (native token)
    const ethBalance = await fetchRealBalance('ETH')
    if (ethBalance !== null) {
      balances.ETH = ethBalance
      setIsRealMode(true)
    }

    // Fetch ERC20 tokens
    const tokens = ['USDC', 'USDT', 'WBTC', 'ARB']
    for (const token of tokens) {
      const balance = await fetchRealBalance(token)
      if (balance !== null) {
        balances[token] = balance
      }
    }

    setRealBalances(balances)
    setIsLoading(false)
  }, [account, getProvider, fetchRealBalance])

  // Sync CKB balances when connected to CKB
  useEffect(() => {
    if (!isCKB) return
    if (ckbBalance !== null && ckbBalance !== undefined) {
      const parsed = typeof ckbBalance === 'string' ? parseFloat(ckbBalance) : ckbBalance
      setRealBalances(prev => ({ ...prev, CKB: parsed }))
      setIsRealMode(true)
    }
  }, [isCKB, ckbBalance])

  // Refresh balances when account changes (EVM only — works with both wallet types)
  useEffect(() => {
    if (isCKB) return // CKB balances come from useCKBWallet
    if (account) {
      fetchAllBalances()
    } else {
      setIsRealMode(false)
      setRealBalances({})
    }
  }, [account, fetchAllBalances, isCKB])

  // Get balance for a symbol
  const getBalance = useCallback((symbol) => {
    // Real balance available — always prefer
    if (realBalances[symbol] !== undefined) {
      return realBalances[symbol]
    }
    // Wallet connected but balance not fetched yet — show 0, NOT mock data
    if (isAnyWalletConnected) {
      return 0
    }
    // No wallet connected — demo mode, show mock balances
    if (isCKB && CKB_MOCK_BALANCES[symbol] !== undefined) {
      return CKB_MOCK_BALANCES[symbol]
    }
    return mockBalances[symbol] || 0
  }, [realBalances, mockBalances, isCKB, isAnyWalletConnected])

  // Get formatted balance string
  const getFormattedBalance = useCallback((symbol) => {
    const balance = getBalance(symbol)
    if (balance >= 1000) {
      return balance.toLocaleString('en-US', { maximumFractionDigits: 2 })
    }
    return balance.toFixed(balance < 1 ? 4 : 2)
  }, [getBalance])

  // Update mock balance (for demo transactions)
  const updateMockBalance = useCallback((symbol, delta) => {
    setMockBalances(prev => ({
      ...prev,
      [symbol]: Math.max(0, (prev[symbol] || 0) + delta)
    }))
  }, [])

  // Simulate a send transaction (decreases balance)
  const simulateSend = useCallback((symbol, amount) => {
    if (!isRealMode) {
      updateMockBalance(symbol, -parseFloat(amount))
    }
  }, [isRealMode, updateMockBalance])

  // Simulate a receive transaction (increases balance)
  const simulateReceive = useCallback((symbol, amount) => {
    if (!isRealMode) {
      updateMockBalance(symbol, parseFloat(amount))
    }
  }, [isRealMode, updateMockBalance])

  // Simulate a swap (decrease one, increase another)
  const simulateSwap = useCallback((fromSymbol, fromAmount, toSymbol, toAmount) => {
    if (!isRealMode) {
      setMockBalances(prev => ({
        ...prev,
        [fromSymbol]: Math.max(0, (prev[fromSymbol] || 0) - parseFloat(fromAmount)),
        [toSymbol]: (prev[toSymbol] || 0) + parseFloat(toAmount)
      }))
    }
  }, [isRealMode])

  // Refresh balances (for real mode)
  const refresh = useCallback(() => {
    if (isCKB) return // CKB balances auto-refresh via useCKBWallet
    if (account) {
      fetchAllBalances()
    }
  }, [account, fetchAllBalances, isCKB])

  const value = {
    getBalance,
    getFormattedBalance,
    simulateSend,
    simulateReceive,
    simulateSwap,
    updateMockBalance,
    refresh,
    isRealMode,
    isLoading,
    isCKB,
  }

  return (
    <BalanceContext.Provider value={value}>
      {children}
    </BalanceContext.Provider>
  )
}

export function useBalances() {
  const context = useContext(BalanceContext)
  if (!context) {
    throw new Error('useBalances must be used within a BalanceProvider')
  }
  return context
}
