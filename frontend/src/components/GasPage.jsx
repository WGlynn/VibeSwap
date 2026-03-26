import { useState, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'
import StatCard from './ui/StatCard'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import { seededRandom } from '../utils/design-tokens'

// ============================================================
// Gas Page — Full gas tracker with history, chain comparison,
// cost estimator, block analysis, and user savings
// ============================================================

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const GREEN = '#00FF41'
const AMBER = '#FBBF24'
const RED = '#EF4444'
const ease = [0.25, 0.1, 0.25, 1]
const sectionV = {
  hidden: { opacity: 0, y: 40, scale: 0.97 },
  visible: (i) => ({ opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, delay: 0.15 + i * (0.1 * PHI), ease } }),
}
const cardV = {
  hidden: { opacity: 0, y: 12 },
  visible: (i) => ({ opacity: 1, y: 0, transition: { duration: 0.3, delay: 0.1 + i * (0.05 * PHI), ease } }),
}

// ============ Simulated Gas Data ============

const rng = seededRandom(9821)
const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`)
const GAS_HISTORY = HOUR_LABELS.map((h) => ({ hour: h, low: 8 + Math.floor(rng() * 12), avg: 18 + Math.floor(rng() * 15), high: 35 + Math.floor(rng() * 30) }))

const CHAIN_GAS = [
  { chain: 'Ethereum', gas: 24, unit: 'gwei', txCost: '$4.20', color: '#627eea', speed: '~12s' },
  { chain: 'Base', gas: 0.003, unit: 'gwei', txCost: '$0.01', color: '#3b82f6', speed: '~2s' },
  { chain: 'Arbitrum', gas: 0.1, unit: 'gwei', txCost: '$0.08', color: '#28a0f0', speed: '~0.3s' },
  { chain: 'Optimism', gas: 0.002, unit: 'gwei', txCost: '$0.01', color: '#ff0420', speed: '~2s' },
  { chain: 'Polygon', gas: 30, unit: 'gwei', txCost: '$0.02', color: '#8247e5', speed: '~2s' },
  { chain: 'CKB', gas: 1000, unit: 'shannons', txCost: '$0.001', color: '#3cc68a', speed: '~8s' },
]

const TX_TYPES = [
  { type: 'ETH Transfer', gas: 21000, desc: 'Simple token transfer' },
  { type: 'ERC-20 Transfer', gas: 65000, desc: 'Token approval + transfer' },
  { type: 'Swap (VibeSwap)', gas: 145000, desc: 'Commit-reveal batch swap' },
  { type: 'LP Add', gas: 220000, desc: 'Add liquidity to pool' },
  { type: 'LP Remove', gas: 180000, desc: 'Remove liquidity from pool' },
  { type: 'Bridge Send', gas: 280000, desc: 'Cross-chain LayerZero message' },
  { type: 'NFT Mint', gas: 95000, desc: 'Mint ERC-721 token' },
  { type: 'Contract Deploy', gas: 1200000, desc: 'Deploy smart contract' },
]

const GAS_LEVELS = [
  { label: 'Slow', price: 14, time: '~5 min', color: '#22c55e' },
  { label: 'Standard', price: 22, time: '~1 min', color: '#06b6d4' },
  { label: 'Fast', price: 32, time: '~15s', color: '#f59e0b' },
  { label: 'Instant', price: 48, time: '~3s', color: '#ef4444' },
]

const BLOCKS = [
  { number: 19284731, gasUsed: 14200000, gasLimit: 30000000, txCount: 187, baseFee: 18.4, time: '12s ago' },
  { number: 19284730, gasUsed: 22800000, gasLimit: 30000000, txCount: 312, baseFee: 22.1, time: '24s ago' },
  { number: 19284729, gasUsed: 18900000, gasLimit: 30000000, txCount: 241, baseFee: 20.3, time: '36s ago' },
  { number: 19284728, gasUsed: 11400000, gasLimit: 30000000, txCount: 148, baseFee: 15.7, time: '48s ago' },
  { number: 19284727, gasUsed: 26100000, gasLimit: 30000000, txCount: 356, baseFee: 28.9, time: '60s ago' },
]

// ============ Mock User Gas History ============

const USER_GAS_HISTORY = [
  { txHash: '0x8a3f...e291', type: 'Swap', chain: 'Base', gasUsed: 142800, gasPrice: 0.003, costUsd: 0.008, time: '15m ago' },
  { txHash: '0x2c91...f482', type: 'Bridge', chain: 'Arbitrum', gasUsed: 276400, gasPrice: 0.1, costUsd: 0.065, time: '2h ago' },
  { txHash: '0x71de...a930', type: 'LP Add', chain: 'Base', gasUsed: 218500, gasPrice: 0.003, costUsd: 0.005, time: '6h ago' },
  { txHash: '0xb4f2...c811', type: 'Swap', chain: 'Ethereum', gasUsed: 148200, gasPrice: 24, costUsd: 3.85, time: '1d ago' },
  { txHash: '0x5e83...d192', type: 'Transfer', chain: 'Polygon', gasUsed: 21000, gasPrice: 30, costUsd: 0.018, time: '2d ago' },
  { txHash: '0xf190...a723', type: 'Swap', chain: 'Optimism', gasUsed: 145200, gasPrice: 0.002, costUsd: 0.006, time: '3d ago' },
]

// ============ Subcomponents ============

function Section({ index, title, subtitle, children }) {
  return (
    <motion.div custom={index} variants={sectionV} initial="hidden" animate="visible">
      <GlassCard glowColor="terminal" spotlight hover={false} className="p-5 md:p-6">
        <div className="mb-4">
          <h2 className="text-sm font-mono font-bold tracking-wider uppercase" style={{ color: CYAN }}>{title}</h2>
          {subtitle && <p className="text-[11px] font-mono text-gray-400 mt-1 italic">{subtitle}</p>}
          <div className="h-px mt-3" style={{ background: `linear-gradient(90deg, ${CYAN}40, transparent)` }} />
        </div>
        {children}
      </GlassCard>
    </motion.div>
  )
}

function GasGauge() {
  const [selected, setSelected] = useState(1)
  return (
    <div className="grid grid-cols-4 gap-2">
      {GAS_LEVELS.map((g, i) => (
        <motion.button key={g.label} custom={i} variants={cardV} initial="hidden" animate="visible"
          onClick={() => setSelected(i)}
          className="rounded-xl p-3 text-center transition-all"
          style={{
            background: selected === i ? `${g.color}12` : 'rgba(0,0,0,0.3)',
            border: `1px solid ${selected === i ? `${g.color}40` : 'rgba(255,255,255,0.04)'}`,
          }}>
          <div className="text-lg font-mono font-bold mb-1" style={{ color: g.color }}>{g.price}</div>
          <div className="text-[9px] font-mono text-gray-500 uppercase tracking-wider">{g.label}</div>
          <div className="text-[10px] font-mono mt-1" style={{ color: g.color }}>{g.time}</div>
          <div className="text-[9px] font-mono text-gray-600 mt-1">
            ~${((g.price * 21000 * 3500) / 1e9).toFixed(2)}
          </div>
        </motion.button>
      ))}
    </div>
  )
}

function GasHistoryChart() {
  const maxGas = Math.max(...GAS_HISTORY.map((d) => d.high))
  const chartH = 120
  const barW = 100 / GAS_HISTORY.length

  return (
    <div>
      <svg viewBox={`0 0 100 ${chartH + 15}`} className="w-full h-40" preserveAspectRatio="none">
        {GAS_HISTORY.map((d, i) => {
          const x = i * barW
          const lowH = (d.low / maxGas) * chartH
          const avgH = (d.avg / maxGas) * chartH
          const highH = (d.high / maxGas) * chartH
          return (
            <g key={d.hour}>
              <rect x={x + barW * 0.15} y={chartH - highH} width={barW * 0.7} height={highH}
                fill="rgba(239,68,68,0.1)" rx="0.5" />
              <rect x={x + barW * 0.25} y={chartH - avgH} width={barW * 0.5} height={avgH}
                fill={`${CYAN}30`} rx="0.5" />
              <rect x={x + barW * 0.3} y={chartH - lowH} width={barW * 0.4} height={lowH}
                fill="rgba(34,197,94,0.4)" rx="0.5" />
              {i % 4 === 0 && (
                <text x={x + barW / 2} y={chartH + 10} textAnchor="middle"
                  fill="rgba(255,255,255,0.3)" fontSize="2.5" fontFamily="monospace">{d.hour}</text>
              )}
            </g>
          )
        })}
      </svg>
      <div className="flex items-center justify-center gap-4 mt-2">
        {[
          { label: 'Low', color: 'rgba(34,197,94,0.6)' },
          { label: 'Average', color: `${CYAN}50` },
          { label: 'High', color: 'rgba(239,68,68,0.3)' },
        ].map((l) => (
          <div key={l.label} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: l.color }} />
            <span className="text-[9px] font-mono text-gray-500">{l.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function CostEstimator() {
  const [ethPrice] = useState(3500)
  const [gasPrice] = useState(22)

  return (
    <div className="space-y-1.5">
      {TX_TYPES.map((tx, i) => {
        const costEth = (tx.gas * gasPrice) / 1e9
        const costUsd = costEth * ethPrice
        return (
          <motion.div key={tx.type} custom={i} variants={cardV} initial="hidden" animate="visible"
            className="flex items-center justify-between rounded-lg p-3"
            style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.04)' }}>
            <div className="flex-1 min-w-0">
              <span className="text-[11px] font-mono font-bold text-white">{tx.type}</span>
              <div className="flex items-center gap-3 mt-0.5">
                <span className="text-[9px] font-mono text-gray-500">{tx.gas.toLocaleString()} gas</span>
                <span className="text-[9px] font-mono text-gray-600">{tx.desc}</span>
              </div>
            </div>
            <div className="text-right flex-shrink-0 ml-3">
              <div className="text-[11px] font-mono font-bold" style={{ color: CYAN }}>
                ${costUsd.toFixed(2)}
              </div>
              <div className="text-[9px] font-mono text-gray-500">
                {costEth.toFixed(6)} ETH
              </div>
            </div>
          </motion.div>
        )
      })}
      <div className="text-[9px] font-mono text-gray-600 text-center mt-2">
        Based on {gasPrice} gwei gas price and ${ethPrice.toLocaleString()} ETH
      </div>
    </div>
  )
}

// ============ Main Component ============

export default function GasPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [currentGas, setCurrentGas] = useState(22)

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentGas((prev) => Math.max(8, Math.min(60, prev + (Math.random() - 0.48) * 3)))
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  // ============ User Savings Calculation ============
  const userStats = useMemo(() => {
    const totalGasSpent = USER_GAS_HISTORY.reduce((s, tx) => s + tx.costUsd, 0)
    // VibeSwap batch auctions amortize gas — estimate ~40% savings vs individual txs
    const estimatedWithoutBatch = totalGasSpent * 1.67
    const savedAmount = estimatedWithoutBatch - totalGasSpent
    const avgCostPerTx = totalGasSpent / USER_GAS_HISTORY.length
    const txCount = USER_GAS_HISTORY.length
    return { totalGasSpent, savedAmount, avgCostPerTx, txCount }
  }, [])

  return (
    <div className="min-h-screen pb-20">
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        {Array.from({ length: 8 }).map((_, i) => (
          <motion.div key={i} className="absolute w-px h-px rounded-full"
            style={{ background: CYAN, left: `${(i * PHI * 17) % 100}%`, top: `${(i * PHI * 23) % 100}%` }}
            animate={{ opacity: [0, 0.2, 0], scale: [0, 1.5, 0], y: [0, -50] }}
            transition={{ duration: 3.5, repeat: Infinity, delay: i * 0.5, ease: 'easeOut' }} />
        ))}
      </div>

      <div className="relative z-10">
        {/* ============ Header ============ */}
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-8 pt-6">
          <h1 className="text-3xl sm:text-4xl font-bold text-white font-display">
            GAS <span style={{ color: CYAN }}>TRACKER</span>
          </h1>
          <p className="text-gray-400 text-sm mt-2 font-mono">Real-time gas prices and cost estimation across chains.</p>
          <div className="mx-auto mt-3 h-px w-32" style={{ background: `linear-gradient(to right, transparent, ${CYAN}, transparent)` }} />
          {currentGas > 0 && (
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.3 }}
              className="inline-flex items-center gap-1.5 mt-3 px-3 py-1 rounded-full text-xs font-mono"
              style={{ background: 'rgba(0,0,0,0.4)', border: `1px solid ${currentGas > 40 ? RED : currentGas > 25 ? AMBER : GREEN}30` }}>
              <div className="w-1.5 h-1.5 rounded-full animate-pulse"
                style={{ backgroundColor: currentGas > 40 ? RED : currentGas > 25 ? AMBER : GREEN }} />
              <span style={{ color: currentGas > 40 ? RED : currentGas > 25 ? AMBER : GREEN }}>
                {Math.round(currentGas)} gwei
              </span>
            </motion.div>
          )}
        </motion.div>

        <div className="max-w-5xl mx-auto px-4 space-y-6">
          {/* Stats */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1, ease }}
            className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Current Gas" value={currentGas} suffix=" gwei" decimals={0} sparkSeed={601} change={-8.2} />
            <StatCard label="24h Average" value={21.4} suffix=" gwei" decimals={1} sparkSeed={602} />
            <StatCard label="ETH Transfer" value={0.77} prefix="$" decimals={2} sparkSeed={603} change={-12.0} />
            <StatCard label="Swap Cost" value={2.34} prefix="$" decimals={2} sparkSeed={604} change={-5.3} />
          </motion.div>

          {/* ============ Your Gas Position (wallet connected) ============ */}
          {isConnected && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.5 }}>
              <GlassCard glowColor="terminal" spotlight hover={false} className="p-5 md:p-6">
                <div className="mb-4">
                  <h2 className="text-sm font-mono font-bold tracking-wider uppercase" style={{ color: GREEN }}>Your Gas Position</h2>
                  <p className="text-[11px] font-mono text-gray-400 mt-1 italic">Recent gas costs and estimated savings from batch auctions</p>
                  <div className="h-px mt-3" style={{ background: `linear-gradient(90deg, ${GREEN}40, transparent)` }} />
                </div>

                {/* Savings Stats */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                  {[
                    { label: 'Total Gas Spent', value: `$${userStats.totalGasSpent.toFixed(2)}`, color: CYAN },
                    { label: 'Batch Savings', value: `$${userStats.savedAmount.toFixed(2)}`, color: GREEN },
                    { label: 'Avg Per Tx', value: `$${userStats.avgCostPerTx.toFixed(3)}`, color: AMBER },
                    { label: 'Transactions', value: `${userStats.txCount}`, color: '#a78bfa' },
                  ].map((s, i) => (
                    <motion.div key={s.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.3 + i * 0.08 * PHI }}
                      className="bg-gray-900/40 rounded-lg p-3 text-center">
                      <div className="text-lg font-mono font-bold" style={{ color: s.color }}>{s.value}</div>
                      <div className="text-[10px] text-gray-500 font-mono mt-1">{s.label}</div>
                    </motion.div>
                  ))}
                </div>

                {/* Savings Progress Bar */}
                <div className="mb-5">
                  <div className="flex items-center justify-between text-[10px] font-mono mb-1">
                    <span className="text-gray-400">Savings from VibeSwap Batching</span>
                    <span style={{ color: GREEN }}>
                      {((userStats.savedAmount / (userStats.totalGasSpent + userStats.savedAmount)) * 100).toFixed(0)}% saved
                    </span>
                  </div>
                  <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                    <motion.div initial={{ width: 0 }}
                      animate={{ width: `${(userStats.savedAmount / (userStats.totalGasSpent + userStats.savedAmount)) * 100}%` }}
                      transition={{ duration: 0.8, delay: 0.5 }}
                      className="h-full rounded-full"
                      style={{ background: `linear-gradient(to right, ${CYAN}, ${GREEN})` }} />
                  </div>
                </div>

                {/* Recent Gas Transactions */}
                <div className="space-y-1.5">
                  <div className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-2">Recent Gas Costs</div>
                  {USER_GAS_HISTORY.map((tx, i) => (
                    <motion.div key={tx.txHash} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.4 + i * 0.06 * PHI }}
                      className="flex items-center justify-between rounded-lg p-2.5"
                      style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.04)' }}>
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[9px] font-mono font-bold"
                          style={{
                            background: `${CHAIN_GAS.find(c => c.chain === tx.chain)?.color || CYAN}15`,
                            border: `1px solid ${CHAIN_GAS.find(c => c.chain === tx.chain)?.color || CYAN}30`,
                            color: CHAIN_GAS.find(c => c.chain === tx.chain)?.color || CYAN,
                          }}>
                          {tx.chain.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <span className="text-[11px] font-mono font-bold text-white">{tx.type}</span>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[9px] font-mono text-gray-500">{tx.txHash}</span>
                            <span className="text-[9px] font-mono text-gray-600">{tx.chain}</span>
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[11px] font-mono font-bold" style={{ color: tx.costUsd > 1 ? AMBER : GREEN }}>
                          ${tx.costUsd.toFixed(3)}
                        </div>
                        <div className="text-[9px] font-mono text-gray-600">{tx.time}</div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </GlassCard>
            </motion.div>
          )}

          {/* Not connected — prompt */}
          {!isConnected && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.5 }}>
              <GlassCard glowColor="terminal" hover={false}>
                <div className="p-8 text-center">
                  <div className="text-2xl mb-2" style={{ color: `${CYAN}30` }}>{'{ }'}</div>
                  <div className="text-gray-400 text-sm font-mono">Sign in to view your gas history and savings</div>
                </div>
              </GlassCard>
            </motion.div>
          )}

          {/* Gas Levels */}
          <Section index={0} title="Gas Speeds" subtitle="Choose your preferred transaction speed">
            <GasGauge />
          </Section>

          {/* 24h History */}
          <Section index={1} title="24-Hour Gas History" subtitle="Low, average, and high gas prices by hour">
            <GasHistoryChart />
          </Section>

          {/* Chain Comparison */}
          <Section index={2} title="Cross-Chain Gas Comparison" subtitle="Transaction costs across supported networks">
            <div className="space-y-1.5">
              {CHAIN_GAS.map((c, i) => (
                <motion.div key={c.chain} custom={i} variants={cardV} initial="hidden" animate="visible"
                  className="flex items-center gap-3 rounded-lg p-3"
                  style={{ background: `${c.color}06`, border: `1px solid ${c.color}12` }}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[9px] font-mono font-bold flex-shrink-0"
                    style={{ background: `${c.color}15`, border: `1px solid ${c.color}30`, color: c.color }}>
                    {c.chain.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-mono font-bold text-white">{c.chain}</span>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-[10px] font-mono text-gray-400">{c.gas} {c.unit}</span>
                      <span className="text-[9px] font-mono text-gray-600">Block time: {c.speed}</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm font-mono font-bold" style={{ color: c.color }}>{c.txCost}</div>
                    <div className="text-[9px] font-mono text-gray-500">per transfer</div>
                  </div>
                </motion.div>
              ))}
            </div>
          </Section>

          {/* Cost Estimator */}
          <Section index={3} title="Cost Estimator" subtitle="Estimated cost for common transaction types">
            <CostEstimator />
          </Section>

          {/* Recent Blocks */}
          <Section index={4} title="Recent Blocks" subtitle="Gas utilization and base fee for latest blocks">
            <div className="space-y-1.5">
              {BLOCKS.map((b, i) => {
                const utilPct = (b.gasUsed / b.gasLimit) * 100
                return (
                  <motion.div key={b.number} custom={i} variants={cardV} initial="hidden" animate="visible"
                    className="rounded-lg p-3" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.04)' }}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-mono font-bold" style={{ color: CYAN }}>#{b.number}</span>
                        <span className="text-[9px] font-mono text-gray-500">{b.txCount} txns</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] font-mono text-gray-400">{b.baseFee} gwei</span>
                        <span className="text-[9px] font-mono text-gray-600">{b.time}</span>
                      </div>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
                      <motion.div className="h-full rounded-full"
                        style={{ background: utilPct > 80 ? '#ef4444' : utilPct > 50 ? '#f59e0b' : '#22c55e' }}
                        initial={{ width: 0 }} animate={{ width: `${utilPct}%` }}
                        transition={{ duration: 0.8, delay: i * 0.1, ease: 'easeOut' }} />
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[9px] font-mono text-gray-500">
                        {(b.gasUsed / 1e6).toFixed(1)}M / {(b.gasLimit / 1e6).toFixed(0)}M gas
                      </span>
                      <span className="text-[9px] font-mono" style={{ color: utilPct > 80 ? '#ef4444' : utilPct > 50 ? '#f59e0b' : '#22c55e' }}>
                        {utilPct.toFixed(1)}% full
                      </span>
                    </div>
                  </motion.div>
                )
              })}
            </div>
          </Section>

          {/* Gas Tips */}
          <Section index={5} title="Gas Optimization Tips" subtitle="Save on transaction costs">
            <div className="space-y-2">
              {[
                { tip: 'Use L2 networks', desc: 'Base and Arbitrum offer 50-100x cheaper transactions than Ethereum mainnet.' },
                { tip: 'Batch transactions', desc: 'VibeSwap batches orders every 10 seconds — your gas cost is amortized across the batch.' },
                { tip: 'Time your transactions', desc: 'Gas is cheapest during off-peak hours (UTC 2:00-8:00). Check the 24h chart above.' },
                { tip: 'Set reasonable slippage', desc: 'Lower slippage tolerance means your transaction may fail, wasting gas on a reverted tx.' },
              ].map((t, i) => (
                <motion.div key={t.tip} custom={i} variants={cardV} initial="hidden" animate="visible"
                  className="rounded-lg p-3" style={{ background: `${CYAN}04`, border: `1px solid ${CYAN}10` }}>
                  <span className="text-[11px] font-mono font-bold text-white">{t.tip}</span>
                  <p className="text-[10px] font-mono text-gray-400 mt-0.5">{t.desc}</p>
                </motion.div>
              ))}
            </div>
          </Section>
        </div>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.5 }} className="mt-12 mb-8 text-center">
          <div className="w-16 h-px mx-auto mb-4" style={{ background: `linear-gradient(90deg, transparent, ${CYAN}40, transparent)` }} />
          <p className="text-[10px] font-mono text-gray-600 tracking-widest uppercase">Gas Tracker — EIP-1559</p>
        </motion.div>
      </div>
    </div>
  )
}
