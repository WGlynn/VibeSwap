import { motion } from 'framer-motion'

// ============================================================
// Stepper — Step progress indicator for multi-step flows
// Used in onboarding, transactions, KYC, tutorials
// ============================================================

const CYAN = '#06b6d4'

export default function Stepper({ steps, currentStep = 0, className = '' }) {
  return (
    <div className={`flex items-center ${className}`}>
      {steps.map((step, i) => {
        const isComplete = i < currentStep
        const isCurrent = i === currentStep
        const isLast = i === steps.length - 1
        const label = typeof step === 'string' ? step : step.label

        return (
          <div key={i} className="flex items-center flex-1 last:flex-none">
            {/* Step circle */}
            <div className="flex flex-col items-center">
              <motion.div
                className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-mono font-bold border"
                style={{
                  background: isComplete ? CYAN : isCurrent ? `${CYAN}20` : 'transparent',
                  borderColor: isComplete || isCurrent ? CYAN : 'rgba(255,255,255,0.15)',
                  color: isComplete ? '#000' : isCurrent ? CYAN : 'rgba(255,255,255,0.3)',
                }}
                animate={isCurrent ? { scale: [1, 1.08, 1] } : {}}
                transition={{ duration: 2, repeat: Infinity }}
              >
                {isComplete ? (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  i + 1
                )}
              </motion.div>
              {label && (
                <span
                  className="mt-1.5 text-[9px] font-mono uppercase tracking-wider text-center max-w-[60px]"
                  style={{ color: isComplete || isCurrent ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.25)' }}
                >
                  {label}
                </span>
              )}
            </div>

            {/* Connector line */}
            {!isLast && (
              <div className="flex-1 mx-2 h-px relative" style={{ background: 'rgba(255,255,255,0.1)' }}>
                <motion.div
                  className="absolute inset-y-0 left-0 h-px"
                  style={{ background: CYAN }}
                  initial={{ width: 0 }}
                  animate={{ width: isComplete ? '100%' : '0%' }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
