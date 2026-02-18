import { useState, useEffect, useCallback, useRef, createContext, useContext } from 'react'
import { useWallet } from './useWallet'
import useContracts from './useContracts'

// Batch phases match the smart contract
const PHASES = {
  COMMIT: 'commit',
  REVEAL: 'reveal',
  SETTLING: 'settling',
}

// Map on-chain phase enum (0, 1, 2) to our string phases
const PHASE_FROM_CHAIN = {
  0: PHASES.COMMIT,
  1: PHASES.REVEAL,
  2: PHASES.SETTLING,
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
  // ============ External hooks ============
  const { chainId } = useWallet()
  const {
    getCurrentBatch,
    commitSwap,
    revealSwap,
    contracts,
    isContractsDeployed,
  } = useContracts()

  const isLive = isContractsDeployed

  // ============ Batch state ============
  const [phase, setPhase] = useState(PHASES.COMMIT)
  const [timeLeft, setTimeLeft] = useState(PHASE_DURATIONS[PHASES.COMMIT])
  const [batchId, setBatchId] = useState(1247)

  // Batch queue info
  const [batchQueue, setBatchQueue] = useState({
    orderCount: 0,
    totalValue: 0,
    priorityOrders: 0,
  })

  // User's current order state
  const [userOrder, setUserOrder] = useState({
    status: ORDER_STATUS.NONE,
    commitHash: null,
    commitId: null,     // on-chain commitId (live mode)
    secret: null,       // secret for reveal (live mode)
    orderDetails: null, // { tokenIn, tokenOut, amountIn, amountOut, priorityBid }
    batchId: null,
    revealedAt: null,
    settlement: null,   // { clearingPrice, amountReceived, mevSaved }
  })

  // Settlement history for the last few batches
  const [recentSettlements, setRecentSettlements] = useState([])

  // Ref to track the previous phase so we can detect transitions in live mode
  const prevPhaseRef = useRef(phase)

  // ============ LIVE MODE: Poll on-chain batch state ============
  useEffect(() => {
    if (!isLive) return

    let cancelled = false

    const pollBatch = async () => {
      const batch = await getCurrentBatch()
      if (cancelled || !batch) return

      const chainPhase = PHASE_FROM_CHAIN[batch.phase]
      if (!chainPhase) return

      const prevPhase = prevPhaseRef.current

      // Detect phase transitions
      if (chainPhase !== prevPhase) {
        // COMMIT -> REVEAL transition
        if (prevPhase === PHASES.COMMIT && chainPhase === PHASES.REVEAL) {
          if (userOrder.status === ORDER_STATUS.COMMITTED) {
            setUserOrder(prev => ({ ...prev, status: ORDER_STATUS.PENDING_REVEAL }))
          }
        }

        // REVEAL -> SETTLING transition
        if (prevPhase === PHASES.REVEAL && chainPhase === PHASES.SETTLING) {
          if (userOrder.status === ORDER_STATUS.REVEALED ||
              userOrder.status === ORDER_STATUS.PENDING_REVEAL) {
            setUserOrder(prev => ({ ...prev, status: ORDER_STATUS.SETTLING }))
          } else if (userOrder.status === ORDER_STATUS.COMMITTED) {
            // Didn't reveal in time
            setUserOrder(prev => ({ ...prev, status: ORDER_STATUS.FAILED }))
          }
        }

        // SETTLING -> COMMIT transition (new batch started)
        if (prevPhase === PHASES.SETTLING && chainPhase === PHASES.COMMIT) {
          if (userOrder.status === ORDER_STATUS.SETTLING) {
            // Settlement happened on-chain; mark as settled with placeholder
            // Real settlement data comes from SwapExecuted event (handled below)
            setUserOrder(prev => ({
              ...prev,
              status: ORDER_STATUS.SETTLED,
              settlement: prev.settlement || {
                clearingPrice: '—',
                amountReceived: '—',
                expectedAmount: prev.orderDetails?.amountOut || '—',
                improvement: '—',
                mevSaved: '—',
                executionPosition: '—',
                totalOrdersInBatch: '—',
              },
            }))
          }

          // Reset batch queue for new batch
          setBatchQueue({ orderCount: 0, totalValue: 0, priorityOrders: 0 })
        }

        prevPhaseRef.current = chainPhase
      }

      setPhase(chainPhase)
      setTimeLeft(batch.timeUntilPhaseChange)
      setBatchId(batch.batchId)
    }

    // Initial poll immediately
    pollBatch()

    // Then every 1 second
    const interval = setInterval(pollBatch, 1000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [isLive, getCurrentBatch, userOrder.status])

  // ============ LIVE MODE: Listen for on-chain events ============
  useEffect(() => {
    if (!isLive || !contracts?.auction) return

    const auctionContract = contracts.auction

    // OrderCommitted event — update batch queue counts
    const onOrderCommitted = (_commitId, _trader, eventBatchId, depositAmount) => {
      const eBatchId = Number(eventBatchId)
      if (eBatchId !== batchId) return

      setBatchQueue(prev => ({
        orderCount: prev.orderCount + 1,
        totalValue: prev.totalValue + Number(depositAmount) / 1e18,
        priorityOrders: prev.priorityOrders, // updated separately if needed
      }))
    }

    // BatchSettled event — record settlement data
    const onBatchSettled = (settledBatchId, orderCount, totalPriorityBids, _shuffleSeed) => {
      const sBatchId = Number(settledBatchId)

      setRecentSettlements(prev => [{
        batchId: sBatchId,
        orderCount: Number(orderCount),
        totalPriorityBids: Number(totalPriorityBids) / 1e18,
        timestamp: Date.now(),
      }, ...prev.slice(0, 4)])
    }

    auctionContract.on('OrderCommitted', onOrderCommitted)
    auctionContract.on('BatchSettled', onBatchSettled)

    return () => {
      auctionContract.off('OrderCommitted', onOrderCommitted)
      auctionContract.off('BatchSettled', onBatchSettled)
    }
  }, [isLive, contracts, batchId])

  // Listen for SwapExecuted on VibeSwapCore for the user's order settlement
  useEffect(() => {
    if (!isLive || !contracts?.vibeSwapCore) return

    const coreContract = contracts.vibeSwapCore

    const onSwapExecuted = (commitId, trader, tokenIn, tokenOut, amountIn, amountOut) => {
      // Only handle if this is the user's active order
      if (userOrder.commitId && commitId === userOrder.commitId) {
        const received = Number(amountOut) / 1e18
        const expected = parseFloat(userOrder.orderDetails?.amountOut || 0)
        const improvement = expected > 0 ? ((received - expected) / expected * 100) : 0

        const settlement = {
          clearingPrice: (Number(amountIn) / Number(amountOut)).toFixed(6),
          amountReceived: received.toFixed(6),
          expectedAmount: expected.toFixed(6),
          improvement: improvement.toFixed(3),
          mevSaved: '—', // Cannot be calculated on-chain; placeholder
          executionPosition: '—',
          totalOrdersInBatch: '—',
        }

        setUserOrder(prev => ({
          ...prev,
          status: ORDER_STATUS.SETTLED,
          settlement,
        }))

        setRecentSettlements(prev => [{
          batchId: userOrder.batchId,
          ...settlement,
          timestamp: Date.now(),
        }, ...prev.slice(0, 4)])
      }
    }

    coreContract.on('SwapExecuted', onSwapExecuted)

    return () => {
      coreContract.off('SwapExecuted', onSwapExecuted)
    }
  }, [isLive, contracts, userOrder.commitId, userOrder.batchId, userOrder.orderDetails])

  // ============ SIMULATION MODE: Phase transition logic ============
  useEffect(() => {
    if (isLive) return // Skip simulation when live

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
  }, [isLive, phase, batchId, userOrder.status, userOrder.orderDetails])

  // ============ SIMULATION MODE: Batch queue updates during commit ============
  useEffect(() => {
    if (isLive) return // Skip simulation when live
    if (phase !== PHASES.COMMIT) return

    const interval = setInterval(() => {
      setBatchQueue(prev => ({
        orderCount: prev.orderCount + Math.floor(Math.random() * 3),
        totalValue: prev.totalValue + Math.floor(Math.random() * 50000),
        priorityOrders: prev.priorityOrders + (Math.random() > 0.7 ? 1 : 0),
      }))
    }, 2000)

    return () => clearInterval(interval)
  }, [isLive, phase])

  // ============ Commit an order (called from SwapPage) ============
  const commitOrder = useCallback(async (orderDetails) => {
    if (phase !== PHASES.COMMIT) {
      throw new Error('Cannot commit outside of commit phase')
    }

    setUserOrder({
      status: ORDER_STATUS.PENDING_COMMIT,
      commitHash: null,
      commitId: null,
      secret: null,
      orderDetails,
      batchId,
      revealedAt: null,
      settlement: null,
    })

    if (isLive) {
      // ---- LIVE: submit real on-chain commit ----
      try {
        const result = await commitSwap({
          tokenIn: orderDetails.tokenIn,
          tokenOut: orderDetails.tokenOut,
          amountIn: orderDetails.amountIn,
          minAmountOut: orderDetails.minAmountOut || 0,
          deposit: orderDetails.deposit || 0,
        })

        setUserOrder(prev => ({
          ...prev,
          status: ORDER_STATUS.COMMITTED,
          commitHash: result.hash,
          commitId: result.commitId,
          secret: result.secret,
          batchId: result.batchId,
        }))

        // Update batch queue locally (event listener will also fire but that's fine)
        setBatchQueue(prev => ({
          ...prev,
          orderCount: prev.orderCount + 1,
          totalValue: prev.totalValue + parseFloat(orderDetails.valueUsd || 0),
          priorityOrders: prev.priorityOrders + (orderDetails.priorityBid ? 1 : 0),
        }))

        return result.hash
      } catch (error) {
        setUserOrder(prev => ({
          ...prev,
          status: ORDER_STATUS.FAILED,
        }))
        throw error
      }
    } else {
      // ---- SIMULATION: mock commit ----
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
    }
  }, [isLive, phase, batchId, commitSwap])

  // ============ Reveal an order (auto-called or manual) ============
  const revealOrder = useCallback(async () => {
    if (phase !== PHASES.REVEAL) {
      throw new Error('Cannot reveal outside of reveal phase')
    }
    if (userOrder.status !== ORDER_STATUS.COMMITTED &&
        userOrder.status !== ORDER_STATUS.PENDING_REVEAL) {
      throw new Error('No committed order to reveal')
    }

    setUserOrder(prev => ({ ...prev, status: ORDER_STATUS.PENDING_REVEAL }))

    if (isLive) {
      // ---- LIVE: submit real on-chain reveal ----
      try {
        const result = await revealSwap(
          userOrder.commitId,
          userOrder.orderDetails?.priorityBid || 0
        )

        setUserOrder(prev => ({
          ...prev,
          status: ORDER_STATUS.REVEALED,
          revealedAt: Date.now(),
        }))

        return result.hash
      } catch (error) {
        // Revert to committed so user can retry
        setUserOrder(prev => ({ ...prev, status: ORDER_STATUS.COMMITTED }))
        throw error
      }
    } else {
      // ---- SIMULATION: mock reveal ----
      await simulateTransaction(1000)

      setUserOrder(prev => ({
        ...prev,
        status: ORDER_STATUS.REVEALED,
        revealedAt: Date.now(),
      }))
    }
  }, [isLive, phase, userOrder.status, userOrder.commitId, userOrder.orderDetails, revealSwap])

  // ============ Reset user order ============
  const resetOrder = useCallback(() => {
    setUserOrder({
      status: ORDER_STATUS.NONE,
      commitHash: null,
      commitId: null,
      secret: null,
      orderDetails: null,
      batchId: null,
      revealedAt: null,
      settlement: null,
    })
  }, [])

  // ============ Context value ============
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

    // Mode
    isLive,

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

// ============ Helper functions ============

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
