// ============================================================
// RateCard — Exchange rate display with comparison
// Used for swap review, aggregator, rate comparison
// ============================================================

const CYAN = '#06b6d4'

export default function RateCard({
  tokenIn = 'ETH',
  tokenOut = 'USDC',
  rate = 0,
  inverseRate = 0,
  source = 'VibeSwap',
  bestRate = false,
  className = '',
}) {
  return (
    <div
      className={`rounded-xl border p-3 ${className}`}
      style={{
        background: bestRate ? `${CYAN}05` : 'rgba(255,255,255,0.02)',
        borderColor: bestRate ? `${CYAN}30` : 'rgba(255,255,255,0.06)',
      }}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-mono text-black-500">{source}</span>
        {bestRate && (
          <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-full"
            style={{ color: '#22c55e', background: 'rgba(34,197,94,0.1)' }}
          >
            Best Rate
          </span>
        )}
      </div>
      <div className="text-xs font-mono font-bold text-white mb-0.5">
        1 {tokenIn} = {rate.toLocaleString(undefined, { maximumFractionDigits: 6 })} {tokenOut}
      </div>
      {inverseRate > 0 && (
        <div className="text-[9px] font-mono text-black-600">
          1 {tokenOut} = {inverseRate.toLocaleString(undefined, { maximumFractionDigits: 8 })} {tokenIn}
        </div>
      )}
    </div>
  )
}
