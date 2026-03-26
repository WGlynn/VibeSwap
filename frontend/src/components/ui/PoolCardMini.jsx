import { Link } from 'react-router-dom'

// ============================================================
// PoolCardMini — Compact pool summary card
// Used in grids, lists, dashboards for quick pool overview
// ============================================================

const CYAN = '#06b6d4'

export default function PoolCardMini({
  id,
  tokenA = 'ETH',
  tokenB = 'USDC',
  apy = 0,
  tvl = 0,
  volume24h = 0,
  fee = 0.3,
  className = '',
}) {
  function fmt(n) {
    if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
    if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
    return `$${n.toFixed(0)}`
  }

  return (
    <Link
      to={id ? `/pool/${id}` : '/earn'}
      className={`block rounded-xl border p-3 transition-all duration-200 hover:border-cyan-500/30 hover:bg-white/[0.02] ${className}`}
      style={{ borderColor: 'rgba(255,255,255,0.06)' }}
    >
      {/* Pair header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="flex">
            <span className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-mono font-bold text-white" style={{ background: '#627eea', zIndex: 2 }}>
              {tokenA.charAt(0)}
            </span>
            <span className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-mono font-bold text-white -ml-2" style={{ background: '#2775ca', zIndex: 1 }}>
              {tokenB.charAt(0)}
            </span>
          </div>
          <span className="text-xs font-mono font-bold text-white">
            {tokenA}/{tokenB}
          </span>
        </div>
        <span className="text-[9px] font-mono text-black-500 px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.04)' }}>
          {fee}%
        </span>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-3 gap-2">
        <div>
          <span className="text-[9px] font-mono text-black-600 block">30d Fees</span>
          <span className="text-[10px] font-mono font-bold text-green-400">{apy.toFixed(1)}%</span>
        </div>
        <div>
          <span className="text-[9px] font-mono text-black-600 block">TVL</span>
          <span className="text-[10px] font-mono font-bold text-white">{fmt(tvl)}</span>
        </div>
        <div>
          <span className="text-[9px] font-mono text-black-600 block">24h Vol</span>
          <span className="text-[10px] font-mono font-bold text-white">{fmt(volume24h)}</span>
        </div>
      </div>
    </Link>
  )
}
