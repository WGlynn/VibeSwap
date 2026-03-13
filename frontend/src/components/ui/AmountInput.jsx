// ============================================================
// AmountInput — Token amount input with balance display
// Used for swap, bridge, stake, lend forms
// ============================================================

export default function AmountInput({
  value,
  onChange,
  token,
  balance,
  label = 'Amount',
  onMax,
  disabled = false,
  className = '',
}) {
  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-mono text-black-500 uppercase tracking-wider">{label}</span>
        {balance !== undefined && (
          <button
            onClick={onMax}
            className="text-[10px] font-mono text-black-400 hover:text-cyan-400 transition-colors"
          >
            Balance: {Number(balance).toLocaleString('en-US', { maximumFractionDigits: 4 })}
          </button>
        )}
      </div>
      <div className="flex items-center gap-2 rounded-lg border border-black-700 bg-black-900/40 px-3 py-2.5">
        <input
          type="text"
          value={value}
          onChange={(e) => {
            const v = e.target.value.replace(/[^0-9.]/g, '')
            const parts = v.split('.')
            const cleaned = parts.length > 2 ? parts[0] + '.' + parts.slice(1).join('') : v
            onChange(cleaned)
          }}
          placeholder="0.00"
          disabled={disabled}
          className="flex-1 bg-transparent text-lg font-mono font-bold text-white placeholder:text-black-600 focus:outline-none disabled:opacity-50 min-w-0"
          inputMode="decimal"
        />
        {token && (
          <span className="text-sm font-mono font-bold text-black-300 shrink-0">{token}</span>
        )}
      </div>
    </div>
  )
}
