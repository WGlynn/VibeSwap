import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

// ============ Constants ============

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const MIN_TRADE = 10_000

// ============ Seeded PRNG ============

function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

// ============ Token Pairs ============

const TOKEN_PAIRS = [
  { id: 'eth-usdc', base: 'ETH', quote: 'USDC', ammPrice: 3847.21 },
  { id: 'btc-usdc', base: 'BTC', quote: 'USDC', ammPrice: 104_312.50 },
  { id: 'eth-btc', base: 'ETH', quote: 'BTC', ammPrice: 0.03689 },
  { id: 'arb-usdc', base: 'ARB', quote: 'USDC', ammPrice: 1.247 },
  { id: 'op-usdc', base: 'OP', quote: 'USDC', ammPrice: 2.183 },
  { id: 'link-usdc', base: 'LINK', quote: 'USDC', ammPrice: 18.92 },
  { id: 'wsteth-eth', base: 'wstETH', quote: 'ETH', ammPrice: 1.172 },
  { id: 'jul-usdc', base: 'JUL', quote: 'USDC', ammPrice: 0.847 },
]

// ============ Settlement Types ============

const SETTLEMENT_TYPES = [
  { id: 'atomic', label: 'Atomic Swap', desc: 'Instant on-chain settlement via smart contract', icon: '\u26A1', risk: 'None' },
  { id: 'escrow', label: 'Escrow', desc: 'Funds held in escrow until both parties confirm', icon: '\uD83D\uDD12', risk: 'Low' },
  { id: 'time-locked', label: 'Time-Locked', desc: 'HTLC with configurable expiry window', icon: '\u23F3', risk: 'Low' },
]

// ============ Generate Mock Data ============

function generateRFQs(rng) {
  const pairs = TOKEN_PAIRS
  const directions = ['buy', 'sell']
  const statuses = ['open', 'open', 'open', 'quoted', 'quoted', 'filled']
  const names = ['CypherFund', 'NovaCap', 'Meridian Trading', 'Arcus Ventures', 'DeepBlue Capital',
    'Polaris Fund', 'Zenith Group', 'Axiom Partners', 'ThetaVault', 'PrismDesk']

  return Array.from({ length: 8 }, (_, i) => {
    const pair = pairs[Math.floor(rng() * pairs.length)]
    const dir = directions[Math.floor(rng() * 2)]
    const status = statuses[Math.floor(rng() * statuses.length)]
    const amount = Math.floor(rng() * 900 + 100) * 100
    const basisPoints = Math.floor(rng() * 25) + 2
    const improvement = (dir === 'buy' ? -1 : 1) * basisPoints / 10000
    const otcPrice = pair.ammPrice * (1 + improvement)
    const hoursAgo = Math.floor(rng() * 48)
    return {
      id: i + 1,
      pair,
      direction: dir,
      amount,
      notional: amount * (pair.quote === 'USDC' ? 1 : pair.ammPrice * 3847),
      otcPrice: +otcPrice.toFixed(pair.ammPrice < 1 ? 5 : pair.ammPrice < 100 ? 3 : 2),
      ammPrice: pair.ammPrice,
      improvement: +(basisPoints / 100).toFixed(2),
      status,
      requester: names[Math.floor(rng() * names.length)],
      settlement: SETTLEMENT_TYPES[Math.floor(rng() * 3)].id,
      createdAt: Date.now() - hoursAgo * 3600000,
    }
  })
}

function generateOrderBook(rng, pair) {
  const bids = Array.from({ length: 6 }, (_, i) => {
    const depth = (i + 1) * (Math.floor(rng() * 40) + 10)
    const offset = (i + 1) * pair.ammPrice * (0.0005 + rng() * 0.001)
    return {
      price: +(pair.ammPrice - offset).toFixed(pair.ammPrice < 1 ? 5 : pair.ammPrice < 100 ? 3 : 2),
      size: Math.floor(rng() * 500 + 50) * 10,
      total: Math.floor(depth * pair.ammPrice),
      maker: `0x${Math.floor(rng() * 0xffffff).toString(16).padStart(6, '0')}...${Math.floor(rng() * 0xffff).toString(16).padStart(4, '0')}`,
    }
  }).sort((a, b) => b.price - a.price)

  const asks = Array.from({ length: 6 }, (_, i) => {
    const depth = (i + 1) * (Math.floor(rng() * 40) + 10)
    const offset = (i + 1) * pair.ammPrice * (0.0005 + rng() * 0.001)
    return {
      price: +(pair.ammPrice + offset).toFixed(pair.ammPrice < 1 ? 5 : pair.ammPrice < 100 ? 3 : 2),
      size: Math.floor(rng() * 500 + 50) * 10,
      total: Math.floor(depth * pair.ammPrice),
      maker: `0x${Math.floor(rng() * 0xffffff).toString(16).padStart(6, '0')}...${Math.floor(rng() * 0xffff).toString(16).padStart(4, '0')}`,
    }
  }).sort((a, b) => a.price - b.price)

  return { bids, asks }
}

function generateCounterparties(rng) {
  const names = ['CypherFund', 'NovaCap', 'Meridian Trading', 'Arcus Ventures', 'DeepBlue Capital',
    'Polaris Fund', 'Zenith Group', 'Axiom Partners', 'ThetaVault', 'PrismDesk']
  return names.map((name, i) => ({
    name,
    address: `0x${Math.floor(rng() * 0xffffffffffff).toString(16).padStart(12, '0').slice(0, 6)}...${Math.floor(rng() * 0xffff).toString(16).padStart(4, '0')}`,
    reputation: +(70 + rng() * 30).toFixed(1),
    trades: Math.floor(rng() * 800 + 20),
    volume: Math.floor(rng() * 50_000_000 + 500_000),
    avgSize: Math.floor(rng() * 400_000 + 25_000),
    disputes: Math.floor(rng() * 3),
    joinedMonths: Math.floor(rng() * 36 + 1),
    multiSig: rng() > 0.5,
  }))
}

function generateTradeHistory(rng) {
  const pairs = TOKEN_PAIRS
  const settlements = ['atomic', 'escrow', 'time-locked']
  return Array.from({ length: 12 }, (_, i) => {
    const pair = pairs[Math.floor(rng() * pairs.length)]
    const dir = rng() > 0.5 ? 'buy' : 'sell'
    const amount = Math.floor(rng() * 2000 + 50) * 100
    const bps = Math.floor(rng() * 30) + 1
    const hoursAgo = Math.floor(rng() * 720) + 1
    return {
      id: i + 1,
      pair,
      direction: dir,
      amount,
      price: +(pair.ammPrice * (1 + (rng() - 0.5) * 0.005)).toFixed(pair.ammPrice < 1 ? 5 : pair.ammPrice < 100 ? 3 : 2),
      improvement: +(bps / 100).toFixed(2),
      notional: Math.floor(amount * pair.ammPrice),
      settlement: settlements[Math.floor(rng() * 3)],
      timestamp: Date.now() - hoursAgo * 3600000,
      counterparty: `0x${Math.floor(rng() * 0xffffff).toString(16).padStart(6, '0')}...${Math.floor(rng() * 0xffff).toString(16).padStart(4, '0')}`,
      status: 'completed',
    }
  }).sort((a, b) => b.timestamp - a.timestamp)
}

// ============ Utility Functions ============

function fmt(n) {
  if (n >= 1_000_000_000) return '$' + (n / 1_000_000_000).toFixed(1) + 'B'
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return '$' + (n / 1_000).toFixed(1) + 'K'
  return '$' + n.toFixed(0)
}

function fmtPrice(p, ammPrice) {
  if (ammPrice < 1) return p.toFixed(5)
  if (ammPrice < 100) return p.toFixed(3)
  return p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function timeAgo(ts) {
  const mins = Math.floor((Date.now() - ts) / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function reputationColor(score) {
  if (score >= 90) return '#22c55e'
  if (score >= 80) return '#06b6d4'
  if (score >= 70) return '#eab308'
  return '#f97316'
}

// ============ Section Wrapper ============

function Section({ num, title, delay = 0, children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 1 / (PHI * PHI) }}
    >
      <h2 className="text-lg font-bold font-mono text-white mb-3 flex items-center gap-2">
        <span style={{ color: CYAN }}>{num}</span>
        <span>{title}</span>
      </h2>
      {children}
    </motion.div>
  )
}

// ============ Reputation Bar ============

function ReputationBar({ score }) {
  const color = reputationColor(score)
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          transition={{ duration: PHI * 0.5, ease: 'easeOut' }}
        />
      </div>
      <span className="text-xs font-mono" style={{ color }}>{score}</span>
    </div>
  )
}

// ============ Direction Badge ============

function DirectionBadge({ direction }) {
  const isBuy = direction === 'buy'
  return (
    <span
      className="px-2 py-0.5 rounded text-[10px] font-mono uppercase font-bold"
      style={{
        backgroundColor: isBuy ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
        color: isBuy ? '#22c55e' : '#ef4444',
      }}
    >
      {direction}
    </span>
  )
}

// ============ Status Badge ============

function StatusBadge({ status }) {
  const colors = {
    open: { bg: 'rgba(6,182,212,0.12)', text: CYAN },
    quoted: { bg: 'rgba(234,179,8,0.12)', text: '#eab308' },
    filled: { bg: 'rgba(34,197,94,0.12)', text: '#22c55e' },
    completed: { bg: 'rgba(34,197,94,0.12)', text: '#22c55e' },
    expired: { bg: 'rgba(107,114,128,0.12)', text: '#6b7280' },
  }
  const c = colors[status] || colors.open
  return (
    <span
      className="px-2 py-0.5 rounded text-[10px] font-mono uppercase"
      style={{ backgroundColor: c.bg, color: c.text }}
    >
      {status}
    </span>
  )
}

// ============ Main Component ============

export default function OTCPage() {
  const { isConnected: isExternalConnected, connect } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  // ============ Seeded Data ============
  const { rfqs, orderBook, counterparties, tradeHistory } = useMemo(() => {
    const rng = seededRandom(1717)
    const rfqs = generateRFQs(rng)
    const defaultPair = TOKEN_PAIRS[0]
    const orderBook = generateOrderBook(rng, defaultPair)
    const counterparties = generateCounterparties(rng)
    const tradeHistory = generateTradeHistory(rng)
    return { rfqs, orderBook, counterparties, tradeHistory }
  }, [])

  // ============ State ============
  const [selectedPair, setSelectedPair] = useState(0)
  const [rfqDirection, setRfqDirection] = useState('buy')
  const [rfqAmount, setRfqAmount] = useState('')
  const [settlementType, setSettlementType] = useState('atomic')
  const [activeTab, setActiveTab] = useState('rfq')
  const [multiSigEnabled, setMultiSigEnabled] = useState(false)
  const [scheduledExec, setScheduledExec] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const pair = TOKEN_PAIRS[selectedPair]
  const notional = rfqAmount ? parseFloat(rfqAmount) * (pair.quote === 'USDC' ? 1 : pair.ammPrice) : 0
  const meetsMinimum = notional >= MIN_TRADE

  // Compute spread from order book
  const spread = orderBook.asks[0] && orderBook.bids[0]
    ? +((orderBook.asks[0].price - orderBook.bids[0].price) / pair.ammPrice * 10000).toFixed(1)
    : 0

  // ============ Tab Config ============
  const tabs = [
    { id: 'rfq', label: 'Request for Quote' },
    { id: 'book', label: 'Order Book' },
    { id: 'counterparties', label: 'Counterparties' },
  ]

  return (
    <div className="min-h-screen pb-24">
      <PageHero
        title="OTC Desk"
        subtitle="Institutional-grade block trading with price improvement over AMM"
        category="defi"
        badge="Pro"
        badgeColor={CYAN}
      />

      <div className="max-w-7xl mx-auto px-4 space-y-6">

        {/* ============ Minimum Trade Notice ============ */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1 / (PHI * PHI), delay: 0.1 }}
          className="flex items-center gap-3 px-4 py-3 rounded-xl border"
          style={{
            backgroundColor: 'rgba(6,182,212,0.04)',
            borderColor: 'rgba(6,182,212,0.15)',
          }}
        >
          <span className="text-lg">{'\uD83C\uDFE6'}</span>
          <div className="flex-1">
            <span className="text-sm text-white/80">
              Minimum trade size: <span className="font-mono font-bold" style={{ color: CYAN }}>{fmt(MIN_TRADE)}+</span>
            </span>
            <span className="text-xs text-white/40 ml-2">
              Large block trades receive better pricing than AMM
            </span>
          </div>
          <div className="text-xs font-mono text-white/30">
            Avg improvement: <span style={{ color: '#22c55e' }}>0.12%</span>
          </div>
        </motion.div>

        {/* ============ Tab Navigation ============ */}
        <div className="flex gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/[0.06]">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex-1 px-4 py-2 rounded-lg text-sm font-mono transition-all duration-200"
              style={{
                backgroundColor: activeTab === tab.id ? 'rgba(6,182,212,0.12)' : 'transparent',
                color: activeTab === tab.id ? CYAN : 'rgba(255,255,255,0.5)',
                borderBottom: activeTab === tab.id ? `2px solid ${CYAN}` : '2px solid transparent',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {/* ============ RFQ Tab ============ */}
          {activeTab === 'rfq' && (
            <motion.div
              key="rfq"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 1 / (PHI * PHI * PHI) }}
              className="space-y-6"
            >
              {/* RFQ Form */}
              <Section num="01" title="Create RFQ" delay={0.1 / PHI}>
                <GlassCard glowColor="terminal" spotlight className="p-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {/* Token Pair */}
                    <div>
                      <label className="text-xs font-mono text-white/40 mb-1.5 block">Token Pair</label>
                      <select
                        value={selectedPair}
                        onChange={(e) => setSelectedPair(Number(e.target.value))}
                        className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2.5 text-sm font-mono text-white focus:outline-none focus:border-cyan-500/40"
                      >
                        {TOKEN_PAIRS.map((p, i) => (
                          <option key={p.id} value={i} className="bg-gray-900">
                            {p.base}/{p.quote}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Direction */}
                    <div>
                      <label className="text-xs font-mono text-white/40 mb-1.5 block">Direction</label>
                      <div className="flex gap-1">
                        {['buy', 'sell'].map((dir) => (
                          <button
                            key={dir}
                            onClick={() => setRfqDirection(dir)}
                            className="flex-1 py-2.5 rounded-lg text-sm font-mono uppercase font-bold transition-all"
                            style={{
                              backgroundColor: rfqDirection === dir
                                ? (dir === 'buy' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)')
                                : 'rgba(255,255,255,0.03)',
                              color: rfqDirection === dir
                                ? (dir === 'buy' ? '#22c55e' : '#ef4444')
                                : 'rgba(255,255,255,0.35)',
                              border: rfqDirection === dir
                                ? `1px solid ${dir === 'buy' ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`
                                : '1px solid rgba(255,255,255,0.06)',
                            }}
                          >
                            {dir}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Amount */}
                    <div>
                      <label className="text-xs font-mono text-white/40 mb-1.5 block">
                        Amount ({pair.base})
                      </label>
                      <input
                        type="number"
                        placeholder="0.00"
                        value={rfqAmount}
                        onChange={(e) => setRfqAmount(e.target.value)}
                        className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2.5 text-sm font-mono text-white placeholder-white/20 focus:outline-none focus:border-cyan-500/40"
                      />
                      {rfqAmount && (
                        <div className="text-[10px] font-mono mt-1" style={{ color: meetsMinimum ? '#22c55e' : '#ef4444' }}>
                          {meetsMinimum ? '\u2713' : '\u2717'} Notional: {fmt(notional)}
                          {!meetsMinimum && ` (min ${fmt(MIN_TRADE)})`}
                        </div>
                      )}
                    </div>

                    {/* Settlement */}
                    <div>
                      <label className="text-xs font-mono text-white/40 mb-1.5 block">Settlement</label>
                      <select
                        value={settlementType}
                        onChange={(e) => setSettlementType(e.target.value)}
                        className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2.5 text-sm font-mono text-white focus:outline-none focus:border-cyan-500/40"
                      >
                        {SETTLEMENT_TYPES.map((s) => (
                          <option key={s.id} value={s.id} className="bg-gray-900">
                            {s.icon} {s.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* AMM Price Reference */}
                  <div className="mt-4 flex items-center justify-between p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                    <div className="text-xs text-white/40 font-mono">
                      AMM Reference: <span className="text-white/70">{fmtPrice(pair.ammPrice, pair.ammPrice)} {pair.quote}</span>
                    </div>
                    <div className="text-xs text-white/40 font-mono">
                      Spread: <span style={{ color: CYAN }}>{spread} bps</span>
                    </div>
                  </div>

                  {/* Institutional Features */}
                  <div className="mt-4 flex flex-wrap gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={multiSigEnabled}
                        onChange={(e) => setMultiSigEnabled(e.target.checked)}
                        className="w-3.5 h-3.5 rounded accent-cyan-500"
                      />
                      <span className="text-xs font-mono text-white/50">Multi-sig approval</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={scheduledExec}
                        onChange={(e) => setScheduledExec(e.target.checked)}
                        className="w-3.5 h-3.5 rounded accent-cyan-500"
                      />
                      <span className="text-xs font-mono text-white/50">Scheduled execution</span>
                    </label>
                  </div>

                  {/* Submit Button */}
                  <motion.button
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.98 }}
                    disabled={!isConnected || !meetsMinimum}
                    className="mt-4 w-full py-3 rounded-xl font-mono font-bold text-sm transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                    style={{
                      backgroundColor: isConnected && meetsMinimum ? 'rgba(6,182,212,0.15)' : 'rgba(255,255,255,0.04)',
                      color: isConnected && meetsMinimum ? CYAN : 'rgba(255,255,255,0.3)',
                      border: `1px solid ${isConnected && meetsMinimum ? 'rgba(6,182,212,0.3)' : 'rgba(255,255,255,0.06)'}`,
                    }}
                    onClick={isConnected ? undefined : connect}
                  >
                    {!isConnected ? 'Connect Wallet to Submit RFQ' : !meetsMinimum ? `Minimum ${fmt(MIN_TRADE)}` : 'Submit RFQ'}
                  </motion.button>
                </GlassCard>
              </Section>

              {/* Active RFQs */}
              <Section num="02" title="Active RFQs" delay={0.2 / PHI}>
                <GlassCard className="overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-white/[0.06]">
                          {['Pair', 'Side', 'Size', 'OTC Price', 'AMM Price', 'Improvement', 'Requester', 'Status', 'Time'].map((h) => (
                            <th key={h} className="px-4 py-3 text-left text-[10px] font-mono uppercase text-white/30 tracking-wider">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rfqs.map((rfq, i) => (
                          <motion.tr
                            key={rfq.id}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: i * 0.04, duration: 1 / (PHI * PHI * PHI) }}
                            className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors"
                          >
                            <td className="px-4 py-3 font-mono text-white/80">
                              {rfq.pair.base}/{rfq.pair.quote}
                            </td>
                            <td className="px-4 py-3">
                              <DirectionBadge direction={rfq.direction} />
                            </td>
                            <td className="px-4 py-3 font-mono text-white/70">
                              {rfq.amount.toLocaleString()} {rfq.pair.base}
                            </td>
                            <td className="px-4 py-3 font-mono text-white/80">
                              {fmtPrice(rfq.otcPrice, rfq.ammPrice)}
                            </td>
                            <td className="px-4 py-3 font-mono text-white/40">
                              {fmtPrice(rfq.ammPrice, rfq.ammPrice)}
                            </td>
                            <td className="px-4 py-3">
                              <span className="text-xs font-mono" style={{ color: '#22c55e' }}>
                                +{rfq.improvement}%
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs text-white/50">{rfq.requester}</td>
                            <td className="px-4 py-3"><StatusBadge status={rfq.status} /></td>
                            <td className="px-4 py-3 text-xs text-white/30 font-mono">{timeAgo(rfq.createdAt)}</td>
                          </motion.tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </GlassCard>
              </Section>

              {/* Settlement Options */}
              <Section num="03" title="Settlement Options" delay={0.3 / PHI}>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {SETTLEMENT_TYPES.map((s, i) => (
                    <motion.div
                      key={s.id}
                      initial={{ opacity: 0, y: 15 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.3 / PHI + i * 0.08, duration: 1 / (PHI * PHI) }}
                    >
                      <GlassCard
                        hover
                        glowColor={settlementType === s.id ? 'terminal' : 'none'}
                        className="p-4 cursor-pointer"
                        onClick={() => setSettlementType(s.id)}
                      >
                        <div className="flex items-start gap-3">
                          <span className="text-2xl">{s.icon}</span>
                          <div className="flex-1">
                            <div className="text-sm font-mono font-bold text-white/90">{s.label}</div>
                            <div className="text-xs text-white/40 mt-1">{s.desc}</div>
                            <div className="text-[10px] font-mono mt-2" style={{ color: CYAN }}>
                              Counterparty risk: {s.risk}
                            </div>
                          </div>
                          {settlementType === s.id && (
                            <motion.div
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              className="w-5 h-5 rounded-full flex items-center justify-center"
                              style={{ backgroundColor: 'rgba(6,182,212,0.2)', color: CYAN }}
                            >
                              {'\u2713'}
                            </motion.div>
                          )}
                        </div>
                      </GlassCard>
                    </motion.div>
                  ))}
                </div>
              </Section>

              {/* Price Comparison vs AMM */}
              <Section num="04" title="Price Improvement vs AMM" delay={0.4 / PHI}>
                <GlassCard className="p-5">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[
                      { label: 'Avg Improvement', value: '0.12%', sub: 'vs AMM spot price' },
                      { label: 'Total Volume (24h)', value: fmt(28_400_000), sub: '142 trades' },
                      { label: 'Best Fill', value: '0.34%', sub: 'ETH/USDC 500 ETH' },
                      { label: 'Slippage Saved', value: fmt(187_000), sub: 'This month' },
                    ].map((stat, i) => (
                      <motion.div
                        key={stat.label}
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.4 / PHI + i * 0.06, duration: 1 / (PHI * PHI) }}
                        className="text-center"
                      >
                        <div className="text-[10px] font-mono text-white/30 uppercase tracking-wider">{stat.label}</div>
                        <div className="text-xl font-mono font-bold mt-1" style={{ color: CYAN }}>{stat.value}</div>
                        <div className="text-[10px] text-white/25 mt-0.5">{stat.sub}</div>
                      </motion.div>
                    ))}
                  </div>
                </GlassCard>
              </Section>
            </motion.div>
          )}

          {/* ============ Order Book Tab ============ */}
          {activeTab === 'book' && (
            <motion.div
              key="book"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 1 / (PHI * PHI * PHI) }}
              className="space-y-6"
            >
              <Section num="01" title={`Large Block Order Book \u2014 ${pair.base}/${pair.quote}`} delay={0.05}>
                <GlassCard className="p-4">
                  {/* Pair selector */}
                  <div className="flex items-center gap-3 mb-4">
                    <label className="text-xs font-mono text-white/40">Pair:</label>
                    <div className="flex gap-1 flex-wrap">
                      {TOKEN_PAIRS.slice(0, 6).map((p, i) => (
                        <button
                          key={p.id}
                          onClick={() => setSelectedPair(i)}
                          className="px-2.5 py-1 rounded text-xs font-mono transition-all"
                          style={{
                            backgroundColor: selectedPair === i ? 'rgba(6,182,212,0.12)' : 'rgba(255,255,255,0.03)',
                            color: selectedPair === i ? CYAN : 'rgba(255,255,255,0.4)',
                            border: `1px solid ${selectedPair === i ? 'rgba(6,182,212,0.2)' : 'rgba(255,255,255,0.06)'}`,
                          }}
                        >
                          {p.base}/{p.quote}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Bids */}
                    <div>
                      <div className="text-xs font-mono text-white/30 uppercase mb-2 tracking-wider">Bids</div>
                      <div className="space-y-1">
                        {orderBook.bids.map((bid, i) => {
                          const maxSize = Math.max(...orderBook.bids.map(b => b.size))
                          const fillWidth = (bid.size / maxSize) * 100
                          return (
                            <motion.div
                              key={i}
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: i * 0.04 }}
                              className="relative flex items-center justify-between px-3 py-1.5 rounded text-xs font-mono"
                            >
                              <div
                                className="absolute inset-0 rounded"
                                style={{
                                  background: `linear-gradient(90deg, rgba(34,197,94,0.08) 0%, transparent ${fillWidth}%)`,
                                }}
                              />
                              <span className="relative z-10" style={{ color: '#22c55e' }}>
                                {fmtPrice(bid.price, pair.ammPrice)}
                              </span>
                              <span className="relative z-10 text-white/50">{bid.size.toLocaleString()}</span>
                              <span className="relative z-10 text-white/30">{bid.maker}</span>
                            </motion.div>
                          )
                        })}
                      </div>
                    </div>

                    {/* Asks */}
                    <div>
                      <div className="text-xs font-mono text-white/30 uppercase mb-2 tracking-wider">Asks</div>
                      <div className="space-y-1">
                        {orderBook.asks.map((ask, i) => {
                          const maxSize = Math.max(...orderBook.asks.map(a => a.size))
                          const fillWidth = (ask.size / maxSize) * 100
                          return (
                            <motion.div
                              key={i}
                              initial={{ opacity: 0, x: 10 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: i * 0.04 }}
                              className="relative flex items-center justify-between px-3 py-1.5 rounded text-xs font-mono"
                            >
                              <div
                                className="absolute inset-0 rounded"
                                style={{
                                  background: `linear-gradient(270deg, rgba(239,68,68,0.08) 0%, transparent ${fillWidth}%)`,
                                }}
                              />
                              <span className="relative z-10" style={{ color: '#ef4444' }}>
                                {fmtPrice(ask.price, pair.ammPrice)}
                              </span>
                              <span className="relative z-10 text-white/50">{ask.size.toLocaleString()}</span>
                              <span className="relative z-10 text-white/30">{ask.maker}</span>
                            </motion.div>
                          )
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Mid-market reference */}
                  <div className="mt-4 pt-3 border-t border-white/[0.04] flex items-center justify-between text-xs font-mono">
                    <span className="text-white/30">Mid-market: <span className="text-white/70">{fmtPrice(pair.ammPrice, pair.ammPrice)} {pair.quote}</span></span>
                    <span className="text-white/30">Spread: <span style={{ color: CYAN }}>{spread} bps</span></span>
                    <span className="text-white/30">Min block: <span className="text-white/50">{fmt(MIN_TRADE)}</span></span>
                  </div>
                </GlassCard>
              </Section>
            </motion.div>
          )}

          {/* ============ Counterparties Tab ============ */}
          {activeTab === 'counterparties' && (
            <motion.div
              key="counterparties"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 1 / (PHI * PHI * PHI) }}
              className="space-y-6"
            >
              <Section num="01" title="Counterparty Reputation" delay={0.05}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {counterparties.map((cp, i) => (
                    <motion.div
                      key={cp.name}
                      initial={{ opacity: 0, y: 15 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05, duration: 1 / (PHI * PHI) }}
                    >
                      <GlassCard hover className="p-4">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <div className="text-sm font-mono font-bold text-white/90 flex items-center gap-2">
                              {cp.name}
                              {cp.multiSig && (
                                <span
                                  className="px-1.5 py-0.5 rounded text-[9px] font-mono uppercase"
                                  style={{ backgroundColor: 'rgba(6,182,212,0.1)', color: CYAN }}
                                >
                                  Multi-sig
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] font-mono text-white/30 mt-0.5">{cp.address}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-xs text-white/30 font-mono">{cp.joinedMonths}mo</div>
                          </div>
                        </div>

                        <ReputationBar score={cp.reputation} />

                        <div className="grid grid-cols-4 gap-2 mt-3 pt-3 border-t border-white/[0.04]">
                          <div className="text-center">
                            <div className="text-[10px] text-white/25 font-mono">Trades</div>
                            <div className="text-xs font-mono text-white/70">{cp.trades}</div>
                          </div>
                          <div className="text-center">
                            <div className="text-[10px] text-white/25 font-mono">Volume</div>
                            <div className="text-xs font-mono text-white/70">{fmt(cp.volume)}</div>
                          </div>
                          <div className="text-center">
                            <div className="text-[10px] text-white/25 font-mono">Avg Size</div>
                            <div className="text-xs font-mono text-white/70">{fmt(cp.avgSize)}</div>
                          </div>
                          <div className="text-center">
                            <div className="text-[10px] text-white/25 font-mono">Disputes</div>
                            <div className="text-xs font-mono" style={{ color: cp.disputes === 0 ? '#22c55e' : '#f97316' }}>
                              {cp.disputes}
                            </div>
                          </div>
                        </div>
                      </GlassCard>
                    </motion.div>
                  ))}
                </div>
              </Section>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ============ Trade History (always visible) ============ */}
        <Section num="05" title="Trade History" delay={0.5 / PHI}>
          <GlassCard className="overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.04]">
              <div className="text-xs font-mono text-white/40">
                Recent OTC settlements
              </div>
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="text-xs font-mono transition-colors"
                style={{ color: CYAN }}
              >
                {showHistory ? 'Collapse' : 'Show all'}
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.04]">
                    {['Pair', 'Side', 'Size', 'Price', 'vs AMM', 'Settlement', 'Counterparty', 'Time'].map((h) => (
                      <th key={h} className="px-4 py-2.5 text-left text-[10px] font-mono uppercase text-white/25 tracking-wider">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence>
                    {(showHistory ? tradeHistory : tradeHistory.slice(0, 5)).map((trade, i) => (
                      <motion.tr
                        key={trade.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ delay: i * 0.03, duration: 1 / (PHI * PHI * PHI) }}
                        className="border-b border-white/[0.02] hover:bg-white/[0.015] transition-colors"
                      >
                        <td className="px-4 py-2.5 font-mono text-white/70">
                          {trade.pair.base}/{trade.pair.quote}
                        </td>
                        <td className="px-4 py-2.5">
                          <DirectionBadge direction={trade.direction} />
                        </td>
                        <td className="px-4 py-2.5 font-mono text-white/60">
                          {trade.amount.toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-white/70">
                          {fmtPrice(trade.price, trade.pair.ammPrice)}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="text-xs font-mono" style={{ color: '#22c55e' }}>
                            +{trade.improvement}%
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-white/40 capitalize">{trade.settlement}</td>
                        <td className="px-4 py-2.5 text-xs font-mono text-white/30">{trade.counterparty}</td>
                        <td className="px-4 py-2.5 text-xs text-white/25 font-mono">{timeAgo(trade.timestamp)}</td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          </GlassCard>
        </Section>

        {/* ============ Institutional Features ============ */}
        <Section num="06" title="Institutional Features" delay={0.6 / PHI}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              {
                title: 'Multi-Sig Approval',
                desc: 'Require M-of-N signatures before executing large OTC trades. Compatible with Safe, Fireblocks, and custom multi-sig contracts.',
                icon: '\uD83D\uDD10',
                tag: 'Gnosis Safe',
              },
              {
                title: 'Scheduled Execution',
                desc: 'Set trades to execute at specific times or when price conditions are met. TWAP and VWAP strategies for large orders.',
                icon: '\uD83D\uDCC5',
                tag: 'Keeper Network',
              },
              {
                title: 'Compliance Reports',
                desc: 'Downloadable trade reports with counterparty details, settlement proofs, and tax-ready CSV exports.',
                icon: '\uD83D\uDCCA',
                tag: 'Coming Soon',
              },
              {
                title: 'Dark Pool Mode',
                desc: 'Hide order intent until matched. Prevents front-running and information leakage for large block trades.',
                icon: '\uD83C\uDF11',
                tag: 'MEV-Protected',
              },
              {
                title: 'API Access',
                desc: 'Programmatic RFQ submission and quote streaming via WebSocket. FIX protocol bridge for traditional desks.',
                icon: '\uD83D\uDD17',
                tag: 'REST + WS',
              },
              {
                title: 'Cross-Chain Settlement',
                desc: 'Execute OTC trades across chains via LayerZero V2. Source and destination chain assets settled atomically.',
                icon: '\uD83C\uDF10',
                tag: 'LayerZero V2',
              },
            ].map((feat, i) => (
              <motion.div
                key={feat.title}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6 / PHI + i * 0.06, duration: 1 / (PHI * PHI) }}
              >
                <GlassCard hover className="p-4 h-full">
                  <div className="flex items-start gap-3">
                    <span className="text-xl">{feat.icon}</span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono font-bold text-white/90">{feat.title}</span>
                        <span
                          className="px-1.5 py-0.5 rounded text-[9px] font-mono"
                          style={{ backgroundColor: 'rgba(6,182,212,0.08)', color: 'rgba(6,182,212,0.7)' }}
                        >
                          {feat.tag}
                        </span>
                      </div>
                      <p className="text-xs text-white/35 mt-1.5 leading-relaxed">{feat.desc}</p>
                    </div>
                  </div>
                </GlassCard>
              </motion.div>
            ))}
          </div>
        </Section>

      </div>
    </div>
  )
}
