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

// Token addresses (mainnet)
const TOKEN_ADDRESSES = {
  1: {
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
  },
  42161: {
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

  const isCKB = isCKBConnected && isCKBChain(ckbChainId)
  const account = isCKB ? ckbAddress : (externalAccount || deviceAddress)

  // Mock balances state (for demo mode)
  const [mockBalances, setMockBalances] = useState(INITIAL_BALANCES)

  // Real balances from blockchain
  const [realBalances, setRealBalances] = useState({})

  // Whether we're using real blockchain data
  const [isRealMode, setIsRealMode] = useState(false)

  // Loading state
  const [isLoading, setIsLoading] = useState(false)

  // Fetch real balance for a token
  const fetchRealBalance = useCallback(async (symbol) => {
    if (!provider || !account) return null

    try {
      if (symbol === 'ETH') {
        const balance = await provider.getBalance(account)
        return parseFloat(ethers.formatEther(balance))
      }

      const addresses = TOKEN_ADDRESSES[chainId]
      if (!addresses || !addresses[symbol]) return null

      const token = new ethers.Contract(addresses[symbol], ERC20_ABI, provider)
      const decimals = await token.decimals()
      const balance = await token.balanceOf(account)
      return parseFloat(ethers.formatUnits(balance, decimals))
    } catch (error) {
      console.error(`Error fetching ${symbol} balance:`, error)
      return null
    }
  }, [provider, account, chainId])

  // Fetch all real balances
  const fetchAllBalances = useCallback(async () => {
    if (!provider || !account) return

    setIsLoading(true)
    const balances = {}

    // Fetch ETH
    const ethBalance = await fetchRealBalance('ETH')
    if (ethBalance !== null) {
      balances.ETH = ethBalance
      setIsRealMode(true)
    }

    // Fetch other tokens
    const tokens = ['USDC', 'USDT', 'WBTC', 'ARB']
    for (const token of tokens) {
      const balance = await fetchRealBalance(token)
      if (balance !== null) {
        balances[token] = balance
      }
    }

    setRealBalances(balances)
    setIsLoading(false)
  }, [provider, account, fetchRealBalance])

  // Sync CKB balances when connected to CKB
  useEffect(() => {
    if (!isCKB) return
    if (ckbBalance !== null && ckbBalance !== undefined) {
      const parsed = typeof ckbBalance === 'string' ? parseFloat(ckbBalance) : ckbBalance
      setRealBalances(prev => ({ ...prev, CKB: parsed }))
      setIsRealMode(true)
    }
  }, [isCKB, ckbBalance])

  // Refresh balances when account/provider changes (EVM only)
  useEffect(() => {
    if (isCKB) return // CKB balances come from useCKBWallet
    if (provider && account) {
      fetchAllBalances()
    } else {
      setIsRealMode(false)
      setRealBalances({})
    }
  }, [provider, account, fetchAllBalances, isCKB])

  // Get balance for a symbol
  const getBalance = useCallback((symbol) => {
    if (isRealMode && realBalances[symbol] !== undefined) {
      return realBalances[symbol]
    }
    // Use CKB mock balances when on CKB in demo mode
    if (isCKB && CKB_MOCK_BALANCES[symbol] !== undefined) {
      return CKB_MOCK_BALANCES[symbol]
    }
    return mockBalances[symbol] || 0
  }, [isRealMode, realBalances, mockBalances, isCKB])

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
    if (provider && account) {
      fetchAllBalances()
    }
  }, [provider, account, fetchAllBalances, isCKB])

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
