import { useCallback } from 'react'

// ============================================================
// SliderInput — Range slider with value display
// Used for slippage, leverage, amounts, percentages
// ============================================================

const CYAN = '#06b6d4'

export default function SliderInput({
  value = 50,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  label,
  unit = '',
  showTicks = false,
  tickLabels = [],
  disabled = false,
  className = '',
}) {
  const pct = ((value - min) / (max - min)) * 100

  const handleChange = useCallback((e) => {
    onChange && onChange(parseFloat(e.target.value))
  }, [onChange])

  return (
    <div className={`${className}`}>
      {(label || unit) && (
        <div className="flex items-center justify-between mb-2">
          {label && (
            <span className="text-xs font-mono text-black-400">{label}</span>
          )}
          <span className="text-xs font-mono font-bold text-white">
            {value}{unit}
          </span>
        </div>
      )}

      <div className="relative">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={handleChange}
          disabled={disabled}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            background: `linear-gradient(to right, ${CYAN} 0%, ${CYAN} ${pct}%, rgba(255,255,255,0.08) ${pct}%, rgba(255,255,255,0.08) 100%)`,
            WebkitAppearance: 'none',
          }}
        />
      </div>

      {showTicks && tickLabels.length > 0 && (
        <div className="flex items-center justify-between mt-1">
          {tickLabels.map((tick) => (
            <button
              key={tick}
              onClick={() => onChange && onChange(tick)}
              className="text-[9px] font-mono text-black-500 hover:text-cyan-400 transition-colors"
            >
              {tick}{unit}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
