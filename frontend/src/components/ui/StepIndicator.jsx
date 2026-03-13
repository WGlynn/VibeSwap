import { motion } from 'framer-motion'

// ============================================================
// StepIndicator — Horizontal step progress for multi-step flows
// Used for onboarding, token creation, bridge transactions
// ============================================================

const CYAN = '#06b6d4'

export default function StepIndicator({
  steps = [],
  currentStep = 0,
  className = '',
}) {
  return (
    <div className={`flex items-center ${className}`}>
      {steps.map((step, i) => {
        const label = typeof step === 'string' ? step : step.label
        const isComplete = i < currentStep
        const isCurrent = i === currentStep
        const isLast = i === steps.length - 1

        return (
          <div key={i} className="flex items-center flex-1 last:flex-none">
            {/* Step circle */}
            <div className="flex flex-col items-center">
              <motion.div
                className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-mono font-bold border-2"
                style={{
                  borderColor: isComplete || isCurrent ? CYAN : 'rgba(255,255,255,0.1)',
                  background: isComplete ? CYAN : 'transparent',
                  color: isComplete ? '#000' : isCurrent ? CYAN : 'rgba(255,255,255,0.3)',
                }}
                animate={isCurrent ? { boxShadow: `0 0 12px ${CYAN}40` } : { boxShadow: 'none' }}
              >
                {isComplete ? (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  i + 1
                )}
              </motion.div>
              <span
                className={`text-[9px] font-mono mt-1.5 whitespace-nowrap ${
                  isCurrent ? 'text-cyan-400' : isComplete ? 'text-black-300' : 'text-black-600'
                }`}
              >
                {label}
              </span>
            </div>

            {/* Connector line */}
            {!isLast && (
              <div className="flex-1 h-0.5 mx-2 rounded-full" style={{
                background: isComplete ? CYAN : 'rgba(255,255,255,0.06)',
              }} />
            )}
          </div>
        )
      })}
    </div>
  )
}
