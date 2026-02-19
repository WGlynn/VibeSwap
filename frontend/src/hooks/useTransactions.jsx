import { useState, useEffect, useCallback, useRef, createContext, useContext } from 'react'
import { Contract } from 'ethers'
import { useWallet } from './useWallet'
import { useCKBWallet } from './useCKBWallet'
import { useCKBContracts } from './useCKBContracts'
import { CONTRACTS, areContractsDeployed } from '../utils/constants'
import { isCKBChain } from '../utils/ckb-constants'

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
const SYNC_BLOCK_KEY = 'vibeswap_last_sync_block'

// ============ On-Chain Event ABIs (stubs) ============
// These match the Solidity event signatures in our contracts.
// Wire up when contracts are deployed and CONTRACTS addresses are set.

const AUCTION_EVENTS = [
  'event OrderCommitted(address indexed user, bytes32 commitHash, uint256 indexed batchId, uint256 deposit)',
  'event OrderRevealed(address indexed user, uint256 indexed batchId, address tokenIn, address tokenOut, uint256 amountIn)',
  'event BatchSettled(uint256 indexed batchId, uint256 clearingPrice, uint256 totalVolume, uint256 orderCount)',
]

const AMM_EVENTS = [
  'event LiquidityAdded(address indexed provider, address indexed pool, uint256 amount0, uint256 amount1, uint256 liquidity)',
  'event LiquidityRemoved(address indexed provider, address indexed pool, uint256 amount0, uint256 amount1, uint256 liquidity)',
]

const ROUTER_EVENTS = [
  'event BridgeInitiated(address indexed sender, uint32 indexed dstChainId, address token, uint256 amount, bytes32 messageId)',
  'event BridgeCompleted(bytes32 indexed messageId, address indexed recipient, address token, uint256 amount)',
]

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

// ============ On-Chain Event → Transaction Mappers ============

function mapAuctionCommit(event) {
  return {
    id: `chain-${event.transactionHash}-${event.logIndex}`,
    type: TX_TYPE.SWAP_COMMIT,
    status: TX_STATUS.CONFIRMING,
    hash: event.transactionHash,
    blockNumber: event.blockNumber,
    timestamp: null, // filled by block timestamp lookup
    commitHash: event.args.commitHash,
    batchId: Number(event.args.batchId),
    deposit: event.args.deposit?.toString(),
    source: 'chain',
  }
}

function mapAuctionReveal(event) {
  return {
    id: `chain-${event.transactionHash}-${event.logIndex}`,
    type: TX_TYPE.SWAP_REVEAL,
    status: TX_STATUS.CONFIRMING,
    hash: event.transactionHash,
    blockNumber: event.blockNumber,
    timestamp: null,
    batchId: Number(event.args.batchId),
    tokenIn: event.args.tokenIn,
    tokenOut: event.args.tokenOut,
    amountIn: event.args.amountIn?.toString(),
    source: 'chain',
  }
}

function mapBatchSettled(event) {
  return {
    id: `chain-${event.transactionHash}-${event.logIndex}`,
    type: TX_TYPE.SWAP_SETTLED,
    status: TX_STATUS.COMPLETED,
    hash: event.transactionHash,
    blockNumber: event.blockNumber,
    timestamp: null,
    batchId: Number(event.args.batchId),
    clearingPrice: event.args.clearingPrice?.toString(),
    totalVolume: event.args.totalVolume?.toString(),
    orderCount: Number(event.args.orderCount),
    source: 'chain',
  }
}

function mapLiquidityAdded(event) {
  return {
    id: `chain-${event.transactionHash}-${event.logIndex}`,
    type: TX_TYPE.ADD_LIQUIDITY,
    status: TX_STATUS.COMPLETED,
    hash: event.transactionHash,
    blockNumber: event.blockNumber,
    timestamp: null,
    pool: event.args.pool,
    amount0: event.args.amount0?.toString(),
    amount1: event.args.amount1?.toString(),
    liquidity: event.args.liquidity?.toString(),
    source: 'chain',
  }
}

function mapLiquidityRemoved(event) {
  return {
    id: `chain-${event.transactionHash}-${event.logIndex}`,
    type: TX_TYPE.REMOVE_LIQUIDITY,
    status: TX_STATUS.COMPLETED,
    hash: event.transactionHash,
    blockNumber: event.blockNumber,
    timestamp: null,
    pool: event.args.pool,
    amount0: event.args.amount0?.toString(),
    amount1: event.args.amount1?.toString(),
    liquidity: event.args.liquidity?.toString(),
    source: 'chain',
  }
}

function mapBridgeInitiated(event) {
  return {
    id: `chain-${event.transactionHash}-${event.logIndex}`,
    type: TX_TYPE.BRIDGE,
    status: TX_STATUS.CONFIRMING,
    hash: event.transactionHash,
    blockNumber: event.blockNumber,
    timestamp: null,
    token: event.args.token,
    amount: event.args.amount?.toString(),
    toChain: Number(event.args.dstChainId),
    messageId: event.args.messageId,
    source: 'chain',
  }
}

// ============ Merge: localStorage + on-chain ============

function mergeTransactions(localTxs, chainTxs) {
  // On-chain is source of truth. Deduplicate by tx hash.
  // If a localStorage tx has the same hash as a chain tx, the chain version wins.
  const chainHashes = new Set(chainTxs.map(tx => tx.hash).filter(Boolean))

  const dedupedLocal = localTxs.filter(tx => {
    // Keep local txs that have no hash (pending, not yet submitted)
    if (!tx.hash) return true
    // Keep local txs whose hash isn't in the chain set
    return !chainHashes.has(tx.hash)
  })

  // Merge: chain txs first (newest), then remaining local txs
  const merged = [...chainTxs, ...dedupedLocal]

  // Sort by timestamp descending (newest first), nulls at top (pending)
  merged.sort((a, b) => {
    if (!a.timestamp && !b.timestamp) return 0
    if (!a.timestamp) return -1
    if (!b.timestamp) return 1
    return b.timestamp - a.timestamp
  })

  return merged.slice(0, MAX_TRANSACTIONS)
}

// ============ Fetch Events from Chain ============

async function fetchChainTransactions(provider, chainId, account) {
  if (!provider || !chainId || !account) return []
  if (!areContractsDeployed(chainId)) return []

  const contracts = CONTRACTS[chainId]
  const chainTxs = []

  // Determine block range: last synced block → latest
  const lastSyncKey = `${SYNC_BLOCK_KEY}_${chainId}_${account.toLowerCase()}`
  let fromBlock
  try {
    const stored = localStorage.getItem(lastSyncKey)
    fromBlock = stored ? Number(stored) + 1 : 'earliest'
  } catch {
    fromBlock = 'earliest'
  }

  try {
    // --- Auction events (CommitRevealAuction) ---
    if (contracts.auction) {
      const auction = new Contract(contracts.auction, AUCTION_EVENTS, provider)

      const [commits, reveals] = await Promise.all([
        auction.queryFilter(auction.filters.OrderCommitted(account), fromBlock),
        auction.queryFilter(auction.filters.OrderRevealed(account), fromBlock),
      ])

      commits.forEach(e => chainTxs.push(mapAuctionCommit(e)))
      reveals.forEach(e => chainTxs.push(mapAuctionReveal(e)))

      // BatchSettled is not indexed by user — fetch all and cross-reference
      // TODO: Once subgraph is live, query per-user settlements instead
    }

    // --- AMM events (VibeAMM) ---
    if (contracts.amm) {
      const amm = new Contract(contracts.amm, AMM_EVENTS, provider)

      const [adds, removes] = await Promise.all([
        amm.queryFilter(amm.filters.LiquidityAdded(account), fromBlock),
        amm.queryFilter(amm.filters.LiquidityRemoved(account), fromBlock),
      ])

      adds.forEach(e => chainTxs.push(mapLiquidityAdded(e)))
      removes.forEach(e => chainTxs.push(mapLiquidityRemoved(e)))
    }

    // --- Bridge events (CrossChainRouter) ---
    if (contracts.router) {
      const router = new Contract(contracts.router, ROUTER_EVENTS, provider)

      const bridges = await router.queryFilter(
        router.filters.BridgeInitiated(account),
        fromBlock
      )

      bridges.forEach(e => chainTxs.push(mapBridgeInitiated(e)))
    }

    // Backfill block timestamps for all fetched events
    if (chainTxs.length > 0) {
      const uniqueBlocks = [...new Set(chainTxs.map(tx => tx.blockNumber))]
      const blockTimestamps = {}

      // Batch block lookups (cap at 20 to avoid RPC rate limits)
      const blocksToFetch = uniqueBlocks.slice(0, 20)
      const blockResults = await Promise.all(
        blocksToFetch.map(bn => provider.getBlock(bn).catch(() => null))
      )
      blocksToFetch.forEach((bn, i) => {
        if (blockResults[i]) blockTimestamps[bn] = blockResults[i].timestamp * 1000
      })

      chainTxs.forEach(tx => {
        tx.timestamp = blockTimestamps[tx.blockNumber] || Date.now()
      })

      // Update last synced block
      const maxBlock = Math.max(...chainTxs.map(tx => tx.blockNumber))
      try {
        localStorage.setItem(lastSyncKey, String(maxBlock))
      } catch {
        // localStorage unavailable
      }
    }
  } catch (error) {
    console.error('Failed to fetch on-chain transactions:', error)
  }

  return chainTxs
}

// ============ Subscribe to Live Events ============

function subscribeToEvents(provider, chainId, account, onNewTx) {
  if (!provider || !chainId || !account) return () => {}
  if (!areContractsDeployed(chainId)) return () => {}

  const contracts = CONTRACTS[chainId]
  const cleanups = []

  try {
    if (contracts.auction) {
      const auction = new Contract(contracts.auction, AUCTION_EVENTS, provider)

      const onCommit = (...args) => {
        const event = args[args.length - 1]
        onNewTx(mapAuctionCommit(event))
      }
      const onReveal = (...args) => {
        const event = args[args.length - 1]
        onNewTx(mapAuctionReveal(event))
      }

      auction.on(auction.filters.OrderCommitted(account), onCommit)
      auction.on(auction.filters.OrderRevealed(account), onReveal)

      cleanups.push(() => {
        auction.off(auction.filters.OrderCommitted(account), onCommit)
        auction.off(auction.filters.OrderRevealed(account), onReveal)
      })
    }

    if (contracts.amm) {
      const amm = new Contract(contracts.amm, AMM_EVENTS, provider)

      const onAdd = (...args) => {
        const event = args[args.length - 1]
        onNewTx(mapLiquidityAdded(event))
      }
      const onRemove = (...args) => {
        const event = args[args.length - 1]
        onNewTx(mapLiquidityRemoved(event))
      }

      amm.on(amm.filters.LiquidityAdded(account), onAdd)
      amm.on(amm.filters.LiquidityRemoved(account), onRemove)

      cleanups.push(() => {
        amm.off(amm.filters.LiquidityAdded(account), onAdd)
        amm.off(amm.filters.LiquidityRemoved(account), onRemove)
      })
    }

    if (contracts.router) {
      const router = new Contract(contracts.router, ROUTER_EVENTS, provider)

      const onBridge = (...args) => {
        const event = args[args.length - 1]
        onNewTx(mapBridgeInitiated(event))
      }

      router.on(router.filters.BridgeInitiated(account), onBridge)

      cleanups.push(() => {
        router.off(router.filters.BridgeInitiated(account), onBridge)
      })
    }
  } catch (error) {
    console.error('Failed to subscribe to contract events:', error)
  }

  // Return cleanup function that unsubscribes all listeners
  return () => cleanups.forEach(fn => fn())
}

export function TransactionsProvider({ children }) {
  const { account, chainId, provider } = useWallet()
  const { isConnected: isCKBConnected, chainId: ckbChainId, address: ckbAddress } = useCKBWallet()
  const { auctionState: ckbAuctionState } = useCKBContracts()

  const isCKB = isCKBConnected && isCKBChain(ckbChainId)
  const activeAccount = isCKB ? ckbAddress : account
  const activeChainId = isCKB ? ckbChainId : chainId

  const [transactions, setTransactions] = useState([])
  const [pendingCount, setPendingCount] = useState(0)
  const [isSyncing, setIsSyncing] = useState(false)
  const hasSyncedRef = useRef(false)

  // Load transactions from localStorage on mount/account change
  useEffect(() => {
    setTransactions(loadTransactions(activeAccount))
    hasSyncedRef.current = false // reset sync flag on account change
  }, [activeAccount])

  // Save transactions to localStorage when they change
  useEffect(() => {
    if (!activeAccount) return
    saveTransactions(activeAccount, transactions)
  }, [transactions, activeAccount])

  // ============ On-Chain Sync (runs once per account+chain — EVM only) ============
  useEffect(() => {
    if (isCKB) return // CKB txs tracked via localStorage only (no event queries)
    if (!provider || !chainId || !account) return
    if (!areContractsDeployed(chainId)) return
    if (hasSyncedRef.current) return

    hasSyncedRef.current = true
    setIsSyncing(true)

    fetchChainTransactions(provider, chainId, account)
      .then(chainTxs => {
        if (chainTxs.length > 0) {
          setTransactions(prev => mergeTransactions(prev, chainTxs))
        }
      })
      .finally(() => setIsSyncing(false))
  }, [provider, chainId, account, isCKB])

  // ============ Live Event Subscription (EVM only) ============
  useEffect(() => {
    if (isCKB) return () => {} // CKB doesn't use ethers event subscriptions
    if (!provider || !chainId || !account) return () => {}
    if (!areContractsDeployed(chainId)) return () => {}

    const unsubscribe = subscribeToEvents(provider, chainId, account, (newTx) => {
      // Backfill timestamp for live events
      newTx.timestamp = newTx.timestamp || Date.now()
      setTransactions(prev => mergeTransactions(prev, [newTx]))
    })

    return unsubscribe
  }, [provider, chainId, account, isCKB])

  // ============ CKB Auction State Tracking ============
  // Track CKB batch phase transitions as transaction-like entries
  const prevCKBBatchRef = useRef(null)
  useEffect(() => {
    if (!isCKB || !ckbAuctionState) return

    const { batchId, phase } = ckbAuctionState
    const prevBatch = prevCKBBatchRef.current

    // Detect batch settlement (new batch ID = previous batch settled)
    if (prevBatch !== null && batchId > prevBatch) {
      setTransactions(prev => [{
        id: `ckb-settle-${prevBatch}-${Date.now()}`,
        type: TX_TYPE.SWAP_SETTLED,
        status: TX_STATUS.COMPLETED,
        timestamp: Date.now(),
        batchId: prevBatch,
        chainId: ckbChainId,
        source: 'ckb',
      }, ...prev].slice(0, MAX_TRANSACTIONS))
    }

    prevCKBBatchRef.current = batchId
  }, [isCKB, ckbAuctionState, ckbChainId])

  // Manual sync trigger (exposed to consumers)
  const syncFromChain = useCallback(async () => {
    if (isCKB) return // CKB sync is automatic via auction state polling
    if (!provider || !chainId || !account) return
    if (!areContractsDeployed(chainId)) return

    setIsSyncing(true)
    try {
      const chainTxs = await fetchChainTransactions(provider, chainId, account)
      if (chainTxs.length > 0) {
        setTransactions(prev => mergeTransactions(prev, chainTxs))
      }
    } finally {
      setIsSyncing(false)
    }
  }, [provider, chainId, account, isCKB])

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
      chainId: activeChainId,
      source: isCKB ? 'ckb' : 'evm',
      ...tx,
    }

    setTransactions(prev => [newTx, ...prev].slice(0, MAX_TRANSACTIONS))
    return newTx.id
  }, [activeChainId, isCKB])

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
    if (activeAccount) {
      localStorage.removeItem(`${STORAGE_KEY}_${activeAccount.toLowerCase()}`)
    }
  }, [activeAccount])

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

    // On-chain sync
    syncFromChain,
    isSyncing,

    // Chain detection
    isCKB,

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
