import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// ============ Token Pairs ============
const TOKEN_PAIRS = [
  { base: 'ETH',  quote: 'USDC', baseIcon: '\u27E0', quoteIcon: '$', basePrice: 3847.52 },
  { base: 'ETH',  quote: 'USDT', baseIcon: '\u27E0', quoteIcon: '$', basePrice: 3846.90 },
  { base: 'WBTC', quote: 'USDC', baseIcon: '\u20BF', quoteIcon: '$', basePrice: 71234.18 },
  { base: 'WBTC', quote: 'ETH',  baseIcon: '\u20BF', quoteIcon: '\u27E0', basePrice: 18.52 },
  { base: 'ETH',  quote: 'DAI',  baseIcon: '\u27E0', quoteIcon: '\u25C7', basePrice: 3847.10 },
]

// ============ Expiry Options ============
const EXPIRY_OPTIONS = [
  { label: '1h',  value: 3600,      display: '1 Hour' },
  { label: '24h', value: 86400,     display: '24 Hours' },
  { label: '7d',  value: 604800,    display: '7 Days' },
  { label: '30d', value: 2592000,   display: '30 Days' },
  { label: 'GTC', value: Infinity,  display: 'Good Till Cancel' },
]

// ============ Order Type Descriptions ============
const ORDER_TYPES = [
  {
    name: 'Good Till Cancel',
    abbr: 'GTC',
    color: '#22c55e',
    description: 'Order remains active until fully filled or manually cancelled. Survives across batch cycles.',
  },
  {
    name: 'Fill or Kill',
    abbr: 'FOK',
    color: '#f59e0b',
    description: 'Entire order must fill in a single batch cycle or it is automatically cancelled. No partial fills.',
  },
  {
    name: 'Post Only',
    abbr: 'PO',
    color: CYAN,
    description: 'Guarantees your order adds liquidity. If it would match immediately, it is rejected instead of filled.',
  },
]

// ============ Mock Open Orders ============
const MOCK_OPEN_ORDERS = [
  { id: 1, pair: 'ETH/USDC',  side: 'buy',  price: 3650.00, amount: 2.5,    filled: 40,  expiresAt: Date.now() + 82400000 },
  { id: 2, pair: 'ETH/USDC',  side: 'sell', price: 4100.00, amount: 1.0,    filled: 0,   expiresAt: Date.now() + 518000000 },
  { id: 3, pair: 'WBTC/USDC', side: 'buy',  price: 68500.00, amount: 0.15, filled: 73,  expiresAt: Date.now() + 3400000 },
  { id: 4, pair: 'ETH/USDT',  side: 'sell', price: 4250.00, amount: 5.0,    filled: 12,  expiresAt: Date.now() + 172000000 },
  { id: 5, pair: 'WBTC/ETH',  side: 'buy',  price: 17.80,   amount: 0.5,   filled: 0,   expiresAt: Infinity },
]

// ============ Mock Order History ============
const MOCK_HISTORY = [
  { id: 101, pair: 'ETH/USDC',  price: 3720.50, amount: 3.0,  fillTime: '2m 14s', status: 'Filled',    ts: Date.now() - 7200000 },
  { id: 102, pair: 'WBTC/USDC', price: 69000.00, amount: 0.1, fillTime: '--',      status: 'Cancelled', ts: Date.now() - 86400000 },
  { id: 103, pair: 'ETH/USDT',  price: 3500.00, amount: 1.5,  fillTime: '--',      status: 'Expired',   ts: Date.now() - 259200000 },
  { id: 104, pair: 'ETH/DAI',   price: 3810.25, amount: 0.8,  fillTime: '48s',     status: 'Filled',    ts: Date.now() - 432000000 },
]

// ============ Helpers ============
function fmtCountdown(ms) {
  if (!isFinite(ms)) return 'GTC'
  if (ms <= 0) return 'Expired'
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`
  return `${h}h ${m}m`
}

function fmtAge(ts) {
  const d = Date.now() - ts
  if (d < 60000) return 'Just now'
  if (d < 3600000) return `${Math.round(d / 60000)}m ago`
  if (d < 86400000) return `${Math.round(d / 3600000)}h ago`
  return `${Math.round(d / 86400000)}d ago`
}

function fmtPrice(n) {
  return n >= 1000 ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : n.toFixed(4)
}

// ============ Price Chart Mini ============
function PriceChartMini({ marketPrice, limitPrice, side }) {
  const w = 280
  const h = 80
  const pad = 12

  // Simulated price history (30 points)
  const points = []
  let price = marketPrice * 0.97
  for (let i = 0; i < 30; i++) {
    price += (Math.random() - 0.48) * marketPrice * 0.006
    points.push(price)
  }
  points[points.length - 1] = marketPrice

  const allPrices = [...points, limitPrice].filter(isFinite)
  const minP = Math.min(...allPrices) * 0.998
  const maxP = Math.max(...allPrices) * 1.002
  const range = maxP - minP || 1

  const toY = (p) => h - pad - ((p - minP) / range) * (h - pad * 2)
  const toX = (i) => pad + (i / (points.length - 1)) * (w - pad * 2)

  const pathData = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(p).toFixed(1)}`).join(' ')
  const limitY = toY(limitPrice)

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ maxHeight: 80 }}>
      {/* Price line */}
      <path d={pathData} fill="none" stroke={CYAN} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
      {/* Limit price horizontal line */}
      <line
        x1={pad} y1={limitY} x2={w - pad} y2={limitY}
        stroke={side === 'buy' ? '#22c55e' : '#ef4444'}
        strokeWidth="1" strokeDasharray="4 3" opacity="0.7"
      />
      {/* Limit price label */}
      <text x={w - pad - 2} y={limitY - 4} textAnchor="end"
        fill={side === 'buy' ? '#22c55e' : '#ef4444'} fontSize="8" fontFamily="monospace">
        Limit: {fmtPrice(limitPrice)}
      </text>
      {/* Current price dot */}
      <circle cx={toX(points.length - 1)} cy={toY(marketPrice)} r="3" fill={CYAN} />
      <text x={toX(points.length - 1)} y={toY(marketPrice) - 6} textAnchor="middle"
        fill={CYAN} fontSize="7" fontFamily="monospace">
        Now
      </text>
    </svg>
  )
}

// ============ Main Component ============
export default function LimitOrderPage() {
  const { isConnected: isExternalConnected, connect } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  // ---- State ----
  const [selectedPair, setSelectedPair] = useState(TOKEN_PAIRS[0])
  const [side, setSide] = useState('buy')
  const [limitPrice, setLimitPrice] = useState('')
  const [amount, setAmount] = useState('')
  const [expiry, setExpiry] = useState(EXPIRY_OPTIONS[1])
  const [showPairDD, setShowPairDD] = useState(false)
  const [marketPrice, setMarketPrice] = useState(selectedPair.basePrice)
  const [openOrders, setOpenOrders] = useState(MOCK_OPEN_ORDERS)
  const [tab, setTab] = useState('order')

  // ---- Simulated live price ----
  useEffect(() => {
    setMarketPrice(selectedPair.basePrice)
  }, [selectedPair])

  useEffect(() => {
    const interval = setInterval(() => {
      setMarketPrice(prev => {
        const delta = (Math.random() - 0.5) * prev * 0.002
        return parseFloat((prev + delta).toFixed(2))
      })
    }, 3000)
    return () => clearInterval(interval)
  }, [selectedPair])

  // ---- Countdown ticks ----
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(t)
  }, [])

  // ---- Derived ----
  const limitNum = parseFloat(limitPrice) || 0
  const amountNum = parseFloat(amount) || 0
  const hasValidOrder = limitNum > 0 && amountNum > 0

  const priceDistance = limitNum > 0
    ? (((limitNum - marketPrice) / marketPrice) * 100).toFixed(2)
    : null

  const priceDistanceLabel = priceDistance !== null
    ? `${Math.abs(priceDistance)}% ${parseFloat(priceDistance) >= 0 ? 'above' : 'below'} market`
    : null

  const totalValue = hasValidOrder ? (limitNum * amountNum).toFixed(2) : '0.00'

  // ---- Handlers ----
  const handleCancel = (id) => {
    setOpenOrders(prev => prev.filter(o => o.id !== id))
  }

  const handleSubmit = () => {
    if (!isConnected) { connect(); return }
    if (!hasValidOrder) return
    // In production this would submit to CommitRevealAuction
    const newOrder = {
      id: Date.now(),
      pair: `${selectedPair.base}/${selectedPair.quote}`,
      side,
      price: limitNum,
      amount: amountNum,
      filled: 0,
      expiresAt: isFinite(expiry.value) ? Date.now() + expiry.value * 1000 : Infinity,
    }
    setOpenOrders(prev => [newOrder, ...prev])
    setLimitPrice('')
    setAmount('')
  }

  // ============ Not Connected State ============
  if (!isConnected) {
    return (
      <div className="max-w-4xl mx-auto px-4">
        <PageHero
          title="Limit Orders"
          subtitle="Set your price. The batch auction does the rest."
          category="trading"
          badge="Batch"
          badgeColor={CYAN}
        />
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1 / PHI, ease: [0.25, 0.1, 1 / PHI, 1] }}
        >
          <GlassCard glowColor="terminal" className="p-8">
            <div className="text-center">
              <motion.div
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ repeat: Infinity, duration: PHI * 2, ease: 'easeInOut' }}
                className="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center"
                style={{ backgroundColor: CYAN + '15', border: `1px solid ${CYAN}33` }}
              >
                <svg className="w-8 h-8" style={{ color: CYAN }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
              </motion.div>
              <h2 className="text-xl font-bold text-white mb-2">Connect wallet to place limit orders</h2>
              <p className="text-black-400 text-sm mb-6 max-w-md mx-auto">
                Set your target price and VibeSwap will fill your order in the next batch cycle at a uniform clearing price. Zero MEV. Zero front-running.
              </p>
              <button
                onClick={connect}
                className="px-6 py-3 rounded-xl font-medium text-white transition-all hover:scale-105"
                style={{ backgroundColor: CYAN, boxShadow: `0 0 20px ${CYAN}33` }}
              >
                Connect Wallet
              </button>
            </div>
          </GlassCard>
        </motion.div>
      </div>
    )
  }

  // ============ Connected State ============
  return (
    <div className="max-w-4xl mx-auto px-4">
      <PageHero
        title="Limit Orders"
        subtitle="Set your price. The batch auction does the rest."
        category="trading"
        badge="Live"
        badgeColor="#22c55e"
      />

      {/* Tab Switcher */}
      <div className="flex mb-4 p-1 rounded-xl bg-black-800/60 border border-black-700/50">
        {['order', 'open', 'history'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === t ? 'bg-black-700 text-white shadow-sm' : 'text-black-400 hover:text-black-200'
            }`}
          >
            {t === 'order' ? 'New Order' : t === 'open' ? `Open (${openOrders.length})` : 'History'}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {/* ============ NEW ORDER TAB ============ */}
        {tab === 'order' && (
          <motion.div key="order" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }} transition={{ duration: 0.18 }}>

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
              {/* Order Form — 3 cols */}
              <div className="lg:col-span-3 space-y-4">
                <GlassCard glowColor="terminal" spotlight className="p-4">
                  {/* Pair Selector */}
                  <div className="mb-4">
                    <div className="text-xs text-black-400 font-mono uppercase tracking-wider mb-2">Trading Pair</div>
                    <div className="relative">
                      <button
                        onClick={() => setShowPairDD(!showPairDD)}
                        className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-black-700 hover:bg-black-600 transition-colors"
                      >
                        <div className="flex items-center space-x-3">
                          <span className="text-lg">{selectedPair.baseIcon}</span>
                          <span className="font-medium text-white">{selectedPair.base}/{selectedPair.quote}</span>
                        </div>
                        <svg className="w-4 h-4 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      <AnimatePresence>
                        {showPairDD && (
                          <>
                            <div className="fixed inset-0 z-40" onClick={() => setShowPairDD(false)} />
                            <motion.div
                              initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                              className="absolute top-full left-0 right-0 mt-2 rounded-xl glass-card shadow-xl py-2 z-50"
                            >
                              {TOKEN_PAIRS.map((p, i) => (
                                <button key={i} onClick={() => { setSelectedPair(p); setShowPairDD(false); setLimitPrice('') }}
                                  className="w-full flex items-center space-x-3 px-4 py-2.5 hover:bg-black-700 transition-colors">
                                  <span className="text-lg">{p.baseIcon}</span>
                                  <span className="font-medium text-sm">{p.base}/{p.quote}</span>
                                  <div className="flex-1" />
                                  <span className="text-sm font-mono text-black-400">{fmtPrice(p.basePrice)}</span>
                                </button>
                              ))}
                            </motion.div>
                          </>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>

                  {/* Buy / Sell Toggle */}
                  <div className="mb-4">
                    <div className="flex p-1 rounded-xl bg-black-800/80 border border-black-700/50">
                      {['buy', 'sell'].map(s => (
                        <button key={s} onClick={() => setSide(s)}
                          className={`flex-1 py-2.5 rounded-lg text-sm font-bold uppercase tracking-wider transition-all ${
                            side === s
                              ? s === 'buy'
                                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                : 'bg-red-500/20 text-red-400 border border-red-500/30'
                              : 'text-black-400 hover:text-black-200 border border-transparent'
                          }`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Current Market Price */}
                  <div className="mb-4 px-4 py-3 rounded-xl bg-black-900/60 border border-black-700/30">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-black-400 font-mono">Market Price</span>
                      <div className="flex items-center space-x-2">
                        <motion.div
                          key={marketPrice}
                          initial={{ opacity: 0.5, y: -2 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.3 }}
                          className="font-mono font-bold text-white"
                        >
                          {fmtPrice(marketPrice)}
                        </motion.div>
                        <span className="text-xs text-black-500">{selectedPair.quote}</span>
                        <motion.div
                          animate={{ opacity: [1, 0.3, 1] }}
                          transition={{ repeat: Infinity, duration: PHI }}
                          className="w-1.5 h-1.5 rounded-full bg-green-400"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Limit Price Input */}
                  <div className="mb-4">
                    <div className="text-xs text-black-400 font-mono uppercase tracking-wider mb-2">Limit Price ({selectedPair.quote})</div>
                    <div className="relative">
                      <input
                        type="number"
                        value={limitPrice}
                        onChange={e => setLimitPrice(e.target.value)}
                        placeholder={fmtPrice(marketPrice)}
                        className="w-full px-4 py-3 rounded-xl bg-black-700 border border-black-600/50 text-lg font-mono text-white placeholder-black-500 outline-none focus:border-cyan-500/50 transition-colors"
                      />
                      {priceDistanceLabel && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs font-mono px-2 py-0.5 rounded-full ${
                            parseFloat(priceDistance) >= 0
                              ? 'bg-green-500/10 text-green-400'
                              : 'bg-red-500/10 text-red-400'
                          }`}
                        >
                          {priceDistanceLabel}
                        </motion.div>
                      )}
                    </div>
                  </div>

                  {/* Amount Input */}
                  <div className="mb-4">
                    <div className="text-xs text-black-400 font-mono uppercase tracking-wider mb-2">Amount ({selectedPair.base})</div>
                    <input
                      type="number"
                      value={amount}
                      onChange={e => setAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full px-4 py-3 rounded-xl bg-black-700 border border-black-600/50 text-lg font-mono text-white placeholder-black-500 outline-none focus:border-cyan-500/50 transition-colors"
                    />
                    {hasValidOrder && (
                      <div className="mt-2 text-xs text-black-400 font-mono">
                        Total: {totalValue} {selectedPair.quote}
                      </div>
                    )}
                  </div>

                  {/* Expiry Selector */}
                  <div className="mb-4">
                    <div className="text-xs text-black-400 font-mono uppercase tracking-wider mb-2">Expiry</div>
                    <div className="flex gap-2">
                      {EXPIRY_OPTIONS.map(e => (
                        <button key={e.label} onClick={() => setExpiry(e)}
                          className={`flex-1 py-2 rounded-lg text-xs font-mono font-medium transition-all border ${
                            expiry.label === e.label
                              ? 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30'
                              : 'bg-black-800/60 text-black-400 border-black-700/50 hover:text-black-200'
                          }`}
                        >
                          {e.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Mini Chart */}
                  {limitNum > 0 && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mb-4 p-3 rounded-xl bg-black-900/60 border border-black-700/30"
                    >
                      <div className="text-[10px] text-black-500 font-mono uppercase tracking-wider mb-1">Price Chart</div>
                      <PriceChartMini marketPrice={marketPrice} limitPrice={limitNum} side={side} />
                    </motion.div>
                  )}

                  {/* Batch Integration Notice */}
                  <div className="mb-4 p-3 rounded-xl border" style={{ backgroundColor: CYAN + '08', borderColor: CYAN + '20' }}>
                    <div className="flex items-start space-x-2">
                      <svg className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: CYAN }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <p className="text-xs" style={{ color: CYAN }}>
                        Limit orders execute in the next batch cycle at uniform clearing price. No MEV, no front-running, no sandwich attacks.
                      </p>
                    </div>
                  </div>

                  {/* Submit Button */}
                  <motion.button
                    onClick={handleSubmit}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                    className={`w-full py-4 rounded-xl text-lg font-bold uppercase tracking-wider transition-all ${
                      hasValidOrder
                        ? side === 'buy'
                          ? 'bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30'
                          : 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30'
                        : 'bg-black-700 text-black-500 border border-black-600 cursor-not-allowed'
                    }`}
                    disabled={!hasValidOrder}
                  >
                    {hasValidOrder
                      ? `Place ${side} limit order`
                      : 'Enter price and amount'
                    }
                  </motion.button>
                </GlassCard>
              </div>

              {/* Right column — 2 cols */}
              <div className="lg:col-span-2 space-y-4">
                {/* Order Summary */}
                {hasValidOrder && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 1 / (PHI * PHI), ease: 'easeOut' }}
                  >
                    <GlassCard glowColor={side === 'buy' ? 'matrix' : 'warning'} className="p-4">
                      <div className="text-xs text-black-400 font-mono uppercase tracking-wider mb-3">Order Preview</div>
                      <div className="space-y-2.5">
                        <div className="flex justify-between text-sm">
                          <span className="text-black-400">Side</span>
                          <span className={`font-bold uppercase ${side === 'buy' ? 'text-green-400' : 'text-red-400'}`}>{side}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-black-400">Pair</span>
                          <span className="text-white font-medium">{selectedPair.base}/{selectedPair.quote}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-black-400">Limit Price</span>
                          <span className="text-white font-mono">{fmtPrice(limitNum)} {selectedPair.quote}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-black-400">Amount</span>
                          <span className="text-white font-mono">{amountNum} {selectedPair.base}</span>
                        </div>
                        <div className="border-t border-black-700 pt-2 flex justify-between text-sm">
                          <span className="text-black-400">Total</span>
                          <span className="text-white font-mono font-bold">{totalValue} {selectedPair.quote}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-black-400">Expiry</span>
                          <span className="text-black-200">{expiry.display}</span>
                        </div>
                      </div>
                    </GlassCard>
                  </motion.div>
                )}

                {/* Order Types Info */}
                <GlassCard className="p-4">
                  <div className="text-xs text-black-400 font-mono uppercase tracking-wider mb-3">Order Types</div>
                  <div className="space-y-3">
                    {ORDER_TYPES.map(ot => (
                      <motion.div key={ot.abbr}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 1 / PHI }}
                        className="p-3 rounded-xl bg-black-800/50 border border-black-700/40"
                      >
                        <div className="flex items-center space-x-2 mb-1">
                          <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded"
                            style={{ backgroundColor: ot.color + '20', color: ot.color }}>
                            {ot.abbr}
                          </span>
                          <span className="text-sm font-medium text-white">{ot.name}</span>
                        </div>
                        <p className="text-xs text-black-400 leading-relaxed">{ot.description}</p>
                      </motion.div>
                    ))}
                  </div>
                </GlassCard>
              </div>
            </div>
          </motion.div>
        )}

        {/* ============ OPEN ORDERS TAB ============ */}
        {tab === 'open' && (
          <motion.div key="open" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.18 }}>
            {openOrders.length === 0 ? (
              <GlassCard className="p-8">
                <div className="text-center">
                  <svg className="w-12 h-12 mx-auto text-black-600 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  <p className="text-black-400 text-sm">No open orders</p>
                  <p className="text-black-500 text-xs mt-1">Place a limit order to get started</p>
                </div>
              </GlassCard>
            ) : (
              <div className="space-y-2">
                {openOrders.map((order, i) => (
                  <motion.div key={order.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05, duration: 1 / (PHI * PHI) }}
                  >
                    <GlassCard className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center space-x-3">
                          <span className={`text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded-full ${
                            order.side === 'buy'
                              ? 'bg-green-500/15 text-green-400 border border-green-500/25'
                              : 'bg-red-500/15 text-red-400 border border-red-500/25'
                          }`}>
                            {order.side}
                          </span>
                          <span className="font-medium text-white text-sm">{order.pair}</span>
                        </div>
                        <button
                          onClick={() => handleCancel(order.id)}
                          className="px-3 py-1 rounded-lg text-xs font-mono text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div>
                          <div className="text-[10px] text-black-500 font-mono uppercase">Price</div>
                          <div className="text-sm font-mono text-white">{fmtPrice(order.price)}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-black-500 font-mono uppercase">Amount</div>
                          <div className="text-sm font-mono text-white">{order.amount}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-black-500 font-mono uppercase">Filled</div>
                          <div className="flex items-center space-x-2">
                            <div className="flex-1 h-1.5 rounded-full bg-black-700 overflow-hidden">
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${order.filled}%` }}
                                transition={{ duration: 1 / PHI, ease: 'easeOut' }}
                                className="h-full rounded-full"
                                style={{ backgroundColor: order.filled >= 100 ? '#22c55e' : CYAN }}
                              />
                            </div>
                            <span className="text-xs font-mono text-black-300">{order.filled}%</span>
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-black-500 font-mono uppercase">Expires</div>
                          <div className="text-sm font-mono text-black-300">
                            {fmtCountdown(order.expiresAt - now)}
                          </div>
                        </div>
                      </div>
                    </GlassCard>
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {/* ============ HISTORY TAB ============ */}
        {tab === 'history' && (
          <motion.div key="history" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.18 }}>
            <div className="space-y-2">
              {MOCK_HISTORY.map((h, i) => {
                const statusColors = {
                  Filled:    'bg-green-500/10 text-green-400 border-green-500/20',
                  Cancelled: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
                  Expired:   'bg-red-500/10 text-red-400 border-red-500/20',
                }
                return (
                  <motion.div key={h.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05, duration: 1 / (PHI * PHI) }}
                  >
                    <GlassCard className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-white text-sm">{h.pair}</span>
                        <span className={`text-[10px] font-mono font-medium px-2 py-0.5 rounded-full border ${statusColors[h.status]}`}>
                          {h.status}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div>
                          <div className="text-[10px] text-black-500 font-mono uppercase">Price</div>
                          <div className="text-sm font-mono text-black-200">{fmtPrice(h.price)}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-black-500 font-mono uppercase">Amount</div>
                          <div className="text-sm font-mono text-black-200">{h.amount}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-black-500 font-mono uppercase">Fill Time</div>
                          <div className="text-sm font-mono text-black-200">{h.fillTime}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-black-500 font-mono uppercase">When</div>
                          <div className="text-sm font-mono text-black-400">{fmtAge(h.ts)}</div>
                        </div>
                      </div>
                    </GlassCard>
                  </motion.div>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
