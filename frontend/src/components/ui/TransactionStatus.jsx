import { motion } from 'framer-motion'

// ============================================================
// TransactionStatus — Step-based transaction progress
// Used for swap, bridge, multi-step transactions
// ============================================================

const CYAN = '#06b6d4'

const STATUS_CONFIG = {
  pending: { color: '#f59e0b', icon: '⏳', label: 'Pending' },
  confirming: { color: CYAN, icon: '🔄', label: 'Confirming' },
  confirmed: { color: '#22c55e', icon: '✓', label: 'Confirmed' },
  failed: { color: '#ef4444', icon: '✕', label: 'Failed' },
}

export default function TransactionStatus({
  steps = [],
  currentStep = 0,
  status = 'pending',
  txHash,
  className = '',
}) {
  if (steps.length === 0) {
    const config = STATUS_CONFIG[status] || STATUS_CONFIG.pending

    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <motion.span
          animate={status === 'confirming' ? { rotate: 360 } : {}}
          transition={{ duration: 1, repeat: status === 'confirming' ? Infinity : 0, ease: 'linear' }}
          className="text-sm"
        >
          {config.icon}
        </motion.span>
        <span className="text-xs font-mono font-medium" style={{ color: config.color }}>
          {config.label}
        </span>
        {txHash && (
          <span className="text-[9px] font-mono text-black-600">
            {txHash.slice(0, 6)}...{txHash.slice(-4)}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {steps.map((step, i) => {
        const isDone = i < currentStep
        const isCurrent = i === currentStep
        const isFailed = isCurrent && status === 'failed'

        return (
          <div key={i} className="flex items-start gap-3">
            <div className="flex flex-col items-center">
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-mono font-bold border"
                style={{
                  background: isDone ? '#22c55e20' : isFailed ? '#ef444420' : isCurrent ? `${CYAN}20` : 'transparent',
                  borderColor: isDone ? '#22c55e' : isFailed ? '#ef4444' : isCurrent ? CYAN : 'rgba(255,255,255,0.1)',
                  color: isDone ? '#22c55e' : isFailed ? '#ef4444' : isCurrent ? CYAN : '#6b7280',
                }}
              >
                {isDone ? '✓' : isFailed ? '✕' : i + 1}
              </div>
              {i < steps.length - 1 && (
                <div
                  className="w-px h-4 mt-1"
                  style={{ background: isDone ? '#22c55e40' : 'rgba(255,255,255,0.06)' }}
                />
              )}
            </div>
            <div className="pt-0.5">
              <span className={`text-xs font-mono font-medium ${isDone ? 'text-black-500' : isCurrent ? 'text-white' : 'text-black-600'}`}>
                {step}
              </span>
              {isCurrent && status === 'confirming' && (
                <motion.span
                  className="ml-2 text-[9px] font-mono"
                  style={{ color: CYAN }}
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                >
                  Processing...
                </motion.span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
