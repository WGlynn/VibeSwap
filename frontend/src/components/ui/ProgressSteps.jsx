import { motion } from 'framer-motion'

// ============================================================
// ProgressSteps — Horizontal step progress with connectors
// Used for multi-step flows: bridge, swap, onboarding
// ============================================================

const CYAN = '#06b6d4'

export default function ProgressSteps({
  steps = [],
  currentStep = 0,
  className = '',
}) {
  return (
    <div className={`flex items-center ${className}`}>
      {steps.map((step, i) => {
        const isDone = i < currentStep
        const isCurrent = i === currentStep
        const label = typeof step === 'string' ? step : step.label

        return (
          <div key={i} className="flex items-center flex-1 last:flex-none">
            {/* Step circle */}
            <div className="flex flex-col items-center gap-1">
              <motion.div
                className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-mono font-bold border-2 transition-colors"
                style={{
                  background: isDone ? CYAN : isCurrent ? `${CYAN}20` : 'transparent',
                  borderColor: isDone || isCurrent ? CYAN : 'rgba(255,255,255,0.1)',
                  color: isDone ? '#000' : isCurrent ? CYAN : '#6b7280',
                }}
                animate={isCurrent ? { scale: [1, 1.05, 1] } : {}}
                transition={{ duration: 2, repeat: isCurrent ? Infinity : 0 }}
              >
                {isDone ? '✓' : i + 1}
              </motion.div>
              <span className={`text-[9px] font-mono whitespace-nowrap ${isDone || isCurrent ? 'text-white' : 'text-black-600'}`}>
                {label}
              </span>
            </div>

            {/* Connector line */}
            {i < steps.length - 1 && (
              <div className="flex-1 h-0.5 mx-2 rounded-full mt-[-16px]"
                style={{
                  background: isDone ? CYAN : 'rgba(255,255,255,0.06)',
                }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
