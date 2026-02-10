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
          color: 'text-matrix-500',
          bgColor: 'bg-matrix-500',
          borderColor: 'border-matrix-500/30',
          bgTint: 'bg-matrix-500/5',
        }
      case PHASES.REVEAL:
        return {
          color: 'text-warning',
          bgColor: 'bg-warning',
          borderColor: 'border-warning/30',
          bgTint: 'bg-warning/5',
        }
      case PHASES.SETTLING:
        return {
          color: 'text-terminal-500',
          bgColor: 'bg-terminal-500',
          borderColor: 'border-terminal-500/30',
          bgTint: 'bg-terminal-500/5',
        }
      default:
        return {
          color: 'text-black-400',
          bgColor: 'bg-black-400',
          borderColor: 'border-black-500',
          bgTint: 'bg-black-800',
        }
    }
  }

  const getPhaseLabel = () => {
    switch (phase) {
      case PHASES.COMMIT:
        return 'ACCEPTING'
      case PHASES.REVEAL:
        return 'PROCESSING'
      case PHASES.SETTLING:
        return 'COMPLETING'
      default:
        return 'UNKNOWN'
    }
  }

  // Human-friendly phase explanation
  const getPhaseExplanation = () => {
    if (!hasActiveOrder) {
      switch (phase) {
        case PHASES.COMMIT:
          return 'Submit now to join this batch'
        case PHASES.REVEAL:
          return 'Wait for next batch to submit'
        case PHASES.SETTLING:
          return 'Trades completing...'
        default:
          return ''
      }
    } else {
      switch (phase) {
        case PHASES.COMMIT:
          return 'Your order is protected and waiting'
        case PHASES.REVEAL:
          return 'Your order is being processed'
        case PHASES.SETTLING:
          return 'Almost done! Finding your best price...'
        default:
          return ''
      }
    }
  }

  const config = getPhaseConfig()
  const totalTime = PHASE_DURATIONS[phase]
  const progress = ((totalTime - timeLeft) / totalTime) * 100

  const formatValue = (value) => {
    if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`
    if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`
    return `$${value}`
  }

  const getUserStatusIndicator = () => {
    if (!hasActiveOrder) return null

    const status = userOrder.status
    if (status === ORDER_STATUS.COMMITTED || status === ORDER_STATUS.PENDING_COMMIT) {
      return { color: 'bg-matrix-500', label: 'committed' }
    }
    if (status === ORDER_STATUS.REVEALED || status === ORDER_STATUS.PENDING_REVEAL) {
      return { color: 'bg-warning', label: 'revealed' }
    }
    if (status === ORDER_STATUS.SETTLING) {
      return { color: 'bg-terminal-500', label: 'settling' }
    }
    return null
  }

  const userStatus = getUserStatusIndicator()

  // Urgency indicator for commit phase ending
  const isUrgent = phase === PHASES.COMMIT && timeLeft <= 3
  const isEnding = phase === PHASES.COMMIT && timeLeft <= 5

  return (
    <div className={`p-4 rounded-lg surface border ${config.borderColor} ${isUrgent ? 'animate-pulse' : ''}`}>
      {/* Urgent submit prompt */}
      <AnimatePresence>
        {isEnding && !hasActiveOrder && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-3 py-2 px-3 rounded bg-warning/10 border border-warning/30 flex items-center justify-between"
          >
            <div className="flex items-center space-x-2">
              <svg className="w-4 h-4 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-xs text-warning font-medium">submit now to join this batch</span>
            </div>
            <span className="font-mono text-sm font-bold text-warning">{timeLeft}s</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top row: Phase + Timer */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-3">
          {/* Phase indicator with pulse */}
          <div className="relative">
            <div className={`w-2 h-2 rounded-full ${config.bgColor}`} />
            {phase === PHASES.COMMIT && (
              <div className={`absolute inset-0 w-2 h-2 rounded-full ${config.bgColor} animate-ping opacity-75`} />
            )}
          </div>

          <div className="flex items-center space-x-2">
            <span className={`font-bold tracking-wider text-sm ${config.color}`}>
              {getPhaseLabel()}
            </span>
            {phase === PHASES.COMMIT && (
              <span className="text-[10px] text-black-500">• accepting orders</span>
            )}
          </div>
        </div>

        <div className="flex items-center space-x-4">
          <div className="text-xs text-black-400 font-mono">
            batch <span className="text-black-200">#{batchId}</span>
          </div>

          {/* Countdown */}
          <motion.div
            className={`font-mono text-xl font-bold ${config.color} tabular-nums`}
            animate={isUrgent ? { scale: [1, 1.1, 1] } : {}}
            transition={{ duration: 0.3, repeat: isUrgent ? Infinity : 0 }}
          >
            {timeLeft}
            <span className="text-sm text-black-500">s</span>
          </motion.div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-black-700 rounded-full overflow-hidden">
        <motion.div
          className={`h-full ${config.bgColor}`}
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.3, ease: 'linear' }}
        />
      </div>

      {/* Batch Queue Stats */}
      <div className="mt-3 grid grid-cols-3 gap-3">
        <div className="text-center">
          <div className="text-base font-bold font-mono text-white">
            {batchQueue.orderCount}
          </div>
          <div className="text-[10px] text-black-500 uppercase">orders</div>
        </div>

        <div className="text-center">
          <div className="text-base font-bold font-mono text-white">
            {formatValue(batchQueue.totalValue)}
          </div>
          <div className="text-[10px] text-black-500 uppercase">value</div>
        </div>

        <div className="text-center">
          <div className="text-base font-bold font-mono text-terminal-500">
            {batchQueue.priorityOrders}
          </div>
          <div className="text-[10px] text-black-500 uppercase">priority</div>
        </div>
      </div>

      {/* Phase explanation - human friendly */}
      <div className="mt-3 text-center">
        <span className="text-xs text-black-300">{getPhaseExplanation()}</span>
      </div>

      {/* Bottom info */}
      <div className="flex items-center justify-between mt-3 text-xs">
        <div className="flex items-center space-x-1.5 text-black-400">
          {phase === PHASES.COMMIT && (
            <span>orders hidden until reveal</span>
          )}
          {phase === PHASES.REVEAL && (
            <span>batch sealed - no new orders</span>
          )}
          {phase === PHASES.SETTLING && (
            <span>finding clearing price...</span>
          )}
        </div>

        <div className="flex items-center space-x-3">
          {userStatus && (
            <div className="flex items-center space-x-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${userStatus.color}`} />
              <span className="text-black-300">{userStatus.label}</span>
            </div>
          )}

          <div className="flex items-center space-x-1 text-matrix-500">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <span className="font-medium">mev protected</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default BatchTimer
