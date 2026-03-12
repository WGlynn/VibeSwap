import { memo } from 'react'

// ============================================================
// Chain Badge — Reusable blockchain network indicator
// Shows chain name with colored dot, used in Bridge, CrossChain, etc.
// ============================================================

const CHAINS = {
  ethereum: { name: 'Ethereum', color: '#627eea', shortName: 'ETH' },
  arbitrum: { name: 'Arbitrum', color: '#28a0f0', shortName: 'ARB' },
  base: { name: 'Base', color: '#0052ff', shortName: 'BASE' },
  optimism: { name: 'Optimism', color: '#ff0420', shortName: 'OP' },
  solana: { name: 'Solana', color: '#9945ff', shortName: 'SOL' },
  nervos: { name: 'Nervos CKB', color: '#3cc68a', shortName: 'CKB' },
  avalanche: { name: 'Avalanche', color: '#e84142', shortName: 'AVAX' },
  polygon: { name: 'Polygon', color: '#8247e5', shortName: 'MATIC' },
  bsc: { name: 'BNB Chain', color: '#f0b90b', shortName: 'BSC' },
  fantom: { name: 'Fantom', color: '#1969ff', shortName: 'FTM' },
}

function ChainBadge({ chain, size = 'sm', showName = true, active = true, className = '' }) {
  const info = CHAINS[chain] || { name: chain, color: '#666', shortName: chain?.slice(0, 4)?.toUpperCase() }

  const sizes = {
    xs: { dot: 'w-1.5 h-1.5', text: 'text-[9px]', px: 'px-1.5 py-0.5' },
    sm: { dot: 'w-2 h-2', text: 'text-[10px]', px: 'px-2 py-1' },
    md: { dot: 'w-2.5 h-2.5', text: 'text-xs', px: 'px-3 py-1.5' },
  }
  const s = sizes[size] || sizes.sm

  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full font-mono ${s.px} ${className}`}
      style={{
        backgroundColor: `${info.color}10`,
        border: `1px solid ${info.color}30`,
        opacity: active ? 1 : 0.5,
      }}
    >
      <div
        className={`${s.dot} rounded-full shrink-0 ${active ? 'animate-pulse' : ''}`}
        style={{ backgroundColor: info.color }}
      />
      {showName && (
        <span className={`${s.text} font-medium`} style={{ color: info.color }}>
          {info.shortName}
        </span>
      )}
    </div>
  )
}

export default memo(ChainBadge)
export { CHAINS }
