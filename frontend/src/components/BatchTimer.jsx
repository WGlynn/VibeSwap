import { motion, AnimatePresence } from 'framer-motion'
import { useBatchState } from '../hooks/useBatchState'
import ProgressRing from './ui/ProgressRing'
import AnimatedNumber from './ui/AnimatedNumber'
import PulseIndicator from './ui/PulseIndicator'

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
          ringColor: '#00ff41',
          pulseColor: 'matrix',
        }
      case PHASES.REVEAL:
        return {
          color: 'text-warning',
          bgColor: 'bg-warning',
          borderColor: 'border-warning/30',
          bgTint: 'bg-warning/5',
          ringColor: '#ffaa00',
          pulseColor: 'warning',
        }
      case PHASES.SETTLING:
        return {
          color: 'text-terminal-500',
          bgColor: 'bg-terminal-500',
          borderColor: 'border-terminal-500/30',
          bgTint: 'bg-terminal-500/5',
          ringColor: '#00d4ff',
          pulseColor: 'terminal',
        }
      default:
        return {
          color: 'text-black-400',
          bgColor: 'bg-black-400',
          borderColor: 'border-black-500',
          bgTint: 'bg-black-800',
          ringColor: '#353535',
          pulseColor: 'matrix',
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
      return { color: 'matrix', label: 'committed' }
    }
    if (status === ORDER_STATUS.REVEALED || status === ORDER_STATUS.PENDING_REVEAL) {
      return { color: 'warning', label: 'revealed' }
    }
    if (status === ORDER_STATUS.SETTLING) {
      return { color: 'terminal', label: 'settling' }
    }
    return null
  }

  const userStatus = getUserStatusIndicator()

  // Urgency: last 3s of commit phase — color shifts green→amber
  const isUrgent = phase === PHASES.COMMIT && timeLeft <= 3
  const isEnding = phase === PHASES.COMMIT && timeLeft <= 5
  const urgentRingColor = isUrgent ? '#ffaa00' : config.ringColor

  return (
    <div
      className={`glass-card rounded-2xl overflow-hidden transition-all duration-300 ${isUrgent ? 'shadow-[0_0_30px_rgba(255,170,0,0.1)]' : ''}`}
      style={{ borderColor: isUrgent ? 'rgba(255,170,0,0.3)' : undefined }}
    >
      {/* Phase color bar at top */}
      <div className={`h-0.5 ${config.bgColor} transition-colors duration-500`} />

      <div className="p-4">
        {/* Urgent submit prompt */}
        <AnimatePresence>
          {isEnding && !hasActiveOrder && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-3 py-2 px-3 rounded-lg bg-warning/10 border border-warning/30 flex items-center justify-between"
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

        {/* Main layout: Phase info + ProgressRing center + Batch ID */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-3">
            <PulseIndicator color={config.pulseColor} size="sm" active={phase === PHASES.COMMIT} />
            <div className="flex items-center space-x-2">
              <span className={`font-bold tracking-wider text-sm ${config.color}`}>
                {getPhaseLabel()}
              </span>
              {phase === PHASES.COMMIT && (
                <span className="text-[10px] text-black-500">• accepting orders</span>
              )}
            </div>
          </div>

          <div className="text-xs text-black-400 font-mono">
            batch <span className="text-black-200">#{batchId}</span>
          </div>
        </div>

        {/* ProgressRing with countdown inside */}
        <div className="flex justify-center mb-3">
          <ProgressRing
            progress={progress}
            size={88}
            strokeWidth={4}
            color={urgentRingColor}
          >
            <motion.div
              className={`font-mono text-2xl font-bold ${isUrgent ? 'text-warning' : config.color} tabular-nums`}
              animate={isUrgent ? { scale: [1, 1.08, 1] } : {}}
              transition={{ duration: 0.5, repeat: isUrgent ? Infinity : 0 }}
            >
              {timeLeft}
              <span className="text-xs text-black-500">s</span>
            </motion.div>
          </ProgressRing>
        </div>

        {/* Batch Queue Stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center">
            <div className="text-base font-bold font-mono text-white">
              <AnimatedNumber value={batchQueue.orderCount} decimals={0} />
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
              <AnimatedNumber value={batchQueue.priorityOrders} decimals={0} />
            </div>
            <div className="text-[10px] text-black-500 uppercase">priority</div>
          </div>
        </div>

        {/* Phase explanation */}
        <div className="mt-3 text-center">
          <span className="text-xs text-black-300">{getPhaseExplanation()}</span>
        </div>

        {/* Bottom info */}
        <div className="flex items-center justify-between mt-3 text-xs">
          <div className="flex items-center space-x-1.5 text-black-400">
            {phase === PHASES.COMMIT && <span>orders hidden until reveal</span>}
            {phase === PHASES.REVEAL && <span>batch sealed - no new orders</span>}
            {phase === PHASES.SETTLING && <span>finding clearing price...</span>}
          </div>

          <div className="flex items-center space-x-3">
            {userStatus && (
              <div className="flex items-center space-x-1.5">
                <PulseIndicator color={userStatus.color} size="sm" />
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
    </div>
  )
}

export default BatchTimer
