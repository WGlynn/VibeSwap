import { motion, AnimatePresence } from 'framer-motion'
import { useBatchState } from '../hooks/useBatchState'

function BatchTimer() {
  const {
    phase,
    timeLeft,
    batchId,
    batchQueue,
    userOrder,
    PHASES,
    PHASE_DURATIONS,
    ORDER_STATUS,
    hasActiveOrder,
  } = useBatchState()

  const getPhaseConfig = () => {
    switch (phase) {
      case PHASES.COMMIT:
        return {
          gradient: 'from-glow-500 to-cyber-500',
          bg: 'bg-glow-500/10',
          border: 'border-glow-500/30',
          text: 'text-glow-500',
          glow: 'shadow-[0_0_30px_rgba(163,255,0,0.2)]',
          icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          ),
          description: 'Submit encrypted orders',
          action: 'Orders are hidden',
        }
      case PHASES.REVEAL:
        return {
          gradient: 'from-yellow-400 to-orange-500',
          bg: 'bg-yellow-500/10',
          border: 'border-yellow-500/30',
          text: 'text-yellow-400',
          glow: 'shadow-[0_0_30px_rgba(251,191,36,0.2)]',
          icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          ),
          description: 'Batch sealed',
          action: 'Revealing orders',
        }
      case PHASES.SETTLING:
        return {
          gradient: 'from-vibe-500 to-cyber-500',
          bg: 'bg-vibe-500/10',
          border: 'border-vibe-500/30',
          text: 'text-vibe-400',
          glow: 'shadow-[0_0_30px_rgba(255,30,232,0.2)]',
          icon: (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          ),
          description: 'Finding clearing price',
          action: 'Executing batch',
        }
      default:
        return {
          gradient: 'from-void-500 to-void-600',
          bg: 'bg-void-500/10',
          border: 'border-void-500/30',
          text: 'text-void-400',
          glow: '',
          icon: null,
          description: '',
          action: '',
        }
    }
  }

  const getPhaseLabel = () => {
    switch (phase) {
      case PHASES.COMMIT:
        return 'COMMIT'
      case PHASES.REVEAL:
        return 'REVEAL'
      case PHASES.SETTLING:
        return 'SETTLING'
      default:
        return 'UNKNOWN'
    }
  }

  const config = getPhaseConfig()
  const totalTime = PHASE_DURATIONS[phase]
  const progress = ((totalTime - timeLeft) / totalTime) * 100

  // Format value for display
  const formatValue = (value) => {
    if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`
    if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`
    return `$${value}`
  }

  // Get user's order status indicator
  const getUserStatusIndicator = () => {
    if (!hasActiveOrder) return null

    const status = userOrder.status
    if (status === ORDER_STATUS.COMMITTED || status === ORDER_STATUS.PENDING_COMMIT) {
      return { color: 'bg-glow-500', label: 'Your order' }
    }
    if (status === ORDER_STATUS.REVEALED || status === ORDER_STATUS.PENDING_REVEAL) {
      return { color: 'bg-yellow-400', label: 'Revealed' }
    }
    if (status === ORDER_STATUS.SETTLING) {
      return { color: 'bg-vibe-400', label: 'Settling' }
    }
    return null
  }

  const userStatus = getUserStatusIndicator()

  return (
    <motion.div
      layout
      className={`p-4 rounded-2xl ${config.bg} border ${config.border} ${config.glow} transition-all duration-500 relative overflow-hidden`}
    >
      {/* Animated background gradient */}
      <div className="absolute inset-0 opacity-30">
        <div className={`absolute inset-0 bg-gradient-to-r ${config.gradient} animate-gradient-shift bg-300%`} />
      </div>

      {/* Shimmer effect */}
      <div className="absolute inset-0 overflow-hidden">
        <motion.div
          animate={{ x: ['0%', '200%'] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
          className="absolute inset-y-0 -left-full w-1/2 bg-gradient-to-r from-transparent via-white/5 to-transparent skew-x-12"
        />
      </div>

      <div className="relative">
        {/* Top row: Phase + Timer */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            {/* Phase indicator with pulse */}
            <div className="relative">
              <motion.div
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
                className={`absolute inset-0 rounded-full bg-gradient-to-r ${config.gradient} blur-sm opacity-50`}
              />
              <div className={`relative w-3 h-3 rounded-full bg-gradient-to-r ${config.gradient}`} />
            </div>

            <div className="flex items-center space-x-2">
              <span className={config.text}>{config.icon}</span>
              <AnimatePresence mode="wait">
                <motion.span
                  key={phase}
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className={`font-display font-bold tracking-wider ${config.text}`}
                >
                  {getPhaseLabel()}
                </motion.span>
              </AnimatePresence>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <div className="text-xs text-void-400 font-mono bg-void-800/50 px-2 py-1 rounded-lg">
              Batch <span className="text-white">#{batchId}</span>
            </div>

            {/* Countdown */}
            <motion.div
              key={timeLeft}
              initial={{ scale: 1.2, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className={`font-mono text-2xl font-bold ${config.text} tabular-nums`}
            >
              {timeLeft}
              <span className="text-sm text-void-400">s</span>
            </motion.div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-2 bg-void-800/50 rounded-full overflow-hidden relative">
          <motion.div
            className={`h-full bg-gradient-to-r ${config.gradient} relative`}
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          >
            <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-white/40 to-transparent" />
          </motion.div>

          {/* Tick marks */}
          <div className="absolute inset-0 flex">
            {[...Array(totalTime)].map((_, i) => (
              <div
                key={i}
                className="flex-1 border-r border-void-700/50 last:border-r-0"
              />
            ))}
          </div>
        </div>

        {/* Batch Queue Stats */}
        <div className="mt-4 grid grid-cols-3 gap-3">
          {/* Orders in batch */}
          <div className="bg-void-800/30 rounded-xl p-2.5 text-center">
            <div className="text-lg font-bold font-mono text-white">
              {batchQueue.orderCount}
            </div>
            <div className="text-xs text-void-400">Orders</div>
          </div>

          {/* Total value */}
          <div className="bg-void-800/30 rounded-xl p-2.5 text-center">
            <div className="text-lg font-bold font-mono text-white">
              {formatValue(batchQueue.totalValue)}
            </div>
            <div className="text-xs text-void-400">Value</div>
          </div>

          {/* Priority orders */}
          <div className="bg-void-800/30 rounded-xl p-2.5 text-center">
            <div className="text-lg font-bold font-mono text-cyber-400">
              {batchQueue.priorityOrders}
            </div>
            <div className="text-xs text-void-400">Priority</div>
          </div>
        </div>

        {/* Bottom info */}
        <div className="flex items-center justify-between mt-3 text-xs">
          <div className="flex items-center space-x-1.5 text-void-400">
            {phase === PHASES.COMMIT && (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                <span>Orders hidden until reveal</span>
              </>
            )}
            {phase === PHASES.REVEAL && (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>No new orders - batch sealed</span>
              </>
            )}
            {phase === PHASES.SETTLING && (
              <>
                <svg className="w-3.5 h-3.5 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span>Finding uniform clearing price</span>
              </>
            )}
          </div>

          <div className="flex items-center space-x-3">
            {/* User's order indicator */}
            {userStatus && (
              <div className="flex items-center space-x-1.5">
                <div className={`w-2 h-2 rounded-full ${userStatus.color}`} />
                <span className="text-void-300">{userStatus.label}</span>
              </div>
            )}

            <div className="flex items-center space-x-1.5 text-glow-500">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span className="font-medium">MEV Protected</span>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

export default BatchTimer
