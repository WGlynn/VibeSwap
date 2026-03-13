import { useState, useCallback, useRef } from 'react'

// ============================================================
// Slider — Range input with track, thumb, and value display
// Used for slippage, leverage, allocation, amounts
// ============================================================

const CYAN = '#06b6d4'

export default function Slider({
  value = 0,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  label,
  suffix = '',
  showValue = true,
  marks,
  className = '',
}) {
  const [dragging, setDragging] = useState(false)
  const trackRef = useRef(null)

  const pct = ((value - min) / (max - min)) * 100

  const handleInput = useCallback(
    (e) => {
      const v = parseFloat(e.target.value)
      onChange?.(v)
    },
    [onChange]
  )

  return (
    <div className={className}>
      {(label || showValue) && (
        <div className="flex items-center justify-between mb-2">
          {label && (
            <span className="text-[10px] font-mono text-black-500 uppercase tracking-wider">{label}</span>
          )}
          {showValue && (
            <span className="text-sm font-mono font-bold" style={{ color: CYAN }}>
              {value}{suffix}
            </span>
          )}
        </div>
      )}

      <div className="relative" ref={trackRef}>
        {/* Custom track visual */}
        <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
          <div
            className="h-full rounded-full transition-all duration-75"
            style={{
              width: `${pct}%`,
              background: `linear-gradient(90deg, ${CYAN}80, ${CYAN})`,
              boxShadow: dragging ? `0 0 8px ${CYAN}40` : 'none',
            }}
          />
        </div>

        {/* Native range input (invisible but accessible) */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={handleInput}
          onMouseDown={() => setDragging(true)}
          onMouseUp={() => setDragging(false)}
          onTouchStart={() => setDragging(true)}
          onTouchEnd={() => setDragging(false)}
          className="w-full h-6 appearance-none bg-transparent cursor-pointer relative z-10"
          style={{
            WebkitAppearance: 'none',
          }}
        />

        {/* Marks */}
        {marks && (
          <div className="flex justify-between mt-1">
            {marks.map((mark, i) => (
              <button
                key={i}
                onClick={() => onChange?.(mark.value)}
                className="text-[9px] font-mono text-black-600 hover:text-black-400 transition-colors"
              >
                {mark.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <style>{`
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: ${CYAN};
          border: 2px solid rgba(0,0,0,0.4);
          cursor: pointer;
          box-shadow: 0 0 6px ${CYAN}40;
        }
        input[type="range"]::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: ${CYAN};
          border: 2px solid rgba(0,0,0,0.4);
          cursor: pointer;
        }
      `}</style>
    </div>
  )
}
