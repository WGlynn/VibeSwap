import { motion, AnimatePresence } from 'framer-motion'
import { useBatchState } from '../hooks/useBatchState'

// Visual journey of user's order through the commit-reveal-settle flow
function OrderStatus() {
  const {
    userOrder,
    phase,
    batchId,
    ORDER_STATUS,
    resetOrder,
    revealOrder,
    isRevealPhase,
  } = useBatchState()

  const { status, orderDetails, settlement, commitHash } = userOrder

  // Don't show if no active order
  if (status === ORDER_STATUS.NONE) {
    return null
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={status}
        initial={{ opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -10, scale: 0.98 }}
        transition={{ duration: 0.3 }}
        className="mt-4"
      >
        {/* Order Committed State */}
        {(status === ORDER_STATUS.PENDING_COMMIT || status === ORDER_STATUS.COMMITTED) && (
          <CommittedState
            status={status}
            orderDetails={orderDetails}
            commitHash={commitHash}
            batchId={batchId}
            ORDER_STATUS={ORDER_STATUS}
          />
        )}

        {/* Reveal State */}
        {(status === ORDER_STATUS.PENDING_REVEAL || status === ORDER_STATUS.REVEALED) && (
          <RevealState
            status={status}
            orderDetails={orderDetails}
            ORDER_STATUS={ORDER_STATUS}
            onReveal={revealOrder}
            canReveal={isRevealPhase && status === ORDER_STATUS.COMMITTED}
          />
        )}

        {/* Settling State */}
        {status === ORDER_STATUS.SETTLING && (
          <SettlingState orderDetails={orderDetails} />
        )}

        {/* Settlement Complete */}
        {status === ORDER_STATUS.SETTLED && (
          <SettledState
            orderDetails={orderDetails}
            settlement={settlement}
            onDismiss={resetOrder}
          />
        )}

        {/* Failed State */}
        {status === ORDER_STATUS.FAILED && (
          <FailedState onDismiss={resetOrder} />
        )}
      </motion.div>
    </AnimatePresence>
  )
}

function CommittedState({ status, orderDetails, commitHash, batchId, ORDER_STATUS }) {
  const isPending = status === ORDER_STATUS.PENDING_COMMIT

  return (
    <div className="p-4 rounded-2xl bg-glow-500/10 border border-glow-500/30 relative overflow-hidden">
      {/* Animated background */}
      <motion.div
        animate={{ x: ['0%', '100%'] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
        className="absolute inset-0 bg-gradient-to-r from-transparent via-glow-500/5 to-transparent"
      />

      <div className="relative">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            {isPending ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                className="w-5 h-5 border-2 border-glow-500 border-t-transparent rounded-full"
              />
            ) : (
              <div className="w-5 h-5 rounded-full bg-glow-500 flex items-center justify-center">
                <svg className="w-3 h-3 text-void-900" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
            )}
            <span className="font-display font-bold text-glow-500">
              {isPending ? 'COMMITTING ORDER' : 'ORDER COMMITTED'}
            </span>
          </div>
          <span className="text-xs text-void-400 font-mono">Batch #{batchId}</span>
        </div>

        {/* Order summary */}
        {orderDetails && (
          <div className="flex items-center justify-between text-sm mb-3">
            <span className="text-void-300">
              {orderDetails.amountIn} {orderDetails.tokenIn?.symbol}
            </span>
            <span className="text-void-500 mx-2">-</span>
            <span className="text-void-300">
              {orderDetails.amountOut} {orderDetails.tokenOut?.symbol}
            </span>
          </div>
        )}

        {/* Commit hash (truncated) */}
        {commitHash && (
          <div className="flex items-center space-x-2 text-xs">
            <span className="text-void-500">Commit:</span>
            <code className="font-mono text-glow-500/70 bg-void-800/50 px-2 py-0.5 rounded">
              {commitHash.slice(0, 10)}...{commitHash.slice(-8)}
            </code>
          </div>
        )}

        {/* Security message */}
        <div className="mt-3 flex items-center space-x-2 text-xs text-void-400">
          <svg className="w-4 h-4 text-glow-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          <span>Your order is encrypted. Bots cannot see or frontrun it.</span>
        </div>
      </div>
    </div>
  )
}

function RevealState({ status, orderDetails, ORDER_STATUS, onReveal, canReveal }) {
  const isPending = status === ORDER_STATUS.PENDING_REVEAL
  const isRevealed = status === ORDER_STATUS.REVEALED

  return (
    <div className="p-4 rounded-2xl bg-yellow-500/10 border border-yellow-500/30 relative overflow-hidden">
      <motion.div
        animate={{ x: ['0%', '100%'] }}
        transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
        className="absolute inset-0 bg-gradient-to-r from-transparent via-yellow-500/5 to-transparent"
      />

      <div className="relative">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            {isPending ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                className="w-5 h-5 border-2 border-yellow-400 border-t-transparent rounded-full"
              />
            ) : (
              <div className="w-5 h-5 rounded-full bg-yellow-400 flex items-center justify-center">
                <svg className="w-3 h-3 text-void-900" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </div>
            )}
            <span className="font-display font-bold text-yellow-400">
              {isPending ? 'REVEALING ORDER' : isRevealed ? 'ORDER REVEALED' : 'REVEAL PHASE'}
            </span>
          </div>
        </div>

        {orderDetails && (
          <div className="text-sm text-void-300 mb-3">
            Swapping <span className="font-medium text-white">{orderDetails.amountIn} {orderDetails.tokenIn?.symbol}</span>
            {' '}for{' '}
            <span className="font-medium text-white">{orderDetails.amountOut} {orderDetails.tokenOut?.symbol}</span>
          </div>
        )}

        {isRevealed ? (
          <div className="flex items-center space-x-2 text-xs text-void-400">
            <svg className="w-4 h-4 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <span>Order revealed. Waiting for batch settlement...</span>
          </div>
        ) : (
          <div className="text-xs text-void-400">
            Batch is sealed. Your order is being revealed for settlement.
          </div>
        )}
      </div>
    </div>
  )
}

function SettlingState({ orderDetails }) {
  return (
    <div className="p-4 rounded-2xl bg-vibe-500/10 border border-vibe-500/30 relative overflow-hidden">
      {/* Animated settling effect */}
      <motion.div
        animate={{
          background: [
            'linear-gradient(90deg, transparent 0%, rgba(255,30,232,0.1) 50%, transparent 100%)',
            'linear-gradient(90deg, transparent 0%, rgba(0,255,163,0.1) 50%, transparent 100%)',
          ]
        }}
        transition={{ duration: 1, repeat: Infinity }}
        className="absolute inset-0"
      />

      <div className="relative">
        <div className="flex items-center space-x-2 mb-3">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
          >
            <svg className="w-5 h-5 text-vibe-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </motion.div>
          <span className="font-display font-bold text-vibe-400">SETTLING BATCH</span>
        </div>

        <div className="space-y-2 text-sm">
          <div className="flex items-center space-x-2 text-void-300">
            <motion.div
              animate={{ scale: [1, 1.2, 1] }}
              transition={{ duration: 0.5, repeat: Infinity }}
              className="w-2 h-2 rounded-full bg-vibe-400"
            />
            <span>Calculating uniform clearing price...</span>
          </div>
          <div className="flex items-center space-x-2 text-void-400">
            <div className="w-2 h-2 rounded-full bg-void-600" />
            <span>Ordering by priority auction...</span>
          </div>
          <div className="flex items-center space-x-2 text-void-400">
            <div className="w-2 h-2 rounded-full bg-void-600" />
            <span>Executing all orders at same price...</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function SettledState({ orderDetails, settlement, onDismiss }) {
  if (!settlement) return null

  const hasImprovement = parseFloat(settlement.improvement) > 0

  return (
    <div className="p-4 rounded-2xl bg-gradient-to-br from-glow-500/20 to-cyber-500/20 border border-glow-500/30 relative overflow-hidden">
      {/* Success shimmer */}
      <motion.div
        initial={{ x: '-100%' }}
        animate={{ x: '200%' }}
        transition={{ duration: 1.5, ease: 'easeOut' }}
        className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent"
      />

      <div className="relative">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', bounce: 0.5 }}
              className="w-6 h-6 rounded-full bg-glow-500 flex items-center justify-center"
            >
              <svg className="w-4 h-4 text-void-900" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </motion.div>
            <span className="font-display font-bold text-glow-500">SWAP COMPLETE</span>
          </div>
          <button
            onClick={onDismiss}
            className="text-void-400 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Settlement details */}
        <div className="space-y-3">
          {/* Amount received */}
          <div className="flex items-center justify-between">
            <span className="text-void-400 text-sm">Received</span>
            <span className="font-mono font-medium text-lg">
              {settlement.amountReceived} {orderDetails?.tokenOut?.symbol}
            </span>
          </div>

          {/* Clearing price */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-void-400">Clearing Price</span>
            <span className="font-mono">
              1 {orderDetails?.tokenIn?.symbol} = {settlement.clearingPrice} {orderDetails?.tokenOut?.symbol}
            </span>
          </div>

          {/* Execution position */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-void-400">Position in Batch</span>
            <span className="font-mono">
              #{settlement.executionPosition} of {settlement.totalOrdersInBatch}
            </span>
          </div>

          {/* Divider */}
          <div className="border-t border-void-600/50 my-2" />

          {/* MEV Savings */}
          <div className="p-3 rounded-xl bg-glow-500/10 border border-glow-500/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <svg className="w-4 h-4 text-glow-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span className="text-sm text-glow-500 font-medium">MEV Protected</span>
              </div>
              <span className="font-mono font-bold text-glow-500">
                ~${settlement.mevSaved} saved
              </span>
            </div>
            <p className="text-xs text-void-400 mt-1">
              Estimated savings vs. traditional DEX sandwich attack
            </p>
          </div>

          {/* Price improvement if any */}
          {hasImprovement && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-void-400">Price Improvement</span>
              <span className="font-mono text-glow-500">+{settlement.improvement}%</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function FailedState({ onDismiss }) {
  return (
    <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/30">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <div className="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center">
            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <span className="font-display font-bold text-red-400">ORDER FAILED</span>
        </div>
        <button
          onClick={onDismiss}
          className="text-void-400 hover:text-white transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <p className="text-sm text-void-300">
        Your order was not revealed in time and could not be included in the batch settlement.
        Your deposited funds have been returned minus a small penalty.
      </p>

      <button
        onClick={onDismiss}
        className="mt-3 w-full py-2 rounded-xl bg-void-700 hover:bg-void-600 transition-colors text-sm font-medium"
      >
        Try Again
      </button>
    </div>
  )
}

export default OrderStatus
