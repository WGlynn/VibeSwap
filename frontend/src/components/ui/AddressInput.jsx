import { useState } from 'react'

// ============================================================
// AddressInput — Ethereum address input with validation
// Used for send, delegate, token creator, DAO tools
// ============================================================

function isValidAddress(addr) {
  return /^0x[a-fA-F0-9]{40}$/.test(addr)
}

export default function AddressInput({
  value,
  onChange,
  placeholder = '0x...',
  label,
  error,
  className = '',
}) {
  const [focused, setFocused] = useState(false)
  const isValid = value ? isValidAddress(value) : null

  return (
    <div className={className}>
      {label && (
        <label className="block text-[10px] font-mono text-black-500 uppercase tracking-wider mb-1.5">
          {label}
        </label>
      )}
      <div
        className={`flex items-center rounded-lg border px-3 py-2 transition-colors ${
          error
            ? 'border-red-500/50 bg-red-500/5'
            : focused
            ? 'border-cyan-500/40 bg-black-900/60'
            : isValid === false
            ? 'border-amber-500/40 bg-amber-500/5'
            : isValid === true
            ? 'border-green-500/40 bg-green-500/5'
            : 'border-black-700 bg-black-900/40'
        }`}
      >
        <span className="text-black-500 text-xs mr-2 shrink-0">
          {isValid === true ? '✓' : isValid === false ? '!' : '⟠'}
        </span>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-sm font-mono text-white placeholder:text-black-600 focus:outline-none"
          spellCheck={false}
          autoComplete="off"
        />
      </div>
      {error && (
        <p className="text-[10px] font-mono text-red-400 mt-1">{error}</p>
      )}
    </div>
  )
}
