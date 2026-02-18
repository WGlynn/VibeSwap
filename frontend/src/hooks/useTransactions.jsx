import { useState, useEffect, useCallback, createContext, useContext } from 'react'
import { useWallet } from './useWallet'

const TransactionsContext = createContext(null)

// Transaction types
const TX_TYPE = {
  SWAP_COMMIT: 'swap_commit',
  SWAP_REVEAL: 'swap_reveal',
  SWAP_SETTLED: 'swap_settled',
  ADD_LIQUIDITY: 'add_liquidity',
  REMOVE_LIQUIDITY: 'remove_liquidity',
  BRIDGE: 'bridge',
  CLAIM_REWARDS: 'claim_rewards',
}

// Transaction status
const TX_STATUS = {
  PENDING: 'pending',
  CONFIRMING: 'confirming',
  COMPLETED: 'completed',
  FAILED: 'failed',
}

const STORAGE_KEY = 'vibeswap_transactions'
const MAX_TRANSACTIONS = 100

// ============ localStorage Helpers ============

function loadTransactions(account) {
  if (!account) return []

  try {
    const stored = localStorage.getItem(`${STORAGE_KEY}_${account.toLowerCase()}`)
    if (!stored) return []

    const parsed = JSON.parse(stored)

    // Guard against corrupted data — must be an array
    if (!Array.isArray(parsed)) {
      console.warn('Corrupted transaction data in localStorage, starting fresh')
      localStorage.removeItem(`${STORAGE_KEY}_${account.toLowerCase()}`)
      return []
    }

    // Trim to max limit (oldest get dropped)
    return parsed.slice(0, MAX_TRANSACTIONS)
  } catch (error) {
    // JSON parse failure or any other error — start fresh
    console.error('Failed to load transactions from localStorage:', error)
    try {
      localStorage.removeItem(`${STORAGE_KEY}_${account.toLowerCase()}`)
    } catch (_) {
      // localStorage itself may be unavailable — nothing we can do
    }
    return []
  }
}

function saveTransactions(account, transactions) {
  if (!account) return

  try {
    const trimmed = transactions.slice(0, MAX_TRANSACTIONS)
    localStorage.setItem(
      `${STORAGE_KEY}_${account.toLowerCase()}`,
      JSON.stringify(trimmed)
    )
  } catch (error) {
    // localStorage may be full or unavailable — log but don't crash
    console.error('Failed to save transactions to localStorage:', error)
  }
}

export function TransactionsProvider({ children }) {
  const { account, chainId } = useWallet()
  const [transactions, setTransactions] = useState([])
  const [pendingCount, setPendingCount] = useState(0)

  // Load transactions from localStorage on mount/account change
  useEffect(() => {
    setTransactions(loadTransactions(account))
  }, [account])

  // Save transactions to localStorage when they change
  useEffect(() => {
    if (!account) return
    saveTransactions(account, transactions)
  }, [transactions, account])

  // Update pending count
  useEffect(() => {
    const pending = transactions.filter(
      tx => tx.status === TX_STATUS.PENDING || tx.status === TX_STATUS.CONFIRMING
    ).length
    setPendingCount(pending)
  }, [transactions])

  // Add a new transaction
  const addTransaction = useCallback((tx) => {
    const newTx = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      status: TX_STATUS.PENDING,
      chainId,
      ...tx,
    }

    setTransactions(prev => [newTx, ...prev].slice(0, MAX_TRANSACTIONS))
    return newTx.id
  }, [chainId])

  // Update transaction status
  const updateTransaction = useCallback((id, updates) => {
    setTransactions(prev =>
      prev.map(tx =>
        tx.id === id ? { ...tx, ...updates, updatedAt: Date.now() } : tx
      )
    )
  }, [])

  // Update transaction by hash
  const updateTransactionByHash = useCallback((hash, updates) => {
    setTransactions(prev =>
      prev.map(tx =>
        tx.hash === hash ? { ...tx, ...updates, updatedAt: Date.now() } : tx
      )
    )
  }, [])

  // Get transaction by ID
  const getTransaction = useCallback((id) => {
    return transactions.find(tx => tx.id === id)
  }, [transactions])

  // Clear old transactions (keep last 50)
  const clearOldTransactions = useCallback(() => {
    setTransactions(prev => prev.slice(0, 50))
  }, [])

  // Clear all transactions
  const clearAllTransactions = useCallback(() => {
    setTransactions([])
    if (account) {
      localStorage.removeItem(`${STORAGE_KEY}_${account.toLowerCase()}`)
    }
  }, [account])

  // Helper: Add swap commit transaction
  const addSwapCommit = useCallback((data) => {
    return addTransaction({
      type: TX_TYPE.SWAP_COMMIT,
      tokenIn: data.tokenIn,
      tokenOut: data.tokenOut,
      amountIn: data.amountIn,
      amountOutExpected: data.amountOut,
      batchId: data.batchId,
      commitHash: data.commitHash,
      priorityBid: data.priorityBid,
    })
  }, [addTransaction])

  // Helper: Update swap to revealed
  const updateSwapRevealed = useCallback((id, data) => {
    updateTransaction(id, {
      type: TX_TYPE.SWAP_REVEAL,
      status: TX_STATUS.CONFIRMING,
      revealHash: data.hash,
      revealedAt: Date.now(),
    })
  }, [updateTransaction])

  // Helper: Update swap to settled
  const updateSwapSettled = useCallback((id, data) => {
    updateTransaction(id, {
      type: TX_TYPE.SWAP_SETTLED,
      status: TX_STATUS.COMPLETED,
      amountOut: data.amountOut,
      clearingPrice: data.clearingPrice,
      executionPosition: data.executionPosition,
      mevSaved: data.mevSaved,
      settledAt: Date.now(),
    })
  }, [updateTransaction])

  // Helper: Add liquidity transaction
  const addLiquidityTx = useCallback((data) => {
    return addTransaction({
      type: TX_TYPE.ADD_LIQUIDITY,
      pool: data.pool,
      token0: data.token0,
      token1: data.token1,
      amount0: data.amount0,
      amount1: data.amount1,
      hash: data.hash,
    })
  }, [addTransaction])

  // Helper: Add remove liquidity transaction
  const addRemoveLiquidityTx = useCallback((data) => {
    return addTransaction({
      type: TX_TYPE.REMOVE_LIQUIDITY,
      pool: data.pool,
      token0: data.token0,
      token1: data.token1,
      liquidity: data.liquidity,
      hash: data.hash,
    })
  }, [addTransaction])

  // Helper: Add bridge transaction
  const addBridgeTx = useCallback((data) => {
    return addTransaction({
      type: TX_TYPE.BRIDGE,
      token: data.token,
      amount: data.amount,
      fromChain: data.fromChain,
      toChain: data.toChain,
      hash: data.hash,
    })
  }, [addTransaction])

  // Filter transactions by type
  const getSwapTransactions = useCallback(() => {
    return transactions.filter(tx =>
      tx.type === TX_TYPE.SWAP_COMMIT ||
      tx.type === TX_TYPE.SWAP_REVEAL ||
      tx.type === TX_TYPE.SWAP_SETTLED
    )
  }, [transactions])

  const getLiquidityTransactions = useCallback(() => {
    return transactions.filter(tx =>
      tx.type === TX_TYPE.ADD_LIQUIDITY ||
      tx.type === TX_TYPE.REMOVE_LIQUIDITY
    )
  }, [transactions])

  const getBridgeTransactions = useCallback(() => {
    return transactions.filter(tx => tx.type === TX_TYPE.BRIDGE)
  }, [transactions])

  const getPendingTransactions = useCallback(() => {
    return transactions.filter(tx =>
      tx.status === TX_STATUS.PENDING ||
      tx.status === TX_STATUS.CONFIRMING
    )
  }, [transactions])

  const value = {
    transactions,
    pendingCount,

    // Core actions
    addTransaction,
    updateTransaction,
    updateTransactionByHash,
    getTransaction,
    clearOldTransactions,
    clearAllTransactions,

    // Helpers
    addSwapCommit,
    updateSwapRevealed,
    updateSwapSettled,
    addLiquidityTx,
    addRemoveLiquidityTx,
    addBridgeTx,

    // Filters
    getSwapTransactions,
    getLiquidityTransactions,
    getBridgeTransactions,
    getPendingTransactions,

    // Constants
    TX_TYPE,
    TX_STATUS,
  }

  return (
    <TransactionsContext.Provider value={value}>
      {children}
    </TransactionsContext.Provider>
  )
}

export function useTransactions() {
  const context = useContext(TransactionsContext)
  if (!context) {
    throw new Error('useTransactions must be used within a TransactionsProvider')
  }
  return context
}

export { TX_TYPE, TX_STATUS }
export default useTransactions
