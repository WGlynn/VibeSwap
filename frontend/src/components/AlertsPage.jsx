import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============================================================
// Alerts Page — Price alerts, triggered history, live tickers
// ============================================================

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const ease = [0.25, 0.1, 0.25, 1]

// ============ Alert Types ============

const ALERT_TYPES = [
  { value: 'above', label: 'Price Above', icon: '>' },
  { value: 'below', label: 'Price Below', icon: '<' },
  { value: 'pct_change', label: '% Change (24h)', icon: '%' },
  { value: 'volume_spike', label: 'Volume Spike', icon: 'V' },
]

// ============ Token Registry ============

const TOKENS = [
  { symbol: 'ETH', name: 'Ethereum', basePrice: 3485.20, color: '#627eea' },
  { symbol: 'BTC', name: 'Bitcoin', basePrice: 67842.50, color: '#f7931a' },
  { symbol: 'VIBE', name: 'VibeSwap', basePrice: 0.0847, color: CYAN },
  { symbol: 'ARB', name: 'Arbitrum', basePrice: 1.24, color: '#28a0f0' },
  { symbol: 'OP', name: 'Optimism', basePrice: 2.67, color: '#ff0420' },
]

// ============ Mock Active Alerts ============

const INITIAL_ALERTS = [
  { id: 1, token: 'ETH', type: 'above', target: 3600, notify: 'both', status: 'active', created: '2h ago' },
  { id: 2, token: 'BTC', type: 'below', target: 65000, notify: 'in-app', status: 'active', created: '4h ago' },
  { id: 3, token: 'VIBE', type: 'above', target: 0.10, notify: 'email', status: 'active', created: '1d ago' },
  { id: 4, token: 'ARB', type: 'pct_change', target: 15, notify: 'both', status: 'active', created: '2d ago' },
  { id: 5, token: 'OP', type: 'volume_spike', target: 200, notify: 'in-app', status: 'expired', created: '5d ago' },
  { id: 6, token: 'ETH', type: 'below', target: 3200, notify: 'both', status: 'active', created: '7d ago' },
]

// ============ Mock Triggered History ============

const TRIGGERED_HISTORY = [
  { id: 101, token: 'ETH', type: 'above', target: 3400, triggeredPrice: 3412.80, timestamp: 'Mar 11, 14:23', ago: '22h ago' },
  { id: 102, token: 'BTC', type: 'below', target: 68000, triggeredPrice: 67985.40, timestamp: 'Mar 10, 09:15', ago: '2d ago' },
  { id: 103, token: 'VIBE', type: 'pct_change', target: 10, triggeredPrice: 0.0932, timestamp: 'Mar 8, 18:42', ago: '4d ago' },
  { id: 104, token: 'ARB', type: 'above', target: 1.20, triggeredPrice: 1.215, timestamp: 'Mar 6, 11:07', ago: '6d ago' },
]

// ============ Animation Variants ============

const stagger = { hidden: {}, show: { transition: { staggerChildren: 1 / (PHI * PHI * 10) } } }
const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 1 / (PHI * PHI), ease: 'easeOut' } },
}
const cardV = {
  hidden: { opacity: 0, y: 12 },
  visible: (i) => ({ opacity: 1, y: 0, transition: { duration: 0.3, delay: 0.05 + i * (0.04 * PHI), ease } }),
  exit: { opacity: 0, x: -40, transition: { duration: 0.2 } },
}

// ============ Helpers ============

function fmtPrice(n) {
  if (n >= 1000) return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  if (n >= 1) return `$${n.toFixed(2)}`
  return `$${n.toFixed(4)}`
}

function getTypeLabel(type) {
  const found = ALERT_TYPES.find((t) => t.value === type)
  return found ? found.label : type
}

function getTypeIcon(type) {
  const found = ALERT_TYPES.find((t) => t.value === type)
  return found ? found.icon : '?'
}

function getTokenColor(symbol) {
  const found = TOKENS.find((t) => t.symbol === symbol)
  return found ? found.color : CYAN
}

// ============ Seeded Random for Deterministic Price Jitter ============

function seededRandom(seed) {
  let s = seed
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }
}

// ============ Main Component ============

export default function AlertsPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [alerts, setAlerts] = useState(INITIAL_ALERTS)
  const [livePrices, setLivePrices] = useState(() => {
    const initial = {}
    TOKENS.forEach((t) => { initial[t.symbol] = { price: t.basePrice, change24h: 0 } })
    return initial
  })

  // ============ Create Alert Form State ============
  const [formToken, setFormToken] = useState('ETH')
  const [formType, setFormType] = useState('above')
  const [formTarget, setFormTarget] = useState('')
  const [formNotify, setFormNotify] = useState('in-app')
  const [showForm, setShowForm] = useState(false)

  // ============ Simulated Live Prices ============
  useEffect(() => {
    let tick = 0
    const rng = seededRandom(314159)
    const interval = setInterval(() => {
      tick++
      setLivePrices((prev) => {
        const next = { ...prev }
        TOKENS.forEach((t) => {
          const volatility = t.symbol === 'VIBE' ? 0.008 : t.symbol === 'BTC' ? 0.001 : 0.003
          const jitter = (rng() - 0.48) * volatility * t.basePrice
          const newPrice = Math.max(prev[t.symbol].price + jitter, t.basePrice * 0.8)
          const change24h = ((newPrice - t.basePrice) / t.basePrice) * 100
          next[t.symbol] = { price: newPrice, change24h }
        })
        return next
      })
    }, 2000)
    return () => clearInterval(interval)
  }, [])

  // ============ Alert Statistics ============
  const totalActive = alerts.filter((a) => a.status === 'active').length
  const triggeredToday = TRIGGERED_HISTORY.filter((h) => h.ago.includes('h ago')).length
  const totalTriggered = TRIGGERED_HISTORY.length
  const hitRate = totalActive + totalTriggered > 0
    ? ((totalTriggered / (totalActive + totalTriggered)) * 100).toFixed(1)
    : '0.0'

  // ============ Create Alert Handler ============
  const handleCreateAlert = useCallback(() => {
    if (!formTarget || isNaN(Number(formTarget))) return
    const newAlert = {
      id: Date.now(),
      token: formToken,
      type: formType,
      target: Number(formTarget),
      notify: formNotify,
      status: 'active',
      created: 'Just now',
    }
    setAlerts((prev) => [newAlert, ...prev])
    setFormTarget('')
    setShowForm(false)
  }, [formToken, formType, formTarget, formNotify])

  // ============ Delete Alert Handler ============
  const deleteAlert = useCallback((id) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id))
  }, [])

  // ============ Disconnected State ============
  if (!isConnected) {
    return (
      <div className="min-h-screen pb-20">
        <PageHero title="Price Alerts" category="trading" subtitle="Set alerts for price targets across any token" />
        <div className="max-w-2xl mx-auto px-4 mt-8">
          <GlassCard glowColor="terminal" className="p-8 text-center">
            <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center text-2xl"
              style={{ background: `${CYAN}15`, border: `1px solid ${CYAN}25` }}>
              <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke={CYAN} strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-white mb-2">Connect Wallet</h3>
            <p className="text-sm font-mono text-black-400 max-w-md mx-auto">
              Connect your wallet to create price alerts, track targets, and receive notifications when your conditions are met.
            </p>
          </GlassCard>
        </div>
      </div>
    )
  }

  // ============ Connected State ============
  return (
    <div className="min-h-screen pb-20">
      {/* Background particles */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        {Array.from({ length: 6 }).map((_, i) => (
          <motion.div key={i} className="absolute w-px h-px rounded-full"
            style={{ background: CYAN, left: `${(i * PHI * 17) % 100}%`, top: `${(i * PHI * 23) % 100}%` }}
            animate={{ opacity: [0, 0.15, 0], scale: [0, 1.5, 0], y: [0, -40] }}
            transition={{ duration: 4, repeat: Infinity, delay: i * 0.7, ease: 'easeOut' }} />
        ))}
      </div>

      <div className="relative z-10">
        <PageHero
          title="Price Alerts"
          category="trading"
          subtitle="Set alerts for price targets across any token"
          badge={`${totalActive} Active`}
          badgeColor={totalActive > 0 ? CYAN : '#6b7280'}
        />

        <div className="max-w-5xl mx-auto px-4">
          <motion.div variants={stagger} initial="hidden" animate="show">

            {/* ============ Statistics Row ============ */}
            <motion.div variants={fadeUp} className="grid grid-cols-3 gap-4 mb-6">
              {[
                { label: 'Active Alerts', value: totalActive, color: CYAN },
                { label: 'Triggered Today', value: triggeredToday, color: '#22c55e' },
                { label: 'Hit Rate', value: `${hitRate}%`, color: '#a855f7' },
              ].map((stat) => (
                <div key={stat.label} className="rounded-xl p-4 text-center"
                  style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.04)' }}>
                  <div className="text-[9px] font-mono text-black-500 uppercase tracking-wider">{stat.label}</div>
                  <div className="text-xl font-mono font-bold mt-1" style={{ color: stat.color }}>{stat.value}</div>
                </div>
              ))}
            </motion.div>

            {/* ============ Live Price Tickers ============ */}
            <motion.div variants={fadeUp} className="mb-6">
              <GlassCard glowColor="terminal" className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-black-400">Live Prices</h3>
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-[9px] font-mono text-black-500">Streaming</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  {TOKENS.map((token) => {
                    const live = livePrices[token.symbol]
                    const isUp = live.change24h >= 0
                    return (
                      <motion.div
                        key={token.symbol}
                        className="rounded-lg p-3 transition-all"
                        style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${token.color}15` }}
                        whileHover={{ scale: 1.02, borderColor: `${token.color}40` }}
                        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-mono font-bold"
                            style={{ background: `${token.color}20`, color: token.color }}>
                            {token.symbol.charAt(0)}
                          </div>
                          <span className="text-[10px] font-mono font-bold text-white">{token.symbol}</span>
                        </div>
                        <div className="text-sm font-mono font-bold text-white">{fmtPrice(live.price)}</div>
                        <div className={`text-[9px] font-mono mt-0.5 ${isUp ? 'text-green-400' : 'text-red-400'}`}>
                          {isUp ? '+' : ''}{live.change24h.toFixed(2)}%
                        </div>
                      </motion.div>
                    )
                  })}
                </div>
              </GlassCard>
            </motion.div>

            {/* ============ Create Alert Section ============ */}
            <motion.div variants={fadeUp} className="mb-6">
              <GlassCard glowColor="terminal" className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-mono font-bold text-white">Create Alert</h3>
                  <button
                    onClick={() => setShowForm(!showForm)}
                    className="px-3 py-1.5 rounded-lg text-[10px] font-mono font-bold uppercase tracking-wider transition-colors"
                    style={{
                      background: showForm ? 'rgba(239,68,68,0.1)' : `${CYAN}15`,
                      border: `1px solid ${showForm ? 'rgba(239,68,68,0.3)' : `${CYAN}30`}`,
                      color: showForm ? '#ef4444' : CYAN,
                    }}
                  >
                    {showForm ? 'Cancel' : '+ New Alert'}
                  </button>
                </div>

                <AnimatePresence>
                  {showForm && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 1 / (PHI * PHI * PHI), ease }}
                      className="overflow-hidden"
                    >
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                        {/* Token Selector */}
                        <div>
                          <label className="text-[9px] font-mono text-black-500 uppercase tracking-wider block mb-1.5">Token</label>
                          <select
                            value={formToken}
                            onChange={(e) => setFormToken(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg text-xs font-mono bg-black-900 border border-black-700 text-white outline-none focus:border-cyan-500/50 transition-colors appearance-none cursor-pointer"
                          >
                            {TOKENS.map((t) => (
                              <option key={t.symbol} value={t.symbol}>{t.symbol} — {t.name}</option>
                            ))}
                          </select>
                        </div>

                        {/* Condition */}
                        <div>
                          <label className="text-[9px] font-mono text-black-500 uppercase tracking-wider block mb-1.5">Condition</label>
                          <select
                            value={formType}
                            onChange={(e) => setFormType(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg text-xs font-mono bg-black-900 border border-black-700 text-white outline-none focus:border-cyan-500/50 transition-colors appearance-none cursor-pointer"
                          >
                            {ALERT_TYPES.map((t) => (
                              <option key={t.value} value={t.value}>{t.label}</option>
                            ))}
                          </select>
                        </div>

                        {/* Target Price / Value */}
                        <div>
                          <label className="text-[9px] font-mono text-black-500 uppercase tracking-wider block mb-1.5">
                            {formType === 'pct_change' ? 'Change %' : formType === 'volume_spike' ? 'Volume %' : 'Target Price'}
                          </label>
                          <input
                            type="number"
                            step="any"
                            value={formTarget}
                            onChange={(e) => setFormTarget(e.target.value)}
                            placeholder={formType === 'pct_change' ? '10' : formType === 'volume_spike' ? '200' : fmtPrice(livePrices[formToken]?.price || 0).replace('$', '')}
                            className="w-full px-3 py-2 rounded-lg text-xs font-mono bg-black-900 border border-black-700 text-white outline-none focus:border-cyan-500/50 transition-colors placeholder:text-black-600"
                          />
                        </div>

                        {/* Notification Method */}
                        <div>
                          <label className="text-[9px] font-mono text-black-500 uppercase tracking-wider block mb-1.5">Notify Via</label>
                          <select
                            value={formNotify}
                            onChange={(e) => setFormNotify(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg text-xs font-mono bg-black-900 border border-black-700 text-white outline-none focus:border-cyan-500/50 transition-colors appearance-none cursor-pointer"
                          >
                            <option value="in-app">In-App</option>
                            <option value="email">Email</option>
                            <option value="both">Both</option>
                          </select>
                        </div>
                      </div>

                      {/* Current price hint */}
                      <div className="flex items-center justify-between">
                        <div className="text-[10px] font-mono text-black-500">
                          Current {formToken} price: <span style={{ color: getTokenColor(formToken) }}>{fmtPrice(livePrices[formToken]?.price || 0)}</span>
                        </div>
                        <button
                          onClick={handleCreateAlert}
                          disabled={!formTarget || isNaN(Number(formTarget))}
                          className="px-4 py-2 rounded-lg text-xs font-mono font-bold uppercase tracking-wider transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                          style={{
                            background: `${CYAN}20`,
                            border: `1px solid ${CYAN}40`,
                            color: CYAN,
                          }}
                        >
                          Create Alert
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </GlassCard>
            </motion.div>

            {/* ============ Active Alerts List ============ */}
            <motion.div variants={fadeUp} className="mb-6">
              <GlassCard glowColor="terminal" className="p-5">
                <h3 className="text-sm font-mono font-bold text-white mb-4">Active Alerts</h3>

                <AnimatePresence mode="popLayout">
                  {alerts.length === 0 ? (
                    <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                      className="text-center py-8">
                      <p className="text-sm font-mono text-black-500">No active alerts. Create one above.</p>
                    </motion.div>
                  ) : (
                    <div className="space-y-2">
                      {alerts.map((alert, i) => {
                        const tokenColor = getTokenColor(alert.token)
                        const currentPrice = livePrices[alert.token]?.price || 0
                        const isTriggered = alert.status === 'triggered'
                        const isExpired = alert.status === 'expired'
                        const isActive = alert.status === 'active'

                        // Proximity indicator: how close is current price to target
                        let proximity = 0
                        if (alert.type === 'above' || alert.type === 'below') {
                          proximity = Math.abs((currentPrice - alert.target) / alert.target) * 100
                        }
                        const isClose = proximity < 3 && isActive

                        const statusColor = isTriggered ? '#22c55e' : isExpired ? '#6b7280' : isClose ? '#f59e0b' : CYAN
                        const statusLabel = isTriggered ? 'Triggered' : isExpired ? 'Expired' : isClose ? 'Near Target' : 'Active'

                        return (
                          <motion.div
                            key={alert.id}
                            custom={i}
                            variants={cardV}
                            initial="hidden"
                            animate="visible"
                            exit="exit"
                            layout
                          >
                            <div
                              className="rounded-xl p-4 group relative overflow-hidden transition-all"
                              style={{
                                background: isClose ? `${statusColor}06` : 'rgba(0,0,0,0.3)',
                                border: `1px solid ${isClose ? `${statusColor}25` : 'rgba(255,255,255,0.04)'}`,
                              }}
                            >
                              {/* Close proximity pulse */}
                              {isClose && (
                                <div className="absolute top-3 right-12 w-2 h-2 rounded-full animate-pulse"
                                  style={{ background: statusColor, boxShadow: `0 0 6px ${statusColor}60` }} />
                              )}

                              <div className="flex items-center gap-3">
                                {/* Token icon */}
                                <div className="w-9 h-9 rounded-lg flex items-center justify-center text-[10px] font-mono font-bold flex-shrink-0"
                                  style={{ background: `${tokenColor}12`, border: `1px solid ${tokenColor}25`, color: tokenColor }}>
                                  {alert.token}
                                </div>

                                {/* Alert details */}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-xs font-mono font-bold text-white">{alert.token}</span>
                                    <span className="text-[8px] font-mono px-1.5 py-0.5 rounded-full uppercase"
                                      style={{ background: `${tokenColor}10`, border: `1px solid ${tokenColor}20`, color: tokenColor }}>
                                      {getTypeIcon(alert.type)} {getTypeLabel(alert.type)}
                                    </span>
                                    <span className="text-[8px] font-mono px-1.5 py-0.5 rounded-full uppercase"
                                      style={{ background: `${statusColor}10`, border: `1px solid ${statusColor}20`, color: statusColor }}>
                                      {statusLabel}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-4 mt-1.5">
                                    <div className="text-[10px] font-mono text-black-400">
                                      Target: <span className="text-white font-bold">
                                        {alert.type === 'pct_change' ? `${alert.target}%` : alert.type === 'volume_spike' ? `${alert.target}%` : fmtPrice(alert.target)}
                                      </span>
                                    </div>
                                    {(alert.type === 'above' || alert.type === 'below') && (
                                      <div className="text-[10px] font-mono text-black-400">
                                        Current: <span style={{ color: tokenColor }}>{fmtPrice(currentPrice)}</span>
                                      </div>
                                    )}
                                    <div className="text-[10px] font-mono text-black-600">
                                      {alert.notify === 'both' ? 'App + Email' : alert.notify === 'email' ? 'Email' : 'In-App'}
                                    </div>
                                  </div>
                                </div>

                                {/* Created time */}
                                <span className="text-[9px] font-mono text-black-600 flex-shrink-0 hidden sm:block">{alert.created}</span>

                                {/* Delete button */}
                                <button
                                  onClick={() => deleteAlert(alert.id)}
                                  className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-black-600 hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
                                  title="Delete alert"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                    <path d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              </div>

                              {/* Proximity bar for price alerts */}
                              {(alert.type === 'above' || alert.type === 'below') && isActive && (
                                <div className="mt-3 h-1 rounded-full bg-black-800 overflow-hidden">
                                  <motion.div
                                    className="h-full rounded-full"
                                    style={{ backgroundColor: isClose ? '#f59e0b' : tokenColor }}
                                    initial={{ width: '0%' }}
                                    animate={{ width: `${Math.max(5, Math.min(100, 100 - proximity))}%` }}
                                    transition={{ duration: 0.5, ease: 'easeOut' }}
                                  />
                                </div>
                              )}
                            </div>
                          </motion.div>
                        )
                      })}
                    </div>
                  )}
                </AnimatePresence>
              </GlassCard>
            </motion.div>

            {/* ============ Triggered History ============ */}
            <motion.div variants={fadeUp} className="mb-6">
              <GlassCard glowColor="matrix" className="p-5">
                <h3 className="text-sm font-mono font-bold text-white mb-4">Triggered History</h3>
                <div className="space-y-2">
                  {TRIGGERED_HISTORY.map((entry, i) => {
                    const tokenColor = getTokenColor(entry.token)
                    return (
                      <motion.div
                        key={entry.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.4 + i * (0.06 * PHI), duration: 0.3, ease }}
                        className="rounded-lg p-3 flex items-center gap-3"
                        style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(34,197,94,0.08)' }}
                      >
                        {/* Check icon */}
                        <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                          style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.25)' }}>
                          <svg className="w-3.5 h-3.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </div>

                        {/* Details */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono font-bold text-white">{entry.token}</span>
                            <span className="text-[8px] font-mono px-1.5 py-0.5 rounded-full uppercase"
                              style={{ background: `${tokenColor}10`, border: `1px solid ${tokenColor}20`, color: tokenColor }}>
                              {getTypeLabel(entry.type)}
                            </span>
                          </div>
                          <div className="text-[10px] font-mono text-black-400 mt-0.5">
                            Target: <span className="text-white">{entry.type === 'pct_change' ? `${entry.target}%` : fmtPrice(entry.target)}</span>
                            <span className="mx-2 text-black-600">|</span>
                            Hit at: <span className="text-green-400">{fmtPrice(entry.triggeredPrice)}</span>
                          </div>
                        </div>

                        {/* Timestamp */}
                        <div className="text-right flex-shrink-0 hidden sm:block">
                          <div className="text-[9px] font-mono text-black-500">{entry.timestamp}</div>
                          <div className="text-[8px] font-mono text-black-600">{entry.ago}</div>
                        </div>
                      </motion.div>
                    )
                  })}
                </div>
              </GlassCard>
            </motion.div>

            {/* ============ Alert Types Reference ============ */}
            <motion.div variants={fadeUp} className="mb-6">
              <GlassCard glowColor="terminal" className="p-5">
                <h3 className="text-sm font-mono font-bold text-white mb-4">Alert Types</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {[
                    { type: 'above', desc: 'Triggers when token price rises above your target', example: 'ETH > $3,600', color: '#22c55e' },
                    { type: 'below', desc: 'Triggers when token price drops below your target', example: 'BTC < $65,000', color: '#ef4444' },
                    { type: 'pct_change', desc: 'Triggers on significant 24h percentage movement', example: 'VIBE +/- 15%', color: '#a855f7' },
                    { type: 'volume_spike', desc: 'Triggers when trading volume exceeds threshold', example: 'ARB vol > 200%', color: '#f59e0b' },
                  ].map((info) => (
                    <div key={info.type}
                      className="rounded-xl p-4 transition-all"
                      style={{ background: 'rgba(0,0,0,0.25)', border: `1px solid ${info.color}12` }}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-6 h-6 rounded-md flex items-center justify-center text-[9px] font-mono font-bold"
                          style={{ background: `${info.color}15`, color: info.color }}>
                          {getTypeIcon(info.type)}
                        </div>
                        <span className="text-xs font-mono font-bold text-white">{getTypeLabel(info.type)}</span>
                      </div>
                      <p className="text-[10px] font-mono text-black-400 leading-relaxed mb-2">{info.desc}</p>
                      <div className="text-[9px] font-mono px-2 py-1 rounded-md inline-block"
                        style={{ background: `${info.color}08`, color: info.color }}>
                        {info.example}
                      </div>
                    </div>
                  ))}
                </div>
              </GlassCard>
            </motion.div>

          </motion.div>
        </div>

        {/* ============ Footer ============ */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2 }} className="mt-12 mb-8 text-center">
          <div className="w-16 h-px mx-auto mb-4" style={{ background: `linear-gradient(90deg, transparent, ${CYAN}40, transparent)` }} />
          <p className="text-[10px] font-mono text-black-600 tracking-widest uppercase">Price Alert Center</p>
        </motion.div>
      </div>
    </div>
  )
}
