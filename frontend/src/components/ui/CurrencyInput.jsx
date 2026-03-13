import { useState, useCallback } from 'react'

// ============================================================
// CurrencyInput — Token amount input with USD conversion
// Used for swap, bridge, staking, any amount entry
// ============================================================

const CYAN = '#06b6d4'

export default function CurrencyInput({
  value = '',
  onChange,
  token = 'ETH',
  tokenIcon,
  usdPrice = 0,
  balance,
  onMaxClick,
  placeholder = '0.00',
  disabled = false,
  className = '',
}) {
  const [focused, setFocused] = useState(false)

  const usdValue = value && usdPrice
    ? (parseFloat(value) * usdPrice).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    : null

  const handleChange = useCallback((e) => {
    const v = e.target.value
    if (v === '' || /^\d*\.?\d*$/.test(v)) {
      onChange && onChange(v)
    }
  }, [onChange])

  return (
    <div
      className={`rounded-xl border transition-all duration-200 ${className}`}
      style={{
        background: 'rgba(255,255,255,0.03)',
        borderColor: focused ? `${CYAN}60` : 'rgba(255,255,255,0.06)',
        boxShadow: focused ? `0 0 0 1px ${CYAN}20` : 'none',
      }}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={handleChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          disabled={disabled}
          className="flex-1 bg-transparent text-xl font-mono font-bold text-white placeholder-black-600 outline-none min-w-0"
        />
        <div className="flex items-center gap-2 shrink-0">
          {tokenIcon && <span className="text-lg">{tokenIcon}</span>}
          <span className="text-sm font-mono font-bold text-white">{token}</span>
        </div>
      </div>
      <div className="flex items-center justify-between px-4 pb-2">
        <span className="text-[10px] font-mono text-black-500">
          {usdValue || '\u00A0'}
        </span>
        {balance !== undefined && (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono text-black-500">
              Balance: {balance}
            </span>
            {onMaxClick && (
              <button
                onClick={onMaxClick}
                className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded transition-colors"
                style={{ color: CYAN, background: `${CYAN}15` }}
              >
                MAX
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
