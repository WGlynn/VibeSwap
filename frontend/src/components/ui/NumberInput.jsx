import { useState, useCallback } from 'react'

// ============================================================
// NumberInput — Formatted number input for amounts/prices
// Handles decimal places, max values, and display formatting
// ============================================================

const CYAN = '#06b6d4'

export default function NumberInput({
  value,
  onChange,
  placeholder = '0.0',
  maxDecimals = 6,
  max,
  label,
  suffix,
  prefix,
  error,
  className = '',
}) {
  const [focused, setFocused] = useState(false)

  const handleChange = useCallback(
    (e) => {
      let v = e.target.value
      // Allow only numbers and one decimal point
      v = v.replace(/[^0-9.]/g, '')
      // Only one decimal
      const parts = v.split('.')
      if (parts.length > 2) v = parts[0] + '.' + parts.slice(1).join('')
      // Limit decimals
      if (parts.length === 2 && parts[1].length > maxDecimals) {
        v = parts[0] + '.' + parts[1].slice(0, maxDecimals)
      }
      // Check max
      if (max !== undefined && parseFloat(v) > max) return
      onChange(v)
    },
    [onChange, maxDecimals, max]
  )

  const setMax = useCallback(() => {
    if (max !== undefined) onChange(String(max))
  }, [max, onChange])

  return (
    <div className={className}>
      {label && (
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-[10px] font-mono text-black-500 uppercase tracking-wider">{label}</label>
          {max !== undefined && (
            <button onClick={setMax} className="text-[9px] font-mono text-black-500 hover:text-cyan-400 transition-colors">
              Max: {max}
            </button>
          )}
        </div>
      )}
      <div
        className="flex items-center rounded-xl transition-all"
        style={{
          background: 'rgba(0,0,0,0.3)',
          border: `1px solid ${error ? 'rgba(239,68,68,0.4)' : focused ? `${CYAN}40` : 'rgba(255,255,255,0.06)'}`,
        }}
      >
        {prefix && <span className="pl-3 text-[11px] font-mono text-black-500">{prefix}</span>}
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={handleChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          className="flex-1 bg-transparent px-3 py-2.5 text-sm font-mono text-white placeholder:text-black-600 focus:outline-none text-right"
        />
        {suffix && <span className="pr-3 text-[11px] font-mono text-black-400 font-bold">{suffix}</span>}
      </div>
      {error && <p className="text-[9px] font-mono text-red-400 mt-1">{error}</p>}
    </div>
  )
}
