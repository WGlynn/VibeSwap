import { useState, useEffect, useCallback, createContext, useContext } from 'react'

// Batch phases match the smart contract
const PHASES = {
  COMMIT: 'commit',
  REVEAL: 'reveal',
  SETTLING: 'settling',
}

const PHASE_DURATIONS = {
  [PHASES.COMMIT]: 8,
  [PHASES.REVEAL]: 2,
  [PHASES.SETTLING]: 1,
}

// Order status through the batch lifecycle
const ORDER_STATUS = {
  NONE: 'none',           // No order placed
  PENDING_COMMIT: 'pending_commit',  // User initiated, tx pending
  COMMITTED: 'committed', // Order committed (hash on-chain)
  PENDING_REVEAL: 'pending_reveal',  // Reveal tx pending
  REVEALED: 'revealed',   // Order revealed
  SETTLING: 'settling',   // Batch is settling
  SETTLED: 'settled',     // Order executed
  FAILED: 'failed',       // Order failed (didn't reveal in time, etc.)
}

const BatchContext = createContext(null)

export function BatchProvider({ children }) {
  // Batch state
  const [phase, setPhase] = useState(PHASES.COMMIT)
  const [timeLeft, setTimeLeft] = useState(PHASE_DURATIONS[PHASES.COMMIT])
  const [batchId, setBatchId] = useState(1247)

  // Batch queue info (simulated - would come from contract/events in production)
  const [batchQueue, setBatchQueue] = useState({
    orderCount: 0,
    totalValue: 0,
    priorityOrders: 0,
  })

  // User's current order state
  const [userOrder, setUserOrder] = useState({
    status: ORDER_STATUS.NONE,
    commitHash: null,
    orderDetails: null, // { tokenIn, tokenOut, amountIn, amountOut, priorityBid }
    batchId: null,
    revealedAt: null,
    settlement: null, // { clearingPrice, amountReceived, mevSaved }
  })

  // Settlement history for the last few batches
  const [recentSettlements, setRecentSettlements] = useState([])

  // Phase transition logic
  useEffect(() => {
    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          // Phase transition
          if (phase === PHASES.COMMIT) {
            setPhase(PHASES.REVEAL)

            // If user has a committed order, update status
            if (userOrder.status === ORDER_STATUS.COMMITTED) {
              // In production, auto-reveal would happen here
              setUserOrder(prev => ({ ...prev, status: ORDER_STATUS.PENDING_REVEAL }))
            }

            return PHASE_DURATIONS[PHASES.REVEAL]
          } else if (phase === PHASES.REVEAL) {
            setPhase(PHASES.SETTLING)

            // Update user order status
            if (userOrder.status === ORDER_STATUS.REVEALED ||
                userOrder.status === ORDER_STATUS.PENDING_REVEAL) {
              setUserOrder(prev => ({ ...prev, status: ORDER_STATUS.SETTLING }))
            } else if (userOrder.status === ORDER_STATUS.COMMITTED) {
              // Didn't reveal in time
              setUserOrder(prev => ({ ...prev, status: ORDER_STATUS.FAILED }))
            }

            return PHASE_DURATIONS[PHASES.SETTLING]
          } else {
            // Settlement complete, start new batch
            const newBatchId = batchId + 1
            setBatchId(newBatchId)
            setPhase(PHASES.COMMIT)

            // Record settlement if user had an order
            if (userOrder.status === ORDER_STATUS.SETTLING) {
              const settlement = generateMockSettlement(userOrder.orderDetails)
              setUserOrder(prev => ({
                ...prev,
                status: ORDER_STATUS.SETTLED,
                settlement
              }))

              // Add to history
              setRecentSettlements(prev => [{
                batchId: batchId,
                ...settlement,
                timestamp: Date.now(),
              }, ...prev.slice(0, 4)])
            }

            // Reset batch queue for new batch
            setBatchQueue({
              orderCount: Math.floor(Math.random() * 20) + 5,
              totalValue: Math.floor(Math.random() * 500000) + 50000,
              priorityOrders: Math.floor(Math.random() * 5),
            })

            return PHASE_DURATIONS[PHASES.COMMIT]
          }
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [phase, batchId, userOrder.status, userOrder.orderDetails])

  // Simulate batch queue updates during commit phase
  useEffect(() => {
    if (phase !== PHASES.COMMIT) return

    const interval = setInterval(() => {
      setBatchQueue(prev => ({
        orderCount: prev.orderCount + Math.floor(Math.random() * 3),
        totalValue: prev.totalValue + Math.floor(Math.random() * 50000),
        priorityOrders: prev.priorityOrders + (Math.random() > 0.7 ? 1 : 0),
      }))
    }, 2000)

    return () => clearInterval(interval)
  }, [phase])

  // Commit an order (called from SwapPage)
  const commitOrder = useCallback(async (orderDetails) => {
    if (phase !== PHASES.COMMIT) {
      throw new Error('Cannot commit outside of commit phase')
    }

    setUserOrder({
      status: ORDER_STATUS.PENDING_COMMIT,
      commitHash: null,
      orderDetails,
      batchId,
      revealedAt: null,
      settlement: null,
    })

    // Simulate tx confirmation
    await simulateTransaction(1500)

    const commitHash = generateCommitHash(orderDetails)

    setUserOrder(prev => ({
      ...prev,
      status: ORDER_STATUS.COMMITTED,
      commitHash,
    }))

    // Update batch queue
    setBatchQueue(prev => ({
      ...prev,
      orderCount: prev.orderCount + 1,
      totalValue: prev.totalValue + parseFloat(orderDetails.valueUsd || 0),
      priorityOrders: prev.priorityOrders + (orderDetails.priorityBid ? 1 : 0),
    }))

    return commitHash
  }, [phase, batchId])

  // Reveal an order (auto-called or manual)
  const revealOrder = useCallback(async () => {
    if (phase !== PHASES.REVEAL) {
      throw new Error('Cannot reveal outside of reveal phase')
    }
    if (userOrder.status !== ORDER_STATUS.COMMITTED &&
        userOrder.status !== ORDER_STATUS.PENDING_REVEAL) {
      throw new Error('No committed order to reveal')
    }

    setUserOrder(prev => ({ ...prev, status: ORDER_STATUS.PENDING_REVEAL }))

    // Simulate tx confirmation
    await simulateTransaction(1000)

    setUserOrder(prev => ({
      ...prev,
      status: ORDER_STATUS.REVEALED,
      revealedAt: Date.now(),
    }))
  }, [phase, userOrder.status])

  // Reset user order (after viewing settlement or starting fresh)
  const resetOrder = useCallback(() => {
    setUserOrder({
      status: ORDER_STATUS.NONE,
      commitHash: null,
      orderDetails: null,
      batchId: null,
      revealedAt: null,
      settlement: null,
    })
  }, [])

  const value = {
    // Batch state
    phase,
    timeLeft,
    batchId,
    batchQueue,

    // User order
    userOrder,

    // History
    recentSettlements,

    // Actions
    commitOrder,
    revealOrder,
    resetOrder,

    // Constants
    PHASES,
    ORDER_STATUS,
    PHASE_DURATIONS,

    // Helpers
    isCommitPhase: phase === PHASES.COMMIT,
    isRevealPhase: phase === PHASES.REVEAL,
    isSettlingPhase: phase === PHASES.SETTLING,
    hasActiveOrder: userOrder.status !== ORDER_STATUS.NONE &&
                    userOrder.status !== ORDER_STATUS.SETTLED &&
                    userOrder.status !== ORDER_STATUS.FAILED,
    canCommit: phase === PHASES.COMMIT &&
               (userOrder.status === ORDER_STATUS.NONE ||
                userOrder.status === ORDER_STATUS.SETTLED ||
                userOrder.status === ORDER_STATUS.FAILED),
  }

  return (
    <BatchContext.Provider value={value}>
      {children}
    </BatchContext.Provider>
  )
}

export function useBatchState() {
  const context = useContext(BatchContext)
  if (!context) {
    throw new Error('useBatchState must be used within a BatchProvider')
  }
  return context
}

// Helper functions

function simulateTransaction(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function generateCommitHash(orderDetails) {
  // In production, this would be keccak256(abi.encode(order, secret))
  const pseudo = JSON.stringify(orderDetails) + Date.now()
  return '0x' + Array.from({ length: 64 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('')
}

function generateMockSettlement(orderDetails) {
  if (!orderDetails) return null

  const expectedOutput = parseFloat(orderDetails.amountOut || 0)
  // Simulate slight improvement from batch auction
  const improvement = 1 + (Math.random() * 0.005) // 0-0.5% improvement
  const actualOutput = expectedOutput * improvement

  // Calculate "MEV saved" (what a sandwich would have cost)
  const tradeSize = parseFloat(orderDetails.valueUsd || 1000)
  const mevSaved = tradeSize * (0.001 + Math.random() * 0.005) // 0.1-0.6% saved

  return {
    clearingPrice: (parseFloat(orderDetails.amountIn) / actualOutput).toFixed(6),
    amountReceived: actualOutput.toFixed(6),
    expectedAmount: expectedOutput.toFixed(6),
    improvement: ((improvement - 1) * 100).toFixed(3),
    mevSaved: mevSaved.toFixed(2),
    executionPosition: Math.floor(Math.random() * 20) + 1,
    totalOrdersInBatch: Math.floor(Math.random() * 30) + 20,
  }
}

export default useBatchState
