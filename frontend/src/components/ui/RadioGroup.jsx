import { motion } from 'framer-motion'

// ============================================================
// RadioGroup — Styled radio button group for single selection
// Used for settings, option selection, filter modes
// ============================================================

const CYAN = '#06b6d4'

export default function RadioGroup({
  options = [],
  value,
  onChange,
  name = 'radio-group',
  direction = 'vertical',
  className = '',
}) {
  return (
    <div className={`flex ${direction === 'horizontal' ? 'flex-row gap-4' : 'flex-col gap-2'} ${className}`}>
      {options.map((opt) => {
        const optValue = typeof opt === 'string' ? opt : opt.value
        const optLabel = typeof opt === 'string' ? opt : opt.label
        const optDescription = typeof opt === 'object' ? opt.description : undefined
        const isSelected = value === optValue

        return (
          <label
            key={optValue}
            className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
              isSelected
                ? 'border-cyan-500/40 bg-cyan-500/5'
                : 'border-black-700/50 hover:border-black-600 bg-transparent'
            }`}
          >
            <div className="mt-0.5 shrink-0">
              <div
                className="w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors"
                style={{
                  borderColor: isSelected ? CYAN : 'rgba(255,255,255,0.15)',
                }}
              >
                {isSelected && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="w-2 h-2 rounded-full"
                    style={{ background: CYAN }}
                  />
                )}
              </div>
              <input
                type="radio"
                name={name}
                value={optValue}
                checked={isSelected}
                onChange={() => onChange(optValue)}
                className="sr-only"
              />
            </div>
            <div>
              <span className={`text-sm font-mono ${isSelected ? 'text-white' : 'text-black-300'}`}>
                {optLabel}
              </span>
              {optDescription && (
                <p className="text-xs text-black-500 mt-0.5">{optDescription}</p>
              )}
            </div>
          </label>
        )
      })}
    </div>
  )
}
