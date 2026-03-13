// ============================================================
// NetworkIcon — Chain/network icon with color
// Used for chain selectors, network indicators, bridge UI
// ============================================================

const NETWORKS = {
  ethereum: { color: '#627EEA', label: 'ETH', icon: '⟠' },
  arbitrum: { color: '#28A0F0', label: 'ARB', icon: '🔵' },
  optimism: { color: '#FF0420', label: 'OP', icon: '🔴' },
  polygon: { color: '#8247E5', label: 'MATIC', icon: '🟣' },
  base: { color: '#0052FF', label: 'BASE', icon: '🔷' },
  avalanche: { color: '#E84142', label: 'AVAX', icon: '🔺' },
  bsc: { color: '#F0B90B', label: 'BNB', icon: '🟡' },
  nervos: { color: '#3CC68A', label: 'CKB', icon: '🟢' },
  solana: { color: '#9945FF', label: 'SOL', icon: '🟪' },
}

export default function NetworkIcon({
  network,
  size = 20,
  showLabel = false,
  className = '',
}) {
  const net = NETWORKS[network?.toLowerCase()] || { color: '#6b7280', label: network || '?', icon: '⬜' }

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span
        className="inline-flex items-center justify-center rounded-full shrink-0"
        style={{
          width: size,
          height: size,
          background: `${net.color}20`,
          border: `1px solid ${net.color}40`,
          fontSize: size * 0.5,
        }}
      >
        {net.icon}
      </span>
      {showLabel && (
        <span className="text-xs font-mono text-black-300">{net.label}</span>
      )}
    </span>
  )
}
