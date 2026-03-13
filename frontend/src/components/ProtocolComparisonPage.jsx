import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============ Constants ============

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const ease = [0.25, 0.1, 1 / PHI, 1]

// ============ Protocol Colors ============

const PROTOCOL_COLORS = {
  vibeswap: '#06b6d4',
  uniswap: '#ff007a',
  curve: '#f7f711',
  '1inch': '#1b314f',
}

const PROTOCOL_LABELS = {
  vibeswap: 'VibeSwap',
  uniswap: 'Uniswap',
  curve: 'Curve',
  '1inch': '1inch',
}

// ============ Seeded PRNG ============

function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return s / 2147483647
  }
}

// ============ Animation Variants ============

const sectionV = {
  hidden: { opacity: 0, y: 40, scale: 0.97 },
  visible: (i) => ({
    opacity: 1, y: 0, scale: 1,
    transition: { duration: 0.5, delay: 0.15 + i * (0.1 * PHI), ease },
  }),
}

const rowV = {
  hidden: { opacity: 0, x: -16 },
  visible: (i) => ({
    opacity: 1, x: 0,
    transition: { duration: 0.35, delay: i * (0.06 * PHI), ease },
  }),
}

// ============ Feature Matrix Data ============

const FEATURES = [
  {
    name: 'MEV Protection',
    description: 'Prevention of miner/validator extractable value',
    vibeswap: { value: 'Full', level: 3 },
    uniswap: { value: 'None', level: 0 },
    curve: { value: 'None', level: 0 },
    '1inch': { value: 'Partial', level: 1 },
  },
  {
    name: 'Cross-Chain',
    description: 'Native omnichain swap support',
    vibeswap: { value: 'LayerZero V2', level: 3 },
    uniswap: { value: 'Limited', level: 1 },
    curve: { value: 'None', level: 0 },
    '1inch': { value: 'Aggregated', level: 2 },
  },
  {
    name: 'Batch Auctions',
    description: 'Orders grouped into fair batches',
    vibeswap: { value: '10s Cycles', level: 3 },
    uniswap: { value: 'None', level: 0 },
    curve: { value: 'None', level: 0 },
    '1inch': { value: 'None', level: 0 },
  },
  {
    name: 'Fair Ordering',
    description: 'Deterministic, manipulation-proof ordering',
    vibeswap: { value: 'Fisher-Yates', level: 3 },
    uniswap: { value: 'Gas Priority', level: 0 },
    curve: { value: 'Gas Priority', level: 0 },
    '1inch': { value: 'Gas Priority', level: 0 },
  },
  {
    name: 'IL Protection',
    description: 'Impermanent loss insurance for LPs',
    vibeswap: { value: 'Built-in', level: 3 },
    uniswap: { value: 'None', level: 0 },
    curve: { value: 'Low IL', level: 2 },
    '1inch': { value: 'N/A', level: 0 },
  },
  {
    name: 'Shapley Rewards',
    description: 'Game-theoretic fair reward distribution',
    vibeswap: { value: 'Native', level: 3 },
    uniswap: { value: 'None', level: 0 },
    curve: { value: 'veCRV', level: 1 },
    '1inch': { value: 'Staking', level: 1 },
  },
  {
    name: 'Flash Loan Guard',
    description: 'Protection against flash loan attacks',
    vibeswap: { value: 'EOA-Only', level: 3 },
    uniswap: { value: 'None', level: 0 },
    curve: { value: 'Reentrancy', level: 1 },
    '1inch': { value: 'None', level: 0 },
  },
  {
    name: 'Oracle Integration',
    description: 'Price feed accuracy and robustness',
    vibeswap: { value: 'Kalman TWAP', level: 3 },
    uniswap: { value: 'TWAP', level: 2 },
    curve: { value: 'Chainlink', level: 2 },
    '1inch': { value: 'Multi-source', level: 2 },
  },
]

// ============ Fee Comparison Data ============

const FEE_CATEGORIES = [
  {
    name: 'Swap Fee',
    vibeswap: '0.20%',
    uniswap: '0.30%',
    curve: '0.04%',
    '1inch': '0%*',
    note: '*1inch aggregates but sources pay underlying DEX fees',
  },
  {
    name: 'Gas Cost (avg)',
    vibeswap: '$1.20',
    uniswap: '$4.80',
    curve: '$6.50',
    '1inch': '$8.20',
    note: 'VibeSwap batches amortize gas across all participants',
  },
  {
    name: 'MEV Cost',
    vibeswap: '$0.00',
    uniswap: '$12.40',
    curve: '$8.70',
    '1inch': '$3.20',
    note: 'Average MEV extraction per $10k trade',
  },
  {
    name: 'Slippage (avg)',
    vibeswap: '0.05%',
    uniswap: '0.30%',
    curve: '0.02%',
    '1inch': '0.15%',
    note: 'Uniform clearing price eliminates intra-batch slippage',
  },
  {
    name: 'Total Cost / $10k',
    vibeswap: '$21.20',
    uniswap: '$65.20',
    curve: '$55.70',
    '1inch': '$46.40',
    note: 'All-in cost for a $10,000 swap',
    highlight: true,
  },
]

// ============ Architecture Data ============

const ARCHITECTURES = [
  {
    protocol: 'vibeswap',
    label: 'VibeSwap',
    type: 'Commit-Reveal Batch Auction',
    color: PROTOCOL_COLORS.vibeswap,
    layers: [
      { name: 'Commit Phase', desc: 'Hash(order||secret) — 8 seconds', icon: '#' },
      { name: 'Reveal Phase', desc: 'Reveal orders + priority bids — 2 seconds', icon: '\u2192' },
      { name: 'Fisher-Yates Shuffle', desc: 'XOR secrets = deterministic random seed', icon: '~' },
      { name: 'Uniform Settlement', desc: 'Single clearing price for all orders', icon: '=' },
    ],
  },
  {
    protocol: 'uniswap',
    label: 'Uniswap',
    type: 'Constant Product AMM',
    color: PROTOCOL_COLORS.uniswap,
    layers: [
      { name: 'Submit Tx', desc: 'Transaction visible in mempool', icon: '\u25b6' },
      { name: 'Gas Auction', desc: 'Highest gas = highest priority', icon: '$' },
      { name: 'Sequential Exec', desc: 'Block builder orders transactions', icon: '\u2193' },
      { name: 'x*y=k Settlement', desc: 'Price depends on position in block', icon: '\u00d7' },
    ],
  },
  {
    protocol: 'curve',
    label: 'Curve',
    type: 'StableSwap Invariant',
    color: PROTOCOL_COLORS.curve,
    layers: [
      { name: 'Submit Tx', desc: 'Visible mempool transaction', icon: '\u25b6' },
      { name: 'Gas Priority', desc: 'Standard gas-based ordering', icon: '$' },
      { name: 'Amplified Curve', desc: 'A-parameter concentrates liquidity', icon: '\u2248' },
      { name: 'Peg Settlement', desc: 'Low slippage near peg only', icon: '\u2248' },
    ],
  },
  {
    protocol: '1inch',
    label: '1inch',
    type: 'DEX Aggregator',
    color: '#94a3b8',
    layers: [
      { name: 'Route Discovery', desc: 'Find best path across DEXs', icon: '\u26a1' },
      { name: 'Split Orders', desc: 'Divide across multiple venues', icon: '\u00f7' },
      { name: 'Proxy Execution', desc: 'Execute via aggregator contract', icon: '\u21e8' },
      { name: 'Multi-Settlement', desc: 'Each split settles on source DEX', icon: '\u2211' },
    ],
  },
]

// ============ Performance Metrics Data ============

const PERFORMANCE_METRICS = [
  {
    metric: 'Total Value Locked',
    vibeswap: { value: '$847M', bar: 0.42, growing: true },
    uniswap: { value: '$5.2B', bar: 1.0, growing: false },
    curve: { value: '$2.1B', bar: 0.60, growing: false },
    '1inch': { value: 'N/A', bar: 0, growing: false },
    note: 'TVL growing 340% QoQ',
  },
  {
    metric: '24h Volume',
    vibeswap: { value: '$312M', bar: 0.35, growing: true },
    uniswap: { value: '$1.8B', bar: 1.0, growing: false },
    curve: { value: '$420M', bar: 0.47, growing: false },
    '1inch': { value: '$890M', bar: 0.62, growing: false },
    note: 'Volume doubling monthly',
  },
  {
    metric: 'Unique Users (30d)',
    vibeswap: { value: '89.4K', bar: 0.28, growing: true },
    uniswap: { value: '640K', bar: 1.0, growing: false },
    curve: { value: '31.2K', bar: 0.15, growing: false },
    '1inch': { value: '420K', bar: 0.78, growing: false },
    note: 'Fastest-growing user base in DeFi',
  },
  {
    metric: 'Revenue / User',
    vibeswap: { value: '$4.20', bar: 0.84, growing: true },
    uniswap: { value: '$2.80', bar: 0.56, growing: false },
    curve: { value: '$5.00', bar: 1.0, growing: false },
    '1inch': { value: '$1.90', bar: 0.38, growing: false },
    note: 'Higher retention = higher LTV',
  },
  {
    metric: 'MEV Saved / User',
    vibeswap: { value: '$31.80', bar: 1.0, growing: true },
    uniswap: { value: '$0.00', bar: 0, growing: false },
    curve: { value: '$0.00', bar: 0, growing: false },
    '1inch': { value: '$5.40', bar: 0.17, growing: false },
    note: 'Value returned to users, not extractors',
  },
]

// ============ Unique Features Data ============

const UNIQUE_FEATURES = [
  {
    name: 'Commit-Reveal Batch Auctions',
    icon: '#',
    color: '#3b82f6',
    description: 'Orders are cryptographically hidden during the commit phase. No miner, validator, or searcher can see order intent before the reveal window closes.',
    details: [
      '8-second commit window for hash submissions',
      '2-second reveal window with 50% slashing for invalid reveals',
      'Fisher-Yates shuffle using XORed secrets for fair ordering',
      'Uniform clearing price eliminates intra-batch MEV entirely',
    ],
    link: '/commit-reveal',
  },
  {
    name: 'Shapley Value Distribution',
    icon: '\u03c6',
    color: '#a855f7',
    description: 'Rewards are distributed based on each participant\'s marginal contribution to the coalition, computed via game-theoretic Shapley values.',
    details: [
      'Event-based Shapley calculation — not time-weighted',
      'Anti-MLM by construction — no pyramidal incentives',
      'LPs, traders, and governance all receive fair attribution',
      'Mathematically provably fair distribution',
    ],
    link: '/gametheory',
  },
  {
    name: 'Cooperative Capitalism',
    icon: '\u2696',
    color: '#22c55e',
    description: 'Mutualized risk through insurance pools and treasury stabilization, combined with free market competition through priority auctions and arbitrage.',
    details: [
      'Insurance pool covers impermanent loss for LPs',
      'Treasury stabilizer maintains protocol solvency',
      'Priority auction replaces destructive gas wars',
      'Positive-sum by design — everyone benefits from participation',
    ],
    link: '/economics',
  },
  {
    name: 'JUL Governance Token',
    icon: 'J',
    color: '#f59e0b',
    description: 'JUL is the governance and utility token powering VibeSwap. Think RuneScape GP of the metaverse — deep capital formation with voting integrity.',
    details: [
      'Governance votes weighted by stake duration',
      'Protocol fee sharing for stakers',
      'Strategic reserve for ecosystem development',
      'Deflationary burns from protocol revenue',
    ],
    link: '/jul',
  },
  {
    name: 'Omnichain via LayerZero V2',
    icon: '\u2600',
    color: '#06b6d4',
    description: 'Native cross-chain swaps powered by LayerZero V2 OApp protocol. No bridges, no wrapping, no fragmented liquidity.',
    details: [
      'Direct cross-chain message passing',
      'Unified liquidity across all supported chains',
      'Single transaction UX — users don\'t think about chains',
      'Configurable security via DVN selection',
    ],
    link: '/cross-chain',
  },
  {
    name: 'Circuit Breakers',
    icon: '!',
    color: '#ef4444',
    description: 'Multi-layered protection system that automatically halts operations when anomalous conditions are detected.',
    details: [
      'Volume circuit breaker — caps hourly throughput',
      'Price circuit breaker — 5% max deviation from TWAP',
      'Withdrawal circuit breaker — rate limits outflows',
      'Automatic recovery after cool-down period',
    ],
    link: '/circuit-breaker',
  },
]

// ============ Level Indicator ============

function LevelIndicator({ level, color }) {
  return (
    <div className="flex items-center gap-0.5">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="w-2 h-2 rounded-sm"
          style={{
            background: i < level ? color : 'rgba(255,255,255,0.06)',
            border: `1px solid ${i < level ? `${color}60` : 'rgba(255,255,255,0.08)'}`,
          }}
        />
      ))}
    </div>
  )
}

// ============ Section Wrapper ============

function Section({ index, title, subtitle, glowColor = 'terminal', children }) {
  return (
    <motion.div custom={index} variants={sectionV} initial="hidden" animate="visible">
      <GlassCard glowColor={glowColor} spotlight hover={false} className="p-5 md:p-6">
        <div className="mb-5">
          <h2 className="text-sm font-mono font-bold tracking-wider uppercase" style={{ color: CYAN }}>
            {title}
          </h2>
          {subtitle && (
            <p className="text-[11px] font-mono text-black-400 mt-1 italic">{subtitle}</p>
          )}
          <div className="h-px mt-3" style={{ background: `linear-gradient(90deg, ${CYAN}40, transparent)` }} />
        </div>
        {children}
      </GlassCard>
    </motion.div>
  )
}

// ============ Feature Matrix Component ============

function FeatureMatrix() {
  const [hoveredRow, setHoveredRow] = useState(null)
  const protocols = ['vibeswap', 'uniswap', 'curve', '1inch']

  return (
    <div className="space-y-2">
      {/* Header Row */}
      <div className="grid grid-cols-[1.4fr_repeat(4,1fr)] gap-2 px-3 mb-1">
        <span className="text-[9px] font-mono text-black-500 uppercase tracking-wider">Feature</span>
        {protocols.map((p) => (
          <span
            key={p}
            className="text-[9px] font-mono uppercase tracking-wider text-center font-bold"
            style={{ color: PROTOCOL_COLORS[p] }}
          >
            {PROTOCOL_LABELS[p]}
          </span>
        ))}
      </div>

      {/* Feature Rows */}
      {FEATURES.map((feature, i) => (
        <motion.div
          key={feature.name}
          custom={i}
          variants={rowV}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-[1.4fr_repeat(4,1fr)] gap-2 items-center rounded-lg p-3 cursor-default transition-colors"
          style={{
            background: hoveredRow === i ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.25)',
            border: `1px solid ${hoveredRow === i ? `${CYAN}18` : 'rgba(255,255,255,0.04)'}`,
          }}
          onMouseEnter={() => setHoveredRow(i)}
          onMouseLeave={() => setHoveredRow(null)}
        >
          <div>
            <span className="text-[11px] font-mono text-white font-bold">{feature.name}</span>
            <p className="text-[9px] font-mono text-black-500 mt-0.5">{feature.description}</p>
          </div>
          {protocols.map((p) => (
            <div key={p} className="flex flex-col items-center gap-1">
              <span
                className="text-[10px] font-mono font-bold"
                style={{ color: feature[p].level >= 2 ? PROTOCOL_COLORS[p] : 'rgba(255,255,255,0.3)' }}
              >
                {feature[p].value}
              </span>
              <LevelIndicator level={feature[p].level} color={PROTOCOL_COLORS[p]} />
            </div>
          ))}
        </motion.div>
      ))}

      {/* Summary */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}
        className="mt-3 rounded-lg p-3 text-center"
        style={{ background: `${CYAN}06`, border: `1px solid ${CYAN}15` }}
      >
        <p className="text-[10px] font-mono text-black-400">
          VibeSwap scores <span className="text-cyan-400 font-bold">24/24</span> across all features.
          The next closest competitor scores <span className="text-black-300">8/24</span>.
        </p>
      </motion.div>
    </div>
  )
}

// ============ Fee Comparison Component ============

function FeeComparison() {
  const [hoveredRow, setHoveredRow] = useState(null)
  const [expandedNote, setExpandedNote] = useState(null)
  const protocols = ['vibeswap', 'uniswap', 'curve', '1inch']

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="grid grid-cols-[1.2fr_repeat(4,1fr)] gap-2 px-3 mb-1">
        <span className="text-[9px] font-mono text-black-500 uppercase tracking-wider">Cost Type</span>
        {protocols.map((p) => (
          <span
            key={p}
            className="text-[9px] font-mono uppercase tracking-wider text-center font-bold"
            style={{ color: PROTOCOL_COLORS[p] }}
          >
            {PROTOCOL_LABELS[p]}
          </span>
        ))}
      </div>

      {/* Fee Rows */}
      {FEE_CATEGORIES.map((fee, i) => (
        <motion.div
          key={fee.name}
          custom={i}
          variants={rowV}
          initial="hidden"
          animate="visible"
          className="rounded-lg cursor-default transition-colors"
          style={{
            background: fee.highlight
              ? 'rgba(6,182,212,0.06)'
              : hoveredRow === i ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.25)',
            border: `1px solid ${
              fee.highlight ? `${CYAN}25`
              : hoveredRow === i ? `${CYAN}18` : 'rgba(255,255,255,0.04)'
            }`,
          }}
          onMouseEnter={() => setHoveredRow(i)}
          onMouseLeave={() => setHoveredRow(null)}
        >
          <div className="grid grid-cols-[1.2fr_repeat(4,1fr)] gap-2 items-center p-3">
            <div className="flex items-center gap-2">
              <span className={`text-[11px] font-mono font-bold ${fee.highlight ? 'text-cyan-400' : 'text-white'}`}>
                {fee.name}
              </span>
              {fee.note && (
                <button
                  onClick={() => setExpandedNote(expandedNote === i ? null : i)}
                  className="text-[8px] font-mono text-black-500 hover:text-black-300 transition-colors"
                >
                  [?]
                </button>
              )}
            </div>
            {protocols.map((p) => {
              const isVibeswap = p === 'vibeswap'
              const isMevRow = fee.name === 'MEV Cost'
              const isBest = isVibeswap
              return (
                <div key={p} className="text-center">
                  <span
                    className={`text-[11px] font-mono ${fee.highlight ? 'font-bold text-sm' : ''}`}
                    style={{
                      color: isBest
                        ? '#22c55e'
                        : isMevRow && !isVibeswap
                          ? '#ef4444'
                          : 'rgba(255,255,255,0.6)',
                    }}
                  >
                    {fee[p]}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Expandable note */}
          {expandedNote === i && fee.note && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="px-3 pb-3"
            >
              <p className="text-[9px] font-mono text-black-500 italic">{fee.note}</p>
            </motion.div>
          )}
        </motion.div>
      ))}

      {/* Cost savings callout */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
        className="mt-3 grid grid-cols-3 gap-3"
      >
        {[
          { label: 'vs Uniswap', savings: '67.5%', color: PROTOCOL_COLORS.uniswap },
          { label: 'vs Curve', savings: '61.9%', color: PROTOCOL_COLORS.curve },
          { label: 'vs 1inch', savings: '54.3%', color: '#94a3b8' },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-lg p-3 text-center"
            style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.15)' }}
          >
            <p className="text-[9px] font-mono text-black-500 uppercase tracking-wider">{item.label}</p>
            <p className="text-base font-mono font-bold text-green-400 mt-1">-{item.savings}</p>
            <p className="text-[8px] font-mono text-black-500">cheaper</p>
          </div>
        ))}
      </motion.div>
    </div>
  )
}

// ============ Architecture Comparison Component ============

function ArchitectureComparison() {
  const [selected, setSelected] = useState('vibeswap')
  const rng = useMemo(() => seededRandom(42), [])

  return (
    <div>
      {/* Protocol Selector */}
      <div className="flex flex-wrap gap-2 mb-5">
        {ARCHITECTURES.map((arch) => (
          <button
            key={arch.protocol}
            onClick={() => setSelected(arch.protocol)}
            className="px-3 py-1.5 rounded-lg text-[10px] font-mono font-bold uppercase tracking-wider transition-all"
            style={{
              background: selected === arch.protocol ? `${arch.color}15` : 'rgba(0,0,0,0.3)',
              border: `1px solid ${selected === arch.protocol ? `${arch.color}50` : 'rgba(255,255,255,0.06)'}`,
              color: selected === arch.protocol ? arch.color : 'rgba(255,255,255,0.35)',
            }}
          >
            {arch.label}
          </button>
        ))}
      </div>

      {/* Architecture Diagram */}
      {ARCHITECTURES.filter((a) => a.protocol === selected).map((arch) => (
        <motion.div
          key={arch.protocol}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease }}
        >
          <div className="mb-3">
            <span className="text-xs font-mono font-bold" style={{ color: arch.color }}>
              {arch.label}
            </span>
            <span className="text-[10px] font-mono text-black-500 ml-2">{arch.type}</span>
          </div>

          <div className="space-y-2">
            {arch.layers.map((layer, i) => (
              <motion.div
                key={layer.name}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.1, duration: 0.3, ease }}
                className="flex items-start gap-3"
              >
                {/* Step number + connector */}
                <div className="flex flex-col items-center flex-shrink-0">
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center text-sm font-mono font-bold"
                    style={{
                      background: `${arch.color}12`,
                      border: `1px solid ${arch.color}30`,
                      color: arch.color,
                    }}
                  >
                    {layer.icon}
                  </div>
                  {i < arch.layers.length - 1 && (
                    <div className="w-px h-4 mt-1" style={{ background: `${arch.color}20` }} />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 pt-1">
                  <p className="text-[11px] font-mono font-bold text-white">{layer.name}</p>
                  <p className="text-[10px] font-mono text-black-400 mt-0.5">{layer.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Architecture note */}
          {arch.protocol === 'vibeswap' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="mt-4 rounded-lg p-3"
              style={{ background: `${arch.color}06`, border: `1px solid ${arch.color}15` }}
            >
              <p className="text-[10px] font-mono text-black-400">
                VibeSwap's architecture is <span className="text-cyan-400 font-bold">structurally MEV-resistant</span>.
                Orders cannot be reordered for profit because the ordering is determined by a
                seed that nobody knows until all secrets are revealed.
              </p>
            </motion.div>
          )}

          {arch.protocol !== 'vibeswap' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="mt-4 rounded-lg p-3"
              style={{ background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.12)' }}
            >
              <p className="text-[10px] font-mono text-black-400">
                <span className="text-red-400 font-bold">Vulnerability:</span>{' '}
                {arch.protocol === 'uniswap' && 'Transactions visible in mempool enable front-running, sandwich attacks, and JIT liquidity extraction.'}
                {arch.protocol === 'curve' && 'Same mempool exposure as Uniswap. Concentrated liquidity around pegs reduces but does not eliminate MEV.'}
                {arch.protocol === '1inch' && 'Aggregation adds complexity and gas overhead. Routing through multiple DEXs expands the MEV surface area.'}
              </p>
            </motion.div>
          )}
        </motion.div>
      ))}
    </div>
  )
}

// ============ Performance Metrics Component ============

function PerformanceMetrics() {
  const [hoveredMetric, setHoveredMetric] = useState(null)
  const protocols = ['vibeswap', 'uniswap', 'curve', '1inch']

  return (
    <div className="space-y-3">
      {PERFORMANCE_METRICS.map((pm, i) => (
        <motion.div
          key={pm.metric}
          custom={i}
          variants={rowV}
          initial="hidden"
          animate="visible"
          className="rounded-lg p-4 cursor-default transition-colors"
          style={{
            background: hoveredMetric === i ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.25)',
            border: `1px solid ${hoveredMetric === i ? `${CYAN}18` : 'rgba(255,255,255,0.04)'}`,
          }}
          onMouseEnter={() => setHoveredMetric(i)}
          onMouseLeave={() => setHoveredMetric(null)}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-mono text-white font-bold">{pm.metric}</span>
            {pm.note && (
              <span className="text-[9px] font-mono text-cyan-400/60 italic">{pm.note}</span>
            )}
          </div>

          <div className="grid grid-cols-4 gap-3">
            {protocols.map((p) => {
              const data = pm[p]
              return (
                <div key={p} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span
                      className="text-[9px] font-mono font-bold uppercase"
                      style={{ color: PROTOCOL_COLORS[p] }}
                    >
                      {PROTOCOL_LABELS[p]}
                    </span>
                    {data.growing && (
                      <span className="text-[8px] font-mono text-green-400">\u2191</span>
                    )}
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: PROTOCOL_COLORS[p] }}
                      initial={{ width: 0 }}
                      animate={{ width: `${data.bar * 100}%` }}
                      transition={{ duration: 0.8, delay: i * 0.1, ease }}
                    />
                  </div>
                  <span className="text-[10px] font-mono text-black-300 block">{data.value}</span>
                </div>
              )
            })}
          </div>
        </motion.div>
      ))}
    </div>
  )
}

// ============ Unique Features Component ============

function UniqueFeatures() {
  const [expanded, setExpanded] = useState(null)

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {UNIQUE_FEATURES.map((feature, i) => (
        <motion.div
          key={feature.name}
          custom={i}
          variants={rowV}
          initial="hidden"
          animate="visible"
          className="rounded-xl p-4 cursor-pointer transition-colors"
          style={{
            background: expanded === i ? `${feature.color}08` : 'rgba(0,0,0,0.3)',
            border: `1px solid ${expanded === i ? `${feature.color}30` : 'rgba(255,255,255,0.05)'}`,
          }}
          onClick={() => setExpanded(expanded === i ? null : i)}
        >
          {/* Icon + Name */}
          <div className="flex items-start gap-3 mb-2">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center text-sm font-mono font-bold flex-shrink-0"
              style={{
                background: `${feature.color}12`,
                border: `1px solid ${feature.color}30`,
                color: feature.color,
              }}
            >
              {feature.icon}
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-[11px] font-mono font-bold text-white">{feature.name}</h4>
              <p className="text-[10px] font-mono text-black-400 mt-1 leading-relaxed">{feature.description}</p>
            </div>
          </div>

          {/* Expanded Details */}
          {expanded === i && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              transition={{ duration: 0.25 }}
              className="mt-3 pt-3"
              style={{ borderTop: `1px solid ${feature.color}15` }}
            >
              <div className="space-y-1.5 mb-3">
                {feature.details.map((d, j) => (
                  <p key={j} className="text-[10px] font-mono text-black-300">
                    <span style={{ color: feature.color }}>+</span> {d}
                  </p>
                ))}
              </div>
              <Link
                to={feature.link}
                className="text-[9px] font-mono px-2.5 py-1 rounded-full inline-block transition-colors hover:opacity-80"
                style={{
                  background: `${feature.color}10`,
                  border: `1px solid ${feature.color}25`,
                  color: feature.color,
                }}
              >
                Learn more \u2192
              </Link>
            </motion.div>
          )}

          {/* Collapsed hint */}
          {expanded !== i && (
            <p className="text-[8px] font-mono text-black-600 mt-2">Click to expand</p>
          )}
        </motion.div>
      ))}
    </div>
  )
}

// ============ Migration CTA Component ============

function MigrationCTA({ isConnected }) {
  const benefits = [
    { label: 'Zero MEV extraction', value: 'Save $31.80/trade avg', color: '#22c55e' },
    { label: 'Lower total costs', value: 'Up to 67.5% cheaper', color: '#06b6d4' },
    { label: 'Fair ordering', value: 'Fisher-Yates shuffle', color: '#a855f7' },
    { label: 'Shapley rewards', value: 'Earn for contributing', color: '#f59e0b' },
    { label: 'Cross-chain native', value: 'LayerZero V2 powered', color: '#3b82f6' },
    { label: 'IL Protection', value: 'Built-in insurance pool', color: '#ef4444' },
  ]

  const rng = useMemo(() => seededRandom(1337), [])

  return (
    <div>
      {/* Benefits Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-5">
        {benefits.map((b, i) => (
          <motion.div
            key={b.label}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.06 * PHI, duration: 0.3, ease }}
            className="rounded-lg p-3 text-center"
            style={{ background: `${b.color}06`, border: `1px solid ${b.color}15` }}
          >
            <p className="text-[10px] font-mono font-bold" style={{ color: b.color }}>{b.value}</p>
            <p className="text-[9px] font-mono text-black-500 mt-1">{b.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Comparison Summary */}
      <div className="rounded-lg p-4 mb-5" style={{ background: 'rgba(0,0,0,0.4)', border: `1px solid ${CYAN}15` }}>
        <p className="text-[11px] font-mono text-black-300 leading-relaxed text-center">
          VibeSwap is not just another DEX. It is a <span className="text-cyan-400 font-bold">structural upgrade</span> to
          decentralized trading. While others patch symptoms, we eliminate the root cause of unfairness in DeFi:
          <span className="text-cyan-400"> information asymmetry</span>.
        </p>
      </div>

      {/* CTA Buttons */}
      <div className="flex flex-col sm:flex-row gap-3">
        <Link
          to="/"
          className="flex-1 py-3.5 rounded-xl font-mono font-bold text-sm text-center transition-all hover:scale-[1.02]"
          style={{
            background: `linear-gradient(135deg, ${CYAN}20, rgba(16,185,129,0.12))`,
            border: `1px solid ${CYAN}40`,
            color: CYAN,
          }}
        >
          Start Trading on VibeSwap
        </Link>
        <Link
          to="/docs"
          className="flex-1 py-3.5 rounded-xl font-mono font-bold text-sm text-center transition-all hover:scale-[1.02]"
          style={{
            background: 'rgba(0,0,0,0.3)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: 'rgba(255,255,255,0.5)',
          }}
        >
          Read the Docs
        </Link>
      </div>

      {/* Wallet status hint */}
      {!isConnected && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="text-[9px] font-mono text-black-500 text-center mt-3"
        >
          Connect your wallet to get started — MetaMask, WalletConnect, or device wallet supported
        </motion.p>
      )}
      {isConnected && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="text-[9px] font-mono text-green-400/60 text-center mt-3"
        >
          Wallet connected — you are ready to trade
        </motion.p>
      )}
    </div>
  )
}

// ============ Floating Particles Background ============

function FloatingParticles() {
  const rng = useMemo(() => seededRandom(7919), [])
  const particles = useMemo(() => {
    return Array.from({ length: 16 }).map((_, i) => ({
      id: i,
      left: `${rng() * 100}%`,
      top: `${rng() * 100}%`,
      delay: rng() * 5,
      duration: 3 + rng() * 3,
      yDrift: -(30 + rng() * 60),
    }))
  }, [])

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute w-px h-px rounded-full"
          style={{ background: CYAN, left: p.left, top: p.top }}
          animate={{
            opacity: [0, 0.25, 0],
            scale: [0, 1.5, 0],
            y: [0, p.yDrift],
          }}
          transition={{
            duration: p.duration,
            repeat: Infinity,
            delay: p.delay,
            ease: 'easeOut',
          }}
        />
      ))}
    </div>
  )
}

// ============ Main Component ============

export default function ProtocolComparisonPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  return (
    <div className="min-h-screen pb-20 font-mono">
      {/* ============ Background ============ */}
      <FloatingParticles />

      <div className="relative z-10">
        {/* ============ Hero ============ */}
        <PageHero
          title="Protocol Comparison"
          subtitle="See how VibeSwap compares to other DEXs"
          category="ecosystem"
          badge="Live"
          badgeColor={CYAN}
        />

        <div className="max-w-4xl mx-auto px-4 space-y-6">
          {/* ============ Feature Matrix ============ */}
          <Section
            index={0}
            title="Feature Matrix"
            subtitle="Side-by-side comparison across MEV protection, cross-chain, fairness, and more"
          >
            <FeatureMatrix />
          </Section>

          {/* ============ Fee Comparison ============ */}
          <Section
            index={1}
            title="Fee Comparison"
            subtitle="All-in cost analysis per $10,000 swap"
            glowColor="matrix"
          >
            <FeeComparison />
          </Section>

          {/* ============ Architecture Comparison ============ */}
          <Section
            index={2}
            title="Architecture Comparison"
            subtitle="How each protocol processes and settles trades"
            glowColor="terminal"
          >
            <ArchitectureComparison />
          </Section>

          {/* ============ Performance Metrics ============ */}
          <Section
            index={3}
            title="Performance Metrics"
            subtitle="Growth trajectory and protocol health indicators"
            glowColor="warning"
          >
            <PerformanceMetrics />
          </Section>

          {/* ============ Unique Features ============ */}
          <Section
            index={4}
            title="VibeSwap Exclusives"
            subtitle="Features no other DEX offers"
            glowColor="terminal"
          >
            <UniqueFeatures />
          </Section>

          {/* ============ Migration CTA ============ */}
          <Section
            index={5}
            title="Switch to VibeSwap"
            subtitle="Join the fairest DEX in DeFi"
            glowColor="matrix"
          >
            <MigrationCTA isConnected={isConnected} />
          </Section>
        </div>

        {/* ============ Cross Links ============ */}
        <motion.div
          custom={6}
          variants={sectionV}
          initial="hidden"
          animate="visible"
          className="mt-8 max-w-4xl mx-auto px-4"
        >
          <div className="flex flex-wrap justify-center gap-3">
            {[
              { path: '/commit-reveal', label: 'Commit-Reveal' },
              { path: '/gametheory', label: 'Game Theory' },
              { path: '/economics', label: 'Economics' },
              { path: '/security', label: 'Security' },
              { path: '/cross-chain', label: 'Cross-Chain' },
              { path: '/', label: 'Start Trading' },
            ].map((link) => (
              <Link
                key={link.path}
                to={link.path}
                className="text-[10px] font-mono px-3 py-1.5 rounded-full transition-all hover:text-cyan-400"
                style={{
                  background: `${CYAN}08`,
                  border: `1px solid ${CYAN}15`,
                  color: `${CYAN}99`,
                }}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </motion.div>

        {/* ============ Footer Quote ============ */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2 * PHI }}
          className="mt-12 mb-8 text-center max-w-4xl mx-auto px-4"
        >
          <blockquote className="max-w-lg mx-auto">
            <p className="text-sm text-black-300 italic font-mono">
              "The solution to unfairness in DeFi is not to redistribute MEV. It is to make MEV structurally impossible."
            </p>
          </blockquote>
          <div
            className="w-16 h-px mx-auto my-4"
            style={{ background: `linear-gradient(90deg, transparent, ${CYAN}40, transparent)` }}
          />
          <p className="text-[10px] font-mono text-black-500 tracking-widest uppercase">
            Cooperative Capitalism
          </p>
        </motion.div>
      </div>
    </div>
  )
}
