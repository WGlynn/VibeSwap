// ============================================================
// FeeBreakdown — Itemized fee display for transactions
// Used for swap review, bridge, staking confirmations
// ============================================================

const CYAN = '#06b6d4'

export default function FeeBreakdown({
  items = [],
  total,
  totalLabel = 'Total Cost',
  className = '',
}) {
  const computedTotal = total ?? items.reduce((sum, i) => sum + (i.amount || 0), 0)

  return (
    <div
      className={`rounded-xl border p-3 ${className}`}
      style={{
        background: 'rgba(255,255,255,0.02)',
        borderColor: 'rgba(255,255,255,0.06)',
      }}
    >
      <div className="space-y-1.5">
        {items.map((item, i) => (
          <div key={i} className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-mono text-black-500">{item.label}</span>
              {item.free && (
                <span className="text-[8px] font-mono font-bold px-1 py-px rounded"
                  style={{ color: '#22c55e', background: 'rgba(34,197,94,0.1)' }}
                >
                  FREE
                </span>
              )}
            </div>
            <span className={`text-[10px] font-mono ${item.free ? 'text-black-600 line-through' : 'text-black-400'}`}>
              {item.free ? item.originalAmount || item.amount : item.formatted || `$${item.amount?.toFixed(2)}`}
            </span>
          </div>
        ))}
      </div>

      <div
        className="mt-2 pt-2 flex items-center justify-between border-t"
        style={{ borderColor: 'rgba(255,255,255,0.06)' }}
      >
        <span className="text-[10px] font-mono font-bold text-black-400">{totalLabel}</span>
        <span className="text-xs font-mono font-bold text-white">
          ${computedTotal.toFixed(2)}
        </span>
      </div>
    </div>
  )
}
