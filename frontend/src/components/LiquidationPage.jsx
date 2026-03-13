import { useState, useMemo, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

// ============ Constants ============
const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const AMBER = '#FBBF24'
const GREEN = '#00FF41'
const RED = '#EF4444'

// ============ Seeded PRNG ============
function seededRandom(seed) {
  let s = seed
  return () => { s = (s * 16807 + 0) % 2147483647; return (s - 1) / 2147483646 }
}

// ============ Helpers ============
const fmt = (v) => v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : `$${v.toFixed(2)}`
const fmtNum = (v) => v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : v.toFixed(2)
function getHealthColor(hf) {
  if (hf >= 1.5) return GREEN
  if (hf >= 1.0) return AMBER
  return RED
}

function getHealthLabel(hf) {
  if (hf >= 1.5) return 'Safe'
  if (hf >= 1.0) return 'Caution'
  return 'Liquidatable'
}

function formatCountdown(seconds) {
  if (seconds <= 0) return '00:00'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// ============ Mock Data ============
const MOCK_ADDRESSES = [
  '0x3a1F...8c2D', '0x7bE4...1f9A', '0xd52C...4e7B', '0x91aA...6d3F',
  '0xf0c8...2a5E', '0x4dB7...9c1A', '0x6eF3...0b8D', '0xc28A...5f4C',
]

const COLLATERAL_TOKENS = [
  { symbol: 'ETH', icon: 'E', color: '#627EEA', price: 3420.50 },
  { symbol: 'BTC', icon: 'B', color: '#F7931A', price: 68500 },
  { symbol: 'SOL', icon: 'S', color: '#9945FF', price: 185.20 },
  { symbol: 'JUL', icon: 'J', color: GREEN, price: 0.84 },
]

// 8 at-risk positions
const AT_RISK_POSITIONS = [
  { user: MOCK_ADDRESSES[0], collateral: 'ETH', collateralAmount: 2.15, debt: 'USDC', debtAmount: 5840, healthFactor: 1.18, collateralRatio: 126 },
  { user: MOCK_ADDRESSES[1], collateral: 'BTC', collateralAmount: 0.12, debt: 'USDT', debtAmount: 7200, healthFactor: 1.41, collateralRatio: 142 },
  { user: MOCK_ADDRESSES[2], collateral: 'ETH', collateralAmount: 5.80, debt: 'DAI', debtAmount: 17500, healthFactor: 1.13, collateralRatio: 113 },
  { user: MOCK_ADDRESSES[3], collateral: 'SOL', collateralAmount: 320, debt: 'USDC', debtAmount: 48200, healthFactor: 0.87, collateralRatio: 87 },
  { user: MOCK_ADDRESSES[4], collateral: 'ETH', collateralAmount: 1.05, debt: 'USDT', debtAmount: 3200, healthFactor: 1.12, collateralRatio: 112 },
  { user: MOCK_ADDRESSES[5], collateral: 'BTC', collateralAmount: 0.08, debt: 'USDC', debtAmount: 4800, healthFactor: 0.95, collateralRatio: 95 },
  { user: MOCK_ADDRESSES[6], collateral: 'JUL', collateralAmount: 45000, debt: 'DAI', debtAmount: 28500, healthFactor: 0.93, collateralRatio: 93 },
  { user: MOCK_ADDRESSES[7], collateral: 'SOL', collateralAmount: 85, debt: 'USDC', debtAmount: 14200, healthFactor: 1.67, collateralRatio: 167 },
]

// 3 active auctions
const ACTIVE_AUCTIONS = [
  { id: 1, asset: 'ETH', amount: 5.80, currentBid: 17150, timeRemaining: 342, minIncrement: 50, bidder: '0x91aA...6d3F', startBid: 16500, numBids: 7 },
  { id: 2, asset: 'JUL', amount: 45000, currentBid: 27800, timeRemaining: 128, minIncrement: 100, bidder: '0xf0c8...2a5E', startBid: 26000, numBids: 12 },
  { id: 3, asset: 'BTC', amount: 0.08, currentBid: 4650, timeRemaining: 561, minIncrement: 25, bidder: '0x7bE4...1f9A', startBid: 4400, numBids: 4 },
]

// 6 liquidation history events
const LIQUIDATION_HISTORY = [
  { timestamp: '2h ago', user: '0xa4F2...7b1C', asset: 'ETH', amount: 3.2, liquidator: '0x3a1F...8c2D', discount: 5.2, debtRepaid: 9800 },
  { timestamp: '4h ago', user: '0xb8C3...2d9E', asset: 'SOL', amount: 180, liquidator: '0x7bE4...1f9A', discount: 4.8, debtRepaid: 31200 },
  { timestamp: '6h ago', user: '0xc1D5...8a3F', asset: 'BTC', amount: 0.15, liquidator: '0xd52C...4e7B', discount: 3.9, debtRepaid: 9600 },
  { timestamp: '11h ago', user: '0xd7E6...4c2A', asset: 'JUL', amount: 62000, liquidator: '0x3a1F...8c2D', discount: 7.1, debtRepaid: 48400 },
  { timestamp: '18h ago', user: '0xe2F8...5d1B', asset: 'ETH', amount: 1.8, liquidator: '0xf0c8...2a5E', discount: 4.5, debtRepaid: 5600 },
  { timestamp: '1d ago', user: '0xf3A9...6e0C', asset: 'SOL', amount: 420, liquidator: '0x7bE4...1f9A', discount: 6.3, debtRepaid: 72800 },
]

// Risk heatmap lending pairs
const LENDING_PAIRS = ['ETH/USDC', 'BTC/USDC', 'SOL/USDT', 'ETH/DAI', 'JUL/USDC', 'BTC/DAI', 'SOL/USDC', 'ETH/USDT', 'JUL/DAI']
const rngHeat = seededRandom(4242)
const HEATMAP_DATA = LENDING_PAIRS.map((pair) => ({
  pair,
  riskScore: +(rngHeat() * 100).toFixed(0),
  positionsAtRisk: Math.floor(rngHeat() * 40),
  totalExposure: +(rngHeat() * 5_000_000 + 200_000).toFixed(0),
}))

// ============ Section Wrapper ============
function Section({ title, children, className = '' }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 / PHI }}
      className={`mb-8 ${className}`}
    >
      <h2 className="text-white font-bold text-lg mb-4 flex items-center gap-2">
        <span style={{ color: RED }}>_</span>{title}
      </h2>
      {children}
    </motion.div>
  )
}

// ============ Risk Heatmap Cell ============
function HeatCell({ score }) {
  const intensity = score / 100
  const bg = intensity > 0.7
    ? `rgba(239, 68, 68, ${0.15 + intensity * 0.25})`
    : intensity > 0.4
      ? `rgba(251, 191, 36, ${0.1 + intensity * 0.2})`
      : `rgba(0, 255, 65, ${0.08 + intensity * 0.12})`
  const textColor = intensity > 0.7 ? RED : intensity > 0.4 ? AMBER : GREEN

  return (
    <div className="rounded-lg p-2 text-center" style={{ backgroundColor: bg }}>
      <div className="text-sm font-mono font-bold" style={{ color: textColor }}>{score}</div>
    </div>
  )
}

// ============ Countdown Hook ============
function useCountdown(initialSeconds) {
  const [seconds, setSeconds] = useState(initialSeconds)

  useEffect(() => {
    if (seconds <= 0) return
    const timer = setInterval(() => {
      setSeconds((prev) => Math.max(0, prev - 1))
    }, 1000)
    return () => clearInterval(timer)
  }, [seconds > 0])

  return seconds
}

// ============ Auction Card ============
function AuctionCard({ auction, index, isConnected }) {
  const remaining = useCountdown(auction.timeRemaining)
  const token = COLLATERAL_TOKENS.find((t) => t.symbol === auction.asset)
  const discount = token ? ((1 - auction.currentBid / (auction.amount * token.price)) * 100).toFixed(1) : '0.0'
  const isUrgent = remaining < 120

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1 * PHI }}
    >
      <GlassCard glowColor={isUrgent ? 'warning' : 'terminal'} hover spotlight>
        <div className="p-5">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <span className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold border"
                style={{ borderColor: `${token?.color || CYAN}40`, color: token?.color || CYAN, backgroundColor: `${token?.color || CYAN}10` }}>
                {token?.icon || '?'}
              </span>
              <div>
                <div className="text-white font-bold text-sm">{auction.amount} {auction.asset}</div>
                <div className="text-[10px] text-gray-500 font-mono">Auction #{auction.id}</div>
              </div>
            </div>
            <div className="text-right">
              <div className={`text-lg font-mono font-bold ${isUrgent ? 'animate-pulse' : ''}`}
                style={{ color: isUrgent ? RED : AMBER }}>
                {formatCountdown(remaining)}
              </div>
              <div className="text-[9px] text-gray-500 font-mono">remaining</div>
            </div>
          </div>

          {/* Bid Info */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="bg-gray-900/40 rounded-lg p-2 text-center">
              <div className="text-xs font-mono font-bold" style={{ color: CYAN }}>{fmt(auction.currentBid)}</div>
              <div className="text-[9px] text-gray-500 font-mono">Current Bid</div>
            </div>
            <div className="bg-gray-900/40 rounded-lg p-2 text-center">
              <div className="text-xs font-mono font-bold" style={{ color: GREEN }}>{discount}%</div>
              <div className="text-[9px] text-gray-500 font-mono">Discount</div>
            </div>
            <div className="bg-gray-900/40 rounded-lg p-2 text-center">
              <div className="text-xs font-mono font-bold text-gray-300">{auction.numBids}</div>
              <div className="text-[9px] text-gray-500 font-mono">Bids</div>
            </div>
          </div>

          {/* Details */}
          <div className="flex items-center justify-between text-[10px] font-mono text-gray-400 mb-4">
            <span>Min increment: {fmt(auction.minIncrement)}</span>
            <span>Leading: {auction.bidder}</span>
          </div>

          {/* Bid Button */}
          <button
            disabled={!isConnected || remaining <= 0}
            className="w-full py-2.5 rounded-xl font-bold font-mono text-sm transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:brightness-110"
            style={{ backgroundColor: remaining > 0 ? CYAN : '#374151', color: remaining > 0 ? '#0a0a0a' : '#6B7280' }}
          >
            {!isConnected ? 'Connect Wallet' : remaining <= 0 ? 'Auction Ended' : `Place Bid (min ${fmt(auction.currentBid + auction.minIncrement)})`}
          </button>
        </div>
      </GlassCard>
    </motion.div>
  )
}

// ============ Main Component ============
export default function LiquidationPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [sortField, setSortField] = useState('healthFactor')
  const [sortAsc, setSortAsc] = useState(true)
  const [selectedPosition, setSelectedPosition] = useState(null)

  // ============ Derived Stats ============
  const totalAtRisk = useMemo(() => AT_RISK_POSITIONS.reduce((sum, pos) => {
    const token = COLLATERAL_TOKENS.find((t) => t.symbol === pos.collateral)
    return sum + (token ? pos.collateralAmount * token.price : 0)
  }, 0), [])
  const liquidated24h = useMemo(() => LIQUIDATION_HISTORY.reduce((sum, ev) => sum + ev.debtRepaid, 0), [])
  const avgDiscount = useMemo(() => LIQUIDATION_HISTORY.reduce((sum, ev) => sum + ev.discount, 0) / LIQUIDATION_HISTORY.length, [])
  const activeAuctionCount = ACTIVE_AUCTIONS.length

  // ============ Sorted Positions ============
  const sortedPositions = useMemo(() => [...AT_RISK_POSITIONS].sort((a, b) => {
    const valA = a[sortField], valB = b[sortField]
    if (typeof valA === 'number') return sortAsc ? valA - valB : valB - valA
    return sortAsc ? String(valA).localeCompare(String(valB)) : String(valB).localeCompare(String(valA))
  }), [sortField, sortAsc])

  const handleSort = (field) => {
    if (sortField === field) setSortAsc(!sortAsc)
    else { setSortField(field); setSortAsc(true) }
  }

  // ============ Liquidator Stats (mock) ============
  const liquidatorStats = { totalLiquidations: 23, profitEarned: 14820, successRate: 87.4, avgDiscount: 5.1 }

  // ============ Risk Score Distribution ============
  const riskDistribution = useMemo(() => ({
    safe: AT_RISK_POSITIONS.filter((p) => p.healthFactor >= 1.5).length,
    caution: AT_RISK_POSITIONS.filter((p) => p.healthFactor >= 1.0 && p.healthFactor < 1.5).length,
    liquidatable: AT_RISK_POSITIONS.filter((p) => p.healthFactor < 1.0).length,
  }), [])

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* ============ Hero ============ */}
      <PageHero
        title="Liquidations"
        subtitle="Monitor at-risk positions and participate in fair liquidation auctions via commit-reveal"
        category="protocol"
      />

      {/* ============ 1. Stats Bar ============ */}
      <Section title="Protocol Liquidation Overview">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total At-Risk', value: fmt(totalAtRisk), color: RED },
            { label: '24h Liquidated', value: fmt(liquidated24h), color: AMBER },
            { label: 'Avg Discount', value: `${avgDiscount.toFixed(1)}%`, color: GREEN },
            { label: 'Active Auctions', value: `${activeAuctionCount}`, color: CYAN },
          ].map((s, i) => (
            <GlassCard key={s.label} glowColor="terminal" hover>
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 * PHI }}
                className="p-4 text-center"
              >
                <div className="text-xl font-mono font-bold" style={{ color: s.color }}>{s.value}</div>
                <div className="text-white text-[10px] font-bold mt-1">{s.label}</div>
              </motion.div>
            </GlassCard>
          ))}
        </div>
      </Section>

      {/* ============ 2. At-Risk Positions Table ============ */}
      <Section title="At-Risk Positions">
        <GlassCard glowColor="terminal" hover={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="text-gray-500 border-b border-gray-800">
                  <th className="text-left p-3 cursor-pointer hover:text-white transition-colors"
                    onClick={() => handleSort('user')}>
                    User {sortField === 'user' ? (sortAsc ? '↑' : '↓') : ''}
                  </th>
                  <th className="text-left p-3 cursor-pointer hover:text-white transition-colors"
                    onClick={() => handleSort('collateral')}>
                    Collateral {sortField === 'collateral' ? (sortAsc ? '↑' : '↓') : ''}
                  </th>
                  <th className="text-right p-3 cursor-pointer hover:text-white transition-colors"
                    onClick={() => handleSort('debtAmount')}>
                    Debt {sortField === 'debtAmount' ? (sortAsc ? '↑' : '↓') : ''}
                  </th>
                  <th className="text-right p-3 cursor-pointer hover:text-white transition-colors"
                    onClick={() => handleSort('healthFactor')}>
                    Health {sortField === 'healthFactor' ? (sortAsc ? '↑' : '↓') : ''}
                  </th>
                  <th className="text-right p-3 hidden sm:table-cell cursor-pointer hover:text-white transition-colors"
                    onClick={() => handleSort('collateralRatio')}>
                    CR% {sortField === 'collateralRatio' ? (sortAsc ? '↑' : '↓') : ''}
                  </th>
                  <th className="text-right p-3 hidden sm:table-cell">Dist. to Liq.</th>
                </tr>
              </thead>
              <tbody>
                {sortedPositions.map((pos, i) => {
                  const token = COLLATERAL_TOKENS.find((t) => t.symbol === pos.collateral)
                  const collateralValue = token ? pos.collateralAmount * token.price : 0
                  const distToLiq = pos.healthFactor >= 1.0
                    ? `${((pos.healthFactor - 1) * 100).toFixed(1)}%`
                    : 'Liquidatable'
                  const distColor = pos.healthFactor >= 1.5 ? GREEN : pos.healthFactor >= 1.0 ? AMBER : RED

                  return (
                    <motion.tr
                      key={pos.user}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.04 * PHI }}
                      className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors cursor-pointer"
                      onClick={() => setSelectedPosition(pos)}
                    >
                      <td className="p-3">
                        <span className="text-gray-300">{pos.user}</span>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold border"
                            style={{ borderColor: `${token?.color || CYAN}40`, color: token?.color || CYAN, backgroundColor: `${token?.color || CYAN}10` }}>
                            {token?.icon || '?'}
                          </span>
                          <div>
                            <span className="text-white font-bold">{fmtNum(pos.collateralAmount)} {pos.collateral}</span>
                            <div className="text-[9px] text-gray-600">{fmt(collateralValue)}</div>
                          </div>
                        </div>
                      </td>
                      <td className="p-3 text-right">
                        <span className="text-gray-300">{fmt(pos.debtAmount)} {pos.debt}</span>
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: getHealthColor(pos.healthFactor) }} />
                          <span className="font-bold" style={{ color: getHealthColor(pos.healthFactor) }}>
                            {pos.healthFactor.toFixed(2)}
                          </span>
                        </div>
                        <div className="text-[9px]" style={{ color: getHealthColor(pos.healthFactor) }}>
                          {getHealthLabel(pos.healthFactor)}
                        </div>
                      </td>
                      <td className="p-3 text-right hidden sm:table-cell">
                        <span style={{ color: pos.collateralRatio < 100 ? RED : pos.collateralRatio < 130 ? AMBER : GREEN }}>
                          {pos.collateralRatio}%
                        </span>
                      </td>
                      <td className="p-3 text-right hidden sm:table-cell">
                        <span style={{ color: distColor }}>{distToLiq}</span>
                      </td>
                    </motion.tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {/* Position count summary */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800/50 text-[10px] font-mono text-gray-500">
            <span>{AT_RISK_POSITIONS.length} positions monitored</span>
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: GREEN }} />{riskDistribution.safe} safe</span>
              <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: AMBER }} />{riskDistribution.caution} caution</span>
              <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: RED }} />{riskDistribution.liquidatable} liquidatable</span>
            </div>
          </div>
        </GlassCard>
      </Section>

      {/* ============ 3. Active Auctions ============ */}
      <Section title="Active Liquidation Auctions">
        <p className="text-gray-500 text-[11px] font-mono mb-4">
          VibeSwap liquidation auctions use <span style={{ color: CYAN }}>commit-reveal</span> to ensure fair price discovery.
          Bidders commit hashed bids during the commit phase, then reveal. Highest valid bid wins the collateral at a discount.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {ACTIVE_AUCTIONS.map((auction, i) => (
            <AuctionCard key={auction.id} auction={auction} index={i} isConnected={isConnected} />
          ))}
        </div>
      </Section>

      {/* ============ 4. Liquidation History ============ */}
      <Section title="Recent Liquidations">
        <GlassCard glowColor="terminal" hover={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="text-gray-500 border-b border-gray-800">
                  <th className="text-left p-3">Time</th>
                  <th className="text-left p-3">User</th>
                  <th className="text-left p-3">Asset</th>
                  <th className="text-right p-3">Amount</th>
                  <th className="text-right p-3 hidden sm:table-cell">Debt Repaid</th>
                  <th className="text-left p-3 hidden sm:table-cell">Liquidator</th>
                  <th className="text-right p-3">Discount</th>
                </tr>
              </thead>
              <tbody>
                {LIQUIDATION_HISTORY.map((ev, i) => {
                  const token = COLLATERAL_TOKENS.find((t) => t.symbol === ev.asset)
                  return (
                    <motion.tr
                      key={i}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 * PHI }}
                      className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors"
                    >
                      <td className="p-3 text-gray-400">{ev.timestamp}</td>
                      <td className="p-3 text-gray-300">{ev.user}</td>
                      <td className="p-3">
                        <div className="flex items-center gap-1.5">
                          <span className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold border"
                            style={{ borderColor: `${token?.color || CYAN}40`, color: token?.color || CYAN, backgroundColor: `${token?.color || CYAN}10` }}>
                            {token?.icon || '?'}
                          </span>
                          <span className="text-white font-bold">{ev.asset}</span>
                        </div>
                      </td>
                      <td className="p-3 text-right text-gray-300">{fmtNum(ev.amount)}</td>
                      <td className="p-3 text-right text-gray-300 hidden sm:table-cell">{fmt(ev.debtRepaid)}</td>
                      <td className="p-3 text-gray-400 hidden sm:table-cell">{ev.liquidator}</td>
                      <td className="p-3 text-right">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold"
                          style={{ color: GREEN, backgroundColor: `${GREEN}10` }}>
                          {ev.discount.toFixed(1)}%
                        </span>
                      </td>
                    </motion.tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </GlassCard>
      </Section>

      {/* ============ 5. Your Liquidator Stats ============ */}
      <Section title="Your Liquidator Stats">
        {!isConnected ? (
          <GlassCard glowColor="terminal" hover={false}>
            <div className="p-8 text-center">
              <div className="text-2xl mb-2" style={{ color: `${CYAN}30` }}>{'{ }'}</div>
              <div className="text-gray-400 text-sm font-mono">Connect wallet to view your liquidator stats</div>
            </div>
          </GlassCard>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Total Liquidations', value: `${liquidatorStats.totalLiquidations}`, color: CYAN },
              { label: 'Profit Earned', value: fmt(liquidatorStats.profitEarned), color: GREEN },
              { label: 'Success Rate', value: `${liquidatorStats.successRate}%`, color: AMBER },
              { label: 'Avg Discount', value: `${liquidatorStats.avgDiscount}%`, color: '#a78bfa' },
            ].map((s, i) => (
              <GlassCard key={s.label} glowColor="terminal" hover>
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.06 * PHI }}
                  className="p-4 text-center"
                >
                  <div className="text-xl font-mono font-bold" style={{ color: s.color }}>{s.value}</div>
                  <div className="text-[10px] text-gray-500 font-mono mt-1">{s.label}</div>
                </motion.div>
              </GlassCard>
            ))}
          </div>
        )}
      </Section>

      {/* ============ 6. Risk Heatmap ============ */}
      <Section title="Protocol Risk Heatmap">
        <GlassCard glowColor="terminal" hover={false} spotlight>
          <div className="p-5">
            <p className="text-gray-500 text-[11px] font-mono mb-4">
              Risk distribution across lending pairs. Higher scores indicate greater concentration of at-risk positions.
              Scores factor in collateral ratio, price volatility, and position density.
            </p>
            {/* Heatmap grid */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              {HEATMAP_DATA.map((cell, i) => (
                <motion.div
                  key={cell.pair}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.04 * PHI }}
                >
                  <div className="bg-gray-900/40 rounded-lg p-3">
                    <div className="text-[10px] font-mono text-gray-400 mb-1.5">{cell.pair}</div>
                    <HeatCell score={cell.riskScore} />
                    <div className="flex items-center justify-between mt-2 text-[9px] font-mono text-gray-500">
                      <span>{cell.positionsAtRisk} pos.</span>
                      <span>{fmt(cell.totalExposure)}</span>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
            {/* Legend */}
            <div className="flex items-center justify-center gap-6 text-[10px] font-mono">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded" style={{ backgroundColor: `${GREEN}30` }} />
                <span className="text-gray-400">Low Risk (0-40)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded" style={{ backgroundColor: `${AMBER}30` }} />
                <span className="text-gray-400">Medium Risk (40-70)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded" style={{ backgroundColor: `${RED}30` }} />
                <span className="text-gray-400">High Risk (70+)</span>
              </div>
            </div>
          </div>
        </GlassCard>
      </Section>

      {/* ============ Position Detail Modal ============ */}
      <AnimatePresence>
        {selectedPosition && (() => {
          const pos = selectedPosition
          const token = COLLATERAL_TOKENS.find((t) => t.symbol === pos.collateral)
          const collateralValue = token ? pos.collateralAmount * token.price : 0
          const distToLiq = pos.healthFactor >= 1.0 ? ((pos.healthFactor - 1) * 100).toFixed(1) : 0
          return (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
              onClick={() => setSelectedPosition(null)}>
              <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-md w-full">
                <div className="flex items-center justify-between mb-5">
                  <h3 className="text-white font-bold font-mono text-sm">Position Details</h3>
                  <button onClick={() => setSelectedPosition(null)} className="text-gray-500 hover:text-white text-lg">&times;</button>
                </div>
                <div className="space-y-3">
                  <div className="bg-gray-800/50 rounded-xl p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <span className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border"
                        style={{ borderColor: `${token?.color || CYAN}40`, color: token?.color || CYAN, backgroundColor: `${token?.color || CYAN}10` }}>
                        {token?.icon || '?'}
                      </span>
                      <div>
                        <div className="text-white font-bold text-sm">{pos.user}</div>
                        <div className="text-[10px] text-gray-500 font-mono">{pos.collateral}/{pos.debt} position</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-gray-900/60 rounded-lg p-2.5">
                        <div className="text-[9px] text-gray-500 font-mono">Collateral</div>
                        <div className="text-xs font-mono font-bold text-white">{fmtNum(pos.collateralAmount)} {pos.collateral}</div>
                        <div className="text-[9px] text-gray-500 font-mono">{fmt(collateralValue)}</div>
                      </div>
                      <div className="bg-gray-900/60 rounded-lg p-2.5">
                        <div className="text-[9px] text-gray-500 font-mono">Debt</div>
                        <div className="text-xs font-mono font-bold text-white">{fmt(pos.debtAmount)}</div>
                        <div className="text-[9px] text-gray-500 font-mono">{pos.debt}</div>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { val: pos.healthFactor.toFixed(2), label: 'Health Factor', color: getHealthColor(pos.healthFactor) },
                      { val: `${pos.collateralRatio}%`, label: 'Collateral Ratio', color: pos.collateralRatio < 100 ? RED : pos.collateralRatio < 130 ? AMBER : GREEN },
                      { val: pos.healthFactor >= 1.0 ? `${distToLiq}%` : 'NOW', label: 'Dist. to Liq.', color: pos.healthFactor >= 1.0 ? AMBER : RED },
                    ].map((s) => (
                      <div key={s.label} className="bg-gray-800/50 rounded-lg p-3 text-center">
                        <div className="text-sm font-mono font-bold" style={{ color: s.color }}>{s.val}</div>
                        <div className="text-[9px] text-gray-500 font-mono">{s.label}</div>
                      </div>
                    ))}
                  </div>
                  {pos.healthFactor < 1.0 && (
                    isConnected ? (
                      <button className="w-full py-3 rounded-xl font-bold font-mono text-sm transition-all hover:brightness-110"
                        style={{ backgroundColor: RED, color: '#fff' }}>
                        Initiate Liquidation Auction
                      </button>
                    ) : (
                      <div className="text-center text-[10px] text-gray-500 font-mono py-2">Connect wallet to initiate liquidation</div>
                    )
                  )}
                </div>
              </motion.div>
            </motion.div>
          )
        })()}
      </AnimatePresence>

      {/* ============ Footer ============ */}
      <div className="text-center pb-4">
        <div className="mx-auto mb-3 h-px w-32" style={{ background: `linear-gradient(to right, transparent, ${RED}60, transparent)` }} />
        <div className="text-gray-600 text-[10px] font-mono leading-relaxed">
          Liquidation auctions use commit-reveal batch mechanics. All positions are monitored on-chain with circuit breaker protection.
        </div>
        <div className="flex items-center justify-center gap-4 mt-3">
          <Link to="/lending" className="text-[10px] font-mono transition-colors hover:brightness-125" style={{ color: CYAN }}>
            Lending Markets
          </Link>
          <Link to="/commit-reveal" className="text-[10px] font-mono transition-colors hover:brightness-125" style={{ color: CYAN }}>
            Commit-Reveal Mechanism
          </Link>
          <Link to="/circuit-breaker" className="text-[10px] font-mono transition-colors hover:brightness-125" style={{ color: CYAN }}>
            Circuit Breakers
          </Link>
        </div>
      </div>
    </div>
  )
}
