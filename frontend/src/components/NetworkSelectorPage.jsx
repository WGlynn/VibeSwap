import { useState, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// ============ Seeded PRNG (seed 2424) ============
function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return (s - 1) / 2147483646
  }
}

const rng = seededRandom(2424)

function randRange(min, max) {
  return min + rng() * (max - min)
}

function randInt(min, max) {
  return Math.floor(randRange(min, max + 1))
}

function pick(arr) {
  return arr[Math.floor(rng() * arr.length)]
}

// ============ Chain Definitions ============
const CHAINS = [
  {
    id: 1, name: 'Ethereum', logo: '\u27e0', hex: '#627EEA',
    blockTime: 12.1, gasUnit: 'gwei', consensus: 'PoS',
    explorer: 'https://etherscan.io', lzEid: 30101,
  },
  {
    id: 42161, name: 'Arbitrum', logo: '\u25c8', hex: '#28A0F0',
    blockTime: 0.26, gasUnit: 'gwei', consensus: 'Optimistic Rollup',
    explorer: 'https://arbiscan.io', lzEid: 30110,
  },
  {
    id: 10, name: 'Optimism', logo: '\u2295', hex: '#FF0420',
    blockTime: 2.0, gasUnit: 'gwei', consensus: 'Optimistic Rollup',
    explorer: 'https://optimistic.etherscan.io', lzEid: 30111,
  },
  {
    id: 137, name: 'Polygon', logo: '\u2b20', hex: '#8247E5',
    blockTime: 2.1, gasUnit: 'gwei', consensus: 'PoS',
    explorer: 'https://polygonscan.com', lzEid: 30109,
  },
  {
    id: 8453, name: 'Base', logo: '\u2b21', hex: '#0052FF',
    blockTime: 2.0, gasUnit: 'gwei', consensus: 'Optimistic Rollup',
    explorer: 'https://basescan.org', lzEid: 30184,
  },
  {
    id: 43114, name: 'Avalanche', logo: '\u25b2', hex: '#E84142',
    blockTime: 2.0, gasUnit: 'nAVAX', consensus: 'Snowman',
    explorer: 'https://snowtrace.io', lzEid: 30106,
  },
  {
    id: 56, name: 'BSC', logo: '\u25c7', hex: '#F3BA2F',
    blockTime: 3.0, gasUnit: 'gwei', consensus: 'PoSA',
    explorer: 'https://bscscan.com', lzEid: 30102,
  },
  {
    id: 'sol', name: 'Solana', logo: '\u25ce', hex: '#9945FF',
    blockTime: 0.4, gasUnit: 'lamports', consensus: 'PoH + Tower BFT',
    explorer: 'https://solscan.io', lzEid: 30168,
  },
]

// ============ Generate Deterministic Mock Data ============
const chainData = CHAINS.map(chain => {
  const gasPrice = chain.id === 1
    ? randRange(18, 55).toFixed(1)
    : chain.id === 56
      ? randRange(3, 8).toFixed(1)
      : chain.id === 'sol'
        ? randInt(5000, 25000).toString()
        : randRange(0.001, 0.15).toFixed(4)
  const tvl = chain.id === 1
    ? randRange(28, 42).toFixed(1) + 'B'
    : chain.id === 42161
      ? randRange(2.5, 4.8).toFixed(2) + 'B'
      : chain.id === 'sol'
        ? randRange(3.0, 6.5).toFixed(2) + 'B'
        : randRange(0.3, 2.2).toFixed(2) + 'B'
  const latencyMs = chain.id === 1
    ? randInt(85, 200)
    : chain.id === 'sol'
      ? randInt(40, 120)
      : randInt(30, 150)
  const statusOptions = ['healthy', 'healthy', 'healthy', 'healthy', 'healthy', 'degraded']
  const rpcStatus = pick(statusOptions)
  const gasHistory = Array.from({ length: 24 }, () => {
    const base = parseFloat(gasPrice) || 10
    return +(base * randRange(0.6, 1.5)).toFixed(2)
  })

  return {
    ...chain,
    gasPrice,
    tvl,
    latencyMs,
    rpcStatus,
    gasHistory,
    tps: chain.id === 'sol' ? randInt(2800, 4200) : randInt(12, 180),
    pendingTx: randInt(200, 18000),
  }
})

// ============ LayerZero Messaging Stats ============
const lzStats = []
const chainPairs = []
for (let i = 0; i < CHAINS.length; i++) {
  for (let j = i + 1; j < CHAINS.length; j++) {
    chainPairs.push([i, j])
  }
}
chainPairs.forEach(([i, j]) => {
  lzStats.push({
    from: CHAINS[i].name,
    to: CHAINS[j].name,
    fromHex: CHAINS[i].hex,
    toHex: CHAINS[j].hex,
    messages24h: randInt(120, 9500),
    avgTime: randRange(15, 300).toFixed(0),
    successRate: randRange(99.2, 100).toFixed(2),
  })
})
// Sort by volume descending
lzStats.sort((a, b) => b.messages24h - a.messages24h)

// ============ Bridge Quick-Link Pairs ============
const bridgePairs = chainPairs.slice(0, 10).map(([i, j]) => ({
  from: CHAINS[i],
  to: CHAINS[j],
  route: pick(['LayerZero V2', 'Canonical', 'Fast Lane']),
  estTime: pick(['~30s', '~2 min', '~5 min', '~15 min']),
}))

// ============ Helper Components ============
function ChainDot({ chain, size = 20 }) {
  return (
    <div
      className="flex items-center justify-center rounded-full font-bold flex-shrink-0"
      style={{
        width: size,
        height: size,
        backgroundColor: chain.hex + '22',
        color: chain.hex,
        fontSize: size * 0.55,
      }}
    >
      {chain.logo}
    </div>
  )
}

function StatusDot({ status }) {
  const colors = {
    healthy: 'bg-green-400',
    degraded: 'bg-yellow-400 animate-pulse',
    down: 'bg-red-500 animate-pulse',
  }
  const labels = { healthy: 'Healthy', degraded: 'Degraded', down: 'Down' }
  const textColors = { healthy: 'text-green-400', degraded: 'text-yellow-400', down: 'text-red-500' }
  return (
    <div className="flex items-center space-x-1.5">
      <div className={`w-2 h-2 rounded-full ${colors[status]}`} />
      <span className={`text-[10px] font-medium ${textColors[status]}`}>{labels[status]}</span>
    </div>
  )
}

function LatencyBar({ ms }) {
  const maxMs = 250
  const pct = Math.min(ms / maxMs, 1) * 100
  const color = ms < 80 ? '#22c55e' : ms < 150 ? '#eab308' : '#ef4444'
  return (
    <div className="flex items-center space-x-2">
      <div className="flex-1 h-1.5 rounded-full bg-black-800 overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 1 / PHI, ease: 'easeOut' }}
        />
      </div>
      <span className="text-[10px] font-mono text-black-400 w-10 text-right">{ms}ms</span>
    </div>
  )
}

function MiniChart({ data, color, height = 32 }) {
  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1
  const w = 100
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w
      const y = height - ((v - min) / range) * (height - 4)
      return `${x},${y}`
    })
    .join(' ')

  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" style={{ height }}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ============ Section Header ============
function SectionHeader({ icon, title, count }) {
  return (
    <div className="flex items-center space-x-2 mb-4">
      <span className="text-base">{icon}</span>
      <span className="text-sm font-semibold text-white">{title}</span>
      {count !== undefined && (
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-black-800 text-black-400">
          {count}
        </span>
      )}
    </div>
  )
}

// ============ Main Component ============
function NetworkSelectorPage() {
  // Dual wallet detection
  const { isConnected: isExternalConnected, chainId: currentChainId, switchChain } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [activeTab, setActiveTab] = useState('grid')
  const [selectedChain, setSelectedChain] = useState(null)
  const [lzPage, setLzPage] = useState(0)

  const LZ_PER_PAGE = 8
  const lzPageCount = Math.ceil(lzStats.length / LZ_PER_PAGE)
  const lzVisible = lzStats.slice(lzPage * LZ_PER_PAGE, (lzPage + 1) * LZ_PER_PAGE)

  const currentChain = useMemo(
    () => chainData.find(c => c.id === currentChainId) || null,
    [currentChainId]
  )

  const handleSwitch = useCallback(
    (chainId) => {
      if (chainId === 'sol') return
      switchChain(chainId)
    },
    [switchChain]
  )

  const tabs = [
    { key: 'grid', label: 'Networks' },
    { key: 'compare', label: 'Compare' },
    { key: 'bridges', label: 'Bridges' },
    { key: 'lz', label: 'LayerZero' },
  ]

  return (
    <div className="max-w-6xl mx-auto px-4 pb-12">
      <PageHero
        title="Networks"
        subtitle="Supported chains, RPC health, and cross-chain infrastructure"
        category="protocol"
        badge="Live"
        badgeColor={CYAN}
      />

      {/* Current Chain Indicator */}
      {isConnected && currentChain && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1 / (PHI * PHI), ease: 'easeOut' }}
          className="mb-6"
        >
          <GlassCard glowColor="terminal" className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <ChainDot chain={currentChain} size={36} />
                <div>
                  <div className="text-xs text-black-400 font-mono">Connected Network</div>
                  <div className="text-lg font-semibold text-white">{currentChain.name}</div>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <StatusDot status={currentChain.rpcStatus} />
                <div className="text-right hidden sm:block">
                  <div className="text-xs text-black-400">Chain ID</div>
                  <div className="text-sm font-mono text-white">{currentChain.id}</div>
                </div>
              </div>
            </div>
          </GlassCard>
        </motion.div>
      )}

      {/* Tab Switcher */}
      <div className="flex mb-6 p-1 rounded-xl bg-black-800/60 border border-black-700/50">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === t.key
                ? 'bg-black-700 text-white shadow-sm'
                : 'text-black-400 hover:text-black-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {/* ============ GRID TAB ============ */}
        {activeTab === 'grid' && (
          <motion.div
            key="grid"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            transition={{ duration: 1 / (PHI * PHI * PHI) }}
          >
            {/* Chains Grid */}
            <SectionHeader icon={'\u{1f310}'} title="Supported Chains" count={CHAINS.length} />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
              {chainData.map((chain, idx) => {
                const isCurrent = currentChainId === chain.id
                return (
                  <motion.div
                    key={chain.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * (1 / (PHI * 20)), duration: 1 / (PHI * PHI) }}
                  >
                    <GlassCard
                      glowColor={isCurrent ? 'terminal' : 'none'}
                      spotlight
                      className={`p-4 cursor-pointer ${isCurrent ? 'ring-1 ring-cyan-500/30' : ''}`}
                      onClick={() => setSelectedChain(chain)}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center space-x-2.5">
                          <ChainDot chain={chain} size={32} />
                          <div>
                            <div className="text-sm font-semibold text-white">{chain.name}</div>
                            <div className="text-[10px] font-mono text-black-500">{chain.consensus}</div>
                          </div>
                        </div>
                        {isCurrent && (
                          <span
                            className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
                            style={{ backgroundColor: CYAN + '1A', color: CYAN }}
                          >
                            Active
                          </span>
                        )}
                      </div>

                      {/* Stats Row */}
                      <div className="grid grid-cols-2 gap-2 mb-3">
                        <div>
                          <div className="text-[10px] text-black-500">Block Time</div>
                          <div className="text-xs font-mono text-black-200">{chain.blockTime}s</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-black-500">Gas</div>
                          <div className="text-xs font-mono text-black-200">
                            {chain.gasPrice} {chain.gasUnit}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-black-500">TVL</div>
                          <div className="text-xs font-mono text-white">${chain.tvl}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-black-500">Latency</div>
                          <LatencyBar ms={chain.latencyMs} />
                        </div>
                      </div>

                      {/* Gas Chart */}
                      <div className="mb-3">
                        <div className="text-[10px] text-black-500 mb-1">Gas (24h)</div>
                        <MiniChart data={chain.gasHistory} color={chain.hex} height={28} />
                      </div>

                      {/* RPC + Action */}
                      <div className="flex items-center justify-between pt-2 border-t border-black-700/50">
                        <StatusDot status={chain.rpcStatus} />
                        {!isCurrent && chain.id !== 'sol' && isConnected && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleSwitch(chain.id) }}
                            className="text-[10px] px-2.5 py-1 rounded-lg font-medium transition-colors"
                            style={{ backgroundColor: chain.hex + '1A', color: chain.hex }}
                          >
                            Switch
                          </button>
                        )}
                        {chain.id === 'sol' && (
                          <span className="text-[10px] text-black-500 font-mono">Non-EVM</span>
                        )}
                      </div>
                    </GlassCard>
                  </motion.div>
                )
              })}
            </div>

            {/* RPC Status Overview */}
            <SectionHeader icon={'\u{1f4e1}'} title="RPC Health Overview" />
            <GlassCard className="p-4 mb-8">
              <div className="space-y-2">
                {chainData.map(chain => (
                  <div key={chain.id} className="flex items-center justify-between py-2 border-b border-black-800 last:border-0">
                    <div className="flex items-center space-x-3">
                      <ChainDot chain={chain} size={22} />
                      <span className="text-sm text-white">{chain.name}</span>
                    </div>
                    <div className="flex items-center space-x-4">
                      <div className="hidden sm:block w-24">
                        <LatencyBar ms={chain.latencyMs} />
                      </div>
                      <div className="text-xs font-mono text-black-400 w-16 text-right">{chain.tps} tps</div>
                      <div className="text-xs font-mono text-black-400 w-20 text-right">{chain.pendingTx.toLocaleString()} tx</div>
                      <StatusDot status={chain.rpcStatus} />
                    </div>
                  </div>
                ))}
              </div>
            </GlassCard>
          </motion.div>
        )}

        {/* ============ COMPARE TAB ============ */}
        {activeTab === 'compare' && (
          <motion.div
            key="compare"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            transition={{ duration: 1 / (PHI * PHI * PHI) }}
          >
            <SectionHeader icon={'\u{1f4ca}'} title="Chain Comparison" count={CHAINS.length} />
            <GlassCard className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-black-700">
                    {['Chain', 'Block Time', 'Gas Price', 'TVL', 'TPS', 'Latency', 'Consensus', 'RPC'].map(h => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-[10px] font-mono uppercase tracking-wider text-black-500"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {chainData.map((chain, idx) => {
                    const isCurrent = currentChainId === chain.id
                    return (
                      <motion.tr
                        key={chain.id}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.04, duration: 1 / (PHI * PHI) }}
                        className={`border-b border-black-800 last:border-0 hover:bg-black-800/40 transition-colors ${
                          isCurrent ? 'bg-cyan-500/5' : ''
                        }`}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center space-x-2.5">
                            <ChainDot chain={chain} size={24} />
                            <div>
                              <span className="font-medium text-white">{chain.name}</span>
                              {isCurrent && (
                                <span
                                  className="ml-2 text-[8px] px-1 py-0.5 rounded font-bold"
                                  style={{ backgroundColor: CYAN + '22', color: CYAN }}
                                >
                                  YOU
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono text-black-300">{chain.blockTime}s</td>
                        <td className="px-4 py-3 font-mono text-black-300">
                          {chain.gasPrice} <span className="text-black-500">{chain.gasUnit}</span>
                        </td>
                        <td className="px-4 py-3 font-mono text-white">${chain.tvl}</td>
                        <td className="px-4 py-3 font-mono text-black-300">{chain.tps}</td>
                        <td className="px-4 py-3 w-32">
                          <LatencyBar ms={chain.latencyMs} />
                        </td>
                        <td className="px-4 py-3 text-[11px] text-black-400">{chain.consensus}</td>
                        <td className="px-4 py-3">
                          <StatusDot status={chain.rpcStatus} />
                        </td>
                      </motion.tr>
                    )
                  })}
                </tbody>
              </table>
            </GlassCard>

            {/* Gas Price Charts */}
            <div className="mt-8">
              <SectionHeader icon={'\u26fd'} title="Gas Price History (24h)" />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {chainData.map((chain, idx) => (
                  <motion.div
                    key={chain.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05, duration: 1 / (PHI * PHI) }}
                  >
                    <GlassCard className="p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center space-x-2">
                          <ChainDot chain={chain} size={18} />
                          <span className="text-xs font-medium text-white">{chain.name}</span>
                        </div>
                        <span className="text-[10px] font-mono text-black-400">
                          {chain.gasPrice} {chain.gasUnit}
                        </span>
                      </div>
                      <MiniChart data={chain.gasHistory} color={chain.hex} height={40} />
                      <div className="flex justify-between mt-1 text-[9px] text-black-600 font-mono">
                        <span>24h ago</span>
                        <span>now</span>
                      </div>
                    </GlassCard>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {/* ============ BRIDGES TAB ============ */}
        {activeTab === 'bridges' && (
          <motion.div
            key="bridges"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            transition={{ duration: 1 / (PHI * PHI * PHI) }}
          >
            <SectionHeader icon={'\u{1f309}'} title="Bridge Quick-Links" count={bridgePairs.length} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
              {bridgePairs.map((pair, idx) => (
                <motion.div
                  key={`${pair.from.id}-${pair.to.id}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.04, duration: 1 / (PHI * PHI) }}
                >
                  <GlassCard spotlight className="p-4 cursor-pointer group">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="flex items-center -space-x-1.5">
                          <ChainDot chain={pair.from} size={28} />
                          <ChainDot chain={pair.to} size={28} />
                        </div>
                        <div>
                          <div className="text-sm font-medium text-white">
                            {pair.from.name}
                            <span className="text-black-500 mx-1.5">{'\u2192'}</span>
                            {pair.to.name}
                          </div>
                          <div className="text-[10px] text-black-500">via {pair.route}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs font-mono text-black-300">{pair.estTime}</div>
                        <div className="text-[10px] text-black-500">est. time</div>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <div className="flex items-center space-x-3 text-[10px] text-black-500">
                        <span>ETH, USDC, USDT</span>
                        <span className="text-black-700">|</span>
                        <span>0% protocol fee</span>
                      </div>
                      <span
                        className="text-[10px] px-2 py-0.5 rounded-md font-medium opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ backgroundColor: CYAN + '1A', color: CYAN }}
                      >
                        Bridge
                      </span>
                    </div>
                  </GlassCard>
                </motion.div>
              ))}
            </div>

            {/* Reverse Routes */}
            <SectionHeader icon={'\u{1f504}'} title="All Route Pairs" />
            <GlassCard className="p-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {CHAINS.map(from =>
                  CHAINS.filter(to => to.id !== from.id).map(to => (
                    <div
                      key={`${from.id}-${to.id}`}
                      className="flex items-center space-x-2 px-2.5 py-2 rounded-lg bg-black-800/50 border border-black-700/30 hover:border-black-600/50 transition-colors cursor-pointer"
                    >
                      <ChainDot chain={from} size={16} />
                      <span className="text-[10px] text-black-500">{'\u2192'}</span>
                      <ChainDot chain={to} size={16} />
                      <span className="text-[10px] text-black-400 truncate">
                        {from.name.slice(0, 3)}-{to.name.slice(0, 3)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </GlassCard>
          </motion.div>
        )}

        {/* ============ LAYERZERO TAB ============ */}
        {activeTab === 'lz' && (
          <motion.div
            key="lz"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            transition={{ duration: 1 / (PHI * PHI * PHI) }}
          >
            {/* LZ Summary */}
            <SectionHeader icon={'\u25c7'} title="LayerZero V2 Messaging Stats" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              {[
                {
                  label: 'Total Routes',
                  value: lzStats.length,
                  sub: 'chain pairs',
                },
                {
                  label: 'Messages (24h)',
                  value: lzStats.reduce((s, r) => s + r.messages24h, 0).toLocaleString(),
                  sub: 'cross-chain',
                },
                {
                  label: 'Avg Success',
                  value: (lzStats.reduce((s, r) => s + parseFloat(r.successRate), 0) / lzStats.length).toFixed(2) + '%',
                  sub: 'delivery rate',
                },
                {
                  label: 'Avg Finality',
                  value: Math.round(lzStats.reduce((s, r) => s + parseInt(r.avgTime), 0) / lzStats.length) + 's',
                  sub: 'confirmation',
                },
              ].map((stat, idx) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: idx * 0.06, duration: 1 / (PHI * PHI) }}
                >
                  <GlassCard className="p-3 text-center">
                    <div className="text-[10px] text-black-500 mb-1">{stat.label}</div>
                    <div className="text-lg font-bold text-white">{stat.value}</div>
                    <div className="text-[10px] text-black-500">{stat.sub}</div>
                  </GlassCard>
                </motion.div>
              ))}
            </div>

            {/* LZ Routes Table */}
            <GlassCard className="p-0 overflow-hidden mb-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-black-700">
                    {['Route', 'Messages (24h)', 'Avg Time', 'Success Rate'].map(h => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-[10px] font-mono uppercase tracking-wider text-black-500"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lzVisible.map((route, idx) => (
                    <motion.tr
                      key={`${route.from}-${route.to}`}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.03, duration: 1 / (PHI * PHI) }}
                      className="border-b border-black-800 last:border-0 hover:bg-black-800/30 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center space-x-2">
                          <div
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ backgroundColor: route.fromHex }}
                          />
                          <span className="text-white">{route.from}</span>
                          <span className="text-black-600">{'\u2192'}</span>
                          <div
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ backgroundColor: route.toHex }}
                          />
                          <span className="text-white">{route.to}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-black-300">
                        {route.messages24h.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 font-mono text-black-300">{route.avgTime}s</td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-xs font-mono px-1.5 py-0.5 rounded ${
                            parseFloat(route.successRate) >= 99.9
                              ? 'bg-green-500/10 text-green-400'
                              : 'bg-yellow-500/10 text-yellow-400'
                          }`}
                        >
                          {route.successRate}%
                        </span>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </GlassCard>

            {/* LZ Pagination */}
            {lzPageCount > 1 && (
              <div className="flex items-center justify-center space-x-2">
                <button
                  onClick={() => setLzPage(p => Math.max(0, p - 1))}
                  disabled={lzPage === 0}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-black-800 hover:bg-black-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Prev
                </button>
                <span className="text-xs font-mono text-black-400">
                  {lzPage + 1} / {lzPageCount}
                </span>
                <button
                  onClick={() => setLzPage(p => Math.min(lzPageCount - 1, p + 1))}
                  disabled={lzPage === lzPageCount - 1}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-black-800 hover:bg-black-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                </button>
              </div>
            )}

            {/* Endpoint IDs */}
            <div className="mt-6">
              <SectionHeader icon={'\u{1f517}'} title="LayerZero Endpoint IDs" />
              <GlassCard className="p-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {CHAINS.map(chain => (
                    <div
                      key={chain.id}
                      className="flex items-center space-x-2 px-3 py-2 rounded-lg bg-black-800/50"
                    >
                      <ChainDot chain={chain} size={18} />
                      <div>
                        <div className="text-[11px] text-white">{chain.name}</div>
                        <div className="text-[10px] font-mono text-black-500">EID {chain.lzEid}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </GlassCard>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ============ Chain Detail Modal ============ */}
      <AnimatePresence>
        {selectedChain && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <div
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              onClick={() => setSelectedChain(null)}
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              className="relative w-full max-w-lg glass-card rounded-2xl shadow-2xl overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between p-5 border-b border-black-700">
                <div className="flex items-center space-x-3">
                  <ChainDot chain={selectedChain} size={40} />
                  <div>
                    <h3 className="text-lg font-bold text-white">{selectedChain.name}</h3>
                    <div className="text-xs text-black-400 font-mono">
                      Chain ID: {selectedChain.id} | LZ EID: {selectedChain.lzEid}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedChain(null)}
                  className="p-2 rounded-lg hover:bg-black-700 transition-colors"
                >
                  <svg className="w-5 h-5 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Body */}
              <div className="p-5 space-y-4">
                {/* Status */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-black-400">RPC Status</span>
                  <StatusDot status={selectedChain.rpcStatus} />
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Block Time', value: `${selectedChain.blockTime}s` },
                    { label: 'Gas Price', value: `${selectedChain.gasPrice} ${selectedChain.gasUnit}` },
                    { label: 'TVL', value: `$${selectedChain.tvl}` },
                    { label: 'Latency', value: `${selectedChain.latencyMs}ms` },
                    { label: 'TPS', value: selectedChain.tps.toString() },
                    { label: 'Pending Tx', value: selectedChain.pendingTx.toLocaleString() },
                    { label: 'Consensus', value: selectedChain.consensus },
                    { label: 'LZ Endpoint', value: `EID ${selectedChain.lzEid}` },
                  ].map(item => (
                    <div key={item.label} className="p-3 rounded-xl bg-black-800/60">
                      <div className="text-[10px] text-black-500 mb-0.5">{item.label}</div>
                      <div className="text-sm font-mono text-white">{item.value}</div>
                    </div>
                  ))}
                </div>

                {/* Gas History Chart */}
                <div>
                  <div className="text-xs text-black-400 mb-2">Gas Price (24h)</div>
                  <div className="p-3 rounded-xl bg-black-800/60">
                    <MiniChart data={selectedChain.gasHistory} color={selectedChain.hex} height={48} />
                    <div className="flex justify-between mt-1 text-[9px] text-black-600 font-mono">
                      <span>24h ago</span>
                      <span>
                        Low: {Math.min(...selectedChain.gasHistory).toFixed(1)} | High:{' '}
                        {Math.max(...selectedChain.gasHistory).toFixed(1)}
                      </span>
                      <span>now</span>
                    </div>
                  </div>
                </div>

                {/* Latency */}
                <div>
                  <div className="text-xs text-black-400 mb-2">Network Latency</div>
                  <LatencyBar ms={selectedChain.latencyMs} />
                </div>

                {/* Explorer Link */}
                <a
                  href={selectedChain.explorer}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center space-x-2 w-full py-2.5 rounded-xl bg-black-800 hover:bg-black-700 transition-colors text-sm text-black-300 hover:text-white"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  <span>View on Explorer</span>
                </a>

                {/* Switch Button */}
                {isConnected && currentChainId !== selectedChain.id && selectedChain.id !== 'sol' && (
                  <button
                    onClick={() => { handleSwitch(selectedChain.id); setSelectedChain(null) }}
                    className="w-full py-3 rounded-xl font-medium text-sm transition-colors"
                    style={{ backgroundColor: selectedChain.hex + '22', color: selectedChain.hex }}
                  >
                    Switch to {selectedChain.name}
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default NetworkSelectorPage
