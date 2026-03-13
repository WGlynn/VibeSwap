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
const ease = [0.25, 0.1, 0.25, 1]

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
    transition: { duration: 0.35, delay: i * 0.06, ease },
  }),
}

// Seeded PRNG for stable mock data (doesn't shift on re-render)
function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return (s - 1) / 2147483646
  }
}

// ============ Section Wrapper ============
function Section({ index, title, subtitle, children }) {
  return (
    <motion.div custom={index} variants={sectionV} initial="hidden" animate="visible">
      <GlassCard glowColor="terminal" spotlight hover={false} className="p-5 md:p-6">
        <div className="mb-4">
          <h2 className="text-sm font-mono font-bold tracking-wider uppercase" style={{ color: CYAN }}>{title}</h2>
          {subtitle && <p className="text-[11px] font-mono text-black-400 mt-1 italic">{subtitle}</p>}
          <div className="h-px mt-3" style={{ background: `linear-gradient(90deg, ${CYAN}40, transparent)` }} />
        </div>
        {children}
      </GlassCard>
    </motion.div>
  )
}

// ============ Data ============

const DEXES = ['VibeSwap', 'Uniswap', 'SushiSwap', 'Curve', 'Aerodrome', 'Balancer']
const DEX_COLORS = {
  VibeSwap: CYAN,
  Uniswap: '#FF007A',
  SushiSwap: '#FA52A0',
  Curve: '#FFED4A',
  Aerodrome: '#0052FF',
  Balancer: '#7B3FE4',
}

const CHAINS = [
  { id: 'base', name: 'Base', color: '#3b82f6' },
  { id: 'ethereum', name: 'Ethereum', color: '#8b5cf6' },
  { id: 'arbitrum', name: 'Arbitrum', color: '#f97316' },
  { id: 'optimism', name: 'Optimism', color: '#ef4444' },
  { id: 'polygon', name: 'Polygon', color: '#a855f7' },
  { id: 'ckb', name: 'CKB', color: '#22c55e' },
]

const TOKEN_PAIRS = ['ETH/USDC', 'WBTC/ETH', 'ARB/USDC', 'OP/ETH', 'LINK/USDC', 'DAI/USDC', 'VIBE/ETH', 'CKB/USDC']

// Generate live arb opportunities (seeded)
function generateArbOpportunities(rng) {
  const opportunities = []
  const pairs = ['ETH/USDC', 'WBTC/ETH', 'ARB/USDC', 'LINK/USDC', 'OP/ETH', 'DAI/USDC', 'VIBE/ETH', 'CKB/USDC']
  const bases = { 'ETH/USDC': 2800, 'WBTC/ETH': 17.2, 'ARB/USDC': 0.52, 'LINK/USDC': 14.8, 'OP/ETH': 0.00071, 'DAI/USDC': 1.0001, 'VIBE/ETH': 0.0000043, 'CKB/USDC': 0.0082 }

  for (let i = 0; i < 12; i++) {
    const pair = pairs[Math.floor(rng() * pairs.length)]
    const buyDex = DEXES[Math.floor(rng() * DEXES.length)]
    let sellDex = DEXES[Math.floor(rng() * DEXES.length)]
    while (sellDex === buyDex) sellDex = DEXES[Math.floor(rng() * DEXES.length)]

    const basePrice = bases[pair] || 1
    const spread = (rng() * 1.8 + 0.05).toFixed(3)
    const gasCost = (rng() * 8 + 0.5).toFixed(2)
    const estProfit = (basePrice * parseFloat(spread) / 100 * (rng() * 50 + 10)).toFixed(2)
    const netProfit = (parseFloat(estProfit) - parseFloat(gasCost)).toFixed(2)
    const chain = CHAINS[Math.floor(rng() * CHAINS.length)]
    const confidence = Math.floor(rng() * 40 + 60)
    const age = Math.floor(rng() * 120)

    opportunities.push({
      id: i,
      pair,
      buyDex,
      sellDex,
      spread: parseFloat(spread),
      estProfit: parseFloat(estProfit),
      gasCost: parseFloat(gasCost),
      netProfit: parseFloat(netProfit),
      chain,
      confidence,
      age,
    })
  }

  return opportunities.sort((a, b) => b.netProfit - a.netProfit)
}

// Generate cross-chain arb opportunities
function generateCrossChainArbs(rng) {
  const tokens = ['ETH', 'USDC', 'WBTC', 'LINK', 'VIBE', 'ARB']
  const basePrices = { ETH: 2800, USDC: 1.0, WBTC: 96000, LINK: 14.8, VIBE: 0.012, ARB: 0.52 }
  const arbs = []

  for (let i = 0; i < 8; i++) {
    const token = tokens[Math.floor(rng() * tokens.length)]
    const srcChain = CHAINS[Math.floor(rng() * CHAINS.length)]
    let dstChain = CHAINS[Math.floor(rng() * CHAINS.length)]
    while (dstChain.id === srcChain.id) dstChain = CHAINS[Math.floor(rng() * CHAINS.length)]

    const base = basePrices[token] || 1
    const srcPrice = base * (1 + (rng() - 0.5) * 0.008)
    const dstPrice = base * (1 + (rng() - 0.5) * 0.008)
    const diff = Math.abs(srcPrice - dstPrice)
    const diffPct = (diff / Math.min(srcPrice, dstPrice) * 100)
    const bridgeCost = (rng() * 12 + 1).toFixed(2)
    const bridgeTime = Math.floor(rng() * 15 + 1)
    const volume = Math.floor(rng() * 500000 + 10000)
    const netProfitPerUnit = diff - (parseFloat(bridgeCost) / (volume / base))
    const totalNet = (netProfitPerUnit * (volume / base)).toFixed(2)

    arbs.push({
      id: i,
      token,
      srcChain,
      dstChain,
      srcPrice,
      dstPrice,
      diffPct,
      bridgeCost: parseFloat(bridgeCost),
      bridgeTime,
      volume,
      totalNet: parseFloat(totalNet),
      buyChain: srcPrice < dstPrice ? srcChain : dstChain,
      sellChain: srcPrice < dstPrice ? dstChain : srcChain,
    })
  }

  return arbs.sort((a, b) => b.diffPct - a.diffPct)
}

// Generate historical performance data
function generateHistoricalPerf(rng) {
  const history = []
  const hours = 24

  for (let h = 0; h < hours; h++) {
    const executed = Math.floor(rng() * 30 + 5)
    const missed = Math.floor(rng() * 8)
    const totalProfit = (rng() * 2000 + 200).toFixed(2)
    const avgProfit = (parseFloat(totalProfit) / executed).toFixed(2)
    const gasSpent = (rng() * 400 + 20).toFixed(2)

    history.push({
      hour: `${(23 - h).toString().padStart(2, '0')}:00`,
      executed,
      missed,
      totalProfit: parseFloat(totalProfit),
      avgProfit: parseFloat(avgProfit),
      gasSpent: parseFloat(gasSpent),
      successRate: ((executed / (executed + missed)) * 100).toFixed(1),
    })
  }

  return history
}

// ============ Spread Bar ============
function SpreadBar({ value, max }) {
  const pct = Math.min((value / max) * 100, 100)
  const color = value > 1.0 ? '#22c55e' : value > 0.5 ? '#f59e0b' : '#ef4444'

  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-black-700 rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: color, width: `${pct}%` }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, delay: 0.1 }}
        />
      </div>
      <span className="font-mono text-xs" style={{ color }}>{value.toFixed(3)}%</span>
    </div>
  )
}

// ============ Confidence Badge ============
function ConfidenceBadge({ value }) {
  const color = value >= 85 ? '#22c55e' : value >= 70 ? '#f59e0b' : '#ef4444'
  const label = value >= 85 ? 'High' : value >= 70 ? 'Med' : 'Low'

  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono"
      style={{ backgroundColor: `${color}15`, color, border: `1px solid ${color}30` }}
    >
      <span className="w-1 h-1 rounded-full" style={{ backgroundColor: color }} />
      {label} {value}%
    </span>
  )
}

// ============ DEX Badge ============
function DexBadge({ name }) {
  const color = DEX_COLORS[name] || '#888'
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium"
      style={{ backgroundColor: `${color}18`, color, border: `1px solid ${color}25` }}
    >
      {name}
    </span>
  )
}

// ============ Chain Badge ============
function ChainBadge({ chain }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono"
      style={{ backgroundColor: `${chain.color}15`, color: chain.color, border: `1px solid ${chain.color}25` }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: chain.color }} />
      {chain.name}
    </span>
  )
}

// ============ Live Opportunities Table ============
function LiveOpportunities({ opportunities, sortField, setSortField, filterPair, setFilterPair }) {
  const sorted = useMemo(() => {
    const arr = [...opportunities]
    if (filterPair !== 'all') {
      const filtered = arr.filter(o => o.pair === filterPair)
      return filtered.sort((a, b) => {
        if (sortField === 'spread') return b.spread - a.spread
        if (sortField === 'profit') return b.netProfit - a.netProfit
        if (sortField === 'gas') return a.gasCost - b.gasCost
        if (sortField === 'confidence') return b.confidence - a.confidence
        return b.netProfit - a.netProfit
      })
    }
    return arr.sort((a, b) => {
      if (sortField === 'spread') return b.spread - a.spread
      if (sortField === 'profit') return b.netProfit - a.netProfit
      if (sortField === 'gas') return a.gasCost - b.gasCost
      if (sortField === 'confidence') return b.confidence - a.confidence
      return b.netProfit - a.netProfit
    })
  }, [opportunities, sortField, filterPair])

  const maxSpread = Math.max(...opportunities.map(o => o.spread), 1)

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-mono text-black-500 uppercase">Filter:</span>
          <select
            value={filterPair}
            onChange={(e) => setFilterPair(e.target.value)}
            className="bg-black-800/80 border border-black-600 rounded-lg px-2 py-1 text-xs font-mono focus:border-cyan-500/50 focus:outline-none transition-colors"
          >
            <option value="all">All Pairs</option>
            {TOKEN_PAIRS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-mono text-black-500 uppercase mr-1">Sort:</span>
          {['profit', 'spread', 'gas', 'confidence'].map(f => (
            <button
              key={f}
              onClick={() => setSortField(f)}
              className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${
                sortField === f
                  ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30'
                  : 'text-black-500 hover:text-white hover:bg-black-700/50'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="text-black-500 border-b border-black-700/50">
              <th className="text-left py-2 px-2">Pair</th>
              <th className="text-left py-2 px-2">Buy</th>
              <th className="text-left py-2 px-2">Sell</th>
              <th className="text-left py-2 px-2">Spread</th>
              <th className="text-right py-2 px-2">Est. Profit</th>
              <th className="text-right py-2 px-2">Gas</th>
              <th className="text-right py-2 px-2">Net</th>
              <th className="text-left py-2 px-2">Chain</th>
              <th className="text-center py-2 px-2">Conf.</th>
              <th className="text-right py-2 px-2">Age</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((opp, i) => (
              <motion.tr
                key={opp.id}
                custom={i}
                variants={rowV}
                initial="hidden"
                animate="visible"
                className="border-b border-black-800/40 hover:bg-cyan-500/5 transition-colors cursor-pointer"
              >
                <td className="py-2.5 px-2 text-white font-medium">{opp.pair}</td>
                <td className="py-2.5 px-2"><DexBadge name={opp.buyDex} /></td>
                <td className="py-2.5 px-2"><DexBadge name={opp.sellDex} /></td>
                <td className="py-2.5 px-2"><SpreadBar value={opp.spread} max={maxSpread} /></td>
                <td className="py-2.5 px-2 text-right text-green-400">${opp.estProfit.toFixed(2)}</td>
                <td className="py-2.5 px-2 text-right text-red-400">-${opp.gasCost.toFixed(2)}</td>
                <td className={`py-2.5 px-2 text-right font-medium ${opp.netProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {opp.netProfit >= 0 ? '+' : ''}${opp.netProfit.toFixed(2)}
                </td>
                <td className="py-2.5 px-2"><ChainBadge chain={opp.chain} /></td>
                <td className="py-2.5 px-2 text-center"><ConfidenceBadge value={opp.confidence} /></td>
                <td className="py-2.5 px-2 text-right text-black-500">{opp.age}s</td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>

      {sorted.length === 0 && (
        <div className="text-center py-8 text-black-500 text-sm font-mono">
          No opportunities found for this filter.
        </div>
      )}
    </div>
  )
}

// ============ Cross-Chain Arbs ============
function CrossChainArbs({ arbs }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="text-black-500 border-b border-black-700/50">
            <th className="text-left py-2 px-2">Token</th>
            <th className="text-left py-2 px-2">Buy On</th>
            <th className="text-right py-2 px-2">Price</th>
            <th className="text-left py-2 px-2">Sell On</th>
            <th className="text-right py-2 px-2">Price</th>
            <th className="text-right py-2 px-2">Diff %</th>
            <th className="text-right py-2 px-2">Bridge $</th>
            <th className="text-right py-2 px-2">Bridge Time</th>
            <th className="text-right py-2 px-2">Net Profit</th>
          </tr>
        </thead>
        <tbody>
          {arbs.map((arb, i) => {
            const isProfitable = arb.totalNet > 0
            return (
              <motion.tr
                key={arb.id}
                custom={i}
                variants={rowV}
                initial="hidden"
                animate="visible"
                className="border-b border-black-800/40 hover:bg-cyan-500/5 transition-colors"
              >
                <td className="py-2.5 px-2 text-white font-medium">{arb.token}</td>
                <td className="py-2.5 px-2"><ChainBadge chain={arb.buyChain} /></td>
                <td className="py-2.5 px-2 text-right text-black-300">
                  ${arb.srcPrice < arb.dstPrice ? arb.srcPrice.toFixed(4) : arb.dstPrice.toFixed(4)}
                </td>
                <td className="py-2.5 px-2"><ChainBadge chain={arb.sellChain} /></td>
                <td className="py-2.5 px-2 text-right text-black-300">
                  ${arb.srcPrice >= arb.dstPrice ? arb.srcPrice.toFixed(4) : arb.dstPrice.toFixed(4)}
                </td>
                <td className={`py-2.5 px-2 text-right font-medium ${arb.diffPct > 0.3 ? 'text-green-400' : 'text-amber-400'}`}>
                  {arb.diffPct.toFixed(3)}%
                </td>
                <td className="py-2.5 px-2 text-right text-red-400">${arb.bridgeCost.toFixed(2)}</td>
                <td className="py-2.5 px-2 text-right text-black-400">~{arb.bridgeTime} min</td>
                <td className={`py-2.5 px-2 text-right font-medium ${isProfitable ? 'text-green-400' : 'text-red-400'}`}>
                  {isProfitable ? '+' : ''}${arb.totalNet.toFixed(2)}
                </td>
              </motion.tr>
            )
          })}
        </tbody>
      </table>

      {/* LayerZero advantage note */}
      <div className="mt-3 flex items-start gap-2 p-3 rounded-lg bg-cyan-500/5 border border-cyan-500/10">
        <div className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ backgroundColor: CYAN }} />
        <p className="text-[11px] font-mono text-black-400">
          Cross-chain arbs are settled via <span className="text-cyan-400">LayerZero V2</span> messaging.
          Bridge costs include DVN verification fees and executor gas.
          VibeSwap routes through the lowest-cost path automatically.
        </p>
      </div>
    </div>
  )
}

// ============ Historical Performance ============
function HistoricalPerformance({ history }) {
  const totals = useMemo(() => {
    const totalProfit = history.reduce((s, h) => s + h.totalProfit, 0)
    const totalGas = history.reduce((s, h) => s + h.gasSpent, 0)
    const totalExecuted = history.reduce((s, h) => s + h.executed, 0)
    const totalMissed = history.reduce((s, h) => s + h.missed, 0)
    const avgSuccessRate = ((totalExecuted / (totalExecuted + totalMissed)) * 100).toFixed(1)
    const netProfit = totalProfit - totalGas
    const avgPerTrade = totalExecuted > 0 ? (netProfit / totalExecuted).toFixed(2) : '0'

    return { totalProfit, totalGas, totalExecuted, totalMissed, avgSuccessRate, netProfit, avgPerTrade }
  }, [history])

  // Mini bar chart (SVG)
  const chartWidth = 600
  const chartHeight = 120
  const padding = 24
  const barWidth = (chartWidth - padding * 2) / history.length - 2
  const maxProfit = Math.max(...history.map(h => h.totalProfit), 1)

  return (
    <div>
      {/* Summary stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Total Volume', value: `$${totals.totalProfit.toLocaleString('en-US', { maximumFractionDigits: 0 })}`, color: CYAN },
          { label: 'Net Profit (24h)', value: `$${totals.netProfit.toLocaleString('en-US', { maximumFractionDigits: 0 })}`, color: '#22c55e' },
          { label: 'Avg Per Trade', value: `$${totals.avgPerTrade}`, color: '#f59e0b' },
          { label: 'Success Rate', value: `${totals.avgSuccessRate}%`, color: '#a855f7' },
        ].map(stat => (
          <div key={stat.label} className="p-3 rounded-lg bg-black-800/40 border border-black-700/40">
            <div className="text-[10px] font-mono text-black-500 uppercase mb-1">{stat.label}</div>
            <div className="text-lg font-mono font-bold" style={{ color: stat.color }}>{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Profit chart */}
      <div className="mb-3">
        <div className="text-[10px] font-mono text-black-500 uppercase mb-2">Profit by Hour (24h)</div>
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-28">
          {/* Grid */}
          {[0.25, 0.5, 0.75].map(frac => (
            <line
              key={frac}
              x1={padding}
              y1={padding + frac * (chartHeight - padding * 2)}
              x2={chartWidth - padding}
              y2={padding + frac * (chartHeight - padding * 2)}
              stroke="rgba(255,255,255,0.04)"
            />
          ))}
          {/* Bars */}
          {history.map((h, i) => {
            const barH = (h.totalProfit / maxProfit) * (chartHeight - padding * 2)
            const x = padding + i * ((chartWidth - padding * 2) / history.length) + 1
            const y = chartHeight - padding - barH
            const successPct = parseFloat(h.successRate)
            const color = successPct >= 85 ? CYAN : successPct >= 70 ? '#f59e0b' : '#ef4444'
            return (
              <motion.rect
                key={i}
                x={x}
                y={y}
                width={barWidth}
                height={barH}
                rx={2}
                fill={color}
                opacity={0.7}
                initial={{ height: 0, y: chartHeight - padding }}
                animate={{ height: barH, y }}
                transition={{ duration: 0.4, delay: i * 0.025 }}
              />
            )
          })}
          {/* X-axis labels */}
          {history.filter((_, i) => i % 4 === 0).map((h, i) => (
            <text
              key={i}
              x={padding + (i * 4) * ((chartWidth - padding * 2) / history.length) + barWidth / 2}
              y={chartHeight - 4}
              fill="rgba(255,255,255,0.25)"
              fontSize="8"
              textAnchor="middle"
              fontFamily="monospace"
            >
              {h.hour}
            </text>
          ))}
        </svg>
      </div>

      {/* Detail table */}
      <details className="group">
        <summary className="cursor-pointer text-xs text-black-500 hover:text-black-300 transition-colors list-none flex items-center gap-1 font-mono">
          <svg className="w-3 h-3 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          Show hourly breakdown
        </summary>
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="text-black-500 border-b border-black-700/50">
                <th className="text-left py-1.5 px-2">Hour</th>
                <th className="text-right py-1.5 px-2">Executed</th>
                <th className="text-right py-1.5 px-2">Missed</th>
                <th className="text-right py-1.5 px-2">Profit</th>
                <th className="text-right py-1.5 px-2">Gas</th>
                <th className="text-right py-1.5 px-2">Avg/Trade</th>
                <th className="text-right py-1.5 px-2">Rate</th>
              </tr>
            </thead>
            <tbody>
              {history.slice(0, 12).map((h, i) => (
                <tr key={i} className="border-b border-black-800/40 hover:bg-black-700/20">
                  <td className="py-1.5 px-2 text-black-300">{h.hour}</td>
                  <td className="py-1.5 px-2 text-right text-green-400">{h.executed}</td>
                  <td className="py-1.5 px-2 text-right text-red-400">{h.missed}</td>
                  <td className="py-1.5 px-2 text-right text-cyan-400">${h.totalProfit.toFixed(0)}</td>
                  <td className="py-1.5 px-2 text-right text-black-400">${h.gasSpent.toFixed(0)}</td>
                  <td className="py-1.5 px-2 text-right text-black-300">${h.avgProfit}</td>
                  <td className={`py-1.5 px-2 text-right ${parseFloat(h.successRate) >= 85 ? 'text-green-400' : parseFloat(h.successRate) >= 70 ? 'text-amber-400' : 'text-red-400'}`}>
                    {h.successRate}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}

// ============ Route Builder ============
function RouteBuilder({ isConnected }) {
  const [sourceChain, setSourceChain] = useState('base')
  const [destChain, setDestChain] = useState('arbitrum')
  const [intermediateChain, setIntermediateChain] = useState('ethereum')
  const [sourceToken, setSourceToken] = useState('ETH')
  const [destToken, setDestToken] = useState('USDC')
  const [amount, setAmount] = useState('1.0')
  const [showRoute, setShowRoute] = useState(false)

  const availableTokens = ['ETH', 'USDC', 'WBTC', 'LINK', 'VIBE', 'ARB', 'OP', 'DAI']

  // Simulated route output
  const route = useMemo(() => {
    if (!showRoute) return null
    const rng = seededRandom(
      sourceChain.length * 31 + destChain.length * 17 + intermediateChain.length * 7 +
      sourceToken.length * 53 + destToken.length * 41 + parseFloat(amount || '1') * 100
    )

    const inputValue = parseFloat(amount || '1')
    const hop1Rate = 1 + (rng() - 0.5) * 0.002
    const hop2Rate = 1 + (rng() - 0.5) * 0.002
    const hop3Rate = sourceToken !== destToken ? (2800 + (rng() - 0.5) * 20) : 1
    const gasCostHop1 = rng() * 3 + 0.5
    const gasCostHop2 = rng() * 5 + 1
    const gasCostHop3 = rng() * 3 + 0.5
    const totalGas = gasCostHop1 + gasCostHop2 + gasCostHop3

    const hop1Output = inputValue * hop1Rate
    const hop2Output = hop1Output * hop2Rate
    const finalOutput = sourceToken === destToken ? hop2Output : hop2Output * hop3Rate

    const profitPct = ((finalOutput - inputValue * (sourceToken === destToken ? 1 : hop3Rate)) / (inputValue * (sourceToken === destToken ? 1 : hop3Rate)) * 100)

    return {
      hops: [
        { chain: CHAINS.find(c => c.id === sourceChain), dex: 'VibeSwap', action: `Swap ${sourceToken}`, output: hop1Output.toFixed(6), gas: gasCostHop1.toFixed(2) },
        { chain: CHAINS.find(c => c.id === intermediateChain), dex: 'LayerZero Bridge', action: 'Cross-chain transfer', output: hop2Output.toFixed(6), gas: gasCostHop2.toFixed(2) },
        { chain: CHAINS.find(c => c.id === destChain), dex: 'Uniswap', action: `Swap to ${destToken}`, output: finalOutput.toFixed(6), gas: gasCostHop3.toFixed(2) },
      ],
      totalGas: totalGas.toFixed(2),
      finalOutput: finalOutput.toFixed(6),
      profitPct: profitPct.toFixed(3),
      estimatedTime: `${Math.floor(rng() * 10 + 3)} min`,
      mevProtected: sourceChain === 'base' || destChain === 'base',
    }
  }, [showRoute, sourceChain, destChain, intermediateChain, sourceToken, destToken, amount])

  return (
    <div>
      {/* Route inputs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        {/* Source */}
        <div className="space-y-2">
          <div className="text-[10px] font-mono text-black-500 uppercase">Source</div>
          <select
            value={sourceChain}
            onChange={(e) => { setSourceChain(e.target.value); setShowRoute(false) }}
            className="w-full bg-black-800/80 border border-black-600 rounded-lg px-3 py-2 text-xs font-mono focus:border-cyan-500/50 focus:outline-none transition-colors"
          >
            {CHAINS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select
            value={sourceToken}
            onChange={(e) => { setSourceToken(e.target.value); setShowRoute(false) }}
            className="w-full bg-black-800/80 border border-black-600 rounded-lg px-3 py-2 text-xs font-mono focus:border-cyan-500/50 focus:outline-none transition-colors"
          >
            {availableTokens.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <input
            type="number"
            value={amount}
            onChange={(e) => { setAmount(e.target.value); setShowRoute(false) }}
            placeholder="Amount"
            className="w-full bg-black-800/80 border border-black-600 rounded-lg px-3 py-2 text-xs font-mono focus:border-cyan-500/50 focus:outline-none transition-colors"
          />
        </div>

        {/* Intermediate */}
        <div className="space-y-2">
          <div className="text-[10px] font-mono text-black-500 uppercase">Intermediate Hop</div>
          <select
            value={intermediateChain}
            onChange={(e) => { setIntermediateChain(e.target.value); setShowRoute(false) }}
            className="w-full bg-black-800/80 border border-black-600 rounded-lg px-3 py-2 text-xs font-mono focus:border-cyan-500/50 focus:outline-none transition-colors"
          >
            {CHAINS.filter(c => c.id !== sourceChain && c.id !== destChain).map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <div className="flex items-center justify-center py-3">
            <svg className="w-8 h-8 text-black-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </div>
          <div className="text-[10px] font-mono text-black-600 text-center italic">
            Optional multi-hop routing
          </div>
        </div>

        {/* Destination */}
        <div className="space-y-2">
          <div className="text-[10px] font-mono text-black-500 uppercase">Destination</div>
          <select
            value={destChain}
            onChange={(e) => { setDestChain(e.target.value); setShowRoute(false) }}
            className="w-full bg-black-800/80 border border-black-600 rounded-lg px-3 py-2 text-xs font-mono focus:border-cyan-500/50 focus:outline-none transition-colors"
          >
            {CHAINS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select
            value={destToken}
            onChange={(e) => { setDestToken(e.target.value); setShowRoute(false) }}
            className="w-full bg-black-800/80 border border-black-600 rounded-lg px-3 py-2 text-xs font-mono focus:border-cyan-500/50 focus:outline-none transition-colors"
          >
            {availableTokens.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <div className="text-[10px] font-mono text-black-600 text-right">
            Output token
          </div>
        </div>
      </div>

      {/* Calculate button */}
      <button
        onClick={() => setShowRoute(true)}
        disabled={!isConnected}
        className={`w-full py-2.5 rounded-lg text-sm font-mono font-medium transition-all ${
          isConnected
            ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/25'
            : 'bg-black-700/50 text-black-500 border border-black-600 cursor-not-allowed'
        }`}
      >
        {isConnected ? 'Calculate Optimal Route' : 'Connect Wallet to Build Routes'}
      </button>

      {/* Route result */}
      {route && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1 / (PHI * PHI), ease }}
          className="mt-4 space-y-3"
        >
          {/* Hop timeline */}
          <div className="relative">
            {route.hops.map((hop, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: i * 0.15 }}
                className="flex items-start gap-3 mb-3 last:mb-0"
              >
                {/* Timeline dot + line */}
                <div className="flex flex-col items-center flex-shrink-0">
                  <div
                    className="w-3 h-3 rounded-full border-2"
                    style={{ borderColor: hop.chain?.color || CYAN, backgroundColor: `${hop.chain?.color || CYAN}30` }}
                  />
                  {i < route.hops.length - 1 && (
                    <div className="w-px h-8 bg-black-700 mt-1" />
                  )}
                </div>
                {/* Hop detail */}
                <div className="flex-1 p-2.5 rounded-lg bg-black-800/40 border border-black-700/40">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <ChainBadge chain={hop.chain || CHAINS[0]} />
                      <span className="text-[10px] font-mono text-black-400">{hop.dex}</span>
                    </div>
                    <span className="text-[10px] font-mono text-red-400">gas: ${hop.gas}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-black-300">{hop.action}</span>
                    <span className="text-xs font-mono text-white">{hop.output}</span>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Route summary */}
          <div className="p-3 rounded-lg bg-black-800/30 border border-black-700/40 space-y-1.5">
            <div className="flex justify-between text-xs font-mono">
              <span className="text-black-500">Final Output</span>
              <span className="text-white font-medium">{route.finalOutput} {destToken}</span>
            </div>
            <div className="flex justify-between text-xs font-mono">
              <span className="text-black-500">Total Gas</span>
              <span className="text-red-400">${route.totalGas}</span>
            </div>
            <div className="flex justify-between text-xs font-mono">
              <span className="text-black-500">Edge</span>
              <span className={`font-medium ${parseFloat(route.profitPct) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {parseFloat(route.profitPct) >= 0 ? '+' : ''}{route.profitPct}%
              </span>
            </div>
            <div className="flex justify-between text-xs font-mono">
              <span className="text-black-500">Est. Time</span>
              <span className="text-black-300">{route.estimatedTime}</span>
            </div>
            {route.mevProtected && (
              <div className="flex items-center gap-1.5 mt-1">
                <div className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                <span className="text-[10px] font-mono text-cyan-400">MEV-protected via commit-reveal on Base</span>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </div>
  )
}

// ============ Risk Analysis ============
function RiskAnalysis() {
  const riskData = useMemo(() => {
    const rng = seededRandom(77777)
    return {
      slippage: {
        label: 'Slippage Risk',
        level: 'Low',
        value: (rng() * 0.3 + 0.05).toFixed(2),
        color: '#22c55e',
        description: 'Expected deviation between quoted and executed price. Batch auctions use uniform clearing prices, reducing slippage to near-zero for VibeSwap routes.',
        factors: [
          { name: 'Pool depth', impact: 'Low', detail: 'Deep liquidity across major pairs' },
          { name: 'Trade size', impact: 'Variable', detail: 'Large trades (>$100k) may see 0.1-0.3% impact' },
          { name: 'Volatility', impact: 'Medium', detail: 'High vol increases price uncertainty between commit and settle' },
        ],
      },
      execution: {
        label: 'Execution Risk',
        level: 'Medium',
        value: (rng() * 1.5 + 0.2).toFixed(2),
        color: '#f59e0b',
        description: 'Risk that the arbitrage opportunity closes before execution. Cross-chain arbs have higher execution risk due to bridge latency.',
        factors: [
          { name: 'Bridge latency', impact: 'High', detail: '1-15 min delays can close opportunities' },
          { name: 'Block confirmation', impact: 'Medium', detail: 'Reorgs on L2s can invalidate trades' },
          { name: 'Reveal timing', impact: 'Low', detail: '2s reveal window is tight but predictable' },
        ],
      },
      gasWar: {
        label: 'Gas War Probability',
        level: 'Low',
        value: (rng() * 15 + 2).toFixed(0),
        color: '#3b82f6',
        description: 'Probability of competing bots driving up gas costs. VibeSwap commit-reveal eliminates priority gas auctions — all orders in a batch get the same price.',
        factors: [
          { name: 'Bot competition', impact: 'Low', detail: 'Commit-reveal makes front-running impossible' },
          { name: 'Network congestion', impact: 'Variable', detail: 'Base L2 gas is typically < $0.01' },
          { name: 'Priority fees', impact: 'None', detail: 'Batch auctions remove priority ordering' },
        ],
      },
      mevCompetition: {
        label: 'MEV Competition',
        level: 'None',
        value: '0',
        color: CYAN,
        description: 'MEV extraction risk from validators or searchers. VibeSwap eliminates MEV by construction — orders are committed as hashes, revealed simultaneously, and settled at a uniform clearing price.',
        factors: [
          { name: 'Sandwich attacks', impact: 'Impossible', detail: 'Hashed commits prevent order visibility' },
          { name: 'Front-running', impact: 'Impossible', detail: 'All orders settle at same price' },
          { name: 'Back-running', impact: 'Minimal', detail: 'Fisher-Yates shuffle randomizes execution order' },
        ],
      },
    }
  }, [])

  const riskKeys = ['slippage', 'execution', 'gasWar', 'mevCompetition']
  const [expanded, setExpanded] = useState(null)

  return (
    <div className="space-y-3">
      {/* Risk gauge row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {riskKeys.map((key, i) => {
          const risk = riskData[key]
          return (
            <motion.div
              key={key}
              custom={i}
              variants={rowV}
              initial="hidden"
              animate="visible"
              className="text-center p-3 rounded-lg bg-black-800/40 border border-black-700/40 cursor-pointer hover:bg-black-800/60 transition-colors"
              onClick={() => setExpanded(expanded === key ? null : key)}
            >
              {/* Circular gauge */}
              <svg viewBox="0 0 80 80" className="w-14 h-14 mx-auto mb-2">
                <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="5" />
                <circle
                  cx="40" cy="40" r="34"
                  fill="none"
                  stroke={risk.color}
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 34}`}
                  strokeDashoffset={`${2 * Math.PI * 34 * (1 - parseFloat(risk.value) / 100)}`}
                  transform="rotate(-90 40 40)"
                  opacity={0.8}
                />
                <text x="40" y="38" fill={risk.color} fontSize="14" textAnchor="middle" fontFamily="monospace" fontWeight="bold">
                  {risk.value}
                </text>
                <text x="40" y="52" fill="rgba(255,255,255,0.3)" fontSize="8" textAnchor="middle" fontFamily="monospace">
                  {key === 'gasWar' ? '%' : key === 'mevCompetition' ? '' : '%'}
                </text>
              </svg>
              <div className="text-[10px] font-mono text-black-400 mb-0.5">{risk.label}</div>
              <div className="text-xs font-mono font-medium" style={{ color: risk.color }}>{risk.level}</div>
            </motion.div>
          )
        })}
      </div>

      {/* Expanded risk detail */}
      {expanded && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 1 / (PHI * PHI * PHI) }}
          className="p-4 rounded-lg bg-black-800/30 border border-black-700/40"
        >
          <h3 className="text-sm font-mono font-medium mb-2" style={{ color: riskData[expanded].color }}>
            {riskData[expanded].label}
          </h3>
          <p className="text-[11px] font-mono text-black-400 mb-3 leading-relaxed">
            {riskData[expanded].description}
          </p>
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="text-black-500 border-b border-black-700/50">
                <th className="text-left py-1.5 px-2">Factor</th>
                <th className="text-left py-1.5 px-2">Impact</th>
                <th className="text-left py-1.5 px-2">Detail</th>
              </tr>
            </thead>
            <tbody>
              {riskData[expanded].factors.map((f, i) => {
                const impactColor = f.impact === 'High' ? '#ef4444'
                  : f.impact === 'Medium' ? '#f59e0b'
                  : f.impact === 'Low' ? '#22c55e'
                  : f.impact === 'None' || f.impact === 'Impossible' || f.impact === 'Minimal' ? CYAN
                  : '#888'
                return (
                  <tr key={i} className="border-b border-black-800/40">
                    <td className="py-1.5 px-2 text-black-300">{f.name}</td>
                    <td className="py-1.5 px-2">
                      <span className="font-medium" style={{ color: impactColor }}>{f.impact}</span>
                    </td>
                    <td className="py-1.5 px-2 text-black-400">{f.detail}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </motion.div>
      )}

      {/* MEV protection explainer */}
      <div className="flex items-start gap-2 p-3 rounded-lg bg-cyan-500/5 border border-cyan-500/10">
        <div className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ backgroundColor: CYAN }} />
        <p className="text-[11px] font-mono text-black-400">
          VibeSwap's <span className="text-cyan-400">commit-reveal batch auctions</span> eliminate MEV by construction.
          All orders are hashed during commit, revealed simultaneously, shuffled via Fisher-Yates, and settled at a
          <span className="text-cyan-400"> uniform clearing price</span>. Sandwich attacks and front-running are
          structurally impossible — not just discouraged, but mathematically eliminated.
        </p>
      </div>
    </div>
  )
}

// ============ Main Page ============
export default function ArbitragePage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [sortField, setSortField] = useState('profit')
  const [filterPair, setFilterPair] = useState('all')

  // Generate all mock data once with seeded PRNG
  const arbRng = useMemo(() => seededRandom(161803), [])
  const opportunities = useMemo(() => generateArbOpportunities(arbRng), [arbRng])

  const crossChainRng = useMemo(() => seededRandom(271828), [])
  const crossChainArbs = useMemo(() => generateCrossChainArbs(crossChainRng), [crossChainRng])

  const historyRng = useMemo(() => seededRandom(314159), [])
  const historicalPerf = useMemo(() => generateHistoricalPerf(historyRng), [historyRng])

  // Summary stats
  const summaryStats = useMemo(() => {
    const totalOpps = opportunities.length
    const profitableOpps = opportunities.filter(o => o.netProfit > 0).length
    const totalNetProfit = opportunities.reduce((s, o) => s + Math.max(o.netProfit, 0), 0)
    const avgSpread = (opportunities.reduce((s, o) => s + o.spread, 0) / totalOpps).toFixed(3)
    const bestOpp = opportunities[0]

    return { totalOpps, profitableOpps, totalNetProfit, avgSpread, bestOpp }
  }, [opportunities])

  return (
    <div className="min-h-screen pb-8">
      <PageHero
        title="Arbitrage Scanner"
        subtitle="Find cross-DEX and cross-chain price differences"
        category="trading"
        badge="Live"
        badgeColor="#f59e0b"
      />

      <div className="max-w-7xl mx-auto px-4 space-y-6">

        {/* Quick stats bar */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1 / (PHI * PHI), ease }}
          className="grid grid-cols-2 sm:grid-cols-5 gap-3"
        >
          {[
            { label: 'Live Opportunities', value: summaryStats.totalOpps, color: CYAN },
            { label: 'Profitable', value: summaryStats.profitableOpps, color: '#22c55e' },
            { label: 'Total Net Profit', value: `$${summaryStats.totalNetProfit.toFixed(0)}`, color: '#22c55e' },
            { label: 'Avg Spread', value: `${summaryStats.avgSpread}%`, color: '#f59e0b' },
            { label: 'Best Opp', value: summaryStats.bestOpp ? `+$${summaryStats.bestOpp.netProfit.toFixed(0)}` : '--', color: '#a855f7' },
          ].map(stat => (
            <div key={stat.label} className="p-3 rounded-lg bg-black-800/40 border border-black-700/40">
              <div className="text-[10px] font-mono text-black-500 uppercase mb-1">{stat.label}</div>
              <div className="text-lg font-mono font-bold" style={{ color: stat.color }}>{stat.value}</div>
            </div>
          ))}
        </motion.div>

        {/* Section 1: Live Opportunities */}
        <Section index={0} title="Live Opportunities" subtitle="Real-time arbitrage spreads across DEXes">
          <LiveOpportunities
            opportunities={opportunities}
            sortField={sortField}
            setSortField={setSortField}
            filterPair={filterPair}
            setFilterPair={setFilterPair}
          />
        </Section>

        {/* Section 2: Cross-Chain Arbs */}
        <Section index={1} title="Cross-Chain Arbitrage" subtitle="Price differences across chains with bridge costs factored in">
          <CrossChainArbs arbs={crossChainArbs} />
        </Section>

        {/* Section 3: Historical Performance */}
        <Section index={2} title="Historical Performance" subtitle="Past 24h arbitrage activity and captured profits">
          <HistoricalPerformance history={historicalPerf} />
        </Section>

        {/* Two-column layout for Route Builder + Risk Analysis */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Section 4: Route Builder */}
          <Section index={3} title="Route Builder" subtitle="Construct multi-hop arbitrage paths">
            <RouteBuilder isConnected={isConnected} />
          </Section>

          {/* Section 5: Risk Analysis */}
          <Section index={4} title="Risk Analysis" subtitle="Evaluate risk factors before executing">
            <RiskAnalysis />
          </Section>
        </div>

        {/* Navigation footer */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 1.2 }}
          className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-black-800/50"
        >
          <div className="flex items-center gap-4 text-xs font-mono">
            <Link to="/trade" className="text-black-500 hover:text-cyan-400 transition-colors">
              Trading
            </Link>
            <Link to="/aggregator" className="text-black-500 hover:text-cyan-400 transition-colors">
              Aggregator
            </Link>
            <Link to="/cross-chain" className="text-black-500 hover:text-cyan-400 transition-colors">
              Cross-Chain
            </Link>
            <Link to="/analytics" className="text-black-500 hover:text-cyan-400 transition-colors">
              Analytics
            </Link>
          </div>
          <div className="text-[10px] text-black-600 font-mono">
            Powered by VibeSwap Commit-Reveal Auction Engine
          </div>
        </motion.div>
      </div>
    </div>
  )
}
