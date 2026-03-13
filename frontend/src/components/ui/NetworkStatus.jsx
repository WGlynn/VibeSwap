import { motion } from 'framer-motion'

// ============================================================
// NetworkStatus — Chain connectivity and health status
// Used in headers, settings, network selector
// ============================================================

const CHAIN_INFO = {
  1: { name: 'Ethereum', color: '#627eea' },
  42161: { name: 'Arbitrum', color: '#28a0f0' },
  10: { name: 'Optimism', color: '#ff0420' },
  8453: { name: 'Base', color: '#0052ff' },
  137: { name: 'Polygon', color: '#8247e5' },
  43114: { name: 'Avalanche', color: '#e84142' },
}

export default function NetworkStatus({
  chainId = 1,
  blockNumber,
  latency,
  connected = true,
  className = '',
}) {
  const chain = CHAIN_INFO[chainId] || { name: 'Unknown', color: '#6b7280' }

  const statusColor = !connected ? '#ef4444' : latency && latency > 1000 ? '#f59e0b' : '#22c55e'
  const statusLabel = !connected ? 'Disconnected' : latency && latency > 1000 ? 'Slow' : 'Connected'

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <motion.div
        className="w-2 h-2 rounded-full"
        style={{ background: statusColor }}
        animate={connected ? { opacity: [0.5, 1, 0.5] } : {}}
        transition={{ duration: 2, repeat: Infinity }}
      />
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-mono font-bold" style={{ color: chain.color }}>
          {chain.name}
        </span>
        {blockNumber && (
          <span className="text-[9px] font-mono text-black-600 tabular-nums">
            #{blockNumber.toLocaleString()}
          </span>
        )}
        {latency !== undefined && (
          <span className="text-[9px] font-mono text-black-600">
            {latency}ms
          </span>
        )}
      </div>
    </div>
  )
}
