import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'

// ============================================================
// Notifications Page — Activity feed, alerts, preferences,
// mark-as-read, notification categories
// ============================================================

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const GREEN = '#00FF41'
const AMBER = '#FBBF24'
const RED = '#EF4444'
const ease = [0.25, 0.1, 0.25, 1]

const TYPE_CONFIG = {
  swap: { color: '#06b6d4', icon: 'SW', label: 'Swap' },
  bridge: { color: '#a855f7', icon: 'BR', label: 'Bridge' },
  reward: { color: '#f59e0b', icon: 'RW', label: 'Reward' },
  governance: { color: '#22c55e', icon: 'GV', label: 'Governance' },
  system: { color: '#3b82f6', icon: 'SY', label: 'System' },
  security: { color: '#ef4444', icon: 'SC', label: 'Security' },
  price: { color: '#8b5cf6', icon: 'PR', label: 'Price' },
}

const NOTIFICATIONS = [
  { id: 1, type: 'swap', title: 'Swap Confirmed', desc: 'Swapped 1.5 ETH for 5,250 USDC on Base', time: '2m ago', read: false },
  { id: 2, type: 'reward', title: 'Rewards Available', desc: '250 VIBE rewards ready to claim from LP fees', time: '15m ago', read: false },
  { id: 3, type: 'bridge', title: 'Bridge Complete', desc: '5,000 USDC transferred from Base to Arbitrum via LayerZero', time: '28m ago', read: false },
  { id: 4, type: 'governance', title: 'New Proposal', desc: 'VIP-42: Increase insurance pool allocation to 8%', time: '1h ago', read: true },
  { id: 5, type: 'system', title: 'Batch #847,291 Settled', desc: '42 orders processed with uniform clearing price', time: '2h ago', read: true },
  { id: 6, type: 'price', title: 'Price Alert', desc: 'ETH crossed above $3,500 — your target price was hit', time: '3h ago', read: true },
  { id: 7, type: 'security', title: 'Circuit Breaker Update', desc: 'Withdrawal breaker recovered after 5-minute cooldown', time: '6h ago', read: true },
  { id: 8, type: 'swap', title: 'Swap Confirmed', desc: 'Swapped 10,000 VIBE for 0.143 ETH on Base', time: '8h ago', read: true },
  { id: 9, type: 'reward', title: 'Loyalty Milestone', desc: 'Reached Level 12! +500 XP bonus applied', time: '1d ago', read: true },
  { id: 10, type: 'governance', title: 'Vote Recorded', desc: 'Your vote on VIP-41 was recorded (YES with 85,000 VIBE)', time: '1d ago', read: true },
  { id: 11, type: 'bridge', title: 'Bridge Complete', desc: '2.0 ETH bridged from Ethereum to Base', time: '3d ago', read: true },
  { id: 12, type: 'system', title: 'Protocol Upgrade', desc: 'VibeSwap v0.1.0 deployed with enhanced batch auctions', time: '5d ago', read: true },
  { id: 13, type: 'security', title: 'New Device Detected', desc: 'WebAuthn passkey enrolled on Chrome / Windows', time: '7d ago', read: true },
  { id: 14, type: 'price', title: 'Price Alert', desc: 'VIBE dropped below $0.05 — your stop-loss target', time: '7d ago', read: true },
]

const cardV = {
  hidden: { opacity: 0, y: 12 },
  visible: (i) => ({ opacity: 1, y: 0, transition: { duration: 0.3, delay: 0.05 + i * (0.04 * PHI), ease } }),
  exit: { opacity: 0, x: -40, transition: { duration: 0.2 } },
}

// ============ Section Wrapper ============
function Section({ title, children, className = '' }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 / PHI }}
      className={`mb-6 ${className}`}
    >
      <h2 className="text-white font-bold text-lg mb-4 flex items-center gap-2">
        <span style={{ color: CYAN }}>_</span>{title}
      </h2>
      {children}
    </motion.div>
  )
}

export default function NotificationsPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [filter, setFilter] = useState('all')
  const [notifications, setNotifications] = useState(NOTIFICATIONS)
  const [showPreferences, setShowPreferences] = useState(false)
  const [preferences, setPreferences] = useState({
    swap: true,
    bridge: true,
    reward: true,
    governance: true,
    system: true,
    security: true,
    price: true,
  })

  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications])
  const filtered = filter === 'all'
    ? notifications
    : filter === 'unread'
      ? notifications.filter((n) => !n.read)
      : notifications.filter((n) => n.type === filter)

  const markAllRead = () => setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
  const markRead = (id) => setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n))
  const toggleRead = (id) => setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: !n.read } : n))
  const dismiss = (id) => setNotifications((prev) => prev.filter((n) => n.id !== id))
  const clearAll = () => setNotifications([])
  const togglePref = (key) => setPreferences((prev) => ({ ...prev, [key]: !prev[key] }))

  // ============ Not Connected State ============
  if (!isConnected) {
    return (
      <div className="min-h-screen pb-20">
        {/* ============ Header ============ */}
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-8 pt-6">
          <h1 className="text-3xl sm:text-4xl font-bold text-white font-display">
            NOTIFI<span style={{ color: CYAN }}>CATIONS</span>
          </h1>
          <p className="text-gray-400 text-sm mt-2 font-mono">Your activity feed and alerts.</p>
          <div className="mx-auto mt-3 h-px w-32" style={{ background: `linear-gradient(to right, transparent, ${CYAN}, transparent)` }} />
        </motion.div>
        <div className="max-w-2xl mx-auto px-4 mt-8">
          <GlassCard glowColor="terminal" hover={false}>
            <div className="p-8 text-center">
              <div className="text-2xl mb-2" style={{ color: `${CYAN}30` }}>{'{ }'}</div>
              <h3 className="text-lg font-bold text-white mb-2 font-mono">No Notifications</h3>
              <p className="text-sm font-mono text-gray-400">Connect your wallet to receive transaction updates, alerts, and system notifications.</p>
            </div>
          </GlassCard>
        </div>
      </div>
    )
  }

  // ============ Connected State ============
  return (
    <div className="min-h-screen pb-20">
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        {Array.from({ length: 6 }).map((_, i) => (
          <motion.div key={i} className="absolute w-px h-px rounded-full"
            style={{ background: CYAN, left: `${(i * PHI * 17) % 100}%`, top: `${(i * PHI * 23) % 100}%` }}
            animate={{ opacity: [0, 0.15, 0], scale: [0, 1.5, 0], y: [0, -40] }}
            transition={{ duration: 4, repeat: Infinity, delay: i * 0.7, ease: 'easeOut' }} />
        ))}
      </div>

      <div className="relative z-10">
        {/* ============ Header ============ */}
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-8 pt-6">
          <h1 className="text-3xl sm:text-4xl font-bold text-white font-display">
            NOTIFI<span style={{ color: CYAN }}>CATIONS</span>
          </h1>
          <p className="text-gray-400 text-sm mt-2 font-mono">Your activity feed and alerts.</p>
          <div className="mx-auto mt-3 h-px w-32" style={{ background: `linear-gradient(to right, transparent, ${CYAN}, transparent)` }} />
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.3 }}
            className="inline-flex items-center gap-1.5 mt-3 px-3 py-1 rounded-full text-xs font-mono"
            style={{ background: 'rgba(0,0,0,0.4)', border: `1px solid ${unreadCount > 0 ? AMBER : GREEN}30` }}>
            <div className="w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ backgroundColor: unreadCount > 0 ? AMBER : GREEN }} />
            <span style={{ color: unreadCount > 0 ? AMBER : GREEN }}>
              {unreadCount > 0 ? `${unreadCount} Unread` : 'All Read'}
            </span>
          </motion.div>
        </motion.div>

        <div className="max-w-3xl mx-auto px-4 space-y-4">

          {/* ============ Your Position ============ */}
          <Section title="Your Position">
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Total', value: notifications.length, color: CYAN },
                { label: 'Unread', value: unreadCount, color: unreadCount > 0 ? AMBER : GREEN },
                { label: 'Today', value: notifications.filter((n) => n.time.includes('m ago') || n.time.includes('h ago')).length, color: '#a855f7' },
              ].map((s, i) => (
                <GlassCard key={s.label} glowColor="terminal" hover>
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.08 * PHI }} className="p-3 text-center">
                    <div className="text-lg font-mono font-bold" style={{ color: s.color }}>{s.value}</div>
                    <div className="text-[10px] text-gray-500 font-mono mt-1">{s.label}</div>
                  </motion.div>
                </GlassCard>
              ))}
            </div>
          </Section>

          {/* ============ Notification Preferences ============ */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
            <GlassCard glowColor="terminal" hover={false}>
              <div className="p-4">
                <button onClick={() => setShowPreferences(!showPreferences)}
                  className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-2">
                    <span style={{ color: CYAN }} className="font-mono text-sm font-bold">_</span>
                    <span className="text-white font-bold text-sm">Notification Preferences</span>
                  </div>
                  <motion.span animate={{ rotate: showPreferences ? 180 : 0 }} transition={{ duration: 0.2 }}
                    className="text-gray-500 text-xs font-mono">
                    {showPreferences ? '[-]' : '[+]'}
                  </motion.span>
                </button>

                <AnimatePresence>
                  {showPreferences && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3 }}
                      className="overflow-hidden">
                      <div className="h-px mt-3 mb-4" style={{ background: `linear-gradient(90deg, ${CYAN}20, transparent)` }} />
                      <p className="text-[10px] font-mono text-gray-500 mb-3">Choose which notification types to receive</p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {Object.entries(TYPE_CONFIG).map(([key, cfg]) => (
                          <button key={key} onClick={() => togglePref(key)}
                            className="flex items-center gap-2 rounded-lg p-2.5 transition-all"
                            style={{
                              background: preferences[key] ? `${cfg.color}10` : 'rgba(0,0,0,0.3)',
                              border: `1px solid ${preferences[key] ? `${cfg.color}30` : 'rgba(255,255,255,0.04)'}`,
                            }}>
                            <div className="w-6 h-6 rounded flex items-center justify-center text-[8px] font-mono font-bold flex-shrink-0"
                              style={{
                                background: preferences[key] ? `${cfg.color}20` : 'rgba(255,255,255,0.04)',
                                color: preferences[key] ? cfg.color : '#4B5563',
                                border: `1px solid ${preferences[key] ? `${cfg.color}30` : 'rgba(255,255,255,0.04)'}`,
                              }}>
                              {cfg.icon}
                            </div>
                            <span className="text-[10px] font-mono font-bold"
                              style={{ color: preferences[key] ? cfg.color : '#6B7280' }}>
                              {cfg.label}
                            </span>
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </GlassCard>
          </motion.div>

          {/* ============ Toolbar ============ */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.4, ease }}
            className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex gap-1.5 flex-wrap">
              {['all', 'unread', 'swap', 'bridge', 'reward', 'governance', 'system', 'security', 'price'].map((f) => (
                <button key={f} onClick={() => setFilter(f)}
                  className="px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold uppercase tracking-wider transition-colors"
                  style={{
                    background: filter === f ? `${CYAN}20` : 'rgba(0,0,0,0.3)',
                    border: `1px solid ${filter === f ? `${CYAN}40` : 'rgba(255,255,255,0.04)'}`,
                    color: filter === f ? CYAN : 'rgba(255,255,255,0.4)',
                  }}>
                  {f}
                  {f === 'unread' && unreadCount > 0 && (
                    <span className="ml-1 px-1 py-px rounded text-[8px]"
                      style={{ background: '#f59e0b20', color: '#f59e0b' }}>{unreadCount}</span>
                  )}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button onClick={markAllRead}
                  className="text-[10px] font-mono px-3 py-1.5 rounded-lg transition-colors"
                  style={{ background: `${CYAN}10`, border: `1px solid ${CYAN}20`, color: CYAN }}>
                  Mark All Read
                </button>
              )}
              {notifications.length > 0 && (
                <button onClick={clearAll}
                  className="text-[10px] font-mono px-3 py-1.5 rounded-lg transition-colors"
                  style={{ background: `${RED}10`, border: `1px solid ${RED}20`, color: RED }}>
                  Clear All
                </button>
              )}
            </div>
          </motion.div>

          {/* ============ Notification List ============ */}
          <AnimatePresence mode="popLayout">
            {filtered.length === 0 ? (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <GlassCard glowColor="terminal" hover={false}>
                  <div className="p-12 text-center">
                    <div className="text-2xl mb-2" style={{ color: `${CYAN}20` }}>{'{ }'}</div>
                    <p className="text-sm font-mono text-gray-500">No notifications match this filter</p>
                  </div>
                </GlassCard>
              </motion.div>
            ) : (
              filtered.map((n, i) => {
                const cfg = TYPE_CONFIG[n.type]
                return (
                  <motion.div key={n.id} custom={i} variants={cardV} initial="hidden" animate="visible" exit="exit" layout>
                    <div
                      className="rounded-xl p-4 transition-all duration-200 group relative overflow-hidden"
                      style={{
                        background: n.read ? 'rgba(0,0,0,0.3)' : `${cfg.color}06`,
                        border: `1px solid ${n.read ? 'rgba(255,255,255,0.04)' : `${cfg.color}20`}`,
                      }}
                    >
                      {!n.read && (
                        <div className="absolute top-3 right-3 w-2 h-2 rounded-full"
                          style={{ background: cfg.color, boxShadow: `0 0 6px ${cfg.color}60` }} />
                      )}
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[9px] font-mono font-bold flex-shrink-0 mt-0.5"
                          style={{ background: `${cfg.color}12`, border: `1px solid ${cfg.color}25`, color: cfg.color }}>
                          {cfg.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-mono font-bold ${n.read ? 'text-gray-300' : 'text-white'}`}>
                              {n.title}
                            </span>
                            <span className="text-[8px] font-mono px-1.5 py-0.5 rounded-full uppercase"
                              style={{ background: `${cfg.color}10`, border: `1px solid ${cfg.color}20`, color: cfg.color }}>
                              {cfg.label}
                            </span>
                          </div>
                          <p className="text-[11px] font-mono text-gray-400 mt-1 leading-relaxed">{n.desc}</p>
                          <span className="text-[9px] font-mono text-gray-600 mt-1 block">{n.time}</span>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          {/* Toggle read/unread */}
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleRead(n.id) }}
                            className="w-6 h-6 rounded-full flex items-center justify-center text-gray-600 hover:text-cyan-400 hover:bg-cyan-500/10 transition-colors"
                            title={n.read ? 'Mark as unread' : 'Mark as read'}
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              {n.read
                                ? <path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                : <path d="M5 13l4 4L19 7" />
                              }
                            </svg>
                          </button>
                          {/* Dismiss */}
                          <button
                            onClick={(e) => { e.stopPropagation(); dismiss(n.id) }}
                            className="w-6 h-6 rounded-full flex items-center justify-center text-gray-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                            title="Dismiss"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )
              })
            )}
          </AnimatePresence>
        </div>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2 }} className="mt-12 mb-8 text-center">
          <div className="w-16 h-px mx-auto mb-4" style={{ background: `linear-gradient(90deg, transparent, ${CYAN}40, transparent)` }} />
          <p className="text-[10px] font-mono text-gray-600 tracking-widest uppercase">Notification Center</p>
        </motion.div>
      </div>
    </div>
  )
}
